//
// Tests de la logique de partie Frutibandas (draft, cartes, mouvements, fin).
// Lancer : node public/bandas/game.test.js
//
var E = require("./engine.js");
var G = require("./game.js");
var DIR = E.DIR, CARD = G.CARD;

var fails = 0, passed = 0;
function ok(cond, msg) { if (cond) { passed++; } else { fails++; console.log("  ✗ FAIL: " + msg); } }
function eq(a, b, msg) { ok(a === b, msg + " (got " + a + ", want " + b + ")"); }

function mk(rows) {
  var size = rows.length;
  var b = new E.Board(size);
  for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) {
    var ch = rows[y].charAt(x);
    var e = ch === "0" ? 0 : ch === "1" ? 1 : ch === "#" ? E.ROCK : ch === "X" ? E.DESTROYED : ch === "T" ? E.TRAPPED : E.FREE;
    b.setElementAt(y * size + x, e);
    if (e > E.FREE) b.teamCounters[e]++;
  }
  return b;
}
function game(rows, opts) {
  opts = opts || {};
  opts.board = mk(rows);
  if (opts.firstTeam === undefined) opts.firstTeam = 0;
  if (!opts.pool) opts.pool = [];
  return new G.BandasGame(opts);
}
function evTypes(res) { return res.events.map(function (e) { return e.type; }).join(","); }
function find(res, type) { return res.events.filter(function (e) { return e.type === type; }); }

// ── Draft : alternance, dernière prise → phase de mouvement ─────────────────
var g = new G.BandasGame({ board: mk(["01", ".."]), pool: [3, 7, 5, 9], firstTeam: 0 });
eq(g.phase, G.PHASE_CARD_SELECTION, "draft phase at start");
ok(!g.playCard(0, 3).ok, "cannot play a card during draft");
ok(!g.move(0, DIR.UP).ok, "cannot move during draft");
ok(!g.chooseCard(1, 7).ok, "draft: not your turn");
var r = g.chooseCard(0, 3);
ok(r.ok, "draft: team 0 picks");
eq(find(r, "cardChosen")[0].movePhase, false, "not the last pick");
eq(g.currentTeam, 1, "draft alternates");
ok(!g.chooseCard(1, 3).ok, "card no longer in pool");
g.chooseCard(1, 7);
g.chooseCard(0, 5);
r = g.chooseCard(1, 9);
eq(find(r, "cardChosen")[0].movePhase, true, "last pick flags move phase");
eq(g.phase, G.PHASE_MOVE, "move phase entered");
eq(g.currentTeam, 0, "team 0 moves first (alternation continues)");
eq(g.hands[0].join(","), "3,5", "team 0 hand");
eq(g.hands[1].join(","), "7,9", "team 1 hand");

// ── Mouvement de base + fin de tour ─────────────────────────────────────────
g = game(["0.1.", "....", "....", "...."]);
r = g.move(0, DIR.RIGHT);
ok(r.ok, "move accepted");
eq(evTypes(r), "move,turn", "move then turn events");
eq(g.currentTeam, 1, "turn passes");
ok(!g.move(0, DIR.RIGHT).ok, "not your turn anymore");

// ── Victoire : l'équipe adverse n'a plus de fruit ───────────────────────────
g = game(["01..", "....", "....", "...."]);
g.move(0, DIR.RIGHT); g.move(1, DIR.RIGHT); g.move(0, DIR.RIGHT);
// 0 pousse 1 vers le bord : à force, 1 sort
g.move(1, DIR.LEFT);    // 1 s'éloigne
var n = 0;
while (g.isRunning() && n++ < 20) {
  var t = g.currentTeam;
  g.move(t, t === 0 ? DIR.RIGHT : DIR.LEFT);
}
ok(!g.isRunning() || n >= 20, "game progresses");

// pousser sans chute : la partie continue
g = game(["...0", "...1", "....", "...."], { firstTeam: 0 });
r = g.move(0, DIR.DOWN);
eq(g.isRunning(), true, "pushing without a fall keeps the game running");
// cas frontal : à force de pousser, le dernier fruit adverse sort
g = game(["....", "....", "....", "0..1"], { firstTeam: 0 });
var guard = 0;
while (g.isRunning() && guard++ < 10) g.move(g.currentTeam, DIR.RIGHT);
eq(g.winner, 0, "team 0 wins by pushing team 1 off");
ok(!g.move(0, DIR.RIGHT).ok, "no move after end");

