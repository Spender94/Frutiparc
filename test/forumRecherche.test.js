'use strict';
/*
 * LA RECHERCHE DU FORUM, contre une vraie base (sautée sans Postgres) :
 *
 *   · tous les mots doivent se trouver dans le message ou le titre du sujet,
 *     sans casse ni accents ;
 *   · filtres : auteur (champ ou « auteur:pseudo »), forum ;
 *   · chaque résultat dit son sujet, son forum, sa PAGE dans le sujet, et
 *     porte un extrait sans BBCode ;
 *   · les forums du staff ne sortent que pour le staff ;
 *   · le client a sa barre, sa vue et le saut au message.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'));

const ROOT = path.join(__dirname, '..');
const PORT = 3466;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-de-test';
const DB = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/frutiparc_forumrech';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let proc, dispo = false;

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
async function sql(q, p) {
  const c = new Client({ connectionString: DB });
  await c.connect();
  try { return (await c.query(q, p)).rows; } finally { await c.end(); }
}
before(async () => {
  dispo = await baseNeuve();
  if (!dispo) return;
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: DB, REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5214', FRUTISCORE_PORT: '5215',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {}); proc.stderr.on('data', () => {});
  for (let i = 0; i < 160; i++) { try { if ((await fetch(BASE + '/api/online-count')).ok) break; } catch { /* pas prêt */ } await wait(250); }
  for (let i = 0; i < 240; i++) {
    try { if ((await sql("SELECT 1 FROM forum_boards WHERE name = 'Frutiz' LIMIT 1")).length) break; } catch { /* pas encore */ }
    await wait(250);
  }
});
after(() => { if (proc) proc.kill('SIGKILL'); });

async function inscrire(pseudo) {
  const body = JSON.stringify({ username: pseudo, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const j = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).json();
  assert.ok(j.sid, 'session ' + pseudo);
  return j.sid;
}
const post = (url, corps) => fetch(BASE + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps) }).then((r) => r.json());
const chercher = (sid, params) => fetch(BASE + '/api/forum/search?' + new URLSearchParams(Object.assign({ sid }, params))).then((r) => r.json().then((j) => Object.assign({ statut: r.status }, j)));

test('la recherche trouve par tous les mots, sans accents, avec la page du message', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  const sidA = await inscrire('cerise');
  const sidB = await inscrire('figue');
  const board = (await sql("SELECT id FROM forum_boards WHERE name = 'Frutiz' LIMIT 1"))[0].id;

  const sujet = await post('/api/forum/topic', { sid: sidA, boardId: board, title: 'Les quêtes de Gromelin', content: 'Qui a fini sa [b]quête[/b] de la grenouille cette semaine ?' });
  const tid = sujet.topicId || sujet.id || (sujet.topic && sujet.topic.id);
  assert.ok(tid, JSON.stringify(sujet));
  // Vingt-cinq réponses : la dernière tombe en page 2.
  for (let i = 1; i <= 24; i++) await post('/api/forum/post', { sid: i % 2 ? sidB : sidA, topicId: tid, content: 'Réponse numéro ' + i + ' sur ce sujet, rien de spécial.' });
  const dernier = await post('/api/forum/post', { sid: sidB, topicId: tid, content: 'Enfin la grenouille dorée ! [quote=cerise]citation à ignorer[/quote] Merci pour l’astuce du nénuphar.' });
  assert.ok(!dernier.error, JSON.stringify(dernier));
  // Un second forum ouvert à tous (certains sont réservés à l'équipe : on prend le premier qui accepte).
  let ailleurs = false;
  for (const b of await sql("SELECT id FROM forum_boards WHERE name <> 'Frutiz' ORDER BY id")) {
    const rr = await post('/api/forum/topic', { sid: sidA, boardId: b.id, title: 'Une autre affaire', content: 'La grenouille joue aussi ailleurs, dans un autre forum.' });
    if (!rr.error) { ailleurs = true; break; }
  }

  // Sans accents ni casse, et TOUS les mots : « GRENOUILLE nenuphar » ne trouve que le dernier.
  let r = await chercher(sidA, { q: 'GRENOUILLE nenuphar' });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.total, 1);
  const hit = r.resultats[0];
  assert.deepStrictEqual([hit.topicId, hit.author, hit.page, hit.premier], [tid, 'figue', 2, false], JSON.stringify(hit));
  assert.match(hit.extrait, /grenouille dorée/);
  assert.doesNotMatch(hit.extrait, /citation à ignorer|\[quote/, 'les citations et le BBCode ne font pas l’extrait');
  assert.deepStrictEqual(r.mots, ['grenouille', 'nenuphar']);

  // Un mot du TITRE suffit à faire sortir les messages du sujet ; le premier est marqué.
  r = await chercher(sidA, { q: 'gromelin grenouille' });
  assert.strictEqual(r.total, 2, 'le premier message et la grenouille dorée (titre + texte)');
  assert.ok(r.resultats.some((x) => x.premier && x.page === 1));
  // Les plus récents d'abord.
  assert.ok(new Date(r.resultats[0].createdAt) >= new Date(r.resultats[1].createdAt));

  // Partout, la grenouille : trois messages ; dans le forum Frutiz seulement : deux.
  r = await chercher(sidA, { q: 'grenouille' });
  assert.strictEqual(r.total, ailleurs ? 3 : 2);
  r = await chercher(sidA, { q: 'grenouille', board });
  assert.strictEqual(r.total, 2);

  // L'auteur : par le champ, ou dans la question.
  r = await chercher(sidA, { q: 'grenouille', auteur: 'Figue' });
  assert.strictEqual(r.total, 1);
  assert.strictEqual(r.auteur, 'figue');
  r = await chercher(sidA, { q: 'auteur:cerise reponse' });
  assert.strictEqual(r.total, 12, 'les douze réponses de cerise');
  assert.strictEqual(r.resultats.length, 12);
  // Pagination : vingt par page.
  r = await chercher(sidA, { q: 'reponse numero' });
  assert.strictEqual(r.total, 24);
  assert.strictEqual(r.resultats.length, 20);
  assert.strictEqual((await chercher(sidA, { q: 'reponse numero', page: 2 })).resultats.length, 4);

  // Les jokers du LIKE ne sont pas des jokers.
  assert.strictEqual((await chercher(sidA, { q: '%_%' })).statut, 400, 'aucun mot de deux lettres : refusé');
  // La ponctuation sépare les mots (« gre%ille » = « gre » et « ille ») : jamais un joker SQL.
  assert.deepStrictEqual((await chercher(sidA, { q: 'gre%ille' })).mots, ['gre', 'ille']);
  // Une question vide : refusée poliment.
  const vide = await chercher(sidA, { q: ' a ' });
  assert.strictEqual(vide.statut, 400);
  assert.match(vide.message, /au moins un mot/);
});

