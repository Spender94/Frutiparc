#!/usr/bin/env node
// Extrait des DefineShape d'un SWF vers des fichiers SVG.
//
// Sert à récupérer les petites icônes vectorielles du bureau (main.swf) pour les
// réutiliser telles quelles dans le client mobile : les redessiner à la main
// donnerait un « à peu près », alors que le tracé d'origine est là, exact.
//
//   node scripts/extract-swf-shapes.js <fichier.swf> <sortie/> [id…]
//
// Sans identifiants, liste les formes avec leur taille et leurs couleurs — c'est
// ainsi qu'on repère celle qu'on cherche.
//
// Ce qui est géré : DefineShape 1 à 4, remplissages UNIS (les seuls qu'utilisent
// ces icônes), arêtes droites et courbes quadratiques. Les dégradés et les
// remplissages bitmap sont signalés puis ignorés — aucune des icônes visées n'en
// utilise, et deviner un rendu approximatif serait pire que de le dire.
//
// Repères du format : les coordonnées sont en TWIPS (1/20 de pixel), l'axe y est
// orienté vers le bas comme en SVG, et un enregistrement de style change le
// remplissage « courant » en cours de tracé — d'où l'accumulation par style.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function lireSwf(p) {
  const raw = fs.readFileSync(p);
  const sig = raw.slice(0, 3).toString('ascii');
  if (sig !== 'CWS' && sig !== 'FWS') throw new Error('Signature inconnue : ' + sig);
  return sig === 'CWS' ? zlib.inflateSync(raw.slice(8)) : raw.slice(8);
}

class Bits {
  constructor(b, o) { this.b = b; this.o = o; this.bit = 0; }
  u(n) { let v = 0; for (let i = 0; i < n; i++) { v = (v << 1) | ((this.b[this.o] >> (7 - this.bit)) & 1); if (++this.bit === 8) { this.bit = 0; this.o++; } } return v >>> 0; }
  s(n) { if (!n) return 0; const v = this.u(n); return (v & (1 << (n - 1))) ? v - (1 << n) : v; }
  align() { if (this.bit) { this.bit = 0; this.o++; } }
}
function lireRect(b, o) {
  const r = new Bits(b, o); const n = r.u(5);
  const v = [r.s(n), r.s(n), r.s(n), r.s(n)]; r.align();
  return { v, fin: r.o };
}
const hex = (r, g, b) => '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');

// FILLSTYLEARRAY puis LINESTYLEARRAY. `alpha` : Shape3/4 portent une composante
// alpha sur les couleurs.
function lireStyles(b, o, alpha, shape4) {
  const remplissages = [];
  let n = b[o]; o += 1;
  if (n === 0xff) { n = b.readUInt16LE(o); o += 2; }
  for (let i = 0; i < n; i++) {
    const t = b[o];
    if (t === 0x00) {
      const a = alpha ? b[o + 4] / 255 : 1;
      remplissages.push({ couleur: hex(b[o + 1], b[o + 2], b[o + 3]), alpha: a });
      o += alpha ? 5 : 4;
    } else if (t === 0x10 || t === 0x12 || t === 0x13) {
      remplissages.push({ degrade: true });               // signalé, non rendu
      const m = new Bits(b, o + 1);
      if (m.u(1)) { const nb = m.u(5); m.s(nb); m.s(nb); }
      if (m.u(1)) { const nb = m.u(5); m.s(nb); m.s(nb); }
      const nb = m.u(5); m.s(nb); m.s(nb); m.align();
      let q = m.o;
      if (t === 0x13) q += 2;                              // focal
      const nArrets = b[q] & 0x0f; q += 1;
      q += nArrets * (alpha ? 5 : 4);
      o = q;
    } else if (t >= 0x40 && t <= 0x43) {
      remplissages.push({ bitmap: true });
      const m = new Bits(b, o + 3);
      if (m.u(1)) { const nb = m.u(5); m.s(nb); m.s(nb); }
      if (m.u(1)) { const nb = m.u(5); m.s(nb); m.s(nb); }
      const nb = m.u(5); m.s(nb); m.s(nb); m.align();
      o = m.o;
    } else throw new Error('type de remplissage inconnu : 0x' + t.toString(16));
  }
  const traits = [];
  let ln = b[o]; o += 1;
  if (ln === 0xff) { ln = b.readUInt16LE(o); o += 2; }
  for (let i = 0; i < ln; i++) {
    if (shape4) {
      const flags = b.readUInt16LE(o + 2);
      const aFill = (flags & 0x0008) !== 0;
      let q = o + 4;
      if (((flags >> 4) & 0x03) === 2) q += 2;             // joint mitre
      if (aFill) throw new Error('trait à remplissage complexe');
      traits.push({ largeur: b.readUInt16LE(o) / 20, couleur: hex(b[q], b[q + 1], b[q + 2]) });
      o = q + 4;
    } else {
      traits.push({ largeur: b.readUInt16LE(o) / 20, couleur: hex(b[o + 2], b[o + 3], b[o + 4]) });
      o += alpha ? 6 : 5;
    }
  }
  return { remplissages, traits, fin: o };
}

