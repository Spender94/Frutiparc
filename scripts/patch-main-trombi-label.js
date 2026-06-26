#!/usr/bin/env node
// Rename the desktop icon label "Frutiblogs" → "Bouilloscope" in main.swf.
//
// The label is desc[0] of the icon ({desc:["Frutiblogs",_global,"openBlog"], …}),
// stored as a ConstantPool string inside a top-level DoInitAction (tag 59) — the
// compiled FPFileMng class. We swap the string and bump the lengths:
//   ConstantPool payload (UI16) + DoInitAction tag (UI32) + SWF file header.
// (No enclosing DefineSprite here, unlike the openBlog action patch.)

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SWF = path.resolve(__dirname, '..', 'legacy', 'main.swf');
const OLD = 'Frutiblogs';     // 10
const NEW = 'Bouilloscope';   // 12
const DELTA = NEW.length - OLD.length; // +2

function readSwf(p) {
  const raw = fs.readFileSync(p);
  const sig = raw.slice(0, 3).toString('ascii');
  if (sig !== 'CWS' && sig !== 'FWS') throw new Error('Unsupported sig: ' + sig);
  const body = sig === 'CWS' ? zlib.inflateSync(raw.slice(8)) : Buffer.from(raw.slice(8));
  return { sig, version: raw[3], body };
}
function writeSwf(p, sig, version, body) {
  const payload = sig === 'CWS' ? zlib.deflateSync(body) : body;
  const out = Buffer.alloc(8 + payload.length);
  out.write(sig, 0, 'ascii'); out.writeUInt8(version, 3); out.writeUInt32LE(8 + body.length, 4);
  payload.copy(out, 8);
  fs.writeFileSync(p, out);
  return out.length;
}

function patch() {
  let { sig, version, body } = readSwf(SWF);
  if (body.indexOf(Buffer.from(NEW + '\0', 'latin1')) >= 0) { console.log('Already patched — skipping.'); return; }

  const strOff = body.indexOf(Buffer.from(OLD + '\0', 'latin1'));
  if (strOff < 0) throw new Error('"' + OLD + '" label string not found');
  if (body.indexOf(Buffer.from(OLD + '\0', 'latin1'), strOff + 1) >= 0) throw new Error('"' + OLD + '" not unique — aborting');

  // Top-level tag containing the string (expected: DoInitAction = 59, long-form).
  const nbits = (body[0] >> 3) & 0x1f;
  let off = Math.ceil((5 + nbits * 4) / 8) + 4;
  let tagOff = -1, tagLen = 0, tagH = 0, tagCode = 0;
  while (off < body.length) {
    const hdr = body.readUInt16LE(off); const code = hdr >> 6; let len = hdr & 0x3f; let h = 2;
    if (len === 0x3f) { len = body.readUInt32LE(off + 2); h = 6; }
    if (code === 0) break;
    if ((code === 59 || code === 12) && strOff >= off + h && strOff < off + h + len) { tagOff = off; tagLen = len; tagH = h; tagCode = code; break; }
    off += h + len;
  }
  if (tagOff < 0) throw new Error('Enclosing DoInitAction/DoAction not found');
  if (tagH !== 6) throw new Error('Tag not long-form (unexpected)');

  // ConstantPool action: DoInitAction has a UI16 spriteID before the actions; DoAction doesn't.
  const cpOff = tagOff + tagH + (tagCode === 59 ? 2 : 0);
  if (body[cpOff] !== 0x88) throw new Error('First action is not ConstantPool (got 0x' + body[cpOff].toString(16) + ')');
  const cpLen = body.readUInt16LE(cpOff + 1);

  body = Buffer.concat([body.slice(0, strOff), Buffer.from(NEW, 'latin1'), body.slice(strOff + OLD.length)]);
  if (cpLen + DELTA > 0xffff) throw new Error('ConstantPool would overflow UI16');
  body.writeUInt16LE(cpLen + DELTA, cpOff + 1);
  body.writeUInt32LE(tagLen + DELTA, tagOff + 2);
  console.log('Label "' + OLD + '" → "' + NEW + '" (Δ' + DELTA + ') in tag code ' + tagCode + ' @' + tagOff);
  console.log('Wrote', SWF, '(' + writeSwf(SWF, sig, version, body) + ' bytes)');
}

patch();
