'use strict';

// Mapping carte → record(s) classable(s) (gameRecords.extractRecordsFromSlot).
// Le champ porteur diffère par jeu : un mauvais nom de champ ici = des records
// importés qui n'apparaissent jamais dans le livre des records.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractRecordsFromSlot } = require('../gameRecords');

test('snake3 : $record → snake3_classic', () => {
  assert.deepEqual(extractRecordsFromSlot('snake3', { $record: 1234 }),
    [{ rankingId: 'snake3_classic', score: 1234, data: '' }]);
});

test('swapou2 : $record (mode Challenge) → swapou2_classic', () => {
  assert.deepEqual(extractRecordsFromSlot('swapou2', { $record: 53000, $classic_record: 999 }),
    [{ rankingId: 'swapou2_classic', score: 53000, data: '' }]);
  // $classic_record (mode classique, non classé) est ignoré
});

test('mb2 : $classic_score → mb2_classic', () => {
  assert.deepEqual(extractRecordsFromSlot('mb2', { $classic_score: 87 }),
    [{ rankingId: 'mb2_classic', score: 87, data: '' }]);
});

test('jamajama : $best → jamajama_classic', () => {
  assert.deepEqual(extractRecordsFromSlot('jamajama', { $best: 42 }),
    [{ rankingId: 'jamajama_classic', score: 42, data: '' }]);
});

test('records nuls/absents/négatifs ignorés', () => {
  assert.deepEqual(extractRecordsFromSlot('snake3', { $record: 0 }), []);
  assert.deepEqual(extractRecordsFromSlot('snake3', {}), []);
  assert.deepEqual(extractRecordsFromSlot('snake3', { $record: -5 }), []);
  assert.deepEqual(extractRecordsFromSlot('snake3', { $record: 'abc' }), []);
});

test('scores fractionnaires tronqués (entiers en base)', () => {
  assert.deepEqual(extractRecordsFromSlot('snake3', { $record: 1234.9 }),
    [{ rankingId: 'snake3_classic', score: 1234, data: '' }]);
});

test('bkiwi exclu (reconstruit depuis la carte par le livre des records)', () => {
  assert.deepEqual(extractRecordsFromSlot('bkiwi', { $ts: { $t0: { $bc: 5000, $bl: 4000 } } }), []);
});

test('jeux sans record classable → []', () => {
  assert.deepEqual(extractRecordsFromSlot('kaluga', { $tz: { 1: true } }), []);
  assert.deepEqual(extractRecordsFromSlot('miniwave', { $vs: 9 }), []);
  assert.deepEqual(extractRecordsFromSlot('minipixiz', { $stat: { $run: 99 } }), []);
});

test('entrées non-objet refusées sans crash', () => {
  assert.deepEqual(extractRecordsFromSlot('snake3', null), []);
  assert.deepEqual(extractRecordsFromSlot('snake3', [1, 2]), []);
  assert.deepEqual(extractRecordsFromSlot('snake3', 'x'), []);
});

// ── pickRecordsToArchive : on n'écrit que si STRICTEMENT meilleur ──────────
const { pickRecordsToArchive } = require('../gameRecords');

// isBetter de test : higher-better sauf rankings « _time » (lower-better),
// avec oldScore=0 traité comme « rien » (comme isScoreBetter du serveur).
function isBetter(rk, ns, nd, os, od) {
  const lower = rk.endsWith('_time');
  return lower ? (os === 0 || ns < os) : ns > os;
}

test('aucun record existant → tout est écrit', () => {
  const recs = [{ rankingId: 'snake3_classic', score: 100, data: '' }];
  assert.deepEqual(pickRecordsToArchive(recs, {}, [], isBetter), recs);
});

test('record importé meilleur que le live → écrit', () => {
  const recs = [{ rankingId: 'snake3_classic', score: 200, data: '' }];
  const live = { snake3_classic: { score: 150, data: '' } };
  assert.deepEqual(pickRecordsToArchive(recs, live, [], isBetter), recs);
});

test('record importé PIRE que le live → ignoré (pas de régression du record)', () => {
  const recs = [{ rankingId: 'snake3_classic', score: 90, data: '' }];
  const live = { snake3_classic: { score: 150, data: '' } };
  assert.deepEqual(pickRecordsToArchive(recs, live, [], isBetter), []);
});

test('record importé pire que l\'archive (autre jour) → ignoré', () => {
  const recs = [{ rankingId: 'snake3_classic', score: 90, data: '' }];
  const arch = [{ ranking_id: 'snake3_classic', score: 300, data: '' }];
  assert.deepEqual(pickRecordsToArchive(recs, {}, arch, isBetter), []);
});

test('record importé meilleur que live ET archive → écrit', () => {
  const recs = [{ rankingId: 'snake3_classic', score: 500, data: '' }];
  const live = { snake3_classic: { score: 150, data: '' } };
  const arch = [{ ranking_id: 'snake3_classic', score: 300, data: '' }];
  assert.deepEqual(pickRecordsToArchive(recs, live, arch, isBetter), recs);
});

test('égalité → non écrit (strictement meilleur requis)', () => {
  const recs = [{ rankingId: 'snake3_classic', score: 150, data: '' }];
  const live = { snake3_classic: { score: 150, data: '' } };
  assert.deepEqual(pickRecordsToArchive(recs, live, [], isBetter), []);
});

test('classement lower-better (temps) respecté', () => {
  const recs = [{ rankingId: 'foo_time', score: 80, data: '' }];
  const live = { foo_time: { score: 100, data: '' } }; // 80 < 100 → meilleur
  assert.deepEqual(pickRecordsToArchive(recs, live, [], isBetter), recs);
  const recs2 = [{ rankingId: 'foo_time', score: 120, data: '' }];
  assert.deepEqual(pickRecordsToArchive(recs2, live, [], isBetter), []);
});

test('les lignes d\'archive/live d\'AUTRES classements sont ignorées', () => {
  const recs = [{ rankingId: 'snake3_classic', score: 100, data: '' }];
  const live = { swapou2_classic: { score: 99999, data: '' } };
  const arch = [{ ranking_id: 'mb2_classic', score: 99999, data: '' }];
  assert.deepEqual(pickRecordsToArchive(recs, live, arch, isBetter), recs);
});
