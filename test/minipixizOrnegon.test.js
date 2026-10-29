'use strict';
/*
 * CHEZ ORNEGON — les barres des sorts préférés.
 *
 *   · le bouton de sortie s'en tient à sa croix : régler la dernière barre,
 *     tout en bas, ramenait à la clairière (le coin entier, 50 px, faisait
 *     sortir — et passait avant les barres) ;
 *   · les barres sont de vrais curseurs : appuyer y porte le curseur, il suit
 *     le doigt, et le goût ($spellCoef) suit le curseur.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const E = require('../public/minipixiz/engine.js');
const C = require('../public/minipixiz/combat.js');

// Le client est un script de navigateur : on le charge dans une fonction dont
// les paramètres masquent les globales (comme minipixizRetours.test.js).
function chargerClient() {
  const src = fs.readFileSync(path.join(ROOT, 'public/minipixiz/game.js'), 'utf8');
  const fenetre = { MinipixizLangue: require('../public/minipixiz/langue.js'), MinipixizEngine: E, MinipixizCombat: C };
  new Function('window', 'document', 'navigator', 'Image', src)(
    fenetre,
    { createElement: () => ({ getContext: () => ({}), width: 0, height: 0 }) },
    { userAgent: '' }, function () {});
  return fenetre.MinipixizClient;
}

// Un client nu, l'écran d'Ornegon ouvert sur une fée qui sait vingt sorts —
// les barres descendent alors jusqu'au coin. On « dessine » une fois pour que
// les zones des barres soient posées.
function ornegonOuvert() {
  const K = chargerClient();
  const c = Object.create(K.Client.prototype);
  c.sprites = {};
  c.pointeur = null;
  let fermetures = 0;
  c.ouvrirOrnegon({ fee: { fs: { $name: 'Lili', $spellCoef: [] }, sorts: [...Array(20).keys()] }, surFermer: () => { fermetures++; } });
  const ctx = { measureText: (t) => ({ width: String(t).length * 5 }), fillText() {}, fillRect() {} };
  c.dessinerOrnegon(ctx);
  return { c, fermetures: () => fermetures };
}

test('régler la dernière barre ne ramène plus à la clairière', () => {
  const { c, fermetures } = ornegonOuvert();
  const or = c.ornegon;
  const der = or.zones[or.zones.length - 1];
  assert.ok(der.y + der.h > 240 - 50, 'la dernière barre descend dans l’ancien coin de sortie : ' + (der.y + der.h));
  // Un clic sur la dernière barre, côté droit, dans l'ancien carré de 50 px.
  c.clicOrnegon(225, der.y + der.h - 2);
  assert.strictEqual(fermetures(), 0, 'on reste chez Ornegon');
  assert.ok(c.ornegon, 'l’écran est toujours ouvert');
  assert.strictEqual(or.positions[der.sid], 80, 'et le curseur a avancé de cinq pixels');
  // Juste sous la dernière barre, à côté de la croix : rien ne se passe.
  c.clicOrnegon(205, 236);
  assert.strictEqual(fermetures(), 0, 'à côté de la croix, on ne sort pas');
  // La croix, elle, fait sortir.
  c.clicOrnegon(233, 234);
  assert.strictEqual(fermetures(), 1, 'la croix ramène à la clairière');
  assert.strictEqual(c.ornegon, null);
});

test('les barres se glissent : le curseur suit le doigt, le goût suit le curseur', () => {
  const { c } = ornegonOuvert();
  const or = c.ornegon;
  const z = or.zones[3];
  const y = z.y + z.h / 2;
  // Appui au milieu de la barre : le curseur y vient.
  assert.strictEqual(c.saisirBarreOrnegon(99 + 100, y, 7), true);
  assert.strictEqual(or.positions[z.sid], 100);
  assert.strictEqual(or.survole, z.sid, 'le nom du sort s’affiche pendant le réglage');
  // Il suit le doigt, borné à la barre (17…133) comme Frog.clickBar.
  c.glisserBarreOrnegon(99 + 500);
  assert.strictEqual(or.positions[z.sid], 133);
  assert.strictEqual(or.fee.fs.$spellCoef[z.sid], 20, 'tout à droite : à fond');
  c.glisserBarreOrnegon(99 - 500);
  assert.strictEqual(or.positions[z.sid], 17);
  assert.strictEqual(or.fee.fs.$spellCoef[z.sid], 0, 'tout à gauche : jamais lancé');
  c.glisserBarreOrnegon(99 + 75);
  assert.strictEqual(or.fee.fs.$spellCoef[z.sid], 10, 'au centre : neutre');
  // Hors des barres, l'appui ne saisit rien (la croix garde son clic).
  assert.strictEqual(c.saisirBarreOrnegon(233, 236, 8), false);

  // Le câblage : pointerdown saisit, pointermove glisse, et le clic qui suit
  // le lâcher est avalé (il pousserait encore de cinq pixels).
  const src = fs.readFileSync(path.join(ROOT, 'public/minipixiz/game.js'), 'utf8');
  assert.match(src, /addEventListener\('pointerdown', \(ev\) => \{\s*if \(!this\.ornegon\) return;/);
  assert.match(src, /this\.glisserBarreOrnegon\(this\.pointeur\.x\);/);
  assert.match(src, /if \(or\.avalerClic\) \{ or\.avalerClic = false; return; \}/);
});
