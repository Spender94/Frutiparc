//
// Frutibandas — lobby / appariements (même modèle que le lobby Grapiz).
//
// Des joueurs, des parties ouvertes (salons) créées avec des paramètres
// (temps par équipe, taille de plateau, cartes par joueur — cf.
// CreateParameters.as : time [600,480,400,240] s, size [8,7,6,5],
// cards [4,3,2,1]) et des défis directs. Quand une partie est complète,
// elle passe en "playing" — le transport instancie alors une BandasSession.
//
// Logique pure (aucune dépendance au transport) ; câblage WebSocket dans
// server.js via net.js.
//
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else (root.Bandas = root.Bandas || {}).lobby = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var TIME_CHOICES = [600, 480, 400, 240];   // secondes par équipe
  var SIZE_CHOICES = [8, 7, 6, 5];
  var CARD_CHOICES = [4, 3, 2, 1];

  function defaultParams(p) {
    p = p || {};
    return {
      nbrPlayers: 2,
      time: (TIME_CHOICES.indexOf(p.time) >= 0 ? p.time : TIME_CHOICES[0]) * 1000,
      boardSize: SIZE_CHOICES.indexOf(p.boardSize) >= 0 ? p.boardSize : SIZE_CHOICES[0],
      cards: CARD_CHOICES.indexOf(p.cards) >= 0 ? p.cards : CARD_CHOICES[0],
    };
  }

  function BandasLobby() {
    this.players = {};     // id → { id, name, status:'idle'|'waiting'|'playing', gameId }
    this.games = {};       // id → { id, host, params, players:[id], status }
    this.challenges = {};  // id → { id, from, to, params, status:'pending' }
    this._seq = 0;
  }

  BandasLobby.prototype._id = function (prefix) { return prefix + (++this._seq); };

  // ── Joueurs ───────────────────────────────────────────────────────────────
  BandasLobby.prototype.addPlayer = function (id, name) {
    if (this.players[id]) { this.players[id].name = name; return { ok: true, player: this.players[id] }; }
    this.players[id] = { id: id, name: name, status: "idle", gameId: null };
    return { ok: true, player: this.players[id] };
  };

  BandasLobby.prototype.getPlayer = function (id) { return this.players[id] || null; };
  BandasLobby.prototype.getGame = function (id) { return this.games[id] || null; };

  // Déconnexion : annule défis + partie ouverte hébergée, signale une partie
  // EN COURS (le transport l'abandonne via la Session).
  BandasLobby.prototype.removePlayer = function (id) {
    var p = this.players[id];
    if (!p) return { ok: false, error: "unknown-player" };
    var notify = {}, playingGameId = null, cancelledGameId = null;

    for (var cid in this.challenges) {
      var ch = this.challenges[cid];
      if (ch.from === id || ch.to === id) {
        var other = ch.from === id ? ch.to : ch.from;
        if (this.players[other]) notify[other] = true;
        delete this.challenges[cid];
      }
    }

    if (p.gameId && this.games[p.gameId]) {
      var g = this.games[p.gameId];
      if (g.status === "playing") {
        playingGameId = g.id;
      } else if (g.status === "open") {
        if (g.host === id) {
          cancelledGameId = g.id;
          g.players.forEach(function (pid) { if (pid !== id && this.players[pid]) { this.players[pid].status = "idle"; this.players[pid].gameId = null; notify[pid] = true; } }, this);
          g.status = "ended";
          delete this.games[g.id];
        } else {
          g.players = g.players.filter(function (pid) { return pid !== id; });
          if (this.players[g.host]) notify[g.host] = true;
        }
      }
    }

    delete this.players[id];
    return { ok: true, playingGameId: playingGameId, cancelledGameId: cancelledGameId, notify: Object.keys(notify) };
  };

  // ── Parties ouvertes (salons) ──────────────────────────────────────────────
  BandasLobby.prototype.createGame = function (hostId, params) {
    var p = this.players[hostId];
    if (!p) return { ok: false, error: "unknown-player" };
    if (p.status !== "idle") return { ok: false, error: "already-busy" };
    var g = { id: this._id("g"), host: hostId, params: defaultParams(params), players: [hostId], status: "open" };
    this.games[g.id] = g;
    p.status = "waiting"; p.gameId = g.id;
    return { ok: true, gameId: g.id, game: g };
  };

  BandasLobby.prototype.joinGame = function (playerId, gameId) {
    var p = this.players[playerId], g = this.games[gameId];
    if (!p) return { ok: false, error: "unknown-player" };
    if (!g || g.status !== "open") return { ok: false, error: "no-such-open-game" };
    if (p.status !== "idle") return { ok: false, error: "already-busy" };
    if (g.players.indexOf(playerId) >= 0) return { ok: false, error: "already-in" };

    g.players.push(playerId);
    p.status = "waiting"; p.gameId = g.id;

    if (g.players.length >= g.params.nbrPlayers) {
      g.status = "playing";
      g.players.forEach(function (pid) { if (this.players[pid]) this.players[pid].status = "playing"; }, this);
      return { ok: true, started: true, game: g, notify: g.players.slice() };
    }
    return { ok: true, started: false, game: g, notify: g.players.slice() };
  };

  // ── Défis directs ──────────────────────────────────────────────────────────
  BandasLobby.prototype.challenge = function (fromId, toId, params) {
    var a = this.players[fromId], b = this.players[toId];
    if (!a || !b) return { ok: false, error: "unknown-player" };
    if (fromId === toId) return { ok: false, error: "self-challenge" };       // 1526
    if (a.status !== "idle") return { ok: false, error: "challenger-busy" };  // 1527
    if (b.status !== "idle") return { ok: false, error: "target-busy" };
    var ch = { id: this._id("c"), from: fromId, to: toId, params: defaultParams(params), status: "pending" };
    this.challenges[ch.id] = ch;
    return { ok: true, challengeId: ch.id, challenge: ch, notify: [toId] };
  };

  BandasLobby.prototype.acceptChallenge = function (toId, challengeId) {
    var ch = this.challenges[challengeId];
    if (!ch || ch.to !== toId || ch.status !== "pending") return { ok: false, error: "no-such-challenge" };
    var a = this.players[ch.from], b = this.players[ch.to];
    if (!a || !b) { delete this.challenges[challengeId]; return { ok: false, error: "player-gone" }; }
    if (a.status !== "idle" || b.status !== "idle") { delete this.challenges[challengeId]; return { ok: false, error: "player-busy" }; }

    var g = { id: this._id("g"), host: ch.from, params: ch.params, players: [ch.from, ch.to], status: "playing" };
    this.games[g.id] = g;
    a.status = "playing"; a.gameId = g.id;
    b.status = "playing"; b.gameId = g.id;
    delete this.challenges[challengeId];
    return { ok: true, game: g, notify: [ch.from, ch.to] };
  };

  BandasLobby.prototype.declineChallenge = function (toId, challengeId) {
    var ch = this.challenges[challengeId];
    if (!ch || ch.to !== toId) return { ok: false, error: "no-such-challenge" };
    delete this.challenges[challengeId];
    return { ok: true, notify: [ch.from] };
  };

  // Quitter sa partie courante SANS quitter le lobby.
  BandasLobby.prototype.partGame = function (playerId) {
    var p = this.players[playerId];
    if (!p || !p.gameId) return { ok: false, error: "not-in-game" };
    var g = this.games[p.gameId];
    if (!g) { p.status = "idle"; p.gameId = null; return { ok: true, notify: [] }; }
    if (g.status === "playing") return { ok: true, playingGameId: g.id };
    var notify = {};
    if (g.host === playerId) {
      g.players.forEach(function (pid) {
        if (this.players[pid]) { this.players[pid].status = "idle"; this.players[pid].gameId = null; if (pid !== playerId) notify[pid] = true; }
      }, this);
      g.status = "ended"; delete this.games[g.id];
      return { ok: true, cancelledGameId: g.id, notify: Object.keys(notify) };
    }
    g.players = g.players.filter(function (pid) { return pid !== playerId; });
    p.status = "idle"; p.gameId = null;
    if (this.players[g.host]) notify[g.host] = true;
    return { ok: true, notify: Object.keys(notify) };
  };

  // ── Fin de partie : libère les joueurs ─────────────────────────────────────
  BandasLobby.prototype.endGame = function (gameId) {
    var g = this.games[gameId];
    if (!g) return { ok: false, error: "no-such-game" };
    var players = g.players.slice();
    players.forEach(function (pid) { if (this.players[pid]) { this.players[pid].status = "idle"; this.players[pid].gameId = null; } }, this);
    g.status = "ended";
    delete this.games[gameId];
    return { ok: true, notify: players };
  };

  // ── Listings ───────────────────────────────────────────────────────────────
  BandasLobby.prototype.listOpenGames = function () {
    var out = [];
    for (var id in this.games) {
      var g = this.games[id];
      if (g.status === "open") out.push({ id: g.id, host: g.host, params: g.params, count: g.players.length, max: g.params.nbrPlayers });
    }
    return out;
  };
  BandasLobby.prototype.listPlayers = function () {
    var out = [];
    for (var id in this.players) {
      var p = this.players[id];
      out.push({ id: p.id, name: p.name, status: p.status });
    }
    return out;
  };

  return { BandasLobby: BandasLobby, defaultParams: defaultParams, TIME_CHOICES: TIME_CHOICES, SIZE_CHOICES: SIZE_CHOICES, CARD_CHOICES: CARD_CHOICES };
});
