#!/usr/bin/env node
// public/fileIcon.swf : donne au disque Mini-Fever SA jaquette sur le bureau.
//
//   node scripts/patch-fileicon-minifever.js
//
// Le visuel d'un FrusionDisc est choisi par fileIcon.swf : le clip 81 est la
// feuille des illustrations de jeux, une image étiquetée par nom (snake,
// kaluga, bkiwi… miniwave, minipixiz), et `gotoAndStop(<iconName>)` fait le
// choix. « minifever » n'y est pas — le jeu n'existait pas quand la feuille a
// été gravée — et tout nom inconnu retombe sur la première image : le disque
// du snake, à contre-sens de la jaquette qu'affiche le light.
//
// On greffe donc une image de plus au clip 81, sur le gabarit exact de ses
// voisines (RemoveObject2 prof 1 + FrameLabel + PlaceObject2 prof 1 +
// ShowFrame) : l'étiquette « minifever », et pour dessin LA MÊME JAQUETTE que
// le light — fd_minifever.svg rendue en bitmap 2× (scripts/assets-minifever/
// disque-122.png, via make-minifever-emblemes.js), posée dans la boîte 61×61
// des illustrations voisines. Idempotente : l'étiquette présente, rien ne bouge.

const fs = require('fs');
const path = require('path');
const G = require('./lib/swf-greffe.js');

const SWF = path.resolve(__dirname, '..', 'public', 'fileIcon.swf');
const PNG = path.resolve(__dirname, 'assets-minifever', 'disque-122.png');
const CLIP = 81;                                   // la feuille des illustrations
const ETIQUETTE = 'minifever';

function patch() {
  const { sig, version, body } = G.lireSwf(SWF);
  if (G.aEtiquette(body, ETIQUETTE)) {
    console.log('fileIcon.swf porte déjà « ' + ETIQUETTE + ' » — rien à faire.');
    return;
  }
  const idBitmap = G.dernierId(body) + 1;
  const idForme = idBitmap + 1;
  const { tag: bmp, w, h } = G.tagBitmap(idBitmap, fs.readFileSync(PNG));
  const forme = G.tagFormeBitmap(idForme, idBitmap, w, h, 2);   // 122 px → boîte 61

  // Les définitions AVANT le clip qui s'en sert.
  const sp = G.trouverSprite(body, CLIP);
  if (!sp) throw new Error('clip ' + CLIP + ' introuvable');
  let out = G.insererAvant(body, sp.offset, Buffer.concat([bmp, forme]));

  // L'image greffée, au bout de la pellicule du clip.
  out = G.grefferDansSprite(out, CLIP, Buffer.concat([
    G.tagRemoveObject2(1),
    G.tagFrameLabel(ETIQUETTE),
    G.tagPlaceObject2(1, idForme),
    G.tagShowFrame(),
  ]));

  const taille = G.ecrireSwf(SWF, sig, version, out);
  console.log(`+ image « ${ETIQUETTE} » (bitmap ${idBitmap}, forme ${idForme}) — fileIcon.swf : ${taille} octets.`);
}

patch();
