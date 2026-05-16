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

  // Flat LoadVars field names emitted by /api/loadFrutiSlots for minipixiz.
  // Ruffle's eval()-based _client.fromJSON returns null on the slot0 JSON
  // payload, so we rebuild Card manually from these per-field properties
  // and bypass fromJSON entirely.
  'mpx_run',              // +49
  'mpx_diam',             // +50
  'mpx_key',              // +51
  'mpx_star',             // +52
  'mpx_bag',              // +53
  'mpx_forestMax',        // +54
  'mpx_treeMax',          // +55
  'mpx_misNum',           // +56
  'mpx_item',             // +57
  'mpx_eat',              // +58
  'mpx_kill',             // +59
  'mpx_game',             // +60
  'mpx_dungeonLvl',       // +61
  'mpx_dungeonF',         // +62
  'mpx_rainbowF',         // +63
  'mpx_pondQ',            // +64
  'mpx_frog',             // +65
  'mpx_faerie',           // +66
  'mpx_vs',               // +67
  'Number',               // +68
  'split',                // +69
  '1',                    // +70   bool truthy marker (mpx_frog == "1" etc.)
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
//
// We bounced this between true and false during diagnosis. With
// STANDALONE=false the SWF's gameplay tries to persist via the original
// network path (ExternalInterface/LocalConnection — neither works in our
// Ruffle setup), so progress never reaches our patched saveSlot and we
// see no saves after init. STANDALONE=true keeps the SharedObject
// persistence layer that gameplay reliably writes to in this engine
// build, and getCard now reads from SO as an intermediate fallback so
// we can still HTTP-export the live state from periodic sync triggers.
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
  // The MTASC compile of MiniPixiz obfuscated every class/method name. By
  // disassembling the const pool + bytecode of the un-patched SWF we
  // recovered the mapping for the Cm class and its `card` static var:
  //   Cm    → CP[106] = "]q"
  //   .card → CP[107] = "4d(*"
  // So `Cm.card` in source compiles to `eval("]q").4d(*` — verified by
  // finding multiple bytecode sites that do `push cp106, GetVar, push cp107,
  // GetMem, push cp791="$stat", GetMem` (i.e. Cm.card.$stat accesses).
  Cm_obf:  106,
  card_obf: 107,
  // Additional Card fields needed for the save pipe extension (fields
  // 19, 20, 21) — these are original CP entries reused.
  $inv:        777,
  $current:    762,
  $checkpoint: 774,
  $mission:    789,
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
  mpx_run:        newCpBase + 49,
  mpx_diam:       newCpBase + 50,
  mpx_key:        newCpBase + 51,
  mpx_star:       newCpBase + 52,
  mpx_bag:        newCpBase + 53,
  mpx_forestMax:  newCpBase + 54,
  mpx_treeMax:    newCpBase + 55,
  mpx_misNum:     newCpBase + 56,
  mpx_item:       newCpBase + 57,
  mpx_eat:        newCpBase + 58,
  mpx_kill:       newCpBase + 59,
  mpx_game:       newCpBase + 60,
  mpx_dungeonLvl: newCpBase + 61,
  mpx_dungeonF:   newCpBase + 62,
  mpx_rainbowF:   newCpBase + 63,
  mpx_pondQ:      newCpBase + 64,
  mpx_frog:       newCpBase + 65,
  mpx_faerie:     newCpBase + 66,
  mpx_vs:         newCpBase + 67,
  Number:         newCpBase + 68,
  split:          newCpBase + 69,
  one:            newCpBase + 70,
};

// Add ActionGetVariable and ActionCallFunction opcodes (not yet declared).
const CALL_FUNCTION = simpleAction(0x3D);

