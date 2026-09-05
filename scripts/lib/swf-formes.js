// Les FORMES d'un SWF, en LISTES DE TRACÉS plutôt qu'en SVG.
//
// extract-swf-shapes.js sort des fichiers SVG : c'est parfait pour poser une
// icône dans une page. Un moteur de jeu qui redessine chaque image sur un
// canvas a besoin d'autre chose — le tracé lui-même (un Path2D), le
// remplissage (couleur, dégradé, image) et le trait, pour dessiner à toute
// échelle sans passer par une rasterisation intermédiaire. C'est le portage
// de Kaluga qui en a eu besoin le premier : sa tzongre tourne et ses pommes
// grossissent, et un SVG rasterisé à une taille fixe y devient flou.
//
// La grammaire lue est la même que celle de l'extracteur SVG (DefineShape 1 à
// 3 : styles, arêtes, tableaux de styles en cours de tracé, recollage des
// arêtes en contours) ; elle est reprise ici telle quelle, avec en plus :
//
//   · les MORPHS (DefineMorphShape), mélangés à un taux donné — même lecture
//     que scripts/lib/swf-morph.js, mais en tracés ;
//   · les TEXTES FIGÉS (DefineText), rendus glyphe par glyphe avec les
//     contours de leur fonte — même lecture que scripts/lib/swf-texte.js.
//
// Le format d'un « dessin » :
//
//   { id, b: [x0, y0, x1, y1],          les bornes déclarées, en pixels
//     m: [a, b, c, d, e, f] | absent,    une matrice posée sur tout le dessin
//     ops: [ { f: <remplissage>, d: <chemin SVG>, m?: [matrice] }
//            { s: { w, c, a }, d: <chemin SVG> } ] }
//
//   remplissage : { c: '#rrggbb', a: 1 }
//               | { g: { r: 0|1 (linéaire/radial), fo: focale, sp: étalement,
//                        m: [matrice], st: [[position, '#rrggbb', alpha]…] } }
//               | { bm: { id, m: [matrice], sm: lissage } }
//
// Toutes les coordonnées sont en PIXELS (les twips du fichier divisés par
// vingt), l'axe y vers le bas — le repère du canvas.

'use strict';

class Bits {
  constructor(b, o) { this.b = b; this.o = o; this.bit = 0; }
  u(n) {
    let v = 0;
    for (let i = 0; i < n; i++) {
      v = (v << 1) | ((this.b[this.o] >> (7 - this.bit)) & 1);
      if (++this.bit === 8) { this.bit = 0; this.o++; }
    }
    return v >>> 0;
  }
  s(n) { if (!n) return 0; const v = this.u(n); return (v & (1 << (n - 1))) ? v - (1 << n) : v; }
  align() { if (this.bit) { this.bit = 0; this.o++; } return this.o; }
}

function lireRect(b, o) {
  const r = new Bits(b, o); const n = r.u(5);
  const v = [r.s(n), r.s(n), r.s(n), r.s(n)]; r.align();
  return { v, fin: r.o };
}
const hex = (r, g, b) => '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
const arr = (v) => Math.round(v * 100) / 100;
const arr5 = (v) => Math.round(v * 1e5) / 1e5;

// Une MATRIX du fichier (twips) → [a, b, c, d, e, f] en pixels.
function lireMatriceBits(m) {
  const M = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  if (m.u(1)) { const n = m.u(5); M.a = m.s(n) / 65536; M.d = m.s(n) / 65536; }
  if (m.u(1)) { const n = m.u(5); M.b = m.s(n) / 65536; M.c = m.s(n) / 65536; }
  const n = m.u(5); M.e = m.s(n); M.f = m.s(n);
  m.align();
  return M;
}
const matricePx = (M) => [arr5(M.a), arr5(M.b), arr5(M.c), arr5(M.d), arr(M.e / 20), arr(M.f / 20)];

