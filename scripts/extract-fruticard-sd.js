#!/usr/bin/env node
/*
 * Sort les DESSINS DES FRUTICARDS des petites bibliothèques de `/sd/`.
 *
 *   node scripts/extract-fruticard-sd.js          → écrit public/fb/sd/
 *   node scripts/extract-fruticard-sd.js --liste  → dit ce qu'il ferait
 *
 * ── Ce qu'une bibliothèque `/sd/` est ──
 *
 * Une ligne `url` d'une fruticard (`Standard.getFrutiCardLines`, main.swf
 * 0x5c370) ne porte pas une image : elle charge un petit SWF autonome et lui
 * pose des VARIABLES. Le SWF lit ces variables à son image 1 et se place tout
 * seul. Chacun a sa règle, et c'est elle qu'on refait ici — désassemblée avec
 * `scripts/disasm-as2.js` :
 *
 *   miniwave_rank/_ship/_bads, kaluga_panier
 *       this.gotoAndStop(10 + frame)               ← le scénario PRINCIPAL
 *
 *   minipixiz_award
 *       var f = 1 ; if (shade == 1) f += 1 ; if (frame == null) f += 2
 *       award.gotoAndStop(f)
 *       if (frame != null) award.sub.gotoAndStop(int(frame))
 *       if (num   != null) award.field.text = int(num)
 *
 *   minipixiz_spell
 *       ball.symbol.gotoAndStop(int(frame))
 *
 *   minipixiz_faeries
 *       pic.gotoAndStop(frame) ; shade.gotoAndStop(frame)
 *       setColor(pic.f.k0|k1|k2,        col1)
 *       setColor(pic.f.o0.p|o1.p|cloth, col2)
 *       setColor(pic.f.w0|w1,           col3)
 *
 * ── Pourquoi un aplatisseur à part ──
 *
 * `lib/swf-sprites.js` sait aplatir un clip à UNE image, la même à tous les
 * niveaux. Ici il en faut plusieurs à la fois : `award` sur son image et
 * `award.sub` sur une autre, `ball` et `ball.symbol` de même. D'où `morceaux()`
 * ci-dessous, qui prend une CARTE chemin → image et retombe sur la première
 * image d'un clip dont on n'a rien dit. Le reste — matrices composées,
 * transformations de couleur, masques — suit la même logique que la
 * bibliothèque commune.
 *
 * ── La teinte des fées ──
 *
 * `setColor` d'époque n'est pas un remplissage : c'est un décalage par canal,
 * `sortie = source + (col − 255)`. Sur du blanc il donne `col`, sur un gris il
 * donne un `col` d'autant plus sombre. Les trois groupes restent donc en
 * niveaux de gris dans le dessin, et portent une CLASSE (`t1`, `t2`, `t3`) :
 * c'est le light qui pose les trois filtres, puisque les couleurs changent
 * d'une fée à l'autre.
 *
 * Ce que chaque couleur repeint, en clair : `col1` les CHEVEUX (k0, k1, k2),
 * `col2` les YEUX et la ROBE (o0.p, o1.p, cloth), `col3` les AILES (w0, w1).
 * Le teint du visage n'en est pas : il est peint dans le dessin, et toutes les
 * fées de la carte ont donc le même.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ouvrir, IDENTITE } = require('./lib/swf-sprites.js');

const RACINE = path.join(__dirname, '..');
const SD = path.join(RACINE, 'public/sd');
const SORTIE = path.join(RACINE, 'public/fb/sd');
const TMP = path.join(RACINE, '.tmp-fcard-sd');
const LISTE = process.argv.includes('--liste');

// ── L'aplatisseur à images multiples ───────────────────────────────────────

function morceaux(swf, ch, M, images, chemin, cx, prof, compteur) {
  prof = prof || 0;
  chemin = chemin || '';
  if (prof > 10) return [];
  if (swf.estForme(ch)) return [{ shape: ch, M, chemin, cx }];
  const frames = swf.parSprite.get(ch);
  if (!frames) return [];
  const dispo = [...frames.keys()].sort((a, b) => a - b);
  const voulue = images[chemin];
  let cle = dispo[0];
  if (voulue !== undefined) {
    // Un `gotoAndStop` au-delà de la dernière image s'arrête sur la dernière,
    // et une image sans placement propre garde celui de la précédente : on
    // prend donc la plus grande image ≤ celle demandée.
    cle = frames.has(voulue) ? voulue
      : (dispo.filter((f) => f <= voulue).pop() !== undefined
        ? dispo.filter((f) => f <= voulue).pop() : dispo[dispo.length - 1]);
  }
  const out = [];
  let masqueOuvert = null;
  for (const p of frames.get(cle) || []) {
    if (masqueOuvert && p.prof > masqueOuvert.clip) masqueOuvert = null;
    const sous = p.nom ? (chemin ? chemin + '.' + p.nom : p.nom) : chemin;
    const m = morceaux(swf, p.ch, swf.composer(M, p.M), images, sous,
      swf.composerCouleur(cx, p.cx), prof + 1, compteur);
    if (p.masque) {
      masqueOuvert = { clip: p.masque, num: ++compteur.n };
      for (const x of m) { x.masque = true; x.numeroMasque = masqueOuvert.num; }
    } else if (masqueOuvert) {
      for (const x of m) if (!x.masque && x.sousMasque === undefined) x.sousMasque = masqueOuvert.num;
    }
    out.push(...m);
  }
  return out;
}

// ── Les formes, une fois chacune ───────────────────────────────────────────
// `extract-swf-shapes.js` écrit un SVG autonome par forme. On en garde le
// CORPS, et on renumérote ses identifiants (les dégradés s'appellent tous
// « g1 » d'un fichier à l'autre : recollés tels quels, le second emprunterait
// les couleurs du premier).
//
// LES RASTERS. Tout n'est pas tracé : les vaisseaux de MiniWave, ses monstres
// et les paniers de Kaluga sont des formes dont l'unique remplissage est une
// IMAGE, que l'extracteur de tracés laisse de côté (« hors périmètre ») — il
// rendait des SVG vides, et la planche contact était blanche. On sort l'image
// par `extract-swf-bitmaps.js` et on récrit le SVG autour, en data-URI et au
// pixel près : l'art d'époque est du pixel-art de dix-huit points de côté.

// Le catalogue d'un SWF : identifiant → { l, h, x, y, bitmap } d'après le
// listing de `extract-swf-shapes.js`.
const catalogues = new Map();
function catalogue(fichier) {
  if (catalogues.has(fichier)) return catalogues.get(fichier);
  const brut = execFileSync(process.execPath,
    [path.join(__dirname, 'extract-swf-shapes.js'), fichier],
    { encoding: 'utf8', maxBuffer: 128e6 });
  const t = new Map();
  for (const l of brut.split('\n')) {
    const m = /^#(\d+)\tshape\d+\t([\d.]+)x([\d.]+)\t(.*)\t@([-\d.]+),([-\d.]+)$/.exec(l);
    if (!m) continue;
    const cols = m[4].trim().split(/\s+/).filter(Boolean);
    const seuleImage = cols.length === 1 && /^bitmap#\d+$/.test(cols[0]);
    t.set(Number(m[1]), { l: +m[2], h: +m[3], x: +m[5], y: +m[6],
      bitmap: seuleImage ? Number(cols[0].slice(7)) : null });
  }
  catalogues.set(fichier, t);
  return t;
}

function chargerFormes(swf, fichier, ids) {
  const dossier = path.join(TMP, path.basename(fichier, '.swf'));
  const cat = catalogue(fichier);
  const traces = ids.filter((id) => !(cat.get(id) || {}).bitmap);
  const rasters = ids.filter((id) => (cat.get(id) || {}).bitmap);
  const absents = traces.filter((id) => !fs.existsSync(path.join(dossier, 'shape' + id + '.svg')));
  if (absents.length) {
    execFileSync(process.execPath,
      [path.join(__dirname, 'extract-swf-shapes.js'), fichier, dossier, ...absents.map(String)],
      { stdio: 'pipe', maxBuffer: 128e6 });
  }
  const imgs = [...new Set(rasters.map((id) => cat.get(id).bitmap))]
    .filter((n) => !fs.existsSync(path.join(dossier, 'bitmap' + n + '.png')));
  if (imgs.length) {
    execFileSync(process.execPath,
      [path.join(__dirname, 'extract-swf-bitmaps.js'), fichier, dossier, ...imgs.map(String)],
      { stdio: 'pipe', maxBuffer: 128e6 });
  }
  const formes = new Map();
  for (const id of ids) {
    const info = cat.get(id);
    if (info && info.bitmap) {
      let png = null;
      for (const ext of ['png', 'jpg', 'gif']) {
        const q = path.join(dossier, 'bitmap' + info.bitmap + '.' + ext);
        if (fs.existsSync(q)) { png = { buf: fs.readFileSync(q), ext }; break; }
      }
      if (!png) continue;
      const type = png.ext === 'jpg' ? 'jpeg' : png.ext;
      formes.set(id, {
        corps: `<image x="${info.x}" y="${info.y}" width="${info.l}" height="${info.h}"`
          + ` image-rendering="pixelated" href="data:image/${type};base64,`
          + png.buf.toString('base64') + '"/>',
        vb: { x: info.x, y: info.y, w: info.l, h: info.h },
      });
      continue;
    }
    const p = path.join(dossier, 'shape' + id + '.svg');
    if (!fs.existsSync(p)) continue;
    const t = fs.readFileSync(p, 'utf8');
    const vb = /viewBox="([-\d.eE]+) ([-\d.eE]+) ([-\d.eE]+) ([-\d.eE]+)"/.exec(t);
    if (!vb) continue;
    let corps = t.replace(/<svg[^>]*>/, '').replace('</svg>', '');
    corps = corps.replace(/id="([^"]+)"/g, (m, k) => `id="s${id}_${k}"`)
      .replace(/url\(#([^)]+)\)/g, (m, k) => `url(#s${id}_${k})`);
    formes.set(id, { corps, vb: { x: +vb[1], y: +vb[2], w: +vb[3], h: +vb[4] } });
  }
  return formes;
}

const arr = (v) => String(Math.round(v * 100) / 100);

// La transformation de couleur POSÉE dans le fichier — celle qui assombrit un
// symbole de sort pour qu'il se lise sur sa bille blanche. L'ignorer les
// rendait invisibles.
let nFiltre = 0;
function filtreCx(swf, cx) {
  if (!cx || swf.cxNeutre(cx)) return null;
  const id = 'cx' + (++nFiltre);
  const m = [
    cx.mr / 256, 0, 0, 0, cx.ar / 255,
    0, cx.mv / 256, 0, 0, cx.av / 255,
    0, 0, cx.mb / 256, 0, cx.ab / 255,
    0, 0, 0, cx.ma / 256, cx.aa / 255,
  ];
  return { id, def: `<filter id="${id}" color-interpolation-filters="sRGB">`
    + `<feColorMatrix type="matrix" values="${m.map((v) => +v.toFixed(4)).join(' ')}"/></filter>` };
}

// `teinte` : chemin de clip → classe. Une pièce dont le chemin commence par
// l'une des clés porte la classe correspondante.
function classeDe(chemin, teintes) {
  if (!teintes) return null;
  for (const [prefixe, classe] of teintes) {
    if (chemin === prefixe || chemin.startsWith(prefixe + '.')) return classe;
  }
  return null;
}

function composer(swf, pieces, formes, teintes) {
  const dessins = [];
  // Le cadre d'une pièce, une fois sa matrice appliquée.
  const cadre = (m) => {
    const f = formes.get(m.shape);
    let a = 1e9, b = 1e9, c = -1e9, d = -1e9;
    for (const [px, py] of [[f.vb.x, f.vb.y], [f.vb.x + f.vb.w, f.vb.y],
      [f.vb.x, f.vb.y + f.vb.h], [f.vb.x + f.vb.w, f.vb.y + f.vb.h]]) {
      const sx = m.M.a * px + m.M.c * py + m.M.e / 20;
      const sy = m.M.b * px + m.M.d * py + m.M.f / 20;
      a = Math.min(a, sx); b = Math.min(b, sy);
      c = Math.max(c, sx); d = Math.max(d, sy);
    }
    return { x0: a, y0: b, x1: c, y1: d };
  };
  // Le cadre de chaque masque : ce qu'il découpe ne DÉPASSE pas.
  const cadreMasque = new Map();
  for (const m of pieces) {
    if (!m.masque || !formes.get(m.shape)) continue;
    const q = cadre(m);
    const v = cadreMasque.get(m.numeroMasque);
    cadreMasque.set(m.numeroMasque, v ? {
      x0: Math.min(v.x0, q.x0), y0: Math.min(v.y0, q.y0),
      x1: Math.max(v.x1, q.x1), y1: Math.max(v.y1, q.y1),
    } : q);
  }
  /* LE CADRE VISIBLE. Une pièce sous découpe ne compte que pour ce que la
     découpe en laisse voir : le portrait de la fée déborde largement de son
     cadre de cent pixels, et le prendre en entier posait la vignette de
     travers, un tiers de visage hors champ. */
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const m of pieces) {
    if (!formes.get(m.shape)) continue;
    dessins.push(m);
    if (m.masque) continue;
    let q = cadre(m);
    const mq = m.sousMasque && cadreMasque.get(m.sousMasque);
    if (mq) {
      q = { x0: Math.max(q.x0, mq.x0), y0: Math.max(q.y0, mq.y0),
        x1: Math.min(q.x1, mq.x1), y1: Math.min(q.y1, mq.y1) };
      if (q.x0 >= q.x1 || q.y0 >= q.y1) continue;   // entièrement rognée
    }
    x0 = Math.min(x0, q.x0); y0 = Math.min(y0, q.y0);
    x1 = Math.max(x1, q.x1); y1 = Math.max(y1, q.y1);
  }
  if (!dessins.length || x0 > x1) return null;
  const l = Math.max(0.01, x1 - x0), h = Math.max(0.01, y1 - y0);
  const mat = (M) => [M.a, M.b, M.c, M.d, M.e / 20, M.f / 20]
    .map((v) => +v.toFixed(4)).join(',');

  /* Les DÉCOUPES d'abord : un masque est une forme comme une autre dans le
     fichier, et la dessiner telle quelle collerait un rectangle en travers du
     portrait — c'est un masque DANS le clip de l'œil qui retient la pupille de
     la fée, bien plus grande que l'œil.

     `<mask>` et non `<clipPath>` : un `clipPath` n'accepte que des formes, et
     un `<g transform>` posé dedans est IGNORÉ — le masque devenait vide et
     découpait tout. Un `<mask>` prend n'importe quel contenu, à condition de
     le peindre en BLANC : les formes portent leur propre remplissage (le rouge
     des masques de Flash), qu'une règle `!important` recouvre. */
  let defs = '', corps = '';
  const parMasque = new Map();
  for (const d of dessins) {
    if (!d.masque) continue;
    if (!parMasque.has(d.numeroMasque)) parMasque.set(d.numeroMasque, []);
    parMasque.get(d.numeroMasque).push(d);
  }
  for (const [num, ms] of parMasque) {
    defs += `<mask id="mq${num}" maskUnits="userSpaceOnUse"`
      + ` x="${arr(x0)}" y="${arr(y0)}" width="${arr(l)}" height="${arr(h)}">`;
    for (const d of ms) {
      defs += `<g class="mqc" transform="matrix(${mat(d.M)})">${formes.get(d.shape).corps}</g>`;
    }
    defs += '</mask>';
  }
  /* LA DÉCOUPE VA SUR UN GROUPE À PART, au-dessus de celui qui porte la
     matrice. En SVG, `mask` s'évalue dans l'espace utilisateur ÉTABLI PAR la
     transformation de l'élément qui le référence : posé sur le même groupe, le
     cadre de cent pixels partait avec la pièce. Les cheveux de la fée, placés à
     (50, 48), ne gardaient donc que le quart bas-droit de leur dessin — d'où
     six fées chauves. Les matrices des masques, elles, sont déjà absolues. */
  for (const d of dessins) {
    if (d.masque) continue;
    const f = formes.get(d.shape);
    const fc = filtreCx(swf, d.cx);
    if (fc) defs += fc.def;
    const cl = classeDe(d.chemin, teintes);
    let el = `<g transform="matrix(${mat(d.M)})"`
      + (fc ? ` filter="url(#${fc.id})"` : '') + '>' + f.corps + '</g>';
    if (d.sousMasque) el = `<g mask="url(#mq${d.sousMasque})">` + el + '</g>';
    if (cl) el = `<g class="${cl}">` + el + '</g>';
    corps += el + '\n';
  }
  const style = parMasque.size
    ? '<style>.mqc,.mqc *{fill:#fff!important;stroke:none!important;opacity:1!important}</style>'
    : '';
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${arr(x0)} ${arr(y0)} ${arr(l)} ${arr(h)}"`
      + ` width="${arr(l)}" height="${arr(h)}">\n` + style
      + (defs ? '<defs>' + defs + '</defs>\n' : '') + corps + '</svg>\n',
    w: +arr(l), h: +arr(h),
  };
}

