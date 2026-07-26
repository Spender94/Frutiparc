#!/usr/bin/env node
// Patche Games/snake3/snake3.swf pour REMONTER À LA PAGE trois informations de
// jeu (option de confort « tableau de bord ») : longueur du serpent, nombre de
// dynamites ramassées, et bonus actif (nombre + temps du slot courant).
//
// Injecté EN TÊTE de Game.main() (boucle de jeu) :
//     this.__k = (this.__k | 0) + 1 ;
//     if( (this.__k % 6) == 0 )                      // ~5 envois/seconde
//       flash.external.ExternalInterface.call("fpSnakeHud",
//           this.snake.len,                          // longueur
//           snake3.bonus.Pile.counter,               // dynamites ramassées
//           this.slots.length,                       // bonus actifs
//           this.slots[0].time ) ;                   // temps du bonus courant
//
// Le jeu ne communiquait pas du tout avec la page : ce pont est le seul moyen
// d'afficher ces valeurs en overlay (recompiler est impossible — le Makefile
// pointe un compilateur Windows propriétaire absent).
//
// Noms obfusqués retrouvés au désassembleur (snake3_obfu.txt indique QUELS noms
// sont obfusqués, pas leur valeur) :
//   snake   = "]@=%^$"   (signature : snake.len comparé à 0/10/50/100 dans main)
//   len     = "-1\"!"
//   Pile    = snake3."!$+35"."!?7*&"   (bonus.Pile : counter++ puis boucle
//                                       d'explosions sur snake.len)
//   counter = "3}-82]#"
//   time    = "*}^#\"#"  (slot temporisé : membre initialisé au 3e paramètre)
//   slots   et  main  ne sont PAS obfusqués (marqués « ! » dans snake3_obfu.txt).
//
// Cible repérée par MOTIF (Push "main" suivi du DefineFunction2), aucun offset
// codé en dur. Idempotent, et réversible : le SWF est suivi par git.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const IN_PATH = path.resolve(__dirname, '..', 'Games', 'snake3', 'snake3.swf');
const OBF = { snake: ']@=%^$', len: '-1"!', bonusPkg: '!$+35', pile: '!?7*&', counter: '3}-82]#', time: '*}^#"#' };
const JS_CALLBACK = 'fpSnakeHud';
const TICK_MEMBER = '__k';
const EVERY = 6;               // 1 envoi toutes les 6 images (~5/s)

// ─── SWF I/O ───
function readSwf(p) {
  const raw = fs.readFileSync(p);
  const sig = raw.slice(0, 3).toString('ascii');
  const version = raw[3];
  let body;
  if (sig === 'CWS') body = zlib.inflateSync(raw.slice(8));
  else if (sig === 'FWS') body = Buffer.from(raw.slice(8));
  else throw new Error('Signature inconnue: ' + sig);
  return { sig, version, body };
}
function writeSwf(p, sig, version, newBody) {
  const payload = sig === 'CWS' ? zlib.deflateSync(newBody, { level: 9 }) : newBody;
  const out = Buffer.alloc(8 + payload.length);
  out.write(sig, 0, 'ascii');
  out.writeUInt8(version, 3);
  out.writeUInt32LE(8 + newBody.length, 4);
  payload.copy(out, 8);
  fs.writeFileSync(p, out);
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
  if (b[cpStart] !== 0x88) throw new Error('ConstantPool attendu à ' + cpStart);
  const payloadLen = b.readUInt16LE(cpStart + 1);
  const count = b.readUInt16LE(cpStart + 3);
  const entries = [];
  let pos = cpStart + 5;
  for (let i = 0; i < count; i++) { const e = b.indexOf(0, pos); entries.push(b.slice(pos, e).toString('latin1')); pos = e + 1; }
  return { payloadLen, count, entries, dataEnd: cpStart + 3 + payloadLen };
}

