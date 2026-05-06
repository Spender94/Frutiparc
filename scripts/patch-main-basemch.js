#!/usr/bin/env node
// Patches legacy/main.swf to change baseMcw from 1920 to 1260 and
// baseMch from 1080 to 768 in compiled first.as.
//
// baseMcw/baseMch are the base canvas dimensions used by first.as's
// StageResize.onResize listener. They must match the values patched
// into init.as onResize (patch-main-onresize.js) to avoid conflicts.
//
// These are same-size 4-byte replacements (int32) so no tag size
// adjustments are needed.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OLD_MCW = 1920;
const NEW_MCW = 1265;
const OLD_MCH = 1080;
const NEW_MCH = 768;

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

  const baseMchStr = Buffer.from('baseMch\0', 'ascii');
  const strOff = body.indexOf(baseMchStr);
  if (strOff < 0) throw new Error('baseMch string not found in SWF');

  const searchStart = Math.max(0, strOff - 0x200);
  const searchEnd = Math.min(body.length, strOff + 0x200);

  let changed = false;

  function patchValue(label, oldVal, newVal) {
    const oldBuf = Buffer.alloc(4); oldBuf.writeInt32LE(oldVal, 0);
    const newBuf = Buffer.alloc(4); newBuf.writeInt32LE(newVal, 0);
    const pattern = Buffer.from([0x96, 0x05, 0x00, 0x07, ...oldBuf, 0x1d]);
    const alreadyPat = Buffer.from([0x96, 0x05, 0x00, 0x07, ...newBuf, 0x1d]);

    let off = body.indexOf(alreadyPat, searchStart);
    if (off >= 0 && off < searchEnd) {
      console.log('[' + label + '] Already patched (' + newVal + ') — skipping.');
      return;
    }
    off = body.indexOf(pattern, searchStart);
    if (off < 0 || off >= searchEnd) {
      throw new Error('[' + label + '] Push int32(' + oldVal + ') + SetVariable not found');
    }
    newBuf.copy(body, off + 4);
    console.log('[' + label + '] Patched at 0x' + off.toString(16) + ': ' + oldVal + ' -> ' + newVal);
    changed = true;
  }

  patchValue('baseMcw', OLD_MCW, NEW_MCW);
  patchValue('baseMch', OLD_MCH, NEW_MCH);

  if (changed) {
    const totalLen = writeSwf(OUT_PATH, sig, version, body);
    console.log('Wrote ' + OUT_PATH + ' (' + totalLen + ' bytes)');
  }
}

patch();
