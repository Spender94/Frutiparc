const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('render.com')
    ? { rejectUnauthorized: false }
    : undefined,
  connectionTimeoutMillis: 5000,
  query_timeout: 5000,
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err.message);
});

async function initSchema() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id               SERIAL PRIMARY KEY,
        username         TEXT UNIQUE NOT NULL,
        password         TEXT NOT NULL,
        xp               INTEGER DEFAULT 1,
        kikooz           INTEGER DEFAULT 60,
        fbouille         TEXT DEFAULT '000000010000000000000000',
        gender           TEXT DEFAULT 'M',
        birthday         DATE DEFAULT '1990-05-15',
        country          TEXT DEFAULT 'FR',
        region           TEXT DEFAULT 'IDF',
        prefs            TEXT DEFAULT '',
        is_moderator     BOOLEAN DEFAULT false,
        needs_bouille    BOOLEAN DEFAULT true,
        first_name       TEXT DEFAULT '',
        last_name        TEXT DEFAULT '',
        last_name_public TEXT DEFAULT 'Y',
        real_job         TEXT DEFAULT '',
        city             TEXT DEFAULT '',
        country_index    TEXT DEFAULT '1',
        region_index     TEXT DEFAULT '1',
        department_index TEXT DEFAULT '1',
        site_url         TEXT DEFAULT '',
        comment          TEXT DEFAULT '',
        created_at       TIMESTAMPTZ DEFAULT now(),
        updated_at       TIMESTAMPTZ DEFAULT now()
      );

      -- Profile columns added after initial schema
      DO $$ BEGIN
        ALTER TABLE users ALTER COLUMN xp SET DEFAULT 1;
        ALTER TABLE users ALTER COLUMN kikooz SET DEFAULT 60;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name TEXT DEFAULT '';
        ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name TEXT DEFAULT '';
        ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name_public TEXT DEFAULT 'Y';
        ALTER TABLE users ADD COLUMN IF NOT EXISTS real_job TEXT DEFAULT '';
        ALTER TABLE users ADD COLUMN IF NOT EXISTS city TEXT DEFAULT '';
        ALTER TABLE users ADD COLUMN IF NOT EXISTS country_index TEXT DEFAULT '1';
        ALTER TABLE users ADD COLUMN IF NOT EXISTS region_index TEXT DEFAULT '1';
        ALTER TABLE users ADD COLUMN IF NOT EXISTS department_index TEXT DEFAULT '1';
        ALTER TABLE users ADD COLUMN IF NOT EXISTS site_url TEXT DEFAULT '';
        ALTER TABLE users ADD COLUMN IF NOT EXISTS comment TEXT DEFAULT '';
      EXCEPTION WHEN OTHERS THEN NULL;
      END $$;

      CREATE TABLE IF NOT EXISTS sessions (
        sid         TEXT PRIMARY KEY,
        user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
        created_at  TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS user_items (
        user_id   INTEGER REFERENCES users(id) ON DELETE CASCADE,
        item_id   INTEGER NOT NULL,
        PRIMARY KEY (user_id, item_id)
      );

      CREATE TABLE IF NOT EXISTS scores (
        user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
        ranking_id  TEXT NOT NULL,
        score       BIGINT NOT NULL,
        data        TEXT DEFAULT '',
        updated_at  TIMESTAMPTZ DEFAULT now(),
        PRIMARY KEY (user_id, ranking_id)
      );

      CREATE INDEX IF NOT EXISTS idx_scores_ranking ON scores(ranking_id, score);

      CREATE TABLE IF NOT EXISTS fruti_slots (
        user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
        game       TEXT NOT NULL,
        slot_id    SMALLINT NOT NULL,
        data       TEXT DEFAULT '',
        updated_at TIMESTAMPTZ DEFAULT now(),
        PRIMARY KEY (user_id, game, slot_id)
      );

      CREATE TABLE IF NOT EXISTS user_accessories (
        id         SERIAL PRIMARY KEY,
        user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
        acc_id     TEXT NOT NULL,
        shop_id    INTEGER,
        name       TEXT DEFAULT '',
        value      TEXT DEFAULT '',
        quantity   TEXT DEFAULT '',
        price      TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_user_accessories_user ON user_accessories(user_id);

      CREATE TABLE IF NOT EXISTS contacts (
        user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
        contact_name TEXT NOT NULL,
        folder       TEXT DEFAULT 'mycontact',
        created_at   TIMESTAMPTZ DEFAULT now(),
        PRIMARY KEY (user_id, contact_name)
      );

      CREATE TABLE IF NOT EXISTS blacklist (
        user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
        blocked_name TEXT NOT NULL,
        created_at   TIMESTAMPTZ DEFAULT now(),
        PRIMARY KEY (user_id, blocked_name)
      );

      CREATE TABLE IF NOT EXISTS user_logs (
        id         SERIAL PRIMARY KEY,
        user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
        log_type   TEXT NOT NULL,
        entry_type INTEGER DEFAULT 1,
        content    TEXT DEFAULT '',
        is_new     BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_user_logs_user ON user_logs(user_id, log_type, created_at DESC);

      CREATE TABLE IF NOT EXISTS challenge_medals (
        id          SERIAL PRIMARY KEY,
        user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
        username    TEXT NOT NULL,
        ranking_id  TEXT NOT NULL,
        game        TEXT NOT NULL,
        rank        SMALLINT NOT NULL,
        medal       TEXT NOT NULL,
        awarded_day TEXT NOT NULL,
        created_at  TIMESTAMPTZ DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_challenge_medals_user ON challenge_medals(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_challenge_medals_day ON challenge_medals(awarded_day);

      CREATE TABLE IF NOT EXISTS challenge_score_archive (
        id          SERIAL PRIMARY KEY,
        day_key     TEXT NOT NULL,
        ranking_id  TEXT NOT NULL,
        username    TEXT NOT NULL,
        score       BIGINT NOT NULL,
        data        TEXT DEFAULT '',
        created_at  TIMESTAMPTZ DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_challenge_archive_day ON challenge_score_archive(day_key, ranking_id);

      CREATE TABLE IF NOT EXISTS shop_packs (
        id          INTEGER PRIMARY KEY,
        name        TEXT NOT NULL,
        category    TEXT DEFAULT 'Accessoires',
        price       INTEGER DEFAULT 0,
        description TEXT DEFAULT '',
        suffix9     TEXT NOT NULL,
        comment     TEXT DEFAULT '',
        created_at  TIMESTAMPTZ DEFAULT now()
      );
    `);
    console.log('[DB] Schema initialized');
  } finally {
    client.release();
  }
}

async function findUserByUsername(username) {
  const { rows } = await pool.query(
    'SELECT * FROM users WHERE username = $1',
    [username]
  );
  return rows[0] || null;
}

async function createUser(username, password) {
  const { rows } = await pool.query(
    `INSERT INTO users (username, password)
     VALUES ($1, $2)
     ON CONFLICT (username) DO NOTHING
     RETURNING *`,
    [username, password]
  );
  return rows[0] || null;
}

async function updateUser(username, fields) {
  const keys = Object.keys(fields);
  if (keys.length === 0) return;
  const sets = keys.map((k, i) => `${k} = $${i + 2}`);
  sets.push('updated_at = now()');
  const values = keys.map((k) => fields[k]);
  await pool.query(
    `UPDATE users SET ${sets.join(', ')} WHERE username = $1`,
    [username, ...values]
  );
}

async function createSession(sid, userId) {
  await pool.query(
    `INSERT INTO sessions (sid, user_id)
     VALUES ($1, $2)
     ON CONFLICT (sid) DO UPDATE SET user_id = $2`,
    [sid, userId]
  );
}

async function getSessionUser(sid) {
  const { rows } = await pool.query(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.sid = $1`,
    [sid]
  );
  return rows[0] || null;
}

async function getUserItems(userId) {
  const { rows } = await pool.query(
    'SELECT item_id FROM user_items WHERE user_id = $1',
    [userId]
  );
  return rows.map((r) => r.item_id);
}

async function setUserItems(userId, itemIds) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM user_items WHERE user_id = $1', [userId]);
    if (itemIds.length > 0) {
      const values = itemIds.map((id, i) => `($1, $${i + 2})`).join(', ');
      await client.query(
        `INSERT INTO user_items (user_id, item_id) VALUES ${values} ON CONFLICT DO NOTHING`,
        [userId, ...itemIds]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function upsertScore(userId, rankingId, score, data) {
  await pool.query(
    `INSERT INTO scores (user_id, ranking_id, score, data)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, ranking_id)
     DO UPDATE SET score = $3, data = $4, updated_at = now()`,
    [userId, rankingId, score, data]
  );
}

async function getScores(rankingId) {
  const { rows } = await pool.query(
    `SELECT u.username, s.score, s.data, s.updated_at
     FROM scores s JOIN users u ON u.id = s.user_id
     WHERE s.ranking_id = $1
     ORDER BY s.score DESC`,
    [rankingId]
  );
  return rows;
}

async function upsertFrutiSlot(userId, game, slotId, data) {
  await pool.query(
    `INSERT INTO fruti_slots (user_id, game, slot_id, data)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, game, slot_id)
     DO UPDATE SET data = $4, updated_at = now()`,
    [userId, game, slotId, data]
  );
}

async function getFrutiSlots(userId, game) {
  const { rows } = await pool.query(
    'SELECT slot_id, data FROM fruti_slots WHERE user_id = $1 AND game = $2',
    [userId, game]
  );
  const slots = {};
  for (const r of rows) {
    slots[r.slot_id] = r.data;
  }
  return slots;
}

async function addAccessory(userId, acc) {
  await pool.query(
    `INSERT INTO user_accessories (user_id, acc_id, shop_id, name, value, quantity, price)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [userId, acc.id, acc.shopId || null, acc.n || '', acc.v || '', acc.q || '', acc.p || '']
  );
}

async function getUserAccessories(userId) {
  const { rows } = await pool.query(
    'SELECT * FROM user_accessories WHERE user_id = $1 ORDER BY created_at',
    [userId]
  );
  return rows.map((r) => ({
    dbRowId: r.id,
    id: r.acc_id,
    shopId: r.shop_id || undefined,
    n: r.name,
    v: r.value,
    q: r.quantity,
    p: r.price,
    at: r.created_at ? r.created_at.toISOString().replace('T', ' ').substring(0, 19) : '',
  }));
}

async function hasAccessoryByShopId(userId, shopId) {
  const { rows } = await pool.query(
    'SELECT 1 FROM user_accessories WHERE user_id = $1 AND shop_id = $2 LIMIT 1',
    [userId, shopId]
  );
  return rows.length > 0;
}

async function getContacts(userId) {
  const { rows } = await pool.query(
    `SELECT contact_name
     FROM contacts
     WHERE user_id = $1
     ORDER BY created_at ASC`,
    [userId]
  );
  return rows.map((r) => r.contact_name).filter(Boolean);
}

async function getBlacklist(userId) {
  const { rows } = await pool.query(
    `SELECT blocked_name
     FROM blacklist
     WHERE user_id = $1
     ORDER BY created_at ASC`,
    [userId]
  );
  return rows.map((r) => r.blocked_name).filter(Boolean);
}

async function addContact(userId, contactName) {
  await pool.query(
    `INSERT INTO contacts (user_id, contact_name, folder)
     VALUES ($1, $2, 'mycontact')
     ON CONFLICT (user_id, contact_name) DO NOTHING`,
    [userId, contactName]
  );
}

async function removeContact(userId, contactName) {
  await pool.query(
    'DELETE FROM contacts WHERE user_id = $1 AND contact_name = $2',
    [userId, contactName]
  );
}

async function addBlacklist(userId, blockedName) {
  await pool.query(
    `INSERT INTO blacklist (user_id, blocked_name)
     VALUES ($1, $2)
     ON CONFLICT (user_id, blocked_name) DO NOTHING`,
    [userId, blockedName]
  );
}

async function removeBlacklist(userId, blockedName) {
  await pool.query(
    'DELETE FROM blacklist WHERE user_id = $1 AND blocked_name = $2',
    [userId, blockedName]
  );
}

async function loadScoresForUser(userId) {
  const { rows } = await pool.query(
    'SELECT ranking_id, score, data, updated_at FROM scores WHERE user_id = $1',
    [userId]
  );
  const result = {};
  for (const r of rows) {
    result[r.ranking_id] = {
      score: Number(r.score),
      data: r.data || '',
      updatedAt: r.updated_at ? r.updated_at.toISOString() : '',
    };
  }
  return result;
}

async function loadAllScores() {
  const { rows } = await pool.query(
    `SELECT u.username, s.ranking_id, s.score, s.data, s.updated_at
     FROM scores s JOIN users u ON u.id = s.user_id`
  );
  const result = {};
  for (const r of rows) {
    if (!result[r.username]) result[r.username] = {};
    result[r.username][r.ranking_id] = {
      score: Number(r.score),
      data: r.data || '',
      updatedAt: r.updated_at ? r.updated_at.toISOString() : '',
    };
  }
  return result;
}

async function loadAllBouilles() {
  const { rows } = await pool.query(
    'SELECT username, fbouille FROM users WHERE fbouille IS NOT NULL'
  );
  const result = {};
  for (const r of rows) {
    if (r.fbouille) result[r.username] = r.fbouille;
  }
  return result;
}

async function clearDailyChallengeScores() {
  await pool.query(
    `DELETE FROM scores
     WHERE ranking_id LIKE '%_challenge'`
  );
}

async function saveMedal(userId, username, rankingId, game, rank, medal, awardedDay) {
  await pool.query(
    `INSERT INTO challenge_medals (user_id, username, ranking_id, game, rank, medal, awarded_day)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [userId, username, rankingId, game, rank, medal, awardedDay]
  );
}

async function getMedalsForUser(username) {
  const { rows } = await pool.query(
    `SELECT ranking_id, game, rank, medal, awarded_day, created_at
     FROM challenge_medals WHERE username = $1 ORDER BY created_at DESC`,
    [username]
  );
  return rows;
}

async function getMedalsByDay(day) {
  const { rows } = await pool.query(
    'SELECT username, ranking_id, game, rank, medal FROM challenge_medals WHERE awarded_day = $1',
    [day]
  );
  const result = {};
  for (const r of rows) {
    if (!result[r.username]) result[r.username] = [];
    result[r.username].push({ game: r.game, rankingId: r.ranking_id, rank: r.rank, medal: r.medal });
  }
  return result;
}

async function listAllUsers() {
  const { rows } = await pool.query(
    'SELECT id, username, xp, kikooz, fbouille, gender, is_moderator, created_at FROM users ORDER BY created_at DESC'
  );
  return rows;
}

async function deleteUser(userId) {
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
}

async function deleteScore(userId, rankingId) {
  await pool.query('DELETE FROM scores WHERE user_id = $1 AND ranking_id = $2', [userId, rankingId]);
}

async function deleteAccessory(accRowId) {
  await pool.query('DELETE FROM user_accessories WHERE id = $1', [accRowId]);
}

async function deleteItem(userId, itemId) {
  await pool.query('DELETE FROM user_items WHERE user_id = $1 AND item_id = $2', [userId, itemId]);
}

async function addItem(userId, itemId) {
  await pool.query(
    'INSERT INTO user_items (user_id, item_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [userId, itemId]
  );
}

async function loadShopPacks() {
  const { rows } = await pool.query('SELECT * FROM shop_packs ORDER BY id');
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    category: r.category || 'Accessoires',
    price: r.price || 0,
    description: r.description || '',
    suffix9: r.suffix9,
    comment: r.comment || r.description || '',
  }));
}

async function upsertShopPack(pack) {
  await pool.query(
    `INSERT INTO shop_packs (id, name, category, price, description, suffix9, comment)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO UPDATE SET
       name = $2, category = $3, price = $4, description = $5, suffix9 = $6, comment = $7`,
    [pack.id, pack.name, pack.category || 'Accessoires', pack.price || 0, pack.description || '', pack.suffix9, pack.comment || '']
  );
}

async function deleteShopPack(id) {
  await pool.query('DELETE FROM shop_packs WHERE id = $1', [id]);
}

async function archiveChallengeScores(dayKey) {
  await pool.query(
    `INSERT INTO challenge_score_archive (day_key, ranking_id, username, score, data)
     SELECT $1, s.ranking_id, u.username, s.score, s.data
     FROM scores s
     JOIN users u ON u.id = s.user_id
     WHERE s.ranking_id LIKE '%_challenge'`,
    [dayKey]
  );
}

async function getArchivedScores(rankingId, dayKey) {
  const { rows } = await pool.query(
    `SELECT username, score, data FROM challenge_score_archive
     WHERE ranking_id = $1 AND day_key = $2`,
    [rankingId, dayKey]
  );
  return rows;
}

async function getArchiveDays() {
  const { rows } = await pool.query(
    'SELECT DISTINCT day_key FROM challenge_score_archive ORDER BY day_key DESC LIMIT 60'
  );
  return rows.map(r => r.day_key);
}

module.exports = {
  pool,
  initSchema,
  findUserByUsername,
  createUser,
  updateUser,
  createSession,
  getSessionUser,
  getUserItems,
  setUserItems,
  upsertScore,
  getScores,
  upsertFrutiSlot,
  getFrutiSlots,
  addAccessory,
  getUserAccessories,
  hasAccessoryByShopId,
  getContacts,
  getBlacklist,
  addContact,
  removeContact,
  addBlacklist,
  removeBlacklist,
  loadScoresForUser,
  loadAllScores,
  loadAllBouilles,
  clearDailyChallengeScores,
  listAllUsers,
  deleteUser,
  deleteScore,
  deleteAccessory,
  deleteItem,
  addItem,
  saveMedal,
  getMedalsForUser,
  getMedalsByDay,
  loadShopPacks,
  upsertShopPack,
  deleteShopPack,
  archiveChallengeScores,
  getArchivedScores,
  getArchiveDays,
};
