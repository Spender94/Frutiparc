//
// Tests du moteur Frutibandas (portage fidèle de Board.as).
// Lancer : node public/bandas/engine.test.js
//
var E = require("./engine.js");
var DIR = E.DIR, Board = E.Board;

var fails = 0, passed = 0;
function ok(cond, msg) { if (cond) { passed++; } else { fails++; console.log("  ✗ FAIL: " + msg); } }
function eq(a, b, msg) { ok(a === b, msg + " (got " + a + ", want " + b + ")"); }

// plateau depuis lignes lisibles : '0','1' équipes, '.' libre, '#' roche, 'X' détruit, 'T' piégé
function mk(rows) {
  var size = rows.length;
  var b = new Board(size);
  for (var y = 0; y < size; y++) {
    for (var x = 0; x < size; x++) {
      var ch = rows[y].charAt(x);
      var e = ch === "0" ? 0 : ch === "1" ? 1 : ch === "#" ? E.ROCK : ch === "X" ? E.DESTROYED : ch === "T" ? E.TRAPPED : E.FREE;
      b.setElementAt(y * size + x, e);
      if (e > E.FREE) b.teamCounters[e]++;
    }
  }
  return b;
}
function rowstr(b) { return b.toString().split("\n").map(function (l) { return l.replace(/ /g, ""); }).filter(Boolean); }

// ── Directions ───────────────────────────────────────────────────────────────
eq(E.dirOpposite(DIR.UP), DIR.DOWN, "opposite(Up)=Down");
eq(E.dirOpposite(DIR.LEFT), DIR.RIGHT, "opposite(Left)=Right");
eq(E.dirValueOf(5), DIR.BAD, "valueOf(5)=BAD");
eq(E.dirValueOf(2), DIR.DOWN, "valueOf(2)=Down");

// ── Mouvement simple : un fruit glisse d'une case ───────────────────────────
var b = mk([
  "....",
  ".0..",
  "....",
  "....",
]);
b.move(0, DIR.RIGHT);
eq(rowstr(b)[1], "..0.", "simple move right");
eq(b.countSpritesOf(0), 1, "no death on simple move");

// ── Poussée en chaîne : 0 pousse 1, 1 sort du plateau et meurt ──────────────
b = mk([
  "....",
  "..01",
  "....",
  "....",
]);
b.move(0, DIR.RIGHT);
eq(b.countSpritesOf(1), 0, "pushed off the edge dies");
eq(rowstr(b)[1], "...0", "pusher takes the freed slot");

// ── Tout le monde bouge : chaque fruit de l'équipe avance d'une case ────────
b = mk([
  "0.0.",
  "....",
  "0...",
  "....",
]);
b.move(0, DIR.DOWN);
eq(rowstr(b).join("|"), "....|0.0.|....|0...", "all team sprites move one step");

// ── Chaîne alliée : la file entière se décale (le premier itéré pousse) ─────
b = mk([
  "00..",
  "....",
  "....",
  "....",
]);
b.move(0, DIR.RIGHT);
eq(rowstr(b)[0], ".00.", "allied chain shifts (no double move)");

// ── La roche bloque la chaîne ────────────────────────────────────────────────
b = mk([
  "01#.",
  "....",
  "....",
  "....",
]);
b.move(0, DIR.RIGHT);
eq(rowstr(b)[0], "01#.", "rock blocks the whole chain");
eq(b.countSpritesOf(1), 1, "nobody dies against a rock");

// roche après une case libre : on bouge quand même
b = mk([
  "0.#.",
  "....",
  "....",
  "....",
]);
b.move(0, DIR.RIGHT);
eq(rowstr(b)[0], ".0#.", "free slot before rock → move allowed");

// ── Case piégée : le fruit qui y entre meurt, le piège est signalé ──────────
b = mk([
  "0T..",
  "....",
  "....",
  "....",
]);
b.move(0, DIR.RIGHT);
eq(b.countSpritesOf(0), 0, "sprite dies on trap");
var hits = b.takeTrapHits();
eq(hits.length, 1, "trap hit recorded");
eq(hits[0].x + "," + hits[0].y, "1,0", "trap hit coordinate");
eq(b.takeTrapHits().length, 0, "trap hits cleared after read");

// ── Case détruite : chute ────────────────────────────────────────────────────
b = mk([
  "0X..",
  "....",
  "....",
  "....",
]);
b.move(0, DIR.RIGHT);
eq(b.countSpritesOf(0), 0, "sprite falls in destroyed slot");

