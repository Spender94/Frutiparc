#!/usr/bin/env node
// Patches Games/miniWave2/miniwave.swf:
//   - Bumps fcVersion from 0.93 to 0.94 so patchFruticard() triggers on
//     startup for existing cards, sending accumulated progress to the server
//     via the normal Frusion protocol (giveItem + saveSlot through XMLSocket).
//
// The game runs in non-STANDALONE mode through game-popup.html, where
// GameClient connects via XMLSocket (Ruffle socket proxy) exactly like
// Swapou, Kaluga, Snake3, etc.  No ExternalInterface or SharedObject hacks
// are needed.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SWF_PATH = path.resolve(__dirname, '..', 'Games', 'miniWave2', 'miniwave.swf');
const FULL_PATH = path.resolve(__dirname, '..', 'Games', 'miniWave2', 'full.swf');
const BACKUP_PATH = SWF_PATH + '.bak';

// ─── SWF read/write helpers ───

function readSwf(filePath) {
  const raw = fs.readFileSync(filePath);
  const sig = raw.slice(0, 3).toString('ascii');
  const version = raw[3];
  let body;
  if (sig === 'CWS') body = zlib.inflateSync(raw.slice(8));
  else if (sig === 'FWS') body = Buffer.from(raw.slice(8));
  else throw new Error('Unsupported sig: ' + sig);
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

function parseRect(body) {
  const nbits = (body[0] >> 3) & 0x1f;
  return Math.ceil((5 + nbits * 4) / 8);
}

function findTags(body) {
  const rectBytes = parseRect(body);
  let off = rectBytes + 4;
  const tags = [];
  while (off < body.length) {
    const hdr = body.readUInt16LE(off);
    const code = hdr >> 6;
    let length = hdr & 0x3f;
    let hdrSize = 2;
    if (length === 0x3f) { length = body.readUInt32LE(off + 2); hdrSize = 6; }
    if (code === 0) break;
    tags.push({ code, offset: off, hdrSize, length });
    off += hdrSize + length;
  }
  return tags;
}

function parseConstantPool(buf, cpStart) {
  if (buf[cpStart] !== 0x88) return null;
  const payloadLen = buf.readUInt16LE(cpStart + 1);
  const count = buf.readUInt16LE(cpStart + 3);
  const entries = [];
  let pos = cpStart + 5;
  while (entries.length < count) {
    const end = buf.indexOf(0, pos);
    if (end < 0) return null;
    entries.push(buf.slice(pos, end).toString('latin1'));
    pos = end + 1;
  }
  return { payloadLen, count, entries, dataEnd: cpStart + 3 + payloadLen };
}

// ─── Main ───

// Back up original
if (!fs.existsSync(BACKUP_PATH)) {
  fs.copyFileSync(SWF_PATH, BACKUP_PATH);
  console.log('Backed up original to', BACKUP_PATH);
}

// Always restore from backup to apply patches cleanly
fs.copyFileSync(BACKUP_PATH, SWF_PATH);
console.log('Restored from backup');

const { sig, version, body } = readSwf(SWF_PATH);
let buf = Buffer.from(body);
const tags = findTags(buf);

console.log(`SWF: ${sig} v${version}, decompressed ${buf.length} bytes, ${tags.length} tags`);

// Find Manager DoInitAction tags (code=59, CP[3]='Manager', has 'fcVersion')
const managerTagInfos = [];
for (const tag of tags) {
  if (tag.code !== 59) continue;
  const bodyStart = tag.offset + tag.hdrSize;
  const spriteId = buf.readUInt16LE(bodyStart);
  const cpStart = bodyStart + 2;
  const cp = parseConstantPool(buf, cpStart);
  if (!cp) continue;
  if (cp.entries[3] === 'Manager' && cp.entries.indexOf('fcVersion') >= 0) {
    managerTagInfos.push({ tag, spriteId });
  }
}

if (managerTagInfos.length === 0) throw new Error('No Manager DoInitAction tags found');
console.log(`Found ${managerTagInfos.length} Manager tag(s): sprites ${managerTagInfos.map(t => t.spriteId).join(', ')}`);

// Bump fcVersion 0.93 → 0.94 in each Manager tag (in-place, no size change)
// AVM1 doubles have swapped 32-bit halves vs normal IEEE 754 LE.
const avm1_093 = Buffer.from('8fc2ed3fc3f5285c', 'hex');
const avm1_094 = Buffer.from('7a14ee3f14ae47e1', 'hex');

let patchCount = 0;
for (const { tag, spriteId } of managerTagInfos) {
  const bodyStart = tag.offset + tag.hdrSize;
  const cp = parseConstantPool(buf, bodyStart + 2);

  const fcVersionIdx = cp.entries.indexOf('fcVersion');
  if (fcVersionIdx < 0) throw new Error('fcVersion not found in Manager CP');
  const fcIdxByte = fcVersionIdx < 256
    ? Buffer.from([0x08, fcVersionIdx])
    : Buffer.from([0x09, fcVersionIdx & 0xff, (fcVersionIdx >> 8) & 0xff]);

  // Pattern: Push(r1, CP[fcVersion], double_0.93) SetMember
  const initPattern = Buffer.concat([
    Buffer.from([0x96, 0x0d, 0x00, 0x04, 0x01]),
    fcIdxByte,
    Buffer.from([0x06]),
    avm1_093,
    Buffer.from([0x4f]),
  ]);

  const searchStart = bodyStart + 2 + 3 + cp.payloadLen;
  const idx = buf.indexOf(initPattern, searchStart);
  if (idx < 0) throw new Error(`fcVersion=0.93 init pattern not found in Manager sprite ${spriteId}`);

  const doubleOffset = idx + 5 + fcIdxByte.length + 1;
  avm1_094.copy(buf, doubleOffset);
  patchCount++;
  console.log(`  Sprite ${spriteId}: bumped fcVersion 0.93 → 0.94 at offset ${doubleOffset}`);
}

// Also bump the two condition checks (< 0.92 and < 0.93) so patchFruticard
// doesn't re-run its old patches.  These are comparison doubles, not init
// assignments, so we leave them at 0.93 — they only guard older patches that
// have already run.  The init at 0.94 ensures patchFruticard() fires and
// calls saveSlot(0) at the end, which sends the current state to the server.

// Write output
const outSize = writeSwf(SWF_PATH, sig, version, buf);
console.log(`\nWrote ${SWF_PATH} (${outSize} bytes)`);

fs.copyFileSync(SWF_PATH, FULL_PATH);
console.log(`Copied to ${FULL_PATH}`);
console.log(`Done! Patched ${patchCount} Manager tag(s), fcVersion 0.93 → 0.94`);
