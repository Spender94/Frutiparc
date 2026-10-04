'use strict';
/*
 * LES PARIS D'UN TOURNOI — de bout en bout, avec le vrai serveur
 * ═════════════════════════════════════════════════════════════
 *
 * Un tournoi au score de quatre joueurs, la coupe générée, l'option des paris
 * levée par l'organisateur. On vérifie :
 *   · l'option baissée (par défaut) : rien n'est ouvert, toute mise refusée ;
 *   · les mises : débit du solde, plafond, pas de changement de camp, pas de
 *     pari sur son propre match, ni depuis l'appareil d'un des joueurs ;
 *   · le règlement à la décision du match : le pot aux gagnants, au prorata ;
 *   · AUCUN KIKOOZ CRÉÉ NI DÉTRUIT : la somme des soldes est la même avant et
 *     après, en mémoire comme en base ;
 *   · les remboursements (option baissée en cours de route) ;
 *   · le journal des kikooz et l'export RGPD.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { Client } = require('pg');

const ROOT = path.join(__dirname, '..');
const PORT = 3594;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-paris';
const DB = process.env.TEST_DATABASE_URL_PARIS || 'postgres://postgres@127.0.0.1:5433/frutiparc_paris';
const DONNEES = fs.mkdtempSync(path.join(os.tmpdir(), 'frutiparc-paris-'));
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
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5462', FRUTISCORE_PORT: '5463', FRUTI_DATA_DIR: DONNEES,
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 160; i++) {
    try {
      if ((await fetch(BASE + '/api/loadFrutiSlots?game=snake3')).ok) {
        const rows = await sql(`SELECT 1 FROM information_schema.tables WHERE table_name = 'tournament_paris'`);
        if (rows.length) return;
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

const post = (url, body, headers) => fetch(BASE + url, { method: 'POST', headers: headers || H, body: JSON.stringify(body) });
const sids = {};
async function compte(pseudo, appareil, kikooz) {
  await post('/api/auth/register', { username: pseudo, password: 'secret123', device_token: appareil });
  const j = await (await post('/api/auth/login', { username: pseudo, password: 'secret123', device_token: appareil })).json();
  assert.ok(j.sid, JSON.stringify(j));
  sids[pseudo] = j.sid;
  if (kikooz !== undefined) {
    const r = await fetch(BASE + '/api/admin/users/' + pseudo, { method: 'PATCH', headers: ADMIN, body: JSON.stringify({ kikooz }) });
    assert.ok(r.ok, 'kikooz posés');
  }
  return j.sid;
}
const parier = async (qui, match, choix, mise) => {
  const r = await post('/api/paris', { sid: sids[qui], match, choix, mise });
  return Object.assign({ status: r.status }, await r.json());
};
const etat = async (qui) => (await fetch(BASE + '/api/paris?sid=' + (sids[qui] || ''))).json();
const solde = async (qui) => (await etat(qui)).solde;
const PARIEURS = ['ana', 'bob', 'cid', 'pj1', 'jumeau'];
const totalSoldes = async () => {
  let s = 0;
  for (const q of PARIEURS) s += await solde(q);
  return s;
};

let tid = null, m1 = null, m2 = null;

test('mise en place : un tournoi au score, la coupe générée, l’option baissée', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  // Les paris du Challenge, ouverts par défaut, comptent aussi dans la tuile :
  // on les ferme, ce test ne regarde que les tournois.
  assert.ok((await (await post('/api/admin/paris-challenge', { actif: false }, ADMIN)).json()).ok);
  for (const j of ['pj1', 'pj2', 'pj3', 'pj4']) await compte(j, 'd' + j, j === 'pj1' ? 500 : undefined);
  await compte('ana', 'dana', 500);
  await compte('bob', 'dbob', 500);
  await compte('cid', 'dcid', 500);
  await compte('jumeau', 'dpj1', 500);         // même appareil que pj1
  const cree = await (await post('/api/admin/tournaments',
    { name: 'Coupe des paris', ranking_id: 'swapou2_classic', bracket_size: 4, round_hours: 24 }, ADMIN)).json();
  tid = cree.tournament.id;
  assert.equal(cree.tournament.paris_actifs, false, 'l’option est baissée par défaut');
  assert.ok((await (await post(`/api/admin/tournaments/${tid}/schedule`, {
    qualif_start: new Date(Date.now() - 60000).toISOString(), qualif_end: new Date(Date.now() + 3600000).toISOString(),
  }, ADMIN)).json()).ok);
  for (const [j, s] of [['pj1', 400], ['pj2', 300], ['pj3', 200], ['pj4', 100]]) {
    assert.ok((await (await post(`/api/admin/tournaments/${tid}/round-score`, { username: j, score: s }, ADMIN)).json()).ok);
  }
  assert.ok((await (await post(`/api/admin/tournaments/${tid}/close-qualif`, {}, ADMIN)).json()).ok);
  assert.ok((await (await post(`/api/admin/tournaments/${tid}/generate-bracket`, {}, ADMIN)).json()).ok);
  const d = await (await fetch(BASE + `/api/admin/tournaments/${tid}`, { headers: ADMIN })).json();
  const r1 = d.matches.filter((m) => m.round === 1);
  m1 = r1.find((m) => m.player1 === 'pj1').id;      // pj1 contre pj4
  m2 = r1.find((m) => m.player1 === 'pj2').id;      // pj2 contre pj3
  assert.ok(m1 && m2);
  // Option baissée : rien n'est ouvert, rien ne passe.
  assert.equal((await (await fetch(BASE + '/api/paris/ouverts')).json()).n, 0);
  assert.equal((await etat('ana')).tournois.length, 0);
  const r = await parier('ana', m1, 'pj1', 10);
  assert.equal(r.code, 'fermes');
  assert.equal(await solde('ana'), 500, 'rien de débité');
});

test('les mises : débit, plafond, camp, son propre match, l’appareil d’un joueur', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  assert.ok((await (await post(`/api/admin/tournaments/${tid}/paris`, { actifs: true, plafond: 100 }, ADMIN)).json()).ok);
  await wait(200);
  assert.equal((await (await fetch(BASE + '/api/paris/ouverts')).json()).n, 2, 'les deux matchs du premier tour');

  const avant = await totalSoldes();
  // LES COTES FIXES. Une qualif chacun (pj1 400, pj4 100) : pj1 bat pj4 sur
  // la seule paire connue, lissé vers 50 % (1 score chacun, L = 3) :
  // p = 0,5 + 0,5 × 1/4 = 62,5 % → ×1,47 (0,92 / 0,625) ; pj4 ×2,45.
  const coteAna = await parier('ana', m1, 'pj1', 50);
  assert.equal(coteAna.ok, true);
  assert.deepEqual([coteAna.cote, coteAna.retour], [1.47, 73], 'le favori rapporte peu : 50 × 1,47');
  assert.equal(await solde('ana'), 450, 'la mise est débitée');
  assert.equal((await parier('bob', m1, 'pj1', 30)).ok, true);
  assert.equal((await parier('cid', m1, 'pj4', 120)).code, 'plafond');
  assert.equal((await parier('cid', m1, 'pj4', 70)).ok, true);
  const plus = await parier('cid', m1, 'pj4', 20);
  assert.equal(plus.ok, true);
  assert.equal(plus.mise, 90, 'la mise grossit');
  assert.deepEqual([plus.retour, plus.cote], [171 + 49, 2.45], 'l’outsider rapporte gros, la rallonge à la cote du moment');
  assert.equal((await parier('cid', m1, 'pj4', 20)).code, 'plafond', '90 + 20 > 100');
  assert.equal((await parier('cid', m1, 'pj1', 5)).code, 'camp', 'pas de changement de camp');
  assert.equal((await parier('pj1', m1, 'pj1', 10)).code, 'soi', 'pas sur son propre match');
  assert.equal((await parier('jumeau', m1, 'pj4', 10)).code, 'appareil', 'pas depuis l’appareil d’un joueur');
  assert.equal((await parier('ana', m1, 'pj2', 10)).code, 'choix');
  assert.equal((await parier('ana', m1, 'pj1', 'beaucoup')).code, 'mise');
  assert.equal((await parier('pj1', m2, 'pj2', 10)).ok, true, 'un joueur parie sur les AUTRES matchs');
  assert.equal((await post('/api/paris', { sid: 'faux', match: m1, choix: 'pj1', mise: 5 })).status, 401);
  assert.equal(await totalSoldes(), avant - (50 + 30 + 90 + 10), 'les mises ont quitté les soldes');

  // La page : le pot (public) et ce que J'ai misé (privé).
  const e = await etat('ana');
  const fiche = e.tournois[0].ouverts.find((m) => m.id === m1);
  assert.equal(fiche.pot, 170);
  assert.equal(fiche.j1.mises.mises, 80);
  assert.deepEqual([fiche.j1.cote, fiche.j1.p, fiche.j2.cote, fiche.j2.p], [1.47, 63, 2.45, 38], 'la cote et les chances de chacun');
  assert.deepEqual(fiche.mien, { choix: 'pj1', mise: 50, statut: 'ouvert', gain: 0, cote: 1.47, retour: 73 });
  assert.ok(!JSON.stringify(e).includes('"username"'), 'qui a misé quoi ne sort pas');
  // Les joueurs sur qui l'on mise sont prévenus, sans savoir par qui : pj1
  // deux fois (ana, bob), pj4 une fois (la rallonge de cid ne sonne pas).
  const prevenus = async (u) => (await sql(`SELECT l.content FROM user_logs l JOIN users u ON u.id = l.user_id
    WHERE lower(u.username) = $1 AND l.entry_type = 71 ORDER BY l.id`, [u])).map((r) => r.content);
  const p1 = await prevenus('pj1');
  assert.equal(p1.length, 2, JSON.stringify(p1));
  assert.match(p1[0], /^Un Frutiz prunostique ta victoire : 50 kikooz misés sur toi \(.+\)\. À toi de jouer !$/);
  assert.ok(!p1.join(' ').match(/\bana\b|\bbob\b/), 'anonyme');
  assert.equal((await prevenus('pj4')).length, 1);
  assert.equal((await prevenus('pj2')).length, 1, 'pj1 a misé sur pj2 (un autre match)');
  const ej1 = await etat('pj1');
  assert.equal(ej1.tournois[0].ouverts.find((m) => m.id === m1).interdit, true);
});

test('la décision du match paie à la cote figée — et un ancien pari mutuel reste mutuel', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  const avant = await totalSoldes();
  // Deux paris MUTUELS posés avant les cotes (retour NULL) : ils se règlent
  // entre eux, au pot, comme on le leur avait promis.
  await sql(`INSERT INTO tournament_paris (tournament_id, match_id, username, choix, mise, affiche) VALUES
    ($1, $2, 'pj2', 'pj1', 20, 'pj1 contre pj4'), ($1, $2, 'pj3', 'pj4', 20, 'pj1 contre pj4')`, [tid, m1]);
  const kz = async (u) => Number((await sql(`SELECT kikooz FROM users WHERE username = $1`, [u]))[0].kikooz);
  const pj2Avant = await kz('pj2');
  // Un score saisi ferme les mises.
  assert.ok((await (await post(`/api/admin/tournaments/${tid}/match/${m1}`, { score1: 420, score2: null }, ADMIN)).json()).ok);
  await wait(300);
  assert.equal((await parier('ana', m1, 'pj1', 5)).code, 'joue', 'le match a commencé');
  assert.ok((await (await post(`/api/admin/tournaments/${tid}/match/${m1}`, { winner: 'pj1', score1: 420, score2: 380 }, ADMIN)).json()).ok);
  await wait(500);
  // La cote figée : ana 50 × 1,47 → 73, bob 30 × 1,47 → 44 ; cid, sur
  // l'outsider, perd ses 90. Le parc paie les gagnants et garde les mises perdues.
  assert.equal(await solde('ana'), 450 + 73);
  assert.equal(await solde('bob'), 470 + 44);
  assert.equal(await solde('cid'), 410, 'cid a perdu sa mise');
  assert.equal(await totalSoldes(), avant + 73 + 44);
  const rows = await sql(`SELECT username, statut, gain FROM tournament_paris WHERE match_id = $1 ORDER BY username`, [m1]);
  assert.deepEqual(rows.map((r) => [r.username, r.statut, r.gain]),
    [['ana', 'gagne', 73], ['bob', 'gagne', 44], ['cid', 'perdu', 0], ['pj2', 'gagne', 40], ['pj3', 'perdu', 0]]);
  assert.equal(await kz('pj2'), pj2Avant + 40, 'le pari mutuel : tout le pot (40) au seul qui a vu juste');
  // La base suit la mémoire.
  let b = null;
  for (let i = 0; i < 20 && !(b && Number(b.kikooz) === 514); i++) { [b] = await sql(`SELECT kikooz FROM users WHERE username = 'bob'`); if (Number(b.kikooz) !== 514) await wait(100); }
  assert.equal(Number(b.kikooz), 514);
  // Un nouveau recalage (une autre action de l'organisateur) ne paie pas deux fois.
  await post(`/api/admin/tournaments/${tid}/paris`, { plafond: 100 }, ADMIN);
  await wait(400);
  assert.equal(await solde('ana'), 523, 'payé une fois, une seule');
  // La page montre le résultat.
  const reg = (await etat('ana')).tournois[0].regles.find((m) => m.id === m1);
  assert.deepEqual(reg.mien, { choix: 'pj1', mise: 50, statut: 'gagne', gain: 73, cote: 1.47, retour: 73 });
});

test('l’option baissée en cours de route rembourse les paris ouverts', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  assert.equal(await solde('pj1'), 490);
  assert.ok((await (await post(`/api/admin/tournaments/${tid}/paris`, { actifs: false }, ADMIN)).json()).ok);
  await wait(500);
  assert.equal(await solde('pj1'), 500, 'sa mise sur pj2–pj3 lui revient');
  const [r] = await sql(`SELECT statut, gain FROM tournament_paris WHERE match_id = $1`, [m2]);
  assert.deepEqual([r.statut, r.gain], ['rembourse', 10]);
  assert.equal((await (await fetch(BASE + '/api/paris/ouverts')).json()).n, 0);
});

test('le journal des kikooz, le relevé de l’organisateur, l’export', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  const j = await (await fetch(BASE + '/api/light/kikooz?sid=' + sids.ana)).json();
  const textes = (j.events || []).map((e) => e.text).join(' | ');
  assert.match(textes, /Achat du produit "Pari : pj1 à ×1,47 — pj1 contre pj4" pour 50 kikooz\./, 'une mise se lit comme une dépense');
  assert.match(textes, /73 kikooz obtenus par un pari gagné \(pj1 contre pj4\)\./);
  const ft = await (await fetch(BASE + '/ft/log?sid=' + sids.ana)).text();
  assert.match(ft, /<b t="[^"]+" k="50" n="Pari : pj1 à ×1,47 — pj1 contre pj4"\/>/, 'le bureau Flash la lit comme une dépense');
  const rel = await (await fetch(BASE + `/api/admin/tournaments/${tid}/paris`, { headers: ADMIN })).json();
  assert.equal(rel.paris.length, 6);
  assert.equal(rel.actifs, false);
  const exp = await (await fetch(BASE + '/api/light/mes-donnees?sid=' + sids.ana)).json();
  assert.equal(exp.paris.length, 1);
  assert.equal(exp.paris[0].gain, 73);
  assert.equal(Number(exp.paris[0].cote), 1.47, 'l’export garde la cote');
});
