//
// Grapiz — session de partie côté serveur (autorité d'UNE partie en réseau).
//
// Enveloppe GrapizGame (game.js) avec ce qui relève du temps réel multijoueur :
//   - horloges par joueur (échecs : on décompte le temps du joueur actif),
//   - timeout (le temps écoulé → l'adversaire gagne),
//   - abandon / déconnexion → l'adversaire gagne,
//   - relais des coups (validation déléguée à GrapizGame), snapshots.
//
// L'horloge est INJECTABLE (paramètre `now` en ms) pour des tests déterministes.
// 2 joueurs d'abord ; le multi 3-4 (rotation/élimination sur timeout/abandon)
// est marqué TODO. Isomorphe, sans dépendance au transport.
//
(function (root, factory) {
  var E = (typeof require !== "undefined") ? require("../engine.js") : (root.Grapiz && root.Grapiz.engine);
  var G = (typeof require !== "undefined") ? require("../game.js") : (root.Grapiz && root.Grapiz.game);
  var api = factory(E, G);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else (root.Grapiz = root.Grapiz || {}).session = api;
})(typeof self !== "undefined" ? self : this, function (E, G) {
  "use strict";

  // Position de départ pour une taille de plateau. Seule la taille 4 (plateau
  // "lambda") figure dans le source d'origine ; 3 et 5 étaient générés par le
  // serveur d'origine (positions inconnues → TODO).
  function startingBoard(size) {
    if (size === undefined || size === 4) return E.Board.newLambdaBoard();
    throw new Error("grapiz: position de départ inconnue pour la taille " + size + " (seule 4 est définie)");
  }

  // opts : { id, players:[{id,name,fb?}], params:{boardSize,time,nbrPlayers},
  //          board?:Board (override de test), now?:Number }
  function GrapizSession(opts) {
    opts = opts || {};
    this.id = opts.id;
    this.params = opts.params || {};
    var board = opts.board || startingBoard(this.params.boardSize);
    this.players = (opts.players || []).map(function (p, i) {
      return { id: p.id, name: p.name, fb: p.fb || "", team: i };
    });
    this.game = new G.GrapizGame({ players: this.players.map(function (p) { return p.name; }), board: board });
    var t = this.params.time || 300000;             // ms par joueur
    this.clocks = this.players.map(function () { return t; });
    this.turnStart = (opts.now !== undefined ? opts.now : Date.now());
    this.ended = false;
    this.winner = null;       // index d'équipe
    this.endReason = null;    // "connection" | "elimination" | "timeout" | "forfeit"
  }

  GrapizSession.prototype.teamOf = function (playerId) {
    for (var i = 0; i < this.players.length; i++) if (this.players[i].id === playerId) return this.players[i].team;
    return -1;
  };
  GrapizSession.prototype.playerOfTeam = function (team) {
    for (var i = 0; i < this.players.length; i++) if (this.players[i].team === team) return this.players[i];
    return null;
  };
  GrapizSession.prototype._opponentTeam = function (team) {
    return this.players.length === 2 ? (team === 0 ? 1 : 0) : null; // N joueurs : TODO
  };

  // Décompte le temps écoulé du joueur actif depuis le début de son tour.
  GrapizSession.prototype._charge = function (now) {
    var cur = this.game.currentTurn;
    var elapsed = now - this.turnStart;
    if (elapsed < 0) elapsed = 0;
    this.clocks[cur] -= elapsed;
    this.turnStart = now;
    return this.clocks[cur];
  };

  GrapizSession.prototype._finish = function (winner, reason) {
    this.ended = true;
    this.winner = winner;
    this.endReason = reason;
    return { ok: true, ended: true, winner: winner, reason: reason, clocks: this.clocks.slice() };
  };

  // Demande de coup d'un joueur. now = horloge (ms).
  GrapizSession.prototype.requestMove = function (playerId, fx, fy, direction, now) {
    if (now === undefined) now = Date.now();
    if (this.ended) return { ok: false, error: "game-ended" };
    var team = this.teamOf(playerId);
    if (team < 0) return { ok: false, error: "not-a-player" };
    if (team !== this.game.currentTurn) return { ok: false, error: "not-your-turn" };

    // 1) facturer le temps ; s'il est épuisé → timeout (adversaire gagne)
    if (this._charge(now) <= 0) { this.clocks[team] = 0; return this._finish(this._opponentTeam(team), "timeout"); }

    // 2) appliquer le coup (validation des règles déléguée à GrapizGame)
    var res = this.game.applyMove(team, fx, fy, direction);
    if (!res.ok) return res;                          // coup illégal etc.
    res.clocks = this.clocks.slice();
    if (res.winner !== undefined) {                  // connexion / élimination
      this.ended = true; this.winner = res.winner;
      this.endReason = (this.game.board.teamTokens(res.winner === team ? this._opponentTeam(team) : team).length === 0)
        ? "elimination" : "connection";
      res.ended = true;
      res.reason = this.endReason;
    } else {
      this.turnStart = now;                          // l'horloge du nouveau joueur démarre
    }
    return res;
  };

  // Appel périodique : détecte le timeout du joueur actif sans coup.
  GrapizSession.prototype.tick = function (now) {
    if (this.ended) return null;
    if (now === undefined) now = Date.now();
    var cur = this.game.currentTurn;
    if (this.clocks[cur] - (now - this.turnStart) <= 0) {
      this.clocks[cur] = 0;
      return this._finish(this._opponentTeam(cur), "timeout");
    }
    return null;
  };

  // Abandon ou déconnexion d'un joueur → l'adversaire gagne.
  GrapizSession.prototype.forfeit = function (playerId) {
    if (this.ended) return null;
    var team = this.teamOf(playerId);
    if (team < 0) return null;
    return this._finish(this._opponentTeam(team), "forfeit");
  };

  // Temps restant du joueur actif à l'instant `now` (pour l'affichage).
  GrapizSession.prototype.remainingOf = function (team, now) {
    if (now === undefined) now = Date.now();
    if (this.ended || team !== this.game.currentTurn) return Math.max(0, this.clocks[team]);
    return Math.max(0, this.clocks[team] - (now - this.turnStart));
  };

  GrapizSession.prototype.snapshot = function (now) {
    var self = this;
    return {
      id: this.id,
      currentTurn: this.game.currentTurn,
      board: this.game.getBoard().getTokens().map(function (t) {
        var c = t.getCoordinate();
        return { team: t.getTeam(), x: c.x, y: c.y };
      }),
      players: this.players.map(function (p) {
        return { id: p.id, name: p.name, team: p.team, fb: p.fb, remaining: self.remainingOf(p.team, now) };
      }),
      ended: this.ended, winner: this.winner, endReason: this.endReason,
    };
  };

  return { GrapizSession: GrapizSession, startingBoard: startingBoard };
});
