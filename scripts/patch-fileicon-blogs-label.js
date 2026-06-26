#!/usr/bin/env node
// Fix the Frutiblogs desktop icon GRAPHIC.
//
// public/fileIcon.swf holds the desktop icon images as frames of an icon clip,
// each labelled by the icon's uid: linkForum, linkChat, linkShop, linkHisto,
// linkScore, linkPreference, linkClub… The blog icon's frame, however, is
// mislabelled "blogs" while main.swf's icon uid is "linkBlogs" — so the lookup
// (gotoAndStop(uid)) misses and falls back to the "default" frame (the "?").
//
// Rename the FrameLabel "blogs" → "linkBlogs" so the real (book) icon shows.
//
// SWF FrameLabel tag (code 43) here is long-form: FF 0A <UI32 len> <label\0>.
// "blogs\0" (6) → "linkBlogs\0" (10): +4 bytes → bump the tag's UI32 length, the
// enclosing DefineSprite's UI32 length, and the SWF file-length header.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SWF = path.resolve(__dirname, '..', 'public', 'fileIcon.swf');
const OLD_TAG = Buffer.from([0xFF, 0x0A, 0x06, 0x00, 0x00, 0x00, 0x62, 0x6C, 0x6F, 0x67, 0x73, 0x00]); // FrameLabel len6 "blogs\0"
const NEW_TAG = Buffer.from([0xFF, 0x0A, 0x0A, 0x00, 0x00, 0x00, 0x6C, 0x69, 0x6E, 0x6B, 0x42, 0x6C, 0x6F, 0x67, 0x73, 0x00]); // FrameLabel len10 "linkBlogs\0"
const DELTA = NEW_TAG.length - OLD_TAG.length; // +4

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
  if (body.indexOf(NEW_TAG) >= 0) { console.log('Already patched — skipping.'); return; }

  const at = body.indexOf(OLD_TAG);
  if (at < 0) throw new Error('"blogs" FrameLabel tag not found');
  if (body.indexOf(OLD_TAG, at + 1) >= 0) throw new Error('"blogs" FrameLabel tag not unique — aborting');

  // Enclosing DefineSprite (code 39) that contains the tag.
  const nbits = (body[0] >> 3) & 0x1f;
  let off = Math.ceil((5 + nbits * 4) / 8) + 4;
  let spOff = -1, spLen = 0, spH = 0;
  while (off < body.length) {
    const hdr = body.readUInt16LE(off); const code = hdr >> 6; let len = hdr & 0x3f; let h = 2;
    if (len === 0x3f) { len = body.readUInt32LE(off + 2); h = 6; }
    if (code === 0) break;
    if (code === 39 && at >= off + h && at < off + h + len) { spOff = off; spLen = len; spH = h; break; }
    off += h + len;
  }
  if (spOff < 0 || spH !== 6) throw new Error('Enclosing DefineSprite not found / not long-form');

  // Splice the longer tag in, then bump DefineSprite + file lengths.
  body = Buffer.concat([body.slice(0, at), NEW_TAG, body.slice(at + OLD_TAG.length)]);
  body.writeUInt32LE(spLen + DELTA, spOff + 2);
  console.log('FrameLabel "blogs" → "linkBlogs" at', at);
  console.log('  DefineSprite @' + spOff + ' len ' + spLen + ' → ' + (spLen + DELTA));
  console.log('Wrote', SWF, '(' + writeSwf(SWF, sig, version, body) + ' bytes)');
}

patch();
