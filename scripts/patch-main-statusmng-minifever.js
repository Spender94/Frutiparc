#!/usr/bin/env node
// legacy/main.swf : le voyant « joue à Mini-Fever » du bureau.
//
//   node scripts/patch-main-statusmng-minifever.js
//
// Le code de statut diffusé dans la chaîne d'un joueur est un INDEX dans
// StatusMng.internalList, et l'affichage fait gotoAndStop(<nom>) sur la
// feuille d'icônes d'activité (clip 246). Pour Mini-Fever il manque LES DEUX :
// la liste s'arrête à miniwave (9) — la rustine de la fée a posé
// [12]="minipixiz" — et la feuille n'a pas d'image « minifever » (le jeu n'est
// jamais sorti). Deux rustines donc, chacune idempotente :
//
//   1. la LISTE — un DoInitAction de plus, juste après celui qui définit
//      StatusMng (il s'exécute au CHARGEMENT, dans l'ordre du flux — pas
//      besoin que l'image 10 s'affiche jamais) :
//
//          _global.StatusMng.internalList[13] = "minifever";
//
//      porté par un sprite sans init action nulle part (un seul DoInitAction
//      par sprite fait foi) — le porteur de la fée est déjà pris, le balayage
//      l'écarte de lui-même. Même mécanique que
//      patch-main-statusmng-minipixiz.js, commentaires détaillés là-bas.
//
//   2. le DESSIN — la feuille (36 images étiquetées, dessins ~17×17 centrés
//      sur l'origine, posés en translate(0,0), profondeurs 1/2 en
//      alternance ; l'image 36 « forum » laisse ch 245 en prof 1, la prof 2
//      vidée) : on greffe une image 37 au gabarit exact de ses voisines —
//      RemoveObject2(1) + FrameLabel("minifever") + PlaceObject2(2, forme) +
//      ShowFrame — la forme étant LES CERISES du jeu
//      (scripts/assets-minifever/voyant-34.png, bitmap 2× → boîte 17×17
//      centrée), définitions insérées avant le clip.
//
// Sauvegarde : legacy/main.swf.avant-minifever.

'use strict';

const fs = require('fs');
const path = require('path');
const G = require('./lib/swf-greffe.js');

const SWF = path.resolve(__dirname, '..', 'legacy', 'main.swf');
const PNG = path.resolve(__dirname, 'assets-minifever', 'voyant-34.png');
const CLIP = 246;                                  // la feuille d'icônes
const ETIQUETTE = 'minifever';
const INDEX = 13;                                  // internalList[13]

// ── Rustine 1 : le bytecode _global.StatusMng.internalList[13]="minifever" ──
const pousseChaine = (s) => Buffer.concat([
  Buffer.from([0x96, s.length + 2, 0x00, 0x00]),   // push, len, type 0
  Buffer.from(s, 'latin1'), Buffer.from([0x00]),
]);
const pousseEntier = (n) => {
  const b = Buffer.alloc(8);
  b[0] = 0x96; b[1] = 5; b[2] = 0; b[3] = 0x07;    // push, len 5, type 7
  b.writeUInt32LE(n >>> 0, 4);
  return b;
};
const ACTIONS = Buffer.concat([
  pousseChaine('_global'),
  Buffer.from([0x1c]),                             // getVariable
  pousseChaine('StatusMng'),
  Buffer.from([0x4e]),                             // getMember
  pousseChaine('internalList'),
  Buffer.from([0x4e]),                             // getMember
  pousseEntier(INDEX),
  pousseChaine(ETIQUETTE),
  Buffer.from([0x4f]),                             // setMember
  Buffer.from([0x00]),                             // end
]);

function rustineListe(body) {
  if (body.indexOf(ACTIONS) >= 0) {
    console.log('· liste : internalList[' + INDEX + '] déjà posé.');
    return body;
  }
  // Une passe : le DoInitAction de StatusMng — celui qui contient LES DEUX
  // listes ("internalList" ET "externalList" : la rustine de la fée, elle
  // aussi un DoInitAction, ne pousse que la première) —, les sprites définis
  // avant lui, les SpriteID déjà pris par un DoInitAction.
  let apres = -1, trouves = 0;
  const spritesAvant = [];
  const initsPris = new Set();
  G.parcourir(body, (code, o, h, len) => {
    if (code === 39 && apres < 0) spritesAvant.push(body.readUInt16LE(o + h));
    if (code === 59) {
      initsPris.add(body.readUInt16LE(o + h));
      const corps = body.slice(o + h, o + h + len);
      if (corps.indexOf('internalList') >= 0 && corps.indexOf('externalList') >= 0) {
        apres = o + h + len;
        trouves++;
      }
    }
  });
  if (trouves !== 1) throw new Error('DoInitAction de StatusMng : ' + trouves + ' candidat(s)');
  const porteur = spritesAvant.reverse().find((id) => !initsPris.has(id));
  if (porteur === undefined) throw new Error('aucun sprite vierge avant StatusMng');

  const idBuf = Buffer.alloc(2);
  idBuf.writeUInt16LE(porteur, 0);
  const tag = Buffer.concat([G.enteteTag(59, 2 + ACTIONS.length), idBuf, ACTIONS]);
  console.log('· liste : internalList[' + INDEX + ']="' + ETIQUETTE
    + '" (DoInitAction, sprite porteur ' + porteur + ').');
  return G.insererAvant(body, apres, tag);
}

// ── Rustine 2 : l'image « minifever » greffée à la feuille d'icônes ──
function rustineFeuille(body) {
  if (G.aEtiquette(body, ETIQUETTE)) {
    console.log('· feuille : étiquette « ' + ETIQUETTE + ' » déjà là.');
    return body;
  }
  const idBitmap = G.dernierId(body) + 1;
  const idForme = idBitmap + 1;
  const { tag: bmp, w, h } = G.tagBitmap(idBitmap, fs.readFileSync(PNG));
  const forme = G.tagFormeBitmap(idForme, idBitmap, w, h, 2);   // 34 px → boîte 17

  const sp = G.trouverSprite(body, CLIP);
  if (!sp) throw new Error('clip ' + CLIP + ' introuvable');
  let out = G.insererAvant(body, sp.offset, Buffer.concat([bmp, forme]));
  out = G.grefferDansSprite(out, CLIP, Buffer.concat([
    G.tagRemoveObject2(1),                         // le forum de l'image 36
    G.tagFrameLabel(ETIQUETTE),
    G.tagPlaceObject2(2, idForme),
    G.tagShowFrame(),
  ]));
  console.log('· feuille : image « ' + ETIQUETTE + ' » greffée au clip ' + CLIP
    + ' (bitmap ' + idBitmap + ', forme ' + idForme + ').');
  return out;
}

function patch() {
  const { sig, version, body } = G.lireSwf(SWF);
  let out = rustineListe(body);
  out = rustineFeuille(out);
  if (out === body) {
    console.log('rien à faire.');
    return;
  }
  if (!fs.existsSync(SWF + '.avant-minifever')) fs.copyFileSync(SWF, SWF + '.avant-minifever');
  const taille = G.ecrireSwf(SWF, sig, version, out);
  console.log('→ ' + SWF + ' (' + taille + ' octets, sauvegarde .avant-minifever)');
}

patch();