// ─── Assembleur AS2 ───
function pushReg(r) { return Buffer.from([0x04, r]); }
function pushCp(i) { return i < 256 ? Buffer.from([0x08, i]) : Buffer.from([0x09, i & 0xff, (i >> 8) & 0xff]); }
function pushInt(v) { const b = Buffer.alloc(5); b[0] = 0x07; b.writeInt32LE(v, 1); return b; }
function actionPush(...items) {
  const payload = Buffer.concat(items);
  const hdr = Buffer.alloc(3); hdr[0] = 0x96; hdr.writeUInt16LE(payload.length, 1);
  return Buffer.concat([hdr, payload]);
}
const POP = Buffer.from([0x17]);
const SET_MEMBER = Buffer.from([0x4F]);
const GET_MEMBER = Buffer.from([0x4E]);
const CALL_METHOD = Buffer.from([0x52]);
const GET_VARIABLE = Buffer.from([0x1C]);
const ADD2 = Buffer.from([0x47]);
const BIT_OR = Buffer.from([0x61]);
const MODULO = Buffer.from([0x3F]);
const EQUALS2 = Buffer.from([0x49]);
const NOT = Buffer.from([0x12]);
function actionIf(offset) { const b = Buffer.alloc(5); b[0] = 0x9D; b.writeUInt16LE(2, 1); b.writeInt16LE(offset, 3); return b; }

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

// 1. Le DoInitAction de la classe Game (pool contenant 'slots' + 'main' + snake).
const tags = findTags(buf);
let tag = null;
for (const t of tags) {
  if (t.code !== 59) continue;
  const s = t.offset + t.hdrSize, e = s + t.length;
  const sl = buf.slice(s, e);
  if (sl.includes(Buffer.from('slots', 'latin1')) && sl.includes(Buffer.from(OBF.snake, 'latin1')) && sl.includes(Buffer.from('giveItem', 'latin1'))) { tag = t; break; }
}
if (!tag) throw new Error('DoInitAction de la classe Game introuvable');
const cpStart = tag.offset + tag.hdrSize + 2;
const cp = parseConstantPool(buf, cpStart);
console.log(`Classe Game trouvée à ${tag.offset} (pool ${cp.count} entrées)`);

// 2. Idempotence.
if (cp.entries.includes('ExternalInterface')) { console.log('Déjà patché — rien à faire.'); process.exit(0); }
for (const k of ['snake', 'len']) {
  if (cp.entries.indexOf(OBF[k]) < 0) throw new Error(`nom obfusqué ${k} (${JSON.stringify(OBF[k])}) absent du pool`);
}

// 3. Chaînes nécessaires.
const NEEDED = ['snake3', OBF.bonusPkg, OBF.pile, OBF.counter, OBF.snake, OBF.len, OBF.time,
                'slots', 'length', 'main', TICK_MEMBER, JS_CALLBACK, 'flash', 'external', 'ExternalInterface', 'call'];
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
  console.log(`Pool: +${toAppend.length} chaînes, +${delta1} o`);
}
const tagEnd = tag.offset + tag.hdrSize + tag.length + delta1;
const actionsStart = cp.dataEnd + delta1;

// 4. Localise Game.main : Push cp("main") immédiatement suivi d'un DefineFunction2.
let fn = null;
let prev = null;
for (const ins of walkActions(buf, actionsStart, tagEnd)) {
  if (ins.op === 0x8E && prev && prev.op === 0x96) {
    const seg = buf.slice(prev.pc + 3, prev.pc + 3 + prev.len);
    // Push d'une seule constante valant "main"
    const isMain = (seg.length === 2 && seg[0] === 0x08 && seg[1] === idx['main']) ||
                   (seg.length === 3 && seg[0] === 0x09 && seg.readUInt16LE(1) === idx['main']);
    if (isMain) {
      const hdrEnd = ins.pc + 3 + ins.len;          // fin de l'en-tête DefineFunction2
      const codeSizePos = hdrEnd - 2;               // codeSize = 2 derniers octets
      fn = { hdrEnd, codeSizePos, codeSize: buf.readUInt16LE(codeSizePos) };
      break;
    }
  }
  prev = ins;
}
if (idx['main'] === undefined) throw new Error("'main' absent du pool");
if (!fn) throw new Error('Game.main introuvable');
console.log(`Game.main : corps à ${fn.hdrEnd} (${fn.codeSize} octets)`);

