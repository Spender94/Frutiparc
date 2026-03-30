/**
 * Runtime JS mirror for Lot A target FENumber (subset).
 */

function toColorObj(nb) {
  return {
    r: (nb >> 16) & 0xff,
    g: (nb >> 8) & 0xff,
    b: nb & 0xff,
  };
}

function base36Char(v) {
  return '0123456789abcdefghijklmnopqrstuvwxyz'.charAt(v);
}

function toAlphaString(nb) {
  if (nb > 26) {
    let next;
    if (nb % 26 === 0) {
      next = toAlphaString(Math.floor((nb - 1) / 26));
      nb = 26;
    } else {
      next = toAlphaString(Math.floor(nb / 26));
      nb %= 26;
    }
    nb += 9;
    return next + base36Char(nb);
  }
  return base36Char(nb + 9);
}

function encode62(n, strlen = 1) {
  let ret = '';
  let value = n;
  while (value > 0) {
    const t = value % 62;
    if (t < 36) ret = base36Char(t).toLowerCase() + ret;
    else ret = base36Char(t - 26).toUpperCase() + ret;
    value = (value - t) / 62;
  }
  while (strlen > ret.length) ret = `0${ret}`;
  return ret;
}

function toStringL(n, l) {
  const value = Number.isNaN(Number(n)) || n == null ? 0 : Number(n);
  let s = String(Math.trunc(value));
  while (s.length < l) s = `0${s}`;
  return s;
}

function clamp(v) {
  return Math.min(Math.max(0, v), 255);
}

function modCol(nb, inc = 0, coef = 1) {
  const c = toColorObj(nb);
  const r = clamp(Math.round((c.r + inc) * coef));
  const g = clamp(Math.round((c.g + inc) * coef));
  const b = clamp(Math.round((c.b + inc) * coef));
  return (r << 16) + (g << 8) + b;
}

module.exports = {
  toColorObj,
  toAlphaString,
  encode62,
  toStringL,
  modCol,
};
