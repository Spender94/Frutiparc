const express = require('express');
const { WebSocketServer } = require('ws');
const net = require('net');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const fontsPath = path.join(__dirname, 'legacy', 'fonts.swf');



const app = express();

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

// Log all incoming requests for debugging
app.use((req, res, next) => {
  console.log(`[HTTP]  ${req.method} ${req.url}`);
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

const port = process.env.PORT || 8888;
const XMLSOCKET_PORT = 5000; // Port for the CBee XMLSocket server (must end in 000 for FrutiChat cmdList)

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

const DEFAULT_BOUILLE_STATE = '000000000000000000000000';
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

function bouilleOf(user) {
  return normalizeBouilleState(
    user && user.fbouille ? user.fbouille : DEFAULT_BOUILLE_STATE
  );
}

// ─────────────────────────────────────────────
// In-memory state
// ─────────────────────────────────────────────
const sessions = {};       // sid -> { user, createdAt }
const users = {};          // username -> { pass, xp, kikooz, fbouille, items, prefs }
const frusionTrace = {};   // sid -> [{ at, event, meta }]
let lastFrusionSid = null;
let lastFrusionSidAt = 0;

function sidFromRequest(req) {
  if (req.query && typeof req.query.sid === 'string' && req.query.sid) return req.query.sid;
  const ref = req.get('referer') || req.get('referrer');
  if (!ref) return null;
  try {
    const url = new URL(ref);
    return url.searchParams.get('sid');
  } catch {
    return null;
  }
}

function recordFrusionEvent(sid, event, meta = {}) {
  const key = sid || '__no_sid';
  const row = { at: new Date().toISOString(), sid: key, event, meta };

  if (!frusionTrace[key]) frusionTrace[key] = [];
  frusionTrace[key].push(row);
  if (frusionTrace[key].length > 80) frusionTrace[key].shift();

  if (!frusionTrace.__all) frusionTrace.__all = [];
  frusionTrace.__all.push(row);
  if (frusionTrace.__all.length > 300) frusionTrace.__all.shift();

  console.log(`[FRUSION][${key}] ${event} ${JSON.stringify(meta)}`);
}

// Default user for quick testing
users['Angelisium'] = {
  pass: 'test',
  xp: 4680000,
  kikooz: 150,
  fbouille: DEFAULT_BOUILLE_STATE,
  items: withDefaultPens([1, 2, 3]),
  contacts: ['Gaspard@frutiparc.com'],
  blacklist: [],
  gender: 'M',
  birthday: '1990-05-15',
  country: 'FR',
  region: 'IDF',
  prefs: '',
  needsBouille: true, // Force editbouille on first login
};

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

function ensureContactLists(user) {
  if (!Array.isArray(user.contacts)) user.contacts = [];
  if (!Array.isArray(user.blacklist)) user.blacklist = [];
}

const DEFAULT_BOUILLE_LIST = [
  { b: '000503000000111010000000', n: 'Classique' },
  { b: '000503000000111011000000', n: 'Classique 2' },
  { b: '000503000000111012000000', n: 'Classique 3' },
  { b: '010503000000111010000000', n: 'Famille 1' },
];

function buildBouilleListXml() {
  return DEFAULT_BOUILLE_LIST
    .map((o) => `<b b="${escapeXml(normalizeBouilleState(o.b))}">${escapeXml(o.n)}</b>`)
    .join('');
}

// ─────────────────────────────────────────────
// File system tree (virtual)
// b = "messages;inbox;outbox;blackbox;draftbox;disccollector;inventory;mycontact;recyclebin"
// ─────────────────────────────────────────────
const FILE_TREE_XML = `<s u="root" n="Bureau" t="desktop" m="0" b="messages;inbox;outbox;blackbox;draftbox;disccollector;inventory;mycontact;recyclebin">
  <f u="messages" n="Messages" t="messages">
    <f u="inbox" n="Boîte de réception" t="inbox" />
    <f u="outbox" n="Messages envoyés" t="outbox" />
    <f u="blackbox" n="Spams" t="blackbox" />
    <f u="draftbox" n="Brouillons" t="draftbox" />
  </f>
  <f u="disccollector" n="Mes disques" t="disccollector" />
  <f u="inventory" n="Inventaire" t="inventory" />
  <f u="mycontact" n="Mes contacts" t="mycontact" />
  <f u="recyclebin" n="Corbeille" t="recyclebin" />
</s>`;

// ─────────────────────────────────────────────
// Serve static files from public/ (AFTER API routes, so our
// endpoints take priority over stale static files in public/do/)
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// Legacy Ruffle page
// ─────────────────────────────────────────────
app.get('/legacy', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'ruffle.html'));
});

