#!/usr/bin/env node
// Les dessins de Frutisnake SANS leur texte gravé, pour la version anglaise.
//
//   node scripts/build-snake3-anglais.js     → public/snake3/sprites/en/*.svg
//
// Quelques dessins du SWF portent du texte français dans leur art même :
// les pastilles du menu en lettres 3D, les titres des écrans, les étiquettes
// des pages de l'Encyclopéfruit. Ce sont des FORMES (le texte a été vectorisé
// dans l'atelier de Flash) ou des pixels (les pages sont des JPEG). En
// anglais, on ne peut pas les « retraduire » : on en tire une version nue,
// et le jeu écrit l'anglais par-dessus, à l'exécution, dans le style de
// l'original (menu.js, game.js, encyclo.js). La table qui dit au jeu quelle
// image remplacer est dans /snake3/lang/en.js (snake3.dessins).
//
// Ce qui reste tel quel, parce que c'est déjà de l'anglais : « challenge »,
// « battle », « options » (pastilles 1 à 3, et le titre du panneau des
// options), « Game over », « Pause ». Ce qui reste parce que c'est un jeu de
// mots : « encyclopéfruit » (pastille 4, couverture), « FRUTIBARRE ».
//
// TROIS FAÇONS DE RETIRER UN TEXTE :
//
//   · un texte vectorisé dans une forme : on ôte ses CHEMINS, repérés par
//     leur rang dans le SVG composé et vérifiés par leur couleur — si
//     l'extraction a changé, le script s'arrête plutôt que d'effacer autre
//     chose ;
//   · un texte figé (DefineText, aplati par textesEnFormes) : on ôte son
//     GROUPE, reconnu à sa transformation ;
//   · un texte dans un JPEG (les pages du livre) : on le recouvre d'une pièce
//     peinte, tirée des pixels voisins — chaque colonne interpolée entre la
//     rangée au-dessus et la rangée au-dessous du texte ; là où un disque du
//     décor passe sous le texte (les pastilles « valeur »/« quantité »), le
//     disque est retracé d'après ses bords. ImageMagick (`convert`) décode le
//     JPEG et encode la pièce en PNG ; le calcul se fait ici.

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RACINE = path.join(__dirname, '..');
const SPRITES = path.join(RACINE, 'public/snake3/sprites');
const SORTIE = path.join(SPRITES, 'en');

const lire = (f) => fs.readFileSync(path.join(SPRITES, f), 'utf8');
const ecrire = (f, s) => {
  fs.mkdirSync(SORTIE, { recursive: true });
  fs.writeFileSync(path.join(SORTIE, f), s);
  console.log(`en/${f} (${Math.round(s.length / 1024)} ko)`);
};

// ── 1. Ôter des chemins par rang, en vérifiant leur couleur ──────────────────
function oterChemins(fichier, attendus) {
  const src = lire(fichier);
  let i = 0;
  const vus = {};
  const sortie = src.replace(/<path\b[^>]*\/?>/g, (m) => {
    const rang = i++;
    if (!(rang in attendus)) return m;
    const fill = (/fill="([^"]*)"/.exec(m) || [])[1] || '';
    vus[rang] = fill;
    if (!fill.startsWith(attendus[rang])) {
      throw new Error(`${fichier} : le chemin ${rang} est « ${fill} », on attendait « ${attendus[rang]} » — l'extraction a changé`);
    }
    return '';
  });
  const manquants = Object.keys(attendus).filter((r) => !(r in vus));
  if (manquants.length) throw new Error(`${fichier} : chemins absents ${manquants.join(', ')}`);
  return sortie;
}

// Les pastilles du menu : la face blanche, l'épaisseur grise, et les deux
// ombres vertes que le lettrage porte sur la pastille.
ecrire('menu005.svg', oterChemins('menu005.svg', { 8: '#005500', 9: '#017801', 10: '#cccccc', 11: '#ffffff' }));
ecrire('menu009.svg', oterChemins('menu009.svg', { 6: '#005500', 7: '#ffffff', 8: '#cccccc' }));

