#!/usr/bin/env node
// Patches legacy/main.swf to make moderator "!" shouts appear in red bold
// across the whole chat line (timestamp + pseudo + message).
//
// The chat panel uses two format strings stored in an ActionConstantPool inside
// a DefineSprite > DoAction tag:
//   chat.msg       = $h<b><a href="asfunction:win.box.openFrutizInfo,$u">$u</a>: </b>$m
//   chat.msg_admin = $h<i>$m</i>
//
// The server sends moderator shouts via u="admin" t="m" — that triggers the
// admin format. We rewrite that format so the whole line is wrapped in a red
// <font> tag (timestamp red but not bold; rest red+bold via <b>).
//
// Old: $h<i>$m</i>                                   (12 bytes)
// New: <font color="#C10000">$h<b>$m</b></font>     (40 bytes, delta +28)
//
// The patch updates:
//   - the constant pool blob
//   - the ActionConstantPool payload length (UI16)
//   - the enclosing DoAction tag length (UI32 long-form)
//   - the enclosing DefineSprite tag length (UI32 long-form)
//   - the SWF file length header

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OLD_STR = '$h<i>$m</i>';
const NEW_STR = '<font color="#C10000">$h<b>$m</b></font>';
const DELTA = NEW_STR.length - OLD_STR.length;

const IN_PATH  = path.resolve(__dirname, '..', 'legacy', 'main.swf');
const OUT_PATH = path.resolve(__dirname, '..', 'legacy', 'main.swf');

function readSwf(filePath) {
  const raw = fs.readFileSync(filePath);
  const sig = raw.slice(0, 3).toString('ascii');
  if (sig !== 'CWS' && sig !== 'FWS') throw new Error('Unsupported sig: ' + sig);
  const version = raw[3];
  let body;
  if (sig === 'CWS') body = zlib.inflateSync(raw.slice(8));
  else body = Buffer.from(raw.slice(8));
  return { sig, version, body };
}

function writeSwf(outPath, sig, version, newBody) {
  const newFileLen = 8 + newBody.length;
  let payload;
  if (sig === 'CWS') {
    payload = zlib.deflateSync(newBody);
  } else {
    payload = newBody;
  }
  const out = Buffer.alloc(8 + payload.length);
  out.write(sig, 0, 'ascii');
  out.writeUInt8(version, 3);
  out.writeUInt32LE(newFileLen, 4);
  payload.copy(out, 8);
  fs.writeFileSync(outPath, out);
  return out.length;
}

function patch() {
  const { sig, version, body } = readSwf(IN_PATH);

  // Check if already patched
  const alreadyNeedle = Buffer.from(NEW_STR + '\0', 'ascii');
  if (body.indexOf(alreadyNeedle) >= 0) {
    console.log('chat.msg_admin already patched — skipping.');
    return;
  }

  // Locate the OLD string in the body (it's null-terminated inside the CP)
  const needle = Buffer.from(OLD_STR + '\0', 'ascii');
  const strOff = body.indexOf(needle);
  if (strOff < 0) throw new Error('chat.msg_admin format string not found');

  // Walk top-level tags to find the DefineSprite that contains strOff
  const nbits = (body[0] >> 3) & 0x1f;
  const rectBytes = Math.ceil((5 + nbits * 4) / 8);
  let off = rectBytes + 4;

  let spriteTagOff = -1, spriteTagLen = 0, spriteHdrSize = 0;
  while (off < body.length) {
    const hdr = body.readUInt16LE(off);
    const code = hdr >> 6;
    let len = hdr & 0x3f;
    let hSize = 2;
    if (len === 0x3f) { len = body.readUInt32LE(off + 2); hSize = 6; }
    if (code === 0) break;
    if (code === 39 && strOff >= off + hSize && strOff < off + hSize + len) {
      spriteTagOff = off;
      spriteTagLen = len;
      spriteHdrSize = hSize;
      break;
    }
    off += hSize + len;
  }
  if (spriteTagOff < 0) throw new Error('Enclosing DefineSprite not found');

  // Walk sub-tags inside the sprite (skip 4-byte sprite header: id + frameCount)
  const subStart = spriteTagOff + spriteHdrSize + 4;
  const subEnd   = spriteTagOff + spriteHdrSize + spriteTagLen;
  let doActOff = -1, doActLen = 0, doActHdrSize = 0;
  let p = subStart;
  while (p < subEnd) {
    const hdr = body.readUInt16LE(p);
    const code = hdr >> 6;
    let len = hdr & 0x3f;
    let hSize = 2;
    if (len === 0x3f) { len = body.readUInt32LE(p + 2); hSize = 6; }
    if (code === 0) break;
    if (code === 12 && strOff >= p + hSize && strOff < p + hSize + len) {
      doActOff = p;
      doActLen = len;
      doActHdrSize = hSize;
      break;
    }
    p += hSize + len;
  }
  if (doActOff < 0) throw new Error('Enclosing DoAction not found');

  // First action in DoAction body should be ActionConstantPool (0x88)
  const cpActionOff = doActOff + doActHdrSize;
  if (body[cpActionOff] !== 0x88) {
    throw new Error('First action is not ConstantPool');
  }
  const cpPayloadLen = body.readUInt16LE(cpActionOff + 1);

  // Sanity check
  console.log('Found chat.msg_admin format at offset', strOff);
  console.log('  DefineSprite at', spriteTagOff, 'len', spriteTagLen);
  console.log('  DoAction     at', doActOff, 'len', doActLen);
  console.log('  ConstantPool payload len:', cpPayloadLen);
  console.log('  Old string:', JSON.stringify(OLD_STR));
  console.log('  New string:', JSON.stringify(NEW_STR));
  console.log('  Delta:', DELTA, 'bytes');

  // Build new body
  const before  = body.slice(0, strOff);
  const after   = body.slice(strOff + OLD_STR.length); // keep the trailing \0 untouched
  const newBody = Buffer.concat([before, Buffer.from(NEW_STR, 'ascii'), after]);

  // Update ConstantPool payload length (UI16)
  const newCpLen = cpPayloadLen + DELTA;
  if (newCpLen > 0xFFFF) throw new Error('CP payload would overflow UI16');
  newBody.writeUInt16LE(newCpLen, cpActionOff + 1);

  // Update DoAction tag length (UI32, long form)
  if (doActHdrSize !== 6) throw new Error('DoAction must be long-form');
  newBody.writeUInt32LE(doActLen + DELTA, doActOff + 2);

  // Update DefineSprite tag length (UI32, long form)
  if (spriteHdrSize !== 6) throw new Error('DefineSprite must be long-form');
  newBody.writeUInt32LE(spriteTagLen + DELTA, spriteTagOff + 2);

  // Write back
  const outSize = writeSwf(OUT_PATH, sig, version, newBody);
  console.log('Wrote', OUT_PATH, '(' + outSize + ' bytes)');
}

patch();
