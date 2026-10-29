'use strict';
/*
 * BURNING KIWI — deux retours de joueurs :
 *
 *   · la fenêtre passe derrière (le chat à côté, un autre onglet, une autre
 *     fenêtre) : la course se met en pause, par le drapeau `forcePause` du
 *     GameClient que le jeu sonde déjà, et c'est le joueur qui la relance ;
 *   · au doigt, on peut choisir de poser le doigt DERRIÈRE la voiture (elle
 *     file à l'opposé, la route devant reste visible) plutôt que devant.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const lire = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('la fenêtre passe derrière : forcePause est levé, et abaissé au retour', () => {
  const page = lire('public/bkiwi/index.html');
  assert.match(page, /const passerDerriere = function \(\) \{ lacherTout\(\); forcerPause\(true\); \};/);
  assert.match(page, /window\.addEventListener\('blur', passerDerriere\);/);
  assert.match(page, /window\.addEventListener\('focus', function \(\) \{ forcerPause\(false\); \}\);/);
  assert.match(page, /if \(document\.hidden\) passerDerriere\(\);\s*\n\s*else if \(document\.hasFocus\(\)\) forcerPause\(false\);/);
  // Le jeu, lui, fait le reste : en course, forcePause ouvre la pause (sa
  // boîte, comme à la touche P), P et échap ne la referment pas tant qu'il
  // tient, et en ligne togglePause refuse.
  const M = lire('public/bkiwi/jeu/moteur.js');
  assert.match(M, /if \(!M\.gamePaused && client\(\)\.forcePause == true\) J\.togglePause\(\);/);
  assert.match(M, /if \(!M\.lockPause && Key\.isDown\(80\) && !M\.starting && !M\.waitingGiveUp && !client\(\)\.forcePause\) \{/);
  assert.match(M, /if \(M\.MULTI !== undefined && M\.vs\.gameMode == M\.MULTI && M\.vs\.mainPhase == 1\) return;/);
});

test('au doigt, le sens se choisit : devant ou derrière la voiture', () => {
  const page = lire('public/bkiwi/index.html');
  assert.match(page, /<div id="b-sens" role="button" aria-label="Changer le sens du doigt">Doigt devant<\/div>/);
  assert.match(page, /@media \(pointer: coarse\) \{ #b-sens \{ display: flex; \} \}/, 'la pastille ne sert qu’au toucher');
  assert.match(page, /sensDerriere = localStorage\.getItem\('bkiwi-sens'\) === 'derriere';/, 'le choix se garde sur l’appareil');

  // Le cap visé : vers le doigt (devant), ou du doigt vers la voiture (derrière).
  const ligne = /const dx = \(doigt\.x - cx\) \* \(sensDerriere \? -1 : 1\), dy = \(doigt\.y - cy\) \* \(sensDerriere \? -1 : 1\);/;
  assert.match(page, ligne);
  const cap = (sensDerriere, doigt, cx, cy) => {
    const dx = (doigt.x - cx) * (sensDerriere ? -1 : 1), dy = (doigt.y - cy) * (sensDerriere ? -1 : 1);
    return Math.atan2(dy, dx) * 180 / Math.PI;
  };
  // Voiture en (175, 175), doigt posé 60 px en dessous.
  assert.strictEqual(cap(false, { x: 175, y: 235 }, 175, 175), 90, 'devant : on va vers le bas, vers le doigt');
  assert.strictEqual(cap(true, { x: 175, y: 235 }, 175, 175), -90, 'derrière : on file vers le haut, à l’opposé');
  // Le mode d'emploi suit le sens choisi.
  assert.match(page, /derriere: '<b>Pose le doigt derrière la voiture<\/b>/);
});
