#!/usr/bin/env node
// Patches Games/miniTroll/minipixiz.swf to enable standalone mode.
//
// The compiled SWF has an obfuscated standalone flag (equivalent to
// MiniWave's STANDALONE) initialised to false. The flag controls branching
// in serviceConnect, the constructor (getFileInfos / isWhite overrides),
// and several callback methods. Flipping it to true makes the game work
// inside game-popup.html without the Frusion LocalConnection wrapper.
//
// Patch: one byte change — Bool(false) → Bool(true) at the flag init site.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SWF_PATH = path.resolve(__dirname, '..', 'Games', 'miniTroll', 'minipixiz.swf');
const FULL_PATH = path.resolve(__dirname, '..', 'Games', 'miniTroll', 'full.swf');

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

const { sig, version, body } = readSwf(SWF_PATH);
const buf = Buffer.from(body);

// The standalone flag init bytecode pattern:
//   Push CP[520](obfuscated obj), GetVariable,
//   Push { CP[749](obfuscated prop), Bool(false) }, SetMember
// Bytes: 09 08 02  1c  96 05 00  09 ed 02  05 00  4f
const initPattern = Buffer.from([
  0x09, 0x08, 0x02,       // Push CP[520]
  0x1c,                    // GetVariable
  0x96, 0x05, 0x00,        // Push (5 bytes payload):
  0x09, 0xed, 0x02,        //   CP[749]
  0x05, 0x00,              //   Bool(false)  ← byte to flip
  0x4f,                    // SetMember
]);

const idx = buf.indexOf(initPattern);
if (idx < 0) {
  throw new Error('Standalone flag init pattern not found — SWF may already be patched');
}

// Verify there's only one occurrence
const second = buf.indexOf(initPattern, idx + 1);
if (second >= 0) {
  throw new Error(`Multiple init sites found (${idx}, ${second}) — unexpected`);
}

// The Bool(false) byte is at offset idx + 11
const boolOffset = idx + 11;
if (buf[boolOffset] !== 0x00) {
  console.log('SWF already patched (Bool byte is not 0x00). Skipping.');
  process.exit(0);
}

buf[boolOffset] = 0x01; // Bool(true)
console.log(`Patched standalone flag: Bool(false) → Bool(true) at decompressed offset ${boolOffset}`);

const written = writeSwf(SWF_PATH, sig, version, buf);
console.log(`Wrote ${SWF_PATH} (${written} bytes)`);

fs.copyFileSync(SWF_PATH, FULL_PATH);
console.log(`Copied to ${FULL_PATH}`);
