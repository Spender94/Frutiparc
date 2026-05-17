// Standard error sink for fire-and-forget DB writes. Replaces the
// `.catch(() => {})` pattern that used to swallow Postgres failures
// silently — every dropped medal, accessory, game item or mail-state
// change now leaves a trace in the logs so we can detect persistent
// DB issues instead of just losing data quietly.
const dbErr = (op) => (e) => {
  const msg = e && e.message ? e.message : String(e);
  console.error('[DB] ' + op + ' failed: ' + msg);
};

module.exports = { dbErr };
