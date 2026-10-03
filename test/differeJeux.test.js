'use strict';
/*
 * LES PARTIES EN DIFFÉRÉ — de bout en bout, sur le vrai serveur.
 *
 * Deux joueurs branchés au pont du jeu par WebSocket (le chemin d'une vraie
 * partie) : l'un invite, l'autre accepte, un coup est joué. Ce qu'on vérifie
 * ici, c'est ce qui dépasse les modules purs : la notification dans l'appli
 * (« X a joué ! À ton tour »), la persistance — la partie survit à un
 * REDÉMARRAGE du serveur —, la note du championnat au classement, et le même
 * chemin pour Frutibandas.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { Client } = require('pg');
const WebSocket = require('ws');
const E = require('../public/grapiz/engine.js');
const G = require('../public/grapiz/game.js');

const ROOT = path.join(__dirname, '..');
const PORT = 3614;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-de-test-differe';
const DB = process.env.TEST_DATABASE_URL_DIFFERE || 'postgres://postgres@127.0.0.1:5433/frutiparc_differe';
const DONNEES = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-differe-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const H = { 'Content-Type': 'application/json' };

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
  } catch { try { await admin.end(); } catch { /* rien */ } return false; }
}
async function sql(q, params) {
  const c = new Client({ connectionString: DB });
  await c.connect();
  try { return (await c.query(q, params)).rows; } finally { await c.end(); }
}
async function demarrer() {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: DB, REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5614', FRUTISCORE_PORT: '5615', FRUTI_DATA_DIR: DONNEES,
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 160; i++) {
    try {
      if ((await fetch(BASE + '/api/loadFrutiSlots?game=snake3')).ok) {
        if ((await sql(`SELECT 1 FROM information_schema.tables WHERE table_name = 'parties_differees'`)).length) { await wait(300); return; }
      }
    } catch { /* pas prêt */ }
    await wait(250);
  }
  throw new Error('serveur ou schéma indisponible');
}
async function arreter() {
  if (!proc) return;
  const fini = new Promise((r) => proc.once('exit', r));
  proc.kill('SIGKILL');
  await fini;
  proc = null;
  for (let i = 0; i < 40; i++) {
    try { await fetch(BASE + '/api/loadFrutiSlots?game=snake3'); } catch { return; }
    await wait(100);
  }
}
before(async () => { dispo = await baseNeuve(); if (dispo) await demarrer(); });
after(() => {
  if (proc) proc.kill('SIGKILL');
  try { fs.rmSync(DONNEES, { recursive: true, force: true }); } catch { /* déjà parti */ }
});

const post = (url, body) => fetch(BASE + url, { method: 'POST', headers: H, body: JSON.stringify(body) }).then((r) => r.json());
const sids = {};
async function compte(pseudo) {
  await post('/api/auth/register', { username: pseudo, password: 'secret123' });
  sids[pseudo] = (await post('/api/auth/login', { username: pseudo, password: 'secret123' })).sid;
}
async function connexion(pseudo) {
  if (!sids[pseudo]) sids[pseudo] = (await post('/api/auth/login', { username: pseudo, password: 'secret123' })).sid;
}
// L'historique d'un joueur, tel que l'appli le lit : les notifications in-app.
async function historique(pseudo) {
  const d = await (await fetch(BASE + '/api/light/history?sid=' + sids[pseudo])).json();
  return (d.events || []).map((e) => e.text);
}