test('les forums du staff ne sortent que pour le staff', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  const cat = (await sql("SELECT id FROM forum_categories WHERE name = 'Gestion du site' LIMIT 1"))[0];
  if (!cat) return t.skip('pas de catégorie staff dans cette base');
  const bStaff = (await sql('SELECT id FROM forum_boards WHERE category_id = $1 LIMIT 1', [cat.id]))[0];
  if (!bStaff) return t.skip('pas de forum staff');
  const sidModo = await inscrire('modorech');
  const sidJoueur = await inscrire('joueurrech');
  await fetch(`${BASE}/api/admin/users/modorech`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'x-admin-key': CLE }, body: JSON.stringify({ is_moderator: true }) });
  const s = await post('/api/forum/topic', { sid: sidModo, boardId: bStaff.id, title: 'Dossier confidentiel', content: 'Le mot secret est artichaut, entre nous.' });
  assert.ok(!s.error, JSON.stringify(s));
  assert.strictEqual((await chercher(sidModo, { q: 'artichaut' })).total, 1, 'le staff le trouve');
  assert.strictEqual((await chercher(sidJoueur, { q: 'artichaut' })).total, 0, 'un joueur non');
  assert.strictEqual((await chercher('', { q: 'artichaut' })).total, 0, 'un visiteur non plus');
});

test('le client : la barre sous l’en-tête, la vue des résultats, le saut au message', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/fb/index.html'), 'utf8');
  assert.match(html, /<form class="search-bar" id="search-bar" onsubmit="lancerRecherche\(\);return false" role="search">/);
  assert.match(html, /else if \(view === 'search'\) loadSearch\(extra \|\| \{\}\);/);
  assert.match(html, /if \(extra && typeof extra === 'object'\) loadTopic\(id, extra\.page, extra\.post\);/);
  assert.match(html, /\/api\/forum\/search\?q=/);
  // Le surlignage, rejoué ici sur la fonction du client.
  const src = /function surligner\(texteEchappe, mots\) \{[\s\S]*?\n\}/.exec(html)[0];
  const surligner = new Function(src + '; return surligner;')();
  assert.strictEqual(surligner('La Quête &amp; la quete', ['quete']), 'La <mark>Quête</mark> &amp; la <mark>quete</mark>');
  assert.strictEqual(surligner('&amp;', ['amp']), '&amp;', 'une entité n’est pas coupée');
  // Le mode nuit connaît la barre.
  const nuit = fs.readFileSync(path.join(ROOT, 'public/fb/nuit.css'), 'utf8');
  assert.match(nuit, /\.search-bar/);
});
