#!/usr/bin/env node
// Patches famille*.swf files to be self-contained bouille renderers.
//
// Injects inside the existing DoAction body (before ActionEnd):
//   1. _global.generalPalette — 53-entry color palette array
//   2. _global.colorSet — color shade tables
//   3. FEMC class with setColor method
//   4. apply(_root.s) call
//
// IMPORTANT: Does NOT inject decode62 — the famille SWFs already define
// String.prototype.decode62 internally.

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
  // Batch multiple pushes into a single ActionPush
  const startOff = off;
  buf.writeUInt8(0x96, off); off++;
  const lenOff = off;
  off += 2; // placeholder for length
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

// ── Build injection bytecode ──────────────────────────────────────────
function buildInjection() {
  const buf = Buffer.alloc(16384); // generous allocation
  let off = 0;

  // ── 1. _global.generalPalette = [ {r:N, g:N, b:N}, ... ] ──
  off = pushString(buf, off, '_global');
  off = opcode(buf, off, 0x1c); // GetVariable

  off = pushString(buf, off, 'generalPalette');

  // Build each palette entry as InitObject
  for (const [r, g, b] of GENERAL_PALETTE) {
    off = pushMulti(buf, off, ['r', r, 'g', g, 'b', b, 3]);
    off = opcode(buf, off, 0x43); // InitObject
  }

  // InitArray with GENERAL_PALETTE.length entries
  off = pushInt(buf, off, GENERAL_PALETTE.length);
  off = opcode(buf, off, 0x42); // InitArray

  off = opcode(buf, off, 0x4f); // SetMember: _global.generalPalette = [...]

  // ── 2. _global.colorSet = { white:{...}, green:{...}, ... } ──
  off = pushString(buf, off, '_global');
  off = opcode(buf, off, 0x1c); // GetVariable

  off = pushString(buf, off, 'colorSet');

  const colorNames = Object.keys(COLOR_SET);
  for (const colorName of colorNames) {
    const shades = COLOR_SET[colorName];
    // Build shade object: {lightest:V, lighter:V, ..., int:9} → InitObject
    const items = [];
    for (let i = 0; i < SHADE_NAMES.length; i++) {
      items.push(SHADE_NAMES[i], shades[i]);
    }
    items.push(9); // property count
    off = pushMulti(buf, off, [colorName]);
    off = pushMulti(buf, off, items);
    off = opcode(buf, off, 0x43); // InitObject
  }

  off = pushInt(buf, off, colorNames.length);
  off = opcode(buf, off, 0x43); // InitObject (the outer colorSet)

  off = opcode(buf, off, 0x4f); // SetMember: _global.colorSet = {...}

  // ── 3. FEMC = { setColor: function(mc, colorObj) { ... } } ──
  //
  // _global.FEMC = {};
  off = pushString(buf, off, '_global');
  off = opcode(buf, off, 0x1c); // GetVariable
  off = pushMulti(buf, off, ['FEMC', 0]);
  off = opcode(buf, off, 0x43); // InitObject → {}
  off = opcode(buf, off, 0x4f); // SetMember

  // _global.FEMC.setColor = function(mc, colorObj) {
  //   var c = new Color(mc);
  //   c.setTransform({ra:0, ga:0, ba:0, rb:colorObj.r, gb:colorObj.g, bb:colorObj.b});
  // };
  off = pushString(buf, off, '_global');
  off = opcode(buf, off, 0x1c); // GetVariable
  off = pushString(buf, off, 'FEMC');
  off = opcode(buf, off, 0x4e); // GetMember → _global.FEMC

  off = pushString(buf, off, 'setColor');

  // DefineFunction2 "" (anonymous, 2 params: r1=mc, r2=colorObj)
  const funcHeaderOff = off;
  buf.writeUInt8(0x8e, off); off++;
  const funcLenOff = off;
  off += 2; // placeholder for header length
  const funcHeaderStart = off;

  buf.writeUInt8(0x00, off); off++; // empty name (anonymous)
  buf.writeUInt16LE(2, off); off += 2; // 2 params
  buf.writeUInt8(4, off); off++; // 4 registers
  buf.writeUInt16LE(0x00, off); off += 2; // flags: none (no preloads)

  // param 1: register 1 = "mc"
  buf.writeUInt8(1, off); off++;
  buf.write('mc', off, 'ascii'); off += 2;
  buf.writeUInt8(0x00, off); off++;

  // param 2: register 2 = "colorObj"
  buf.writeUInt8(2, off); off++;
  buf.write('colorObj', off, 'ascii'); off += 8;
  buf.writeUInt8(0x00, off); off++;

  const codeSizeOff = off;
  off += 2; // placeholder for code size

  buf.writeUInt16LE(off - funcHeaderStart, funcLenOff); // header length
  const funcBodyStart = off;

  // Function body:
  // Push reg1 (mc), int:1, "Color"
  buf.writeUInt8(0x96, off); off++;
  buf.writeUInt16LE(2 + 5 + 7, off); off += 2;
  buf.writeUInt8(0x04, off); off++; buf.writeUInt8(1, off); off++; // reg1
  buf.writeUInt8(0x07, off); off++; buf.writeInt32LE(1, off); off += 4; // int:1
  buf.writeUInt8(0x00, off); off++; buf.write('Color', off, 'ascii'); off += 5; buf.writeUInt8(0x00, off); off++; // "Color"
  // NewObject → new Color(mc)
  off = opcode(buf, off, 0x40);
  // StoreRegister r3
  buf.writeUInt8(0x87, off); off++;
  buf.writeUInt16LE(1, off); off += 2;
  buf.writeUInt8(3, off); off++;
  // Pop
  off = opcode(buf, off, 0x17);

  // Build transform object: {ra:0, ga:0, ba:0, rb:colorObj.r, gb:colorObj.g, bb:colorObj.b}
  // Push "ra", 0, "ga", 0, "ba", 0
  off = pushMulti(buf, off, ['ra', 0, 'ga', 0, 'ba', 0]);

  // Push "rb" then get colorObj.r
  off = pushString(buf, off, 'rb');
  // Push reg2 (colorObj), "r"
  buf.writeUInt8(0x96, off); off++;
  buf.writeUInt16LE(2 + 2, off); off += 2;
  buf.writeUInt8(0x04, off); off++; buf.writeUInt8(2, off); off++; // reg2
  buf.writeUInt8(0x00, off); off++; buf.write('r', off, 'ascii'); off++; buf.writeUInt8(0x00, off); off++; // "r"
  off = opcode(buf, off, 0x4e); // GetMember → colorObj.r

  // Push "gb" then get colorObj.g
  off = pushString(buf, off, 'gb');
  buf.writeUInt8(0x96, off); off++;
  buf.writeUInt16LE(2 + 2, off); off += 2;
  buf.writeUInt8(0x04, off); off++; buf.writeUInt8(2, off); off++; // reg2
  buf.writeUInt8(0x00, off); off++; buf.write('g', off, 'ascii'); off++; buf.writeUInt8(0x00, off); off++; // "g"
  off = opcode(buf, off, 0x4e); // GetMember → colorObj.g

  // Push "bb" then get colorObj.b
  off = pushString(buf, off, 'bb');
  buf.writeUInt8(0x96, off); off++;
  buf.writeUInt16LE(2 + 2, off); off += 2;
  buf.writeUInt8(0x04, off); off++; buf.writeUInt8(2, off); off++; // reg2
  buf.writeUInt8(0x00, off); off++; buf.write('b', off, 'ascii'); off++; buf.writeUInt8(0x00, off); off++; // "b"
  off = opcode(buf, off, 0x4e); // GetMember → colorObj.b

  // InitObject with 6 properties
  off = pushInt(buf, off, 6);
  off = opcode(buf, off, 0x43); // InitObject → {ra:0, ga:0, ba:0, rb:r, gb:g, bb:b}

  // CallMethod: r3.setTransform(transformObj)
  // Stack: [transformObj, int:1, r3, "setTransform"]
  buf.writeUInt8(0x96, off); off++;
  buf.writeUInt16LE(5 + 2, off); off += 2;
  buf.writeUInt8(0x07, off); off++; buf.writeInt32LE(1, off); off += 4; // int:1
  buf.writeUInt8(0x04, off); off++; buf.writeUInt8(3, off); off++; // reg3
  off = pushString(buf, off, 'setTransform');
  off = opcode(buf, off, 0x52); // CallMethod
  off = opcode(buf, off, 0x17); // Pop

  const funcBodyEnd = off;
  buf.writeUInt16LE(funcBodyEnd - funcBodyStart, codeSizeOff);

  off = opcode(buf, off, 0x4f); // SetMember: FEMC.setColor = function

  // ── 4. trace + gotoAndStop("end") + apply(_root.s) ──

  // trace("INJECT: s=" + _root.s)
  off = pushString(buf, off, 'INJECT: s=');
  off = pushString(buf, off, 's');
  off = opcode(buf, off, 0x1c); // GetVariable → _root.s
  off = opcode(buf, off, 0x47); // Add2 → "INJECT: s=" + s
  off = opcode(buf, off, 0x26); // Trace

  // _root.gotoAndStop("end")  — method call instead of ActionGoToLabel
  off = pushString(buf, off, 'end');    // arg: "end"
  off = pushInt(buf, off, 1);           // nargs: 1
  off = pushString(buf, off, '_root');
  off = opcode(buf, off, 0x1c);         // GetVariable → _root
  off = pushString(buf, off, 'gotoAndStop');
  off = opcode(buf, off, 0x52);         // CallMethod → _root.gotoAndStop("end")
  off = opcode(buf, off, 0x17);         // Pop

  // trace("INJECT: after gotoAndStop, _currentframe=" + _root._currentframe)
  off = pushString(buf, off, 'INJECT: frame=');
  off = pushString(buf, off, '_root');
  off = opcode(buf, off, 0x1c); // GetVariable
  off = pushString(buf, off, '_currentframe');
  off = opcode(buf, off, 0x4e); // GetMember
  off = opcode(buf, off, 0x47); // Add2
  off = opcode(buf, off, 0x26); // Trace

  // apply(_root.s)
  off = pushString(buf, off, 's');
  off = opcode(buf, off, 0x1c); // GetVariable → _root.s
  off = pushInt(buf, off, 1);     // 1 argument
  off = pushString(buf, off, 'apply');
  off = opcode(buf, off, 0x3d); // CallFunction
  off = opcode(buf, off, 0x17); // Pop

  // trace("INJECT: after apply, done")
  off = pushString(buf, off, 'INJECT: apply done');
  off = opcode(buf, off, 0x26); // Trace

  return buf.slice(0, off);
}