// Un joueur branché au pont <gz> ou <bd>.
function brancher(pseudo, tag, salle) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/`);
    const recus = [];
    let tampon = '';
    ws.on('message', (data) => {
      tampon += data.toString();
      const bouts = tampon.split('\0'); tampon = bouts.pop();
      for (const b of bouts) if (b.trim()) recus.push(b.trim());
    });
    ws.on('error', reject);
    ws.on('open', () => {
      ws.send(`<k l="${pseudo}" s="${sids[pseudo]}" />\0`);
      setTimeout(() => {
        ws.send(`<${tag} a="hello" n="${pseudo}"${salle ? ` sa="${salle}"` : ''} />\0`);
        setTimeout(() => resolve({
          ws, recus, pseudo,
          envoyer: (attrs) => {
            let s = `<${tag}`;
            for (const k of Object.keys(attrs)) s += ` ${k}="${String(attrs[k]).replace(/"/g, '&quot;')}"`;
            ws.send(s + ' />\0');
          },
          derniers: (e) => recus.filter((m) => m.indexOf(`<${tag} e="${e}"`) === 0),
          dernier: (e) => recus.filter((m) => m.indexOf(`<${tag} e="${e}"`) === 0).pop() || null,
          vider: () => { recus.length = 0; },
          fermer: () => { try { ws.close(); } catch { /* rien */ } },
        }), 500);
      }, 300);
    });
  });
}
const attr = (xml, k) => { const m = new RegExp(` ${k}="([^"]*)"`).exec(xml || ''); return m ? m[1] : null; };
// Les <d …/> d'une liste.
const parties = (xml) => (xml.match(/<d [^>]*\/>/g) || []).map((d) => ({
  id: attr(d, 'id'), st: attr(d, 'st'), sa: attr(d, 'sa'), tour: +attr(d, 'tour'), moi: +attr(d, 'moi'),
  coups: +attr(d, 'coups'), w: attr(d, 'w'), r: attr(d, 'r'), a: attr(d, 'a'), b: attr(d, 'b'),
}));

let partieGrapiz = null;

