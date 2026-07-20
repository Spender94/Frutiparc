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
var net = new N.GrapizNet({ clock: function () { return CLOCK; }, withBots: false });

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
var nb = new N.GrapizNet({ clock: function () { return 0; }, withBots: false });
nb.handle("u1", { a: "hello", n: "U1", f: "0d0000010000000000000000" });
nb.handle("u2", { a: "hello", n: "U2", f: "0f0000010000000000000000" });
nb.handle("u1", { a: "create" });
var gidb = nb.lobby.listOpenGames()[0].id;
var stb = find(nb.handle("u2", { a: "join", g: gidb }), "start");
ok(stb && stb.xml.indexOf('f="0d0000010000000000000000"') >= 0, "start carries player 1 bouille");
ok(stb && stb.xml.indexOf('f="0f0000010000000000000000"') >= 0, "start carries player 2 bouille");

// ── Défi direct → la partie démarre IMMÉDIATEMENT (sans validation) ─────────
var net2 = new N.GrapizNet({ clock: function () { return CLOCK; }, withBots: false });
net2.handle("a", { a: "hello", n: "A" });
net2.handle("b", { a: "hello", n: "B" });
var chal = net2.handle("a", { a: "challenge", u: "b" });
var st2 = find(chal, "start");
ok(st2, "challenge starts the game right away (no accept)");
ok(st2 && toHas(st2, "a") && toHas(st2, "b"), "start sent to both players");
ok(net2.lobby.getPlayer("a").status === "playing" && net2.lobby.getPlayer("b").status === "playing", "both players now playing");

// ── Déconnexion en cours de partie → fin + nettoyage ────────────────────────
var dc = net.onDisconnect("alice");
ok(find(dc, "end"), "disconnect ends the running game");
ok(!net.sessions[gameId], "session cleaned up after disconnect");
ok(net.lobby.getPlayer("bob") && net.lobby.getPlayer("bob").status === "idle", "opponent freed");

// ── Timeout via tick ────────────────────────────────────────────────────────
var net3 = new N.GrapizNet({ clock: function () { return CLOCK; }, withBots: false });
net3.handle("x", { a: "hello" }); net3.handle("y", { a: "hello" });
CLOCK = 0;
var g3 = net3.handle("x", { a: "create", t: "3000" });
var gid3 = net3.lobby.listOpenGames()[0].id;
net3.handle("y", { a: "join", g: gid3 });
CLOCK = 4000;
var tick = net3.tick(4000);
ok(find(tick, "end"), "tick ends a timed-out game");
ok(!net3.sessions[gid3], "timed-out session cleaned up");

// ── Séries de victoires (challenge) : +1 au gagnant, série enregistrée puis 0 ─
var streakLog = [];
var seeds = { w: 2, l: 5 };
var ns = new N.GrapizNet({
  clock: function () { return 0; }, withBots: false,
  getStreak: function (u) { return seeds[u] || 0; },
  onStreak: function (u, s, info) { streakLog.push({ u: u, s: s, series: info.series }); },
});
ns.handle("w", { a: "hello" }); ns.handle("l", { a: "hello" });
ns.handle("w", { a: "create" });
var gidS = ns.lobby.listOpenGames()[0].id;
ns.handle("l", { a: "join", g: gidS });          // partie démarre (w=équipe 0, l=équipe 1)
var endMsgs = ns.handle("l", { a: "part" });      // l abandonne → w gagne
ok(find(endMsgs, "end"), "forfeit conclut la partie");
eq(ns.streaks["w"], 3, "série du gagnant +1 (2→3)");
eq(ns.streaks["l"], 0, "série du perdant remise à 0");
var wl = streakLog.filter(function (x) { return x.u === "w"; })[0];
var ll = streakLog.filter(function (x) { return x.u === "l"; })[0];
ok(wl && wl.s === 3, "onStreak gagnant : nouvelle série 3");
ok(ll && ll.series === 5 && ll.s === 0, "onStreak perdant : série terminée 5 enregistrée, remise 0");
ok(find(endMsgs, "end").xml.indexOf('sr="3"') >= 0, "l'état final porte la série à jour (sr=3)");

