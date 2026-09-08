#!/usr/bin/env node
'use strict';
/*
 * LES PRUNELLES D'HIKO
 * ════════════════════
 *
 * L'iris d'une frutibouille, c'est le clip `p` de `oa.o` (et `ob.o`) : un
 * simple ROULEAU que `Moteur.definir` cale par `gotoAndStop(eyeSc + 1)`. La
 * famille 0 en a dix-huit images — dix-huit paires d'yeux.
 *
 * Hiko (famille 12) en a dix-neuf, et ses deux PREMIÈRES ne ressemblent à
 * rien de ce que le parc connaît :
 *
 *   · l'image 1 est un iris ROUGE ET NOIR, fixe ;
 *   · l'image 2 porte un CLIP de vingt images — un iris qui TOURNE.
 *
 * Ce script les récolte pour qu'on puisse les greffer au bout du rouleau de
 * n'importe quelle famille. Il n'emporte que ce qu'il faut : les ordres de
 * pose de ces deux images, et la fermeture des caractères qu'ils désignent
 * (cinq formes et un clip).
 *
 * DEUX PRÉCAUTIONS.
 *
 *   LES NUMÉROS SONT RÉÉCRITS. #418 est un morceau d'iris chez hiko et tout
 *   autre chose dans la famille 0. On décale la récolte au-delà de la plage
 *   d'un SWF (300 000), et plus rien ne peut se marcher dessus.
 *
 *   L'INDEX EST FIGÉ ICI, pas calculé à la volée. Une bouille qui porte une
 *   prunelle la désigne par un NUMÉRO dans le rouleau (`eyeSc`), inscrit dans
 *   sa chaîne d'état et vendu comme tel en boutique : il doit vouloir dire la
 *   même chose sur tous les écrans, pour toujours. On relève donc la longueur
 *   du rouleau de la famille 0 au moment de la récolte, et l'on écrit les
 *   index obtenus dans le paquet. La greffe les respecte — elle comble au
 *   besoin —, quelle que soit la famille d'accueil.
 *
 * CE QU'ON N'EMPORTE PAS : les ordres de RETRAIT. Une image de rouleau ne
 * pose pas tout, elle MODIFIE ce que la précédente a laissé ; ce qu'il faut
 * retirer dépend donc de la famille d'accueil, qui seule sait ce que sa
 * dernière image laisse en place. C'est la greffe qui le calcule.
 *
 *   node scripts/extract-prunelles-bouille.js
 *   → public/fbouille/prunelles.json
 */

const fs = require('node:fs');
const path = require('node:path');
const Swf = require('../public/js/bouille-swf.js');
const Moteur = require('../public/js/bouille-moteur.js');

const ROOT = path.join(__dirname, '..');
const DOSSIER = path.join(ROOT, 'public/fbouille');
const SORTIE = path.join(DOSSIER, 'prunelles.json');

// Le décalage des identifiants récoltés : au-delà de ce qu'un SWF peut porter,
// et distinct de celui des émotes (100 000) pour qu'on lise d'où vient un
// numéro rien qu'à sa taille.
const DECALAGE = 300000;

// Les deux images d'hiko qu'on emporte, dans l'ordre où elles paraîtront.
const RECOLTE = [
  { image: 1, cle: 'hiko1', nom: "Hiko's eyes",
    description: 'Les prunelles rouge et noir de hiko.' },
  { image: 2, cle: 'hiko2', nom: "Hiko's eyes #2",
    description: 'Les prunelles animées de hiko — elles tournent.' },
];

function lire(fichier) {
  const b = fs.readFileSync(path.join(DOSSIER, fichier));
  return Swf.decompresser(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)).then(Swf.lire);
}

// Ce qu'un rouleau laisse posé à l'image n : profondeur → ordre de pose.
function etatA(sp, n) {
  const par = new Map();
  for (let i = 1; i <= n && i <= sp.images.length; i++) {
    (sp.images[i - 1] || []).forEach((o) => {
      if (o.t === 'retire') par.delete(o.prof);
      else if (o.t === 'pose') par.set(o.prof, o);
    });
  }
  return par;
}

