#!/usr/bin/env node
// Patches legacy/main.swf to replace Stage.width with hardcoded 1920 in
// MainBar.update().
//
// MainBar is the only place in the SWF that uses Stage.width directly (all
// other components use _global.mcw, which is hardcoded in compiled first.as
// to baseMcw=1920). Under Ruffle's noScale mode, Stage.width can return
// values that differ from the player's CSS width, causing MainBar to size
// incorrectly. Hardcoding 1920 matches what _global.mcw is set to elsewhere.
//
// The bytecode pattern for `Stage.width` is 12 bytes:
//   96 02 00 08 6a    Push CP[106]='Stage'
//   1c                GetVariable
//   96 02 00 08 6b    Push CP[107]='width'
//   4e                GetMember
//
// Replaced with 12 bytes (same length, no tag size adjustment needed):
//   96 05 00 07 80 07 00 00    Push int32(1920)
//   4c 17 4c 17                PushDup, Pop, PushDup, Pop (stack-neutral filler)
//
// PushDup+Pop is a stack-neutral no-op that pads the bytecode without
// changing the stack effect (still pushes one number = 1920).

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const HARDCODED_WIDTH = 1920;

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

  // The Stage/width CP indices are 0x6a (106) and 0x6b (107) in MainBar's CP.
  // To stay robust against CP reorderings, we search for the unique combined
  // pattern: Push CP[XX]=Stage, GetVariable, Push CP[YY]=width, GetMember.
  //
  // We locate it by finding the MainBar DoInitAction (sprite id=775) and
  // rebuilding its CP, then identifying the Stage/width indices.

  const nbits = (body[0] >> 3) & 0x1f;
  const rectBytes = Math.ceil((5 + nbits * 4) / 8);
  let p = rectBytes + 4;

  let mainBarOff = -1, mainBarLen = 0, mainBarHsize = 0;
  while (p < body.length) {
    const hdr = body.readUInt16LE(p);
    const code = hdr >> 6;
    let len = hdr & 0x3f;
    let hSize = 2;
    if (len === 0x3f) { len = body.readUInt32LE(p + 2); hSize = 6; }
    if (code === 0) break;
    if (code === 59) {
      const id = body.readUInt16LE(p + hSize);
      if (id === 775) {
        mainBarOff = p;
        mainBarLen = len;
        mainBarHsize = hSize;
        break;
      }
    }
    p += hSize + len;
  }
  if (mainBarOff < 0) throw new Error('MainBar DoInitAction (id=775) not found');

  // Walk MainBar's bytecode to find ConstantPool
  const dataStart = mainBarOff + mainBarHsize + 2;
  const dataEnd = mainBarOff + mainBarHsize + mainBarLen;
  let cpStrings = null;
  let q = dataStart;
  while (q < dataEnd) {
    if (body[q] === 0x88) {
      const plen = body.readUInt16LE(q + 1);
      const count = body.readUInt16LE(q + 3);
      cpStrings = [];
      let r = q + 5;
      for (let i = 0; i < count; i++) {
        let e = r;
        while (body[e] !== 0 && e < q + 3 + plen) e++;
        cpStrings.push(body.slice(r, e).toString('utf8'));
        r = e + 1;
      }
      break;
    }
    q++;
  }
  if (!cpStrings) throw new Error('MainBar ConstantPool not found');

  const stageIdx = cpStrings.indexOf('Stage');
  const widthIdx = cpStrings.indexOf('width');
  if (stageIdx < 0 || widthIdx < 0) {
    throw new Error('Stage or width not in MainBar CP');
  }
  if (stageIdx > 0xff || widthIdx > 0xff) {
    throw new Error('CP indices need 16-bit form (not yet supported)');
  }

  const oldPattern = Buffer.from([
    0x96, 0x02, 0x00, 0x08, stageIdx, // Push CP[stageIdx]='Stage'
    0x1c,                              // GetVariable
    0x96, 0x02, 0x00, 0x08, widthIdx, // Push CP[widthIdx]='width'
    0x4e                               // GetMember
  ]);

  const newPattern = Buffer.alloc(12);
  newPattern[0] = 0x96; newPattern.writeUInt16LE(5, 1); // Push, payload len 5
  newPattern[3] = 0x07;                                  // type 7 (int32)
  newPattern.writeInt32LE(HARDCODED_WIDTH, 4);          // value 1920
  newPattern[8]  = 0x4c; // PushDup
  newPattern[9]  = 0x17; // Pop
  newPattern[10] = 0x4c; // PushDup
  newPattern[11] = 0x17; // Pop

  // Check already patched
  let off = body.indexOf(newPattern, dataStart);
  if (off >= 0 && off < dataEnd) {
    console.log('[mainbar] Already patched: hardcoded ' + HARDCODED_WIDTH + ' at 0x' + off.toString(16) + ' — skipping.');
    return;
  }

  off = body.indexOf(oldPattern, dataStart);
  if (off < 0 || off >= dataEnd) {
    throw new Error('Stage.width pattern not found in MainBar.update()');
  }

  console.log('[mainbar] Found Stage.width at body offset 0x' + off.toString(16));
  console.log('[mainbar] Patching to hardcoded int32(' + HARDCODED_WIDTH + ') + PushDup/Pop padding');

  newPattern.copy(body, off);

  const totalLen = writeSwf(OUT_PATH, sig, version, body);
  console.log('[mainbar] Wrote ' + OUT_PATH + ' (' + totalLen + ' bytes)');
}

patch();
