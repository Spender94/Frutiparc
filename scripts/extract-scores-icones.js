#!/usr/bin/env node
// Sort les ICÔNES de la fenêtre « Scores » du bureau, pour que le portage light
// affiche les mêmes.
//
//   node scripts/extract-scores-icones.js <capture.png>
//
// ── D'où elles viennent ──
//
// La fenêtre des scores de main.swf pose trois petites images :
//
//   · un PODIUM (1-2-3) devant le titre « Challenge » ;
//   · une COUPE devant le titre « Championnat » ;
//   · une MÉDAILLE à couronne de laurier devant CHAQUE ligne de classement
//     (la même pour tous les jeux — ce n'est pas l'icône du jeu).
//
// Elles sont dessinées à l'intérieur du binaire, mêlées à des centaines d'autres
// formes : les retrouver par identifiant serait un pari. On les prend donc là où
// elles sont sûres — dans un RENDU de la vraie fenêtre (Ruffle, ×2), en
// découpant à la boîte exacte des pixels qui ne sont pas le fond du panneau.
//
// Le fond est détouré : chaque pixel proche de la couleur du panneau (le
// dégradé #FDEDC8 → #FBD888) devient transparent, avec une transition douce sur
// les pixels intermédiaires pour ne pas hacher les bords antialiasés. Les
// icônes sont ainsi posables sur n'importe quel fond.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SORTIE = path.resolve(__dirname, '..', 'public', 'fb');

// Les zones où chercher, dans la capture ×2 de la fenêtre (cf. le mode d'emploi
// en tête : capture de 1000×480 prise sur /legacy, fenêtre en haut à gauche).
const CIBLES = [
  { nom: 'score_podium',   boite: [14, 48, 70, 100] },
  { nom: 'score_medaille', boite: [36, 100, 72, 132] },
  { nom: 'score_coupe',    boite: [14, 380, 74, 440] },
];

// Le fond du panneau : dégradé vertical clair → doré.
const FOND = [[0xFD, 0xED, 0xC8], [0xFB, 0xD8, 0x88], [0xFA, 0xCE, 0x68], [0xFC, 0xE4, 0xAB]];

function lirePng(p) {
  const d = fs.readFileSync(p);
  let pos = 8, idat = [], w = 0, h = 0, ctype = 0;
  while (pos < d.length) {
    const ln = d.readUInt32BE(pos), typ = d.toString('ascii', pos + 4, pos + 8);
    const corps = d.slice(pos + 8, pos + 8 + ln);
    if (typ === 'IHDR') { w = corps.readUInt32BE(0); h = corps.readUInt32BE(4); ctype = corps[9]; }
    else if (typ === 'IDAT') idat.push(corps);
    else if (typ === 'IEND') break;
    pos += 12 + ln;
  }
  const brut = zlib.inflateSync(Buffer.concat(idat));
  const ca = { 0: 1, 2: 3, 4: 2, 6: 4 }[ctype];
  if (!ca) throw new Error('type de PNG non géré : ' + ctype);
  const stride = w * ca;
  const px = Buffer.alloc(stride * h);
  let i = 0, prec = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = brut[i++];
    const l = Buffer.from(brut.slice(i, i + stride)); i += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ca ? l[x - ca] : 0, b = prec[x], c = x >= ca ? prec[x - ca] : 0;
      if (f === 1) l[x] = (l[x] + a) & 255;
      else if (f === 2) l[x] = (l[x] + b) & 255;
      else if (f === 3) l[x] = (l[x] + ((a + b) >> 1)) & 255;
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        l[x] = (l[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    }
    l.copy(px, y * stride); prec = l;
  }
  return { w, h, ca, px };
}

function ecrirePng(p, w, h, rgba) {
  const brut = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    brut[y * (w * 4 + 1)] = 0;
    rgba.copy(brut, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const bloc = (typ, data) => {
    const c = Buffer.concat([Buffer.from(typ, 'ascii'), data]);
    return Buffer.concat([
      Buffer.from([data.length >>> 24 & 255, data.length >>> 16 & 255, data.length >>> 8 & 255, data.length & 255]),
      c,
      Buffer.from([zlib.crc32 ? 0 : 0, 0, 0, 0]).fill(0),
    ]);
  };
  // CRC32 maison (zlib.crc32 n'existe pas partout).
  const table = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  const crc = (buf) => {
    let c = 0xFFFFFFFF;
    for (const o of buf) c = table[(c ^ o) & 255] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  };
  const chunk = (typ, data) => {
    const c = Buffer.concat([Buffer.from(typ, 'ascii'), data]);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(c));
    return Buffer.concat([len, c, cr]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  fs.writeFileSync(p, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(brut)), chunk('IEND', Buffer.alloc(0)),
  ]));
}

// Distance au fond le plus proche (0 = c'est le fond).
function ecartAuFond(r, g, b) {
  let min = 1e9;
  for (const [fr, fg, fb] of FOND) {
    const d = Math.abs(r - fr) + Math.abs(g - fg) + Math.abs(b - fb);
    if (d < min) min = d;
  }
  return min;
}

function extraire(source) {
  const img = lirePng(source);
  console.log(`capture ${img.w}×${img.h}, ${img.ca} canaux`);
  const lire = (x, y) => {
    const o = (y * img.w + x) * img.ca;
    return [img.px[o], img.px[o + 1], img.px[o + 2]];
  };

  for (const { nom, boite } of CIBLES) {
    const [bx0, by0, bx1, by1] = boite;
    // Boîte serrée : les pixels nettement différents du fond.
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (let y = by0; y < by1; y++) {
      for (let x = bx0; x < bx1; x++) {
        const [r, g, b] = lire(x, y);
        if (ecartAuFond(r, g, b) > 60) {
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) { console.log(`  ${nom} : rien trouvé dans ${boite.join(',')}`); continue; }
    x0 -= 1; y0 -= 1; x1 += 1; y1 += 1;
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const rgba = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const [r, g, b] = lire(x0 + x, y0 + y);
        const d = ecartAuFond(r, g, b);
        // Détourage doux : opaque dès 60 d'écart, transparent sous 18.
        const a = d <= 18 ? 0 : d >= 60 ? 255 : Math.round(((d - 18) / 42) * 255);
        const o = (y * w + x) * 4;
        rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = a;
      }
    }
    const cible = path.join(SORTIE, nom + '.png');
    ecrirePng(cible, w, h, rgba);
    console.log(`  ${nom}.png — ${w}×${h} (capture ×2 → ${w / 2}×${h / 2} à l'écran)`);
  }
}

const source = process.argv[2];
if (!source) {
  console.error('usage : extract-scores-icones.js <capture-fenetre-scores.png>');
  console.error('  (capture ×2 de /legacy, fenêtre Scores ouverte en haut à gauche,');
  console.error('   découpée en x:8 y:148 l:500 h:240 — cf. le mode d\'emploi en tête)');
  process.exit(1);
}
extraire(source);
