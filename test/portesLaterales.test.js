'use strict';
/*
 * LES PORTES DE CÔTÉ — ce que les portes génériques de score n'écrivent plus.
 *
 * Trois portes reçoivent un score DÉCLARÉ par le client :
 *   A — /api/saveScore ;
 *   B — le repli `loadVariables` des SWF, GET /(swf/)games/<jeu>/s<score> ;
 *   C — FrutiScore, le message `channellist` (q) de la socket XML.
 * Elles passent toutes par le même contrôle (controlePorteGenerique) : un
 * classement que seul le serveur arbitre (séries de Grapiz et de Frutibandas,
 * JamaJama rejoué) ou un score implausible n'est pas classé, et part en
 * alerte. Le joueur honnête, lui, se classe comme avant.
 *
 * Serveur sans base : les alertes vivent en mémoire, l'admin les lit par
 * GET /api/admin/triche/alertes.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3921;
const XML_PORT = 5921;
const SCORE_PORT = 5922;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-portes-laterales';
const DONNEES = fs.mkdtempSync(path.join(os.tmpdir(), 'frutiparc-portes-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const JSN = { 'Content-Type': 'application/json' };
const ADMIN = { 'x-admin-key': CLE };

let proc = null;
let journal = '';
const sockets = [];
before(async () => {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', ADMIN_KEY: CLE, REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      XMLSOCKET_PORT: String(XML_PORT), FRUTISCORE_PORT: String(SCORE_PORT), FRUTI_DATA_DIR: DONNEES,
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', (d) => { journal += d.toString(); });
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(BASE + '/api/loadFrutiSlots?game=snake3')).ok) return; } catch { /* pas prêt */ }
    await wait(250);
  }
  throw new Error('serveur indisponible');
});
after(() => {
  for (const s of sockets) { try { s.destroy(); } catch { /* fermée */ } }
  if (proc) proc.kill('SIGKILL');
  try { fs.rmSync(DONNEES, { recursive: true, force: true }); } catch { /* déjà parti */ }
});

async function inscrire(pseudo) {
  const body = JSON.stringify({ username: pseudo, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: JSN, body });
  const j = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: JSN, body })).json();
  assert.ok(j.sid, 'connexion → sid');
  return j.sid;
}
async function alertes(pseudo) {
  const l = await (await fetch(BASE + '/api/admin/triche/alertes?username=' + pseudo, { headers: ADMIN })).json();
  assert.equal(l.ok, true);
  return l.alertes;
}
async function record(rk, pseudo) {
  const j = await (await fetch(BASE + '/api/club/records?limit=20')).json();
  const r = (j.rankings || []).find((x) => x.id === rk) || { scores: [] };
  return r.scores.find((s) => String(s.user).toLowerCase() === pseudo) || null;
}
const saveScore = (params) => fetch(BASE + '/api/saveScore', { method: 'POST', body: new URLSearchParams(params) })
  .then(async (r) => Object.assign({ statut: r.status }, await r.json()));

// La socket du bureau Flash : on s'identifie, puis on parle FrutiScore.
function brancher(pseudo, sid, port) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1');
    sockets.push(sock);
    sock.recus = [];
    sock.setEncoding('utf8');
    let tampon = '';
    sock.on('data', (d) => {
      tampon += d;
      let i;
      while ((i = tampon.indexOf('\0')) >= 0) {
        const m = tampon.slice(0, i);
        tampon = tampon.slice(i + 1);
        if (m) sock.recus.push(m);
      }
    });
    sock.on('error', reject);
    sock.on('connect', () => {
      sock.write(`<ident l="${pseudo}" s="${sid}" />\0`);
      setTimeout(() => resolve(sock), 400);
    });
  });
}
async function frutiScore(sock, attrs) {
  const avant = sock.recus.length;
  sock.write(`<q ${attrs} />\0`);
  for (let i = 0; i < 40; i++) {
    const r = sock.recus.slice(avant).find((m) => /^<q k="0">/.test(m));
    if (r) return r;
    await wait(50);
  }
  throw new Error('pas de réponse FrutiScore');
}

// ── Les classements arbitrés par le serveur ────────────────────────────────

