//
// Tests des cœurs serveur Grapiz (node public/grapiz/server/server.test.js) :
// Session (horloges, timeout, abandon, relais des coups) + Lobby (appariements).
//
var E = require("../engine.js");
var S = require("./session.js");
var L = require("./lobby.js");
var DIR = E.DIR;

var fails = 0, passed = 0;
function ok(c, m) { if (c) passed++; else { fails++; console.log("  ✗ FAIL: " + m); } }
function eq(a, b, m) { ok(a === b, m + " (got " + a + ", want " + b + ")"); }

// ══ SESSION ════════════════════════════════════════════════════════════════
var sess = new S.GrapizSession({
  id: "s1", players: [{ id: "p0", name: "alice" }, { id: "p1", name: "bob" }],
  params: { time: 60000, boardSize: 4 }, now: 0,
});
var snap = sess.snapshot(0);
eq(snap.board.length, 18, "session: 18 tokens at start");
eq(snap.currentTurn, 0, "session: team 0 starts");
eq(snap.players[0].remaining, 60000, "session: clock starts full");
eq(sess.teamOf("p1"), 1, "session: team lookup");

// mauvais tour / non-joueur
ok(!sess.requestMove("p1", 0, 0, DIR.N, 100).ok, "session: reject move out of turn");
eq(sess.requestMove("nobody", 0, 0, DIR.N, 100).error, "not-a-player", "session: reject non-player");

// coup légal → tour avance, horloge du joueur 0 décomptée
var lm = sess.game.legalMoves(0)[0];
var mv = sess.requestMove("p0", lm.from.x, lm.from.y, lm.direction, 1500);
ok(mv.ok, "session: legal move accepted");
eq(sess.game.currentTurn, 1, "session: turn advances to 1");
eq(mv.clocks[0], 58500, "session: 1500ms charged to player 0");
eq(mv.clocks[1], 60000, "session: player 1 clock untouched");

// timeout : le joueur actif (1) dépasse son temps
var sess2 = new S.GrapizSession({ id: "s2", players: [{ id: "a" }, { id: "b" }], params: { time: 5000 }, now: 0 });
ok(sess2.tick(1000) === null, "session: no timeout before the clock runs out");
var to = sess2.tick(5001);
ok(to && to.ended, "session: timeout ends the game");
eq(to.winner, 1, "session: opponent (1) wins on team 0 timeout");
eq(to.reason, "timeout", "session: end reason = timeout");

// abandon
var sess3 = new S.GrapizSession({ id: "s3", players: [{ id: "a" }, { id: "b" }], params: { time: 5000 }, now: 0 });
var ff = sess3.forfeit("a");
ok(ff && ff.ended && ff.winner === 1, "session: forfeit gives the win to the opponent");
eq(ff.reason, "forfeit", "session: end reason = forfeit");

// victoire par capture/élimination à travers la session
var sess4 = new S.GrapizSession({
  id: "s4", players: [{ id: "p0" }, { id: "p1" }], params: { time: 60000 }, now: 0,
  board: E.Board.fromDefinition({ size: 3, tokens: [{ t: 0, x: 3, y: 3 }, { t: 1, x: 3, y: 5 }] }),
});
var cap = sess4.requestMove("p0", 3, 3, DIR.SE, 1000);
ok(cap.ok && cap.ended, "session: capture move ends the game");
eq(cap.winner, 0, "session: mover (0) wins by elimination");

// ══ LOBBY ══════════════════════════════════════════════════════════════════
// Parties ouvertes (salons) : créer → rejoindre → démarrer
var lob = new L.GrapizLobby();
lob.addPlayer("p1", "alice"); lob.addPlayer("p2", "bob"); lob.addPlayer("p3", "carol");
eq(lob.listPlayers().length, 3, "lobby: 3 players registered");
var cg = lob.createGame("p1", { time: 60000 });
ok(cg.ok, "lobby: create open game");
eq(lob.getPlayer("p1").status, "waiting", "lobby: host is waiting");
eq(lob.listOpenGames().length, 1, "lobby: one open game listed");
var jg = lob.joinGame("p2", cg.gameId);
ok(jg.ok && jg.started, "lobby: joining a 2-player game starts it");
eq(lob.getPlayer("p1").status, "playing", "lobby: host now playing");
eq(lob.getPlayer("p2").status, "playing", "lobby: joiner now playing");
eq(lob.listOpenGames().length, 0, "lobby: started game no longer open");
ok(!lob.createGame("p1").ok, "lobby: busy player cannot create");

// fin de partie → joueurs libérés
var eg = lob.endGame(cg.gameId);
ok(eg.ok, "lobby: end game");
eq(lob.getPlayer("p1").status, "idle", "lobby: players idle after game ends");

// Défis directs
var lob2 = new L.GrapizLobby();
lob2.addPlayer("a", "A"); lob2.addPlayer("b", "B");
var ch = lob2.challenge("a", "b", { time: 60000 });
ok(ch.ok && ch.notify[0] === "b", "lobby: challenge notifies target");
ok(!lob2.challenge("a", "a").ok, "lobby: cannot self-challenge");
var ac = lob2.acceptChallenge("b", ch.challengeId);
ok(ac.ok && ac.game.players.length === 2, "lobby: accepted challenge creates a 2-player game");
eq(lob2.getPlayer("a").status, "playing", "lobby: challenger now playing");

// Refus
var lob3 = new L.GrapizLobby();
lob3.addPlayer("a"); lob3.addPlayer("b");
var ch3 = lob3.challenge("a", "b");
var dc = lob3.declineChallenge("b", ch3.challengeId);
ok(dc.ok && dc.notify[0] === "a", "lobby: decline notifies challenger");
ok(!lob3.acceptChallenge("b", ch3.challengeId).ok, "lobby: declined challenge is gone");

// Déconnexion : annule la partie ouverte hébergée + libère le participant
var lob4 = new L.GrapizLobby();
lob4.addPlayer("h", "host"); lob4.addPlayer("j", "joiner");
var g4 = lob4.createGame("h");
lob4.joinGame("j", g4.gameId); // 2P → démarre… non, nbrPlayers défaut 2 → démarre
// recréons un cas "open" non démarré (3 joueurs requis)
var lob5 = new L.GrapizLobby();
lob5.addPlayer("h"); lob5.addPlayer("j");
var g5 = lob5.createGame("h", { nbrPlayers: 3 });
lob5.joinGame("j", g5.gameId);
ok(lob5.listOpenGames().length === 1, "lobby: 3-player game stays open with 2");
var rm = lob5.removePlayer("h"); // l'hôte se déconnecte
ok(rm.ok && rm.cancelledGameId === g5.gameId, "lobby: host disconnect cancels the open game");
eq(lob5.getPlayer("j").status, "idle", "lobby: joiner freed after host leaves");
eq(lob5.listOpenGames().length, 0, "lobby: cancelled game removed");

// Déconnexion pendant une partie → signale le forfait au transport
var rm2 = lob4.removePlayer("h");
ok(rm2.playingGameId === g4.gameId, "lobby: disconnect during play reports the playing game id");

console.log("\nGrapiz server cores: " + passed + " passed, " + fails + " failed.");
process.exit(fails ? 1 : 0);
