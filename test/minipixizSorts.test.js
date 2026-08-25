/*
 * Minipixiz — la fée sur le plateau et ses sorts.
 *
 * Ce qui se vérifie ici n'est pas « le sort fait joli » mais « le sort REND LA
 * MAIN ». Un sort qui ne se termine pas fige la partie pour de bon : le puzzle
 * attend à l'étape MAGIE et le joueur n'a plus qu'à recharger. C'est le risque
 * propre à ce fichier, et c'est le premier test.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const E = require('../public/minipixiz/engine.js');
const C = require('../public/minipixiz/combat.js');
const S = require('../public/minipixiz/sorts.js');
const F = require('../public/minipixiz/faerie.js');

// Un tirage reproductible, pour que l'échec d'un test soit rejouable.
function tirage(graine) {
  let s = graine;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

function fee(opts) {
  const o = opts || {};
  const alea = tirage(o.graine || 7);
  const fs = F.genererGraine(alea);
  fs.$level = o.niveau === undefined ? 12 : o.niveau;
  fs.$carac = o.carac || [4, 4, 4, 4, 4, 8];
  fs.$life = o.vie === undefined ? 4 : o.vie;
  fs.$mana = o.mana === undefined ? 16 : o.mana;
  fs.$spell = o.sorts || [20];
  return new F.Fee(fs, alea, { $inv: [] });
}

function partie(opts) {
  const o = opts || {};
  const fi = o.fee || fee(o);
  const jeu = new E.Jeu({ graine: o.graine || 3, niveau: o.niveau || 30 });
  const champ = new C.Champ(jeu, { fee: fi });
  for (let i = 0; i < (o.impys || 0); i++) champ.naitreImpy(i % 5, 25 + i * 25, 60);
  return { jeu, champ, fi, f: champ.faerieList[0] };
}

// ── Le modèle de grille ───────────────────────────────────────────────────

test('le modèle ne retient que les jetons groupables', () => {
  const jeu = new E.Jeu({ graine: 3, niveau: 24 });
  jeu.eList.slice().forEach((e) => e.tuer());
  jeu.genElement(E.E.JETON, 0, 16, 0);
  jeu.genElement(E.E.JETON, 1, 16, 2);        // armure : elle ne se groupe pas
  jeu.genElement(E.E.PIERRE, 2, 16, 3);
  const m = jeu.modeleGrille();
  assert.ok(m[0][16], 'le jeton ordinaire est dans le modèle');
  assert.equal(m[1][16], null, 'l\'armure en est exclue');
  assert.equal(m[2][16], null, 'la pierre n\'y est pas non plus');
});

test('scoreModele ne compte que les groupes qui sauteraient', () => {
  const jeu = new E.Jeu({ graine: 3, niveau: 24 });
  jeu.eList.slice().forEach((e) => e.tuer());
  // Trois jetons de la même couleur : pas assez.
  for (let x = 0; x < 3; x++) {
    const e = jeu.genElement(E.E.JETON, x, 16, 0);
    e.type = 0;
  }
  assert.equal(jeu.scoreModele(jeu.evaluerModele(jeu.modeleGrille()).gList), 0);
  const e = jeu.genElement(E.E.JETON, 3, 16, 0);
  e.type = 0;
  assert.equal(jeu.scoreModele(jeu.evaluerModele(jeu.modeleGrille()).gList), 4 * 50,
    'quatre jetons reliés valent quatre fois cinquante');
});

test('une perle appartient au groupe mais ne le fait pas sauter', () => {
  const jeu = new E.Jeu({ graine: 3, niveau: 24 });
  jeu.eList.slice().forEach((e) => e.tuer());
  for (let x = 0; x < 4; x++) {
    const e = jeu.genElement(E.E.JETON, x, 16, x === 0 ? 1 : 0);
    e.type = 0;
  }
  assert.equal(jeu.scoreModele(jeu.evaluerModele(jeu.modeleGrille()).gList), 0,
    'trois jetons ordinaires et une perle : le groupe ne part pas');
});

test('hauteurMax et coefRemplissage lisent la grille', () => {
  const jeu = new E.Jeu({ graine: 3, niveau: 24 });
  jeu.eList.slice().forEach((e) => e.tuer());
  assert.equal(jeu.hauteurMax(), jeu.yMax, 'une grille vide n\'a pas de sommet');
  assert.equal(jeu.coefRemplissage(), 0);
  jeu.genElement(E.E.JETON, 2, 5, 0);
  assert.equal(jeu.hauteurMax(), 5);
  assert.ok(jeu.coefRemplissage() > 0);
});

// ── Le catalogue ──────────────────────────────────────────────────────────

test('les vingt-cinq sorts se construisent, et rien d\'autre', () => {
  const ids = Object.keys(S.CLASSES).map(Number);
  assert.equal(ids.length, 25);
  for (const id of ids) {
    const s = S.nouveauSort(id, null);
    assert.ok(s, 'sort ' + id);
    assert.equal(s.sid, id);
    assert.ok(s.nom().length > 0, 'sort ' + id + ' a un nom');
    assert.ok(s.description().length > 0, 'sort ' + id + ' a une description');
  }
  assert.equal(S.nouveauSort(99, null), null, 'un identifiant inconnu ne donne rien');
});

test('le coût porté est celui de la classe, pas celui de la table', () => {
  // Les deux sources du jeu d'origine ne disent pas la même chose, et c'est
  // voulu : `Spell.spellList.cost` sert UNIQUEMENT à savoir si une fée peut
  // apprendre le sort (getRandomId : carac[MANA]×2 ≥ cost), tandis que le mana
  // réellement dépensé est celui que la classe se donne dans son constructeur.
  // Trois sorts en profitent pour être plus chers à apprendre qu'à lancer —
  // ou l'inverse.
  const ecarts = [];
  for (const o of S.TABLE) {
    const s = S.nouveauSort(o.id, null);
    if (s && s.cout !== o.cost) ecarts.push(o.id + ':' + s.cout + '≠' + o.cost);
  }
  assert.deepEqual(ecarts, ['1:1≠2', '2:2≠1', '4:2≠3'],
    'les trois écarts connus, et pas un de plus');
  // Tous les autres concordent, ce qui vaut vérification de la table entière.
  for (const o of S.TABLE) {
    const s = S.nouveauSort(o.id, null);
    if (s && [1, 2, 4].indexOf(o.id) < 0) assert.equal(s.cout, o.cost, 'coût du sort ' + o.id);
  }
});

test('les huit tirs sont des tirs, les dix-sept autres des sorts de tour', () => {
  let tirs = 0, sorts = 0;
  for (const id of Object.keys(S.CLASSES).map(Number)) {
    if (S.nouveauSort(id, null).flTir) tirs++; else sorts++;
  }
  assert.equal(tirs, 8);
  assert.equal(sorts, 17);
});

test('getRandomId ne propose que ce que la fée peut porter et payer', () => {
  // Une fée de niveau 0 avec un seul point de mana : presque rien ne lui est
  // accessible, et surtout pas le Météore (niveau 12, coût 6).
  const jeune = fee({ niveau: 0, carac: [1, 1, 1, 1, 1, 1] });
  const vus = new Set();
  const alea = tirage(5);
  for (let i = 0; i < 400; i++) vus.add(S.idAleatoire(jeune, (n) => Math.floor(alea() * n)));
  for (const id of vus) {
    const o = S.TABLE.find((t) => t.id === id);
    assert.ok(o, 'identifiant connu : ' + id);
    assert.ok(o.min <= 0, 'sort ' + id + ' accessible au niveau 0');
    assert.ok(o.cost <= 2, 'sort ' + id + ' payable avec un point de mana');
  }
  assert.ok(vus.size >= 3, 'elle a tout de même le choix');
});

// ── Aucun sort ne fige la partie ──────────────────────────────────────────

test('les dix-sept sorts se lancent et rendent la main', () => {
  const bloques = [];
  for (const sid of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]) {
    for (const impys of [0, 3]) {
      const { jeu, f } = partie({ sorts: [20, sid], impys });
      let i = 0;
      while (jeu.step !== E.ETAPE.JEU && i++ < 3000) jeu.update(1);
      const s = f.sortList[0];
      s.pertinence();                      // plusieurs sorts y préparent leur coup
      s.ranger();
      jeu.initStep(E.ETAPE.MAGIE);
      let images = 0;
      while (jeu.saList.length > 0 && images < 4000) { jeu.update(1); images++; }
      if (jeu.saList.length > 0) bloques.push(s.nom() + ' (' + impys + ' impys)');
      // Et la partie doit continuer de tourner après.
      for (let n = 0; n < 1500 && !jeu.termine; n++) {
        if (jeu.step === E.ETAPE.JEU) jeu.entree.bas = (n % 4) < 2;
        jeu.update(1);
      }
    }
  }
  assert.deepEqual(bloques, [], 'aucun sort ne doit garder la main');
});

test('chaque sort sait dire ce qu\'il vaut, sans jamais toucher la grille', () => {
  const { jeu, f } = partie({ sorts: [20, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16] });
  const avant = jeu.eList.map((e) => e.et + ':' + e.px + ',' + e.py + ':' + e.type);
  for (const s of f.sortList) {
    const r = s.pertinence();
    assert.equal(typeof r, 'number', s.nom() + ' renvoie un nombre');
    assert.ok(isFinite(r), s.nom() + ' ne renvoie pas NaN');
    assert.ok(r >= 0, s.nom() + ' ne renvoie pas de score négatif');
  }
  assert.deepEqual(jeu.eList.map((e) => e.et + ':' + e.px + ',' + e.py + ':' + e.type), avant,
    'la simulation ne déplace rien');
});

// ── L'appel, et le choix ──────────────────────────────────────────────────

test('la fée ne lance rien tant qu\'on ne l\'appelle pas', () => {
  const { jeu, f } = partie({ sorts: [20, 7] });
  f.verifierSort();
  assert.equal(jeu.saList.length, 0, 'sans appel, aucun sort');
  // La touche d'aide n'est SONDÉE que pendant qu'on joue (Game.update, case 2).
  jeu.step = E.ETAPE.JEU;
  jeu.appelerAide();
  assert.equal(jeu.flAide, true);
  f.verifierSort();
  assert.equal(jeu.saList.length, 1, 'appelée, elle en choisit un');
});

test('sans mana, l\'appel échoue', () => {
  const { jeu, f, champ } = partie({ sorts: [20, 7] });
  // L'entrée en partie remplit la réserve (Aventure.new) : on la vide APRÈS.
  f.poserMana(0);
  const dits = [];
  champ.surEvenement = (n, d) => { if (n === 'aide') dits.push(d.ok); };
  assert.equal(f.appelerAide(), false);
  assert.equal(jeu.flAide, false);
  assert.deepEqual(dits, [false]);
});

test('initSorts rabaisse le drapeau : un appel, un sort', () => {
  const { jeu } = partie({ sorts: [20, 7] });
  jeu.step = E.ETAPE.JEU;
  jeu.appelerAide();
  jeu.initSorts();
  assert.equal(jeu.flAide, false);
  const combien = jeu.saList.length;
  jeu.initSorts();
  assert.equal(jeu.saList.length, combien, 'le second tour ne rajoute rien');
});

test('un sort trop cher n\'est pas proposé', () => {
  // Tremblement de terre coûte sept ; avec six de mana, il reste sur l'étagère.
  // (La réserve se remplit à l'entrée en partie — Aventure.new — donc on la
  // pose APRÈS la construction du champ.)
  const { f } = partie({ sorts: [20, 11] });
  f.poserMana(6);
  assert.equal(f.listeDeSorts().length, 0);
  f.poserMana(7);
  assert.equal(f.listeDeSorts().length, 1);
});

test('lancer un sort dépense son mana', () => {
  const { jeu, f } = partie({ sorts: [20, 11] });
  f.poserMana(10);
  const s = f.sortList[0];
  s.pertinence();
  s.ranger();
  jeu.initStep(E.ETAPE.MAGIE);
  jeu.update(1);
  assert.equal(f.mana, 3, 'dix moins les sept du tremblement');
  assert.equal(f.fi.fs.$mana, 3, 'et la fiche suit');
});

test('l\'intelligence resserre le choix vers le meilleur sort', () => {
  // À intelligence 1 le tirage couvre toute la liste ; à 6 il ne prend
  // pratiquement que la tête.
  const sorts = [20, 0, 1, 2, 4, 7, 9, 10, 12, 15];
  const compte = (intel) => {
    const vus = new Set();
    for (let n = 0; n < 60; n++) {
      const { jeu, f } = partie({
        sorts, graine: 3 + n, carac: [4, 4, 4, intel, 4, 8],
      });
      jeu.step = E.ETAPE.JEU;         // la touche d'aide ne s'entend qu'en jeu
      jeu.appelerAide();
      f.verifierSort();
      if (jeu.saList[0]) vus.add(jeu.saList[0].sid);
    }
    return vus.size;
  };
  const bete = compte(1);
  const brillante = compte(6);
  assert.ok(bete > brillante,
    'une fée bête essaie plus de choses (' + bete + ') qu\'une fée brillante (' + brillante + ')');
});

test('un sort en cours est interrompu si un autre part', () => {
  const { jeu, f } = partie({ sorts: [20, 12, 13], mana: 16 });
  const a = f.sortList[0], b = f.sortList[1];
  a.pertinence(); b.pertinence();
  a.ranger();
  jeu.initStep(E.ETAPE.MAGIE);
  jeu.update(1);
  assert.equal(f.sortEnCours, a);
  b.ranger();
  b.lancer();
  assert.equal(f.sortEnCours, b, 'le dernier lancé garde la main');
  assert.equal(jeu.saList.indexOf(a), -1, 'le précédent a été rangé');
});

// ── Ce que les sorts font vraiment ────────────────────────────────────────

test('le Gobeur de perles enlève toutes les perles', () => {
  const { jeu, f } = partie({ sorts: [20, 4] });
  jeu.eList.slice().forEach((e) => e.tuer());
  for (let x = 0; x < 5; x++) jeu.genElement(E.E.JETON, x, 16, 1);
  const s = f.sortList[0];
  assert.ok(s.pertinence() > 0, 'il se sait utile');
  s.ranger();
  jeu.initStep(E.ETAPE.MAGIE);
  for (let i = 0; i < 3000 && jeu.saList.length; i++) jeu.update(1);
  assert.equal(jeu.eList.filter((e) => e.special === 1).length, 0);
  assert.equal(jeu.eList.length, 5, 'les billes restent, seules les perles partent');
});

test('la Dépressurisation retire les armures', () => {
  const { jeu, f } = partie({ sorts: [20, 5] });
  jeu.eList.slice().forEach((e) => e.tuer());
  for (let x = 0; x < 4; x++) jeu.genElement(E.E.JETON, x, 16, 2);
  const s = f.sortList[0];
  assert.ok(s.pertinence() > 0);
  s.ranger();
  jeu.initStep(E.ETAPE.MAGIE);
  for (let i = 0; i < 3000 && jeu.saList.length; i++) jeu.update(1);
  assert.equal(jeu.eList.filter((e) => e.special === 2).length, 0);
  assert.ok(jeu.eList.every((e) => e.flGroupable), 'et elles se groupent de nouveau');
});

test('le Bannissement efface les démons sans toucher la grille', () => {
  const { jeu, champ, f } = partie({ sorts: [20, 14], impys: 4, mana: 8 });
  const billes = jeu.eList.length;
  const s = f.sortList[0];
  assert.ok(s.pertinence() > 0);
  s.ranger();
  jeu.initStep(E.ETAPE.MAGIE);
  for (let i = 0; i < 3000 && jeu.saList.length; i++) jeu.update(1);
  assert.equal(champ.impList.length, 0, 'plus un démon');
  assert.equal(jeu.eList.length, billes, 'et pas une bille perdue');
});

test('le Silence fait taire les démons pour un temps', () => {
  const { jeu, champ, f } = partie({ sorts: [20, 10], impys: 3 });
  const s = f.sortList[0];
  s.pertinence();
  s.ranger();
  jeu.initStep(E.ETAPE.MAGIE);
  for (let i = 0; i < 3000 && jeu.saList.length; i++) jeu.update(1);
  assert.ok(champ.impList.every((i) => i.statut[C.STATUT.SILENCE]), 'tous muets');
  assert.ok(champ.impList.every((i) => i.statutTimer[C.STATUT.SILENCE] > 0),
    'et le silence a une fin');
  assert.equal(s.pertinence(), 0, 'faire taire des muets ne sert plus à rien');
});

test('l\'Exaltation rend la force, puis la reprend', () => {
  const { jeu, f } = partie({ sorts: [20, 8], impys: 2 });
  const force = f.fi.carac[C.FORCE];
  const charges = f.freqDash;
  const s = f.sortList[0];
  s.pertinence();
  s.ranger();
  jeu.initStep(E.ETAPE.MAGIE);
  jeu.update(1);
  assert.equal(f.fi.carac[C.FORCE], force + 5);
  assert.equal(f.freqDash, charges * 20);
  assert.equal(jeu.saList.length, 0, 'elle rend la main tout de suite');
  for (let i = 0; i < 500; i++) jeu.update(1);
  assert.equal(f.fi.carac[C.FORCE], force, 'la fureur retombe');
  assert.equal(f.freqDash, charges);
});

test('la Valse Fossile change une couleur en pierres', () => {
  const { jeu, f } = partie({ sorts: [20, 6] });
  const s = f.sortList[0];
  s.pertinence();
  const couleur = s.best.type;
  const combien = jeu.eList.filter((e) => e.et === E.E.JETON && e.type === couleur).length;
  assert.ok(combien > 0);
  s.ranger();
  jeu.initStep(E.ETAPE.MAGIE);
  for (let i = 0; i < 6000 && jeu.saList.length; i++) jeu.update(1);
  assert.equal(jeu.eList.filter((e) => e.et === E.E.JETON && e.type === couleur).length, 0,
    'la couleur a disparu');
  assert.ok(jeu.eList.filter((e) => e.et === E.E.PIERRE).length >= combien,
    'et autant de pierres l\'ont remplacée');
});

test('l\'Ascension enlève exactement une bille', () => {
  const { jeu, f } = partie({ sorts: [20, 7] });
  const avant = jeu.eList.length;
  const s = f.sortList[0];
  s.pertinence();
  s.ranger();
  jeu.initStep(E.ETAPE.MAGIE);
  for (let i = 0; i < 3000 && jeu.saList.length; i++) jeu.update(1);
  assert.equal(jeu.eList.length, avant - 1);
});

test('le Schème de Dimitri échange deux billes voisines', () => {
  const { jeu, f } = partie({ sorts: [20, 0] });
  const s = f.sortList[0];
  s.pertinence();
  const avant = jeu.eList.length;
  s.ranger();
  jeu.initStep(E.ETAPE.MAGIE);
  const a = s.pair && s.pair[0], b = s.pair && s.pair[1];
  for (let i = 0; i < 3000 && jeu.saList.length; i++) jeu.update(1);
  assert.equal(jeu.eList.length, avant, 'rien n\'est détruit');
  if (a && b) {
    assert.equal(jeu.grille[a.px][a.py], a, 'chacune est bien rangée à sa nouvelle case');
    assert.equal(jeu.grille[b.px][b.py], b);
    assert.equal(Math.abs(a.px - b.px), 1, 'et elles sont toujours voisines');
  }
});

// ── Le vol et le combat ───────────────────────────────────────────────────

test('la maniabilité de la fée sort de sa fiche', () => {
  const lente = partie({ carac: [4, 1, 4, 4, 4, 8] }).f;
  const vive = partie({ carac: [4, 5, 4, 4, 4, 8] }).f;
  assert.ok(vive.speed > lente.speed, 'la rapidité pousse plus fort');
  assert.ok(vive.cTurn > lente.cTurn, 'et fait tourner plus court');
  const faible = partie({ carac: [1, 4, 4, 4, 4, 8] }).f;
  const forte = partie({ carac: [5, 4, 4, 4, 4, 8] }).f;
  assert.ok(forte.freqDash > faible.freqDash, 'la force charge plus souvent');
  assert.ok(forte.impactCharge() > faible.impactCharge(), 'et cogne plus fort');
});

test('elle reste dans l\'aire, y compris au-dessus de la grille', () => {
  const { jeu, f, champ } = partie({});
  jeu.step = E.ETAPE.JEU;
  let minY = 1e9, maxY = -1e9, minX = 1e9, maxX = -1e9;
  for (let i = 0; i < 4000; i++) {
    champ.update(1);
    minX = Math.min(minX, f.x); maxX = Math.max(maxX, f.x);
    minY = Math.min(minY, f.y); maxY = Math.max(maxY, f.y);
  }
  assert.ok(minX >= E.MARGE_GAUCHE, 'jamais à gauche du cadre');
  assert.ok(maxX <= E.LARGEUR, 'jamais dans la colonne de droite');
  assert.ok(minY >= E.MARGE_HAUT, 'elle peut monter dans les deux lignes cachées');
  assert.ok(maxY <= E.HAUTEUR);
  assert.ok(maxY - minY > 60, 'et elle bouge vraiment');
});

test('les huit tirs viennent à bout de trois démons', () => {
  for (const tir of [20, 21, 22, 23, 24, 25, 26, 27]) {
    // La vie au maximum : ce qui se vérifie ici est que chaque tir TUE, pas que
    // la fée survit à ce déroulé-là — le combat est chaotique, et le niveau 30
    // sous la volière change avec la génération (les yeux tirent leur couleur).
    const { jeu, champ, f } = partie({ sorts: [tir], impys: 3, carac: [5, 5, 5, 5, 5, 8], vie: 7 });
    jeu.step = E.ETAPE.JEU;
    for (let i = 0; i < 4000 && champ.impList.length && f.vivant; i++) champ.update(1);
    assert.equal(champ.impList.length, 0, 'le tir ' + tir + ' finit par tuer');
    assert.ok(f.tirCourant, 'et elle sait lequel elle porte');
  }
});

test('un démon mort donne (rang+2)² d\'expérience', () => {
  const { jeu, champ, fi } = partie({});
  jeu.step = E.ETAPE.JEU;
  const imp = champ.naitreImpy(3, 60, 60);
  assert.equal(fi.fs.$exp, 0);
  imp.blesser(10000);
  assert.equal(fi.fs.$exp, 25, 'un démon de rang trois vaut vingt-cinq');
  assert.equal(champ.impList.length, 0);
});

test('une cellule cassée libère un impy sur le plateau', () => {
  const { jeu, champ } = partie({});
  jeu.eList.slice().forEach((e) => e.tuer());
  const cellule = jeu.genElement(E.E.CELLULE, 3, 10, 2);
  assert.equal(champ.impList.length, 0);
  // Le souffle est un tirage à pile ou face : on insiste jusqu'à ce qu'il cède.
  for (let i = 0; i < 40 && champ.impList.length === 0 && cellule.vivant; i++) cellule.souffler();
  assert.equal(champ.impList.length, 1, 'l\'impy est sorti');
  assert.equal(champ.impList[0].level, 2, 'du rang de sa cellule');
  assert.equal(champ.impList[0].x, jeu.posX(3.5), 'au milieu de la case');
});

test('la fée encaisse cœur par cœur, et meurt au dernier', () => {
  const { jeu, champ, f, fi } = partie({ vie: 3 });
  jeu.step = E.ETAPE.JEU;
  f.blesser(100);
  assert.equal(f.life, 2, 'un cœur de moins');
  assert.equal(fi.fs.$life, 2, 'et la fiche suit');
  f.blesser(1000);
  assert.equal(f.vivant, false, 'un gros coup emporte le reste');
  assert.equal(champ.faerieList.length, 0);
});

test('un tir n\'atteint personne hors de l\'étape de jeu', () => {
  const { jeu, champ, f } = partie({});
  const imp = champ.naitreImpy(0, f.x + 1, f.y);
  const santeAvant = imp.health;
  const t = new C.Tir(champ, 'shotLightBall');
  t.x = imp.x; t.y = imp.y; t.ray = 20; t.degats = 50;
  t.ajouterCible(imp);
  t.ajouterA(champ.shotList);
  jeu.step = E.ETAPE.CHUTE;
  t.update(1);
  assert.equal(imp.health, santeAvant, 'pendant une cascade, rien ne touche');
  jeu.step = E.ETAPE.JEU;
  t.update(1);
  assert.ok(imp.health < santeAvant, 'pendant le jeu, si');
});

test('les traînées ne s\'accumulent pas indéfiniment', () => {
  // Le clip d'une traînée s'efface tout seul dans Flash ; sans cette règle, un
  // tir en crée une par image et l'écran finit noyé.
  const { jeu, champ } = partie({ sorts: [23], impys: 2, carac: [5, 5, 5, 5, 5, 8] });
  jeu.step = E.ETAPE.JEU;
  let pointe = 0;
  for (let i = 0; i < 3000; i++) { champ.update(1); pointe = Math.max(pointe, champ.partList.length); }
  assert.ok(pointe < 400, 'la pointe reste raisonnable (' + pointe + ')');
  assert.ok(champ.partList.length < 60, 'et tout finit par se ranger');
});

test('la partie entière tourne sans se figer, la fée appelée à chaque tour', () => {
  const { jeu, champ, fi } = partie({
    sorts: [20, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
    carac: [4, 4, 4, 4, 4, 8], mana: 16, niveau: 24,
  });
  let lances = 0;
  jeu.onEvent = (n) => { if (n === 'sort') lances++; };
  let images = 0;
  for (; images < 40000 && !jeu.termine; images++) {
    if (jeu.step === E.ETAPE.JEU) {
      if (!jeu.flAide) jeu.appelerAide();
      jeu.entree.bas = (images % 4) < 2;
    }
    jeu.update(1);
  }
  assert.ok(jeu.termine, 'la partie va jusqu\'au bout');
  assert.ok(lances > 3, 'et la fée a bien lancé des sorts (' + lances + ')');
  assert.equal(jeu.saList.length, 0, 'aucun sort ne reste en travers');
  assert.ok(fi.fs.$mana >= 0, 'le mana ne passe jamais sous zéro');
});

// ── Les sorts des démons (spell/imp) ──────────────────────────────────────

test('les neuf sorts de démon existent et se lancent sans figer la partie', () => {
  const noms = Object.keys(S.CLASSES_IMPY);
  assert.equal(noms.length, 9);
  const bloques = [];
  for (const nom of noms) {
    for (const rang of [1, 4]) {
      const { jeu, champ } = partie({});
      const imp = champ.naitreImpy(rang, 60, 60);
      let i = 0;
      while (jeu.step !== E.ETAPE.JEU && i++ < 3000) jeu.update(1);
      const s = S.nouveauSortImpy(nom, champ);
      s.lanceur = imp; s.imp = imp;
      s.ranger();
      jeu.initStep(E.ETAPE.MAGIE);
      let images = 0;
      while (jeu.saList.length > 0 && images < 6000) { jeu.update(1); images++; }
      if (jeu.saList.length > 0) bloques.push(nom + ' rang ' + rang);
      // Puis la partie continue, entretien compris — c'est lui qui dissipe
      // plusieurs de ces sorts.
      for (let n = 0; n < 4000 && !jeu.termine; n++) {
        if (jeu.step === E.ETAPE.JEU) {
          jeu.entree.bas = (n % 4) < 2;
          jeu.entree.tourner = (n % 7) < 2;
        }
        jeu.update(1);
      }
    }
  }
  assert.deepEqual(bloques, []);
});

test('un impy ne jette rien tant qu\'il est en réserve, ni s\'il est muet', () => {
  const { jeu, champ } = partie({});
  jeu.step = E.ETAPE.JEU;
  const imp = champ.naitreImpy(4, 60, 60);
  imp.spellCoolDown = 0;
  imp.poserStatut(C.STATUT.SILENCE, true);
  imp.verifierSort();
  assert.equal(jeu.saList.length, 0, 'muet, il se tait');
  imp.poserStatut(C.STATUT.SILENCE, false);
  imp.action = 0;
  imp.verifierSort();
  assert.equal(jeu.saList.length, 0, 'à court d\'actions, il s\'en va plutôt');
});

test('un impy à court d\'actions quitte le niveau par le haut', () => {
  const { jeu, champ } = partie({});
  jeu.step = E.ETAPE.JEU;
  const imp = champ.naitreImpy(0, 60, 200);
  imp.action = 0;
  for (let i = 0; i < 3000 && champ.impList.length; i++) champ.update(1);
  assert.equal(champ.impList.length, 0, 'il est sorti');
});

test('l\'Origine ajoute une couleur, et le niveau ne peut plus se finir sans elle', () => {
  const { jeu, champ } = partie({});
  let i = 0;
  while (jeu.step !== E.ETAPE.JEU && i++ < 3000) jeu.update(1);
  const avant = jeu.colorList.slice();
  const imp = champ.naitreImpy(4, 60, 60);
  const s = S.nouveauSortImpy('Origine', champ);
  s.lanceur = imp; s.imp = imp;
  s.ranger();
  jeu.initStep(E.ETAPE.MAGIE);
  for (let n = 0; n < 6000 && jeu.saList.length; n++) jeu.update(1);
  assert.equal(jeu.colorList.length, avant.length + 1, 'une couleur de plus');
  const neuve = jeu.colorList.find((c) => avant.indexOf(c) < 0);
  assert.ok(neuve !== undefined);
  assert.ok(jeu.eList.some((e) => e.et === E.E.JETON && e.type === neuve),
    'et une bille de cette couleur est apparue');
});

test('les Fils Paralysants empêchent la rotation, jusqu\'à la pièce suivante', () => {
  const { jeu, champ } = partie({});
  let i = 0;
  while (jeu.step !== E.ETAPE.JEU && i++ < 3000) jeu.update(1);
  const imp = champ.naitreImpy(0, 60, 60);
  const s = S.nouveauSortImpy('Lien', champ);
  s.lanceur = imp; s.imp = imp;
  s.ranger();
  jeu.initStep(E.ETAPE.MAGIE);
  jeu.update(1);
  assert.equal(jeu.saList.length, 0, 'il rend la main tout de suite');
  jeu.update(1);
  assert.equal(jeu.piece.flBind, true, 'la pièce est liée');
  const avant = jeu.piece.list.map((o) => o.x + ',' + o.y).join(' ');
  jeu.entree.tourner = true;
  jeu.update(1);
  assert.equal(jeu.piece.list.map((o) => o.x + ',' + o.y).join(' '), avant,
    'et elle ne tourne pas');
  // L'entretien de la pièce suivante coupe les fils.
  jeu.surPiecePosee();
  assert.equal(jeu.sList.indexOf(s), -1, 'le sort s\'est dissipé');
});

test('la Fumée retire le démon, puis le rend au tour suivant', () => {
  const { jeu, champ } = partie({});
  let i = 0;
  while (jeu.step !== E.ETAPE.JEU && i++ < 3000) jeu.update(1);
  const imp = champ.naitreImpy(3, 60, 60);
  const s = S.nouveauSortImpy('Fumee', champ);
  s.lanceur = imp; s.imp = imp;
  s.ranger();
  jeu.initStep(E.ETAPE.MAGIE);
  jeu.update(1);
  assert.equal(champ.impList.length, 0, 'il a disparu');
  jeu.surPiecePosee();
  assert.equal(champ.impList.length, 1, 'et il est revenu');
  assert.equal(champ.impList[0].level, 3, 'du même rang');
});

test('la Nuit Noire éteint le niveau, une seule à la fois', () => {
  const { jeu, champ } = partie({});
  let i = 0;
  while (jeu.step !== E.ETAPE.JEU && i++ < 3000) jeu.update(1);
  const imp = champ.naitreImpy(2, 60, 60);
  const s = S.nouveauSortImpy('Nuit', champ);
  s.lanceur = imp; s.imp = imp;
  s.ranger();
  jeu.initStep(E.ETAPE.MAGIE);
  for (let n = 0; n < 3000 && jeu.saList.length; n++) jeu.update(1);
  assert.ok(jeu.nuit, 'la nuit est tombée');
  assert.equal(jeu.nuit.prc, 100);
  // Un second démon ne peut pas en rajouter une.
  const s2 = S.nouveauSortImpy('Nuit', champ);
  s2.lanceur = imp; s2.imp = imp;
  s2.ranger();
  jeu.initStep(E.ETAPE.MAGIE);
  jeu.update(1);
  assert.equal(jeu.saList.length, 0, 'la seconde se retire aussitôt');
  // Elle dure autant de pièces que le rang du démon.
  jeu.surPiecePosee();
  assert.ok(jeu.nuit, 'encore là après une pièce');
  jeu.surPiecePosee();
  assert.equal(jeu.nuit, null, 'partie après la seconde');
});

test('le Conglomérat impose une pièce énorme', () => {
  const { jeu, champ } = partie({});
  let i = 0;
  while (jeu.step !== E.ETAPE.JEU && i++ < 3000) jeu.update(1);
  const imp = champ.naitreImpy(3, 60, 60);
  const s = S.nouveauSortImpy('Conglomerat', champ);
  s.lanceur = imp; s.imp = imp;
  s.ranger();
  jeu.initStep(E.ETAPE.MAGIE);
  jeu.update(1);
  assert.ok(jeu.nextPiece, 'la pièce suivante est imposée');
  assert.equal(jeu.nextPiece.length, 9, 'six cases plus le rang');
});

test('le Quintal dresse un mur de pierres', () => {
  const { jeu, champ } = partie({});
  let i = 0;
  while (jeu.step !== E.ETAPE.JEU && i++ < 3000) jeu.update(1);
  const avant = jeu.eList.filter((e) => e.et === E.E.PIERRE).length;
  const imp = champ.naitreImpy(4, 60, 60);
  const s = S.nouveauSortImpy('Mur', champ);
  s.lanceur = imp; s.imp = imp;
  s.ranger();
  jeu.initStep(E.ETAPE.MAGIE);
  for (let n = 0; n < 6000 && jeu.saList.length; n++) jeu.update(1);
  assert.ok(jeu.eList.filter((e) => e.et === E.E.PIERRE).length > avant,
    'il y a plus de pierres qu\'avant');
});

// ── Le démon hors vue, et la partie qui ne repartait plus ─────────────────
//
// Trois retours de joueurs, un seul mécanisme : un sort qui attend une
// condition qui n'arrivera jamais garde la main sur la partie POUR DE BON.
// L'étape MAGIE ne rend le puzzle que lorsque saList se vide.

// Un démon qui a fini ses sorts s'en va par le haut. checkBounds l'autorise à
// monter jusqu'à 6 + margeHaut, soit vingt-six pixels AU-DESSUS du cadre : la
// bande cachée où tombent les pièces. Hors de l'étape JEU, rien ne le tue —
// il s'y gare, vivant et invisible.
function demonGare(jeu, champ, x) {
  const imp = champ.naitreImpy(2, x, 60);
  imp.action = 0;
  imp.flForceWay = true;
  imp.trg = { x: jeu.largeur * 0.5, y: -30 };
  imp.x = x;
  imp.y = 6 + jeu.margeHaut;
  imp.vitx = 0;
  imp.vity = 0;
  return imp;
}

test('la bande cachée du haut est bien hors du cadre des billes', () => {
  const jeu = new E.Jeu({ graine: 3, niveau: 30 });
  assert.ok(jeu.margeHaut < 0, 'margeHaut est négatif (deux lignes d\'antichambre)');
  assert.ok(6 + jeu.margeHaut < 10,
    'une créature peut se tenir plus haut que le plafond des billes de lumière');
});

test('les Billes de lumière vont frapper un démon garé hors du cadre', () => {
  for (const graine of [3, 11, 29, 47]) {
    const { jeu, champ, f } = partie({ sorts: [20, 15], graine, carac: [4, 4, 4, 4, 0, 8] });
    let i = 0;
    while (jeu.step !== E.ETAPE.JEU && i++ < 3000) jeu.update(1);
    const imp = demonGare(jeu, champ, jeu.largeur - 20);
    const vie = imp.health;
    const s = f.sortList[0];
    s.pertinence();
    s.ranger();
    jeu.initStep(E.ETAPE.MAGIE);
    let images = 0;
    while (jeu.saList.length > 0 && images < 4000) { jeu.update(1); images++; }
    assert.equal(jeu.saList.length, 0, 'le sort rend la main (graine ' + graine + ')');
    assert.ok(imp.health < vie, 'et le démon a bien encaissé (graine ' + graine + ')');
  }
});

test('les Billes de lumière rendent la main même contre une cible inatteignable', () => {
  const { jeu, champ, f } = partie({ sorts: [20, 15], impys: 0 });
  let i = 0;
  while (jeu.step !== E.ETAPE.JEU && i++ < 3000) jeu.update(1);
  // Un démon qu'on remet de force au plafond à chaque image : la bille ne peut
  // pas le rattraper. Le sort doit renoncer plutôt que de figer la partie.
  const imp = demonGare(jeu, champ, jeu.largeur - 20);
  const s = f.sortList[0];
  s.pertinence();
  s.ranger();
  jeu.initStep(E.ETAPE.MAGIE);
  let images = 0;
  while (jeu.saList.length > 0 && images < 4000) {
    imp.x = jeu.largeur - 20;
    imp.y = 6 + jeu.margeHaut;
    jeu.update(1);
    images++;
  }
  assert.equal(jeu.saList.length, 0, 'le sort finit par rendre la main');
  assert.ok(images < 800, 'et sans faire attendre le joueur (' + images + ' images)');
});

test('un sort dont la fée n\'atteint jamais son point finit tout de même', () => {
  // Gobeur de perles, Dépressurisation, Tranche-Cimes, le Schème : tous
  // commencent par « envoie la fée là-bas et attends ». On cloue la fée sur
  // place : l'attente doit être bornée.
  const bloques = [];
  for (const sid of [0, 1, 4, 5, 9, 10, 11, 13, 14, 16]) {
    const { jeu, champ, f } = partie({ sorts: [20, sid], niveau: 40 });
    let i = 0;
    while (jeu.step !== E.ETAPE.JEU && i++ < 3000) jeu.update(1);
    let n = 0;
    for (const e of jeu.eList) {
      if (e.et !== E.E.JETON || n >= 8) continue;
      e.setSpecial(n % 2 === 0 ? 1 : 2);
      n++;
    }
    const s = f.sortList[0];
    s.pertinence();
    s.ranger();
    jeu.initStep(E.ETAPE.MAGIE);
    const x = f.x, y = f.y;
    let images = 0;
    while (jeu.saList.length > 0 && images < 4000) {
      f.x = x; f.y = y; f.vitx = 0; f.vity = 0;      // elle ne bouge pas d'un pouce
      jeu.update(1);
      images++;
    }
    if (jeu.saList.length > 0) bloques.push(s.nom());
  }
  assert.deepEqual(bloques, [], 'aucun sort ne garde la main sur une fée immobile');
});

test('le garde-fou de l\'étape MAGIE rend la main à un sort qui ne la rend pas', () => {
  const { jeu, f } = partie({ sorts: [20, 12] });
  let i = 0;
  while (jeu.step !== E.ETAPE.JEU && i++ < 3000) jeu.update(1);
  const s = f.sortList[0];
  // Un sort qui ne finit jamais : son étape active ne fait plus rien.
  s.updateActif = () => {};
  let bloque = null;
  jeu.onEvent = (n, d) => { if (n === 'sortBloque') bloque = d; };
  s.ranger();
  jeu.initStep(E.ETAPE.MAGIE);
  let images = 0;
  while (jeu.saList.length > 0 && images < 4000) { jeu.update(1); images++; }
  assert.equal(jeu.saList.length, 0, 'le moteur a repris la main');
  assert.ok(bloque && bloque.nom, 'et il l\'a signalé (' + (bloque && bloque.nom) + ')');
  assert.ok(images > 1000, 'mais seulement après une attente franche (' + images + ')');
  // La partie repart.
  for (let n = 0; n < 600 && !jeu.termine; n++) {
    if (jeu.step === E.ETAPE.JEU) jeu.entree.bas = (n % 4) < 2;
    jeu.update(1);
  }
  assert.notEqual(jeu.step, E.ETAPE.MAGIE, 'et le puzzle a repris son cours');
});

test('patienter se réarme à chaque fois qu\'il aboutit', () => {
  const { jeu, f } = partie({ sorts: [20, 4] });
  const s = f.sortList[0];
  s.attente = 0;
  // Trois cents images d'attente, puis il cède — et le compte repart de zéro,
  // de sorte qu'un sort qui attend plusieurs fois de suite (la Pigmentation
  // saute de bille en bille) reparte à neuf à chaque étape.
  for (let tour = 0; tour < 2; tour++) {
    for (let i = 0; i < 300; i++) assert.equal(s.patienter(false), false, 'tour ' + tour + ', image ' + i);
    assert.equal(s.patienter(false), true, 'il cède à la trois-cent-unième');
    assert.equal(s.attente, 0, 'et le compte est remis à zéro');
  }
  // La condition vraie remet aussi le compte à zéro.
  s.patienter(false);
  assert.equal(s.patienter(true), true);
  assert.equal(s.attente, 0);
});
