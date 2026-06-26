#!/usr/bin/env node
// Rewire the dead "Frutiblogs" desktop icon (main.swf) to open the trombinoscope.
//
// The icon runs _global.openBlog(undefined). Its else-branch was compiled as a
// CallFunction to a variable named "getUrl":
//     getUrl(Path.protocol + "blogs.frutiparc.com/", "_blank")
// Ruffle does NOT treat that CallFunction as a navigation (only the GetURL2
// ACTION navigates — that's how the Club icon's javascript:fp_openPopup bridge
// works), so the click does nothing — for us and for players.
//
// We rewrite the else-branch to the SAME shape Club uses — the GetURL2 action on
// a javascript: URL with an empty target:
//     getURL("javascript:fp_trombi()", "")
// fp_trombi() is defined on the host page (ruffle.html) and opens the overlay.
//
// Two edits:
//   1. ConstantPool[52]  "blogs.frutiparc.com/" (20) → "javascript:fp_trombi()" (22)
//   2. the 38-byte else-branch  [Push #51][Push #48][GetVar][Push #49][GetMember]
//      [Push #52][ADD2][Push int2][Push #53 "getUrl"][CallFunction][Pop]
//      →  [Push #52][Push ""][GetURL2 flags=0]  + stack-neutral null/pop padding
//      to keep the byte length identical (no jump/codeSize fix-ups needed).
//
// AVM1: Push const8 = 96 02 00 08 NN | Push "" = 96 02 00 00 00 |
//       Push k nulls = 96 (3+k... len=k) 00 02×k | Pop = 17 | GetURL2 = 9A 01 00 FLAGS

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SWF = path.resolve(__dirname, '..', 'legacy', 'main.swf');
const BLOG_OLD = 'blogs.frutiparc.com/';        // ConstantPool[52]
const BLOG_NEW = 'javascript:fp_trombi()';      // runs on the host page (ruffle.html)
const DELTA = BLOG_NEW.length - BLOG_OLD.length; // +2

// Pristine else-branch (38 bytes): the navigation compiled as CallFunction "getUrl".
const P_OLD = Buffer.from([
  0x96,0x02,0x00,0x08,0x33,                 // Push const#51 "_blank"
  0x96,0x02,0x00,0x08,0x30, 0x1C,           // Push const#48 "Path"; GetVariable
  0x96,0x02,0x00,0x08,0x31, 0x4E,           // Push const#49 "protocol"; GetMember
  0x96,0x02,0x00,0x08,0x34, 0x47,           // Push const#52 "blogs…"; ADD2
  0x96,0x05,0x00,0x07,0x02,0x00,0x00,0x00,  // Push int 2
  0x96,0x02,0x00,0x08,0x35,                 // Push const#53 "getUrl"
  0x3D, 0x17,                               // CallFunction; Pop
]);
// New else-branch (38 bytes): getURL("javascript:fp_trombi()", "") via GetURL2.
const P_NEW = Buffer.from([
  0x96,0x02,0x00,0x08,0x34,                 // Push const#52 (now "javascript:fp_trombi()") = URL
  0x96,0x02,0x00,0x00,0x00,                 // Push ""  = target
  0x9A,0x01,0x00,0x00,                      // GetURL2 (flags 0x00) → navigate (runs the javascript:)
  0x96,0x05,0x00,0x02,0x02,0x02,0x02,0x02,  // Push 5 nulls  ┐ stack-neutral padding
  0x17,0x17,0x17,0x17,0x17,                 // Pop ×5        │ keeps total length = 38,
  0x96,0x04,0x00,0x02,0x02,0x02,0x02,       // Push 4 nulls  │ so no jump/codeSize edits
  0x17,0x17,0x17,0x17,                      // Pop ×4        ┘ are needed
]);
if (P_OLD.length !== P_NEW.length) throw new Error('patch length mismatch: ' + P_OLD.length + ' vs ' + P_NEW.length);