// Un dessin = un SWF, une carte d'images, et de quoi le nommer.
function rendre(swf, fichier, images, teintes) {
  // Les compteurs repartent de zéro à chaque dessin : sans ça, deux dessins
  // IDENTIQUES ne portaient pas les mêmes numéros de filtre et le
  // dédoublonnage ne voyait rien — soixante-cinq fichiers pour six fées.
  nFiltre = 0;
  const compteur = { n: 0 };
  const racine = swf.parSprite.get(0);
  if (!racine) return null;
  const dispo = [...racine.keys()].sort((a, b) => a - b);
  const voulue = images[''];
  let cle = dispo[dispo.length - 1];
  if (voulue !== undefined) {
    cle = racine.has(voulue) ? voulue
      : (dispo.filter((f) => f <= voulue).pop() !== undefined
        ? dispo.filter((f) => f <= voulue).pop() : dispo[dispo.length - 1]);
  }
  const pieces = [];
  let masqueOuvert = null;
  for (const p of racine.get(cle) || []) {
    if (masqueOuvert && p.prof > masqueOuvert.clip) masqueOuvert = null;
    const m = morceaux(swf, p.ch, p.M, images, p.nom || '', p.cx, 1, compteur);
    if (p.masque) {
      masqueOuvert = { clip: p.masque, num: ++compteur.n };
      for (const x of m) { x.masque = true; x.numeroMasque = masqueOuvert.num; }
    } else if (masqueOuvert) {
      for (const x of m) if (!x.masque && x.sousMasque === undefined) x.sousMasque = masqueOuvert.num;
    }
    pieces.push(...m);
  }
  const ids = [...new Set(pieces.map((p) => p.shape))];
  const formes = chargerFormes(swf, fichier, ids);
  return composer(swf, pieces, formes, teintes);
}

