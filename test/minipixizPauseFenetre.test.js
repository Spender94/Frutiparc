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
