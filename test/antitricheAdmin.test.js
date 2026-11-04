/*
 * L'anti-triche des portages, côté ADMIN et côté BASE (Postgres de test).
 *
 *   · chaque partie rendue — classée ou écartée — est notée dans
 *     parties_verifiees, et l'onglet « Portages vérifiés » la relit ;
 *   · un jeton rendu le reste après un redémarrage du serveur (la mémoire se
 *     vide, la base non), et le secret des jetons survit lui aussi : une
 *     partie commencée avant le redémarrage se rend après ;
 *   · l'admin rejoue une partie gardée, et peut classer à la main une partie
 *     écartée du jour ;
 *   · l'audit (lecture seule) des scores déjà classés lève les scores que la
 *     fiche, les pictos ou les parties vérifiées contredisent ;
 *   · chaque partie montre sa durée réelle, son temps de jeu, ses images et
 *     son rythme (points par minute) — un gros score en très peu de temps est
 *     signalé ; l'audit des scores anciens ne montre que l'heure du score et
 *     le nombre de scores du jour : leur durée ne se reconstitue pas.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { Client } = require('pg');

const ROOT = path.join(__dirname, '..');
const PORT = 3672;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-de-test-antitriche';
const DB = process.env.TEST_DATABASE_URL_ANTITRICHE || 'postgres://postgres@127.0.0.1:5433/frutiparc_antitriche';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const RUN = Date.now().toString(36).slice(-5);
const nom = (n) => 'atadm' + n + RUN;

const AT = require(path.join(ROOT, 'antitricheLight.js'));
const A = require('./aideAntitriche.js');

let proc = null, dispo = false;
const hdrAdmin = { 'Content-Type': 'application/json', 'x-admin-key': CLE };

async function sql(q, p) {
  const c = new Client({ connectionString: DB });
  await c.connect();
  try { return (await c.query(q, p)).rows; } finally { await c.end(); }
}

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

// SANS ANTITRICHE_SECRET : le serveur tire son secret et le garde en base.
async function demarrer() {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: DB, REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5743', FRUTISCORE_PORT: '5744', ANTITRICHE_SECRET: '',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 160; i++) {
    try {
      if ((await fetch(BASE + '/api/loadFrutiSlots?game=snake3')).ok) {
        const rows = await sql(`SELECT 1 FROM information_schema.tables WHERE table_name = 'parties_verifiees'`);
        if (rows.length) return;
      }
    } catch { /* pas prêt */ }
    await wait(250);
  }
  throw new Error('serveur ou schéma indisponible');
}
async function arreter() {
  if (!proc) return;
  const p = proc;
  proc = null;
  const fini = new Promise((r) => p.once('exit', r));
  p.kill('SIGKILL');
  await fini;
}

before(async () => {
  dispo = await baseNeuve();
  if (!dispo) return;
  await demarrer();
});
after(async () => {
  await arreter();
  try {
    const f = path.join(ROOT, 'data/scores.json');
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
    for (const u of Object.keys(d.users || {})) if (u.startsWith('atadm')) delete d.users[u];
    fs.writeFileSync(f, JSON.stringify(d));
  } catch { /* rien à nettoyer */ }
});

async function sidPour(username) {
  const body = JSON.stringify({ username, password: 'secret123' });
  const h = { 'Content-Type': 'application/json' };
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: h, body });
  const j = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: h, body })).json();
  assert.ok(j.sid, 'connexion → sid');
  return j.sid;
}
const poster = (url, corps) => fetch(BASE + url, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps),
}).then((r) => r.json());
const parties = (q) => fetch(BASE + '/api/admin/antitriche/parties?jours=1' + (q || ''), { headers: hdrAdmin }).then((r) => r.json());
async function ligne(rk, u) {
  const j = await (await fetch(`${BASE}/api/light/challenge?limit=50`)).json();
  const g = (j.games || []).find((x) => x.id === rk) || { scores: [] };
  return g.scores.find((s) => String(s.user).toLowerCase() === u) || null;
}

// Le secret des jetons, relu là où le serveur le garde : le test signe ainsi
// des jetons « donnés il y a dix minutes » pour ses parties jouées d'un trait.
async function signerAvecLeSecretDuServeur() {
  const r = await sql(`SELECT value FROM app_state WHERE key = 'antitriche_secret'`);
  assert.ok(r[0] && r[0].value, 'le serveur a tiré son secret et l\'a gardé en base');
  AT.poserSecret(r[0].value);
}

let partieHonnete = null;

