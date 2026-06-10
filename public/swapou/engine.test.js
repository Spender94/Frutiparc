// Tests du moteur Swapou 2 — `node public/swapou/engine.test.js`
'use strict';
const E = require('./engine.js');

let nassert = 0;
function assert(cond, msg) {
  nassert++;
  if (!cond) {
    console.error('FAIL: ' + msg);
    process.exit(1);
  }
}
function eq(a, b, msg) {
  assert(a === b, msg + ' (attendu ' + JSON.stringify(b) + ', obtenu ' + JSON.stringify(a) + ')');
}

// rng déterministe : consomme une liste, puis 0
function seqRng(vals) {
  let i = 0;
  return function (n) {
    const v = i < vals.length ? vals[i++] : 0;
    return v % n;
  };
}

// Construit un Level depuis des lignes ASCII (y=0 en haut) :
//   '.' = vide, '0'..'9' = couleur, 'A' = armure couleur 0, 'B' = armure
//   couleur 1, 'M' = métal couleur 0, 'S' = étoile couleur 0.
function makeLevel(rows, min, genColor) {
  const h = rows.length, w = rows[0].length;
  let nextColor = 0;
  const lvl = new E.Level({
    width: w, height: h, min: min || 3,
    gen_fruit_flags: function () { return 0; },
    gen_fruit_color: genColor || function () { return (nextColor++) % 3; },
  });
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const ch = rows[y][x];
      if (ch === '.') continue;
      let color = 0, flags = 0;
      if (ch >= '0' && ch <= '9') color = ch.charCodeAt(0) - 48;
      else if (ch === 'A') { color = 0; flags = E.FLAG_ARMURE; }
      else if (ch === 'B') { color = 1; flags = E.FLAG_ARMURE; }
      else if (ch === 'M') { color = 0; flags = E.FLAG_NOSWAP; }
      else if (ch === 'S') { color = 0; flags = E.FLAG_STAR; }
      lvl.fruits[x][y] = new E.Fruit(color, flags);
    }
  return lvl;
}
function dumpCol(lvl, x) {
  let s = '';
  for (let y = 0; y < lvl.height; y++) {
    const f = lvl.fruits[x][y];
    s += f == null ? '.' : String(f.save_t);
  }
  return s;
}

// ── Fruit ──────────────────────────────────────────────────────────────────
{
  const f = new E.Fruit(2, E.FLAG_ARMURE);
  eq(f.t, -1, 'armure : couleur masquée');
  eq(f.save_t, 2, 'armure : vraie couleur');
  assert(f.armure, 'armure posée');
  assert(f.canSwap(), 'armure échangeable');
  f.peteArmure();
  eq(f.t, 2, 'peteArmure : couleur révélée');
  eq(f.flags & E.FLAG_ARMURE, 0, 'peteArmure : flag retiré');
  const m = new E.Fruit(1, E.FLAG_NOSWAP);
  assert(!m.canSwap(), 'métal inéchangeable');
  eq(m.t, 1, 'métal : couleur visible');
}

// ── calc : combos en croix, min_combo, armures ─────────────────────────────
{
  const lvl = makeLevel([
    '.....',
    '.000.',
    '..1..',
    '..1..',
  ]);
  const combos = lvl.calc();
  eq(combos.length, 1, 'un seul combo ≥ 3');
  eq(combos[0].v, 3, 'trois pommes');
  // le groupe de 2 « 1 » n'explose pas avec min 3
  const lvl2 = makeLevel(['00', '11'], 2);
  const c2 = lvl2.calc();
  eq(c2.length, 2, 'min 2 : les paires comptent (mode classique)');
}
{
  // l'armure (couleur cachée t=-1) ne se connecte pas au groupe
  const lvl = makeLevel(['0A0', '...']);
  eq(lvl.calc(), null, 'armure coupe le combo');
}

