#!/usr/bin/env node
// Patches Games/miniWave2/miniwave.swf so that:
//   1. STANDALONE is set to true
//   2. serviceConnect loads slots via HTTP (/api/loadFrutiSlots)
//   3. saveSlot persists via HTTP POST (/api/saveFrutiSlot)
//
// The miniwave.Client class is defined in TWO identical DoInitAction tags
// (sprites 26 and 621). Both are patched identically.

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
const NOT = simpleAction(0x12);
const EQUALS2 = simpleAction(0x49);

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

// ─── Find a DefineFunction2 assigned to a prototype property ───
// Searches for: Push ... CP[propIdx] ... DF2 ... SetMember(0x4F)

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
      const nameEnd = buf.indexOf(0, off);
      if (nameEnd < 0) break;
      off = nameEnd + 1;
      const numParams = buf.readUInt16LE(off); off += 2;
      off += 1; // regCount
      off += 2; // flags
      for (let p = 0; p < numParams; p++) {
        off += 1;
        const pe = buf.indexOf(0, off);
        off = pe + 1;
      }
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

// ─── Build new function bodies ───

function buildOnLoadBody(CP) {
  // r1=this (LoadVars response), r2=success (param)
  // r3=client, r4=parsed slot object
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

  const afterSuccessCheck = slot0Check.length + 5 + slot0Load.length + slot0NullCheck.length + 5 +
    slot0Assign.length + callOnServiceConnect.length;
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

function buildServiceConnectBody(CP) {
  // flags=0x29: r1=this, r2=super, r3=_parent
  // r4,r5 = local vars
  //
  //   this.slots = []
  //   this.slots[0] = {}
  //   var lv = new LoadVars()         → r4
  //   lv.game = "miniwave"
  //   lv.sid = _root.sid
  //   var result = new LoadVars()     → r5
  //   result._client = this
  //   result.onLoad = function(success) { ... }
  //   lv.sendAndLoad("/api/loadFrutiSlots", result, "POST")

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
    storeReg(4),
    POP,
  ]);

  const setGame = Buffer.concat([
    actionPush(pushReg(4), pushCp(CP.game), pushCp(CP.miniwave)),
    SET_MEMBER,
  ]);

  const setSid = Buffer.concat([
    actionPush(pushReg(4), pushCp(CP.sid)),
    actionPush(pushStr('_root')),
    GET_VARIABLE,
    actionPush(pushCp(CP.sid)),
    GET_MEMBER,
    SET_MEMBER,
  ]);

  const createResult = Buffer.concat([
    actionPush(pushInt(0), pushCp(CP.LoadVars)),
    NEW_OBJECT,
    storeReg(5),
    POP,
  ]);

  const setClient = Buffer.concat([
    actionPush(pushReg(5), pushCp(CP._client), pushReg(1)),
    SET_MEMBER,
  ]);

  const onLoadBodyBytes = buildOnLoadBody(CP);
  const onLoadFunc = buildDefineFunction2('', [[2, 'success']], 5, 0x29, onLoadBodyBytes);
  const setOnLoad = Buffer.concat([
    actionPush(pushReg(5), pushCp(CP.onLoad)),
    onLoadFunc,
    SET_MEMBER,
  ]);

  const sendAndLoad = Buffer.concat([
    actionPush(pushCp(CP.POST)),
    actionPush(pushReg(5)),
    actionPush(pushCp(CP.loadFrutiSlots)),
    actionPush(pushInt(3)),
    actionPush(pushReg(4), pushCp(CP.sendAndLoad)),
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

function buildSaveSlotBody(CP) {
  // flags=0x29: r1=this, r2=n (param), r3=data (param)
  // r4,r5 = local vars
  //
  //   var lv = new LoadVars()        → r4
  //   lv.game = "miniwave"
  //   lv.sid = _root.sid
  //   lv.slotId = n                  (r2)
  //   lv.data = data                 (r3)
  //   var resp = new LoadVars()      → r5
  //   lv.sendAndLoad("/api/saveFrutiSlot", resp, "POST")

  const createLv = Buffer.concat([
    actionPush(pushInt(0), pushCp(CP.LoadVars)),
    NEW_OBJECT,
    storeReg(4),
    POP,
  ]);

  const setGame = Buffer.concat([
    actionPush(pushReg(4), pushCp(CP.game), pushCp(CP.miniwave)),
    SET_MEMBER,
  ]);

  const setSid = Buffer.concat([
    actionPush(pushReg(4), pushCp(CP.sid)),
    actionPush(pushStr('_root')),
    GET_VARIABLE,
    actionPush(pushCp(CP.sid)),
    GET_MEMBER,
    SET_MEMBER,
  ]);

  const setSlotId = Buffer.concat([
    actionPush(pushReg(4), pushCp(CP.slotId), pushReg(2)),
    SET_MEMBER,
  ]);

  const setData = Buffer.concat([
    actionPush(pushReg(4), pushCp(CP.data), pushReg(3)),
    SET_MEMBER,
  ]);

  const createResp = Buffer.concat([
    actionPush(pushInt(0), pushCp(CP.LoadVars)),
    NEW_OBJECT,
    storeReg(5),
    POP,
  ]);

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
    createResp, sendAndLoad,
  ]);
}

