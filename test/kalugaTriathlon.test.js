'use strict';
/*
 * KALUGA — LE TRIATHLON QUI GELAIT À LA FIN DE LA PREMIÈRE ÉPREUVE
 *
 * « Le triathlon Kaluga ne marche pas chez moi en version light : je plante le
 * ver et ça gèle à ce moment-là. »
 *
 * Le ver, c'est la première épreuve — `CaterLaunch`, « Attraper le ver ». Elle
 * se terminait sur une EXCEPTION, relevée au navigateur :
 *
 *     [kaluga] script TypeError: (intermediate value).updateResult is not a function
 *         at CaterLaunch.resultatIA   (modes.js)
 *         at CaterLaunch.updateResult (modes.js)
 *         at CaterLaunch.updateTournament
 *
 * La chaîne : `initEndGame` appelle `updateTournament`, qui calcule pour chaque
 * adversaire le résultat simulé (`updateResult` → `resultatIA`). Et `resultatIA`
 * finissait par `super.updateResult(player)`.
 *
 * Or `super`, dans `Trial`, désigne `J.Game` — où `updateResult` n'a jamais
 * existé. L'exception laissait le tableau des résultats à moitié rempli,
 * `eventId` jamais incrémenté et LE PANNEAU DE FIN JAMAIS POSÉ : la partie
 * s'arrêtait là, tzongre immobile et rien qui réponde. C'est le gel.
 *
 * Pourquoi l'auteur avait écrit `super` : chaque épreuve REMPLACE `updateResult`
 * (chacune a sa table d'adversaires) et passe par `resultatIA` ; revenir au
 * calcul commun par `this.updateResult` serait une récursion sans fin. Il
 * fallait un point d'appui — c'est `poserResultat`.
 *
 * Relevé au navigateur après correction (scratchpad/kaluga-tria2.js) :
 *   avant  — `CaterLaunch`, masterStep 1, waitList intacte, rien ne répond ;
 *   après  — masterStep 2 (le panneau de fin), puis `SquirrelLaunch` se lance
 *            et la waitList tombe à `['gamePlant']`.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const lire = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const MODES = lire('public/kaluga/jeu/modes.js');
const GAME = lire('public/kaluga/jeu/game.js');
const MENU = lire('public/kaluga/jeu/menu.js');

const TRIAL = /class Trial extends J\.Game \{[\s\S]*?\nJ\.Trial = Trial;/.exec(MODES);

test('la cause : `Game` n’a pas de `updateResult`, et `super` y menait', () => {
  assert.ok(TRIAL, 'la classe Trial doit exister');
  // Le parent de `Trial`. S'il portait un `updateResult`, `super` aurait eu un
  // sens — ce test tombera le jour où quelqu'un lui en donnera un, et il faudra
  // alors relire le chemin plutôt que garder les deux.
  assert.ok(!/^\s{2}updateResult\s*\(/m.test(GAME),
    'J.Game ne définit pas updateResult : c’est pourquoi `super.updateResult` jetait');
  // En début d'instruction — le commentaire qui raconte l'histoire, lui, a le
  // droit de le nommer.
  assert.ok(!/^\s*super\.updateResult\(/m.test(MODES),
    'plus aucun appel à super.updateResult');
});

test('le calcul commun a son point d’appui, hors de la chaîne des surcharges', () => {
  assert.match(TRIAL[0], /poserResultat\(player\) \{\s*\n\s*const results = player\.results\[this\.tournament\.eventId\];\s*\n\s*results\.base = Math\.round\(results\.base \* 10\) \/ 10;\s*\n\s*results\.score = results\.base \* results\.coef;\s*\n\s*\}/);
  // La surcharge par défaut n'est plus que la porte d'entrée.
  assert.match(TRIAL[0], /updateResult\(player\) \{ this\.poserResultat\(player\); \}/);
  // Et la simulation d'un adversaire revient par LÀ, pas par une surcharge.
  assert.match(TRIAL[0], /player\.results\[this\.tournament\.eventId\]\.base = score;\s*\n\s*this\.poserResultat\(player\);/);
});

test('la récursion que `poserResultat` évite est bien réelle', () => {
  /*
   * Chaque épreuve remplace `updateResult` par un appel à `resultatIA`. Si
   * `resultatIA` rappelait `this.updateResult`, il retomberait sur la surcharge
   * de l'épreuve — et tournerait en rond. Le test le prouve en comptant : les
   * SEPT épreuves du triathlon et de l'heptathlon délèguent toutes ainsi.
   */
  const surcharges = MODES.match(/^\s{2}updateResult\(player\) \{ this\.resultatIA\(/gm) || [];
  assert.strictEqual(surcharges.length, 7, 'sept épreuves, sept tables d’adversaires');
  assert.ok(!/resultatIA[\s\S]{0,400}this\.updateResult\(/.test(MODES),
    'resultatIA ne doit jamais rappeler updateResult');
});

test('le triathlon enchaîne bien trois épreuves, dans cet ordre', () => {
  const bloc = MENU.slice(MENU.indexOf('launchTournament(mode) {'),
    MENU.indexOf('launchAnim(link, initObj)'));
  assert.match(bloc, /if \(mode === 'triathlon'\) \{ max = 3; difCoef = 0\.8; \}/);
  // La première part tout de suite, les deux autres attendent leur tour.
  assert.match(bloc, /this\.mng\.waitList\.push\(\{ link: 'gameSquirrelLaunch', initObj \}\);/);
  assert.match(bloc, /this\.mng\.waitList\.push\(\{ link: 'gamePlant', initObj \}\);/);
  assert.match(bloc, /this\.launchGame\('gameCaterLaunch', initObj\);/);
  // Et c'est `initEndGame` — donc `updateTournament` — qui fait passer d'une
  // épreuve à la suivante : le chemin que l'exception coupait.
  assert.match(TRIAL[0], /this\.updateTournament\(\);\s*\n\s*this\.tournament\.eventId\+\+;/);
});
