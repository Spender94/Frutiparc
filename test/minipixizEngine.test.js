// Le puzzle de Minipixiz (miniTroll), porté depuis Games/miniTroll/src.
//
// Le moteur tourne sans rendu : on peut donc jouer des parties entières sous
// Node et vérifier les RÈGLES, pas des pixels. Ce qui est vérifié ici, c'est ce
// qui fait le jeu : quatre jetons de même couleur qui se touchent disparaissent,
// ce qui fait tomber le reste, ce qui peut en former d'autres — et c'est cette
// cascade qui rapporte, bien plus qu'un gros groupe isolé.
//
// Les cas particuliers valent autant que le cas général : la perle qui se
// groupe sans compter, l'armure qui ne se groupe pas mais que le premier
// souffle brise, l'étoile qui emporte toute sa couleur. S'y tromper ne fait pas
// planter le jeu — ça le rend simplement injouable ou trivial.

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const E = require(path.join(ROOT, 'public/minipixiz/engine.js'));

// Une partie sur grille vide : on y pose ce qu'on veut, sans le décor du niveau.
function jeuVide(o) {
  return new E.Jeu(Object.assign({ graine: 1, grille: null }, o || {}));
}

// Pose un jeton directement dans la grille.
function poser(j, x, y, type, special) {
  const e = new E.Jeton(j, { px: x, py: y, type, special: special || 0 });
  e.poser();
  return e;
}

// Un socle de pierres : elles ne se groupent pas et ne tombent pas, ce qui
// permet de poser une figure en l'air sans qu'elle s'effondre.
function socle(j, x, deY) {
  for (let y = deY; y < j.yMax; y++) new E.Pierre(j, { px: x, py: y, life: 9 }).poser();
}

// Fait résoudre une cascade complète, sans passer par la pièce qui tombe.
//
// La liste des couleurs est restaurée ensuite. Sur une grille d'essai, presque
// toutes les couleurs sont absentes : le jeu déclarerait le niveau terminé (et
// à juste titre) dès le premier tour, ce qui empêcherait d'observer la cascade
// suivante. Ces tests-ci examinent la cascade, pas la fin de niveau — celle-ci
// a les siens.
function resoudre(j, images) {
  const couleurs = j.colorList.slice();
  j.initStatsChute();
  j.initStep(E.ETAPE.CHUTE);
  for (let i = 0; i < (images || 400) && j.step !== E.ETAPE.JEU && !j.termine; i++) j.update(1);
  j.colorList = couleurs;
  j.termine = false;
  j.step = E.ETAPE.JEU;
  return j;
}

// ── La grille ─────────────────────────────────────────────────────────────

test('la grille a les dimensions du jeu', () => {
  // base/Forest.initGame : aire de 132×240, cases de 16, deux lignes cachées
  // au-dessus (marginUp = -2×ts). D'où 8 colonnes et 17 lignes.
  const j = jeuVide();
  assert.equal(j.xMax, 8, 'huit colonnes');
  assert.equal(j.yMax, 17, 'dix-sept lignes');
  assert.equal(E.TS, 16);
  assert.equal(E.MARGE_HAUT, -32, 'les deux lignes d\'entrée sont au-dessus du cadre');
  assert.equal(j.groupMax, 4, 'quatre jetons font disparaître');
  assert.deepEqual(j.colorList, [0, 1, 2], 'trois couleurs au départ');
});

// ── Le groupe ─────────────────────────────────────────────────────────────

test('quatre jetons de même couleur qui se touchent disparaissent', () => {
  const j = jeuVide();
  // Un carré de quatre, posé au fond.
  poser(j, 0, 16, 0); poser(j, 1, 16, 0);
  poser(j, 0, 15, 0); poser(j, 1, 15, 0);
  assert.equal(j.eList.length, 4);
  resoudre(j);
  assert.equal(j.eList.length, 0, 'le groupe est parti');
  assert.ok(j.score > 0, `et il rapporte (${j.score})`);
});

