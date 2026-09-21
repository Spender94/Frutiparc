/*
 * LE BOUILLOSCOPE À L'ENVERS — CHERCHER UN FRUTIZ PAR SA TÊTE.
 *
 * L'annuaire se parcourait par pseudo : une recherche, un alphabet. Mais
 * vingt ans après, beaucoup ne se souviennent plus du pseudo qu'ils
 * portaient — ils se souviennent de la peau claire, des cheveux verts, du
 * bois de cerf. On décrit donc une bouille avec les flèches de l'éditeur
 * « Ma Frutibouille », et l'annuaire se réduit à ceux qui la portent.
 *
 * Trois règles font toute la différence avec l'éditeur, et ce sont elles
 * qu'on vérifie ici :
 *
 *   · « PEU IMPORTE ». Dans l'éditeur chaque ligne porte forcément une
 *     valeur — on fabrique un visage entier. Ici chaque ligne peut rester
 *     libre, et seules celles qu'on a réglées filtrent.
 *
 *   · LES FLÈCHES SAUTENT LE VIDE. L'éditeur fait défiler les soixante-sept
 *     coiffures de la famille 0 : elles existent toutes. Un annuaire de
 *     quelques milliers de têtes n'en porte qu'une poignée — on ne propose
 *     donc que les valeurs présentes, et présentes PARMI LES BOUILLES QUI
 *     SATISFONT DÉJÀ LES AUTRES CRITÈRES. Chaque cran rend au moins un
 *     Frutiz.
 *
 *   · LE REPÊCHAGE. Une mémoire de vingt ans se trompe d'un cran. Quand la
 *     description ne rend personne, on classe l'annuaire par ressemblance
 *     plutôt que d'afficher une page vide — mais seulement à partir de DEUX
 *     critères : sur un seul, toutes les bouilles le manquent à égalité et
 *     « les plus ressemblantes » ne serait qu'un ordre alphabétique déguisé.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const R = require(path.join(ROOT, 'public/js/bouille-recherche.js'));
const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
const RUFFLE = fs.readFileSync(path.join(ROOT, 'public/ruffle.html'), 'utf8');

const NU = R.ecrire('000000010000000000000000', 6, 0);   // le socle, sans le sac
const tete = (champs) => R.composer(NU, champs);
const annuaire = (defs) => defs.map((d) => ({ pseudo: d[0], bouille: tete(d[1]) }));

/* ── 1. LA CHAÎNE D'ÉTAT ──────────────────────────────────────────────────── */

test('une paire base62 n’est pas un nombre décimal', () => {
  // public/frutiz/BOUILLES.md, § 1 : « 10 » vaut 62, « 0a » vaut 10.
  assert.strictEqual(R.lire('10' + '0'.repeat(22), 0), 62);
  assert.strictEqual(R.lire('0a' + '0'.repeat(22), 0), 10);
  assert.strictEqual(R.lire('0A' + '0'.repeat(22), 0), 36);
});

test('écrire puis relire rend la valeur, jusqu’aux coiffures au-delà de 61', () => {
  for (const v of [0, 1, 9, 10, 35, 36, 61, 62, 66, 3843]) {
    assert.strictEqual(R.lire(R.ecrire(NU, 6, v), 6), v, 'valeur ' + v);
  }
  // …et n’abîme aucune autre paire.
  const av = R.ecrire(NU, 6, 66);
  assert.strictEqual(av.length, 24);
  assert.strictEqual(R.lire(av, 0), R.lire(NU, 0));
  assert.strictEqual(R.lire(av, 8), R.lire(NU, 8));
});

test('les champs tombent aux places du relevé, et d’accord avec l’éditeur', () => {
  const attendu = { famille: 0, yeux: 2, iris: 4, cheveux: 6, bouche: 8, peau: 10, colch: 12, acc: 14, acccol: 18 };
  R.CHAMPS.forEach((c) => assert.strictEqual(c.pos, attendu[c.cle], 'place de ' + c.cle));
  // `FB_PARTS` de light.html porte les mêmes bornes pour les lignes communes :
  // si l'éditeur change de famille de référence, la recherche doit suivre.
  const parts = LIGHT.match(/var FB_PARTS = \[[\s\S]*?\n {2}\];/)[0];
  const iris = Number(LIGHT.match(/var IRIS_ORIGINE_MAX = (\d+);/)[1]);
  for (const [cle, max] of [['yeux', 8], ['cheveux', 66], ['bouche', 4], ['peau', 52], ['colch', 52]]) {
    assert.ok(new RegExp('key: "' + cle + '",[^\\n]*max: ' + max + '\\b').test(parts),
      'FB_PARTS ne donne plus ' + max + ' à ' + cle);
    assert.strictEqual(R.champ(cle).max, max, 'la recherche a dérivé sur ' + cle);
  }
  assert.strictEqual(R.champ('iris').max, iris, 'les iris d’origine');
});

