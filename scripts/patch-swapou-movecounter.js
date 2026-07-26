#!/usr/bin/env node
// Patche Games/swapou2/swapou.swf pour EXPOSER À LA PAGE le numéro du coup en
// cours (option de confort « compteur de coups »). Le SWF ne parlait pas au JS ;
// on ajoute un appel ExternalInterface à chaque échange réussi :
//
//   AVANT (Challenge.gameClick, bytecode) :
//       Manager.client.nswaps++ ; ncoups++ ; setLock(true) ;
//   APRÈS :
//       Manager.client.nswaps++ ; ncoups++ ;
//       this.__fpc = (this.__fpc | 0) + 1 ;                  // compteur par partie
//       flash.external.ExternalInterface.call("fpSwapouCoup", this.__fpc) ;
//       setLock(true) ;
//
// Le compteur vit sur l'INSTANCE de la partie (`this`), recréée à chaque
// nouvelle partie : il repart donc naturellement de 1, sans reset à gérer.
// C'est volontairement un compteur PROPRE, distinct de `ncoups` du jeu, qui est
// un paramètre de difficulté (démarre à 5 en Challenge, se remet à zéro à chaque
// niveau en Classique) et ne conviendrait pas à l'affichage.
//
// Noms obfusqués (retrouvés au désassembleur, cf. patch-swapou-client.js) :
//   Manager = "7}}#$$!" ; client = "7%1+$-!" ; nswaps = "2]1!3$\"" ;
//   ncoups  = "}+{$0 \"".
// La cible est repérée par MOTIF BYTECODE (aucun offset codé en dur) :
//   Push r1,cp(ncoups),r1,cp(ncoups) ; GetMember ; Increment ; SetMember
// Idempotent : si "ExternalInterface" est déjà dans le pool, ne fait rien.
// Réversible : le SWF est suivi par git (git checkout Games/swapou2/swapou.swf).

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const IN_PATH = path.resolve(__dirname, '..', 'Games', 'swapou2', 'swapou.swf');
const OBF_NCOUPS = '}+{$0 "';
const JS_CALLBACK = 'fpSwapouCoup';
const COUNTER_MEMBER = '__fpc';

