#!/usr/bin/env node
/*
 * KIT BANDE-ANNONCE / EXTRAS — VÉRIFICATION DES FICHIERS PRODUITS.
 *
 *   node scripts/kit-bande-annonce/extras/verifier.js [dossier-des-planches]
 *
 * Pour chaque élément du manifeste de la section (et ses variantes) :
 *   · le fichier existe et n'est pas vide ;
 *   · une vidéo : ffprobe (durée, cadence, définition, alpha), comparés au
 *     manifeste ; une vidéo FIGÉE se repère par l'écart moyen entre images
 *     (filtre ffmpeg `freezedetect` : on signale un gel de plus de 3 s) ;
 *     une vidéo NOIRE par `blackdetect` ;
 *   · si un dossier est donné, une planche contact de chaque vidéo (une image
 *     par seconde) y est écrite, pour un contrôle à l'œil.
 * Sortie : une ligne par fichier, et le total.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const C = require('./commun.js');

const planches = process.argv[2];
if (planches) fs.mkdirSync(planches, { recursive: true });

function analyse(f) {
  // freezedetect et blackdetect écrivent sur stderr.
  const r = require('child_process').spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', f, '-vf',
    'freezedetect=n=0.0005:d=3,blackdetect=d=1:pix_th=0.05', '-an', '-f', 'null', '-']);
  const log = String(r.stderr || '');
  const gels = (log.match(/freeze_duration: [0-9.]+/g) || []).map((s) => Number(s.split(': ')[1]));
  const noirs = (log.match(/black_duration:[0-9.]+/g) || []).map((s) => Number(s.split(':')[1]));
  return { gels, noirs };
}

let n = 0, problemes = 0, total = 0;
const m = C.lireManifeste();
for (const e of m.elements) {
  for (const rel of [e.fichier].concat(e.variantes || [], e.affiche ? [e.affiche] : [])) {
    const f = path.join(C.SORTIE, rel);
    n++;
    if (!fs.existsSync(f) || fs.statSync(f).size === 0) { console.log('ABSENT  ', rel); problemes++; continue; }
    total += fs.statSync(f).size;
    if (!/\.(mp4|webm)$/.test(rel)) continue;
    const s = C.sonder(f);
    const { gels, noirs } = analyse(f);
    const notes = [];
    if (rel === e.fichier && e.duree && Math.abs(s.duree - e.duree) > 0.2) notes.push('durée ' + s.duree + ' ≠ ' + e.duree);
    if (s.fps !== 60) notes.push('cadence ' + s.fps);
    if (/\.webm$/.test(rel) && !s.alpha) notes.push('pas d’alpha');
    if (gels.some((g) => g > 3)) notes.push('gelée ' + gels.map((g) => g.toFixed(1)).join('/') + ' s');
    if (noirs.length) notes.push('noire ' + noirs.map((g) => g.toFixed(1)).join('/') + ' s');
    console.log((notes.length ? 'ATTENTION' : 'ok       '), rel, s.largeur + '×' + s.hauteur, s.fps + ' i/s', s.duree + ' s',
      (s.octets / 1048576).toFixed(1) + ' Mo', notes.join(' ; '));
    if (notes.some((x) => !x.startsWith('gelée'))) problemes++;
    if (planches) {
      const out = path.join(planches, rel.replace(/[\/]/g, '__') + '.jpg');
      try {
        execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', f, '-vf',
          'fps=1,scale=384:-2,tile=8x2', '-frames:v', '1', '-q:v', '4', out]);
      } catch (err) { /* une vidéo trop courte pour la grille : tant pis */ }
    }
  }
}
console.log('\n' + n + ' fichiers vérifiés, ' + problemes + ' problème(s), ' + (total / 1048576).toFixed(0) + ' Mo au total.');
