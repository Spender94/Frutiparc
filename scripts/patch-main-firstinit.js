#!/usr/bin/env node
// Patches legacy/main.swf to bypass the `if(this != _root)` guard in
// compiled first.as so the initialization block always runs.
//
// Background: main.swf was designed to be loaded into a child clip by a
// loader SWF, where `this != _root` is true. When Ruffle loads main.swf
// directly, `this == _root`, and the guard skips the entire first.as
// initialization — _global.mcw, _global.mch, StageResize listener, and
// _root._x/_y are never set.
//
// The guard is an ActionIf instruction (opcode 0x9d) at the end of:
//   Push 'this'; GetVariable; Push '_root'; GetVariable;
//   Equals2; Not; Not; If(offset=0x0105)
//
// When `this == _root`, the double-not produces TRUE, and ActionIf jumps
// 0x0105 bytes forward, skipping the init block.
//
// Fix: change the jump offset from 0x0105 to 0x0000. This makes the
// jump a no-op (0 bytes forward = fall through), so the block always runs.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const IN_PATH  = path.resolve(__dirname, '..', 'legacy', 'main.swf');
const OUT_PATH = IN_PATH;

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
  const payload = sig === 'CWS' ? zlib.deflateSync(newBody) : newBody;
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

  // Find the pattern: Push 'this', GetVar, Push '_root', GetVar,
  // Equals2, Not, Not, If(offset)
  //
  // Bytecode sequence (first.as CP has this=CP[0], _root=CP[1]):
  //   96 02 00 08 00  Push CP[0]='this'
  //   1c              GetVariable
  //   96 02 00 08 01  Push CP[1]='_root'
  //   1c              GetVariable
  //   49              Equals2
  //   12              Not
  //   12              Not
  //   9d 02 00 XX XX  If offset
  //
  // Total pattern before the offset bytes: 17 bytes + 3 byte If header = 20 bytes
  // We need to find this pattern and zero the offset.

  // Search for the Equals2+Not+Not+If pattern after two Push+GetVariable pairs
  const thisRootCheck = Buffer.from([
    0x96, 0x02, 0x00, 0x08, 0x00, // Push CP[0]='this'
    0x1c,                          // GetVariable
    0x96, 0x02, 0x00, 0x08, 0x01, // Push CP[1]='_root'
    0x1c,                          // GetVariable
    0x49,                          // Equals2
    0x12,                          // Not
    0x12,                          // Not
    0x9d, 0x02, 0x00               // If (3-byte header)
  ]);

  let off = body.indexOf(thisRootCheck);
  if (off < 0) {
    // Also try with different CP indices — search for the Not+Not+If pattern
    // near the baseMcw string
    const baseMcwStr = Buffer.from('baseMcw\0', 'ascii');
    const baseMcwOff = body.indexOf(baseMcwStr);
    if (baseMcwOff < 0) throw new Error('baseMcw not found');

    // Search backward for Not+Not+If
    for (let i = baseMcwOff; i > baseMcwOff - 200; i--) {
      if (body[i] === 0x12 && body[i+1] === 0x12 && body[i+2] === 0x9d && body[i+3] === 0x02 && body[i+4] === 0x00) {
        const jumpOff = body.readInt16LE(i + 5);
        if (jumpOff > 100) {
          console.log('[first-init] Found Not+Not+If at 0x' + i.toString(16) + ' jump=' + jumpOff);
          off = i - 13; // estimate position of full pattern
          break;
        }
      }
    }
    if (off < 0) throw new Error('if(this != _root) pattern not found');
  }

  // The If offset is at off + thisRootCheck.length (2 bytes, little-endian)
  const ifOffsetPos = off + thisRootCheck.length;
  const oldJump = body.readInt16LE(ifOffsetPos);

  if (oldJump === 0) {
    console.log('[first-init] Already patched (If offset=0) — skipping.');
    return;
  }

  console.log('[first-init] Found if(this!=_root) guard at body offset 0x' + off.toString(16));
  console.log('[first-init] If jump offset: ' + oldJump + ' bytes (0x' + oldJump.toString(16) + ')');
  console.log('[first-init] Patching jump offset to 0 (block always executes)');

  body.writeInt16LE(0, ifOffsetPos);

  const totalLen = writeSwf(OUT_PATH, sig, version, body);
  console.log('[first-init] Wrote ' + OUT_PATH + ' (' + totalLen + ' bytes)');
}

patch();
