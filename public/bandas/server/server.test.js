//
// Tests des cœurs serveur Frutibandas (node public/bandas/server/server.test.js) :
// Session (horloges, timeout, abandon) + Lobby (appariements) + Net (protocole,
// visibilité des cartes cachées, séries challenge, bots).
//
var E = require("../engine.js");
var G = require("../game.js");
var S = require("./session.js");
var L = require("./lobby.js");
var Bot = require("./bot.js");
var N = require("./net.js");
var DIR = E.DIR, CARD = G.CARD;

var fails = 0, passed = 0;
function ok(c, m) { if (c) passed++; else { fails++; console.log("  ✗ FAIL: " + m); } }
function eq(a, b, m) { ok(a === b, m + " (got " + a + ", want " + b + ")"); }
function seeded(seed) { return function () { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }

function mk(rows) {
  var size = rows.length;
  var b = new E.Board(size);
  for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) {
    var ch = rows[y].charAt(x);
    var e = ch === "0" ? 0 : ch === "1" ? 1 : E.FREE;
    b.setElementAt(y * size + x, e);
    if (e > E.FREE) b.teamCounters[e]++;
  }
  return b;
}

// ══ SESSION ═══════════════════════════════════════════════════════════════
var game = new G.BandasGame({ board: mk(["0..1", "0..1", "....", "...."]), pool: [3, 5], firstTeam: 0 });
var sess = new S.BandasSession({
  id: "s1", players: [{ id: "p0", name: "alice" }, { id: "p1", name: "bob" }],
  params: { time: 60000, boardSize: 4, cards: 1 }, game: game, now: 0,
});
var snap = sess.snapshot(0);
eq(snap.phase, G.PHASE_CARD_SELECTION, "session: draft phase at start");
eq(snap.currentTeam, 0, "session: team 0 starts");
eq(snap.players[0].remaining, 60000, "session: clock starts full");
eq(snap.counters[0], 2, "session: snapshot counters");
eq(sess.teamOf("p1"), 1, "session: team lookup");

ok(!sess.requestChooseCard("p1", 3, 100).ok, "session: reject draft pick out of turn");
eq(sess.requestMove("nobody", DIR.UP, 100).error, "not-a-player", "session: reject non-player");
ok(!sess.requestMove("p0", DIR.UP, 100).ok, "session: no move during draft");

var r = sess.requestChooseCard("p0", 3, 1500);
ok(r.ok, "session: draft pick accepted");
eq(sess.clocks[0], 58500, "session: 1500ms charged to team 0");
eq(sess.clocks[1], 60000, "session: team 1 clock untouched");
r = sess.requestChooseCard("p1", 5, 2000);
eq(sess.game.phase, G.PHASE_MOVE, "session: move phase after last pick");

r = sess.requestMove("p0", DIR.RIGHT, 3000);
ok(r.ok, "session: move accepted");
eq(sess.game.currentTeam, 1, "session: turn advances");

// timeout détecté par tick
var sess2 = new S.BandasSession({
  id: "s2", players: [{ id: "a" }, { id: "b" }],
  params: { time: 5000 }, game: new G.BandasGame({ board: mk(["01", ".."]), pool: [], firstTeam: 0 }), now: 0,
});
ok(sess2.tick(1000) === null, "session: no timeout before the clock runs out");
var to = sess2.tick(5001);
ok(to && to.ended, "session: timeout detected");
eq(to.winner, 1, "session: opponent wins on timeout");
eq(to.reason, "timeout", "session: timeout reason");

// abandon
var sess3 = new S.BandasSession({
  id: "s3", players: [{ id: "a" }, { id: "b" }],
  params: { time: 5000 }, game: new G.BandasGame({ board: mk(["01", ".."]), pool: [], firstTeam: 0 }), now: 0,
});
var ff = sess3.forfeit("b");
eq(ff.winner, 0, "session: forfeit gives the win to the opponent");
eq(ff.reason, "forfeit", "session: forfeit reason");
ok(!sess3.requestMove("a", DIR.UP, 10).ok, "session: no move after end");

// ══ LOBBY ═════════════════════════════════════════════════════════════════
var lob = new L.BandasLobby();
lob.addPlayer("u1", "Alice");
lob.addPlayer("u2", "Bob");
lob.addPlayer("u3", "Carol");
eq(lob.listPlayers().length, 3, "lobby: players listed");

var cg = lob.createGame("u1", { time: 480, boardSize: 6, cards: 2 });
ok(cg.ok, "lobby: game created");
eq(cg.game.params.time, 480000, "lobby: time choice honoured (ms)");
eq(cg.game.params.boardSize, 6, "lobby: size choice honoured");
eq(cg.game.params.cards, 2, "lobby: cards choice honoured");
var cg2 = lob.createGame("u1", {});
eq(cg2.error, "already-busy", "lobby: host cannot create twice");
eq(lob.listOpenGames().length, 1, "lobby: open game listed");

