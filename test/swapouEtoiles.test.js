'use strict';
/*
 * L'IA DE SWAPOU ET SES ÉTOILES
 * ═════════════════════════════
 *
 * « L'IA est très forte pour maximiser les combos mais moins forte pour
 *   utiliser les étoiles, qu'elle a tendance à dilapider dans des situations
 *   non critiques. »
 *
 * Deux causes, et une troisième qu'on ne voyait pas :
 *
 *   1. LE PRIX D'UNE ÉTOILE ÉTAIT FIXE — `defendBase × coût`, quelle que soit
 *      la hauteur du plateau. Une étoile ne vaut pourtant que le coup qu'elle
 *      permet quand l'alternative est la mort : dépensée à hauteur 7, douze
 *      fruits de marge ; gardée pour la hauteur 13, la partie. Le prix suit
 *      désormais le moment (bot.js, `prixDefense`) : nul au plafond des six
 *      étoiles (la suivante serait perdue) et en crise, triple quand le
 *      plateau est bas, avec une RÉSERVE — hors crise, on ne lâche pas sa
 *      dernière défense.
 *
 *   2. UNE ÉTOILE RÉCOLTÉE AU PLAFOND EST PERDUE (Player.as plafonne le
 *      compteur) : l'analyseur la comptait quand même, à 500 l'unité, et
 *      courait après des étoiles qui ne valaient rien.
 *
 *   3. TROIS POUVOIRS N'ÉTAIENT PAS SIMULÉS — Moïse (Sel), Glissement (Wasabi)
 *      et Colorant E21 (Moutarde) : `simulateDefense` rendait null, le
 *      candidat n'existait pas, et l'IA ne proposait JAMAIS la défense de ces
 *      persos. Wasabi, l'un des plus joués, entassait ses étoiles sans
 *      servir. Les trois sont maintenant simulées en équivalence exacte avec
 *      le moteur (bot.test.js, 120 grilles), le Colorant par l'espérance sur
 *      ses six tirages.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const BOT = fs.readFileSync(path.join(ROOT, 'public/swapou/bot.js'), 'utf8');
const ANALYSE = fs.readFileSync(path.join(ROOT, 'public/swapou/analyse.js'), 'utf8');
const E = require(path.join(ROOT, 'public/swapou/engine.js'));
const B = require(path.join(ROOT, 'public/swapou/bot.js'));
const A = require(path.join(ROOT, 'public/swapou/analyse.js'));

const W = 12, H = 14;
function grille(hauteurs, couleur) {
  const g = [];
  for (let x = 0; x < W; x++) {
    g[x] = new Array(H).fill(null);
    for (let i = 0; i < hauteurs[x]; i++) g[x][H - 1 - i] = { t: couleur(x, i), s: couleur(x, i), fl: 0 };
  }
  return g;
}
// Le 3-coloriage (x + 2i) % 3 : aucun échange ne crée de combo. Mais un tel
// réseau est une BOMBE — un seul échange après une montée y déclenche une
// chaîne qui vide tout le plateau (mesuré : 151 fruits en 16 phases), et le
// modèle le voit. Pour un plateau SANS issue, on gèle donc tout sauf les deux
// rangées du bas : les armures ne se combinent pas, et fendues une à une
// elles ne forment jamais trois de la même couleur. L'IA n'a plus que sa
// défense pour respirer.
const sansCombo = (x, i) => (x + 2 * i) % 3;
function sansIssue(hauteur) {
  const g = [];
  for (let x = 0; x < W; x++) {
    g[x] = new Array(H).fill(null);
    for (let i = 0; i < hauteur; i++) {
      const c = sansCombo(x, i);
      g[x][H - 1 - i] = i < 2 ? { t: c, s: c, fl: 0 } : { t: -1, s: c, fl: E.FLAG_ARMURE };
    }
  }
  return g;
}

test('le prix d’une étoile suit le moment : nul en crise, triple au calme, réserve hors crise', () => {
  assert.match(BOT, /function prixDefense\(state, hMax\) \{/);
  assert.match(BOT, /if \(state\.stars >= E\.MAX_POWER\) return 0;/);
  assert.match(BOT, /if \(hMax >= 12\) return 0;/);
  assert.match(BOT, /if \(state\.stars - cout < cout && hMax < 11\) prix \+= WEIGHTS\.reserve;/);
  // Et c'est bien ce prix-là que l'analyseur paie — plus le prix fixe.
  assert.match(ANALYSE, /const prix = B\.prixDefense\(etat, etat\.hMax\);/);
  assert.match(ANALYSE, /if \(c\.type === 'defend'\) g -= c\.prix \|\| 0;/);
  assert.ok(!/Wt\.defendBase \* E\.DEFENSE_STARS/.test(ANALYSE), 'plus de prix fixe dans l’analyseur');
});

// Un plateau comme le jeu les fait : dix lignes montées par le générateur
// miroir (couleurs sans combo immédiat, gel et métal selon ncoups).
function plateauReel(lignes, ncoups) {
  const g = [];
  for (let x = 0; x < W; x++) g[x] = new Array(H).fill(null);
  for (let i = 0; i < lignes; i++) B.simGenLine(g, ncoups);
  return g;
}

test('le prix se paie dans l’analyse, et il dépend du moment et de la réserve', () => {
  // À trois couleurs, presque tout plateau cache une cascade : le choix final
  // entre échange et défense dépend de ce que la recherche y voit. Ce qu'on
  // vérifie ici, c'est le MÉCANISME : le prix que la défense paie dans
  // l'analyse est celui de prixDefense — et lui seul bouge entre deux
  // analyses du même plateau qui ne diffèrent que par la banque d'étoiles.
  const g = plateauReel(10, 60);
  const o = { budgetMs: 20000 };
  const defense = (stars) => A.analyserGrille(g, { charId: 0, canDefend: true, stars: stars, ncoups: 60 }, o)
    .coups.find((c) => c.type === 'defend');
  const derniere = defense(1), surplus = defense(3), plafond = defense(6);
  assert.ok(derniere && surplus && plafond, 'la défense de Dimitri est un candidat');
  assert.strictEqual(derniere.prix, B.prixDefense({ charId: 0, stars: 1 }, 10));
  assert.strictEqual(surplus.prix, B.prixDefense({ charId: 0, stars: 3 }, 10));
  assert.strictEqual(plafond.prix, 0, 'au plafond, rien à payer');
  assert.strictEqual(derniere.prix - surplus.prix, B.WEIGHTS.reserve,
    'la dernière étoile coûte la réserve de plus');
  assert.ok(derniere.valeur < surplus.valeur && surplus.valeur < plafond.valeur,
    'et la défense vaut d’autant plus qu’on a d’étoiles à perdre');
  // En crise (plateau à 12 et plus), le prix tombe à zéro, réserve comprise.
  const crise = plateauReel(12, 60);
  const d = A.analyserGrille(crise, { charId: 0, canDefend: true, stars: 1, ncoups: 60 }, o)
    .coups.find((c) => c.type === 'defend');
  assert.strictEqual(d.prix, 0, 'à hauteur 12, l’étoile ne coûte rien');
});

test('Wasabi, Sel et Moutarde ont enfin leur défense dans l’analyse', () => {
  const g = sansIssue(13);
  for (const [charId, nom] of [[6, 'Wasabi'], [2, 'Sel'], [4, 'Moutarde']]) {
    const sim = B.simulateDefense(g, E.DEFENSE_PLAYERS[charId]);
    assert.ok(sim && sim.grid, nom + ' : la défense se simule');
    const a = A.analyserGrille(g, { charId: charId, canDefend: true, stars: 6, ncoups: 40 }, { budgetMs: 20000 });
    assert.ok(a.coups.some((c) => c.type === 'defend'), nom + ' : la défense figure parmi les coups');
  }
  // Et Glissement nivelle sans rien détruire : six colonnes hautes donnent
  // chacune leur fruit du bas à une basse. (Tout gelé, pour que les fruits
  // déplacés ne forment pas de combo au passage.)
  const bosses = grille([12, 4, 12, 4, 12, 4, 12, 4, 12, 4, 12, 4], sansCombo);
  for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) if (bosses[x][y]) { bosses[x][y].t = -1; bosses[x][y].fl = E.FLAG_ARMURE; }
  const s = B.simulateDefense(bosses, 1);
  const hs = B.heights(s.grid);
  assert.deepStrictEqual(hs, [11, 5, 11, 5, 11, 5, 11, 5, 11, 5, 11, 5], 'les hautes donnent aux basses');
  assert.strictEqual(hs.reduce((a, b) => a + b, 0), 96, 'et rien n’est détruit');
});

test('une étoile récoltée au plafond ne compte plus', () => {
  assert.match(ANALYSE, /const place = Math\.max\(0, E\.MAX_POWER - \(etat\.stars \|\| 0\)\);/);
  assert.match(ANALYSE, /Wt\.starGain \* Math\.min\(c\.gained\.stars, place\)/);
});

test('le Colorant est jugé sur l’espérance de ses six tirages', () => {
  assert.match(BOT, /variantes\.push\(\{ grid: v, score: r\.score, stars: r\.stars, cracked: r\.cracked \}\);/);
  assert.match(ANALYSE, /const variantes = sim\.variantes \|\| \[sim\];/);
  assert.match(ANALYSE, /function valeur2\(c, ncoups, S\) \{/);
});