test('une partie honnête est notée conforme et classée ; une porte générique, notée refusée', async (t) => {
  if (!dispo) return t.skip('pas de Postgres de test');
  await signerAvecLeSecretDuServeur();
  const u = nom(1);
  const sid = await sidPour(u);
  const jeu = A.arbreHonnete(8080, 11);
  const p = AT.creerJeton({ jeu: 'minipixiz', username: u, graine: 8080, t: Date.now() - jeu.tempsJeuMs - 30000 });
  const r = await poster('/api/minipixiz/arbre/fin', { sid, jeton: p.jeton, score: jeu.score, journal: jeu.journal });
  assert.equal(r.ok, true, JSON.stringify(r));
  partieHonnete = { u, sid, jeu, jeton: p.jeton, id: p.id };

  const forge = await fetch(`${BASE}/api/saveScore?sid=${sid}&game=minipixiz&m=0&score=88888`);
  assert.equal(forge.status, 400);

  await wait(300);
  const d = await parties('&joueur=' + u);
  assert.equal(d.ok, true);
  const conforme = d.parties.find((x) => x.id === p.id);
  assert.ok(conforme, 'la partie est dans la liste de l\'admin');
  assert.equal(conforme.verdict, 'conforme');
  assert.equal(conforme.classe, true);
  assert.equal(conforme.score_verifie, jeu.score);
  assert.ok(conforme.taille_journal > 0, 'le journal est gardé (pour la rejouer)');
  const refuse = d.parties.find((x) => x.source === 'saveScore');
  assert.ok(refuse, 'l\'essai par saveScore est noté');
  assert.equal(refuse.verdict, 'refuse');
  assert.equal(refuse.score_declare, 88888);
  const b = d.bilan.find((x) => x.username === u);
  assert.equal(b.conformes, 1);
  assert.equal(b.ecartees, 1);
});

test('un jeton rendu le reste après un redémarrage ; un jeton donné avant se rend après', async (t) => {
  if (!dispo) return t.skip('pas de Postgres de test');
  const { u, jeu, jeton } = partieHonnete;
  // Un jeton donné par le serveur AVANT le redémarrage.
  const sid1 = await sidPour(u);
  const avant = await poster('/api/minipixiz/arbre/partie', { sid: sid1 });
  assert.equal(avant.ok, true);
  await arreter();
  await demarrer();
  const sid = await sidPour(u);
  const bis = await poster('/api/minipixiz/arbre/fin', { sid, jeton, score: jeu.score, journal: jeu.journal });
  assert.equal(bis.error, 'jeton_deja_rendu', 'la base se souvient de la partie rendue');
  // Le jeton d'avant le redémarrage est toujours lisible (le secret est en
  // base) : la partie est jugée sur le fond — ici, rendue trop vite.
  const jeu2 = A.arbreHonnete(avant.graine, 4);
  const apres = await poster('/api/minipixiz/arbre/fin', { sid, jeton: avant.jeton, score: jeu2.score, journal: jeu2.journal });
  assert.equal(apres.error, 'partie_refusee');
  assert.match(apres.raison, /temps écoulé/, 'le jeton passe, c\'est l\'horloge qui refuse');
});

test('l\'admin rejoue une partie gardée, et classe à la main une partie écartée du jour', async (t) => {
  if (!dispo) return t.skip('pas de Postgres de test');
  await signerAvecLeSecretDuServeur();
  const re = await (await fetch(`${BASE}/api/admin/antitriche/parties/${partieHonnete.id}/rejouer`, { method: 'POST', headers: hdrAdmin })).json();
  assert.equal(re.ok, true);
  assert.equal(re.verdict, 'conforme');
  assert.equal(re.scoreVerifie, partieHonnete.jeu.score);

  // Une partie écartée (score déclaré faux) : l'admin peut la classer.
  const u = nom(2);
  const sid = await sidPour(u);
  const jeu = A.arbreHonnete(6060, 2);
  const p = AT.creerJeton({ jeu: 'minipixiz', username: u, graine: 6060, t: Date.now() - jeu.tempsJeuMs - 30000 });
  const r = await poster('/api/minipixiz/arbre/fin', { sid, jeton: p.jeton, score: jeu.score + 1, journal: jeu.journal });
  assert.equal(r.error, 'partie_refusee');
  await wait(300);
  assert.equal(await ligne('minipixiz_classic', u), null);
  const cl = await (await fetch(`${BASE}/api/admin/antitriche/parties/${p.id}/classer`, { method: 'POST', headers: hdrAdmin })).json();
  assert.equal(cl.ok, true, JSON.stringify(cl));
  assert.equal((await ligne('minipixiz_classic', u) || {}).score, jeu.score + 1, 'classée à la main');
  const d = await parties('&joueur=' + u);
  const row = d.parties.find((x) => x.id === p.id);
  assert.equal(row.verdict, 'divergent', 'le verdict reste écrit');
  assert.equal(row.classe, true);
  assert.equal(row.valide_par, 'admin');
});

