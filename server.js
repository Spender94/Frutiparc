const express = require('express');
const { WebSocketServer } = require('ws');
const net = require('net');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const fontsPath = path.join(__dirname, 'legacy', 'fonts.swf');



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

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Ruffle's LoadVars.sendAndLoad may send POST bodies as text/plain or
// with no Content-Type at all. Capture any unparsed body as raw text.
app.use(express.text({ type: '*/*' }));
app.use((req, res, next) => {
  if (typeof req.body === 'string' && req.body.includes('=')) {
    const parsed = Object.fromEntries(new URLSearchParams(req.body));
    req.body = parsed;
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
  '$photo08':    { name: 'Photo Piment',        game: 'Swapou', gif: 'Games/swapou2/images/titems/item_piment.gif' },
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
  // MiniWave2
  '$ship00':     { name: 'Vaisseau 0',          game: 'MiniWave', gif: 'Games/miniWave2/titem/gif/ship00.gif' },
  '$ship01':     { name: 'Vaisseau 1',          game: 'MiniWave', gif: 'Games/miniWave2/titem/gif/ship01.gif' },
  '$ship02':     { name: 'Vaisseau 2',          game: 'MiniWave', gif: 'Games/miniWave2/titem/gif/ship02.gif' },
  '$ship03':     { name: 'Vaisseau 3',          game: 'MiniWave', gif: 'Games/miniWave2/titem/gif/ship03.gif' },
  '$ship04':     { name: 'Vaisseau 4',          game: 'MiniWave', gif: 'Games/miniWave2/titem/gif/ship04.gif' },
  '$ship05':     { name: 'Vaisseau 5',          game: 'MiniWave', gif: 'Games/miniWave2/titem/gif/ship05.gif' },
  '$arcade':     { name: 'Arcade Boss',         game: 'MiniWave', gif: 'Games/miniWave2/titem/pictoBoss.gif' },
};

// Build MiniWave2 bads (bad00..bad50) and missions (mis0..mis4)
for (let i = 0; i <= 50; i++) {
  const pad = String(i).padStart(2, '0');
  GAME_ITEM_INFO[`$bads${i}`] = { name: `Monstre ${i}`, game: 'MiniWave', gif: `Games/miniWave2/titem/gif/bad${pad}.gif` };
}
for (let i = 0; i <= 4; i++) {
  GAME_ITEM_INFO[`$mis${i}`] = { name: `Mission ${i}`, game: 'MiniWave', gif: `Games/miniWave2/titem/gif/mis${i}.gif` };
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
const LOGIN_PAGE_PATH = path.join(__dirname, 'public', 'login.html');
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
const RANKINGS = {
  bkiwi_classic:    { name: 'Burning Kiwi - Classique', game: 'bkiwi',    type: 'C', lowerIsBetter: true },
  snake3_classic:   { name: 'Frutisnake - Classique',  game: 'snake3',   type: 'C' },
  kaluga_classic:   { name: 'Kaluga - Classique',      game: 'kaluga',   type: 'C' },
  swapou2_classic:  { name: 'Swapou - Classique',      game: 'swapou2',  type: 'C' },
  miniwave2_classic:{ name: 'MiniWave - Classique',    game: 'miniwave2',type: 'C' },
  bkiwi_challenge:    { name: 'Burning Kiwi - Challenge', game: 'bkiwi',    type: 'L', lowerIsBetter: true },
  snake3_challenge:   { name: 'Frutisnake - Challenge',   game: 'snake3',   type: 'L' },
  kaluga_challenge:   { name: 'Kaluga - Challenge',       game: 'kaluga',   type: 'L' },
  swapou2_challenge:  { name: 'Swapou - Challenge',       game: 'swapou2',  type: 'L' },
  miniwave2_challenge:{ name: 'MiniWave - Challenge',     game: 'miniwave2',type: 'L' },
  bandas_challenge:   { name: 'Frutibandas - Challenge',  game: 'bandas',   type: 'L' },
  grapiz_challenge:   { name: 'Grapiz - Challenge',       game: 'grapiz',   type: 'L' },
};

// Legacy FrutiScore wire descriptors (numeric rk ids used by original clients).
const LEGACY_RANKINGS = [
  // Section C = "Challenge" in front-end
  { rk: '0', internal: 'bkiwi_classic',    ty: 'millisecond', rn: 'Burning kiwi', gs: '0', g: 'bkiwi',  section: 'C' },
  { rk: '1', internal: 'snake3_classic',   ty: 'point',       rn: 'Frutisnake 2', gs: '1', g: 'snake3', section: 'C' },
  { rk: '2', internal: null,               ty: 'ptmb2',       rn: 'Motion Ball 2',gs: '2', g: 'mb2',    section: 'C' },
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
const INTERNAL_TO_LEGACY_RK = Object.fromEntries(
  LEGACY_RANKINGS.filter((r) => r.internal).map((r) => [r.internal, r.rk])
);
const HARDCODED_FRUTIZ = {
  DebugBot: { x: 1337, f: '000000010000000000000000' },
};

function hardcodedMeAttrs(name) {
  const d = HARDCODED_FRUTIZ[String(name || '')] || HARDCODED_FRUTIZ.DebugBot;
  return `x="${d.x}" f="${escapeXml(d.f)}"`;
}

function resolveInternalRankingId(rkLike) {
  const raw = String(rkLike || '').trim();
  if (!raw) return null;
  if (RANKINGS[raw]) return raw;
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
  const u = escapeXml(String(user || 'DebugBot'));
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

function formatRankingExtraData(rankingId, rawData) {
  const raw = String(rawData || '').trim();
  if (!raw) {
    if (rankingId === 'bkiwi_classic') return 'Skiwix:5:1:';
    if (rankingId === 'swapou2_classic') return 'S0:';
    if (rankingId === 'kaluga_classic') return 'Skaluga:';
    return '';
  }

  if (rankingId === 'bkiwi_classic') {
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
  const direct = `${key}_${suffix}`;
  if (RANKINGS[direct]) return direct;
  // Accept Frutiparc disc uids directly (kaluga1, snake3, swapou1, miniwave1).
  const directDisc = GAME_DISCS && GAME_DISCS[key];
  if (directDisc && directDisc.swfName) {
    const via = `${String(directDisc.swfName).toLowerCase()}_${suffix}`;
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

    if (swfName && RANKINGS[`${swfName}_${suffix}`]) {
      for (const p of filePaths) {
        const pathVariants = [
          p,
          `/${p}`,
          `swf/${p}`,
          `/swf/${p}`,
        ];
        if (pathVariants.some((v) => normalizedCandidates.has(v))) {
          return `${swfName}_${suffix}`;
        }
        // Check if input matches a directory segment of the game path
        // (e.g. input='burningKiwi' matches 'games/burningKiwi/burningkiwi.swf')
        const segs = p.split('/').filter(Boolean);
        if (segs.some((seg) => normalizedCandidates.has(seg.toLowerCase()))) {
          return `${swfName}_${suffix}`;
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

function scoreComparator(rankingId) {
  return isLowerBetter(rankingId) ? (a, b) => a.s - b.s : (a, b) => b.s - a.s;
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
  const scoreImproved = isLowerBetter(rankingId) ? (oldScore === 0 || n < oldScore) : (n > oldScore);
  const shouldBackfillData = !oldData && !!newData && n === oldScore;
  if (scoreImproved || shouldBackfillData) {
    scoresData.users[username][rankingId] = {
      score: scoreImproved ? n : oldScore,
      data: newData || oldData,
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
      all.push({ u, s: Number(rlist[rankingId].score) });
    }
  }
  all.sort(scoreComparator(rankingId));
  const idx = all.findIndex((e) => e.u === username);
  return idx < 0 ? 0 : idx + 1;
}

function getUserScore(username, rankingId) {
  const ud = scoresData.users[username];
  if (!ud || !ud[rankingId]) return { score: 0, pos: 0 };
  return { score: Number(ud[rankingId].score) || 0, pos: computePosition(rankingId, username) };
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
    isModerator: true,
    needsBouille: true, // Force editbouille on first login
    kikoozLog: [],      // Entries displayed in box.KikoozLog (/ft/log)
    userLog: [],        // Entries displayed in "Mon historique" (/do/onident <ul>)
    siteLog: [],        // Entries displayed in "Evènements" (/do/onident <sl>)
    mails: [],          // Internal mailbox; each entry: {uid, from, fromAddr, to, toAddrs, subject, body, folder, date, read}
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
    needsBouille: row.needs_bouille !== false,
    firstName: row.first_name || '',
    lastName: row.last_name || '',
    lastNamePublic: row.last_name_public || 'Y',
    realJob: row.real_job || '',
    city: row.city || '',
    countryIndex: row.country_index || '1',
    regionIndex: row.region_index || '1',
    departmentIndex: row.department_index || '1',
    siteUrl: row.site_url || '',
    comment: row.comment || '',
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
  const [items, accs, dbScores, dbContacts, dbBlacklist, dbMails, dbGameItems] = await Promise.all([
    db.getUserItems(dbUser.id),
    db.getUserAccessories(dbUser.id),
    db.loadScoresForUser(dbUser.id),
    db.getContacts(dbUser.id),
    db.getBlacklist(dbUser.id),
    db.getMailsForUser(dbUser.id).catch(() => []),
    db.getUserGameItems(dbUser.id).catch(() => []),
  ]);

  if (items.length > 0) users[username].items = withDefaultPens(items);
  if (accs.length > 0) users[username].customAccessories = accs;
  if (dbGameItems.length > 0) users[username].gameItems = dbGameItems;
  users[username].contacts = Array.isArray(dbContacts) ? dbContacts : [];
  users[username].blacklist = Array.isArray(dbBlacklist) ? dbBlacklist : [];
  users[username].mails = Array.isArray(dbMails) ? dbMails : [];

  // Extract pictos from existing slot 0 data (backfill for users who played before this feature)
  try {
    const allSlot0 = await db.getAllFrutiSlot0(dbUser.id);
    for (const row of allSlot0) {
      try { extractGameItemsFromSlot(username, row.game, row.data); } catch (e) { /* ignore */ }
    }
  } catch (e) { /* ignore */ }

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
}

function buildUserLogXml(entries) {
  const list = Array.isArray(entries) ? entries : [];
  return list.map((e) => {
    const d = escapeXml(e && e.d ? e.d : '');
    const t = Number(e && e.t);
    const c = escapeXml(e && e.c ? e.c : '');
    const n = (e && Number(e.n) === 1) ? ' n="1"' : '';
    return `<l d="${d}" t="${Number.isFinite(t) && t > 0 ? t : 1}"${n}>${c}</l>`;
  }).join('');
}

// Daily-reset rankings = rankings displayed in the front-end "Challenge"
// tab (section C of LEGACY_RANKINGS).  Internally these IDs end with
// "_classic" (the suffix used when a user plays in default mode).
// Note: section L = "Championnat" in front-end; those rankings (currently
// only bandas_challenge and grapiz_challenge) are NOT reset daily.
const DAILY_RESET_RANKING_SET = new Set(
  LEGACY_RANKINGS.filter(r => r.section === 'C' && r.internal).map(r => r.internal)
);

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
      all.push({ u, s: Number(rlist[rankingId].score) });
    }
  }
  all.sort(scoreComparator(rankingId));
  return all.slice(0, 3);
}

const GAME_DISPLAY_NAMES = {
  bkiwi: 'Burning Kiwi', snake3: 'Frutisnake', kaluga: 'Kaluga',
  swapou2: 'Swapou', miniwave2: 'MiniWave',
  bandas: 'Frutibandas', grapiz: 'Grapiz',
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
        addUserHistoryEntry(user, { type: 1, content: text, flNew: true });
      } else {
        if (!challengeMedalsData.pendingNotifications[username]) {
          challengeMedalsData.pendingNotifications[username] = [];
        }
        challengeMedalsData.pendingNotifications[username].push({ type: 1, content: text });
      }
      if (user && user._dbId) {
        db.saveMedal(user._dbId, username, m.rankingId, m.game, m.rank, m.medal, visibleDay).catch(() => {});
      } else if (process.env.DATABASE_URL) {
        db.findUserByUsername(username).then((row) => {
          if (row) db.saveMedal(row.id, username, m.rankingId, m.game, m.rank, m.medal, visibleDay).catch(() => {});
        }).catch(() => {});
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
    xml += `<m u="${escapeXml(p.u)}" r="${p.rank}" f="${escapeXml(bouilleOf(ud, p.u))}" />`;
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
  return /^[a-z0-9_]{3,20}$/.test(username);
}

function isValidPassword(password) {
  return typeof password === 'string' && password.length >= 6 && password.length <= 80;
}

function isDebugNotUser(username) {
  return String(username || '').toLowerCase() === 'debugnot';
}

function getFrutizJob(username, user) {
  if (isDebugNotUser(username)) return 'Frutiz';
  if (user && user.isModerator) return 'Modérateur';
  return 'Frutiz';
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

function buildMailElementXml(mail) {
  const desc = encodeMailDesc(mail);
  const access = mail.read ? '1' : '0';
  return `<e u="${escapeXml(mail.uid)}" t="mail" s="${desc.length}" d="${escapeXml(mail.date || '')}" a="${access}">${escapeXml(desc)}</e>`;
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
      {
    id: 104,
    name: 'Casquette Anim',
    category: 'Accessoires',
    price: 20,
    description: 'Pour faire régner la loi dans les contrées de Legumia. Un classique indémodable de la panoplie du justicier.',
    suffix9: '30y0t0j00',
    comment: 'Édition test',
  },
  // Wallpapers
  { id: 201, name: 'Chevalier moutarde',    category: "Fonds d'écran", price: 0, description: 'Un fond chevaleresque aux tons moutarde.',     suffix9: '000000000', wallpaperId: 'moutarde' },
  { id: 202, name: 'Chorale Frutiparc',     category: "Fonds d'écran", price: 0, description: 'La grande chorale de Frutiparc !',             suffix9: '000000000', wallpaperId: 'chorale' },
  { id: 203, name: 'Noël Pixiz',            category: "Fonds d'écran", price: 0, description: 'Ambiance de Noël avec les Pixiz.',              suffix9: '000000000', wallpaperId: 'pixizchristmas' },
  { id: 204, name: 'Noël Frutisnake',       category: "Fonds d'écran", price: 0, description: 'Frutisnake en mode fêtes de fin d\'année.',     suffix9: '000000000', wallpaperId: 'snakechristmas' },
  { id: 205, name: 'Mini-Pixiz',            category: "Fonds d'écran", price: 0, description: 'Les petits Pixiz en action.',                   suffix9: '000000000', wallpaperId: 'pixiz' },
  { id: 206, name: 'Mini-Wave Nostromo',    category: "Fonds d'écran", price: 0, description: 'Le vaisseau Nostromo de Mini-Wave.',             suffix9: '000000000', wallpaperId: 'nostromo' },
  { id: 207, name: 'Mini-Wave Mini-Star',   category: "Fonds d'écran", price: 0, description: 'La planète Mini-Star de Mini-Wave.',             suffix9: '000000000', wallpaperId: 'ministar' },
  { id: 208, name: 'Utopiz',                category: "Fonds d'écran", price: 0, description: 'Le monde coloré d\'Utopiz.',                    suffix9: '000000000', wallpaperId: 'utopiz' },
];
const SHOP_PACKS = [...SHOP_PACKS_DEFAULT];

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
  const alreadyBuy = userOwnsShopPack(user, pack.id) ? '1' : '0';
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
    `<d>${escapeXml(pack.description)}</d>` +
    `<r p="${pack.price}">${escapeXml(pack.comment || '')}</r>` +
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
    <f u="inbox" n="Boîte de réception" t="inbox" />
    <f u="outbox" n="Messages envoyés" t="outbox" />
    <f u="blackbox" n="Spams" t="blackbox" />
    <f u="draftbox" n="Brouillons" t="draftbox" />
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
    return res.redirect('/login');
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
  res.sendFile(LOGIN_PAGE_PATH);
});

app.get('/', (req, res) => {
  res.sendFile(LOGIN_BIS_PAGE_PATH);
});

app.post('/api/auth/register', async (req, res) => {
  const username = normalizeUsername(req.body && req.body.username);
  const password = String((req.body && req.body.password) || '');

  if (!isValidUsername(username)) {
    return res.status(400).json({ ok: false, error: 'username_invalid', message: 'Username: 3-20 chars [a-z0-9_].' });
  }
  if (!isValidPassword(password)) {
    return res.status(400).json({ ok: false, error: 'password_invalid', message: 'Password: 6-80 chars.' });
  }
  if (users[username]) {
    return res.status(409).json({ ok: false, error: 'user_exists', message: 'Username already taken.' });
  }

  try {
    const dbUser = await db.createUser(username, password);
    if (!dbUser) {
      return res.status(409).json({ ok: false, error: 'user_exists', message: 'Username already taken.' });
    }
    users[username] = createDefaultUser(password);
    users[username]._dbId = dbUser.id;
    await db.setUserItems(dbUser.id, users[username].items);
    return res.json({ ok: true, username });
  } catch (e) {
    console.error('[DB] register error:', e.message);
    users[username] = createDefaultUser(password);
    return res.json({ ok: true, username });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const username = normalizeUsername(req.body && req.body.username);
  const password = String((req.body && req.body.password) || '');

  try {
    const dbUser = await db.findUserByUsername(username);
    if (dbUser) {
      if (dbUser.password !== password) {
        return res.status(401).json({ ok: false, error: 'invalid_credentials', message: 'Invalid username or password.' });
      }
      if (!users[username]) {
        await hydrateUserFromDb(username, dbUser);
      }
      users[username]._dbId = dbUser.id;
      applyPendingChallengeNotifications(username, users[username]);
    } else {
      const user = users[username];
      if (!user || user.pass !== password) {
        return res.status(401).json({ ok: false, error: 'invalid_credentials', message: 'Invalid username or password.' });
      }
      applyPendingChallengeNotifications(username, user);
    }
  } catch (e) {
    console.error('[DB] login lookup error:', e.message);
    const user = users[username];
    if (!user || user.pass !== password) {
      return res.status(401).json({ ok: false, error: 'invalid_credentials', message: 'Invalid username or password.' });
    }
  }

  const sid = crypto.randomBytes(16).toString('hex');
  sessions[sid] = { user: username, createdAt: Date.now() };
  const userId = users[username] && users[username]._dbId;
  if (userId) {
    db.createSession(sid, userId).catch((e) => console.error('[DB] session save error:', e.message));
  }
  return res.json({ ok: true, sid, username, redirect: `/legacy?sid=${encodeURIComponent(sid)}` });
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

  const rankingId = rankingIdForGame(gameName, mode);
  if (!rankingId) {
    return res.status(400).json({ ok: false, error: 'unknown_game', game: gameName });
  }

  const result = persistScore(username, rankingId, scoreVal, scoreData);
  console.log(`[HTTP]  saveScore ${username} ${rankingId} ${scoreVal} updated=${result.updated}`);
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
const ADMIN_KEY = process.env.ADMIN_KEY || 'sorbetcitron';
function adminAuth(req, res, next) {
  if (ADMIN_KEY) {
    const k = req.headers['x-admin-key'] || req.query.key || '';
    if (k !== ADMIN_KEY) return res.status(403).json({ ok: false, error: 'forbidden' });
  }
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
    res.json({ user: row, items, accessories: accs, scores });
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
    if (body.password !== undefined) fields.password = body.password;
    if (body.is_moderator !== undefined) fields.is_moderator = !!body.is_moderator;
    if (Object.keys(fields).length > 0) {
      await db.updateUser(u, fields);
      if (users[u]) {
        Object.assign(users[u], fields);
        if (fields.is_moderator !== undefined) users[u].isModerator = fields.is_moderator;
      }
    }
    console.log(`[ADMIN] Updated user ${u}: ${Object.keys(fields).join(', ')}`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
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

// Admin: list user's game items
app.get('/api/admin/users/:username/gameitems', adminAuth, async (req, res) => {
  const user = users[req.params.username];
  if (!user) return res.status(404).json({ error: 'not found' });
  res.json(Array.isArray(user.gameItems) ? user.gameItems : []);
});

// Admin: add a game item to a user
app.post('/api/admin/users/:username/gameitems', adminAuth, async (req, res) => {
  const username = req.params.username;
  const user = users[username];
  if (!user) return res.status(404).json({ error: 'not found' });
  const itemName = String(req.body.itemName || '').trim();
  if (!itemName) return res.status(400).json({ error: 'missing itemName' });
  if (!Array.isArray(user.gameItems)) user.gameItems = [];
  if (!user.gameItems.includes(itemName)) {
    user.gameItems.push(itemName);
    const dbId = user._dbId;
    if (dbId) await db.addGameItem(dbId, itemName).catch(() => {});
  }
  res.json({ ok: true, gameItems: user.gameItems });
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
        all.push({ u, s: Number(rlist[rkId].score) });
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
        all.push({ u, s: Number(rlist[rkId].score) });
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
      byRanking[r.ranking_id].push({ u: r.username, s: Number(r.score) });
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

  console.log(`[ADMIN] Delete event ${id} → removed from ${removed} users (siteLog). Connected users see deletion on next login.`);
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

function extractGameItemsFromSlot(username, game, dataStr) {
  let parsed;
  try { parsed = JSON.parse(dataStr); } catch { return; }
  if (!parsed || typeof parsed !== 'object') return;
  const user = users[username];
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
  } else if (game === 'miniwave') {
    // MiniWave2: $ship array, $badsKill array (kill counts ≥ limit → item)
    const ship = parsed.$ship;
    if (Array.isArray(ship)) {
      for (let i = 0; i < ship.length; i++) {
        if (ship[i]) addIfNew('$ship0' + i);
      }
    }
    const badsKill = parsed.$badsKill;
    if (Array.isArray(badsKill)) {
      for (let i = 0; i < badsKill.length; i++) {
        if (badsKill[i] && badsKill[i] >= 1) addIfNew('$bads' + i);
      }
    }
    if (parsed.$arcade && parsed.$arcade.$bestLevel > 0) addIfNew('$arcade');
  }

  if (newItems.length > 0) {
    const dbId = user._dbId;
    if (dbId) {
      for (const item of newItems) {
        db.addGameItem(dbId, item).catch((e) => console.error('[DB] addGameItem:', e.message));
      }
    }
    console.log(`[SLOT]  extracted ${newItems.length} new pictos for ${username}/${game}: ${newItems.join(', ')}`);
  }
}

app.post('/api/saveFrutiSlot', (req, res) => {
  const params = Object.assign({}, req.query || {}, req.body || {});
  const sid = String(params.sid || '');
  const game = String(params.game || '');
  const slotId = String(params.slotId || '0');
  const data = String(params.data || '');

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
  users[username].frutiSlots[game][slotId] = data;
  const dbId = users[username] && users[username]._dbId;
  if (dbId) db.upsertFrutiSlot(dbId, game, Number(slotId), data).catch(() => {});

  // Extract game items (pictos/titems) from slot 0 data
  if (slotId === '0' && data) {
    try { extractGameItemsFromSlot(username, game, data); } catch (e) {
      console.log(`[SLOT]  item extraction error for ${game}: ${e.message}`);
    }
  }

  const preview = data.length > 200 ? data.slice(0, 200) + '…' : data;
  console.log(`[SLOT]  save ${username}/${game}/slot${slotId} (${data.length} chars): ${preview}`);
  res.type('text/plain').send('ok=1');
});

// ─────────────────────────────────────────────
// ENDPOINT: /api/loadFrutiSlots — Load all FrutiCard slots for a game.
// Returns LoadVars format: slot0=<json>&slot1=<json>&slot2=<json>
// ─────────────────────────────────────────────
app.post('/api/loadFrutiSlots', async (req, res) => {
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
        } catch (e) { /* ignore */ }
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

    if (users[username].frutiSlots && users[username].frutiSlots[game]) {
      const slots = users[username].frutiSlots[game];
      // Extract pictos from slot 0 on load (catches items from before this feature existed)
      if (slots['0']) {
        try { extractGameItemsFromSlot(username, game, slots['0']); } catch (e) {
          console.log(`[SLOT]  load-extract error for ${game}: ${e.message}`);
        }
      }
      for (const [key, val] of Object.entries(slots)) {
        response += `&slot${key}=${encodeURIComponent(val)}`;
      }
    }
  }
  // Log the slot keys + first chars of each value so we can see what the
  // game has saved (or hasn't) when diagnosing missing-character issues.
  const slotKeys = (username && users[username] && users[username].frutiSlots && users[username].frutiSlots[game])
    ? Object.keys(users[username].frutiSlots[game]) : [];
  console.log(`[SLOT]  load sid=${sid} user=${username || '(none)'} game=${game} slots=[${slotKeys.join(',')}] respLen=${response.length}`);
  if (slotKeys.length) {
    for (const k of slotKeys) {
      const v = users[username].frutiSlots[game][k];
      const prev = String(v).length > 200 ? String(v).slice(0, 200) + '…' : v;
      console.log(`[SLOT]    slot${k}=${prev}`);
    }
  }
  res.type('text/plain').send(response);
});

app.get('/legacy/main.swf', (req, res) => {
  res.sendFile(path.join(__dirname, 'legacy', 'main.swf'));
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
    if (dbId) db.updateUser(session.user, { prefs: req.query.s || '' }).catch(() => {});
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
  return source.sid || source.c || '';
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
  if (auth.user._dbId) db.updateUser(auth.username, { fbouille: bouille, needs_bouille: false }).catch(() => {});

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
  if (user._dbId) db.updateUser(username, { kikooz: user.kikooz }).catch(() => {});
  if (target._dbId) db.updateUser(targetName, { kikooz: target.kikooz }).catch(() => {});

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
  if (user._dbId) db.addAccessory(user._dbId, entry).catch(() => {});

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
    }).catch(() => {});
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
        if (user._dbId) db.updateUser(session.user, { prefs: user.prefs }).catch(() => {});
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
  // Families 0-8 are the main customizable parts (capuche, yeux, bouche, etc.)
  const fAttr = user.needsBouille ? ' f="0,1,2,3,4,5,6,7,8"' : '';
  if (user.needsBouille) {
    user.needsBouille = false; // Only force once per session
  }

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
    swfName: 'miniwave2',
    gameId: 'games/miniWave2/miniWave2.swf',
    props: 'w=550;h=400;m=i',
    files: [
      { u: 'games/miniWave2/miniWave2.swf' },
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
  res.type('text/xml').send(xml);
});

// ─────────────────────────────────────────────
// ENDPOINT: ff/tree — File system tree
// Returns XML
// ─────────────────────────────────────────────
app.get(['/ff/tree', '/tree'], (req, res) => {
  const sid = req.query.sid;
  const username = resolveUsernameFromSid(sid);
  let xml = FILE_TREE_XML;
  if (username && users[username]) {
    const m = unreadInboxCount(users[username]);
    xml = xml.replace(/m="0"/, `m="${m}"`);
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
  if (userOwnsShopPack(user, pack.id)) {
    // Already owned — return a "dup" error.
    return sendShopXml(res, '<r k="2" />');
  }
  if (typeof user.kikooz !== 'number') user.kikooz = 0;
  if (user.kikooz < pack.price) {
    // Not enough kikooz.
    return sendShopXml(res, '<r k="3" />');
  }

  user.kikooz -= pack.price;
  if (user._dbId) db.updateUser(auth.username, { kikooz: user.kikooz }).catch(() => {});

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
  if (user._dbId) db.addAccessory(user._dbId, accEntry).catch(() => {});

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
  ensureContactLists(user);
  if (uid === 'root' || uid === 'desktop') {
    return res.type('text/xml').send(
      `<f u="root">
        <f u="inbox" t="inbox" p="normal" />
        <f u="disccollector" t="disccollector" />
        <f u="inventory" t="inventory" />
        <f u="mycontact" t="mycontact" />
        <e u="DebugBot" t="contact" s="10" d="0" a="0">DebugBot@frutiparc.com</e>
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

  if (uid === 'inv_pictos') {
    const gi = Array.isArray(user.gameItems) ? user.gameItems : [];
    let nodes = '';
    for (const itemName of gi) {
      const displayName = getGameItemDisplayName(itemName);
      const gameName = getGameItemGame(itemName);
      const gifPath = resolveGameItemGif(itemName);
      const gifUrl = gifPath ? `/api/picto/${encodeURIComponent(itemName)}` : '';
      nodes += `<e u="${escapeXml(itemName)}" t="picto" s="10" d="0" a="0">${escapeXml(displayName)}\r\n${escapeXml(gameName)}\r\n${escapeXml(gifUrl)}</e>`;
    }
    return res.type('text/xml').send(`<f u="inv_pictos">${nodes || '<i />'}</f>`);
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
    const nodes = user.contacts.map((addr) => {
      const local = String(addr).split('@')[0];
      return `<e u="${escapeXml(local)}" t="contact" s="10" d="0" a="0">${escapeXml(addr)}</e>`;
    }).join('');
    return res.type('text/xml').send(`<f u="mycontact">${nodes || '<i />'}</f>`);
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
      discNodes += `<e u="${escapeXml(id)}" t="disc" s="10" d="0" a="0">${disc.discType}\n${escapeXml(disc.swfName)}</e>`;
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
        if (user._dbId) db.updateMailRead(mail.uid, true).catch(() => {});
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
        if (user._dbId) db.updateMailRead(mail.uid, true).catch(() => {});
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
  const isContactCreate = type === 'contact' || isContactFolder;

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
        if (user._dbId) db.updateMailFolder(mail.uid, 'outbox').catch(() => {});
        deliverMailToRecipients(mail, auth.username).catch((e) =>
          console.error('[Mail] deliver error:', e.message));
      } else {
        mail.folder = targetFolder;
        if (user._dbId) db.updateMailFolder(mail.uid, targetFolder).catch(() => {});
      }

      const desc = encodeMailDesc(mail);
      return res.type('text/xml').send(
        `<r f="${escapeXml(targetFolder)}"><f n="${escapeXml(mail.uid)}" u="${escapeXml(mail.uid)}" t="mail" d="${escapeXml(mail.date)}" p="${escapeXml(oldF)}">${escapeXml(desc)}</f></r>`
      );
    }
    return res.type('text/xml').send(`<r k="404" />`);
  }

  let oldFolder = String(source.p || req.query.p || 'root');
  const local = file.split('@')[0];
  const normalizedFileAddr = normalizeContactAddress(file);

  const inContacts = user.contacts.find((a) => a === normalizedFileAddr || a.split('@')[0] === local);
  const inBlacklist = user.blacklist.find((a) => a === normalizedFileAddr || a.split('@')[0] === local);

  if (folder === 'recyclebin') {
    if (inContacts) {
      user.contacts = user.contacts.filter((a) => a !== inContacts);
      oldFolder = 'mycontact';
      if (user._dbId) db.removeContact(user._dbId, inContacts).catch((e) => console.error('[DB] contact remove error:', e.message));
    } else if (inBlacklist) {
      user.blacklist = user.blacklist.filter((a) => a !== inBlacklist);
      oldFolder = 'blacklist';
      if (user._dbId) db.removeBlacklist(user._dbId, inBlacklist).catch((e) => console.error('[DB] blacklist remove error:', e.message));
    }
  } else if (folder === 'blacklist') {
    const addr = inContacts || normalizedFileAddr || file;
    if (inContacts) {
      user.contacts = user.contacts.filter((a) => a !== inContacts);
      oldFolder = 'mycontact';
      if (user._dbId) db.removeContact(user._dbId, inContacts).catch((e) => console.error('[DB] contact move error:', e.message));
    }
    if (addr && !user.blacklist.includes(addr)) {
      user.blacklist.push(addr);
      if (user._dbId) db.addBlacklist(user._dbId, addr).catch((e) => console.error('[DB] blacklist add error:', e.message));
    }
  } else if (folder === 'mycontact') {
    const addr = inBlacklist || normalizedFileAddr || file;
    if (inBlacklist) {
      user.blacklist = user.blacklist.filter((a) => a !== inBlacklist);
      oldFolder = 'blacklist';
      if (user._dbId) db.removeBlacklist(user._dbId, inBlacklist).catch((e) => console.error('[DB] blacklist move error:', e.message));
    }
    if (addr && !user.contacts.includes(addr)) {
      user.contacts.push(addr);
      if (user._dbId) db.addContact(user._dbId, addr).catch((e) => console.error('[DB] contact add error:', e.message));
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

  const now = new Date().toLocaleString('fr-FR');
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

  const now = new Date().toLocaleString('fr-FR');
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
app.use('/swf/games/burningKiwi', express.static(path.join(__dirname, 'Games', 'burningKiwi')));
app.use('/swf/games/kaluga', express.static(path.join(__dirname, 'Games', 'kaluga')));
app.use('/swf/games/miniWave2', express.static(path.join(__dirname, 'Games', 'miniWave2')));
app.use('/swf/games/snake3', express.static(path.join(__dirname, 'Games', 'snake3')));
app.use('/swf/games/swapou2', express.static(path.join(__dirname, 'Games', 'swapou2')));
// Fallback: Frusion constructs URLs as baseURL+swfId (e.g. "/games/kaluga/kaluga.swf")
// without the /swf/ prefix.  Serve them from the same location.
app.use('/games/burningKiwi', express.static(path.join(__dirname, 'Games', 'burningKiwi')));
app.use('/games/kaluga', express.static(path.join(__dirname, 'Games', 'kaluga')));
app.use('/games/miniWave2', express.static(path.join(__dirname, 'Games', 'miniWave2')));
app.use('/games/snake3', express.static(path.join(__dirname, 'Games', 'snake3')));
app.use('/games/swapou2', express.static(path.join(__dirname, 'Games', 'swapou2')));
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
  res.json({
    user: username,
    isModerator: !!u.isModerator,
    bouille: bouilleOf(u, username),
    accessories: accessories,
    defaultAccessories: defaults,
  });
});

app.get('/api/forum/index', async (req, res) => {
  if (!process.env.DATABASE_URL) return res.json({ categories: [], boards: [] });
  try {
    const categories = await db.forumGetCategories();
    const boards = await db.forumGetBoards();
    const boardsByCategory = {};
    for (const b of boards) {
      if (!boardsByCategory[b.category_id]) boardsByCategory[b.category_id] = [];
      boardsByCategory[b.category_id].push({
        id: b.id, name: b.name, description: b.description,
        topicCount: Number(b.topic_count), postCount: Number(b.post_count),
        lastActivity: b.last_activity, lastActivityBy: b.last_activity_by,
      });
    }
    res.json({
      categories: categories.map(c => ({
        id: c.id, name: c.name,
        boards: boardsByCategory[c.id] || [],
      })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/forum/board/:id', async (req, res) => {
  if (!process.env.DATABASE_URL) return res.json({ board: null, topics: [], total: 0 });
  try {
    const boardId = Number(req.params.id);
    const page = Math.max(1, Number(req.query.page) || 1);
    const board = await db.forumGetBoard(boardId);
    if (!board) return res.status(404).json({ error: 'board not found' });
    const { topics, total } = await db.forumGetTopics(boardId, page, 25);
    const topicsOut = topics.map(t => ({
      id: t.id, title: t.title, author: t.author_username,
      authorBouille: bouilleOf(users[t.author_username], t.author_username),
      isSticky: t.is_sticky, isLocked: t.is_locked,
      viewCount: t.view_count, replyCount: Number(t.reply_count),
      lastPostAt: t.last_post_at, lastPostBy: t.last_post_by,
      createdAt: t.created_at,
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
    await db.forumIncrementViews(topicId);
    const board = await db.forumGetBoard(topic.board_id);
    const { posts, total } = await db.forumGetPosts(topicId, page, 15);
    const authorNames = [...new Set(posts.map(p => p.author_username))];
    const postCounts = await db.forumGetPostCounts(authorNames);
    const currentUser = forumAuth(req);
    const currentIsMod = currentUser && users[currentUser] && users[currentUser].isModerator;
    const postsOut = posts.map(p => ({
      id: p.id, author: p.author_username, content: p.content,
      createdAt: p.created_at, updatedAt: p.updated_at,
      bouille: p.bouille || bouilleOf(users[p.author_username], p.author_username),
      postCount: postCounts[p.author_username] || 0,
      isModerator: !!(users[p.author_username] && users[p.author_username].isModerator),
    }));
    res.json({
      topic: {
        id: topic.id, title: topic.title, author: topic.author_username,
        boardId: topic.board_id, boardName: board ? board.name : '',
        isSticky: topic.is_sticky, isLocked: topic.is_locked,
      },
      posts: postsOut, total, page, perPage: 15,
      currentIsMod: !!currentIsMod,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/forum/topic', async (req, res) => {
  const username = forumAuth(req);
  if (!username) return res.status(401).json({ error: 'auth_required' });
  if (!process.env.DATABASE_URL) return res.status(503).json({ error: 'no_db' });
  const boardId = Number(req.body.boardId);
  const title = censorProfanity(String(req.body.title || '').trim());
  const content = censorProfanity(String(req.body.content || '').trim());
  const postBouille = req.body.bouille ? normalizeBouilleState(req.body.bouille) : null;
  if (!title || !content) return res.status(400).json({ error: 'title and content required' });
  if (title.length > 200) return res.status(400).json({ error: 'title too long' });
  try {
    const topic = await db.forumCreateTopic(boardId, username, title, content, postBouille);
    res.json({ ok: true, topicId: topic.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/forum/post', async (req, res) => {
  const username = forumAuth(req);
  if (!username) return res.status(401).json({ error: 'auth_required' });
  if (!process.env.DATABASE_URL) return res.status(503).json({ error: 'no_db' });
  const topicId = Number(req.body.topicId);
  const content = censorProfanity(String(req.body.content || '').trim());
  const postBouille = req.body.bouille ? normalizeBouilleState(req.body.bouille) : null;
  if (!content) return res.status(400).json({ error: 'content required' });
  try {
    const topic = await db.forumGetTopic(topicId);
    if (!topic) return res.status(404).json({ error: 'topic not found' });
    if (topic.is_locked) return res.status(403).json({ error: 'topic locked' });
    const post = await db.forumCreatePost(topicId, username, content, postBouille);
    res.json({ ok: true, postId: post.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/forum/post/:id', async (req, res) => {
  const username = forumAuth(req);
  if (!username) return res.status(401).json({ error: 'auth_required' });
  if (!process.env.DATABASE_URL) return res.status(503).json({ error: 'no_db' });
  const content = censorProfanity(String(req.body.content || '').trim());
  if (!content) return res.status(400).json({ error: 'content required' });
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
app.post('/api/admin/forum/seed', adminAuth, async (req, res) => {
  if (!process.env.DATABASE_URL) return res.status(503).json({ error: 'no_db' });
  try {
    const existing = await db.forumGetCategories();
    if (existing.length > 0) return res.json({ ok: true, message: 'already seeded' });
    const cats = [
      { name: 'Gestion du site', boards: [
        { name: 'Annonces', description: "Les annonces officielles de l'équipe Frutiparc" },
      ]},
      { name: 'Frutiparc', boards: [
        { name: 'Animations', description: 'Les annonces des prochaines animations' },
        { name: 'Jeux Frutiparc', description: 'Les jeux de Frutiparc, parlez-en !' },
        { name: 'Frutiz', description: 'Pour parler de la vie des Frutiz, population de Frutiparc !' },
      ]},
      { name: 'La vie Frutiz', boards: [
        { name: 'Jeux Vidéos', description: 'Pour parler de votre passion, les jeux vidéos ;)' },
        { name: 'Créations littéraires', description: "Pour tous vos poèmes, textes et histoires, à vos plumes !" },
        { name: 'Créations graphiques', description: "Pour tous vos dessins, trucages et gribouillis, à vos crayons !" },
        { name: 'Musique', description: 'Car votre passion, c\'est la zique !' },
      ]},
    ];
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
      if (!counts[u]) counts[u] = { user: u, gold: 0, silver: 0, bronze: 0, total: 0 };
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
      user,
      score: Number(v.score),
      data: v.data || '',
      updatedAt: v.updatedAt || '',
    }));
    const lowerBetter = isLowerBetter(rkId);
    all.sort((a, b) => lowerBetter ? a.score - b.score : b.score - a.score);
    out.push({
      id: rkId,
      name: meta.name,
      game: meta.game,
      type: meta.type,
      lowerIsBetter: !!meta.lowerIsBetter,
      scores: all.slice(0, limit),
    });
  }
  res.json({ rankings: out });
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
            db.upsertShopPack(p).catch(() => {});
          } else if (p.wallpaperId) {
            const dbP = dbPacks.find(d => d.id === p.id);
            if (dbP && !dbP.wallpaperId) db.upsertShopPack(p).catch(() => {});
          }
        }
      } catch (e) { console.error('[DB] Shop packs load error:', e.message); }
      try {
        const forumCats = await db.forumGetCategories();
        if (forumCats.length === 0) {
          const defaultForum = [
            { name: 'Gestion du site', boards: [
              { name: 'Annonces', description: "Les annonces officielles de l'équipe Frutiparc" },
            ]},
            { name: 'Frutiparc', boards: [
              { name: 'Animations', description: 'Les annonces des prochaines animations' },
              { name: 'Jeux Frutiparc', description: 'Les jeux de Frutiparc, parlez-en !' },
              { name: 'Frutiz', description: 'Pour parler de la vie des Frutiz, population de Frutiparc !' },
            ]},
            { name: 'La vie Frutiz', boards: [
              { name: 'Jeux Vidéos', description: 'Pour parler de votre passion, les jeux vidéos ;)' },
              { name: 'Créations littéraires', description: 'Pour tous vos poèmes, textes et histoires, à vos plumes !' },
              { name: 'Créations graphiques', description: 'Pour tous vos dessins, trucages et gribouillis, à vos crayons !' },
              { name: 'Musique', description: "Car votre passion, c'est la zique !" },
            ]},
          ];
          for (let ci = 0; ci < defaultForum.length; ci++) {
            const cat = await db.forumCreateCategory(defaultForum[ci].name, ci);
            for (let bi = 0; bi < defaultForum[ci].boards.length; bi++) {
              const b = defaultForum[ci].boards[bi];
              await db.forumCreateBoard(cat.id, b.name, b.description, bi);
            }
          }
          console.log('[FORUM] Seeded default categories and boards');
        } else {
          console.log(`[FORUM] ${forumCats.length} categories already in DB`);
        }
      } catch (e) { console.error('[FORUM] Seed error:', e.message); }
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
              byRanking[r.ranking_id].push({ u: r.username, s: Number(r.score) });
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

  console.log(`[CHALLENGE] lastRollDay=${challengeMedalsData.lastRollDay}, today=${today}`);
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

  // Auto-seed forum categories/boards and demo content on first run
  if (process.env.DATABASE_URL) {
    (async () => {
      try {
        const cats = await db.forumGetCategories();
        if (cats.length === 0) {
          console.log('[FORUM] Seeding forum structure...');
          const seedCats = [
            { name: 'Gestion du site', boards: [
              { name: 'Annonces', description: "Les annonces officielles de l'équipe Frutiparc" },
            ]},
            { name: 'Frutiparc', boards: [
              { name: 'Animations', description: 'Les annonces des prochaines animations' },
              { name: 'Jeux Frutiparc', description: 'Les jeux de Frutiparc, parlez-en !' },
              { name: 'Frutiz', description: 'Pour parler de la vie des Frutiz, population de Frutiparc !' },
            ]},
            { name: 'La vie Frutiz', boards: [
              { name: 'Jeux Vidéos', description: 'Pour parler de votre passion, les jeux vidéos ;)' },
              { name: 'Créations littéraires', description: "Pour tous vos poèmes, textes et histoires, à vos plumes !" },
              { name: 'Créations graphiques', description: "Pour tous vos dessins, trucages et gribouillis, à vos crayons !" },
              { name: 'Musique', description: 'Car votre passion, c\'est la zique !' },
            ]},
          ];
          const boardIds = [];
          for (let ci = 0; ci < seedCats.length; ci++) {
            const cat = await db.forumCreateCategory(seedCats[ci].name, ci);
            for (let bi = 0; bi < seedCats[ci].boards.length; bi++) {
              const b = seedCats[ci].boards[bi];
              const board = await db.forumCreateBoard(cat.id, b.name, b.description, bi);
              boardIds.push(board.id);
            }
          }
          // Seed demo topics so the forum isn't empty on first visit
          const demoUser = 'Frutiparc';
          if (!users[demoUser]) users[demoUser] = { isModerator: true };
          const t1 = await db.forumCreateTopic(boardIds[0], demoUser,
            'Bienvenue sur le forum Frutiparc !',
            "[b]Bienvenue à tous sur le forum de Frutiparc ![/b]\n\nIci vous pouvez discuter avec les autres Frutiz, partager vos scores et vos créations.\n\nBonne visite !");
          const t2 = await db.forumCreateTopic(boardIds[2], demoUser,
            'Quel est votre jeu préféré ?',
            "Salut les Frutiz ! :)\n\nDites-moi, quel est votre jeu préféré sur Frutiparc ?\n\nPersonnellement j'adore [b]Swapou[/b], le mode duel est super fun !");
          await db.forumCreatePost(t2.id, demoUser,
            "J'oubliais, [i]Kaluga[/i] est pas mal non plus pour se détendre.");
          console.log('[FORUM] Seed complete (' + boardIds.length + ' boards, 2 demo topics)');
        }
      } catch (e) {
        console.error('[FORUM] Seed error:', e.message);
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
    const str = buf.toString('utf8');
    console.log('[WS→TCP] WS→TCP:', str.replace(/\0/g, '').substring(0, 200));
    if (buf.length > 0 && buf[buf.length - 1] === 0x00) {
      tcp.write(buf);
    } else {
      tcp.write(Buffer.concat([buf, Buffer.from([0x00])]));
    }
  });

  tcp.on('data', (data) => {
    const str = data.toString('utf8');
    const parts = str.split('\0').filter(s => s.trim().length > 0);
    for (const part of parts) {
      console.log('[WS→TCP] TCP→WS:', part.substring(0, 200));
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
    const str = buf.toString('utf8');
    console.log('[FSCORE-WS] WS→TCP:', str.replace(/\0/g, '').substring(0, 200));
    if (buf.length > 0 && buf[buf.length - 1] === 0x00) {
      tcp.write(buf);
    } else {
      tcp.write(Buffer.concat([buf, Buffer.from([0x00])]));
    }
  });

  tcp.on('data', (data) => {
    const str = data.toString('utf8');
    const parts = str.split('\0').filter(s => s.trim().length > 0);
    for (const part of parts) {
      console.log('[FSCORE-WS] TCP→WS:', part.substring(0, 200));
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
  pomme:     { topic: 'Bienvenue sur le salon Pomme !', users: new Set() },
  abricot:   { topic: 'Salon Abricot', users: new Set() },
  poire:     { topic: 'Salon Poire', users: new Set() },
  fraise:    { topic: 'Salon Fraise', users: new Set() },
  citron:    { topic: 'Salon Citron', users: new Set() },
  kiwi:      { topic: 'Salon Kiwi', users: new Set() },
  raisin:    { topic: 'Salon Raisin', users: new Set() },
  orange:    { topic: 'Salon Orange', users: new Set() },
  cerise:    { topic: 'Salon Cerise', users: new Set() },
  banane:    { topic: 'Salon Banane', users: new Set() },
  bienvenue: { topic: 'Bienvenue sur Frutiparc !', users: new Set() },
};

// ── Virtual users / PNJ (always connected on pomme) ──
const CONNECTED_NPCS = new Set([
  'DebugBot',
  'Gaspard',
]);

users.DebugBot = {
  pass: '',
  xp: 1000000,
  kikooz: 100,
  fbouille: '000000020000000000000000',
  items: withDefaultPens([1, 2, 3]),
  contacts: [],
  blacklist: [],
  gender: 'M',
  birthday: '2000-01-01',
  country: 'FR',
  region: 'IDF',
  prefs: '',
  isModerator: false,
  needsBouille: false,
  city: 'Frutiparc',
  realJob: 'Bot de debug',
  firstName: 'Debug',
  lastName: 'Bot',
  comment: 'Bot de test connecté en permanence.',
};

users.Gaspard = {
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
};

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

function isModerator(username) {
  if (isDebugNotUser(username)) return false;
  return !!(username && users[username] && users[username].isModerator);
}

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
  const notif = `<${wire} u="${escapeXml(targetUser)}" g="${escapeXml(channelName)}" by="${escapeXml(byUser)}" r="${escapeXml(reason)}" />`;

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

  // Respawn connected PNJ after 5 seconds if one is kicked
  if (CONNECTED_NPCS.has(targetUser)) {
    setTimeout(() => {
      if (channels[channelName]) {
        channels[channelName].users.add(targetUser);
        // Broadcast userjoined so other clients see PNJ reappear
        broadcastToChannel(channelName, `<${CMD.userjoined} u="${escapeXml(targetUser)}" g="${escapeXml(channelName)}" />`);
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

function formatChatTimePrefix(d) {
  return `[${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}] `;
}

function buildChatTimeAttrs(date = new Date()) {
  return {
    h: formatChatTimePrefix(date),
    // Some legacy paths rebuild "$h" from a raw datetime field.
    d: formatDateTime(date),
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
      `<${CMD.invite} u="${escapeXml(inviter)}" g="${escapeXml(invGroup)}" p="${escapeXml(invPass)}">${escapeXml(invTopic)}</${CMD.invite}>`
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
      const effectiveLogin = sessionUser || login;
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
      if (user.hasWelcomeUserLog !== true) {
        addUserHistoryEntry(user, {
          type: 1,
          content: "Bienvenue sur Frutiparc Revival ! Tu n'as donc rien de mieux à faire ?!",
          flNew: true,
        });
        user.hasWelcomeUserLog = true;
      }
      if (user.hasWelcomeSiteLog !== true) {
        addSiteHistoryEntry(user, {
          type: 1,
          content: "Évènement: ton compte Frutiparc Revival vient d'être activé.",
          flNew: true,
        });
        user.hasWelcomeSiteLog = true;
      }

      // Success: send ident response with user data
      client.username = effectiveLogin;
      client.sid = sid;
      client.logged = true;

      sendToClient(socket, `<${CMD.ident} l="${effectiveLogin}" x="${user.xp}" f="${bouilleOf(user)}" />`);
      if (user.userLog && user.userLog.length > 0 && user.userLog[0].n) {
        const entry = user.userLog[0];
        sendToClient(
          socket,
          `<${CMD.newuserlog} date="${escapeXml(entry.d || nowSqlTimestamp())}" type="${escapeXml(String(entry.t || 8))}">${escapeXml(entry.c || '')}</${CMD.newuserlog}>`,
        );
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
        // Persist if we have a valid ranking + user.
        let res = { updated: false, newScore: scoreVal, oldScore: 0, oldPos: 0, newPos: 0 };
        if (username && rankingId) {
          res = persistScore(username, rankingId, scoreVal, scoreData);
          console.log(`[FSCORE] ${username} ${rankingId}: ${res.oldScore} -> ${res.newScore} (updated=${res.updated}, pos ${res.oldPos}->${res.newPos})`);
        } else {
          console.log(`[FSCORE] skip persist (user="${username}" rankingId="${rankingId}")`);
        }
        // Frusion GameClient parses each child node of <q> as a RankingResult,
        // reading attributes rn (rankingName), r (rankingData), p (bestScorePos),
        // os (oldScore), op (oldPos), s (bestScore). Without a child node the
        // GameClient leaves ranking.bestScorePos undefined — which propagates
        // into the UI as "Votre classement : undefined".
        const rkInfo = rankingId ? (RANKINGS[rankingId] || {}) : {};
        const rnAttr = rkInfo.name ? ` rn="${escapeXml(rkInfo.name)}"` : '';
        const rankingDataForClient = rankingId ? formatRankingExtraData(rankingId, scoreData) : scoreData;
        const rAttr = rankingDataForClient ? ` r="${escapeXml(rankingDataForClient)}"` : ' r=""';
        const subAttrs = `${rnAttr}${rAttr} p="${res.newPos}" os="${res.oldScore}" op="${res.oldPos}" s="${res.newScore}"`;
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
    console.log(`[FSCORE] startGame disc=${discId} mode=${gameMode} user=${client.username || '-'}`);
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
    userXml += `<u u="${escapeXml(u)}" x="${ud.xp || 0}" sx="${ud.gender || 'M'}" bd="${ud.birthday || '2000-01-01.00:00:00'}" co="${ud.country || 'FR'}" rg="${ud.region || ''}" p="1" s="${getStatusCode(ud, u)}" mu="${getMuteValue(ud)}" f="${bouilleOf(ud)}" />`;
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
      traceXml += `<u u="${escapeXml(u)}" p="1" s="${getStatusCode(ud, u)}" mu="${getMuteValue(ud)}" f="${bouilleOf(ud)}" />`;
    }
    sendToClient(socket, `<${CMD.trace}>${traceXml}</${CMD.trace}>`);
  }

  // 4. Notification aux autres + trace du nouvel arrivant pour leurs FrutiScreen
  {
    const joinerUd = users[client.username] || {};
    const joinerTrace = `<${CMD.trace}><u u="${escapeXml(client.username)}" p="1" s="${getStatusCode(joinerUd, client.username)}" mu="${getMuteValue(joinerUd)}" f="${bouilleOf(joinerUd)}" /></${CMD.trace}>`;
    broadcastToChannel(g, `<${CMD.userjoined} u="${escapeXml(client.username)}" g="${g}" />`, socket);
    broadcastToChannel(g, joinerTrace, socket);
  }
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
        userXml += `<u u="${escapeXml(u)}" x="${ud.xp || 0}" sx="${ud.gender || 'M'}" bd="${ud.birthday || '2000-01-01.00:00:00'}" co="${ud.country || 'FR'}" rg="${ud.region || ''}" p="1" s="${getStatusCode(ud, u)}" mu="${getMuteValue(ud)}" f="${bouilleOf(ud)}" />`;
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
          inner += `<score u="${escapeXml(e.u)}" x="${e.s}" f="${escapeXml(bouilleOf(ud, e.u))}" s="${e.s}" t="${formatDateTime(new Date())}" />`;
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
  `<${CMD.userleaved} u="${escapeXml(client.username)}" g="${g}" />`
);
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
        console.log(`[FSCORE-DEBUG] rankingResult request attrs=${JSON.stringify(msg.attrs)} selectedDt=${client && client.selectedDt}`);
        const rkInput = String(msg.attrs.rk);
        const cAttrIn = String(msg.attrs.c || '');
        const dtExplicit = msg.attrs.dt !== undefined ? String(msg.attrs.dt).slice(0, 10) : '';
        const internalId = resolveInternalRankingId(rkInput);
        const dtIn = dtExplicit || (internalId && isDailyResetRanking(internalId) ? (client.selectedDt || '') : '');
        if (internalId) {
          const memoryEntries = [];
          for (const [u, rlist] of Object.entries(scoresData.users || {})) {
            if (rlist && rlist[internalId]) memoryEntries.push(`${u}:${rlist[internalId].score}`);
          }
          console.log(`[FSCORE-DEBUG] memory has ${memoryEntries.length} entries under ${internalId}: [${memoryEntries.join(', ')}]`);
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
          const ts = e.at ? formatDateTime(new Date(e.at)) : formatDateTime(new Date());
          const displayData = formatRankingExtraData(internalId, e.d);
          const dAttr = displayData ? ` d="${escapeXml(displayData)}"` : '';
          inner += `<score u="${escapeXml(e.u)}" x="${ud.xp || 0}" f="${escapeXml(bouilleOf(ud, e.u))}" s="${e.s}" t="${ts}"${dAttr} />`;
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
      sendToClient(socket, `<${CMD.kick} u="${escapeXml(targetUser)}" g="${escapeXml(g)}" />`);
      break;
    }

    // ── ban (totocher) / FrutiScore rankingResult ──
    case 'ban': {
      // FrutiScore overlap: rankingResult uses wire code "m" with rk attr.
      if (msg.attrs.rk !== undefined) {
        console.log(`[FSCORE-DEBUG] rankingResult (wire m) attrs=${JSON.stringify(msg.attrs)} selectedDt=${client && client.selectedDt}`);
        const rkInput = String(msg.attrs.rk);
        const cAttrIn = String(msg.attrs.c || '');
        const internalId = resolveInternalRankingId(rkInput);
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
          const ts = e.at ? formatDateTime(new Date(e.at)) : formatDateTime(new Date());
          const displayData = formatRankingExtraData(internalId, e.d);
          const dAttr = displayData ? ` d="${escapeXml(displayData)}"` : '';
          inner += `<score u="${escapeXml(e.u)}" x="${ud.xp || 0}" f="${escapeXml(bouilleOf(ud, e.u))}" s="${e.s}" t="${ts}"${dAttr} />`;
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
      sendToClient(socket, `<${CMD.ban} u="${escapeXml(targetUser)}" g="${escapeXml(g)}" />`);
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
  const timeAttrs = buildChatTimeAttrs();
  const senderData = users[client.username] || {};
  const mutedUntil = senderData.mutedUntil ? new Date(senderData.mutedUntil) : null;
  if (mutedUntil && !Number.isNaN(mutedUntil.getTime()) && mutedUntil.getTime() > Date.now()) {
    sendToClient(socket, `<${CMD.onmute} u="${escapeXml(client.username)}" mt="${escapeXml(senderData.mutedUntil)}" mu="${escapeXml(senderData.mutedUntil)}" />`);
    break;
  }

  if (g && client.logged) {
    const channel = channels[g];
    if (!channel || !client.channels.has(g) || !channel.users.has(client.username)) {
      sendToClient(socket, `<${CMD.error} k="220" />`);
      break;
    }
    if (isModerator(client.username) && text.startsWith('/kick ')) {
      const targetUser = resolveKnownUsername(text.substring(6).trim());
      if (targetUser) kickUserFromChannel(g, targetUser, client.username, 'kick');
      break;
    }
    if (isModerator(client.username) && text.startsWith('/totoch ')) {
      const targetUser = resolveKnownUsername(text.substring(8).trim());
      const target = users[targetUser];
      if (targetUser && target) {
        const until = new Date(Date.now() + 10 * 60 * 1000).toISOString().replace('T', '.').substring(0, 19);
        target.mutedUntil = until;
        for (const targetSock of getSocketsForUsername(targetUser)) {
          sendToClient(targetSock, `<${CMD.onmute} u="${escapeXml(targetUser)}" mt="${escapeXml(until)}" mu="${escapeXml(until)}" />`);
        }
      }
      break;
    }

    let safeText = escapeXml(text);

    // Moderator "!" prefix: route through chat.msg_admin (patched to render the
    // entire line in #812F0A; $h stays normal-weight, $m gets <b>).
    // Body carries "<pseudo>: <message>" — the username then sits inside <b>
    // and shows in red bold alongside the message.
    if (isModerator(client.username) && text.startsWith('!')) {
      const shout = text.substring(1).trim();
      if (shout) {
        const body = escapeXml(client.username + ': ' + shout);
        broadcastToChannel(g,
          `<${CMD.send} u="admin" t="m" p="" g="${escapeXml(g)}" h="${timeAttrs.h}" d="${timeAttrs.d}">${body}</${CMD.send}>`
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
        const giftXml = `<${CMD.send} u="${escapeXml(client.username)}" t="g" p="${pen}" g="${g}" h="${timeAttrs.h}" d="${timeAttrs.d}">${childXml}</${CMD.send}>`;
        broadcastToChannel(g, giftXml);
        break;
      }
    }

    const xml = `<${CMD.send} u="${escapeXml(client.username)}" t="${type}" p="${pen}" g="${g}" h="${timeAttrs.h}" d="${timeAttrs.d}">${safeText}</${CMD.send}>`;
    broadcastToChannel(g, xml);
} else if (msg.attrs.u) {
  const targetUser = msg.attrs.u;
  const safeText = escapeXml(text);

  // Echo au sender, indispensable pour afficher sa propre ligne
  sendToClient(
    socket,
    `<${CMD.send} u="${escapeXml(client.username)}" t="${type}" p="${pen}" h="${timeAttrs.h}" d="${timeAttrs.d}">${safeText}</${CMD.send}>`
  );

  // Envoi au destinataire
  for (const [sock, cl] of xmlSocketClients) {
    if (cl.username === targetUser) {
      sendToClient(
        sock,
        `<${CMD.send} u="${escapeXml(client.username)}" t="${type}" p="${pen}" h="${timeAttrs.h}" d="${timeAttrs.d}">${safeText}</${CMD.send}>`
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
      const until = msg.attrs.e || new Date(Date.now() + 10 * 60 * 1000).toISOString().replace('T', '.').substring(0, 19);
      target.mutedUntil = until;
      for (const targetSock of getSocketsForUsername(targetUser)) {
        sendToClient(targetSock, `<${CMD.onmute} u="${escapeXml(targetUser)}" mt="${escapeXml(until)}" mu="${escapeXml(until)}" />`);
      }
      sendToClient(socket, `<${CMD.mute} u="${escapeXml(targetUser)}" mt="${escapeXml(until)}" mu="${escapeXml(until)}" />`);
      const g = pickActiveChannel(client, msg.attrs);
      if (g) {
        const timeAttrs = buildChatTimeAttrs();
        // Use u="admin" so box.Chat.onSend renders via chat.msg_admin
        // ($h<i>$m</i>) instead of chat.msg ($h<b>$u</b>: $m). That drops
        // the "Serveur:" username prefix and keeps it visually italic.
        // There is no native chat.usermuted handler — this is the closest
        // thing to a "natural" chat notice without modifying main.swf.
        broadcastToChannel(g, `<${CMD.send} u="admin" t="m" p="" g="${escapeXml(g)}" h="${timeAttrs.h}" d="${timeAttrs.d}">${escapeXml(targetUser)} a été totoché</${CMD.send}>`);
        broadcastToChannel(g, `<${CMD.trace} u="${escapeXml(targetUser)}" p="1" s="${getStatusCode(target, targetUser)}" mu="${getMuteValue(target)}" f="${bouilleOf(target)}" />`);
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
        sendToClient(targetSock, `<${CMD.endmute} u="${escapeXml(targetUser)}" />`);
      }
      sendToClient(socket, `<${CMD.unmute} u="${escapeXml(targetUser)}" />`);
      const g = pickActiveChannel(client, msg.attrs);
      if (g) {
        broadcastToChannel(g, `<${CMD.trace} u="${escapeXml(targetUser)}" p="1" s="${getStatusCode(target, targetUser)}" mu="${getMuteValue(target)}" f="${bouilleOf(target)}" />`);
      }
      break;
    }

    // ── trace: request status updates for users ──
case 'trace': {
  const traceChildren = (msg.children || []).filter(child => child.tag === 'u' && child.attrs.u);

  if (traceChildren.length > 0) {
    let inner = '';

    for (const child of traceChildren) {
      const u = child.attrs.u;
      const ud = users[u] || {};
      const pVal = getSocketsForUsername(u).length > 0 ? 1 : 0;
      inner += `<u u="${u}" p="${pVal}" s="${getStatusCode(ud, u)}" mu="${getMuteValue(ud)}" f="${bouilleOf(ud, u)}" />`;
    }

    sendToClient(socket, `<${CMD.trace}>${inner}</${CMD.trace}>`);
    break;
  }

  const targetUser = msg.attrs.u;
  if (targetUser) {
    if (client.sid && sessions[client.sid]) {
      sessions[client.sid].lastTraceUser = targetUser;
    }
    const ud = users[targetUser] || {};
    const pVal = getSocketsForUsername(targetUser).length > 0 ? 1 : 0;
    sendToClient(
      socket,
      `<${CMD.trace} u="${targetUser}" p="${pVal}" s="${getStatusCode(ud, targetUser)}" mu="${getMuteValue(ud)}" f="${bouilleOf(ud, targetUser)}" />`
    );
  }
  break;
}
    // ── stoptrace: stop tracking users / FrutiScore rateranking ──
    case 'stoptrace': {
      // FrutiScore overlap: rateranking uses wire code "aa" with s/l attrs.
      if (msg.attrs.s !== undefined || msg.attrs.l !== undefined) {
        const start = Number(msg.attrs.s || 0) || 0;
        const limit = Number(msg.attrs.l || 10) || 10;
        const merged = new Map();
        try {
          const dbUsers = await db.listAllUsers();
          for (const row of dbUsers) {
            if (row.xp > 0) merged.set(row.username, row.xp);
          }
        } catch (e) { console.error('[FSCORE] rateranking DB error:', e.message); }
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
          inner += `<score u="${escapeXml(e.u)}" x="${e.s}" f="${escapeXml(bouilleOf(ud, e.u))}" s="${e.s}" t="${formatDateTime(new Date())}" />`;
        }
        sendToClient(socket, `<${CMD.stoptrace}>${inner}</${CMD.stoptrace}>`);
        console.log(`[FSCORE] rateranking: ${slice.length}/${all.length} entries`);
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
        const traceXml = `<${CMD.trace} u="${escapeXml(client.username)}" p="1" s="${getStatusCode(ud, client.username)}" mu="${getMuteValue(ud)}" f="${bouilleOf(ud, client.username)}" />`;
        for (const ch of client.channels || []) {
          broadcastToChannel(ch, traceXml, socket);
        }
      }
      break;
    }

    // ── userinfo: get user info ──
    case 'userinfo': {
      const u = msg.attrs.u;
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
      sendToClient(socket,
        `<${CMD.userinfo} r="${escapeXml(r)}" u="${escapeXml(u)}" x="${ud.xp || 0}" sx="${ud.gender || 'M'}" bd="${escapeXml(ud.birthday || '')}" co="${escapeXml(ud.countryIndex || '1')}" rg="${escapeXml(ud.regionIndex || '0')}" fj="${escapeXml(getFrutizJob(u, ud))}" ct="${escapeXml(ud.city || '')}" rj="${escapeXml(ud.realJob || '')}" fn="${escapeXml(ud.firstName || '')}" ln="${escapeXml(ud.lastName || '')}" cm="${escapeXml(ud.comment || '')}" su="${escapeXml(ud.siteUrl || '')}" />`
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

  // Accusé de réception de l’ouverture de la discussion privée
  sendToClient(
    socket,
    `<${CMD.createchannel} u="${escapeXml(otherUser)}" g="${privateGroup}" p="${privatePass}">${escapeXml(privateTitle)}</${CMD.createchannel}>`
  );

  // Invite "privée" envoyée au demandeur pour ouvrir immédiatement la box
  sendToClient(
    socket,
    `<${CMD.invitechat} u="${escapeXml(otherUser)}" g="${privateGroup}" p="${privatePass}" />`
  );

  // On pousse aussi les infos connues sur l’autre user
  const ud = users[otherUser] || createDefaultUser('');

  sendToClient(
    socket,
    `<${CMD.userinfo} r="pm" u="${escapeXml(otherUser)}" x="${ud.xp || 0}" sx="${ud.gender || 'M'}" bd="${escapeXml(ud.birthday || '2000-01-01')}" co="${escapeXml(ud.countryIndex || '1')}" rg="${escapeXml(ud.regionIndex || '0')}" fj="${escapeXml(getFrutizJob(otherUser, ud))}" ct="${escapeXml(ud.city || '')}" rj="${escapeXml(ud.realJob || '')}" fn="${escapeXml(ud.firstName || '')}" ln="${escapeXml(ud.lastName || '')}" cm="${escapeXml(ud.comment || '')}" su="${escapeXml(ud.siteUrl || '')}" />`
  );

  sendToClient(
    socket,
    `<${CMD.trace} u="${escapeXml(otherUser)}" p="${getSocketsForUsername(otherUser).length > 0 ? 1 : 0}" s="${getStatusCode(ud, otherUser)}" mu="${getMuteValue(ud)}" f="${bouilleOf(ud, otherUser)}" />`
  );

  // Si l'autre utilisateur est connecté, il reçoit aussi l'invitation.
  for (const targetSock of getSocketsForUsername(otherUser)) {
    sendToClient(
      targetSock,
      `<${CMD.invitechat} u="${escapeXml(requester)}" g="${privateGroup}" p="${privatePass}" />`
    );
  }

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
          `<${CMD.invitechat} u="${escapeXml(requester)}" g="${g}" p="${pass}" />`
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
    case 'searchuser': {
      const u = msg.attrs.u || '';
      const results = Object.keys(users)
        .filter(name => name.toLowerCase().includes(u.toLowerCase()))
        .slice(0, 20);
      let inner = '';
      for (const name of results) {
        const ud = users[name] || {};
        inner += `<u u="${name}" f="${bouilleOf(ud, name)}" x="${ud.xp || 0}" />`;
      }
      sendToClient(socket, `<${CMD.searchuser}>${inner}</${CMD.searchuser}>`);
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
        let targetUser = client.username || '';
        if (Array.isArray(msg.children)) {
          const uChild = msg.children.find((c) => c.tag === 'u' && c.attrs && c.attrs.u);
          if (uChild) targetUser = uChild.attrs.u;
        }
        let inner = '';
        for (const rkAny of rkList) {
          const internalId = resolveInternalRankingId(rkAny);
          if (!internalId) continue;
          const legacyDesc = legacyDescriptorFromRkLike(rkAny) || legacyDescriptorFromRkLike(internalId);
          const info = getUserScore(targetUser, internalId);
          if (info.score <= 0 && info.pos <= 0) continue;
          const rkOut = INTERNAL_TO_LEGACY_RK[internalId] || rkAny || internalId;
          const tAttr = legacyDesc && legacyDesc.ty && legacyDesc.ty !== 'point' ? ` t="${escapeXml(legacyDesc.ty)}"` : '';
          inner += `<rk rk="${escapeXml(rkOut)}" p="${info.pos}" s="${info.score}"${tAttr} />`;
        }
        const rAttr = reqId ? ` r="${escapeXml(String(reqId))}"` : '';
        if (!inner) {
          sendToClient(socket, buildLegacyUserResultPayload(targetUser, reqId));
        } else {
          sendToClient(socket, `<${CMD.unban}${rAttr} u="${escapeXml(targetUser)}">${inner}</${CMD.unban}>`);
        }
        console.log(`[FSCORE] userResult user=${targetUser} rankings=[${rkList.join(',')}]`);
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
      const rkId = rankingIdForGame(gameName);
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
        console.log(`[FSCORE-DEBUG] awardgame g=${gameName} rkId=${rkId} game=${game} yesterday=${yesterday} podium=${JSON.stringify(podium)}`);
        for (const p of podium) {
          inner += `<a v="${p.rank}" u="${escapeXml(p.u)}" d="1" />`;
        }
      } else if (rkId) {
        const all = [];
        for (const [u, rlist] of Object.entries(scoresData.users || {})) {
          if (rlist && rlist[rkId] && Number.isFinite(Number(rlist[rkId].score))) {
            all.push({ u, s: Number(rlist[rkId].score) });
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
      const targetUser = msg.attrs.u || client.username || '';
      const rAttr = reqId ? ` r="${escapeXml(String(reqId))}"` : '';
      let inner = '';
      for (const [rkId, rk] of Object.entries(RANKINGS)) {
        const info = getUserScore(targetUser, rkId);
        if (info.pos === 1 && info.score > 0) {
          inner += `<a g="${escapeXml(rk.game)}" n="${escapeXml(rk.name)}" v="${info.score}" d="0" />`;
        }
      }
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
      for (const medal of allMedals) {
        const gameName = GAME_DISPLAY_NAMES[medal.game] || medal.game;
        const medalName = MEDAL_DISPLAY_NAMES[medal.medal] || medal.medal;
        inner += `<a g="${escapeXml(medal.game)}" n="${escapeXml(`Médaille ${medalName} - ${gameName} (${medal.awarded_day})`)}" v="${medal.rank}" d="1" />`;
      }
      sendToClient(socket, `<${CMD.awarduser}${rAttr} u="${escapeXml(targetUser)}">${inner}</${CMD.awarduser}>`);
      const medalSummary = allMedals.map(m => `${m.game}:rank${m.rank}=${m.medal}`).join(',');
      console.log(`[FSCORE] awarduser user=${targetUser}: ${allMedals.length} medals [${medalSummary}]`);
      break;
    }

    // ── fcardlist (ef): games for which a user has a public FrutiCard ──
    // Empty list is a valid response; FrutizInfo needs this to unblock the
    // "scores" state machine (updateStateFromInt requires fcardlist == 2).
    case 'fcardlist': {
      const reqId = msg.attrs.r || '';
      const rAttr = reqId ? ` r="${escapeXml(String(reqId))}"` : '';
      sendToClient(socket, `<${CMD.fcardlist}${rAttr}></${CMD.fcardlist}>`);
      break;
    }

    // ── fcardgetpublicslot (ea): return an empty public FrutiCard slot ──
    case 'fcardgetpublicslot': {
      const reqId = msg.attrs.r || '';
      const game = msg.attrs.g || '';
      const rAttr = reqId ? ` r="${escapeXml(String(reqId))}"` : '';
      const gAttr = game ? ` g="${escapeXml(String(game))}"` : '';
      sendToClient(socket, `<${CMD.fcardgetpublicslot}${rAttr}${gAttr}></${CMD.fcardgetpublicslot}>`);
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
      // Treat as FrutiScore giveItem.
      const itemName = msg.attrs.i || msg.attrs.n || msg.attrs.t || msg.content || '';
      if (!itemName || !client.username) {
        console.log(`[FSCORE] giveItem: no item name or user — raw=${JSON.stringify(msg.attrs)} content=${msg.content || ''}`);
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
            `<${CMD.userleaved} g="${g}" u="${client.username}" />`
          );
        }
      }
      console.log(`[CBee]  Client disconnected: ${client.username || 'anonymous'}`);
    }
    xmlSocketClients.delete(socket);
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
