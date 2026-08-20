// Les TEXTES d'un SWF : ce que swf-sprites.js ne lit pas.
//
// Un dessin Flash écrit de trois façons, et chacune demande son traitement :
//
//   DefineText (11/33)     du texte FIGÉ au moment de la compilation : une
//                          suite d'index de glyphes avec leurs avances, posée
//                          par une matrice. Les libellés des menus, les « pts »
//                          des en-têtes. On le rend en SVG, trait pour trait,
//                          avec les contours de la fonte embarquée — c'est la
//                          seule façon d'avoir EXACTEMENT le lettrage d'origine.
//   DefineEditText (37)    un CHAMP, rempli à l'exécution (score, titre de
//                          niveau…). Rien à dessiner : on relève sa géométrie,
//                          sa fonte, sa couleur, son alignement, et le client
//                          écrit dedans avec la fonte extraite en WOFF.
//   DefineFont2 (48)       les contours des lettres, dans un carré de 1024
//                          unités par em — des Bézier quadratiques, comme SVG.
//
// Utilisé par extract-jamajama-sprites.js ; écrit à part parce qu'il ne dépend
// que du buffer et du parcours de tags que swf-sprites.js expose déjà.

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
  aligner() { if (this.bit) { this.bit = 0; this.o++; } return this.o; }
}

function lireRect(b, o) {
  const r = new Bits(b, o);
  const n = r.u(5);
  const v = { x0: r.s(n), x1: r.s(n), y0: r.s(n), y1: r.s(n) };
  r.aligner();
  return { v, fin: r.o };
}

// MATRIX complète (échelle, rotation, translation), en unités du fichier.
function lireMatrice(b, o) {
  const m = new Bits(b, o);
  const M = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  if (m.u(1)) { const n = m.u(5); M.a = m.s(n) / 65536; M.d = m.s(n) / 65536; }
  if (m.u(1)) { const n = m.u(5); M.b = m.s(n) / 65536; M.c = m.s(n) / 65536; }
  const n = m.u(5); M.e = m.s(n); M.f = m.s(n);
  m.aligner();
  return { M, fin: m.o };
}

/**
 * Le TRACÉ d'un glyphe : une forme réduite — un seul remplissage, pas de trait.
 * Coordonnées dans le carré de l'em (1024 unités) ; chaque moveTo ouvre un
 * contour, qu'on referme (Z) — le remplissage nonzero de SVG suit alors la même
 * règle d'enroulement que Flash et que TrueType.
 */
function lireGlyphe(b, debut, fin) {
  const r = new Bits(b, debut);
  let nFill = r.u(4), nLine = r.u(4);
  let x = 0, y = 0, d = '', ouvert = false;
  while (r.o < fin) {
    if (r.u(1) === 0) {
      const nouveaux = r.u(1), trait = r.u(1), f1 = r.u(1), f0 = r.u(1), bouge = r.u(1);
      if (!nouveaux && !trait && !f1 && !f0 && !bouge) break;
      if (bouge) {
        const n = r.u(5); x = r.s(n); y = r.s(n);
        if (ouvert) d += 'Z';
        d += `M${x} ${y}`;
        ouvert = true;
      }
      if (f0) r.u(nFill);
      if (f1) r.u(nFill);
      if (trait) r.u(nLine);
      if (nouveaux) break;                       // jamais dans un glyphe
    } else if (r.u(1) === 1) {
      const n = r.u(4) + 2;
      let dx = 0, dy = 0;
      if (r.u(1)) { dx = r.s(n); dy = r.s(n); } else if (r.u(1)) dy = r.s(n); else dx = r.s(n);
      x += dx; y += dy;
      d += `L${x} ${y}`;
    } else {
      const n = r.u(4) + 2;
      const cx = x + r.s(n), cy = y + r.s(n);
      x = cx + r.s(n); y = cy + r.s(n);
      d += `Q${cx} ${cy} ${x} ${y}`;
    }
  }
  return d + (ouvert ? 'Z' : '');
}

