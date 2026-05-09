#!/usr/bin/env node
// Extracts the embedded frutiSign sprite (DefineSprite 128) and its
// dependent shape definitions (charIDs 114–127) from legacy/main.swf
// and packages them into a standalone frutiSign.swf.
//
// The resulting SWF has the same frame labels and graphics as the
// embedded sprite, with a frame-1 script that reads the `sign` variable
// and navigates to the corresponding frame label.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const IN_PATH = path.resolve(__dirname, '..', 'legacy', 'main.swf');
const OUT_PATH = path.resolve(__dirname, '..', 'public', 'swf', 'frutiSign.swf');

function readSwf(filePath) {
  const raw = fs.readFileSync(filePath);
  const sig = raw.slice(0, 3).toString('ascii');
  if (sig !== 'CWS' && sig !== 'FWS') throw new Error('Unsupported sig: ' + sig);
  const version = raw[3];
  let body;
  if (sig === 'CWS') body = zlib.inflateSync(raw.slice(8));
  else body = Buffer.from(raw.slice(8));
  return { sig, version, body };
}

function parseTags(body) {
  const nbits = (body[0] >> 3) & 0x1f;
  const rectBytes = Math.ceil((5 + nbits * 4) / 8);
  let p = rectBytes + 4;

  const tags = [];
  while (p < body.length) {
    const hdr = body.readUInt16LE(p);
    const code = hdr >> 6;
    let length = hdr & 0x3f;
    let hsize = 2;
    if (length === 0x3f) { length = body.readUInt32LE(p + 2); hsize = 6; }
    if (code === 0) break;
    tags.push({ code, offset: p, hsize, length, raw: body.slice(p, p + hsize + length) });
    p += hsize + length;
  }
  return tags;
}

function parseSpriteTags(body, spriteTag) {
  const dataStart = spriteTag.offset + spriteTag.hsize + 4; // skip spriteId + frameCount
  const dataEnd = spriteTag.offset + spriteTag.hsize + spriteTag.length;
  let p = dataStart;
  const sub = [];
  while (p < dataEnd) {
    const hdr = body.readUInt16LE(p);
    const code = hdr >> 6;
    let length = hdr & 0x3f;
    let hsize = 2;
    if (length === 0x3f) { length = body.readUInt32LE(p + 2); hsize = 6; }
    sub.push({ code, offset: p, hsize, length, raw: body.slice(p, p + hsize + length) });
    if (code === 0) break;
    p += hsize + length;
  }
  return sub;
}

function makeTagHeader(code, length) {
  if (length < 0x3f && code <= 0x3ff) {
    const buf = Buffer.alloc(2);
    buf.writeUInt16LE((code << 6) | length, 0);
    return buf;
  }
  const buf = Buffer.alloc(6);
  buf.writeUInt16LE((code << 6) | 0x3f, 0);
  buf.writeUInt32LE(length, 2);
  return buf;
}

function build() {
  const { version, body } = readSwf(IN_PATH);
  const tags = parseTags(body);

  // Find DefineSprite 128
  let sprite128 = null;
  for (const tag of tags) {
    if (tag.code === 39) {
      const sid = body.readUInt16LE(tag.offset + tag.hsize);
      if (sid === 128) { sprite128 = tag; break; }
    }
  }
  if (!sprite128) throw new Error('DefineSprite 128 not found');

  // Find needed shape definitions (charIDs 114-127)
  const neededIds = new Set();
  for (let i = 114; i <= 127; i++) neededIds.add(i);

  const defineShapeTags = new Map();
  const defineTagCodes = new Set([2, 22, 32, 83, 20, 36, 21, 35, 46]);
  for (const tag of tags) {
    if (defineTagCodes.has(tag.code)) {
      const cid = body.readUInt16LE(tag.offset + tag.hsize);
      if (neededIds.has(cid)) {
        defineShapeTags.set(cid, tag.raw);
      }
    }
  }

  if (defineShapeTags.size !== neededIds.size) {
    const missing = [...neededIds].filter(id => !defineShapeTags.has(id));
    throw new Error('Missing shape definitions for charIDs: ' + missing.join(', '));
  }

  // Parse sub-tags of DefineSprite 128 — these become the root timeline
  const subTags = parseSpriteTags(body, sprite128);

  // Build the output SWF body
  const parts = [];

  // RECT: use a reasonable bounding box (100x100 twips = 5x5 pixels at 20 twips/pixel)
  // Actually use 40x40 pixels = 800x800 twips to match the frutiSign size
  const rectBuf = Buffer.alloc(9);
  // nBits=16 → 5 bits; Xmin=0, Xmax=800*20=16000 twips, Ymin=0, Ymax=800*20=16000
  // Actually, let's measure from the shapes. For now use a safe 2000x2000 twips (100x100px)
  // nBits=11 (fits values up to 2047)
  // 5 bits: 01011 = 11
  // Xmin (11 bits): 0
  // Xmax (11 bits): 2000 = 0x7D0
  // Ymin (11 bits): 0
  // Ymax (11 bits): 2000
  // Total: 5 + 4*11 = 49 bits = 7 bytes (rounded up)
  const nBits = 16;
  const xMax = 20000; // 1000 pixels * 20 twips
  const yMax = 20000;
  // Write RECT manually
  let bitBuf = [];
  function writeBits(val, n) {
    for (let i = n - 1; i >= 0; i--) {
      bitBuf.push((val >> i) & 1);
    }
  }
  writeBits(nBits, 5);
  writeBits(0, nBits);     // Xmin
  writeBits(xMax, nBits);  // Xmax
  writeBits(0, nBits);     // Ymin
  writeBits(yMax, nBits);  // Ymax
  // Pad to byte boundary
  while (bitBuf.length % 8 !== 0) bitBuf.push(0);
  const rectData = Buffer.alloc(bitBuf.length / 8);
  for (let i = 0; i < rectData.length; i++) {
    let byte = 0;
    for (let j = 0; j < 8; j++) {
      byte = (byte << 1) | bitBuf[i * 8 + j];
    }
    rectData[i] = byte;
  }
  parts.push(rectData);

  // Frame rate (Fixed8: frac.int) and frame count
  const frameInfo = Buffer.alloc(4);
  frameInfo.writeUInt8(0, 0);   // fraction
  frameInfo.writeUInt8(24, 1);  // integer = 24 FPS
  frameInfo.writeUInt16LE(100, 2); // frame count (same as embedded sprite)
  parts.push(frameInfo);

  // Write shape definition tags (charIDs 114-127)
  for (let cid = 114; cid <= 127; cid++) {
    parts.push(defineShapeTags.get(cid));
  }

  // Write the sub-tags from DefineSprite 128 as root timeline tags
  // (DoAction, PlaceObject2, ShowFrame, FrameLabel, RemoveObject2, End)
  for (const sub of subTags) {
    parts.push(sub.raw);
  }

  // Assemble the SWF
  const bodyBuf = Buffer.concat(parts);
  const fileLen = 8 + bodyBuf.length;

  // Write as uncompressed FWS (small enough, no need for compression)
  const header = Buffer.alloc(8);
  header.write('FWS', 0, 'ascii');
  header.writeUInt8(version, 3);
  header.writeUInt32LE(fileLen, 4);

  const outBuf = Buffer.concat([header, bodyBuf]);
  fs.writeFileSync(OUT_PATH, outBuf);
  console.log('Wrote ' + OUT_PATH + ' (' + outBuf.length + ' bytes)');
}

build();
