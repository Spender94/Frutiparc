/*
 * Le dixième lot de retours MiniPixiz : la pause, et le Météore.
 *
 *   · « Réduire l'opacité du fond d'écran quand on Pause dans l'Arbre creux —
 *     pour la santé de nos yeux. » — l'aplat lavande à 90 % éblouissait. Dans
 *     l'arbre creux (le mode classé), la pause doit pourtant CACHER le
 *     plateau : le voile y devient un violet de nuit à 97 %, plus couvrant,
 *     plus doux. Partout ailleurs, la lavande du jeu d'origine reste.
 *   · « Le sort Météores bugue, il fonctionne 1 fois sur 3 alors que la mana
 *     est retirée à chaque fois. » — le sort d'une fée est un objet unique,
 *     relancé tel quel, et son `flUsed` du lancer précédent le dissipait
 *     avant même d'être lancé. Il se remet à zéro au rangement.
 *   · « Lorsqu'on fait pause pendant l'animation de fin de niveau, la pause se
 *     retire toute seule pour passer au niveau suivant. » — le compte de
 *     l'envol courait dans le dessin, pause ou pas. L'envol attend la reprise.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const E = require(path.join(ROOT, 'public/minipixiz/engine.js'));
const C = require(path.join(ROOT, 'public/minipixiz/combat.js'));
const F = require(path.join(ROOT, 'public/minipixiz/faerie.js'));

function tirage(g) {
  let s = g;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

// ── Le client, sur une page factice ───────────────────────────────────────
//
// Comme minipixizPauseFenetre.test.js : le script de navigateur est chargé
// dans une fonction dont les paramètres masquent les globales, et construit
// pour de bon sur un canevas qui retient ses écouteurs.
function bus() {
  const ecoutes = {};
  return {
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
  return { c, fenetre };
}
const touche = (key, keyCode) => ({ key, keyCode, preventDefault() {} });

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

// ── 1 · Le voile de pause de l'arbre creux ────────────────────────────────

test('arbre creux : la pause pose un voile SOMBRE qui cache toujours tout le plateau', () => {
  const { c } = client();
  c.lieu = { cadre: 'cadreArbre' };
  const voiles = voileApresPause(c, 12);
  const fin = voiles[voiles.length - 1];
  // Toute la scène, plateau, tronc et score compris.
  assert.deepStrictEqual([fin.x, fin.y, fin.l, fin.h], [0, 0, 240, 240]);
  // Sombre : plus de lavande éblouissante.
  assert.ok(fin.r < 60 && fin.g < 60 && fin.b < 60, 'un violet de nuit, pas la lavande : '
    + [fin.r, fin.g, fin.b].join(','));
  assert.ok(fin.b >= fin.r && fin.b >= fin.g, 'il reste violet (le bleu domine)');
  // Couvrant : l'anti-triche veut un plateau caché pendant la pause.
  assert.ok(fin.a >= 0.9, 'au moins 90 % d\'opacité : ' + fin.a);
  // Et le fondu d'origine est gardé : il monte, il ne tombe pas d'un coup.
  assert.ok(voiles[0].a < fin.a, 'le voile monte en quelques images');
  for (let i = 1; i < voiles.length; i++) assert.ok(voiles[i].a >= voiles[i - 1].a, 'sans jamais redescendre');
  // La lavande à 90 % laissait voir la grille à un écart de clarté donné ;
  // sous le voile sombre, une bille vive doit s'en détacher MOINS.
  const lum = (v) => {
    const l = (x) => { const s = x / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
    const Y = 0.2126 * l(v.r) + 0.7152 * l(v.g) + 0.0722 * l(v.b);
    return Y > 0.008856 ? 116 * Math.cbrt(Y) - 16 : 903.3 * Y;     // L* (CIE)
  };
  const sous = (voile, a, bille) => ({
    r: voile.r * a + bille[0] * (1 - a), g: voile.g * a + bille[1] * (1 - a), b: voile.b * a + bille[2] * (1 - a),
  });
  const ecart = (voile, a) => lum(sous(voile, a, [255, 204, 0])) - lum(sous(voile, a, [0, 0, 0]));
  assert.ok(ecart(fin, fin.a) < ecart({ r: 147, g: 141, b: 195 }, 0.9),
    'la grille se lit moins sous le voile sombre que sous la lavande');
});

test('ailleurs, le voile de pause reste la lavande du jeu d\'origine, à 90 %', () => {
  for (const poser of [
    (c) => { c.jeu = { termine: false }; },                          // la forêt
    (c) => { c.lieu = { cadre: 'cadreDonjon' }; },                   // le donjon
    (c) => { c.bassin = {}; },                                       // le bassin
  ]) {
    const { c } = client();
    poser(c);
    const voiles = voileApresPause(c, 12);
    const fin = voiles[voiles.length - 1];
    assert.deepStrictEqual([fin.r, fin.g, fin.b, fin.a], [147, 141, 195, 0.9]);
    // Manager.update : `pauseAlpha *= 0.5`, voile à `90 + pauseAlpha` — à la
    // première image, la moitié.
    assert.strictEqual(voiles[0].a, 0.45);
  }
});

// ── 2 · Le Météore, lancé plusieurs fois dans la même partie ──────────────

// Une fée qui ne connaît que le Météore (sort 3) — la Balle de lumière (20)
// est un tir, elle ne compte pas dans le choix d'un sort.
function partieAuMeteore() {
  const alea = tirage(7);
  const fsd = F.genererGraine(alea);
  fsd.$level = 12; fsd.$carac = [4, 4, 4, 4, 4, 8]; fsd.$life = 4; fsd.$mana = 16; fsd.$spell = [20, 3];
  const fi = new F.Fee(fsd, alea, { $inv: [] });
  // Grille vide, couleurs qui ne se vident pas : le niveau ne se gagne pas en
  // cours de route, et c'est le test qui pose le décor.
  const jeu = new E.Jeu({ graine: 3, niveau: 30, grille: null, couleursSeVident: false });
  const champ = new C.Champ(jeu, { fee: fi });
  return { jeu, champ, f: champ.faerieList[0] };
}

// Trois rangées de pierres au fond : rien ne s'y groupe, et la pièce de feu a
// toujours de quoi brûler, où qu'elle tombe.
function poserPierres(jeu) {
  for (const e of jeu.eList.slice()) e.tuer();
  for (let x = 0; x < jeu.xMax; x++) {
    for (let y = jeu.yMax - 3; y < jeu.yMax; y++) jeu.genElement(E.E.PIERRE, x, y, 3);
  }
}

// Le joueur appuie sur « bas » par à-coups jusqu'à ce que la pièce se pose.
function poserLaPiece(jeu) {
  let n = 0;
  while (jeu.step === E.ETAPE.JEU && n++ < 5000) { jeu.entree.bas = (n % 4) < 2; jeu.update(1); }
  jeu.entree.bas = false;
}
function jusquALaPieceSuivante(jeu) {
  let n = 0;
  while (jeu.step !== E.ETAPE.JEU && n++ < 5000 && !jeu.termine) jeu.update(1);
}

test('le Météore marche À CHAQUE lancer, pas seulement le premier de la partie', () => {
  const { jeu, f } = partieAuMeteore();
  const s = f.sortList[0];
  assert.strictEqual(s.nom(), 'Météore');
  const lances = [];
  let eclats = 0;
  jeu.onEvent = (nom, d) => {
    if (nom === 'sort') lances.push(d.nom);
    if (nom === 'eclats') eclats++;
  };
  jusquALaPieceSuivante(jeu);

  for (let tour = 1; tour <= 4; tour++) {
    poserPierres(jeu);
    f.poserMana(16);
    // Le joueur appelle sa fée pendant le tour ; elle choisit à la fin.
    assert.ok(jeu.appelerAide(), 'tour ' + tour + ' : la fée répond');
    poserLaPiece(jeu);
    jusquALaPieceSuivante(jeu);
    assert.strictEqual(lances.length, tour, 'tour ' + tour + ' : le sort est parti');
    assert.strictEqual(f.mana, 10, 'tour ' + tour + ' : six de mana dépensés');
    // La pièce qui arrive est la pièce de feu : le sort doit l'attendre…
    assert.ok(jeu.sList.includes(s), 'tour ' + tour + ' : le Météore attend la pièce suivante'
      + ' (avant le correctif : dissipé avant même son lancer, dès le deuxième)');
    // … et elle brûle ce qu'elle touche.
    poserPierres(jeu);
    eclats = 0;
    poserLaPiece(jeu);
    assert.ok(eclats > 0, 'tour ' + tour + ' : la pièce de feu a brûlé quelque chose');
    jusquALaPieceSuivante(jeu);
    // Une fois la pièce de feu posée, le sort s'est retiré pour de bon : il
    // n'est plus le « sort en cours » de la fée (sans quoi le lancer suivant
    // l'interromprait lui-même, sitôt la mana prise).
    assert.ok(!jeu.sList.includes(s), 'tour ' + tour + ' : le sort a fini');
    assert.notStrictEqual(f.sortEnCours, s, 'tour ' + tour + ' : la fée n\'a plus de sort en cours');
  }
});

test('ranger le Météore efface la trace du lancer précédent', () => {
  // Le cœur de la panne, à nu : un `flUsed` resté vrai faisait dissiper le
  // sort à la première image de l'étape MAGIE, avant son lancer.
  const { jeu, f } = partieAuMeteore();
  const s = f.sortList[0];
  jusquALaPieceSuivante(jeu);
  s.flUsed = true;                    // ce que laisse un premier lancer réussi
  s.ranger();
  jeu.initStep(E.ETAPE.MAGIE);
  jeu.update(1);
  assert.ok(s.flLance, 'lancé');
  assert.ok(jeu.sList.includes(s), 'et toujours là pour la pièce suivante');
});

// ── 3 · La pause pendant l'envol de fin de niveau ─────────────────────────

test('pause pendant l\'envol de fin de niveau : le niveau suivant attend la reprise', () => {
  const { c, fenetre } = client();
  // Le dessin de la scène n'a rien à faire ici (pas de vrai canevas) ; le
  // reste de l'image — majTransition compris — tourne pour de bon.
  c.dessinerScene = () => {};
  c.dessinerPause = () => {};
  let boucle = null;
  const avant = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (fn) => { boucle = fn; return 1; };
  try {
    // Un niveau de forêt, gagné : la page lance l'envol, puis le suivant.
    c.nouvellePartie({ niveau: 0, graine: 3 });
    const fini = c.jeu;
    fini.finPartie(true);
    let suivants = 0;
    c.commencerEnvol(() => { suivants++; c.nouvellePartie({ niveau: 1, graine: 4 }); });
    c.demarrer();
    let t = 1000;
    const image = () => { boucle(t); t += 16; };
    image(); image();

    fenetre.emettre('keydown', touche('p', 80));
    fenetre.emettre('keyup', touche('p', 80));
    assert.strictEqual(c.pause, true, 'P pendant l\'envol : pause');
    // Dix secondes de pause : bien plus que les 110 images de l'envol.
    for (let i = 0; i < 600; i++) image();
    assert.strictEqual(suivants, 0, 'le niveau suivant attend');
    assert.strictEqual(c.pause, true, 'la pause tient');
    assert.strictEqual(c.jeu, fini, 'toujours le niveau fini à l\'écran');
    assert.ok(c.transition, 'l\'envol est suspendu, pas abandonné');

    fenetre.emettre('keydown', touche('p', 80));
    fenetre.emettre('keyup', touche('p', 80));
    assert.strictEqual(c.pause, false, 'P reprend');
    for (let i = 0; i < 300 && !suivants; i++) image();
    assert.strictEqual(suivants, 1, 'l\'envol s\'achève une fois la pause levée');
    assert.notStrictEqual(c.jeu, fini, 'et le niveau suivant s\'ouvre');
    assert.strictEqual(c.transition, null);
  } finally {
    globalThis.requestAnimationFrame = avant;
  }
});

test('sans pause, l\'envol enchaîne toujours seul sur le niveau suivant', () => {
  const { c } = client();
  c.nouvellePartie({ niveau: 0, graine: 3 });
  c.jeu.finPartie(true);
  let suivants = 0;
  c.commencerEnvol(() => { suivants++; });
  // Aventure.update, étape 2 : sans fée, au bout de vingt images.
  for (let i = 0; i < 25; i++) c.majTransition(1);
  assert.strictEqual(suivants, 1);
});
