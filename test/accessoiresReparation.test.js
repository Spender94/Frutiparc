'use strict';
/*
 * LES DONS D'AVANT LE CORRECTIF REVIENNENT — contre une vraie base (sautée sans
 * Postgres sur 5433).
 *
 * « Les accessoires distribués pré-Halloween (Kirby, SOAD) n'apparaissent plus
 * dans l'inventaire et ne sont pas dispo pour poster sur le forum — peut-on
 * récupérer ceux qui ont été distribués ? » Les lignes étaient restées en base,
 * avec la valeur que la fiche joueur rangeait telle quelle : un suffixe de neuf
 * caractères, ou rien quand on ne choisissait que l'article. Au démarrage, le
 * serveur les complète par la règle du don ; ce qu'il ne sait pas compléter
 * reste intact.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'));

const ROOT = path.join(__dirname, '..');
const PORT = 3657;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-de-test';
const DB = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/frutiparc_accrepar';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let proc = null, dispo = false;
const dossiers = [];

async function baseNeuve() {
  const admin = new Client({ connectionString: DB.replace(/\/[^/]+$/, '/postgres') });
  try {
    await admin.connect();
    const nom = DB.split('/').pop();
    await admin.query(`DROP DATABASE IF EXISTS ${nom}`);
    await admin.query(`CREATE DATABASE ${nom}`);
    await admin.end();
    return true;
  } catch { try { await admin.end(); } catch { /* rien */ } return false; }
}

// Un serveur sur un dossier de données NEUF : le disque d'un conteneur redéployé.
async function demarrer() {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-accrepar-'));
  dossiers.push(data);
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: DB, REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5697', FRUTISCORE_PORT: '5698', FRUTI_DATA_DIR: data,
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {}); proc.stderr.on('data', () => {});
  for (let i = 0; i < 200; i++) {
    try { if ((await fetch(BASE + '/api/online-count')).ok) break; } catch { /* pas prêt */ }
    await wait(250);
  }
  // Le chargement de la base (articles, accessoires maison…) suit l'ouverture du port.
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(BASE + '/api/admin/shop', { headers: { 'x-admin-key': CLE } });
      if (r.ok && (await r.json()).length) break;
    } catch { /* pas prêt */ }
    await wait(250);
  }
  await wait(1500);
}
async function arreter() {
  if (!proc) return;
  const p = proc; proc = null;
  await new Promise((ok) => { p.once('exit', ok); p.kill('SIGKILL'); });
}

before(async () => {
  dispo = await baseNeuve();
  if (dispo) await demarrer();
});
after(async () => {
  await arreter();
  for (const d of dossiers) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* rien */ } }
});

const json = (r) => r.json();
const adm = (url, opts = {}) => fetch(BASE + url, Object.assign({}, opts,
  { headers: Object.assign({ 'x-admin-key': CLE, 'Content-Type': 'application/json' }, opts.headers || {}) }));
async function connecter(pseudo, inscrire) {
  const body = JSON.stringify({ username: pseudo, password: 'secret123' });
  const h = { 'Content-Type': 'application/json' };
  if (inscrire) await fetch(BASE + '/api/auth/register', { method: 'POST', headers: h, body });
  const j = await json(await fetch(BASE + '/api/auth/login', { method: 'POST', headers: h, body }));
  assert.ok(j.sid, 'session de ' + pseudo);
  return j.sid;
}
const inventaire = (sid) => fetch(`${BASE}/api/light/inventaire?sid=${sid}`).then(json);
const boutique = (sid) => fetch(`${BASE}/api/light/shop?sid=${sid}`).then(json);
const possede = (shop, id) => shop.categories.some((c) => (c.items || []).some((it) => it.id === id && it.owned));


test('les dons incomplets d’avant le correctif sont complétés au démarrage', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  await connecter('Kirbyfan', true);
  const fb = '0002000k03090e0000000000';
  assert.strictEqual((await json(await adm('/api/admin/users/kirbyfan', { method: 'PATCH',
    body: JSON.stringify({ fbouille: fb, kikooz: 0, xp: 0 }) }))).ok, true);
  const packs = await json(await adm('/api/admin/shop'));
  const [p1, p2] = packs.filter((p) => p.category === 'Accessoires' && /^[0-9A-Za-z]{9}$/.test(p.suffix9 || '')
    && p.suffix9 !== '000000000' && !p.disabled && !p.recompense).slice(0, 2);
  assert.ok(p1 && p2, 'deux accessoires en rayon');

  // Les lignes telles que l'ancienne fiche joueur les écrivait.
  const pg = new Client({ connectionString: DB });
  await pg.connect();
  const { rows: [u] } = await pg.query("SELECT id FROM users WHERE lower(username) = 'kirbyfan'");
  const ins = (acc, shop, nom, val) => pg.query(
    'INSERT INTO user_accessories (user_id, acc_id, shop_id, name, value, quantity, price) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [u.id, acc, shop, nom, val, '1', '0']);
  await ins('admin_1', null, 'Kirby', p1.suffix9);         // le suffixe tapé
  await ins('admin_2', p2.id, 'SOAD', '');                  // juste l'article
  await ins('admin_3', null, 'Lien', 'http://exemple/x.png'); // on ne sait pas
  await pg.end();

  // Le redémarrage (le déploiement du correctif) répare.
  await arreter();
  await demarrer();
  const sid = await connecter('kirbyfan', false);
  const inv = await json(await fetch(`${BASE}/api/light/inventaire?sid=${sid}`));
  const etat = (id) => (inv.accessoires.find((a) => a.id === id) || {}).etat;
  assert.strictEqual(etat('admin_1'), fb.substring(0, 15) + p1.suffix9, 'Kirby revient, portable');
  assert.strictEqual(etat('admin_2'), fb.substring(0, 15) + p2.suffix9, 'SOAD revient, par son article');
  const me = await json(await fetch(`${BASE}/api/forum/me?sid=${sid}`));
  const val = (id) => ((me.accessories || []).find((a) => a.id === id) || {}).value;
  assert.strictEqual(val('admin_1'), fb.substring(0, 15) + p1.suffix9, 'et le forum le propose');
  assert.strictEqual(val('admin_2'), fb.substring(0, 15) + p2.suffix9);

  // Ce qu'on ne sait pas compléter reste tel quel ; une seconde passe ne change rien.
  const fiche = await json(await adm('/api/admin/users/kirbyfan'));
  assert.strictEqual(fiche.accessories.find((a) => a.id === 'admin_3').v, 'http://exemple/x.png');
  const r = await json(await adm('/api/admin/accessoires/reparer', { method: 'POST' }));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.repares.length, 0, 'idempotent');
  assert.deepStrictEqual(r.restes.map((x) => x.nom), ['Lien']);
});
