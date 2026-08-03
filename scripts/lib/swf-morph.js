// Lecture des formes MORPHÉES d'un SWF (DefineMorphShape 45 / MorphShape2 46).
//
// Un morph n'est pas un dessin mais DEUX, plus la promesse que Flash sait
// passer de l'un à l'autre. Le fichier range la forme de départ, celle
// d'arrivée, et deux jeux de styles ; le taux de mélange arrive au moment du
// placement (le champ `ratio` de PlaceObject2, sur 16 bits, de 0 à 65535).
//
// C'est ainsi qu'est fait le ciel de Minipixiz : cent une images d'un même
// dégradé qui se déforme du lever au coucher du soleil. Sans lire le morph, on
// n'a pas de ciel du tout — et le ciel, dans ce jeu, EST l'horloge.
//
// On ne réimplémente pas Flash : on lit les deux formes, on interpole leurs
// points et leurs couleurs à un taux donné, et on écrit un SVG. Les deux
// contours ont, par construction du format, la même suite d'arêtes — c'est ce
// qui rend l'interpolation possible point par point.

'use strict';

const { lireSwf } = require('./swf-sprites.js');

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
  aligner() { if (this.bit) { this.bit = 0; this.o++; } return this.o; }
  rect() {
    const n = this.u(5);
    const r = { x0: this.s(n), x1: this.s(n), y0: this.s(n), y1: this.s(n) };
    this.aligner();
    return r;
  }
  matrice() {
    const M = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    if (this.u(1)) { const n = this.u(5); M.a = this.s(n) / 65536; M.d = this.s(n) / 65536; }
    if (this.u(1)) { const n = this.u(5); M.b = this.s(n) / 65536; M.c = this.s(n) / 65536; }
    const n = this.u(5); M.e = this.s(n); M.f = this.s(n);
    this.aligner();
    return M;
  }
  rgba() {
    const c = { r: this.b[this.o], v: this.b[this.o + 1], b: this.b[this.o + 2], a: this.b[this.o + 3] };
    this.o += 4;
    return c;
  }
  u8() { return this.b[this.o++]; }
  u16() { const v = this.b.readUInt16LE(this.o); this.o += 2; return v; }
  u32() { const v = this.b.readUInt32LE(this.o); this.o += 4; return v; }
}

// MORPHFILLSTYLEARRAY — chaque style existe en deux exemplaires, début et fin.
function lireStyles(r) {
  let n = r.u8();
  if (n === 0xFF) n = r.u16();
  const l = [];
  for (let i = 0; i < n; i++) {
    const type = r.u8();
    if (type === 0x00) {
      l.push({ type, c0: r.rgba(), c1: r.rgba() });
    } else if (type === 0x10 || type === 0x12 || type === 0x13) {
      const m0 = r.matrice(), m1 = r.matrice();
      const nb = r.u8();
      const arrets = [];
      for (let k = 0; k < nb; k++) {
        arrets.push({ t0: r.u8(), c0: r.rgba(), t1: r.u8(), c1: r.rgba() });
      }
      const st = { type, m0, m1, arrets };
      if (type === 0x13) { st.focal0 = r.u16(); st.focal1 = r.u16(); }
      l.push(st);
    } else {
      // Remplissage par image : on garde la place, on ne s'en sert pas ici.
      const id = r.u16();
      l.push({ type, bitmap: id, m0: r.matrice(), m1: r.matrice() });
    }
  }
  return l;
}

// MORPHLINESTYLEARRAY. `v2` distingue MorphLineStyle2, plus bavard.
function lireTraits(r, v2) {
  let n = r.u8();
  if (n === 0xFF) n = r.u16();
  const l = [];
  for (let i = 0; i < n; i++) {
    const t = { w0: r.u16(), w1: r.u16() };
    if (v2) {
      const drapeaux = r.u16();
      const aRemplissage = (drapeaux >> 3) & 1;
      r.u8();                          // joint / cap suite
      if (((drapeaux >> 8) & 3) === 2) r.u16();   // miter limit
      if (aRemplissage) { t.remplissage = true; lireStyles(r); }
      else { t.c0 = r.rgba(); t.c1 = r.rgba(); }
    } else {
      t.c0 = r.rgba(); t.c1 = r.rgba();
    }
    l.push(t);
  }
  return l;
}

