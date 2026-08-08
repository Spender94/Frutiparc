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
// Ce qui est géré : DefineShape 1 à 4, remplissages unis et dégradés (linéaires,
// radiaux, focaux), arêtes droites et courbes quadratiques, et les tableaux de
// styles introduits en cours de tracé — dont se servent les icônes dessinées
// couche par couche. Les remplissages bitmap sont signalés avec l'identifiant de
// l'image (`bitmap#572`) : c'est extract-swf-bitmaps.js qui va la chercher.
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
      // La matrice envoie le « carré du dégradé » (32768 twips de côté, centré
      // sur l'origine) dans l'espace de la forme. SVG sait faire exactement ça,
      // avec gradientUnits="userSpaceOnUse" + gradientTransform.
      const m = new Bits(b, o + 1);
      const M = { sx: 1, sy: 1, b: 0, c: 0, tx: 0, ty: 0 };
      if (m.u(1)) { const nb = m.u(5); M.sx = m.s(nb) / 65536; M.sy = m.s(nb) / 65536; }
      if (m.u(1)) { const nb = m.u(5); M.b = m.s(nb) / 65536; M.c = m.s(nb) / 65536; }
      const nb = m.u(5); M.tx = m.s(nb); M.ty = m.s(nb); m.align();
      let q = m.o;
      let focale = 0;
      if (t === 0x13) { focale = b.readInt16LE(q) / 256; q += 2; }
      const etalement = b[q] >> 6, interpolation = (b[q] >> 4) & 3, nArrets = b[q] & 0x0f; q += 1;
      const arrets = [];
      for (let k = 0; k < nArrets; k++) {
        arrets.push({
          ratio: b[q],
          couleur: hex(b[q + 1], b[q + 2], b[q + 3]),
          alpha: alpha ? b[q + 4] / 255 : 1,
        });
        q += alpha ? 5 : 4;
      }
      remplissages.push({ degrade: { radial: t !== 0x10, focale, etalement, interpolation, M, arrets } });
      o = q;
    } else if (t >= 0x40 && t <= 0x43) {
      // Les images matricielles ne se rendent pas en SVG pur : on retient leur
      // identifiant, pour que extract-swf-bitmaps.js puisse les sortir.
      remplissages.push({ bitmap: b.readUInt16LE(o + 1) });
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

// SHAPERECORDs → la liste des ARÊTES, en twips (entiers).
//
// Le format ne décrit pas des contours fermés : il décrit un trait continu, et
// dit à chaque instant quel remplissage se trouve DE CHAQUE CÔTÉ (fillStyle1 à
// gauche, fillStyle0 à droite). Les arêtes d'une même surface sont donc
// éparpillées dans l'ordre du dessin. Les recoller est le travail d'`assembler`
// plus bas ; ici on se contente de les relever, sans arrondir — deux extrémités
// doivent pouvoir se reconnaître au twip près.
//
// Une forme peut aussi REMPLACER ses tableaux de styles en cours de tracé
// (StateNewStyles) : les icônes un peu riches du bureau sont dessinées ainsi,
// couche par couche. Chaque arête retient donc de quel tableau vient son style,
// sinon l'indice 1 du second écraserait l'indice 1 du premier.
function lireFormes(b, o, alpha, shape4, tableaux) {
  const r = new Bits(b, o);
  let nFill = r.u(4), nLine = r.u(4);
  let ti = 0;                                              // tableau de styles courant
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
        // Nouveau tableau de styles : il est écrit ALIGNÉ sur l'octet, et les
        // largeurs d'indices qui suivent sont relues juste après.
        r.align();
        const st = lireStyles(b, r.o, alpha, shape4);
        tableaux.push(st);
        ti = tableaux.length - 1;
        f0 = 0; f1 = 0; ls = 0;
        const suite = new Bits(b, st.fin);
        nFill = suite.u(4); nLine = suite.u(4);
        r.o = suite.o; r.bit = suite.bit;
      }
    } else if (r.u(1) === 1) {                             // arête droite
      const nb = r.u(4) + 2;
      let dx = 0, dy = 0;
      if (r.u(1)) { dx = r.s(nb); dy = r.s(nb); }
      else if (r.u(1)) { dy = r.s(nb); }
      else { dx = r.s(nb); }
      aretes.push({ ti, f0, f1, ls, x0: x, y0: y, x1: x + dx, y1: y + dy, cx: null, cy: null });
      x += dx; y += dy;
    } else {                                               // arête courbe
      const nb = r.u(4) + 2;
      const cx = x + r.s(nb), cy = y + r.s(nb);
      const x2 = cx + r.s(nb), y2 = cy + r.s(nb);
      aretes.push({ ti, f0, f1, ls, x0: x, y0: y, x1: x2, y1: y2, cx, cy });
      x = x2; y = y2;
    }
  }
  return aretes;
}

