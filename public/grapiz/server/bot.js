//
// Grapiz — IA (bot). Pur et testable. Choisit un coup pour une équipe selon un
// niveau `skill` (0=faible … 1=fort) et un rng.
//
// Recherche minimax (negamax) + élagage alpha-beta, profondeur 2 ou 3 selon le
// niveau (jamais "1 coup passif"). Évaluation orientée stratégie Lines of Action :
//   • CONNEXION : réunir ses jetons en un seul groupe (1 = gagné) — terme dominant.
//   • BRISER les chaînes adverses : maximiser le nb de groupes de l'adversaire
//     (capturer un jeton qui le reliait), gêner sa compacité.
//   • CONTRÔLE DU CENTRE : ses jetons proches du centre, en éloigner l'adversaire.
//   • CAPTURES : réduire le matériel adverse (moins de bloqueurs, vers l'élimination).
// Le niveau module la profondeur, la proba de jouer LE meilleur coup et la
// fréquence d'un coup "presque optimal" (jamais purement random sauf très rare).
//
(function (root, factory) {
  var E = (typeof require !== "undefined") ? require("../engine.js") : (root.Grapiz && root.Grapiz.engine);
  var api = factory(E);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else (root.Grapiz = root.Grapiz || {}).bot = api;
})(typeof self !== "undefined" ? self : this, function (E) {
  "use strict";

  var START_TOKENS = 9, WIN = 100000;
  function other(team) { return team === 0 ? 1 : 0; }
  function key(c) { return c.x + "," + c.y; }
  // distance hexagonale (mes axes ↔ axial standard q=x, r=-y).
  function hexDist(ax, ay, bx, by) { var dx = bx - ax, dy = by - ay; return (Math.abs(dx) + Math.abs(dy) + Math.abs(dx - dy)) / 2; }

  function groupCount(board, team) {
    var toks = board.teamTokens(team);
    if (toks.length === 0) return 0;
    var present = {}, seen = {}, count = 0;
    toks.forEach(function (t) { present[key(t.getCoordinate())] = true; });
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

  // Étalement : somme des distances hex au centroïde (arrondi). Plus petit = compact.
  function spread(board, team) {
    var toks = board.teamTokens(team);
    if (toks.length < 2) return 0;
    var sx = 0, sy = 0;
    toks.forEach(function (t) { var c = t.getCoordinate(); sx += c.x; sy += c.y; });
    var cx = Math.round(sx / toks.length), cy = Math.round(sy / toks.length), s = 0;
    toks.forEach(function (t) { var c = t.getCoordinate(); s += hexDist(c.x, c.y, cx, cy); });
    return s;
  }

  // Contrôle du centre : somme de (rayon − distance au centre) sur ses jetons.
  function centerScore(board, team, size) {
    var s = 0;
    board.teamTokens(team).forEach(function (t) { var c = t.getCoordinate(); s += (size - hexDist(c.x, c.y, size, size)); });
    return s;
  }

  function isWin(board, mover) {
    return board.teamTokens(other(mover)).length === 0 || groupCount(board, mover) === 1;
  }

  // Évaluation du POINT DE VUE de `team` (positif = bon pour team).
  function evaluate(board, team) {
    var opp = other(team);
    var myN = board.teamTokens(team).length, opN = board.teamTokens(opp).length;
    if (myN === 0) return -WIN;
    if (opN === 0) return WIN;
    var g = groupCount(board, team);
    if (g === 1) return WIN;
    var og = groupCount(board, opp);
    if (og === 1) return -WIN;
    var size = board.getSize(), s = 0;
    s -= g * 1000;                                  // connecter ses jetons (dominant)
    s += og * 700;                                  // briser/empêcher la connexion adverse
    s -= spread(board, team) * 10;                  // compacité
    s += spread(board, opp) * 7;
    s += centerScore(board, team, size) * 14;       // contrôle du centre
    s -= centerScore(board, opp, size) * 11;
    s += (START_TOKENS - opN) * 35;                 // capturer l'adversaire
    s -= (START_TOKENS - myN) * 30;                 // éviter de se faire capturer
    return s;
  }

  function cloneBoard(board) {
    return E.Board.fromDefinition({
      size: board.getSize(),
      tokens: board.getTokens().map(function (t) { var c = t.getCoordinate(); return { t: t.getTeam(), x: c.x, y: c.y }; }),
    });
  }
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

  // Negamax + alpha-beta. Renvoie la valeur pour `team` (à qui de jouer).
  function negamax(board, team, depth, alpha, beta, ctx) {
    ctx.nodes++;
    if (board.teamTokens(team).length === 0) return -WIN - depth;
    if (depth <= 0 || ctx.nodes > ctx.budget) return evaluate(board, team);
    var moves = allMoves(board, team);
    if (!moves.length) return evaluate(board, team);
    var opp = other(team), best = -Infinity;
    for (var i = 0; i < moves.length; i++) {
      var b2 = applyMove(board, moves[i]);
      var v = isWin(b2, team) ? (WIN + depth) : -negamax(b2, opp, depth - 1, -beta, -alpha, ctx);
      if (v > best) best = v;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  function pick(arr, rng) { return arr[Math.floor(rng() * arr.length) % arr.length]; }

  function chooseMove(board, team, skill, rng) {
    rng = rng || Math.random;
    if (skill == null) skill = 0.5;
    skill = Math.max(0, Math.min(1, skill));
    var opp = other(team);
    var moves = allMoves(board, team);
    if (!moves.length) return null;

    var depth = skill < 0.6 ? 2 : (skill < 0.88 ? 3 : 4);   // les plus forts anticipent plus loin
    var ctx = { nodes: 0, budget: 120000 };

    // Pré-score 1-coup (sert à ordonner ET de repli si le budget est atteint).
    var scored = moves.map(function (m) {
      var b2 = applyMove(board, m), win = isWin(b2, team);
      return { m: m, b2: b2, win: win, pre: win ? 1e9 : evaluate(b2, team), v: null };
    });
    scored.sort(function (a, b) { return b.pre - a.pre; });

    // Recherche profonde dans l'ordre (les meilleurs d'abord → bon élagage).
    for (var i = 0; i < scored.length; i++) {
      if (scored[i].win) { scored[i].v = 1e9; continue; }
      if (ctx.nodes > ctx.budget) { scored[i].v = scored[i].pre - 1e6; continue; } // non exploré → relégué
      scored[i].v = -negamax(scored[i].b2, opp, depth - 1, -Infinity, Infinity, ctx);
    }
    scored.sort(function (a, b) { return b.v - a.v; });

    // Sélection selon le niveau.
    if (scored[0].v >= 1e9 && rng() < (0.65 + 0.35 * skill)) return scored[0].m;  // prend un gain immédiat
    if (rng() < 0.04 * (1 - skill)) return pick(scored, rng).m;                    // gaffe rare (très faibles)
    var pBest = 0.5 + 0.5 * skill;
    if (rng() < pBest) return scored[0].m;                                         // le meilleur coup
    var k = Math.min(scored.length - 1, 1 + Math.floor((1 - skill) * 4));          // sinon un quasi-meilleur (2e..k)
    return scored[1 + Math.floor(rng() * k)].m;
  }

  return {
    chooseMove: chooseMove, groupCount: groupCount, evaluate: evaluate,
    evalFor: function (board, team) { return evaluate(board, team); },
    allMoves: allMoves, applyMove: applyMove, centerScore: centerScore,
  };
});
