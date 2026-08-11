#!/usr/bin/env node
// Patches Games/miniWave2/miniwave.swf so that:
//   1. STANDALONE is set to true (game runs without Frusion LocalConnection)
//   2. loadFruticard uses SharedObject.getLocal instead of _root.loadData
//   3. saveSlot serializes slot data to a pipe-delimited string and sends
//      via ExternalInterface.call (Ruffle can't serialize AS2 objects, but
//      strings pass through fine)
//   4. fcVersion bumped 0.93 → 0.94 so patchFruticard triggers on startup
//
// The game runs in game-popup.html.  Local persistence is handled by
// SharedObject.flush().  Server persistence + picto extraction is handled
// by the ExternalInterface path sending a string to JavaScript, which
// reconstructs the JSON and POSTs to /api/saveFrutiSlot.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SWF_PATH = path.resolve(__dirname, '..', 'Games', 'miniWave2', 'miniwave.swf');
const FULL_PATH = path.resolve(__dirname, '..', 'Games', 'miniWave2', 'full.swf');
const BACKUP_PATH = SWF_PATH + '.bak';

// ─── SWF read/write helpers ───

function readSwf(filePath) {
  const raw = fs.readFileSync(filePath);
  const sig = raw.slice(0, 3).toString('ascii');
  const version = raw[3];
  let body;
  if (sig === 'CWS') body = zlib.inflateSync(raw.slice(8));
  else if (sig === 'FWS') body = Buffer.from(raw.slice(8));
  else throw new Error('Unsupported sig: ' + sig);
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
    if (length === 0x3f) { length = body.readUInt32LE(off + 2); hdrSize = 6; }
    if (code === 0) break;
    tags.push({ code, offset: off, hdrSize, length });
    off += hdrSize + length;
  }
  return tags;
}