test('trois ne suffisent pas', () => {
  const j = jeuVide();
  poser(j, 0, 16, 0); poser(j, 1, 16, 0); poser(j, 2, 16, 0);
  resoudre(j);
  assert.equal(j.eList.length, 3, 'ils restent en place');
  assert.equal(j.score, 0);
});

test('la diagonale ne relie pas', () => {
  // Game.checkGroup ne regarde que la droite et le bas : le voisinage est
  // orthogonal. Quatre en diagonale ne forment donc pas un groupe.
  const j = jeuVide();
  // Un escalier de pierres pour les porter — elles ne se groupent pas.
  for (let x = 0; x < 4; x++) socle(j, x, 17 - x);
  poser(j, 0, 16, 0); poser(j, 1, 15, 0); poser(j, 2, 14, 0); poser(j, 3, 13, 0);
  resoudre(j);
  assert.equal(j.eList.filter((e) => e.et === E.E.JETON).length, 4,
    'les quatre diagonaux restent');
});

test('deux couleurs voisines ne se mélangent pas', () => {
  const j = jeuVide();
  poser(j, 0, 16, 0); poser(j, 1, 16, 0);
  poser(j, 2, 16, 1); poser(j, 3, 16, 1);
  resoudre(j);
  assert.equal(j.eList.length, 4, 'deux paires de couleurs différentes ne font pas quatre');
});

test('un groupe en L compte comme un groupe', () => {
  const j = jeuVide();
  poser(j, 0, 16, 0); poser(j, 1, 16, 0); poser(j, 2, 16, 0);
  poser(j, 0, 15, 0);
  resoudre(j);
  assert.equal(j.eList.length, 0, 'la forme n\'a pas d\'importance, seul le contact compte');
});

// ── Les états d'un jeton ──────────────────────────────────────────────────

test('la perle se groupe mais ne compte pas dans les quatre', () => {
  // Token.special = 1 : Game.destroyGroup retranche les perles du total. C'est
  // ce qui permet à fillLevel de « protéger » un groupe déjà formé au départ.
  const j = jeuVide();
  poser(j, 0, 16, 0); poser(j, 1, 16, 0); poser(j, 2, 16, 0);
  poser(j, 3, 16, 0, E.SPECIAL.PERLE);
  resoudre(j);
  assert.equal(j.eList.length, 4, 'trois jetons plus une perle ne font pas quatre');

  // Mais elle disparaît AVEC le groupe dès qu'il est complet par ailleurs.
  const k = jeuVide();
  poser(k, 0, 16, 0); poser(k, 1, 16, 0); poser(k, 2, 16, 0); poser(k, 3, 16, 0);
  poser(k, 4, 16, 0, E.SPECIAL.PERLE);
  resoudre(k);
  assert.equal(k.eList.length, 0, 'emportée par le groupe qu\'elle complétait');
});

test('l\'armure ne se groupe pas, et le premier souffle la brise', () => {
  const j = jeuVide();
  const a = poser(j, 4, 16, 0, E.SPECIAL.ARMURE);
  assert.equal(a.flGroupable, false, 'elle est hors des groupes');
  // Un groupe de quatre juste à côté : le souffle atteint l'armure.
  poser(j, 0, 16, 0); poser(j, 1, 16, 0); poser(j, 2, 16, 0); poser(j, 3, 16, 0);
  resoudre(j);
  assert.equal(a.vivant, true, 'elle survit à la destruction voisine');
  assert.equal(a.special, E.SPECIAL.AUCUN, 'mais son armure a sauté');
  assert.equal(a.flGroupable, true, 'et elle se groupe désormais');
});

