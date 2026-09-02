#!/usr/bin/env node
/*
 * Regrouper les dessins de Frutisnake en LOTS.
 *
 *   node scripts/build-snake3-lots.js
 *
 * Le jeu est fait de 1 247 fichiers SVG (10 Mo, 577 ko sur le fil une fois
 * compressés), chargés UN PAR UN par le client : à six connexions et quarante
 * millisecondes d'aller-retour, l'arène mettait huit secondes et demie à
 * venir la première fois, quatorze au téléphone — mesuré depuis le bureau du
 * light (scratchpad/perf-snake.js). Le temps était proportionnel au NOMBRE de
 * requêtes, pas au poids : le cache une fois chaud (sept jours, immutable),
 * il restait 1,8 s de lecture des SVG sur le fil principal.
 *
 * Ce script range les fichiers en cinq lots JSON — { "fichier.svg": "<svg…>" }
 * — que le client tire en une requête chacun et dont il fait des images
 * depuis des blobs (dessin.js, chargerLot) :
 *
 *   menu      ce que le menu et les écrans annexes dessinent, attendu AVANT
 *             d'ouvrir le jeu (le rideau ne s'ouvre pas sans lui)
 *   arene     ce que l'arène dessine — attendu par le rideau de transition
 *             qui mène au jeu : les 60 premiers fruits (FRUIT_BASE), les
 *             pourris, les options, les six écrans réellement affichés (sur
 *             140 dans le SWF), les chiffres, la tête, la bombe, la langue…
 *   fruits2   les fruits 61 à 449 — la frutibarre les fait venir plus tard
 *             dans la partie, et l'encyclopéfruit les feuillette ; chargé en
 *             fond dès que l'arène est là
 *   suites    les suites d'animation (fioles qui ballottent, ciseaux qui
 *             claquent, cases) — 345 fichiers, la moitié du poids ; le jeu
 *             joue l'image figée tant qu'elles ne sont pas là
 *   encyclo   le livre de l'encyclopéfruit, chargé en fond après le reste
 *
 * Chaque lot prend l'EMPREINTE de son contenu dans son nom (lots/menu.a1b2c3d4
 * .json) : il se sert avec le cache long du dossier des sprites, et un lot
 * regénéré a un autre nom — plus de « discipline ?v= » à tenir. Le petit
 * fichier public/snake3/lots.js, lui, est servi sans cache long : il dit au
 * client quels lots charger, et c'est lui qui change.
 *
 * Ce qui ne rentre dans aucun lot reste servi fichier par fichier, comme avant
 * (le client retombe dessus tout seul) : ce sont des reliquats de
 * l'extraction, listés en fin d'exécution.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RACINE = path.join(__dirname, '..');
const SPRITES = path.join(RACINE, 'public', 'snake3', 'sprites');
const LOTS = path.join(SPRITES, 'lots');
const manifeste = JSON.parse(fs.readFileSync(path.join(SPRITES, 'sprites.json'), 'utf8'));

// FRUIT_BASE (const.js) : les identifiants tirés en début de partie.
const C = require(path.join(RACINE, 'public', 'snake3', 'const.js'));
const FRUITS_DEPART = C.FRUIT_BASE;
const POURRI_DE = 321, POURRI_A = 321 + C.FRUIT_POURRIS_MAX;
// Les écrans que le client affiche (game.js, ECRANS) : pause=1, gameOver=7,
// connexion=15, resultat=24, fruit=32, text=39. La pause vient de `screens`,
// tout le reste de `screensSans` (la version sans panneau).
const ECRANS_SANS = [1, 7, 15, 24, 32, 39];

const images = (cle, garde) => {
  const clip = manifeste.clips[cle];
  if (!clip) throw new Error('clip inconnu : ' + cle);
  const out = [];
  for (const [n, f] of Object.entries(clip.frames)) {
    if (garde && !garde(Number(n))) continue;
    out.push(f.fichier);
  }
  return out;
};
const suites = (cle) => {
  const out = [];
  for (const f of Object.values(manifeste.clips[cle].frames)) {
    if (f.anim) for (const a of f.anim) out.push(a.fichier);
  }
  return out;
};

const LOTS_CONTENU = {
  menu: [].concat(
    ...['menu', 'title', 'menuBackground', 'fleche', 'optionPanel', 'pan',
      'background', 'snakeMask', 'barSide', 'barMid', 'fbarre', 'barreScore', 'slot'].map((k) => images(k)),
    // Les pièces hors clip que l'arène dessine dès sa première image : le
    // terrain, et les six morceaux de la frutibarre (cadres.fbarre.pieces).
    ['backgroundBord.svg', 'backgroundField.svg'],
    manifeste.cadres.fbarre.pieces.map((p) => p.fichier)),
  arene: [].concat(
    images('screens', (n) => n === 1),
    images('screensSans', (n) => ECRANS_SANS.includes(n)),
    images('fruits', (n) => n <= FRUITS_DEPART || (n >= POURRI_DE && n <= POURRI_A)),
    ...['options', 'tete', 'chiffresVert', 'chiffresRouge', 'chiffresJaune', 'qparticule',
      'bombe', 'sonnette', 'langue', 'trou', 'beurk'].map((k) => images(k))),
  fruits2: images('fruits', (n) => !(n <= FRUITS_DEPART || (n >= POURRI_DE && n <= POURRI_A))),
  suites: [].concat(suites('options'), suites('slot')),
  encyclo: [].concat(
    ...['page', 'pageSans', 'dropCorner', 'dropLarge', 'bookBase', 'bookHole', 'bookMask',
      'fleche2', 'fruitOuter', 'bonusOuter'].map((k) => images(k)),
    ['pageGrad.svg']),
};

fs.mkdirSync(LOTS, { recursive: true });
for (const f of fs.readdirSync(LOTS)) if (f.endsWith('.json')) fs.unlinkSync(path.join(LOTS, f));

const empreinte = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);
const index = { lots: {}, tailles: {} };
const ranges = new Set();
for (const [nom, fichiers] of Object.entries(LOTS_CONTENU)) {
  const lot = {};
  let octets = 0;
  for (const f of fichiers) {
    if (lot[f]) continue;
    if (ranges.has(f)) throw new Error(f + ' est dans deux lots');
    ranges.add(f);
    const svg = fs.readFileSync(path.join(SPRITES, f), 'utf8');
    lot[f] = svg;
    octets += svg.length;
  }
  const texte = JSON.stringify(lot);
  const nomFichier = nom + '.' + empreinte(texte) + '.json';
  fs.writeFileSync(path.join(LOTS, nomFichier), texte);
  index.lots[nom] = 'lots/' + nomFichier;
  index.tailles[nom] = { fichiers: Object.keys(lot).length, ko: Math.round(octets / 1024) };
  console.log(`  ${nom.padEnd(8)} ${String(Object.keys(lot).length).padStart(4)} fichiers  ${String(Math.round(octets / 1024)).padStart(5)} ko  → lots/${nomFichier}`);
}
// Le manifeste, versionné par son empreinte : le client le demande avec ?v=.
index.manifeste = 'sprites.json?v=' + empreinte(fs.readFileSync(path.join(SPRITES, 'sprites.json')));

const restes = fs.readdirSync(SPRITES).filter((f) => f.endsWith('.svg') && !ranges.has(f));
console.log(`  hors lot : ${restes.length} fichier(s)` + (restes.length ? ' — ' + restes.slice(0, 12).join(', ') + (restes.length > 12 ? '…' : '') : ''));

const js = '// Généré par scripts/build-snake3-lots.js — ne pas éditer à la main.\n'
  + '// Les lots de dessins (nom → chemin sous /snake3/sprites/, empreinte comprise)\n'
  + '// et le manifeste versionné. Sans ce fichier, le client charge les SVG un par un.\n'
  + 'window.SnakeLots = ' + JSON.stringify(index, null, 2) + ';\n';
fs.writeFileSync(path.join(RACINE, 'public', 'snake3', 'lots.js'), js);
console.log('  → public/snake3/lots.js');
