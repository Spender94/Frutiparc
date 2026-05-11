#!/usr/bin/env node
// Patches Games/motionBall2/motionball.swf so that:
//   1. STANDALONE is set to true (was false in the compiled SWF)
//   2. serviceConnect initialises slots=[], overrides disc-type methods
//      (isBlack→false, isWhite→true) to enable all game modes + menu return,
//      overrides saveScore (getURL → /api/saveScore),
//      overrides saveSlot (pipe-delimited getURL → /api/saveFrutiSlot),
//      overrides endGame to set gameRunning=false,
//      then LOADS slot0 from /api/loadFrutiSlots via LoadVars.sendAndLoad and
//      defers onServiceConnect to the async onLoad callback so progression
//      restored from DB before the menu paints (no XMLSocket connections).
//
// This makes the game work in game-popup.html without XMLSocket/Frusion infrastructure.

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
  let off = rectBytes + 4;
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

// ─── Bytecode helpers ───

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
function pushBool(v) { return Buffer.from([0x05, v ? 1 : 0]); }
function pushStr(s) {
  return Buffer.concat([Buffer.from([0x00]), Buffer.from(s + '\0', 'latin1')]);
}

function actionPush(...items) {
  const payload = Buffer.concat(items);
  const hdr = Buffer.alloc(3);
  hdr[0] = 0x96;
  hdr.writeUInt16LE(payload.length, 1);
  return Buffer.concat([hdr, payload]);
}
function simpleAction(op) { return Buffer.from([op]); }
const POP         = simpleAction(0x17);
const SET_MEMBER  = simpleAction(0x4F);
const GET_MEMBER  = simpleAction(0x4E);
const CALL_METHOD = simpleAction(0x52);
const INIT_ARRAY  = simpleAction(0x42);
const INIT_OBJECT = simpleAction(0x43);
const ADD2        = simpleAction(0x47);

function storeReg(r) { return Buffer.from([0x87, 0x01, 0x00, r]); }

function actionGetURL2(flags) {
  return Buffer.from([0x9A, 0x01, 0x00, flags]);
}
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
  9: 'isBlack',
  17: 'serviceConnect',
  18: 'slots',
  19: 'onServiceConnect',
  22: '',
  24: 'endGame',
  25: 'onEndGame',
  35: 'saveScore',
  36: 'rankingScore',
  37: 'rankingData',
  38: 'ranking',
  39: 'onSaveScore',
  57: 'bestScorePos',
  58: 'oldPos',
  59: 'oldScore',
  62: 'isWhite',
  63: 'gameRunning',
};
for (const [idx, expected] of Object.entries(expectedCp)) {
  if (cp.entries[idx] !== expected) {
    throw new Error(`CP[${idx}] expected '${expected}', got '${cp.entries[idx]}'`);
  }
}

// Step 1: Add new strings to constant pool
const newStrings = [
  // Mode 0 routes to mb2_classic (visible in fiche as rk=2); the server
  // mirrors the score to mb2_challenge for the daily Championnat ranking.
  'score:mb2:0:',         // CP[69] - getURL score URL prefix
  '_blank',                // CP[70] - getURL target window
  // Slot load mechanism (LoadVars + ExternalInterface.call('parseJSON', …))
  'LoadVars',              // CP[71]
  'game',                  // CP[72]
  'sid',                   // CP[73]
  'mb2',                   // CP[74]
  '_client',               // CP[75]
  'onLoad',                // CP[76]
  'slot0',                 // CP[77]
  'POST',                  // CP[78]
  '/api/loadFrutiSlots',   // CP[79]
  'sendAndLoad',           // CP[80]
  'parseJSON',             // CP[81]
  'flash',                 // CP[82]
  'external',              // CP[83]
  'ExternalInterface',     // CP[84]
  'call',                  // CP[85]
];

const newCpBase = cp.count; // 69

let newCpData = Buffer.alloc(0);
for (const s of newStrings) {
  newCpData = Buffer.concat([newCpData, Buffer.from(s + '\0', 'latin1')]);
}
const cpDelta = newCpData.length;

const cpDataEnd = cp.dataEnd;
const beforeCpEnd = buf.slice(0, cpDataEnd);
const afterCpEnd = buf.slice(cpDataEnd);

buf = Buffer.concat([beforeCpEnd, newCpData, afterCpEnd]);

const newCpPayloadLen = cp.payloadLen + cpDelta;
const newCpCount = cp.count + newStrings.length;
buf.writeUInt16LE(newCpPayloadLen, cpStart + 1);
buf.writeUInt16LE(newCpCount, cpStart + 3);

