/**
 * Runtime JS mirror for Lot A target FEObject.
 */

function clone(obj) {
  const r = {};
  // eslint-disable-next-line guard-for-in
  for (const f in obj) {
    r[f] = obj[f];
  }
  return r;
}

function recursiveClone(obj) {
  const r = {};
  // eslint-disable-next-line guard-for-in
  for (const f in obj) {
    const value = obj[f];
    if (value !== null && typeof value === 'object') {
      r[f] = recursiveClone(value);
    } else {
      r[f] = value;
    }
  }
  return r;
}

function addObject(obj, o, splash = false) {
  // eslint-disable-next-line guard-for-in
  for (const element in o) {
    if (obj[element] === undefined || splash) {
      obj[element] = o[element];
    }
  }
}

function toColNumber(obj) {
  const str = `0x${obj.r.toString(16)}${obj.g.toString(16)}${obj.b.toString(16)}`;
  return Number(str);
}

module.exports = {
  clone,
  recursiveClone,
  addObject,
  toColNumber,
};
