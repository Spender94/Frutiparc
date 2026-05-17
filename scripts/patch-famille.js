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
//   DoInitAction (sprite 3, FEMC):     tag @8668,  body @8676,  len 5994
//   DoInitAction (sprite 4, MTNumber): tag @14721, body @14729, len 770
//   DoInitAction (sprite 5, FENumber): tag @15543, body @15551, len 1674
//   DoInitAction (sprite 6, FEObject): tag @17269, body @17277, len 693
function extractLoaderChunks(loaderPath) {
  const body = readSwfBody(loaderPath);
  // Main DoAction body: keep [137, 8539), then append End (0x00)
  const setupBytes = Buffer.concat([
    body.slice(137, 8539),
    Buffer.from([0x00])
  ]);
  // DoInitAction bytecodes (skip 6-byte tag header + 2-byte sprite ID = 8 bytes from tag start)
  const femcBytes     = body.slice(8676,  14670);
  const mtnumberBytes = body.slice(14729, 15501);
  const fenumberBytes = body.slice(15551, 17227);
  const feobjectBytes = body.slice(17277, 17972);
  return { setupBytes, femcBytes, mtnumberBytes, fenumberBytes, feobjectBytes };
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
  const buf = Buffer.alloc(256);
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

  // Only stop the root timeline so the SWF parks on the apply()'d frame.
  // Crucially we DO NOT recurse into child MovieClips here: the accessory
  // animations (santa hat tassel, sunglasses sparkle, etc.) live on their
  // own nested timelines and need to keep playing to look like they do in
  // main.swf. The earlier defensive `stopAll(_root)` froze every nested
  // MovieClip and was the reason animated accessories appeared static on
  // the forum avatars.
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

  // Build the new DoAction tags. Order matters: setup first (defines _global
  // utilities), then the engine classes (MTNumber → FENumber → FEObject →
  // FEMC), finally the apply() trampoline.
  const setupTag    = makeDoActionTag(loaderChunks.setupBytes);
  const mtnumberTag = makeDoActionTag(loaderChunks.mtnumberBytes);
  const fenumberTag = makeDoActionTag(loaderChunks.fenumberBytes);
  const feobjectTag = makeDoActionTag(loaderChunks.feobjectBytes);
  const femcTag     = makeDoActionTag(loaderChunks.femcBytes);
  const applyTag    = makeDoActionTag(buildApplyTag());

  const inserted = Buffer.concat([setupTag, mtnumberTag, fenumberTag, feobjectTag, femcTag, applyTag]);

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
  return {
    setupSize: setupTag.length,
    mtnumberSize: mtnumberTag.length,
    fenumberSize: fenumberTag.length,
    feobjectSize: feobjectTag.length,
    femcSize: femcTag.length,
    applySize: applyTag.length,
    newSize: out.length,
  };
}

// ── Main ─────────────────────────────────────────────────────────────
fs.mkdirSync(OUT_DIR, { recursive: true });
const loaderChunks = extractLoaderChunks(LOADER_PATH);
console.log(`Loader chunks: setup=${loaderChunks.setupBytes.length}B, mtnumber=${loaderChunks.mtnumberBytes.length}B, fenumber=${loaderChunks.fenumberBytes.length}B, feobject=${loaderChunks.feobjectBytes.length}B, femc=${loaderChunks.femcBytes.length}B`);

const files = fs.readdirSync(IN_DIR).filter(f => /^famille\d+\.swf$/.test(f));
for (const f of files) {
  try {
    const r = patchSwf(path.join(IN_DIR, f), path.join(OUT_DIR, f), loaderChunks);
    console.log(`  ${f}: setup=${r.setupSize} mt=${r.mtnumberSize} fenum=${r.fenumberSize} feo=${r.feobjectSize} femc=${r.femcSize} apply=${r.applySize} → ${r.newSize}B`);
  } catch (e) {
    console.error(`  SKIP ${f}: ${e.message}`);
  }
}
