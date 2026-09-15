/*
 * CORRIGER UN MESSAGE, C'EST AUSSI CORRIGER SA TÊTE.
 *
 * « Lorsqu'on édite un post sur le forum, on doit pouvoir changer l'accessoire
 * et l'expression de la bouille. »
 *
 * L'accessoire et l'humeur sont des morceaux du message au même titre que son
 * texte — ils sont enregistrés avec lui (`forum_posts.bouille` et `.mood`) et
 * s'affichent à côté. Or « editer » n'ouvrait qu'un textarea : on se relisait,
 * on trouvait la mauvaise tête, et il n'y avait rien à faire — sinon supprimer
 * et reposter, ce qui coûte sa place dans le fil.
 *
 * DEUX RÈGLES portent tout le sujet :
 *
 *   · le sélecteur s'ouvre sur ce que le message porte DÉJÀ, pas sur
 *     l'accessoire par défaut : on rouvre pour changer, pas pour remettre à
 *     zéro ;
 *   · il n'apparaît que sur SON PROPRE message. Un modérateur corrige le TEXTE
 *     d'un autre ; lui laisser changer le visage, ce serait faire parler
 *     quelqu'un avec une autre figure que la sienne. Le client ne le montre
 *     pas, et le serveur le refuse — les deux, parce qu'une requête se
 *     fabrique à la main.
 *
 * Le forum vit en base : PostgreSQL de test requis (cluster port 5433), sinon
 * les cas serveur sont sautés proprement.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'));

const ROOT = path.join(__dirname, '..');
const PORT = 3535;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-editer-bouille';
const DB = process.env.TEST_DATABASE_URL_EDITION
  || 'postgres://postgres@127.0.0.1:5433/frutiparc_edition';
const RUN = Date.now().toString(36).slice(-5);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Trois états de bouille reconnaissables : la même tête, trois accessoires.
const TETE = '000300000001000';
const MASQUE = TETE + 'a0b0a080m';
const CHAPEAU = TETE + '4020B0000';
const INTRUS = TETE + '9020t0a00';

const AUTEUR = 'edit' + RUN;
const MODO = 'edmo' + RUN;

let proc = null, dispo = false, board = null;
const sids = {};

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
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5296', FRUTISCORE_PORT: '5297',
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

const JSN = { 'Content-Type': 'application/json' };
const CLEF = { 'Content-Type': 'application/json', 'x-admin-key': CLE };

async function inscrire(pseudo) {
  const body = JSON.stringify({ username: pseudo, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: JSN, body });
  const j = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: JSN, body })).json();
  assert.ok(j.sid, 'session pour ' + pseudo);
  sids[pseudo] = j.sid;
}
const ouvrirSujet = async (pseudo, titre, bouille, mood) =>
  (await (await fetch(BASE + '/api/forum/topic', {
    method: 'POST', headers: JSN,
    body: JSON.stringify({ sid: sids[pseudo], boardId: board.id, title: titre,
      content: 'Un message de départ, assez long pour le filtre.', bouille, mood }),
  })).json()).topicId;
const corriger = async (pseudo, postId, corps) => {
  const r = await fetch(`${BASE}/api/forum/post/${postId}`, {
    method: 'PUT', headers: JSN, body: JSON.stringify({ sid: sids[pseudo], ...corps }),
  });
  return { statut: r.status, corps: await r.json() };
};
const premierMessage = async (topicId) =>
  (await (await fetch(`${BASE}/api/forum/topic/${topicId}?page=1`)).json()).posts[0];

test('mise en place : un auteur, un modérateur, un forum', async (t) => {
  if (!dispo) return t.skip('pas de base PostgreSQL de test disponible');
  await inscrire(AUTEUR); await inscrire(MODO);
  await fetch(BASE + `/api/admin/users/${MODO}`, {
    method: 'PATCH', headers: CLEF, body: JSON.stringify({ is_moderator: true }),
  });
  // Le serveur sème AUSSI ses forums au démarrage, en tâche de fond : semer à
  // la main pendant ce temps-là tombe sur « already seeded » (l'endpoint ne
  // regarde que les catégories, qui existent avant les forums qu'elles
  // portent). On attend donc de VOIR le forum.
  for (let i = 0; i < 80 && !board; i++) {
    await fetch(BASE + '/api/admin/forum/seed', { method: 'POST', headers: CLEF, body: '{}' });
    const idx = await (await fetch(BASE + '/api/forum/index')).json();
    board = (idx.categories || []).flatMap((c) => c.boards || []).find((b) => b.name === 'Frutiz') || null;
    if (!board) await wait(250);
  }
  assert.ok(board, 'un forum ordinaire où poster');
});

test('l’auteur reprend l’accessoire ET l’expression de son message', async (t) => {
  if (!dispo) return t.skip('pas de base PostgreSQL de test disponible');
  const topicId = await ouvrirSujet(AUTEUR, 'Je me suis trompé de tête ' + RUN, MASQUE, 0);
  const avant = await premierMessage(topicId);
  assert.equal(avant.bouille, MASQUE, 'le message part avec le masque');
  assert.equal(avant.mood, 0);

  const r = await corriger(AUTEUR, avant.id, {
    content: 'Le texte corrigé, lui aussi assez long.', bouille: CHAPEAU, mood: 3,
  });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  const apres = await premierMessage(topicId);
  assert.equal(apres.bouille, CHAPEAU, 'la bouille a suivi la correction');
  assert.equal(apres.mood, 3, 'et l’expression aussi');
  assert.match(apres.content, /texte corrigé/);
});

test('une correction SANS bouille ne débouille pas le message', async (t) => {
  if (!dispo) return t.skip('pas de base PostgreSQL de test disponible');
  const topicId = await ouvrirSujet(AUTEUR, 'Je ne corrige que le texte ' + RUN, MASQUE, 5);
  const p = await premierMessage(topicId);
  const r = await corriger(AUTEUR, p.id, { content: 'Juste une faute d’orthographe en moins.' });
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  const apres = await premierMessage(topicId);
  assert.equal(apres.bouille, MASQUE, 'ce qu’on ne donne pas reste en place');
  assert.equal(apres.mood, 5);
});

test('un modérateur corrige le texte d’un autre, jamais son visage', async (t) => {
  if (!dispo) return t.skip('pas de base PostgreSQL de test disponible');
  const topicId = await ouvrirSujet(AUTEUR, 'Un sujet à modérer ' + RUN, MASQUE, 2);
  const p = await premierMessage(topicId);
  const r = await corriger(MODO, p.id, {
    content: 'Message corrigé par la modération, merci.', bouille: INTRUS, mood: 7,
  });
  assert.equal(r.statut, 200, 'il a bien le droit de corriger le texte');
  const apres = await premierMessage(topicId);
  assert.match(apres.content, /corrigé par la modération/, 'le texte a changé');
  assert.equal(apres.bouille, MASQUE, 'la bouille de l’auteur n’a pas bougé');
  assert.equal(apres.mood, 2, 'son expression non plus');
});

test('le formulaire de correction part de la bouille du message', () => {
  const FORUM = fs.readFileSync(path.join(ROOT, 'public/fb/index.html'), 'utf8');
  const DB_JS = fs.readFileSync(path.join(ROOT, 'db.js'), 'utf8');
  const SERVEUR = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

  // Le sélecteur accepte un point de départ, et la correction lui donne celui
  // du message — pas le défaut du joueur.
  assert.match(FORUM, /function bouilleSelHtml\(formId, depart\) \{/);
  assert.match(FORUM, /_activeBouilleSel\[formId\] = departDuSelecteur\(depart\);/);
  assert.match(FORUM, /bouilleSelHtml\(taId, bouilleDuMessage\(postId\)\)/);
  // Les trois cas d'un état enregistré : bouille entière, incarnation, accessoire.
  const dep = /function departDuSelecteur\(depart\) \{[\s\S]*?\n\}/.exec(FORUM);
  assert.ok(dep, 'departDuSelecteur doit exister');
  assert.match(dep[0], /accSuffix9: suffixeParDefaut\(\)/, 'sans état : le défaut du joueur');
  assert.match(dep[0], /fullState: etat/, 'un accessoire qui EST une bouille gagne');
  assert.match(dep[0], /e\.substring\(0, 15\) === etat\.substring\(0, 15\)/, 'une incarnation sert de base');

  // Seulement sur SON message, côté client…
  assert.match(FORUM, /var sien = estMonMessage\(postId\);/);
  assert.match(FORUM, /sien && myBouille\n\s+\? '<div class="editor-form">' \+ bouilleSelHtml/);
  assert.match(FORUM, /if \(_activeBouilleSel\['edit-textarea-' \+ postId\]\) \{/);
  // …et côté serveur, qui ne fait pas confiance au client.
  assert.match(SERVEUR, /const sien = post\.author_username === username;/);
  assert.match(SERVEUR, /const bouille = \(sien && req\.body\.bouille\) \? normalizeBouilleState\(req\.body\.bouille\) : null;/);
  assert.match(SERVEUR, /const mood = sien \? normalizeForumMood\(req\.body\.mood\) : null;/);
  assert.match(SERVEUR, /await db\.forumUpdatePost\(post\.id, content, bouille, mood\);/);
  // `null` veut dire « n'y touche pas » — d'où le COALESCE.
  assert.match(DB_JS, /bouille = COALESCE\(\$3, bouille\)/);
  assert.match(DB_JS, /mood\s+= COALESCE\(\$4, mood\)/);

  // L'aperçu, c'est la bouille du message elle-même : on lui prête
  // l'identifiant que `refreshBouillePreview` cherche, et on le lui rend.
  assert.match(FORUM, /if \(sien && avatar\) avatar\.id = 'bouille-preview-' \+ taId;/);
  assert.match(FORUM, /avatar\.removeAttribute\('id'\);/);
  assert.match(FORUM, /delete _activeBouilleSel\['edit-textarea-' \+ postId\];/);
});
