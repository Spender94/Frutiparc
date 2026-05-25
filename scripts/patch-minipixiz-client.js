#!/usr/bin/env node
// Patches Games/miniTroll/minipixiz.swf so that:
//   1. STANDALONE is set to true (was false in the compiled SWF)
//   2. serviceConnect loads slots via HTTP (/api/loadFrutiSlots)
//   3. saveSlot serializes slot data to a pipe-delimited string and sends
//      via getURL2 → window.open (same proven mechanism as MiniWave/scores)
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
const LESS2 = simpleAction(0x48);
const TYPEOF = simpleAction(0x44);
const TRACE = simpleAction(0x26);

function trace(literal) {
  return Buffer.concat([actionPush(pushStr(literal)), TRACE]);
}

function storeReg(r) { return Buffer.from([0x87, 0x01, 0x00, r]); }
function actionIf(offset) {
  const b = Buffer.alloc(5);
  b[0] = 0x9D;
  b.writeUInt16LE(2, 1);
  b.writeInt16LE(offset, 3);
  return b;
}
function actionJump(offset) {
  const b = Buffer.alloc(5);
  b[0] = 0x99;
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

// Always restore from backup so patcher is idempotent
if (!fs.existsSync(BACKUP_PATH)) {
  fs.copyFileSync(SWF_PATH, BACKUP_PATH);
  console.log('Backed up original to', BACKUP_PATH);
}
fs.copyFileSync(BACKUP_PATH, SWF_PATH);
console.log('Restored from backup');

const { sig, version, body } = readSwf(SWF_PATH);
let buf = Buffer.from(body);

// ─── Step 0: Find the DoAction tag ───

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

let pos = cpStart + 5;
const cpEntries = [];
while (cpEntries.length < origCpCount) {
  const end = buf.indexOf(0, pos);
  cpEntries.push(buf.slice(pos, end).toString('latin1'));
  pos = end + 1;
}

const verify = { 174: 'saveSlot', 521: 'serviceConnect', 584: 'onServiceConnect', 756: 'slots', 754: 'data' };
for (const [idx, expected] of Object.entries(verify)) {
  if (cpEntries[idx] !== expected) {
    throw new Error(`CP[${idx}] expected '${expected}', got '${cpEntries[idx]}' — SWF structure changed`);
  }
}
console.log('CP verification passed');

// ─── Step 2: Add new CP entries ───

const newStrings = [
  // Used by serviceConnect (LoadVars-based slot loading)
  'LoadVars',             // +0
  'game',                 // +1
  'sid',                  // +2
  '_client',              // +3
  'onLoad',               // +4
  'slot0',                // +5
  'fromJSON',             // +6
  'POST',                 // +7
  '/api/loadFrutiSlots',  // +8
  'sendAndLoad',          // +9
  '_saveSlotHTTP',        // +10
  'slotId',               // +11
  '/api/saveFrutiSlot',   // +12
  'result',               // +13
  'minipixiz',            // +14
  'send',                 // +15
  // Used by saveSlot (pipe-delimited)
  '$stat',                // +16
  '$item',                // +17
  '$eat',                 // +18
  '$kill',                // +19
  '$run',                 // +20
  '$game',                // +21
  '$forestMax',           // +22
  '$treeMax',             // +23
  '$misNum',              // +24
  '$diam',                // +25
  '$key',                 // +26
  '$star',                // +27
  '$bag',                 // +28
  '$dungeon',             // +29
  '$lvl',                 // +30
  '$f',                   // +31
  '$rainbow',             // +32
  '$pond',                // +33
  '$q',                   // +34
  '$frog',                // +35
  '$faerie',              // +36
  '$level',               // +37
  'length',               // +38
  '$vs',                  // +39
  // Used by saveSlot for ExternalInterface (split form, like mb2 patcher)
  'flash',                // +40
  'external',             // +41
  'ExternalInterface',    // +42
  'call',                 // +43
  'saveSlotData',         // +44
  'Cm',                   // +45
  'card',                 // +46
  // Ruffle bug workaround: Array.prototype.toString() (invoked implicitly
  // by `array + ""`) returns "" for AS2 arrays bridged from JSON. Use an
  // explicit `array.join(",")` for the four $stat array fields so each
  // element is serialised in the pipe and parseMinipixizPipe sees a real
  // length-5 array instead of corruption-rejecting an empty string.
  'join',                 // +47
  ',',                    // +48
  // ExternalInterface bridge for slot0 JSON parsing on load. The
  // MTASC-compiled `_client.fromJSON` uses an AS2 eval()-based parser
  // that returns null in Ruffle for any non-trivial payload, so the
  // patched onLoad uses ExternalInterface.call("parseJSON", str)
  // instead — same pattern as patch-mb2-client.js. game-popup.html and
  // frusion-ruffle.html both expose `window.parseJSON = JSON.parse`.
  'parseJSON',            // +49
  '/api/diag',            // +50 — TEMP diagnostic endpoint (sendAndLoad channel)
];

const newCpBase = origCpCount;

let newCpData = Buffer.alloc(0);
for (const s of newStrings) {
  newCpData = Buffer.concat([newCpData, Buffer.from(s + '\0', 'latin1')]);
}
const cpDelta = newCpData.length;

const beforeCpEnd = buf.slice(0, cpDataEnd);
const afterCpEnd = buf.slice(cpDataEnd);
buf = Buffer.concat([beforeCpEnd, newCpData, afterCpEnd]);

const newCpPayloadLen = origCpPayloadLen + cpDelta;
const newCpCount = origCpCount + newStrings.length;
buf.writeUInt16LE(newCpPayloadLen, cpStart + 1);
buf.writeUInt16LE(newCpCount, cpStart + 3);

if (tagHdrSize !== 6) throw new Error('Expected long-form DoAction tag');
const newTagLen = origTagLen + cpDelta;
buf.writeUInt32LE(newTagLen, DOACTION_OFFSET + 2);

console.log(`Added ${newStrings.length} CP entries (+${cpDelta} bytes)`);
console.log(`CP: ${origCpPayloadLen} → ${newCpPayloadLen}, count: ${origCpCount} → ${newCpCount}`);
console.log(`Tag length: ${origTagLen} → ${newTagLen}`);

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
// Uses LoadVars.sendAndLoad to load slot data from /api/loadFrutiSlots.
// (LoadVars works for receiving data; the issue was only with saving.)

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
  $stat: newCpBase + 16,
  $item: newCpBase + 17,
  $eat: newCpBase + 18,
  $kill: newCpBase + 19,
  $run: newCpBase + 20,
  $game: newCpBase + 21,
  $forestMax: newCpBase + 22,
  $treeMax: newCpBase + 23,
  $misNum: newCpBase + 24,
  $diam: newCpBase + 25,
  $key: newCpBase + 26,
  $star: newCpBase + 27,
  $bag: newCpBase + 28,
  $dungeon: newCpBase + 29,
  $lvl: newCpBase + 30,
  $f: newCpBase + 31,
  $rainbow: newCpBase + 32,
  $pond: newCpBase + 33,
  $q: newCpBase + 34,
  $frog: newCpBase + 35,
  $faerie: newCpBase + 36,
  $level: newCpBase + 37,
  length: newCpBase + 38,
  $vs: newCpBase + 39,
  flash: newCpBase + 40,
  external: newCpBase + 41,
  ExternalInterface: newCpBase + 42,
  call: newCpBase + 43,
  saveSlotData: newCpBase + 44,
  Cm: newCpBase + 45,
  card: newCpBase + 46,
  join: newCpBase + 47,
  comma: newCpBase + 48,
  parseJSON: newCpBase + 49,
  diagUrl: newCpBase + 50,
};

