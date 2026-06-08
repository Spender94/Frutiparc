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
var connected = E.Board.fromDefinition({ size: 3, tokens: [{ t: 0, x: 3, y: 3 }, { t: 0, x: 4, y: 4 }] }); // (3,3) & son voisin S
eq(B.groupCount(connected, 0), 1, "deux jetons adjacents = 1 groupe");
var split = E.Board.fromDefinition({ size: 3, tokens: [{ t: 0, x: 0, y: 0 }, { t: 0, x: 6, y: 6 }] });
eq(B.groupCount(split, 0), 2, "deux jetons éloignés = 2 groupes");

// ── eval : connecté > éclaté ────────────────────────────────────────────────
ok(B.evalFor(connected, 0, 1) > B.evalFor(split, 0, 1), "une position connectée s'évalue mieux qu'éclatée");

// ── chooseMove renvoie toujours un coup LÉGAL ───────────────────────────────
var board = E.Board.newLambdaBoard();
function legal(board, team, mv) {
  if (!mv) return false;
  return B.allMoves(board, team).some(function (m) {
    return m.from.x === mv.from.x && m.from.y === mv.from.y && m.direction === mv.direction;
  });
}
var rng = lcg(42);
for (var i = 0; i < 200; i++) {
  var sk = (i % 11) / 10;            // balaye les niveaux 0..1
  var mv = B.chooseMove(board, 0, sk, rng);
  if (!legal(board, 0, mv)) { ok(false, "coup illégal renvoyé (skill " + sk + ")"); break; }
}
ok(true, "chooseMove renvoie toujours un coup légal (200 essais, tous niveaux)");

// ── un bot fort prend un gain immédiat ──────────────────────────────────────
// team0 en (3,3) peut sauter SE de 2 cases et capturer team1 en (3,5) : il ne
// reste qu'un jeton team0 → connecté → gagné. Un bot fort doit jouer ce coup.
var winBoard = E.Board.fromDefinition({ size: 3, tokens: [{ t: 0, x: 3, y: 3 }, { t: 1, x: 3, y: 5 }] });
var pickWin = B.chooseMove(winBoard, 0, 1, lcg(1));
ok(pickWin && pickWin.from.x === 3 && pickWin.from.y === 3 && pickWin.direction === E.DIR.SE, "skill=1 prend le coup gagnant (capture connectante)");

// ── un bot faible reste légal (et ne plante pas) ────────────────────────────
ok(legal(winBoard, 0, B.chooseMove(winBoard, 0, 0, lcg(7))), "skill=0 renvoie un coup légal");

console.log("\nGrapiz bot: " + passed + " passed, " + fails + " failed.");
process.exit(fails ? 1 : 0);
