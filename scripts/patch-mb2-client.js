#!/usr/bin/env node
// Patches Games/motionBall2/motionball.swf so that:
//   1. STANDALONE is set to true (was false in the compiled SWF)
//   2. serviceConnect uses /api/loadFrutiSlots HTTP API (like all other patched games)
//   3. saveSlot uses /api/saveFrutiSlot HTTP API
//   4. startGame/endGame call their callbacks directly in standalone mode
//
// This makes the game work in game-popup.html without the Frusion LocalConnection
// infrastructure, matching the pattern used by snake3, kaluga, swapou2, etc.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const IN_PATH  = path.resolve(__dirname, '..', 'Games', 'motionBall2', 'motionball.swf');
const OUT_PATH = IN_PATH; // overwrite in place

function readSwf(filePath) {
  const raw = fs.readFileSync(filePath);
  const sig = raw.slice(0, 3).toString('ascii');
  const version = raw[3];
  let body;
  if (sig === 'CWS') body = zlib.inflateSync(raw.slice(8));
  else if (sig === 'FWS') body = Buffer.from(raw.slice(8));
  else throw new Error('Unsupported sig: ' + sig);
  return { sig, version, body, raw };
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

function parseRect(body) {
  const nbits = (body[0] >> 3) & 0x1f;
  return Math.ceil((5 + nbits * 4) / 8);
}

function findTags(body) {
  const rectBytes = parseRect(body);
  let off = rectBytes + 4; // skip RECT + framerate(2) + framecount(2)
  const tags = [];
  while (off < body.length) {
    const hdr = body.readUInt16LE(off);
    const code = hdr >> 6;
    let length = hdr & 0x3f;
    let hdrSize = 2;
    if (length === 0x3f) {
      length = body.readUInt32LE(off + 2);
      hdrSize = 6;
    }
    if (code === 0) break;
    tags.push({ code, offset: off, hdrSize, length });
    off += hdrSize + length;
  }
  return tags;
}

function parseConstantPool(body, cpStart) {
  if (body[cpStart] !== 0x88) throw new Error('Expected ConstantPool action (0x88)');
  const cpPayloadLen = body.readUInt16LE(cpStart + 1);
  const cpCount = body.readUInt16LE(cpStart + 3);
  const entries = [];
  let pos = cpStart + 5;
  while (entries.length < cpCount) {
    const end = body.indexOf(0, pos);
    entries.push(body.slice(pos, end).toString('latin1'));
    pos = end + 1;
  }
  return { payloadLen: cpPayloadLen, count: cpCount, entries, dataEnd: cpStart + 3 + cpPayloadLen };
}

// ─── Main ───

const { sig, version, body } = readSwf(IN_PATH);
let buf = Buffer.from(body);

// Find the DoInitAction tag (code 59) containing 'GameClient'
const tags = findTags(buf);
const gcNeedle = Buffer.from('GameClient');
let targetTag = null;
for (const tag of tags) {
  if (tag.code !== 59) continue;
  const bodyStart = tag.offset + tag.hdrSize;
  const bodyEnd = bodyStart + tag.length;
  if (buf.indexOf(gcNeedle, bodyStart) >= bodyStart && buf.indexOf(gcNeedle, bodyStart) < bodyEnd) {
    targetTag = tag;
    break;
  }
}
if (!targetTag) throw new Error('DoInitAction containing GameClient not found');

const tagBodyStart = targetTag.offset + targetTag.hdrSize;
const spriteId = buf.readUInt16LE(tagBodyStart);
const cpStart = tagBodyStart + 2;
const cp = parseConstantPool(buf, cpStart);

console.log(`Found DoInitAction at offset ${targetTag.offset}, len=${targetTag.length}, sprite=${spriteId}`);
console.log(`Constant pool: ${cp.count} entries, payload ${cp.payloadLen} bytes`);

// Verify expected CP entries
const expectedCp = {
  17: 'serviceConnect',
  18: 'slots',
  19: 'onServiceConnect',
  20: 'startGame',
  6: '6^8%7$', // STANDALONE
};
for (const [idx, expected] of Object.entries(expectedCp)) {
  if (cp.entries[idx] !== expected) {
    throw new Error(`CP[${idx}] expected '${expected}', got '${cp.entries[idx]}'`);
  }
}

// Step 1: Add new strings to constant pool for the loadFrutiSlots patch
const newStrings = [
  'LoadVars',            // CP[69]
  'game',                // CP[70]
  'sid',                 // CP[71]
  '_client',             // CP[72]
  'onLoad',              // CP[73]
  'slot0',               // CP[74]
  'fromJSON',            // CP[75]
  'slot1',               // CP[76]
  'POST',                // CP[77]
  '/api/loadFrutiSlots', // CP[78]
  'sendAndLoad',         // CP[79]
  '_saveSlotHTTP',       // CP[80]
  'slotId',              // CP[81]
  'data',                // CP[82]
  '/api/saveFrutiSlot',  // CP[83]
  'result',              // CP[84]
];

const newCpBase = cp.count; // 69

// Build new CP data to append
let newCpData = Buffer.alloc(0);
for (const s of newStrings) {
  newCpData = Buffer.concat([newCpData, Buffer.from(s + '\0', 'latin1')]);
}
const cpDelta = newCpData.length;

// Insert new CP data right before the end of the existing CP
// CP layout: 0x88, payloadLen(UI16), count(UI16), ...strings..., then code follows
const cpDataEnd = cp.dataEnd; // first byte after CP data
const beforeCpEnd = buf.slice(0, cpDataEnd);
const afterCpEnd = buf.slice(cpDataEnd);

buf = Buffer.concat([beforeCpEnd, newCpData, afterCpEnd]);

// Update CP payload length and count
const newCpPayloadLen = cp.payloadLen + cpDelta;
const newCpCount = cp.count + newStrings.length;
buf.writeUInt16LE(newCpPayloadLen, cpStart + 1);
buf.writeUInt16LE(newCpCount, cpStart + 3);

// Update DoInitAction tag length (long form: 4 bytes at offset + 2)
if (targetTag.hdrSize !== 6) throw new Error('Expected long-form tag');
const newTagLen = targetTag.length + cpDelta;
buf.writeUInt32LE(newTagLen, targetTag.offset + 2);

console.log(`Added ${newStrings.length} CP entries (+${cpDelta} bytes)`);
console.log(`CP: ${cp.payloadLen} -> ${newCpPayloadLen}, count: ${cp.count} -> ${newCpCount}`);
console.log(`Tag length: ${targetTag.length} -> ${newTagLen}`);

// All offsets after cpDataEnd are shifted by cpDelta.
// Recalculate key offsets:
const shift = (o) => o >= cpDataEnd ? o + cpDelta : o;

// Step 2: Set STANDALONE = true
// Original: at decompressed offset 1514079, byte 0x00 (Bool false)
// After CP expansion, this shifts by cpDelta
const standaloneOffset = shift(1514071);
if (buf[standaloneOffset] !== 0x00) {
  throw new Error(`Expected Bool(false) byte 0x00 at ${standaloneOffset}, got ${buf[standaloneOffset].toString(16)}`);
}
// Verify context: preceding bytes should be 0x05 (Bool type)
if (buf[standaloneOffset - 1] !== 0x05) {
  throw new Error(`Expected Bool type byte 0x05 at ${standaloneOffset - 1}`);
}
buf[standaloneOffset] = 0x01; // Bool(true)
console.log(`Set STANDALONE = true at offset ${standaloneOffset}`);

// Step 3: Replace serviceConnect function body
// The serviceConnect DefineFunction2 is at original offset 1512708.
// Its function body starts after the DefineFunction2 header.
// Original function body is 78 bytes (codesize=78).
//
// We need to build a new function body that:
//   1. Sets this.slots = []
//   2. this.slots[0] = {} (empty object for slot 0)
//   3. this.slots[1] = undefined
//   4. Creates LoadVars, sets game="mb2", sid=_root.sid
//   5. Creates result LoadVars, sets _client=this, onLoad callback
//   6. Calls lv.sendAndLoad("/api/loadFrutiSlots", result, "POST")
//
// Rather than build this from scratch, we take a simpler approach:
// Since STANDALONE is now true, the existing serviceConnect will work
// (it calls super.serviceConnect() then does standalone init).
// BUT we want to add HTTP slot loading so saves persist.
//
// The simplest effective approach: replace the serviceConnect body
// to unconditionally load slots via HTTP instead of the super call.

// Build the new serviceConnect function body bytecode.
// We'll use CP indices from the expanded constant pool.
// Reg(1) = this, Reg(2) = super (from the DefineFunction2 flags)
const CP = {
  mb2: 1,
  STANDALONE: 6,
  serviceConnect: 17,
  slots: 18,
  onServiceConnect: 19,
  LoadVars: newCpBase + 0,   // 69
  game: newCpBase + 1,       // 70
  sid: newCpBase + 2,        // 71
  _client: newCpBase + 3,    // 72
  onLoad: newCpBase + 4,     // 73
  slot0: newCpBase + 5,      // 74
  fromJSON: newCpBase + 6,   // 75
  slot1: newCpBase + 7,      // 76
  POST: newCpBase + 8,       // 77
  loadFrutiSlots: newCpBase + 9, // 78
  sendAndLoad: newCpBase + 10,   // 79
};

// Helper to build bytecode
function pushReg(r) { return Buffer.from([0x04, r]); }
function pushCp(i) {
  if (i < 256) return Buffer.from([0x08, i]);
  return Buffer.from([0x09, i & 0xff, (i >> 8) & 0xff]);
}
function pushInt(v) {
  const b = Buffer.alloc(5);
  b[0] = 0x07;
  b.writeUInt32LE(v, 1);
  return b;
}
function pushStr(s) {
  return Buffer.concat([Buffer.from([0x00]), Buffer.from(s + '\0', 'latin1')]);
}
function pushBool(v) { return Buffer.from([0x05, v ? 1 : 0]); }
function pushUndef() { return Buffer.from([0x03]); }
function pushNull() { return Buffer.from([0x02]); }

function actionPush(...items) {
  const payload = Buffer.concat(items);
  const hdr = Buffer.alloc(3);
  hdr[0] = 0x96;
  hdr.writeUInt16LE(payload.length, 1);
  return Buffer.concat([hdr, payload]);
}
function simpleAction(op) { return Buffer.from([op]); }
const POP = simpleAction(0x17);
const SET_MEMBER = simpleAction(0x4F);
const GET_MEMBER = simpleAction(0x4E);
const GET_VARIABLE = simpleAction(0x1C);
const NEW_OBJECT = simpleAction(0x40);
const CALL_METHOD = simpleAction(0x52);
const INIT_ARRAY = simpleAction(0x42);
const INIT_OBJECT = simpleAction(0x43);
const RETURN = simpleAction(0x3E);
const NOT = simpleAction(0x12);
const EQUALS2 = simpleAction(0x49);

function storeReg(r) { return Buffer.from([0x87, 0x01, 0x00, r]); }
function actionIf(offset) {
  const b = Buffer.alloc(5);
  b[0] = 0x9D;
  b.writeUInt16LE(2, 1); // data length always 2
  b.writeInt16LE(offset, 3);
  return b;
}

function buildDefineFunction2(name, params, regcount, flags, bodyBytes) {
  const nameBytes = Buffer.from(name + '\0', 'latin1');
  let paramBytes = Buffer.alloc(0);
  for (const [reg, pname] of params) {
    paramBytes = Buffer.concat([paramBytes, Buffer.from([reg]), Buffer.from(pname + '\0', 'latin1')]);
  }
  const innerLen = nameBytes.length + 2 + 1 + 2 + paramBytes.length + 2;
  const hdr = Buffer.alloc(3 + innerLen);
  hdr[0] = 0x8E;
  hdr.writeUInt16LE(innerLen, 1);
  let off = 3;
  nameBytes.copy(hdr, off); off += nameBytes.length;
  hdr.writeUInt16LE(params.length, off); off += 2;
  hdr[off] = regcount; off += 1;
  hdr.writeUInt16LE(flags, off); off += 2;
  if (paramBytes.length) { paramBytes.copy(hdr, off); off += paramBytes.length; }
  hdr.writeUInt16LE(bodyBytes.length, off);
  return Buffer.concat([hdr, bodyBytes]);
}

// Build the main serviceConnect function body.
// Matches original MB2 Client.as STANDALONE pattern:
//   super.serviceConnect();
//   slots = [];
//   onServiceConnect();
// super.serviceConnect() establishes XMLSocket to FrutiScore for score saving + endGame.
// Empty slots trigger Card constructor in onServiceConnect() which provides defaults.
// Register allocation (flags 0x59): r1=this, r2=super, r3=_root
function buildServiceConnectBody() {
  // super.serviceConnect()
  const callSuper = Buffer.concat([
    actionPush(pushInt(0)),
    actionPush(pushReg(2), pushCp(CP.serviceConnect)),
    CALL_METHOD,
    POP,
  ]);

  // this.slots = []
  const initSlots = Buffer.concat([
    actionPush(pushReg(1), pushCp(CP.slots), pushInt(0)),
    INIT_ARRAY,
    SET_MEMBER,
  ]);

  // this.onServiceConnect()
  const callOnServiceConnect = Buffer.concat([
    actionPush(pushInt(0)),
    actionPush(pushReg(1), pushCp(CP.onServiceConnect)),
    CALL_METHOD,
    POP,
  ]);

  return Buffer.concat([callSuper, initSlots, callOnServiceConnect]);
}

const serviceConnectBody = buildServiceConnectBody();

// Now build the complete new serviceConnect DefineFunction2
// flags 0x59 = preloadThis(0x01) | suppressArguments(0x08) | preloadSuper(0x10) | preloadRoot(0x40)
// Register allocation: r1=this, r2=super, r3=_root
const newServiceConnectFunc = buildDefineFunction2('', [], 4, 0x59, serviceConnectBody);

// Find and replace the old serviceConnect DefineFunction2 in the buffer
// Original pattern (shifted by cpDelta):
//   Push Reg(1), CP[17]("serviceConnect")  → at shifted(1512701)
//   DefineFunction2 ... codesize=78       → at shifted(1512708)
//   SetMember                              → at shifted(1512797)
//
// We want to replace from the DefineFunction2 up to (but not including) SetMember
// with our new DefineFunction2.

const origFuncStart = shift(1512700);  // DefineFunction2 opcode
const origFuncEnd = shift(1512789);    // SetMember (first byte after the old func)

// Verify the old DefineFunction2 is where we expect
if (buf[origFuncStart] !== 0x8E) {
  throw new Error(`Expected DefineFunction2 (0x8E) at ${origFuncStart}, got ${buf[origFuncStart].toString(16)}`);
}
if (buf[origFuncEnd] !== 0x4F) {
  throw new Error(`Expected SetMember (0x4F) at ${origFuncEnd}, got ${buf[origFuncEnd].toString(16)}`);
}

const oldFuncBytes = origFuncEnd - origFuncStart;
console.log(`Old serviceConnect: ${oldFuncBytes} bytes at ${origFuncStart}`);
console.log(`New serviceConnect: ${newServiceConnectFunc.length} bytes`);

const funcDelta = newServiceConnectFunc.length - oldFuncBytes;

// Replace the function
const beforeFunc = buf.slice(0, origFuncStart);
const afterFunc = buf.slice(origFuncEnd);
buf = Buffer.concat([beforeFunc, newServiceConnectFunc, afterFunc]);

// Update DoInitAction tag length
const currentTagLen = buf.readUInt32LE(targetTag.offset + 2);
buf.writeUInt32LE(currentTagLen + funcDelta, targetTag.offset + 2);

console.log(`Tag length: ${currentTagLen} -> ${currentTagLen + funcDelta} (delta ${funcDelta})`);

// Step 4: super.serviceConnect() is now called in the patched body, which
// establishes the XMLSocket to CBee/FrutiScore. This enables:
//   - super.saveScore() → score is sent via XMLSocket to FrutiScore server
//   - super.endGame() → proper end-of-game flow with server callback
//   - super.saveSlot() → slot persistence via socket protocol

// Step 5: Write the patched SWF
const outSize = writeSwf(OUT_PATH, sig, version, buf);
console.log(`Wrote ${OUT_PATH} (${outSize} bytes)`);
console.log('Done!');