// ── Quitter Grapiz (hors partie) clôt la série + retire du lobby ─────────────
var ended2 = null;
var net4 = new N.GrapizNet({ clock: function () { return 0; }, withBots: false, getStreak: function () { return 4; }, onStreak: function (u, s, info) { ended2 = { u: u, s: s, series: info.series }; } });
net4.handle("z", { a: "hello" });    // z arrive avec une série de 4
net4.handle("w2", { a: "hello" });   // témoin (doit recevoir la liste à jour)
eq(net4.streaks["z"], 4, "série de départ seedée (4)");
var dc2 = net4.onDisconnect("z");    // z quitte (hors partie)
ok(net4.streaks["z"] === undefined, "série mémoire nettoyée à la déconnexion");
ok(ended2 && ended2.u === "z" && ended2.s === 0 && ended2.series === 4, "série clôturée : 4 enregistrée, remise à 0");
ok(!net4.lobby.getPlayer("z"), "joueur retiré du lobby");
ok(find(dc2, "lobby") && toHas(find(dc2, "lobby"), "w2"), "liste rediffusée aux autres joueurs");

// ── Bots : présents au lobby, défi instantané, coups joués par le tick ──────
var CL = 0;
var nbot = new N.GrapizNet({ clock: function () { return CL; } });   // bots ACTIVÉS
var bots = nbot.lobby.listPlayers().filter(function (p) { return nbot.bots[p.id]; });
ok(bots.length >= 1, "des bots sont présents dans le lobby (" + bots.length + ")");
ok(nbot._lobbyXml().indexOf('bot="1"') >= 0, "les bots sont marqués bot=1 dans la liste");
nbot.handle("human", { a: "hello" });
var st = find(nbot.handle("human", { a: "challenge", u: bots[0].id }), "start");
ok(st, "défier un bot démarre la partie immédiatement");
var ses = nbot.sessions[Object.keys(nbot.sessions)[0]];
eq(ses.teamOf(bots[0].id), 1, "le bot est l'équipe 1");
var lm = ses.game.legalMoves(0)[0];
nbot.handle("human", { a: "move", x: String(lm.from.x), y: String(lm.from.y), d: String(lm.direction) });
eq(ses.game.currentTurn, 1, "après le coup du joueur, c'est au tour du bot");
CL = 5000; nbot.tick(5000);                          // 1er tick : planifie le coup du bot
ok(ses._botAt != null, "le coup du bot est planifié (délai naturel)");
CL = 12000; nbot.tick(12000);                        // 2e tick : exécute le coup
ok(!nbot.sessions[ses.id] || nbot.sessions[ses.id].game.currentTurn === 0, "le bot a joué (tour rendu au joueur) ou partie conclue");

