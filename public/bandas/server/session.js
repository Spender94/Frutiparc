//
// Frutibandas — session de partie côté serveur (autorité d'UNE partie).
//
// Enveloppe BandasGame (game.js) avec le temps réel multijoueur :
//   - horloges par équipe (type échecs : on décompte le temps du joueur actif,
//     draft compris — fidèle à Game.processTime du client d'origine),
//   - timeout → l'adversaire gagne (END_TIMEOUT d'origine),
//   - abandon / déconnexion → l'adversaire gagne,
//   - relais des actions (validation déléguée à BandasGame), snapshot complet
//     pour le démarrage et la reprise.
//
// L'horloge est INJECTABLE (paramètre `now` en ms) pour des tests
// déterministes. Isomorphe, sans dépendance au transport.
//
(function (root, factory) {
  var E = (typeof require !== "undefined") ? require("../engine.js") : (root.Bandas && root.Bandas.engine);
  var G = (typeof require !== "undefined") ? require("../game.js") : (root.Bandas && root.Bandas.game);
  var api = factory(E, G);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else (root.Bandas = root.Bandas || {}).session = api;
})(typeof self !== "undefined" ? self : this, function (E, G) {
  "use strict";

  // opts : { id, players:[{id,name,fb?}], params:{boardSize,time,cards},
  //          game?:BandasGame (override de test), now?, rng? }
  function BandasSession(opts) {
    opts = opts || {};
    this.id = opts.id;
    this.params = opts.params || {};
    this.players = (opts.players || []).map(function (p, i) {
      return { id: p.id, name: p.name, fb: p.fb || "", team: i };
    });
    this.game = opts.game || new G.BandasGame({
      size: this.params.boardSize || 8,
      cardsPerPlayer: (this.params.cards !== undefined) ? this.params.cards : 4,
      rng: opts.rng,
    });
    var t = this.params.time || 600000;            // ms par équipe
    this.totalTime = t;
    this.clocks = [t, t];
    this.turnStart = (opts.now !== undefined ? opts.now : Date.now());
    this.ended = false;
    this.winner = null;       // 0 | 1 | -2 (égalité)
    this.endReason = null;    // "victory" | "draw" | "timeout" | "forfeit"
  }

  BandasSession.prototype.teamOf = function (playerId) {
    for (var i = 0; i < this.players.length; i++) if (this.players[i].id === playerId) return this.players[i].team;
    return -1;
  };
  BandasSession.prototype.playerOfTeam = function (team) {
    for (var i = 0; i < this.players.length; i++) if (this.players[i].team === team) return this.players[i];
    return null;
  };

  // Décompte le temps écoulé de l'équipe active depuis le début de son tour.
  BandasSession.prototype._charge = function (now) {
    var cur = this.game.currentTeam;
    var elapsed = now - this.turnStart;
    if (elapsed < 0) elapsed = 0;
    this.clocks[cur] -= elapsed;
    this.turnStart = now;
    return this.clocks[cur];
  };

  BandasSession.prototype._finish = function (winner, reason) {
    this.ended = true;
    this.winner = winner;
    this.endReason = reason;
    return {
      ok: true, ended: true, winner: winner, reason: reason,
      events: [{ type: "end", winner: winner, to: "all" }],
    };
  };

  // Adopte le résultat d'une action BandasGame (qui peut contenir la fin).
  BandasSession.prototype._adopt = function (res, now) {
    if (!res.ok) return res;
    if (!this.game.isRunning()) {
      this.ended = true;
      this.winner = this.game.winner;
      this.endReason = (this.winner === G.END_DRAW) ? "draw" : "victory";
      res.ended = true;
      res.winner = this.winner;
      res.reason = this.endReason;
    } else {
      this.turnStart = now;     // l'horloge (éventuellement du nouveau joueur) repart
    }
    return res;
  };

  // Garde commune aux trois actions : partie en cours, joueur connu, temps non
  // épuisé (sinon timeout immédiat → l'adversaire gagne).
  BandasSession.prototype._guard = function (playerId, now) {
    if (this.ended) return { fail: { ok: false, error: "game-ended" } };
    var team = this.teamOf(playerId);
    if (team < 0) return { fail: { ok: false, error: "not-a-player" } };
    if (team !== this.game.currentTeam) return { fail: { ok: false, error: "not-your-turn" } };
    if (this._charge(now) <= 0) {
      this.clocks[team] = 0;
      return { fail: this._finish(1 - team, "timeout") };
    }
    return { team: team };
  };

  BandasSession.prototype.requestChooseCard = function (playerId, cardId, now) {
    if (now === undefined) now = Date.now();
    var g = this._guard(playerId, now);
    if (g.fail) return g.fail;
    return this._adopt(this.game.chooseCard(g.team, cardId), now);
  };

  BandasSession.prototype.requestPlayCard = function (playerId, cardId, x, y, now) {
    if (now === undefined) now = Date.now();
    var g = this._guard(playerId, now);
    if (g.fail) return g.fail;
    return this._adopt(this.game.playCard(g.team, cardId, x, y), now);
  };

  BandasSession.prototype.requestMove = function (playerId, direction, now) {
    if (now === undefined) now = Date.now();
    var g = this._guard(playerId, now);
    if (g.fail) return g.fail;
    return this._adopt(this.game.move(g.team, direction), now);
  };

  // Appel périodique : timeout de l'équipe active sans action.
  BandasSession.prototype.tick = function (now) {
    if (this.ended) return null;
    if (now === undefined) now = Date.now();
    var cur = this.game.currentTeam;
    if (this.clocks[cur] - (now - this.turnStart) <= 0) {
      this.clocks[cur] = 0;
      return this._finish(1 - cur, "timeout");
    }
    return null;
  };

  // Abandon ou déconnexion → l'adversaire gagne.
  BandasSession.prototype.forfeit = function (playerId) {
    if (this.ended) return null;
    var team = this.teamOf(playerId);
    if (team < 0) return null;
    this.game.resign(team);
    return this._finish(1 - team, "forfeit");
  };

  // Temps restant d'une équipe à l'instant `now`.
  BandasSession.prototype.remainingOf = function (team, now) {
    if (now === undefined) now = Date.now();
    if (this.ended || team !== this.game.currentTeam) return Math.max(0, this.clocks[team]);
    return Math.max(0, this.clocks[team] - (now - this.turnStart));
  };

  // Instantané complet (démarrage / reprise après reconnexion).
  BandasSession.prototype.snapshot = function (now) {
    var self = this;
    var gs = this.game.snapshot();
    return {
      id: this.id,
      phase: gs.phase,
      currentTeam: gs.currentTeam,
      pool: gs.pool,
      hands: gs.hands,
      size: gs.size,
      content: gs.content,
      bounds: gs.bounds,
      counters: gs.counters,
      totalTime: this.totalTime,
      players: this.players.map(function (p) {
        return { id: p.id, name: p.name, team: p.team, fb: p.fb, remaining: self.remainingOf(p.team, now) };
      }),
      ended: this.ended, winner: this.winner, endReason: this.endReason,
    };
  };

  return { BandasSession: BandasSession };
});
