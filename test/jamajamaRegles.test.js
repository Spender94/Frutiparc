/*
 * JamaJama — le moteur de règles (public/jamajama/regles.js), transcrit du
 * SWF décompilé. Ces tests tiennent les mécaniques qui portent le score et
 * la validation des replays : le codec des niveaux, le compteur de coups,
 * les passes fantôme, les fusions, l'eau, les bombes, les aimants, les sens
 * uniques. Les niveaux témoins sont ceux du TutorialPack, gravés dans le
 * SWF — si le codec les relit mal, rien d'autre ne tient.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const R = require(path.join(__dirname, '..', 'public/jamajama/regles.js'));
const { Direction, Element, Chunker, Level, Replay, Partie } = R;

// Fabrique un niveau de toutes pièces : `elements` = [id, x, y, param, orient].
function niveau(largeur, hauteur, depart, elements) {
  const l = new Level();
  l.version = 1;
  l.startPos.x = depart[0];
  l.startPos.y = depart[1];
  l.size.width = largeur;
  l.size.height = hauteur;
  for (const [id, x, y, param, orient] of elements) {
    const e = new Element(null);
    e.id = id;
    e.pos.x = x;
    e.pos.y = y;
    e.param = param === undefined ? -1 : param;
    e.orientation = orient || 0;
    l.tiles.push(e);
  }
  return l;
}

test('le codec : l’alphabet ampute le grand H, le moins porte le négatif', () => {
  assert.equal(Chunker.CHARS.indexOf('H'), -1, 'coquille d’origine : pas de H majuscule');
  assert.equal(Chunker.CHARS.indexOf('G'), 42);
  assert.equal(Chunker.CHARS.indexOf('I'), 43, 'I suit G directement');
  assert.equal(Chunker.encode(-1), '-1');
  const c = Chunker.lecteur('-a');
  assert.equal(c.next(), -10);
});

test('les douze tutoriels du SWF se relisent et se réécrivent à l’identique', () => {
  const sources = [
    '10033020-10b21-10',
    '10044003-103301032010',
    '10044003-1032010330103212033120',
    '10044201-10210-10022-10',
    '10044022-10201-10210-10720-10730-10731-10732-10733-10723-10713-10703-10702-10711-10',
    '10055802-10812-10832-10842-10013-10222-10831-10830-10833-10834-10',
    '10055004-10b01-10b11-10b21-10b31-12b41-10b32-12b33-12b34-13b24-13b14-13812-10823-10813-10b02-10b03-10b42-10b43-10b44-10222-10',
    '10077006-10301103021036310353108300083100842008320083400844008350083600656-13660-13854-10',
    '14055522-10211-10231-10004-10',
    '10166m11-10m21-10m31-10m41-10m42-10m43-10m44-10m24-10m23-10m22-10714-10713-10712-10704-10703-10702-10710-10720-10730-10740-10750-10751-10753-10754-10705-10715-10755-10752-10732-10733-10734-10735-10025-12045-10',
    '10066854-10c35403451030510724-1271402855-12051-11853-10852-10841-10c21207100272202723027440274302742027300274002750027040270302713027020271202',
    '10477033-10834-10743-10732-10723-10722-10742-10724-10716-10706-10756-10766-10726-10746-10700-10701-10702-10712-10710-10752-10762-10761-10760-10750-10730-10731-10744-10h64-10',
  ];
  for (const s of sources) {
    const l = Level.depuisChaine(s);
    assert.equal(l.dump(), s, 'aller-retour intact pour ' + s.slice(0, 12) + '…');
  }
});

test('Tutorial 1 : sans fruit la sortie s’ouvre seule, et deux pas suffisent', () => {
  const p = new Partie(Level.depuisChaine('10033020-10b21-10'));
  assert.ok(p.isExitOpen(), 'zéro fruit : les portes s’ouvrent avant le premier pas');
  p.jouer(Direction.EAST);
  p.jouer(Direction.EAST);
  assert.ok(p.isEnded() && p.isVictorious());
  assert.equal(p.countMoves(), 2);
});

test('la sortie refuse qu’on entre par sa nuque, et se traverse fermée', () => {
  // Sortie orientée NORD en (1,1) : on n'y entre pas en descendant (SOUTH).
  const p = new Partie(niveau(3, 3, [1, 0], [
    [Element.EXIT, 1, 1, -1, Direction.NORTH],
  ]));
  p.jouer(Direction.SOUTH);
  assert.ok(!p.isEnded(), 'entrer du nord (en marchant vers le sud) est interdit');
  assert.equal(p.countMoves(), 0, 'le pas refusé ne compte pas');
  // Par l'ouest en marchant vers l'est : accepté.
  const p2 = new Partie(niveau(3, 3, [0, 1], [
    [Element.EXIT, 1, 1, -1, Direction.NORTH],
  ]));
  p2.jouer(Direction.EAST);
  assert.ok(p2.isVictorious());
});

test('les passes fantôme : gratuites, et l’aller-retour immédiat s’annule', () => {
  const p = new Partie(niveau(4, 1, [0, 0], [
    [Element.FRUIT, 3, 0, 1, 0],                 // un fruit pour garder la sortie close
  ]));
  // Aller-retour à vide : rien ne reste.
  p.jouer(Replay.START_GHOST);
  p.jouer(Replay.STOP_GHOST);
  assert.deepEqual(p.getMovements(), [], 'l’aller-retour immédiat s’efface');
  assert.equal(p.spiritSpaces(), 0);
  // Un pas de fantôme coûte UN coup, les bascules rien.
  p.jouer(Replay.START_GHOST);
  p.jouer(Direction.EAST);
  p.jouer(Replay.STOP_GHOST);
  assert.deepEqual(p.getMovements(), [Replay.START_GHOST, Direction.EAST, Replay.STOP_GHOST]);
  assert.equal(p.spiritSpaces(), 2);
  assert.equal(p.countMoves(), 1);
});

test('la rune interdit de lâcher le fantôme, pas d’y marcher', () => {
  const p = new Partie(niveau(3, 1, [0, 0], [
    [Element.RUNE, 1, 0, -1, 0],
    [Element.FRUIT, 2, 0, 1, 0],
  ]));
  p.jouer(Direction.EAST);                       // marcher sur la rune : permis
  assert.equal(p.getHero().pos.x, 1);
  p.jouer(Replay.START_GHOST);
  assert.deepEqual(p.getMovements(), [Direction.EAST],
    'sur une rune, la touche espace reste lettre morte');
});

test('un niveau dont le départ est pris n’a pas de héros : partie morte-née', () => {
  const p = new Partie(niveau(2, 1, [0, 0], [
    [Element.RUNE, 0, 0, -1, 0],
  ]));
  assert.ok(p.isEnded() && !p.isVictorious(), 'le serveur ne s’étrangle pas dessus');
});

test('deux fruits pareils fusionnent, deux différents se bousculent', () => {
  const p = new Partie(niveau(4, 1, [0, 0], [
    [Element.FRUIT, 1, 0, 2, 0],
    [Element.FRUIT, 2, 0, 2, 0],
  ]));
  assert.ok(!p.isExitOpen());
  p.jouer(Direction.EAST);                       // pousse le fruit 1 sur le fruit 2
  assert.ok(p.isExitOpen(), 'plus un fruit vivant : la sortie s’ouvre');
  // Le fichier LAISSE les fruits fusionnés dans sa liste, morts et
  // transparents — seul `alive` compte. On garde le même pas.
  const morts = p.sprites().filter((s) => s.id === Element.FRUIT && !s.alive);
  assert.equal(morts.length, 2, 'les fruits morts restent dans la liste, comme dans le SWF');
  assert.equal(p.getBoard().get(new R.Coord(2, 0)).id, Element.NONE,
    'mais plus personne sur la case');

  const q = new Partie(niveau(4, 1, [0, 0], [
    [Element.FRUIT, 1, 0, 1, 0],
    [Element.FRUIT, 2, 0, 2, 0],
  ]));
  q.jouer(Direction.EAST);
  assert.ok(!q.isExitOpen(), 'des paramètres différents ne fusionnent pas');
  assert.equal(q.countMoves(), 0, 'le fruit bloqué bloque aussi le héros');
});

test('la caisse comble l’eau, et l’eau comblée se marche', () => {
  const p = new Partie(niveau(4, 1, [0, 0], [
    [Element.BOX, 1, 0, -1, 0],
    [Element.WATER, 2, 0, -1, 0],
    [Element.FRUIT, 3, 0, 1, 0],
  ]));
  p.jouer(Direction.EAST);                       // pousse la caisse dans l'eau
  const eau = p.sprites().find((s) => s.id === Element.WATER);
  assert.ok(eau.isFilledWithBox(), 'l’eau retient la caisse');
  assert.ok(!p.sprites().some((s) => s.id === Element.BOX), 'la caisse a disparu dans l’éclaboussure');
  p.jouer(Direction.EAST);                       // sur l'eau comblée
  assert.equal(p.getHero().pos.x, 2);
});

test('la bombe poussée s’allume — la poussée consomme déjà un tick — et rase le mur, pas l’archer', () => {
  const p = new Partie(niveau(6, 3, [0, 0], [
    [Element.BOMB, 1, 0, 2, 0],
    [Element.WALL, 3, 0, -1, 0],
    [Element.ARCHER, 2, 2, -1, 0],
    [Element.FRUIT, 0, 2, 1, 0],
  ]));
  // La poussée allume la bombe (compte = 2) ET la passe de réaction qui suit
  // décompte aussitôt : il ne reste qu'un coup avant l'explosion.
  p.jouer(Direction.EAST);
  const bombe = p.sprites().find((s) => s.id === Element.BOMB);
  assert.ok(bombe && bombe.alive, 'la bombe tient encore un coup');
  p.jouer(Direction.SOUTH);                      // 1 → 0 : explosion en (2,0)
  assert.ok(!p.sprites().some((s) => s.id === Element.BOMB), 'la bombe a explosé');
  assert.ok(!p.sprites().some((s) => s.id === Element.WALL), 'le mur voisin a brûlé');
  const archer = p.sprites().find((s) => s.id === Element.ARCHER);
  assert.ok(archer && archer.alive, 'l’archer cligne mais ressuscite — c’est le fichier');
  assert.ok(p.getHero().alive, 'le héros, à l’écart, n’a rien senti');
});

test('l’aimant tire la caisse d’une case par passe, jusqu’à sa ligne', () => {
  // Aimant orienté EST en (0,0), qui regarde vers (1,0)... : la caisse en (3,0)
  // est tirée vers lui tant que le chemin est libre.
  const p = new Partie(niveau(5, 2, [0, 1], [
    [Element.MAGNET, 0, 0, -1, Direction.EAST],
    [Element.BOX, 3, 0, -1, 0],
    [Element.FRUIT, 4, 1, 1, 0],
  ]));
  const caisse = p.sprites().find((s) => s.id === Element.BOX);
  assert.ok(caisse.pos.x < 3, 'dès la mise en place, l’aimant a commencé à tirer');
  p.jouer(Direction.EAST);
  assert.equal(caisse.pos.x, 1, 'la caisse finit collée à l’aimant');
});

test('le sens unique strict ne se quitte que dans son sens', () => {
  const p = new Partie(niveau(3, 2, [0, 0], [
    [Element.ONE_WAY_STRICT, 1, 0, -1, Direction.EAST],
    [Element.FRUIT, 2, 1, 1, 0],
  ]));
  p.jouer(Direction.EAST);                       // on entre en marchant vers l'est
  assert.equal(p.getHero().pos.x, 1);
  p.jouer(Direction.SOUTH);                      // en sortir vers le sud : refusé
  assert.equal(p.getHero().pos.y, 0, 'prisonnier du rail');
  p.jouer(Direction.EAST);                       // dans le sens : accepté
  assert.equal(p.getHero().pos.x, 2);
});

test('l’araignée sort du cocon à la passe qui SUIT l’ouverture, puis charge sa ligne', () => {
  const p = new Partie(niveau(5, 2, [0, 0], [
    [Element.SPIDER, 4, 0, -1, 0],
    // pas de fruit : la sortie « s'ouvre » dès la mise en place…
  ]));
  // …mais la passe d'ouverture est déjà passée : l'araignée n'a encore rien vu.
  assert.ok(p.getHero().alive, 'au repos, le cocon tient');
  // Le premier pas déclenche la passe suivante : sortie ouverte → cocon
  // percé → héros aligné (y=0) → charge → mort.
  p.jouer(Direction.EAST);
  assert.ok(!p.getHero().alive, 'la charge alignée ne pardonne pas');
  assert.ok(p.isEnded() && !p.isVictorious());
});

test('rejouer() rend le verdict du serveur : victoire, coups, et rien après la fin', () => {
  const v = R.rejouer(Level.depuisChaine('10033020-10b21-10'), [1, 1, 2, 2, 2]);
  assert.ok(v.victorieux);
  assert.equal(v.coups, 2, 'les entrées après la victoire ne comptent pas');
  const d = R.rejouer(Level.depuisChaine('10033020-10b21-10'), [2]);
  assert.ok(!d.victorieux && !d.fini, 'descendre ne finit rien');
});

test('le mur et l’eau connaissent leurs seize raccords — dont le « 17 » du mur', () => {
  assert.equal(R.Wall._FRAMES[13], '17', 'coquille d’origine préservée');
  assert.equal(R.Water._FRAMES[13], '8', 'l’eau, elle, porte un 8');
  const p = new Partie(niveau(3, 3, [0, 0], [
    [Element.WALL, 1, 1, -1, 0],
    [Element.WALL, 1, 2, -1, 0],
    [Element.FRUIT, 2, 0, 1, 0],
  ]));
  const c = new R.Coord(1, 1);
  // Voisin au sud seulement : masque 4 → image « 2 ».
  assert.equal(R.frameMur(p.getBoard(), c), '2');
});