// ── Règles de la série classée : « bots libres, humains classés » ────────────
// (1) Les matchs contre un BOT sont des ENTRAÎNEMENTS : jamais classés. Ils ne
//     touchent pas la série classée du joueur (ni ne la font monter, ni ne la
//     cassent) et ne sont jamais persistés.
var botLog = [];
var nb = new N.GrapizNet({ clock: function () { return 0; }, onStreak: function (u, s, info) { botLog.push({ u: u, s: s, series: info.series }); } });
nb.handle("grimpeur", { a: "hello", n: "Grimpeur" });
nb.handle("rival", { a: "hello", n: "Rival" });
// grimpeur bat un HUMAIN → série CLASSÉE = 1 (persistée)
nb.handle("grimpeur", { a: "challenge", u: "rival", t: "60000" });
nb.handle("rival", { a: "part" });                                 // rival abandonne → grimpeur gagne
eq(nb.streaks["grimpeur"], 1, "battre un HUMAIN fait monter la série classée (1)");
ok(botLog.some(function (x) { return x.u === "grimpeur" && x.series === 1; }), "la victoire contre un humain est classée (series=1)");
botLog.length = 0;
function beatsBot(bot) {
  nb.handle("grimpeur", { a: "challenge", u: bot, t: "60000" });
  nb.handle(bot, { a: "part" });                                  // le bot abandonne → victoire
}
beatsBot("pepino");
eq(nb.streaks["grimpeur"], 1, "battre un bot ne change PAS la série classée (reste 1 — entraînement)");
beatsBot("mirabo");
eq(nb.streaks["grimpeur"], 1, "enchaîner les bots ne fait pas monter la série classée");
// perdre contre un bot ne CASSE PAS la série classée (l'entraînement est sans risque)
nb.handle("grimpeur", { a: "challenge", u: "cassis", t: "60000" });
nb.handle("grimpeur", { a: "part" });                              // le joueur abandonne → le bot gagne
eq(nb.streaks["grimpeur"], 1, "perdre contre un bot ne casse pas la série classée (entraînement)");
ok(botLog.length === 0, "aucun match contre un bot n'est classé/persisté");
ok(!botLog.some(function (x) { return x.u === "pepino" || x.u === "mirabo" || x.u === "cassis"; }), "les séries des bots ne sont jamais persistées/classées");

// (2) Rebattre le MÊME humain ne compte qu'une fois ; il faut des adversaires différents.
var nh = new N.GrapizNet({ clock: function () { return 0; }, withBots: false });
nh.handle("pro", { a: "hello", n: "Pro" });
nh.handle("victimA", { a: "hello", n: "VictimA" });
nh.handle("victimB", { a: "hello", n: "VictimB" });
function proBeats(loser) {
  nh.handle("pro", { a: "create", t: "60000" });
  var gid = nh.lobby.listOpenGames()[0].id;
  nh.handle(loser, { a: "join", g: gid });   // la partie démarre (pro=équipe 0, loser=équipe 1)
  nh.handle(loser, { a: "part" });           // loser abandonne → pro gagne
}
proBeats("victimA"); eq(nh.streaks["pro"], 1, "1re victoire (A neuf) → série 1");
proBeats("victimA"); eq(nh.streaks["pro"], 1, "rebattre A → série inchangée (anti-farm alt/complice)");
proBeats("victimB"); eq(nh.streaks["pro"], 2, "battre B (neuf) → série 2");
// Après une défaite, le set des adversaires battus se vide : on peut rebattre A.
nh.handle("victimB", { a: "create", t: "60000" });
var gidLose = nh.lobby.listOpenGames()[0].id;
nh.handle("pro", { a: "join", g: gidLose });
nh.handle("pro", { a: "part" });             // pro abandonne → série de pro retombe à 0
eq(nh.streaks["pro"], 0, "défaite → série de pro à 0");
proBeats("victimA"); eq(nh.streaks["pro"], 1, "après reset, rebattre A compte de nouveau (série 1)");