if (targetTag.hdrSize !== 6) throw new Error('Expected long-form tag');
const newTagLen = targetTag.length + cpDelta;
buf.writeUInt32LE(newTagLen, targetTag.offset + 2);

console.log(`Added ${newStrings.length} CP entries (+${cpDelta} bytes)`);
console.log(`CP: ${cp.payloadLen} -> ${newCpPayloadLen}, count: ${cp.count} -> ${newCpCount}`);

// All offsets after cpDataEnd are shifted by cpDelta
const shift = (o) => o >= cpDataEnd ? o + cpDelta : o;

// Step 2: Set STANDALONE = true
const standaloneOffset = shift(1514071);
if (buf[standaloneOffset] !== 0x00) {
  throw new Error(`Expected Bool(false) at ${standaloneOffset}, got 0x${buf[standaloneOffset].toString(16)}`);
}
if (buf[standaloneOffset - 1] !== 0x05) {
  throw new Error(`Expected Bool type 0x05 at ${standaloneOffset - 1}`);
}
buf[standaloneOffset] = 0x01;
console.log(`Set STANDALONE = true at offset ${standaloneOffset}`);

// Step 3: Replace serviceConnect function body

// Constant pool index map (existing + new entries)
const CP = {
  isBlack: 9,
  serviceConnect: 17,
  slots: 18,
  onServiceConnect: 19,
  emptyStr: 22,
  endGame: 24,
  onEndGame: 25,
  saveSlot: 34,
  saveScore: 35,
  rankingScore: 36,
  rankingData: 37,
  ranking: 38,
  onSaveScore: 39,
  bestScorePos: 57,
  oldPos: 58,
  oldScore: 59,
  isWhite: 62,
  gameRunning: 63,
  scorePrefix: newCpBase + 0,        // 69: 'score:mb2:0:'
  _blank: newCpBase + 1,             // 70: '_blank'
  LoadVars: newCpBase + 2,            // 71
  game: newCpBase + 3,                // 72
  sid: newCpBase + 4,                 // 73
  mb2: newCpBase + 5,                 // 74
  _client: newCpBase + 6,             // 75
  onLoad: newCpBase + 7,              // 76
  slot0: newCpBase + 8,               // 77
  POST: newCpBase + 9,                // 78
  loadUrl: newCpBase + 10,            // 79
  sendAndLoad: newCpBase + 11,        // 80
  parseJSON: newCpBase + 12,          // 81
  flash: newCpBase + 13,              // 82
  external: newCpBase + 14,           // 83
  ExternalInterface: newCpBase + 15,  // 84
  call: newCpBase + 16,               // 85
};

// Inner function: saveScore(score, data)
// DefineFunction2 flags 0x29: preloadThis | suppressArguments | suppressSuper
// r1=this, r2=score(param1), r3=data(param2)
function buildSaveScoreBody() {
  // getURL("score:mb2:1:" + score, "_blank")
  // Stack order for GetURL2: URL (bottom), target (top)
  const doGetURL = Buffer.concat([
    actionPush(pushCp(CP.scorePrefix)),  // URL prefix "score:mb2:1:"
    actionPush(pushReg(2)),              // score
    ADD2,                                // URL = "score:mb2:1:" + score
    actionPush(pushCp(CP._blank)),       // target "_blank"
    actionGetURL2(0x00),                 // getURL(url, target)
  ]);

  // this.ranking = { rankingScore:score, rankingData:data, oldScore:0, oldPos:0, bestScorePos:0 }
  const setRanking = Buffer.concat([
    actionPush(pushReg(1), pushCp(CP.ranking)),
    actionPush(pushCp(CP.rankingScore), pushReg(2)),
    actionPush(pushCp(CP.rankingData), pushReg(3)),
    actionPush(pushCp(CP.oldScore), pushInt(0)),
    actionPush(pushCp(CP.oldPos), pushInt(0)),
    actionPush(pushCp(CP.bestScorePos), pushInt(0)),
    actionPush(pushInt(5)),
    INIT_OBJECT,
    SET_MEMBER,
  ]);

  // this.onSaveScore()
  const callOnSaveScore = Buffer.concat([
    actionPush(pushInt(0), pushReg(1), pushCp(CP.onSaveScore)),
    CALL_METHOD,
    POP,
  ]);

  return Buffer.concat([doGetURL, setRanking, callOnSaveScore]);
}