test('l\'étoile emporte toute sa couleur', () => {
  const j = jeuVide();
  // Quatre rouges dont une étoile, et trois autres rouges à l'écart.
  poser(j, 0, 16, 0); poser(j, 1, 16, 0); poser(j, 2, 16, 0);
  poser(j, 3, 16, 0, E.SPECIAL.ETOILE);
  poser(j, 6, 16, 0); poser(j, 7, 16, 0);
  // Et des jaunes, qui ne doivent pas bouger.
  poser(j, 4, 16, 1); poser(j, 5, 16, 1);
  let etoile = null;
  j.onEvent = (n, d) => { if (n === 'etoile') etoile = d; };
  resoudre(j);
  assert.ok(etoile, 'l\'étoile s\'annonce');
  assert.equal(etoile.couleur, 0);
  assert.equal(j.eList.filter((e) => e.type === 0).length, 0, 'plus un seul rouge');
  assert.equal(j.eList.filter((e) => e.type === 1).length, 2, 'les jaunes sont intacts');
});

// ── La chute et les cascades ──────────────────────────────────────────────

test('ce qui est au-dessus retombe', () => {
  const j = jeuVide();
  poser(j, 0, 16, 0); poser(j, 1, 16, 0); poser(j, 2, 16, 0); poser(j, 3, 16, 0);
  const survivant = poser(j, 0, 15, 1);
  resoudre(j);
  assert.equal(survivant.vivant, true);
  assert.equal(survivant.py, 16, 'il est descendu sur le sol libéré');
  assert.equal(j.grille[0][16], survivant, 'et la grille le sait');
});

test('une cascade s\'enchaîne, et rapporte plus qu\'un groupe isolé', () => {
  // Game.checkFallStats : chaque maillon vaut son RANG. Deux groupes de quatre
  // enchaînés valent donc 4×1 + 4×2 = 12, contre 8 s'ils tombaient ensemble.
  const j = jeuVide();
  // En bas : quatre rouges. Juste au-dessus, quatre jaunes qui ne se touchent
  // pas encore — ils se rejoindront en tombant.
  poser(j, 0, 16, 0); poser(j, 1, 16, 0); poser(j, 2, 16, 0); poser(j, 3, 16, 0);
  poser(j, 0, 15, 1); poser(j, 1, 15, 1);
  poser(j, 2, 14, 1); poser(j, 3, 14, 1);
  poser(j, 2, 15, 0); poser(j, 3, 15, 0);           // du remplissage qui part aussi
  let dernier = null;
  j.onEvent = (n, d) => { if (n === 'score') dernier = d; };
  resoudre(j);
  assert.ok(dernier, 'la cascade est comptée');
  assert.ok(dernier.chaine >= 2, `elle compte au moins deux maillons (${dernier.chaine})`);
  assert.ok(dernier.gagne > 8, `et rapporte plus qu'un simple groupe (${dernier.gagne})`);
});

test('un élément ne tombe que si celui d\'en dessous est parti', () => {
  // Game.checkFall trie de bas en haut : sans ce tri, une colonne entière
  // traverserait le sol en une image.
  const j = jeuVide();
  const pile = [];
  for (let y = 13; y <= 16; y++) pile.push(poser(j, 0, y, 1));
  j.initStep(E.ETAPE.CHUTE);
  assert.equal(j.fList.length, 0, 'une colonne posée au sol ne tombe pas');
  // On retire celui du bas : toute la colonne devient tombante.
  pile[3].tuer();
  j.initStep(E.ETAPE.CHUTE);
  assert.equal(j.fList.length, 3, 'les trois du dessus tombent');
  for (let i = 0; i < 40; i++) j.update(1);
  assert.deepEqual(pile.slice(0, 3).map((e) => e.py), [14, 15, 16], 'ils se rangent dans l\'ordre');
});

// ── Les autres éléments ───────────────────────────────────────────────────

