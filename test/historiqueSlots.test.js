'use strict';
/*
 * L'HISTORIQUE DES SAUVEGARDES et ses règles d'alerte.
 *
 *   · une écriture de fiche range ses différences sensibles, champ par
 *     champ, et rien quand rien de sensible ne bouge ;
 *   · une fiche forgée (album entier, combos par centaines, sans partie)
 *     déclenche les trois règles ; une partie normale, aucune ;
 *   · la purge RGPD efface l'historique à six mois.
 *
 * Postgres sur 5433 (sinon, les tests s'effacent).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Client } = require('pg');

const ROOT = path.join(__dirname, '..');
const PORT = 3747;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-historique';
const DB = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/frutiparc_historique_slots';
const DONNEES = fs.mkdtempSync(path.join(os.tmpdir(), 'frutiparc-historique-slots-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const JSN = { 'Content-Type': 'application/json' };
const ADMIN = { 'x-admin-key': CLE, 'Content-Type': 'application/json' };
const jourParis = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris',
  year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

let proc = null, dispo = false, pg = null;
const sql = async (q, p) => (await pg.query(q, p)).rows;

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

before(async () => {
  dispo = await baseNeuve();
  if (!dispo) return;
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: DB, ADMIN_KEY: CLE, REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      XMLSOCKET_PORT: '5947', FRUTISCORE_PORT: '5948', FRUTI_DATA_DIR: DONNEES, TRICHE_DELAI_VERIF_MS: '400',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 200; i++) {
    try { if ((await fetch(BASE + '/api/admin/triche/alertes', { headers: ADMIN })).ok) break; } catch { /* pas prêt */ }
    await wait(250);
  }
  // Le port s'ouvre avant que la base soit prête : on attend que le schéma
  // existe (créé d'un bloc), puis la fin du démarrage.
  pg = new Client({ connectionString: DB });
  await pg.connect();
  for (let i = 0; i < 200; i++) {
    const r = await pg.query(`SELECT 1 FROM information_schema.tables WHERE table_name = 'historique_slots'`);
    if (r.rows.length) break;
    await wait(250);
  }
  await wait(1500);
});
after(async () => {
  if (proc) proc.kill('SIGKILL');
  if (pg) await pg.end().catch(() => {});
  try { fs.rmSync(DONNEES, { recursive: true, force: true }); } catch { /* déjà parti */ }
});

async function inscrire(pseudo) {
  const body = JSON.stringify({ username: pseudo, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: JSN, body });
  return (await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: JSN, body })).json()).sid;
}
const sauver = (sid, game, fiche) => fetch(BASE + '/api/saveFrutiSlot', {
  method: 'POST', body: new URLSearchParams({ sid, game, slotId: '0', data: JSON.stringify(fiche) }) }).then((r) => r.text());
const admin = (route, corps) => fetch(BASE + route, corps === undefined ? { headers: ADMIN }
  : { method: 'POST', headers: ADMIN, body: JSON.stringify(corps) }).then(async (r) => Object.assign({ statut: r.status }, await r.json()));
const alertes = async (pseudo) => (await admin('/api/admin/triche/alertes?username=' + pseudo)).alertes;

// Une fiche de Swapou : 46 cases de $items, 11 compteurs de combos.
function ficheSwapou({ items = [], combos = [], record = 0, swap = 0 } = {}) {
  const it = Array.from({ length: 46 }, (_, i) => items === 'tout' ? i !== 1 : items.includes(i));
  return { $chars: [true, false, false, false, false, false, false], $items: it, $combos: combos, $record: record,
    $classic_record: 0, $swap: swap };
}

let sidT, sidH;

