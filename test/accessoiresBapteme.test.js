/*
 * Le baptême des accessoires.
 *
 * Les accessoires de Frutiparc ne se décrivent pas, ils se surnomment : un
 * seul mot, souvent un mot-valise, qui suggère la couleur plus qu'il ne nomme
 * l'objet. « Bananocle » (banane + monocle), « Kiwix » (kiwi + ix). Le
 * générateur de la vitrine hebdomadaire doit tenir ce registre pour les
 * centaines d'accessoires qu'il tire du Bouilloscope.
 *
 * On passe donc au crible les 848 combinaisons possibles (16 types × 53
 * couleurs) : un mot et un seul, prononçable, jamais deux fois le même, et
 * rien qui puisse faire ricaner une cour de récréation — un nom fabriqué par
 * une machine et posé en boutique sans relecture, c'est exactement là que ça
 * se joue.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const P = require('../public/js/bouille-palette.js');

const B62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const TYPES = P.NAME_ENDINGS.length - 1;          // 16 types (0 = « Rien »)
const COULEURS = P.COLOR_ROOTS.length;            // 53 couleurs

// suffix9 : type, variante, couleur 1, couleur 2, couleur 3 — la valeur est
// portée par le premier caractère de chaque paire.
const code = (type, c1, c2 = 0, c3 = 0, variante = 0) =>
  B62[type] + '0' + B62[variante] + '0' + B62[c1] + '0' + B62[c2] + '0' + B62[c3];

function tousLesNoms() {
  const out = [];
  for (let t = 1; t <= TYPES; t++) {
    for (let c = 0; c < COULEURS; c++) out.push({ t, c, nom: P.accessoryName(code(t, c)) });
  }
  return out;
}

test('les noms d\'origine se retrouvent', () => {
  // Kiwix et Bananocle sont les deux surnoms d'époque qu'on connaisse : le
  // générateur est bâti sur eux. La casquette porte la finale « -ix », le
  // bananocle la finale « -ocle ».
  assert.equal(P.accessoryName(code(3, 16)), 'Kiwix', 'casquette + kiwi = Kiwix');
  assert.equal(P.accessoryName(code(6, 12)), 'Nectarocle', 'la finale du bananocle est bien -ocle');
  assert.equal(P.NAME_ENDINGS[6], 'ocle');
  assert.equal(P.NAME_ENDINGS[3], 'ix');
});

test('un accessoire, un mot', () => {
  for (const { t, c, nom } of tousLesNoms()) {
    assert.ok(nom, `type ${t} couleur ${c} a un nom`);
    assert.ok(!/\s/.test(nom), `« ${nom} » tient en un seul mot`);
    assert.match(nom, /^[A-ZÉÈÊÀÂÎÔÛÇ][a-zéèêëàâäîïôöûüç]+$/,
      `« ${nom} » s'écrit comme un nom propre, sans chiffre ni ponctuation`);
    assert.ok(nom.length >= 4 && nom.length <= 12, `« ${nom} » a une longueur de nom (${nom.length})`);
  }
});

test('une tête nue ne se baptise pas', () => {
  assert.equal(P.accessoryName('000000000'), '', 'type 0 = « Rien »');
  assert.equal(P.accessoryName(''), '');
});

test('848 combinaisons, 848 noms différents', () => {
  const noms = tousLesNoms();
  const vus = new Map();
  for (const { t, c, nom } of noms) {
    const k = nom.toLowerCase();
    assert.ok(!vus.has(k),
      `« ${nom} » (type ${t}, couleur ${c}) est déjà pris par ${JSON.stringify(vus.get(k))}`);
    vus.set(k, { t, c });
  }
  assert.equal(vus.size, TYPES * COULEURS);
});

test('rien qui puisse faire ricaner', () => {
  // Un nom fabriqué par une machine part en boutique sans relecture. La liste
  // vise les collisions bêtes d'un collage racine + finale, pas la censure.
  const INTERDITS = [
    'caca', 'kaka', 'pipi', 'popo', 'zizi', 'cul', 'con', 'bite', 'pute', 'putain',
    'merde', 'chier', 'chiot', 'pisse', 'pet', 'prout', 'fesse', 'nichon', 'couille',
    'penis', 'pénis', 'anus', 'sexe', 'sein', 'suce', 'niqu', 'baise', 'encul',
    'salop', 'pede', 'pédé', 'tapette', 'pédale', 'nazi', 'viol', 'mouille', 'foutre',
  ];
  const sansAccent = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  for (const { nom } of tousLesNoms()) {
    const plat = sansAccent(nom);
    for (const mot of INTERDITS) {
      assert.ok(plat.indexOf(sansAccent(mot)) < 0, `« ${nom} » contient « ${mot} »`);
    }
  }
});

test('deux accessoires jumeaux reçoivent deux noms', () => {
  // Même type, même couleur principale : c'est la seconde couleur qui parle,
  // puis la troisième, puis la finale change. Toujours un mot, jamais deux
  // fois le même — c'est ce qui permet à la vitrine de baptiser dix
  // accessoires d'affilée sans doublon.
  const jumeau = code(10, 29, 16, 52);           // lunettes citron / kiwi / neige
  const noms = [];
  for (let essai = 0; essai < 8; essai++) noms.push(P.accessoryName(jumeau, essai));
  assert.equal(noms[0], 'Citronette');
  assert.equal(noms[1], 'Kiwette', 'la seconde couleur prend le relais');
  assert.equal(noms[2], 'Neigette', 'puis la troisième');
  assert.equal(new Set(noms).size, noms.length, 'huit essais, huit mots : ' + noms.join(', '));
  for (const n of noms) assert.ok(!/\s/.test(n), `« ${n} » tient encore en un mot`);
});

test('le collage rend la voyelle en trop', () => {
  // Kiwi + ix ne fait pas « Kiwiix ». C'est cette règle qui rend « Kiwix ».
  assert.equal(P.accessoryName(code(3, 16)), 'Kiwix');          // Kiwi  + ix
  assert.equal(P.accessoryName(code(6, 10)), 'Chococle');       // Choco + ocle
  assert.equal(P.accessoryName(code(10, 13)), 'Dorette');       // Doré  + ette
  assert.equal(P.accessoryName(code(11, 29)), 'Citronille');    // Citron + ille
});
