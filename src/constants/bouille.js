// Bouille (avatar) state defaults + helpers.
//
// Wire format: 24 base62 chars. First 15 = body/clothing/expression slots
// rendered by main.swf; last 9 = accessory ids (3 chars × 3 slots).

const DEFAULT_BOUILLE_STATE = '000000010000000000000000';

// Pens ("crayons") that every user owns by default — used to draw on the
// Frutiparc desktop. Granted on registration and never revocable, so we
// re-inject them on every accessory load to be safe.
const ALL_PEN_ITEM_IDS = [315, 316, 317, 318, 319, 320, 321, 322, 323, 324, 325, 326, 327, 599, 600, 601, 602];

function withDefaultPens(items = []) {
  return Array.from(new Set([...(items || []), ...ALL_PEN_ITEM_IDS]));
}

function normalizeBouilleState(value) {
  // Frutibouille uses base62 tokens (0-9, a-z, A-Z), not only digits.
  let s = String(value || '').replace(/[^0-9a-zA-Z]/g, '');
  if (s.length === 0) return DEFAULT_BOUILLE_STATE;
  if (s.length > 24) s = s.slice(0, 24);
  return s;
}

module.exports = {
  DEFAULT_BOUILLE_STATE,
  ALL_PEN_ITEM_IDS,
  withDefaultPens,
  normalizeBouilleState,
};
