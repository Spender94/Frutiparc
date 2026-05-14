#!/usr/bin/env node
// Patches legacy/main.swf so that drag-dropping a contact onto a custom
// sub-folder of "Mes contacts" actually moves the contact server-side.
//
// Background:
//   ContactList (frutiparc/ContactList.as) extends IconFileBox but
//   overrides onDrop with an empty `// TODO` body. The compiled SWF
//   contains that empty function on ContactList.prototype.onDrop, which
//   shadows the working IconFileBox.prototype.onDrop on every drop.
//   Drops on contact sub-folders therefore disappear silently — no HTTP
//   request is fired and no contact is reassigned.
//
//   IconFileBox.prototype.onDrop does the right thing for folder icons
//   (`fileMng.move(ico.uid, this.uid)`), so the simplest fix is to
//   make sure the empty override is never installed on the prototype.
//
// The patch:
//   In ContactList's ConstantPool, rename the "onDrop" property name to
//   "_nDrop". The class body still runs `prototype._nDrop = function(){}`
//   (harmless dead property), but `prototype.onDrop` stays undefined, so
//   `instance.onDrop` resolves up the prototype chain to
//   IconFileBox.prototype.onDrop — the real implementation.
//
//   Same byte count ("onDrop" / "_nDrop" are both 6 chars), so no tag or
//   sprite length needs to be touched. The patch is fully idempotent.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SWF_PATH = path.resolve(__dirname, '..', 'legacy', 'main.swf');

const NEEDLE  = Buffer.from('onKill\0onDrop\0addFile\0', 'latin1');
const REPLACE = Buffer.from('onKill\0_nDrop\0addFile\0', 'latin1');

function readSwf(filePath) {
  const raw = fs.readFileSync(filePath);
  const sig = raw.slice(0, 3).toString('ascii');
  if (sig !== 'CWS' && sig !== 'FWS') throw new Error('Unsupported SWF sig: ' + sig);
  const version = raw[3];
  const body = sig === 'CWS' ? zlib.inflateSync(raw.slice(8)) : Buffer.from(raw.slice(8));
  return { sig, version, body };
}

function writeSwf(outPath, sig, version, body) {
  const fileLen = 8 + body.length;
  const payload = sig === 'CWS' ? zlib.deflateSync(body) : body;
  const out = Buffer.alloc(8 + payload.length);
  out.write(sig, 0, 'ascii');
  out.writeUInt8(version, 3);
  out.writeUInt32LE(fileLen, 4);
  payload.copy(out, 8);
  fs.writeFileSync(outPath, out);
  return out.length;
}

function patch() {
  const { sig, version, body } = readSwf(SWF_PATH);

  if (body.indexOf(REPLACE) >= 0) {
    console.log('ContactList.onDrop override already disabled — skipping.');
    return;
  }

  const idx = body.indexOf(NEEDLE);
  if (idx < 0) {
    throw new Error("ContactList CP signature 'onKill\\0onDrop\\0addFile\\0' not found — SWF structure changed");
  }

  // Sanity: the needle should appear exactly once (it is a class-specific CP
  // run; other classes interleave different strings between onKill and onDrop).
  const second = body.indexOf(NEEDLE, idx + 1);
  if (second >= 0) {
    throw new Error('Unexpected duplicate of ContactList CP signature at ' + second);
  }

  REPLACE.copy(body, idx);

  const outSize = writeSwf(SWF_PATH, sig, version, body);
  console.log(`Patched ContactList CP at offset ${idx}: "onDrop" → "_nDrop"`);
  console.log(`Drops on contact sub-folders will now fall through to IconFileBox.prototype.onDrop → fileMng.move.`);
  console.log(`Wrote ${SWF_PATH} (${outSize} bytes)`);
}

patch();
