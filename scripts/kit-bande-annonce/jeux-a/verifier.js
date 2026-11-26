#!/usr/bin/env node
/*
 * Kit bande-annonce — section « jeux-a » : la VÉRIFICATION des sorties.
 *
 *   node scripts/kit-bande-annonce/jeux-a/verifier.js [dossier-des-planches]
 *
 * Pour chaque élément du manifeste : le fichier existe-t-il, et pour une
 * vidéo, ffprobe (taille, cadence, durée, nombre d'images) — puis une planche
 * de six images réparties sur le clip (PNG, dans le dossier donné, par défaut
 * $TMPDIR/kit-jeux-a/planches) pour la regarder d'un coup d'œil, et la part
 * d'images IDENTIQUES à la précédente (une vidéo figée se voit tout de suite ;
 * un jeu à 40 pas par seconde en a normalement un tiers dans son maître à
 * 60 i/s, aucune dans sa variante -40ips).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const K = require('./lib/commun');

const planches = process.argv[2] || path.join(K.DOSSIER_TEMP, 'planches');
fs.mkdirSync(planches, { recursive: true });
const m = JSON.parse(fs.readFileSync(path.join(K.SORTIE, 'manifest.json'), 'utf8'));
let total = 0, problemes = 0;

// La part d'images répétées (mpdecimate compte celles qu'il garderait).
function partRepetee(f, n) {
  const { spawnSync } = require('child_process');
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', f, '-vf', 'mpdecimate=hi=64:lo=32:frac=0.33,showinfo', '-f', 'null', '-'], { encoding: 'utf8' });
  const gardees = (String(r.stderr || '').match(/\] n:\s*\d+/g) || []).length;
  return n ? Math.max(0, 1 - gardees / n) : 0;
}

for (const e of m.elements) {
  const f = path.join(K.SORTIE, e.fichier);
  if (!fs.existsSync(f)) { console.log(`✘ manquant : ${e.fichier}`); problemes++; continue; }
  const taille = fs.statSync(f).size;
  total += taille;
  for (const v of e.variantes || []) {
    const fv = path.join(K.SORTIE, v);
    if (!fs.existsSync(fv)) { console.log(`✘ variante manquante : ${v}`); problemes++; } else total += fs.statSync(fv).size;
  }
  if (e.affiche && fs.existsSync(path.join(K.SORTIE, e.affiche))) total += fs.statSync(path.join(K.SORTIE, e.affiche)).size;
  if (e.type !== 'video') { console.log(`✔ ${e.fichier} (${(taille / 1024).toFixed(0)} Ko)`); continue; }
  const p = K.sonder(f);
  const ok = p.largeur === 1920 && p.hauteur === 1080 && Math.round(p.fps) === 60 && p.duree > 2;
  if (!ok) problemes++;
  const rep = partRepetee(f, p.images);
  const planche = path.join(planches, path.basename(e.fichier, '.mp4') + '.png');
  const pas = Math.max(1, Math.floor(p.images / 6));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', f, '-vf', `select='not(mod(n\\,${pas}))',scale=480:-1,tile=3x2`, '-frames:v', '1', planche]);
  console.log(`${ok ? '✔' : '✘'} ${e.fichier} — ${p.largeur}×${p.hauteur} ${p.fps.toFixed(2)} i/s ${p.duree.toFixed(2)} s ${p.images} images, ` +
    `${(taille / 1048576).toFixed(1)} Mo, images répétées ${(Number(rep) * 100 || 0).toFixed(0)} %`);
}
console.log(`\n${m.elements.length} éléments, ${(total / 1048576).toFixed(0)} Mo au total (variantes et affiches comprises), ${problemes} problème(s). Planches : ${planches}`);
