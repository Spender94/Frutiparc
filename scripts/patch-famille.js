#!/usr/bin/env node
// Patches famille*.swf files by inserting NEW DoAction tags on frame 2.
//
// We can't reliably hand-roll the AVM1 bytecode for FEMC.setColor and the
// dozens of supporting structures (colorSet, generalPalette, penList,
// displayParameters, ...) — Flash's apply() routine reads many of them.
//
// Instead, we extract the COMPLETE bytecode from loader_bouille.swf:
//   - Main DoAction body (constant pool + all function defs + all _global
//     setup), truncated just before the `init()` call which would invoke
//     MovieClipLoader (broken in Ruffle).
//   - DoInitAction body for sprite 3 (defines FEMC.setColor and friends).
//
// We then add a third DoAction that calls apply(_root.s) + stop().

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const LOADER_PATH = path.resolve(__dirname, '..', 'public', 'loader_bouille.swf');
const IN_DIR = path.resolve(__dirname, '..', 'public', 'fbouille');
const OUT_DIR = path.resolve(__dirname, '..', 'public', 'fbouille_patched');

// ── Load and decompress loader_bouille.swf ───────────────────────────
function readSwfBody(filePath) {
  const raw = fs.readFileSync(filePath);
  const sig = raw.slice(0, 3).toString('ascii');
  if (sig === 'CWS') return zlib.inflateSync(raw.slice(8));
  if (sig === 'FWS') return Buffer.from(raw.slice(8));
  throw new Error(`Unsupported sig: ${sig}`);
}

// ── Extract loader chunks ────────────────────────────────────────────
// Verified offsets via tag-walker:
//   Main DoAction:    tag @131, hdr 6, body @137, len 8461
//                     init() call begins at body offset (8539-137)=8402
//   DoInitAction (sprite 3): tag @8668, hdr 6, sprite ID @8674, action body @8676, len 5994
function extractLoaderChunks(loaderPath) {
  const body = readSwfBody(loaderPath);
  // Main DoAction body: keep [137, 8539), then append End (0x00)
  const setupBytes = Buffer.concat([
    body.slice(137, 8539),
    Buffer.from([0x00])
  ]);
  // DoInitAction body: [8676, 14670) — already ends with End
  const femcBytes = body.slice(8676, 14670);
  return { setupBytes, femcBytes };
}

// ── Bytecode helpers for the apply() trampoline ─────────────────────
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
function opcode(buf, off, op) { buf.writeUInt8(op, off); return off + 1; }

