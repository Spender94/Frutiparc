// Tests de l'analyseur Swapou — node public/swapou/analyse.test.js
//
// 1) La FORME du résultat : des coups légaux, triés, chacun avec sa nature et
//    sa raison — c'est ce que le panneau en partie affiche tel quel.
// 2) Les DÉCISIONS : un combo évident se prend, une position critique se
//    défend, une position sans combo se PRÉPARE (le coup silencieux, reconnu
//    comme tel), et rien ne se joue quand rien ne peut l'être.
// 3) Le BUDGET : coupé court, l'analyseur répond quand même, à deux coups.
'use strict';
const E = require('./engine.js');
const B = require('./bot.js');
const A = require('./analyse.js');

let nassert = 0;
function assert(cond, msg) {
  nassert++;
  if (!cond) {
    console.error('FAIL: ' + msg);
    process.exit(1);
  }
}
function lcg(seed) {
  let s = seed >>> 0;
  return function (n) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s % n;
  };
}

const W = 12, H = 14;
const NATURES = ['combo', 'preparation', 'attente', 'defense'];

function levelVide() {
  return new E.Level({
    width: W, height: H, min: 3,
    gen_fruit_flags: function () { return 0; },
    gen_fruit_color: function () { return 0; },
  });
}
// le damier (x+2y)%3 : deux voisins ne sont jamais de la même couleur, et
// AUCUN échange n'y crée de combo (un échange ne forme que des paires)
function damier(yMin) {
  const lvl = levelVide();
  for (let x = 0; x < W; x++)
    for (let y = yMin; y < H; y++)
      lvl.fruits[x][y] = new E.Fruit((x + 2 * y) % 3, 0);
  return lvl;
}
function levelAleatoire(rng, densite) {
  const lvl = levelVide();
  for (let x = 0; x < W; x++) {
    const h = rng(Math.max(2, Math.round(H * densite)));
    for (let i = 0; i < h; i++) {
      const roll = rng(100);
      let flags = 0;
      if (roll < 18) flags = E.FLAG_ARMURE;
      else if (roll < 26) flags = E.FLAG_NOSWAP;
      else if (roll < 30) flags = E.FLAG_STAR;
      lvl.fruits[x][H - 1 - i] = new E.Fruit(rng(3), flags);
    }
  }
  return lvl;
}
function paireLegale(lvl, p) {
  if (!p) return false;
  const f1 = lvl.getFruit(p.x, p.y), f2 = lvl.getFruit(p.x + p.dx, p.y + p.dy);
  return !!(f1 && f2 && f1.canSwap() && f2.canSwap()
    && ((p.dx === 1 && p.dy === 0) || (p.dx === 0 && p.dy === 1)));
}

// ── 1) la forme du résultat, sur des grilles aléatoires ─────────────────────
{
  const rng = lcg(7);
  for (let iter = 0; iter < 12; iter++) {
    const lvl = levelAleatoire(rng, 0.3 + (iter % 4) * 0.15);
    const r = A.analyser(lvl, { charId: 1, canDefend: iter % 3 === 0, stars: 2, ncoups: 40 },
      { budgetMs: 3000 });
    assert(r.nb === r.coups.length, 'itér ' + iter + ' : autant de coups que de candidats');
    // un plateau quasi vide n'a parfois aucun échange : rien à juger alors
    assert(r.nb === 0 || r.profondeur === 2, 'itér ' + iter + ' : jugé à deux coups (' + r.profondeur + ')');
    for (let i = 0; i < r.coups.length; i++) {
      const c = r.coups[i];
      assert(NATURES.indexOf(c.nature) >= 0, 'itér ' + iter + ' : nature connue (' + c.nature + ')');
      assert(typeof c.raison === 'string' && c.raison.length > 0, 'itér ' + iter + ' : une raison');
      assert(c.rang === i + 1, 'itér ' + iter + ' : rang ' + c.rang);
      if (c.type === 'swap') assert(paireLegale(lvl, c.pair), 'itér ' + iter + ' : paire légale');
      else assert(c.type === 'defend' && c.nature === 'defense', 'itér ' + iter + ' : une défense');
      if (c.type === 'swap')
        assert((c.nature === 'combo') === (c.gain.score > 0),
          'itér ' + iter + ' : combo ⇔ il marque (' + c.nature + ', ' + c.gain.score + ')');
      if (i > 0) assert(r.coups[i - 1].valeur >= c.valeur, 'itér ' + iter + ' : trié par valeur');
    }
    if (r.meilleur) assert(r.meilleur === r.coups[0], 'itér ' + iter + ' : le meilleur est le premier');
  }
}

