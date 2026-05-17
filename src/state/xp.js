// Daily XP-action tracker. Persisted to data/xp-actions.json so it
// survives restarts. Reset at midnight by awardDailyXpToAllActive() in
// server.js (which iterates over keys and clears in place — matches the
// "mutate, don't reassign" rule for this module).
//
// Shape:
//   dailyXpActions[username] = { login, chatMsg, forumTopic, forumPost, gamePlayed }

const fs = require('fs');
const path = require('path');

const { SCORES_DIR } = require('./scores');

const XP_ACTIONS_FILE = path.join(SCORES_DIR, 'xp-actions.json');

const dailyXpActions = {};

function loadXpActions() {
  try {
    if (fs.existsSync(XP_ACTIONS_FILE)) {
      const raw = fs.readFileSync(XP_ACTIONS_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        for (const k of Object.keys(dailyXpActions)) delete dailyXpActions[k];
        Object.assign(dailyXpActions, parsed);
      }
    }
  } catch (e) {
    console.error('[XP] Failed to load xp-actions.json:', e.message);
  }
}

let _xpSaveTimer = null;
function saveXpActions() {
  if (_xpSaveTimer) return;
  _xpSaveTimer = setTimeout(() => {
    _xpSaveTimer = null;
    try {
      fs.writeFileSync(XP_ACTIONS_FILE, JSON.stringify(dailyXpActions), 'utf8');
    } catch (e) {
      console.error('[XP] Failed to save xp-actions.json:', e.message);
    }
  }, 2000);
}

function getXpActions(username) {
  if (!dailyXpActions[username]) {
    dailyXpActions[username] = { login: 0, chatMsg: 0, forumTopic: 0, forumPost: 0, gamePlayed: 0 };
  }
  return dailyXpActions[username];
}

function trackXpAction(username, action) {
  const actions = getXpActions(username);
  actions[action] = (actions[action] || 0) + 1;
  saveXpActions();
}

// XP reward formula per action type (with daily caps).
// Flash formula: level N needs (N-1)^2 * 10000 XP total.
// Lv2=10k, Lv3=40k, Lv4=90k, Lv5=160k.
// Max 10000 XP/day → Lv2 in 1-2j, Lv2→3 in 3-6j.
const XP_REWARDS = {
  login:      { base: 1000, cap: 1  },  // 1000 XP once per day
  chatMsg:    { base: 50,   cap: 50 },  // 50 XP per message, max 2500/day
  forumTopic: { base: 500,  cap: 3  },  // 500 XP per topic, max 1500/day
  forumPost:  { base: 250,  cap: 8  },  // 250 XP per reply, max 2000/day
  gamePlayed: { base: 300,  cap: 10 },  // 300 XP per challenge score, max 3000/day
};

module.exports = {
  dailyXpActions,
  XP_ACTIONS_FILE,
  XP_REWARDS,
  loadXpActions,
  saveXpActions,
  getXpActions,
  trackXpAction,
};
