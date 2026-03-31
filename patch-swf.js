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
    // Null-terminate
    body[pos + toBuf.length] = 0x00;
    // Fill remaining bytes with nulls (creates empty ghost strings — harmless)
    for (let i = toBuf.length + 1; i < fromBuf.length; i++) {
      body[pos + i] = 0x00;
    }

    patchCount++;
    pos += fromBuf.length;
  }
}

if (patchCount === 0) {
  console.log('No patches applied — domain strings not found (already patched?).');
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
