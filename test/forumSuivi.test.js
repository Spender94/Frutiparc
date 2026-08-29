/*
 * LES SUJETS SUIVIS DU FORUM — le ❤, et les trois positions de `forum_notify`.
 *
 * « Est-il possible de personnaliser les notifications du forum afin de
 *   pouvoir choisir les topics pour lesquels on souhaite être notifiés quand
 *   je suis sur le frutidesk ? Pouvoir sélectionner les topics pour lesquels
 *   je souhaite recevoir une notification lorsqu'une personne poste — par
 *   exemple, je pourrais mettre un ❤ sur les sujets qui m'intéressent le
 *   plus. Pouvoir désactiver complètement les notifications du forum. Pouvoir
 *   laisser les notifications activées pour tous les topics, comme
 *   actuellement. »
 *
 * Le voyant d'origine (forumVoyant.test.js) compte TOUT sujet ayant du nouveau
 * depuis la dernière visite. La préférence 14 le module :
 *
 *   0 · rien du tout — le voyant reste éteint quoi qu'il arrive ;
 *   1 · tous les sujets — le comportement d'avant, et le défaut ;
 *   2 · seulement les sujets marqués d'un ❤.
 *
 * Ce fichier vérifie la mécanique de bout en bout, sur une vraie base : le ❤
 * se pose et se retire, il ressort dans la liste comme dans le sujet, et le
 * décompte du profil suit les trois positions.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'));
const WebSocket = require(path.join(__dirname, '..', 'node_modules', 'ws'));

const ROOT = path.join(__dirname, '..');
const PORT = 3431;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-forum-suivi';
const DB = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/frutiparc_forumsuivi';
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
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5201', FRUTISCORE_PORT: '5202',
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
          `SELECT 1 FROM information_schema.tables WHERE table_name = 'forum_topic_follows'`);
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

async function salons(sid) {
  for (let i = 0; i < 40; i++) {
    const index = await json(await fetch(`${BASE}/api/forum/index?sid=${sid}`));
    const liste = (index.categories || []).flatMap((c) => c.boards || []);
    if (liste.length) return liste;
    await wait(250);
  }
  throw new Error('les salons du forum ne sont jamais apparus');
}
async function inscrire(pseudo) {
  const body = JSON.stringify({ username: pseudo, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const j = await json(await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }));
  assert.ok(j.sid, 'session de ' + pseudo);
  return j.sid;
}
const compte = async (sid) => (await json(await fetch(`${BASE}/api/light/profile?sid=${sid}`))).forumUnread;

// Une socket de chat, pour écouter la trame `<ay>` que le serveur pousse
// quand un sujet bouge.
async function socket(pseudo, sid) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/`);
  const trames = [];
  let tampon = '';
  ws.on('message', (d) => {
    tampon += d.toString('utf8');
    const bouts = tampon.split('\0');
    tampon = bouts.pop();
    for (const b of bouts) if (b.trim()) trames.push(b.trim());
  });
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  ws.send(`<k l="${pseudo}" s="${sid}" />\0`);
  const c = {
    trames, ws,
    attendre: async (pred, ms = 5000) => {
      for (let i = 0; i < ms / 50; i++) {
        const t = trames.find(pred);
        if (t) return t;
        await wait(50);
      }
      return null;
    },
    fermer: () => { try { ws.close(); } catch { /* déjà fermée */ } },
  };
  await c.attendre((t) => t.startsWith('<k'));
  return c;
}
const poserMode = (sid, v) => fetch(`${BASE}/api/light/prefs`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ sid, prefs: { forum_notify: String(v) } }),
}).then(json);

