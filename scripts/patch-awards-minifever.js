#!/usr/bin/env node
// public/awards.swf : donne à Mini-Fever sa vignette de médaille.
//
//   node scripts/patch-awards-minifever.js
//
// awards.swf est la pellicule des vignettes : une image par jeu, étiquetée,
// choisie par gotoAndStop(<jeu>) — et le tableau des scores du bureau demande
// l'étiquette « minifever » dès que le classement existe (main.swf construit
// `frame: currentRanking.game`). Sans elle : le disque vert vide.
//
// Le jeu n'est jamais sorti, il n'a pas de vignette d'époque — mais on ne
// DESSINE rien : on pioche dans les sets gravés que plus aucun classement
// n'utilise, comme MiniPixiz emprunte celui de Tris (patch-awards-vignettes).
// L'élu est « tubulo », le plateau de capsules : Tubulo est justement l'une
// des épreuves de Mini-Fever (les pistons) — la vignette d'époque représente
// déjà une scène du jeu. Une image de pellicule peut porter PLUSIEURS
// étiquettes : on ajoute « minifever » sur l'image de « tubulo », juste avant
// son ShowFrame — aucun dessin ajouté, aucune image déplacée, et la bague de
// métal (« ico », colorée au rang) est celle du set, intacte. Le jour où une
// vraie vignette existe, elle prendra la place de l'emprunt sans que rien
// d'autre ne bouge.
//
// Idempotente : l'étiquette présente, rien ne bouge.

const fs = require('fs');
const path = require('path');
const G = require('./lib/swf-greffe.js');

const SWF = path.resolve(__dirname, '..', 'public', 'awards.swf');
const ETIQUETTE = 'minifever';
const EMPRUNT = 'tubulo';                          // le set inutilisé qu'on reprend

function patch() {
  const { sig, version, body } = G.lireSwf(SWF);
  if (G.aEtiquette(body, ETIQUETTE)) {
    console.log('awards.swf porte déjà « ' + ETIQUETTE + ' » — rien à faire.');
    return;
  }

  // Le ShowFrame de l'image étiquetée « tubulo » : l'alias s'insère juste
  // avant, il appartient donc à cette image-là.
  let dansEmprunt = false, finImage = -1;
  G.parcourir(body, (code, o, h, len) => {
    if (code === 43) {
      const fin = body.indexOf(0, o + h);
      dansEmprunt = body.slice(o + h, fin).toString('latin1') === EMPRUNT;
    }
    if (code === 1 && dansEmprunt) { finImage = o; return false; }
  });
  if (finImage < 0) throw new Error('image « ' + EMPRUNT + ' » introuvable');

  const out = G.insererAvant(body, finImage, G.tagFrameLabel(ETIQUETTE));
  const taille = G.ecrireSwf(SWF, sig, version, out);
  console.log(`+ étiquette « ${ETIQUETTE} » sur l'image de « ${EMPRUNT} » — awards.swf : ${taille} octets.`);
}

patch();