// SHAPERECORDs → un tracé par style de remplissage.
function lireFormes(b, o, nbRemplissages, nbTraits, alpha, shape4) {
  const r = new Bits(b, o);
  let nFill = r.u(4), nLine = r.u(4);
  let x = 0, y = 0;
  let f0 = 0, f1 = 0, ls = 0;
  const parFill = new Map(), parTrait = new Map();
  let dFill = '', dTrait = '';
  const N = (v) => Math.round(v / 20 * 100) / 100;
  const pousser = () => {
    if (dFill && f1) parFill.set(f1, (parFill.get(f1) || '') + dFill);
    if (dFill && f0) parFill.set(f0, (parFill.get(f0) || '') + dFill);
    if (dTrait && ls) parTrait.set(ls, (parTrait.get(ls) || '') + dTrait);
    dFill = ''; dTrait = '';
  };
  let debutX = 0, debutY = 0, ouvert = false;
  for (;;) {
    if (r.u(1) === 0) {
      const nouveaux = r.u(1), trait = r.u(1), fill1 = r.u(1), fill0 = r.u(1), bouge = r.u(1);
      if (!nouveaux && !trait && !fill1 && !fill0 && !bouge) break;
      pousser();
      if (bouge) { const nb = r.u(5); x = r.s(nb); y = r.s(nb); debutX = x; debutY = y; ouvert = false; }
      if (fill0) f0 = r.u(nFill);
      if (fill1) f1 = r.u(nFill);
      if (trait) ls = r.u(nLine);
      if (nouveaux) break;   // nouveaux styles en cours de forme : hors périmètre
      const deb = `M${N(x)} ${N(y)}`;
      dFill += deb; dTrait += deb; ouvert = true;
    } else if (r.u(1) === 1) {
      const nb = r.u(4) + 2;
      if (r.u(1)) { x += r.s(nb); y += r.s(nb); }
      else if (r.u(1)) { y += r.s(nb); }
      else { x += r.s(nb); }
      const seg = `L${N(x)} ${N(y)}`;
      dFill += seg; dTrait += seg;
    } else {
      const nb = r.u(4) + 2;
      const cx = x + r.s(nb), cy = y + r.s(nb);
      x = cx + r.s(nb); y = cy + r.s(nb);
      const seg = `Q${N(cx)} ${N(cy)} ${N(x)} ${N(y)}`;
      dFill += seg; dTrait += seg;
    }
  }
  pousser();
  return { parFill, parTrait };
}

