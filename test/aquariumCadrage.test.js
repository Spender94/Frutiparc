'use strict';
/*
 * LES BOUILLES COUPÉES PAR LE HAUT DANS L'AQUARIUM D'UN SALON
 *
 * Un écran (`cp.FrutiScreen`) fait cent pixels de côté, et la SCÈNE d'une
 * bouille fait 100 × 100 : `Bouille.rendre` y calait la scène exactement, si
 * bien que tout ce qu'une famille dessine EN DEHORS était perdu — pas rogné par
 * une boîte CSS, jamais peint. Or les coiffures de la famille 0 montent, elles,
 * jusqu'à sept unités au-dessus du bord.
 *
 * Relevé au navigateur sur les 2 815 tenues de la famille 0 (67 coiffures et
 * leurs accessoires), cadre réellement dessiné contre la scène :
 *
 *     sans marge      69 tenues coupées de plus d'un pixel EN HAUT,
 *                     la pire (coiffure 30) dépassant de 7 ;
 *     marge de 8 %    fenêtre −8 … 108 : PLUS UNE SEULE coupée en haut.
 *
 * D'où `marge` : une fraction de la scène ajoutée de chaque côté de la FENÊTRE,
 * sans rien changer au dessin. Zéro partout — la fiche, l'éditeur, le forum et
 * les relevés gardent leur cadrage au pixel — et 8 % dans les écrans d'un
 * salon, où la bouille se pose un peu plus petite mais entière.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const MOTEUR = fs.readFileSync(path.join(ROOT, 'public/js/bouille-moteur.js'), 'utf8');
const VIGNETTE = fs.readFileSync(path.join(ROOT, 'public/js/bouille-vignette.js'), 'utf8');
const BUREAU = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.js'), 'utf8');
const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');

const Swf = require('../public/js/bouille-swf.js');
const M = require('../public/js/bouille-moteur.js');

const FAMILLE = path.join(ROOT, 'public/fbouille/famille0.swf');
let defs = null;
async function famille() {
  if (!defs) {
    const b = fs.readFileSync(FAMILLE);
    defs = Swf.lire(await Swf.decompresser(
      b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
  }
  return defs;
}

/*
 * UN CANEVAS DE PAPIER. On ne veut pas des pixels — on veut la MATRICE que
 * `rendre` pose avant de dessiner : c'est elle, et elle seule, qui décide de ce
 * qui rentre dans le champ. Le reste des appels ne fait rien.
 */
function canevasTemoin(cote) {
  const poses = [];
  const ctx = {
    globalAlpha: 1, globalCompositeOperation: 'source-over',
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
    setTransform() { poses.push(Array.prototype.slice.call(arguments)); },
    getTransform() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; },
    save() {}, restore() {}, transform() {}, clearRect() {}, fillRect() {},
    fill() {}, stroke() {}, clip() {},
    createLinearGradient() { return { addColorStop() {} }; },
    createRadialGradient() { return { addColorStop() {} }; },
  };
  const canvas = {
    width: 1, height: 1, clientWidth: cote, clientHeight: cote,
    getContext() { return ctx; },
  };
  return { canvas, poses };
}

// `Path2D` et `DOMMatrix` n'existent pas dans node : le moteur en fabrique pour
// chaque forme et pour chaque masque. Ici, ils n'ont rien à porter.
const AVANT = { Path2D: global.Path2D, DOMMatrix: global.DOMMatrix };
global.Path2D = function Path2D() { this.addPath = function () {}; };
global.DOMMatrix = function DOMMatrix(v) {
  this.a = v[0]; this.b = v[1]; this.c = v[2]; this.d = v[3]; this.e = v[4]; this.f = v[5];
};

/*
 * La FENÊTRE, lue dans la matrice : quelle portion de la scène occupe le
 * canevas. `setTransform(k,0,0,k,tx,ty)` envoie la coordonnée de scène `u` sur
 * le pixel `k·u + tx` ; le bord gauche du canevas montre donc `−tx/k`, et le
 * bord droit `(W − tx)/k`.
 */
function fenetre(poses, cote) {
  const p = poses[1];                       // [0] = la remise à plat de rendre()
  assert.ok(p, 'rendre() n’a pas posé sa matrice');
  const k = p[0];
  // Le « + 0 » ramène le zéro NÉGATIF (−p[4]/k quand p[4] vaut 0) sur le zéro
  // tout court : `deepStrictEqual` les distingue.
  const arrondi = (v) => Math.round(v * 1000) / 1000 + 0;
  return {
    k: arrondi(k),
    x: [arrondi(-p[4] / k), arrondi((cote - p[4]) / k)],
    y: [arrondi(-p[5] / k), arrondi((cote - p[5]) / k)],
  };
}

/* ── 1. LE CADRAGE ────────────────────────────────────────────────────────── */

test('sans marge, la fenêtre épouse la scène — rien ne change ailleurs', async () => {
  const d = await famille();
  assert.deepStrictEqual(d.scene, { x: 0, y: 0, w: 100, h: 100 });
  const t = canevasTemoin(98);
  const b = new M.Bouille(t.canvas, d,
    { etat: '000200010402000f0m0000', anime: false, super: 1, alea: () => 0.5 });
  assert.strictEqual(b.marge, 0, 'la marge est nulle par défaut');
  const f = fenetre(t.poses, 98);
  assert.deepStrictEqual(f.x, [0, 100], 'la scène entière, et rien de plus');
  assert.deepStrictEqual(f.y, [0, 100]);
  assert.strictEqual(f.k, 0.98, '98 pixels pour 100 unités de scène');
});

