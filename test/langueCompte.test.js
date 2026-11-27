'use strict';
/*
 * LA LANGUE DU COMPTE : choisie à l'inscription (ou devinée du navigateur),
 * rendue à la connexion pour que le client la range dans fp_lang, changée par
 * /api/light/langue.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3743;
const BASE = `http://127.0.0.1:${PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let proc = null;

before(async () => {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', XMLSOCKET_PORT: '5743', FRUTISCORE_PORT: '5744',
      REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {}); proc.stderr.on('data', () => {});
  for (let i = 0; i < 200; i++) {
    try { if ((await fetch(BASE + '/do/prefdef')).ok) return; } catch { /* pas prêt */ }
    await wait(250);
  }
  throw new Error('serveur indisponible');
});
after(() => { if (proc) proc.kill('SIGKILL'); });

const post = (url, body, entetes) => fetch(BASE + url, {
  method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, entetes || {}), body: JSON.stringify(body),
}).then(async (r) => ({ statut: r.status, json: await r.json().catch(() => ({})) }));

test('la langue choisie à l’inscription revient à la connexion', async () => {
  await post('/api/auth/register', { username: 'anglophone', password: 'secret123', lang: 'en' });
  const c = await post('/api/auth/login', { username: 'anglophone', password: 'secret123' });
  assert.strictEqual(c.json.lang, 'en');
});

test('sans choix, la langue du navigateur ; et le français par défaut', async () => {
  await post('/api/auth/register', { username: 'britannique', password: 'secret123' }, { 'Accept-Language': 'en-GB,en;q=0.9' });
  await post('/api/auth/register', { username: 'quebecois', password: 'secret123' }, { 'Accept-Language': 'fr-CA,fr;q=0.9,en;q=0.5' });
  await post('/api/auth/register', { username: 'sansentete', password: 'secret123' });
  assert.strictEqual((await post('/api/auth/login', { username: 'britannique', password: 'secret123' })).json.lang, 'en');
  assert.strictEqual((await post('/api/auth/login', { username: 'quebecois', password: 'secret123' })).json.lang, 'fr');
  assert.strictEqual((await post('/api/auth/login', { username: 'sansentete', password: 'secret123' })).json.lang, 'fr');
});

test('/api/light/langue change la langue du compte, et refuse le reste', async () => {
  await post('/api/auth/register', { username: 'bilingue', password: 'secret123', lang: 'fr' });
  const c = await post('/api/auth/login', { username: 'bilingue', password: 'secret123' });
  assert.strictEqual(c.json.lang, 'fr');
  const r = await post('/api/light/langue', { sid: c.json.sid, lang: 'en' });
  assert.deepStrictEqual(r.json, { ok: true, lang: 'en' });
  assert.strictEqual((await post('/api/auth/login', { username: 'bilingue', password: 'secret123' })).json.lang, 'en');
  assert.strictEqual((await post('/api/light/langue', { sid: c.json.sid, lang: 'de' })).statut, 400);
  assert.strictEqual((await post('/api/light/langue', { sid: 'inconnu', lang: 'en' })).statut, 401);
});
