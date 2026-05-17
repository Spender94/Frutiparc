// Per-IP rate limiter for admin endpoints.
//
// Far tighter than the register limit (40 requests / 10 min) — admins
// are humans clicking a UI, not a script. The cap also throttles
// accidental hot-loops and bruteforce probing of ADMIN_KEY.
// Failed-auth and successful requests both count.

const ADMIN_RL_WINDOW_MS = 10 * 60 * 1000;
const ADMIN_RL_MAX = 40;

const adminAttempts = new Map();   // ip → number[] (timestamps)

function checkAdminRateLimit(ip) {
  const now = Date.now();
  let arr = adminAttempts.get(ip);
  if (!arr) { arr = []; adminAttempts.set(ip, arr); }
  while (arr.length && now - arr[0] >= ADMIN_RL_WINDOW_MS) arr.shift();
  if (arr.length >= ADMIN_RL_MAX) return false;
  arr.push(now);
  return true;
}

// Periodically prune empty buckets to keep the map bounded.
setInterval(() => {
  const now = Date.now();
  for (const [ip, arr] of adminAttempts) {
    while (arr.length && now - arr[0] >= ADMIN_RL_WINDOW_MS) arr.shift();
    if (arr.length === 0) adminAttempts.delete(ip);
  }
}, ADMIN_RL_WINDOW_MS).unref?.();

module.exports = {
  ADMIN_RL_WINDOW_MS,
  ADMIN_RL_MAX,
  adminAttempts,
  checkAdminRateLimit,
};
