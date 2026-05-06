#!/usr/bin/env node
// Patches legacy/main.swf to change baseMch from 1080 to 768.
//
// The compiled SWF has baseMcw=1920 and baseMch=1080 (matching the original
// full-screen Flash deployment). When running in Ruffle with noScale mode and
// a 1920x768 player, Stage.height returns 768. The centering formula in
// first.as is: _root._y = (baseMch - mch) / 2
//
// With baseMch=1080 and mch=768: _root._y = 156  (content pushed down, clipped)
// With baseMch=768  and mch=768: _root._y = 0    (correct)
//
// This is a same-size 4-byte replacement (int32 1080 → int32 768) so no tag
// size adjustments are needed.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OLD_VALUE = 1080;
const NEW_VALUE = 768;

const IN_PATH  = path.resolve(__dirname, '..', 'legacy', 'main.swf');
const OUT_PATH = IN_PATH;

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

  // Find the baseMch string in the constant pool
  const baseMchStr = Buffer.from('baseMch\0', 'ascii');
  const strOff = body.indexOf(baseMchStr);
  if (strOff < 0) throw new Error('baseMch string not found in SWF');

  // Search for the assignment bytecode pattern near the baseMch string.
  // Pattern: Push "baseMch" (CP ref) → Push int32(1080) → SetVariable
  //   96 02 00 08 XX   (Push CP[XX])
  //   96 05 00 07 LL LL LL LL   (Push int32)
  //   1d   (SetVariable)
  //
  // We search for the Push int32 + SetVariable portion: 96 05 00 07 <4 bytes> 1d
  // within a reasonable range after the constant pool.

  const oldValBuf = Buffer.alloc(4);
  oldValBuf.writeInt32LE(OLD_VALUE, 0);

  const newValBuf = Buffer.alloc(4);
  newValBuf.writeInt32LE(NEW_VALUE, 0);

  // Build the full pattern: Push int32(OLD_VALUE), SetVariable
  const pattern = Buffer.from([0x96, 0x05, 0x00, 0x07, ...oldValBuf, 0x1d]);
  const alreadyPattern = Buffer.from([0x96, 0x05, 0x00, 0x07, ...newValBuf, 0x1d]);

  // Search starting from the baseMch string location (it's in the same DoAction)
  const searchStart = Math.max(0, strOff - 0x200);
  const searchEnd = Math.min(body.length, strOff + 0x200);

  // Also look for the baseMcw = 1920 pattern to confirm we're in the right spot
  const baseMcwVal = Buffer.alloc(4);
  baseMcwVal.writeInt32LE(1920, 0);
  const mcwPattern = Buffer.from([0x96, 0x05, 0x00, 0x07, ...baseMcwVal, 0x1d]);
  const mcwOff = body.indexOf(mcwPattern, searchStart);
  if (mcwOff >= 0 && mcwOff < searchEnd) {
    console.log('[baseMch] Confirmed baseMcw=1920 at body offset 0x' + mcwOff.toString(16));
  }

  // Check if already patched
  let off = body.indexOf(alreadyPattern, searchStart);
  if (off >= 0 && off < searchEnd) {
    console.log('[baseMch] Already patched: baseMch=' + NEW_VALUE + ' at offset 0x' + off.toString(16) + ' — skipping.');
    return;
  }

  // Find and patch
  off = body.indexOf(pattern, searchStart);
  if (off < 0 || off >= searchEnd) {
    throw new Error('baseMch assignment bytecode not found (Push int32(' + OLD_VALUE + ') + SetVariable)');
  }

  // The int32 value starts at off+4 (after 96 05 00 07)
  const valueOff = off + 4;
  console.log('[baseMch] Found baseMch=' + OLD_VALUE + ' at body offset 0x' + off.toString(16));
  console.log('[baseMch] Patching int32 at 0x' + valueOff.toString(16) + ': ' + OLD_VALUE + ' -> ' + NEW_VALUE);

  newValBuf.copy(body, valueOff);

  const totalLen = writeSwf(OUT_PATH, sig, version, body);
  console.log('[baseMch] Wrote ' + OUT_PATH + ' (' + totalLen + ' bytes)');
}

patch();
