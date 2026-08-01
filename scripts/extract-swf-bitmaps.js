#!/usr/bin/env node
// Extrait les images matricielles d'un SWF vers des fichiers utilisables sur le web.
//
// Pendant de extract-swf-shapes.js : les petites icônes du bureau sont
// vectorielles, mais les VISUELS (ceux des événements, de l'historique…) sont
// des bitmaps. Les redessiner donnerait un « à peu près » ; ils sont là, exacts.
//
//   node scripts/extract-swf-bitmaps.js <fichier.swf> [sortie/] [id…]
//
// Sans identifiants, liste les images avec leur taille et leur encodage — c'est
// ainsi qu'on repère celle qu'on cherche.
//
// Ce que produit chaque encodage :
//
//   DefineBitsLossless / 2 (tags 20, 36) → .png
//     Données zlib brutes ; on ré-encode en PNG dans la foulée. Le format 5 des
//     Lossless2 stocke des couleurs PRÉ-MULTIPLIÉES par l'alpha : on divise
//     pour revenir aux couleurs droites, sinon tout ce qui est semi-transparent
//     ressort assombri.
//
//   DefineBitsJPEG 2/3/4 (tags 21, 35, 90) → .svg (ou .png / .jpg)
//     Ces tags portent un JPEG + un canal alpha zlib SÉPARÉ. Node ne sait pas
//     décoder un JPEG, et ajouter une dépendance pour trois icônes serait cher
//     payé. On émet donc un SVG autonome : le JPEG d'origine en base64, masqué
//     par un PNG en niveaux de gris (l'alpha) qu'on fabrique ici. Le navigateur
//     recompose — rendu identique, aucune dépendance, aucune recompression.
//     Si la charge utile est déjà un PNG ou un GIF (permis depuis Flash 8), on
//     l'écrit tel quel.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function lireSwf(p) {
  const raw = fs.readFileSync(p);
  const sig = raw.slice(0, 3).toString('ascii');
  if (sig !== 'CWS' && sig !== 'FWS') throw new Error('Signature inconnue : ' + sig);
  return sig === 'CWS' ? zlib.inflateSync(raw.slice(8)) : raw.slice(8);
}

// ─── Encodeur PNG (le strict nécessaire : IHDR, IDAT, IEND) ───
const TABLE_CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = TABLE_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function bloc(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const corps = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(corps), 0);
  return Buffer.concat([len, corps, crc]);
}
// `canaux` : 1 = gris, 4 = RGBA. `pixels` : w*h*canaux octets, ligne par ligne.
function encoderPng(w, h, canaux, pixels) {
  const parLigne = w * canaux;
  const brut = Buffer.alloc((parLigne + 1) * h);
  for (let y = 0; y < h; y++) {
    brut[y * (parLigne + 1)] = 0;                     // filtre « None »
    pixels.copy(brut, y * (parLigne + 1) + 1, y * parLigne, (y + 1) * parLigne);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;                                        // 8 bits par canal
  ihdr[9] = canaux === 1 ? 0 : 6;                     // 0 = gris, 6 = RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloc('IHDR', ihdr),
    bloc('IDAT', zlib.deflateSync(brut, { level: 9 })),
    bloc('IEND', Buffer.alloc(0)),
  ]);
}

