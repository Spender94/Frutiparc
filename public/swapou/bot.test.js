// Tests du bot Swapou — node public/swapou/bot.test.js
// 1) ÉQUIVALENCE : resolve() du bot doit reproduire exactement la résolution
//    du moteur (calc/explode/peteArmure/gravity + calcScore) sur des grilles
//    aléatoires.
// 2) Décisions : prend un combo évident, défend en situation critique.
'use strict';
const E = require('./engine.js');
const B = require('./bot.js');

let nassert = 0;
function assert(cond, msg) {
  nassert++;
  if (!cond) {
    console.error('FAIL: ' + msg);
    process.exit(1);
  }
}

// LCG déterministe
function lcg(seed) {
  let s = seed >>> 0;
  return function (n) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s % n;
  };
}

const W = 12, H = 14;

// grille aléatoire contiguë en bas (invariant du jeu)
function randomCells(rng, density) {
  const cells = [];
  for (let x = 0; x < W; x++) {
    const col = [];
    const h = rng(Math.max(2, Math.round(H * density)));
    for (let i = 0; i < h; i++) {
      const roll = rng(100);
      let flags = 0;
      if (roll < 18) flags = E.FLAG_ARMURE;
      else if (roll < 26) flags = E.FLAG_NOSWAP;
      else if (roll < 30) flags = E.FLAG_STAR;
      col.push({ color: rng(3), flags: flags });
    }
    cells.push(col);
  }
  return cells;
}

function makeEngineLevel(cells) {
  const lvl = new E.Level({
    width: W, height: H, min: 3,
    gen_fruit_flags: function () { return 0; },
    gen_fruit_color: function () { return 0; },
  });
  for (let x = 0; x < W; x++)
    for (let i = 0; i < cells[x].length; i++)
      lvl.fruits[x][H - 1 - i] = new E.Fruit(cells[x][i].color, cells[x][i].flags);
  return lvl;
}
function makeBotGrid(cells) {
  const g = [];
  for (let x = 0; x < W; x++) {
    g[x] = new Array(H).fill(null);
    for (let i = 0; i < cells[x].length; i++) {
      const c = cells[x][i];
      const f = new E.Fruit(c.color, c.flags);
      g[x][H - 1 - i] = { t: f.t, s: f.save_t, fl: f.flags };
    }
  }
  return g;
}

// résolution de référence : le chemin réel du client distillé
// (Player.swapDone → Level.calc/explode → peteArmure → gravity, en boucle)
function refResolve(lvl) {
  let phase = 0, score = 0, stars = 0, cracked = 0;
  while (true) {
    const combos = lvl.calc();
    if (combos == null) break;
    phase++;
    const x = lvl.explode(combos);
    let pieces = 0;
    for (let i = 0; i < x.combos.length; i++) pieces += x.combos[i].v;
    for (let i = 0; i < x.mcs.length; i++)
      if ((x.mcs[i].flags & E.FLAG_STAR) !== 0) stars++;
    for (let i = 0; i < x.pete_armures.length; i++) {
      x.pete_armures[i].peteArmure();
      cracked++;
    }
    score += E.calcScore(pieces, phase);
    lvl.gravity();
  }
  return { score: score, stars: stars, cracked: cracked };
}

function sameState(lvl, g, label) {
  for (let x = 0; x < W; x++)
    for (let y = 0; y < H; y++) {
      const f = lvl.fruits[x][y];
      const c = g[x][y];
      if ((f == null) !== (c == null)) {
        assert(false, label + ' présence différente en ' + x + ',' + y);
      }
      if (f == null) continue;
      assert(f.t === c.t, label + ' t différent en ' + x + ',' + y + ' (' + f.t + ' vs ' + c.t + ')');
      assert(f.save_t === c.s, label + ' save_t différent en ' + x + ',' + y);
      assert(f.flags === c.fl, label + ' flags différents en ' + x + ',' + y);
    }
}

// ── 1) équivalence sur 300 grilles/échanges aléatoires ─────────────────────
{
  let done = 0;
  const rng = lcg(42);
  for (let iter = 0; iter < 300; iter++) {
    const cells = randomCells(rng, 0.35 + (iter % 5) * 0.13);
    const lvl = makeEngineLevel(cells);
    const g = makeBotGrid(cells);
    // échange aléatoire légal (s'il y en a un)
    let pair = null;
    for (let tries = 0; tries < 60 && pair == null; tries++) {
      const x = rng(W), y = rng(H);
      const dirs = [[1, 0], [0, 1]];
      const d = dirs[rng(2)];
      const nx = x + d[0], ny = y + d[1];
      if (nx >= W || ny >= H) continue;
      const f1 = lvl.fruits[x][y], f2 = lvl.fruits[nx][ny];
      if (f1 && f2 && f1.canSwap() && f2.canSwap())
        pair = { x: x, y: y, dx: d[0], dy: d[1] };
    }
    if (pair) {
      lvl.swapPair(pair);
      const tmp = g[pair.x][pair.y];
      g[pair.x][pair.y] = g[pair.x + pair.dx][pair.y + pair.dy];
      g[pair.x + pair.dx][pair.y + pair.dy] = tmp;
    }
    const ref = refResolve(lvl);
    const bot = B.resolve(g, 0);
    assert(ref.score === bot.score, 'itér ' + iter + ' : score ' + bot.score + ' ≠ ref ' + ref.score);
    assert(ref.stars === bot.stars, 'itér ' + iter + ' : étoiles ' + bot.stars + ' ≠ ref ' + ref.stars);
    assert(ref.cracked === bot.cracked, 'itér ' + iter + ' : armures ' + bot.cracked + ' ≠ ref ' + ref.cracked);
    sameState(lvl, g, 'itér ' + iter + ' :');
    done++;
  }
  assert(done === 300, '300 équivalences vérifiées');
}

