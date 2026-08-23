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

// Deux cartes au pot, une chacun : p0 pioche en premier, donc c'est p1 qui
// ouvre la partie (voir game.js, chooseCard).
eq(sess.game.currentTeam, 1, "session: second drafter opens");
r = sess.requestMove("p1", DIR.RIGHT, 3000);
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
eq(dp.cards, 3, "lobby: bad cards falls back to default (3 = le compte d'origine)");

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
eq(theSess.game.hands[0].length, 3, "net: 3 cards drafted for team 0");

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

// ── Portillon FD « DISQUE = VIE » ────────────────────────────────────────────
// 2 disques : on garde son disque tant qu'on gagne, on le perd à chaque défaite.
// À 0 disque : plus de match entre humains (refus), seulement des bots non classés.
// Le mock reproduit le contrat serveur (fdMatchForming + fdConsumeDisc).
var startsWith = function (msgs, evt) { return msgs.some(function (m) { return m.xml.indexOf('e="' + evt + '"') >= 0; }); };
var discs = {};
function forming(humans, ctx) {
  var withDisc = function (u) { return (discs[u] || 0) > 0; };
  if (!ctx.hasBot && humans.length >= 2) {
    var blocked = humans.filter(function (u) { return !withDisc(u); });
    if (blocked.length) return { ok: false, blocked: blocked };
    var r = {}; humans.forEach(function (u) { r[u] = true; }); return { ok: true, ranked: r };
  }
  var r2 = {}; humans.forEach(function (u) { r2[u] = withDisc(u); }); return { ok: true, ranked: r2 };
}
function discLost(u) { if (discs[u] > 0) discs[u] -= 1; }
var bslog = [];
var nfd = new N.BandasNet({ clock: function () { return 0; }, rng: seeded(7), onMatchForming: forming, onDiscLost: discLost, onStreak: function (u, s, info) { bslog.push({ u: u, s: s, series: info.series }); } });
discs.rob = 2; discs.lea = 2;
nfd.handle("rob", { a: "hello", n: "Rob" });
nfd.handle("lea", { a: "hello", n: "Lea" });
var bbots = nfd.lobby.listPlayers().filter(function (p) { return nfd.bots[p.id]; }).map(function (p) { return p.id; });

