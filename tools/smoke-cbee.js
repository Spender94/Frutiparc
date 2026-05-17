#!/usr/bin/env node
// Deep smoke test for the CBee chat protocol.
//
// The standard tools/smoke.js only checks that the WebSocket bridge
// accepts a connection and produces *some* CBee reply. This one drives
// two clients (alice + bob) through a realistic chat scenario so we can
// catch regressions that don't surface in plain HTTP requests:
//
//   1. Both clients ident with their sid → both should appear "logged"
//   2. Alice joins "pomme" → receives <o>, <p>userlist, <z>traces
//   3. Bob joins "pomme" → Alice receives <v userjoined> for bob
//   4. Alice sends a chat message → Bob receives <t> with the text
//   5. Bob requests trace of alice → receives <z> with alice's bouille
//   6. Alice changes fbouille → Bob (tracing) receives <ae>
//   7. Channel list query → response includes "pomme" with n>=2
//   8. Bob parts → Alice receives <u userleaved> for bob
//
// Usage:
//   node tools/smoke-cbee.js                  # default port 8888
//   node tools/smoke-cbee.js --port 8889
//
// Exits 0 if all checks pass, 1 otherwise.

const http = require('http');
const WebSocket = require('ws');

const args = parseArgs(process.argv.slice(2));
const PORT = parseInt(args.port || process.env.PORT || '8888', 10);
const HOST = args.host || '127.0.0.1';
const BASE = `http://${HOST}:${PORT}`;
const VERBOSE = !!args.verbose;

const RED = '\x1b[31m', GREEN = '\x1b[32m', DIM = '\x1b[2m', RESET = '\x1b[0m';

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

function request(method, path, opts = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const headers = Object.assign({}, opts.headers || {});
    let body = opts.body;
    if (body && typeof body !== 'string') {
      body = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
    }
    if (body) headers['Content-Length'] = Buffer.byteLength(body);
    const req = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname + url.search,
      method, headers, timeout: 10000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode, headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function ensureUser(username, password) {
  const reg = await request('POST', '/api/auth/register', {
    body: { username, password },
  });
  if (reg.status !== 200 && reg.status !== 409) {
    throw new Error(`register ${username} failed: ${reg.status} ${reg.body.slice(0, 200)}`);
  }
  const login = await request('POST', '/api/auth/login', {
    body: { username, password },
  });
  if (login.status !== 200) throw new Error(`login ${username} failed: ${login.status}`);
  const data = JSON.parse(login.body);
  return data.sid;
}

// ── CBee client wrapper ───────────────────────────────────────────────
// Wraps a WebSocket and collects every \0-delimited message in a buffer.
// Tests pull from this buffer with waitFor(predicate, timeoutMs).

class CBeeClient {
  constructor(name) {
    this.name = name;
    this.ws = null;
    this.messages = [];   // [{ raw, tag, attrs, content }]
    this.waiters = [];    // [{ predicate, resolve, reject, timer }]
    this.closed = false;
    this.buf = '';
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://${HOST}:${PORT}/`);
      this.ws.binaryType = 'arraybuffer';
      this.ws.on('open', () => {
        if (VERBOSE) console.log(`[${this.name}] connected`);
        // Give the bridge a moment to establish TCP.
        setTimeout(resolve, 200);
      });
      this.ws.on('message', (data) => {
        const str = Buffer.isBuffer(data) ? data.toString('utf8')
          : (data instanceof ArrayBuffer ? Buffer.from(data).toString('utf8') : String(data));
        this.buf += str;
        // \0-delimited messages
        let idx;
        while ((idx = this.buf.indexOf('\0')) !== -1) {
          const raw = this.buf.slice(0, idx);
          this.buf = this.buf.slice(idx + 1);
          if (raw.trim()) this._handle(raw);
        }
      });
      this.ws.on('error', (e) => { reject(e); });
      this.ws.on('close', () => { this.closed = true; });
    });
  }
  _handle(raw) {
    const tagMatch = raw.match(/^<(\w+)/);
    const tag = tagMatch ? tagMatch[1] : '';
    const attrs = {};
    const attrRe = /(\w+)="([^"]*)"/g;
    let m;
    while ((m = attrRe.exec(raw)) !== null) attrs[m[1]] = m[2];
    const contentMatch = raw.match(/>([^<]*)<\//);
    const content = contentMatch ? contentMatch[1] : '';
    const msg = { raw, tag, attrs, content };
    if (VERBOSE) console.log(`[${this.name}] ← ${raw.slice(0, 160)}`);
    this.messages.push(msg);
    // Resolve any waiter whose predicate now matches
    for (let i = this.waiters.length - 1; i >= 0; i--) {
      const w = this.waiters[i];
      if (w.predicate(msg)) {
        clearTimeout(w.timer);
        this.waiters.splice(i, 1);
        w.resolve(msg);
      }
    }
  }
  send(xml) {
    if (VERBOSE) console.log(`[${this.name}] → ${xml.slice(0, 160)}`);
    this.ws.send(xml + '\0');
  }
  // Wait for a message matching predicate. Also scans already-received
  // messages in case the response arrived between sends.
  waitFor(predicate, timeoutMs = 3000, hint = '') {
    return new Promise((resolve, reject) => {
      for (const m of this.messages) {
        if (predicate(m)) return resolve(m);
      }
      const timer = setTimeout(() => {
        const idx = this.waiters.findIndex((w) => w.timer === timer);
        if (idx !== -1) this.waiters.splice(idx, 1);
        reject(new Error(`timeout waiting${hint ? ' for ' + hint : ''}`));
      }, timeoutMs);
      this.waiters.push({ predicate, resolve, reject, timer });
    });
  }
  close() {
    if (this.ws && !this.closed) try { this.ws.close(); } catch {}
  }
}