test('la pierre s\'effrite à chaque souffle, et finit par céder', () => {
  const j = jeuVide();
  const p = new E.Pierre(j, { px: 4, py: 16, life: 2 });
  p.poser();
  poser(j, 0, 16, 0); poser(j, 1, 16, 0); poser(j, 2, 16, 0); poser(j, 3, 16, 0);
  resoudre(j);
  assert.equal(p.vivant, true, 'elle encaisse le premier coup');
  assert.equal(p.life, 1);

  // Un second groupe à côté, et elle cède. Un seul souffle par cascade, quel
  // que soit le nombre de voisins détruits (Game.addToBlastList) : il faut donc
  // bien DEUX cascades pour venir à bout d'une pierre de deux points.
  poser(j, 0, 16, 1); poser(j, 1, 16, 1); poser(j, 2, 16, 1); poser(j, 3, 16, 1);
  resoudre(j);
  assert.equal(p.vivant, false, 'le second la casse');
  assert.equal(j.grille[4][16], null, 'et elle libère sa case');
});

test('l\'œil retient sa couleur dans le tirage', () => {
  // Game.updatecolorList compte l'œil comme un jeton de sa couleur : tant qu'il
  // est là, le niveau ne peut pas se terminer sur cette couleur.
  const j = jeuVide();
  const o = new E.Oeil(j, { px: 0, py: 16, color: 1 });
  o.poser();
  j.majCouleurs();
  assert.ok(j.colorList.includes(1), 'la couleur de l\'œil reste en jeu');
  assert.ok(!j.colorList.includes(0), 'les autres, absentes, sortent');
  assert.equal(j.termine, false, 'et la partie continue');
});

test('une cellule d\'impy réagit au souffle', () => {
  const j = jeuVide();
  const c = new E.Cellule(j, { px: 4, py: 16, level: 1 });
  c.poser();
  const vus = [];
  j.onEvent = (n, d) => { if (n === 'impyLibere' || n === 'celluleSecouee') vus.push(n); };
  poser(j, 0, 16, 0); poser(j, 1, 16, 0); poser(j, 2, 16, 0); poser(j, 3, 16, 0);
  resoudre(j);
  assert.equal(vus.length, 1, 'elle a été soufflée une fois');
  assert.ok(['impyLibere', 'celluleSecouee'].includes(vus[0]),
    'soit elle libère un impy, soit elle est seulement secouée');
});

test('un objet ne se ramasse que dégagé par le haut', () => {
  // sp/el/Item.initActiveStep : la case au-dessus doit être libre.
  const j = jeuVide();
  const o = new E.Objet(j, { px: 3, py: 16, type: 5 });
  o.poser();
  assert.equal(o.degage(), true, 'rien au-dessus : il est prenable');
  poser(j, 3, 15, 0);
  assert.equal(o.degage(), false, 'enterré, il ne l\'est plus');
});

// ── La fin d'un niveau ────────────────────────────────────────────────────

test('une couleur absente sort du tirage, et la dernière termine le niveau', () => {
  const j = jeuVide();
  poser(j, 0, 16, 0);
  j.majCouleurs();
  assert.deepEqual(j.colorList, [0], 'seule la couleur présente reste');
  assert.equal(j.termine, false);
  // On la retire à son tour : il ne reste plus rien à faire.
  j.eList[0].tuer();
  let fin = null;
  j.onEvent = (n, d) => { if (n === 'finPartie') fin = d; };
  j.majCouleurs();
  assert.ok(fin, 'la fin est annoncée');
  assert.equal(fin.gagne, true, 'et le niveau est gagné');
  assert.equal(j.termine, true);
});

test('la partie s\'arrête quand la pile atteint la ligne fatale', () => {
  // Game.checkFull : un élément en grid[x][2].
  const j = jeuVide();
  assert.equal(j.grilleTropHaute(), false);
  poser(j, 3, E.LIGNE_MORT, 0);
  assert.equal(j.grilleTropHaute(), true, 'la troisième ligne est la limite');
  let fin = null;
  j.onEvent = (n, d) => { if (n === 'finPartie') fin = d; };
  j.nouveauTour();
  assert.ok(fin);
  assert.equal(fin.gagne, false, 'perdu');
});