app.get('/frusion', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'frusion-ruffle.html'));
});


app.get('/legacy/main.swf', (req, res) => {
  res.sendFile(path.join(__dirname, 'legacy', 'main.swf'));
});

app.get(['/fonts.swf', '/legacy/fonts.swf', '/sw/fonts.swf'], (req, res) => {
  console.log('[SWF] fonts.swf requested:', req.url);
  res.type('application/x-shockwave-flash');
  res.sendFile(fontsPath);
});

// Explicit route for fileIcon.swf — Ruffle's loadMovie() fetches this
// during the loading screen.  Serving it explicitly (with logging and
// correct Content-Type) helps diagnose and resolve pending-fetch issues.
app.get('/fileIcon.swf', (req, res) => {
  console.log('[SWF]   fileIcon.swf requested');
  res.type('application/x-shockwave-flash');
  res.sendFile(path.join(__dirname, 'public', 'fileIcon.swf'));
});



app.get(['/frusion_client.swf', '/swf/frusion_client.swf'], (req, res) => {
  const fallback = path.join(__dirname, 'frusion', 'saf_debug.swf');
  console.log('[SWF]   frusion_client.swf requested -> serving saf_debug.swf fallback');
  res.type('application/x-shockwave-flash');
  res.sendFile(fallback);
});

