// Force unbuffered stdout/stderr so console.log appears instantly in Render's
// log viewer (pipes default to 4KB block buffering, hiding logs until full).
if (process.stdout._handle && process.stdout._handle.setBlocking) {
  process.stdout._handle.setBlocking(true);
}
if (process.stderr._handle && process.stderr._handle.setBlocking) {
  process.stderr._handle.setBlocking(true);
}

const express = require('express');
let compression;
try { compression = require('compression'); }
catch { /* dependency optional — falls back to no compression */ }
const { WebSocketServer } = require('ws');
const net = require('net');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const db = require('./db');
const fontsPath = path.join(__dirname, 'legacy', 'fonts.swf');

// Standard error sink for fire-and-forget DB writes. Replaces the
// `.catch(() => {})` pattern that used to swallow Postgres failures
// silently — every dropped medal, accessory, game item or mail-state
// change now leaves a trace in the logs so we can detect persistent
// DB issues instead of just losing data quietly.
const dbErr = (op) => (e) => {
  const msg = e && e.message ? e.message : String(e);
  console.error('[DB] ' + op + ' failed: ' + msg);
};



const app = express();
const port = Number(process.env.PORT || 8888);
const XMLSOCKET_PORT = Number(process.env.XMLSOCKET_PORT || 5000); // Must end in 000 for FrutiChat cmdList
// FrutiScore advertised port: client's CBee uses port % 1000 to choose the
// cmdList branch (==0 chat, ==1 score). The actual TCP bytes are routed back
// to XMLSOCKET_PORT via the WebSocket proxy — this is purely a client-side hint.
const FRUTISCORE_PORT = Number(process.env.FRUTISCORE_PORT || 5001);
const PUBLIC_HOST = (process.env.PUBLIC_HOST || '').trim();
const VERBOSE_HTTP_LOGS = process.env.VERBOSE_HTTP_LOGS === '1';
const VERBOSE_SWF_LOGS = process.env.VERBOSE_SWF_LOGS === '1';
const VERBOSE_FRUSION_LOGS = process.env.VERBOSE_FRUSION_LOGS === '1';
const VERBOSE_WS_LOGS = process.env.VERBOSE_WS_LOGS === '1';
// Set VERBOSE_FSCORE=1 to see the verbose [FSCORE-DEBUG] traces
// (rankingResult requests, memory snapshots, awardgame podiums…).
// Disabled in prod by default — kept the call sites in place so we
// can re-enable per-incident without redeploying code.
const VERBOSE_FSCORE = process.env.VERBOSE_FSCORE === '1';
const FRUSION_CLIENT_SWF = (process.env.FRUSION_CLIENT_SWF || '').trim();
const ALLOW_FRUSION_SERVER_SWF = process.env.ALLOW_FRUSION_SERVER_SWF === '1';

// ── CORS headers (Ruffle's WASM fetch may need them) ──
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ── Strip SWF domain-shim prefixes ──
// The patched SWF replaces hardcoded domains with localhost:8888/<prefix>.
// The JS fetch interceptor in ruffle.html may also rewrite to /swf/<path>.
// This middleware normalises all variants so the rest of the server sees clean paths.
app.use((req, res, next) => {
  // Prefix-based shims from SWF patching
  if (req.url.startsWith('/betawww/') || req.url === '/betawww') {
    req.url = req.url.substring(8) || '/';
  } else if (req.url.startsWith('/betaswf/') || req.url === '/betaswf') {
    req.url = req.url.substring(8) || '/';
  } else if (req.url.startsWith('/sw/') || req.url === '/sw') {
    req.url = req.url.substring(3) || '/';
  }
  // Collapse any residual double slashes
  if (req.url.includes('//')) {
    req.url = req.url.replace(/\/{2,}/g, '/');
  }
  next();
});

// gzip text responses (HTML, XML, JSON, plain text). Binary SWFs are already
// compressed (CWS = zlib) so compression skips them via the default filter.
if (compression) {
  // SWFs (.swf) are already zlib-compressed inside the CWS container, so a
  // second gzip pass wastes CPU and — more importantly — switches the
  // response to chunked transfer encoding without a usable Content-Length.
  // Reports of main.swf stalling at ~9% (i.e. ~36 KB of 400 KB delivered)
  // match the pattern of a chunked gzip stream getting truncated mid-flight
  // by Render's free-tier worker recycling. Exclude application/x-shockwave-flash
  // so SWFs go out raw, with a real Content-Length and no intermediate
  // re-encoding to break.
  const defaultFilter = compression.filter;
  app.use(compression({
    threshold: 1024,
    filter: (req, res) => {
      const type = res.getHeader('Content-Type');
      if (typeof type === 'string' && type.indexOf('application/x-shockwave-flash') !== -1) {
        return false;
      }
      return defaultFilter(req, res);
    },
  }));
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Ruffle's LoadVars.sendAndLoad may send POST bodies as text/plain or
// with no Content-Type at all. Capture any unparsed body as raw text,
// but ONLY when the previous parsers didn't already handle it.
app.use(express.text({
  type: (req) => !req.body || (typeof req.body === 'object' && Object.keys(req.body).length === 0)
}));
app.use((req, res, next) => {
  if (typeof req.body === 'string' && req.body.includes('=')) {
    try {
      const parsed = Object.fromEntries(new URLSearchParams(req.body));
      req.body = parsed;
    } catch (e) {}
  }
  next();
});

// Optional HTTP request logs for debugging
app.use((req, res, next) => {
  if (VERBOSE_HTTP_LOGS) {
    console.log(`[HTTP]  ${req.method} ${req.url}`);
  }
  const sid = (req.query && (req.query.sid || req.query.c))
    || (req.body && (req.body.sid || req.body.c))
    || '';
  if (sid) {
    const ip = getClientIp(req);
    if (ip) recentSidByIp.set(ip, sid);
  }
  next();
});



// ─────────────────────────────────────────────
// Diagnostics: validate critical SWF assets are real files (not stubs)
// ─────────────────────────────────────────────
function warnIfStubSwfAssets() {
  const criticalSwfs = [
    'public/swf/fbouille/famille0.swf',
    'public/swf/fbouille/famille1.swf',
    'public/frusion_client.swf',

  ];

  const stubFiles = [];
  for (const relPath of criticalSwfs) {
    const absPath = path.join(__dirname, relPath);
    try {
      const st = fs.statSync(absPath);
      if (st.size <= 32) {
        stubFiles.push(`${relPath} (${st.size} bytes)`);
      }
    } catch {
      stubFiles.push(`${relPath} (missing)`);
    }
  }

  if (stubFiles.length > 0) {
    console.warn('[ASSETS] Frutibouille assets look incomplete.');
    console.warn('[ASSETS] The avatar editor may show blank previews / "undefined" labels.');
    for (const f of stubFiles) {
      console.warn(`[ASSETS]   - ${f}`);
    }
  }
}

// ─────────────────────────────────────────────
// Helpers: base62 encode/decode (matches FEString/FENumber in AS2)
// ─────────────────────────────────────────────
const BASE62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

function encode62(n, minLen = 1) {
  if (n === 0) return '0'.padStart(minLen, '0');
  let result = '';
  let num = n;
  while (num > 0) {
    result = BASE62[num % 62] + result;
    num = Math.floor(num / 62);
  }
  return result.padStart(minLen, '0');
}

function decode62(s) {
  let r = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    let v;
    if (c >= '0' && c <= '9') v = c.charCodeAt(0) - 48;
    else if (c >= 'a' && c <= 'z') v = c.charCodeAt(0) - 87;
    else if (c >= 'A' && c <= 'Z') v = c.charCodeAt(0) - 29;
    else v = 0;
    r = r * 62 + v;
  }
  return r;
}

// Frame number in the events-icon sprite (sprite id=533) for each user-log /
// site-log entry type. Mapped empirically via the /test-log-icon admin scan.
// Drives the icon shown next to each <l type="N"> entry in the user's
// "Mon historique" and "Évènements" desktop windows.
const USER_LOG_TYPE = {
  KICK:        1,    // user ejected from a channel
  BAN:         2,    // user banned
  TOTOCHE:     3,    // user muted (totoché) by a moderator
  // 4: reserved (no visual)
  PICTO:       10,   // unlocked a new game picto / titem
  CHAT:        20,   // chat-related notification (NPC reveal, etc.)
  LEVEL_UP:    30,
  LEVEL_DOWN:  31,
  INSCRIPTION: 40,   // first entry on a freshly-registered account
  GODSON:      50,   // new godson recruited
  MEDAL:       60,   // won a daily-challenge medal
};

// Frame number in the activity-icon sprite (sprite id=246 inside the "status"
// sprite at the "internal" label) for each game. The SWF renders the icon via
// gotoAndStop(internal) where `internal` is the 2-char base62 value broadcast
// in the user's status string. Note: the sprite has been reordered since it
// was authored and its FrameLabels no longer match the visual content at each
// frame — these numbers were validated empirically from the icons users see
// when launching each game. Returning 0 hides the icon (no internal status).
const STATUS_INTERNAL_FRAME = {
  bkiwi:     2,   // verified: Kaluga (internal=2) was showing the BKiwi visual
  mb2:       3,   // verified empirically via /set-internal scan
  swapou2:   4,   // verified empirically via /set-internal scan
  snake3:    5,   // verified: Snake (internal=5) already shows the right visual
  bandas:    6,   // verified: Swapou (internal=6) was showing the Frutibandas visual
  grapiz:    7,   // verified: MB2 (internal=7) was showing the Grapiz visual
  kaluga:    8,   // verified: BKiwi (internal=8) was showing the Kaluga visual
  miniwave:  9,   // verified empirically via /set-internal scan
  // Not yet located in the sprite (frame number unknown): minipixiz, jamajama.
  // forum visual is at frame 36 per FrameLabels.
  forum:     36,
};
function statusInternalCode(name) {
  if (!name) return 0;
  return STATUS_INTERNAL_FRAME[name] || 0;
}

const DEFAULT_BOUILLE_STATE = '000000010000000000000000';
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

const PROFANITY_REPLACEMENTS = [
  [/\bcon\b/gi, 'blonk'],
  [/\bconne\b/gi, 'blonk'],
  [/\bputain\b/gi, 'margotton'],
  [/\bpute\b/gi, 'ribaude'],
  [/\bcontent\b/gi, 'youpi-banane'],
  [/\bcontente\b/gi, 'youpi-banane'],
  [/\bmignon\b/gi, 'youpi-framboise'],
  [/\bmignonne\b/gi, 'youpi-framboise'],
  [/\bserveur\b/gi, 'gros cube noir et lourd qui ventile fort'],
];

function censorProfanity(text) {
  if (!text) return text;
  let out = String(text);
  for (const [re, repl] of PROFANITY_REPLACEMENTS) out = out.replace(re, repl);
  return out;
}

// ─────────────────────────────────────────────
// Game Titems/Pictos — mapping item names to display info + GIF paths
// ─────────────────────────────────────────────
const GAME_ITEM_INFO = {
  // Kaluga
  '$butterfly0': { name: 'Papillon vert',       game: 'Kaluga', gif: 'Games/kaluga/Titems/gif/papillonVert.gif' },
  '$butterfly1': { name: 'Papillon jaune',      game: 'Kaluga', gif: 'Games/kaluga/Titems/gif/papillonJaune.gif' },
  '$butterfly2': { name: 'Papillon rose',       game: 'Kaluga', gif: 'Games/kaluga/Titems/gif/papillonRose.gif' },
  '$butterfly3': { name: 'Papillon violet',     game: 'Kaluga', gif: 'Games/kaluga/Titems/gif/papillonViolet.gif' },
  '$smiley0':    { name: 'Drapeau blanc',       game: 'Kaluga', gif: 'Games/kaluga/Titems/gif/drapeauBlanc.gif' },
  '$smiley1':    { name: 'Drapeau rouge',       game: 'Kaluga', gif: 'Games/kaluga/Titems/gif/drapeauRouge.gif' },
  '$smiley2':    { name: 'Gong de piste',       game: 'Kaluga', gif: 'Games/kaluga/Titems/gif/gongPiste.gif' },
  '$smiley3':    { name: 'Heptathlon',          game: 'Kaluga', gif: 'Games/kaluga/Titems/gif/heptathlon.gif' },
  '$tz1':        { name: 'Piwali',              game: 'Kaluga', gif: 'Games/kaluga/Titems/gif/midPiwali.gif' },
  '$tz2':        { name: 'Nalika',              game: 'Kaluga', gif: 'Games/kaluga/Titems/gif/midNalika.gif' },
  '$tz3':        { name: 'Makulo',              game: 'Kaluga', gif: 'Games/kaluga/Titems/gif/midMakulo.gif' },
  '$tz4':        { name: 'Gomola',              game: 'Kaluga', gif: 'Games/kaluga/Titems/gif/midGomola.gif' },
  '$basket':     { name: 'Panier',              game: 'Kaluga', gif: 'Games/kaluga/Titems/gif/panier.gif' },
  '$bird':       { name: 'Corbeau',             game: 'Kaluga', gif: 'Games/kaluga/Titems/corbeau.gif' },
  '$ring':       { name: 'Kaluga Spécial',      game: 'Kaluga', gif: 'Games/kaluga/Titems/gif/kalugaSpecial.gif' },
  '$ant':        { name: 'Fourmi',              game: 'Kaluga', gif: 'Games/kaluga/Titems/gif/fourmi.gif' },
  '$kagulga':    { name: 'Kagulga',             game: 'Kaluga', gif: 'Games/kaluga/Titems/gif/midKaluga.gif' },
  // Swapou2
  '$sel':        { name: 'Sel',                 game: 'Swapou', gif: 'Games/swapou2/images/titems/item_sel.gif' },
  '$poivre':     { name: 'Poivre',              game: 'Swapou', gif: 'Games/swapou2/images/titems/item_poivre.gif' },
  '$epee':       { name: 'Dague',               game: 'Swapou', gif: 'Games/swapou2/images/titems/item_dague.gif' },
  '$piment':     { name: 'Piment',              game: 'Swapou', gif: 'Games/swapou2/images/titems/item_piment.gif' },
  '$dent':       { name: 'Dent',                game: 'Swapou', gif: 'Games/swapou2/images/titems/item_dent.gif' },
  '$sucre':      { name: 'Sucre',               game: 'Swapou', gif: 'Games/swapou2/images/titems/item_sucre.gif' },
  '$metal01':    { name: 'Métal 1',             game: 'Swapou', gif: 'Games/swapou2/images/titems/metal_01.gif' },
  '$metal02':    { name: 'Métal 2',             game: 'Swapou', gif: 'Games/swapou2/images/titems/metal_02.gif' },
  '$metal03':    { name: 'Métal 3',             game: 'Swapou', gif: 'Games/swapou2/images/titems/metal_03.gif' },
  '$ice01':      { name: 'Glace 1',             game: 'Swapou', gif: 'Games/swapou2/images/titems/frozen_01.gif' },
  '$ice02':      { name: 'Glace 2',             game: 'Swapou', gif: 'Games/swapou2/images/titems/frozen_02.gif' },
  '$ice03':      { name: 'Glace 3',             game: 'Swapou', gif: 'Games/swapou2/images/titems/frozen_03.gif' },
  '$star01':     { name: 'Étoile 1',            game: 'Swapou', gif: 'Games/swapou2/images/titems/star_01.gif' },
  '$star02':     { name: 'Étoile 2',            game: 'Swapou', gif: 'Games/swapou2/images/titems/star_02.gif' },
  '$star03':     { name: 'Étoile 3',            game: 'Swapou', gif: 'Games/swapou2/images/titems/star_03.gif' },
  '$fruit01':    { name: 'Fruit 1',             game: 'Swapou', gif: 'Games/swapou2/images/titems/fruit_01.gif' },
  '$fruit02':    { name: 'Fruit 2',             game: 'Swapou', gif: 'Games/swapou2/images/titems/fruit_02.gif' },
  '$fruit03':    { name: 'Fruit 3',             game: 'Swapou', gif: 'Games/swapou2/images/titems/fruit_03.gif' },
  '$fruit04':    { name: 'Fruit 4',             game: 'Swapou', gif: 'Games/swapou2/images/titems/fruit_04.gif' },
  '$fruit05':    { name: 'Fruit 5',             game: 'Swapou', gif: 'Games/swapou2/images/titems/fruit_05.gif' },
  '$fruit06':    { name: 'Fruit 6',             game: 'Swapou', gif: 'Games/swapou2/images/titems/fruit_06.gif' },
  '$fruit07':    { name: 'Fruit 7',             game: 'Swapou', gif: 'Games/swapou2/images/titems/fruit_07.gif' },
  '$fruit08':    { name: 'Fruit 8',             game: 'Swapou', gif: 'Games/swapou2/images/titems/fruit_08.gif' },
  '$fruit09':    { name: 'Fruit 9',             game: 'Swapou', gif: 'Games/swapou2/images/titems/fruit_09.gif' },
  '$fruit10':    { name: 'Fruit 10',            game: 'Swapou', gif: 'Games/swapou2/images/titems/fruit_10.gif' },
  '$fruit11':    { name: 'Fruit 11',            game: 'Swapou', gif: 'Games/swapou2/images/titems/fruit_11.gif' },
  '$combo01':    { name: 'Combo 1',             game: 'Swapou', gif: 'Games/swapou2/images/titems/combo_01.gif' },
  '$combo02':    { name: 'Combo 2',             game: 'Swapou', gif: 'Games/swapou2/images/titems/combo_02.gif' },
  '$combo03':    { name: 'Combo 3',             game: 'Swapou', gif: 'Games/swapou2/images/titems/combo_03.gif' },
  '$combo04':    { name: 'Combo 4',             game: 'Swapou', gif: 'Games/swapou2/images/titems/combo_04.gif' },
  '$combo05':    { name: 'Combo 5',             game: 'Swapou', gif: 'Games/swapou2/images/titems/combo_05.gif' },
  '$combo06':    { name: 'Combo 6',             game: 'Swapou', gif: 'Games/swapou2/images/titems/combo_06.gif' },
  '$combo07':    { name: 'Combo 7',             game: 'Swapou', gif: 'Games/swapou2/images/titems/combo_07.gif' },
  '$combo08':    { name: 'Combo 8',             game: 'Swapou', gif: 'Games/swapou2/images/titems/combo_08.gif' },
  '$combo09':    { name: 'Combo 9',             game: 'Swapou', gif: 'Games/swapou2/images/titems/combo_09.gif' },
  '$combo10':    { name: 'Combo 10',            game: 'Swapou', gif: 'Games/swapou2/images/titems/combo_10.gif' },
  '$combo11':    { name: 'Combo 11',            game: 'Swapou', gif: 'Games/swapou2/images/titems/combo_11.gif' },
  '$photo01':    { name: 'Photo Sel',           game: 'Swapou', gif: 'Games/swapou2/images/titems/photo_sel.gif' },
  '$photo02':    { name: 'Photo Moutarde',      game: 'Swapou', gif: 'Games/swapou2/images/titems/photo_moutarde.gif' },
  '$photo03':    { name: 'Photo Dimitri',       game: 'Swapou', gif: 'Games/swapou2/images/titems/photo_dimitri.gif' },
  '$photo04':    { name: 'Photo Natacha',       game: 'Swapou', gif: 'Games/swapou2/images/titems/photo_natacha.gif' },
  '$photo05':    { name: 'Photo Poivre',        game: 'Swapou', gif: 'Games/swapou2/images/titems/photo_poivre.gif' },
  '$photo06':    { name: 'Photo Tomtom',        game: 'Swapou', gif: 'Games/swapou2/images/titems/photo_tomtom.gif' },
  '$photo07':    { name: 'Photo Wasabi',        game: 'Swapou', gif: 'Games/swapou2/images/titems/photo_wasabi.gif' },
  // $photo08 (slot 45 in TItem.as TITEMS) — unobtainable: duelItem() awards
  // PHOTO_TITEMS + Data.players[1] where players[1] is the AI opponent
  // index, and Swapou2 only has 7 AI characters (character/bitmap/{sel,
  // poivre, dimitri, natacha, tomtom, wasabi, piment}). Reserved slot.
  // Total: 45 SWF slots − 1 reserved − 1 empty (TITEMS[1]) = 44 obtenables.
  // MotionBall2
  '$c1or':       { name: 'Balle jaune or',      game: 'MotionBall', gif: 'Games/motionBall2/picto/ballJauneOr.gif' },
  '$c1argent':   { name: 'Balle jaune argent',  game: 'MotionBall', gif: 'Games/motionBall2/picto/ballJauneArgent.gif' },
  '$c1':         { name: 'Balle jaune bronze',  game: 'MotionBall', gif: 'Games/motionBall2/picto/ballJauneBronze.gif' },
  '$c2or':       { name: 'Balle verte or',      game: 'MotionBall', gif: 'Games/motionBall2/picto/ballVerteOr.gif' },
  '$c2argent':   { name: 'Balle verte argent',  game: 'MotionBall', gif: 'Games/motionBall2/picto/ballVerteArgent.gif' },
  '$c2':         { name: 'Balle verte bronze',  game: 'MotionBall', gif: 'Games/motionBall2/picto/ballVerteBronze.gif' },
  '$c3or':       { name: 'Balle rouge or',      game: 'MotionBall', gif: 'Games/motionBall2/picto/ballRougeOr.gif' },
  '$c3argent':   { name: 'Balle rouge argent',  game: 'MotionBall', gif: 'Games/motionBall2/picto/ballRougeArgent.gif' },
  '$c3':         { name: 'Balle rouge bronze',  game: 'MotionBall', gif: 'Games/motionBall2/picto/ballRougeBronze.gif' },
  '$c4or':       { name: 'Balle orange or',     game: 'MotionBall', gif: 'Games/motionBall2/picto/ballOrangeOr.gif' },
  '$c4argent':   { name: 'Balle orange argent', game: 'MotionBall', gif: 'Games/motionBall2/picto/ballOrangeArgent.gif' },
  '$c4':         { name: 'Balle orange bronze', game: 'MotionBall', gif: 'Games/motionBall2/picto/ballOrangeBronze.gif' },
  '$c5or':       { name: 'Balle bleue or',      game: 'MotionBall', gif: 'Games/motionBall2/picto/ballBleueOr.gif' },
  '$c5argent':   { name: 'Balle bleue argent',  game: 'MotionBall', gif: 'Games/motionBall2/picto/ballBleueArgent.gif' },
  '$c5':         { name: 'Balle bleue bronze',  game: 'MotionBall', gif: 'Games/motionBall2/picto/ballBleueBronze.gif' },
  '$c6or':       { name: 'Balle métal or',      game: 'MotionBall', gif: 'Games/motionBall2/picto/ballMetalOr.gif' },
  '$c6argent':   { name: 'Balle métal argent',  game: 'MotionBall', gif: 'Games/motionBall2/picto/ballMetalArgent.gif' },
  '$c6':         { name: 'Balle métal bronze',  game: 'MotionBall', gif: 'Games/motionBall2/picto/ballMetalBronze.gif' },
  '$c7or':       { name: 'Balle violette or',   game: 'MotionBall', gif: 'Games/motionBall2/picto/ballVioletteOr.gif' },
  '$c7argent':   { name: 'Balle violette argent', game: 'MotionBall', gif: 'Games/motionBall2/picto/ballVioletteArgent.gif' },
  '$c7':         { name: 'Balle violette bronze', game: 'MotionBall', gif: 'Games/motionBall2/picto/ballVioletteBronze.gif' },
  '$bfacettes':  { name: 'Balle à facettes',    game: 'MotionBall', gif: 'Games/motionBall2/picto/ballaFacettes.gif' },
  '$bnormal':    { name: 'Bumper normal',       game: 'MotionBall', gif: 'Games/motionBall2/picto/bumperNormal.gif' },
  '$btime':      { name: 'Bumper du temps',     game: 'MotionBall', gif: 'Games/motionBall2/picto/bumperDuTemp.gif' },
  '$bdeath':     { name: 'Bumper de la mort',   game: 'MotionBall', gif: 'Games/motionBall2/picto/bumperDeLaMort.gif' },
  '$bmagnet':    { name: 'Bumper magnétique',   game: 'MotionBall', gif: 'Games/motionBall2/picto/bumperMagnetic.gif' },
  '$bshadow':    { name: 'Bumper invisible',    game: 'MotionBall', gif: 'Games/motionBall2/picto/bumperInvisible.gif' },
  '$oeil':       { name: "Oeil du poulpe",      game: 'MotionBall', gif: 'Games/motionBall2/picto/oeilDuPoulpe.gif' },
  '$masque':     { name: 'Masque de TB',        game: 'MotionBall', gif: 'Games/motionBall2/picto/maskDeTB.gif' },
  '$eca0':       { name: 'Écaille verte',       game: 'MotionBall', gif: 'Games/motionBall2/picto/ecailleVerte.gif' },
  '$eca1':       { name: 'Écaille rouge',       game: 'MotionBall', gif: 'Games/motionBall2/picto/ecailleRouge.gif' },
  '$eca2':       { name: 'Écaille bleue',       game: 'MotionBall', gif: 'Games/motionBall2/picto/ecailleBleue.gif' },
  '$eca3':       { name: 'Écaille marron',      game: 'MotionBall', gif: 'Games/motionBall2/picto/ecailleMarron.gif' },
  '$symb0':      { name: 'Logo eau',            game: 'MotionBall', gif: 'Games/motionBall2/picto/logoEau.gif' },
  '$symb1':      { name: 'Logo feu',            game: 'MotionBall', gif: 'Games/motionBall2/picto/logoFeu.gif' },
  '$symb2':      { name: 'Logo vent',           game: 'MotionBall', gif: 'Games/motionBall2/picto/logoVent.gif' },
  '$symb3':      { name: 'Logo terre',          game: 'MotionBall', gif: 'Games/motionBall2/picto/logoTerre.gif' },
  // Burning Kiwi
  '$fruticup':   { name: 'Fruticoupe Argent',   game: 'Burning Kiwi', gif: 'Games/burningKiwi/forum/fruticupSilver.gif' },
  '$fruticupxl': { name: 'Fruticoupe Or',       game: 'Burning Kiwi', gif: 'Games/burningKiwi/forum/fruticup.gif' },
  '$elite':      { name: 'Elite Argent',        game: 'Burning Kiwi', gif: 'Games/burningKiwi/forum/eliteSilver.gif' },
  '$elitexl':    { name: 'Elite Or',            game: 'Burning Kiwi', gif: 'Games/burningKiwi/forum/elite.gif' },
  '$logo01':     { name: 'Écurie UWE Wing',     game: 'Burning Kiwi', gif: 'Games/burningKiwi/forum/teamUWE.gif' },
  '$logo02':     { name: 'Écurie Fury Hun',     game: 'Burning Kiwi', gif: 'Games/burningKiwi/forum/teamFury.gif' },
  '$logo03':     { name: 'Écurie Sonic Brain',  game: 'Burning Kiwi', gif: 'Games/burningKiwi/forum/teamSonic.gif' },
  '$logo04':     { name: 'Écurie KiwiX',        game: 'Burning Kiwi', gif: 'Games/burningKiwi/forum/teamKiwix.gif' },
  '$logo05':     { name: 'Écurie Ultra',        game: 'Burning Kiwi', gif: 'Games/burningKiwi/forum/teamUltra.gif' },
  '$car01':      { name: 'Bolide UWE Wing',     game: 'Burning Kiwi', gif: 'Games/burningKiwi/forum/carUWE.gif' },
  '$car02':      { name: 'Bolide Fury Hun',     game: 'Burning Kiwi', gif: 'Games/burningKiwi/forum/carFury.gif' },
  '$car03':      { name: 'Bolide Sonic Brain',  game: 'Burning Kiwi', gif: 'Games/burningKiwi/forum/carSonic.gif' },
  '$car04':      { name: 'Bolide KiwiX',        game: 'Burning Kiwi', gif: 'Games/burningKiwi/forum/carKiwix.gif' },
  '$car05':      { name: 'Bolide Ultra',         game: 'Burning Kiwi', gif: 'Games/burningKiwi/forum/carUltra.gif' },
  // MiniWave2
  '$ship00':     { name: 'Vaisseau 0',          game: 'MiniWave', gif: 'Games/miniWave2/titem/gif/ship00.gif' },
  '$ship01':     { name: 'Vaisseau 1',          game: 'MiniWave', gif: 'Games/miniWave2/titem/gif/ship01.gif' },
  '$ship02':     { name: 'Vaisseau 2',          game: 'MiniWave', gif: 'Games/miniWave2/titem/gif/ship02.gif' },
  '$ship03':     { name: 'Vaisseau 3',          game: 'MiniWave', gif: 'Games/miniWave2/titem/gif/ship03.gif' },
  '$ship04':     { name: 'Vaisseau 4',          game: 'MiniWave', gif: 'Games/miniWave2/titem/gif/ship04.gif' },
  '$ship05':     { name: 'Vaisseau 5',          game: 'MiniWave', gif: 'Games/miniWave2/titem/gif/ship05.gif' },
  '$arcade':     { name: 'Arcade Boss',         game: 'MiniWave', gif: 'Games/miniWave2/titem/pictoBoss.gif' },
  '$letter':     { name: 'Letter Invader',     game: 'MiniWave', gif: 'Games/miniWave2/titem/gif/letter.gif' },
  '$smiley_love':  { name: 'Smiley Love',      game: 'MiniWave', gif: 'Games/miniWave2/titem/gif/ship00.gif' },
  '$smiley_laugh': { name: 'Smiley Laugh',     game: 'MiniWave', gif: 'Games/miniWave2/titem/gif/ship00.gif' },
  '$smiley_twirl': { name: 'Smiley Twirl',     game: 'MiniWave', gif: 'Games/miniWave2/titem/gif/ship00.gif' },
  '$wpMinistar':   { name: 'Arme Ministar',    game: 'MiniWave', gif: 'Games/miniWave2/titem/gif/ship00.gif' },
  '$wpNostromo':   { name: 'Arme Nostromo',    game: 'MiniWave', gif: 'Games/miniWave2/titem/gif/ship00.gif' },
};

// Build MiniWave2 bads (bad00..bad50) and missions (mis0..mis4)
for (let i = 0; i <= 50; i++) {
  const pad = String(i).padStart(2, '0');
  GAME_ITEM_INFO[`$bads${i}`] = { name: `Monstre ${i}`, game: 'MiniWave', gif: `Games/miniWave2/titem/gif/bad${pad}.gif` };
}
for (let i = 0; i <= 4; i++) {
  GAME_ITEM_INFO[`$mis${i}`] = { name: `Mission ${i}`, game: 'MiniWave', gif: `Games/miniWave2/titem/gif/mis${i}.gif` };
}

// ─── MiniPixiz (miniTroll) titems ─────────────────────────────────────────────
// itemList from Games/miniTroll/src/Item.mt (item ID → name).
// In the assets folder the GIF file index is item_id + 1
// (e.g. item ID 0 = GANTS+1 → bmp/titems/GIF/item/item_1.gif).
const PIXIZ_ITEM_NAMES = {
  // CARAC (gloves/boots/heart/diadem/idol/pearl) +1/+2/+3
  0: 'Gants +1', 1: 'Gants +2', 2: 'Gants +3',
  5: 'Bottes +1', 6: 'Bottes +2', 7: 'Bottes +3',
  10: 'Cœur +1', 11: 'Cœur +2', 12: 'Cœur +3',
  15: 'Diadème +1', 16: 'Diadème +2', 17: 'Diadème +3',
  20: 'Idole +1', 21: 'Idole +2', 22: 'Idole +3',
  25: 'Perle +1', 26: 'Perle +2', 27: 'Perle +3',
  // Utility
  30: 'Flasque', 31: 'Clé',
  // Special powers
  40: 'Invisibilité', 41: 'Masque de peur', 42: 'Régénération de vie',
  43: 'Régénération de mana', 44: 'Plus d\'expérience', 45: 'Casque à corne',
  46: 'Totoche',
  // Carac all (50-55)
  50: 'Globe +1 - Force', 51: 'Globe +1 - Agilité', 52: 'Globe +1 - Vie',
  53: 'Globe +1 - Charisme', 54: 'Globe +1 - Magie', 55: 'Globe +1 - Sagesse',
  // Coloration (60-69)
  60: 'Coloration 1', 61: 'Coloration 2', 62: 'Coloration 3', 63: 'Coloration 4',
  64: 'Coloration 5', 65: 'Coloration 6', 66: 'Coloration 7', 67: 'Coloration 8',
  68: 'Coloration 9', 69: 'Coloration 10',
  // Potions (70-72)
  70: 'Petite potion', 71: 'Potion moyenne', 72: 'Grosse potion',
  // Bags (80-83)
  80: 'Sac +1', 81: 'Sac +2', 82: 'Sac +3', 83: 'Sac +4',
};
// Spell ids 0..27 per Games/miniTroll/src/Spell.mt newSpell() switch.
// 0 (Swap) and 20 (Boule de lumière) are base spells every faerie starts
// with — their parchemins/grimoires ($item[100/200/120/220]) are listed
// in the album but never granted (4 of the 5 réservés ; the 5th is the
// dungeon key at $item[31]).
const PIXIZ_SPELL_NAMES = {
  0: 'Échange',
  1: 'Creuser', 2: 'Mineur', 3: 'Massif', 4: 'Mangeur d\'étoiles',
  5: 'Décompression', 6: 'Fossilisation', 7: 'Ascension', 8: 'Berserk',
  9: 'Tranche', 10: 'Silence', 11: 'Destruction', 12: 'Bouclier',
  13: 'Nova', 14: 'Bannissement', 15: 'Foudre', 16: 'Peinture',
  20: 'Boule de lumière', 21: 'Rayon de lumière', 22: 'Solero',
  23: 'Feu follet', 24: 'Glu', 25: 'Flamme', 26: 'Boule sacrée',
  27: 'Fantôme',
};
// Scrolls (id 100+spell.id) and Books (id 200+spell.id)
for (const [spellId, spellName] of Object.entries(PIXIZ_SPELL_NAMES)) {
  PIXIZ_ITEM_NAMES[100 + Number(spellId)] = `Parchemin de ${spellName}`;
  PIXIZ_ITEM_NAMES[200 + Number(spellId)] = `Livre de ${spellName}`;
}
// Build picto entries for each item that has a GIF on disk.
// GIF filename = item_${id+1}.gif under bmp/titems/GIF/item/.
for (const [idStr, itemName] of Object.entries(PIXIZ_ITEM_NAMES)) {
  const id = Number(idStr);
  const gifIdx = id + 1;
  const gif = `Games/miniTroll/bmp/titems/GIF/item/item_${gifIdx}.gif`;
  if (fs.existsSync(path.join(__dirname, gif))) {
    GAME_ITEM_INFO[`$pixiz_item${id}`] = { name: itemName, game: 'MiniPixiz', gif };
  }
}
// Foods — slot data tracks $stat.$eat[foodId] and food IDs are 300..354 (every 3).
// GIFs are indexed sequentially: food_1.gif → ID 300, food_2.gif → ID 301, ..., food_57.gif → ID 356.
const PIXIZ_FOOD_BASE_NAMES = [
  'Banane','Cerise','Champignon','Poire','Mure',
  'Carotte','Orange','Citron','Fraise','Tomate',
  'Pomme','Brioche','Œuf','Statue','Gouda',
  'Poireau','Pâtisserie','Raisin','Melon',
];
for (let i = 0; i < 57; i++) {
  const id = 300 + i;
  const baseName = PIXIZ_FOOD_BASE_NAMES[Math.floor(i / 3)] || `Aliment ${i}`;
  const variant = ['petit', 'moyen', 'grand'][i % 3] || '';
  const gif = `Games/miniTroll/bmp/titems/GIF/food/food_${i + 1}.gif`;
  if (fs.existsSync(path.join(__dirname, gif))) {
    GAME_ITEM_INFO[`$pixiz_food${id}`] = { name: `${baseName} (${variant})`.trim(), game: 'MiniPixiz', gif };
  }
}
// Diamonds (5 colors) — earned by completing each Dungeon difficulty level
// (Games/miniTroll/src/base/Dungeon.mt: `diam.skin.gotoAndStop(string(difficulty+1))`
// where difficulty = card.$dungeon.$lvl). The 5 GIFs in bmp/titems/GIF/diam/
// are real album pictos — they bring MiniPixiz to its canonical total of
// 162 slots (100 items + 57 foods + 5 diamonds), of which 5 are reserved
// and unobtainable (la clé de donjon and the 4 base spells' parchemins/grimoires).
const PIXIZ_DIAM_NAMES = ['cuivre', 'argent', 'or', 'rubis', 'éclat'];
for (let i = 1; i <= 5; i++) {
  GAME_ITEM_INFO[`$pixiz_diam${i}`] = {
    name: `Diamant ${PIXIZ_DIAM_NAMES[i - 1]}`,
    game: 'MiniPixiz',
    gif: `Games/miniTroll/bmp/titems/GIF/diam/diam${i}.gif`,
  };
}

// JamaJama (Poulpi) — milestone pictos awarded based on number of saved
// scores (= levels completed/abandoned). The game's source SWF has no
// native giveItem mechanism, so pictos are derived from server-side
// signals (saveScore, slot save) by counting plays.
const JAMA_MILESTONES = {
  '$jama_first':       { name: 'Premier coup de Tiki',    threshold: 1 },
  '$jama_play10':      { name: '10 niveaux joués',         threshold: 10 },
  '$jama_play25':      { name: '25 niveaux joués',         threshold: 25 },
  '$jama_play50':      { name: '50 niveaux joués',         threshold: 50 },
  '$jama_play100':     { name: '100 niveaux joués',        threshold: 100 },
  '$jama_play250':     { name: '250 niveaux joués',        threshold: 250 },
  '$jama_play500':     { name: '500 niveaux joués',        threshold: 500 },
  '$jama_play1000':    { name: '1000 niveaux joués',       threshold: 1000 },
};
for (const [id, info] of Object.entries(JAMA_MILESTONES)) {
  // Reuse the JamaJama disc icon as fallback gif (resolveGameItemGif also
  // tolerates missing files — the picto still appears in inventory by name).
  GAME_ITEM_INFO[id] = { name: info.name, game: 'JamaJama', gif: 'Games/poulpi/images/intro.jpg' };
}

// Award JamaJama milestone pictos based on the cumulative number of saved
// scores (= attempted/finished levels). Called from both the HTTP and
// XMLSocket score-save paths.
function awardJamaPictosOnScore(username) {
  const user = users[username];
  if (!user) return;
  user.jamaPlayCount = (Number(user.jamaPlayCount) || 0) + 1;
  if (!Array.isArray(user.gameItems)) user.gameItems = [];
  const dbId = user._dbId;
  for (const [id, info] of Object.entries(JAMA_MILESTONES)) {
    if (user.jamaPlayCount >= info.threshold && !user.gameItems.includes(id)) {
      user.gameItems.push(id);
      if (dbId) db.addGameItem(dbId, id).catch((e) => console.error('[DB] addGameItem jama:', e.message));
      addAndNotifyUserLog(username, { type: USER_LOG_TYPE.PICTO, content: `Nouveau picto débloqué sur JamaJama : ${info.name} !` });
      console.log(`[JAMA]  picto ${id} for ${username} (plays=${user.jamaPlayCount})`);
    }
  }
}

// ─────────────────────────────────────────────
// Consecration: per-game progression registry
// Set `enabled: false` for games not yet finalised; the score auto-rebalances.
// ─────────────────────────────────────────────
const GAME_PROGRESS_REGISTRY = [
  {
    id: 'kaluga',
    name: 'Kaluga',
    enabled: true,
    matchGame: 'Kaluga', // matches getGameItemGame() value
  },
  {
    id: 'swapou',
    name: 'Swapou',
    enabled: true,
    matchGame: 'Swapou',
    // Canonical Swapou2 album count per Games/swapou2/swapou2/TItem.as
    // (46 TITEMS slots − 1 empty at index 1 − 1 reserved $photo08) = 44.
    totalPictos: 44,
  },
  {
    id: 'snake3',
    name: 'Frutisnake',
    enabled: true,
    matchGame: 'Frutisnake',
    totalPictos: 322, // dynamic "Fruit N" pictos — fixed total used as denominator
  },
  {
    id: 'bkiwi',
    name: 'Burning Kiwi',
    enabled: true,
    matchGame: 'Burning Kiwi',
  },
  {
    id: 'mb2',
    name: 'MotionBall',
    enabled: true,
    matchGame: 'MotionBall',
  },
  {
    id: 'miniwave',
    name: 'MiniWave',
    enabled: true,
    matchGame: 'MiniWave',
  },
  {
    id: 'jamajama',
    name: 'JamaJama',
    enabled: true,
    matchGame: 'JamaJama',
    // The original Frutiparc album for JamaJama held 28 pictos (player
    // memory, "quasi-sûr"). JamaJama's SWF (Games/poulpi/inc/{code,main}.as,
    // levels.xml) has NO native picto system — the album was a Frutiparc
    // server-side construct keyed off level/pack accomplishments. The
    // exact 28-item composition is lost ; the 7 adventure packs ×
    // (something ≤ 4) is the most natural fit but unconfirmed. Until
    // someone surfaces the original list, we expose 28 as the canonical
    // denominator and award only the 8 JAMA_MILESTONES we currently track.
    // TODO(jama-pictos): recover the original 28-picto list and replace
    // JAMA_MILESTONES with the canonical set.
    totalPictos: 28,
  },
  {
    id: 'pixiz',
    name: 'MiniPixiz',
    enabled: true,
    matchGame: 'MiniPixiz',
    // 100 items (bmp/titems/GIF/item/) + 57 foods + 5 diamants
    // = 162 emplacements d'album dont 5 réservés inaccessibles
    // (clé de donjon + parchemins/grimoires des sorts de base des fées
    // Swap & Boule de lumière) → 157 obtenables. Voir PIXIZ_SPELL_NAMES.
    totalPictos: 162,
  },
];

// Returns { id, name, unlocked, total, percent, gameContribution } per enabled game
// plus an overall percent.
function computeConsecration(username) {
  const user = users[username];
  const enabled = GAME_PROGRESS_REGISTRY.filter((g) => g.enabled);
  const perGameMax = enabled.length > 0 ? 100 / enabled.length : 0;

  const breakdown = enabled.map((g) => {
    let unlocked = 0;
    let total = 0;
    let mode = 'pictos';
    if (g.completionCheck) {
      mode = 'completion';
      unlocked = g.completionCheck(username) ? 1 : 0;
      total = 1;
    } else if (g.matchGame) {
      const gi = (user && Array.isArray(user.gameItems)) ? user.gameItems : [];
      const ownedForGame = gi.filter((it) => getGameItemGame(it) === g.matchGame);
      unlocked = ownedForGame.length;
      if (typeof g.totalPictos === 'number') {
        total = g.totalPictos;
      } else {
        // count entries in GAME_ITEM_INFO matching this game
        total = Object.values(GAME_ITEM_INFO).filter((info) => info.game === g.matchGame).length;
      }
    }
    const ratio = total > 0 ? Math.min(unlocked / total, 1) : 0;
    const gameContribution = ratio * perGameMax;
    return {
      id: g.id,
      name: g.name,
      mode,
      unlocked,
      total,
      percent: Math.round(ratio * 100 * 100) / 100,
      contribution: Math.round(gameContribution * 100) / 100,
    };
  });

  const overall = breakdown.reduce((sum, b) => sum + b.contribution, 0);
  return {
    overall: Math.round(overall * 100) / 100,
    perGameMax: Math.round(perGameMax * 100) / 100,
    enabledCount: enabled.length,
    games: breakdown,
  };
}

function resolveGameItemGif(itemName) {
  const info = GAME_ITEM_INFO[itemName];
  if (info && info.gif) {
    const abs = path.join(__dirname, info.gif);
    try { if (fs.statSync(abs).isFile()) return abs; } catch {}
  }
  // Snake3: "Fruit N" → snakeFruitNNNN.gif
  const snakeMatch = /^Fruit (\d+)$/.exec(itemName);
  if (snakeMatch) {
    const pad = String(snakeMatch[1]).padStart(4, '0');
    const abs = path.join(__dirname, 'Games', 'snake3', 'gif', `snakeFruit${pad}.gif`);
    try { if (fs.statSync(abs).isFile()) return abs; } catch {}
  }
  return null;
}

function getGameItemDisplayName(itemName) {
  const info = GAME_ITEM_INFO[itemName];
  if (info) return info.name;
  const snakeMatch = /^Fruit (\d+)$/.exec(itemName);
  if (snakeMatch) return `Fruit ${snakeMatch[1]}`;
  return itemName.replace(/^\$/, '');
}

function getGameItemGame(itemName) {
  const info = GAME_ITEM_INFO[itemName];
  if (info) return info.game;
  if (/^Fruit \d+$/.test(itemName)) return 'Frutisnake';
  return '';
}

// One inventory <e> for a picto: clicking it opens the single-picto popup.
function renderPictoEntryXml(itemName) {
  const displayName = getGameItemDisplayName(itemName);
  const gameName = getGameItemGame(itemName) || 'Autre';
  const viewerUrl = `/picto-view.html?item=${encodeURIComponent(itemName)}&name=${encodeURIComponent(displayName)}&game=${encodeURIComponent(gameName)}`;
  return `<e u="${escapeXml(itemName)}" t="url" s="10" d="0" a="0">${escapeXml(displayName)}\r\njavascript:fp_openPopup('${escapeXml(viewerUrl)}','Picto','width=400,height=450')\r\n</e>`;
}

const bouilleCache = {};

function bouilleOf(user, username) {
  if (user && user.fbouille) return normalizeBouilleState(user.fbouille);
  if (username && bouilleCache[username]) return normalizeBouilleState(bouilleCache[username]);
  return DEFAULT_BOUILLE_STATE;
}

// ─────────────────────────────────────────────
// In-memory state
// ─────────────────────────────────────────────
const sessions = {};       // sid -> { user, createdAt }
const users = {};          // username -> { pass, xp, kikooz, fbouille, items, prefs }
const recentSidByIp = new Map(); // ip -> sid fallback for legacy calls missing sid
const LOGIN_BIS_PAGE_PATH = path.join(__dirname, 'public', 'login-bis.html');

// ─────────────────────────────────────────────
// FrutiScore persistence (data/scores.json)
// Shape: { users: { [username]: { [rankingId]: { score, data, updatedAt } } } }
// One ranking per game; ranking id = <gameName>_classic for mode 0.
// ─────────────────────────────────────────────
const SCORES_DIR = path.join(__dirname, 'data');
const SCORES_FILE = path.join(SCORES_DIR, 'scores.json');
const CHALLENGE_MEDALS_FILE = path.join(SCORES_DIR, 'challenge-medals.json');
let scoresData = { users: {} };
let challengeMedalsData = { lastRollDay: '', medalsByVisibleDay: {}, pendingNotifications: {} };
function loadScores() {
  try {
    if (fs.existsSync(SCORES_FILE)) {
      const raw = fs.readFileSync(SCORES_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.users) {
        scoresData = parsed;
      }
    }
  } catch (e) {
    console.error(`[SCORES] load failed: ${e.message}`);
    scoresData = { users: {} };
  }
  migrateOldBkiwiScores();
}

function migrateOldBkiwiScores() {
  let migrated = 0;
  for (const [u, rlist] of Object.entries(scoresData.users || {})) {
    for (const oldKey of ['bkiwi_classic', 'bkiwi_challenge']) {
      if (!rlist[oldKey]) continue;
      const entry = rlist[oldKey];
      const track = extractBkiwiTrack(entry.data);
      const suffix = oldKey.endsWith('_challenge') ? 'challenge' : 'classic';
      const newKey = `bkiwi_track${track}_${suffix}`;
      if (!rlist[newKey]) {
        rlist[newKey] = entry;
        migrated++;
      }
      delete rlist[oldKey];
    }
  }
  if (migrated > 0) {
    console.log(`[SCORES] Migrated ${migrated} old bkiwi scores to per-track rankings`);
    saveScoresFile();
  }
}

function saveScoresFile() {
  try {
    if (!fs.existsSync(SCORES_DIR)) fs.mkdirSync(SCORES_DIR, { recursive: true });
    fs.writeFileSync(SCORES_FILE, JSON.stringify(scoresData, null, 2), 'utf8');
  } catch (e) {
    console.error(`[SCORES] save failed: ${e.message}`);
  }
}

function utcDayKey(d = new Date()) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function parisDayKey(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function yesterdayParisDayKey() {
  return parisDayKey(new Date(Date.now() - 86400000));
}
function yesterdayDayKey() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return utcDayKey(d);
}

function loadChallengeMedals() {
  try {
    if (fs.existsSync(CHALLENGE_MEDALS_FILE)) {
      const raw = fs.readFileSync(CHALLENGE_MEDALS_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        challengeMedalsData = {
          lastRollDay: String(parsed.lastRollDay || ''),
          medalsByVisibleDay: parsed.medalsByVisibleDay || {},
          pendingNotifications: parsed.pendingNotifications || {},
        };
      }
    }
  } catch (e) {
    console.error('[CHALLENGE] medal load failed:', e.message);
  }
}

function saveChallengeMedals() {
  try {
    if (!fs.existsSync(SCORES_DIR)) fs.mkdirSync(SCORES_DIR, { recursive: true });
    fs.writeFileSync(CHALLENGE_MEDALS_FILE, JSON.stringify(challengeMedalsData, null, 2), 'utf8');
  } catch (e) {
    console.error('[CHALLENGE] medal save failed:', e.message);
  }
}

// Registered ranking IDs (one per game, mode 0 = classic).
// name = human-readable, game = disc/game name (for client display).
const BKIWI_TRACK_NAMES = [
  'Green Hill', 'Banana Derby', 'Terre Grise', 'Solstice', 'Jupiter IV', 'Mistral Kiwi',
];
const RANKINGS = {
  bkiwi_track0_classic: { name: 'Burning Kiwi - Green Hill', game: 'bkiwi', type: 'C', lowerIsBetter: true, bkiwiTrack: 0 },
  bkiwi_track1_classic: { name: 'Burning Kiwi - Banana Derby', game: 'bkiwi', type: 'C', lowerIsBetter: true, bkiwiTrack: 1 },
  bkiwi_track2_classic: { name: 'Burning Kiwi - Terre Grise', game: 'bkiwi', type: 'C', lowerIsBetter: true, bkiwiTrack: 2 },
  bkiwi_track3_classic: { name: 'Burning Kiwi - Solstice', game: 'bkiwi', type: 'C', lowerIsBetter: true, bkiwiTrack: 3 },
  bkiwi_track4_classic: { name: 'Burning Kiwi - Jupiter IV', game: 'bkiwi', type: 'C', lowerIsBetter: true, bkiwiTrack: 4 },
  bkiwi_track5_classic: { name: 'Burning Kiwi - Mistral Kiwi', game: 'bkiwi', type: 'C', lowerIsBetter: true, bkiwiTrack: 5 },
  snake3_classic:   { name: 'Frutisnake - Classique',  game: 'snake3',   type: 'C' },
  kaluga_classic:   { name: 'Kaluga - Classique',      game: 'kaluga',   type: 'C' },
  swapou2_classic:  { name: 'Swapou - Classique',      game: 'swapou2',  type: 'C' },
  mb2_classic:      { name: 'MotionBall - Classique',  game: 'mb2',      type: 'C', lowerIsBetter: true },
  jamajama_classic: { name: 'JamaJama - Classique',    game: 'jamajama', type: 'C', lowerIsBetter: true },
  bkiwi_track0_challenge: { name: 'Burning Kiwi - Green Hill', game: 'bkiwi', type: 'L', lowerIsBetter: true, bkiwiTrack: 0 },
  bkiwi_track1_challenge: { name: 'Burning Kiwi - Banana Derby', game: 'bkiwi', type: 'L', lowerIsBetter: true, bkiwiTrack: 1 },
  bkiwi_track2_challenge: { name: 'Burning Kiwi - Terre Grise', game: 'bkiwi', type: 'L', lowerIsBetter: true, bkiwiTrack: 2 },
  bkiwi_track3_challenge: { name: 'Burning Kiwi - Solstice', game: 'bkiwi', type: 'L', lowerIsBetter: true, bkiwiTrack: 3 },
  bkiwi_track4_challenge: { name: 'Burning Kiwi - Jupiter IV', game: 'bkiwi', type: 'L', lowerIsBetter: true, bkiwiTrack: 4 },
  bkiwi_track5_challenge: { name: 'Burning Kiwi - Mistral Kiwi', game: 'bkiwi', type: 'L', lowerIsBetter: true, bkiwiTrack: 5 },
  snake3_challenge:   { name: 'Frutisnake - Challenge',   game: 'snake3',   type: 'L' },
  kaluga_challenge:   { name: 'Kaluga - Challenge',       game: 'kaluga',   type: 'L' },
  swapou2_challenge:  { name: 'Swapou - Challenge',       game: 'swapou2',  type: 'L' },
  mb2_challenge:      { name: 'MotionBall - Challenge',   game: 'mb2',      type: 'L', lowerIsBetter: true },
  bandas_challenge:   { name: 'Frutibandas - Challenge',  game: 'bandas',   type: 'L' },
  grapiz_challenge:   { name: 'Grapiz - Challenge',       game: 'grapiz',   type: 'L' },
};

// Legacy FrutiScore wire descriptors (numeric rk ids used by original clients).
const LEGACY_RANKINGS = [
  // Section C = "Challenge" in front-end
  // BKiwi uses per-track rankings; legacy rk '0' maps to track 5 (the default challenge track)
  { rk: '0', internal: 'bkiwi_track5_classic', ty: 'millisecond', rn: 'Burning kiwi', gs: '0', g: 'bkiwi',  section: 'C' },
  { rk: '1', internal: 'snake3_classic',   ty: 'point',       rn: 'Frutisnake 2', gs: '1', g: 'snake3', section: 'C' },
  { rk: '2', internal: 'mb2_classic',      ty: 'ptmb2',       rn: 'Motion Ball 2',gs: '2', g: 'mb2',    section: 'C' },
  { rk: '3', internal: 'swapou2_classic',  ty: 'point',       rn: 'Swapou 2',     gs: '3', g: 'swapou2',section: 'C' },
  { rk: '4', internal: 'kaluga_classic',   ty: 'point',       rn: 'Kaluga',       gs: '4', g: 'kaluga', section: 'C' },
  { rk: '5', internal: null,               ty: 'point',       rn: 'Frutibandas',  gs: '5', g: 'bandas', section: 'C' },
  { rk: '6', internal: null,               ty: 'point',       rn: 'Grapiz',       gs: '6', g: 'grapiz', section: 'C' },
  // Section L = "Championnat" in front-end — only Frutibandas and Grapiz
  { rk: '7', internal: 'bandas_challenge',  ty: 'point',       rn: 'Frutibandas',  gs: '5', g: 'bandas', section: 'L' },
  { rk: '8', internal: 'grapiz_challenge',  ty: 'point',       rn: 'Grapiz',       gs: '6', g: 'grapiz', section: 'L' },
];
const LEGACY_RK_TO_INTERNAL = Object.fromEntries(
  LEGACY_RANKINGS.filter((r) => r.internal).map((r) => [r.rk, r.internal])
);
const INTERNAL_TO_LEGACY_RK = Object.fromEntries([
  ...LEGACY_RANKINGS.filter((r) => r.internal).map((r) => [r.internal, r.rk]),
  ...Array.from({ length: 6 }, (_, i) => [`bkiwi_track${i}_challenge`, '0']),
]);
const HARDCODED_FRUTIZ = {
  Gaspard: { x: 9999999, f: '0n0000000000000000000000' },
};

function hardcodedMeAttrs(name) {
  const d = HARDCODED_FRUTIZ[String(name || '')] || HARDCODED_FRUTIZ.Gaspard;
  return `x="${d.x}" f="${escapeXml(d.f)}"`;
}

function resolveInternalRankingId(rkLike, refDate) {
  const raw = String(rkLike || '').trim();
  if (!raw) return null;
  if (RANKINGS[raw]) return raw;
  if (raw === '0') {
    const d = refDate ? new Date(refDate + 'T12:00:00Z') : new Date();
    return `bkiwi_track${getBkiwiDailyTrack(d)}_challenge`;
  }
  if (LEGACY_RK_TO_INTERNAL[raw]) return LEGACY_RK_TO_INTERNAL[raw];
  return null;
}

function resolveInternalRankingIdForRequest(rkLike, cAttr = '') {
  const base = resolveInternalRankingId(rkLike);
  if (!base) return null;
  const c = String(cAttr || '').trim();
  if (c === '2' || /^l$/i.test(c) || /^challenge$/i.test(c)) {
    const challengeId = base.replace(/_classic$/, '_challenge');
    if (RANKINGS[challengeId]) return challengeId;
  }
  return base;
}

function legacyDescriptorFromRkLike(rkLike) {
  const raw = String(rkLike || '').trim();
  if (!raw) return null;
  return LEGACY_RANKINGS.find((r) => r.rk === raw || r.internal === raw) || null;
}

function buildLegacyRankingResultPayload(rkInput, reqId = '', cAttr = '') {
  const rk = String(rkInput || '');
  const r = reqId ? ` r="${escapeXml(reqId)}"` : '';
  const c = cAttr ? ` c="${escapeXml(cAttr)}"` : '';
  const legacyDesc = legacyDescriptorFromRkLike(rk);
  const ty = legacyDesc && legacyDesc.ty ? ` ty="${escapeXml(legacyDesc.ty)}"` : '';
  return `<m${r}${ty} rk="${escapeXml(rk)}"${c}></m>`;
}

function buildLegacyUserResultPayload(user, reqId = '') {
  const r = reqId ? ` r="${escapeXml(reqId)}"` : '';
  const u = escapeXml(getDisplayName(String(user || 'Gaspard')));
  return `<n${r} u="${u}"></n>`;
}

function buildLegacyGameScoreInfo(gs) {
  const game = Number(gs);
  let inner = '';
  if (game === 0) {
    inner += '<desc n="Ecurie" t="s" w="60">bkiwi_team</desc>';
    inner += '<desc n="Rang" t="s" w="60">bkiwi_rank</desc>';
  } else if (game === 3) {
    inner += '<desc n="Perso" t="s" w="45">swapou_score_chars</desc>';
  } else if (game === 4) {
    inner += '<desc n="Tzongre" t="s" w="60">kaluga_tz</desc>';
  }
  return `<w gs="${Number.isFinite(game) ? game : 0}"><ds>${inner}</ds></w>`;
}

const KALUGA_TZONGRE_BY_ID = {
  0: 'kaluga',
  1: 'piwali',
  2: 'nalika',
  3: 'gomola',
  4: 'makulo',
};

function parseMtSerializedArray(raw) {
  const s = String(raw || '').trim();
  if (!s.startsWith('[') || !s.endsWith(']')) return null;
  const items = [];
  const body = s.slice(1, -1);
  const tokenRe = /([SNB])([^;]*);/g;
  let m;
  while ((m = tokenRe.exec(body)) !== null) {
    const ty = m[1];
    const payload = m[2] || '';
    if (ty === 'N') {
      const n = Number(payload);
      items.push(Number.isFinite(n) ? n : 0);
    } else if (ty === 'B') {
      items.push(payload === '1' || /^true$/i.test(payload));
    } else {
      items.push(payload);
    }
  }
  return items.length > 0 ? items : null;
}

function parseMtSerializedPrimitive(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const strMatch = s.match(/^S([^;]*)$/);
  if (strMatch) return strMatch[1];
  const numMatch = s.match(/^N(-?\d+(?:\.\d+)?)$/);
  if (numMatch) return Number(numMatch[1]);
  return null;
}

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

function extractBkiwiTrack(rawData) {
  const raw = String(rawData || '').trim();
  if (raw.includes(':')) {
    const parts = raw.split(':');
    if (parts.length >= 2) {
      const t = Number(parts[1]);
      if (Number.isFinite(t) && t >= 0 && t <= 5) return t;
    }
  }
  if (raw.includes(',')) {
    const parts = raw.split(',').map(p => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const t = Number(parts[1]);
      if (Number.isFinite(t) && t >= 0 && t <= 5) return t;
    }
  }
  const arr = parseMtSerializedArray(raw);
  if (arr && arr.length >= 2) {
    const t = Number(arr[1]);
    if (Number.isFinite(t) && t >= 0 && t <= 5) return t;
  }
  return 5;
}

function bkiwiRankingId(rawData, mode, hintedTrack) {
  // BKiwi's saveScore misc payload is [carName, perfectsRank, posRank] — track
  // is NOT in the data. Prefer the track captured from the most recent slot 0
  // savePublic(), then fall back to today's daily track (since standalone
  // players are almost always on the daily challenge), and only resort to
  // extractBkiwiTrack for legacy data with track embedded.
  let t;
  if (Number.isFinite(hintedTrack) && hintedTrack >= 0 && hintedTrack <= 5) {
    t = hintedTrack;
  } else if (rawData && /:/.test(String(rawData))) {
    t = extractBkiwiTrack(rawData);
  } else {
    t = getBkiwiDailyTrack();
  }
  const suffix = mode === 1 ? 'challenge' : 'classic';
  return `bkiwi_track${t}_${suffix}`;
}

// Compare two BKiwi slot 0 JSON payloads and return the track index (0-5)
// whose stats just changed — used to know which circuit the player just
// raced when their score arrives without an embedded track id. Tries
// multiple field layouts since the obfuscated SWF mixes nested $ts arrays
// with flat per-track fields (lapCar_0..5, totalCar_0..5).
function detectBkiwiTrackFromSlotDiff(prevDataStr, newDataStr) {
  try {
    const prev = prevDataStr ? JSON.parse(prevDataStr) : {};
    const next = newDataStr ? JSON.parse(newDataStr) : {};

    // Strategy 1: nested $ts array
    const prevTs = Array.isArray(prev.$ts) ? prev.$ts : [];
    const nextTs = Array.isArray(next.$ts) ? next.$ts : [];
    if (nextTs.length) {
      for (let i = 0; i < Math.min(nextTs.length, 6); i++) {
        if (JSON.stringify(prevTs[i] || null) !== JSON.stringify(nextTs[i] || null)) {
          return i;
        }
      }
    }

    // Strategy 2: any field whose name ends with _0 through _5
    const allKeys = new Set([...Object.keys(prev), ...Object.keys(next)]);
    for (const key of allKeys) {
      const m = key.match(/_([0-5])$/);
      if (!m) continue;
      const a = JSON.stringify(prev[key] === undefined ? null : prev[key]);
      const b = JSON.stringify(next[key] === undefined ? null : next[key]);
      if (a !== b) return parseInt(m[1], 10);
    }
  } catch (e) { /* malformed JSON */ }
  return null;
}

function getBkiwiDailyTrack(date = new Date()) {
  const paris = new Date(date.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  const startOfYear = new Date(paris.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((paris - startOfYear) / 86400000);
  return dayOfYear % 6;
}

// Format a centisecond duration as "MM:SS.CC" (e.g. 12345 → "2:03.45").
function formatMb2Time(centisec) {
  const cs = Math.max(0, Math.trunc(Number(centisec) || 0));
  const m = Math.floor(cs / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${m}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}

function formatRankingExtraData(rankingId, rawData, scoreHint) {
  const raw = String(rawData || '').trim();
  if (!raw) {
    if (rankingId.startsWith('bkiwi_track')) return 'Skiwix:5:1:';
    if (rankingId === 'swapou2_classic') return 'S0:';
    if (rankingId === 'kaluga_classic') return 'Skaluga:';
    // MB2 falls through to the body so the score-derived pct (computed at
    // the bottom from scoreHint) is emitted even when no `data` was stored.
    if (rankingId !== 'mb2_challenge' && rankingId !== 'mb2_classic') return '';
  }

  if (rankingId.startsWith('bkiwi_track')) {
    if (raw.includes(':')) return raw;
    if (raw.includes(',')) {
      const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 3) return `${parts[0]}:${parts[1]}:${parts[2]}:`;
    }
    const arr = parseMtSerializedArray(raw);
    if (arr && arr.length >= 3) {
      return `${String(arr[0] || '')}:${String(arr[1] || '')}:${String(arr[2] || '')}:`;
    }
    return raw;
  }

  if (rankingId === 'swapou2_classic') {
    if (/^S\d+:?$/i.test(raw)) return raw.endsWith(':') ? raw : `${raw}:`;
    const v = parseMtSerializedPrimitive(raw);
    if (typeof v === 'number' && Number.isFinite(v)) return `S${Math.trunc(v)}:`;
    if (typeof v === 'string' && /^\d+$/.test(v)) return `S${v}:`;
    if (/^\d+$/.test(raw)) return `S${raw}:`;
    return raw;
  }

  if (rankingId === 'kaluga_classic') {
    if (/^S[a-z0-9_]+:$/i.test(raw)) return raw;
    if (raw === '[object Object]') return 'Skaluga:';
    if (raw.startsWith('{') && raw.endsWith('}')) {
      try {
        const obj = JSON.parse(raw);
        if (obj && obj.tz !== undefined) {
          const tzNum = Number(obj.tz);
          if (Number.isFinite(tzNum) && KALUGA_TZONGRE_BY_ID[tzNum] !== undefined) {
            return `S${KALUGA_TZONGRE_BY_ID[tzNum]}:`;
          }
        }
      } catch { /* ignore malformed json */ }
    }
    const tzId = parseKalugaTzId(raw);
    if (tzId !== null && KALUGA_TZONGRE_BY_ID[tzId] !== undefined) {
      return `S${KALUGA_TZONGRE_BY_ID[tzId]}:`;
    }
    const v = parseMtSerializedPrimitive(raw);
    if (typeof v === 'string' && v) return `S${v.toLowerCase()}:`;
    return raw;
  }

  // MotionBall 2: the score itself is the AS2 client's combined value
  // (Games/motionBall2/mb2/Game.as `calcScore`):
  //
  //     score = (vrooms*100/trooms - 1) + [int(curtime/100)*100 if boss]
  //
  // → completion % = (score % 100) + 1  for any score, boss or not.
  // The `data` field is empty in normal play; we keep parsing it for
  // legacy rows where an explicit "N%" was persisted, and fall back on
  // the score-derived pct when nothing is stored. The score table shows
  // "time°percentage", so we always emit a "°NN%" suffix.
  if (rankingId === 'mb2_challenge' || rankingId === 'mb2_classic') {
    let pct = NaN;
    if (raw) {
      const mPct = raw.match(/^-?(\d+(?:\.\d+)?)\s*%?$/);
      if (mPct) {
        const n = Number(mPct[1]);
        if (Number.isFinite(n)) pct = n > 1 ? n : n * 100;
      } else {
        const v = parseMtSerializedPrimitive(raw);
        if (typeof v === 'number' && Number.isFinite(v)) {
          pct = v > 1 ? v : v * 100;
        }
      }
    }
    if (!Number.isFinite(pct) && Number.isFinite(scoreHint)) {
      const sNum = Math.max(0, Math.trunc(Number(scoreHint)));
      pct = (sNum % 100) + 1;
    }
    if (Number.isFinite(pct)) {
      return `°${Math.round(pct)}%`;
    }
    return raw;
  }

  return raw;
}

function getScoreDataFromAttrs(attrs = {}) {
  const candidates = [
    attrs.da,
    attrs.d2,
    attrs.r,
    attrs.data,
    attrs.misc,
    attrs.md,
  ];
  for (const c of candidates) {
    if (c !== undefined && c !== null && String(c) !== '') return String(c);
  }
  return '';
}

function getScoreDataFromMessage(msg) {
  const fromAttrs = getScoreDataFromAttrs((msg && msg.attrs) || {});
  if (fromAttrs) return fromAttrs;

  const children = Array.isArray(msg && msg.children) ? msg.children : [];
  for (const child of children) {
    if (!child) continue;
    const childAttrsValue = getScoreDataFromAttrs(child.attrs || {});
    if (childAttrsValue) return childAttrsValue;
    const tag = String(child.tag || '').toLowerCase();
    if (['r', 'da', 'data', 'misc', 'md'].includes(tag)) {
      const content = String(child.content || '').trim();
      if (content) return content;
    }
  }

  const rootContent = String((msg && msg.content) || '').trim();
  return rootContent || '';
}

function serializeScoreData(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// Map a game/disc identifier to a ranking id.
function rankingIdForGame(gameName, modeRaw = 0) {
  const raw = String(gameName || '').trim();
  const key = raw.toLowerCase();
  const mode = Number(modeRaw);
  const suffix = mode === 1 ? 'challenge' : 'classic';
  if (!key) return null;
  if (key === 'bkiwi') return `bkiwi_track5_${suffix}`;
  const direct = `${key}_${suffix}`;
  if (RANKINGS[direct]) return direct;
  // Accept Frutiparc disc uids directly (kaluga1, snake3, swapou1, miniwave1).
  const directDisc = GAME_DISCS && GAME_DISCS[key];
  if (directDisc && directDisc.swfName) {
    const swfLower = String(directDisc.swfName).toLowerCase();
    if (swfLower === 'bkiwi') return `bkiwi_track5_${suffix}`;
    const via = `${swfLower}_${suffix}`;
    if (RANKINGS[via]) return via;
  }

  // Accept game path forms returned by /do/ld and used by Frusion:
  //   games/snake3/snake3.swf
  //   /games/snake3/snake3.swf
  //   /swf/games/snake3/snake3.swf
  const normalizedCandidates = new Set([
    key,
    key.replace(/^\/+/, ''),
    key.replace(/^\/?swf\//, ''),
  ]);

  for (const [discUid, disc] of Object.entries(GAME_DISCS || {})) {
    const swfName = String((disc && disc.swfName) || '').toLowerCase();
    if (swfName) {
      if (swfName === 'bkiwi' && (normalizedCandidates.has(swfName) || normalizedCandidates.has(String(discUid).toLowerCase()))) {
        return `bkiwi_track5_${suffix}`;
      }
      const via = `${swfName}_${suffix}`;
      if (RANKINGS[via] && (normalizedCandidates.has(swfName) || normalizedCandidates.has(String(discUid).toLowerCase()))) {
        return via;
      }
    }

    const gameId = String((disc && disc.gameId) || '').toLowerCase();
    const filePaths = [];
    if (gameId) filePaths.push(gameId);
    if (Array.isArray(disc && disc.files)) {
      for (const f of disc.files) {
        if (f && f.u) filePaths.push(String(f.u).toLowerCase());
      }
    }

    const hasRanking = swfName && (swfName === 'bkiwi' || RANKINGS[`${swfName}_${suffix}`]);
    if (hasRanking) {
      for (const p of filePaths) {
        const pathVariants = [
          p,
          `/${p}`,
          `swf/${p}`,
          `/swf/${p}`,
        ];
        if (pathVariants.some((v) => normalizedCandidates.has(v))) {
          return swfName === 'bkiwi' ? `bkiwi_track5_${suffix}` : `${swfName}_${suffix}`;
        }
        const segs = p.split('/').filter(Boolean);
        if (segs.some((seg) => normalizedCandidates.has(seg.toLowerCase()))) {
          return swfName === 'bkiwi' ? `bkiwi_track5_${suffix}` : `${swfName}_${suffix}`;
        }
      }
    }
  }

  // Fallback: infer ranking id from SWF filename in a path-like input.
  // Example: games/snake3/snake3.swf -> snake3_classic
  const lastSeg = normalizedCandidates.values().next().value.split('/').pop() || '';
  const base = lastSeg.replace(/\.swf$/i, '');
  const fromBase = `${base}_${suffix}`;
  if (RANKINGS[fromBase]) return fromBase;

  return null;
}

function isLowerBetter(rankingId) {
  return !!(RANKINGS[rankingId] && RANKINGS[rankingId].lowerIsBetter);
}

// MotionBall 2 challenge ranking hierarchy (confirmed by spender94):
//   1. Players who beat the final boss come above everyone else, regardless
//      of map %.
//   2. Among boss-beaters, the player with more time on the counter wins —
//      i.e. lower elapsed time (s = centiseconds) is better.
//   3. Among players who did NOT beat the boss, a higher map % (stored in
//      `data`) wins.
//
// The MB2 client (Games/motionBall2/mb2/Game.as `calcScore`) packs both
// the exploration % and the boss-time into a single number:
//
//     score = int(vrooms*100/trooms) - 1                 ← when boss NOT beaten
//                                                          (range -1..99,
//                                                           i.e. pct-1)
//
//     score = int(vrooms*100/trooms) - 1                 ← when boss beaten
//             + int(curtime/100) * 100                     (≥ 99 + 100 = 199
//                                                          for any sub-100ms
//                                                          boss kill, which
//                                                          is physically
//                                                          impossible)
//
// So the boss-beaten test is `score >= 100`, NOT `score > 0` (which is the
// historical bug that surfaced as "MotionBall classement à l'envers": with
// the wrong threshold every exploration score 1..99 was treated as a
// boss-killer time-in-cs and was sorted *before* real boss-killers whose
// scores are 199+).
function mb2HasBoss(s) {
  return Number.isFinite(Number(s)) && Number(s) >= 100;
}
function mb2PctFromData(d) {
  if (d == null) return 0;
  const s = String(d).trim().replace(/^°/, '').replace(/%$/, '');
  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  return n > 1 ? n : n * 100;
}
// Pick up the percentage payload regardless of the field name used by the
// caller (`data`, `d`, or `pct`). Different code paths historically used
// different keys.
function mb2DataOf(entry) {
  if (!entry) return '';
  if (entry.data != null) return entry.data;
  if (entry.d != null) return entry.d;
  if (entry.pct != null) return entry.pct;
  return '';
}
function mb2Comparator(a, b) {
  const aBoss = mb2HasBoss(a.s);
  const bBoss = mb2HasBoss(b.s);
  if (aBoss !== bBoss) return aBoss ? -1 : 1;
  if (aBoss) {
    // both beat the boss → lower combined score wins. The MB2 formula bakes
    // exploration % into the low-order digits of the time component so a
    // straight numerical compare on s already does the right thing.
    return Number(a.s) - Number(b.s);
  }
  // neither beat the boss → higher score wins (more rooms visited). For
  // legacy rows that stored an explicit `data` percentage, fall back to it
  // when both scores happen to tie at zero.
  const ds = Number(b.s) - Number(a.s);
  if (ds !== 0) return ds;
  return mb2PctFromData(mb2DataOf(b)) - mb2PctFromData(mb2DataOf(a));
}
function isMb2Ranking(rankingId) {
  return rankingId === 'mb2_challenge' || rankingId === 'mb2_classic';
}

function scoreComparator(rankingId) {
  if (isMb2Ranking(rankingId)) return mb2Comparator;
  return isLowerBetter(rankingId) ? (a, b) => a.s - b.s : (a, b) => b.s - a.s;
}

// "Is the new (score, data) tuple better than the existing one for this
// ranking?" Defers to mb2Comparator for MB2 so the boss-beaten/% hierarchy
// is honored when deciding whether to persist a new attempt.
function isScoreBetter(rankingId, newScore, newData, oldScore, oldData) {
  if (isMb2Ranking(rankingId)) {
    const cmp = mb2Comparator(
      { s: newScore, data: newData },
      { s: oldScore, data: oldData },
    );
    return cmp < 0;
  }
  return isLowerBetter(rankingId)
    ? (oldScore === 0 || newScore < oldScore)
    : (newScore > oldScore);
}

// Save a score for user+ranking. Returns { updated, newScore, oldScore, oldPos, newPos }.
function persistScore(username, rankingId, score, data) {
  if (!username || !rankingId || !RANKINGS[rankingId]) {
    return { updated: false, newScore: score, oldScore: 0, oldPos: 0, newPos: 0 };
  }
  if (!scoresData.users[username]) scoresData.users[username] = {};
  const prev = scoresData.users[username][rankingId];
  const oldScore = (prev && Number.isFinite(Number(prev.score))) ? Number(prev.score) : 0;
  const oldData = (prev && prev.data !== undefined && prev.data !== null) ? String(prev.data) : '';
  const n = Number(score) || 0;
  const newData = (data === undefined || data === null) ? '' : String(data);
  const oldPos = computePosition(rankingId, username);
  let updated = false;
  const scoreImproved = isScoreBetter(rankingId, n, newData, oldScore, oldData);
  const shouldBackfillData = !oldData && !!newData && n === oldScore;
  if (scoreImproved || shouldBackfillData) {
    scoresData.users[username][rankingId] = {
      score: scoreImproved ? n : oldScore,
      data: (scoreImproved || !oldData) ? newData : oldData,
      updatedAt: new Date().toISOString(),
    };
    updated = true;
    saveScoresFile();
    const dbId = users[username] && users[username]._dbId;
    if (dbId) {
      db.upsertScore(dbId, rankingId, scoresData.users[username][rankingId].score, scoresData.users[username][rankingId].data).catch((e) => {
        console.error('[DB] score save error:', e.message);
      });
    }
  }
  const newPos = computePosition(rankingId, username);
  return { updated, newScore: updated ? n : oldScore, oldScore, oldPos, newPos };
}

// Position for a user in a ranking (1-based). 0 if not ranked.
function computePosition(rankingId, username) {
  const all = [];
  for (const [u, rlist] of Object.entries(scoresData.users || {})) {
    if (rlist && rlist[rankingId] && Number.isFinite(Number(rlist[rankingId].score))) {
      all.push({ u, s: Number(rlist[rankingId].score), data: rlist[rankingId].data });
    }
  }
  all.sort(scoreComparator(rankingId));
  const idx = all.findIndex((e) => e.u === username);
  return idx < 0 ? 0 : idx + 1;
}

function getUserScore(username, rankingId) {
  const key = String(username || '').toLowerCase();
  const ud = scoresData.users[key];
  if (!ud || !ud[rankingId]) return { score: 0, pos: 0 };
  return { score: Number(ud[rankingId].score) || 0, pos: computePosition(rankingId, key) };
}

async function getConsecrationLeaderboard() {
  const seen = new Set();
  const results = [];
  for (const username of Object.keys(users)) {
    seen.add(username);
    const c = computeConsecration(username);
    if (c.overall > 0) results.push({ u: username, s: c.overall });
  }
  if (process.env.DATABASE_URL) {
    try {
      const rows = await db.listAllUsers();
      for (const row of rows) {
        const uname = row.username;
        if (seen.has(uname)) continue;
        await hydrateUserFromDb(uname, row);
        const c = computeConsecration(uname);
        if (c.overall > 0) results.push({ u: uname, s: c.overall });
      }
    } catch (e) { console.error('[CONSECRATION] leaderboard DB error:', e.message); }
  }
  results.sort((a, b) => b.s - a.s || a.u.localeCompare(b.u));
  return results;
}

loadScores();
loadChallengeMedals();

function createDefaultUser(pass) {
  return {
    pass,
    xp: 1,
    kikooz: 60,
    fbouille: DEFAULT_BOUILLE_STATE,
    items: [],
    gameItems: [],
    contacts: [],
    blacklist: [],
    gender: 'M',
    birthday: '1990-05-15',
    country: 'FR',
    region: 'IDF',
    prefs: '',
    isModerator: false,
    isAnimator: false,
    needsBouille: true, // Force editbouille on first login
    kikoozLog: [],      // Entries displayed in box.KikoozLog (/ft/log)
    userLog: [],        // Entries displayed in "Mon historique" (/do/onident <ul>)
    siteLog: [],        // Entries displayed in "Evènements" (/do/onident <sl>)
    mails: [],          // Internal mailbox; each entry: {uid, from, fromAddr, to, toAddrs, subject, body, folder, date, read}
    realJob: 'Frutiz',
    frutijob: '',
    displayName: '',
    frutiSign: -1,
    frutiSignB: -1,
    hasWelcomeUserLog: false,
    hasWelcomeSiteLog: false,
  };
}

function dbUserToMemory(row) {
  const bday = row.birthday;
  let birthdayStr = '1990-05-15';
  if (bday instanceof Date) {
    birthdayStr = bday.toISOString().substring(0, 10);
  } else if (typeof bday === 'string' && bday.length >= 10) {
    birthdayStr = bday.substring(0, 10);
  }
  return {
    pass: row.password,
    xp: row.xp ?? 1,
    kikooz: row.kikooz ?? 60,
    fbouille: row.fbouille || DEFAULT_BOUILLE_STATE,
    items: withDefaultPens([]),
    gameItems: [],
    contacts: [],
    blacklist: [],
    gender: row.gender || 'M',
    birthday: birthdayStr,
    country: row.country || 'FR',
    region: row.region || 'IDF',
    prefs: row.prefs || '',
    isModerator: row.is_moderator || false,
    isAnimator: row.is_animator || false,
    needsBouille: row.needs_bouille !== false,
    firstName: row.first_name || '',
    lastName: row.last_name || '',
    lastNamePublic: row.last_name_public || 'Y',
    realJob: row.real_job || '',
    frutijob: row.frutijob || '',
    city: row.city || '',
    countryIndex: row.country_index || '1',
    regionIndex: row.region_index || '1',
    departmentIndex: row.department_index || '1',
    siteUrl: row.site_url || '',
    comment: row.comment || '',
    displayName: row.display_name || row.username || '',
    frutiSign: row.fruti_sign ?? -1,
    frutiSignB: row.fruti_sign_b ?? -1,
    createdAt: row.created_at ? (row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at)) : '',
    customAccessories: [],
    kikoozLog: [],
    userLog: [],
    siteLog: [],
    mails: [],
    hasWelcomeUserLog: false,
    hasWelcomeSiteLog: false,
    _dbId: row.id,
  };
}

async function hydrateUserFromDb(username, dbUser) {
  users[username] = dbUserToMemory(dbUser);
  const [items, accs, dbScores, dbContacts, dbBlacklist, dbMails, dbGameItems, dbUserLog, dbSiteLog, dbContactFolders] = await Promise.all([
    db.getUserItems(dbUser.id),
    db.getUserAccessories(dbUser.id),
    db.loadScoresForUser(dbUser.id),
    db.getContacts(dbUser.id),
    db.getBlacklist(dbUser.id),
    db.getMailsForUser(dbUser.id).catch(() => []),
    db.getUserGameItems(dbUser.id).catch(() => []),
    db.getUserLogEntries(dbUser.id, 'user', 200).catch(() => []),
    db.getUserLogEntries(dbUser.id, 'site', 200).catch(() => []),
    db.getContactFolders(dbUser.id).catch(() => []),
  ]);

  if (items.length > 0) users[username].items = withDefaultPens(items);
  if (accs.length > 0) users[username].customAccessories = accs;
  if (dbGameItems.length > 0) users[username].gameItems = dbGameItems;

  // Restore JamaJama play count from highest owned milestone picto so
  // future score saves resume from the right threshold.
  let jamaCount = 0;
  for (const id of users[username].gameItems || []) {
    const m = JAMA_MILESTONES[id];
    if (m && m.threshold > jamaCount) jamaCount = m.threshold;
  }
  users[username].jamaPlayCount = jamaCount;
  // dbContacts is now [{addr, folder}, ...]; keep user.contacts as a flat
  // address list and track per-contact folder assignment separately.
  const contactRows = Array.isArray(dbContacts) ? dbContacts : [];
  users[username].contacts = contactRows.map((c) =>
    typeof c === 'string' ? c : c.addr
  ).filter(Boolean);
  users[username].contactFolderMap = {};
  for (const c of contactRows) {
    if (c && typeof c === 'object' && c.folder && c.folder !== 'mycontact') {
      users[username].contactFolderMap[c.addr] = c.folder;
    }
  }
  users[username].contactFolders = Array.isArray(dbContactFolders) ? dbContactFolders : [];
  users[username].blacklist = Array.isArray(dbBlacklist) ? dbBlacklist : [];
  users[username].mails = Array.isArray(dbMails) ? dbMails : [];

  // Restore persistent history (userLog + siteLog) from DB
  const toMemoryEntry = (row) => {
    const e = {
      d: row.created_at instanceof Date
        ? row.created_at.toISOString().replace('T', ' ').substring(0, 19)
        : String(row.created_at || nowSqlTimestamp()).substring(0, 19),
      t: Number(row.entry_type) || 1,
      c: String(row.content || ''),
    };
    if (row.is_new) e.n = 1;
    return e;
  };
  if (Array.isArray(dbUserLog) && dbUserLog.length > 0) {
    users[username].userLog = dbUserLog.map(toMemoryEntry);
    users[username].hasWelcomeUserLog = true;
  }
  if (Array.isArray(dbSiteLog) && dbSiteLog.length > 0) {
    users[username].siteLog = dbSiteLog.map(toMemoryEntry);
    users[username].hasWelcomeSiteLog = true;
  }

  // Pre-load all frutiSlots from DB so game progress survives server restarts.
  // A silent failure here was the #1 reason MiniPixiz progression vanished
  // overnight: the in-memory clobber-guard relies on prevSlotData, and if the
  // hydrate errored we'd happily accept fresh formatFruticard() defaults from
  // the SWF and overwrite real progress. Log loudly so issues surface; the
  // saveFrutiSlot path now also re-checks the DB before clobber as a backstop.
  try {
    const allSlots = await db.getAllFrutiSlots(dbUser.id);
    if (Object.keys(allSlots).length > 0) {
      users[username].frutiSlots = allSlots;
      for (const game of Object.keys(allSlots)) {
        const s0 = allSlots[game]['0'] || allSlots[game][0];
        if (s0) {
          try { extractGameItemsFromSlot(username, game, s0); } catch (e) {
            console.error(`[HYDRATE] extract pictos ${username}/${game} failed: ${e.message}`);
          }
        }
      }
    }
  } catch (e) {
    console.error(`[HYDRATE] getAllFrutiSlots(${dbUser.id}) failed for ${username}: ${e.message}`);
  }

  if (Object.keys(dbScores).length > 0) {
    if (!scoresData.users[username]) scoresData.users[username] = {};
    const rollDone = challengeMedalsData.lastRollDay === parisDayKey();
    for (const [rkId, entry] of Object.entries(dbScores)) {
      if (rollDone && isDailyResetRanking(rkId)) continue;
      if (!scoresData.users[username][rkId]) {
        scoresData.users[username][rkId] = entry;
      }
    }
  }
}

function nowSqlTimestamp() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

function addUserHistoryEntry(user, { type = 1, content = '', flNew = false } = {}) {
  if (!user) return;
  if (!Array.isArray(user.userLog)) user.userLog = [];
  const entry = {
    d: nowSqlTimestamp(),
    t: Number(type) || 1,
    c: String(content || ''),
  };
  if (flNew) entry.n = 1;
  user.userLog.unshift(entry);
  if (user.userLog.length > 200) user.userLog.length = 200;

  // Persist to DB so history survives server restarts.
  if (user._dbId) {
    db.addUserLogEntry(user._dbId, 'user', entry.t, entry.c, !!flNew)
      .then(() => db.pruneUserLog(user._dbId, 'user', 200))
      .catch((e) => console.error('[DB] addUserLogEntry user error:', e.message));
  }
}

function notifyNewUserLog(username, entry) {
  if (typeof CMD === 'undefined') return;
  for (const sock of getSocketsForUsername(username)) {
    sendToClient(sock,
      `<${CMD.newuserlog} date="${escapeXml(entry.d || nowSqlTimestamp())}" type="${escapeXml(String(entry.t || 1))}">${escapeXml(entry.c || '')}</${CMD.newuserlog}>`
    );
  }
}

function addAndNotifyUserLog(username, { type = 1, content = '', flNew = true } = {}) {
  const user = users[username];
  if (!user) return;
  addUserHistoryEntry(user, { type, content, flNew });
  notifyNewUserLog(username, user.userLog[0]);
}

function addSiteHistoryEntry(user, { type = 1, content = '', flNew = false } = {}) {
  if (!user) return;
  if (!Array.isArray(user.siteLog)) user.siteLog = [];
  const entry = {
    d: nowSqlTimestamp(),
    t: Number(type) || 1,
    c: String(content || ''),
  };
  if (flNew) entry.n = 1;
  user.siteLog.unshift(entry);
  if (user.siteLog.length > 200) user.siteLog.length = 200;

  if (user._dbId) {
    db.addUserLogEntry(user._dbId, 'site', entry.t, entry.c, !!flNew)
      .then(() => db.pruneUserLog(user._dbId, 'site', 200))
      .catch((e) => console.error('[DB] addUserLogEntry site error:', e.message));
  }
}

// ─────────────────────────────────────────────
// XP System — daily activity tracking & levelling
// ─────────────────────────��───────────────────
// Tracks daily actions per user. Persisted to disk so it survives restarts.
// Keys: login, chatMsg, forumTopic, forumPost, gamePlayed
const XP_ACTIONS_FILE = path.join(SCORES_DIR, 'xp-actions.json');
let dailyXpActions = {}; // username -> { login:N, chatMsg:N, forumTopic:N, forumPost:N, gamePlayed:N }

function loadXpActions() {
  try {
    if (fs.existsSync(XP_ACTIONS_FILE)) {
      const raw = fs.readFileSync(XP_ACTIONS_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') dailyXpActions = parsed;
    }
  } catch (e) {
    console.error('[XP] Failed to load xp-actions.json:', e.message);
  }
}
loadXpActions();

let _xpSaveTimer = null;
function saveXpActions() {
  if (_xpSaveTimer) return;
  _xpSaveTimer = setTimeout(() => {
    _xpSaveTimer = null;
    try {
      fs.writeFileSync(XP_ACTIONS_FILE, JSON.stringify(dailyXpActions), 'utf8');
    } catch (e) {
      console.error('[XP] Failed to save xp-actions.json:', e.message);
    }
  }, 2000);
}

function getXpActions(username) {
  if (!dailyXpActions[username]) {
    dailyXpActions[username] = { login: 0, chatMsg: 0, forumTopic: 0, forumPost: 0, gamePlayed: 0 };
  }
  return dailyXpActions[username];
}

function trackXpAction(username, action) {
  getXpActions(username)[action] = (getXpActions(username)[action] || 0) + 1;
  saveXpActions();
}

// XP reward formula per action type (with daily caps).
// Flash formula: level N needs (N-1)^2 * 10000 XP total.
// Lv2=10k, Lv3=40k, Lv4=90k, Lv5=160k.
// Max 10000 XP/day → Lv2 in 1-2j, Lv2→3 in 3-6j.
const XP_REWARDS = {
  login:      { base: 1000, cap: 1  },  // 1000 XP once per day
  chatMsg:    { base: 50,   cap: 50 },  // 50 XP per message, max 2500/day
  forumTopic: { base: 500,  cap: 3  },  // 500 XP per topic, max 1500/day
  forumPost:  { base: 250,  cap: 8  },  // 250 XP per reply, max 2000/day
  gamePlayed: { base: 300,  cap: 10 },  // 300 XP per challenge score, max 3000/day
};

function countChallengeScores(username) {
  const rlist = scoresData.users[username];
  if (!rlist) return 0;
  let count = 0;
  for (const rkId of Object.keys(rlist)) {
    if (isDailyResetRanking(rkId) && rlist[rkId] && Number.isFinite(Number(rlist[rkId].score))) {
      count++;
    }
  }
  return count;
}

function computeDailyXpGain(username) {
  const actions = dailyXpActions[username] || {};
  const challengeScores = countChallengeScores(username);
  let total = 0;
  for (const [action, cfg] of Object.entries(XP_REWARDS)) {
    const raw = action === 'gamePlayed' ? challengeScores : (actions[action] || 0);
    const count = Math.min(raw, cfg.cap);
    total += count * cfg.base;
  }
  return total;
}

// Match the Flash client formula (UserMng.as):
// level = floor(sqrt(xp / 10000) + 1)
// levelToXp(n) = (n - 1)^2 * 10000
function xpForLevel(level) {
  return Math.pow(Math.max(1, level) - 1, 2) * 10000;
}

function getLevelForXp(xp) {
  return Math.floor(Math.sqrt(Math.max(0, xp) / 10000) + 1);
}

// Award XP to all active users (called during midnight rollover,
// before challenge scores are cleared from memory)
async function awardDailyXp() {
  const candidates = new Set(Object.keys(dailyXpActions));
  for (const [u, rlist] of Object.entries(scoresData.users || {})) {
    if (!rlist) continue;
    for (const rkId of Object.keys(rlist)) {
      if (isDailyResetRanking(rkId) && rlist[rkId] && Number.isFinite(Number(rlist[rkId].score))) {
        candidates.add(u);
        break;
      }
    }
  }
  let awarded = 0;
  for (const username of candidates) {
    const gain = computeDailyXpGain(username);
    if (gain <= 0) continue;
    let user = users[username];
    if (!user && process.env.DATABASE_URL) {
      try {
        const row = await db.findUserByUsername(username);
        if (row) {
          user = dbUserToMemory(row);
          users[username] = user;
        }
      } catch (e) { /* ignore */ }
    }
    if (!user) continue;
    const oldXp = user.xp || 0;
    const oldLevel = getLevelForXp(oldXp);
    user.xp = oldXp + gain;
    const newLevel = getLevelForXp(user.xp);
    if (newLevel > oldLevel) {
      addAndNotifyUserLog(username, { type: USER_LOG_TYPE.LEVEL_UP, content: `Bravo ! Tu passes au niveau ${newLevel} ! (${user.xp} XP)` });
    }
    if (user._dbId) {
      db.updateUser(username, { xp: user.xp }).catch(e => {
        console.error(`[XP] DB update failed for ${username}:`, e.message);
      });
    }
    console.log(`[XP]  ${username}: +${gain} XP (total=${user.xp})`);
    awarded++;
  }
  console.log(`[XP] Daily XP awarded to ${awarded} user(s)`);
  for (const key of Object.keys(dailyXpActions)) delete dailyXpActions[key];
  saveXpActions();
}

function buildUserLogXml(entries) {
  const list = Array.isArray(entries) ? entries : [];
  // Ascending sort (oldest first). The AS2 client iterates the <l> children
  // of <ul>/<sl> via firstChild → nextSibling and prepends each entry to its
  // display list, which reverses the visible order. Returning oldest-first
  // therefore lands newest-first on screen, which is what users expect from
  // "Mon historique" and "Évènements".
  const sorted = list.slice().sort((a, b) => {
    const da = a && a.d ? a.d : '';
    const db = b && b.d ? b.d : '';
    return da < db ? -1 : da > db ? 1 : 0;
  });
  return sorted.map((e) => {
    const d = escapeXml(e && e.d ? e.d : '');
    const t = Number(e && e.t);
    const c = escapeXml(e && e.c ? e.c : '');
    const n = (e && Number(e.n) === 1) ? ' n="1"' : '';
    return `<l d="${d}" t="${Number.isFinite(t) && t > 0 ? t : 1}"${n}>${c}</l>`;
  }).join('');
}

// Daily-reset rankings = rankings displayed in the front-end "Challenge"
// tab (section C of LEGACY_RANKINGS) plus all BKiwi per-track challenge
// rankings (which rotate daily based on dayOfYear % 6).
// BKiwi classic was previously the daily proxy; replaced by proper _challenge
// rankings so we exclude it to avoid duplicate medal awards.
const DAILY_RESET_RANKING_SET = new Set([
  ...LEGACY_RANKINGS.filter(r => r.section === 'C' && r.internal && r.internal !== 'bkiwi_track5_classic').map(r => r.internal),
  ...Array.from({ length: 6 }, (_, i) => `bkiwi_track${i}_challenge`),
]);

function challengeRankingIds() {
  return Array.from(DAILY_RESET_RANKING_SET);
}

function isDailyResetRanking(rkId) {
  return DAILY_RESET_RANKING_SET.has(rkId);
}

function collectTop3ForRanking(rankingId) {
  const all = [];
  for (const [u, rlist] of Object.entries(scoresData.users || {})) {
    if (rlist && rlist[rankingId] && Number.isFinite(Number(rlist[rankingId].score))) {
      all.push({ u, s: Number(rlist[rankingId].score), data: rlist[rankingId].data });
    }
  }
  all.sort(scoreComparator(rankingId));
  return all.slice(0, 3);
}

const GAME_DISPLAY_NAMES = {
  bkiwi: 'Burning Kiwi', snake3: 'Frutisnake', kaluga: 'Kaluga',
  swapou2: 'Swapou', miniwave2: 'MiniWave', miniwave: 'MiniWave', mb2: 'MotionBall',
  bandas: 'Frutibandas', grapiz: 'Grapiz', minipixiz: 'MiniPixiz',
};
const MEDAL_DISPLAY_NAMES = { or: "d'or", argent: "d'argent", bronze: 'de bronze' };

function notifyChallengeWinners(winnersByUser, visibleDay) {
  for (const [username, medals] of Object.entries(winnersByUser || {})) {
    for (const m of medals) {
      const gameName = GAME_DISPLAY_NAMES[m.game] || m.game;
      const medalName = MEDAL_DISPLAY_NAMES[m.medal] || m.medal;
      const text = `Félicitations ! Vous avez gagné la médaille ${medalName} à ${gameName} ! (${visibleDay})`;
      const user = users[username];
      if (user) {
        addUserHistoryEntry(user, { type: USER_LOG_TYPE.MEDAL, content: text, flNew: true });
      } else {
        if (!challengeMedalsData.pendingNotifications[username]) {
          challengeMedalsData.pendingNotifications[username] = [];
        }
        challengeMedalsData.pendingNotifications[username].push({ type: USER_LOG_TYPE.MEDAL, content: text });
      }
      if (user && user._dbId) {
        db.saveMedal(user._dbId, username, m.rankingId, m.game, m.rank, m.medal, visibleDay).catch(dbErr('saveMedal'));
      } else if (process.env.DATABASE_URL) {
        db.findUserByUsername(username).then((row) => {
          if (row) db.saveMedal(row.id, username, m.rankingId, m.game, m.rank, m.medal, visibleDay).catch(dbErr('saveMedal'));
        }).catch(dbErr('saveMedal'));
      }
    }
  }
}

function buildPodiumXml(rankingId) {
  if (!rankingId || !isDailyResetRanking(rankingId)) return '';
  const yesterday = yesterdayParisDayKey();
  const dayMedals = challengeMedalsData.medalsByVisibleDay[yesterday] || {};
  const game = RANKINGS[rankingId] && RANKINGS[rankingId].game;
  if (!game) return '';
  const podium = [];
  for (const [username, medals] of Object.entries(dayMedals)) {
    for (const m of medals) {
      if (m.game === game) podium.push({ u: username, rank: m.rank, medal: m.medal });
    }
  }
  if (podium.length === 0) return '';
  podium.sort((a, b) => a.rank - b.rank);
  let xml = `<podium day="${escapeXml(yesterday)}">`;
  for (const p of podium) {
    const ud = users[p.u] || {};
    xml += `<m u="${escapeXml(getDisplayName(p.u))}" r="${p.rank}" f="${escapeXml(bouilleOf(ud, p.u))}" />`;
  }
  xml += '</podium>';
  return xml;
}

function resetChallengeScoresInMemory() {
  const challengeIds = new Set(challengeRankingIds());
  for (const [username, rlist] of Object.entries(scoresData.users || {})) {
    if (!rlist) continue;
    for (const rkId of Object.keys(rlist)) {
      if (challengeIds.has(rkId)) delete rlist[rkId];
    }
    if (Object.keys(rlist).length === 0) delete scoresData.users[username];
  }
  saveScoresFile();
}

async function rollDailyChallengeIfNeeded() {
  const today = parisDayKey();
  if (!challengeMedalsData.lastRollDay) {
    // No prior state in challenge-medals.json (lost on redeploy with ephemeral
    // disk, fresh install, etc.). Try to recover from the DB: the most recent
    // archived day implies the last roll happened the day after it, so
    // lastRollDay = (latest archive day + 1 day). If today already matches
    // that recovered value, we skip the roll — preserving today's scores in
    // the scores table that loadAllScores() just brought back.
    let recovered = '';
    if (process.env.DATABASE_URL) {
      try {
        const days = await db.getArchiveDays();
        if (Array.isArray(days) && days.length > 0) {
          const latest = days[0];
          const next = new Date(latest + 'T12:00:00Z');
          next.setUTCDate(next.getUTCDate() + 1);
          recovered = parisDayKey(next);
        }
      } catch (e) {
        console.error('[CHALLENGE] archive recovery error:', e.message);
      }
    }
    if (recovered) {
      challengeMedalsData.lastRollDay = recovered;
      console.log(`[CHALLENGE] No prior state — recovered lastRollDay=${recovered} from latest archive day.`);
    } else {
      // No DB or no archive history. Safest assumption: any scores currently
      // loaded belong to today — don't trigger a roll that would archive them
      // as yesterday and wipe the scores table.
      challengeMedalsData.lastRollDay = today;
      console.log(`[CHALLENGE] No prior state and no archive history — seeded lastRollDay=${today} to preserve current scores.`);
    }
    saveChallengeMedals();
  }
  if (challengeMedalsData.lastRollDay === today) return;
  await performChallengeRoll(today);
}

async function performChallengeRoll(today) {
  const archiveDay = challengeMedalsData.lastRollDay || yesterdayParisDayKey();
  console.log(`[CHALLENGE] Rolling cycle: archiveDay=${archiveDay} newDay=${today}`);

  const winnersByUser = {};
  for (const rkId of challengeRankingIds()) {
    const top = collectTop3ForRanking(rkId);
    const direction = isLowerBetter(rkId) ? 'asc (lower=better)' : 'desc (higher=better)';
    console.log(`[CHALLENGE] ${rkId} sort=${direction} top=${JSON.stringify(top)}`);
    for (let i = 0; i < top.length; i++) {
      const rank = i + 1;
      const medal = rank === 1 ? 'or' : rank === 2 ? 'argent' : 'bronze';
      const username = top[i].u;
      console.log(`[CHALLENGE]   rank=${rank} medal=${medal} user=${username} score=${top[i].s}`);
      if (!winnersByUser[username]) winnersByUser[username] = [];
      winnersByUser[username].push({
        game: (RANKINGS[rkId] && RANKINGS[rkId].game) || rkId,
        rankingId: rkId,
        rank,
        medal,
      });
    }
  }

  challengeMedalsData.medalsByVisibleDay[archiveDay] = winnersByUser;
  notifyChallengeWinners(winnersByUser, archiveDay);
  challengeMedalsData.lastRollDay = today;
  saveChallengeMedals();

  // Award daily XP while challenge scores are still in memory
  try { await awardDailyXp(); } catch (e) {
    console.error('[XP] awardDailyXp error:', e.message);
  }

  if (process.env.DATABASE_URL) {
    const rankingIds = challengeRankingIds();
    try {
      await db.archiveChallengeScores(archiveDay, rankingIds);
      console.log(`[CHALLENGE] Scores archived for day ${archiveDay} (${rankingIds.length} rankings)`);
      await db.clearDailyChallengeScores(rankingIds);
      console.log(`[CHALLENGE] DB challenge scores cleared`);
    } catch (e) {
      console.error('[CHALLENGE] archive/clear error:', e.message);
    }
  }

  resetChallengeScoresInMemory();
}

function applyPendingChallengeNotifications(username, user) {
  const list = challengeMedalsData.pendingNotifications[username];
  if (!Array.isArray(list) || list.length === 0) return;
  for (const n of list) {
    addUserHistoryEntry(user, {
      type: Number(n.type) || 1,
      content: String(n.content || ''),
      flNew: true,
    });
  }
  delete challengeMedalsData.pendingNotifications[username];
  saveChallengeMedals();
}

function normalizeUsername(raw) {
  return String(raw || '').trim().toLowerCase();
}

function getClientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.ip || (req.socket && req.socket.remoteAddress) || '';
}

function getLaunchIdFromReq(req) {
  const direct = String((req.query && req.query.launch_id) || '').trim();
  if (direct) return direct;

  const referer = String(req.headers.referer || '');
  if (referer) {
    try {
      const u = new URL(referer);
      const fromRef = String(u.searchParams.get('launch_id') || '').trim();
      if (fromRef) return fromRef;
    } catch {}
  }
  return '';
}

function isValidUsername(username) {
  return /^[a-zA-Z0-9_]{3,20}$/.test(username);
}

// Per-IP rate limiter for /api/auth/register.
// Sliding window: at most REGISTER_MAX attempts per REGISTER_WINDOW_MS,
// plus a hard cap of REGISTER_DAILY_MAX successful registrations per day.
const REGISTER_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const REGISTER_MAX = 5;                    // 5 attempts/hour/IP
const REGISTER_DAILY_MAX = 10;             // 10 successful regs/day/IP
const registerAttempts = new Map(); // ip -> { attempts: number[], successDay: string, successCount: number }

function checkRegisterRateLimit(ip) {
  const now = Date.now();
  const todayKey = new Date(now).toISOString().slice(0, 10);
  let rec = registerAttempts.get(ip);
  if (!rec) {
    rec = { attempts: [], successDay: todayKey, successCount: 0 };
    registerAttempts.set(ip, rec);
  }
  // Drop attempts older than the window
  rec.attempts = rec.attempts.filter((t) => now - t < REGISTER_WINDOW_MS);
  // Reset daily success counter if the day rolled over
  if (rec.successDay !== todayKey) {
    rec.successDay = todayKey;
    rec.successCount = 0;
  }
  if (rec.attempts.length >= REGISTER_MAX) return false;
  if (rec.successCount >= REGISTER_DAILY_MAX) return false;
  rec.attempts.push(now);
  return true;
}

function recordSuccessfulRegister(ip) {
  const rec = registerAttempts.get(ip);
  if (rec) rec.successCount++;
}

// Periodically prune empty entries to keep the map bounded.
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of registerAttempts) {
    rec.attempts = rec.attempts.filter((t) => now - t < REGISTER_WINDOW_MS);
    if (rec.attempts.length === 0 && rec.successCount === 0) {
      registerAttempts.delete(ip);
    }
  }
}, 10 * 60 * 1000).unref();

function getDisplayName(username) {
  const key = String(username || '').toLowerCase();
  const u = users[key];
  return (u && u.displayName) || username;
}

function isValidPassword(password) {
  return typeof password === 'string' && password.length >= 6 && password.length <= 80;
}

// ─── Password hashing (bcrypt) with lazy migration ───
// Accounts created before hashing was introduced have a plaintext `password`
// in the DB (and in the in-memory `users` cache). verifyPassword accepts both:
// a bcrypt hash is checked with bcrypt.compare; a legacy plaintext value is
// compared directly and, on a match, returns an `upgrade` hash for the caller
// to persist so the account is silently migrated on its next successful login.
// New accounts and every password change always store a bcrypt hash, so the
// plaintext path drains over time. Backward-compatible: nobody is locked out.
const BCRYPT_COST = 10;
function looksHashed(s) {
  return typeof s === 'string' && /^\$2[aby]\$\d{2}\$/.test(s);
}
function hashPassword(plain) {
  return bcrypt.hash(String(plain), BCRYPT_COST);
}
async function verifyPassword(stored, plain) {
  if (typeof stored !== 'string' || stored.length === 0) return { ok: false, upgrade: null };
  if (looksHashed(stored)) {
    let ok = false;
    try { ok = await bcrypt.compare(String(plain), stored); } catch { ok = false; }
    return { ok, upgrade: null };
  }
  const ok = stored === String(plain);
  return { ok, upgrade: ok ? await hashPassword(plain) : null };
}

function isDebugNotUser(username) {
  return String(username || '').toLowerCase() === 'debugnot';
}

function getFrutizJob(username, user) {
  if (user && typeof user.frutijob === 'string' && user.frutijob.trim()) return user.frutijob.trim();
  if (isDebugNotUser(username)) return 'Frutiz';
  if (user && user.isModerator) return user.gender === 'F' ? 'Modératrice' : 'Modérateur';
  if (user && user.isAnimator) return user.gender === 'F' ? 'Animatrice' : 'Animateur';
  return 'Frutiz';
}

// Format a date for the "bd" / "ft" XML attributes: YYYY-MM-DD.HH:MM:SS
// Native Frutiparc format uses a DOT between date and time (FEDate.newFromString
// reads positions 0-9 for date and 11+ for time, ignoring the separator at pos 10).
function formatFrutizDate(raw, fallback) {
  fallback = fallback || '2005-01-01.00:00:00';
  if (!raw) return fallback;
  // Normalise: accept space, T or dot separator.
  const m = String(raw).match(/^(\d{4}-\d{2}-\d{2})[ T.](\d{2}:\d{2}:\d{2})/);
  if (m) return m[1] + '.' + m[2];
  // Date-only?
  const d2 = String(raw).match(/^(\d{4}-\d{2}-\d{2})$/);
  if (d2) return d2[1] + '.00:00:00';
  try {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return fallback;
    return d.toISOString().substring(0, 10) + '.' + d.toISOString().substring(11, 19);
  } catch { return fallback; }
}

// Format the "ft" attribute: subscription date in YYYY-MM-DD.HH:MM:SS format.
// Read by Flash client (FrutizInfo.as:421-422) for "subday" + "frutiAge" display.
function getFrutizSubscribeDate(user) {
  return formatFrutizDate(user && user.createdAt, '2005-01-01.00:00:00');
}

// Format birthday for "bd" attribute in DOT format.
function getFrutizBirthday(user, fallback) {
  return formatFrutizDate(user && user.birthday, fallback || '2000-01-01.00:00:00');
}

// ─────────────────────────────────────────────
// Preference definitions
// Built like the original: id(2 base62) + type(1 char) + nameLen(2 base62) + name + defaultLen(2 base62) + default
// ─────────────────────────────────────────────
const prefDefs = [
  { id: 1,  type: 'i', name: 'default_channel',          def: encode62(2) },
  { id: 2,  type: 'b', name: 'dsp_newmail_alert',        def: 'Y' },
  { id: 3,  type: 'i', name: 'invite_channel_behavior',  def: encode62(1) },
  { id: 4,  type: 'i', name: 'invite_chat_behavior',     def: encode62(1) },
  { id: 5,  type: 's', name: 'wallpaper',                def: '' },
  { id: 6,  type: 'i', name: 'cache_length',             def: encode62(30) },
  { id: 7,  type: 'b', name: 'cl_open',                  def: 'Y' },
  { id: 8,  type: 'b', name: 'win_flMoveAnim',           def: 'Y' },
  { id: 9,  type: 'b', name: 'ch_dsp_h',                 def: 'Y' },
  { id: 10, type: 'b', name: 'ch_dsp_join',              def: 'Y' },
  { id: 11, type: 'b', name: 'ch_dsp_leave',             def: 'Y' },
  { id: 12, type: 'b', name: 'ch_dsp_kick',              def: 'Y' },
  { id: 13, type: 'b', name: 'ch_dsp_ban',               def: 'Y' },
];

function buildPrefDefString() {
  let r = '';
  for (const p of prefDefs) {
    r += encode62(p.id, 2);
    r += p.type;
    r += encode62(p.name.length, 2) + p.name;
    r += encode62(p.def.length, 2) + p.def;
  }
  return r;
}

function parsePrefString(str) {
  const result = {};
  let pos = 0;
  while (pos + 4 <= str.length) {
    const id = decode62(str.substring(pos, pos + 2));
    const len = decode62(str.substring(pos + 2, pos + 4));
    const val = str.substring(pos + 4, pos + 4 + len);
    pos += 4 + len;
    result[id] = val;
  }
  return result;
}

function encodePrefString(parsed) {
  let r = '';
  for (const [id, val] of Object.entries(parsed)) {
    const v = String(val);
    r += encode62(Number(id), 2) + encode62(v.length, 2) + v;
  }
  return r;
}

function ensureContactLists(user) {
  if (!Array.isArray(user.contacts)) user.contacts = [];
  if (!Array.isArray(user.blacklist)) user.blacklist = [];
  if (!Array.isArray(user.contactFolders)) user.contactFolders = [];
  if (!user.contactFolderMap || typeof user.contactFolderMap !== 'object') {
    user.contactFolderMap = {};
  }
}

function getContactFolder(user, addr) {
  return (user.contactFolderMap && user.contactFolderMap[addr]) || 'mycontact';
}

function isCustomContactFolder(user, uid) {
  if (!uid || uid === 'mycontact' || uid === 'blacklist') return false;
  return Array.isArray(user.contactFolders) &&
         user.contactFolders.some((f) => f.uid === uid);
}

// ─────────────────────────────────────────────
// Mail system helpers
// Each user has user.mails: [{uid, from, fromAddr, to, toAddrs, subject,
// body, folder, date, read}]. Folders: inbox|outbox|draftbox|blackbox|
// recyclebin. Sender keeps a copy in outbox; recipients get one in inbox.
// ─────────────────────────────────────────────
const MAIL_FOLDERS = new Set(['inbox', 'outbox', 'draftbox', 'blackbox', 'recyclebin']);

function ensureMails(user) {
  if (!Array.isArray(user.mails)) user.mails = [];
}

function genMailUid() {
  return 'm' + crypto.randomBytes(5).toString('hex');
}

// desc[0]=from, desc[1]=subject, desc[2]=to, desc[3..]=body lines
function parseMailDesc(d) {
  const lines = String(d || '').split(/\r?\n/);
  return {
    from: (lines[0] || '').trim(),
    subject: lines[1] || '',
    to: (lines[2] || '').trim(),
    body: lines.slice(3).join('\n'),
  };
}

function encodeMailDesc(mail) {
  return [
    mail.fromAddr || mail.from || '',
    mail.subject || '',
    Array.isArray(mail.toAddrs) ? mail.toAddrs.join(', ') : (mail.to || ''),
    mail.body || '',
  ].join('\r\n');
}

// "Alice <alice@frutiparc.com>" → "alice@frutiparc.com"
function extractEmailAddress(s) {
  const v = String(s || '').trim();
  const m = v.match(/<([^>]+)>/);
  if (m) return m[1].trim();
  return v;
}

// Split a "to" string with comma-separated recipients.
function parseRecipients(toRaw) {
  return String(toRaw || '')
    .split(/[,;]/)
    .map((s) => extractEmailAddress(s))
    .filter(Boolean);
}

// Resolve a frutiparc address to a username. Checks in-memory users first,
// then falls back to the DB so that offline recipients are reachable.
async function addressToUsername(addr) {
  const v = String(addr || '').trim().toLowerCase();
  if (!v) return null;
  const local = v.split('@')[0];
  if (!local) return null;
  // In-memory match (case-insensitive).
  for (const name of Object.keys(users)) {
    if (name.toLowerCase() === local) return name;
  }
  // Fall back to DB: lookup confirms the recipient exists.
  try {
    const dbUser = await db.findUserByUsername(local);
    if (dbUser) {
      // Hydrate so subsequent in-memory operations work.
      try { await hydrateUserFromDb(dbUser.username, dbUser); } catch (e) { /* ignore */ }
      return dbUser.username;
    }
  } catch (e) {
    /* DB unreachable — fall through */
  }
  return null;
}

function findMail(user, uid) {
  ensureMails(user);
  return user.mails.find((m) => m.uid === uid) || null;
}

// FEDate.newFromString in the SWF strictly reads "YYYY-MM-DD HH:MM:SS" by
// fixed offsets. Convert legacy French dates ("DD/MM/YYYY HH:MM:SS") that were
// written by an older sendmail handler so the Detail view's date column can
// format them.
function normalizeMailDate(s) {
  if (!s) return '';
  const m = String(s).match(/^(\d{2})\/(\d{2})\/(\d{4})[ ,]+(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return s;
  return `${m[3]}-${m[2]}-${m[1]} ${m[4]}:${m[5]}:${m[6] || '00'}`;
}

function buildMailElementXml(mail) {
  const desc = encodeMailDesc(mail);
  const access = mail.read ? '1' : '0';
  const date = normalizeMailDate(mail.date);
  return `<e u="${escapeXml(mail.uid)}" t="mail" s="${desc.length}" d="${escapeXml(date)}" a="${access}">${escapeXml(desc)}</e>`;
}

function unreadInboxCount(user) {
  ensureMails(user);
  return user.mails.filter((m) => m.folder === 'inbox' && !m.read).length;
}

// Deliver a mail to each known recipient: copies the mail (new uid) into the
// recipient's inbox and notifies them via CBee if they are connected.
// senderUsername is the human-readable username of the sender (for logging /
// blacklist checks).
async function deliverMailToRecipients(mail, senderUsername) {
  const recipients = Array.isArray(mail.toAddrs) && mail.toAddrs.length
    ? mail.toAddrs
    : parseRecipients(mail.toAddrs || mail.to || '');
  const seen = new Set();
  for (const addr of recipients) {
    const target = await addressToUsername(addr);
    if (!target) {
      console.log(`[Mail] Recipient "${addr}" unknown — skipped (sender=${senderUsername})`);
      continue;
    }
    if (seen.has(target)) continue;
    seen.add(target);
    const recipientUser = users[target];
    if (!recipientUser) continue;

    ensureMails(recipientUser);

    // Spam-folder routing if recipient blacklisted the sender.
    const senderAddr = mail.fromAddr || (senderUsername + '@frutiparc.com');
    const blacklisted = Array.isArray(recipientUser.blacklist)
      && recipientUser.blacklist.some((a) => String(a).toLowerCase() === senderAddr.toLowerCase());
    const destFolder = blacklisted ? 'blackbox' : 'inbox';

    const delivered = {
      uid: 'm' + crypto.randomBytes(5).toString('hex'),
      from: mail.from,
      fromAddr: senderAddr,
      to: mail.to,
      toAddrs: mail.toAddrs,
      subject: mail.subject,
      body: mail.body,
      folder: destFolder,
      date: mail.date,
      read: false,
    };
    recipientUser.mails.push(delivered);
    if (recipientUser._dbId) {
      db.saveMail(recipientUser._dbId, delivered)
        .catch((e) => console.error('[DB] mail deliver save error:', e.message));
    }

    notifyNewMail(target, delivered);
    console.log(`[Mail] Delivered ${mail.uid} → ${target}/${destFolder} (as ${delivered.uid})`);
  }
}

// Notify a connected recipient over CBee that they received a new mail.
// FPFileMng / listener.main.onNewMail expects <ax from="..." subject="..." />.
function notifyNewMail(targetUsername, mail) {
  const socks = getSocketsForUsername(targetUsername);
  if (!socks.length) return;
  const xml = `<${CMD.newmail} from="${escapeXml(mail.fromAddr || mail.from || '')}" subject="${escapeXml(mail.subject || '')}" />`;
  for (const sock of socks) sendToClient(sock, xml);
}

function normalizeContactAddress(raw) {
  const v = String(raw || '').trim();
  if (!v) return '';
  if (v.includes('@')) return v;
  return `${v}@frutiparc.com`;
}

function isContactPlaceholder(value) {
  const s = String(value || '').trim();
  return s === '' || /^notext$/i.test(s) || /^undefined$/i.test(s) || /^null$/i.test(s);
}

function extractContactCandidateFromDesc(desc) {
  const raw = String(desc || '').trim();
  if (!raw) return '';

  const tokens = raw
    .split(/[\r\n\t;|,<>()[\]{}]+/g)
    .map((v) => String(v || '').trim())
    .filter(Boolean);

  for (const token of tokens) {
    if (isContactPlaceholder(token)) continue;
    if (/^[a-z0-9_.-]{2,32}(?:@frutiparc\.com)?$/i.test(token)) return token;
  }

  return '';
}

const DEFAULT_BOUILLE_LIST = [
  { b: '000503000000111010000000', n: 'Classique' },
  { b: '000503000000111011000000', n: 'Classique 2' },
  { b: '000503000000111012000000', n: 'Classique 3' },
  { b: '010503000000111010000000', n: 'Famille 1' },
];

const DEFAULT_WALLPAPERS = [
  { u: 'moutarde',       n: 'Chevalier moutarde',    url: 'wal/ch.jpg', color: '4E5464;' },
  { u: 'chorale',        n: 'Chorale Frutiparc',     url: 'wal/fp.jpg', color: 'ADE76B;' },
  { u: 'pixizchristmas', n: 'Noël Pixiz',            url: 'wal/ma.jpg', color: 'ADE76B;' },
  { u: 'snakechristmas', n: 'Noël Frutisnake',       url: 'wal/no.jpg', color: 'ADE76B;' },
  { u: 'pixiz',          n: 'Mini-Pixiz',            url: 'wal/pi.jpg', color: 'F9D190;' },
  { u: 'nostromo',       n: 'Mini-Wave Nostromo',    url: 'wal/pl.jpg', color: '000044;' },
  { u: 'ministar',       n: 'Mini-Wave Mini-Star',   url: 'wal/va.jpg', color: '000044;' },
  { u: 'utopiz',         n: 'Utopiz',                url: 'wal/ut.jpg', color: 'F6AFA9;' },
];
const WALLPAPER_BY_ID = Object.fromEntries(DEFAULT_WALLPAPERS.map(w => [w.u, w]));

// Accessories = last 9 chars of a 24-char bouille string.
// The first 15 chars are filled from the user's current bouille at serve time.
const DEFAULT_ACCESSORIES = [
  { u: 'bananocle', n: 'Bananocle', suffix: '6010k0w0g' },
  { u: 'beaute',    n: 'Beauté',    suffix: 'b000k0w0g' },
  { u: 'normal',    n: 'Normal',    suffix: '000000000' },
  { u: 'Kiwix',    n: 'Kiwix',    suffix: '30x000000' },
];

// ─────────────────────────────────────────────
// Shop catalog — used by /ft/tree, /ft/pack, /ft/buy
// The AS2 box.Shop expects a <c> (category) tree with <p> (product) leaves.
// Each product, once purchased, is appended to user.customAccessories so it
// appears in the Inventaire/Accessoires folder and can be worn by the avatar.
// suffix9 = last 9 chars of a 24-char bouille string (prefix is taken from
// the user's current bouille at serve time).
// ─────────────────────────────────────────────
// Game packs (rubrique "Packs") — full games, granted to everyone by default
// on this server, so they show as "déjà possédé". Sourced from the original
// boutique captures in public/ft/game-pack/. picto "pack,N" is the sprite key
// the client renders; suffix9 is unused for these (kept for the DB NOT NULL).
const SHOP_GAME_PACKS_DEFAULT = [
  ['pack,10', 10, 'Pack de Motion Ball 2',         'Jouez les célèbres balles pour vaincre le célèbre Tournéboulé !',                  "Bénéficiez du jeux complet et d'un pass journalier"],
  ['pack,12', 11, 'Pack de Frutisnake',            'Jouez un serpent de manière illimité pour manger le plus de fruits possible.',    "Bénéficiez du jeux complet et d'un pass journalier"],
  ['pack,13', 12, 'Pack de Burning Kiwi',          'Devenez le roi du circuit de manière illimité en activant des turbo survitaminés.', "Bénéficiez du jeux complet et d'un pass journalier"],
  ['pack,14', 13, 'Pack de Swapou 2',              'Jouez Dimitri ou Natacha pour vaincre le redoutable Wasabii !',                   "Bénéficiez du jeux complet et d'un pass journalier"],
  ['pack,15', 14, 'Pack de Frutibandas',           'Affrontez les meilleurs joueurs à Frutibandas et entrainez-vous de manière illimitée.', "Bénéficiez du jeux complet et d'un pass journalier"],
  ['pack,16', 15, 'Pack de Grapiz',                'Affrontez les meilleurs joueurs à Grapiz et entrainez-vous de manière illimitée.',  "Bénéficiez du jeux complet et d'un pass journalier"],
  ['pack,17', 16, 'Pack de Kaluga',                'Jouez le célèbre Tzongre et ses amis dans des défis incroyables',                 "Bénéficiez du jeux complet et d'un pass journalier"],
  ['pack,3',  17, 'Pack de Frutibandas et Grapiz', 'Jouez de manière illimitée aux deux jeux multijoueurs : Grapiz et Frutibandas',   "Bénéficiez des jeux complet et d'un pass journalier pour chaque jeu"],
].map(([picto, id, name, description, comment]) => ({
  id, name, category: 'Packs', price: 260, suffix9: '000000000', picto, description, comment,
}));

// Feutres (rubrique "Feutres") — chat-pen colours, granted by default.
// picto "feutre,N" (N = index 0..16) is the original boutique format,
// documented in public/ft/pack-pen. Order matches penItemList (ids 315..327,
// 599..602), so the array index is the picto id.
const FEUTRE_DESC = 'Personnalisez votre écriture avec ce magnifique feutre qui vous permettra de vous distinguer sur les salons';
const SHOP_FEUTRES_DEFAULT = [
  [315, 'Feutre orange',             'Couleur orange ISO'],
  [316, 'Feutre bleu',               'Couleur bleue ISO'],
  [317, 'Feutre vert foncé',         'Couleur verte foncée ISO'],
  [318, 'Feutre Bordeaux',           'Couleur Bordeaux ISO'],
  [319, 'Feutre rose',               'Couleur rose ISO'],
  [320, 'Feutre jaune',              'Couleur jaune ISO'],
  [321, 'Feutre vert clair',         'Couleur verte claire ISO'],
  [322, 'Feutre cyan',               'Couleur cyan ISO'],
  [323, 'Feutre bleu foncé',         'Couleur bleue foncée ISO'],
  [324, 'Feutre marron',             'Couleur marron ISO'],
  [325, 'Feutre marron foncé',       'Couleur marron foncé ISO'],
  [326, 'Feutre vert kaki',          'Couleur vert kaki ISO'],
  [327, 'Feutre bleu pétrole',       'Couleur bleue pétrole ISO'],
  [599, 'Feutre vert',               'Couleur verte ISO'],
  [600, 'Feutre bleu pétrole foncé', 'Couleur bleue pétrole foncée ISO'],
  [601, 'Feutre orange foncé',       'Couleur orange foncée ISO'],
  [602, 'Feutre violet',             'Couleur violette ISO'],
].map(([id, name, comment], i) => ({
  id, name, category: 'Feutres', price: 10, suffix9: '000000000',
  picto: `feutre,${i}`, description: FEUTRE_DESC, comment,
}));

const SHOP_PACKS_DEFAULT = [
  {
    id: 101,
    name: 'Bonnet de nuit',
    category: 'Accessoires',
    price: 60,
    description: 'Un bonnet douillet pour les Frutiz qui aiment rêvasser sur le chat. Parfait pour afficher une ambiance cosy !',
    suffix9: '9020t0a00',
    comment: 'Un bonnet douillet pour les Frutiz qui aiment rêvasser sur le chat. Parfait pour afficher une ambiance cosy !',
  },
  {
    id: 102,
    name: 'Chapeau de shérif',
    category: 'Accessoires',
    price: 60,
    description: 'Pour faire régner la loi dans les contrées de Legumia. Un classique indémodable de la panoplie du justicier.',
    suffix9: '4020B0000',
    comment: 'Pour faire régner la loi dans les contrées de Legumia. Un classique indémodable de la panoplie du justicier.',
  },
  {
    id: 103,
    name: 'Masque de ski',
    category: 'Accessoires',
    price: 60,
    description: 'Prêt à dévaler les pistes ! Ce masque coloré complètera votre tenue hivernale à merveille.',
    suffix9: 'a0b0a080m',
    comment: 'Prêt à dévaler les pistes ! Ce masque coloré complètera votre tenue hivernale à merveille.',
  },
  // Casquette Anim (suffix9 30y0t0j00) is no longer purchasable — it is now
  // auto-granted to users with is_animator=true via grantAnimatorAccessory
  // (mirroring the Badge Modérateur flow). See ANIM_ACCESSORY_* constants.
  // Wallpapers
  { id: 201, name: 'Chevalier moutarde',    category: "Fonds d'écran", price: 0, description: 'Un fond chevaleresque aux tons moutarde.',     suffix9: '000000000', wallpaperId: 'moutarde' },
  { id: 202, name: 'Chorale Frutiparc',     category: "Fonds d'écran", price: 0, description: 'La grande chorale de Frutiparc !',             suffix9: '000000000', wallpaperId: 'chorale' },
  { id: 203, name: 'Noël Pixiz',            category: "Fonds d'écran", price: 0, description: 'Ambiance de Noël avec les Pixiz.',              suffix9: '000000000', wallpaperId: 'pixizchristmas' },
  { id: 204, name: 'Noël Frutisnake',       category: "Fonds d'écran", price: 0, description: 'Frutisnake en mode fêtes de fin d\'année.',     suffix9: '000000000', wallpaperId: 'snakechristmas' },
  { id: 205, name: 'Mini-Pixiz',            category: "Fonds d'écran", price: 0, description: 'Les petits Pixiz en action.',                   suffix9: '000000000', wallpaperId: 'pixiz' },
  { id: 206, name: 'Mini-Wave Nostromo',    category: "Fonds d'écran", price: 0, description: 'Le vaisseau Nostromo de Mini-Wave.',             suffix9: '000000000', wallpaperId: 'nostromo' },
  { id: 207, name: 'Mini-Wave Mini-Star',   category: "Fonds d'écran", price: 0, description: 'La planète Mini-Star de Mini-Wave.',             suffix9: '000000000', wallpaperId: 'ministar' },
  { id: 208, name: 'Utopiz',                category: "Fonds d'écran", price: 0, description: 'Le monde coloré d\'Utopiz.',                    suffix9: '000000000', wallpaperId: 'utopiz' },
  ...SHOP_GAME_PACKS_DEFAULT,
  ...SHOP_FEUTRES_DEFAULT,
];
const SHOP_PACKS = [...SHOP_PACKS_DEFAULT];

// Default accessory description — the two paragraphs the original Frutiparc
// showed for every accessory. win.Shop.displayItemPage runs
// FEString.replaceBackSlashN on the <d> text and lays it out across two style
// blocks (s="4" bold catchphrase, s="3" regular blurb), and the client parses
// the shop XML with ignoreWhite=true — so a single LITERAL "\n" (backslash-n,
// which survives ignoreWhite and is what replaceBackSlashN converts) separates
// the bold line 1 from the regular line 2. A single-line <d> is exactly why
// line 2 is currently missing in the shop.
const DEFAULT_ACCESSORY_DESC_L1 =
  "Hier, j'ai regardé ma bouille et je la trouvais rigolote, aujourd'hui avec mon accessoire, youpi-kiwi, elle est trop formidable !";
const DEFAULT_ACCESSORY_DESC_L2 =
  "Si toi aussi tu veux avoir une formida-bouille, alors c'est facile, choisi un accessoire et pose le sur ta bouille ! Un jour aventurier, un jour citadin, tu vas pouvoir changer de look quand bon te semble. Et pour que tu conserves ta touche personnelle, tous les accessoires sont en quantité limitée";
// win.Shop.displayItemPage inserts the <d> text as RAW doc-markup between the
// title (<l><t s="4">) and the price line, so each level must carry its own
// style block. Per frutiparc/Standard.as getDocStyle: s="2" = size 12 bold,
// s="1" = size 11 regular — so level 1 is bold and level 2 smaller and not bold.
const ACC_DESC_STYLE_L1 = 2;
const ACC_DESC_STYLE_L2 = 1;
// Per-accessory override: stored in `description` as JSON {"l1":…,"l2":…}. Any
// non-JSON (legacy plain text) or empty description means "no override" → the
// shared default applies. This restores the common default for every existing
// accessory without mutating stored data, while letting the admin set a custom
// description per accessory.
function resolveAccessoryLevels(pack) {
  const raw = pack && pack.description ? String(pack.description).trim() : '';
  if (raw.charAt(0) === '{') {
    try {
      const o = JSON.parse(raw);
      if (o && typeof o === 'object' && !Array.isArray(o)) {
        const l1 = (o.l1 != null && String(o.l1).trim()) ? String(o.l1) : DEFAULT_ACCESSORY_DESC_L1;
        const l2 = (o.l2 != null) ? String(o.l2) : DEFAULT_ACCESSORY_DESC_L2;
        return { l1, l2 };
      }
    } catch { /* fall through to default */ }
  }
  return { l1: DEFAULT_ACCESSORY_DESC_L1, l2: DEFAULT_ACCESSORY_DESC_L2 };
}
// Escape text for the inner doc-markup layer (& < >). The whole markup string is
// escaped again by escapeXml for XML transport; the SWF unescapes once when it
// reads the <d> text node, then the doc renderer parses the markup — so the two
// layers of escaping are intentional.
function docEscapeText(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function buildAccessoryDescMarkup(pack) {
  const { l1, l2 } = resolveAccessoryLevels(pack);
  let m = `<l><t s="${ACC_DESC_STYLE_L1}">${docEscapeText(l1)}</t></l>`;
  if (l2 && String(l2).trim()) m += `<l><t s="${ACC_DESC_STYLE_L2}">${docEscapeText(l2)}</t></l>`;
  return m;
}

// Moderator-only accessory automatically granted with the role and revoked
// when the role is taken away.  Not purchasable (shopId stays 0) so it never
// appears in the shop tree.
const MOD_ACCESSORY_ID = 'mod_badge';
const MOD_ACCESSORY_SUFFIX9 = '30i0e0j03';
const MOD_ACCESSORY_NAME = 'Badge Modérateur';

const ANIM_ACCESSORY_ID = 'anim_cap';
const ANIM_ACCESSORY_SUFFIX9 = '30y0t0j00';   // Casquette Anim suffix
const ANIM_ACCESSORY_NAME = 'Casquette Anim';

async function grantAccessory(username, dbUserRow, accId, accSuffix9, accName, logTag) {
  const u = users[username];
  const userId = (u && u._dbId) || (dbUserRow && dbUserRow.id);
  if (!userId || !process.env.DATABASE_URL) return;
  try {
    const existing = await db.getUserAccessories(userId);
    if (existing.some((a) => a && a.id === accId)) return;
    const fbouille = (u && u.fbouille) || (dbUserRow && dbUserRow.fbouille) || DEFAULT_BOUILLE_STATE;
    const acc = {
      id: accId,
      shopId: 0,
      n: accName,
      v: fbouille.substring(0, 15) + accSuffix9,
      q: '1',
      p: '0',
    };
    await db.addAccessory(userId, acc);
    if (u) u.customAccessories = await db.getUserAccessories(userId);
    console.log(`[${logTag}] granted to ${username}`);
  } catch (e) { console.error(`[${logTag}] grant DB error:`, e.message); }
}

async function revokeAccessory(username, dbUserRow, accId, logTag) {
  const u = users[username];
  const userId = (u && u._dbId) || (dbUserRow && dbUserRow.id);
  if (!userId || !process.env.DATABASE_URL) return;
  try {
    const existing = await db.getUserAccessories(userId);
    const target = existing.find((a) => a && a.id === accId);
    if (!target) return;
    await db.deleteAccessory(target.dbRowId);
    if (u) u.customAccessories = await db.getUserAccessories(userId);
    console.log(`[${logTag}] revoked from ${username}`);
  } catch (e) { console.error(`[${logTag}] revoke DB error:`, e.message); }
}

function grantModeratorAccessory(username, dbUserRow) {
  return grantAccessory(username, dbUserRow, MOD_ACCESSORY_ID, MOD_ACCESSORY_SUFFIX9, MOD_ACCESSORY_NAME, 'MOD-BADGE');
}
function revokeModeratorAccessory(username, dbUserRow) {
  return revokeAccessory(username, dbUserRow, MOD_ACCESSORY_ID, 'MOD-BADGE');
}
function grantAnimatorAccessory(username, dbUserRow) {
  return grantAccessory(username, dbUserRow, ANIM_ACCESSORY_ID, ANIM_ACCESSORY_SUFFIX9, ANIM_ACCESSORY_NAME, 'ANIM-CAP');
}
function revokeAnimatorAccessory(username, dbUserRow) {
  return revokeAccessory(username, dbUserRow, ANIM_ACCESSORY_ID, 'ANIM-CAP');
}

async function syncAllRoleAccessories() {
  if (!process.env.DATABASE_URL) return;
  try {
    const rows = await db.listAllUsers();
    let modGranted = 0, modRevoked = 0, animGranted = 0, animRevoked = 0;
    for (const row of rows) {
      const existing = await db.getUserAccessories(row.id);
      const hasMod = existing.some((a) => a && a.id === MOD_ACCESSORY_ID);
      const hasAnim = existing.some((a) => a && a.id === ANIM_ACCESSORY_ID);
      if (row.is_moderator && !hasMod) { await grantModeratorAccessory(row.username, row); modGranted++; }
      else if (!row.is_moderator && hasMod) { await revokeModeratorAccessory(row.username, row); modRevoked++; }
      if (row.is_animator && !hasAnim) { await grantAnimatorAccessory(row.username, row); animGranted++; }
      else if (!row.is_animator && hasAnim) { await revokeAnimatorAccessory(row.username, row); animRevoked++; }
    }
    console.log(`[ROLE-ACC] startup sync — mod: +${modGranted}/-${modRevoked}, anim: +${animGranted}/-${animRevoked}`);
  } catch (e) { console.error('[ROLE-ACC] startup sync error:', e.message); }
}

function getShopPack(id) {
  const num = Number(id);
  return SHOP_PACKS.find((p) => p.id === num);
}

// Returns the wallpaper definition tied to an accessory entry, or null.
// Recognizes both the canonical "wp:url:color" value format and legacy
// entries where only the shopId is reliable (older purchases stored as
// regular bouille values before the wallpaper format was introduced).
function getAccessoryWallpaper(acc) {
  if (!acc) return null;
  const v = acc.v || '';
  if (typeof v === 'string' && v.startsWith('wp:')) {
    const parts = v.split(':');
    return { url: parts[1] || '', color: parts.slice(2).join(':') || '' };
  }
  if (acc.shopId) {
    const pack = SHOP_PACKS.find((p) => p.id === Number(acc.shopId));
    if (pack && pack.wallpaperId) {
      const wp = WALLPAPER_BY_ID[pack.wallpaperId];
      if (wp) return { url: wp.url, color: wp.color };
    }
  }
  return null;
}

function userOwnsShopPack(user, id) {
  if (!Array.isArray(user.customAccessories)) return false;
  return user.customAccessories.some((a) => a && a.shopId === Number(id));
}

// Rubriques granted to everyone by default (full games, feutres, titems,
// packs…). Everything that is NOT a buyable rubrique — Accessoires or
// Fonds d'écran — is shown as "vous possédez déjà ce produit" and can't be
// re-purchased. Accent/case-insensitive so DB category labels match.
function shopCategoryOwnedByDefault(category) {
  const n = String(category || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  return !(n.startsWith('accessoir') || n.startsWith('fond'));
}

function buildShopTreeXml(user) {
  // Group packs by category.
  const byCategory = new Map();
  for (const pack of SHOP_PACKS) {
    if (!byCategory.has(pack.category)) byCategory.set(pack.category, []);
    byCategory.get(pack.category).push(pack);
  }
  const defaultId = SHOP_PACKS.length ? SHOP_PACKS[0].id : '';
  let inner = '';
  for (const [cat, packs] of byCategory) {
    const prods = packs
      .map((p) => `<p i="${p.id}" n="${escapeXml(p.name)}"/>`)
      .join('');
    inner += `<c n="${escapeXml(cat)}">${prods}</c>`;
  }
  return `<c n="Boutique" d="${defaultId}">${inner}</c>`;
}

function buildShopPackXml(pack, user) {
  const alreadyBuy = (shopCategoryOwnedByDefault(pack.category) || userOwnsShopPack(user, pack.id)) ? '1' : '0';
  if (pack.wallpaperId) {
    const wp = WALLPAPER_BY_ID[pack.wallpaperId];
    const picto = wp ? `wallpaper,${wp.url}` : 'wallpaper,wal/ch.jpg';
    return (
      `<p i="${pack.id}" n="${escapeXml(pack.name)}"` +
      ` p="${escapeXml(picto)}" q="-1" h="${alreadyBuy}">` +
      `<d>${escapeXml(pack.description)}</d>` +
      `<r p="${pack.price}">${escapeXml(pack.comment || '')}</r>` +
      `</p>`
    );
  }
  if (pack.picto) {
    // Game packs ("pack,N") and feutres ("feutre,N") — exact original boutique
    // format: blurb wrapped in <desc>, and packs carry a screenshot block.
    const screens = pack.picto.startsWith('pack,')
      ? `<s n="Capture d'écran du jeu"><b u="wal/pi.jpg" w="150" h="150" /><t u="wal/pl.jpg" w="150" h="150" /></s>`
      : '';
    return (
      `<p i="${pack.id}" n="${escapeXml(pack.name)}"` +
      ` p="${escapeXml(pack.picto)}" h="${alreadyBuy}">` +
      `<d><desc>${escapeXml(pack.description)}</desc></d>` +
      `<r p="${pack.price}">${escapeXml(pack.comment || '')}</r>` +
      screens +
      `</p>`
    );
  }
  // box.Shop builds the picto bouille as:
  //   _global.me.fbouille.substr(0,14) + picto[1]
  // i.e. 14 chars from the user's current bouille + 10 chars from picto[1].
  // The accessory "suffix9" covers positions 15-23 of the final 24-char
  // bouille, so picto[1] must be: bouille[14] + suffix9 (1 + 9 = 10 chars).
  const fullBouille = bouilleOf(user);
  const char14 = (fullBouille.charAt(14) || '0');
  const pictoSuffix10 = (char14 + pack.suffix9).slice(0, 10);
  return (
    `<p i="${pack.id}" n="${escapeXml(pack.name)}"` +
    ` p="bouille,${escapeXml(pictoSuffix10)}" q="-1" h="${alreadyBuy}">` +
    `<d>${escapeXml(buildAccessoryDescMarkup(pack))}</d>` +
    `<r p="${pack.price}"></r>` +
    `</p>`
  );
}

function buildBouilleListXml() {
  return DEFAULT_BOUILLE_LIST
    .map((o) => `<b b="${escapeXml(normalizeBouilleState(o.b))}">${escapeXml(o.n)}</b>`)
    .join('');
}

// ─────────────────────────────────────────────
// File system tree (virtual)
// b = "messages;inbox;outbox;blackbox;draftbox;disccollector;inventory;mycontact;recyclebin"
// The AS2 client (FFileMng) reads bFolder[7]=mycontact, bFolder[8]=recyclebin.
// Do NOT insert extra entries before mycontact/recyclebin or the indices shift.
// ─────────────────────────────────────────────
const FILE_TREE_XML = `<s u="root" n="Bureau" t="desktop" m="0" b="messages;inbox;outbox;blackbox;draftbox;disccollector;inventory;mycontact;recyclebin;blacklist">
  <f u="messages" n="Messages" t="messages">
    <f u="inbox" n="Boîte de réception" t="inbox" p="mail" />
    <f u="outbox" n="Messages envoyés" t="outbox" p="mail" />
    <f u="blackbox" n="Spams" t="blackbox" p="mail" />
    <f u="draftbox" n="Brouillons" t="draftbox" p="mail" />
  </f>
  <f u="disccollector" n="Mes disques" t="disccollector" />
  <f u="inventory" n="Inventaire" t="inventory">
    <f u="inv_accessories" n="Accessoires" t="inventory" />
    <f u="inv_wallpapers" n="Fonds d&apos;écran" t="inventory" />
    <f u="inv_pictos" n="Pictos" t="inventory" />
  </f>
  <f u="shop" n="Boutique" t="shop">
    <f u="accessories" n="Accessoires" t="accessories" />
  </f>
  <f u="mycontact" n="Mes contacts" t="mycontact" />
  <f u="recyclebin" n="Corbeille" t="recyclebin" />
  <f u="blacklist" n="Liste noire" t="blacklist" />
</s>`;

// ─────────────────────────────────────────────
// Serve static files from public/ (AFTER API routes, so our
// endpoints take priority over stale static files in public/do/)
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// Legacy Ruffle page
// ─────────────────────────────────────────────
app.get('/legacy', (req, res) => {
  const sid = req.query.sid;
  if (!resolveUsernameFromSid(sid)) {
    return res.redirect('/');
  }
  res.sendFile(path.join(__dirname, 'public', 'ruffle.html'));
});

// Returns the current user's saved bouille (avatar state) so the Ruffle page
// can launch the SWF with the up-to-date avatar instead of the URL default.
app.get('/api/me/bouille', (req, res) => {
  const sid = String(req.query.sid || '');
  const username = resolveUsernameFromSid(sid);
  if (!username) return res.status(401).json({ ok: false });
  const bouille = bouilleOf(users[username], username);
  res.json({ ok: true, fbouille: bouille });
});

app.get('/login', (req, res) => {
  res.redirect('/');
});

app.get('/', (req, res) => {
  res.sendFile(LOGIN_BIS_PAGE_PATH);
});

// Hard-coded in the legacy SWF (openFunctions.as: _global.logout): the desktop
// "Se déconnecter" menu navigates here.  Tear down the session and bounce to
// the home page.
app.get('/light/logout', (req, res) => {
  const sid = String(req.query.sid || '');
  if (sid) {
    const username = sessions[sid] && sessions[sid].user;
    delete sessions[sid];
    db.deleteSession(sid).catch((e) => console.error('[DB] deleteSession error:', e.message));
    if (username) console.log(`[AUTH] logout user=${username} sid=${sid.slice(0, 8)}…`);
  }
  res.redirect('/');
});

app.post('/api/auth/register', async (req, res) => {
  const ip = getClientIp(req) || 'unknown';
  if (!checkRegisterRateLimit(ip)) {
    console.warn(`[REGISTER] rate-limit blocked ip=${ip}`);
    return res.status(429).json({ ok: false, error: 'rate_limited', message: 'Trop de tentatives, réessayez plus tard.' });
  }

  const rawName = String((req.body && req.body.username) || '').trim();
  const username = rawName.toLowerCase();
  const password = String((req.body && req.body.password) || '');

  if (!isValidUsername(rawName)) {
    return res.status(400).json({ ok: false, error: 'username_invalid', message: 'Pseudo : 3-20 caractères [a-zA-Z0-9_], pas d\'accents.' });
  }
  if (!isValidPassword(password)) {
    return res.status(400).json({ ok: false, error: 'password_invalid', message: 'Password: 6-80 chars.' });
  }
  if (users[username]) {
    return res.status(409).json({ ok: false, error: 'user_exists', message: 'Username already taken.' });
  }

  const passwordHash = await hashPassword(password);
  try {
    const dbUser = await db.createUser(username, passwordHash);
    if (!dbUser) {
      return res.status(409).json({ ok: false, error: 'user_exists', message: 'Username already taken.' });
    }
    users[username] = createDefaultUser(passwordHash);
    users[username]._dbId = dbUser.id;
    users[username].displayName = rawName;
    await db.setUserItems(dbUser.id, users[username].items);
    await db.updateUser(username, { display_name: rawName });
    recordSuccessfulRegister(ip);
    console.log(`[REGISTER] ok ip=${ip} user=${rawName}`);
    return res.json({ ok: true, username: rawName });
  } catch (e) {
    console.error('[DB] register error:', e.message);
    users[username] = createDefaultUser(passwordHash);
    users[username].displayName = rawName;
    recordSuccessfulRegister(ip);
    return res.json({ ok: true, username: rawName });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const username = normalizeUsername(req.body && req.body.username);
  const password = String((req.body && req.body.password) || '');

  try {
    const dbUser = await db.findUserByUsername(username);
    if (dbUser) {
      const { ok, upgrade } = await verifyPassword(dbUser.password, password);
      if (!ok) {
        return res.status(401).json({ ok: false, error: 'invalid_credentials', message: 'Invalid username or password.' });
      }
      if (upgrade) {
        dbUser.password = upgrade;
        db.updateUser(username, { password: upgrade }).catch((e) => console.error('[DB] password upgrade error:', e.message));
      }
      if (!users[username]) {
        await hydrateUserFromDb(username, dbUser);
      }
      users[username]._dbId = dbUser.id;
      users[username].pass = dbUser.password;
      applyPendingChallengeNotifications(username, users[username]);
      db.recordLogin(username).catch((e) => console.error('[DB] recordLogin error:', e.message));
    } else {
      const user = users[username];
      const { ok, upgrade } = await verifyPassword(user && user.pass, password);
      if (!user || !ok) {
        return res.status(401).json({ ok: false, error: 'invalid_credentials', message: 'Invalid username or password.' });
      }
      if (upgrade) user.pass = upgrade;
      applyPendingChallengeNotifications(username, user);
    }
  } catch (e) {
    console.error('[DB] login lookup error:', e.message);
    const user = users[username];
    const { ok, upgrade } = await verifyPassword(user && user.pass, password);
    if (!user || !ok) {
      return res.status(401).json({ ok: false, error: 'invalid_credentials', message: 'Invalid username or password.' });
    }
    if (upgrade) user.pass = upgrade;
  }

  const sid = crypto.randomBytes(16).toString('hex');
  sessions[sid] = { user: username, createdAt: Date.now() };
  const userId = users[username] && users[username]._dbId;
  if (userId) {
    db.createSession(sid, userId).catch((e) => console.error('[DB] session save error:', e.message));
  }
  return res.json({ ok: true, sid, username: getDisplayName(username), redirect: `/legacy?sid=${encodeURIComponent(sid)}` });
});

// ─────────────────────────────────────────────
// ENDPOINT: /api/saveScore — Game popup posts score here after game ends.
// Accepts both GET (from SWF getURL) and POST (from popup JS fetch).
// Query/body params: sid, game (disc name or id), score, data (optional).
// ─────────────────────────────────────────────
async function handleSaveScore(req, res) {
  await rollDailyChallengeIfNeeded();
  const params = Object.assign({}, req.query || {}, req.body || {});
  const sid = String(params.sid || '');
  const gameName = String(params.game || params.g || params.disc || '');
  let mode = Number(params.m ?? params.mode ?? 0) || 0;
  if (mode === 0 && sid && sessions[sid] && sessions[sid].challengeMode) {
    mode = 1;
  }
  const scoreVal = Number(params.score || params.s || 0) || 0;
  const scoreData = serializeScoreData(
    params.data ?? params.da ?? params.r ?? params.misc ?? params.md ?? params.tz ?? ''
  );

  // Resolve user from session.
  let username = '';
  if (sid && sessions[sid]) username = sessions[sid].user || '';
  if (!username) {
    // SWF getURL calls may arrive without sid — try IP fallback.
    const ip = getClientIp(req);
    const fallbackSid = ip ? recentSidByIp.get(ip) : undefined;
    if (fallbackSid && sessions[fallbackSid]) username = sessions[fallbackSid].user || '';
  }

  if (!username) {
    return res.status(401).json({ ok: false, error: 'not_authenticated' });
  }

  let rankingId = rankingIdForGame(gameName, mode);
  if (!rankingId) {
    return res.status(400).json({ ok: false, error: 'unknown_game', game: gameName });
  }
  let extraResult = null;
  let extraRankingId = null;
  if (rankingId.startsWith('bkiwi_')) {
    const hint = users[username] && Number.isFinite(users[username].bkiwiCurrentTrack)
      ? users[username].bkiwiCurrentTrack : undefined;
    const daily = getBkiwiDailyTrack();
    // Per-track classic record: use hint if known, else assume daily (most likely).
    const trackForClassic = Number.isFinite(hint) ? hint : daily;
    rankingId = `bkiwi_track${trackForClassic}_classic`;
    // Always also save to today's daily challenge ranking, so the score appears
    // in scores journaliers regardless of slot-diff timing/staleness.
    extraRankingId = `bkiwi_track${daily}_challenge`;
    console.log(`[HTTP]  bkiwi route hint=${hint} daily=${daily} -> classic:${rankingId} challenge:${extraRankingId}`);
  } else if (rankingId === 'mb2_classic' || rankingId === 'mb2_challenge') {
    // MB2 stores the same packed time+pct (ptmb2) score in both rankings:
    // mb2_classic is the all-time record (visible in fiche via rk=2),
    // mb2_challenge is the daily-reset Championnat ranking.
    rankingId = 'mb2_classic';
    extraRankingId = 'mb2_challenge';
  }

  const result = persistScore(username, rankingId, scoreVal, scoreData);
  if (extraRankingId) {
    extraResult = persistScore(username, extraRankingId, scoreVal, scoreData);
    console.log(`[HTTP]  saveScore ${username} ${extraRankingId} ${scoreVal} updated=${extraResult.updated} (challenge)`);
  }
  if (rankingId === 'jamajama_classic' || rankingId === 'jamajama_challenge') {
    awardJamaPictosOnScore(username);
  }
  console.log(`[HTTP]  saveScore ${username} ${rankingId} ${scoreVal} updated=${result.updated}`);

  // Clear game presence icon now that the game round is over
  setUserInternalStatus(username, 0);

  return res.json({
    ok: true,
    updated: result.updated,
    newScore: result.newScore,
    oldScore: result.oldScore,
    oldPos: result.oldPos,
    newPos: result.newPos,
    rankingId,
  });
}
app.post('/api/saveScore', handleSaveScore);
app.get('/api/saveScore', handleSaveScore);

app.post('/api/admin/clearScores', async (req, res) => {
  const ranking = String(req.body.ranking || '').trim();
  if (!ranking) return res.status(400).json({ ok: false, error: 'missing ranking' });
  for (const [u, rlist] of Object.entries(scoresData.users || {})) {
    if (rlist[ranking]) delete rlist[ranking];
    if (Object.keys(rlist).length === 0) delete scoresData.users[u];
  }
  saveScoresFile();
  if (process.env.DATABASE_URL) {
    try { await db.pool.query("DELETE FROM scores WHERE ranking_id = $1", [ranking]); } catch (e) { console.error(e.message); }
  }
  console.log(`[ADMIN] Cleared scores for ranking: ${ranking}`);
  return res.json({ ok: true, ranking });
});

// ─────────────────────────────────────────────
// Admin panel & API
// ─────────────────────────────────────────────
// ADMIN_KEY MUST be set via environment for any admin endpoint to work.
// Historically there was a hardcoded fallback ('sorbetcitron') which is
// committed in git history — anyone with the source could elevate, so
// the fallback has been removed. If the env var is missing in prod, all
// admin endpoints return 503 instead of accepting requests with a known
// default value.
const ADMIN_KEY = process.env.ADMIN_KEY || '';
if (!ADMIN_KEY) {
  console.warn('[ADMIN] ADMIN_KEY env var is empty — admin endpoints will refuse every request. Set ADMIN_KEY in production.');
}

// Per-IP rate limiter for admin endpoints. Far tighter than the
// register limit (40 requests / 10 min) — admins are humans clicking
// a UI, not a script, so a few dozen requests per window is plenty,
// and the cap means a brute-force attacker who somehow obtained the
// key still can't iterate fast. Failed-auth attempts AND successful
// requests both count, so we also throttle accidental hot-loops.
const ADMIN_RL_WINDOW_MS = 10 * 60 * 1000;
const ADMIN_RL_MAX = 40;
const adminAttempts = new Map(); // ip -> number[] (timestamps)

function checkAdminRateLimit(ip) {
  const now = Date.now();
  let arr = adminAttempts.get(ip);
  if (!arr) { arr = []; adminAttempts.set(ip, arr); }
  // Drop expired entries
  while (arr.length && now - arr[0] >= ADMIN_RL_WINDOW_MS) arr.shift();
  if (arr.length >= ADMIN_RL_MAX) return false;
  arr.push(now);
  return true;
}

// Periodically prune empty buckets to keep the map bounded.
setInterval(() => {
  const now = Date.now();
  for (const [ip, arr] of adminAttempts) {
    while (arr.length && now - arr[0] >= ADMIN_RL_WINDOW_MS) arr.shift();
    if (arr.length === 0) adminAttempts.delete(ip);
  }
}, ADMIN_RL_WINDOW_MS).unref?.();

function adminAuth(req, res, next) {
  if (!ADMIN_KEY) {
    return res.status(503).json({ ok: false, error: 'admin_disabled', message: 'ADMIN_KEY not configured' });
  }
  const ip = getClientIp(req) || 'unknown';
  if (!checkAdminRateLimit(ip)) {
    console.warn('[ADMIN] rate-limit blocked ip=' + ip);
    return res.status(429).json({ ok: false, error: 'rate_limited', message: 'Trop de requêtes, réessayez plus tard.' });
  }
  const k = req.headers['x-admin-key'] || req.query.key || '';
  if (k !== ADMIN_KEY) return res.status(403).json({ ok: false, error: 'forbidden' });
  next();
}

app.post('/api/setChallengeMode', (req, res) => {
  const sid = String(req.body.sid || req.query.sid || '');
  const challenge = req.body.challenge === true || req.body.challenge === 'true' || req.query.challenge === 'true';
  if (sid && sessions[sid]) {
    sessions[sid].challengeMode = challenge;
  }
  res.json({ ok: true, challenge });
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/api/admin/users', adminAuth, async (req, res) => {
  if (!process.env.DATABASE_URL) return res.json([]);
  try {
    const rows = await db.listAllUsers();
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/users/:username', adminAuth, async (req, res) => {
  const u = req.params.username;
  if (!process.env.DATABASE_URL) return res.status(404).json({ error: 'no db' });
  try {
    const row = await db.findUserByUsername(u);
    if (!row) return res.status(404).json({ error: 'not found' });
    const items = await db.getUserItems(row.id);
    const accs = await db.getUserAccessories(row.id);
    const scores = await db.loadScoresForUser(row.id);
    let gameItems = (users[u] && Array.isArray(users[u].gameItems)) ? users[u].gameItems : null;
    if (!gameItems) {
      try { gameItems = await db.getUserGameItems(row.id) || []; } catch { gameItems = []; }
    }
    res.json({ user: row, items, accessories: accs, scores, gameItems });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/users/:username', adminAuth, async (req, res) => {
  const u = req.params.username;
  if (!process.env.DATABASE_URL) return res.status(400).json({ error: 'no db' });
  try {
    const row = await db.findUserByUsername(u);
    if (!row) return res.status(404).json({ error: 'not found' });
    await db.deleteUser(row.id);
    if (users[u]) delete users[u];
    for (const [sid, s] of Object.entries(sessions)) {
      if (s.user === u) delete sessions[sid];
    }
    if (scoresData.users[u]) delete scoresData.users[u];
    saveScoresFile();
    delete bouilleCache[u];
    console.log(`[ADMIN] Deleted user: ${u}`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Wipe a single game's FrutiCard slot data for one user (DB + in-memory).
// The SWF will hit formatFruticard on next load. Useful for clearing
// pathological/corrupted slots (e.g. minipixiz scalar-field cycle).
app.post('/api/admin/users/:username/reset-game-slot/:game', adminAuth, async (req, res) => {
  const u = req.params.username;
  const game = String(req.params.game || '').trim();
  if (!game) return res.status(400).json({ error: 'game required' });
  if (!process.env.DATABASE_URL) return res.status(400).json({ error: 'no db' });
  try {
    const row = await db.findUserByUsername(u);
    if (!row) return res.status(404).json({ error: 'not found' });
    await db.deleteFrutiSlotsForGame(row.id, game);
    if (users[u] && users[u].frutiSlots && users[u].frutiSlots[game]) {
      delete users[u].frutiSlots[game];
    }
    console.log(`[ADMIN] Reset ${game} slots for user ${u}`);
    res.json({ ok: true, username: u, game });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────
// ENDPOINT: /api/admin/users/:username/import-slots/:game — Migrate progression
// from another Frutiengine instance.
//
// Body: { slots: { "0": <json|obj>, "1": <json|obj>, ... } }
//       or { data: <json|obj> } as shorthand for slot 0.
//
// Per-game merge: for games where progression is monotonic (snake3 fruits,
// records / minipixiz items, faeries, counters) we take max() / OR per field
// so an admin import never regresses what the player already did on this
// instance. For other games we currently fall back to "incoming wins" —
// extend mergeImportedSlot when adding them.
//
// Pictos: re-runs extractGameItemsFromSlot on the merged slot 0 so unlocks
// derived from the imported data (e.g. snake3 fruits ≥ 20, minipixiz items
// flagged true in $stat.$item) are granted.
//
// Scores: NOT pushed to any ranking. The historical record stays in the
// merged slot 0 (e.g. snake3 $record, minipixiz $stat.$treeMax) and the SWF
// reads it locally as the player's personal best. The "Classique" rankings
// (snake3_classic, mb2_classic, …) are in DAILY_RESET_RANKING_SET — they
// represent today's competition, not all-time bests, so pushing a 2-year-old
// import there would steal medals and get cleared at midnight. Use
// PATCH /api/admin/scores/:user/:ranking afterwards to backfill manually.
// ─────────────────────────────────────────────
function mergeImportedSlot(game, slotId, existingJson, incomingObj) {
  if (!incomingObj || typeof incomingObj !== 'object' || Array.isArray(incomingObj)) {
    throw new Error(`incoming slot ${slotId} must be a JSON object, got ${incomingObj === null ? 'null' : typeof incomingObj}`);
  }
  if (game === 'snake3' && slotId === 0) {
    let existing = {};
    if (existingJson) {
      try {
        const parsed = JSON.parse(existingJson);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) existing = parsed;
      } catch { /* keep {} */ }
    }
    const eFruits = Array.isArray(existing.$fruits) ? existing.$fruits : [];
    const iFruits = Array.isArray(incomingObj.$fruits) ? incomingObj.$fruits : [];
    const len = Math.max(eFruits.length, iFruits.length);
    const fruits = new Array(len);
    for (let i = 0; i < len; i++) {
      const a = eFruits[i], b = iFruits[i];
      const aNum = (a == null) ? -1 : Number(a);
      const bNum = (b == null) ? -1 : Number(b);
      const m = Math.max(aNum, bNum);
      fruits[i] = (m < 0) ? null : m;
    }
    return {
      $record: Math.max(Number(existing.$record) || 0, Number(incomingObj.$record) || 0),
      $fruits: fruits,
    };
  }

  // MiniPixiz / MiniTroll slot 0: mirror the per-field merge rules already
  // applied in /api/saveFrutiSlot's forward-merge guard so an import follows
  // the same "progress is monotonic" semantics as a normal save: scalars and
  // counters take max(), $stat.$item is OR-ed, $eat/$kill/$game are
  // element-wise max, nested progress containers ($faerie, $dungeon, $pond,
  // $rainbow, $frog) keep prev when it's strictly better.
  if ((game === 'minipixiz' || game === 'minitroll') && slotId === 0) {
    let existing = {};
    if (existingJson) {
      try {
        const parsed = JSON.parse(existingJson);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) existing = parsed;
      } catch { /* keep {} */ }
    }
    if (!incomingObj || typeof incomingObj !== 'object' || Array.isArray(incomingObj)) {
      throw new Error('incoming slot 0 must be a JSON object');
    }
    const merged = JSON.parse(JSON.stringify(incomingObj));
    if (!merged.$stat || typeof merged.$stat !== 'object' || Array.isArray(merged.$stat)) merged.$stat = {};
    const eStat = (existing.$stat && typeof existing.$stat === 'object' && !Array.isArray(existing.$stat)) ? existing.$stat : {};

    for (const k of ['$run', '$forestMax', '$treeMax', '$misNum']) {
      const ev = Number(eStat[k]) || 0;
      const nv = Number(merged.$stat[k]) || 0;
      if (ev > nv) merged.$stat[k] = ev;
    }
    for (const k of ['$diam', '$key', '$star', '$bag']) {
      const ev = Number(existing[k]) || 0;
      const nv = Number(merged[k]) || 0;
      if (ev > nv) merged[k] = ev;
    }
    const eItem = Array.isArray(eStat.$item) ? eStat.$item : [];
    const nItem = Array.isArray(merged.$stat.$item) ? merged.$stat.$item : [];
    if (eItem.length || nItem.length) {
      const len = Math.max(eItem.length, nItem.length);
      const out = new Array(len);
      for (let i = 0; i < len; i++) out[i] = Boolean(eItem[i]) || Boolean(nItem[i]);
      merged.$stat.$item = out;
    }
    for (const k of ['$eat', '$kill', '$game']) {
      const ev = Array.isArray(eStat[k]) ? eStat[k] : [];
      const nv = Array.isArray(merged.$stat[k]) ? merged.$stat[k] : [];
      if (ev.length || nv.length) {
        const len = Math.max(ev.length, nv.length);
        const out = new Array(len).fill(0);
        for (let i = 0; i < len; i++) {
          out[i] = Math.max(Number(ev[i]) || 0, Number(nv[i]) || 0);
        }
        merged.$stat[k] = out;
      }
    }
    // Faerie merge — same per-field strategy as saveFrutiSlot's
    // forward-merge: when both sides have the same fairy slot, incoming
    // wins per field, but anything missing falls back to existing.
    // Symmetric to saveSlot/parseMinipixizPipe: the SWF only ever sends
    // {$level: N} stubs, so a re-import after gameplay restores the
    // rich fields (name/skin/spells/carac/inv/taste/etc.) while still
    // honouring the imported levels.
    const ef = Array.isArray(existing.$faerie) ? existing.$faerie : [];
    const nf = Array.isArray(merged.$faerie) ? merged.$faerie : [];
    if (ef.length > nf.length) {
      merged.$faerie = ef;
    } else if (nf.length > 0 && ef.length > 0) {
      const out = [];
      for (let i = 0; i < nf.length; i++) {
        const e = ef[i];
        const n = nf[i];
        if (e && typeof e === 'object' && !Array.isArray(e) &&
            n && typeof n === 'object' && !Array.isArray(n)) {
          out.push(Object.assign({}, e, n));
        } else {
          out.push(n || e);
        }
      }
      merged.$faerie = out;
    }
    // Same fill-in-missing approach for nested progress containers.
    if (existing.$dungeon && typeof existing.$dungeon === 'object') {
      if (!merged.$dungeon || typeof merged.$dungeon !== 'object') merged.$dungeon = {};
      if (Number(existing.$dungeon.$lvl) > Number(merged.$dungeon.$lvl || 0)) {
        merged.$dungeon = Object.assign({}, existing.$dungeon, merged.$dungeon);
      }
      if (merged.$dungeon.$day  === undefined && existing.$dungeon.$day  !== undefined) merged.$dungeon.$day  = existing.$dungeon.$day;
      if (merged.$dungeon.$loop === undefined && existing.$dungeon.$loop !== undefined) merged.$dungeon.$loop = existing.$dungeon.$loop;
    }
    if (existing.$pond && typeof existing.$pond === 'object') {
      if (!merged.$pond || typeof merged.$pond !== 'object') merged.$pond = {};
      if (Number(existing.$pond.$q) > Number(merged.$pond.$q || 0)) {
        merged.$pond = Object.assign({}, existing.$pond, merged.$pond);
      }
      if (merged.$pond.$d  === undefined && existing.$pond.$d  !== undefined) merged.$pond.$d  = existing.$pond.$d;
      if (merged.$pond.$fs === undefined && existing.$pond.$fs !== undefined) merged.$pond.$fs = existing.$pond.$fs;
    }
    if (existing.$rainbow && typeof existing.$rainbow === 'object') {
      if (!merged.$rainbow || typeof merged.$rainbow !== 'object') merged.$rainbow = {};
      if (existing.$rainbow.$f && !merged.$rainbow.$f) {
        merged.$rainbow = Object.assign({}, existing.$rainbow, merged.$rainbow);
      }
      if (merged.$rainbow.$day === undefined && existing.$rainbow.$day !== undefined) merged.$rainbow.$day = existing.$rainbow.$day;
      if (merged.$rainbow.$it  === undefined && existing.$rainbow.$it  !== undefined) merged.$rainbow.$it  = existing.$rainbow.$it;
    }
    for (const k of ['$mission', '$mis', '$help', '$time', '$god', '$wind']) {
      if (merged[k] === undefined && existing[k] !== undefined) merged[k] = existing[k];
    }
    if (existing.$frog && !merged.$frog) merged.$frog = true;
    return merged;
  }

  // Default: incoming overwrites. Add per-game branches as more games go live.
  return incomingObj;
}

app.post('/api/admin/users/:username/import-slots/:game', adminAuth, async (req, res) => {
  try {
    const username = req.params.username;
    const game = String(req.params.game || '').trim();
    if (!game) return res.status(400).json({ error: 'game required' });

    let slots = {};
    if (req.body) {
      if (req.body.slots && typeof req.body.slots === 'object' && !Array.isArray(req.body.slots)) {
        slots = req.body.slots;
      } else if (req.body.data !== undefined) {
        slots = { 0: req.body.data };
      }
    }
    if (Object.keys(slots).length === 0) {
      return res.status(400).json({ error: 'missing slots or data in body' });
    }

    const memUser = users[username];
    let dbId = memUser ? memUser._dbId : null;
    if (!dbId && process.env.DATABASE_URL) {
      try {
        const row = await db.findUserByUsername(username);
        if (row) dbId = row.id;
      } catch (e) {
        console.error(`[IMPORT] findUserByUsername failed for ${username}: ${e.message}`);
      }
    }
    if (!dbId && !memUser) return res.status(404).json({ error: 'user not found' });

    let existing = {};
    if (dbId) {
      try { existing = await db.getFrutiSlots(dbId, game); }
      catch (e) {
        console.error(`[IMPORT] getFrutiSlots(${dbId},${game}) failed for ${username}: ${e.message}`);
        existing = {};
      }
    } else if (memUser && memUser.frutiSlots && memUser.frutiSlots[game]) {
      existing = memUser.frutiSlots[game];
    }

    const report = { ok: true, username, game, slots: [], pictosGranted: 0 };
    let mergedSlot0Json = null;

    for (const [slotIdStr, incomingRaw] of Object.entries(slots)) {
      const slotId = Number(slotIdStr);
      if (!Number.isInteger(slotId) || slotId < 0 || slotId > 9) {
        report.slots.push({ slotId: slotIdStr, status: 'invalid_id' });
        continue;
      }
      let incomingObj;
      if (typeof incomingRaw === 'string') {
        try { incomingObj = JSON.parse(incomingRaw); }
        catch (e) { report.slots.push({ slotId, status: 'invalid_json', error: e.message }); continue; }
      } else if (incomingRaw && typeof incomingRaw === 'object') {
        incomingObj = incomingRaw;
      } else {
        report.slots.push({ slotId, status: 'invalid_type' }); continue;
      }

      const existingJson = existing[String(slotId)] || existing[slotId] || null;
      let merged;
      try { merged = mergeImportedSlot(game, slotId, existingJson, incomingObj); }
      catch (e) {
        console.error(`[IMPORT] merge failed for ${username}/${game}/${slotId}: ${e.message}`);
        report.slots.push({ slotId, status: 'merge_error', error: e.message });
        continue;
      }
      const mergedJson = JSON.stringify(merged);
      if (slotId === 0) mergedSlot0Json = mergedJson;

      if (dbId) {
        try { await db.upsertFrutiSlot(dbId, game, slotId, mergedJson); }
        catch (e) {
          console.error(`[IMPORT] upsertFrutiSlot failed for ${username}/${game}/${slotId}: ${e.message}`);
          report.slots.push({ slotId, status: 'db_error', error: e.message });
          continue;
        }
      }

      if (memUser) {
        if (!memUser.frutiSlots) memUser.frutiSlots = {};
        if (!memUser.frutiSlots[game]) memUser.frutiSlots[game] = {};
        memUser.frutiSlots[game][String(slotId)] = mergedJson;
      }
      report.slots.push({ slotId, status: 'imported', size: mergedJson.length, mergedWithExisting: !!existingJson });
    }

    if (mergedSlot0Json) {
      try {
        let existingItems = [];
        if (dbId) {
          try { existingItems = await db.getUserGameItems(dbId); } catch (e) {
            console.error(`[IMPORT] getUserGameItems failed for ${username}: ${e.message}`);
          }
        } else if (memUser && Array.isArray(memUser.gameItems)) {
          existingItems = memUser.gameItems.slice();
        }
        const localUser = { gameItems: [...existingItems], _dbId: dbId };
        extractGameItemsFromSlot(username, game, mergedSlot0Json, { silent: true, userOverride: localUser });
        report.pictosGranted = localUser.gameItems.length - existingItems.length;
        if (memUser && Array.isArray(memUser.gameItems)) {
          for (const item of localUser.gameItems) {
            if (!memUser.gameItems.includes(item)) memUser.gameItems.push(item);
          }
        }
      } catch (e) {
        console.error(`[IMPORT] picto extraction failed for ${username}/${game}: ${e.message}`);
      }
    }

    // No automatic ranking push. The historical record stays in slot 0's
    // $record (snake3) / equivalent field — the SWF reads it on game start
    // and shows it as the player's personal best in-game. Pushing into the
    // "Classique" ranking is undesirable because that ranking is in the
    // DAILY_RESET_RANKING_SET (server.js:1918): a fresh import would put
    // the old score into today's competition leaderboard, win medals it
    // didn't earn, and get cleared at midnight. The admin can use
    // PATCH /api/admin/scores/:user/:ranking afterwards if they want to
    // backfill a specific score.

    console.log(`[ADMIN] import-slots ${username}/${game}: slots=${report.slots.length} pictos=+${report.pictosGranted}`);
    res.json(report);
  } catch (e) {
    console.error(`[IMPORT] unhandled error: ${e.stack || e.message}`);
    res.status(500).json({ ok: false, error: e.message, stack: process.env.NODE_ENV === 'production' ? undefined : (e.stack || '').split('\n').slice(0, 6).join('\n') });
  }
});

// Diagnostic: force an arbitrary internal-status code (sprite 246 frame
// number, 0..36) on a user's broadcast presence so the icon at that frame
// can be observed in chat / userlist / contact card. Lets us discover which
// frame holds each game's icon when the StatusMng FrameLabels in
// legacy/main.swf no longer match the visual content placed on each frame.
// Usage: POST /api/admin/users/:username/set-internal/:n   (n = 0..36)
app.post('/api/admin/users/:username/set-internal/:n', adminAuth, (req, res) => {
  const u = req.params.username;
  const n = Number(req.params.n);
  if (!Number.isFinite(n) || n < 0 || n > 99) {
    return res.status(400).json({ error: 'n must be 0..99' });
  }
  if (!users[u]) return res.status(404).json({ error: 'user not in memory (must be online)' });
  setUserInternalStatus(u, n);
  console.log(`[ADMIN] set-internal ${u} → ${n}`);
  res.json({ ok: true, username: u, internal: n });
});

// Diagnostic: emit a transient <newuserlog> / <newsitelog> with an arbitrary
// `type` so the icon the SWF renders for that type (sprite 533 frame) can be
// observed in the user's "Mon historique" or "Événements" desktop windows.
// Does NOT persist to DB or to user.userLog/siteLog — pure broadcast.
// Usage: POST /api/admin/users/:username/test-log-icon/:type?kind=user|site
app.post('/api/admin/users/:username/test-log-icon/:type', adminAuth, (req, res) => {
  const u = req.params.username;
  const t = Number(req.params.type);
  const kind = (req.query.kind === 'site') ? 'site' : 'user';
  if (!Number.isFinite(t) || t < 0 || t > 999) {
    return res.status(400).json({ error: 'type must be 0..999' });
  }
  if (!users[u]) return res.status(404).json({ error: 'user not in memory (must be online)' });
  const sockets = getSocketsForUsername(u);
  if (sockets.length === 0) return res.status(409).json({ error: 'user has no active chat socket' });
  const cmd = (kind === 'site') ? CMD.newsitelog : CMD.newuserlog;
  const xml = `<${cmd} date="${escapeXml(nowSqlTimestamp())}" type="${t}">${escapeXml(`[scan icon type=${t}]`)}</${cmd}>`;
  for (const sock of sockets) sendToClient(sock, xml);
  console.log(`[ADMIN] test-log-icon ${u} kind=${kind} type=${t} → ${sockets.length} socket(s)`);
  res.json({ ok: true, username: u, kind, type: t, sockets: sockets.length });
});

// Bulk-delete users created on a given Paris-local date.
// Query params:
//   date     YYYY-MM-DD (required)
//   exclude  comma-separated usernames to keep (case-insensitive, default empty)
// GET previews; DELETE actually removes.  CASCADE drops dependent rows.
async function selectUsersByParisDate(date, excludeList) {
  const { rows } = await db.pool.query(
    `SELECT id, username, created_at
     FROM users
     WHERE (created_at AT TIME ZONE 'Europe/Paris')::date = $1
       AND LOWER(username) <> ALL($2)
     ORDER BY created_at ASC`,
    [date, excludeList]
  );
  return rows;
}

app.get('/api/admin/users-by-date', adminAuth, async (req, res) => {
  if (!process.env.DATABASE_URL) return res.status(400).json({ error: 'no db' });
  const date = String(req.query.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  }
  const exclude = String(req.query.exclude || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  try {
    const rows = await selectUsersByParisDate(date, exclude);
    res.json({
      ok: true,
      date,
      exclude,
      count: rows.length,
      users: rows.map((r) => ({
        id: r.id,
        username: r.username,
        created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
      })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/users-by-date', adminAuth, async (req, res) => {
  if (!process.env.DATABASE_URL) return res.status(400).json({ error: 'no db' });
  const date = String(req.query.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  }
  const exclude = String(req.query.exclude || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  try {
    const rows = await selectUsersByParisDate(date, exclude);
    const usernames = rows.map((r) => r.username);
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) {
      return res.json({ ok: true, deleted: 0, usernames: [] });
    }
    const r = await db.pool.query('DELETE FROM users WHERE id = ANY($1)', [ids]);
    // Mirror cleanup in the in-memory caches
    for (const u of usernames) {
      if (users[u]) delete users[u];
      for (const [sid, s] of Object.entries(sessions)) {
        if (s.user === u) delete sessions[sid];
      }
      if (scoresData.users[u]) delete scoresData.users[u];
      delete bouilleCache[u];
    }
    saveScoresFile();
    console.log(`[ADMIN] Bulk-deleted ${r.rowCount} users for date ${date}: ${usernames.join(', ')}`);
    res.json({ ok: true, deleted: r.rowCount, usernames });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/admin/users/:username', adminAuth, async (req, res) => {
  const u = req.params.username;
  if (!process.env.DATABASE_URL) return res.status(400).json({ error: 'no db' });
  try {
    const row = await db.findUserByUsername(u);
    if (!row) return res.status(404).json({ error: 'not found' });
    const fields = {};
    const body = req.body || {};
    if (body.fbouille !== undefined) { fields.fbouille = body.fbouille; bouilleCache[u] = body.fbouille; }
    if (body.xp !== undefined) fields.xp = Number(body.xp);
    if (body.kikooz !== undefined) fields.kikooz = Number(body.kikooz);
    if (body.password !== undefined) {
      fields.password = await hashPassword(String(body.password));
      if (users[u]) users[u].pass = fields.password;
    }
    if (body.is_moderator !== undefined) fields.is_moderator = !!body.is_moderator;
    if (body.is_animator !== undefined) fields.is_animator = !!body.is_animator;
    if (body.display_name !== undefined) {
      const dn = String(body.display_name).trim();
      if (!isValidUsername(dn)) {
        return res.status(400).json({ error: 'Pseudo invalide : 3-20 caractères [a-zA-Z0-9_], pas d\'accents.' });
      }
      if (dn.toLowerCase() !== u.toLowerCase()) {
        return res.status(400).json({ error: 'Le pseudo doit correspondre au même identifiant (même lettres, casse différente autorisée).' });
      }
      fields.display_name = dn;
    }
    if (body.fruti_sign !== undefined) {
      const v = Number(body.fruti_sign);
      fields.fruti_sign = (v >= 0 && v <= 9) ? v : -1;
    }
    if (body.fruti_sign_b !== undefined) {
      const v = Number(body.fruti_sign_b);
      fields.fruti_sign_b = (v >= 0 && v <= 9) ? v : -1;
    }
    if (body.real_job !== undefined) {
      fields.real_job = String(body.real_job || '').slice(0, 80);
    }
    if (body.frutijob !== undefined) {
      fields.frutijob = String(body.frutijob || '').slice(0, 80);
    }
    // Auto-set frutijob when promoting to moderator/animator
    if (fields.is_moderator === true && body.frutijob === undefined) {
      const gender = (users[u] && users[u].gender) || row.gender || 'M';
      fields.frutijob = gender === 'F' ? 'Modératrice' : 'Modérateur';
    }
    if (fields.is_animator === true && !fields.is_moderator && body.frutijob === undefined) {
      const gender = (users[u] && users[u].gender) || row.gender || 'M';
      fields.frutijob = gender === 'F' ? 'Animatrice' : 'Animateur';
    }
    if (Object.keys(fields).length > 0) {
      await db.updateUser(u, fields);
      if (users[u]) {
        Object.assign(users[u], fields);
        if (fields.is_moderator !== undefined) users[u].isModerator = fields.is_moderator;
        if (fields.is_animator !== undefined) users[u].isAnimator = fields.is_animator;
        if (fields.display_name !== undefined) users[u].displayName = fields.display_name;
        if (fields.fruti_sign !== undefined) users[u].frutiSign = fields.fruti_sign;
        if (fields.fruti_sign_b !== undefined) users[u].frutiSignB = fields.fruti_sign_b;
        if (fields.real_job !== undefined) users[u].realJob = fields.real_job;
        if (fields.frutijob !== undefined) users[u].frutijob = fields.frutijob;
      }
      if (fields.is_moderator !== undefined) {
        if (fields.is_moderator) await grantModeratorAccessory(u, row);
        else await revokeModeratorAccessory(u, row);
      }
      if (fields.is_animator !== undefined) {
        if (fields.is_animator) await grantAnimatorAccessory(u, row);
        else await revokeAnimatorAccessory(u, row);
      }
    }
    console.log(`[ADMIN] Updated user ${u}: ${Object.keys(fields).join(', ')}`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ───────────── Admin: Gaspard help topics CRUD ─────────────
// Endpoint set for managing the in-game help content Gaspard serves.
// All routes require adminAuth (which already rate-limits and rejects
// when ADMIN_KEY is unset). Topic shape:
//   { id, title, body, parent_id, sort_order, keywords }
// parent_id = null means "top-level entry shown in the help index";
// nested entries become sub-topics under their parent. sort_order is
// the display position within a parent. keywords feeds the in-game
// search box (space-separated tokens; matching is server-side).

app.get('/api/admin/gaspard/topics', adminAuth, async (req, res) => {
  try {
    const rows = await db.listGaspardHelpTopics();
    res.json({ topics: rows });
  } catch (e) {
    console.error('[ADMIN-AIDE] list error:', e.message);
    res.status(500).json({ error: 'list_failed' });
  }
});

app.get('/api/admin/gaspard/topics/:id', adminAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad_id' });
  try {
    const row = await db.getGaspardHelpTopic(id);
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json({ topic: row });
  } catch (e) {
    console.error('[ADMIN-AIDE] get error:', e.message);
    res.status(500).json({ error: 'get_failed' });
  }
});

app.post('/api/admin/gaspard/topics', adminAuth, async (req, res) => {
  const { title, body, parent_id, sort_order, keywords, is_index } = req.body || {};
  if (!title || typeof title !== 'string' || title.trim() === '') {
    return res.status(400).json({ error: 'title_required' });
  }
  try {
    const row = await db.createGaspardHelpTopic({
      title: String(title).trim(),
      body: typeof body === 'string' ? body : '',
      parent_id: parent_id != null ? parseInt(parent_id, 10) : null,
      sort_order: sort_order != null ? parseInt(sort_order, 10) : 0,
      keywords: typeof keywords === 'string' ? keywords : '',
      is_index: !!is_index,
    });
    res.status(201).json({ topic: row });
  } catch (e) {
    console.error('[ADMIN-AIDE] create error:', e.message);
    res.status(500).json({ error: 'create_failed', detail: e.message });
  }
});

app.put('/api/admin/gaspard/topics/:id', adminAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad_id' });
  const { title, body, parent_id, sort_order, keywords, is_index } = req.body || {};
  try {
    const row = await db.updateGaspardHelpTopic(id, {
      title: title !== undefined ? String(title) : null,
      body: body !== undefined ? String(body) : null,
      parent_id: parent_id !== undefined ? (parent_id == null ? null : parseInt(parent_id, 10)) : null,
      sort_order: sort_order !== undefined ? parseInt(sort_order, 10) : null,
      keywords: keywords !== undefined ? String(keywords) : null,
      is_index: is_index !== undefined ? !!is_index : undefined,
    });
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json({ topic: row });
  } catch (e) {
    console.error('[ADMIN-AIDE] update error:', e.message);
    res.status(500).json({ error: 'update_failed', detail: e.message });
  }
});

app.delete('/api/admin/gaspard/topics/:id', adminAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad_id' });
  try {
    const ok = await db.deleteGaspardHelpTopic(id);
    if (!ok) return res.status(404).json({ error: 'not_found' });
    res.json({ deleted: true });
  } catch (e) {
    console.error('[ADMIN-AIDE] delete error:', e.message);
    res.status(500).json({ error: 'delete_failed', detail: e.message });
  }
});

// ───────── Public Gaspard help endpoints (consumed by main.swf) ─────────
// The SWF's win.box.Help class calls two URLs (discovered by string-matching
// the compiled SWF):
//   /fh/search?s=<query>   — text search across topics
//   /fh/get?i=<id>         — fetch a single topic's body + sub-links
// Response is XML. Format reverse-engineered from the parser strings:
//   firstChild.attributes.n/nb/m/list/nextSibling for search,
//   c.nodeValue + l.id.content.links.back for get.

function escapeXmlText(s) {
  return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function gaspardTopicLinksXml(parentId, allTopics) {
  // Children of `parentId` (or root entries when parentId is null) ordered
  // by sort_order. Each emitted as <l id="N">Title</l> per the SWF's
  // displayContent path which reads l.id and l.firstChild.nodeValue.
  const children = allTopics
    .filter((t) => (t.parent_id || null) === (parentId || null))
    .sort((a, b) => (a.sort_order - b.sort_order) || (a.id - b.id));
  return children.map((c) =>
    `<l id="${c.id}">${escapeXmlText(c.title)}</l>`
  ).join('');
}

// Format the topic body for the SWF's TextField. CDATA wrapping makes
// the body a single text-node child of <c>, so c.firstChild.nodeValue
// resolves cleanly regardless of HTML markup inside. Entity-encoded
// content didn't render in-game in an earlier attempt — likely because
// the SWF reads c.firstChild.nodeValue and Ruffle's entity decoding in
// that path is partial; CDATA bypasses the issue.
function gaspardBodyXml(body) {
  const raw = String(body || '');
  // Split on the CDATA close marker and re-wrap each fragment so the
  // payload stays well-formed even if a user types `]]>` in the body.
  const parts = raw.split(']]>');
  return parts.map((p) => `<![CDATA[${p}]]>`).join(']]&gt;');
}

// The SWF asks for /fh/get?i=1 every time the help window opens. In the
// original Frutiparc DB id=1 was the welcome topic, but ours auto-assigns
// SERIAL ids — so we treat "i=1" as "open the home page" and route it to
// whichever topic the admin has flagged as is_index, regardless of id.
const GASPARD_HOME_ID = 1;

app.all(['/fh/get', '/legacy/fh/get'], async (req, res) => {
  const params = Object.assign({}, req.query || {}, req.body || {});
  const idRaw = params.i || params.k || params.id || '';
  const id = parseInt(String(idRaw), 10);
  console.log(`[GASPARD] /fh/get method=${req.method} idRaw=${JSON.stringify(idRaw)} parsedId=${Number.isInteger(id) ? id : '(none)'} q=${JSON.stringify(req.query)} b=${JSON.stringify(req.body || {})}`);
  try {
    const all = await db.listGaspardHelpTopics();
    const buildLinksXml = (parentId, container) => {
      // Build a <cat_tree> (root) or <cat_ls> (children) container. Children
      // are filtered by parent_id and ordered by (sort_order, id). The SWF
      // determines link type from the container element name and reads
      // l.id + l.n (the title) — no text content inside <l>.
      const children = all
        .filter((t) => (t.parent_id || null) === (parentId || null))
        .sort((a, b) => (a.sort_order - b.sort_order) || (a.id - b.id));
      if (children.length === 0) return '';
      const items = children.map((c) =>
        `<l id="${c.id}" n="${escapeXmlText(c.title)}"/>`
      ).join('');
      return `<${container}>${items}</${container}>`;
    };

    const indexTopic = all.find((t) => t.is_index) || null;
    const isHomeRequest = !Number.isInteger(id) || id <= 0 || id === GASPARD_HOME_ID;

    // Pick the topic to display. Priority:
    //   1. Explicit id > GASPARD_HOME_ID → that exact topic (with cat_tree
    //      still emitted so the user can navigate elsewhere).
    //   2. "Home" trigger (no id, id<=0, or the magic id=1 that the SWF
    //      sends on open) → the is_index topic if any, else synthetic.
    //   3. Explicit id == GASPARD_HOME_ID and no is_index topic → fall back
    //      to topic id=1 in DB if it exists, else synthetic welcome.
    let topic = null;
    if (isHomeRequest) {
      topic = indexTopic || all.find((t) => t.id === GASPARD_HOME_ID) || null;
    } else {
      topic = all.find((t) => t.id === id) || indexTopic || null;
    }

    // Always include the root category list so the user can navigate back
    // from any topic. cat_ls (children of the current topic) is added only
    // when the topic has sub-rubriques.
    const rootTree = buildLinksXml(null, 'cat_tree');

    if (!topic) {
      // No admin-defined index → emit a generated welcome so the SWF still
      // has something to render with the root nav.
      const indexBody = "Bienvenue ! Choisissez une rubrique ci-dessous, ou utilisez la recherche.";
      return res.type('text/xml').send(
        `<?xml version="1.0" encoding="UTF-8"?>\n<h id="0" n="Index de l'aide"><c>${escapeXmlText(indexBody)}</c>${rootTree}</h>`
      );
    }

    const safeTitle = escapeXmlText(topic.title);
    const backAttr = topic.parent_id != null ? ` back="${topic.parent_id}"` : '';
    const children = buildLinksXml(topic.id, 'cat_ls');
    // For the index topic itself, drop cat_ls (its sub-rubriques would
    // duplicate the cat_tree we already emit) and only show the root nav.
    const navXml = topic.is_index ? rootTree : (children + rootTree);
    return res.type('text/xml').send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<h id="${topic.id}" n="${safeTitle}"${backAttr}><c>${escapeXmlText(topic.body || '')}</c>${navXml}</h>`
    );
  } catch (e) {
    console.error('[GASPARD] /fh/get error:', e.message);
    res.type('text/xml').status(200).send('<?xml version="1.0"?>\n<h n="Erreur">Erreur serveur</h>');
  }
});

app.all(['/fh/search', '/legacy/fh/search'], async (req, res) => {
  const params = Object.assign({}, req.query || {}, req.body || {});
  const query = String(params.s || '').trim().toLowerCase();
  console.log(`[GASPARD] /fh/search method=${req.method} s=${JSON.stringify(query)} q=${JSON.stringify(req.query)} b=${JSON.stringify(req.body || {})}`);
  if (!query) {
    return res.type('text/xml').send('<r n="no_result" nb="0" m="exact"/>');
  }
  try {
    const all = await db.listGaspardHelpTopics();
    const tokens = query.split(/\s+/).filter(Boolean);
    const matchesExact = (t) => {
      const hay = ((t.title || '') + ' ' + (t.keywords || '')).toLowerCase();
      return tokens.every((tok) => hay.includes(tok));
    };
    const matchesSimilar = (t) => {
      const hay = ((t.title || '') + ' ' + (t.keywords || '') + ' ' + (t.body || '')).toLowerCase();
      return tokens.some((tok) => hay.includes(tok));
    };
    let mode = 'exact';
    let hits = all.filter(matchesExact);
    if (hits.length === 0) {
      mode = 'similar';
      hits = all.filter(matchesSimilar);
    }
    if (hits.length === 0) {
      return res.type('text/xml').send('<r n="no_result" nb="0" m="exact"/>');
    }
    // Cover the likely attribute-name variations for the id (id / k / i)
    // and emit the title as both n= attribute and element text so whatever
    // path the SWF takes resolves.
    const items = hits.slice(0, 50)
      .map((t) => `<i id="${t.id}" k="${t.id}" i="${t.id}" n="${escapeXmlText(t.title)}">${escapeXmlText(t.title)}</i>`).join('');
    return res.type('text/xml').send(
      `<r n="result" nb="${hits.length}" m="${mode}">${items}</r>`
    );
  } catch (e) {
    console.error('[GASPARD] /fh/search error:', e.message);
    res.type('text/xml').status(200).send('<r n="no_result" nb="0" m="exact"/>');
  }
});

app.get('/api/admin/scores', adminAuth, (req, res) => {
  const ranking = req.query.ranking || '';
  const result = [];
  for (const [u, rlist] of Object.entries(scoresData.users || {})) {
    if (ranking) {
      if (rlist[ranking]) result.push({ username: u, ranking, score: rlist[ranking].score, data: rlist[ranking].data || '', updatedAt: rlist[ranking].updatedAt || '' });
    } else {
      for (const [rk, entry] of Object.entries(rlist)) {
        result.push({ username: u, ranking: rk, score: entry.score, data: entry.data || '', updatedAt: entry.updatedAt || '' });
      }
    }
  }
  result.sort((a, b) => b.score - a.score);
  res.json({ rankings: Object.keys(RANKINGS), scores: result });
});

app.delete('/api/admin/scores/:username/:ranking', adminAuth, async (req, res) => {
  const { username, ranking } = req.params;
  if (scoresData.users[username]) {
    delete scoresData.users[username][ranking];
    if (Object.keys(scoresData.users[username]).length === 0) delete scoresData.users[username];
    saveScoresFile();
  }
  if (process.env.DATABASE_URL) {
    try {
      const row = await db.findUserByUsername(username);
      if (row) await db.deleteScore(row.id, ranking);
    } catch (e) { console.error(e.message); }
  }
  console.log(`[ADMIN] Deleted score ${username}/${ranking}`);
  res.json({ ok: true });
});

app.patch('/api/admin/scores/:username/:ranking', adminAuth, async (req, res) => {
  const { username, ranking } = req.params;
  const newScore = Number(req.body.score);
  const newData = req.body.data;
  if (!Number.isFinite(newScore)) return res.status(400).json({ error: 'invalid score' });
  if (!scoresData.users[username]) scoresData.users[username] = {};
  const entry = scoresData.users[username][ranking] || {};
  entry.score = newScore;
  if (newData !== undefined) entry.data = String(newData);
  entry.updatedAt = new Date().toISOString();
  scoresData.users[username][ranking] = entry;
  saveScoresFile();
  if (process.env.DATABASE_URL) {
    try {
      const row = await db.findUserByUsername(username);
      if (row) await db.upsertScore(row.id, ranking, newScore, entry.data || '');
    } catch (e) { console.error(e.message); }
  }
  console.log(`[ADMIN] Updated score ${username}/${ranking} = ${newScore}`);
  res.json({ ok: true });
});

app.get('/api/admin/users/:username/accessories', adminAuth, async (req, res) => {
  if (!process.env.DATABASE_URL) return res.json([]);
  try {
    const row = await db.findUserByUsername(req.params.username);
    if (!row) return res.status(404).json({ error: 'not found' });
    res.json(await db.getUserAccessories(row.id));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/users/:username/accessories', adminAuth, async (req, res) => {
  if (!process.env.DATABASE_URL) return res.status(400).json({ error: 'no db' });
  try {
    const row = await db.findUserByUsername(req.params.username);
    if (!row) return res.status(404).json({ error: 'not found' });
    const acc = { id: req.body.id || `admin_${Date.now()}`, shopId: req.body.shopId || 0, n: req.body.name || '', v: req.body.value || '', q: req.body.quantity || '1', p: req.body.price || '0' };
    await db.addAccessory(row.id, acc);
    if (users[req.params.username]) {
      users[req.params.username].customAccessories = await db.getUserAccessories(row.id);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/users/:username/accessories/:accRowId', adminAuth, async (req, res) => {
  if (!process.env.DATABASE_URL) return res.status(400).json({ error: 'no db' });
  try {
    await db.deleteAccessory(req.params.accRowId);
    const row = await db.findUserByUsername(req.params.username);
    if (row && users[req.params.username]) {
      users[req.params.username].customAccessories = await db.getUserAccessories(row.id);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/users/:username/items', adminAuth, async (req, res) => {
  if (!process.env.DATABASE_URL) return res.json([]);
  try {
    const row = await db.findUserByUsername(req.params.username);
    if (!row) return res.status(404).json({ error: 'not found' });
    res.json(await db.getUserItems(row.id));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/users/:username/items', adminAuth, async (req, res) => {
  if (!process.env.DATABASE_URL) return res.status(400).json({ error: 'no db' });
  try {
    const row = await db.findUserByUsername(req.params.username);
    if (!row) return res.status(404).json({ error: 'not found' });
    const itemId = Number(req.body.itemId);
    if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'invalid itemId' });
    await db.addItem(row.id, itemId);
    if (users[req.params.username]) {
      users[req.params.username].items = withDefaultPens(await db.getUserItems(row.id));
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/users/:username/items/:itemId', adminAuth, async (req, res) => {
  if (!process.env.DATABASE_URL) return res.status(400).json({ error: 'no db' });
  try {
    const row = await db.findUserByUsername(req.params.username);
    if (!row) return res.status(404).json({ error: 'not found' });
    await db.deleteItem(row.id, Number(req.params.itemId));
    if (users[req.params.username]) {
      users[req.params.username].items = withDefaultPens(await db.getUserItems(row.id));
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────
// Picto image endpoint — serves GIF images for collected game items
// ─────────────────────────────────────────────
app.get('/api/picto/:itemName', (req, res) => {
  const itemName = decodeURIComponent(req.params.itemName);
  const gifPath = resolveGameItemGif(itemName);
  if (!gifPath) return res.status(404).send('Not found');
  res.type('image/gif').sendFile(gifPath);
});

// List all available pictos (for forum picto picker)
app.get('/api/pictos', (req, res) => {
  const sid = getSidFromRequest(req, req.query);
  const username = resolveUsernameFromSid(sid);
  console.log(`[PICTOS] /api/pictos sid=${sid ? sid.slice(0,8) + '…' : '(none)'} user=${username || '(none)'} gameItems=${username && users[username] ? (users[username].gameItems || []).length : 'N/A'}`);
  if (!username || !users[username]) return res.json([]);
  const user = users[username];
  const gi = Array.isArray(user.gameItems) ? user.gameItems : [];
  const result = gi.map((itemName) => ({
    id: itemName,
    name: getGameItemDisplayName(itemName),
    game: getGameItemGame(itemName),
    url: `/api/picto/${encodeURIComponent(itemName)}`,
  }));
  res.json(result);
});

// Consecration score: percentage of game completion across all enabled games.
app.get('/api/consecration', (req, res) => {
  const sid = getSidFromRequest(req, req.query);
  const username = resolveUsernameFromSid(sid);
  if (!username || !users[username]) return res.json({ overall: 0, games: [], enabledCount: 0, perGameMax: 0 });
  res.json(computeConsecration(username));
});

// Admin: list user's game items
app.get('/api/admin/users/:username/gameitems', adminAuth, async (req, res) => {
  const username = req.params.username;
  const memUser = users[username];
  if (memUser && Array.isArray(memUser.gameItems)) {
    return res.json(memUser.gameItems);
  }
  if (process.env.DATABASE_URL) {
    try {
      const row = await db.findUserByUsername(username);
      if (row) {
        const items = await db.getUserGameItems(row.id);
        return res.json(items || []);
      }
    } catch (e) { /* fall through */ }
  }
  res.status(404).json({ error: 'not found' });
});

// Admin: add a game item to a user (works even if user is offline)
app.post('/api/admin/users/:username/gameitems', adminAuth, async (req, res) => {
  const username = req.params.username;
  const itemName = String(req.body.itemName || '').trim();
  if (!itemName) return res.status(400).json({ error: 'missing itemName' });

  const memUser = users[username];
  let dbId = memUser ? memUser._dbId : null;
  if (!dbId && process.env.DATABASE_URL) {
    try {
      const row = await db.findUserByUsername(username);
      if (row) dbId = row.id;
    } catch (e) { /* ignore */ }
  }
  if (!dbId && !memUser) return res.status(404).json({ error: 'not found' });

  if (memUser) {
    if (!Array.isArray(memUser.gameItems)) memUser.gameItems = [];
    if (!memUser.gameItems.includes(itemName)) memUser.gameItems.push(itemName);
  }
  if (dbId) await db.addGameItem(dbId, itemName).catch(dbErr('addGameItem'));
  const gameItems = memUser ? memUser.gameItems : await db.getUserGameItems(dbId).catch(() => []);
  res.json({ ok: true, gameItems });
});

// Admin: re-extract pictos from a user's saved slot data (idempotent).
// Use to recover items that were unlocked in-game but not registered.
app.post('/api/admin/users/:username/reextractPictos', adminAuth, async (req, res) => {
  const username = req.params.username;
  const memUser = users[username];
  let dbId = memUser ? memUser._dbId : null;
  if (!dbId) {
    try {
      const dbUser = await db.findUserByUsername(username);
      if (dbUser) dbId = dbUser.id;
    } catch (e) { /* ignore */ }
  }
  if (!dbId) return res.status(404).json({ error: 'user not found' });

  let allSlots;
  try { allSlots = await db.getAllFrutiSlots(dbId); } catch (e) { return res.status(500).json({ error: 'slot load failed' }); }
  if (!allSlots || Object.keys(allSlots).length === 0) {
    return res.json({ added: 0, scanned: 0, message: 'no slot data' });
  }

  let existingItems;
  try { existingItems = await db.getUserGameItems(dbId); } catch { existingItems = []; }
  const localUser = { gameItems: existingItems || [], _dbId: dbId };
  const beforeCount = localUser.gameItems.length;
  let scanned = 0;
  for (const game of Object.keys(allSlots)) {
    const s0 = allSlots[game]['0'] || allSlots[game][0];
    if (!s0) continue;
    scanned++;
    try {
      extractGameItemsFromSlot(username, game, s0, { silent: true, userOverride: localUser });
    } catch (e) { /* ignore per-game errors */ }
  }
  const added = localUser.gameItems.length - beforeCount;
  // Sync the in-memory user if loaded
  if (memUser && Array.isArray(memUser.gameItems)) {
    for (const item of localUser.gameItems) {
      if (!memUser.gameItems.includes(item)) memUser.gameItems.push(item);
    }
  }
  res.json({ added, scanned, total: localUser.gameItems.length });
});

// Admin: remove a game item from a user (works even if user is offline)
app.delete('/api/admin/users/:username/gameitems/:itemName', adminAuth, async (req, res) => {
  const username = req.params.username;
  const memUser = users[username];
  const itemName = decodeURIComponent(req.params.itemName);
  let dbId = memUser ? memUser._dbId : null;
  if (!dbId && process.env.DATABASE_URL) {
    try {
      const row = await db.findUserByUsername(username);
      if (row) dbId = row.id;
    } catch (e) { /* ignore */ }
  }
  if (!dbId && !memUser) return res.status(404).json({ error: 'not found' });
  if (memUser && Array.isArray(memUser.gameItems)) {
    const idx = memUser.gameItems.indexOf(itemName);
    if (idx >= 0) memUser.gameItems.splice(idx, 1);
  }
  if (dbId) await db.removeGameItem(dbId, itemName).catch(dbErr('removeGameItem'));
  const gameItems = memUser ? (memUser.gameItems || []) : await db.getUserGameItems(dbId).catch(() => []);
  res.json({ ok: true, gameItems });
});

app.get('/api/admin/availableGameItems', adminAuth, (req, res) => {
  const items = Object.entries(GAME_ITEM_INFO).map(([key, info]) => ({
    id: key, name: info.name, game: info.game,
  }));
  res.json(items);
});

// Admin: MiniWave picto status for a user — shows what they have, what they
// should have based on slot data, and allows bulk-granting missing earned pictos.
app.get('/api/admin/users/:username/miniwave-pictos', adminAuth, async (req, res) => {
  const username = req.params.username.toLowerCase();
  const memUser = users[username];
  let dbId = memUser ? memUser._dbId : null;
  if (!dbId && process.env.DATABASE_URL) {
    try { const row = await db.findUserByUsername(username); if (row) dbId = row.id; } catch {}
  }
  if (!dbId && !memUser) return res.status(404).json({ error: 'user not found' });

  const owned = new Set(memUser && Array.isArray(memUser.gameItems) ? memUser.gameItems : (dbId ? await db.getUserGameItems(dbId).catch(() => []) : []));

  let slotData = null;
  let earned = [];
  if (memUser && memUser.frutiSlots && memUser.frutiSlots.miniwave && memUser.frutiSlots.miniwave['0']) {
    slotData = memUser.frutiSlots.miniwave['0'];
  } else if (dbId) {
    try { const slots = await db.getAllFrutiSlots(dbId); if (slots && slots.miniwave && slots.miniwave['0']) slotData = slots.miniwave['0']; } catch {}
  }

  let parsed = null;
  if (slotData) {
    try { parsed = JSON.parse(slotData); } catch {}
  }
  if (parsed && typeof parsed === 'object') {
    if (Array.isArray(parsed.$ship)) {
      for (let i = 0; i < parsed.$ship.length; i++) { if (parsed.$ship[i]) earned.push('$ship0' + i); }
    }
    if (Array.isArray(parsed.$badsKill)) {
      for (let i = 0; i < parsed.$badsKill.length; i++) { if (parsed.$badsKill[i] >= 200) earned.push('$bads' + i); }
    }
    if (parsed.$arcade && parsed.$arcade.$bestLevel > 0) earned.push('$arcade');
    if (parsed.$cons) {
      if (Array.isArray(parsed.$cons.$bonus)) {
        for (let i = 0; i < parsed.$cons.$bonus.length && i <= 4; i++) { if (parsed.$cons.$bonus[i] >= 100) earned.push('$mis' + i); }
      }
      if (parsed.$cons.$letter >= 100) earned.push('$letter');
    }
    if (Array.isArray(parsed.$shop)) {
      const shopItems = [[10, '$smiley_love'], [11, '$smiley_laugh'], [12, '$smiley_twirl'], [13, '$wpMinistar'], [14, '$wpNostromo']];
      for (const [idx, itemId] of shopItems) { if (parsed.$shop[idx] === 0) earned.push(itemId); }
    }
  }

  const allMwPictos = Object.entries(GAME_ITEM_INFO).filter(([, info]) => info.game === 'MiniWave').map(([id, info]) => ({
    id, name: info.name, owned: owned.has(id), earned: earned.includes(id),
  }));

  const missing = earned.filter(id => !owned.has(id));

  res.json({
    username,
    hasSlotData: !!parsed,
    pictos: allMwPictos,
    earned,
    missing,
    summary: `${owned.size} owned, ${earned.length} earned from slot data, ${missing.length} missing`,
  });
});

// Admin: bulk-grant missing MiniWave pictos for a user based on slot data
app.post('/api/admin/users/:username/miniwave-pictos/grant-earned', adminAuth, async (req, res) => {
  const username = req.params.username.toLowerCase();
  const memUser = users[username];
  let dbId = memUser ? memUser._dbId : null;
  if (!dbId && process.env.DATABASE_URL) {
    try { const row = await db.findUserByUsername(username); if (row) dbId = row.id; } catch {}
  }
  if (!dbId && !memUser) return res.status(404).json({ error: 'user not found' });

  const user = memUser || { gameItems: dbId ? await db.getUserGameItems(dbId).catch(() => []) : [], _dbId: dbId };
  if (!Array.isArray(user.gameItems)) user.gameItems = [];
  const before = user.gameItems.length;

  let slotData = null;
  if (memUser && memUser.frutiSlots && memUser.frutiSlots.miniwave && memUser.frutiSlots.miniwave['0']) {
    slotData = memUser.frutiSlots.miniwave['0'];
  } else if (dbId) {
    try { const slots = await db.getAllFrutiSlots(dbId); if (slots && slots.miniwave && slots.miniwave['0']) slotData = slots.miniwave['0']; } catch {}
  }
  if (!slotData) return res.json({ granted: 0, message: 'no miniwave slot data found' });

  try {
    extractGameItemsFromSlot(username, 'miniwave', slotData, { silent: false, userOverride: memUser ? undefined : user });
  } catch (e) {
    return res.status(500).json({ error: 'extraction failed: ' + e.message });
  }

  if (!memUser && user.gameItems.length > before) {
    for (const item of user.gameItems) {
      if (dbId) await db.addGameItem(dbId, item).catch(dbErr('addGameItem'));
    }
  }

  res.json({ granted: user.gameItems.length - before, total: user.gameItems.length });
});

// ── Admin: Inspect MiniPixiz slot data + earned pictos ──
app.get('/api/admin/users/:username/minipixiz-pictos', adminAuth, async (req, res) => {
  const username = req.params.username.toLowerCase();
  const memUser = users[username];
  let dbId = memUser ? memUser._dbId : null;
  if (!dbId && process.env.DATABASE_URL) {
    try { const row = await db.findUserByUsername(username); if (row) dbId = row.id; } catch {}
  }
  if (!dbId && !memUser) return res.status(404).json({ error: 'user not found' });

  const owned = new Set(memUser && Array.isArray(memUser.gameItems) ? memUser.gameItems : (dbId ? await db.getUserGameItems(dbId).catch(() => []) : []));

  let slotData = null;
  if (memUser && memUser.frutiSlots && memUser.frutiSlots.minipixiz && memUser.frutiSlots.minipixiz['0']) {
    slotData = memUser.frutiSlots.minipixiz['0'];
  } else if (dbId) {
    try { const slots = await db.getAllFrutiSlots(dbId); if (slots && slots.minipixiz && slots.minipixiz['0']) slotData = slots.minipixiz['0']; } catch {}
  }

  let parsed = null;
  if (slotData) {
    try { parsed = JSON.parse(slotData); } catch {}
  }

  const allPictos = Object.entries(GAME_ITEM_INFO)
    .filter(([, info]) => info.game === 'MiniPixiz')
    .map(([id, info]) => ({ id, name: info.name, owned: owned.has(id) }));

  res.json({
    username,
    hasSlotData: !!slotData,
    slotDataLength: slotData ? slotData.length : 0,
    slotDataPreview: slotData ? slotData.substring(0, 500) : null,
    parsed,
    pictosOwnedCount: allPictos.filter(p => p.owned).length,
    pictosTotal: allPictos.length,
    pictos: allPictos,
  });
});

app.post('/api/admin/users/:username/minipixiz-pictos/grant-earned', adminAuth, async (req, res) => {
  const username = req.params.username.toLowerCase();
  const memUser = users[username];
  let dbId = memUser ? memUser._dbId : null;
  if (!dbId && process.env.DATABASE_URL) {
    try { const row = await db.findUserByUsername(username); if (row) dbId = row.id; } catch {}
  }
  if (!dbId && !memUser) return res.status(404).json({ error: 'user not found' });

  const user = memUser || { gameItems: dbId ? await db.getUserGameItems(dbId).catch(() => []) : [], _dbId: dbId };
  if (!Array.isArray(user.gameItems)) user.gameItems = [];
  const before = user.gameItems.length;

  let slotData = null;
  if (memUser && memUser.frutiSlots && memUser.frutiSlots.minipixiz && memUser.frutiSlots.minipixiz['0']) {
    slotData = memUser.frutiSlots.minipixiz['0'];
  } else if (dbId) {
    try { const slots = await db.getAllFrutiSlots(dbId); if (slots && slots.minipixiz && slots.minipixiz['0']) slotData = slots.minipixiz['0']; } catch {}
  }
  if (!slotData) return res.json({ granted: 0, message: 'no minipixiz slot data found' });

  try {
    extractGameItemsFromSlot(username, 'minipixiz', slotData, { silent: false, userOverride: memUser ? undefined : user });
  } catch (e) {
    return res.status(500).json({ error: 'extraction failed: ' + e.message });
  }

  if (!memUser && user.gameItems.length > before) {
    for (const item of user.gameItems) {
      if (dbId) await db.addGameItem(dbId, item).catch(dbErr('addGameItem'));
    }
  }

  res.json({ granted: user.gameItems.length - before, total: user.gameItems.length });
});

// ─── Cleanup: remove fake "milestone" pixiz pictos accidentally minted by
// an earlier extractor (now removed — see extractGameItemsFromSlot).
// The official MiniPixiz picto album only contains the 100 item GIFs in
// bmp/titems/GIF/item/ and the 57 food GIFs in bmp/titems/GIF/food/.
// Everything else this list enumerates was a fabricated $pixiz_* id that
// had no entry in GAME_ITEM_INFO (so it never rendered) but still sat in
// user.gameItems inflating per-game counts. Idempotent.
const PIXIZ_FAKE_MILESTONE_IDS = [
  '$pixiz_first',
  '$pixiz_forest', '$pixiz_pond', '$pixiz_castle', '$pixiz_rainbow', '$pixiz_tree',
  '$pixiz_run10', '$pixiz_run50', '$pixiz_run100', '$pixiz_run500',
  '$pixiz_diam1', '$pixiz_diam2', '$pixiz_diam3', '$pixiz_diam4', '$pixiz_diam5',
  '$pixiz_star10', '$pixiz_star100', '$pixiz_star1000',
  '$pixiz_key5', '$pixiz_key25',
  '$pixiz_dungeon', '$pixiz_dungeon10', '$pixiz_dungeon20', '$pixiz_dungeon30', '$pixiz_dungeon50',
  '$pixiz_pond_quest',
  '$pixiz_faerie3', '$pixiz_faerie5', '$pixiz_faerie10',
  '$pixiz_faerie_lvl10', '$pixiz_faerie_lvl30', '$pixiz_faerie_lvl50',
  '$pixiz_treeMax20', '$pixiz_treeMax50', '$pixiz_treeMax100',
  '$pixiz_forestMax5', '$pixiz_forestMax10', '$pixiz_forestMax20',
  '$pixiz_mis10', '$pixiz_mis25', '$pixiz_mis50', '$pixiz_mis100',
  '$pixiz_kill100', '$pixiz_kill500',
  '$pixiz_bag2', '$pixiz_bag3', '$pixiz_bag_max',
  '$pixiz_frog',
];

app.post('/api/admin/users/:username/minipixiz-pictos/cleanup-fakes', adminAuth, async (req, res) => {
  const username = req.params.username.toLowerCase();
  const memUser = users[username];
  let dbId = memUser ? memUser._dbId : null;
  if (!dbId && process.env.DATABASE_URL) {
    try { const row = await db.findUserByUsername(username); if (row) dbId = row.id; } catch {}
  }
  if (!dbId && !memUser) return res.status(404).json({ error: 'user not found' });

  const fakeSet = new Set(PIXIZ_FAKE_MILESTONE_IDS);
  const removed = [];

  if (memUser && Array.isArray(memUser.gameItems)) {
    const kept = [];
    for (const item of memUser.gameItems) {
      if (fakeSet.has(item)) removed.push(item);
      else kept.push(item);
    }
    memUser.gameItems = kept;
  }

  if (dbId) {
    let dbItems = [];
    try { dbItems = await db.getUserGameItems(dbId); } catch (e) {
      return res.status(500).json({ error: 'getUserGameItems failed: ' + e.message });
    }
    for (const item of dbItems) {
      if (fakeSet.has(item)) {
        if (!removed.includes(item)) removed.push(item);
        try { await db.removeGameItem(dbId, item); } catch (e) {
          console.error(`[CLEANUP] removeGameItem(${dbId}, ${item}) failed: ${e.message}`);
        }
      }
    }
  }

  console.log(`[ADMIN] minipixiz cleanup-fakes ${username}: removed ${removed.length} fake pictos`);
  res.json({ ok: true, username, removed, removedCount: removed.length });
});

app.get('/api/admin/users/:username/modlogs', adminAuth, async (req, res) => {
  if (!process.env.DATABASE_URL) return res.json([]);
  try {
    const logs = await db.getModerationLogs(req.params.username.toLowerCase(), 100);
    res.json(logs);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Admin: Shop pack management ──
app.get('/api/admin/shop', adminAuth, (req, res) => {
  res.json(SHOP_PACKS);
});

app.post('/api/admin/shop', adminAuth, async (req, res) => {
  const b = req.body || {};
  const id = Number(b.id);
  if (!id || !b.name || !b.suffix9) return res.status(400).json({ error: 'missing id, name or suffix9' });
  if (SHOP_PACKS.find(p => p.id === id)) return res.status(409).json({ error: 'id already exists' });
  const pack = {
    id,
    name: String(b.name),
    category: String(b.category || 'Accessoires'),
    price: Number(b.price) || 0,
    description: String(b.description || ''),
    suffix9: String(b.suffix9),
    comment: String(b.comment || b.description || ''),
  };
  SHOP_PACKS.push(pack);
  if (process.env.DATABASE_URL) db.upsertShopPack(pack).catch(e => console.error('[DB] shop pack save:', e.message));
  console.log(`[ADMIN] Created shop pack ${id}: ${pack.name}`);
  res.json({ ok: true, pack });
});

app.patch('/api/admin/shop/:id', adminAuth, async (req, res) => {
  const pack = SHOP_PACKS.find(p => p.id === Number(req.params.id));
  if (!pack) return res.status(404).json({ error: 'not found' });
  const b = req.body || {};
  if (b.name !== undefined) pack.name = String(b.name);
  if (b.category !== undefined) pack.category = String(b.category);
  if (b.price !== undefined) pack.price = Number(b.price);
  if (b.description !== undefined) { pack.description = String(b.description); pack.comment = String(b.description); }
  if (b.suffix9 !== undefined) pack.suffix9 = String(b.suffix9);
  if (process.env.DATABASE_URL) db.upsertShopPack(pack).catch(e => console.error('[DB] shop pack save:', e.message));
  console.log(`[ADMIN] Updated shop pack ${pack.id}: ${pack.name}`);
  res.json({ ok: true, pack });
});

app.delete('/api/admin/shop/:id', adminAuth, async (req, res) => {
  const idx = SHOP_PACKS.findIndex(p => p.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'not found' });
  const removed = SHOP_PACKS.splice(idx, 1)[0];
  if (process.env.DATABASE_URL) db.deleteShopPack(removed.id).catch(e => console.error('[DB] shop pack delete:', e.message));
  console.log(`[ADMIN] Deleted shop pack ${removed.id}: ${removed.name}`);
  res.json({ ok: true });
});

app.post('/api/admin/shop/:id/push-all', adminAuth, async (req, res) => {
  if (!process.env.DATABASE_URL) return res.status(400).json({ error: 'no db' });
  const pack = SHOP_PACKS.find(p => p.id === Number(req.params.id));
  if (!pack) return res.status(404).json({ error: 'pack not found' });
  try {
    const allUsers = await db.listAllUsers();
    let pushed = 0;
    let skipped = 0;
    for (const row of allUsers) {
      const accs = await db.getUserAccessories(row.id);
      if (accs.some(a => a.shopId === pack.id)) { skipped++; continue; }
      const isWp = !!pack.wallpaperId;
      const wp = isWp ? WALLPAPER_BY_ID[pack.wallpaperId] : null;
      const bouille15 = (row.fbouille || DEFAULT_BOUILLE_STATE).substring(0, 15);
      const acc = {
        id: isWp ? ('wp_' + pack.wallpaperId) : ('shop_' + pack.id),
        shopId: pack.id,
        n: pack.name,
        v: isWp ? `wp:${wp.url}:${wp.color}` : bouille15 + pack.suffix9,
        q: '1',
        p: String(pack.price),
      };
      await db.addAccessory(row.id, acc);
      if (users[row.username]) {
        users[row.username].customAccessories = await db.getUserAccessories(row.id);
      }
      pushed++;
    }
    console.log(`[ADMIN] Pushed shop pack ${pack.id} (${pack.name}) to ${pushed} users (${skipped} already owned)`);
    res.json({ ok: true, pushed, skipped });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/wallpapers/cleanup', adminAuth, async (req, res) => {
  for (const username of Object.keys(users)) {
    const u = users[username];
    if (Array.isArray(u.customAccessories)) {
      u.customAccessories = u.customAccessories.filter(acc => !getAccessoryWallpaper(acc));
    }
  }
  let removed = 0;
  if (process.env.DATABASE_URL) {
    try {
      const ids = SHOP_PACKS_DEFAULT.filter(p => p.wallpaperId).map(p => p.id);
      removed = await db.deleteWallpaperAccessories(ids);
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }
  console.log(`[ADMIN] Wallpaper cleanup: ${removed} accessories removed from DB`);
  res.json({ ok: true, removed });
});

// ── Admin: Challenge cycle management ──
app.get('/api/admin/challenge/status', adminAuth, async (req, res) => {
  const today = parisDayKey();
  const challengeIds = challengeRankingIds();
  const summary = {};
  for (const rkId of challengeIds) {
    const all = [];
    for (const [u, rlist] of Object.entries(scoresData.users || {})) {
      if (rlist && rlist[rkId] && Number.isFinite(Number(rlist[rkId].score))) {
        all.push({ u, s: Number(rlist[rkId].score), data: rlist[rkId].data });
      }
    }
    all.sort(scoreComparator(rkId));
    summary[rkId] = { count: all.length, top3: all.slice(0, 3) };
  }
  const archiveDays = process.env.DATABASE_URL ? await db.getArchiveDays().catch(() => []) : [];
  res.json({
    today,
    lastRollDay: challengeMedalsData.lastRollDay || '',
    challengeRankings: challengeIds,
    scores: summary,
    archiveDays,
  });
});

app.post('/api/admin/challenge/roll', adminAuth, async (req, res) => {
  const today = parisDayKey();
  const hadScores = challengeRankingIds().some(rkId => {
    for (const [, rlist] of Object.entries(scoresData.users || {})) {
      if (rlist && rlist[rkId]) return true;
    }
    return false;
  });
  // For manual testing: pretend lastRollDay was yesterday so the archive lands
  // under yesterdayParisDayKey() and medalsByVisibleDay[yesterday] gets populated,
  // matching what awardgame/buildPodium look up for "yesterday's medalists".
  challengeMedalsData.lastRollDay = yesterdayParisDayKey();
  await performChallengeRoll(today);
  console.log(`[ADMIN] Forced challenge roll. hadScores=${hadScores}`);
  res.json({ ok: true, rolledDay: today, hadScores });
});

app.post('/api/admin/challenge/reset', adminAuth, async (req, res) => {
  resetChallengeScoresInMemory();
  challengeMedalsData.medalsByVisibleDay = {};
  challengeMedalsData.pendingNotifications = {};
  challengeMedalsData.lastRollDay = parisDayKey();
  saveChallengeMedals();
  if (process.env.DATABASE_URL) {
    try { await db.clearAllChallengeData(); } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }
  console.log('[ADMIN] Challenge data fully reset (memory + DB)');
  res.json({ ok: true });
});

app.get('/api/admin/challenge/archive', adminAuth, async (req, res) => {
  if (!process.env.DATABASE_URL) return res.json({ days: [], scores: [] });
  const day = String(req.query.day || '').trim();
  const ranking = String(req.query.ranking || '').trim();
  try {
    if (day && ranking) {
      const scores = await db.getArchivedScores(ranking, day);
      const cmp = scoreComparator(ranking);
      scores.sort((a, b) => cmp({ s: Number(a.score) }, { s: Number(b.score) }));
      res.json({ day, ranking, scores });
    } else {
      const days = await db.getArchiveDays();
      res.json({ days });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/challenge/medals', adminAuth, async (req, res) => {
  if (!process.env.DATABASE_URL) {
    const out = [];
    for (const [day, dayMedals] of Object.entries(challengeMedalsData.medalsByVisibleDay || {})) {
      for (const [username, medals] of Object.entries(dayMedals || {})) {
        for (const m of medals) {
          out.push({
            awarded_day: day, username, ranking_id: m.rankingId,
            game: m.game, rank: m.rank, medal: m.medal,
          });
        }
      }
    }
    out.sort((a, b) => b.awarded_day.localeCompare(a.awarded_day) || a.ranking_id.localeCompare(b.ranking_id) || a.rank - b.rank);
    return res.json({ medals: out, days: [...new Set(out.map(m => m.awarded_day))] });
  }
  try {
    const medals = await db.getAllMedals();
    const days = await db.getMedalDays();
    res.json({ medals, days });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/challenge/medals', adminAuth, async (req, res) => {
  const day = String(req.query.day || req.body && req.body.day || '').trim();
  if (!day) return res.status(400).json({ error: 'day parameter required' });
  if (challengeMedalsData.medalsByVisibleDay) {
    delete challengeMedalsData.medalsByVisibleDay[day];
    saveChallengeMedals();
  }
  if (process.env.DATABASE_URL) {
    try { await db.deleteMedalsByDay(day); } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }
  res.json({ ok: true, day });
});

// Diagnostic endpoint: returns full medal & score state for debugging.
app.get('/api/admin/challenge/debug', adminAuth, async (req, res) => {
  const today = parisDayKey();
  const yesterday = yesterdayParisDayKey();

  const memoryScores = {};
  for (const rkId of challengeRankingIds()) {
    const all = [];
    for (const [u, rlist] of Object.entries(scoresData.users || {})) {
      if (rlist && rlist[rkId] && Number.isFinite(Number(rlist[rkId].score))) {
        all.push({ u, s: Number(rlist[rkId].score), data: rlist[rkId].data });
      }
    }
    all.sort(scoreComparator(rkId));
    memoryScores[rkId] = {
      lowerIsBetter: isLowerBetter(rkId),
      sortedBestFirst: all,
    };
  }

  const dbMedalsByDay = {};
  if (process.env.DATABASE_URL) {
    try {
      const days = [yesterday, today];
      for (const d of days) {
        dbMedalsByDay[d] = await db.getMedalsByDay(d);
      }
    } catch (e) { dbMedalsByDay.error = e.message; }
  }

  res.json({
    today,
    yesterday,
    lastRollDay: challengeMedalsData.lastRollDay || '',
    rankings: challengeRankingIds(),
    rankingsConfig: Object.fromEntries(
      challengeRankingIds().map(rkId => [rkId, {
        game: RANKINGS[rkId] && RANKINGS[rkId].game,
        lowerIsBetter: !!(RANKINGS[rkId] && RANKINGS[rkId].lowerIsBetter),
      }])
    ),
    memoryScores,
    memoryMedalsByDay: challengeMedalsData.medalsByVisibleDay,
    dbMedalsByDay,
  });
});

app.post('/api/admin/challenge/regenerate-medals', adminAuth, async (req, res) => {
  if (!process.env.DATABASE_URL) return res.status(400).json({ error: 'No database' });
  const day = String(req.body.day || '').trim();
  if (!day) return res.status(400).json({ error: 'day parameter required (YYYY-MM-DD)' });
  try {
    const rows = await db.getArchivedScoresForDay(day);
    if (rows.length === 0) return res.json({ ok: false, error: 'No archived scores for that day' });
    const byRanking = {};
    for (const r of rows) {
      if (!byRanking[r.ranking_id]) byRanking[r.ranking_id] = [];
      byRanking[r.ranking_id].push({ u: r.username, s: Number(r.score), data: r.data });
    }
    const winnersByUser = {};
    const details = {};
    for (const rkId of challengeRankingIds()) {
      const all = byRanking[rkId] || [];
      all.sort(scoreComparator(rkId));
      const top = all.slice(0, 3);
      details[rkId] = top;
      for (let i = 0; i < top.length; i++) {
        const rank = i + 1;
        const medal = rank === 1 ? 'or' : rank === 2 ? 'argent' : 'bronze';
        const username = top[i].u;
        if (!winnersByUser[username]) winnersByUser[username] = [];
        winnersByUser[username].push({
          game: (RANKINGS[rkId] && RANKINGS[rkId].game) || rkId,
          rankingId: rkId,
          rank,
          medal,
        });
      }
    }
    await db.deleteMedalsByDay(day);
    for (const [username, medals] of Object.entries(winnersByUser)) {
      for (const m of medals) {
        const row = await db.findUserByUsername(username).catch(() => null);
        const userId = (row && row.id) || 0;
        await db.saveMedal(userId, username, m.rankingId, m.game, m.rank, m.medal, day);
      }
    }
    challengeMedalsData.medalsByVisibleDay[day] = winnersByUser;
    saveChallengeMedals();
    res.json({ ok: true, day, details, winnersByUser });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Admin: broadcast event to all users (Événements window) ──
// Available SiteLog icons (frame numbers in icoSiteLog sprite 576):
//   1  = info générale (default)
//   11 = info technique
//   20 = nouveauté
//   21 = nouveau jeu
const SITE_LOG_ICONS = [1, 11, 20, 21];
const pushedEvents = []; // { id, message, type, time, chat }
let pushedEventSeq = 0;

function genEventId() {
  pushedEventSeq += 1;
  return `evt_${Date.now().toString(36)}_${pushedEventSeq}`;
}

// ── Admin: Channels ──

app.get('/api/admin/channels', adminAuth, (req, res) => {
  const list = [];
  for (const [name, ch] of Object.entries(channels)) {
    if (ch.private) continue;
    list.push({ name, label: ch.desc || '', topic: ch.topic || '', users: ch.users.size });
  }
  res.json({ ok: true, channels: list });
});

app.patch('/api/admin/channels/:name', adminAuth, async (req, res) => {
  const name = req.params.name;
  const ch = channels[name];
  if (!ch) return res.status(404).json({ ok: false, error: 'Salon introuvable' });

  const body = req.body || {};
  let changed = false;

  if (body.label !== undefined) {
    const label = String(body.label).trim().slice(0, 100);
    ch.desc = label;
    changed = true;
  }

  if (body.topic !== undefined) {
    const topic = String(body.topic).trim().slice(0, 200);
    ch.topic = topic;
    broadcastToChannel(name, `<${CMD.topic} g="${escapeXml(name)}">${escapeXml(topic)}</${CMD.topic}>`);
    changed = true;
  }

  if (changed && process.env.DATABASE_URL) {
    try { await db.upsertChannel(name, ch.desc || '', ch.topic || ''); }
    catch (e) { console.error('[DB] channel save error:', e.message); }
  }

  res.json({ ok: true });
});

app.post('/api/admin/broadcast', adminAuth, (req, res) => {
  const message = String(req.body.message || '').trim();
  if (!message) return res.status(400).json({ ok: false, error: 'message required' });

  const rawType = Number(req.body.type);
  const type = SITE_LOG_ICONS.includes(rawType) ? rawType : 1;
  const chatToo = req.body.chat === true || req.body.chat === 'true';

  const eventId = genEventId();
  const time = nowSqlTimestamp();

  // The Flash client's addSiteLog checks (obj.time > this.previousTime) to
  // decide flNew — onNewSiteLog doesn't pass flNew explicitly unlike
  // onNewUserLog. previousTime is seconds-precision (from onident p=).
  // Include milliseconds so the wire date is always strictly > previousTime.
  const wireDate = new Date().toISOString().replace('T', ' ').replace('Z', '');

  // Live notification to connected sockets via newsitelog (bl)
  const xml = `<${CMD.newsitelog} date="${escapeXml(wireDate)}" type="${type}">${escapeXml(message)}</${CMD.newsitelog}>`;
  let notified = 0;
  for (const [sock, client] of xmlSocketClients) {
    if (client.logged) {
      sendToClient(sock, xml);
      notified++;
    }
  }

  // Persistent: append to every known user's siteLog so it shows up after relog too.
  // We tag the entry with `bid` so it can later be removed by event id.
  let historyCount = 0;
  for (const username of Object.keys(users)) {
    const user = users[username];
    if (!user) continue;
    if (!Array.isArray(user.siteLog)) user.siteLog = [];
    user.siteLog.unshift({
      d: time,
      t: type,
      c: message,
      n: 1,
      bid: eventId,
    });
    if (user.siteLog.length > 200) user.siteLog.length = 200;
    historyCount++;
  }

  // Persist to DB for ALL registered users (including those not in memory).
  // Single bulk INSERT reaches offline users who will see it on next login.
  if (process.env.DATABASE_URL) {
    db.broadcastSiteLogToAllUsers(type, message)
      .catch((e) => console.error('[DB] broadcast bulk site log error:', e.message));
  }

  // Optional: also shout in every chat channel (red bold)
  if (chatToo) {
    const timeAttrs = buildChatTimeAttrs();
    const redText = `<![CDATA[<b><font color="#FF0000">${message}</font></b>]]>`;
    for (const channelName of Object.keys(channels)) {
      broadcastToChannel(channelName,
        `<${CMD.send} u="admin" t="m" p="" g="${escapeXml(channelName)}" h="${timeAttrs.h}" d="${timeAttrs.d}">${redText}</${CMD.send}>`
      );
    }
  }

  pushedEvents.unshift({ id: eventId, message, type, time, chat: chatToo, notified, historyCount });
  if (pushedEvents.length > 200) pushedEvents.length = 200;

  console.log(`[ADMIN] Push event ${eventId} type=${type} → ${notified} sockets, ${historyCount} users. chat=${chatToo}`);
  res.json({ ok: true, id: eventId, notified, historyCount });
});

app.get('/api/admin/broadcast', adminAuth, (req, res) => {
  res.json({ events: pushedEvents, icons: SITE_LOG_ICONS });
});

app.delete('/api/admin/broadcast/:id', adminAuth, (req, res) => {
  const id = String(req.params.id || '');
  const idx = pushedEvents.findIndex((e) => e.id === id);
  if (idx === -1) return res.status(404).json({ ok: false, error: 'event not found' });
  const evt = pushedEvents[idx];
  pushedEvents.splice(idx, 1);

  let removed = 0;
  for (const username of Object.keys(users)) {
    const user = users[username];
    if (!user || !Array.isArray(user.siteLog)) continue;
    const before = user.siteLog.length;
    user.siteLog = user.siteLog.filter((e) => e.bid !== id);
    if (user.siteLog.length !== before) removed++;
  }

  db.deleteSiteLogByContent(evt.message).catch((e) => console.error('[DB] deleteSiteLogByContent:', e.message));

  console.log(`[ADMIN] Delete event ${id} → removed from ${removed} users (siteLog+DB). Connected users see deletion on next login.`);
  res.json({ ok: true, removed, event: evt });
});

// SWF-triggered score save: the patched game SWFs call loadVariables("s<score>", "")
// which resolves (via Ruffle base URL) to /swf/games/<game>/s<score>.
app.get(/^\/(?:swf\/)?games\/([^/]+)\/s(\d+)$/, async (req, res) => {
  await rollDailyChallengeIfNeeded();
  const gameName = req.params[0];
  const scoreVal = parseInt(req.params[1]) || 0;
  let username = '';
  const sid = getSidFromRequest(req, req.query || {});
  if (sid && sessions[sid]) username = sessions[sid].user || '';
  const ip = getClientIp(req);
  const fallbackSid = ip ? recentSidByIp.get(ip) : undefined;
  if (!username && fallbackSid && sessions[fallbackSid]) username = sessions[fallbackSid].user || '';
  if (!username || !scoreVal) {
    console.log(`[SWF-SCORE] skip save user="${username}" sid="${sid}" ip="${ip}" game="${gameName}" score=${scoreVal}`);
    return res.type('text/plain').send('ok=0');
  }
  const effectiveSid = sid || fallbackSid || '';
  const swfMode = (effectiveSid && sessions[effectiveSid] && sessions[effectiveSid].challengeMode) ? 1 : 0;
  const rankingId = rankingIdForGame(gameName, swfMode);
  if (!rankingId) {
    console.log(`[SWF-SCORE] unknown ranking game="${gameName}" sid="${effectiveSid}" user="${username}"`);
    return res.type('text/plain').send('ok=0');
  }
  const result = persistScore(username, rankingId, scoreVal, '');
  console.log(`[SWF-SCORE] ${username} ${gameName} ${scoreVal} -> ${rankingId} mode=${swfMode} updated=${result.updated}`);
  res.type('text/plain').send('ok=1');
});

// ─────────────────────────────────────────────
// ENDPOINT: /api/saveFrutiSlot — Persist FrutiCard slot data (modes, prefs, stats).
// POST params: sid, game, slotId, data (JSON string).
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// Extract game items (pictos/titems) from FrutiCard slot 0 data.
// Each game stores unlock state differently in its slot JSON.
// We parse it and register new items in user.gameItems.
// ─────────────────────────────────────────────
const SWAPOU2_TITEMS = [
  '$sel','','$poivre','$epee','$piment','$dent','$sucre',
  '$metal01','$metal02','$metal03','$ice01','$ice02','$ice03','$star01','$star02','$star03',
  '$fruit01','$fruit02','$fruit03','$fruit04','$fruit05','$fruit06','$fruit07','$fruit08','$fruit09','$fruit10','$fruit11',
  '$combo01','$combo02','$combo03','$combo04','$combo05','$combo06','$combo07','$combo08','$combo09','$combo10','$combo11',
  '$photo01','$photo02','$photo03','$photo04','$photo05','$photo06','$photo07','$photo08',
];
const MB2_TITEMS = [
  '$c1or','$c1argent','$c1','$c2or','$c2argent','$c2','$c3or','$c3argent','$c3',
  '$c4or','$c4argent','$c4','$c5or','$c5argent','$c5','$c6or','$c6argent','$c6',
  '$c7or','$c7argent','$c7',
  '$bfacettes','$bnormal','$btime','$bdeath','$bmagnet','$bshadow',
  '$oeil','$masque',
  '$eca0','$eca1','$eca2','$eca3','$symb0','$symb1','$symb2','$symb3',
];

function extractGameItemsFromSlot(username, game, dataStr, { silent = false, userOverride = null } = {}) {
  let parsed;
  try { parsed = JSON.parse(dataStr); } catch {
    if (dataStr && dataStr.indexOf('|') >= 0) {
      if (game === 'miniwave' || game === 'miniwave2') parsed = parseMiniwavePipe(dataStr);
      else if (game === 'minipixiz' || game === 'minitroll') parsed = parseMinipixizPipe(dataStr);
      else if (game === 'mb2') parsed = parseMb2Pipe(dataStr);
    }
    if (!parsed) return;
  }
  if (!parsed || typeof parsed !== 'object') return;
  if (game === 'bkiwi') {
    console.log(`[SLOT]  bkiwi extraction for ${username}: $wc=${parsed.$wc} $wcs=${parsed.$wcs} $ws=${parsed.$ws} $wss=${parsed.$wss} $ac=${JSON.stringify(parsed.$ac)}`);
  }
  const user = userOverride || users[username];
  if (!user) return;
  if (!Array.isArray(user.gameItems)) user.gameItems = [];

  const newItems = [];
  function addIfNew(name) {
    if (!name || user.gameItems.includes(name)) return;
    user.gameItems.push(name);
    newItems.push(name);
  }

  if (game === 'swapou2') {
    const items = parsed.$items;
    if (Array.isArray(items)) {
      for (let i = 0; i < items.length && i < SWAPOU2_TITEMS.length; i++) {
        if (items[i] && SWAPOU2_TITEMS[i]) addIfNew(SWAPOU2_TITEMS[i]);
      }
    }
  } else if (game === 'mb2') {
    const items = parsed.$items;
    if (Array.isArray(items)) {
      for (let i = 0; i < items.length && i < MB2_TITEMS.length; i++) {
        if (items[i] && MB2_TITEMS[i]) addIfNew(MB2_TITEMS[i]);
      }
    }
  } else if (game === 'kaluga') {
    // Kaluga: $mode[n][level] tracks mode unlocks, $tz[id] tracks tzongres
    // mode indices 2-5 correspond to the 4 playable types (n=2..5)
    // level 0→butterfly, level 1→smiley, level 2→tz, level 3→special item
    const mode = parsed.$mode;
    const tz = parsed.$tz;
    if (Array.isArray(mode)) {
      for (let n = 2; n <= 5; n++) {
        const sub = mode[n];
        if (!Array.isArray(sub)) continue;
        if (sub[0]) addIfNew('$butterfly' + (n - 2));
        if (sub[1]) addIfNew('$smiley' + (n - 2));
        if (sub[2]) {
          const tzUnlockList = [1, 4, 3, 2];
          const tzId = tzUnlockList[n - 2];
          addIfNew('$tz' + tzId);
        }
        if (sub[3]) {
          const specials = ['$basket', '$bird', '$ring', '$ant'];
          addIfNew(specials[n - 2]);
        }
      }
    }
    if (Array.isArray(tz)) {
      for (let i = 1; i < tz.length; i++) {
        if (tz[i]) addIfNew('$tz' + i);
      }
    }
  } else if (game === 'bkiwi') {
    // Burning Kiwi slot 0 layout (savePublic in code.as):
    //   $ws/$wss/$wc/$wcs — boolean cup-win flags
    //   $ac — array[5] of defeated duel adversaries (the game variable "availableCars")
    //   $ts — per-track stats (not used for pictos)
    if (parsed.$wc)  addIfNew('$fruticupxl');
    if (parsed.$wcs) addIfNew('$fruticup');
    if (parsed.$ws)  addIfNew('$elitexl');
    if (parsed.$wss) addIfNew('$elite');
    const ac = parsed.$ac || parsed.availableCars || parsed.$availableCars;
    if (Array.isArray(ac)) {
      for (let i = 0; i < ac.length && i < 5; i++) {
        if (ac[i]) {
          addIfNew('$logo0' + (i + 1));
          addIfNew('$car0' + (i + 1));
        }
      }
    }
  } else if (game === 'miniwave2' || game === 'miniwave') {
    // MiniWave2 slot 0 layout (from Manager.as formatFruticard):
    //   $ship:Array<bool>       — unlocked ships (index 0..5)
    //   $badsKill:Array<int>    — kill count per monster (titemKillLimit=200 in SWF)
    //   $arcade:{$bestScore,$bestLevel} — arcade boss mode
    //   $cons:{$main,$bonus:Array<0..100>,$letter} — consecration %
    //   $shop:Array<0|1>        — shop items (1=available, 0=purchased)
    const bk = parsed.$badsKill;
    const bkSummary = Array.isArray(bk)
      ? bk.map((v, i) => v >= 200 ? `${i}=${v}` : null).filter(Boolean).join(',')
      : 'not-array';
    console.log(`[SLOT]  miniwave extraction for ${username}: $ship=${JSON.stringify(parsed.$ship)} $badsKill≥200=[${bkSummary}] $arcade.$bestLevel=${parsed.$arcade && parsed.$arcade.$bestLevel} $cons.$letter=${parsed.$cons && parsed.$cons.$letter} $cons.$bonus=${JSON.stringify(parsed.$cons && parsed.$cons.$bonus)} $shop=${JSON.stringify(parsed.$shop)}`);
    const ship = parsed.$ship;
    if (Array.isArray(ship)) {
      for (let i = 0; i < ship.length; i++) {
        if (ship[i]) addIfNew('$ship0' + i);
      }
    }
    const badsKill = parsed.$badsKill;
    if (Array.isArray(badsKill)) {
      for (let i = 0; i < badsKill.length; i++) {
        if (badsKill[i] && badsKill[i] >= 200) addIfNew('$bads' + i);
      }
    }
    if (parsed.$arcade && parsed.$arcade.$bestLevel > 0) addIfNew('$arcade');
    const cons = parsed.$cons;
    if (cons) {
      if (Array.isArray(cons.$bonus)) {
        for (let i = 0; i < cons.$bonus.length && i <= 4; i++) {
          if (cons.$bonus[i] >= 100) addIfNew('$mis' + i);
        }
      }
      if (cons.$letter >= 100) addIfNew('$letter');
    }
    const shop = parsed.$shop;
    if (Array.isArray(shop)) {
      const shopItems = [
        [10, '$smiley_love'], [11, '$smiley_laugh'], [12, '$smiley_twirl'],
        [13, '$wpMinistar'], [14, '$wpNostromo'],
      ];
      for (const [idx, itemId] of shopItems) {
        if (shop[idx] === 0) addIfNew(itemId);
      }
    }
  } else if (game === 'minipixiz' || game === 'minitroll') {
    // MiniPixiz (miniTroll) album = 162 picto slots total :
    //   • 100 items   from bmp/titems/GIF/item/  (indices 1..228 with gaps)
    //                 unlocked via $stat.$item[id]=true (Card.mt schema)
    //   •  57 foods   from bmp/titems/GIF/food/  (3 variants per food type)
    //                 unlocked via $stat.$eat[n] count thresholds (1/5/20)
    //   •   5 diamants from bmp/titems/GIF/diam/ (1 par couleur de donjon)
    //                 unlocked via $dungeon.$lvl/$f/$loop (base/Dungeon.mt)
    //   = 162, dont 5 réservés inaccessibles (clé de donjon $item[31],
    //     parchemins+grimoires des sorts de base des fées $item[100/116/200/216])
    //   → 157 obtenables.
    //
    // Other slot fields ($run, $star, $key, $faerie, $treeMax, $bag, $frog,
    // $game, $kill, $misNum…) are pure gameplay state — they appear nowhere
    // in the album. A previous version of this extractor minted 47 fake
    // $pixiz_first/$pixiz_dungeon/$pixiz_faerieN/$pixiz_treeMax/$pixiz_run/
    // $pixiz_star/$pixiz_key/$pixiz_bag/$pixiz_frog/etc. "milestones" with
    // reused item GIFs, polluting the album to 209 slots. Removed (and the
    // /minipixiz-pictos/cleanup-fakes endpoint scrubs them retroactively).
    const stat = (parsed.$stat && typeof parsed.$stat === 'object' && !Array.isArray(parsed.$stat)) ? parsed.$stat : {};

    // 1) Per-item pictos (read $stat.$item array — bool per item id)
    const items = Array.isArray(stat.$item) ? stat.$item : [];
    for (let id = 0; id < items.length; id++) {
      if (items[id] && GAME_ITEM_INFO[`$pixiz_item${id}`]) {
        addIfNew(`$pixiz_item${id}`);
      }
    }
    // 2) Per-food pictos (read $stat.$eat array — count per food type index n)
    // Each food type has 3 GIF variants (grand/moyen/petit = bronze/silver/gold).
    // Game awards: 1 eat → $food_{n*3+3} (grand), 5 → $food_{n*3+2} (moyen), 20 → $food_{n*3+1} (petit).
    // GAME_ITEM_INFO uses $pixiz_food{300+i} where i = n*3 + variant_offset.
    const eats = Array.isArray(stat.$eat) ? stat.$eat : [];
    for (let n = 0; n < eats.length; n++) {
      const count = eats[n] || 0;
      if (count >= 1)  addIfNew(`$pixiz_food${300 + n * 3 + 2}`);
      if (count >= 5)  addIfNew(`$pixiz_food${300 + n * 3 + 1}`);
      if (count >= 20) addIfNew(`$pixiz_food${300 + n * 3}`);
    }
    // 3) Diamond pictos (5 colors) — earned by completing each Dungeon
    // difficulty tier. Source: Games/miniTroll/src/base/Dungeon.mt — the
    // diamond skin gotoAndStop(difficulty+1) where difficulty = $dungeon.$lvl
    // at the start of each run. So completing level N drops a diamant of
    // color N+1. $dungeon.$lvl tracks the latest difficulty done and
    // $dungeon.$loop > 0 means at least one full cycle (all 5 colors).
    const dungeon = (parsed.$dungeon && typeof parsed.$dungeon === 'object') ? parsed.$dungeon : null;
    if (dungeon) {
      const lvl = Number(dungeon.$lvl) || 0;
      const loop = Number(dungeon.$loop) || 0;
      const completed = Math.min(5, loop > 0 ? 5 : (lvl + (dungeon.$f ? 1 : 0)));
      for (let k = 1; k <= completed; k++) addIfNew(`$pixiz_diam${k}`);
    }
  } else if (game === 'snake3') {
    // FrutiSnake: $fruits is an object/array mapping fruit ID → collection count.
    // A fruit is unlocked when collected >= 20 times (FRUIT_DEBLOK).
    const fruits = parsed.$fruits;
    if (fruits && typeof fruits === 'object') {
      for (const k of Object.keys(fruits)) {
        const count = Number(fruits[k]) || 0;
        if (count >= 20) {
          addIfNew('Fruit ' + k);
        }
      }
    }
  }

  if (newItems.length > 0) {
    const dbId = user._dbId;
    if (dbId) {
      for (const item of newItems) {
        db.addGameItem(dbId, item).catch((e) => console.error('[DB] addGameItem:', e.message));
      }
    }
    console.log(`[SLOT]  extracted ${newItems.length} new pictos for ${username}/${game}: ${newItems.join(', ')}`);
    if (!silent) {
      for (const item of newItems) {
        const info = GAME_ITEM_INFO[item];
        const label = info ? info.name : item;
        const gameName = info ? info.game : game;
        addAndNotifyUserLog(username, { type: USER_LOG_TYPE.PICTO, content: `Nouveau picto débloqué sur ${gameName} : ${label} !` });
      }
    }
  }
}

// MiniWave: SWF sends slot data as a pipe-delimited string of primitives
// because Ruffle AVM1's ExternalInterface can't serialize AS2 objects.
// Format: ship|badsKill|arcadeBestLevel|consBonus|consLetter|shop|vs
// where arrays are comma-joined (Array.toString output).
function parseMiniwavePipe(s) {
  const parts = String(s).split('|');
  if (parts.length < 7) return null;
  function parseArr(p) { return p ? p.split(',').map(Number) : []; }
  function parseShipArr(p) {
    return p ? p.split(',').map(v => v === 'true' || Number(v) > 0) : [];
  }
  return {
    $ship: parseShipArr(parts[0]),
    $badsKill: parseArr(parts[1]),
    $arcade: { $bestLevel: Number(parts[2]) || 0 },
    $cons: {
      $bonus: parseArr(parts[3]),
      $letter: Number(parts[4]) || 0,
    },
    $shop: parseArr(parts[5]),
    $vs: Number(parts[6]) || 0,
  };
}

// Fresh MiniPixiz slot 0 — mirrors Cm.formatFruticard() output for the
// 19 fields the patched saveSlot serialises. Used to auto-repair slots
// that were corrupted by a prior buggy save cycle (arrays written as
// scalars, then re-parsed as 1-element arrays, then re-saved as scalars,
// forever losing in-game updates because gameplay tries to mutate
// `$stat.$item[n] = true` on what has become a boolean primitive).
// Full Card structure expected by MiniPixiz SWF. We derived this by
// comparing what a working Ruffle-hosted server returns vs. the
// truncated payload we used to ship. The MTASC fromJSON parser tolerates
// missing scalar fields but rejects the Card as "unloadable" when the
// nested sub-objects are missing fields it expects ($dungeon needs
// $loop/$day, $rainbow needs $day/$it, $pond needs $d/$fs), and when
// top-level Card fields like $inv/$current/$help/$mis/$wind/$god/$time/
// $mission/$checkpoint are absent. With a complete payload, the SWF's
// native onLoad → fromJSON → Cm.card assignment succeeds and gameplay
// reads/writes our DB state from the start of the session.
const FRESH_MINIPIXIZ_SLOT0 = JSON.stringify({
  $stat: {
    $item: [],
    $eat: [],
    $kill: [0, 0, 0, 0, 0],
    $run: 0,
    $game: [0, 0, 0, 0, 0],
    $forestMax: 0,
    $treeMax: 0,
    $misNum: 0,
  },
  $diam: 0,
  $key: 0,
  $star: 0,
  $bag: 0,
  $dungeon: { $lvl: 0, $f: false, $loop: 0, $day: 0 },
  $rainbow: { $f: false, $day: 0, $it: 0 },
  $pond: { $q: 0, $d: 0, $fs: null },
  $frog: false,
  $faerie: [],
  $vs: 1.2,
  $inv: [],
  $current: 0,
  $help: [],
  $mis: [],
  $wind: 0,
  $god: [false, false, false],
  $time: { $t: 0, $d: 0, $s: 0 },
  $mission: [],
  $checkpoint: 0,
});

// Normalise a stored MiniPixiz slot0 to the full Card structure before
// sending it back to the SWF. Migrations from older saves may lack the
// extra sub-object fields ($dungeon.$loop, $rainbow.$day/$it, $pond.$d/$fs)
// and top-level fields ($inv/$current/$help/$mis/$wind/$god/$time/$mission/
// $checkpoint), which prevents the SWF's fromJSON from accepting the
// payload — anchor Cm.card on formatFruticard() defaults and the UI
// appears reset every session. This function pads in those defaults
// without disturbing any value the player has already accumulated.
function padMinipixizSlot0(jsonStr) {
  if (!jsonStr || typeof jsonStr !== 'string') return jsonStr;
  let obj;
  try { obj = JSON.parse(jsonStr); } catch { return jsonStr; }
  if (!obj || typeof obj !== 'object') return jsonStr;
  // Stat sub-object
  if (!obj.$stat || typeof obj.$stat !== 'object') obj.$stat = {};
  const s = obj.$stat;
  // $item: SWF expects sparse array of length 222 with null for unset
  // and true for unlocked — NEVER false. Older saves stored false
  // everywhere; convert to null + pad up to 222.
  if (!Array.isArray(s.$item)) s.$item = [];
  const ITEM_LEN = 222;
  const fixedItem = new Array(ITEM_LEN).fill(null);
  for (let i = 0; i < Math.min(s.$item.length, ITEM_LEN); i++) {
    fixedItem[i] = s.$item[i] === true ? true : null;
  }
  s.$item = fixedItem;
  if (!Array.isArray(s.$eat))  s.$eat  = [];
  if (!Array.isArray(s.$kill) || s.$kill.length < 5) s.$kill = [0, 0, 0, 0, 0];
  if (!Array.isArray(s.$game) || s.$game.length < 5) s.$game = [0, 0, 0, 0, 0];
  if (typeof s.$run        !== 'number') s.$run        = 0;
  if (typeof s.$forestMax  !== 'number') s.$forestMax  = 0;
  if (typeof s.$treeMax    !== 'number') s.$treeMax    = 0;
  if (typeof s.$misNum     !== 'number') s.$misNum     = 0;
  // Top-level scalars
  if (typeof obj.$diam !== 'number') obj.$diam = 0;
  if (typeof obj.$key  !== 'number') obj.$key  = 0;
  if (typeof obj.$star !== 'number') obj.$star = 0;
  if (typeof obj.$bag  !== 'number') obj.$bag  = 0;
  if (typeof obj.$vs   !== 'number') obj.$vs   = 1.2;
  if (typeof obj.$frog !== 'boolean') obj.$frog = false;
  // Nested progress containers
  if (!obj.$dungeon || typeof obj.$dungeon !== 'object') obj.$dungeon = {};
  if (typeof obj.$dungeon.$lvl  !== 'number')  obj.$dungeon.$lvl  = 0;
  if (typeof obj.$dungeon.$f    !== 'boolean') obj.$dungeon.$f    = false;
  if (typeof obj.$dungeon.$loop !== 'number')  obj.$dungeon.$loop = 0;
  if (typeof obj.$dungeon.$day  !== 'number')  obj.$dungeon.$day  = 0;
  if (!obj.$rainbow || typeof obj.$rainbow !== 'object') obj.$rainbow = {};
  if (typeof obj.$rainbow.$f   !== 'boolean') obj.$rainbow.$f   = false;
  if (typeof obj.$rainbow.$day !== 'number')  obj.$rainbow.$day = 0;
  if (typeof obj.$rainbow.$it  !== 'number')  obj.$rainbow.$it  = 0;
  if (!obj.$pond || typeof obj.$pond !== 'object') obj.$pond = {};
  // $pond.$q is null when no active quest, number when active
  if (obj.$pond.$q === undefined) obj.$pond.$q = null;
  if (typeof obj.$pond.$d !== 'number') obj.$pond.$d = 0;
  if (obj.$pond.$fs === undefined) obj.$pond.$fs = null;
  if (!Array.isArray(obj.$faerie)) obj.$faerie = [];
  if (!Array.isArray(obj.$inv))     obj.$inv     = [];
  // $current is null when nothing is selected (not 0)
  if (obj.$current === undefined) obj.$current = null;
  // $help defaults to [true,true,true] (all three hints enabled for new users)
  if (!Array.isArray(obj.$help) || obj.$help.length < 3) obj.$help = [true, true, true];
  if (!Array.isArray(obj.$mis))     obj.$mis     = [];
  if (typeof obj.$wind !== 'number')obj.$wind    = 0;
  if (!Array.isArray(obj.$god) || obj.$god.length < 3) obj.$god = [false, false, false];
  if (!obj.$time || typeof obj.$time !== 'object') obj.$time = { $t: Date.now(), $d: 0, $s: 0 };
  if (typeof obj.$time.$t !== 'number') obj.$time.$t = Date.now();
  if (typeof obj.$time.$d !== 'number') obj.$time.$d = 0;
  if (typeof obj.$time.$s !== 'number') obj.$time.$s = 0;
  if (!Array.isArray(obj.$mission)) obj.$mission = [];
  if (typeof obj.$checkpoint !== 'number') obj.$checkpoint = 0;
  return JSON.stringify(obj);
}

// Heuristic: does this MiniPixiz save look like a fresh formatFruticard()
// dump rather than real gameplay? Triggered when the SWF was unable to seed
// its in-memory card from server data (e.g. ExternalInterface.parseJSON
// returned null, or /api/loadFrutiSlots came back empty due to a transient
// DB hiccup) and fell through to formatFruticard() → saveSlot(defaults).
// We use it as a second line of defence behind the in-memory clobber guard
// for the case where the in-memory cache itself is missing (e.g. hydrate
// errored silently at login).
function looksLikeMinipixizDefault(jsonStr) {
  if (!jsonStr) return false;
  try {
    const o = JSON.parse(jsonStr);
    if (!o || typeof o !== 'object') return false;
    const s = o.$stat;
    if (!s || typeof s !== 'object') return false;
    const runZero    = !s.$run || s.$run === 0;
    const itemEmpty  = !Array.isArray(s.$item) || s.$item.every((v) => !v);
    const eatEmpty   = !Array.isArray(s.$eat)  || s.$eat.every((v) => !v);
    const noFaerie   = !Array.isArray(o.$faerie) || o.$faerie.length === 0;
    const noDiam     = !o.$diam;
    const noStar     = !o.$star;
    const noDungeon  = !o.$dungeon || !o.$dungeon.$lvl;
    return runZero && itemEmpty && eatEmpty && noFaerie && noDiam && noStar && noDungeon;
  } catch {
    return false;
  }
}

// Healthy MiniPixiz slot? Used to authoritatively detect when stored DB
// data already contains real progress and must not be clobbered by a
// fresh-defaults save coming in from a broken load cycle.
function isMinipixizSlotHealthy(jsonStr) {
  if (!jsonStr) return false;
  try {
    const o = JSON.parse(jsonStr);
    if (!o || typeof o !== 'object') return false;
    const s = o.$stat || {};
    if (Number(s.$run) > 0) return true;
    if (Array.isArray(s.$item) && s.$item.some((v) => v)) return true;
    if (Array.isArray(s.$eat)  && s.$eat.some((v) => Number(v) > 0)) return true;
    if (Array.isArray(o.$faerie) && o.$faerie.length > 0) return true;
    if (Number(o.$diam) > 0 || Number(o.$star) > 0 || Number(o.$key) > 0) return true;
    if (o.$dungeon && Number(o.$dungeon.$lvl) > 0) return true;
    return false;
  } catch {
    return false;
  }
}

// MiniPixiz corruption signature: `$stat.$kill` and `$stat.$game` are
// always created with 5 zeros by formatFruticard() and can only grow
// during gameplay (Imp.mt: `$kill[level]++`, base/*.mt: `$game[zone]++`),
// so length < 5 is impossible for healthy data and unambiguously means
// the slot was scalar-corrupted upstream.
function isMinipixizSlot0Corrupted(jsonStr) {
  if (!jsonStr) return false;
  try {
    const obj = JSON.parse(jsonStr);
    if (!obj || typeof obj !== 'object') return false;
    const stat = obj.$stat;
    if (!stat || typeof stat !== 'object') return false;
    if (!Array.isArray(stat.$kill) || stat.$kill.length < 5) return true;
    if (!Array.isArray(stat.$game) || stat.$game.length < 5) return true;
    return false;
  } catch {
    return false;
  }
}

// MiniPixiz pipe format (22 fields — the original was 19, but $inv,
// $current, $checkpoint were added to keep the in-game bag UI visible
// across sessions; the SWF hides the bag widget when $inv is empty):
//   0:$stat.$item 1:$stat.$eat 2:$stat.$kill 3:$stat.$run 4:$stat.$game
//   5:$stat.$forestMax 6:$stat.$treeMax 7:$stat.$misNum
//   8:$diam 9:$key 10:$star 11:$bag
//   12:$dungeon.$lvl 13:$dungeon.$f 14:$rainbow.$f 15:$pond.$q
//   16:$frog 17:faerie_levels(comma-sep) 18:$vs
//   19:$inv (csv) 20:$current 21:$checkpoint
function parseMinipixizPipe(s) {
  const parts = String(s).split('|');
  if (parts.length < 19) return null;
  function parseNumArr(p) { return p ? p.split(',').map(v => v === '' ? 0 : Number(v) || 0) : []; }
  function parseBoolArr(p) { return p ? p.split(',').map(v => v === 'true') : []; }
  // $inv: CSV of item IDs, empty entries → null (sparse slot, not 0
  // which could collide with a valid item id 0).
  function parseInvArr(p) {
    if (!p) return [];
    return p.split(',').map(v => v === '' ? null : (Number(v) || 0));
  }
  const faerieLevels = (parts[17] || '').replace(/,$/, '').split(',').filter(v => v !== '');
  const inv = parts.length >= 20 ? parseInvArr(parts[19]) : [];
  // $current: null when nothing selected, numeric otherwise. Empty
  // string from pipe → null. 'undefined' from a Ruffle bridge gap →
  // also null (defensive).
  let cur = null;
  if (parts.length >= 21) {
    const c = parts[20];
    if (c === '' || c === 'null' || c === 'undefined') cur = null;
    else cur = Number(c);
    if (Number.isNaN(cur)) cur = null;
  }
  const checkpoint = parts.length >= 22 ? (Number(parts[21]) || 0) : 0;
  return {
    $stat: {
      $item: parseBoolArr(parts[0]),
      $eat: parseNumArr(parts[1]),
      $kill: parseNumArr(parts[2]),
      $run: Number(parts[3]) || 0,
      $game: parseNumArr(parts[4]),
      $forestMax: Number(parts[5]) || 0,
      $treeMax: Number(parts[6]) || 0,
      $misNum: Number(parts[7]) || 0,
    },
    $diam: Number(parts[8]) || 0,
    $key: Number(parts[9]) || 0,
    $star: Number(parts[10]) || 0,
    $bag: Number(parts[11]) || 0,
    $dungeon: { $lvl: Number(parts[12]) || 0, $f: parts[13] === 'true' },
    $rainbow: { $f: parts[14] === 'true' },
    $pond: { $q: Number(parts[15]) || 0 },
    $frog: parts[16] === 'true',
    $faerie: faerieLevels.map(v => ({ $level: Number(v) || 0 })),
    $vs: Number(parts[18]) || 0,
    $inv: inv,
    $current: cur,
    $checkpoint: checkpoint,
  };
}

// MotionBall 2 slot 0 pipe format (8 fields, slot 0 = Card state):
//   0:$items        bool csv (37 picto flags from TItems.TITEMS)
//   1:$challenge    "true"/"false"
//   2:$classic      "true"/"false"
//   3:$courses      bool csv (course unlocks)
//   4:$dungeons     bool csv (dungeon unlocks)
//   5:$dungeons_done bool csv (dungeon completions)
//   6:$classic_score number (best classic score)
//   7:$dtimes       number csv (best time per dungeon)
// Sparse array entries (undefined slots) come through as empty strings — treated as false/0.
// $records (CPU race times) is not serialised by the SWF because of its
// nested-object shape; we re-inject the Card.as defaults so course mode works
// after reload. Player-set course records are NOT persisted across sessions.
function parseMb2Pipe(s) {
  const parts = String(s).split('|');
  if (parts.length < 8) return null;
  function parseBoolArr(p) {
    if (!p) return [];
    return p.split(',').map(v => v === 'true');
  }
  function parseNumArr(p) {
    if (!p) return [];
    return p.split(',').map(v => v === '' ? 0 : Number(v) || 0);
  }
  const cpuTimes = (t1, t2, t3) => [{ $t: t1, $c: true }, { $t: t2, $c: true }, { $t: t3, $c: true }];
  const time = (m, sec) => (m * 60 + sec) * 100;
  return {
    $items: parseBoolArr(parts[0]),
    $challenge: parts[1] === 'true',
    $classic: parts[2] === 'true',
    $courses: parseBoolArr(parts[3]),
    $dungeons: parseBoolArr(parts[4]),
    $dungeons_done: parseBoolArr(parts[5]),
    $classic_score: Number(parts[6]) || 0,
    $dtimes: parseNumArr(parts[7]),
    $records: [
      cpuTimes(time(3, 0),  time(3, 40), time(4, 20)),
      cpuTimes(time(4, 0),  time(4, 40), time(5, 20)),
      cpuTimes(time(4, 30), time(5, 15), time(6, 0)),
      cpuTimes(time(2, 30), time(3, 0),  time(3, 30)),
      cpuTimes(time(3, 0),  time(3, 30), time(4, 0)),
      cpuTimes(time(4, 0),  time(4, 40), time(5, 20)),
      cpuTimes(time(4, 0),  time(4, 40), time(5, 20)),
    ],
  };
}

// ── MiniPixiz fairy/inventory safety net ──────────────────────────────────
// The rich FaerieSeed fields (name, skin, spells, carac, per-fairy inv…) and
// the item bag ($inv) NEVER travel in the save pipe — it only carries fairy
// levels and a CSV of bag ids. Those full objects live solely in the stored
// slot, so the forward-merge above is normally what re-grafts them onto each
// autosave. But that merge is skipped when the in-memory prev looks unhealthy
// and is abandoned wholesale if any step throws before its final stringify —
// either way a raw pipe save downgrades fairies to {$level} stubs and empties
// the bag (scalars, carried in the pipe, survive). That is the exact "only the
// fairy/inventory resets on restart" failure. The helpers below back an
// unconditional, exception-proof last line of defence applied just before the
// slot is persisted.
function minipixizFaerieIsRich(f) {
  if (!f || typeof f !== 'object' || Array.isArray(f)) return false;
  for (const k in f) {
    if (k !== '$level' && Object.prototype.hasOwnProperty.call(f, k)) return true;
  }
  return false;
}
function minipixizHasRichFaerie(obj) {
  return !!(obj && Array.isArray(obj.$faerie) && obj.$faerie.some(minipixizFaerieIsRich));
}
// Graft rich fairy objects + non-empty bag/selection/checkpoint from prev onto
// cur (mutates cur). Fairy $level from cur always wins; every other fairy field
// falls back to prev. Returns true when something was grafted.
function minipixizGraftRichState(cur, prev) {
  if (!cur || typeof cur !== 'object' || !prev || typeof prev !== 'object') return false;
  let changed = false;
  const pf = Array.isArray(prev.$faerie) ? prev.$faerie : [];
  const cf = Array.isArray(cur.$faerie) ? cur.$faerie : [];
  if (minipixizHasRichFaerie(prev)) {
    const curRich = cf.filter(minipixizFaerieIsRich).length;
    const prevRich = pf.filter(minipixizFaerieIsRich).length;
    if (cf.length < pf.length || curRich < prevRich) {
      const out = [];
      const n = Math.max(pf.length, cf.length);
      for (let i = 0; i < n; i++) {
        const p = pf[i], c = cf[i];
        if (p && typeof p === 'object' && !Array.isArray(p)) {
          const m = Object.assign({}, p);
          if (c && typeof c === 'object' && c.$level !== undefined) m.$level = c.$level;
          out.push(m);
        } else {
          out.push(c || p);
        }
      }
      cur.$faerie = out;
      changed = true;
    }
  }
  if ((!Array.isArray(cur.$inv) || cur.$inv.length === 0) && Array.isArray(prev.$inv) && prev.$inv.length > 0) {
    cur.$inv = prev.$inv; changed = true;
  }
  if ((cur.$current === null || cur.$current === undefined) && prev.$current !== null && prev.$current !== undefined) {
    cur.$current = prev.$current; changed = true;
  }
  if ((Number(prev.$checkpoint) || 0) > (Number(cur.$checkpoint) || 0)) {
    cur.$checkpoint = prev.$checkpoint; changed = true;
  }
  return changed;
}

app.post('/api/saveFrutiSlot', async (req, res) => {
  const params = Object.assign({}, req.query || {}, req.body || {});
  const sid = String(params.sid || '');
  const game = String(params.game || '');
  const slotId = String(params.slotId || '0');
  let data = String(params.data || '');

  // saveSlotData JS bridge JSON.stringify's the data, which double-wraps strings in quotes.
  // Unwrap if the data looks like a JSON-encoded string (starts/ends with ").
  if (data.length >= 2 && data[0] === '"' && data[data.length - 1] === '"') {
    try { const unwrapped = JSON.parse(data); if (typeof unwrapped === 'string') data = unwrapped; } catch {}
  }

  // MiniWave: pipe-delimited string → JSON (only for slot 0; slot 1 is prefs)
  if (game === 'miniwave' && slotId === '0' && data.indexOf('|') >= 0 && data[0] !== '{') {
    const obj = parseMiniwavePipe(data);
    if (obj) {
      data = JSON.stringify(obj);
      console.log(`[SLOT]  miniwave pipe → JSON (${data.length} chars)`);
    }
  }

  // MiniPixiz: pipe-delimited string → JSON
  if ((game === 'minipixiz' || game === 'minitroll') && slotId === '0' && data.indexOf('|') >= 0 && data[0] !== '{') {
    const rawPipe = data;
    const obj = parseMinipixizPipe(data);
    if (obj) {
      data = JSON.stringify(obj);
      // Show the TAIL of the pipe (scalar fields after the big $item array)
      // — the head is just 80 booleans we already see, the meaningful
      // progress markers live at the end.
      const pipeTail = rawPipe.length > 280 ? '…' + rawPipe.slice(-280) : rawPipe;
      console.log(`[SLOT]  minipixiz pipe (${rawPipe.length} chars) → JSON (${data.length} chars) tail=${pipeTail}`);
    }
  }

  // MotionBall 2: pipe-delimited string → JSON (slot 0 only)
  if (game === 'mb2' && slotId === '0' && data.indexOf('|') >= 0 && data[0] !== '{') {
    const obj = parseMb2Pipe(data);
    if (obj) {
      data = JSON.stringify(obj);
      console.log(`[SLOT]  mb2 pipe → JSON (${data.length} chars)`);
    }
  }

  let username = '';
  if (sid && sessions[sid]) username = sessions[sid].user || '';
  if (!username) {
    const ip = getClientIp(req);
    const fallbackSid = ip ? recentSidByIp.get(ip) : undefined;
    if (fallbackSid && sessions[fallbackSid]) username = sessions[fallbackSid].user || '';
  }
  if (!username || !game) {
    console.log(`[SLOT]  save REJECTED — sid=${sid} username=${username} game=${game}`);
    return res.type('text/plain').send('ok=0');
  }
  if (!users[username]) {
    console.log(`[SLOT]  save REJECTED — user ${username} not in memory`);
    return res.type('text/plain').send('ok=0');
  }

  if (!users[username].frutiSlots) users[username].frutiSlots = {};
  if (!users[username].frutiSlots[game]) users[username].frutiSlots[game] = {};
  const prevSlotData = users[username].frutiSlots[game][slotId];
  const dbId = users[username] && users[username]._dbId;

  // MiniPixiz "Ruffle-loss" recovery. The patched SWF used to serialise
  // $stat.$item/$eat/$kill/$game via `array + ""` — but Ruffle's AS2
  // Array.toString() silently returns "" for arrays bridged through JSON
  // parsing. The pipe came through with those fields empty, then
  // isMinipixizSlot0Corrupted rejected the save and nothing reached DB
  // (pictos and progression stalled). The patch script now emits an
  // explicit `array.join(",")` for those fields, so this branch should
  // only fire for browsers still running a stale cached SWF — we look up
  // the previous slot data (memory then DB) and graft its arrays onto the
  // new save's scalars so $run/$diam/etc. updates survive while we wait
  // for the cache bust.
  if (
    (game === 'minipixiz' || game === 'minitroll') &&
    slotId === '0' &&
    data && data[0] === '{' &&
    isMinipixizSlot0Corrupted(data)
  ) {
    try {
      const parsedNew = JSON.parse(data);
      const newStat = parsedNew.$stat || {};
      // Look up prev DB whenever the new save is corrupted — we used to
      // gate on hasScalarProgress, but that misses the common case where
      // the SWF posts $run=0 right after a Ruffle-side parseJSON glitch
      // wiped its in-memory arrays. If prev DB has real progress we'd
      // rather merge prev arrays in than reject and let the user grind
      // forever without unlocking pictos.
      let prevJson = prevSlotData;
      if (!isMinipixizSlotHealthy(prevJson) && dbId) {
        try {
          const dbSlots = await db.getFrutiSlots(dbId, game);
          const dbSlot0 = dbSlots && (dbSlots['0'] || dbSlots[0]);
          if (isMinipixizSlotHealthy(dbSlot0)) {
            prevJson = dbSlot0;
            users[username].frutiSlots[game]['0'] = dbSlot0;
          }
        } catch (e) {
          console.error(`[SLOT]  Ruffle-loss DB lookup failed for ${username}/${game}: ${e.message}`);
        }
      }
      if (isMinipixizSlotHealthy(prevJson)) {
        try {
          const prev = JSON.parse(prevJson);
          const prevStat = prev.$stat || {};
          const merged = JSON.parse(JSON.stringify(parsedNew));
          if (!merged.$stat) merged.$stat = {};
          // Keep prev arrays — they only grow during gameplay, so the
          // prev snapshot is a safe floor while the SWF can't transmit
          // its current state.
          for (const k of ['$item', '$eat', '$kill', '$game']) {
            const pv = prevStat[k];
            const nv = merged.$stat[k];
            if (Array.isArray(pv) && pv.length > 0 && (!Array.isArray(nv) || nv.length < pv.length)) {
              merged.$stat[k] = pv;
            }
          }
          // Scalars: prefer the larger of new vs prev (they only grow).
          // The SWF may post 0 when its in-memory copy was lost, but the
          // user's real progress lives in prev. Taking the max preserves
          // both forward progress this session and historical totals.
          for (const k of ['$run', '$forestMax', '$treeMax', '$misNum']) {
            const pv = Number(prevStat[k]) || 0;
            const nv = Number(merged.$stat[k]) || 0;
            if (pv > nv) merged.$stat[k] = pv;
          }
          for (const k of ['$diam', '$key', '$star', '$bag']) {
            const pv = Number(prev[k]) || 0;
            const nv = Number(merged[k]) || 0;
            if (pv > nv) merged[k] = pv;
          }
          // Same idea for faeries: collection that can grow; if the
          // new save dropped them, restore from prev.
          if (Array.isArray(prev.$faerie) && prev.$faerie.length > 0
              && (!Array.isArray(merged.$faerie) || merged.$faerie.length === 0)) {
            merged.$faerie = prev.$faerie;
          }
          // Nested progress containers — keep prev when new is missing/empty.
          if (prev.$dungeon && Number(prev.$dungeon.$lvl) > Number((merged.$dungeon || {}).$lvl || 0)) {
            merged.$dungeon = prev.$dungeon;
          }
          if (prev.$pond && Number(prev.$pond.$q) > Number((merged.$pond || {}).$q || 0)) {
            merged.$pond = prev.$pond;
          }
          if (prev.$rainbow && prev.$rainbow.$f && !(merged.$rainbow && merged.$rainbow.$f)) {
            merged.$rainbow = prev.$rainbow;
          }
          if (prev.$frog && !merged.$frog) merged.$frog = true;
          data = JSON.stringify(merged);
          console.log(`[SLOT]  RECOVERED minipixiz Ruffle-loss save for ${username} — merged prev arrays/scalars (new $run=${newStat.$run} prev $run=${prevStat.$run||0}, new $diam=${parsedNew.$diam} prev $diam=${prev.$diam||0})`);
        } catch (e) {
          console.error(`[SLOT]  Ruffle-loss merge failed for ${username}/${game}: ${e.message}`);
        }
      } else {
        console.log(`[SLOT]  Ruffle-loss: no healthy prev for ${username}/${game} — cannot recover (new $run=${newStat.$run}, $kill.len=${Array.isArray(newStat.$kill)?newStat.$kill.length:'?'}, $game.len=${Array.isArray(newStat.$game)?newStat.$game.length:'?'})`);
      }
    } catch (e) {
      console.error(`[SLOT]  Ruffle-loss parse failed for ${username}/${game}: ${e.message}`);
    }
  }

  // MiniPixiz: drop corrupted saves so they can't re-establish the cycle.
  // The SWF still in a corrupted session may keep posting scalar fields
  // until the user refreshes; we silently ack (ok=1) without storing.
  if ((game === 'minipixiz' || game === 'minitroll') && slotId === '0' && isMinipixizSlot0Corrupted(data)) {
    const sample = data.length > 220 ? data.slice(0, 220) + '…' : data;
    console.log(`[SLOT]  REJECT corrupted ${game} save for sid=${sid}: scalar $kill/$game/$item, not persisting — sample=${sample}`);
    return res.type('text/plain').send('ok=1');
  }

  // MiniPixiz: normal-save merge. Cm.card resets to formatFruticard()
  // defaults on each session ($run=0, sparse arrays), so a session that
  // plays less than the prev session's totals would clobber DB.$run and
  // friends downward. Take max(prev,new) for monotonically-growing scalars
  // and union the bool/num arrays so historical $item picto state survives.
  // Skipped when prev DB is empty (first-ever save) or new save is the
  // freshly-blocked default-clobber payload.
  if (
    (game === 'minipixiz' || game === 'minitroll') &&
    slotId === '0' &&
    data && data[0] === '{' &&
    !looksLikeMinipixizDefault(data)
  ) {
    try {
      const parsedNew = JSON.parse(data);
      let prevJson = prevSlotData;
      if (!isMinipixizSlotHealthy(prevJson) && dbId) {
        try {
          const dbSlots = await db.getFrutiSlots(dbId, game);
          const dbSlot0 = dbSlots && (dbSlots['0'] || dbSlots[0]);
          if (isMinipixizSlotHealthy(dbSlot0)) {
            prevJson = dbSlot0;
            users[username].frutiSlots[game]['0'] = dbSlot0;
          }
        } catch (e) {
          console.error(`[SLOT]  forward-merge DB lookup failed for ${username}/${game}: ${e.message}`);
        }
      }
      if (isMinipixizSlotHealthy(prevJson)) {
        const prev = JSON.parse(prevJson);
        const prevStat = prev.$stat || {};
        const merged = parsedNew;
        if (!merged.$stat) merged.$stat = {};
        // Scalars: take max so a fresh-formatFruticard session can't pull
        // historical totals down.
        for (const k of ['$run', '$forestMax', '$treeMax', '$misNum']) {
          const pv = Number(prevStat[k]) || 0;
          const nv = Number(merged.$stat[k]) || 0;
          if (pv > nv) merged.$stat[k] = pv;
        }
        for (const k of ['$diam', '$key', '$star', '$bag']) {
          const pv = Number(prev[k]) || 0;
          const nv = Number(merged[k]) || 0;
          if (pv > nv) merged[k] = pv;
        }
        // Bool array: $item — OR the entries so picto unlocks stick.
        const pi = Array.isArray(prevStat.$item) ? prevStat.$item : [];
        const ni = Array.isArray(merged.$stat.$item) ? merged.$stat.$item : [];
        if (pi.length || ni.length) {
          const maxLen = Math.max(pi.length, ni.length);
          const out = new Array(maxLen);
          for (let i = 0; i < maxLen; i++) out[i] = Boolean(pi[i]) || Boolean(ni[i]);
          merged.$stat.$item = out;
        }
        // Num arrays: $eat / $kill / $game — element-wise max.
        for (const k of ['$eat', '$kill', '$game']) {
          const pv = Array.isArray(prevStat[k]) ? prevStat[k] : [];
          const nv = Array.isArray(merged.$stat[k]) ? merged.$stat[k] : [];
          if (pv.length || nv.length) {
            const maxLen = Math.max(pv.length, nv.length);
            const out = new Array(maxLen).fill(0);
            for (let i = 0; i < maxLen; i++) {
              out[i] = Math.max(Number(pv[i]) || 0, Number(nv[i]) || 0);
            }
            merged.$stat[k] = out;
          }
        }
        // Faerie: the pipe save format (patch-minipixiz-client.js field
        // 17) only carries each fairy's $level — name, skin, spells,
        // carac, inv, taste, humor, exp, life, mana, hunger, moral,
        // mission, behaviour, mood, next, spellCoef, bagMax, shot, pos
        // are ALL dropped. Without this merge, the first SWF auto-save
        // after a rich import (or simply after gameplay) replaces the
        // full FaerieSeed objects with bare {$level: N} stubs → fairies
        // vanish from the in-game Fruticard and field rendering.
        //
        // Strategy: field-by-field merge per fairy index. Take $level
        // from new (it's the one field the pipe actually updates) and
        // keep every other field from prev. If the SWF later starts
        // transporting more fields, Object.assign lets the new value
        // win automatically — but until then, prev is the only source
        // of truth for everything except $level.
        const pf = Array.isArray(prev.$faerie) ? prev.$faerie : [];
        const nf = Array.isArray(merged.$faerie) ? merged.$faerie : [];
        if (pf.length > nf.length) {
          // SWF dropped a fairy slot — keep prev entirely (faeries
          // don't disappear mid-game).
          merged.$faerie = pf;
        } else if (nf.length > 0 && pf.length > 0) {
          const out = [];
          for (let i = 0; i < nf.length; i++) {
            const p = pf[i];
            const n = nf[i];
            if (p && typeof p === 'object' && !Array.isArray(p) &&
                n && typeof n === 'object' && !Array.isArray(n)) {
              out.push(Object.assign({}, p, n));
            } else {
              out.push(n || p);
            }
          }
          merged.$faerie = out;
        }
        // Nested progress containers — the pipe save only carries a few
        // fields per container; preserve the dropped sub-fields from prev.
        // $dungeon: pipe transports $lvl and $f; $day and $loop are lost.
        if (prev.$dungeon && typeof prev.$dungeon === 'object') {
          if (!merged.$dungeon || typeof merged.$dungeon !== 'object') merged.$dungeon = {};
          // Keep the existing "prev wins when lvl is higher" guard…
          if (Number(prev.$dungeon.$lvl) > Number(merged.$dungeon.$lvl || 0)) {
            merged.$dungeon = Object.assign({}, prev.$dungeon, merged.$dungeon);
          }
          // …and always fill in fields the pipe dropped.
          if (merged.$dungeon.$day === undefined  && prev.$dungeon.$day !== undefined)  merged.$dungeon.$day  = prev.$dungeon.$day;
          if (merged.$dungeon.$loop === undefined && prev.$dungeon.$loop !== undefined) merged.$dungeon.$loop = prev.$dungeon.$loop;
        }
        // $pond: pipe transports $q only; $d and $fs (the active pond
        // fairy — a full FaerieSeed) are lost. Without preserving $fs,
        // a fairy growing in the pond vanishes on the next save.
        if (prev.$pond && typeof prev.$pond === 'object') {
          if (!merged.$pond || typeof merged.$pond !== 'object') merged.$pond = {};
          if (Number(prev.$pond.$q) > Number(merged.$pond.$q || 0)) {
            merged.$pond = Object.assign({}, prev.$pond, merged.$pond);
          }
          if (merged.$pond.$d === undefined  && prev.$pond.$d !== undefined)  merged.$pond.$d  = prev.$pond.$d;
          if (merged.$pond.$fs === undefined && prev.$pond.$fs !== undefined) merged.$pond.$fs = prev.$pond.$fs;
        }
        // $rainbow: pipe transports $f only; $day and $it are lost.
        if (prev.$rainbow && typeof prev.$rainbow === 'object') {
          if (!merged.$rainbow || typeof merged.$rainbow !== 'object') merged.$rainbow = {};
          if (prev.$rainbow.$f && !merged.$rainbow.$f) {
            merged.$rainbow = Object.assign({}, prev.$rainbow, merged.$rainbow);
          }
          if (merged.$rainbow.$day === undefined && prev.$rainbow.$day !== undefined) merged.$rainbow.$day = prev.$rainbow.$day;
          if (merged.$rainbow.$it  === undefined && prev.$rainbow.$it  !== undefined) merged.$rainbow.$it  = prev.$rainbow.$it;
        }
        // Top-level fields the pipe drops entirely: $mission, $mis,
        // $help, $time, $god, $wind. Keep prev whenever new is missing.
        for (const k of ['$mission', '$mis', '$help', '$time', '$god', '$wind']) {
          if (merged[k] === undefined && prev[k] !== undefined) merged[k] = prev[k];
        }
        // $inv / $current / $checkpoint: the patched SWF now emits these (pipe
        // fields 19–21), but a stale 19-field SWF or a Ruffle array glitch can
        // still drop them (→ []/null/0). Keep prev's non-empty bag, selection
        // and checkpoint so an imported inventory survives the first autosave.
        if ((!Array.isArray(merged.$inv) || merged.$inv.length === 0) &&
            Array.isArray(prev.$inv) && prev.$inv.length > 0) {
          merged.$inv = prev.$inv;
        }
        if ((merged.$current === null || merged.$current === undefined) &&
            prev.$current !== null && prev.$current !== undefined) {
          merged.$current = prev.$current;
        }
        if ((Number(prev.$checkpoint) || 0) > (Number(merged.$checkpoint) || 0)) {
          merged.$checkpoint = prev.$checkpoint;
        }
        if (prev.$frog && !merged.$frog) merged.$frog = true;
        data = JSON.stringify(merged);
      }
    } catch (e) {
      console.error(`[SLOT]  forward-merge failed for ${username}/${game}: ${e.message}`);
    }
  }

  // Safeguard: when the SWF can't load saved slots on startup (miniwave),
  // the game may auto-save empty initial data and clobber real progress.
  // Refuse saves where the new payload is dramatically smaller than the
  // stored one for slot 0 of games where load-on-startup is disabled.
  const SAVE_GUARDED_GAMES = new Set(['miniwave', 'miniwave2']);
  if (
    SAVE_GUARDED_GAMES.has(game) &&
    slotId === '0' &&
    prevSlotData &&
    data &&
    data.length < prevSlotData.length * 0.5
  ) {
    console.log(`[SLOT]  save REJECTED — new data (${data.length}) much smaller than existing (${prevSlotData.length}) for ${username}/${game}/slot${slotId}`);
    return res.type('text/plain').send('ok=1'); // pretend success so SWF doesn't retry
  }

  // MiniPixiz: loadFruticard() creates fresh defaults when SharedObject is
  // empty (Ruffle doesn't persist SO between sessions, and the patched bytecode
  // depends on ExternalInterface.call("parseJSON", …) succeeding to seed
  // slots[0] from server data — if it returns null OR /api/loadFrutiSlots was
  // empty, the SWF falls through to formatFruticard() and saves the defaults).
  // We block any save that looks like fresh defaults whenever ANY prior healthy
  // data exists, checking memory first then DB as a fallback for the case
  // where hydrateUserFromDb errored silently at login.
  if ((game === 'minipixiz' || game === 'minitroll') && slotId === '0' && data && looksLikeMinipixizDefault(data)) {
    let healthy = isMinipixizSlotHealthy(prevSlotData);
    if (!healthy && dbId) {
      // In-memory cache is empty or non-healthy — check DB authoritatively
      // before we let a defaults save clobber yesterday's progress.
      try {
        const dbSlots = await db.getFrutiSlots(dbId, game);
        const dbSlot0 = dbSlots && (dbSlots['0'] || dbSlots[0]);
        if (isMinipixizSlotHealthy(dbSlot0)) {
          healthy = true;
          // Re-populate in-memory so subsequent reads (fcardloadslot etc.)
          // see the real progression and don't trigger another defaults
          // round-trip.
          users[username].frutiSlots[game]['0'] = dbSlot0;
        }
      } catch (e) {
        console.error(`[SLOT]  DB clobber-guard lookup failed for ${username}/${game}: ${e.message}`);
      }
    }
    if (healthy) {
      console.log(`[SLOT]  BLOCKED minipixiz default-clobber for ${username} — existing progress detected (mem=${!!prevSlotData}, dbId=${dbId || 'none'})`);
      return res.type('text/plain').send('ok=1');
    }
  }

  // MiniPixiz: exception-proof fairy/inventory safety net. Runs whether or not
  // the forward-merge above executed, was skipped (unhealthy in-memory prev),
  // or threw before its stringify. Re-grafts rich FaerieSeed objects + bag /
  // selection / checkpoint from the best available prev (memory → DB) so a
  // pipe-only autosave can never downgrade them to level stubs or an empty bag.
  if ((game === 'minipixiz' || game === 'minitroll') && slotId === '0' && data && data[0] === '{') {
    try {
      const cur = JSON.parse(data);
      let prevForGraft = null;
      try { if (prevSlotData) prevForGraft = JSON.parse(prevSlotData); } catch { /* ignore */ }
      // In-memory prev may itself be a stub (a prior bad save) — consult DB for
      // the authoritative rich state before grafting.
      if (!minipixizHasRichFaerie(prevForGraft) && dbId) {
        try {
          const dbSlots = await db.getFrutiSlots(dbId, game);
          const dbSlot0 = dbSlots && (dbSlots['0'] || dbSlots[0]);
          if (dbSlot0) {
            const dbObj = JSON.parse(dbSlot0);
            if (minipixizHasRichFaerie(dbObj) || (Array.isArray(dbObj.$inv) && dbObj.$inv.length > 0)) {
              prevForGraft = dbObj;
            }
          }
        } catch (e) {
          console.error(`[SLOT]  faerie-safety DB lookup failed for ${username}/${game}: ${e.message}`);
        }
      }
      if (prevForGraft && minipixizGraftRichState(cur, prevForGraft)) {
        data = JSON.stringify(cur);
        console.log(`[SLOT]  faerie-safety re-grafted rich fairy/bag for ${username} (faerie=${Array.isArray(cur.$faerie) ? cur.$faerie.length : 0}, inv=${Array.isArray(cur.$inv) ? cur.$inv.length : 0})`);
      }
    } catch (e) {
      console.error(`[SLOT]  faerie-safety failed for ${username}/${game}: ${e.message}`);
    }
  }

  users[username].frutiSlots[game][slotId] = data;
  if (dbId) {
    // Surface DB errors instead of swallowing them — silent catch here was
    // how progression vanished overnight (memory-only save, then Render's
    // free tier slept and wiped the process). If the upsert truly is
    // failing, we want loud logs, not silent data loss.
    db.upsertFrutiSlot(dbId, game, Number(slotId), data).catch((e) => {
      console.error(`[SLOT]  DB upsert FAILED for ${username}/${game}/slot${slotId}: ${e.message}`);
    });
  }

  // Extract game items (pictos/titems) from slot 0 data
  if (slotId === '0' && data) {
    try { extractGameItemsFromSlot(username, game, data); } catch (e) {
      console.log(`[SLOT]  item extraction error for ${game}: ${e.message}`);
    }
  }

  // BKiwi: capture the track the player just raced (savePublic runs before
  // saveScore), so we can route the score to the correct per-track ranking.
  if (game === 'bkiwi' && slotId === '0') {
    const t = detectBkiwiTrackFromSlotDiff(prevSlotData || '', data);
    if (t !== null) {
      users[username].bkiwiCurrentTrack = t;
      console.log(`[SLOT]  bkiwi current track for ${username} = ${t}`);
    } else {
      const prevPreview = String(prevSlotData || '').slice(0, 300);
      const newPreview = String(data || '').slice(0, 300);
      console.log(`[SLOT]  bkiwi track detection FAILED for ${username}`);
      console.log(`[SLOT]    prev: ${prevPreview}`);
      console.log(`[SLOT]    new:  ${newPreview}`);
    }
  }

  const preview = data.length > 200 ? data.slice(0, 200) + '…' : data;
  console.log(`[SLOT]  save ${username}/${game}/slot${slotId} (${data.length} chars): ${preview}`);
  res.type('text/plain').send('ok=1');
});

// ─────────────────────────────────────────────
// ENDPOINT: /api/diag — TEMP diagnostic sink. The SWF posts here via
// LoadVars.sendAndLoad (the ONE SWF→server channel proven to work in Ruffle;
// ExternalInterface is unreliable for these AS2 SWFs). Lets us trace whether
// in-SWF code paths (e.g. the sendAndLoad onLoad callback) actually execute,
// since EI-based console markers never surface.
app.all('/api/diag', (req, res) => {
  const params = Object.assign({}, req.query || {}, req.body || {});
  let msg = params.data != null ? params.data : params.msg;
  if (msg == null && typeof req.body === 'string') msg = req.body;
  console.log('[DIAG] ' + String(msg == null ? '(no data)' : msg).slice(0, 600));
  res.type('text/plain').send('ok=1');
});

// ENDPOINT: /api/loadFrutiSlots — Load all FrutiCard slots for a game.
// Returns LoadVars format: slot0=<json>&slot1=<json>&slot2=<json>
// ─────────────────────────────────────────────
app.all('/api/loadFrutiSlots', async (req, res) => {
  const params = Object.assign({}, req.query || {}, req.body || {});
  const sid = String(params.sid || '');
  const game = String(params.game || '');

  let username = '';
  if (sid && sessions[sid]) username = sessions[sid].user || '';
  if (!username) {
    const ip = getClientIp(req);
    const fallbackSid = ip ? recentSidByIp.get(ip) : undefined;
    if (fallbackSid && sessions[fallbackSid]) username = sessions[fallbackSid].user || '';
  }

  let response = 'ok=1';
  if (username && users[username]) {
    if (!users[username].frutiSlots || !users[username].frutiSlots[game]) {
      const dbId = users[username]._dbId;
      if (dbId) {
        try {
          const dbSlots = await db.getFrutiSlots(dbId, game);
          if (Object.keys(dbSlots).length > 0) {
            if (!users[username].frutiSlots) users[username].frutiSlots = {};
            users[username].frutiSlots[game] = dbSlots;
          }
        } catch (e) {
          // Critical: a silent failure here is what makes the SWF think the
          // user has no save data, run formatFruticard() and clobber. We
          // signal the failure so the SWF won't seed a fresh card from an
          // empty response — saveFrutiSlot's clobber-guard will still catch
          // it as a second line of defence, but surfacing the error makes
          // the root cause visible in logs.
          console.error(`[LOAD] getFrutiSlots(${dbId},${game}) failed for ${username}: ${e.message}`);
          return res.type('text/plain').status(503).send('ok=0&error=db_unavailable');
        }
      }
    }

    // Provide default slot data for games that need it when no save exists.
    // Swapou2: slot0 = character unlocks + stats, slot1 = preferences.
    // These match the defaults from swapou2/Client.as:onServiceConnect().
    if (game === 'swapou2') {
      if (!users[username].frutiSlots) users[username].frutiSlots = {};
      if (!users[username].frutiSlots[game]) users[username].frutiSlots[game] = {};
      const gs = users[username].frutiSlots[game];
      if (gs['0'] === undefined) {
        gs['0'] = JSON.stringify({"$chars":[true,true,false,false,false,false,false,false,false],"$record":0,"$classic_record":0,"$swap":0,"$items":[],"$combos":[]});
      }
      if (gs['1'] === undefined) {
        gs['1'] = JSON.stringify({"$sound":true,"$music":true,"$lod":3});
      }
    }

    // MB2 (MotionBall 2): slot0 = game card (modes, scores, items),
    // slot1 = preferences. Defaults match mb2/Card.as constructor.
    if (game === 'mb2') {
      if (!users[username].frutiSlots) users[username].frutiSlots = {};
      if (!users[username].frutiSlots[game]) users[username].frutiSlots[game] = {};
      const gs = users[username].frutiSlots[game];
      if (gs['0'] === undefined) {
        const cpuTimes = (t1, t2, t3) => [{"$t": t1, "$c": true}, {"$t": t2, "$c": true}, {"$t": t3, "$c": true}];
        const time = (m, s) => (m * 60 + s) * 100;
        gs['0'] = JSON.stringify({
          "$items": [],
          "$challenge": true,
          "$classic": true,
          "$dungeons": [true, true, true, true],
          "$dungeons_done": [],
          "$courses": [true],
          "$classic_score": 0,
          "$dtimes": [],
          "$records": [
            cpuTimes(time(3,0),  time(3,40), time(4,20)),
            cpuTimes(time(4,0),  time(4,40), time(5,20)),
            cpuTimes(time(4,30), time(5,15), time(6,0)),
            cpuTimes(time(2,30), time(3,0),  time(3,30)),
            cpuTimes(time(3,0),  time(3,30), time(4,0)),
            cpuTimes(time(4,0),  time(4,40), time(5,20)),
            cpuTimes(time(4,0),  time(4,40), time(5,20))
          ]
        });
      }
      if (gs['1'] === undefined) {
        gs['1'] = JSON.stringify({"$music": true, "$sounds": true});
      }
    }

    if (users[username].frutiSlots && users[username].frutiSlots[game]) {
      const slots = users[username].frutiSlots[game];
      // Auto-repair: corrupted minipixiz slot 0 (scalar fields where arrays
      // are expected) loops forever via save→load, so reset to formatFruticard
      // defaults before serving to the SWF. The "progress" lost was already
      // unreachable because gameplay writes to primitives were silently dropped.
      if ((game === 'minipixiz' || game === 'minitroll') && slots['0'] && isMinipixizSlot0Corrupted(slots['0'])) {
        console.log(`[SLOT]  REPAIR ${game} slot0 for ${username}: corrupted scalar fields detected, replacing with fresh defaults`);
        slots['0'] = FRESH_MINIPIXIZ_SLOT0;
        const dbId = users[username]._dbId;
        if (dbId) db.upsertFrutiSlot(dbId, game, 0, FRESH_MINIPIXIZ_SLOT0).catch((e) => console.error('[DB] repair upsert error:', e.message));
      }
      // Extract pictos from slot 0 on load (catches items from before this feature existed)
      if (slots['0']) {
        try { extractGameItemsFromSlot(username, game, slots['0']); } catch (e) {
          console.log(`[SLOT]  load-extract error for ${game}: ${e.message}`);
        }
      }
      for (const [key, val] of Object.entries(slots)) {
        // MiniPixiz: pad slot0 with the full Card structure (incl.
        // $inv/$current/$help/$mis/$wind/$god/$time/$mission/$checkpoint
        // and the extra sub-object fields). Without this padding the SWF's
        // fromJSON treats the payload as malformed and Cm.card falls back
        // to formatFruticard defaults, hiding loaded progress in-game.
        let outVal = val;
        if ((game === 'minipixiz' || game === 'minitroll') && key === '0') {
          outVal = padMinipixizSlot0(val);
        }
        response += `&slot${key}=${encodeURIComponent(outVal)}`;
      }

      // MiniPixiz flat fields: Ruffle's eval()-based JSON parse in the SWF's
      // _client.fromJSON returns null, so onLoad's fromJSON branch can't
      // populate slots[0] and Cm.card ends up empty. Emit each Card field
      // as a separate LoadVars property so the patched onLoad can rebuild
      // the Card object manually without invoking fromJSON. Field naming:
      // mpx_<key> for scalars, mpx_<key> for CSV-encoded arrays.
      if ((game === 'minipixiz' || game === 'minitroll') && slots['0']) {
        try {
          const c = JSON.parse(slots['0']);
          const s = c.$stat || {};
          const boolArr = (a) => Array.isArray(a) ? a.map((v) => v ? '1' : '0').join(',') : '';
          const numArr  = (a) => Array.isArray(a) ? a.map((v) => Number(v) || 0).join(',') : '';
          const faerieArr = (a) => Array.isArray(a) ? a.map((f) => Number(f && f.$level) || 0).join(',') : '';
          const flat = {
            mpx_run:        Number(s.$run) || 0,
            mpx_forestMax:  Number(s.$forestMax) || 0,
            mpx_treeMax:    Number(s.$treeMax) || 0,
            mpx_misNum:     Number(s.$misNum) || 0,
            mpx_item:       boolArr(s.$item),
            mpx_eat:        numArr(s.$eat),
            mpx_kill:       numArr(s.$kill),
            mpx_game:       numArr(s.$game),
            mpx_diam:       Number(c.$diam) || 0,
            mpx_key:        Number(c.$key) || 0,
            mpx_star:       Number(c.$star) || 0,
            mpx_bag:        Number(c.$bag) || 0,
            mpx_dungeonLvl: Number(c.$dungeon && c.$dungeon.$lvl) || 0,
            mpx_dungeonF:   (c.$dungeon && c.$dungeon.$f) ? '1' : '0',
            mpx_rainbowF:   (c.$rainbow && c.$rainbow.$f) ? '1' : '0',
            mpx_pondQ:      Number(c.$pond && c.$pond.$q) || 0,
            mpx_frog:       c.$frog ? '1' : '0',
            mpx_faerie:     faerieArr(c.$faerie),
            mpx_vs:         (typeof c.$vs === 'number') ? c.$vs : 1.1,
          };
          for (const [k, v] of Object.entries(flat)) {
            response += `&${k}=${encodeURIComponent(String(v))}`;
          }
        } catch (e) {
          console.log(`[SLOT]  minipixiz flat-emit failed for ${username}: ${e.message}`);
        }
      }
    }
  }
  // Fallback: even without a logged-in user, MB2 needs valid slot data so
  // the menu enables all game modes (Challenge, Course, Adventure, Classic).
  if (game === 'mb2' && !response.includes('slot0=')) {
    const cpuTimes = (t1, t2, t3) => [{"$t": t1, "$c": true}, {"$t": t2, "$c": true}, {"$t": t3, "$c": true}];
    const time = (m, s) => (m * 60 + s) * 100;
    const defaultCard = JSON.stringify({
      "$items": [], "$challenge": true, "$classic": true,
      "$dungeons": [true, true, true, true], "$dungeons_done": [],
      "$courses": [true], "$classic_score": 0, "$dtimes": [],
      "$records": [
        cpuTimes(time(3,0), time(3,40), time(4,20)),
        cpuTimes(time(4,0), time(4,40), time(5,20)),
        cpuTimes(time(4,30), time(5,15), time(6,0)),
        cpuTimes(time(2,30), time(3,0), time(3,30)),
        cpuTimes(time(3,0), time(3,30), time(4,0)),
        cpuTimes(time(4,0), time(4,40), time(5,20)),
        cpuTimes(time(4,0), time(4,40), time(5,20))
      ]
    });
    const defaultPrefs = JSON.stringify({"$music": true, "$sounds": true});
    response += `&slot0=${encodeURIComponent(defaultCard)}&slot1=${encodeURIComponent(defaultPrefs)}`;
  }

  // Log the slot keys + first chars of each value so we can see what the
  // game has saved (or hasn't) when diagnosing missing-character issues.
  const slotKeys = (username && users[username] && users[username].frutiSlots && users[username].frutiSlots[game])
    ? Object.keys(users[username].frutiSlots[game]) : [];
  console.log(`[SLOT]  load sid=${sid} user=${username || '(none)'} game=${game} slots=[${slotKeys.join(',')}] respLen=${response.length}`);
  if (slotKeys.length) {
    const isMinipixiz = game === 'minipixiz' || game === 'minitroll';
    for (const k of slotKeys) {
      const v = users[username].frutiSlots[game][k];
      // For minipixiz slot0 we dump the full value so we can audit exactly
      // what the SWF's fromJSON parser receives — truncation was hiding the
      // tail of the JSON ($run/$diam/$faerie etc.) which is critical to
      // diagnose runtime-state drift between server data and Cm.card.
      const limit = (isMinipixiz && k === '0') ? 4000 : 200;
      const prev = String(v).length > limit ? String(v).slice(0, limit) + '…' : v;
      console.log(`[SLOT]    slot${k}=${prev}`);
    }
  }
  res.type('text/plain').send(response);
});

// main.swf is hot-pathed by every page load. Cache it in memory at boot —
// reports of "stuck at 9%" came from a combination of three things:
//   1. sendFile re-reads the file from disk on every request (slow on
//      Render's free-tier ephemeral storage),
//   2. the compression middleware was gzip-ing the already-compressed SWF
//      bytes into a chunked transfer-encoded response with no Content-Length,
//   3. when Render's worker recycles mid-stream, the browser sees a partial
//      response and never recovers — the Ruffle loader bar freezes wherever
//      it was (commonly ~36 KB = ~9% of the 400 KB SWF).
// Serving from a pre-loaded buffer with an explicit Content-Length gives the
// loader a real progress total and ships the bytes in one shot, so a single
// dropped TCP connection is the worst case (and the browser retries that).
// The compression middleware now also skips application/x-shockwave-flash
// so no chunked re-encoding can interrupt the transfer.
const MAIN_SWF_PATH = path.join(__dirname, 'legacy', 'main.swf');
// legacy/main.swf ships at 100 fps. Ruffle honours that literally and re-runs
// the whole AVM + re-tessellates every animated bouille 100×/s, which is the
// main CPU/GPU drain in chat rooms (native Flash on period hardware never
// sustained it). We rewrite the 2-byte frame-rate field in the served buffer
// down to this cap — disk file untouched, tunable here.
const MAIN_SWF_FPS_CAP = 30;
let MAIN_SWF_BUF = null;
let MAIN_SWF_ETAG = null;
// Rewrite a SWF's header frame-rate down to capFps (no-op if already ≤ cap or
// not a CWS/FWS SWF). Returns a new buffer; the uncompressed length is
// unchanged (only 2 bytes flip) so the file-length header stays valid.
function capSwfFrameRate(buf, capFps) {
  try {
    const sig = buf.toString('ascii', 0, 3);
    let body, compressed;
    if (sig === 'CWS') { body = zlib.inflateSync(buf.slice(8)); compressed = true; }
    else if (sig === 'FWS') { body = Buffer.from(buf.slice(8)); compressed = false; }
    else return buf; // ZWS/LZMA or non-SWF — leave untouched
    const nbits = body[0] >> 3;            // RECT: top 5 bits of first byte
    const off = Math.ceil((5 + 4 * nbits) / 8); // bytes consumed by the RECT
    const curFps = body[off + 1] + body[off] / 256; // FIXED8, little-endian
    if (!(curFps > capFps)) return buf;
    body[off] = 0;                 // fractional part
    body[off + 1] = capFps & 0xFF; // integer part
    const payload = compressed ? zlib.deflateSync(body) : body;
    console.log(`[MAIN.SWF] frame-rate ${Math.round(curFps)}fps -> ${capFps}fps`);
    return Buffer.concat([buf.slice(0, 8), payload]); // header (incl. uncompressed length) unchanged
  } catch (e) {
    console.error('[MAIN.SWF] frame-rate cap failed, serving original:', e.message);
    return buf;
  }
}
function loadMainSwfFromDisk() {
  try {
    MAIN_SWF_BUF = capSwfFrameRate(fs.readFileSync(MAIN_SWF_PATH), MAIN_SWF_FPS_CAP);
    MAIN_SWF_ETAG = '"' + crypto.createHash('sha1').update(MAIN_SWF_BUF).digest('hex') + '"';
    console.log(`[MAIN.SWF] cached ${MAIN_SWF_BUF.length} bytes, etag=${MAIN_SWF_ETAG}`);
  } catch (e) {
    MAIN_SWF_BUF = null;
    MAIN_SWF_ETAG = null;
    console.error(`[MAIN.SWF] failed to read ${MAIN_SWF_PATH}: ${e.message}`);
  }
}
loadMainSwfFromDisk();

app.get('/legacy/main.swf', (req, res) => {
  if (!MAIN_SWF_BUF) {
    // Defensive fallback — should never happen after a successful boot,
    // but if the buffer is somehow gone, retry from disk one time so a
    // post-deploy hot-swap of legacy/main.swf still works without a
    // process restart.
    loadMainSwfFromDisk();
    if (!MAIN_SWF_BUF) {
      return res.status(503).type('text/plain').send('main.swf unavailable');
    }
  }
  if (MAIN_SWF_ETAG && req.headers['if-none-match'] === MAIN_SWF_ETAG) {
    return res.status(304).end();
  }
  if (MAIN_SWF_ETAG) res.set('ETag', MAIN_SWF_ETAG);
  // no-transform tells any intermediary (and the compression middleware) not
  // to re-encode; we want the raw SWF bytes to arrive byte-for-byte so
  // Ruffle's loader sees a stable Content-Length and a clean stream.
  res.set('Cache-Control', 'no-cache, must-revalidate, no-transform');
  res.set('Content-Type', 'application/x-shockwave-flash');
  res.set('Content-Length', String(MAIN_SWF_BUF.length));
  res.end(MAIN_SWF_BUF);
});

app.get(['/fonts.swf', '/legacy/fonts.swf', '/sw/fonts.swf'], (req, res) => {
  // Always log fonts.swf requests so we can verify Ruffle is fetching it
  // via fontSources (font loading is critical for chat typography).
  console.log('[SWF] fonts.swf requested:', req.url, 'UA:', req.headers['user-agent']);
  res.type('application/x-shockwave-flash');
  res.sendFile(fontsPath);
});

// Explicit route for fileIcon.swf — Ruffle's loadMovie() fetches this
// during the loading screen.  Serving it explicitly (with logging and
// correct Content-Type) helps diagnose and resolve pending-fetch issues.
app.get('/fileIcon.swf', (req, res) => {
  if (VERBOSE_SWF_LOGS) {
    console.log('[SWF]   fileIcon.swf requested');
  }
  res.type('application/x-shockwave-flash');
  res.sendFile(path.join(__dirname, 'public', 'fileIcon.swf'));
});



app.get(['/frusion_client.swf', '/swf/frusion_client.swf'], (req, res) => {
  const defaultClient = path.join(__dirname, 'public', 'frusion_client.swf');
  let candidate = FRUSION_CLIENT_SWF
    ? path.resolve(__dirname, FRUSION_CLIENT_SWF)
    : defaultClient;

  // Safety rail: frusion_server.swf is not the normal launcher.
  // Use it only when explicitly allowed for experiments.
  if (!ALLOW_FRUSION_SERVER_SWF && /frusion_server\.swf$/i.test(candidate)) {
    if (VERBOSE_SWF_LOGS || VERBOSE_FRUSION_LOGS) {
      console.log('[SWF]   FRUSION_CLIENT_SWF points to frusion_server.swf; ignoring unless ALLOW_FRUSION_SERVER_SWF=1');
    }
    candidate = defaultClient;
  }
  const fallback = path.join(__dirname, 'frusion', 'saf_debug.swf');
  let servedPath = candidate;
  try {
    const st = fs.statSync(candidate);
    if (!st.isFile() || st.size <= 0) {
      servedPath = fallback;
    }
  } catch {
    servedPath = fallback;
  }
  if (VERBOSE_SWF_LOGS || VERBOSE_FRUSION_LOGS) {
    let size = '?';
    try { size = String(fs.statSync(servedPath).size); } catch {}
    console.log(`[SWF]   frusion_client.swf requested -> serving ${path.relative(__dirname, servedPath)} (${size} bytes)`);
  }
  res.type('application/x-shockwave-flash');
  res.sendFile(servedPath);
});

// Legacy Frusion launcher target used by game discs.
// Keep querystring untouched so game params are forwarded.
app.get('/frusion', (req, res) => {
  const params = new URLSearchParams(req.query || {});
  if (!params.get('launch_id')) {
    const seed = String(params.get('sid') || crypto.randomBytes(4).toString('hex'));
    params.set('launch_id', `${seed.slice(0, 8)}-${Date.now().toString(36)}`);
  }
  if (VERBOSE_FRUSION_LOGS) {
    console.log(`[FRUSION] launch redirect launch_id=${params.get('launch_id')} sid=${params.get('sid') || ''} game=${params.get('gameName') || ''} u=${params.get('u') || ''}`);
  }
  // Set the game icon on the user's presence indicator via the chat socket.
  // The SWF's FPFrusionSlot.setInternal never fires in Ruffle (LocalConnection
  // between Ruffle instances is broken), so we trigger it server-side here.
  const frusionSid = params.get('sid') || '';
  const gameName = params.get('gameName') || '';
  const sess = frusionSid ? sessions[frusionSid] : null;
  const frusionUser = sess && sess.user;
  const internalCode = statusInternalCode(gameName);
  console.log(`[FRUSION] launch sid=${frusionSid} game=${gameName} user=${frusionUser || '-'} internal=${internalCode}`);
  if (frusionUser && internalCode > 0) {
    setUserInternalStatus(frusionUser, internalCode);
  }
  res.redirect(`/frusion-ruffle.html?${params.toString()}`);
});

function sendAvatarFamily(res, fileName) {
  const absPath = path.join(__dirname, 'public', 'swf', 'fbouille', fileName);

  if (!fs.existsSync(absPath)) {
    if (VERBOSE_SWF_LOGS) {
      console.log(`[SWF]   Missing avatar asset: ${absPath}`);
    }
    return res.status(404).type('text/plain').send('Missing SWF');
  }

  if (VERBOSE_SWF_LOGS) {
    console.log(`[SWF]   Serving avatar asset: ${fileName}`);
  }

  if (VERBOSE_SWF_LOGS) {
    console.log(`[SWF]   Serving avatar asset: ${fileName}`);
  }
  res.type('application/x-shockwave-flash');
  res.set('Cache-Control', 'no-store');
  res.sendFile(absPath);
}

app.get(
  ['/famille0.swf', '/fbouille/famille0.swf', '/swf/fbouille/famille0.swf'],
  (req, res) => sendAvatarFamily(res, 'famille0.swf')
);

app.get(
  ['/famille1.swf', '/fbouille/famille1.swf', '/swf/fbouille/famille1.swf'],
  (req, res) => sendAvatarFamily(res, 'famille1.swf')
);

// ─────────────────────────────────────────────
// ENDPOINT: do/init — Session initialization
// Returns LoadVars: sid=<session_id>
// ─────────────────────────────────────────────
app.get('/do/init', (req, res) => {
  const sid = crypto.randomBytes(16).toString('hex');
  sessions[sid] = { user: null, createdAt: Date.now() };
  console.log(`[do/init] New session: ${sid}`);
  res.type('text/plain').send(`sid=${sid}`);
});

// ─────────────────────────────────────────────
// ENDPOINT: do/prefdef — Preference definitions
// Returns LoadVars: PrefDef=<encoded_string>
// ─────────────────────────────────────────────
app.get('/do/prefdef', (req, res) => {
  res.type('text/plain').send(`PrefDef=${buildPrefDefString()}`);
});

// Keep the advertised service port aligned with the live XMLSocket port.
app.get('/xml/services.xml', (req, res) => {
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const rawHost = PUBLIC_HOST || forwardedHost || req.headers.host || 'localhost';
  let publicHost = rawHost;
  try {
    publicHost = new URL(`http://${rawHost}`).hostname;
  } catch {
    publicHost = String(rawHost).split(':')[0] || 'localhost';
  }
  // Include game names as service entries so FrusionServer can find ports
  // (_global.cbeePort[gameDisc.swfName] must resolve to a valid port).
  const gameServiceEntries = Object.values(GAME_DISCS)
    .map((d) => d.swfName)
    .filter((v, i, a) => a.indexOf(v) === i) // unique names
    .map((n) => `<service name="${escapeXml(n)}" port="${XMLSOCKET_PORT}" />`)
    .join('');
  res.type('text/xml').send(
    `<services host="${escapeXml(publicHost)}"><service name="frutichat" port="${XMLSOCKET_PORT}" /><service name="frutiscore" port="${FRUTISCORE_PORT}" />${gameServiceEntries}</services>`
  );
});

// ─────────────────────────────────────────────
// ENDPOINT: do/mypref — User's personal preferences
// Returns LoadVars: myPref=<encoded_string>
// ─────────────────────────────────────────────
app.get('/do/mypref', (req, res) => {
  const sid = req.query.sid;
  const session = sessions[sid];
  const user = session && users[session.user];
  const myPref = (user && user.prefs) || '';
  res.type('text/plain').send(`myPref=${myPref}`);
});

// ─────────────────────────────────────────────
// ENDPOINT: do/prefsave — Save all preferences
// Returns LoadVars: state=0
// ─────────────────────────────────────────────
app.get('/do/prefsave', (req, res) => {
  const sid = req.query.sid;
  const session = sessions[sid];
  if (session && session.user && users[session.user]) {
    users[session.user].prefs = req.query.s || '';
    const dbId = users[session.user]._dbId;
    if (dbId) db.updateUser(session.user, { prefs: req.query.s || '' }).catch(dbErr('updateUser'));
  }
  res.type('text/plain').send('state=0');
});

// ─────────────────────────────────────────────
// ENDPOINT: do/eb — Edit/validate frutibouille (avatar)
// Called when the editbouille window opens or saves.
// Params: b=<fbouille_string>, sid=<session_id>
// Returns LoadVars: state=0 (success)
// ─────────────────────────────────────────────
function resolveUsernameFromSid(sid) {
  if (sid && sessions[sid] && sessions[sid].user && users[sessions[sid].user]) {
    return sessions[sid].user;
  }
  return null;
}

function getSessionBySid(sid) {
  if (!sid || !sessions[sid]) return null;
  return sessions[sid];
}

function requireAuthBySid(sid, res, responseType = 'text/plain') {
  const username = resolveUsernameFromSid(sid);
  if (!username) {
    if (responseType === 'text/xml') {
      res.status(401).type('text/xml').send('<r k="401">auth_required</r>');
    } else {
      res.status(401).type('text/plain').send('state=1&error=auth_required');
    }
    return null;
  }
  return { username, user: users[username] };
}

function getSidFromParams(source) {
  if (!source) return '';
  const raw = source.sid || source.c || '';
  return Array.isArray(raw) ? raw[0] : raw;
}

function getSidFromRequest(req, source = null) {
  const direct = getSidFromParams(source) || getSidFromParams(req && req.query);
  if (direct) return direct;

  // Some legacy calls (notably /do/smi) omit sid/c entirely.
  // Recover sid from Referer (e.g. /legacy?sid=...).
  const referer = String((req && req.headers && req.headers.referer) || '');
  if (referer) {
    try {
      const u = new URL(referer);
      const fromRef = u.searchParams.get('sid') || u.searchParams.get('c') || '';
      if (fromRef) return fromRef;
    } catch {
      // ignore malformed referer
    }
  }

  const ip = req ? getClientIp(req) : '';
  if (ip && recentSidByIp.has(ip)) {
    return recentSidByIp.get(ip) || '';
  }

  return '';
}

app.all('/do/eb', (req, res) => {
  const source = req.method === 'POST' ? req.body : req.query;

  const sid = source.sid || '';
  const rawBouille = source.b || source.s || source.f || '';
  const bouille = normalizeBouilleState(rawBouille);
  const auth = requireAuthBySid(sid, res);
  if (!auth) return;

  auth.user.fbouille = bouille;
  bouilleCache[auth.username] = bouille;
  if (auth.user._dbId) db.updateUser(auth.username, { fbouille: bouille, needs_bouille: false }).catch(dbErr('updateUser'));

  console.log(`[do/eb] Saved bouille for ${auth.username}: ${bouille}`);
  // Legacy callers consume LoadVars here; include k=0 to avoid error.http.undefined
  // while keeping historical bouille fields.
  res.type('text/plain').send(`state=0&k=0&b=${bouille}&s=${bouille}&f=${bouille}`);
});

// ─────────────────────────────────────────────
// ENDPOINT: do/give — Transfer kikooz to another user (/donne command)
// Params: k=<amount>, u=<target username>, r=<reason>, sid=<session_id>
// Returns XML: <r k="0" a="<sender new balance>" u="<target>" g="<amount>"/>
// On failure: <r k="<errorCode>"/>
//   k="1"  invalid parameters
//   k="2"  cannot give to yourself
//   k="3"  target user unknown
//   k="4"  not enough kikooz
// ─────────────────────────────────────────────
app.all('/do/give', (req, res) => {
  const source = req.method === 'POST' ? { ...req.query, ...(req.body || {}) } : req.query;
  const sid = getSidFromRequest(req, source);
  const auth = requireAuthBySid(sid, res, 'text/xml');
  if (!auth) return;
  const { user, username } = auth;

  const amount = Math.floor(Number(source.k));
  const targetRaw = String(source.u || '').trim();
  const reason = String(source.r || '').trim();

  if (!Number.isFinite(amount) || amount <= 0 || !targetRaw) {
    return res.type('text/xml').send('<r k="1" />');
  }
  const targetName = resolveKnownUsername(targetRaw);
  if (targetName.toLowerCase() === username.toLowerCase()) {
    return res.type('text/xml').send('<r k="2" />');
  }
  const target = users[targetName];
  if (!target) {
    return res.type('text/xml').send('<r k="3" />');
  }
  if (typeof user.kikooz !== 'number') user.kikooz = 0;
  if (user.kikooz < amount) {
    return res.type('text/xml').send('<r k="4" />');
  }

  user.kikooz -= amount;
  target.kikooz = (typeof target.kikooz === 'number' ? target.kikooz : 0) + amount;
  if (user._dbId) db.updateUser(username, { kikooz: user.kikooz }).catch(dbErr('updateUser'));
  if (target._dbId) db.updateUser(targetName, { kikooz: target.kikooz }).catch(dbErr('updateUser'));

  const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 19);

  // Log in recipient's kikooz history (type "c" = kcall / received kikooz)
  if (!Array.isArray(target.kikoozLog)) target.kikoozLog = [];
  target.kikoozLog.unshift({
    type: 'c',
    t: nowStr,
    k: amount,
    c: username,
  });
  if (target.kikoozLog.length > 200) target.kikoozLog.length = 200;

  console.log(`[do/give] ${username} → ${targetName}: ${amount} kikooz${reason ? ' ('+reason+')' : ''}`);

  const xml = `<r k="0" a="${user.kikooz}" u="${escapeXml(targetName)}" g="${amount}" />`;
  res.type('text/xml').send(xml);
});

function handleNewBouille(req, res) {
  const sid = req.query.sid;
  const auth = requireAuthBySid(sid, res);
  if (!auth) return;
  const { user } = auth;

  const entry = {
    id: 'acc_' + crypto.randomBytes(4).toString('hex'),
    q: String(req.query.q || ''),
    n: String(req.query.n || '').trim(),
    p: String(req.query.p || ''),
    v: normalizeBouilleState(req.query.v || ''),
    at: new Date().toISOString().replace('T', ' ').substring(0, 19),
  };

  if (!Array.isArray(user.customAccessories)) user.customAccessories = [];
  user.customAccessories.push(entry);
  if (user._dbId) db.addAccessory(user._dbId, entry).catch(dbErr('addAccessory'));

  res
    .type('text/plain')
    .send(`state=0&id=${entry.id}&n=${encodeURIComponent(entry.n)}&q=${entry.q}&p=${entry.p}&v=${entry.v}`);
}

// ─────────────────────────────────────────────
// ENDPOINT: do/newbouille — Create/save accessory item
// Used by admin "Frutibouille" tooling.
// Params: q=<quantity/type>, n=<name>, p=<price>, v=<value>, sid=<session_id>
// Returns LoadVars: state=0
// Accept both /do/newbouille and /newbouille to tolerate legacy URL rewrites.
// ─────────────────────────────────────────────
app.get('/do/newbouille', handleNewBouille);
app.get('/newbouille', handleNewBouille);

// ─────────────────────────────────────────────
// ENDPOINT: do/gmi — Get my info (user profile data)
// Returns XML payload used by the "Edit my info" legacy window
// ─────────────────────────────────────────────
app.get('/do/gmi', (req, res) => {
  const sid = getSidFromRequest(req, req.query);
  const auth = requireAuthBySid(sid, res);
  if (!auth) return;
  const { user } = auth;

  const birthday = String(user.birthday || '2000-01-01');
  const firstName = String(user.firstName || '');
  const lastName = String(user.lastName || '');
  const lastNamePublic = String(user.lastNamePublic || 'Y').toUpperCase() === 'N' ? 'N' : 'Y';
  const gender = String(user.gender || 'M');
  const realJob = String(user.realJob || 'Frutiz');
  const city = String(user.city || '');
  const countryIndex = String(user.countryIndex || '1');
  const regionIndex = String(user.regionIndex || '1');
  const siteUrl = String(user.siteUrl || '');
  const comment = String(user.comment || '');
  const departmentIndex = String(user.departmentIndex || '1');

  const xml = `<i>
  <d>${escapeXml(birthday)}</d>
  <f>${escapeXml(firstName)}</f>
  <l p="${escapeXml(lastNamePublic)}">${escapeXml(lastName)}</l>
  <g>${escapeXml(gender)}</g>
  <j>${escapeXml(realJob)}</j>
  <c>${escapeXml(city)}</c>
  <o>${escapeXml(countryIndex)}</o>
  <r>${escapeXml(regionIndex)}</r>
  <q>${escapeXml(departmentIndex)}</q>
  <u>${escapeXml(siteUrl)}</u>
  <m>${escapeXml(comment)}</m>
</i>`;

  res.type('text/xml').send(xml);
});

function saveMyInfo(req, res) {
  // Merge query and body — Ruffle may send data in either place
  const source = { ...req.query, ...(req.body && typeof req.body === 'object' ? req.body : {}) };
  console.log(`[do/smi] method=${req.method} ct=${req.headers['content-type']} rawBody=${typeof req.body === 'string' ? req.body.substring(0, 200) : JSON.stringify(req.body).substring(0, 200)} mergedKeys=${Object.keys(source).join(',')}`);

  const sid = getSidFromRequest(req, source);
  const auth = requireAuthBySid(sid, res);
  if (!auth) return;
  const { user } = auth;

  const rawBirthday = String(source.d || user.birthday || '2000-01-01');
  const birthday = /^\d{4}-\d{2}-\d{2}$/.test(rawBirthday) ? rawBirthday : (user.birthday || '2000-01-01');
  const lastNamePublic = String(source.p || user.lastNamePublic || 'Y').toUpperCase() === 'N' ? 'N' : 'Y';

  user.birthday = birthday;
  user.firstName = String(source.f || user.firstName || '').slice(0, 64);
  user.lastName = String(source.l || user.lastName || '').slice(0, 64);
  user.lastNamePublic = lastNamePublic;
  user.gender = String(source.g || user.gender || 'M').slice(0, 1) || 'M';
  user.realJob = String(source.j || user.realJob || 'Frutiz').slice(0, 80);
  user.city = String(source.c || user.city || '').slice(0, 80);
  user.countryIndex = String(source.o || user.countryIndex || '1').slice(0, 8);
  user.regionIndex = String(source.r || user.regionIndex || '1').slice(0, 8);
  user.siteUrl = String(source.u || user.siteUrl || '').slice(0, 256);
  user.comment = String(source.m || user.comment || '').slice(0, 500);
  if (source.q !== undefined) user.departmentIndex = String(source.q).slice(0, 8);

  // Keep public userinfo fields in sync with the edit form values.
  if (source.co) user.country = String(source.co).slice(0, 32) || user.country;
  if (source.rg) user.region = String(source.rg).slice(0, 32) || user.region;

  console.log(`[do/smi] saved for ${auth.username}: birthday=${user.birthday} gender=${user.gender} city=${user.city} firstName=${user.firstName} comment=${user.comment}`);
  if (user._dbId) {
    db.updateUser(auth.username, {
      gender: user.gender,
      birthday: user.birthday,
      country: user.country || 'FR',
      region: user.region || 'IDF',
      first_name: user.firstName || '',
      last_name: user.lastName || '',
      last_name_public: user.lastNamePublic || 'Y',
      real_job: user.realJob || '',
      city: user.city || '',
      country_index: user.countryIndex || '1',
      region_index: user.regionIndex || '1',
      department_index: user.departmentIndex || '1',
      site_url: user.siteUrl || '',
      comment: user.comment || '',
    }).catch(dbErr('updateUser/info'));
  }

  return res.type('text/xml').send('<r />');
}

// Accept multiple historical save routes used by legacy SWFs.
app.all(['/do/smi', '/smi', '/do/mi', '/mi', '/do/emi', '/emi'], saveMyInfo);

// ─────────────────────────────────────────────
// ENDPOINT: do/prefsavepartial — Save one preference
// The client sends i=<prefId>&v=<value> to update a single pref.
// We parse the encoded prefs string, update the entry, re-encode and persist.
// ─────────────────────────────────────────────
app.get('/do/prefsavepartial', (req, res) => {
  const sid = req.query.sid;
  const session = sessions[sid];
  if (session && session.user && users[session.user]) {
    const user = users[session.user];
    const prefId = Number(req.query.i);
    const rawVal = req.query.v;
    if (Number.isFinite(prefId) && rawVal !== undefined) {
      const parsed = parsePrefString(user.prefs || '');
      const def = prefDefs.find(p => p.id === prefId);
      if (def) {
        const isDefault = (rawVal === '' || rawVal === def.def);
        if (isDefault) {
          delete parsed[prefId];
        } else {
          parsed[prefId] = rawVal;
        }
        user.prefs = encodePrefString(parsed);
        if (user._dbId) db.updateUser(session.user, { prefs: user.prefs }).catch(dbErr('updateUser'));
      }
    }
  }
  res.type('text/plain').send('state=0');
});

// Preferences form endpoint — the compiled box.Pref window loads this to render the form.
// box.Pref.onPrefForm expects an XML tree of the shape:
//   <p>
//     <c n="Category">
//       <p i="<id>" f="<friendly label>">
//         <d>description</d>
//         <f><l>...form widgets...</l></f>
//       </p>
//       ...
//     </c>
//     ...
//   </p>
// The `<f>` element is REQUIRED in practice: box.Pref.analysePrefForm
// initialises `_loc7_ = new XML()` and only replaces it when an `<f>` child
// exists. If omitted, win.Pref.displayPref ends up iterating an empty XML and
// renders no widgets — the parameter sheet looks blank. Standard.getPrefForm
// (the documented fallback) is only called when `pref.form == undefined`,
// which never happens with the empty-XML default. So we always emit `<f>`
// with the same default `<l>` widget Standard.getPrefForm would produce per
// type (bool/int/string). The `i` attribute must be the decimal preference id
// so box.Pref can join it against `_global.userPref.prefsId`.
app.get(['/do/prefForm', '/prefForm'], (req, res) => {
  const prefLabels = {
    default_channel:         { label: 'Salon par défaut',                desc: 'Identifiant du salon rejoint automatiquement à la connexion.' },
    dsp_newmail_alert:       { label: 'Alerte nouveau message',          desc: 'Afficher une alerte à la réception d\'un nouveau mail.' },
    invite_channel_behavior: { label: 'Invitation salon',                desc: 'Comportement lors de la réception d\'une invitation de salon.' },
    invite_chat_behavior:    { label: 'Invitation chat privé',           desc: 'Comportement lors de la réception d\'une invitation de chat privé.' },
    wallpaper:               { label: 'Fond d\'écran',                   desc: 'Nom du fond d\'écran utilisé sur le bureau.' },
    cache_length:            { label: 'Durée du cache',                  desc: 'Nombre de jours pendant lesquels les fichiers sont conservés.' },
    cl_open:                 { label: 'Ouvrir la liste de contacts',     desc: 'Ouvrir automatiquement la liste de contacts au démarrage.' },
    win_flMoveAnim:          { label: 'Animations des fenêtres',         desc: 'Activer les animations de déplacement des fenêtres.' },
    ch_dsp_h:                { label: 'Afficher l\'heure',               desc: 'Afficher l\'heure devant chaque message du chat.' },
    ch_dsp_join:             { label: 'Afficher les arrivées',           desc: 'Afficher un message quand un utilisateur rejoint le salon.' },
    ch_dsp_leave:            { label: 'Afficher les départs',            desc: 'Afficher un message quand un utilisateur quitte le salon.' },
    ch_dsp_kick:             { label: 'Afficher les expulsions',         desc: 'Afficher un message quand un utilisateur est expulsé.' },
    ch_dsp_ban:              { label: 'Afficher les bannissements',      desc: 'Afficher un message quand un utilisateur est banni.' },
  };

  const categories = [
    { name: 'Général', ids: [1, 6, 7, 8] },
    { name: 'Chat',    ids: [9, 10, 11, 12, 13] },
    { name: 'Mail',    ids: [2] },
    { name: 'Invitations', ids: [3, 4] },
    { name: 'Apparence',   ids: [5] },
  ];

  // Default widget per pref type — mirrors Standard.getPrefForm in main.swf.
  //  bool   → two radios labelled Oui/Non bound to "value" with values Y/N
  //  int    → text input restricted to 0-9
  //  string → free-text input
  const formForType = {
    b: '<l><s b="1"/><r w="60" v="value" u="Y">Oui</r><s b="1"/><r w="60" v="value" u="N">Non</r><s b="1"/></l>',
    i: '<l><s w="20"/><i v="value" dy="1" b="1" r="0-9"></i><s w="20"/></l>',
    s: '<l><s w="20"/><i v="value" dy="1" b="1"></i><s w="20"/></l>',
  };

  const byId = Object.fromEntries(prefDefs.map((p) => [p.id, p]));
  let body = '<p>';
  for (const cat of categories) {
    body += `<c n="${escapeXml(cat.name)}">`;
    for (const id of cat.ids) {
      const def = byId[id];
      if (!def) continue;
      const meta = prefLabels[def.name] || { label: def.name, desc: '' };
      const form = formForType[def.type] || formForType.s;
      body += `<p i="${id}" f="${escapeXml(meta.label)}"><d>${escapeXml(meta.desc)}</d><f>${form}</f></p>`;
    }
    body += '</c>';
  }
  body += '</p>';

  res.type('text/xml').send(body);
});

// ─────────────────────────────────────────────
// ENDPOINT: do/onident — Post-identification data
// Returns XML with kikooz, items, prefs, logs, etc.
// ─────────────────────────────────────────────
app.get('/do/onident', (req, res) => {
  const sid = getSidFromRequest(req, req.query);
  const auth = requireAuthBySid(sid, res, 'text/xml');
  if (!auth) return;
  const { user } = auth;

  user.items = withDefaultPens(user.items);
  const items = user.items.join(',');
  const myPref = user.prefs || '';
  const now = nowSqlTimestamp();
  const currentUsername = auth.username || '';
  const allowModeration = user.isModerator && !isDebugNotUser(currentUsername);
  const modAttr = allowModeration ? ' m="1" a="1"' : '';

  // The "f" attribute, when present, forces the SWF to open the editbouille
  // window with the listed part families. Used for first-time avatar setup.
  // The editor opens as long as the user still has the DEFAULT bouille.
  // Once they save anything else, it NEVER opens again.
  const hasDefaultBouille = !user.fbouille || user.fbouille === DEFAULT_BOUILLE_STATE;
  const fAttr = hasDefaultBouille ? ' f="0,1,2,3,4,5,6,7,8"' : '';

  const userLogXml = buildUserLogXml(user.userLog);
  const siteLogXml = buildUserLogXml(user.siteLog);
  const xml = `<r k="${user.kikooz}" p="${now}" i="${items}"${modAttr}${fAttr}><mp><![CDATA[${myPref}]]></mp><ul>${userLogXml}</ul><sl>${siteLogXml}</sl><bl>${buildBouilleListXml()}</bl></r>`;
  const clearTransientNewFlag = (arr) => {
    if (!Array.isArray(arr)) return;
    for (let i = 0; i < arr.length; i += 1) {
      if (arr[i] && Number(arr[i].n) === 1) delete arr[i].n;
    }
  };
  clearTransientNewFlag(user.userLog);
  clearTransientNewFlag(user.siteLog);

  if (user._dbId) {
    db.clearUserLogNewFlag(user._dbId, 'user').catch(dbErr('clearUserLogNewFlag'));
    db.clearUserLogNewFlag(user._dbId, 'site').catch(dbErr('clearUserLogNewFlag'));
  }

  res.type('text/xml').send(xml);
});

function swfSizeForUrlPath(urlPath) {
  const clean = String(urlPath || '').replace(/\?.*$/, '');
  const candidates = [
    path.join(__dirname, 'public', clean.replace(/^\//, '')),
    path.join(__dirname, clean.replace(/^\//, '')),
    path.join(__dirname, 'Games', clean.replace(/^\/swf\/games\//, '')),
  ];
  for (const abs of candidates) {
    try {
      const st = fs.statSync(abs);
      if (st.isFile()) return String(st.size);
    } catch {}
  }
  return '0';
}

// recentlyEjected tracks "user X ejected game Y" events from /ff/mv so the
// standalone game popup (game-popup.html) can poll and close itself when
// its disc is no longer in the console. Required because Ruffle's WASM
// networking bypasses window.fetch and XMLHttpRequest interceptors — the
// popup can't observe the eject directly. Entries are cleared on read so
// the next mount of the same game starts clean.
const recentlyEjected = new Map();

app.get('/api/check-ejected', (req, res) => {
  const sid = String(req.query.sid || '');
  const game = String(req.query.game || '');
  if (!sid || !game) return res.json({ ejected: false });
  const key = `${sid}::${game}`;
  const ts = recentlyEjected.get(key);
  if (ts && Date.now() - ts < 120000) {
    // Consume the entry so the response only fires once per eject.
    recentlyEjected.delete(key);
    return res.json({ ejected: true });
  }
  // Older than 2 minutes — stale, drop it.
  if (ts) recentlyEjected.delete(key);
  return res.json({ ejected: false });
});

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

// ─────────────────────────────────────────────
// ENDPOINT: do/ld — Game disc loading
// ─────────────────────────────────────────────
app.get('/do/ld', (req, res) => {
  // Legacy Frusion flows may send "c" instead of "sid", and some clients
  // call /do/ld without auth context at all. The disc metadata itself is public.
  const sid = getSidFromRequest(req, req.query);
  if (sid) {
    const auth = requireAuthBySid(sid, res, 'text/xml');
    if (!auth) return;
  }

  const discUid = String(req.query.u || '');
  const launchId = getLaunchIdFromReq(req);
  let disc = GAME_DISCS[discUid];
  let resolvedDiscUid = discUid;

  // Some frusion wrappers call /do/ld with the game path instead of disc uid.
  // Accept both styles:
  //   - u=kaluga1
  //   - u=games/kaluga/kaluga.swf
  if (!disc) {
    const entries = Object.entries(GAME_DISCS);
    const hit = entries.find(([, d]) =>
      d.gameId === discUid || (Array.isArray(d.files) && d.files.some((f) => f && f.u === discUid))
    );
    if (hit) {
      resolvedDiscUid = hit[0];
      disc = hit[1];
    }
  }
  if (!disc) {
    if (VERBOSE_FRUSION_LOGS) {
      console.log(`[FRUSION] do/ld miss launch_id=${launchId || '-'} u=${discUid}`);
    }
    return res.type('text/xml').send('<r k="404">disc_not_found</r>');
  }

  const filesXml = disc.files
    .map((f) => {
      const size = swfSizeForUrlPath(`/swf/${f.u}`);
      const nAttr = f.n ? ` n="${escapeXml(f.n)}"` : '';
      return `<s u="${escapeXml(f.u)}" s="${size}"${nAttr} />`;
    })
    .join('');

  // Keep legacy root node name/attrs expected by Frusion ("game", not "r").
  const pm = disc.playMode || 'single';
  // Force popup mode: Ruffle's LocalConnection doesn't work for internal mode,
  // so we change m=i to m=p to make main.swf use PopupFrusion.
  const propsForResponse = (disc.props || '').replace('m=i', 'm=p');
  const xml = `<game t="${escapeXml(disc.discType)}" pm="${escapeXml(pm)}" n="${escapeXml(disc.swfName)}" u="${escapeXml(disc.gameId)}" p="${escapeXml(propsForResponse)}">${filesXml}</game>`;
  if (VERBOSE_FRUSION_LOGS) {
    console.log(`[FRUSION] do/ld hit launch_id=${launchId || '-'} u=${discUid} resolved=${resolvedDiscUid} -> ${disc.gameId} props=${disc.props}`);
  }

  // Set game presence icon when a game is launched
  if (sid) {
    const gameUser = resolveUsernameFromSid(sid);
    const internalCode = statusInternalCode(disc.swfName);
    if (gameUser && internalCode > 0) {
      console.log(`[FRUSION] do/ld setting game status for ${gameUser} game=${disc.swfName} internal=${internalCode}`);
      setUserInternalStatus(gameUser, internalCode);
    }
  }

  res.type('text/xml').send(xml);
});

// ─────────────────────────────────────────────
// ENDPOINT: ff/tree — File system tree
// Returns XML
// ─────────────────────────────────────────────
app.get(['/ff/tree', '/tree'], (req, res) => {
  const sid = req.query.sid;
  const username = resolveUsernameFromSid(sid);
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  let xml = FILE_TREE_XML;
  if (username && users[username]) {
    const user = users[username];
    const m = unreadInboxCount(user);
    xml = xml.replace(/m="0"/, `m="${m}"`);
    ensureContactLists(user);
    if (user.contactFolders && user.contactFolders.length > 0) {
      const subXml = user.contactFolders
        .map((f) => `<f u="${escapeXml(f.uid)}" n="${escapeXml(f.name)}" t="mycontact" />`)
        .join('');
      xml = xml.replace(
        '<f u="mycontact" n="Mes contacts" t="mycontact" />',
        `<f u="mycontact" n="Mes contacts" t="mycontact">${subXml}</f>`
      );
    }
  }
  res.type('text/xml').send(xml);
});

// Flash's LoadVars/XML loader caches aggressively based on URL. Force every
// shop response to be fresh so pack previews never get stuck on stale data.
function sendShopXml(res, body) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.type('text/xml').send(body);
}

// ─────────────────────────────────────────────
// ENDPOINT: ft/tree — Shop catalog tree
// The AS2 box.Shop (win.Shop) requests this on init to build the left menu.
// Returns a <c> root with nested <c n="category"> and <p i="id" n="name"/>
// leaves. The `d` attribute on root specifies the default displayed pack id.
// ─────────────────────────────────────────────
app.get('/ft/tree', (req, res) => {
  const sid = getSidFromRequest(req, req.query);
  const auth = requireAuthBySid(sid, res, 'text/xml');
  if (!auth) return;
  const { user } = auth;
  sendShopXml(res, buildShopTreeXml(user));
});

// ─────────────────────────────────────────────
// ENDPOINT: ft/pack — Shop pack details
// Returns a <p> element describing a single shop item (name, picto, price,
// description, etc.). Called when the user clicks a product in the shop tree.
// ─────────────────────────────────────────────
app.get('/ft/pack', (req, res) => {
  const sid = getSidFromRequest(req, req.query);
  const auth = requireAuthBySid(sid, res, 'text/xml');
  if (!auth) return;
  const { user } = auth;
  const pack = getShopPack(req.query.id);
  if (!pack) {
    return sendShopXml(res, '<r k="1" />');
  }
  sendShopXml(res, buildShopPackXml(pack, user));
});

// ─────────────────────────────────────────────
// ENDPOINT: ft/buy — Purchase a shop pack
// Deducts the price from the user's kikooz balance and adds the purchased
// accessory to user.customAccessories so it shows up in Inventaire/Accessoires.
// Returns <r i="newKikoozBalance"><b b="bouille">name</b><f>accessories</f>...</r>
// ─────────────────────────────────────────────
app.all(['/ft/buy', '/do/ft/buy'], (req, res) => {
  const source = req.method === 'POST' ? { ...req.query, ...(req.body || {}) } : req.query;
  const sid = getSidFromRequest(req, source);
  const auth = requireAuthBySid(sid, res, 'text/xml');
  if (!auth) return;
  const { user } = auth;

  const pack = getShopPack(source.i);
  if (!pack) {
    return sendShopXml(res, '<r k="1" />');
  }
  if (userOwnsShopPack(user, pack.id) || shopCategoryOwnedByDefault(pack.category)) {
    // Already owned, or a rubrique granted to everyone by default — return a
    // "dup" error so no kikooz are deducted for content the player already has.
    return sendShopXml(res, '<r k="2" />');
  }
  if (typeof user.kikooz !== 'number') user.kikooz = 0;
  if (user.kikooz < pack.price) {
    // Not enough kikooz.
    return sendShopXml(res, '<r k="3" />');
  }

  user.kikooz -= pack.price;
  if (user._dbId) db.updateUser(auth.username, { kikooz: user.kikooz }).catch(dbErr('updateUser'));

  const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const isWallpaper = !!pack.wallpaperId;
  const wp = isWallpaper ? WALLPAPER_BY_ID[pack.wallpaperId] : null;
  const bouilleStr = isWallpaper
    ? `wp:${wp.url}:${wp.color}`
    : bouilleOf(user).substring(0, 15) + pack.suffix9;
  if (!Array.isArray(user.customAccessories)) user.customAccessories = [];
  const accEntry = {
    id: isWallpaper ? ('wp_' + pack.wallpaperId) : ('shop_' + pack.id),
    shopId: pack.id,
    n: pack.name,
    v: bouilleStr,
    at: nowStr,
  };
  user.customAccessories.push(accEntry);
  if (user._dbId) db.addAccessory(user._dbId, accEntry).catch(dbErr('addAccessory'));

  // Record a "buy" entry in the kikooz history (box.KikoozLog / /ft/log)
  if (!Array.isArray(user.kikoozLog)) user.kikoozLog = [];
  user.kikoozLog.unshift({
    type: 'b',
    t: nowStr,
    k: pack.price,
    n: pack.name,
  });
  if (user.kikoozLog.length > 200) user.kikoozLog.length = 200;

  // Build response: new kikooz balance, the bouille to push into bouilleList,
  // and folder refresh requests so Inventaire/Accessoires re-list contents.
  const xml =
    `<r i="${user.kikooz}">` +
    (isWallpaper ? '' : `<b b="${escapeXml(bouilleStr)}">${escapeXml(pack.name)}</b>`) +
    `<f>inventory</f>` +
    `<f>accessories</f>` +
    `</r>`;
  console.log(`[ft/buy] ${auth.username} bought pack #${pack.id} (${pack.name}) — kikooz now ${user.kikooz}`);
  sendShopXml(res, xml);
});

// ─────────────────────────────────────────────
// ENDPOINT: ft/log — Kikooz history
// Returns a <l> root with entries for box.KikoozLog. Supported entry types:
//   <b t="..." k="price" n="pack name"/>  — shop purchase
//   <c t="..." k="amount" c="username"/>  — received kcall
//   <g t="..." k="amount" f="friend"/>    — godfather bonus
//   <a t="..." k="amount" f="anim name"/> — animation reward
// Timestamps are in "YYYY-MM-DD HH:MM:SS" (parsed by FEDate.newFromString).
// ─────────────────────────────────────────────
app.get('/ft/log', (req, res) => {
  const sid = getSidFromRequest(req, req.query);
  const auth = requireAuthBySid(sid, res, 'text/xml');
  if (!auth) return;
  const { user } = auth;
  const entries = Array.isArray(user.kikoozLog) ? user.kikoozLog : [];
  const body = entries.map((e) => {
    const t = escapeXml(e.t || '');
    const k = Number(e.k) || 0;
    if (e.type === 'b') {
      return `<b t="${t}" k="${k}" n="${escapeXml(e.n || '')}"/>`;
    }
    if (e.type === 'c') {
      return `<c t="${t}" k="${k}" c="${escapeXml(e.c || '')}"/>`;
    }
    if (e.type === 'g') {
      return `<g t="${t}" k="${k}" f="${escapeXml(e.f || '')}"/>`;
    }
    if (e.type === 'a') {
      return `<a t="${t}" k="${k}" f="${escapeXml(e.f || '')}"/>`;
    }
    return '';
  }).join('');
  sendShopXml(res, `<l>${body}</l>`);
});

// ─────────────────────────────────────────────
// ENDPOINT: ff/ls — List folder contents
// Returns XML
// ─────────────────────────────────────────────
app.get(['/ff/ls', '/ls'], (req, res) => {
  const uid = req.query.uid || 'root';
  const sid = req.query.sid;
  const auth = requireAuthBySid(sid, res, 'text/xml');
  if (!auth) return;
  const { user } = auth;
  // Flash's XML loader caches by URL — without no-store the folder tree sticks
  // on the first response it ever fetched (e.g. a stale "Undefined" picto
  // listing) until a full reload. Force a fresh fetch on every open.
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  ensureContactLists(user);
  if (uid === 'root' || uid === 'desktop') {
    // Gaspard is the welcome-bot NPC; re-expose its contact icon on the
    // desktop so users can mail/chat with it without first adding it to
    // their contacts. The original entry was removed in c81ced8's cleanup
    // pass — user reported the absence.
    return res.type('text/xml').send(
      `<f u="root">
        <f u="inbox" t="inbox" p="normal" />
        <f u="disccollector" t="disccollector" />
        <f u="inventory" t="inventory" />
        <e u="Gaspard" t="contact" s="10" d="0" a="0">Gaspard@frutiparc.com</e>
        <f u="mycontact" t="mycontact" />
        <f u="recyclebin" t="recyclebin" />
      </f>`
    );
  }

  if (uid === 'inventory') {
    return res.type('text/xml').send(
      `<f u="inventory">` +
      `<f u="inv_accessories" n="Accessoires" t="folder" />` +
      `<f u="inv_wallpapers" n="Fonds d'écran" t="folder" />` +
      `<f u="inv_pictos" n="Pictos" t="folder" />` +
      `</f>`
    );
  }

  if (uid === 'inv_accessories') {
    const bouillePrefix = bouilleOf(user).substring(0, 15);
    const defaultAccNodes = DEFAULT_ACCESSORIES
      .map((acc) => `<e u="${escapeXml(acc.u)}" t="bouille" s="10" d="0" a="0">${escapeXml(acc.n)}\n${bouillePrefix}${acc.suffix}</e>`)
      .join('');
    const customAccNodes = (Array.isArray(user.customAccessories) ? user.customAccessories : [])
      .filter((acc) => !getAccessoryWallpaper(acc))
      .map((acc) => `<e u="${escapeXml(acc.id)}" t="bouille" s="10" d="0" a="0">${escapeXml(acc.n || 'Accessoire')}\n${escapeXml(acc.v || DEFAULT_BOUILLE_STATE)}</e>`)
      .join('');
    return res.type('text/xml').send(`<f u="inv_accessories">${defaultAccNodes}${customAccNodes}</f>`);
  }

  if (uid === 'inv_wallpapers') {
    let nodes = '';
    for (const acc of (Array.isArray(user.customAccessories) ? user.customAccessories : [])) {
      const wp = getAccessoryWallpaper(acc);
      if (wp) {
        nodes += `<e u="${escapeXml(acc.id)}" t="wallpaper" s="10" d="0" a="0">${escapeXml(acc.n || 'Fond')}\n${wp.url}\n${wp.color}</e>`;
      }
    }
    return res.type('text/xml').send(`<f u="inv_wallpapers">${nodes || '<i />'}</f>`);
  }

  // Pictos folder → a "Voir tous mes pictos" entry that opens an HTML gallery
  // popup (native browser scrollbar, grouped by game — the SWF icon list can't
  // scroll), followed by the flat list of pictos (each opens its picto-view
  // popup). Per-game sub-folders were tried but rendered as "Undefined" nodes.
  if (uid === 'inv_pictos') {
    const gi = Array.isArray(user.gameItems) ? user.gameItems : [];
    if (gi.length === 0) return res.type('text/xml').send('<f u="inv_pictos"><i /></f>');
    const galleryUrl = `/pictos-gallery.html?sid=${encodeURIComponent(sid || '')}`;
    const galleryEntry = `<e u="__pictos_gallery__" t="url" s="10" d="0" a="0">Voir tous mes pictos\r\njavascript:fp_openPopup('${escapeXml(galleryUrl)}','Mes Pictos','width=760,height=620,resizable=yes,scrollbars=yes')\r\n</e>`;
    const nodes = galleryEntry + gi.map(renderPictoEntryXml).join('');
    return res.type('text/xml').send(`<f u="inv_pictos">${nodes}</f>`);
  }

  if (uid === 'shop') {
    return res.type('text/xml').send('<f u="shop"><f u="accessories" t="accessories" /></f>');
  }

  if (uid === 'accessories') {
    const bouillePrefix = bouilleOf(user).substring(0, 15);
    const defaultAccNodes = DEFAULT_ACCESSORIES
      .map((acc) => `<e u="${escapeXml(acc.u)}" t="bouille" s="10" d="0" a="0">${escapeXml(acc.n)}\n${bouillePrefix}${acc.suffix}</e>`)
      .join('');
    const customAccNodes = (Array.isArray(user.customAccessories) ? user.customAccessories : [])
      .filter((acc) => !getAccessoryWallpaper(acc))
      .map((acc) => `<e u="${escapeXml(acc.id)}" t="bouille" s="10" d="0" a="0">${escapeXml(acc.n || 'Accessoire')}\n${escapeXml(acc.v || DEFAULT_BOUILLE_STATE)}</e>`)
      .join('');
    return res.type('text/xml').send(`<f u="accessories">${defaultAccNodes}${customAccNodes}</f>`);
  }


  if (uid === 'mycontact') {
    // Sub-folders are nested as <f u="...">{their contacts}</f> rather than
    // flat <e t="folder">, so the client's analyseXml recurses into them
    // and the resulting ContactList has its `list` populated with the
    // contacts of that sub-folder. Without recursion, analyseXml pushed
    // the sub-folder as a plain object with no `list`, the recursive
    // ContactList stayed empty, and SideList had nothing to render under
    // the sub-folder header (no expand/collapse effect).
    const contactsByFolder = {};
    for (const addr of user.contacts) {
      const f = getContactFolder(user, addr);
      if (!contactsByFolder[f]) contactsByFolder[f] = [];
      contactsByFolder[f].push(addr);
    }
    const renderContact = (addr) => {
      const local = String(addr).split('@')[0];
      return `<e u="${escapeXml(local)}" t="contact" s="10" d="0" a="0">${escapeXml(addr)}</e>`;
    };
    const folderNodes = (user.contactFolders || [])
      .map((f) => {
        const sub = (contactsByFolder[f.uid] || []).map(renderContact).join('');
        return `<f u="${escapeXml(f.uid)}" n="${escapeXml(f.name)}" t="folder">${sub}</f>`;
      })
      .join('');
    const rootContactNodes = (contactsByFolder['mycontact'] || []).map(renderContact).join('');
    const body = folderNodes + rootContactNodes;
    return res.type('text/xml').send(`<f u="mycontact">${body || '<i />'}</f>`);
  }

  if (isCustomContactFolder(user, uid)) {
    const contactNodes = user.contacts
      .filter((addr) => getContactFolder(user, addr) === uid)
      .map((addr) => {
        const local = String(addr).split('@')[0];
        return `<e u="${escapeXml(local)}" t="contact" s="10" d="0" a="0">${escapeXml(addr)}</e>`;
      })
      .join('');
    return res.type('text/xml').send(`<f u="${escapeXml(uid)}">${contactNodes || '<i />'}</f>`);
  }

  if (uid === 'blacklist') {
    const nodes = user.blacklist.map((addr) => {
      const local = String(addr).split('@')[0];
      return `<e u="${escapeXml(local)}" t="contact" s="10" d="0" a="0">${escapeXml(addr)}</e>`;
    }).join('');
    return res.type('text/xml').send(`<f u="blacklist">${nodes || '<i />'}</f>`);
  }

  if (uid === 'disccollector') {
    // disc format: content = "discType\ngameName"
    let discNodes = '';
    for (const [id, disc] of Object.entries(GAME_DISCS)) {
      const displayName = disc.iconName || disc.swfName;
      discNodes += `<e u="${escapeXml(id)}" t="disc" s="10" d="0" a="0">${disc.discType}\n${escapeXml(displayName)}</e>`;
    }
    return res.type('text/xml').send(`<f u="disccollector">${discNodes || '<i />'}</f>`);
  }

  // Mail folders
  if (MAIL_FOLDERS.has(uid)) {
    ensureMails(user);
    const list = user.mails.filter((m) => m.folder === uid);
    // Newest first
    list.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    const nodes = list.map((m) => buildMailElementXml(m)).join('');
    return res.type('text/xml').send(`<f u="${uid}">${nodes || '<i />'}</f>`);
  }

  // Individual mail fetch (uid starts with 'm' and is in user's mailbox)
  if (uid && uid.charAt(0) === 'm') {
    ensureMails(user);
    const mail = user.mails.find((m) => m.uid === uid);
    if (mail) {
      // Mark as read once opened (only inbox mails are "unread")
      if (mail.folder === 'inbox' && !mail.read) {
        mail.read = true;
        if (user._dbId) db.updateMailRead(mail.uid, true).catch(dbErr('updateMailRead'));
      }
      return res.type('text/xml').send(`<f u="${escapeXml(mail.folder)}">${buildMailElementXml(mail)}</f>`);
    }
  }

  // Return an empty folder listing with a placeholder node to avoid legacy null-firstChild edge cases
  return res.type('text/xml').send(`<f u="${uid}"><i /></f>`);
});

// ─────────────────────────────────────────────
// ENDPOINT: ff/get — Fetch raw file content (text)
// box.ViewMail uses this to load the mail body. The Flash client decodes the
// first 4 chars as a base62 status code (0000 = success), then takes the rest
// as the file content. On error: "<XXXX>" → openErrorAlert("error.http.<n>").
// ─────────────────────────────────────────────
app.all('/ff/get', (req, res) => {
  const params = req.method === 'POST' ? { ...req.query, ...req.body } : req.query;
  const uid = String(params.u || params.uid || '');
  const sid = params.sid || params.c || '';
  console.log('[ff/get] method:', req.method, 'url:', req.originalUrl, 'query:', JSON.stringify(req.query), 'body:', JSON.stringify(req.body || {}), 'uid:', uid);
  const auth = requireAuthBySid(sid, res);
  if (!auth) {
    console.log('[ff/get] AUTH FAILED for sid:', sid);
    return;
  }
  const { user } = auth;

  let payload;
  if (uid && uid.charAt(0) === 'm') {
    ensureMails(user);
    const mail = user.mails.find((m) => m.uid === uid);
    if (mail) {
      if (mail.folder === 'inbox' && !mail.read) {
        mail.read = true;
        if (user._dbId) db.updateMailRead(mail.uid, true).catch(dbErr('updateMailRead'));
      }
      payload = '0000' + (mail.body || '');
      console.log('[ff/get] found mail', uid, 'body length:', (mail.body || '').length, 'payload first 60 chars:', JSON.stringify(payload.substring(0, 60)));
    } else {
      payload = '0001';
      console.log('[ff/get] mail not found:', uid);
    }
  } else {
    payload = '0000';
    console.log('[ff/get] non-mail uid, returning empty success. uid was:', uid);
  }

  console.log('[ff/get] sending', payload.length, 'bytes, prefix:', JSON.stringify(payload.substring(0, 6)));
  res.type('text/plain').send(payload);
});

// ─────────────────────────────────────────────
// ENDPOINT: ff/mk — Create file/folder
// Returns XML
// ─────────────────────────────────────────────
app.all(['/ff/mk', '/mk'], async (req, res) => {
  const source = req.method === 'POST' ? req.body : req.query;
  const sid = getSidFromRequest(req, source);
  const auth = requireAuthBySid(sid, res, 'text/xml');
  if (!auth) return;
  const { user } = auth;
  ensureContactLists(user);

  const newUid = 'f' + crypto.randomBytes(4).toString('hex');
  let folder = source.folder || req.query.folder || '';
  const type = source.t || req.query.t || 'file';
  const desc = String(source.d || req.query.d || '');
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const isContactFolder = folder === 'mycontact' || folder === 'blacklist';
  const isContactCreate = type === 'contact' || (isContactFolder && type !== 'folder');

  if (isContactCreate && !folder) {
    folder = 'mycontact';
  }

  // Mail creation (drafts and direct sends)
  if (type === 'mail') {
    ensureMails(user);
    const parsed = parseMailDesc(desc);
    const targetFolder = MAIL_FOLDERS.has(folder) ? folder : 'draftbox';
    const fromAddr = auth.username + '@frutiparc.com';
    const toAddrs = parseRecipients(parsed.to);
    // Resolve recipients best-effort (in-memory first; DB lookup runs lazily on send).
    const resolvedTo = [];
    for (const a of toAddrs) {
      const u = await addressToUsername(a);
      if (u) resolvedTo.push(u);
    }
    const mail = {
      uid: 'm' + crypto.randomBytes(5).toString('hex'),
      from: auth.username,
      fromAddr,
      to: resolvedTo,
      toAddrs,
      subject: parsed.subject || '',
      body: parsed.body || '',
      folder: targetFolder,
      date: now,
      read: targetFolder !== 'inbox',
    };
    user.mails.push(mail);
    if (user._dbId) db.saveMail(user._dbId, mail).catch((e) => console.error('[DB] mail save error:', e.message));
    console.log(`[Mail] ${auth.username} created mail ${mail.uid} in ${targetFolder} (subject="${mail.subject}", to=[${toAddrs.join(',')}])`);
    return res.type('text/xml').send(
      `<r u="${escapeXml(mail.uid)}" t="mail" d="${now}" f="${escapeXml(targetFolder)}">${escapeXml(encodeMailDesc(mail))}</r>`
    );
  }

  if (isContactCreate && (folder === 'mycontact' || folder === 'blacklist')) {
    const firstDescLine = String(desc.split('\n')[0] || '').trim();

    // Some legacy "add contact from profile" flows send d=NoText.
    // Recover the actual username from alternate form/query fields when available.
    let contactRaw = firstDescLine;
    if (isContactPlaceholder(contactRaw)) {
      const session = getSessionBySid(sid);
      const fromDesc = extractContactCandidateFromDesc(desc);
      const fallbackCandidates = [
        fromDesc,
        source.u, source.user, source.name, source.n, source.l, source.a,
        req.query.u, req.query.user, req.query.name, req.query.n, req.query.l, req.query.a,
        session && session.lastProfileUser,
        session && session.lastTraceUser,
      ];
      contactRaw = String(fallbackCandidates.find((v) => !isContactPlaceholder(v)) || '');
    }

    const addr = normalizeContactAddress(contactRaw);
    const list = folder === 'blacklist' ? user.blacklist : user.contacts;
    if (addr && !list.includes(addr)) list.push(addr);
    if (addr && user._dbId) {
      const persist = folder === 'blacklist'
        ? db.addBlacklist(user._dbId, addr)
        : db.addContact(user._dbId, addr);
      persist.catch((e) => console.error('[DB] contact save error:', e.message));
    }
    const local = addr.split('@')[0] || addr || newUid;
    return res.type('text/xml').send(
      `<r u="${escapeXml(local)}" t="contact" d="${now}" f="${escapeXml(folder)}">${escapeXml(addr)}</r>`
    );
  }

  // Persistent sub-folder inside "Mes contacts"
  if (type === 'folder' && folder === 'mycontact') {
    const folderName = String(desc.split('\n')[0] || '').trim() || 'Nouveau dossier';
    user.contactFolders.push({ uid: newUid, name: folderName });
    if (user._dbId) {
      db.addContactFolder(user._dbId, newUid, folderName)
        .catch((e) => console.error('[DB] contact folder save error:', e.message));
    }
    console.log(`[FF/MK] ${auth.username} created mycontact sub-folder "${folderName}" (uid=${newUid})`);
    return res.type('text/xml').send(
      `<r u="${newUid}" t="folder" d="${now}" f="${escapeXml(folder)}">${escapeXml(folderName)}\r\nfolder</r>`
    );
  }

  res.type('text/xml').send(`<r u="${newUid}" t="${escapeXml(type)}" d="${now}" f="${escapeXml(folder)}">${escapeXml(desc)}</r>`);
});

// ─────────────────────────────────────────────
// ENDPOINT: ff/mv — Move file
// Returns XML
// ─────────────────────────────────────────────
app.all(['/ff/mv', '/mv'], async (req, res) => {
  const source = req.method === 'POST' ? req.body : req.query;
  const sid = source.sid || req.query.sid;
  const auth = requireAuthBySid(sid, res, 'text/xml');
  if (!auth) return;
  const { user } = auth;
  ensureContactLists(user);

  const file = String(source.f || req.query.f || '');
  const folder = String(source.folder || req.query.folder || '');
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  console.log(`[FF/MV] file="${file}" folder="${folder}" method=${req.method} query=${JSON.stringify(req.query)}`);

  const PROTECTED_UIDS = new Set([
    'root', 'messages', 'inbox', 'outbox', 'blackbox', 'draftbox',
    'disccollector', 'inventory', 'inv_accessories', 'inv_wallpapers', 'inv_pictos',
    'shop', 'accessories', 'mycontact', 'recyclebin', 'blacklist',
    'linkForum', 'linkChat', 'linkHisto', 'linkPreference',
    'linkScore', 'linkShop', 'linkBlogs', 'linkClub',
  ]);
  if (PROTECTED_UIDS.has(file) || /^link/.test(file)) {
    // Return a no-op "move" back to the source folder so the SWF client
    // restores the icon. The AS2 client doesn't handle 403 errors — it
    // optimistically removes the icon from the display, and a 403 would
    // leave it missing until the next refresh.
    const origFolder = String(source.p || req.query.p || 'root');
    return res.type('text/xml').send(
      `<r f="${escapeXml(origFolder)}"><f u="${escapeXml(file)}" t="folder" d="${now}" p="${escapeXml(origFolder)}">${escapeXml(file)}</f></r>`
    );
  }

  // Mail moves — file uid starts with 'm'
  if (file && file.charAt(0) === 'm') {
    ensureMails(user);
    const mail = user.mails.find((m) => m.uid === file);
    if (mail) {
      const oldF = mail.folder;
      const targetFolder = MAIL_FOLDERS.has(folder) ? folder : 'recyclebin';

      // Sending: draftbox → outbox triggers delivery to recipients.
      if (oldF === 'draftbox' && targetFolder === 'outbox') {
        mail.folder = 'outbox';
        mail.date = now;
        if (user._dbId) db.updateMailFolder(mail.uid, 'outbox').catch(dbErr('updateMailFolder'));
        deliverMailToRecipients(mail, auth.username).catch((e) =>
          console.error('[Mail] deliver error:', e.message));
      } else {
        mail.folder = targetFolder;
        if (user._dbId) db.updateMailFolder(mail.uid, targetFolder).catch(dbErr('updateMailFolder'));
      }

      const desc = encodeMailDesc(mail);
      return res.type('text/xml').send(
        `<r f="${escapeXml(targetFolder)}"><f n="${escapeXml(mail.uid)}" u="${escapeXml(mail.uid)}" t="mail" d="${escapeXml(mail.date)}" p="${escapeXml(oldF)}">${escapeXml(desc)}</f></r>`
      );
    }
    return res.type('text/xml').send(`<r k="404" />`);
  }

  let oldFolder = String(source.p || req.query.p || 'root');

  // Disc moves — game discs should never create contacts.
  // Format mirrors the disccollector listing (same desc/attrs), so the
  // client renders the right disc visual after the move.
  if (GAME_DISCS[file]) {
    const disc = GAME_DISCS[file];
    const displayName = disc.iconName || disc.swfName;
    const discDesc = `${disc.discType}\r\n${displayName}`;
    // Track eject events so the standalone game popup can poll and
    // close itself. Ruffle's WASM networking bypasses both window.fetch
    // and XMLHttpRequest wrappers, so the only reliable signal back to
    // the popup is the server marking the eject and the popup asking.
    // Keyed by sid::swfName because that's what the popup knows about
    // itself (URL ?game=<swfName>). Stash a timestamp; the popup poll
    // endpoint clears it on read so the next mount of the same game
    // isn't immediately closed.
    if (folder === 'disccollector') {
      recentlyEjected.set(`${sid}::${disc.swfName}`, Date.now());
    } else {
      // Re-mount: any pending eject for this game is stale.
      recentlyEjected.delete(`${sid}::${disc.swfName}`);
    }
    // disccollector is a static catalog: /ff/ls?uid=disccollector already
    // lists every known disc unconditionally. If we answered an eject-back
    // with the disc as a fresh <f> child, the client's onMove handler would
    // fire addFile on the disccollector listener and render the SAME disc
    // a second time — exactly the "doubled disc after eject" bug. Targeting
    // a non-existent folder UID makes callListeners no-op silently while
    // still letting rmUid clean the source (Frusion / desktop slot).
    if (folder === 'disccollector') {
      return res.type('text/xml').send(
        `<r f="__discnoop__"><f n="${escapeXml(file)}" u="${escapeXml(file)}" t="disc" s="10" d="${now}" a="0" p="${escapeXml(oldFolder)}">${escapeXml(discDesc)}</f></r>`
      );
    }
    return res.type('text/xml').send(
      `<r f="${escapeXml(folder || 'root')}"><f n="${escapeXml(file)}" u="${escapeXml(file)}" t="disc" s="10" d="${now}" a="0" p="${escapeXml(oldFolder)}">${escapeXml(discDesc)}</f></r>`
    );
  }

  // Custom contact sub-folder being moved to trash:
  // delete the folder, but keep its contacts (move them back to mycontact).
  if (folder === 'recyclebin' && isCustomContactFolder(user, file)) {
    for (const addr of user.contacts) {
      if (getContactFolder(user, addr) === file) {
        delete user.contactFolderMap[addr];
        if (user._dbId) {
          db.updateContactFolder(user._dbId, addr, 'mycontact')
            .catch((e) => console.error('[DB] contact folder move error:', e.message));
        }
      }
    }
    user.contactFolders = user.contactFolders.filter((f) => f.uid !== file);
    if (user._dbId) {
      db.removeContactFolder(user._dbId, file)
        .catch((e) => console.error('[DB] contact folder remove error:', e.message));
    }
    return res.type('text/xml').send(
      `<r f="recyclebin"><f n="${escapeXml(file)}" u="${escapeXml(file)}" t="folder" d="${now}" p="mycontact">${escapeXml(file)}\r\nfolder</f></r>`
    );
  }

  // The thing being moved is itself a contact sub-folder. The recyclebin
  // case above handled deletion; for any other target we no-op (sub-folders
  // can only live directly under "mycontact" — no nesting, no moving to the
  // desktop), and we echo the folder back with t="folder" so the SWF keeps
  // rendering it as a folder. The previous fall-through treated the folder
  // UID as a contact address (`fXXX@frutiparc.com`), wrote it to
  // user.contacts, and answered t="contact" — which is why the icon turned
  // into a user.
  if (isCustomContactFolder(user, file)) {
    const folderEntry = user.contactFolders.find((f) => f.uid === file);
    const folderName = folderEntry ? folderEntry.name : file;
    return res.type('text/xml').send(
      `<r f="mycontact"><f n="${escapeXml(file)}" u="${escapeXml(file)}" t="folder" d="${now}" p="mycontact">${escapeXml(folderName)}\r\nfolder</f></r>`
    );
  }

  const local = file.split('@')[0];
  const normalizedFileAddr = normalizeContactAddress(file);

  const inContacts = user.contacts.find((a) => a === normalizedFileAddr || a.split('@')[0] === local);
  const inBlacklist = user.blacklist.find((a) => a === normalizedFileAddr || a.split('@')[0] === local);

  if (folder === 'recyclebin') {
    if (inContacts) {
      oldFolder = getContactFolder(user, inContacts);
      user.contacts = user.contacts.filter((a) => a !== inContacts);
      delete user.contactFolderMap[inContacts];
      if (user._dbId) db.removeContact(user._dbId, inContacts).catch((e) => console.error('[DB] contact remove error:', e.message));
    } else if (inBlacklist) {
      user.blacklist = user.blacklist.filter((a) => a !== inBlacklist);
      oldFolder = 'blacklist';
      if (user._dbId) db.removeBlacklist(user._dbId, inBlacklist).catch((e) => console.error('[DB] blacklist remove error:', e.message));
    }
  } else if (folder === 'blacklist') {
    const addr = inContacts || normalizedFileAddr || file;
    if (inContacts) {
      oldFolder = getContactFolder(user, inContacts);
      user.contacts = user.contacts.filter((a) => a !== inContacts);
      delete user.contactFolderMap[inContacts];
      if (user._dbId) db.removeContact(user._dbId, inContacts).catch((e) => console.error('[DB] contact move error:', e.message));
    }
    if (addr && !user.blacklist.includes(addr)) {
      user.blacklist.push(addr);
      if (user._dbId) db.addBlacklist(user._dbId, addr).catch((e) => console.error('[DB] blacklist add error:', e.message));
    }
  } else if (folder === 'mycontact') {
    const addr = inBlacklist || inContacts || normalizedFileAddr || file;
    if (inBlacklist) {
      user.blacklist = user.blacklist.filter((a) => a !== inBlacklist);
      oldFolder = 'blacklist';
      if (user._dbId) db.removeBlacklist(user._dbId, inBlacklist).catch((e) => console.error('[DB] blacklist move error:', e.message));
    } else if (inContacts) {
      oldFolder = getContactFolder(user, inContacts);
    }
    if (addr && !user.contacts.includes(addr)) {
      user.contacts.push(addr);
      if (user._dbId) db.addContact(user._dbId, addr, 'mycontact').catch((e) => console.error('[DB] contact add error:', e.message));
    } else if (addr && user.contactFolderMap[addr] !== undefined) {
      // Moving a contact from a sub-folder back to mycontact root
      delete user.contactFolderMap[addr];
      if (user._dbId) db.updateContactFolder(user._dbId, addr, 'mycontact').catch((e) => console.error('[DB] contact folder update error:', e.message));
    }
  } else if (isCustomContactFolder(user, folder)) {
    // Moving a contact into a custom sub-folder of "Mes contacts"
    const addr = inContacts || normalizedFileAddr || file;
    if (inContacts) {
      oldFolder = getContactFolder(user, inContacts);
    } else if (addr && !user.contacts.includes(addr)) {
      user.contacts.push(addr);
      if (user._dbId) db.addContact(user._dbId, addr, folder).catch((e) => console.error('[DB] contact add error:', e.message));
    }
    if (addr) {
      user.contactFolderMap[addr] = folder;
      if (user._dbId) db.updateContactFolder(user._dbId, addr, folder).catch((e) => console.error('[DB] contact folder update error:', e.message));
    }
  }

  const addr = normalizedFileAddr || file;
  res.type('text/xml').send(`<r f="${escapeXml(folder)}"><f n="${escapeXml(local)}" u="${escapeXml(local)}" t="contact" d="${now}" p="${oldFolder}">${escapeXml(addr)}</f></r>`);
});

// ─────────────────────────────────────────────
// ENDPOINT: ff/rm — Remove file/contact
// Returns XML
// ─────────────────────────────────────────────
app.get(['/ff/rm', '/rm'], async (req, res) => {
  const sid = req.query.sid;
  const auth = requireAuthBySid(sid, res, 'text/xml');
  if (!auth) return;
  const { user } = auth;
  ensureContactLists(user);

  const folder = String(req.query.folder || req.query.f || '');
  const rawFile = String(req.query.file || req.query.u || req.query.uid || req.query.n || '');
  const normalized = normalizeContactAddress(rawFile);
  const local = String(rawFile).split('@')[0];

  let removedFrom = '';
  let removedValue = '';

  const removeFromList = (listName, value) => {
    if (!value) return false;
    const before = user[listName].length;
    user[listName] = user[listName].filter((a) => a !== value);
    return user[listName].length !== before;
  };

  const candidates = [normalized, rawFile, local]
    .filter(Boolean)
    .flatMap((v) => [v, normalizeContactAddress(v)])
    .filter(Boolean);

  const tryRemoveFrom = (listName) => {
    for (const c of candidates) {
      const hit = user[listName].find((a) => a === c || String(a).split('@')[0] === String(c).split('@')[0]);
      if (hit && removeFromList(listName, hit)) {
        removedFrom = listName === 'contacts' ? 'mycontact' : 'blacklist';
        removedValue = hit;
        if (user._dbId) {
          const persist = listName === 'contacts'
            ? db.removeContact(user._dbId, hit)
            : db.removeBlacklist(user._dbId, hit);
          persist.catch((e) => console.error('[DB] contact delete error:', e.message));
        }
        return true;
      }
    }
    return false;
  };

  if (folder === 'mycontact') {
    tryRemoveFrom('contacts');
  } else if (folder === 'blacklist') {
    tryRemoveFrom('blacklist');
  } else {
    // If folder is omitted, try both lists.
    if (!tryRemoveFrom('contacts')) {
      tryRemoveFrom('blacklist');
    }
  }

  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const resultName = String(removedValue || normalized || rawFile || local || 'contact').split('@')[0];
  const parent = removedFrom || folder || 'mycontact';
  return res.type('text/xml').send(
    `<r f="${escapeXml(parent)}"><f n="${escapeXml(resultName)}" t="contact" d="${now}" p="${escapeXml(parent)}">removed</f></r>`
  );
});

// ─────────────────────────────────────────────
// ENDPOINT: ff/cp — Copy file
// Returns XML
// ─────────────────────────────────────────────
app.get(['/ff/cp', '/cp'], (req, res) => {
  const file = req.query.f || '';
  const folder = req.query.folder || '';
  const newUid = 'c' + crypto.randomBytes(4).toString('hex');
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  res.type('text/xml').send(`<r f="${folder}"><f u="${newUid}" t="file" d="${now}" p="${folder}">copied</f></r>`);
});

// ─────────────────────────────────────────────
// ENDPOINT: ff/erb — Empty recycle bin
// Returns XML
// ─────────────────────────────────────────────
app.get('/ff/erb', (req, res) => {
  res.type('text/xml').send('<r k="0" />');
});

// ─────────────────────────────────────────────
// ENDPOINT: ff/dm — Delete mail(s) in a folder
// Params:
//   u = folder uid (inbox/outbox/draftbox/blackbox)
//   r = 0 → delete ALL mails in folder; r = 1 → delete READ mails only
// ─────────────────────────────────────────────
app.get('/ff/dm', (req, res) => {
  const sid = req.query.sid;
  const auth = requireAuthBySid(sid, res);
  if (!auth) return;
  const { user } = auth;
  ensureMails(user);

  const target = String(req.query.u || '');
  const onlyRead = String(req.query.r || '0') === '1';

  if (!MAIL_FOLDERS.has(target)) {
    return res.type('text/plain').send('state=0');
  }

  const before = user.mails.length;
  const removed = [];
  user.mails = user.mails.filter((m) => {
    if (m.folder !== target) return true;
    if (onlyRead && !m.read) return true;
    removed.push(m.uid);
    return false;
  });
  if (user._dbId && removed.length) {
    db.deleteMails(removed).catch((e) => console.error('[DB] mail delete error:', e.message));
  }
  console.log(`[Mail] ${auth.username} deleted ${before - user.mails.length} mail(s) from ${target} (onlyRead=${onlyRead})`);

  res.type('text/plain').send('state=0');
});

// ─────────────────────────────────────────────
// ENDPOINT: fm/sendmail — Send mail (POST, LoadVars)
// Flash's win.Mail sends: sid, t (to), s (subject), c (content), o (saveToOutbox 0/1)
// Response: <r k="" /> on success, <r k="<code>" /> on error → openErrorAlert("error.http."+k)
// ─────────────────────────────────────────────
app.post('/fm/sendmail', async (req, res) => {
  const sid = req.body.sid || req.query.sid || '';
  const auth = requireAuthBySid(sid, res, 'text/xml');
  if (!auth) return;
  const { username, user } = auth;
  ensureMails(user);

  console.log('[Mail] POST /fm/sendmail body keys:', Object.keys(req.body), 'body:', JSON.stringify(req.body).substring(0, 500));

  const to = String(req.body.t || req.body.to || '').trim();
  const subject = String(req.body.s || req.body.subject || '');
  const content = String(req.body.c || req.body.content || '');
  const saveToOutbox = String(req.body.o || req.body.saveToOutbox || '1');

  if (!to) {
    return res.type('text/xml').send('<r k="1"><e>to_empty</e></r>');
  }

  // Format expected by FEDate.newFromString in the SWF: "YYYY-MM-DD HH:MM:SS".
  // toLocaleString('fr-FR') produced "DD/MM/YYYY HH:MM:SS" which the AS2
  // parser couldn't decode, so the Detail view rendered NaN in its date column.
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const fromAddr = username + '@frutiparc.com';
  const toAddrs = parseRecipients(to);

  const mail = {
    uid: genMailUid(),
    from: username,
    fromAddr,
    to,
    toAddrs,
    subject,
    body: content,
    folder: 'outbox',
    date: now,
    read: true,
  };

  if (saveToOutbox !== '0' && saveToOutbox !== 'false') {
    user.mails.push(mail);
    if (user._dbId) {
      db.saveMail(user._dbId, mail)
        .catch((e) => console.error('[DB] outbox save error:', e.message));
    }
  }

  try {
    await deliverMailToRecipients(mail, username);
  } catch (e) {
    console.error('[Mail] delivery error:', e.message);
  }

  console.log(`[Mail] ${username} sent mail to ${to} (subject: ${subject}) body: ${content.substring(0, 100)}`);
  res.type('text/xml').send('<r><ok /></r>');
});

// ─────────────────────────────────────────────
// ENDPOINT: fm/sd — Save draft (POST, LoadVars)
// Same param schema as sendmail (t/s/c). Optional u = existing draft uid to update.
// ─────────────────────────────────────────────
app.post('/fm/sd', async (req, res) => {
  const sid = req.body.sid || req.query.sid || '';
  const auth = requireAuthBySid(sid, res, 'text/xml');
  if (!auth) return;
  const { username, user } = auth;
  ensureMails(user);

  const to = String(req.body.t || req.body.to || '');
  const subject = String(req.body.s || req.body.subject || '');
  const content = String(req.body.c || req.body.content || '');
  const existingUid = String(req.body.u || '');

  // Use ISO-like "YYYY-MM-DD HH:MM:SS" so FEDate.newFromString can parse it.
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const fromAddr = username + '@frutiparc.com';
  const toAddrs = parseRecipients(to);

  let mail = existingUid ? findMail(user, existingUid) : null;
  if (mail && mail.folder === 'draftbox') {
    mail.to = to;
    mail.toAddrs = toAddrs;
    mail.subject = subject;
    mail.body = content;
    mail.date = now;
    if (user._dbId) {
      db.saveMail(user._dbId, mail)
        .catch((e) => console.error('[DB] draft update error:', e.message));
    }
  } else {
    mail = {
      uid: genMailUid(),
      from: username,
      fromAddr,
      to,
      toAddrs,
      subject,
      body: content,
      folder: 'draftbox',
      date: now,
      read: true,
    };
    user.mails.push(mail);
    if (user._dbId) {
      db.saveMail(user._dbId, mail)
        .catch((e) => console.error('[DB] draft save error:', e.message));
    }
  }

  console.log(`[Mail] ${username} saved draft ${mail.uid} (subject: ${subject})`);
  res.type('text/xml').send(`<r k="" u="${escapeXml(mail.uid)}" />`);
});

// ─────────────────────────────────────────────
// ENDPOINT: h/send_debug — Debug logging (POST)
// ─────────────────────────────────────────────
app.post('/h/send_debug', (req, res) => {
  const txt = req.body.txt || '';
  console.log('[debug from SWF]', txt);
  res.type('text/plain').send('state=0');
});

// ─────────────────────────────────────────────
// Serve SWF assets under /swf/* (used by the JS fetch interceptor rewrite)
// ─────────────────────────────────────────────
// Compatibility aliases for patched legacy Frusion constants (15-char slash-safe names)
app.get(
  ['/animfrusion.sw', '/animfrusion.sw/', '/animfrusion.swf', '/animfrusion.swf/'],
  (req, res) => {
    res.type('application/x-shockwave-flash');
    res.sendFile(path.join(__dirname, 'public', 'animfrusion.swf'));
  }
);

app.get(
  ['/skinFrusion.sw', '/skinFrusion.sw/', '/skinFrusion.swf', '/skinFrusion.swf/'],
  (req, res) => {
    res.type('application/x-shockwave-flash');
    res.sendFile(path.join(__dirname, 'public', 'skinFrusion.swf'));
  }
);

app.use('/swf/games', (req, res, next) => {
  if (VERBOSE_FRUSION_LOGS) {
    const launchId = getLaunchIdFromReq(req);
    console.log(`[FRUSION] asset launch_id=${launchId || '-'} path=${req.path}`);
  }
  if (req.path.endsWith('.swf')) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.set('Pragma', 'no-cache');
  }
  next();
});
app.use('/games', (req, res, next) => {
  if (req.path.endsWith('.swf')) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.set('Pragma', 'no-cache');
  }
  next();
});
const ruffleDir = path.join(__dirname, 'node_modules', '@ruffle-rs', 'ruffle');
if (fs.existsSync(ruffleDir)) {
  app.use('/ruffle', express.static(ruffleDir, { maxAge: '7d', immutable: true }));
  console.log('[STARTUP] Ruffle served from local npm package');
} else {
  console.log('[STARTUP] Ruffle npm package not found — HTML pages will fall back to CDN');
}
app.use('/swf/games/burningKiwi', express.static(path.join(__dirname, 'Games', 'burningKiwi')));
app.use('/swf/games/kaluga', express.static(path.join(__dirname, 'Games', 'kaluga')));
app.use('/swf/games/miniWave2', express.static(path.join(__dirname, 'Games', 'miniWave2')));
app.use('/swf/games/motionBall2', express.static(path.join(__dirname, 'Games', 'motionBall2')));
app.use('/swf/games/snake3', express.static(path.join(__dirname, 'Games', 'snake3')));
app.use('/swf/games/swapou2', express.static(path.join(__dirname, 'Games', 'swapou2')));
app.use('/swf/games/miniTroll', express.static(path.join(__dirname, 'Games', 'miniTroll')));
app.use('/swf/games/poulpi', express.static(path.join(__dirname, 'Games', 'poulpi')));
// Fallback: Frusion constructs URLs as baseURL+swfId (e.g. "/games/kaluga/kaluga.swf")
// without the /swf/ prefix.  Serve them from the same location.
app.use('/games/burningKiwi', express.static(path.join(__dirname, 'Games', 'burningKiwi')));
app.use('/games/kaluga', express.static(path.join(__dirname, 'Games', 'kaluga')));
app.use('/games/miniWave2', express.static(path.join(__dirname, 'Games', 'miniWave2')));
app.use('/games/motionBall2', express.static(path.join(__dirname, 'Games', 'motionBall2')));
app.use('/games/snake3', express.static(path.join(__dirname, 'Games', 'snake3')));
app.use('/games/swapou2', express.static(path.join(__dirname, 'Games', 'swapou2')));
app.use('/games/miniTroll', express.static(path.join(__dirname, 'Games', 'miniTroll')));
app.use('/games/poulpi', express.static(path.join(__dirname, 'Games', 'poulpi')));
// Avatar parts (fbouille/*.swf) are stable assets that get hit on every
// session — long cache to avoid redownload.
app.use('/swf/fbouille', express.static(path.join(__dirname, 'public', 'swf', 'fbouille'), { maxAge: '7d', immutable: true }));
app.use('/swf', express.static(path.join(__dirname, 'public', 'swf')));

// ─────────────────────────────────────────────
// Forum (opened from the Flash desktop "Forum" link via fp_goURLResize)
// ─────────────────────────────────────────────

app.get(['/fb', '/fb/'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'fb', 'index.html'));
});

function forumAuth(req) {
  const sid = req.query.sid || req.body && req.body.sid || '';
  return resolveUsernameFromSid(sid);
}

// ── Forum rules ──
// Minimum raw content length (chars) for a forum message. Checked on the
// trimmed pre-censor value so a profanity rewrite that inflates short
// inputs (e.g. "serveur" → "gros cube noir et lourd …") doesn't sneak
// past the gate.
const FORUM_MIN_CONTENT_LEN = 10;
// Hard cap on posts per topic, including the initial message. The topic
// auto-locks the moment this count is reached so the 500th message goes
// through but no #501 can ever be posted.
const FORUM_MAX_POSTS_PER_TOPIC = 500;
const FORUM_POSTS_PER_PAGE = 20;
const FORUM_TOO_SHORT_MESSAGE =
  "Alalala, je ne m'en lasse pas de ce site formidable ! Je pourrais en parler pendant des heures !";

function isForumContentTooShort(rawContent) {
  return String(rawContent || '').trim().length < FORUM_MIN_CONTENT_LEN;
}

// Returns { muted: bool, until: string|null, untilDisplay: string|null }
// for the given username. Source of truth = users[].mutedUntil (set by the
// chat 'mute' command). The same lockout that prevents chat messages also
// blocks forum posting, so the rule stays consistent across the site.
function getMuteInfoForUser(username) {
  const u = username && users[username];
  if (!u || !u.mutedUntil) return { muted: false, until: null, untilDisplay: null };
  const raw = String(u.mutedUntil);
  const d = new Date(raw.replace('.', ' '));
  if (Number.isNaN(d.getTime()) || d.getTime() <= Date.now()) {
    return { muted: false, until: null, untilDisplay: null };
  }
  // Friendly FR-style display: "17/05/2026 à 14h30" — short, locale-aware.
  const pad = (n) => String(n).padStart(2, '0');
  const display = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
    + ` à ${pad(d.getHours())}h${pad(d.getMinutes())}`;
  return { muted: true, until: raw, untilDisplay: display };
}

app.get('/api/forum/me', (req, res) => {
  const username = forumAuth(req);
  if (!username) return res.json({ user: null });
  const u = users[username] || {};
  const accessories = (u.customAccessories || [])
    .filter(a => a && !a.v?.startsWith('wp:'))
    .map(a => ({ id: a.id, name: a.n, value: a.v }));
  const defaults = [
    { id: 'bananocle', name: 'Bananocle', suffix: '6010k0w0g' },
    { id: 'beaute',    name: 'Beauté',    suffix: 'b000k0w0g' },
    { id: 'normal',    name: 'Normal',    suffix: '000000000' },
    { id: 'Kiwix',     name: 'Kiwix',     suffix: '30x000000' },
  ];
  // Expose mute status to the frontend so the topic page can pre-disable
  // the "Répondre" button rather than letting the user compose a message
  // that will be rejected on POST. The server still enforces the lockout
  // — this is purely a UX hint.
  const mute = getMuteInfoForUser(username);
  res.json({
    user: getDisplayName(username),
    isModerator: !!u.isModerator,
    isAnimator: !!u.isAnimator,
    bouille: bouilleOf(u, username),
    accessories: accessories,
    defaultAccessories: defaults,
    muted: mute.muted,
    mutedUntil: mute.until,
    mutedUntilDisplay: mute.untilDisplay,
  });
});

// Categories restricted to staff members (moderators + animators). Their
// boards are hidden from the index for everyone else and direct API access
// is denied so guessing board/topic IDs leaks nothing.
const STAFF_ONLY_FORUM_CATEGORIES = new Set(['Gestion du site']);
function isForumStaff(username) {
  if (!username) return false;
  const u = users[username];
  return !!(u && (u.isModerator || u.isAnimator));
}
async function isStaffOnlyBoard(boardId) {
  const board = await db.forumGetBoard(boardId);
  if (!board) return { exists: false, staffOnly: false, board: null };
  const cats = await db.forumGetCategories();
  const cat = cats.find(c => c.id === board.category_id);
  const staffOnly = !!(cat && STAFF_ONLY_FORUM_CATEGORIES.has(cat.name));
  return { exists: true, staffOnly, board };
}

app.get('/api/forum/index', async (req, res) => {
  if (!process.env.DATABASE_URL) return res.json({ categories: [], boards: [] });
  try {
    const currentUser = forumAuth(req);
    const staff = isForumStaff(currentUser);
    const categories = await db.forumGetCategories();
    const boards = await db.forumGetBoards(currentUser);
    const boardsByCategory = {};
    for (const b of boards) {
      if (!boardsByCategory[b.category_id]) boardsByCategory[b.category_id] = [];
      boardsByCategory[b.category_id].push({
        id: b.id, name: b.name, description: b.description,
        topicCount: Number(b.topic_count), postCount: Number(b.post_count),
        lastActivity: b.last_activity, lastActivityBy: getDisplayName(b.last_activity_by),
        unread: !!b.unread,
      });
    }
    const visibleCats = categories.filter(c =>
      staff || !STAFF_ONLY_FORUM_CATEGORIES.has(c.name)
    );
    res.json({
      categories: visibleCats.map(c => ({
        id: c.id, name: c.name,
        boards: boardsByCategory[c.id] || [],
      })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/forum/board/:id', async (req, res) => {
  if (!process.env.DATABASE_URL) return res.json({ board: null, topics: [], total: 0 });
  try {
    const currentUser = forumAuth(req);
    const boardId = Number(req.params.id);
    const page = Math.max(1, Number(req.query.page) || 1);
    const board = await db.forumGetBoard(boardId);
    if (!board) return res.status(404).json({ error: 'board not found' });
    const { staffOnly } = await isStaffOnlyBoard(boardId);
    if (staffOnly && !isForumStaff(currentUser)) {
      return res.status(404).json({ error: 'board not found' });
    }
    const { topics, total } = await db.forumGetTopics(boardId, page, 25, currentUser);
    const topicsOut = topics.map(t => ({
      id: t.id, title: t.title, author: getDisplayName(t.author_username),
      authorBouille: bouilleOf(users[t.author_username], t.author_username),
      isSticky: t.is_sticky, isLocked: t.is_locked,
      viewCount: t.view_count, replyCount: Number(t.reply_count),
      lastPostAt: t.last_post_at, lastPostBy: getDisplayName(t.last_post_by),
      createdAt: t.created_at,
      unread: !!t.unread,
    }));
    res.json({ board: { id: board.id, name: board.name, description: board.description }, topics: topicsOut, total, page, perPage: 25 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/forum/topic/:id', async (req, res) => {
  if (!process.env.DATABASE_URL) return res.json({ topic: null, posts: [], total: 0 });
  try {
    const topicId = Number(req.params.id);
    const page = Math.max(1, Number(req.query.page) || 1);
    const topic = await db.forumGetTopic(topicId);
    if (!topic) return res.status(404).json({ error: 'topic not found' });
    const currentUserForGate = forumAuth(req);
    const { staffOnly } = await isStaffOnlyBoard(topic.board_id);
    if (staffOnly && !isForumStaff(currentUserForGate)) {
      return res.status(404).json({ error: 'topic not found' });
    }
    await db.forumIncrementViews(topicId);
    const board = await db.forumGetBoard(topic.board_id);
    const { posts, total } = await db.forumGetPosts(topicId, page, FORUM_POSTS_PER_PAGE);
    const authorNames = [...new Set(posts.map(p => p.author_username))];
    const postCounts = await db.forumGetPostCounts(authorNames);
    const currentUser = forumAuth(req);
    // Stamp the read marker for the viewer so the topic (and its parent
    // board) flip back to "no unread" once they've actually loaded it.
    // Fire-and-forget — never let a stuck read write block the topic
    // response.
    if (currentUser) {
      db.forumMarkTopicRead(currentUser, topicId).catch((e) => {
        console.error(`[FORUM] forumMarkTopicRead(${currentUser}, ${topicId}) failed: ${e.message}`);
      });
    }
    const currentIsMod = currentUser && users[currentUser] && users[currentUser].isModerator;
    const postsOut = posts.map(p => ({
      id: p.id, author: getDisplayName(p.author_username), content: p.content,
      createdAt: p.created_at, updatedAt: p.updated_at,
      bouille: p.bouille || bouilleOf(users[p.author_username], p.author_username),
      postCount: postCounts[p.author_username] || 0,
      isModerator: !!(users[p.author_username] && users[p.author_username].isModerator),
    }));
    res.json({
      topic: {
        id: topic.id, title: topic.title, author: getDisplayName(topic.author_username),
        boardId: topic.board_id, boardName: board ? board.name : '',
        isSticky: topic.is_sticky, isLocked: topic.is_locked,
        // Lowercase to align with the username comparison the frontend
        // does against currentUser (also lowercase from /api/forum/me).
        lastPostBy: String(topic.last_post_by || '').toLowerCase(),
      },
      posts: postsOut, total, page, perPage: FORUM_POSTS_PER_PAGE,
      currentIsMod: !!currentIsMod,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/forum/topic', async (req, res) => {
  const username = forumAuth(req);
  if (!username) return res.status(401).json({ error: 'auth_required' });
  // Mute lockout: same window as the chat /totoche command. Applies even
  // to moderators so the consequence is consistent across the site.
  const mute = getMuteInfoForUser(username);
  if (mute.muted) {
    return res.status(403).json({
      error: 'muted',
      mutedUntil: mute.until,
      message: `Tu es totoché jusqu'au ${mute.untilDisplay}, tu ne peux pas poster sur le forum tant que la sanction dure.`,
    });
  }
  const boardId = Number(req.body.boardId);
  const rawTitle = String(req.body.title || '').trim();
  const rawContent = String(req.body.content || '').trim();
  if (!rawTitle || !rawContent) return res.status(400).json({ error: 'title and content required' });
  if (rawTitle.length > 200) return res.status(400).json({ error: 'title too long' });
  // Min-length check runs on the *pre-censor* trimmed input — a profanity
  // rewrite can balloon a short input ("serveur" → 41 chars) and we don't
  // want that bypass. Runs before the DB-availability gate so dev envs
  // without DATABASE_URL still surface the validation error.
  if (isForumContentTooShort(rawContent)) {
    return res.status(400).json({ error: 'content_too_short', message: FORUM_TOO_SHORT_MESSAGE });
  }
  if (!process.env.DATABASE_URL) return res.status(503).json({ error: 'no_db' });
  const title = censorProfanity(rawTitle);
  const content = censorProfanity(rawContent);
  const postBouille = req.body.bouille ? normalizeBouilleState(req.body.bouille) : null;
  try {
    const { staffOnly } = await isStaffOnlyBoard(boardId);
    if (staffOnly && !isForumStaff(username)) return res.status(403).json({ error: 'forbidden' });
    const topic = await db.forumCreateTopic(boardId, username, title, content, postBouille);
    trackXpAction(username, 'forumTopic');
    res.json({ ok: true, topicId: topic.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/forum/post', async (req, res) => {
  const username = forumAuth(req);
  if (!username) return res.status(401).json({ error: 'auth_required' });
  const mute = getMuteInfoForUser(username);
  if (mute.muted) {
    return res.status(403).json({
      error: 'muted',
      mutedUntil: mute.until,
      message: `Tu es totoché jusqu'au ${mute.untilDisplay}, tu ne peux pas poster sur le forum tant que la sanction dure.`,
    });
  }
  const topicId = Number(req.body.topicId);
  const rawContent = String(req.body.content || '').trim();
  if (!rawContent) return res.status(400).json({ error: 'content required' });
  if (isForumContentTooShort(rawContent)) {
    return res.status(400).json({ error: 'content_too_short', message: FORUM_TOO_SHORT_MESSAGE });
  }
  if (!process.env.DATABASE_URL) return res.status(503).json({ error: 'no_db' });
  const content = censorProfanity(rawContent);
  const postBouille = req.body.bouille ? normalizeBouilleState(req.body.bouille) : null;
  try {
    const topic = await db.forumGetTopic(topicId);
    if (!topic) return res.status(404).json({ error: 'topic not found' });
    const { staffOnly } = await isStaffOnlyBoard(topic.board_id);
    if (staffOnly && !isForumStaff(username)) return res.status(403).json({ error: 'forbidden' });
    if (topic.is_locked) return res.status(403).json({ error: 'topic locked' });
    // Anti double-post: a user can't be the author of two consecutive
    // messages on the same topic. They must edit their previous post or
    // wait for someone else to reply first. `last_post_by` is maintained
    // by forumCreateTopic + forumCreatePost so it stays in sync.
    if (String(topic.last_post_by || '').toLowerCase() === String(username).toLowerCase()) {
      return res.status(403).json({
        error: 'double_post',
        message: "Tu ne peux pas poster deux messages d'affilée sur le même sujet. Édite ton message précédent ou attends qu'un autre Frutiz réponde.",
      });
    }
    // Hard cap: refuse any post after the topic has reached the limit.
    // The check is before insert so the cap is exact (no race where two
    // simultaneous posters land #500 and #501 together — Postgres
    // serialises the count + insert through the same transaction).
    const currentCount = await db.forumCountPosts(topicId);
    if (currentCount >= FORUM_MAX_POSTS_PER_TOPIC) {
      // Defensive: make sure the topic is locked too, in case the lock
      // didn't stick on the previous boundary insert (legacy data).
      db.forumSetLocked(topicId, true).catch(dbErr('forumSetLocked cap'));
      return res.status(403).json({ error: 'topic_full', message: 'Ce sujet a atteint la limite de 500 messages et est désormais verrouillé.' });
    }
    const post = await db.forumCreatePost(topicId, username, content, postBouille);
    trackXpAction(username, 'forumPost');
    // Auto-lock once we've just inserted what brings the count to the cap.
    if (currentCount + 1 >= FORUM_MAX_POSTS_PER_TOPIC) {
      db.forumSetLocked(topicId, true).catch(dbErr('forumSetLocked auto'));
    }
    res.json({ ok: true, postId: post.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/forum/post/:id', async (req, res) => {
  const username = forumAuth(req);
  if (!username) return res.status(401).json({ error: 'auth_required' });
  const rawContent = String(req.body.content || '').trim();
  if (!rawContent) return res.status(400).json({ error: 'content required' });
  if (isForumContentTooShort(rawContent)) {
    return res.status(400).json({ error: 'content_too_short', message: FORUM_TOO_SHORT_MESSAGE });
  }
  if (!process.env.DATABASE_URL) return res.status(503).json({ error: 'no_db' });
  const content = censorProfanity(rawContent);
  try {
    const { rows } = await db.pool.query('SELECT * FROM forum_posts WHERE id = $1', [req.params.id]);
    const post = rows[0];
    if (!post) return res.status(404).json({ error: 'not found' });
    const isAdmin = users[username] && users[username].isModerator;
    if (post.author_username !== username && !isAdmin) return res.status(403).json({ error: 'forbidden' });
    await db.forumUpdatePost(post.id, content);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/forum/post/:id', async (req, res) => {
  const username = forumAuth(req);
  if (!username) return res.status(401).json({ error: 'auth_required' });
  if (!process.env.DATABASE_URL) return res.status(503).json({ error: 'no_db' });
  try {
    const { rows } = await db.pool.query('SELECT * FROM forum_posts WHERE id = $1', [req.params.id]);
    const post = rows[0];
    if (!post) return res.status(404).json({ error: 'not found' });
    const isAdmin = users[username] && users[username].isModerator;
    if (post.author_username !== username && !isAdmin) return res.status(403).json({ error: 'forbidden' });
    await db.forumDeletePost(post.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/forum/topic/:id/sticky', async (req, res) => {
  const username = forumAuth(req);
  if (!username) return res.status(401).json({ error: 'auth_required' });
  if (!process.env.DATABASE_URL) return res.status(503).json({ error: 'no_db' });
  const isMod = users[username] && users[username].isModerator;
  if (!isMod) return res.status(403).json({ error: 'forbidden' });
  try {
    await db.forumToggleSticky(Number(req.params.id));
    const topic = await db.forumGetTopic(Number(req.params.id));
    res.json({ ok: true, isSticky: topic ? topic.is_sticky : false });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/forum/topic/:id/lock', async (req, res) => {
  const username = forumAuth(req);
  if (!username) return res.status(401).json({ error: 'auth_required' });
  if (!process.env.DATABASE_URL) return res.status(503).json({ error: 'no_db' });
  const isMod = users[username] && users[username].isModerator;
  if (!isMod) return res.status(403).json({ error: 'forbidden' });
  try {
    await db.forumToggleLocked(Number(req.params.id));
    const topic = await db.forumGetTopic(Number(req.params.id));
    res.json({ ok: true, isLocked: topic ? topic.is_locked : false });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/forum/topic/:id', async (req, res) => {
  const username = forumAuth(req);
  if (!username) return res.status(401).json({ error: 'auth_required' });
  if (!process.env.DATABASE_URL) return res.status(503).json({ error: 'no_db' });
  try {
    const topic = await db.forumGetTopic(Number(req.params.id));
    if (!topic) return res.status(404).json({ error: 'not found' });
    const isMod = users[username] && users[username].isModerator;
    if (topic.author_username !== username && !isMod) return res.status(403).json({ error: 'forbidden' });
    const boardId = topic.board_id;
    await db.forumDeleteTopic(Number(req.params.id));
    res.json({ ok: true, boardId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Admin: manage forum structure
// Canonical forum layout used by every seed/migration code path so the
// structure stays in sync. Updating this list automatically backfills
// any missing rubrique on the next startup via ensureForumBoardsExist().
const FORUM_DEFAULT_STRUCTURE = [
  { name: 'Gestion du site', boards: [
    { name: 'Animateur', description: "De l'animation, ses principes généraux, ses dernières nouveautées, ..." },
    { name: 'Modération-Animation', description: 'Ho ! Ca rime !' },
  ]},
  { name: 'Frutiparc', boards: [
    { name: 'Annonces', description: "Les annonces officielles de l'équipe Frutiparc" },
    { name: 'Animations officielles', description: 'Les annonces des prochaines animations organisées par des animateurs à venir' },
    { name: 'Animations Frutiz', description: 'Les annonces des prochaines animations organisées par des frutiz à venir' },
    { name: 'Jeux Frutiparc', description: 'Les jeux de Frutiparc, parlez-en !' },
    { name: 'Frutiz', description: 'Pour parler de la vie des Frutiz, population de frutiparc !' },
    { name: 'Clans', description: 'Tous les clans Frutiparc.' },
  ]},
  { name: 'La vie Frutiz', boards: [
    { name: 'Jeux Vidéos', description: 'Pour parler de votre passion, les jeux vidéos ;)' },
    { name: 'Créations littéraires', description: 'Pour tous vos poèmes, textes et histoires qui sortent tout droit de votre imagination, à vos plumes !' },
    { name: 'Créations graphiques', description: 'Pour tous vos dessins, trucages et gribouillis qui sortent tout droit de votre imagination, à vos crayons !' },
    { name: 'Musique', description: "Car votre passion, c'est la zique, parce que vous voulez partager avec vos amis frutiz..." },
    { name: 'Vie non Frutiz', description: 'Pour parler de la vie... en dehors de Frutiparc. Si si, elle existe !' },
  ]},
];

// Legacy boards that have been renamed/replaced in FORUM_DEFAULT_STRUCTURE.
// On startup their topics are merged into the canonical replacement, then
// the empty legacy board is deleted. Listed by name to handle both fresh
// installs and DBs migrated from an older seed.
const LEGACY_FORUM_BOARDS = [
  // The original seed had a single "Animations" / "Animation" board which
  // was split into "Animations officielles" + "Animations Frutiz". Topics
  // are funneled into "Animations officielles".
  { name: 'Animations',  mergeInto: 'Animations officielles' },
  { name: 'Animation',   mergeInto: 'Animations officielles' },
];

// Enforce FORUM_DEFAULT_STRUCTURE as the canonical layout on every startup:
//   - missing categories/boards are created
//   - a canonical board found in the wrong category is moved
//   - duplicates (same name in another category) have their topics merged
//     into the canonical board, then the empty duplicate is dropped
//   - sort_order is rewritten so the visible order matches the spec
// Boards whose name doesn't appear in FORUM_DEFAULT_STRUCTURE (legacy or
// custom rubriques) are left alone.
async function ensureForumBoardsExist() {
  if (!process.env.DATABASE_URL) return;
  try {
    const categories = await db.forumGetCategories();
    const catByName = {};
    for (const c of categories) catByName[c.name] = c;
    // Ensure every canonical category exists.
    for (let ci = 0; ci < FORUM_DEFAULT_STRUCTURE.length; ci++) {
      const want = FORUM_DEFAULT_STRUCTURE[ci];
      if (!catByName[want.name]) {
        const cat = await db.forumCreateCategory(want.name, categories.length + ci);
        catByName[want.name] = cat;
      }
    }
    let added = 0, moved = 0, merged = 0;
    for (let ci = 0; ci < FORUM_DEFAULT_STRUCTURE.length; ci++) {
      const wantCat = FORUM_DEFAULT_STRUCTURE[ci];
      const targetCatId = catByName[wantCat.name].id;
      for (let bi = 0; bi < wantCat.boards.length; bi++) {
        const wantBoard = wantCat.boards[bi];
        const boards = await db.forumGetBoards();
        const matches = boards.filter(b => b.name === wantBoard.name);
        let canonical = matches.find(b => b.category_id === targetCatId) || null;
        const others = matches.filter(b => b !== canonical);
        if (!canonical && others.length > 0) {
          // Promote the first stray board into the canonical slot.
          canonical = others.shift();
          await db.forumUpdateBoard(canonical.id, {
            category_id: targetCatId,
            sort_order: bi,
          });
          moved++;
        } else if (!canonical) {
          canonical = await db.forumCreateBoard(targetCatId, wantBoard.name, wantBoard.description, bi);
          added++;
        }
        // Collapse any remaining duplicates into the canonical board.
        for (const dup of others) {
          await db.forumMoveTopicsBetweenBoards(dup.id, canonical.id);
          await db.forumDeleteBoard(dup.id);
          merged++;
        }
        // Always re-sync sort_order in case the seed order changed.
        await db.forumUpdateBoard(canonical.id, { sort_order: bi });
      }
    }
    if (added || moved || merged) {
      console.log(`[FORUM] Layout enforced: +${added} added, ${moved} moved, ${merged} duplicates merged`);
    }

    // Drop legacy boards that have been replaced by canonical ones. Their
    // topics are merged into the canonical target so nothing is lost.
    let legacyMerged = 0, legacyDeleted = 0;
    const finalBoards = await db.forumGetBoards();
    for (const legacy of LEGACY_FORUM_BOARDS) {
      const oldBoards = finalBoards.filter(b => b.name === legacy.name);
      if (oldBoards.length === 0) continue;
      const target = finalBoards.find(b => b.name === legacy.mergeInto);
      if (!target) {
        console.warn(`[FORUM] Legacy board "${legacy.name}" has no target "${legacy.mergeInto}" — skipped`);
        continue;
      }
      for (const old of oldBoards) {
        if (old.id === target.id) continue;
        await db.forumMoveTopicsBetweenBoards(old.id, target.id);
        await db.forumDeleteBoard(old.id);
        legacyMerged++;
        legacyDeleted++;
      }
    }
    if (legacyDeleted) {
      console.log(`[FORUM] Legacy cleanup: ${legacyDeleted} rubrique(s) supprimée(s), ${legacyMerged} fusion(s)`);
    }
  } catch (e) {
    console.error('[FORUM] ensureForumBoardsExist error:', e.message);
  }
}

app.post('/api/admin/forum/seed', adminAuth, async (req, res) => {
  if (!process.env.DATABASE_URL) return res.status(503).json({ error: 'no_db' });
  try {
    const existing = await db.forumGetCategories();
    if (existing.length > 0) return res.json({ ok: true, message: 'already seeded' });
    const cats = FORUM_DEFAULT_STRUCTURE;
    for (let ci = 0; ci < cats.length; ci++) {
      const cat = await db.forumCreateCategory(cats[ci].name, ci);
      for (let bi = 0; bi < cats[ci].boards.length; bi++) {
        const b = cats[ci].boards[bi];
        await db.forumCreateBoard(cat.id, b.name, b.description, bi);
      }
    }
    res.json({ ok: true, message: 'seeded' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────
// Club popup (opened from the Flash desktop "Club" link)
// ─────────────────────────────────────────────
app.get(['/club', '/club/'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'club', 'index.html'));
});

app.get('/api/club/medalists', async (req, res) => {
  try {
    let medals = [];
    if (process.env.DATABASE_URL) {
      try { medals = await db.getAllMedals(); } catch (e) { medals = []; }
    }
    if (!medals.length) {
      for (const [day, dayMedals] of Object.entries(challengeMedalsData.medalsByVisibleDay || {})) {
        for (const [username, list] of Object.entries(dayMedals || {})) {
          for (const m of list) {
            medals.push({ awarded_day: day, username, ranking_id: m.rankingId, game: m.game, rank: m.rank, medal: m.medal });
          }
        }
      }
    }
    const counts = {};
    for (const m of medals) {
      const u = m.username;
      if (!counts[u]) counts[u] = { user: getDisplayName(u), gold: 0, silver: 0, bronze: 0, total: 0 };
      // Medals are stored in French ('or', 'argent', 'bronze') by saveMedal.
      if (m.medal === 'or' || m.medal === 'gold') counts[u].gold++;
      else if (m.medal === 'argent' || m.medal === 'silver') counts[u].silver++;
      else if (m.medal === 'bronze') counts[u].bronze++;
      counts[u].total++;
    }
    const list = Object.values(counts).sort(
      (a, b) => b.gold - a.gold || b.silver - a.silver || b.bronze - a.bronze || a.user.localeCompare(b.user)
    );
    res.json({ medalists: list, totalMedals: medals.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/club/records', async (req, res) => {
  const limit = Math.max(1, Math.min(20, Number(req.query.limit) || 10));

  // Build per-(rankingId, user) best score across live scores + archive.
  // bestByRanking[rkId] = { user -> { score, data, updatedAt } }
  const bestByRanking = {};
  const upsertBest = (rkId, user, score, data, updatedAt) => {
    if (!RANKINGS[rkId]) return;
    if (!bestByRanking[rkId]) bestByRanking[rkId] = {};
    const cur = bestByRanking[rkId][user];
    const lowerBetter = isLowerBetter(rkId);
    const isBetter = !cur ||
      (lowerBetter ? score < Number(cur.score) : score > Number(cur.score));
    if (isBetter) {
      bestByRanking[rkId][user] = { score, data: data || '', updatedAt: updatedAt || '' };
    }
  };

  // Live scores (in-memory, also reflects current scores table after boot).
  for (const [u, rlist] of Object.entries(scoresData.users || {})) {
    if (!rlist) continue;
    for (const [rkId, entry] of Object.entries(rlist)) {
      if (!entry || !Number.isFinite(Number(entry.score))) continue;
      upsertBest(rkId, u, Number(entry.score), entry.data, entry.updatedAt);
    }
  }

  // Archive scores (historical days), so the records list survives daily resets.
  if (process.env.DATABASE_URL) {
    try {
      const rows = await db.getAllTimeBestScores();
      for (const r of rows) {
        if (!Number.isFinite(Number(r.score))) continue;
        const updatedAt = r.updated_at ? r.updated_at.toISOString() : '';
        upsertBest(r.ranking_id, r.username, Number(r.score), r.data, updatedAt);
      }
    } catch (e) {
      console.error('[CLUB] records archive query error:', e.message);
    }
  }

  const out = [];
  for (const [rkId, meta] of Object.entries(RANKINGS)) {
    const userMap = bestByRanking[rkId] || {};
    const all = Object.entries(userMap).map(([user, v]) => ({
      user: getDisplayName(user),
      score: Number(v.score),
      data: v.data || '',
      updatedAt: v.updatedAt || '',
    }));
    const lowerBetter = isLowerBetter(rkId);
    all.sort((a, b) => lowerBetter ? a.score - b.score : b.score - a.score);
    const entry = {
      id: rkId,
      name: meta.name,
      game: meta.game,
      type: meta.type,
      lowerIsBetter: !!meta.lowerIsBetter,
      scores: all.slice(0, limit),
    };
    if (meta.bkiwiTrack !== undefined) entry.bkiwiTrack = meta.bkiwiTrack;
    out.push(entry);
  }
  res.json({ rankings: out });
});

// Consecration ranking: every known player sorted by overall consecration score.
app.get('/api/club/consecration', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 100));
    const seen = new Set();

    // Pull every username we know about: in-memory + DB.
    for (const u of Object.keys(users)) seen.add(u);
    if (process.env.DATABASE_URL) {
      try {
        const rows = await db.listAllUsers();
        for (const r of rows) if (r && r.username) seen.add(r.username);
      } catch (e) { /* ignore */ }
    }
    // Also include anyone with stored scores (covers historical players).
    for (const u of Object.keys(scoresData.users || {})) seen.add(u);

    const players = [];
    for (const username of seen) {
      // Make sure we have an in-memory record so computeConsecration finds gameItems.
      if (!users[username] && process.env.DATABASE_URL) {
        try {
          const row = await db.findUserByUsername(username);
          if (row) await hydrateUserFromDb(username, row);
        } catch (e) { /* ignore */ }
      }
      const c = computeConsecration(username);
      players.push({
        user: getDisplayName(username),
        overall: c.overall,
        enabledCount: c.enabledCount,
        perGameMax: c.perGameMax,
        games: c.games,
      });
    }
    players.sort((a, b) => b.overall - a.overall || a.user.localeCompare(b.user));
    res.json({ players: players.slice(0, limit), totalPlayers: players.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────
// Serve static files AFTER API routes so our endpoints take priority
// ─────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
// Fallback: swf.frutiparc.com URLs resolve to root paths (/wheel/wheel1.swf)
// but files live under public/swf/. This second mount acts as fallback.
app.use(express.static(path.join(__dirname, 'public', 'swf')));

// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// Health check
// ─────────────────────────────────────────────
app.get('/healthz', (req, res) => {
  res.json({ ok: true, service: 'frutiparc-backend' });
});

// Catch-all 404 with logging (helps diagnose missing assets)
// ─────────────────────────────────────────────
app.use((req, res) => {
  console.log(`[404]   ${req.method} ${req.url}`);
  res.status(404).type('text/plain').send('Not found');
});

// ─────────────────────────────────────────────
// Start HTTP server
// ─────────────────────────────────────────────
async function boot() {
  if (process.env.DATABASE_URL) {
    try {
      await db.initSchema();
      console.log('[DB] Connected and schema ready');
      const allScores = await db.loadAllScores();
      let count = 0;
      for (const [username, rankings] of Object.entries(allScores)) {
        if (!scoresData.users[username]) scoresData.users[username] = {};
        for (const [rkId, entry] of Object.entries(rankings)) {
          const current = scoresData.users[username][rkId];
          if (!current || Number(entry.score) > Number(current.score)) {
            scoresData.users[username][rkId] = entry;
            count++;
          }
        }
      }
      console.log(`[DB] Loaded ${count} scores from database`);
      const allBouilles = await db.loadAllBouilles();
      Object.assign(bouilleCache, allBouilles);
      console.log(`[DB] Loaded ${Object.keys(allBouilles).length} bouilles from database`);
      try {
        const dbPacks = await db.loadShopPacks();
        const defaultById = Object.fromEntries(SHOP_PACKS_DEFAULT.map(p => [p.id, p]));
        const existingIds = new Set(SHOP_PACKS.map(p => p.id));
        for (const p of dbPacks) {
          const def = defaultById[p.id];
          if (def && def.wallpaperId && !p.wallpaperId) p.wallpaperId = def.wallpaperId;
          if (def && def.picto && !p.picto) p.picto = def.picto;
          if (existingIds.has(p.id)) {
            const idx = SHOP_PACKS.findIndex(x => x.id === p.id);
            SHOP_PACKS[idx] = p;
          } else {
            SHOP_PACKS.push(p);
          }
        }
        console.log(`[DB] Loaded ${dbPacks.length} shop packs from database`);
        for (const p of SHOP_PACKS) {
          if (!dbPacks.find(d => d.id === p.id)) {
            db.upsertShopPack(p).catch(dbErr('upsertShopPack'));
          } else if (p.wallpaperId) {
            const dbP = dbPacks.find(d => d.id === p.id);
            if (dbP && !dbP.wallpaperId) db.upsertShopPack(p).catch(dbErr('upsertShopPack'));
          }
        }
      } catch (e) { console.error('[DB] Shop packs load error:', e.message); }
      try {
        // ensureForumBoardsExist() creates missing rubriques, moves
        // misplaced ones, merges duplicates, and re-syncs sort_order — so
        // a single call covers both fresh-install seeding and migration.
        await ensureForumBoardsExist();
      } catch (e) { console.error('[FORUM] Seed error:', e.message); }
      try {
        const existingTopics = await db.listGaspardHelpTopics();
        if (existingTopics.length === 0) {
          // Hierarchical seed: one is_index landing page + a handful of
          // categories (parent_id=null) with sub-rubriques. Admins can
          // restructure freely via admin.html → "Aide Gaspard".
          const seedTree = [
            {
              title: "Bienvenue chez Gaspard",
              keywords: 'index accueil bienvenue gaspard sommaire',
              sort_order: 0,
              is_index: true,
              body: "Bonjour ! Je suis <b>Gaspard</b>, votre h&#244;te sur Frutiparc.<br/><br/>"
                + "Choisissez une rubrique ci-dessous pour explorer le site, ou tapez votre question dans la zone de recherche.<br/><br/>"
                + "Si vous d&#233;butez, je vous conseille de commencer par <i>Sur le bureau</i> puis <i>Le chat</i>.<br/><br/>"
                + "Bonne visite chez les Frutiz !",
            },
            {
              title: "Sur le bureau",
              keywords: 'bureau desktop icone navigation',
              sort_order: 10,
              body: "Le bureau de Frutiparc est l&#8217;&#233;cran d&#8217;accueil sur lequel vous arrivez apr&#232;s vous &#234;tre connect&#233;.<br/><br/>"
                + "Vous y trouvez plusieurs ic&#244;nes qui ouvrent chacune une fen&#234;tre&#160;: vos disques, votre inventaire, votre bo&#238;te aux lettres, vos contacts, et bien d&#8217;autres.<br/><br/>"
                + "Cliquez sur une sous-rubrique ci-dessous pour en savoir plus.",
              children: [
                {
                  title: "Les ic&#244;nes du bureau",
                  keywords: 'icones bureau disque inventaire mail contact',
                  body: "Les ic&#244;nes principales du bureau&#160;:<br/>"
                    + "&#8226; <i>Mes disques</i>&#160;: votre collection de jeux<br/>"
                    + "&#8226; <i>Inventaire</i>&#160;: vos accessoires, fonds d&#8217;&#233;cran et pictos<br/>"
                    + "&#8226; <i>Bo&#238;te aux lettres</i>&#160;: vos mails entrants<br/>"
                    + "&#8226; <i>Mes contacts</i>&#160;: vos amis Frutiz<br/>"
                    + "&#8226; <i>Boutique</i>&#160;: accessoires et fonds d&#8217;&#233;cran &#224; acheter avec des Kikooz",
                },
                {
                  title: "La console Frusion",
                  keywords: 'frusion console disque jeux jouer ejecter',
                  body: "La <b>console Frusion</b> est l&#8217;appareil sur lequel vous lancez vos jeux.<br/><br/>"
                    + "Pour jouer, faites glisser un disque depuis <i>Mes disques</i> sur la console. Pour arr&#234;ter, cliquez sur le bouton &#233;jecter ou rangez le disque dans son boitier.",
                },
              ],
            },
            {
              title: "Le chat",
              keywords: 'chat salon pomme conversation commande',
              sort_order: 20,
              body: "Le chat de Frutiparc se compose de plusieurs salons color&#233;s, repr&#233;sent&#233;s par des pommes en haut &#224; gauche du bureau.<br/><br/>"
                + "Cliquez sur une pomme pour rejoindre le salon correspondant. Choisissez ensuite votre couleur de feutre dans la palette pour discuter avec les autres Frutiz.",
              children: [
                {
                  title: "Rejoindre un salon",
                  keywords: 'salon rejoindre pomme couleur',
                  body: "Pour rejoindre un salon, cliquez simplement sur une des pommes color&#233;es en haut &#224; gauche du bureau. Chaque pomme correspond &#224; un salon th&#233;matique.",
                },
                {
                  title: "Les commandes de chat",
                  keywords: 'commande slash aide topic fiche donne kick',
                  body: "Quelques commandes utiles dans le chat&#160;:<br/>"
                    + "&#8226; <i>/aide</i> ou <i>/help</i>&#160;: ouvre cette fen&#234;tre<br/>"
                    + "&#8226; <i>/fiche pseudo</i>&#160;: affiche la fiche d&#8217;un Frutiz<br/>"
                    + "&#8226; <i>/donne pseudo nombre</i>&#160;: offre des Kikooz<br/>"
                    + "&#8226; <i>/topic ...</i>&#160;: change le sujet du salon (mod&#233;rateurs)",
                },
              ],
            },
            {
              title: "Mon profil",
              keywords: 'profil fiche bouille frutibouille accessoires',
              sort_order: 30,
              body: "Votre profil est l&#8217;identit&#233; que les autres Frutiz voient de vous.<br/><br/>"
                + "Il comprend votre <i>Frutibouille</i> (votre avatar), votre fiche, vos accessoires et vos pictos. Vous pouvez tout personnaliser.",
              children: [
                {
                  title: "Ma Frutibouille",
                  keywords: 'bouille frutibouille avatar apparence personnalisation editeur',
                  body: "Votre <b>Frutibouille</b> est votre avatar sur Frutiparc.<br/><br/>"
                    + "Pour la personnaliser, cliquez sur votre propre fiche et utilisez l&#8217;&#233;diteur de bouille&#160;: cheveux, yeux, peau, v&#234;tements et accessoires sont tous modifiables.",
                },
                {
                  title: "Les accessoires",
                  keywords: 'accessoire boutique inventaire wallpaper fond ecran',
                  body: "Vos accessoires sont rang&#233;s dans votre <i>Inventaire</i>. Vous pouvez les utiliser pour habiller votre Frutibouille.<br/><br/>"
                    + "De nouveaux accessoires se d&#233;bloquent en jouant ou s&#8217;ach&#232;tent &#224; la <i>Boutique</i> avec des Kikooz.",
                },
                {
                  title: "Mes pictos",
                  keywords: 'pictos titem recompense fiche carte fruticard',
                  body: "Les <b>pictos</b> (ou <b>titems</b>) sont les r&#233;compenses que vous gagnez en jouant.<br/><br/>"
                    + "Chaque jeu propose ses propres pictos &#224; d&#233;bloquer en atteignant certains objectifs. Tous vos pictos s&#8217;affichent dans votre <i>Inventaire &#8594; Pictos</i> et sur votre <i>FrutiCard</i>.",
                },
              ],
            },
            {
              title: "Les jeux",
              keywords: 'jeux disque score challenge medaille pictos',
              sort_order: 40,
              body: "Frutiparc propose une dizaine de jeux Flash que vous pouvez lancer depuis vos disques.<br/><br/>"
                + "Chaque jeu poss&#232;de ses propres pictos, son classement classique (records perso) et son d&#233;fi journalier (Challenge).",
              children: [
                {
                  title: "Lancer un jeu",
                  keywords: 'jeu disque console frusion lancer',
                  body: "Glissez un disque depuis <i>Mes disques</i> sur la console Frusion. Le jeu se lance dans une fen&#234;tre d&#233;di&#233;e.<br/><br/>"
                    + "Pour ranger le jeu, cliquez sur le bouton &#233;jecter de la console ou fermez la fen&#234;tre.",
                },
                {
                  title: "Les scores et le challenge",
                  keywords: 'score classement challenge medaille or argent bronze daily',
                  body: "Vos scores se s&#233;parent en deux familles&#160;:<br/>"
                    + "&#8226; <b>Classique</b>&#160;: votre meilleur score historique sur le jeu<br/>"
                    + "&#8226; <b>Challenge</b>&#160;: votre meilleur score du jour, remis &#224; z&#233;ro chaque nuit<br/><br/>"
                    + "Les trois meilleurs joueurs du Challenge gagnent chaque jour une m&#233;daille d&#8217;or, d&#8217;argent ou de bronze.",
                },
              ],
            },
            {
              title: "Les Kikooz",
              keywords: 'kikooz monnaie boutique cadeau donne',
              sort_order: 50,
              body: "Les <b>Kikooz</b> sont la monnaie virtuelle de Frutiparc.<br/><br/>"
                + "Vous en gagnez en jouant, en participant au chat et en relevant des d&#233;fis quotidiens. Vous pouvez les d&#233;penser &#224; la <i>Boutique</i> ou les offrir &#224; un autre Frutiz via la commande <i>/donne pseudo nombre</i>.",
            },
          ];

          let seeded = 0;
          for (const cat of seedTree) {
            const { children = [], ...catFields } = cat;
            const root = await db.createGaspardHelpTopic({ ...catFields, parent_id: null });
            seeded++;
            for (let i = 0; i < children.length; i++) {
              await db.createGaspardHelpTopic({
                ...children[i],
                parent_id: root.id,
                sort_order: (i + 1) * 10,
              });
              seeded++;
            }
          }
          console.log(`[GASPARD] Seeded ${seeded} help topic(s) — hierarchy with is_index landing page`);
        } else {
          console.log(`[GASPARD] ${existingTopics.length} help topic(s) already in DB`);
        }
      } catch (e) { console.error('[GASPARD] Seed error:', e.message); }
      try {
        const dbChannels = await db.loadChannels();
        let count = 0;
        for (const [name, data] of Object.entries(dbChannels)) {
          if (channels[name]) {
            if (data.topic) channels[name].topic = data.topic;
            if (data.label) channels[name].desc = data.label;
          }
          count++;
        }
        console.log(`[DB] Loaded ${count} channel overrides from database`);
      } catch (e) { console.error('[DB] Channel load error:', e.message); }
    } catch (e) {
      console.error('[DB] Init failed (running without persistence):', e.message);
    }
  } else {
    console.log('[DB] No DATABASE_URL — running in memory-only mode');
  }

  const today = parisDayKey();
  await rollDailyChallengeIfNeeded();

  if (process.env.DATABASE_URL) {
    const yesterday = yesterdayParisDayKey();
    try {
      const dbMedals = await db.getMedalsByDay(yesterday);
      if (Object.keys(dbMedals).length > 0) {
        challengeMedalsData.medalsByVisibleDay[yesterday] = dbMedals;
        saveChallengeMedals();
        console.log(`[CHALLENGE] Loaded ${Object.keys(dbMedals).length} medalists from DB for ${yesterday} (overrides JSON)`);
      }
    } catch (e) { console.error('[CHALLENGE] DB medal load error:', e.message); }

    const dayMedals = challengeMedalsData.medalsByVisibleDay[yesterday];
    if (dayMedals && Object.keys(dayMedals).length > 0) {
      const ranksByRanking = {};
      for (const medals of Object.values(dayMedals)) {
        for (const m of medals) {
          if (!ranksByRanking[m.rankingId]) ranksByRanking[m.rankingId] = [];
          ranksByRanking[m.rankingId].push(m.rank);
        }
      }
      const hasDuplicateRanks = Object.values(ranksByRanking).some(ranks =>
        ranks.length !== new Set(ranks).size
      );
      if (hasDuplicateRanks) {
        console.log(`[CHALLENGE] Corrupt medal data detected for ${yesterday} — regenerating from archive`);
        try {
          const rows = await db.getArchivedScoresForDay(yesterday);
          if (rows.length > 0) {
            const byRanking = {};
            for (const r of rows) {
              if (!byRanking[r.ranking_id]) byRanking[r.ranking_id] = [];
              byRanking[r.ranking_id].push({ u: r.username, s: Number(r.score), data: r.data });
            }
            const winnersByUser = {};
            for (const rkId of challengeRankingIds()) {
              const all = byRanking[rkId] || [];
              all.sort(scoreComparator(rkId));
              const top = all.slice(0, 3);
              for (let i = 0; i < top.length; i++) {
                const rank = i + 1;
                const medal = rank === 1 ? 'or' : rank === 2 ? 'argent' : 'bronze';
                if (!winnersByUser[top[i].u]) winnersByUser[top[i].u] = [];
                winnersByUser[top[i].u].push({
                  game: (RANKINGS[rkId] && RANKINGS[rkId].game) || rkId,
                  rankingId: rkId, rank, medal,
                });
              }
            }
            await db.deleteMedalsByDay(yesterday);
            for (const [username, medals] of Object.entries(winnersByUser)) {
              for (const m of medals) {
                const row = await db.findUserByUsername(username).catch(() => null);
                await db.saveMedal((row && row.id) || 0, username, m.rankingId, m.game, m.rank, m.medal, yesterday);
              }
            }
            challengeMedalsData.medalsByVisibleDay[yesterday] = winnersByUser;
            saveChallengeMedals();
            console.log(`[CHALLENGE] Regenerated medals for ${yesterday} from archived scores`);
          }
        } catch (e) { console.error('[CHALLENGE] Regeneration error:', e.message); }
      }
    }
  }

  if (VERBOSE_HTTP_LOGS) {
    console.log(`[CHALLENGE] lastRollDay=${challengeMedalsData.lastRollDay}, today=${today}`);
  }

  // Generate MB2 (MotionBall 2) map data files if missing (non-blocking)
  try {
    const mb2Dir = path.join(__dirname, 'Games', 'motionBall2');
    if (!fs.existsSync(path.join(mb2Dir, 'mb2data.dat'))) {
      console.log('[MB2] Map files missing, will generate in background after server starts');
      setImmediate(async () => {
        try {
          const { generateMB2Maps } = require('./mb2gen');
          const log = await generateMB2Maps();
          console.log(`[MB2] ${log}`);
        } catch (e) {
          console.error('[MB2] Map generation error:', e.message);
        }
      });
    } else {
      console.log('[MB2] Map files already exist');
    }
  } catch (e) {
    console.error('[MB2] Map generation error:', e.message);
  }
}

boot();

setInterval(async () => {
  try { await rollDailyChallengeIfNeeded(); } catch (e) {
    console.error('[CHALLENGE] timer error:', e.message);
  }
}, 30000);

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`[HTTP]  Server running on http://0.0.0.0:${port}`);
  if (PUBLIC_HOST) {
    console.log(`        Public URL:  https://${PUBLIC_HOST}/`);
    console.log(`        Legacy SWF:  https://${PUBLIC_HOST}/legacy`);
  } else {
    console.log('        Public URL:  (auto from request host; set PUBLIC_HOST to force)');
  }
  console.log(`[BOOT]  XMLSOCKET_PORT=${XMLSOCKET_PORT} (chat) / FRUTISCORE_PORT=${FRUTISCORE_PORT} (scores)`);

  // Reconcile mod-badge and anim-cap inventories with each user's role.
  syncAllRoleAccessories().catch((e) =>
    console.error('[ROLE-ACC] startup sync failed:', e.message),
  );

  // Auto-seed forum categories/boards and demo content on first run
  if (process.env.DATABASE_URL) {
    (async () => {
      try {
        const before = await db.forumGetCategories();
        const wasEmpty = before.length === 0;
        // Always run the layout enforcer — it both seeds an empty DB and
        // backfills/moves rubriques on an existing one.
        await ensureForumBoardsExist();
        if (wasEmpty) {
          // Drop a couple of demo topics so the forum isn't empty on the
          // very first visit.
          const allBoards = await db.forumGetBoards();
          const demoUser = 'Frutiparc';
          if (!users[demoUser]) users[demoUser] = { isModerator: true };
          const annonces = allBoards.find(b => b.name === 'Annonces');
          const frutiz = allBoards.find(b => b.name === 'Frutiz');
          if (annonces) {
            await db.forumCreateTopic(annonces.id, demoUser,
              'Bienvenue sur le forum Frutiparc !',
              "[b]Bienvenue à tous sur le forum de Frutiparc ![/b]\n\nIci vous pouvez discuter avec les autres Frutiz, partager vos scores et vos créations.\n\nBonne visite !");
          }
          if (frutiz) {
            const t2 = await db.forumCreateTopic(frutiz.id, demoUser,
              'Quel est votre jeu préféré ?',
              "Salut les Frutiz ! :)\n\nDites-moi, quel est votre jeu préféré sur Frutiparc ?\n\nPersonnellement j'adore [b]Swapou[/b], le mode duel est super fun !");
            await db.forumCreatePost(t2.id, demoUser,
              "J'oubliais, [i]Kaluga[/i] est pas mal non plus pour se détendre.");
          }
          console.log('[FORUM] Seed complete with demo topics');
        }
      } catch (e) {
        console.error('[FORUM] Seed error:', e.message);
      }
    })();

    // Retroactive backfill: re-extract pictos from ALL saved slot data
    // for ALL users in DB. Uses extractGameItemsFromSlot with userOverride
    // so we never touch the live `users` object (avoids race conditions
    // with concurrent logins). Idempotent — runs every startup.
    (async () => {
      try {
        const allUsers = await db.listAllUsers();
        let totalAdded = 0;
        let usersScanned = 0;
        for (const u of allUsers) {
          let allSlots;
          try { allSlots = await db.getAllFrutiSlots(u.id); } catch { continue; }
          if (!allSlots || Object.keys(allSlots).length === 0) continue;
          usersScanned++;
          let existingItems;
          try { existingItems = await db.getUserGameItems(u.id); } catch { existingItems = []; }
          const localUser = { gameItems: existingItems || [], _dbId: u.id };
          const beforeCount = localUser.gameItems.length;
          for (const game of Object.keys(allSlots)) {
            const s0 = allSlots[game]['0'] || allSlots[game][0];
            if (!s0) continue;
            try {
              extractGameItemsFromSlot(u.username, game, s0, { silent: true, userOverride: localUser });
            } catch { /* ignore */ }
          }
          const newCount = localUser.gameItems.length - beforeCount;
          if (newCount > 0) {
            totalAdded += newCount;
            // Also push to in-memory user if they happen to be logged in
            const memUser = users[u.username];
            if (memUser && Array.isArray(memUser.gameItems)) {
              for (const item of localUser.gameItems) {
                if (!memUser.gameItems.includes(item)) memUser.gameItems.push(item);
              }
            }
          }
        }
        console.log(`[BACKFILL] pictos: scanned ${usersScanned} user(s), added ${totalAdded} new item(s)`);
      } catch (e) {
        console.error('[BACKFILL] picto extraction error:', e.message);
      }
    })();
  }
});

// ─────────────────────────────────────────────
// WebSocket → TCP bridge for Ruffle's socketProxy
//
// Ruffle's socketProxy emulates a raw TCP socket over WebSocket.
// Flash XMLSocket uses \0 as message delimiter.
// The bridge MUST preserve \0 in BOTH directions so Ruffle's
// internal XMLSocket parser can split messages correctly.
// ─────────────────────────────────────────────
const wssChat = new WebSocketServer({ noServer: true });
const wssScore = new WebSocketServer({ noServer: true });

// Route WebSocket upgrades based on URL path:
//   /score  → FrutiScore handler (inline protocol, no TCP bridge)
//   other   → TCP bridge to XMLSOCKET_PORT
server.on('upgrade', (request, socket, head) => {
  const pathname = (request.url || '/').split('?')[0];
  if (pathname === '/score') {
    wssScore.handleUpgrade(request, socket, head, (ws) => {
      wssScore.emit('connection', ws, request);
    });
  } else {
    wssChat.handleUpgrade(request, socket, head, (ws) => {
      wssChat.emit('connection', ws, request);
    });
  }
});

// ── Main chat WebSocket → TCP bridge ──
wssChat.on('connection', (ws) => {
  console.log('[WS→TCP] New WebSocket client, bridging to TCP localhost:' + XMLSOCKET_PORT);

  const tcp = net.createConnection({ host: '127.0.0.1', port: XMLSOCKET_PORT }, () => {
    console.log('[WS→TCP] TCP connection established');
  });

  ws.on('message', (msg) => {
    const buf = Buffer.isBuffer(msg) ? msg : Buffer.from(msg);
    if (VERBOSE_WS_LOGS) {
      const str = buf.toString('utf8');
      console.log('[WS→TCP] WS→TCP:', str.replace(/\0/g, '').substring(0, 200));
    }
    if (buf.length > 0 && buf[buf.length - 1] === 0x00) {
      tcp.write(buf);
    } else {
      tcp.write(Buffer.concat([buf, Buffer.from([0x00])]));
    }
  });

  tcp.on('data', (data) => {
    if (VERBOSE_WS_LOGS) {
      const str = data.toString('utf8');
      const parts = str.split('\0').filter(s => s.trim().length > 0);
      for (const part of parts) {
        console.log('[WS→TCP] TCP→WS:', part.substring(0, 200));
      }
    }
    ws.send(data);
  });

  tcp.on('error', (err) => {
    console.error('[WS→TCP] TCP error:', err.message);
    ws.close();
  });

  tcp.on('close', () => {
    console.log('[WS→TCP] TCP closed');
    ws.close();
  });

  ws.on('close', () => {
    console.log('[WS→TCP] WS closed');
    tcp.destroy();
  });

  ws.on('error', (err) => {
    console.error('[WS→TCP] WS error:', err.message);
    tcp.destroy();
  });
});

// ── FrutiScore WebSocket → TCP bridge ──
// Uses the same TCP bridge approach as the chat WebSocket, connecting to the
// same CBee TCP server on XMLSOCKET_PORT.  The /score path provides URL
// isolation so Ruffle can open a second WebSocket independently of the chat
// connection.  The TCP CBee server already handles FrutiScore wire codes
// (listrankings, rankingresult, userresult, etc.) via overlap detection.
wssScore.on('connection', (ws) => {
  console.log('[FSCORE-WS] New score WebSocket client, bridging to TCP localhost:' + XMLSOCKET_PORT);

  const tcp = net.createConnection({ host: '127.0.0.1', port: XMLSOCKET_PORT }, () => {
    console.log('[FSCORE-WS] TCP connection established');
  });

  ws.on('message', (msg) => {
    const buf = Buffer.isBuffer(msg) ? msg : Buffer.from(msg);
    if (VERBOSE_WS_LOGS) {
      const str = buf.toString('utf8');
      console.log('[FSCORE-WS] WS→TCP:', str.replace(/\0/g, '').substring(0, 200));
    }
    if (buf.length > 0 && buf[buf.length - 1] === 0x00) {
      tcp.write(buf);
    } else {
      tcp.write(Buffer.concat([buf, Buffer.from([0x00])]));
    }
  });

  tcp.on('data', (data) => {
    if (VERBOSE_WS_LOGS) {
      const str = data.toString('utf8');
      const parts = str.split('\0').filter(s => s.trim().length > 0);
      for (const part of parts) {
        console.log('[FSCORE-WS] TCP→WS:', part.substring(0, 200));
      }
    }
    ws.send(data);
  });

  tcp.on('error', (err) => {
    console.error('[FSCORE-WS] TCP error:', err.message);
    ws.close();
  });

  tcp.on('close', () => {
    console.log('[FSCORE-WS] TCP closed');
    ws.close();
  });

  ws.on('close', () => {
    console.log('[FSCORE-WS] WS closed');
    tcp.destroy();
  });

  ws.on('error', (err) => {
    console.error('[FSCORE-WS] WS error:', err.message);
    tcp.destroy();
  });
});

// ═════════════════════════════════════════════
// XMLSocket Server (CBee protocol)
//
// Flash's XMLSocket sends null-terminated (\0)
// XML strings over a raw TCP connection.
// The server must also send null-terminated XML.
// ═════════════════════════════════════════════

// Command name <-> wire code mappings (from cmdList.as / cmdList2.as)
const CMD = {
  // Global
  error:       'a',
  serviceinfo: 'b',
  time:        'c',
  ip:          'd',
  ping:        'e',
  ident:       'k',
  // FrutiChat
  kick:             'l',
  ban:              'm',
  unban:            'n',
  join:             'o',
  userlist:         'p',
  channellist:      'q',
  createchannel:    'r',
  invitechat:       's',
  send:             't',
  userleaved:       'u',
  userjoined:       'v',
  channelclosed:    'w',
  refuse:           'x',
  part:             'y',
  trace:            'z',
  stoptrace:        'aa',
  invite:           'ab',
  givexp:           'ac',
  stealxp:          'ad',
  fbouille:         'ae',
  status:           'af',
  onkick:           'ag',
  onban:            'ah',
  onunban:          'ai',
  tracecallback:    'aj',
  invisible:        'ak',
  xpreceived:       'al',
  xpstolen:         'am',
  topic:            'an',
  bannedusers:      'ao',
  adminsend:        'ap',
  userinfo:         'aq',
  listbouilles:     'ar',
  addmoderator:     'as',
  delmoderator:     'at',
  changebg:         'au',
  activatefeat:     'av',
  newuserlog:       'aw',
  newmail:          'ax',
  newforummsg:      'ay',
  newsitelog:       'bl',
  mute:             'az',
  unmute:           'ba',
  onmute:           'bb',
  endmute:          'bc',
  xpflag:           'bg',
  senduserongroup:  'bk',
  awardgame:        'ha',
  awarduser:        'hb',
  xpposition:       'bm',
  searchuser:       'bn',
  callmoderator:    'bo',
  moderatorcalled:  'bp',
  // FrutiCard (slot storage)
  fcardgetpublicslot: 'ea',
  fcardlistslots:     'eb',
  fcardloadslot:      'ec',
  fcardupdateslot:    'ed',
  fcardclearslot:     'ee',
  fcardlist:          'ef',
  statusobj:          'statusobj',
};

// Reverse lookup: wire code -> command name
const CMD_REV = {};
for (const [name, code] of Object.entries(CMD)) {
  CMD_REV[code] = name;
}
// Frusion games use FrutiCard tags fa-fe (offset from main client's ea-ee)
CMD_REV['fa'] = 'fcardgetpublicslot';
CMD_REV['fb'] = 'fcardlistslots';
CMD_REV['fc'] = 'fcardloadslot';
CMD_REV['fd'] = 'fcardupdateslot';
CMD_REV['fe'] = 'fcardclearslot';

// Simple XML builder/parser for the CBee protocol
function xmlTag(name, attrs = {}, content = '') {
  const a = Object.entries(attrs).map(([k, v]) => ` ${k}="${escapeXml(String(v))}"`).join('');
  if (content) return `<${name}${a}>${content}</${name}>`;
  return `<${name}${a} />`;
}

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Minimal XML attribute parser (good enough for CBee messages)
function parseXmlAttrs(xmlStr) {
  const result = { tag: '', attrs: {}, content: '', children: [] };
  // Get tag name
  const tagMatch = xmlStr.match(/^<(\w+)/);
  if (!tagMatch) return result;
  result.tag = tagMatch[1];
  // Get attributes
  const attrRegex = /(\w+)="([^"]*)"/g;
  let m;
  while ((m = attrRegex.exec(xmlStr)) !== null) {
    result.attrs[m[1]] = m[2];
  }
  // Get text content between > and </
  const contentMatch = xmlStr.match(/>([^<]*)</);
  if (contentMatch) result.content = contentMatch[1];
  // Get child elements (one level deep)
  const childRegex = /<(\w+)([^>]*?)(?:\/>|>([^<]*)<\/\1>)/g;
  // Skip the root tag — find children inside
  const innerMatch = xmlStr.match(/^<[^>]+>([\s\S]*)<\/[^>]+>$/);
  if (innerMatch) {
    let cm;
    while ((cm = childRegex.exec(innerMatch[1])) !== null) {
      const childAttrs = {};
      let ca;
      const caRegex = /(\w+)="([^"]*)"/g;
      while ((ca = caRegex.exec(cm[2])) !== null) {
        childAttrs[ca[1]] = ca[2];
      }
      result.children.push({ tag: cm[1], attrs: childAttrs, content: cm[3] || '' });
    }
  }
  return result;
}

// ─────────────────────────────────────────────
// CBee client state
// ─────────────────────────────────────────────
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

// ── Virtual users / PNJ (always connected on pomme) ──
const CONNECTED_NPCS = new Set([
  'gaspard',
]);

// Gaspard is the welcome-bot NPC. Stored under the lowercase key
// `users.gaspard` like every other user (getDisplayName, trace and
// bouilleOf all index `users[username.toLowerCase()]`); the
// displayName field preserves the visible capitalisation. Previously
// the user record was stored as `users.Gaspard` which meant the
// case-insensitive lookups missed it — the desktop contact icon
// rendered with DEFAULT_BOUILLE_STATE instead of Gaspard's actual
// bouille '0n0000000000000000000000'.
users.gaspard = {
  pass: '',
  xp: 9999999,
  kikooz: 100,
  fbouille: '0n0000000000000000000000',
  items: withDefaultPens([1, 2, 3]),
  contacts: [],
  blacklist: [],
  gender: 'M',
  birthday: '2004-03-24',
  country: '0',
  region: '0',
  countryIndex: '0',
  regionIndex: '0',
  prefs: '',
  isModerator: false,
  needsBouille: false,
  city: '',
  realJob: '',
  firstName: 'Gaspard',
  lastName: '',
  comment: '',
  siteUrl: '',
  displayName: 'Gaspard',
};

// ── mdamirma — FrutiSigne bot ──
const FRUTI_SIGN_NAMES = ['pomme','abricot','poire','fraise','citron','kiwi','raisin','orange','cerise','banane'];

users.mdamirma = {
  pass: '',
  xp: 777777,
  kikooz: 0,
  fbouille: '0004060h040700030j070008',
  items: withDefaultPens([]),
  contacts: [],
  blacklist: [],
  gender: 'F',
  birthday: '1999-09-09',
  country: 'FR',
  region: 'IDF',
  countryIndex: '1',
  regionIndex: '1',
  prefs: '',
  isModerator: false,
  needsBouille: false,
  city: 'Les astres',
  realJob: 'Voyante',
  firstName: 'Mme',
  lastName: 'Irma',
  comment: "J'vois tout, j'sais tout !",
  siteUrl: '',
  frutiSign: 8,
  frutiSignB: 5,
  displayName: 'mdamirma',
};
let mdamirmaCurrentChannel = null;

function mdamirmaPickChannel() {
  let best = null;
  let bestCount = 0;
  for (const [name, ch] of Object.entries(channels)) {
    const realUsers = [...ch.users].filter(u => !CONNECTED_NPCS.has(u) && u !== 'mdamirma');
    if (realUsers.length > bestCount) {
      bestCount = realUsers.length;
      best = name;
    }
  }
  return bestCount > 0 ? best : null;
}

function mdamirmaJoin(channelName) {
  if (mdamirmaCurrentChannel) {
    const oldCh = channels[mdamirmaCurrentChannel];
    if (oldCh) {
      oldCh.users.delete('mdamirma');
      broadcastToChannel(mdamirmaCurrentChannel,
        `<${CMD.userleaved} u="${escapeXml(getDisplayName('mdamirma'))}" g="${escapeXml(mdamirmaCurrentChannel)}" />`
      );
    }
  }
  mdamirmaCurrentChannel = channelName;
  const ch = channels[channelName];
  if (!ch) return;
  ch.users.add('mdamirma');
  broadcastToChannel(channelName,
    `<${CMD.userjoined} ${buildUserAttrs('mdamirma')} g="${escapeXml(channelName)}" />`
  );
}

function mdamirmaLeave() {
  if (!mdamirmaCurrentChannel) return;
  const ch = channels[mdamirmaCurrentChannel];
  if (ch) {
    ch.users.delete('mdamirma');
    broadcastToChannel(mdamirmaCurrentChannel,
      `<${CMD.userleaved} u="${escapeXml(getDisplayName('mdamirma'))}" g="${escapeXml(mdamirmaCurrentChannel)}" />`
    );
  }
  mdamirmaCurrentChannel = null;
}

function mdamirmaSay(channelName, text) {
  const timeAttrs = buildChatTimeAttrs();
  broadcastToChannel(channelName,
    `<${CMD.send} u="${escapeXml(getDisplayName('mdamirma'))}" t="m" p="" g="${escapeXml(channelName)}" h="${timeAttrs.h}" d="${timeAttrs.d}">${escapeXml(text)}</${CMD.send}>`
  );
}

function mdamirmaPickTarget(channelName) {
  const ch = channels[channelName];
  if (!ch) return null;
  const candidates = [...ch.users].filter(u => {
    if (CONNECTED_NPCS.has(u) || u === 'mdamirma') return false;
    const ud = users[u];
    if (!ud) return false;
    return ud.frutiSign < 0 || ud.frutiSignB < 0;
  });
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

async function mdamirmaReveal() {
  const channelName = mdamirmaPickChannel();
  if (!channelName) return;

  mdamirmaJoin(channelName);

  const target = mdamirmaPickTarget(channelName);
  if (!target) {
    setTimeout(() => {
      mdamirmaSay(channelName, "Hmm... je ne vois personne à éclairer ici...");
      setTimeout(() => mdamirmaLeave(), 5000 + Math.random() * 5000);
    }, 2000 + Math.random() * 3000);
    return;
  }

  const sign = Math.floor(Math.random() * 10);
  const signB = Math.floor(Math.random() * 10);
  const ud = users[target];
  ud.frutiSign = sign;
  ud.frutiSignB = signB;

  if (ud._dbId) {
    db.updateUser(target, { fruti_sign: sign, fruti_sign_b: signB }).catch(e => {
      console.error('[MDAMIRMA] DB update failed:', e.message);
    });
  }

  const displayTarget = getDisplayName(target);
  const signName = FRUTI_SIGN_NAMES[sign];
  const signBName = FRUTI_SIGN_NAMES[signB];

  setTimeout(() => {
    mdamirmaSay(channelName,
      `Pué possib' ! Mon petit ${displayTarget} est ${signName} ascendant ${signBName} !`
    );
    addUserHistoryEntry(ud, {
      type: USER_LOG_TYPE.CHAT,
      content: `mdamirma a révélé ton FrutiSigne : ${signName} ascendant ${signBName} !`,
      flNew: true,
    });
    setTimeout(() => mdamirmaLeave(), 8000 + Math.random() * 7000);
  }, 3000 + Math.random() * 4000);
}

function scheduleMdamirma() {
  const delayMin = 10 * 60 * 1000;  // 10 min
  const delayMax = 45 * 60 * 1000;  // 45 min
  const delay = delayMin + Math.random() * (delayMax - delayMin);
  setTimeout(() => {
    mdamirmaReveal();
    scheduleMdamirma();
  }, delay);
}
scheduleMdamirma();

for (const npc of CONNECTED_NPCS) {
  channels.pomme.users.add(npc);
}

const xmlSocketClients = new Map(); // socket -> { sid, username, logged, channels: Set }

function sendToClient(socket, data) {
  try {
    socket.write(data + '\0');
  } catch (e) { /* ignore */ }
}

function broadcastToChannel(channelName, xmlStr, excludeSocket = null) {
  const channel = channels[channelName];
  if (!channel) return;
  for (const [sock, client] of xmlSocketClients) {
    if (sock === excludeSocket) continue;
    if (client.channels.has(channelName)) {
      sendToClient(sock, xmlStr);
    }
  }
}

function getSocketsForUsername(username) {
  const sockets = [];
  for (const [sock, cl] of xmlSocketClients) {
    if (cl && cl.username === username && cl.logged) {
      sockets.push(sock);
    }
  }
  return sockets;
}

// Trace subscriptions: when socket A asks for user B's trace, A is subscribed
// to real-time presence/status updates for B — independent of shared channels.
const traceSubscriptions = new Map(); // targetUsername → Set<socket>

function subscribeTrace(socket, targetUsername) {
  if (!targetUsername) return;
  const key = targetUsername.toLowerCase();
  let subs = traceSubscriptions.get(key);
  if (!subs) {
    subs = new Set();
    traceSubscriptions.set(key, subs);
  }
  subs.add(socket);
}

function unsubscribeAllTrace(socket) {
  for (const [, subs] of traceSubscriptions) {
    subs.delete(socket);
  }
}

function notifyTraceSubscribers(username, excludeSocket = null) {
  if (!username) return;
  const key = username.toLowerCase();
  const subs = traceSubscriptions.get(key);
  if (!subs || subs.size === 0) return;
  const ud = users[key] || {};
  const pVal = getSocketsForUsername(key).length > 0 ? 1 : 0;
  const traceXml = `<${CMD.trace} u="${escapeXml(getDisplayName(key))}" p="${pVal}" s="${getStatusCode(ud, key)}" mu="${getMuteValue(ud)}" f="${bouilleOf(ud, key)}" />`;
  for (const sock of subs) {
    if (sock === excludeSocket) continue;
    if (!xmlSocketClients.has(sock)) {
      subs.delete(sock);
      continue;
    }
    sendToClient(sock, traceXml);
  }
}

function isModerator(username) {
  if (isDebugNotUser(username)) return false;
  return !!(username && users[username] && users[username].isModerator);
}

function isAnimator(username) {
  return !!(username && users[username] && users[username].isAnimator);
}

const ANIM_CHANNEL = 'bienvenue';

// All games that should always show a FrutiCard on user profiles.
// Excludes grapiz and bandas (not implemented yet).
const FCARD_GAMES = ['bkiwi', 'snake3', 'swapou2', 'kaluga', 'mb2', 'miniwave', 'jamajama', 'minipixiz'];

// Convert a JSON string (or JS value) to Motion-Twin serialization format (2004).
// MTSerialization.unserialize in the AS2 profile viewer expects this format.
// Format: N<num>, S<str>, B0/B1, U, [elem;elem;], {key:val;key:val;}
function jsonToMTSerial(jsonStr) {
  let obj;
  if (typeof jsonStr === 'string') {
    try { obj = JSON.parse(jsonStr); } catch { return jsonStr; }
  } else {
    obj = jsonStr;
  }

  function ser(val) {
    if (val === null || val === undefined) return 'U';
    if (val === true) return 'B1';
    if (val === false) return 'B0';
    if (typeof val === 'number') return `N${val}`;
    if (typeof val === 'string') return `S${val}`;
    if (Array.isArray(val)) {
      let r = '[';
      for (let i = 0; i < val.length; i++) {
        r += ser(val[i]) + ';';
      }
      r += ']';
      return r;
    }
    if (typeof val === 'object') {
      let r = '{';
      for (const key of Object.keys(val)) {
        r += key + ':' + ser(val[key]) + ';';
      }
      r += '}';
      return r;
    }
    return 'U';
  }

  return ser(obj);
}

// Patch slot 0 data: merge existing saved data with defaults to fill missing
// fields, and inject real score data. This prevents "undefined" in card display.
// ctx (optional): { gameItems: string[], scores: Object, jamaPlayCount: number }
//   - falls back to in-memory users[username] / scoresData.users[username]
//   - pass an explicit ctx for offline (disconnected) users loaded from DB
function patchSlot0(username, game, existingData, ctx) {
  const ud = ctx || users[username] || {};
  const scores = (ctx && ctx.scores) || scoresData.users[username] || {};
  let saved = {};
  if (existingData) {
    try { saved = JSON.parse(existingData); } catch { saved = {}; }
    if (!saved || typeof saved !== 'object') saved = {};
  }

  switch (game) {
    case 'bkiwi': {
      if (saved.$ws === undefined) saved.$ws = false;
      if (saved.$wss === undefined) saved.$wss = false;
      if (saved.$wc === undefined) saved.$wc = false;
      if (saved.$wcs === undefined) saved.$wcs = false;
      if (!Array.isArray(saved.$ac)) saved.$ac = [false, false, false, false, false];
      if (!saved.$ts || typeof saved.$ts !== 'object') saved.$ts = {};
      for (let t = 0; t < 6; t++) {
        const key = `$t${t}`;
        if (!saved.$ts[key] || typeof saved.$ts[key] !== 'object') saved.$ts[key] = {};
        const rkC = scores[`bkiwi_track${t}_classic`];
        const rkL = scores[`bkiwi_track${t}_challenge`];
        if (saved.$ts[key].$bc === undefined) saved.$ts[key].$bc = rkC ? rkC.score : 0;
        if (saved.$ts[key].$bl === undefined) saved.$ts[key].$bl = rkL ? rkL.score : 0;
      }
      return JSON.stringify(saved);
    }
    case 'snake3': {
      if (!Array.isArray(saved.$fruits)) {
        const gi = Array.isArray(ud.gameItems) ? ud.gameItems : [];
        saved.$fruits = gi.filter(it => /^Fruit \d+$/.test(it)).map(it => Number(it.replace('Fruit ', '')));
      }
      if (saved.$record === undefined || saved.$record === null) {
        const rkC = scores.snake3_classic;
        saved.$record = rkC ? rkC.score : 0;
      }
      return JSON.stringify(saved);
    }
    case 'swapou2': {
      if (!Array.isArray(saved.$chars)) saved.$chars = [true, true, false, false, false, false, false, false, false];
      if (saved.$record === undefined || saved.$record === null) {
        const rkC = scores.swapou2_classic;
        saved.$record = rkC ? rkC.score : 0;
      }
      if (saved.$classic_record === undefined) saved.$classic_record = 0;
      if (saved.$swap === undefined) saved.$swap = 0;
      if (!Array.isArray(saved.$items)) saved.$items = [];
      if (!Array.isArray(saved.$combos)) saved.$combos = [];
      return JSON.stringify(saved);
    }
    case 'kaluga': {
      if (!Array.isArray(saved.$mode)) saved.$mode = [null, null, [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
      if (!saved.$tz || typeof saved.$tz !== 'object') saved.$tz = {};
      return JSON.stringify(saved);
    }
    case 'mb2': {
      if (!Array.isArray(saved.$items)) saved.$items = [];
      if (saved.$challenge === undefined) saved.$challenge = true;
      if (saved.$classic === undefined) saved.$classic = true;
      if (!Array.isArray(saved.$dungeons)) saved.$dungeons = [true, true, true, true];
      if (!Array.isArray(saved.$dungeons_done)) saved.$dungeons_done = [];
      if (!Array.isArray(saved.$courses)) saved.$courses = [true];
      if (saved.$classic_score === undefined || saved.$classic_score === null) {
        const rkC = scores.mb2_classic;
        saved.$classic_score = rkC ? rkC.score : 0;
      }
      if (!Array.isArray(saved.$dtimes)) saved.$dtimes = [];
      if (!Array.isArray(saved.$records)) saved.$records = [];
      return JSON.stringify(saved);
    }
    case 'miniwave':
    case 'miniwave2': {
      if (saved.$vs === undefined) saved.$vs = 0;
      if (!Array.isArray(saved.$ship)) saved.$ship = [1, 0, 0, 0, 0, 0];
      if (!Array.isArray(saved.$mode)) saved.$mode = [1, [0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0], 1, 1];
      if (!saved.$arcade || typeof saved.$arcade !== 'object') saved.$arcade = { $bestScore: 0, $bestLevel: 0 };
      if (saved.$arcade.$bestScore === undefined) saved.$arcade.$bestScore = 0;
      if (saved.$arcade.$bestLevel === undefined) saved.$arcade.$bestLevel = 0;
      if (saved.$letter === undefined) saved.$letter = 0;
      if (saved.$survival === undefined) saved.$survival = 0;
      if (saved.$time === undefined) saved.$time = 0;
      if (!Array.isArray(saved.$bonus)) saved.$bonus = [0, 0, 0, 0, 0, 0, 0, 0];
      if (!saved.$cons || typeof saved.$cons !== 'object') saved.$cons = { $main: 0, $bonus: [0, 0, 0, 0, 0, 0, 0, 0], $letter: 0 };
      if (saved.$cons.$main === undefined) saved.$cons.$main = 0;
      if (!Array.isArray(saved.$cons.$bonus)) saved.$cons.$bonus = [0, 0, 0, 0, 0, 0, 0, 0];
      if (saved.$cons.$letter === undefined) saved.$cons.$letter = 0;
      if (!Array.isArray(saved.$badsKill)) saved.$badsKill = [];
      if (saved.$saucerKill === undefined) saved.$saucerKill = 0;
      if (saved.$credit === undefined) saved.$credit = 0;
      if (!Array.isArray(saved.$shop)) saved.$shop = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
      if (saved.$lvl === undefined) saved.$lvl = 0;
      if (!saved.$stats || typeof saved.$stats !== 'object') saved.$stats = { $play: { $main: 0, $mission: 0, $survival: 0, $letter: 0 }, $buy: [] };
      return JSON.stringify(saved);
    }
    case 'jamajama': {
      if (saved.$best === undefined || saved.$best === null) {
        const rkC = scores.jamajama_classic;
        saved.$best = rkC ? rkC.score : 0;
      }
      if (saved.$plays === undefined) saved.$plays = ud.jamaPlayCount || 0;
      return JSON.stringify(saved);
    }
    case 'minipixiz':
    case 'minitroll': {
      // The FrutiCard renderer baked into legacy/main.swf walks the full Card
      // schema from Games/miniTroll/src/Card.mt — not just the 19 fields that
      // the patched SWF round-trips through the pipe save. Missing top-level
      // fields (e.g. $current, $time, $dungeon.$loop, faerie sub-objects)
      // come back as `undefined` after MT-deserialization and whole card
      // sections render empty. Pad every field the card touches with safe
      // defaults so each section has something to draw.
      if (!saved.$stat || typeof saved.$stat !== 'object') saved.$stat = {};
      if (!Array.isArray(saved.$stat.$item))  saved.$stat.$item = [];
      if (!Array.isArray(saved.$stat.$eat))   saved.$stat.$eat = [];
      // Card iterates fixed indices on $kill (5 monster types) and
      // $game (5 zones); short arrays would leave those rows blank.
      if (!Array.isArray(saved.$stat.$kill) || saved.$stat.$kill.length < 5) {
        const k = Array.isArray(saved.$stat.$kill) ? saved.$stat.$kill : [];
        saved.$stat.$kill = [0, 0, 0, 0, 0].map((d, i) => Number(k[i]) || d);
      }
      if (!Array.isArray(saved.$stat.$game) || saved.$stat.$game.length < 5) {
        const g = Array.isArray(saved.$stat.$game) ? saved.$stat.$game : [];
        saved.$stat.$game = [0, 0, 0, 0, 0].map((d, i) => Number(g[i]) || d);
      }
      if (saved.$stat.$run === undefined)        saved.$stat.$run = 0;
      if (saved.$stat.$forestMax === undefined)  saved.$stat.$forestMax = 0;
      if (saved.$stat.$treeMax === undefined)    saved.$stat.$treeMax = 0;
      if (saved.$stat.$misNum === undefined)     saved.$stat.$misNum = 0;

      if (saved.$diam === undefined) saved.$diam = 0;
      if (saved.$key  === undefined) saved.$key  = 0;
      if (saved.$star === undefined) saved.$star = 0;
      if (saved.$bag  === undefined) saved.$bag  = 0;

      // "jours de jeu" reads card.$time.$d — without $time the row stays
      // empty. We don't have a real value to restore so seed with zero.
      if (!saved.$time || typeof saved.$time !== 'object') {
        saved.$time = { $t: 0, $d: 0, $s: 0 };
      }
      // $current is the current-zone string ("forest", "pond"…). The card
      // shows a small badge near $star for it; null is the formatFruticard
      // default and renders cleanly.
      if (saved.$current === undefined) saved.$current = null;

      if (!saved.$dungeon || typeof saved.$dungeon !== 'object') saved.$dungeon = {};
      if (saved.$dungeon.$lvl  === undefined) saved.$dungeon.$lvl  = 0;
      if (saved.$dungeon.$f    === undefined) saved.$dungeon.$f    = false;
      if (saved.$dungeon.$loop === undefined) saved.$dungeon.$loop = 0;
      if (saved.$dungeon.$day  === undefined) saved.$dungeon.$day  = 0;

      if (!saved.$rainbow || typeof saved.$rainbow !== 'object') saved.$rainbow = {};
      if (saved.$rainbow.$f   === undefined) saved.$rainbow.$f   = false;
      if (saved.$rainbow.$day === undefined) saved.$rainbow.$day = null;
      if (saved.$rainbow.$it  === undefined) saved.$rainbow.$it  = null;

      if (!saved.$pond || typeof saved.$pond !== 'object') saved.$pond = {};
      if (saved.$pond.$q  === undefined) saved.$pond.$q  = 0;
      if (saved.$pond.$d  === undefined) saved.$pond.$d  = 0;
      if (saved.$pond.$fs === undefined) saved.$pond.$fs = null;

      if (saved.$frog === undefined) saved.$frog = false;

      // Per Games/miniTroll/src/FaerieSeed.mt every faerie has $skin/$carac/
      // $spell as Array<int> (the card display labels them col1/col2/col3
      // for $skin and force/rapidité/vie/intel/sagesse/mana for $carac).
      // The pipe save only preserves $level, so seed the rest with neutral
      // defaults; otherwise the per-faerie row reads `undefined` for every
      // stat and the column renders empty.
      if (!Array.isArray(saved.$faerie)) saved.$faerie = [];
      saved.$faerie = saved.$faerie.map((f) => {
        const fc = f && typeof f === 'object' ? f : {};
        if (fc.$level === undefined) fc.$level = 0;
        // [num, col1, col2, col3] — pick a visible default colour
        if (!Array.isArray(fc.$skin) || fc.$skin.length < 4) {
          fc.$skin = [0, 0xFFFFFF, 0xFFFFFF, 0xFFFFFF];
        }
        // [force, rapidité, vie, intel, sagesse, mana]
        if (!Array.isArray(fc.$carac) || fc.$carac.length < 6) {
          fc.$carac = [0, 0, 0, 0, 0, 0];
        }
        if (!Array.isArray(fc.$spell)) fc.$spell = [];
        return fc;
      });

      if (saved.$vs === undefined) saved.$vs = 1.1;

      return JSON.stringify(saved);
    }
    default:
      return existingData || JSON.stringify({});
  }
}

// Per-channel quiz state (ephemeral — lost on restart).
// { channelName: { question, points: Map<username, number>, active } }
const quizState = {};

// Per-client blue-bold toggle for animators.
// Set<socketKey> — we store the username to look up.
const blueModeUsers = new Set();

function kickUserFromChannel(channelName, targetUser, byUser, reason = 'kick') {
  const channel = channels[channelName];
  if (!channel) return false;

  // Choose the wire event matching what box.Chat listens for:
  //  - "totoch"/"ban" → onban (cmdList "ah")  → chat.userbanned for moderators
  //  - anything else  → onkick (cmdList "ag") → chat.userkicked for everyone
  // Both handlers expect attribute `u` (target) so they can call userList.rmUser
  // and detect self-kick via `u == _global.me.name`.
  const isBan = (reason === 'totoch' || reason === 'ban');
  const wire = isBan ? CMD.onban : CMD.onkick;
  const notif = `<${wire} u="${escapeXml(getDisplayName(targetUser))}" g="${escapeXml(channelName)}" by="${escapeXml(getDisplayName(byUser))}" r="${escapeXml(reason)}" />`;

  // Broadcast BEFORE removing the user from the channel — broadcastToChannel
  // iterates client.channels, so we need the target user to still be a member
  // for them to receive the close-chat notification.
  broadcastToChannel(channelName, notif);

  // Now actually remove the user from the channel state.
  channel.users.delete(targetUser);
  for (const [sock, cl] of xmlSocketClients) {
    if (cl && cl.username === targetUser) {
      cl.channels.delete(channelName);
    }
  }
  notifyTraceSubscribers(targetUser);

  if (!CONNECTED_NPCS.has(targetUser)) {
    const actionLabel = isBan ? 'banni' : 'expulsé';
    addAndNotifyUserLog(targetUser, {
      type: isBan ? USER_LOG_TYPE.BAN : USER_LOG_TYPE.KICK,
      content: `Tu as été ${actionLabel} du salon ${channelName} par ${getDisplayName(byUser)}.`,
    });
    if (process.env.DATABASE_URL) db.addModerationLog(targetUser, byUser, reason, `salon ${channelName}`).catch(e => console.error('[DB] modlog error:', e.message));
  }

  // Respawn connected PNJ after 5 seconds if one is kicked
  if (CONNECTED_NPCS.has(targetUser)) {
    setTimeout(() => {
      if (channels[channelName]) {
        channels[channelName].users.add(targetUser);
        // Broadcast userjoined so other clients see PNJ reappear
        broadcastToChannel(channelName, `<${CMD.userjoined} ${buildUserAttrs(targetUser)} g="${escapeXml(channelName)}" />`);
      }
    }, 5000);
  }
  return true;
}

function pickActiveChannel(client, msgAttrs = {}) {
  return msgAttrs.g || msgAttrs.channel || (client && client.channels ? Array.from(client.channels)[0] : '') || '';
}

function resolveModerationTarget(msg) {
  const attrs = (msg && msg.attrs) || {};
  const raw =
    attrs.u ||
    attrs.l ||
    attrs.n ||
    attrs.user ||
    (typeof msg.content === 'string' ? msg.content.trim() : '');
  return resolveKnownUsername(raw);
}

function resolveKnownUsername(nameOrLower) {
  const raw = String(nameOrLower || '');
  const low = raw.toLowerCase();
  for (const known of Object.keys(users)) {
    if (known.toLowerCase() === low) return known;
  }
  return raw;
}

function parsePrivateParticipants(groupName) {
  const g = String(groupName || '');
  if (g.startsWith('pm2_')) {
    const payload = g.substring(4);
    const [aRaw, bRaw] = payload.split('__');
    if (!aRaw || !bRaw) return [];
    try {
      return [decodeURIComponent(aRaw), decodeURIComponent(bRaw)].map(resolveKnownUsername);
    } catch {
      return [];
    }
  }

  if (!g.startsWith('pm_')) return [];
  const payload = g.substring(3);
  const knownLowers = Object.keys(users).map((u) => u.toLowerCase());
  for (const candidate of knownLowers) {
    const prefix = `${candidate}_`;
    if (payload.startsWith(prefix)) {
      const other = payload.substring(prefix.length);
      if (other.length > 0) {
        return [resolveKnownUsername(candidate), resolveKnownUsername(other)];
      }
    }
  }
  const parts = payload.split('_');
  if (parts.length >= 2) {
    return [resolveKnownUsername(parts[0]), resolveKnownUsername(parts.slice(1).join('_'))];
  }
  return [];
}

function buildPrivateGroupName(userA, userB) {
  const sorted = [String(userA || '').toLowerCase(), String(userB || '').toLowerCase()].sort();
  return `pm2_${encodeURIComponent(sorted[0])}__${encodeURIComponent(sorted[1])}`;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatDateTime(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}.${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function formatDateTimeParis(d) {
  const p = new Date(d.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  return `${p.getFullYear()}-${pad2(p.getMonth() + 1)}-${pad2(p.getDate())}.${pad2(p.getHours())}:${pad2(p.getMinutes())}:${pad2(p.getSeconds())}`;
}

function formatChatTimePrefix(d) {
  return `[${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}] `;
}

function buildChatTimeAttrs(date = new Date()) {
  const paris = new Date(date.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  return {
    h: formatChatTimePrefix(paris),
    d: formatDateTime(paris),
  };
}

function normalizeClientIp(rawIp) {
  if (!rawIp) return '127.0.0.1';
  if (rawIp === '::1') return '127.0.0.1';
  if (rawIp.startsWith('::ffff:')) return rawIp.substring(7);
  return rawIp;
}

function getMuteValue(user) {
  const raw = user && user.mutedUntil ? String(user.mutedUntil) : '';
  if (!raw) return '0000-00-00 00:00:00';
  const d = new Date(raw.replace('.', ' '));
  if (Number.isNaN(d.getTime()) || d.getTime() <= Date.now()) return '0000-00-00 00:00:00';
  return raw.includes('.') ? raw.replace('.', ' ') : raw;
}

function getStatusCode(user, username) {
  const muteVal = getMuteValue(user);
  const muteEmote = muteVal === '0000-00-00 00:00:00' ? 0 : 7;
  // Pull the live status (external/internal/emote) the user last broadcast.
  // Fall back to all-zero when the user is offline or hasn't sent one yet.
  let ext = 0, internal = 0, emote = muteEmote;
  if (username) {
    for (const [, cl] of xmlSocketClients) {
      if (cl && cl.username === username && cl.statusStr) {
        const s = cl.statusStr;
        ext      = decode62(s.substring(0, 1)) || 0;
        internal = decode62(s.substring(1, 3)) || 0;
        if (muteEmote === 0) emote = decode62(s.substring(3, 4)) || 0;
        break;
      }
    }
  }
  return `${encode62(ext, 1)}${encode62(internal, 2)}${encode62(emote, 1)}`;
}

// Build the <u> attribute set the SWF's UserMng.formatInfoBasic expects.
// Used both for the initial userlist dump and for <userjoined> broadcasts —
// without these attrs, the chat shows the user with a black pseudo and the
// info card falls back to "NN"/"inconnue"/level 0.
function buildUserAttrs(username, present = '1') {
  const ud = users[username] || {};
  return `u="${escapeXml(getDisplayName(username))}" x="${ud.xp || 0}" sx="${ud.gender || 'M'}" bd="${ud.birthday || '2000-01-01.00:00:00'}" co="${ud.country || 'FR'}" rg="${ud.region || ''}" p="${present}" s="${getStatusCode(ud, username)}" mu="${getMuteValue(ud)}" f="${bouilleOf(ud)}"`;
}

// Update the "internal" portion of a user's status string (used for the
// game/forum icon shown next to the pseudo). Updates every chat socket the
// user has, echoes the new status to those sockets, and broadcasts a trace
// update to all channels they're in. Pass internalIdx=0 to clear.
function setUserInternalStatus(username, internalIdx) {
  if (!username) return;
  const internalStr = encode62(internalIdx | 0, 2);
  const ud = users[username] || {};
  const updatedSockets = [];
  // Update statusStr on every logged socket of this user. The chat socket
  // is what we really care about (it drives getStatusCode and the trace),
  // but the user might not have joined any channel yet at game launch
  // time — so we no longer require channels.size > 0.
  for (const [sock, cl] of xmlSocketClients) {
    if (!cl || cl.username !== username || !cl.logged) continue;
    const old = cl.statusStr || '0000';
    const ext = old.charAt(0) || '0';
    const emote = old.charAt(3) || '0';
    cl.statusStr = `${ext}${internalStr}${emote}`;
    updatedSockets.push(sock);
    sendToClient(sock, `<${CMD.status} s="${cl.statusStr}" />`);
  }
  console.log(`[STATUS] setUserInternalStatus ${username} internal=${internalIdx} sockets=${updatedSockets.length}`);
  if (updatedSockets.length === 0) return;
  const traceXml = `<${CMD.trace} u="${escapeXml(getDisplayName(username))}" p="1" s="${getStatusCode(ud, username)}" mu="${getMuteValue(ud)}" f="${bouilleOf(ud, username)}" />`;
  const channelsBroadcast = new Set();
  for (const sock of updatedSockets) {
    const cl = xmlSocketClients.get(sock);
    if (!cl) continue;
    for (const ch of cl.channels) {
      if (channelsBroadcast.has(ch)) continue;
      channelsBroadcast.add(ch);
      broadcastToChannel(ch, traceXml);
    }
  }
  notifyTraceSubscribers(username);
}

function buildChannelListXml() {
  let inner = '';
  for (const [name, ch] of Object.entries(channels)) {
    // Hide private message channels from the public room list
    if (ch.private) continue;
    const desc = ch.desc || `Salon ${name.charAt(0).toUpperCase()}${name.slice(1)}`;
    inner += `<g g="${name}" n="${ch.users.size}"><desc>${escapeXml(desc)}</desc></g>`;
  }
  return `<${CMD.channellist}>${inner}</${CMD.channellist}>`;
}

// ─────────────────────────────────────────────
// Handle a single CBee XML message from a client
// ─────────────────────────────────────────────
async function handleCBeeMessage(socket, rawXml) {
  await rollDailyChallengeIfNeeded();
  const msg = parseXmlAttrs(rawXml);
  const cmdName = CMD_REV[msg.tag] || msg.tag;
  const client = xmlSocketClients.get(socket);
  if (!client) return;

  console.log(`[CBee]  <- ${cmdName} (${msg.tag}) ${JSON.stringify(msg.attrs)}`);

  // FrutiScore overlap: wire code "v" is listModes request.
  if (msg.tag === 'v') {
    sendToClient(socket, '<v><m m="0" t="normal" /></v>');
    return;
  }

  switch (cmdName) {
    // ── ip: client requests its IP ──
    case 'ip': {
      // Strip IPv6-mapped prefix — AS2's FEString.trim may choke on ::ffff:
      let ipAddr = normalizeClientIp(socket.remoteAddress);
      sendToClient(socket, `<${CMD.ip}>${ipAddr}</${CMD.ip}>`);
      // Do NOT auto-send ident here. The SWF handles the ident flow itself:
      //   onConnect → cmd("ip") → onIP → this.ident() → server responds to ident
      // Auto-sending ident causes duplicate/out-of-order responses that confuse the SWF.
      break;
    }

    // ── time: server time ──
    case 'time': {
      sendToClient(socket, `<${CMD.time}>${formatDateTime(new Date())}</${CMD.time}>`);
      break;
    }

    case 'invite': {
  // Frusion overload: <ab d="..."> is not a chat invite here, it's a game "use disc" command
  if (msg.attrs.d !== undefined) {
    console.log('[FRUSION] useDisc request for', msg.attrs.d);

    // Minimal positive response expected by FrusionClient.onUseDisc()
    sendToClient(socket, `<ab s="1"><daily>ok</daily></ab>`);
    break;
  }

  // ── Channel invite: /invite <user> in a salon ──
  const invTarget = msg.attrs.u || '';
  const invGroup = msg.attrs.g || '';
  const invReqId = msg.attrs.r || '';
  const inviter = client.username || '';

  if (!invTarget || !invGroup || !inviter) {
    sendToClient(socket, `<${CMD.invite} u="${escapeXml(invTarget)}" r="${escapeXml(invReqId)}" k="1" />`);
    break;
  }

  const invChannel = channels[invGroup];
  if (!invChannel) {
    sendToClient(socket, `<${CMD.invite} u="${escapeXml(invTarget)}" r="${escapeXml(invReqId)}" k="202" />`);
    break;
  }

  const invTargetName = resolveKnownUsername(normalizeUsername(invTarget));
  if (!invTargetName || !users[invTargetName]) {
    sendToClient(socket, `<${CMD.invite} u="${escapeXml(invTarget)}" r="${escapeXml(invReqId)}" k="201" />`);
    break;
  }

  // Check if target is already in the channel
  if (invChannel.users.has(invTargetName)) {
    sendToClient(socket, `<${CMD.invite} u="${escapeXml(invTargetName)}" r="${escapeXml(invReqId)}" k="205" />`);
    break;
  }

  // Success: acknowledge to sender
  sendToClient(socket, `<${CMD.invite} u="${escapeXml(invTargetName)}" r="${escapeXml(invReqId)}" />`);

  // Forward invite to target (without r attribute so listener.main.onInvite processes it)
  const invTopic = invChannel.topic || invChannel.desc || invGroup;
  const invPass = invChannel.pass || '';
  for (const targetSock of getSocketsForUsername(invTargetName)) {
    sendToClient(
      targetSock,
      `<${CMD.invite} u="${escapeXml(getDisplayName(inviter))}" g="${escapeXml(invGroup)}" p="${escapeXml(invPass)}">${escapeXml(invTopic)}</${CMD.invite}>`
    );
  }

  console.log(`[CBee]  ${inviter} invited ${invTargetName} to channel ${invGroup}`);
  break;
}

    // ── ping: just echo back ──
    case 'ping': {
      sendToClient(socket, `<${CMD.ping} />`);
      break;
    }

    // ── ident: login ──
    case 'ident': {
      const login = msg.attrs.l || '';
      const sid = msg.attrs.s || '';
      const sessionUser = sid && sessions[sid] && sessions[sid].user ? sessions[sid].user : '';

      // Priority: sid-bound user (real logged account) > explicit login.
      // Always normalize to lowercase for storage; the original casing is
      // preserved separately via users[].displayName.
      const rawLogin = sessionUser || login;
      const effectiveLogin = String(rawLogin || '').toLowerCase();
      if (!effectiveLogin) {
        sendToClient(socket, `<${CMD.ident} k="401" />`);
        break;
      }

      // Auto-create session if needed
      if (sid && !sessions[sid]) {
        sessions[sid] = { user: null, createdAt: Date.now() };
      }
      if (sid && sessions[sid]) {
        sessions[sid].user = effectiveLogin;
      }

      // Auto-create user if doesn't exist (check DB first)
      if (!users[effectiveLogin]) {
        let dbUser = null;
        try { dbUser = await db.findUserByUsername(effectiveLogin); } catch (e) { /* ignore */ }
        if (dbUser) {
          try {
            await hydrateUserFromDb(effectiveLogin, dbUser);
          } catch (e) { /* ignore */ }
        } else {
          users[effectiveLogin] = {
            pass: '',
            xp: 1,
            kikooz: 60,
            fbouille: DEFAULT_BOUILLE_STATE,
            items: withDefaultPens([]),
            gender: 'M',
            birthday: '2000-01-01',
            country: 'FR',
            region: 'IDF',
            prefs: '',
            isModerator: !isDebugNotUser(effectiveLogin),
            kikoozLog: [],
            userLog: [],
            siteLog: [],
            hasWelcomeUserLog: false,
            hasWelcomeSiteLog: false,
          };
        }
      }

      const user = users[effectiveLogin];
      applyPendingChallengeNotifications(effectiveLogin, user);
      trackXpAction(effectiveLogin, 'login');
      if (user.hasWelcomeUserLog !== true) {
        addUserHistoryEntry(user, {
          type: USER_LOG_TYPE.INSCRIPTION,
          content: "Bienvenue sur Frutiparc Revival ! Tu n'as donc rien de mieux à faire ?!",
          flNew: true,
        });
        user.hasWelcomeUserLog = true;
      }
      if (user.hasWelcomeSiteLog !== true) {
        addSiteHistoryEntry(user, {
          type: USER_LOG_TYPE.INSCRIPTION,
          content: "Évènement: ton compte Frutiparc Revival vient d'être activé.",
          flNew: true,
        });
        user.hasWelcomeSiteLog = true;
      }

      // Success: send ident response with user data
      client.username = effectiveLogin;
      client.sid = sid;
      client.logged = true;

      if (process.env.DATABASE_URL && user._dbId) {
        db.recordLogin(effectiveLogin).catch((e) => console.error('[DB] recordLogin error:', e.message));
      }

      sendToClient(socket, `<${CMD.ident} l="${escapeXml(getDisplayName(effectiveLogin))}" x="${user.xp}" f="${bouilleOf(user)}" />`);
      if (user.userLog && user.userLog.length > 0) {
        for (const entry of user.userLog) {
          if (!entry || !entry.n) continue;
          sendToClient(
            socket,
            `<${CMD.newuserlog} date="${escapeXml(entry.d || nowSqlTimestamp())}" type="${escapeXml(String(entry.t || 8))}">${escapeXml(entry.c || '')}</${CMD.newuserlog}>`,
          );
        }
      }
      console.log(`[CBee]  User "${effectiveLogin}" logged in (sid=${sid})`);
      break;
    }

    // ── channellist / FrutiScore saveScore ──
    case 'channellist': {
      // FrutiScore overlap: saveScore uses same wire code (q) with disc attrs.
      // Known attributes (from Frusion protocol): d=discId, m=mode, s=score, da=data.
      // We log the full attr set for diagnostic purposes since the AS2 source
      // for GameClient.saveScore is in the compiled SWF and not in this repo.
      if (msg.attrs.d != undefined || msg.attrs.s != undefined) {
        const discId = String(msg.attrs.d || '');
        const scoreVal = Number(msg.attrs.s || 0) || 0;
        const scoreMode = Number(msg.attrs.m || 0) || (client.currentGameMode || 0);
        const scoreData = getScoreDataFromMessage(msg);
        const username = client.username || '';
        console.log(`[FSCORE] saveScore from "${username}" attrs=${JSON.stringify(msg.attrs)} data="${scoreData}" mode=${scoreMode} children=${JSON.stringify(msg.children || [])}`);
        let rankingId = rankingIdForGame(discId, scoreMode);
        if (!rankingId && client.currentGame) rankingId = rankingIdForGame(client.currentGame, scoreMode);
        let extraRankingId = null;
        if (rankingId && rankingId.startsWith('bkiwi_')) {
          const hint = username && users[username] && Number.isFinite(users[username].bkiwiCurrentTrack)
            ? users[username].bkiwiCurrentTrack : undefined;
          const daily = getBkiwiDailyTrack();
          const trackForClassic = Number.isFinite(hint) ? hint : daily;
          rankingId = `bkiwi_track${trackForClassic}_classic`;
          extraRankingId = `bkiwi_track${daily}_challenge`;
          console.log(`[FSCORE] bkiwi route hint=${hint} daily=${daily} -> classic:${rankingId} challenge:${extraRankingId}`);
        } else if (rankingId === 'mb2_classic' || rankingId === 'mb2_challenge') {
          rankingId = 'mb2_classic';
          extraRankingId = 'mb2_challenge';
        }
        // Persist if we have a valid ranking + user.
        let res = { updated: false, newScore: scoreVal, oldScore: 0, oldPos: 0, newPos: 0 };
        let challengeRes = null;
        if (username && rankingId) {
          res = persistScore(username, rankingId, scoreVal, scoreData);
          console.log(`[FSCORE] ${username} ${rankingId}: ${res.oldScore} -> ${res.newScore} (updated=${res.updated}, pos ${res.oldPos}->${res.newPos})`);
          if (extraRankingId) {
            challengeRes = persistScore(username, extraRankingId, scoreVal, scoreData);
            console.log(`[FSCORE] ${username} ${extraRankingId}: ${challengeRes.oldScore} -> ${challengeRes.newScore} (updated=${challengeRes.updated}, challenge)`);
          }
          if (rankingId === 'jamajama_classic' || rankingId === 'jamajama_challenge') {
            awardJamaPictosOnScore(username);
          }
        } else {
          console.log(`[FSCORE] skip persist (user="${username}" rankingId="${rankingId}")`);
        }
        // Frusion GameClient parses each child node of <q> as a RankingResult,
        // reading attributes rn (rankingName), r (rankingData), p (bestScorePos),
        // os (oldScore), op (oldPos), s (bestScore). Without a child node the
        // GameClient leaves ranking.bestScorePos undefined — which propagates
        // into the UI as "Votre classement : undefined".
        // For BKiwi, use the challenge result for the response (daily competition).
        const displayRes = challengeRes || res;
        const displayRankingId = extraRankingId || rankingId;
        const rkInfo = displayRankingId ? (RANKINGS[displayRankingId] || {}) : {};
        const rnAttr = rkInfo.name ? ` rn="${escapeXml(rkInfo.name)}"` : '';
        const rankingDataForClient = displayRankingId
          ? formatRankingExtraData(displayRankingId, scoreData, displayRes.newScore)
          : scoreData;
        const rAttr = rankingDataForClient ? ` r="${escapeXml(rankingDataForClient)}"` : ' r=""';
        const subAttrs = `${rnAttr}${rAttr} p="${displayRes.newPos}" os="${displayRes.oldScore}" op="${displayRes.oldPos}" s="${displayRes.newScore}"`;
        sendToClient(socket, `<${CMD.channellist} k="0"><rk${subAttrs}/></${CMD.channellist}>`);
        break;
      }
      sendToClient(socket, buildChannelListXml());
      break;
    }

    // ── join / FrutiScore startGame ──
case 'join': {
  // FrutiScore overlap: startGame uses wire code "o" with disc attrs.
  if (msg.attrs.d != undefined) {
    const discId = String(msg.attrs.d || '');
    const gameMode = Number(msg.attrs.m || 0) || 0;
    client.currentGame = discId;
    client.currentGameMode = gameMode;
    if (client.sid && sessions[client.sid]) {
      sessions[client.sid].challengeMode = gameMode === 1;
    }
    // Resolve the user — the game socket may have authenticated via SID
    const gameUser = client.username ||
      (client.sid && sessions[client.sid] && sessions[client.sid].user) || null;
    console.log(`[FSCORE] startGame disc=${discId} mode=${gameMode} user=${gameUser || '-'}`);
    // Show the game icon in place of the presence indicator on the user
    // card by updating the "internal" portion of the status string.
    if (gameUser) {
      const disc = GAME_DISCS[discId];
      const internal = statusInternalCode(disc && disc.swfName);
      if (internal > 0) setUserInternalStatus(gameUser, internal);
    }
    sendToClient(socket, `<${CMD.join} d="${escapeXml(discId)}" k="0" />`);
    break;
  }
  const g = msg.attrs.g;

  if (!channels[g]) {
    if (String(g).indexOf('pm_') === 0 || String(g).indexOf('pm2_') === 0) {
      const [p1, p2] = parsePrivateParticipants(g);
      channels[g] = {
        desc: `Discussion privée ${p1}/${p2}`,
        topic: `Discussion privée ${p1}/${p2}`,
        users: new Set([p1, p2].filter(Boolean)),
        participants: [p1, p2].filter(Boolean),
        private: true,
        pass: msg.attrs.p || '',
      };
    } else {
    channels[g] = {
      desc: `Salon ${g.charAt(0).toUpperCase()}${g.slice(1)}`,
      topic: `Bienvenue sur le salon ${g} !`,
      users: new Set(),
    };
    }
  }

  const channel = channels[g];
  if (channel && channel.banned && channel.banned.has(client.username)) {
    sendToClient(socket, `<${CMD.error} k="403" />`);
    break;
  }
  if (channel.private && Array.isArray(channel.participants)) {
    for (const u of channel.participants) channel.users.add(u);
  }
  channel.users.add(client.username);
  client.channels.add(g);

  const userArr = Array.from(channel.users);
  let userXml = '';

  for (const u of userArr) {
    const ud = users[u] || {};
    userXml += `<u u="${escapeXml(getDisplayName(u))}" x="${ud.xp || 0}" sx="${ud.gender || 'M'}" bd="${ud.birthday || '2000-01-01.00:00:00'}" co="${ud.country || 'FR'}" rg="${ud.region || ''}" p="1" s="${getStatusCode(ud, u)}" mu="${getMuteValue(ud)}" f="${bouilleOf(ud)}" />`;
  }

  const timeAttrs = buildChatTimeAttrs();

  // 1. Réponse canonique au join
  sendToClient(
    socket,
    `<${CMD.join} g="${g}" p=""><desc>${escapeXml(channel.desc || `Salon ${g}`)}</desc></${CMD.join}>`
  );

  // 2. Liste des utilisateurs
  sendToClient(socket, `<${CMD.userlist} g="${g}">${userXml}</${CMD.userlist}>`);

  // 3. Envoi proactif des données trace (bouille) pour tous les utilisateurs du salon.
  //    Le client AS2 utilise autoTrace=true pour les UserMng du chat, ce qui
  //    n'envoie jamais de requête trace au serveur. Sans cette poussée, les
  //    FrutiScreen n'obtiennent jamais les données bouille et affichent un
  //    message d'erreur ("vider le cache").
  {
    let traceXml = '';
    for (const u of userArr) {
      const ud = users[u] || {};
      traceXml += `<u u="${escapeXml(getDisplayName(u))}" p="1" s="${getStatusCode(ud, u)}" mu="${getMuteValue(ud)}" f="${bouilleOf(ud)}" />`;
    }
    sendToClient(socket, `<${CMD.trace}>${traceXml}</${CMD.trace}>`);
  }

  // 4. Notification aux autres + trace du nouvel arrivant pour leurs FrutiScreen
  {
    const joinerUd = users[client.username] || {};
    const joinerTrace = `<${CMD.trace}><u u="${escapeXml(getDisplayName(client.username))}" p="1" s="${getStatusCode(joinerUd, client.username)}" mu="${getMuteValue(joinerUd)}" f="${bouilleOf(joinerUd)}" /></${CMD.trace}>`;
    broadcastToChannel(g, `<${CMD.userjoined} ${buildUserAttrs(client.username)} g="${g}" />`, socket);
    broadcastToChannel(g, joinerTrace, socket);
  }
  // Notify trace subscribers (cross-channel) that this user is online
  notifyTraceSubscribers(client.username, socket);
  break;
}

    // ── userlist / FrutiScore endGame ──
    case 'userlist': {
      // FrutiScore overlap: endGame uses wire code "p".
      if (msg.attrs.d != undefined || msg.attrs.g == undefined) {
        sendToClient(socket, `<${CMD.userlist} k="0" />`);
        break;
      }
      const g = msg.attrs.g || '';
      // FrutiScore endGame (p) has no g= attr
      if (!g) {
        console.log('[CBee]  FrutiScore endGame');
        sendToClient(socket, `<${CMD.userlist} />`);
        break;
      }
      const channel = channels[g];
      if (!channel) {
        sendToClient(socket, `<${CMD.userlist} g="${g}"></${CMD.userlist}>`);
        break;
      }
      const userArr = Array.from(channel.users || []);
      let userXml = '';
      for (const u of userArr) {
        const ud = users[u] || {};
        userXml += `<u u="${escapeXml(getDisplayName(u))}" x="${ud.xp || 0}" sx="${ud.gender || 'M'}" bd="${ud.birthday || '2000-01-01.00:00:00'}" co="${ud.country || 'FR'}" rg="${ud.region || ''}" p="1" s="${getStatusCode(ud, u)}" mu="${getMuteValue(ud)}" f="${bouilleOf(ud)}" />`;
      }
      sendToClient(socket, `<${CMD.userlist} g="${g}">${userXml}</${CMD.userlist}>`);
      break;
    }

    // ── part: leave a channel / FrutiScore xpranking ──
    case 'part': {
      // FrutiScore overlap: xpranking uses wire code "y" with s/l attrs.
      if (msg.attrs.s !== undefined || msg.attrs.l !== undefined) {
        const start = Number(msg.attrs.s || 0) || 0;
        const limit = Number(msg.attrs.l || 10) || 10;
        const merged = new Map();
        try {
          const dbUsers = await db.listAllUsers();
          for (const row of dbUsers) {
            if (row.xp > 0) merged.set(row.username, row.xp);
          }
        } catch (e) { console.error('[FSCORE] xpranking DB error:', e.message); }
        for (const [u, ud] of Object.entries(users)) {
          if (ud && Number.isFinite(ud.xp) && ud.xp > 0) {
            merged.set(u, ud.xp);
          }
        }
        const all = [];
        for (const [u, s] of merged) all.push({ u, s });
        all.sort((a, b) => b.s - a.s);
        const slice = all.slice(start, start + limit);
        let inner = '';
        for (const e of slice) {
          const ud = users[e.u] || {};
          inner += `<score u="${escapeXml(getDisplayName(e.u))}" x="${e.s}" f="${escapeXml(bouilleOf(ud, e.u))}" s="${e.s}" t="${formatDateTime(new Date())}" />`;
        }
        sendToClient(socket, `<${CMD.part}>${inner}</${CMD.part}>`);
        console.log(`[FSCORE] xpranking: ${slice.length}/${all.length} entries`);
        break;
      }
      const g = msg.attrs.g;
      if (channels[g]) {
        channels[g].users.delete(client.username);
        client.channels.delete(g);
        broadcastToChannel(
          g,
          `<${CMD.userleaved} u="${escapeXml(getDisplayName(client.username))}" g="${g}" />`
        );
        notifyTraceSubscribers(client.username);
      }
      break;
    }

    // ── kick / FrutiScore listRankings ──
    case 'kick': {
      // FrutiScore bug: the compiled FrutiScore.rankingResult() method sends
      // wire "l" (listRankings) instead of "m" (rankingResult) due to a
      // copy-paste error in FrutiScore.as.  Detect this by the presence of
      // "rk" attr (ranking id) which listRankings never carries.
      // Respond with wire "m" so the client dispatches to onRankingResult.
      if (msg.attrs.rk !== undefined) {
        if (VERBOSE_FSCORE) console.log(`[FSCORE-DEBUG] rankingResult request attrs=${JSON.stringify(msg.attrs)} selectedDt=${client && client.selectedDt}`);
        const rkInput = String(msg.attrs.rk);
        const cAttrIn = String(msg.attrs.c || '');
        const dtExplicit = msg.attrs.dt !== undefined ? String(msg.attrs.dt).slice(0, 10) : '';
        const dtHint = dtExplicit || (client.selectedDt || '');
        const internalId = resolveInternalRankingId(rkInput, dtHint || undefined);
        const dtIn = dtExplicit || (internalId && isDailyResetRanking(internalId) ? (client.selectedDt || '') : '');
        if (internalId) {
          const memoryEntries = [];
          for (const [u, rlist] of Object.entries(scoresData.users || {})) {
            if (rlist && rlist[internalId]) memoryEntries.push(`${u}:${rlist[internalId].score}`);
          }
          if (VERBOSE_FSCORE) console.log(`[FSCORE-DEBUG] memory has ${memoryEntries.length} entries under ${internalId}: [${memoryEntries.join(', ')}]`);
        }
        const legacyDesc = legacyDescriptorFromRkLike(rkInput);
        const reqId = msg.attrs.r || '';
        const start = Number(msg.attrs.s || 0) || 0;
        const limit = Number(msg.attrs.l || 20) || 20;
        const isHistorical = dtIn && dtIn !== parisDayKey() && internalId && isDailyResetRanking(internalId) && process.env.DATABASE_URL;
        let all = [];
        if (isHistorical) {
          try {
            const archived = await db.getArchivedScores(internalId, dtIn);
            for (const row of archived) {
              all.push({ u: row.username, s: Number(row.score), d: row.data || '', at: row.updated_at || '' });
            }
          } catch (e) { console.error('[FSCORE] archive query error:', e.message); }
        } else if (internalId) {
          for (const [u, rlist] of Object.entries(scoresData.users || {})) {
            if (rlist && rlist[internalId] && Number.isFinite(Number(rlist[internalId].score))) {
              all.push({ u, s: Number(rlist[internalId].score), d: rlist[internalId].data || '', at: rlist[internalId].updatedAt || '' });
            }
          }
        }
        all.sort(internalId ? scoreComparator(internalId) : (a, b) => b.s - a.s);
        const slice = all.slice(start, start + limit);
        let inner = '';
        for (const e of slice) {
          const ud = users[e.u] || {};
          const ts = e.at ? formatDateTimeParis(new Date(e.at)) : formatDateTimeParis(new Date());
          const displayData = formatRankingExtraData(internalId, e.d, e.s);
          const dAttr = displayData ? ` d="${escapeXml(displayData)}"` : '';
          inner += `<score u="${escapeXml(getDisplayName(e.u))}" x="${ud.xp || 0}" f="${escapeXml(bouilleOf(ud, e.u))}" s="${e.s}" t="${ts}"${dAttr} />`;
        }
        const rAttr = reqId ? ` r="${escapeXml(String(reqId))}"` : '';
        const tyAttr = legacyDesc && legacyDesc.ty ? ` ty="${escapeXml(legacyDesc.ty)}"` : '';
        const cAttr = cAttrIn ? ` c="${escapeXml(cAttrIn)}"` : '';
        const dtAttr = dtIn ? ` dt="${escapeXml(dtIn)}"` : '';
        let responseXml;
        if (!inner) {
          responseXml = buildLegacyRankingResultPayload(rkInput, reqId, cAttrIn);
        } else {
          responseXml = `<${CMD.ban}${rAttr} rk="${escapeXml(rkInput)}"${tyAttr}${cAttr}${dtAttr}>${inner}</${CMD.ban}>`;
        }
        sendToClient(socket, responseXml);
        console.log(`[FSCORE] rankingResult (via bugged wire l) ${rkInput}/${internalId || '-'}${isHistorical ? ' dt=' + dtIn : ''}: ${slice.length}/${all.length} entries`);
        break;
      }
      // FrutiScore listRankings: wire "l" without rk attr.
      // Handles both initial call (no dt) and date-navigation (with dt).
      // Distinguish from chat kick by checking: no 'g' channel and no 'u' target.
      if (msg.attrs.dt !== undefined || (!msg.attrs.g && !msg.attrs.u)) {
        const reqId = msg.attrs.r || '';
        const dtRaw = msg.attrs.dt !== undefined ? String(msg.attrs.dt || '') : parisDayKey();
        const dt = dtRaw.slice(0, 10);
        client.selectedDt = dt;
        const rAttr = reqId ? ` r="${escapeXml(String(reqId))}"` : '';
        const dtAttr = ` dt="${escapeXml(dt)}"`;
        let inner = '';
        const bySection = { C: [], L: [] };
        for (const d of LEGACY_RANKINGS) {
          const sec = d.section === 'L' ? 'L' : 'C';
          bySection[sec].push(d);
        }
        for (const sec of ['C', 'L']) {
          inner += `<s ty="${sec}">`;
          for (const d of bySection[sec]) {
            inner += `<rk rk="${escapeXml(d.rk)}" ty="${escapeXml(d.ty)}" rn="${escapeXml(d.rn)}" sst="1" et="10000" gs="${escapeXml(d.gs)}" g="${escapeXml(d.g)}" />`;
          }
          inner += '</s>';
        }
        sendToClient(socket, `<${CMD.kick}${dtAttr}${rAttr}>${inner}</${CMD.kick}>`);
        console.log(`[FSCORE] listRankings dt=${dt}: ${LEGACY_RANKINGS.length} legacy rankings sent`);
        break;
      }
      if (!isModerator(client.username)) {
        sendToClient(socket, `<${CMD.error} k="403" />`);
        break;
      }
      const g = pickActiveChannel(client, msg.attrs);
      const targetUser = resolveModerationTarget(msg);
      if (!g || !targetUser) break;
      kickUserFromChannel(g, targetUser, client.username, 'kick');
      sendToClient(socket, `<${CMD.kick} u="${escapeXml(getDisplayName(targetUser))}" g="${escapeXml(g)}" />`);
      break;
    }

    // ── ban (totocher) / FrutiScore rankingResult ──
    case 'ban': {
      // FrutiScore overlap: rankingResult uses wire code "m" with rk attr.
      if (msg.attrs.rk !== undefined) {
        if (VERBOSE_FSCORE) console.log(`[FSCORE-DEBUG] rankingResult (wire m) attrs=${JSON.stringify(msg.attrs)} selectedDt=${client && client.selectedDt}`);
        const rkInput = String(msg.attrs.rk);
        const cAttrIn = String(msg.attrs.c || '');
        const internalId = resolveInternalRankingId(rkInput, client.selectedDt || undefined);
        const dtInRaw = internalId && isDailyResetRanking(internalId) ? (client.selectedDt || '') : '';
        const dtIn = dtInRaw ? dtInRaw.slice(0, 10) : '';
        const isHistorical = dtIn && dtIn !== parisDayKey() && internalId && isDailyResetRanking(internalId) && process.env.DATABASE_URL;
        const legacyDesc = legacyDescriptorFromRkLike(rkInput);
        const reqId = msg.attrs.r || '';
        const start = Number(msg.attrs.s || 0) || 0;
        const limit = Number(msg.attrs.l || 20) || 20;
        let all = [];
        if (isHistorical) {
          try {
            const archived = await db.getArchivedScores(internalId, dtIn);
            for (const row of archived) {
              all.push({ u: row.username, s: Number(row.score), d: row.data || '', at: row.updated_at || '' });
            }
          } catch (e) { console.error('[FSCORE] archive query error:', e.message); }
        } else if (internalId) {
          for (const [u, rlist] of Object.entries(scoresData.users || {})) {
            if (rlist && rlist[internalId] && Number.isFinite(Number(rlist[internalId].score))) {
              all.push({ u, s: Number(rlist[internalId].score), d: rlist[internalId].data || '', at: rlist[internalId].updatedAt || '' });
            }
          }
        }
        all.sort(internalId ? scoreComparator(internalId) : (a, b) => b.s - a.s);
        const slice = all.slice(start, start + limit);
        let inner = '';
        for (const e of slice) {
          const ud = users[e.u] || {};
          const ts = e.at ? formatDateTimeParis(new Date(e.at)) : formatDateTimeParis(new Date());
          const displayData = formatRankingExtraData(internalId, e.d, e.s);
          const dAttr = displayData ? ` d="${escapeXml(displayData)}"` : '';
          inner += `<score u="${escapeXml(getDisplayName(e.u))}" x="${ud.xp || 0}" f="${escapeXml(bouilleOf(ud, e.u))}" s="${e.s}" t="${ts}"${dAttr} />`;
        }
        const rAttr = reqId ? ` r="${escapeXml(String(reqId))}"` : '';
        const tyAttr = legacyDesc && legacyDesc.ty ? ` ty="${escapeXml(legacyDesc.ty)}"` : '';
        const cAttr = cAttrIn ? ` c="${escapeXml(cAttrIn)}"` : '';
        const dtAttr2 = dtIn ? ` dt="${escapeXml(dtIn)}"` : '';
        if (!inner) {
          sendToClient(socket, buildLegacyRankingResultPayload(rkInput, reqId, cAttrIn));
        } else {
          sendToClient(socket, `<${CMD.ban}${rAttr} rk="${escapeXml(rkInput)}"${tyAttr}${cAttr}${dtAttr2}>${inner}</${CMD.ban}>`);
        }
        console.log(`[FSCORE] rankingResult ${rkInput}/${internalId || '-'}${isHistorical ? ' dt=' + dtIn : ''}: ${slice.length}/${all.length} entries`);
        break;
      }
      if (!isModerator(client.username)) {
        sendToClient(socket, `<${CMD.error} k="403" />`);
        break;
      }
      const g = pickActiveChannel(client, msg.attrs);
      const targetUser = resolveModerationTarget(msg);
      const channel = channels[g];
      if (!g || !targetUser || !channel) break;
      if (!channel.banned) channel.banned = new Set();
      channel.banned.add(targetUser);
      kickUserFromChannel(g, targetUser, client.username, 'totoch');
      sendToClient(socket, `<${CMD.ban} u="${escapeXml(getDisplayName(targetUser))}" g="${escapeXml(g)}" />`);
      break;
    }

    // ── channelclosed / FrutiScore gameScoreInfo ──
    case 'channelclosed': {
      if (msg.attrs.gs !== undefined) {
        sendToClient(socket, buildLegacyGameScoreInfo(msg.attrs.gs));
      }
      break;
    }

    // ── send: chat message ──
case 'send': {
  const g = msg.attrs.g;
  const text = msg.content || '';
  const type = msg.attrs.t || 'm';
  const pen = (msg.attrs.p !== undefined) ? msg.attrs.p : '';
  // Temporary diagnostic for the intermittent "messages render in black"
  // chat bug. Logs every pen value we receive (including empty) so we can
  // see which encoding ('000000', '', '0xRRGGBB', omitted etc.) renders
  // OK vs which renders as black. Remove once the right default-pen
  // canonical form is identified.
  if (type === 'm' || type === undefined) {
    const rawP = msg.attrs.p === undefined ? '(omitted)' : JSON.stringify(msg.attrs.p);
    console.log(`[CHAT-PEN] user=${client.username} g=${g} pen_raw=${rawP} text=${JSON.stringify((text || '').slice(0, 40))}`);
  }
  const timeAttrs = buildChatTimeAttrs();
  const senderData = users[client.username] || {};
  const mutedUntil = senderData.mutedUntil ? new Date(senderData.mutedUntil) : null;
  if (mutedUntil && !Number.isNaN(mutedUntil.getTime()) && mutedUntil.getTime() > Date.now()) {
    sendToClient(socket, `<${CMD.onmute} u="${escapeXml(getDisplayName(client.username))}" mt="${escapeXml(senderData.mutedUntil)}" mu="${escapeXml(senderData.mutedUntil)}" />`);
    break;
  }

  if (g && client.logged) {
    const channel = channels[g];
    if (!channel || !client.channels.has(g) || !channel.users.has(client.username)) {
      sendToClient(socket, `<${CMD.error} k="220" />`);
      break;
    }
    const canModHere = isModerator(client.username) || (isAnimator(client.username) && g === ANIM_CHANNEL);
    const canAnimHere = isAnimator(client.username) && g === ANIM_CHANNEL;

    if (canModHere && text.startsWith('/kick ')) {
      const targetUser = resolveKnownUsername(text.substring(6).trim());
      if (targetUser) kickUserFromChannel(g, targetUser, client.username, 'kick');
      break;
    }
    if (isModerator(client.username) && text.startsWith('/totoch ')) {
      const targetUser = resolveKnownUsername(text.substring(8).trim());
      const target = users[targetUser];
      if (targetUser && target) {
        if (getSocketsForUsername(targetUser).length === 0) {
          sendToClient(socket, `<${CMD.ban} k="214" u="${escapeXml(getDisplayName(targetUser))}" />`);
          break;
        }
        const until = new Date(Date.now() + 10 * 60 * 1000).toISOString().replace('T', '.').substring(0, 19);
        target.mutedUntil = until;
        for (const targetSock of getSocketsForUsername(targetUser)) {
          sendToClient(targetSock, `<${CMD.onmute} u="${escapeXml(getDisplayName(targetUser))}" mt="${escapeXml(until)}" mu="${escapeXml(until)}" />`);
        }
        addAndNotifyUserLog(targetUser, { type: USER_LOG_TYPE.TOTOCHE, content: `Tu as été réduit au silence pendant 10 minutes par ${getDisplayName(client.username)}.` });
        if (process.env.DATABASE_URL) db.addModerationLog(targetUser, client.username, 'totoche', `10 min`).catch(e => console.error('[DB] modlog error:', e.message));
        // Render exactly like userkicked/userjoined/userleaved: plain italic,
        // no timestamp, default color.  chat.msg_admin = "$h<i>$m</i>" so we
        // pass empty h/d and a plain body — the SWF wraps it in <i>…</i>.
        const announceTotoche = `<![CDATA[${escapeXml(getDisplayName(targetUser))} a été totoché]]>`;
        for (const [chanName, channel] of Object.entries(channels)) {
          if (channel && channel.users && channel.users.has(targetUser)) {
            broadcastToChannel(chanName, `<${CMD.send} u="admin" t="m" p="" g="${escapeXml(chanName)}" h="" d="">${announceTotoche}</${CMD.send}>`);
          }
        }
      }
      break;
    }

    // ── Animator blue mode: /blueon, /blueoff ──
    if (/^\/blueon\s*$/i.test(text)) {
      if (canAnimHere || isModerator(client.username)) {
        blueModeUsers.add(client.username);
        sendToClient(socket, `<${CMD.send} u="admin" t="m" p="" g="${escapeXml(g)}" h="${timeAttrs.h}" d="${timeAttrs.d}"><![CDATA[<i>Mode bleu activé.</i>]]></${CMD.send}>`);
      }
      break;
    }
    if (/^\/blueoff\s*$/i.test(text)) {
      blueModeUsers.delete(client.username);
      sendToClient(socket, `<${CMD.send} u="admin" t="m" p="" g="${escapeXml(g)}" h="${timeAttrs.h}" d="${timeAttrs.d}"><![CDATA[<i>Mode bleu désactivé.</i>]]></${CMD.send}>`);
      break;
    }

    // ── Quiz commands (animator on anim channel, or moderator anywhere) ──
    if ((canAnimHere || isModerator(client.username)) && /^\/initpoint/i.test(text)) {
      const question = text.replace(/^\/initpoint\s*/i, '').trim();
      quizState[g] = { question: question || '', points: new Map(), active: true };
      const announce = question
        ? `<![CDATA[<b><font color="#0066CC">Quiz lancé par ${getDisplayName(client.username)} : ${question}</font></b>]]>`
        : `<![CDATA[<b><font color="#0066CC">Quiz lancé par ${getDisplayName(client.username)} !</font></b>]]>`;
      broadcastToChannel(g, `<${CMD.send} u="admin" t="m" p="" g="${escapeXml(g)}" h="${timeAttrs.h}" d="${timeAttrs.d}">${announce}</${CMD.send}>`);
      break;
    }

    if ((canAnimHere || isModerator(client.username)) && /^\/point\s/i.test(text)) {
      const args = text.replace(/^\/point\s+/i, '').trim().split(/\s+/);
      const target = resolveKnownUsername(args[0]);
      const amount = Math.max(1, Math.min(parseInt(args[1]) || 1, 100));
      if (!target) {
        sendToClient(socket, `<${CMD.send} u="admin" t="m" p="" g="${escapeXml(g)}" h="${timeAttrs.h}" d="${timeAttrs.d}">Utilisateur introuvable.</${CMD.send}>`);
        break;
      }
      if (!quizState[g]) quizState[g] = { question: '', points: new Map(), active: true };
      const cur = quizState[g].points.get(target) || 0;
      quizState[g].points.set(target, cur + amount);
      const msg2 = `<![CDATA[<b><font color="#0066CC">+${amount} point${amount > 1 ? 's' : ''} pour ${getDisplayName(target)} (total : ${cur + amount})</font></b>]]>`;
      broadcastToChannel(g, `<${CMD.send} u="admin" t="m" p="" g="${escapeXml(g)}" h="${timeAttrs.h}" d="${timeAttrs.d}">${msg2}</${CMD.send}>`);
      break;
    }

    if ((canAnimHere || isModerator(client.username)) && /^\/removepoint\s/i.test(text)) {
      const args = text.replace(/^\/removepoint\s+/i, '').trim().split(/\s+/);
      const target = resolveKnownUsername(args[0]);
      const amount = Math.max(1, Math.min(parseInt(args[1]) || 1, 100));
      if (!target || !quizState[g]) { break; }
      const cur = quizState[g].points.get(target) || 0;
      quizState[g].points.set(target, Math.max(0, cur - amount));
      const msg2 = `<![CDATA[<b><font color="#0066CC">-${amount} point${amount > 1 ? 's' : ''} pour ${getDisplayName(target)} (total : ${Math.max(0, cur - amount)})</font></b>]]>`;
      broadcastToChannel(g, `<${CMD.send} u="admin" t="m" p="" g="${escapeXml(g)}" h="${timeAttrs.h}" d="${timeAttrs.d}">${msg2}</${CMD.send}>`);
      break;
    }

    if ((canAnimHere || isModerator(client.username)) && /^\/(showpoint|classement)\s*$/i.test(text)) {
      const qs = quizState[g];
      if (!qs || qs.points.size === 0) {
        sendToClient(socket, `<${CMD.send} u="admin" t="m" p="" g="${escapeXml(g)}" h="${timeAttrs.h}" d="${timeAttrs.d}">Aucun point distribué.</${CMD.send}>`);
        break;
      }
      const sorted = [...qs.points.entries()].sort((a, b) => b[1] - a[1]);
      const lines = sorted.map(([u, pts], i) => `${i + 1}. ${getDisplayName(u)} — ${pts} pt${pts > 1 ? 's' : ''}`);
      const header = qs.question ? `Classement — ${qs.question}` : 'Classement';
      const body = `<![CDATA[<b><font color="#0066CC">${header}</font></b><br/>${lines.join('<br/>')}]]>`;
      broadcastToChannel(g, `<${CMD.send} u="admin" t="m" p="" g="${escapeXml(g)}" h="${timeAttrs.h}" d="${timeAttrs.d}">${body}</${CMD.send}>`);
      break;
    }

    if ((canAnimHere || isModerator(client.username)) && /^\/(resetpoint|stoppoint|endpoint)\s*$/i.test(text)) {
      if (quizState[g] && quizState[g].points.size > 0) {
        const sorted = [...quizState[g].points.entries()].sort((a, b) => b[1] - a[1]);
        const lines = sorted.map(([u, pts], i) => `${i + 1}. ${getDisplayName(u)} — ${pts} pt${pts > 1 ? 's' : ''}`);
        const body = `<![CDATA[<b><font color="#0066CC">Fin du quiz ! Classement final :</font></b><br/>${lines.join('<br/>')}]]>`;
        broadcastToChannel(g, `<${CMD.send} u="admin" t="m" p="" g="${escapeXml(g)}" h="${timeAttrs.h}" d="${timeAttrs.d}">${body}</${CMD.send}>`);
      }
      delete quizState[g];
      break;
    }

    // ── /topic, /sujet: change channel topic ──
    if (text.startsWith('/topic ') || text.startsWith('/sujet ')) {
      const newTopic = text.replace(/^\/(topic|sujet)\s+/, '').trim();
      if (newTopic.length > 200) {
        sendToClient(socket, `<${CMD.send} u="admin" t="m" p="" g="${escapeXml(g)}" h="${timeAttrs.h}" d="${timeAttrs.d}">Le sujet est trop long (200 caractères max).</${CMD.send}>`);
        break;
      }
      if (newTopic) {
        channel.topic = newTopic;
        broadcastToChannel(g, `<${CMD.topic} g="${escapeXml(g)}">${escapeXml(newTopic)}</${CMD.topic}>`);
        if (process.env.DATABASE_URL) db.updateChannelTopic(g, newTopic).catch(e => console.error('[DB] topic save error:', e.message));
      }
      break;
    }

    // ── /stat, /stats, /statut, /status, /statistiques, /statistics: channel stats ──
    if (/^\/(stat|stats|statut|status|statistiques|statistics)\s*$/i.test(text)) {
      const userCount = channel.users.size;
      const userList = [...channel.users].map(u => getDisplayName(u)).join(', ');
      const topicStr = channel.topic || '(aucun sujet)';
      const lines = [
        `--- Statistiques du salon ${g} ---`,
        `Utilisateurs connectés : ${userCount}`,
        `Liste : ${userList}`,
        `Sujet : ${topicStr}`,
      ];
      for (const line of lines) {
        sendToClient(socket, `<${CMD.send} u="admin" t="m" p="" g="${escapeXml(g)}" h="${timeAttrs.h}" d="${timeAttrs.d}">${escapeXml(line)}</${CMD.send}>`);
      }
      break;
    }

    // ── /image, /img, /testimage, /testimg: embed image in chat ──
    if (/^\/(test)?(image|img)\s/i.test(text)) {
      const isTest = /^\/test/i.test(text);
      const args = text.replace(/^\/(test)?(image|img)\s+/i, '').split(/\s+/);
      const w = parseInt(args[0]) || 0;
      const h = parseInt(args[1]) || 0;
      const url = args[2] || '';
      const title = args.slice(3).join(' ');
      if (!w || !h || !url || !/^https?:\/\//i.test(url)) {
        sendToClient(socket, `<${CMD.send} u="admin" t="m" p="" g="${escapeXml(g)}" h="${timeAttrs.h}" d="${timeAttrs.d}">${escapeXml('Syntaxe: /image largeur hauteur url titre')}</${CMD.send}>`);
        break;
      }
      const cw = Math.min(Math.max(w, 10), 500);
      const ch = Math.min(Math.max(h, 10), 500);
      const imgBody = `<img src="${url}" width="${cw}" height="${ch}" />${title || ''}`;
      const imgXml = `<${CMD.send} u="${escapeXml(getDisplayName(client.username))}" t="m" p="${pen}" g="${escapeXml(g)}" h="${timeAttrs.h}" d="${timeAttrs.d}"><![CDATA[${imgBody}]]></${CMD.send}>`;
      if (isTest) {
        sendToClient(socket, imgXml);
      } else {
        broadcastToChannel(g, imgXml);
      }
      break;
    }

    let safeText = escapeXml(text);

    // Moderator "!" prefix: route through chat.msg_admin ("$h<i>$m</i>") and
    // inline a red bold <font> in BOTH the timestamp (h attr) and message
    // body — the SWF renders the resulting concatenation through an HTML
    // TextField, so wrapping the timestamp in <font color> turns it red
    // alongside the message text.
    if (isModerator(client.username) && text.startsWith('!')) {
      const shout = text.substring(1).trim();
      if (shout) {
        const inner = escapeXml(getDisplayName(client.username) + ': ' + shout);
        const body = `<![CDATA[<font color="#C10000"><b>${inner}</b></font>]]>`;
        const redStamp = `<font color="#C10000">${timeAttrs.h.trim()}</font> `;
        broadcastToChannel(g,
          `<${CMD.send} u="admin" t="m" p="" g="${escapeXml(g)}" h="${escapeXml(redStamp)}" d="${timeAttrs.d}">${body}</${CMD.send}>`
        );
        break;
      }
    }

    // Type "g" (kikooz gift broadcast from /donne command):
    // Body is an inner <g k="amount" u="target"/> element, not text.
    // The /do/give HTTP endpoint already validated and transferred the kikooz,
    // so here we just echo the broadcast to channel members.
    if (type === 'g' && msg.children && msg.children.length > 0) {
      const gChild = msg.children.find((c) => c.tag === 'g');
      if (gChild) {
        const childXml = `<g k="${escapeXml(gChild.attrs.k || '')}" u="${escapeXml(gChild.attrs.u || '')}" />`;
        const giftXml = `<${CMD.send} u="${escapeXml(getDisplayName(client.username))}" t="g" p="${pen}" g="${g}" h="${timeAttrs.h}" d="${timeAttrs.d}">${childXml}</${CMD.send}>`;
        broadcastToChannel(g, giftXml);
        break;
      }
    }

    // Animator/moderator blue mode — wraps the whole line in blue bold
    if (blueModeUsers.has(client.username) && (isAnimator(client.username) || isModerator(client.username))) {
      const rawText = text.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
      const blueBody = `<![CDATA[<b><font color="#0066CC">${getDisplayName(client.username)}: ${rawText}</font></b>]]>`;
      broadcastToChannel(g,
        `<${CMD.send} u="admin" t="m" p="" g="${escapeXml(g)}" h="${timeAttrs.h}" d="${timeAttrs.d}">${blueBody}</${CMD.send}>`
      );
      trackXpAction(client.username, 'chatMsg');
      break;
    }

    const xml = `<${CMD.send} u="${escapeXml(getDisplayName(client.username))}" t="${type}"${pen ? ` p="${escapeXml(pen)}"` : ''} g="${g}" h="${timeAttrs.h}" d="${timeAttrs.d}">${safeText}</${CMD.send}>`;
    broadcastToChannel(g, xml);
    trackXpAction(client.username, 'chatMsg');
} else if (msg.attrs.u) {
  const targetUser = msg.attrs.u;
  const safeText = escapeXml(text);

  // Echo au sender, indispensable pour afficher sa propre ligne
  sendToClient(
    socket,
    `<${CMD.send} u="${escapeXml(getDisplayName(client.username))}" t="${type}" p="${pen}" h="${timeAttrs.h}" d="${timeAttrs.d}">${safeText}</${CMD.send}>`
  );

  // Envoi au destinataire
  for (const [sock, cl] of xmlSocketClients) {
    if (cl.username === targetUser) {
      sendToClient(
        sock,
        `<${CMD.send} u="${escapeXml(getDisplayName(client.username))}" t="${type}" p="${pen}" h="${timeAttrs.h}" d="${timeAttrs.d}">${safeText}</${CMD.send}>`
      );
    }
  }
}
  break;
}

    // ── mute (totocher): temporary chat silence ──
    case 'mute': {
      if (!isModerator(client.username)) {
        sendToClient(socket, `<${CMD.error} k="403" />`);
        break;
      }
      const targetUser = resolveModerationTarget(msg);
      const target = users[targetUser];
      if (!targetUser || !target) break;

      // Reject totoche on offline users.  Reuse the existing <ban k="..." />
      // error path (onBan in listener/main.as) — it opens a popup alert with
      // "Une erreur a eu lieu durant le ban : Cet utilisateur n'est pas
      // connecté.", which matches the popup-on-forbidden-action UX the
      // moderator expects.  Error code 214 maps to error.cbee.214 in the
      // French lang dictionary.
      if (getSocketsForUsername(targetUser).length === 0) {
        sendToClient(socket, `<${CMD.ban} k="214" u="${escapeXml(getDisplayName(targetUser))}" />`);
        break;
      }
      const until = msg.attrs.e || new Date(Date.now() + 10 * 60 * 1000).toISOString().replace('T', '.').substring(0, 19);
      target.mutedUntil = until;
      for (const targetSock of getSocketsForUsername(targetUser)) {
        sendToClient(targetSock, `<${CMD.onmute} u="${escapeXml(getDisplayName(targetUser))}" mt="${escapeXml(until)}" mu="${escapeXml(until)}" />`);
      }
      sendToClient(socket, `<${CMD.mute} u="${escapeXml(getDisplayName(targetUser))}" mt="${escapeXml(until)}" mu="${escapeXml(until)}" />`);
      addAndNotifyUserLog(targetUser, { type: USER_LOG_TYPE.TOTOCHE, content: `Tu as été réduit au silence pendant 10 minutes par ${getDisplayName(client.username)}.` });
      if (process.env.DATABASE_URL) db.addModerationLog(targetUser, client.username, 'totoche', `10 min`).catch(e => console.error('[DB] modlog error:', e.message));

      const announceTotoche = `<![CDATA[${escapeXml(getDisplayName(targetUser))} a été totoché]]>`;
      for (const [chanName, channel] of Object.entries(channels)) {
        if (channel && channel.users && channel.users.has(targetUser)) {
          broadcastToChannel(chanName, `<${CMD.send} u="admin" t="m" p="" g="${escapeXml(chanName)}" h="" d="">${announceTotoche}</${CMD.send}>`);
          broadcastToChannel(chanName, `<${CMD.trace} u="${escapeXml(getDisplayName(targetUser))}" p="1" s="${getStatusCode(target, targetUser)}" mu="${getMuteValue(target)}" f="${bouilleOf(target)}" />`);
        }
      }
      break;
    }

    case 'unmute': {
      if (!isModerator(client.username)) {
        sendToClient(socket, `<${CMD.error} k="403" />`);
        break;
      }
      const targetUser = resolveModerationTarget(msg);
      const target = users[targetUser];
      if (!targetUser || !target) break;
      delete target.mutedUntil;
      for (const targetSock of getSocketsForUsername(targetUser)) {
        sendToClient(targetSock, `<${CMD.endmute} u="${escapeXml(getDisplayName(targetUser))}" />`);
      }
      sendToClient(socket, `<${CMD.unmute} u="${escapeXml(getDisplayName(targetUser))}" />`);
      const g = pickActiveChannel(client, msg.attrs);
      if (g) {
        broadcastToChannel(g, `<${CMD.trace} u="${escapeXml(getDisplayName(targetUser))}" p="1" s="${getStatusCode(target, targetUser)}" mu="${getMuteValue(target)}" f="${bouilleOf(target)}" />`);
      }
      break;
    }

    // ── trace: request status updates for users ──
case 'trace': {
  const traceChildren = (msg.children || []).filter(child => child.tag === 'u' && child.attrs.u);

  if (traceChildren.length > 0) {
    let inner = '';

    for (const child of traceChildren) {
      const u = String(child.attrs.u).toLowerCase();
      subscribeTrace(socket, u);
      const ud = users[u] || {};
      const pVal = getSocketsForUsername(u).length > 0 ? 1 : 0;
      inner += `<u u="${escapeXml(getDisplayName(u))}" p="${pVal}" s="${getStatusCode(ud, u)}" mu="${getMuteValue(ud)}" f="${bouilleOf(ud, u)}" />`;
    }

    sendToClient(socket, `<${CMD.trace}>${inner}</${CMD.trace}>`);
    break;
  }

  const targetUser = String(msg.attrs.u || '').toLowerCase();
  if (targetUser) {
    subscribeTrace(socket, targetUser);
    if (client.sid && sessions[client.sid]) {
      sessions[client.sid].lastTraceUser = targetUser;
    }
    const ud = users[targetUser] || {};
    const pVal = getSocketsForUsername(targetUser).length > 0 ? 1 : 0;
    sendToClient(
      socket,
      `<${CMD.trace} u="${escapeXml(getDisplayName(targetUser))}" p="${pVal}" s="${getStatusCode(ud, targetUser)}" mu="${getMuteValue(ud)}" f="${bouilleOf(ud, targetUser)}" />`
    );
  }
  break;
}
    // ── stoptrace: stop tracking users / FrutiScore rateranking ──
    case 'stoptrace': {
      // FrutiScore overlap: rateranking uses wire code "aa" with s/l attrs.
      // Serves the "Class. consécration" ranking (computed on the fly from pictos).
      if (msg.attrs.s !== undefined || msg.attrs.l !== undefined) {
        const start = Number(msg.attrs.s || 0) || 0;
        const limit = Number(msg.attrs.l || 10) || 10;
        const all = await getConsecrationLeaderboard();
        const slice = all.slice(start, start + limit);
        let inner = '';
        for (const e of slice) {
          const ud = users[e.u] || {};
          inner += `<score u="${escapeXml(getDisplayName(e.u))}" x="${ud.xp || 0}" f="${escapeXml(bouilleOf(ud, e.u))}" s="${e.s}" t="${formatDateTime(new Date())}" />`;
        }
        sendToClient(socket, `<${CMD.stoptrace}>${inner}</${CMD.stoptrace}>`);
        console.log(`[FSCORE] rateranking (consecration): ${slice.length}/${all.length} entries`);
        break;
      }
      break;
    }

    // ── status: update user status ──
    case 'status': {
      // Persist on the live client so getStatusCode() can pick it up,
      // then broadcast a trace update to every channel the user is in.
      // The "internal" digit drives the icon (forum/snake3/kaluga/...) shown
      // next to the pseudo in the userlist and in the contacts bar.
      const s = String(msg.attrs.s || '0000');
      client.statusStr = s;
      // Echo back so the sender's own onStatus updates _global.me's traced entry.
      sendToClient(socket, `<${CMD.status} s="${s}" />`);
      if (client.username && client.logged) {
        const ud = users[client.username] || {};
        const traceXml = `<${CMD.trace} u="${escapeXml(getDisplayName(client.username))}" p="1" s="${getStatusCode(ud, client.username)}" mu="${getMuteValue(ud)}" f="${bouilleOf(ud, client.username)}" />`;
        for (const ch of client.channels || []) {
          broadcastToChannel(ch, traceXml, socket);
        }
        notifyTraceSubscribers(client.username, socket);
      }
      break;
    }

    // ── userinfo: get user info ──
    case 'userinfo': {
      const u = String(msg.attrs.u || '').toLowerCase();
      const r = msg.attrs.r || '';
      if (client.sid && sessions[client.sid]) {
        sessions[client.sid].lastProfileUser = u;
      }
      let ud = users[u];
      if (!ud && process.env.DATABASE_URL) {
        try {
          const row = await db.findUserByUsername(u);
          if (row) ud = dbUserToMemory(row);
        } catch (e) { /* ignore */ }
      }
      if (!ud) ud = {};
      const consUserA = computeConsecration(u);
      sendToClient(socket,
        `<${CMD.userinfo} r="${escapeXml(r)}" u="${escapeXml(getDisplayName(u))}" x="${ud.xp || 0}" sx="${ud.gender || 'M'}" bd="${escapeXml(getFrutizBirthday(ud, ''))}" fj="${escapeXml(getFrutizJob(u, ud))}" fs="${ud.frutiSign >= 0 ? ud.frutiSign : ''}" fsb="${ud.frutiSignB >= 0 ? ud.frutiSignB : ''}" ft="${escapeXml(getFrutizSubscribeDate(ud))}" fr="${consUserA.overall || 0}" bn="${escapeXml(ud.blogName || '')}" co="${escapeXml(ud.countryIndex || '1')}" rg="${escapeXml(ud.regionIndex || '0')}" ct="${escapeXml(ud.city || '')}" rj="${escapeXml(ud.realJob || '')}" fn="${escapeXml(ud.firstName || '')}" ln="${escapeXml(ud.lastName || '')}" cm="${escapeXml(ud.comment || '')}" su="${escapeXml(ud.siteUrl || '')}" m="${ud.isModerator ? 1 : 0}" a="${ud.isAnimator ? 1 : 0}" />`
      );
      break;
    }

    // ── xpposition: XP ranking position ──
    case 'xpposition': {
      const myXp = (users[client.username] || {}).xp || 0;
      let pos = 1;
      if (myXp > 0) {
        try {
          const dbUsers = await db.listAllUsers();
          const merged = new Map();
          for (const row of dbUsers) {
            if (row.xp > 0) merged.set(row.username, row.xp);
          }
          for (const [u, ud] of Object.entries(users)) {
            if (ud && Number.isFinite(ud.xp) && ud.xp > 0) merged.set(u, ud.xp);
          }
          for (const [, xp] of merged) {
            if (xp > myXp) pos++;
          }
        } catch (e) { /* fallback to 1 */ }
      }
      sendToClient(socket, `<${CMD.xpposition} p="${pos}" />`);
      break;
    }

case 'fbouille': {
  const f = normalizeBouilleState(msg.attrs.f || DEFAULT_BOUILLE_STATE);

  if (client.username && users[client.username]) {
    users[client.username].fbouille = f;
    bouilleCache[client.username] = f;
  }

  sendToClient(socket, `<${CMD.fbouille} f="${f}" />`);
  break;
}

case 'createchannel': {
  const otherUserRaw = msg.attrs.u || '';
  const requester = client.username || '';
  const reqId = msg.attrs.r || '';
  const title = msg.content || '';

  if (!requester) {
    sendToClient(socket, `<${CMD.createchannel} k="1" r="${escapeXml(reqId)}" />`);
    break;
  }

  // ── Public channel creation (no "u" attribute) ──
  if (!otherUserRaw) {
    if (!title.trim()) {
      sendToClient(socket, `<${CMD.createchannel} k="1" r="${escapeXml(reqId)}" />`);
      break;
    }

    // Generate unique channel ID
    const slug = title.trim().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // strip accents
      .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').substring(0, 30);
    let channelId = `ch_${slug}`;
    let suffix = 1;
    while (channels[channelId]) {
      channelId = `ch_${slug}_${suffix++}`;
    }

    channels[channelId] = {
      desc: title.trim(),
      topic: title.trim(),
      users: new Set(),
      creator: requester,
    };

    // Auto-join the creator
    channels[channelId].users.add(requester);
    client.channels.add(channelId);

    console.log(`[CBee]  Channel "${channelId}" created by ${requester} (topic: ${title.trim()})`);

    // Response: <r g="channelId" r="requestId">topic</r>
    sendToClient(
      socket,
      `<${CMD.createchannel} g="${channelId}" r="${escapeXml(reqId)}">${escapeXml(title.trim())}</${CMD.createchannel}>`
    );
    break;
  }

  // ── Private channel creation (with "u" attribute) ──
  const otherUser = resolveKnownUsername(normalizeUsername(otherUserRaw));
  const privateTitle = title || otherUser || 'Discussion privée';

  if (!otherUser) {
    sendToClient(socket, `<${CMD.createchannel} k="201" u="${escapeXml(otherUserRaw)}" r="${escapeXml(reqId)}" />`);
    break;
  }

  // Native protocol: error code 201 is also returned when the target user is
  // offline. The AS2 client's Lang dictionary maps chat.nouser to "$u n'est
  // pas connecté actuellement mais vous pouvez lui envoyer un e-mail.", and
  // the onCreateChannel handler offers an email shortcut alongside the alert.
  if (getSocketsForUsername(otherUser).length === 0) {
    sendToClient(socket, `<${CMD.createchannel} k="201" u="${escapeXml(getDisplayName(otherUser))}" r="${escapeXml(reqId)}" />`);
    break;
  }

  const sortedUsers = [requester.toLowerCase(), otherUser.toLowerCase()].sort();
  const privateGroup = buildPrivateGroupName(sortedUsers[0], sortedUsers[1]);
  const privatePass = `pw_${sortedUsers[0].slice(0, 4)}_${sortedUsers[1].slice(0, 4)}`;

  if (!channels[privateGroup]) {
    channels[privateGroup] = {
      desc: `Discussion privée ${requester}/${otherUser}`,
      topic: privateTitle,
      users: new Set([requester, otherUser]),
      participants: [requester, otherUser],
      private: true,
      pass: privatePass,
    };
  } else {
    channels[privateGroup].users.add(requester);
    channels[privateGroup].users.add(otherUser);
  }

  // Auto-subscribe the requester so broadcastToChannel reaches them right
  // away.  Without this, messages sent before the AS2 client manages to
  // issue an explicit `join` are silently dropped, which produces the
  // double-click-to-open and "empty chat" symptoms.
  client.channels.add(privateGroup);

  // Accusé de réception de l’ouverture de la discussion privée
  sendToClient(
    socket,
    `<${CMD.createchannel} u="${escapeXml(getDisplayName(otherUser))}" g="${privateGroup}" p="${privatePass}" r="${escapeXml(reqId)}">${escapeXml(privateTitle)}</${CMD.createchannel}>`
  );

  // Invite "privée" envoyée au demandeur pour ouvrir immédiatement la box
  sendToClient(
    socket,
    `<${CMD.invitechat} u="${escapeXml(getDisplayName(otherUser))}" g="${privateGroup}" p="${privatePass}" />`
  );

  // Push the channel userlist + trace so the freshly opened chat box has
  // both participants visible immediately (mirrors what `join` sends for
  // public channels).
  {
    const participantNames = [requester, otherUser];
    let userXml = '';
    let traceXml = '';
    for (const u of participantNames) {
      const ud = users[u] || {};
      const present = getSocketsForUsername(u).length > 0 ? 1 : 0;
      userXml += `<u u="${escapeXml(getDisplayName(u))}" x="${ud.xp || 0}" sx="${ud.gender || 'M'}" bd="${ud.birthday || '2000-01-01.00:00:00'}" co="${ud.country || 'FR'}" rg="${ud.region || ''}" p="${present}" s="${getStatusCode(ud, u)}" mu="${getMuteValue(ud)}" f="${bouilleOf(ud)}" />`;
      traceXml += `<u u="${escapeXml(getDisplayName(u))}" p="${present}" s="${getStatusCode(ud, u)}" mu="${getMuteValue(ud)}" f="${bouilleOf(ud)}" />`;
    }
    sendToClient(socket, `<${CMD.userlist} g="${privateGroup}">${userXml}</${CMD.userlist}>`);
    sendToClient(socket, `<${CMD.trace}>${traceXml}</${CMD.trace}>`);
  }

  // On pousse aussi les infos connues sur l’autre user
  const ud = users[otherUser] || createDefaultUser('');

  const consOtherUser = computeConsecration(otherUser);
  sendToClient(
    socket,
    `<${CMD.userinfo} r="pm" u="${escapeXml(getDisplayName(otherUser))}" x="${ud.xp || 0}" sx="${ud.gender || 'M'}" bd="${escapeXml(getFrutizBirthday(ud, '2000-01-01.00:00:00'))}" fj="${escapeXml(getFrutizJob(otherUser, ud))}" fs="${ud.frutiSign >= 0 ? ud.frutiSign : ''}" fsb="${ud.frutiSignB >= 0 ? ud.frutiSignB : ''}" ft="${escapeXml(getFrutizSubscribeDate(ud))}" fr="${consOtherUser.overall || 0}" bn="${escapeXml(ud.blogName || '')}" co="${escapeXml(ud.countryIndex || '1')}" rg="${escapeXml(ud.regionIndex || '0')}" ct="${escapeXml(ud.city || '')}" rj="${escapeXml(ud.realJob || '')}" fn="${escapeXml(ud.firstName || '')}" ln="${escapeXml(ud.lastName || '')}" cm="${escapeXml(ud.comment || '')}" su="${escapeXml(ud.siteUrl || '')}" m="${ud.isModerator ? 1 : 0}" a="${ud.isAnimator ? 1 : 0}" />`
  );

  sendToClient(
    socket,
    `<${CMD.trace} u="${escapeXml(getDisplayName(otherUser))}" p="${getSocketsForUsername(otherUser).length > 0 ? 1 : 0}" s="${getStatusCode(ud, otherUser)}" mu="${getMuteValue(ud)}" f="${bouilleOf(ud, otherUser)}" />`
  );

  // Si l'autre utilisateur est connecté, il reçoit aussi l'invitation et
  // est lui aussi auto-inscrit côté serveur — sinon il ne recevrait pas
  // les messages tant que son client AS2 n'a pas eu le temps d'envoyer
  // son propre `join`.
  for (const targetSock of getSocketsForUsername(otherUser)) {
    const targetClient = xmlSocketClients.get(targetSock);
    if (targetClient) targetClient.channels.add(privateGroup);
    sendToClient(
      targetSock,
      `<${CMD.invitechat} u="${escapeXml(getDisplayName(requester))}" g="${privateGroup}" p="${privatePass}" />`
    );
  }

  console.log(`[CBee]  Private channel "${privateGroup}" opened by ${requester} with ${otherUser}`);
  break;
}

    // ── invitechat: invite a user to an existing private channel ──
    case 'invitechat': {
      const g = msg.attrs.g || '';
      const targetUser = msg.attrs.u || '';
      const requester = client.username || '';
      const channel = channels[g];

      if (!g || !targetUser || !requester || !channel) {
        break;
      }

      const pass = msg.attrs.p || channel.pass || '';
      channel.users.add(requester);
      channel.users.add(targetUser);

      for (const targetSock of getSocketsForUsername(targetUser)) {
        sendToClient(
          targetSock,
          `<${CMD.invitechat} u="${escapeXml(getDisplayName(requester))}" g="${g}" p="${pass}" />`
        );
      }
      break;
    }

    // ── xpflag ──
    case 'xpflag': {
      // Just acknowledge
      break;
    }

    // ── topic: set channel topic ──
    case 'topic': {
      const g = msg.attrs.g;
      if (g && channels[g] && msg.content) {
        channels[g].topic = msg.content;
        broadcastToChannel(g,
          `<${CMD.topic} g="${g}">${msg.content}</${CMD.topic}>`
        );
      }
      break;
    }

    // ── searchuser: search for a user ──
    // Flash client (box.Search.onSearch) reads:
    //   root attrs: s (echoed start), n (total count)
    //   each <u>: u, x, sx, bd, co, rg, ct, f, p, s
    case 'searchuser': {
      const start = Number(msg.attrs.s || 0) || 0;
      const limit = Number(msg.attrs.l || 20) || 20;
      const fU = String(msg.attrs.u || '').toLowerCase();
      const fSx = String(msg.attrs.sx || '');
      const fCt = String(msg.attrs.ct || '').toLowerCase();
      const fCo = String(msg.attrs.co || '');
      const fRg = String(msg.attrs.rg || '');
      const fBd = String(msg.attrs.bd || '');   // birthday max → minimum age
      const fBdm = String(msg.attrs.bdm || ''); // birthday min → maximum age

      // Merge in-memory users (logged-in + NPCs) with DB rows for offline users.
      const candidates = new Map(); // username (lowercase) -> profile snapshot
      for (const [uname, ud] of Object.entries(users)) {
        candidates.set(uname.toLowerCase(), {
          username: uname,
          displayName: getDisplayName(uname),
          xp: ud.xp || 0,
          gender: ud.gender || 'M',
          birthday: ud.birthday || '2000-01-01',
          country: ud.country || 'FR',
          region: ud.region || '',
          city: ud.city || '',
          fbouille: bouilleOf(ud, uname),
          status: getStatusCode(ud, uname),
        });
      }
      if (process.env.DATABASE_URL) {
        try {
          const rows = await db.listAllUsers();
          for (const row of rows) {
            const key = row.username.toLowerCase();
            if (candidates.has(key)) continue;
            let bday = '2000-01-01';
            if (row.birthday instanceof Date) bday = row.birthday.toISOString().substring(0, 10);
            else if (typeof row.birthday === 'string' && row.birthday.length >= 10) bday = row.birthday.substring(0, 10);
            candidates.set(key, {
              username: row.username,
              displayName: row.display_name || row.username,
              xp: row.xp || 0,
              gender: row.gender || 'M',
              birthday: bday,
              country: row.country || 'FR',
              region: row.region || '',
              city: row.city || '',
              fbouille: row.fbouille || DEFAULT_BOUILLE_STATE,
              status: '0000',
            });
          }
        } catch (e) { console.error('[SEARCH] DB error:', e.message); }
      }

      const all = [];
      for (const c of candidates.values()) {
        if (fU && !c.username.toLowerCase().includes(fU) && !c.displayName.toLowerCase().includes(fU)) continue;
        if (fSx && c.gender !== fSx) continue;
        if (fCt && !c.city.toLowerCase().includes(fCt)) continue;
        if (fCo && c.country !== fCo) continue;
        if (fRg && c.region !== fRg) continue;
        // Age filters: bdm = oldest birthday allowed (max age); bd = newest birthday allowed (min age)
        if (fBdm && c.birthday < fBdm) continue;
        if (fBd && c.birthday > fBd) continue;
        all.push(c);
      }
      all.sort((a, b) => a.username.localeCompare(b.username));
      const total = all.length;
      const page = all.slice(start, start + limit);
      let inner = '';
      for (const c of page) {
        const online = getSocketsForUsername(c.username).length > 0 ? 1 : 0;
        const bdAttr = c.birthday.length >= 10 ? c.birthday + '.00:00:00' : '2000-01-01.00:00:00';
        inner += `<u u="${escapeXml(c.displayName)}" x="${c.xp}" sx="${escapeXml(c.gender)}" bd="${escapeXml(bdAttr)}" co="${escapeXml(c.country)}" rg="${escapeXml(c.region)}" ct="${escapeXml(c.city)}" p="${online}" s="${escapeXml(c.status)}" f="${escapeXml(c.fbouille)}" />`;
      }
      sendToClient(socket, `<${CMD.searchuser} s="${start}" l="${limit}" n="${total}">${inner}</${CMD.searchuser}>`);
      break;
    }

    // ── listbouilles: list available avatar parts ──
    case 'listbouilles': {
      sendToClient(socket, `<${CMD.listbouilles}>${buildBouilleListXml()}</${CMD.listbouilles}>`);
      break;
    }

    // ── serviceinfo: service information ──
    case 'serviceinfo': {
      sendToClient(socket, `<${CMD.serviceinfo} />`);
      break;
    }

    // ── statusobj: status object ──
    case 'statusobj': {
      sendToClient(socket, `<${CMD.statusobj} />`);
      break;
    }

    // ── FrutiScore: listModes (v) ──
    case 'v': {
      const discId = msg.attrs.d || '';
      console.log(`[CBee]  FrutiScore listModes: disc=${discId}`);
      // Return available game modes for the disc
      // Mode 0 = classic, type matches disc type
      const disc = GAME_DISCS[discId] || {};
      sendToClient(socket, `<v><m n="0" t="${disc.discType || '1'}" /></v>`);
      break;
    }

    // ── unban / FrutiScore userResult ──
    // Wire 'n' — no existing chat handler above, so handle here.
    case 'unban': {
      // FrutiScore userResult: <n rs="rk1,rk2,..." r="reqId"><u u="target"/></n>
      if (msg.attrs.rs !== undefined) {
        const rkList = String(msg.attrs.rs || '').split(',').map((s) => s.trim()).filter(Boolean);
        const reqId = msg.attrs.r || '';
        // Target user is carried as a <u u=".."/> child (per FrutizInfo.as:290-293).
        // Normalize to lowercase for score lookups (scores stored under lowercase keys).
        let targetUser = client.username || '';
        if (Array.isArray(msg.children)) {
          const uChild = msg.children.find((c) => c.tag === 'u' && c.attrs && c.attrs.u);
          if (uChild) targetUser = String(uChild.attrs.u).toLowerCase();
        }
        let inner = '';
        const debugParts = [];
        for (const rkAny of rkList) {
          const legacyDesc = legacyDescriptorFromRkLike(rkAny);
          // BKiwi rk '0': return today's daily challenge score/position
          // (matches rankingResult which also resolves '0' to today's challenge).
          if (rkAny === '0') {
            const dailyId = resolveInternalRankingId('0');
            const info = getUserScore(targetUser, dailyId);
            if (info.score > 0) {
              const tAttr = legacyDesc && legacyDesc.ty && legacyDesc.ty !== 'point' ? ` t="${escapeXml(legacyDesc.ty)}"` : '';
              inner += `<rk rk="0" p="${info.pos}" s="${info.score}"${tAttr} />`;
              debugParts.push(`0->${dailyId}:s=${info.score},p=${info.pos}`);
            } else {
              debugParts.push('0->none');
            }
            continue;
          }
          const internalId = resolveInternalRankingId(rkAny);
          if (!internalId) { debugParts.push(`${rkAny}->unresolved`); continue; }
          const info = getUserScore(targetUser, internalId);
          if (info.score <= 0 && info.pos <= 0) { debugParts.push(`${rkAny}->${internalId}:empty`); continue; }
          const rkOut = INTERNAL_TO_LEGACY_RK[internalId] || rkAny || internalId;
          const tAttr = legacyDesc && legacyDesc.ty && legacyDesc.ty !== 'point' ? ` t="${escapeXml(legacyDesc.ty)}"` : '';
          inner += `<rk rk="${escapeXml(rkOut)}" p="${info.pos}" s="${info.score}"${tAttr} />`;
          debugParts.push(`${rkAny}->${internalId}:s=${info.score},p=${info.pos}`);
        }
        const rAttr = reqId ? ` r="${escapeXml(String(reqId))}"` : '';
        if (!inner) {
          sendToClient(socket, buildLegacyUserResultPayload(targetUser, reqId));
        } else {
          sendToClient(socket, `<${CMD.unban}${rAttr} u="${escapeXml(getDisplayName(targetUser))}">${inner}</${CMD.unban}>`);
        }
        console.log(`[FSCORE] userResult user=${targetUser} rankings=[${rkList.join(',')}] results=[${debugParts.join(', ')}]`);
        break;
      }
      // Chat unban path (moderator lifts a ban) — not implemented yet.
      sendToClient(socket, `<${CMD.unban} k="0" />`);
      break;
    }

    // ── awardgame (ha): 3 medalists from yesterday for daily-reset games ──
    case 'awardgame': {
      const reqId = msg.attrs.r || '';
      const gameName = msg.attrs.g || '';
      const rAttr = reqId ? ` r="${escapeXml(String(reqId))}"` : '';
      let inner = '';
      let rkId = rankingIdForGame(gameName);
      if (rkId && !isDailyResetRanking(rkId)) {
        const challengeId = rankingIdForGame(gameName, 1);
        if (challengeId && isDailyResetRanking(challengeId)) rkId = challengeId;
      }
      if (rkId && isDailyResetRanking(rkId)) {
        const yesterday = yesterdayParisDayKey();
        const dayMedals = challengeMedalsData.medalsByVisibleDay[yesterday] || {};
        const game = (RANKINGS[rkId] && RANKINGS[rkId].game) || gameName;
        const podium = [];
        for (const [username, medals] of Object.entries(dayMedals)) {
          for (const m of medals) {
            if (m.game === game) podium.push({ u: username, rank: m.rank });
          }
        }
        podium.sort((a, b) => a.rank - b.rank);
        if (VERBOSE_FSCORE) console.log(`[FSCORE-DEBUG] awardgame g=${gameName} rkId=${rkId} game=${game} yesterday=${yesterday} podium=${JSON.stringify(podium)}`);
        if (podium.length > 0) {
          const byRank = {};
          for (const p of podium) byRank[p.rank] = p.u;
          for (let r = 1; r <= 3; r++) {
            const u = byRank[r] || '';
            inner += `<a v="${r}" u="${escapeXml(u ? getDisplayName(u) : '')}" d="1" />`;
          }
        }
      } else if (rkId) {
        const all = [];
        for (const [u, rlist] of Object.entries(scoresData.users || {})) {
          if (rlist && rlist[rkId] && Number.isFinite(Number(rlist[rkId].score))) {
            all.push({ u, s: Number(rlist[rkId].score), data: rlist[rkId].data });
          }
        }
        all.sort(scoreComparator(rkId));
        for (let i = 0; i < Math.min(3, all.length); i++) {
          inner += `<a v="${i + 1}" u="${escapeXml(all[i].u)}" d="1" />`;
        }
      }
      sendToClient(socket, `<${CMD.awardgame}${rAttr} g="${escapeXml(gameName)}">${inner}</${CMD.awardgame}>`);
      console.log(`[FSCORE] awardgame game=${gameName} ranking=${rkId || '-'} medalists=${inner ? inner.match(/<a /g).length : 0}`);
      break;
    }

    // ── awarduser (hb): list trophies/awards a user has earned ──
    case 'awarduser': {
      const reqId = msg.attrs.r || '';
      const targetUser = String(msg.attrs.u || client.username || '').toLowerCase();
      const rAttr = reqId ? ` r="${escapeXml(String(reqId))}"` : '';
      let inner = '';
      let allMedals = [];
      const medalDay = yesterdayParisDayKey();
      if (process.env.DATABASE_URL) {
        try { allMedals = await db.getMedalsForUserByDay(targetUser, medalDay); } catch (e) { /* ignore */ }
      }
      if (allMedals.length === 0) {
        const dayMedals = challengeMedalsData.medalsByVisibleDay[medalDay] || {};
        for (const m of (dayMedals[targetUser] || [])) {
          allMedals.push({ game: m.game, ranking_id: m.rankingId, rank: m.rank, medal: m.medal, awarded_day: medalDay });
        }
      }
      const seenMedalGame = new Set();
      for (const medal of allMedals) {
        if (seenMedalGame.has(medal.game)) continue;
        seenMedalGame.add(medal.game);
        const gameName = GAME_DISPLAY_NAMES[medal.game] || medal.game;
        const medalName = MEDAL_DISPLAY_NAMES[medal.medal] || medal.medal;
        inner += `<a g="${escapeXml(medal.game)}" n="${escapeXml(`Médaille ${medalName} - ${gameName} (${medal.awarded_day})`)}" v="${medal.rank}" d="1" />`;
      }
      sendToClient(socket, `<${CMD.awarduser}${rAttr} u="${escapeXml(getDisplayName(targetUser))}">${inner}</${CMD.awarduser}>`);
      const medalSummary = allMedals.map(m => `${m.game}:rank${m.rank}=${m.medal}`).join(',');
      console.log(`[FSCORE] awarduser user=${targetUser}: medals=${seenMedalGame.size} [${medalSummary}]`);
      break;
    }

    // ── fcardlist (ef): games for which a user has a public FrutiCard ──
    case 'fcardlist': {
      const reqId = msg.attrs.r || '';
      const targetUser = String(msg.attrs.u || client.username || '').toLowerCase();
      const rAttr = reqId ? ` r="${escapeXml(String(reqId))}"` : '';
      const uAttr = targetUser ? ` u="${escapeXml(getDisplayName(targetUser))}"` : '';

      // Always list all implemented games (except grapiz/bandas)
      let gameNodes = '';
      for (const gid of FCARD_GAMES) {
        gameNodes += `<g g="${escapeXml(gid)}" />`;
      }

      // Ensure in-memory slot cache is populated from DB for this user
      const tu = users[targetUser];
      if (tu && !tu.frutiSlots && tu._dbId) {
        try {
          const rows = await db.getAllFrutiSlot0(tu._dbId);
          if (rows && rows.length > 0) {
            tu.frutiSlots = {};
            for (const row of rows) {
              if (!tu.frutiSlots[row.game]) tu.frutiSlots[row.game] = {};
              tu.frutiSlots[row.game]['0'] = row.data;
            }
          }
        } catch (e) { /* ignore */ }
      }

      sendToClient(socket, `<${CMD.fcardlist}${rAttr}${uAttr}>${gameNodes}</${CMD.fcardlist}>`);
      break;
    }

    // ── fcardgetpublicslot (ea/fa): return public FrutiCard slot data ──
    case 'fcardgetpublicslot': {
      const reqId = msg.attrs.r || '';
      const game = msg.attrs.g || '';
      const targetUser = String(msg.attrs.u || client.username || '').toLowerCase();
      const rAttr = reqId ? ` r="${escapeXml(String(reqId))}"` : '';
      const gAttr = game ? ` g="${escapeXml(String(game))}"` : '';
      const uAttr = targetUser ? ` u="${escapeXml(getDisplayName(targetUser))}"` : '';
      let slotData = '';
      let ctx = null;
      const tu = users[targetUser];
      if (tu) {
        if (tu.frutiSlots && tu.frutiSlots[game] && tu.frutiSlots[game]['0']) {
          slotData = tu.frutiSlots[game]['0'];
        } else if (tu._dbId) {
          try {
            const dbSlots = await db.getFrutiSlots(tu._dbId, game);
            if (dbSlots && dbSlots['0']) {
              if (!tu.frutiSlots) tu.frutiSlots = {};
              tu.frutiSlots[game] = dbSlots;
              slotData = dbSlots['0'];
            }
          } catch (e) { /* ignore */ }
        }
      } else {
        // Offline user: load slot + score + gameItems from DB
        try {
          const row = await db.findUserByUsername(targetUser);
          if (row && row.id) {
            const [dbSlots, dbScores, dbGameItems] = await Promise.all([
              db.getFrutiSlots(row.id, game).catch(() => null),
              db.loadScoresForUser(row.id).catch(() => ({})),
              db.getUserGameItems(row.id).catch(() => []),
            ]);
            if (dbSlots && dbSlots['0']) slotData = dbSlots['0'];
            ctx = { gameItems: dbGameItems || [], scores: dbScores || {}, jamaPlayCount: 0 };
          }
        } catch (e) {
          console.log(`[FCARD] offline-load ERROR: ${e.message}`);
        }
      }
      try {
        slotData = patchSlot0(targetUser, game, slotData, ctx);
      } catch (e) {
        console.log(`[FCARD] patchSlot0 ERROR: ${e.message}`);
      }
      const mtData = jsonToMTSerial(slotData);
      console.log(`[FCARD] getPublicSlot user=${targetUser} game=${game} mt=${mtData.substring(0, 300)}`);
      sendToClient(socket, `<${msg.tag}${rAttr}${gAttr}${uAttr}>${mtData}</${msg.tag}>`);
      break;
    }

    // ── fcardlistslots (eb/fb): list available slots for a game ──
    case 'fcardlistslots': {
      const reqId = msg.attrs.r || '';
      const game = msg.attrs.g || '';
      const rAttr = reqId ? ` r="${escapeXml(String(reqId))}"` : '';
      const gAttr = game ? ` g="${escapeXml(String(game))}"` : '';
      const username = client.username || '';
      let slotNodes = '';
      if (username && users[username]) {
        const u = users[username];
        if (u.frutiSlots && u.frutiSlots[game]) {
          for (const sid of Object.keys(u.frutiSlots[game])) {
            slotNodes += `<s i="${escapeXml(sid)}"/>`;
          }
        } else if (u._dbId) {
          try {
            const dbSlots = await db.getFrutiSlots(u._dbId, game);
            if (Object.keys(dbSlots).length > 0) {
              if (!u.frutiSlots) u.frutiSlots = {};
              u.frutiSlots[game] = dbSlots;
              for (const sid of Object.keys(dbSlots)) {
                slotNodes += `<s i="${escapeXml(sid)}"/>`;
              }
            }
          } catch (e) { /* ignore */ }
        }
      }
      sendToClient(socket, `<${msg.tag}${rAttr}${gAttr}>${slotNodes}</${msg.tag}>`);
      console.log(`[FCARD] listSlots user=${username} game=${game} slots=${slotNodes || '(none)'}`);
      break;
    }

    // ── fcardloadslot (ec/fc): load a slot for a game ──
    case 'fcardloadslot': {
      const reqId = msg.attrs.r || '';
      const game = msg.attrs.g || '';
      const slotId = msg.attrs.s || '0';
      const rAttr = reqId ? ` r="${escapeXml(String(reqId))}"` : '';
      const gAttr = game ? ` g="${escapeXml(String(game))}"` : '';
      const sAttr = ` s="${escapeXml(String(slotId))}"`;
      let slotData = '';
      const username = client.username || '';
      if (username && users[username]) {
        const u = users[username];
        if (u.frutiSlots && u.frutiSlots[game] && u.frutiSlots[game][slotId] !== undefined) {
          slotData = u.frutiSlots[game][slotId];
        } else if (u._dbId) {
          try {
            const dbSlots = await db.getFrutiSlots(u._dbId, game);
            if (Object.keys(dbSlots).length > 0) {
              if (!u.frutiSlots) u.frutiSlots = {};
              u.frutiSlots[game] = dbSlots;
              if (dbSlots[slotId] !== undefined) slotData = dbSlots[slotId];
            }
          } catch (e) { /* ignore */ }
        }
        // Extract pictos from slot 0 on load
        if (slotId === '0' && slotData) {
          try { extractGameItemsFromSlot(username, game, slotData); } catch (e) { /* ignore */ }
        }
      }
      sendToClient(socket, `<${msg.tag}${rAttr}${gAttr}${sAttr}>${slotData}</${msg.tag}>`);
      console.log(`[FCARD] loadSlot user=${username} game=${game} slot=${slotId} len=${slotData.length}`);
      break;
    }

    // ── fcardupdateslot (ed/fd): save/update a slot for a game ──
    case 'fcardupdateslot': {
      const reqId = msg.attrs.r || '';
      const game = msg.attrs.g || '';
      const slotId = msg.attrs.s || '0';
      const rAttr = reqId ? ` r="${escapeXml(String(reqId))}"` : '';
      const gAttr = game ? ` g="${escapeXml(String(game))}"` : '';
      const sAttr = ` s="${escapeXml(String(slotId))}"`;
      const slotData = msg.content || '';
      const username = client.username || '';
      if (!username || !users[username]) {
        console.log(`[FCARD] updateSlot REJECTED (no auth) game=${game} slot=${slotId} len=${slotData.length} client.username="${username}" client.logged=${!!client.logged}`);
      }
      if (username && users[username]) {
        const u = users[username];
        if (!u.frutiSlots) u.frutiSlots = {};
        if (!u.frutiSlots[game]) u.frutiSlots[game] = {};
        const prevSlotData = u.frutiSlots[game][slotId];
        const WIRE_SAVE_GUARDED_GAMES = new Set(['miniwave', 'miniwave2']);
        if (
          WIRE_SAVE_GUARDED_GAMES.has(game) &&
          slotId === '0' &&
          prevSlotData &&
          slotData &&
          slotData.length < prevSlotData.length * 0.5
        ) {
          console.log(`[FCARD] save REJECTED (clobber guard) — new data (${slotData.length}) much smaller than existing (${prevSlotData.length}) for ${username}/${game}/slot${slotId}`);
          sendToClient(socket, `<${msg.tag}${rAttr}${gAttr}${sAttr}></${msg.tag}>`);
          break;
        }
        let normalizedSlotData = slotData;
        if (slotId === '0' && slotData && slotData.indexOf('|') >= 0 && slotData[0] !== '{') {
          if (game === 'miniwave' || game === 'miniwave2') {
            const obj = parseMiniwavePipe(slotData);
            if (obj) { normalizedSlotData = JSON.stringify(obj); }
          } else if (game === 'minipixiz' || game === 'minitroll') {
            const obj = parseMinipixizPipe(slotData);
            if (obj) { normalizedSlotData = JSON.stringify(obj); }
          } else if (game === 'mb2') {
            const obj = parseMb2Pipe(slotData);
            if (obj) { normalizedSlotData = JSON.stringify(obj); }
          }
        }
        // Mirror the /api/saveFrutiSlot MiniPixiz default-clobber guard on
        // the wire path: refuse a fresh-formatFruticard()-shaped save when
        // there is healthy progress in memory or in DB.
        if (
          (game === 'minipixiz' || game === 'minitroll') &&
          slotId === '0' &&
          normalizedSlotData &&
          looksLikeMinipixizDefault(normalizedSlotData)
        ) {
          let healthy = isMinipixizSlotHealthy(prevSlotData);
          if (!healthy && u._dbId) {
            try {
              const dbSlots = await db.getFrutiSlots(u._dbId, game);
              const dbSlot0 = dbSlots && (dbSlots['0'] || dbSlots[0]);
              if (isMinipixizSlotHealthy(dbSlot0)) {
                healthy = true;
                u.frutiSlots[game]['0'] = dbSlot0;
              }
            } catch (e) {
              console.error(`[FCARD] DB clobber-guard lookup failed for ${username}/${game}: ${e.message}`);
            }
          }
          if (healthy) {
            console.log(`[FCARD] BLOCKED minipixiz default-clobber for ${username} (wire path, existing progress preserved)`);
            sendToClient(socket, `<${msg.tag}${rAttr}${gAttr}${sAttr}></${msg.tag}>`);
            break;
          }
        }
        u.frutiSlots[game][slotId] = normalizedSlotData;
        if (u._dbId) {
          db.upsertFrutiSlot(u._dbId, game, Number(slotId), normalizedSlotData).catch((e) => {
            console.error(`[FCARD] DB upsert FAILED for ${username}/${game}/slot${slotId}: ${e.message}`);
          });
        }
        if (slotId === '0' && normalizedSlotData) {
          try { extractGameItemsFromSlot(username, game, normalizedSlotData); } catch (e) {
            console.error(`[FCARD] item extraction failed for ${username}/${game}: ${e.message}`);
          }
        }
        // BKiwi: capture the track the player just raced (slot 0 savePublic
        // always runs before saveScore) for per-track ranking routing.
        if (game === 'bkiwi' && slotId === '0') {
          const t = detectBkiwiTrackFromSlotDiff(prevSlotData || '', slotData);
          if (t !== null) {
            u.bkiwiCurrentTrack = t;
            console.log(`[FCARD] bkiwi current track for ${username} = ${t}`);
          } else {
            const prevPreview = String(prevSlotData || '').slice(0, 300);
            const newPreview = String(slotData || '').slice(0, 300);
            console.log(`[FCARD] bkiwi track detection FAILED for ${username}`);
            console.log(`[FCARD]   prev: ${prevPreview}`);
            console.log(`[FCARD]   new:  ${newPreview}`);
          }
        }
      }
      sendToClient(socket, `<${msg.tag}${rAttr}${gAttr}${sAttr}></${msg.tag}>`);
      const preview = slotData.length > 120 ? slotData.slice(0, 120) + '…' : slotData;
      console.log(`[FCARD] updateSlot user=${username} game=${game} slot=${slotId} len=${slotData.length}: ${preview}`);
      break;
    }

    // ── fcardclearslot (ee/fe): clear a slot ──
    case 'fcardclearslot': {
      const reqId = msg.attrs.r || '';
      const game = msg.attrs.g || '';
      const slotId = msg.attrs.s || '0';
      const rAttr = reqId ? ` r="${escapeXml(String(reqId))}"` : '';
      sendToClient(socket, `<${msg.tag}${rAttr}></${msg.tag}>`);
      console.log(`[FCARD] clearSlot user=${client.username || '?'} game=${game} slot=${slotId}`);
      break;
    }

    // ── refuse (x): chat invite refusal / FrutiScore giveItem ──
    case 'refuse': {
      // FrutiScore giveItem: wire 'x' with item name (i= attribute or content).
      // Chat refuse: wire 'x' with u= and g= attributes (invite rejection).
      if (msg.attrs.u && msg.attrs.g) {
        // Chat invite refusal — no-op, just acknowledge silently.
        break;
      }
      // Treat as FrutiScore giveItem. Try every attribute we've seen the
      // compiled GameClient use (i, n, t, item, name, c) plus inner content.
      let itemName = msg.attrs.i || msg.attrs.n || msg.attrs.t || msg.attrs.item || msg.attrs.name || msg.attrs.c || msg.content || '';
      // Some implementations wrap the item in a child <i name="$xxx"/>
      if (!itemName && Array.isArray(msg.children) && msg.children.length > 0) {
        const c0 = msg.children[0];
        if (c0 && c0.attrs) itemName = c0.attrs.n || c0.attrs.name || c0.attrs.i || c0.content || '';
      }
      itemName = String(itemName || '').trim();
      // MiniPixiz giveItem names use $item_N, $food_N, $diam_N — normalize to $pixiz_* convention
      const itemMatch = itemName.match(/^\$item_(\d+)$/);
      if (itemMatch) itemName = `$pixiz_item${Number(itemMatch[1]) - 1}`;
      const foodMatch = itemName.match(/^\$food_(\d+)$/);
      if (foodMatch) itemName = `$pixiz_food${299 + Number(foodMatch[1])}`;
      const diamMatch = itemName.match(/^\$diam_(\d+)$/);
      if (diamMatch) itemName = `$pixiz_diam${Number(diamMatch[1]) + 1}`;
      console.log(`[FSCORE] giveItem RECEIVED user="${client.username || ''}" item="${itemName}" attrs=${JSON.stringify(msg.attrs)} content="${msg.content || ''}" children=${JSON.stringify(msg.children || [])}`);
      if (!itemName || !client.username) {
        console.log(`[FSCORE] giveItem REJECTED: no item name or user`);
        break;
      }
      const user = users[client.username];
      if (!user) break;
      if (!Array.isArray(user.gameItems)) user.gameItems = [];
      if (!user.gameItems.includes(itemName)) {
        user.gameItems.push(itemName);
        const dbId = user._dbId;
        if (dbId) db.addGameItem(dbId, itemName).catch((e) => console.error('[DB] addGameItem error:', e.message));
        console.log(`[FSCORE] giveItem user=${client.username} item=${itemName} total=${user.gameItems.length}`);
        const info = GAME_ITEM_INFO[itemName];
        const label = info ? info.name : itemName;
        const gameName = info ? info.game : 'jeu';
        addAndNotifyUserLog(client.username, { type: USER_LOG_TYPE.PICTO, content: `Nouveau picto débloqué sur ${gameName} : ${label} !` });
      } else {
        console.log(`[FSCORE] giveItem user=${client.username} item=${itemName} (already owned)`);
      }
      break;
    }

    default: {
      console.log(`[CBee]  Unhandled command: ${cmdName} (${msg.tag})`);
      break;
    }
  }
}

// ─────────────────────────────────────────────
// Start XMLSocket TCP server
// ─────────────────────────────────────────────
const xmlSocketServer = net.createServer((socket) => {
  console.log(`[CBee]  Client connected from ${socket.remoteAddress}`);

  xmlSocketClients.set(socket, {
    sid: null,
    username: null,
    logged: false,
    channels: new Set(),
    buffer: '',
    selectedDt: '',
  });

  // Don't auto-send IP here — let the SWF request it via FPCBee.onConnect.
  // Sending data before Ruffle's XMLSocket.onConnect fires causes data loss.

  socket.on('data', (data) => {
    const client = xmlSocketClients.get(socket);
    if (!client) return;

    // Accumulate data in buffer, split on \0
    client.buffer += data.toString('utf8');
    const parts = client.buffer.split('\0');
    // Last part is incomplete — keep in buffer
    client.buffer = parts.pop();

    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed.length === 0) continue;

      // Handle Flash socket policy request
      if (trimmed.includes('<policy-file-request')) {
        const policy = '<?xml version="1.0"?>'
          + '<cross-domain-policy>'
          + '<allow-access-from domain="*" to-ports="*" />'
          + '</cross-domain-policy>';
        sendToClient(socket, policy);
        continue;
      }

      try {
        handleCBeeMessage(socket, trimmed).catch((e) => {
          console.error(`[CBee]  Async error handling message: ${e.message}`);
        });
      } catch (e) {
        console.error(`[CBee]  Error handling message: ${e.message}`);
      }
    }
  });

  socket.on('close', () => {
    const client = xmlSocketClients.get(socket);
    if (client) {
      // Remove from all channels
      for (const g of client.channels) {
        if (channels[g]) {
          channels[g].users.delete(client.username);
          broadcastToChannel(g,
            `<${CMD.userleaved} g="${g}" u="${escapeXml(getDisplayName(client.username))}" />`
          );
        }
      }
      // If this was a game socket (FrutiScore startGame had been received),
      // clear the game icon on the user's chat sockets so the presence dot
      // comes back. The chat socket is the one with channels.
      const wasGameSocket = client.currentGame &&
        (!client.channels || client.channels.size === 0);
      // Resolve the username — game sockets may have authenticated via SID
      const disconnectUser = client.username ||
        (client.sid && sessions[client.sid] && sessions[client.sid].user) || null;
      if (wasGameSocket && disconnectUser) {
        xmlSocketClients.delete(socket);
        setUserInternalStatus(disconnectUser, 0);
      } else {
        xmlSocketClients.delete(socket);
      }
      // Clean up trace subscriptions this socket held
      unsubscribeAllTrace(socket);
      // Notify anyone subscribed to this user's presence (they may now be offline)
      if (disconnectUser) {
        const stillOnline = getSocketsForUsername(disconnectUser).length > 0;
        if (!stillOnline) {
          notifyTraceSubscribers(disconnectUser);
        }
      }
      console.log(`[CBee]  Client disconnected: ${disconnectUser || 'anonymous'}`);
    } else {
      xmlSocketClients.delete(socket);
      unsubscribeAllTrace(socket);
    }
  });

  socket.on('error', (err) => {
    console.error(`[CBee]  Socket error: ${err.message}`);
    xmlSocketClients.delete(socket);
  });

  // Flash XMLSocket requires a policy response if the client sends <policy-file-request/>
  // We handle this inline in the message handler
});

xmlSocketServer.listen(XMLSOCKET_PORT, () => {
  console.log(`[CBee]  XMLSocket server running on port ${XMLSOCKET_PORT}`);
});
