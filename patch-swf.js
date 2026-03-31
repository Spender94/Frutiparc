#!/usr/bin/env node
/**
 * Patch main.swf to replace the hardcoded beta domain with localhost:8888.
 *
 * SWF format (CWS = zlib-compressed):
 *   Bytes 0-2: Signature ("CWS")
 *   Byte  3:   Version
 *   Bytes 4-7: Uncompressed length (uint32 LE)
 *   Bytes 8+:  zlib-compressed body
 *
 * Inside the decompressed body, ActionScript 2 constant pools store
 * null-terminated strings. We replace the domain strings in-place,
 * keeping the same byte length by padding shorter replacements with
 * extra null bytes (which just become empty strings in the pool —
 * harmless since they're never referenced).
 */

const fs = require('fs');
const zlib = require('zlib');

const SRC = 'legacy/main.swf';
const DST = 'legacy/main.swf';
const BACKUP = 'legacy/main.swf.original';

// What to replace
const patches = [
  { from: 'www.beta.frutiparc.com', to: 'localhost:8888' },
  { from: 'swf.beta.frutiparc.com', to: 'localhost:8888' },
  { from: 'swf.frutiparc.com', to: 'localhost:8888' },
];

// Padding character — must NOT be 0x00 (null) because null bytes
// act as string terminators in AVM1 ConstantPool actions.  Using
// 0x00 creates phantom empty strings that shift all constant pool
// indices, causing "Length mismatch in AVM1 action: ConstantPool"
// errors in Ruffle.  We use 0x2F ('/') instead — the extra slashes
// end up in URL paths and are normalised away by Express middleware.
const PAD_BYTE = 0x2F; // '/'

// ── Bytecode patches ─────────────────────────────────────────────
// These modify specific AVM1 bytecode values at known offsets in the
// decompressed body (offsets found by analysing the ORIGINAL SWF).
//
// Ruffle's loadMovie() on createEmptyMovieClip doesn't complete the
// fetch, so fileIcon.swf stays "(pending)" forever.  The loading
// screen (loading.as) uses this fallback when getBytesTotal() < 1024:
//     lp.iTotal = 110000;   lp.iLoaded = 0;
// Changing 110000 → 0 makes iTotal == iLoaded (0 == 0), so the
// loading screen completes once the main SWF is loaded.
const bytePatches = [
  {
    offset: 35297,
    from: [0xB0, 0xAD, 0x01, 0x00],  // int32 LE 110000
    to:   [0x00, 0x00, 0x00, 0x00],  // int32 LE 0
    desc: 'loading.as: iTotal fallback 110000 → 0 (bypass fileIcon.swf)'
  },
];

// Read the SWF
const raw = fs.readFileSync(SRC);
const sig = raw.slice(0, 3).toString('ascii');
if (sig !== 'CWS') {
  if (sig === 'FWS') {
    console.error('SWF is not compressed (FWS). This script expects CWS.');
    process.exit(1);
  }
  console.error('Not a valid SWF file.');
  process.exit(1);
}

// Decompress
const header = raw.slice(0, 8);
const body = zlib.inflateSync(raw.slice(8));

console.log(`SWF version: ${raw[3]}`);
console.log(`Compressed size: ${raw.length} bytes`);
console.log(`Decompressed body: ${body.length} bytes`);

let patchCount = 0;

for (const patch of patches) {
  const fromBuf = Buffer.from(patch.from, 'utf8');
  const toBuf = Buffer.from(patch.to, 'utf8');

  if (toBuf.length > fromBuf.length) {
    console.error(`Replacement "${patch.to}" is longer than original "${patch.from}" — cannot patch safely.`);
    process.exit(1);
  }

  let pos = 0;
  while ((pos = body.indexOf(fromBuf, pos)) !== -1) {
    console.log(`  Patching "${patch.from}" -> "${patch.to}" at offset ${pos}`);

    // Write new string
    toBuf.copy(body, pos);
    // Pad remaining bytes (before the original null terminator) with PAD_BYTE
    // so the string becomes e.g. "localhost:8888////////" — same length as the
    // original, preserving the ConstantPool string count.
    for (let i = toBuf.length; i < fromBuf.length; i++) {
      body[pos + i] = PAD_BYTE;
    }
    // The original null terminator at pos + fromBuf.length is left untouched

    patchCount++;
    pos += fromBuf.length;
  }
}

// ── Apply bytecode patches ───────────────────────────────────────
for (const bp of bytePatches) {
  const from = Buffer.from(bp.from);
  const to = Buffer.from(bp.to);
  const actual = body.slice(bp.offset, bp.offset + from.length);
  if (actual.equals(from)) {
    to.copy(body, bp.offset);
    console.log(`  Bytepatch: ${bp.desc} at offset ${bp.offset}`);
    patchCount++;
  } else {
    console.warn(`  Bytepatch SKIP (bytes don't match): ${bp.desc} at offset ${bp.offset}`);
    console.warn(`    Expected: ${from.toString('hex')}, Found: ${actual.toString('hex')}`);
  }
}

if (patchCount === 0) {
  console.log('No patches applied — strings/bytes not found (already patched?).');
  process.exit(0);
}

// Backup original
if (!fs.existsSync(BACKUP)) {
  fs.copyFileSync(SRC, BACKUP);
  console.log(`Backup saved to ${BACKUP}`);
}

// Recompress
const compressed = zlib.deflateSync(body);

// Build new SWF: change signature to CWS, keep version + uncompressed length
const newHeader = Buffer.from(header);
// Uncompressed length = 8 (header) + body.length
newHeader.writeUInt32LE(8 + body.length, 4);

const newSwf = Buffer.concat([newHeader, compressed]);
fs.writeFileSync(DST, newSwf);

console.log(`\nDone! ${patchCount} patch(es) applied.`);
console.log(`New SWF size: ${newSwf.length} bytes`);
console.log(`\nThe SWF now points to localhost:8888 instead of www.beta.frutiparc.com`);