// ── 2) les décisions ────────────────────────────────────────────────────────
{
  // un trio réalisable au sommet d'un damier haut : le meilleur coup marque,
  // et sa raison le dit en clair
  const lvl = damier(4);
  const Acol = (0 + 2 * 4) % 3;
  lvl.fruits[1][4] = new E.Fruit(Acol, 0);
  lvl.fruits[3][4] = new E.Fruit(Acol, 0);
  const r = A.analyser(lvl, { charId: 0, canDefend: false, stars: 0, ncoups: 30 });
  assert(r.meilleur && r.meilleur.type === 'swap', 'le meilleur coup est un échange');
  assert(r.meilleur.nature === 'combo' && r.meilleur.gain.score > 0,
    'et c’est un combo (' + r.meilleur.nature + ', +' + r.meilleur.gain.score + ')');
  assert(/^\d+ fruits? en \d+ phases? : \+\d+/.test(r.meilleur.raison),
    'la raison d’un combo : « N fruits en P phases : +S » (' + r.meilleur.raison + ')');
}
{
  // AU BORD DU PLAFOND (colonnes à 13), une étoile en banque : Dimitri doit
  // EFFONDRER. Le damier nu ne suffit pas à le prouver — à DEUX coups, un
  // échange y forme une paire et le suivant un trio dont la cascade, sur un
  // plateau si régulier, emporte cent fruits : l'analyseur y voit, à raison,
  // une échappatoire. On fige donc tout en métal, sauf deux voisins qui ne
  // peuvent que s'échanger l'un l'autre : plus rien ne peut marquer, et jouer
  // fait monter la ligne au plafond. La seule issue est la défense.
  const lvl = damier(1);
  for (let x = 0; x < W; x++)
    for (let y = 1; y < H; y++) lvl.fruits[x][y].flags = E.FLAG_NOSWAP;
  lvl.fruits[5][1].flags = 0;
  lvl.fruits[6][1].flags = 0;
  const c = A.choisir(lvl, { charId: 0, canDefend: true, stars: 1, ncoups: 80 });
  assert(c.type === 'defend' && c.nature === 'defense', 'au plafond, la défense (' + c.type + ')');
  assert(/^défense/.test(c.raison), 'la raison d’une défense commence par « défense »');
}
{
  // LE COUP SILENCIEUX.
  //
  // Un plateau de MÉTAL en damier (rien ne s'y échange, rien n'y forme de
  // groupe), et cinq fruits libres sur la rangée du bas :
  //
  //     x :   5   6   7   8   9
  //           A   A   B   C   A        (A = 1, B = 0, C = 2)
  //
  // Aucun échange ne marque tout de suite : (8↔9) rapproche le troisième A
  // sans le coller à la paire, (6↔7) sépare la paire. Mais après (8↔9),
  // l'échange (7↔8) achève le trio — c'est une préparation, et c'est la
  // seule chose de valeur sur ce plateau. L'analyseur doit la préférer, la
  // nommer, et annoncer ce qu'elle prépare.
  //
  // Le métal de la rangée 12 au-dessus des fruits libres vaut 2, 0, 1, 2, 0
  // (damier x % 3) : seul (7,12) est un A, et il ne touche qu'un B — le
  // plateau ne porte donc aucun groupe de trois, ce que l'on vérifie.
  const lvl = damier(6);
  for (let x = 0; x < W; x++)
    for (let y = 6; y < H; y++) lvl.fruits[x][y].flags = E.FLAG_NOSWAP;
  const libres = [[5, 1], [6, 1], [7, 0], [8, 2], [9, 1]];
  for (const [x, col] of libres) lvl.fruits[x][H - 1] = new E.Fruit(col, 0);
  const g0 = B.copyGrid(lvl);
  assert(B.resolve(B.cloneGrid(g0), 0).score === 0, 'aucun groupe déjà formé sur ce plateau');
  assert(B.mobility(g0) === 0, 'aucun combo immédiat sur ce plateau');
  const r = A.analyser(lvl, { charId: 1, canDefend: false, stars: 0, ncoups: 30 }, { budgetMs: 4000 });
  assert(r.meilleur && r.meilleur.type === 'swap', 'un échange est conseillé');
  assert(r.meilleur.nature === 'preparation',
    'le coup est reconnu comme une PRÉPARATION (' + r.meilleur.nature + ' : ' + r.meilleur.raison + ')');
  assert(r.meilleur.suite && r.meilleur.suite.score > 0, 'et il annonce la suite (' + JSON.stringify(r.meilleur.suite) + ')');
  assert(/^coup silencieux : prépare \d+ pts/.test(r.meilleur.raison), 'la raison le dit (' + r.meilleur.raison + ')');
  assert(r.meilleur.suite.pieces >= 3 && r.meilleur.suite.phases >= 1,
    'la suite annoncée est un vrai combo (' + r.meilleur.suite.pieces + ' fruits, ' + r.meilleur.suite.phases + ' phase)');
  // et il n'y a ici que des préparations ou des attentes : rien ne marque
  for (const c of r.coups) assert(c.nature !== 'combo', 'aucun combo immédiat n’est possible (' + c.raison + ')');
}
{
  // que du métal : rien à jouer
  const lvl = levelVide();
  for (let x = 0; x < W; x++) lvl.fruits[x][H - 1] = new E.Fruit(0, E.FLAG_NOSWAP);
  const c = A.choisir(lvl, { charId: 1, canDefend: false, stars: 0 });
  assert(c.type === 'none', 'aucun coup → none');
}

