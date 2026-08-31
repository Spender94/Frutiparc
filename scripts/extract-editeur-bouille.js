#!/usr/bin/env node
/*
 * Sort les DESSINS DE L'ÉDITEUR DE FRUTIBOUILLE (main.swf) — « Ma Frutibouille »,
 * la fenêtre qu'on reçoit tant qu'on n'a pas fait sa tête.
 *
 *   node scripts/extract-editeur-bouille.js      → écrit public/frutiz/sprites/
 *
 * ── CE QUE LA FENÊTRE EST, D'APRÈS LE BYTECODE ────────────────────────────
 *
 * `win.EditFrutibouille extends win.Advance` (0xa2e4d). Elle ne dessine rien
 * elle-même : elle EMPILE des composants, et c'est cet empilement qu'il faut
 * refaire.
 *
 *   init()                topIconList.splice(0, 3)     ← trois icônes de moins
 *                         modifList = [1..8] par défaut
 *                         str = "000000000000020000"   ← neuf paires
 *   initFrameSet()        un compo `screenFrame`, lien `frutiScreen`,
 *                         min {w:200, h:100}, args {fix:{w:100, h:100}},
 *                         mainStyleName "frSystem", marge y {ratio:0, min:10}
 *   initControlPanel()    pour chaque id de modifList, un compo `console<i>`,
 *                         lien `cpFBConsole`, min {w:140, h:26},
 *                         args {id, val: decode62(str[2i..2i+2]), parent}
 *                         puis un `cpDocument` de 140 × 22 portant
 *                         <b t="valider" l="butPushStandard" o="win" m="validate"/>
 *
 * `cp.FBConsole` (0x9097b), une ligne :
 *
 *   attachArrow()   attachMovie("butPush", "left",  20,
 *                     {link:"butPushSmallPink", frame:11, → incValue(-1)})
 *                   attachMovie("butPush", "right", 21,
 *                     {link:"butPushSmallPink", frame:10, → incValue(+1)})
 *   updateSize()    right._x = width − height   ← les flèches sont CARRÉES,
 *                                                 du côté de la hauteur
 *   attachText()    un champ CENTRÉ, texte = info[id].name, entre les deux :
 *                   field._x = height ; field._width = width − 2 × height
 *   type "color"    pas de texte mais un ÉCHANTILLON :
 *                   drawSmoothSquare(this, {x: h+10, y: 2,
 *                                           w: w − 2h − 20, h: h − 4},
 *                                    style.global.color.inline, curve 12)
 *                   puis, rentré de 2 de tous les côtés,
 *                   drawCustomSquare(colorSample, r,
 *                     {outline:0, inline:2, curve:10,
 *                      color:{main:0xFFFFFF, inline:0xBBBBBB}})
 *                   setColor(colorSample, generalPalette[val])
 *
 * ── CE QU'IL Y A À SORTIR ─────────────────────────────────────────────────
 *
 * Une seule chose, en fait : les DEUX FLÈCHES. Tout le reste existe déjà dans
 * le portage — la fenêtre et son bandeau, l'écran de bouille (`frutiScreen`,
 * celui de la fiche), le bouton `butPushStandard` du `cpDocument`.
 *
 * `butPushSmallPink` (#378) pose trois formes à son image 1 : la GÉLULE #359
 * (20 × 20, anneau #F28687 sur fond #FFAAAD), la bande d'icônes #374 et le
 * REFLET #375. C'est la bande que `frame` vise, et ses images 10 et 11 sont LA
 * MÊME FORME, le triangle #367, la seconde RETOURNÉE :
 *
 *   f10  place #367  matrix(1, 0, 0, 1.0045, 10, 10)     → vers la droite
 *   f11  place #367  matrix(-1, 0, 0, 1.0045, 10, 10)    → vers la gauche
 *
 * Le triangle est donc dessiné autour de son origine et posé au CENTRE de la
 * gélule (10, 10) ; la retourner, c'est nier son échelle en x. On compose les
 * trois formes dans le cadre de la gélule, et on écrit deux SVG.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RACINE = path.join(__dirname, '..');
const SWF = path.join(RACINE, 'legacy/main.swf');
const SORTIE = path.join(RACINE, 'public/frutiz/sprites');

const GELULE = 359;          // la plaque rose de butPushSmallPink
const REFLET = 375;          // le filet blanc du haut
const TRIANGLE = 367;        // l'icône des images 10 et 11 de la bande #374

// Les images 10 et 11 de la bande, relevées au désassembleur : même forme,
// même translation, l'échelle en x change de signe.
const FLECHES = [
  { cle: 'fb-fleche-droite', m: [1, 0, 0, 1.0045, 10, 10], image: 10 },
  { cle: 'fb-fleche-gauche', m: [-1, 0, 0, 1.0045, 10, 10], image: 11 },
];

function arr(v) { return String(Math.round(v * 100) / 100); }

function formes(ids) {
  const dossier = fs.mkdtempSync(path.join(require('os').tmpdir(), 'fb-editeur-'));
  execFileSync(process.execPath,
    [path.join(__dirname, 'extract-swf-shapes.js'), SWF, dossier, ...ids.map(String)],
    { stdio: 'pipe' });
  const out = new Map();
  for (const id of ids) {
    const p = path.join(dossier, 'shape' + id + '.svg');
    if (!fs.existsSync(p)) { console.warn('!! forme absente : #' + id); continue; }
    const t = fs.readFileSync(p, 'utf8');
    const vb = /viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/.exec(t);
    out.set(id, {
      corps: t.replace(/<svg[^>]*>/, '').replace('</svg>', ''),
      vb: { x: +vb[1], y: +vb[2], w: +vb[3], h: +vb[4] },
    });
  }
  fs.rmSync(dossier, { recursive: true, force: true });
  return out;
}

function principal() {
  fs.mkdirSync(SORTIE, { recursive: true });
  const f = formes([GELULE, REFLET, TRIANGLE]);
  const gelule = f.get(GELULE);
  if (!gelule) throw new Error('la gélule #' + GELULE + ' manque');
  // Le cadre du bouton est celui de la gélule : les icônes tiennent dedans.
  const c = gelule.vb;
  const manifeste = {
    cadre: { x: +arr(c.x), y: +arr(c.y), w: +arr(c.w), h: +arr(c.h) },
    notes: 'cp.FBConsole : butPushSmallPink #378, images 10 (droite) et 11 '
      + '(gauche) de la bande #374 — le triangle #367, retourné pour la gauche',
  };
  for (const fl of FLECHES) {
    const tri = f.get(TRIANGLE);
    if (!tri) { console.warn('!! triangle absent'); continue; }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${arr(c.x)} ${arr(c.y)} ${arr(c.w)} ${arr(c.h)}"`
      + ` width="${arr(c.w)}" height="${arr(c.h)}">\n`
      + gelule.corps + (f.get(REFLET) ? f.get(REFLET).corps : '')
      // La matrice garde SA précision : `arr` arrondit au centième et
      // ramènerait l'échelle 1.0045 à 1.
      + `<g transform="matrix(${fl.m.join(',')})">` + tri.corps + '</g>\n'
      + '</svg>\n';
    fs.writeFileSync(path.join(SORTIE, fl.cle + '.svg'), svg, 'utf8');
    manifeste[fl.cle] = { fichier: fl.cle + '.svg', image: fl.image };
    console.log(fl.cle + '.svg (image ' + fl.image + ' de la bande #374)');
  }
  // Le manifeste du bureau est COMMUN : on le relit avant d'y ajouter, sans
  // quoi on effacerait tout ce que `extract-frutiz-bureau.js` y a mis.
  const chemin = path.join(SORTIE, 'bureau.json');
  let tout = {};
  try { tout = JSON.parse(fs.readFileSync(chemin, 'utf8')) || {}; } catch (e) { tout = {}; }
  tout.editeurBouille = manifeste;
  fs.writeFileSync(chemin, JSON.stringify(tout, null, 1), 'utf8');
  console.log('manifeste → public/frutiz/sprites/bureau.json (editeurBouille)');
}

principal();
