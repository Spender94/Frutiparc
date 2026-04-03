#!/usr/bin/env node
/**
 * Patch Frusion client SWFs in-place so runtime URLs point to the localhost shim.
 *
 * This keeps repository history text-only (no committed SWF binaries) while
 * preserving local dev behavior previously achieved via committed binary edits.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const TARGETS = [
  'frusion/frusion_client.swf',
  'public/frusion_client.swf',
  'public/swf/frusion_client.swf',
];

const PATCHES = [
  {
    from: 'http://www.beta.frutiparc.com/swf/',
    to: 'http://localhost:8888/betawww/swf/',
  },
  {
    from: 'www.beta.frutiparc.com',
    to: 'localhost:8888/betawww',
  },
];

const mode = process.argv.includes('--check') ? 'check' : 'apply';

function readBody(raw) {
  const sig = raw.slice(0, 3).toString('ascii');
  if (sig === 'CWS') {
    return {
      sig,
      header: raw.slice(0, 8),
      body: zlib.inflateSync(raw.slice(8)),
    };
  }
  if (sig === 'FWS') {
    return {
      sig,
      header: raw.slice(0, 8),
      body: Buffer.from(raw.slice(8)),
    };
  }
  throw new Error('Invalid SWF signature');
}

function encodeSwf(sig, header, body) {
  const newHeader = Buffer.from(header);
  newHeader.writeUInt32LE(8 + body.length, 4);
  if (sig === 'CWS') {
    return Buffer.concat([newHeader, zlib.deflateSync(body)]);
  }
  return Buffer.concat([newHeader, body]);
}

function patchBuffer(body, from, to) {
  const fromBuf = Buffer.from(from, 'utf8');
  const toBuf = Buffer.from(to, 'utf8');

  if (fromBuf.length !== toBuf.length) {
    throw new Error(`Patch length mismatch for "${from}" -> "${to}"`);
  }

  let patched = 0;
  let pos = 0;
  while ((pos = body.indexOf(fromBuf, pos)) !== -1) {
    toBuf.copy(body, pos);
    patched++;
    pos += fromBuf.length;
  }
  return patched;
}

let totalPatched = 0;

for (const relPath of TARGETS) {
  const filePath = path.resolve(relPath);
  if (!fs.existsSync(filePath)) {
    console.warn(`[skip] ${relPath} (missing)`);
    continue;
  }

  const raw = fs.readFileSync(filePath);
  const { sig, header, body } = readBody(raw);

  let filePatched = 0;
  for (const patch of PATCHES) {
    filePatched += patchBuffer(body, patch.from, patch.to);
  }

  totalPatched += filePatched;

  if (filePatched === 0) {
    console.log(`[ok] ${relPath} (already patched or patterns not found)`);
    continue;
  }

  if (mode === 'check') {
    console.log(`[check] ${relPath} would patch ${filePatched} occurrence(s)`);
    continue;
  }

  const backupPath = `${filePath}.original`;
  if (!fs.existsSync(backupPath)) {
    fs.copyFileSync(filePath, backupPath);
  }

  const out = encodeSwf(sig, header, body);
  fs.writeFileSync(filePath, out);
  console.log(`[patch] ${relPath} patched ${filePatched} occurrence(s)`);
}

if (mode === 'check') {
  console.log(`Done (check mode). Total patchable occurrences: ${totalPatched}`);
} else {
  console.log(`Done. Total patched occurrences: ${totalPatched}`);
}