// Tout ce qu'un caractère entraîne : lui, ses sous-clips, leurs formes.
function fermeture(defs, ch, vus) {
  vus = vus || new Set();
  if (vus.has(ch)) return vus;
  vus.add(ch);
  const sp = defs.sprites.get(ch);
  if (!sp) return vus;
  (sp.images || []).forEach((im) => (im || []).forEach((o) => {
    if (o.ch !== undefined && o.ch !== null && o.ch >= 0) fermeture(defs, o.ch, vus);
  }));
  return vus;
}

// La récolte : les formes et les clips d'une fermeture, renumérotés.
function recolter(defs, racines) {
  const tout = new Set();
  racines.forEach((ch) => fermeture(defs, ch, tout));
  const formes = {}, sprites = {};
  for (const ch of tout) {
    const neuf = DECALAGE + ch;
    if (defs.formes.has(ch)) { formes[neuf] = defs.formes.get(ch); continue; }
    const sp = defs.sprites.get(ch);
    if (!sp) continue;
    sprites[neuf] = {
      n: sp.n,
      labels: sp.labels || {},
      // Les scripts d'image ne se recopient pas : un `stop()` d'hiko figerait
      // l'iris animé, dont tout l'intérêt est de tourner.
      images: (sp.images || []).map((im) => (im || [])
        .filter((o) => o.t !== 'script')
        .map((o) => (o.ch !== undefined && o.ch !== null && o.ch >= 0
          ? Object.assign({}, o, { ch: DECALAGE + o.ch }) : o))),
    };
  }
  return { formes, sprites };
}

(async () => {
  const d0 = await lire('famille0.swf');
  const d12 = await lire('famille12.swf');

  const rouleaux0 = Moteur.rouleauxIris(d0);
  const rouleaux12 = Moteur.rouleauxIris(d12);
  if (!rouleaux0.length) throw new Error('famille 0 : rouleau d’iris introuvable');
  if (!rouleaux12.length) throw new Error('famille 12 : rouleau d’iris introuvable');
  const p0 = rouleaux0[0], p12 = rouleaux12[0];
  console.log('rouleau d’iris — famille 0 : ' + p0.n + ' images, hiko : ' + p12.n);

  const racines = new Set();
  const iris = [];
  RECOLTE.forEach((r, k) => {
    const venu = etatA(p12, r.image);
    if (!venu.size) throw new Error('hiko : rien de posé à l’image ' + r.image);
    for (const [, o] of venu) if (o.ch >= 0) racines.add(o.ch);
    iris.push({
      cle: r.cle, nom: r.nom, description: r.description,
      // L'index DÉFINITIF dans le rouleau : la longueur d'origine du rouleau
      // de la famille 0, plus le rang de récolte.
      index: p0.n + k,
      ordres: [...venu.values()].map((o) => Object.assign({}, o, {
        ch: o.ch >= 0 ? o.ch + DECALAGE : o.ch,
      })),
    });
  });

  const recolte = recolter(d12, racines);
  const paquet = {
    source: {
      iris: 'famille12.swf, oa.o.p, images ' + RECOLTE.map((r) => r.image).join(' et '),
      hote: 'famille0.swf, oa.o.p, ' + p0.n + ' images d’origine',
      outil: 'scripts/extract-prunelles-bouille.js',
      decalage: DECALAGE,
    },
    formes: recolte.formes,
    sprites: recolte.sprites,
    iris,
  };

  fs.writeFileSync(SORTIE, JSON.stringify(paquet));
  const ko = Math.round(fs.statSync(SORTIE).size / 102.4) / 10;
  console.log('récolté : ' + Object.keys(recolte.formes).length + ' forme(s), '
    + Object.keys(recolte.sprites).length + ' clip(s)');
  iris.forEach((i) => console.log('   ' + i.cle + ' « ' + i.nom + ' » → eyeSc ' + i.index
    + ' (' + i.ordres.length + ' pose(s))'));
  console.log('écrit : ' + path.relative(ROOT, SORTIE) + ' (' + ko + ' Ko)');
})().catch((e) => { console.error(e); process.exit(1); });
