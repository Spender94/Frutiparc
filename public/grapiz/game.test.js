//
// Tests de la machine d'état (node public/grapiz/game.test.js).
//
var E = require("./engine.js");
var G = require("./game.js");
var DIR = E.DIR;

var fails = 0, passed = 0;
function ok(c, m) { if (c) passed++; else { fails++; console.log("  ✗ FAIL: " + m); } }
function eq(a, b, m) { ok(a === b, m + " (got " + a + ", want " + b + ")"); }

// ── Départ ──────────────────────────────────────────────────────────────
var g = new G.GrapizGame({ players: ["alice", "bob"] });
eq(g.currentTurn, 0, "start: turn 0");
ok(!g.ended, "start: not ended");
ok(g.winner_() === null, "start: no winner (lambda board not connected)");
ok(g.legalMoves(0).length > 0, "start: team 0 has legal moves");
ok(g.hasAnyMove(0) && g.hasAnyMove(1), "start: both teams can move");

// ── Validation ───────────────────────────────────────────────────────────
ok(!g.applyMove(1, 0, 0, DIR.N).ok, "reject move when not your turn");
eq(g.applyMove(1, 0, 0, DIR.N).error, "not-your-turn", "error = not-your-turn");
ok(!g.applyMove(0, 0, 0, DIR.E).ok, "reject dead direction E");
ok(!g.applyMove(0, 2, 2, DIR.N).ok, "reject when no own token at source");

// un coup légal trouvé dynamiquement avance le tour
var lm = g.legalMoves(0)[0];
var r = g.applyMove(0, lm.from.x, lm.from.y, lm.direction);
ok(r.ok, "apply a legal move");
eq(g.currentTurn, 1, "turn advances to 1 after a move");
ok(!g.ended, "game continues");

// ── Victoire par élimination/connexion (capture du dernier jeton adverse) ──
var g2 = new G.GrapizGame({
  players: ["alice", "bob"], currentTurn: 0,
  def: { size: 3, tokens: [{ t: 0, x: 3, y: 3 }, { t: 1, x: 3, y: 5 }] },
});
var rc = g2.applyMove(0, 3, 3, DIR.SE);   // saute 2 cases, capture (3,5)
ok(rc.ok, "capture move applies");
ok(rc.captured && rc.captured.team === 1, "captured a team-1 token");
ok(g2.ended, "game ended after eliminating opponent");
eq(g2.winner, 0, "winner = 0");
eq(rc.winner, 0, "move result reports winner 0");

// ── Détection de connexion (règle confirmée) ───────────────────────────────
var connected = new G.GrapizGame({
  players: ["a", "b"],
  def: { size: 3, tokens: [{ t: 0, x: 3, y: 3 }, { t: 0, x: 4, y: 4 }, { t: 1, x: 0, y: 0 }, { t: 1, x: 6, y: 6 }] },
});
eq(connected.winner_(), 0, "team 0 fully connected → winner 0");

var split = new G.GrapizGame({
  players: ["a", "b"],
  def: { size: 3, tokens: [{ t: 0, x: 1, y: 1 }, { t: 0, x: 5, y: 5 }, { t: 1, x: 0, y: 0 }, { t: 1, x: 6, y: 6 }] },
});
ok(split.winner_() === null, "both teams split → no winner");

console.log("\nGrapiz game: " + passed + " passed, " + fails + " failed.");
process.exit(fails ? 1 : 0);
