#!/usr/bin/env node
// Donne à Minipixiz son icône « en jeu » sur le BUREAU.
//
//   node scripts/patch-main-statusmng-minipixiz.js      → modifie legacy/main.swf
//
// Le code interne diffusé dans la chaîne de statut est un INDEX dans
// StatusMng.internalList ([∅, forum, bkiwi, mb2, swapou2, snake3, bandas,
// grapiz, kaluga, miniwave] — lu dans le bytecode), et l'affichage fait
// gotoAndStop(nom) sur la feuille d'icônes (clip 246), dont l'image 15 porte
// déjà l'étiquette « minipixiz » : le dessin de la fée-papillon attendait, il
// n'a jamais été branché — la liste s'arrête à miniwave.
//
// Le serveur envoie 12 pour Minipixiz (STATUS_INTERNAL_FRAME). Plutôt que de
// retailler la fonction d'init compilée de StatusMng (sauts relatifs, taille
// de fonction — fragile), on APPEND un petit tag DoAction juste après le
// DoInitAction qui la définit :
//
//     _global.StatusMng.internalList[12] = "minipixiz";
//
// Un DoInitAction s'exécute au chargement du tag, un DoAction à l'affichage
// de l'image : dans la même image, le nôtre passe après — la liste existe.
// Insérer un tag ENTRE deux tags ne retaille rien d'autre que l'en-tête du
// fichier (FileLength), recalculé par l'écriture.

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SWF = path.resolve(__dirname, '..', 'legacy', 'main.swf');

function lireSwf(p) {
  const raw = fs.readFileSync(p);
  const sig = raw.slice(0, 3).toString('ascii');
  if (sig !== 'CWS' && sig !== 'FWS') throw new Error('signature inconnue : ' + sig);
  const body = sig === 'CWS' ? zlib.inflateSync(raw.slice(8)) : Buffer.from(raw.slice(8));
  return { sig, version: raw[3], body };
}
function ecrireSwf(p, sig, version, body) {
  const charge = sig === 'CWS' ? zlib.deflateSync(body, { level: 9 }) : body;
  const out = Buffer.alloc(8 + charge.length);
  out.write(sig, 0, 'ascii');
  out.writeUInt8(version, 3);
  out.writeUInt32LE(8 + body.length, 4);   // FileLength = taille décompressée
  charge.copy(out, 8);
  fs.writeFileSync(p, out);
  return out.length;
}

// ── Le bytecode à injecter ──
const pousseChaine = (s) => Buffer.concat([
  Buffer.from([0x96, s.length + 2, 0x00, 0x00]),          // push, len, type 0
  Buffer.from(s, 'latin1'), Buffer.from([0x00]),
]);
const pousseEntier = (n) => {
  const b = Buffer.alloc(8);
  b[0] = 0x96; b[1] = 5; b[2] = 0; b[3] = 0x07;           // push, len 5, type 7
  b.writeUInt32LE(n >>> 0, 4);
  return b;
};
const ACTIONS = Buffer.concat([
  pousseChaine('_global'),
  Buffer.from([0x1c]),                                     // getVariable
  pousseChaine('StatusMng'),
  Buffer.from([0x4e]),                                     // getMember
  pousseChaine('internalList'),
  Buffer.from([0x4e]),                                     // getMember
  pousseEntier(12),
  pousseChaine('minipixiz'),
  Buffer.from([0x4f]),                                     // setMember
  Buffer.from([0x00]),                                     // end
]);
// Tag DoAction (code 12), en-tête court — le corps fait bien moins de 63 octets ?
// Non : ~70. En-tête LONG, toujours valable.
const TAG = Buffer.concat([
  Buffer.from([(12 << 6) | 0x3f, 0x00]),                   // hdr16 : code 12, long
  (() => { const b = Buffer.alloc(4); b.writeUInt32LE(ACTIONS.length, 0); return b; })(),
  ACTIONS,
]);

function principal() {
  const { sig, version, body } = lireSwf(SWF);
  if (body.indexOf(ACTIONS) >= 0) {
    console.log('déjà patché — rien à faire.');
    return;
  }

  // Trouve le DoInitAction (code 59) qui définit StatusMng : celui dont le
  // corps contient la chaîne "internalList".
  const nbits = (body[0] >> 3) & 0x1f;
  let o = Math.ceil((5 + nbits * 4) / 8) + 4;
  let apres = -1, trouves = 0;
  while (o < body.length) {
    const hdr = body.readUInt16LE(o), code = hdr >> 6;
    let len = hdr & 0x3f, hs = 2;
    if (len === 0x3f) { len = body.readUInt32LE(o + 2); hs = 6; }
    if (code === 0) break;
    if (code === 59
      && body.slice(o + hs, o + hs + len).indexOf('internalList') >= 0) {
      apres = o + hs + len;
      trouves++;
    }
    o += hs + len;
  }
  if (trouves !== 1) throw new Error('DoInitAction de StatusMng : ' + trouves + ' candidat(s)');

  const patche = Buffer.concat([body.slice(0, apres), TAG, body.slice(apres)]);
  fs.copyFileSync(SWF, SWF + '.avant-minipixiz');
  const taille = ecrireSwf(SWF, sig, version, patche);
  console.log('patché : +' + TAG.length + ' octets injectés après le DoInitAction de StatusMng');
  console.log('→ ' + SWF + ' (' + taille + ' octets, sauvegarde .avant-minipixiz)');
}

principal();
