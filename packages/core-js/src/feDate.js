const FENumber = require('./feNumber');

/**
 * Runtime JS mirror for Lot A target FEDate (subset).
 */

function newFromString(str) {
  const y = Number(str.substr(0, 4));
  const m = Number(str.substr(5, 2));
  const d = Number(str.substr(8, 2));

  const h = Number(str.substr(11, 2));
  const i = Number(str.substr(14, 2));
  const s = Number(str.substr(17, 2));

  const date = new Date();
  date.setFullYear(y, m - 1, d);
  if (!Number.isNaN(h)) date.setHours(h);
  if (!Number.isNaN(i)) date.setMinutes(i);
  if (!Number.isNaN(s)) date.setSeconds(s);
  date.setMilliseconds(0);
  return date;
}

function newFromTime(t) {
  const date = new Date();
  date.setTime(t);
  return date;
}

function getObject(d) {
  return {
    y: FENumber.toStringL(d.getFullYear(), 4),
    m: FENumber.toStringL(d.getMonth() + 1, 2),
    d: FENumber.toStringL(d.getDate(), 2),
    h: FENumber.toStringL(d.getHours(), 2),
    i: FENumber.toStringL(d.getMinutes(), 2),
    s: FENumber.toStringL(d.getSeconds(), 2),
  };
}

function getCompleteObject(d) {
  let b = d.getDay();
  if (b === 0) b = 7;

  return {
    y: FENumber.toStringL(d.getYear() % 100, 2),
    Y: FENumber.toStringL(d.getFullYear(), 4),
    b: FENumber.toStringL(b, 1),
    d: FENumber.toStringL(d.getDate(), 1),
    D: FENumber.toStringL(d.getDate(), 2),
    n: FENumber.toStringL(d.getMonth() + 1, 1),
    N: FENumber.toStringL(d.getMonth() + 1, 2),
    h: FENumber.toStringL(d.getHours(), 1),
    H: FENumber.toStringL(d.getHours(), 2),
    i: FENumber.toStringL(d.getMinutes(), 1),
    I: FENumber.toStringL(d.getMinutes(), 2),
    s: FENumber.toStringL(d.getSeconds(), 1),
    S: FENumber.toStringL(d.getSeconds(), 2),
  };
}

module.exports = {
  newFromString,
  newFromTime,
  getObject,
  getCompleteObject,
};
