/*
 * Swapou 2 — L'ANALYSE DE POSITION du mode Challenge : « quel est le meilleur
 * coup, et pourquoi ».
 *
 * Le bot de Challenge (bot.js) sait déjà l'essentiel : simuler une chaîne
 * exactement comme le moteur (équivalence prouvée par bot.test.js), énumérer
 * les ~310 échanges et la défense du perso, juger une position, et voir un
 * tour plus loin en échantillonnant la ligne qui monte. Ce module en fait un
 * ANALYSEUR pour un joueur humain :
 *
 *   · il cherche plus loin — profondeur 3 à faisceau, en itératif (1, puis 2,
 *     puis 3) sous un budget de temps ; un humain joue en secondes, on peut se
 *     payer bien plus que les 30 ms du bot ;
 *   · il ne rend pas UN coup mais les meilleurs, chacun avec sa NATURE :
 *       combo         — il marque tout de suite ;
 *       préparation   — un coup SILENCIEUX : il ne marque rien, mais ce qu'il
 *                       met en place vaut plus que le meilleur combo
 *                       immédiat, une fois payé le tour qu'il coûte (la ligne
 *                       monte à chaque échange) ;
 *       attente       — un coup sans combo qui ne prépare rien de mieux ;
 *       défense       — dépenser des étoiles pour le pouvoir du perso ;
 *   · et une RAISON en une ligne (« 9 fruits en 3 phases : +540 », « prépare
 *     une cascade à 610 pts »), parce qu'un conseil qu'on ne comprend pas
 *     n'apprend rien.
 *
 * POURQUOI LA PROFONDEUR FAIT TOUT. PLAN.md l'a mesuré : « le 1-ply ne sait
 * pas préparer », et récompenser directement les fruits nettoyés fait
 * régresser. Un coup silencieux n'a de valeur que si l'on VOIT le combo qu'il
 * prépare — donc si la recherche regarde au moins un tour plus loin que lui.
 * La profondeur 2 voit une préparation simple ; la profondeur 3 voit une
 * cascade qu'on monte en deux temps, et surtout elle juge le coup suivant à
 * la lumière de ce qui vient APRÈS lui, ce qui est la seule façon de ne pas
 * prendre un petit combo qui casse une grande structure.
 *
 * LA LIGNE QUI MONTE EST DU HASARD, et on ne triche pas : elle est
 * échantillonnée avec le générateur miroir du bot (couleurs sans combo
 * immédiat, gel et métal qui croissent avec `ncoups`), plusieurs fois par
 * nœud, et l'on prend l'espérance. C'est un expectimax : coup → hasard →
 * meilleure riposte → hasard → meilleure riposte.
 *
 * Le module est pur (Node et navigateur) et ne joue jamais : il conseille. Le
 * client le fait tourner dans un Worker et dessine le conseil par-dessus le
 * plateau (game.js, `AnalyseOverlay`) ; le harnais bot.run.js le fait jouer
 * pour le mesurer.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports)
    module.exports = factory(require('./engine.js'), require('./bot.js'));
  else root.SwapouAnalyse = factory(root.SwapouEngine, root.SwapouBot);
})(typeof self !== 'undefined' ? self : this, function (E, B) {
  'use strict';

  const W = 12, H = 14;
  const MET = E.FLAG_NOSWAP;

  // ── Réglages par défaut ──────────────────────────────────────────────────
  //
  // CE QUE LES MESURES ONT DIT (harnais bot.run.js, quatre graines, Natacha,
  // poids du record) — et qui a renversé le plan de départ :
  //
  //   faisceau 12, prof. 2 (le bot)  → moyenne 21 200
  //   faisceau 30                    →          29 300
  //   faisceau 80                    →          41 750   (meilleure : 52 060)
  //   faisceau 150                   →          48 000   (deux graines)
  //   faisceau 30 + profondeur 3     →          32 500   (20× plus cher, rien)
  //
  // LA PROFONDEUR N'ÉTAIT PAS LE LEVIER, LA LARGEUR L'ÉTAIT. Le bot triait
  // ses 310 échanges à UN coup avant d'en approfondir douze — or un coup
  // silencieux ne marque rien à un coup : il finissait toujours derrière les
  // combos, hors du faisceau, jamais regardé. Élargir le faisceau, c'est
  // enfin juger les préparations à deux coups, là où elles valent quelque
  // chose. La profondeur 3, elle, ajoute du bruit d'échantillonnage sans rien
  // voir de plus (le meilleur de valeurs bruitées est biaisé vers le haut).
  //
  // K1 vaut donc « tous » ; K2/K3 ne servent que si l'on demande la
  // profondeur 3 ; S : lignes tirées par nœud de hasard (3 suffit — 6 ne
  // fait pas mieux, 2 perd). La panique élargit les tirages.
  const DEFAUTS = {
    budgetMs: 1500,
    profondeur: 2,
    K1: 400, K2: 10, K3: 6, S: 3,
    paniqueK1: 400, paniqueK2: 10, paniqueS: 5,
    // Les poids qui ont donné le record du bot (PLAN.md) : le score pèse
    // lourd, les étoiles encore en jeu aussi.
    poids: { score: 2.5, starsBoard: 80 },
  };

  const RIEN = { score: 0, stars: 0, cracked: 0, pieces: 0, phases: 0 };

  function maintenant() {
    return (typeof performance !== 'undefined' && performance.now)
      ? performance.now() : Date.now();
  }

  // ── Énumération des coups ────────────────────────────────────────────────
  // Chaque candidat : { type, pair, grid (après résolution), gained, v }.
  function enumerer(g0, etat) {
    const candidats = [];
    for (let x = 0; x < W; x++)
      for (let y = 0; y < H; y++) {
        const c = g0[x][y];
        if (c == null || (c.fl & MET) !== 0) continue;
        for (const [dx, dy] of [[1, 0], [0, 1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx >= W || ny >= H) continue;
          const d = g0[nx][ny];
          if (d == null || (d.fl & MET) !== 0) continue;
          g0[x][y] = d; g0[nx][ny] = c;
          const g = B.cloneGrid(g0);
          const r = B.resolve(g, 0);
          g0[x][y] = c; g0[nx][ny] = d;
          candidats.push({
            type: 'swap', pair: { x: x, y: y, dx: dx, dy: dy },
            grid: g, gained: r.score > 0 ? r : RIEN,
            v: B.evaluate(g, 1, r.score > 0 ? r : RIEN),
          });
        }
      }
    if (etat.canDefend) {
      const sim = B.simulateDefense(g0, E.DEFENSE_PLAYERS[etat.charId]);
      if (sim != null) {
        // Le prix de l'étoile suit le moment (bot.js, prixDefense) : rien au
        // plafond ni en crise, cher quand le plateau est bas.
        const prix = B.prixDefense(etat, etat.hMax);
        // Le Colorant tire ses couleurs au sort : la valeur est l'ESPÉRANCE
        // sur les six tirages, et la grille montrée celle du tirage médian.
        const variantes = sim.variantes || [sim];
        const notees = variantes.map(function (s) {
          const rises = B.noMoreLine(s.grid) ? 1 : 0;
          return { sim: s, rises: rises, v: B.evaluate(s.grid, rises, s) };
        }).sort(function (a, b) { return a.v - b.v; });
        const moy = notees.reduce(function (t, n) { return t + n.v; }, 0) / notees.length;
        const rep = notees[Math.floor(notees.length / 2)];
        candidats.push({
          type: 'defend', pair: null, grid: rep.sim.grid,
          gained: { score: rep.sim.score, stars: rep.sim.stars, cracked: rep.sim.cracked, pieces: 0, phases: 0 },
          v: moy - prix, rises: rep.rises, prix: prix,
          variantes: variantes.length > 1 ? notees.map(function (n) { return n.sim; }) : null,
        });
      }
    }
    return candidats;
  }

  // Ce qu'un échange sans combo RANGE : le nombre de voisins de même couleur
  // que les deux fruits déplacés trouvent à leur nouvelle place. Un proxy à
  // coût constant pour ordonner les coups silencieux avant de les juger.
  function pairesFormees(g0, pair) {
    const x1 = pair.x, y1 = pair.y, x2 = x1 + pair.dx, y2 = y1 + pair.dy;
    const a = g0[x1][y1], b = g0[x2][y2];
    if (a == null || b == null) return 0;
    // après l'échange : a en (x2,y2), b en (x1,y1)
    return voisinsMemeCouleur(g0, x2, y2, a.t, x1, y1) + voisinsMemeCouleur(g0, x1, y1, b.t, x2, y2);
  }
  function voisinsMemeCouleur(g, x, y, t, ex, ey) {
    if (t < 0) return 0;
    let n = 0;
    const vois = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
    for (const [nx, ny] of vois) {
      if (nx < 0 || nx >= W || ny < 0 || ny >= H || (nx === ex && ny === ey)) continue;
      const c = g[nx][ny];
      if (c != null && c.t === t) n++;
    }
    return n;
  }

  // Le gain immédiat d'un coup, dans l'unité de l'évaluation.
  function gainImmediat(c, etat) {
    const Wt = B.WEIGHTS;
    // Une étoile récoltée au plafond est PERDUE (Player.as plafonne le
    // compteur à MAX_POWER) : on ne compte que celles qui ont encore une
    // place. Sinon l'IA courait après des étoiles qui ne valent rien.
    const place = Math.max(0, E.MAX_POWER - (etat.stars || 0));
    let g = Wt.score * c.gained.score + Wt.starGain * Math.min(c.gained.stars, place) +
      Wt.crack * c.gained.cracked + Wt.pieces * (c.gained.pieces || 0);
    if (c.type === 'defend') g -= c.prix || 0;
    return g;
  }
  function monte(c) { return c.type === 'defend' ? c.rises : 1; }
  // La valeur à deux coups d'un candidat : pour le Colorant, l'espérance sur
  // ses tirages ; pour les autres, la grille unique.
  function valeur2(c, ncoups, S) {
    if (!c.variantes) return B.depth2Value(c.grid, monte(c), ncoups, S);
    let total = 0;
    for (const s of c.variantes)
      total += B.depth2Value(s.grid, B.noMoreLine(s.grid) ? 1 : 0, ncoups, S);
    return total / c.variantes.length;
  }

  // ── Profondeur 3 ─────────────────────────────────────────────────────────
  // La meilleure riposte sur une grille (après la montée), jugée elle-même à
  // la profondeur 2 : on garde les K3 ripostes les mieux notées à vue, puis
  // pour chacune on regarde la ligne suivante et la riposte d'après.
  function meilleureRiposte3(g, ncoups, K3, S) {
    const ripostes = [];
    // L'« attente » : un échange sans combo, dont on approxime l'effet par la
    // grille inchangée — la même référence que bestReply() du bot.
    ripostes.push({ grid: g, gained: RIEN, v: B.evaluate(g, 1, RIEN) });
    for (let x = 0; x < W; x++)
      for (let y = 0; y < H; y++) {
        const c = g[x][y];
        if (c == null || (c.fl & MET) !== 0) continue;
        for (const [dx, dy] of [[1, 0], [0, 1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx >= W || ny >= H) continue;
          const d = g[nx][ny];
          if (d == null || (d.fl & MET) !== 0) continue;
          g[x][y] = d; g[nx][ny] = c;
          if (comboIci(g, x, y, nx, ny)) {
            const g2 = B.cloneGrid(g);
            const r2 = B.resolve(g2, 0);
            ripostes.push({ grid: g2, gained: r2, v: B.evaluate(g2, 1, r2) });
          }
          g[x][y] = c; g[nx][ny] = d;
        }
      }
    ripostes.sort(function (a, b) { return b.v - a.v; });
    let best = -Infinity;
    const n = Math.min(K3, ripostes.length);
    for (let i = 0; i < n; i++) {
      const r = ripostes[i];
      const Wt = B.WEIGHTS;
      const gain = Wt.score * r.gained.score + Wt.starGain * r.gained.stars +
        Wt.crack * r.gained.cracked;
      const v = gain + B.depth2Value(r.grid, 1, ncoups + 1, S);
      if (v > best) best = v;
    }
    return best;
  }
  // un échange ne crée un combo qu'à travers les deux cases déplacées
  function comboIci(g, x1, y1, x2, y2) {
    return tailleGroupe(g, x1, y1) >= 3 || tailleGroupe(g, x2, y2) >= 3;
  }
  function tailleGroupe(g, x, y) {
    const c = g[x][y];
    if (c == null || c.t < 0) return 0;
    const seen = new Set([x * H + y]);
    const stack = [[x, y]];
    let n = 0;
    while (stack.length) {
      const [cx, cy] = stack.pop();
      n++;
      const vois = [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]];
      for (const [nx, ny] of vois) {
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
        const m = g[nx][ny];
        if (m != null && m.t === c.t && !seen.has(nx * H + ny)) {
          seen.add(nx * H + ny);
          stack.push([nx, ny]);
        }
      }
    }
    return n;
  }

  // E_lignes[ meilleure riposte à profondeur 2 ] — la valeur « à trois coups »
  // d'une position après le coup.
  function valeur3(grid, rises, ncoups, S, K3) {
    if (!rises) return meilleureRiposte3(B.cloneGrid(grid), ncoups, K3, S);
    let total = 0;
    for (let s = 0; s < S; s++) {
      const g = B.cloneGrid(grid);
      if (!B.simGenLine(g, ncoups)) total += -1e9;
      else total += meilleureRiposte3(g, ncoups, K3, S);
    }
    return total / S;
  }

  // ── La meilleure suite immédiate d'une grille (pour EXPLIQUER) ──────────
  // Ce que le joueur pourra jouer au tour suivant si la ligne ne gâche rien :
  // le combo disponible qui rapporte le plus.
  function meilleureSuite(g) {
    let best = null;
    for (let x = 0; x < W; x++)
      for (let y = 0; y < H; y++) {
        const c = g[x][y];
        if (c == null || (c.fl & MET) !== 0) continue;
        for (const [dx, dy] of [[1, 0], [0, 1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx >= W || ny >= H) continue;
          const d = g[nx][ny];
          if (d == null || (d.fl & MET) !== 0) continue;
          g[x][y] = d; g[nx][ny] = c;
          if (comboIci(g, x, y, nx, ny)) {
            const g2 = B.cloneGrid(g);
            const r = B.resolve(g2, 0);
            if (best == null || r.score > best.score)
              best = { score: r.score, pieces: r.pieces, phases: r.phases,
                pair: { x: x, y: y, dx: dx, dy: dy } };
          }
          g[x][y] = c; g[nx][ny] = d;
        }
      }
    return best;
  }

  function pluriel(n, mot) { return n + ' ' + mot + (n > 1 ? 's' : ''); }

  // `c` est le coup tel qu'il sort (gain, nature, suite), pas le candidat.
  function expliquer(c) {
    const g = c.gain;
    if (c.type === 'defend') {
      const morceaux = ['défense'];
      if (g.score > 0) morceaux.push('+' + g.score);
      if (g.cracked > 0) morceaux.push(pluriel(g.cracked, 'armure') + ' fendue' + (g.cracked > 1 ? 's' : ''));
      // Pourquoi MAINTENANT : une défense à plateau bas surprend, sauf si la
      // banque est pleine — la prochaine étoile serait perdue.
      if (c.pleine) morceaux.push('banque pleine, la prochaine étoile serait perdue');
      else if (c.crise) morceaux.push('plateau au plafond');
      return morceaux.join(' · ');
    }
    if (c.nature === 'combo') {
      let s = pluriel(g.pieces, 'fruit') + ' en ' + pluriel(g.phases, 'phase') + ' : +' + g.score;
      if (g.stars > 0) s += ' · ' + pluriel(g.stars, 'étoile');
      if (g.cracked > 0) s += ' · ' + pluriel(g.cracked, 'armure') + ' fendue' + (g.cracked > 1 ? 's' : '');
      return s;
    }
    if (c.nature === 'preparation') {
      return c.suite
        ? 'coup silencieux : prépare ' + c.suite.score + ' pts (' + pluriel(c.suite.pieces, 'fruit')
          + ', ' + pluriel(c.suite.phases, 'phase') + ')'
        : 'coup silencieux : range le plateau';
    }
    return c.suite ? 'sans combo · suite possible : ' + c.suite.score + ' pts' : 'sans combo';
  }

  // ── L'analyse ────────────────────────────────────────────────────────────
  // grille : la grille légère du bot ({t,s,fl}[x][y], null si vide)
  // etat   : { charId, canDefend, stars, ncoups }
  // renvoie { coups: [...], meilleur, profondeur, tempsMs, nb }
  function analyserGrille(grille, etat, options) {
    const o = Object.assign({}, DEFAUTS, options || {});
    const t0 = maintenant();
    const fin = t0 + o.budgetMs;
    if (o.poids) for (const k in o.poids) B.WEIGHTS[k] = o.poids[k];
    etat = Object.assign({ charId: 0, canDefend: false, stars: 0, ncoups: 50 }, etat || {});

    const g0 = B.cloneGrid(grille);
    // La hauteur du plateau sert deux fois : à la panique, et au prix de
    // l'étoile (prixDefense) — on la mesure avant d'énumérer.
    const hs = B.heights(g0);
    let hMax = 0;
    for (let x = 0; x < W; x++) if (hs[x] > hMax) hMax = hs[x];
    etat.hMax = hMax;
    const candidats = enumerer(g0, etat);
    if (candidats.length === 0) {
      return { coups: [], meilleur: null, profondeur: 0, tempsMs: maintenant() - t0, nb: 0 };
    }
    candidats.sort(function (a, b) { return b.v - a.v; });
    let profondeur = 1;

    // panique : le plateau touche presque le plafond
    const panique = hMax >= 11;
    const K1 = Math.min(panique ? o.paniqueK1 : o.K1, candidats.length);
    const K2 = Math.min(panique ? o.paniqueK2 : o.K2, K1);
    const S = panique ? o.paniqueS : o.S;
    const ncoups = (etat.ncoups || 50) + 1;

    // ── profondeur 2 (le bot), sur TOUT le faisceau ──
    //
    // L'ordre d'approfondissement compte dès que le budget peut couper : trié
    // à un coup, les combos passent tous devant, et un budget serré
    // retrouverait le défaut qu'on vient de guérir. On ENTRELACE donc les
    // combos (par leur note à un coup) et les coups silencieux (par ce qu'ils
    // rangent : les paires de même couleur qu'ils forment autour des deux
    // cases échangées) — un sur deux, jusqu'à K1 ou jusqu'au budget.
    if (o.profondeur >= 2) {
      const combos = [], silencieux = [];
      for (let i = 0; i < K1; i++) {
        const c = candidats[i];
        if (c.type === 'defend' || c.gained.score > 0) combos.push(c);
        else { c.proxy = pairesFormees(g0, c.pair); silencieux.push(c); }
      }
      silencieux.sort(function (a, b) { return b.proxy - a.proxy || b.v - a.v; });
      const ordre = [];
      for (let i = 0, j = 0; i < combos.length || j < silencieux.length;) {
        if (i < combos.length) ordre.push(combos[i++]);
        if (j < silencieux.length) ordre.push(silencieux[j++]);
      }
      let juges = 0;
      for (const c of ordre) {
        if (juges >= 8 && maintenant() >= fin) break;   // au moins huit, budget ou pas
        c.v2 = gainImmediat(c, etat) + valeur2(c, ncoups, S);
        juges++;
      }
      // Ce qui a été jugé à deux coups passe devant, dans cet ordre ; le reste
      // garde sa note à un coup, derrière.
      const vus = candidats.filter(function (c) { return c.v2 !== undefined; })
        .sort(function (a, b) { return b.v2 - a.v2; });
      const pasVus = candidats.filter(function (c) { return c.v2 === undefined; });
      for (const c of vus) c.v = c.v2;
      candidats.length = 0;
      for (const c of vus) candidats.push(c);
      for (const c of pasVus) candidats.push(c);
      profondeur = 2;
    }

    // ── profondeur 3 (à faisceau, sous budget) ──
    if (o.profondeur >= 3 && maintenant() < fin) {
      let complet = true;
      for (let i = 0; i < K2; i++) {
        if (maintenant() >= fin) { complet = false; break; }
        const c = candidats[i];
        c.v3 = gainImmediat(c, etat) + valeur3(c.grid, monte(c), ncoups, S, o.K3);
      }
      // Une itération interrompue ne compte pas : mélanger des valeurs de
      // profondeur 3 et 2 fausserait le classement. On ne garde le troisième
      // étage que s'il a jugé tout le faisceau.
      if (complet) {
        const tete = candidats.slice(0, K2).sort(function (a, b) { return b.v3 - a.v3; });
        for (let i = 0; i < K2; i++) { candidats[i] = tete[i]; candidats[i].v = tete[i].v3; }
        profondeur = 3;
      }
    }

    // ── nature et explication ──
    let meilleurCombo = -Infinity;
    for (const c of candidats)
      if (c.type === 'swap' && c.gained.score > 0 && c.v > meilleurCombo) meilleurCombo = c.v;
    const coups = candidats.map(function (c, i) {
      const out = {
        type: c.type, pair: c.pair, valeur: c.v, rang: i + 1,
        gain: { score: c.gained.score, pieces: c.gained.pieces || 0,
          phases: c.gained.phases || 0, stars: c.gained.stars, cracked: c.gained.cracked },
      };
      if (c.type === 'defend') {
        out.nature = 'defense'; out.prix = c.prix || 0;
        out.pleine = etat.stars >= E.MAX_POWER;
        out.crise = hMax >= 12;
      }
      else if (c.gained.score > 0) out.nature = 'combo';
      else {
        // seuls les premiers du classement méritent qu'on cherche leur suite
        if (i < 5) out.suite = meilleureSuite(B.cloneGrid(c.grid));
        out.nature = (c.v > meilleurCombo && out.suite && out.suite.score > 0)
          ? 'preparation' : 'attente';
      }
      out.raison = expliquer(out);
      return out;
    });

    return {
      coups: coups, meilleur: coups[0], profondeur: profondeur,
      tempsMs: Math.round(maintenant() - t0), nb: candidats.length,
      panique: panique,
    };
  }

  // Même chose depuis un Level du moteur.
  function analyser(level, etat, options) {
    return analyserGrille(B.copyGrid(level), etat, options);
  }

  // Le coup à jouer, au format du bot (pour le harnais bot.run.js).
  function choisir(level, etat, options) {
    const a = analyser(level, etat, options);
    if (!a.meilleur) return { type: 'none' };
    const m = a.meilleur;
    return { type: m.type, pair: m.pair, v: m.valeur, gained: m.gain,
      nature: m.nature, raison: m.raison, profondeur: a.profondeur, tempsMs: a.tempsMs };
  }

  return {
    analyser: analyser, analyserGrille: analyserGrille, choisir: choisir,
    DEFAUTS: DEFAUTS,
    // exposés pour les tests
    enumerer: enumerer, meilleureSuite: meilleureSuite, valeur3: valeur3,
    meilleureRiposte3: meilleureRiposte3, expliquer: expliquer,
  };
});
