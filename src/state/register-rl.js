// Per-IP rate limiter for /api/auth/register.
//
// Sliding window: at most REGISTER_MAX attempts per REGISTER_WINDOW_MS,
// plus a hard cap of REGISTER_DAILY_MAX successful registrations per day.

const REGISTER_WINDOW_MS = 60 * 60 * 1000;  // 1 hour
const REGISTER_MAX = 5;                      // 5 attempts/hour/IP
const REGISTER_DAILY_MAX = 10;               // 10 successful regs/day/IP

const registerAttempts = new Map();  // ip → { attempts: number[], successDay, successCount }

function checkRegisterRateLimit(ip) {
  const now = Date.now();
  const todayKey = new Date(now).toISOString().slice(0, 10);
  let rec = registerAttempts.get(ip);
  if (!rec) {
    rec = { attempts: [], successDay: todayKey, successCount: 0 };
    registerAttempts.set(ip, rec);
  }
  rec.attempts = rec.attempts.filter((t) => now - t < REGISTER_WINDOW_MS);
  if (rec.successDay !== todayKey) {
    rec.successDay = todayKey;
    rec.successCount = 0;
  }
  if (rec.attempts.length >= REGISTER_MAX) return false;
  if (rec.successCount >= REGISTER_DAILY_MAX) return false;
  rec.attempts.push(now);
  return true;
}

function recordSuccessfulRegister(ip) {
  const rec = registerAttempts.get(ip);
  if (rec) rec.successCount++;
}

// Periodically prune empty entries to keep the map bounded.
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of registerAttempts) {
    rec.attempts = rec.attempts.filter((t) => now - t < REGISTER_WINDOW_MS);
    if (rec.attempts.length === 0 && rec.successCount === 0) {
      registerAttempts.delete(ip);
    }
  }
}, 10 * 60 * 1000).unref();

module.exports = {
  REGISTER_WINDOW_MS,
  REGISTER_MAX,
  REGISTER_DAILY_MAX,
  registerAttempts,
  checkRegisterRateLimit,
  recordSuccessfulRegister,
};
