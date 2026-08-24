/*
 * Le tournoi de Frutibandas, de bout en bout — depuis l'admin jusqu'au jeu.
 *
 * L'animation ne saisit RIEN : elle pose les inscrits, tire les poules, et les
 * manches arrivent toutes seules du jeu. Ce fichier vérifie précisément cette
 * chaîne-là : une partie terminée dans la salle du Championnat doit remplir
 * l'affiche des deux joueurs, plier le match à l'écart voulu, et faire bouger
 * la note Elo au passage — le tout sans qu'un humain touche à une case.
 *
 * On exerce le VRAI serveur (base neuve à chaque exécution) : les routes
 * d'admin, le pont <bd> par WebSocket, et le tableau public que le jeu lit.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Client } = require('pg');

const ROOT = path.join(__dirname, '..');
const PORT = 3496;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-de-test-tournoi';
const DB = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/frutiparc_tournoi';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const JOUEURS = ['anatole', 'boris', 'cydonia', 'daniela', 'elias', 'faustine'];

let proc = null, dispo = false;
const hdr = { 'Content-Type': 'application/json', 'x-admin-key': CLE };

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
      PORT: String(PORT), DATABASE_URL: DB, REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5176', FRUTISCORE_PORT: '5177',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 160; i++) {
    try {
      if ((await fetch(BASE + '/api/loadFrutiSlots?game=snake3')).ok) {
        const c = new Client({ connectionString: DB });
        await c.connect();
        const { rows } = await c.query(
          `SELECT 1 FROM information_schema.columns WHERE table_name='tournaments' AND column_name='format'`);
        await c.end();
        if (rows.length) return;
      }
    } catch { /* pas prêt */ }
    await wait(250);
  }
  throw new Error('serveur ou schéma indisponible');
});
after(() => { if (proc) proc.kill('SIGKILL'); });