function extraire(b, tag) {
  const code = tag.code;
  const alpha = code === 32 || code === 83;
  const shape4 = code === 83;
  let o = tag.corps;
  const id = b.readUInt16LE(o); o += 2;
  const rc = lireRect(b, o); o = rc.fin;
  if (shape4) { o = lireRect(b, o).fin; o += 1; }          // EdgeBounds + flags
  const st = lireStyles(b, o, alpha, shape4);
  const { parFill, parTrait } = lireFormes(b, st.fin, st.remplissages.length, st.traits.length, alpha, shape4);
  return { id, bounds: rc.v, styles: st, parFill, parTrait };
}

function versSvg(f) {
  const [x0, x1, y0, y1] = f.bounds.map((v) => v / 20);
  let corps = '';
  for (const [i, d] of f.parFill) {
    const s = f.styles.remplissages[i - 1];
    if (!s || s.degrade || s.bitmap) continue;
    corps += `  <path d="${d}Z" fill="${s.couleur}"` +
      (s.alpha < 1 ? ` fill-opacity="${Math.round(s.alpha * 100) / 100}"` : '') +
      ` fill-rule="evenodd"/>\n`;
  }
  for (const [i, d] of f.parTrait) {
    const s = f.styles.traits[i - 1];
    if (!s) continue;
    corps += `  <path d="${d}" fill="none" stroke="${s.couleur}" stroke-width="${s.largeur}"/>\n`;
  }
  const l = Math.max(0.01, x1 - x0), h = Math.max(0.01, y1 - y0);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${y0} ${l} ${h}" width="${l}" height="${h}">\n${corps}</svg>\n`;
}

// ─── Parcours des tags ───
const [, , fichier, sortie, ...ids] = process.argv;
if (!fichier) {
  console.error('usage : extract-swf-shapes.js <fichier.swf> [sortie/] [id…]');
  process.exit(1);
}
const b = lireSwf(fichier);
const rectBytes = (x) => Math.ceil((5 + ((x[0] >> 3) & 0x1f) * 4) / 8);
const tags = [];
(function scan(from, to) {
  let o = from;
  while (o < to) {
    const hdr = b.readUInt16LE(o), code = hdr >> 6;
    let len = hdr & 0x3f, hs = 2;
    if (len === 0x3f) { len = b.readUInt32LE(o + 2); hs = 6; }
    if (code === 0) break;
    if (code === 39) scan(o + hs + 4, o + hs + len);
    if ([2, 22, 32, 83].includes(code)) tags.push({ code, corps: o + hs, len });
    o += hs + len;
  }
})(rectBytes(b) + 4, b.length);

const voulus = new Set(ids.map(Number));
let n = 0;
for (const t of tags) {
  let f;
  try { f = extraire(b, t); } catch (e) {
    if (voulus.size && voulus.has(b.readUInt16LE(t.corps))) console.error(`  #${b.readUInt16LE(t.corps)} : ${e.message}`);
    continue;
  }
  if (voulus.size && !voulus.has(f.id)) continue;
  const [x0, x1, y0, y1] = f.bounds.map((v) => v / 20);
  const cols = f.styles.remplissages.map((s) => s.degrade ? 'dégradé' : s.bitmap ? 'bitmap' : s.couleur);
  if (!voulus.size) {
    console.log(`#${f.id}\tshape${t.code}\t${(x1 - x0).toFixed(2)}x${(y1 - y0).toFixed(2)}\t${cols.join(' ')}`);
    continue;
  }
  if (!sortie) { console.log(versSvg(f)); continue; }
  fs.mkdirSync(sortie, { recursive: true });
  const dest = path.join(sortie, `shape${f.id}.svg`);
  fs.writeFileSync(dest, versSvg(f));
  console.log(`#${f.id} → ${dest}  (${(x1 - x0).toFixed(2)}x${(y1 - y0).toFixed(2)}, ${cols.join(' ')})`);
  n++;
}
if (voulus.size) console.log(`${n} forme(s) écrite(s)`);
