/*
 * UNE QUESTION À 60 KIKOOZ TOMBE UNE SEULE FOIS
 * ═════════════════════════════════════════════
 *
 * « Supprimer les questions à 60 kikooz déjà posées pour éviter qu'il ne les
 * repose (1 question tombe 1 seule fois). »
 *
 * MikeHorny tirait sa question du jour par la DATE — `YYYYMMDD % nombre de
 * questions` — et le tour recommençait au bout d'un mois : il reposait des
 * questions dont il avait lui-même donné la réponse en salon. Le même jour,
 * un lancer manuel depuis l'admin retombait forcément sur celle de 19 h.
 *
 * Le backlog est maintenant une FILE : on prend celle du dessus, et une fois
 * POSÉE elle s'en va — de la mémoire et de la base —, qu'on ait trouvé la
 * réponse ou non (dans les deux cas la réponse finit par être dite).
 *
 * Ce fichier tient les deux choses qui peuvent se défaire :
 *
 *   · une question posée disparaît du backlog, et la suivante prend sa place ;
 *   · un backlog VIDE le reste. Les vingt-deux questions par défaut ne se
 *     sèment qu'UNE FOIS — sinon un simple redémarrage les ferait repousser et
 *     l'animateur reposerait tout depuis le début.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'));
const WebSocket = require(path.join(__dirname, '..', 'node_modules', 'ws'));

const ROOT = path.join(__dirname, '..');
const SERVEUR = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const ADMIN = fs.readFileSync(path.join(ROOT, 'public/admin.html'), 'utf8');

const PORT = 3533;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-kiloute-unique';
const DB = process.env.TEST_DATABASE_URL_KILOUTE
  || 'postgres://postgres@127.0.0.1:5433/frutiparc_kiloute_test';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let proc = null, dispo = false;

async function avecLaBase(faire) {
  const c = new Client({ connectionString: DB });
  await c.connect();
  try { return await faire(c); } finally { await c.end(); }
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

async function lancer() {
  const journal = [];
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: DB, ADMIN_KEY: CLE,
      REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      XMLSOCKET_PORT: '5388', FRUTISCORE_PORT: '5389',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', (b) => journal.push(String(b)));
  proc.stderr.on('data', (b) => journal.push(String(b)));
  for (let i = 0; i < 160; i++) {
    try { if ((await fetch(BASE + '/api/loadFrutiSlots?game=snake3')).ok) return journal; } catch { /* pas prêt */ }
    await wait(250);
  }
  throw new Error('serveur indisponible');
}
function arreter() { if (proc) { proc.kill('SIGKILL'); proc = null; } }

const entetes = { 'Content-Type': 'application/json', 'x-admin-key': CLE };
const backlog = () => fetch(BASE + '/api/admin/kiloute/questions', { headers: entetes })
  .then((r) => r.json()).then((l) => l.map((q) => q.q));
const enBase = () => avecLaBase((c) =>
  c.query('SELECT question FROM kiloute_questions ORDER BY sort_order, id')
    .then((r) => r.rows.map((x) => x.question)));

/*
 * LE SERVEUR ÉCOUTE AVANT D'AVOIR FINI SON SCHÉMA. Il répond en HTTP dès que
 * le port est ouvert ; les tables, elles, se créent et se sèment ensuite. Vider
 * `kiloute_questions` sur la foi du seul port, c'est tomber sur « relation
 * does not exist » — ou pire, effacer AVANT le semis et le voir arriver après.
 * On attend donc le semis lui-même.
 */
async function attendreLeSemis() {
  for (let i = 0; i < 200; i++) {
    try {
      const n = await avecLaBase((c) => c.query('SELECT count(*)::int AS n FROM kiloute_questions')
        .then((r) => r.rows[0].n));
      if (n > 0) return n;
    } catch { /* la table n'existe pas encore */ }
    await wait(250);
  }
  throw new Error('le semis des questions n’est jamais arrivé');
}

before(async () => {
  dispo = await baseNeuve();
  if (!dispo) { console.log('    (Postgres indisponible : les cas serveur sont sautés)'); return; }
  await lancer();                       // premier démarrage : le semis
  await attendreLeSemis();
  arreter();
  await wait(1500);
  // On remplace tout le backlog par deux questions reconnaissables, dans l'ordre.
  await avecLaBase(async (c) => {
    await c.query('DELETE FROM kiloute_questions');
    for (let i = 1; i <= 2; i++) {
      await c.query(
        'INSERT INTO kiloute_questions (question, answers, reveal, sort_order) VALUES ($1, $2, $3, $4)',
        [`Question numéro ${i} ?`, JSON.stringify([`reponse${i}`]), `Réponse ${i}`, i]);
    }
  });
  await lancer();
});
after(() => arreter());

// ── LA MÉCANIQUE, DANS LE CODE ─────────────────────────────────────────────