// (a) battre un bot : la série monte, AUCUN disque perdu.
nfd.handle("rob", { a: "challenge", u: bbots[0] });
nfd.handle(bbots[0], { a: "part" });                        // bot abandonne → rob gagne
eq(nfd.streaks["rob"], 1, "bandas: battre un bot fait monter la série (classé avec un disque)");
eq(discs.rob, 2, "bandas: gagner ne coûte AUCUN disque");
// (b) perdre contre un bot : la série tombe, UN disque perdu.
nfd.handle("rob", { a: "challenge", u: bbots[1] });
nfd.handle("rob", { a: "part" });                           // rob abandonne → bot gagne
eq(nfd.streaks["rob"], 0, "bandas: perdre remet la série à 0");
eq(discs.rob, 1, "bandas: perdre coûte UN disque");
// (c) perdre encore → 0 disque.
nfd.handle("rob", { a: "challenge", u: bbots[0] });
nfd.handle("rob", { a: "part" });
eq(discs.rob, 0, "bandas: 2e défaite → 0 disque");
// (d) à 0 disque : match ENTRE HUMAINS refusé (no-fd pour rob, opp-no-fd pour lea).
var refused = nfd.handle("rob", { a: "challenge", u: "lea" });
ok(!startsWith(refused, "start"), "bandas: 0 disque → match entre humains refusé");
var robErr = refused.filter(function (m) { return m.to.indexOf("rob") >= 0 && m.xml.indexOf('e="err"') >= 0; })[0];
var leaErr = refused.filter(function (m) { return m.to.indexOf("lea") >= 0 && m.xml.indexOf('e="err"') >= 0; })[0];
ok(robErr && robErr.xml.indexOf('m="no-fd"') >= 0, "bandas: rob (à sec) reçoit no-fd");
ok(leaErr && leaErr.xml.indexOf('m="opp-no-fd"') >= 0, "bandas: lea (avec disque) reçoit opp-no-fd");
ok(nfd.lobby.getPlayer("lea").status === "idle", "bandas: refus → lea reste idle (lobby libéré)");
// (e) à 0 disque : jouer un BOT reste possible mais NON classé.
bslog.length = 0;
nfd.handle("rob", { a: "challenge", u: bbots[0] });
nfd.handle(bbots[0], { a: "part" });                        // rob bat le bot
eq(nfd.streaks["rob"], 0, "bandas: 0 disque → battre un bot ne classe rien (série reste 0)");
eq(discs.rob, 0, "bandas: 0 disque → aucun disque en jeu");
ok(!bslog.some(function (x) { return x.u === "rob"; }), "bandas: 0 disque → rien n'est persisté pour rob");
// (f) 2 humains avec disques : le perdant perd un disque, le gagnant garde le sien.
discs.gwen = 2; discs.hugo = 2;
nfd.handle("gwen", { a: "hello" }); nfd.handle("hugo", { a: "hello" });
nfd.handle("gwen", { a: "challenge", u: "hugo" });
nfd.handle("hugo", { a: "part" });                          // hugo abandonne → gwen gagne
eq(nfd.streaks["gwen"], 1, "bandas: match humain → le gagnant monte sa série");
eq(discs.gwen, 2, "bandas: le gagnant garde son disque");
eq(discs.hugo, 1, "bandas: le perdant perd un disque");


// ── Ce que l'IA a appris ────────────────────────────────────────────────────
// Le cœur du jeu : Board.moveSprite ne tue que si la destination sort du
// plateau. Un fruit du centre, avec du vide devant lui, ne meurt jamais de son
// propre mouvement ; un fruit collé au bord vers lequel on avance, si. D'où
// l'ÉCOLE DU CENTRE : le bloc principal à plein prix, les pions écartés
// décotés (sacrifiables), et la position du bloc qui peut peser plus lourd
// qu'un fruit.

// Antisymétrie : sans elle, le négamax raconte n'importe quoi.
var bs = mk(["0011", "0011", "....", "...."]);
ok(Math.abs(Bot.evaluate(bs, 0) + Bot.evaluate(bs, 1)) < 1e-9, "bot: évaluation antisymétrique");

// Un bloc serré au centre vaut mieux que le même nombre de fruits éparpillés
// sur les bords — à matériel ÉGAL.
var bloc = mk([".....", ".00..", ".00..", ".....", "....1"]);
var eparpille = mk(["0...0", ".....", ".....", ".....", "0...1"]);
// (4 fruits contre 1 dans les deux cas)
eq(bloc.countSpritesOf(0), 4, "bot: le bloc compte 4 fruits");
eq(eparpille.countSpritesOf(0), 3, "bot: l'éparpillement en compte 3");
var serre = mk([".....", ".00..", ".00..", ".....", "....1"]);
var lache = mk(["0...0", ".....", "..0..", ".....", "0...1"]);
eq(lache.countSpritesOf(0), 4, "bot: même matériel");
ok(Bot.evaluate(serre, 0) > Bot.evaluate(lache, 0),
  "bot: à matériel égal, le bloc central l'emporte sur l'éparpillement");

// La profondeur EST le niveau : un bot fort regarde plus loin.
ok(Bot.depthFor(1.0) > Bot.depthFor(0.45), "bot: le niveau fort cherche plus profond");

// Un bot fort ne se trompe pas de direction quand un coup gagne sur-le-champ.
// 0 est collé à 1, qui est lui-même contre le bord droit : pousser à DROITE
// éjecte 1 du plateau et gagne sur-le-champ.
var gagnant = mk(["..01", "....", "....", "...."]);
eq(Bot.chooseMove(gagnant, 0, 1.0, seeded(11)), DIR.RIGHT,
  "bot: pousse l'adversaire dehors quand il le peut");

