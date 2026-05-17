// Game-specific lookup tables + tiny pure helpers.
const { escapeXml } = require('../util/xml');
const { parseMtSerializedPrimitive } = require('../util/mt-serialization');

// Kaluga tzongre (mascot) id → slug. Slot 0 stores the chosen mascot as a
// numeric id; the FrutiScore "kaluga_tz" descriptor expects the slug.
const KALUGA_TZONGRE_BY_ID = {
  0: 'kaluga',
  1: 'piwali',
  2: 'nalika',
  3: 'gomola',
  4: 'makulo',
};

// Parse a Kaluga tzongre id from slot data. Accepts raw numbers, MT2004
// primitives ("N3"), and embedded forms like "$tz=N3".
function parseKalugaTzId(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const directNum = Number(s);
  if (Number.isFinite(directNum)) return directNum;
  const mtNum = parseMtSerializedPrimitive(s);
  if (typeof mtNum === 'number' && Number.isFinite(mtNum)) return mtNum;
  const mtObj = s.match(/\$?tz[^0-9-]*N?(-?\d+)/i);
  if (mtObj) return Number(mtObj[1]);
  return null;
}

// Hardcoded NPC stats used when a Frutiz lookup falls back without a real
// user record (e.g. Gaspard, the welcome bot). Keyed by display name.
const HARDCODED_FRUTIZ = {
  Gaspard: { x: 9999999, f: '0n0000000000000000000000' },
};

function hardcodedMeAttrs(name) {
  const d = HARDCODED_FRUTIZ[String(name || '')] || HARDCODED_FRUTIZ.Gaspard;
  return `x="${d.x}" f="${escapeXml(d.f)}"`;
}

// Game disc catalog — each entry describes a SWF that the client can
// launch via /do/ld. `swfName` matches the entry advertised in
// /xml/services.xml (used by FrusionServer for cbeePort lookups).
const GAME_DISCS = {
  bkiwi1: {
    discType: '0',
    playMode: 'single',
    swfName: 'bkiwi',
    gameId: 'games/burningKiwi/burningkiwi.swf',
    props: 'w=350;h=350;m=i',
    files: [
      { u: 'games/burningKiwi/burningkiwi.swf' },
    ],
  },
  kaluga1: {
    discType: '0',
    playMode: 'single',
    swfName: 'kaluga',
    gameId: 'games/kaluga/full.swf',
    props: 'w=640;h=480;m=i',
    files: [
      { u: 'games/kaluga/full.swf' },
    ],
  },
  kalugademo: {
    discType: '3',
    playMode: 'preview',
    swfName: 'kaluga',
    gameId: 'games/kaluga/full.swf',
    props: 'w=640;h=480;m=i',
    files: [
      { u: 'games/kaluga/full.swf' },
    ],
  },
  swapou1: {
    discType: '0',
    playMode: 'single',
    swfName: 'swapou2',
    gameId: 'games/swapou2/swapou.swf',
    props: 'w=640;h=480;m=i',
    files: [
      { u: 'games/swapou2/swapou.swf' },
    ],
  },
  miniwave1: {
    discType: '0',
    playMode: 'single',
    swfName: 'miniwave',
    gameId: 'games/miniWave2/miniwave.swf',
    // Visible game area is 240x240; SWF stage is 600x240 (leftmost 240 = play area,
    // remaining 360 = persistent _root.test debug log TextField hardcoded into the FLA)
    props: 'w=240;h=240;sw=600;sh=240;m=i',
    files: [
      { u: 'games/miniWave2/miniwave.swf' },
    ],
  },
  minipixiz1: {
    discType: '0',
    playMode: 'single',
    swfName: 'minipixiz',
    gameId: 'games/miniTroll/minipixiz.swf',
    props: 'w=240;h=240;m=i',
    files: [
      { u: 'games/miniTroll/minipixiz.swf' },
    ],
  },
  snake3: {
    discType: '0',
    playMode: 'single',
    swfName: 'snake3',
    gameId: 'games/snake3/snake3.swf',
    props: 'w=700;h=480;m=i',
    files: [
      { u: 'games/snake3/snake3.swf' },
    ],
  },
  mb2: {
    discType: '1',
    playMode: 'single',
    swfName: 'mb2',
    gameId: 'games/motionBall2/full.swf',
    props: 'w=550;h=400;m=i',
    files: [
      { u: 'games/motionBall2/full.swf' },
    ],
  },
  jamajama: {
    discType: '0',
    playMode: 'single',
    swfName: 'jamajama',
    iconName: 'jama',
    gameId: 'games/poulpi/game.swf',
    props: 'w=384;h=384;m=i',
    files: [
      { u: 'games/poulpi/game.swf' },
      { u: 'games/poulpi/levels.xml' },
      { u: 'games/poulpi/help.xml' },
      { u: 'games/poulpi/extension.swf' },
    ],
  },
};

// Games that always show a FrutiCard on user profiles (slot 0 → stats /
// achievements panel). Excludes grapiz and bandas (not implemented yet).
const FCARD_GAMES = ['bkiwi', 'snake3', 'swapou2', 'kaluga', 'mb2', 'miniwave', 'jamajama', 'minipixiz'];

module.exports = {
  KALUGA_TZONGRE_BY_ID,
  parseKalugaTzId,
  HARDCODED_FRUTIZ,
  hardcodedMeAttrs,
  GAME_DISCS,
  FCARD_GAMES,
};
