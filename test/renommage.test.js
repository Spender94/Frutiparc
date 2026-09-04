'use strict';
/*
 * CHANGER LE PSEUDO D'UN JOUEUR — ET TOUT CE QUI LE DÉSIGNE
 * ════════════════════════════════════════════════════════
 *
 * « Étudier la faisabilité de pouvoir changer le pseudo d'un joueur : quelles
 *   adhérences avec le reste du site ? »
 *
 * La réponse tient en une phrase : presque tout ce qui APPARTIENT au joueur
 * est rangé sous son NUMÉRO de compte (scores, accessoires, objets, journaux,
 * courriers reçus, quotas) et ne bouge pas ; ce qui le désigne par son PSEUDO
 * — parce que la ligne appartient à quelqu'un d'autre, ou parce qu'elle est
 * une trace nominative — doit être balayé.
 *
 * Ce test dresse un passé complet à un joueur (forum, courrier, achat,
 * revente, don, article signé, carnet d'un autre, liste noire d'un troisième,
 * filleul, trombinoscope, médaille), le renomme, et vérifie DEUX choses :
 *
 *   · il retrouve tout — son solde, ses affaires, ses sujets, son passé ;
 *   · plus rien ne pointe vers l'ancien nom, sauf le TEXTE des messages, qui
 *     raconte ce qui s'est dit à l'époque où il s'appelait ainsi.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'));

const ROOT = path.join(__dirname, '..');
const PORT = 3573;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-renommage';
const DB = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/frutiparc_renommage';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let proc = null;
async function baseDisponible() {
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
async function demarrer() {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: DB, REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5306', FRUTISCORE_PORT: '5307',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 200; i++) {
    try {
      if ((await fetch(BASE + '/api/loadFrutiSlots?game=snake3')).ok) {
        const c = new Client({ connectionString: DB });
        await c.connect();
        const { rows } = await c.query(
          `SELECT 1 FROM information_schema.tables WHERE table_name = 'forum_topics'`);
        await c.end();
        if (rows.length) { await wait(1500); return; }   // le temps des semis du forum
      }
    } catch {}
    await wait(250);
  }
  throw new Error('serveur ou schéma indisponible');
}
let dispo = false;
before(async () => { dispo = await baseDisponible(); if (dispo) await demarrer(); });
after(() => { if (proc) proc.kill('SIGKILL'); });

const HDR = { 'Content-Type': 'application/json', 'x-admin-key': CLE };
const jsonPost = (chemin, corps) => fetch(BASE + chemin, { method: 'POST', headers: HDR, body: JSON.stringify(corps) });
async function inscrire(pseudo, parrain) {
  const body = JSON.stringify({ username: pseudo, password: 'secret123', parrain });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: HDR, body });
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: HDR,
    body: JSON.stringify({ username: pseudo, password: 'secret123' }) });
  const j = await r.json();
  assert.ok(j.sid, 'session de ' + pseudo + ' : ' + JSON.stringify(j));
  return j.sid;
}
const sql = async (q, p) => {
  const c = new Client({ connectionString: DB });
  await c.connect();
  try { return (await c.query(q, p)).rows; } finally { await c.end(); }
};

const BOB = 'bobrn', BOBBY = 'bobbyrn', ALICE = 'alicern', CAROL = 'carolrn', FILLEUL = 'filleulrn';
const PACK = 700960;
const S = {};
let topicId = 0;

test('un joueur se bâtit un passé : forum, courrier, boutique, carnets', async (t) => {
  if (!dispo) return t.skip('base indisponible');
  S.bob = await inscrire(BOB);
  S.alice = await inscrire(ALICE);
  S.carol = await inscrire(CAROL);
  S.filleul = await inscrire(FILLEUL, BOB);          // users.referred_by = bob

  // Le forum : un sujet et une réponse.
  const index = await (await fetch(`${BASE}/api/forum/index?sid=${S.bob}`)).json();
  // Ni « Annonces » ni « Animations officielles » : ces rayons-là sont
  // réservés à l'équipe.
  const board = (index.categories || []).flatMap((c) => c.boards || [])
    .find((b) => !/annonce|animation/i.test(b.name || ''));
  assert.ok(board, 'un rayon ouvert du forum existe : '
    + JSON.stringify((index.categories || []).flatMap((c) => (c.boards || []).map((b) => b.name))));
  const sujet = await (await jsonPost('/api/forum/topic', {
    sid: S.bob, boardId: board.id, title: 'Le sujet de ' + BOB,
    content: 'Un message assez long pour passer le seuil du forum.' })).json();
  topicId = sujet.topicId || sujet.id;
  assert.ok(topicId, 'sujet créé : ' + JSON.stringify(sujet).slice(0, 120));
  const rep = await (await jsonPost('/api/forum/post', {
    sid: S.alice, topicId, content: 'Bien joué ' + BOB + ', beau sujet !' })).json();
  assert.ok(rep.ok || rep.postId, 'réponse postée');

  // La boutique : un article signé de bob, acheté par alice (commission), et
  // un achat de bob qu'il revend.
  assert.equal((await jsonPost('/api/admin/shop', {
    id: PACK, name: 'Casquette de ' + BOB, category: 'Accessoires', price: 60, suffix9: '30d0t0j0o', auteur: BOB })).status, 200);
  await fetch(`${BASE}/api/admin/users/${ALICE}`, { method: 'PATCH', headers: HDR, body: JSON.stringify({ kikooz: 500 }) });
  assert.equal((await (await jsonPost('/api/light/shop/buy', { sid: S.alice, id: PACK })).json()).ok, true);
  assert.equal((await (await jsonPost('/api/light/shop/buy', { sid: S.bob, id: PACK })).json()).ok, true);
  assert.equal((await (await jsonPost('/api/light/shop/vendre', { sid: S.bob, id: PACK })).json()).ok, true);

  // Un don d'alice à bob (kikooz_gifts), un courrier de bob à alice.
  await fetch(`${BASE}/do/give?sid=${S.alice}&u=${BOB}&k=5&r=cadeau`);
  const envoi = await (await jsonPost('/api/light/mail/send', {
    sid: S.bob, to: ALICE + '@frutiparc.com', subject: 'Coucou', body: 'Un mot de ' + BOB })).json();
  assert.equal(envoi.ok, true, JSON.stringify(envoi));

  // Le carnet d'alice, la liste noire de carol.
  await fetch(`${BASE}/ff/mk?sid=${S.alice}&t=contact&folder=mycontact&d=${BOB}@frutiparc.com`);
  await fetch(`${BASE}/ff/mk?sid=${S.carol}&t=contact&folder=blacklist&d=${BOB}@frutiparc.com`);

  // Le trombinoscope, et une médaille du challenge.
  await sql('INSERT INTO trombinoscope (pseudo, bouille, sort_order) VALUES ($1, $2, 1)', [BOB, '000000010000000000000000']);
  const bobRow = (await sql('SELECT id FROM users WHERE username = $1', [BOB]))[0];
  await sql(`INSERT INTO challenge_medals (user_id, username, ranking_id, game, rank, medal, awarded_day)
             VALUES ($1, $2, 'snake3_classic', 'snake3', 1, 'or', '2026-09-03')`, [bobRow.id, BOB]);

  // De quoi comparer après : ce que le compte possède.
  S.avant = await (await fetch(`${BASE}/api/forum/me?sid=${S.bob}`)).json();
  assert.equal(S.avant.user, BOB);
});

test('le renommage : le compte suit, et tout ce qui le désigne aussi', async (t) => {
  if (!dispo) return t.skip('base indisponible');
  const r = await (await jsonPost(`/api/admin/users/${BOB}/renommer`, { nouveau: BOBBY })).json();
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.nouveau, BOBBY);
  // Le mot de passe ne change pas : il se reconnecte sous son nouveau nom.
  const echec = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: HDR,
    body: JSON.stringify({ username: BOB, password: 'secret123' }) });
  assert.equal(echec.status, 401, 'l’ancien pseudo n’ouvre plus rien');
  const sid = await inscrire(BOBBY);   // (l'inscription échoue, la connexion passe)
  S.bobby = sid;

  // CE QUI LUI APPARTIENT (rangé sous son numéro) : intact.
  const apres = await (await fetch(`${BASE}/api/forum/me?sid=${sid}`)).json();
  assert.equal(apres.user, BOBBY, 'il porte son nouveau nom');
  assert.deepEqual(apres.accessories.map((a) => a.name), S.avant.accessories.map((a) => a.name),
    'ses accessoires sont les mêmes');
  assert.equal(apres.bouille, S.avant.bouille, 'et sa bouille');
  const kik = await (await fetch(`${BASE}/api/light/kikooz?sid=${sid}`)).json();
  assert.ok(kik.events.length >= 3, 'son historique kikooz le suit : ' + kik.events.length);

  // CE QUI LE DÉSIGNE : réécrit partout.
  const attendu = [
    ['forum_topics', 'author_username'], ['forum_posts', 'author_username'],
    ['shop_purchases', 'username'], ['shop_sales', 'username'],
    ['challenge_medals', 'username'], ['trombinoscope', 'pseudo'],
    ['kikooz_gifts', 'recipient'], ['user_mails', 'from_user'],
    ['shop_packs', 'auteur'], ['users', 'referred_by'],
  ];
  for (const [table, col] of attendu) {
    const anciens = await sql(`SELECT COUNT(*)::int AS n FROM ${table} WHERE LOWER(${col}) = $1`, [BOB]);
    const neufs = await sql(`SELECT COUNT(*)::int AS n FROM ${table} WHERE LOWER(${col}) = $1`, [BOBBY]);
    assert.equal(anciens[0].n, 0, `${table}.${col} : plus rien à l'ancien nom`);
    assert.ok(neufs[0].n > 0, `${table}.${col} : ${neufs[0].n} ligne(s) au nouveau`);
  }
  // Les adresses : le carnet d'alice et la liste noire de carol.
  assert.deepEqual((await sql('SELECT contact_name FROM contacts WHERE contact_name ILIKE $1', ['%rn@%']))
    .map((x) => x.contact_name), [BOBBY + '@frutiparc.com'], 'le carnet d’alice suit');
  assert.deepEqual((await sql('SELECT blocked_name FROM blacklist')).map((x) => x.blocked_name),
    [BOBBY + '@frutiparc.com'], 'la liste noire de carol aussi');
  // Le courrier : expéditeur, adresse d'expéditeur, et la liste des destinataires.
  const courriers = await sql('SELECT from_user, from_addr, to_users FROM user_mails ORDER BY from_user');
  for (const m of courriers) {
    assert.equal(m.from_user.toLowerCase(), BOBBY);
    assert.equal(m.from_addr, BOBBY + '@frutiparc.com');
  }
  // Le TEXTE, lui, ne bouge pas : c'est l'histoire.
  const posts = await sql('SELECT content FROM forum_posts WHERE content ILIKE $1', ['%' + BOB + '%']);
  assert.ok(posts.length > 0, 'le message d’alice dit toujours « Bien joué bobrn »');
  const titres = await sql('SELECT title FROM forum_topics WHERE title ILIKE $1', ['%' + BOB + '%']);
  assert.equal(titres.length, 1, 'et le titre du sujet garde le nom d’alors');
});

test('l’ancien pseudo est réservé, et on ne renomme pas n’importe comment', async (t) => {
  if (!dispo) return t.skip('base indisponible');
  // Personne ne reprend l'ancien nom : il désigne encore un passé.
  const r = await fetch(BASE + '/api/auth/register', { method: 'POST', headers: HDR,
    body: JSON.stringify({ username: BOB, password: 'secret123' }) });
  assert.equal(r.status, 409, 'l’ancien pseudo est réservé');
  assert.deepEqual((await sql('SELECT username FROM deleted_usernames')).map((x) => x.username), [BOB]);
  // Un pseudo déjà porté, un pseudo invalide, un joueur inconnu : refusés.
  const pris = await (await jsonPost(`/api/admin/users/${BOBBY}/renommer`, { nouveau: ALICE })).json();
  assert.equal(pris.code, 'pris');
  const mauvais = await (await jsonPost(`/api/admin/users/${BOBBY}/renommer`, { nouveau: 'é' })).json();
  assert.equal(mauvais.code, 'invalide');
  const inconnu = await (await jsonPost('/api/admin/users/personne/renommer', { nouveau: 'quelquun' })).json();
  assert.equal(inconnu.code, 'introuvable');
  const memeNom = await (await jsonPost(`/api/admin/users/${BOBBY}/renommer`, { nouveau: BOBBY })).json();
  assert.equal(memeNom.code, 'identique');
  // Et on ne prend pas un pseudo réservé (ici, l'ancien nom du renommé).
  const reserve = await (await jsonPost(`/api/admin/users/${ALICE}/renommer`, { nouveau: BOB })).json();
  assert.equal(reserve.code, 'reserve');
});

test('la liste des colonnes balayées couvre ce que la base range par pseudo', () => {
  // Un garde-fou de RELECTURE : si une table gagne demain une colonne de
  // pseudo, ce test ne la connaîtra pas — mais celles d'aujourd'hui sont
  // toutes là, et le tableau ci-dessous dit lesquelles, une fois pour toutes.
  const D = require(path.join(ROOT, 'db.js'));
  const colonnes = new Set(D.RENOMMAGE_COLONNES.concat(D.RENOMMAGE_ADRESSES).map(([t, c]) => t + '.' + c));
  for (const attendue of [
    'challenge_medals.username', 'challenge_score_archive.username',
    'shop_purchases.username', 'shop_sales.username', 'push_subscriptions.username',
    'tournaments.champion', 'tournament_players.username', 'tournament_matches.player1',
    'tournament_matches.player2', 'tournament_matches.winner', 'tournament_round_scores.username',
    'trombinoscope.pseudo', 'forum_topics.author_username', 'forum_topics.last_post_by',
    'forum_posts.author_username', 'forum_topic_reads.username', 'forum_topic_follows.username',
    'user_mails.from_user', 'user_mails.from_addr', 'moderation_logs.target_username',
    'moderation_logs.moderator', 'kikooz_gifts.giver', 'kikooz_gifts.recipient',
    'swapou_ia_scores.username', 'contacts.contact_name', 'blacklist.blocked_name',
    'shop_packs.auteur', 'users.referred_by',
  ]) {
    assert.ok(colonnes.has(attendue), attendue + ' doit être balayée');
  }
  // Et côté serveur : la mémoire, les fichiers, la déconnexion, la réservation.
  const SERVEUR = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const f = /function renommerEnMemoire\(a, n, affichage\) \{[\s\S]*?\n\}/.exec(SERVEUR)[0];
  for (const sac of ['scoresData.users', 'dailyXpActions', 'accMaisonEquip', 'bouilleCache',
    'partiesEnCours', 'recentlyEjected', 'traceSubscriptions', 'pendingChannelCleanup']) {
    assert.ok(f.includes(sac), sac + ' est déplacé en mémoire');
  }
  assert.match(f, /saveScoresFile\(\)/);
  assert.match(f, /saveXpActions\(\)/);
  assert.match(f, /saveChallengeMedals\(\)/);
  assert.match(f, /persistTrombinoscope\(\)/);
  assert.match(f, /sock\.destroy\(\)/, 'ses sockets se ferment');
  assert.match(SERVEUR, /await db\.reserveUsername\(a, 'renommage:' \+ par\)/, 'l’ancien pseudo est réservé');
});
