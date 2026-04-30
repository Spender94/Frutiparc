#!/usr/bin/env node
// Patches famille*.swf files by inserting a NEW DoAction tag on frame 2
// (labeled "end") that calls apply(_root.s) + stop().
//
// The famille SWFs have 2 frames:
//   Frame 1: placeholder + function definitions (apply, decode62, etc.)
//   Frame 2: real bouille content (labeled "end")
//
// Instead of trying to gotoAndStop("end") from frame 1 (which Ruffle
// doesn't support mid-script), we let the SWF play naturally to frame 2
// and execute apply(s) there.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ── Palette data (from loader_bouille.swf) ────────────────────────────
const GENERAL_PALETTE = [
  [255,245,245],[50,155,155],[55,190,180],[96,142,189],[117,158,198],[147,179,210],
  [113,167,112],[143,185,142],[169,202,168],[162,152,104],[185,177,142],[205,200,172],
  [110,125,150],[150,160,180],[173,183,197],[253,140,183],[254,171,197],[255,200,217],
  [200,100,9],[230,120,10],[250,160,50],[215,183,9],[230,200,10],[250,225,60],
  [95,55,150],[121,61,182],[150,100,200],[50,105,175],[80,130,210],[110,160,225],
  [190,30,30],[210,55,55],[220,85,85],[230,125,125],[110,170,20],[120,185,25],
  [130,200,32],[150,215,55],[180,230,125],[210,185,80],[220,200,115],[230,215,150],
  [75,48,20],[108,68,30],[138,87,37],[160,100,45],[200,100,40],[215,125,60],
  [230,155,80],[250,180,164],[251,200,190],[252,220,216],[255,231,206]
];

const COLOR_SET = {
  white:  [16777215,16777215,16777215,16777215,14540253,11184810,8947848,4473924,2236962],
  green:  [16777215,15990741,14548923,13432217,11396971,9755449,6728226,5605393,3364113],
  pink:   [16777215,16773874,16703712,16697801,16690091,15168885,12272708,8726825,5246992],
  yellow: [16777215,16711372,16579737,16316518,15395343,13289997,10395146,5921280,4210688],
  orange: [16777215,16708314,16640701,16504968,16436840,16299075,14458384,8807690,4403205],
  purple: [16777215,15523565,14403299,13678044,12558033,10910145,9328051,7224461,4399955],
  brown:  [16777215,16642280,16441293,16307644,15974028,15111771,14254161,12146483,7752244]
};

const SHADE_NAMES = ['lightest','lighter','light','main','shade','dark','darker','darkest','overdark'];

// ── Bytecode helpers ──────────────────────────────────────────────────
function pushString(buf, off, s) {
  buf.writeUInt8(0x96, off); off++;
  buf.writeUInt16LE(s.length + 2, off); off += 2;
  buf.writeUInt8(0x00, off); off++;
  buf.write(s, off, 'ascii'); off += s.length;
  buf.writeUInt8(0x00, off); off++;
  return off;
}

function pushInt(buf, off, n) {
  buf.writeUInt8(0x96, off); off++;
  buf.writeUInt16LE(5, off); off += 2;
  buf.writeUInt8(0x07, off); off++;
  buf.writeInt32LE(n, off); off += 4;
  return off;
}

function pushMulti(buf, off, items) {
  buf.writeUInt8(0x96, off); off++;
  const lenOff = off;
  off += 2;
  const payloadStart = off;
  for (const item of items) {
    if (typeof item === 'string') {
      buf.writeUInt8(0x00, off); off++;
      buf.write(item, off, 'ascii'); off += item.length;
      buf.writeUInt8(0x00, off); off++;
    } else if (typeof item === 'number' && Number.isInteger(item)) {
      buf.writeUInt8(0x07, off); off++;
      buf.writeInt32LE(item, off); off += 4;
    }
  }
  buf.writeUInt16LE(off - payloadStart, lenOff);
  return off;
}

function opcode(buf, off, op) {
  buf.writeUInt8(op, off);
  return off + 1;
}

