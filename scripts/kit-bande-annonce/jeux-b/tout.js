#!/usr/bin/env node
/*
 * Kit bande-annonce, section « jeux-b » — TOUT régénérer.
 *
 *   node scripts/kit-bande-annonce/jeux-b/tout.js            # les cinq jeux, puis le manifeste
 *   node scripts/kit-bande-annonce/jeux-b/tout.js manifeste  # seulement le manifeste
 *   node scripts/kit-bande-annonce/jeux-b/tout.js miniwave jamajama   # quelques jeux
 *
 * Un jeu seul : node scripts/kit-bande-annonce/jeux-b/<jeu>.js
 * (miniwave, mb2, jamajama, grapiz, bandas — voir l'en-tête de chacun).
 *
 * Les fichiers produits vont dans /home/user/Frutiparc/kit-bande-annonce/jeux-b/
 * (hors git), un dossier par jeu ; chaque script y laisse un fragment
 * `elements.json`, que ce script fusionne en `manifest.json`.
 *
 * Le serveur du site est lancé au besoin sur le port 4300 (KIT_PORT), sans
 * base de données. Chromium, Playwright et ffmpeg doivent être installés.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const C = require('./commun');

const JEUX = ['miniwave', 'mb2', 'jamajama', 'grapiz', 'bandas'];

const TEXTE = 'Plans de jeu « attract mode » pour la bande-annonce : Mini-Wave, MotionBall 2, '
  + 'JamaJama, Grapiz et Frutibandas, filmés dans les vraies pages du site (portages JS natifs), '
  + 'en 1920×1080 à 60 images par seconde, sans son. Les parties sont jouées pour de bon : une IA '
  + 'd\'esquive pour Mini-Wave, une IA de navigation pour MotionBall, les solutions vérifiées par le '
  + 'moteur de règles pour JamaJama, et pour Grapiz et Frutibandas de vraies parties en ligne contre '
  + 'les bots du serveur, notre camp tenu par l\'IA du jeu lui-même. L\'horloge des pages est '
  + 'virtuelle et avance d\'exactement 1/60 s par image : la vitesse de jeu est la vraie, la '
  + 'fluidité parfaite. Pour chaque jeu : un écran-titre, des plans de 8 à 15 s, des plans maîtres '
  + 'plus longs où recouper, les affiches, la jaquette du disque et les sons du jeu (musique et '
  + 'bruitages, fichiers d\'origine).';

function ecrireManifeste() {
  const elements = [];
  for (const jeu of JEUX) {
    const f = path.join(C.SORTIE, jeu, 'elements.json');
    if (!fs.existsSync(f)) { console.warn('  pas de fragment pour', jeu); continue; }
    for (const e of JSON.parse(fs.readFileSync(f, 'utf8'))) {
      if (!fs.existsSync(path.join(C.SORTIE, e.fichier))) { console.warn('  fichier absent, ignoré :', e.fichier); continue; }
      elements.push(e);
    }
  }
  const manifeste = { section: 'jeux-b', titre: 'Jeux 2 — Mini-Wave, MotionBall 2, JamaJama, Grapiz, Frutibandas', texte: TEXTE, elements };
  fs.writeFileSync(path.join(C.SORTIE, 'manifest.json'), JSON.stringify(manifeste, null, 2) + '\n');
  console.log(`manifest.json : ${elements.length} éléments`);
}

(async () => {
  const demande = process.argv.slice(2);
  if (demande.length === 1 && demande[0] === 'manifeste') { ecrireManifeste(); return; }
  const jeux = demande.length ? JEUX.filter((j) => demande.includes(j)) : JEUX;
  await C.demarrerServeur();
  const nav = await C.ouvrirNavigateur();
  try {
    for (const jeu of jeux) {
      console.log(`── ${jeu}`);
      const M = require('./' + jeu);
      const elements = await M.generer(nav, []);
      C.ecrireFragment(jeu, elements);
    }
  } finally {
    await nav.close();
    C.arreterServeur();
  }
  ecrireManifeste();
})().catch((e) => { console.error(e); process.exit(1); });
