'use strict';
/*
 * UNE PARTIE COMPTE À SON DÉPART — le nombre de parties du jour (l'infobulle
 * des scores du jour : « obtenu à la 4e partie · 10 parties aujourd'hui »,
 * parties_joueur_jour, l'onglet Statistiques).
 *
 * Demande de l'admin : « Pour certains jeux comme Fever, il semble que ce
 * nombre s'incrémente après la fin de la partie et non pas au clic sur le
 * bouton démarrer. » Ce que ces tests verrouillent, contre une vraie base
 * (sautés sans Postgres de test) :
 *
 *   · Mini-Fever : le jeton de départ compte la partie ; deux départs
 *     abandonnés comptent deux parties ; la fin classée d'une partie comptée
 *     ne la recompte pas, et le tableau dit « obtenue à la Ne partie » ; une
 *     partie refusée par le rejeu a compté à son départ, et l'admin qui la
 *     classe à la main n'en ajoute pas une ;
 *   · Kaluga : le début annoncé (/api/partie/debut) compte, le score (deux
 *     classements écrits) ne recompte pas ;
 *   · Burning Kiwi : la course accordée par /do/fdclaim compte, la Fruticup
 *     (plusieurs courses, un score) non, la course refusée faute de FD non
 *     plus ; un score arrivé sans départ compte à son arrivée, comme avant ;
 *   · Swapou : le Challenge accordé compte ; le Contest qui suit ne recompte
 *     pas ; une graine d'essai ne compte pas.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Client } = require('pg');

const ROOT = path.join(__dirname, '..');
const AT = require(path.join(ROOT, 'antitricheLight.js'));
const A = require('./aideAntitriche.js');

const PORT = 3719;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-depart';
const DB = process.env.TEST_DATABASE_URL_DEPART || 'postgres://postgres@127.0.0.1:5433/frutiparc_depart';
const RUN = Date.now().toString(36).slice(-5);
const SECRET = 'depart-secret-' + RUN + '-0123456789';
const DONNEES = fs.mkdtempSync(path.join(os.tmpdir(), 'frutiparc-depart-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
AT.poserSecret(SECRET);
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
  } catch { try { await admin.end(); } catch { /* rien */ } return false; }
}
// Le serveur répond avant d'avoir créé ses tables : le forum « Frutiz »,
// semé en dernier, dit que la base est prête.
async function basePrete() {
  for (let i = 0; i < 240; i++) {
    const c = new Client({ connectionString: DB });
    try {
      await c.connect();
      const r = await c.query("SELECT 1 FROM forum_boards WHERE name = 'Frutiz' LIMIT 1");
      if (r.rows.length) return;
    } catch { /* tables pas encore là */ } finally { try { await c.end(); } catch { /* rien */ } }
    await wait(250);
  }
  throw new Error('la base de test n\'a jamais été prête');
}

before(async () => {
  dispo = await baseNeuve();
  if (!dispo) return;
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: DB, ADMIN_KEY: CLE, REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      XMLSOCKET_PORT: '5719', FRUTISCORE_PORT: '5720', FRUTI_DATA_DIR: DONNEES,
      ANTITRICHE_SECRET: SECRET, MINIFEVER_BAREME_DEPUIS: '2000-01-01',
    }),
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  for (let i = 0; i < 160; i++) {
    try { if ((await fetch(BASE + '/api/minifever/bareme')).ok) break; } catch { /* pas prêt */ }
    await wait(250);
  }
  await basePrete();
});
after(() => {
  if (proc) proc.kill('SIGKILL');
  try { fs.rmSync(DONNEES, { recursive: true, force: true }); } catch { /* déjà parti */ }
});

