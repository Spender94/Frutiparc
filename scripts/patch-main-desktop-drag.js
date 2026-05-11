#!/usr/bin/env node
// Patches legacy/main.swf to fix desktop icon drag & drop in Ruffle.
//
// FPDesktop.displayIconList creates the icon list with flMask: true, which
// causes Component.initMask to call content.setMask(mcMask). In Ruffle,
// setMask blocks mouse events on the masked content, preventing icon onPress
// handlers from firing — so icons can't be dragged.
//
// The fix changes the boolean Push value for flMask from true (0x01) to
// false (0x00). This is a single-byte patch with no size changes.
//
// The relevant ActionPush instruction in FPDesktop.displayIconList pushes:
//   "textColor", reg12, "margin", reg7, "flTrace", true, "flMask", true, 7
// We change the second true (flMask's value) to false.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const IN_PATH  = path.resolve(__dirname, '..', 'legacy', 'main.swf');
const OUT_PATH = path.resolve(__dirname, '..', 'legacy', 'main.swf');

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

function writeSwf(outPath, sig, version, body) {
  const newFileLen = 8 + body.length;
  let payload;
  if (sig === 'CWS') {
    payload = zlib.deflateSync(body);
  } else {
    payload = body;
  }
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

  // Locate the FPDesktop constant pool (contains "flMask" at index 152)
  // Search for the signature: constant8 push of index 152 ("flMask") followed
  // by boolean true — the pattern is bytes 0x08 0x98 0x05 0x01
  const pattern = Buffer.from([0x08, 0x98, 0x05, 0x01]);
  const patchOff = body.indexOf(pattern);
  if (patchOff < 0) {
    // Check if already patched (0x08 0x98 0x05 0x00)
    const patched = Buffer.from([0x08, 0x98, 0x05, 0x00]);
    if (body.indexOf(patched) >= 0) {
      console.log('FPDesktop flMask already patched — skipping.');
      return;
    }
    throw new Error('flMask pattern not found');
  }

  // Verify context: should be preceded by flTrace (index 151) + true
  // Pattern: 0x08 0x97 0x05 0x01 0x08 0x98 0x05 0x01
  const contextPattern = Buffer.from([0x08, 0x97, 0x05, 0x01, 0x08, 0x98, 0x05, 0x01]);
  const contextOff = body.indexOf(contextPattern);
  if (contextOff < 0 || contextOff + 4 !== patchOff) {
    throw new Error('Context verification failed — unexpected byte sequence around flMask');
  }

  const boolOff = patchOff + 3; // offset of the 0x01 byte (true)
  console.log('Found flMask=true at decompressed offset', boolOff);
  console.log('  Byte value before patch:', body[boolOff].toString(16));

  // Patch: change true (0x01) to false (0x00)
  body[boolOff] = 0x00;
  console.log('  Byte value after  patch:', body[boolOff].toString(16));

  // Write back (no size changes, just a value byte flip)
  const outSize = writeSwf(OUT_PATH, sig, version, body);
  console.log('Wrote', OUT_PATH, '(' + outSize + ' bytes)');
}

patch();
