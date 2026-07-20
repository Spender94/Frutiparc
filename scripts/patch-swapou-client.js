#!/usr/bin/env node
// Patche Games/swapou2/swapou.swf (client desktop rebâti — slots/scores HTTP,
// STANDALONE=true) pour que le mode CHALLENGE demande la permission au serveur
// AVANT la partie (système FD), comme le client natif /swapou et BurningKiwi :
//
//   AVANT :  startGame() { super.startGame() ; if (STANDALONE) onStartGame() ; }
//   APRÈS :  startGame() {
//              var lv = new LoadVars() ; lv.game = "swapou2" ; lv.sid = _root.sid ;
//              var r = new LoadVars() ; r._client = this ;
//              r.onLoad = function (success) {
//                if (success && this.ok != "1")
//                  swapou2.Manager.connected() ;   // refus → menu DÉVERROUILLÉ
//                else                              //   (Manager.error() est un
//                  this._client.onStartGame() ;    //    TODO qui gèle le jeu)
//              } ;
//              lv.sendAndLoad("/do/fdclaim", r, "POST") ;
//            }
//
// Le refus laisse le joueur sur le menu (netUnlock via Manager.connected) ; le
// popup affiche l'overlay d'info (drapeau fdRefused du poll /api/check-ejected).
// Panne réseau → fail-open (la partie démarre ; le portillon au save protège).
// Noms obfusqués utilisés (vérifiés au désassembleur) :
//   Manager = "7}}#$$!" ; connected garde son nom ; STANDALONE = "6^8%7$".
// Idempotent : si "/do/fdclaim" est déjà dans le pool, ne fait rien.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const IN_PATH = path.resolve(__dirname, '..', 'Games', 'swapou2', 'swapou.swf');
const OBF_MANAGER = '7}}#$$!';

