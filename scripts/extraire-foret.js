'use strict';
/*
 * LA FORÊT DE GROMELIN — l'extrait des sprites de MiniPixiz dont a besoin la
 * fenêtre des quêtes : le paysage de l'écran-titre (ses neuf plans et leurs
 * ancrages), les nuages, les lieux posés dessus (la cabane, l'arbre creux, le
 * moulin, le donjon) et la planche aux lianes de l'enseigne. Le fichier
 * complet pèse 350 Ko ; la fenêtre n'en lit qu'une petite part.
 *
 *   node scripts/extraire-foret.js
 *
 * À relancer si public/minipixiz/sprites/sprites.json change.
 */
const fs = require('fs');
const path = require('path');

const SYMBOLES = ['horizon', 'collines', 'foret3', 'foret2', 'foret', 'milieu', 'arbre', 'herbe', 'premier',
  'nuage', 'mCabane', 'mArbre', 'mMoulin', 'mDonjon', 'invMessage'];

const D = path.join(__dirname, '..', 'public', 'minipixiz', 'sprites');
const tout = JSON.parse(fs.readFileSync(path.join(D, 'sprites.json'), 'utf8'));
const extrait = {};
for (const s of SYMBOLES) {
  if (!tout[s]) throw new Error('symbole absent de sprites.json : ' + s);
  const v = tout[s];
  // Une seule image par symbole (la première), sauf les nuages (trois formes).
  const etats = s === 'nuage' ? v.etats : v.etats.slice(0, 1);
  extrait[s] = Object.assign({}, v.ancrages ? { ancrages: v.ancrages } : {}, {
    etats: etats.map((e) => ({ frame: e.frame, pieces: e.pieces.map((p) => ({ fichier: p.fichier, x: p.x, y: p.y, w: p.w, h: p.h, vb: p.vb, m: p.m })) })),
  });
}
const sortie = path.join(D, 'foret.json');
fs.writeFileSync(sortie, JSON.stringify(extrait) + '\n');
console.log(`foret.json : ${SYMBOLES.length} symboles, ${fs.statSync(sortie).size} octets`);