const H = { 'Content-Type': 'application/json' };
const post = (url, body) => fetch(BASE + url, { method: 'POST', headers: H, body: JSON.stringify(body) }).then((r) => r.json());
const form = (url, champs) => fetch(BASE + url, { method: 'POST', body: new URLSearchParams(champs) });
async function sid(u) {
  await post('/api/auth/register', { username: u, password: 'secret123' });
  const j = await post('/api/auth/login', { username: u, password: 'secret123' });
  assert.ok(j.sid, 'connecté : ' + JSON.stringify(j));
  return j.sid;
}
// Le compte en base. Les écritures partent derrière la réponse : on attend
// qu'il atteigne la valeur voulue (au plus trois secondes), puis encore un
// instant — un +1 de trop arriverait dans ce délai.
async function partiesEnBase(u, jeu, attendu) {
  const lire = async () => {
    const c = new Client({ connectionString: DB });
    await c.connect();
    try {
      const r = await c.query('SELECT n FROM parties_joueur_jour WHERE username = $1 AND jeu = $2', [u.toLowerCase(), jeu]);
      return r.rows.length ? Number(r.rows[0].n) : 0;
    } finally { await c.end(); }
  };
  let n = await lire();
  for (let i = 0; i < 30 && n !== attendu; i++) { await wait(100); n = await lire(); }
  await wait(250);
  return lire();
}
// Ma ligne au tableau du jour (le light), pour un classement.
async function maLigne(s, rk) {
  const d = await (await fetch(`${BASE}/api/light/challenge?sid=${encodeURIComponent(s)}`)).json();
  const g = (d.games || []).find((x) => x.id === rk);
  return g && g.scores.find((x) => x.isMe);
}

// ── Mini-Fever ───────────────────────────────────────────────────────────
const finirFever = (s, corps) => post('/api/minifever/score', Object.assign({ sid: s }, corps));
// Une partie « jouée » hors de tout départ vu par le serveur : le jeton est
// forgé dans le passé (comme dans minifeverBareme.test.js), sa fin se classe.
function partieForgee(u, palier, victoires, graine) {
  const c = A.arcadeConstruite(graine, palier, victoires, { sansPlafond: true });
  const j = AT.creerJeton({ jeu: 'minifever', username: u, mode: palier, graine, t: Date.now() - c.minimumMs - 60000 });
  return Object.assign({}, c, { corps: Object.assign({ jeton: j.jeton }, c.corps) });
}

test('Mini-Fever : la partie compte au jeton de départ, abandonnée ou non, et jamais deux fois', async (t) => {
  if (!dispo) return t.skip('Postgres de test indisponible');
  const u = 'fev' + RUN;
  const s = await sid(u);
  const depart = async () => {
    const p = await post('/api/minifever/partie', { sid: s, palier: 0 });
    assert.equal(p.ok, true, JSON.stringify(p));
    return p;
  };

  // 1. Une partie sans départ vu (vieux client) : elle compte à son score, comme avant.
  const f1 = partieForgee(u, 0, 1, 921);
  assert.equal((await finirFever(s, f1.corps)).ok, true);
  assert.equal(await partiesEnBase(u, 'minifever', 1), 1);
  let moi = await maLigne(s, 'minifever_arcade');
  assert.deepEqual([moi.partie, moi.parties], [1, 1]);

  // 2. Deux départs, abandonnés : deux parties, tout de suite, sans score.
  await depart();
  await depart();
  assert.equal(await partiesEnBase(u, 'minifever', 3), 3, 'compté au clic sur « démarrer »');
  moi = await maLigne(s, 'minifever_arcade');
  assert.deepEqual([moi.partie, moi.parties], [1, 3], 'le record reste celui de la 1re');

  // 3. Un départ, puis SA fin, classée et meilleure : pas de seconde partie.
  await depart();
  assert.equal(await partiesEnBase(u, 'minifever', 4), 4);
  const f2 = partieForgee(u, 1, 3, 922);
  const r2 = await finirFever(s, f2.corps);
  assert.equal(r2.ok, true, JSON.stringify(r2));
  assert.equal(r2.classe, true);
  assert.equal(await partiesEnBase(u, 'minifever', 4), 4, 'la fin ne recompte pas la partie');
  moi = await maLigne(s, 'minifever_arcade');
  assert.deepEqual([moi.partie, moi.parties], [4, 4], 'obtenu à la 4e partie, sur 4');

  // 4. Un départ dont le rejeu refuse la fin : la partie a compté, le refus
  //    n'y change rien — et l'admin qui la classe à la main non plus.
  const d = await depart();
  const faux = A.arcadeConstruite((Number(d.graine) ^ 0x5a5a5a) >>> 0, 0, 1, { sansPlafond: true });
  const r3 = await finirFever(s, Object.assign({ jeton: d.jeton }, faux.corps));
  assert.equal(r3.ok, false, 'refusée au rejeu : ' + JSON.stringify(r3));
  assert.equal(await partiesEnBase(u, 'minifever', 5), 5);
  moi = await maLigne(s, 'minifever_arcade');
  assert.deepEqual([moi.partie, moi.parties], [4, 5]);
  const cl = await fetch(`${BASE}/api/admin/antitriche/parties/${d.id}/classer`, { method: 'POST', headers: { 'x-admin-key': CLE } }).then((x) => x.json());
  assert.equal(cl.ok, true, JSON.stringify(cl));
  assert.equal(await partiesEnBase(u, 'minifever', 5), 5, 'classer à la main ne fait pas une partie de plus');
});