function parseConstantPool(buf, cpStart) {
  if (buf[cpStart] !== 0x88) return null;
  const payloadLen = buf.readUInt16LE(cpStart + 1);
  const count = buf.readUInt16LE(cpStart + 3);
  const entries = [];
  let pos = cpStart + 5;
  while (entries.length < count) {
    const end = buf.indexOf(0, pos);
    if (end < 0) return null;
    entries.push(buf.slice(pos, end).toString('latin1'));
    pos = end + 1;
  }
  return { payloadLen, count, entries, dataEnd: cpStart + 3 + payloadLen };
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

function actionPush(...items) {
  const payload = Buffer.concat(items);
  const hdr = Buffer.alloc(3);
  hdr[0] = 0x96;
  hdr.writeUInt16LE(payload.length, 1);
  return Buffer.concat([hdr, payload]);
}
function simpleAction(op) { return Buffer.from([op]); }

const POP = simpleAction(0x17);
const ADD2 = simpleAction(0x47);
const GET_MEMBER = simpleAction(0x4E);
const SET_MEMBER = simpleAction(0x4F);
const GET_VARIABLE = simpleAction(0x1C);
const CALL_METHOD = simpleAction(0x52);
const NEW_OBJECT = simpleAction(0x40);

function storeReg(r) { return Buffer.from([0x87, 0x01, 0x00, r]); }

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

function findPropertyDF2(buf, searchStart, searchEnd, cpIdx) {
  for (let i = searchStart; i < searchEnd - 10; i++) {
    if (buf[i] !== 0x96) continue;
    const pushLen = buf.readUInt16LE(i + 1);
    if (pushLen < 1 || pushLen > 50) continue;
    const payload = buf.slice(i + 3, i + 3 + pushLen);
    let found = false;
    for (let p = 0; p < payload.length; p++) {
      if (payload[p] === 0x08 && cpIdx < 256 && p + 1 < payload.length && payload[p + 1] === cpIdx) { found = true; break; }
      if (payload[p] === 0x09 && p + 2 < payload.length && payload.readUInt16LE(p + 1) === cpIdx) { found = true; break; }
    }
    if (!found) continue;
    const afterPush = i + 3 + pushLen;
    for (let look = afterPush; look < afterPush + 5 && look < searchEnd; look++) {
      if (buf[look] !== 0x8E) continue;
      let off = look + 3;
      const nameEnd = buf.indexOf(0, off); if (nameEnd < 0) break;
      off = nameEnd + 1;
      const numParams = buf.readUInt16LE(off); off += 2;
      off += 1; off += 2;
      for (let p = 0; p < numParams; p++) { off += 1; const pe = buf.indexOf(0, off); off = pe + 1; }
      const codeSize = buf.readUInt16LE(off); off += 2;
      const bodyEnd = off + codeSize;
      if (bodyEnd < searchEnd && buf[bodyEnd] === 0x4F) {
        return { pushStart: i, df2Start: look, bodyStart: off, bodyEnd, df2End: bodyEnd };
      }
      break;
    }
  }
  return null;
}

// ─── Build new saveSlot function body ───
// Serializes _root.mng.fc[n] to a pipe-delimited string and sends it
// via getURL("slot:miniwave:N:PIPEDATA", "_blank").
// Ruffle translates getURL with a target into window.open(), which is
// intercepted by game-popup.html to POST to /api/saveFrutiSlot.
// This is the same proven mechanism used for score saving.
// Also flushes SharedObject for local persistence.

function buildSaveSlotBody(CP) {
  // r2=n (param), r3=fc[n] (computed), r4=SO temp, r5=pipe string

  function appendSimpleProp(propCp) {
    return Buffer.concat([
      actionPush(pushReg(3), pushCp(propCp)), GET_MEMBER,
      actionPush(pushStr('')), ADD2,
      ADD2,
      actionPush(pushStr('|')), ADD2,
    ]);
  }

  function appendNestedProp(prop1Cp, prop2Cp) {
    return Buffer.concat([
      actionPush(pushReg(3), pushCp(prop1Cp)), GET_MEMBER,
      actionPush(pushCp(prop2Cp)), GET_MEMBER,
      actionPush(pushStr('')), ADD2,
      ADD2,
      actionPush(pushStr('|')), ADD2,
    ]);
  }

  // Part 1: Get _root.mng.fc[n] → r3
  const getFc = Buffer.concat([
    actionPush(pushStr('_root')), GET_VARIABLE,
    actionPush(pushCp(CP.mng)), GET_MEMBER,
    actionPush(pushCp(CP.fc)), GET_MEMBER,
    actionPush(pushReg(2)), GET_MEMBER,
    storeReg(3), POP,
  ]);

  // Part 2: Build pipe string → r5
  // Format: ship|badsKill|arcadeBestLevel|consBonus|consLetter|shop|vs|arcadeBestScore
  //
  // arcadeBestScore is APPENDED LAST, after vs, on purpose: an older cached
  // build of this SWF still sends seven fields, and the readers must keep
  // accepting those. A missing eighth field means "the SWF doesn't know about
  // it" — the server then leaves $bestScore alone (see miniwaveGreffeHorsTuyau)
  // instead of overwriting a real record with a zero.
  //
  // Without it, the personal arcade record stayed locked inside the SWF: the
  // card kept it in memory, but the only channel out carried the best LEVEL
  // and not the best SCORE. It feeds no ranking (the daily MiniWave ranking
  // measures the light-only Challenge) — it just keeps the record true on the
  // server-side card.
  const buildStr = Buffer.concat([
    actionPush(pushStr('')),

    appendSimpleProp(CP.$ship),
    appendSimpleProp(CP.$badsKill),
    appendNestedProp(CP.$arcade, CP.$bestLevel),
    appendNestedProp(CP.$cons, CP.$bonus),
    appendNestedProp(CP.$cons, CP.$letter),
    appendSimpleProp(CP.$shop),
    appendSimpleProp(CP.$vs),

    actionPush(pushReg(3), pushCp(CP.$arcade)), GET_MEMBER,
    actionPush(pushCp(CP.$bestScore)), GET_MEMBER,
    actionPush(pushStr('')), ADD2,
    ADD2,

    storeReg(5), POP,
  ]);

  // Part 3: getURL("slot:miniwave:N:PIPEDATA", "_blank")
  // Ruffle routes this through window.open, intercepted by game-popup.html.
  const GETURL2 = Buffer.from([0x9A, 0x01, 0x00, 0x00]); // ActionGetURL2, flags=0x00
  const getUrlCall = Buffer.concat([
    // Build URL string on stack
    actionPush(pushStr('slot:miniwave:')),
    actionPush(pushReg(2), pushStr('')), ADD2,   // n → "0"
    ADD2,                                         // "slot:miniwave:0"
    actionPush(pushStr(':')), ADD2,              // "slot:miniwave:0:"
    actionPush(pushReg(5)), ADD2,                // "slot:miniwave:0:PIPEDATA"
    // Target
    actionPush(pushStr('_blank')),
    // getURL2(url, target)
    GETURL2,
  ]);

  // Part 4: SharedObject.getLocal("miniWave2/card2").flush()
  const soFlush = Buffer.concat([
    actionPush(pushCp(CP.miniWave2Card)),
    actionPush(pushInt(1)),
    actionPush(pushCp(CP.SharedObject)), GET_VARIABLE,
    actionPush(pushCp(CP.getLocal)),
    CALL_METHOD,
    storeReg(4), POP,
    actionPush(pushInt(0)),
    actionPush(pushReg(4), pushCp(CP.flush)),
    CALL_METHOD, POP,
  ]);

  return Buffer.concat([getFc, buildStr, getUrlCall, soFlush]);
}

// ─── Patch Client DoInitAction ───

function patchClientTagBody(tagBody) {
  const spriteId = tagBody.readUInt16LE(0);
  const cp = parseConstantPool(tagBody, 2);
  if (!cp) throw new Error('Cannot parse constant pool');
  if (cp.entries[3] !== 'Client') throw new Error(`Expected Client at CP[3], got '${cp.entries[3]}'`);

  const ssIdx = cp.entries.indexOf('saveSlot');
  const standaloneIdx = cp.entries.indexOf('STANDALONE');

  if (ssIdx < 0) throw new Error('Missing saveSlot in CP');

  console.log(`  Sprite ${spriteId}: CP count=${cp.count}, saveSlot=CP[${ssIdx}]`);

  // Add new CP entries
  const newCpBase = cp.count;
  const newStrings = [
    'SharedObject',           // +0
    'getLocal',                // +1
    'miniWave2/card2',         // +2
    'flush',                   // +3
    'mng',                     // +4
    'fc',                      // +5
    '$ship',                   // +6
    '$badsKill',               // +7
    '$arcade',                 // +8
    '$bestLevel',              // +9
    '$cons',                   // +10
    '$bonus',                  // +11
    '$letter',                 // +12
    '$shop',                   // +13
    '$vs',                     // +14
    'LoadVars',                // +15
    'sid',                     // +16
    'game',                    // +17
    'slotId',                  // +18
    'data',                    // +19
    'sendAndLoad',             // +20
    '/api/saveFrutiSlot',      // +21
    'POST',                    // +22
    '$bestScore',              // +23
  ];

  let newCpData = Buffer.alloc(0);
  for (const s of newStrings) {
    newCpData = Buffer.concat([newCpData, Buffer.from(s + '\0', 'latin1')]);
  }
  const cpDelta = newCpData.length;

  tagBody = Buffer.concat([
    tagBody.slice(0, cp.dataEnd),
    newCpData,
    tagBody.slice(cp.dataEnd),
  ]);
  tagBody.writeUInt16LE(cp.payloadLen + cpDelta, 3);
  tagBody.writeUInt16LE(cp.count + newStrings.length, 5);

  console.log(`  Added ${newStrings.length} CP entries (+${cpDelta} bytes)`);

  const CP = {
    saveSlot: ssIdx,
    miniwave: 1, // "miniwave" is already at CP[1] in the Client constant pool
    SharedObject: newCpBase + 0,
    getLocal: newCpBase + 1,
    miniWave2Card: newCpBase + 2,
    flush: newCpBase + 3,
    mng: newCpBase + 4,
    fc: newCpBase + 5,
    $ship: newCpBase + 6,
    $badsKill: newCpBase + 7,
    $arcade: newCpBase + 8,
    $bestLevel: newCpBase + 9,
    $cons: newCpBase + 10,
    $bonus: newCpBase + 11,
    $letter: newCpBase + 12,
    $shop: newCpBase + 13,
    $vs: newCpBase + 14,
    $bestScore: newCpBase + 23,
    LoadVars: newCpBase + 15,
    sid: newCpBase + 16,
    game: newCpBase + 17,
    slotId: newCpBase + 18,
    data: newCpBase + 19,
    sendAndLoad: newCpBase + 20,
    saveFrutiSlotUrl: newCpBase + 21,
    POST: newCpBase + 22,
  };

  // Verify "miniwave" is at CP[1]
  if (cp.entries[1] !== 'miniwave') {
    // Find it or add it
    const mwIdx = cp.entries.indexOf('miniwave');
    if (mwIdx >= 0) {
      CP.miniwave = mwIdx;
    } else {
      throw new Error('"miniwave" not found in Client CP');
    }
  }

  const newCpDataEnd = cp.dataEnd + cpDelta;

  // Flip STANDALONE = true
  if (standaloneIdx >= 0) {
    const needle = Buffer.from([0x08, standaloneIdx, 0x05, 0x00, 0x4f]);
    const idx = tagBody.indexOf(needle, newCpDataEnd);
    if (idx >= 0) {
      tagBody[idx + 3] = 0x01;
      console.log(`  Set STANDALONE=true at tag-relative offset ${idx + 3}`);
    }
  }

  // Replace saveSlot DF2
  const ssDF2 = findPropertyDF2(tagBody, newCpDataEnd, tagBody.length, ssIdx);
  if (!ssDF2) throw new Error('saveSlot DF2 not found');
  console.log(`  saveSlot DF2 at ${ssDF2.df2Start}, body ${ssDF2.bodyStart}-${ssDF2.bodyEnd} (${ssDF2.bodyEnd - ssDF2.bodyStart} bytes)`);

  const newSsBody = buildSaveSlotBody(CP);
  // flags 0x29 (LSB=PreloadThis convention used by Ruffle):
  //   bit0=PreloadThis(r1=this) + bit3=SuppressArgs + bit5=SuppressSuper
  // We don't actually use r1 in the body — _root is fetched via GetVariable.
  const newSsDF2 = buildDefineFunction2('', [[2, 'n'], [3, 'data']], 6, 0x29, newSsBody);

  console.log(`  saveSlot: ${ssDF2.df2End - ssDF2.df2Start} → ${newSsDF2.length} bytes`);

  tagBody = Buffer.concat([
    tagBody.slice(0, ssDF2.df2Start),
    newSsDF2,
    tagBody.slice(ssDF2.df2End),
  ]);

  return tagBody;
}

// ─── Patch Manager DoInitAction ───

function patchManagerTagBody(tagBody) {
  const spriteId = tagBody.readUInt16LE(0);
  const cp = parseConstantPool(tagBody, 2);
  if (!cp) throw new Error('Cannot parse Manager constant pool');
  if (cp.entries[3] !== 'Manager') throw new Error(`Expected Manager at CP[3], got '${cp.entries[3]}'`);

  const loadDataIdx = cp.entries.indexOf('loadData');
  const miniWave2Idx = cp.entries.indexOf('miniWave2/card');
  const soIdx = cp.entries.indexOf('so');

  if (loadDataIdx < 0 || miniWave2Idx < 0 || soIdx < 0) {
    throw new Error('Missing required CP entries in Manager tag');
  }

  console.log(`  Sprite ${spriteId}: CP count=${cp.count}`);

  // Add SharedObject, getLocal, miniWave2/card2 to CP
  const newCpBase = cp.count;
  const newStrings = ['SharedObject', 'getLocal', 'miniWave2/card2'];
  let newCpData = Buffer.alloc(0);
  for (const s of newStrings) {
    newCpData = Buffer.concat([newCpData, Buffer.from(s + '\0', 'latin1')]);
  }
  const cpDelta = newCpData.length;

  tagBody = Buffer.concat([
    tagBody.slice(0, cp.dataEnd),
    newCpData,
    tagBody.slice(cp.dataEnd),
  ]);
  tagBody.writeUInt16LE(cp.payloadLen + cpDelta, 3);
  tagBody.writeUInt16LE(cp.count + newStrings.length, 5);

  const sharedObjectCpIdx = newCpBase + 0;
  const getLocalCpIdx = newCpBase + 1;
  const newKeyCpIdx = newCpBase + 2;

  // Replace _root.loadData("miniWave2/card") with SharedObject.getLocal("miniWave2/card2")
  const soIdxByte = soIdx < 256 ? Buffer.from([0x08, soIdx]) : Buffer.from([0x09, soIdx & 0xff, (soIdx >> 8) & 0xff]);
  const mw2IdxByte = miniWave2Idx < 256 ? Buffer.from([0x08, miniWave2Idx]) : Buffer.from([0x09, miniWave2Idx & 0xff, (miniWave2Idx >> 8) & 0xff]);
  const ldIdxByte = loadDataIdx < 256 ? Buffer.from([0x08, loadDataIdx]) : Buffer.from([0x09, loadDataIdx & 0xff, (loadDataIdx >> 8) & 0xff]);

  const searchPattern = Buffer.concat([
    Buffer.from([0x96, 0x0f, 0x00]),
    Buffer.from([0x04, 0x01]),
    soIdxByte, mw2IdxByte,
    Buffer.from([0x07, 0x01, 0x00, 0x00, 0x00]),
    Buffer.from([0x04, 0x02]),
    ldIdxByte,
    Buffer.from([0x52]),
    Buffer.from([0x4f]),
  ]);

  const patchOffset = tagBody.indexOf(searchPattern, cp.dataEnd + cpDelta);
  if (patchOffset < 0) throw new Error('Could not find _root.loadData call pattern');

  const shCpByte = sharedObjectCpIdx < 256 ? Buffer.from([0x08, sharedObjectCpIdx]) : Buffer.from([0x09, sharedObjectCpIdx & 0xff, (sharedObjectCpIdx >> 8) & 0xff]);
  const glCpByte = getLocalCpIdx < 256 ? Buffer.from([0x08, getLocalCpIdx]) : Buffer.from([0x09, getLocalCpIdx & 0xff, (getLocalCpIdx >> 8) & 0xff]);
  const newKeyByte = newKeyCpIdx < 256 ? Buffer.from([0x08, newKeyCpIdx]) : Buffer.from([0x09, newKeyCpIdx & 0xff, (newKeyCpIdx >> 8) & 0xff]);

  const replacement = Buffer.concat([
    Buffer.from([0x96, 0x0d, 0x00]),
    Buffer.from([0x04, 0x01]),
    soIdxByte, newKeyByte,
    Buffer.from([0x07, 0x01, 0x00, 0x00, 0x00]),
    shCpByte,
    Buffer.from([0x1c]),
    Buffer.from([0x96, 0x02, 0x00]),
    glCpByte,
    Buffer.from([0x52]),
    Buffer.from([0x4f]),
  ]);

  tagBody = Buffer.concat([
    tagBody.slice(0, patchOffset),
    replacement,
    tagBody.slice(patchOffset + 20),
  ]);

  // Fix DF2 codeSize (+4) and If jump (+4)
  let df2HeaderOff = -1;
  for (let i = patchOffset - 1; i >= patchOffset - 100 && i >= 0; i--) {
    if (tagBody[i] === 0x8E) { df2HeaderOff = i; break; }
  }
  if (df2HeaderOff < 0) throw new Error('Cannot find DF2 header for loadFruticard');

  let df2Off = df2HeaderOff + 3;
  const nameEnd = tagBody.indexOf(0, df2Off); df2Off = nameEnd + 1;
  const numParams = tagBody.readUInt16LE(df2Off); df2Off += 2;
  df2Off += 1; df2Off += 2;
  for (let p = 0; p < numParams; p++) { df2Off += 1; const pe = tagBody.indexOf(0, df2Off); df2Off = pe + 1; }
  const oldCodeSize = tagBody.readUInt16LE(df2Off);
  tagBody.writeUInt16LE(oldCodeSize + 4, df2Off);

  const funcBodyStart = df2Off + 2;
  const ifOff = funcBodyStart + 15;
  if (tagBody[ifOff] !== 0x9d) throw new Error('Expected If at func body @15');
  const oldJump = tagBody.readInt16LE(ifOff + 3);
  tagBody.writeInt16LE(oldJump + 4, ifOff + 3);

  console.log(`  Patched loadFruticard: loadData → SharedObject.getLocal`);

  // Bump fcVersion 0.93 → 0.94
  const fcVersionIdx = cp.entries.indexOf('fcVersion');
  if (fcVersionIdx < 0) throw new Error('fcVersion not found in Manager CP');
  const fcIdxByte = fcVersionIdx < 256 ? Buffer.from([0x08, fcVersionIdx]) : Buffer.from([0x09, fcVersionIdx & 0xff, (fcVersionIdx >> 8) & 0xff]);
  const avm1_093 = Buffer.from('8fc2ed3fc3f5285c', 'hex');
  const avm1_094 = Buffer.from('7a14ee3f14ae47e1', 'hex');
  const initPattern = Buffer.concat([
    Buffer.from([0x96, 0x0d, 0x00, 0x04, 0x01]),
    fcIdxByte,
    Buffer.from([0x06]),
    avm1_093,
    Buffer.from([0x4f]),
  ]);
  const initIdx = tagBody.indexOf(initPattern, cp.dataEnd + cpDelta);
  if (initIdx < 0) throw new Error('fcVersion=0.93 init pattern not found');
  const doubleOffset = initIdx + 5 + fcIdxByte.length + 1;
  avm1_094.copy(tagBody, doubleOffset);
  console.log(`  Bumped fcVersion 0.93 → 0.94`);

  return tagBody;
}

// ─── Main ───

if (!fs.existsSync(BACKUP_PATH)) {
  fs.copyFileSync(SWF_PATH, BACKUP_PATH);
  console.log('Backed up original to', BACKUP_PATH);
}

fs.copyFileSync(BACKUP_PATH, SWF_PATH);
console.log('Restored from backup');

const { sig, version, body } = readSwf(SWF_PATH);
let buf = Buffer.from(body);
const tags = findTags(buf);

console.log(`SWF: ${sig} v${version}, decompressed ${buf.length} bytes, ${tags.length} tags`);

// Find Client DoInitAction tags
const clientTagInfos = [];
for (const tag of tags) {
  if (tag.code !== 59) continue;
  const bodyStart = tag.offset + tag.hdrSize;
  const cpStart = bodyStart + 2;
  const cp = parseConstantPool(buf, cpStart);
  if (!cp) continue;
  if (cp.entries[3] === 'Client' && cp.entries.indexOf('serviceConnect') >= 0 && cp.entries.indexOf('STANDALONE') >= 0) {
    clientTagInfos.push({ tag, spriteId: buf.readUInt16LE(bodyStart) });
  }
}

// Find Manager DoInitAction tags
const managerTagInfos = [];
for (const tag of tags) {
  if (tag.code !== 59) continue;
  const bodyStart = tag.offset + tag.hdrSize;
  const cpStart = bodyStart + 2;
  const cp = parseConstantPool(buf, cpStart);
  if (!cp) continue;
  if (cp.entries[3] === 'Manager' && cp.entries.indexOf('loadFruticard') >= 0 && cp.entries.indexOf('loadData') >= 0) {
    managerTagInfos.push({ tag, spriteId: buf.readUInt16LE(bodyStart) });
  }
}

if (clientTagInfos.length === 0) throw new Error('No Client DoInitAction tags found');
if (managerTagInfos.length === 0) throw new Error('No Manager DoInitAction tags found');

console.log(`Found ${clientTagInfos.length} Client tag(s), ${managerTagInfos.length} Manager tag(s)`);

// Process from last to first
const allTagInfos = [
  ...clientTagInfos.map(t => ({ ...t, type: 'client' })),
  ...managerTagInfos.map(t => ({ ...t, type: 'manager' })),
];
allTagInfos.sort((a, b) => b.tag.offset - a.tag.offset);

for (const { tag, spriteId, type } of allTagInfos) {
  console.log(`\nPatching ${type} tag for sprite ${spriteId}:`);
  const bodyStart = tag.offset + tag.hdrSize;
  const origTagBody = buf.slice(bodyStart, bodyStart + tag.length);
  const newTagBody = type === 'client'
    ? patchClientTagBody(Buffer.from(origTagBody))
    : patchManagerTagBody(Buffer.from(origTagBody));

  const newTagHdr = Buffer.alloc(6);
  newTagHdr.writeUInt16LE((tag.code << 6) | 0x3f, 0);
  newTagHdr.writeUInt32LE(newTagBody.length, 2);

  const tagEnd = tag.offset + tag.hdrSize + tag.length;
  buf = Buffer.concat([buf.slice(0, tag.offset), newTagHdr, newTagBody, buf.slice(tagEnd)]);
  console.log(`  Tag: ${tag.length} → ${newTagBody.length} bytes`);
}

const outSize = writeSwf(SWF_PATH, sig, version, buf);
console.log(`\nWrote ${SWF_PATH} (${outSize} bytes)`);
fs.copyFileSync(SWF_PATH, FULL_PATH);
console.log(`Copied to ${FULL_PATH}`);
console.log('Done!');
