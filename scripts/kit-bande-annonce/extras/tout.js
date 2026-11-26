#!/usr/bin/env node
/*
 * KIT BANDE-ANNONCE / EXTRAS — TOUT RÉGÉNÉRER, D'UNE COMMANDE.
 *
 *   node scripts/kit-bande-annonce/extras/tout.js
 *
 * Dans l'ordre, chacun pouvant aussi se lancer seul :
 *
 *   statiques.js   logos, polices (TTF + WOFF + spécimens), palette     ~10 s
 *   moments.js     connexion, bureau, accueil mobile, pictos, forum     ~15 min
 *   editeur.js     « Crée ta bouille » : le vrai éditeur + la bouille seule ~5 min
 *   stickers.js    8 humeurs + 21 émotes × 9 personnages               ~1 h et plus
 *   ../index.js    la page d'index de TOUT le kit (toutes les sections)
 *
 * (durées sur une machine libre ; elles s'allongent beaucoup sur une machine
 * partagée.) Prérequis : `npm ci`, Chromium et Playwright, ffmpeg, et le
 * Postgres de test sur 127.0.0.1:5433 (commun.js le démarre et y crée la base
 * kit_extras s'il le faut). Le serveur du parc est lancé sur le port 4400 par
 * commun.js, ou réutilisé s'il y tourne déjà.
 *
 * Les fichiers vont dans KIT_DIR/extras (par défaut
 * /home/user/Frutiparc/kit-bande-annonce/extras), hors du dépôt.
 */
'use strict';

const path = require('path');
const { execFileSync } = require('child_process');

const ETAPES = ['statiques.js', 'moments.js', 'editeur.js', 'stickers.js', path.join('..', 'index.js')];

for (const e of ETAPES) {
  const t0 = Date.now();
  console.log('▶', e);
  execFileSync(process.execPath, [path.join(__dirname, e)], { stdio: 'inherit' });
  console.log('✔', e, Math.round((Date.now() - t0) / 1000) + ' s');
}
