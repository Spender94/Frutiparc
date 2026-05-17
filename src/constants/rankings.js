// Score rankings registry — one entry per game × mode combination.
//
// `type`: 'C' = classic (no time limit), 'L' = challenge (daily-reset).
// `lowerIsBetter`: time-based scores (BKiwi laps, MotionBall solve time…).
// `bkiwiTrack`: per-track BKiwi rankings (0-5, one per track).
const { escapeXml } = require('../util/xml');

const BKIWI_TRACK_NAMES = [
  'Green Hill', 'Banana Derby', 'Terre Grise', 'Solstice', 'Jupiter IV', 'Mistral Kiwi',
];

const RANKINGS = {
  bkiwi_track0_classic: { name: 'Burning Kiwi - Green Hill', game: 'bkiwi', type: 'C', lowerIsBetter: true, bkiwiTrack: 0 },
  bkiwi_track1_classic: { name: 'Burning Kiwi - Banana Derby', game: 'bkiwi', type: 'C', lowerIsBetter: true, bkiwiTrack: 1 },
  bkiwi_track2_classic: { name: 'Burning Kiwi - Terre Grise', game: 'bkiwi', type: 'C', lowerIsBetter: true, bkiwiTrack: 2 },
  bkiwi_track3_classic: { name: 'Burning Kiwi - Solstice', game: 'bkiwi', type: 'C', lowerIsBetter: true, bkiwiTrack: 3 },
  bkiwi_track4_classic: { name: 'Burning Kiwi - Jupiter IV', game: 'bkiwi', type: 'C', lowerIsBetter: true, bkiwiTrack: 4 },
  bkiwi_track5_classic: { name: 'Burning Kiwi - Mistral Kiwi', game: 'bkiwi', type: 'C', lowerIsBetter: true, bkiwiTrack: 5 },
  snake3_classic:   { name: 'Frutisnake - Classique',  game: 'snake3',   type: 'C' },
  kaluga_classic:   { name: 'Kaluga - Classique',      game: 'kaluga',   type: 'C' },
  swapou2_classic:  { name: 'Swapou - Classique',      game: 'swapou2',  type: 'C' },
  mb2_classic:      { name: 'MotionBall - Classique',  game: 'mb2',      type: 'C', lowerIsBetter: true },
  jamajama_classic: { name: 'JamaJama - Classique',    game: 'jamajama', type: 'C', lowerIsBetter: true },
  bkiwi_track0_challenge: { name: 'Burning Kiwi - Green Hill', game: 'bkiwi', type: 'L', lowerIsBetter: true, bkiwiTrack: 0 },
  bkiwi_track1_challenge: { name: 'Burning Kiwi - Banana Derby', game: 'bkiwi', type: 'L', lowerIsBetter: true, bkiwiTrack: 1 },
  bkiwi_track2_challenge: { name: 'Burning Kiwi - Terre Grise', game: 'bkiwi', type: 'L', lowerIsBetter: true, bkiwiTrack: 2 },
  bkiwi_track3_challenge: { name: 'Burning Kiwi - Solstice', game: 'bkiwi', type: 'L', lowerIsBetter: true, bkiwiTrack: 3 },
  bkiwi_track4_challenge: { name: 'Burning Kiwi - Jupiter IV', game: 'bkiwi', type: 'L', lowerIsBetter: true, bkiwiTrack: 4 },
  bkiwi_track5_challenge: { name: 'Burning Kiwi - Mistral Kiwi', game: 'bkiwi', type: 'L', lowerIsBetter: true, bkiwiTrack: 5 },
  snake3_challenge:   { name: 'Frutisnake - Challenge',   game: 'snake3',   type: 'L' },
  kaluga_challenge:   { name: 'Kaluga - Challenge',       game: 'kaluga',   type: 'L' },
  swapou2_challenge:  { name: 'Swapou - Challenge',       game: 'swapou2',  type: 'L' },
  mb2_challenge:      { name: 'MotionBall - Challenge',   game: 'mb2',      type: 'L', lowerIsBetter: true },
  bandas_challenge:   { name: 'Frutibandas - Challenge',  game: 'bandas',   type: 'L' },
  grapiz_challenge:   { name: 'Grapiz - Challenge',       game: 'grapiz',   type: 'L' },
};