/**
 * Les arêtes d'une des deux formes, sous une forme neutre :
 * une suite de { type: 'move'|'ligne'|'courbe', … } plus les changements de
 * style. On garde les deux listes en parallèle pour pouvoir les interpoler.
 */
function lireAretes(r, nFill, nLine) {
  let nb = r.u8();
  let nFillBits = nb >> 4, nLineBits = nb & 15;
  const out = [];
  let x = 0, y = 0;
  for (;;) {
    const typeArete = r.u(1);
    if (typeArete) {
      const droite = r.u(1);
      // NumBits tient sur QUATRE bits, et les deltas sur NumBits + 2.
      const nbits = r.u(4) + 2;
      if (droite) {
        const general = r.u(1);
        let dx = 0, dy = 0;
        if (general) { dx = r.s(nbits); dy = r.s(nbits); }
        else if (r.u(1)) dy = r.s(nbits);
        else dx = r.s(nbits);
        x += dx; y += dy;
        out.push({ type: 'ligne', x, y });
      } else {
        const cx = x + r.s(nbits), cy = y + r.s(nbits);
        x = cx + r.s(nbits); y = cy + r.s(nbits);
        out.push({ type: 'courbe', cx, cy, x, y });
      }
    } else {
      const drapeaux = r.u(5);
      if (drapeaux === 0) break;       // EndShapeRecord
      if (drapeaux & 1) {              // StateMoveTo
        const n = r.u(5);
        x = r.s(n); y = r.s(n);
        out.push({ type: 'move', x, y });
      }
      if (drapeaux & 2) out.push({ type: 'fill0', style: r.u(nFillBits) });
      if (drapeaux & 4) out.push({ type: 'fill1', style: r.u(nFillBits) });
      if (drapeaux & 8) out.push({ type: 'trait', style: r.u(nLineBits) });
      if (drapeaux & 16) {             // StateNewStyles
        lireStyles(r.aligner ? (r.aligner(), r) : r);
        lireTraits(r, false);
        const b = r.u8();
        nFillBits = b >> 4; nLineBits = b & 15;
      }
    }
  }
  r.aligner();
  return out;
}

/**
 * Lit tous les morphs d'un SWF.
 * @returns {Map<number, object>} identifiant → { bounds, styles, traits, a, b }
 */