// Recolle des arêtes en contours fermés.
//
// C'est l'étape qui manquait. Fermer chaque suite d'arêtes consécutives — ce qui
// paraît naturel — découpe une surface en autant de morceaux qu'elle a de
// tronçons dans le fichier : sur le chapeau du parrainage, cela donnait quatorze
// éclats triangulaires au lieu d'un chapeau. Il faut chaîner : partir d'une
// arête, chercher celle qui commence là où la précédente finit, et recommencer
// jusqu'à revenir au point de départ.
//
// Les arêtes passées ici sont déjà orientées de sorte que la surface soit à leur
// gauche (celles déclarées « à droite » ont été retournées par l'appelant).
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
      if (!suite) break;                                   // contour ouvert : on s'arrête là
      a = suite;
      if (a === depart) break;                             // boucle bouclée
    }
    contours.push(contour);
  }
  return contours;
}

const PX = (v) => Math.round(v / 20 * 100) / 100;
// Un contour → un morceau de tracé SVG. `ferme` : les remplissages se ferment,
// les traits non (un trait ouvert le reste).
function tracer(contour, ferme) {
  const a0 = contour[0];
  let d = `M${PX(a0.x0)} ${PX(a0.y0)}`;
  for (const a of contour) {
    d += a.cx === null ? `L${PX(a.x1)} ${PX(a.y1)}`
      : `Q${PX(a.cx)} ${PX(a.cy)} ${PX(a.x1)} ${PX(a.y1)}`;
  }
  return d + (ferme ? 'Z' : '');
}

// Arête retournée : même géométrie, sens inverse. Le point de contrôle d'une
// quadratique ne bouge pas — seules les extrémités s'échangent.
const retourner = (a) => ({ ti: a.ti, f0: a.f0, f1: a.f1, ls: a.ls,
  x0: a.x1, y0: a.y1, x1: a.x0, y1: a.y0, cx: a.cx, cy: a.cy });

// Regroupe les arêtes par « tableau:style », remplissages d'un côté, traits de
// l'autre. Pour un remplissage, une arête compte deux fois : telle quelle si la
// surface est à sa gauche (fillStyle1), retournée si elle est à sa droite
// (fillStyle0) — ainsi tous les contours d'une même surface tournent dans le
// même sens et se recollent.
function grouper(aretes) {
  const parFill = new Map(), parTrait = new Map();
  const ranger = (carte, cle, a) => {
    if (!carte.has(cle)) carte.set(cle, []);
    carte.get(cle).push(a);
  };
  for (const a of aretes) {
    if (a.f1) ranger(parFill, a.ti + ':' + a.f1, a);
    if (a.f0) ranger(parFill, a.ti + ':' + a.f0, retourner(a));
    if (a.ls) ranger(parTrait, a.ti + ':' + a.ls, a);
  }
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
  const tableaux = [lireStyles(b, o, alpha, shape4)];
  const aretes = lireFormes(b, tableaux[0].fin, alpha, shape4, tableaux);
  const { parFill, parTrait } = grouper(aretes);
  return { id, bounds: rc.v, tableaux, parFill, parTrait };
}

// « 1:3 » → tableau 1, style 3. Le tri par ce couple restitue l'ordre de dessin :
// dans un tableau, les styles se peignent par indice croissant, et un tableau
// introduit plus tard passe par-dessus les précédents.
const cleTriee = (a, b) => {
  const [ta, sa] = a.split(':').map(Number), [tb, sb] = b.split(':').map(Number);
  return ta - tb || sa - sb;
};
const arrondi = (v) => Math.round(v * 1e5) / 1e5;

