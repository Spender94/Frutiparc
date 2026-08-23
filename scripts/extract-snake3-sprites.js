#!/usr/bin/env node
// Sort les dessins et les sons de Frutisnake (snake3.swf), pour le portage natif.
//
//   node scripts/extract-snake3-sprites.js            → écrit public/snake3/sprites/ et sons/
//   node scripts/extract-snake3-sprites.js --liste    → montre ce qui serait extrait
//
// ── Le SWF est OBFUSQUÉ ──
//
// Games/snake3/snake3.swf a perdu ses noms d'auteur (Obfu v1.4, cf.
// snake3_obfu.txt) : « slot » s'exporte « 98-^" », et on ne retrouve rien par
// les noms. L'identification s'est faite à la STRUCTURE, vérifiée à l'œil sur
// planches-contact :
//
//   · les étiquettes d'images ont survécu : « apparait/standard/disparait/
//     ombre » désignent snake3_fruit (451), « apparait/disparait »
//     snake3_bonus (450), « pause/gameOver/connexion/resultat/fruit/text »
//     screens (483) ;
//   · les noms d'INSTANCE aussi : `f` (451→354, 450→449), `col`+`o1`+`o2`
//     (tete 661), `base`+`col` (langue 527), `b1`+`mid`+`b2` (fbarre 685),
//     `playField` (background 694), `music`/`sound`/`format`/`returnMenu`
//     (optionPanel 630), `tpl`+`grad` (page 370) ;
//   · le reste au dénombrement : 429 images = la planche des fruits (354),
//     46 = le clip slot (ids 1-15 et 40-46 → 676), 37 icônes d'options (449),
//     9 = les pastilles du menu (600), 20 = les têtes (661 : 1 verte,
//     2 grise invincible, 3 noire, 11-13 battle), 3 × ~50 = les chiffres
//     (515 vert, 561 rouge, 590 jaune), 4 = les barres de battle (637/644).
//
// Les dessins sont des VECTEURS (96+58+379 DefineShape pour 8 bitmaps —
// seuls le titre et quelques textes passent par des polices) : ils sortent en
// SVG par scripts/extract-swf-shapes.js, aplatis par frame avec leurs
// matrices. Les 22 sons sont des MP3 embarqués (DefineSound format 2) : ils
// se recopient tels quels, et se NOMMENT en appariant leur durée à celle des
// WAV d'origine restés dans Games/snake3/sons/.

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ouvrir, IDENTITE } = require('./lib/swf-sprites.js');

const RACINE = path.join(__dirname, '..');
const SWF = path.join(RACINE, 'Games/snake3/snake3.swf');
const SORTIE = path.join(RACINE, 'public/snake3/sprites');
const SORTIE_SONS = path.join(RACINE, 'public/snake3/sons');
const DOSSIER_WAV = path.join(RACINE, 'Games/snake3/sons');

const LISTE_SEULE = process.argv.includes('--liste');

const swf = ouvrir(SWF, { textesEnFormes: true });

