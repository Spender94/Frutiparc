/*
 * Le VOYANT du forum, sur la barre de raccourcis de /light.
 *
 * Trois rubriques allumaient leur raccourci quand quelque chose attendait — la
 * messagerie, les événements, l'historique. Le forum, non : son entrée dans
 * HOME_SHORTCUTS n'avait pas d'icône d'alerte, aucun compte ne lui parvenait,
 * et le serveur n'en disait rien. Les trois manquaient à la fois.
 *
 * La règle retenue : TOUT sujet ayant du nouveau depuis la dernière visite,
 * partout sur le forum — la même que les dossiers du forum lui-même. Ses
 * propres messages ne comptent pas : poster ne doit pas s'allumer au visage.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'));

const ROOT = path.join(__dirname, '..');
const PORT = 3461;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-forum-voyant';
const DB = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/frutiparc_forumvoyant';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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

before(async () => {
  dispo = await baseNeuve();
  if (!dispo) return;
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: DB, REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5196', FRUTISCORE_PORT: '5197',
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
          `SELECT 1 FROM information_schema.tables WHERE table_name = 'forum_topics'`);
        await c.end();
        if (rows.length) return;
      }
    } catch {}
    await wait(250);
  }
  throw new Error('serveur ou schéma indisponible');
});
after(() => { if (proc) proc.kill('SIGKILL'); });

const json = (r) => r.json();
async function inscrire(pseudo) {
  const body = JSON.stringify({ username: pseudo, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const j = await json(await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }));
  assert.ok(j.sid, 'session de ' + pseudo);
  return j.sid;
}
const compte = async (sid) => (await json(await fetch(`${BASE}/api/light/profile?sid=${sid}`))).forumUnread;

test('le voyant du forum compte les sujets qui ont du nouveau', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');

  const sidA = await inscrire('forumauteur');
  const sidB = await inscrire('forumlecteur');
  // Un troisième pour la relance : le forum refuse deux messages d'affilée du
  // même auteur sur un sujet, donc A ne peut pas se répondre à lui-même.
  const sidC = await inscrire('forumrelance');

  // Un salon où poster : on prend le premier de la liste livrée au boot.
  const index = await json(await fetch(`${BASE}/api/forum/index?sid=${sidA}`));
  const liste = (index.categories || []).flatMap((c) => c.boards || []);
  assert.ok(liste.length, 'le forum a des salons');
  // Pas le premier : « Annonces » est réservé aux modérateurs. On prend un
  // salon où un frutiz ordinaire a le droit d'écrire.
  const board = liste.find((b) => /frutiz/i.test(b.name) && !/jeux/i.test(b.name)) || liste[liste.length - 1];
  const boardId = board.id;

  // ── 1. Rien n'a bougé : le voyant est éteint pour les deux. ──
  // (Le forum livré au boot peut porter des sujets d'exemple : on part de ce
  // qu'ils voient MAINTENANT, et on regarde la variation.)
  const departB = await compte(sidB);
  assert.equal(typeof departB, 'number', 'le profil rend bien un compte');

  // ── 2. A poste : B a du nouveau, A n'a rien. ──
  const r = await fetch(`${BASE}/api/forum/topic`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sid: sidA, boardId, title: 'Le voyant du forum', content: 'Un sujet tout neuf.' }),
  });
  assert.equal(r.status, 200, 'le sujet est créé');
  const cree = await json(r);
  const topicId = cree.topicId || cree.id || (cree.topic && cree.topic.id);
  assert.ok(topicId, 'on connaît le numéro du sujet');

  assert.equal(await compte(sidB), departB + 1, 'B voit un sujet de plus à lire');
  const apresA = await compte(sidA);
  assert.ok(apresA <= departB, 'et A ne se compte pas lui-même (' + apresA + ')');

  // ── 3. B ouvre le sujet : son voyant retombe. ──
  const ouvert = await fetch(`${BASE}/api/forum/topic/${topicId}?sid=${sidB}`);
  assert.equal(ouvert.status, 200, 'B ouvre le sujet');
  // La marque de lecture est posée en tâche de fond.
  let redescendu = null;
  for (let i = 0; i < 20; i++) {
    redescendu = await compte(sidB);
    if (redescendu === departB) break;
    await wait(200);
  }
  assert.equal(redescendu, departB, 'le sujet lu ne compte plus');

  // ── 4. Quelqu'un d'autre répond : le sujet redevient neuf pour B. ──
  const rep = await fetch(`${BASE}/api/forum/post`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sid: sidC, topicId, content: 'Et voici une réponse au sujet.' }),
  });
  assert.equal(rep.status, 200, 'la réponse passe');
  assert.equal(await compte(sidB), departB + 1, 'un sujet relancé se rallume');
});

test('le raccourci Forum a son icône d\'alerte, et de quoi l\'allumer', () => {
  // L'icône : la même forme dans le vert SOMBRE de l'écran allumé, exactement
  // comme l'historique et les événements. C'est l'inversion d'un segment de
  // LCD, pas un dessin nouveau.
  const repos = fs.readFileSync(path.join(ROOT, 'public/fb/Forum.svg'), 'utf8');
  const alerte = fs.readFileSync(path.join(ROOT, 'public/fb/ForumAlerte.svg'), 'utf8');
  assert.match(repos, /#a2eb56/, 'au repos, le vert clair');
  assert.match(alerte, /#2C4A0F/, 'allumée, le vert sombre');
  assert.ok(!/#a2eb56/.test(alerte), 'et plus une trace du vert clair');
  assert.equal(alerte.replace(/#2C4A0F/g, 'X'), repos.replace(/#a2eb56/g, 'X'),
    'même forme au pixel près — seule la couleur change');
  // Le témoin : l'historique suit la même règle.
  const hRepos = fs.readFileSync(path.join(ROOT, 'public/fb/Historique.svg'), 'utf8');
  const hAlerte = fs.readFileSync(path.join(ROOT, 'public/fb/HistoriqueAlerte.svg'), 'utf8');
  assert.equal(hAlerte.replace(/#2C4A0F/g, 'X'), hRepos.replace(/#a2eb56/g, 'X'),
    'la règle est bien celle du jeu d\'icônes');

  const html = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
  // Le raccourci déclare son voyant — sans quoi `majVoyant` ne l'allumerait
  // jamais, quel que soit le compte (`n > 0 && !!def.voyant`).
  assert.match(html, /\{ file: "Forum",\s+name: "Forum", go: "forum",\s+voyant: "ForumAlerte",\s+mot: "sujet" \}/);
  assert.match(html, /var allume = n > 0 && !!def\.voyant;/, 'la porte est bien celle-là');
  // Et le compte lui parvient : au chargement du profil, et à la construction
  // de la grille.
  assert.match(html, /setForumNonLus\(d\.forumUnread\);/);
  assert.match(html, /majVoyant\("Forum", forumNonLus\);/);
  // Quitter le forum redemande le compte : les sujets se lisent dans l'iframe,
  // hors de notre vue.
  assert.match(html, /if \(ongletCourant === "forum" && tab !== "forum"\) loadHomeProfile\(\);/);
});
