//
// Frutisnake Battle en ligne — le salon (appariements 1 contre 1).
//
// Le modèle de Grapiz et Frutibandas, ramené au strict duel : des joueurs
// présents, une FILE D'ATTENTE (« chercher un adversaire » — le premier qui
// attend est apparié au suivant qui cherche), et des DÉFIS directs qui
// lancent la partie sur-le-champ. Quand deux joueurs sont réunis, la partie
// passe en "playing" et le pont (net.js) instancie une session de bataille.
//
// Logique pure, sans transport : chaque méthode rend un résultat structuré.
//
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else (root.SnakeBattle = root.SnakeBattle || {}).lobby = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function SnakeLobby() {
    this.players = {};     // id → { id, name, status:'idle'|'waiting'|'playing', gameId }
    this.games = {};       // id → { id, host, players:[id], status:'playing'|'ended' }
    this.queue = [];       // ids en file d'attente (ordre d'arrivée)
    this._seq = 0;
  }

  SnakeLobby.prototype._id = function (prefix) { return prefix + (++this._seq); };

  // ── Joueurs ───────────────────────────────────────────────────────────────
  SnakeLobby.prototype.addPlayer = function (id, name) {
    if (this.players[id]) { this.players[id].name = name; return { ok: true, player: this.players[id] }; }
    this.players[id] = { id: id, name: name, status: "idle", gameId: null };
    return { ok: true, player: this.players[id] };
  };
  SnakeLobby.prototype.getPlayer = function (id) { return this.players[id] || null; };
  SnakeLobby.prototype.getGame = function (id) { return this.games[id] || null; };

  SnakeLobby.prototype._unqueue = function (id) {
    var i = this.queue.indexOf(id);
    if (i >= 0) this.queue.splice(i, 1);
  };

  // Déconnexion : sort de la file, signale une partie EN COURS (le transport
  // l'abandonne via la session).
  SnakeLobby.prototype.removePlayer = function (id) {
    var p = this.players[id];
    if (!p) return { ok: false, error: "unknown-player" };
    this._unqueue(id);
    var playingGameId = null;
    if (p.gameId && this.games[p.gameId] && this.games[p.gameId].status === "playing") playingGameId = p.gameId;
    delete this.players[id];
    return { ok: true, playingGameId: playingGameId };
  };

  // ── La partie de deux ─────────────────────────────────────────────────────
  SnakeLobby.prototype._startGame = function (a, b) {
    var g = { id: this._id("g"), host: a, players: [a, b], status: "playing" };
    this.games[g.id] = g;
    this.players[a].status = "playing"; this.players[a].gameId = g.id;
    this.players[b].status = "playing"; this.players[b].gameId = g.id;
    return g;
  };

  // ── La file d'attente ─────────────────────────────────────────────────────
  // « Chercher un adversaire » : s'il y a déjà quelqu'un qui attend, la partie
  // part tout de suite ; sinon on prend place dans la file.
  SnakeLobby.prototype.seek = function (id) {
    var p = this.players[id];
    if (!p) return { ok: false, error: "unknown-player" };
    if (p.status === "playing") return { ok: false, error: "already-busy" };
    if (p.status === "waiting") return { ok: true, started: false, waiting: true };
    for (var i = 0; i < this.queue.length; i++) {
      var other = this.queue[i];
      if (other === id || !this.players[other] || this.players[other].status !== "waiting") continue;
      this.queue.splice(i, 1);
      this.players[other].status = "idle";
      var g = this._startGame(other, id);
      return { ok: true, started: true, game: g };
    }
    p.status = "waiting";
    this.queue.push(id);
    return { ok: true, started: false, waiting: true };
  };

  // Quitter la file (ou ne rien faire si l'on n'y est pas).
  SnakeLobby.prototype.cancel = function (id) {
    var p = this.players[id];
    if (!p) return { ok: false, error: "unknown-player" };
    if (p.status === "playing") return { ok: false, error: "already-busy" };
    this._unqueue(id);
    p.status = "idle";
    return { ok: true };
  };

  // ── Défis directs : la partie démarre aussitôt ────────────────────────────
  SnakeLobby.prototype.challenge = function (fromId, toId) {
    var a = this.players[fromId], b = this.players[toId];
    if (!a || !b) return { ok: false, error: "unknown-player" };
    if (fromId === toId) return { ok: false, error: "self-challenge" };
    if (a.status === "playing") return { ok: false, error: "challenger-busy" };
    if (b.status === "playing") return { ok: false, error: "target-busy" };
    this._unqueue(fromId); this._unqueue(toId);
    a.status = "idle"; b.status = "idle";
    return { ok: true, game: this._startGame(fromId, toId) };
  };

  // Quitter sa partie EN COURS sans se déconnecter : rend playingGameId (le
  // transport abandonne via la session) ; en attente → sort de la file.
  SnakeLobby.prototype.partGame = function (id) {
    var p = this.players[id];
    if (!p) return { ok: false, error: "unknown-player" };
    if (p.gameId && this.games[p.gameId] && this.games[p.gameId].status === "playing") {
      return { ok: true, playingGameId: p.gameId };
    }
    this._unqueue(id);
    p.status = "idle"; p.gameId = null;
    return { ok: true };
  };

  // ── Fin de partie : libère les deux ───────────────────────────────────────
  SnakeLobby.prototype.endGame = function (gameId) {
    var g = this.games[gameId];
    if (!g) return { ok: false, error: "no-such-game" };
    g.players.forEach(function (pid) {
      if (this.players[pid]) { this.players[pid].status = "idle"; this.players[pid].gameId = null; }
    }, this);
    g.status = "ended";
    delete this.games[gameId];
    return { ok: true, notify: g.players.slice() };
  };

  // ── Listing ───────────────────────────────────────────────────────────────
  SnakeLobby.prototype.listPlayers = function () {
    var out = [];
    for (var id in this.players) {
      var p = this.players[id];
      out.push({ id: p.id, name: p.name, status: p.status });
    }
    return out;
  };

  return { SnakeLobby: SnakeLobby };
});
