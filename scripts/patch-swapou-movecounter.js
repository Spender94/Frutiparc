#!/usr/bin/env node
// Fait remonter à la page deux événements de Swapou (Games/swapou2/swapou.swf) :
//   1. à chaque échange réussi  → getURL("fpswcoup:<ncoups>:<star_counter>")
//   2. à la fin de la partie     → getURL("fpswfin:")
// game-popup.html intercepte window.open et en tire les cadrans « coups » et
// « avant prochaine étoile », qui n'existent donc que pendant une partie.
//
// ATTENTION — une PREMIÈRE tentative a cassé le jeu en production et a dû être
// retirée. Elle passait le SWF en version 8 (pour ExternalInterface) et écrivait
// un compteur maison `this.__fpc` dans le jeu ; surtout, elle n'agrandissait pas
// le `codeSize` de la fonction englobante, si bien que l'AVM s'arrêtait 80
// octets trop tôt et tronquait la routine d'échange. Ce script est donc bâti sur
// quatre principes, tous vérifiés par test/gameHud.test.js :
//
//   1. AUCUN changement de version. Le pont est getURL(), disponible depuis
//      Flash 4, et déjà utilisé dans ce projet par les SWF patchés pour
//      l'enregistrement des scores et des slots. Le SWF reste en version 7.
//   2. AUCUNE écriture : pas de SetMember, pas de variable ajoutée au jeu. On se
//      contente de LIRE les compteurs que le jeu tient déjà.
//   3. AUCUN branchement : pas de If, pas de Jump, donc aucun calcul d'offset à
//      se tromper. Chaque injection est une suite linéaire d'instructions.
//   4. Le `codeSize` de TOUTES les fonctions englobantes est agrandi, et le
//      script refuse d'écrire s'il n'en trouve aucune.
//
// Réversible d'une commande : git checkout Games/swapou2/swapou.swf

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const IN_PATH = path.resolve(__dirname, '..', 'Games', 'swapou2', 'swapou.swf');

// ─── Site A : le compteur de coups ───
// `ncoups` n'est PAS un compteur de coups affichable tel quel : c'est le curseur
// de difficulté du jeu (il démarre à 5 en Challenge, à 1 en Classique, et
// retombe à 0 à chaque niveau franchi). La page compte donc les coups elle-même
// — un envoi = un échange réussi — et se sert de `ncoups` uniquement pour
// détecter un redémarrage (sa valeur repart en arrière).
//
// Le nom obfusqué de ncoups ("}+{$0 \"") vient du motif bytecode
// Push r1,cp | Push r1,cp | GetMember | Increment | SetMember, et la fonction qui
// le contient a bien PreloadThis (vérifié) : r1 est donc `this`.
const OBF_NCOUPS = '}+{$0 "';
// star_counter — décompte les fruits jusqu'à la prochaine étoile de pouvoir.
// Identifié par la signature de la fonction qui engendre un fruit :
//     is_armure = ( random(130) < random(ncoups) )
//     is_noswap = ... ( random(250) < random(ncoups) )
//     is_star   = ... ( (--star_counter) == 0 )
// Les littéraux 130 et 250 pointent la fonction ; le seul Decrement qui suit
// écrit "36&0#|#".
const OBF_STAR = '36&0#|#';
const URL_COUP = 'fpswcoup:';
const URL_SEP = ':';
const CIBLE_COUP = '_fpswcoup';

// ─── Site B : la fin de partie ───
// Les cadrans ne doivent vivre QUE pendant une partie : ni sur les écrans de
// menu (aucun échange n'y a lieu, ils n'y naissent donc jamais), ni sur l'écran
// de fin — d'où ce second signal. On l'accroche au constructeur de la classe
// GameOver, appelé par Manager.gameOver() à l'instant exact où la partie
// s'arrête, et une seule fois. Swapou n'offre aucun moyen d'abandonner en cours
// de partie : game over et fermeture de la fenêtre sont les deux seules sorties.
//
// Cette classe est repérée par le seul littéral en clair qu'elle contient
// (« Vous avez gagné », de winTitem) ; dans son tag, le constructeur est la
// seule fonction qui pose À LA FOIS onPress et useHandCursor — netLock et
// netUnlock ne touchent que le second, onClick que le premier (et pour l'effacer).
const LITTERAL_GAMEOVER = 'Vous avez gagn';
const MEMBRE_PRESS = 'onPress';
const MEMBRE_CURSEUR = 'useHandCursor';
const URL_FIN = 'fpswfin:';
const CIBLE_FIN = '_fpswfin';

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
const INCREMENT = 0x50, SET_MEMBER = 0x4F, PUSH = 0x96, DEFINE_FUNCTION2 = 0x8E, DELETE = 0x3A;
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