function degradeSvg(id, g) {
  const M = g.M;
  // La matrice va de l'espace du dégradé aux twips ; nos tracés sont en pixels
  // (twips / 20), d'où la division des six coefficients.
  const t = [M.sx, M.b, M.c, M.sy, M.tx, M.ty].map((v) => arrondi(v / 20)).join(',');
  const etalement = ['pad', 'reflect', 'repeat'][g.etalement] || 'pad';
  const lin = g.interpolation === 1 ? ' color-interpolation="linearRGB"' : '';
  const arrets = g.arrets.map((a) =>
    `<stop offset="${arrondi(a.ratio / 255)}" stop-color="${a.couleur}"` +
    (a.alpha < 1 ? ` stop-opacity="${Math.round(a.alpha * 1000) / 1000}"` : '') + '/>').join('');
  if (!g.radial) {
    return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="-16384" y1="0" x2="16384" y2="0"`
      + ` spreadMethod="${etalement}"${lin} gradientTransform="matrix(${t})">${arrets}</linearGradient>`;
  }
  const foyer = g.focale ? ` fx="${Math.round(g.focale * 16384)}" fy="0"` : '';
  return `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="16384"${foyer}`
    + ` spreadMethod="${etalement}"${lin} gradientTransform="matrix(${t})">${arrets}</radialGradient>`;
}

function versSvg(f) {
  const [x0, x1, y0, y1] = f.bounds.map((v) => v / 20);
  let corps = '', defs = '', nDeg = 0;
  for (const cle of [...f.parFill.keys()].sort(cleTriee)) {
    const [ti, fi] = cle.split(':').map(Number);
    const s = (f.tableaux[ti] || { remplissages: [] }).remplissages[fi - 1];
    if (!s || s.bitmap !== undefined) continue;            // bitmap : hors périmètre
    let peinture = s.couleur, opacite = s.alpha;
    if (s.degrade) {
      const gid = 'g' + (++nDeg);
      defs += '    ' + degradeSvg(gid, s.degrade) + '\n';
      peinture = `url(#${gid})`; opacite = 1;
    }
    const d = assembler(f.parFill.get(cle)).map((c) => tracer(c, true)).join('');
    if (!d) continue;
    corps += `  <path d="${d}" fill="${peinture}"` +
      (opacite < 1 ? ` fill-opacity="${Math.round(opacite * 100) / 100}"` : '') +
      ` fill-rule="evenodd"/>\n`;
  }
  for (const cle of [...f.parTrait.keys()].sort(cleTriee)) {
    const [ti, li] = cle.split(':').map(Number);
    const s = (f.tableaux[ti] || { traits: [] }).traits[li - 1];
    if (!s) continue;
    const d = assembler(f.parTrait.get(cle)).map((c) => tracer(c, false)).join('');
    if (!d) continue;
    corps += `  <path d="${d}" fill="none" stroke="${s.couleur}" stroke-width="${s.largeur}"`
      + ` stroke-linecap="round" stroke-linejoin="round"/>\n`;
  }
  const l = Math.max(0.01, x1 - x0), h = Math.max(0.01, y1 - y0);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${y0} ${l} ${h}" width="${l}" height="${h}">\n`
    + (defs ? `  <defs>\n${defs}  </defs>\n` : '') + corps + '</svg>\n';
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
  const cols = f.tableaux.flatMap((t) => t.remplissages.map(
    (s) => s.degrade ? (s.degrade.radial ? 'radial' : 'linéaire')
      : s.bitmap !== undefined ? ('bitmap#' + s.bitmap) : s.couleur));
  if (!voulus.size) {
    // Le coin haut-gauche des bornes clôt la ligne (`@x,y`) : une forme n'est
    // pas toujours dessinée autour de son origine — les traînes de Miniwave
    // s'étendent de -100 à 0 — et le client doit poser l'image LÀ, pas au
    // centre. Ajout en fin de ligne : les parseurs existants s'arrêtent avant.
    console.log(`#${f.id}\tshape${t.code}\t${(x1 - x0).toFixed(2)}x${(y1 - y0).toFixed(2)}\t${cols.join(' ')}\t@${x0.toFixed(2)},${y0.toFixed(2)}`);
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
