#!/usr/bin/env node
// Smoke test for the Frutiparc server.
//
// Verifies a curated list of HTTP routes (plus one WebSocket chat round-trip)
// against a running server. Each check is structural: HTTP status + presence
// of a marker token in the body / response headers. The goal is to catch
// routes that disappeared or started 500'ing after a refactor, not to do
// exact byte-for-byte regression.
//
// Usage:
//   node tools/smoke.js                       # default: port 8888
//   node tools/smoke.js --port 8889
//   ADMIN_KEY=xxx node tools/smoke.js         # enables admin checks
//
// Exit codes:
//   0  all checks passed
//   1  at least one check failed
//   2  bootstrap failed (couldn't even register/login)
//
// The test user (smoketest / smoketest123) is created on first run via
// /api/auth/register and reused thereafter. It persists in the live DB.

const http = require('http');
const WebSocket = require('ws');

const args = parseArgs(process.argv.slice(2));
const PORT = parseInt(args.port || process.env.PORT || '8888', 10);
const HOST = args.host || '127.0.0.1';
const ADMIN_KEY = args['admin-key'] || process.env.ADMIN_KEY || '';
const USER = args.user || 'smoketest';
const PASSWORD = args.password || 'smoketest123';
const BASE = `http://${HOST}:${PORT}`;

const RED = '\x1b[31m', GREEN = '\x1b[32m', DIM = '\x1b[2m', RESET = '\x1b[0m';

let sid = '';            // anonymous sid from /do/init
let userSid = '';        // sid bound to the logged-in test user
let passed = 0, failed = 0;
const failures = [];

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) { out[key] = next; i++; }
    else out[key] = true;
  }
  return out;
}

