'use strict';
/*
 * REPRENDRE UN TOURNOI DÉJÀ COMMENCÉ — le Maître ÈS Swapou 2026, lancé à la
 * main sur le forum, repris en cours de quarts de finale.
 *
 * L'organisateur colle le classement final des qualifs tel qu'il l'a posté,
 * génère la coupe, reporte le tour préliminaire joué hors du site, remet les
 * affiches des quarts comme annoncées, puis cale la fenêtre des quarts sur
 * leurs vraies dates : les scores de Challenge déjà joués depuis le début du
 * tour sont relus dans le journal des parties. Les paris s'ouvrent ; ceux des
 * quarts, déjà commencés, restent fermés. À la fin du tour, les vainqueurs
 * montent en demi-finales.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { Client } = require('pg');

const ROOT = path.join(__dirname, '..');
const PORT = 3613;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-reprise';
const DB = process.env.TEST_DATABASE_URL_REPRISE || 'postgres://postgres@127.0.0.1:5433/frutiparc_reprise';
const DONNEES = fs.mkdtempSync(path.join(os.tmpdir(), 'frutiparc-reprise-'));
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
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5484', FRUTISCORE_PORT: '5485', FRUTI_DATA_DIR: DONNEES,
      TOURNAMENT_TICK_MS: '200',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 160; i++) {
    try {
      if ((await fetch(BASE + '/api/loadFrutiSlots?game=snake3')).ok) {
        if ((await sql(`SELECT 1 FROM information_schema.tables WHERE table_name = 'swapou_parties'`)).length) return;
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
  await post('/api/auth/register', { username: pseudo, password: 'secret123', device_token: 'd' + pseudo });
  sids[pseudo] = (await post('/api/auth/login', { username: pseudo, password: 'secret123', device_token: 'd' + pseudo })).sid;
  if (kikooz) await fetch(BASE + '/api/admin/users/' + pseudo, { method: 'PATCH', headers: ADMIN, body: JSON.stringify({ kikooz }) });
}
const detail = async (tid) => (await fetch(BASE + '/api/admin/tournaments/' + tid, { headers: ADMIN })).json();
async function attendre(tid, quoi, pred, ms = 15000) {
  for (let i = 0; i < ms / 100; i++) {
    const d = await detail(tid);
    if (pred(d)) return d;
    await wait(100);
  }
  throw new Error('jamais arrivé : ' + quoi);
}
const tour = (d, r) => d.matches.filter((m) => Number(m.round) === r);
const affiche = (d, r, a) => tour(d, r).find((m) => m.player1 === a || m.player2 === a);
const H_MS = 3600000;
let partieN = 0;
async function partieSwapou(u, score, il_y_a_h, verdict) {
  await sql(`INSERT INTO swapou_parties (id, username, graine, source, fini_le, score_declare, verdict)
             VALUES ($1, $2, 1, 'serveur', now() - ($3 || ' hours')::interval, $4, $5)`,
  ['t' + (++partieN), u, String(il_y_a_h), score, verdict || 'conforme']);
}

// Le classement final des qualifs, tel que posté sur le forum.
const POST_FORUM = `🥇 1er : pattedecat avec 45 855 points
🥈 2e : DEBleen avec 42 830 points
🥉 3e : Cerji avec 42 685 points
4e : skateadonf avec 42 055 points
5e : Tom31 avec 36 250 points
6e : Cyid773190 avec 30 955 points
7e : Crazynou avec 29 695 points
8e : titouthekiller avec 29 335 points
9e : Sandek avec 29 260 points
10e : NAOMI951 avec 28 695 points`;
const QUALIFIES = ['pattedecat', 'debleen', 'cerji', 'skateadonf', 'tom31', 'cyid773190', 'crazynou', 'titouthekiller', 'sandek', 'naomi951'];

test('le Maître ÈS Swapou repris en cours de quarts : qualifiés collés, préliminaire reporté, fenêtre calée, scores relus, paris', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  for (const u of ['pattedecat', 'DEBleen', 'Cerji', 'skateadonf', 'Tom31', 'Cyid773190', 'Crazynou', 'titouthekiller', 'Sandek', 'NAOMI951']) await compte(u);
  await compte('parieuse', 300);
  const c = await post('/api/admin/tournaments', { name: 'Maître ÈS Swapou 2026', ranking_id: 'swapou2_classic', bracket_size: 10, round_hours: 72, tours_auto: true, tours_pause_h: 0 }, ADMIN);
  assert.ok(c.ok, JSON.stringify(c));
  const tid = c.tournament.id;

  // 1. Les qualifiés, collés depuis le forum. Un pseudo inconnu est refusé.
  let r = await post(`/api/admin/tournaments/${tid}/reprise`, { qualifies: POST_FORUM + '\n11e : fantome avec 1 000 points' }, ADMIN);
  assert.match(r.message || '', /Pseudos inconnus : fantome/);
  r = await post(`/api/admin/tournaments/${tid}/reprise`, { qualifies: POST_FORUM }, ADMIN);
  assert.ok(r.ok, JSON.stringify(r));
  let d = await detail(tid);
  assert.equal(d.tournament.status, 'seeded');
  assert.deepEqual(d.players.sort((a, b) => a.seed - b.seed).map((p) => [p.seed, p.username, p.qualif_score]),
    QUALIFIES.map((u, i) => [i + 1, u, [45855, 42830, 42685, 42055, 36250, 30955, 29695, 29335, 29260, 28695][i]]));

  // 2. La coupe : six exemptés, le préliminaire 7e–10e et 8e–9e.
  r = await post(`/api/admin/tournaments/${tid}/generate-bracket`, {}, ADMIN);
  assert.ok(r.ok, JSON.stringify(r));
  d = await attendre(tid, 'préliminaire programmé', (x) => tour(x, 1).filter((m) => m.player1 && m.player2).every((m) => m.window_start));
  const prelim = tour(d, 1).filter((m) => m.player1 && m.player2);
  assert.deepEqual(prelim.map((m) => [m.player1, m.player2].sort()).sort(), [['crazynou', 'naomi951'], ['sandek', 'titouthekiller']]);

  // 3. Le préliminaire, joué hors du site : reporté à la main. Les quarts
  //    s'ouvrent aussitôt, pas 72 heures plus tard.
  const m710 = affiche(d, 1, 'crazynou'), m89 = affiche(d, 1, 'sandek');
  const sc = (m, a, sa, sb) => (m.player1 === a ? { score1: sa, score2: sb } : { score1: sb, score2: sa });
  assert.ok((await post(`/api/admin/tournaments/${tid}/match/${m710.id}`, Object.assign({ winner: 'crazynou' }, sc(m710, 'crazynou', 32135, 27995)), ADMIN)).ok);
  assert.ok((await post(`/api/admin/tournaments/${tid}/match/${m89.id}`, Object.assign({ winner: 'sandek' }, sc(m89, 'sandek', 34755, 30605)), ADMIN)).ok);
  d = await attendre(tid, 'quarts programmés', (x) => Number(x.tournament.current_round) === 2 && tour(x, 2).every((m) => m.window_start));
  assert.ok(Math.abs(new Date(tour(d, 2)[0].window_start).getTime() - Date.now()) < 60000, 'les quarts partent maintenant');

  // 4. Les affiches des quarts, comme annoncées : le n°1 contre Crazynou, le n°2 contre Sandek.
  const q1 = affiche(d, 2, 'pattedecat'), q2 = affiche(d, 2, 'debleen');
  assert.equal(q1.player2, 'sandek', 'le bracket standard met le vainqueur 8–9 face au n°1');
  assert.ok((await post(`/api/admin/tournaments/${tid}/match/${q1.id}`, { player2: 'crazynou' }, ADMIN)).ok);
  assert.ok((await post(`/api/admin/tournaments/${tid}/match/${q2.id}`, { player2: 'sandek' }, ADMIN)).ok);

  // 5. Les quarts ont commencé il y a 20 h (hors du site) : on cale leur fenêtre,
  //    et les parties déjà jouées depuis sont relues.
  await partieSwapou('pattedecat', 40000, 10);
  await partieSwapou('pattedecat', 38000, 5);
  await partieSwapou('crazynou', 35000, 2);
  await partieSwapou('debleen', 50000, 30);           // avant les quarts : ne compte pas
  await partieSwapou('sandek', 36000, 3);
  await partieSwapou('cerji', 60000, 4, 'divergent');  // score rejoué divergent : ne compte pas
  await partieSwapou('tom31', 31000, 1);
  const debut = new Date(Date.now() - 20 * H_MS), fin = new Date(Date.now() + 52 * H_MS);
  r = await post(`/api/admin/tournaments/${tid}/fenetre`, { debut: debut.toISOString(), fin: fin.toISOString(), recuperer: true }, ADMIN);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.matchs, 4);
  assert.deepEqual(r.recuperes.map((x) => [x.username, x.score]).sort(), [['crazynou', 35000], ['pattedecat', 40000], ['sandek', 36000], ['tom31', 31000]]);
  d = await detail(tid);
  assert.ok(tour(d, 2).every((m) => Math.abs(new Date(m.window_end).getTime() - fin.getTime()) < 1000));
  assert.deepEqual(d.roundScores.map((x) => [x.username, x.score]), [['pattedecat', 40000], ['sandek', 36000], ['crazynou', 35000], ['tom31', 31000]]);

  // 6. Les paris s'ouvrent ; ceux des quarts, déjà commencés, restent fermés.
  assert.ok((await post(`/api/admin/tournaments/${tid}/paris`, { actifs: true, plafond: 100 }, ADMIN)).ok);
  await wait(500);
  const refus = await post('/api/paris', { sid: sids.parieuse, match: q1.id, choix: 'pattedecat', mise: 10 });
  assert.equal(refus.code, 'joue', JSON.stringify(refus));

  // 7. Un nouveau score dans la fenêtre est retenu ; à la fin du tour, les vainqueurs montent.
  r = await post(`/api/admin/tournaments/${tid}/round-score`, { username: 'cyid773190', score: 20000 }, ADMIN);
  assert.ok(r.ok, JSON.stringify(r));
  r = await post(`/api/admin/tournaments/${tid}/fenetre`, { debut: debut.toISOString(), fin: new Date(Date.now() - 1000).toISOString() }, ADMIN);
  assert.ok(r.ok, JSON.stringify(r));
  d = await attendre(tid, 'demies', (x) => Number(x.tournament.current_round) === 3 && tour(x, 3).every((m) => m.player1 && m.player2));
  assert.deepEqual(tour(d, 2).map((m) => m.winner).sort(), ['cyid773190', 'pattedecat', 'sandek', 'tom31']);
  assert.deepEqual(tour(d, 3).map((m) => [m.player1, m.player2]), [['pattedecat', 'tom31'], ['sandek', 'cyid773190']]);
  // Les demies se jouent : un pari sur une demie qui n'a pas commencé passe.
  r = await post(`/api/admin/tournaments/${tid}/fenetre`, { debut: new Date(Date.now() + 2 * H_MS).toISOString(), fin: new Date(Date.now() + 74 * H_MS).toISOString() }, ADMIN);
  assert.ok(r.ok, JSON.stringify(r));
  const demie = affiche(await detail(tid), 3, 'pattedecat');
  const pari = await post('/api/paris', { sid: sids.parieuse, match: demie.id, choix: 'tom31', mise: 20 });
  assert.ok(pari.ok, JSON.stringify(pari));
});
