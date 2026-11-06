'use strict';
/*
 * LE CADEAU DES 100 JOURS.
 *
 * « J'aimerais offrir un cadeau à tous les users qui atteignent les 100 jours
 * de connexion consécutifs. Je pensais à cet accessoire
 * "0005000Q010t0a040f0t0j0o" (il faudra évidemment ajuster les premiers
 * chiffres qui correspondent à ma bouille). »
 *
 * Les neuf derniers caractères sont l'accessoire (40f0t0j0o) ; les quinze
 * premiers, la bouille de celui qui le reçoit. L'article (630100) est une
 * récompense hors rayons, comme le Makulo.
 *
 * La série se pose en base serveur arrêté (la mémoire du serveur fait foi tant
 * qu'il tourne), puis chacun se connecte : la connexion du jour fait la série.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { Client } = require('pg');
const WebSocket = require(path.join(__dirname, '..', 'node_modules', 'ws'));

const ROOT = path.join(__dirname, '..');
const PORT = 3667;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.TEST_DATABASE_URL_SERIE || 'postgres://postgres@127.0.0.1:5433/frutiparc_cadeau_serie';
const DONNEES = fs.mkdtempSync(path.join(os.tmpdir(), 'frutiparc-cadeau-serie-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const H = { 'Content-Type': 'application/json' };
const SERVEUR = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

let proc = null, dispo = false;
async function baseNeuve() {
  const admin = new Client({ connectionString: DB.replace(/\/[^/]+$/, '/postgres') });
  try {
    await admin.connect();
    const nom = DB.split('/').pop();
    await admin.query(`DROP DATABASE IF EXISTS ${nom}`);
    await admin.query(`CREATE DATABASE ${nom}`);
    await admin.end();
    return true;
  } catch { try { await admin.end(); } catch {} return false; }
}
async function sql(q, params) {
  const c = new Client({ connectionString: DB });
  await c.connect();
  try { return (await c.query(q, params)).rows; } finally { await c.end(); }
}
async function demarrer() {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: DB, REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: 'cle-cadeau-serie', XMLSOCKET_PORT: '5797', FRUTISCORE_PORT: '5798', FRUTI_DATA_DIR: DONNEES,
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 160; i++) {
    try { if ((await fetch(BASE + '/api/loadFrutiSlots?game=snake3')).ok) return; } catch {}
    await wait(250);
  }
  throw new Error('serveur indisponible');
}
async function arreter() {
  if (!proc) return;
  const p = proc; proc = null;
  await new Promise((r) => { p.once('exit', r); p.kill('SIGKILL'); });
}
before(async () => {
  dispo = await baseNeuve();
  if (dispo) await demarrer();
});
after(async () => {
  await arreter();
  try { fs.rmSync(DONNEES, { recursive: true, force: true }); } catch { /* déjà parti */ }
});

const post = (url, body) => fetch(BASE + url, { method: 'POST', headers: H, body: JSON.stringify(body) }).then((r) => r.json());
const hier = () => {
  const d = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date()) + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().substring(0, 10);
};

// Se connecter « pour de vrai » : la socket identifiée, c'est elle qui compte
// la connexion du jour.
async function connecter(pseudo) {
  // Juste après un redémarrage, la base peut répondre un instant après HTTP.
  let r = {};
  for (let i = 0; i < 20 && !r.sid; i++) {
    r = await post('/api/auth/login', { username: pseudo, password: 'secret123' }).catch(() => ({}));
    if (!r.sid) await wait(250);
  }
  const sid = r.sid;
  assert.ok(sid, 'session de ' + pseudo + ' : ' + JSON.stringify(r));
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/`);
  let recu = '';
  ws.on('message', (d) => { recu += d.toString('utf8'); });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  ws.send(`<k l="${pseudo}" s="${sid}" lc="1" />\0`);
  for (let i = 0; i < 80 && !recu.includes('<k'); i++) await wait(50);
  assert.ok(recu.includes('<k'), pseudo + ' identifié');
  await wait(400);
  ws.close();
}
const cadeaux = (pseudo) => sql(
  `SELECT a.shop_id, a.name, a.value, u.fbouille FROM user_accessories a JOIN users u ON u.id = a.user_id
    WHERE u.username = $1 AND a.shop_id = 630100`, [pseudo]);

test('l’article est une récompense hors rayons, avec l’accessoire demandé', () => {
  assert.match(SERVEUR, /id: 630100,\s*\n\s*name: 'Cadeau des 100 jours',[\s\S]{0,300}?suffix9: '40f0t0j0o',\s*\n\s*recompense: true,/);
  assert.match(SERVEUR, /const SERIE_CADEAU_JOURS = 100;/);
  assert.match(SERVEUR, /if \(streak >= SERIE_CADEAU_JOURS\) offrirCadeauSerie\(username, streak\);/);
});

test('la 100e connexion d’affilée offre l’accessoire, sur la bouille du joueur, une seule fois', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  for (const p of ['fidele', 'presque', 'ancien']) await post('/api/auth/register', { username: p, password: 'secret123' });
  await wait(500);
  await arreter();
  // fidele en est à 99 jours, presque à 98, ancien a déjà dépassé les 100.
  await sql(`UPDATE users SET daily_kikooz_day = $1, daily_streak = 99 WHERE username = 'fidele'`, [hier()]);
  await sql(`UPDATE users SET daily_kikooz_day = $1, daily_streak = 98 WHERE username = 'presque'`, [hier()]);
  await sql(`UPDATE users SET daily_kikooz_day = $1, daily_streak = 140 WHERE username = 'ancien'`, [hier()]);
  await demarrer();
  for (const p of ['fidele', 'presque', 'ancien']) await connecter(p);

  const series = await sql(`SELECT username, daily_streak FROM users WHERE username IN ('fidele', 'presque', 'ancien') ORDER BY username`);
  assert.deepEqual(series.map((r) => [r.username, Number(r.daily_streak)]), [['ancien', 141], ['fidele', 100], ['presque', 99]]);

  const [c] = await cadeaux('fidele');
  assert.ok(c, 'fidele reçoit son cadeau à 100 jours');
  assert.equal(c.name, 'Cadeau des 100 jours');
  assert.equal(c.value.length, 24);
  assert.equal(c.value, String(c.fbouille).substring(0, 15) + '40f0t0j0o', 'sa bouille, avec l’accessoire');
  assert.equal((await cadeaux('ancien')).length, 1, 'déjà au-delà de 100 : il le reçoit à sa connexion');
  assert.equal((await cadeaux('presque')).length, 0, '99 jours : pas encore');
  const msg = await sql(`SELECT l.content FROM user_logs l JOIN users u ON u.id = l.user_id
    WHERE u.username = 'fidele' AND l.content LIKE '%Cadeau des 100 jours%'`);
  assert.equal(msg.length, 1);
  assert.match(msg[0].content, /^100 jours de connexion d'affilée ! .*l'accessoire Cadeau des 100 jours t'attend dans ton inventaire\.$/);

  // Le lendemain (série 101) : la possession fait foi, pas de second exemplaire.
  await arreter();
  await sql(`UPDATE users SET daily_kikooz_day = $1 WHERE username = 'fidele'`, [hier()]);
  await demarrer();
  await connecter('fidele');
  assert.equal(Number((await sql(`SELECT daily_streak FROM users WHERE username = 'fidele'`))[0].daily_streak), 101);
  assert.equal((await cadeaux('fidele')).length, 1, 'un seul cadeau');
});
