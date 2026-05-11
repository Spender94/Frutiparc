#!/usr/bin/env node
// Patches legacy/main.swf to fix icon drag & drop in Ruffle.
//
// Two icon list components create their content with flMask:true, which
// causes Component.initMask to call content.setMask(mcMask). In Ruffle,
// setMask blocks mouse events on the masked content — preventing icon
// onPress handlers from firing for the desktop, and preventing _droptarget
// from resolving to the icon list area for folder windows.
//
// We flip the flMask boolean from true (0x01) to false (0x00) in:
//   1. FPDesktop.displayIconList  — fixes desktop icon drag (and rearrange)
//   2. win.Explorer  fileIconList — fixes drop onto an open folder window
//
// Each is a single-byte patch (value flip; no size changes).

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

// Patches a single byte. Pattern must uniquely identify the location of the
// flag inside the SWF body. boolByteOffset is the offset (within the matched
// pattern) of the bool value byte to flip from 0x01 to 0x00.
function flipFlMask(body, name, patternBytes, boolByteOffset) {
  const pattern = Buffer.from(patternBytes);
  // Build the "already patched" pattern (same bytes but bool byte = 0x00)
  const patchedPattern = Buffer.from(pattern);
  patchedPattern[boolByteOffset] = 0x00;

  const off = body.indexOf(pattern);
  if (off < 0) {
    if (body.indexOf(patchedPattern) >= 0) {
      console.log('[' + name + '] already patched — skipping.');
      return;
    }
    throw new Error('[' + name + '] flMask pattern not found');
  }

  // Verify the pattern appears exactly once
  if (body.indexOf(pattern, off + 1) >= 0) {
    throw new Error('[' + name + '] pattern is not unique');
  }

  const boolOff = off + boolByteOffset;
  console.log('[' + name + '] flMask=true at decompressed offset', boolOff,
              '(was 0x' + body[boolOff].toString(16) + ')');
  body[boolOff] = 0x00;
}

function patch() {
  const { sig, version, body } = readSwf(IN_PATH);

  // 1) FPDesktop.displayIconList — flMask at CP index 152 (0x98)
  //    Surrounding: Push flTrace(0x97) TRUE flMask(0x98) TRUE
  //    Pattern: 08 97 05 01 08 98 05 01  → flip last byte
  flipFlMask(body, 'FPDesktop.iconList',
    [0x08, 0x97, 0x05, 0x01, 0x08, 0x98, 0x05, 0x01], 7);

  // 2) win.Explorer fileIconList — flMask at CP index 60 (0x3c)
  //    Push len=9 [Const8 flMask, Bool TRUE, Int 1] then InitObject
  //    Pattern: 96 09 00 08 3c 05 01 07 01 00 00 00 43  → flip byte at idx 6
  flipFlMask(body, 'win.Explorer.fileIconList',
    [0x96, 0x09, 0x00, 0x08, 0x3c, 0x05, 0x01, 0x07, 0x01, 0x00, 0x00, 0x00, 0x43], 6);

  const outSize = writeSwf(OUT_PATH, sig, version, body);
  console.log('Wrote', OUT_PATH, '(' + outSize + ' bytes)');
}

patch();