function request(method, path, opts = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const headers = Object.assign({ 'User-Agent': 'frutiparc-smoke/1' }, opts.headers || {});
    let body = opts.body;
    if (body && typeof body !== 'string') {
      if (opts.json) {
        body = JSON.stringify(body);
        headers['Content-Type'] = 'application/json';
      } else {
        body = new URLSearchParams(body).toString();
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
      }
    }
    if (body) headers['Content-Length'] = Buffer.byteLength(body);
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers,
      timeout: 10000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function record(label, ok, detail = '') {
  if (ok) {
    passed++;
    console.log(`  ${GREEN}✓${RESET} ${label}`);
  } else {
    failed++;
    failures.push(detail ? `${label} — ${detail}` : label);
    console.log(`  ${RED}✗${RESET} ${label}${detail ? `  ${DIM}${detail}${RESET}` : ''}`);
  }
}

// `expectStatus` may be a single status code or an array of acceptable codes.
// Routes that depend on the SQL database may legitimately return 500 in dev
// environments without DATABASE_URL — we still want to verify the route
// itself is wired (i.e. doesn't 404), so we accept 500 there.
async function checkHttp(label, method, path, opts, expectStatus, contains) {
  try {
    const res = await request(method, path, opts);
    const acceptable = Array.isArray(expectStatus) ? expectStatus : [expectStatus];
    let ok = acceptable.includes(res.status);
    let detail = ok ? '' : `status=${res.status}`;
    if (ok && contains && !res.body.includes(contains)) {
      ok = false; detail = `body missing "${contains}"`;
    }
    record(label, ok, detail);
    return res;
  } catch (e) {
    record(label, false, e.message);
    return null;
  }
}

async function checkHead(label, method, path, opts, predicate) {
  try {
    const res = await request(method, path, opts);
    const { ok, detail } = predicate(res);
    record(label, ok, detail || '');
    return res;
  } catch (e) {
    record(label, false, e.message);
    return null;
  }
}

async function ensureTestUser() {
  const reg = await request('POST', '/api/auth/register', { json: true, body: { username: USER, password: PASSWORD } });
  if (reg.status !== 200 && reg.status !== 409) {
    throw new Error(`register failed: ${reg.status} ${reg.body.slice(0, 200)}`);
  }
  const login = await request('POST', '/api/auth/login', { json: true, body: { username: USER, password: PASSWORD } });
  if (login.status !== 200) throw new Error(`login failed: ${login.status} ${login.body.slice(0, 200)}`);
  const data = JSON.parse(login.body);
  userSid = data.sid;
  if (!userSid) throw new Error('login response missing sid');

  const init = await request('GET', '/do/init');
  const m = init.body.match(/sid=([0-9a-f]+)/);
  if (!m) throw new Error('do/init did not return sid=');
  sid = m[1];
}

async function wsChatTest() {
  return new Promise((resolve) => {
    let gotReply = false;
    const ws = new WebSocket(`ws://${HOST}:${PORT}/`);
    const timer = setTimeout(() => {
      record('WS /  ident round-trip', gotReply, gotReply ? '' : 'no CBee reply within 4s');
      try { ws.close(); } catch {}
      resolve();
    }, 4000);
    ws.on('open', () => {
      // Bridge takes a tick to establish TCP. Give it a moment.
      setTimeout(() => {
        try { ws.send(`<k l="${USER}" s="${userSid}" />\0`); }
        catch (e) { record('WS chat send', false, e.message); }
      }, 200);
    });
    ws.on('message', (data) => {
      const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
      if (/<\w/.test(text)) gotReply = true;
    });
    ws.on('error', (e) => {
      clearTimeout(timer);
      record('WS /  connect', false, e.message);
      resolve();
    });
  });
}

(async () => {
  console.log(`${DIM}[smoke]${RESET} target: ${BASE}   user: ${USER}`);
  console.log('');

  console.log('— Bootstrap —');
  try {
    await ensureTestUser();
    record('Test user + anonymous + authenticated sid ready', true);
  } catch (e) {
    record('Bootstrap', false, e.message);
    console.log(`\n${RED}[smoke] bootstrap failed, aborting${RESET}`);
    process.exit(2);
  }
  console.log('');

  console.log('— Public HTTP —');
  await checkHttp('GET /healthz', 'GET', '/healthz', {}, 200);
  await checkHttp('GET /do/init', 'GET', '/do/init', {}, 200, 'sid=');
  await checkHttp('GET /do/prefdef', 'GET', '/do/prefdef', {}, 200, 'PrefDef=');
  await checkHttp('GET /xml/services.xml', 'GET', '/xml/services.xml', {}, 200, '<services');
  console.log('');

  console.log('— SWF (authenticated) —');
  await checkHttp('GET /do/onident', 'GET', `/do/onident?sid=${userSid}&l=${USER}`, {}, 200, '<r k=');
  await checkHttp('GET /do/mypref', 'GET', `/do/mypref?sid=${userSid}`, {}, 200, 'myPref=');
  await checkHttp('GET /do/gmi', 'GET', `/do/gmi?sid=${userSid}`, {}, 200);
  await checkHttp('GET /ft/tree', 'GET', `/ft/tree?sid=${userSid}`, {}, 200, '<c');
  await checkHttp('GET /ft/pack id=101', 'GET', `/ft/pack?sid=${userSid}&id=101`, {}, 200, '<p');
  await checkHttp('GET /ff/tree', 'GET', `/ff/tree?sid=${userSid}`, {}, 200, '<f');
  await checkHttp('GET /ff/ls inbox', 'GET', `/ff/ls?sid=${userSid}&p=inbox`, {}, 200);
  // Gaspard /fh/get returns "Erreur serveur" XML when no topics are seeded —
  // that's still a live route (200 + well-formed XML). Don't pin on content.
  await checkHttp('GET /fh/get (Gaspard route alive)', 'GET', '/fh/get?i=1', {}, 200, '<');
  console.log('');

  console.log('— Game / scores —');
  await checkHttp('GET /api/saveScore bkiwi', 'GET',
    `/api/saveScore?sid=${userSid}&game=bkiwi&score=4200`, {}, 200, '"ok":true');
  await checkHttp('GET /api/loadFrutiSlots bkiwi', 'GET',
    `/api/loadFrutiSlots?sid=${userSid}&game=bkiwi`, {}, 200, 'ok=');
  console.log('');

  console.log('— Forum & pictos —');
  await checkHttp('GET /api/forum/index', 'GET', '/api/forum/index', {}, 200);
  await checkHttp('GET /api/forum/board/1', 'GET', '/api/forum/board/1', {}, 200);
  await checkHttp('GET /api/pictos', 'GET', '/api/pictos', {}, 200);
  console.log('');

  console.log('— Static —');
  // main.swf is optional — it's not committed to the repo (large binary asset
  // pulled in at deploy time). Skip cleanly when missing.
  await checkHead('HEAD /main.swf (optional)', 'HEAD', '/main.swf', {}, (res) => {
    if (res.status === 404) return { ok: true, detail: 'not deployed (skipped)' };
    return {
      ok: res.status === 200
          && !!res.headers['content-length']
          && (res.headers['content-type'] || '').includes('shockwave-flash'),
      detail: `status=${res.status} ct=${res.headers['content-type']} cl=${res.headers['content-length']}`,
    };
  });
  await checkHttp('GET /fileIcon.swf', 'GET', '/fileIcon.swf', {}, 200);
  await checkHttp('GET /admin (HTML)', 'GET', '/admin', {}, 200, '<html');
  console.log('');

  if (ADMIN_KEY) {
    console.log('— Admin (ADMIN_KEY set) —');
    const adminH = { 'X-Admin-Key': ADMIN_KEY };
    await checkHttp('GET /api/admin/users', 'GET', '/api/admin/users', { headers: adminH }, 200);
    await checkHttp('GET /api/admin/shop', 'GET', '/api/admin/shop', { headers: adminH }, 200);
    await checkHttp('GET /api/admin/scores', 'GET', '/api/admin/scores', { headers: adminH }, 200);
    // DB-dependent: 500 acceptable when DATABASE_URL is unset (dev env).
    await checkHttp('GET /api/admin/gaspard/topics (route alive)', 'GET', '/api/admin/gaspard/topics', { headers: adminH }, [200, 500]);
    await checkHttp('GET /api/admin/channels', 'GET', '/api/admin/channels', { headers: adminH }, 200);
    await checkHttp('GET /api/admin/challenge/status', 'GET', '/api/admin/challenge/status', { headers: adminH }, 200);
    console.log('');
  } else {
    console.log(`${DIM}— Admin (skipped: set ADMIN_KEY=... to run admin checks) —${RESET}`);
    console.log('');
  }

  console.log('— WebSocket chat (CBee bridge) —');
  await wsChatTest();
  console.log('');

  console.log(`${DIM}[smoke]${RESET} ${passed} passed, ${failed} failed`);
  if (failed) {
    console.log(`${RED}Failures:${RESET}`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
})().catch((e) => {
  console.error(`\n[smoke] unexpected error: ${e.message}`);
  process.exit(2);
});