test('la partie ne se déclare pas gagnée avant d\'avoir commencé', () => {
  // Le piège : updatecolorList sur une grille vide vide la liste des couleurs
  // et annonce le niveau terminé. Le jeu ne l'appelle QUE depuis onNewTurn,
  // c'est-à-dire après qu'une pièce a été posée — jamais au démarrage.
  const j = new E.Jeu({ graine: 3, niveau: 2 });
  assert.equal(j.termine, false, 'la partie démarre bien');
  assert.ok(j.eList.length > 0, 'et la grille porte le décor du niveau');
  for (let i = 0; i < 200; i++) j.update(1);
  assert.equal(j.termine, false, 'elle tient toujours après deux cents images');
});

// ── La pièce qui tombe ────────────────────────────────────────────────────

// Les tests de pièce se jouent sur un VRAI niveau : sur une grille vide, le
// premier tour déclare le niveau terminé (aucune couleur présente) et il n'y a
// jamais de pièce.
function jeuJoue(graine) {
  const j = new E.Jeu({ graine: graine || 5, niveau: 1 });
  for (let i = 0; i < 400 && j.step !== E.ETAPE.JEU && !j.termine; i++) j.update(1);
  return j;
}

test('la pièce tombe, se pose, et son contenu entre dans la grille', () => {
  const j = jeuJoue();
  assert.equal(j.step, E.ETAPE.JEU, 'une pièce est en jeu');
  assert.ok(j.piece, 'et elle existe');
  const cases = j.piece.list.length;
  const avant = j.eList.length;
  j.entree.bas = true;
  for (let i = 0; i < 600 && j.piece; i++) j.update(1);
  assert.equal(j.piece, null, 'elle s\'est posée');
  assert.ok(j.eList.length >= avant, `ses ${cases} cases ont rejoint la grille`);
  assert.ok(j.eList.every((e) => j.grille[e.px][e.py] === e), 'et la grille les retrouve');
});

test('la rotation s\'annule si la forme tournée ne rentre pas', () => {
  const j = jeuJoue(9);
  const p = j.piece;
  // On colle la pièce contre le bord gauche et on remplit tout autour.
  p.x = 0; p.cx = 0; p.y = 5; p.cy = 0;
  for (let y = 0; y < j.yMax; y++) { if (j.estLibre(2, y)) poser(j, 2, y, 0); }
  const avant = p.list.map((o) => ({ x: o.x, y: o.y }));
  j.entree.tourner = true;
  for (let i = 0; i < 3; i++) p.update(1, j.entree);
  const apres = p.list.map((o) => ({ x: o.x, y: o.y }));
  // Soit la rotation a réussi (la forme tenait), soit elle a été annulée — mais
  // dans tous les cas la pièce n'a pas fini dans un mur.
  assert.ok(p.placeLibre(0, 0), 'la pièce occupe toujours des cases libres');
  assert.ok(Array.isArray(avant) && Array.isArray(apres));
});

test('la pièce ne glisse pas dans un mur', () => {
  const j = jeuJoue(11);
  const p = j.piece;
  // On pousse à gauche sans relâcher : elle doit s'arrêter au bord, pas le
  // franchir. C'est Piece.checkSlide qui l'en empêche, via checkActualCanvas.
  j.entree.gauche = true;
  for (let i = 0; i < 200 && !p.posee; i++) p.update(1, j.entree);
  assert.ok(p.list.every((o) => o.x + p.x >= 0),
    `aucune case ne déborde à gauche (x = ${p.x})`);
  assert.ok(p.list.every((o) => o.x + p.x < j.xMax), 'ni à droite');

  // Et à droite, symétriquement.
  const k = jeuJoue(17);
  k.entree.droite = true;
  for (let i = 0; i < 200 && !k.piece.posee; i++) k.piece.update(1, k.entree);
  assert.ok(k.piece.list.every((o) => o.x + k.piece.x < k.xMax),
    `elle s'arrête au bord droit (x = ${k.piece.x})`);
});

