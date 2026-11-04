'use strict';
/*
 * MINIPIXIZ — LA PAUSE QUAND LA FENÊTRE PASSE DERRIÈRE.
 *
 *   · la fenêtre perd le focus (`blur`) ou la page se cache
 *     (`visibilitychange`) en pleine partie : la pause de P se pose, panneau
 *     compris, et ne se lève qu'à P / Échap — pas toute seule au retour ;
 *   · les touches tenues sont lâchées (leur keyup part dans l'autre fenêtre) ;
 *   · les écrans qui attendent déjà le joueur (fin de partie, panneau
 *     d'expérience, Ornegon, Gromelin, carte de la forêt, envol de fin de
 *     niveau, cinématique) ne sont pas touchés.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const E = require('../public/minipixiz/engine.js');
const C = require('../public/minipixiz/combat.js');

// Une page factice qui RETIENT ses écouteurs, pour pouvoir les déclencher.
function bus() {
  const ecoutes = {};
  return {
    ecoutes,
    addEventListener(n, f) { (ecoutes[n] = ecoutes[n] || []).push(f); },
    emettre(n, ev) { (ecoutes[n] || []).forEach((f) => f(ev || { preventDefault() {} })); },
  };
}

// Le client est un script de navigateur : on le charge dans une fonction dont
// les paramètres masquent les globales (comme minipixizOrnegon.test.js), et on
// le CONSTRUIT pour de bon, sur un canevas et une page factices.
function client() {
  const src = fs.readFileSync(path.join(ROOT, 'public/minipixiz/game.js'), 'utf8');
  const fenetre = Object.assign(bus(), {
    MinipixizLangue: require('../public/minipixiz/langue.js'), MinipixizEngine: E, MinipixizCombat: C,
    devicePixelRatio: 1,
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
  return { c, fenetre, doc };
}
const touche = (key, keyCode) => ({ key, keyCode, preventDefault() {} });

test('en pleine partie, la fenêtre perd le focus : pause, et touches lâchées', () => {
  const { c, fenetre } = client();
  c.jeu = { termine: false };
  fenetre.emettre('keydown', touche('ArrowLeft', 37));
  fenetre.emettre('keydown', touche('ArrowDown', 40));
  assert.strictEqual(c.entree.gauche, true);
  fenetre.emettre('blur');
  assert.strictEqual(c.pause, true, 'la pause de P est posée');
  assert.strictEqual(c.pauseAlpha, -90, 'le voile violet monte comme pour P');
  assert.strictEqual(c.entree.gauche, false, 'la flèche tenue est lâchée');
  assert.strictEqual(c.entree.bas, false);
  // Le retour ne reprend pas : ni le focus, ni un second départ.
  fenetre.emettre('focus');
  fenetre.emettre('blur');
  assert.strictEqual(c.pause, true, 'toujours en pause');
  // P la lève, comme une pause prise à la main.
  fenetre.emettre('keydown', touche('p', 80));
  assert.strictEqual(c.pause, false, 'P reprend la partie');
});

test('la page se cache : même pause ; elle réapparaît : rien ne reprend', () => {
  const { c, doc } = client();
  c.bassin = {};
  c.jeu = { termine: false };
  doc.hidden = true;
  doc.emettre('visibilitychange');
  assert.strictEqual(c.pause, true);
  doc.hidden = false;
  doc.emettre('visibilitychange');
  assert.strictEqual(c.pause, true, 'pas de reprise automatique');
});

test('hors partie, ou sur un écran qui attend déjà le joueur : pas de pause', () => {
  const { c, fenetre } = client();
  fenetre.emettre('blur');
  assert.ok(!c.pause, 'aucune partie');
  const ecrans = {
    termine: () => { c.jeu = { termine: true }; },
    evolution: () => { c.jeu = { termine: false }; c.evolution = {}; },
    ornegon: () => { c.ornegon = {}; },
    gromelin: () => { c.gromelin = {}; },
    carteForet: () => { c.lieu = {}; c.carteForet = {}; },
    transition: () => { c.jeu = { termine: false }; c.transition = { phase: 'envol' }; },
    cine: () => { c.jeu = { termine: false }; c.cine = { phase: 1 }; },
    nouvelle: () => { c.jeu = { termine: false }; c.nouvelle = {}; },
  };
  for (const [nom, poser] of Object.entries(ecrans)) {
    for (const k of ['jeu', 'bassin', 'lieu', 'evolution', 'ornegon', 'gromelin', 'carteForet', 'transition', 'cine', 'nouvelle']) c[k] = null;
    poser();
    fenetre.emettre('keydown', touche('ArrowRight', 39));
    fenetre.emettre('blur');
    assert.ok(!c.pause, nom + ' : pas de pause');
    assert.strictEqual(c.entree.droite, false, nom + ' : la touche est lâchée quand même');
  }
});

test('le re-calcul de l’échelle au retour est intact', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/minipixiz/game.js'), 'utf8');
  assert.match(src, /document\.addEventListener\('visibilitychange', \(\) => \{ if \(!document\.hidden\) this\.redimensionner\(\); \}\);/);
  assert.match(src, /window\.addEventListener\('blur', \(\) => this\.pauseAuto\(\)\);/);
});

// ── Le bouton PAUSE, pour qui joue au doigt ───────────────────────────────
//
// « Pas de bouton Pause pour mettre ou retirer la pause sur mobile. » Le bouton
// de la page fait exactement ce que fait P (basculerPause), son libellé suit
// l'état quelle que soit la voie qui l'a changé, et toucher le plateau en
// pause la lève.
function bouton() {
  const attrs = {};
  const classes = new Set();
  return Object.assign(bus(), {
    textContent: '',
    setAttribute(k, v) { attrs[k] = String(v); },
    getAttribute(k) { return attrs[k]; },
    classList: { toggle(c, on) { if (on) classes.add(c); else classes.delete(c); }, contains: (c) => classes.has(c) },
  });
}
function clientAvecBouton() {
  const src = fs.readFileSync(path.join(ROOT, 'public/minipixiz/game.js'), 'utf8');
  const fenetre = Object.assign(bus(), {
    MinipixizLangue: require('../public/minipixiz/langue.js'), MinipixizEngine: E, MinipixizCombat: C,
    devicePixelRatio: 1,
  });
  const b = bouton();
  const doc = Object.assign(bus(), {
    hidden: false,
    body: { clientWidth: 0, clientHeight: 0 },
    createElement: () => ({ getContext: () => ({}), width: 0, height: 0 }),
    querySelectorAll: () => [],
    querySelector: (q) => (q === '[data-cmd-pause]' ? b : null),
  });
  new Function('window', 'document', 'navigator', 'Image', src)(fenetre, doc, { userAgent: '' }, function () {});
  const canevas = Object.assign(bus(), {
    getContext: () => ({}), parentElement: null, style: {},
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  });
  const c = new fenetre.MinipixizClient.Client({ canvas: canevas, sprites: {} });
  return { c, fenetre, doc, b, canevas };
}

test('le bouton pause bascule la pause comme P, et son libellé suit', () => {
  const { c, b, fenetre } = clientAvecBouton();
  assert.ok(b.classList.contains('inerte'), 'hors partie, il se retire');
  b.emettre('touchstart');
  assert.ok(!c.pause, 'et ne pose rien : il n\'y a rien à suspendre');
  c.lieu = {};
  c.majBoutonPause();
  assert.ok(!b.classList.contains('inerte'), 'en partie, il est actif');
  assert.match(b.textContent, /pause/);
  b.emettre('touchstart');
  assert.strictEqual(c.pause, true, 'un toucher : la pause');
  assert.strictEqual(c.pauseAlpha, -90, 'avec le même voile que P');
  assert.strictEqual(b.getAttribute('aria-pressed'), 'true');
  assert.match(b.textContent, /reprendre/);
  b.emettre('touchstart');
  assert.strictEqual(c.pause, false, 'un second : la reprise');
  assert.strictEqual(b.getAttribute('aria-pressed'), 'false');
  // À la souris aussi (petit écran sans tactile).
  b.emettre('mousedown');
  assert.strictEqual(c.pause, true);
  // P lève une pause prise au bouton, et le bouton suit à l'image suivante.
  fenetre.emettre('keydown', touche('p', 80));
  assert.strictEqual(c.pause, false);
  c.majBoutonPause();
  assert.strictEqual(b.getAttribute('aria-pressed'), 'false');
});

test('la pause automatique reste intacte, et le bouton la lève', () => {
  const { c, b, fenetre } = clientAvecBouton();
  c.jeu = { termine: false };
  fenetre.emettre('blur');
  assert.strictEqual(c.pause, true, 'la fenêtre passe derrière : pause');
  c.majBoutonPause();
  assert.strictEqual(b.getAttribute('aria-pressed'), 'true', 'le bouton l\'affiche');
  b.emettre('touchstart');
  assert.strictEqual(c.pause, false, 'le bouton la lève comme P');
});

test('en pause, toucher le plateau reprend la partie (sans pivoter la pièce)', () => {
  const { c, canevas } = clientAvecBouton();
  c.jeu = { termine: false, piece: null };
  c.basculerPause();
  let empeche = false;
  canevas.emettre('touchstart', {
    changedTouches: [{ identifier: 1, clientX: 50, clientY: 50 }], preventDefault() { empeche = true; },
  });
  assert.strictEqual(c.pause, false, 'la pause est levée');
  assert.ok(empeche, 'pas de clic synthétisé derrière');
  assert.strictEqual(c.doigt, null, 'ce toucher ne pilote pas la pièce');
  canevas.emettre('touchend', { changedTouches: [{ identifier: 1 }], type: 'touchend', preventDefault() {} });
  assert.ok(!c.pulseTourner, 'et ne la fait pas pivoter');
});

test('en pause, le moteur ne fait aucun pas : rien n\'entre au journal du rejeu', () => {
  // Le journal de l'Arbre creux (rejeu.js) enveloppe `lieu.update` : il n'y
  // note que des PAS. La pause — au clavier comme au doigt — n'en fait aucun.
  const { c, b } = clientAvecBouton();
  let pas = 0;
  c.lieu = { update() { pas++; } };
  c.dessiner = () => {};
  let boucle = null;
  const avant = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (f) => { boucle = f; return 1; };
  try {
    c.demarrer();
    boucle(1000); boucle(1016);
    assert.ok(pas > 0, 'la partie tourne');
    b.emettre('touchstart');
    const figes = pas;
    for (let t = 1032; t < 3000; t += 16) boucle(t);
    assert.strictEqual(pas, figes, 'aucun pas pendant la pause');
    b.emettre('touchstart');
    boucle(3016);
    assert.ok(pas > figes, 'et la partie repart');
  } finally {
    globalThis.requestAnimationFrame = avant;
  }
});

test('la page porte le bouton pause, montré là où la manette l\'est', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/minipixiz/index.html'), 'utf8');
  assert.match(html, /<button type="button" id="pause-but" data-cmd-pause aria-pressed="false"/);
  assert.match(html, /@media \(min-width: 700px\) and \(pointer: fine\) \{ #pause-but \{ display: none; \} \}/);
});
