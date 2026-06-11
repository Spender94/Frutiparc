//
// Frutibandas — logique de partie (cœur pur, sans transport ni horloge).
//
// Reconstruit l'autorité qui vivait dans le serveur frusion d'origine (perdu) :
// phase de draft (sélection alternée des cartes), phase de mouvement (1 carte
// max par tour puis un mouvement), effets des 12 fruticartes, détection de fin.
// Le comportement de chaque carte suit Games/frutibandas/lib/frutibandas/card/*
// et les descriptions d'origine embarquées dans le .fla :
//   Enclume        détruit la case ciblée (et ce qu'elle porte)
//   Célérité       on rejoue après son mouvement
//   Confiscation   (cachée) la carte jouée par l'adversaire au tour suivant
//                  est annulée et récupérée
//   Renfort        jusqu'à 3 fruits alliés placés au hasard
//   Désordre       (cachée) le prochain mouvement adverse est INVERSÉ
//   Pétrification  le fruit ciblé devient une pierre (bloque les poussées)
//   Vachette       la meuhmeuh nettoie toute la colonne choisie
//   Conversion     le fruit ciblé change d'équipe
//   Charge         le prochain mouvement est appliqué deux fois
//   Entracte       on ne bouge pas ce tour-ci (la carte tient lieu de tour)
//   Solo           seul le fruit choisi bougera au prochain mouvement
//   Piège          (cachée) piège une case libre ; le fruit qui s'y pose meurt
//
// Chaque action renvoie { ok, events:[...] } ; les événements sont sérialisés
// par le pont réseau et REJOUÉS par le client (mêmes règles → mêmes plateaux),
// avec la visibilité d'origine : les poses cachées ne partent qu'au poseur
// (events[i].to === team), la révélation est diffusée à tous (to === "all").
//
(function (root, factory) {
  var E = (typeof require !== "undefined") ? require("./engine.js") : (root.Bandas && root.Bandas.engine);
  var api = factory(E);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else (root.Bandas = root.Bandas || {}).game = api;
})(typeof self !== "undefined" ? self : this, function (E) {
  "use strict";

  var DIR = E.DIR;

  // Identifiants des cartes (Card.as)
  var CARD = {
    ENCLUME: 0, CELERITE: 1, CONFISCATION: 2, RENFORT: 3, DESORDRE: 4,
    PETRIFICATION: 5, VACHETTE: 6, CONVERSION: 7, CHARGE: 8, ENTRACTE: 9,
    SOLO: 10, PIEGE: 11,
  };
  var CARD_NAMES = ["Enclume", "Celerite", "Confiscation", "Renfort", "Desordre",
    "Petrification", "Vachette", "Conversion", "Charge", "Entracte", "Solo", "Piege"];
  // Cartes posées face cachée (cf. Game.as : PIEGE / DESORDRE / CONFISCATION)
  var HIDDEN_CARDS = [CARD.PIEGE, CARD.DESORDRE, CARD.CONFISCATION];

  var PHASE_CARD_SELECTION = 1;
  var PHASE_MOVE = 2;

  var END_DRAW = -2; // « La Vachette » gagne

  // opts : { size=8, cardsPerPlayer=4, rng=Math.random,
  //          board?:Board (test), pool?:[ids] (test), firstTeam? }
  function BandasGame(opts) {
    opts = opts || {};
    this.rng = opts.rng || Math.random;
    this.size = opts.size || 8;
    this.cardsPerPlayer = (opts.cardsPerPlayer !== undefined) ? opts.cardsPerPlayer : 4;
    this.board = opts.board || E.Board.newStartingBoard(this.size, this.rng);
    this.pool = opts.pool ? opts.pool.slice() : this._randomPool(this.cardsPerPlayer * 2);
    this.hands = [[], []];
    this.phase = this.pool.length ? PHASE_CARD_SELECTION : PHASE_MOVE;
    this.currentTeam = (opts.firstTeam !== undefined) ? opts.firstTeam : (this.rng() < 0.5 ? 0 : 1);
    this.ended = false;
    this.winner = null;          // 0 | 1 | END_DRAW
    this.cardPlayedThisTurn = false;
    // effets en attente
    this.nextSolo = [null, null];        // par équipe : coordonnée du fruit solo
    this.charge = [false, false];        // prochain mouvement doublé
    this.celerite = [false, false];      // on rejoue après le mouvement
    this.desordre = [false, false];      // desordre[t] : le prochain mvt de t est inversé
    this.desordreBy = [null, null];      // qui l'a posé (pour la révélation)
    this.confiscation = [false, false];  // confiscation[t] : t confisquera la prochaine carte adverse
    this.trapOwner = {};                 // "x,y" → équipe qui a posé le piège
  }

  BandasGame.prototype._randomPool = function (n) {
    var pool = [];
    for (var i = 0; i < n; i++) pool.push(Math.floor(this.rng() * 12));
    return pool;
  };

  BandasGame.prototype.getBoard = function () { return this.board; };
  BandasGame.prototype.isRunning = function () { return !this.ended; };

  // ── Aides internes ────────────────────────────────────────────────────────
  BandasGame.prototype._err = function (code) { return { ok: false, error: code }; };

  // Fin de partie ? (équipe sans fruit — les deux à zéro = égalité « Vachette »)
  BandasGame.prototype._checkEnd = function (events) {
    if (this.ended) return true;
    var c0 = this.board.countSpritesOf(0);
    var c1 = this.board.countSpritesOf(1);
    if (c0 > 0 && c1 > 0) return false;
    this.ended = true;
    this.winner = (c0 <= 0 && c1 <= 0) ? END_DRAW : (c0 <= 0 ? 1 : 0);
    events.push({ type: "end", winner: this.winner, to: "all" });
    return true;
  };

  // Révèle les pièges déclenchés pendant la dernière résolution.
  BandasGame.prototype._revealTraps = function (events) {
    var hits = this.board.takeTrapHits();
    for (var i = 0; i < hits.length; i++) {
      var key = hits[i].x + "," + hits[i].y;
      var owner = this.trapOwner[key];
      if (owner === undefined) continue;       // déjà révélé
      delete this.trapOwner[key];
      events.push({ type: "cardPlayed", team: owner, card: CARD.PIEGE, x: hits[i].x, y: hits[i].y, to: "all" });
    }
  };

  // Fin de tour : célérité fait rejouer la même équipe, sinon on alterne. La
  // fenêtre de confiscation adverse expire quand le tour de sa cible se finit.
  BandasGame.prototype._endTurn = function (events) {
    if (this._checkEnd(events)) return;
    var t = this.currentTeam;
    this.confiscation[1 - t] = false;          // la fenêtre « prochain tour » de l'adversaire se referme
    if (this.celerite[t]) {
      this.celerite[t] = false;                // on rejoue (le tour reste à t)
    } else {
      this.currentTeam = 1 - t;
    }
    this.cardPlayedThisTurn = false;
    events.push({ type: "turn", team: this.currentTeam, to: "all" });
  };

  // ── Phase de draft ────────────────────────────────────────────────────────
  // Le joueur courant prend une carte du pool, puis l'autre, etc. La dernière
  // prise fait basculer en phase de mouvement (attribut mp="1" d'origine).
  BandasGame.prototype.chooseCard = function (team, cardId) {
    if (this.ended) return this._err("game-ended");
    if (this.phase !== PHASE_CARD_SELECTION) return this._err("draft-over");      // 1519
    if (team !== this.currentTeam) return this._err("not-your-turn");             // 1510
    var idx = this.pool.indexOf(cardId);
    if (idx < 0) return this._err("bad-card");                                    // 1518
    this.pool.splice(idx, 1);
    this.hands[team].push(cardId);
    var events = [];
    var movePhase = this.pool.length === 0;
    events.push({ type: "cardChosen", team: team, card: cardId, movePhase: movePhase, to: "all" });
    if (movePhase) this.phase = PHASE_MOVE;
    this.currentTeam = 1 - team;
    this.cardPlayedThisTurn = false;
    events.push({ type: "turn", team: this.currentTeam, to: "all" });
    return { ok: true, events: events };
  };

  // ── Jouer une carte (phase de mouvement, avant son déplacement) ───────────
  BandasGame.prototype.playCard = function (team, cardId, x, y) {
    if (this.ended) return this._err("game-ended");
    if (this.phase !== PHASE_MOVE) return this._err("not-move-phase");            // 1520
    if (team !== this.currentTeam) return this._err("not-your-turn");             // 1510
    if (this.cardPlayedThisTurn) return this._err("one-card-per-turn");           // 1517
    var hand = this.hands[team];
    var idx = hand.indexOf(cardId);
    if (idx < 0) return this._err("bad-card");                                    // 1518

    var events = [];
    var c = { x: x, y: y };

    // Confiscation adverse armée : la carte est annulée et change de main.
    if (this.confiscation[1 - team]) {
      this.confiscation[1 - team] = false;
      hand.splice(idx, 1);
      this.hands[1 - team].push(cardId);
      this.cardPlayedThisTurn = true;
      events.push({ type: "cardPlayed", team: 1 - team, card: CARD.CONFISCATION, p: cardId, to: "all" });
      return { ok: true, events: events };
    }

    // Validation de cible (Card.as isValidTarget)
    var v = this._validateTarget(team, cardId, c);
    if (!v.ok) return v;

    hand.splice(idx, 1);
    this.cardPlayedThisTurn = true;
    var hidden = HIDDEN_CARDS.indexOf(cardId) >= 0;

    switch (cardId) {
      case CARD.ENCLUME:
        events.push({ type: "cardPlayed", team: team, card: cardId, x: c.x, y: c.y, to: "all" });
        this.board.destroy(c);
        this.board.removeEmptyBorders();
        this._revealTraps(events);     // une enclume peut raser un bord piégé
        this._checkEnd(events);
        break;

      case CARD.CELERITE:
        this.celerite[team] = true;
        events.push({ type: "cardPlayed", team: team, card: cardId, to: "all" });
        break;

      case CARD.CONFISCATION:
        this.confiscation[team] = true;
        events.push({ type: "cardPlayed", team: team, card: cardId, hidden: true, to: team });
        break;

      case CARD.RENFORT: {
        var spots = this._randomFreeSlots(3);
        for (var i = 0; i < spots.length; i++) {
          this.board.setElement(spots[i], team);
          this.board.incTeamCounter(team);
        }
        var packed = this._packRenfort(spots);
        events.push({ type: "cardPlayed", team: team, card: cardId, x: packed.x, y: packed.y, to: "all" });
        break;
      }

      case CARD.DESORDRE:
        this.desordre[1 - team] = true;
        this.desordreBy[1 - team] = team;
        events.push({ type: "cardPlayed", team: team, card: cardId, hidden: true, to: team });
        break;

      case CARD.PETRIFICATION: {
        var el = this.board.getElement(c);
        events.push({ type: "cardPlayed", team: team, card: cardId, x: c.x, y: c.y, to: "all" });
        this.board.setElement(c, E.ROCK);
        this.board.decTeamCounter(el);
        this.board.removeEmptyBorders();
        this._revealTraps(events);
        this._checkEnd(events);
        break;
      }

      case CARD.VACHETTE: {
        // La colonne x est entièrement vidée (fruits, pierres, pièges, trous).
        events.push({ type: "cardPlayed", team: team, card: cardId, x: c.x, y: 0, to: "all" });
        var cell = { x: c.x, y: 0 };
        while (cell.y < this.board.getSize()) {
          var e2 = this.board.getElement(cell);
          if (e2 > E.FREE) this.board.decTeamCounter(e2);
          this.board.setElement(cell, E.FREE);
          delete this.trapOwner[cell.x + "," + cell.y];
          cell = { x: cell.x, y: cell.y + 1 };
        }
        this.board.removeEmptyBorders();
        this._checkEnd(events);
        break;
      }

      case CARD.CONVERSION: {
        var sp = this.board.getElement(c);
        this.board.decTeamCounter(sp);
        this.board.incTeamCounter(1 - sp);
        this.board.setElement(c, 1 - sp);
        events.push({ type: "cardPlayed", team: team, card: cardId, x: c.x, y: c.y, to: "all" });
        this._checkEnd(events);
        break;
      }

      case CARD.CHARGE:
        this.charge[team] = true;
        events.push({ type: "cardPlayed", team: team, card: cardId, to: "all" });
        break;

      case CARD.ENTRACTE:
        // La carte tient lieu de tour : pas de mouvement.
        events.push({ type: "cardPlayed", team: team, card: cardId, to: "all" });
        this._endTurn(events);
        break;

      case CARD.SOLO:
        this.nextSolo[team] = { x: c.x, y: c.y };
        events.push({ type: "cardPlayed", team: team, card: cardId, x: c.x, y: c.y, to: "all" });
        break;

      case CARD.PIEGE:
        this.board.setTrapped(c);
        this.trapOwner[c.x + "," + c.y] = team;
        events.push({ type: "cardPlayed", team: team, card: cardId, x: c.x, y: c.y, hidden: true, to: team });
        break;

      default:
        return this._err("bad-card");
    }
    return { ok: true, events: events, hidden: hidden };
  };

  // Validation des cibles, fidèle à Card.as (requiresTarget & co).
  BandasGame.prototype._validateTarget = function (team, cardId, c) {
    var needsTarget = [CARD.ENCLUME, CARD.PETRIFICATION, CARD.VACHETTE,
      CARD.CONVERSION, CARD.SOLO, CARD.PIEGE].indexOf(cardId) >= 0;
    if (!needsTarget) return { ok: true };
    if (c.x === undefined || c.y === undefined || isNaN(c.x) || isNaN(c.y)) return this._err("bad-target");
    if (cardId === CARD.VACHETTE) c.y = this.board.minY;   // seule la colonne compte
    if (!this.board.isValid(c)) return this._err("bad-target");
    var el = this.board.getElement(c);
    if (cardId === CARD.PIEGE && el !== E.FREE) return this._err("needs-free-slot");
    if (cardId === CARD.PETRIFICATION || cardId === CARD.CONVERSION) {
      if (el <= E.FREE) return this._err("needs-sprite");
    }
    if (cardId === CARD.SOLO && el !== team) return this._err("needs-own-sprite");
    return { ok: true };
  };

  // Jusqu'à n cases LIBRES tirées au hasard (renfort).
  BandasGame.prototype._randomFreeSlots = function (n) {
    var free = [];
    for (var y = this.board.minY; y <= this.board.maxY; y++) {
      for (var x = this.board.minX; x <= this.board.maxX; x++) {
        if (this.board.getElement({ x: x, y: y }) === E.FREE) free.push({ x: x, y: y });
      }
    }
    var out = [];
    while (free.length && out.length < n) {
      out.push(free.splice(Math.floor(this.rng() * free.length), 1)[0]);
    }
    return out;
  };

  // Encodage des coordonnées de renfort (jusqu'à 3), repris de Renfort.as :
  // chaque coordonnée est rangée (+1) sur une puissance de 100.
  BandasGame.prototype._packRenfort = function (spots) {
    var x = 0, y = 0;
    var weights = [1, 100, 10000];
    for (var i = 0; i < spots.length; i++) {
      x += (spots[i].x + 1) * weights[spots.length - 1 - i];
      y += (spots[i].y + 1) * weights[spots.length - 1 - i];
    }
    return { x: x, y: y };
  };

  // ── Mouvement ─────────────────────────────────────────────────────────────
  BandasGame.prototype.move = function (team, direction) {
    if (this.ended) return this._err("game-ended");
    if (this.phase !== PHASE_MOVE) return this._err("not-move-phase");
    if (team !== this.currentTeam) return this._err("not-your-turn");
    var d = E.dirValueOf(direction);
    if (d === DIR.BAD) return this._err("bad-direction");

    var events = [];

    // Désordre adverse : le mouvement est inversé, la carte est révélée AVANT.
    if (this.desordre[team]) {
      this.desordre[team] = false;
      var by = this.desordreBy[team];
      this.desordreBy[team] = null;
      d = E.dirOpposite(d);
      events.push({ type: "cardPlayed", team: by, card: CARD.DESORDRE, to: "all" });
    }

    var reps = this.charge[team] ? 2 : 1;      // charge : mouvement doublé
    this.charge[team] = false;

    for (var r = 0; r < reps; r++) {
      if (this.nextSolo[team]) {               // solo : seul ce fruit bouge
        this.board.moveSprite(this.nextSolo[team], d);
        this.nextSolo[team] = null;
      } else {
        this.board.move(team, d);
      }
      this.board.removeEmptyBorders();
      events.push({ type: "move", team: team, direction: d, to: "all" });
      this._revealTraps(events);
      if (this._checkEnd(events)) return { ok: true, events: events };
    }

    this._endTurn(events);
    return { ok: true, events: events };
  };

  // Abandon / déconnexion / timeout → l'autre équipe gagne.
  BandasGame.prototype.resign = function (team) {
    if (this.ended) return { ok: false, error: "game-ended" };
    this.ended = true;
    this.winner = 1 - team;
    return { ok: true, events: [{ type: "end", winner: this.winner, to: "all" }] };
  };

  // ── Instantané (reprise / spectateur) ─────────────────────────────────────
  BandasGame.prototype.snapshot = function () {
    return {
      phase: this.phase,
      currentTeam: this.currentTeam,
      pool: this.pool.slice(),
      hands: [this.hands[0].slice(), this.hands[1].slice()],
      size: this.board.getSize(),
      content: this.board.toContentString(),
      bounds: { x1: this.board.minX, x2: this.board.maxX, y1: this.board.minY, y2: this.board.maxY },
      counters: [this.board.countSpritesOf(0), this.board.countSpritesOf(1)],
      ended: this.ended,
      winner: this.winner,
    };
  };

  return {
    BandasGame: BandasGame,
    CARD: CARD, CARD_NAMES: CARD_NAMES, HIDDEN_CARDS: HIDDEN_CARDS,
    PHASE_CARD_SELECTION: PHASE_CARD_SELECTION, PHASE_MOVE: PHASE_MOVE,
    END_DRAW: END_DRAW,
  };
});