// ── Ce qu'on extrait ──────────────────────────────────────────────────────
// { cle, id, frames } — frames: liste d'images, ou 'toutes'.
const CLIPS = [
  { cle: 'fruits', id: 354, frames: 'toutes', etiquette: 'la planche des 342 fruits' },
  { cle: 'options', id: 449, frames: 'toutes', etiquette: 'les 37 icônes d\'options' },
  { cle: 'slot', id: 676, frames: 'toutes', etiquette: 'les cases de la rangée' },
  { cle: 'tete', id: 661, frames: [1, 2, 3, 10, 11, 12, 13], etiquette: 'les têtes' },
  { cle: 'fbarre', id: 685, frames: [1], etiquette: 'la frutibarre' },
  { cle: 'barreScore', id: 649, frames: [1], etiquette: 'le bandeau du score' },
  { cle: 'background', id: 694, frames: [1], etiquette: 'le terrain' },
  { cle: 'screens', id: 483, frames: 'toutes', etiquette: 'les écrans' },
  { cle: 'menu', id: 600, frames: 'toutes', etiquette: 'les pastilles du menu' },
  { cle: 'title', id: 453, frames: [1], etiquette: 'le titre Frutisnake' },
  { cle: 'fleche', id: 457, frames: [1], etiquette: 'la flèche du carrousel' },
  { cle: 'fleche2', id: 458, frames: [1], etiquette: 'l\'autre flèche' },
  { cle: 'menuBackground', id: 376, frames: [1], etiquette: 'le fond du menu' },
  { cle: 'optionPanel', id: 630, frames: [1], etiquette: 'le panneau des options' },
  { cle: 'bombe', id: 393, frames: 'toutes', etiquette: 'la bombe et son souffle' },
  { cle: 'langue', id: 527, frames: [1], etiquette: 'la langue' },
  { cle: 'sonnette', id: 529, frames: [1], etiquette: 'la sonnette' },
  { cle: 'trou', id: 519, frames: [1], etiquette: 'le terrier du départ' },
  { cle: 'beurk', id: 522, frames: [1], etiquette: 'la grimace des fruits pourris' },
  { cle: 'qparticule', id: 455, frames: [1], etiquette: 'les débris de queue' },
  { cle: 'chiffresVert', id: 515, frames: 'toutes', etiquette: 'les chiffres verts (score)' },
  { cle: 'chiffresRouge', id: 561, frames: 'toutes', etiquette: 'les chiffres rouges (gains)' },
  { cle: 'chiffresJaune', id: 590, frames: 'toutes', etiquette: 'les chiffres jaunes (pertes)' },
  { cle: 'page', id: 370, frames: 'toutes', etiquette: 'les pages de l\'encyclopédie' },
  { cle: 'dropCorner', id: 371, frames: [1], etiquette: 'l\'ombre du coin de page' },
  { cle: 'dropLarge', id: 372, frames: [1], etiquette: 'l\'ombre de la page' },
  { cle: 'bookHole', id: 602, frames: [1], etiquette: 'le creux du livre' },
  { cle: 'panRouge', id: 374, frames: [1], etiquette: 'panneau rouge (masque/écrans)' },
  { cle: 'panVert', id: 378, frames: [1], etiquette: 'panneau vert clair' },
  { cle: 'barSide', id: 637, frames: 'toutes', etiquette: 'bouts des jauges de battle' },
  { cle: 'barMid', id: 644, frames: 'toutes', etiquette: 'corps des jauges de battle' },
  { cle: 'pieces', id: 647, frames: 'toutes', etiquette: 'les piles de pièces' },
  { cle: 'fruitOuter', id: 451, frames: 'toutes', etiquette: 'le fruit qui paraît/disparaît' },
  { cle: 'bonusOuter', id: 450, frames: 'toutes', etiquette: 'l\'option qui paraît/disparaît' },
];

// ── L'aplatissement d'une image en un SVG autonome ────────────────────────

const boitesFormes = new Map();
function boiteForme(id) {
  if (boitesFormes.has(id)) return boitesFormes.get(id);
  const p = path.join(SORTIE, '_formes', 'shape' + id + '.svg');
  if (!fs.existsSync(p)) { boitesFormes.set(id, null); return null; }
  const t = fs.readFileSync(p, 'utf8');
  const m = /viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/.exec(t);
  const v = m ? { x: +m[1], y: +m[2], w: +m[3], h: +m[4] } : null;
  boitesFormes.set(id, v);
  return v;
}

function corpsForme(id) {
  const p = path.join(SORTIE, '_formes', 'shape' + id + '.svg');
  return fs.readFileSync(p, 'utf8').replace(/<svg[^>]*>/, '').replace('</svg>', '');
}

// Compose les morceaux d'aplatir() en un SVG : chaque forme dans son <g> à sa
// matrice (e/f en twips → pixels). Rend aussi le CADRE composé, en pixels de
// scène — c'est lui qui nourrit les hitboxes du moteur.
function svgCompose(morceaux) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  const dessins = [];
  for (const m of morceaux) {
    if (m.masque) continue;                    // les masques ne se dessinent pas
    const vb = boiteForme(m.shape);
    if (!vb) continue;
    const M = m.M;
    for (const [px, py] of [[vb.x, vb.y], [vb.x + vb.w, vb.y],
      [vb.x, vb.y + vb.h], [vb.x + vb.w, vb.y + vb.h]]) {
      const sx = M.a * px + M.c * py + M.e / 20;
      const sy = M.b * px + M.d * py + M.f / 20;
      x0 = Math.min(x0, sx); y0 = Math.min(y0, sy);
      x1 = Math.max(x1, sx); y1 = Math.max(y1, sy);
    }
    dessins.push(m);
  }
  if (!dessins.length) return null;
  const l = Math.max(0.01, x1 - x0), h = Math.max(0.01, y1 - y0);
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${arr(x0)} ${arr(y0)} ${arr(l)} ${arr(h)}" width="${arr(l)}" height="${arr(h)}">\n`;
  for (const d of dessins) {
    const M = d.M;
    svg += `<g transform="matrix(${[M.a, M.b, M.c, M.d, M.e / 20, M.f / 20].map(arr).join(',')})">`
      + corpsForme(d.shape) + '</g>\n';
  }
  svg += '</svg>\n';
  return { svg, cadre: { x: arr(x0), y: arr(y0), w: arr(l), h: arr(h) } };
}

