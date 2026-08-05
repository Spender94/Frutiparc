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
// de fonction — fragile), on APPEND un petit tag juste après le DoInitAction
// qui la définit :
//
//     _global.StatusMng.internalList[12] = "minipixiz";
//
// Et ce tag est lui-même un DoInitAction — pas un DoAction : la classe vit
// sur l'image 10 de 23, qu'un gotoAndStop peut ne jamais AFFICHER, alors
// qu'un DoInitAction s'exécute au CHARGEMENT, dans l'ordre du flux — juste
// après celui de StatusMng, la liste existe. Il lui faut un SpriteID porteur :
// on prend un DefineSprite déjà défini en amont et qui n'a d'init action
// nulle part (un seul DoInitAction par sprite fait foi, les suivants sont
// ignorés). Insérer un tag ENTRE deux tags ne retaille rien d'autre que
// l'en-tête du fichier (FileLength), recalculé par l'écriture.

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
// L'en-tête de tag : sur DEUX octets little-endian — (code << 6) | 0x3f fait
// plus d'un octet (une première version l'écrivait naïvement dans un
// Buffer.from([...]) : tronqué en 0x003F, un tag End (code 0) long — les
// lecteurs stricts s'arrêtaient là et Ruffle n'exécutait jamais la rustine).
// En-tête LONG, toujours valable, writeUInt16LE comme le lecteur d'en face.
function tagLong(code, corps) {
  const b = Buffer.alloc(6);
  b.writeUInt16LE((code << 6) | 0x3f, 0);
  b.writeUInt32LE(corps.length, 2);
  return Buffer.concat([b, corps]);
}

function principal() {
  const { sig, version, body } = lireSwf(SWF);
  if (body.indexOf(ACTIONS) >= 0) {
    console.log('déjà patché — rien à faire.');
    return;
  }

  // Une passe sur les tags : le DoInitAction (code 59) qui définit StatusMng
  // (son corps contient "internalList"), les DefineSprite (39) vus avant lui,
  // et les SpriteID déjà pris par un DoInitAction (les 2 premiers octets).
  const nbits = (body[0] >> 3) & 0x1f;
  let o = Math.ceil((5 + nbits * 4) / 8) + 4;
  let apres = -1, trouves = 0;
  const spritesAvant = [];
  const initsPris = new Set();
  while (o < body.length) {
    const hdr = body.readUInt16LE(o), code = hdr >> 6;
    let len = hdr & 0x3f, hs = 2;
    if (len === 0x3f) { len = body.readUInt32LE(o + 2); hs = 6; }
    if (code === 0) break;
    if (code === 39 && apres < 0) spritesAvant.push(body.readUInt16LE(o + hs));
    if (code === 59) {
      initsPris.add(body.readUInt16LE(o + hs));
      if (body.slice(o + hs, o + hs + len).indexOf('internalList') >= 0) {
        apres = o + hs + len;
        trouves++;
      }
    }
    o += hs + len;
  }
  if (trouves !== 1) throw new Error('DoInitAction de StatusMng : ' + trouves + ' candidat(s)');

  // Le porteur : le dernier sprite défini avant l'insertion qui n'a d'init
  // action nulle part — le nôtre sera donc le seul, et il compte.
  const porteur = spritesAvant.reverse().find((id) => !initsPris.has(id));
  if (porteur === undefined) throw new Error('aucun sprite vierge avant StatusMng');

  const idBuf = Buffer.alloc(2);
  idBuf.writeUInt16LE(porteur, 0);
  const TAG = tagLong(59, Buffer.concat([idBuf, ACTIONS]));

  const patche = Buffer.concat([body.slice(0, apres), TAG, body.slice(apres)]);
  fs.copyFileSync(SWF, SWF + '.avant-minipixiz');
  const taille = ecrireSwf(SWF, sig, version, patche);
  console.log('patché : +' + TAG.length + ' octets (DoInitAction, sprite porteur '
    + porteur + ') après le DoInitAction de StatusMng');
  console.log('→ ' + SWF + ' (' + taille + ' octets, sauvegarde .avant-minipixiz)');
}

principal();