// Et la nouvelle IA bat l'ancienne heuristique (différentiel matériel seul,
// profondeur 1) : 20 parties, couleurs alternées.
function evalMateriel(board, team) {
  var my = board.countSpritesOf(team), op = board.countSpritesOf(1 - team);
  if (my <= 0 && op <= 0) return 0;
  if (my <= 0) return -100000;
  if (op <= 0) return 100000;
  return (my - op) * 100;
}
function coupMateriel(board, team) {
  var best = null, bestV = -Infinity;
  [DIR.UP, DIR.RIGHT, DIR.DOWN, DIR.LEFT].forEach(function (d) {
    var b = board.clone(); b.move(team, d); b.removeEmptyBorders(); b.takeTrapHits();
    var v = evalMateriel(b, team);
    if (v > bestV) { bestV = v; best = d; }
  });
  return best;
}
var victoires = 0, defaites = 0;
for (var p = 0; p < 20; p++) {
  var rng = seeded(p + 1);
  var partie = new G.BandasGame({ size: 8, cardsPerPlayer: 0, rng: rng });
  var iaEnA = (p % 2 === 0);
  var tours = 0;
  while (!partie.ended && tours < 400) {
    tours++;
    var t = partie.currentTeam;
    var estIA = (t === 0) === iaEnA;
    partie.move(t, estIA ? Bot.chooseMove(partie.board, t, 1.0, rng) : coupMateriel(partie.board, t));
  }
  if (partie.winner === 0 || partie.winner === 1) {
    if ((partie.winner === 0) === iaEnA) victoires++; else defaites++;
  }
}
ok(victoires > defaites * 2, "bot: la nouvelle IA domine le simple différentiel matériel ("
  + victoires + " – " + defaites + ")");

// ── L'école du centre ───────────────────────────────────────────────────────
// LE CONTRÔLE DU CENTRE IMPORTE PLUS QUE LE MATÉRIEL : quatre fruits en carré
// central valent plus que CINQ fruits éparpillés sur les bords. C'est ce qui
// autorise le bot à supprimer lui-même ses pions des côtés pour souder le bloc.
var carre = mk([".......", ".......", "..00...", "..00...", ".......", ".......", "......1"]);
var epars = mk(["0.....0", ".......", "...0...", ".......", "0......", ".......", "0.....1"]);
eq(carre.countSpritesOf(0), 4, "école: le carré compte 4 fruits");
eq(epars.countSpritesOf(0), 5, "école: l'éparpillement en compte 5");
ok(Bot.evaluate(carre, 0) > Bot.evaluate(epars, 0),
  "école: 4 fruits en bloc central > 5 fruits éparpillés — le centre avant le matériel");

// La profondeur suit le niveau jusqu'à 6 demi-coups (l'alpha-bêta les paie) :
// c'est elle qui convertit le bloc en victoires.
eq(Bot.depthFor(0.45), 2, "école: le bas de la plage reste battable");
eq(Bot.depthFor(0.9), 5, "école: un bon niveau voit cinq demi-coups");
eq(Bot.depthFor(0.97), 6, "école: le meilleur niveau en voit six");

// Le draft suit la doctrine : vachette, renfort, célérité, désordre d'abord.
eq(Bot.chooseDraft([CARD.ENCLUME, CARD.RENFORT], 1.0, seeded(3)), CARD.RENFORT,
  "école: renfort piochée avant enclume");
eq(Bot.chooseDraft([CARD.CONVERSION, CARD.DESORDRE], 1.0, seeded(3)), CARD.DESORDRE,
  "école: désordre piochée avant conversion");
eq(Bot.chooseDraft([CARD.ENCLUME, CARD.CELERITE], 1.0, seeded(3)), CARD.CELERITE,
  "école: célérité piochée avant enclume");