/* ── 2. « PEU IMPORTE » ───────────────────────────────────────────────────── */

test('un critère absent ne s’écrit pas dans la tête décrite', () => {
  const t = R.composer(NU, { cheveux: 27, peau: 15 });
  assert.strictEqual(R.lire(t, 6), 27);
  assert.strictEqual(R.lire(t, 10), 15);
  assert.strictEqual(R.lire(t, 2), R.lire(NU, 2), 'les yeux restent ceux du socle');
  assert.strictEqual(R.actifs({ cheveux: 27, peau: 15 }).length, 2);
});

test('seuls les critères réglés filtrent', () => {
  const gens = annuaire([
    ['Anis', { cheveux: 27, peau: 15, yeux: 3 }],
    ['Basilic', { cheveux: 27, peau: 15, yeux: 7 }],
    ['Cumin', { cheveux: 41, peau: 15, yeux: 3 }],
  ]);
  assert.deepStrictEqual(R.chercher(gens, { cheveux: 27 }).exacts.map((e) => e.pseudo), ['Anis', 'Basilic']);
  assert.deepStrictEqual(R.chercher(gens, { cheveux: 27, yeux: 3 }).exacts.map((e) => e.pseudo), ['Anis']);
  assert.deepStrictEqual(R.chercher(gens, {}).exacts.map((e) => e.pseudo), ['Anis', 'Basilic', 'Cumin'],
    'aucun critère : tout l’annuaire, dans son ordre');
});

test('« peu importe » se distingue de la valeur zéro', () => {
  const gens = annuaire([['Zeste', { acc: 0 }], ['Yuzu', { acc: 4 }]]);
  assert.strictEqual(R.chercher(gens, { acc: 0 }).exacts.length, 1, 'accessoire « Rien » est un choix');
  assert.strictEqual(R.chercher(gens, {}).exacts.length, 2);
  assert.strictEqual(R.chercher(gens, { acc: undefined }).exacts.length, 2, 'undefined = peu importe');
  assert.strictEqual(R.chercher(gens, { acc: null }).exacts.length, 2, 'null aussi');
});

/* ── 3. LES FLÈCHES SAUTENT LE VIDE ───────────────────────────────────────── */

test('une flèche ne propose que des coiffures que quelqu’un porte', () => {
  const gens = annuaire([['Anis', { cheveux: 5 }], ['Basilic', { cheveux: 12 }], ['Cumin', { cheveux: 5 }]]);
  assert.deepStrictEqual(R.choix(gens, {}, 'cheveux'), [5, 12],
    'la famille 0 en compte soixante-sept, l’annuaire deux');
});

test('…et seulement parmi les bouilles qui satisfont les AUTRES critères', () => {
  const gens = annuaire([
    ['Anis', { cheveux: 5, peau: 15 }],
    ['Basilic', { cheveux: 12, peau: 15 }],
    ['Cumin', { cheveux: 41, peau: 30 }],
  ]);
  assert.deepStrictEqual(R.choix(gens, { peau: 15 }, 'cheveux'), [5, 12], 'la coiffure 41 est hors sujet');
  assert.deepStrictEqual(R.choix(gens, { peau: 30 }, 'cheveux'), [41]);
  // Le champ qu'on règle ne se filtre pas lui-même : sinon la flèche ne
  // proposerait jamais que la valeur en cours, et l'on ne bougerait plus.
  assert.deepStrictEqual(R.choix(gens, { cheveux: 5 }, 'cheveux'), [5, 12, 41]);
});

test('la valeur en cours reste proposée même si personne ne la porte', () => {
  const gens = annuaire([['Anis', { cheveux: 5 }], ['Basilic', { cheveux: 12 }]]);
  assert.deepStrictEqual(R.choix(gens, { cheveux: 9 }, 'cheveux'), [5, 9, 12],
    'sans quoi la flèche n’aurait pas d’où partir');
});

test('quand les autres critères ne rendent personne, l’éventail se rouvre en entier', () => {
  const gens = annuaire([['Anis', { cheveux: 5, peau: 15 }]]);
  const l = R.choix(gens, { peau: 44 }, 'bouche');
  assert.deepStrictEqual(l, [0, 1, 2, 3, 4], 'la ligne ne doit jamais se bloquer');
});

/* ── 4. LE REPÊCHAGE ──────────────────────────────────────────────────────── */

test('un seul critère manqué ne déclenche pas de repêchage', () => {
  const gens = annuaire([['Anis', { cheveux: 5 }], ['Basilic', { cheveux: 12 }]]);
  const r = R.chercher(gens, { cheveux: 33 });
  assert.deepStrictEqual(r.exacts, []);
  assert.deepStrictEqual(r.proches, [], 'toutes le manquent à égalité : on n’a rien à classer');
});