test('le ❤ se pose, se retire, et se relit partout', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');

  const sidA = await inscrire('suiviauteur');
  const sidB = await inscrire('suivilecteur');
  const liste = await salons(sidA);
  const board = liste.find((b) => /frutiz/i.test(b.name) && !/jeux/i.test(b.name)) || liste[liste.length - 1];

  const cree = await json(await fetch(`${BASE}/api/forum/topic`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sid: sidA, boardId: board.id, title: 'Le fil qui compte',
      content: 'Un sujet à suivre, avec assez de texte pour passer le seuil du forum.' }),
  }));
  assert.ok(cree.topicId, 'le sujet est créé');

  // Au départ, personne ne le suit.
  let vu = await json(await fetch(`${BASE}/api/forum/topic/${cree.topicId}?sid=${sidB}`));
  assert.equal(vu.followed, false, 'aucun ❤ au départ');
  // Et le client sait quel mode est en vigueur, pour dire si le cœur commande
  // quelque chose : 1 par défaut.
  assert.equal(vu.forumNotify, 1, 'le mode par défaut voyage avec le sujet');

  // On le pose.
  const on = await json(await fetch(`${BASE}/api/forum/topic/${cree.topicId}/follow`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sid: sidB, follow: true }),
  }));
  assert.equal(on.followed, true);
  vu = await json(await fetch(`${BASE}/api/forum/topic/${cree.topicId}?sid=${sidB}`));
  assert.equal(vu.followed, true, 'le sujet le sait');
  // La LISTE aussi — c'est là qu'on repère ses fils d'un coup d'œil.
  const dossier = await json(await fetch(`${BASE}/api/forum/board/${board.id}?sid=${sidB}`));
  const ligne = dossier.topics.find((x) => x.id === cree.topicId);
  assert.ok(ligne, 'le sujet est dans la liste');
  assert.equal(ligne.followed, true, 'et la liste porte son ❤');

  // Sans corps, c'est une bascule : le bouton n'est pas une case à cocher.
  const off = await json(await fetch(`${BASE}/api/forum/topic/${cree.topicId}/follow`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sid: sidB }),
  }));
  assert.equal(off.followed, false, 'un second appel le retire');

  // Le ❤ est PERSONNEL : celui de B ne suit rien chez A.
  await fetch(`${BASE}/api/forum/topic/${cree.topicId}/follow`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sid: sidB, follow: true }),
  });
  const chezA = await json(await fetch(`${BASE}/api/forum/topic/${cree.topicId}?sid=${sidA}`));
  assert.equal(chezA.followed, false, 'A ne suit pas le sujet de B');
});

test('le voyant suit les trois positions de forum_notify', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');

  const sidA = await inscrire('suivipost');
  const sidB = await inscrire('suivivoyant');
  const liste = await salons(sidA);
  const board = liste.find((b) => /frutiz/i.test(b.name) && !/jeux/i.test(b.name)) || liste[liste.length - 1];

  // B repart d'une ardoise nette, sinon les sujets d'exemple faussent tout.
  await fetch(`${BASE}/api/forum/read-all`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sid: sidB }),
  });
  assert.equal(await compte(sidB), 0, 'tout est lu');

  // A ouvre DEUX sujets ; B n'en suivra qu'un.
  const ids = [];
  for (const titre of ['Le fil suivi', 'Le fil ignoré']) {
    const j = await json(await fetch(`${BASE}/api/forum/topic`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sid: sidA, boardId: board.id, title: titre,
        content: 'Assez de texte pour que le forum accepte ce message de test.' }),
    }));
    assert.ok(j.topicId, titre);
    ids.push(j.topicId);
  }

  // ── Mode 1 (le défaut) : les DEUX comptent. ──
  assert.equal(await compte(sidB), 2, 'mode 1 : tous les sujets');

  // ── Mode 0 : plus rien, quoi qu'il arrive. ──
  await poserMode(sidB, 0);
  assert.equal(await compte(sidB), 0, 'mode 0 : le voyant reste éteint');

  // ── Mode 2 : seulement le sujet marqué. ──
  await fetch(`${BASE}/api/forum/topic/${ids[0]}/follow`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sid: sidB, follow: true }),
  });
  await poserMode(sidB, 2);
  assert.equal(await compte(sidB), 1, 'mode 2 : seulement le sujet suivi');

  // Et le sujet suivi, une fois lu, s'éteint comme les autres. Ouvrir le sujet
  // pose la marque de lecture : `/api/forum/topic/:id` le fait au passage.
  await fetch(`${BASE}/api/forum/topic/${ids[0]}?sid=${sidB}`);
  await wait(300);                    // la marque part en tâche de fond
  assert.equal(await compte(sidB), 0, 'lu : le voyant retombe');

  // Retour au mode 1 : l'autre sujet, jamais ouvert, réapparaît. La
  // préférence FILTRE le décompte, elle n'efface rien.
  await poserMode(sidB, 1);
  assert.equal(await compte(sidB), 1, 'mode 1 : le sujet ignoré est toujours là');
});