// ── Build the frame-2 DoAction body ───────────────────────────────────
function buildFrame2Action() {
  const buf = Buffer.alloc(16384);
  let off = 0;

  // trace("F2-INJECT-START")
  off = pushString(buf, off, 'F2-INJECT-START');
  off = opcode(buf, off, 0x26); // Trace

  // ── 1. _global.generalPalette ──
  off = pushString(buf, off, '_global');
  off = opcode(buf, off, 0x1c); // GetVariable
  off = pushString(buf, off, 'generalPalette');
  for (const [r, g, b] of GENERAL_PALETTE) {
    off = pushMulti(buf, off, ['r', r, 'g', g, 'b', b, 3]);
    off = opcode(buf, off, 0x43); // InitObject
  }
  off = pushInt(buf, off, GENERAL_PALETTE.length);
  off = opcode(buf, off, 0x42); // InitArray
  off = opcode(buf, off, 0x4f); // SetMember

  // ── 2. _global.colorSet ──
  off = pushString(buf, off, '_global');
  off = opcode(buf, off, 0x1c);
  off = pushString(buf, off, 'colorSet');
  const colorNames = Object.keys(COLOR_SET);
  for (const colorName of colorNames) {
    const shades = COLOR_SET[colorName];
    const items = [];
    for (let i = 0; i < SHADE_NAMES.length; i++) {
      items.push(SHADE_NAMES[i], shades[i]);
    }
    items.push(9);
    off = pushMulti(buf, off, [colorName]);
    off = pushMulti(buf, off, items);
    off = opcode(buf, off, 0x43); // InitObject
  }
  off = pushInt(buf, off, colorNames.length);
  off = opcode(buf, off, 0x43); // InitObject
  off = opcode(buf, off, 0x4f); // SetMember

  // ── 3. FEMC.setColor ──
  off = pushString(buf, off, '_global');
  off = opcode(buf, off, 0x1c);
  off = pushMulti(buf, off, ['FEMC', 0]);
  off = opcode(buf, off, 0x43); // InitObject → {}
  off = opcode(buf, off, 0x4f); // SetMember: _global.FEMC = {}

  off = pushString(buf, off, '_global');
  off = opcode(buf, off, 0x1c);
  off = pushString(buf, off, 'FEMC');
  off = opcode(buf, off, 0x4e); // GetMember → _global.FEMC
  off = pushString(buf, off, 'setColor');

  // DefineFunction2 ""(r1:mc, r2:colorObj) { new Color(mc).setTransform({...}) }
  const funcHeaderOff = off;
  buf.writeUInt8(0x8e, off); off++;
  const funcLenOff = off; off += 2;
  const funcHeaderStart = off;
  buf.writeUInt8(0x00, off); off++; // empty name
  buf.writeUInt16LE(2, off); off += 2; // 2 params
  buf.writeUInt8(4, off); off++; // 4 registers
  buf.writeUInt16LE(0x00, off); off += 2; // flags
  buf.writeUInt8(1, off); off++; buf.write('mc', off, 'ascii'); off += 2; buf.writeUInt8(0x00, off); off++;
  buf.writeUInt8(2, off); off++; buf.write('colorObj', off, 'ascii'); off += 8; buf.writeUInt8(0x00, off); off++;
  const codeSizeOff = off; off += 2;
  buf.writeUInt16LE(off - funcHeaderStart, funcLenOff);
  const funcBodyStart = off;

  // new Color(mc) → r3
  buf.writeUInt8(0x96, off); off++;
  buf.writeUInt16LE(2 + 5 + 7, off); off += 2;
  buf.writeUInt8(0x04, off); off++; buf.writeUInt8(1, off); off++; // reg1 (mc)
  buf.writeUInt8(0x07, off); off++; buf.writeInt32LE(1, off); off += 4; // int:1
  buf.writeUInt8(0x00, off); off++; buf.write('Color', off, 'ascii'); off += 5; buf.writeUInt8(0x00, off); off++;
  off = opcode(buf, off, 0x40); // NewObject
  buf.writeUInt8(0x87, off); off++; buf.writeUInt16LE(1, off); off += 2; buf.writeUInt8(3, off); off++; // StoreRegister r3
  off = opcode(buf, off, 0x17); // Pop

  // Build {ra:0, ga:0, ba:0, rb:colorObj.r, gb:colorObj.g, bb:colorObj.b}
  off = pushMulti(buf, off, ['ra', 0, 'ga', 0, 'ba', 0]);
  off = pushString(buf, off, 'rb');
  buf.writeUInt8(0x96, off); off++; buf.writeUInt16LE(4, off); off += 2;
  buf.writeUInt8(0x04, off); off++; buf.writeUInt8(2, off); off++;
  buf.writeUInt8(0x00, off); off++; buf.write('r', off, 'ascii'); off++; buf.writeUInt8(0x00, off); off++;
  off = opcode(buf, off, 0x4e); // GetMember
  off = pushString(buf, off, 'gb');
  buf.writeUInt8(0x96, off); off++; buf.writeUInt16LE(4, off); off += 2;
  buf.writeUInt8(0x04, off); off++; buf.writeUInt8(2, off); off++;
  buf.writeUInt8(0x00, off); off++; buf.write('g', off, 'ascii'); off++; buf.writeUInt8(0x00, off); off++;
  off = opcode(buf, off, 0x4e);
  off = pushString(buf, off, 'bb');
  buf.writeUInt8(0x96, off); off++; buf.writeUInt16LE(4, off); off += 2;
  buf.writeUInt8(0x04, off); off++; buf.writeUInt8(2, off); off++;
  buf.writeUInt8(0x00, off); off++; buf.write('b', off, 'ascii'); off++; buf.writeUInt8(0x00, off); off++;
  off = opcode(buf, off, 0x4e);
  off = pushInt(buf, off, 6);
  off = opcode(buf, off, 0x43); // InitObject

  // r3.setTransform(obj)
  buf.writeUInt8(0x96, off); off++; buf.writeUInt16LE(7, off); off += 2;
  buf.writeUInt8(0x07, off); off++; buf.writeInt32LE(1, off); off += 4; // int:1
  buf.writeUInt8(0x04, off); off++; buf.writeUInt8(3, off); off++; // reg3
  off = pushString(buf, off, 'setTransform');
  off = opcode(buf, off, 0x52); // CallMethod
  off = opcode(buf, off, 0x17); // Pop

  buf.writeUInt16LE(off - funcBodyStart, codeSizeOff);
  off = opcode(buf, off, 0x4f); // SetMember: FEMC.setColor = func

  // ── 4. apply(s) ──
  off = pushString(buf, off, 's');
  off = opcode(buf, off, 0x1c); // GetVariable → _root.s
  off = pushInt(buf, off, 1);
  off = pushString(buf, off, 'apply');
  off = opcode(buf, off, 0x3d); // CallFunction
  off = opcode(buf, off, 0x17); // Pop

  // ── 5. stop() ──
  off = opcode(buf, off, 0x07); // ActionStop

  // trace("F2-INJECT-DONE")
  off = pushString(buf, off, 'F2-INJECT-DONE');
  off = opcode(buf, off, 0x26); // Trace

  // ActionEnd
  off = opcode(buf, off, 0x00);

  return buf.slice(0, off);
}

