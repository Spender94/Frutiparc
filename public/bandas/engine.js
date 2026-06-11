//
// Frutibandas — moteur de plateau (portage fidèle du source AS2 d'origine).
//
// Source : Games/frutibandas/lib/frutibandas/{Board,Direction,Coordinate}.as
// (révisions CVS 2004). Le jeu oppose 2 équipes de fruits sur une grille
// carrée PLEINE : à son tour on décale TOUS ses fruits d'une case dans une
// direction ; ils poussent ce qui est devant (chaînes), et ce qui sort du
// plateau (ou tombe sur une case détruite/piégée) meurt. Les bords vides
// sont retirés (le plateau rétrécit). Une équipe sans fruit a perdu.
//
// Ce module est ISOMORPHE : côté serveur il est l'autorité (le serveur
// frusion d'origine est perdu, on le reconstruit), côté client il sert de
// miroir — les événements du listener pilotent les animations exactement
// comme BoardListener.as le faisait pour gui/Board.as.
//
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else (root.Bandas = root.Bandas || {}).engine = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ── Direction (Direction.as : Up=0, Right=1, Down=2, Left=3) ─────────────
  var DIR = { UP: 0, RIGHT: 1, DOWN: 2, LEFT: 3, BAD: -1 };
  var DIR_NAMES = ["Up", "Right", "Down", "Left"];
  var DIR_LOG = ["le haut", "la droite", "le bas", "la gauche"];
  var DELTA = { 0: [0, -1], 1: [1, 0], 2: [0, 1], 3: [-1, 0] }; // [dx,dy]

  function dirOpposite(d) {
    switch (d) {
      case DIR.UP: return DIR.DOWN;
      case DIR.DOWN: return DIR.UP;
      case DIR.LEFT: return DIR.RIGHT;
      case DIR.RIGHT: return DIR.LEFT;
      default: return DIR.BAD;
    }
  }
  function dirValueOf(n) {
    return (n === 0 || n === 1 || n === 2 || n === 3) ? n : DIR.BAD;
  }
  function moved(c, d) {
    var dl = DELTA[d] || [0, 0];
    return { x: c.x + dl[0], y: c.y + dl[1] };
  }

  // ── Constantes d'éléments (Board.as) ──────────────────────────────────────
  var TRAPPED = -4;
  var DESTROYED = -3;
  var ROCK = -2;
  var FREE = -1;
  var TEAM_0 = 0;
  var TEAM_1 = 1;

  // ── Board ─────────────────────────────────────────────────────────────────
  // listener (optionnel) : { onSpriteMove(c,d,pushed), onSlotDestroyed(c),
  //   onSlotTrapped(c), onTrapDiscovered(c), onSpriteConverted(c,team) }
  function Board(size) {
    this.size = size;
    this.minX = 0;
    this.minY = 0;
    this.maxX = size - 1;
    this.maxY = size - 1;
    this.slots = new Array(size * size);
    this.teamCounters = [0, 0];
    this.listener = null;
    this.trapHits = []; // pièges déclenchés pendant le dernier mouvement (serveur)
  }

  Board.prototype.setListener = function (l) { this.listener = l; };
  Board.prototype.getSize = function () { return this.size; };
  Board.prototype.toIndex = function (c) { return c.x + c.y * this.size; };
  Board.prototype.toCoordinate = function (i) {
    var y = Math.floor(i / this.size);
    return { x: i - y * this.size, y: y };
  };

  Board.prototype.isValid = function (c) {
    return c.x >= this.minX && c.x <= this.maxX && c.y >= this.minY && c.y <= this.maxY;
  };
  Board.prototype.getElement = function (c) {
    if (!this.isValid(c)) return DESTROYED;
    return this.slots[this.toIndex(c)];
  };
  Board.prototype.getElementAt = function (i) { return this.slots[i]; };
  Board.prototype.setElement = function (c, e) { this.slots[this.toIndex(c)] = e; };
  Board.prototype.setElementAt = function (i, e) { this.slots[i] = e; };
  Board.prototype.countSpritesOf = function (team) { return this.teamCounters[team]; };
  Board.prototype.incTeamCounter = function (t) { return ++this.teamCounters[t]; };
  Board.prototype.decTeamCounter = function (t) { return --this.teamCounters[t]; };

  Board.prototype._emit = function (name, a, b, c) {
    if (this.listener && this.listener[name]) this.listener[name](a, b, c);
  };

  // Board.move : décale tous les fruits de `team` d'une case vers `d`.
  // Parcours depuis le coin de la direction, ligne par ligne, du plus proche
  // du bord au plus lointain (ordre EXACT du source : curseur en sens opposé).
  Board.prototype.move = function (team, d) {
    var corner = this.getCorner(d);
    var lineInc = this.getPerpendicular(d);
    while (this.isValid(corner)) {
      var cursor = { x: corner.x, y: corner.y };
      while (this.isValid(cursor)) {
        if (this.getElement(cursor) === team) this.moveSprite(cursor, d);
        cursor = moved(cursor, dirOpposite(d));
      }
      corner = moved(corner, lineInc);
    }
  };

  // Déplace un fruit d'une case (avec poussées en chaîne). Fidèle à
  // Board.moveSprite : la case TRAPPED/DESTROYED tue ce qui y entre.
  Board.prototype.moveSprite = function (c, d, pushed) {
    if (!this.canMoveSprite(c, d)) return;
    pushed = !!pushed;

    var startIndex = this.toIndex(c);
    var element = this.getElementAt(startIndex);
    this.setElementAt(startIndex, FREE);

    var destination = moved(c, d);
    var target = this.getElement(destination);

    if (target > FREE) {                       // pousse la chaîne devant
      this.moveSprite(destination, d, true);
      this.setElement(destination, element);
      this._emit("onSpriteMove", c, d, pushed);
      return;
    }
    if (target === FREE) {                     // case libre
      this.setElement(destination, element);
      this._emit("onSpriteMove", c, d, pushed);
      return;
    }
    if (target === DESTROYED || target === TRAPPED) {  // chute / piège
      this.teamCounters[element]--;
      if (target === TRAPPED) this.trapHits.push({ x: destination.x, y: destination.y });
      this._emit("onSpriteMove", c, d, pushed);
      return;
    }
  };

  // Un fruit peut bouger sauf si un ROCHER ferme la chaîne devant lui.
  Board.prototype.canMoveSprite = function (c, d) {
    var cursor = moved(c, d);
    while (this.isValid(cursor)) {
      var element = this.getElement(cursor);
      if (element <= FREE) {
        if (element === ROCK) return false;
        return true;
      }
      cursor = moved(cursor, d);
    }
    return true; // bord du plateau : la chaîne pousse dans le vide
  };

  Board.prototype.destroy = function (c) {
    var element = this.getElement(c);
    this.setElement(c, DESTROYED);
    if (element === TRAPPED) { this._emit("onTrapDiscovered", c); return; }
    if (element !== DESTROYED) this._emit("onSlotDestroyed", c);
    if (element > FREE) this.teamCounters[element]--;
  };

  Board.prototype.setTrapped = function (c) {
    this._emit("onSlotTrapped", c);
    this.setElement(c, TRAPPED);
  };

  Board.prototype.isEmptyBorder = function (border) {
    var c = this.getCorner(border);
    var d = this.getPerpendicular(border);
    while (this.isValid(c)) {
      if (this.getElement(c) > FREE) return false;
      c = moved(c, d);
    }
    return true;
  };

  Board.prototype.removeEmptyBorders = function () {
    while (this.isEmptyBorder(DIR.UP) && this.minY <= this.maxY) this.removeBorder(DIR.UP);
    while (this.isEmptyBorder(DIR.DOWN) && this.minY <= this.maxY) this.removeBorder(DIR.DOWN);
    while (this.isEmptyBorder(DIR.LEFT) && this.minX <= this.maxX) this.removeBorder(DIR.LEFT);
    while (this.isEmptyBorder(DIR.RIGHT) && this.minX <= this.maxX) this.removeBorder(DIR.RIGHT);
  };

  Board.prototype.removeBorder = function (border) {
    var c = this.getCorner(border);
    var d = this.getPerpendicular(border);
    while (this.isValid(c)) {
      if (this.getElement(c) !== DESTROYED) this.destroy(c);
      c = moved(c, d);
    }
    if (border === DIR.UP) this.minY++;
    if (border === DIR.DOWN) this.maxY--;
    if (border === DIR.LEFT) this.minX++;
    if (border === DIR.RIGHT) this.maxX--;
  };

  Board.prototype.getCorner = function (border) {
    if (border === DIR.UP) return { x: this.minX, y: this.minY };
    if (border === DIR.DOWN) return { x: this.minX, y: this.maxY };
    if (border === DIR.LEFT) return { x: this.minX, y: this.minY };
    if (border === DIR.RIGHT) return { x: this.maxX, y: this.minY };
    return { x: 0, y: 0 };
  };

  Board.prototype.getPerpendicular = function (d) {
    if (d === DIR.UP || d === DIR.DOWN) return DIR.RIGHT;
    if (d === DIR.LEFT || d === DIR.RIGHT) return DIR.DOWN;
    return DIR.BAD;
  };

  // Ordre d'animation d'un fruit pour un mouvement (gui/Board.as : la tête de
  // file — la plus proche du bord de destination — bouge en premier).
  Board.prototype.getMoveOrder = function (c, d) {
    switch (d) {
      case DIR.UP: return this.maxY - c.y;
      case DIR.DOWN: return c.y - this.minY;
      case DIR.RIGHT: return c.x - this.minX;
      case DIR.LEFT: return this.maxX - c.x;
      default: return 0;
    }
  };

  // Pièges touchés depuis le dernier appel (serveur : à révéler).
  Board.prototype.takeTrapHits = function () {
    var hits = this.trapHits;
    this.trapHits = [];
    return hits;
  };

  // ── Sérialisation (format du XML <b> d'origine : chiffre = élément + 7) ───
  // TRAPPED=3, DESTROYED=4, ROCK=5, FREE=6, TEAM_0=7, TEAM_1=8.
  Board.prototype.toContentString = function () {
    var out = "";
    for (var i = 0; i < this.size * this.size; i++) {
      var e = this.slots[i];
      out += (e === undefined || e === null) ? "." : String(e + 7);
    }
    return out;
  };

  Board.fromContent = function (size, content, bounds) {
    var b = new Board(size);
    for (var i = 0; i < content.length; i++) {
      var ch = content.charAt(i);
      if (ch === ".") continue;
      var type = parseInt(ch, 10) - 7;
      b.setElementAt(i, type);
      if (type > FREE) b.teamCounters[type]++;
    }
    if (bounds) {
      b.minX = bounds.x1; b.maxX = bounds.x2;
      b.minY = bounds.y1; b.maxY = bounds.y2;
    }
    return b;
  };

  Board.prototype.clone = function () {
    var b = new Board(this.size);
    b.minX = this.minX; b.maxX = this.maxX;
    b.minY = this.minY; b.maxY = this.maxY;
    b.slots = this.slots.slice();
    b.teamCounters = this.teamCounters.slice();
    return b;
  };

  // Plateau de départ : grille PLEINE, moitié/moitié, mélangée. (Le serveur
  // d'origine générait la position ; le plateau d'exemple du source — cf.
  // Main.as showDummyGame — est plein à quelques cases libres près. Pour une
  // taille impaire, la case excédentaire reste libre.)
  Board.newStartingBoard = function (size, rng) {
    rng = rng || Math.random;
    var total = size * size;
    var per = Math.floor(total / 2);
    var fill = [];
    for (var i = 0; i < per; i++) fill.push(TEAM_0);
    for (var j = 0; j < per; j++) fill.push(TEAM_1);
    while (fill.length < total) fill.push(FREE);
    for (var k = fill.length - 1; k > 0; k--) {     // Fisher-Yates
      var r = Math.floor(rng() * (k + 1));
      var t = fill[k]; fill[k] = fill[r]; fill[r] = t;
    }
    var b = new Board(size);
    for (var n = 0; n < total; n++) {
      b.setElementAt(n, fill[n]);
      if (fill[n] > FREE) b.teamCounters[fill[n]]++;
    }
    return b;
  };

  Board.prototype.toString = function () {
    var out = "";
    for (var y = 0; y < this.size; y++) {
      for (var x = 0; x < this.size; x++) {
        var e = this.slots[y * this.size + x];
        out += (e === DESTROYED) ? " X" : (e === FREE) ? " ." : (e === TEAM_0) ? " 0"
          : (e === TEAM_1) ? " 1" : (e === ROCK) ? " #" : (e === TRAPPED) ? " T" : " ?";
      }
      out += "\n";
    }
    return out;
  };

  return {
    DIR: DIR, DIR_NAMES: DIR_NAMES, DIR_LOG: DIR_LOG,
    dirOpposite: dirOpposite, dirValueOf: dirValueOf, moved: moved,
    TRAPPED: TRAPPED, DESTROYED: DESTROYED, ROCK: ROCK, FREE: FREE,
    TEAM_0: TEAM_0, TEAM_1: TEAM_1,
    Board: Board,
  };
});