// Inner function: endGame()
// DefineFunction2 flags 0x29: preloadThis | suppressArguments | suppressSuper
// r1=this
function buildEndGameBody() {
  // this.gameRunning = false
  const clearGameRunning = Buffer.concat([
    actionPush(pushReg(1), pushCp(CP.gameRunning), pushBool(false)),
    SET_MEMBER,
  ]);

  // this.onEndGame("")
  const callOnEndGame = Buffer.concat([
    actionPush(pushCp(CP.emptyStr), pushInt(1), pushReg(1), pushCp(CP.onEndGame)),
    CALL_METHOD,
    POP,
  ]);

  return Buffer.concat([clearGameRunning, callOnEndGame]);
}

const RETURN = simpleAction(0x3E);
const GET_VARIABLE = simpleAction(0x1C);
const NEW_OBJECT = simpleAction(0x40);
const EQUALS2 = simpleAction(0x49);
const NOT = simpleAction(0x12);
function pushNull() { return Buffer.from([0x02]); }
function pushUndef() { return Buffer.from([0x03]); }

// Inner function: saveSlot(n, cb)
// DefineFunction2 flags 0x29: preloadThis | suppressArguments | suppressSuper
// r1=this, r2=n(param), r3=cb(param), r4=card, r5=pipe-string
// Only persists slot 0 (the Card). Other slots (prefs) are no-ops here —
// the server stores the slot raw and extracts pictos from $items on slot 0.
function buildSaveSlotBody() {
  // r4 = this.slots[0]
  const getCard = Buffer.concat([
    actionPush(pushReg(1), pushCp(CP.slots)), GET_MEMBER,
    actionPush(pushInt(0)), GET_MEMBER,
    storeReg(4), POP,
  ]);

  // Helper: append card.<prop> (coerced to string) to the running stack-top string
  function appendValue(propStr) {
    return Buffer.concat([
      actionPush(pushReg(4), pushStr(propStr)), GET_MEMBER,
      actionPush(pushStr('')), ADD2,   // forces value→string (arrays use toString = join(','))
      ADD2,                             // concat onto running string
    ]);
  }
  function appendLiteral(piece) {
    return Buffer.concat([actionPush(pushStr(piece)), ADD2]);
  }

  // Build pipe-delimited string: items|challenge|classic|courses|dungeons|dungeons_done|classic_score|dtimes
  const buildPipe = Buffer.concat([
    actionPush(pushStr('')),
    appendValue('$items'),
    appendLiteral('|'), appendValue('$challenge'),
    appendLiteral('|'), appendValue('$classic'),
    appendLiteral('|'), appendValue('$courses'),
    appendLiteral('|'), appendValue('$dungeons'),
    appendLiteral('|'), appendValue('$dungeons_done'),
    appendLiteral('|'), appendValue('$classic_score'),
    appendLiteral('|'), appendValue('$dtimes'),
    storeReg(5), POP,
  ]);

  // getURL("slot:mb2:0:" + r5, "_blank")
  // Ruffle routes getURL with target to window.open → intercepted by game-popup.html
  const doGetURL = Buffer.concat([
    actionPush(pushStr('slot:mb2:0:'), pushReg(5)), ADD2,
    actionPush(pushCp(CP._blank)),
    actionGetURL2(0x00),
  ]);

  const bodyWhenSlot0 = Buffer.concat([getCard, buildPipe, doGetURL]);

  // if (n != 0) skip body. ActionIf jumps forward if popped value is truthy.
  // Push n: when n=0 falls through to body; when n!=0 jumps over body.
  return Buffer.concat([
    actionPush(pushReg(2)),
    actionIf(bodyWhenSlot0.length),
    bodyWhenSlot0,
  ]);
}

