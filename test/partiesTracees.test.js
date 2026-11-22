'use strict';
/*
 * LES PARTIES TRACÉES (onglet admin « Parties tracées ») — les jeux qui ne se
 * rejouent pas, Kaluga d'abord.
 *
 * « Un joueur vient de battre le record de Kaluga freestyle dès sa première
 * partie… J'ai besoin de savoir à minima la durée de la partie, le nombre de
 * pommes mises dans le panier, les principaux combos. » Chaque score laisse
 * une ligne : la durée mesurée par le SERVEUR (du début annoncé à l'arrivée
 * du score), le temps de jeu et le relevé déclarés par le jeu, la réponse.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3683;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-traces';
const RUN = Date.now().toString(36).slice(-5);
const DONNEES = fs.mkdtempSync(path.join(os.tmpdir(), 'frutiparc-traces-'));
const H = { 'Content-Type': 'application/json' };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let proc = null;
before(async () => {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', ADMIN_KEY: CLE, REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      XMLSOCKET_PORT: '5695', FRUTISCORE_PORT: '5696', FRUTI_DATA_DIR: DONNEES,
    }),
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  for (let i = 0; i < 160; i++) {
    try { if ((await fetch(BASE + '/api/loadFrutiSlots?game=snake3')).ok) return; } catch { /* pas prêt */ }
    await wait(250);
  }
  throw new Error('serveur indisponible');
});
after(() => {
  if (proc) proc.kill('SIGKILL');
  try { fs.rmSync(DONNEES, { recursive: true, force: true }); } catch { /* déjà parti */ }
});

const post = (url, body) => fetch(BASE + url, { method: 'POST', headers: H, body: JSON.stringify(body) }).then((r) => r.json());
async function sid(u) {
  await post('/api/auth/register', { username: u, password: 'secret123' });
  return (await post('/api/auth/login', { username: u, password: 'secret123' })).sid;
}
const traces = (q) => fetch(`${BASE}/api/admin/parties-tracees?${q || ''}`, { headers: { 'x-admin-key': CLE } }).then((r) => r.json());

test('une partie de Kaluga : début annoncé, durée serveur, temps de jeu, relevé, réponse', async () => {
  const u = 'trk' + RUN;
  const s = await sid(u);
  assert.equal((await fetch(BASE + '/api/admin/parties-tracees')).status, 403, 'clé maître exigée');
  assert.equal((await post('/api/partie/debut', { sid: s, jeu: 'inconnu' })).ok, false);
  assert.equal((await post('/api/partie/debut', { sid: s, jeu: 'kaluga' })).ok, true);
  await wait(1300);
  const releve = { partie: { panier: 23, ratees: 1, ptsPommes: 1800, ptsCombos: 640, ptsGrappes: 120, ptsOr: 0 },
    general: { 'Nombre de pomme': 30, 'Grappe maximum': 3 }, combos: { 'tete dunk ': 4, 'pure ': 9 } };
  // Comme le portage l'envoie : en POST, formulaire.
  const r = await fetch(BASE + '/api/saveScore', { method: 'POST', body: new URLSearchParams({
    sid: s, game: 'kaluga', m: '0', score: '2560', data: '1:3:3', duree: '1100', releve: JSON.stringify(releve) }) }).then((x) => x.json());
  assert.ok(r.ok && r.updated, JSON.stringify(r));
  const d = await traces('joueur=' + u);
  assert.ok(d.ok);
  assert.ok(d.jeux.some((j) => j.id === 'kaluga') && !d.jeux.some((j) => j.id === 'swapou2'), 'Swapou a son propre journal');
  assert.equal(d.parties.length, 1);
  const p = d.parties[0];
  assert.equal(p.jeu, 'kaluga');
  assert.equal(p.ranking_id, 'kaluga_freestyle_classic');
  assert.equal(Number(p.score), 2560);
  assert.ok(p.duree_serveur_ms >= 1200 && p.duree_serveur_ms < 10000, 'la durée mesurée par le serveur : ' + p.duree_serveur_ms);
  assert.equal(p.duree_jeu_ms, 1100);
  assert.deepEqual(p.releve.partie, releve.partie);
  assert.equal(p.releve.general['Grappe maximum'], 3);
  assert.equal(p.releve.combos['pure '], 9);
  assert.equal(p.reponse.updated, true);
  assert.equal(p.reponse.newPos, 1);
});