// ─── SWF I/O + assembleur AS2 (identiques à patch-bkiwi-client.js) ───
function readSwf(filePath) {
  const raw = fs.readFileSync(filePath);
  const sig = raw.slice(0, 3).toString('ascii');
  const version = raw[3];
  let body;
  if (sig === 'CWS') body = zlib.inflateSync(raw.slice(8));
  else if (sig === 'FWS') body = Buffer.from(raw.slice(8));
  else throw new Error('Signature inconnue: ' + sig);
  return { sig, version, body };
}
function writeSwf(outPath, sig, version, newBody) {
  const payload = sig === 'CWS' ? zlib.deflateSync(newBody, { level: 9 }) : newBody;
  const out = Buffer.alloc(8 + payload.length);
  out.write(sig, 0, 'ascii');
  out.writeUInt8(version, 3);
  out.writeUInt32LE(8 + newBody.length, 4);
  payload.copy(out, 8);
  fs.writeFileSync(outPath, out);
  return out.length;
}
function parseRectBytes(b) { const n = (b[0] >> 3) & 0x1f; return Math.ceil((5 + n * 4) / 8); }
function findTags(b) {
  let off = parseRectBytes(b) + 4;
  const tags = [];
  while (off < b.length) {
    const hdr = b.readUInt16LE(off);
    const code = hdr >> 6;
    let len = hdr & 0x3f, hs = 2;
    if (len === 0x3f) { len = b.readUInt32LE(off + 2); hs = 6; }
    if (code === 0) break;
    tags.push({ code, offset: off, hdrSize: hs, length: len });
    off += hs + len;
  }
  return tags;
}
function parseConstantPool(b, cpStart) {
  if (b[cpStart] !== 0x88) throw new Error('ConstantPool (0x88) attendu à ' + cpStart);
  const payloadLen = b.readUInt16LE(cpStart + 1);
  const count = b.readUInt16LE(cpStart + 3);
  const entries = [];
  let pos = cpStart + 5;
  for (let i = 0; i < count; i++) { const e = b.indexOf(0, pos); entries.push(b.slice(pos, e).toString('latin1')); pos = e + 1; }
  return { payloadLen, count, entries, dataEnd: cpStart + 3 + payloadLen };
}
function pushReg(r) { return Buffer.from([0x04, r]); }
function pushCp(i) { return i < 256 ? Buffer.from([0x08, i]) : Buffer.from([0x09, i & 0xff, (i >> 8) & 0xff]); }
function pushInt(v) { const b = Buffer.alloc(5); b[0] = 0x07; b.writeUInt32LE(v, 1); return b; }
function pushBool(v) { return Buffer.from([0x05, v ? 1 : 0]); }
function actionPush(...items) {
  const payload = Buffer.concat(items);
  const hdr = Buffer.alloc(3); hdr[0] = 0x96; hdr.writeUInt16LE(payload.length, 1);
  return Buffer.concat([hdr, payload]);
}
const POP = Buffer.from([0x17]);
const SET_MEMBER = Buffer.from([0x4F]);
const GET_MEMBER = Buffer.from([0x4E]);
const CALL_METHOD = Buffer.from([0x52]);
const NEW_OBJECT = Buffer.from([0x40]);
const EQUALS2 = Buffer.from([0x49]);
const NOT = Buffer.from([0x12]);
const GET_VARIABLE = Buffer.from([0x1C]);
function storeReg(r) { return Buffer.from([0x87, 0x01, 0x00, r]); }
function actionIf(offset) { const b = Buffer.alloc(5); b[0] = 0x9D; b.writeUInt16LE(2, 1); b.writeInt16LE(offset, 3); return b; }
function actionJump(offset) { const b = Buffer.alloc(5); b[0] = 0x99; b.writeUInt16LE(2, 1); b.writeInt16LE(offset, 3); return b; }
function buildDefineFunction2(name, params, regcount, flags, bodyBytes) {
  const nameBytes = Buffer.from(name + '\0', 'latin1');
  let paramBytes = Buffer.alloc(0);
  for (const [reg, pname] of params) paramBytes = Buffer.concat([paramBytes, Buffer.from([reg]), Buffer.from(pname + '\0', 'latin1')]);
  const innerLen = nameBytes.length + 2 + 1 + 2 + paramBytes.length + 2;
  const hdr = Buffer.alloc(3 + innerLen);
  hdr[0] = 0x8E; hdr.writeUInt16LE(innerLen, 1);
  let off = 3;
  nameBytes.copy(hdr, off); off += nameBytes.length;
  hdr.writeUInt16LE(params.length, off); off += 2;
  hdr[off] = regcount; off += 1;
  hdr.writeUInt16LE(flags, off); off += 2;
  if (paramBytes.length) { paramBytes.copy(hdr, off); off += paramBytes.length; }
  hdr.writeUInt16LE(bodyBytes.length, off);
  return Buffer.concat([hdr, bodyBytes]);
}
function* walkActions(b, start, end) {
  let pc = start;
  while (pc < end) {
    const op = b[pc];
    if (op === 0) { pc += 1; continue; }
    let len = 0, next;
    if (op >= 0x80) { len = b.readUInt16LE(pc + 1); next = pc + 3 + len; } else { next = pc + 1; }
    yield { pc, op, len, next };
    pc = next;
  }
}

// ─── Patch ───
const { sig, version, body } = readSwf(IN_PATH);
let buf = Buffer.from(body);

const tags = findTags(buf);
let tag = null;
for (const t of tags) {
  if (t.code !== 59) continue;
  const s = t.offset + t.hdrSize, e = s + t.length;
  const slice = buf.slice(s, e);
  if (slice.includes(Buffer.from('/api/loadFrutiSlots', 'latin1')) && slice.includes(Buffer.from('swapou2', 'latin1'))) { tag = t; break; }
}
if (!tag) throw new Error('DoInitAction du Client swapou2 (rebâti) introuvable');
const tagBodyStart = tag.offset + tag.hdrSize;
const cpStart = tagBodyStart + 2;
const cp = parseConstantPool(buf, cpStart);
console.log(`DoInitAction trouvé à ${tag.offset} (len=${tag.length}), pool: ${cp.count} entrées`);

