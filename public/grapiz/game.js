//
// Grapiz — machine d'état de partie (autorité, indépendante du transport).
//
// Enveloppe le moteur (engine.js) avec la logique de partie que le SERVEUR
// d'origine portait (le client AS2 ne fait que recevoir turn/move/end) :
//   - validation d'une demande de coup (bon tour, jeton à soi, coup légal),
//   - application + capture,
//   - détection de fin : VICTOIRE PAR CONNEXION (règle confirmée — tous ses
//     jetons forment un seul groupe connexe) ou élimination de l'adversaire,
//   - alternance des tours.
//
// Conçu d'abord pour 2 joueurs (cas principal). Le multi 3-4 joueurs
// (rotation/élimination) est marqué TODO. Isomorphe Node + navigateur.
//
(function (root, factory) {
  var E = (typeof require !== "undefined") ? require("./engine.js")
        : (root.Grapiz && root.Grapiz.engine);
  var api = factory(E);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else (root.Grapiz = root.Grapiz || {}).game = api;
})(typeof self !== "undefined" ? self : this, function (E) {
  "use strict";

  // opts : { players:[noms], board?:Board, def?:{size,tokens}, currentTurn?:0 }
  function GrapizGame(opts) {
    opts = opts || {};
    this.players = opts.players || ["0", "1"];
    this.board = opts.board || (opts.def ? E.Board.fromDefinition(opts.def) : E.Board.newLambdaBoard());
    this.currentTurn = opts.currentTurn || 0;
    this.winner = null;     // index d'équipe gagnante, ou null
    this.ended = false;
  }

  GrapizGame.prototype.teamCount = function () { return this.players.length; };
  GrapizGame.prototype.isPlaying = function () { return !this.ended; };
  GrapizGame.prototype.getBoard = function () { return this.board; };

  // Toutes les options de coup d'une équipe :
  //   [{ from:{x,y}, to:{x,y}, direction, distance }]
  GrapizGame.prototype.legalMoves = function (team) {
    var board = this.board, out = [];
    board.teamTokens(team).forEach(function (tok) {
      var from = tok.getCoordinate();
      board.availableMoves(from).forEach(function (m) {
        out.push({
          from: { x: from.x, y: from.y },
          to: { x: m.target.x, y: m.target.y },
          direction: m.direction, distance: m.distance,
        });
      });
    });
    return out;
  };

  GrapizGame.prototype.hasAnyMove = function (team) {
    var board = this.board, toks = board.teamTokens(team);
    for (var i = 0; i < toks.length; i++) {
      if (board.availableMoves(toks[i].getCoordinate()).length) return true;
    }
    return false;
  };

  // Équipes "gagnantes par connexion" : ≥1 jeton, tous connexes.
  // (À 0 jeton une équipe est éliminée, pas gagnante.)
  GrapizGame.prototype._connectedWin = function (team) {
    return this.board.teamTokens(team).length >= 1 && this.board.teamConnected(team);
  };

  // Vainqueur courant indépendamment du dernier joueur (utile aux tests / au
  // serveur pour un état arbitraire). En cas d'ambiguïté, renvoie le 1er trouvé.
  GrapizGame.prototype.winner_ = function () {
    var alive = [];
    for (var t = 0; t < this.teamCount(); t++) if (this.board.teamTokens(t).length > 0) alive.push(t);
    if (alive.length === 1) return alive[0];                 // élimination
    for (var i = 0; i < alive.length; i++) if (this._connectedWin(alive[i])) return alive[i];
    return null;
  };

  // Détection de fin APRÈS un coup joué par `mover` (priorité au mover en cas
  // d'égalité, convention LOA).
  GrapizGame.prototype._detectWinner = function (mover) {
    if (this._connectedWin(mover)) return mover;            // le mover se relie
    var others = [];
    for (var t = 0; t < this.teamCount(); t++) if (t !== mover) others.push(t);
    // élimination : un adversaire à 0 jeton (en 2 joueurs → le mover gagne)
    var aliveOthers = others.filter(function (o) { return this.board.teamTokens(o).length > 0; }, this);
    if (aliveOthers.length === 0) return mover;
    // un adversaire relié par le coup du mover (rare)
    for (var j = 0; j < aliveOthers.length; j++) if (this._connectedWin(aliveOthers[j])) return aliveOthers[j];
    return null;
  };

  // 2 joueurs : alternance. N joueurs : rotation simple (élimination non gérée — TODO).
  GrapizGame.prototype._nextTurn = function (team) {
    return (team + 1) % this.teamCount();
  };

  // Demande de coup. Renvoie soit { ok:false, error } soit
  // { ok:true, from, to, direction, distance, captured, winner?, nextTurn? }.
  GrapizGame.prototype.applyMove = function (team, fx, fy, direction) {
    if (this.ended) return { ok: false, error: "game-ended" };
    if (team !== this.currentTurn) return { ok: false, error: "not-your-turn" };
    var from = new E.Coordinate(fx, fy);
    var tok = this.board.getAt(from);
    if (!tok || tok.getTeam() !== team) return { ok: false, error: "no-own-token" };
    var d = E.dirValueOf(direction);
    if (d === E.DIR.BAD) return { ok: false, error: "bad-direction" };
    var n = this.board.countTokensOnLine(from, d);
    if (!this.board.canMove(from, d, n)) return { ok: false, error: "illegal-move" };

    var captured = this.board.move(from, d); // `from` est muté vers l'arrivée
    var res = {
      ok: true, from: { x: fx, y: fy }, to: { x: from.x, y: from.y },
      direction: d, distance: n,
      captured: captured ? { team: captured.getTeam() } : null,
    };
    var w = this._detectWinner(team);
    if (w !== null) { this.ended = true; this.winner = w; res.winner = w; }
    else { this.currentTurn = this._nextTurn(team); res.nextTurn = this.currentTurn; }
    return res;
  };

  return { GrapizGame: GrapizGame };
});
