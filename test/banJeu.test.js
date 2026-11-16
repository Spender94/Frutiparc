'use strict';
/*
 * LE BAN PAR JEU, À DURÉE (onglet Alertes, « Bans par jeu »).
 *
 * « Un système de ban temporaire pour les jeux, avec durée ajustable et
 * progressive. » Tant qu'il court, les scores du joueur à CE jeu ne se
 * classent plus (ni médaille, ni tournoi) ; les autres jeux, si. L'échelon
 * suit les bans déjà reçus à ce jeu (1 mois, 3 mois, définitif), sauf ceux
 * levés pour erreur.
 *
 * Le serveur tourne sans base (la mémoire suffit au comportement), puis avec
 * la base de test sur 5433 si elle répond (la table, l'historique relu au
 * démarrage).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3681;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-ban-jeu';
const RUN = Date.now().toString(36).slice(-5);
const DONNEES = fs.mkdtempSync(path.join(os.tmpdir(), 'frutiparc-ban-jeu-'));
const H = { 'Content-Type': 'application/json' };
const ADMIN = Object.assign({ 'x-admin-key': CLE }, H);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let proc = null;
function lancer(env) {
  const p = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', ADMIN_KEY: CLE, REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      XMLSOCKET_PORT: '5691', FRUTISCORE_PORT: '5692', FRUTI_DATA_DIR: DONNEES,
    }, env || {}),
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  return p;
}
async function pret() {
  for (let i = 0; i < 160; i++) {
    try { if ((await fetch(BASE + '/api/loadFrutiSlots?game=snake3')).ok) return true; } catch { /* pas prêt */ }
    await wait(250);
  }
  return false;
}
before(async () => { proc = lancer(); assert.ok(await pret(), 'serveur prêt'); });
after(() => {
  if (proc) proc.kill('SIGKILL');
  try { fs.rmSync(DONNEES, { recursive: true, force: true }); } catch { /* déjà parti */ }
});

const post = (url, body, headers) => fetch(BASE + url, { method: 'POST', headers: headers || H, body: JSON.stringify(body) }).then((r) => r.json());
const get = (url, headers) => fetch(BASE + url, { headers: headers || ADMIN }).then((r) => r.json());
async function sid(u) {
  await post('/api/auth/register', { username: u, password: 'secret123' });
  return (await post('/api/auth/login', { username: u, password: 'secret123' })).sid;
}
// Un score de Kaluga Freestyle et un de Frutisnake, par la porte des jeux.
// (Kaluga exige son témoin de grappe « tz:gOr:gMax » ; une grappe de 2 :
// le Freestyle.)
function score(s, game, valeur) {
  const body = new URLSearchParams({ sid: s, game, m: '0', score: String(valeur), data: game === 'kaluga' ? '1:3:2' : '' });
  return fetch(BASE + '/api/saveScore', { method: 'POST', body }).then((r) => r.json());
}
async function classement(rk) {
  const j = await (await fetch(`${BASE}/api/light/challenge?limit=100`)).json();
  return ((j.games || []).find((g) => g.id === rk) || { scores: [] }).scores;
}
const present = async (rk, u) => (await classement(rk)).some((x) => String(x.user).toLowerCase() === u);

test('la route est gardée, et ne connaît que les jeux qui ont un classement', async () => {
  assert.equal((await fetch(BASE + '/api/admin/triche/bans')).status, 403);
  const d = await get('/api/admin/triche/bans');
  assert.ok(d.ok);
  assert.deepEqual(d.bareme, [30, 90, null]);
  const ids = d.jeux.map((j) => j.id);
  for (const j of ['kaluga', 'snake3', 'swapou2', 'minipixiz', 'minifever']) assert.ok(ids.includes(j), j);
  assert.equal(d.jeux.find((j) => j.id === 'kaluga').nom, 'Kaluga');
  const r = await post('/api/admin/triche/bans', { joueur: 'x', jeu: 'inconnu', jours: 30, motif: 'm' }, ADMIN);
  assert.equal(r.ok, false);
  assert.equal((await post('/api/admin/triche/bans', { joueur: 'x', jeu: 'kaluga', jours: 30 }, ADMIN)).error, 'motif requis');
});

