// Daily challenge medals persistence (data/challenge-medals.json).
//
// Shape: { lastRollDay, medalsByVisibleDay, pendingNotifications }
// - lastRollDay         YYYY-MM-DD of the last midnight roll (Paris TZ)
// - medalsByVisibleDay  { '2026-05-17': { username: { rankingId: 'or' } } }
// - pendingNotifications  notifications waiting for next login per user
//
// Mutated in place; never reassigned. Other modules import the object
// reference and mutate or read directly. loadChallengeMedals() rewrites
// the three top-level fields in place to preserve the same reference.

const fs = require('fs');
const path = require('path');

const { SCORES_DIR } = require('./scores');

const CHALLENGE_MEDALS_FILE = path.join(SCORES_DIR, 'challenge-medals.json');

const challengeMedalsData = {
  lastRollDay: '',
  medalsByVisibleDay: {},
  pendingNotifications: {},
};

function loadChallengeMedals() {
  try {
    if (fs.existsSync(CHALLENGE_MEDALS_FILE)) {
      const raw = fs.readFileSync(CHALLENGE_MEDALS_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        challengeMedalsData.lastRollDay = String(parsed.lastRollDay || '');
        challengeMedalsData.medalsByVisibleDay = parsed.medalsByVisibleDay || {};
        challengeMedalsData.pendingNotifications = parsed.pendingNotifications || {};
      }
    }
  } catch (e) {
    console.error('[CHALLENGE] medal load failed:', e.message);
  }
}

function saveChallengeMedals() {
  try {
    if (!fs.existsSync(SCORES_DIR)) fs.mkdirSync(SCORES_DIR, { recursive: true });
    fs.writeFileSync(CHALLENGE_MEDALS_FILE, JSON.stringify(challengeMedalsData, null, 2), 'utf8');
  } catch (e) {
    console.error('[CHALLENGE] medal save failed:', e.message);
  }
}

module.exports = {
  challengeMedalsData,
  CHALLENGE_MEDALS_FILE,
  loadChallengeMedals,
  saveChallengeMedals,
};
