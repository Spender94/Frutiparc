/*
 * Le cinquième lot de retours MiniPixiz.
 *
 *   · « Le bug de la récompense de l'arc-en-ciel est toujours présent : quand
 *     on gagne et que le sac est plein, le jeu ne propose pas de placer
 *     l'objet dans notre inventaire (et donc l'occasion de jeter un objet pour
 *     faire de la place) et la récompense vanish purement et simplement. »
 *
 *     `Base.grab` ne perd JAMAIS un objet faute de place : il le pousse dans
 *     `itemList`, et `Base.tryToClose` — la sortie commune à tous les modes —
 *     ouvre l'inventaire dessus au retour, porte condamnée tant que la rangée
 *     n'est pas vidée. Le portage n'avait câblé cette liste que pour la FORÊT
 *     (`course.enAttente`) ; l'arc-en-ciel annonçait son lot, le faisait monter
 *     à l'écran… et le laissait disparaître. Et il ne revient pas : un
 *     arc-en-ciel ne se gagne qu'une fois.
 *
 *   · « Les cœurs ne se régénèrent plus complètement lors du reset. »
 *
 *     La règle est celle de FaerieInfo.upkeep, et le portage l'applique au
 *     chiffre près : `maxLife = ceil( ($hunger/20) × carac[LIFE] )`. La nuit
 *     rend donc les cœurs À HAUTEUR DU VENTRE — tous à 20 de faim, quatre
 *     cinquièmes à 16. Ce qui manquait n'était pas le calcul mais le DIT : la
 *     règle est invisible tant que la fée est jeune (à deux ou trois cœurs,
 *     l'arrondi au supérieur rend toujours tout) et n'apparaît qu'à partir de
 *     cinq ou six, c'est-à-dire le jour où la fée a grandi — d'où le « plus »
 *     du retour, parfaitement fondé. Le jeu promettait même le contraire :
 *     « nourrissez-la, elle récupérera cette nuit ». Il annonce maintenant le
 *     compte exact, là où le joueur regarde.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const lire = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const L = require(path.join(ROOT, 'public/minipixiz/lieux.js'));
const P = require(path.join(ROOT, 'public/minipixiz/plateforme.js'));
const F = require(path.join(ROOT, 'public/minipixiz/faerie.js'));
const PAGE = lire('public/minipixiz/index.html');

// ── 1 · Le lot de l'arc-en-ciel, le sac plein ─────────────────────────────

// Une fiche prête à gagner l'arc-en-ciel, avec ou sans place au sac.
function arcEnCiel(sacPlein, surEvenement) {
  const carte = P.carteNeuve();
  carte.$bag = 1;                                  // PLACES_SAC[1] : quatre places
  carte.$inv = sacPlein ? [40, 41, 42, 43] : [40, null, null, null];
  carte.$rainbow = { $day: 0, $f: true, $it: 103 };  // un parchemin, reconnaissable
  const lieu = new L.ArcEnCiel({ carte, graine: 7, fee: null, surEvenement });
  return { carte, lieu };
}

// On garnit le plateau (la vague de lumière doit avoir de quoi effacer), puis
// on vide la roue : c'est le chemin des quatre-vingt-sept pièces, sans elles.
function gagner(lieu) {
  for (let i = 0; i < 4000 && !lieu.fini && lieu.jeu.eList.length < 20; i++) lieu.update(1);
  assert.ok(!lieu.fini, 'la partie de préparation ne doit pas être perdue');
  lieu.roue = L.ROUE_PAS;
  lieu.surNouveauTour();
  for (let i = 0; i < 20000 && lieu.sortie; i++) lieu.update(1);
}

test('le sac plein, le lot de l’arc-en-ciel n’est pas perdu : il est mis en attente', () => {
  const vus = [];
  const { carte, lieu } = arcEnCiel(true, (n, o) => vus.push({ n, o }));
  gagner(lieu);

  const prix = vus.find((e) => e.n === 'prix');
  assert.ok(prix, 'le lot est annoncé');
  assert.equal(prix.o.objet, 103, 'et c’est bien le parchemin du jour');
  assert.equal(prix.o.ou, 'perdu', 'le sac n’avait pas de place');
  // Il n'entre nulle part de force : les quatre cases du joueur sont intactes.
  assert.deepEqual(carte.$inv, [40, 41, 42, 43], 'rien n’a été écrasé');
  // Et l'arc-en-ciel s'efface du ciel quand même — Cm.removeRainbow est
  // inconditionnel dans initStep(22).
  assert.equal(carte.$rainbow.$f, false);
});

test('avec une place, il va droit au sac', () => {
  const { carte, lieu } = arcEnCiel(false, () => {});
  gagner(lieu);
  assert.deepEqual(carte.$inv, [40, 103, null, null]);
});

test('la page range le lot en attente au lieu de le laisser filer', () => {
  // Une SEULE liste — celle de la base — et on y AJOUTE : un lot qui attend ne
  // doit pas être effacé par la course suivante (l'ancien code réécrivait
  // `objetsARanger` à chaque fin de course).
  assert.match(PAGE, /function garderARanger\(liste\)/);
  assert.match(PAGE, /objetsARanger = \(objetsARanger \|\| \[\]\)\.concat\(l\);/);
  assert.ok(!/objetsARanger = course\.enAttente\.slice\(\)/.test(PAGE),
    'la course n’écrase plus la liste, elle l’alimente');
  assert.match(PAGE, /garderARanger\(course\.enAttente\);/);

  // Le lot de l'arc-en-ciel passe par la même porte.
  assert.match(PAGE, /if \(info && info\.ou === 'perdu'\) garderARanger\(\[info\.objet\]\);/);

  // Et la clairière ouvre l'inventaire dessus (Base.tryToClose), ce qu'elle
  // faisait déjà pour la forêt : on vérifie que la porte n'a pas bougé.
  assert.match(PAGE, /if \(objetsARanger && objetsARanger\.length\) \{/);
  assert.match(PAGE, /inventaire\.setExtraList\(aRanger\);/);
});

// ── 2 · Ce que la nuit rend de cœurs, et ce que le jeu en dit ─────────────

// Une fée à six cœurs, pour que l'arrondi ne masque plus la règle.
function fee(faim, vie) {
  const fs = F.genererGraine(((s) => () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648)(7));
  fs.$carac = [2, 2, 6, 2, 2, 3];
  fs.$life = vie; fs.$hunger = faim; fs.$moral = 10; fs.$mission = null; fs.$pos = null;
  return new F.Fee(fs, null, null);
}

test('la nuit rend les cœurs à hauteur du ventre — le calcul de l’original', () => {
  // FaerieInfo.upkeep : maxLife = ceil( ($hunger/20) × carac[LIFE] ).
  for (const [faim, attendu] of [[20, 6], [16, 5], [12, 4], [8, 3], [4, 2], [0, 0]]) {
    assert.equal(fee(faim, 1).vieDeLaNuit(), attendu, 'faim ' + faim);
  }
  // Couchée repue, elle se relève au complet.
  const f = fee(20, 2);
  f.entretien(true);
  assert.equal(f.fs.$life, 6, 'six cœurs sur six');
  assert.equal(f.fs.$hunger, 16, 'et la faim descend de quatre APRÈS la régénération');

  // Couchée à seize, elle n'en récupère que cinq : c'est la règle, pas un bug.
  const g = fee(16, 2);
  g.entretien(true);
  assert.equal(g.fs.$life, 5);

  // JEUNE, la règle ne se voit pas : à deux cœurs, l'arrondi rend toujours
  // tout. C'est pour ça que le joueur la découvre quand sa fée grandit.
  const jeune = fee(16, 1);
  jeune.fs.$carac[2] = 2; jeune.carac[2] = 2;
  assert.equal(jeune.vieDeLaNuit(), 2, 'deux cœurs sur deux, à seize de faim');
});

test('la main vide ne fait pas de la première fée une fée portée', () => {
  // Trouvé en vérifiant le reset. `flFree = $current != getFaerieIndex(fs)`,
  // et `$current` est NULL quand la main est vide (Slot.mt). `null != 0` est
  // vrai — la fée du rang zéro est libre. Le portage passait `$current` par
  // `nombre()`, qui en faisait un zéro : elle perdait un point de moral chaque
  // nuit au lieu d'en gagner un, et le bocal ne la remettait jamais d'aplomb.
  const N = require(path.join(ROOT, 'public/minipixiz/nuit.js'));
  const JOUR = N.JOUR;
  const monter = (courant) => {
    const c = P.carteNeuve();
    const fs = F.genererGraine(((s) => () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648)(7));
    fs.$carac = [2, 2, 6, 2, 2, 3];
    fs.$life = 6; fs.$hunger = 20; fs.$moral = 5; fs.$mission = null; fs.$pos = 0;
    c.$faerie = [fs]; c.$current = courant;
    c.$time = { $t: 1000, $d: 10, $s: JOUR - 1 };
    return { c, fs };
  };
  const alea = ((s) => () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648)(5);

  const sansMain = monter(null);
  N.passerLeTemps(sansMain.c, 1000 + 2, alea, 400);
  assert.equal(sansMain.fs.$moral, 6, 'au bocal, la nuit lui rend un point');

  const enMain = monter(0);
  N.passerLeTemps(enMain.c, 1000 + 2, alea, 400);
  assert.equal(enMain.fs.$moral, 4, 'portée, elle s’use — c’est la règle');
});

test('le jeu annonce le compte au lieu de promettre tout', () => {
  // La fée à bout de forces disait « nourrissez-la, elle récupérera cette
  // nuit » — une promesse que la règle ne tient pas.
  // Sans les commentaires : ils CITENT l'ancienne phrase pour expliquer
  // pourquoi elle est partie, et une recherche naïve la retrouverait là.
  const FAERIE = lire('public/minipixiz/faerie.js');
  const code = FAERIE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/elle récupérera cette nuit/.test(code), 'plus de promesse en l’air');
  const f = fee(16, 0);
  const r = f.raisonDeRester();
  assert.match(r, /à hauteur de son ventre/);
  assert.match(r, /5 sur 6/, 'le compte exact : ' + r);
  assert.match(r, /16 de faim/);
  assert.match(r, /\(tous à 20\)/, 'et le remède');

  // Le cadran de santé de l'inventaire dit la même chose, depuis le même
  // calcul : les deux ne peuvent pas se contredire.
  const INV = lire('public/minipixiz/inventaire.js');
  assert.match(INV, /const nuit = fee\.vieDeLaNuit\(\);/);
  assert.match(INV, /la nuit les remonte à hauteur du ventre/);
  assert.ok(!/la nourriture la remettra d'aplomb cette nuit/.test(INV));

  // Et `entretien` applique EXACTEMENT ce qui est annoncé.
  assert.match(FAERIE, /const vieMax = this\.vieDeLaNuit\(\);/);
});
