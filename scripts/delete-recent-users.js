#!/usr/bin/env node
// Deletes users created in the last N hours (default: 5).
// Usage:
//   node scripts/delete-recent-users.js          # dry-run (lists only)
//   node scripts/delete-recent-users.js --confirm  # actually deletes
//   HOURS=3 node scripts/delete-recent-users.js --confirm
//
// Foreign keys on users(id) all use ON DELETE CASCADE, so related rows
// (sessions, items, scores, slots, accessories, logs, contacts, forum
// posts/topics, etc.) are removed automatically.

const { Pool } = require('pg');

const HOURS = Number(process.env.HOURS || 5);
const CONFIRM = process.argv.includes('--confirm');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('render.com')
    ? { rejectUnauthorized: false } : false,
});

async function main() {
  const cutoff = `NOW() - INTERVAL '${HOURS} hours'`;

  const { rows: targets } = await pool.query(
    `SELECT id, username, created_at
     FROM users
     WHERE created_at > ${cutoff}
     ORDER BY created_at ASC`
  );

  console.log(`Found ${targets.length} users created in the last ${HOURS} hours.`);
  if (targets.length === 0) {
    await pool.end();
    return;
  }

  // Show first 10 and last 10 for sanity-checking
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
    `DELETE FROM users WHERE created_at > ${cutoff}`
  );
  console.log(`Deleted ${rowCount} rows from users.`);

  await pool.end();
}

main().catch((e) => {
  console.error('Error:', e.message);
  process.exit(1);
});
