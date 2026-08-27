#!/usr/bin/env node
/*
 * LA PAGE DE CHARGEMENT DU BUREAU (main.swf) — la barre rose.
 *
 *   node scripts/extract-chargement.js   → écrit public/frutiz/sprites/
 *
 * `loadingInit()` (DoAction 0x08641, la toute première du fichier) attache le
 * clip `loadingProcess` (#154) à la profondeur 512 et lui donne neuf enfants :
 *
 *     b1 · mid · b2        la barre PLEINE      (image 1 des clips)
 *     bgb1 · bgmid · bgb2  sa gouttière         (image 2 des mêmes clips)
 *     title                « CHARGEMENT »
 *     fieldInfo            « fichiers restants : NN% »
 *     info                 « Information : » + la phrase d'époque
 *
 * Deux clips seulement portent le dessin, chacun à deux images :
 *
 *     ch142 « mid »  10 × 18   image 1 = ch140 (le remplissage)
 *                              image 2 = ch141 (la gouttière)
 *     ch145 « bout »  9 × 18   image 1 = ch143   image 2 = ch144
 *
 * et les bouts DROITS sont les mêmes, posés avec `a = −1` : un miroir.
 *
 * LA BARRE EST ROSE, la gouttière VERTE — relevé sur les formes :
 *
 *   remplissage  une bande BLANCHE de 18 de haut, et dedans un ruban de 12
 *                (y 0..12) en dégradé vertical `#BB1E1E` en haut →
 *                `#EE9595` (à 12,9 %) → `#FFC1C1` en bas, coiffé d'un reflet
 *                blanc dégradé (y 1..7,5). D'où les trois pixels blancs
 *                au-dessus et au-dessous du rose.
 *   gouttière    un corps `#8FCF5A` de 16 (y −2,05..13,95) cerclé d'un liseré
 *                clair `#DBF3BA` d'un pixel — et, sous le bout, un `#8EDB24`
 *                que le liseré recouvre entièrement (reliquat d'époque).
 *
 * Le fond de scène est le vert `#ADE76B` du SWF (SetBackgroundColor).
 *
 * Même moteur que extract-recherche.js : les formes par extract-swf-shapes.js,
 * les matrices en pixels, un cxform en feColorMatrix.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ouvrir, IDENTITE } = require('./lib/swf-sprites.js');

const RACINE = path.join(__dirname, '..');
const SWF = path.join(RACINE, 'legacy/main.swf');
const SORTIE = path.join(RACINE, 'public/frutiz/sprites');

const swf = ouvrir(SWF, { textesEnFormes: false });
const arr = (v) => String(Math.round(v * 100) / 100);

const TMP = fs.mkdtempSync(path.join(require('os').tmpdir(), 'chargement-formes-'));
const formes = new Map();
function chargerFormes(ids) {
  if (!ids.length) return;
  execFileSync(process.execPath,
    [path.join(__dirname, 'extract-swf-shapes.js'), SWF, TMP, ...ids.map(String)],
    { stdio: 'pipe' });
  for (const id of ids) {
    const p = path.join(TMP, 'shape' + id + '.svg');
    if (!fs.existsSync(p)) { console.warn('!! forme absente', id); continue; }
    const t = fs.readFileSync(p, 'utf8');
    const vb = /viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/.exec(t);
    formes.set(id, {
      corps: t.replace(/<svg[^>]*>/, '').replace('</svg>', ''),
      vb: { x: +vb[1], y: +vb[2], w: +vb[3], h: +vb[4] },
    });
  }
}

// Une image d'un clip, telle quelle : le SVG garde le cadre PROPRE du dessin,
// c'est la feuille de style qui le pose.
function image(spriteId, frame, nom) {
  const morceaux = swf.aplatir(spriteId, IDENTITE, 0, frame, '', undefined);
  const ids = new Set();
  for (const m of morceaux) if (m.shape !== undefined) ids.add(m.shape);
  chargerFormes([...ids]);
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  const dessins = [];
  for (const m of morceaux) {
    if (m.masque) continue;
    const f = formes.get(m.shape);
    if (!f) continue;
    for (const [px, py] of [[f.vb.x, f.vb.y], [f.vb.x + f.vb.w, f.vb.y],
      [f.vb.x, f.vb.y + f.vb.h], [f.vb.x + f.vb.w, f.vb.y + f.vb.h]]) {
      const sx = m.M.a * px + m.M.c * py + m.M.e / 20;
      const sy = m.M.b * px + m.M.d * py + m.M.f / 20;
      x0 = Math.min(x0, sx); y0 = Math.min(y0, sy);
      x1 = Math.max(x1, sx); y1 = Math.max(y1, sy);
    }
    dessins.push(m);
  }
  if (!dessins.length) return null;
  let corps = '';
  for (const d of dessins) {
    corps += `<g transform="matrix(${[d.M.a, d.M.b, d.M.c, d.M.d, d.M.e / 20, d.M.f / 20]
      .map((v) => +v.toFixed(4)).join(',')})">` + formes.get(d.shape).corps + '</g>\n';
  }
  const c = { x: +arr(x0), y: +arr(y0), w: +arr(x1 - x0), h: +arr(y1 - y0) };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${arr(c.x)} ${arr(c.y)} ${arr(c.w)} ${arr(c.h)}"`
    + ` width="${arr(c.w)}" height="${arr(c.h)}" preserveAspectRatio="none">\n` + corps + '</svg>\n';
  fs.writeFileSync(path.join(SORTIE, nom + '.svg'), svg, 'utf8');
  return { nom, cadre: c };
}

function principal() {
  fs.mkdirSync(SORTIE, { recursive: true });
  const m = {};
  // Le MILIEU, qui s'étire : `preserveAspectRatio="none"` pour que la feuille
  // de style puisse le tirer sans déformer ses bords (il n'en a pas).
  m.milieuPlein = image(142, 1, 'chargement-milieu-plein');
  m.milieuVide = image(142, 2, 'chargement-milieu-vide');
  // Le BOUT, qui ne s'étire pas — le droit est le même, en miroir (`a = −1`).
  m.boutPlein = image(145, 1, 'chargement-bout-plein');
  m.boutVide = image(145, 2, 'chargement-bout-vide');

  /*
   * LA GÉOMÉTRIE, telle que `updateLoadingSize()` (0x087ba) la pose.
   *
   * ATTENTION : la scène de la page de chargement n'est PAS le RECT du SWF
   * (1024 × 768) mais `_global.mcw` × `_global.mch`, et la toute première
   * DoAction du fichier (0x07fd0) les pose à `baseMcw = 1265`, `baseMch = 768`
   * — `StageResize.onResize` les REMET à ces constantes à chaque secousse,
   * puis rappelle `updateLoadingSize()`. La page est donc calculée pour un
   * écran de 1265 × 768, et tout s'y exprime en marges :
   *
   *     mx = 32 ; b = 9 ; x0 = mx + b = 41 ; cy = mch / 2 = 384
   *     title._x     = mcw / 2 = 632,5    title._y     = cy − 24 = 360
   *     info._x      = mcw / 2 = 632,5    info._y      = cy + 32 = 416
   *     fieldInfo._x = mx = 32            fieldInfo._y = cy + 16 = 400
   *     midMax  = mcw − (mx + b) × 2 = 1183
   *     b1 · bgb1 · mid · bgmid  →  _x = 41, _y = cy
   *     bgmid._width = midMax    bgb2._x = bgb1._x + midMax = 1224
   *
   * Le dessin d'un bout va de −9 à 0 : le bout GAUCHE couvre donc x 32..41, et
   * le droit, en miroir à `_x = 41 + largeur`, s'étend vers la droite — la
   * gouttière va ainsi de x = mx à x = mcw − mx, PILE. Verticalement les
   * formes vont de −3 à +15 autour de `_y` : la barre fait 18 de haut, trois
   * pixels au-dessus de la ligne médiane.
   *
   * Le portage garde les FORMULES et remplace mcw/mch par la fenêtre réelle :
   * c'est ce que `updateLoadingSize` fait de toute façon à chaque resize, et
   * à 1265 × 768 le rendu est au pixel celui d'époque.
   */
  m.scene = { w: 1265, h: 768 };      // baseMcw × baseMch, 0x07fd0
  m.geometrie = { mx: 32, b: 9, x0: 41, hauteur: 18, haut: -3,
    // les décalages verticaux, comptés depuis cy = mch / 2
    dyTitre: -24, dyChamp: 16, dyInfo: 32 };
  m.fond = '#ADE76B';                 // SetBackgroundColor de main.swf
  m.encre = '#4D7614';                // les trois champs, relevés au tag
  /*
   * LES TROIS TEXTES, relevés sur leurs DefineEditText — et sur les matrices
   * qui les posent dans leur clip. Un EditText Flash a une GOUTTIÈRE de 2 px :
   * son RECT commence à (−2, −2) et la première ligne pose sa base à
   * `y0 + 2 + ascendante`. Verdana déclare (police #148) ascendante 1030/1024
   * et descendante 215/1024 d'em, d'où la hauteur d'une boîte d'une ligne :
   * 2 + (1,0059 + 0,21) × h + 2 — ce que confirme le RECT du titre (21,05
   * pour h = 14). En CSS, poser `line-height` ÉGAL à cette hauteur remet la
   * base exactement où Flash la met (la demi-interligne vaut alors 2).
   *
   *   #149 « CHARGEMENT »   police 148 (verdana GRAS) 14, centré
   *        RECT (−2,−2)–(145 ; 19,05), posé à (−71,5 ; −8,5) dans `title`
   *   #147 « fichiers téléchargés : 100 % »  police 146 (verdana) 10, à gauche
   *        RECT (−2,−2)–(489,1 ; 15,7) — c'est `fieldInfo` lui-même.
   *        Texte par défaut ; `loadingLoop` le remplace par
   *        « fichiers restants : » + le pourcentage
   *   #152 « Information : »  verdana GRAS 10, centré
   *        RECT (−2,−2)–(194,75 ; 14,05), posé à (−96,4 ; −4,5) dans `info`
   *   #151 la phrase d'époque, verdana 10, centré, multiligne
   *        RECT (−2,−2)–(197,5 ; 121,5), posé à (−97,75 ; 11,45) dans `info`
   *        → une colonne de 199,5 de large, centrée sur mcw / 2
   *
   * Interligne d'un paragraphe : ascendante + descendante + interligne de
   * police (221/1024) + interligne du champ (2) = 1,4317 × h + 2, soit 16,32
   * pour h = 10.
   */
  m.textes = {
    titre: 'CHARGEMENT',
    prefixe: 'fichiers restants : ',
    infoTitre: 'Information :',
    info: "Ce chargement comprend tous les éléments de l'interface de frutiparc"
      + ' ce qui vous permettra de naviguer plus rapidement ensuite !',
    colonneInfo: 197,
  };
  // Les boîtes, en coordonnées d'écran : { dx, dy } depuis (mcw/2, cy) — sauf
  // le champ, ancré à gauche sur mx. `l` et `h` sont le RECT, gouttière
  // comprise ; `police` la hauteur de fonte ; `ligne` l'interligne CSS.
  m.boites = {
    titre: { dx: -73.5, dy: -34.5, l: 147, h: 21.05, police: 14, gras: true, ligne: 21.05 },
    champ: { x: 30, dy: 14, l: 491.1, h: 17.7, police: 10, gras: false, ligne: 16.16 },
    infoTitre: { dx: -98.4, dy: 25.5, l: 196.75, h: 16.05, police: 10, gras: true, ligne: 16.05 },
    info: { dx: -99.75, dy: 41.45, l: 199.5, h: 123.5, police: 10, gras: false, ligne: 16.32 },
  };
  /*
   * ET LA LOI DU RUBAN (`loadingLoop`, 0x08a52) :
   *
   *     ratio = (mLoaded + iLoaded) / (mTotal + iTotal)
   *     coef  = coef × 0.9 + ratio × 0.1          ← lissage exponentiel
   *     pourcentage = round((1 − coef) × 100) + "%"
   *     mid._width  = coef × midMax
   *     b2._x       = b1._x + mid._width
   *     fieldInfo.text = "fichiers restants : " + pourcentage
   *     fini quand tout est chargé ET coef > 0.995
   *
   * LA BARRE MONTE PENDANT QUE LE NOMBRE DESCEND : le libellé compte les
   * fichiers qui RESTENT. C'est d'époque, on le garde.
   */
  m.loi = { lissage: 0.9, seuil: 0.995, cadence: 100 };

  /*
   * La LISTE des dessins de l'interface — « tous les éléments de l'interface
   * de frutiparc », comme la phrase le promet. C'est ce que la page précharge,
   * et c'est ce qui donne au ruban une progression VRAIE.
   *
   * LES PNG COMPTENT AUSSI. Elle ne prenait que les SVG, et les cinquante et
   * un dessins de FEUTRES (bitmap #595 découpé et teinté) sont des PNG : ils
   * n'étaient donc pas préchargés, et la barre des feutres clignotait au
   * premier survol — le défaut même que cette page est censée effacer. Ils
   * échappaient en plus au balayage de la feuille de style, parce que le light
   * les pose en variables CSS (`--feutre-image`), pas en `url()` littéral.
   */
  m.interface = fs.readdirSync(SORTIE)
    .filter((f) => /\.(svg|png)$/.test(f) && !/^chargement-/.test(f))
    .sort()
    .map((f) => '/frutiz/sprites/' + f);

  fs.writeFileSync(path.join(SORTIE, 'chargement.json'), JSON.stringify(m, null, 1), 'utf8');
  for (const k of ['milieuPlein', 'milieuVide', 'boutPlein', 'boutVide']) {
    if (m[k]) console.log(k.padEnd(12), JSON.stringify(m[k].cadre));
  }
  console.log(m.interface.length + ' dessins d’interface à précharger');
  console.log('manifeste → public/frutiz/sprites/chargement.json');
}

principal();
