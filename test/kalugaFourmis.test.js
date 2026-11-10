/*
 * KALUGA — LE LANCER DE FOURMIS (et l'heptathlon, qui le contient) finit.
 *
 * Remonté : « Impossible de faire le mode Lancer de fourmis et Heptathlon.
 * Les fourmis tombent mais le jeu continue… sans fin. »
 *
 * AntLaunch.landing marque chaque atterrissage d'une fourmi immobile posée en
 * DÉCOR (`newDecor('spBadsAnt')`). Le décor l'attache avec la liaison du
 * sprite, donc avec la classe Ant — mais sans partie. Le constructeur d'Ant
 * lisait `this.game.map` : erreur à chaque image, la première fourmi comptée,
 * plus rien ensuite. Une fourmi sans partie est une image, rien de plus.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
globalThis.window = undefined;
for (const f of ['moteur/formes.js', 'moteur/flash.js', 'moteur/texte.js', 'jeu/base.js', 'jeu/sprites.js',
  'jeu/game.js', 'jeu/modes.js', 'jeu/menu.js', 'plateforme.js', 'jeu/manager.js']) {
  require(path.join(ROOT, 'public/kaluga', f));
}
const K = globalThis.KalugaMoteur;
const J = globalThis.KalugaJeu;

test('la fourmi posée en décor (sans partie) se construit sans erreur, et reste inerte', () => {
  assert.equal(K.classes.spBadsAnt, J.Ant, 'le décor « spBadsAnt » prend bien la classe Ant');
  const decor = Object.create(J.Ant.prototype);
  // Ce que newDecor passe à attachMovie : aucun `game`.
  Object.assign(decor, { x: 1642, y: 450, depthCoef: 1, xscale: 100, yscale: 100, width: 0, corner: 0, visible: false, link: 'spBadsAnt' });
  assert.doesNotThrow(() => decor.constructeur());
  assert.equal(decor.speed, undefined, 'pas de vie de fourmi : ni vitesse, ni listes');
});

test('le lancer de fourmis pose bien ses fourmis en décor à l’atterrissage', () => {
  const MODES = fs.readFileSync(path.join(ROOT, 'public/kaluga/jeu/modes.js'), 'utf8');
  const landing = /class AntLaunch[\s\S]*?\n  landing\(ant\) \{([\s\S]*?)\n  \}/.exec(MODES);
  assert.ok(landing, 'AntLaunch.landing');
  assert.match(landing[1], /newDecor\('spBadsAnt'/);
  assert.match(landing[1], /ant\.kill\(\)/);
});