// ── explode : retire le combo et fend les armures adjacentes ───────────────
{
  const lvl = makeLevel([
    'A000B',
    '.....',
  ]);
  const combos = lvl.calc();
  const x = lvl.explode(combos);
  eq(x.mcs.length, 3, 'trois fruits explosés');
  eq(x.pete_armures.length, 2, 'deux armures fendues');
  assert(!x.pete_armures[0].armure, 'armure désactivée (flag conservé pour le client)');
  eq(lvl.fruits[1][0], null, 'cases vidées');
  assert(lvl.fruits[0][0] != null, "l'armure reste en place");
}

// ── gravity ────────────────────────────────────────────────────────────────
{
  const lvl = makeLevel([
    '1.',
    '..',
    '2.',
    '..',
  ]);
  const l = lvl.gravity();
  eq(l.length, 2, 'deux fruits tombent');
  eq(dumpCol(lvl, 0), '..12', 'pile reconstituée en bas');
  eq(lvl.gravity(), null, 'plus rien à faire tomber');
}

// ── genLine ────────────────────────────────────────────────────────────────
{
  let moved = 0;
  const rngColors = seqRng([0, 0, 1, 0, 1, 2, 0, 1, 2]);
  const lvl = new E.Level({
    width: 3, height: 3, min: 3,
    gen_fruit_flags: function () { return 0; },
    gen_fruit_color: function () { return rngColors(3); },
    onMoveUp: function () { moved++; },
  });
  lvl.fruits[0][2] = new E.Fruit(0, 0);
  assert(lvl.genLine(), 'la ligne monte');
  assert(lvl.fruits[0][1] != null, 'ancienne ligne remontée');
  // pas de couleur identique au voisin de gauche ni au fruit du dessus
  const t0 = lvl.fruits[0][2].t, t1 = lvl.fruits[1][2].t, t2 = lvl.fruits[2][2].t;
  assert(t0 !== lvl.fruits[0][1].t, 'pas de combo vertical immédiat');
  assert(t1 !== t0 && t2 !== t1, 'pas de combo horizontal immédiat');
  eq(moved, 4, 'moveUp pour l\'existant + les 3 nouveaux');
  // haut plein → false
  const lvl2 = makeLevel(['0', '1']);
  assert(!lvl2.genLine(), 'colonne pleine : genLine refuse');
}
{
  // FLAG_SET_COLOR force la couleur (flags >> 8)
  const lvl = new E.Level({
    width: 1, height: 2, min: 3,
    gen_fruit_flags: function () { return E.FLAG_SET_COLOR | (7 << 8); },
    gen_fruit_color: function () { return 0; },
  });
  lvl.genLine();
  eq(lvl.fruits[0][1].t, 7, 'SET_COLOR appliqué');
  eq(lvl.fruits[0][1].flags, 0, 'flags remis à zéro');
}

// ── getPair : quadrants ────────────────────────────────────────────────────
{
  const lvl = makeLevel([
    '012',
    '345',
    '678',
  ]);
  const geo = { px: 0, py: 0, sx: 10, sy: 10 };
  // centre de la case (1,1), un poil à droite → dx=1
  let p = lvl.getPair(18, 15, geo);
  eq(p.x, 1, 'case x'); eq(p.y, 1, 'case y');
  eq(p.dx, 1, 'quadrant droite'); eq(p.dy, 0, 'quadrant droite dy');
  eq(p.f2.t, 5, 'voisin droite');
  p = lvl.getPair(12, 15, geo);
  eq(p.dx, -1, 'quadrant gauche');
  p = lvl.getPair(15, 18, geo);
  eq(p.dy, 1, 'quadrant bas');
  p = lvl.getPair(15, 12, geo);
  eq(p.dy, -1, 'quadrant haut');
  eq(lvl.getPair(95, 15, geo), null, 'hors plateau');
  // bord : voisin hors grille → f2 null, swap refusé
  p = lvl.getPair(28, 15, geo);
  eq(p.f2, null, 'voisin hors grille');
  assert(!lvl.swapPair(p), 'swap refusé hors grille');
}