test('la question se prend en TÊTE de file, plus au calendrier', () => {
  // L'ancienne roue : `YYYYMMDD % longueur`. Elle ne doit plus exister.
  assert.doesNotMatch(SERVEUR, /kilouteQuestionOfTheDay/);
  assert.doesNotMatch(SERVEUR, /KILOUTE_QUESTIONS\[n % KILOUTE_QUESTIONS\.length\]/);
  assert.match(SERVEUR, /function kilouteQuestionSuivante\(\) \{\s*\n\s*return KILOUTE_QUESTIONS\.length \? KILOUTE_QUESTIONS\[0\] : null;/);
  assert.match(SERVEUR, /const q = kilouteQuestionSuivante\(\);/);
});

test('elle se consomme au moment où elle est DITE, pas au tirage', () => {
  /*
   * Entre le tirage et la question il y a vingt-cinq secondes d'introduction.
   * Consommer au tirage, ce serait perdre une question que MikeHorny n'aurait
   * finalement pas posée.
   */
  const ask = /const askAndArm = \(\) => \{[\s\S]*?\n    \};/.exec(SERVEUR);
  assert.ok(ask, 'askAndArm');
  assert.match(ask[0], /kilouteSay\(channelName, q\.q\);\s*\n(?:\s*\/\/[^\n]*\n)*\s*kilouteConsommerQuestion\(q\);/,
    'la consommation suit immédiatement la question');
  const cons = /function kilouteConsommerQuestion\(q\) \{[\s\S]*?\n\}/.exec(SERVEUR);
  assert.ok(cons, 'kilouteConsommerQuestion');
  assert.match(cons[0], /KILOUTE_QUESTIONS\.splice\(i, 1\);/, 'la mémoire d’abord');
  assert.match(cons[0], /db\.deleteKilouteQuestion\(q\.id\)/, 'la base ensuite');
  assert.match(cons[0], /if \(i < 0\) return;/, 'et un second appel ne fait rien');
});

test('l’admin annonce que le backlog se vide', () => {
  assert.match(ADMIN, /Une question tombe une seule fois\./);
  assert.match(ADMIN, /<b>retirée définitivement<\/b>/);
  // Le compte est un nombre de soirées d'avance, avec une alerte quand ça baisse.
  assert.match(ADMIN, /question\$\{n > 1 \? 's' : ''\} en réserve/);
  assert.match(ADMIN, /vide : plus de question ce soir/);
  // La prochaine posée est marquée dans le tableau.
  assert.match(ADMIN, /i === 0 \? ' <b title="la prochaine posée">▶<\/b>' : ''/);
  // Et le lancer manuel prévient AVANT, en nommant la question.
  assert.match(ADMIN, /Elle sera retirée définitivement du backlog/);
});

// ── LA MÉCANIQUE, EN VRAI ──────────────────────────────────────────────────

test('une question posée disparaît du backlog — mémoire et base', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  assert.deepEqual(await backlog(), ['Question numéro 1 ?', 'Question numéro 2 ?'],
    'on part de deux questions, dans l’ordre');

  // Un joueur dans un salon : MikeHorny ne parle pas à une pièce vide.
  const nom = 'kilu' + String(Date.now()).slice(-6);
  const corps = JSON.stringify({ username: nom, password: 'secret123', birthday: '1990-05-15' });
  const jh = { 'Content-Type': 'application/json' };
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: jh, body: corps });
  const { sid } = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: jh, body: corps })).json();
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  const dit = [];
  await new Promise((ok) => ws.on('open', ok));
  ws.on('message', (m) => dit.push(String(m)));
  ws.send(`<k l="${nom}" s="${sid}" lc="1" />`);
  await wait(1200);
  ws.send('<o g="pomme" />');
  await wait(1200);

  const r = await fetch(BASE + '/api/admin/kiloute/run',
    { method: 'POST', headers: entetes, body: JSON.stringify({ channel: 'pomme' }) });
  assert.equal(r.status, 200, 'le lancer est accepté');

  // Quatre répliques d'introduction à cinq secondes chacune, puis la question.
  await wait(34000);
  assert.ok(dit.some((x) => /Question num[ée]ro 1/.test(x)), 'c’est la PREMIÈRE qui tombe');
  assert.ok(!dit.some((x) => /Question num[ée]ro 2/.test(x)), 'et elle seule');

  assert.deepEqual(await backlog(), ['Question numéro 2 ?'], 'elle a quitté la mémoire');
  assert.deepEqual(await enBase(), ['Question numéro 2 ?'], 'et la base');
  try { ws.close(); } catch (e) { /* déjà fermée */ }
});

test('un backlog vidé le reste : les questions par défaut ne repoussent pas', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  /*
   * On semait les défauts « quand la table est vide » — ce qui allait tant que
   * la table ne se vidait jamais. Depuis qu'une question posée est retirée, le
   * vide est un état NORMAL : semer là, ce serait faire repousser les
   * vingt-deux questions d'origine au premier redémarrage.
   */
  arreter();
  await wait(1500);
  await avecLaBase((c) => c.query('DELETE FROM kiloute_questions'));
  const journal = await lancer();
  // Le port s'ouvre avant que la base soit relue : `KILOUTE_QUESTIONS` porte
  // encore les défauts de la mémoire tant que le chargement n'a pas parlé.
  for (let i = 0; i < 200 && !/Kiloute/.test(journal.join('')); i++) await wait(250);

  assert.deepEqual(await enBase(), [], 'rien n’a repoussé');
  assert.deepEqual(await backlog(), [], 'et le serveur le sait');
  assert.match(journal.join(''), /backlog VIDE/, 'il le dit dans son journal');

  // La marque durable qui porte cette décision.
  const marque = await avecLaBase((c) =>
    c.query("SELECT value FROM app_state WHERE key = 'kiloute_defauts_semes'")
      .then((x) => (x.rows[0] || {}).value || null));
  assert.ok(marque, 'la marque « défauts semés » existe');
  assert.ok(!Number.isNaN(Date.parse(marque)), 'et porte la date du semis : ' + marque);
});
