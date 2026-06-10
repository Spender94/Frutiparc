// Test d'intégration headless du client Swapou 2 :
//   node public/swapou/client.test.js
// Charge engine+assets+ui+data+game+screens dans un contexte vm sans DOM
// (le dessin n'est jamais appelé) et pilote de vraies parties.
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
  Date: Date,
  Math: Math,
  JSON: JSON,
};
sandbox.self = sandbox;
sandbox.window = sandbox;
vm.createContext(sandbox);

['engine.js', 'assets.js', 'ui.js', 'data.js', 'game.js', 'screens.js'].forEach(function (f) {
  const code = fs.readFileSync(path.join(__dirname, f), 'utf8');
  vm.runInContext(code, sandbox, { filename: f });
});

const SW = sandbox.SW;
const E = sandbox.SwapouEngine;
const Manager = SW.Manager;

function pump(n, tmod) {
  tmod = tmod || 1;
  for (let i = 0; i < n; i++)
    Manager.main(tmod, tmod / 40);
}

// ── boot standalone (pas de sid → pas de réseau) ────────────────────────────
Manager.init('');
assert(Manager.mode != null, 'menu créé');
assert(Manager.client.connected, 'client standalone connecté');
assert(SW.Data.chars[0] === true && SW.Data.chars[1] === true, 'Dimitri et Natacha disponibles');

// ── menu : logo → menu principal → challenge ───────────────────────────────
pump(5);
SW.handleMouseMove(350, 240);
Manager.mode.onClickDown(); // clic sur le logo
pump(200, 2); // entrée du menu + boutons
const menu = Manager.mode;
assert(menu.phase === 10, 'phase menu principal');
assert(menu.btList.length === 2, 'deux boutons (jouer / options)');
assert(menu.btList[0].stable, 'boutons stabilisés');

// clic sur « jouer »
const btJouer = menu.btList[0];
SW.handleMouseMove(btJouer.curX, btJouer.curY);
menu.onClickDown();
pump(120, 2);
assert(menu.phase === 20, 'phase modes de jeu');
assert(menu.btList.length === 5, '5 boutons de modes');
assert(menu.btList[3].active === false, 'classique verrouillé sans $sucre');

// clic sur « challenge »
const btChal = menu.btList[0];
SW.handleMouseMove(btChal.curX, btChal.curY);
menu.onClickDown();
pump(120, 2);
assert(menu.phase === 30, 'phase choix du personnage');
// choisit Dimitri (face 0)
let face0 = null;
for (const bt of menu.btList) if (bt.faceId === 0) face0 = bt;
assert(face0 != null && face0.active, 'visage Dimitri actif');
SW.handleMouseMove(face0.curX, face0.curY);
menu.onClickDown();
pump(400, 2); // fermeture du menu + lancement
assert(Manager.mode !== menu, 'le menu est terminé');
assert(Manager.mode instanceof sandbox.SW.Challenge ||
  Manager.mode.constructor === SW.Challenge, 'mode Challenge lancé');
assert(SW.Data.players[0] === 0, 'perso 0 choisi');
assert(SW.Data.gameMode === SW.Data.CHALLENGE, 'gameMode challenge');

// ── challenge : jouer des coups réels ───────────────────────────────────────
const chal = Manager.mode;
const player = chal.player;
let fruitsCount = 0;
for (let x = 0; x < player.level.width; x++)
  for (let y = 0; y < player.level.height; y++)
    if (player.level.fruits[x][y] != null) fruitsCount++;
assert(fruitsCount === 3 * player.level.width, '3 lignes générées au départ');

// trouve un swap quelconque légal et le joue via un clic simulé
function findAnySwap(lvl) {
  for (let x = 0; x < lvl.width; x++)
    for (let y = 0; y < lvl.height; y++) {
      const f1 = lvl.getFruit(x, y);
      const f2 = lvl.getFruit(x + 1 < lvl.width ? x + 1 : x, y);
      if (x + 1 < lvl.width && f1 && f2 && f1.canSwap() && f2.canSwap())
        return { x: x, y: y, dx: 1, dy: 0 };
    }
  return null;
}

