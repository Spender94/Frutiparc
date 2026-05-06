#!/usr/bin/env node
// Patches the compiled init.as onResize function inside main.swf to:
//   1. Replace _global.mcw = 1024  with _global.mcw = NEW_MCW
//   2. Replace _global.mch = 768   with _global.mch = NEW_MCH (keeps 768)
//   3. Replace frusion.pos.x = 1019 with frusion.pos.x = NEW_FRUSION_X
//
// Background: the source init.as has dynamic expressions like
//   _global.mcw = Stage.width
//   main.frusion.pos.x = mcw - 5
// but the compiled SWF has constant-folded these to hardcoded 1024 and 1019,
// matching the original 1024x768 deployment. This onResize is called every
// time the stage resizes AND once on init, so it overrides any value set by
// first.as (or anyone else). The Frusion appears stuck at x=1019 regardless
// of baseMcw because of this.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Configurable values
const NEW_MCW = 1300;       // _global.mcw target
const NEW_MCH = 768;        // _global.mch target (unchanged)
const NEW_FRUSION_X = 1295; // frusion.pos.x target (rightmost element)

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

// Locate the init.as DoAction inside the main timeline sprite.
// Strategy: it's the largest top-level/sprite DoAction containing both
// 'frusion' and 'cornerX' strings (these are unique to init.as onResize).
function findInitAsAction(body) {
  const nbits = (body[0] >> 3) & 0x1f;
  const rectBytes = Math.ceil((5 + nbits * 4) / 8);
  let p = rectBytes + 4;

  let candidate = null;

  while (p < body.length) {
    const hdr = body.readUInt16LE(p);
    const code = hdr >> 6;
    let len = hdr & 0x3f;
    let hSize = 2;
    if (len === 0x3f) { len = body.readUInt32LE(p + 2); hSize = 6; }
    if (code === 0) break;

    if (code === 39) { // DefineSprite — descend
      const subStart = p + hSize + 4;
      const subEnd = p + hSize + len;
      let pp = subStart;
      while (pp < subEnd) {
        const sh = body.readUInt16LE(pp);
        const sc = sh >> 6;
        let sl = sh & 0x3f;
        let shs = 2;
        if (sl === 0x3f) { sl = body.readUInt32LE(pp + 2); shs = 6; }
        if (sc === 0) break;
        if (sc === 12 && sl > 50000) {
          // Look for cornerX + frusion strings in this DoAction
          const start = pp + shs;
          const end = pp + shs + sl;
          const cornerXBuf = Buffer.from('cornerX\0', 'ascii');
          const frusionBuf = Buffer.from('frusion\0', 'ascii');
          if (body.indexOf(cornerXBuf, start) > 0 && body.indexOf(cornerXBuf, start) < end &&
              body.indexOf(frusionBuf, start) > 0 && body.indexOf(frusionBuf, start) < end) {
            candidate = { start, end, len: sl };
            return candidate;
          }
        }
        pp += shs + sl;
      }
    }
    p += hSize + len;
  }
  return candidate;
}

function readCp(body, start, end) {
  let q = start;
  while (q < end - 4) {
    if (body[q] === 0x88) {
      const plen = body.readUInt16LE(q + 1);
      const count = body.readUInt16LE(q + 3);
      if (count > 100) {
        let strings = [];
        let r = q + 5;
        for (let i = 0; i < count; i++) {
          let e = r;
          while (body[e] !== 0 && e < q + 3 + plen) e++;
          strings.push(body.slice(r, e).toString('utf8'));
          r = e + 1;
        }
        return { offset: q, strings, payloadLen: plen, count };
      }
    }
    q++;
  }
  return null;
}

function pushCp16(idx) {
  return Buffer.from([0x96, 0x03, 0x00, 0x09, idx & 0xff, (idx >> 8) & 0xff]);
}

// Replace `Push CP[propIdx], Push int32(OLD_VAL), SetMember` with
//          `Push CP[propIdx], Push int32(NEW_VAL), SetMember`
function patchSetMember(body, searchStart, searchEnd, propIdx, oldVal, newVal, label) {
  // Pattern: Push CP16[propIdx] + Push i(oldVal) + SetMember
  const propPush = pushCp16(propIdx);
  const valBuf = Buffer.alloc(4); valBuf.writeInt32LE(oldVal, 0);
  const valPush = Buffer.from([0x96, 0x05, 0x00, 0x07, ...valBuf]);
  const sm = Buffer.from([0x4f]);
  const fullOld = Buffer.concat([propPush, valPush, sm]);

  const newValBuf = Buffer.alloc(4); newValBuf.writeInt32LE(newVal, 0);
  const fullNew = Buffer.concat([
    propPush,
    Buffer.from([0x96, 0x05, 0x00, 0x07, ...newValBuf]),
    sm
  ]);

  // Already patched check
  if (body.indexOf(fullNew, searchStart) >= 0 && body.indexOf(fullNew, searchStart) < searchEnd) {
    console.log('[' + label + '] Already patched (value=' + newVal + ') — skipping.');
    return;
  }

  let off = body.indexOf(fullOld, searchStart);
  if (off < 0 || off >= searchEnd) {
    throw new Error('[' + label + '] Pattern not found: Push CP[' + propIdx + '] + Push i(' + oldVal + ') + SetMember');
  }

  fullNew.copy(body, off);
  console.log('[' + label + '] Patched at 0x' + off.toString(16) + ': ' + oldVal + ' -> ' + newVal);
}

function patch() {
  const { sig, version, body } = readSwf(IN_PATH);

  const initAs = findInitAsAction(body);
  if (!initAs) throw new Error('init.as DoAction not found');
  console.log('Found init.as DoAction at 0x' + initAs.start.toString(16) + ' len=' + initAs.len);

  const cp = readCp(body, initAs.start, initAs.end);
  if (!cp) throw new Error('init.as ConstantPool not found');
  console.log('CP at 0x' + cp.offset.toString(16) + ' with ' + cp.count + ' entries');

  const mcwIdx = cp.strings.indexOf('mcw');
  const mchIdx = cp.strings.indexOf('mch');
  const xIdx = cp.strings.indexOf('x');
  if (mcwIdx < 0 || mchIdx < 0 || xIdx < 0) {
    throw new Error('Required CP entries not found: mcw=' + mcwIdx + ' mch=' + mchIdx + ' x=' + xIdx);
  }
  console.log('CP indices: mcw=' + mcwIdx + ' mch=' + mchIdx + ' x=' + xIdx);

  const dataStart = cp.offset + 3 + cp.payloadLen;
  const dataEnd = initAs.end;

  // Patch _global.mcw = 1024 -> NEW_MCW
  patchSetMember(body, dataStart, dataEnd, mcwIdx, 1024, NEW_MCW, 'init.as mcw');
  // Patch _global.mch = 768 -> NEW_MCH (no-op if same)
  if (NEW_MCH !== 768) {
    patchSetMember(body, dataStart, dataEnd, mchIdx, 768, NEW_MCH, 'init.as mch');
  } else {
    console.log('[init.as mch] keeping 768 (unchanged)');
  }
  // Patch frusion.pos.x = 1019 -> NEW_FRUSION_X
  patchSetMember(body, dataStart, dataEnd, xIdx, 1019, NEW_FRUSION_X, 'init.as frusion.pos.x');

  const totalLen = writeSwf(OUT_PATH, sig, version, body);
  console.log('Wrote ' + OUT_PATH + ' (' + totalLen + ' bytes)');
}

patch();