// ── swapPair ───────────────────────────────────────────────────────────────
{
  const lvl = makeLevel(['01', 'M2']);
  const ok = lvl.swapPair({ x: 0, y: 0, dx: 1, dy: 0 });
  assert(ok, 'swap simple accepté');
  eq(lvl.fruits[0][0].t, 1, 'échangé');
  assert(!lvl.swapPair({ x: 0, y: 1, dx: 1, dy: 0 }), 'métal : swap refusé');
  assert(!lvl.swapPair({ x: 0, y: 0, dx: 0, dy: -1 }), 'bord haut refusé');
  assert(!lvl.swapPair(null), 'paire nulle refusée');
}

// ── addFruit (parasites) ───────────────────────────────────────────────────
{
  const lvl = makeLevel([
    '..',
    '..',
    '0.',
  ]);
  const f = lvl.addFruit(0, 2, 0);
  assert(f != null && lvl.fruits[0][1] === f, 'posé sur la pile');
  lvl.addFruit(0, 2, 0);
  eq(lvl.addFruit(0, 2, 0), null, 'colonne pleine → null (game over)');
}

// ── pop/pushBottomFruit ────────────────────────────────────────────────────
{
  const lvl = makeLevel([
    '.',
    '1',
    '2',
  ]);
  const f = lvl.popBottomFruit(0);
  eq(f.save_t, 2, 'pop : fruit du bas');
  eq(dumpCol(lvl, 0), '..1', 'colonne descendue');
  let destroyed = 0;
  lvl.onDestroy = function () { destroyed++; };
  const lvl2 = makeLevel(['1', '2', '3']);
  lvl2.onDestroy = function () { destroyed++; };
  lvl2.gen_fruit_color = function () { return 5; };
  const nf = lvl2.pushBottomFruit(0, null);
  eq(destroyed, 1, 'push sur colonne pleine : le haut est détruit');
  eq(dumpCol(lvl2, 0), '235', 'colonne remontée + nouveau fruit en bas');
  eq(nf.t, 5, 'fruit généré');
}

// ── simulation calcStart/calcNext/calcEnd (restitution exacte) ─────────────
{
  const lvl = makeLevel([
    '.....',
    '.000.',
    '.121A',
  ]);
  const before = [];
  for (let x = 0; x < 5; x++) before.push(dumpCol(lvl, x));
  const data = lvl.calcStart();
  assert(data != null, 'combos détectés au départ');
  let res = null, guard = 0;
  while (res == null && guard++ < 20) res = lvl.calcNext(data);
  assert(res != null, 'simulation terminée');
  eq(res.length, 1, 'une phase de combos');
  for (let x = 0; x < 5; x++)
    eq(dumpCol(lvl, x), before[x], 'plateau restauré x=' + x);
  assert(lvl.fruits[4][2].armure, 'armure restaurée');
  eq(lvl.fruits[4][2].t, -1, 'couleur re-masquée');
}

// ── scores ─────────────────────────────────────────────────────────────────
{
  eq(E.calcScore(3, 1), 15, 'challenge : 3 fruits phase 1');
  eq(E.calcScore(5, 2), 5 * 5 * Math.floor(Math.pow(2, 0.8)), 'challenge phase 2');
  eq(E.calcScoreClassic(3, 1, 2), 2 * 6 * 1, 'classique : niveau 2, 3 fruits (1+2+3)');
  eq(E.calcScoreClassic(2, 2, 1), 1 * 3 * 2, 'classique : paire en chaîne');
  // duel : difficulté 2 neutre
  eq(E.sendFruitsCount(false, 3, 0, 2), 0, '3 fruits phase 0 : rien');
  eq(E.sendFruitsCount(false, 6, 0, 2), 3, '6 fruits → 3 parasites');
  eq(E.sendFruitsCount(false, 6, 2, 2), Math.min(Math.floor(5 * 1.3), 8), 'bonus de chaîne');
  eq(E.sendFruitsCount(true, 6, 0, 4), 5, 'IA difficile envoie plus (dif +2)');
  eq(E.sendFruitsCount(false, 6, 0, 4), 1, 'joueur en difficile envoie moins');
  eq(E.sendFruitsCount(true, 30, 9, 2), 8, 'plafond à 8');
}

