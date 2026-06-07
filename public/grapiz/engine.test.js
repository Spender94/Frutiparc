//
// Tests du moteur Grapiz (portage fidèle). Lancer : node public/grapiz/engine.test.js
// Vérifie les invariants connus du source AS2 (géométrie hexagonale, plateau de
// départ, règle de déplacement de type Lines-of-Action, capture).
//
var E = require("./engine.js");
var DIR = E.DIR, Coordinate = E.Coordinate, Board = E.Board;

var fails = 0, passed = 0;
function ok(cond, msg) { if (cond) { passed++; } else { fails++; console.log("  ✗ FAIL: " + msg); } }
function eq(a, b, msg) { ok(a === b, msg + " (got " + a + ", want " + b + ")"); }

// ── Directions ────────────────────────────────────────────────────────────
eq(E.dirOpposite(DIR.N), DIR.S, "opposite(N)=S");
eq(E.dirOpposite(DIR.NE), DIR.SW, "opposite(NE)=SW");
eq(E.dirOpposite(DIR.NW), DIR.SE, "opposite(NW)=SE");
eq(E.dirValueOf(2), DIR.BAD, "valueOf(E=2)=BAD");
eq(E.dirValueOf(6), DIR.BAD, "valueOf(W=6)=BAD");
eq(E.dirValueOf(1), DIR.NE, "valueOf(1)=NE");
eq(E.DIR_LIST.length, 6, "6 playable directions");

// ── Hexagone : nombre de cases valides = nombre hexagonal centré 3s²+3s+1 ───
function countValid(size) {
  var b = new Board(size), n = 0, max = size * 2;
  for (var x = 0; x <= max; x++) for (var y = 0; y <= max; y++)
    if (b.isValid(new Coordinate(x, y))) n++;
  return n;
}
[3, 4, 5].forEach(function (s) {
  eq(countValid(s), 3 * s * s + 3 * s + 1, "hexagon(size " + s + ") cell count");
});

// ── Plateau de départ "lambda" ──────────────────────────────────────────────
var b = Board.newLambdaBoard();
eq(b.getSize(), 4, "lambda size = 4");
eq(b.getTokens().length, 18, "lambda has 18 tokens");
eq(b.teamTokens(0).length, 9, "lambda team 0 = 9 tokens");
eq(b.teamTokens(1).length, 9, "lambda team 1 = 9 tokens");
ok(b.getTokens().every(function (t) { return b.isValid(t.getCoordinate()); }), "all lambda tokens on valid cells");
ok(b.getTokens().every(function (t) { return b.getAt(t.getCoordinate()) === t; }), "board index round-trips every token");

// ── countTokensOnLine est symétrique (compte toute la ligne, des 2 côtés) ───
var sym = true, movesTotal = 0;
b.teamTokens(0).forEach(function (t) {
  var c = t.getCoordinate();
  E.DIR_LIST.forEach(function (d) {
    if (b.countTokensOnLine(c, d) !== b.countTokensOnLine(c, E.dirOpposite(d))) sym = false;
  });
  // tous les coups proposés visent une case valide et "mangeable"
  b.availableMoves(c).forEach(function (m) {
    movesTotal++;
    ok(b.isValid(m.target), "available move target valid for " + c);
    ok(m.distance === b.countTokensOnLine(c, m.direction), "move distance = line count");
  });
});
ok(sym, "countTokensOnLine(d) == countTokensOnLine(opposite d)");
ok(movesTotal > 0, "team 0 has at least one legal move at start (" + movesTotal + ")");

// ── Capture contrôlée : team0 en (3,3) saute SE de 2 cases sur team1 en (3,5) ─
var cap = Board.fromDefinition({ size: 3, tokens: [{ t: 0, x: 3, y: 3 }, { t: 1, x: 3, y: 5 }] });
eq(cap.countTokensOnLine(new Coordinate(3, 3), DIR.SE), 2, "line has 2 tokens → move distance 2");
ok(cap.canMove(new Coordinate(3, 3), DIR.SE, 2), "canMove SE distance 2 (lands on opponent)");
var start = new Coordinate(3, 3);
var captured = cap.move(start, DIR.SE);
ok(captured && captured.getTeam() === 1, "captured the team-1 token");
ok(cap.getAt(new Coordinate(3, 5)) && cap.getAt(new Coordinate(3, 5)).getTeam() === 0, "team-0 token now on (3,5)");
ok(!cap.hasAt(new Coordinate(3, 3)), "origin (3,3) now empty");
eq(cap.teamTokens(1).length, 0, "opponent eliminated after capture");
eq(cap.teamTokens(0).length, 1, "mover still present");

// ── Connexité (hypothèse de victoire LOA, à confirmer) ──────────────────────
var conn = Board.fromDefinition({ size: 3, tokens: [{ t: 0, x: 3, y: 3 }, { t: 0, x: 3, y: 4 }] });
ok(conn.teamConnected(0), "two adjacent tokens are connected");
var disc = Board.fromDefinition({ size: 3, tokens: [{ t: 0, x: 1, y: 1 }, { t: 0, x: 5, y: 5 }] });
ok(!disc.teamConnected(0), "two far tokens are NOT connected");

console.log("\nGrapiz engine: " + passed + " passed, " + fails + " failed.");
process.exit(fails ? 1 : 0);
