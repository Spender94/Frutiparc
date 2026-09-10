/*
 * « Quelqu'un répond (en me citant) sur le forum » → le téléphone sonne.
 *
 * Le bouton « citer » du forum écrit [quote=Pseudo]…[/quote]. Quand une
 * réponse cite un joueur qui n'est pas frais devant un écran, il reçoit une
 * notification qui NOMME le citeur, porte le TITRE du sujet, et mène
 * directement au sujet (/light?ouvre=forum&sujet=N).
 *
 * Ce que ces tests tiennent :
 *   · la citation d'un absent part sur son téléphone, sujet en lien ;
 *   · une réponse SANS citation ne sonne pas (répondre n'est pas citer) ;
 *   · se citer soi-même ne sonne jamais.
 *
 * Le forum vit en base : PostgreSQL de test requis (cluster port 5433),
 * sinon tout est sauté proprement — comme rolesAdminCumules.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const https = require('node:https');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'));

const TLS_KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgWpQESXonD013w4k0
8CCMZ6bs8hov61dysBqv2SCHpB6hRANCAARnaiKXcWd7/g+Ui0gxjg+q/I25+HVX
xqyj+GyBLfONollQJswYAFsMQTp2OkS+hyuu07zG8K51hOmCLNLHuQbP
-----END PRIVATE KEY-----`;
const TLS_CERT = `-----BEGIN CERTIFICATE-----
MIIBkTCCATagAwIBAgIURNXpwdCiYS4mgfzKB4O+Ee/E0rwwCgYIKoZIzj0EAwIw
FDESMBAGA1UEAwwJMTI3LjAuMC4xMCAXDTI2MDgyMjEzMzMwNVoYDzIxMjYwNzI5
MTMzMzA1WjAUMRIwEAYDVQQDDAkxMjcuMC4wLjEwWTATBgcqhkjOPQIBBggqhkjO
PQMBBwNCAARnaiKXcWd7/g+Ui0gxjg+q/I25+HVXxqyj+GyBLfONollQJswYAFsM
QTp2OkS+hyuu07zG8K51hOmCLNLHuQbPo2QwYjAdBgNVHQ4EFgQUGtfxZr0hojQw
Lewcbj6efdddYDMwHwYDVR0jBBgwFoAUGtfxZr0hojQwLewcbj6efdddYDMwDwYD
VR0TAQH/BAUwAwEB/zAPBgNVHREECDAGhwR/AAABMAoGCCqGSM49BAMCA0kAMEYC
IQDLUV04+jGp3v6R1ju/pLZfJDKlMUryw3tEGyZO0mMXewIhANl4u7fM7Q7FtcY2
aOXjI8Pybb6Fd1F5RB0YNzT5T8tX
-----END CERTIFICATE-----`;

const ROOT = path.join(__dirname, '..');
const PORT = 3517;
const FAUX_PUSH_PORT = 3518;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-de-test-citations';
const DB = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/frutiparc_citations';
const RUN = Date.now().toString(36).slice(-5);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const CITE = 'perle' + RUN;        // le joueur cité — appli installée, absent
const CITEUR = 'grivois' + RUN;    // celui qui le cite

let proc = null;
let fauxPush = null;
let dispo = false;
const recus = [];

// Le téléphone simulé (même mécanique que appliMobile.test.js).
const ecdh = crypto.createECDH('prime256v1');
ecdh.generateKeys();
const AUTH_SECRET = crypto.randomBytes(16);
const b64url = (b) => Buffer.from(b).toString('base64url');
function abonnement(chemin) {
  return {
    endpoint: `https://127.0.0.1:${FAUX_PUSH_PORT}${chemin}`,
    keys: { p256dh: b64url(ecdh.getPublicKey()), auth: b64url(AUTH_SECRET) },
  };
}
function dechiffrer(corps) {
  const salt = corps.subarray(0, 16);
  const idlen = corps.readUInt8(20);
  const clePubServeur = corps.subarray(21, 21 + idlen);
  const chiffre = corps.subarray(21 + idlen);
  const partage = ecdh.computeSecret(clePubServeur);
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), clePubServeur]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', partage, AUTH_SECRET, info, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const dechiffreur = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  dechiffreur.setAuthTag(chiffre.subarray(chiffre.length - 16));
  let clair = Buffer.concat([dechiffreur.update(chiffre.subarray(0, chiffre.length - 16)), dechiffreur.final()]);
  let fin = clair.length - 1;
  while (fin >= 0 && clair[fin] === 0) fin--;
  return JSON.parse(clair.subarray(0, fin).toString('utf8'));
}

async function baseDisponible() {
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
  dispo = await baseDisponible();
  if (!dispo) return;
  fauxPush = https.createServer({ key: TLS_KEY, cert: TLS_CERT }, (req, res) => {
    const morceaux = [];
    req.on('data', (c) => morceaux.push(c));
    req.on('end', () => {
      recus.push({ url: req.url, corps: Buffer.concat(morceaux) });
      res.statusCode = 201;
      res.end();
    });
  });
  await new Promise((r) => fauxPush.listen(FAUX_PUSH_PORT, '127.0.0.1', r));

  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: DB, REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5286', FRUTISCORE_PORT: '5287',
      NODE_TLS_REJECT_UNAUTHORIZED: '0',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 160; i++) {
    try {
      if ((await fetch(BASE + '/do/prefdef')).ok) {
        const c = new Client({ connectionString: DB });
        await c.connect();
        const { rows } = await c.query(
          `SELECT 1 FROM information_schema.tables WHERE table_name = 'forum_posts'`);
        await c.end();
        if (rows.length) return;
      }
    } catch { /* pas prêt */ }
    await wait(250);
  }
  throw new Error('serveur ou schéma indisponible');
});