/**
 * Lit fontes, textes figés et champs d'un SWF déjà ouvert par swf-sprites.
 *
 * @param {{b: Buffer, parcourir: Function}} swf — le résultat de ouvrir()
 * @returns {{fontes: Map, statiques: Map, dynamiques: Map, svgStatique: Function}}
 */
function lireTextes(swf) {
  const b = swf.b;

  // ── DefineFont2 : nom, table des codes, tracés ──
  const fontes = new Map();
  swf.parcourir((code, corps, len) => {
    if (code !== 48) return;
    const id = b.readUInt16LE(corps);
    const drapeaux = b[corps + 2];
    const larges = !!(drapeaux & 0x08), codesLarges = !!(drapeaux & 0x04);
    const lg = b[corps + 4];
    const nom = b.slice(corps + 5, corps + 5 + lg).toString('latin1').replace(/\0+$/, '');
    let o = corps + 5 + lg;
    const nb = b.readUInt16LE(o); o += 2;
    const f = { id, nom, nb, codes: [], glyphes: [] };
    fontes.set(id, f);
    if (!nb) return;
    const base = o;
    const lireDec = (i) => (larges ? b.readUInt32LE(base + i * 4) : b.readUInt16LE(base + i * 2));
    const finTable = larges ? b.readUInt32LE(base + nb * 4) : b.readUInt16LE(base + nb * 2);
    for (let i = 0; i < nb; i++) {
      const debut = base + lireDec(i);
      const fin = (i + 1 < nb) ? base + lireDec(i + 1) : base + finTable;
      f.glyphes.push(lireGlyphe(b, debut, fin));
    }
    let p = base + finTable;
    for (let i = 0; i < nb; i++) { f.codes.push(codesLarges ? b.readUInt16LE(p) : b[p]); p += codesLarges ? 2 : 1; }
  });

  const hex = (o) => '#' + [b[o], b[o + 1], b[o + 2]]
    .map((v) => v.toString(16).padStart(2, '0')).join('');

  // ── DefineText/2 : la matrice, puis les enregistrements avec leur plume ──
  //
  // Un enregistrement qui ne redit pas XOffset CONTINUE là où la plume en est :
  // les avances de chaque glyphe l'ont fait progresser. Le lire comme un « x
  // collant » recollerait tous les morceaux d'une ligne au même endroit.
  const statiques = new Map();
  swf.parcourir((code, corps) => {
    if (code !== 11 && code !== 33) return;
    const id = b.readUInt16LE(corps);
    const rc = lireRect(b, corps + 2);
    const mat = lireMatrice(b, rc.fin);
    let o = mat.fin;
    const glyphBits = b[o], advanceBits = b[o + 1]; o += 2;
    const runs = [];
    let fonte = 0, taille = 0, couleur = '#000000', px = 0, py = 0;
    for (;;) {
      const fl = b[o];
      if (fl === 0) break;
      o += 1;
      if (fl & 0x08) { fonte = b.readUInt16LE(o); o += 2; }
      if (fl & 0x04) { couleur = hex(o); o += (code === 33) ? 4 : 3; }
      if (fl & 0x01) { px = b.readInt16LE(o); o += 2; }
      if (fl & 0x02) { py = b.readInt16LE(o); o += 2; }
      if (fl & 0x08) { taille = b.readUInt16LE(o); o += 2; }
      const nb = b[o]; o += 1;
      const r = new Bits(b, o);
      const gs = [];
      for (let i = 0; i < nb; i++) {
        const idx = r.u(glyphBits);
        const av = r.s(advanceBits);
        gs.push({ idx, x: px });
        px += av;
      }
      o = r.aligner();
      runs.push({ fonte, taille, couleur, y: py, glyphes: gs });
    }
    statiques.set(id, { id, bounds: rc.v, matrice: mat.M, runs });
  });

  // ── DefineEditText : la géométrie et le style, rien à dessiner ──
  const dynamiques = new Map();
  swf.parcourir((code, corps) => {
    if (code !== 37) return;
    const id = b.readUInt16LE(corps);
    const rc = lireRect(b, corps + 2);
    let o = rc.fin;
    const f1 = b[o], f2 = b[o + 1]; o += 2;
    const t = {
      id,
      rect: { x: rc.v.x0 / 20, y: rc.v.y0 / 20, w: (rc.v.x1 - rc.v.x0) / 20, h: (rc.v.y1 - rc.v.y0) / 20 },
      wrap: !!(f1 & 0x40), multiligne: !!(f1 & 0x20), lectureSeule: !!(f1 & 0x08),
      autoTaille: !!(f2 & 0x40), bordure: !!(f2 & 0x08), html: !!(f2 & 0x02),
      embarquee: !!(f2 & 0x01),
      fonte: 0, taille: 12, couleur: '#000000', alpha: 1,
      align: 'gauche', interligne: 0, variable: '', texte: '',
    };
    if (f1 & 0x01) { t.fonte = b.readUInt16LE(o); o += 2; t.taille = b.readUInt16LE(o) / 20; o += 2; }
    if (f1 & 0x04) { t.couleur = hex(o); t.alpha = b[o + 3] / 255; o += 4; }
    if (f1 & 0x02) { t.max = b.readUInt16LE(o); o += 2; }
    if (f2 & 0x20) {
      t.align = ['gauche', 'droite', 'centre', 'justifie'][b[o]] || 'gauche';
      t.margeG = b.readUInt16LE(o + 1) / 20;
      t.margeD = b.readUInt16LE(o + 3) / 20;
      t.retrait = b.readUInt16LE(o + 5) / 20;
      t.interligne = b.readInt16LE(o + 7) / 20;
      o += 9;
    }
    let e = o; while (b[e] !== 0) e++;
    t.variable = b.slice(o, e).toString('latin1'); o = e + 1;
    if (f1 & 0x80) {
      e = o; while (b[e] !== 0) e++;
      t.texte = b.slice(o, e).toString('utf8');
    }
    dynamiques.set(id, t);
  });

  /**
   * Un DefineText rendu en SVG, au pixel : chaque glyphe est posé à sa plume et
   * mis à l'échelle taille/1024 — la définition même du rendu Flash. La matrice
   * du tag est appliquée en tête ; le viewBox est le cadre déclaré du tag, si
   * bien que la pièce se manipule ensuite exactement comme un shapeN.svg.
   */
  function svgStatique(id) {
    const t = statiques.get(id);
    if (!t) return null;
    const arr = (v) => Math.round(v * 1e4) / 1e4;
    const x0 = t.bounds.x0 / 20, y0 = t.bounds.y0 / 20;
    const w = Math.max(0.01, (t.bounds.x1 - t.bounds.x0) / 20);
    const h = Math.max(0.01, (t.bounds.y1 - t.bounds.y0) / 20);
    const M = t.matrice;
    let corps = '';
    for (const run of t.runs) {
      const fonte = fontes.get(run.fonte);
      if (!fonte) continue;
      const s = arr(run.taille / 20 / 1024);
      const y = arr(run.y / 20);
      for (const g of run.glyphes) {
        const d = fonte.glyphes[g.idx];
        if (!d) continue;
        corps += `  <path transform="translate(${arr(g.x / 20)} ${y}) scale(${s})"`
          + ` d="${d}" fill="${run.couleur}"/>\n`;
      }
    }
    const mat = [M.a, M.b, M.c, M.d, M.e / 20, M.f / 20].map(arr).join(' ');
    const groupe = mat === '1 0 0 1 0 0' ? corps
      : `  <g transform="matrix(${mat})">\n${corps}  </g>\n`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${arr(x0)} ${arr(y0)} ${arr(w)} ${arr(h)}"`
      + ` width="${arr(w)}" height="${arr(h)}">\n${groupe}</svg>\n`;
  }

  return { fontes, statiques, dynamiques, svgStatique };
}

module.exports = { lireTextes };
