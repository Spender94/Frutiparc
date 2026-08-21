#!/usr/bin/env node
// La JAQUETTE de JamaJama pour la feuille « Mes disques » du light.
//
//   node scripts/make-jamajama-disc.js   → public/fb/fd_jamajama.svg
//
// JamaJama n'a jamais eu de FrusionDisc : le portail le lançait par un
// `iconName: 'jama'` que fileIcon.swf ne connaît pas — l'icône manquait déjà
// à l'époque. On compose donc la sienne comme celle de Mini-Fever : avec les
// dessins DU JEU, pas un décalque. Le fond brun du menu, la bande de vagues
// qui défile derrière lui, le titre à deux étages, et l'anneau qui fait le
// disque.
//
// Tout vient de public/jamajama/sprites/ (le manifeste et ses SVG) : la
// jaquette se refait d'un trait si les dessins changent.

'use strict';

const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const SPRITES = path.join(RACINE, 'public/jamajama/sprites');
const SORTIE = path.join(RACINE, 'public/fb/fd_jamajama.svg');

const manifeste = JSON.parse(fs.readFileSync(path.join(SPRITES, 'sprites.json'), 'utf8'));
const TAILLE = 240;
const arr = (v) => Math.round(v * 100) / 100;

// Le contenu d'un SVG extrait, sans son enveloppe : on le replace nous-mêmes.
function corpsSvg(fichier) {
  const t = fs.readFileSync(path.join(SPRITES, fichier), 'utf8');
  const m = /<svg[^>]*>([\s\S]*)<\/svg>/.exec(t);
  return m ? m[1].trim() : '';
}

/**
 * Un symbole du manifeste, rendu en SVG à l'endroit voulu.
 *
 * Chaque pièce garde son viewBox d'origine : on l'imbrique dans un <svg>
 * placé au même cadre, puis on applique la matrice du manifeste. C'est le
 * même calcul que le rendu du jeu, en statique.
 */
function poser(cle, frame, clips) {
  const s = manifeste.symboles[cle];
  if (!s) return '';
  let etat = null;
  for (const e of s.etats) { if (e.frame > (frame || 1)) break; etat = e; }
  if (!etat) return '';
  let out = '';
  for (const p of etat.pieces) {
    if (p.clip) {
      const f = (clips && clips[p.nom]) || p.frame || 1;
      const dedans = poser(p.clip, f, clips);
      if (dedans && p.m) out += `<g transform="matrix(${p.m.map(arr).join(' ')})">${dedans}</g>`;
      else out += dedans;
      continue;
    }
    if (p.fichier === undefined) continue;         // champs et boutons : hors sujet
    const corps = corpsSvg(p.fichier);
    if (!corps) continue;
    const vb = p.vb;
    const interne = `<svg x="${arr(vb[0])}" y="${arr(vb[1])}" width="${arr(vb[2])}"`
      + ` height="${arr(vb[3])}" viewBox="${vb.map(arr).join(' ')}" overflow="visible">${corps}</svg>`;
    out += p.m ? `<g transform="matrix(${p.m.map(arr).join(' ')})">${interne}</g>` : interne;
  }
  return out;
}

// Le titre du jeu, à sa taille d'écran (269 × 150), ramené au disque.
const titre = poser('jama_Menu_Title', 1);
const bande = poser('jama_Menu_Bande', 1);
const glyphe = poser('jama_Menu_Glyph', 1);

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${TAILLE}" height="${TAILLE}" viewBox="0 0 ${TAILLE} ${TAILLE}">
<mask id="g"><circle cx="120" cy="120" r="118" fill="#fff"/><circle cx="120" cy="120" r="26" fill="#000"/></mask>
<g mask="url(#g)">
  <rect width="${TAILLE}" height="${TAILLE}" fill="#c9b981"/>
  <!-- La bande de vagues du menu, en haut et en bas : le titre couvre le
       milieu, et la répéter sur toute la hauteur alourdissait le fichier de
       cent kilo-octets pour des spirales qu'on ne voit pas. -->
  <g opacity="0.85">${[0, 31, 186, 217].map((y) =>
    `<g transform="translate(0 ${y})">${bande}</g>`).join('')}</g>
  <!-- Le glyphe du bord droit, à sa place. -->
  <g transform="translate(240 20)">${glyphe}</g>
  <!-- Le titre, centré et mis à l'échelle du disque. -->
  <g transform="translate(120 118) scale(0.78)">${titre}</g>
</g>
<circle cx="120" cy="120" r="118" fill="none" stroke="#624d28" stroke-width="3"/>
<circle cx="120" cy="120" r="26" fill="none" stroke="#624d28" stroke-width="3"/>
</svg>
`;

fs.mkdirSync(path.dirname(SORTIE), { recursive: true });
fs.writeFileSync(SORTIE, svg, 'utf8');
console.log(`→ ${path.relative(RACINE, SORTIE)} (${(svg.length / 1024).toFixed(1)} ko)`);
