'use strict';
/*
 * LES PICTOS D'UN MESSAGE, RANGÉS PAR JEU.
 *
 * « Les pictos qu'on peut poster dans un message sont dans le désordre.
 *   Peut-être les classer par jeu pour plus de lisibilité ? »
 *
 * Le sélecteur de l'éditeur du forum (bouton « Pictos », BBCode [picto=…])
 * posait les pictos dans l'ordre de user.gameItems — celui des parties
 * gagnées. Le serveur les range désormais (pictosRangesParJeu) : jeux par
 * ordre alphabétique, « Autre » en dernier, pictos dans l'ordre du catalogue
 * de leur jeu ; le sélecteur pose un intertitre à chaque jeu. La galerie
 * « Mes Pictos », l'inventaire du light et les dossiers du bureau lisent le
 * même ordre.
 *
 * Le salon (light, bureau, Flash) n'a pas de sélecteur de pictos : seul
 * l'éditeur du forum en a un.
 *
 * Partie « serveur vivant » : PostgreSQL de test (port 5433) ; sinon sautée.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SRV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const FORUM = fs.readFileSync(path.join(ROOT, 'public', 'fb', 'index.html'), 'utf8');
const LIGHT = fs.readFileSync(path.join(ROOT, 'public', 'light.html'), 'utf8');

// pictosRangesParJeu, extraite et lancée sur un petit catalogue de doublure.
function rangeur() {
  const debut = SRV.indexOf('const RANG_CATALOGUE_PICTO = ');
  const fin = SRV.indexOf('function dossiersPictos(user) {');
  assert.ok(debut > 0 && fin > debut, 'pictosRangesParJeu existe, avant dossiersPictos');
  const ctx = {
    GAME_ITEM_INFO: {
      '$butterfly0': { name: 'Papillon vert', game: 'Kaluga' },
      '$butterfly1': { name: 'Papillon jaune', game: 'Kaluga' },
      '$basket': { name: 'Panier', game: 'Kaluga' },
      '$sel': { name: 'Sel', game: 'Swapou' },
      '$poivre': { name: 'Poivre', game: 'Swapou' },
      '$bads1': { name: 'Monstre 1', game: 'MiniWave' },
    },
  };
  ctx.getGameItemDisplayName = (id) => (ctx.GAME_ITEM_INFO[id] ? ctx.GAME_ITEM_INFO[id].name
    : /^Fruit \d+$/.test(id) ? id : id.replace(/^\$/, ''));
  ctx.getGameItemGame = (id) => (ctx.GAME_ITEM_INFO[id] ? ctx.GAME_ITEM_INFO[id].game
    : /^Fruit \d+$/.test(id) ? 'Frutisnake' : '');
  vm.runInNewContext(SRV.slice(debut, fin) + '\nthis.f = pictosRangesParJeu;', ctx);
  // Les tableaux du contexte vm ne sont pas ceux d'ici : on les recopie.
  return (gi) => JSON.parse(JSON.stringify(ctx.f(gi)));
}

test('serveur : jeux par ordre alphabétique, « Autre » en dernier, pictos dans l\'ordre du catalogue', () => {
  const ranger = rangeur();
  // L'ordre des parties gagnées : en vrac, avec un doublon et un inconnu.
  const vrac = ['Fruit 10', '$poivre', '$basket', '$inconnu', 'Fruit 2', '$butterfly1',
    '$sel', '$bads1', '$butterfly0', '$poivre', 'Fruit 1'];
  const r = ranger(vrac);
  assert.deepStrictEqual(r.map((p) => p.jeu + ' / ' + p.id), [
    'Frutisnake / Fruit 1', 'Frutisnake / Fruit 2', 'Frutisnake / Fruit 10',   // « 2 » avant « 10 »
    'Kaluga / $butterfly0', 'Kaluga / $butterfly1', 'Kaluga / $basket',     // ordre du catalogue
    'MiniWave / $bads1',
    'Swapou / $sel', 'Swapou / $poivre',
    'Autre / $inconnu',                                                       // en dernier
  ]);
  // Stable : le même ensemble, dans un autre ordre, donne la même liste.
  assert.deepStrictEqual(ranger(vrac.slice().reverse()), r);
  assert.deepStrictEqual(ranger(null), []);
});

test('serveur : /api/pictos, l\'inventaire light et les dossiers du bureau lisent cet ordre', () => {
  const route = SRV.slice(SRV.indexOf("app.get('/api/pictos'"), SRV.indexOf("app.get('/api/consecration'"));
  assert.match(route, /pictosRangesParJeu\(users\[username\]\.gameItems\)/);
  assert.match(SRV, /const pictos = pictosRangesParJeu\(user\.gameItems\)\.map/);
  const dossiers = SRV.slice(SRV.indexOf('function dossiersPictos(user) {'));
  assert.match(dossiers.slice(0, 600), /for \(const p of pictosRangesParJeu\(user && user\.gameItems\)\)/);
  // Le light garde l'ordre des jeux du serveur (plus de tri à lui, qui oubliait « Autre »).
  const rendre = LIGHT.slice(LIGHT.indexOf('function rendrePictos() {'));
  assert.match(rendre.slice(0, 1400), /Object\.keys\(parJeu\)\.forEach\(function \(jeu\)/);
});

// bbTogglePictos, lancée pour de bon dans un faux document.
function faireDom() {
  const noeud = (tag) => ({
    tagName: tag, enfants: [], style: {}, className: '', textContent: '', _html: '',
    parentNode: null,
    appendChild(n) { n.parentNode = this; this.enfants.push(n); return n; },
    remove() { if (this.parentNode) this.parentNode.enfants = this.parentNode.enfants.filter((x) => x !== this); },
    querySelector(sel) { return this.enfants.find((x) => '.' + x.className === sel) || null; },
    set innerHTML(v) { this._html = v; this.enfants = []; },
    get innerHTML() { return this._html; },
  });
  const barre = noeud('div');
  const bouton = noeud('button');
  barre.appendChild(bouton);
  return {
    barre, bouton,
    document: {
      createElement: noeud,
      querySelectorAll: () => [],
      getElementById: () => null,
      addEventListener: () => {},
    },
  };
}

test('forum : le sélecteur pose un intertitre par jeu, les pictos du jeu en dessous', async () => {
  const debut = FORUM.indexOf('async function bbTogglePictos(targetId, btn) {');
  const fin = FORUM.indexOf('\n}\n', debut) + 3;
  assert.ok(debut > 0, 'bbTogglePictos existe');
  const dom = faireDom();
  const pictos = [
    { id: 'Fruit 1', name: 'Fruit 1', game: 'Frutisnake', url: '/api/picto/Fruit%201' },
    { id: 'Fruit 2', name: 'Fruit 2', game: 'Frutisnake', url: '/api/picto/Fruit%202' },
    { id: '$sel', name: 'Sel', game: 'Swapou', url: '/api/picto/%24sel' },
    { id: '$x', name: 'x', game: 'Autre', url: '/api/picto/%24x' },
  ];
  const ctx = { document: dom.document, fetchPictos: async () => pictos };
  vm.runInNewContext(FORUM.slice(debut, fin) + '\nthis.f = bbTogglePictos;', ctx);
  await ctx.f('editeur', dom.bouton);
  const picker = dom.barre.enfants.find((x) => x.className === 'picto-picker');
  assert.ok(picker, 'le sélecteur s\'ouvre');
  assert.deepStrictEqual(picker.enfants.map((x) => (x.className === 'picto-picker-jeu' ? '# ' + x.textContent : x.alt)),
    ['# Frutisnake', 'Fruit 1', 'Fruit 2', '# Swapou', 'Sel', '# Autre', 'x']);
  // Un intertitre prend toute la largeur de la grille.
  assert.match(FORUM, /\.picto-picker \.picto-picker-jeu \{\s*flex: 0 0 100%;/);
});

// ── Le serveur vivant ───────────────────────────────────────────────────────

const PORT = 3657;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/frutiparc_pictosjeu';
const RUN = Date.now().toString(36).slice(-5);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let proc = null, dispo = false;

async function baseNeuve() {
  let Client;
  try { ({ Client } = require(path.join(ROOT, 'node_modules', 'pg'))); } catch { return false; }
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
  dispo = await baseNeuve();
  if (!dispo) return;
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: DB, REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: 'cle-de-test-pictos', XMLSOCKET_PORT: '5657', FRUTISCORE_PORT: '5658',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 160; i++) {
    try { if ((await fetch(BASE + '/do/prefdef')).ok) return; } catch { /* pas prêt */ }
    await wait(250);
  }
  throw new Error('serveur indisponible');
});

