'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { faerieIsRich, parseFaerieField, mergeFaerieByIdentity } = require('../minipixizFaerie');

// ── faerieIsRich ──
test('faerieIsRich: $level/$name-only stubs are NOT rich', () => {
  assert.equal(faerieIsRich({ $level: 50 }), false);
  assert.equal(faerieIsRich({ $name: 'Pigone', $level: 32 }), false);
  assert.equal(faerieIsRich({}), false);
  assert.equal(faerieIsRich(null), false);
  assert.equal(faerieIsRich([1, 2]), false);
});
test('faerieIsRich: any extra field makes it rich', () => {
  assert.equal(faerieIsRich({ $level: 50, $carac: [8, 8] }), true);
  assert.equal(faerieIsRich({ $name: 'Pigone', $level: 32, $exp: 1035 }), true);
});

// ── parseFaerieField ──
test('parseFaerieField: legacy "level,level," → level-only stubs', () => {
  assert.deepEqual(parseFaerieField('50,50,32,'), [{ $level: 50 }, { $level: 50 }, { $level: 32 }]);
});
test('parseFaerieField: new "name:level," → named stubs', () => {
  assert.deepEqual(parseFaerieField('Danicie:50,Gamedea:50,Pigone:32,'), [
    { $name: 'Danicie', $level: 50 },
    { $name: 'Gamedea', $level: 50 },
    { $name: 'Pigone', $level: 32 },
  ]);
});
test('parseFaerieField: undefined/empty name → level-only (disables identity for the save)', () => {
  assert.deepEqual(parseFaerieField('undefined:50,Gamedea:50,'), [{ $level: 50 }, { $name: 'Gamedea', $level: 50 }]);
  assert.deepEqual(parseFaerieField(':7,'), [{ $level: 7 }]);
  assert.deepEqual(parseFaerieField(''), []);
  assert.deepEqual(parseFaerieField(null), []);
});

// ── mergeFaerieByIdentity: acgi's real fairies ──
// Danicie(50) and Gamedea(50) are healthy; Pigone(32) has degraded stats.
const acgiPrev = [
  { $name: 'Danicie', $level: 50, $exp: 1282578, $pos: 3, $carac: [8, 8, 8, 7, 11, 9] },
  { $name: 'Gamedea', $level: 50, $exp: 146326, $pos: 5, $carac: [10, 9, 9, 10, 24, 20] },
  { $name: 'Pigone', $level: 32, $exp: 1035, $pos: null, $carac: [7, 7, 7, 7, 7, 8] },
];

test('identity merge: reordered save keeps each fairy its OWN rich data (the swap fix)', () => {
  // SWF reports the bocal in a different order than stored — the exact trigger
  // for the old index bug.
  const next = [
    { $name: 'Pigone', $level: 33 },
    { $name: 'Danicie', $level: 50 },
    { $name: 'Gamedea', $level: 50 },
  ];
  const out = mergeFaerieByIdentity(acgiPrev, next);
  const byName = Object.fromEntries(out.map(f => [f.$name, f]));
  // Gamedea must NOT inherit Pigone's exp and vice-versa.
  assert.equal(byName.Gamedea.$exp, 146326);
  assert.deepEqual(byName.Gamedea.$carac, [10, 9, 9, 10, 24, 20]);
  assert.equal(byName.Danicie.$exp, 1282578);
  assert.equal(byName.Pigone.$exp, 1035);
  assert.equal(byName.Pigone.$level, 33); // level update from the pipe wins
  assert.equal(out.length, 3);
});

test('identity merge: never drops a fairy missing from the save (glitch / freed)', () => {
  const next = [{ $name: 'Danicie', $level: 50 }, { $name: 'Gamedea', $level: 50 }];
  const out = mergeFaerieByIdentity(acgiPrev, next);
  const names = out.map(f => f.$name).sort();
  assert.deepEqual(names, ['Danicie', 'Gamedea', 'Pigone']); // Pigone re-attached
  assert.equal(out.find(f => f.$name === 'Pigone').$exp, 1035); // with full rich data
});

test('identity merge: a genuinely new fairy is added (rich data fills in later)', () => {
  const next = [
    { $name: 'Danicie', $level: 50 },
    { $name: 'Gamedea', $level: 50 },
    { $name: 'Pigone', $level: 32 },
    { $name: 'Newbie', $level: 1 },
  ];
  const out = mergeFaerieByIdentity(acgiPrev, next);
  assert.equal(out.length, 4);
  assert.deepEqual(out.find(f => f.$name === 'Newbie'), { $name: 'Newbie', $level: 1 });
});

test('identity merge: no duplicates and no lost fairies (invariant)', () => {
  const next = [{ $name: 'Gamedea', $level: 51 }, { $name: 'Danicie', $level: 50 }];
  const out = mergeFaerieByIdentity(acgiPrev, next);
  const names = out.map(f => f.$name);
  assert.equal(new Set(names).size, names.length, 'no duplicate names');
  for (const p of acgiPrev) assert.ok(names.includes(p.$name), `kept ${p.$name}`);
});

test('identity merge: empty/glitched save never wipes fairies', () => {
  assert.deepEqual(mergeFaerieByIdentity(acgiPrev, []), acgiPrev);
});

// ── legacy index path (old/cached SWF, no names) stays byte-for-byte ──
test('legacy index merge: stubs graft prev rich data by index', () => {
  const prev = [
    { $level: 50, $exp: 100, $carac: [1] },
    { $level: 40, $exp: 200, $carac: [2] },
  ];
  const next = [{ $level: 51 }, { $level: 41 }];
  const out = mergeFaerieByIdentity(prev, next);
  assert.deepEqual(out, [
    { $level: 51, $exp: 100, $carac: [1] },
    { $level: 41, $exp: 200, $carac: [2] },
  ]);
});
test('legacy index merge: shorter save keeps prev entirely', () => {
  const prev = [{ $level: 50, $exp: 1 }, { $level: 40, $exp: 2 }, { $level: 30, $exp: 3 }];
  const out = mergeFaerieByIdentity(prev, [{ $level: 51 }]);
  assert.deepEqual(out, prev);
});
test('mixed names disable identity → index fallback', () => {
  // One unnamed fairy in the save → whole save uses index merge.
  const prev = [{ $name: 'A', $level: 5, $exp: 1 }, { $name: 'B', $level: 6, $exp: 2 }];
  const next = [{ $name: 'A', $level: 5 }, { $level: 6 }];
  const out = mergeFaerieByIdentity(prev, next);
  assert.equal(out.length, 2);
  assert.equal(out[1].$exp, 2); // grafted by index, not name
});
test('names propagate into a previously-nameless slot via index merge', () => {
  const prev = [{ $level: 50, $exp: 100 }, { $level: 40, $exp: 200 }];
  const next = [{ $name: 'A', $level: 50 }, { $name: 'B', $level: 40 }];
  const out = mergeFaerieByIdentity(prev, next);
  assert.equal(out[0].$name, 'A');
  assert.equal(out[0].$exp, 100);
});
