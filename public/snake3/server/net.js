//
// Frutisnake Battle en ligne — le pont réseau (la « cervelle » côté serveur).
//
// Le modèle de Grapiz et de Frutibandas : ce module possède le salon
// (lobby.js), les sessions de bataille (session.js), les SÉRIES de victoires
// et les bots, et traduit chaque action d'un client en une liste de messages
// { to:[usernames], xml } que le transport (server.js) enverra. Aucune
// socket ici → entièrement testable. L'identité d'un joueur = son username.
//
// Protocole (XML sur le WebSocket existant, balise <sb>) :
//   client → serveur : <sb a="hello|list|seek|cancel|challenge|input|part|say" …/>
//   serveur → client : <sb e="lobby|start|state|end|chat|err" …> … </sb>
//
// La partie tourne SUR LE SERVEUR à quarante pas par seconde (session.js) ;
// `tick(now)` la fait avancer et rend, pour chaque pas, l'état à pousser aux
// deux joueurs. Un client n'envoie que ses touches (`input`), quand elles
// changent.
//
// LA SÉRIE — le gros nombre doré de Grapiz et de Bandas : des victoires
// d'affilée. Battre un adversaire la fait monter (chaque humain ne compte
// qu'une fois par série — anti-complice ; un bot compte à chaque fois, le
// serveur le tient) ; perdre, abandonner ou se déconnecter la termine, et
// sa longueur part au classement « Frutisnake - Battle » (onStreak, zéro
// compris). Une égalité — les deux têtes tombent au même pas — ne change
// rien pour personne.
//
(function (root, factory) {
  var L = (typeof require !== "undefined") ? require("./lobby.js") : (root.SnakeBattle && root.SnakeBattle.lobby);
  var S = (typeof require !== "undefined") ? require("./session.js") : (root.SnakeBattle && root.SnakeBattle.session);
  var B = (typeof require !== "undefined") ? require("./bot.js") : (root.SnakeBattle && root.SnakeBattle.bot);
  var api = factory(L, S, B);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else (root.SnakeBattle = root.SnakeBattle || {}).net = api;
})(typeof self !== "undefined" ? self : this, function (L, S, Bot) {
  "use strict";

  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function n1(v) { return Math.round(v * 10) / 10; }      // un décimal (positions)
  function n3(v) { return Math.round(v * 1000) / 1000; }  // trois (angles, jauges)

  // Les bots, toujours là. Même plage de niveau pour tous, tirée par partie.
  var BOT_SKILL = { lo: 0.45, hi: 1.0 };
  var BOTS = [
    { id: "sifflet", name: "Sifflet", fb: "0006000U040L0N0000000000" },
    { id: "viperine", name: "Vipérine", fb: "0006010Y040N0L0000000000" },
  ];

  // opts : { clock?, rng?, withBots?, objets?, onResult?, getStreak?, onStreak?,
  //          onMatchForming?, onDiscLost?, onDefi?, botIdentity? }
  function SnakeNet(opts) {
    opts = opts || {};
    this.lobby = new L.SnakeLobby();
    this.sessions = {};                 // gameId → SnakeBattleSession
    this.names = {};                    // username → nom affiché
    this.bouilles = {};                 // username → frutibouille
    this.streaks = {};                  // username → série EN COURS
    this._beaten = {};                  // username → { adversaire: true } battus pendant la série
    this.bots = {};                     // username → true
    this._botNeuf = {};
    this._botEtats = {};                // gameId → { bot: état de décision }
    this.clock = opts.clock || function () { return Date.now(); };
    this._rng = opts.rng || Math.random;
    this.objets = opts.objets;          // surcharge des objets (tests)
    this.onResult = opts.onResult || function () {};
    this.getStreak = opts.getStreak || null;
    this.onStreak = opts.onStreak || null;
    this.onMatchForming = opts.onMatchForming || null;
    this.onDiscLost = opts.onDiscLost || null;
    this.onDefi = opts.onDefi || null;
    this.botIdentity = opts.botIdentity || null;
    if (opts.withBots !== false) this._registerBots();
  }

  // ── Les bots empruntent une tête au Bouilloscope (cf. Grapiz) ─────────────
  SnakeNet.prototype._refreshBotIdentities = function () {
    if (!this.botIdentity) return;
    var self = this;
    var deja = BOTS.map(function (b) { return self.names[b.id] || b.name; });
    BOTS.forEach(function (b) {
      var p = self.lobby.getPlayer(b.id);
      if (!self._botNeuf[b.id] || (p && p.status !== "idle")) return;
      var ident = null;
      try { ident = self.botIdentity(deja, self._rng); } catch (e) { ident = null; }
      if (!ident || !ident.name) return;
      self._botNeuf[b.id] = false;
      self.names[b.id] = ident.name;
      if (ident.fb) self.bouilles[b.id] = ident.fb;
      self.lobby.addPlayer(b.id, ident.name);
      deja.push(ident.name);
    });
  };
  SnakeNet.prototype._retireBots = function (session) {
    var self = this;
    (session.players || []).forEach(function (p) { if (self.bots[p.id]) self._botNeuf[p.id] = true; });
  };
  SnakeNet.prototype._registerBots = function () {
    var self = this;
    BOTS.forEach(function (b) {
      self.bots[b.id] = true;
      self.names[b.id] = b.name;
      self.bouilles[b.id] = b.fb;
      self.streaks[b.id] = 0;
      self._botNeuf[b.id] = true;
      self.lobby.addPlayer(b.id, b.name);
    });
    this._refreshBotIdentities();
  };

  // ── Sérialisation ──────────────────────────────────────────────────────────
  SnakeNet.prototype._lobbyXml = function () {
    var self = this;
    var players = this.lobby.listPlayers().map(function (p) {
      return '<pl u="' + esc(p.id) + '" n="' + esc(p.name || p.id) + '" s="' + esc(p.status) +
        '" f="' + esc(self.bouilles[p.id] || "") + '" sr="' + (self.streaks[p.id] || 0) +
        '" bot="' + (self.bots[p.id] ? 1 : 0) + '"/>';
    }).join("");
    return '<sb e="lobby">' + players + "</sb>";
  };

  // L'état d'un pas (ou l'état ENTIER, files comprises, pour `start`).
  SnakeNet.prototype._stateXml = function (session, evt, full) {
    var self = this;
    var snap = session.snapshot(full);
    // Les joueurs ne voyagent qu'au départ et à la fin : ils ne changent pas
    // entre deux pas, et quarante fois par seconde, chaque octet compte.
    var pls = snap.players.map(function (p) {
      return '<p u="' + esc(p.id) + '" n="' + esc(p.name) + '" e="' + p.team +
        '" f="' + esc(p.fb || "") + '" sr="' + (self.streaks[p.id] || 0) + '"/>';
    }).join("");
    var srp = snap.serpents.map(function (s) {
      var a = '<s i="' + s.team + '" x="' + n1(s.x) + '" y="' + n1(s.y) + '" a="' + n3(s.ang) +
        '" v="' + n3(s.speed) + '" l="' + s.len + '" e="' + n3(s.eat) + '" p="' + n3(s.power) +
        '" k="' + (s.vivant ? 1 : 0) + '" q="' + s.q + '" g="' + s.g + '" xp="' + s.xp + '"';
      if (s.fini) a += ' fin="1"';
      if (full && s.queue) {
        a += ' file="' + s.queue.map(function (p) { return n1(p.x) + "," + n1(p.y); }).join(" ") + '"';
      }
      return a + "/>";
    }).join("");
    var obj = snap.objets.map(function (o) {
      return '<o i="' + o.id + '" t="' + (o.type === "bombe" ? "b" : "f") + '" x="' + o.x + '" y="' + o.y +
        '" v="' + n3(o.vie) + '" f="' + o.fid + '"/>';
    }).join("");
    var ex = snap.explosions.map(function (e) { return '<ex x="' + e.x + '" y="' + e.y + '"/>'; }).join("");
    var mg = snap.manges.map(function (m) { return '<mg i="' + m.id + '" e="' + m.e + '"/>'; }).join("");
    return '<sb e="' + evt + '" g="' + esc(snap.id) + '" ph="' + snap.phase + '" cd="' + n3(snap.compte) +
      '" n="' + snap.numero + '" t="' + n3(snap.temps) + '"' +
      (snap.ended ? ' end="1" w="' + snap.winner + '" r="' + esc(snap.endReason) + '"' : "") +
      ">" + (evt === "state" ? "" : pls) + srp + obj + ex + mg + "</sb>";
  };

  SnakeNet.prototype._err = function (username, code) {
    return { to: [username], xml: '<sb e="err" m="' + esc(code) + '"/>' };
  };
  SnakeNet.prototype._lobbyBroadcast = function () {
    var to = this.lobby.listPlayers().map(function (p) { return p.id; });
    return to.length ? [{ to: to, xml: this._lobbyXml() }] : [];
  };
  SnakeNet.prototype._ids = function (session) { return session.players.map(function (p) { return p.id; }); };

  // ── Le départ d'une partie ────────────────────────────────────────────────
  SnakeNet.prototype._startSession = function (game) {
    var self = this;
    var humans = game.players.filter(function (uid) { return !self.bots[uid]; });
    var fdRanked = null;
    if (humans.length && this.onMatchForming) {
      var hasBot = humans.length !== game.players.length;
      var chk;
      try { chk = this.onMatchForming(humans, { hasBot: hasBot, playerCount: game.players.length }); } catch (e) { chk = null; }
      if (chk && chk.ok === false) {
        this.lobby.endGame(game.id);
        var blocked = (chk.blocked && chk.blocked.length) ? chk.blocked : humans;
        return game.players.map(function (uid) {
          return { to: [uid], xml: '<sb e="err" m="' + (blocked.indexOf(uid) >= 0 ? "no-fd" : "opp-no-fd") + '"/>' };
        });
      }
      fdRanked = (chk && chk.ranked) || null;
    }
    var players = game.players.map(function (uid) {
      return { id: uid, name: self.names[uid] || uid, fb: self.bouilles[uid] || "" };
    });
    var sess = new S.SnakeBattleSession({ id: game.id, players: players, now: this.clock(), rng: this._rng, objets: this.objets });
    sess._botSkill = {};
    game.players.forEach(function (uid) {
      if (self.bots[uid]) {
        sess._botSkill[uid] = BOT_SKILL.lo + self._rng() * (BOT_SKILL.hi - BOT_SKILL.lo);
        self.streaks[uid] = Math.floor(self._rng() * 9);    // série « vitrine » (non classée)
      }
    });
    sess._fdRanked = fdRanked;
    this.sessions[game.id] = sess;
    this._botEtats[game.id] = {};
    return [{ to: game.players.slice(), xml: this._stateXml(sess, "start", true) }];
  };

  // ── Les séries (le modèle de Grapiz) ──────────────────────────────────────
  SnakeNet.prototype._updateStreaks = function (session) {
    if (session.winner == null || session.winner < 0 || session.players.length !== 2) return;
    var win = session.playerOfTeam(session.winner);
    var lose = session.players.filter(function (p) { return p.team !== session.winner; })[0];
    if (!win || !lose) return;
    if (this.bots[win.id] && this.bots[lose.id]) return;
    var ranked = session._fdRanked || null;
    var winRanked = !this.bots[win.id] && (!ranked || ranked[win.id] !== false);
    var loseRanked = !this.bots[lose.id] && (!ranked || ranked[lose.id] !== false);

    if (this.bots[win.id]) {
      this.streaks[win.id] = (this.streaks[win.id] || 0) + 1;
    } else if (winRanked) {
      var counts;
      if (this.bots[lose.id]) counts = true;
      else {
        var beaten = this._beaten[win.id] || (this._beaten[win.id] = {});
        counts = !beaten[lose.id];
        if (counts) beaten[lose.id] = true;
      }
      if (counts) {
        var ws = (this.streaks[win.id] || 0) + 1;
        this.streaks[win.id] = ws;
        this._fireStreak(win.id, ws, ws);
      }
    }
    if (this.bots[lose.id]) {
      this.streaks[lose.id] = 0;
    } else if (loseRanked) {
      var ended = this.streaks[lose.id] || 0;
      this.streaks[lose.id] = 0;
      this._beaten[lose.id] = {};
      this._fireStreak(lose.id, 0, ended);
      if (this.onDiscLost) { try { this.onDiscLost(lose.id); } catch (e) {} }
    }
  };
  SnakeNet.prototype._fireStreak = function (user, streak, series) {
    if (this.bots[user]) return;
    if (this.onStreak) { try { this.onStreak(user, streak, { series: series }); } catch (e) {} }
  };

  // Conclut : séries → état final → hook → libère le salon.
  SnakeNet.prototype._concludeGame = function (session) {
    this._updateStreaks(session);
    var msgs = [{ to: this._ids(session), xml: this._stateXml(session, "end") }];
    try { this.onResult(session, session.winner, session.endReason); } catch (e) {}
    this._retireBots(session);
    this.lobby.endGame(session.id);
    this._refreshBotIdentities();
    delete this.sessions[session.id];
    delete this._botEtats[session.id];
    return msgs.concat(this._lobbyBroadcast());
  };

  SnakeNet.prototype._sessionOf = function (username) {
    var p = this.lobby.getPlayer(username);
    if (!p || !p.gameId) return null;
    return this.sessions[p.gameId] || null;
  };

  // ── Dispatch d'une action client ────────────────────────────────────────────
  SnakeNet.prototype.handle = function (username, attrs) {
    attrs = attrs || {};
    var a = attrs.a, r, sess;
    switch (a) {
      case "hello": {
        this.names[username] = attrs.n || username;
        if (attrs.f) this.bouilles[username] = attrs.f;
        if (this.getStreak && this.streaks[username] === undefined) { try { this.streaks[username] = this.getStreak(username) || 0; } catch (e) {} }
        this.lobby.addPlayer(username, this.names[username]);
        this._refreshBotIdentities();
        var out = this._lobbyBroadcast();
        // Reconnexion en pleine partie : l'état entier, files comprises.
        sess = this._sessionOf(username);
        if (sess && !sess.ended) out.push({ to: [username], xml: this._stateXml(sess, "start", true) });
        return out;
      }

      case "list":
        return [{ to: [username], xml: this._lobbyXml() }];

      case "seek":
        r = this.lobby.seek(username);
        if (!r.ok) return [this._err(username, r.error)];
        if (r.started) return this._startSession(r.game).concat(this._lobbyBroadcast());
        return this._lobbyBroadcast();

      case "cancel":
        r = this.lobby.cancel(username);
        return r.ok ? this._lobbyBroadcast() : [this._err(username, r.error)];

      case "challenge": {
        r = this.lobby.challenge(username, attrs.u);
        if (!r.ok) return [this._err(username, r.error)];
        if (this.onDefi && !this.bots[attrs.u]) { try { this.onDefi(username, attrs.u); } catch (e) {} }
        return this._startSession(r.game).concat(this._lobbyBroadcast());
      }

      case "input": {
        sess = this._sessionOf(username);
        if (!sess) return [this._err(username, "not-in-game")];
        sess.setInput(username, { gauche: attrs.g === "1", droite: attrs.d === "1", haut: attrs.h === "1" });
        return [];
      }

      case "part": {
        sess = this._sessionOf(username);
        if (sess && !sess.ended) {
          sess.forfeit(username);
          return this._concludeGame(sess);
        }
        this.lobby.partGame(username);
        return this._lobbyBroadcast();
      }

      case "say": {
        if (!attrs.m) return [];
        var to = this.lobby.listPlayers().filter(function (pl) { return pl.status !== "playing"; }).map(function (pl) { return pl.id; });
        return [{ to: to, xml: '<sb e="chat" u="' + esc(this.names[username] || username) + '" m="' + esc(String(attrs.m).slice(0, 200)) + '"/>' }];
      }

      default:
        return [this._err(username, "unknown-action")];
    }
  };

  // Déconnexion : abandon si en partie ; la série en cours prend fin.
  SnakeNet.prototype.onDisconnect = function (username) {
    var rm = this.lobby.removePlayer(username);
    if (!rm || !rm.ok) { delete this.streaks[username]; delete this._beaten[username]; return []; }
    if (rm.playingGameId && this.sessions[rm.playingGameId]) {
      this.sessions[rm.playingGameId].forfeit(username);
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

  // ── Le tick : quarante fois par seconde ───────────────────────────────────
  SnakeNet.prototype.tick = function (now) {
    if (now === undefined) now = this.clock();
    var out = [];
    Object.keys(this.sessions).forEach(function (id) {
      var sess = this.sessions[id];
      if (!sess) return;
      // Une session déjà pliée (abandon hors tick) se conclut ici, au cas où.
      if (sess.ended) { out = out.concat(this._concludeGame(sess)); return; }
      this._jouerBots(sess);
      var self = this, ids = this._ids(sess);
      sess.avancer(now, function (s) {
        if (!s.ended) out.push({ to: ids, xml: self._stateXml(s, "state") });
      });
      if (sess.ended) out = out.concat(this._concludeGame(sess));
    }, this);
    return out;
  };

  SnakeNet.prototype._jouerBots = function (sess) {
    if (sess.phase !== "jeu") return;
    var etats = this._botEtats[sess.id] || (this._botEtats[sess.id] = {});
    for (var i = 0; i < sess.players.length; i++) {
      var p = sess.players[i];
      if (!this.bots[p.id]) continue;
      var skill = (sess._botSkill && sess._botSkill[p.id]); if (skill == null) skill = 0.7;
      var etat = etats[p.id] || (etats[p.id] = {});
      sess.setInput(p.id, Bot.decider(sess, p.team, skill, this._rng, etat));
    }
  };

  return { SnakeNet: SnakeNet, BOTS: BOTS };
});
