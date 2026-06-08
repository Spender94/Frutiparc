//
// Grapiz — IA (bot). Pur et testable : choisit un coup pour une équipe selon un
// niveau de jeu `skill` (0 = faible, 1 = fort) et un générateur aléatoire `rng`.
//
// Heuristique (Lines of Action) : l'objectif est de réunir tous ses jetons en UN
// SEUL groupe connexe. L'évaluation récompense donc surtout la RÉDUCTION du
// nombre de groupes (1 = gagné), un peu la compacité et la capture adverse.
// Le niveau module : proba de jouer le (quasi-)meilleur coup vs un coup random,
// largeur de la "bande" des bons coups, et prise d'un gain immédiat.
//
(function (root, factory) {
  var E = (typeof require !== "undefined") ? require("../engine.js") : (root.Grapiz && root.Grapiz.engine);
  var api = factory(E);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else (root.Grapiz = root.Grapiz || {}).bot = api;
})(typeof self !== "undefined" ? self : this, function (E) {
  "use strict";

  function key(c) { return c.x + "," + c.y; }

  // Nombre de groupes connexes (voisinage 6 dirs hex) des jetons d'une équipe.
  function groupCount(board, team) {
    var toks = board.teamTokens(team);
    if (toks.length === 0) return 0;
    var present = {}, seen = {};
    toks.forEach(function (t) { present[key(t.getCoordinate())] = true; });
    var count = 0;
    toks.forEach(function (t) {
      var k0 = key(t.getCoordinate());
      if (seen[k0]) return;
      count++;
      var stack = [t.getCoordinate()]; seen[k0] = true;
      while (stack.length) {
        var c = stack.pop();
        for (var i = 0; i < E.DIR_LIST.length; i++) {
          var nb = c.next(E.DIR_LIST[i]), k = key(nb);
          if (present[k] && !seen[k]) { seen[k] = true; stack.push(nb); }
        }
      }
    });
    return count;
  }

  // Étalement : somme des distances au centroïde (compacité, plus c'est petit mieux).
  function spread(board, team) {
    var toks = board.teamTokens(team);
    if (toks.length < 2) return 0;
    var sx = 0, sy = 0;
    toks.forEach(function (t) { var c = t.getCoordinate(); sx += c.x; sy += c.y; });
    var cx = sx / toks.length, cy = sy / toks.length, s = 0;
    toks.forEach(function (t) { var c = t.getCoordinate(); s += Math.abs(c.x - cx) + Math.abs(c.y - cy); });
    return s;
  }

  var START_TOKENS = 9; // par équipe (plateau lambda)

  // Évaluation pour `team` (plus c'est grand, mieux c'est).
  function evalFor(board, team, opp) {
    var myN = board.teamTokens(team).length;
    if (myN === 0) return -1e6;                 // éliminé
    var g = groupCount(board, team);
    if (g <= 1) return 1e6;                      // connecté → gagné
    var oppN = board.teamTokens(opp).length;
    var og = groupCount(board, opp);
    return -100 * g - 2 * spread(board, team) + 3 * (START_TOKENS - oppN) + 1.5 * og;
  }

  function cloneBoard(board) {
    return E.Board.fromDefinition({
      size: board.getSize(),
      tokens: board.getTokens().map(function (t) { var c = t.getCoordinate(); return { t: t.getTeam(), x: c.x, y: c.y }; }),
    });
  }

  // Tous les coups légaux d'une équipe : [{ from:{x,y}, direction, target }].
  function allMoves(board, team) {
    var out = [];
    board.teamTokens(team).forEach(function (tok) {
      var from = tok.getCoordinate();
      board.availableMoves(from).forEach(function (m) {
        out.push({ from: { x: from.x, y: from.y }, direction: m.direction, target: m.target });
      });
    });
    return out;
  }

  function applyMove(board, m) {
    var b2 = cloneBoard(board);
    b2.move(new E.Coordinate(m.from.x, m.from.y), m.direction);
    return b2;
  }

  function pick(arr, rng) { return arr[Math.floor(rng() * arr.length) % arr.length]; }

  // Choisit un coup pour `team`. skill ∈ [0,1], rng() ∈ [0,1).
  function chooseMove(board, team, skill, rng) {
    rng = rng || Math.random;
    if (skill == null) skill = 0.5;
    skill = Math.max(0, Math.min(1, skill));
    var opp = team === 0 ? 1 : 0;
    var moves = allMoves(board, team);
    if (!moves.length) return null;

    var scored = moves.map(function (m) {
      var b2 = applyMove(board, m);
      return { m: m, s: evalFor(b2, team, opp), win: groupCount(b2, team) <= 1 };
    });

    // Gain immédiat (connexion) : pris d'autant plus souvent que le niveau est haut.
    var wins = scored.filter(function (x) { return x.win; });
    if (wins.length && rng() < (0.45 + 0.55 * skill)) return pick(wins, rng).m;

    // Meilleur coup vs coup au hasard (gaffe), selon le niveau.
    var pBest = 0.2 + 0.75 * skill;
    if (rng() < pBest) {
      scored.sort(function (a, b) { return b.s - a.s; });
      var top = scored[0].s;
      // bande des "bons" coups : large pour les faibles, étroite pour les forts.
      var band = 5 + (1 - skill) * 120;
      var pool = scored.filter(function (x) { return x.s >= top - band; });
      return pick(pool, rng).m;
    }
    return pick(scored, rng).m; // gaffe : coup légal au hasard
  }

  return { chooseMove: chooseMove, groupCount: groupCount, evalFor: evalFor, allMoves: allMoves, applyMove: applyMove };
});
