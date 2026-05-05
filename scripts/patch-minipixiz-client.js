#!/usr/bin/env node
// Patches Games/miniTroll/minipixiz.swf so that:
//   1. STANDALONE is set to true (was false in the compiled SWF)
//   2. serviceConnect loads slots via HTTP (/api/loadFrutiSlots)
//   3. saveSlot persists via HTTP POST (/api/saveFrutiSlot)
//
// This makes the game work in game-popup.html without the Frusion
// LocalConnection infrastructure, and ensures slot data persists
// so that picto extraction can run on every save.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SWF_PATH = path.resolve(__dirname, '..', 'Games', 'miniTroll', 'minipixiz.swf');
const FULL_PATH = path.resolve(__dirname, '..', 'Games', 'miniTroll', 'full.swf');
const BACKUP_PATH = path.resolve(__dirname, '..', 'Games', 'miniTroll', 'minipixiz.swf.bak');

// ─── SWF read/write helpers ───

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

// ─── Bytecode builder helpers ───

function pushReg(r) { return Buffer.from([0x04, r]); }
function pushCp(i) {
  if (i < 256) return Buffer.from([0x08, i]);
  return Buffer.from([0x09, i & 0xff, (i >> 8) & 0xff]);
}
function pushInt(v) {
  const b = Buffer.alloc(5); b[0] = 0x07; b.writeUInt32LE(v, 1); return b;
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
const ADD2 = simpleAction(0x47);

function storeReg(r) { return Buffer.from([0x87, 0x01, 0x00, r]); }
function actionIf(offset) {
  const b = Buffer.alloc(5);
  b[0] = 0x9D;
  b.writeUInt16LE(2, 1);
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

// ─── Main ───

const { sig, version, body } = readSwf(SWF_PATH);
let buf = Buffer.from(body);

// Back up original
if (!fs.existsSync(BACKUP_PATH)) {
  fs.copyFileSync(SWF_PATH, BACKUP_PATH);
  console.log('Backed up original to', BACKUP_PATH);
}

// ─── Step 0: Find the DoAction tag ───
// The main code is in DoAction (code=12) at offset 1051659

const DOACTION_OFFSET = 1051659;
const tagHdr = buf.readUInt16LE(DOACTION_OFFSET);
const tagCode = tagHdr >> 6;
let origTagLen = tagHdr & 0x3f;
let tagHdrSize = 2;
if (origTagLen === 0x3f) {
  origTagLen = buf.readUInt32LE(DOACTION_OFFSET + 2);
  tagHdrSize = 6;
}
if (tagCode !== 12) throw new Error(`Expected DoAction (12) at ${DOACTION_OFFSET}, got ${tagCode}`);
console.log(`DoAction tag at ${DOACTION_OFFSET}, hdrSize=${tagHdrSize}, length=${origTagLen}`);

const tagBodyStart = DOACTION_OFFSET + tagHdrSize;

// ─── Step 1: Parse constant pool ───

const cpStart = tagBodyStart;
if (buf[cpStart] !== 0x88) throw new Error('Expected ConstantPool at ' + cpStart);
const origCpPayloadLen = buf.readUInt16LE(cpStart + 1);
const origCpCount = buf.readUInt16LE(cpStart + 3);
const cpDataEnd = cpStart + 3 + origCpPayloadLen;
console.log(`CP: ${origCpCount} entries, payload=${origCpPayloadLen}, dataEnd=${cpDataEnd}`);

// Verify key CP entries by parsing
let pos = cpStart + 5;
const cpEntries = [];
while (cpEntries.length < origCpCount) {
  const end = buf.indexOf(0, pos);
  cpEntries.push(buf.slice(pos, end).toString('latin1'));
  pos = end + 1;
}

// Verify known entries
const verify = { 174: 'saveSlot', 521: 'serviceConnect', 584: 'onServiceConnect', 756: 'slots', 754: 'data' };
for (const [idx, expected] of Object.entries(verify)) {
  if (cpEntries[idx] !== expected) {
    throw new Error(`CP[${idx}] expected '${expected}', got '${cpEntries[idx]}' — SWF structure changed`);
  }
}
console.log('CP verification passed');

// ─── Step 2: Add new CP entries ───

const newStrings = [
  'LoadVars',             // newCpBase + 0
  'game',                 // newCpBase + 1
  'sid',                  // newCpBase + 2
  '_client',              // newCpBase + 3
  'onLoad',               // newCpBase + 4
  'slot0',                // newCpBase + 5
  'fromJSON',             // newCpBase + 6
  'POST',                 // newCpBase + 7
  '/api/loadFrutiSlots',  // newCpBase + 8
  'sendAndLoad',          // newCpBase + 9
  '_saveSlotHTTP',        // newCpBase + 10
  'slotId',               // newCpBase + 11
  '/api/saveFrutiSlot',   // newCpBase + 12
  'result',               // newCpBase + 13
  'minipixiz',            // newCpBase + 14
  'send',                 // newCpBase + 15
];

const newCpBase = origCpCount;

let newCpData = Buffer.alloc(0);
for (const s of newStrings) {
  newCpData = Buffer.concat([newCpData, Buffer.from(s + '\0', 'latin1')]);
}
const cpDelta = newCpData.length;

// Insert new CP data right before end of existing CP
const beforeCpEnd = buf.slice(0, cpDataEnd);
const afterCpEnd = buf.slice(cpDataEnd);
buf = Buffer.concat([beforeCpEnd, newCpData, afterCpEnd]);

// Update CP header
const newCpPayloadLen = origCpPayloadLen + cpDelta;
const newCpCount = origCpCount + newStrings.length;
buf.writeUInt16LE(newCpPayloadLen, cpStart + 1);
buf.writeUInt16LE(newCpCount, cpStart + 3);

// Update DoAction tag length
if (tagHdrSize !== 6) throw new Error('Expected long-form DoAction tag');
const newTagLen = origTagLen + cpDelta;
buf.writeUInt32LE(newTagLen, DOACTION_OFFSET + 2);

console.log(`Added ${newStrings.length} CP entries (+${cpDelta} bytes)`);
console.log(`CP: ${origCpPayloadLen} → ${newCpPayloadLen}, count: ${origCpCount} → ${newCpCount}`);
console.log(`Tag length: ${origTagLen} → ${newTagLen}`);

// All offsets after cpDataEnd shift by cpDelta
const shift = (o) => o >= cpDataEnd ? o + cpDelta : o;

// ─── Step 3: Patch STANDALONE = true ───

const standaloneOffset = shift(1287500);
if (buf[standaloneOffset] === 0x00) {
  buf[standaloneOffset] = 0x01;
  console.log(`Set STANDALONE = true at offset ${standaloneOffset}`);
} else if (buf[standaloneOffset] === 0x01) {
  console.log('STANDALONE already true');
} else {
  throw new Error(`Unexpected byte at STANDALONE offset: 0x${buf[standaloneOffset].toString(16)}`);
}

// ─── Step 4: Replace serviceConnect function body ───
// Original: @1287521 (before shift), DefineFunction2 '', params=0, regs=2, flags=0x29, codeSize=155
// The Push before it is at @1287515 (before shift)
// After the function body: SetMember (0x4F) at 1287687 (before shift)

const CP = {
  saveSlot: 174,
  serviceConnect: 521,
  onServiceConnect: 584,
  data: 754,
  slots: 756,
  LoadVars: newCpBase + 0,
  game: newCpBase + 1,
  sid: newCpBase + 2,
  _client: newCpBase + 3,
  onLoad: newCpBase + 4,
  slot0: newCpBase + 5,
  fromJSON: newCpBase + 6,
  POST: newCpBase + 7,
  loadFrutiSlots: newCpBase + 8,
  sendAndLoad: newCpBase + 9,
  _saveSlotHTTP: newCpBase + 10,
  slotId: newCpBase + 11,
  saveFrutiSlot: newCpBase + 12,
  result: newCpBase + 13,
  minipixiz: newCpBase + 14,
  send: newCpBase + 15,
};

// Build the onLoad callback for serviceConnect:
// function(success) {           // r2 = success
//   var client = this._client;  // r3 = client
//   if (!success) { client.onServiceConnect(); return; }
//   if (this.slot0 !== undefined) {
//     var obj = client.fromJSON(this.slot0);  // r4 = obj
//     if (obj !== null) client.slots[0] = obj;
//   }
//   client.onServiceConnect();
// }

function buildOnLoadBody() {
  // r1=this, r2=success (param)
  const getClient = Buffer.concat([
    actionPush(pushReg(1), pushCp(CP._client)), GET_MEMBER, storeReg(3), POP,
  ]);

  const checkSuccess = Buffer.concat([
    actionPush(pushReg(2)), NOT,
  ]);

  const slot0Check = Buffer.concat([
    actionPush(pushReg(1), pushCp(CP.slot0)), GET_MEMBER,
    actionPush(pushUndef()), EQUALS2, NOT, NOT,
  ]);

  const slot0Load = Buffer.concat([
    actionPush(pushReg(1), pushCp(CP.slot0)), GET_MEMBER,
    actionPush(pushInt(1)),
    actionPush(pushReg(3), pushCp(CP.fromJSON)),
    CALL_METHOD, storeReg(4), POP,
  ]);

  const slot0NullCheck = Buffer.concat([
    actionPush(pushReg(4), pushNull()), EQUALS2, NOT, NOT,
  ]);

  const slot0Assign = Buffer.concat([
    actionPush(pushReg(3), pushCp(CP.slots)), GET_MEMBER,
    actionPush(pushInt(0)),
    actionPush(pushReg(4)),
    SET_MEMBER,
  ]);

  const callOnServiceConnect = Buffer.concat([
    actionPush(pushInt(0)),
    actionPush(pushReg(3), pushCp(CP.onServiceConnect)),
    CALL_METHOD, POP,
  ]);

  // Jump offsets
  const afterSuccessCheck = slot0Check.length + 5 + slot0Load.length + slot0NullCheck.length + 5 +
    slot0Assign.length;
  const slot0SkipSize = slot0Load.length + slot0NullCheck.length + 5 + slot0Assign.length;
  const slot0NullSkipSize = slot0Assign.length;

  return Buffer.concat([
    getClient,
    checkSuccess,
    actionIf(afterSuccessCheck),
    slot0Check,
    actionIf(slot0SkipSize),
    slot0Load,
    slot0NullCheck,
    actionIf(slot0NullSkipSize),
    slot0Assign,
    callOnServiceConnect,
  ]);
}

const onLoadBodyBytes = buildOnLoadBody();

// Build the main serviceConnect function body:
// flags=0x29: r1=this. We use GetVariable("_root") for _root access.
//
//   this.slots = []
//   this.slots[0] = {}
//   var lv = new LoadVars()        → r3 (we'll use StoreRegister)
//   lv.game = "minipixiz"
//   lv.sid = _root.sid
//   var result = new LoadVars()    → r4
//   result._client = this
//   result.onLoad = function(success) { ... }
//   lv.sendAndLoad("/api/loadFrutiSlots", result, "POST")

function buildServiceConnectBody() {
  const initSlots = Buffer.concat([
    actionPush(pushReg(1), pushCp(CP.slots), pushInt(0)),
    INIT_ARRAY,
    SET_MEMBER,
  ]);

  const initSlot0 = Buffer.concat([
    actionPush(pushReg(1), pushCp(CP.slots)),
    GET_MEMBER,
    actionPush(pushInt(0), pushInt(0)),
    INIT_OBJECT,
    SET_MEMBER,
  ]);

  // var lv = new LoadVars()
  const createLv = Buffer.concat([
    actionPush(pushInt(0), pushCp(CP.LoadVars)),
    NEW_OBJECT,
    storeReg(3),
    POP,
  ]);

  // lv.game = "minipixiz"
  const setGame = Buffer.concat([
    actionPush(pushReg(3), pushCp(CP.game), pushCp(CP.minipixiz)),
    SET_MEMBER,
  ]);

  // lv.sid = _root.sid
  // We need _root → Push "_root", GetVariable
  const setSid = Buffer.concat([
    actionPush(pushReg(3), pushCp(CP.sid)),
    actionPush(pushStr('_root')),
    GET_VARIABLE,
    actionPush(pushCp(CP.sid)),
    GET_MEMBER,
    SET_MEMBER,
  ]);

  // var result = new LoadVars()
  const createResult = Buffer.concat([
    actionPush(pushInt(0), pushCp(CP.LoadVars)),
    NEW_OBJECT,
    storeReg(4),
    POP,
  ]);

  // result._client = this
  const setClient = Buffer.concat([
    actionPush(pushReg(4), pushCp(CP._client), pushReg(1)),
    SET_MEMBER,
  ]);

  // result.onLoad = function(success) { ... }
  // Inner function: params=[(r2, 'success')], regcount=5, flags=0x29 (preloadThis→r1)
  const onLoadFunc = buildDefineFunction2('', [[2, 'success']], 5, 0x29, onLoadBodyBytes);
  const setOnLoad = Buffer.concat([
    actionPush(pushReg(4), pushCp(CP.onLoad)),
    onLoadFunc,
    SET_MEMBER,
  ]);

  // lv.sendAndLoad("/api/loadFrutiSlots", result, "POST")
  const sendAndLoad = Buffer.concat([
    actionPush(pushCp(CP.POST)),
    actionPush(pushReg(4)),
    actionPush(pushCp(CP.loadFrutiSlots)),
    actionPush(pushInt(3)),
    actionPush(pushReg(3), pushCp(CP.sendAndLoad)),
    CALL_METHOD,
    POP,
  ]);

  return Buffer.concat([
    initSlots, initSlot0,
    createLv, setGame, setSid,
    createResult, setClient, setOnLoad,
    sendAndLoad,
  ]);
}

const serviceConnectBody = buildServiceConnectBody();

// Build the new serviceConnect DefineFunction2
// Original: params=0, regs=2, flags=0x29, codeSize=155
// New: params=0, regs=5, flags=0x29
// flags 0x29 = preloadThis(r1) + suppressArguments + suppressSuper
const newServiceConnectFunc = buildDefineFunction2('', [], 5, 0x29, serviceConnectBody);

// Find and replace the old serviceConnect DefineFunction2
// Push before DF2 is at original offset 1287515, DF2 at 1287521, SetMember at 1287687
const origFuncStart = shift(1287521);
const origFuncEnd = shift(1287687);

if (buf[origFuncStart] !== 0x8E) {
  throw new Error(`Expected DefineFunction2 (0x8E) at ${origFuncStart}, got 0x${buf[origFuncStart].toString(16)}`);
}
if (buf[origFuncEnd] !== 0x4F) {
  throw new Error(`Expected SetMember (0x4F) at ${origFuncEnd}, got 0x${buf[origFuncEnd].toString(16)}`);
}

const oldScFuncBytes = origFuncEnd - origFuncStart;
console.log(`Old serviceConnect: ${oldScFuncBytes} bytes at ${origFuncStart}`);
console.log(`New serviceConnect: ${newServiceConnectFunc.length} bytes`);

const scDelta = newServiceConnectFunc.length - oldScFuncBytes;

// Replace the function
let beforeSc = buf.slice(0, origFuncStart);
let afterSc = buf.slice(origFuncEnd);
buf = Buffer.concat([beforeSc, newServiceConnectFunc, afterSc]);

// Update tag length
let currentTagLen = buf.readUInt32LE(DOACTION_OFFSET + 2);
buf.writeUInt32LE(currentTagLen + scDelta, DOACTION_OFFSET + 2);
console.log(`Tag length: ${currentTagLen} → ${currentTagLen + scDelta} (scDelta=${scDelta})`);

// All offsets after origFuncStart shift by scDelta
const shift2 = (o) => o >= origFuncStart ? o + scDelta : o;

// ─── Step 5: Replace Client.saveSlot function body ───
// Original Client.saveSlot at @1288275 (before shift), params=2, regs=4, flags=0x29, codeSize=86
// Push before DF2 at @1288270, SetMember at 1288381
// After cpDelta shift + scDelta shift:

const origSaveSlotStart = shift2(shift(1288275));
const origSaveSlotEnd = shift2(shift(1288381));

if (buf[origSaveSlotStart] !== 0x8E) {
  throw new Error(`Expected DefineFunction2 (0x8E) for saveSlot at ${origSaveSlotStart}, got 0x${buf[origSaveSlotStart].toString(16)}`);
}
if (buf[origSaveSlotEnd] !== 0x4F) {
  throw new Error(`Expected SetMember (0x4F) after saveSlot at ${origSaveSlotEnd}, got 0x${buf[origSaveSlotEnd].toString(16)}`);
}

// Build new saveSlot body:
// Original params: r2=n, r3=data (from DefineFunction2 with preloadThis→r1)
// flags=0x29: r1=this, params (n→r2, data→r3), regCount≥5 for temps
//
//   var lv = new LoadVars()         → r4
//   lv.game = "minipixiz"
//   lv.sid = _root.sid
//   lv.slotId = n                   (r2)
//   lv.data = data                  (r3)
//   var result = new LoadVars()     → r5
//   lv.sendAndLoad("/api/saveFrutiSlot", result, "POST")

function buildSaveSlotBody() {
  // var lv = new LoadVars()
  const createLv = Buffer.concat([
    actionPush(pushInt(0), pushCp(CP.LoadVars)),
    NEW_OBJECT,
    storeReg(4),
    POP,
  ]);

  // lv.game = "minipixiz"
  const setGame = Buffer.concat([
    actionPush(pushReg(4), pushCp(CP.game), pushCp(CP.minipixiz)),
    SET_MEMBER,
  ]);

  // lv.sid = _root.sid
  const setSid = Buffer.concat([
    actionPush(pushReg(4), pushCp(CP.sid)),
    actionPush(pushStr('_root')),
    GET_VARIABLE,
    actionPush(pushCp(CP.sid)),
    GET_MEMBER,
    SET_MEMBER,
  ]);

  // lv.slotId = n (r2)
  const setSlotId = Buffer.concat([
    actionPush(pushReg(4), pushCp(CP.slotId), pushReg(2)),
    SET_MEMBER,
  ]);

  // lv.data = data (r3)
  const setData = Buffer.concat([
    actionPush(pushReg(4), pushCp(CP.data), pushReg(3)),
    SET_MEMBER,
  ]);

  // var result = new LoadVars()
  const createResult = Buffer.concat([
    actionPush(pushInt(0), pushCp(CP.LoadVars)),
    NEW_OBJECT,
    storeReg(5),
    POP,
  ]);

  // lv.sendAndLoad("/api/saveFrutiSlot", result, "POST")
  const sendAndLoad = Buffer.concat([
    actionPush(pushCp(CP.POST)),
    actionPush(pushReg(5)),
    actionPush(pushCp(CP.saveFrutiSlot)),
    actionPush(pushInt(3)),
    actionPush(pushReg(4), pushCp(CP.sendAndLoad)),
    CALL_METHOD,
    POP,
  ]);

  return Buffer.concat([
    createLv, setGame, setSid, setSlotId, setData,
    createResult, sendAndLoad,
  ]);
}

const saveSlotBody = buildSaveSlotBody();

// Build new DefineFunction2 for saveSlot
// params: [(r2, 'n'), (r3, 'data')], regCount=6, flags=0x29
const newSaveSlotFunc = buildDefineFunction2('', [[2, 'n'], [3, 'data']], 6, 0x29, saveSlotBody);

const oldSsFuncBytes = origSaveSlotEnd - origSaveSlotStart;
console.log(`Old Client.saveSlot: ${oldSsFuncBytes} bytes at ${origSaveSlotStart}`);
console.log(`New Client.saveSlot: ${newSaveSlotFunc.length} bytes`);

const ssDelta = newSaveSlotFunc.length - oldSsFuncBytes;

// Replace
const beforeSs = buf.slice(0, origSaveSlotStart);
const afterSs = buf.slice(origSaveSlotEnd);
buf = Buffer.concat([beforeSs, newSaveSlotFunc, afterSs]);

// Update tag length
currentTagLen = buf.readUInt32LE(DOACTION_OFFSET + 2);
buf.writeUInt32LE(currentTagLen + ssDelta, DOACTION_OFFSET + 2);
console.log(`Tag length: ${currentTagLen} → ${currentTagLen + ssDelta} (ssDelta=${ssDelta})`);

// ─── Step 6: Write output ───

const outSize = writeSwf(SWF_PATH, sig, version, buf);
console.log(`Wrote ${SWF_PATH} (${outSize} bytes)`);

fs.copyFileSync(SWF_PATH, FULL_PATH);
console.log(`Copied to ${FULL_PATH}`);
console.log('Done!');