test('Grapiz en différé : invitation, acceptation, un coup, la notification « À ton tour »', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible');
  await compte('alice'); await compte('bob');
  const a = await brancher('alice', 'gz'), b = await brancher('bob', 'gz');
  assert.ok(a.dernier('dlist'), 'le hello joint la liste des parties en différé');
  assert.equal(parties(a.dernier('dlist')).length, 0);

  a.envoyer({ a: 'dinvite', u: 'bob', sa: 'champ' });
  await wait(500);
  const la = parties(a.dernier('dlist')), lb = parties(b.dernier('dlist'));
  assert.equal(la.length, 1); assert.equal(la[0].st, 'invitation'); assert.equal(la[0].moi, 0);
  assert.equal(lb.length, 1); assert.equal(lb[0].moi, 1, 'bob est l’invité');
  partieGrapiz = la[0].id;
  let hb = await historique('bob');
  assert.ok(hb.some((x) => /alice t'invite à une partie de Grapiz/.test(x)), 'bob a l’invitation dans son historique : ' + hb.join(' | '));
  assert.equal((await sql('SELECT statut FROM parties_differees WHERE id = $1', [partieGrapiz]))[0].statut, 'invitation', 'la partie est en base');

  b.envoyer({ a: 'daccept', id: partieGrapiz });
  await wait(500);
  assert.equal(parties(a.dernier('dlist'))[0].st, 'en_cours');
  assert.ok((await historique('alice')).some((x) => /bob a accepté ta partie de Grapiz — À toi d'ouvrir la partie/.test(x)));

  // Alice ouvre : l'état marqué différé, trois jours d'horloge, la note.
  a.envoyer({ a: 'dopen', id: partieGrapiz });
  await wait(400);
  const start = a.dernier('start');
  assert.ok(start && attr(start, 'df') === '1' && attr(start, 'sa') === 'champ', 'start marqué différé');
  assert.equal(attr(start, 'turn'), '0', 'alice ouvre');
  assert.match(start, /rt="259200000"/);
  assert.match(start, /sr="1000"/, 'au championnat, la note est affichée');

  // Un coup légal, calculé sur le plateau reçu.
  const toks = (start.match(/<t [^>]*\/>/g) || []).map((x) => ({ t: +attr(x, 'e'), x: +attr(x, 'x'), y: +attr(x, 'y') }));
  const jeu = new G.GrapizGame({ players: ['a', 'b'], board: E.Board.fromDefinition({ size: 4, tokens: toks }) });
  const lm = jeu.legalMoves(0)[0];
  a.vider(); b.vider();
  a.envoyer({ a: 'dmove', id: partieGrapiz, x: lm.from.x, y: lm.from.y, d: lm.direction });
  await wait(600);
  const mv = b.dernier('move');
  assert.ok(mv && attr(mv, 'df') === '1' && attr(mv, 'turn') === '1', 'bob reçoit l’état, c’est à lui');
  assert.equal(parties(b.dernier('dlist'))[0].coups, 1);
  hb = await historique('bob');
  assert.ok(hb.some((x) => /alice a joué ! À ton tour au Grapiz/.test(x)), '« alice a joué ! À ton tour au Grapiz » : ' + hb.join(' | '));
  const row = (await sql('SELECT statut, donnees FROM parties_differees WHERE id = $1', [partieGrapiz]))[0];
  assert.equal(row.statut, 'en_cours');
  assert.equal(row.donnees.coups, 1, 'le coup est en base');
  a.fermer(); b.fermer();
});

test('la partie survit à un redémarrage du serveur, et se joue jusqu’à la note du championnat', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible');
  await arreter();
  await demarrer();
  await connexion('alice'); await connexion('bob');
  const a = await brancher('alice', 'gz'), b = await brancher('bob', 'gz');
  const lb = parties(b.dernier('dlist'));
  assert.equal(lb.length, 1, 'bob retrouve sa partie après le redémarrage');
  assert.equal(lb[0].id, partieGrapiz);
  assert.equal(lb[0].st, 'en_cours'); assert.equal(lb[0].coups, 1); assert.equal(lb[0].tour, 1);
  b.envoyer({ a: 'dopen', id: partieGrapiz });
  await wait(400);
  const start = b.dernier('start');
  assert.ok(start && attr(start, 'turn') === '1', 'le plateau revient avec le trait à bob');
  // Bob abandonne : alice gagne, sa note monte, celle de bob descend.
  b.envoyer({ a: 'dpart', id: partieGrapiz });
  await wait(600);
  const fin = parties(a.dernier('dlist'))[0];
  assert.equal(fin.st, 'finie'); assert.equal(fin.w, '0'); assert.equal(fin.r, 'forfeit');
  const ha = await historique('alice');
  assert.ok(ha.some((x) => /Victoire au Grapiz contre bob ! — bob a abandonné la partie/.test(x)), ha.join(' | '));
  const notes = await sql(`SELECT u.username, s.score FROM scores s JOIN users u ON u.id = s.user_id WHERE s.ranking_id = 'grapiz_champion' ORDER BY u.username`);
  assert.deepEqual(notes.map((n) => n.username + ':' + n.score), ['alice:1024', 'bob:976'], 'le classement Grapiz - Championnat');
  a.fermer(); b.fermer();
});

test('Frutibandas en différé : le draft à distance, la notification, l’état complet en base', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible');
  await connexion('alice'); await connexion('bob');
  const a = await brancher('alice', 'bd', 'amical'), b = await brancher('bob', 'bd', 'champ');
  a.envoyer({ a: 'dinvite', u: 'bob', sa: 'amical' });
  await wait(500);
  const p = parties(b.dernier('dlist')).filter((x) => x.sa === 'amical')[0];
  assert.ok(p && p.st === 'invitation');
  b.envoyer({ a: 'daccept', id: p.id });
  await wait(500);
  const q = parties(a.dernier('dlist')).filter((x) => x.id === p.id)[0];
  assert.equal(q.st, 'en_cours');
  const premier = q.tour === 0 ? a : b, second = q.tour === 0 ? b : a;
  premier.envoyer({ a: 'dopen', id: p.id });
  await wait(400);
  const start = premier.dernier('start');
  assert.ok(start && attr(start, 'df') === '1' && attr(start, 'ph') === '1', 'l’instantané différé, en phase de draft');
  const pool = attr(start, 'c').split(':').map(Number);
  second.vider();
  premier.envoyer({ a: 'dchoose', id: p.id, c: String(pool[0]) });
  await wait(600);
  assert.ok(second.derniers('ev').some((m) => attr(m, 't') === 'cardChosen' && attr(m, 'g') === p.id), 'l’événement de draft part à l’autre');
  const hs = await historique(second.pseudo);
  assert.ok(hs.some((x) => new RegExp(premier.pseudo + " a joué ! À ton tour à Frutibandas").test(x)), hs.join(' | '));
  const row = (await sql('SELECT donnees FROM parties_differees WHERE id = $1', [p.id]))[0].donnees;
  assert.equal(row.coups, 1);
  assert.equal(row.etat.pool.length, 5, 'l’état complet du jeu est en base (une carte prise)');
  assert.equal(row.etat.content.length, 64);
  a.fermer(); b.fermer();
});