// ─── JPEG ───
// Flash écrit un « double JPEG » : un premier bloc SOI…EOI qui ne contient que
// les tables (quantification + Huffman), puis un SECOND SOI où commence l'image.
// Un décodeur qui s'arrête au premier EOI ne voit jamais l'image. On recolle les
// deux moitiés en retirant la paire FFD9 FFD8 — ce qui donne un JPEG parfaitement
// ordinaire, lisible partout.
function recollerJpeg(d) {
  const i = d.indexOf(Buffer.from([0xff, 0xd9, 0xff, 0xd8]));
  return i < 0 ? d : Buffer.concat([d.slice(0, i), d.slice(i + 4)]);
}
// Dimensions lues dans le marqueur SOF.
function tailleJpeg(d) {
  let p = 2;                                          // saute SOI
  while (p + 1 < d.length) {
    if (d[p] !== 0xff) { p++; continue; }
    const m = d[p + 1];
    if (m === 0xff) { p++; continue; }                // octet de bourrage
    if (m === 0xd8 || m === 0xd9 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { p += 2; continue; }
    if (m === 0xda) break;                            // début des données codées
    const len = d.readUInt16BE(p + 2);
    // SOF0..SOF15, sauf DHT (C4), JPG (C8) et DAC (CC).
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { h: d.readUInt16BE(p + 5), w: d.readUInt16BE(p + 7) };
    }
    p += 2 + len;
  }
  return { w: 0, h: 0 };
}
const magie = (d) => d.slice(0, 8).toString('hex');
const estPng = (d) => magie(d).startsWith('89504e47');
const estGif = (d) => d.slice(0, 3).toString('ascii') === 'GIF';

// ─── Décodage des tags ───
function lireLossless(b, t) {
  const id = b.readUInt16LE(t.corps);
  const format = b[t.corps + 2];
  const w = b.readUInt16LE(t.corps + 3), h = b.readUInt16LE(t.corps + 5);
  let o = t.corps + 7, nCouleurs = 0;
  if (format === 3) { nCouleurs = b[o] + 1; o += 1; }
  const data = zlib.inflateSync(b.slice(o, t.corps + t.len));
  const avecAlpha = t.code === 36;
  const px = Buffer.alloc(w * h * 4);
  // Les lignes sont alignées sur 4 octets (« padding » de fin de ligne).
  const aligne = (n) => (n + 3) & ~3;

  if (format === 3) {
    const tailleEntree = avecAlpha ? 4 : 3;
    const palette = data.slice(0, nCouleurs * tailleEntree);
    const corps = data.slice(nCouleurs * tailleEntree);
    const pas = aligne(w);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = corps[y * pas + x] * tailleEntree, d = (y * w + x) * 4;
      const a = avecAlpha ? palette[i + 3] : 255;
      px[d] = palette[i]; px[d + 1] = palette[i + 1]; px[d + 2] = palette[i + 2]; px[d + 3] = a;
    }
  } else if (format === 4) {                          // 15 bits, 2 octets par pixel
    const pas = aligne(w * 2);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = data.readUInt16BE(y * pas + x * 2), d = (y * w + x) * 4;
      px[d] = ((v >> 10) & 0x1f) * 255 / 31;
      px[d + 1] = ((v >> 5) & 0x1f) * 255 / 31;
      px[d + 2] = (v & 0x1f) * 255 / 31;
      px[d + 3] = 255;
    }
  } else {                                            // format 5 : 4 octets par pixel
    const pas = w * 4;                                // déjà multiple de 4
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const s = y * pas + x * 4, d = (y * w + x) * 4;
      // Lossless  : (0, R, G, B). Lossless2 : (A, R, G, B) PRÉ-MULTIPLIÉ.
      const a = avecAlpha ? data[s] : 255;
      if (!avecAlpha || a === 255) {
        px[d] = data[s + 1]; px[d + 1] = data[s + 2]; px[d + 2] = data[s + 3];
      } else if (a === 0) {
        px[d] = px[d + 1] = px[d + 2] = 0;
      } else {
        px[d] = Math.min(255, Math.round(data[s + 1] * 255 / a));
        px[d + 1] = Math.min(255, Math.round(data[s + 2] * 255 / a));
        px[d + 2] = Math.min(255, Math.round(data[s + 3] * 255 / a));
      }
      px[d + 3] = a;
    }
  }
  return { id, w, h, format, ext: '.png', octets: encoderPng(w, h, 4, px), note: `lossless format ${format}` };
}