const arr = (v) => Math.round(v * 100) / 100;

// ── Programme ─────────────────────────────────────────────────────────────

if (LISTE_SEULE) {
  for (const c of CLIPS) {
    const fr = swf.parSprite.get(c.id);
    console.log(`${c.cle} (id ${c.id}) — ${c.etiquette} : ${fr ? fr.size : 0} images`);
  }
  process.exit(0);
}

fs.mkdirSync(path.join(SORTIE, '_formes'), { recursive: true });
fs.mkdirSync(SORTIE_SONS, { recursive: true });

// 0. Les huit images matricielles — le papier du livre, le bandeau du score…
//    Les JPEG sortent tels quels (débarrassés du couple EOI+SOI erroné que
//    Flash colle en tête), les Lossless2 (ARGB zlib) en PNG minimal.
const zlib = require('zlib');
function pngDepuisRgba(w, h, rgba) {
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    crcTable[n] = c >>> 0;
  }
  const crc = (buf) => {
    let c = 0xFFFFFFFF;
    for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;           // 8 bits, RGBA
  const brut = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    brut[y * (w * 4 + 1)] = 0;
    rgba.copy(brut, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(brut)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const manifesteBitmaps = {};
swf.parcourir((code, corps, len) => {
  if (code === 21) {                  // DefineBitsJPEG2
    const id = swf.b.readUInt16LE(corps);
    let d = swf.b.slice(corps + 2, corps + len);
    if (d[0] === 0xFF && d[1] === 0xD9 && d[2] === 0xFF && d[3] === 0xD8) d = d.slice(4);
    // Certains DefineBitsJPEG2 de Flash sont DEUX flux concaténés — les tables
    // DQT/DHT puis, après un couple EOI+SOI, l'image qui en dépend. Le lecteur
    // Flash (et Ruffle, remove_invalid_jpeg_data) recoud en gommant chaque
    // couple ; les navigateurs, eux, s'arrêtent au premier EOI. On recoud pareil.
    for (let o; (o = d.indexOf(Buffer.from([0xFF, 0xD9, 0xFF, 0xD8]))) >= 0;) {
      d = Buffer.concat([d.slice(0, o), d.slice(o + 4)]);
    }
    const nom = 'bitmap' + id + '.jpg';
    fs.writeFileSync(path.join(SORTIE, nom), d);
    // Les dimensions, lues dans le JPEG (marqueur SOFn).
    let w = 0, h = 0;
    for (let o = 2; o < d.length - 8;) {
      if (d[o] !== 0xFF) { o++; continue; }
      const m = d[o + 1];
      if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
        h = d.readUInt16BE(o + 5); w = d.readUInt16BE(o + 7);
        break;
      }
      o += 2 + d.readUInt16BE(o + 2);
    }
    manifesteBitmaps[id] = { fichier: nom, w, h };
  }
  if (code === 36) {                  // DefineBitsLossless2
    const id = swf.b.readUInt16LE(corps);
    const fmt = swf.b[corps + 2];
    const w = swf.b.readUInt16LE(corps + 3), h = swf.b.readUInt16LE(corps + 5);
    if (fmt !== 5) return;            // seul le 32 bits nous concerne ici
    const argb = zlib.inflateSync(swf.b.slice(corps + 7, corps + len));
    const rgba = Buffer.alloc(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const a = argb[i * 4];
      // L'ARGB de Flash est PRÉMULTIPLIÉ : on dé-multiplie pour le PNG.
      const de = a ? 255 / a : 0;
      rgba[i * 4] = Math.min(255, Math.round(argb[i * 4 + 1] * de));
      rgba[i * 4 + 1] = Math.min(255, Math.round(argb[i * 4 + 2] * de));
      rgba[i * 4 + 2] = Math.min(255, Math.round(argb[i * 4 + 3] * de));
      rgba[i * 4 + 3] = a;
    }
    const nom = 'bitmap' + id + '.png';
    fs.writeFileSync(path.join(SORTIE, nom), pngDepuisRgba(w, h, rgba));
    manifesteBitmaps[id] = { fichier: nom, w, h };
  }
});
fs.writeFileSync(path.join(SORTIE, '_formes', 'bitmaps.json'), JSON.stringify(manifesteBitmaps));
console.log('bitmaps :', Object.keys(manifesteBitmaps).length);

// 0bis. Les trois étiquettes DefineText (366 « page stats », 624 « options »,
//       684 « frutibarre ») — du texte posé en glyphes, pas des formes. On les
//       rend en SVG à partir des contours de leur fonte (DefineFont2), et on
//       les écrit sous _formes/shapeNNN.svg : avec textesEnFormes, aplatir()
//       les renvoie comme morceaux, et svgCompose() les intègre alors partout
//       (frutibarre, panneau d'options, page de statistiques) sans rien savoir.
class LecteurBits {
  constructor(b, p) { this.b = b; this.p = p; this.bit = 0; }
  aligner() { if (this.bit) { this.bit = 0; this.p++; } }
  u(n) {
    let v = 0;
    for (let i = 0; i < n; i++) {
      v = (v * 2) + ((this.b[this.p] >> (7 - this.bit)) & 1);
      if (++this.bit === 8) { this.bit = 0; this.p++; }
    }
    return v;
  }
  s(n) { if (!n) return 0; const v = this.u(n); const seuil = 2 ** (n - 1); return v >= seuil ? v - 2 ** n : v; }
  u8() { this.aligner(); return this.b[this.p++]; }
  u16() { this.aligner(); const v = this.b.readUInt16LE(this.p); this.p += 2; return v; }
  i16() { this.aligner(); const v = this.b.readInt16LE(this.p); this.p += 2; return v; }
}

// Le contour d'un glyphe : la grammaire des formes SWF, sans styles.
// Les coordonnées sortent en unités de cadratin (1024 par em).
function cheminGlyphe(b, debut) {
  const r = new LecteurBits(b, debut);
  const fillBits = r.u(4), lineBits = r.u(4);
  let x = 0, y = 0, d = '';
  for (;;) {
    if (r.u(1)) {
      if (r.u(1)) {                    // segment droit
        const n = r.u(4) + 2;
        if (r.u(1)) { x += r.s(n); y += r.s(n); }
        else if (r.u(1)) y += r.s(n);
        else x += r.s(n);
        d += `L${x} ${y}`;
      } else {                         // courbe quadratique
        const n = r.u(4) + 2;
        const cx = x + r.s(n), cy = y + r.s(n);
        x = cx + r.s(n); y = cy + r.s(n);
        d += `Q${cx} ${cy} ${x} ${y}`;
      }
    } else {
      const drapeaux = r.u(5);
      if (!drapeaux) break;
      if (drapeaux & 1) {              // déplacement (absolu)
        const n = r.u(5);
        x = r.s(n); y = r.s(n);
        d += `M${x} ${y}`;
      }
      if (drapeaux & 2) r.u(fillBits);
      if (drapeaux & 4) r.u(fillBits);
      if (drapeaux & 8) r.u(lineBits);
    }
  }
  return d;
}

{
  // Les fontes : id → les plages d'octets de chaque glyphe.
  const fontes = new Map();
  swf.parcourir((code, corps) => {
    if (code !== 48) return;
    const id = swf.b.readUInt16LE(corps);
    const drapeaux = swf.b[corps + 2];
    const larges = !!(drapeaux & 0x08);
    const lgNom = swf.b[corps + 4];
    let p = corps + 5 + lgNom;
    const nombre = swf.b.readUInt16LE(p); p += 2;
    const base = p;
    const pas = larges ? 4 : 2;
    const lire = (i) => (larges ? swf.b.readUInt32LE(base + i * pas) : swf.b.readUInt16LE(base + i * pas));
    const glyphes = [];
    for (let i = 0; i < nombre; i++) glyphes.push({ debut: base + lire(i), fin: base + lire(i + 1) });
    fontes.set(id, glyphes);
  });

  swf.parcourir((code, corps, len) => {
    if (code !== 11 && code !== 33) return;
    const id = swf.b.readUInt16LE(corps);
    const r = new LecteurBits(swf.b, corps + 2);
    const nb = r.u(5);
    const xMin = r.s(nb), xMax = r.s(nb), yMin = r.s(nb), yMax = r.s(nb);
    r.aligner();
    let a = 1, bM = 0, c = 0, dM = 1;
    if (r.u(1)) { const n = r.u(5); a = r.s(n) / 65536; dM = r.s(n) / 65536; }
    if (r.u(1)) { const n = r.u(5); bM = r.s(n) / 65536; c = r.s(n) / 65536; }
    const nt = r.u(5);
    const e = r.s(nt), f = r.s(nt);
    const glyphBits = r.u8(), advanceBits = r.u8();

    let fonte = null, couleur = '#000000', hauteur = 240, px = 0, py = 0;
    const traits = [];
    for (;;) {
      const drapeaux = r.u8();
      if (!drapeaux) break;
      if (drapeaux & 8) fonte = fontes.get(r.u16());
      if (drapeaux & 4) {
        const rc = r.u8(), vc = r.u8(), bc = r.u8();
        if (code === 33) r.u8();       // alpha, ignoré (opaque ici)
        couleur = '#' + [rc, vc, bc].map((v) => v.toString(16).padStart(2, '0')).join('');
      }
      if (drapeaux & 1) px = r.i16();
      if (drapeaux & 2) py = r.i16();
      if (drapeaux & 8) hauteur = r.u16();
      const nGlyphes = r.u8();
      for (let i = 0; i < nGlyphes; i++) {
        const idx = r.u(glyphBits);
        const avance = r.s(advanceBits);
        traits.push({ glyphe: fonte && fonte[idx], couleur, hauteur, px, py });
        px += avance;
      }
      r.aligner();
    }

    const sc = 1 / 1024 / 20;          // cadratin → twips (×hauteur) → pixels
    let corpsSvg = `<g transform="matrix(${[a, bM, c, dM, arr(e / 20), arr(f / 20)].map(String).join(',')})">`;
    for (const t of traits) {
      if (!t.glyphe) continue;
      const k = t.hauteur * sc;
      corpsSvg += `<path transform="matrix(${k},0,0,${k},${arr(t.px / 20)},${arr(t.py / 20)})"`
        + ` d="${cheminGlyphe(swf.b, t.glyphe.debut)}" fill="${t.couleur}"/>`;
    }
    corpsSvg += '</g>';
    const vb = [xMin / 20, yMin / 20, (xMax - xMin) / 20, (yMax - yMin) / 20].map(arr);
    fs.writeFileSync(path.join(SORTIE, '_formes', 'shape' + id + '.svg'),
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.join(' ')}" width="${vb[2]}" height="${vb[3]}">\n${corpsSvg}\n</svg>\n`);
    console.log(`texte ${id} : ${traits.length} glyphes, cadre ${vb[2]}×${vb[3]}`);
  });
}

// 1. Toutes les formes référencées, en un ou deux passages de l'extracteur commun.
const shapes = new Set();
const travaux = [];
for (const c of CLIPS) {
  const fr = swf.parSprite.get(c.id);
  if (!fr) { console.warn('!! pas de sprite', c.cle, c.id); continue; }
  const liste = c.frames === 'toutes'
    ? [...fr.keys()].sort((a, b) => a - b)
    : c.frames;
  for (const f of liste) {
    const morceaux = swf.aplatir(c.id, IDENTITE, 0, f, '', null);
    for (const m of morceaux) shapes.add(m.shape);
    travaux.push({ c, f, morceaux });
  }
}
const manquantes = [...shapes].filter(
  (s) => !fs.existsSync(path.join(SORTIE, '_formes', 'shape' + s + '.svg')));
for (let i = 0; i < manquantes.length; i += 150) {
  execFileSync('node', [path.join(__dirname, 'extract-swf-shapes.js'),
    '--bitmaps', path.join(SORTIE, '_formes', 'bitmaps.json'), SWF,
    path.join(SORTIE, '_formes'), ...manquantes.slice(i, i + 150).map(String)],
  { stdio: 'pipe' });
}
console.log(`formes : ${shapes.size} référencées`);

// 2. Chaque image en SVG + le manifeste.
const manifeste = { clips: {}, cadres: {}, notes: {} };
let nSvg = 0;
for (const t of travaux) {
  const r = svgCompose(t.morceaux);
  if (!r) continue;
  const nom = `${t.c.cle}${String(t.f).padStart(3, '0')}.svg`;
  fs.writeFileSync(path.join(SORTIE, nom), r.svg);
  nSvg++;
  if (!manifeste.clips[t.c.cle]) manifeste.clips[t.c.cle] = { id: t.c.id, frames: {} };
  manifeste.clips[t.c.cle].frames[t.f] = { fichier: nom, cadre: r.cadre };
}
console.log(`SVG écrits : ${nSvg}`);

// 3. Les mesures dont le moteur a besoin.
//    Le col de la tête (655 dans 661), la langue (col à x=100 px), le
//    playField du fond, les bouts de la frutibarre.
{
  const f1 = swf.parSprite.get(661).get(1);
  const col = f1.find((p) => p.nom === 'col');
  const vb = boiteForme(col.ch) || { w: 10, h: 10 };
  manifeste.cadres.col = {
    dx: arr(col.M.e / 20),
    dy: arr(col.M.f / 20),
    w: arr(vb.w * col.M.a),
    h: arr(vb.h * col.M.d),
  };
  const langue = swf.parSprite.get(527).get(1);
  const lcol = langue.find((p) => p.nom === 'col');
  manifeste.cadres.langueCol = { x: arr(lcol.M.e / 20) };
  const fond = swf.parSprite.get(694).get(1);
  const pf = fond.find((p) => p.nom === 'playField');
  const pvb = boiteForme(pf.ch);
  manifeste.cadres.playField = pvb
    ? { x: arr(pf.M.e / 20), y: arr(pf.M.f / 20), w: arr(pvb.w * pf.M.a), h: arr(pvb.h * pf.M.d) }
    : null;
}

// 3bis. Les pièces de la frutibarre (685) — Game.as étire `mid._width` chaque
//       image et repose `b2._x = b1._x + mid._width` : la barre ne peut pas se
//       dessiner d'un bloc. Chaque pièce sort en SVG dans SON repère local, et
//       le manifeste retient sa pose d'origine (matrice, en pixels) dans le
//       repère du clip. L'ordre du tableau est l'ordre de dessin (profondeurs).
{
  const pieces = [];
  let n = 0;
  for (const p of swf.parSprite.get(685).get(1)) {
    const morceaux = swf.aplatir(p.ch, IDENTITE, 0, 1, '', p.cx || null);
    const r = svgCompose(morceaux);
    if (!r) continue;
    n++;
    const nom = `fbarrePiece${String(n).padStart(2, '0')}.svg`;
    fs.writeFileSync(path.join(SORTIE, nom), r.svg);
    pieces.push({
      nom: p.nom || null,
      fichier: nom,
      cadre: r.cadre,
      matrice: [p.M.a, p.M.b, p.M.c, p.M.d, arr(p.M.e / 20), arr(p.M.f / 20)],
    });
  }
  manifeste.cadres.fbarre = { pieces };
}

// 4. Les cadres par fruit et par option — la géométrie des hitboxes.
{
  const fruits = {};
  const cf = manifeste.clips.fruits.frames;
  for (const f of Object.keys(cf)) fruits[f] = { w: cf[f].cadre.w, h: cf[f].cadre.h };
  manifeste.cadres.fruits = fruits;
  const options = {};
  const co = manifeste.clips.options.frames;
  for (const f of Object.keys(co)) options[f] = { w: co[f].cadre.w, h: co[f].cadre.h };
  manifeste.cadres.options = options;
}

// 5. Les sons : recopie des MP3, nommés par appariement de durée avec les WAV
//    d'origine (le SWF a embarqué UNE prise de chaque bruit de la banque).
function dureeWav(p) {
  const b = fs.readFileSync(p);
  if (b.slice(0, 4).toString() !== 'RIFF') return null;
  let o = 12;
  let fmt = null, dataLen = null;
  while (o + 8 <= b.length) {
    const id = b.slice(o, o + 4).toString();
    const len = b.readUInt32LE(o + 4);
    if (id === 'fmt ') fmt = { canaux: b.readUInt16LE(o + 10), taux: b.readUInt32LE(o + 12), octetsParSec: b.readUInt32LE(o + 16) };
    if (id === 'data') dataLen = len;
    o += 8 + len + (len % 2);
  }
  if (!fmt || dataLen == null || !fmt.octetsParSec) return null;
  return dataLen / fmt.octetsParSec;
}

const sons = [];
swf.parcourir((code, corps, len) => {
  if (code !== 14) return;
  const sid = swf.b.readUInt16LE(corps);
  const info = swf.b[corps + 2];
  const rate = [5512, 11025, 22050, 44100][(info >> 2) & 3];
  const samples = swf.b.readUInt32LE(corps + 3);
  // MP3 : après samples vient SeekSamples (u16), puis les trames MP3.
  const donnees = swf.b.slice(corps + 7 + 2, corps + len);
  sons.push({ sid, duree: samples / rate, donnees });
});

// La banque WAV, aplatie.
const banque = [];
(function lister(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) lister(p);
    else if (/\.wav$/i.test(f)) {
      const duree = dureeWav(p);
      if (duree) banque.push({ nom: f, chemin: p.slice(DOSSIER_WAV.length + 1), duree });
    }
  }
})(DOSSIER_WAV);

