/*
 * Swapou 2 — bot de Challenge (« jusqu'où peut-on aller ? »).
 *
 * Politique pure, sans état : à chaque tour, on énumère tous les échanges
 * légaux + l'éventuelle défense du perso, on simule la résolution complète
 * des chaînes sur une copie légère de la grille (sémantique IDENTIQUE au
 * moteur — vérifiée par bot.test.js en équivalence avec engine.js), puis on
 * évalue la position résultante : survie d'abord (hauteurs), fonte de la
 * glace, récolte d'étoiles (carburant des défenses), regroupement des
 * couleurs.
 *
 * Usage prévu : harnais HORS-LIGNE (bot.run.js). Volontairement non branché
 * au client web — il ne doit pas servir à alimenter le classement.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports)
    module.exports = factory(require('./engine.js'));
  else root.SwapouBot = factory(root.SwapouEngine);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';

  const W = 12, H = 14; // plateau challenge
  const ARM = E.FLAG_ARMURE, MET = E.FLAG_NOSWAP, STAR = E.FLAG_STAR;

  // ── grille légère : null | {t, s, fl} (t=-1 si gelé, s=save_t) ───────────
  function copyGrid(level) {
    const g = new Array(W);
    for (let x = 0; x < W; x++) {
      g[x] = new Array(H);
      for (let y = 0; y < H; y++) {
        const f = level.fruits[x][y];
        g[x][y] = f == null ? null : { t: f.t, s: f.save_t, fl: f.flags };
      }
    }
    return g;
  }
  function cloneGrid(g) {
    const n = new Array(W);
    for (let x = 0; x < W; x++) {
      n[x] = new Array(H);
      for (let y = 0; y < H; y++) {
        const c = g[x][y];
        n[x][y] = c == null ? null : { t: c.t, s: c.s, fl: c.fl };
      }
    }
    return n;
  }

  // ── résolution des chaînes (miroir de Player.swapDone/Level) ─────────────
  // grille mutée ; renvoie { score, stars, cracked, phases, pieces }
  function resolve(g, startPhase) {
    let phase = startPhase || 0;
    let score = 0, stars = 0, cracked = 0, totalPieces = 0;
    while (true) {
      const groups = findGroups(g, 3);
      if (groups.length === 0) break;
      phase++;
      let pieces = 0;
      const removed = [];
      for (const grp of groups) {
        pieces += grp.length;
        for (const [x, y] of grp) {
          if ((g[x][y].fl & STAR) !== 0) stars++;
          g[x][y] = null;
          removed.push([x, y]);
        }
      }
      // fend les armures adjacentes aux cases explosées (une seule fois)
      for (const [x, y] of removed)
        for (const [nx, ny] of neigh(x, y)) {
          const c = g[nx][ny];
          if (c != null && (c.fl & ARM) !== 0) {
            c.fl &= ~ARM;
            c.t = c.s;
            cracked++;
          }
        }
      score += E.calcScore(pieces, phase);
      totalPieces += pieces;
      gravity(g);
    }
    return {
      score: score, stars: stars, cracked: cracked,
      phases: phase - (startPhase || 0), pieces: totalPieces,
    };
  }

  function neigh(x, y) {
    const out = [];
    if (x > 0) out.push([x - 1, y]);
    if (x < W - 1) out.push([x + 1, y]);
    if (y > 0) out.push([x, y - 1]);
    if (y < H - 1) out.push([x, y + 1]);
    return out;
  }

  // groupes connexes (4-voisinage) de taille ≥ min, armures exclues (t=-1)
  function findGroups(g, min) {
    const seen = new Array(W * H);
    const groups = [];
    for (let x = 0; x < W; x++)
      for (let y = 0; y < H; y++) {
        const c = g[x][y];
        if (c == null || c.t < 0 || seen[x * H + y]) continue;
        const grp = [];
        const stack = [[x, y]];
        seen[x * H + y] = true;
        while (stack.length) {
          const [cx, cy] = stack.pop();
          grp.push([cx, cy]);
          for (const [nx, ny] of neigh(cx, cy)) {
            const n = g[nx][ny];
            if (n != null && !seen[nx * H + ny] && n.t === c.t) {
              seen[nx * H + ny] = true;
              stack.push([nx, ny]);
            }
          }
        }
        if (grp.length >= min) groups.push(grp);
      }
    return groups;
  }

  function gravity(g) {
    for (let x = 0; x < W; x++) {
      let write = H - 1;
      for (let y = H - 1; y >= 0; y--)
        if (g[x][y] != null) {
          if (write !== y) { g[x][write] = g[x][y]; g[x][y] = null; }
          write--;
        }
    }
  }

  function heights(g) {
    const hs = new Array(W);
    for (let x = 0; x < W; x++) {
      let y = 0;
      while (y < H && g[x][y] == null) y++;
      hs[x] = H - y;
    }
    return hs;
  }

  // taille du groupe contenant (x,y) — flood local
  function groupSize(g, x, y) {
    const c = g[x][y];
    if (c == null || c.t < 0) return 0;
    const seen = new Set([x * H + y]);
    const stack = [[x, y]];
    let n = 0;
    while (stack.length) {
      const [cx, cy] = stack.pop();
      n++;
      for (const [nx, ny] of neigh(cx, cy)) {
        const m = g[nx][ny];
        if (m != null && m.t === c.t && !seen.has(nx * H + ny)) {
          seen.add(nx * H + ny);
          stack.push([nx, ny]);
        }
      }
    }
    return n;
  }

  // un swap ne peut créer un combo qu'à travers les deux cases déplacées ;
  // renvoie la taille totale nettoyable immédiatement (0 si pas de combo)
  function comboSize(g, x1, y1, x2, y2) {
    let total = 0;
    const s1 = groupSize(g, x1, y1);
    if (s1 >= 3) total += s1;
    const c1 = g[x1][y1], c2 = g[x2][y2];
    const sameGroup = c1 != null && c2 != null && c1.t === c2.t && c1.t >= 0;
    if (!sameGroup) {
      const s2 = groupSize(g, x2, y2);
      if (s2 >= 3) total += s2;
    }
    return total;
  }
  function makesCombo(g, x1, y1, x2, y2) {
    return comboSize(g, x1, y1, x2, y2) > 0;
  }

  // ── défenses simulées (DEFENSE_PLAYERS[charId]) ───────────────────────────
  // renvoie { grid, score, stars, cracked } ou null si non gérée
  function simulateDefense(g0, defenseId) {
    const g = cloneGrid(g0);
    if (defenseId === 3) { // PETE1LIGNE (Dimitri) : détruit la ligne du bas
      for (let x = 0; x < W; x++) g[x][H - 1] = null;
      gravity(g);
      const r = resolve(g, 0);
      return { grid: g, score: r.score, stars: r.stars, cracked: r.cracked };
    }
    if (defenseId === 5) { // PETEARMURES (TomTom) : fend toutes les armures
      let cracked = 0;
      for (let x = 0; x < W; x++)
        for (let y = 0; y < H; y++) {
          const c = g[x][y];
          if (c != null && (c.fl & ARM) !== 0) {
            c.fl &= ~ARM;
            c.t = c.s;
            cracked++;
          }
        }
      const r = resolve(g, 0);
      return { grid: g, score: r.score, stars: r.stars, cracked: cracked + r.cracked };
    }
    if (defenseId === 6) { // COMBOS2 (Poivre) : explose les groupes ≥ 2
      // la salve initiale ne rapporte ni score ni étoiles (cf. Animator.combos2)
      const groups = findGroups(g, 2);
      let cracked = 0;
      const removed = [];
      for (const grp of groups)
        for (const [x, y] of grp) { g[x][y] = null; removed.push([x, y]); }
      for (const [x, y] of removed)
        for (const [nx, ny] of neigh(x, y)) {
          const c = g[nx][ny];
          if (c != null && (c.fl & ARM) !== 0) { c.fl &= ~ARM; c.t = c.s; cracked++; }
        }
      gravity(g);
      const r = resolve(g, 0);
      return { grid: g, score: r.score, stars: r.stars, cracked: cracked + r.cracked };
    }
    if (defenseId === 2) { // COUPEUR (Natacha) : rabote les pics à max-2
      const hs = heights(g);
      const maxH = Math.max.apply(null, hs) - 2;
      for (let x = 0; x < W; x++) {
        let hx = hs[x];
        while (hx > maxH) { g[x][H - hx] = null; hx--; }
      }
      const r = resolve(g, 0);
      return { grid: g, score: r.score, stars: r.stars, cracked: r.cracked };
    }
    /*
     * LES TROIS QUI MANQUAIENT. Sans elles, l'analyseur ne proposait JAMAIS
     * la défense de Sel, de Wasabi ni de Moutarde : `simulateDefense` rendait
     * null, le candidat n'existait pas, et les étoiles s'entassaient jusqu'au
     * plafond sans servir — pour Wasabi, l'un des persos les plus joués.
     */
    if (defenseId === 0) { // MOÏSE (Sel) : les deux moitiés s'écartent
      // Player.defend, cas 0 : la moitié gauche glisse d'une case vers le
      // mur, la droite aussi ; les colonnes 0 et W−1 tombent du plateau
      // (explosées sans rien rapporter), les deux du milieu restent VIDES.
      const dw = Math.floor(W / 2);
      for (let y = 0; y < H; y++) {
        for (let x = 1; x < dw; x++) g[x - 1][y] = g[x][y];
        g[dw - 1][y] = null;
        for (let x = W - 2; x >= dw; x--) g[x + 1][y] = g[x][y];
        g[dw][y] = null;
      }
      const r = resolve(g, 0);
      return { grid: g, score: r.score, stars: r.stars, cracked: r.cracked };
    }
    if (defenseId === 1) { // GLISSEMENT (Wasabi) : les hautes donnent aux basses
      // Player.defend, cas 1 : colonnes triées par hauteur ; la plus basse
      // reçoit, PAR LE BAS, le fruit du bas de la plus haute — et ainsi de
      // suite, six paires au plus, tant que la basse est vraiment plus basse.
      // Rien n'est détruit : le plateau se nivelle.
      const hs = heights(g);
      const cols = [];
      for (let x = 0; x < W; x++) cols.push({ x: x, h: hs[x] });
      cols.sort(function (a, b) { return a.h - b.h; });
      const dw = Math.floor(W / 2);
      for (let i = 0; i < dw; i++) {
        const basse = cols[i], haute = cols[W - 1 - i];
        if (basse.h >= haute.h) break;
        // popBottomFruit : la pile de la haute descend d'une case
        const f = g[haute.x][H - 1];
        let y = H - 2;
        while (y >= 0 && g[haute.x][y] != null) { g[haute.x][y + 1] = g[haute.x][y]; y--; }
        g[haute.x][y + 1] = null;
        // pushBottomFruit : la basse monte d'une case et reçoit le fruit en bas
        // (Fruit.init(save_t, flags) : gelé s'il l'était, sinon sa couleur)
        for (let yy = 1; yy < H; yy++) g[basse.x][yy - 1] = g[basse.x][yy];
        g[basse.x][H - 1] = f == null ? null
          : { t: (f.fl & ARM) !== 0 ? -1 : f.s, s: f.s, fl: f.fl };
      }
      const r = resolve(g, 0);
      return { grid: g, score: r.score, stars: r.stars, cracked: r.cracked };
    }
    if (defenseId === 4) { // COLORANT E21 (Moutarde) : une couleur devient GEL d'une autre
      // Player.defend, cas 4 : src et dst tirés au sort (3 couleurs en
      // Challenge), et tout fruit de couleur src devient une ARMURE dont la
      // couleur cachée est dst — étoile et métal perdus au passage (les
      // drapeaux sont REMPLACÉS). Six tirages possibles : on les rend tous,
      // c'est à l'appelant d'en faire l'espérance.
      const variantes = [];
      for (let src = 0; src < E.CHALLENGE_MAX_COLORS; src++)
        for (let dst = 0; dst < E.CHALLENGE_MAX_COLORS; dst++) {
          if (dst === src) continue;
          const v = cloneGrid(g0);
          for (let x = 0; x < W; x++)
            for (let y = 0; y < H; y++) {
              const c = v[x][y];
              if (c != null && c.s === src) { c.s = dst; c.fl = ARM; c.t = -1; }
            }
          const r = resolve(v, 0);
          variantes.push({ grid: v, score: r.score, stars: r.stars, cracked: r.cracked });
        }
      const p = variantes[0];
      return { grid: p.grid, score: p.score, stars: p.stars, cracked: p.cracked, variantes: variantes };
    }
    return null;
  }

  // Challenge.turnDone : après une défense, la ligne ne monte PAS sauf si la
  // ligne du bas n'a plus deux fruits adjacents (noMoreLine).
  function noMoreLine(g) {
    let prev = false;
    for (let x = 0; x < W; x++) {
      if (g[x][H - 1] != null) {
        if (prev) return false;
        prev = true;
      } else prev = false;
    }
    return true;
  }

  // ── évaluation d'une position ─────────────────────────────────────────────
  // willRise : 1 si une ligne va monter après ce coup (échanges, défense
  // « ratée »), 0 sinon. gained : { score, stars, cracked } du coup.
  const WEIGHTS = {
    score: 0.12,        // points marqués (la survie prime sur le score direct)
    starGain: 500,      // une étoile = une défense potentielle
    crack: 16,          // chaque armure fendue redevient jouable
    pieces: 0,          // fruits nettoyés ce tour (gourmandise : nuit, cf. essais)
    danger: 32,         // (h-8)² par colonne au-dessus de 8
    topOut: 250000,     // colonne à 14 après montée : mort quasi assurée
    frozen: 14,         // case gelée
    frozenTop: 12,      // gelée dans les 5 rangées hautes (dur à fendre)
    metal: 5,           // métal : immobile mais explosable
    pairs: 3,           // paires adjacentes de même couleur (potentiel)
    starsBoard: 30,     // fruits-étoiles encore en jeu (carburant à récolter)
    count: 3,           // moins de fruits = plus de marge
    mobility: 9,        // nb d'échanges créant un combo au tour suivant
    mobNext: 0,         // taille du meilleur combo disponible ensuite
    defendBase: 350,    // réticence à dépenser une étoile…
    // …et son CALME : le prix d'une étoile est multiplié par ce facteur
    // quand le plateau est bas (cf. prixDefense), et par rien du tout quand
    // il touche le plafond.
    calme: 3,
    // La RÉSERVE : hors crise, on ne descend pas sous le prix d'une défense
    // — ce qui reste après la dépense doit encore permettre de tirer une
    // fois. Sinon, ce surcoût.
    reserve: 1600,
    // ── LA FIN DE PARTIE SOUS LA GLACE ──
    // Passé cent coups, une ligne sur deux arrive gelée, puis deux sur
    // trois : le plateau devient une masse d'armures percée de poches de
    // fruits libres, et les cascades ne viennent plus des fruits qu'on voit
    // mais de ceux qu'on FEND. Deux termes disent ce que la glace cache :
    //   · latent — les groupes de trois ou plus formés sur la VRAIE couleur
    //     (armures comprises) : une cascade en attente, qui part dès qu'une
    //     explosion voisine fend ses armures ;
    //   · mobLeaf — le nombre de combos jouables sur la grille d'arrivée,
    //     compté à la feuille de la recherche : une position qui garde des
    //     coups en réserve résiste à la ligne suivante, une position qui n'en
    //     a qu'un meurt de sécheresse.
    latent: 0,
    mobLeaf: 0,
    // La PRÉVENTION, pouvoir par pouvoir : un facteur sur le prix de l'étoile
    // dans la zone où l'on peut encore agir avant la crise (hauteurs 9 à 11).
    // Indexé par DEFENSE_PLAYERS (0 Moïse, 1 Glissement, 2 Coupure,
    // 3 Effondrement, 4 Colorant, 5 Ramollissement, 6 Combos) ; absent = 1.
    prevention: {},
  };

  // Les groupes LATENTS : ce qui exploserait si la glace tombait. Un groupe se
  // compte sur `s` (la vraie couleur), armures et métal compris ; seuls ceux
  // qui tiennent au moins une armure comptent — un groupe entièrement libre
  // aurait déjà explosé. Chaque fruit au-delà du troisième pèse un point :
  // c'est la taille de la cascade, pas son existence, qui vaut.
  function latentGroups(g) {
    const seen = new Array(W * H);
    let total = 0;
    for (let x = 0; x < W; x++)
      for (let y = 0; y < H; y++) {
        const c = g[x][y];
        if (c == null || seen[x * H + y]) continue;
        seen[x * H + y] = true;
        const s = c.s;
        let n = 0, gel = 0;
        const stack = [[x, y]];
        while (stack.length) {
          const [cx, cy] = stack.pop();
          n++;
          if ((g[cx][cy].fl & ARM) !== 0) gel++;
          for (const [nx, ny] of neigh(cx, cy)) {
            const m = g[nx][ny];
            if (m != null && !seen[nx * H + ny] && m.s === s) {
              seen[nx * H + ny] = true;
              stack.push([nx, ny]);
            }
          }
        }
        if (n >= 3 && gel > 0) total += n - 2;
      }
    return total;
  }

  /*
   * LE PRIX D'UNE ÉTOILE DÉPEND DU MOMENT.
   *
   * Il était fixe — `defendBase × coût` — quelle que soit la hauteur du
   * plateau. Or une étoile n'a qu'une valeur : celle du coup qu'elle permet
   * quand l'alternative est la mort. Dépensée à hauteur 7 pour éviter une
   * ligne, elle rapporte douze fruits de marge ; gardée pour la hauteur 13,
   * elle rapporte la partie. Le prix fixe ne voyait pas la différence, et
   * l'IA « dilapidait » : un pouvoir pas cher (Dimitri, une étoile) partait
   * dès qu'il rapportait plus que 140 points d'équivalent.
   *
   *   · au plafond (six étoiles), rien à payer : la suivante serait perdue ;
   *   · en crise (hauteur ≥ 12), rien non plus : c'est maintenant qu'elles
   *     servent ;
   *   · entre les deux, un prix qui MONTE quand le plateau descend — jusqu'à
   *     `calme` fois le prix de base sous la hauteur 9 ;
   *   · et hors crise, la RÉSERVE : ne jamais lâcher sa dernière défense.
   */
  function prixDefense(state, hMax) {
    const cout = E.DEFENSE_STARS[state.charId];
    if (state.stars >= E.MAX_POWER) return 0;
    if (hMax >= 12) return 0;
    const k = hMax >= 11 ? 0.35 : hMax >= 10 ? 1 : hMax >= 9 ? 2 : WEIGHTS.calme;
    let prix = WEIGHTS.defendBase * cout * k;
    if (hMax >= 9) {
      const f = WEIGHTS.prevention[E.DEFENSE_PLAYERS[state.charId]];
      if (f !== undefined) prix *= f;
    }
    // La réserve n'a de sens que si DEUX défenses tiennent dans la banque :
    // le Colorant (4★) et le Ramollissement (5★) ne pourront jamais garder
    // la seconde — leur facturer la réserve, c'était les interdire hors
    // crise, pour rien.
    if (state.stars - cout < cout && hMax < 11 && 2 * cout <= E.MAX_POWER) prix += WEIGHTS.reserve;
    return prix;
  }

  function evaluate(g, willRise, gained) {
    const hs = heights(g);
    let v = 0;
    let dead = false, topOut = 0, danger = 0;
    for (let x = 0; x < W; x++) {
      const h = hs[x] + (willRise ? 1 : 0);
      if (hs[x] >= H) dead = true;       // déjà au plafond : genLine échoue
      if (h >= H) topOut++;              // au plafond après la montée
      if (h > 8) danger += (h - 8) * (h - 8);
    }
    if (dead) return -1e9;
    v -= WEIGHTS.topOut * topOut;
    v -= WEIGHTS.danger * danger;

    let frozen = 0, frozenTop = 0, metal = 0, pairs = 0, starsBoard = 0, count = 0;
    for (let x = 0; x < W; x++)
      for (let y = 0; y < H; y++) {
        const c = g[x][y];
        if (c == null) continue;
        count++;
        if ((c.fl & ARM) !== 0) {
          frozen++;
          if (y <= 4) frozenTop++;
        } else {
          if ((c.fl & MET) !== 0) metal++;
          if ((c.fl & STAR) !== 0) starsBoard++;
          if (c.t >= 0) {
            if (x < W - 1 && g[x + 1][y] != null && g[x + 1][y].t === c.t) pairs++;
            if (y < H - 1 && g[x][y + 1] != null && g[x][y + 1].t === c.t) pairs++;
          }
        }
      }
    v -= WEIGHTS.frozen * frozen + WEIGHTS.frozenTop * frozenTop + WEIGHTS.metal * metal;
    v += WEIGHTS.pairs * pairs + WEIGHTS.starsBoard * starsBoard;
    v -= WEIGHTS.count * count;
    if (WEIGHTS.latent) v += WEIGHTS.latent * latentGroups(g);
    v += WEIGHTS.score * gained.score + WEIGHTS.starGain * gained.stars +
      WEIGHTS.crack * gained.cracked + WEIGHTS.pieces * (gained.pieces || 0);
    return v;
  }

  // mobilité de la grille : nb d'échanges créant un combo + taille du
  // meilleur combo immédiat (richesse des suites)
  function mobilityInfo(g) {
    let n = 0, best = 0;
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
          const s = comboSize(g, x, y, nx, ny);
          if (s > 0) n++;
          if (s > best) best = s;
          g[x][y] = c; g[nx][ny] = d;
        }
      }
    return { count: n, best: best };
  }
  function mobility(g) { return mobilityInfo(g).count; }

  // ── profondeur 2 : montée de ligne échantillonnée + meilleure riposte ─────
  // LCG local : échantillons reproductibles, indépendants du RNG du jeu
  let sampleSeed = 987654321;
  function srng(n) {
    sampleSeed = (sampleSeed * 1103515245 + 12345) & 0x7fffffff;
    return sampleSeed % n;
  }

  // miroir de Level.genLine sur la grille légère (étoiles ignorées : 1 %)
  // renvoie false si la ligne ne peut pas monter (= mort)
  function simGenLine(g, ncoups) {
    for (let x = 0; x < W; x++)
      if (g[x][0] != null) return false;
    for (let x = 0; x < W; x++) {
      for (let y = 1; y < H; y++) {
        g[x][y - 1] = g[x][y];
        g[x][y] = null;
      }
    }
    const y = H - 1;
    for (let x = 0; x < W; x++) {
      let color;
      do {
        color = srng(3);
      } while (
        (g[x][y - 1] != null && color === g[x][y - 1].t) ||
        (x > 0 && g[x - 1][y] != null && color === g[x - 1][y].t)
      );
      const isArm = srng(130) < srng(ncoups);
      const isMet = !isArm && srng(250) < srng(ncoups);
      g[x][y] = isArm ? { t: -1, s: color, fl: ARM }
        : isMet ? { t: color, s: color, fl: MET }
          : { t: color, s: color, fl: 0 };
    }
    return true;
  }

  // meilleure riposte sur g (après montée) : max de evaluate() sur les
  // échanges créant un combo (+ une « attente » de référence)
  function bestReply(g) {
    let best = -Infinity;
    const none = { score: 0, stars: 0, cracked: 0, pieces: 0 };
    best = evaluate(g, 1, none); // riposte « attente » (aucun combo joué)
    let combos = 0;
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
          if (makesCombo(g, x, y, nx, ny)) {
            combos++;
            const g2 = cloneGrid(g);
            const r2 = resolve(g2, 0);
            const v2 = evaluate(g2, 1, r2);
            if (v2 > best) best = v2;
          }
          g[x][y] = c; g[nx][ny] = d;
        }
      }
    // Les coups en réserve à la feuille (cf. WEIGHTS.mobLeaf) : au-delà de
    // huit, on ne manque de rien.
    if (WEIGHTS.mobLeaf) best += WEIGHTS.mobLeaf * Math.min(combos, 8);
    return best;
  }

  // valeur espérée d'une position après le coup : E_lignes[ max riposte ]
  function depth2Value(grid, rises, ncoups, samples) {
    if (!rises) return bestReply(cloneGrid(grid));
    let total = 0;
    for (let s = 0; s < samples; s++) {
      const g = cloneGrid(grid);
      if (!simGenLine(g, ncoups)) total += -1e9;
      else total += bestReply(g);
    }
    return total / samples;
  }

  // ── choix du coup ─────────────────────────────────────────────────────────
  // state : { charId, canDefend, stars, ncoups, depth2, samples } — renvoie
  // { type:'swap', pair:{x,y,dx,dy} } | { type:'defend' } | { type:'none' }
  function choose(level, state) {
    const g0 = copyGrid(level);
    const candidates = [];

    for (let x = 0; x < W; x++)
      for (let y = 0; y < H; y++) {
        const c = g0[x][y];
        if (c == null || (c.fl & MET) !== 0) continue;
        for (const [dx, dy] of [[1, 0], [0, 1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx >= W || ny >= H) continue;
          const d = g0[nx][ny];
          if (d == null || (d.fl & MET) !== 0) continue;
          // échange sur place + test combo local (rapide)
          g0[x][y] = d; g0[nx][ny] = c;
          const combo = makesCombo(g0, x, y, nx, ny);
          let entry;
          if (combo) {
            const g = cloneGrid(g0);
            const r = resolve(g, 0);
            entry = {
              type: 'swap', pair: { x: x, y: y, dx: dx, dy: dy },
              grid: g, gained: r,
              v: evaluate(g, 1, r),
            };
          } else {
            const none = { score: 0, stars: 0, cracked: 0, pieces: 0 };
            entry = {
              type: 'swap', pair: { x: x, y: y, dx: dx, dy: dy },
              grid: cloneGrid(g0), gained: none,
              v: evaluate(g0, 1, none),
            };
          }
          g0[x][y] = c; g0[nx][ny] = d;
          candidates.push(entry);
        }
      }

    const hsRoot = heights(g0);
    const hMaxRoot = Math.max.apply(null, hsRoot);
    const prixEtoiles = prixDefense(state, hMaxRoot);
    if (state.canDefend) {
      const defenseId = E.DEFENSE_PLAYERS[state.charId];
      const sim = simulateDefense(g0, defenseId);
      if (sim != null) {
        const rises = noMoreLine(sim.grid) ? 1 : 0;
        // Le prix de l'étoile suit le moment (prixDefense) : rien au plafond
        // ni en crise, cher quand le plateau est bas.
        const v = evaluate(sim.grid, rises, sim) - prixEtoiles;
        candidates.push({ type: 'defend', grid: sim.grid, gained: sim, v: v });
      }
    }

    if (candidates.length === 0) return { type: 'none' };

    candidates.sort(function (a, b) { return b.v - a.v; });

    if (state.depth2) {
      // expectimax : V = gains immédiats + E_lignes[ max riposte ]
      // (la position est jugée aux feuilles de profondeur 2)
      // élargissement panique : plateau haut → recherche plus large/profonde
      let K = Math.min(state.topK || 8, candidates.length);
      let S = state.samples || 3;
      if (hMaxRoot >= 11) {
        K = Math.min(Math.max(K, 18), candidates.length);
        S = Math.max(S, 5);
      }
      for (let i = 0; i < K; i++) {
        const c = candidates[i];
        const gain1 = WEIGHTS.score * c.gained.score +
          WEIGHTS.starGain * c.gained.stars +
          WEIGHTS.crack * c.gained.cracked +
          WEIGHTS.pieces * (c.gained.pieces || 0);
        const rises = c.type === 'defend' ? (noMoreLine(c.grid) ? 1 : 0) : 1;
        const ncoups = (state.ncoups || 50) + (c.type === 'swap' ? 1 : 0);
        c.v = gain1 + depth2Value(c.grid, rises, ncoups, S) -
          (c.type === 'defend' ? prixEtoiles : 0);
      }
      candidates.length = K;
      candidates.sort(function (a, b) { return b.v - a.v; });
    } else {
      // 2e passe : mobilité + richesse du tour suivant pour les meilleurs
      const K = Math.min(8, candidates.length);
      for (let i = 0; i < K; i++) {
        const m = mobilityInfo(candidates[i].grid);
        candidates[i].v += WEIGHTS.mobility * m.count + WEIGHTS.mobNext * m.best;
      }
      candidates.sort(function (a, b) { return b.v - a.v; });
    }

    const best = candidates[0];
    return { type: best.type, pair: best.pair, v: best.v, gained: best.gained };
  }

  return {
    choose: choose,
    // exposés pour les tests
    copyGrid: copyGrid, cloneGrid: cloneGrid, resolve: resolve,
    findGroups: findGroups, gravity: gravity, heights: heights,
    simulateDefense: simulateDefense, noMoreLine: noMoreLine, prixDefense: prixDefense,
    evaluate: evaluate, mobility: mobility, mobilityInfo: mobilityInfo,
    simGenLine: simGenLine, bestReply: bestReply, depth2Value: depth2Value,
    latentGroups: latentGroups,
    WEIGHTS: WEIGHTS,
  };
});