// Les titres des écrans : la bande grise (l'ombre du titre sur le bandeau
// blanc), le contour blanc, le dégradé rouge et son reflet.
// Le bandeau blanc sous le titre est découpé à sa forme : sans le titre, il
// y resterait un trou. On le referme d'un rectangle blanc, posé juste après
// le bandeau (le chemin qui précède le titre), entre ses deux bouts arrondis.
const TITRE = (r) => ({ [r]: '#cccccc', [r + 1]: '#ffffff', [r + 2]: 'url(#', [r + 3]: 'url(#' });
function sansTitre(fichier, rangTitre, y0, y1) {
  const s = oterChemins(fichier, TITRE(rangTitre));
  let i = 0;
  return s.replace(/<path\b[^>]*\/?>/g, (m) => (i++ === rangTitre - 1
    ? m + `<rect x="-172" y="${y0}" width="356" height="${(y1 - y0).toFixed(2)}" fill="#ffffff"/>` : m));
}
ecrire('screensSans015.svg', sansTitre('screensSans015.svg', 1, -126.4, -107.85));   // « Connexion »
ecrire('screensSans024.svg', sansTitre('screensSans024.svg', 1, -126.4, -107.85));   // « Resultat »
ecrire('screensSans032.svg', sansTitre('screensSans032.svg', 4, -126.4, -108.6));    // « Nouveau Fruit »

// ── 2. Le sommaire : un DefineText (« SOMMAIRE », Alba 20 blanc) ─────────────
{
  const src = lire('pageSans004.svg');
  const re = /<g transform="matrix\(1,0,0,1,-270\.15,-695\.85\)">\s*<g transform="matrix\(1,0,0,1,0,0\)">(?:<path [^>]*\/>)+<\/g>\s*<\/g>\n?/;
  if (!re.test(src)) throw new Error('pageSans004 : le texte « SOMMAIRE » n’est plus là où on l’attend');
  ecrire('pageSans004.svg', src.replace(re, ''));
}

// ── 3. Les pages en JPEG : une pièce peinte par-dessus le texte ──────────────

// Les pixels d'un JPEG embarqué (data: URL), décodés par ImageMagick.
function decoder(jpeg) {
  const taille = execFileSync('convert', ['jpeg:-', '-format', '%w %h', 'info:'], { input: jpeg }).toString().split(' ').map(Number);
  const rgb = execFileSync('convert', ['jpeg:-', '-depth', '8', 'rgb:-'], { input: jpeg, maxBuffer: 64 << 20 });
  const [w, h] = taille;
  return { w, h, px: (x, y) => { const o = (y * w + x) * 3; return [rgb[o], rgb[o + 1], rgb[o + 2]]; } };
}
function png(w, h, rgb) {
  return execFileSync('convert', ['-size', `${w}x${h}`, '-depth', '8', 'rgb:-', 'png:-'], { input: Buffer.from(rgb) });
}
const melange = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const ecart = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));

// Le disque du décor sous une étiquette (la pastille de la valeur ou de la
// quantité) : deux tons, le fond de la page et le disque, plus sombre. On
// prend le ton du fond au-dessus de la boîte, celui du disque bien en dessous,
// et l'on classe chaque pixel au plus proche des deux. Le disque se lit sur
// sa moitié BASSE. Une volute du décor peut s'y coller d'un côté (même ton) :
// le centre horizontal se prend donc sur les trois dernières rangées, étroites
// et dégagées, et la demi-largeur d'une rangée est le PLUS PETIT des deux
// côtés. Rangée par rangée, la demi-largeur w et la hauteur y vérifient
// w² + (y − cy)² = r², une équation linéaire en (cy, r² − cy²) qu'on résout
// aux moindres carrés.
function trouverDisque(im, boite) {
  const cx0 = Math.round((boite.x0 + boite.x1) / 2);
  const fond = moyenne(im, boite.x0, boite.y0 - 4, boite.x1, boite.y0 - 2);
  const couleur = moyenne(im, cx0 - 3, boite.y1 + 14, cx0 + 3, boite.y1 + 18);
  const estDisque = (x, y) => { const c = im.px(x, y); return ecart(c, couleur) < ecart(c, fond); };
  const rangs = [];
  let bas = -1;
  for (let y = boite.y1 + 2; y < boite.y1 + 70 && y < im.h; y++) {
    if (!estDisque(cx0, y)) { if (y > boite.y1 + 20) { bas = y - 1; break; } continue; }
    let x = cx0; while (x > boite.x0 - 25 && estDisque(x - 1, y)) x--;
    let x2 = cx0; while (x2 < boite.x1 + 25 && estDisque(x2 + 1, y)) x2++;
    rangs.push({ y, g: x, d: x2 });
  }
  if (bas < 0) return null;
  const bassins = rangs.filter((q) => q.y >= bas - 18 && q.y <= bas - 2);
  if (bassins.length < 5) return null;
  const fin = bassins.slice(-3);
  const cx = fin.reduce((t, q) => t + (q.g + q.d) / 2, 0) / fin.length;
  // Moindres carrés : w² + y² = 2·cy·y + k.
  let sy = 0, syy = 0, sz = 0, syz = 0;
  for (const q of bassins) {
    const w = Math.min(cx - q.g, q.d - cx) + 0.5, z = w * w + q.y * q.y;
    sy += q.y; syy += q.y * q.y; sz += z; syz += q.y * z;
  }
  const n = bassins.length;
  const pente = (n * syz - sy * sz) / (n * syy - sy * sy);
  const cy = pente / 2, k = (sz - pente * sy) / n;
  const r = Math.sqrt(k + cy * cy);
  return { cx, cy, r, couleur };
}
const moyenne = (im, x0, y0, x1, y1) => {
  const s = [0, 0, 0]; let n = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const c = im.px(x, y); s[0] += c[0]; s[1] += c[1]; s[2] += c[2]; n++; }
  return s.map((v) => v / n);
};