// ── SWF patching (insert DoAction on frame 2) ────────────────────────
function patchSwf(inputPath, outputPath) {
  const buf = fs.readFileSync(inputPath);
  const sig = buf.slice(0, 3).toString('ascii');
  if (sig !== 'CWS' && sig !== 'FWS') throw new Error(`Unsupported: ${sig}`);
  const version = buf[3];
  let body = sig === 'CWS' ? zlib.inflateSync(buf.slice(8)) : Buffer.from(buf.slice(8));

  const nbits = (body[0] >> 3) & 0x1f;
  const rectBytes = Math.ceil((5 + nbits * 4) / 8);
  let off = rectBytes + 4;

  // Find DoAction tags and ShowFrame tags
  let firstDoActionOff = -1;
  let firstDoActionHeaderSize = 0;
  let firstDoActionLen = 0;
  let lastShowFrameOff = -1;
  let showFrameCount = 0;
  while (off < body.length) {
    const tagHeader = body.readUInt16LE(off);
    const tagCode = tagHeader >> 6;
    let tagLen = tagHeader & 0x3f;
    let headerSize = 2;
    if (tagLen === 0x3f) { tagLen = body.readUInt32LE(off + 2); headerSize = 6; }
    if (tagCode === 0) break;
    if (tagCode === 12 && firstDoActionOff < 0) {
      firstDoActionOff = off;
      firstDoActionHeaderSize = headerSize;
      firstDoActionLen = tagLen;
    }
    if (tagCode === 1) {
      showFrameCount++;
      lastShowFrameOff = off;
    }
    off += headerSize + tagLen;
  }

  if (showFrameCount < 1 || lastShowFrameOff < 0) {
    throw new Error(`Expected 1+ ShowFrames, found ${showFrameCount} in ${inputPath}`);
  }

  // For 2-frame SWFs: NOP out the stop() at end of frame 1's DoAction
  // so the SWF plays through to frame 2 where our injection lives
  if (showFrameCount >= 2 && firstDoActionOff >= 0) {
    const actionStart = firstDoActionOff + firstDoActionHeaderSize;
    const actionEnd = actionStart + firstDoActionLen;
    // Walk backwards from End (0x00) to find the stop (0x07)
    // Parse forward to find the last top-level stop
    let pos = actionStart;
    let lastStopPos = -1;
    while (pos < actionEnd) {
      const op = body[pos];
      if (op === 0x00) break;
      if (op === 0x07) lastStopPos = pos;
      if (op >= 0x80) {
        const len = body.readUInt16LE(pos + 1);
        if (op === 0x8e) {
          // DefineFunction2: skip header + body
          let fpos = pos + 3;
          while (body[fpos] !== 0) fpos++;
          fpos++;
          const numParams = body.readUInt16LE(fpos); fpos += 2;
          fpos++; fpos += 2;
          for (let p = 0; p < numParams; p++) {
            fpos++;
            while (body[fpos] !== 0) fpos++;
            fpos++;
          }
          const codeSize = body.readUInt16LE(fpos); fpos += 2;
          pos = fpos + codeSize;
        } else {
          pos += 3 + len;
        }
      } else {
        pos++;
      }
    }
    if (lastStopPos >= 0) {
      // Replace stop() with ActionPush undefined + Pop (a 3-byte NOP equivalent)
      // Actually simplest: just overwrite 0x07 with 0x17 (Pop with empty stack is harmless?
      // No — safest: replace with 0x00... but that would be End.
      // Simplest safe NOP: ActionToggleQuality (0x08) — a harmless 1-byte action
      body[lastStopPos] = 0x08;
      console.log(`  ${path.basename(inputPath)}: NOP'd stop() at bytecode offset ${lastStopPos}`);
    }
  }

  console.log(`  ${path.basename(inputPath)}: inserting DoAction before ShowFrame #${showFrameCount} at ${lastShowFrameOff}`);

  // Build the DoAction tag to insert
  const actionBody = buildFrame2Action();
  const doActionTag = Buffer.alloc(6 + actionBody.length);
  // Long-form tag header: code=12, length as UI32
  doActionTag.writeUInt16LE((12 << 6) | 0x3f, 0);
  doActionTag.writeUInt32LE(actionBody.length, 2);
  actionBody.copy(doActionTag, 6);

  // Insert before the last ShowFrame
  const newBody = Buffer.concat([
    body.slice(0, lastShowFrameOff),
    doActionTag,
    body.slice(lastShowFrameOff)
  ]);

  const newFileLen = 8 + newBody.length;
  const compressed = zlib.deflateSync(newBody);
  const out = Buffer.alloc(8 + compressed.length);
  out.write('CWS', 0, 'ascii');
  out.writeUInt8(version, 3);
  out.writeUInt32LE(newFileLen, 4);
  compressed.copy(out, 8);

  fs.writeFileSync(outputPath, out);
  return { tagSize: doActionTag.length, newSize: out.length };
}

const inDir = path.resolve(__dirname, '..', 'public', 'fbouille');
const outDir = path.resolve(__dirname, '..', 'public', 'fbouille_patched');
fs.mkdirSync(outDir, { recursive: true });

const files = fs.readdirSync(inDir).filter(f => /^famille\d+\.swf$/.test(f));
for (const f of files) {
  try {
    const r = patchSwf(path.join(inDir, f), path.join(outDir, f));
    console.log(`  patched → ${f} (DoAction tag ${r.tagSize} bytes, total ${r.newSize})`);
  } catch (e) {
    console.error(`  SKIP ${f}: ${e.message}`);
  }
}