// ── Kaluga ───────────────────────────────────────────────────────────────
test('Kaluga : le début annoncé compte, le score (deux classements) ne recompte pas', async (t) => {
  if (!dispo) return t.skip('Postgres de test indisponible');
  const u = 'kal' + RUN;
  const s = await sid(u);
  assert.equal((await post('/api/partie/debut', { sid: s, jeu: 'kaluga' })).ok, true);
  assert.equal(await partiesEnBase(u, 'kaluga', 1), 1, 'compté au départ');
  // Le score d'une partie sans grappe : le Freestyle du jour ET le record
  // Freestyle permanent — deux écritures, une partie, déjà comptée.
  const r = await (await form('/api/saveScore', { sid: s, game: 'kaluga', m: '0', score: '2560', data: '1:3:3' })).json();
  assert.ok(r.ok && r.updated, JSON.stringify(r));
  assert.equal(await partiesEnBase(u, 'kaluga', 1), 1);
  const moi = await maLigne(s, 'kaluga_freestyle_classic');
  assert.deepEqual([moi.partie, moi.parties], [1, 1]);
  // Un second départ abandonné : la partie est comptée quand même.
  await post('/api/partie/debut', { sid: s, jeu: 'kaluga' });
  assert.equal(await partiesEnBase(u, 'kaluga', 2), 2);
  assert.deepEqual([(await maLigne(s, 'kaluga_freestyle_classic')).partie, (await maLigne(s, 'kaluga_freestyle_classic')).parties], [1, 2]);
});

// ── Burning Kiwi ─────────────────────────────────────────────────────────
test('Burning Kiwi : la course accordée compte, la Fruticup et la course refusée non', async (t) => {
  if (!dispo) return t.skip('Postgres de test indisponible');
  const u = 'bk' + RUN;
  const s = await sid(u);
  const daily = (await (await fetch(BASE + '/api/bkiwi/daily')).json()).trk;
  const claim = async (mode) => (await form('/do/fdclaim', { sid: s, game: 'bkiwi', track: String(daily), mode: String(mode) })).text();
  const course = async (score, gm) => (await fetch(BASE + '/api/saveScore?' + new URLSearchParams({
    sid: s, game: 'bkiwi', score: String(score), data: 'Sonic Brain:3:1', track: String(daily), gm: String(gm) }))).json();

  // Une course Challenge : comptée à son départ, pas à son arrivée (deux classements).
  assert.match(await claim(1), /^ok=1&fd=paid/);
  assert.equal(await partiesEnBase(u, 'bkiwi', 1), 1);
  const r = await course(95000, 1);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(await partiesEnBase(u, 'bkiwi', 1), 1, 'l’arrivée ne recompte pas');
  const moi = await maLigne(s, `bkiwi_track${daily}_challenge`);
  assert.equal(moi.parties, 1);

  // La Fruticup (mode 0) enchaîne plusieurs courses pour un score : pas au départ.
  assert.match(await claim(0), /^ok=1&fd=free/);
  assert.equal(await partiesEnBase(u, 'bkiwi', 1), 1);
  // Un contre-la-montre (mode 3), abandonné : compté.
  assert.match(await claim(3), /^ok=1&fd=free/);
  assert.equal(await partiesEnBase(u, 'bkiwi', 2), 2);

  // Des courses Challenge jusqu'au refus : chaque course accordée compte, le
  // refus (pas de course) non.
  let accordees = 0, refus = '';
  for (let i = 0; i < 8 && !refus; i++) {
    const rep = await claim(1);
    if (/^ok=1/.test(rep)) accordees++; else refus = rep;
  }
  assert.match(refus, /^ok=0&err=no_fd/, 'le quota s’épuise');
  assert.ok(accordees >= 1);
  assert.equal(await partiesEnBase(u, 'bkiwi', 2 + accordees), 2 + accordees, 'la course refusée ne compte pas');

  // Un score arrivé sans départ vu (un vieux client, un essai) : il compte à
  // son arrivée, comme avant.
  const e = await course(97000, 8);
  assert.equal(e.ok, true, JSON.stringify(e));
  assert.equal(await partiesEnBase(u, 'bkiwi', 3 + accordees), 3 + accordees);
});

