const express = require('express');
const { WebSocketServer } = require('ws');
const net = require('net');
const crypto = require('crypto');
const path = require('path');

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
// The patched SWF replaces hardcoded domains with localhost:8888/<prefix>
// so that every replacement is the exact same byte-length as the original.
//   www.beta.frutiparc.com  (22) → localhost:8888/betawww (22)
//   swf.beta.frutiparc.com  (22) → localhost:8888/betaswf (22)
//   swf.frutiparc.com       (17) → localhost:8888/sw      (17)
// This middleware strips the prefix so the rest of the server sees clean paths.
app.use((req, res, next) => {
  if (req.url.startsWith('/betawww/') || req.url === '/betawww') {
    req.url = req.url.substring(8) || '/';           // strip '/betawww'
  } else if (req.url.startsWith('/betaswf/') || req.url === '/betaswf') {
    req.url = req.url.substring(8) || '/';           // strip '/betaswf'
  } else if (req.url.startsWith('/sw/') || req.url === '/sw') {
    req.url = req.url.substring(3) || '/';           // strip '/sw'
  }
  // Also collapse any residual double slashes
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

const port = process.env.PORT || 8888;
const XMLSOCKET_PORT = 5173; // Port for the CBee XMLSocket server

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

// ─────────────────────────────────────────────
// In-memory state
// ─────────────────────────────────────────────
const sessions = {};       // sid -> { user, createdAt }
const users = {};          // username -> { pass, xp, kikooz, fbouille, items, prefs }

// Default user for quick testing
users['Angelisium'] = {
  pass: 'test',
  xp: 4680000,
  kikooz: 150,
  fbouille: '000503000000111010',
  items: [1, 2, 3],
  gender: 'M',
  birthday: '1990-05-15',
  country: 'FR',
  region: 'IDF',
  prefs: '',
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

// ─────────────────────────────────────────────
// File system tree (virtual)
// b = "messages;inbox;outbox;blackbox;draftbox;disccollector;inventory;mycontact;recyclebin"
// ─────────────────────────────────────────────
const FILE_TREE_XML = `<s u="root" n="Bureau" t="desktop" b="messages;inbox;outbox;blackbox;draftbox;disccollector;inventory;mycontact;recyclebin">
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

app.get('/legacy/main.swf', (req, res) => {
  res.sendFile(path.join(__dirname, 'legacy', 'main.swf'));
});

// Explicit route for fileIcon.swf — Ruffle's loadMovie() fetches this
// during the loading screen.  Serving it explicitly (with logging and
// correct Content-Type) helps diagnose and resolve pending-fetch issues.
app.get('/fileIcon.swf', (req, res) => {
  console.log('[SWF]   fileIcon.swf requested');
  res.type('application/x-shockwave-flash');
  res.sendFile(path.join(__dirname, 'public', 'fileIcon.swf'));
});

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
// ENDPOINT: do/prefsavepartial — Save one preference
// Returns LoadVars: state=0
// ─────────────────────────────────────────────
app.get('/do/prefsavepartial', (req, res) => {
  res.type('text/plain').send('state=0');
});

// ─────────────────────────────────────────────
// ENDPOINT: do/onident — Post-identification data
// Returns XML with kikooz, items, prefs, logs, etc.
// ─────────────────────────────────────────────
app.get('/do/onident', (req, res) => {
  const sid = req.query.sid;
  const session = sessions[sid];
  const username = session ? session.user : 'Angelisium';
  const user = users[username] || users['Angelisium'];

  const items = (user.items || []).join(',');
  const myPref = user.prefs || '';
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

  const xml = `<r k="${user.kikooz}" p="${now}" i="${items}" f="">
  <mp>${myPref}</mp>
  <ul></ul>
  <sl></sl>
  <bl></bl>
</r>`;

  res.type('text/xml').send(xml);
});

// ─────────────────────────────────────────────
// ENDPOINT: do/ld — Load game disc
// Returns XML
// ─────────────────────────────────────────────
app.get('/do/ld', (req, res) => {
  const discId = req.query.u || 'unknown';
  res.type('text/xml').send(`<r u="${discId}" />`);
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
  // Return an empty folder listing — the SWF will display an empty desktop/contacts
  res.type('text/xml').send(`<f u="${uid}"></f>`);
});

// ─────────────────────────────────────────────
// ENDPOINT: ff/mk — Create file/folder
// Returns XML
// ─────────────────────────────────────────────
app.get('/ff/mk', (req, res) => {
  const newUid = 'f' + crypto.randomBytes(4).toString('hex');
  const folder = req.query.folder || '';
  const type = req.query.t || 'file';
  const desc = req.query.d || '';
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
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
  console.log('[debug from SWF]', req.body.txt || '');
  res.type('text/plain').send('state=0');
});

// ─────────────────────────────────────────────
// Serve static files AFTER API routes so our endpoints take priority
// ─────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
// Fallback: swf.frutiparc.com URLs resolve to root paths (/wheel/wheel1.swf)
// but files live under public/swf/. This second mount acts as fallback.
app.use(express.static(path.join(__dirname, 'public', 'swf')));

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
});

// ─────────────────────────────────────────────
// WebSocket server (kept for future use)
// ─────────────────────────────────────────────
const wss = new WebSocketServer({ server });
wss.on('connection', (ws) => {
  ws.on('message', (msg) => {
    ws.send(`echo: ${msg}`);
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

function formatDateTime(d) {
  return d.toISOString().replace('T', ' ').substring(0, 19);
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
      const ipAddr = socket.remoteAddress || '127.0.0.1';
      sendToClient(socket, `<${CMD.ip}>${ipAddr}</${CMD.ip}>`);
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
      const login = msg.attrs.l;
      const sid = msg.attrs.s;

      // Link session to socket
      if (sid && sessions[sid]) {
        sessions[sid].user = login || sessions[sid].user;
      }

      // Auto-create user if doesn't exist
      if (login && !users[login]) {
        users[login] = {
          pass: '',
          xp: 10000,
          kikooz: 50,
          fbouille: '000503000000111010',
          items: [],
          gender: 'M',
          birthday: '2000-01-01',
          country: 'FR',
          region: 'IDF',
          prefs: '',
        };
      }

      const user = login ? users[login] : null;

      if (user || (sid && sessions[sid])) {
        // Success: send ident response with user data
        client.username = login || 'Guest';
        client.sid = sid;
        client.logged = true;
        if (sid && sessions[sid]) {
          sessions[sid].user = client.username;
        }

        const xp = user ? user.xp : 10000;
        const fbouille = user ? user.fbouille : '000503000000111010';
        sendToClient(socket, `<${CMD.ident} l="${client.username}" x="${xp}" f="${fbouille}" />`);
        console.log(`[CBee]  User "${client.username}" logged in`);
      } else {
        // Failure
        sendToClient(socket, `<${CMD.ident} k="1" />`);
      }
      break;
    }

    // ── channellist: list available channels ──
    case 'channellist': {
      let inner = '';
      for (const [name, ch] of Object.entries(channels)) {
        inner += `<g g="${name}"><t>${ch.topic}</t></g>`;
      }
      sendToClient(socket, `<${CMD.channellist}>${inner}</${CMD.channellist}>`);
      break;
    }

    // ── join: join a channel ──
    case 'join': {
      const g = msg.attrs.g;
      if (!channels[g]) {
        channels[g] = { topic: `Salon ${g}`, users: new Set() };
      }
      channels[g].users.add(client.username);
      client.channels.add(g);

      // Send userlist for this channel
      const userArr = Array.from(channels[g].users);
      let userXml = '';
      for (const u of userArr) {
        const ud = users[u] || {};
        userXml += `<u u="${u}" f="${ud.fbouille || '000503000000111010'}" s="00000" p="1" x="${ud.xp || 0}" sx="${ud.gender || 'M'}" bd="${ud.birthday || ''}" co="${ud.country || 'FR'}" rg="${ud.region || ''}" />`;
      }
      sendToClient(socket, `<${CMD.userlist} g="${g}">${userXml}</${CMD.userlist}>`);

      // Send topic
      sendToClient(socket, `<${CMD.topic} g="${g}">${channels[g].topic}</${CMD.topic}>`);

      // Notify others
      const ud = users[client.username] || {};
      broadcastToChannel(g,
        `<${CMD.userjoined} g="${g}" u="${client.username}" f="${ud.fbouille || '000503000000111010'}" s="00000" p="1" x="${ud.xp || 0}" sx="${ud.gender || 'M'}" bd="${ud.birthday || ''}" co="${ud.country || 'FR'}" rg="${ud.region || ''}" />`,
        socket
      );
      break;
    }

    // ── part: leave a channel ──
    case 'part': {
      const g = msg.attrs.g;
      if (channels[g]) {
        channels[g].users.delete(client.username);
        client.channels.delete(g);
        broadcastToChannel(g,
          `<${CMD.userleaved} g="${g}" u="${client.username}" />`
        );
      }
      break;
    }

    // ── send: chat message ──
    case 'send': {
      const g = msg.attrs.g;
      const text = msg.content || '';
      if (g && client.logged) {
        // Public message to channel
        broadcastToChannel(g,
          `<${CMD.send} g="${g}" u="${client.username}">${text}</${CMD.send}>`
        );
      } else if (msg.attrs.u) {
        // Private message
        const targetUser = msg.attrs.u;
        for (const [sock, cl] of xmlSocketClients) {
          if (cl.username === targetUser) {
            sendToClient(sock,
              `<${CMD.send} u="${client.username}">${text}</${CMD.send}>`
            );
            break;
          }
        }
      }
      break;
    }

    // ── trace: request status updates for users ──
    case 'trace': {
      // Respond with current status for requested users
      const targetUser = msg.attrs.u;
      if (targetUser) {
        const ud = users[targetUser] || users[client.username] || {};
        sendToClient(socket,
          `<${CMD.trace} u="${targetUser}" f="${ud.fbouille || '000503000000111010'}" p="1" s="00000" />`
        );
      }
      // If children contain <u> elements, respond for each
      for (const child of msg.children) {
        if (child.tag === 'u' && child.attrs.u) {
          const u = child.attrs.u;
          const ud = users[u] || {};
          sendToClient(socket,
            `<${CMD.trace} u="${u}" f="${ud.fbouille || '000503000000111010'}" p="1" s="00000" />`
          );
        }
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

    // ── fbouille: update avatar ──
    case 'fbouille': {
      const f = msg.attrs.f;
      if (f && client.username && users[client.username]) {
        users[client.username].fbouille = f;
      }
      sendToClient(socket, `<${CMD.fbouille} f="${f || ''}" />`);
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