function lireMorphs(chemin) {
  const b = lireSwf(chemin);
  const debut = Math.ceil((5 + ((b[0] >> 3) & 0x1f) * 4) / 8) + 4;
  const morphs = new Map();

  let o = debut;
  while (o < b.length) {
    const hdr = b.readUInt16LE(o), code = hdr >> 6;
    let len = hdr & 0x3f, hs = 2;
    if (len === 0x3f) { len = b.readUInt32LE(o + 2); hs = 6; }
    if (code === 0) break;
    const corps = o + hs;
    if (code === 45 || code === 46) {
      try {
        // Le champ Offset dit où commencent les arêtes d'arrivée, DANS le tag :
        // c'est donc un nombre plus petit que la longueur du tag. On s'en sert
        // comme d'une clé de contrôle pour choisir la disposition.
        //
        // La spécification donne quatre rectangles à DefineMorphShape2 et deux à
        // DefineMorphShape, mais tous les outils ne l'ont pas suivie : le ciel de
        // Minipixiz est étiqueté « 2 » et n'en porte que deux. Plutôt que de
        // faire confiance à l'étiquette, on essaie les deux et on garde celle qui
        // donne un décalage plausible.
        const essayer = (quatre) => {
          const r = new Bits(b, corps);
          const id = r.u16();
          r.rect(); r.rect();
          if (quatre) { r.rect(); r.rect(); r.u8(); }
          const off = r.u32();
          return { r, id, off, apres: r.o, ok: off > 0 && off < len };
        };
        let tentative = essayer(code === 46);
        if (!tentative.ok) tentative = essayer(code !== 46);
        if (!tentative.ok) { o += hs + len; continue; }

        const rBornes = new Bits(b, corps);
        rBornes.u16();
        const bd0 = rBornes.rect(), bd1 = rBornes.rect();
        const r = tentative.r;
        const id = tentative.id;
        const styles = lireStyles(r);
        const traits = lireTraits(r, code === 46 && tentative.quatre);
        const a = lireAretes(r, styles.length, traits.length);
        // Le champ Offset compte les octets depuis la FIN de ce champ jusqu'aux
        // arêtes d'arrivée : on y saute plutôt que de supposer que la première
        // liste s'arrête pile au bon endroit.
        r.o = tentative.apres + tentative.off;
        r.bit = 0;
        // Les arêtes d'arrivée n'ont pas de styles : le format ne répète que la
        // géométrie.
        const bb = lireAretes(r, styles.length, traits.length);
        morphs.set(id, { id, code, bounds: [bd0, bd1], styles, traits, a, b: bb });
      } catch (e) { /* un morph illisible ne doit pas arrêter la lecture */ }
    }
    o += hs + len;
  }
  return morphs;
}

const melange = (a, b, t) => a + (b - a) * t;
const melangeCouleur = (a, b, t) => ({
  r: Math.round(melange(a.r, b.r, t)),
  v: Math.round(melange(a.v, b.v, t)),
  b: Math.round(melange(a.b, b.b, t)),
  a: melange(a.a, b.a, t) / 255,
});
const enHexa = (c) => '#' + [c.r, c.v, c.b].map((n) => n.toString(16).padStart(2, '0')).join('');

/**
 * Écrit un morph en SVG, mélangé au taux `t` (0 = début, 1 = fin).
 *
 * Les deux contours ont la même suite d'arêtes : on les parcourt de front et on
 * interpole chaque point. Les couleurs et les matrices de dégradé suivent le
 * même chemin.
 */
