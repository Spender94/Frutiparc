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

// ── parseFaerieField: format RICHE (nouveau patch — l'état complet voyage) ──
test('parseFaerieField: token riche → tous les champs de la fée', () => {
  // name:level:humor:exp:hunger:moral:bagMax:shot:life:mana:mission:pos
  //  :carac~:skin~:next~:inv~:spell~:spellCoef~:mood~:behaviour~:tasteLikes~:tasteDislikes~
  const tok = 'Lumina:4:3:1287:9:10:4:0:18:6::3'
    + ':3~1~1~1~1~1:2~111~222~333:0~0:5~~12:20~0~7:1~2:8:0:1~3:2~9';
  const [f] = parseFaerieField(tok + ',');
  assert.equal(f.$name, 'Lumina');
  assert.equal(f.$level, 4);
  assert.equal(f.$humor, 3);
  assert.equal(f.$exp, 1287);
  assert.equal(f.$hunger, 9);
  assert.equal(f.$moral, 10);
  assert.equal(f.$bagMax, 4);
  assert.equal(f.$shot, 0);
  assert.equal(f.$life, 18);
  assert.equal(f.$mana, 6);
  assert.equal(f.$mission, null);     // champ vide → null
  assert.equal(f.$pos, 3);
  assert.deepEqual(f.$carac, [3, 1, 1, 1, 1, 1]);
  assert.deepEqual(f.$skin, [2, 111, 222, 333]);
  assert.deepEqual(f.$next, [0, 0]);
  assert.deepEqual(f.$inv, [5, null, 12]);   // trou de sac → null
  assert.deepEqual(f.$spell, [20, 0, 7]);    // inclut le crapaud si présent
  assert.deepEqual(f.$spellCoef, [1, 2]);
  assert.deepEqual(f.$mood, [8]);
  assert.deepEqual(f.$behaviour, [0]);
  assert.deepEqual(f.$taste, [[1, 3], [2, 9]]);
});
test('parseFaerieField: legacy et riche cohabitent dans le même champ', () => {
  const out = parseFaerieField('Danicie:50,Lumina:4:3:1287:9:10:4:0:18:6::3:3~1~1~1~1~1:2~1~1~1::5:20~0:::::,');
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { $name: 'Danicie', $level: 50 });  // legacy intact
  assert.equal(out[1].$name, 'Lumina');
  assert.deepEqual(out[1].$carac, [3, 1, 1, 1, 1, 1]);
  assert.deepEqual(out[1].$inv, [5]);
});
test('identity merge: un token riche ÉCRASE l\'ancien état synthétisé (le vrai fix 2/3/4)', () => {
  const prev = [{ $name: 'Lumina', $level: 4, $skin: [0, 1, 1, 1], $carac: [1, 1, 1, 1, 1, 1], $inv: [], $hunger: 4, $exp: 0 }];
  const next = parseFaerieField('Lumina:4:3:1287:9:10:4:0:18:6::3:3~1~1~1~1~1:2~111~222~333:0~0:5~12:20~0::::1~3:2~9,');
  const [m] = mergeFaerieByIdentity(prev, next);
  assert.equal(m.$name, 'Lumina');
  assert.deepEqual(m.$skin, [2, 111, 222, 333]);   // valeur réelle conservée (cheveux)
  assert.deepEqual(m.$carac, [3, 1, 1, 1, 1, 1]);  // carac choisie au level-up
  assert.deepEqual(m.$inv, [5, 12]);               // équipement conservé
  assert.equal(m.$hunger, 9);                       // faim conservée
  assert.equal(m.$exp, 1287);                       // exp dans le niveau conservée
  assert.deepEqual(m.$taste, [[1, 3], [2, 9]]);     // goûts conservés
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

// ── synthesizeFaerieDefaults : réparation des fées-stubs de l'ère pipe ──
const { synthesizeFaerieDefaults, faerieNameHash } = require('../minipixizFaerie');

test('synthesize: un stub {$name,$level} devient une fée complète et jouable', () => {
  const f = { $name: 'Lumina', $level: 3 };
  const changed = synthesizeFaerieDefaults(f);
  assert.equal(changed, true);
  assert.equal(f.$name, 'Lumina');
  assert.equal(f.$level, 3);                      // les champs du pipe restent maîtres
  assert.equal(f.$skin.length, 4);                // portrait stable (corps + 3 couleurs)
  assert.ok(f.$skin[0] >= 0 && f.$skin[0] <= 5);
  assert.deepEqual(f.$carac, [1, 1, 1, 1, 1, 1]); // stats de base genFaerieSeed
  assert.deepEqual(f.$inv, []);                   // cases d'équipement présentes
  assert.equal(f.$taste.length, 2);               // goûts/dégoûts pour le nourrissage
  assert.notEqual(f.$taste[0][0], f.$taste[1][0]);
  assert.ok(f.$taste[0][0] >= 0 && f.$taste[0][0] <= 9);
  assert.ok(Array.isArray(f.$behaviour) && Array.isArray(f.$mood));
  assert.ok(f.$life >= 1);                        // jamais morte-née
  assert.ok(f.$mana >= 0);
  assert.equal(f.$moral, 10);                     // ≠ 0 ($d % $moral dans upkeep)
  assert.equal(f.$pos, null);                     // « en main »
  assert.deepEqual(f.$next, [0, 0]);              // état pré-setNextLevelUp légitime
});

test('synthesize: déterministe par nom — même skin à chaque chargement', () => {
  const a = { $name: 'Pigone', $level: 7 };
  const b = { $name: 'Pigone', $level: 12 };
  synthesizeFaerieDefaults(a);
  synthesizeFaerieDefaults(b);
  assert.deepEqual(a.$skin, b.$skin);
  assert.deepEqual(a.$taste, b.$taste);
  assert.equal(a.$humor, b.$humor);
  // deux noms différents → skins différents (presque sûrement)
  const c = { $name: 'Gamedea', $level: 7 };
  synthesizeFaerieDefaults(c);
  assert.notDeepEqual(a.$skin, c.$skin);
});

test('synthesize: ne touche JAMAIS un champ riche existant', () => {
  const f = {
    $name: 'Danicie', $level: 50, $skin: [2, 111, 222, 333],
    $carac: [9, 8, 7, 6, 5, 4], $inv: [12, null], $taste: [[3], [8]],
    $exp: 1035, $life: 7, $mana: 8, $moral: 0, $hunger: 17,
    $pos: 4, $mission: 2, $behaviour: [], $mood: [1], $next: [5, 2],
    $spell: [20, 3], $spellCoef: [1], $bagMax: 4, $humor: 6, $shot: 2,
  };
  const before = JSON.parse(JSON.stringify(f));
  synthesizeFaerieDefaults(f);
  assert.deepEqual(f, before);                    // riche → strictement inchangée
});

test('synthesize: complète les champs manquants un par un (fée semi-riche)', () => {
  const f = { $name: 'Mira', $level: 5, $skin: [1, 10, 20, 30], $exp: 99 };
  synthesizeFaerieDefaults(f);
  assert.deepEqual(f.$skin, [1, 10, 20, 30]);     // skin existant conservé
  assert.equal(f.$exp, 99);
  assert.deepEqual(f.$carac, [1, 1, 1, 1, 1, 1]); // manquant → défaut
});

test('synthesize: entrées non-objet refusées sans crash', () => {
  assert.equal(synthesizeFaerieDefaults(null), false);
  assert.equal(synthesizeFaerieDefaults([1, 2]), false);
  assert.equal(synthesizeFaerieDefaults('Pigone'), false);
});

test('faerieNameHash : stable et sans nom = 0 géré', () => {
  assert.equal(faerieNameHash('Pigone'), faerieNameHash('Pigone'));
  assert.equal(typeof faerieNameHash(undefined), 'number');
});