// ── Enclume : détruit la case (et le fruit) ─────────────────────────────────
g = game(["01..", "0...", "....", "...."], { pool: [], firstTeam: 0 });
g.hands[0] = [CARD.ENCLUME];
r = g.playCard(0, CARD.ENCLUME, 1, 0);
ok(r.ok, "enclume accepted");
eq(g.board.countSpritesOf(1), 0, "enclume kills the fruit");
eq(find(r, "end").length, 1, "enclume on last fruit ends the game");
eq(g.winner, 0, "team 0 wins by enclume");

// une seule carte par tour
g = game(["01..", "1...", "....", "...."], { firstTeam: 0 });
g.hands[0] = [CARD.CELERITE, CARD.CHARGE];
ok(g.playCard(0, CARD.CELERITE).ok, "first card ok");
eq(g.playCard(0, CARD.CHARGE).error, "one-card-per-turn", "second card rejected");

// ── Célérité : on rejoue après son mouvement ────────────────────────────────
g = game(["0.1.", "..1.", "....", "...."], { firstTeam: 0 });
g.hands[0] = [CARD.CELERITE];
g.playCard(0, CARD.CELERITE);
r = g.move(0, DIR.RIGHT);
eq(find(r, "turn")[0].team, 0, "celerite: same team plays again");
r = g.move(0, DIR.RIGHT);
eq(find(r, "turn")[0].team, 1, "celerite consumed");

// ── Charge : mouvement doublé (2 événements move) ───────────────────────────
g = game(["0...", "..1.", "..1.", "...."], { firstTeam: 0 });
g.hands[0] = [CARD.CHARGE];
g.playCard(0, CARD.CHARGE);
r = g.move(0, DIR.RIGHT);
eq(find(r, "move").length, 2, "charge doubles the move");
eq(g.board.getElement({ x: 2, y: 0 }), 0, "fruit advanced two steps");

// ── Entracte : la carte tient lieu de tour ──────────────────────────────────
g = game(["0.1.", "..1.", "....", "...."], { firstTeam: 0 });
g.hands[0] = [CARD.ENTRACTE];
r = g.playCard(0, CARD.ENTRACTE);
eq(find(r, "turn")[0].team, 1, "entracte passes the turn without moving");

// ── Solo : seul le fruit choisi bouge ───────────────────────────────────────
g = game(["0.0.", "..1.", "....", "...."], { firstTeam: 0 });
g.hands[0] = [CARD.SOLO];
eq(g.playCard(0, CARD.SOLO, 2, 1).error, "needs-own-sprite", "solo requires own fruit");
ok(g.playCard(0, CARD.SOLO, 0, 0).ok, "solo on own fruit");
g.move(0, DIR.DOWN);
eq(g.board.getElement({ x: 0, y: 1 }), 0, "solo fruit moved");
eq(g.board.getElement({ x: 2, y: 0 }), 0, "other fruit did NOT move");

// ── Pétrification : le fruit devient pierre ─────────────────────────────────
g = game(["01..", "1.0.", "....", "...."], { firstTeam: 0 });
g.hands[0] = [CARD.PETRIFICATION];
ok(!g.playCard(0, CARD.PETRIFICATION, 3, 3).ok, "petrify requires a fruit");
ok(g.playCard(0, CARD.PETRIFICATION, 1, 0).ok, "petrify opponent fruit");
eq(g.board.getElement({ x: 1, y: 0 }), E.ROCK, "fruit is now a rock");
eq(g.board.countSpritesOf(1), 1, "petrified fruit no longer counted");

// ── Conversion : le fruit change d'équipe ───────────────────────────────────
g = game(["01..", "1.0.", "....", "...."], { firstTeam: 0 });
g.hands[0] = [CARD.CONVERSION];
g.playCard(0, CARD.CONVERSION, 1, 0);
eq(g.board.getElement({ x: 1, y: 0 }), 0, "converted to team 0");
eq(g.board.countSpritesOf(0), 3, "counters updated (0)");
eq(g.board.countSpritesOf(1), 1, "counters updated (1)");