// ── attaque : tremblement de terre ─────────────────────────────────────────
{
  const lvl = makeLevel([
    '..',
    '0.',
    '1.',
    '22',
  ]);
  // colonne 0 (h=3) haute, colonne 1 (h=1) basse → le bas de la basse part
  // sous la haute
  const r = E.attackEarthquake(lvl);
  assert(r.rems[1] != null, 'fruit retiré de la colonne basse');
  assert(r.adds[0] != null, 'fruit ajouté sous la colonne haute');
  eq(r.adds[0].save_t, r.rems[1].save_t, 'même couleur transférée');
  eq(dumpCol(lvl, 1), '....', 'colonne basse vidée');
  eq(dumpCol(lvl, 0), '0122', 'colonne haute approfondie');
}

// ── attaque : coulée de métal ──────────────────────────────────────────────
{
  const lvl = makeLevel([
    '..',
    'A.',
    '1.',
    '22',
  ]);
  const r = E.attackCouleeMetal(lvl);
  eq(r.acier.length, 3, 'deux + un fruits métallisés');
  eq(lvl.fruits[0][1].flags, E.FLAG_NOSWAP, 'armure remplacée par métal');
  eq(lvl.fruits[0][1].t, 0, 'couleur révélée');
  assert(!lvl.fruits[0][1].armure, 'plus d\'armure');
}

// ── attaque : colonnade (choix de colonne) ─────────────────────────────────
{
  const lvl = makeLevel([
    '..',
    '..',
    '..',
    '0.',
    '0.',
  ]);
  // fruits[0][3] occupé → rejets jusqu'à tomber sur la colonne 1
  const x = E.pickColonnadeColumn(lvl, seqRng([0, 0, 1]));
  eq(x, 1, 'évite les colonnes déjà hautes');
}

// ── défenses ───────────────────────────────────────────────────────────────
{
  // écarteur : colonnes extrêmes détruites, moitiés poussées vers l'extérieur
  const lvl = makeLevel([
    '0123',
    '4567',
  ]);
  const d = E.defenseEcarteur(lvl);
  eq(d.id, 0, 'id écarteur');
  eq(d.mc1.length, 2, 'colonne gauche capturée');
  eq(lvl.fruits[0][0].t, 1, 'gauche décalée');
  eq(lvl.fruits[3][0].t, 2, 'droite décalée');
  eq(lvl.fruits[1][0], null, 'trou au centre gauche');
  eq(lvl.fruits[2][0], null, 'trou au centre droit');
}
{
  // égaliseur : transfert des hautes vers les basses
  const lvl = makeLevel([
    '0...',
    '1...',
    '2...',
    '3456',
  ]);
  const d = E.defenseEgaliseur(lvl);
  eq(d.id, 1, 'id égaliseur');
  assert(d.rems[0] != null, 'la plus haute donne');
  // un fruit a été transféré vers une colonne basse
  let total = 0;
  for (let x = 0; x < 4; x++)
    for (let y = 0; y < 4; y++)
      if (lvl.fruits[x][y] != null) total++;
  eq(total, 7, 'aucun fruit perdu (7 au total)');
}
{
  // coupeur : ramène tout à max-2
  const lvl = makeLevel([
    '0...',
    '0...',
    '00..',
    '0000',
  ]);
  const d = E.defenseCoupeur(lvl);
  eq(d.id, 2, 'id coupeur');
  eq(d.cuts.length, 2, 'deux fruits coupés sur la grande pile');
  eq(dumpCol(lvl, 0), '..00', 'pile rabotée à hauteur 2');
}
{
  // pète-1-ligne
  const lvl = makeLevel([
    '0.',
    '12',
  ]);
  const d = E.defensePete1Ligne(lvl);
  eq(d.id, 3, 'id pete1ligne');
  eq(d.cuts.length, 2, 'ligne du bas détruite');
  eq(lvl.fruits[0][1], null, 'case vidée');
  assert(lvl.fruits[0][0] != null, 'le dessus reste (gravité gérée ensuite)');
}
{
  // convertisseur : src→dst, fruits convertis blindés
  const lvl = makeLevel([
    '01',
    '20',
  ]);
  const colorSeq = seqRng([0, 0, 1]);
  const d = E.defenseConvertisseur(lvl, function () { return colorSeq(3); });
  eq(d.id, 4, 'id convertisseur');
  eq(d.src, 0, 'source'); eq(d.dst, 1, 'destination (rejet du doublon)');
  eq(d.converts.length, 2, 'deux fruits convertis');
  eq(lvl.fruits[0][0].save_t, 1, 'couleur convertie');
  assert(lvl.fruits[0][0].armure, 'converti = blindé');
  eq(lvl.fruits[0][0].t, -1, 'couleur masquée');
}
{
  // pète-armures
  const lvl = makeLevel([
    'A1',
    '2B',
  ]);
  const d = E.defensePeteArmures(lvl);
  eq(d.id, 5, 'id peteArmures');
  eq(d.mcs.length, 2, 'deux armures pétées');
  eq(lvl.fruits[0][0].t, 0, 'couleur révélée');
  eq(lvl.fruits[1][1].flags & E.FLAG_ARMURE, 0, 'flag retiré');
}
{
  // combos classiques : explose les paires (min 2)
  const lvl = makeLevel([
    '00.',
    '12.',
  ], 3);
  const d = E.defenseCombos2(lvl);
  eq(d.id, 6, 'id combos2');
  eq(d.mcs.length, 2, 'la paire explose malgré min 3');
  eq(lvl.min_combo, 3, 'min_combo restauré');
}