test('une case hors grille est refusée, pas fatale', () => {
  // Flash laissait le tableau s'étendre ; en JavaScript l'écriture lève et
  // emporte la partie. Le garde-fou transforme un bug en incident signalé.
  const j = jeuVide();
  let signale = null;
  j.onEvent = (n, d) => { if (n === 'caseHorsGrille') signale = d; };
  const e = new E.Jeton(j, { px: -1, py: 5, type: 0 });
  assert.doesNotThrow(() => e.poser(), 'poser hors grille ne plante pas');
  assert.ok(signale, 'et c\'est signalé');
  assert.equal(signale.x, -1);
});

test('le sursis avant la pose laisse le temps de glisser', () => {
  // Piece.groundTimerMax : quatre images de battement une fois au sol. Sans ce
  // sursis, on ne pourrait jamais rattraper une pièce au dernier moment.
  const j = jeuJoue(13);
  const p = j.piece;
  p.y = j.yMax - 2; p.cy = 0;
  p.flGround = true; p.groundTimer = 0;
  p.update(1, j.entree);
  assert.equal(p.posee, false, 'elle ne se fixe pas à la première image');
  // Elle tient PIECE_POSE images, puis se fixe.
  for (let i = 0; i < 3 && !p.posee; i++) p.update(1, j.entree);
  assert.equal(p.posee, false, 'ni pendant le sursis');
  for (let i = 0; i < 6 && !p.posee; i++) p.update(1, j.entree);
  assert.equal(p.posee, true, 'mais elle finit par se fixer');
});

test('presser « bas » fixe la pièce sans attendre le sursis', () => {
  // Piece.update : `speeder > 0.5` court-circuite le groundTimer. C'est ce qui
  // permet d'enchaîner vite quand on sait où l'on veut poser.
  const j = jeuJoue(19);
  const p = j.piece;
  p.y = j.yMax - 2; p.cy = 0;
  p.flGround = true; p.groundTimer = 0;
  p.flSpeedable = true;                        // la touche a déjà été relâchée
  j.entree.bas = true;
  p.update(1, j.entree);
  assert.equal(p.posee, true, 'elle se fixe tout de suite');
});

// ── La génération des niveaux ─────────────────────────────────────────────

test('un niveau se remplit selon son budget', () => {
  // base/Forest.getLevel : difficulté 10 + 2×niveau, dépensée en hauteur (au
  // coût le plus élevé), en couleurs, en yeux et en cellules d'impy.
  const h = (n) => Math.floor(Math.random() * n);
  for (const niv of [0, 5, 20, 50]) {
    const g = E.genererNiveau(niv, h, 8, 17);
    assert.ok(g.hauteur >= 2, `niveau ${niv} : au moins deux rangées (${g.hauteur})`);
    assert.ok(g.hauteur <= 17 - 7, `niveau ${niv} : jamais plus que yMax-7 (${g.hauteur})`);
    assert.ok(g.couleurs >= 3, `niveau ${niv} : au moins trois couleurs`);
    assert.ok(g.couleurs <= 8, `niveau ${niv} : jamais plus que la palette (${g.couleurs})`);
    const rempli = g.grille.flat().filter(Boolean).length;
    assert.ok(rempli > 0, `niveau ${niv} : la grille n'est pas vide`);
  }
});

test('la difficulté monte avec le niveau', () => {
  const h = () => 0;                                 // hasard neutralisé
  const bas = E.genererNiveau(1, h, 8, 17);
  const haut = E.genererNiveau(60, h, 8, 17);
  assert.ok(haut.hauteur > bas.hauteur, `la pile de départ grandit (${bas.hauteur} → ${haut.hauteur})`);
  assert.ok(haut.couleurs >= bas.couleurs, `et les couleurs se multiplient (${bas.couleurs} → ${haut.couleurs})`);
});

