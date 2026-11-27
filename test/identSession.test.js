'use strict';
/*
 * L'IDENTIFICATION AU CHAT VIENT DE LA SESSION, ET D'ELLE SEULE.
 *
 * `<k l="pseudo" s="sid"/>` acceptait jadis le pseudo annoncé quand le sid ne
 * disait rien — et fabriquait une session à ce nom avec le sid fourni. On
 * prenait ainsi le compte de n'importe qui, sans son mot de passe : au chat,
 * et sur toutes les routes HTTP qui lisent le sid (profil, inventaire…).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const PORT = 3741;
const BASE = `http://127.0.0.1:${PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let proc = null;

before(async () => {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', XMLSOCKET_PORT: '5741', FRUTISCORE_PORT: '5742',
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

const post = (url, body) => fetch(BASE + url, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}).then((r) => r.json());

/** Ouvre une socket de chat, envoie l'ident, rend la première réponse `<k …>`. */
async function identifier(l, s) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/`);
  let recu = '';
  ws.on('message', (d) => { recu += d.toString('utf8'); });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  ws.send(`<k l="${l}" s="${s}" lc="1" />\0`);
  for (let i = 0; i < 60; i++) {
    const m = recu.match(/<k [^>]*\/>/);
    if (m) { ws.close(); return m[0]; }
    await wait(50);
  }
  ws.close();
  throw new Error('pas de réponse à l’ident : ' + recu.slice(0, 200));
}

test('un sid inventé ne donne pas le compte annoncé', async () => {
  const r = await post('/api/auth/register', { username: 'victimeid', password: 'secret123', email: 'v@example.test' });
  assert.ok(r.ok, JSON.stringify(r));
  const rep = await identifier('victimeid', 'sid-invente-0123456789');
  assert.match(rep, /k="401"/, 'l’ident doit être refusé : ' + rep);
  // Et surtout, le sid inventé n'est pas devenu une session à son nom.
  const profil = await fetch(BASE + '/api/light/profil?sid=sid-invente-0123456789');
  assert.strictEqual(profil.status, 401);
});

test('sans sid, le pseudo annoncé ne suffit pas', async () => {
  const rep = await identifier('victimeid', '');
  assert.match(rep, /k="401"/, rep);
});

test('un pseudo inconnu ne crée plus de compte (modérateur) en mémoire', async () => {
  const rep = await identifier('fantomeid', 'autre-sid-invente');
  assert.match(rep, /k="401"/, rep);
  const r = await post('/api/auth/register', { username: 'fantomeid', password: 'secret123', email: 'f@example.test' });
  assert.ok(r.ok, 'le pseudo doit rester libre : ' + JSON.stringify(r));
});

test('la session d’une vraie connexion identifie toujours', async () => {
  await post('/api/auth/register', { username: 'honnete', password: 'secret123', email: 'h@example.test' });
  const c = await post('/api/auth/login', { username: 'honnete', password: 'secret123' });
  assert.ok(c.sid, JSON.stringify(c));
  // Le `l` annoncé n'a plus d'effet : c'est la session qui parle.
  const rep = await identifier('quelquunDautre', c.sid);
  assert.match(rep, /l="honnete"/i, rep);
});