// Le rôle probable de chaque WAV, par son nom de fichier.
function roleDeWav(chemin) {
  const f = chemin.toLowerCase();
  if (f.includes('loop jeu')) return 'game_loop';
  if (f.includes('loop menu')) return 'menu_loop';
  if (f.includes('game over')) return 'game_over';
  if (f.includes('apparition fruit')) return 'fapp';
  if (f.includes('gulp')) return 'glurps';
  if (f.includes('ciseaux')) return 'ciseaux';
  if (f.includes('coffre')) return 'coffre';
  if (f.includes('fin_effet') || f.includes('fin effet')) return 'effect_end';
  if (f.includes('langue')) return 'langue';
  if (f.includes('attraper option')) return 'option';
  if (f.includes('clochette')) return 'cloche';
  if (f.includes('dynamite')) return 'dynamite';
  if (f.includes('ressort')) return 'ressort';
  if (f.includes('sabre')) return 'sabre';
  if (f.includes('potion')) return 'potion';
  if (f.includes('disparition')) return 'fdisp';
  if (f.includes('sonnette')) return 'sonnette';
  if (f.includes('explos')) return 'explose';
  if (f.includes('page')) return 'page';
  if (f.includes('retour menu')) return 'retmenu';
  if (f.includes('rotation')) return 'rotmenu';
  if (f.includes('selection')) return 'selmenu';
  return null;
}

