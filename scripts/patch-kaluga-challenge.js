#!/usr/bin/env node
// Patches Games/kaluga/full.swf so that only Kaluga's "Challenge" mode
// (kaluga.game.Classic, type == "$classic") sends a score to the server.
//
// In Game.as line 902 the original condition is:
//   if (this.type != "$train" && this.tournament == undefined) { saveScore(...) }
//
// Compiled into AVM1 bytecode as:
//   Push CP["type"]; GetMember; Push CP["$train"]; Equals2; Not; If(...)
//
// We rewrite the constant-pool entry "$train" (idx 98) to "$classic" and
// replace the trailing `Not` (0x12) opcode with `ToggleQuality` (0x08, a
// 1-byte side-effect-light opcode) — effectively flipping `!=` to `==`.
// After the patch the test is `this.type == "$classic"`, so saveScore only
// fires for the actual Challenge mode (slot 0 in Menu.as).

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const IN_PATH  = path.resolve(__dirname, '..', 'Games', 'kaluga', 'full.swf');
const OUT_PATH = IN_PATH;

const OLD_STR = '$train';
const NEW_STR = '$classic';
const DELTA   = NEW_STR.length - OLD_STR.length; // +2

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

const { sig, version, body } = readSwf(IN_PATH);

// 1) Locate the kaluga.Game DoInitAction containing "$train" in its CP.
const needle = Buffer.from(OLD_STR + '\0', 'ascii');
const strOff = body.indexOf(needle);
if (strOff < 0) throw new Error('"$train" not found in SWF');

// Walk top-level tags to find the enclosing DoInitAction (tag 59)
const nbits = (body[0] >> 3) & 0x1f;
const rectBytes = Math.ceil((5 + nbits * 4) / 8);
let off = rectBytes + 4;
let initActionOff = -1, initActionLen = 0, initActionHdrSize = 0;
while (off < body.length) {
  const hdr = body.readUInt16LE(off);
  const code = hdr >> 6;
  let len = hdr & 0x3f;
  let hSize = 2;
  if (len === 0x3f) { len = body.readUInt32LE(off + 2); hSize = 6; }
  if (code === 0) break;
  if (code === 59 && strOff >= off + hSize && strOff < off + hSize + len) {
    initActionOff = off; initActionLen = len; initActionHdrSize = hSize;
    break;
  }
  off += hSize + len;
}
if (initActionOff < 0) throw new Error('Enclosing DoInitAction not found');

// First action in the body must be ConstantPool (0x88). Body layout:
//   sprite_id (2 bytes) | constant pool action ...
const cpActionOff = initActionOff + initActionHdrSize + 2;
if (body[cpActionOff] !== 0x88) throw new Error('Expected ConstantPool action');
const cpPayloadLen = body.readUInt16LE(cpActionOff + 1);

console.log('Found DoInitAction at', initActionOff, 'len', initActionLen);
console.log('Constant pool payload length:', cpPayloadLen);
console.log('"$train" at offset', strOff);

// 2) Both Game.as $train tests compile to Push CP[98]; Equals2; Not; ...
//    We flip "!=" to "==" by replacing the Not (0x12) with ToggleQuality (0x08).
//    Combined with the CP entry rewrite ($train → $classic) below, the test
//    becomes `type == "$classic"`.
//
//    Side effect for line 254 (`if isWhite() || type == "$train"` shows the
//    "Rejouer ?" panel): the panel now shows for $classic instead of $train.
//    That's acceptable — a Challenge-mode replay button is a fine UX trade.
const notPattern = Buffer.from([0x96, 0x02, 0x00, 0x08, 0x62, 0x49, 0x12]);
const notOffsets = [];
let scan = initActionOff + initActionHdrSize;
const scanEnd = initActionOff + initActionHdrSize + initActionLen;
while (scan < scanEnd) {
  const idx = body.indexOf(notPattern, scan);
  if (idx < 0 || idx >= scanEnd) break;
  notOffsets.push(idx + 6);
  scan = idx + notPattern.length;
}
if (notOffsets.length === 0) {
  throw new Error('Could not find Push(CP[98]); Equals2; Not pattern');
}
console.log('Found Not opcodes at offsets:', notOffsets);

// 3) Build the new body:
//    - Replace "$train\0" (7 bytes) with "$classic\0" (9 bytes) — grows by 2
//    - For each Not offset, after the CP shift add DELTA. Replace 0x12 with 0x08.
//    - Update CP payload length (UI16 at cpActionOff + 1)
//    - Update DoInitAction tag body length (UI32 at initActionOff + 2)

const before = body.slice(0, strOff);
const after  = body.slice(strOff + needle.length);
const inserted = Buffer.from(NEW_STR + '\0', 'ascii');
let newBody = Buffer.concat([before, inserted, after]);

// Update CP payload length
const newCpLen = cpPayloadLen + DELTA;
if (newCpLen > 0xFFFF) throw new Error('CP payload would overflow UI16');
newBody.writeUInt16LE(newCpLen, cpActionOff + 1);

// Update DoInitAction tag length (UI32, long form)
if (initActionHdrSize !== 6) throw new Error('DoInitAction must be long-form');
newBody.writeUInt32LE(initActionLen + DELTA, initActionOff + 2);

// Replace each Not opcode with ToggleQuality (0x08) at shifted offsets
for (const noOff of notOffsets) {
  const adjusted = noOff + (noOff > strOff ? DELTA : 0);
  if (newBody[adjusted] !== 0x12) {
    throw new Error('Expected Not (0x12) at shifted offset ' + adjusted +
                    ', got 0x' + newBody[adjusted].toString(16));
  }
  newBody[adjusted] = 0x08;
  console.log('Replaced Not -> ToggleQuality at offset', adjusted);
}

const newSize = writeSwf(OUT_PATH, sig, version, newBody);
console.log('Wrote', OUT_PATH, '(' + newSize + ' bytes)');
