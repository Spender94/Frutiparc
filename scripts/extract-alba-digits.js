#!/usr/bin/env node
// Extrait les glyphes de la police ALBA — celle des titres de Frutisnake
// (« Pause », « Game over ») — depuis Games/snake3/snake3.swf, et les écrit en
// tracés SVG dans public/fb/alba-glyphs.json.
//
// Pourquoi passer par du SVG plutôt qu'un fichier de police : Alba n'existe nulle
// part sur le disque, elle ne vit que dans le SWF sous forme de contours. Les
// convertir en <path> donne la typographie EXACTE du jeu, et permet en prime le
// contour blanc + le dégradé rouge demandés (paint-order: stroke fill), ce qu'une
// webfont ne saurait pas faire seule.
//
// Format DefineFont2 (tag 48) : en-tête, table d'offsets, formes des glyphes,
// table des codes de caractères, puis — si HasLayout — ascendante/descendante et
// table des chasses. Les contours sont exprimés dans un cadratin de 1024 unités,
// ligne de base à y=0, l'axe y descendant (comme en SVG).

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const IN_PATH = path.resolve(__dirname, '..', 'Games', 'snake3', 'snake3.swf');
const OUT_PATH = path.resolve(__dirname, '..', 'public', 'fb', 'alba-glyphs.json');
const FONT_NAME = 'Alba';
// Chiffres + le nécessaire pour « 12 s » et « — ».
const WANTED = '0123456789s-'.split('');

// ─── Lecture de bits ───
class Bits {
  constructor(buf, pos) { this.b = buf; this.pos = pos; this.bit = 0; }
  ub(n) {
    let v = 0;
    for (let i = 0; i < n; i++) {
      v = (v << 1) | ((this.b[this.pos] >> (7 - this.bit)) & 1);
      if (++this.bit === 8) { this.bit = 0; this.pos++; }
    }
    return v >>> 0;
  }
  sb(n) { if (!n) return 0; const v = this.ub(n); return (v & (1 << (n - 1))) ? v - (1 << n) : v; }
}

// ─── Une forme de glyphe → tracé SVG ───
function glyphToPath(buf, start) {
  const r = new Bits(buf, start);
  const nFill = r.ub(4), nLine = r.ub(4);
  let x = 0, y = 0, d = '', open = false;
  const N = (v) => (Math.round(v * 100) / 100);
  for (;;) {
    if (r.ub(1) === 0) {                          // enregistrement « non-arête »
      const newStyles = r.ub(1), lineStyle = r.ub(1), fill1 = r.ub(1), fill0 = r.ub(1), moveTo = r.ub(1);
      if (!newStyles && !lineStyle && !fill1 && !fill0 && !moveTo) break;   // fin de forme
      if (moveTo) { const nb = r.ub(5); x = r.sb(nb); y = r.sb(nb); d += (open ? 'Z' : '') + `M${N(x)} ${N(y)}`; open = true; }
      if (fill0) r.ub(nFill);
      if (fill1) r.ub(nFill);
      if (lineStyle) r.ub(nLine);
      // StateNewStyles n'existe pas dans les glyphes de police : rien à lire.
    } else if (r.ub(1) === 1) {                   // arête droite
      const nb = r.ub(4) + 2;
      if (r.ub(1)) { x += r.sb(nb); y += r.sb(nb); }
      else if (r.ub(1)) { y += r.sb(nb); }
      else { x += r.sb(nb); }
      d += `L${N(x)} ${N(y)}`;
    } else {                                      // arête courbe (quadratique)
      const nb = r.ub(4) + 2;
      const cx = x + r.sb(nb), cy = y + r.sb(nb);
      x = cx + r.sb(nb); y = cy + r.sb(nb);
      d += `Q${N(cx)} ${N(cy)} ${N(x)} ${N(y)}`;
    }
  }
  return open ? d + 'Z' : d;
}

// ─── SWF ───
const raw = fs.readFileSync(IN_PATH);
const sig = raw.slice(0, 3).toString('ascii');
const body = sig === 'CWS' ? zlib.inflateSync(raw.slice(8)) : raw.slice(8);
const rectBytes = (b) => Math.ceil((5 + ((b[0] >> 3) & 0x1f) * 4) / 8);