function sendAvatarFamily(res, fileName) {
  let absPath = path.join(__dirname, 'public', 'swf', 'fbouille', fileName);

  if (!fs.existsSync(absPath)) {
    console.log(`[SWF]   Missing avatar asset: ${absPath}`);
    return res.status(404).type('text/plain').send('Missing SWF');
  }

  // Repo snapshot often has a tiny stub for famille1.swf (17 bytes).
  // Serve famille0 as fallback to avoid malformed SWF parse loops in Ruffle.
  if (fileName === 'famille1.swf') {
    try {
      const st = fs.statSync(absPath);
      if (st.size <= 32) {
        console.warn('[SWF]   famille1.swf is a stub, falling back to famille0.swf');
        absPath = path.join(__dirname, 'public', 'swf', 'fbouille', 'famille0.swf');
      }
    } catch {}
  }

  console.log(`[SWF]   Serving avatar asset: ${fileName}`);
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
  res.type('text/xml').send(
    `<services host="localhost"><service name="frutichat" port="${XMLSOCKET_PORT}" /></services>`
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
  return 'Angelisium';
}

app.all('/do/eb', (req, res) => {
  const source = req.method === 'POST' ? req.body : req.query;

  const sid = source.sid || 'debug';
  const rawBouille = source.b || source.s || source.f || '';
  const bouille = normalizeBouilleState(rawBouille);
  const username = resolveUsernameFromSid(sid);

  if (!sessions[sid]) {
    sessions[sid] = { user: username, createdAt: Date.now() };
  } else if (!sessions[sid].user) {
    sessions[sid].user = username;
  }

  if (!users[username]) {
    users[username] = {
      pass: '',
      xp: 10000,
      kikooz: 50,
      fbouille: DEFAULT_BOUILLE_STATE,
      items: withDefaultPens([]),
      gender: 'M',
      birthday: '2000-01-01',
      country: 'FR',
      region: 'IDF',
      prefs: '',
    };
  }

  users[username].fbouille = bouille;

  console.log(`[do/eb] Saved bouille for ${username}: ${bouille}`);
  // Legacy callers consume LoadVars here; include k=0 to avoid error.http.undefined
  // while keeping historical bouille fields.
  res.type('text/plain').send(`state=0&k=0&b=${bouille}&s=${bouille}&f=${bouille}`);
});

// ─────────────────────────────────────────────
// ENDPOINT: do/gmi — Get my info (user profile data)
// Returns LoadVars with user profile fields
// ─────────────────────────────────────────────
app.get('/do/gmi', (req, res) => {
  const sid = req.query.sid;
  const session = sessions[sid];
  const username = (session && session.user) || 'Angelisium';
  const user = users[username] || users['Angelisium'];

  const params = new URLSearchParams({
    state: '0',
    l: username,
    x: String(user.xp || 0),
    k: String(user.kikooz || 0),
    f: bouilleOf(user),
    sx: user.gender || 'M',
    bd: user.birthday || '2000-01-01',
    co: user.country || 'FR',
    rg: user.region || '',
  });
  res.type('text/plain').send(params.toString());
});

// ─────────────────────────────────────────────
// ENDPOINT: do/prefsavepartial — Save one preference
// Returns LoadVars: state=0
// ─────────────────────────────────────────────
app.get('/do/prefsavepartial', (req, res) => {
  res.type('text/plain').send('state=0');
});

// Legacy preferences form endpoint used by some SWF flows
app.get('/prefForm', (req, res) => {
  res.type('text/plain').send('state=0');
});

// ─────────────────────────────────────────────
// ENDPOINT: do/onident — Post-identification data
// Returns XML with kikooz, items, prefs, logs, etc.
// ─────────────────────────────────────────────
app.get('/do/onident', (req, res) => {
  const sid = req.query.sid;
  const session = sessions[sid];
  const username = (session && session.user) || 'Angelisium';
  const user = users[username] || users['Angelisium'];

  user.items = withDefaultPens(user.items);
  const items = user.items.join(',');
  const myPref = user.prefs || '';
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

  // The "f" attribute, when present, forces the SWF to open the editbouille
  // window with the listed part families. Used for first-time avatar setup.
  // Families 0-8 are the main customizable parts (capuche, yeux, bouche, etc.)
  const fAttr = user.needsBouille ? ' f="0,1,2,3,4,5,6,7,8"' : '';
  if (user.needsBouille) {
    user.needsBouille = false; // Only force once per session
  }

  const xml = `<r k="${user.kikooz}" p="${now}" i="${items}"${fAttr}><mp><![CDATA[${myPref}]]></mp><ul><!--empty--></ul><sl><!--empty--></sl><bl>${buildBouilleListXml()}</bl></r>`;

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

// ─────────────────────────────────────────────
// ENDPOINT: do/ld — Load game disc
// Returns XML
// ─────────────────────────────────────────────
app.get('/do/ld', (req, res) => {
  const discId = req.query.u || 'unknown';
  const discMap = {
    kaluga1: {
      t: '0',
      pm: 'single',
      n: 'kaluga',
      u: '/swf/games/kaluga/kaluga.swf',
      p: 'w=700;h=480;m=i',
      swfList: [
        '/swf/games/kaluga/kaluga.swf',
        '/swf/sd/kaluga_tz.swf',
        '/swf/sd/kaluga_panier.swf',
      ],
    },
    mb21: {
      t: '0',
      pm: 'single',
      n: 'kaluga',
      u: '/swf/games/kaluga/kaluga.swf',
      p: 'w=700;h=480;m=i',
      swfList: [
        '/swf/games/kaluga/kaluga.swf',
        '/swf/sd/kaluga_tz.swf',
        '/swf/sd/kaluga_panier.swf',
      ],
    },
    swapou21: {
      t: '0',
      pm: 'single',
      n: 'kaluga',
      u: '/swf/games/kaluga/kaluga.swf',
      p: 'w=700;h=480;m=i',
      swfList: [
        '/swf/games/kaluga/kaluga.swf',
        '/swf/sd/kaluga_tz.swf',
        '/swf/sd/kaluga_panier.swf',
      ],
    },
  };

  const game = discMap[discId] || discMap.kaluga1;
  // Legacy loader prepends host on its side; keep <s u> relative to avoid host duplication.
  const swfNodes = game.swfList.map((u) => `<s u="${u}" />`).join('');
  res.type('text/xml').send(
    `<game t="${game.t}" pm="${game.pm}" n="${game.u}" u="${discId}" p="${game.p}">${swfNodes}</game>`
  );
});

// ─────────────────────────────────────────────
// ENDPOINT: ff/tree — File system tree
// Returns XML
// ─────────────────────────────────────────────
app.get('/ff/tree', (req, res) => {
  res.type('text/xml').send(FILE_TREE_XML);
});

// ─────────────────────────────────────────────
// ENDPOINT: ff/ls — List folder contents
// Returns XML
// ─────────────────────────────────────────────
app.get('/ff/ls', (req, res) => {
  const uid = req.query.uid || 'root';
  const sid = req.query.sid;
  const session = sid ? sessions[sid] : null;
  const username = (session && session.user) || 'Angelisium';
  const user = users[username] || users['Angelisium'];
  ensureContactLists(user);
  const currentBouille = bouilleOf(user);
  const bouilleBase = `${currentBouille}${DEFAULT_BOUILLE_STATE}`.slice(0, 15);
  const accessoryTailA = '30x0t0w0D';
  const accessoryBouilleA = `${bouilleBase}${accessoryTailA}`;
  if (uid === 'root' || uid === 'desktop') {
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
      `<f u="inventory">
        <e u="moutarde" t="wallpaper" s="10" d="0" a="0">Chavelier moutarde
wal/ch.jpg
4E5464;</e>
        <e u="chorale" t="wallpaper" s="10" d="0" a="0">Chorale Frutiparc
wal/fp.jpg
ADE76B;</e>
        <e u="pixiz" t="wallpaper" s="10" d="0" a="0">Pixiz
wal/pi.jpg
F9D190;</e>
        <e u="utopiz" t="wallpaper" s="10" d="0" a="0">Utopiz
wal/ut.jpg
F6AFA9;</e>
        <e u="my_bouille_current" t="bouille" s="10" d="0" a="0">Ma bouille actuelle
${escapeXml(currentBouille)}</e>
        <e u="my_bouille_test_1" t="bouille" s="10" d="0" a="0">Accessoire tail 30x0t0w0D
${escapeXml(accessoryBouilleA)}</e>
        <e u="my_bouille_test_2" t="bouille" s="10" d="0" a="0">Test bouille #2
${escapeXml(currentBouille)}</e>
      </f>`
    );
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
    return res.type('text/xml').send(
      `<f u="disccollector">
        <e u="kaluga1" t="disc" s="10" d="0" a="0">0
kaluga</e>
      </f>`
    );
  }

  // Return an empty folder listing with a placeholder node to avoid legacy null-firstChild edge cases
  return res.type('text/xml').send(`<f u="${uid}"><i /></f>`);
});

// ─────────────────────────────────────────────
// ENDPOINT: ff/mk — Create file/folder
// Returns XML
// ─────────────────────────────────────────────
app.get('/ff/mk', (req, res) => {
  const sid = req.query.sid;
  const session = sid ? sessions[sid] : null;
  const username = (session && session.user) || 'Angelisium';
  const user = users[username] || users['Angelisium'];
  ensureContactLists(user);

  const newUid = 'f' + crypto.randomBytes(4).toString('hex');
  const folder = req.query.folder || '';
  const type = req.query.t || 'file';
  const desc = String(req.query.d || '');
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

  if (type === 'contact' && (folder === 'mycontact' || folder === 'blacklist')) {
    const addr = desc.split('\n')[0].trim();
    const list = folder === 'blacklist' ? user.blacklist : user.contacts;
    if (addr && !list.includes(addr)) list.push(addr);
    const local = addr.split('@')[0] || addr || newUid;
    return res.type('text/xml').send(`<r u="${escapeXml(local)}" t="contact" f="${folder}" d="${now}">${escapeXml(addr)}</r>`);
  }

  res.type('text/xml').send(`<r u="${newUid}" t="${type}" f="${folder}" d="${now}">${desc}</r>`);
});

// ─────────────────────────────────────────────
// ENDPOINT: ff/mv — Move file
// Returns XML
// ─────────────────────────────────────────────
app.get('/ff/mv', (req, res) => {
  const file = req.query.f || '';
  const folder = req.query.folder || '';
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  res.type('text/xml').send(`<r f="${folder}"><f n="${file}" t="file" d="${now}" p="">moved</f></r>`);
});

// ─────────────────────────────────────────────
// ENDPOINT: ff/cp — Copy file
// Returns XML
// ─────────────────────────────────────────────
app.get('/ff/cp', (req, res) => {
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
// ENDPOINT: ff/dm — Delete mail
// ─────────────────────────────────────────────
app.get('/ff/dm', (req, res) => {
  res.type('text/plain').send('state=0');
});

// ─────────────────────────────────────────────
// ENDPOINT: h/send_debug — Debug logging (POST)
// ─────────────────────────────────────────────
app.post('/h/send_debug', (req, res) => {
  const sid = sidFromRequest(req);
  const txt = req.body.txt || '';
  console.log('[debug from SWF]', txt);
  recordFrusionEvent(sid, 'swf_debug', { txt });
  res.type('text/plain').send('state=0');
});

app.get(['/debug/frusion-state', '/debug/frusion-state/', '/debug/frusion-state/all'], (req, res) => {
  const sid = sidFromRequest(req) || req.query.sid || '';
  const events = sid ? (frusionTrace[sid] || []) : (frusionTrace.__all || []);
  const availableSids = Object.keys(frusionTrace).filter((k) => !k.startsWith('__'));
  res.json({ ok: true, sid, count: events.length, availableSids, events });
});

// ─────────────────────────────────────────────
// Serve SWF assets under /swf/* (used by the JS fetch interceptor rewrite)
// ─────────────────────────────────────────────
// Compatibility aliases for patched legacy Frusion constants (15-char slash-safe names)
app.get('/animfrusion.sw', (req, res) => res.sendFile(path.join(__dirname, 'public', 'animfrusion.swf')));
app.get('/skinFrusion.sw', (req, res) => res.sendFile(path.join(__dirname, 'public', 'skinFrusion.swf')));

app.use('/swf/games/kaluga', express.static(path.join(__dirname, 'Games', 'kaluga')));
app.use('/swf', express.static(path.join(__dirname, 'public', 'swf')));

// ─────────────────────────────────────────────
// Serve static files AFTER API routes so our endpoints take priority
// ─────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
// Fallback: swf.frutiparc.com URLs resolve to root paths (/wheel/wheel1.swf)
// but files live under public/swf/. This second mount acts as fallback.
app.use(express.static(path.join(__dirname, 'public', 'swf')));

// ─────────────────────────────────────────────
// Catch-all 404 with logging (helps diagnose missing assets)
// ─────────────────────────────────────────────
app.use((req, res) => {
  console.log(`[404]   ${req.method} ${req.url}`);
  res.status(404).type('text/plain').send('Not found');
});

// ─────────────────────────────────────────────
// Health check
// ─────────────────────────────────────────────
app.get('/healthz', (req, res) => {
  res.json({ ok: true, service: 'frutiparc-backend' });
});

// ─────────────────────────────────────────────
// Start HTTP server
// ─────────────────────────────────────────────
const server = app.listen(port, () => {
  console.log(`[HTTP]  Server running on http://localhost:${port}`);
  console.log(`        Legacy SWF:  http://localhost:${port}/legacy`);
  console.log(`[BOOT]  XMLSOCKET_PORT=${XMLSOCKET_PORT}`);
  warnIfStubSwfAssets();
});

// ─────────────────────────────────────────────
// WebSocket → TCP bridge for Ruffle's socketProxy
//
// Ruffle's socketProxy emulates a raw TCP socket over WebSocket.
// Flash XMLSocket uses \0 as message delimiter.
// The bridge MUST preserve \0 in BOTH directions so Ruffle's
// internal XMLSocket parser can split messages correctly.
// ─────────────────────────────────────────────
const wss = new WebSocketServer({ server });
wss.on('connection', (ws) => {
  console.log('[WS→TCP] New WebSocket client, bridging to TCP localhost:' + XMLSOCKET_PORT);

  const tcp = net.createConnection({ host: '127.0.0.1', port: XMLSOCKET_PORT }, () => {
    console.log('[WS→TCP] TCP connection established');
  });

  // WS → TCP: Forward raw data from Ruffle to the CBee TCP server.
  // Ruffle may or may not include \0 — ensure it's there for the TCP side.
  ws.on('message', (msg) => {
    const buf = Buffer.isBuffer(msg) ? msg : Buffer.from(msg);
    const str = buf.toString('utf8');
    console.log('[WS→TCP] WS→TCP:', str.replace(/\0/g, '').substring(0, 200));
    // If the message already ends with \0, forward as-is; otherwise append \0
    if (buf.length > 0 && buf[buf.length - 1] === 0x00) {
      tcp.write(buf);
    } else {
      tcp.write(Buffer.concat([buf, Buffer.from([0x00])]));
    }
  });

  // TCP → WS: Forward raw TCP data to WebSocket, preserving \0 delimiters.
  // Ruffle's XMLSocket parser needs the \0 to know when a message is complete.
  tcp.on('data', (data) => {
    // Log for debugging (strip \0 for readability)
    const str = data.toString('utf8');
    const parts = str.split('\0').filter(s => s.trim().length > 0);
    for (const part of parts) {
      console.log('[WS→TCP] TCP→WS:', part.substring(0, 200));
    }
    // Forward raw bytes including \0 terminators
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
  statusobj:        'statusobj',
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

function resolveKnownUsername(nameOrLower) {
  const raw = String(nameOrLower || '');
  const low = raw.toLowerCase();
  for (const known of Object.keys(users)) {
    if (known.toLowerCase() === low) return known;
  }
  return raw;
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

function buildChannelListXml() {
  let inner = '';
  for (const [name, ch] of Object.entries(channels)) {
    const desc = ch.desc || `Salon ${name.charAt(0).toUpperCase()}${name.slice(1)}`;
    inner += `<g g="${name}" n="${ch.users.size}"><desc>${escapeXml(desc)}</desc></g>`;
  }
  return `<${CMD.channellist}>${inner}</${CMD.channellist}>`;
}

// ─────────────────────────────────────────────
// Handle a single CBee XML message from a client
// ─────────────────────────────────────────────
function handleCBeeMessage(socket, rawXml) {
  const msg = parseXmlAttrs(rawXml);
  const cmdName = CMD_REV[msg.tag] || msg.tag;
  const client = xmlSocketClients.get(socket);
  if (!client) return;

  console.log(`[CBee]  <- ${cmdName} (${msg.tag}) ${JSON.stringify(msg.attrs)}`);

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

    // ── ping: just echo back ──
    case 'ping': {
      sendToClient(socket, `<${CMD.ping} />`);
      break;
    }

    // ── ident: login ──
    case 'ident': {
      const login = msg.attrs.l || '';
      const sid = msg.attrs.s || '';

      // sidAutoInit mode sends l="" — default to Angelisium
      const effectiveLogin = login.length > 0 ? login : 'Angelisium';

      // Auto-create session if needed
      if (sid && !sessions[sid]) {
        sessions[sid] = { user: null, createdAt: Date.now() };
      }
      if (sid && sessions[sid]) {
        sessions[sid].user = effectiveLogin;
      }

      // Auto-create user if doesn't exist
      if (!users[effectiveLogin]) {
        users[effectiveLogin] = {
          pass: '',
          xp: 10000,
          kikooz: 50,
          fbouille: DEFAULT_BOUILLE_STATE,
          items: withDefaultPens([]),
          gender: 'M',
          birthday: '2000-01-01',
          country: 'FR',
          region: 'IDF',
          prefs: '',
        };
      }

      const user = users[effectiveLogin];

      // Success: send ident response with user data
      client.username = effectiveLogin;
      client.sid = sid;
      client.logged = true;

      sendToClient(socket, `<${CMD.ident} l="${effectiveLogin}" x="${user.xp}" f="${bouilleOf(user)}" />`);
      console.log(`[CBee]  User "${effectiveLogin}" logged in (sid=${sid})`);
      break;
    }

    // ── channellist: list available channels ──
    case 'channellist': {
      sendToClient(socket, buildChannelListXml());
      break;
    }

    // ── join: join a channel ──
case 'join': {
  const g = msg.attrs.g;

  if (!channels[g]) {
    if (String(g).indexOf('pm_') === 0) {
      const parts = String(g).split('_');
      const p1 = resolveKnownUsername(parts[1] || '');
      const p2 = resolveKnownUsername(parts[2] || '');
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
  if (channel.private && Array.isArray(channel.participants)) {
    for (const u of channel.participants) channel.users.add(u);
  }
  channel.users.add(client.username);
  client.channels.add(g);

  const userArr = Array.from(channel.users);
  let userXml = '';

  for (const u of userArr) {
    const ud = users[u] || {};
    userXml += `<u u="${escapeXml(u)}" x="${ud.xp || 0}" sx="${ud.gender || 'M'}" bd="${ud.birthday || '2000-01-01.00:00:00'}" co="${ud.country || 'FR'}" rg="${ud.region || ''}" p="1" s="00000" mu="0000-00-00 00:00:00" f="${bouilleOf(ud)}" />`;
  }

  const timeAttrs = buildChatTimeAttrs();

  // 1. Réponse canonique au join
  sendToClient(
    socket,
    `<${CMD.join} g="${g}" p=""><desc>${escapeXml(channel.desc || `Salon ${g}`)}</desc></${CMD.join}>`
  );

  // 2. Liste des utilisateurs
  sendToClient(socket, `<${CMD.userlist} g="${g}">${userXml}</${CMD.userlist}>`);

  // 3. Message système visible dans le chat
  sendToClient(
    socket,
    `<${CMD.send} u="Serveur" t="m" p="" g="${g}" h="${timeAttrs.h}" d="${timeAttrs.d}">Vous discutez à présent sur le salon ${escapeXml(channel.desc || g)}</${CMD.send}>`
  );

  // 4. Notification légère aux autres
broadcastToChannel(
  g,
  `<${CMD.userjoined} u="${escapeXml(client.username)}" g="${g}" />`,
  socket
);
  break;
}

    // ── userlist: explicit request for a channel user list ──
    case 'userlist': {
      const g = msg.attrs.g || '';
      const channel = channels[g];
      if (!channel) {
        sendToClient(socket, `<${CMD.userlist} g="${g}"></${CMD.userlist}>`);
        break;
      }
      const userArr = Array.from(channel.users || []);
      let userXml = '';
      for (const u of userArr) {
        const ud = users[u] || {};
        userXml += `<u u="${escapeXml(u)}" x="${ud.xp || 0}" sx="${ud.gender || 'M'}" bd="${ud.birthday || '2000-01-01.00:00:00'}" co="${ud.country || 'FR'}" rg="${ud.region || ''}" p="1" s="00000" mu="0000-00-00 00:00:00" f="${bouilleOf(ud)}" />`;
      }
      sendToClient(socket, `<${CMD.userlist} g="${g}">${userXml}</${CMD.userlist}>`);
      break;
    }

    // ── part: leave a channel ──
    case 'part': {
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

    // ── send: chat message ──
case 'send': {
  const g = msg.attrs.g;
  const text = msg.content || '';
  const type = msg.attrs.t || 'm';
  const pen = (msg.attrs.p !== undefined) ? msg.attrs.p : '';
  const timeAttrs = buildChatTimeAttrs();

  if (g && client.logged) {
    const safeText = escapeXml(text);
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

    // ── trace: request status updates for users ──
case 'trace': {
  const traceChildren = (msg.children || []).filter(child => child.tag === 'u' && child.attrs.u);

  if (traceChildren.length > 0) {
    let inner = '';

    for (const child of traceChildren) {
      const u = child.attrs.u;
      const ud = users[u] || {};
      inner += `<u u="${u}" p="1" s="00000" mu="0000-00-00 00:00:00" f="${bouilleOf(ud)}" />`;
    }

    sendToClient(socket, `<${CMD.trace}>${inner}</${CMD.trace}>`);
    break;
  }

  const targetUser = msg.attrs.u;
  if (targetUser) {
    const ud = users[targetUser] || users[client.username] || {};
    sendToClient(
      socket,
      `<${CMD.trace} u="${targetUser}" p="1" s="00000" mu="0000-00-00 00:00:00" f="${bouilleOf(ud)}" />`
    );
  }
  break;
}
    // ── stoptrace: stop tracking users ──
    case 'stoptrace': {
      // Just acknowledge — nothing to do server-side in our simple impl
      break;
    }

    // ── status: update user status ──
    case 'status': {
      // Broadcast status to trackers — simplified: just echo back
      const s = msg.attrs.s || '00000';
      sendToClient(socket, `<${CMD.status} s="${s}" />`);
      break;
    }

    // ── userinfo: get user info ──
    case 'userinfo': {
      const u = msg.attrs.u;
      const r = msg.attrs.r || '';
      const ud = users[u] || {};
      sendToClient(socket,
        `<${CMD.userinfo} r="${r}" u="${u}" x="${ud.xp || 0}" sx="${ud.gender || 'M'}" bd="${ud.birthday || ''}" co="${ud.country || 'FR'}" rg="${ud.region || ''}" />`
      );
      break;
    }

    // ── xpposition: XP ranking position ──
    case 'xpposition': {
      sendToClient(socket, `<${CMD.xpposition} p="1" />`);
      break;
    }

case 'fbouille': {
  const f = normalizeBouilleState(msg.attrs.f || DEFAULT_BOUILLE_STATE);

  if (client.username && users[client.username]) {
    users[client.username].fbouille = f;
  }

  sendToClient(socket, `<${CMD.fbouille} f="${f}" />`);
  break;
}

case 'createchannel': {
  const otherUser = msg.attrs.u || '';
  const requester = client.username || '';
  const title = msg.content || otherUser || 'Discussion privée';

  if (!otherUser || !requester) {
    sendToClient(socket, `<${CMD.error} />`);
    break;
  }

  const sortedUsers = [requester.toLowerCase(), otherUser.toLowerCase()].sort();
  const privateGroup = `pm_${sortedUsers[0]}_${sortedUsers[1]}`;
  const privatePass = `pw_${sortedUsers[0].slice(0, 4)}_${sortedUsers[1].slice(0, 4)}`;

  if (!channels[privateGroup]) {
    channels[privateGroup] = {
      desc: `Discussion privée ${requester}/${otherUser}`,
      topic: title,
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
    `<${CMD.createchannel} u="${escapeXml(otherUser)}" g="${privateGroup}" p="${privatePass}">${escapeXml(title)}</${CMD.createchannel}>`
  );

  // Invite "privée" envoyée au demandeur pour ouvrir immédiatement la box
  sendToClient(
    socket,
    `<${CMD.invitechat} u="${escapeXml(otherUser)}" g="${privateGroup}" p="${privatePass}" />`
  );

  // On pousse aussi les infos connues sur l’autre user
  const ud = users[otherUser] || {
    xp: 10000,
    gender: 'M',
    birthday: '2000-01-01.00:00:00',
    country: 'FR',
    region: '',
    fbouille: DEFAULT_BOUILLE_STATE,
  };

  sendToClient(
    socket,
    `<${CMD.userinfo} r="pm" u="${escapeXml(otherUser)}" x="${ud.xp || 0}" sx="${ud.gender || 'M'}" bd="${ud.birthday || '2000-01-01.00:00:00'}" co="${ud.country || 'FR'}" rg="${ud.region || ''}" />`
  );

  sendToClient(
    socket,
    `<${CMD.trace} u="${escapeXml(otherUser)}" p="1" s="00000" mu="0000-00-00 00:00:00" f="${bouilleOf(ud)}" />`
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
        inner += `<u u="${name}" f="${bouilleOf(ud)}" x="${ud.xp || 0}" />`;
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
        handleCBeeMessage(socket, trimmed);
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
