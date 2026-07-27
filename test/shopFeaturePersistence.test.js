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

test('un ancien pack de jeu persisté en base ne ressuscite pas', async (t) => {
  if (!dispo) return t.skip('pas de base PostgreSQL de test disponible');
  // Reproduit le bug signalé : la copie DB de l'ancien « Pack de Frutisnake »
  // (id 11) réapparaissait en boutique, marquée « déjà possédée », à côté de la
  // nouvelle option. On réinjecte les huit anciens packs en base, on redémarre,
  // et aucun ne doit revenir.
  const c = new Client({ connectionString: DB });
  await c.connect();
  const { rows: cols } = await c.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'shop_packs'`);
  if (!cols.length) { await c.end(); return t.skip('table shop_packs absente'); }
  const noms = cols.map((x) => x.column_name);
  const val = (n) => (n === 'id' ? null : n === 'price' ? 260 : n === 'category' ? 'Packs'
    : n === 'name' ? 'Ancien pack' : n === 'suffix9' ? '000000000' : null);
  for (const id of [10, 11, 12, 13, 14, 15, 16, 17]) {
    const utiles = noms.filter((n) => ['id', 'name', 'category', 'price', 'suffix9', 'description', 'comment'].includes(n));
    const valeurs = utiles.map((n) => (n === 'id' ? id : (val(n) ?? '')));
    await c.query(
      `INSERT INTO shop_packs (${utiles.join(',')}) VALUES (${utiles.map((_, i) => '$' + (i + 1)).join(',')})
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category`,
      valeurs);
  }
  await c.end();

  await arreter();
  await demarrer();
  const liste = await (await fetch(BASE + '/api/admin/shop?key=' + CLE)).json();
  for (const id of [10, 11, 12, 13, 14, 15, 16, 17]) {
    assert.ok(!liste.some((p) => p.id === id), `l'ancien pack #${id} ne doit pas ressusciter`);
  }
  const rubrique = liste.filter((p) => String(p.category || '').toLowerCase() === 'packs');
  assert.equal(rubrique.length, 1, 'la rubrique Packs ne contient toujours qu\'un produit');
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

test('l\'achat par le client Flash renvoie une réponse exploitable', async (t) => {
  if (!dispo) return t.skip('pas de base PostgreSQL de test disponible');
  // Le bug signalé : « connexion au serveur Frutiparc impossible » à l'achat.
  // /ft/buy répond en XML ; l'option tombait dans la branche « accessoire », qui
  // émet <b b="..."> à partir d'une bouille que l'option ne produit pas — d'où un
  // <b b="undefined"> que le client n'exploite pas. Une option n'ajoute rien à
  // l'inventaire : la réponse doit se limiter au solde, comme pour un pass.
  const joueur = 'achatflash';
  const sid = await sidFor(joueur);
  await fetch(BASE + `/api/admin/users/${joueur}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-admin-key': CLE },
    body: JSON.stringify({ kikooz: 1000 }),
  });
  const liste = await (await fetch(BASE + '/api/admin/shop?key=' + CLE)).json();
  const pack = liste.find((p) => p.gameFeature === 'snake3Hud');

  const r = await fetch(BASE + `/ft/buy?sid=${encodeURIComponent(sid)}&i=${pack.id}`);
  const xml = await r.text();
  assert.equal(r.status, 200);
  assert.ok(!/undefined/.test(xml), `aucun « undefined » dans la réponse : ${xml}`);
  assert.ok(!/<b\b/.test(xml), `pas d'entrée d'inventaire pour une option : ${xml}`);
  assert.ok(/<r i="700"\s*>?<\/r>|<r i="700"><\/r>/.test(xml.replace(/\s+/g, '')) || /i="700"/.test(xml),
    `le solde débité est renvoyé : ${xml}`);
  assert.equal((await options(sid)).snake3Hud, true, 'et l\'option est bien accordée');
});