after(() => { if (proc) proc.kill('SIGKILL'); });

test('serveur vivant : /api/pictos rend les pictos gagnés en vrac, rangés par jeu', async (t) => {
  if (!dispo) return t.skip('pas de base PostgreSQL de test disponible');
  const pseudo = 'picto' + RUN;
  const body = JSON.stringify({ username: pseudo, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const j = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).json();
  assert.ok(j.sid);
  for (const itemName of ['$poivre', 'Fruit 10', '$basket', '$sel', 'Fruit 2', '$butterfly0']) {
    const r = await fetch(`${BASE}/api/admin/users/${pseudo}/gameitems`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-key': 'cle-de-test-pictos' },
      body: JSON.stringify({ itemName }),
    });
    assert.strictEqual(r.status, 200, itemName);
  }
  const liste = await (await fetch(`${BASE}/api/pictos?sid=${j.sid}`)).json();
  assert.deepStrictEqual(liste.map((p) => p.game + ' / ' + p.name), [
    'Frutisnake / Fruit 2', 'Frutisnake / Fruit 10',
    'Kaluga / Papillon vert', 'Kaluga / Panier',
    'Swapou / Sel', 'Swapou / Poivre',
  ]);
  const inv = await (await fetch(`${BASE}/api/light/inventaire?sid=${j.sid}`)).json();
  assert.deepStrictEqual(inv.pictos.map((p) => p.id), liste.map((p) => p.id), 'l\'inventaire light, même ordre');
});