// ─── Lecture d'un tag à actions (ConstantPool + code) ───
// `saut` = octets à ignorer avant la ConstantPool : 2 pour DoInitAction (le
// numéro de sprite), 0 pour DoAction.
function lireTag(buf, tag) {
  const saut = tag.code === 59 ? 2 : 0;
  const cpStart = tag.offset + tag.hdrSize + saut;
  if (buf[cpStart] !== 0x88) throw new Error('ConstantPool attendue au début du tag ' + tag.offset);
  const payloadLen = buf.readUInt16LE(cpStart + 1), count = buf.readUInt16LE(cpStart + 3);
  const cp = []; let pos = cpStart + 5;
  for (let i = 0; i < count; i++) { const e = buf.indexOf(0, pos); cp.push(buf.slice(pos, e).toString('latin1')); pos = e + 1; }
  return { cpStart, payloadLen, count, cp, dataEnd: cpStart + 3 + payloadLen };
}

// Ajoute au pool les chaînes manquantes. Renvoie { buf, idx, delta }.
function ajouterAuPool(buf, tag, infos, chaines) {
  const idx = {}, aAjouter = [];
  for (const s of chaines) {
    const i = infos.cp.indexOf(s);
    if (i >= 0) idx[s] = i; else { idx[s] = infos.count + aAjouter.length; aAjouter.push(s); }
  }
  let ajout = Buffer.alloc(0);
  for (const s of aAjouter) ajout = Buffer.concat([ajout, Buffer.from(s + '\0', 'latin1')]);
  if (!ajout.length) return { buf, idx, delta: 0 };
  buf = Buffer.concat([buf.slice(0, infos.dataEnd), ajout, buf.slice(infos.dataEnd)]);
  buf.writeUInt16LE(infos.payloadLen + ajout.length, infos.cpStart + 1);
  buf.writeUInt16LE(infos.count + aAjouter.length, infos.cpStart + 3);
  if (tag.hdrSize !== 6) throw new Error('tag court inattendu');
  buf.writeUInt32LE(tag.length + ajout.length, tag.offset + 2);
  console.log(`  pool : +${aAjouter.length} chaîne(s), +${ajout.length} o`);
  return { buf, idx, delta: ajout.length };
}

// Insère `code` à `injectAt`, en respectant les trois invariants : ré-offsetter
// les branchements qui enjambent le point d'injection, agrandir le codeSize de
// TOUTES les fonctions englobantes, mettre à jour la longueur du tag.
function injecter(buf, tag, actionsStart, tagEnd, injectAt, code, quoi) {
  const enjambants = [];
  for (const ins of walk(buf, actionsStart, tagEnd)) {
    if (ins.op !== 0x9D && ins.op !== 0x99) continue;
    const rel = buf.readInt16LE(ins.pc + 3), cible = ins.next + rel;
    if ((ins.next <= injectAt && cible > injectAt) || (ins.next > injectAt && cible <= injectAt))
      enjambants.push({ fieldPos: ins.pc + 3, rel });
  }
  buf = Buffer.concat([buf.slice(0, injectAt), code, buf.slice(injectAt)]);
  for (const b of enjambants) {
    const p = b.fieldPos < injectAt ? b.fieldPos : b.fieldPos + code.length;
    buf.writeInt16LE(b.rel + (b.rel > 0 ? code.length : -code.length), p);
  }
  let englobantes = 0;
  for (const ins of walk(buf, actionsStart, tagEnd + code.length)) {
    if (ins.op !== DEFINE_FUNCTION2) continue;
    const csPos = ins.next - 2, cs = buf.readUInt16LE(csPos);
    if (ins.next <= injectAt && injectAt < ins.next + cs) { buf.writeUInt16LE(cs + code.length, csPos); englobantes++; }
  }
  if (!englobantes) throw new Error(`${quoi} : aucune fonction englobante — patch abandonné`);
  buf.writeUInt32LE(buf.readUInt32LE(tag.offset + 2) + code.length, tag.offset + 2);
  console.log(`  ${quoi} : ${code.length} o injectés en ${injectAt}, ` +
    `${enjambants.length} branchement(s) ré-offsetté(s), ${englobantes} fonction(s) agrandie(s)`);
  return buf;
}

// ─── Patch ───
const { sig, version, body } = readSwf(IN_PATH);
let buf = Buffer.from(body);
const contient = (s) => buf.includes(Buffer.from(s, 'latin1'));