// Build a diagnostic beacon: POST `data=<msg>` to /api/diag via
// LoadVars.sendAndLoad — the SWF→server channel that actually works under
// Ruffle (ExternalInterface is unreliable). msgBytecode must leave exactly
// one string on the stack. Uses scratch registers r9 (LoadVars) and r10
// (result receiver) so it never collides with the host function's regs.
function diagBeacon(msgBytecode) {
  return Buffer.concat([
    actionPush(pushInt(0), pushCp(CP.LoadVars)), NEW_OBJECT, storeReg(9), POP,
    actionPush(pushReg(9), pushCp(CP.data)),
    msgBytecode,
    SET_MEMBER,
    actionPush(pushInt(0), pushCp(CP.LoadVars)), NEW_OBJECT, storeReg(10), POP,
    actionPush(pushCp(CP.POST)),
    actionPush(pushReg(10)),
    actionPush(pushCp(CP.diagUrl)),
    actionPush(pushInt(3)),
    actionPush(pushReg(9), pushCp(CP.sendAndLoad)),
    CALL_METHOD, POP,
  ]);
}

// ── serviceConnect onLoad callback ──

function buildOnLoadBody() {
  // ── TEMP DIAGNOSTIC ── the instant onLoad runs, beacon to /api/diag via the
  // WORKING sendAndLoad channel (EI is unreliable, so the old EI marker proved
  // nothing). Encodes success (r2) and typeof/len of this.slot0. If onLoad
  // fires, the server logs "[DIAG] ONLOAD|s=…"; if it never fires, nothing.
  const diagMarker = diagBeacon(Buffer.concat([
    actionPush(pushStr('ONLOAD|s=')),
    actionPush(pushReg(2)), ADD2,                              // + success
    actionPush(pushStr('|t=')), ADD2,
    actionPush(pushReg(1), pushCp(CP.slot0)), GET_MEMBER, TYPEOF, ADD2,  // + typeof this.slot0
    actionPush(pushStr('|len=')), ADD2,
    actionPush(pushReg(1), pushCp(CP.slot0)), GET_MEMBER,
    actionPush(pushCp(CP.length)), GET_MEMBER, ADD2,          // + this.slot0.length
  ]));

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

  // Parse slot0 JSON via ExternalInterface.call("parseJSON", str) — same
  // mechanism as mb2 (patch-mb2-client.js:451-466). The native MTASC
  // _client.fromJSON uses AS2 eval() which returns null in Ruffle for
  // non-trivial payloads, so Cm.card would fall back to formatFruticard
  // defaults — fairies, dungeon state, $pond.$fs, $mission, $help, $inv
  // all stay invisible in-game even when the server holds rich data.
  // game-popup.html exposes `window.parseJSON = JSON.parse`, so this
  // returns a proper object graph (incl. nested arrays / sparse nulls)
  // that the SWF can drop straight into slots[0] and SharedObject.
  const slot0Load = Buffer.concat([
    actionPush(pushReg(1), pushCp(CP.slot0)), GET_MEMBER,     // arg1 = r1.slot0
    actionPush(pushCp(CP.parseJSON)),                           // arg0 = "parseJSON"
    actionPush(pushInt(2)),                                     // argcount = 2
    actionPush(pushCp(CP.flash)), GET_VARIABLE,                // flash
    actionPush(pushCp(CP.external)), GET_MEMBER,               // .external
    actionPush(pushCp(CP.ExternalInterface)), GET_MEMBER,      // .ExternalInterface
    actionPush(pushCp(CP.call)),                                // method "call"
    CALL_METHOD,
    storeReg(4), POP,                                           // r4 = parsed (or null)
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

  // Seed SharedObject from server data BEFORE onServiceConnect runs.
  // loadFruticard() reads from SharedObject (STANDALONE=true), not slots[0].
  // We MUST seed SharedObject with server data so loadFruticard ends up using
  // the same object that ends up in slots[0] via syncSlots. Otherwise Cm.card
  // and slots[0] diverge: Cm.card points to SharedObject's (possibly stale)
  // data, while slots[0] points to JSON-loaded server data. Gameplay updates
  // Cm.card but saveSlot reads slots[0] → progress is never persisted.
  const seedSO = Buffer.concat([
    // r5 = SharedObject.getLocal("miniPixiz/card")
    actionPush(pushStr('miniPixiz/card'), pushInt(1)),
    actionPush(pushStr('SharedObject')), GET_VARIABLE,
    actionPush(pushStr('getLocal')),
    CALL_METHOD,
    storeReg(5), POP,
    // r5.data["]D,mH("] = [r4]   (native minified slots field, NOT "fruticard")
    actionPush(pushReg(5), pushStr('data')), GET_MEMBER,
    actionPush(pushStr(']D,mH(')),
    actionPush(pushReg(4), pushInt(1)),
    INIT_ARRAY,
    SET_MEMBER,
  ]);

  const callOnServiceConnect = Buffer.concat([
    actionPush(pushInt(0)),
    actionPush(pushReg(3), pushCp(CP.onServiceConnect)),
    CALL_METHOD, POP,
  ]);

  // After onServiceConnect → loadFruticard, sync slots[0] from SharedObject.
  // loadFruticard sets Cm.card = so.data.fruticard[0]; saveSlot reads from
  // slots[0], so they must reference the same object.
  const syncSlot0Assign = Buffer.concat([
    actionPush(pushReg(3), pushCp(CP.slots)), GET_MEMBER,
    actionPush(pushInt(0)),
    actionPush(pushReg(5), pushInt(0)), GET_MEMBER,
    SET_MEMBER,
  ]);

  const syncSlots = Buffer.concat([
    actionPush(pushStr('miniPixiz/card'), pushInt(1)),
    actionPush(pushStr('SharedObject')), GET_VARIABLE,
    actionPush(pushStr('getLocal')),
    CALL_METHOD,
    storeReg(4), POP,
    actionPush(pushReg(4), pushStr('data')), GET_MEMBER,
    actionPush(pushStr(']D,mH(')), GET_MEMBER,
    storeReg(5), POP,
    actionPush(pushReg(5)), NOT,
    actionIf(syncSlot0Assign.length),
    syncSlot0Assign,
  ]);

  const afterSuccessCheck = slot0Check.length + 5 + slot0Load.length + slot0NullCheck.length + 5 +
    slot0Assign.length + seedSO.length;
  const slot0SkipSize = slot0Load.length + slot0NullCheck.length + 5 + slot0Assign.length + seedSO.length;
  const slot0NullSkipSize = slot0Assign.length + seedSO.length;

  return Buffer.concat([
    diagMarker,
    getClient,
    checkSuccess,
    actionIf(afterSuccessCheck),
    slot0Check,
    actionIf(slot0SkipSize),
    slot0Load,
    slot0NullCheck,
    actionIf(slot0NullSkipSize),
    slot0Assign,
    seedSO,
    callOnServiceConnect,
    syncSlots,
  ]);
}

const onLoadBodyBytes = buildOnLoadBody();

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

  const createLv = Buffer.concat([
    actionPush(pushInt(0), pushCp(CP.LoadVars)),
    NEW_OBJECT,
    storeReg(3),
    POP,
  ]);

  const setGame = Buffer.concat([
    actionPush(pushReg(3), pushCp(CP.game), pushCp(CP.minipixiz)),
    SET_MEMBER,
  ]);

  const setSid = Buffer.concat([
    actionPush(pushReg(3), pushCp(CP.sid)),
    actionPush(pushStr('_root')),
    GET_VARIABLE,
    actionPush(pushCp(CP.sid)),
    GET_MEMBER,
    SET_MEMBER,
  ]);

  const createResult = Buffer.concat([
    actionPush(pushInt(0), pushCp(CP.LoadVars)),
    NEW_OBJECT,
    storeReg(4),
    POP,
  ]);

  const setClient = Buffer.concat([
    actionPush(pushReg(4), pushCp(CP._client), pushReg(1)),
    SET_MEMBER,
  ]);

  const onLoadFunc = buildDefineFunction2('', [[2, 'success']], 11, 0x29, onLoadBodyBytes);
  const setOnLoad = Buffer.concat([
    actionPush(pushReg(4), pushCp(CP.onLoad)),
    onLoadFunc,
    SET_MEMBER,
  ]);

  const sendAndLoad = Buffer.concat([
    actionPush(pushCp(CP.POST)),
    actionPush(pushReg(4)),
    actionPush(pushCp(CP.loadFrutiSlots)),
    actionPush(pushInt(3)),
    actionPush(pushReg(3), pushCp(CP.sendAndLoad)),
    CALL_METHOD,
    POP,
  ]);

  // ── TEMP DIAGNOSTIC ── runs at the very start of serviceConnect (which we
  // KNOW executes — the server receives the loadFrutiSlots request). Two jobs:
  //  (1) baseline "SC_RAN" confirms the /api/diag beacon channel itself works;
  //  (2) tests whether Ruffle can marshal a NESTED object returned by EI back
  //      to AS2 — parses {"a":[10,20,{"b":33}]} via EI, echoes a[2].b + a.length.
  // Result is reported over sendAndLoad (works), NOT EI (unreliable):
  //   "[DIAG] MARSHAL|type=object|a2b=33|alen=3"  → EI marshalling WORKS
  //   "[DIAG] MARSHAL|type=undefined|a2b=undefined…" → EI return value is lost
  // Decides the architecture: if EI marshalling works we can inject slot0
  // synchronously via EI; if not we must seed Ruffle's SharedObject (AMF).
  const diagMarshal = Buffer.concat([
    diagBeacon(Buffer.concat([actionPush(pushStr('SC_RAN'))])),
    // r4 = ExternalInterface.call("parseJSON", '{"a":[10,20,{"b":33}]}')
    actionPush(pushStr('{"a":[10,20,{"b":33}]}')),
    actionPush(pushCp(CP.parseJSON)),
    actionPush(pushInt(2)),
    actionPush(pushCp(CP.flash)), GET_VARIABLE,
    actionPush(pushCp(CP.external)), GET_MEMBER,
    actionPush(pushCp(CP.ExternalInterface)), GET_MEMBER,
    actionPush(pushCp(CP.call)),
    CALL_METHOD, storeReg(4), POP,
    diagBeacon(Buffer.concat([
      actionPush(pushStr('MARSHAL|type=')),
      actionPush(pushReg(4)), TYPEOF, ADD2,
      actionPush(pushStr('|a2b=')), ADD2,
      actionPush(pushReg(4), pushStr('a')), GET_MEMBER,
      actionPush(pushInt(2)), GET_MEMBER,
      actionPush(pushStr('b')), GET_MEMBER, ADD2,
      actionPush(pushStr('|alen=')), ADD2,
      actionPush(pushReg(4), pushStr('a')), GET_MEMBER,
      actionPush(pushCp(CP.length)), GET_MEMBER, ADD2,
    ])),
  ]);

  return Buffer.concat([
    diagMarshal,
    initSlots, initSlot0,
    createLv, setGame, setSid,
    createResult, setClient, setOnLoad,
    sendAndLoad,
  ]);
}

// serviceConnect: REVERTED to native. The native standalone serviceConnect
// (slots=[]; setInterval(onServiceConnect,500)) drives the native loadFruticard,
// which reads SharedObject.getLocal("miniPixiz/card").data["]D,mH("] — the slot
// graph we now seed from game-popup.html. Overriding serviceConnect with
// sendAndLoad/onLoad + ExternalInterface was a dead end: EI returns undefined
// in this Ruffle, and the patched flow's onServiceConnect call never reached
// the native SharedObject read, so the game always fell back to formatFruticard.
// Leaving serviceConnect native lets the proven load path run untouched.
const PATCH_SERVICE_CONNECT = true;

const origFuncStart = shift(1287521);
const origFuncEnd = shift(1287687);

if (buf[origFuncStart] !== 0x8E) {
  throw new Error(`Expected DefineFunction2 (0x8E) at ${origFuncStart}, got 0x${buf[origFuncStart].toString(16)}`);
}
if (buf[origFuncEnd] !== 0x4F) {
  throw new Error(`Expected SetMember (0x4F) at ${origFuncEnd}, got 0x${buf[origFuncEnd].toString(16)}`);
}

let scDelta = 0;
let shift2 = (o) => o;
if (PATCH_SERVICE_CONNECT) {
  const serviceConnectBody = buildServiceConnectBody();
  const newServiceConnectFunc = buildDefineFunction2('', [], 11, 0x29, serviceConnectBody);
  const oldScFuncBytes = origFuncEnd - origFuncStart;
  console.log(`Old serviceConnect: ${oldScFuncBytes} bytes at ${origFuncStart}`);
  console.log(`New serviceConnect: ${newServiceConnectFunc.length} bytes`);
  scDelta = newServiceConnectFunc.length - oldScFuncBytes;
  const beforeSc = buf.slice(0, origFuncStart);
  const afterSc = buf.slice(origFuncEnd);
  buf = Buffer.concat([beforeSc, newServiceConnectFunc, afterSc]);
  const currentTagLen = buf.readUInt32LE(DOACTION_OFFSET + 2);
  buf.writeUInt32LE(currentTagLen + scDelta, DOACTION_OFFSET + 2);
  console.log(`Tag length: ${currentTagLen} → ${currentTagLen + scDelta} (scDelta=${scDelta})`);
  shift2 = (o) => o >= origFuncStart ? o + scDelta : o;
} else {
  console.log('serviceConnect: REVERTED to native (not patched) — reads seeded SharedObject');
}

// ─── Step 5: Replace Client.saveSlot function body ───
// New approach: serialize slot data to pipe-delimited string, send via
// getURL2("slot:minipixiz:N:PIPEDATA", "_blank"). Ruffle routes this
// through window.open(), intercepted by game-popup.html.
//
// Pipe format (19 fields):
//   0: $stat.$item     (comma-sep bools)
//   1: $stat.$eat      (comma-sep ints)
//   2: $stat.$kill     (comma-sep ints)
//   3: $stat.$run      (int)
//   4: $stat.$game     (comma-sep ints)
//   5: $stat.$forestMax (int)
//   6: $stat.$treeMax   (int)
//   7: $stat.$misNum    (int)
//   8: $diam            (int)
//   9: $key             (int)
//  10: $star            (int)
//  11: $bag             (int)
//  12: $dungeon.$lvl    (int)
//  13: $dungeon.$f      (bool)
//  14: $rainbow.$f      (bool)
//  15: $pond.$q         (int)
//  16: $frog            (bool)
//  17: faerie_levels    (comma-sep ints, trailing comma ok)
//  18: $vs              (float, last field)

const origSaveSlotStart = shift2(shift(1288275));
const origSaveSlotEnd = shift2(shift(1288381));

if (buf[origSaveSlotStart] !== 0x8E) {
  throw new Error(`Expected DefineFunction2 (0x8E) for saveSlot at ${origSaveSlotStart}, got 0x${buf[origSaveSlotStart].toString(16)}`);
}
if (buf[origSaveSlotEnd] !== 0x4F) {
  throw new Error(`Expected SetMember (0x4F) after saveSlot at ${origSaveSlotEnd}, got 0x${buf[origSaveSlotEnd].toString(16)}`);
}

function buildSaveSlotBody() {
  // DF2 params: r2=n, r3=data (unused). flags=0x29 → r1=this (Client).
  // r3 repurposed for card object. r4=temp parent. r5=faerie array. r6=loop index.

  function appendFromR4(propIdx) {
    return Buffer.concat([
      actionPush(pushReg(4), pushCp(propIdx)), GET_MEMBER,
      actionPush(pushStr('')), ADD2,
      ADD2,
      actionPush(pushStr('|')), ADD2,
    ]);
  }

  function appendFromR3(propIdx) {
    return Buffer.concat([
      actionPush(pushReg(3), pushCp(propIdx)), GET_MEMBER,
      actionPush(pushStr('')), ADD2,
      ADD2,
      actionPush(pushStr('|')), ADD2,
    ]);
  }

  // Array variant. Ruffle's AS2 Array.toString() returns "" for arrays
  // round-tripped through JSON.parse / ExternalInterface, so the implicit
  // toString from `array + ""` silently destroys $item / $eat / $kill /
  // $game in the pipe save. Force an explicit `array.join(",")` call so
  // each element is emitted and parseMinipixizPipe sees the correct
  // length-N array instead of rejecting the save as corrupted.
  //
  // Bytecode shape (CALL_METHOD pops: methodName, this, argCount, …args):
  //   push ","            (separator argument)
  //   push 1              (arg count)
  //   push r4[propIdx]    (the array — becomes `this`)
  //   push "join"         (method name)
  //   CALL_METHOD         → result is "elt0,elt1,…" on stack
  function appendArrayFromR4(propIdx) {
    return Buffer.concat([
      actionPush(pushCp(CP.comma)),                          // ","
      actionPush(pushInt(1)),                                // argCount=1
      actionPush(pushReg(4), pushCp(propIdx)), GET_MEMBER,   // r4[propIdx]
      actionPush(pushCp(CP.join)),                           // "join"
      CALL_METHOD,                                           // → joined string
      ADD2,                                                  // accum + joined
      actionPush(pushStr('|')), ADD2,                        // accum + "|"
    ]);
  }

  function setR4(propIdx) {
    return Buffer.concat([
      actionPush(pushReg(3), pushCp(propIdx)), GET_MEMBER,
      storeReg(4), POP,
    ]);
  }

  // Part 1: card = this.slots[0] → r3
  // Cm.card and Manager.client.slots[0] reference the same Card object
  // (set in Cm.loadFruticard / formatFruticard). MTASC-compiled classes
  // aren't on _global, so Cm.card is inaccessible from patched bytecode.
  // SharedObject may not be in sync yet when saveSlot runs. this.slots[0]
  // is the only reliable path.
  const getCard = Buffer.concat([
    actionPush(pushReg(1), pushCp(CP.slots)), GET_MEMBER,
    actionPush(pushInt(0)), GET_MEMBER,
    storeReg(3), POP,
  ]);

  // Skip serialization entirely if Cm.card is undefined/null (e.g., before loadFruticard)
  // We'll wrap the body in an if-guard at the end.

  // Part 2: Build pipe string on stack
  const buildStr = Buffer.concat([
    actionPush(pushStr('')),

    setR4(CP.$stat),
    appendArrayFromR4(CP.$item),  // 0 — bool array, Ruffle-toString hostile
    appendArrayFromR4(CP.$eat),   // 1 — int array
    appendArrayFromR4(CP.$kill),  // 2 — int array (5 elements)
    appendFromR4(CP.$run),        // 3 — scalar int
    appendArrayFromR4(CP.$game),  // 4 — int array (5 elements)
    appendFromR4(CP.$forestMax),  // 5
    appendFromR4(CP.$treeMax),    // 6
    appendFromR4(CP.$misNum),     // 7

    appendFromR3(CP.$diam),       // 8
    appendFromR3(CP.$key),        // 9
    appendFromR3(CP.$star),       // 10
    appendFromR3(CP.$bag),        // 11

    setR4(CP.$dungeon),
    appendFromR4(CP.$lvl),        // 12
    appendFromR4(CP.$f),          // 13

    setR4(CP.$rainbow),
    appendFromR4(CP.$f),          // 14

    setR4(CP.$pond),
    appendFromR4(CP.$q),          // 15

    appendFromR3(CP.$frog),       // 16

    // Prepare faerie array → r5
    actionPush(pushReg(3), pushCp(CP.$faerie)), GET_MEMBER,
    storeReg(5), POP,
  ]);

  // Part 3: Faerie levels loop
  // Appends "level1,level2,...," with trailing comma (parser handles it)
  const loopInit = Buffer.concat([
    actionPush(pushInt(0)), storeReg(6), POP,
  ]);

  const loopCond = Buffer.concat([
    actionPush(pushReg(6)),
    actionPush(pushReg(5), pushCp(CP.length)), GET_MEMBER,
    LESS2, // r6 < length?
    NOT,   // r6 >= length?
  ]);

  const loopBody = Buffer.concat([
    actionPush(pushReg(5), pushReg(6)), GET_MEMBER,
    actionPush(pushCp(CP.$level)), GET_MEMBER,
    actionPush(pushStr('')), ADD2,
    ADD2,
    actionPush(pushStr(',')), ADD2,
  ]);

  const loopIncr = Buffer.concat([
    actionPush(pushReg(6), pushInt(1)),
    ADD2,
    storeReg(6), POP,
  ]);

  const fwdJumpDist = loopBody.length + loopIncr.length + 5; // 5 = backJump
  const backJumpDist = -(loopCond.length + 5 + loopBody.length + loopIncr.length + 5);

  const faerieLoop = Buffer.concat([
    loopInit,
    loopCond,
    actionIf(fwdJumpDist),
    loopBody,
    loopIncr,
    actionJump(backJumpDist),
  ]);

  // After loop: separator + $vs (last field, no trailing |)
  const afterLoop = Buffer.concat([
    actionPush(pushStr('|')), ADD2,
    actionPush(pushReg(3), pushCp(CP.$vs)), GET_MEMBER,
    actionPush(pushStr('')), ADD2,
    ADD2,
  ]);

  // Part 4: POST pipe string to /api/saveFrutiSlot via LoadVars.
  // LoadVars.sendAndLoad is the same mechanism used by serviceConnect and is
  // proven to work in Ruffle.  ExternalInterface.call was unreliable.
  const lvSave = Buffer.concat([
    storeReg(4), POP, // save pipe string to r4

    // r5 = new LoadVars()
    actionPush(pushInt(0), pushCp(CP.LoadVars)),
    NEW_OBJECT,
    storeReg(5), POP,

    // r5.game = "minipixiz"
    actionPush(pushReg(5), pushCp(CP.game), pushCp(CP.minipixiz)),
    SET_MEMBER,

    // r5.sid = _root.sid
    actionPush(pushReg(5), pushCp(CP.sid)),
    actionPush(pushStr('_root')), GET_VARIABLE,
    actionPush(pushCp(CP.sid)), GET_MEMBER,
    SET_MEMBER,

    // r5.slotId = "0"
    actionPush(pushReg(5), pushCp(CP.slotId), pushStr('0')),
    SET_MEMBER,

    // r5.data = r4 (pipe string)
    actionPush(pushReg(5), pushCp(CP.data), pushReg(4)),
    SET_MEMBER,

    // r6 = new LoadVars() — result receiver
    actionPush(pushInt(0), pushCp(CP.LoadVars)),
    NEW_OBJECT,
    storeReg(6), POP,

    // r5.sendAndLoad("/api/saveFrutiSlot", r6, "POST")
    actionPush(pushCp(CP.POST)),
    actionPush(pushReg(6)),
    actionPush(pushCp(CP.saveFrutiSlot)),
    actionPush(pushInt(3)),
    actionPush(pushReg(5), pushCp(CP.sendAndLoad)),
    CALL_METHOD,
    POP,
  ]);

  // Part 5: flush SharedObject for local persistence
  const soFlush = Buffer.concat([
    actionPush(pushStr('miniPixiz/card'), pushInt(1)),
    actionPush(pushStr('SharedObject')), GET_VARIABLE,
    actionPush(pushStr('getLocal')),
    CALL_METHOD,
    storeReg(4), POP,
    actionPush(pushInt(0)),
    actionPush(pushReg(4), pushStr('flush')),
    CALL_METHOD, POP,
  ]);

  // Guard: skip serialization when slots[0] is null/undefined (before
  // loadFruticard runs) to prevent clobbering server data with empty pipes.
  const guardedBody = Buffer.concat([buildStr, faerieLoop, afterLoop, lvSave, soFlush]);
  const skipIfNull = Buffer.concat([
    actionPush(pushReg(3)),
    NOT,                                            // !card → true if null/undefined/0/""
    actionIf(guardedBody.length),
  ]);

  return Buffer.concat([getCard, skipIfNull, guardedBody]);
}

const saveSlotBody = buildSaveSlotBody();
const newSaveSlotFunc = buildDefineFunction2('', [[2, 'n'], [3, 'data']], 7, 0x29, saveSlotBody);

const oldSsFuncBytes = origSaveSlotEnd - origSaveSlotStart;
console.log(`Old Client.saveSlot: ${oldSsFuncBytes} bytes at ${origSaveSlotStart}`);
console.log(`New Client.saveSlot: ${newSaveSlotFunc.length} bytes`);

const ssDelta = newSaveSlotFunc.length - oldSsFuncBytes;
const beforeSs = buf.slice(0, origSaveSlotStart);
const afterSs = buf.slice(origSaveSlotEnd);
buf = Buffer.concat([beforeSs, newSaveSlotFunc, afterSs]);

currentTagLen = buf.readUInt32LE(DOACTION_OFFSET + 2);
buf.writeUInt32LE(currentTagLen + ssDelta, DOACTION_OFFSET + 2);
console.log(`Tag length: ${currentTagLen} → ${currentTagLen + ssDelta} (ssDelta=${ssDelta})`);

// ─── Step 6: Write output ───

const outSize = writeSwf(SWF_PATH, sig, version, buf);
console.log(`Wrote ${SWF_PATH} (${outSize} bytes)`);

fs.copyFileSync(SWF_PATH, FULL_PATH);
console.log(`Copied to ${FULL_PATH}`);
console.log('Done!');
