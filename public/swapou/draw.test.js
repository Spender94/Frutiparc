// Test de fumée du RENDU Swapou 2 : node public/swapou/draw.test.js
// Un contexte 2D factice (toute méthode inconnue → TypeError) parcourt tous
// les écrans : coquilles et appels indéfinis dans les draw() sont détectés
// sans navigateur.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let nassert = 0;
function assert(cond, msg) {
  nassert++;
  if (!cond) {
    console.error('FAIL: ' + msg);
    process.exit(1);
  }
}

const sandbox = {
  console: console,
  setTimeout: setTimeout,
  URLSearchParams: URLSearchParams,
  performance: { now: function () { return Date.now(); } },
  Date: Date, Math: Math, JSON: JSON,
};
sandbox.self = sandbox;
sandbox.window = sandbox;
vm.createContext(sandbox);
['engine.js', 'assets.js', 'ui.js', 'data.js', 'game.js', 'screens.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), sandbox, { filename: f });
});

const SW = sandbox.SW;
const Manager = SW.Manager;

// images factices : tout est « chargé » (SwapouAssets est lexical dans le
// contexte vm ; on passe par la référence partagée SW.A)
const fakeImg = { naturalWidth: 38, naturalHeight: 38, complete: true };
SW.A.img = function () { return fakeImg; };
SW.A.fruitImage = function () { return fakeImg; };
SW.A.has = function () { return true; };

// contexte 2D factice : seules les méthodes réelles existent
function makeCtx() {
  const grad = { addColorStop: function () {} };
  let calls = 0;
  const ctx = {
    canvas: { width: 700, height: 480 },
    fillStyle: '#000', strokeStyle: '#000', globalAlpha: 1, lineWidth: 1,
    font: '', textAlign: 'left', textBaseline: 'alphabetic',
    shadowColor: '', shadowBlur: 0, lineJoin: 'miter', filter: 'none',
    save: function () { calls++; }, restore: function () { calls++; },
    translate: function () {}, scale: function () {}, rotate: function () {},
    beginPath: function () {}, closePath: function () {},
    moveTo: function () {}, lineTo: function () {}, arc: function () {},
    arcTo: function () {}, ellipse: function () {}, rect: function () {},
    fill: function () {}, stroke: function () {}, clip: function () {},
    fillRect: function () { calls++; }, strokeRect: function () {},
    clearRect: function () {},
    drawImage: function () { calls++; },
    fillText: function () { calls++; }, strokeText: function () {},
    measureText: function () { return { width: 10 }; },
    createLinearGradient: function () { return grad; },
    createRadialGradient: function () { return grad; },
    nCalls: function () { return calls; },
  };
  return ctx;
}

function pump(n, tmod) {
  tmod = tmod || 1;
  for (let i = 0; i < n; i++) Manager.main(tmod, tmod / 40);
}
function drawNow(label) {
  const ctx = makeCtx();
  Manager.draw(ctx);
  assert(ctx.nCalls() > 0, label + ' : du contenu est dessiné');
}

// ── menu : logo → principal → options → persos → versus ────────────────────
Manager.init('');
pump(3);
drawNow('logo');
SW.handleMouseMove(350, 240);
Manager.mode.onClickDown();
pump(200, 2);
drawNow('menu principal');
// options
Manager.mode.jump(11);
pump(80, 2);
SW.handleMouseMove(Manager.mode.btList[0].curX, Manager.mode.btList[0].curY);
pump(2, 1); // survol → aide affichée
drawNow('options + aide');
// sélection de personnage
Manager.mode.jump(30);
pump(120, 2);
drawNow('sélection des persos');
// versus
SW.Data.players = [0, 4];
Manager.mode.wins_flag = undefined;
Manager.mode.attachVersus();
drawNow('écran versus');
Manager.mode.versus = null;

