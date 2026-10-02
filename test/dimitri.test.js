'use strict';
/*
 * DIMITRI — le texte de ses annonces (dimitri.js), sans base ni forum.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const Dimitri = require('../dimitri.js');

const UN = { id: 'c1', parieur: 'Noisette', quoi: 'Myrtille en or à Swapou 2', mise: 50, cote: 8.45, gain: 422 };
const DEUX = { id: 't7', parieur: 'Cassis', quoi: 'la victoire de Papaye (Papaye contre Goyave)', mise: 40, cote: null, gain: 190 };

test('son compte : un pseudo que personne ne peut prendre, la bouille demandée, ravi', () => {
  assert.doesNotMatch(Dimitri.PSEUDO_NPC, /^[a-zA-Z0-9_]{3,20}$/, 'hors de portée d’une inscription');
  assert.equal(Dimitri.NOM, 'Dimitri');
  assert.equal(Dimitri.BOUILLE, '0o0000000000000000000000');
  assert.equal(Dimitri.HUMEUR, 4);
  assert.equal(Dimitri.RUBRIQUE, 'Jeux Frutiparc');
  assert.match(Dimitri.SUJET, /Prunostics/);
  assert.match(Dimitri.INTRO, /pronostics/);
});

test('un gros coup : le parieur mentionné, la mise, la cote, le gain', () => {
  const m = Dimitri.messageGrosCoups([UN]);
  assert.match(m, /@Noisette avait misé 50 kikooz sur Myrtille en or à Swapou 2, à ×8,45 : \[b\]422 kikooz\[\/b\] empochés !/);
  assert.doesNotMatch(m, /^•/m, 'pas de liste pour un seul coup');
});

test('pari mutuel : la cote est le rapport gain / mise', () => {
  assert.match(Dimitri.messageGrosCoups([DEUX]), /sur la victoire de Papaye \(Papaye contre Goyave\), à ×4,75 :/);
});

test('plusieurs coups : un seul message, le plus gros d’abord', () => {
  const m = Dimitri.messageGrosCoups([DEUX, UN]);
  const lignes = m.split('\n').filter((l) => l.startsWith('• '));
  assert.equal(lignes.length, 2);
  assert.match(lignes[0], /@Noisette/);
  assert.match(lignes[1], /@Cassis/);
  assert.match(m, /2 gros coups/);
});

test('le même lot donne le même texte ; un autre lot peut en changer', () => {
  assert.equal(Dimitri.messageGrosCoups([UN]), Dimitri.messageGrosCoups([UN]));
  const textes = new Set();
  for (let i = 0; i < 40; i++) textes.add(Dimitri.messageGrosCoups([Object.assign({}, UN, { id: 'c' + i })]).split('\n')[0]);
  assert.ok(textes.size > 3, 'des ouvertures variées');
  assert.equal(Dimitri.messageGrosCoups([]), '');
});
