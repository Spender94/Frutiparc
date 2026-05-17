// In-memory session store + IP fallback map.
//
// `sessions` maps sid → { user, createdAt }. Created by /do/init (anonymous)
// or /api/auth/login (bound to a real user). Persisted in the DB for
// authenticated sessions so they survive restarts.
//
// `recentSidByIp` is a fallback for legacy SWF endpoints that occasionally
// fire without forwarding the sid query param — we look it up by client IP.

const sessions = {};               // sid → { user, createdAt }
const recentSidByIp = new Map();   // ip → sid

module.exports = { sessions, recentSidByIp };