if (cp.entries.includes('/do/fdclaim')) { console.log('Déjà patché — rien à faire.'); process.exit(0); }

const NEEDED = ['LoadVars', 'game', 'swapou2', 'sid', '_client', 'onLoad', 'ok', '1', 'onStartGame', '/do/fdclaim', 'sendAndLoad', 'POST', 'startGame', OBF_MANAGER, 'connected'];
const idx = {};
const toAppend = [];
for (const s of NEEDED) {
  const i = cp.entries.indexOf(s);
  if (i >= 0) idx[s] = i;
  else { idx[s] = cp.count + toAppend.length; toAppend.push(s); }
}
let appendBytes = Buffer.alloc(0);
for (const s of toAppend) appendBytes = Buffer.concat([appendBytes, Buffer.from(s + '\0', 'latin1')]);
const delta1 = appendBytes.length;
if (delta1) {
  buf = Buffer.concat([buf.slice(0, cp.dataEnd), appendBytes, buf.slice(cp.dataEnd)]);
  buf.writeUInt16LE(cp.payloadLen + delta1, cpStart + 1);
  buf.writeUInt16LE(cp.count + toAppend.length, cpStart + 3);
  if (tag.hdrSize !== 6) throw new Error('tag court inattendu');
  buf.writeUInt32LE(tag.length + delta1, tag.offset + 2);
  console.log(`Pool: +${toAppend.length} chaînes (${toAppend.join(', ')}), +${delta1} o`);
}
const tagEnd = tag.offset + tag.hdrSize + tag.length + delta1;
const actionsStart = cp.dataEnd + delta1;

// Localise startGame : DefineFunction2 name="" params=0 regs=3 flags=0x19
// size=64 dont le corps commence par « Push int:0 ; Push r2 ; Push cp(startGame) »
// (l'appel super.startGame()) — signature du client rebâti.
let found = null;
for (const ins of walkActions(buf, actionsStart, tagEnd)) {
  if (ins.op !== 0x8E) continue;
  let p = ins.pc + 3;
  if (buf[p] !== 0x00) continue;
  const nParams = buf.readUInt16LE(p + 1);
  const regs = buf[p + 3];
  const flags = buf.readUInt16LE(p + 4);
  const codeSize = buf.readUInt16LE(p + 6);
  if (nParams !== 0 || regs !== 3 || flags !== 0x19 || codeSize !== 64) continue;
  const bodyStart = ins.pc + 3 + ins.len;
  const sigBytes = Buffer.from([
    0x96, 0x05, 0x00, 0x07, 0x00, 0x00, 0x00, 0x00, // Push int:0
    0x96, 0x02, 0x00, 0x04, 0x02,                   // Push r2 (super)
    0x96, 0x02, 0x00, 0x08, idx['startGame'],       // Push cp:"startGame"
  ]);
  if (!buf.slice(bodyStart, bodyStart + sigBytes.length).equals(sigBytes)) continue;
  found = { funcStart: ins.pc, funcEnd: ins.pc + 3 + ins.len + codeSize };
  break;
}
if (!found) throw new Error('fonction startGame (regs=3, flags=0x19, size=64) introuvable');
console.log(`startGame d'origine à ${found.funcStart}`);