// ── Styles ────────────────────────────────────────────────────────────────
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
      const m = new Bits(b, o + 1);
      const M = lireMatriceBits(m);
      let q = m.o;
      let focale = 0;
      if (t === 0x13) { focale = b.readInt16LE(q) / 256; q += 2; }
      const etalement = b[q] >> 6, interpolation = (b[q] >> 4) & 3, nArrets = b[q] & 0x0f; q += 1;
      const arrets = [];
      for (let k = 0; k < nArrets; k++) {
        arrets.push({ ratio: b[q], couleur: hex(b[q + 1], b[q + 2], b[q + 3]), alpha: alpha ? b[q + 4] / 255 : 1 });
        q += alpha ? 5 : 4;
      }
      remplissages.push({ degrade: { radial: t !== 0x10, focale, etalement, interpolation, M, arrets } });
      o = q;
    } else if (t >= 0x40 && t <= 0x43) {
      const m = new Bits(b, o + 3);
      const M = lireMatriceBits(m);
      remplissages.push({ bitmap: b.readUInt16LE(o + 1), M, lisse: t <= 0x41, repete: t === 0x40 || t === 0x42 });
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
      if (((flags >> 4) & 0x03) === 2) q += 2;
      if (aFill) throw new Error('trait à remplissage complexe');
      traits.push({ largeur: b.readUInt16LE(o) / 20, couleur: hex(b[q], b[q + 1], b[q + 2]), alpha: b[q + 3] / 255 });
      o = q + 4;
    } else {
      traits.push({ largeur: b.readUInt16LE(o) / 20, couleur: hex(b[o + 2], b[o + 3], b[o + 4]),
        alpha: alpha ? b[o + 5] / 255 : 1 });
      o += alpha ? 6 : 5;
    }
  }
  return { remplissages, traits, fin: o };
}

// ── Arêtes ────────────────────────────────────────────────────────────────
function lireFormes(b, o, alpha, shape4, tableaux) {
  const r = new Bits(b, o);
  let nFill = r.u(4), nLine = r.u(4);
  let ti = 0;
  let x = 0, y = 0;
  let f0 = 0, f1 = 0, ls = 0;
  const aretes = [];
  for (;;) {
    if (r.u(1) === 0) {
      const nouveaux = r.u(1), trait = r.u(1), fill1 = r.u(1), fill0 = r.u(1), bouge = r.u(1);
      if (!nouveaux && !trait && !fill1 && !fill0 && !bouge) break;
      if (bouge) { const nb = r.u(5); x = r.s(nb); y = r.s(nb); }
      if (fill0) f0 = r.u(nFill);
      if (fill1) f1 = r.u(nFill);
      if (trait) ls = r.u(nLine);
      if (nouveaux) {
        r.align();
        const st = lireStyles(b, r.o, alpha, shape4);
        tableaux.push(st);
        ti = tableaux.length - 1;
        f0 = 0; f1 = 0; ls = 0;
        const suite = new Bits(b, st.fin);
        nFill = suite.u(4); nLine = suite.u(4);
        r.o = suite.o; r.bit = suite.bit;
      }
    } else if (r.u(1) === 1) {
      const nb = r.u(4) + 2;
      let dx = 0, dy = 0;
      if (r.u(1)) { dx = r.s(nb); dy = r.s(nb); } else if (r.u(1)) { dy = r.s(nb); } else { dx = r.s(nb); }
      aretes.push({ ti, f0, f1, ls, x0: x, y0: y, x1: x + dx, y1: y + dy, cx: null, cy: null });
      x += dx; y += dy;
    } else {
      const nb = r.u(4) + 2;
      const cx = x + r.s(nb), cy = y + r.s(nb);
      const x2 = cx + r.s(nb), y2 = cy + r.s(nb);
      aretes.push({ ti, f0, f1, ls, x0: x, y0: y, x1: x2, y1: y2, cx, cy });
      x = x2; y = y2;
    }
  }
  return aretes;
}

// Recolle des arêtes en contours (voir extract-swf-shapes.js pour le pourquoi).
function assembler(aretes) {
  const cle = (x, y) => x + ',' + y;
  const parDebut = new Map();
  for (const a of aretes) {
    const k = cle(a.x0, a.y0);
    if (!parDebut.has(k)) parDebut.set(k, []);
    parDebut.get(k).push(a);
  }
  const contours = [];
  const restantes = new Set(aretes);
  for (const depart of aretes) {
    if (!restantes.has(depart)) continue;
    const contour = [];
    let a = depart;
    for (;;) {
      restantes.delete(a);
      contour.push(a);
      const suite = (parDebut.get(cle(a.x1, a.y1)) || []).find((c) => restantes.has(c));
      if (!suite) break;
      a = suite;
      if (a === depart) break;
    }
    contours.push(contour);
  }
  return contours;
}

