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

// ─── Build new saveSlot function body ───
// Uses ExternalInterface.call to send data to JS (proper JSON serialization)
// AND flushes SharedObject for Ruffle localStorage persistence.
// Called during gameplay (not DoInitAction), so ExternalInterface is safe.

function buildSaveSlotBody(CP) {
  // flags=0x29: r1=this, r2=n (param), r3=data (param, ignored)
  // r4 = temp (SharedObject)
  //
  //   ExternalInterface.call("saveSlotData", "miniwave", n, this.mng.fc[n])
  //   SharedObject.getLocal("miniWave2/card").flush()
  //
  // Note: data is read from this.mng.fc[n] (miniwave.Manager.fc), not
  // this.slots[n], because in STANDALONE mode the Manager doesn't update
  // client.slots — the actual fruticard data lives in Manager.fc.

  // Part 1: ExternalInterface.call("saveSlotData", "miniwave", n, this.mng.fc[n])
  const eiCall = Buffer.concat([
    // arg4: this.mng.fc[n]
    actionPush(pushReg(1), pushCp(CP.mng)),
    GET_MEMBER,
    actionPush(pushCp(CP.fc)),
    GET_MEMBER,
    actionPush(pushReg(2)),
    GET_MEMBER,
    // arg3: n
    actionPush(pushReg(2)),
    // arg2: "miniwave"
    actionPush(pushCp(CP.miniwave)),
    // arg1: "saveSlotData"
    actionPush(pushCp(CP.saveSlotData)),
    // argCount = 4
    actionPush(pushInt(4)),
    // Get ExternalInterface (top-level, not flash.external.ExternalInterface)
    actionPush(pushCp(CP.ExternalInterface)),
    GET_VARIABLE,
    // Call method "call"
    actionPush(pushCp(CP.call)),
    CALL_METHOD,
    POP,
  ]);

  // Part 2: SharedObject.getLocal("miniWave2/card").flush()
  const soFlush = Buffer.concat([
    // SharedObject.getLocal("miniWave2/card") → r4
    actionPush(pushCp(CP.miniWave2Card)),
    actionPush(pushInt(1)),
    actionPush(pushCp(CP.SharedObject)),
    GET_VARIABLE,
    actionPush(pushCp(CP.getLocal)),
    CALL_METHOD,
    storeReg(4),
    POP,
    // r4.flush()
    actionPush(pushInt(0)),
    actionPush(pushReg(4), pushCp(CP.flush)),
    CALL_METHOD,
    POP,
  ]);

  return Buffer.concat([eiCall, soFlush]);
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
    'SharedObject',         // +0
    'getLocal',             // +1
    'miniWave2/card',       // +2
    'flush',                // +3
    'ExternalInterface',    // +4
    'call',                 // +5
    'saveSlotData',         // +6
    'mng',                  // +7
    'fc',                   // +8
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
    SharedObject: newCpBase + 0,
    getLocal: newCpBase + 1,
    miniWave2Card: newCpBase + 2,
    flush: newCpBase + 3,
    ExternalInterface: newCpBase + 4,
    call: newCpBase + 5,
    saveSlotData: newCpBase + 6,
    mng: newCpBase + 7,
    fc: newCpBase + 8,
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

  // Find saveSlot DF2 — only saveSlot is replaced.
  // serviceConnect is left intact: STANDALONE=true makes the original code
  // work correctly (creates empty slots + setInterval to onServiceConnect).
  // The patched saveSlot uses ExternalInterface (for server persistence + pictos)
  // and SharedObject.flush() (for Ruffle localStorage persistence).
  const ssDF2 = findPropertyDF2(tagBody, newCpDataEnd, tagBody.length, ssIdx);
  if (!ssDF2) throw new Error('saveSlot DF2 not found');
  console.log(`  saveSlot DF2 at ${ssDF2.df2Start}, body ${ssDF2.bodyStart}-${ssDF2.bodyEnd} (${ssDF2.bodyEnd - ssDF2.bodyStart} bytes)`);

  const newSsBody = buildSaveSlotBody(CP);
  const newSsDF2 = buildDefineFunction2('', [[2, 'n'], [3, 'data']], 5, 0x29, newSsBody);

  console.log(`  saveSlot: ${ssDF2.df2End - ssDF2.df2Start} → ${newSsDF2.length} bytes`);

  tagBody = Buffer.concat([
    tagBody.slice(0, ssDF2.df2Start),
    newSsDF2,
    tagBody.slice(ssDF2.df2End),
  ]);

  return tagBody;
}

