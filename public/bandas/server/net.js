//
// Frutibandas — pont réseau (la "cervelle" du multijoueur côté serveur).
//
// Possède le lobby (appariements) + les sessions actives, et traduit chaque
// action client en une liste de messages { to:[usernames], xml } que le
// transport (server.js) enverra réellement. Aucune dépendance aux sockets →
// entièrement testable. L'identité d'un joueur = son username.
//
// Protocole (XML sur le WebSocket existant, tag <bd>) :
//   client → serveur : <bd a="hello|list|create|join|challenge|choose|play|
//                             move|part|say|gsay" .../>
//   serveur → client : <bd e="lobby|start|ev|chat|gchat|err" ...> ... </bd>
//
// Les événements de partie (e="ev") sont REJOUÉS par le client avec son
// propre moteur (mêmes règles → mêmes plateaux), avec la visibilité
// d'origine : une pose cachée (piège/désordre/confiscation) n'est envoyée
// qu'à son poseur, la révélation est diffusée aux deux (cf. Game.as).
//
(function (root, factory) {
  var L = (typeof require !== "undefined") ? require("./lobby.js") : (root.Bandas && root.Bandas.lobby);
  var S = (typeof require !== "undefined") ? require("./session.js") : (root.Bandas && root.Bandas.session);
  var B = (typeof require !== "undefined") ? require("./bot.js") : (root.Bandas && root.Bandas.bot);
  var G = (typeof require !== "undefined") ? require("../game.js") : (root.Bandas && root.Bandas.game);
  var api = factory(L, S, B, G);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else (root.Bandas = root.Bandas || {}).net = api;
})(typeof self !== "undefined" ? self : this, function (L, S, Bot, G) {
  "use strict";

  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function num(v, dflt) { var n = parseInt(v, 10); return isNaN(n) ? dflt : n; }

  // Bots toujours disponibles (même modèle que Grapiz : plage de niveau
  // commune, tirée au sort par partie — impossible de farmer "le faible").
  var BOT_SKILL = { lo: 0.45, hi: 1.0 };
  var BOTS = [
    { id: "banano", name: "Banano", fb: "0006000U040L0N0000000000" },
    { id: "orangine", name: "Orangine", fb: "0006010Y040N0L0000000000" },
    { id: "kiwano", name: "Kiwano", fb: "00060a12040L0N0000000000" },
  ];

  // opts : { clock?, onResult?, getStreak?, onStreak?, rng?, withBots? }
  function BandasNet(opts) {
    opts = opts || {};
    this.lobby = new L.BandasLobby();
    this.sessions = {};                 // gameId → BandasSession
    this.names = {};                    // username → displayName
    this.bouilles = {};                 // username → frutibouille (24 car.)
    this.streaks = {};                  // username → série de victoires EN COURS
    this._beaten = {};                  // username → { adversaire: true } battus pendant la série (anti-farm)
    this.bots = {};                     // username → true
    this.clock = opts.clock || function () { return Date.now(); };
    this._rng = opts.rng || Math.random;
    this.onResult = opts.onResult || function () {};   // hook (session, winner, reason)
    this.getStreak = opts.getStreak || null;           // username → série persistée (seed)
    this.onStreak = opts.onStreak || null;             // (username, série, {series}) → persistance + classement
    // Portillon FD : (humans, game) → { ok, blocked? }. Consomme 1 « partie »
    // (FD) par humain au démarrage d'un match CLASSÉ (2 humains, aucun bot) et
    // refuse si au moins un humain n'a plus de FD. Absent (tests purs) → aucun
    // rationnement. Les matchs impliquant un bot sont des entraînements libres.
    this.onRankedMatchStart = opts.onRankedMatchStart || null;
    if (opts.withBots !== false) this._registerBots();
  }

  BandasNet.prototype._registerBots = function () {
    var self = this;
    BOTS.forEach(function (b) {
      self.bots[b.id] = true;
      self.names[b.id] = b.name;
      self.bouilles[b.id] = b.fb;
      self.streaks[b.id] = 0;
      self.lobby.addPlayer(b.id, b.name);
    });
  };

  // ── Sérialisation ──────────────────────────────────────────────────────────
  BandasNet.prototype._lobbyXml = function () {
    var self = this;
    var games = this.lobby.listOpenGames().map(function (g) {
      return '<game id="' + esc(g.id) + '" host="' + esc(g.host) + '" c="' + g.count +
        '" m="' + g.max + '" t="' + g.params.time + '" sz="' + g.params.boardSize +
        '" cd="' + g.params.cards + '"/>';
    }).join("");
    var players = this.lobby.listPlayers().map(function (p) {
      return '<pl u="' + esc(p.id) + '" n="' + esc(p.name || p.id) + '" s="' + esc(p.status) +
        '" f="' + esc(self.bouilles[p.id] || "") + '" sr="' + (self.streaks[p.id] || 0) +
        '" bot="' + (self.bots[p.id] ? 1 : 0) + '"/>';
    }).join("");
    return '<bd e="lobby">' + players + games + "</bd>";
  };

  // Instantané complet d'une partie (départ + reprise) pour UN destinataire :
  // sa propre main est détaillée, celle de l'adversaire aussi (le draft est
  // public dans le jeu d'origine — seules les POSES cachées sont secrètes).
  BandasNet.prototype._startXml = function (session, username) {
    var self = this;
    var snap = session.snapshot(this.clock());
    var pls = snap.players.map(function (p) {
      return '<p u="' + esc(p.id) + '" n="' + esc(p.name) + '" e="' + p.team +
        '" rt="' + Math.round(p.remaining) + '" f="' + esc(p.fb || "") +
        '" sr="' + (self.streaks[p.id] || 0) + '" c="' + snap.hands[p.team].join(":") + '"/>';
    }).join("");
    var board = '<b size="' + snap.size + '" x1="' + snap.bounds.x1 + '" x2="' + snap.bounds.x2 +
      '" y1="' + snap.bounds.y1 + '" y2="' + snap.bounds.y2 + '">' + snap.content + "</b>";
    return '<bd e="start" g="' + esc(snap.id) + '" t="' + snap.currentTeam +
      '" ph="' + snap.phase + '" i="' + snap.totalTime + '" c="' + snap.pool.join(":") + '"' +
      (snap.ended ? ' end="1" w="' + snap.winner + '"' : "") +
      ">" + pls + board + "</bd>";
  };

  // Un événement de partie → un message <bd e="ev"> ciblé (visibilité des
  // cartes cachées comprise). `clocks` : temps restants joints à chaque envoi.
  BandasNet.prototype._eventMessages = function (session, events) {
    var self = this;
    var all = this._ids(session);
    var out = [];
    var rt = session.players.map(function (p) {
      return Math.round(session.remainingOf(p.team, self.clock()));
    });
    events.forEach(function (ev) {
      var to = (ev.to === "all" || ev.to === undefined) ? all
        : [session.playerOfTeam(ev.to)].filter(Boolean).map(function (p) { return p.id; });
      if (!to.length) return;
      var attrs = ' g="' + esc(session.id) + '" t="' + esc(ev.type) + '"';
      if (ev.team !== undefined) attrs += ' tm="' + ev.team + '"';   // pas "e" : déjà pris par l'enveloppe
      if (ev.card !== undefined) attrs += ' c="' + ev.card + '"';
      if (ev.x !== undefined) attrs += ' x="' + ev.x + '"';
      if (ev.y !== undefined) attrs += ' y="' + ev.y + '"';
      if (ev.direction !== undefined) attrs += ' d="' + ev.direction + '"';
      if (ev.p !== undefined) attrs += ' p="' + ev.p + '"';
      if (ev.movePhase !== undefined) attrs += ' mp="' + (ev.movePhase ? 1 : 0) + '"';
      if (ev.hidden) attrs += ' h="1"';
      if (ev.winner !== undefined) attrs += ' w="' + ev.winner + '"';
      attrs += ' rt0="' + rt[0] + '" rt1="' + rt[1] + '"';
      out.push({ to: to, xml: "<bd e=\"ev\"" + attrs + "/>" });
    });
    return out;
  };

  BandasNet.prototype._err = function (username, code) {
    return { to: [username], xml: '<bd e="err" m="' + esc(code) + '"/>' };
  };
  BandasNet.prototype._lobbyBroadcast = function () {
    var to = this.lobby.listPlayers().map(function (p) { return p.id; });
    return to.length ? [{ to: to, xml: this._lobbyXml() }] : [];
  };
  BandasNet.prototype._ids = function (session) { return session.players.map(function (p) { return p.id; }); };

  BandasNet.prototype._startSession = function (game) {
    var self = this;
    // Portillon FD : un match ENTRE HUMAINS (exactement 2 joueurs, aucun bot)
    // est « classé » → il consomme 1 FD par joueur (parties Challenge rationnées).
    // Dès qu'un bot participe, c'est un ENTRAÎNEMENT libre : jamais rationné,
    // jamais classé. Si un humain n'a plus de FD, le match classé est refusé :
    // le lobby libère la partie et chaque joueur reçoit un refus (no-fd pour
    // celui qui est à sec, opp-no-fd pour son adversaire) — le client ouvre la
    // popin boutique. Sans onRankedMatchStart (tests purs), rien n'est rationné.
    var humans = game.players.filter(function (uid) { return !self.bots[uid]; });
    var ranked = game.players.length === 2 && humans.length === 2;
    if (ranked && this.onRankedMatchStart) {
      var chk;
      try { chk = this.onRankedMatchStart(humans, game); } catch (e) { chk = null; }
      if (chk && chk.ok === false) {
        this.lobby.endGame(game.id);
        var blocked = (chk.blocked && chk.blocked.length) ? chk.blocked : humans;
        return game.players.map(function (uid) {
          var code = blocked.indexOf(uid) >= 0 ? "no-fd" : "opp-no-fd";
          return { to: [uid], xml: '<bd e="err" m="' + code + '"/>' };
        });
      }
    }
    var players = game.players.map(function (uid) {
      return { id: uid, name: self.names[uid] || uid, fb: self.bouilles[uid] || "" };
    });
    var sess = new S.BandasSession({
      id: game.id, players: players, params: game.params,
      now: this.clock(), rng: this._rng,
    });
    // Bots : niveau tiré au sort POUR CETTE PARTIE + série "vitrine" (affichée
    // mais jamais persistée/classée — _fireStreak ignore les bots).
    sess._botSkill = {};
    game.players.forEach(function (uid) {
      if (self.bots[uid]) {
        sess._botSkill[uid] = BOT_SKILL.lo + self._rng() * (BOT_SKILL.hi - BOT_SKILL.lo);
        self.streaks[uid] = Math.floor(self._rng() * 14);
      }
    });
    this.sessions[game.id] = sess;
    return game.players.map(function (uid) {
      return { to: [uid], xml: self._startXml(sess, uid) };
    });
  };

  // Séries (challenge) : mêmes règles que Grapiz — « bots libres, humains classés » :
  //   1. ENTRAÎNEMENT : dès qu'un bot participe, la partie n'est PAS classée —
  //      la série classée n'est ni avancée ni cassée, aucun FD consommé.
  //   2. CLASSÉ : entre deux humains uniquement (1 FD/joueur au démarrage).
  //   3. Entre humains, chaque adversaire ne compte qu'UNE fois par série
  //      (anti-farm) — cf. l'erreur 1529 du protocole d'origine.
  BandasNet.prototype._updateStreaks = function (session) {
    if (session.winner == null || session.winner < 0) return;   // égalité : personne ne marque ni ne tombe
    var win = session.playerOfTeam(session.winner);
    var lose = session.playerOfTeam(1 - session.winner);
    if (!win || !lose) return;

    // Entraînement (au moins un bot) : la série CLASSÉE n'est pas touchée. Seul
    // le compteur "vitrine" d'un bot gagnant bouge (jamais persisté).
    if (this.bots[win.id] || this.bots[lose.id]) {
      if (this.bots[win.id]) this.streaks[win.id] = (this.streaks[win.id] || 0) + 1;
      return;
    }

    // Match CLASSÉ (2 humains). Gagnant +1 (chaque adversaire une fois par série).
    var beaten = this._beaten[win.id] || (this._beaten[win.id] = {});
    if (!beaten[lose.id]) {
      beaten[lose.id] = true;
      var ws = (this.streaks[win.id] || 0) + 1;
      this.streaks[win.id] = ws;
      this._fireStreak(win.id, ws, ws);
    }

    var ended = this.streaks[lose.id] || 0;
    this.streaks[lose.id] = 0;
    this._beaten[lose.id] = {};
    this._fireStreak(lose.id, 0, ended);
  };
  BandasNet.prototype._fireStreak = function (user, streak, series) {
    if (this.bots[user]) return;
    if (this.onStreak) { try { this.onStreak(user, streak, { series: series }); } catch (e) {} }
  };

  // Conclut une partie : séries → hook classement → libère le lobby.
  BandasNet.prototype._concludeGame = function (session, preMsgs) {
    this._updateStreaks(session);
    var msgs = preMsgs || [];
    try { this.onResult(session, session.winner, session.endReason); } catch (e) {}
    this.lobby.endGame(session.id);
    delete this.sessions[session.id];
    return msgs.concat(this._lobbyBroadcast());
  };

  // Traite le résultat d'une action de session : événements ciblés, et fin de
  // partie le cas échéant.
  BandasNet.prototype._afterAction = function (session, res, username) {
    if (!res.ok) return [this._err(username, res.error)];
    var msgs = this._eventMessages(session, res.events || []);
    if (res.ended || session.ended) return this._concludeGame(session, msgs);
    return msgs;
  };

  BandasNet.prototype._sessionOf = function (username) {
    var p = this.lobby.getPlayer(username);
    if (!p || !p.gameId || !this.sessions[p.gameId]) return null;
    return this.sessions[p.gameId];
  };

  // ── Dispatch d'une action client ────────────────────────────────────────────
  BandasNet.prototype.handle = function (username, attrs) {
    attrs = attrs || {};
    var a = attrs.a, out = [], r, sess;
    var params = { time: num(attrs.t), boardSize: num(attrs.sz), cards: num(attrs.cd) };

    switch (a) {
      case "hello":
        this.names[username] = attrs.n || username;
        if (attrs.f) this.bouilles[username] = attrs.f;
        if (this.getStreak && this.streaks[username] === undefined) {
          try { this.streaks[username] = this.getStreak(username) || 0; } catch (e) {}
        }
        this.lobby.addPlayer(username, this.names[username]);
        // déjà en partie (reconnexion pendant une partie) → renvoyer l'état
        sess = this._sessionOf(username);
        if (sess) out.push({ to: [username], xml: this._startXml(sess, username) });
        return out.concat(this._lobbyBroadcast());

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
        // Défier = lancer la partie directement (modèle Grapiz).
        var rc = this.lobby.challenge(username, attrs.u, params);
        if (!rc.ok) return [this._err(username, rc.error)];
        var ra = this.lobby.acceptChallenge(attrs.u, rc.challengeId);
        if (!ra.ok) return [this._err(username, ra.error)];
        return this._startSession(ra.game).concat(this._lobbyBroadcast());
      }

      case "choose": {                              // draft : prendre une carte
        sess = this._sessionOf(username);
        if (!sess) return [this._err(username, "not-in-game")];
        return this._afterAction(sess, sess.requestChooseCard(username, num(attrs.c), this.clock()), username);
      }

      case "play": {                                // jouer une fruticarte
        sess = this._sessionOf(username);
        if (!sess) return [this._err(username, "not-in-game")];
        return this._afterAction(sess, sess.requestPlayCard(username, num(attrs.c), num(attrs.x), num(attrs.y), this.clock()), username);
      }

      case "move": {                                // bouger ses fruits
        sess = this._sessionOf(username);
        if (!sess) return [this._err(username, "not-in-game")];
        return this._afterAction(sess, sess.requestMove(username, num(attrs.d), this.clock()), username);
      }

      case "part": {                                // abandon / quitter
        var pp = this.lobby.getPlayer(username);
        if (pp && pp.gameId && this.sessions[pp.gameId]) {
          var s2 = this.sessions[pp.gameId];
          s2.forfeit(username);
          return this._concludeGame(s2, this._eventMessages(s2, [{ type: "end", winner: s2.winner, to: "all" }]));
        }
        this.lobby.partGame(username);
        return this._lobbyBroadcast();
      }

      case "say": {                                 // chat du lobby
        if (!attrs.m) return [];
        var to = this.lobby.listPlayers().filter(function (pl) { return pl.status !== "playing"; }).map(function (pl) { return pl.id; });
        return [{ to: to, xml: '<bd e="chat" u="' + esc(this.names[username] || username) + '" m="' + esc(attrs.m) + '"/>' }];
      }

      case "gsay": {                                // chat en partie
        if (!attrs.m) return [];
        sess = this._sessionOf(username);
        if (!sess) return [];
        return [{ to: this._ids(sess), xml: '<bd e="gchat" u="' + esc(this.names[username] || username) + '" m="' + esc(attrs.m) + '"/>' }];
      }

      default:
        return [this._err(username, "unknown-action")];
    }
  };

  // Déconnexion (= quitter Frutibandas) : abandon si en partie ; sinon la
  // série en cours prend fin (enregistrée + remise à 0).
  BandasNet.prototype.onDisconnect = function (username) {
    var rm = this.lobby.removePlayer(username);
    if (!rm || !rm.ok) { delete this.streaks[username]; delete this._beaten[username]; return []; }
    if (rm.playingGameId && this.sessions[rm.playingGameId]) {
      var sess = this.sessions[rm.playingGameId];
      sess.forfeit(username);
      var out = this._concludeGame(sess, this._eventMessages(sess, [{ type: "end", winner: sess.winner, to: "all" }]));
      delete this.streaks[username];
      delete this._beaten[username];
      return out;
    }
    if ((this.streaks[username] || 0) > 0) this._fireStreak(username, 0, this.streaks[username]);
    delete this.streaks[username];
    delete this._beaten[username];
    return this._lobbyBroadcast();
  };

  // Tick périodique : timeouts d'horloge + coups des bots.
  BandasNet.prototype.tick = function (now) {
    if (now === undefined) now = this.clock();
    var out = [];
    Object.keys(this.sessions).forEach(function (id) {
      var sess = this.sessions[id];
      if (!sess || sess.ended) return;
      var to = sess.tick(now);
      if (to && to.ended) {
        out = out.concat(this._concludeGame(sess, this._eventMessages(sess, to.events)));
        return;
      }
      out = out.concat(this._tickBot(sess, now));
    }, this);
    return out;
  };

  // Fait jouer le bot quand c'est son tour, après un délai naturel (≈0,8-2,3 s).
  BandasNet.prototype._tickBot = function (sess, now) {
    var p = sess.playerOfTeam(sess.game.currentTeam);
    if (!p || !this.bots[p.id]) { sess._botAt = null; return []; }
    if (!sess._botAt) { sess._botAt = now + 800 + Math.floor(this._rng() * 1500); return []; }
    if (now < sess._botAt) return [];
    sess._botAt = null;
    var skill = (sess._botSkill && sess._botSkill[p.id]); if (skill == null) skill = 0.5;

    var res;
    if (sess.game.phase === G.PHASE_CARD_SELECTION) {
      res = sess.requestChooseCard(p.id, Bot.chooseDraft(sess.game.pool, skill, this._rng), now);
    } else {
      var cardPlay = !sess.game.cardPlayedThisTurn && Bot.chooseCardPlay(sess.game, p.team, skill, this._rng);
      if (cardPlay) {
        res = sess.requestPlayCard(p.id, cardPlay.card, cardPlay.x, cardPlay.y, now);
        if (!res.ok) res = null;       // cible refusée → on bougera au prochain tick
      }
      if (!res) res = sess.requestMove(p.id, Bot.chooseMove(sess.game.board, p.team, skill, this._rng), now);
    }
    if (!res || !res.ok) { sess._botAt = now + 400; return []; }
    var msgs = this._eventMessages(sess, res.events || []);
    if (res.ended || sess.ended) return this._concludeGame(sess, msgs);
    return msgs;
  };

  return { BandasNet: BandasNet, BOTS: BOTS };
});