after(() => {
  if (proc) proc.kill('SIGKILL');
  if (fauxPush) fauxPush.close();
});

const jpost = (chemin, corps, cle) => fetch(BASE + chemin, {
  method: 'POST',
  headers: Object.assign({ 'Content-Type': 'application/json' }, cle ? { 'x-admin-key': CLE } : {}),
  body: JSON.stringify(corps),
}).then((r) => r.json());

async function sidPour(pseudo) {
  const body = JSON.stringify({ username: pseudo, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const j = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).json();
  assert.ok(j.sid, 'session pour ' + pseudo);
  return j.sid;
}

async function attendrePush(nAvant) {
  for (let i = 0; i < 40; i++) {
    if (recus.length > nAvant) return recus[recus.length - 1];
    await wait(100);
  }
  assert.fail('aucune notification reçue par le téléphone simulé');
}

let sidCite = null, sidCiteur = null, boardId = null, topicId = null;

test('mise en place : forum garni, cité abonné et absent', async (t) => {
  if (!dispo) return t.skip('pas de base PostgreSQL de test disponible');
  sidCite = await sidPour(CITE);
  sidCiteur = await sidPour(CITEUR);
  await jpost('/api/admin/forum/seed', {}, true);
  const index = await (await fetch(`${BASE}/api/forum/index?sid=${sidCite}`)).json();
  // Un forum OUVERT À TOUS : ni « Annonces » (modérateurs) ni « Animations
  // officielles » (animation). On prend « Frutiz », qui n'a jamais de garde.
  for (const cat of index.categories || []) {
    for (const b of cat.boards || []) {
      if (b.name === 'Frutiz') { boardId = b.id; break; }
    }
    if (boardId) break;
  }
  assert.ok(boardId, 'un forum où poster : ' + JSON.stringify(index).slice(0, 200));
  const ab = await jpost('/api/push/subscribe', { sid: sidCite, subscription: abonnement('/push/cite') });
  assert.equal(ab.ok, true);
  // Le cité ouvre le sujet… puis n'a plus aucune socket : il est absent.
  const sujet = await jpost('/api/forum/topic', {
    sid: sidCite, boardId: boardId,
    title: 'La vitrine du chapelier ' + RUN,
    content: 'Je trouve le Kiwix superbe, pas vous ?',
  });
  assert.ok(sujet.ok, 'sujet créé : ' + JSON.stringify(sujet).slice(0, 160));
  topicId = sujet.topicId || sujet.id;
  assert.ok(topicId, 'id du sujet : ' + JSON.stringify(sujet).slice(0, 160));
});

test('une réponse qui CITE un absent sonne sur son téléphone, sujet en lien', async (t) => {
  if (!dispo) return t.skip('pas de base PostgreSQL de test disponible');
  const n = recus.length;
  const rep = await jpost('/api/forum/post', {
    sid: sidCiteur, topicId: topicId,
    content: '[quote=' + CITE + ']\nJe trouve le Kiwix superbe, pas vous ?\n[/quote]\n\nPas mal, mais le Bananocle avait plus de panache.',
  });
  assert.ok(rep.ok, 'réponse postée : ' + JSON.stringify(rep).slice(0, 160));
  const p = await attendrePush(n);
  const charge = dechiffrer(p.corps);
  assert.match(charge.t, /te cite/, 'le titre annonce la citation : ' + charge.t);
  assert.match(charge.t, new RegExp(CITEUR, 'i'), 'et nomme le citeur');
  assert.match(charge.c, /La vitrine du chapelier/, 'le corps donne le sujet');
  assert.equal(charge.u, '/light?ouvre=forum&sujet=' + topicId, 'le clic mène AU sujet');
});

test('répondre sans citer ne sonne pas — et se citer soi-même non plus', async (t) => {
  if (!dispo) return t.skip('pas de base PostgreSQL de test disponible');
  const n = recus.length;
  // Le cité répond en se citant lui-même : aucune notification.
  const r1 = await jpost('/api/forum/post', {
    sid: sidCite, topicId: topicId,
    content: '[quote=' + CITE + ']\nJe trouve le Kiwix superbe.\n[/quote]\n\nJe persiste et signe.',
  });
  assert.ok(r1.ok, 'réponse du cité : ' + JSON.stringify(r1).slice(0, 160));
  // Le citeur répond SANS citer : répondre n'est pas citer.
  const r2 = await jpost('/api/forum/post', {
    sid: sidCiteur, topicId: topicId,
    content: 'On en reparle au stand alors.',
  });
  assert.ok(r2.ok, 'réponse simple : ' + JSON.stringify(r2).slice(0, 160));
  await wait(900);
  assert.equal(recus.length, n, 'aucune notification pour une réponse sans citation');
});
