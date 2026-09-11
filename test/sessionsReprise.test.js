/*
 * LES SESSIONS SURVIVENT À UN REDÉMARRAGE.
 *
 * `sessions` ne vivait qu'en mémoire. La table `sessions` était pourtant tenue
 * depuis toujours — écrite à la connexion, effacée à la déconnexion, purgée
 * par la rétention RGPD — mais jamais relue : chaque mise en ligne (le disque
 * est éphémère là où le site tourne) déconnectait tout le monde d'un coup, et
 * en silence pour un jeu qui n'envoie son score qu'à la fin d'une longue
 * partie. Mini-Fever finissait sur « mode difficile terminé ! », le serveur
 * répondait « session », et personne ne le voyait.
 *
 * Au démarrage, les sessions de la base reviennent DORMANTES ; chacune se
 * réveille à son premier appel, ce qui hydrate son compte comme le ferait la
 * connexion. Une session fermée, elle, ne revient pas.
 *
 * Il faut Postgres : sans base, tout ce fichier se passe (skip).
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'));

const ROOT = path.join(__dirname, '..');
const PORT = 3574;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/frutiparc_sessions';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let proc = null, dispo = false, journal = '';

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

function lancer() {
  journal = '';
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: DB, REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: 'cle-sessions', XMLSOCKET_PORT: '5390', FRUTISCORE_PORT: '5391',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', (d) => { journal += d.toString(); });
  proc.stderr.on('data', () => {});
}

async function attendre() {
  for (let i = 0; i < 160; i++) {
    try {
      if ((await fetch(BASE + '/api/loadFrutiSlots?game=snake3')).ok) {
        const c = new Client({ connectionString: DB });
        await c.connect();
        const { rows } = await c.query(
          `SELECT 1 FROM information_schema.tables WHERE table_name = 'sessions'`);
        await c.end();
        if (rows.length) return;
      }
    } catch {}
    await wait(250);
  }
  throw new Error('serveur ou schéma indisponible');
}

// Le serveur tombe pour de bon — comme à chaque mise en ligne.
async function arreter() {
  if (!proc) return;
  const p = proc;
  proc = null;
  const parti = new Promise((r) => p.once('exit', r));
  p.kill('SIGKILL');
  await parti;
  await wait(300);                     // que le port soit rendu
}

before(async () => {
  dispo = await baseNeuve();
  if (!dispo) return;
  lancer();
  await attendre();
});
after(async () => { await arreter(); });

const H = { 'Content-Type': 'application/json' };
const qui = (sid) => fetch(`${BASE}/api/forum/me?sid=${encodeURIComponent(sid)}`)
  .then((r) => r.json()).then((d) => d.user || null);
async function connecter(username) {
  const body = JSON.stringify({ username, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: H, body });
  const j = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: H, body })).json();
  assert.ok(j.sid, 'connexion → sid');
  return j.sid;
}

let sidDormeur = '';

test('une session survit au redémarrage, et le score d\'une partie finie après lui aussi', async (t) => {
  if (!dispo) { t.skip('base Postgres indisponible'); return; }
  sidDormeur = await connecter('dormeur');
  assert.equal(await qui(sidDormeur), 'dormeur');

  await arreter();
  lancer();
  await attendre();
  assert.match(journal, /\[DB\] \d+ session\(s\) reprise\(s\) de la base, dormantes jusqu'à leur premier appel/);

  // Sans se reconnecter : la session est là, et le compte derrière elle.
  assert.equal(await qui(sidDormeur), 'dormeur');

  // La partie de Mini-Fever finie APRÈS la mise en ligne est classée — c'était
  // la plainte : « mes scores ne s'enregistrent pas ».
  const r = await (await fetch(BASE + '/api/minifever/score', {
    method: 'POST', headers: H,
    body: JSON.stringify({ sid: sidDormeur, palier: 0, niveau: 12, jouees: 15 }),
  })).json();
  assert.equal(r.ok, true);
  assert.equal(r.score, 120);
  assert.equal(r.classe, true);
  assert.doesNotMatch(journal, /\[MINIFEVER\] refus/);
  const d = await (await fetch(`${BASE}/api/light/challenge?sid=${encodeURIComponent(sidDormeur)}`)).json();
  const onglet = (d.games || []).find((g) => g.id === 'minifever_arcade');
  assert.ok(onglet && onglet.scores.some((s) => s.user === 'dormeur' && s.score === 120), 'au tableau du jour');
});

test('une session fermée ne revient pas — les autres, si', async (t) => {
  if (!dispo) { t.skip('base Postgres indisponible'); return; }
  const sidParti = await connecter('partant');
  assert.equal(await qui(sidParti), 'partant');
  // « Se déconnecter » : la session tombe, en mémoire comme en base.
  const r = await fetch(`${BASE}/light/logout?sid=${encodeURIComponent(sidParti)}`, { redirect: 'manual' });
  assert.ok(r.status === 302 || r.status === 200);
  assert.equal(await qui(sidParti), null);

  await arreter();
  lancer();
  await attendre();
  assert.equal(await qui(sidParti), null, 'fermée avant, fermée après');
  assert.equal(await qui(sidDormeur), 'dormeur', 'celle du dormeur tient toujours');
  assert.equal(await qui('sid-jamais-vu'), null, 'et rien ne naît de nulle part');
});
