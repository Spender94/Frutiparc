#!/usr/bin/env node
// Patches legacy/main.swf to reposition two elements in the SideList class
// (id 847) so they appear within the visible 768px stage:
//
// 1) butContact (the contact bar tab / "languette"):
//    Original: this.butContact._y = _global.mch   (768 — right at the bottom edge)
//    Patched:  this.butContact._y = targetY
//    Bytecode: 11 bytes at body offset 0x9fe6e
//
// 2) butSearch (the "rechercher" button):
//    Original: this.butSearch._y = _global.mch - this.hSearch + 3
//    Patched:  this.butSearch._y = targetY
//    Bytecode: 37 bytes at two locations (onStageResize + activate)

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CONTACT_Y = 690;
const SEARCH_Y  = 660;

const IN_PATH  = path.resolve(__dirname, '..', 'legacy', 'main.swf');
const OUT_PATH = IN_PATH;

// --- butContact patch (11 bytes) ---

const CONTACT_OLD = Buffer.from([
  0x96, 0x06, 0x00, 0x08, 0x2a, 0x04, 0x02, 0x08, 0x1e, 0x4e, 0x4f
]);
const CONTACT_PATCHED_PREFIX = Buffer.from([0x96, 0x07, 0x00, 0x08, 0x2a, 0x07]);

function buildContactPatch(y) {
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

// --- butSearch patch (37 bytes) ---
// Original bytecode (37 bytes):
//   Push r1,'butSearch' ; GetMember ; Push '_y',r2,'mch' ; GetMember
//   Push r1,'hSearch' ; GetMember ; Subtract ; Push i(3) ; Add2 ; SetMember
// Replaced with: Push r1,'butSearch' ; GetMember ; Push '_y',i(Y) ; SetMember ; Jump +13 ; <13 pad bytes>

const SEARCH_OLD = Buffer.from([
  0x96, 0x04, 0x00, 0x04, 0x01, 0x08, 0x2f,       // Push r1, CP[47]='butSearch'
  0x4e,                                             // GetMember
  0x96, 0x06, 0x00, 0x08, 0x2a, 0x04, 0x02, 0x08, 0x1e, // Push '_y', r2, 'mch'
  0x4e,                                             // GetMember
  0x96, 0x04, 0x00, 0x04, 0x01, 0x08, 0x2e,       // Push r1, CP[46]='hSearch'
  0x4e,                                             // GetMember
  0x0b,                                             // Subtract
  0x96, 0x05, 0x00, 0x07, 0x03, 0x00, 0x00, 0x00, // Push i(3)
  0x47,                                             // Add2
  0x4f                                              // SetMember
]);

function buildSearchPatch(y) {
  const buf = Buffer.alloc(37);
  // Push r1, CP[47]='butSearch'
  buf[0] = 0x96; buf.writeUInt16LE(4, 1); buf[3] = 0x04; buf[4] = 0x01; buf[5] = 0x08; buf[6] = 0x2f;
  // GetMember
  buf[7] = 0x4e;
  // Push '_y', i(Y) — payload = 1+1 + 1+4 = 7
  buf[8] = 0x96; buf.writeUInt16LE(7, 9); buf[11] = 0x08; buf[12] = 0x2a; buf[13] = 0x07;
  buf.writeInt32LE(y, 14);
  // SetMember
  buf[18] = 0x4f;
  // Jump +13 (skip remaining 13 pad bytes)
  buf[19] = 0x99; buf.writeUInt16LE(2, 20); buf.writeInt16LE(13, 22);
  // Pad bytes 24..36 are already 0x00
  return buf;
}

// Check if the search patch was already applied; return patched prefix to detect
const SEARCH_PATCHED_PREFIX = Buffer.from([
  0x96, 0x04, 0x00, 0x04, 0x01, 0x08, 0x2f, 0x4e, // Push r1,CP[47]; GetMember
  0x96, 0x07, 0x00, 0x08, 0x2a, 0x07               // Push '_y', int32...
]);

// --- SWF I/O ---

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

// --- Patching logic ---

function patchPattern(body, label, oldBytes, patchedPrefix, buildFn, targetY) {
  let offset = body.indexOf(oldBytes);
  if (offset >= 0) {
    if (body.indexOf(oldBytes, offset + 1) >= 0) {
      // For butSearch there are exactly 2 occurrences — patch both
      const offsets = [];
      let search = 0;
      while (true) {
        const pos = body.indexOf(oldBytes, search);
        if (pos < 0) break;
        offsets.push(pos);
        search = pos + 1;
      }
      const newBytes = buildFn(targetY);
      for (const off of offsets) {
        newBytes.copy(body, off);
        console.log(`[main-sidelist] Patched ${label} at body offset 0x${off.toString(16)} -> y=${targetY}`);
      }
      return;
    }
    const newBytes = buildFn(targetY);
    newBytes.copy(body, offset);
    console.log(`[main-sidelist] Patched ${label} at body offset 0x${offset.toString(16)} -> y=${targetY}`);
    return;
  }

  // Already patched — look for the patched prefix
  const offsets = [];
  let search = 0;
  while (true) {
    const pos = body.indexOf(patchedPrefix, search);
    if (pos < 0) break;
    offsets.push(pos);
    search = pos + 1;
  }
  if (offsets.length === 0) {
    throw new Error(`${label}: original bytecode pattern not found`);
  }
  const oldY = body.readInt32LE(offsets[0] + patchedPrefix.length);
  if (offsets.every(off => body.readInt32LE(off + patchedPrefix.length) === targetY)) {
    console.log(`[main-sidelist] ${label} already patched with y=${targetY} — skipping.`);
    return;
  }
  const newBytes = buildFn(targetY);
  for (const off of offsets) {
    newBytes.copy(body, off);
    console.log(`[main-sidelist] Re-patched ${label} at body offset 0x${off.toString(16)} -> y=${targetY} (was ${body.readInt32LE(off + patchedPrefix.length) || oldY})`);
  }
}

function patch() {
  const { sig, version, body } = readSwf(IN_PATH);

  patchPattern(body, 'butContact._y', CONTACT_OLD, CONTACT_PATCHED_PREFIX, buildContactPatch, CONTACT_Y);
  patchPattern(body, 'butSearch._y', SEARCH_OLD, SEARCH_PATCHED_PREFIX, buildSearchPatch, SEARCH_Y);

  const totalLen = writeSwf(OUT_PATH, sig, version, body);
  console.log(`[main-sidelist] Wrote ${OUT_PATH} (${totalLen} bytes)`);
}

patch();