var jg = lob.joinGame("u2", cg.gameId);
ok(jg.ok && jg.started, "lobby: join completes the game");
eq(lob.getPlayer("u1").status, "playing", "lobby: host now playing");
eq(lob.listOpenGames().length, 0, "lobby: no more open game");

var ch = lob.challenge("u3", "u1", {});
eq(ch.error, "target-busy", "lobby: cannot challenge a playing player");
lob.endGame(cg.gameId);
eq(lob.getPlayer("u1").status, "idle", "lobby: endGame frees players");
ch = lob.challenge("u3", "u1", {});
ok(ch.ok, "lobby: challenge created");
var ac = lob.acceptChallenge("u1", ch.challengeId);
ok(ac.ok, "lobby: challenge accepted starts a game");
eq(ac.game.players.join(","), "u3,u1", "lobby: challenger is team 0");

// paramètres invalides → défauts
var dp = L.defaultParams({ time: 999, boardSize: 99, cards: 0 });
eq(dp.time, 600000, "lobby: bad time falls back to default");
eq(dp.boardSize, 8, "lobby: bad size falls back to default");
eq(dp.cards, 4, "lobby: bad cards falls back to default");

// ══ BOT ═══════════════════════════════════════════════════════════════════
var bb = mk(["01..", "....", "....", "...."]);
var mv = Bot.chooseMove(bb, 0, 1.0, seeded(5));
ok([DIR.UP, DIR.RIGHT, DIR.DOWN, DIR.LEFT].indexOf(mv) >= 0, "bot: returns a direction");
var scored = Bot.scoreMoves(bb, 0, 1);
eq(scored.length, 4, "bot: scores all four directions");
// pousser 1 dehors (RIGHT) doit dominer se suicider (LEFT)
var right = scored.filter(function (s) { return s.direction === DIR.RIGHT; })[0];
var left = scored.filter(function (s) { return s.direction === DIR.LEFT; })[0];
ok(right.score > left.score, "bot: pushing the opponent out beats suicide");
eq(Bot.chooseDraft([CARD.ENTRACTE, CARD.VACHETTE], 1.0, seeded(3)), CARD.VACHETTE, "bot: draft prefers strong cards");

// ══ NET ═══════════════════════════════════════════════════════════════════
var persisted = [], streakMem = {};
function mknet(t0) {
  var nowRef = { t: t0 || 0 };
  var net = new N.BandasNet({
    clock: function () { return nowRef.t; },
    rng: seeded(99),
    getStreak: function (u) { return streakMem[u] || 0; },
    onStreak: function (u, s, info) { streakMem[u] = s; if (info.series > 0) persisted.push(u + ":" + info.series); },
  });
  net._now = nowRef;
  return net;
}
var net = mknet();
eq(net.lobby.listPlayers().length, 3, "net: bots pre-registered in the lobby");

var msgs = net.handle("alice", { a: "hello", n: "Alice", f: "0".repeat(24) });
ok(msgs.length > 0 && msgs[0].xml.indexOf('e="lobby"') >= 0, "net: hello broadcasts the lobby");
net.handle("bob", { a: "hello", n: "Bob" });

msgs = net.handle("alice", { a: "create", t: "600", sz: "8", cd: "4" });
ok(msgs.some(function (m) { return m.xml.indexOf("<game") >= 0; }), "net: open game in lobby xml");

msgs = net.handle("bob", { a: "join", g: net.lobby.listOpenGames()[0].id });
var started = msgs.filter(function (m) { return m.xml.indexOf('e="start"') >= 0; });
eq(started.length, 2, "net: start sent to both players");
ok(started[0].to.length === 1 && started[1].to.length === 1, "net: start is per-player");
ok(started[0].xml.indexOf("<b size=\"8\"") >= 0, "net: start carries the board");
ok(started[0].xml.indexOf('ph="1"') >= 0, "net: starts in draft phase");

var sessId = Object.keys(net.sessions)[0];
var theSess = net.sessions[sessId];
eq(theSess.players.length, 2, "net: session created");

// draft complet (4 cartes chacun) — on pioche ce que le serveur a en pool
function drafter(net, sess) {
  while (sess.game.phase === G.PHASE_CARD_SELECTION) {
    var team = sess.game.currentTeam;
    var uid = sess.playerOfTeam(team).id;
    var card = sess.game.pool[0];
    var out = net.handle(uid, { a: "choose", c: String(card) });
    if (!out.length) return false;
  }
  return true;
}
ok(drafter(net, theSess), "net: full draft runs");
eq(theSess.game.phase, G.PHASE_MOVE, "net: move phase reached");
eq(theSess.game.hands[0].length, 4, "net: 4 cards drafted for team 0");

// mouvement : événements diffusés aux deux
var who = theSess.playerOfTeam(theSess.game.currentTeam).id;
msgs = net.handle(who, { a: "move", d: String(DIR.RIGHT) });
ok(msgs.length >= 2, "net: move produces events");
ok(msgs.every(function (m) { return m.to.length === 2; }), "net: move events broadcast to both");
ok(msgs[0].xml.indexOf('rt0="') >= 0, "net: clocks attached to events");

