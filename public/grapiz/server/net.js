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
  var api = factory(L, S);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else (root.Grapiz = root.Grapiz || {}).net = api;
})(typeof self !== "undefined" ? self : this, function (L, S) {
  "use strict";

  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function num(v, dflt) { var n = parseInt(v, 10); return isNaN(n) ? dflt : n; }

  // opts : { clock?:()=>ms, onResult?:(game, winnerTeam, reason)=>void }
  function GrapizNet(opts) {
    opts = opts || {};
    this.lobby = new L.GrapizLobby();
    this.sessions = {};                 // gameId → GrapizSession
    this.names = {};                    // username → displayName
    this.bouilles = {};                 // username → état de frutibouille (24 car.)
    this.clock = opts.clock || function () { return Date.now(); };
    this.onResult = opts.onResult || function () {};   // hook classement
  }

  // ── Sérialisation ──────────────────────────────────────────────────────────
  GrapizNet.prototype._lobbyXml = function () {
    var games = this.lobby.listOpenGames().map(function (g) {
      return '<game id="' + esc(g.id) + '" host="' + esc(g.host) + '" c="' + g.count +
        '" m="' + g.max + '" t="' + g.params.time + '" sz="' + g.params.boardSize + '"/>';
    }).join("");
    var players = this.lobby.listPlayers().map(function (p) {
      return '<pl u="' + esc(p.id) + '" n="' + esc(p.name || p.id) + '" s="' + esc(p.status) + '"/>';
    }).join("");
    return "<gz e=\"lobby\">" + players + games + "</gz>";
  };

  GrapizNet.prototype._stateXml = function (session, evt, extra) {
    var snap = session.snapshot(this.clock());
    var toks = snap.board.map(function (t) { return '<t e="' + t.team + '" x="' + t.x + '" y="' + t.y + '"/>'; }).join("");
    var pls = snap.players.map(function (p) {
      return '<p u="' + esc(p.id) + '" n="' + esc(p.name) + '" e="' + p.team +
        '" rt="' + p.remaining + '" f="' + esc(p.fb || "") + '"/>';
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
    this.sessions[game.id] = sess;
    return [{ to: game.players.slice(), xml: this._stateXml(sess, "start") }];
  };

  // Fin de partie : hook classement + libère le lobby + diffuse la nouvelle liste.
  GrapizNet.prototype._finish = function (session) {
    try { this.onResult(session, session.winner, session.endReason); } catch (e) {}
    this.lobby.endGame(session.id);
    delete this.sessions[session.id];
    return this._lobbyBroadcast();
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

      case "challenge":
        r = this.lobby.challenge(username, attrs.u, params);
        if (!r.ok) return [this._err(username, r.error)];
        return [
          { to: [attrs.u], xml: '<gz e="challenged" c="' + esc(r.challengeId) + '" u="' + esc(username) + '" n="' + esc(this.names[username] || username) + '"/>' },
          { to: [username], xml: '<gz e="sent" u="' + esc(attrs.u) + '"/>' },
        ];

      case "accept":
        r = this.lobby.acceptChallenge(username, attrs.c);
        if (!r.ok) return [this._err(username, r.error)];
        return this._startSession(r.game).concat(this._lobbyBroadcast());

      case "decline":
        r = this.lobby.declineChallenge(username, attrs.c);
        if (!r.ok) return [this._err(username, r.error)];
        return [{ to: r.notify, xml: '<gz e="declined" u="' + esc(username) + '"/>' }];

      case "move": {
        var p = this.lobby.getPlayer(username);
        if (!p || !p.gameId || !this.sessions[p.gameId]) return [this._err(username, "not-in-game")];
        var sess = this.sessions[p.gameId];
        var res = sess.requestMove(username, num(attrs.x), num(attrs.y), num(attrs.d), this.clock());
        if (!res.ok) return [this._err(username, res.error)];
        out.push({ to: this._ids(sess), xml: this._stateXml(sess, res.ended ? "end" : "move") });
        if (res.ended) out = out.concat(this._finish(sess));
        return out;
      }

      case "part": {
        var pp = this.lobby.getPlayer(username);
        if (pp && pp.gameId && this.sessions[pp.gameId]) {           // partie en cours → forfait
          var s2 = this.sessions[pp.gameId];
          s2.forfeit(username);
          out.push({ to: this._ids(s2), xml: this._stateXml(s2, "end") });
          return out.concat(this._finish(s2));
        }
        this.lobby.partGame(username);                              // partie ouverte → quitte
        return this._lobbyBroadcast();
      }

      default:
        return [this._err(username, "unknown-action")];
    }
  };

  // Déconnexion : abandon si en partie, puis nettoyage lobby.
  GrapizNet.prototype.onDisconnect = function (username) {
    var out = [];
    var rm = this.lobby.removePlayer(username);
    if (!rm || !rm.ok) return out;
    if (rm.playingGameId && this.sessions[rm.playingGameId]) {
      var sess = this.sessions[rm.playingGameId];
      sess.forfeit(username);
      out.push({ to: this._ids(sess), xml: this._stateXml(sess, "end") });
      try { this.onResult(sess, sess.winner, sess.endReason); } catch (e) {}
      this.lobby.endGame(rm.playingGameId);
      delete this.sessions[rm.playingGameId];
    }
    return out.concat(this._lobbyBroadcast());
  };

  // Tick périodique des horloges : termine les parties dont le temps est écoulé.
  GrapizNet.prototype.tick = function (now) {
    if (now === undefined) now = this.clock();
    var out = [];
    for (var id in this.sessions) {
      var sess = this.sessions[id];
      var to = sess.tick(now);
      if (to && to.ended) {
        out.push({ to: this._ids(sess), xml: this._stateXml(sess, "end") });
        out = out.concat(this._finish(sess));
      }
    }
    return out;
  };

  return { GrapizNet: GrapizNet };
});
