//
// Grapiz — lobby / appariements (matchmaking côté serveur).
//
// La « zone d'appariements » que le remake n'avait pas. Reprend le modèle de
// NetworkController.as : des joueurs, des parties ouvertes (salons) qu'on crée
// avec des paramètres et qu'on rejoint, et des DÉFIS directs entre joueurs.
// Quand une partie est complète (createGame rejointe, ou défi accepté), elle
// passe en "playing" — le transport instancie alors une GrapizSession.
//
// Logique pure (aucune dépendance au transport) : chaque méthode renvoie un
// résultat structuré décrivant la transition + les joueurs à notifier (`notify`).
// Le câblage WebSocket (envoi réel) est fait dans server.js.
//
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else (root.Grapiz = root.Grapiz || {}).lobby = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function defaultParams(p) {
    p = p || {};
    return {
      nbrPlayers: p.nbrPlayers || 2,
      time: p.time || 300000,
      boardSize: p.boardSize || 4,
    };
  }

  function GrapizLobby() {
    this.players = {};     // id → { id, name, fb, status:'idle'|'waiting'|'playing', gameId }
    this.games = {};       // id → { id, host, params, players:[id], status:'open'|'playing'|'ended' }
    this.challenges = {};  // id → { id, from, to, params, status:'pending' }
    this._seq = 0;
  }

  GrapizLobby.prototype._id = function (prefix) { return prefix + (++this._seq); };

  // ── Joueurs ───────────────────────────────────────────────────────────────
  GrapizLobby.prototype.addPlayer = function (id, name, fb) {
    if (this.players[id]) { this.players[id].name = name; return { ok: true, player: this.players[id] }; }
    this.players[id] = { id: id, name: name, fb: fb || "", status: "idle", gameId: null };
    return { ok: true, player: this.players[id] };
  };

  GrapizLobby.prototype.getPlayer = function (id) { return this.players[id] || null; };
  GrapizLobby.prototype.getGame = function (id) { return this.games[id] || null; };

  // Déconnexion : annule défis + partie ouverte hébergée, signale une éventuelle
  // partie EN COURS (le transport l'abandonne via la Session).
  GrapizLobby.prototype.removePlayer = function (id) {
    var p = this.players[id];
    if (!p) return { ok: false, error: "unknown-player" };
    var notify = {}, playingGameId = null, cancelledGameId = null;

    // défis impliquant ce joueur
    for (var cid in this.challenges) {
      var ch = this.challenges[cid];
      if (ch.from === id || ch.to === id) {
        var other = ch.from === id ? ch.to : ch.from;
        if (this.players[other]) notify[other] = true;
        delete this.challenges[cid];
      }
    }

    // partie courante
    if (p.gameId && this.games[p.gameId]) {
      var g = this.games[p.gameId];
      if (g.status === "playing") {
        playingGameId = g.id;            // le transport fera session.forfeit
      } else if (g.status === "open") {
        if (g.host === id) {             // l'hôte part → on annule la partie ouverte
          cancelledGameId = g.id;
          g.players.forEach(function (pid) { if (pid !== id && this.players[pid]) { this.players[pid].status = "idle"; this.players[pid].gameId = null; notify[pid] = true; } }, this);
          g.status = "ended";
          delete this.games[g.id];
        } else {                          // simple participant → il quitte
          g.players = g.players.filter(function (pid) { return pid !== id; });
          if (this.players[g.host]) notify[g.host] = true;
        }
      }
    }

    delete this.players[id];
    return { ok: true, playingGameId: playingGameId, cancelledGameId: cancelledGameId, notify: Object.keys(notify) };
  };

  // ── Parties ouvertes (salons) ──────────────────────────────────────────────
  GrapizLobby.prototype.createGame = function (hostId, params) {
    var p = this.players[hostId];
    if (!p) return { ok: false, error: "unknown-player" };
    if (p.status !== "idle") return { ok: false, error: "already-busy" };
    var g = { id: this._id("g"), host: hostId, params: defaultParams(params), players: [hostId], status: "open" };
    this.games[g.id] = g;
    p.status = "waiting"; p.gameId = g.id;
    return { ok: true, gameId: g.id, game: g };
  };

  GrapizLobby.prototype.joinGame = function (playerId, gameId) {
    var p = this.players[playerId], g = this.games[gameId];
    if (!p) return { ok: false, error: "unknown-player" };
    if (!g || g.status !== "open") return { ok: false, error: "no-such-open-game" };
    if (p.status !== "idle") return { ok: false, error: "already-busy" };
    if (g.players.indexOf(playerId) >= 0) return { ok: false, error: "already-in" };

    g.players.push(playerId);
    p.status = "waiting"; p.gameId = g.id;

    if (g.players.length >= g.params.nbrPlayers) {     // complète → on démarre
      g.status = "playing";
      g.players.forEach(function (pid) { if (this.players[pid]) this.players[pid].status = "playing"; }, this);
      return { ok: true, started: true, game: g, notify: g.players.slice() };
    }
    return { ok: true, started: false, game: g, notify: g.players.slice() };
  };

  // ── Défis directs ──────────────────────────────────────────────────────────
  GrapizLobby.prototype.challenge = function (fromId, toId, params) {
    var a = this.players[fromId], b = this.players[toId];
    if (!a || !b) return { ok: false, error: "unknown-player" };
    if (fromId === toId) return { ok: false, error: "self-challenge" };
    if (a.status !== "idle") return { ok: false, error: "challenger-busy" };
    if (b.status !== "idle") return { ok: false, error: "target-busy" };
    var ch = { id: this._id("c"), from: fromId, to: toId, params: defaultParams(params), status: "pending" };
    this.challenges[ch.id] = ch;
    return { ok: true, challengeId: ch.id, challenge: ch, notify: [toId] };
  };

  GrapizLobby.prototype.acceptChallenge = function (toId, challengeId) {
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

  GrapizLobby.prototype.declineChallenge = function (toId, challengeId) {
    var ch = this.challenges[challengeId];
    if (!ch || ch.to !== toId) return { ok: false, error: "no-such-challenge" };
    delete this.challenges[challengeId];
    return { ok: true, notify: [ch.from] };
  };

  // Quitter sa partie courante SANS se déconnecter du lobby. Pour une partie EN
  // COURS, renvoie playingGameId (le transport abandonne via la Session) ; pour
  // une partie ouverte, annule (hôte) ou retire le participant.
  GrapizLobby.prototype.partGame = function (playerId) {
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
  GrapizLobby.prototype.endGame = function (gameId) {
    var g = this.games[gameId];
    if (!g) return { ok: false, error: "no-such-game" };
    var players = g.players.slice();
    players.forEach(function (pid) { if (this.players[pid]) { this.players[pid].status = "idle"; this.players[pid].gameId = null; } }, this);
    g.status = "ended";
    delete this.games[gameId];
    return { ok: true, notify: players };
  };

  // ── Listings (snapshots pour le client) ────────────────────────────────────
  GrapizLobby.prototype.listOpenGames = function () {
    var out = [];
    for (var id in this.games) {
      var g = this.games[id];
      if (g.status === "open") out.push({ id: g.id, host: g.host, params: g.params, count: g.players.length, max: g.params.nbrPlayers });
    }
    return out;
  };
  GrapizLobby.prototype.listPlayers = function () {
    var out = [];
    for (var id in this.players) {
      var p = this.players[id];
      out.push({ id: p.id, name: p.name, status: p.status });
    }
    return out;
  };

  return { GrapizLobby: GrapizLobby, defaultParams: defaultParams };
});
