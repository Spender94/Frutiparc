'use strict';
/*
 * MAÎTRE ÈS SWAPOU — un tournoi complet, de bout en bout, horloge accélérée
 * ════════════════════════════════════════════════════════════════════════
 *
 * Le format annoncé : une qualif, les 10 meilleurs en coupe ; les 6 premiers
 * exemptés, un tour préliminaire 7e–10e et 8e–9e ; puis quarts, demies,
 * finale ; chaque tour dure « 72 heures », le meilleur score de chacun est
 * retenu, le plus gros passe ; classement final 1 à 10, les éliminés d'un
 * même tour départagés au score.
 *
 * Ici une « heure » dure une seconde (TOURNOI_HEURE_MS) : chaque tour dure 8 s.
 * Le premier attend derrière une longue pause (le temps de parier), que
 * l'organisateur abrège avec « Lancer le tour maintenant » : le test ne dépend
 * pas de l'horloge d'une machine chargée par le reste de la suite. Les scores arrivent par le
 * vrai chemin du jeu (/api/saveScore) au tour préliminaire, puis par la saisie
 * de l'organisateur pour les tours suivants (les FD d'un compte neuf ne
 * suffiraient pas à jouer quatre tours dans la même journée de test).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { Client } = require('pg');

const ROOT = path.join(__dirname, '..');
const PORT = 3595;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-maitre-es';
const DB = process.env.TEST_DATABASE_URL_MAITRE || 'postgres://postgres@127.0.0.1:5433/frutiparc_maitre_es';
const DONNEES = fs.mkdtempSync(path.join(os.tmpdir(), 'frutiparc-maitre-es-'));
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
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5464', FRUTISCORE_PORT: '5465', FRUTI_DATA_DIR: DONNEES,
      TOURNOI_HEURE_MS: '1000', TOURNAMENT_TICK_MS: '200',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 160; i++) {
    try {
      if ((await fetch(BASE + '/api/loadFrutiSlots?game=snake3')).ok) {
        if ((await sql(`SELECT 1 FROM information_schema.columns WHERE table_name = 'tournaments' AND column_name = 'tours_auto'`)).length) return;
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
// Un score posé par le jeu lui-même (le portage Swapou envoie data « S<perso>: »).
async function jouer(pseudo, score) {
  const b = new URLSearchParams({ sid: sids[pseudo], game: 'swapou2', m: '0', score: String(score), data: 'S0:' });
  const r = await (await fetch(BASE + '/api/saveScore', { method: 'POST', body: b })).json();
  assert.ok(r.ok, JSON.stringify(r));
  return r;
}
const detail = async (tid) => (await fetch(BASE + '/api/admin/tournaments/' + tid, { headers: ADMIN })).json();
async function attendre(tid, quoi, pred, ms = 40000) {
  for (let i = 0; i < ms / 100; i++) {
    const d = await detail(tid);
    if (pred(d)) return d;
    await wait(100);
  }
  throw new Error('jamais arrivé : ' + quoi);
}
const tour = (d, r) => d.matches.filter((m) => Number(m.round) === r);
const affiche = (d, r, a) => tour(d, r).find((m) => m.player1 === a || m.player2 === a);
const ouvert = (d, r) => tour(d, r).some((m) => m.window_start && new Date(m.window_start).getTime() <= Date.now() && !m.winner);
const programme = (d, r) => tour(d, r).filter((m) => m.player1 && m.player2).every((m) => m.window_start);

const JOUEURS = ['p01', 'p02', 'p03', 'p04', 'p05', 'p06', 'p07', 'p08', 'p09', 'p10', 'p11', 'p12'];
let tid = null;

test('qualif : douze joueurs, les dix meilleurs en coupe, tirée toute seule', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  for (const j of JOUEURS) await compte(j);
  await compte('parieuse', 300);
  await compte('parieur', 300);
  const c = await post('/api/admin/tournaments', {
    name: 'Maître ES Swapou 2026', ranking_id: 'swapou2_classic', bracket_size: 10, round_hours: 8,
    tours_auto: true, tours_pause_h: 120,
  }, ADMIN);
  assert.ok(c.ok, JSON.stringify(c));
  tid = c.tournament.id;
  assert.equal(c.tournament.bracket_size, 10, 'dix qualifiés : accepté');
  assert.equal(c.tournament.tours_auto, true);
  await post(`/api/admin/tournaments/${tid}/paris`, { actifs: true, plafond: 100 }, ADMIN);
  assert.ok((await post(`/api/admin/tournaments/${tid}/schedule`, {
    qualif_start: new Date(Date.now() - 60000).toISOString(), qualif_end: new Date(Date.now() + 8000).toISOString(),
  }, ADMIN)).ok);
  // p01 meilleur … p12 dernier : p11 et p12 ne passent pas.
  for (let i = 0; i < JOUEURS.length; i++) {
    assert.ok((await post(`/api/admin/tournaments/${tid}/round-score`, { username: JOUEURS[i], score: 10000 - i * 500 }, ADMIN)).ok);
  }
  const d = await attendre(tid, 'la coupe tirée', (x) => x.tournament.status === 'bracket' && programme(x, 1));
  assert.equal(d.players.length, 10, 'dix qualifiés, pas seize');
  assert.ok(!d.players.some((p) => p.username === 'p11' || p.username === 'p12'));
  // Le tour préliminaire : 7e–10e et 8e–9e ; les six premiers exemptés.
  const jeux = tour(d, 1).filter((m) => m.player1 && m.player2).map((m) => [m.player1, m.player2].sort().join('-')).sort();
  assert.deepEqual(jeux, ['p07-p10', 'p08-p09']);
  assert.equal(tour(d, 1).filter((m) => m.winner && !(m.player1 && m.player2)).length, 6, 'six exemptés');
  // Les quarts qui attendent : 1er contre 8/9, 2e contre 7/10, 3e–6e, 4e–5e.
  const q = tour(d, 2);
  assert.ok(q.some((m) => m.player1 === 'p04' && m.player2 === 'p05'));
  assert.ok(q.some((m) => m.player1 === 'p03' && m.player2 === 'p06'));
  assert.ok(q.some((m) => m.player1 === 'p01' && !m.player2));
  assert.ok(q.some((m) => m.player1 === 'p02' && !m.player2));
  const svg = await (await fetch(BASE + `/api/tournaments/${tid}/bracket.svg`)).text();
  assert.match(svg, /Tour préliminaire/);
  assert.match(svg, /1\/4 de finale/);
});

test('tour préliminaire : on parie pendant la pause, plus une fois le tour ouvert ; le meilleur score passe', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  let d = await detail(tid);
  const m710 = affiche(d, 1, 'p10');
  assert.ok(!ouvert(d, 1), 'la pause : le tour n’est pas encore ouvert');
  const surP10 = await post('/api/paris', { sid: sids.parieuse, match: m710.id, choix: 'p10', mise: 50 });
  assert.equal(surP10.ok, true);
  const surP07 = await post('/api/paris', { sid: sids.parieur, match: m710.id, choix: 'p07', mise: 30 });
  assert.equal(surP07.ok, true);
  // Les cotes fixes : le 10e qualifié est l'outsider du 7e.
  assert.ok(surP10.cote > surP07.cote, `p10 ×${surP10.cote} contre p07 ×${surP07.cote}`);
  assert.equal(surP10.retour, Math.floor(50 * surP10.cote + 1e-9));
  // L'organisateur lance le tour sans attendre la fin de la pause, et les
  // tours suivants s'enchaîneront sans pause.
  const lance = await post(`/api/admin/tournaments/${tid}/tours`, { tours_pause_h: 0, maintenant: true }, ADMIN);
  assert.equal(lance.lance, 2, 'les deux matchs du tour préliminaire');
  d = await attendre(tid, 'le tour préliminaire ouvert', (x) => ouvert(x, 1));
  const tard = await post('/api/paris', { sid: sids.parieur, match: m710.id, choix: 'p07', mise: 10 });
  assert.equal(tard.code, 'joue', 'le tour a commencé : plus de mise');
  // Les parties, par le jeu.
  await jouer('p10', 9000);
  await jouer('p07', 5000);
  await jouer('p09', 300);            // p08 ne joue pas
  d = await attendre(tid, 'le tour préliminaire tranché', (x) => tour(x, 1).every((m) => m.winner) && programme(x, 2));
  const a = affiche(d, 1, 'p10');
  assert.equal(a.winner, 'p10');
  assert.deepEqual([a.score1, a.score2].map(Number).sort((x, y) => x - y), [5000, 9000]);
  assert.equal(affiche(d, 1, 'p08').winner, 'p09', 'seul à avoir joué');
  assert.equal(Number(d.tournament.current_round), 2);
  // Les vainqueurs ont rejoint les quarts.
  assert.ok(tour(d, 2).some((m) => m.player1 === 'p01' && m.player2 === 'p09'));
  assert.ok(tour(d, 2).some((m) => m.player1 === 'p02' && m.player2 === 'p10'));
  // Le pari sur l'outsider paie sa cote figée ; celui sur le favori est perdu.
  await wait(400);
  const [p] = await sql(`SELECT statut, gain FROM tournament_paris WHERE username = 'parieuse'`);
  assert.deepEqual([p.statut, p.gain], ['gagne', surP10.retour]);
  const [q] = await sql(`SELECT statut, gain FROM tournament_paris WHERE username = 'parieur'`);
  assert.deepEqual([q.statut, q.gain], ['perdu', 0]);
});

async function scoreOrga(joueur, score) {
  assert.ok((await post(`/api/admin/tournaments/${tid}/round-score`, { username: joueur, score }, ADMIN)).ok);
}

test('quarts, demies, finale : égalités, absences, et le champion', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  let d = await attendre(tid, 'les quarts ouverts', (x) => ouvert(x, 2));
  await scoreOrga('p01', 100); await scoreOrga('p09', 200);       // p09 bat le 1er
  await scoreOrga('p10', 300); await wait(50); await scoreOrga('p02', 300);   // égalité : p10 l'a fait avant
  await scoreOrga('p03', 50);                                       // p06 absent
  //                                                                   p04–p05 : personne ne joue
  d = await attendre(tid, 'les quarts tranchés', (x) => tour(x, 2).every((m) => m.winner) && programme(x, 3));
  assert.equal(affiche(d, 2, 'p09').winner, 'p09');
  assert.equal(affiche(d, 2, 'p10').winner, 'p10', 'à égalité, le premier à l’avoir réalisé');
  assert.equal(affiche(d, 2, 'p03').winner, 'p03');
  assert.equal(affiche(d, 2, 'p04').winner, 'p04', 'personne n’a joué : le mieux classé');

  d = await attendre(tid, 'les demies ouvertes', (x) => ouvert(x, 3));
  await scoreOrga('p09', 10); await scoreOrga('p04', 20);
  await scoreOrga('p10', 70); await scoreOrga('p03', 60);
  d = await attendre(tid, 'les demies tranchées', (x) => tour(x, 3).every((m) => m.winner) && programme(x, 4));

  d = await attendre(tid, 'la finale ouverte', (x) => ouvert(x, 4));
  await scoreOrga('p04', 5); await scoreOrga('p10', 1);
  d = await attendre(tid, 'le tournoi terminé', (x) => x.tournament.status === 'finished');
  assert.equal(d.tournament.champion, 'p04');
  // Le classement final, 1 à 10.
  assert.deepEqual(d.classement.map((l) => l.username),
    ['p04', 'p10', 'p03', 'p09', 'p02', 'p01', 'p05', 'p06', 'p07', 'p08']);
  assert.deepEqual(d.classement.map((l) => l.rang), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  // Plus de fenêtre ouverte : un score de plus n'entre nulle part.
  const avant = (await sql(`SELECT COUNT(*)::int AS n FROM tournament_round_scores WHERE tournament_id = $1`, [tid]))[0].n;
  await jouer('p05', 7777);
  await wait(300);
  assert.equal((await sql(`SELECT COUNT(*)::int AS n FROM tournament_round_scores WHERE tournament_id = $1`, [tid]))[0].n, avant);
});