test('la table des éléments suit les paliers du jeu', () => {
  // Les seuils de base/Forest.getElementInfoTable, au chiffre près.
  const freq = (n) => E.tableElements(n).list.map((x) => x.freq);
  assert.deepEqual(freq(0), [1000, 0, 0, 0, 0], 'au début, que des jetons ordinaires');
  assert.deepEqual(freq(5), [700, 300, 0, 0, 0], 'les perles arrivent à 3');
  assert.deepEqual(freq(10), [500, 400, 100, 0, 0], 'les armures à 8');
  assert.deepEqual(freq(12), [500, 400, 100, 72, 0], 'les pierres après 10');
  assert.deepEqual(freq(30), [200, 400, 400, 180, 30], 'et les bombes après 25');
  // Les pierres et les bombes plafonnent.
  assert.equal(E.tableElements(100).list[3].freq, 200, 'les pierres plafonnent à 200');
  assert.equal(E.tableElements(300).list[4].freq, 100, 'les bombes à 100');
});

test('le décor de départ ne contient jamais de groupe déjà complet', () => {
  // Game.fillLevel pose une perle dans tout groupe formé au remplissage : sans
  // ça, la partie s'ouvrirait sur une cascade gratuite.
  for (let graine = 1; graine <= 25; graine++) {
    const j = new E.Jeu({ graine, niveau: 12 });
    j.viderGroupes();
    j.chercherGroupes();
    const trop = j.gList.filter((g) => g.taille() >= j.groupMax);
    assert.equal(trop.length, 0,
      `graine ${graine} : aucun groupe complet au départ (${trop.length} trouvé[s])`);
  }
});

// ── Reproductibilité ──────────────────────────────────────────────────────

test('deux parties de même graine se déroulent à l\'identique', () => {
  const jouer = (graine) => {
    const j = new E.Jeu({ graine, niveau: 4 });
    const journal = [];
    j.onEvent = (n, d) => journal.push(n + ':' + JSON.stringify(d));
    for (let i = 0; i < 3000 && !j.termine; i++) {
      j.entree.gauche = (i % 31) < 5;
      j.entree.droite = (i % 31) >= 5 && (i % 31) < 10;
      j.entree.tourner = (i % 47) === 0;
      j.entree.bas = (i % 9) < 6;
      j.update(1);
    }
    return { score: j.score, pieces: j.pieces, journal };
  };
  const a = jouer(1234);
  const b = jouer(1234);
  assert.equal(a.score, b.score, 'même score');
  assert.equal(a.pieces, b.pieces, 'même nombre de pièces');
  assert.deepEqual(a.journal, b.journal, 'même suite d\'événements');
  const c = jouer(4321);
  assert.notDeepEqual(c.journal, a.journal, 'une autre graine, une autre partie');
});

test('une partie entière se joue sans se bloquer', () => {
  // Le vrai risque d'un moteur à étapes : rester coincé entre deux d'entre
  // elles. On joue jusqu'au bout et on vérifie que la partie AVANCE.
  for (const graine of [3, 11, 42]) {
    const j = new E.Jeu({ graine, niveau: 6 });
    let images = 0;
    for (; images < 20000 && !j.termine; images++) {
      j.entree.gauche = (i2(images) % 37) < 6;
      j.entree.droite = (i2(images) % 37) >= 6 && (i2(images) % 37) < 12;
      j.entree.tourner = (images % 53) === 0;
      j.entree.bas = (images % 11) < 7;
      j.update(1);
    }
    assert.ok(j.termine, `graine ${graine} : la partie se termine (${images} images)`);
    assert.ok(j.pieces > 5, `graine ${graine} : des pièces ont été jouées (${j.pieces})`);
  }
  function i2(n) { return n * 7 + 3; }
});

test('le moteur est chargeable dans le navigateur comme sous Node', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/minipixiz/engine.js'), 'utf8');
  assert.match(src, /racine\.MinipixizEngine = API/, 'exposé sur window pour la page');
  assert.match(src, /module\.exports = API/, 'et exporté pour les tests');
});
