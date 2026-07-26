#!/usr/bin/env node
// Fait remonter à la page le compteur de coups de Swapou (Games/swapou2/swapou.swf).
//
// ATTENTION — une PREMIÈRE tentative a cassé le jeu en production et a dû être
// retirée. Elle passait le SWF en version 8 (pour ExternalInterface) et écrivait
// un compteur maison `this.__fpc` dans le jeu. La cause exacte n'a jamais pu être
// reproduite hors production ; ce script est donc reconstruit pour être le moins
// intrusif possible, sur trois principes :
//
//   1. AUCUN changement de version. Le pont est getURL(), disponible depuis
//      Flash 4, et déjà utilisé dans ce projet par les SWF patchés pour
//      l'enregistrement des scores et des slots (game-popup.html intercepte
//      window.open). Le SWF reste donc en version 7, exactement comme livré.
//   2. AUCUNE écriture : pas de SetMember, pas de variable ajoutée au jeu. On se
//      contente de LIRE le compteur que le jeu tient déjà (`ncoups`).
//   3. AUCUN branchement : pas de If, pas de Jump, donc aucun calcul d'offset à
//      se tromper. Le code injecté est une suite linéaire de 6 instructions.
//
// Injecté juste après `this.ncoups++` :
//     getURL( "fpswcoup:" + this.ncoups , "_fpswcoup" ) ;
//
// Le nom obfusqué de ncoups ("}+{$0 \"") vient du motif bytecode
// Push r1,cp | Push r1,cp | GetMember | Increment | SetMember, et la fonction qui
// le contient a bien PreloadThis (vérifié) : r1 est donc `this`.
//
// Réversible d'une commande : git checkout Games/swapou2/swapou.swf

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const IN_PATH = path.resolve(__dirname, '..', 'Games', 'swapou2', 'swapou.swf');
const OBF_NCOUPS = '}+{$0 "';
const URL_PREFIX = 'fpswcoup:';
const URL_TARGET = '_fpswcoup';

// ─── SWF I/O (la version n'est JAMAIS modifiée) ───
function readSwf(p) {
  const raw = fs.readFileSync(p);
  const sig = raw.slice(0, 3).toString('ascii');
  if (sig !== 'CWS' && sig !== 'FWS') throw new Error('Signature inconnue: ' + sig);
  return { sig, version: raw[3], body: sig === 'CWS' ? zlib.inflateSync(raw.slice(8)) : Buffer.from(raw.slice(8)) };
}
function writeSwf(p, sig, version, newBody) {
  const payload = sig === 'CWS' ? zlib.deflateSync(newBody, { level: 9 }) : newBody;
  const out = Buffer.alloc(8 + payload.length);
  out.write(sig, 0, 'ascii');
  out.writeUInt8(version, 3);                    // inchangée, volontairement
  out.writeUInt32LE(8 + newBody.length, 4);
  payload.copy(out, 8);
  fs.writeFileSync(p, out);
  return out.length;
}
const rectBytes = (b) => Math.ceil((5 + ((b[0] >> 3) & 0x1f) * 4) / 8);
function findTags(b) {
  let off = rectBytes(b) + 4;
  const tags = [];
  while (off < b.length) {
    const hdr = b.readUInt16LE(off), code = hdr >> 6;
    let len = hdr & 0x3f, hs = 2;
    if (len === 0x3f) { len = b.readUInt32LE(off + 2); hs = 6; }
    if (code === 0) break;
    tags.push({ code, offset: off, hdrSize: hs, length: len });
    off += hs + len;
  }
  return tags;
}

// ─── Assembleur ───
const pushReg = (r) => Buffer.from([0x04, r]);
const pushCp = (i) => (i < 256 ? Buffer.from([0x08, i]) : Buffer.from([0x09, i & 0xff, (i >> 8) & 0xff]));
function actionPush(...items) {
  const p = Buffer.concat(items);
  const h = Buffer.alloc(3); h[0] = 0x96; h.writeUInt16LE(p.length, 1);
  return Buffer.concat([h, p]);
}
const GET_MEMBER = Buffer.from([0x4E]);
const ADD2 = Buffer.from([0x47]);
const INCREMENT = 0x50, SET_MEMBER = 0x4F;
// ActionGetURL2 : opcode 0x9A, corps d'un octet (drapeaux). 0 = navigation
// simple, sans envoi de variables. Dépile la cible puis l'URL.
const GET_URL2 = Buffer.from([0x9A, 0x01, 0x00, 0x00]);

function* walk(b, start, end) {
  let pc = start;
  while (pc < end) {
    const op = b[pc];
    if (op === 0) { pc += 1; continue; }
    const next = op >= 0x80 ? pc + 3 + b.readUInt16LE(pc + 1) : pc + 1;
    if (next <= pc || next > end) return;
    yield { pc, op, next };
    pc = next;
  }
}

// ─── Patch ───
const { sig, version, body } = readSwf(IN_PATH);
let buf = Buffer.from(body);

const tag = findTags(buf).find((t) => t.code === 59 &&
  buf.slice(t.offset + t.hdrSize, t.offset + t.hdrSize + t.length).includes(Buffer.from(OBF_NCOUPS, 'latin1')));
