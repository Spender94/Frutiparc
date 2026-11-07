/*
 * LE RALENTI, de bout en bout : les battements arrivent au VRAI serveur, qui
 * les date de sa propre horloge (antitricheLight.js, « LE RALENTI »).
 *
 *   · la route /api/antitriche/battement n'accepte que la partie en cours du
 *     joueur de la session ; une partie née avant le démarrage du serveur se
 *     réinscrit par son jeton ;
 *   · trois joueurs jouent en même temps, en temps réel : un normal (ses
 *     battements suivent l'horloge), un ralenti ×2 (ses battements avancent
 *     deux fois moins vite que l'horloge du serveur) et un qui bloque ses
 *     battements. Le premier est classé, les deux autres refusés, en alerte
 *     « ralenti » ;
 *   · cinq parties d'affilée qui durent deux fois leur temps de jeu lèvent
 *     l'alerte « ralenti_tendance », et la fiche de suspicion montre le
 *     rapport durée réelle / temps de jeu, partie par partie.
 *
 * Avec le Postgres de test (5433) si on le trouve : les battements gardés
 * avec la partie (details.battementsBruts), que la liste de l'admin ne
 * renvoie pas, et le rejeu de l'admin qui s'en ressert. Sans lui, le reste
 * passe sur la mémoire du serveur.
 *
 * Ce test dure une à deux minutes : les battements doivent arriver en temps
 * réel, c'est tout leur intérêt.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Client } = require('pg');

const ROOT = path.join(__dirname, '..');
const PORT = 3676;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-de-test-ralenti';
const RUN = Date.now().toString(36).slice(-5);
const SECRET = 'banc-ralenti-' + RUN + '-0123456789';
const DB = process.env.TEST_DATABASE_URL_RALENTI || 'postgres://postgres@127.0.0.1:5433/frutiparc_ralenti_test';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const nom = (n) => 'ral' + n + RUN;

const AT = require(path.join(ROOT, 'antitricheLight.js'));
const X = require(path.join(ROOT, 'public/minipixiz/lieux.js'));
const PR = require(path.join(ROOT, 'public/minipixiz/rejeu.js'));
const A = require('./aideAntitriche.js');
AT.poserSecret(SECRET);

let proc = null, dispo = false;
const hdrAdmin = { 'x-admin-key': CLE };

async function sql(q, p) {
  const c = new Client({ connectionString: DB });
  await c.connect();
  try { return (await c.query(q, p)).rows; } finally { await c.end(); }
}
async function baseNeuve() {
  const admin = new Client({ connectionString: DB.replace(/\/[^/]+$/, '/postgres') });
  try {
    await admin.connect();
    const n = DB.split('/').pop();
    await admin.query(`DROP DATABASE IF EXISTS ${n}`);
    await admin.query(`CREATE DATABASE ${n}`);
    await admin.end();
    return true;
  } catch { try { await admin.end(); } catch { /* rien */ } return false; }
}

before(async () => {
  dispo = await baseNeuve();
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: dispo ? DB : '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5749', FRUTISCORE_PORT: '5750', ANTITRICHE_SECRET: SECRET,
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 200; i++) {
    try {
      if ((await fetch(BASE + '/api/loadFrutiSlots?game=snake3')).ok) {
        if (!dispo || (await sql(`SELECT 1 FROM information_schema.tables WHERE table_name = 'alertes_triche'`)).length) return;
      }
    } catch { /* pas prêt */ }
    await wait(250);
  }
  throw new Error('serveur indisponible');
});
after(() => { if (proc) proc.kill('SIGKILL'); });

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
}).then(async (r) => Object.assign({ statut: r.status }, await r.json()));
const lireAdmin = (url) => fetch(BASE + url, { headers: hdrAdmin }).then((r) => r.json());
const alertes = async (u) => (await lireAdmin('/api/admin/triche/alertes?username=' + u)).alertes || [];

// Un joueur pressé : il fait tout tomber, la partie dure une à deux minutes.
function arbreRapide(graine) {
  const lieu = new X.Arbre({ graine, carte: null });
  const rec = PR.brancher(lieu);
  const en = lieu.jeu.entree;
  for (let i = 0; !lieu.fini && i < 400000; i++) { en.bas = true; en.gauche = (i >> 5) % 3 === 0; lieu.update(0.53); }
  const lu = PR.lireJournal(rec.journal());
  const cumul = [0];
  for (let i = 0; i < lu.pas.length; i += 2) cumul.push(cumul[cumul.length - 1] + lu.pas[i] / 1024 / 32 * 1000);
  return {
    score: lieu.score, journal: rec.journal(), tempsJeuMs: cumul[cumul.length - 1], pas: cumul.length - 1,
    // Le nombre de pas joués au temps de jeu g.
    pasA(g) { let lo = 0, hi = cumul.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (cumul[m] <= g) lo = m; else hi = m - 1; } return lo; },
  };
}