// ── serviceConnect onLoad callback ──
//
// Receives the response from /api/loadFrutiSlots. The server emits flat
// LoadVars fields (mpx_run, mpx_diam, mpx_item, mpx_kill, …) alongside
// the legacy slot0=<json> payload. We bypass _client.fromJSON entirely
// (it returns null under Ruffle because its eval()-based JSON parser
// fails on object literals) and rebuild the Card object manually from
// the flat fields. Result: r3.slots[0] = a fully-formed Card whose
// gameplay updates propagate through to saveSlot.
//
// Register layout (regcount=10):
//   r1 = this (LoadVars receiver, preloaded)
//   r2 = success (named param)
//   r3 = _client
//   r4 = card (Card object being built)
//   r5 = stat ($stat subobject)
//   r6 = split-result array (CSV parse scratch)
//   r7 = loop index (CSV parse scratch)
//   r8 = parsed array (output of csv→array helpers, then transferred to r4/r5)
//   r9 = SharedObject handle / fruticard array (last steps)

function buildOnLoadBody() {
  // target[propCp] = Number(this[srcLvCp])
  function setNumFromLv(targetReg, propCp, srcLvCp) {
    return Buffer.concat([
      actionPush(pushReg(targetReg), pushCp(propCp)),
      actionPush(pushReg(1), pushCp(srcLvCp)), GET_MEMBER,
      actionPush(pushInt(1)),
      actionPush(pushCp(CP.Number)),
      CALL_FUNCTION,
      SET_MEMBER,
    ]);
  }

  // target[propCp] = (this[srcLvCp] == "1")
  function setBoolFromLv(targetReg, propCp, srcLvCp) {
    return Buffer.concat([
      actionPush(pushReg(targetReg), pushCp(propCp)),
      actionPush(pushReg(1), pushCp(srcLvCp)), GET_MEMBER,
      actionPush(pushCp(CP.one)),
      EQUALS2,
      SET_MEMBER,
    ]);
  }

  // outReg = [Number(x) for x in this[srcLvCp].split(",")] (or boolean variant).
  // The split is unconditional — Number("") = 0 in AS2 (ECMAScript-1), so an
  // empty source field yields [0], not a crash. parseFaerieCsv keeps the
  // truthy-only guard because faerie wraps each level in an object literal
  // and an extraneous {$level:0} entry would falsely register a faerie.
  function buildCsvLoop(srcLvCp, outReg, bodyBuilder, tmpSplit = 6, tmpIdx = 7) {
    const init = Buffer.concat([
      actionPush(pushInt(0)), INIT_ARRAY,
      storeReg(outReg), POP,
    ]);
    const split = Buffer.concat([
      actionPush(pushCp(CP.comma)),
      actionPush(pushInt(1)),
      actionPush(pushReg(1), pushCp(srcLvCp)), GET_MEMBER,
      actionPush(pushCp(CP.split)),
      CALL_METHOD,
      storeReg(tmpSplit), POP,
    ]);
    const loopInit = Buffer.concat([
      actionPush(pushInt(0)), storeReg(tmpIdx), POP,
    ]);
    const loopCond = Buffer.concat([
      actionPush(pushReg(tmpIdx)),
      actionPush(pushReg(tmpSplit), pushCp(CP.length)), GET_MEMBER,
      LESS2, NOT,
    ]);
    const loopBody = bodyBuilder(outReg, tmpSplit, tmpIdx);
    const loopIncr = Buffer.concat([
      actionPush(pushReg(tmpIdx), pushInt(1)), ADD2,
      storeReg(tmpIdx), POP,
    ]);
    const ifFwd = loopBody.length + loopIncr.length + 5;
    const jBack = -(loopCond.length + 5 + loopBody.length + loopIncr.length + 5);
    const loop = Buffer.concat([
      loopCond, actionIf(ifFwd),
      loopBody, loopIncr,
      actionJump(jBack),
    ]);
    return Buffer.concat([init, split, loopInit, loop]);
  }

  // outReg[idx] = Number(splitArr[idx])
  const numBody = (outReg, tmpSplit, tmpIdx) => Buffer.concat([
    actionPush(pushReg(outReg), pushReg(tmpIdx)),
    actionPush(pushReg(tmpSplit), pushReg(tmpIdx)), GET_MEMBER,
    actionPush(pushInt(1)),
    actionPush(pushCp(CP.Number)),
    CALL_FUNCTION,
    SET_MEMBER,
  ]);

  // outReg[idx] = (splitArr[idx] == "1")
  const boolBody = (outReg, tmpSplit, tmpIdx) => Buffer.concat([
    actionPush(pushReg(outReg), pushReg(tmpIdx)),
    actionPush(pushReg(tmpSplit), pushReg(tmpIdx)), GET_MEMBER,
    actionPush(pushCp(CP.one)),
    EQUALS2,
    SET_MEMBER,
  ]);

  // outReg[idx] = {$level: Number(splitArr[idx])}
  // INIT_OBJECT pops count, then (value, name) pairs — top of stack popped
  // first. Stack before INIT_OBJECT (bottom→top): name, value, count=1.
  const faerieBody = (outReg, tmpSplit, tmpIdx) => Buffer.concat([
    actionPush(pushReg(outReg), pushReg(tmpIdx)),       // target, idx (for SET_MEMBER)
    actionPush(pushCp(CP.$level)),                       // name
    actionPush(pushReg(tmpSplit), pushReg(tmpIdx)), GET_MEMBER,
    actionPush(pushInt(1)),
    actionPush(pushCp(CP.Number)),
    CALL_FUNCTION,                                       // value = Number(split[idx])
    actionPush(pushInt(1)),                              // pair count
    INIT_OBJECT,
    SET_MEMBER,
  ]);

  const parseFaerieCsvToArr = (srcLvCp, outReg, tmpSplit = 6, tmpIdx = 7) => {
    // Guard: only parse when mpx_faerie is truthy — otherwise leave outReg = [].
    // numBody/boolBody are safe on empty strings (Number("") = 0,
    // "" == "1" → false), but an empty faerie CSV would yield
    // [{$level: 0}] (length 1) and falsely register a faerie.
    const initEmpty = Buffer.concat([
      actionPush(pushInt(0)), INIT_ARRAY,
      storeReg(outReg), POP,
    ]);
    const split = Buffer.concat([
      actionPush(pushCp(CP.comma)),
      actionPush(pushInt(1)),
      actionPush(pushReg(1), pushCp(srcLvCp)), GET_MEMBER,
      actionPush(pushCp(CP.split)),
      CALL_METHOD,
      storeReg(tmpSplit), POP,
    ]);
    const loopInit = Buffer.concat([
      actionPush(pushInt(0)), storeReg(tmpIdx), POP,
    ]);
    const loopCond = Buffer.concat([
      actionPush(pushReg(tmpIdx)),
      actionPush(pushReg(tmpSplit), pushCp(CP.length)), GET_MEMBER,
      LESS2, NOT,
    ]);
    const loopBody = faerieBody(outReg, tmpSplit, tmpIdx);
    const loopIncr = Buffer.concat([
      actionPush(pushReg(tmpIdx), pushInt(1)), ADD2,
      storeReg(tmpIdx), POP,
    ]);
    const ifFwd = loopBody.length + loopIncr.length + 5;
    const jBack = -(loopCond.length + 5 + loopBody.length + loopIncr.length + 5);
    const loop = Buffer.concat([
      loopCond, actionIf(ifFwd),
      loopBody, loopIncr,
      actionJump(jBack),
    ]);
    const fillBlock = Buffer.concat([split, loopInit, loop]);
    const guard = Buffer.concat([
      actionPush(pushReg(1), pushCp(srcLvCp)), GET_MEMBER, NOT,
      actionIf(fillBlock.length),
    ]);
    return Buffer.concat([initEmpty, guard, fillBlock]);
  };

  // === r3 = this._client ===
  const getClient = Buffer.concat([
    actionPush(pushReg(1), pushCp(CP._client)), GET_MEMBER, storeReg(3), POP,
  ]);

  // === Build $stat → r5 ===
  const initStat = Buffer.concat([
    actionPush(pushInt(0)), INIT_OBJECT,
    storeReg(5), POP,
  ]);
  const statScalars = Buffer.concat([
    setNumFromLv(5, CP.$run,        CP.mpx_run),
    setNumFromLv(5, CP.$forestMax,  CP.mpx_forestMax),
    setNumFromLv(5, CP.$treeMax,    CP.mpx_treeMax),
    setNumFromLv(5, CP.$misNum,     CP.mpx_misNum),
  ]);
  // Helper: parse mpx_<arr> → r8, then stat[$prop] = r8
  const parseAndAssign = (srcLvCp, statPropCp, body) => Buffer.concat([
    buildCsvLoop(srcLvCp, 8, body),
    actionPush(pushReg(5), pushCp(statPropCp), pushReg(8)),
    SET_MEMBER,
  ]);
  const statArrays = Buffer.concat([
    parseAndAssign(CP.mpx_item, CP.$item, boolBody),
    parseAndAssign(CP.mpx_eat,  CP.$eat,  numBody),
    parseAndAssign(CP.mpx_kill, CP.$kill, numBody),
    parseAndAssign(CP.mpx_game, CP.$game, numBody),
  ]);

  // === Build Card → r4 ===
  const initCard = Buffer.concat([
    actionPush(pushInt(0)), INIT_OBJECT,
    storeReg(4), POP,
  ]);
  const assignStat = Buffer.concat([
    actionPush(pushReg(4), pushCp(CP.$stat), pushReg(5)),
    SET_MEMBER,
  ]);
  const cardScalars = Buffer.concat([
    setNumFromLv(4, CP.$diam, CP.mpx_diam),
    setNumFromLv(4, CP.$key,  CP.mpx_key),
    setNumFromLv(4, CP.$star, CP.mpx_star),
    setNumFromLv(4, CP.$bag,  CP.mpx_bag),
    setNumFromLv(4, CP.$vs,   CP.mpx_vs),
    setBoolFromLv(4, CP.$frog, CP.mpx_frog),
  ]);

  // card.$dungeon = {$lvl: Number(mpx_dungeonLvl), $f: (mpx_dungeonF == "1")}
  const dungeonObj = Buffer.concat([
    actionPush(pushReg(4), pushCp(CP.$dungeon)),
    actionPush(pushCp(CP.$lvl)),
    actionPush(pushReg(1), pushCp(CP.mpx_dungeonLvl)), GET_MEMBER,
    actionPush(pushInt(1)),
    actionPush(pushCp(CP.Number)),
    CALL_FUNCTION,
    actionPush(pushCp(CP.$f)),
    actionPush(pushReg(1), pushCp(CP.mpx_dungeonF)), GET_MEMBER,
    actionPush(pushCp(CP.one)),
    EQUALS2,
    actionPush(pushInt(2)),
    INIT_OBJECT,
    SET_MEMBER,
  ]);
  // card.$rainbow = {$f: (mpx_rainbowF == "1")}
  const rainbowObj = Buffer.concat([
    actionPush(pushReg(4), pushCp(CP.$rainbow)),
    actionPush(pushCp(CP.$f)),
    actionPush(pushReg(1), pushCp(CP.mpx_rainbowF)), GET_MEMBER,
    actionPush(pushCp(CP.one)),
    EQUALS2,
    actionPush(pushInt(1)),
    INIT_OBJECT,
    SET_MEMBER,
  ]);
  // card.$pond = {$q: Number(mpx_pondQ)}
  const pondObj = Buffer.concat([
    actionPush(pushReg(4), pushCp(CP.$pond)),
    actionPush(pushCp(CP.$q)),
    actionPush(pushReg(1), pushCp(CP.mpx_pondQ)), GET_MEMBER,
    actionPush(pushInt(1)),
    actionPush(pushCp(CP.Number)),
    CALL_FUNCTION,
    actionPush(pushInt(1)),
    INIT_OBJECT,
    SET_MEMBER,
  ]);
  // card.$faerie = parsed faerie array
  const faerieAssign = Buffer.concat([
    parseFaerieCsvToArr(CP.mpx_faerie, 8),
    actionPush(pushReg(4), pushCp(CP.$faerie), pushReg(8)),
    SET_MEMBER,
  ]);

  // === r3.slots[0] = r4 and seed SharedObject so loadFruticard sees it ===
  const slot0Assign = Buffer.concat([
    actionPush(pushReg(3), pushCp(CP.slots)), GET_MEMBER,
    actionPush(pushInt(0)),
    actionPush(pushReg(4)),
    SET_MEMBER,
  ]);
  const seedSO = Buffer.concat([
    actionPush(pushStr('miniPixiz/card'), pushInt(1)),
    actionPush(pushStr('SharedObject')), GET_VARIABLE,
    actionPush(pushStr('getLocal')),
    CALL_METHOD,
    storeReg(9), POP,
    // SO.clear() — wipe stale state from prior sessions BEFORE writing our
    // seed. The patched game ran first in private-browsing mode (empty SO,
    // our seed took effect, gameplay anchored on r4 → progress flowed
    // through saveSlot). Switching to normal browsing surfaced a stale
    // SO whose fruticard array overrode our seed inside loadFruticard,
    // so Cm.card pointed at the persisted-but-stale Card and slots[0] = r4
    // diverged. Clearing first guarantees our seed wins.
    actionPush(pushInt(0)),
    actionPush(pushReg(9), pushStr('clear')),
    CALL_METHOD, POP,
    actionPush(pushReg(9), pushStr('data')), GET_MEMBER,
    actionPush(pushStr('fruticard')),
    actionPush(pushReg(4), pushInt(1)),
    INIT_ARRAY,
    SET_MEMBER,
    // Flush the SO so loadFruticard (called from onServiceConnect below)
    // sees our seeded data via its own getLocal/getMember chain. Without
    // flush() under Ruffle, the write may stay in a per-call buffer that
    // doesn't sync to the data the next getLocal() call returns —
    // confirmed empirically by gameplay still starting from formatFruticard
    // defaults despite our seedSO.data.fruticard = [r4] write.
    actionPush(pushInt(0)),
    actionPush(pushReg(9), pushStr('flush')),
    CALL_METHOD, POP,
  ]);
  const callOnServiceConnect = Buffer.concat([
    actionPush(pushInt(0)),
    actionPush(pushReg(3), pushCp(CP.onServiceConnect)),
    CALL_METHOD, POP,
  ]);

  // === Sync slots[0] from SharedObject post-loadFruticard ===
  const syncSlot0Assign = Buffer.concat([
    actionPush(pushReg(3), pushCp(CP.slots)), GET_MEMBER,
    actionPush(pushInt(0)),
    actionPush(pushReg(9), pushInt(0)), GET_MEMBER,
    SET_MEMBER,
  ]);
  const syncSlots = Buffer.concat([
    actionPush(pushStr('miniPixiz/card'), pushInt(1)),
    actionPush(pushStr('SharedObject')), GET_VARIABLE,
    actionPush(pushStr('getLocal')),
    CALL_METHOD,
    storeReg(9), POP,
    actionPush(pushReg(9), pushStr('data')), GET_MEMBER,
    actionPush(pushStr('fruticard')), GET_MEMBER,
    storeReg(9), POP,
    actionPush(pushReg(9)), NOT,
    actionIf(syncSlot0Assign.length),
    syncSlot0Assign,
  ]);

  // === Wrap with success check ===
  // The previous forceCmCard step (Cm.card = r4) is gone — "Cm" doesn't
  // exist as a symbol in the original SWF's const pool, so the lookup
  // never resolved and the SET_MEMBER was a no-op. saveSlot now reads
  // directly from the `data` parameter (the live Card gameplay passes
  // in at call time), so we don't need to anchor anything globally.
  // After loadFruticard runs inside onServiceConnect, the SWF's gameplay
  // code holds Cm.card as a static reference; mutations like
  // `Cm.card.$stat.$run++` land on whatever object Cm.card points to.
  // loadFruticard re-anchors Cm.card to either SharedObject.data.fruticard[0]
  // or formatFruticard() defaults — neither path reliably ends up at our r4
  // under Ruffle (SharedObject.getLocal returns a fresh instance each call,
  // so the seedSO write didn't reach loadFruticard's read).
  //
  // Earlier attempt: `]q.4d(* = r4` (replace the static reference). This
  // doesn't work because `4d(*` is read 237x in the bytecode but NEVER
  // written by name — it's defined via some mechanism (getter, prototype
  // chain, frame-action init) that our SetMember can't override. Gameplay's
  // reads of `]q.4d(*` continue returning the original Card object.
  //
  // New approach: mutate the EXISTING Cm.card object IN PLACE. Read the
  // current Cm.card into r8, then SetMember each property with the
  // corresponding value from our reconstructed r4. The Card object's
  // identity stays the same (so the getter/setter trick is irrelevant),
  // but its data now reflects the loaded DB state.
  const mutateCmCard = (() => {
    // r8 = Cm.card (whatever the SWF set it to)
    const fetchCard = Buffer.concat([
      actionPush(pushCp(CP.Cm_obf)), GET_VARIABLE,
      actionPush(pushCp(CP.card_obf)), GET_MEMBER,
      storeReg(8), POP,
    ]);
    // Skip mutation if r8 is null/undefined (Cm.card not yet initialised
    // — would happen if loadFruticard hasn't run; we'd hit this when our
    // onLoad fires before the SWF's own init completes).
    const skipGuard = Buffer.concat([
      actionPush(pushReg(8)), NOT,
    ]);
    // Helper: r8[prop] = r4[prop]
    const copy = (propCp) => Buffer.concat([
      actionPush(pushReg(8), pushCp(propCp)),
      actionPush(pushReg(4), pushCp(propCp)), GET_MEMBER,
      SET_MEMBER,
    ]);
    const mutateBody = Buffer.concat([
      copy(CP.$stat),    // whole $stat sub-object reference
      copy(CP.$diam),
      copy(CP.$key),
      copy(CP.$star),
      copy(CP.$bag),
      copy(CP.$vs),
      copy(CP.$frog),
      copy(CP.$dungeon),
      copy(CP.$rainbow),
      copy(CP.$pond),
      copy(CP.$faerie),
    ]);
    return Buffer.concat([fetchCard, skipGuard, actionIf(mutateBody.length), mutateBody]);
  })();

  // Direct ExternalInterface.call("parseJSON", slot0_string) — bypasses
  // the Frusion GameClient.fromJSON prototype chain (which doesn't even
  // exist in our hosting since frusion_client.swf isn't loaded). The JS
  // host page registers window.parseJSON = JSON.parse, so this round-trip
  // through ExternalInterface gives us the FULL parsed Card object back
  // (every field — $inv, $faerie, $mission, $checkpoint, $time,
  // $dungeon.$day, etc., not just the 11-field manual rebuild). If the
  // bridge fails (returns null/undefined), we keep the manual r4.
  const tryFromJSON = (() => {
    // r9 = flash.external.ExternalInterface.call("parseJSON", this.slot0)
    const call = Buffer.concat([
      actionPush(pushReg(1), pushCp(CP.slot0)), GET_MEMBER,        // this.slot0 (arg2)
      actionPush(pushStr('parseJSON')),                              // arg1
      actionPush(pushInt(2)),                                        // argCount
      actionPush(pushStr('flash')), GET_VARIABLE,                    // flash
      actionPush(pushStr('external')), GET_MEMBER,                   // .external
      actionPush(pushStr('ExternalInterface')), GET_MEMBER,          // .ExternalInterface
      actionPush(pushStr('call')),                                   // method name
      CALL_METHOD,
      storeReg(9), POP,
    ]);
    const swap = Buffer.concat([
      actionPush(pushReg(9)),
      storeReg(4), POP,
    ]);
    const guard = Buffer.concat([
      actionPush(pushReg(9), pushCp(CP.$stat)), GET_MEMBER,
      NOT,
      actionIf(swap.length),
      swap,
    ]);
    return Buffer.concat([call, guard]);
  })();

  // === Wrap with success check ===
  // Order:
  //  1. Build manual r4 from flat fields (always valid baseline)
  //  2. Try fromJSON → r9; if successful, override r4 = r9 (full Card)
  //  3. slot0Assign + seedSO + callOnServiceConnect + syncSlots
  //  4. mutateCmCard with whichever r4 we have (full or partial)
  const afterSuccessBody = Buffer.concat([
    initStat, statScalars, statArrays,
    initCard, assignStat, cardScalars,
    dungeonObj, rainbowObj, pondObj, faerieAssign,
    tryFromJSON,
    slot0Assign, seedSO,
    callOnServiceConnect,
    syncSlots,
    mutateCmCard,
  ]);

  const successCheck = Buffer.concat([
    actionPush(pushReg(2)), NOT,
    actionIf(afterSuccessBody.length),
  ]);

  return Buffer.concat([
    getClient,
    successCheck,
    afterSuccessBody,
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

  const onLoadFunc = buildDefineFunction2('', [[2, 'success']], 10, 0x29, onLoadBodyBytes);
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

  return Buffer.concat([
    initSlots, initSlot0,
    createLv, setGame, setSid,
    createResult, setClient, setOnLoad,
    sendAndLoad,
  ]);
}

const serviceConnectBody = buildServiceConnectBody();
const newServiceConnectFunc = buildDefineFunction2('', [], 5, 0x29, serviceConnectBody);

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
let beforeSc = buf.slice(0, origFuncStart);
let afterSc = buf.slice(origFuncEnd);
buf = Buffer.concat([beforeSc, newServiceConnectFunc, afterSc]);

let currentTagLen = buf.readUInt32LE(DOACTION_OFFSET + 2);
buf.writeUInt32LE(currentTagLen + scDelta, DOACTION_OFFSET + 2);
console.log(`Tag length: ${currentTagLen} → ${currentTagLen + scDelta} (scDelta=${scDelta})`);

const shift2 = (o) => o >= origFuncStart ? o + scDelta : o;

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

  // Part 1: pick the Card object to serialise (→ r3).
  //
  // Four sources, tried in order:
  //
  //   1. eval("]q").4d(*  — the OBFUSCATED Cm.card. MTASC renamed the Cm
  //      class to "]q" (CP[106]) and the .card static to "4d(*" (CP[107]).
  //      This is the LIVE Card gameplay mutates every frame. Discovered
  //      by disassembling the un-patched SWF: every Cm.card.$stat.$X
  //      access compiles to `pushCp(106), GetVariable, pushCp(107),
  //      GetMember, push "$X", GetMember`. This is the authoritative
  //      source — wins over any other if present.
  //
  //   2. r3 (data param) — gameplay's init/formatFruticard saves pass
  //      the live Card here too (the 67-char init pipes). Backup for
  //      cases where Cm.card isn't yet initialised.
  //
  //   3. SharedObject.data.fruticard[0] — SO-persisted Card (rarely
  //      populated in Ruffle).
  //
  //   4. this.slots[0] — frozen historical floor from onLoad's r4.
  // Source priority for r3:
  //   1. Cm.card (obfuscated `]q.4d(*`) — gameplay's live state
  //   2. Original data param (we save it to r5 before any overwrite)
  //   3. SharedObject.data.fruticard[0] — rare in Ruffle but try anyway
  //   4. this.slots[0] — frozen floor from onLoad
  const slotsFallback = Buffer.concat([
    actionPush(pushReg(1), pushCp(CP.slots)), GET_MEMBER,
    actionPush(pushInt(0)), GET_MEMBER,
    storeReg(3), POP,
  ]);
  const soFallback = Buffer.concat([
    actionPush(pushStr('miniPixiz/card'), pushInt(1)),
    actionPush(pushStr('SharedObject')), GET_VARIABLE,
    actionPush(pushStr('getLocal')),
    CALL_METHOD,
    actionPush(pushStr('data')), GET_MEMBER,
    actionPush(pushStr('fruticard')), GET_MEMBER,
    actionPush(pushInt(0)), GET_MEMBER,
    storeReg(3), POP,
    actionPush(pushReg(3), pushCp(CP.$stat)), GET_MEMBER,
    actionIf(slotsFallback.length),
    slotsFallback,
  ]);
  // r7 holds the saved original `data` arg (r4-r6 are reserved later in
  // saveSlot for pipe string + LoadVars params/receiver). If Cm.card was
  // empty but r7.$stat is a real Card, use that. Else fall through.
  const r7Fallback = Buffer.concat([
    actionPush(pushReg(7)),
    storeReg(3), POP,
    actionPush(pushReg(3), pushCp(CP.$stat)), GET_MEMBER,
    actionIf(soFallback.length),
    soFallback,
  ]);
  const getCard = Buffer.concat([
    actionPush(pushReg(3)),
    storeReg(7), POP,
    actionPush(pushCp(CP.Cm_obf)), GET_VARIABLE,
    actionPush(pushCp(CP.card_obf)), GET_MEMBER,
    storeReg(3), POP,
    actionPush(pushReg(3), pushCp(CP.$stat)), GET_MEMBER,
    actionIf(r7Fallback.length),
    r7Fallback,
  ]);

  // Mutate Cm.card's properties from r3 IN PLACE (instead of reassigning
  // the static). Reassignment doesn't propagate because `]q.4d(*` is a
  // getter we can't override; mutating the object the getter returns
  // works regardless. Idempotent when r3 already IS Cm.card (the loop
  // copies field-to-itself, harmless).
  const reanchorCmCard = (() => {
    const fetchCard = Buffer.concat([
      actionPush(pushCp(CP.Cm_obf)), GET_VARIABLE,
      actionPush(pushCp(CP.card_obf)), GET_MEMBER,
      storeReg(8), POP,
    ]);
    const skipGuard = Buffer.concat([
      actionPush(pushReg(8)), NOT,
    ]);
    const copy = (propCp) => Buffer.concat([
      actionPush(pushReg(8), pushCp(propCp)),
      actionPush(pushReg(3), pushCp(propCp)), GET_MEMBER,
      SET_MEMBER,
    ]);
    const mutateBody = Buffer.concat([
      copy(CP.$stat),
      copy(CP.$diam),
      copy(CP.$key),
      copy(CP.$star),
      copy(CP.$bag),
      copy(CP.$vs),
      copy(CP.$frog),
      copy(CP.$dungeon),
      copy(CP.$rainbow),
      copy(CP.$pond),
      copy(CP.$faerie),
    ]);
    return Buffer.concat([fetchCard, skipGuard, actionIf(mutateBody.length), mutateBody]);
  })();

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

  // After loop: separator + $vs (field 18) + $inv (field 19, CSV) +
  // $current (field 20, scalar) + $checkpoint (field 21, scalar).
  //
  // $inv contents (the in-game bag inventory) MUST be persisted across
  // sessions: when empty the SWF doesn't render the bag UI element at
  // all, so an empty $inv on reload makes the bag invisible even though
  // $bag (the size scalar) is preserved. Same for $current (currently
  // selected faerie/zone) and $checkpoint (dungeon checkpoint).
  const afterLoop = Buffer.concat([
    actionPush(pushStr('|')), ADD2,
    actionPush(pushReg(3), pushCp(CP.$vs)), GET_MEMBER,
    actionPush(pushStr('')), ADD2,
    ADD2,
    // |<inv-csv>
    actionPush(pushStr('|')), ADD2,
    actionPush(pushCp(CP.comma)),                          // ","
    actionPush(pushInt(1)),                                // argCount=1
    actionPush(pushReg(3), pushCp(CP.$inv)), GET_MEMBER,   // r3.$inv
    actionPush(pushCp(CP.join)),                           // "join"
    CALL_METHOD,                                           // → joined string
    ADD2,                                                  // accum + joined
    // |<current>
    actionPush(pushStr('|')), ADD2,
    actionPush(pushReg(3), pushCp(CP.$current)), GET_MEMBER,
    actionPush(pushStr('')), ADD2,
    ADD2,
    // |<checkpoint>
    actionPush(pushStr('|')), ADD2,
    actionPush(pushReg(3), pushCp(CP.$checkpoint)), GET_MEMBER,
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

  return Buffer.concat([getCard, reanchorCmCard, skipIfNull, guardedBody]);
}

const saveSlotBody = buildSaveSlotBody();
const newSaveSlotFunc = buildDefineFunction2('', [[2, 'n'], [3, 'data']], 8, 0x29, saveSlotBody);

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
