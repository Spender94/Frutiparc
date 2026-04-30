#!/usr/bin/env node
// Patches famille*.swf files so they auto-call their internal `apply(s)`
// function at the end of the frame-1 DoAction. Injects INSIDE the existing
// DoAction body (before ActionEnd) so it shares the scope where `apply` was
// defined.
//
// Also injects a `String.prototype.decode62` shim — the original game defines
// decode62 in main.swf, but standalone famille SWFs need it locally. The shim
// looks up pre-computed values from FlashVars: _dec_XX → integer, where XX is
// the 2-char base62 input.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function buildInjection() {
  const parts = [];

  // --- Part 1: String.prototype.decode62 = function() { ... } ---
  //
  // In the SWF, decode62 is called as a CallMethod on a string:
  //   s.substring(2,4).decode62()
  // So we must add it to String.prototype.
  //
  // The shim function body (0 params, uses `this`):
  //   Push "_dec_"
  //   Push "this"
  //   GetVariable        → gets `this` (the string)
  //   ToString (0x4b)    → ensure primitive string
  //   Add2 (0x47)        → "_dec_" + this
  //   GetVariable        → _root["_dec_XX"]
  //   ToNumber (0x4a)    → convert string FlashVar to number
  //   Return (0x3e)

  const funcBody = Buffer.alloc(32);
  let fb = 0;
  // Push "_dec_"
  funcBody.writeUInt8(0x96, fb); fb++;
  funcBody.writeUInt16LE(7, fb); fb += 2;
  funcBody.writeUInt8(0x00, fb); fb++;
  funcBody.write('_dec_', fb, 'ascii'); fb += 5;
  funcBody.writeUInt8(0x00, fb); fb++;
  // Push "this"
  funcBody.writeUInt8(0x96, fb); fb++;
  funcBody.writeUInt16LE(6, fb); fb += 2;
  funcBody.writeUInt8(0x00, fb); fb++;
  funcBody.write('this', fb, 'ascii'); fb += 4;
  funcBody.writeUInt8(0x00, fb); fb++;
  // GetVariable
  funcBody.writeUInt8(0x1c, fb); fb++;
  // ToString
  funcBody.writeUInt8(0x4b, fb); fb++;
  // Add2
  funcBody.writeUInt8(0x47, fb); fb++;
  // GetVariable
  funcBody.writeUInt8(0x1c, fb); fb++;
  // ToNumber
  funcBody.writeUInt8(0x4a, fb); fb++;
  // Return
  funcBody.writeUInt8(0x3e, fb); fb++;
  const funcBodyBuf = funcBody.slice(0, fb);

  // Setup: Push "String" → GetVariable → Push "prototype" → GetMember
  //        → Push "decode62" → DefineFunction(anonymous) → SetMember
  const setup = Buffer.alloc(128);
  let si = 0;

  // Push "String"
  setup.writeUInt8(0x96, si); si++;
  setup.writeUInt16LE(8, si); si += 2;
  setup.writeUInt8(0x00, si); si++;
  setup.write('String', si, 'ascii'); si += 6;
  setup.writeUInt8(0x00, si); si++;
  // GetVariable
  setup.writeUInt8(0x1c, si); si++;
  // Push "prototype"
  setup.writeUInt8(0x96, si); si++;
  setup.writeUInt16LE(11, si); si += 2;
  setup.writeUInt8(0x00, si); si++;
  setup.write('prototype', si, 'ascii'); si += 9;
  setup.writeUInt8(0x00, si); si++;
  // GetMember
  setup.writeUInt8(0x4e, si); si++;
  // Push "decode62"
  setup.writeUInt8(0x96, si); si++;
  setup.writeUInt16LE(10, si); si += 2;
  setup.writeUInt8(0x00, si); si++;
  setup.write('decode62', si, 'ascii'); si += 8;
  setup.writeUInt8(0x00, si); si++;
  // DefineFunction "" (anonymous), 0 params
  setup.writeUInt8(0x9b, si); si++;
  const payloadLen = 1 + 2 + 2; // "\0" + numParams(2) + codeSize(2)
  setup.writeUInt16LE(payloadLen, si); si += 2;
  setup.writeUInt8(0x00, si); si++;   // empty name
  setup.writeUInt16LE(0, si); si += 2; // 0 params
  setup.writeUInt16LE(funcBodyBuf.length, si); si += 2;
  funcBodyBuf.copy(setup, si); si += funcBodyBuf.length;
  // SetMember
  setup.writeUInt8(0x4f, si); si++;

  parts.push(setup.slice(0, si));

  // --- Part 2: apply(_root.s) ---
  const callBuf = Buffer.alloc(32);
  let cb = 0;
  // Push "s"
  callBuf.writeUInt8(0x96, cb); cb++;
  callBuf.writeUInt16LE(3, cb); cb += 2;
  callBuf.writeUInt8(0x00, cb); cb++;
  callBuf.write('s', cb, 'ascii'); cb++;
  callBuf.writeUInt8(0x00, cb); cb++;
  // GetVariable → value of _root.s
  callBuf.writeUInt8(0x1c, cb); cb++;
  // Push int32 1 (nargs)
  callBuf.writeUInt8(0x96, cb); cb++;
  callBuf.writeUInt16LE(5, cb); cb += 2;
  callBuf.writeUInt8(0x07, cb); cb++;
  callBuf.writeUInt32LE(1, cb); cb += 4;
  // Push "apply"
  callBuf.writeUInt8(0x96, cb); cb++;
  callBuf.writeUInt16LE(7, cb); cb += 2;
  callBuf.writeUInt8(0x00, cb); cb++;
  callBuf.write('apply', cb, 'ascii'); cb += 5;
  callBuf.writeUInt8(0x00, cb); cb++;
  // CallFunction
  callBuf.writeUInt8(0x3d, cb); cb++;
  // Pop
  callBuf.writeUInt8(0x17, cb); cb++;
  parts.push(callBuf.slice(0, cb));

  return Buffer.concat(parts);
}

function patchSwf(inputPath, outputPath) {
  const buf = fs.readFileSync(inputPath);
  const sig = buf.slice(0, 3).toString('ascii');
  if (sig !== 'CWS' && sig !== 'FWS' && sig !== 'ZWS') {
    throw new Error(`Not a SWF: ${inputPath}`);
  }
  const version = buf[3];
  let body;
  if (sig === 'CWS') {
    body = zlib.inflateSync(buf.slice(8));
  } else if (sig === 'FWS') {
    body = buf.slice(8);
  } else {
    throw new Error('LZMA SWF (ZWS) not supported');
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
  const insertPos = bodyEnd - 1;

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
const outDir = path.resolve(__dirname, '..', 'public', 'fbouille_auto');
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
