#!/usr/bin/env node
// Length-neutral rewrite of the hardcoded layout-width constants in main.swf.
//
// The deployed main.swf bakes the layout width as constants (set in init.as'
// onResize): _global.mcw = <W> and main.frusion.pos.x = <W-5>. The whole
// desktop keys off mcw (MainBar, wallpaper/desktop area width, frusion
// position). We rewrite them so the client lays out for the target area;
// ruffle.html sizes the Ruffle player to match (1380×719) and CSS-fits it to
// the viewport (crisp downscale on smaller screens). Because we only swap one
// int32 for another (same byte length), no action/tag offsets or jumps move —
// safe, reversible.
//
// NOTE: this is NOT true responsive reflow (mcw stays a constant). Making it
// dynamic (mcw = Stage.width) would require length-changing bytecode and is
// out of scope here.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const IN_PATH = path.resolve(__dirname, '..', 'legacy', 'main.swf');

// Each: rewrite `Push int32(from) ; SetMember` -> `Push int32(to) ; SetMember`.
const PATCHES = [
  { name: 'mcw',           from: 1670, to: 1380 },
  { name: 'frusion.pos.x', from: 1665, to: 1375 },
  { name: 'mch',           from: 870,  to: 719 },
];

function pushSetMember(v) {
  return Buffer.from([0x96, 0x05, 0x00, 0x07, v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff, 0x4f]);
}

const raw = fs.readFileSync(IN_PATH);
const sig = raw.slice(0, 3).toString('ascii');
if (sig !== 'CWS' && sig !== 'FWS') throw new Error('Unsupported SWF sig: ' + sig);
const version = raw[3];
let body = sig === 'CWS' ? zlib.inflateSync(raw.slice(8)) : Buffer.from(raw.slice(8));

let changed = false;
for (const p of PATCHES) {
  if (body.indexOf(pushSetMember(p.to)) >= 0) {
    console.log(`[${p.name}] already ${p.to} — skipping`);
    continue;
  }
  const oldSeq = pushSetMember(p.from);
  const hits = [];
  let i = 0;
  while ((i = body.indexOf(oldSeq, i)) >= 0) { hits.push(i); i++; }
  if (hits.length !== 1) {
    throw new Error(`[${p.name}] expected exactly 1 "Push ${p.from} + SetMember", found ${hits.length}`);
  }
  pushSetMember(p.to).copy(body, hits[0]);
  console.log(`[${p.name}] 0x${hits[0].toString(16)}: ${p.from} -> ${p.to}`);
  changed = true;
}

if (!changed) {
  console.log('Nothing to do.');
  process.exit(0);
}

const payload = sig === 'CWS' ? zlib.deflateSync(body) : body;
const out = Buffer.alloc(8 + payload.length);
out.write(sig, 0, 'ascii');
out.writeUInt8(version, 3);
out.writeUInt32LE(8 + body.length, 4); // uncompressed file length (unchanged)
payload.copy(out, 8);
fs.writeFileSync(IN_PATH, out);
console.log(`Wrote ${IN_PATH} (${out.length} bytes)`);