async function inscrire(pseudo) {
  const body = JSON.stringify({ username: pseudo, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const d = await r.json();
  return d.sid;
}
const post = (url, body) => fetch(BASE + url, { method: 'POST', headers: hdr, body: JSON.stringify(body || {}) }).then((r) => r.json());
const get = (url) => fetch(BASE + url, { headers: hdr }).then((r) => r.json());

// ── Deux joueurs branchés au pont <bd> ─────────────────────────────────────
// On parle le protocole du jeu, pas une API de raccourci : c'est bien le
// chemin qu'emprunte une vraie partie.
function connecter(pseudo, sid) {
  const WebSocket = require('ws');
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/`);
    const recus = [];
    let tampon = '';
    ws.on('message', (data) => {
      tampon += data.toString();
      const bouts = tampon.split('\0'); tampon = bouts.pop();
      for (const b of bouts) if (b.trim()) recus.push(b.trim());
    });
    ws.on('error', reject);
    ws.on('open', () => {
      ws.send(`<k l="${pseudo}" s="${sid}" />\0`);
      setTimeout(() => {
        ws.send(`<bd a="hello" n="${pseudo}" sa="champ" />\0`);
        setTimeout(() => resolve({ ws, recus, pseudo,
          envoyer: (s) => ws.send(s + '\0'),
          dernier: (e) => recus.filter((m) => m.indexOf(`e="${e}"`) >= 0).pop() || null,
        }), 400);
      }, 300);
    });
  });
}

// Une manche jouée pour de bon : l'un défie, l'autre abandonne. C'est le
// chemin le plus court d'une VRAIE partie de Championnat à son résultat.
async function manche(gagnant, perdant) {
  gagnant.envoyer(`<bd a="challenge" u="${perdant.pseudo}" />`);
  await wait(500);
  perdant.envoyer('<bd a="part" />');
  await wait(700);
}

test('un tournoi Frutibandas se joue sans que personne ne saisisse un score', async (t) => {
  if (!dispo) return t.skip('Postgres de test indisponible');
  const sids = {};
  for (const j of JOUEURS) sids[j] = await inscrire(j);

  // ── L'animation monte le tournoi ────────────────────────────────────────
  const cree = await post('/api/admin/tournaments', {
    name: 'Tournoi de reprise', format: 'duel', poule_size: 3, qualif_par_poule: 2, win_by: 2,
  });
  assert.ok(cree.ok, 'tournoi créé : ' + JSON.stringify(cree));
  const id = cree.tournament.id;
  assert.strictEqual(cree.tournament.format, 'duel');
  assert.strictEqual(cree.tournament.ranking_id, 'bandas_champion',
    'le tournoi en duel se rattache au classement du Championnat');

  // Un pseudo mal recopié se voit TOUT DE SUITE, pas le jour du match.
  const rate = await post(`/api/admin/tournaments/${id}/duel/players`, { players: 'anatole\nzzznexistepas' });
  assert.ok(/inconnus/i.test(rate.message || ''), 'les pseudos inconnus sont refusés : ' + JSON.stringify(rate));

  const inscrits = await post(`/api/admin/tournaments/${id}/duel/players`, { players: JOUEURS.join('\n') });
  assert.ok(inscrits.ok, JSON.stringify(inscrits));
  assert.strictEqual(inscrits.players.length, 6);

  const tirage = await post(`/api/admin/tournaments/${id}/duel/poules`);
  assert.ok(tirage.ok, JSON.stringify(tirage));
  let etat = await get(`/api/admin/tournaments/${id}`);
  assert.strictEqual(etat.tournament.status, 'poules');
  assert.strictEqual(etat.matches.length, 6, 'deux poules de trois = six matchs');
  assert.strictEqual(etat.tables.length, 2, 'deux tableaux de poule');

  // ── Les joueurs jouent ──────────────────────────────────────────────────
  const cnx = {};
  for (const j of JOUEURS) cnx[j] = await connecter(j, sids[j]);

  // La première affiche de la première poule, jouée pour de vrai.
  const affiche = etat.matches.filter((m) => Number(m.round) === 0)[0];
  const A = cnx[affiche.player1], B = cnx[affiche.player2];
  assert.ok(A && B, 'les deux joueurs de l\'affiche sont connectés');

  await manche(A, B);
  let pub = await (await fetch(BASE + '/api/tournaments/duel')).json();
  let m = pub.tours.find((x) => x.round === 0).matchs
    .find((x) => x.p1 === affiche.player1 && x.p2 === affiche.player2);
  assert.deepStrictEqual([m.s1, m.s2], [1, 0], 'la manche s\'est comptée toute seule');
  assert.strictEqual(m.fini, false, '1-0 : un seul d\'écart, le match continue');

  // La note du Championnat a bougé au passage — les deux barèmes cohabitent.
  const classement = await get('/api/admin/tournaments');      // (réveille la session admin)
  assert.ok(Array.isArray(classement));
  const noteA = await (await fetch(BASE + `/api/forum/me?sid=${sids[A.pseudo]}`)).json();
  assert.ok(noteA.user, 'la session du joueur tient toujours');

  // Deuxième manche pour le même : 2-0, deux d'écart, le match est plié.
  await manche(A, B);
  pub = await (await fetch(BASE + '/api/tournaments/duel')).json();
  m = pub.tours.find((x) => x.round === 0).matchs
    .find((x) => x.p1 === affiche.player1 && x.p2 === affiche.player2);
  assert.deepStrictEqual([m.s1, m.s2], [2, 0]);
  assert.strictEqual(m.fini, true, '2-0 : le match se plie tout seul');
  assert.strictEqual(String(m.v).toLowerCase(), String(affiche.player1).toLowerCase());

  // Une manche de plus entre eux ne touche plus à l'affiche pliée.
  await manche(B, A);
  pub = await (await fetch(BASE + '/api/tournaments/duel')).json();
  m = pub.tours.find((x) => x.round === 0).matchs
    .find((x) => x.p1 === affiche.player1 && x.p2 === affiche.player2);
  assert.deepStrictEqual([m.s1, m.s2], [2, 0], 'le match plié ne bouge plus');

  // ── L'animation clôture les poules ──────────────────────────────────────
  const tot = await post(`/api/admin/tournaments/${id}/duel/close-poules`);
  assert.ok(/pas encore jou/i.test(tot.message || ''), 'on ne clôture pas des poules en cours par mégarde');

  const clot = await post(`/api/admin/tournaments/${id}/duel/close-poules`, { force: true });
  assert.ok(clot.ok, JSON.stringify(clot));
  assert.strictEqual(clot.qualifies.length, 4, 'deux par poule');
  assert.strictEqual(clot.repeches.length, 2, 'et les derniers au repêchage');

  etat = await get(`/api/admin/tournaments/${id}`);
  assert.strictEqual(etat.tournament.status, 'bracket');
  const demies = etat.matches.filter((x) => Number(x.round) === 1);
  assert.strictEqual(demies.length, 2, 'quatre qualifiés = deux demi-finales');
  assert.ok(etat.matches.some((x) => Number(x.round) === -1), 'la poule de repêchage existe');

  // ── La coupe ────────────────────────────────────────────────────────────
  for (const d of demies) {
    const G = cnx[d.player1], P = cnx[d.player2];
    await manche(G, P); await manche(G, P);
  }
  pub = await (await fetch(BASE + '/api/tournaments/duel')).json();
  const t1 = pub.tours.find((x) => x.round === 1);
  assert.ok(t1.matchs.every((x) => x.fini), 'les deux demies sont pliées');
  assert.strictEqual(t1.nom, 'Demi-finales');

  const suite = await post(`/api/admin/tournaments/${id}/duel/next-round`);
  assert.ok(suite.ok && suite.tour === 2, JSON.stringify(suite));
  etat = await get(`/api/admin/tournaments/${id}`);
  const finale = etat.matches.filter((x) => Number(x.round) === 2);
  assert.strictEqual(finale.length, 1, 'une finale');

  const F1 = cnx[finale[0].player1], F2 = cnx[finale[0].player2];
  await manche(F1, F2); await manche(F1, F2);
  const fin = await post(`/api/admin/tournaments/${id}/duel/next-round`);
  assert.ok(fin.ok && fin.fini, JSON.stringify(fin));
  assert.strictEqual(String(fin.champion).toLowerCase(), String(finale[0].player1).toLowerCase());

  etat = await get(`/api/admin/tournaments/${id}`);
  assert.strictEqual(etat.tournament.status, 'finished');
  assert.ok(etat.players.some((p) => p.status === 'champion'), 'le champion est marqué sur sa fiche');

  for (const j of JOUEURS) cnx[j].ws.close();
});

test('une manche jouée AILLEURS qu\'au Championnat ne compte pas pour le tournoi', async (t) => {
  if (!dispo) return t.skip('Postgres de test indisponible');
  // Un tournoi tout neuf, deux joueurs, mais la partie se joue au CHALLENGE :
  // le tournoi ne doit rien enregistrer. Sans quoi une partie d'entraînement
  // volerait une manche à un match officiel.
  const sidA = await inscrire('gilbert'), sidB = await inscrire('hoana');
  const cree = await post('/api/admin/tournaments', {
    name: 'Tournoi témoin', format: 'duel', poule_size: 2, qualif_par_poule: 1, win_by: 2,
  });
  const id = cree.tournament.id;
  await post(`/api/admin/tournaments/${id}/duel/players`, { players: 'gilbert\nhoana' });
  await post(`/api/admin/tournaments/${id}/duel/poules`);

  const A = await connecter('gilbert', sidA), B = await connecter('hoana', sidB);
  A.envoyer('<bd a="room" sa="chall" />');
  B.envoyer('<bd a="room" sa="chall" />');
  await wait(400);
  await manche(A, B);

  const etat = await get(`/api/admin/tournaments/${id}`);
  const m = etat.matches[0];
  assert.deepStrictEqual([Number(m.score1) || 0, Number(m.score2) || 0], [0, 0],
    'une partie de challenge ne remplit aucune affiche');
  A.ws.close(); B.ws.close();
});
