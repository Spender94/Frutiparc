//
// Frutibandas — IA (bot). Pure et testable. Choisit l'action d'une équipe
// selon un niveau `skill` (0=faible … 1=fort) et un rng.
//
// ── CE QUI FAIT GAGNER À FRUTIBANDAS ───────────────────────────────────────
//
// À son tour on décale TOUS ses fruits d'une case. Board.moveSprite ne tue que
// si la destination sort du plateau (ou est détruite) : une chaîne qui trouve
// UNE case libre devant elle se tasse dedans et personne ne meurt. Autrement
// dit —
//
//   • on perd les fruits qui sont collés au bord VERS LEQUEL on avance, sans
//     un trou devant eux ;
//   • un fruit du CENTRE, avec du vide autour, ne meurt jamais de son propre
//     mouvement ;
//   • les fruits adverses poussent les nôtres : un pion isolé sur un flanc se
//     fait sortir tout seul, un bloc serré se pousse en bloc.
//
// D'où la stratégie que les joueurs d'époque connaissaient : RASSEMBLER UN
// BLOC AU CENTRE, quitte à abandonner ceux des bords. L'évaluation ci-dessous
// dit exactement cela — matériel d'abord, puis cohésion (contacts entre les
// siens) et marge (distance au bord), les deux en MOYENNE par fruit pour
// qu'aucune forme ne vaille jamais deux fruits.
//
// Par-dessus, un négamax de profondeur 2 à 4 selon le niveau : le bot voit la
// réponse adverse, et les meilleurs voient la sienne d'après. Les cartes sont
// choisies par SIMULATION quand leur effet se calcule (enclume, vachette,
// conversion, pétrification, charge, célérité, renfort) — on ne joue une carte
// que si le plateau qu'elle laisse vaut mieux, ce qui vaut mieux que de la
// lâcher au hasard sur une cible au hasard.
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

  // Poids de l'évaluation. Le matériel domine ; la forme départage.
  var W_FRUIT = 150;    // un fruit
  var W_COHESION = 45;  // contacts moyens par fruit (0…4)
  var W_MARGE = 35;     // distance moyenne au bord (0…~3,5)

  // ── Lecture d'une position ────────────────────────────────────────────────
  // Pour une équipe : son compte, ses contacts (paires de voisins orthogonaux)
  // et sa marge cumulée au bord. Un seul balayage du plateau pour les deux
  // équipes — l'évaluation tourne des centaines de fois par décision.
  function analyse(board) {
    var n = [0, 0], contacts = [0, 0], marge = [0, 0];
    for (var y = board.minY; y <= board.maxY; y++) {
      for (var x = board.minX; x <= board.maxX; x++) {
        var e = board.getElement({ x: x, y: y });
        if (e !== 0 && e !== 1) continue;
        n[e]++;
        // Contacts : on ne regarde que la droite et le bas — chaque paire est
        // ainsi comptée une fois.
        if (x < board.maxX && board.getElement({ x: x + 1, y: y }) === e) contacts[e]++;
        if (y < board.maxY && board.getElement({ x: x, y: y + 1 }) === e) contacts[e]++;
        var m = Math.min(x - board.minX, board.maxX - x, y - board.minY, board.maxY - y);
        marge[e] += m;
      }
    }
    return { n: n, contacts: contacts, marge: marge };
  }

  // Évaluation du POINT DE VUE de `team`. Antisymétrique : eval(b,t) === -eval(b,1-t).
  function evaluate(board, team) {
    var a = analyse(board);
    var my = a.n[team], op = a.n[1 - team];
    if (my <= 0 && op <= 0) return 0;
    if (my <= 0) return -WIN;
    if (op <= 0) return WIN;
    var cohMy = a.contacts[team] / my, cohOp = a.contacts[1 - team] / op;
    var margeMy = a.marge[team] / my, margeOp = a.marge[1 - team] / op;
    return W_FRUIT * (my - op)
      + W_COHESION * (cohMy - cohOp)
      + W_MARGE * (margeMy - margeOp);
  }

  function applyMove(board, team, d) {
    var b = board.clone();
    b.move(team, d);
    b.removeEmptyBorders();
    b.takeTrapHits();
    return b;
  }

  // Négamax : la valeur de la position pour l'équipe au trait.
  //
  // `ply` sert à préférer les fins PROCHES : sans lui, gagner en un coup et
  // gagner en quatre valent pareil, et le bot tourne en rond au lieu de
  // conclure — il lui arrivait même de laisser filer un gain immédiat parce
  // qu'un autre chemin menait au même WIN plus loin.
  function negamax(board, team, depth, ply) {
    ply = ply || 0;
    var my = board.countSpritesOf(team), op = board.countSpritesOf(1 - team);
    if (my <= 0 || op <= 0) {
      if (my <= 0 && op <= 0) return 0;
      return my <= 0 ? -WIN + ply * W_FRUIT : WIN - ply * W_FRUIT;
    }
    if (depth <= 0) return evaluate(board, team);
    var best = -Infinity;
    for (var i = 0; i < DIRS.length; i++) {
      var v = -negamax(applyMove(board, team, DIRS[i]), 1 - team, depth - 1, ply + 1);
      if (v > best) best = v;
    }
    return best;
  }

  // Profondeur de recherche : le niveau, c'est d'abord ce que le bot VOIT.
  function depthFor(skill) { return skill < 0.6 ? 2 : (skill < 0.85 ? 3 : 4); }

  // Note chaque direction pour `team` (profondeur `depth` demi-coups au total).
  function scoreMoves(board, team, depth) {
    if (depth === undefined) depth = 2;
    return DIRS.map(function (d) {
      return { direction: d, score: -negamax(applyMove(board, team, d), 1 - team, depth - 1, 1) };
    });
  }

  // Choix d'une direction. Un bon niveau joue le meilleur coup ; un faible
  // dévie parfois vers le deuxième. À égalité, on tire au sort — deux parties
  // contre le même bot ne se ressemblent pas.
  function chooseMove(board, team, skill, rng) {
    rng = rng || Math.random;
    if (skill === undefined || skill === null) skill = 0.5;
    var scored = scoreMoves(board, team, depthFor(skill));
    scored.forEach(function (s) { s.bruit = rng(); });
    scored.sort(function (a, b) { return (b.score - a.score) || (a.bruit - b.bruit); });
    if (scored.length > 1 && rng() < 0.5 * (1 - skill)) return scored[1].direction;
    return scored[0].direction;
  }

  // ── Draft ─────────────────────────────────────────────────────────────────
  // Préférence simple, sinon au hasard (les faibles piochent moins bien).
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

  // ── Cartes ────────────────────────────────────────────────────────────────
  // Valeur d'une position APRÈS coup : la carte laisse un plateau, on le note
  // en tenant compte de la réponse adverse (même regard que pour un mouvement).
  function valeurApres(board, team, depth) {
    return -negamax(board, 1 - team, depth - 1, 1);
  }
  // Valeur de la position si l'on se contente de bouger.
  function valeurSansCarte(board, team, depth) {
    var best = -Infinity;
    for (var i = 0; i < DIRS.length; i++) {
      var v = valeurApres(applyMove(board, team, DIRS[i]), team, depth);
      if (v > best) best = v;
    }
    return best;
  }

  // Cherche la carte qui vaut la peine d'être jouée MAINTENANT, en simulant
  // celles dont l'effet se calcule. Renvoie { card, x?, y? } ou null.
  function chooseCardPlay(game, team, skill, rng) {
    rng = rng || Math.random;
    if (skill === undefined || skill === null) skill = 0.5;
    var hand = game.hands[team];
    if (!hand || !hand.length) return null;

    var board = game.board;
    // Une recherche de moins que pour un mouvement : on en fait beaucoup plus
    // (une par cible possible), et le gain se lit très bien à cette profondeur.
    var depth = Math.max(2, depthFor(skill) - 1);
    var base = valeurSansCarte(board, team, depth);
    var a = analyse(board);
    var my = a.n[team], op = a.n[1 - team];

    function cases(pred) {
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

    // Après avoir posé la carte, on BOUGE encore : la valeur d'une carte, c'est
    // celle du meilleur mouvement qui la suit.
    function apresCarte(b) { return valeurSansCarte(b, team, depth); }

    var meilleur = null;
    function proposer(card, c, gain) {
      if (!meilleur || gain > meilleur.gain) {
        meilleur = { card: card, x: c ? c.x : undefined, y: c ? c.y : undefined, gain: gain };
      }
    }

    hand.forEach(function (card) {
      switch (card) {
        case CARD.ENCLUME:
          cases(function (e) { return e === 1 - team; }).forEach(function (c) {
            var b = board.clone(); b.destroy(c); b.removeEmptyBorders();
            proposer(card, c, apresCarte(b) - base);
          });
          break;

        case CARD.CONVERSION:
          cases(function (e) { return e === 1 - team; }).forEach(function (c) {
            var b = board.clone();
            b.decTeamCounter(1 - team); b.incTeamCounter(team); b.setElement(c, team);
            proposer(card, c, apresCarte(b) - base);
          });
          break;

        case CARD.PETRIFICATION:
          // Un rocher BLOQUE les chaînes : posé sur un fruit adverse, il gèle
          // sa colonne autant qu'il lui coûte un fruit.
          cases(function (e) { return e === 1 - team; }).forEach(function (c) {
            var b = board.clone();
            b.decTeamCounter(1 - team); b.setElement(c, E.ROCK); b.removeEmptyBorders();
            proposer(card, c, apresCarte(b) - base);
          });
          break;

        case CARD.VACHETTE:
          for (var vx = board.minX; vx <= board.maxX; vx++) {
            var bv = board.clone();
            for (var vy = bv.minY; vy <= bv.maxY; vy++) {
              var cc = { x: vx, y: vy };
              var e2 = bv.getElement(cc);
              if (e2 > E.FREE) bv.decTeamCounter(e2);
              bv.setElement(cc, E.FREE);
            }
            bv.removeEmptyBorders();
            proposer(card, { x: vx, y: board.minY }, apresCarte(bv) - base);
          }
          break;

        case CARD.CHARGE: {
          // Le prochain mouvement compte double : on simule les deux pas.
          var meilleurCharge = -Infinity;
          DIRS.forEach(function (d) {
            var b = applyMove(applyMove(board, team, d), team, d);
            var v = valeurApres(b, team, depth);
            if (v > meilleurCharge) meilleurCharge = v;
          });
          proposer(card, null, meilleurCharge - base);
          break;
        }

        case CARD.CELERITE: {
          // On rejoue : deux mouvements de suite, sans réponse entre les deux.
          var meilleurCel = -Infinity;
          DIRS.forEach(function (d1) {
            var b1 = applyMove(board, team, d1);
            DIRS.forEach(function (d2) {
              var v = valeurApres(applyMove(b1, team, d2), team, depth);
              if (v > meilleurCel) meilleurCel = v;
            });
          });
          proposer(card, null, meilleurCel - base);
          break;
        }

        case CARD.RENFORT: {
          // Jusqu'à trois fruits sur des cases libres TIRÉES AU SORT : on prend
          // l'espérance sur deux tirages plutôt que d'imaginer le meilleur cas.
          var libres = cases(function (e) { return e === E.FREE; });
          if (!libres.length) break;
          var somme = 0, essais = 2;
          for (var t = 0; t < essais; t++) {
            var b = board.clone();
            var reste = libres.slice();
            for (var k = 0; k < 3 && reste.length; k++) {
              var c = reste.splice(Math.floor(rng() * reste.length), 1)[0];
              b.setElement(c, team); b.incTeamCounter(team);
            }
            somme += apresCarte(b);
          }
          proposer(card, null, somme / essais - base);
          break;
        }

        case CARD.SOLO: {
          // Un seul fruit bougera : utile pour ne PAS emmener les autres à
          // l'abattoir. On simule chaque (fruit, direction) au meilleur.
          var miens = cases(function (e) { return e === team; });
          if (!miens.length) break;
          // Trop de combinaisons pour tout essayer : on échantillonne.
          var ech = miens.length > 8 ? miens.slice(0, 8) : miens;
          ech.forEach(function (c) {
            DIRS.forEach(function (d) {
              var b = board.clone();
              b.moveSprite(c, d); b.removeEmptyBorders(); b.takeTrapHits();
              var v = valeurApres(b, team, depth);
              proposer(card, c, v - base);
            });
          });
          break;
        }

        case CARD.PIEGE: {
          // Rien d'immédiat : on pose sous le nez de l'adversaire, là où ses
          // fruits arriveront. Petit gain forfaitaire, pour ne pas garder la
          // carte jusqu'à la fin.
          var libres2 = cases(function (e, c) {
            if (e !== E.FREE) return false;
            return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(function (dl) {
              return board.getElement({ x: c.x + dl[0], y: c.y + dl[1] }) === 1 - team;
            });
          });
          if (libres2.length) proposer(card, pick(libres2), W_FRUIT * 0.5);
          break;
        }

        case CARD.DESORDRE:
          // Le prochain mouvement adverse est inversé : d'autant plus fort que
          // l'adversaire est serré contre un bord. Forfait modéré.
          proposer(card, null, W_FRUIT * 0.6);
          break;

        case CARD.CONFISCATION:
          if (game.hands[1 - team] && game.hands[1 - team].length) proposer(card, null, W_FRUIT * 0.5);
          break;

        case CARD.ENTRACTE:
          // Ne pas bouger est un vrai coup quand TOUS nos mouvements coûtent :
          // on compare la position telle quelle au meilleur mouvement.
          proposer(card, null, valeurApres(board.clone(), team, depth) - base);
          break;
      }
    });

    if (!meilleur) return null;
    // Un bon niveau exige un vrai gain ; un faible se décide plus vite (et
    // gaspille donc ses cartes). Le seuil est en « fruits ».
    var seuil = W_FRUIT * (0.15 + 0.55 * skill);
    if (meilleur.gain < seuil) {
      // Fin de partie : garder ses cartes ne sert plus à rien.
      var presqueFini = (my + op) <= 8;
      if (!(presqueFini && meilleur.gain > 0)) return null;
    }
    return { card: meilleur.card, x: meilleur.x, y: meilleur.y };
  }

  return {
    analyse: analyse,
    evaluate: evaluate,
    scoreMoves: scoreMoves,
    chooseMove: chooseMove,
    chooseDraft: chooseDraft,
    chooseCardPlay: chooseCardPlay,
    depthFor: depthFor,
  };
});