// ── Ce qu'on sort, bibliothèque par bibliothèque ───────────────────────────
// La clé de sortie est celle que `fruticard.js` reconstruit : `resoudre()` y
// refait le même calcul que l'image 1 du SWF.

const TEINTES_FEE = [
  ['pic.f.k0', 't1'], ['pic.f.k1', 't1'], ['pic.f.k2', 't1'],
  ['pic.f.o0.p', 't2'], ['pic.f.o1.p', 't2'], ['pic.f.cloth', 't2'],
  ['pic.f.w0', 't3'], ['pic.f.w1', 't3'],
];

const BIBLIOS = [
  // `this.gotoAndStop(10 + frame)` : une image du scénario principal par état.
  { lib: 'miniwave_rank', swf: 'miniwave_rank.swf', racine: true },
  { lib: 'miniwave_ship', swf: 'miniwave_ship.swf', racine: true },
  { lib: 'miniwave_bads', swf: 'miniwave_bads.swf', racine: true },
  { lib: 'kaluga_panier', swf: 'kaluga_panier.swf', racine: true },
  // `ball.symbol.gotoAndStop(frame)` : le scénario reste à sa dernière image.
  { lib: 'minipixiz_spell', swf: 'minipixiz_spell.swf',
    etats: (swf) => {
      const n = (swf.parSprite.get(swf.noms.get('spellSymbol')) || new Map()).size;
      const out = [];
      for (let i = 1; i <= n; i++) out.push({ nom: String(i), images: { 'ball.symbol': i } });
      return out;
    } },
  // `pic.gotoAndStop(frame)` + `shade.gotoAndStop(frame)`, teintés par groupe.
  { lib: 'minipixiz_faeries', swf: 'minipixiz_faeries.swf', teintes: TEINTES_FEE,
    etats: (swf) => {
      const n = (swf.parSprite.get(swf.noms.get('picFace')) || new Map()).size;
      const out = [];
      for (let i = 1; i <= n; i++) out.push({ nom: String(i), images: { pic: i, shade: i } });
      return out;
    } },
  // Les cinq diamants (`frame` donné) et l'étoile (`frame` absent), chacun en
  // deux états d'ombre.
  { lib: 'minipixiz_award', swf: 'minipixiz_award.swf',
    etats: () => {
      const out = [];
      for (const shade of [0, 1]) {
        for (let i = 1; i <= 5; i++) {
          out.push({ nom: 'd' + i + '_' + shade,
            images: { award: 1 + (shade === 1 ? 1 : 0), 'award.sub': i } });
        }
        out.push({ nom: 'e' + shade, images: { award: 3 + (shade === 1 ? 1 : 0) } });
      }
      return out;
    } },
];