// ── Swapou ───────────────────────────────────────────────────────────────
test('Swapou : le Challenge accordé compte, le Contest ne recompte pas, l’essai ne compte pas', async (t) => {
  if (!dispo) return t.skip('Postgres de test indisponible');
  const u = 'swp' + RUN;
  const s = await sid(u);
  // L'essai : une graine marquée essai, pas de réservation — pas une partie classée.
  assert.equal((await post('/api/swapou/partie', { sid: s, essai: '1' })).ok, true);
  assert.equal(await partiesEnBase(u, 'swapou2', 0), 0, 'l’essai ne compte pas');
  // Le Challenge : la réservation (et la graine, demandée en même temps).
  const rep = await (await form('/do/fdclaim', { sid: s, game: 'swapou2' })).text();
  assert.match(rep, /^ok=1/);
  assert.equal((await post('/api/swapou/partie', { sid: s })).ok, true);
  assert.equal(await partiesEnBase(u, 'swapou2', 1), 1, 'une partie, pas deux (réservation + graine)');
  // La fin de partie : le Contest (nombre de coups) s'écrit — même partie.
  const c = await (await fetch(`${BASE}/api/contest/swapou2?sid=${encodeURIComponent(s)}&v=42`)).json();
  assert.equal(c.ok, true, JSON.stringify(c));
  assert.equal(await partiesEnBase(u, 'swapou2', 1), 1, 'le Contest ne recompte pas la partie');
  // Une deuxième partie Challenge.
  assert.match(await (await form('/do/fdclaim', { sid: s, game: 'swapou2' })).text(), /^ok=1/);
  assert.equal(await partiesEnBase(u, 'swapou2', 2), 2);
});

test('le câblage : les départs comptés, et la fin qui les reconnaît', () => {
  const S = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  // Chaque départ vu par le serveur appelle le compte.
  assert.match(S, /noterDebutPartie\(username, 'minifever'\);\n\s*compterPartieAuDepart\(username, 'minifever'\);/);
  assert.match(S, /compterPartieAuDepart\(username, 'minipixiz'\);/);
  assert.match(S, /noterDebutTrace\(username, jeu\);\n\s*compterPartieAuDepart\(username, jeu\);/);
  assert.match(S, /compterPartieAuDepart\(u, 'bkiwi', \{ sansScore: true \}\)/);
  // persistScore passe le numéro de la partie au record du jour.
  assert.match(S, /const numeroPartie = noterPartie\(username, RANKINGS\[rankingId\]\.game, opts\);/);
  assert.match(S, /noterPartieDuRecord\(username, rankingId, numeroPartie\)/);
  // Les classements à la main de l'admin ne sont pas des parties.
  assert.equal((S.match(/\{ sansPartie: true \}\)/g) || []).length, 2);
});
