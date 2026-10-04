'use strict';
/*
 * LES COTES DES TOURNOIS (coteTournoi.js) — « ça doit être plus safe de parier
 * sur le favori que sur l'outsider ».
 */
const { test } = require('node:test');
const assert = require('node:assert');
const C = require('../coteTournoi.js');

test('le favori a la petite cote, l’outsider la grosse', () => {
  // Trente jours de Swapou : le favori tourne autour de 9 000, l'outsider de 5 000.
  const favori = Array.from({ length: 30 }, (_, i) => 8500 + (i * 37) % 1000);
  const outsider = Array.from({ length: 30 }, (_, i) => 4500 + (i * 53) % 1200);
  const c = C.cotesDuMatch('Favori', 'Outsider', { favori, outsider });
  assert.ok(c.favori.p > 0.85 && c.favori.p <= C.REGLES.pMax, `p du favori : ${c.favori.p}`);
  assert.ok(c.favori.cote < 1.1, `cote du favori : ${c.favori.cote}`);
  assert.ok(c.outsider.cote > 5, `cote de l’outsider : ${c.outsider.cote}`);
  assert.ok(Math.abs(c.favori.p + c.outsider.p - 1) < 1e-9);
});

test('la marge du parc : les deux cotes font moins que le juste prix', () => {
  for (const [a, b] of [[[100, 200, 300], [150, 250]], [[5, 6, 7, 8], [1, 2, 9]], [[10], [10]]]) {
    const c = C.cotesDuMatch('a', 'b', { a, b });
    // 1/cote_a + 1/cote_b > 1 : le parieur qui couvre les deux côtés perd.
    assert.ok(1 / c.a.cote + 1 / c.b.cote > 1, JSON.stringify(c));
  }
});

test('peu de scores, peu de certitude : la probabilité est tirée vers 50 %', () => {
  // Un score chacun, A devant : 0,5 + 0,5 × 1/(1+3) = 62,5 %.
  assert.equal(C.probaVictoire([400], [100]), 0.625);
  // Même écart, dix scores chacun : bien plus sûr.
  const p10 = C.probaVictoire(Array(10).fill(400), Array(10).fill(100));
  assert.ok(p10 > 0.85 && p10 <= C.REGLES.pMax);
  // Personne ne sait rien de l'un des deux : 50 / 50.
  assert.equal(C.probaVictoire([], [100, 200]), 0.5);
  assert.equal(C.probaVictoire([300], []), 0.5);
  // Des égalités partout : 50 / 50.
  assert.equal(C.probaVictoire([5, 5], [5, 5]), 0.5);
});

test('les bornes : jamais de certitude, jamais de cote folle', () => {
  const p = C.probaVictoire(Array(100).fill(1e6), Array(100).fill(1));
  assert.equal(p, C.REGLES.pMax);
  assert.ok(C.coteDe(p) >= C.REGLES.min);
  assert.ok(C.coteDe(1 - p) <= C.REGLES.max);
  assert.equal(C.coteDe(0.5), 1.84, '0,92 / 0,5');
  assert.equal(C.coteDe(0.625), 1.47);
  assert.equal(C.coteDe(0.375), 2.45);
});

test('le règlement : la cote figée paie le gagnant, le perdant ne reçoit rien', () => {
  const r = C.regler([
    { id: 1, username: 'ana', choix: 'Favori', mise: 50, retour: 73 },
    { id: 2, username: 'cid', choix: 'outsider', mise: 90, retour: 220 },
  ], 'favori');
  assert.deepEqual(r.map((x) => [x.username, x.statut, x.gain]), [['ana', 'gagne', 73], ['cid', 'perdu', 0]]);
  assert.equal(C.retourDe(50, 1.47), 73);
  assert.equal(C.retourDe(70, 2.45), 171);
  assert.equal(C.retourDe(20, 2.45), 49);
});
