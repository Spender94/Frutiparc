#!/usr/bin/env node
/*
 * Sortir du swapou.swf les pièces du MENU que le portage light dessinait « à
 * peu près » : les deux plaques de bouton, la plaque de titre, et les deux
 * fontes des libellés.
 *
 *   node scripts/extract-swapou-menu.js
 *
 * Pourquoi : le menu et l'écran de choix de personnage étaient redessinés au
 * jugé (une barre de bois découpée dans levelBox.png, du texte vert, des cases
 * vertes à bord doré). L'original n'a rien de tout ça — il a des plaques
 * vectorielles vert/orange à dégradé, et des libellés blancs en « PT Banana
 * Split ». Ces tracés SONT dans le SWF ; il suffit de les prendre.
 *
 * Les identifiants ci-dessous ont été trouvés avec inspect-swf.js / les deux
 * extracteurs génériques :
 *
 *   #202  plaque de bouton VERTE   (161,45 × 34,80, origine au centre)
 *   #204  plaque de bouton ORANGE  (idem — c'est la frame 2 de sub, le « retour »)
 *   #358  plaque de TITRE          (197,95 × 28,30)
 *   font 23  « PT Banana Split »   — libellés des boutons et des titres
 *   font 335 « Impact »            — barre d'aide en haut de l'écran
 *
 * Une seule retouche est appliquée aux SVG : les contours du SWF ont une
 * épaisseur NULLE, ce que Flash rend en filet d'un pixel. L'extracteur écrit
 * 0.05 pour ne pas perdre le trait ; on le remet à 1, ce que le lecteur Flash
 * affichait réellement.
 */
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const SWF = path.join(RACINE, 'Games', 'swapou2', 'swapou.swf');
const UI = path.join(RACINE, 'public', 'swapou', 'ui');
const FONTES = path.join(RACINE, 'public', 'swapou', 'fontes');

const FORMES = [
  [202, 'bouton-vert.svg'],
  [204, 'bouton-orange.svg'],
  [358, 'titre.svg'],
];
const POLICES = [
  [23, 'banana.woff', 'PT Banana Split'],
  [335, 'impact.woff', 'Impact SW'],
];

function node(script, args) {
  execFileSync(process.execPath, [path.join(__dirname, script)].concat(args), { stdio: 'inherit' });
}

fs.mkdirSync(UI, { recursive: true });
fs.mkdirSync(FONTES, { recursive: true });

const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'swapou-menu-'));
node('extract-swf-shapes.js', [SWF, tmp].concat(FORMES.map(([id]) => String(id))));
for (const [id, nom] of FORMES) {
  const src = path.join(tmp, `shape${id}.svg`);
  // Filet de Flash : épaisseur 0 = un pixel à l'écran.
  const svg = fs.readFileSync(src, 'utf8').replace(/stroke-width="0\.05"/g, 'stroke-width="1"');
  fs.writeFileSync(path.join(UI, nom), svg);
  console.log(`  → public/swapou/ui/${nom}`);
}
fs.rmSync(tmp, { recursive: true, force: true });

for (const [id, nom, famille] of POLICES)
  node('extract-swf-font.js', [SWF, String(id), path.join(FONTES, nom), famille]);