test('à partir de deux critères, les plus ressemblantes prennent la main', () => {
  const gens = annuaire([
    ['Anis', { cheveux: 5, peau: 15, yeux: 3 }],     // manque les yeux
    ['Basilic', { cheveux: 41, peau: 44, yeux: 1 }], // manque tout
    ['Cumin', { cheveux: 5, peau: 44, yeux: 3 }],    // manque la peau et les yeux
  ]);
  const r = R.chercher(gens, { cheveux: 5, peau: 15, yeux: 7 });
  assert.deepStrictEqual(r.exacts, []);
  assert.deepStrictEqual(r.proches.map((e) => e.pseudo), ['Anis', 'Cumin', 'Basilic']);
  assert.deepStrictEqual(r.proches.map((e) => e.rates), [1, 2, 3]);
});

test('à égalité de critères manqués, le beige voisin passe devant le bleu', () => {
  // Beige 2 (index 1) contre Beige 3 (2) et Blue 1 (23) : c'est la promesse
  // faite au joueur qui se trompe d'un cran de palette.
  const gens = annuaire([
    ['Bleuet', { peau: 23, cheveux: 5 }],
    ['Beignet', { peau: 2, cheveux: 5 }],
  ]);
  const r = R.chercher(gens, { peau: 1, cheveux: 12 });
  assert.deepStrictEqual(r.proches.map((e) => e.pseudo), ['Beignet', 'Bleuet']);
  assert.ok(R.ecartCouleur(1, 2) < R.ecartCouleur(1, 23), 'deux beiges se tiennent');
  assert.ok(R.ecartCouleur(1, 1) === 0);
});

test('une recherche exacte ne propose jamais de ressemblance', () => {
  const gens = annuaire([['Anis', { cheveux: 5, peau: 15 }], ['Basilic', { cheveux: 5, peau: 44 }]]);
  const r = R.chercher(gens, { cheveux: 5, peau: 15 });
  assert.deepStrictEqual(r.exacts.map((e) => e.pseudo), ['Anis']);
  assert.deepStrictEqual(r.proches, []);
});

test('le repêchage est borné — on propose une poignée de têtes, pas l’annuaire', () => {
  const gens = [];
  for (let i = 0; i < 200; i++) gens.push({ pseudo: 'F' + i, bouille: tete({ cheveux: 5, peau: i % 53 }) });
  assert.strictEqual(R.chercher(gens, { cheveux: 41, peau: 60 }).proches.length, 12);
  assert.strictEqual(R.chercher(gens, { cheveux: 41, peau: 60 }, { limiteProches: 4 }).proches.length, 4);
});

/* ── 5. LE CÂBLAGE DES DEUX BOUILLOSCOPES ─────────────────────────────────── */

test('le light charge le module et monte le tiroir', () => {
  assert.ok(LIGHT.includes('<script src="/js/bouille-recherche.js"></script>'), 'le module est chargé');
  for (const id of ['trombi-mode', 'trombi-bq', 'trombi-bq-ecran', 'trombi-bq-rows', 'trombi-bq-mienne', 'trombi-bq-vider']) {
    assert.ok(LIGHT.includes('id="' + id + '"'), 'balisage manquant : ' + id);
  }
  // Les deux filtres se COMPOSENT : la bouille s'applique à ce que le pseudo
  // a déjà retenu, pas à l'annuaire entier.
  assert.match(LIGHT, /function trombiFiltered\(\) \{\s*var base = trombiParPseudo\(\);/);
  assert.ok(LIGHT.includes('FPBouilleRecherche.chercher(base, bqCriteres)'));
  // Et les flèches passent par les facettes, pas par un simple 0..max.
  assert.ok(LIGHT.includes('FPBouilleRecherche.choix(trombiParPseudo(), vue, champ.cle)'));
});

test('l’overlay Ruffle a le même tiroir, et le même module', () => {
  assert.ok(RUFFLE.includes('<script src="/js/bouille-recherche.js"></script>'), 'le module est chargé');
  assert.ok(RUFFLE.includes('<script src="/js/bouille-palette.js"></script>'), 'la palette aussi (noms et teintes)');
  assert.ok(RUFFLE.includes('FPBouilleRecherche.chercher(base, bqCriteres)'));
  assert.ok(RUFFLE.includes('FPBouilleRecherche.choix(parPseudo(), vue, champ.cle)'));
  assert.ok(RUFFLE.includes('Voici les plus ressemblantes'), 'le repêchage y est aussi');
});

test('le socle de départ n’est pas le sac à patate', () => {
  // La coiffure 1 est le sac : il couvre tout le visage, et un aperçu qui
  // sert de QUESTION ne doit rien cacher. L'éditeur le quitte déjà à
  // l'ouverture (FB_SAC) ; la recherche part du crâne nu.
  assert.ok(LIGHT.includes('FPBouilleRecherche.ecrire(DEFAULT_BOUILLE, 6, 0)'));
  assert.strictEqual(R.lire(NU, 6), 0);
});