// 5. Code injecté, en tête du corps de main(). r1 = this (le Game).
const tick = pushCp(idx[TICK_MEMBER]);
const callBlock = Buffer.concat([
  // arguments empilés en ordre INVERSE
  actionPush(pushReg(1), pushCp(idx['slots'])), GET_MEMBER,
  actionPush(pushInt(0)), GET_MEMBER, actionPush(pushCp(idx[OBF.time])), GET_MEMBER,   // slots[0].time
  actionPush(pushReg(1), pushCp(idx['slots'])), GET_MEMBER, actionPush(pushCp(idx['length'])), GET_MEMBER,
  actionPush(pushCp(idx['snake3'])), GET_VARIABLE,
  actionPush(pushCp(idx[OBF.bonusPkg])), GET_MEMBER,
  actionPush(pushCp(idx[OBF.pile])), GET_MEMBER,
  actionPush(pushCp(idx[OBF.counter])), GET_MEMBER,                                    // Pile.counter
  actionPush(pushReg(1), pushCp(idx[OBF.snake])), GET_MEMBER, actionPush(pushCp(idx[OBF.len])), GET_MEMBER,
  actionPush(pushCp(idx[JS_CALLBACK])),
  actionPush(pushInt(5)),
  actionPush(pushCp(idx['flash'])), GET_VARIABLE,
  actionPush(pushCp(idx['external'])), GET_MEMBER,
  actionPush(pushCp(idx['ExternalInterface'])), GET_MEMBER,
  actionPush(pushCp(idx['call'])),
  CALL_METHOD, POP,
]);
const inject = Buffer.concat([
  // this.__k = (this.__k | 0) + 1
  actionPush(pushReg(1), tick),
  actionPush(pushReg(1), tick), GET_MEMBER, actionPush(pushInt(0)), BIT_OR, actionPush(pushInt(1)), ADD2,
  SET_MEMBER,
  // if ((this.__k % EVERY) != 0) → saute l'envoi
  actionPush(pushReg(1), tick), GET_MEMBER, actionPush(pushInt(EVERY)), MODULO,
  actionPush(pushInt(0)), EQUALS2, NOT,
  actionIf(callBlock.length),
  callBlock,
]);
console.log(`Code injecté : ${inject.length} octets (envoi 1 image sur ${EVERY})`);

// 6. Branchements enjambant le point d'injection (début du corps de main).
const injectAt = fn.hdrEnd;
const spanning = [];
for (const ins of walkActions(buf, actionsStart, tagEnd)) {
  if (ins.op !== 0x9D && ins.op !== 0x99) continue;
  const rel = buf.readInt16LE(ins.pc + 3);
  const target = ins.next + rel;
  const crosses = (ins.next <= injectAt && target > injectAt) || (ins.next > injectAt && target <= injectAt);
  if (crosses) spanning.push({ fieldPos: ins.pc + 3, rel });
}
console.log(`Branchements enjambants : ${spanning.length}`);

// 7. Splice + mises à jour (codeSize de main, offsets, longueur de tag).
buf = Buffer.concat([buf.slice(0, injectAt), inject, buf.slice(injectAt)]);
for (const b of spanning) {
  const pos = b.fieldPos < injectAt ? b.fieldPos : b.fieldPos + inject.length;
  buf.writeInt16LE(b.rel + (b.rel > 0 ? inject.length : -inject.length), pos);
}
buf.writeUInt16LE(fn.codeSize + inject.length, fn.codeSizePos);   // main() est plus longue
buf.writeUInt32LE(tag.length + delta1 + inject.length, tag.offset + 2);

const outSize = writeSwf(IN_PATH, sig, version, buf);
console.log(`Écrit ${IN_PATH} (${outSize} o compressés)`);
console.log(`Terminé — le jeu appelle ${JS_CALLBACK}(longueur, dynamites, nbBonus, tempsBonus).`);
