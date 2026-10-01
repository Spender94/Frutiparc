'use strict';
/*
 * LES PARIS DU CHALLENGE — sur les médaillés du lendemain, de bout en bout
 * ════════════════════════════════════════════════════════════════════════
 *
 * Les mises se posent par l'API, pour DEMAIN. Pour voir le règlement sans
 * attendre minuit, on fait « passer la nuit » en base : les paris reculent
 * d'un jour et deviennent ceux du Challenge d'hier ; le roll forcé de l'admin
 * clôt justement le Challenge d'hier, sur le podium des scores posés par le
 * vrai chemin du jeu. On vérifie :
 *   · l'interrupteur baissé (par défaut) : rien ne se mise ;
 *   · le plafond PAR JOUR, tous jeux confondus ; miser sur soi ; un pseudo
 *     inconnu refusé ;
 *   · le règlement des deux pots (médaillé : trois gagnants possibles ; or :
 *     un seul), au prorata, AUCUN KIKOOZ CRÉÉ NI DÉTRUIT ;
 *   · le compte rendu de la veille sur la page ; l'option baissée rembourse.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { Client } = require('pg');

const ROOT = path.join(__dirname, '..');
const PORT = 3596;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-paris-challenge';
const DB = process.env.TEST_DATABASE_URL_PCHAL || 'postgres://postgres@127.0.0.1:5433/frutiparc_paris_challenge';
const DONNEES = fs.mkdtempSync(path.join(os.tmpdir(), 'frutiparc-paris-challenge-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const H = { 'Content-Type': 'application/json' };
const ADMIN = Object.assign({ 'x-admin-key': CLE }, H);

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
before(async () => {
  dispo = await baseNeuve();
  if (!dispo) return;
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: DB, REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5466', FRUTISCORE_PORT: '5467', FRUTI_DATA_DIR: DONNEES,
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 160; i++) {
    try {
      if ((await fetch(BASE + '/api/loadFrutiSlots?game=snake3')).ok) {
        if ((await sql(`SELECT 1 FROM information_schema.tables WHERE table_name = 'challenge_paris'`)).length) return;
      }
    } catch {}
    await wait(250);
  }
  throw new Error('serveur ou schéma indisponible');
});
after(() => {
  if (proc) proc.kill('SIGKILL');
  try { fs.rmSync(DONNEES, { recursive: true, force: true }); } catch { /* déjà parti */ }
});

const post = (url, body, headers) => fetch(BASE + url, { method: 'POST', headers: headers || H, body: JSON.stringify(body) }).then((r) => r.json());
const sids = {};
async function compte(pseudo, kikooz) {
  await post('/api/auth/register', { username: pseudo, password: 'secret123' });
  sids[pseudo] = (await post('/api/auth/login', { username: pseudo, password: 'secret123' })).sid;
  if (kikooz) await fetch(BASE + '/api/admin/users/' + pseudo, { method: 'PATCH', headers: ADMIN, body: JSON.stringify({ kikooz }) });
}
const parier = (qui, jeu, type, choix, mise) => post('/api/paris/challenge', { sid: sids[qui], jeu, type, choix, mise });
const etat = async (qui) => (await fetch(BASE + '/api/paris/challenge?sid=' + (sids[qui] || ''))).json();
const solde = async (qui) => (await (await fetch(BASE + '/api/paris?sid=' + sids[qui])).json()).solde;
async function jouer(pseudo, score) {
  const b = new URLSearchParams({ sid: sids[pseudo], game: 'swapou2', m: '0', score: String(score), data: 'S0:' });
  const r = await (await fetch(BASE + '/api/saveScore', { method: 'POST', body: b })).json();
  assert.ok(r.ok, JSON.stringify(r));
}
const PARIEURS = ['anais', 'basile', 'cyril'];

test('l’interrupteur baissé : rien ne se mise', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  for (const p of PARIEURS) await compte(p, 500);
  for (const j of ['grenade', 'papaye', 'myrtille', 'clemence']) await compte(j);
  assert.equal((await etat('anais')).actif, false);
  assert.equal((await parier('anais', 'swapou2_classic', 'podium', 'grenade', 10)).code, 'fermes');
  assert.equal((await (await fetch(BASE + '/api/paris/ouverts')).json()).n, 0, 'pas de tuile');
});

