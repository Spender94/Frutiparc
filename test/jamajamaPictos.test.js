'use strict';
/*
 * LES 28 PICTOS DE JAMAJAMA : les images de la planche de 2007 (la 28e est
 * l'originale), les noms et conditions proposés au forum, comptés au REJEU
 * que le serveur fait de chaque partie (jamaPictos.js + Partie.stats).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SERVEUR = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const J = require(path.join(ROOT, 'jamaPictos.js'));
const R = require(path.join(ROOT, 'public/jamajama/regles.js'));
const { Direction, Element, Level, Replay } = R;
const E = Direction.EAST, S = Direction.SOUTH, G = Replay.START_GHOST, H = Replay.STOP_GHOST;

// Fabrique un niveau : `elements` = [id, x, y, param, orient] (cf. jamajamaRegles).
function niveau(largeur, hauteur, depart, elements) {
  const l = new Level();
  l.version = 1;
  l.startPos.x = depart[0];
  l.startPos.y = depart[1];
  l.size.width = largeur;
  l.size.height = hauteur;
  for (const [id, x, y, param, orient] of elements) {
    const e = new Element(null);
    e.id = id; e.pos.x = x; e.pos.y = y;
    e.param = param === undefined ? -1 : param;
    e.orientation = orient || 0;
    l.tiles.push(e);
  }
  return l;
}
const stats = (l, mv) => R.rejouer(l, mv).stats;

test('28 pictos, 28 images PNG, dans l’ordre de la planche — la 28e est l’originale', () => {
  assert.equal(J.PICTOS.length, 28);
  assert.deepEqual(J.PICTOS.map((p) => p.n), Array.from({ length: 28 }, (_, i) => i + 1));
  assert.equal(new Set(J.PICTOS.map((p) => p.nom)).size, 28, 'pas de doublon');
  assert.deepEqual(J.PICTOS.slice(0, 5).map((p) => p.objet), ['Banane', 'Orange', 'Pêche', 'Poire', 'Prune']);
  assert.equal(J.PICTOS[27].nom, 'Le chemin de la délivrance');
  for (const p of J.PICTOS) {
    assert.ok(p.quoi && (p.regle || (p.compteur && p.seuil > 0)), 'une condition pour ' + p.nom);
    if (p.compteur) assert.ok(J.COMPTEURS.includes(p.compteur), p.compteur);
  }
  for (let i = 1; i <= 28; i++) {
    const f = path.join(ROOT, 'Games/poulpi/titems', 'jama' + String(i).padStart(2, '0') + '.png');
    const b = fs.readFileSync(f);
    assert.equal(b.slice(1, 4).toString(), 'PNG', f);
    assert.ok(b.length > 300, 'une image, pas un vide : ' + f);
  }
  // Le générateur ne réécrit plus la 28e.
  const gen = fs.readFileSync(path.join(ROOT, 'scripts/make-jamajama-pictos.js'), 'utf8');
  assert.match(gen, /if \(i >= 27\) return;/);
});

test('au catalogue sous JamaJama, et comptés pour la consécration', () => {
  assert.match(SERVEUR, /require\('\.\/jamaPictos\.js'\)/);
  assert.match(SERVEUR, /GAME_ITEM_INFO\[JamaPictos\.ID\(p\.n\)\] = \{ name: p\.nom, game: 'JamaJama'/);
  assert.match(SERVEUR, /totalPictos: 28/);
  assert.match(SERVEUR, /filtreItem: \(id\) => \/\^\\\$jama_picto\\d\\d\$\/\.test\(id\)/);
  assert.equal(J.ID(7), '$jama_picto07');
});

test('le moteur compte en jouant : fusions, eau, bombes, flammes, aimant, rails, fantôme…', () => {
  assert.deepEqual(stats(niveau(4, 1, [0, 0], [
    [Element.FRUIT, 1, 0, 2, 0], [Element.FRUIT, 2, 0, 2, 0], [Element.EXIT, 3, 0, -1, 0],
  ]), [E, E, E]), { fusion: 1 }, 'une paire fusionnée = une fusion');
  assert.deepEqual(stats(niveau(4, 1, [0, 0], [
    [Element.BOX, 1, 0], [Element.WATER, 2, 0], [Element.FRUIT, 3, 0, 1],
  ]), [E]), { caisseEau: 1 });
  assert.deepEqual(stats(niveau(6, 3, [0, 0], [
    [Element.BOMB, 1, 0, 2], [Element.FRUIT, 3, 0, 1], [Element.FRUIT, 0, 2, 1],
  ]), [E, S]), { bombe: 1, fruitBrule: 1 });
  assert.deepEqual(stats(niveau(6, 3, [0, 0], [
    [Element.BOMB, 1, 0, 2], [Element.PEEBLE, 3, 0], [Element.WALL, 4, 0], [Element.FRUIT, 0, 2, 1],
  ]), [E, S]), { bombe: 1, flammeCaillou: 1 }, 'la flamme traverse le caillou');
  assert.ok(stats(niveau(5, 2, [0, 1], [
    [Element.MAGNET, 0, 0, -1, Direction.EAST], [Element.BOX, 3, 0], [Element.FRUIT, 4, 1, 1],
  ]), [E]).aimant >= 1, 'l’aimant attire');
  assert.deepEqual(stats(niveau(3, 2, [0, 0], [
    [Element.ONE_WAY_STRICT, 1, 0, -1, Direction.EAST], [Element.FRUIT, 2, 1, 1],
  ]), [E, E]), { voieUnique: 1 }, 'on compte l’entrée sur le rail');
  assert.deepEqual(stats(niveau(4, 1, [0, 0], [[Element.FRUIT, 3, 0, 1]]), [G, E, E, H]), { fantome: 2 });
  assert.deepEqual(stats(niveau(4, 1, [0, 0], [
    [Element.BOX, 1, 0], [Element.EYE, 2, 0], [Element.FRUIT, 3, 0, 1],
  ]), [E]), { zoeil: 1 }, 'la caisse poussée sur le Zoeil');
  assert.deepEqual(stats(niveau(5, 2, [0, 0], [[Element.SPIDER, 4, 0]]), [E]), { cocon: 1 });
});

test('…et les possessions : le Louki mange, Kohl échange, le Winkle est relâché dans l’eau', () => {
  assert.equal(stats(niveau(5, 2, [0, 0], [
    [Element.LOUKI, 1, 0], [Element.WALL, 2, 0], [Element.FRUIT, 4, 1, 1],
  ]), [G, E, E, H]).louki, 1);
  assert.equal(stats(niveau(5, 2, [0, 0], [
    [Element.KOHL, 2, 0], [Element.FRUIT, 4, 1, 1],
  ]), [G, E, E, H]).kohl, 1);
  assert.equal(stats(niveau(5, 2, [0, 0], [
    [Element.WINKLE, 1, 0], [Element.WATER, 2, 0], [Element.FRUIT, 4, 1, 1],
  ]), [G, E, E, H]).winkleEau, 1);
});

// Des cibles d'Aventure de poche, pour la logique pure.
const CIBLES = {
  premiersPas: ['a0.0', 'a0.1'], tftf: ['a2.12'], etoiles: ['a1.12', 'a2.12'], aimantOr: ['a0.14', 'a2.9'],
  lurker: ['a1.7', 'a2.2'], electro: ['a1.5'], littleStar: ['a0.13'], runes: ['a2.8'],
};
const partie = (cle, o) => Object.assign({ cle, mouvements: [1, 1], victorieux: true, coups: 2, stats: {}, elements: new Set() }, o);
const ligne = (etat, n, possedes) => J.progression(etat, { cibles: CIBLES, publies: 0, possedes: possedes || new Set() })[n - 1];

test('un même replay ne compte qu’une fois ; les seuils se franchissent en cumulant', () => {
  const e = J.etatVide();
  J.enregistrerPartie(e, partie('t1', { stats: { fusion: 6 } }), CIBLES, Element);
  J.enregistrerPartie(e, partie('t1', { stats: { fusion: 6 } }), CIBLES, Element);
  assert.equal(e.c.fusion, 6, 'le même replay renvoyé n’avance rien');
  assert.equal(ligne(e, 1).acquis, false);
  J.enregistrerPartie(e, partie('t1', { mouvements: [1, 2, 1], stats: { fusion: 4 } }), CIBLES, Element);
  assert.equal(e.c.fusion, 10);
  assert.equal(ligne(e, 1).acquis, true, 'Première pulpe : 10 fusions');
  assert.deepEqual([ligne(e, 2).actuel, ligne(e, 2).cible], [10, 100]);
});

test('les drapeaux : poire, jade, Little Star en moins de 40 coups, araignées épargnées', () => {
  const e = J.etatVide();
  J.enregistrerPartie(e, partie('t2', { victorieux: false, stats: { fusion: 1, fruitBrule: 1 } }), CIBLES, Element);
  assert.equal(ligne(e, 4).acquis, false, 'Bonne poire : il faut FINIR le niveau');
  J.enregistrerPartie(e, partie('t2', { mouvements: [3], stats: { fusion: 1, fruitBrule: 1 } }), CIBLES, Element);
  assert.equal(ligne(e, 4).acquis, true);
  J.enregistrerPartie(e, partie('t3', { elements: new Set([Element.JADE]) }), CIBLES, Element);
  assert.equal(ligne(e, 15).acquis, true, 'Pierre précieuse');
  J.enregistrerPartie(e, partie('a0.13', { coups: 40 }), CIBLES, Element);
  assert.equal(ligne(e, 20).acquis, false, '40 coups, ce n’est pas « moins de 40 »');
  J.enregistrerPartie(e, partie('a0.13', { mouvements: [0], coups: 39 }), CIBLES, Element);
  assert.equal(ligne(e, 20).acquis, true);
  J.enregistrerPartie(e, partie('t4', { elements: new Set([Element.SPIDER]), stats: { araigneeMorte: 1 } }), CIBLES, Element);
  J.enregistrerPartie(e, partie('t5', { elements: new Set([Element.SPIDER]) }), CIBLES, Element);
  J.enregistrerPartie(e, partie('t5', { mouvements: [2], elements: new Set([Element.SPIDER]) }), CIBLES, Element);
  assert.deepEqual([ligne(e, 8).actuel, ligne(e, 8).cible], [1, 10], 'niveaux DISTINCTS, sans araignée morte');
});

test('le Lurker : les deux niveaux à la suite, une défaite entre deux remet à zéro', () => {
  const e = J.etatVide();
  J.enregistrerPartie(e, partie('a1.7'), CIBLES, Element);
  J.enregistrerPartie(e, partie('a2.2', { victorieux: false }), CIBLES, Element);
  J.enregistrerPartie(e, partie('a2.2', { mouvements: [0] }), CIBLES, Element);
  assert.equal(ligne(e, 18).acquis, false, 'la défaite sur a2.2 a cassé la série');
  J.enregistrerPartie(e, partie('a1.7', { mouvements: [3] }), CIBLES, Element);
  assert.equal(ligne(e, 18).acquis, true);
});

test('les séries : Premiers pas, aimant en or, Tout feu tout flamme par sa Caverne II-*', () => {
  const e = J.importerAventure(J.etatVide(), '0[0,1,14;2[0,1,2,3,4,5,6,7,8,9,10,11;');
  assert.equal(ligne(e, 24).acquis, true, 'Prêt pour la grande aventure, depuis la sauvegarde');
  assert.equal(ligne(e, 21).acquis, true, 'Runes du Pilat (II-9)');
  assert.equal(ligne(e, 7).acquis, true, 'Le cœur en or : a0.14 et a2.9');
  assert.equal(ligne(e, 25).acquis, false, 'sans la II-*, la série n’est pas terminée');
  assert.equal(ligne(e, 22).acquis, false);
  J.importerAventure(e, '2[12;');
  assert.equal(ligne(e, 25).acquis, false, 'l’import ne se fait qu’une fois');
  J.enregistrerPartie(e, partie('a2.12'), CIBLES, Element);
  assert.equal(ligne(e, 25).acquis, true, 'la II-* gagnée termine la série');
  assert.equal(ligne(e, 22).acquis, true, 'et c’est une Caverne étoile');
});

test('le 28e : les 27 autres, déjà possédés ou acquis', () => {
  const tous = new Set(J.PICTOS.filter((p) => p.n < 28).map((p) => J.ID(p.n)));
  assert.equal(ligne(J.etatVide(), 28, tous).acquis, true);
  tous.delete(J.ID(19));
  const l = ligne(J.etatVide(), 28, tous);
  assert.deepEqual([l.actuel, l.cible, l.acquis], [26, 27, false]);
  assert.equal(J.progression(J.etatVide(), { cibles: CIBLES, publies: 1, possedes: tous })[27].acquis, true,
    'Créateur se gagne en publiant, et complète la bande');
});

test('les vrais niveaux de levels.xml donnent les cibles annoncées au forum', () => {
  // La lecture des packs, comme jamaLevels() dans server.js.
  const xml = fs.readFileSync(path.join(ROOT, 'Games/poulpi/levels.xml'), 'utf8');
  const av = /<adventure>([\s\S]*?)<\/adventure>/.exec(xml)[1];
  const packs = [...av.matchAll(/<pack\s+name="([^"]*)"\s+total="(-?\d+)"\s*>([\s\S]*?)<\/pack>/g)].map((p) => ({
    titre: p[1].replace(/&apos;/g, "'"),
    niveaux: [...p[3].matchAll(/<l\s+t="([^"]*)"\s*>([^<]*)<\/l>/g)].map((l) => ({ titre: l[1].replace(/&apos;/g, "'"), contenu: l[2].trim() })),
  }));
  const c = J.niveauxCibles(R, packs);
  assert.equal(c.premiersPas.length, 16, 'les 16 niveaux de « Premiers pas »');
  assert.deepEqual(c.tftf, ['a2.12'], 'la Caverne II-* termine « Tout feu tout flamme »');
  assert.deepEqual(c.etoiles, ['a1.12', 'a2.12']);
  assert.deepEqual(c.littleStar, ['a0.13']);
  assert.deepEqual(c.runes, ['a2.8']);
  assert.deepEqual(c.lurker, ['a1.7', 'a2.2']);
  assert.deepEqual(c.electro, ['a1.5', 'a2.3']);
  assert.deepEqual(c.aimantOr, ['a0.14', 'a1.3', 'a1.9', 'a2.9', 'a2.10', 'a2.12']);
  const tous = Object.values(c).flat();
  assert.ok(!tous.some((k) => /^a6\./.test(k)), '« Le chemin de la délivrance » ne compte dans rien');
});