// onLoad(success) — flags 0x29 : r1=résultat, r2=success ; r3=client.
const okBranch = Buffer.concat([
  actionPush(pushInt(0)),
  actionPush(pushReg(3), pushCp(idx['onStartGame'])),
  CALL_METHOD, POP,
]);
const refusBranch = Buffer.concat([
  // swapou2.Manager.connected() → netUnlock du menu (reste au menu, propre)
  actionPush(pushInt(0)),
  actionPush(pushCp(idx['swapou2'])), GET_VARIABLE,
  actionPush(pushCp(idx[OBF_MANAGER])), GET_MEMBER,
  actionPush(pushCp(idx['connected'])),
  CALL_METHOD, POP,
  actionJump(okBranch.length),
]);
const checkOk = Buffer.concat([
  actionPush(pushReg(1), pushCp(idx['ok'])), GET_MEMBER,
  actionPush(pushCp(idx['1'])), EQUALS2,
  actionIf(refusBranch.length),
]);
const onLoadBody = Buffer.concat([
  actionPush(pushReg(1), pushCp(idx['_client'])), GET_MEMBER, storeReg(3), POP,
  actionPush(pushReg(2)), NOT, actionIf(checkOk.length + refusBranch.length), // réseau HS → fail-open
  checkOk,
  refusBranch,
  okBranch,
]);
const onLoadFunc = buildDefineFunction2('', [[2, 'success']], 4, 0x29, onLoadBody);

// startGame() — flags 0x69 : r1=this, r2=_root ; r3=lv, r4=résultat.
const newBody = Buffer.concat([
  actionPush(pushInt(0), pushCp(idx['LoadVars'])), NEW_OBJECT, storeReg(3), POP,
  actionPush(pushReg(3), pushCp(idx['game']), pushCp(idx['swapou2'])), SET_MEMBER,
  actionPush(pushReg(3), pushCp(idx['sid'])),
  actionPush(pushReg(2), pushCp(idx['sid'])), GET_MEMBER, SET_MEMBER,
  actionPush(pushInt(0), pushCp(idx['LoadVars'])), NEW_OBJECT, storeReg(4), POP,
  actionPush(pushReg(4), pushCp(idx['_client']), pushReg(1)), SET_MEMBER,
  actionPush(pushReg(4), pushCp(idx['onLoad'])), onLoadFunc, SET_MEMBER,
  actionPush(pushCp(idx['POST'])),
  actionPush(pushReg(4)),
  actionPush(pushCp(idx['/do/fdclaim'])),
  actionPush(pushInt(3)),
  actionPush(pushReg(3), pushCp(idx['sendAndLoad'])),
  CALL_METHOD, POP,
]);
const newFunc = buildDefineFunction2('', [], 5, 0x69, newBody);
const delta2 = newFunc.length - (found.funcEnd - found.funcStart);
console.log(`Nouvelle fonction : ${newFunc.length} o (delta ${delta2 >= 0 ? '+' : ''}${delta2})`);

// Branchements enjambant la zone remplacée (garde de classe).
const spanning = [];
for (const ins of walkActions(buf, actionsStart, tagEnd)) {
  if (ins.op !== 0x9D && ins.op !== 0x99) continue;
  if (ins.pc >= found.funcStart && ins.pc < found.funcEnd) continue;
  const rel = buf.readInt16LE(ins.pc + 3);
  const target = ins.next + rel;
  const crosses = (ins.next <= found.funcStart && target >= found.funcEnd) ||
                  (ins.next >= found.funcEnd && target <= found.funcStart);
  if (crosses) spanning.push({ fieldPos: ins.pc + 3, rel });
}
console.log(`Branchements enjambants à ré-offsetter : ${spanning.length}`);
if (spanning.length !== 1) throw new Error(`1 branchement enjambant attendu, trouvé ${spanning.length}`);

buf = Buffer.concat([buf.slice(0, found.funcStart), newFunc, buf.slice(found.funcEnd)]);
for (const b of spanning) {
  const pos = b.fieldPos < found.funcStart ? b.fieldPos : b.fieldPos + delta2;
  buf.writeInt16LE(b.rel + delta2, pos);
}
buf.writeUInt32LE(tag.length + delta1 + delta2, tag.offset + 2);

const outSize = writeSwf(IN_PATH, sig, version, buf);
console.log(`Écrit ${IN_PATH} (${outSize} o compressés)`);
console.log('Terminé — le Challenge de Swapou 2 (desktop) demande /do/fdclaim avant la partie.');