// pose cachée : seul le poseur reçoit l'événement
var t2 = theSess.game.currentTeam;
var uid2 = theSess.playerOfTeam(t2).id;
theSess.game.hands[t2] = [CARD.PIEGE];
// une case libre pour poser le piège
var freeCell = null;
for (var y = theSess.game.board.minY; y <= theSess.game.board.maxY && !freeCell; y++) {
  for (var x = theSess.game.board.minX; x <= theSess.game.board.maxX && !freeCell; x++) {
    if (theSess.game.board.getElement({ x: x, y: y }) === E.FREE) freeCell = { x: x, y: y };
  }
}
if (freeCell) {
  msgs = net.handle(uid2, { a: "play", c: String(CARD.PIEGE), x: String(freeCell.x), y: String(freeCell.y) });
  eq(msgs.length, 1, "net: hidden play produces one message");
  eq(msgs[0].to.join(","), uid2, "net: hidden play goes only to its owner");
  ok(msgs[0].xml.indexOf('h="1"') >= 0, "net: hidden play flagged");
} else {
  ok(true, "net: (no free cell — skip hidden play check)");
  ok(true, "net: (skip)"); ok(true, "net: (skip)");
}

// abandon → fin + série du gagnant
persisted.length = 0;
msgs = net.handle(uid2, { a: "part" });
ok(msgs.some(function (m) { return m.xml.indexOf('t="end"') >= 0; }), "net: forfeit broadcasts end event");
eq(Object.keys(net.sessions).length, 0, "net: session cleaned up");
var winner = (uid2 === "alice") ? "bob" : "alice";
eq(net.streaks[winner], 1, "net: winner streak bumped");
eq(net.streaks[uid2], 0, "net: loser streak reset");
ok(persisted.indexOf(winner + ":1") >= 0, "net: winner series persisted");

// anti-farm : battre le même humain pendant une même série ne compte qu'UNE
// fois (le gagnant de la partie précédente l'a déjà « battu » dans sa série).
net.handle("alice", { a: "challenge", u: "bob" });
var s2id = Object.keys(net.sessions)[0];
net.sessions[s2id].forfeit("bob");
net._concludeGame(net.sessions[s2id]);
net.handle("alice", { a: "challenge", u: "bob" });
var s3id = Object.keys(net.sessions)[0];
net.sessions[s3id].forfeit("bob");
net._concludeGame(net.sessions[s3id]);
eq(net.streaks.alice, 1, "net: same human counts once per series");

// défi d'un bot : la partie démarre, le bot joue au tick
var net2 = mknet();
net2.handle("zoe", { a: "hello", n: "Zoé" });
msgs = net2.handle("zoe", { a: "challenge", u: "banano" });
ok(msgs.some(function (m) { return m.xml.indexOf('e="start"') >= 0; }), "net: bot challenge starts");
var bs = net2.sessions[Object.keys(net2.sessions)[0]];
// au draft : si c'est au bot, le tick le fait piocher après son délai
var guard = 0, botActed = false;
while (guard++ < 500 && bs.game.phase === G.PHASE_CARD_SELECTION) {
  var cur = bs.playerOfTeam(bs.game.currentTeam).id;
  if (cur === "zoe") {
    net2.handle("zoe", { a: "choose", c: String(bs.game.pool[0]) });
  } else {
    net2._now.t += 500;
    var out2 = net2.tick(net2._now.t);
    if (out2.length) botActed = true;
  }
}
ok(botActed, "net: bot drafts via tick");
eq(bs.game.phase, G.PHASE_MOVE, "net: draft against bot completes");

// déconnexion en partie → défaite + série close
var net3 = mknet();
net3.handle("ana", { a: "hello", n: "Ana" });
net3.handle("ben", { a: "hello", n: "Ben" });
net3.handle("ana", { a: "create" });
net3.handle("ben", { a: "join", g: net3.lobby.listOpenGames()[0].id });
streakMem.ana = 0; streakMem.ben = 0;
msgs = net3.onDisconnect("ana");
ok(msgs.some(function (m) { return m.xml.indexOf('t="end"') >= 0; }), "net: disconnect broadcasts end");
eq(net3.streaks.ben, 1, "net: surviving player wins the game (streak +1)");
ok(!net3.lobby.getPlayer("ana"), "net: disconnected player removed from lobby");

// timeout par tick au niveau net
var net4 = mknet();
net4.handle("max", { a: "hello", n: "Max" });
net4.handle("eva", { a: "hello", n: "Eva" });
net4.handle("max", { a: "create", t: "240" });
net4.handle("eva", { a: "join", g: net4.lobby.listOpenGames()[0].id });
net4._now.t = 240001;
msgs = net4.tick(240001);
ok(msgs.some(function (m) { return m.xml.indexOf('t="end"') >= 0; }), "net: clock timeout ends the game via tick");
eq(Object.keys(net4.sessions).length, 0, "net: timed-out session cleaned up");

console.log("bandas server tests: " + passed + " passed, " + fails + " failed");
process.exit(fails ? 1 : 0);
