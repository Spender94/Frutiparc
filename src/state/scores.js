// FrutiScore persistence (data/scores.json).
//
// Shape: { users: { [username]: { [rankingId]: { score, data, updatedAt } } } }
// One ranking per game; ranking id = `<gameName>_classic` for mode 0,
// `<gameName>_challenge` for mode 1.
//
// `scoresData` is a module-scope object that is *mutated*, never
// reassigned, so server.js call sites that do `scoresData.users[u]…`
// continue to work by reference after this extraction. loadScores()
// updates `.users` in place; the same applies to saveScoresFile().

const fs = require('fs');
const path = require('path');
const { parseMtSerializedArray } = require('../util/mt-serialization');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const SCORES_DIR = path.join(PROJECT_ROOT, 'data');
const SCORES_FILE = path.join(SCORES_DIR, 'scores.json');

const scoresData = { users: {} };

function loadScores() {
  try {
    if (fs.existsSync(SCORES_FILE)) {
      const raw = fs.readFileSync(SCORES_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.users) {
        scoresData.users = parsed.users;
      }
    }
  } catch (e) {
    console.error(`[SCORES] load failed: ${e.message}`);
    scoresData.users = {};
  }
  migrateOldBkiwiScores();
}

function migrateOldBkiwiScores() {
  let migrated = 0;
  for (const rlist of Object.values(scoresData.users || {})) {
    for (const oldKey of ['bkiwi_classic', 'bkiwi_challenge']) {
      if (!rlist[oldKey]) continue;
      const entry = rlist[oldKey];
      const track = extractBkiwiTrack(entry.data);
      const suffix = oldKey.endsWith('_challenge') ? 'challenge' : 'classic';
      const newKey = `bkiwi_track${track}_${suffix}`;
      if (!rlist[newKey]) {
        rlist[newKey] = entry;
        migrated++;
      }
      delete rlist[oldKey];
    }
  }
  if (migrated > 0) {
    console.log(`[SCORES] Migrated ${migrated} old bkiwi scores to per-track rankings`);
    saveScoresFile();
  }
}

function saveScoresFile() {
  try {
    if (!fs.existsSync(SCORES_DIR)) fs.mkdirSync(SCORES_DIR, { recursive: true });
    fs.writeFileSync(SCORES_FILE, JSON.stringify(scoresData, null, 2), 'utf8');
  } catch (e) {
    console.error(`[SCORES] save failed: ${e.message}`);
  }
}

// BKiwi's misc data may encode the track id as the second token of a
// colon-, comma-, or MT-serialized list. Defaults to track 5 (the
// canonical "Mistral Kiwi" track used by anonymous/legacy save flows).
function extractBkiwiTrack(rawData) {
  const raw = String(rawData || '').trim();
  if (raw.includes(':')) {
    const parts = raw.split(':');
    if (parts.length >= 2) {
      const t = Number(parts[1]);
      if (Number.isFinite(t) && t >= 0 && t <= 5) return t;
    }
  }
  if (raw.includes(',')) {
    const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const t = Number(parts[1]);
      if (Number.isFinite(t) && t >= 0 && t <= 5) return t;
    }
  }
  const arr = parseMtSerializedArray(raw);
  if (arr && arr.length >= 2) {
    const t = Number(arr[1]);
    if (Number.isFinite(t) && t >= 0 && t <= 5) return t;
  }
  return 5;
}

module.exports = {
  scoresData,
  SCORES_DIR,
  SCORES_FILE,
  loadScores,
  saveScoresFile,
  migrateOldBkiwiScores,
  extractBkiwiTrack,
};
