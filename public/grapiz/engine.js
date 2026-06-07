//
// Grapiz — moteur de règles (portage fidèle du source AS2 d'origine).
//
// Source : Games/grapiz/lib/grapiz/{Direction,Coordinate,Token,Board}.as
// (révisions CVS 2004). Le jeu est un « Lines of Action » sur plateau
// HEXAGONAL : un jeton se déplace, le long d'une des 6 lignes hexagonales,
// d'une distance égale au NOMBRE DE JETONS présents sur toute cette ligne ;
// il ne peut pas sauter un jeton adverse (mais peut sauter les siens), peut
// capturer un adverse sur la case d'arrivée, et ne peut pas finir sur un allié.
//
// Ce module est ISOMORPHE : utilisable côté serveur (Node, autorité du jeu) et
// côté client (navigateur, miroir d'affichage + cases jouables). Aucune
// dépendance.  Le rendu (GUI/Convert) et la condition de victoire (qui vivait
// dans le serveur frusion d'origine, absente du source client) sont traités
// ailleurs — voir teamConnected() pour l'hypothèse LOA à confirmer.
//
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else (root.Grapiz = root.Grapiz || {}).engine = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ── Direction ───────────────────────────────────────────────────────────
  // 8 valeurs (N,NE,E,SE,S,SW,W,NW = 0..7) mais seules les 6 directions
  // hexagonales sont jouables (E et W sont "mortes" : aucun déplacement, et
  // absentes de la liste). Deltas (mx,my) repris tels quels de Coordinate.move.
  var DIR = { N: 0, NE: 1, E: 2, SE: 3, S: 4, SW: 5, W: 6, NW: 7, BAD: -1 };
  var DIR_NAMES = ["North", "North-East", "East", "South-East", "South", "South-West", "West", "North-West"];
  // mouvement axial par direction (index = valeur de direction)
  var DELTA = {
    0: [-1, -1], // N
    1: [-1, 0], // NE
    2: [0, 0], // E  (morte)
    3: [0, 1], // SE
    4: [1, 1], // S
    5: [1, 0], // SW
    6: [0, 0], // W  (morte)
    7: [0, -1], // NW
  };
  // Les 6 directions jouables, dans l'ordre exact du source (Direction.list).
  var DIR_LIST = [DIR.N, DIR.NE, DIR.SE, DIR.S, DIR.SW, DIR.NW];

  function dirOpposite(d) {
    switch (d) {
      case DIR.N: return DIR.S;
      case DIR.NE: return DIR.SW;
      case DIR.NW: return DIR.SE;
      case DIR.S: return DIR.N;
      case DIR.SE: return DIR.NW;
      case DIR.SW: return DIR.NE;
      default: return DIR.BAD;
    }
  }
  // Direction.valueOf : seules N,NE,SE,S,SW,NW sont reconnues (E/W → BAD).
  function dirValueOf(n) {
    switch (n) {
      case DIR.N: return DIR.N;
      case DIR.NE: return DIR.NE;
      case DIR.NW: return DIR.NW;
      case DIR.S: return DIR.S;
      case DIR.SE: return DIR.SE;
      case DIR.SW: return DIR.SW;
      default: return DIR.BAD;
    }
  }
  function dirName(d) { return d === DIR.BAD ? "Bad-Direction" : DIR_NAMES[d]; }

  // ── Coordinate ──────────────────────────────────────────────────────────
  function Coordinate(x, y) { this.x = x; this.y = y; }
  Coordinate.prototype.copy = function () { return new Coordinate(this.x, this.y); };
  Coordinate.prototype.move = function (d, n) {
    if (n === undefined) n = 1;
    var delta = DELTA[d] || [0, 0];
    this.x += delta[0] * n;
    this.y += delta[1] * n;
    return this;
  };
  Coordinate.prototype.next = function (d) { return this.copy().move(d, 1); };
  Coordinate.prototype.equals = function (c) { return c && this.x === c.x && this.y === c.y; };
  Coordinate.prototype.toString = function () { return "[" + this.x + " : " + this.y + "]"; };

  // ── Token ───────────────────────────────────────────────────────────────
  function Token(team) { this.team = team; this.coordinate = null; }
  Token.prototype.getTeam = function () { return this.team; };
  Token.prototype.setTeam = function (t) { this.team = t; };
  Token.prototype.getCoordinate = function () { return this.coordinate; };
  Token.prototype.setCoordinate = function (c) { this.coordinate = c; };

  // ── Board ───────────────────────────────────────────────────────────────
  // Stockage : tableau 1D indexé par (lineLength * x) + y. lineLength = 2*size+1.
  function Board(size) {
    this.tokens = [];
    this.size = 0;
    this.lineLength = 0;
    if (size !== undefined) this._setSize(size);
  }
  Board.prototype._setSize = function (size) {
    this.size = size;
    this.lineLength = size * 2 + 1;
  };
  Board.prototype.getSize = function () { return this.size; };
  Board.prototype.getTokens = function () {
    // jetons réellement présents (le tableau interne est creux)
    var out = [];
    for (var i = 0; i < this.tokens.length; i++) if (this.tokens[i]) out.push(this.tokens[i]);
    return out;
  };
  Board.prototype._index = function (c) { return this.lineLength * c.x + c.y; };
  Board.prototype.getAt = function (c) { return this.tokens[this._index(c)]; };
  Board.prototype.setAt = function (c, token) { this.tokens[this._index(c)] = token; };
  Board.prototype.hasAt = function (c) { return this.tokens[this._index(c)] != undefined; };

  // Découpe l'hexagone dans la grille carrée (max = 2*size).
  Board.prototype.isValid = function (c) {
    var max = this.lineLength - 1;
    if (c.x > max || c.y > max) return false;
    if (c.x < 0 || c.y < 0) return false;
    if (c.x >= this.size) {
      var minColumn = c.x - this.size;
      return c.y >= minColumn;
    } else {
      var maxColumn = c.x + this.size;
      return c.y <= maxColumn;
    }
  };

  // Nombre TOTAL de jetons sur la ligne passant par `base` selon l'axe `d`
  // (de base vers l'opposé, base incluse, + de base+1 vers d).
  Board.prototype.countTokensOnLine = function (base, d) {
    var result = 0;
    var opposite = dirOpposite(d);
    var cursor = base.copy();
    while (this.isValid(cursor)) {
      if (this.hasAt(cursor)) result++;
      cursor.move(opposite);
    }
    cursor = base.next(d);
    while (this.isValid(cursor)) {
      if (this.hasAt(cursor)) result++;
      cursor.move(d);
    }
    return result;
  };

  // Case d'arrivée jouable : valide ET (vide OU jeton adverse).
  Board.prototype._canEat = function (c, team) {
    if (!this.isValid(c)) return false;
    var under = this.getAt(c);
    if (under != undefined && under.getTeam() === team) return false;
    return true;
  };

  // Le jeton en `base` peut-il avancer de `n` cases selon `d` ?
  // Les cases intermédiaires (n-1) ne doivent pas contenir d'ADVERSAIRE
  // (on peut sauter ses propres jetons), et l'arrivée doit être "mangeable".
  Board.prototype.canMove = function (base, d, n) {
    var token = this.getAt(base);
    if (token == undefined) return false;
    var c = base.copy();
    for (var i = 0; i < n - 1; i++) {
      c.move(d);
      if (!this.isValid(c)) return false;
      var under = this.getAt(c);
      if (under != undefined && under.getTeam() !== token.getTeam()) return false;
    }
    c.move(d);
    return this._canEat(c, token.getTeam());
  };

  // Applique un déplacement (suppose le coup déjà validé, comme le source).
  // Renvoie le jeton capturé (ou null).
  Board.prototype.move = function (start, d) {
    if (start == undefined) throw new Error("Board.move(): start undefined");
    if (d == undefined || d === DIR.BAD) throw new Error("Board.move(): bad direction");
    var n = this.countTokensOnLine(start, d);
    var t = this.getAt(start);
    if (t == undefined) throw new Error("Board.move(): no token at " + start);
    this.setAt(start, undefined);
    start.move(d, n);
    if (t.getCoordinate()) t.getCoordinate().move(d, n);
    else t.setCoordinate(start.copy());
    var captured = this.getAt(start) || null;
    this.setAt(start, t);
    return captured;
  };

  // Tous les coups jouables pour le jeton en `coord` (6 directions).
  Board.prototype.availableMoves = function (coord) {
    var result = [];
    for (var i = 0; i < DIR_LIST.length; i++) {
      var d = DIR_LIST[i];
      var n = this.countTokensOnLine(coord, d);
      if (this.canMove(coord, d, n)) {
        var target = coord.copy().move(d, n);
        result.push({ target: target, direction: d, distance: n });
      }
    }
    return result;
  };

  // Place un jeton (utilisé par l'init).
  Board.prototype._place = function (team, x, y) {
    var coord = new Coordinate(x, y);
    var token = new Token(team);
    token.setCoordinate(coord);
    this.setAt(coord, token);
    return token;
  };

  // ── Construction depuis une définition ──────────────────────────────────
  // def = { size:Number, tokens:[{t,x,y}, ...] } — équivalent du <b size><s t x y>.
  Board.fromDefinition = function (def) {
    var b = new Board(def.size);
    (def.tokens || []).forEach(function (s) {
      b._place(parseInt(s.t, 10), parseInt(s.x, 10), parseInt(s.y, 10));
    });
    return b;
  };

  // Plateau de départ "lambda" (taille 4, 9 jetons/équipe sur le bord), repris
  // tel quel de Board.newLambdaBoard().
  var LAMBDA_DEF = {
    size: 4,
    tokens: [
      { t: 0, x: 8, y: 8 }, { t: 0, x: 8, y: 5 }, { t: 0, x: 7, y: 3 },
      { t: 0, x: 4, y: 0 }, { t: 0, x: 1, y: 0 }, { t: 0, x: 0, y: 1 },
      { t: 0, x: 0, y: 4 }, { t: 0, x: 3, y: 7 }, { t: 0, x: 5, y: 8 },
      { t: 1, x: 7, y: 8 }, { t: 1, x: 8, y: 7 }, { t: 1, x: 8, y: 4 },
      { t: 1, x: 5, y: 1 }, { t: 1, x: 3, y: 0 }, { t: 1, x: 0, y: 0 },
      { t: 1, x: 0, y: 3 }, { t: 1, x: 1, y: 5 }, { t: 1, x: 4, y: 8 },
    ],
  };
  Board.newLambdaBoard = function () { return Board.fromDefinition(LAMBDA_DEF); };

  // ── Adjacence hexagonale + connexité (HYPOTHÈSE de victoire LOA) ──────────
  // La condition de victoire vivait côté serveur (absente du source client).
  // Grapiz étant un LOA, l'hypothèse est : une équipe gagne quand TOUS ses
  // jetons forment un seul groupe connexe (voisinage = les 6 directions hex).
  // À CONFIRMER avant de l'utiliser comme règle de fin de partie.
  Board.prototype.teamTokens = function (team) {
    return this.getTokens().filter(function (t) { return t.getTeam() === team; });
  };
  Board.prototype.teamConnected = function (team) {
    var toks = this.teamTokens(team);
    if (toks.length <= 1) return true;
    var key = function (c) { return c.x + "," + c.y; };
    var present = {};
    toks.forEach(function (t) { present[key(t.getCoordinate())] = true; });
    var seen = {};
    var stack = [toks[0].getCoordinate()];
    seen[key(stack[0])] = true;
    var count = 0;
    while (stack.length) {
      var c = stack.pop();
      count++;
      for (var i = 0; i < DIR_LIST.length; i++) {
        var nb = c.next(DIR_LIST[i]);
        var k = key(nb);
        if (present[k] && !seen[k]) { seen[k] = true; stack.push(nb); }
      }
    }
    return count === toks.length;
  };

  return {
    DIR: DIR, DIR_LIST: DIR_LIST, DELTA: DELTA,
    dirOpposite: dirOpposite, dirValueOf: dirValueOf, dirName: dirName,
    Coordinate: Coordinate, Token: Token, Board: Board,
    LAMBDA_DEF: LAMBDA_DEF,
  };
});