// Une partie d'arbre donnée par le serveur dont la durée tombe dans [min, max].
async function partieDeDuree(sid, min, max) {
  // Le débit des jetons est de trente par minute : vingt-huit essais au plus.
  for (let essai = 0; essai < 28; essai++) {
    const p = await poster('/api/minipixiz/arbre/partie', { sid });
    assert.equal(p.ok, true, JSON.stringify(p));
    const jeu = arbreRapide(p.graine);
    if (jeu.tempsJeuMs >= min && jeu.tempsJeuMs <= max) return { p, jeu };
  }
  throw new Error('aucune partie de la bonne durée');
}

/*
 * Joue la partie en temps réel : un battement par seconde (`lent` : le temps
 * de jeu par seconde réelle — 0,5 sous un ralenti ×2), jusqu'à `reelMs`, puis
 * le dernier battement et la fin. `bloque` : aucun battement ne part.
 */
async function jouer(sid, p, jeu, o) {
  const debut = Date.now();
  let n = 0;
  const battre = (pas) => (o.bloque ? Promise.resolve() : poster('/api/antitriche/battement', { sid, id: p.id, n: ++n, pas, pause: 0 })
    .then((r) => assert.equal(r.ok, true, JSON.stringify(r))));
  await battre(0);
  for (;;) {
    await wait(1000);
    const e = Date.now() - debut;
    if (e >= o.reelMs) break;
    await battre(jeu.pasA(Math.min(e * o.lent, jeu.tempsJeuMs)));
  }
  await battre(o.lent >= 1 ? jeu.pas : jeu.pasA(Math.min((Date.now() - debut) * o.lent, jeu.tempsJeuMs)));
  return poster('/api/minipixiz/arbre/fin', { sid, jeton: p.jeton, score: jeu.score, journal: jeu.journal });
}

test('la route des battements : la partie en cours de ce joueur, et rien d’autre', async () => {
  const a = nom('ga'), b = nom('gb');
  const sa = await sidPour(a), sb = await sidPour(b);
  const p = await poster('/api/minipixiz/arbre/partie', { sid: sa });
  assert.equal(p.ok, true);
  assert.equal((await poster('/api/antitriche/battement', { sid: sa, id: p.id, n: 1, pas: 0, pause: 0 })).ok, true);
  assert.equal((await poster('/api/antitriche/battement', { sid: sb, id: p.id, n: 1, pas: 0 })).error, 'autre_joueur');
  assert.equal((await poster('/api/antitriche/battement', { sid: sa, id: 'pas-une-partie', n: 1, pas: 0 })).error, 'inconnue');
  assert.equal((await poster('/api/antitriche/battement', { sid: sa, id: p.id, n: 2, pas: -1 })).error, 'battement');
  assert.equal((await poster('/api/antitriche/battement', { id: p.id, n: 3, pas: 0 })).statut, 401);
  // Une partie née AVANT ce démarrage (le jeton le dit) se réinscrit par son
  // jeton ; une partie née depuis, inconnue du registre, non.
  const vieux = AT.creerJeton({ jeu: 'minifever', username: a, mode: 0, t: Date.now() - 3600000 });
  assert.equal((await poster('/api/antitriche/battement', { sid: sa, id: vieux.id, n: 1, pas: 0 })).error, 'inconnue');
  assert.equal((await poster('/api/antitriche/battement', { sid: sa, id: vieux.id, n: 1, pas: 0, jeton: vieux.jeton })).ok, true);
  const neuf = AT.creerJeton({ jeu: 'minifever', username: a, mode: 0 });
  assert.equal((await poster('/api/antitriche/battement', { sid: sa, id: neuf.id, n: 1, pas: 0, jeton: neuf.jeton })).error, 'inconnue');
  // Le jeton d'un autre ne réinscrit rien.
  assert.equal((await poster('/api/antitriche/battement', { sid: sb, id: vieux.id, n: 2, pas: 0, jeton: vieux.jeton })).error, 'autre_joueur');
});

