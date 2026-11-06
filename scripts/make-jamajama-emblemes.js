#!/usr/bin/env node
// Le VOYANT de JamaJama — l'icône « joue à… » posée à côté du pseudo.
//
//   node scripts/make-jamajama-emblemes.js [--force]
//
// Rien n'est dessiné ici qui ne vienne du jeu : l'emblème est LE FANTÔME,
// `heroGFX` image 1 — le héros, celui que porte la jaquette du disque
// (frutiz/sprites/disc_jaquette_jama.svg). On le recompose depuis les sprites
// du portage (public/jamajama/sprites : sprites.json pour la pose, paquet.json
// pour les formes), sans serveur. Deux sorties, comme pour Mini-Fever
// (make-minifever-emblemes.js) :
//
//   scripts/assets-jamajama/voyant-34.png   2× de la boîte ~17×17 de la feuille
//                                           d'icônes de statut (clip 246 de
//                                           main.swf) — patch-main-statusmng-
//                                           jamajama.js la greffe
//   public/fb/voyant_jamajama.png           44×44, comme les autres voyants du
//                                           light
//
// Le rendu passe par Chromium ; les PNG produits sont versionnés, --force pour
// refaire.

'use strict';

const fs = require('fs');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const ROOT = path.join(__dirname, '..');
const ASSETS = path.join(ROOT, 'scripts/assets-jamajama');
const SORTIES = [
  { fichier: path.join(ASSETS, 'voyant-34.png'), cote: 34 },
  { fichier: path.join(ROOT, 'public/fb/voyant_jamajama.png'), cote: 44 },
];

if (!process.argv.includes('--force') && SORTIES.every((s) => fs.existsSync(s.fichier))) {
  console.log('les emblèmes existent déjà — rien à faire (--force pour refaire).');
  process.exit(0);
}

const S = require(path.join(ROOT, 'public/jamajama/sprites/sprites.json'));
const P = require(path.join(ROOT, 'public/jamajama/sprites/paquet.json'));

// Une pose d'un symbole, en SVG : chaque forme garde sa boîte (`vb`) et sa
// matrice (`m`) ; les clips imbriqués se recomposent de même. Les identifiants
// des dégradés sont préfixés par pièce, sinon deux formes se les voleraient.
let pieceN = 0;
function interieur(svg) { return svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, ''); }
function composer(nom, image) {
  const sym = S.symboles[nom];
  if (!sym) throw new Error('symbole absent : ' + nom);
  const etat = sym.etats.find((e) => e.frame === image) || sym.etats[0];
  return etat.pieces.map((p) => {
    const m = (p.m || [1, 0, 0, 1, 0, 0]).join(',');
    if (p.fichier) {
      const k = 'p' + (pieceN++) + '_';
      const corps = interieur(P[p.fichier])
        .replace(/id="([^"]+)"/g, 'id="' + k + '$1"')
        .replace(/url\(#([^)]+)\)/g, 'url(#' + k + '$1)');
      const vb = p.vb;
      return '<g transform="matrix(' + m + ')"><svg x="' + vb[0] + '" y="' + vb[1] + '" width="' + vb[2]
        + '" height="' + vb[3] + '" viewBox="' + vb.join(' ') + '" overflow="visible">' + corps + '</svg></g>';
    }
    if (p.clip) return '<g transform="matrix(' + m + ')">' + composer(p.clip, p.frame || 1) + '</g>';
    return '';
  }).join('');
}

// Le fantôme tient dans (-4.55,-4.85)-(37.5,25.85) : 42×31. Cadré sur toute
// sa largeur (44 unités), il paraissait plus petit que ses voisins — il est
// large et bas, eux remplissent leur carré (les cerises, le béret). On le
// cadre donc sur 36 unités, centré sur sa boîte : la tête emplit le voyant,
// seul le bout des deux petites ailes frôle le bord.
const BOITE = { x: -4.55, y: -4.85, w: 42.05, h: 30.7 };
const COTE = 36;
const vb = [BOITE.x + BOITE.w / 2 - COTE / 2, BOITE.y + BOITE.h / 2 - COTE / 2, COTE, COTE];
const fantome = composer('heroGFX', 1);

(async () => {
  fs.mkdirSync(ASSETS, { recursive: true });
  const nav = await chromium.launch();
  const page = await nav.newPage();
  for (const s of SORTIES) {
    await page.setViewportSize({ width: s.cote, height: s.cote });
    await page.setContent('<body style="margin:0;background:transparent"><svg xmlns="http://www.w3.org/2000/svg" width="'
      + s.cote + '" height="' + s.cote + '" viewBox="' + vb.join(' ') + '">' + fantome + '</svg></body>');
    await page.screenshot({ path: s.fichier, omitBackground: true, clip: { x: 0, y: 0, width: s.cote, height: s.cote } });
    console.log('→', path.relative(ROOT, s.fichier));
  }
  await nav.close();
})();