test('avec 8 % de marge, la fenêtre va de −8 à 108', async () => {
  const d = await famille();
  const t = canevasTemoin(98);
  const b = new M.Bouille(t.canvas, d,
    { etat: '000200010402000f0m0000', anime: false, super: 1, marge: 0.08, alea: () => 0.5 });
  assert.strictEqual(b.marge, 0.08);
  const f = fenetre(t.poses, 98);
  assert.deepStrictEqual(f.x, [-8, 108], 'huit unités d’air de chaque côté');
  assert.deepStrictEqual(f.y, [-8, 108]);
  // La bouille est donc plus petite dans le MÊME écran, dans ce rapport-là.
  assert.strictEqual(f.k, Math.round(98 / 116 * 1000) / 1000);
});

test('sur une boîte qui n’est pas carrée, la marge reste centrée', async () => {
  const d = await famille();
  // L'aperçu de pack de l'admin fait 160 × 180 : Flash y cale la scène au
  // CENTRE (`scaleMode = "showAll"`), et la marge suit la même règle.
  const t = canevasTemoin(0);
  t.canvas.clientWidth = 160; t.canvas.clientHeight = 180;
  new M.Bouille(t.canvas, d,
    { etat: '000200010402000f0m0000', anime: false, super: 1, marge: 0.08, alea: () => 0.5 });
  const p = t.poses[1];
  assert.strictEqual(p[0], p[3], 'un seul facteur : pas d’étirement');
  const rond = (v) => Math.round(v * 1000) / 1000;
  assert.strictEqual(rond(p[0]), rond(160 / 116), 'le petit côté commande');
  const y = [rond(-p[5] / p[0]), rond((180 - p[5]) / p[0])];
  assert.deepStrictEqual([rond(-p[4] / p[0]), rond((160 - p[4]) / p[0])], [-8, 108],
    'le petit côté montre exactement la scène plus ses huit unités');
  assert.strictEqual(rond(y[0] + y[1]), 100, 'et le grand côté déborde autant en haut qu’en bas');
});

test('toutes les familles ont la même scène : 8 % veut dire la même chose', async () => {
  // Les onze SWF de famille déclarent 100 × 100 — c'est ce qui autorise à
  // exprimer la marge en fraction et à n'avoir qu'une constante pour tout le
  // site. Un jour où une famille arriverait avec une autre scène, la fraction
  // continuerait de valoir ; ce test dit simplement d'où vient le « 8 ».
  const d = await famille();
  assert.deepStrictEqual(d.scene, { x: 0, y: 0, w: 100, h: 100 });
  const t = canevasTemoin(98);
  new M.Bouille(t.canvas, d,
    { etat: '000200010402000f0m0000', anime: false, super: 1, marge: 0.08, alea: () => 0.5 });
  const f = fenetre(t.poses, 98);
  assert.strictEqual(f.x[0], -0.08 * d.scene.w);
});

test.after(() => { global.Path2D = AVANT.Path2D; global.DOMMatrix = AVANT.DOMMatrix; });

/* ── 2. LE CÂBLAGE ────────────────────────────────────────────────────────── */

test('la vignette transporte la marge sur le canevas', () => {
  // Elle sort dans le HTML…
  assert.match(VIGNETTE, /var m = \(o && Number\(o\.marge\)\) \|\| 0;/);
  assert.match(VIGNETTE, /\(m > 0 \? ' data-marge="' \+ m \+ '"' : ''\)/);
  // …et le montage la relit — y compris quand un changement de FAMILLE force
  // un remontage, puisque `rafraichir` ne touche pas à l'attribut.
  assert.match(VIGNETTE, /marge: Number\(c\.getAttribute\('data-marge'\)\) \|\| 0,/);
  const r = VIGNETTE.slice(VIGNETTE.indexOf('function rafraichir(c, etat, humeur)'),
    VIGNETTE.indexOf('function vider(c)'));
  assert.ok(!/data-marge/.test(r), 'rafraichir ne doit pas effacer la marge');
});

test('une seule valeur pour tout l’aquarium', () => {
  assert.match(VIGNETTE, /var MARGE_ECRAN = 0\.08;/);
  assert.match(VIGNETTE, /MARGE_ECRAN: MARGE_ECRAN,/);
  // Les écrans du chat ET ceux de Gaspard : c'est le même `cp.FrutiScreen`,
  // et la même fonction qui y pose la bouille.
  assert.match(BUREAU, /ecran\.insertAdjacentHTML\('afterbegin', FPBouilleVignette\.html\(bouille,\s*\n\s*\{ humeur: Number\(em\), marge: FPBouilleVignette\.MARGE_ECRAN \}\)\);/);
  // Et la scène de l'émotion, qui vient jouer DANS l'écran : même cadrage,
  // sinon le visage changerait de taille le temps de la réaction.
  assert.match(LIGHT, /scene\.innerHTML = FPBouilleVignette\.html\(etat \|\| DEFAULT_BOUILLE,\s*\n\s*\{ anime: true, marge: FPBouilleVignette\.MARGE_ECRAN \}\);/);
});

test('la marge reste à l’écart du reste du site', () => {
  // La fiche, le trombinoscope, l'éditeur, l'admin, le forum : aucun d'eux ne
  // la demande, et le cadrage y est donc au pixel celui d'avant.
  const ailleurs = [
    /stage\.innerHTML = FPBouilleVignette\.html\(s, \{ humeur: e \}\);/,      // la bouille du bureau
    /return FPBouilleVignette\.html\(state \|\| DEFAULT_BOUILLE\);/,          // la fiche
  ];
  ailleurs.forEach((re) => assert.match(LIGHT, re));
  assert.match(MOTEUR, /this\.marge = Math\.max\(0, Number\(options\.marge\) \|\| 0\);/);
});
