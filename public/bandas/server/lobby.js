//
// Frutibandas — lobby / appariements (même modèle que le lobby Grapiz).
//
// Des joueurs, des parties ouvertes (salons) créées avec des paramètres
// (temps par équipe, taille de plateau, cartes par joueur — cf.
// CreateParameters.as : time [600,480,400,240] s, size [8,7,6,5],
// cards [3,2,1]) et des défis directs. Quand une partie est complète,
// elle passe en "playing" — le transport instancie alors une BandasSession.
//
// LES TROIS SALLES. Le jeu d'origine n'avait pas un lobby mais trois, un par
// mode (frutibandas/Main.as) : FREE_MODE = 0 « matches amicaux »,
// CHALLENGE_MODE = 1 « challenge », CHAMPION_MODE = 2 « championnat ». On
// rejoignait une salle (`joinRoom`) et son mode gouvernait tout le reste —
// Manager.as ne quitte proprement (`partGame`) qu'en dehors du challenge, et
// FruticardSlot.as tient un bilan victoires/défaites/nulles SÉPARÉ par salle
// ($f, $c, $l). Une salle est donc ici un espace d'appariement à part entière :
// on ne voit, ne défie et ne rejoint que les gens de sa propre salle.
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

  // Les trois salles, dans l'ordre des modes de Main.as (0, 1, 2). Le
  // CHALLENGE reste la salle par défaut : c'est celle qu'on avait jusqu'ici,
  // et un client qui ignore les salles y arrive donc sans rien changer.
  var SALLES = ["amical", "chall", "champ"];
  var SALLE_DEFAUT = "chall";
  function salleValide(s) { return SALLES.indexOf(s) >= 0 ? s : SALLE_DEFAUT; }

  var TIME_CHOICES = [600, 480, 400, 240];   // secondes par équipe
  var SIZE_CHOICES = [8, 7, 6, 5];
  // TROIS cartes par joueur au plus : c'est le compte du jeu d'origine. Le
  // portage proposait 4 en tête de liste (donc par défaut), ce qui allongeait
  // les parties et diluait le plateau.
  var CARD_CHOICES = [3, 2, 1];

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
    this.players = {};     // id → { id, name, salle, status:'idle'|'waiting'|'playing', gameId }
    this.games = {};       // id → { id, host, salle, params, players:[id], status }
    this.challenges = {};  // id → { id, from, to, params, status:'pending' }
    this._seq = 0;
  }

  BandasLobby.prototype._id = function (prefix) { return prefix + (++this._seq); };

  // ── Joueurs ───────────────────────────────────────────────────────────────
  BandasLobby.prototype.addPlayer = function (id, name, salle) {
    if (this.players[id]) {
      this.players[id].name = name;
      if (salle !== undefined) this.players[id].salle = salleValide(salle);
      return { ok: true, player: this.players[id] };
    }
    this.players[id] = { id: id, name: name, salle: salleValide(salle), status: "idle", gameId: null };
    return { ok: true, player: this.players[id] };
  };

  // Passer d'une salle à l'autre — seulement au repos : on ne déserte pas une
  // partie ouverte ni une partie en cours pour aller voir ailleurs.
  BandasLobby.prototype.changerSalle = function (id, salle) {
    var p = this.players[id];
    if (!p) return { ok: false, error: "unknown-player" };
    if (p.status !== "idle") return { ok: false, error: "already-busy" };
    var avant = p.salle;
    p.salle = salleValide(salle);
    return { ok: true, avant: avant, salle: p.salle, change: avant !== p.salle };
  };

  BandasLobby.prototype.salleDe = function (id) {
    var p = this.players[id];
    return p ? p.salle : SALLE_DEFAUT;
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
    var g = { id: this._id("g"), host: hostId, salle: p.salle, params: defaultParams(params), players: [hostId], status: "open" };
    this.games[g.id] = g;
    p.status = "waiting"; p.gameId = g.id;
    return { ok: true, gameId: g.id, game: g };
  };

  BandasLobby.prototype.joinGame = function (playerId, gameId) {
    var p = this.players[playerId], g = this.games[gameId];
    if (!p) return { ok: false, error: "unknown-player" };
    if (!g || g.status !== "open") return { ok: false, error: "no-such-open-game" };
    if (p.status !== "idle") return { ok: false, error: "already-busy" };
    if (g.salle !== p.salle) return { ok: false, error: "other-room" };
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
    if (a.salle !== b.salle) return { ok: false, error: "other-room" };
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

    var g = { id: this._id("g"), host: ch.from, salle: a.salle, params: ch.params, players: [ch.from, ch.to], status: "playing" };
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
  // `salle` omise = tout le lobby (les tests d'origine, et le compte global).
  BandasLobby.prototype.listOpenGames = function (salle) {
    var out = [];
    for (var id in this.games) {
      var g = this.games[id];
      if (g.status !== "open") continue;
      if (salle !== undefined && g.salle !== salle) continue;
      out.push({ id: g.id, host: g.host, salle: g.salle, params: g.params, count: g.players.length, max: g.params.nbrPlayers });
    }
    return out;
  };
  BandasLobby.prototype.listPlayers = function (salle) {
    var out = [];
    for (var id in this.players) {
      var p = this.players[id];
      if (salle !== undefined && p.salle !== salle) continue;
      out.push({ id: p.id, name: p.name, salle: p.salle, status: p.status });
    }
    return out;
  };

  // Le compte de chaque salle, pour l'écran de sélection de mode : combien de
  // joueurs, combien de parties ouvertes. Les parties EN COURS y comptent
  // aussi — l'écran d'origine annonce « PARTIES », pas « parties à rejoindre ».
  BandasLobby.prototype.comptes = function () {
    var out = {};
    SALLES.forEach(function (s) { out[s] = { joueurs: 0, parties: 0 }; });
    for (var pid in this.players) {
      var p = this.players[pid];
      if (out[p.salle]) out[p.salle].joueurs++;
    }
    for (var gid in this.games) {
      var g = this.games[gid];
      if (g.status !== "ended" && out[g.salle]) out[g.salle].parties++;
    }
    return out;
  };

  return { BandasLobby: BandasLobby, defaultParams: defaultParams, TIME_CHOICES: TIME_CHOICES, SIZE_CHOICES: SIZE_CHOICES, CARD_CHOICES: CARD_CHOICES, SALLES: SALLES, SALLE_DEFAUT: SALLE_DEFAUT, salleValide: salleValide };
});
