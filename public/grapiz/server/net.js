//
// Grapiz — pont réseau (la "cervelle" du multijoueur côté serveur).
//
// Possède le lobby (appariements) + les sessions actives, et traduit chaque
// action client en une liste de messages { to:[usernames], xml } que le
// transport (server.js) enverra réellement. Aucune dépendance aux sockets →
// entièrement testable. L'identité d'un joueur = son username.
//
// Protocole (XML sur le WebSocket existant, tag <gz>) :
//   client → serveur : <gz a="hello|list|create|join|challenge|accept|decline|move|part" .../>
//   serveur → client : <gz e="lobby|challenged|start|move|end|err" ...> ... </gz>
//
(function (root, factory) {
  var L = (typeof require !== "undefined") ? require("./lobby.js") : (root.Grapiz && root.Grapiz.lobby);
  var S = (typeof require !== "undefined") ? require("./session.js") : (root.Grapiz && root.Grapiz.session);
  var B = (typeof require !== "undefined") ? require("./bot.js") : (root.Grapiz && root.Grapiz.bot);
  var api = factory(L, S, B);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else (root.Grapiz = root.Grapiz || {}).net = api;
})(typeof self !== "undefined" ? self : this, function (L, S, Bot) {
  "use strict";

  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function num(v, dflt) { var n = parseInt(v, 10); return isNaN(n) ? dflt : n; }

  // Bots toujours disponibles. TOUS partagent la MÊME plage de niveau, tirée au
  // sort par partie : impossible de "repérer le plus faible" et de l'enchaîner.
  // (skill 0=faible … 1=fort, cf. bot.js.)
  var BOT_SKILL = { lo: 0.45, hi: 1.0 };
  var BOTS = [
    { id: "pepino", name: "Pépino", fb: "0006000U040L0N0000000000" },
    { id: "mirabo", name: "Mirabo", fb: "0006010Y040N0L0000000000" },
    { id: "cassis", name: "Cassis", fb: "00060a12040L0N0000000000" },
  ];

  // opts : { clock?, onResult?, getStreak?, onStreak?, rng?, withBots? }
  function GrapizNet(opts) {
    opts = opts || {};
    this.lobby = new L.GrapizLobby();
    this.sessions = {};                 // gameId → GrapizSession
    this.names = {};                    // username → displayName
    this.bouilles = {};                 // username → état de frutibouille (24 car.)
    this.streaks = {};                  // username → série de victoires EN COURS (le gros nombre doré)
    this._beaten = {};                  // username → { opponentId: true } battus PENDANT la série en cours (anti-farm)
    this.bots = {};                     // username → config bot ({lo,hi})
    this.clock = opts.clock || function () { return Date.now(); };
    this._rng = opts.rng || Math.random;
    this.onResult = opts.onResult || function () {};   // hook (game, winner, reason)
    this.getStreak = opts.getStreak || null;           // username → série persistée (seed)
    this.onStreak = opts.onStreak || null;             // (username, série, {series}) → persistance + classement
    if (opts.withBots !== false) this._registerBots();
  }

  GrapizNet.prototype._registerBots = function () {
    var self = this;
    BOTS.forEach(function (b) {
      self.bots[b.id] = true;
      self.names[b.id] = b.name;
      self.bouilles[b.id] = b.fb;
      self.streaks[b.id] = 0;
      self.lobby.addPlayer(b.id, b.name);   // toujours présent, toujours "idle" hors partie
    });
  };

  // ── Sérialisation ──────────────────────────────────────────────────────────
  GrapizNet.prototype._lobbyXml = function () {
    var self = this;
    var games = this.lobby.listOpenGames().map(function (g) {
      return '<game id="' + esc(g.id) + '" host="' + esc(g.host) + '" c="' + g.count +
        '" m="' + g.max + '" t="' + g.params.time + '" sz="' + g.params.boardSize + '"/>';
    }).join("");
    var players = this.lobby.listPlayers().map(function (p) {
      return '<pl u="' + esc(p.id) + '" n="' + esc(p.name || p.id) + '" s="' + esc(p.status) +
        '" f="' + esc(self.bouilles[p.id] || "") + '" sr="' + (self.streaks[p.id] || 0) +
        '" bot="' + (self.bots[p.id] ? 1 : 0) + '"/>';
    }).join("");
    return "<gz e=\"lobby\">" + players + games + "</gz>";
  };

  GrapizNet.prototype._stateXml = function (session, evt, extra) {
    var self = this;
    var snap = session.snapshot(this.clock());
    var toks = snap.board.map(function (t) { return '<t e="' + t.team + '" x="' + t.x + '" y="' + t.y + '"/>'; }).join("");
    var pls = snap.players.map(function (p) {
      return '<p u="' + esc(p.id) + '" n="' + esc(p.name) + '" e="' + p.team +
        '" rt="' + p.remaining + '" f="' + esc(p.fb || "") + '" sr="' + (self.streaks[p.id] || 0) + '"/>';
    }).join("");
    return '<gz e="' + evt + '" g="' + esc(snap.id) + '" turn="' + snap.currentTurn +
      '" sz="' + session.game.getBoard().getSize() + '"' +
      (extra || "") +
      (snap.ended ? ' end="1" w="' + snap.winner + '" r="' + esc(snap.endReason) + '"' : "") +
      ">" + pls + toks + "</gz>";
  };

  GrapizNet.prototype._err = function (username, code) {
    return { to: [username], xml: '<gz e="err" m="' + esc(code) + '"/>' };
  };
  GrapizNet.prototype._lobbyBroadcast = function () {
    var to = this.lobby.listPlayers().map(function (p) { return p.id; });
    return to.length ? [{ to: to, xml: this._lobbyXml() }] : [];
  };
  GrapizNet.prototype._ids = function (session) { return session.players.map(function (p) { return p.id; }); };

  GrapizNet.prototype._startSession = function (game) {
    var self = this;
    var players = game.players.map(function (uid) {
      return { id: uid, name: self.names[uid] || uid, fb: self.bouilles[uid] || "" };
    });
    var sess = new S.GrapizSession({ id: game.id, players: players, params: game.params, now: this.clock() });
    // Bots : niveau effectif tiré au sort POUR CETTE PARTIE + série "vitrine"
    // (affichée mais non classée) pour avoir l'air d'un vrai adversaire.
    sess._botSkill = {};
    game.players.forEach(function (uid) {
      if (self.bots[uid]) {
        sess._botSkill[uid] = BOT_SKILL.lo + self._rng() * (BOT_SKILL.hi - BOT_SKILL.lo);
        self.streaks[uid] = Math.floor(self._rng() * 14);   // série "vitrine" (non classée)
      }
    });
    this.sessions[game.id] = sess;
    return [{ to: game.players.slice(), xml: this._stateXml(sess, "start") }];
  };

  // Met à jour les séries (challenge) : le gagnant +1, le perdant enregistre sa
  // série puis repart à 0. 2 joueurs uniquement (TODO multi).
  //
  // Règles de la série classée :
  //   1. Battre un BOT compte comme une vraie victoire (les bots sont des
  //      adversaires à part entière), et c'est REJOUABLE : un bot est contrôlé
  //      par le serveur, il ne peut pas être un complice — l'anti-farm
  //      « une fois par série » ne s'applique donc qu'aux humains.
  //   2. Perdre contre un bot casse la série, comme contre un humain
  //      (symétrique — sinon affronter les bots serait un farm sans risque).
  //   3. Entre humains : pendant une série, chaque adversaire ne compte
  //      qu'UNE fois. Battre en boucle le même compte (alt/complice qui
  //      abandonne) ne rapporte qu'UN point ; pour monter il faut enchaîner
  //      des adversaires DIFFÉRENTS. Le set "déjà battus" est remis à zéro
  //      quand la série tombe.
  GrapizNet.prototype._updateStreaks = function (session) {
    if (session.winner == null || session.players.length !== 2) return;
    var win = session.playerOfTeam(session.winner);
    var lose = session.players.filter(function (p) { return p.team !== session.winner; })[0];
    if (!win || !lose) return;
    if (this.bots[win.id] && this.bots[lose.id]) return;   // bot vs bot : rien

    // Victoire du gagnant.
    if (this.bots[win.id]) {
      // Gagnant bot : simple bump cosmétique de sa série "vitrine" (jamais
      // persistée — _fireStreak ignore les bots), pour un écran de fin cohérent.
      this.streaks[win.id] = (this.streaks[win.id] || 0) + 1;
    } else {
      var counts;
      if (this.bots[lose.id]) {
        counts = true;                       // bot battu → compte toujours
      } else {
        var beaten = this._beaten[win.id] || (this._beaten[win.id] = {});
        counts = !beaten[lose.id];           // humain : une fois par série
        if (counts) beaten[lose.id] = true;
      }
      if (counts) {
        var ws = (this.streaks[win.id] || 0) + 1;
        this.streaks[win.id] = ws;
        this._fireStreak(win.id, ws, ws);
      }
      // (humain déjà battu pendant cette série → série inchangée)
    }

    // Défaite du perdant : la série tombe et s'enregistre. Pour un bot c'est
    // purement cosmétique (sa série "vitrine" retombe ; _fireStreak l'ignore).
    var ended = this.streaks[lose.id] || 0;
    this.streaks[lose.id] = 0;
    this._beaten[lose.id] = {};            // le perdant repart sur une série vierge
    this._fireStreak(lose.id, 0, ended);
  };
  GrapizNet.prototype._fireStreak = function (user, streak, series) {
    if (this.bots[user]) return;   // les bots ne sont pas persistés/classés
    if (this.onStreak) { try { this.onStreak(user, streak, { series: series }); } catch (e) {} }
  };

  // Conclut une partie : séries à jour → état final (cartes à jour) → hook
  // classement → libère le lobby. Renvoie tous les messages à pousser.
  GrapizNet.prototype._concludeGame = function (session) {
    this._updateStreaks(session);
    var msgs = [{ to: this._ids(session), xml: this._stateXml(session, "end") }];
    try { this.onResult(session, session.winner, session.endReason); } catch (e) {}
    this.lobby.endGame(session.id);
    delete this.sessions[session.id];
    return msgs.concat(this._lobbyBroadcast());
  };

  // ── Dispatch d'une action client ────────────────────────────────────────────
  GrapizNet.prototype.handle = function (username, attrs) {
    attrs = attrs || {};
    var a = attrs.a, out = [], r;
    var params = { time: num(attrs.t), boardSize: num(attrs.sz), nbrPlayers: num(attrs.np) };

    switch (a) {
      case "hello":
        this.names[username] = attrs.n || username;
        if (attrs.f) this.bouilles[username] = attrs.f;     // état de frutibouille
        // série de départ : ne la seede qu'une fois (ne pas écraser une série en cours)
        if (this.getStreak && this.streaks[username] === undefined) { try { this.streaks[username] = this.getStreak(username) || 0; } catch (e) {} }
        this.lobby.addPlayer(username, this.names[username]);
        return this._lobbyBroadcast();

      case "list":
        return [{ to: [username], xml: this._lobbyXml() }];

      case "create":
        r = this.lobby.createGame(username, params);
        return r.ok ? this._lobbyBroadcast() : [this._err(username, r.error)];

      case "join":
        r = this.lobby.joinGame(username, attrs.g);
        if (!r.ok) return [this._err(username, r.error)];
        if (r.started) out = out.concat(this._startSession(r.game));
        return out.concat(this._lobbyBroadcast());

      case "challenge": {
        // Défier = lancer la partie DIRECTEMENT (pas de validation de l'adversaire).
        var rc = this.lobby.challenge(username, attrs.u, params);
        if (!rc.ok) return [this._err(username, rc.error)];
        var ra = this.lobby.acceptChallenge(attrs.u, rc.challengeId);
        if (!ra.ok) return [this._err(username, ra.error)];
        return this._startSession(ra.game).concat(this._lobbyBroadcast());
      }

      case "move": {
        var p = this.lobby.getPlayer(username);
        if (!p || !p.gameId || !this.sessions[p.gameId]) return [this._err(username, "not-in-game")];
        var sess = this.sessions[p.gameId];
        var res = sess.requestMove(username, num(attrs.x), num(attrs.y), num(attrs.d), this.clock());
        if (!res.ok) return [this._err(username, res.error)];
        if (res.ended) return this._concludeGame(sess);            // série + état final + lobby
        return [{ to: this._ids(sess), xml: this._stateXml(sess, "move") }];
      }

      case "part": {
        var pp = this.lobby.getPlayer(username);
        if (pp && pp.gameId && this.sessions[pp.gameId]) {           // partie en cours → forfait (= défaite)
          this.sessions[pp.gameId].forfeit(username);
          return this._concludeGame(this.sessions[pp.gameId]);
        }
        this.lobby.partGame(username);                              // partie ouverte → quitte
        return this._lobbyBroadcast();
      }

      case "say": {                                   // chat du lobby
        if (!attrs.m) return [];
        var to = this.lobby.listPlayers().filter(function (pl) { return pl.status !== "playing"; }).map(function (pl) { return pl.id; });
        return [{ to: to, xml: '<gz e="chat" u="' + esc(this.names[username] || username) + '" m="' + esc(attrs.m) + '"/>' }];
      }

      case "gsay": {                                  // chat en partie (aux 2 joueurs)
        if (!attrs.m) return [];
        var gp = this.lobby.getPlayer(username);
        if (!gp || !gp.gameId || !this.sessions[gp.gameId]) return [];
        return [{ to: this._ids(this.sessions[gp.gameId]), xml: '<gz e="gchat" u="' + esc(this.names[username] || username) + '" m="' + esc(attrs.m) + '"/>' }];
      }

      default:
        return [this._err(username, "unknown-action")];
    }
  };

  // Déconnexion (= quitter Grapiz) : abandon si en partie ; sinon la série en
  // cours prend fin (enregistrée + remise à 0 — pas de reprise plus tard). Le
  // joueur est retiré du lobby et la liste rediffusée aux autres.
  GrapizNet.prototype.onDisconnect = function (username) {
    var rm = this.lobby.removePlayer(username);
    if (!rm || !rm.ok) { delete this.streaks[username]; delete this._beaten[username]; return []; }
    if (rm.playingGameId && this.sessions[rm.playingGameId]) {
      this.sessions[rm.playingGameId].forfeit(username);          // défaite → la série tombe (via _concludeGame)
      var out = this._concludeGame(this.sessions[rm.playingGameId]);
      delete this.streaks[username];
      delete this._beaten[username];
      return out;
    }
    if ((this.streaks[username] || 0) > 0) this._fireStreak(username, 0, this.streaks[username]);
    delete this.streaks[username];
    delete this._beaten[username];
    return this._lobbyBroadcast();
  };

  // Tick périodique des horloges : termine les parties dont le temps est écoulé.
  GrapizNet.prototype.tick = function (now) {
    if (now === undefined) now = this.clock();
    var out = [];
    Object.keys(this.sessions).forEach(function (id) {       // snapshot : _concludeGame supprime de this.sessions
      var sess = this.sessions[id];
      if (!sess || sess.ended) return;
      var to = sess.tick(now);                                // timeout d'horloge
      if (to && to.ended) { out = out.concat(this._concludeGame(sess)); return; }
      out = out.concat(this._tickBot(sess, now));             // coup d'un bot si c'est son tour
    }, this);
    return out;
  };

  // Fait jouer le bot quand c'est son tour, après un délai naturel (≈0,7-2,2 s).
  GrapizNet.prototype._tickBot = function (sess, now) {
    var p = sess.playerOfTeam(sess.game.currentTurn);
    if (!p || !this.bots[p.id]) { sess._botAt = null; return []; }     // pas un bot → rien
    if (!sess._botAt) { sess._botAt = now + 700 + Math.floor(this._rng() * 1500); return []; }
    if (now < sess._botAt) return [];
    sess._botAt = null;
    var skill = (sess._botSkill && sess._botSkill[p.id]); if (skill == null) skill = 0.5;
    var mv = Bot.chooseMove(sess.game.getBoard(), sess.game.currentTurn, skill, this._rng);
    if (!mv) { sess.forfeit(p.id); return this._concludeGame(sess); }  // bloqué → le bot perd
    var res = sess.requestMove(p.id, mv.from.x, mv.from.y, mv.direction, now);
    if (!res.ok) { sess._botAt = now + 400; return []; }               // coup refusé → réessaie
    if (res.ended) return this._concludeGame(sess);
    return [{ to: this._ids(sess), xml: this._stateXml(sess, "move") }];
  };

  return { GrapizNet: GrapizNet };
});
