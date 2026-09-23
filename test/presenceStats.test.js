'use strict';
/*
 * La présence du jour et l'onglet Statistiques de l'admin, contre une vraie
 * base (sauté sans Postgres de test) :
 *
 *   · se connecter inscrit le Frutiz dans « aujourd'hui » (/api/online-count
 *     today), une seule fois quoi qu'il fasse, et la base le garde ;
 *   · /api/admin/stats rend les totaux, une ligne par jour, les parties par
 *     jeu — et reste fermé à qui n'est pas administrateur complet.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Client } = require('pg');

const RACINE = path.join(__dirname, '..');
const PORT = 3453;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-de-test';
const DB = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/frutiparc_presence';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let proc, dispo = false;

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
function demarrer() {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: RACINE,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: DB, REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5184', FRUTISCORE_PORT: '5185',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
}
async function pret() {
  for (let i = 0; i < 160; i++) {
    try { if ((await fetch(BASE + '/api/online-count')).ok) return; } catch { /* pas prêt */ }
    await wait(250);
  }
}

before(async () => {
  dispo = await baseNeuve();
  if (!dispo) return;
  demarrer();
  await pret();
});
after(() => { if (proc) proc.kill('SIGKILL'); });

const json = (url, opts) => fetch(BASE + url, opts).then((r) => r.json().then((j) => Object.assign({ statut: r.status }, j)));
const poster = (url, corps) => json(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps) });
const admin = (url) => json(url, { headers: { 'x-admin-key': CLE } });
async function inscrireEtConnecter(pseudo) {
  await poster('/api/auth/register', { username: pseudo, password: 'secret123' });
  const r = await poster('/api/auth/login', { username: pseudo, password: 'secret123' });
  assert.ok(r.sid, 'connecté : ' + JSON.stringify(r));
  return r.sid;
}

test('se connecter compte pour aujourd’hui, une fois, et la base s’en souvient', async (t) => {
  if (!dispo) return t.skip('Postgres de test indisponible');
  const avant = await json('/api/online-count');
  assert.strictEqual(avant.ok, true);
  assert.strictEqual(typeof avant.today, 'number');
  await inscrireEtConnecter('Pomme');
  await inscrireEtConnecter('Kiwi');
  await poster('/api/auth/login', { username: 'Pomme', password: 'secret123' });   // une seconde fois
  const apres = await json('/api/online-count');
  assert.strictEqual(apres.today, avant.today + 2, 'deux Frutiz différents');
  assert.strictEqual(apres.count, 0, 'personne sur une socket');
  // Et en base.
  await wait(300);
  const c = new Client({ connectionString: DB });
  await c.connect();
  const { rows } = await c.query('SELECT username FROM presence_jour ORDER BY username');
  await c.end();
  assert.deepStrictEqual(rows.map((r) => r.username), ['kiwi', 'pomme']);
  // Un redémarrage ne remet pas le compteur à zéro.
  proc.kill('SIGKILL');
  await wait(500);
  demarrer();
  await pret();
  await wait(500);
  assert.strictEqual((await json('/api/online-count')).today, apres.today);
});

test('l’onglet Statistiques : totaux, jour par jour, parties par jeu — administrateurs seulement', async (t) => {
  if (!dispo) return t.skip('Postgres de test indisponible');
  const sid = await inscrireEtConnecter('Cerise');
  // Une course de Burning Kiwi en essai (score = temps en ms) : une partie.
  const s = await json('/api/saveScore?' + new URLSearchParams({ sid, game: 'bkiwi', score: '95000', data: 'Sonic Brain:3:1', track: '2', gm: '0' }));
  assert.strictEqual(s.ok, true, JSON.stringify(s));
  // Une course en Challenge écrit DEUX classements (le record du circuit et
  // le Challenge du jour) dans la même requête : une seule partie. Et une
  // autre course quelques secondes plus tard en est bien une seconde.
  await wait(3200);
  const c = await json('/api/saveScore?' + new URLSearchParams({ sid, game: 'bkiwi', score: '94000', data: 'Sonic Brain:3:1', track: '2', gm: '1' }));
  assert.strictEqual(c.ok, true, JSON.stringify(c));
  await wait(300);
  // Fermé sans clé.
  assert.strictEqual((await json('/api/admin/stats')).statut, 403);
  const d = await admin('/api/admin/stats?jours=7');
  assert.strictEqual(d.ok, true, JSON.stringify(d));
  assert.strictEqual(d.base, true);
  assert.strictEqual(d.jours.length, 7);
  assert.ok(d.totaux.comptes >= 3, JSON.stringify(d.totaux));
  assert.ok(d.totaux.inscrits_jour >= 3 && d.totaux.actifs_7 >= 3, JSON.stringify(d.totaux));
  const auj = d.jours[6];
  assert.ok(auj.connectes >= 3, JSON.stringify(auj));
  assert.ok(auj.inscrits >= 3, JSON.stringify(auj));
  assert.deepStrictEqual(auj.parties, { bkiwi: 2 }, 'deux courses, pas trois écritures');
  assert.deepStrictEqual(d.jeux.bkiwi, { semaine: 2, fenetre: 2 });
  assert.strictEqual(typeof d.direct.enLigne, 'number');
  // Les jours d'avant la table : rien d'inventé.
  assert.strictEqual(d.jours[0].connectes, undefined);
  // La fenêtre est bornée.
  assert.strictEqual((await admin('/api/admin/stats?jours=500')).jours.length, 90);
});
