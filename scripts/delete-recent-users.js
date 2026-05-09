#!/usr/bin/env node
// Deletes all users created on a given date, with optional exclusions.
// Usage:
//   node scripts/delete-recent-users.js                    # dry-run
//   node scripts/delete-recent-users.js --confirm          # actually deletes
//
// Env overrides:
//   TARGET_DATE=2026-05-06  (default: 2026-05-06)
//   EXCLUDE=PascalProud,OtherUser  (comma-separated, case-insensitive)

const { Pool } = require('pg');

const TARGET_DATE = process.env.TARGET_DATE || '2026-05-06';
const EXCLUDE = (process.env.EXCLUDE || 'PascalProud')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const CONFIRM = process.argv.includes('--confirm');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('render.com')
    ? { rejectUnauthorized: false } : false,
});

async function main() {
  const { rows: targets } = await pool.query(
    `SELECT id, username, created_at
     FROM users
     WHERE (created_at AT TIME ZONE 'Europe/Paris')::date = $1
       AND LOWER(username) != ALL($2)
     ORDER BY created_at ASC`,
    [TARGET_DATE, EXCLUDE]
  );

  console.log(`Found ${targets.length} users created on ${TARGET_DATE} (excluding: ${EXCLUDE.join(', ')}).`);
  if (targets.length === 0) {
    await pool.end();
    return;
  }

  const preview = (rows, label) => {
    console.log(`\n--- ${label} ---`);
    for (const r of rows) {
      const ts = r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at;
      console.log(`  id=${r.id}\tusername=${r.username}\tcreated_at=${ts}`);
    }
  };
  preview(targets.slice(0, 10), 'first 10');
  if (targets.length > 20) preview(targets.slice(-10), 'last 10');
  else if (targets.length > 10) preview(targets.slice(10), 'remaining');

  if (!CONFIRM) {
    console.log(`\n[DRY RUN] No deletions performed. Re-run with --confirm to delete these ${targets.length} users.`);
    await pool.end();
    return;
  }

  console.log(`\nDeleting ${targets.length} users (CASCADE will remove related rows)…`);
  const { rowCount } = await pool.query(
    `DELETE FROM users
     WHERE (created_at AT TIME ZONE 'Europe/Paris')::date = $1
       AND LOWER(username) != ALL($2)`,
    [TARGET_DATE, EXCLUDE]
  );
  console.log(`Deleted ${rowCount} rows from users.`);

  await pool.end();
}

main().catch((e) => {
  console.error('Error:', e.message);
  process.exit(1);
});