test('un score sans début annoncé, et un début qui ne date qu’une partie', async () => {
  const u = 'trs' + RUN;
  const s = await sid(u);
  const envoyer = (score) => fetch(BASE + '/api/saveScore', { method: 'POST',
    body: new URLSearchParams({ sid: s, game: 'kaluga', m: '0', score: String(score), data: '1:2:2' }) }).then((x) => x.json());
  await post('/api/partie/debut', { sid: s, jeu: 'kaluga' });
  await envoyer(900);
  await envoyer(950);                       // pas de nouveau début : sans durée serveur
  const d = await traces('joueur=' + u);
  assert.equal(d.parties.length, 2);
  const [derniere, premiere] = d.parties;   // les plus récentes d'abord
  assert.ok(premiere.duree_serveur_ms != null);
  assert.equal(derniere.duree_serveur_ms, null, 'le début a déjà servi');
  assert.equal(derniere.releve, null);
  // Un relevé illisible ou démesuré ne casse rien.
  await fetch(BASE + '/api/saveScore', { method: 'POST',
    body: new URLSearchParams({ sid: s, game: 'snake3', m: '0', score: '120', releve: '{pas du json', duree: '-3' }) });
  const e = (await traces('joueur=' + u + '&jeu=snake3')).parties[0];
  assert.equal(e.releve, null);
  assert.equal(e.duree_jeu_ms, null);
  assert.equal(e.jeu, 'snake3');
});

test('le pont de Kaluga annonce le début et envoie le relevé avec le score', async () => {
  const appels = [];
  const bac = {
    URLSearchParams, JSON, Math, Promise, console,
    fetch: (url, o) => { appels.push({ url: String(url), o: o || {} }); return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) }); },
  };
  bac.window = bac; bac.self = bac; bac.globalThis = bac;
  vm.createContext(bac);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'public/kaluga/plateforme.js'), 'utf8'), bac, { filename: 'plateforme.js' });
  const C = bac.KalugaJeu.Client;
  const c = new C('sid-test');
  c.mng = { scoreSaved() {} };
  c.debutPartie();
  c.saveScore(1234.7, { tz: 2, gOr: 3, gMax: 2, duree: 61000, releve: { partie: { panier: 12 }, combos: { 'pure ': 3 } } });
  await new Promise((r) => setTimeout(r, 10));
  const debut = appels.find((a) => a.url === '/api/partie/debut');
  assert.ok(debut, 'le début est annoncé');
  assert.deepEqual(JSON.parse(debut.o.body), { sid: 'sid-test', jeu: 'kaluga' });
  const sc = appels.find((a) => a.url === '/api/saveScore');
  assert.equal(sc.o.method, 'POST');
  const corps = new URLSearchParams(String(sc.o.body));
  assert.equal(corps.get('score'), '1234');
  assert.equal(corps.get('data'), '2:3:2');
  assert.equal(corps.get('duree'), '61000');
  assert.deepEqual(JSON.parse(corps.get('releve')), { partie: { panier: 12 }, combos: { 'pure ': 3 } });
});