test('banni de Kaluga : son score du jour sort, les suivants ne se classent plus, Frutisnake si', async () => {
  const u = 'banj' + RUN;
  const s = await sid(u);
  await score(s, 'kaluga', 1200);
  const rk = 'kaluga_freestyle_classic';
  assert.ok(await present(rk, u), 'classé avant le ban');
  // La proposition du barème : premier ban, un mois.
  const p = await get(`/api/admin/triche/bans/proposition?joueur=${u}&jeu=kaluga`);
  assert.deepEqual([p.echelon, p.jours, p.precedents], [1, 30, 0]);
  const b = await post('/api/admin/triche/bans', { joueur: u, jeu: 'kaluga', jours: 30, motif: 'triche avouée' }, ADMIN);
  assert.ok(b.ok, JSON.stringify(b));
  assert.equal(b.ban.echelon, 1);
  assert.equal(b.ban.enCours, true);
  assert.ok(b.retires.some((x) => x.rankingId === rk), 'son score du jour est retiré');
  assert.equal(await present(rk, u), false, 'plus au tableau du jour');
  // Un nouveau score : refusé au classement, la partie compte quand même.
  const r = await score(s, 'kaluga', 5000);
  assert.equal(await present(rk, u), false, 'un nouveau score ne le reclasse pas');
  assert.ok(r, 'la partie a une réponse');
  // Les autres jeux ne sont pas touchés.
  await score(s, 'snake3', 300);
  assert.ok(await present('snake3_classic', u), 'Frutisnake classe toujours');
  // Il est prévenu.
  const h = await (await fetch(`${BASE}/api/light/history?sid=${s}`)).json();
  assert.match((h.events || []).map((e) => e.text || '').join('\n'), /Tes scores à Kaluga ne sont plus classés jusqu’au .*Motif : triche avouée/);
  // La fiche de suspicion le montre.
  const f = await get('/api/admin/triche/joueur/' + u);
  assert.equal(f.compte.bans.length, 1);
  assert.equal(f.compte.bans[0].statut, 'en_cours');
});

test('le barème monte avec les bans reçus à ce jeu ; un ban levé pour erreur ne compte pas', async () => {
  const u = 'banb' + RUN;
  await sid(u);
  const poser = (jours) => post('/api/admin/triche/bans', { joueur: u, jeu: 'minifever', jours, motif: 'test', prevenir: false }, ADMIN);
  const lever = (id, erreur) => post(`/api/admin/triche/bans/${id}/lever`, { motif: 'test', erreur, prevenir: false }, ADMIN);
  const b1 = await poser(30);
  assert.equal(b1.ban.echelon, 1);
  // Levé pour erreur : le suivant reste à l'échelon 1.
  assert.equal((await lever(b1.ban.id, true)).ban.statut, 'annule');
  let p = await get(`/api/admin/triche/bans/proposition?joueur=${u}&jeu=minifever`);
  assert.deepEqual([p.echelon, p.jours], [1, 30]);
  const b2 = await poser(30);
  assert.equal((await lever(b2.ban.id, false)).ban.statut, 'leve', 'levée anticipée : compte');
  p = await get(`/api/admin/triche/bans/proposition?joueur=${u}&jeu=minifever`);
  assert.deepEqual([p.echelon, p.jours], [2, 90], 'deuxième : trois mois');
  const b3 = await poser(90);
  assert.equal(b3.ban.echelon, 2);
  await lever(b3.ban.id, false);
  p = await get(`/api/admin/triche/bans/proposition?joueur=${u}&jeu=minifever`);
  assert.deepEqual([p.echelon, p.jours], [3, null], 'troisième : définitif');
  // Le barème est propre à chaque jeu.
  p = await get(`/api/admin/triche/bans/proposition?joueur=${u}&jeu=minipixiz`);
  assert.equal(p.echelon, 1);
  // La durée reste libre, définitif compris.
  const d = await post('/api/admin/triche/bans', { joueur: u, jeu: 'minipixiz', jours: null, motif: 'test', prevenir: false }, ADMIN);
  assert.equal(d.ban.fin, null);
  assert.equal(d.ban.enCours, true);
  assert.equal((await lever(b1.ban.id, false)).ok, false, 'un ban déjà levé ne se relève pas');
  const liste = await get('/api/admin/triche/bans?joueur=' + u + '&tous=1');
  assert.equal(liste.bans.length, 4);
  assert.equal(liste.bans[0].enCours, true, 'les bans en cours d’abord');
});