let turns = 0;
let guard = 0;
const startNswaps = Manager.client.nswaps;
while (turns < 12 && guard++ < 40000 && Manager.mode === chal) {
  if (!chal.lock) {
    const sw = findAnySwap(player.level);
    assert(sw != null, 'swap dispo (tour ' + turns + ')');
    // clic au centre-droit de la case (quadrant droite)
    const info = player.animator.getInfos();
    SW.handleMouseMove(info.px + sw.x * 35 + 30, info.py + sw.y * 35 + 17);
    chal.onClickDown();
    assert(chal.lock, 'le coup verrouille le tour');
    turns++;
  }
  pump(1, 1);
}
assert(turns === 12, '12 tours joués (guard=' + guard + ')');
assert(Manager.client.nswaps === startNswaps + 12, 'nswaps comptés');
assert(chal.ncoups === 5 + 12, 'ncoups suit les swaps');
// après 12 tours, 12 lignes sont montées : la pile a grandi
let count2 = 0;
for (let x = 0; x < player.level.width; x++)
  for (let y = 0; y < player.level.height; y++)
    if (player.level.fruits[x][y] != null) count2++;
assert(count2 > fruitsCount, 'des lignes sont montées (' + count2 + ' fruits)');

// ── fin de partie : remplit la colonne 0 puis joue un coup ─────────────────
while (player.level.addFruit(0, 0, 0) != null) { /* remplit */ }
// attend le déverrouillage puis force un tour sans combo : la ligne ne peut
// plus monter → game over
{
  let g2 = 0;
  while (Manager.mode === chal && g2++ < 30000) {
    if (!chal.lock) {
      // tour « à vide » : swap déclenché sur une paire sans combo possible :
      // on passe par skipTurn artificiel en simulant l'échéance d'un swap nul.
      const sw = findAnySwap(player.level);
      if (sw == null) break;
      const info = player.animator.getInfos();
      SW.handleMouseMove(info.px + sw.x * 35 + 30, info.py + sw.y * 35 + 17);
      chal.onClickDown();
    }
    pump(1, 1);
  }
}
assert(Manager.mode !== chal, 'GameOver atteint après saturation');
assert(Manager.mode.constructor === SW.GameOver, 'mode GameOver');
const goScore = player.score;
assert(typeof goScore === 'number' && goScore >= 0, 'score final ≥ 0 (' + goScore + ')');

// clic pour revenir au menu (après le délai de 2 s)
pump(120, 1);
Manager.mode.onClickDown();
assert(Manager.mode.constructor === SW.Menu, 'retour au menu après game over');

// ── duel : IA joue toute seule, le joueur laisse filer les tours ───────────
SW.Data.players = [0, 6]; // Dimitri vs Wasabiii (IA rapide : 20 it/s)
SW.Data.gameMode = SW.Data.DUEL;
SW.Data.difficulty = 4; // sauvage
Manager.mode.destroy();
Manager.mode = new SW.Duel();
const duel = Manager.mode;
assert(duel.player.level.width === 7, 'plateau duel 7 colonnes');
let iaSwapsSeen = 0;
let lastIaLock = duel.ia_lock;
{
  let g3 = 0;
  while (!duel.game_over_flag && g3++ < 20000) {
    pump(1, 1);
    if (lastIaLock === false && duel.ia_lock === true) iaSwapsSeen++;
    lastIaLock = duel.ia_lock;
    assert(duel.pool.length <= 40, 'pool borné');
  }
}
assert(iaSwapsSeen > 3, "l'IA a joué des coups (" + iaSwapsSeen + ')');
assert(duel.game_over_flag, 'le duel se termine (le joueur passif perd)');
assert(Manager.mode.constructor === SW.GameOver, 'écran de fin du duel');
assert(Manager.mode.win_flag === false, 'défaite du joueur passif');

// ── attaque / défense : effets appliqués ────────────────────────────────────
SW.Data.gameMode = SW.Data.DUEL;
SW.Data.players = [1, 2]; // Natacha (PETIT PEPIN : 1 ligne) vs Sel
SW.Data.difficulty = 0;
Manager.mode.destroy();
Manager.mode = new SW.Duel();
const duel2 = Manager.mode;
pump(10, 1);
duel2.player.star_counter = 6;
duel2.interf.pl[0].power = 6;
const poolBefore = duel2.pool.length;
duel2.attack(); // Natacha → attaque 2 = PETIT PEPIN : 1 ligne de 7 gelés
assert(duel2.pool.length === poolBefore + 7, 'PETIT PEPIN envoie 7 fruits gelés');
assert(duel2.pool[0].flags === E.FLAG_ARMURE, 'parasites gelés');
duel2.player.star_counter = 6;
const before00 = [];
for (let x = 0; x < 7; x++) before00.push(duel2.player.level.fruits[x][13]);
duel2.defend(); // Natacha → défense 2 = COUPURE (coupeur)
assert(duel2.player_special_combo === true, 'défense = tour spécial');
pump(600, 1); // anim + résolution
assert(!duel2.pl_lock || duel2.game_over_flag === true || duel2.player_special_combo === false,
  'la défense finit par rendre la main');

console.log('OK — ' + nassert + ' assertions (client headless)');
process.exit(0);
