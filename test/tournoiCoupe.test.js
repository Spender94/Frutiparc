'use strict';
/*
 * LA COUPE D'UN TOURNOI AU SCORE — les règles (tournoiCoupe.js) : qui passe,
 * le nom des tours, et le classement final « départagé au score ».
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const TC = require(path.join(__dirname, '..', 'tournoiCoupe.js'));

const plusHaut = (a, b) => Number(a.score) > Number(b.score);
const seeds = { a: 1, b: 2 };
const seedDe = (u) => seeds[u];
const m = { player1: 'a', player2: 'b' };
const sc = (o) => new Map(Object.entries(o));

test('le vainqueur d’un match', () => {
  assert.equal(TC.vainqueurDuMatch(m, sc({ a: { score: 10 }, b: { score: 20 } }), seedDe, plusHaut).winner, 'b', 'meilleur score');
  const eg = TC.vainqueurDuMatch(m, sc({ a: { score: 20, at: '2026-10-02T10:00:00Z' }, b: { score: 20, at: '2026-10-02T09:00:00Z' } }), seedDe, plusHaut);
  assert.equal(eg.winner, 'b', 'égalité : le premier à l’avoir réalisé');
  assert.equal(TC.vainqueurDuMatch(m, sc({ b: { score: 1 } }), seedDe, plusHaut).winner, 'b', 'seul à avoir joué');
  const vide = TC.vainqueurDuMatch(m, sc({}), seedDe, plusHaut);
  assert.equal(vide.winner, 'a', 'personne n’a joué : le mieux classé');
  assert.equal(vide.score1, null);
  const r = TC.vainqueurDuMatch(m, sc({ a: { score: 5 }, b: { score: 3 } }), seedDe, plusHaut);
  assert.deepEqual([r.score1, r.score2], [5, 3], 'les scores du tour sont rendus pour l’affiche');
});

test('le tour préliminaire : un premier tour avec des exemptés', () => {
  const r1 = [{ player1: 'a', player2: null }, { player1: 'g', player2: 'j' }];
  assert.equal(TC.nomDuTour(1, 4, r1), 'Tour préliminaire');
  assert.equal(TC.nomDuTour(1, 4, [{ player1: 'a', player2: 'b' }]), '8ème de finale');
  assert.equal(TC.nomDuTour(2, 4, r1), '1/4 de finale');
  assert.equal(TC.nomDuTour(4, 4), 'Finale');
  assert.equal(TC.nomDuTour(3, 4), 'Demi-finale');
});

test('le classement final départage au score les éliminés d’un même tour', () => {
  const joueurs = 'p01 p02 p03 p04 p05 p06 p07 p08 p09 p10'.split(' ').map((u, i) => ({ username: u, seed: i + 1 }));
  const M = (round, p1, p2, s1, s2, w) => ({ round, player1: p1, player2: p2, score1: s1, score2: s2, winner: w });
  const matches = [
    M(1, 'p01', null, null, null, 'p01'), M(1, 'p08', 'p09', null, 300, 'p09'), M(1, 'p07', 'p10', 500, 900, 'p10'),
    M(2, 'p01', 'p09', 100, 200, 'p09'), M(2, 'p04', 'p05', null, null, 'p04'), M(2, 'p02', 'p10', 300, 300, 'p10'), M(2, 'p03', 'p06', 50, null, 'p03'),
    M(3, 'p09', 'p04', 10, 20, 'p04'), M(3, 'p10', 'p03', 70, 60, 'p10'),
    M(4, 'p04', 'p10', 5, 1, 'p04'),
  ];
  const c = TC.classementFinal(joueurs, matches, (a, b) => a > b);
  assert.deepEqual(c.map((l) => l.username), ['p04', 'p10', 'p03', 'p09', 'p02', 'p01', 'p05', 'p06', 'p07', 'p08']);
  assert.deepEqual(c.slice(0, 2).map((l) => l.statut), ['champion', 'finaliste']);
  // Pendant la coupe : ceux qui jouent encore passent devant les éliminés.
  // (Le tableau contient toujours tous ses tours : les suivants, pas encore joués.)
  const aVenir = matches.slice(3).map((x) => Object.assign({}, x, { winner: null, score1: null, score2: null }));
  const enCours = TC.classementFinal(joueurs, matches.slice(0, 3).concat(aVenir), (a, b) => a > b);
  assert.deepEqual(enCours.slice(-2).map((l) => l.username), ['p07', 'p08']);
  assert.equal(enCours[0].statut, 'en_lice');
});