// ── A. Compteur de coups ────────────────────────────────────────────────────
if (contient(URL_COUP)) {
  console.log('A. compteur de coups : déjà patché.');
} else {
  const tag = findTags(buf).find((t) => t.code === 59 &&
    buf.slice(t.offset + t.hdrSize, t.offset + t.hdrSize + t.length).includes(Buffer.from(OBF_NCOUPS, 'latin1')));
  if (!tag) throw new Error('DoInitAction contenant ncoups introuvable');
  const infos = lireTag(buf, tag);
  console.log(`A. compteur de coups — classe à ${tag.offset} (pool ${infos.count} entrées)`);
  if (infos.cp.indexOf(OBF_NCOUPS) < 0) throw new Error('ncoups absent du pool');
  if (infos.cp.indexOf(OBF_STAR) < 0) throw new Error('star_counter absent du pool');

  const r = ajouterAuPool(buf, tag, infos, [OBF_NCOUPS, OBF_STAR, URL_COUP, URL_SEP, CIBLE_COUP]);
  buf = r.buf;
  const actionsStart = infos.dataEnd + r.delta;
  const tagEnd = tag.offset + tag.hdrSize + tag.length + r.delta;

  // Site : Push r1,cp(ncoups) | Push r1,cp(ncoups) | GetMember | Increment | SetMember
  const nc = pushCp(r.idx[OBF_NCOUPS]);
  const motif = actionPush(pushReg(1), nc, pushReg(1), nc);
  let injectAt = -1;
  const seq = [];
  for (const ins of walk(buf, actionsStart, tagEnd)) {
    seq.push(ins);
    const n = seq.length;
    if (n >= 4 &&
        seq[n - 1].op === SET_MEMBER && seq[n - 2].op === INCREMENT && seq[n - 3].op === 0x4E &&
        seq[n - 4].op === PUSH && buf.slice(seq[n - 4].pc, seq[n - 4].next).equals(motif)) {
      injectAt = ins.next;                        // juste APRÈS le SetMember du ++
      break;
    }
  }
  if (injectAt < 0) throw new Error('site « ncoups++ » introuvable');

  // getURL("fpswcoup:" + this.ncoups + ":" + this.star_counter, "_fpswcoup")
  // Suite LINÉAIRE : aucune écriture mémoire, aucun branchement, pile équilibrée
  // (tout est consommé par GetURL2).
  const code = Buffer.concat([
    actionPush(pushCp(r.idx[URL_COUP]), pushReg(1), nc), GET_MEMBER, ADD2,
    actionPush(pushCp(r.idx[URL_SEP])), ADD2,
    actionPush(pushReg(1), pushCp(r.idx[OBF_STAR])), GET_MEMBER, ADD2,
    actionPush(pushCp(r.idx[CIBLE_COUP])),
    GET_URL2,
  ]);
  buf = injecter(buf, tag, actionsStart, tagEnd, injectAt, code, 'ncoups++');
}

// ── B. Fin de partie ────────────────────────────────────────────────────────
if (contient(URL_FIN)) {
  console.log('B. fin de partie : déjà patché.');
} else {
  const tag = findTags(buf).find((t) => (t.code === 59 || t.code === 12) &&
    buf.slice(t.offset + t.hdrSize, t.offset + t.hdrSize + t.length).includes(Buffer.from(LITTERAL_GAMEOVER, 'latin1')));
  if (!tag) throw new Error('classe GameOver introuvable');
  const infos = lireTag(buf, tag);
  console.log(`B. fin de partie — classe GameOver à ${tag.offset} (pool ${infos.count} entrées)`);
  for (const m of [MEMBRE_PRESS, MEMBRE_CURSEUR]) {
    if (infos.cp.indexOf(m) < 0) throw new Error(`${m} absent du pool de GameOver`);
  }
  const iPress = pushCp(infos.cp.indexOf(MEMBRE_PRESS));
  const iCurseur = pushCp(infos.cp.indexOf(MEMBRE_CURSEUR));

  const r = ajouterAuPool(buf, tag, infos, [URL_FIN, CIBLE_FIN]);
  buf = r.buf;
  const actionsStart = infos.dataEnd + r.delta;
  const tagEnd = tag.offset + tag.hdrSize + tag.length + r.delta;

  // Le constructeur : seule fonction du tag qui POSE onPress ET useHandCursor.
  // (onClick efface onPress — d'où l'exclusion des corps qui contiennent un
  // ActionDelete ; netLock/netUnlock ne touchent que useHandCursor.)
  const candidats = [];
  for (const ins of walk(buf, actionsStart, tagEnd)) {
    if (ins.op !== DEFINE_FUNCTION2) continue;
    const cs = buf.readUInt16LE(ins.next - 2);
    let press = false, curseur = false, efface = false;
    for (const i of walk(buf, ins.next, ins.next + cs)) {
      if (i.op === DELETE) efface = true;
      if (i.op !== PUSH) continue;
      const p = buf.slice(i.pc + 3, i.next);
      if (p.includes(iPress)) press = true;
      if (p.includes(iCurseur)) curseur = true;
    }
    if (press && curseur && !efface) candidats.push({ debut: ins.next, cs });
  }
  if (candidats.length !== 1)
    throw new Error(`constructeur de GameOver : ${candidats.length} candidat(s) au lieu d'un seul`);
  console.log(`  constructeur : corps ${candidats[0].debut}..${candidats[0].debut + candidats[0].cs} (${candidats[0].cs} o)`);

  // getURL("fpswfin:", "_fpswfin") — deux constantes et rien d'autre, posé en
  // tête du corps : la pile est vide, aucun registre n'est touché.
  const code = Buffer.concat([
    actionPush(pushCp(r.idx[URL_FIN]), pushCp(r.idx[CIBLE_FIN])),
    GET_URL2,
  ]);
  buf = injecter(buf, tag, actionsStart, tagEnd, candidats[0].debut, code, 'GameOver()');
}

const outSize = writeSwf(IN_PATH, sig, version, buf);
console.log(`Écrit ${IN_PATH} (${outSize} o compressés, version ${version} INCHANGÉE)`);