test('Mini-Fever : la partie vérifiée est notée avec son palier et ses victoires', async (t) => {
  if (!dispo) return t.skip('pas de Postgres de test');
  await signerAvecLeSecretDuServeur();
  const u = nom(3);
  const sid = await sidPour(u);
  const c = A.arcadeConstruite(1212, 0, 3);
  const p = AT.creerJeton({ jeu: 'minifever', username: u, graine: 1212, mode: 0, t: Date.now() - c.minimumMs - 60000 });
  const r = await poster('/api/minifever/score', Object.assign({ sid, jeton: p.jeton }, c.corps));
  assert.equal(r.ok, true, JSON.stringify(r));
  await wait(300);
  const d = await parties('&jeu=minifever&joueur=' + u);
  const row = d.parties.find((x) => x.id === p.id);
  assert.equal(row.verdict, 'conforme');
  assert.equal(row.mode, 0);
  assert.equal(row.score_verifie, c.niveau * 10);
  assert.equal(row.details.accord, c.jouees);
});

test('l\'audit lit les scores classés et lève ceux que rien ne soutient', async (t) => {
  if (!dispo) return t.skip('pas de Postgres de test');
  // Des archives d'hier : un arbre au-dessus de la fiche, une arcade hors barème.
  const hier = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(Date.now() - 86400000));
  await sql(`INSERT INTO challenge_score_archive (day_key, ranking_id, username, score, data)
             VALUES ($1, 'minipixiz_classic', $2, 999999, ''), ($1, 'minifever_arcade', $3, 4100, '3')`, [hier, nom(1), nom(3)]);
  // La fiche d'atadm1 : un record d'arbre bien en dessous de l'archive.
  const fiche = JSON.stringify({
    $stat: { $item: [], $eat: [], $kill: [0, 0, 0, 0, 0], $run: 4, $game: [0, 0, 0, 0, 3],
      $forestMax: 5, $treeMax: 3000, $misNum: 0 },
    $diam: 0, $key: 2, $star: 4, $bag: 2, $frog: false, $checkpoint: 0,
    $dungeon: { $lvl: 0, $f: false, $loop: 0, $day: 0 }, $rainbow: { $f: false, $day: 0, $it: 0 },
    $pond: { $q: 0, $d: 0, $fs: null }, $faerie: [], $vs: 1.2, $inv: [], $current: null,
    $help: [true, true, true], $mis: [], $mission: [], $wind: 0, $god: [false, false, false],
    $time: { $t: Date.now(), $d: 3, $s: 21600000 },
  });
  await fetch(BASE + '/api/saveFrutiSlot', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sid: await sidPour(nom(1)), game: 'minipixiz', slotId: '0', data: fiche }) });
  // Aujourd'hui : un score posé par l'admin, sans partie vérifiée derrière.
  await sidPour(nom(4));
  await fetch(`${BASE}/api/admin/scores/${nom(4)}/minipixiz_classic`, { method: 'PATCH', headers: hdrAdmin, body: JSON.stringify({ score: 4321 }) });
  const r = await (await fetch(BASE + '/api/admin/antitriche/audit?jours=7', { headers: hdrAdmin })).json();
  assert.equal(r.ok, true, JSON.stringify(r));
  const de = (u, jeu, jour) => r.suspects.find((x) => x.username === u && x.jeu === jeu && (!jour || x.jour === jour));
  const a1 = de(nom(1), 'minipixiz', hier);
  assert.ok(a1, 'l\'arbre d\'hier au-dessus de toute fiche est levé');
  assert.equal(a1.gravite, 'fort');
  assert.match(a1.raisons.join(), /au-dessus du record personnel de la fiche \(3000\)/);
  const a3 = de(nom(3), 'minifever', hier);
  assert.ok(a3 && a3.gravite === 'fort', 'l\'arcade hors barème est levée');
  const a4 = de(nom(4), 'minipixiz');
  assert.ok(a4, 'le score d\'aujourd\'hui sans partie vérifiée est levé');
  assert.match(a4.raisons.join(), /aucune partie vérifiée/);
  const today = r.suspects.filter((x) => x.username === nom(1) && x.jour !== hier);
  assert.equal(today.length, 0, 'la partie vérifiée et classée du jour passe l\'audit');
  // Lecture seule : rien n'a bougé au classement.
  assert.equal((await ligne('minipixiz_classic', nom(4)) || {}).score, 4321);
});

// ── Les durées et le rythme des parties ────────────────────────────────────

const aujourdhuiParis = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
// Une partie déjà jugée, posée telle que le serveur l'aurait notée.
function noterEnBase(id, jeu, username, mode, score, tempsJeuMs, dureeMs) {
  return sql(`INSERT INTO parties_verifiees (id, jeu, username, mode, source, cree_le, fini_le, jour,
                score_declare, score_verifie, verdict, classe, duree_ms, temps_jeu_ms, details)
              VALUES ($1, $2, $3, $4, 'serveur', now() - make_interval(secs => $7::int / 1000), now(), $8,
                $5, $5, 'conforme', true, $7, $6, '{"pas": 4000}'::jsonb)`,
  [id, jeu, username, mode, score, tempsJeuMs, dureeMs, aujourdhuiParis()]);
}

