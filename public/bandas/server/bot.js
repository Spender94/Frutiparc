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
// D'où la stratégie que les joueurs d'époque connaissaient : LE CONTRÔLE DU
// CENTRE IMPORTE PLUS QUE LE MATÉRIEL. On constitue un bloc central fort, et
// on SUPPRIME SOI-MÊME ses pions des côtés — un pion écarté est déjà à moitié
// perdu : il se fera sortir seul, ou coûtera des tours à rapatrier. L'évaluation
// dit exactement cela :
//
//   • un fruit ne vaut son plein prix que DANS le bloc principal (la plus
//     grande composante connexe) ; un pion écarté est décoté — l'abandonner
//     contre un meilleur bloc est un bon échange, que le négamax fait donc ;
//   • la position du BLOC (sa distance moyenne au bord) pèse davantage qu'un
//     fruit : à choix égal, on recentre plutôt que de compter les têtes ;
//   • la cohésion (contacts entre les siens) départage — un carré résiste
//     mieux aux poussées qu'un serpent.
//
// Par-dessus, un négamax alpha-bêta de profondeur 2 à 6 selon le niveau : le
// bot voit la réponse adverse, et les meilleurs voient trois échanges entiers
// — c'est la profondeur qui convertit le bloc en victoires. Les cartes sont
// choisies par SIMULATION quand leur effet se calcule (enclume, vachette,
// conversion, pétrification, charge, célérité, renfort, désordre) — on ne joue
// une carte que si le plateau qu'elle laisse vaut mieux. La confiscation, elle,
// se joue AU MOMENT OPPORTUN : la main adverse est publique depuis le draft,
// on n'arme la fenêtre que si elle a une vraie carte à voler.
//
// Et une carte a son HEURE (cf. facteurMoment) : le bot brûlait sa main dans
// les premiers tours, alors que la vachette rase une colonne pleine au départ
// quand le renfort, lui, retourne une fin de partie. Le gain simulé est donc
// pondéré par l'avancement — on ne fausse pas le calcul, on dit seulement à
// quel moment une carte mérite d'être dépensée.
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

  // Poids de l'évaluation. LE CENTRE AVANT LE MATÉRIEL : un fruit ne vaut son
  // plein prix que dans le bloc principal, et la position du bloc peut peser
  // plus lourd qu'un fruit. W_FRUIT reste l'unité de compte (« un fruit »)
  // pour les seuils de cartes et l'ombrage des fins de partie.
  // (Réglés au banc d'essai — duels toutes règles à graines fixes, chaque jeu
  // de poids contre le précédent. C'est la MARGE qui a le plus rapporté : la
  // position du bloc vaut jusqu'à ~1,8 fruit, de quoi payer sans hésiter le
  // pion de bord qu'on abandonne pour se recentrer. Décoter l'écarté plus
  // fort, en revanche, ne gagne rien de plus : le bot se met à brader du
  // matériel qu'il aurait pu ramener.)
  var W_FRUIT = 150;    // l'unité : un fruit de plein droit
  var W_BLOC = 150;     // un fruit DU bloc principal
  var W_ECART = 80;     // un pion écarté du bloc — décoté, donc sacrifiable
  var W_COHESION = 60;  // contacts moyens par fruit (0…4) : un carré, pas un serpent
  var W_MARGE = 78;     // distance moyenne au bord DU BLOC (0…~3,5) : LE CENTRE

  // ── Lecture d'une position ────────────────────────────────────────────────
  // Pour une équipe : son compte, ses contacts (paires de voisins orthogonaux),
  // et son BLOC PRINCIPAL — la plus grande composante connexe (orthogonale),
  // avec sa marge au bord cumulée. À taille égale, le bloc le plus central
  // fait foi. L'évaluation tourne des centaines de fois par décision : un
  // balayage pour compter, un parcours en pile pour les composantes.
  function analyse(board) {
    var minX = board.minX, maxX = board.maxX, minY = board.minY, maxY = board.maxY;
    var w = maxX - minX + 1, h = maxY - minY + 1;
    var n = [0, 0], contacts = [0, 0];
    var blocN = [0, 0], blocMarge = [0, 0];
    var grille = new Int8Array(w * h);   // -1 vide/autre, 0/1 fruit
    var x, y, e;
    for (y = minY; y <= maxY; y++) {
      for (x = minX; x <= maxX; x++) {
        e = board.getElement({ x: x, y: y });
        grille[(y - minY) * w + (x - minX)] = (e === 0 || e === 1) ? e : -1;
        if (e !== 0 && e !== 1) continue;
        n[e]++;
        // Contacts : on ne regarde que la droite et le bas — chaque paire est
        // ainsi comptée une fois.
        if (x < maxX && board.getElement({ x: x + 1, y: y }) === e) contacts[e]++;
        if (y < maxY && board.getElement({ x: x, y: y + 1 }) === e) contacts[e]++;
      }
    }
    var vu = new Int8Array(w * h);
    var pile = [];
    for (var dep = 0; dep < w * h; dep++) {
      e = grille[dep];
      if (e < 0 || vu[dep]) continue;
      var taille = 0, marge = 0;
      pile.length = 0; pile.push(dep); vu[dep] = 1;
      while (pile.length) {
        var i = pile.pop();
        taille++;
        var ix = i % w, iy = (i - ix) / w;
        marge += Math.min(ix, w - 1 - ix, iy, h - 1 - iy);
        if (ix > 0 && !vu[i - 1] && grille[i - 1] === e) { vu[i - 1] = 1; pile.push(i - 1); }
        if (ix < w - 1 && !vu[i + 1] && grille[i + 1] === e) { vu[i + 1] = 1; pile.push(i + 1); }
        if (iy > 0 && !vu[i - w] && grille[i - w] === e) { vu[i - w] = 1; pile.push(i - w); }
        if (iy < h - 1 && !vu[i + w] && grille[i + w] === e) { vu[i + w] = 1; pile.push(i + w); }
      }
      if (taille > blocN[e] || (taille === blocN[e] && marge > blocMarge[e])) {
        blocN[e] = taille; blocMarge[e] = marge;
      }
    }
    return { n: n, contacts: contacts, blocN: blocN, blocMarge: blocMarge };
  }

  // Ce que vaut le camp `t` : son bloc à plein prix, ses écartés décotés, sa
  // cohésion, et la CENTRALITÉ du bloc (marge moyenne au bord de ses membres).
  function valeurCamp(a, t) {
    var bloc = a.blocN[t], ecart = a.n[t] - bloc;
    return W_BLOC * bloc + W_ECART * ecart
      + W_COHESION * (a.contacts[t] / a.n[t])
      + W_MARGE * (bloc > 0 ? a.blocMarge[t] / bloc : 0);
  }

  // Évaluation du POINT DE VUE de `team`. Antisymétrique : eval(b,t) === -eval(b,1-t).
  function evaluate(board, team) {
    var a = analyse(board);
    var my = a.n[team], op = a.n[1 - team];
    if (my <= 0 && op <= 0) return 0;
    if (my <= 0) return -WIN;
    if (op <= 0) return WIN;
    return valeurCamp(a, team) - valeurCamp(a, 1 - team);
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
  //
  // Coupe alpha-bêta : appelé plein cadre (−∞, +∞) à la racine, il rend la
  // valeur EXACTE — les coupes n'écourtent que les branches déjà départagées.
  // C'est elle qui paie les nouvelles profondeurs : 6 demi-coups ≈ 8 ms.
  function negamax(board, team, depth, ply, alpha, beta) {
    ply = ply || 0;
    if (alpha === undefined) { alpha = -Infinity; beta = Infinity; }
    var my = board.countSpritesOf(team), op = board.countSpritesOf(1 - team);
    if (my <= 0 || op <= 0) {
      if (my <= 0 && op <= 0) return 0;
      return my <= 0 ? -WIN + ply * W_FRUIT : WIN - ply * W_FRUIT;
    }
    if (depth <= 0) return evaluate(board, team);
    var best = -Infinity;
    for (var i = 0; i < DIRS.length; i++) {
      var v = -negamax(applyMove(board, team, DIRS[i]), 1 - team, depth - 1, ply + 1, -beta, -alpha);
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return best;
  }

  // Profondeur de recherche : le niveau, c'est d'abord ce que le bot VOIT.
  // Le bas de la plage reste à 2-3 (battable, et par des enfants) ; le haut
  // monte à 5-6 depuis l'alpha-bêta — c'est là que l'école du centre convertit :
  // à profondeur égale 6, elle bat l'évaluation matérielle 20-11 (40 duels).
  function depthFor(skill) {
    return skill < 0.6 ? 2 : (skill < 0.85 ? 3 : (skill < 0.95 ? 5 : 6));
  }

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
  // L'école du centre pioche dans cet ordre : vachette (une colonne rasée),
  // renfort (le bloc s'épaissit), célérité (deux poussées sans réponse),
  // désordre (leur pas de côté devient un pas dans le vide), puis la
  // confiscation — jouable au moment opportun maintenant que le bot lit la
  // main adverse. Les cartes d'appoint ferment la marche.
  var DRAFT_PREF = [CARD.VACHETTE, CARD.RENFORT, CARD.CELERITE, CARD.DESORDRE,
    CARD.CONFISCATION, CARD.ENCLUME, CARD.CONVERSION, CARD.CHARGE,
    CARD.PETRIFICATION, CARD.PIEGE, CARD.SOLO, CARD.ENTRACTE];

  // ── LE MOMENT D'UNE CARTE ─────────────────────────────────────────────────
  //
  // Une carte n'a pas la même force à tous les moments de la partie, et le bot
  // les brûlait toutes dans les premiers tours — le plus mauvais usage qu'on
  // puisse en faire.
  //
  //   · la VACHETTE rase une colonne entière : au départ le plateau est plein,
  //     elle emporte une pleine rangée adverse ; à la fin elle balaie du vide ;
  //   · le RENFORT pose jusqu'à trois fruits : trois fruits sur trente ne se
  //     voient pas, trois fruits sur six retournent la partie — et le plateau
  //     rétréci les dépose près du bloc au lieu de les éparpiller ;
  //   · la CONVERSION retourne un fruit : elle compte double (un de moins chez
  //     l'autre, un de plus chez soi) et pèse d'autant plus qu'il en reste peu.
  //
  // `avancement` va de 0 (plateau plein) à 1 (fin de partie). Le facteur
  // multiplie le gain SIMULÉ : on ne fausse pas le calcul, on dit seulement à
  // quel moment une carte mérite qu'on la dépense.
  function avancementPartie(restants) {
    if (restants >= 48) return 0;
    if (restants <= 12) return 1;
    return (48 - restants) / 36;
  }
  function facteurMoment(card, av) {
    switch (card) {
      case CARD.VACHETTE:     return 1.30 - 0.55 * av;   // tôt
      case CARD.RENFORT:      return 0.45 + 0.90 * av;   // tard
      case CARD.CONVERSION:   return 0.55 + 0.70 * av;   // tard
      case CARD.ENCLUME:      return 0.85 + 0.30 * av;   // un peu plus tard
      case CARD.PETRIFICATION:return 1.15 - 0.30 * av;   // bloquer sert tant qu'il y a du monde
      default:                return 1;                  // les autres sont de circonstance
    }
  }

  // Ce que vaut une carte EN MAIN, en fruits — sert à jauger ce qu'une
  // confiscation peut voler. Même hiérarchie que le draft.
  var CARD_VAL = {};
  CARD_VAL[CARD.VACHETTE] = 1.3; CARD_VAL[CARD.RENFORT] = 1.1;
  CARD_VAL[CARD.CELERITE] = 0.9; CARD_VAL[CARD.DESORDRE] = 0.7;
  CARD_VAL[CARD.CONFISCATION] = 0.5; CARD_VAL[CARD.ENCLUME] = 0.9;
  CARD_VAL[CARD.CONVERSION] = 1.0; CARD_VAL[CARD.CHARGE] = 0.6;
  CARD_VAL[CARD.PETRIFICATION] = 0.6; CARD_VAL[CARD.PIEGE] = 0.4;
  CARD_VAL[CARD.SOLO] = 0.35; CARD_VAL[CARD.ENTRACTE] = 0.25;
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
    // Le gain simulé, pondéré par LE MOMENT (cf. facteurMoment) : à gain égal,
    // c'est la carte dont c'est l'heure qui sort.
    var avancement = avancementPartie(my + op);
    function proposer(card, c, gain) {
      var pese = gain * facteurMoment(card, avancement);
      if (!meilleur || pese > meilleur.gain) {
        meilleur = { card: card, x: c ? c.x : undefined, y: c ? c.y : undefined, gain: pese };
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

        case CARD.DESORDRE: {
          // L'adversaire ne sait pas qu'il sera inversé : il choisira SON
          // meilleur mouvement, et c'est l'OPPOSÉ qui s'appliquera. L'apport
          // de la carte, c'est l'ÉCART entre ces deux mondes — même mouvement
          // à nous, même adversaire naïf, retourné ou non. Fort quand il est
          // adossé à un bord (son pas de côté devient un pas dans le vide) ;
          // presque nul sur un plateau ouvert — la carte attend son moment.
          var meilleurInv = -Infinity, meilleurDroit = -Infinity;
          DIRS.forEach(function (dm) {
            var b1 = applyMove(board, team, dm);
            if (b1.countSpritesOf(team) <= 0 || b1.countSpritesOf(1 - team) <= 0) return;
            var naifD = DIRS[0], naifV = -Infinity;
            DIRS.forEach(function (dd) {
              var v = -negamax(applyMove(b1, 1 - team, dd), team, 1, 1);
              if (v > naifV) { naifV = v; naifD = dd; }
            });
            var vInv = valeurSansCarte(applyMove(b1, 1 - team, E.dirOpposite(naifD)), team, depth);
            var vDroit = valeurSansCarte(applyMove(b1, 1 - team, naifD), team, depth);
            if (vInv > meilleurInv) meilleurInv = vInv;
            if (vDroit > meilleurDroit) meilleurDroit = vDroit;
          });
          if (meilleurInv > -Infinity) proposer(card, null, meilleurInv - meilleurDroit);
          break;
        }

        case CARD.CONFISCATION: {
          // Le moment opportun : la main adverse est PUBLIQUE depuis le draft.
          // Voler compte double — il perd sa carte, on la gagne — mais la
          // fenêtre ne dure que son prochain tour : on ne l'arme que s'il a
          // une vraie carte à jouer. Une main d'appoint ne la mérite pas.
          var leurMain = game.hands[1 - team];
          if (!leurMain || !leurMain.length) break;
          var vol = 0;
          leurMain.forEach(function (c2) {
            var v = CARD_VAL[c2] !== undefined ? CARD_VAL[c2] : 0.3;
            if (v > vol) vol = v;
          });
          proposer(card, null, W_FRUIT * (0.15 + 0.85 * vol));
          break;
        }

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
    // (On a essayé de relever EN PLUS la barre en ouverture, pour retenir la
    // main pendant les premiers tours. Au banc d'essai, ni la version douce ni
    // la version sévère ne battaient franchement l'absence de barrière : le
    // facteur de moment fait déjà le travail, et une barrière de plus ne
    // faisait que du bruit. Retirée plutôt que gardée « au cas où ».)
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
    // Le tempo, exposé pour que la doctrine se teste directement.
    avancementPartie: avancementPartie,
    facteurMoment: facteurMoment,
  };
});
