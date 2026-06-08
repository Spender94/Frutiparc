//
// Tests de l'IA Grapiz (node public/grapiz/server/bot.test.js).
//
var E = require("../engine.js");
var B = require("./bot.js");

var fails = 0, passed = 0;
function ok(c, m) { if (c) passed++; else { fails++; console.log("  ✗ FAIL: " + m); } }
function eq(a, b, m) { ok(a === b, m + " (got " + a + ", want " + b + ")"); }
function lcg(seed) { var s = seed >>> 0; return function () { s = (1664525 * s + 1013904223) >>> 0; return s / 4294967296; }; }

// ── groupCount ──────────────────────────────────────────────────────────────
eq(B.groupCount(E.Board.fromDefinition({ size: 3, tokens: [{ t: 0, x: 3, y: 3 }, { t: 0, x: 4, y: 4 }] }), 0), 1, "deux jetons adjacents = 1 groupe");
eq(B.groupCount(E.Board.fromDefinition({ size: 3, tokens: [{ t: 0, x: 0, y: 0 }, { t: 0, x: 6, y: 6 }] }), 0), 2, "deux jetons éloignés = 2 groupes");

// ── eval : connecté > éclaté (avec adversaire, position non terminale) ──────
var connected = E.Board.fromDefinition({ size: 3, tokens: [{ t: 0, x: 3, y: 3 }, { t: 0, x: 4, y: 4 }, { t: 1, x: 0, y: 0 }, { t: 1, x: 6, y: 6 }] });
var split = E.Board.fromDefinition({ size: 3, tokens: [{ t: 0, x: 0, y: 0 }, { t: 0, x: 6, y: 6 }, { t: 1, x: 1, y: 1 }, { t: 1, x: 5, y: 5 }] });
ok(B.evalFor(connected, 0) > B.evalFor(split, 0), "une position connectée s'évalue mieux qu'éclatée");

// ── contrôle du centre récompensé ───────────────────────────────────────────
var central = E.Board.fromDefinition({ size: 4, tokens: [{ t: 0, x: 4, y: 4 }, { t: 0, x: 3, y: 3 }] });
var edge = E.Board.fromDefinition({ size: 4, tokens: [{ t: 0, x: 0, y: 0 }, { t: 0, x: 1, y: 1 }] });
ok(B.centerScore(central, 0, 4) > B.centerScore(edge, 0, 4), "le centre est mieux évalué que le bord");

// ── chooseMove renvoie toujours un coup LÉGAL ───────────────────────────────
var board = E.Board.newLambdaBoard();
function legal(board, team, mv) {
  return mv && B.allMoves(board, team).some(function (m) { return m.from.x === mv.from.x && m.from.y === mv.from.y && m.direction === mv.direction; });
}
var rng = lcg(42), allLegal = true;
for (var i = 0; i < 40 && allLegal; i++) allLegal = legal(board, 0, B.chooseMove(board, 0, (i % 6) / 10, rng)); // niveaux 0..0.5 (rapides)
allLegal = allLegal && legal(board, 0, B.chooseMove(board, 0, 1, lcg(3)));   // + un niveau max (depth 4)
ok(allLegal, "chooseMove renvoie toujours un coup légal (tous niveaux)");

// ── FORCE : un bot fort bat un bot faible la plupart du temps ───────────────
function playBotVsBot(skill0, skill1, seed) {
  var b = E.Board.newLambdaBoard(), turn = 0, rng = lcg(seed);
  for (var ply = 0; ply < 120; ply++) {
    if (b.teamTokens(turn).length === 0) return turn === 0 ? 1 : 0;
    var mv = B.chooseMove(b, turn, turn === 0 ? skill0 : skill1, rng);
    if (!mv) return turn === 0 ? 1 : 0;
    b.move(new E.Coordinate(mv.from.x, mv.from.y), mv.direction);
    if (B.groupCount(b, turn) === 1 || b.teamTokens(turn === 0 ? 1 : 0).length === 0) return turn;
    turn = turn === 0 ? 1 : 0;
  }
  return -1; // limite (nul)
}
var strongWins = 0, games = 6;
for (var s = 0; s < games; s++) {
  var strongTeam = s % 2;                       // alterne les couleurs
  var r = strongTeam === 0 ? playBotVsBot(0.8, 0.12, 700 + s) : playBotVsBot(0.12, 0.8, 700 + s);
  if (r === strongTeam) strongWins++;
}
ok(strongWins >= 4, "le bot fort bat le faible la plupart du temps (" + strongWins + "/" + games + ")");

console.log("\nGrapiz bot: " + passed + " passed, " + fails + " failed.");
process.exit(fails ? 1 : 0);