if (!tag) throw new Error('DoInitAction contenant ncoups introuvable');
const cpStart = tag.offset + tag.hdrSize + 2;
if (buf[cpStart] !== 0x88) throw new Error('ConstantPool attendue');
const payloadLen = buf.readUInt16LE(cpStart + 1), count = buf.readUInt16LE(cpStart + 3);
const cp = []; let pos = cpStart + 5;
for (let i = 0; i < count; i++) { const e = buf.indexOf(0, pos); cp.push(buf.slice(pos, e).toString('latin1')); pos = e + 1; }
const dataEnd = cpStart + 3 + payloadLen;
console.log(`Classe trouvée à ${tag.offset} (pool ${count} entrées)`);

if (cp.includes(URL_PREFIX)) { console.log('Déjà patché — rien à faire.'); process.exit(0); }
if (cp.indexOf(OBF_NCOUPS) < 0) throw new Error('ncoups absent du pool');

// Chaînes à ajouter.
const NEEDED = [OBF_NCOUPS, URL_PREFIX, URL_TARGET];
const idx = {}, toAppend = [];
for (const s of NEEDED) {
  const i = cp.indexOf(s);
  if (i >= 0) idx[s] = i; else { idx[s] = count + toAppend.length; toAppend.push(s); }
}
let append = Buffer.alloc(0);
for (const s of toAppend) append = Buffer.concat([append, Buffer.from(s + '\0', 'latin1')]);
if (append.length) {
  buf = Buffer.concat([buf.slice(0, dataEnd), append, buf.slice(dataEnd)]);
  buf.writeUInt16LE(payloadLen + append.length, cpStart + 1);
  buf.writeUInt16LE(count + toAppend.length, cpStart + 3);
  if (tag.hdrSize !== 6) throw new Error('tag court inattendu');
  buf.writeUInt32LE(tag.length + append.length, tag.offset + 2);
  console.log(`Pool: +${toAppend.length} chaînes, +${append.length} o`);
}
const delta1 = append.length;
const actionsStart = dataEnd + delta1;
const tagEnd = tag.offset + tag.hdrSize + tag.length + delta1;

// Site : Push r1,cp(ncoups) | Push r1,cp(ncoups) | GetMember | Increment | SetMember
const nc = pushCp(idx[OBF_NCOUPS]);
const motif = actionPush(pushReg(1), nc, pushReg(1), nc);
let injectAt = -1;
const seq = [];
for (const ins of walk(buf, actionsStart, tagEnd)) {
  seq.push(ins);
  const n = seq.length;
  if (n >= 4 &&
      seq[n - 1].op === SET_MEMBER && seq[n - 2].op === INCREMENT && seq[n - 3].op === 0x4E &&
      seq[n - 4].op === 0x96 && buf.slice(seq[n - 4].pc, seq[n - 4].next).equals(motif)) {
    injectAt = ins.next;                        // juste APRÈS le SetMember du ++
    break;
  }
}
if (injectAt < 0) throw new Error('site « ncoups++ » introuvable');
console.log(`Site « ncoups++ » trouvé — injection à ${injectAt}`);

// getURL("fpswcoup:" + this.ncoups, "_fpswcoup") — 6 instructions, aucune écriture,
// aucun branchement, pile équilibrée (tout est consommé par GetURL2).
const inject = Buffer.concat([
  actionPush(pushCp(idx[URL_PREFIX]), pushReg(1), nc), GET_MEMBER, ADD2,
  actionPush(pushCp(idx[URL_TARGET])),
  GET_URL2,
]);
console.log(`Code injecté : ${inject.length} octets (lecture seule, sans branchement)`);

// Aucun branchement n'est créé, mais ceux du jeu qui ENJAMBENT le point
// d'injection doivent être ré-offsettés.
const spanning = [];
for (const ins of walk(buf, actionsStart, tagEnd)) {
  if (ins.op !== 0x9D && ins.op !== 0x99) continue;
  const rel = buf.readInt16LE(ins.pc + 3), target = ins.next + rel;
  if ((ins.next <= injectAt && target > injectAt) || (ins.next > injectAt && target <= injectAt))
    spanning.push({ fieldPos: ins.pc + 3, rel });
}
console.log(`Branchements enjambants à ré-offsetter : ${spanning.length}`);

buf = Buffer.concat([buf.slice(0, injectAt), inject, buf.slice(injectAt)]);
for (const b of spanning) {
  const p = b.fieldPos < injectAt ? b.fieldPos : b.fieldPos + inject.length;
  buf.writeInt16LE(b.rel + (b.rel > 0 ? inject.length : -inject.length), p);
}

// La fonction qui contient le site grandit : son codeSize doit suivre. On
// reprend TOUS les DefineFunction2 dont le corps englobe le point d'injection.
let corrigees = 0;
for (const ins of walk(buf, actionsStart, tagEnd + inject.length)) {
  if (ins.op !== 0x8E) continue;
  const hdrEnd = ins.next, csPos = hdrEnd - 2, cs = buf.readUInt16LE(csPos);
  if (hdrEnd <= injectAt && injectAt < hdrEnd + cs) { buf.writeUInt16LE(cs + inject.length, csPos); corrigees++; }
}
console.log(`Fonctions englobantes agrandies : ${corrigees}`);
if (!corrigees) throw new Error('aucune fonction englobante trouvée — patch abandonné');

buf.writeUInt32LE(tag.length + delta1 + inject.length, tag.offset + 2);
const outSize = writeSwf(IN_PATH, sig, version, buf);
console.log(`Écrit ${IN_PATH} (${outSize} o compressés, version ${version} INCHANGÉE)`);