// ── 2) décisions ────────────────────────────────────────────────────────────
function levelFromRows(rows) {
  const lvl = new E.Level({
    width: W, height: H, min: 3,
    gen_fruit_flags: function () { return 0; },
    gen_fruit_color: function () { return 0; },
  });
  const off = H - rows.length;
  for (let ry = 0; ry < rows.length; ry++)
    for (let x = 0; x < W; x++) {
      const ch = rows[ry][x];
      if (ch === '.') continue;
      let color = 0, flags = 0;
      if (ch >= '0' && ch <= '9') color = +ch;
      else if (ch === 'A') flags = E.FLAG_ARMURE;
      else if (ch === 'M') flags = E.FLAG_NOSWAP;
      else if (ch === 'S') flags = E.FLAG_STAR;
      lvl.fruits[x][off + ry] = new E.Fruit(color, flags);
    }
  return lvl;
}

{
  // pile haute (h=10) en damier sans combo : couleur (x+2y)%3 — voisins
  // toujours différents. On plante un trio réalisable au sommet :
  // (0,4)=(1,4)=A et A en (3,4) → l'échange (2,4)↔(3,4) aligne A,A,A.
  // Nettoyer en hauteur fait clairement baisser le danger : le bot doit
  // choisir un coup qui marque.
  const lvl = new E.Level({
    width: W, height: H, min: 3,
    gen_fruit_flags: function () { return 0; },
    gen_fruit_color: function () { return 0; },
  });
  for (let x = 0; x < W; x++)
    for (let y = 4; y < H; y++)
      lvl.fruits[x][y] = new E.Fruit((x + 2 * y) % 3, 0);
  const A = (0 + 2 * 4) % 3; // couleur du damier en (0,4) — on aligne dessus
  lvl.fruits[1][4] = new E.Fruit(A, 0);
  lvl.fruits[3][4] = new E.Fruit(A, 0);
  const mv = B.choose(lvl, { charId: 0, canDefend: false, stars: 0 });
  assert(mv.type === 'swap', 'le bot joue un échange');
  assert(mv.gained && mv.gained.score > 0, 'le bot choisit un coup qui marque (score ' + (mv.gained && mv.gained.score) + ')');
}

{
  // situation critique : colonnes à 13 (une montée = mort), une étoile en
  // réserve → Dimitri doit défendre (EFFONDREMENT). Le 3-coloriage (x+2y)%3
  // garantit qu'AUCUN échange ne crée de combo (les voisins diffèrent
  // toujours ; un échange ne forme que des paires) : pas d'échappatoire.
  const lvl = new E.Level({
    width: W, height: H, min: 3,
    gen_fruit_flags: function () { return 0; },
    gen_fruit_color: function () { return 0; },
  });
  for (let x = 0; x < W; x++)
    for (let y = 1; y < H; y++)
      lvl.fruits[x][y] = new E.Fruit((x + 2 * y) % 3, 0);
  const mv = B.choose(lvl, { charId: 0, canDefend: true, stars: 1 });
  assert(mv.type === 'defend', 'au bord du plafond, le bot défend (choix : ' + mv.type + ')');
}

{
  // pas de coup légal du tout (que du métal) → 'none'
  const lvl = levelFromRows(['MMMMMMMMMMMM']);
  const mv = B.choose(lvl, { charId: 1, canDefend: false, stars: 0 });
  assert(mv.type === 'none', 'aucun coup → none');
}

// noMoreLine
{
  const g = [];
  for (let x = 0; x < W; x++) g.push(new Array(H).fill(null));
  g[0][H - 1] = { t: 0, s: 0, fl: 0 };
  g[2][H - 1] = { t: 0, s: 0, fl: 0 };
  assert(B.noMoreLine(g) === true, 'pas deux adjacents → noMoreLine');
  g[1][H - 1] = { t: 1, s: 1, fl: 0 };
  assert(B.noMoreLine(g) === false, 'deux adjacents → ligne montera');
}


