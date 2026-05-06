#!/usr/bin/env node
// Patches legacy/main.swf to widen the stage from 1024px to 1920px.
//
// 1) Replaces the RECT structure in the SWF body header (stage dimensions).
//    Original: 1024x768 (9 bytes), New: 1920x768 (10 bytes, needs 17-bit fields).
//    This shifts all subsequent body bytes by +1, but SWF tags are parsed
//    sequentially so no offset fixups are needed.
//
// 2) Patches baseMch from 1080 to 768 (int32 in a DoAction at the start).
//    baseMcw is already 1920 in the compiled SWF so it matches the new width.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const NEW_WIDTH  = 1920;
const STAGE_HEIGHT = 768;
const NEW_BASE_MCH = 768;

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

// --- RECT parsing / building ---

function parseRect(buf) {
  const nbits = (buf[0] >> 3) & 0x1F;
  const totalBits = 5 + 4 * nbits;
  const totalBytes = Math.ceil(totalBits / 8);

  let bits = 0n;
  for (let i = 0; i < totalBytes; i++) bits = (bits << 8n) | BigInt(buf[i]);

  let bitPos = BigInt(totalBytes * 8 - 5);
  function readSigned(n) {
    let val = 0n;
    for (let i = 0; i < n; i++) {
      val = (val << 1n) | ((bits >> (bitPos - 1n)) & 1n);
      bitPos--;
    }
    if (val & (1n << BigInt(n - 1))) val -= 1n << BigInt(n);
    return Number(val);
  }

  const xmin = readSigned(nbits);
  const xmax = readSigned(nbits);
  const ymin = readSigned(nbits);
  const ymax = readSigned(nbits);
  return { nbits, totalBytes, xmin, xmax, ymin, ymax };
}

function buildRect(xmin, xmax, ymin, ymax) {
  function bitsNeeded(v) {
    if (v === 0) return 1;
    const abs = Math.abs(v);
    return Math.floor(Math.log2(abs)) + 2; // +1 for magnitude, +1 for sign
  }
  const nbits = Math.max(bitsNeeded(xmin), bitsNeeded(xmax), bitsNeeded(ymin), bitsNeeded(ymax));
  const totalBits = 5 + 4 * nbits;
  const totalBytes = Math.ceil(totalBits / 8);

  let bits = 0n;
  let bitCount = 0;

  function writeBits(value, n) {
    for (let i = n - 1; i >= 0; i--) {
      bits = (bits << 1n) | BigInt((value >> i) & 1);
      bitCount++;
    }
  }

  writeBits(nbits, 5);
  writeBits(xmin, nbits);
  writeBits(xmax, nbits);
  writeBits(ymin, nbits);
  writeBits(ymax, nbits);

  // Pad to byte boundary
  const pad = (8 - (bitCount % 8)) % 8;
  bits = bits << BigInt(pad);
  bitCount += pad;

  const buf = Buffer.alloc(bitCount / 8);
  for (let i = 0; i < buf.length; i++) {
    buf[i] = Number((bits >> BigInt((buf.length - 1 - i) * 8)) & 0xFFn);
  }
  return { buf, nbits, totalBytes: buf.length };
}

// --- baseMch patch ---
// Pattern: Push CP[5]='baseMch' (96 02 00 08 05), Push i(1080) (96 05 00 07 38 04 00 00), SetVariable (1D)
// We only change the int32 value from 1080 to 768.

const BASEMCH_PATTERN = Buffer.from([
  0x96, 0x05, 0x00, 0x07, 0x38, 0x04, 0x00, 0x00, // Push i(1080)
  0x1D                                               // SetVariable
]);

function buildBaseMchPatch(value) {
  const buf = Buffer.alloc(9);
  buf[0] = 0x96;
  buf.writeUInt16LE(5, 1);
  buf[3] = 0x07;
  buf.writeInt32LE(value, 4);
  buf[8] = 0x1D;
  return buf;
}

function patch() {
  const { sig, version, body } = readSwf(IN_PATH);

  // --- Step 1: Patch the RECT ---
  const oldRect = parseRect(body);
  console.log(`[stage-width] Current stage: ${oldRect.xmax / 20}x${oldRect.ymax / 20} (RECT ${oldRect.totalBytes} bytes, nbits=${oldRect.nbits})`);

  const currentWidth = oldRect.xmax / 20;
  if (currentWidth === NEW_WIDTH) {
    console.log(`[stage-width] Stage already ${NEW_WIDTH}px wide — skipping RECT patch.`);
  } else {
    const newRect = buildRect(0, NEW_WIDTH * 20, 0, STAGE_HEIGHT * 20);
    console.log(`[stage-width] New RECT: ${NEW_WIDTH}x${STAGE_HEIGHT} (${newRect.totalBytes} bytes, nbits=${newRect.nbits})`);

    // Replace the old RECT bytes with the new ones
    const rest = body.slice(oldRect.totalBytes);
    const newBody = Buffer.concat([newRect.buf, rest]);

    // Copy newBody into a fresh buffer for further patching
    const result = Buffer.alloc(newBody.length);
    newBody.copy(result);

    console.log(`[stage-width] Body size: ${body.length} -> ${result.length} (+${result.length - body.length} byte)`);

    // --- Step 2: Patch baseMch ---
    const mchOffset = result.indexOf(BASEMCH_PATTERN);
    if (mchOffset >= 0) {
      const oldMch = result.readInt32LE(mchOffset + 4);
      if (oldMch === NEW_BASE_MCH) {
        console.log(`[stage-width] baseMch already ${NEW_BASE_MCH} — skipping.`);
      } else {
        const mchPatch = buildBaseMchPatch(NEW_BASE_MCH);
        mchPatch.copy(result, mchOffset);
        console.log(`[stage-width] Patched baseMch: ${oldMch} -> ${NEW_BASE_MCH}`);
      }
    } else {
      // Maybe already patched — check for i(768) pattern
      const patchedPattern = Buffer.alloc(9);
      patchedPattern[0] = 0x96;
      patchedPattern.writeUInt16LE(5, 1);
      patchedPattern[3] = 0x07;
      patchedPattern.writeInt32LE(NEW_BASE_MCH, 4);
      patchedPattern[8] = 0x1D;
      if (result.indexOf(patchedPattern) >= 0) {
        console.log(`[stage-width] baseMch already ${NEW_BASE_MCH} — skipping.`);
      } else {
        console.warn('[stage-width] WARNING: baseMch pattern not found — skipping.');
      }
    }

    const totalLen = writeSwf(OUT_PATH, sig, version, result);
    console.log(`[stage-width] Wrote ${OUT_PATH} (${totalLen} bytes)`);
    return;
  }

  // If RECT was already correct, still check baseMch
  const mchOffset = body.indexOf(BASEMCH_PATTERN);
  if (mchOffset >= 0) {
    const mchPatch = buildBaseMchPatch(NEW_BASE_MCH);
    mchPatch.copy(body, mchOffset);
    console.log(`[stage-width] Patched baseMch: 1080 -> ${NEW_BASE_MCH}`);
    const totalLen = writeSwf(OUT_PATH, sig, version, body);
    console.log(`[stage-width] Wrote ${OUT_PATH} (${totalLen} bytes)`);
  } else {
    console.log('[stage-width] Nothing to patch.');
  }
}

patch();