test('l’historique : les différences sensibles, rien sans changement, une partie normale n’alerte pas', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  sidT = await inscrire('tricheur');
  sidH = await inscrire('honnete');

  // Le joueur honnête : une première fiche, une partie classée aujourd'hui,
  // puis la fiche de fin de partie (+30 combos dont 2 cocktails, un picto).
  assert.equal(await sauver(sidH, 'swapou2', ficheSwapou({ combos: [10, 5, 2, 0, 0, 0, 0, 0, 0, 0, 3], record: 9000 })), 'ok=1');
  await sql(`INSERT INTO parties_joueur_jour (jour, username, jeu, n) VALUES ($1, 'honnete', 'swapou2', 1)`, [jourParis()]);
  assert.equal(await sauver(sidH, 'swapou2', ficheSwapou({ items: [27], combos: [30, 10, 4, 0, 0, 0, 0, 0, 0, 0, 5], record: 12000 })), 'ok=1');

  // Le tricheur : une fiche modeste…
  assert.equal(await sauver(sidT, 'swapou2', ficheSwapou({ combos: [3, 1], record: 1000 })), 'ok=1');
  await wait(300);
  const h0 = await sql(`SELECT champ, avant, apres, ip, canal FROM historique_slots WHERE username = 'tricheur' ORDER BY id`);
  assert.deepEqual(h0.map((h) => [h.champ, h.avant, h.apres]).sort(),
    [['$chars[0]', null, 'true'], ['$combos[0]', null, '3'], ['$combos[1]', null, '1'], ['$record', null, '1000']].sort());
  assert.ok(h0.every((h) => h.canal === 'http' && h.ip), 'l’IP et le canal sont notés');
  // … une écriture qui ne touche rien de sensible ($swap seul) ne s'écrit pas…
  assert.equal(await sauver(sidT, 'swapou2', ficheSwapou({ combos: [3, 1], record: 1000, swap: 42 })), 'ok=1');
  await wait(300);
  assert.equal((await sql(`SELECT COUNT(*)::int AS n FROM historique_slots WHERE username = 'tricheur'`))[0].n, h0.length);
  // … puis la fiche forgée : l'album entier, des combos par centaines, dix cocktails.
  assert.equal(await sauver(sidT, 'swapou2', ficheSwapou({ items: 'tout',
    combos: [300, 200, 100, 50, 40, 30, 20, 10, 5, 5, 10], record: 999999 })), 'ok=1');
  await wait(1200);     // la règle des combos sans partie regarde après le délai (400 ms ici)

  const h1 = await sql(`SELECT champ, avant, apres FROM historique_slots WHERE username = 'tricheur' AND champ IN ('$combos[10]', '$record', '$items[29]')`);
  const parChamp = Object.fromEntries(h1.filter((h) => h.apres !== '1000').map((h) => [h.champ, [h.avant, h.apres]]));
  assert.deepEqual(parChamp['$combos[10]'], [null, '10']);
  assert.deepEqual(parChamp['$record'], ['1000', '999999']);
  assert.deepEqual(parChamp['$items[29]'], [null, 'true']);

  const aT = await alertes('tricheur');
  const types = Object.fromEntries(aT.map((a) => [a.type, a]));
  assert.ok(types.pictos_en_rafale, 'pictos en rafale : ' + JSON.stringify(aT.map((a) => a.type)));
  assert.equal(types.pictos_en_rafale.gravite, 'grave');
  assert.equal(types.pictos_en_rafale.details.pictos.length, 45);
  assert.ok(types.saut_compteur, 'saut de compteur');
  assert.match(types.saut_compteur.resume, /combos de Swapou : \+766/);
  assert.ok(types.combos_sans_partie, 'combos sans partie');
  assert.equal(types.combos_sans_partie.gravite, 'grave');
  assert.equal(types.combos_sans_partie.details.cocktails, 10);
  // Le joueur honnête : rien.
  assert.deepEqual((await alertes('honnete')).map((a) => a.type), []);
  const hH = await sql(`SELECT COUNT(*)::int AS n FROM historique_slots WHERE username = 'honnete'`);
  assert.ok(hH[0].n > 0, 'ses sauvegardes sont pourtant historisées');
});

test('la purge à six mois', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  await sql(`INSERT INTO historique_slots (cree_le, username, jeu, champ, avant, apres)
             VALUES (now() - interval '200 days', 'tricheur', 'swapou2', '$record', '1', '2'),
                    (now() - interval '20 days', 'tricheur', 'swapou2', '$record', '2', '3')`);
  const r = await admin('/api/admin/rgpd/balayage', {});
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(r.bilan.historiqueSlots >= 1, JSON.stringify(r.bilan));
  const vieux = await sql(`SELECT COUNT(*)::int AS n FROM historique_slots WHERE cree_le < now() - interval '183 days'`);
  assert.equal(vieux[0].n, 0);
  const recent = await sql(`SELECT COUNT(*)::int AS n FROM historique_slots WHERE cree_le < now() - interval '19 days'`);
  assert.equal(recent[0].n, 1, 'la ligne de vingt jours reste');
});