// ── 3) les trois défenses ajoutées, en équivalence avec le moteur ──────────
// Moïse (Sel), Glissement (Wasabi) et Colorant E21 (Moutarde) n'étaient pas
// simulées : l'analyseur ne les proposait jamais. On rejoue chacune sur des
// grilles aléatoires par le MOTEUR (Player.defend → swapDone) et par le
// simulateur, et l'on exige la même grille, le même score, les mêmes étoiles.
{
  const rng = lcg(7);
  let n = 0;
  for (let iter = 0; iter < 120; iter++) {
    const cells = randomCells(rng, 0.3 + (iter % 6) * 0.11);
    // MOÏSE : les deux moitiés s'écartent, les colonnes 0 et 11 tombent.
    {
      const lvl = makeEngineLevel(cells);
      E.defenseEcarteur(lvl);
      const ref = refResolve(lvl);
      const sim = B.simulateDefense(makeBotGrid(cells), 0);
      assert(sim.score === ref.score && sim.stars === ref.stars && sim.cracked === ref.cracked,
        'Moïse itér ' + iter + ' : ' + JSON.stringify([sim.score, sim.stars, sim.cracked])
        + ' ≠ ' + JSON.stringify([ref.score, ref.stars, ref.cracked]));
      sameState(lvl, sim.grid, 'Moïse itér ' + iter + ' :');
      assert(sim.grid[5].every(function (c) { return c == null; })
        && sim.grid[6].every(function (c) { return c == null; }) || ref.score > 0,
        'Moïse itér ' + iter + ' : les deux colonnes du milieu sont vides');
    }
    // GLISSEMENT : les colonnes hautes donnent leur fruit du bas aux basses.
    {
      const lvl = makeEngineLevel(cells);
      const avant = lvl.columnHighs().reduce(function (a, b) { return a + b; }, 0);
      E.defenseEgaliseur(lvl);
      const apres = lvl.columnHighs().reduce(function (a, b) { return a + b; }, 0);
      assert(avant === apres, 'Glissement itér ' + iter + ' : rien n’est détruit');
      const ref = refResolve(lvl);
      const sim = B.simulateDefense(makeBotGrid(cells), 1);
      assert(sim.score === ref.score && sim.stars === ref.stars && sim.cracked === ref.cracked,
        'Glissement itér ' + iter + ' : ' + JSON.stringify([sim.score, sim.stars, sim.cracked])
        + ' ≠ ' + JSON.stringify([ref.score, ref.stars, ref.cracked]));
      sameState(lvl, sim.grid, 'Glissement itér ' + iter + ' :');
    }
    // COLORANT : chacun des six tirages (src, dst), imposés au moteur.
    {
      const sim = B.simulateDefense(makeBotGrid(cells), 4);
      assert(sim.variantes && sim.variantes.length === 6, 'Colorant : six tirages');
      let k = 0;
      for (let src = 0; src < 3; src++)
        for (let dst = 0; dst < 3; dst++) {
          if (dst === src) continue;
          const lvl = makeEngineLevel(cells);
          const seq = [src, dst];
          let i = 0;
          E.defenseConvertisseur(lvl, function () { return seq[i++]; });
          const ref = refResolve(lvl);
          const v = sim.variantes[k++];
          assert(v.score === ref.score && v.stars === ref.stars && v.cracked === ref.cracked,
            'Colorant ' + src + '→' + dst + ' itér ' + iter + ' : score/étoiles/armures');
          sameState(lvl, v.grid, 'Colorant ' + src + '→' + dst + ' itér ' + iter + ' :');
        }
    }
    n++;
  }
  assert(n === 120, '120 grilles, trois défenses, en équivalence');
}

// ── 4) le prix de l'étoile suit le moment ──────────────────────────────────
{
  const P = B.prixDefense;
  // Dimitri, une étoile : cher quand le plateau est bas, gratuit en crise.
  assert(P({ charId: 0, stars: 3 }, 12) === 0, 'en crise, l’étoile ne coûte rien');
  assert(P({ charId: 0, stars: 6 }, 5) === 0, 'au plafond, la suivante serait perdue : rien à payer');
  assert(P({ charId: 0, stars: 3 }, 6) > P({ charId: 0, stars: 3 }, 10),
    'plus le plateau est bas, plus l’étoile est chère');
  assert(P({ charId: 0, stars: 3 }, 10) > P({ charId: 0, stars: 3 }, 11),
    'et le prix baisse encore à l’approche du plafond');
  // La réserve : lâcher sa DERNIÈRE défense hors crise coûte le surcoût.
  assert(P({ charId: 1, stars: 2 }, 8) - P({ charId: 1, stars: 4 }, 8) === B.WEIGHTS.reserve,
    'Natacha à deux étoiles paie la réserve, à quatre non');
  assert(P({ charId: 1, stars: 2 }, 11) === P({ charId: 1, stars: 4 }, 11),
    'à hauteur 11, plus de réserve : on tire');
}

console.log('OK — ' + nassert + ' assertions (bot)');
