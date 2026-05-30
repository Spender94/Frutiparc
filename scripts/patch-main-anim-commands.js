#!/usr/bin/env node
// Patches legacy/main.swf so the animator commands and any unknown slash
// command are FORWARDED to the server instead of being handled locally.
//
// Why: reverse-engineering the command dispatcher (the DefineFunction2 at
// 0x2a48a, param reg4 = trimmed input) showed that the "animator" commands are
// entirely client-side toys and never reach the server:
//   /blueon, /blueoff  -> set a local reg1.blueMode flag (only consulted on the
//                         send path for flAnimator in "quizz" groups — useless
//                         in a normal salon).
//   /initpoint, /point -> mutate a local reg1.points object, never shared.
//   unknown "/xxx"     -> the fallback prints "commande inconnue" locally.
// So the server-side implementations of these commands were never invoked.
//
// Fix: redirect each of those command branches (and the unknown-command
// fallback) to 0x2c731, the dispatcher's own "send this text to the server"
// tail:  reg1.sendMsg(reg4); return true;  (this is exactly what a normal,
// non-command chat line does). The command text then arrives at the server's
// `case 'send'` handler, which already implements /blueon, /blueoff,
// /initpoint, /point, /showpoint, /classement, /removepoint, /resetpoint,
// /stoppoint, /endpoint — broadcasting to the whole salon, for moderators and
// animators, in any channel.
//
// All edits are length-preserving (we only rewrite a 2-byte jump offset). The
// normal-message path and every other command (/kick, /pv, /frutiz, /topic …)
// are untouched, so the blast radius is limited to the redirected commands.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const IN_PATH = path.resolve(__dirname, '..', 'legacy', 'main.swf');
const TARGET = 0x2c731;                 // reg1.sendMsg(reg4); return true
const SCAN_LO = 0x2a500, SCAN_HI = 0x2a900;   // the dispatcher's compare chain

function readSwf(p) {
  const raw = fs.readFileSync(p);
  const sig = raw.slice(0, 3).toString('ascii');
  if (sig !== 'CWS' && sig !== 'FWS') throw new Error('bad sig ' + sig);
  const body = sig === 'CWS' ? zlib.inflateSync(raw.slice(8)) : Buffer.from(raw.slice(8));
  return { sig, version: raw[3], body };
}
function writeSwf(p, sig, version, body) {
  const payload = sig === 'CWS' ? zlib.deflateSync(body) : body;
  const out = Buffer.alloc(8 + payload.length);
  out.write(sig, 0, 'ascii');
  out.writeUInt8(version, 3);
  out.writeUInt32LE(8 + body.length, 4);
  payload.copy(out, 8);
  fs.writeFileSync(p, out);
  return out.length;
}

const { sig, version, body } = readSwf(IN_PATH);
const out = Buffer.from(body);
let changed = 0, already = 0;

// ── 1. the four command branches: pattern  08 <idx> 66 9d 02 00 <off16> ──
// (Push reg0==CP[idx]) StrictEquals ActionIf. The If ends at p+8; offset @p+6.
function redirectIf(name, idx, expectTarget) {
  let found = null;
  const head = Buffer.from([0x08, idx, 0x66, 0x9d, 0x02, 0x00]);
  let off = SCAN_LO;
  while (true) {
    const p = out.indexOf(head, off);
    if (p < 0 || p >= SCAN_HI) break;
    if (found !== null) throw new Error(`${name}: multiple matches in dispatcher`);
    found = p;
    off = p + 1;
  }
  if (found === null) throw new Error(`${name}: pattern not found in dispatcher`);
  const p = found;
  const ifEnd = p + 8;
  const curOff = out.readInt16LE(p + 6);
  const curTarget = ifEnd + curOff;
  const newOff = TARGET - ifEnd;
  if (newOff < -0x8000 || newOff > 0x7fff) throw new Error(`${name}: offset ${newOff} overflow`);
  if (curTarget === TARGET) { console.log(`${name}: already forwarded — skip.`); already++; return; }
  if (curTarget !== expectTarget) throw new Error(`${name}: current target 0x${curTarget.toString(16)} != expected 0x${expectTarget.toString(16)}`);
  out.writeInt16LE(newOff, p + 6);
  console.log(`${name}: If@0x${(p+3).toString(16)}  0x${curTarget.toString(16)} -> 0x${TARGET.toString(16)} (off ${curOff} -> ${newOff})`);
  changed++;
}

redirectIf('/blueon',    117, 0x2b285);
redirectIf('/blueoff',   118, 0x2b2b3);
redirectIf('/initpoint', 119, 0x2b2e1);
redirectIf('/point',     120, 0x2b318);

// ── 2. the unknown-command fallback: Jump @0x2a8f9 (99 02 00 <off16>) ──
{
  const p = 0x2a8f9;
  if (out[p] !== 0x99 || out[p+1] !== 0x02 || out[p+2] !== 0x00) throw new Error('fallback: not a Jump at 0x2a8f9');
  const jmpEnd = p + 5;
  const curOff = out.readInt16LE(p + 3);
  const curTarget = jmpEnd + curOff;
  const newOff = TARGET - jmpEnd;
  if (curTarget === TARGET) { console.log('fallback: already forwarded — skip.'); already++; }
  else if (curTarget !== 0x2c199) throw new Error(`fallback: current target 0x${curTarget.toString(16)} != 0x2c199`);
  else {
    out.writeInt16LE(newOff, p + 3);
    console.log(`fallback: Jump@0x${p.toString(16)}  0x${curTarget.toString(16)} -> 0x${TARGET.toString(16)} (off ${curOff} -> ${newOff})`);
    changed++;
  }
}

if (changed === 0) { console.log('Nothing to do.'); process.exit(0); }
const size = writeSwf(IN_PATH, sig, version, out);
console.log(`main.swf re-packed (${size} bytes), ${changed} redirect(s) applied, ${already} already done.`);