let off = rectBytes(body) + 4, tag = null;
while (off < body.length) {
  const hdr = body.readUInt16LE(off), code = hdr >> 6;
  let len = hdr & 0x3f, hs = 2;
  if (len === 0x3f) { len = body.readUInt32LE(off + 2); hs = 6; }
  if (code === 0) break;
  if (code === 48) {
    const d = body.slice(off + hs, off + hs + len);
    const nlen = d[4];
    if (d.toString('latin1', 5, 5 + nlen).replace(/\0/g, '') === FONT_NAME) { tag = d; break; }
  }
  off += hs + len;
}
if (!tag) throw new Error(`police ${FONT_NAME} introuvable`);

const flags = tag[2];
const HAS_LAYOUT = !!(flags & 0x80), WIDE_OFFSETS = !!(flags & 0x08), WIDE_CODES = !!(flags & 0x04);
const nameLen = tag[4];
let p = 5 + nameLen;
const nGlyphs = tag.readUInt16LE(p); p += 2;

const tableStart = p;                              // les offsets partent d'ici
const readOff = (i) => (WIDE_OFFSETS ? tag.readUInt32LE(tableStart + i * 4) : tag.readUInt16LE(tableStart + i * 2));
const codeTableOffset = readOff(nGlyphs);          // l'entrée n+1 = début de la table des codes

// Codes de caractères
let cp = tableStart + codeTableOffset;
const codes = [];
for (let i = 0; i < nGlyphs; i++) { codes.push(WIDE_CODES ? tag.readUInt16LE(cp) : tag[cp]); cp += WIDE_CODES ? 2 : 1; }

// Métriques
let ascent = 800, descent = 200, advances = null;
if (HAS_LAYOUT) {
  let q = cp;
  ascent = tag.readInt16LE(q); q += 2;
  descent = tag.readInt16LE(q); q += 2;
  q += 2;                                          // interligne
  advances = [];
  for (let i = 0; i < nGlyphs; i++) { advances.push(tag.readInt16LE(q)); q += 2; }
}

// ─── Sélection ───
const glyphs = {};
for (const ch of WANTED) {
  const i = codes.indexOf(ch.charCodeAt(0));
  if (i < 0) { console.warn(`  ! glyphe absent : ${JSON.stringify(ch)}`); continue; }
  glyphs[ch] = { d: glyphToPath(tag, tableStart + readOff(i)), adv: advances ? advances[i] : 600 };
}

// Boîte englobante réelle des chiffres. L'ascendante déclarée par la police
// (1110) couvre accents et hampes : s'en servir comme viewBox rendrait les
// chiffres deux fois trop petits dans une hauteur donnée. On mesure donc la
// vraie emprise verticale des glyphes, points de contrôle compris (majorant sûr).
function boiteY(d) {
  let y0 = Infinity, y1 = -Infinity;
  const re = /[MLQ]([-\d.]+) ([-\d.]+)(?: ([-\d.]+) ([-\d.]+))?/g;
  let m;
  while ((m = re.exec(d))) {
    for (const v of [m[2], m[4]]) {
      if (v === undefined) continue;
      const y = parseFloat(v);
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return [y0, y1];
}
let hautChiffres = Infinity, basChiffres = -Infinity;
for (const ch of '0123456789') {
  if (!glyphs[ch]) continue;
  const [a, b] = boiteY(glyphs[ch].d);
  if (a < hautChiffres) hautChiffres = a;
  if (b > basChiffres) basChiffres = b;
}

const out = { police: FONT_NAME, cadratin: 1024, ascendante: ascent, descendante: descent,
              hautChiffres, basChiffres, glyphes: glyphs };
fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
fs.writeFileSync(OUT_PATH, JSON.stringify(out));
console.log(`${FONT_NAME} : ${nGlyphs} glyphes dans le SWF, ${Object.keys(glyphs).length} extraits`);
console.log(`ascendante=${ascent} descendante=${descent}`);
console.log(`boîte des chiffres : y ${hautChiffres} → ${basChiffres} (hauteur ${basChiffres - hautChiffres})`);
console.log(`Écrit ${OUT_PATH} (${fs.statSync(OUT_PATH).size} o)`);