// Legacy FrutiScore wire descriptors (numeric rk ids used by original clients).
const LEGACY_RANKINGS = [
  // Section C = "Challenge" in front-end
  // BKiwi uses per-track rankings; legacy rk '0' maps to track 5 (the default challenge track)
  { rk: '0', internal: 'bkiwi_track5_classic', ty: 'millisecond', rn: 'Burning kiwi', gs: '0', g: 'bkiwi',  section: 'C' },
  { rk: '1', internal: 'snake3_classic',   ty: 'point',       rn: 'Frutisnake 2', gs: '1', g: 'snake3', section: 'C' },
  { rk: '2', internal: 'mb2_classic',      ty: 'ptmb2',       rn: 'Motion Ball 2',gs: '2', g: 'mb2',    section: 'C' },
  { rk: '3', internal: 'swapou2_classic',  ty: 'point',       rn: 'Swapou 2',     gs: '3', g: 'swapou2',section: 'C' },
  { rk: '4', internal: 'kaluga_classic',   ty: 'point',       rn: 'Kaluga',       gs: '4', g: 'kaluga', section: 'C' },
  { rk: '5', internal: null,               ty: 'point',       rn: 'Frutibandas',  gs: '5', g: 'bandas', section: 'C' },
  { rk: '6', internal: null,               ty: 'point',       rn: 'Grapiz',       gs: '6', g: 'grapiz', section: 'C' },
  // Section L = "Championnat" in front-end — only Frutibandas and Grapiz
  { rk: '7', internal: 'bandas_challenge',  ty: 'point',       rn: 'Frutibandas',  gs: '5', g: 'bandas', section: 'L' },
  { rk: '8', internal: 'grapiz_challenge',  ty: 'point',       rn: 'Grapiz',       gs: '6', g: 'grapiz', section: 'L' },
];

const LEGACY_RK_TO_INTERNAL = Object.fromEntries(
  LEGACY_RANKINGS.filter((r) => r.internal).map((r) => [r.rk, r.internal])
);
const INTERNAL_TO_LEGACY_RK = Object.fromEntries([
  ...LEGACY_RANKINGS.filter((r) => r.internal).map((r) => [r.internal, r.rk]),
  ...Array.from({ length: 6 }, (_, i) => [`bkiwi_track${i}_challenge`, '0']),
]);

// Daily-reset rankings = rankings displayed in the front-end "Challenge"
// tab (section C of LEGACY_RANKINGS) plus all BKiwi per-track challenge
// rankings (which rotate daily based on dayOfYear % 6).
// BKiwi classic was previously the daily proxy; replaced by proper _challenge
// rankings so we exclude it to avoid duplicate medal awards.
const DAILY_RESET_RANKING_SET = new Set([
  ...LEGACY_RANKINGS.filter((r) => r.section === 'C' && r.internal && r.internal !== 'bkiwi_track5_classic').map((r) => r.internal),
  ...Array.from({ length: 6 }, (_, i) => `bkiwi_track${i}_challenge`),
]);

function challengeRankingIds() {
  return Array.from(DAILY_RESET_RANKING_SET);
}

function isDailyResetRanking(rkId) {
  return DAILY_RESET_RANKING_SET.has(rkId);
}

function legacyDescriptorFromRkLike(rkLike) {
  const raw = String(rkLike || '').trim();
  if (!raw) return null;
  return LEGACY_RANKINGS.find((r) => r.rk === raw || r.internal === raw) || null;
}

// Build the <w gs="N"><ds>…</ds></w> per-game score-info payload sent to
// FrutiScore clients. Each game declares its own column descriptors.
function buildLegacyGameScoreInfo(gs) {
  const game = Number(gs);
  let inner = '';
  if (game === 0) {
    inner += '<desc n="Ecurie" t="s" w="60">bkiwi_team</desc>';
    inner += '<desc n="Rang" t="s" w="60">bkiwi_rank</desc>';
  } else if (game === 3) {
    inner += '<desc n="Perso" t="s" w="45">swapou_score_chars</desc>';
  } else if (game === 4) {
    inner += '<desc n="Tzongre" t="s" w="60">kaluga_tz</desc>';
  }
  return `<w gs="${Number.isFinite(game) ? game : 0}"><ds>${inner}</ds></w>`;
}

function buildLegacyRankingResultPayload(rkInput, reqId = '', cAttr = '') {
  const rk = String(rkInput || '');
  const r = reqId ? ` r="${escapeXml(reqId)}"` : '';
  const c = cAttr ? ` c="${escapeXml(cAttr)}"` : '';
  const legacyDesc = legacyDescriptorFromRkLike(rk);
  const ty = legacyDesc && legacyDesc.ty ? ` ty="${escapeXml(legacyDesc.ty)}"` : '';
  return `<m${r}${ty} rk="${escapeXml(rk)}"${c}></m>`;
}

const GAME_DISPLAY_NAMES = {
  bkiwi: 'Burning Kiwi', snake3: 'Frutisnake', kaluga: 'Kaluga',
  swapou2: 'Swapou', miniwave2: 'MiniWave', miniwave: 'MiniWave', mb2: 'MotionBall',
  bandas: 'Frutibandas', grapiz: 'Grapiz', minipixiz: 'MiniPixiz',
};

const MEDAL_DISPLAY_NAMES = { or: "d'or", argent: "d'argent", bronze: 'de bronze' };

module.exports = {
  BKIWI_TRACK_NAMES,
  RANKINGS,
  LEGACY_RANKINGS,
  LEGACY_RK_TO_INTERNAL,
  INTERNAL_TO_LEGACY_RK,
  DAILY_RESET_RANKING_SET,
  GAME_DISPLAY_NAMES,
  MEDAL_DISPLAY_NAMES,
  challengeRankingIds,
  isDailyResetRanking,
  legacyDescriptorFromRkLike,
  buildLegacyGameScoreInfo,
  buildLegacyRankingResultPayload,
};
