#!/usr/bin/env node
/*
 * Kit bande-annonce — section « jeux-a » : TOUT régénérer.
 *
 *   node scripts/kit-bande-annonce/jeux-a/tout.js [jeu…]
 *
 * Joue, l'un après l'autre, les scripts des six jeux puis celui des fenêtres
 * du bureau, et refait le manifeste de la section :
 *
 *   swapou.js      Swapou            (IA du jeu, partie rejouée à la graine)
 *   snake3.js      Frutisnake 3      (+ l'accueil de Frutisnake 2 VK)
 *   bkiwi.js       Burning Kiwi      (pilote automatique, voitures de l'IA)
 *   kaluga.js      Kaluga            (pilote de la tzongre)
 *   minifever.js   Mini-Fever        (joueur d'épreuves, vraie souris)
 *   minipixiz.js   MiniPixiz         (IA de l'arbre creux, journal au clavier)
 *   fenetres.js    les six jeux dans leur fenêtre du bureau Frutiz
 *
 * Chaque script se lance aussi seul (une commande par jeu), et accepte
 * --seul=<nom de plan> pour ne refaire qu'un plan. Le serveur local est
 * démarré au besoin (port 4200, sans base ; KIT_PORT pour en changer).
 * Les vidéos vont dans /home/user/Frutiparc/kit-bande-annonce/jeux-a/
 * (KIT_SORTIE pour en changer), les intermédiaires dans $TMPDIR/kit-jeux-a.
 *
 * Prérequis : Chromium + Playwright (require('playwright')), ffmpeg/ffprobe.
 */
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const K = require('./lib/commun');

const ORDRE = ['swapou', 'snake3', 'bkiwi', 'kaluga', 'minifever', 'minipixiz', 'fenetres'];

async function principal() {
  const demandes = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const liste = demandes.length ? ORDRE.filter((j) => demandes.includes(j)) : ORDRE;
  await K.serveur();
  const echecs = [];
  for (const jeu of liste) {
    console.log(`\n══ ${jeu} ══`);
    const r = spawnSync(process.execPath, [path.join(__dirname, jeu + '.js')], { stdio: 'inherit' });
    if (r.status !== 0) echecs.push(jeu);
  }
  K.refaireManifeste();
  K.arreterServeur();
  console.log(echecs.length ? `\nÉchecs : ${echecs.join(', ')}` : '\nTout est régénéré.');
  process.exit(echecs.length ? 1 : 0);
}

principal().catch((e) => { console.error(e); process.exit(1); });