const PX = (v) => Math.round(v / 20 * 100) / 100;
function tracer(contour, ferme) {
  const a0 = contour[0];
  let d = `M${PX(a0.x0)} ${PX(a0.y0)}`;
  for (const a of contour) {
    d += a.cx === null ? `L${PX(a.x1)} ${PX(a.y1)}` : `Q${PX(a.cx)} ${PX(a.cy)} ${PX(a.x1)} ${PX(a.y1)}`;
  }
  return d + (ferme ? 'Z' : '');
}
const retourner = (a) => ({ ti: a.ti, f0: a.f0, f1: a.f1, ls: a.ls, x0: a.x1, y0: a.y1, x1: a.x0, y1: a.y0, cx: a.cx, cy: a.cy });
function grouper(aretes) {
  const parFill = new Map(), parTrait = new Map();
  const ranger = (carte, cle, a) => { if (!carte.has(cle)) carte.set(cle, []); carte.get(cle).push(a); };
  for (const a of aretes) {
    if (a.f1) ranger(parFill, a.ti + ':' + a.f1, a);
    if (a.f0) ranger(parFill, a.ti + ':' + a.f0, retourner(a));
    if (a.ls) ranger(parTrait, a.ti + ':' + a.ls, a);
  }
  return { parFill, parTrait };
}
const cleTriee = (a, b) => {
  const [ta, sa] = a.split(':').map(Number), [tb, sb] = b.split(':').map(Number);
  return ta - tb || sa - sb;
};

// Le remplissage d'un style, au format du dessin.
function remplissage(s) {
  if (s.bitmap !== undefined) {
    // La matrice d'un remplissage par image va des PIXELS de l'image aux
    // TWIPS de la forme : en pixels de forme, ses six coefficients se divisent
    // par vingt (celle d'un dégradé, de twips en twips, garde sa partie linéaire).
    const M = s.M;
    return { bm: { id: s.bitmap, m: [arr5(M.a / 20), arr5(M.b / 20), arr5(M.c / 20), arr5(M.d / 20), arr(M.e / 20), arr(M.f / 20)],
      sm: s.lisse ? 1 : 0, rp: s.repete ? 1 : 0 } };
  }
  if (s.degrade) {
    const g = s.degrade;
    return { g: { r: g.radial ? 1 : 0, fo: g.focale || 0, sp: g.etalement || 0, m: matricePx(g.M),
      st: g.arrets.map((a) => [arr5(a.ratio / 255), a.couleur, arr5(a.alpha)]) } };
  }
  return { c: s.couleur, a: arr5(s.alpha) };
}

/**
 * Un DefineShape (2/22/32/83) en dessin. `tag` = { code, corps } — `corps` est le
 * décalage du corps du tag dans le buffer décompressé.
 */
function dessinForme(b, tag) {
  const code = tag.code;
  const alpha = code === 32 || code === 83;
  const shape4 = code === 83;
  let o = tag.corps;
  const id = b.readUInt16LE(o); o += 2;
  const rc = lireRect(b, o); o = rc.fin;
  if (shape4) { o = lireRect(b, o).fin; o += 1; }
  const tableaux = [lireStyles(b, o, alpha, shape4)];
  const aretes = lireFormes(b, tableaux[0].fin, alpha, shape4, tableaux);
  const { parFill, parTrait } = grouper(aretes);
  const ops = [];
  for (const cle of [...parFill.keys()].sort(cleTriee)) {
    const [ti, fi] = cle.split(':').map(Number);
    const s = (tableaux[ti] || { remplissages: [] }).remplissages[fi - 1];
    if (!s) continue;
    const d = assembler(parFill.get(cle)).map((c) => tracer(c, true)).join('');
    if (!d) continue;
    ops.push({ f: remplissage(s), d });
  }
  for (const cle of [...parTrait.keys()].sort(cleTriee)) {
    const [ti, li] = cle.split(':').map(Number);
    const s = (tableaux[ti] || { traits: [] }).traits[li - 1];
    if (!s) continue;
    const d = assembler(parTrait.get(cle)).map((c) => tracer(c, false)).join('');
    if (!d) continue;
    ops.push({ s: { w: arr(s.largeur), c: s.couleur, a: arr5(s.alpha) }, d });
  }
  const [x0, x1, y0, y1] = rc.v;
  return { id, b: [arr(x0 / 20), arr(y0 / 20), arr(x1 / 20), arr(y1 / 20)], ops };
}

// ── Morphs ────────────────────────────────────────────────────────────────
const melange = (a, b, t) => a + (b - a) * t;
const melangeCouleur = (a, b, t) => ({
  r: Math.round(melange(a.r, b.r, t)), v: Math.round(melange(a.v, b.v, t)),
  b: Math.round(melange(a.b, b.b, t)), a: melange(a.a, b.a, t) / 255,
});
const enHexa = (c) => '#' + [c.r, c.v, c.b].map((n) => n.toString(16).padStart(2, '0')).join('');

/**
 * Un morph (lu par swf-morph.lireMorphs) mélangé au taux t (0..1), en dessin.
 * Même algorithme que swf-morph.versSvg : un chemin par style de remplissage.
 */
