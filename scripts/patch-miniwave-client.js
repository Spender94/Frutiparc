#!/usr/bin/env node
// Patches Games/miniWave2/miniwave.swf to set STANDALONE = true in the
// miniwave.Client class member init. The compiled SWF carries two
// DoInitAction tags (sprites 26 and 621) that both initialize this.STANDALONE
// to false; we flip the Bool byte in each so that serviceConnect() takes the
// standalone branch (creates empty slots, skips the Frusion socket connect)
// instead of hanging on "Connexion" forever.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SWF_PATH = path.resolve(__dirname, '..', 'Games', 'miniWave2', 'miniwave.swf');
const FULL_PATH = path.resolve(__dirname, '..', 'Games', 'miniWave2', 'full.swf');

function readSwf(filePath) {
  const raw = fs.readFileSync(filePath);
  const sig = raw.slice(0, 3).toString('ascii');
  const version = raw[3];
  let body;
  if (sig === 'CWS') body = zlib.inflateSync(raw.slice(8));
  else if (sig === 'FWS') body = Buffer.from(raw.slice(8));
  else throw new Error('Unsupported sig: ' + sig);
  return { sig, version, body };
}

function writeSwf(outPath, sig, version, newBody) {
  const newFileLen = 8 + newBody.length;
  const payload = sig === 'CWS' ? zlib.deflateSync(newBody) : newBody;
  const out = Buffer.alloc(8 + payload.length);
  out.write(sig, 0, 'ascii');
  out.writeUInt8(version, 3);
  out.writeUInt32LE(newFileLen, 4);
  payload.copy(out, 8);
  fs.writeFileSync(outPath, out);
  return out.length;
}

function parseRect(body) {
  const nbits = (body[0] >> 3) & 0x1f;
  return Math.ceil((5 + nbits * 4) / 8);
}

function findTags(body) {
  const rectBytes = parseRect(body);
  let off = rectBytes + 4; // skip RECT + framerate(2) + framecount(2)
  const tags = [];
  while (off < body.length) {
    const hdr = body.readUInt16LE(off);
    const code = hdr >> 6;
    let length = hdr & 0x3f;
    let hdrSize = 2;
    if (length === 0x3f) {
      length = body.readUInt32LE(off + 2);
      hdrSize = 6;
    }
    if (code === 0) break;
    tags.push({ code, offset: off, hdrSize, length });
    off += hdrSize + length;
  }
  return tags;
}

function parseConstantPool(body, cpStart) {
  if (body[cpStart] !== 0x88) return null;
  const cpPayloadLen = body.readUInt16LE(cpStart + 1);
  const cpCount = body.readUInt16LE(cpStart + 3);
  const entries = [];
  let pos = cpStart + 5;
  while (entries.length < cpCount) {
    const end = body.indexOf(0, pos);
    if (end < 0) return null;
    entries.push(body.slice(pos, end).toString('latin1'));
    pos = end + 1;
  }
  return { payloadLen: cpPayloadLen, count: cpCount, entries, dataEnd: cpStart + 3 + cpPayloadLen };
}

const { sig, version, body } = readSwf(SWF_PATH);
const buf = Buffer.from(body);
const tags = findTags(buf);

let patched = 0;
for (const tag of tags) {
  if (tag.code !== 59) continue; // DoInitAction
  const bodyStart = tag.offset + tag.hdrSize;
  const cpStart = bodyStart + 2; // skip sprite id
  const cp = parseConstantPool(buf, cpStart);
  if (!cp) continue;
  // Look for the miniwave.Client class init (CP entries [Object, Client, ...])
  const standaloneIdx = cp.entries.indexOf('STANDALONE');
  if (standaloneIdx < 0) continue;
  // Verify this is the Client class (not Manager which only reads STANDALONE)
  const isClient = cp.entries[3] === 'Client';
  if (!isClient) continue;
  if (standaloneIdx > 255) {
    console.warn(`STANDALONE CP index ${standaloneIdx} > 255, skipping (would need wide push)`);
    continue;
  }

  // Search for bytecode pattern: push CP[idx] (0x08, idx), Bool false (0x05 0x00),
  // followed by SetMember (0x4F) — i.e., this.STANDALONE = false
  const bytecodeStart = cp.dataEnd;
  const bytecodeEnd = tag.offset + tag.hdrSize + tag.length;
  const needle = Buffer.from([0x08, standaloneIdx, 0x05, 0x00, 0x4f]);
  const idx = buf.indexOf(needle, bytecodeStart);
  if (idx < 0 || idx >= bytecodeEnd) {
    console.warn(`STANDALONE init bytecode not found in tag at offset ${tag.offset}`);
    continue;
  }
  // Flip the Bool false byte (idx + 3) to Bool true
  buf[idx + 3] = 0x01;
  patched++;
  console.log(`Patched STANDALONE=true at offset ${idx + 3} (tag offset ${tag.offset})`);
}

if (patched < 2) {
  throw new Error(`Expected to patch 2 STANDALONE init sites, only patched ${patched}`);
}

const written = writeSwf(SWF_PATH, sig, version, buf);
console.log(`Wrote ${SWF_PATH} (${written} bytes)`);

// Keep full.swf in sync so /games/miniWave2/full.swf serves the patched build.
fs.copyFileSync(SWF_PATH, FULL_PATH);
console.log(`Copied to ${FULL_PATH}`);