// La pièce d'une boîte. Le fond : pour chaque colonne, la moyenne de trois
// rangées au-dessus et de trois au-dessous du texte (lissées sur cinq
// colonnes, pour ne pas reproduire en traînées le grain du JPEG), fondues de
// haut en bas. Le disque, s'il y en a un, retracé par-dessus avec un bord
// adouci d'un pixel.
function piece(im, boite, avecDisque) {
  const { x0, y0, x1, y1 } = boite;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const disque = avecDisque ? trouverDisque(im, boite) : null;
  const dansDisque = (x, y) => (disque ? Math.max(0, Math.min(1, disque.r - Math.hypot(x - disque.cx, y - disque.cy) + 0.5)) : 0);
  const bande = (x, ya, yb) => moyenne(im, Math.max(0, x - 2), ya, Math.min(im.w - 1, x + 2), yb);
  const rgb = new Uint8Array(w * h * 3);
  for (let x = x0; x <= x1; x++) {
    const haut = bande(x, y0 - 4, y0 - 2);
    // Sous la boîte, la rangée peut tomber dans le disque : le fond du bas
    // est alors celui du haut.
    const bas = dansDisque(x, y1 + 3) > 0 ? haut : bande(x, y1 + 2, y1 + 4);
    for (let y = y0; y <= y1; y++) {
      let c = melange(haut, bas, (y - y0 + 1) / (h + 1));
      const k = dansDisque(x, y);
      if (k > 0) c = melange(c, disque.couleur, k);
      const o = ((y - y0) * w + (x - x0)) * 3;
      rgb[o] = Math.round(c[0]); rgb[o + 1] = Math.round(c[1]); rgb[o + 2] = Math.round(c[2]);
    }
  }
  return { x: x0, y: y0, w, h, png: png(w, h, rgb), disque };
}

function rapiecer(fichier, boites) {
  const src = lire(fichier);
  const m = /<image href="data:image\/jpeg;base64,([^"]*)" width="(\d+)" height="(\d+)" transform="([^"]*)"\/>/.exec(src);
  if (!m) throw new Error(`${fichier} : pas d’image JPEG`);
  const im = decoder(Buffer.from(m[1], 'base64'));
  let pieces = '';
  for (const b of boites) {
    const p = piece(im, b, b.disque);
    pieces += `<image href="data:image/png;base64,${p.png.toString('base64')}" x="${p.x}" y="${p.y}"`
      + ` width="${p.w}" height="${p.h}" transform="${m[4]}"/>`;
    console.log(`  ${fichier} « ${b.texte} » : pièce ${p.w}×${p.h} en (${p.x}, ${p.y})`
      + (p.disque ? `, disque (${p.disque.cx.toFixed(1)}, ${p.disque.cy.toFixed(1)}) r ${p.disque.r.toFixed(1)}` : ''));
  }
  ecrire(fichier, src.replace(m[0], m[0] + pieces));
}

// Les boîtes, en pixels de l'image (297×443, posée en −297/−298, −740) : le
// cadre des pixels blancs du texte, élargi de deux points (le flou du JPEG).
rapiecer('pageSans001.svg', [
  { texte: 'Valeur', x0: 47, y0: 335, x1: 117, y1: 356, disque: true },
  { texte: 'Quantité', x0: 163, y0: 330, x1: 267, y1: 358, disque: true },
]);
rapiecer('pageSans002.svg', [
  { texte: 'Valeur', x0: 45, y0: 335, x1: 114, y1: 357, disque: true },
  { texte: 'Quantité', x0: 159, y0: 330, x1: 264, y1: 360, disque: true },
]);
rapiecer('pageSans003.svg', [
  { texte: 'FrutiMag hors-série', x0: 89, y0: 2, x1: 206, y1: 18 },
  { texte: 'Edition 2004', x0: 102, y0: 92, x1: 202, y1: 111 },
]);