// ─── Patch Manager DoInitAction: replace _root.loadData with SharedObject.getLocal ───
// MiniWave's Manager.loadFruticard() calls _root.loadData("miniWave2/card") which
// is normally defined by the Frusion launcher SWF. In standalone mode that launcher
// doesn't run, so _root.loadData is undefined and SharedObject persistence breaks.
// Instead of injecting a runtime shim (which broke menus), we patch the bytecode
// directly: replace the _root.loadData(name) call with SharedObject.getLocal(name).
// This is the same approach MiniPixiz uses and is proven reliable.

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

  console.log(`  Sprite ${spriteId}: CP count=${cp.count}, loadData=CP[${loadDataIdx}], miniWave2/card=CP[${miniWave2Idx}], so=CP[${soIdx}]`);

  // Add 'SharedObject' and 'getLocal' to the constant pool
  const newCpBase = cp.count;
  const newStrings = ['SharedObject', 'getLocal'];
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

  console.log(`  Added SharedObject=CP[${sharedObjectCpIdx}], getLocal=CP[${getLocalCpIdx}] (+${cpDelta} bytes)`);

  // Find the _root.loadData("miniWave2/card") call pattern in the bytecode.
  // Original bytes (20 bytes total):
  //   96 0f 00  04 01 08 XX 08 YY 07 01000000 04 02 08 ZZ  52  4f
  //   Push(15): r1, CP[so], CP[miniWave2/card], int(1), r2(_root), CP[loadData]
  //   CallMethod
  //   SetMember
  //
  // Where XX=soIdx, YY=miniWave2Idx, ZZ=loadDataIdx (after CP expansion, indices unchanged
  // because new entries are appended at the end).
  //
  // Replacement (24 bytes total):
  //   96 0d 00  04 01 08 XX 08 YY 07 01000000 08 AA       Push(13): r1, CP[so], CP[miniWave2/card], int(1), CP[SharedObject]
  //   1C                                                   GetVariable
  //   96 02 00  08 BB                                      Push(2): CP[getLocal]
  //   52                                                   CallMethod
  //   4f                                                   SetMember
  //
  // This is 4 bytes larger. We need to:
  //   1. Update the DF2 codeSize field (+4)
  //   2. Update the If jump at func body @15 that crosses the patch point (+4 to offset)

  // Build search pattern for the original 20-byte sequence
  const soIdxByte = soIdx < 256 ? Buffer.from([0x08, soIdx]) : Buffer.from([0x09, soIdx & 0xff, (soIdx >> 8) & 0xff]);
  const mw2IdxByte = miniWave2Idx < 256 ? Buffer.from([0x08, miniWave2Idx]) : Buffer.from([0x09, miniWave2Idx & 0xff, (miniWave2Idx >> 8) & 0xff]);
  const ldIdxByte = loadDataIdx < 256 ? Buffer.from([0x08, loadDataIdx]) : Buffer.from([0x09, loadDataIdx & 0xff, (loadDataIdx >> 8) & 0xff]);

  // Search for: Push ... r2 CP[loadData] CallMethod(0x52)
  // Specifically the full 20-byte pattern
  const searchPattern = Buffer.concat([
    Buffer.from([0x96, 0x0f, 0x00]),   // Push, payload=15
    Buffer.from([0x04, 0x01]),          // r1
    soIdxByte,                          // CP[so]
    mw2IdxByte,                         // CP[miniWave2/card]
    Buffer.from([0x07, 0x01, 0x00, 0x00, 0x00]),  // int(1)
    Buffer.from([0x04, 0x02]),          // r2 (_root)
    ldIdxByte,                          // CP[loadData]
    Buffer.from([0x52]),                // CallMethod
    Buffer.from([0x4f]),                // SetMember
  ]);

  const patchOffset = tagBody.indexOf(searchPattern, cp.dataEnd + cpDelta);
  if (patchOffset < 0) throw new Error('Could not find _root.loadData call pattern in Manager bytecode');

  console.log(`  Found _root.loadData pattern at tag offset ${patchOffset}`);

  // Build replacement (24 bytes)
  const shCpByte = sharedObjectCpIdx < 256 ? Buffer.from([0x08, sharedObjectCpIdx]) : Buffer.from([0x09, sharedObjectCpIdx & 0xff, (sharedObjectCpIdx >> 8) & 0xff]);
  const glCpByte = getLocalCpIdx < 256 ? Buffer.from([0x08, getLocalCpIdx]) : Buffer.from([0x09, getLocalCpIdx & 0xff, (getLocalCpIdx >> 8) & 0xff]);

  const replacement = Buffer.concat([
    Buffer.from([0x96, 0x0d, 0x00]),   // Push, payload=13
    Buffer.from([0x04, 0x01]),          // r1
    soIdxByte,                          // CP[so]
    mw2IdxByte,                         // CP[miniWave2/card]
    Buffer.from([0x07, 0x01, 0x00, 0x00, 0x00]),  // int(1)
    shCpByte,                           // CP[SharedObject]
    Buffer.from([0x1c]),                // GetVariable
    Buffer.from([0x96, 0x02, 0x00]),    // Push, payload=2
    glCpByte,                           // CP[getLocal]
    Buffer.from([0x52]),                // CallMethod
    Buffer.from([0x4f]),                // SetMember
  ]);

  if (replacement.length !== 24) throw new Error('Replacement should be 24 bytes, got ' + replacement.length);

  // Splice replacement into tagBody
  tagBody = Buffer.concat([
    tagBody.slice(0, patchOffset),
    replacement,
    tagBody.slice(patchOffset + 20),
  ]);

  // Now fix up the DF2 that contains this code (loadFruticard).
  // The DF2's codeSize field needs +4.
  // Also the If jump at func body offset @15 (which jumps over the STANDALONE block) needs +4.

  // Find the DF2 header that precedes patchOffset.
  // The loadFruticard DF2 is assigned to prototype, so it's: Push CP[loadFruticard] ... DF2 ... SetMember
  // We look backwards from patchOffset for 0x8E (DefineFunction2 opcode)
  let df2HeaderOff = -1;
  for (let i = patchOffset - 1; i >= patchOffset - 100 && i >= 0; i--) {
    if (tagBody[i] === 0x8E) {
      df2HeaderOff = i;
      break;
    }
  }
  if (df2HeaderOff < 0) throw new Error('Cannot find DF2 header for loadFruticard');

  // Parse DF2 header to find codeSize field offset
  let df2Off = df2HeaderOff + 3; // skip opcode + innerLen(2)
  const nameEnd = tagBody.indexOf(0, df2Off);
  df2Off = nameEnd + 1;
  const numParams = tagBody.readUInt16LE(df2Off); df2Off += 2;
  df2Off += 1; // regCount
  df2Off += 2; // flags
  for (let p = 0; p < numParams; p++) {
    df2Off += 1; // reg
    const pe = tagBody.indexOf(0, df2Off);
    df2Off = pe + 1;
  }
  // df2Off now points to codeSize (2 bytes)
  const oldCodeSize = tagBody.readUInt16LE(df2Off);
  tagBody.writeUInt16LE(oldCodeSize + 4, df2Off);
  console.log(`  Updated DF2 codeSize: ${oldCodeSize} → ${oldCodeSize + 4} (at tag offset ${df2Off})`);

  // The function body starts right after codeSize (at df2Off + 2).
  const funcBodyStart = df2Off + 2;

  // Fix the If jump at func body @15 (5 bytes before the patch point within the func body).
  // The If instruction is at funcBodyStart + 15.
  const ifOff = funcBodyStart + 15;
  if (tagBody[ifOff] !== 0x9d) throw new Error('Expected If (0x9D) at func body @15, got 0x' + tagBody[ifOff].toString(16));
  const oldJumpOffset = tagBody.readInt16LE(ifOff + 3);
  tagBody.writeInt16LE(oldJumpOffset + 4, ifOff + 3);
  console.log(`  Updated If @15 jump offset: ${oldJumpOffset} → ${oldJumpOffset + 4}`);

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