// La CONFISCATION se joue au moment opportun — la main adverse est publique
// depuis le draft. Une vachette adverse mérite la fenêtre ; un entracte, non ;
// une main vide, jamais. (Plateau calme, assez de fruits pour qu'aucune
// clause de fin de partie ne brouille la lecture.)
function partieCartes(board, mainMoi, mainLui) {
  var g = new G.BandasGame({ board: board, pool: [], firstTeam: 0 });
  g.hands[0] = mainMoi.slice(); g.hands[1] = mainLui.slice();
  return g;
}
var calme = ["........", ".000....", ".000....", "........", "....111.", "....111.", "........", "........"];
var conf = Bot.chooseCardPlay(partieCartes(mk(calme), [CARD.CONFISCATION], [CARD.VACHETTE]), 0, 1.0, seeded(3));
ok(conf && conf.card === CARD.CONFISCATION, "école: confiscation armée quand l'adversaire tient une vachette");
eq(Bot.chooseCardPlay(partieCartes(mk(calme), [CARD.CONFISCATION], [CARD.ENTRACTE]), 0, 1.0, seeded(3)), null,
  "école: confiscation gardée quand l'adversaire n'a qu'un entracte");
eq(Bot.chooseCardPlay(partieCartes(mk(calme), [CARD.CONFISCATION], []), 0, 1.0, seeded(3)), null,
  "école: confiscation jamais jouée sur une main vide");

// Le DÉSORDRE se joue quand l'inversion fait mal : l'adversaire en colonne
// contre le bord droit — son seul coup sûr est LEFT, l'inversé le jette
// dans le vide.
var presse = ["........", ".00....1", ".00....1", ".......1", ".......1", ".......1", ".......1", "........"];
var des = Bot.chooseCardPlay(partieCartes(mk(presse), [CARD.DESORDRE], []), 0, 1.0, seeded(3));
ok(des && des.card === CARD.DESORDRE, "école: désordre joué quand l'adversaire est adossé au bord");

// Et le bot complet (draft + cartes + coups) finit ses parties proprement :
// deux parties toutes règles contre lui-même, aucune action illégale.
for (var pc = 0; pc < 2; pc++) {
  var rngC = seeded(pc + 31);
  var complete = new G.BandasGame({ size: 8, rng: rngC });
  var iterC = 0;
  while (!complete.ended && iterC < 600) {
    iterC++;
    var tC = complete.currentTeam;
    if (complete.phase === G.PHASE_CARD_SELECTION) {
      var prise = complete.chooseCard(tC, Bot.chooseDraft(complete.pool, 1.0, rngC));
      ok(prise.ok, "école: draft légal (partie " + pc + ")");
      continue;
    }
    if (!complete.cardPlayedThisTurn) {
      var cp = Bot.chooseCardPlay(complete, tC, 1.0, rngC);
      if (cp) ok(complete.playCard(tC, cp.card, cp.x, cp.y).ok, "école: carte légale (partie " + pc + ")");
    }
    if (!complete.ended && complete.currentTeam === tC && complete.phase === G.PHASE_MOVE) {
      ok(complete.move(tC, Bot.chooseMove(complete.board, tC, 1.0, rngC)).ok, "école: coup légal (partie " + pc + ")");
    }
  }
  ok(complete.ended, "école: la partie toutes règles se conclut (partie " + pc + ")");
}