function lireJpeg(b, t) {
  const id = b.readUInt16LE(t.corps);
  const avecAlpha = t.code === 35 || t.code === 90;
  let o = t.corps + 2, finAlpha = t.corps + t.len, image;
  if (avecAlpha) {
    if (t.code === 90) o += 4;                        // DefineBitsJPEG4 : « deblock »
    const decalage = b.readUInt32LE(o); o += 4;
    image = b.slice(o, o + decalage);
    var alphaBrut = b.slice(o + decalage, finAlpha);
  } else {
    image = b.slice(o, finAlpha);
  }
  if (estPng(image)) return { id, w: image.readUInt32BE(16), h: image.readUInt32BE(20), ext: '.png', octets: image, note: 'PNG embarqué' };
  if (estGif(image)) return { id, w: 0, h: 0, ext: '.gif', octets: image, note: 'GIF embarqué' };

  image = recollerJpeg(image);
  const { w, h } = tailleJpeg(image);
  if (!avecAlpha || !alphaBrut || !alphaBrut.length) {
    return { id, w, h, ext: '.jpg', octets: image, note: 'JPEG sans alpha' };
  }
  let alpha;
  try { alpha = zlib.inflateSync(alphaBrut); }
  catch (e) { return { id, w, h, ext: '.jpg', octets: image, note: 'JPEG (alpha illisible : ' + e.message + ')' }; }
  if (!w || !h) throw new Error('dimensions JPEG introuvables');
  if (alpha.length < w * h) throw new Error(`canal alpha trop court (${alpha.length} < ${w * h})`);

  const masque = encoderPng(w, h, 1, alpha.slice(0, w * h));
  const svg =
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
  <mask id="a" maskUnits="userSpaceOnUse" x="0" y="0" width="${w}" height="${h}">
    <image width="${w}" height="${h}" href="data:image/png;base64,${masque.toString('base64')}"/>
  </mask>
  <image width="${w}" height="${h}" mask="url(#a)" href="data:image/jpeg;base64,${image.toString('base64')}"/>
</svg>
`;
  return { id, w, h, ext: '.svg', octets: Buffer.from(svg, 'utf8'), note: 'JPEG + masque alpha' };
}

// ─── Parcours des tags ───
const [, , fichier, sortie, ...ids] = process.argv;
if (!fichier) {
  console.error('usage : extract-swf-bitmaps.js <fichier.swf> [sortie/] [id…]');
  process.exit(1);
}
const b = lireSwf(fichier);
const rectBytes = (x) => Math.ceil((5 + ((x[0] >> 3) & 0x1f) * 4) / 8);
const images = [];
(function scan(from, to) {
  let o = from;
  while (o < to) {
    const hdr = b.readUInt16LE(o), code = hdr >> 6;
    let len = hdr & 0x3f, hs = 2;
    if (len === 0x3f) { len = b.readUInt32LE(o + 2); hs = 6; }
    if (code === 0) break;
    if (code === 39) scan(o + hs + 4, o + hs + len);
    if ([20, 21, 35, 36, 90].includes(code)) images.push({ code, corps: o + hs, len });
    o += hs + len;
  }
})(rectBytes(b) + 4, b.length);

const voulus = new Set(ids.map(Number));
let n = 0;
for (const t of images) {
  const id = b.readUInt16LE(t.corps);
  if (voulus.size && !voulus.has(id)) continue;
  let img;
  try { img = (t.code === 20 || t.code === 36) ? lireLossless(b, t) : lireJpeg(b, t); }
  catch (e) { console.error(`  #${id} : ${e.message}`); continue; }
  if (!voulus.size) {
    console.log(`#${id}\ttag${t.code}\t${img.w}x${img.h}\t${img.ext.slice(1)}\t${img.note}`);
    continue;
  }
  if (!sortie) { console.log(`#${id} ${img.w}x${img.h} ${img.note} (${img.octets.length} o) — préciser un dossier de sortie pour écrire`); continue; }
  fs.mkdirSync(sortie, { recursive: true });
  const dest = path.join(sortie, `bitmap${id}${img.ext}`);
  fs.writeFileSync(dest, img.octets);
  console.log(`#${id} → ${dest}  (${img.w}x${img.h}, ${img.note}, ${img.octets.length} o)`);
  n++;
}
if (voulus.size && sortie) console.log(`${n} image(s) écrite(s)`);
