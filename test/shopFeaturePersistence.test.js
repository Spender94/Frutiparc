// PERSISTANCE de l'option de jeu achetée en boutique.
//
// C'est LE point sensible : sur ce site, des achats payés ont déjà disparu à un
// redémarrage (feutres, séries de connexion, pass). Ce test ne se contente pas
// de lire le code — il fait tourner un VRAI serveur sur une VRAIE base, achète
// l'option, ARRÊTE le serveur, en démarre un neuf sur la même base, et vérifie
// que l'option est toujours là.
//
// Il couvre aussi le débit des kikooz et le refus d'un second achat.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'));

const ROOT = path.join(__dirname, '..');
const PORT = 3431;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-persistance';
const DB = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/frutiparc_persist';
const JOUEUR = 'achatsnake';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let proc = null;

async function baseDisponible() {
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

async function demarrer() {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: DB, REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5120', FRUTISCORE_PORT: '5121',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  // Le serveur répond en HTTP AVANT d'avoir fini ses migrations : on attend que
  // la colonne existe vraiment, sinon les premiers appels tombent sur
  // « relation "users" does not exist ». Au passage, c'est la preuve que la
  // migration crée bien owned_features.
  for (let i = 0; i < 160; i++) {
    try {
      if ((await fetch(BASE + '/api/loadFrutiSlots?game=snake3')).ok) {
        const c = new Client({ connectionString: DB });
        await c.connect();
        const { rows } = await c.query(
          `SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'owned_features'`);
        await c.end();
        if (rows.length) return;
      }
    } catch {}
    await wait(250);
  }
  throw new Error('serveur ou schéma indisponible');
}
async function arreter() {
  if (!proc) return;
  const p = proc; proc = null;
  p.kill('SIGKILL');
  await wait(1200);
}

let dispo = false;
before(async () => {
  dispo = await baseDisponible();
  if (dispo) await demarrer();
});
after(async () => { await arreter(); });

async function sidFor(username) {
  const body = JSON.stringify({ username, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  return (await r.json()).sid;
}
const options = async (sid) => (await (await fetch(BASE + '/api/features?sid=' + sid)).json()).features;
const admin = (chemin, corps) => fetch(BASE + chemin, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-key': CLE },
  body: JSON.stringify(corps),
});

test('l\'option achetée survit à un redémarrage du serveur', async (t) => {
  if (!dispo) return t.skip('pas de base PostgreSQL de test disponible');

  // 1. Un joueur, à qui on donne de quoi payer.
  let sid = await sidFor(JOUEUR);
  assert.ok(sid, 'session ouverte');
  assert.equal((await options(sid)).snake3Hud, false, 'au départ : option absente');
  const credit = await fetch(BASE + `/api/admin/users/${JOUEUR}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-admin-key': CLE },
    body: JSON.stringify({ kikooz: 1000 }),
  });
  assert.equal(credit.status, 200, `kikooz crédités par l'admin (${await credit.text()})`);

  // 2. Achat réel, à la caisse.
  const liste = await (await fetch(BASE + '/api/admin/shop?key=' + CLE)).json();
  const pack = liste.find((p) => p.gameFeature === 'snake3Hud');
  assert.ok(pack, 'le pack est au catalogue');
  const achat = await (await fetch(BASE + '/api/light/shop/buy', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sid, id: pack.id }),
  })).json();
  assert.equal(achat.ok, true, `achat accepté (${JSON.stringify(achat)})`);
  assert.equal(achat.kikooz, 1000 - pack.price, 'les kikooz sont bien débités du prix');
  assert.equal((await options(sid)).snake3Hud, true, 'option active immédiatement après l\'achat');

  // 3. Écrit en base ? On regarde la colonne, sans passer par le serveur.
  const c = new Client({ connectionString: DB });
  await c.connect();
  const { rows } = await c.query('SELECT owned_features FROM users WHERE LOWER(username) = $1', [JOUEUR]);
  await c.end();
  assert.ok(rows[0], 'le joueur existe en base');
  assert.deepEqual(JSON.parse(rows[0].owned_features || '[]'), ['snake3Hud'],
    'la colonne owned_features porte bien l\'option');

  // 4. REDÉMARRAGE : on tue le serveur et on en relance un neuf sur la même base.
  await arreter();
  await demarrer();

  // 5. Nouvelle session (l'ancienne est perdue avec le processus) : l'option est là.
  sid = await sidFor(JOUEUR);
  assert.ok(sid, 'reconnexion après redémarrage');
  assert.equal((await options(sid)).snake3Hud, true,
    'APRÈS REDÉMARRAGE : l\'option achetée est toujours accordée');

  // 6. Et elle n'est pas re-vendable.
  const rachat = await (await fetch(BASE + '/api/light/shop/buy', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sid, id: pack.id }),
  })).json();
  assert.equal(rachat.ok, false);
  assert.equal(rachat.code, 2, 'second achat refusé : déjà possédée');
});

test('le retrait par l\'admin est lui aussi persisté', async (t) => {
  if (!dispo) return t.skip('pas de base PostgreSQL de test disponible');
  const sid = await sidFor(JOUEUR);
  assert.equal((await options(sid)).snake3Hud, true, 'option présente avant retrait');

  await admin(`/api/admin/users/${JOUEUR}/game-feature`, { feature: 'snake3Hud', owned: false });
  await wait(400);
  const c = new Client({ connectionString: DB });
  await c.connect();
  const { rows } = await c.query('SELECT owned_features FROM users WHERE LOWER(username) = $1', [JOUEUR]);
  await c.end();
  assert.deepEqual(JSON.parse(rows[0].owned_features || '[]'), [], 'colonne vidée en base');

  await arreter();
  await demarrer();
  const sid2 = await sidFor(JOUEUR);
  assert.equal((await options(sid2)).snake3Hud, false,
    'APRÈS REDÉMARRAGE : l\'option retirée ne revient pas');
});