function dessinMorph(m, t) {
  const T = 20;
  const bd = {
    x0: melange(m.bounds[0].x0, m.bounds[1].x0, t) / T, x1: melange(m.bounds[0].x1, m.bounds[1].x1, t) / T,
    y0: melange(m.bounds[0].y0, m.bounds[1].y0, t) / T, y1: melange(m.bounds[0].y1, m.bounds[1].y1, t) / T,
  };
  const geoB = m.b.filter((e) => e.type !== 'fill0' && e.type !== 'fill1' && e.type !== 'trait');
  let iB = 0;
  const point = (e) => {
    const f = geoB[iB++];
    if (!f || f.type !== e.type) return e;
    const p = { type: e.type, x: melange(e.x, f.x, t), y: melange(e.y, f.y, t) };
    if (e.type === 'courbe') { p.cx = melange(e.cx, f.cx, t); p.cy = melange(e.cy, f.cy, t); }
    return p;
  };
  const chemins = new Map();
  let styleCourant = 0, d = '', ouvert = false;
  let cx = 0, cy = 0;
  const finir = () => {
    if (!ouvert || !d) return;
    if (styleCourant > 0) {
      const l = chemins.get(styleCourant) || [];
      l.push(d + 'Z');
      chemins.set(styleCourant, l);
    }
    d = '';
  };
  const px = (v) => arr(v / T);
  for (const e of m.a) {
    if (e.type === 'fill1' || e.type === 'fill0') {
      finir();
      styleCourant = e.style;
      ouvert = true;
      d = `M${px(cx)} ${px(cy)}`;
      continue;
    }
    if (e.type === 'trait') continue;
    const p = point(e);
    cx = p.x; cy = p.y;
    if (p.type === 'move') { finir(); d = `M${px(p.x)} ${px(p.y)}`; ouvert = true; }
    else if (p.type === 'ligne') d += `L${px(p.x)} ${px(p.y)}`;
    else d += `Q${px(p.cx)} ${px(p.cy)} ${px(p.x)} ${px(p.y)}`;
  }
  finir();
  const ops = [];
  for (const [num, liste] of chemins) {
    const st = m.styles[num - 1];
    let f = { c: '#000000', a: 1 };
    if (st && st.type === 0x00) {
      const c = melangeCouleur(st.c0, st.c1, t);
      f = { c: enHexa(c), a: arr5(c.a) };
    } else if (st && (st.type === 0x10 || st.type === 0x12 || st.type === 0x13)) {
      const M = {
        a: melange(st.m0.a, st.m1.a, t), b: melange(st.m0.b, st.m1.b, t),
        c: melange(st.m0.c, st.m1.c, t), d: melange(st.m0.d, st.m1.d, t),
        e: melange(st.m0.e, st.m1.e, t), f: melange(st.m0.f, st.m1.f, t),
      };
      f = { g: { r: st.type === 0x10 ? 0 : 1, fo: 0, sp: 0, m: matricePx(M),
        st: st.arrets.map((s) => { const c = melangeCouleur(s.c0, s.c1, t); return [arr5(melange(s.t0, s.t1, t) / 255), enHexa(c), arr5(c.a)]; }) } };
    }
    ops.push({ f, d: liste.join('') });
  }
  return { id: m.id, b: [arr(bd.x0), arr(bd.y0), arr(bd.x1), arr(bd.y1)], ops };
}

// ── Textes figés ──────────────────────────────────────────────────────────
/**
 * Un DefineText (lu par swf-texte.lireTextes : `statiques` + `fontes`) en
 * dessin : chaque glyphe est un remplissage à sa plume, mis à l'échelle
 * taille/1024 — la définition même du rendu Flash.
 */
function dessinTexte(t, fontes) {
  const ops = [];
  for (const run of t.runs) {
    const fonte = fontes.get(run.fonte);
    if (!fonte) continue;
    const s = arr5(run.taille / 20 / 1024);
    const y = arr(run.y / 20);
    for (const g of run.glyphes) {
      const d = fonte.glyphes[g.idx];
      if (!d) continue;
      ops.push({ f: { c: run.couleur, a: 1 }, d, m: [s, 0, 0, s, arr(g.x / 20), y] });
    }
  }
  const M = t.matrice;
  const dessin = { id: t.id, b: [arr(t.bounds.x0 / 20), arr(t.bounds.y0 / 20), arr(t.bounds.x1 / 20), arr(t.bounds.y1 / 20)], ops };
  const m = matricePx(M);
  if (m.join(',') !== '1,0,0,1,0,0') dessin.m = m;
  return dessin;
}

module.exports = { dessinForme, dessinMorph, dessinTexte, lireRect, lireMatriceBits, matricePx, Bits, arr, arr5 };
