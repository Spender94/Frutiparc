#!/usr/bin/env node
// Patches legacy/main.swf to raise the contact bar tab ("languette") so it
// appears above the bottom edge of the visible stage instead of being clipped.
//
// In the SideList class (id 847), the onStageResize() method assigns:
//   this.butContact._y = _global.mch        // _global.mch == Stage.height (768)
//
// This puts the tab right at the bottom of the 768px stage, where its origin
// sits at y=768 and most of it is below the visible area.
//
// The bytecode at offset 0x9fe6e is:
//   96 06 00 08 2a 04 02 08 1e 4e 4f
//   Push '_y', r2, 'mch'  ; GetMember (_global.mch)  ; SetMember
//
// We replace it with a same-length sequence that pushes a hardcoded int32:
//   96 07 00 08 2a 07 XX XX XX XX 4f
//   Push '_y', i(NEW_Y)                              ; SetMember
//
// Same byte count (11 bytes), so no tag-length or codeSize updates needed.
//
// NEW_Y = 680 puts the tab 88px above the bottom edge — clearly visible.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const NEW_Y = 650;

const IN_PATH  = path.resolve(__dirname, '..', 'legacy', 'main.swf');
const OUT_PATH = IN_PATH;

const OLD_BYTES = Buffer.from([0x96, 0x06, 0x00, 0x08, 0x2a, 0x04, 0x02, 0x08, 0x1e, 0x4e, 0x4f]);

function buildNewBytes(y) {
  const buf = Buffer.alloc(11);
  buf[0] = 0x96;            // Push
  buf.writeUInt16LE(7, 1);  // payload length = 7
  buf[3] = 0x08;            // type 8 (CP8)
  buf[4] = 0x2a;            // CP[42] = '_y'
  buf[5] = 0x07;            // type 7 (int32)
  buf.writeInt32LE(y, 6);   // the Y value
  buf[10] = 0x4f;           // SetMember
  return buf;
}

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

function patch() {
  const { sig, version, body } = readSwf(IN_PATH);

  let offset = body.indexOf(OLD_BYTES);
  if (offset < 0) {
    // Maybe already patched with a different Y — find the new-style prefix and re-patch
    const partial = Buffer.from([0x96, 0x07, 0x00, 0x08, 0x2a, 0x07]);
    const partialOff = body.indexOf(partial);
    if (partialOff >= 0) {
      const oldY = body.readInt32LE(partialOff + 6);
      if (oldY === NEW_Y) {
        console.log(`[main-sidelist] Already patched with y=${NEW_Y} — skipping.`);
        return;
      }
      console.log(`[main-sidelist] Re-patching from y=${oldY} to y=${NEW_Y}`);
      offset = partialOff;
    } else {
      throw new Error('Original butContact._y bytecode pattern not found');
    }
  }
  // Sanity: make sure pattern only appears once
  if (body.indexOf(OLD_BYTES, offset + 1) >= 0) {
    throw new Error('Pattern is ambiguous (matches multiple locations)');
  }

  const newBytes = buildNewBytes(NEW_Y);
  newBytes.copy(body, offset);

  console.log(`[main-sidelist] Patched butContact._y assignment at body offset 0x${offset.toString(16)} -> y=${NEW_Y}`);

  const totalLen = writeSwf(OUT_PATH, sig, version, body);
  console.log(`[main-sidelist] Wrote ${OUT_PATH} (${totalLen} bytes)`);
}

patch();
