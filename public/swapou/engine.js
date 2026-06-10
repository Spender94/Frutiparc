/*
 * Swapou 2 — moteur de règles pur (traduction directe du source AS2 :
 * Games/swapou2/swapou2/{Level,IA,Player,Data}.as). Aucune dépendance DOM —
 * tourne dans Node (tests) et le navigateur. Les fruits sont des objets
 * simples ; le client graphique s'y accroche via le champ libre `spr`.
 *
 * Conventions héritées de l'original :
 *  - grille fruits[x][y], y=0 en HAUT ; les lignes montent par le bas ;
 *  - `t` = couleur visible (-1 si armure intacte), `save_t` = vraie couleur ;
 *  - `armure` (has_armure AS2) = optimisation : l'armure bloque les combos ;
 *  - rng(n) = `random(n)` AS2 : entier dans [0, n-1].
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.SwapouEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ── Constantes de règles (Data.as) ───────────────────────────────────────
  const FLAG_ARMURE = 1;
  const FLAG_NOSWAP = 2;
  const FLAG_STAR = 4;
  const FLAG_SET_COLOR = 8;

  const CHALLENGE_LEVEL_WIDTH = 12;
  const CHALLENGE_LEVEL_HEIGHT = 14;
  const CHALLENGE_MAX_COLORS = 3;
  const CHALLENGE_MIN_COMBO = 3;
  const CHALLENGE_STAR_COUNTER = 100;
  const DUEL_MAX_COLORS = 3;
  const DUEL_LEVEL_WIDTH = 7;
  const DUEL_LEVEL_HEIGHT = 14;
  const DUEL_STAR_COUNTER = 30;
  const DUEL_MAX_TIME = [7, 6, 5, 4, 3];
  const DUEL_IA_STAR_COUNTER = [30, 20, 10, 9, 6];
  const CLASSIC_LEVELS = [0, 10, 15, 15, 20, 20, 25, 25, 35, 45, 50, 100, 200, 300, 500, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000];
  const HORIZ_LOCK_TIME = 20; // secondes
  const MAX_POWER = 6;

  const COMBOS = [3, 4, 5, 6, 7, 9, 11, 13, 15, 18, 21];
  const COMBOS_CLASSIC = [3, 5, 7, 9, 11, 13, 15, 17, 19];
  const COMBO_FACTORS = [1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2];

  // Coûts en étoiles + affectation attaque/défense par perso (Data.as)
  const ATTACK_STARS = [3, 1, 3, 3, 2, 3, 3];
  const DEFENSE_STARS = [1, 2, 2, 2, 4, 5, 2];
  const ATTACK_PLAYERS = [1, 2, 0, 3, 5, 4, 6];
  const DEFENSE_PLAYERS = [3, 2, 0, 6, 4, 5, 1];
  const ATTACK_NAMES = [' VERTIGE ', 'GROS NOYAU', 'PETIT PEPIN', ' COLONNADE ', ' TREMBLETERRE ', 'DOUBLE LA MISE', 'COULEE DE METAL'];
  const DEFENSE_NAMES = [' MOISE ', ' GLISSEMENT ', ' COUPURE ', ' EFFONDREMENT ', 'COLORANT E21', ' RAMOLISSEMENT ', 'COMBOS CLASSIQUES'];
  const CHAR_NAMES = ['Dimitri ', 'Natacha ', 'Monsieur Sel', 'Monsieur Poivre', 'Chevalier Moutarde', 'Piment TomTom du Chili', 'Wasabiii '];

  // [min_time, max_time, brain_power] par perso (+ wasabii 2e forme)
  const IA_TIMES = [
    [4, 6.5, 5],
    [5, 7.5, 10],
    [5, 8.5, 5],
    [5, 6, 15],
    [2, 5, 20],
    [0.5, 4, 25],
    [1, 2.5, 20],
    [0, 2, 25],
  ];

  function defaultRng(n) { return Math.floor(Math.random() * n); }

  // ── Formules de score (Data.as) ──────────────────────────────────────────
  function calcScore(comboPieces, comboPhases) {
    return 5 * comboPieces * Math.floor(Math.pow(comboPhases, 0.8));
  }
  function calcScoreClassic(comboPieces, comboPhases, level) {
    let fact = 0;
    while (comboPieces > 0) fact += comboPieces--;
    return (level * fact) * comboPhases;
  }
  // Nombre de parasites envoyés à l'adversaire après une phase de combo.
  // toPlayer = true quand c'est l'IA qui envoie (fruits vers le joueur).
  function sendFruitsCount(toPlayer, nfruits, ncombo, difficulty) {
    const dif = toPlayer ? (difficulty - 2) : (2 - difficulty);
    const n = nfruits - 3 + ncombo;
    const c = COMBO_FACTORS[Math.min(ncombo, COMBO_FACTORS.length - 1)];
    return Math.min(Math.floor(n * c + dif), 8);
  }

  // ── Fruit ────────────────────────────────────────────────────────────────
  let fruitIdGen = 0;
  function Fruit(ftype, flags) {
    this.id = ++fruitIdGen;
    this.spr = null;   // accroche libre pour le client graphique
    this.combo = null;
    this.init(ftype, flags);
  }
  Fruit.prototype.init = function (ftype, flags) {
    this.flags = flags;
    this.save_t = ftype;
    if ((flags & FLAG_ARMURE) !== 0) {
      this.armure = true;
      this.t = -1;
    } else {
      this.armure = false;
      this.t = ftype;
    }
  };
  Fruit.prototype.canSwap = function () {
    return (this.flags & FLAG_NOSWAP) === 0;
  };
  Fruit.prototype.peteArmure = function () {
    this.t = this.save_t;
    this.armure = false;
    this.flags &= (0xFFFF - FLAG_ARMURE);
  };

  // ── Level (Level.as) ─────────────────────────────────────────────────────
  // infos = { width, height, min, gen_fruit_flags(), gen_fruit_color(),
  //           onAttach(f, x, y)   — sprite à créer (y peut être height pour
  //                                 une ligne qui monte, ou y logique),
  //           onMoveUp(f),        — la ligne monte d'un cran
  //           onDestroy(f) }      — fruit retiré sans explosion (pushBottom)
  function Level(infos) {
    this.width = infos.width;
    this.height = infos.height;
    this.min_combo = infos.min;
    this.gen_fruit_flags = infos.gen_fruit_flags;
    this.gen_fruit_color = infos.gen_fruit_color;
    this.onAttach = infos.onAttach || function () {};
    this.onMoveUp = infos.onMoveUp || function () {};
    this.onDestroy = infos.onDestroy || function () {};
    this.fruits = [];
    for (let x = 0; x < this.width; x++) {
      this.fruits[x] = [];
      for (let y = 0; y < this.height; y++) this.fruits[x][y] = null;
    }
  }

  Level.prototype.getWidth = function () { return this.width; };
  Level.prototype.getHeight = function () { return this.height; };
  Level.prototype.getFruits = function () { return this.fruits; };
  Level.prototype.getFruit = function (x, y) {
    const col = this.fruits[x];
    return col ? (col[y] === undefined ? null : col[y]) : null;
  };

  Level.prototype.attach = function (x, y, color, flags) {
    const f = new Fruit(color, flags);
    this.onAttach(f, x, y);
    return f;
  };

  // Nouvelle ligne par le bas. false si le haut est plein (game over imminent).
  Level.prototype.genLine = function () {
    const w = this.width, h = this.height, fruits = this.fruits;
    for (let x = 0; x < w; x++)
      if (fruits[x][0] != null) return false;

    for (let x = 0; x < w; x++)
      for (let y = 1; y < h; y++) {
        const f = fruits[x][y];
        fruits[x][y - 1] = f;
        fruits[x][y] = null;
        if (f != null) this.onMoveUp(f);
      }

    const y = h - 1;
    for (let x = 0; x < w; x++) {
      let color;
      do {
        color = this.gen_fruit_color();
      } while (
        (fruits[x][y - 1] != null && color === fruits[x][y - 1].t) ||
        (x > 0 && fruits[x - 1][y] != null && color === fruits[x - 1][y].t)
      );
      let flags = this.gen_fruit_flags();
      if ((flags & FLAG_SET_COLOR) !== 0) {
        color = flags >> 8;
        flags = 0;
      }
      const f = this.attach(x, y + 1, color, flags);
      fruits[x][y] = f;
      this.onMoveUp(f);
    }
    return true;
  };

  // Paire (fruit + voisin du quadrant le plus proche) sous le point px,py.
  // geo = { px, py, sx, sy } : origine et taille de case côté écran.
  Level.prototype.getPair = function (x, y, geo) {
    const fx = Math.floor((x - geo.px) / geo.sx);
    const fy = Math.floor((y - geo.py) / geo.sy);
    if (fx < 0 || fx >= this.width || fy < 0 || fy >= this.height) return null;
    if (this.fruits[fx][fy] == null) return null;
    x -= fx * geo.sx + geo.px;
    y -= fy * geo.sy + geo.py;
    x /= geo.sx;
    y /= geo.sy;
    let dx = 0, dy = 0;
    if (x > 1 - y) {
      if (x > y) dx = 1; else dy = 1;
    } else {
      if (x > y) dy = -1; else dx = -1;
    }
    const col2 = this.fruits[fx + dx];
    return {
      x: fx, y: fy, dx: dx, dy: dy,
      f1: this.fruits[fx][fy],
      f2: col2 ? (col2[fy + dy] === undefined ? null : col2[fy + dy]) : null,
    };
  };

  Level.prototype.swapPair = function (p) {
    if (p == null) return false;
    const y2 = p.y + p.dy;
    const col1 = this.fruits[p.x];
    const col2 = this.fruits[p.x + p.dx];
    if (!col1 || !col2 || y2 < 0 || y2 >= this.height) return false;
    const f1 = col1[p.y];
    const f2 = col2[y2];
    if (f1 == null || f2 == null || !f1.canSwap() || !f2.canSwap()) return false;
    col1[p.y] = f2;
    col2[y2] = f1;
    return true;
  };

  Level.prototype._calcRec = function (t, x, y, c) {
    c.v++;
    this.fruits[x][y].combo = c;
    let f;
    f = x > 0 ? this.fruits[x - 1][y] : null;
    if (f != null && f.t === t && f.combo == null) this._calcRec(t, x - 1, y, c);
    f = x < this.width - 1 ? this.fruits[x + 1][y] : null;
    if (f != null && f.t === t && f.combo == null) this._calcRec(t, x + 1, y, c);
    f = y > 0 ? this.fruits[x][y - 1] : null;
    if (f != null && f.t === t && f.combo == null) this._calcRec(t, x, y - 1, c);
    f = y < this.height - 1 ? this.fruits[x][y + 1] : null;
    if (f != null && f.t === t && f.combo == null) this._calcRec(t, x, y + 1, c);
  };

  Level.prototype.calcMinCombos = function (n) {
    const old = this.min_combo;
    this.min_combo = n;
    const combos = this.calc();
    this.min_combo = old;
    return combos;
  };

  Level.prototype.calc = function () {
    const combos = [];
    for (let x = 0; x < this.width; x++) {
      const a = this.fruits[x];
      for (let y = 0; y < this.height; y++)
        if (a[y] != null) a[y].combo = null;
    }
    for (let x = 0; x < this.width; x++)
      for (let y = 0; y < this.height; y++) {
        const f = this.fruits[x][y];
        if (f != null && f.combo == null) {
          const c = { v: 0, x: x, y: y };
          if (!f.armure) {
            this._calcRec(f.t, x, y, c);
            if (c.v >= this.min_combo) combos.push(c);
          } else {
            c.v++;
            f.combo = c;
          }
        }
      }
    if (combos.length === 0) return null;
    return combos;
  };

  Level.prototype._explodeRec = function (l, l2, c, x, y) {
    let f = this.fruits[x][y];
    f.combo = null;
    l.push(f);
    this.fruits[x][y] = null;

    f = x > 0 ? this.fruits[x - 1][y] : null;
    if (f != null) {
      if (f.combo === c) this._explodeRec(l, l2, c, x - 1, y);
      else if (f.armure) { f.armure = false; l2.push(f); }
    }
    f = x < this.width - 1 ? this.fruits[x + 1][y] : null;
    if (f != null) {
      if (f.combo === c) this._explodeRec(l, l2, c, x + 1, y);
      else if (f.armure) { f.armure = false; l2.push(f); }
    }
    f = y > 0 ? this.fruits[x][y - 1] : null;
    if (f != null) {
      if (f.combo === c) this._explodeRec(l, l2, c, x, y - 1);
      else if (f.armure) { f.armure = false; l2.push(f); }
    }
    f = y < this.height - 1 ? this.fruits[x][y + 1] : null;
    if (f != null) {
      if (f.combo === c) this._explodeRec(l, l2, c, x, y + 1);
      else if (f.armure) { f.armure = false; l2.push(f); }
    }
  };

  Level.prototype.explode = function (combos) {
    const l = [], l2 = [];
    for (let i = 0; i < combos.length; i++) {
      const c = combos[i];
      this._explodeRec(l, l2, c, c.x, c.y);
    }
    if (l.length === 0) return null;
    return { mcs: l, combos: combos, pete_armures: l2 };
  };

  // Fruit parasite ajouté au sommet de la colonne x. null si colonne pleine.
  Level.prototype.addFruit = function (x, color, flags) {
    let y;
    for (y = 0; y < this.height; y++)
      if (this.fruits[x][y] != null) break;
    if (y === 0) return null;
    y--;
    const f = this.attach(x, y, color, flags);
    this.fruits[x][y] = f;
    return f;
  };

  // ── Simulation pour l'IA (calcStart / calcNext / calcEnd) ────────────────
  Level.prototype.calcStart = function () {
    const tmp = this.calc();
    if (tmp == null) return null;
    const save = [];
    for (let x = 0; x < this.width; x++) {
      const a = this.fruits[x];
      const sx = [];
      save[x] = sx;
      for (let y = 0; y < this.height; y++) sx[y] = a[y];
    }
    return { tmp: tmp, save: save, combos: [] };
  };

  Level.prototype.calcEnd = function (data) {
    this.fruits = data.save;
    for (let x = 0; x < this.width; x++) {
      const a = this.fruits[x];
      for (let y = 0; y < this.height; y++) {
        const f = a[y];
        if (f == null) continue;
        f.armure = (f.flags & FLAG_ARMURE) !== 0;
        if (f.armure) f.t = -1;
      }
    }
    return data.combos;
  };

  Level.prototype.calcNext = function (data) {
    if (data.tmp != null) {
      const c = this.explode(data.tmp);
      data.combos.push(c.combos);
      this.gravity();
      data.tmp = this.calc();
      if (data.tmp != null) return null;
    }
    return this.calcEnd(data);
  };

  // Écart-type des hauteurs « libres » (heuristique IA, Level.as:calcAvgHigh)
  Level.prototype.calcAvgHigh = function () {
    const highs = [];
    let moy = 0;
    for (let x = 0; x < this.width; x++) {
      let h = 0;
      for (let y = this.height - 1; y >= 0; y--) {
        const f = this.fruits[x][y];
        if (f == null) break;
        if (f.combo != null && f.combo.v < this.min_combo) h++;
      }
      highs[x] = h;
      moy += h;
    }
    moy /= this.width;
    let ecart = 0;
    for (let x = 0; x < this.width; x++) {
      const d = highs[x] - moy;
      ecart += d * d;
    }
    return Math.sqrt(ecart + moy);
  };

  Level.prototype.gravity = function () {
    const l = [];
    for (let x = 0; x < this.width; x++) {
      const fx = this.fruits[x];
      let y = this.height - 1;
      let delta_y = 0;
      while (true) {
        while (y >= 0 && fx[y] == null) { y--; delta_y++; }
        if (y < 0) break;
        if (delta_y > 0) {
          let f;
          while (y >= 0 && (f = fx[y]) != null) {
            fx[y + delta_y] = f;
            fx[y] = null;
            l.push({ f: f, delta: delta_y });
            y--;
          }
        } else {
          while (y >= 0 && fx[y] != null) y--;
        }
      }
    }
    if (l.length === 0) return null;
    return l;
  };

  Level.prototype.popBottomFruit = function (x) {
    const f = this.fruits[x][this.height - 1];
    let y = this.height - 2;
    while (y >= 0 && this.fruits[x][y] != null) {
      this.fruits[x][y + 1] = this.fruits[x][y];
      y--;
    }
    this.fruits[x][y + 1] = null;
    return f;
  };

  Level.prototype.pushBottomFruit = function (x, f) {
    if (this.fruits[x][0] != null) this.onDestroy(this.fruits[x][0]);
    for (let y = 1; y < this.height; y++)
      this.fruits[x][y - 1] = this.fruits[x][y];
    if (f == null) {
      let color = this.gen_fruit_color();
      let flags = this.gen_fruit_flags();
      if ((flags & FLAG_SET_COLOR) !== 0) {
        color = flags >> 8;
        flags = 0;
      }
      f = this.attach(x, this.height - 1, color, flags);
    }
    this.fruits[x][this.height - 1] = f;
    return f;
  };

  // Hauteur occupée de chaque colonne (utilitaire commun attaques/défenses)
  Level.prototype.columnHighs = function () {
    const highs = [];
    for (let x = 0; x < this.width; x++) {
      let y;
      for (y = 0; y < this.height; y++)
        if (this.fruits[x][y] != null) break;
      highs.push(this.height - y);
    }
    return highs;
  };

  function sortByH(a, b) { return a.h - b.h; }

  // ── Attaques sur plateau (Player.as:attacked, cas 4 et 6) ────────────────
  // TREMBLEMENT DE TERRE : déplace le fruit du bas des colonnes basses vers
  // le bas des colonnes hautes (amplifie les reliefs).
  function attackEarthquake(level) {
    const highs = level.columnHighs();
    const cols = [];
    for (let x = 0; x < level.width; x++) {
      const hh = highs[x];
      if (hh > 0) cols.push({ x: x, h: hh });
    }
    cols.sort(sortByH);
    const rems = [], adds = [];
    const dw = Math.floor(cols.length / 2);
    for (let x = 0; x < dw; x++) {
      const c1 = cols[x];
      const c2 = cols[cols.length - 1 - x];
      const f = level.popBottomFruit(c1.x);
      const f2 = level.pushBottomFruit(c2.x, null);
      f2.init(f.save_t, f.flags);
      rems[c1.x] = f;
      adds[c2.x] = f2;
    }
    return { rems: rems, adds: adds };
  }

  // COULEE D'ACIER : les 2 premiers fruits de chaque colonne → métal (NOSWAP)
  function attackCouleeMetal(level) {
    const highs = level.columnHighs();
    const acier = [];
    for (let x = 0; x < level.width; x++) {
      const sy = level.height - highs[x];
      for (let y = 0; y < 2; y++) {
        const f = sy + y < level.height ? level.fruits[x][sy + y] : null;
        if (f != null) {
          f.armure = false;
          f.flags = FLAG_NOSWAP;
          f.t = f.save_t;
          acier.push(f);
        }
      }
    }
    return { acier: acier };
  }

  // COLONNADE : choix de la colonne cible (4 fruits gelés y seront envoyés)
  function pickColonnadeColumn(level, rng) {
    let x, n = 0;
    while (true) {
      x = rng(level.width);
      n++;
      if (n >= 100 || level.fruits[x][3] == null) break;
    }
    return x;
  }

  // ── Défenses (Player.as:defend, cas 0..6) ────────────────────────────────
  function defenseEcarteur(level) {
    const w = level.width, h = level.height, fruits = level.fruits;
    const mc1 = [], mc2 = [];
    const dw = Math.floor(w / 2);
    for (let y = 0; y < h; y++) {
      mc1.push(fruits[0][y]);
      mc2.push(fruits[w - 1][y]);
      for (let x = 1; x < dw; x++)
        fruits[x - 1][y] = fruits[x][y];
      fruits[dw - 1][y] = null;
      for (let x = w - 2; x >= dw; x--)
        fruits[x + 1][y] = fruits[x][y];
      fruits[dw][y] = null;
    }
    return { id: 0, mc1: mc1, mc2: mc2 };
  }

  function defenseEgaliseur(level) {
    const w = level.width;
    const highs = level.columnHighs();
    const cols = [];
    for (let x = 0; x < w; x++) cols.push({ x: x, h: highs[x] });
    cols.sort(sortByH);
    const rems = [], adds = [];
    const dw = Math.floor(w / 2);
    for (let x = 0; x < dw; x++) {
      const c1 = cols[x];
      const c2 = cols[w - 1 - x];
      if (c1.h >= c2.h) break;
      const f = level.popBottomFruit(c2.x);
      const f2 = level.pushBottomFruit(c1.x, null);
      f2.init(f.save_t, f.flags);
      rems[c2.x] = f;
      adds[c1.x] = f2;
    }
    return { id: 1, rems: rems, adds: adds };
  }

  function defenseCoupeur(level) {
    const w = level.width, h = level.height, fruits = level.fruits;
    const highs = level.columnHighs();
    let max_h = 0;
    for (let x = 0; x < w; x++)
      if (highs[x] > max_h) max_h = highs[x];
    max_h -= 2;
    const cuts = [];
    for (let x = 0; x < w; x++) {
      let hx = highs[x];
      while (hx > max_h) {
        cuts.push(fruits[x][h - hx]);
        fruits[x][h - hx] = null;
        hx--;
      }
    }
    return { id: 2, cuts: cuts };
  }

  function defensePete1Ligne(level) {
    const w = level.width, h = level.height, fruits = level.fruits;
    const cuts = [];
    for (let x = 0; x < w; x++) {
      const f = fruits[x][h - 1];
      if (f != null) {
        cuts.push(f);
        fruits[x][h - 1] = null;
      }
    }
    return { id: 3, cuts: cuts };
  }

  function defenseConvertisseur(level, genColor) {
    const w = level.width, h = level.height, fruits = level.fruits;
    const converts = [];
    const src = genColor();
    let dst;
    do { dst = genColor(); } while (src === dst);
    for (let x = 0; x < w; x++)
      for (let y = 0; y < h; y++) {
        const f = fruits[x][y];
        if (f != null && f.save_t === src) {
          f.save_t = dst;
          f.flags = FLAG_ARMURE;
          f.armure = true;
          f.t = -1;
          converts.push(f);
        }
      }
    return { id: 4, converts: converts, src: src, dst: dst };
  }

  function defensePeteArmures(level) {
    const w = level.width, h = level.height, fruits = level.fruits;
    const mcs = [];
    for (let x = 0; x < w; x++)
      for (let y = 0; y < h; y++) {
        const f = fruits[x][y];
        if (f != null && (f.flags & FLAG_ARMURE) !== 0) {
          f.armure = false;
          f.flags &= (0xFFFF - FLAG_ARMURE);
          f.t = f.save_t;
          mcs.push(f);
        }
      }
    return { id: 5, mcs: mcs };
  }

  function defenseCombos2(level) {
    const combos = level.calcMinCombos(2);
    let expl = { mcs: [], pete_armures: [] };
    if (combos != null) expl = level.explode(combos) || expl;
    return { id: 6, mcs: expl.mcs, arms: expl.pete_armures };
  }

  // ── IA (IA.as) ───────────────────────────────────────────────────────────
  function IA(level, rng) {
    this.level = level;
    this.rng = rng || defaultRng;
    this.combos = null;
    this.width = level.getWidth();
    this.height = level.getHeight();
    this.cur_swap = null;
    this.swaps = null;
    this.swap_pos = 0;
  }

  IA.prototype.processStart = function (hlock) {
    this.combos = [];
    this.swaps = [];
    for (let x = 0; x < this.width; x++)
      for (let y = 0; y < this.height; y++) {
        if (!hlock && x < this.width - 1) {
          const f1 = this.level.getFruit(x, y);
          const f2 = this.level.getFruit(x + 1, y);
          if (f1 != null && f2 != null && f1.canSwap() && f2.canSwap())
            this.swaps.push({ x: x, y: y, dx: 1, dy: 0, f1: f1, f2: f2 });
        }
        if (y < this.height - 1) {
          const f1 = this.level.getFruit(x, y);
          const f2 = this.level.getFruit(x, y + 1);
          if (f1 != null && f2 != null && f1.canSwap() && f2.canSwap())
            this.swaps.push({ x: x, y: y, dx: 0, dy: 1, f1: f1, f2: f2 });
        }
      }
    // Array.shuffle() de la stdlib Motion-Twin → Fisher-Yates
    for (let i = this.swaps.length - 1; i > 0; i--) {
      const j = this.rng(i + 1);
      const tmp = this.swaps[i];
      this.swaps[i] = this.swaps[j];
      this.swaps[j] = tmp;
    }
    this.swap_pos = this.swaps.length - 1;
  };

  function sortByScore(c1, c2) { return c1.score - c2.score; }

  IA.prototype._makeCombo = function (p, c) {
    let n = 0;
    for (let i = 0; i < c.length; i++) {
      const ci = c[i];
      for (let j = 0; j < ci.length; j++) n += ci[j].v;
    }
    const h = this.level.calcAvgHigh();
    const score = -h + n / 5;
    return { p: p, c: c, h: h, n: n, score: score, combos: c };
  };

  IA.prototype.process = function (n) {
    if (this.cur_swap != null) {
      const c = this.level.calcNext(this.cur_swap.data);
      if (c != null) {
        const p = this.cur_swap.p;
        this.cur_swap = null;
        this.combos.push(this._makeCombo(p, c));
        this.level.swapPair(p);
      }
      return null;
    }

    if (this.swap_pos < 0) return this.chooseCombo();

    const p = this.swaps[this.swap_pos--];
    if (this.level.swapPair(p)) {
      const data = this.level.calcStart();
      if (data != null) this.cur_swap = { data: data, p: p };
      else this.level.swapPair(p);
    } else if (n === 0) return null;
    else return this.process(n - 1);

    return null;
  };

  IA.prototype.chooseCombo = function () {
    if (this.combos.length === 0) { // rien trouvé !
      let i = 0;
      while (i < this.swaps.length && !this.level.swapPair(this.swaps[i])) i++;
      if (i >= this.swaps.length) return this.swaps[0] || null;
      this.level.swapPair(this.swaps[i]);
      return this.swaps[i];
    }
    this.combos.sort(sortByScore);
    const c = this.combos[this.combos.length - 1];
    return c.p;
  };

  IA.prototype.processEnd = function () {
    if (this.cur_swap != null) {
      this.level.calcEnd(this.cur_swap.data);
      this.level.swapPair(this.cur_swap.p);
      this.cur_swap = null;
    }
    return this.chooseCombo();
  };

  return {
    FLAG_ARMURE, FLAG_NOSWAP, FLAG_STAR, FLAG_SET_COLOR,
    CHALLENGE_LEVEL_WIDTH, CHALLENGE_LEVEL_HEIGHT, CHALLENGE_MAX_COLORS,
    CHALLENGE_MIN_COMBO, CHALLENGE_STAR_COUNTER,
    DUEL_MAX_COLORS, DUEL_LEVEL_WIDTH, DUEL_LEVEL_HEIGHT, DUEL_STAR_COUNTER,
    DUEL_MAX_TIME, DUEL_IA_STAR_COUNTER, CLASSIC_LEVELS,
    HORIZ_LOCK_TIME, MAX_POWER,
    COMBOS, COMBOS_CLASSIC, COMBO_FACTORS,
    ATTACK_STARS, DEFENSE_STARS, ATTACK_PLAYERS, DEFENSE_PLAYERS,
    ATTACK_NAMES, DEFENSE_NAMES, CHAR_NAMES, IA_TIMES,
    defaultRng, calcScore, calcScoreClassic, sendFruitsCount,
    Fruit, Level, IA,
    attackEarthquake, attackCouleeMetal, pickColonnadeColumn,
    defenseEcarteur, defenseEgaliseur, defenseCoupeur, defensePete1Ligne,
    defenseConvertisseur, defensePeteArmures, defenseCombos2,
  };
});