function versSvg(m, t) {
  const T = 20;                        // twips → pixels
  const bd = {
    x0: melange(m.bounds[0].x0, m.bounds[1].x0, t) / T,
    x1: melange(m.bounds[0].x1, m.bounds[1].x1, t) / T,
    y0: melange(m.bounds[0].y0, m.bounds[1].y0, t) / T,
    y1: melange(m.bounds[0].y1, m.bounds[1].y1, t) / T,
  };

  // Les deux listes d'arêtes ne portent pas les mêmes enregistrements de style :
  // seule celle de départ les a. On avance donc dans la seconde en ne comptant
  // que la géométrie.
  const geoB = m.b.filter((e) => e.type !== 'fill0' && e.type !== 'fill1' && e.type !== 'trait');
  let iB = 0;
  const point = (e) => {
    const f = geoB[iB++];
    if (!f || f.type !== e.type) return e;      // formes désaccordées : on garde le départ
    const p = { type: e.type, x: melange(e.x, f.x, t), y: melange(e.y, f.y, t) };
    if (e.type === 'courbe') { p.cx = melange(e.cx, f.cx, t); p.cy = melange(e.cy, f.cy, t); }
    return p;
  };

  // Un chemin par style de remplissage, comme le fait le rendu de Flash.
  const chemins = new Map();
  let styleCourant = 0, d = '', ouvert = false;
  // Un contour peut commencer sans MoveTo : le point courant est alors (0,0).
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
  for (const e of m.a) {
    if (e.type === 'fill1' || e.type === 'fill0') {
      finir();
      styleCourant = e.style;
      ouvert = true;
      d = `M${(cx / T).toFixed(2)} ${(cy / T).toFixed(2)}`;
      continue;
    }
    if (e.type === 'trait') continue;
    const p = point(e);
    cx = p.x; cy = p.y;
    if (p.type === 'move') { finir(); d = `M${(p.x / T).toFixed(2)} ${(p.y / T).toFixed(2)}`; ouvert = true; }
    else if (p.type === 'ligne') d += `L${(p.x / T).toFixed(2)} ${(p.y / T).toFixed(2)}`;
    else d += `Q${(p.cx / T).toFixed(2)} ${(p.cy / T).toFixed(2)} ${(p.x / T).toFixed(2)} ${(p.y / T).toFixed(2)}`;
  }
  finir();

  const defs = [];
  const corps = [];
  for (const [num, liste] of chemins) {
    const st = m.styles[num - 1];
    let fill = '#000000', opacite = '';
    if (!st) { /* style inconnu : noir */ } else if (st.type === 0x00) {
      const c = melangeCouleur(st.c0, st.c1, t);
      fill = enHexa(c);
      if (c.a < 1) opacite = ` fill-opacity="${c.a.toFixed(3)}"`;
    } else if (st.type === 0x10 || st.type === 0x12 || st.type === 0x13) {
      const id = 'm' + num;
      const M = {
        a: melange(st.m0.a, st.m1.a, t), b: melange(st.m0.b, st.m1.b, t),
        c: melange(st.m0.c, st.m1.c, t), d: melange(st.m0.d, st.m1.d, t),
        e: melange(st.m0.e, st.m1.e, t) / T, f: melange(st.m0.f, st.m1.f, t) / T,
      };
      // Le dégradé de Flash vit dans un carré de 32768 twips centré sur zéro ;
      // la matrice l'y amène. On garde ce repère et on laisse le SVG appliquer
      // la transformation, comme pour les formes ordinaires.
      const arrets = st.arrets.map((s) => {
        const c = melangeCouleur(s.c0, s.c1, t);
        const decalage = melange(s.t0, s.t1, t) / 255;
        return `<stop offset="${decalage.toFixed(5)}" stop-color="${enHexa(c)}"`
          + (c.a < 1 ? ` stop-opacity="${c.a.toFixed(3)}"` : '') + '/>';
      }).join('');
      const tm = `matrix(${(M.a / T).toFixed(6)},${(M.b / T).toFixed(6)},`
        + `${(M.c / T).toFixed(6)},${(M.d / T).toFixed(6)},${M.e.toFixed(3)},${M.f.toFixed(3)})`;
      if (st.type === 0x10) {
        defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" `
          + `x1="-819.2" y1="0" x2="819.2" y2="0" gradientTransform="${tm}" `
          + `spreadMethod="pad">${arrets}</linearGradient>`);
      } else {
        defs.push(`<radialGradient id="${id}" gradientUnits="userSpaceOnUse" `
          + `cx="0" cy="0" r="819.2" gradientTransform="${tm}" `
          + `spreadMethod="pad">${arrets}</radialGradient>`);
      }
      fill = `url(#${id})`;
    }
    corps.push(`<path d="${liste.join('')}" fill="${fill}"${opacite} fill-rule="evenodd"/>`);
  }

  const l = Math.max(0.01, bd.x1 - bd.x0), h = Math.max(0.01, bd.y1 - bd.y0);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bd.x0.toFixed(2)} ${bd.y0.toFixed(2)} `
    + `${l.toFixed(2)} ${h.toFixed(2)}" width="${l.toFixed(2)}" height="${h.toFixed(2)}">`
    + (defs.length ? `<defs>${defs.join('')}</defs>` : '')
    + corps.join('') + '</svg>';
}

module.exports = { lireMorphs, versSvg, Bits };