// ── SWF patching ──────────────────────────────────────────────────────
function patchSwf(inputPath, outputPath) {
  const buf = fs.readFileSync(inputPath);
  const sig = buf.slice(0, 3).toString('ascii');
  if (sig !== 'CWS' && sig !== 'FWS') {
    throw new Error(`Unsupported SWF format: ${sig}`);
  }
  const version = buf[3];
  let body;
  if (sig === 'CWS') {
    body = zlib.inflateSync(buf.slice(8));
  } else {
    body = buf.slice(8);
  }

  const nbits = (body[0] >> 3) & 0x1f;
  const rectBits = 5 + nbits * 4;
  const rectBytes = Math.ceil(rectBits / 8);
  let off = rectBytes + 4;

  let doActionOff = -1;
  let doActionHeaderSize = 0;
  let doActionBodyLen = 0;
  while (off < body.length) {
    const tagHeader = body.readUInt16LE(off);
    const tagCode = tagHeader >> 6;
    let tagLen = tagHeader & 0x3f;
    let headerSize = 2;
    if (tagLen === 0x3f) {
      tagLen = body.readUInt32LE(off + 2);
      headerSize = 6;
    }
    if (tagCode === 0) break;
    if (tagCode === 12) {
      doActionOff = off;
      doActionHeaderSize = headerSize;
      doActionBodyLen = tagLen;
      break;
    }
    off += headerSize + tagLen;
  }
  if (doActionOff < 0) {
    throw new Error(`No DoAction tag found in ${inputPath}`);
  }

  const bodyStart = doActionOff + doActionHeaderSize;
  const bodyEnd = bodyStart + doActionBodyLen;

  if (body[bodyEnd - 1] !== 0x00) {
    throw new Error(`DoAction body does not end with ActionEnd (0x00) in ${inputPath}`);
  }

  const injection = buildInjection();
  const insertPos = bodyEnd - 1; // before final ActionEnd

  const newBody = Buffer.concat([
    body.slice(0, insertPos),
    injection,
    body.slice(insertPos),
  ]);

  const newBodyLen = doActionBodyLen + injection.length;
  if (doActionHeaderSize === 6) {
    newBody.writeUInt32LE(newBodyLen, doActionOff + 2);
  } else {
    throw new Error(`Unexpected short-form DoAction in ${inputPath}`);
  }

  const newFileLen = 8 + newBody.length;
  const compressed = zlib.deflateSync(newBody);
  const out = Buffer.alloc(8 + compressed.length);
  out.write('CWS', 0, 'ascii');
  out.writeUInt8(version, 3);
  out.writeUInt32LE(newFileLen, 4);
  compressed.copy(out, 8);

  fs.writeFileSync(outputPath, out);
  return { insertedAt: insertPos, addedBytes: injection.length, newSize: out.length };
}

const inDir = path.resolve(__dirname, '..', 'public', 'fbouille');
const outDir = path.resolve(__dirname, '..', 'public', 'fbouille_patched');
fs.mkdirSync(outDir, { recursive: true });

const files = fs.readdirSync(inDir).filter(f => /^famille\d+\.swf$/.test(f));
for (const f of files) {
  try {
    const r = patchSwf(path.join(inDir, f), path.join(outDir, f));
    console.log(`patched ${f} -> ${path.join(outDir, f)} (inserted ${r.addedBytes} bytes at ${r.insertedAt}, new size ${r.newSize})`);
  } catch (e) {
    console.error(`SKIP ${f}: ${e.message}`);
  }
}
