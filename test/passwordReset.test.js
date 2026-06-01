// Password-reset semantics test.
//
// db.js talks to Postgres (unavailable in this sandbox), so we can't exercise
// the real queries here. Instead we model the SAME logic the SQL implements and
// assert the security-critical properties the feature depends on:
//   - token is stored HASHED (sha256), never plaintext;
//   - a reset is single-use (used_at) and time-limited (expires_at);
//   - requesting a new reset invalidates outstanding ones;
//   - email lookup is case-insensitive.
// If the real SQL in db.js diverges from these rules, this test is the spec to
// check it against.

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

function hashToken(t) { return crypto.createHash('sha256').update(String(t)).digest('hex'); }

// In-memory stand-in mirroring the password_resets table + the four helpers.
function makeStore() {
  const users = [{ id: 1, username: 'alice', email: 'Alice@Example.com' }];
  let resets = []; let seq = 1;
  const now = () => Date.now();
  return {
    users, get resets() { return resets; },
    findUserByEmail(email) {
      const e = String(email || '').toLowerCase();
      return users.find(u => String(u.email || '').toLowerCase() === e) || null;
    },
    createPasswordReset(userId, tokenHash, expiresAtMs) {
      resets.push({ id: seq++, user_id: userId, token_hash: tokenHash, expires_at: expiresAtMs, used_at: null });
    },
    findValidPasswordReset(tokenHash) {
      const r = resets.find(x => x.token_hash === tokenHash && x.used_at == null && x.expires_at > now());
      if (!r) return null;
      const u = users.find(u => u.id === r.user_id);
      return { id: r.id, user_id: r.user_id, username: u && u.username };
    },
    markPasswordResetUsed(id) { const r = resets.find(x => x.id === id); if (r) r.used_at = now(); },
    invalidateUserPasswordResets(userId) {
      resets.forEach(r => { if (r.user_id === userId && r.used_at == null) r.used_at = now(); });
    },
  };
}

const TTL = 60 * 60 * 1000;

test('happy path: request → validate → consume → second use fails', () => {
  const db = makeStore();
  const user = db.findUserByEmail('alice@example.com');
  assert.ok(user, 'email lookup is case-insensitive');

  db.invalidateUserPasswordResets(user.id);
  const token = crypto.randomBytes(32).toString('hex');
  db.createPasswordReset(user.id, hashToken(token), Date.now() + TTL);

  // Stored value is the hash, not the token.
  assert.notStrictEqual(db.resets[db.resets.length - 1].token_hash, token);
  assert.strictEqual(db.resets[db.resets.length - 1].token_hash, hashToken(token));

  // Validate with the plaintext token (server hashes the incoming token).
  const row = db.findValidPasswordReset(hashToken(token));
  assert.ok(row && row.username === 'alice');

  // Consume it.
  db.markPasswordResetUsed(row.id);
  // Second use must fail (single-use).
  assert.strictEqual(db.findValidPasswordReset(hashToken(token)), null);
});

test('expired token is rejected', () => {
  const db = makeStore();
  const user = db.findUserByEmail('alice@example.com');
  const token = crypto.randomBytes(32).toString('hex');
  db.createPasswordReset(user.id, hashToken(token), Date.now() - 1000); // already expired
  assert.strictEqual(db.findValidPasswordReset(hashToken(token)), null);
});

test('requesting a new reset invalidates the previous link', () => {
  const db = makeStore();
  const user = db.findUserByEmail('alice@example.com');

  const t1 = crypto.randomBytes(32).toString('hex');
  db.invalidateUserPasswordResets(user.id);
  db.createPasswordReset(user.id, hashToken(t1), Date.now() + TTL);

  // New request supersedes the old token.
  db.invalidateUserPasswordResets(user.id);
  const t2 = crypto.randomBytes(32).toString('hex');
  db.createPasswordReset(user.id, hashToken(t2), Date.now() + TTL);

  assert.strictEqual(db.findValidPasswordReset(hashToken(t1)), null, 'old token dead');
  assert.ok(db.findValidPasswordReset(hashToken(t2)), 'new token valid');
});

test('unknown email yields no reset row (no enumeration side effect)', () => {
  const db = makeStore();
  const user = db.findUserByEmail('nobody@example.com');
  assert.strictEqual(user, null);
  // Server would skip createPasswordReset and still return the generic message.
  assert.strictEqual(db.resets.length, 0);
});

test('token format the server enforces is 64 hex chars', () => {
  const token = crypto.randomBytes(32).toString('hex');
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.match(hashToken(token), /^[0-9a-f]{64}$/);
});
