#!/usr/bin/env node
/*
 * Sortir du swapou.swf les pièces de la PARTIE (mode Challenge) que le portage
 * dessinait de mémoire : le « max ! » de la jauge d'étoiles, les deux images
 * des fonds de visage animés, et les deux fontes des chiffres.
 *
 *   node scripts/extract-swapou-jeu.js
 *
 * Tout ce qui est petit et vectoriel (particules, disque d'explosion, étoile
 * blanche, plaques du score flottant, reflets des fruits, rayons) est repris
 * directement en chemins canvas dans ui.js — voir FORMES —, parce qu'il faut
 * les découper, les teinter ou les masquer image par image, ce qu'une image
 * chargée ne permet pas. Ici, seulement ce qui se pose tel quel :
 *
 *   #370  « max ! »               forme vectorielle bicolore (39,75 × 13,25),
 *                                 origine au centre — le clip maxIndicator
 *   bitmap #215  la SPIRALE       163 × 153, fond « touché » du visage
 *   bitmap #219  le SOLEIL        360 × 360, fond « joie » (roue qui tourne)
 *                                 et fond « colère » (teinté, sous les rayons)
 *   font 28  « cipher »           les chiffres du score, sur le parchemin
 *   font 53  « DooM »             le compte de la chaîne, le score flottant,
 *                                 le compteur du blocage
 *
 * Même retouche que pour le menu : le filet d'épaisseur nulle du SWF est un
 * pixel à l'écran.
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
  [370, 'max.svg'],
];
const BITMAPS = [
  [215, 'spirale.png'],
  [219, 'soleil.png'],
];
const POLICES = [
  [28, 'cipher.woff', 'Cipher SW'],
  [53, 'doom.woff', 'DooM SW'],
];

function node(script, args) {
  execFileSync(process.execPath, [path.join(__dirname, script)].concat(args), { stdio: 'inherit' });
}

fs.mkdirSync(UI, { recursive: true });
fs.mkdirSync(FONTES, { recursive: true });

const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'swapou-jeu-'));
node('extract-swf-shapes.js', [SWF, tmp].concat(FORMES.map(([id]) => String(id))));
for (const [id, nom] of FORMES) {
  const svg = fs.readFileSync(path.join(tmp, `shape${id}.svg`), 'utf8')
    .replace(/stroke-width="0\.05"/g, 'stroke-width="1"');
  fs.writeFileSync(path.join(UI, nom), svg);
  console.log(`  → public/swapou/ui/${nom}`);
}
node('extract-swf-bitmaps.js', [SWF, tmp].concat(BITMAPS.map(([id]) => String(id))));
for (const [id, nom] of BITMAPS) {
  fs.copyFileSync(path.join(tmp, `bitmap${id}.png`), path.join(UI, nom));
  console.log(`  → public/swapou/ui/${nom}`);
}
fs.rmSync(tmp, { recursive: true, force: true });

for (const [id, nom, famille] of POLICES)
  node('extract-swf-font.js', [SWF, String(id), path.join(FONTES, nom), famille]);