// Find Manager DoInitAction tags (code=59, CP[3]='Manager', has 'loadFruticard')
const managerTagInfos = [];
for (const tag of tags) {
  if (tag.code !== 59) continue;
  const bodyStart = tag.offset + tag.hdrSize;
  const spriteId = buf.readUInt16LE(bodyStart);
  const cpStart = bodyStart + 2;
  const cp = parseConstantPool(buf, cpStart);
  if (!cp) continue;
  if (cp.entries[3] === 'Manager' && cp.entries.indexOf('loadFruticard') >= 0 && cp.entries.indexOf('loadData') >= 0) {
    managerTagInfos.push({ tag, spriteId });
  }
}

if (managerTagInfos.length === 0) throw new Error('No Manager DoInitAction tags found');
console.log(`Found ${managerTagInfos.length} Manager tag(s): sprites ${managerTagInfos.map(t => t.spriteId).join(', ')}`);

// Process ALL tags from last to first (so earlier offsets aren't affected by later replacements)
const allTagInfos = [
  ...clientTagInfos.map(t => ({ ...t, type: 'client' })),
  ...managerTagInfos.map(t => ({ ...t, type: 'manager' })),
];
allTagInfos.sort((a, b) => b.tag.offset - a.tag.offset);

for (const { tag, spriteId, type } of allTagInfos) {
  console.log(`\nPatching ${type === 'client' ? 'Client' : 'Manager'} tag for sprite ${spriteId} at offset ${tag.offset}:`);

  const bodyStart = tag.offset + tag.hdrSize;
  const origTagBody = buf.slice(bodyStart, bodyStart + tag.length);

  const newTagBody = type === 'client'
    ? patchClientTagBody(Buffer.from(origTagBody))
    : patchManagerTagBody(Buffer.from(origTagBody));

  const newTagHdr = Buffer.alloc(6);
  newTagHdr.writeUInt16LE((tag.code << 6) | 0x3f, 0);
  newTagHdr.writeUInt32LE(newTagBody.length, 2);

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
