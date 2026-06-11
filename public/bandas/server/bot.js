//
// Frutibandas — IA (bot). Pure et testable. Choisit l'action d'une équipe
// selon un niveau `skill` (0=faible … 1=fort) et un rng.
//
// Le cœur du jeu est un rapport de force matériel : on évalue chaque
// direction en SIMULANT le coup (clone du plateau) — différentiel de fruits,
// garde aussi un œil sur la géométrie (rester loin du vide). Profondeur 2
// (réponse adverse la plus cruelle) pour les bons niveaux. Les cartes sont
// jouées à l'occasion, avec des heuristiques simples par carte.
//
(function (root, factory) {
  var E = (typeof require !== "undefined") ? require("../engine.js") : (root.Bandas && root.Bandas.engine);
  var G = (typeof require !== "undefined") ? require("../game.js") : (root.Bandas && root.Bandas.game);
  var api = factory(E, G);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else (root.Bandas = root.Bandas || {}).bot = api;
})(typeof self !== "undefined" ? self : this, function (E, G) {
  "use strict";

  var DIRS = [E.DIR.UP, E.DIR.RIGHT, E.DIR.DOWN, E.DIR.LEFT];
  var WIN = 100000;
  var CARD = G.CARD;

  // Évaluation du POINT DE VUE de `team` : différentiel de fruits avant tout.
  function evaluate(board, team) {
    var my = board.countSpritesOf(team), op = board.countSpritesOf(1 - team);
    if (my <= 0 && op <= 0) return 0;
    if (my <= 0) return -WIN;
    if (op <= 0) return WIN;
    return (my - op) * 100;
  }

  function applyMove(board, team, d) {
    var b = board.clone();
    b.move(team, d);
    b.removeEmptyBorders();
    b.takeTrapHits();
    return b;
  }

  // Meilleure réponse adverse (1 demi-coup) — la plus cruelle pour `team`.
  function worstReply(board, team) {
    var worst = WIN;
    for (var i = 0; i < DIRS.length; i++) {
      var b = applyMove(board, 1 - team, DIRS[i]);
      var v = evaluate(b, team);
      if (v < worst) worst = v;
    }
    return worst;
  }

  // Note chaque direction pour `team` ; depth 2 = en tenant compte de la
  // meilleure réponse adverse.
  function scoreMoves(board, team, depth) {
    return DIRS.map(function (d) {
      var b = applyMove(board, team, d);
      var v = evaluate(b, team);
      if (depth > 1 && v > -WIN && v < WIN) v = (v + worstReply(b, team)) / 2;
      return { direction: d, score: v };
    });
  }

  // Choix d'une direction : les bons niveaux jouent le meilleur coup, les
  // faibles dévient plus souvent vers un coup quelconque.
  function chooseMove(board, team, skill, rng) {
    rng = rng || Math.random;
    var depth = skill > 0.55 ? 2 : 1;
    var scored = scoreMoves(board, team, depth).sort(function (a, b) { return b.score - a.score; });
    if (rng() < 0.15 + 0.8 * (1 - skill)) {           // écart : un des 2 meilleurs
      return scored[Math.min(1, scored.length - 1)].direction;
    }
    return scored[0].direction;
  }

  // Pendant le draft : préférence simple, sinon au hasard.
  var DRAFT_PREF = [CARD.VACHETTE, CARD.ENCLUME, CARD.RENFORT, CARD.CONVERSION,
    CARD.CHARGE, CARD.CELERITE, CARD.PETRIFICATION, CARD.PIEGE,
    CARD.DESORDRE, CARD.CONFISCATION, CARD.SOLO, CARD.ENTRACTE];
  function chooseDraft(pool, skill, rng) {
    rng = rng || Math.random;
    if (rng() > skill) return pool[Math.floor(rng() * pool.length)];
    var best = pool[0];
    for (var i = 1; i < pool.length; i++) {
      if (DRAFT_PREF.indexOf(pool[i]) < DRAFT_PREF.indexOf(best)) best = pool[i];
    }
    return best;
  }

  // Cherche une carte qui vaut la peine d'être jouée MAINTENANT. Renvoie
  // { card, x?, y? } ou null. Heuristiques volontairement simples.
  function chooseCardPlay(game, team, skill, rng) {
    rng = rng || Math.random;
    var hand = game.hands[team];
    if (!hand.length) return null;
    if (rng() > 0.25 + 0.35 * skill) return null;     // la plupart des tours : pas de carte

    var board = game.board;
    var my = board.countSpritesOf(team), op = board.countSpritesOf(1 - team);

    // cellules utiles
    function cells(pred) {
      var out = [];
      for (var y = board.minY; y <= board.maxY; y++) {
        for (var x = board.minX; x <= board.maxX; x++) {
          var c = { x: x, y: y };
          if (pred(board.getElement(c), c)) out.push(c);
        }
      }
      return out;
    }
    function pick(list) { return list[Math.floor(rng() * list.length)]; }

    var options = [];
    hand.forEach(function (card) {
      switch (card) {
        case CARD.VACHETTE: {
          // colonne au meilleur différentiel (adverses − alliés ≥ 2)
          var bestX = null, bestDiff = 1;
          for (var x = board.minX; x <= board.maxX; x++) {
            var diff = 0;
            for (var y = board.minY; y <= board.maxY; y++) {
              var e = board.getElement({ x: x, y: y });
              if (e === 1 - team) diff++;
              else if (e === team) diff--;
            }
            if (diff > bestDiff) { bestDiff = diff; bestX = x; }
          }
          if (bestX !== null) options.push({ card: card, x: bestX, y: board.minY, w: 3 + bestDiff });
          break;
        }
        case CARD.ENCLUME: {
          var foes = cells(function (e) { return e === 1 - team; });
          if (foes.length) options.push({ card: card, target: pick(foes), w: 3 });
          break;
        }
        case CARD.CONVERSION: {
          var foes2 = cells(function (e) { return e === 1 - team; });
          if (foes2.length) options.push({ card: card, target: pick(foes2), w: 3 });
          break;
        }
        case CARD.PETRIFICATION: {
          var foes3 = cells(function (e) { return e === 1 - team; });
          if (foes3.length) options.push({ card: card, target: pick(foes3), w: 2 });
          break;
        }
        case CARD.RENFORT:
          if (cells(function (e) { return e === E.FREE; }).length) {
            options.push({ card: card, w: my < op ? 4 : 2 });
          }
          break;
        case CARD.CHARGE: options.push({ card: card, w: 2 }); break;
        case CARD.CELERITE: options.push({ card: card, w: 2 }); break;
        case CARD.DESORDRE: options.push({ card: card, w: 2 }); break;
        case CARD.CONFISCATION:
          if (game.hands[1 - team].length) options.push({ card: card, w: 2 });
          break;
        case CARD.PIEGE: {
          var free = cells(function (e) { return e === E.FREE; });
          if (free.length) options.push({ card: card, target: pick(free), w: 1 });
          break;
        }
        case CARD.SOLO: {
          var mine = cells(function (e) { return e === team; });
          if (mine.length && my > op) options.push({ card: card, target: pick(mine), w: 1 });
          break;
        }
        case CARD.ENTRACTE:
          // passer son tour n'est utile que dans des positions fines : rare
          if (rng() < 0.1) options.push({ card: card, w: 1 });
          break;
      }
    });
    if (!options.length) return null;

    // tirage pondéré
    var total = 0;
    options.forEach(function (o) { total += o.w; });
    var pickAt = rng() * total;
    for (var i = 0; i < options.length; i++) {
      pickAt -= options[i].w;
      if (pickAt <= 0) {
        var o = options[i];
        return { card: o.card, x: o.target ? o.target.x : o.x, y: o.target ? o.target.y : o.y };
      }
    }
    return null;
  }

  return {
    evaluate: evaluate,
    scoreMoves: scoreMoves,
    chooseMove: chooseMove,
    chooseDraft: chooseDraft,
    chooseCardPlay: chooseCardPlay,
  };
});
