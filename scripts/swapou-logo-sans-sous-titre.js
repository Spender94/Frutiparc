#!/usr/bin/env node
/*
 * LE LOGO DE SWAPOU SANS SON SOUS-TITRE, pour la version anglaise.
 *
 *   node scripts/swapou-logo-sans-sous-titre.js
 *
 * Games/swapou2/images/logo.png porte, gravé sous « swapou », le sous-titre
 * « les légumes attaquent ! ». Le nom du jeu ne se traduit pas ; le
 * sous-titre, si. Ce script en tire public/swapou/ui/logo-sans-sous-titre.png,
 * le même logo sans le sous-titre : le menu y écrit alors « the veggies
 * attack! » à l'exécution, dans la fonte et l'habit d'origine (U.lettrage,
 * screens.js : dessinerLogoTraduit).
 *
 * Comment on reconnaît le sous-titre, relevé sur l'image :
 *   · ses lettres sont VERT-JAUNE (#e7ef00, une bande plus sombre aux deux
 *     cinquièmes) — le titre, la liane et sa bague rouge sont orange, bruns ou
 *     rouges : le vert l'emporte sur le rouge chez lui seul ;
 *   · son contour est NOIR À 61 % (alpha 156), 4 px — celui du titre est un
 *     noir opaque ;
 *   · il commence sous y = 95 ; les feuilles, vertes elles aussi, sont plus
 *     haut, sur les lettres.
 * On efface donc le vert sous y = 95, et le noir translucide (ou le vert
 * sombre de l'anticrénelage) à moins de 6 px de lui.
 *
 * Le seul endroit délicat : les « l » de « les légumes » et le haut de
 * « attaquent » mordent sur la bande noire qui cerne le bas du titre. Effacés,
 * ils y laisseraient des encoches. Colonne par colonne, on relève où finit la
 * lettre orange et où finit sa bande ; là où le sous-titre la recouvre, on
 * reprend l'ÉPAISSEUR de la bande aux colonnes voisines du même bord de lettre
 * (elle varie lentement, 6 à 9 px) et on la referme en noir opaque, le dernier
 * pixel adouci.
 *
 * Le PNG est lu et écrit ici même (zlib, sans dépendance) : les pixels que le
 * sous-titre ne touchait pas restent EXACTEMENT ceux d'origine, et les blocs
 * de couleur du fichier (gAMA, cHRM, iCCP) sont recopiés tels quels.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const RACINE = path.join(__dirname, '..');
const SOURCE = path.join(RACINE, 'Games', 'swapou2', 'images', 'logo.png');
const CIBLE = path.join(RACINE, 'public', 'swapou', 'ui', 'logo-sans-sous-titre.png');

// ── Le PNG : RVBA 8 bits, non entrelacé (c'est le cas de logo.png) ─────────
function lirePng(buf) {
  if (buf.toString('latin1', 1, 4) !== 'PNG') throw new Error('pas un PNG');
  let o = 8;
  const blocs = [];
  const idat = [];
  let W = 0, H = 0;
  while (o < buf.length) {
    const n = buf.readUInt32BE(o), type = buf.toString('latin1', o + 4, o + 8);
    const donnees = buf.subarray(o + 8, o + 8 + n);
    if (type === 'IHDR') {
      W = donnees.readUInt32BE(0); H = donnees.readUInt32BE(4);
      if (donnees[8] !== 8 || donnees[9] !== 6 || donnees[12] !== 0) throw new Error('PNG attendu : RVBA 8 bits, non entrelacé');
    } else if (type === 'IDAT') idat.push(donnees);
    else if (type !== 'IEND') blocs.push({ type, donnees: Buffer.from(donnees) });
    o += 12 + n;
  }
  const brut = zlib.inflateSync(Buffer.concat(idat));
  const ligne = W * 4, px = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) {
    const f = brut[y * (ligne + 1)], src = y * (ligne + 1) + 1, dst = y * ligne;
    for (let x = 0; x < ligne; x++) {
      const a = x >= 4 ? px[dst + x - 4] : 0;
      const b = y > 0 ? px[dst - ligne + x] : 0;
      const c = x >= 4 && y > 0 ? px[dst - ligne + x - 4] : 0;
      let v = brut[src + x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      px[dst + x] = v & 255;
    }
  }
  return { W, H, px, blocs };
}

const TABLE_CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = TABLE_CRC[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function bloc(type, donnees) {
  const tete = Buffer.alloc(8);
  tete.writeUInt32BE(donnees.length, 0);
  tete.write(type, 4, 'latin1');
  const fin = Buffer.alloc(4);
  fin.writeUInt32BE(crc(Buffer.concat([tete.subarray(4), donnees])), 0);
  return Buffer.concat([tete, donnees, fin]);
}
// Chaque ligne prend le filtre qui la rend la plus petite (l'heuristique
// habituelle : la plus petite somme des écarts).
function ecrirePng({ W, H, px, blocs }) {
  const ligne = W * 4, out = Buffer.alloc(H * (ligne + 1));
  const essai = Buffer.alloc(ligne);
  for (let y = 0; y < H; y++) {
    let meilleur = -1, score = Infinity, retenu = null;
    for (let f = 0; f <= 4; f++) {
      let s = 0;
      for (let x = 0; x < ligne; x++) {
        const i = y * ligne + x;
        const a = x >= 4 ? px[i - 4] : 0, b = y > 0 ? px[i - ligne] : 0, c = x >= 4 && y > 0 ? px[i - ligne - 4] : 0;
        let pred = 0;
        if (f === 1) pred = a;
        else if (f === 2) pred = b;
        else if (f === 3) pred = (a + b) >> 1;
        else if (f === 4) {
          const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          pred = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
        }
        const v = (px[i] - pred) & 255;
        essai[x] = v;
        s += v < 128 ? v : 256 - v;
      }
      if (s < score) { score = s; meilleur = f; retenu = Buffer.from(essai); }
    }
    out[y * (ligne + 1)] = meilleur;
    retenu.copy(out, y * (ligne + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloc('IHDR', ihdr),
    ...blocs.map((b) => bloc(b.type, b.donnees)),
    bloc('IDAT', zlib.deflateSync(out, { level: 9 })),
    bloc('IEND', Buffer.alloc(0)),
  ]);
}

// ── L'effacement ────────────────────────────────────────────────────────────
function effacerSousTitre(d, W, H) {
  const Y0 = 95;               // le sous-titre commence sous cette ligne (les feuilles sont au-dessus)
  const at = (x, y) => (y * W + x) * 4;
  const vertClair = (i) => d[i + 3] > 0 && d[i + 1] > 40 && d[i + 1] >= d[i] && d[i + 2] < d[i + 1] * 0.6;
  const noirTranslucide = (i) => d[i + 3] > 0 && d[i + 3] < 235 && Math.max(d[i], d[i + 1], d[i + 2]) < 45;
  const vertSombre = (i) => d[i + 3] > 0 && d[i + 1] >= d[i] && d[i + 2] <= d[i + 1] && Math.max(d[i], d[i + 1]) < 110 && d[i + 1] > 0;
  const noirOpaque = (i) => d[i + 3] >= 235 && Math.max(d[i], d[i + 1], d[i + 2]) < 45;
  const lettre = (i) => d[i + 3] > 200 && d[i] > 120 && d[i] > d[i + 1];
  // 1. le remplissage vert des lettres
  const F = new Uint8Array(W * H);
  for (let y = Y0; y < H; y++) for (let x = 0; x < W; x++) if (vertClair(at(x, y))) F[y * W + x] = 1;
  // 2. son voisinage (le contour à 61 % fait 4 px)
  const R = 6;
  const Z = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!F[y * W + x]) continue;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < W && yy < H && dx * dx + dy * dy <= R * R) Z[yy * W + xx] = 1;
    }
  }
  // 3. ce qu'on efface : dans ce voisinage, le vert et le noir translucide
  const M = new Uint8Array(W * H);
  for (let k = 0; k < W * H; k++) {
    if (Z[k] && (F[k] || noirTranslucide(k * 4) || vertSombre(k * 4))) M[k] = 1;
  }
  // 4. la bande noire sous les lettres orange, colonne par colonne
  const finLettre = new Int32Array(W).fill(-1), finBande = new Int32Array(W).fill(-1);
  const finHaut = new Int32Array(W).fill(-1);   // la bande visible, au-dessus du sous-titre
  const cache = new Uint8Array(W);              // la bande passe-t-elle sous le sous-titre ?
  for (let x = 0; x < W; x++) {
    let dansBande = false;
    for (let y = 60; y < H; y++) {
      const k = y * W + x, i = k * 4;
      if (lettre(i) && !M[k]) { dansBande = false; finLettre[x] = y; finBande[x] = -1; finHaut[x] = -1; cache[x] = 0; continue; }
      if (finLettre[x] < 0) continue;
      if (noirOpaque(i) && !M[k]) { dansBande = true; finBande[x] = y; if (!cache[x]) finHaut[x] = y; continue; }
      if (M[k] && (dansBande || y === finLettre[x] + 1)) { dansBande = true; cache[x] = 1; continue; }
      if (dansBande || y > finLettre[x] + 2) break;
    }
  }
  const epaisseur = (x) => finBande[x] - finLettre[x];
  const valide = (x) => !cache[x] && finLettre[x] >= 0 && epaisseur(x) >= 4 && epaisseur(x) <= 12;
  const bordVrai = new Float32Array(W).fill(-1);
  for (let x = 0; x < W; x++) {
    if (!cache[x] || finLettre[x] < 0) continue;
    // une voisine sur le même bord de lettre (pas le creux d'un « a »)
    const proche = (v) => valide(v) && Math.abs(finLettre[v] - finLettre[x]) <= 8;
    let g = x - 1; while (g >= 0 && !proche(g)) g--;
    let dr = x + 1; while (dr < W && !proche(dr)) dr++;
    if (g < 0 && dr >= W) continue;
    let e;
    if (g < 0) e = epaisseur(dr);
    else if (dr >= W) e = epaisseur(g);
    else e = epaisseur(g) + (epaisseur(dr) - epaisseur(g)) * (x - g) / (dr - g);
    bordVrai[x] = Math.max(finHaut[x], finLettre[x] + e);
  }
  // 5. effacer, et refermer la bande
  let effaces = 0, refermes = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = y * W + x;
    if (!M[k]) continue;
    const i = k * 4;
    if (cache[x] && y > finLettre[x] && y <= bordVrai[x] + 0.5) {
      d[i] = d[i + 1] = d[i + 2] = 0; d[i + 3] = 255; refermes++;
    } else if (cache[x] && y > finLettre[x] && y <= bordVrai[x] + 1.5) {
      d[i] = d[i + 1] = d[i + 2] = 0; d[i + 3] = Math.round(255 * (bordVrai[x] + 1.5 - y)); refermes++;
    } else if (!cache[x] && finBande[x] >= 0 && y > finBande[x] && y <= finBande[x] + 1 && noirTranslucide(i)) {
      // le bord adouci de la bande elle-même, que le sous-titre ne touchait pas
    } else {
      d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0; effaces++;
    }
  }
  return { effaces, refermes };
}

const png = lirePng(fs.readFileSync(SOURCE));
const r = effacerSousTitre(png.px, png.W, png.H);
fs.mkdirSync(path.dirname(CIBLE), { recursive: true });
fs.writeFileSync(CIBLE, ecrirePng(png));
console.log(`${path.relative(RACINE, CIBLE)} : ${r.effaces} pixels effacés, ${r.refermes} refermés dans la bande noire`);