// ══ HABILLAGE DES BOTS : identités empruntées au Bouilloscope ═════════════
// Trois adversaires gravés dans le code, on finissait par les connaître par
// cœur. L'hôte fournit un annuaire ; l'identifiant interne, lui, ne bouge pas.
var ANNUAIRE = [
  { name: "cyanure", fb: "111111111111111111111111" },
  { name: "poupoune", fb: "222222222222222222222222" },
  { name: "zoulou", fb: "333333333333333333333333" },
  { name: "tikiwi", fb: "444444444444444444444444" },
  { name: "malabar", fb: "555555555555555555555555" },
];
var curseur = 0;
function annuaire(deja) {                       // rotation : jamais deux fois la même tête
  var pris = {};
  (deja || []).forEach(function (n) { pris[String(n).toLowerCase()] = true; });
  for (var i = 0; i < ANNUAIRE.length; i++) {
    var e = ANNUAIRE[(curseur + i) % ANNUAIRE.length];
    if (!pris[e.name.toLowerCase()]) { curseur = (curseur + i + 1) % ANNUAIRE.length; return e; }
  }
  return null;
}
var ni = new N.BandasNet({ clock: function () { return 0; }, botIdentity: annuaire });
ni.handle("visiteur", { a: "hello", n: "Visiteur" });
var idBots = ni.lobby.listPlayers().filter(function (p) { return ni.bots[p.id]; }).map(function (p) { return p.id; });
eq(idBots.length, 3, "identités : les trois bots sont toujours là");
ok(idBots.indexOf("banano") >= 0, "identités : l'identifiant INTERNE reste banano");
var nomsBots = idBots.map(function (id) { return ni.names[id]; });
ok(nomsBots.every(function (n) { return n !== "Banano" && n !== "Orangine" && n !== "Kiwano"; }),
  "identités : les trois bots ont pris un pseudo de l'annuaire (" + nomsBots.join(", ") + ")");
ok(nomsBots.every(function (n) { return ANNUAIRE.some(function (e) { return e.name === n; }); }),
  "identités : les pseudos viennent bien de l'annuaire");
eq(new Set(nomsBots).size, 3, "identités : trois pseudos distincts");
ok(idBots.every(function (id) { return /^[1-5]{24}$/.test(ni.bouilles[id]); }),
  "identités : la bouille suit le pseudo");
ok(ni._lobbyXml().indexOf('n="' + nomsBots[0] + '"') >= 0, "identités : le lobby affiche le pseudo emprunté");

// Un bot EN PARTIE ne change pas de tête sous les yeux du joueur.
ni.handle("visiteur", { a: "challenge", u: idBots[0], t: "60000" });
var nomEnJeu = ni.names[idBots[0]];
ni.handle("badaud", { a: "hello", n: "Badaud" });        // un autre arrive dans le salon
eq(ni.names[idBots[0]], nomEnJeu, "identités : le bot en partie garde son nom");
eq(ni.names[idBots[1]], nomsBots[1], "identités : un bot au repos non joué garde le sien aussi");

// …mais la partie finie, il repart sous une autre identité : le prochain
// adversaire a l'air d'être quelqu'un d'autre.
ni.handle(idBots[0], { a: "part" });                     // le bot abandonne → partie conclue
ok(ni.names[idBots[0]] !== nomEnJeu, "identités : après la partie, le bot revient sous un autre pseudo ("
  + nomEnJeu + " → " + ni.names[idBots[0]] + ")");
eq(ni.names[idBots[1]], nomsBots[1], "identités : les deux autres n'ont pas bougé");
eq(new Set(idBots.map(function (id) { return ni.names[id]; })).size, 3, "identités : toujours trois pseudos distincts");

// La tête qu'on remplace part elle aussi dans les noms réservés : un bot qui
// reprendrait son propre pseudo raterait complètement l'effet recherché.
var vues = [];
var nres = new N.BandasNet({
  clock: function () { return 0; },
  botIdentity: function (deja) { vues.push(deja.slice()); return annuaire(deja); },
});
nres.handle("obs", { a: "hello" });
var avant = nres.names["banano"];
nres.handle("obs", { a: "challenge", u: "banano", t: "60000" });
nres.handle("banano", { a: "part" });
ok(vues[vues.length - 1].indexOf(avant) >= 0,
  "identités : le pseudo qu'on remplace est réservé au tirage (pas de retour sur soi-même)");

