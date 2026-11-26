#!/usr/bin/env node
/*
 * Kit bande-annonce, section jeux-b — VÉRIFICATION des fichiers produits.
 *
 *   node scripts/kit-bande-annonce/jeux-b/verifier.js [dossier-planches]
 *
 * Pour chaque vidéo du manifeste : ffprobe (taille, cadence, durée, nombre
 * d'images), recherche d'images noires (blackdetect) et de passages figés
 * de plus de 3 s (freezedetect), et — si un dossier est donné — une
 * planche-contact de six images pour l'œil. Les images et les sons : taille
 * et durée. Rien n'est modifié.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const C = require('./commun');

const planches = process.argv[2] || null;
if (planches) fs.mkdirSync(planches, { recursive: true });
const m = JSON.parse(fs.readFileSync(path.join(C.SORTIE, 'manifest.json'), 'utf8'));
let problemes = 0, octets = 0;
for (const e of m.elements) {
  const f = path.join(C.SORTIE, e.fichier);
  if (!fs.existsSync(f)) { console.log('ABSENT ', e.fichier); problemes++; continue; }
  const taille = fs.statSync(f).size;
  octets += taille;
  const mo = (taille / 1048576).toFixed(1) + ' Mo';
  if (e.type !== 'video') {
    console.log(`${e.type.padEnd(6)} ${e.fichier.padEnd(44)} ${mo}${e.duree ? '  ' + e.duree + ' s' : ''}`);
    continue;
  }
  const s = C.sonde(f);
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', f, '-vf', 'blackdetect=d=0.5:pix_th=0.05,freezedetect=n=0.0005:d=3', '-an', '-f', 'null', '-'], { encoding: 'utf8' });
  const noirs = (r.stderr.match(/black_start/g) || []).length;
  const figes = (r.stderr.match(/freeze_start/g) || []).length;
  const ok = s.largeur === 1920 && s.hauteur === 1080 && s.fps === 60;
  if (!ok || noirs) problemes++;
  console.log(`video  ${e.fichier.padEnd(44)} ${mo.padStart(8)}  ${s.largeur}x${s.hauteur} ${s.fps} i/s ${String(s.duree).padStart(7)} s ${s.images} img`
    + (noirs ? `  NOIR×${noirs}` : '') + (figes ? `  figé>3s×${figes}` : '') + (ok ? '' : '  FORMAT ?'));
  if (planches) C.planche(f, path.join(planches, e.fichier.replace(/[\/]/g, '_') + '.png'), 6);
}
console.log(`\n${m.elements.length} éléments, ${(octets / 1048576).toFixed(0)} Mo, ${problemes} problème(s).`);