test('la préférence se relit telle qu’elle a été posée', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');

  const sid = await inscrire('suiviprefs');
  const depart = await json(await fetch(`${BASE}/api/light/prefs?sid=${sid}`));
  assert.equal(depart.ok, true);
  assert.equal(depart.values.forum_notify, '1', 'le défaut est « tous les sujets »');
  // La rubrique Forum est servie avec ses trois choix, en base 62.
  const cat = depart.categories.find((c) => c.name === 'Forum');
  assert.ok(cat, 'la rubrique Forum existe');
  assert.deepEqual(cat.prefs[0].choices.map((c) => c.v), ['1', '2', '0']);

  const apres = await poserMode(sid, 2);
  assert.equal(apres.values.forum_notify, '2', 'la réponse rend l’état à jour');
  const relu = await json(await fetch(`${BASE}/api/light/prefs?sid=${sid}`));
  assert.equal(relu.values.forum_notify, '2');

  // Écrire une préférence ne touche pas aux autres : la chaîne est modifiée
  // entrée par entrée (`appliquerPref`), jamais remplacée en bloc.
  await fetch(`${BASE}/api/light/prefs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sid, prefs: { ch_dsp_h: 'N' } }),
  });
  const deux = await json(await fetch(`${BASE}/api/light/prefs?sid=${sid}`));
  assert.equal(deux.values.forum_notify, '2', 'le forum n’a pas bougé');
  assert.equal(deux.values.ch_dsp_h, 'N', 'et l’heure est bien coupée');

  // Reposer le DÉFAUT efface l'entrée plutôt que de l'écrire : la chaîne ne
  // porte que les écarts, comme `prefsavepartial` l'a toujours fait.
  await fetch(`${BASE}/api/light/prefs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sid, prefs: { forum_notify: '1' } }),
  });
  const trois = await json(await fetch(`${BASE}/api/light/prefs?sid=${sid}`));
  assert.equal(trois.values.forum_notify, '1');
  const c = new Client({ connectionString: DB });
  await c.connect();
  const { rows } = await c.query('SELECT prefs FROM users WHERE LOWER(username) = $1', ['suiviprefs']);
  await c.end();
  assert.ok(rows.length, 'le compte est en base');
  // Il ne reste QUE `ch_dsp_h` : id 9, longueur 1, valeur N.
  assert.equal(rows[0].prefs, '0901N', 'seul l’écart subsiste dans la chaîne');
});

test('devant son écran, on est prévenu PAR NOM du sujet qu’on suit', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');

  // C'est le cœur du signalement : « je suis notifié seulement pour mes
  // sujets suivis » — mais la poussée sur le téléphone ne part QUE pour un
  // absent (`estJoignableEnDirect`). Présent, il ne restait que le voyant
  // générique du raccourci Forum, que le light n'écoutait même pas.
  const sidA = await inscrire('suiviecran');    // celui qui suit, et qui est là
  const sidB = await inscrire('suivirepond');
  const sidC = await inscrire('suivipasse');    // il ne suit rien
  const liste = await salons(sidA);
  const board = liste.find((b) => /frutiz/i.test(b.name) && !/jeux/i.test(b.name)) || liste[liste.length - 1];

  const cree = await json(await fetch(`${BASE}/api/forum/topic`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sid: sidA, boardId: board.id, title: 'Mon fil préféré',
      content: 'Le sujet que je vais suivre, avec assez de texte pour passer.' }),
  }));
  await fetch(`${BASE}/api/forum/topic/${cree.topicId}/follow`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sid: sidA, follow: true }),
  });
  await poserMode(sidA, 2);

  const a = await socket('suiviecran', sidA);
  const c = await socket('suivipasse', sidC);
  try {
    await fetch(`${BASE}/api/forum/post`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sid: sidB, topicId: cree.topicId,
        content: 'Une réponse, qui doit se voir tout de suite à l’écran.' }),
    });
    // A suit le sujet : sa trame le NOMME.
    const t1 = await a.attendre((x) => x.startsWith('<ay'));
    assert.ok(t1, 'A doit recevoir la trame du forum');
    assert.match(t1, /s="1"/, 'elle dit que le sujet est suivi');
    assert.match(t1, new RegExp('i="' + cree.topicId + '"'), 'et elle porte son identifiant');
    assert.match(t1, /t="Mon fil préféré"/, 'et son titre');
    assert.match(t1, /u="suivirepond"/, 'et qui a répondu');
    // C ne le suit pas : il garde le drapeau NU d'époque.
    const t2 = await c.attendre((x) => x.startsWith('<ay'));
    assert.ok(t2, 'C reçoit le drapeau, il est en mode « tous les sujets »');
    assert.equal(t2.replace(/\s+/g, ''), '<ay/>', 'mais nu, sans le nom du sujet');
  } finally {
    a.fermer(); c.fermer();
  }
});