function buildApplyTag() {
  const buf = Buffer.alloc(2048);
  let off = 0;
  // trace("INVOKE-APPLY")
  off = pushString(buf, off, 'INVOKE-APPLY');
  off = opcode(buf, off, 0x26);
  // apply(_root.s)
  off = pushString(buf, off, 's');
  off = opcode(buf, off, 0x1c);
  off = pushInt(buf, off, 1);
  off = pushString(buf, off, 'apply');
  off = opcode(buf, off, 0x3d);
  off = opcode(buf, off, 0x17);

  // Define _root.stopAll = function(mc) {
  //   mc.stop();
  //   for (var k in mc) {
  //     var c = mc[k];
  //     if (typeof c === "movieclip") stopAll(c);
  //   }
  // }
  // Push 'stopAll' name first so SetVariable binds it
  off = pushString(buf, off, 'stopAll');

  // DefineFunction2 with empty name (anonymous), 1 param "mc" in reg1
  buf.writeUInt8(0x8e, off); off++;
  const fnLenOff = off; off += 2;
  const fnHdrStart = off;
  buf.writeUInt8(0x00, off); off++; // empty name
  buf.writeUInt16LE(1, off); off += 2; // 1 param
  buf.writeUInt8(5, off); off++; // 5 registers (1=mc, 2=key, 3=child, 4=enum, 5=temp)
  buf.writeUInt16LE(0x00, off); off += 2; // flags = 0
  buf.writeUInt8(1, off); off++; // param register=1
  buf.write('mc', off, 'ascii'); off += 2;
  buf.writeUInt8(0x00, off); off++;
  const codeSizeOff = off; off += 2;
  buf.writeUInt16LE(off - fnHdrStart, fnLenOff);
  const fnBodyStart = off;

  // mc.stop()
  // Push i32:0 (arg count), reg:1 (mc), 'stop' (method name)
  buf.writeUInt8(0x96, off); off++;
  buf.writeUInt16LE(5 + 2 + 1 + 4 + 1, off); off += 2; // payload: i32(5)+reg(2)+str(1+4+1) = 13
  buf.writeUInt8(0x07, off); off++; buf.writeInt32LE(0, off); off += 4; // i32:0
  buf.writeUInt8(0x04, off); off++; buf.writeUInt8(1, off); off++; // reg:1
  buf.writeUInt8(0x00, off); off++; buf.write('stop', off, 'ascii'); off += 4; buf.writeUInt8(0x00, off); off++;
  off = opcode(buf, off, 0x52); // CallMethod
  off = opcode(buf, off, 0x17); // Pop

  // Push reg:1; Enumerate2 (0x55) — pushes children keys with terminator
  buf.writeUInt8(0x96, off); off++;
  buf.writeUInt16LE(2, off); off += 2;
  buf.writeUInt8(0x04, off); off++; buf.writeUInt8(1, off); off++;
  off = opcode(buf, off, 0x55); // Enumerate2

  // LOOP_START:
  const loopStart = off;
  // StoreRegister r2 (key); Pop
  buf.writeUInt8(0x87, off); off++; buf.writeUInt16LE(1, off); off += 2; buf.writeUInt8(2, off); off++;
  off = opcode(buf, off, 0x17); // Pop

  // if (r2 === undefined) jump LOOP_END
  // Push reg:2, undefined; StrictEquals; If LOOP_END
  buf.writeUInt8(0x96, off); off++;
  buf.writeUInt16LE(2 + 1, off); off += 2;
  buf.writeUInt8(0x04, off); off++; buf.writeUInt8(2, off); off++;
  buf.writeUInt8(0x03, off); off++; // undefined type
  off = opcode(buf, off, 0x66); // StrictEquals
  // If (jump if true) — placeholder offset
  buf.writeUInt8(0x9d, off); off++;
  buf.writeUInt16LE(2, off); off += 2;
  const ifEndJumpOffset = off;
  buf.writeInt16LE(0, off); off += 2; // placeholder

  // child = mc[key]
  buf.writeUInt8(0x96, off); off++;
  buf.writeUInt16LE(2 + 2, off); off += 2;
  buf.writeUInt8(0x04, off); off++; buf.writeUInt8(1, off); off++;
  buf.writeUInt8(0x04, off); off++; buf.writeUInt8(2, off); off++;
  off = opcode(buf, off, 0x4e); // GetMember
  buf.writeUInt8(0x87, off); off++; buf.writeUInt16LE(1, off); off += 2; buf.writeUInt8(3, off); off++;
  off = opcode(buf, off, 0x17); // Pop

  // if (typeof child !== "movieclip") jump LOOP_START
  buf.writeUInt8(0x96, off); off++;
  buf.writeUInt16LE(2, off); off += 2;
  buf.writeUInt8(0x04, off); off++; buf.writeUInt8(3, off); off++;
  off = opcode(buf, off, 0x44); // TypeOf
  buf.writeUInt8(0x96, off); off++;
  const movieclipStr = 'movieclip';
  buf.writeUInt16LE(1 + movieclipStr.length + 1, off); off += 2;
  buf.writeUInt8(0x00, off); off++; buf.write(movieclipStr, off, 'ascii'); off += movieclipStr.length; buf.writeUInt8(0x00, off); off++;
  off = opcode(buf, off, 0x49); // Equals2
  off = opcode(buf, off, 0x12); // Not
  // If (true=not movieclip → skip recursion) — placeholder
  buf.writeUInt8(0x9d, off); off++;
  buf.writeUInt16LE(2, off); off += 2;
  const ifSkipOffset = off;
  buf.writeInt16LE(0, off); off += 2; // placeholder

  // stopAll(child) — push reg:3, push 1 (arg count), push 'stopAll', CallFunction, Pop
  buf.writeUInt8(0x96, off); off++;
  buf.writeUInt16LE(2 + 5 + 1 + 7 + 1, off); off += 2;
  buf.writeUInt8(0x04, off); off++; buf.writeUInt8(3, off); off++; // reg:3
  buf.writeUInt8(0x07, off); off++; buf.writeInt32LE(1, off); off += 4; // i32:1
  buf.writeUInt8(0x00, off); off++; buf.write('stopAll', off, 'ascii'); off += 7; buf.writeUInt8(0x00, off); off++;
  off = opcode(buf, off, 0x3d); // CallFunction
  off = opcode(buf, off, 0x17); // Pop

  // SKIP_LABEL: jump to LOOP_START
  const skipLabel = off;
  buf.writeUInt8(0x99, off); off++;
  buf.writeUInt16LE(2, off); off += 2;
  buf.writeInt16LE(loopStart - (off + 2), off); off += 2; // jump back

  // LOOP_END:
  const loopEnd = off;
  // Patch the If offsets: they jump from end of If action to target
  // ifEndJumpOffset points to the offset bytes; after the If action ends (offset+2)
  buf.writeInt16LE(loopEnd - (ifEndJumpOffset + 2), ifEndJumpOffset);
  buf.writeInt16LE(skipLabel - (ifSkipOffset + 2), ifSkipOffset);

  // End of function body
  off = opcode(buf, off, 0x00);
  buf.writeUInt16LE(off - fnBodyStart, codeSizeOff);

  // SetVariable: pops value (function) + name ('stopAll') from stack
  off = opcode(buf, off, 0x1d); // SetVariable

  // Now call stopAll(_root)
  off = pushString(buf, off, '_root');
  off = opcode(buf, off, 0x1c); // GetVariable
  off = pushInt(buf, off, 1);
  off = pushString(buf, off, 'stopAll');
  off = opcode(buf, off, 0x3d); // CallFunction
  off = opcode(buf, off, 0x17); // Pop

  // stop()
  off = opcode(buf, off, 0x07);
  // trace("APPLY-DONE")
  off = pushString(buf, off, 'APPLY-DONE');
  off = opcode(buf, off, 0x26);
  off = opcode(buf, off, 0x00); // End
  return buf.slice(0, off);
}

