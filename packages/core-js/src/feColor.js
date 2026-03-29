/**
 * Runtime JS mirror for first Lot A migration target.
 * This mirrors the Haxe FEColor API so Node-side tests/integration can start now.
 */

function toRGBObj(nb) {
  const r = (nb >> 16) & 255;
  const g = (nb >> 8) & 255;
  const b = nb & 255;
  return { r, g, b };
}

function toRGBInt(obj) {
  return obj.r * 256 * 256 + obj.g * 256 + obj.b;
}

module.exports = {
  toRGBObj,
  toRGBInt,
};
