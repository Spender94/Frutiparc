'use strict';
/*
 * FPI18n — le socle des langues (public/js/i18n.js), tel que le serveur le
 * charge : le français est l'argument de repli écrit dans le code, l'anglais
 * vient des dictionnaires, et une clé absente retombe sur le français.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const I = require('../public/js/i18n.js');

I.ajouter('en', {
  'essai.bonjour': 'Hello {nom}!',
  'essai.fonction': (p) => (p.genre === 'F' ? 'She' : 'He') + ' joined',
  'essai.fruits': { one: '{n} fruit', other: '{n} fruits' },
});

test('hors langue connue, ou sans traduction, le français écrit dans le code', () => {
  assert.strictEqual(I.traduire('fr', 'essai.bonjour', 'Bonjour {nom} !', { nom: 'Kiwi' }), 'Bonjour Kiwi !');
  assert.strictEqual(I.traduire('de', 'essai.bonjour', 'Bonjour {nom} !', { nom: 'Kiwi' }), 'Bonjour Kiwi !');
  assert.strictEqual(I.traduire('en', 'essai.absente', 'Pas traduit'), 'Pas traduit');
  assert.strictEqual(I.traduire('en', 'essai.sansrepli'), 'essai.sansrepli');
});

test('en anglais, le dictionnaire — gabarits et fonctions', () => {
  assert.strictEqual(I.traduire('en', 'essai.bonjour', 'Bonjour {nom} !', { nom: 'Kiwi' }), 'Hello Kiwi!');
  assert.strictEqual(I.traduire('en', 'essai.fonction', '', { genre: 'F' }), 'She joined');
  // Un paramètre absent laisse son repère visible plutôt que « undefined ».
  assert.strictEqual(I.traduire('en', 'essai.bonjour', ''), 'Hello {nom}!');
});

test('pluriels : règle française (0 et 1 au singulier) et règle anglaise', () => {
  const fr = { one: '{n} fruit', other: '{n} fruits' };
  assert.strictEqual(I.pluriel('fr', 'essai.fruits', 0, fr), '0 fruit');
  assert.strictEqual(I.pluriel('fr', 'essai.fruits', 1, fr), '1 fruit');
  assert.strictEqual(I.pluriel('fr', 'essai.fruits', 2, fr), '2 fruits');
  assert.strictEqual(I.pluriel('en', 'essai.fruits', 0, fr), '0 fruits');
  assert.strictEqual(I.pluriel('en', 'essai.fruits', 1, fr), '1 fruit');
  // Sans traduction anglaise, les formes françaises gardent la règle française.
  assert.strictEqual(I.pluriel('en', 'essai.pomme', 0, { one: '{n} pomme', other: '{n} pommes' }), '0 pomme');
});

test('dates et nombres à la manière de chaque langue', () => {
  const d = new Date(2026, 2, 12, 14, 5);
  assert.strictEqual(I.date('fr', d, 'court'), '12/03');
  assert.strictEqual(I.date('en', d, 'court'), '03/12');
  assert.strictEqual(I.date('fr', d, 'long'), '12 mars 2026');
  assert.strictEqual(I.date('en', d, 'long'), 'March 12, 2026');
  assert.strictEqual(I.date('en', d, 'jourHeure'), '03/12 14:05');
  assert.strictEqual(I.nombre('en', 12345), '12,345');
  assert.match(I.nombre('fr', 12345), /^12\s345$/);
});

test('seules les langues du parc sont reconnues', () => {
  assert.strictEqual(I.valide('EN-gb'), 'en');
  assert.strictEqual(I.valide('fr_CA'), 'fr');
  assert.strictEqual(I.valide('de'), '');
  assert.strictEqual(I.langue, 'fr', 'côté serveur, pas de langue courante : français');
});