// Sans annuaire (tests purs, base vide) ou avec un annuaire en panne : les noms
// d'origine restent, et rien ne casse.
var nsans = new N.BandasNet({ clock: function () { return 0; } });
nsans.handle("x", { a: "hello" });
eq(nsans.names["banano"], "Banano", "sans annuaire : le nom d'origine reste");
var nko = new N.BandasNet({ clock: function () { return 0; }, botIdentity: function () { throw new Error("base injoignable"); } });
nko.handle("x", { a: "hello" });
eq(nko.names["orangine"], "Orangine", "annuaire en panne : on retombe sur les noms d'origine");
var nvide = new N.BandasNet({ clock: function () { return 0; }, botIdentity: function () { return null; } });
nvide.handle("x", { a: "hello" });
eq(nvide.names["kiwano"], "Kiwano", "annuaire trop maigre (null) : noms d'origine");


// ── LE TEMPO DES CARTES ────────────────────────────────────────────────────
// Le bot brûlait sa main dans les premiers tours. Or une carte n'a pas la même
// force à tous les moments : la vachette rase une colonne PLEINE au départ, le
// renfort pose trois fruits qui ne se voient pas sur trente mais retournent une
// fin de partie, et la conversion pèse d'autant plus qu'il reste peu de monde.

ok(Bot.avancementPartie(64) === 0, 'tempo: plateau plein = début de partie');
ok(Bot.avancementPartie(10) === 1, 'tempo: presque vide = fin de partie');
ok(Bot.avancementPartie(30) > 0 && Bot.avancementPartie(30) < 1, 'tempo: le milieu est entre les deux');

ok(Bot.facteurMoment(CARD.VACHETTE, 0) > Bot.facteurMoment(CARD.VACHETTE, 1),
  'tempo: la vachette est une carte de DÉBUT');
ok(Bot.facteurMoment(CARD.RENFORT, 1) > Bot.facteurMoment(CARD.RENFORT, 0),
  'tempo: le renfort est une carte de FIN');
ok(Bot.facteurMoment(CARD.CONVERSION, 1) > Bot.facteurMoment(CARD.CONVERSION, 0),
  'tempo: la conversion aussi');
ok(Bot.facteurMoment(CARD.VACHETTE, 0) > Bot.facteurMoment(CARD.RENFORT, 0),
  'tempo: au départ, entre les deux, c\'est la vachette');
ok(Bot.facteurMoment(CARD.RENFORT, 1) > Bot.facteurMoment(CARD.VACHETTE, 1),
  'tempo: à la fin, c\'est le renfort');

// Et le tempo se voit sur le plateau : le renfort attend son heure.
(function () {
  function partieAvec(rows, main) {
    var g = new G.BandasGame({ board: mk(rows), pool: [], firstTeam: 0 });
    g.hands[0] = main.slice(); g.hands[1] = [];
    return g;
  }
  var plein = [];                                  // plateau plein : 64 fruits
  for (var y = 0; y < 8; y++) {
    var l = '';
    for (var x = 0; x < 8; x++) l += ((x + y) % 2 ? '1' : '0');
    plein.push(l);
  }
  var maigre = ['........', '..00....', '..00....', '........', '....11..', '....11..', '........', '........'];
  eq(Bot.chooseCardPlay(partieAvec(plein, [CARD.RENFORT]), 0, 1.0, seeded(3)), null,
    'tempo: sur un plateau plein, le renfort reste en main');
  var tard = Bot.chooseCardPlay(partieAvec(maigre, [CARD.RENFORT]), 0, 1.0, seeded(3));
  ok(tard && tard.card === CARD.RENFORT, 'tempo: en fin de partie, il sort');
})();