// Trois attributions que l'appariement de durée ne peut pas trancher seul :
//   · son 1 ≈ « snake 03.wav » — les prises « snake NN » de la banque sont les
//     éclats de segments : c'est SOUND_EXPLOSE ;
//   · son 13 ≈ « gulp 01.wav » — la DEUXIÈME bouchée : SOUND_FRUIT_EAT_2
//     (glurps_2), le son 12 (gulp 06) étant glurps ;
//   · son 18 ≈ « coffre 01.wav » — la banque n'a AUCUN « sonnette NN.wav » :
//     le SWF réutilise une prise de coffre pour le coup de cloche. Le compte
//     tombe juste : 23 noms dans Const.as moins SOUND_FRUIT_APPEAR — jamais
//     joué, l'appel est commenté dans Level.as — font 22 sons embarqués.
const SURCHARGES = { 1: 'explose', 13: 'glurps_2', 18: 'sonnette' };

const affectations = {};
for (const s of sons) {
  let mieux = null;
  for (const w of banque) {
    const ecart = Math.abs(w.duree - s.duree);
    if (ecart < 0.06 && (!mieux || ecart < mieux.ecart)) {
      mieux = { w, ecart };
    }
  }
  const role = SURCHARGES[s.sid] || (mieux ? roleDeWav(mieux.w.chemin) : null);
  const nom = role && !affectations[role] ? role : 'son' + s.sid;
  if (role && !affectations[role]) affectations[role] = s.sid;
  fs.writeFileSync(path.join(SORTIE_SONS, nom + '.mp3'), s.donnees);
  console.log(`son ${s.sid} (${s.duree.toFixed(2)}s) → ${nom}.mp3`
    + (mieux ? `  (≈ ${mieux.w.chemin}, ±${(mieux.ecart * 1000).toFixed(0)} ms)` : '  (sans jumeau WAV)'));
}
manifeste.notes.sons = affectations;

fs.writeFileSync(path.join(SORTIE, 'sprites.json'), JSON.stringify(manifeste));
console.log('manifeste écrit — clips :', Object.keys(manifeste.clips).length);

// Le dossier de travail des formes brutes ne part pas au dépôt.
fs.rmSync(path.join(SORTIE, '_formes'), { recursive: true, force: true });