// ── Wrap raw action body into a DoAction tag ─────────────────────────
function makeDoActionTag(body) {
  // Long-form tag header: code=12, length as UI32
  const tag = Buffer.alloc(6 + body.length);
  tag.writeUInt16LE((12 << 6) | 0x3f, 0);
  tag.writeUInt32LE(body.length, 2);
  body.copy(tag, 6);
  return tag;
}

// ── Patch one famille SWF ────────────────────────────────────────────
function patchSwf(inputPath, outputPath, loaderChunks) {
  const buf = fs.readFileSync(inputPath);
  const sig = buf.slice(0, 3).toString('ascii');
  if (sig !== 'CWS' && sig !== 'FWS') throw new Error(`Unsupported: ${sig}`);
  const version = buf[3];
  let body = sig === 'CWS' ? zlib.inflateSync(buf.slice(8)) : Buffer.from(buf.slice(8));

  const nbits = (body[0] >> 3) & 0x1f;
  const rectBytes = Math.ceil((5 + nbits * 4) / 8);
  let off = rectBytes + 4;

  // Walk tags: find first DoAction (frame 1) and last ShowFrame.
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
    throw new Error(`No ShowFrame in ${inputPath}`);
  }

  // For 2-frame SWFs: NOP the trailing stop() at end of frame 1 so
  // the SWF naturally advances to frame 2 (where our injection lives).
  if (showFrameCount >= 2 && firstDoActionOff >= 0) {
    const actionStart = firstDoActionOff + firstDoActionHeaderSize;
    const actionEnd = actionStart + firstDoActionLen;
    let pos = actionStart;
    let lastStopPos = -1;
    while (pos < actionEnd) {
      const op = body[pos];
      if (op === 0x00) break;
      if (op === 0x07) lastStopPos = pos;
      if (op >= 0x80) {
        const len = body.readUInt16LE(pos + 1);
        if (op === 0x8e) {
          let fpos = pos + 3;
          while (body[fpos] !== 0) fpos++; fpos++;
          const numParams = body.readUInt16LE(fpos); fpos += 2;
          fpos++; fpos += 2;
          for (let p = 0; p < numParams; p++) {
            fpos++;
            while (body[fpos] !== 0) fpos++; fpos++;
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
      body[lastStopPos] = 0x08; // ToggleQuality (harmless 1-byte action)
    }
  }

  // Build the three new DoAction tags
  const setupTag = makeDoActionTag(loaderChunks.setupBytes);
  const femcTag = makeDoActionTag(loaderChunks.femcBytes);
  const applyTag = makeDoActionTag(buildApplyTag());

  const inserted = Buffer.concat([setupTag, femcTag, applyTag]);

  const newBody = Buffer.concat([
    body.slice(0, lastShowFrameOff),
    inserted,
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
  return { setupSize: setupTag.length, femcSize: femcTag.length, applySize: applyTag.length, newSize: out.length };
}

// ── Main ─────────────────────────────────────────────────────────────
fs.mkdirSync(OUT_DIR, { recursive: true });
const loaderChunks = extractLoaderChunks(LOADER_PATH);
console.log(`Loader chunks: setup=${loaderChunks.setupBytes.length}B, femc=${loaderChunks.femcBytes.length}B`);

const files = fs.readdirSync(IN_DIR).filter(f => /^famille\d+\.swf$/.test(f));
for (const f of files) {
  try {
    const r = patchSwf(path.join(IN_DIR, f), path.join(OUT_DIR, f), loaderChunks);
    console.log(`  ${f}: setup=${r.setupSize} femc=${r.femcSize} apply=${r.applySize} → ${r.newSize}B`);
  } catch (e) {
    console.error(`  SKIP ${f}: ${e.message}`);
  }
}
