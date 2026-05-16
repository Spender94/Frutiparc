const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('render.com')
    ? { rejectUnauthorized: false }
    : undefined,
  connectionTimeoutMillis: 5000,
  query_timeout: 5000,
});

// pg pool emits 'error' on background failures (e.g. idle client lost,
// network hiccup, server restart). We log loudly so Render's logs show
// the issue, and we increment a counter; if errors burst above a
// sensible threshold we exit the process so Render's supervisor
// restarts us with a fresh pool, rather than serving requests against
// a wedged connection set.
let _poolErrorBurst = 0;
let _poolErrorBurstStart = 0;
const POOL_ERROR_BURST_WINDOW_MS = 60 * 1000; // 1 min
const POOL_ERROR_BURST_MAX = 10;
pool.on('error', (err) => {
  const msg = (err && err.message) ? err.message : String(err);
  console.error('[DB] Unexpected pool error: ' + msg);
  const now = Date.now();
  if (now - _poolErrorBurstStart > POOL_ERROR_BURST_WINDOW_MS) {
    _poolErrorBurstStart = now;
    _poolErrorBurst = 0;
  }
  if (++_poolErrorBurst >= POOL_ERROR_BURST_MAX) {
    console.error('[DB] Pool error burst: ' + _poolErrorBurst + ' errors in ' +
      Math.round((now - _poolErrorBurstStart) / 1000) + 's — exiting so the supervisor can restart with a fresh pool');
    // Defer the exit one tick so the current log line flushes.
    setTimeout(() => process.exit(1), 100);
  }
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
        ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT DEFAULT NULL;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS fruti_sign INTEGER DEFAULT -1;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS fruti_sign_b INTEGER DEFAULT -1;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS frutijob TEXT DEFAULT '';
        ALTER TABLE users ADD COLUMN IF NOT EXISTS is_animator BOOLEAN DEFAULT false;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login TIMESTAMPTZ;
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

      CREATE TABLE IF NOT EXISTS user_game_items (
        user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
        item_name  TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now(),
        PRIMARY KEY (user_id, item_name)
      );

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

      CREATE TABLE IF NOT EXISTS contact_folders (
        user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
        folder_uid  TEXT NOT NULL,
        folder_name TEXT NOT NULL,
        created_at  TIMESTAMPTZ DEFAULT now(),
        PRIMARY KEY (user_id, folder_uid)
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
      DELETE FROM challenge_medals a USING challenge_medals b
        WHERE a.id < b.id
          AND a.username = b.username
          AND a.ranking_id = b.ranking_id
          AND a.awarded_day = b.awarded_day;
      CREATE UNIQUE INDEX IF NOT EXISTS uq_challenge_medals_user_rk_day
        ON challenge_medals(username, ranking_id, awarded_day);

      CREATE TABLE IF NOT EXISTS challenge_score_archive (
        id          SERIAL PRIMARY KEY,
        day_key     TEXT NOT NULL,
        ranking_id  TEXT NOT NULL,
        username    TEXT NOT NULL,
        score       BIGINT NOT NULL,
        data        TEXT DEFAULT '',
        updated_at  TIMESTAMPTZ,
        created_at  TIMESTAMPTZ DEFAULT now()
      );
      ALTER TABLE challenge_score_archive ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
      CREATE INDEX IF NOT EXISTS idx_challenge_archive_day ON challenge_score_archive(day_key, ranking_id);
      DELETE FROM challenge_score_archive a USING challenge_score_archive b
        WHERE a.id < b.id
          AND a.day_key = b.day_key
          AND a.ranking_id = b.ranking_id
          AND a.username = b.username;
      CREATE UNIQUE INDEX IF NOT EXISTS uq_challenge_archive_day_rk_user
        ON challenge_score_archive(day_key, ranking_id, username);

      CREATE TABLE IF NOT EXISTS shop_packs (
        id          INTEGER PRIMARY KEY,
        name        TEXT NOT NULL,
        category    TEXT DEFAULT 'Accessoires',
        price       INTEGER DEFAULT 0,
        description TEXT DEFAULT '',
        suffix9     TEXT NOT NULL,
        comment     TEXT DEFAULT '',
        wallpaper_id TEXT DEFAULT NULL,
        created_at  TIMESTAMPTZ DEFAULT now()
      );
      ALTER TABLE shop_packs ADD COLUMN IF NOT EXISTS wallpaper_id TEXT DEFAULT NULL;

      -- Forum tables
      CREATE TABLE IF NOT EXISTS forum_categories (
        id         SERIAL PRIMARY KEY,
        name       TEXT NOT NULL,
        sort_order INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS forum_boards (
        id          SERIAL PRIMARY KEY,
        category_id INTEGER REFERENCES forum_categories(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        description TEXT DEFAULT '',
        sort_order  INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS forum_topics (
        id              SERIAL PRIMARY KEY,
        board_id        INTEGER REFERENCES forum_boards(id) ON DELETE CASCADE,
        author_username TEXT NOT NULL,
        title           TEXT NOT NULL,
        is_sticky       BOOLEAN DEFAULT false,
        is_locked       BOOLEAN DEFAULT false,
        view_count      INTEGER DEFAULT 0,
        last_post_at    TIMESTAMPTZ DEFAULT now(),
        last_post_by    TEXT DEFAULT '',
        created_at      TIMESTAMPTZ DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_forum_topics_board ON forum_topics(board_id, is_sticky DESC, last_post_at DESC);

      CREATE TABLE IF NOT EXISTS forum_posts (
        id              SERIAL PRIMARY KEY,
        topic_id        INTEGER REFERENCES forum_topics(id) ON DELETE CASCADE,
        author_username TEXT NOT NULL,
        content         TEXT NOT NULL,
        bouille         TEXT,
        created_at      TIMESTAMPTZ DEFAULT now(),
        updated_at      TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_forum_posts_topic ON forum_posts(topic_id, created_at ASC);

      ALTER TABLE forum_posts ADD COLUMN IF NOT EXISTS bouille TEXT;

      -- Per-user read tracking for forum topics. A topic is "unread" for a
      -- given username when forum_topics.last_post_at > read_at — or when
      -- no row exists at all (the user has never opened it).
      CREATE TABLE IF NOT EXISTS forum_topic_reads (
        username   TEXT NOT NULL,
        topic_id   INTEGER NOT NULL REFERENCES forum_topics(id) ON DELETE CASCADE,
        read_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (username, topic_id)
      );
      CREATE INDEX IF NOT EXISTS idx_forum_topic_reads_user ON forum_topic_reads(username);

      -- Internal mailbox
      CREATE TABLE IF NOT EXISTS user_mails (
        uid          TEXT PRIMARY KEY,
        user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
        from_user    TEXT NOT NULL,
        from_addr    TEXT NOT NULL,
        to_users     TEXT DEFAULT '',
        to_addrs     TEXT DEFAULT '',
        subject      TEXT DEFAULT '',
        body         TEXT DEFAULT '',
        folder       TEXT NOT NULL DEFAULT 'inbox',
        is_read      BOOLEAN DEFAULT false,
        date_str     TEXT NOT NULL,
        created_at   TIMESTAMPTZ DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_user_mails_user_folder ON user_mails(user_id, folder, date_str DESC);

      CREATE TABLE IF NOT EXISTS channels (
        name         TEXT PRIMARY KEY,
        label        TEXT DEFAULT '',
        topic        TEXT DEFAULT '',
        updated_at   TIMESTAMPTZ DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS moderation_logs (
        id              SERIAL PRIMARY KEY,
        target_username TEXT NOT NULL,
        moderator       TEXT NOT NULL,
        action          TEXT NOT NULL,
        detail          TEXT DEFAULT '',
        created_at      TIMESTAMPTZ DEFAULT now()
      );

      -- Gaspard help topics. Hierarchical (parent_id null = top-level index
      -- entry); each topic has a short title shown in the index list and a
      -- body (HTML/AS2 textfield-style markup) rendered inside Gaspard's
      -- help window. sort_order controls display position within a parent.
      CREATE TABLE IF NOT EXISTS gaspard_help_topics (
        id          SERIAL PRIMARY KEY,
        title       TEXT NOT NULL,
        body        TEXT NOT NULL DEFAULT '',
        parent_id   INTEGER REFERENCES gaspard_help_topics(id) ON DELETE CASCADE,
        sort_order  INTEGER NOT NULL DEFAULT 0,
        keywords    TEXT NOT NULL DEFAULT '',
        created_at  TIMESTAMPTZ DEFAULT now(),
        updated_at  TIMESTAMPTZ DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_gaspard_help_parent ON gaspard_help_topics(parent_id, sort_order);
      CREATE INDEX IF NOT EXISTS idx_moderation_logs_target ON moderation_logs(target_username, created_at DESC);
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

async function recordLogin(username) {
  await pool.query(
    `UPDATE users SET last_login = now() WHERE username = $1`,
    [username]
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

async function deleteSession(sid) {
  await pool.query(`DELETE FROM sessions WHERE sid = $1`, [sid]);
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

async function deleteFrutiSlotsForGame(userId, game) {
  await pool.query(
    `DELETE FROM fruti_slots WHERE user_id = $1 AND game = $2`,
    [userId, game]
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

async function getAllFrutiSlot0(userId) {
  const { rows } = await pool.query(
    'SELECT game, data FROM fruti_slots WHERE user_id = $1 AND slot_id = 0',
    [userId]
  );
  return rows;
}

async function getAllFrutiSlots(userId) {
  const { rows } = await pool.query(
    'SELECT game, slot_id, data FROM fruti_slots WHERE user_id = $1',
    [userId]
  );
  const result = {};
  for (const r of rows) {
    if (!result[r.game]) result[r.game] = {};
    result[r.game][r.slot_id] = r.data;
  }
  return result;
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
    `SELECT contact_name, folder
     FROM contacts
     WHERE user_id = $1
     ORDER BY created_at ASC`,
    [userId]
  );
  return rows
    .filter((r) => r.contact_name)
    .map((r) => ({ addr: r.contact_name, folder: r.folder || 'mycontact' }));
}

async function getContactFolders(userId) {
  const { rows } = await pool.query(
    `SELECT folder_uid, folder_name
     FROM contact_folders
     WHERE user_id = $1
     ORDER BY created_at ASC`,
    [userId]
  );
  return rows.map((r) => ({ uid: r.folder_uid, name: r.folder_name }));
}

async function addContactFolder(userId, folderUid, folderName) {
  await pool.query(
    `INSERT INTO contact_folders (user_id, folder_uid, folder_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, folder_uid) DO UPDATE SET folder_name = EXCLUDED.folder_name`,
    [userId, folderUid, folderName]
  );
}

async function removeContactFolder(userId, folderUid) {
  await pool.query(
    `UPDATE contacts SET folder = 'mycontact'
     WHERE user_id = $1 AND folder = $2`,
    [userId, folderUid]
  );
  await pool.query(
    'DELETE FROM contact_folders WHERE user_id = $1 AND folder_uid = $2',
    [userId, folderUid]
  );
}

async function updateContactFolder(userId, contactName, folder) {
  await pool.query(
    `UPDATE contacts SET folder = $3
     WHERE user_id = $1 AND contact_name = $2`,
    [userId, contactName, folder]
  );
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

async function addContact(userId, contactName, folder = 'mycontact') {
  await pool.query(
    `INSERT INTO contacts (user_id, contact_name, folder)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, contact_name) DO UPDATE SET folder = EXCLUDED.folder`,
    [userId, contactName, folder]
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

async function clearDailyChallengeScores(rankingIds) {
  if (!Array.isArray(rankingIds) || rankingIds.length === 0) return;
  await pool.query(
    'DELETE FROM scores WHERE ranking_id = ANY($1::text[])',
    [rankingIds]
  );
}

async function saveMedal(userId, username, rankingId, game, rank, medal, awardedDay) {
  await pool.query(
    `INSERT INTO challenge_medals (user_id, username, ranking_id, game, rank, medal, awarded_day)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (username, ranking_id, awarded_day) DO UPDATE
       SET rank = EXCLUDED.rank, medal = EXCLUDED.medal, user_id = EXCLUDED.user_id`,
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

async function getMedalsForUserByDay(username, day) {
  const { rows } = await pool.query(
    `SELECT ranking_id, game, rank, medal, awarded_day, created_at
     FROM challenge_medals WHERE username = $1 AND awarded_day = $2 ORDER BY created_at DESC`,
    [username, day]
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

async function clearAllChallengeData() {
  await pool.query('DELETE FROM challenge_medals');
  await pool.query('DELETE FROM challenge_score_archive');
  await pool.query(
    'DELETE FROM scores WHERE ranking_id = ANY($1::text[])',
    [['bkiwi_classic', 'snake3_classic', 'swapou2_classic', 'kaluga_classic']]
  );
}

async function listAllUsers() {
  const { rows } = await pool.query(
    'SELECT id, username, display_name, xp, kikooz, fbouille, gender, is_moderator, is_animator, fruti_sign, fruti_sign_b, real_job, frutijob, birthday, country, region, city, created_at FROM users ORDER BY created_at DESC'
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

async function getUserGameItems(userId) {
  const { rows } = await pool.query(
    'SELECT item_name FROM user_game_items WHERE user_id = $1 ORDER BY created_at',
    [userId]
  );
  return rows.map((r) => r.item_name);
}

async function addGameItem(userId, itemName) {
  await pool.query(
    'INSERT INTO user_game_items (user_id, item_name) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [userId, itemName]
  );
}

async function removeGameItem(userId, itemName) {
  await pool.query(
    'DELETE FROM user_game_items WHERE user_id = $1 AND item_name = $2',
    [userId, itemName]
  );
}

// ── Persistent user history (user_logs table) ──
async function addUserLogEntry(userId, logType, entryType, content, isNew) {
  if (!userId) return;
  await pool.query(
    `INSERT INTO user_logs (user_id, log_type, entry_type, content, is_new)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, logType, entryType || 1, String(content || ''), !!isNew]
  );
}

async function getUserLogEntries(userId, logType, limit = 200) {
  if (!userId) return [];
  const { rows } = await pool.query(
    `SELECT id, entry_type, content, is_new, created_at
     FROM user_logs
     WHERE user_id = $1 AND log_type = $2
     ORDER BY created_at DESC
     LIMIT $3`,
    [userId, logType, limit]
  );
  return rows;
}

async function clearUserLogNewFlag(userId, logType) {
  if (!userId) return;
  await pool.query(
    `UPDATE user_logs SET is_new = false WHERE user_id = $1 AND log_type = $2 AND is_new = true`,
    [userId, logType]
  );
}

async function pruneUserLog(userId, logType, keep = 200) {
  if (!userId) return;
  await pool.query(
    `DELETE FROM user_logs
     WHERE id IN (
       SELECT id FROM user_logs
       WHERE user_id = $1 AND log_type = $2
       ORDER BY created_at DESC
       OFFSET $3
     )`,
    [userId, logType, keep]
  );
}

async function deleteSiteLogByContent(content) {
  await pool.query(
    `DELETE FROM user_logs WHERE log_type = 'site' AND content = $1`,
    [String(content || '')]
  );
}

async function broadcastSiteLogToAllUsers(entryType, content) {
  await pool.query(
    `INSERT INTO user_logs (user_id, log_type, entry_type, content, is_new)
     SELECT id, 'site', $1, $2, true FROM users`,
    [entryType || 1, String(content || '')]
  );
}

async function addModerationLog(targetUsername, moderator, action, detail) {
  await pool.query(
    `INSERT INTO moderation_logs (target_username, moderator, action, detail) VALUES ($1, $2, $3, $4)`,
    [targetUsername, moderator, action, detail || '']
  );
}

async function getModerationLogs(targetUsername, limit = 50) {
  const { rows } = await pool.query(
    `SELECT * FROM moderation_logs WHERE target_username = $1 ORDER BY created_at DESC LIMIT $2`,
    [targetUsername, limit]
  );
  return rows;
}

async function loadShopPacks() {
  const { rows } = await pool.query('SELECT * FROM shop_packs ORDER BY id');
  return rows.map(r => {
    const p = {
      id: r.id,
      name: r.name,
      category: r.category || 'Accessoires',
      price: r.price || 0,
      description: r.description || '',
      suffix9: r.suffix9,
      comment: r.comment || r.description || '',
    };
    if (r.wallpaper_id) p.wallpaperId = r.wallpaper_id;
    return p;
  });
}

async function upsertShopPack(pack) {
  await pool.query(
    `INSERT INTO shop_packs (id, name, category, price, description, suffix9, comment, wallpaper_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO UPDATE SET
       name = $2, category = $3, price = $4, description = $5, suffix9 = $6, comment = $7, wallpaper_id = $8`,
    [pack.id, pack.name, pack.category || 'Accessoires', pack.price || 0, pack.description || '', pack.suffix9, pack.comment || '', pack.wallpaperId || null]
  );
}

async function deleteShopPack(id) {
  await pool.query('DELETE FROM shop_packs WHERE id = $1', [id]);
}

async function archiveChallengeScores(dayKey, rankingIds) {
  if (!Array.isArray(rankingIds) || rankingIds.length === 0) return;
  await pool.query(
    `INSERT INTO challenge_score_archive (day_key, ranking_id, username, score, data, updated_at)
     SELECT $1, s.ranking_id, u.username, s.score, s.data, s.updated_at
     FROM scores s
     JOIN users u ON u.id = s.user_id
     WHERE s.ranking_id = ANY($2::text[])
     ON CONFLICT (day_key, ranking_id, username) DO UPDATE
       SET score = EXCLUDED.score,
           data = EXCLUDED.data,
           updated_at = EXCLUDED.updated_at`,
    [dayKey, rankingIds]
  );
}

async function getArchivedScores(rankingId, dayKey) {
  const { rows } = await pool.query(
    `SELECT username, score, data, updated_at FROM challenge_score_archive
     WHERE ranking_id = $1 AND day_key = $2`,
    [rankingId, dayKey]
  );
  return rows;
}

async function getArchivedScoresForDay(dayKey) {
  const { rows } = await pool.query(
    'SELECT ranking_id, username, score FROM challenge_score_archive WHERE day_key = $1',
    [dayKey]
  );
  return rows;
}

async function deleteMedalsByDay(dayKey) {
  await pool.query('DELETE FROM challenge_medals WHERE awarded_day = $1', [dayKey]);
}

async function deleteWallpaperAccessories(wallpaperShopIds) {
  const ids = Array.isArray(wallpaperShopIds) ? wallpaperShopIds : [];
  const { rowCount } = await pool.query(
    `DELETE FROM user_accessories
     WHERE value LIKE 'wp:%' OR shop_id = ANY($1::int[])`,
    [ids]
  );
  return rowCount;
}

async function getAllMedals() {
  const { rows } = await pool.query(
    `SELECT username, ranking_id, game, rank, medal, awarded_day, created_at
     FROM challenge_medals ORDER BY awarded_day DESC, ranking_id ASC, rank ASC`
  );
  return rows;
}

async function getMedalDays() {
  const { rows } = await pool.query(
    'SELECT DISTINCT awarded_day FROM challenge_medals ORDER BY awarded_day DESC LIMIT 60'
  );
  return rows.map(r => r.awarded_day);
}

async function getArchiveDays() {
  const { rows } = await pool.query(
    'SELECT DISTINCT day_key FROM challenge_score_archive ORDER BY day_key DESC LIMIT 60'
  );
  return rows.map(r => r.day_key);
}

// All-time best score per (ranking_id, username), combining the live scores
// table with historical entries from challenge_score_archive. Used by the
// "livre des records" view.
async function getAllTimeBestScores() {
  const { rows } = await pool.query(
    `WITH combined AS (
       SELECT s.ranking_id, u.username, s.score, s.data, s.updated_at
         FROM scores s JOIN users u ON u.id = s.user_id
       UNION ALL
       SELECT a.ranking_id, a.username, a.score, a.data, a.updated_at
         FROM challenge_score_archive a
     )
     SELECT ranking_id, username, score, data, updated_at
       FROM combined`
  );
  return rows;
}

// ── Forum ──

async function forumGetCategories() {
  const { rows } = await pool.query(
    'SELECT * FROM forum_categories ORDER BY sort_order, id'
  );
  return rows;
}

async function forumGetBoards(username = null) {
  // unreadSubquery returns TRUE if any topic in the board has a
  // last_post_at newer than the user's last read mark (or no read mark
  // at all). Anonymous viewers always get FALSE so the UI keeps the
  // base folder_big.gif.
  const unreadSql = username
    ? `EXISTS (
         SELECT 1 FROM forum_topics t
         LEFT JOIN forum_topic_reads r
           ON r.topic_id = t.id AND r.username = $1
         WHERE t.board_id = b.id
           AND t.last_post_at > COALESCE(r.read_at, 'epoch'::timestamptz)
       )`
    : 'FALSE';
  const params = username ? [username] : [];
  const { rows } = await pool.query(`
    SELECT b.*,
      ${unreadSql} AS unread,
      (SELECT COUNT(*) FROM forum_topics t WHERE t.board_id = b.id) AS topic_count,
      (SELECT COUNT(*) FROM forum_posts p JOIN forum_topics t ON t.id = p.topic_id WHERE t.board_id = b.id) AS post_count,
      (SELECT t2.last_post_at FROM forum_topics t2 WHERE t2.board_id = b.id ORDER BY t2.last_post_at DESC LIMIT 1) AS last_activity,
      (SELECT t2.last_post_by FROM forum_topics t2 WHERE t2.board_id = b.id ORDER BY t2.last_post_at DESC LIMIT 1) AS last_activity_by
    FROM forum_boards b ORDER BY b.sort_order, b.id
  `, params);
  return rows;
}

async function forumGetTopics(boardId, page, perPage, username = null) {
  const offset = (page - 1) * perPage;
  // Same unread logic per row: TRUE when last_post_at > read_at, also TRUE
  // when there's no read row yet (user has never opened the topic).
  const unreadSelect = username
    ? `(t.last_post_at > COALESCE(r.read_at, 'epoch'::timestamptz)) AS unread`
    : 'FALSE AS unread';
  const unreadJoin = username
    ? `LEFT JOIN forum_topic_reads r ON r.topic_id = t.id AND r.username = $4`
    : '';
  const params = username
    ? [boardId, perPage, offset, username]
    : [boardId, perPage, offset];
  const { rows } = await pool.query(`
    SELECT t.*,
      ${unreadSelect},
      (SELECT COUNT(*) FROM forum_posts p WHERE p.topic_id = t.id) - 1 AS reply_count
    FROM forum_topics t
    ${unreadJoin}
    WHERE t.board_id = $1
    ORDER BY t.is_sticky DESC, t.last_post_at DESC
    LIMIT $2 OFFSET $3
  `, params);
  const { rows: countRows } = await pool.query(
    'SELECT COUNT(*) AS total FROM forum_topics WHERE board_id = $1', [boardId]
  );
  return { topics: rows, total: Number(countRows[0].total) };
}

// Marks a topic as read for the given user. Called whenever the topic page
// is opened — if the user later returns and no new post has arrived, the
// topic stays "read" because last_post_at has not changed.
async function forumMarkTopicRead(username, topicId) {
  await pool.query(
    `INSERT INTO forum_topic_reads (username, topic_id, read_at)
     VALUES ($1, $2, now())
     ON CONFLICT (username, topic_id) DO UPDATE SET read_at = now()`,
    [username, topicId]
  );
}

async function forumGetTopic(topicId) {
  const { rows } = await pool.query('SELECT * FROM forum_topics WHERE id = $1', [topicId]);
  return rows[0] || null;
}

async function forumGetPosts(topicId, page, perPage) {
  const offset = (page - 1) * perPage;
  const { rows } = await pool.query(
    'SELECT * FROM forum_posts WHERE topic_id = $1 ORDER BY created_at ASC LIMIT $2 OFFSET $3',
    [topicId, perPage, offset]
  );
  const { rows: countRows } = await pool.query(
    'SELECT COUNT(*) AS total FROM forum_posts WHERE topic_id = $1', [topicId]
  );
  return { posts: rows, total: Number(countRows[0].total) };
}

async function forumCreateTopic(boardId, username, title, content, bouille) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: tRows } = await client.query(
      `INSERT INTO forum_topics (board_id, author_username, title, last_post_by)
       VALUES ($1, $2, $3, $2) RETURNING *`,
      [boardId, username, title]
    );
    const topic = tRows[0];
    await client.query(
      `INSERT INTO forum_posts (topic_id, author_username, content, bouille)
       VALUES ($1, $2, $3, $4)`,
      [topic.id, username, content, bouille || null]
    );
    await client.query('COMMIT');
    return topic;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function forumCreatePost(topicId, username, content, bouille) {
  const { rows } = await pool.query(
    `INSERT INTO forum_posts (topic_id, author_username, content, bouille)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [topicId, username, content, bouille || null]
  );
  await pool.query(
    'UPDATE forum_topics SET last_post_at = now(), last_post_by = $2 WHERE id = $1',
    [topicId, username]
  );
  return rows[0];
}

async function forumUpdatePost(postId, content) {
  await pool.query(
    'UPDATE forum_posts SET content = $2, updated_at = now() WHERE id = $1',
    [postId, content]
  );
}

async function forumDeletePost(postId) {
  await pool.query('DELETE FROM forum_posts WHERE id = $1', [postId]);
}

async function forumIncrementViews(topicId) {
  await pool.query('UPDATE forum_topics SET view_count = view_count + 1 WHERE id = $1', [topicId]);
}

async function forumGetBoard(boardId) {
  const { rows } = await pool.query('SELECT * FROM forum_boards WHERE id = $1', [boardId]);
  return rows[0] || null;
}

async function forumCreateBoard(categoryId, name, description, sortOrder) {
  const { rows } = await pool.query(
    `INSERT INTO forum_boards (category_id, name, description, sort_order)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [categoryId, name, description || '', sortOrder || 0]
  );
  return rows[0];
}

async function forumCreateCategory(name, sortOrder) {
  const { rows } = await pool.query(
    'INSERT INTO forum_categories (name, sort_order) VALUES ($1, $2) RETURNING *',
    [name, sortOrder || 0]
  );
  return rows[0];
}

async function forumToggleSticky(topicId) {
  await pool.query('UPDATE forum_topics SET is_sticky = NOT is_sticky WHERE id = $1', [topicId]);
}

async function forumToggleLocked(topicId) {
  await pool.query('UPDATE forum_topics SET is_locked = NOT is_locked WHERE id = $1', [topicId]);
}

async function forumDeleteTopic(topicId) {
  await pool.query('DELETE FROM forum_posts WHERE topic_id = $1', [topicId]);
  await pool.query('DELETE FROM forum_topics WHERE id = $1', [topicId]);
}

// ── Mail ──

async function saveMail(userId, mail) {
  await pool.query(
    `INSERT INTO user_mails (uid, user_id, from_user, from_addr, to_users, to_addrs,
                             subject, body, folder, is_read, date_str)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (uid) DO UPDATE SET
       folder = EXCLUDED.folder,
       is_read = EXCLUDED.is_read,
       subject = EXCLUDED.subject,
       body = EXCLUDED.body,
       to_users = EXCLUDED.to_users,
       to_addrs = EXCLUDED.to_addrs`,
    [
      mail.uid, userId,
      mail.from || '', mail.fromAddr || '',
      Array.isArray(mail.to) ? mail.to.join(',') : (mail.to || ''),
      Array.isArray(mail.toAddrs) ? mail.toAddrs.join(',') : (mail.toAddrs || ''),
      mail.subject || '', mail.body || '',
      mail.folder || 'inbox',
      !!mail.read,
      mail.date || '',
    ]
  );
}

async function getMailsForUser(userId) {
  const { rows } = await pool.query(
    `SELECT uid, from_user, from_addr, to_users, to_addrs, subject, body,
            folder, is_read, date_str
     FROM user_mails WHERE user_id = $1 ORDER BY date_str ASC`,
    [userId]
  );
  return rows.map((r) => ({
    uid: r.uid,
    from: r.from_user,
    fromAddr: r.from_addr,
    to: r.to_users ? r.to_users.split(',').filter(Boolean) : [],
    toAddrs: r.to_addrs ? r.to_addrs.split(',').filter(Boolean) : [],
    subject: r.subject || '',
    body: r.body || '',
    folder: r.folder || 'inbox',
    read: !!r.is_read,
    date: r.date_str || '',
  }));
}

async function updateMailFolder(uid, folder) {
  await pool.query('UPDATE user_mails SET folder = $2 WHERE uid = $1', [uid, folder]);
}

async function updateMailRead(uid, isRead) {
  await pool.query('UPDATE user_mails SET is_read = $2 WHERE uid = $1', [uid, !!isRead]);
}

async function deleteMails(uids) {
  if (!Array.isArray(uids) || uids.length === 0) return;
  await pool.query('DELETE FROM user_mails WHERE uid = ANY($1::text[])', [uids]);
}

async function forumGetPostCounts(usernames) {
  if (!usernames.length) return {};
  const { rows } = await pool.query(
    `SELECT author_username, COUNT(*)::int AS cnt FROM forum_posts WHERE author_username = ANY($1) GROUP BY author_username`,
    [usernames]
  );
  const map = {};
  for (const r of rows) map[r.author_username] = r.cnt;
  return map;
}

// ── Channels ──

async function loadChannels() {
  const { rows } = await pool.query('SELECT name, label, topic FROM channels');
  const result = {};
  for (const r of rows) {
    result[r.name] = { label: r.label || '', topic: r.topic || '' };
  }
  return result;
}

async function upsertChannel(name, label, topic) {
  await pool.query(
    `INSERT INTO channels (name, label, topic, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (name) DO UPDATE SET label = $2, topic = $3, updated_at = now()`,
    [name, label || '', topic || '']
  );
}

async function updateChannelTopic(name, topic) {
  await pool.query(
    `INSERT INTO channels (name, topic, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (name) DO UPDATE SET topic = $2, updated_at = now()`,
    [name, topic || '']
  );
}

// Gaspard help topics CRUD
async function listGaspardHelpTopics() {
  const r = await pool.query(
    `SELECT id, title, body, parent_id, sort_order, keywords,
            created_at, updated_at
     FROM gaspard_help_topics
     ORDER BY COALESCE(parent_id, 0), sort_order, id`
  );
  return r.rows;
}
async function getGaspardHelpTopic(id) {
  const r = await pool.query(
    `SELECT id, title, body, parent_id, sort_order, keywords
     FROM gaspard_help_topics WHERE id = $1`,
    [id]
  );
  return r.rows[0] || null;
}
async function createGaspardHelpTopic({ title, body, parent_id, sort_order, keywords }) {
  const r = await pool.query(
    `INSERT INTO gaspard_help_topics (title, body, parent_id, sort_order, keywords)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, title, body, parent_id, sort_order, keywords`,
    [title, body || '', parent_id || null, sort_order || 0, keywords || '']
  );
  return r.rows[0];
}
async function updateGaspardHelpTopic(id, { title, body, parent_id, sort_order, keywords }) {
  const r = await pool.query(
    `UPDATE gaspard_help_topics
     SET title = COALESCE($2, title),
         body = COALESCE($3, body),
         parent_id = $4,
         sort_order = COALESCE($5, sort_order),
         keywords = COALESCE($6, keywords),
         updated_at = now()
     WHERE id = $1
     RETURNING id, title, body, parent_id, sort_order, keywords`,
    [id, title, body, parent_id === undefined ? null : parent_id,
     sort_order, keywords]
  );
  return r.rows[0] || null;
}
async function deleteGaspardHelpTopic(id) {
  const r = await pool.query(`DELETE FROM gaspard_help_topics WHERE id = $1`, [id]);
  return r.rowCount > 0;
}

module.exports = {
  pool,
  initSchema,
  findUserByUsername,
  createUser,
  updateUser,
  recordLogin,
  createSession,
  getSessionUser,
  deleteSession,
  getUserItems,
  setUserItems,
  upsertScore,
  getScores,
  upsertFrutiSlot,
  deleteFrutiSlotsForGame,
  getFrutiSlots,
  getAllFrutiSlot0,
  getAllFrutiSlots,
  addAccessory,
  getUserAccessories,
  hasAccessoryByShopId,
  getContacts,
  getBlacklist,
  addContact,
  removeContact,
  addBlacklist,
  removeBlacklist,
  getContactFolders,
  addContactFolder,
  removeContactFolder,
  updateContactFolder,
  loadScoresForUser,
  loadAllScores,
  loadAllBouilles,
  clearDailyChallengeScores,
  clearAllChallengeData,
  listAllUsers,
  deleteUser,
  deleteScore,
  deleteAccessory,
  deleteItem,
  addItem,
  getUserGameItems,
  addGameItem,
  removeGameItem,
  addUserLogEntry,
  getUserLogEntries,
  clearUserLogNewFlag,
  pruneUserLog,
  deleteSiteLogByContent,
  broadcastSiteLogToAllUsers,
  saveMedal,
  getMedalsForUser,
  getMedalsForUserByDay,
  getMedalsByDay,
  loadShopPacks,
  upsertShopPack,
  deleteShopPack,
  archiveChallengeScores,
  getArchivedScores,
  getArchivedScoresForDay,
  getArchiveDays,
  getAllTimeBestScores,
  deleteMedalsByDay,
  getAllMedals,
  getMedalDays,
  deleteWallpaperAccessories,
  forumGetCategories,
  forumGetBoards,
  forumGetTopics,
  forumGetTopic,
  forumGetPosts,
  forumCreateTopic,
  forumCreatePost,
  forumUpdatePost,
  forumDeletePost,
  forumIncrementViews,
  forumMarkTopicRead,
  forumGetBoard,
  forumCreateBoard,
  forumCreateCategory,
  forumToggleSticky,
  forumToggleLocked,
  forumDeleteTopic,
  forumGetPostCounts,
  saveMail,
  getMailsForUser,
  updateMailFolder,
  updateMailRead,
  deleteMails,
  loadChannels,
  upsertChannel,
  updateChannelTopic,
  addModerationLog,
  getModerationLogs,
  listGaspardHelpTopics,
  getGaspardHelpTopic,
  createGaspardHelpTopic,
  updateGaspardHelpTopic,
  deleteGaspardHelpTopic,
};