// ── Le travail ─────────────────────────────────────────────────────────────

fs.mkdirSync(SORTIE, { recursive: true });
const manifeste = JSON.parse(fs.readFileSync(path.join(SORTIE, 'manifeste.json'), 'utf8'));
let ecrits = 0, vides = 0;

for (const bib of BIBLIOS) {
  const fichier = path.join(SD, bib.swf);
  if (!fs.existsSync(fichier)) { console.warn('!! absent : ' + bib.swf); continue; }
  const swf = ouvrir(fichier);
  let etats;
  if (bib.racine) {
    const racine = swf.parSprite.get(0);
    etats = [...(racine ? racine.keys() : [])].sort((a, b) => a - b)
      .map((f) => ({ nom: String(f), images: { '': f } }));
  } else {
    etats = bib.etats(swf);
  }
  /* UN FICHIER PAR DESSIN, pas par image. `picFace` a soixante-cinq images
     pour SIX fées : de l'image 6 à l'image 65, le clip ne change plus et
     Flash garde le dernier placement. Écrire soixante-cinq fois la même chose
     alourdissait le dépôt pour rien ; on n'écrit que ce qui diffère, et le
     manifeste renvoie chaque état vers son fichier. */
  const faits = [];
  const dejaVu = new Map();                          // empreinte → nom d'état
  for (const e of etats) {
    const r = rendre(swf, fichier, e.images, bib.teintes);
    if (!r) { vides++; continue; }
    const dedans = dejaVu.get(r.svg);
    const etat = dedans === undefined ? e.nom : dedans;
    if (dedans === undefined) {
      if (!LISTE) fs.writeFileSync(path.join(SORTIE, bib.lib + '_' + e.nom + '.svg'), r.svg);
      dejaVu.set(r.svg, e.nom);
      faits.push(e.nom);
      ecrits++;
    }
    manifeste[bib.lib + '_' + e.nom] = { lib: bib.lib, etat, w: r.w, h: r.h };
  }
  console.log(`${bib.lib.padEnd(18)} ${faits.length} dessin(s) pour ${etats.length} état(s) : `
    + faits.slice(0, 12).join(' ') + (faits.length > 12 ? ' …' : ''));
}

if (!LISTE) {
  fs.writeFileSync(path.join(SORTIE, 'manifeste.json'), JSON.stringify(manifeste, null, 1) + '\n');
  fs.rmSync(TMP, { recursive: true, force: true });
}
console.log(`\n${ecrits} dessin(s)${vides ? `, ${vides} vide(s)` : ''}`
  + (LISTE ? ' — rien écrit (--liste)' : ' → public/fb/sd/'));