// ── LE CENTRE AVANT LE MATÉRIEL, POUR DE BON ───────────────────────────────
// Quatre fruits bien placés valent mieux que SIX mal placés : c'est ce qui
// autorise le bot à laisser filer ses pions de bord pour se recentrer.
var quatreAuCentre = mk(['.......', '.......', '..00...', '..00...', '.......', '.......', '......1']);
var sixAuBord = mk(['00.....', '00.....', '.......', '.......', '0......', '......0', '......1']);
eq(quatreAuCentre.countSpritesOf(0), 4, 'centre: quatre fruits');
eq(sixAuBord.countSpritesOf(0), 6, 'bord: six fruits');
ok(Bot.evaluate(quatreAuCentre, 0) > Bot.evaluate(sixAuBord, 0),
  'centre: 4 fruits au centre valent mieux que 6 collés aux bords');

// Et priver l'adversaire de son centre compte autant que bâtir le sien : à
// matériel identique des deux côtés, on préfère de loin le voir éparpillé.
var luiCentre = mk(['.......', '.......', '..00...', '..00...', '..11...', '..11...', '.......']);
var luiEpars = mk(['1.....1', '.......', '..00...', '..00...', '.......', '.......', '1.....1']);
eq(luiCentre.countSpritesOf(1), luiEpars.countSpritesOf(1), 'privation: même matériel adverse');
ok(Bot.evaluate(luiEpars, 0) > Bot.evaluate(luiCentre, 0),
  'privation: un adversaire sans bloc central vaut bien mieux qu\'un adversaire groupé');


// Le tempo ne se lit pas sur une position isolée — la valeur simulée d'une
// carte dépend d'abord du plateau — mais sur la DURÉE. Douze parties à graines
// fixes, et l'on mesure combien de fruits restaient au moment où chaque carte
// est sortie (64 = plateau plein). L'ordre doit suivre la doctrine :
// la vachette ouvre, la conversion vient après, le renfort ferme la marche.
// (Sans le facteur de tempo, cet ordre s'inverse : la conversion partait la
// première et la vachette après elle.)
(function () {
  var quand = {};
  for (var p = 0; p < 12; p++) {
    var rng = seeded(p + 101);
    var partie = new G.BandasGame({ size: 8, rng: rng });
    var iter = 0;
    while (!partie.ended && iter < 600) {
      iter++;
      var t = partie.currentTeam;
      if (partie.phase === G.PHASE_CARD_SELECTION) {
        partie.chooseCard(t, Bot.chooseDraft(partie.pool, 1.0, rng));
        continue;
      }
      if (!partie.cardPlayedThisTurn) {
        var cp = Bot.chooseCardPlay(partie, t, 1.0, rng);
        if (cp) {
          var restants = partie.board.countSpritesOf(0) + partie.board.countSpritesOf(1);
          if (partie.playCard(t, cp.card, cp.x, cp.y).ok) {
            (quand[cp.card] = quand[cp.card] || []).push(restants);
          }
        }
      }
      if (!partie.ended && partie.currentTeam === t && partie.phase === G.PHASE_MOVE) {
        partie.move(t, Bot.chooseMove(partie.board, t, 1.0, rng));
      }
    }
  }
  function moyenne(c) {
    var l = quand[c] || [];
    if (!l.length) return -1;
    return l.reduce(function (s, x) { return s + x; }, 0) / l.length;
  }
  var vach = moyenne(CARD.VACHETTE), conv = moyenne(CARD.CONVERSION), renf = moyenne(CARD.RENFORT);
  ok(vach > 0 && conv > 0 && renf > 0, "tempo: les trois cartes ont été jouées");
  ok(vach > conv, "tempo: la vachette sort AVANT la conversion ("
    + vach.toFixed(1) + " vs " + conv.toFixed(1) + " fruits restants)");
  ok(conv > renf, "tempo: et le renfort ferme la marche ("
    + conv.toFixed(1) + " vs " + renf.toFixed(1) + ")");
})();

console.log("bandas server tests: " + passed + " passed, " + fails + " failed");
process.exit(fails ? 1 : 0);