test('porte A : une série de Grapiz ou de Frutibandas, un JamaJama déclarés ne se classent pas', async () => {
  const pseudo = 'portea';
  const sid = await inscrire(pseudo);
  for (const [game, m, rk] of [['grapiz', '1', 'grapiz_challenge'], ['bandas', '1', 'bandas_challenge'], ['jamajama', '0', 'jamajama_classic']]) {
    const r = await saveScore({ sid, game, m, score: '99', data: '' });
    assert.equal(r.statut, 400, `${game} : refusé`);
    assert.equal(r.ok, false);
    assert.equal(r.error, 'classement_arbitre');
    assert.equal(r.rankingId, rk);
    assert.equal(await record(rk, pseudo), null, `${rk} : rien au classement`);
  }
  const l = await alertes(pseudo);
  const arbitres = l.filter((a) => a.type === 'classement_arbitre');
  assert.deepEqual(arbitres.map((a) => a.jeu).sort(), ['bandas', 'grapiz', 'jamajama']);
  assert.ok(arbitres.every((a) => a.gravite === 'suspect' && /\(?saveScore/.test(a.resume)), JSON.stringify(arbitres));
});

test('porte B : le repli loadVariables passe par le même contrôle', async () => {
  const pseudo = 'porteb';
  const sid = await inscrire(pseudo);
  // JamaJama : le SWF déployé est hors ligne, seul le rejeu du serveur classe.
  assert.match(await (await fetch(`${BASE}/swf/games/jamajama/s3?sid=${sid}`)).text(), /ok=0/);
  assert.equal(await record('jamajama_classic', pseudo), null);
  // MiniWave : l'URL ne porte pas le niveau, le plafond est celui du premier.
  assert.match(await (await fetch(`${BASE}/swf/games/miniwave/s50000?sid=${sid}`)).text(), /ok=0/);
  assert.equal(await record('miniwave_classic', pseudo), null);
  const l = await alertes(pseudo);
  assert.ok(l.find((a) => a.type === 'classement_arbitre' && a.jeu === 'jamajama' && /loadVariables/.test(a.resume)),
    JSON.stringify(l));
  const p = l.find((a) => a.type === 'plausibilite');
  assert.ok(p, 'le plafond refusé part en alerte : ' + JSON.stringify(l));
  assert.deepEqual([p.jeu, p.gravite], ['miniwave', 'suspect']);
  assert.match(p.resume, /score 50000 refusé au classement miniwave_classic \(loadVariables\)/);
  // Un score plausible passe toujours.
  assert.match(await (await fetch(`${BASE}/swf/games/miniwave/s4200?sid=${sid}`)).text(), /ok=1/);
  assert.equal((await record('miniwave_classic', pseudo) || {}).score, 4200);
});

test('porte A : un score implausible est refusé ET signalé', async () => {
  const pseudo = 'porteap';
  const sid = await inscrire(pseudo);
  const r = await saveScore({ sid, game: 'miniwave', m: '0', score: '30000', data: '1' });
  assert.equal(r.statut, 400);
  assert.equal(r.error, 'implausible_score');
  const l = await alertes(pseudo);
  assert.ok(l.find((a) => a.type === 'plausibilite' && /\(saveScore\)/.test(a.resume)), JSON.stringify(l));
  // Le même score au niveau qui le permet passe.
  const ok = await saveScore({ sid, game: 'miniwave', m: '0', score: '30000', data: '3' });
  assert.equal(ok.ok, true);
  assert.equal((await record('miniwave_classic', pseudo) || {}).score, 30000);
});

test('porte C : FrutiScore refuse les classements arbitrés et l’implausible, classe le reste', async () => {
  const pseudo = 'portec';
  const sid = await inscrire(pseudo);
  // Le pont FrutiScore (ws /score) aboutit à la même socket XML que le chat.
  const sock = await brancher(pseudo, sid, XML_PORT);
  // Une série de Grapiz posée par la socket : pas de position, rien de classé.
  const r1 = await frutiScore(sock, 'd="grapiz" m="1" s="77"');
  assert.match(r1, / p="0" /);
  assert.equal(await record('grapiz_challenge', pseudo), null);
  // Un MiniWave au-delà du plafond.
  const r2 = await frutiScore(sock, 'd="miniwave" m="0" s="90000"');
  assert.match(r2, / p="0" /);
  assert.equal(await record('miniwave_classic', pseudo), null);
  const l = await alertes(pseudo);
  assert.ok(l.find((a) => a.type === 'classement_arbitre' && a.jeu === 'grapiz' && /FrutiScore/.test(a.resume)), JSON.stringify(l));
  assert.ok(l.find((a) => a.type === 'plausibilite' && /FrutiScore/.test(a.resume)), JSON.stringify(l));
  // Le score honnête se classe.
  const r3 = await frutiScore(sock, 'd="miniwave" m="0" s="3100"');
  assert.match(r3, / p="[1-9]\d*" /, 'une position au classement');
  assert.equal((await record('miniwave_classic', pseudo) || {}).score, 3100);
});