// ── Portillon FD (« bots libres, humains classés ») ──────────────────────────
// Un match ENTRE HUMAINS consomme 1 FD par joueur au démarrage et est refusé si
// un joueur est à sec. Le mock reproduit le contrat de fdConsumeForRankedMatch
// (serveur) : vérifie que TOUS ont un FD, puis débite ; sinon { ok:false,
// blocked:[à sec] } sans rien débiter.
var fdBudget = { pro2: 2, novice: 2 };
function fdGate(humans) {
  var blocked = humans.filter(function (u) { return (fdBudget[u] || 0) <= 0; });
  if (blocked.length) return { ok: false, blocked: blocked };
  humans.forEach(function (u) { fdBudget[u] -= 1; });
  return { ok: true };
}
var ng = new N.GrapizNet({ clock: function () { return 0; }, withBots: false, onRankedMatchStart: fdGate });
ng.handle("pro2", { a: "hello", n: "Pro2" });
ng.handle("novice", { a: "hello", n: "Novice" });
function humanDuel() { return ng.handle("pro2", { a: "challenge", u: "novice", t: "60000" }); }
var d1 = humanDuel();
ok(find(d1, "start"), "match humain #1 démarre (FD dispo)");
ok(fdBudget.pro2 === 1 && fdBudget.novice === 1, "match #1 : 1 FD consommé par joueur");
ng.handle("novice", { a: "part" });                    // fin du match → lobby libéré
var d2 = humanDuel();
ok(find(d2, "start"), "match humain #2 démarre (2e FD)");
ok(fdBudget.pro2 === 0 && fdBudget.novice === 0, "match #2 : 2e FD consommé par joueur");
ng.handle("novice", { a: "part" });
var d3 = humanDuel();
ok(!find(d3, "start"), "match humain #3 refusé (plus de FD)");
var err3 = find(d3, "err");
ok(err3 && err3.xml.indexOf('m="no-fd"') >= 0, "refus : err no-fd renvoyé");
ok(ng.lobby.getPlayer("pro2").status === "idle" && ng.lobby.getPlayer("novice").status === "idle", "refus : les 2 joueurs reviennent idle (lobby libéré)");
ok(fdBudget.pro2 === 0 && fdBudget.novice === 0, "refus : aucun FD débité en plus (débit atomique)");

// opp-no-fd : l'ADVERSAIRE est à sec → refus, et le joueur avec FD n'est pas débité.
var fdB2 = { rich: 2, broke: 0 };
function fdGate2(humans) {
  var blocked = humans.filter(function (u) { return (fdB2[u] || 0) <= 0; });
  if (blocked.length) return { ok: false, blocked: blocked };
  humans.forEach(function (u) { fdB2[u] -= 1; });
  return { ok: true };
}
var ng2 = new N.GrapizNet({ clock: function () { return 0; }, withBots: false, onRankedMatchStart: fdGate2 });
ng2.handle("rich", { a: "hello" }); ng2.handle("broke", { a: "hello" });
var od = ng2.handle("rich", { a: "challenge", u: "broke", t: "60000" });
ok(!find(od, "start"), "match refusé si l'adversaire est à sec");
var richMsg = od.filter(function (m) { return m.to.indexOf("rich") >= 0 && m.xml.indexOf('e="err"') >= 0; })[0];
var brokeMsg = od.filter(function (m) { return m.to.indexOf("broke") >= 0 && m.xml.indexOf('e="err"') >= 0; })[0];
ok(richMsg && richMsg.xml.indexOf('m="opp-no-fd"') >= 0, "le joueur avec FD reçoit opp-no-fd");
ok(brokeMsg && brokeMsg.xml.indexOf('m="no-fd"') >= 0, "le joueur à sec reçoit no-fd");
ok(fdB2.rich === 2, "aucun FD débité au joueur riche (refus atomique)");

// Un match contre un BOT n'est JAMAIS rationné : onRankedMatchStart n'est pas consulté.
var gateCalls = 0;
var ngb = new N.GrapizNet({ clock: function () { return 0; }, onRankedMatchStart: function (h) { gateCalls++; return { ok: false, blocked: h }; } });
ngb.handle("solo", { a: "hello" });
var botList = ngb.lobby.listPlayers().filter(function (p) { return ngb.bots[p.id]; });
var bm = ngb.handle("solo", { a: "challenge", u: botList[0].id, t: "60000" });
ok(find(bm, "start"), "défier un bot démarre même avec un portillon FD bloquant");
eq(gateCalls, 0, "le portillon FD n'est PAS consulté pour un match avec bot (entraînement libre)");

console.log("\nGrapiz net: " + passed + " passed, " + fails + " failed.");
process.exit(fails ? 1 : 0);
