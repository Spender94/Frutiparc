#!/usr/bin/env node
// Patches legacy/main.swf so the chat command /image (and its alias /img)
// actually fires sendImage() in a normal public salon.
//
// Background (AVM1 disasm of the command processor, blob containing the
// slash-command chain): /image's handler at 0x2aec8 begins with an access
// gate:
//
//   if (!me.flAnimator) return false;          // non-animators: blocked
//   proceed =  group.startsWith("quizz")
//           || cmode != "channel"              // i.e. NOT a normal salon
//           || passwd != undefined;            // password-protected room
//   if (!proceed) return false;                // <-- blocks normal salons
//   ... sendImage(w,h,url,title) ...
//
// So in an ordinary public salon (cmode == "channel", no password, group not
// a "quizz" room) /image returns false WITHOUT ever calling sendImage — the
// message simply never leaves the client. That is the "/image ne s'envoie
// pas" the user sees. (The local /testimg handler is gated on flAnimator
// ALONE, which is why only it appeared to do anything.)
//
// Fix: once flAnimator is confirmed, skip the salon-type gate entirely and go
// straight to the sendImage call — matching /testimg's flAnimator-only gate.
// Non-animators are still blocked (their path jumps to 0x2af36 before this
// point and is untouched).
//
// The edit is length-preserving: the 5-byte  Push CP8[179]="quizz"  that opens
// the gate (0x2aee1: 96 02 00 08 b3) is overwritten with a 5-byte
//   Jump +91 -> 0x2af41   (99 02 00 5b 00)
// which lands exactly on the "proceed" instruction (Push reg5 …). The bytes in
// between become unreachable dead code.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const IN_PATH = path.resolve(__dirname, '..', 'legacy', 'main.swf');

const GATE_OFF   = 0x2aee1;                              // Push "quizz"
const OLD_BYTES  = Buffer.from([0x96, 0x02, 0x00, 0x08, 0xb3]);
const PROCEED    = 0x2af41;                              // first instr after the gate
// Jump instruction occupies GATE_OFF..GATE_OFF+4, ends at GATE_OFF+5.
const JMP_OFF    = PROCEED - (GATE_OFF + 5);             // = 0x5b = 91
const NEW_BYTES  = Buffer.from([0x99, 0x02, 0x00, JMP_OFF & 0xff, (JMP_OFF >> 8) & 0xff]);

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
const cur = body.slice(GATE_OFF, GATE_OFF + 5);

if (cur.equals(NEW_BYTES)) {
  console.log('main.swf /image gate already opened — skipping.');
  process.exit(0);
}
if (!cur.equals(OLD_BYTES)) {
  throw new Error(`unexpected bytes at 0x${GATE_OFF.toString(16)}: ${cur.toString('hex')} (expected ${OLD_BYTES.toString('hex')})`);
}

console.log(`[/image gate] @0x${GATE_OFF.toString(16)}  ${OLD_BYTES.toString('hex')} -> ${NEW_BYTES.toString('hex')}  (Jump +${JMP_OFF} -> 0x${PROCEED.toString(16)})`);
const out = Buffer.from(body);
NEW_BYTES.copy(out, GATE_OFF);
const size = writeSwf(IN_PATH, sig, version, out);
console.log(`main.swf re-packed (${size} bytes)`);