// ─── SWF I/O ───
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
// ATTENTION — l'octet de version du SWF ne doit PAS rester à 7.
// ExternalInterface est une API Flash Player 8 : tant que l'en-tête annonce la
// version 7, Ruffle ne publie pas flash.external.ExternalInterface et l'appel
// injecté ne fait RIEN, sans la moindre erreur. Vérifié par une sonde
// inconditionnelle : zéro rappel en version 7, rappel immédiat en version 8.
const MIN_SWF_VERSION = 8;
function writeSwf(outPath, sig, version, newBody) {
  const payload = sig === 'CWS' ? zlib.deflateSync(newBody, { level: 9 }) : newBody;
  const out = Buffer.alloc(8 + payload.length);
  out.write(sig, 0, 'ascii');
  out.writeUInt8(Math.max(version, MIN_SWF_VERSION), 3);
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

// ─── Assembleur AS2 minimal ───
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

// 1. Le DoInitAction qui contient la classe de jeu (celle qui incrémente ncoups).
const tags = findTags(buf);
let tag = null;
for (const t of tags) {
  if (t.code !== 59) continue;
  const s = t.offset + t.hdrSize, e = s + t.length;
  const slice = buf.slice(s, e);
  if (slice.includes(Buffer.from(OBF_NCOUPS, 'latin1'))) { tag = t; break; }
}
if (!tag) throw new Error('DoInitAction contenant ncoups (' + JSON.stringify(OBF_NCOUPS) + ') introuvable');
const cpStart = tag.offset + tag.hdrSize + 2;
const cp = parseConstantPool(buf, cpStart);
console.log(`DoInitAction trouvé à ${tag.offset} (len=${tag.length}), pool: ${cp.count} entrées`);

// 2. Idempotence.
if (cp.entries.includes('ExternalInterface')) { console.log('Déjà patché (« ExternalInterface » présent) — rien à faire.'); process.exit(0); }
if (cp.entries.indexOf(OBF_NCOUPS) < 0) throw new Error('ncoups absent du pool de ce tag');

// 3. Chaînes nécessaires.
const NEEDED = [OBF_NCOUPS, COUNTER_MEMBER, JS_CALLBACK, 'flash', 'external', 'ExternalInterface', 'call'];
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

// 4. Localise « this.ncoups++ » : Push r1,cp(ncoups),r1,cp(ncoups) ; GetMember ;
//    Increment ; SetMember. C'est le site de l'échange réussi (Challenge.gameClick,
//    dont hérite le mode Classique).
const nc = pushCp(idx[OBF_NCOUPS]);
const incPattern = Buffer.concat([
  actionPush(pushReg(1), nc, pushReg(1), nc),
  GET_MEMBER, Buffer.from([0x50]), SET_MEMBER,     // GetMember ; Increment ; SetMember
]);
const sites = [];
for (const ins of walkActions(buf, actionsStart, tagEnd)) {
  if (ins.op !== 0x96) continue;
  if (buf.slice(ins.pc, ins.pc + incPattern.length).equals(incPattern)) sites.push(ins.pc + incPattern.length);
}
if (sites.length !== 1) throw new Error(`1 site « ncoups++ » attendu, trouvé ${sites.length}`);
const injectAt = sites[0];
console.log(`Site « ncoups++ » trouvé — injection à ${injectAt}`);

// 5. Code injecté (aucun registre supplémentaire : r1 = this, déjà en place).
const counter = pushCp(idx[COUNTER_MEMBER]);
const inject = Buffer.concat([
  // this.__fpc = (this.__fpc | 0) + 1
  actionPush(pushReg(1), counter),                       // cible du SetMember
  actionPush(pushReg(1), counter), GET_MEMBER,           // valeur actuelle
  actionPush(pushInt(0)), BIT_OR,                        // undefined → 0
  actionPush(pushInt(1)), ADD2,
  SET_MEMBER,
  // flash.external.ExternalInterface.call("fpSwapouCoup", this.__fpc)
  actionPush(pushReg(1), counter), GET_MEMBER,           // arg 2 (empilé en 1er)
  actionPush(pushCp(idx[JS_CALLBACK])),                  // arg 1
  actionPush(pushInt(2)),                                // nb d'arguments
  actionPush(pushCp(idx['flash'])), GET_VARIABLE,
  actionPush(pushCp(idx['external'])), GET_MEMBER,
  actionPush(pushCp(idx['ExternalInterface'])), GET_MEMBER,
  actionPush(pushCp(idx['call'])),
  CALL_METHOD, POP,
]);
const delta2 = inject.length;
console.log(`Code injecté : ${delta2} octets`);

// 6. Ré-offsette les branchements qui ENJAMBENT le point d'injection.
const spanning = [];
for (const ins of walkActions(buf, actionsStart, tagEnd)) {
  if (ins.op !== 0x9D && ins.op !== 0x99) continue;
  const rel = buf.readInt16LE(ins.pc + 3);
  const target = ins.next + rel;
  const crosses = (ins.next <= injectAt && target > injectAt) || (ins.next > injectAt && target <= injectAt);
  if (crosses) spanning.push({ fieldPos: ins.pc + 3, rel });
}
console.log(`Branchements enjambants à ré-offsetter : ${spanning.length}`);

// 7. Splice + ré-offset + longueur de tag.
buf = Buffer.concat([buf.slice(0, injectAt), inject, buf.slice(injectAt)]);
for (const b of spanning) {
  const pos = b.fieldPos < injectAt ? b.fieldPos : b.fieldPos + delta2;
  const rel = b.rel;
  buf.writeInt16LE(rel + (rel > 0 ? delta2 : -delta2), pos);
}
buf.writeUInt32LE(tag.length + delta1 + delta2, tag.offset + 2);

// 8. Écrit.
const outSize = writeSwf(IN_PATH, sig, version, buf);
console.log(`Écrit ${IN_PATH} (${outSize} o compressés)`);
console.log(`Terminé — chaque échange appelle désormais ${JS_CALLBACK}(n) côté page.`);