// ─── Patch a single Client DoInitAction tag body ───

function patchClientTagBody(tagBody) {
  const spriteId = tagBody.readUInt16LE(0);

  // Parse constant pool (starts at byte 2, after sprite ID)
  const cp = parseConstantPool(tagBody, 2);
  if (!cp) throw new Error('Cannot parse constant pool');
  if (cp.entries[3] !== 'Client') throw new Error(`Expected Client at CP[3], got '${cp.entries[3]}'`);

  const scIdx = cp.entries.indexOf('serviceConnect');
  const ssIdx = cp.entries.indexOf('saveSlot');
  const slotsIdx = cp.entries.indexOf('slots');
  const oscIdx = cp.entries.indexOf('onServiceConnect');
  const standaloneIdx = cp.entries.indexOf('STANDALONE');

  if (scIdx < 0 || ssIdx < 0 || slotsIdx < 0 || oscIdx < 0) {
    throw new Error('Missing required CP entries');
  }

  console.log(`  Sprite ${spriteId}: CP count=${cp.count}, serviceConnect=CP[${scIdx}], saveSlot=CP[${ssIdx}]`);

  // Add new CP entries
  const newCpBase = cp.count;
  const newStrings = [
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
    'slotId',               // +10
    '/api/saveFrutiSlot',   // +11
    'data',                 // +12
  ];

  let newCpData = Buffer.alloc(0);
  for (const s of newStrings) {
    newCpData = Buffer.concat([newCpData, Buffer.from(s + '\0', 'latin1')]);
  }
  const cpDelta = newCpData.length;

  // Insert new CP data at cp.dataEnd
  tagBody = Buffer.concat([
    tagBody.slice(0, cp.dataEnd),
    newCpData,
    tagBody.slice(cp.dataEnd),
  ]);

  // Update CP header (action byte at offset 2, payloadLen at offset 3, count at offset 5)
  tagBody.writeUInt16LE(cp.payloadLen + cpDelta, 3);
  tagBody.writeUInt16LE(cp.count + newStrings.length, 5);

  const newCpDataEnd = cp.dataEnd + cpDelta;
  console.log(`  Added ${newStrings.length} CP entries (+${cpDelta} bytes), new CP dataEnd=${newCpDataEnd}`);

  const CP = {
    serviceConnect: scIdx,
    saveSlot: ssIdx,
    onServiceConnect: oscIdx,
    slots: slotsIdx,
    miniwave: 1,
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
    slotId: newCpBase + 10,
    saveFrutiSlot: newCpBase + 11,
    data: newCpBase + 12,
  };

  // Flip STANDALONE = true (in case any other code checks it)
  if (standaloneIdx >= 0) {
    const needle = Buffer.from([0x08, standaloneIdx, 0x05, 0x00, 0x4f]);
    const idx = tagBody.indexOf(needle, newCpDataEnd);
    if (idx >= 0) {
      tagBody[idx + 3] = 0x01;
      console.log(`  Set STANDALONE=true at tag-relative offset ${idx + 3}`);
    }
  }

  // Find serviceConnect DF2 (first match after CP)
  const scDF2 = findPropertyDF2(tagBody, newCpDataEnd, tagBody.length, scIdx);
  if (!scDF2) throw new Error('serviceConnect DF2 not found');
  console.log(`  serviceConnect DF2 at ${scDF2.df2Start}, body ${scDF2.bodyStart}-${scDF2.bodyEnd} (${scDF2.bodyEnd - scDF2.bodyStart} bytes)`);

  // Find saveSlot DF2 (first match after CP)
  const ssDF2 = findPropertyDF2(tagBody, newCpDataEnd, tagBody.length, ssIdx);
  if (!ssDF2) throw new Error('saveSlot DF2 not found');
  console.log(`  saveSlot DF2 at ${ssDF2.df2Start}, body ${ssDF2.bodyStart}-${ssDF2.bodyEnd} (${ssDF2.bodyEnd - ssDF2.bodyStart} bytes)`);

  // Build replacement functions
  const newScBody = buildServiceConnectBody(CP);
  const newScDF2 = buildDefineFunction2('', [], 5, 0x29, newScBody);

  const newSsBody = buildSaveSlotBody(CP);
  const newSsDF2 = buildDefineFunction2('', [[2, 'n'], [3, 'data']], 6, 0x29, newSsBody);

  console.log(`  serviceConnect: ${scDF2.df2End - scDF2.df2Start} → ${newScDF2.length} bytes`);
  console.log(`  saveSlot: ${ssDF2.df2End - ssDF2.df2Start} → ${newSsDF2.length} bytes`);

  // Replace saveSlot first (later offset), then serviceConnect
  tagBody = Buffer.concat([
    tagBody.slice(0, ssDF2.df2Start),
    newSsDF2,
    tagBody.slice(ssDF2.df2End),
  ]);

  tagBody = Buffer.concat([
    tagBody.slice(0, scDF2.df2Start),
    newScDF2,
    tagBody.slice(scDF2.df2End),
  ]);

  return tagBody;
}