test('avec la base : la ligne s’écrit dans parties_tracees et se relit', async (t) => {
  const { Client } = require('pg');
  const DB = 'postgres://postgres@127.0.0.1:5433/frutiparc_traces';
  const admin = new Client({ connectionString: DB.replace(/\/[^/]+$/, '/postgres') });
  try {
    await admin.connect();
    await admin.query('DROP DATABASE IF EXISTS frutiparc_traces');
    await admin.query('CREATE DATABASE frutiparc_traces');
    await admin.end();
  } catch { try { await admin.end(); } catch { /* */ } t.skip('Postgres indisponible sur 5433'); return; }
  const P2 = 3684, B2 = `http://127.0.0.1:${P2}`;
  const p2 = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(P2), DATABASE_URL: DB, ADMIN_KEY: CLE, REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      XMLSOCKET_PORT: '5697', FRUTISCORE_PORT: '5698', FRUTI_DATA_DIR: DONNEES,
    }),
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  try {
    let pret = false;
    for (let i = 0; i < 160 && !pret; i++) {
      try {
        if ((await fetch(B2 + '/api/loadFrutiSlots?game=snake3')).ok) {
          const c = new Client({ connectionString: DB }); await c.connect();
          pret = (await c.query(`SELECT 1 FROM information_schema.tables WHERE table_name = 'parties_tracees'`)).rows.length > 0;
          await c.end();
        }
      } catch { /* pas prêt */ }
      if (!pret) await wait(250);
    }
    assert.ok(pret, 'serveur et schéma prêts');
    const u = 'trd' + RUN;
    const p = (url, body) => fetch(B2 + url, { method: 'POST', headers: H, body: JSON.stringify(body) }).then((r) => r.json());
    await p('/api/auth/register', { username: u, password: 'secret123' });
    const s = (await p('/api/auth/login', { username: u, password: 'secret123' })).sid;
    await p('/api/partie/debut', { sid: s, jeu: 'kaluga' });
    await wait(300);
    await fetch(B2 + '/api/saveScore', { method: 'POST', body: new URLSearchParams({ sid: s, game: 'kaluga', m: '0',
      score: '777', data: '1:2:2', duree: '250', releve: JSON.stringify({ partie: { panier: 5 } }) }) });
    let lignes = [];
    for (let i = 0; i < 40 && !lignes.length; i++) {
      lignes = (await fetch(`${B2}/api/admin/parties-tracees?joueur=${u}`, { headers: { 'x-admin-key': CLE } }).then((r) => r.json())).parties || [];
      if (!lignes.length) await wait(100);
    }
    assert.equal(lignes.length, 1);
    assert.equal(Number(lignes[0].score), 777);
    assert.ok(lignes[0].duree_serveur_ms >= 250);
    assert.equal(lignes[0].duree_jeu_ms, 250);
    assert.deepEqual(lignes[0].releve, { partie: { panier: 5 } });
    assert.equal(lignes[0].reponse.updated, true);
  } finally { p2.kill('SIGKILL'); }
});

test('le câblage du jeu : compteurs, temps hors pauses, début et relevé', () => {
  const lire = (f) => fs.readFileSync(path.join(ROOT, 'public/kaluga/jeu', f), 'utf8');
  const game = lire('game.js'), sprites = lire('sprites.js'), modes = lire('modes.js'), mng = lire('manager.js');
  assert.match(game, /this\.trace = \{ panier: 0, ratees: 0, ptsPommes: 0, ptsCombos: 0, ptsGrappes: 0, ptsOr: 0 \};/);
  assert.match(game, /saveScore\(score, \{ tz: this\.tzongreInfo\.id, gOr: this\.gOr \| 0, gMax: this\.gMax \| 0, duree, releve \}\)/);
  assert.match(sprites, /tr\.panier\+\+;/);
  assert.match(sprites, /if \(tr\) tr\.ratees\+\+;/);
  assert.match(sprites, /this\.game\.trace\.ptsGrappes \+= bonus;/);
  // (la partie classée seulement : le bac à sable hérite du départ, sans être une partie)
  assert.match(modes, /if \(this\.type === '\$classic' && this\.tournament == null && this\.mng\.client\.debutPartie\) this\.mng\.client\.debutPartie\(\);/);
  assert.match(mng, /this\.pauseTotal = \(this\.pauseTotal \|\| 0\) \+ \(K\.getTimer\(\) - this\.pauseStart\);/);
  const adm = fs.readFileSync(path.join(ROOT, 'public/admin.html'), 'utf8');
  assert.match(adm, /id="tab-partiestracees"/);
  assert.match(adm, /'portagesverif','partiestracees'/);
});