// ── IA : trouve le bon swap ────────────────────────────────────────────────
{
  // un seul swap gagnant : échanger (1,3)↔(1,2) aligne trois « 1 » en bas
  const lvl = makeLevel([
    '...',
    '...',
    '.1.',
    '102',
    '212',
    '111',
  ]);
  // le plateau du bas est dense pour éviter les combos « gratuits »
  const ia = new E.IA(lvl, seqRng([]));
  ia.processStart(false);
  let pair = null, guard = 0;
  while (pair == null && guard++ < 10000) pair = ia.process(50);
  assert(pair != null, 'IA décide');
  // vérifie que le swap choisi crée bien un combo
  lvl.swapPair(pair);
  const combos = lvl.calc();
  assert(combos != null, 'le swap de l\'IA crée un combo');
  lvl.swapPair(pair);
}
{
  // aucun combo possible → l'IA joue un coup légal quand même
  const lvl = makeLevel([
    '01',
    '10',
  ]);
  const ia = new E.IA(lvl, seqRng([]));
  ia.processStart(false);
  let pair = null, guard = 0;
  while (pair == null && guard++ < 1000) pair = ia.process(50);
  assert(pair != null, 'IA joue un coup par défaut');
  assert(lvl.swapPair(pair), 'coup par défaut légal');
}
{
  // verrou horizontal : seuls les swaps verticaux sont considérés
  const lvl = makeLevel([
    '01',
    '10',
  ]);
  const ia = new E.IA(lvl, seqRng([]));
  ia.processStart(true);
  for (let i = 0; i < ia.swaps.length; i++)
    eq(ia.swaps[i].dx, 0, 'hlock : pas de swap horizontal');
}

// ── calcAvgHigh ────────────────────────────────────────────────────────────
{
  const lvl = makeLevel([
    '0.',
    '1.',
    '22',
  ]);
  lvl.calc();
  const v = lvl.calcAvgHigh();
  // highs = [3,1], moy=2, écart = 1+1=2 → sqrt(4)=2
  eq(v, 2, 'écart-type des hauteurs');
}

console.log('OK — ' + nassert + ' assertions');