test('chaque partie montre sa durée réelle, son temps de jeu, ses images et son rythme', async (t) => {
  if (!dispo) return t.skip('pas de Postgres de test');
  const { u, jeu, id } = partieHonnete;
  const d = await parties('&joueur=' + u);
  const row = d.parties.find((x) => x.id === id);
  assert.ok(row.cree_le && row.fini_le, 'départ et fin datés');
  const r = row.rythme;
  assert.ok(r, 'le serveur joint le rythme à chaque partie');
  assert.ok(r.dureeMs >= jeu.tempsJeuMs + 25000, `durée réelle : du jeton (donné ${jeu.tempsJeuMs + 30000} ms avant) à la fin (${r.dureeMs})`);
  assert.equal(r.tempsJeuMs, jeu.tempsJeuMs, 'le temps de jeu du journal rejoué');
  assert.equal(r.images, row.details.pas, 'le nombre d\'images rejouées');
  assert.ok(r.images > 1000);
  assert.equal(r.pointsParMinute, Math.round(jeu.score / (jeu.tempsJeuMs / 60000)));
  assert.equal(r.signal, null, 'une partie au hasard ne va pas vite');
});

test('un gros score en très peu de temps est signalé dans la liste et au bilan', async (t) => {
  if (!dispo) return t.skip('pas de Postgres de test');
  const u = nom(5);
  // 12 000 points en 2 min 10 s de jeu : plus de 5 500 points par minute.
  await noterEnBase('rythme-' + RUN, 'minipixiz', u, 0, 12000, 130000, 140000);
  const d = await parties('&joueur=' + u);
  const row = d.parties.find((x) => x.id === 'rythme-' + RUN);
  assert.equal(row.rythme.signal, 'fort');
  assert.match(row.rythme.raisons.join(), /12000 points en 2 min 10 s de jeu/);
  assert.equal(d.bilan.find((b) => b.username === u).rythme_max, Math.round(12000 / (130000 / 60000)));
  assert.equal(d.seuils.arbre.pointsParMinute, AT.SEUILS.arbre.pointsParMinute, 'les seuils partent avec la liste');
});

test('le 9e décile de la période sert de référence, quel que soit le filtre', async (t) => {
  if (!dispo) return t.skip('pas de Postgres de test');
  // Palier 2 (30 points la victoire) : dix parties de 300 points en 5 min
  // (60 par minute), puis une de 600 points en 2 min (300 par minute).
  for (let k = 0; k < 10; k++) await noterEnBase(`ref${k}-${RUN}`, 'minifever', nom('r' + k), 2, 300, 300000, 310000);
  const u = nom(6);
  await noterEnBase('vite-' + RUN, 'minifever', u, 2, 600, 120000, 125000);
  const d = await parties('&jeu=minifever&joueur=' + u);
  const ref = d.reference['minifever|2'];
  assert.equal(ref.n, 11, 'toutes les parties conformes du palier, pas seulement celles du joueur filtré');
  assert.equal(Math.round(ref.decile), 60);
  const row = d.parties.find((x) => x.id === 'vite-' + RUN);
  assert.equal(row.rythme.signal, 'moyen');
  assert.match(row.rythme.raisons.join(), /5 fois le 9e décile/);
});

test('l\'audit montre l\'heure du score ancien et les scores du jour, sans inventer de durée', async (t) => {
  if (!dispo) return t.skip('pas de Postgres de test');
  const u = nom(5);
  const avantHier = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(Date.now() - 2 * 86400000));
  await sql(`INSERT INTO challenge_score_archive (day_key, ranking_id, username, score, data, updated_at)
             VALUES ($1, 'minipixiz_classic', $2, 45000, '', '2026-01-02T13:02:07Z')`, [avantHier, u]);
  await sql(`INSERT INTO parties_joueur_jour (jour, username, jeu, n) VALUES ($1, $2, 'minipixiz', 3)`, [avantHier, u]);
  const r = await (await fetch(BASE + '/api/admin/antitriche/audit?jours=7', { headers: hdrAdmin })).json();
  assert.equal(r.ok, true, JSON.stringify(r));
  const x = r.suspects.find((s) => s.username === u && s.jour === avantHier);
  assert.ok(x, 'le score au-delà de l\'exploit connu est levé');
  assert.equal(x.enregistreLe, '2026-01-02T13:02:07.000Z', 'challenge_score_archive.updated_at');
  assert.equal(x.partiesDuJour, 3, 'parties_joueur_jour.n');
  assert.ok(!('dureeMs' in x), 'pas de durée : aucune heure de départ n\'était gardée');
});
