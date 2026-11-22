/*
 * Le onzième lot de retours MiniPixiz.
 *
 *   · Les sorts qui prennent la mana et ne font rien à partir du deuxième
 *     lancer. Le sort d'une fée est un objet unique, relancé tel quel ; son
 *     `update` tourne déjà entre le rangement et le lancer, et y lisait les
 *     restes du lancer précédent. Le Météore avait été réparé au dixième lot ;
 *     la Dactylo (`startPiece`) et l'Exaltation (`timer`) avaient la même
 *     faille. La Cloche d'immunité, soupçonnée, ne l'avait pas : sa
 *     dissipation efface sa bulle. Et pour les sorts à venir, un garde-fou :
 *     le champ ne fait plus vivre un sort qui attend son lancer.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const E = require(path.join(ROOT, 'public/minipixiz/engine.js'));
const C = require(path.join(ROOT, 'public/minipixiz/combat.js'));
const S = require(path.join(ROOT, 'public/minipixiz/sorts.js'));
const F = require(path.join(ROOT, 'public/minipixiz/faerie.js'));

function tirage(g) {
  let s = g;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

// ── 2 · Les sorts relancés ────────────────────────────────────────────────
//
// Le décor de minipixizRetours10 (le Météore) : une fée qui ne connaît qu'un
// sort, une grille qui ne se gagne pas en route, trois rangées de pierres au
// fond pour que rien ne s'y groupe.
function partieAuSort(id) {
  const alea = tirage(7);
  const fsd = F.genererGraine(alea);
  fsd.$level = 12; fsd.$carac = [4, 4, 4, 4, 4, 8]; fsd.$life = 4; fsd.$mana = 16; fsd.$spell = [20, id];
  const fi = new F.Fee(fsd, alea, { $inv: [] });
  const jeu = new E.Jeu({ graine: 3, niveau: 30, grille: null, couleursSeVident: false });
  const champ = new C.Champ(jeu, { fee: fi });
  const f = champ.faerieList[0];
  return { jeu, champ, fi, f, s: f.sortList[0] };
}

function poserPierres(jeu) {
  for (const e of jeu.eList.slice()) e.tuer();
  for (let x = 0; x < jeu.xMax; x++) {
    for (let y = jeu.yMax - 3; y < jeu.yMax; y++) jeu.genElement(E.E.PIERRE, x, y, 3);
  }
}
function poserLaPiece(jeu) {
  let n = 0;
  while (jeu.step === E.ETAPE.JEU && n++ < 5000) { jeu.entree.bas = (n % 4) < 2; jeu.update(1); }
  jeu.entree.bas = false;
}
function jusquALaPieceSuivante(jeu) {
  let n = 0;
  while (jeu.step !== E.ETAPE.JEU && n++ < 5000 && !jeu.termine) jeu.update(1);
}
function unePiece(jeu) {
  poserPierres(jeu);
  poserLaPiece(jeu);
  jusquALaPieceSuivante(jeu);
}

// Un démon de rang 0 qui ne fait que voler : l'Exaltation et la Cloche ne
// valent quelque chose qu'en sa présence, mais ses propres sorts brouilleraient
// la mesure.
function demonMuet(champ) {
  const imp = champ.naitreImpy(0, 60, 60);
  imp.action = 5;
  imp.spellCoolDown = 1e9;
  return imp;
}

// Le joueur appelle sa fée pendant le tour ; elle choisit à la fin.
function appeler(jeu, f, tour) {
  poserPierres(jeu);
  f.poserMana(16);
  assert.ok(jeu.appelerAide(), 'tour ' + tour + ' : la fée répond');
  poserLaPiece(jeu);
  jusquALaPieceSuivante(jeu);
}

test('la Dactylo retire une bille À CHAQUE lancer, pas seulement le premier', () => {
  const { jeu, f, s } = partieAuSort(2);
  assert.strictEqual(s.nom(), 'Dactylo');
  const lances = [];
  jeu.onEvent = (nom, d) => { if (nom === 'sort') lances.push(d.nom); };
  jusquALaPieceSuivante(jeu);
  const base = jeu.shapeNumInc;
  const taille = jeu.piece.list.length;

  for (let tour = 1; tour <= 4; tour++) {
    appeler(jeu, f, tour);
    assert.strictEqual(lances.length, tour, 'tour ' + tour + ' : le sort est parti');
    assert.strictEqual(f.mana, 14, 'tour ' + tour + ' : deux de mana dépensés');
    assert.ok(jeu.sList.includes(s), 'tour ' + tour + ' : l\'effet dure'
      + ' (avant le correctif : dissipée avant même son lancer, dès le deuxième)');
    assert.strictEqual(jeu.shapeNumInc, base - 1, 'tour ' + tour + ' : une bille de moins par pièce');
    unePiece(jeu);
    assert.strictEqual(jeu.piece.list.length, taille - 1, 'tour ' + tour + ' : la pièce qui tombe est plus petite');
    // Quatre pièces par point de concentration, puis elle s'en va d'elle-même.
    let n = 0;
    while (jeu.sList.includes(s) && n++ < 40) unePiece(jeu);
    assert.ok(n <= 18, 'tour ' + tour + ' : seize pièces, à peu près, pas davantage (' + n + ')');
    assert.strictEqual(jeu.shapeNumInc, base, 'tour ' + tour + ' : les pièces reprennent leur taille');
    assert.notStrictEqual(f.sortEnCours, s, 'tour ' + tour + ' : la fée n\'a plus de sort en cours');
  }
});

test('rappeler la Dactylo sitôt disponible ne grossit jamais les pièces', () => {
  // Le pire de la panne : restée « sort en cours » après un lancer raté, elle
  // s'interrompait elle-même au lancer suivant — sa dissipation RENDAIT une
  // bille que l'animation coupée ne reprenait jamais. Une de plus par rappel.
  const { jeu, f, s } = partieAuSort(2);
  let lances = 0;
  jeu.onEvent = (nom) => { if (nom === 'sort') lances++; };
  jusquALaPieceSuivante(jeu);
  const base = jeu.shapeNumInc;
  for (let i = 0; i < 150 && lances < 5; i++) {
    if (s.disponible()) appeler(jeu, f, lances + 1);
    else unePiece(jeu);
    assert.ok(jeu.shapeNumInc <= base, 'jamais une bille de plus que la normale : '
      + jeu.shapeNumInc + ' après ' + lances + ' lancers');
  }
  assert.strictEqual(lances, 5, 'cinq lancers');
});

test('ranger la Dactylo efface la trace du lancer précédent', () => {
  // À nu, sans le champ : l'`update` d'un sort rangé ne doit plus voir une
  // `startPiece` échue.
  const { jeu, s } = partieAuSort(2);
  jusquALaPieceSuivante(jeu);
  const base = jeu.shapeNumInc;
  s.startPiece = jeu.pieces - 100;     // ce que laisse un premier lancer, bien plus tôt
  s.ranger();
  s.update(1);
  assert.ok(jeu.sList.includes(s), 'pas dissipée avant son lancer');
  assert.strictEqual(jeu.shapeNumInc, base, 'et aucune bille rendue en trop');
});

test('l\'Exaltation donne sa force À CHAQUE lancer, et la fée charge toujours', () => {
  const { jeu, champ, fi, f, s } = partieAuSort(8);
  assert.strictEqual(s.nom(), 'Exaltation');
  const lances = [];
  jeu.onEvent = (nom, d) => { if (nom === 'sort') lances.push(d.nom); };
  jusquALaPieceSuivante(jeu);
  const imp = demonMuet(champ);
  const force = fi.carac[C.FORCE];
  const charge = f.freqDash;
  assert.ok(charge > 0);

  for (let tour = 1; tour <= 4; tour++) {
    imp.health = 1e9; f.health = 100;
    appeler(jeu, f, tour);
    assert.strictEqual(lances.length, tour, 'tour ' + tour + ' : le sort est parti');
    assert.strictEqual(f.mana, 13, 'tour ' + tour + ' : trois de mana dépensés');
    assert.strictEqual(fi.carac[C.FORCE], force + 5, 'tour ' + tour + ' : cinq de force en plus'
      + ' (avant le correctif : rien, dès le deuxième lancer)');
    assert.strictEqual(f.freqDash, charge * 20, 'tour ' + tour + ' : vingt fois plus de charges');
    assert.ok(jeu.sList.includes(s), 'tour ' + tour + ' : la fureur décompte');
    // Quatre cents images, puis tout revient.
    let n = 0;
    while (jeu.sList.includes(s) && n++ < 40) { imp.health = 1e9; f.health = 100; unePiece(jeu); }
    assert.ok(!jeu.sList.includes(s), 'tour ' + tour + ' : la fureur s\'éteint');
    assert.strictEqual(fi.carac[C.FORCE], force, 'tour ' + tour + ' : la force d\'avant, ni plus ni moins');
    assert.strictEqual(f.freqDash, charge, 'tour ' + tour + ' : la cadence de charge d\'avant'
      + ' (avant le correctif : 15 / 20 arrondi, zéro — plus aucune charge)');
    assert.notStrictEqual(f.sortEnCours, s, 'tour ' + tour + ' : la fée n\'a plus de sort en cours');
  }
});

test('ranger l\'Exaltation efface le chrono échu du lancer précédent', () => {
  const { jeu, fi, f, s } = partieAuSort(8);
  jusquALaPieceSuivante(jeu);
  const force = fi.carac[C.FORCE];
  const charge = f.freqDash;
  s.timer = -0.5;                      // ce que laisse une fureur éteinte
  s.ranger();
  s.update(1);
  assert.ok(jeu.sList.includes(s), 'pas dissipée avant son lancer');
  assert.strictEqual(fi.carac[C.FORCE], force, 'pas cinq de force retirés pour rien');
  assert.strictEqual(f.freqDash, charge, 'ni la cadence de charge divisée');
});

test('la Cloche d\'immunité, elle, tenait déjà à chaque lancer', () => {
  // Soupçonnée de la même faille (sa `bulle`), elle ne l'avait pas : sa
  // dissipation tue la bulle ET l'oublie, et son `update` ne fait rien sans
  // elle. Ce test le garde.
  const { jeu, champ, f, s } = partieAuSort(12);
  assert.strictEqual(s.nom(), 'Cloche d\'immunité');
  const lances = [];
  jeu.onEvent = (nom, d) => { if (nom === 'sort') lances.push(d.nom); };
  jusquALaPieceSuivante(jeu);
  const imp = demonMuet(champ);
  for (let tour = 1; tour <= 3; tour++) {
    imp.health = 1e9; f.health = 100;
    appeler(jeu, f, tour);
    assert.strictEqual(lances.length, tour, 'tour ' + tour + ' : le sort est parti');
    assert.ok(s.bulle && s.bulle.vivant, 'tour ' + tour + ' : la bulle est levée');
    assert.ok(jeu.sList.includes(s), 'tour ' + tour + ' : et elle tient');
    let n = 0;
    while (jeu.sList.includes(s) && n++ < 40) { imp.health = 1e9; f.health = 100; unePiece(jeu); }
    assert.strictEqual(s.bulle, null, 'tour ' + tour + ' : puis elle s\'efface');
    assert.notStrictEqual(f.sortEnCours, s);
  }
});

test('garde-fou : aucun sort ne vit entre son rangement et son lancer', () => {
  // Un sort à venir, qui n'effacerait rien au rangement : il note, à chaque
  // image où il vit, s'il a bien été lancé autant de fois que rangé.
  class Temoin extends S.Sort {
    constructor(c) { super(c); this.cout = 1; this.ranges = 0; this.lances = 0; this.vus = []; }
    ranger() { this.ranges++; super.ranger(); }
    lancer() { this.lances++; super.lancer(); }
    update() { this.vus.push(this.lances === this.ranges); }
    // Il rend la main aussitôt ; son effet dure jusqu'à la pièce suivante.
    initStep(n) { this.step = n; if (n === 0) this.finActif(); }
    surEntretien() { this.dissiper(); }
    nom() { return 'Témoin'; }
  }
  const { jeu, champ, fi, f } = partieAuSort(2);
  const t = new Temoin(champ);
  t.fi = fi; t.lanceur = f; t.sid = 2;
  f.sortList = [t];
  jusquALaPieceSuivante(jeu);
  for (let tour = 1; tour <= 3; tour++) {
    appeler(jeu, f, tour);
    assert.strictEqual(t.lances, tour, 'tour ' + tour + ' : lancé');
    unePiece(jeu);
  }
  assert.ok(t.vus.length > 0, 'il a vécu');
  assert.ok(t.vus.every(Boolean), 'jamais avant son lancer (images vues : '
    + t.vus.filter((v) => !v).length + ' de trop)');
});
