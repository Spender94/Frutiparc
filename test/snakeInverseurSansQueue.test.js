/*
 * LE SERPENT SANS QUEUE QUI SE RETOURNE — Potion jaune, Inverseur, len 0.
 *
 * « Si l'on prend une potion jaune alors que le serpent a une taille de zéro,
 *   il ne bouge plus du tout. Difficilement reproductible mais bon, il
 *   existe. »
 *
 * La potion jaune n'y est pour rien en elle-même : elle fait piloter le
 * serpent aux FLÈCHES, BAS compris. Or l'Inverseur (option définitive) retourne
 * le serpent à chaque appui sur BAS — et Snake.reverse, à len 0, cherche un
 * point de queue au-delà de la tête : `end_queue_pos` rend undefined. Le
 * Flash d'origine en tirait un angle NaN qui figeait le serpent pour de bon
 * (Games/snake3/Snake.as, même code) ; le portage levait une exception qui
 * arrêtait la boucle du jeu. Les trois conditions réunies (Inverseur en poche,
 * serpent réduit à sa tête, BAS sous potion jaune) expliquent le « difficilement
 * reproductible ».
 *
 * Le correctif (serpent.js, reverse) : sans corps, se retourner, c'est faire
 * demi-tour sur place.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const P = require('../public/snake3/partie.js');
const B = require('../public/snake3/bonus.js');
const SS = require('../public/snake3/serpent.js');

// Un hasard déterministe (Park-Miller) : la partie se rejoue à l'identique.
function hasardFixe(graine) {
  let s = graine;
  return (n) => { s = (s * 16807) % 2147483647; return s % n; };
}

function partieSansQueue() {
  const p = new P.Partie({ hasard: hasardFixe(1) });
  for (let i = 0; i < 30; i++) p.main(1, 1 / 40);
  p.serpent.len = 0;                  // deux dynamites, un Sabre, une Cloche…
  return p;
}

test('Potion jaune + Inverseur à len 0 : BAS ne fige plus le serpent', () => {
  const p = partieSansQueue();
  p.add_unique_slot(new B.Inverseur(p));
  p.add_slot(new B.PotionJaune(p));

  let y = p.serpent.y;
  // On tapote BAS (piloter vers le bas, donc retourner le serpent à chaque
  // appui) : il doit avancer à chaque série d'images, sans jamais planter.
  for (let k = 0; k < 6; k++) {
    p.entree.bas = (k % 2 === 0);
    for (let i = 0; i < 10; i++) {
      assert.doesNotThrow(() => p.main(1, 1 / 40));
    }
    const s = p.serpent;
    assert.ok(Number.isFinite(s.x) && Number.isFinite(s.y), 'position finie');
    assert.ok(Number.isFinite(s.ang), 'cap fini');
    assert.ok(s.y > y, `le serpent descend (${y} → ${s.y})`);
    y = s.y;
  }
  assert.strictEqual(p.game_over_flag, false);
});

test('reverse à len 0 : demi-tour sur place, cap opposé', () => {
  const s = new SS.Serpent({ x: 200, y: 200 });
  s.len = 0;
  s.ang = 0;
  const bornes = { left: 0, top: 0, right: 600, bottom: 400 };
  for (let i = 0; i < 10; i++) s.move(bornes, 1);
  const x = s.x;
  s.reverse();
  assert.ok(Number.isFinite(s.ang));
  assert.ok(Math.abs(Math.abs(s.ang) - Math.PI) < 1e-9, `cap ${s.ang}`);
  for (let i = 0; i < 10; i++) s.move(bornes, 1);
  assert.ok(s.x < x, 'il repart dans l\'autre sens');
});

test('reverse avec un corps : inchangé (la tête passe au bout de la queue)', () => {
  const s = new SS.Serpent({ x: 100, y: 200 });
  s.ang = 0;
  const bornes = { left: 0, top: 0, right: 600, bottom: 400 };
  for (let i = 0; i < 40; i++) s.move(bornes, 1);
  const bout = s.end_queue_pos(-1);
  s.reverse();
  assert.strictEqual(s.x, bout.x);
  assert.strictEqual(s.y, bout.y);
  assert.ok(Math.abs(Math.abs(s.ang) - Math.PI) < 1e-9, `cap ${s.ang}`);
});