// conversion du dernier fruit adverse → victoire
g = game(["01..", "....", "....", "...."], { firstTeam: 0 });
g.hands[0] = [CARD.CONVERSION];
r = g.playCard(0, CARD.CONVERSION, 1, 0);
eq(g.winner, 0, "converting last opponent fruit wins");

// ── Vachette : nettoie la colonne, peut faire match nul ─────────────────────
g = game(["0.1.", "0...", "..1.", "...."], { firstTeam: 0 });
g.hands[0] = [CARD.VACHETTE];
r = g.playCard(0, CARD.VACHETTE, 2, 0);
ok(r.ok, "vachette accepted");
eq(g.board.countSpritesOf(1), 0, "column cleared of opponents");
eq(g.winner, 0, "vachette wins when opponent wiped");

g = game(["0...", "1...", "....", "...."], { firstTeam: 0 });
g.hands[0] = [CARD.VACHETTE];
r = g.playCard(0, CARD.VACHETTE, 0, 0);
eq(g.winner, G.END_DRAW, "vachette wiping both teams = draw (La Vachette)");

// ── Renfort : jusqu'à 3 fruits sur cases libres, coordonnées encodées ───────
function seeded(seed) { return function () { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }
g = game(["01..", "....", "....", "...."], { firstTeam: 0, rng: seeded(123) });
g.hands[0] = [CARD.RENFORT];
r = g.playCard(0, CARD.RENFORT);
eq(g.board.countSpritesOf(0), 4, "renfort adds 3 fruits");
var ev = find(r, "cardPlayed")[0];
ok(ev.x > 10000, "renfort coords packed like the original");
// décodage (Renfort.as) : 3 coordonnées valides, toutes à l'équipe 0
function unpack(xsum, ysum) {
  var out = [];
  if (xsum > 10000) { var x1 = Math.floor(xsum / 10000) - 1, y1 = Math.floor(ysum / 10000) - 1; xsum -= (x1 + 1) * 10000; ysum -= (y1 + 1) * 10000; out.push({ x: x1, y: y1 }); }
  if (xsum > 100) { var x2 = Math.floor(xsum / 100) - 1, y2 = Math.floor(ysum / 100) - 1; xsum -= (x2 + 1) * 100; ysum -= (y2 + 1) * 100; out.push({ x: x2, y: y2 }); }
  if (xsum > 0) out.push({ x: xsum - 1, y: ysum - 1 });
  return out;
}
var spots = unpack(ev.x, ev.y);
eq(spots.length, 3, "3 packed coordinates");
ok(spots.every(function (s) { return g.board.getElement(s) === 0; }), "all decoded spots hold team 0 fruits");

// renfort avec 1 seule case libre
g = game(["01", "1."], { firstTeam: 0 });
g.hands[0] = [CARD.RENFORT];
r = g.playCard(0, CARD.RENFORT);
eq(g.board.countSpritesOf(0), 2, "renfort limited by free slots");
spots = unpack(find(r, "cardPlayed")[0].x, find(r, "cardPlayed")[0].y);
eq(spots.length, 1, "single packed coordinate");

// ── Piège : caché à la pose, révélé quand il tue ────────────────────────────
g = game(["0.1.", "....", "....", "...."], { firstTeam: 1 });
g.hands[1] = [CARD.PIEGE];
eq(g.playCard(1, CARD.PIEGE, 0, 0).error, "needs-free-slot", "trap needs a free slot");
r = g.playCard(1, CARD.PIEGE, 1, 0);
ok(r.ok, "trap set");
eq(find(r, "cardPlayed")[0].to, 1, "trap play visible only to its owner");
eq(find(r, "cardPlayed")[0].hidden, true, "trap play flagged hidden");
g.move(1, DIR.DOWN);
r = g.move(0, DIR.RIGHT);          // le fruit 0 marche sur le piège
eq(g.board.countSpritesOf(0), 0, "fruit killed by trap");
var reveal = find(r, "cardPlayed");
eq(reveal.length, 1, "trap revealed");
eq(reveal[0].card, CARD.PIEGE, "reveal is the trap card");
eq(reveal[0].to, "all", "reveal broadcast to everyone");
eq(g.winner, 1, "trap killed the last fruit → team 1 wins");

// ── Désordre : le prochain mouvement adverse est inversé ────────────────────
g = game(["......", ".0..0.", "......", "..1...", "......", "......"], { firstTeam: 0 });
g.hands[0] = [CARD.DESORDRE];
r = g.playCard(0, CARD.DESORDRE);
eq(find(r, "cardPlayed")[0].to, 0, "desordre hidden from opponent");
g.move(0, DIR.UP);
r = g.move(1, DIR.LEFT);           // sera inversé → droite
eq(g.board.getElement({ x: 3, y: 3 }), 1, "opponent move inverted");
eq(find(r, "cardPlayed")[0].card, CARD.DESORDRE, "desordre revealed before the move");
eq(find(r, "cardPlayed")[0].to, "all", "desordre reveal broadcast");
eq(evTypes(r).indexOf("cardPlayed"), 0, "reveal comes first");

// ── Confiscation : la carte adverse du tour suivant est volée ───────────────
g = game(["0...1.", "0...1.", "0...1.", "0...1.", "......", "......"], { firstTeam: 0 });
g.hands[0] = [CARD.CONFISCATION];
g.hands[1] = [CARD.CELERITE];
r = g.playCard(0, CARD.CONFISCATION);
eq(find(r, "cardPlayed")[0].to, 0, "confiscation hidden");
g.move(0, DIR.RIGHT);
r = g.playCard(1, CARD.CELERITE);
ok(r.ok, "opponent card play handled");
var conf = find(r, "cardPlayed")[0];
eq(conf.card, CARD.CONFISCATION, "confiscation revealed");
eq(conf.p, CARD.CELERITE, "stolen card id carried as parameter");
eq(g.hands[1].length, 0, "victim hand emptied");
eq(g.hands[0].indexOf(CARD.CELERITE) >= 0, true, "thief got the card");
ok(!g.celerite[1], "stolen card effect cancelled");
r = g.move(1, DIR.LEFT);
eq(find(r, "turn")[0].team, 0, "victim still moves, then turn passes");
// la fenêtre est passée : une carte jouée plus tard n'est plus confisquée
g.hands[0] = [CARD.CHARGE];
r = g.playCard(0, CARD.CHARGE);
eq(find(r, "cardPlayed")[0].card, CARD.CHARGE, "confiscation window expired");

// fenêtre expirée si l'adversaire ne joue PAS de carte à son tour suivant
g = game(["0...1.", "0...1.", "0...1.", "0...1.", "......", "......"], { firstTeam: 0 });
g.hands[0] = [CARD.CONFISCATION];
g.hands[1] = [CARD.CHARGE];
g.playCard(0, CARD.CONFISCATION);
g.move(0, DIR.RIGHT);
g.move(1, DIR.LEFT);               // pas de carte jouée → la fenêtre se referme
g.move(0, DIR.RIGHT);
r = g.playCard(1, CARD.CHARGE);
eq(find(r, "cardPlayed")[0].card, CARD.CHARGE, "confiscation expired after opponent turn without card");

// ── Abandon ──────────────────────────────────────────────────────────────────
g = game(["01..", "....", "....", "...."], { firstTeam: 0 });
r = g.resign(0);
eq(g.winner, 1, "resign gives the win to the opponent");

// ── Snapshot pour reprise ────────────────────────────────────────────────────
g = new G.BandasGame({ board: mk(["01..", ".#..", "..T.", "...."]), pool: [1, 2], firstTeam: 1 });
g.chooseCard(1, 2);
var snap = g.snapshot();
eq(snap.phase, G.PHASE_CARD_SELECTION, "snapshot phase");
eq(snap.pool.join(","), "1", "snapshot pool");
eq(snap.hands[1].join(","), "2", "snapshot hands");
eq(snap.content.length, 16, "snapshot board content");
var rb = E.Board.fromContent(snap.size, snap.content, snap.bounds);
eq(rb.countSpritesOf(0), 1, "snapshot board rebuilds");

console.log("bandas game tests: " + passed + " passed, " + fails + " failed");
process.exit(fails ? 1 : 0);
