/*
 * DEUX ACCROCS DE LA RÉPONSE, relevés par des joueurs.
 *
 *   · « Quand un user répond à un topic et qu'il supprime son message, le
 *     système le considère toujours comme le dernier répondant et il ne peut
 *     plus reposter. »
 *
 *     `forum_topics.last_post_by` sert à l'affichage ET au garde-fou
 *     anti-double-post. La suppression n'effaçait que la ligne du message :
 *     le sujet continuait de nommer l'auteur du message disparu, qui se
 *     retrouvait muet sur son propre sujet. On recalcule la colonne à la
 *     suppression, ET le garde-fou relit désormais le dernier message plutôt
 *     que la copie — ce qui débloque aussi les sujets abîmés avant le
 *     correctif.
 *
 *   · « Lorsqu'on répond à un topic, on est censé arriver à la dernière page
 *     du topic, directement sur le dernier post qu'on vient de publier. En
 *     l'état on arrive sur une page vide qui n'existe pas encore. »
 *
 *     Le client comptait la page à la main : `ceil((total + 1) / 15)`, avec un
 *     total périmé et une taille de page inventée — le serveur pagine par
 *     VINGT. Vingt-et-un messages demandaient la page 2 d'un sujet qui n'en
 *     avait qu'une. Il demande maintenant `page=last` (le serveur fait le
 *     compte) et s'ancre sur l'identifiant du message renvoyé.
 *
 * Le forum vit en base : PostgreSQL de test requis (cluster port 5433), sinon
 * tout est sauté proprement.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fsMod = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'));

const ROOT = path.join(__dirname, '..');
const PORT = 3527;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-de-test-reponses';
const DB = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/frutiparc_reponses';
const RUN = Date.now().toString(36).slice(-5);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const A = 'alpin' + RUN;      // celui qui répond puis se supprime
const B = 'bleuet' + RUN;     // celui qui répond entre-temps

let proc = null;
let dispo = false;
const sids = {};
let board = null;

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
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: DB, REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5408', FRUTISCORE_PORT: '5409',
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

after(() => { if (proc) proc.kill('SIGKILL'); });

const jhead = { 'Content-Type': 'application/json' };
const chead = { 'Content-Type': 'application/json', 'x-admin-key': CLE };
const post = (chemin, corps, entetes) => fetch(BASE + chemin, {
  method: 'POST', headers: entetes || jhead, body: JSON.stringify(corps),
});

async function inscrire(pseudo) {
  const body = JSON.stringify({ username: pseudo, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: jhead, body });
  const j = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: jhead, body })).json();
  assert.ok(j.sid, 'session pour ' + pseudo);
  sids[pseudo] = j.sid;
}
async function repondre(pseudo, topicId, texte) {
  const r = await post('/api/forum/post', { sid: sids[pseudo], topicId, content: texte });
  return { statut: r.status, corps: await r.json() };
}
async function supprimer(pseudo, postId) {
  const r = await fetch(`${BASE}/api/forum/post/${postId}`, {
    method: 'DELETE', headers: jhead, body: JSON.stringify({ sid: sids[pseudo] }),
  });
  return { statut: r.status, corps: await r.json() };
}
const lireSujet = async (topicId, page) =>
  (await fetch(`${BASE}/api/forum/topic/${topicId}?page=${page}`)).json();

test('mise en place : deux Frutiz et un sujet', async (t) => {
  if (!dispo) return t.skip('pas de base PostgreSQL de test disponible');
  await inscrire(A); await inscrire(B);
  /*
   * LES FORUMS D'ORIGINE, sur une base neuve — et le piège du semis CONCURRENT.
   *
   * Le serveur sème les siens au démarrage, en tâche de fond. Semer à la main
   * pendant ce temps-là tombe sur « already seeded » : `/api/admin/forum/seed`
   * ne regarde que les CATÉGORIES, et celles-ci existent déjà quand les forums
   * qu'elles portent, eux, ne sont pas encore écrits. On attend donc de VOIR le
   * forum, comme on attend le reste du schéma plus haut.
   */
  for (let i = 0; i < 80 && !board; i++) {
    await post('/api/admin/forum/seed', {}, chead);
    const idx = await (await fetch(BASE + '/api/forum/index')).json();
    board = (idx.categories || []).flatMap((c) => c.boards || [])
      .find((b) => b.name === 'Frutiz') || null;
    if (!board) await wait(250);
  }
  assert.ok(board, 'un forum ordinaire où poster');
});

