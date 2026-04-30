#!/usr/bin/env node
// Patches famille*.swf files so they auto-call their internal `apply(_root.s)`
// function on frame 1. This makes the bouille customise itself based on the
// FlashVars state when loaded standalone (instead of just showing the base
// character defined by Frutibouille in main.swf).

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// AVM1 bytecode that pushes _root.s onto the stack, calls apply(s), pops the
// (undefined) return value, then ends.
//
// Sequence:
//   ActionPush "s" (string inline)
//   ActionGetVariable          -> pushes value of _root.s
//   ActionPush 1 (int32)       -> arg count
//   ActionPush "apply" (string)-> function name
//   ActionCallFunction
//   ActionPop
//   ActionEnd
function buildApplyCall() {
  const buf = Buffer.alloc(64);
  let off = 0;
  // ActionPush "s\0"  (opcode 0x96, len 3)
  buf.writeUInt8(0x96, off); off++;
  buf.writeUInt16LE(3, off); off += 2;
  buf.writeUInt8(0x00, off); off++;        // type 0 = string
  buf.write('s', off, 'ascii'); off++;
  buf.writeUInt8(0x00, off); off++;        // null terminator
  // ActionGetVariable (opcode 0x1c, no payload)
  buf.writeUInt8(0x1c, off); off++;
  // ActionPush int32 1 (opcode 0x96, len 5)
  buf.writeUInt8(0x96, off); off++;
  buf.writeUInt16LE(5, off); off += 2;
  buf.writeUInt8(0x07, off); off++;        // type 7 = int32
  buf.writeUInt32LE(1, off); off += 4;
  // ActionPush "apply\0"  (opcode 0x96, len 7)
  buf.writeUInt8(0x96, off); off++;
  buf.writeUInt16LE(7, off); off += 2;
  buf.writeUInt8(0x00, off); off++;        // type 0 = string
  buf.write('apply', off, 'ascii'); off += 5;
  buf.writeUInt8(0x00, off); off++;
  // ActionCallFunction (opcode 0x3d)
  buf.writeUInt8(0x3d, off); off++;
  // ActionPop (opcode 0x17)
  buf.writeUInt8(0x17, off); off++;
  // ActionEnd (opcode 0x00)
  buf.writeUInt8(0x00, off); off++;
  return buf.slice(0, off);
}

function buildDoActionTag(actionBytes) {
  const tagCode = 12; // DoAction
  const len = actionBytes.length;
  if (len < 0x3f) {
    const out = Buffer.alloc(2 + len);
    out.writeUInt16LE((tagCode << 6) | len, 0);
    actionBytes.copy(out, 2);
    return out;
  }
  // Long form
  const out = Buffer.alloc(2 + 4 + len);
  out.writeUInt16LE((tagCode << 6) | 0x3f, 0);
  out.writeUInt32LE(len, 2);
  actionBytes.copy(out, 6);
  return out;
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

  // Skip RECT
  const nbits = (body[0] >> 3) & 0x1f;
  const rectBits = 5 + nbits * 4;
  const rectBytes = Math.ceil(rectBits / 8);
  let off = rectBytes + 4; // + frameRate(2) + frameCount(2)

  // Find first DoAction (tag 12) and inject our call right AFTER it.
  // We insert as a separate tag so we don't have to recompute the original
  // tag's length encoding.
  let injectAt = -1;
  while (off < body.length) {
    const tagHeader = body.readUInt16LE(off);
    const tagCode = tagHeader >> 6;
    let tagLen = tagHeader & 0x3f;
    let headerSize = 2;
    if (tagLen === 0x3f) {
      tagLen = body.readUInt32LE(off + 2);
      headerSize = 6;
    }
    if (tagCode === 0) break; // End tag
    if (tagCode === 12) {
      // Inject right AFTER this DoAction tag
      injectAt = off + headerSize + tagLen;
      break;
    }
    off += headerSize + tagLen;
  }
  if (injectAt < 0) {
    throw new Error(`No DoAction tag found in ${inputPath}`);
  }

  const callBytes = buildApplyCall();
  const newTag = buildDoActionTag(callBytes);

  const newBody = Buffer.concat([
    body.slice(0, injectAt),
    newTag,
    body.slice(injectAt),
  ]);

  // Reassemble SWF (CWS — compressed)
  const newFileLen = 8 + newBody.length;
  const compressed = zlib.deflateSync(newBody);
  const out = Buffer.alloc(8 + compressed.length);
  out.write('CWS', 0, 'ascii');
  out.writeUInt8(version, 3);
  out.writeUInt32LE(newFileLen, 4);
  compressed.copy(out, 8);

  fs.writeFileSync(outputPath, out);
  return { tagInjectedAt: injectAt, addedBytes: newTag.length, newSize: out.length };
}

// CLI
const inDir = path.resolve(__dirname, '..', 'public', 'fbouille');
const outDir = path.resolve(__dirname, '..', 'public', 'fbouille_auto');
fs.mkdirSync(outDir, { recursive: true });

const files = fs.readdirSync(inDir).filter(f => /^famille\d+\.swf$/.test(f));
for (const f of files) {
  try {
    const r = patchSwf(path.join(inDir, f), path.join(outDir, f));
    console.log(`patched ${f} -> ${path.join(outDir, f)} (added ${r.addedBytes} bytes, new size ${r.newSize})`);
  } catch (e) {
    console.error(`SKIP ${f}: ${e.message}`);
  }
}
