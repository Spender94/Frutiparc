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

// What to replace — each `to` string MUST be the same length as `from`.
// We pad short replacements with URL path segments that the browser
// resolves away:  /pad/../  (8 chars, net effect = /)
//                 /./       (3 chars, net effect = /)
// This way http://localhost:8888/pad/../xml/foo → http://localhost:8888/xml/foo
const patches = [
  { from: 'www.beta.frutiparc.com', to: 'localhost:8888/pad/..' },  // 22 chars each
  { from: 'swf.beta.frutiparc.com', to: 'localhost:8888/pad/..' },  // 22 chars each
  { from: 'swf.frutiparc.com', to: 'localhost:8888/./' },            // 17 chars each
];

// No padding needed — each replacement is exactly the same length
// as the original, using URL path segments (../  ./) to fill the gap.

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
    offset: 35257,
    from: [0x00, 0x04, 0x00, 0x00],  // int32 LE 1024
    to:   [0xFF, 0xFF, 0xFF, 0x7F],  // int32 LE 2147483647
    desc: 'loading.as: change "iTotal < 1024" to "iTotal < MAX_INT" (always true)'
  },
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

    // Write new string (same length as original, null terminator stays)
    toBuf.copy(body, pos);

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
