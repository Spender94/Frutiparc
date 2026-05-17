// Per-username bouille (avatar) state cache. Populated when a user logs
// in or their bouille is broadcast via CBee; read by every place that
// needs to render the avatar without going through the user record
// (forum signatures, /api/me/bouille, picto picker preview, …).
//
// Module-level Map-shaped object so all server.js call sites that do
// `bouilleCache[username] = state` continue to work by reference.

const { normalizeBouilleState, DEFAULT_BOUILLE_STATE } = require('../constants/bouille');

const bouilleCache = {};

function bouilleOf(user, username) {
  if (user && user.fbouille) return normalizeBouilleState(user.fbouille);
  if (username && bouilleCache[username]) return normalizeBouilleState(bouilleCache[username]);
  return DEFAULT_BOUILLE_STATE;
}

module.exports = { bouilleCache, bouilleOf };