test('en temps réel : le joueur normal est classé, le ralenti ×2 et les battements bloqués sont refusés', async () => {
  const un = nom('nm'), deux = nom('x2'), trois = nom('bq');
  const [s1, s2, s3] = [await sidPour(un), await sidPour(deux), await sidPour(trois)];
  const normal = await partieDeDuree(s1, 45000, 80000);
  const lent = await partieDeDuree(s2, 45000, 90000);
  const bloque = await partieDeDuree(s3, 62000, 90000);
  // Le ralenti joue jusqu'à ce que l'horloge des jetons le laisse finir ;
  // les battements bloqués, de même : ils seraient refusés plus tôt sinon.
  const marge = (j) => Math.ceil((j.tempsJeuMs - 15000) / 1.1) + 1500;
  const [r1, r2, r3] = await Promise.all([
    jouer(s1, normal.p, normal.jeu, { lent: 1, reelMs: normal.jeu.tempsJeuMs + 500 }),
    jouer(s2, lent.p, lent.jeu, { lent: 0.5, reelMs: Math.max(marge(lent.jeu), 30000) }),
    jouer(s3, bloque.p, bloque.jeu, { lent: 1, bloque: true, reelMs: marge(bloque.jeu) }),
  ]);
  assert.equal(r1.ok, true, JSON.stringify(r1));
  assert.equal(r1.verdict, 'conforme');
  assert.equal(r2.ok, false);
  assert.equal(r2.error, 'partie_refusee');
  assert.match(r2.raison, /^ralenti : le jeu avance à 0,(4|5)/);
  assert.equal(r3.ok, false);
  assert.match(r3.raison, /^battements absents : 0 reçu/);
  await wait(400);
  const a2 = (await alertes(deux)).filter((a) => a.type === 'ralenti');
  assert.equal(a2.length, 1);
  assert.equal(a2[0].gravite, 'grave');
  assert.equal(a2[0].jeu, 'minipixiz');
  assert.ok(a2[0].details.rapportMedian < 0.6, JSON.stringify(a2[0].details));
  const a3 = (await alertes(trois)).filter((a) => a.type === 'ralenti');
  assert.equal(a3.length, 1);
  assert.equal(a3[0].gravite, 'suspect');
  assert.equal((await alertes(un)).filter((a) => a.type === 'ralenti').length, 0, 'le joueur normal n’est pas signalé');
  if (!dispo) return;

  // La partie, gardée avec ses battements.
  const rows = await sql(`SELECT id, verdict, details FROM parties_verifiees WHERE LOWER(username) = $1 AND fini_le IS NOT NULL`, [un]);
  assert.equal(rows.length, 1);
  const bt = rows[0].details.battements;
  assert.ok(bt.rapportMedian > 0.9 && bt.rapportMedian < 1.1, JSON.stringify(bt));
  assert.ok(bt.actifs >= 30, 'un battement par seconde : ' + bt.actifs);
  assert.match(rows[0].details.battementsBruts, /^B1/);
  // La liste de l'admin montre l'examen, pas les battements bruts.
  const liste = await lireAdmin('/api/admin/antitriche/parties?jours=1&joueur=' + un);
  const p = liste.parties[0];
  assert.equal(p.details.battements.actifs, bt.actifs);
  assert.equal(p.details.battementsBruts, undefined);
  assert.ok(p.rapportReel >= 1 && p.rapportReel < 1.2, 'réel / jeu : ' + p.rapportReel);
  // Rejouée par l'admin : les battements gardés servent encore.
  const rj = await fetch(BASE + `/api/admin/antitriche/parties/${rows[0].id}/rejouer`, { method: 'POST', headers: hdrAdmin }).then((r) => r.json());
  assert.equal(rj.verdict, 'conforme');
  const apres = await sql(`SELECT details FROM parties_verifiees WHERE id = $1`, [rows[0].id]);
  assert.equal(apres[0].details.battements.actifs, bt.actifs);
  assert.match(apres[0].details.battementsBruts, /^B1/);
  // Celle du ralenti, rejouée, reste refusée.
  const r2db = await sql(`SELECT id FROM parties_verifiees WHERE LOWER(username) = $1`, [deux]);
  const rj2 = await fetch(BASE + `/api/admin/antitriche/parties/${r2db[0].id}/rejouer`, { method: 'POST', headers: hdrAdmin }).then((r) => r.json());
  assert.equal(rj2.verdict, 'refuse');
  assert.match(rj2.raison, /^ralenti/);
});

test('la tendance : cinq parties d’affilée deux fois plus longues que leur jeu, et la fiche de suspicion', async () => {
  const u = nom('td');
  const sid = await sidPour(u);
  // Des parties nées avant le démarrage du serveur (le test signe lui-même
  // leur jeton) : leurs battements ne sont pas exigés, seule la durée parle.
  for (let i = 0; i < 5; i++) {
    const graine = 4000 + i * 101;
    const jeu = A.arbreHonnete(graine, i + 2);
    const p = AT.creerJeton({ jeu: 'minipixiz', username: u, mode: 0, graine, t: Date.now() - jeu.tempsJeuMs * 2 - 5000 });
    const r = await poster('/api/minipixiz/arbre/fin', { sid, jeton: p.jeton, score: jeu.score, journal: jeu.journal });
    assert.equal(r.verdict, 'conforme', JSON.stringify(r));
    await wait(dispo ? 300 : 20);        // la tendance se lit après l'écriture en base
  }
  await wait(500);
  const al = (await alertes(u)).filter((a) => a.type === 'ralenti_tendance');
  assert.equal(al.length, 1, JSON.stringify(await alertes(u)));
  assert.equal(al[0].gravite, 'suspect');
  assert.match(al[0].resume, /^5 parties d'affilée dont la durée réelle dépasse 1,5 fois le temps de jeu/);
  if (!dispo) return;
  const f = await lireAdmin('/api/admin/triche/joueur/' + u);
  assert.equal(f.ok, true);
  assert.equal(f.partiesVerifiees.length, 5);
  for (const p of f.partiesVerifiees) assert.ok(p.rapportReel >= 2 && p.rapportReel < 2.2, 'réel / jeu ' + p.rapportReel);
  const t = f.tendancesRalenti.find((x) => x.jeu === 'minipixiz');
  assert.equal(t.serie, 5);
  assert.equal(t.rapports.length, 5);
});
