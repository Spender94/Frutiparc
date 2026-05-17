// Date helpers shared between scoring, XP, challenge medals, and the Frutiz
// XML attribute formatters. Everything here is pure — no I/O, no state.

// ── Day-key helpers (used by daily-reset rankings, XP rollover, …) ──
function utcDayKey(d = new Date()) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parisDayKey(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

function yesterdayParisDayKey() {
  return parisDayKey(new Date(Date.now() - 86400000));
}

function yesterdayDayKey() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return utcDayKey(d);
}

// ── Frutiz XML attribute formatters (FEDate compatibility) ──
// Format a date for the "bd" / "ft" XML attributes: YYYY-MM-DD.HH:MM:SS
// Native Frutiparc format uses a DOT between date and time (FEDate.newFromString
// reads positions 0-9 for date and 11+ for time, ignoring the separator at pos 10).
function formatFrutizDate(raw, fallback) {
  fallback = fallback || '2005-01-01.00:00:00';
  if (!raw) return fallback;
  // Normalise: accept space, T or dot separator.
  const m = String(raw).match(/^(\d{4}-\d{2}-\d{2})[ T.](\d{2}:\d{2}:\d{2})/);
  if (m) return m[1] + '.' + m[2];
  const d2 = String(raw).match(/^(\d{4}-\d{2}-\d{2})$/);
  if (d2) return d2[1] + '.00:00:00';
  try {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return fallback;
    return d.toISOString().substring(0, 10) + '.' + d.toISOString().substring(11, 19);
  } catch { return fallback; }
}

// "ft" attribute: subscription date in YYYY-MM-DD.HH:MM:SS format.
// Read by Flash client (FrutizInfo.as:421-422) for "subday" + "frutiAge" display.
function getFrutizSubscribeDate(user) {
  return formatFrutizDate(user && user.createdAt, '2005-01-01.00:00:00');
}

// "bd" attribute: birthday in DOT format.
function getFrutizBirthday(user, fallback) {
  return formatFrutizDate(user && user.birthday, fallback || '2000-01-01.00:00:00');
}

module.exports = {
  utcDayKey,
  parisDayKey,
  yesterdayParisDayKey,
  yesterdayDayKey,
  formatFrutizDate,
  getFrutizSubscribeDate,
  getFrutizBirthday,
};