test('le câblage : persistScore, le tournoi et la récupération Swapou passent par le ban', () => {
  const srv = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const ps = srv.slice(srv.indexOf('function persistScore('), srv.indexOf('function persistScore(') + 2500);
  assert.match(ps, /const banJeu = banJeuEnCours\(username, RANKINGS\[rankingId\]\.game\);\s*if \(banJeu\) return scoreExclu\(username, rankingId, score, banJeu\);/);
  const ct = srv.slice(srv.indexOf('function captureTournamentScore('), srv.indexOf('function captureTournamentScore(') + 600);
  assert.match(ct, /banJeuEnCours\(username, RANKINGS\[rankingId\]\.game\)\) return;/);
  assert.match(srv, /if \(joueurExcluDesClassements\(r\.username\) \|\| banJeuEnCours\(r\.username, 'swapou2'\)\) continue;/);
  const adm = fs.readFileSync(path.join(ROOT, 'public/admin.html'), 'utf8');
  assert.match(adm, /id="bj-liste"/);
  assert.match(adm, /onclick="bjPreparer\('\$\{ux\}'\)">Bannir d’un jeu…<\/button>/);
});

// ── Avec la base : la table, et l'historique relu au démarrage ──
test('avec la base : le ban survit au redémarrage, avec son échelon', async (t) => {
  const { Client } = require('pg');
  const DB = 'postgres://postgres@127.0.0.1:5433/frutiparc_ban_jeu';
  const admin = new Client({ connectionString: DB.replace(/\/[^/]+$/, '/postgres') });
  try {
    await admin.connect();
    await admin.query('DROP DATABASE IF EXISTS frutiparc_ban_jeu');
    await admin.query('CREATE DATABASE frutiparc_ban_jeu');
    await admin.end();
  } catch { try { await admin.end(); } catch { /* */ } t.skip('Postgres indisponible sur 5433'); return; }
  proc.kill('SIGKILL');
  await wait(300);
  const avecBase = async () => {
    proc = lancer({ DATABASE_URL: DB });
    assert.ok(await pret());
    for (let i = 0; i < 80; i++) {
      const c = new Client({ connectionString: DB }); await c.connect();
      const ok = (await c.query(`SELECT 1 FROM information_schema.tables WHERE table_name = 'bans_jeu'`)).rows.length;
      await c.end();
      if (ok) break;
      await wait(250);
    }
  };
  await avecBase();
  const u = 'band' + RUN;
  await sid(u);
  const b = await post('/api/admin/triche/bans', { joueur: u, jeu: 'swapou2', jours: 30, motif: 'régularité', prevenir: false }, ADMIN);
  assert.ok(b.ok, JSON.stringify(b));
  proc.kill('SIGKILL');
  await wait(400);
  await avecBase();
  const d = await get('/api/admin/triche/bans?joueur=' + u);
  assert.equal(d.bans.length, 1, 'relu de la base');
  assert.equal(d.bans[0].jeu, 'swapou2');
  assert.equal(d.bans[0].enCours, true);
  const p = await get(`/api/admin/triche/bans/proposition?joueur=${u}&jeu=swapou2`);
  assert.deepEqual([p.echelon, p.jours], [2, 90], 'l’échelon tient compte de l’historique en base');
});