function readSwf(p) {
  const raw = fs.readFileSync(p);
  const sig = raw.slice(0, 3).toString('ascii');
  if (sig !== 'CWS' && sig !== 'FWS') throw new Error('Unsupported sig: ' + sig);
  const body = sig === 'CWS' ? zlib.inflateSync(raw.slice(8)) : Buffer.from(raw.slice(8));
  return { sig, version: raw[3], body };
}
function writeSwf(p, sig, version, body) {
  const fileLen = 8 + body.length;
  const payload = sig === 'CWS' ? zlib.deflateSync(body) : body;
  const out = Buffer.alloc(8 + payload.length);
  out.write(sig, 0, 'ascii'); out.writeUInt8(version, 3); out.writeUInt32LE(fileLen, 4);
  payload.copy(out, 8);
  fs.writeFileSync(p, out);
  return out.length;
}

function patch() {
  let { sig, version, body } = readSwf(SWF);
  if (body.indexOf(Buffer.from(BLOG_NEW, 'latin1')) >= 0) { console.log('Already patched — skipping.'); return; }

  // 1. Bytecode: rewrite the else-branch (same length, no shift).
  const at = body.indexOf(P_OLD);
  if (at < 0) throw new Error('openBlog else-branch pattern not found');
  if (body.indexOf(P_OLD, at + 1) >= 0) throw new Error('else-branch pattern not unique — aborting');
  P_NEW.copy(body, at);
  console.log('Else-branch rewritten to GetURL2("javascript:fp_trombi()", "") at', at);

  // 2. ConstantPool[52] string length change → update CP + DoAction + DefineSprite + file.
  const strOff = body.indexOf(Buffer.from(BLOG_OLD + '\0', 'latin1'));
  if (strOff < 0) throw new Error('ConstantPool string not found');

  const nbits = (body[0] >> 3) & 0x1f;
  let off = Math.ceil((5 + nbits * 4) / 8) + 4;
  let spOff = -1, spLen = 0, spH = 0;
  while (off < body.length) {
    const hdr = body.readUInt16LE(off); const code = hdr >> 6; let len = hdr & 0x3f; let h = 2;
    if (len === 0x3f) { len = body.readUInt32LE(off + 2); h = 6; }
    if (code === 0) break;
    if (code === 39 && strOff >= off + h && strOff < off + h + len) { spOff = off; spLen = len; spH = h; break; }
    off += h + len;
  }
  if (spOff < 0 || spH !== 6) throw new Error('Enclosing DefineSprite not found / not long-form');

  let daOff = -1, daLen = 0, daH = 0;
  let q = spOff + spH + 4; const subEnd = spOff + spH + spLen;
  while (q < subEnd) {
    const hdr = body.readUInt16LE(q); const code = hdr >> 6; let len = hdr & 0x3f; let h = 2;
    if (len === 0x3f) { len = body.readUInt32LE(q + 2); h = 6; }
    if (code === 0) break;
    if (code === 12 && strOff >= q + h && strOff < q + h + len) { daOff = q; daLen = len; daH = h; break; }
    q += h + len;
  }
  if (daOff < 0 || daH !== 6) throw new Error('Enclosing DoAction not found / not long-form');

  const cpOff = daOff + daH;
  if (body[cpOff] !== 0x88) throw new Error('First action is not ConstantPool');
  const cpLen = body.readUInt16LE(cpOff + 1);

  body = Buffer.concat([body.slice(0, strOff), Buffer.from(BLOG_NEW, 'latin1'), body.slice(strOff + BLOG_OLD.length)]);
  if (cpLen + DELTA > 0xffff) throw new Error('ConstantPool would overflow UI16');
  body.writeUInt16LE(cpLen + DELTA, cpOff + 1);
  body.writeUInt32LE(daLen + DELTA, daOff + 2);
  body.writeUInt32LE(spLen + DELTA, spOff + 2);
  console.log('ConstantPool[52] "' + BLOG_OLD + '" → "' + BLOG_NEW + '" (Δ' + DELTA + '); sprite/doaction lengths updated');

  console.log('Wrote', SWF, '(' + writeSwf(SWF, sig, version, body) + ' bytes)');
}

patch();
