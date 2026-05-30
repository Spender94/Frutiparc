#!/usr/bin/env node
// Patches legacy/main.swf so the chat command /image opens the image window
// locally (same handler as /testimg) instead of calling the broken sendImage
// which never transmits to the server.
//
// Background: in the SWF's slash-command chain (FPChat / blob#56), each
// command is a `Push r0; Push CP[name]; StrictEquals; ActionIf <off>` test.
// /image branches to a handler that calls sendImage(...) which is a no-op on
// the wire (confirmed: no <i> frame ever reaches the server in the logs).
// /testimg branches to a handler that calls loadMovie locally — that one
// works (a window opens with the image on the sender's desktop).
//
// This patch is a 2-byte, length-preserving edit: it rewrites the ActionIf
// jump offset for /image so it lands at /testimg's handler instead of its
// own. End result for the sender: /image now behaves like /testimg locally
// (opens the window for them). Broadcasting to the whole channel is a
// separate concern handled server-side / in a follow-up patch.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const IN_PATH  = path.resolve(__dirname, '..', 'legacy', 'main.swf');
const OUT_PATH = IN_PATH;

// Both ActionIf instructions sit inside the same ConstantPool (CP at body
// offset 164880, span 6223 bytes); /image is CP index 111 (0x6f),
// /testimg is CP index 113 (0x71). The byte pattern that ends each Push +
// StrictEquals + ActionIf header is unique within the file.
//
// Pattern we look for (6 bytes):
//   08 <idx>     end of a Push whose last value is "CP8 <idx>"
//   66           StrictEquals
//   9d 02 00     ActionIf header (payload length 2)
//   <off lo> <off hi>   signed int16 (jump offset from end of ActionIf)
const SLASH_IMG_IDX  = 0x6f;
const SLASH_TEST_IDX = 0x71;

function readSwf(filePath) {
  const raw = fs.readFileSync(filePath);
  const sig = raw.slice(0, 3).toString('ascii');
  if (sig !== 'CWS' && sig !== 'FWS') throw new Error('Unsupported sig: ' + sig);
  const version = raw[3];
  const body = sig === 'CWS' ? zlib.inflateSync(raw.slice(8)) : Buffer.from(raw.slice(8));
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

function findIfFor(body, cpIdx) {
  // Pattern: 08 <idx> 66 9d 02 00 <lo> <hi> — find every occurrence, return all
  // The CP-string "/image" or "/testimg" only appears in this exact chain in
  // blob #56 so there is only one match per index.
  const head = Buffer.from([0x08, cpIdx, 0x66, 0x9d, 0x02, 0x00]);
  const matches = [];
  let off = 0;
  while (true) {
    const p = body.indexOf(head, off);
    if (p < 0) break;
    const ifStart = p + 3;                // position of the 0x9d byte
    const offLE = body.readInt16LE(p + 6);
    const target = ifStart + 5 + offLE;   // ActionIf is 5 bytes total
                                          // (= p + 8 + offLE)
    matches.push({ patternOff: p, ifStart, currentOffset: offLE, target });
    off = p + 1;
  }
  return matches;
}

function patch() {
  const { sig, version, body } = readSwf(IN_PATH);

  const imgMatches  = findIfFor(body, SLASH_IMG_IDX);
  const testMatches = findIfFor(body, SLASH_TEST_IDX);

  if (imgMatches.length !== 1)
    throw new Error(`expected 1 /image ActionIf, got ${imgMatches.length}`);
  if (testMatches.length !== 1)
    throw new Error(`expected 1 /testimg ActionIf, got ${testMatches.length}`);

  const img = imgMatches[0];
  const test = testMatches[0];

  // New offset for /image's ActionIf so it jumps to /testimg's handler:
  //   target = test.target
  //   newOff = target - (img.ifStart + 5)
  const newOff = test.target - (img.ifStart + 5);
  if (newOff < -0x8000 || newOff > 0x7fff)
    throw new Error(`new offset ${newOff} does not fit signed int16`);

  if (img.currentOffset === newOff) {
    console.log('main.swf /image already redirected to /testimg handler — skipping.');
    return;
  }

  console.log(`[/image] ActionIf at 0x${img.ifStart.toString(16)}`);
  console.log(`         old offset = ${img.currentOffset} -> handler 0x${img.target.toString(16)}`);
  console.log(`         new offset = ${newOff} -> handler 0x${test.target.toString(16)} (= /testimg)`);

  // Length-preserving 2-byte rewrite of the offset field.
  const newBody = Buffer.from(body);
  newBody.writeInt16LE(newOff, img.ifStart + 3); // off bytes at ifStart+3, ifStart+4

  const size = writeSwf(OUT_PATH, sig, version, newBody);
  console.log(`main.swf re-packed (${size} bytes)`);
}

patch();