// Inner function: result.onLoad(success)
// DefineFunction2 flags 0x29: r1=this (result LoadVars), r2=success(param), r3=client, r4=slot0_then_parsed
// Restores slot0 from server response (if any) then calls client.onServiceConnect()
function buildOnLoadBody() {
  // r3 = this._client
  const getClient = Buffer.concat([
    actionPush(pushReg(1), pushCp(CP._client)), GET_MEMBER,
    storeReg(3), POP,
  ]);

  // client.slots[0] = r4 (the parsed object)
  const doAssign = Buffer.concat([
    actionPush(pushReg(3), pushCp(CP.slots)), GET_MEMBER,
    actionPush(pushInt(0), pushReg(4)),
    SET_MEMBER,
  ]);

  // Parse JSON via ExternalInterface.call('parseJSON', r4_slot0_string), then maybe assign
  const parseAndMaybeAssign = Buffer.concat([
    // Push args + argcount + object + method for ExternalInterface.call("parseJSON", slot0Str)
    actionPush(pushReg(4)),                                   // arg1 = slot0 string
    actionPush(pushCp(CP.parseJSON)),                          // arg0 (JS function name)
    actionPush(pushInt(2)),                                    // argcount
    actionPush(pushCp(CP.flash)), GET_VARIABLE,               // flash
    actionPush(pushCp(CP.external)), GET_MEMBER,              // .external
    actionPush(pushCp(CP.ExternalInterface)), GET_MEMBER,     // .ExternalInterface
    actionPush(pushCp(CP.call)),                               // method "call"
    CALL_METHOD,
    storeReg(4), POP,                                          // r4 = parsed (or null)
    // if (r4 == null) skip doAssign
    actionPush(pushReg(4), pushNull()), EQUALS2,
    actionIf(doAssign.length),
    doAssign,
  ]);

  // Slot0 check block: get this.slot0; if not undefined, parseAndMaybeAssign
  const slot0CheckBlock = Buffer.concat([
    actionPush(pushReg(1), pushCp(CP.slot0)), GET_MEMBER,
    storeReg(4), POP,
    actionPush(pushReg(4), pushUndef()), EQUALS2,
    actionIf(parseAndMaybeAssign.length),
    parseAndMaybeAssign,
  ]);

  // Always: client.onServiceConnect()
  const callOnServiceConnect = Buffer.concat([
    actionPush(pushInt(0), pushReg(3), pushCp(CP.onServiceConnect)),
    CALL_METHOD, POP,
  ]);

  // Top-level: if (!success) skip slot0CheckBlock; always call onServiceConnect
  return Buffer.concat([
    getClient,
    actionPush(pushReg(2)), NOT,
    actionIf(slot0CheckBlock.length),
    slot0CheckBlock,
    callOnServiceConnect,
  ]);
}

// Outer function: serviceConnect()
// DefineFunction2 flags 0x29: preloadThis | suppressArguments | suppressSuper
// r1=this, r2=lv (LoadVars request), r3=result (LoadVars response)
function buildServiceConnectBody() {
  // this.slots = []
  // slots[0] is left undefined so onServiceConnect creates a new mb2.Card()
  // which properly initialises $items, $dtimes, $records and all mode flags.
  const initSlots = Buffer.concat([
    actionPush(pushReg(1), pushCp(CP.slots), pushInt(0)),
    INIT_ARRAY,
    SET_MEMBER,
  ]);

  // this.isBlack = function() { return false; }
  // The STANDALONE constructor patches isBlack→true (challenge-disc mode).
  // We override it to false so isChallengeDisc() returns false, enabling
  // Course, Adventure and Classic menu entries.
  const isBlackBody = Buffer.concat([actionPush(pushBool(false)), RETURN]);
  const overrideIsBlack = Buffer.concat([
    actionPush(pushReg(1), pushCp(CP.isBlack)),
    buildDefineFunction2('', [], 1, 0x28, isBlackBody),
    SET_MEMBER,
  ]);

  // this.isWhite = function() { return true; }
  // Manager.gameFinished() checks isWhite() — only the "white" path returns
  // to the menu; the else-branch calls closeService() which exits the game.
  const isWhiteBody = Buffer.concat([actionPush(pushBool(true)), RETURN]);
  const overrideIsWhite = Buffer.concat([
    actionPush(pushReg(1), pushCp(CP.isWhite)),
    buildDefineFunction2('', [], 1, 0x28, isWhiteBody),
    SET_MEMBER,
  ]);

  // this.saveScore = function(score, data) { ... }
  const saveScoreInner = buildSaveScoreBody();
  const saveScoreFunc = buildDefineFunction2('', [[2, ''], [3, '']], 4, 0x29, saveScoreInner);
  const overrideSaveScore = Buffer.concat([
    actionPush(pushReg(1), pushCp(CP.saveScore)),
    saveScoreFunc,
    SET_MEMBER,
  ]);

  // this.endGame = function() { ... }
  const endGameInner = buildEndGameBody();
  const endGameFunc = buildDefineFunction2('', [], 2, 0x29, endGameInner);
  const overrideEndGame = Buffer.concat([
    actionPush(pushReg(1), pushCp(CP.endGame)),
    endGameFunc,
    SET_MEMBER,
  ]);

  // this.saveSlot = function(n, cb) { ... }
  // Persists slot 0 (Card) via getURL → /api/saveFrutiSlot, which triggers
  // server-side picto extraction with userLog notification.
  const saveSlotInner = buildSaveSlotBody();
  const saveSlotFunc = buildDefineFunction2('', [[2, ''], [3, '']], 6, 0x29, saveSlotInner);
  const overrideSaveSlot = Buffer.concat([
    actionPush(pushReg(1), pushCp(CP.saveSlot)),
    saveSlotFunc,
    SET_MEMBER,
  ]);

  // Async slot load: var lv = new LoadVars(); lv.game="mb2"; lv.sid=_root.sid;
  // var result = new LoadVars(); result._client = this;
  // result.onLoad = function(success) { ... parse slot0 ... call client.onServiceConnect() };
  // lv.sendAndLoad("/api/loadFrutiSlots", result, "POST");

  const createLv = Buffer.concat([
    actionPush(pushInt(0), pushCp(CP.LoadVars)),
    NEW_OBJECT,
    storeReg(2), POP,
  ]);
  const setGame = Buffer.concat([
    actionPush(pushReg(2), pushCp(CP.game), pushCp(CP.mb2)),
    SET_MEMBER,
  ]);
  const setSid = Buffer.concat([
    actionPush(pushReg(2), pushCp(CP.sid)),
    actionPush(pushStr('_root')), GET_VARIABLE,
    actionPush(pushCp(CP.sid)), GET_MEMBER,
    SET_MEMBER,
  ]);
  const createResult = Buffer.concat([
    actionPush(pushInt(0), pushCp(CP.LoadVars)),
    NEW_OBJECT,
    storeReg(3), POP,
  ]);
  const setResultClient = Buffer.concat([
    actionPush(pushReg(3), pushCp(CP._client), pushReg(1)),
    SET_MEMBER,
  ]);
  const onLoadFunc = buildDefineFunction2('', [[2, '']], 6, 0x29, buildOnLoadBody());
  const setOnLoad = Buffer.concat([
    actionPush(pushReg(3), pushCp(CP.onLoad)),
    onLoadFunc,
    SET_MEMBER,
  ]);
  const sendAndLoad = Buffer.concat([
    actionPush(pushCp(CP.POST)),       // arg3 (method)
    actionPush(pushReg(3)),             // arg2 (target = result)
    actionPush(pushCp(CP.loadUrl)),    // arg1 (url)
    actionPush(pushInt(3)),
    actionPush(pushReg(2), pushCp(CP.sendAndLoad)),
    CALL_METHOD,
    POP,
  ]);

  return Buffer.concat([
    initSlots,
    overrideIsBlack, overrideIsWhite,
    overrideSaveScore, overrideEndGame, overrideSaveSlot,
    createLv, setGame, setSid,
    createResult, setResultClient, setOnLoad,
    sendAndLoad,
  ]);
}