// ── challenge en cours (chaînes, étoile de combo, scorePop) ────────────────
SW.Data.gameMode = SW.Data.CHALLENGE;
SW.Data.players = [1, -1];
Manager.mode.destroy();
Manager.mode = new SW.Challenge();
const chal = Manager.mode;
pump(5, 1);
drawNow('challenge au repos');
// force une explosion réelle : pose 3 fruits alignés puis swap résolu
{
  const lvl = chal.player.level;
  // joue plusieurs tours pour passer par toutes les phases d'anim
  let played = 0, guard = 0;
  while (played < 4 && guard++ < 20000) {
    if (!chal.lock) {
      outer:
      for (let x = 0; x < lvl.width - 1; x++)
        for (let y = 0; y < lvl.height; y++) {
          const f1 = lvl.getFruit(x, y), f2 = lvl.getFruit(x + 1, y);
          if (f1 && f2 && f1.canSwap() && f2.canSwap()) {
            const info = chal.player.animator.getInfos();
            SW.handleMouseMove(info.px + x * 35 + 30, info.py + y * 35 + 17);
            chal.onClickDown();
            played++;
            break outer;
          }
        }
    }
    pump(1, 1);
    if (guard % 7 === 0) drawNow('challenge anim frame');
  }
  assert(played === 4, '4 tours animés dessinés');
}
// étoile de pouvoir + défense
chal.player.star_counter = 6;
chal.interf.pl[0].power = 6;
chal.interf.updatePower(0);
drawNow('étoiles de pouvoir + max');
chal.interf.defend();
pump(30, 1);
drawNow('défense en cours');
// pause
chal.pause.want = true;
pump(2, 1);
assert(chal.pause.activated(), 'pause activée');
drawNow('pause');
chal.pause.want = true;
pump(2, 1);

// ── classique : bannière de niveau ──────────────────────────────────────────
SW.Data.gameMode = SW.Data.CLASSIC;
Manager.mode.destroy();
Manager.mode = new SW.Classic();
Manager.mode.ncoups = 99;
pump(6, 1);
drawNow('classique + bannière niveau');

// ── duel : pool, flèche, bannière d'attaque, visages ───────────────────────
SW.Data.gameMode = SW.Data.DUEL;
SW.Data.players = [0, 6];
SW.Data.difficulty = 2;
Manager.mode.destroy();
Manager.mode = new SW.Duel();
const duel = Manager.mode;
pump(20, 1);
duel.player.star_counter = 6;
duel.interf.pl[0].power = 6;
duel.attack(); // bannière + pool
pump(10, 1);
drawNow('duel : attaque + pool');
{
  let g = 0;
  while (!duel.game_over_flag && g++ < 3000) {
    pump(1, 1);
    if (g % 41 === 0) drawNow('duel frame');
  }
}
drawNow('duel : fin ou en cours');

// ── pot au feu : carte, dialogue, cinématique (y c. temple composite) ──────
SW.Data.gameMode = SW.Data.HISTORY;
SW.Data.histoPhase = 4; // phase avec CIN(5) = temple composite
SW.Data.players = [0, -1];
Manager.mode.destroy();
Manager.mode = new SW.HistoMap();
const map = Manager.mode;
pump(60, 2); // zoom
drawNow('carte histoire + dialogue');
{
  let g = 0, drew = 0;
  while (Manager.mode === map && g++ < 40000) {
    if (!map.lock) map.onClickDown();
    pump(2, 2);
    drawNow('histoire frame');
    drew++;
  }
  assert(drew > 10, 'cinématiques dessinées (' + drew + ' frames)');
}

// ── game over : 4 variantes ────────────────────────────────────────────────
const fakeMode = { main: function () {}, draw: function (c) { c.fillRect(0, 0, 1, 1); }, destroy: function () {} };
const go = new SW.GameOver(fakeMode);
go.setText('votre score : 1234\nvotre record personnel : 2345\n');
go.winTitem(3);
Manager.mode = go;
drawNow('game over : texte + titems');
go.connecting();
drawNow('game over : connexion');
go.wins(true);
drawNow('game over : gagné');
go.wins(false);
drawNow('game over : perdu');
go.unlockCharacter(2);
drawNow('game over : perso débloqué');

console.log('OK — ' + nassert + ' assertions (rendu)');
process.exit(0);
