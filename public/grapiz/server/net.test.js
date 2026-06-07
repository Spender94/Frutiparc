//
// Tests du pont réseau (node public/grapiz/server/net.test.js).
// Simule deux joueurs à travers GrapizNet sans aucun socket.
//
var E = require("../engine.js");
var N = require("./net.js");

var fails = 0, passed = 0;
function ok(c, m) { if (c) passed++; else { fails++; console.log("  ✗ FAIL: " + m); } }
function eq(a, b, m) { ok(a === b, m + " (got " + a + ", want " + b + ")"); }
function find(msgs, evt) { return msgs.find(function (m) { return m.xml.indexOf('e="' + evt + '"') >= 0; }); }
function toHas(msg, u) { return msg && msg.to.indexOf(u) >= 0; }

var CLOCK = 0;
var net = new N.GrapizNet({ clock: function () { return CLOCK; } });

// hello des deux joueurs
var h1 = net.handle("alice", { a: "hello", n: "Alice" });
ok(find(h1, "lobby"), "hello: lobby pushed");
net.handle("bob", { a: "hello", n: "Bob" });
eq(net.lobby.listPlayers().length, 2, "two players registered");

// création d'un salon
var c = net.handle("alice", { a: "create", t: "60000" });
ok(find(c, "lobby") && toHas(find(c, "lobby"), "bob"), "create: lobby broadcast to all");
var gameId = net.lobby.listOpenGames()[0].id;
ok(gameId, "an open game exists");

// bob rejoint → la partie démarre
var j = net.handle("bob", { a: "join", g: gameId });
var startMsg = find(j, "start");
ok(startMsg, "join: start event emitted");
ok(toHas(startMsg, "alice") && toHas(startMsg, "bob"), "start sent to both players");
ok(startMsg.xml.indexOf("<t ") >= 0, "start carries the board tokens");
ok(net.sessions[gameId], "a session was created");
eq(net.lobby.listOpenGames().length, 0, "started game no longer open");

// mauvais tour : bob (équipe 1) ne peut pas jouer en premier
var badTurn = net.handle("bob", { a: "move", x: "0", y: "0", d: "0" });
ok(find(badTurn, "err"), "move out of turn → error");

// alice (équipe 0) joue un coup légal
var sess = net.sessions[gameId];
var lm = sess.game.legalMoves(0)[0];
CLOCK = 2000;
var mv = net.handle("alice", { a: "move", x: String(lm.from.x), y: String(lm.from.y), d: String(lm.direction) });
var mvMsg = find(mv, "move");
ok(mvMsg && toHas(mvMsg, "alice") && toHas(mvMsg, "bob"), "move broadcast to both");
eq(sess.game.currentTurn, 1, "turn passed to bob");
ok(mvMsg.xml.indexOf('turn="1"') >= 0, "move state reports turn 1");

// non-joueur
ok(find(net.handle("carol", { a: "move", x: "0", y: "0", d: "0" }), "err"), "stranger move → error");

// ── Bouilles : transmises via hello → présentes dans l'état de partie ────────
var nb = new N.GrapizNet({ clock: function () { return 0; } });
nb.handle("u1", { a: "hello", n: "U1", f: "0d0000010000000000000000" });
nb.handle("u2", { a: "hello", n: "U2", f: "0f0000010000000000000000" });
nb.handle("u1", { a: "create" });
var gidb = nb.lobby.listOpenGames()[0].id;
var stb = find(nb.handle("u2", { a: "join", g: gidb }), "start");
ok(stb && stb.xml.indexOf('f="0d0000010000000000000000"') >= 0, "start carries player 1 bouille");
ok(stb && stb.xml.indexOf('f="0f0000010000000000000000"') >= 0, "start carries player 2 bouille");

// ── Défi direct ─────────────────────────────────────────────────────────────
var net2 = new N.GrapizNet({ clock: function () { return CLOCK; } });
net2.handle("a", { a: "hello", n: "A" });
net2.handle("b", { a: "hello", n: "B" });
var chal = net2.handle("a", { a: "challenge", u: "b" });
var chMsg = find(chal, "challenged");
ok(chMsg && toHas(chMsg, "b"), "challenge notifies the target");
var cid = net2.lobby.challenges[Object.keys(net2.lobby.challenges)[0]].id;
var acc = net2.handle("b", { a: "accept", c: cid });
ok(find(acc, "start"), "accepting a challenge starts a game");

// ── Déconnexion en cours de partie → fin + nettoyage ────────────────────────
var dc = net.onDisconnect("alice");
ok(find(dc, "end"), "disconnect ends the running game");
ok(!net.sessions[gameId], "session cleaned up after disconnect");
ok(net.lobby.getPlayer("bob") && net.lobby.getPlayer("bob").status === "idle", "opponent freed");

// ── Timeout via tick ────────────────────────────────────────────────────────
var net3 = new N.GrapizNet({ clock: function () { return CLOCK; } });
net3.handle("x", { a: "hello" }); net3.handle("y", { a: "hello" });
CLOCK = 0;
var g3 = net3.handle("x", { a: "create", t: "3000" });
var gid3 = net3.lobby.listOpenGames()[0].id;
net3.handle("y", { a: "join", g: gid3 });
CLOCK = 4000;
var tick = net3.tick(4000);
ok(find(tick, "end"), "tick ends a timed-out game");
ok(!net3.sessions[gid3], "timed-out session cleaned up");

console.log("\nGrapiz net: " + passed + " passed, " + fails + " failed.");
process.exit(fails ? 1 : 0);