// ── 3) le budget ────────────────────────────────────────────────────────────
{
  // un damier plein sur dix rangées : ~200 échanges légaux, aucun combo —
  // de quoi mesurer une coupe sans que le hasard vide le plateau
  const lvl = damier(4);
  const r = A.analyser(lvl, { charId: 1, canDefend: false, stars: 0, ncoups: 60 }, { budgetMs: 1 });
  assert(r.meilleur != null, 'coupé court, il répond quand même');
  assert(r.profondeur === 2, 'et à deux coups : au moins huit candidats sont jugés');
  assert(r.tempsMs < 1500, 'sans s’éterniser (' + r.tempsMs + ' ms)');
  // la coupe ne prive pas les coups silencieux : l'ordre d'approfondissement
  // les entrelace avec les combos
  const juges = r.coups.filter(function (c) { return c.valeur !== undefined; });
  assert(juges.length >= 8, 'au moins huit coups jugés');
}

// ── 4) la fin de partie ─────────────────────────────────────────────────────
{
  // Le troisième étage s'allume TARD (o.tard), et seulement tard : à quarante
  // coups, deux étages ; à cent cinquante, trois — et sans l'option, jamais.
  const rng = lcg(21);
  const lvl = levelAleatoire(rng, 0.7);
  const opt = { budgetMs: 8000, tard: { ncoups: 120, hMax: 12, K2: 4, K3: 3, S: 2 } };
  const tot = A.analyser(lvl, { charId: 1, canDefend: false, stars: 0, ncoups: 40 }, opt);
  assert(tot.nb === 0 || tot.profondeur === 2, 'à quarante coups, deux étages (' + tot.profondeur + ')');
  const tard = A.analyser(lvl, { charId: 1, canDefend: false, stars: 0, ncoups: 150 }, opt);
  assert(tard.nb === 0 || tard.profondeur === 3, 'à cent cinquante coups, le troisième étage (' + tard.profondeur + ')');
  const sans = A.analyser(lvl, { charId: 1, canDefend: false, stars: 0, ncoups: 150 }, { budgetMs: 8000, tard: null });
  assert(sans.nb === 0 || sans.profondeur === 2, 'l’option éteinte, deux étages (' + sans.profondeur + ')');
  // Et le RÉGLAGE PAR DÉFAUT l'allume — c'est lui que le jeu utilise : passé
  // cent coups, trois étages ; avant, deux.
  const def = A.analyser(lvl, { charId: 1, canDefend: false, stars: 0, ncoups: 150 }, { budgetMs: 8000 });
  assert(def.nb === 0 || def.profondeur === 3, 'par défaut, trois étages passé cent coups (' + def.profondeur + ')');
  const defTot = A.analyser(lvl, { charId: 1, canDefend: false, stars: 0, ncoups: 60 }, { budgetMs: 8000 });
  assert(defTot.nb === 0 || defTot.profondeur === 2, 'par défaut, deux étages avant (' + defTot.profondeur + ')');
}
{
  // Une défense conseillée AVANT la crise se dit « en prévention » : un plateau
  // plat à dix (le Glissement n'y déplace rien, mais il est proposé), Wasabi
  // avec quatre étoiles.
  const lvl = damier(4);
  const r = A.analyser(lvl, { charId: 6, canDefend: true, stars: 4, ncoups: 60 }, { budgetMs: 3000 });
  const d = r.coups.find(function (c) { return c.type === 'defend'; });
  assert(d, 'la défense est un candidat');
  assert(d.prevention === true && d.hauteur === 10, 'à hauteur 10, hors crise, c’est de la prévention');
  assert(/en prévention, avant la crise \(hauteur 10\)/.test(d.raison), 'et la raison le dit (' + d.raison + ')');
}

console.log('OK — ' + nassert + ' assertions (analyse)');