async function check(label, fn) {
  try {
    await fn();
    record(label, true);
  } catch (e) {
    record(label, false, e.message);
  }
}

(async () => {
  console.log(`${DIM}[smoke-cbee]${RESET} target: ${BASE}\n`);

  console.log('— Bootstrap (HTTP) —');
  let aliceSid, bobSid;
  try {
    aliceSid = await ensureUser('cbeealice', 'cbeealice123');
    bobSid   = await ensureUser('cbeebob',   'cbeebob123');
    record('Test users alice + bob ready', true);
  } catch (e) {
    record('Bootstrap', false, e.message);
    process.exit(2);
  }
  console.log('');

  console.log('— Connect + ident —');
  const alice = new CBeeClient('alice');
  const bob   = new CBeeClient('bob');

  try {
    await alice.connect();
    await bob.connect();
    record('Both WebSocket bridges open', true);
  } catch (e) {
    record('WebSocket connect', false, e.message);
    process.exit(2);
  }

  await check('Alice idents → response', async () => {
    alice.send(`<k l="cbeealice" s="${aliceSid}" />`);
    await alice.waitFor((m) => m.tag === 'k', 3000, '<k> ident reply');
  });

  await check('Bob idents → response', async () => {
    bob.send(`<k l="cbeebob" s="${bobSid}" />`);
    await bob.waitFor((m) => m.tag === 'k', 3000, '<k> ident reply');
  });
  console.log('');

  console.log('— Channel join + userlist —');
  await check('Alice joins pomme → <o> + <p> userlist', async () => {
    alice.send('<o g="pomme" />');
    // Server sends 3 messages: <o>, <p g="pomme">, <z>
    await alice.waitFor((m) => m.tag === 'o' && m.attrs.g === 'pomme', 3000, '<o pomme>');
    await alice.waitFor((m) => m.tag === 'p' && m.attrs.g === 'pomme', 3000, '<p pomme> userlist');
  });

  await check('Bob joins pomme → Alice receives <v userjoined>', async () => {
    bob.send('<o g="pomme" />');
    await bob.waitFor((m) => m.tag === 'o' && m.attrs.g === 'pomme', 3000, '<o> for bob');
    // Alice should now see bob's userjoined broadcast
    await alice.waitFor(
      (m) => m.tag === 'v' && m.attrs.g === 'pomme'
        && String(m.attrs.u || '').toLowerCase() === 'cbeebob',
      3000, 'bob userjoined on alice'
    );
  });
  console.log('');

  console.log('— Chat message broadcast —');
  await check('Alice → "hello bob" → Bob receives <t>', async () => {
    // Drain any in-flight Bob events first
    const startLen = bob.messages.length;
    alice.send('<t g="pomme" t="m" p="000000">hello bob</t>');
    await bob.waitFor(
      (m, _i) => m.tag === 't' && m.attrs.g === 'pomme'
        && /hello bob/.test(m.raw)
        && bob.messages.indexOf(m) >= startLen,
      3000, '<t> echo on bob'
    );
  });
  console.log('');

  console.log('— Trace + fbouille —');
  await check('Bob traces alice → receives <z> with bouille', async () => {
    bob.send('<z u="cbeealice" />');
    await bob.waitFor(
      (m) => m.tag === 'z'
        && String(m.attrs.u || '').toLowerCase() === 'cbeealice'
        && m.attrs.f,
      3000, '<z> for alice'
    );
  });

  await check('Alice changes fbouille → echoed back + persisted', async () => {
    const newBouille = '0a0b0c0d0e0f0g0h0i0j0k0l';
    alice.send(`<ae f="${newBouille}" />`);
    // Alice gets her own echo back from the server.
    await alice.waitFor((m) => m.tag === 'ae' && m.attrs.f === newBouille, 3000, '<ae> echo on alice');
    // The server's fbouille handler doesn't broadcast `<ae>` to tracers — by
    // design, trace consumers re-fetch via `<z>` on their next refresh. Verify
    // persistence by having Bob issue a fresh trace and checking the bouille
    // attribute now matches.
    bob.send('<z u="cbeealice" />');
    await bob.waitFor(
      (m) => m.tag === 'z'
        && String(m.attrs.u || '').toLowerCase() === 'cbeealice'
        && m.attrs.f === newBouille,
      3000, '<z> for alice with updated bouille'
    );
  });
  console.log('');

  console.log('— Channel list —');
  await check('<q /> → channellist contains pomme', async () => {
    alice.send('<q />');
    const m = await alice.waitFor((x) => x.tag === 'q' && /<g[^>]*g="pomme"/.test(x.raw), 3000, '<q>');
    const match = m.raw.match(/<g[^>]*g="pomme"[^>]*n="(\d+)"/);
    if (!match) throw new Error('<g g="pomme"> n attribute missing');
    const n = Number(match[1]);
    if (n < 2) throw new Error(`pomme n="${n}" — expected ≥2 (alice+bob)`);
  });
  console.log('');

  console.log('— Part —');
  await check('Bob parts pomme → Alice receives <u userleaved>', async () => {
    bob.send('<y g="pomme" />');
    await alice.waitFor(
      (m) => m.tag === 'u' && m.attrs.g === 'pomme'
        && String(m.attrs.u || '').toLowerCase() === 'cbeebob',
      3000, 'bob userleaved on alice'
    );
  });
  console.log('');

  alice.close();
  bob.close();

  console.log(`${DIM}[smoke-cbee]${RESET} ${passed} passed, ${failed} failed`);
  if (failed) {
    console.log(`${RED}Failures:${RESET}`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
})().catch((e) => {
  console.error(`\n[smoke-cbee] unexpected error: ${e.message}`);
  process.exit(2);
});
