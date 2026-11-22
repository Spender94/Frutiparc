/*
 * Le onzième lot de retours MiniPixiz.
 *
 *   · La pause de l'Arbre creux, encore. Le dixième lot avait assombri son
 *     voile à 97 % pour qu'il continue de cacher le plateau ; l'admin a
 *     tranché (22 novembre 2026) : « l'idée est de voir à travers ». Le voile
 *     reste un violet de nuit, mais à 55 % : la grille figée se lit, rien
 *     n'éblouit, et le panneau « Pause » reste lisible.
 *   · Les sorts qui prennent la mana et ne font rien à partir du deuxième
 *     lancer. Le sort d'une fée est un objet unique, relancé tel quel ; son
 *     `update` tourne déjà entre le rangement et le lancer, et y lisait les
 *     restes du lancer précédent. Le Météore avait été réparé au dixième lot ;
 *     la Dactylo (`startPiece`) et l'Exaltation (`timer`) avaient la même
 *     faille. La Cloche d'immunité, soupçonnée, ne l'avait pas : sa
 *     dissipation efface sa bulle. Et pour les sorts à venir, un garde-fou :
 *     le champ ne fait plus vivre un sort qui attend son lancer.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const E = require(path.join(ROOT, 'public/minipixiz/engine.js'));
const C = require(path.join(ROOT, 'public/minipixiz/combat.js'));
const S = require(path.join(ROOT, 'public/minipixiz/sorts.js'));
const F = require(path.join(ROOT, 'public/minipixiz/faerie.js'));

function tirage(g) {
  let s = g;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

// ── Le client, sur une page factice ───────────────────────────────────────
//
// Comme minipixizRetours10.test.js : le script de navigateur est chargé dans
// une fonction dont les paramètres masquent les globales, et construit pour de
// bon sur un canevas qui retient ses écouteurs.
function bus() {
  const ecoutes = {};
  return {
    ecoutes,
    addEventListener(n, f) { (ecoutes[n] = ecoutes[n] || []).push(f); },
    emettre(n, ev) { (ecoutes[n] || []).forEach((f) => f(ev || { preventDefault() {} })); },
  };
}

function client() {
  const src = fs.readFileSync(path.join(ROOT, 'public/minipixiz/game.js'), 'utf8');
  const fenetre = Object.assign(bus(), {
    MinipixizLangue: require(path.join(ROOT, 'public/minipixiz/langue.js')),
    MinipixizEngine: E, MinipixizCombat: C, devicePixelRatio: 1,
  });
  const doc = Object.assign(bus(), {
    hidden: false,
    body: { clientWidth: 0, clientHeight: 0 },
    createElement: () => ({ getContext: () => ({}), width: 0, height: 0 }),
    querySelectorAll: () => [],
    querySelector: () => null,
  });
  new Function('window', 'document', 'navigator', 'Image', src)(fenetre, doc, { userAgent: '' }, function () {});
  const canevas = Object.assign(bus(), {
    getContext: () => ({}), parentElement: null, style: {},
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  });
  const c = new fenetre.MinipixizClient.Client({ canvas: canevas, sprites: {} });
  return { c, fenetre, doc, canevas };
}

// Un contexte de dessin qui note chaque aplat posé.
function contexteEspion() {
  const aplats = [];
  return {
    aplats,
    fillStyle: '',
    fillRect(x, y, l, h) { aplats.push({ style: this.fillStyle, x, y, l, h }); },
    save() {}, restore() {}, fillText() {},
  };
}
function lireRgba(style) {
  const m = /^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/.exec(style);
  assert.ok(m, 'un aplat rgba : ' + style);
  return { r: +m[1], g: +m[2], b: +m[3], a: +m[4] };
}

// Les aplats successifs du voile, image après image, depuis l'appui sur P.
function voileApresPause(c, images) {
  c.basculerPause();
  assert.strictEqual(c.pause, true);
  const ctx = contexteEspion();
  for (let i = 0; i < images; i++) c.dessinerPause(ctx, 1);
  return ctx.aplats.map((a) => Object.assign(lireRgba(a.style), { x: a.x, y: a.y, l: a.l, h: a.h }));
}

// ── 1 · Le voile de pause de l'arbre creux, vu à travers ──────────────────

// La clarté perçue (L*, CIE) et la luminance relative (pour le contraste d'un
// texte, à la manière du WCAG).
function luminance(c) {
  const l = (x) => { const s = x / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  return 0.2126 * l(c[0]) + 0.7152 * l(c[1]) + 0.0722 * l(c[2]);
}
function clarte(c) {
  const Y = luminance(c);
  return Y > 0.008856 ? 116 * Math.cbrt(Y) - 16 : 903.3 * Y;
}
// Ce que l'œil voit d'une couleur sous un voile.
function sous(v, a, c) {
  return [v.r * a + c[0] * (1 - a), v.g * a + c[1] * (1 - a), v.b * a + c[2] * (1 - a)];
}
const rgb = (n) => [(n >> 16) & 0xFF, (n >> 8) & 0xFF, n & 0xFF];
const NOIR = [0, 0, 0];                // le creux du tronc, derrière la grille
const BLANC = [255, 255, 255];
const ANCIEN = { r: 24, g: 20, b: 42, a: 0.97 };
const LAVANDE = { r: 147, g: 141, b: 195, a: 0.9 };

function voileDeLArbre() {
  const { c } = client();
  c.lieu = { cadre: 'cadreArbre' };
  return voileApresPause(c, 12);
}

test('arbre creux : le voile de pause laisse voir le plateau', () => {
  const voiles = voileDeLArbre();
  const fin = voiles[voiles.length - 1];
  // Toujours toute la scène — le plateau, le tronc, le score.
  assert.deepStrictEqual([fin.x, fin.y, fin.l, fin.h], [0, 0, 240, 240]);
  // Translucide : on voit à travers, et l'on voit bien qu'on est en pause.
  assert.ok(fin.a >= 0.45 && fin.a <= 0.65, 'entre 45 et 65 % d\'opacité : ' + fin.a);
  // Chacune des huit couleurs de bille se détache du creux noir du tronc —
  // ce que l'ancien voile à 97 % empêchait (3 points de clarté au plus).
  for (const n of E.COULEURS) {
    const ecart = clarte(sous(fin, fin.a, rgb(n))) - clarte(sous(fin, fin.a, NOIR));
    const avant = clarte(sous(ANCIEN, ANCIEN.a, rgb(n))) - clarte(sous(ANCIEN, ANCIEN.a, NOIR));
    assert.ok(ecart >= 15, 'la bille ' + n.toString(16) + ' se lit sous le voile : ' + ecart.toFixed(1));
    assert.ok(ecart > avant * 5, 'bien mieux que sous l\'ancien voile (' + avant.toFixed(1) + ')');
  }
});

test('arbre creux : le voile reste doux pour les yeux, et le panneau lisible', () => {
  const voiles = voileDeLArbre();
  const fin = voiles[voiles.length - 1];
  // Sombre : pas de retour à l'aplat clair qui éblouissait.
  assert.ok(fin.r < 60 && fin.g < 60 && fin.b < 60, 'un violet de nuit : ' + [fin.r, fin.g, fin.b].join(','));
  assert.ok(fin.b >= fin.r && fin.b >= fin.g, 'il reste violet (le bleu domine)');
  // Ce que la scène a de plus clair reste en dessous de l'aplat lavande.
  assert.ok(clarte(sous(fin, fin.a, BLANC)) < clarte(sous(LAVANDE, LAVANDE.a, BLANC)) - 5,
    'le blanc le plus vif, voilé, reste plus sombre que la lavande');
  // « Pause » et sa consigne s'écrivent en blanc PAR-DESSUS le voile : même
  // sur ce que le plateau a de plus clair, le contraste tient (3:1).
  const contraste = 1.05 / (luminance(sous(fin, fin.a, BLANC)) + 0.05);
  assert.ok(contraste >= 3, 'le blanc du panneau reste lisible : ' + contraste.toFixed(2) + ':1');
});

test('arbre creux : le voile monte comme la lavande, rapporté à son plafond', () => {
  const voiles = voileDeLArbre();
  const fin = voiles[voiles.length - 1];
  // `max × (1 + pauseAlpha / 90)` : la moitié à la première image, les trois
  // quarts à la deuxième — le geste de `90 + pauseAlpha`.
  assert.ok(Math.abs(voiles[0].a - fin.a / 2) < 0.002, 'la moitié d\'abord : ' + voiles[0].a);
  assert.ok(Math.abs(voiles[1].a - fin.a * 0.75) < 0.002, 'puis les trois quarts : ' + voiles[1].a);
  for (let i = 1; i < voiles.length; i++) assert.ok(voiles[i].a >= voiles[i - 1].a, 'sans jamais redescendre');
  // La couleur ne change pas pendant le fondu : seule l'opacité monte.
  for (const v of voiles) assert.deepStrictEqual([v.r, v.g, v.b], [fin.r, fin.g, fin.b]);
});

// ── 2 · Les sorts relancés ────────────────────────────────────────────────
//
// Le décor de minipixizRetours10 (le Météore) : une fée qui ne connaît qu'un
// sort, une grille qui ne se gagne pas en route, trois rangées de pierres au
// fond pour que rien ne s'y groupe.
function partieAuSort(id) {
  const alea = tirage(7);
  const fsd = F.genererGraine(alea);
  fsd.$level = 12; fsd.$carac = [4, 4, 4, 4, 4, 8]; fsd.$life = 4; fsd.$mana = 16; fsd.$spell = [20, id];
  const fi = new F.Fee(fsd, alea, { $inv: [] });
  const jeu = new E.Jeu({ graine: 3, niveau: 30, grille: null, couleursSeVident: false });
  const champ = new C.Champ(jeu, { fee: fi });
  const f = champ.faerieList[0];
  return { jeu, champ, fi, f, s: f.sortList[0] };
}

function poserPierres(jeu) {
  for (const e of jeu.eList.slice()) e.tuer();
  for (let x = 0; x < jeu.xMax; x++) {
    for (let y = jeu.yMax - 3; y < jeu.yMax; y++) jeu.genElement(E.E.PIERRE, x, y, 3);
  }
}
function poserLaPiece(jeu) {
  let n = 0;
  while (jeu.step === E.ETAPE.JEU && n++ < 5000) { jeu.entree.bas = (n % 4) < 2; jeu.update(1); }
  jeu.entree.bas = false;
}
function jusquALaPieceSuivante(jeu) {
  let n = 0;
  while (jeu.step !== E.ETAPE.JEU && n++ < 5000 && !jeu.termine) jeu.update(1);
}
function unePiece(jeu) {
  poserPierres(jeu);
  poserLaPiece(jeu);
  jusquALaPieceSuivante(jeu);
}

// Un démon de rang 0 qui ne fait que voler : l'Exaltation et la Cloche ne
// valent quelque chose qu'en sa présence, mais ses propres sorts brouilleraient
// la mesure.
function demonMuet(champ) {
  const imp = champ.naitreImpy(0, 60, 60);
  imp.action = 5;
  imp.spellCoolDown = 1e9;
  return imp;
}

// Le joueur appelle sa fée pendant le tour ; elle choisit à la fin.
function appeler(jeu, f, tour) {
  poserPierres(jeu);
  f.poserMana(16);
  assert.ok(jeu.appelerAide(), 'tour ' + tour + ' : la fée répond');
  poserLaPiece(jeu);
  jusquALaPieceSuivante(jeu);
}

test('la Dactylo retire une bille À CHAQUE lancer, pas seulement le premier', () => {
  const { jeu, f, s } = partieAuSort(2);
  assert.strictEqual(s.nom(), 'Dactylo');
  const lances = [];
  jeu.onEvent = (nom, d) => { if (nom === 'sort') lances.push(d.nom); };
  jusquALaPieceSuivante(jeu);
  const base = jeu.shapeNumInc;
  const taille = jeu.piece.list.length;

  for (let tour = 1; tour <= 4; tour++) {
    appeler(jeu, f, tour);
    assert.strictEqual(lances.length, tour, 'tour ' + tour + ' : le sort est parti');
    assert.strictEqual(f.mana, 14, 'tour ' + tour + ' : deux de mana dépensés');
    assert.ok(jeu.sList.includes(s), 'tour ' + tour + ' : l\'effet dure'
      + ' (avant le correctif : dissipée avant même son lancer, dès le deuxième)');
    assert.strictEqual(jeu.shapeNumInc, base - 1, 'tour ' + tour + ' : une bille de moins par pièce');
    unePiece(jeu);
    assert.strictEqual(jeu.piece.list.length, taille - 1, 'tour ' + tour + ' : la pièce qui tombe est plus petite');
    // Quatre pièces par point de concentration, puis elle s'en va d'elle-même.
    let n = 0;
    while (jeu.sList.includes(s) && n++ < 40) unePiece(jeu);
    assert.ok(n <= 18, 'tour ' + tour + ' : seize pièces, à peu près, pas davantage (' + n + ')');
    assert.strictEqual(jeu.shapeNumInc, base, 'tour ' + tour + ' : les pièces reprennent leur taille');
    assert.notStrictEqual(f.sortEnCours, s, 'tour ' + tour + ' : la fée n\'a plus de sort en cours');
  }
});

test('rappeler la Dactylo sitôt disponible ne grossit jamais les pièces', () => {
  // Le pire de la panne : restée « sort en cours » après un lancer raté, elle
  // s'interrompait elle-même au lancer suivant — sa dissipation RENDAIT une
  // bille que l'animation coupée ne reprenait jamais. Une de plus par rappel.
  const { jeu, f, s } = partieAuSort(2);
  let lances = 0;
  jeu.onEvent = (nom) => { if (nom === 'sort') lances++; };
  jusquALaPieceSuivante(jeu);
  const base = jeu.shapeNumInc;
  for (let i = 0; i < 150 && lances < 5; i++) {
    if (s.disponible()) appeler(jeu, f, lances + 1);
    else unePiece(jeu);
    assert.ok(jeu.shapeNumInc <= base, 'jamais une bille de plus que la normale : '
      + jeu.shapeNumInc + ' après ' + lances + ' lancers');
  }
  assert.strictEqual(lances, 5, 'cinq lancers');
});

test('ranger la Dactylo efface la trace du lancer précédent', () => {
  // À nu, sans le champ : l'`update` d'un sort rangé ne doit plus voir une
  // `startPiece` échue.
  const { jeu, s } = partieAuSort(2);
  jusquALaPieceSuivante(jeu);
  const base = jeu.shapeNumInc;
  s.startPiece = jeu.pieces - 100;     // ce que laisse un premier lancer, bien plus tôt
  s.ranger();
  s.update(1);
  assert.ok(jeu.sList.includes(s), 'pas dissipée avant son lancer');
  assert.strictEqual(jeu.shapeNumInc, base, 'et aucune bille rendue en trop');
});

test('l\'Exaltation donne sa force À CHAQUE lancer, et la fée charge toujours', () => {
  const { jeu, champ, fi, f, s } = partieAuSort(8);
  assert.strictEqual(s.nom(), 'Exaltation');
  const lances = [];
  jeu.onEvent = (nom, d) => { if (nom === 'sort') lances.push(d.nom); };
  jusquALaPieceSuivante(jeu);
  const imp = demonMuet(champ);
  const force = fi.carac[C.FORCE];
  const charge = f.freqDash;
  assert.ok(charge > 0);

  for (let tour = 1; tour <= 4; tour++) {
    imp.health = 1e9; f.health = 100;
    appeler(jeu, f, tour);
    assert.strictEqual(lances.length, tour, 'tour ' + tour + ' : le sort est parti');
    assert.strictEqual(f.mana, 13, 'tour ' + tour + ' : trois de mana dépensés');
    assert.strictEqual(fi.carac[C.FORCE], force + 5, 'tour ' + tour + ' : cinq de force en plus'
      + ' (avant le correctif : rien, dès le deuxième lancer)');
    assert.strictEqual(f.freqDash, charge * 20, 'tour ' + tour + ' : vingt fois plus de charges');
    assert.ok(jeu.sList.includes(s), 'tour ' + tour + ' : la fureur décompte');
    // Quatre cents images, puis tout revient.
    let n = 0;
    while (jeu.sList.includes(s) && n++ < 40) { imp.health = 1e9; f.health = 100; unePiece(jeu); }
    assert.ok(!jeu.sList.includes(s), 'tour ' + tour + ' : la fureur s\'éteint');
    assert.strictEqual(fi.carac[C.FORCE], force, 'tour ' + tour + ' : la force d\'avant, ni plus ni moins');
    assert.strictEqual(f.freqDash, charge, 'tour ' + tour + ' : la cadence de charge d\'avant'
      + ' (avant le correctif : 15 / 20 arrondi, zéro — plus aucune charge)');
    assert.notStrictEqual(f.sortEnCours, s, 'tour ' + tour + ' : la fée n\'a plus de sort en cours');
  }
});

test('ranger l\'Exaltation efface le chrono échu du lancer précédent', () => {
  const { jeu, fi, f, s } = partieAuSort(8);
  jusquALaPieceSuivante(jeu);
  const force = fi.carac[C.FORCE];
  const charge = f.freqDash;
  s.timer = -0.5;                      // ce que laisse une fureur éteinte
  s.ranger();
  s.update(1);
  assert.ok(jeu.sList.includes(s), 'pas dissipée avant son lancer');
  assert.strictEqual(fi.carac[C.FORCE], force, 'pas cinq de force retirés pour rien');
  assert.strictEqual(f.freqDash, charge, 'ni la cadence de charge divisée');
});

test('la Cloche d\'immunité, elle, tenait déjà à chaque lancer', () => {
  // Soupçonnée de la même faille (sa `bulle`), elle ne l'avait pas : sa
  // dissipation tue la bulle ET l'oublie, et son `update` ne fait rien sans
  // elle. Ce test le garde.
  const { jeu, champ, f, s } = partieAuSort(12);
  assert.strictEqual(s.nom(), 'Cloche d\'immunité');
  const lances = [];
  jeu.onEvent = (nom, d) => { if (nom === 'sort') lances.push(d.nom); };
  jusquALaPieceSuivante(jeu);
  const imp = demonMuet(champ);
  for (let tour = 1; tour <= 3; tour++) {
    imp.health = 1e9; f.health = 100;
    appeler(jeu, f, tour);
    assert.strictEqual(lances.length, tour, 'tour ' + tour + ' : le sort est parti');
    assert.ok(s.bulle && s.bulle.vivant, 'tour ' + tour + ' : la bulle est levée');
    assert.ok(jeu.sList.includes(s), 'tour ' + tour + ' : et elle tient');
    let n = 0;
    while (jeu.sList.includes(s) && n++ < 40) { imp.health = 1e9; f.health = 100; unePiece(jeu); }
    assert.strictEqual(s.bulle, null, 'tour ' + tour + ' : puis elle s\'efface');
    assert.notStrictEqual(f.sortEnCours, s);
  }
});

test('garde-fou : aucun sort ne vit entre son rangement et son lancer', () => {
  // Un sort à venir, qui n'effacerait rien au rangement : il note, à chaque
  // image où il vit, s'il a bien été lancé autant de fois que rangé.
  class Temoin extends S.Sort {
    constructor(c) { super(c); this.cout = 1; this.ranges = 0; this.lances = 0; this.vus = []; }
    ranger() { this.ranges++; super.ranger(); }
    lancer() { this.lances++; super.lancer(); }
    update() { this.vus.push(this.lances === this.ranges); }
    // Il rend la main aussitôt ; son effet dure jusqu'à la pièce suivante.
    initStep(n) { this.step = n; if (n === 0) this.finActif(); }
    surEntretien() { this.dissiper(); }
    nom() { return 'Témoin'; }
  }
  const { jeu, champ, fi, f } = partieAuSort(2);
  const t = new Temoin(champ);
  t.fi = fi; t.lanceur = f; t.sid = 2;
  f.sortList = [t];
  jusquALaPieceSuivante(jeu);
  for (let tour = 1; tour <= 3; tour++) {
    appeler(jeu, f, tour);
    assert.strictEqual(t.lances, tour, 'tour ' + tour + ' : lancé');
    unePiece(jeu);
  }
  assert.ok(t.vus.length > 0, 'il a vécu');
  assert.ok(t.vus.every(Boolean), 'jamais avant son lancer (images vues : '
    + t.vus.filter((v) => !v).length + ' de trop)');
});
