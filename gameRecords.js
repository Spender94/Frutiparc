'use strict';

// Records classables extraits d'une carte de jeu (slot 0).
//
// L'import admin charge la progression + les pictos, mais le record de chaque
// jeu vit dans un champ de la carte qui DIFFÈRE par jeu (c'est l'inverse de
// patchSlot0, qui fait scores → carte). Cette table mappe carte → record(s)
// pour que l'import puisse les publier dans le livre des records du Club.
//
// On vise toujours le classement `_classic` (type C = groupe « Challenge
// (Classique) » du Club = ce que les joueurs appellent « challenge »). Les
// classements `_challenge` (type L = « Championnat ») ne sont PAS alimentés
// par un record de carte (séries Grapiz, Frutibandas… = mécaniques à part).
//
// bkiwi est volontairement absent : le livre des records reconstruit déjà ses
// meilleurs temps par circuit directement depuis la carte importée
// (cf. /api/club/records), donc rien à injecter.
//
// Le caller valide chaque rankingId contre RANKINGS et ne publie un record
// que s'il bat le meilleur déjà connu (live ∪ archive).
// Jeux dont la carte (slot 0) porte un record classable — la même liste que
// le switch d'extractRecordsFromSlot. Sert au backfill admin (re-balayer les
// cartes déjà importées) sans dupliquer la connaissance des jeux ici et là.
const RECORD_GAMES = ['snake3', 'swapou2', 'mb2', 'jamajama'];

function extractRecordsFromSlot(game, obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return [];
  const out = [];
  const push = (rankingId, score, data) => {
    const n = Number(score);
    if (Number.isFinite(n) && n > 0) {
      out.push({ rankingId, score: Math.trunc(n), data: data || '' });
    }
  };
  switch (game) {
    case 'snake3':   push('snake3_classic', obj.$record); break;        // record perso
    case 'swapou2':  push('swapou2_classic', obj.$record); break;       // mode Challenge
    case 'mb2':      push('mb2_classic', obj.$classic_score); break;    // meilleur score classique
    case 'jamajama': push('jamajama_classic', obj.$best); break;        // (temps : lowerIsBetter)
  }
  return out;
}

// Décide quels records importés écrire dans l'archive : on ne garde que ceux
// qui battent STRICTEMENT le meilleur déjà connu (live ∪ archive). Pur et
// testable — `isBetter(rankingId, newScore, newData, oldScore, oldData)` est
// injecté (server passe isScoreBetter, qui gère le sens de tri par jeu).
//
//   records   : [{ rankingId, score, data }]  (sortie d'extractRecordsFromSlot)
//   liveByRk  : { rankingId → { score, data } }   (table `scores` live)
//   archiveRows : [{ ranking_id, score, data }]   (toutes journées d'archive)
function pickRecordsToArchive(records, liveByRk, archiveRows, isBetter) {
  const best = {}; // rankingId → { score, data }
  const consider = (rk, score, data) => {
    if (!records.some((r) => r.rankingId === rk)) return;
    const n = Number(score);
    if (!Number.isFinite(n)) return;
    const cur = best[rk];
    if (!cur || isBetter(rk, n, data || '', cur.score, cur.data)) best[rk] = { score: n, data: data || '' };
  };
  for (const rk of Object.keys(liveByRk || {})) {
    const e = liveByRk[rk];
    if (e) consider(rk, e.score, e.data);
  }
  for (const r of archiveRows || []) consider(r.ranking_id, r.score, r.data);

  const out = [];
  for (const rec of records) {
    const cur = best[rec.rankingId];
    if (!cur || isBetter(rec.rankingId, rec.score, rec.data, cur.score, cur.data)) out.push(rec);
  }
  return out;
}

module.exports = { extractRecordsFromSlot, pickRecordsToArchive, RECORD_GAMES };