test('les mises de demain : plafond du jour, sur soi, pseudo inconnu', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  const r = await post('/api/admin/paris-challenge', { actif: true, plafond: 50 }, ADMIN);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal((await (await fetch(BASE + '/api/paris/ouverts')).json()).n, 1, 'la tuile paraît');
  const e = await etat('anais');
  assert.equal(e.actif, true);
  assert.ok(e.jeux.some((j) => j.cle === 'swapou2_classic'));
  assert.ok(e.jeux.some((j) => j.cle === 'bkiwi' && j.nom === 'Burning Kiwi'), 'Burning Kiwi : un seul jeu');
  assert.ok(!e.jeux.some((j) => /^bkiwi_track/.test(j.cle)));
  const demain = e.jour;
  assert.ok(demain > new Date().toISOString().slice(0, 10) || demain.length === 10);

  assert.equal((await parier('anais', 'swapou2_classic', 'podium', 'grenade', 20)).ok, true);
  assert.equal((await parier('anais', 'swapou2_classic', 'or', 'grenade', 20)).ok, true);
  const trop = await parier('anais', 'snake3_classic', 'podium', 'papaye', 20);
  assert.equal(trop.code, 'plafond', '40 + 20 > 50, tous jeux confondus');
  assert.match(trop.message, /encore miser 10/);
  assert.equal((await parier('anais', 'swapou2_classic', 'podium', 'grenade', 10)).ok, true, 'la mise grossit');
  assert.equal((await parier('basile', 'swapou2_classic', 'podium', 'papaye', 30)).ok, true);
  assert.equal((await parier('cyril', 'swapou2_classic', 'podium', 'personne-ici', 5)).code, 'choix');
  assert.equal((await parier('cyril', 'swapou2_classic', 'podium', 'cyril', 15)).ok, true, 'on peut miser sur soi');
  assert.equal((await parier('cyril', 'swapou2_classic', 'or', 'papaye', 25)).ok, true);
  assert.equal((await parier('cyril', 'swapou2_classic', 'tierce', 'papaye', 5)).code, 'type');
  assert.equal(await solde('anais'), 450);
  const pots = (await etat('cyril')).jeux.find((j) => j.cle === 'swapou2_classic');
  assert.equal(pots.potPodium, 75);
  assert.equal(pots.potOr, 45);
  assert.equal(pots.candidats.find((c) => c.pseudo === 'grenade').or.cote, 2.25);
  assert.equal((await sql(`SELECT COUNT(*)::int AS n FROM challenge_paris WHERE jour = $1`, [demain]))[0].n, 5);
});

test('la nuit passe, le roll règle les deux pots — aucun kikooz créé ni détruit', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  const avant = (await Promise.all(PARIEURS.map(solde))).reduce((a, b) => a + b, 0);
  // « La nuit passe » : les paris de demain deviennent ceux d'hier.
  const hier = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date(Date.now() - 86400000));
  await sql(`UPDATE challenge_paris SET jour = $1`, [hier]);
  // Le Challenge de Swapou : grenade, papaye, myrtille sur le podium.
  await jouer('grenade', 9000);
  await jouer('papaye', 8000);
  await jouer('myrtille', 7000);
  await jouer('clemence', 6000);
  const roll = await post('/api/admin/challenge/roll', {}, ADMIN);
  assert.ok(roll.ok, JSON.stringify(roll));
  await wait(800);
  // Médaillé : 75 de pot ; grenade (anais, 30) et papaye (basile, 30) sont
  // médaillées → 37,5 chacun, le kikooz d'arrondi au premier arrivé ; cyril
  // (sur lui-même, 15) n'est pas sur le podium.
  // Or : 45 de pot ; grenade a l'or → tout pour anais.
  assert.equal(await solde('anais'), 450 + 38 + 45);
  assert.equal(await solde('basile'), 470 + 37);
  assert.equal(await solde('cyril'), 460);
  const apres = (await Promise.all(PARIEURS.map(solde))).reduce((a, b) => a + b, 0);
  assert.equal(apres, avant + 75 + 45, 'les deux pots sont revenus, entiers, aux soldes');
  const rows = await sql(`SELECT username, type, statut, gain FROM challenge_paris ORDER BY username, type`);
  assert.deepEqual(rows.map((r) => [r.username, r.type, r.statut, r.gain]), [
    ['anais', 'or', 'gagne', 45], ['anais', 'podium', 'gagne', 38],
    ['basile', 'podium', 'gagne', 37],
    ['cyril', 'or', 'perdu', 0], ['cyril', 'podium', 'perdu', 0],
  ]);
  // Le compte rendu de la veille.
  const e = await etat('anais');
  const sw = e.hier.podiums.find((p) => p.nom === 'Swapou 2');
  assert.deepEqual(sw.podium, ['grenade', 'papaye', 'myrtille']);
  assert.ok(e.hier.mesParis.some((p) => p.statut === 'gagne' && p.gain === 45));
  // Un second roll ne paie pas deux fois. (Le roll forcé réécrit les médailles
  // de la veille avec les scores du moment — vides : on a lu le podium avant.)
  await post('/api/admin/challenge/roll', {}, ADMIN);
  await wait(500);
  assert.equal(await solde('anais'), 533);
  // Le journal des kikooz : une dépense, puis un gain.
  const j = await (await fetch(BASE + '/api/light/kikooz?sid=' + sids.anais)).json();
  const textes = (j.events || []).map((x) => x.text).join(' | ');
  assert.match(textes, /Achat du produit "Pari : grenade en or à Swapou 2/);
  assert.match(textes, /45 kikooz obtenus par un pari gagné \(grenade en or à Swapou 2/);
});

test('baisser l’option rembourse les mises en jeu ; l’export les emporte', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  assert.equal((await parier('basile', 'snake3_classic', 'podium', 'papaye', 12)).ok, true);
  assert.equal(await solde('basile'), 495);
  assert.ok((await post('/api/admin/paris-challenge', { actif: false }, ADMIN)).ok);
  await wait(300);
  assert.equal(await solde('basile'), 507, 'la mise revient');
  assert.equal((await (await fetch(BASE + '/api/paris/ouverts')).json()).n, 0);
  const exp = await (await fetch(BASE + '/api/light/mes-donnees?sid=' + sids.basile)).json();
  assert.equal(exp.paris_challenge.length, 2);
  const adm = await (await fetch(BASE + '/api/admin/paris-challenge', { headers: ADMIN })).json();
  assert.equal(adm.reglages.actif, false);
  assert.ok(adm.jeux.length >= 5);
});