const serviceConnectBody = buildServiceConnectBody();
const newServiceConnectFunc = buildDefineFunction2('', [], 4, 0x29, serviceConnectBody);

// Find and replace the old serviceConnect DefineFunction2 in the buffer
// Original offsets (before CP expansion): DefineFunction2 at 1512700, SetMember at 1512789
const origFuncStart = shift(1512700);
const origFuncEnd = shift(1512789);

if (buf[origFuncStart] !== 0x8E) {
  throw new Error(`Expected DefineFunction2 (0x8E) at ${origFuncStart}, got 0x${buf[origFuncStart].toString(16)}`);
}
if (buf[origFuncEnd] !== 0x4F) {
  throw new Error(`Expected SetMember (0x4F) at ${origFuncEnd}, got 0x${buf[origFuncEnd].toString(16)}`);
}

const oldFuncBytes = origFuncEnd - origFuncStart;
console.log(`Old serviceConnect: ${oldFuncBytes} bytes at ${origFuncStart}`);
console.log(`New serviceConnect: ${newServiceConnectFunc.length} bytes`);

const funcDelta = newServiceConnectFunc.length - oldFuncBytes;

const beforeFunc = buf.slice(0, origFuncStart);
const afterFunc = buf.slice(origFuncEnd);
buf = Buffer.concat([beforeFunc, newServiceConnectFunc, afterFunc]);

// Update DoInitAction tag length
const currentTagLen = buf.readUInt32LE(targetTag.offset + 2);
buf.writeUInt32LE(currentTagLen + funcDelta, targetTag.offset + 2);

console.log(`Tag length: ${currentTagLen} -> ${currentTagLen + funcDelta} (delta ${funcDelta})`);

// Step 4: Write the patched SWF
const outSize = writeSwf(OUT_PATH, sig, version, buf);
console.log(`Wrote ${OUT_PATH} (${outSize} bytes)`);
console.log('Done!');
