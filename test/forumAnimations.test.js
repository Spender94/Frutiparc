/*
 * « Animations officielles » — le forum de l'ANIMATION.
 *
 * Il annonce les animations que l'équipe organise : tout le monde le lit,
 * seule l'animation y écrit. Et puisque c'est leur panneau, les animateurs y
 * ont aussi les gestes de modération — épingler, verrouiller, supprimer —,
 * LÀ ET NULLE PART AILLEURS : hors de ce forum, un animateur reste un Frutiz
 * comme les autres.
 *
 * Ce que ces tests tiennent :
 *   · un Frutiz ne peut ni ouvrir un sujet ni répondre dans ce forum, et le
 *     refus le lui DIT (les deux voies : sujet neuf et réponse) ;
 *   · il écrit sans entrave dans les forums ordinaires ;
 *   · un animateur y écrit, y épingle et y verrouille ;
 *   · mais il ne modère PAS ailleurs — le pouvoir est attaché au forum ;
 *   · un modérateur, lui, peut partout.
 *
 * Le forum vit en base : PostgreSQL de test requis (cluster port 5433), sinon
 * tout est sauté proprement.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'));

const ROOT = path.join(__dirname, '..');
const PORT = 3519;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-de-test-animations';
const DB = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/frutiparc_animations';
const RUN = Date.now().toString(36).slice(-5);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const FRUTIZ = 'pepin' + RUN;
const ANIM = 'anima' + RUN;
const MOD = 'moder' + RUN;

let proc = null;
let dispo = false;
const sids = {};
let boardAnim = null, boardOrdinaire = null;

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
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5288', FRUTISCORE_PORT: '5289',
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
async function sacrer(pseudo, champs) {
  const r = await fetch(`${BASE}/api/admin/users/${encodeURIComponent(pseudo)}`, {
    method: 'PATCH', headers: chead, body: JSON.stringify(champs),
  });
  assert.ok(r.ok, 'rôle posé sur ' + pseudo + ' (' + r.status + ')');
}
// Ouvre un sujet et rend { statut, corps } — sans jamais lever.
async function ouvrirSujet(pseudo, boardId, titre) {
  const r = await post('/api/forum/topic', {
    sid: sids[pseudo], boardId,
    title: titre, content: 'Rendez-vous au stand des animations, venez nombreux !',
  });
  return { statut: r.status, corps: await r.json() };
}
async function repondre(pseudo, topicId, texte) {
  const r = await post('/api/forum/post', { sid: sids[pseudo], topicId, content: texte });
  return { statut: r.status, corps: await r.json() };
}
const basculer = (pseudo, topicId, quoi) =>
  post(`/api/forum/topic/${topicId}/${quoi}`, { sid: sids[pseudo] });

test('mise en place : trois Frutiz, trois rangs', async (t) => {
  if (!dispo) return t.skip('pas de base PostgreSQL de test disponible');
  await inscrire(FRUTIZ); await inscrire(ANIM); await inscrire(MOD);
  await sacrer(ANIM, { is_animator: true });
  await sacrer(MOD, { is_moderator: true });
  await post('/api/admin/forum/seed', {}, chead);
  const index = await (await fetch(`${BASE}/api/forum/index?sid=${sids[MOD]}`)).json();
  for (const cat of index.categories || []) {
    for (const b of cat.boards || []) {
      if (b.name === 'Animations officielles') boardAnim = b.id;
      if (b.name === 'Frutiz') boardOrdinaire = b.id;
    }
  }
  assert.ok(boardAnim, '« Animations officielles » existe');
  assert.ok(boardOrdinaire, 'et un forum ordinaire pour comparer');
});

test('un Frutiz ne peut pas ouvrir de sujet dans Animations officielles', async (t) => {
  if (!dispo) return t.skip('pas de base PostgreSQL de test disponible');
  const r = await ouvrirSujet(FRUTIZ, boardAnim, 'Mon animation à moi ' + RUN);
  assert.equal(r.statut, 403, 'refusé : ' + JSON.stringify(r.corps).slice(0, 160));
  assert.match(String(r.corps.message || ''), /animateurs et les modérateurs/,
    'et le refus le dit');
  // Mais il écrit sans entrave dans un forum ordinaire.
  const ok = await ouvrirSujet(FRUTIZ, boardOrdinaire, 'Coucou les Frutiz ' + RUN);
  assert.ok(ok.corps.ok, 'le forum ordinaire lui reste ouvert : ' + JSON.stringify(ok.corps).slice(0, 160));
});

test('l\'animation y écrit, et le Frutiz ne peut pas même y répondre', async (t) => {
  if (!dispo) return t.skip('pas de base PostgreSQL de test disponible');
  const sujet = await ouvrirSujet(ANIM, boardAnim, 'Grande chasse aux fruits ' + RUN);
  assert.ok(sujet.corps.ok, 'l\'animateur ouvre le sujet : ' + JSON.stringify(sujet.corps).slice(0, 160));
  const idAnim = sujet.corps.topicId || sujet.corps.id;
  assert.ok(idAnim, 'identifiant du sujet');

  const refus = await repondre(FRUTIZ, idAnim, 'Je viens ! On se retrouve où exactement ?');
  assert.equal(refus.statut, 403, 'la réponse est refusée aussi');
  assert.match(String(refus.corps.message || ''), /animateurs et les modérateurs/);

  // Le modérateur, lui, répond.
  const rep = await repondre(MOD, idAnim, 'Très bien, je relaie l\'annonce sur les salons.');
  assert.ok(rep.corps.ok, 'le modérateur répond : ' + JSON.stringify(rep.corps).slice(0, 160));

  // Et l'animateur MODÈRE son forum : épingler, verrouiller.
  const ep = await (await basculer(ANIM, idAnim, 'sticky')).json();
  assert.equal(ep.ok, true, 'il épingle');
  assert.equal(ep.isSticky, true, 'et le sujet est bien épinglé');
  const vr = await (await basculer(ANIM, idAnim, 'lock')).json();
  assert.equal(vr.ok, true, 'il verrouille');
  assert.equal(vr.isLocked, true, 'et le sujet est bien verrouillé');
});

test('hors de son forum, l\'animateur ne modère pas', async (t) => {
  if (!dispo) return t.skip('pas de base PostgreSQL de test disponible');
  const sujet = await ouvrirSujet(FRUTIZ, boardOrdinaire, 'Discussion entre Frutiz ' + RUN);
  assert.ok(sujet.corps.ok, 'sujet ordinaire créé');
  const id = sujet.corps.topicId || sujet.corps.id;

  const r = await basculer(ANIM, id, 'lock');
  assert.equal(r.status, 403, 'le pouvoir est attaché au forum, pas au grade');
  // Le modérateur, lui, peut partout.
  const m = await (await basculer(MOD, id, 'lock')).json();
  assert.equal(m.ok, true, 'le modérateur verrouille partout');
});

test('le client reçoit de quoi masquer les boutons', async (t) => {
  if (!dispo) return t.skip('pas de base PostgreSQL de test disponible');
  const vuFrutiz = await (await fetch(`${BASE}/api/forum/board/${boardAnim}?sid=${sids[FRUTIZ]}`)).json();
  assert.equal(vuFrutiz.board.postRestricted, true, 'le forum est signalé comme réservé');
  assert.equal(vuFrutiz.board.reservePour, 'animation', 'et à qui');
  assert.equal(vuFrutiz.peutPoster, false, 'le Frutiz ne peut pas écrire');
  assert.equal(vuFrutiz.peutModerer, false, 'ni modérer');

  const vuAnim = await (await fetch(`${BASE}/api/forum/board/${boardAnim}?sid=${sids[ANIM]}`)).json();
  assert.equal(vuAnim.peutPoster, true, 'l\'animateur écrit');
  assert.equal(vuAnim.peutModerer, true, 'et modère');

  const ailleurs = await (await fetch(`${BASE}/api/forum/board/${boardOrdinaire}?sid=${sids[ANIM]}`)).json();
  assert.equal(ailleurs.peutPoster, true, 'il écrit partout comme tout le monde');
  assert.equal(ailleurs.peutModerer, false, 'mais ne modère qu\'un seul forum');
});

// ── DEUX GESTES QUI MANQUAIENT AU FORUM ───────────────────────────────────
// Le forum est une page, pas un module : ces deux-là se lisent dans sa source.

test('on prévisualise une CORRECTION, pas seulement un message neuf', () => {
  const forum = require('node:fs').readFileSync(path.join(ROOT, 'public/fb/index.html'), 'utf8');
  // Le bouton, dans le formulaire d'édition d'un message…
  assert.match(forum, /onclick="previewEdit\(' \+ postId \+ '\)">Prévisualiser</,
    'le bouton Prévisualiser existe à l\'édition');
  assert.match(forum, /<div id="edit-preview-' \+ postId \+ '"><\/div>/,
    'et il a où écrire');
  // …et la fonction qui rend le BBCode.
  assert.match(forum, /function previewEdit\(postId\)/, 'la fonction existe');
  assert.match(forum, /renderBBCode\(ta\.value \|\| ''\)/, 'elle rend le BBCode saisi');
});

test('reculer d\'une page : le forum tient son propre historique', () => {
  const forum = require('node:fs').readFileSync(path.join(ROOT, 'public/fb/index.html'), 'utf8');
  assert.match(forum, /function pousserHistoire\(view, id, extra\)/, 'chaque vue pousse une entrée');
  // SANS toucher à l'URL : le sid de session y vit.
  assert.match(forum, /history\.pushState\([\s\S]{0,90}?, '', location\.href\)/,
    'l\'URL n\'est pas réécrite');
  assert.match(forum, /window\.addEventListener\('popstate'/, 'et le Retour du navigateur est écouté');
  assert.match(forum, /restaurationHistoire = true;/, 'une restauration ne repousse pas d\'entrée');
  // La pagination compte aussi comme un pas — « reculer d'une page », au sens propre.
  assert.match(forum, /function topicPage\(p\) \{ pousserHistoire\('topic'/, 'la pagination d\'un sujet');
  assert.match(forum, /function boardPage\(p\) \{ pousserHistoire\('board'/, 'et celle d\'un forum');
  // Et le bouton visible, pour ceux qui ne pensent pas au geste du navigateur.
  assert.match(forum, /onclick="reculerForum\(\);return false"/, 'le bouton « ‹ » de l\'en-tête');
  assert.match(forum, /function reculerForum\(\)/, 'et ce qu\'il fait');
});
