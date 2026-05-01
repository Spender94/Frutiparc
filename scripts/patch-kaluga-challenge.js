#!/usr/bin/env node
// Patches Games/kaluga/full.swf so that:
//   1. Only Kaluga's "Challenge" mode (kaluga.game.Classic, type == "$classic")
//      sends a score to the daily-challenge ranking. Other sub-modes still play
//      and end normally — they just don't pollute the leaderboard.
//   2. The "Rejouer ?" panel shows after every Kaluga game ends, regardless of
//      mode and regardless of isWhite(). (Original behavior only offered it for
//      $train + isWhite(), which made replays inaccessible for normal users.)
//
// Game.as has two `$train` tests in the kaluga.Game DoInitAction:
//
//   Line 254 (initEndPanelList, "single" case):
//     if (this.mng.client.isWhite() || this.type == "$train") {
//         this.addReplayPanel();
//     } else {
//         this.endPanelEnd.push("kill");
//     }
//   → bytecode pattern:
//       Push CP[98]; Equals2; Not; If <25>     (5-byte If branches to "kill")
//
//   Line 902 (initEndGame, saveScore guard):
//     if (this.type != "$train" && this.tournament == undefined) {
//         this.saveScore(this.score);
//     }
//   → bytecode pattern:
//       Push CP[98]; Equals2; Not; PushDup; Not; If <17>; Pop; …
//                                  ^^^^^^^^^^^^^^^^^^^^^^^^^
//                                  &&-short-circuit
//
// Patch strategy:
//   • Rewrite CP[98] from "$train" to "$classic" (the test now references the
//     mode we actually want to compare against).
//   • Line 902: replace the first `Not` (right after Equals2) with
//     `ToggleQuality` (0x08, a side-effect-light no-op). The combined effect
//     turns `(type != $train) && (tournament == undefined)` into
//     `(type == $classic) && (tournament == undefined)`.
//   • Line 254: change the If's signed jump offset from 25 to 0 — the If still
//     pops the boolean off the stack, but falls through to the addReplayPanel
//     branch unconditionally. The "kill" branch becomes dead code.
//
// All edits are length-preserving except the CP entry rewrite ("$train" → 7
// bytes including null → "$classic" + null = 9 bytes, +2 bytes). The CP
// payload length, the DoInitAction tag length, and the SWF body grow by 2.
// Bytecode references CP entries by index, so existing Push CP[98] sites
// stay valid; relative jumps inside the action are unaffected because the
// entire bytecode block shifts uniformly.

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

// 1) Locate the kaluga.Game DoInitAction (tag 59) containing "$train".
const needle = Buffer.from(OLD_STR + '\0', 'ascii');
const strOff = body.indexOf(needle);
if (strOff < 0) throw new Error('"$train" not found in SWF');

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

const cpActionOff = initActionOff + initActionHdrSize + 2; // skip 2-byte sprite ID
if (body[cpActionOff] !== 0x88) throw new Error('Expected ConstantPool action');
const cpPayloadLen = body.readUInt16LE(cpActionOff + 1);

console.log('Found DoInitAction at', initActionOff, 'len', initActionLen);
console.log('"$train" at offset', strOff, '— constant pool payload len', cpPayloadLen);

// 2) Catalog every Push(CP[98]) site by pattern, distinguishing the two cases.
//    We need to apply different fixups to each.
const pushCp98       = Buffer.from([0x96, 0x02, 0x00, 0x08, 0x62]); // Push CP[98]
const ifAfterNot     = 0x9d; // If (line 254 — Equals2 Not If)
const pushDupAfterNot = 0x4c; // PushDup (line 902 — Equals2 Not PushDup Not If)

const sites = []; // { pushOff, equalsOff, notOff, kind: 'replay' | 'savescore' }
let scan = initActionOff + initActionHdrSize;
const scanEnd = initActionOff + initActionHdrSize + initActionLen;
while (scan < scanEnd) {
  const idx = body.indexOf(pushCp98, scan);
  if (idx < 0 || idx >= scanEnd) break;
  const equalsOff = idx + 5;
  const notOff    = idx + 6;
  if (body[equalsOff] !== 0x49) {
    scan = idx + pushCp98.length;
    continue;
  }
  if (body[notOff] !== 0x12) {
    scan = idx + pushCp98.length;
    continue;
  }
  const after = body[notOff + 1];
  if (after === ifAfterNot) {
    sites.push({ pushOff: idx, equalsOff, notOff, kind: 'replay' });
  } else if (after === pushDupAfterNot) {
    sites.push({ pushOff: idx, equalsOff, notOff, kind: 'savescore' });
  } else {
    console.warn('Unrecognised pattern after Not at', notOff, '→ 0x' + after.toString(16));
  }
  scan = idx + pushCp98.length;
}
console.log('Sites:', sites.map(s => `${s.kind}@${s.pushOff}`).join(', '));

if (!sites.some(s => s.kind === 'savescore')) {
  throw new Error('saveScore guard pattern (line 902) not found');
}

// 3) Rewrite the constant pool entry $train → $classic (+2 bytes).
const before = body.slice(0, strOff);
const after  = body.slice(strOff + needle.length);
const inserted = Buffer.from(NEW_STR + '\0', 'ascii');
let newBody = Buffer.concat([before, inserted, after]);

const newCpLen = cpPayloadLen + DELTA;
if (newCpLen > 0xFFFF) throw new Error('CP payload would overflow UI16');
newBody.writeUInt16LE(newCpLen, cpActionOff + 1);

if (initActionHdrSize !== 6) throw new Error('DoInitAction must be long-form');
newBody.writeUInt32LE(initActionLen + DELTA, initActionOff + 2);

// 4) Apply per-site fixups. All site offsets are pre-shift; anything past the
//    CP modification needs +DELTA.
function shift(o) { return o + (o > strOff ? DELTA : 0); }

for (const site of sites) {
  if (site.kind === 'savescore') {
    // Replace the first Not after Equals2 with ToggleQuality so the test
    // becomes `(type == $classic)` instead of `(type != $train)`.
    const at = shift(site.notOff);
    if (newBody[at] !== 0x12) throw new Error('savescore Not missing at ' + at);
    newBody[at] = 0x08;
    console.log('saveScore: Not @', at, '→ ToggleQuality');
  } else if (site.kind === 'replay') {
    // The bytecode shape is: Push CP[98]; Equals2; Not; If <25>.
    // The If at notOff+1 has a 5-byte form: 0x9d 0x02 0x00 lo hi.
    // We patch the signed offset (lo,hi) to 0 so it never branches to the
    // "kill" arm — falls through to addReplayPanel for every mode.
    const ifAt = shift(site.notOff + 1);
    if (newBody[ifAt] !== 0x9d) throw new Error('replay If missing at ' + ifAt);
    newBody.writeInt16LE(0, ifAt + 3);
    console.log('replay: If offset @', ifAt + 3, '→ 0 (always fall through to addReplayPanel)');
  }
}

const newSize = writeSwf(OUT_PATH, sig, version, newBody);
console.log('Wrote', OUT_PATH, '(' + newSize + ' bytes)');
