/*
 * Swapou 2 — LA PAUSE QUAND LA FENÊTRE PASSE DERRIÈRE.
 *
 * Le joueur clique le chat d'à côté, change de fenêtre, cache l'onglet : la
 * partie en cours se met d'elle-même dans la pause d'Échap (plateaux masqués,
 * boîte « pause »), et n'en sort qu'au prochain Échap ou bouton — jamais
 * toute seule au retour. Les menus, la carte et l'écran de fin, eux, n'ont
 * rien à suspendre.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SWAPOU = path.join(__dirname, '..', 'public', 'swapou');

// Même montage que public/swapou/essai.test.js : le jeu entier, sans page.
function client() {
  const bac = {
    console, setTimeout, URLSearchParams, Date, Math, JSON, Promise,
    performance: { now: () => Date.now() },
    fetch: () => Promise.resolve({ text: () => Promise.resolve(''), json: () => Promise.resolve({}) }),
    navigator: { sendBeacon: () => true },
    Blob: function () {},
  };
  bac.self = bac;
  bac.window = bac;
  vm.createContext(bac);
  ['engine.js', 'assets.js', 'ui.js', 'data.js', 'game.js', 'screens.js'].forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(SWAPOU, f), 'utf8'), bac, { filename: f });
  });
  const SW = bac.SW;
  SW.Manager.init('');
  SW.Data.players[0] = 0;
  SW.Data.players[1] = 1;
  return SW;
}
const pomper = (SW, n) => { for (let i = 0; i < n; i++) SW.Manager.main(1, 1 / 40); };
// Un appui d'Échap complet, une image enfoncée, une relâchée.
function echap(SW) {
  SW.setEsc(true); pomper(SW, 1);
  SW.setEsc(false); pomper(SW, 1);
}

test('Challenge : la fenêtre passe derrière → la pause d’Échap, levée par Échap seulement', () => {
  const SW = client();
  SW.Data.gameMode = SW.Data.CHALLENGE;
  SW.Manager.started();
  const partie = SW.Manager.mode;
  assert.strictEqual(partie.constructor, SW.Challenge);
  pomper(SW, 5);
  assert.strictEqual(partie.pause.activated(), false);

  // L'Échap était peut-être tenu au moment de partir : il est oublié.
  SW.setEsc(true);
  assert.strictEqual(SW.pauseAuto(), true, 'la pause est posée');
  assert.strictEqual(SW.escDown, false, 'l’Échap tenu est relâché');
  assert.strictEqual(partie.pause.activated(), true);

  // Rien ne la lève tout seul : ni le temps, ni un second départ.
  pomper(SW, 50);
  assert.strictEqual(SW.pauseAuto(), false, 'déjà en pause : rien de plus');
  assert.strictEqual(partie.pause.activated(), true, 'toujours en pause');

  // Le joueur reprend comme d'une pause d'Échap : le premier appui suffit.
  echap(SW);
  assert.strictEqual(partie.pause.activated(), false, 'Échap reprend la partie');
});

test('Challenge : le bouton tactile lève aussi la pause automatique', () => {
  const SW = client();
  SW.Data.gameMode = SW.Data.CHALLENGE;
  SW.Manager.started();
  const partie = SW.Manager.mode;
  SW.pauseAuto();
  const r = SW.pauseBtnRect;
  SW.handleMouseDown(r.x + 5, r.y + 5);
  pomper(SW, 1);
  assert.strictEqual(partie.pause.activated(), false);
});

test('Duel contre l’IA : plateaux masqués, horloge du joueur figée', () => {
  const SW = client();
  SW.Data.gameMode = SW.Data.DUEL;
  SW.Manager.startDuel();
  const duel = SW.Manager.mode;
  assert.strictEqual(duel.constructor, SW.Duel);
  pomper(SW, 3);
  assert.ok(SW.pauseAuto());
  assert.strictEqual(duel.player.animator.fruitsVisible, false, 'le plateau du joueur est masqué');
  assert.strictEqual(duel.ia.animator.fruitsVisible, false, 'celui de l’IA aussi');
  const t = duel.player_timer;
  pomper(SW, 80);
  assert.strictEqual(duel.player_timer, t, 'le temps de réflexion ne file pas');
  echap(SW);
  assert.strictEqual(duel.pause.activated(), false);
  assert.strictEqual(duel.player.animator.fruitsVisible, true, 'les plateaux reviennent');
});

test('menus, carte de l’histoire, écran de fin : pas de pause', () => {
  const SW = client();
  SW.Manager.startMenu();
  assert.strictEqual(SW.pauseAuto(), false, 'menu');
  SW.Data.gameMode = SW.Data.HISTORY;
  SW.Manager.startHistoryMap();
  assert.strictEqual(SW.pauseAuto(), false, 'carte de l’histoire');
  SW.Data.gameMode = SW.Data.DUEL;
  SW.Manager.startDuel();
  const g = SW.Manager.gameOver(0);
  assert.strictEqual(SW.Manager.mode, g);
  assert.strictEqual(SW.pauseAuto(), false, 'écran de fin');
});

test('la page branche la pause sur blur et sur la page cachée', () => {
  const page = fs.readFileSync(path.join(SWAPOU, 'index.html'), 'utf8');
  assert.match(page, /window\.addEventListener\('blur', function \(\) \{ SW\.pauseAuto\(\); \}\);/);
  assert.match(page, /addEventListener\('visibilitychange', function \(\) \{\s*if \(document\.hidden\) SW\.pauseAuto\(\);/);
});
