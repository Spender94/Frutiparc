// CBee XMLSocket runtime state.
//
// Mostly maps and sets that are mutated in place by the chat protocol
// handler and broadcasters in server.js. Exported by reference so all
// existing call sites (`xmlSocketClients.get(...)`, `channels[name].users
// .add(...)`, …) keep working.

// Channel registry. `users` is a Set<username> of who's currently in.
const channels = {
  pomme:     { desc: 'Salon Pomme',     topic: 'Bienvenue sur le salon Pomme !', users: new Set() },
  abricot:   { desc: 'Salon Abricot',   topic: 'Salon Abricot', users: new Set() },
  poire:     { desc: 'Salon Poire',     topic: 'Salon Poire', users: new Set() },
  fraise:    { desc: 'Salon Fraise',    topic: 'Salon Fraise', users: new Set() },
  citron:    { desc: 'Salon Citron',    topic: 'Salon Citron', users: new Set() },
  kiwi:      { desc: 'Salon Kiwi',      topic: 'Salon Kiwi', users: new Set() },
  raisin:    { desc: 'Salon Raisin',    topic: 'Salon Raisin', users: new Set() },
  orange:    { desc: 'Salon Orange',    topic: 'Salon Orange', users: new Set() },
  cerise:    { desc: 'Salon Cerise',    topic: 'Salon Cerise', users: new Set() },
  banane:    { desc: 'Salon Banane',    topic: 'Salon Banane', users: new Set() },
  bienvenue: { desc: 'Bienvenue',       topic: 'Bienvenue sur Frutiparc !', users: new Set() },
};

// socket → { sid, username, logged, channels: Set }
const xmlSocketClients = new Map();

// targetUsername → Set<socket> — A is subscribed to B when A asks
// for B's trace (CMD.trace) and the subscription is removed on stoptrace.
const traceSubscriptions = new Map();

// Per-channel quiz state (ephemeral — lost on restart).
// { channelName: { question, points: Map<username, number>, active } }
const quizState = {};

// Set<username> — animators with the blue-bold toggle on.
const blueModeUsers = new Set();

// Wrapped because `currentChannel` is reassigned (primitive) — exporting
// an object lets external code keep a single reference: `mdamirmaState.
// currentChannel = name`.
const mdamirmaState = {
  currentChannel: null,
};

// game → Set<username> — eject memory so the next page-popup mount of a
// disc knows it was kicked out (Ruffle's WASM networking bypasses our
// fetch interceptors, so the popup can't see the eject directly).
// Entries are cleared on read so the next mount starts clean.
const recentlyEjected = new Map();

module.exports = {
  channels,
  xmlSocketClients,
  traceSubscriptions,
  quizState,
  blueModeUsers,
  mdamirmaState,
  recentlyEjected,
};