test('un message supprimé rend sa place au dernier répondant', async (t) => {
  if (!dispo) return t.skip('pas de base PostgreSQL de test disponible');
  const ouvert = await post('/api/forum/topic', {
    sid: sids[B], boardId: board.id,
    title: 'Le sujet du jour ' + RUN, content: 'On commence par le commencement.',
  });
  const topicId = (await ouvert.json()).topicId;
  assert.ok(topicId, 'sujet ouvert');

  // A répond — il est le dernier, il ne peut donc pas enchaîner.
  const premiere = await repondre(A, topicId, 'Je passe par là pour dire bonjour.');
  assert.equal(premiere.statut, 200, 'la première réponse passe');
  const suite = await repondre(A, topicId, 'Et j’ajoute une seconde chose.');
  assert.equal(suite.corps.error, 'double_post', 'deux d’affilée, non');

  // …il se supprime. Il redevient libre de parler.
  const efface = await supprimer(A, premiere.corps.postId);
  assert.equal(efface.statut, 200, 'suppression acceptée');
  const reprise = await repondre(A, topicId, 'Finalement je reformule mon propos.');
  assert.equal(reprise.statut, 200,
    'il peut reposter après avoir supprimé (' + JSON.stringify(reprise.corps) + ')');

  // Et le sujet nomme le bon dernier répondant, pas un fantôme.
  const vu = await lireSujet(topicId, 1);
  assert.equal(String(vu.topic.lastPostBy || '').toLowerCase(), A.toLowerCase());

  // Le garde-fou tient toujours : deux d'affilée restent interdits.
  const encore = await repondre(A, topicId, 'Une troisième pour la route, non ?');
  assert.equal(encore.corps.error, 'double_post', 'la règle n’a pas sauté');
});

test('un sujet vidé de ses réponses ne garde pas le nom d’un disparu', async (t) => {
  if (!dispo) return t.skip('pas de base PostgreSQL de test disponible');
  const ouvert = await post('/api/forum/topic', {
    sid: sids[B], boardId: board.id,
    title: 'Sujet à vider ' + RUN, content: 'Le premier message reste, lui.',
  });
  const topicId = (await ouvert.json()).topicId;
  const r = await repondre(A, topicId, 'Une réponse que je vais retirer.');
  await supprimer(A, r.corps.postId);
  const vu = await lireSujet(topicId, 1);
  // Il ne reste que le message d'ouverture : c'est son auteur qui a parlé en
  // dernier, et c'est LUI que le garde-fou doit retenir.
  assert.equal(String(vu.topic.lastPostBy || '').toLowerCase(), B.toLowerCase());
  const bis = await repondre(B, topicId, 'Je ne peux pas enchaîner sur moi-même.');
  assert.equal(bis.corps.error, 'double_post');
});

test('après avoir répondu, on atterrit sur la dernière page — et sur son message', async (t) => {
  if (!dispo) return t.skip('pas de base PostgreSQL de test disponible');
  const ouvert = await post('/api/forum/topic', {
    sid: sids[A], boardId: board.id,
    title: 'Sujet à pages ' + RUN, content: 'Message numéro un du sujet.',
  });
  const topicId = (await ouvert.json()).topicId;

  // Vingt-et-un messages : deux pages à vingt par page, UNE SEULE à quinze —
  // c'est précisément l'écart qui envoyait le joueur sur une page vide.
  let dernierPost = null;
  for (let i = 0; i < 21; i++) {
    const qui = i % 2 === 0 ? B : A;
    const r = await repondre(qui, topicId, 'Réponse numéro ' + (i + 2) + ' du sujet.');
    assert.equal(r.statut, 200, 'réponse ' + (i + 2) + ' : ' + JSON.stringify(r.corps));
    dernierPost = r.corps.postId;
  }
  assert.ok(dernierPost, 'le serveur rend l’identifiant du message publié');

  const vu = await lireSujet(topicId, 'last');
  assert.equal(vu.perPage, 20, 'le serveur pagine par vingt');
  assert.equal(vu.total, 22, 'vingt-deux messages en tout');
  assert.equal(vu.page, 2, 'la dernière page est la deuxième');
  assert.ok(vu.posts.length > 0, 'et elle n’est pas vide');
  assert.ok(vu.posts.some((p) => p.id === dernierPost),
    'le message qu’on vient de publier y est');

  // Le calcul d'époque, celui du client : il visait la page 2 quand le sujet
  // n'en avait qu'une, et la page 1 quand il en a deux. Faux dans les deux
  // sens — on vérifie qu'il a bien disparu du client.
  const PAGE = fsMod.readFileSync(path.join(ROOT, 'public/fb/index.html'), 'utf8');
  assert.ok(!/Math\.ceil\(totalAfter \/ 15\)/.test(PAGE), 'plus de page calculée à la main');
  assert.match(PAGE, /loadTopic\(currentTopicId, 'last', data\.postId\);/);
  assert.match(PAGE, /if \(allerA\) allerAuMessage\(allerA\);/);
});