// ─── Main ───

// Back up original
if (!fs.existsSync(BACKUP_PATH)) {
  fs.copyFileSync(SWF_PATH, BACKUP_PATH);
  console.log('Backed up original to', BACKUP_PATH);
}

const { sig, version, body } = readSwf(SWF_PATH);
let buf = Buffer.from(body);
const tags = findTags(buf);

console.log(`SWF: ${sig} v${version}, decompressed ${buf.length} bytes, ${tags.length} tags`);

// Find Client DoInitAction tags (code=59, CP[3]='Client', has 'serviceConnect')
const clientTagInfos = [];
for (const tag of tags) {
  if (tag.code !== 59) continue;
  const bodyStart = tag.offset + tag.hdrSize;
  const spriteId = buf.readUInt16LE(bodyStart);
  const cpStart = bodyStart + 2;
  const cp = parseConstantPool(buf, cpStart);
  if (!cp) continue;
  if (cp.entries[3] === 'Client' && cp.entries.indexOf('serviceConnect') >= 0 && cp.entries.indexOf('STANDALONE') >= 0) {
    clientTagInfos.push({ tag, spriteId });
  }
}

if (clientTagInfos.length === 0) throw new Error('No Client DoInitAction tags found');
console.log(`Found ${clientTagInfos.length} Client tag(s): sprites ${clientTagInfos.map(t => t.spriteId).join(', ')}`);

// Process tags from last to first (so earlier offsets aren't affected by later replacements)
clientTagInfos.sort((a, b) => b.tag.offset - a.tag.offset);

for (const { tag, spriteId } of clientTagInfos) {
  console.log(`\nPatching Client tag for sprite ${spriteId} at offset ${tag.offset}:`);

  // Extract original tag body
  const bodyStart = tag.offset + tag.hdrSize;
  const origTagBody = buf.slice(bodyStart, bodyStart + tag.length);

  // Patch the tag body
  const newTagBody = patchClientTagBody(Buffer.from(origTagBody));

  // Rebuild tag header (always long form since the tag is > 63 bytes)
  const newTagHdr = Buffer.alloc(6);
  newTagHdr.writeUInt16LE((tag.code << 6) | 0x3f, 0);
  newTagHdr.writeUInt32LE(newTagBody.length, 2);

  // Replace in main buffer
  const tagEnd = tag.offset + tag.hdrSize + tag.length;
  buf = Buffer.concat([
    buf.slice(0, tag.offset),
    newTagHdr,
    newTagBody,
    buf.slice(tagEnd),
  ]);

  console.log(`  Tag length: ${tag.length} → ${newTagBody.length} (delta=${newTagBody.length - tag.length})`);
}

// Write output
const outSize = writeSwf(SWF_PATH, sig, version, buf);
console.log(`\nWrote ${SWF_PATH} (${outSize} bytes)`);

fs.copyFileSync(SWF_PATH, FULL_PATH);
console.log(`Copied to ${FULL_PATH}`);
console.log('Done!');