// ── removeEmptyBorders : les bords vides sont détruits, les bornes bougent ──
b = mk([
  "....",
  ".01.",
  ".10.",
  "....",
]);
b.removeEmptyBorders();
eq(b.minX + "," + b.minY + "," + b.maxX + "," + b.maxY, "1,1,2,2", "borders shrink to content");
eq(b.getElement({ x: 0, y: 0 }), E.DESTROYED, "outside cells read as destroyed");
eq(b.countSpritesOf(0) + b.countSpritesOf(1), 4, "no sprite lost during border removal");

// ── destroy décrémente les compteurs et notifie ──────────────────────────────
var events = [];
b = mk([
  "01..",
  "....",
  "....",
  "....",
]);
b.setListener({
  onSlotDestroyed: function (c) { events.push("dest:" + c.x + "," + c.y); },
  onSpriteMove: function (c, d, pushed) { events.push("mv:" + c.x + "," + c.y + ":" + d + ":" + (pushed ? 1 : 0)); },
  onSlotTrapped: function (c) { events.push("trap:" + c.x + "," + c.y); },
  onTrapDiscovered: function (c) { events.push("disc:" + c.x + "," + c.y); },
});
b.destroy({ x: 1, y: 0 });
eq(b.countSpritesOf(1), 0, "destroy decrements team counter");
eq(events[0], "dest:1,0", "onSlotDestroyed fired");
b.setTrapped({ x: 2, y: 2 });
eq(events[1], "trap:2,2", "onSlotTrapped fired");
b.destroy({ x: 2, y: 2 });
eq(events[2], "disc:2,2", "destroying a trap → onTrapDiscovered");
events = [];
b.move(0, DIR.RIGHT);
eq(events.length, 1, "one move event for one sprite");
ok(/^mv:0,0:1:0$/.test(events[0]), "move event carries origin/direction/pushed");

// ── Poussée notifiée avec pushed=true ────────────────────────────────────────
b = mk([
  "01..",
  "....",
  "....",
  "....",
]);
var pushedEv = [];
b.setListener({ onSpriteMove: function (c, d, p) { pushedEv.push((p ? "P" : "m") + c.x + "," + c.y); } });
b.move(0, DIR.RIGHT);
eq(pushedEv.join("|"), "P1,0|m0,0", "pushed sprite animates as pushed, pusher as move");

// ── Sérialisation aller-retour (format <b> d'origine : élément + 7) ─────────
b = mk([
  "01..",
  ".#X.",
  "..T.",
  "....",
]);
var content = b.toContentString();
eq(content.length, 16, "content covers every slot");
eq(content.charAt(0), "7", "team0 serializes as 7");
eq(content.charAt(1), "8", "team1 serializes as 8");
eq(content.charAt(5), "5", "rock serializes as 5");
eq(content.charAt(6), "4", "destroyed serializes as 4");
eq(content.charAt(10), "3", "trapped serializes as 3");
var b2 = Board.fromContent(4, content, { x1: 0, x2: 3, y1: 0, y2: 3 });
eq(b2.toContentString(), content, "round-trip");
eq(b2.countSpritesOf(0), 1, "counters rebuilt from content");

// ── Plateau de départ ────────────────────────────────────────────────────────
function seeded(seed) { return function () { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }
var sb = Board.newStartingBoard(8, seeded(42));
eq(sb.countSpritesOf(0), 32, "8x8 start: 32 fruits team 0");
eq(sb.countSpritesOf(1), 32, "8x8 start: 32 fruits team 1");
var sb7 = Board.newStartingBoard(7, seeded(7));
eq(sb7.countSpritesOf(0), 24, "7x7 start: 24 fruits team 0");
eq(sb7.countSpritesOf(1), 24, "7x7 start: 24 fruits team 1");
var frees = 0;
for (var i = 0; i < 49; i++) if (sb7.getElementAt(i) === E.FREE) frees++;
eq(frees, 1, "7x7 start: one free slot");

// ── clone indépendant ────────────────────────────────────────────────────────
var cl = sb.clone();
cl.move(0, DIR.UP);
ok(sb.toContentString() !== cl.toContentString() || sb.countSpritesOf(0) !== cl.countSpritesOf(0), "clone diverges after move");
eq(sb.countSpritesOf(0), 32, "original untouched by clone move");

// ── getMoveOrder : la tête de file (proche du bord) passe en premier ─────────
b = mk(["0...", "....", "....", "...."]);
eq(b.getMoveOrder({ x: 0, y: 0 }, DIR.RIGHT), 0, "leftmost first when moving right? (order value)");
eq(b.getMoveOrder({ x: 3, y: 0 }, DIR.RIGHT), 3, "rightmost has higher order when moving right");
eq(b.getMoveOrder({ x: 0, y: 0 }, DIR.UP), 3, "move order up");

console.log("bandas engine tests: " + passed + " passed, " + fails + " failed");
process.exit(fails ? 1 : 0);
