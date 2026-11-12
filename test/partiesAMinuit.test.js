/*
 * LES PARTIES À CHEVAL SUR MINUIT.
 *
 * « Les jeux en cours au reset basculent sur la journée d'après — très gênant
 * pour les jeux qui ont une map chaque jour (Mini-Wave, MotionBall, Burning
 * Kiwi…). Pour Kaluga et Snake, on peut le tolérer ; pour les autres, non.
 * Grapiz et Bandas : la série prend fin à minuit et repart de 0. »
 *
 * Le jeu dit, avec son score, quand la partie a commencé (`jour` de la map, ou
 * `age` en millisecondes) ; le serveur n'inscrit pas au Challenge du jour neuf
 * une partie commencée la veille, et ne lui prend pas de partie du quota.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3877;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-minuit';
const RUN = Date.now().toString(36).slice(-5);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let proc = null;
before(async () => {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5877', FRUTISCORE_PORT: '5878',
      // L'essai tourne à n'importe quelle heure : la fenêtre couvre la journée.
      A_CHEVAL_FENETRE_MS: String(25 * 3600 * 1000),
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(BASE + '/api/loadFrutiSlots?game=snake3')).ok) return; } catch { /* pas prêt */ }
    await wait(250);
  }
  throw new Error('serveur indisponible');
});
after(() => {
  if (proc) proc.kill('SIGKILL');
  try {
    const f = path.join(ROOT, 'data/scores.json');
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
    for (const u of Object.keys(d.users || {})) if (u.startsWith('min')) delete d.users[u];
    fs.writeFileSync(f, JSON.stringify(d));
  } catch { /* rien à nettoyer */ }
});

const hdr = { 'Content-Type': 'application/json', 'x-admin-key': CLE };
async function inscrire(pseudo) {
  const body = JSON.stringify({ username: pseudo, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: hdr, body });
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const sid = (await r.json()).sid;
  assert.ok(sid, 'session de ' + pseudo);
  return sid;
}
const envoyer = async (sid, p) =>
  (await fetch(BASE + '/api/saveScore?' + new URLSearchParams(Object.assign({ sid }, p)).toString())).json();
const jourParis = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(d);
// Les millisecondes écoulées depuis minuit (Paris), plus une minute : hier soir.
function ageDHier() {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date());
  const v = (t) => Number(f.find((x) => x.type === t).value);
  return (((v('hour') % 24) * 60 + v('minute')) * 60 + v('second')) * 1000 + 60000;
}
const fd = async (sid, jeu) => (await fetch(`${BASE}/api/fd/status?sid=${sid}&game=${jeu}`)).json();

test('Mini-Wave : la map de la veille ne s’inscrit pas au Challenge du jour', async () => {
  const sid = await inscrire('minw' + RUN);
  const hier = jourParis(new Date(Date.now() - 24 * 3600 * 1000));
  const r = await envoyer(sid, { game: 'miniwave', m: '0', score: '4200', data: '5', jour: hier });
  assert.equal(r.ok, true);
  assert.equal(r.horsJour, true, JSON.stringify(r));
  assert.equal(r.updated, false);
  // La même partie, sur la map du jour : classée.
  const r2 = await envoyer(sid, { game: 'miniwave', m: '0', score: '4200', data: '5', jour: jourParis(new Date()) });
  assert.equal(r2.updated, true, JSON.stringify(r2));
  assert.ok(!r2.horsJour);
});

test('MotionBall : commencée avant minuit, ni classée ni décomptée du quota', async () => {
  const sid = await inscrire('minm' + RUN);
  const avant = await fd(sid, 'mb2');
  const r = await envoyer(sid, { game: 'mb2', m: '1', score: '90000', data: '', age: String(ageDHier()) });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.horsJour, true, JSON.stringify(r));
  assert.equal(r.updated, false);
  assert.ok(!r.fdBlocked);
  const apres = await fd(sid, 'mb2');
  assert.equal(apres.remaining, avant.remaining, 'le quota du jour est intact');
  // Une partie du jour (dix minutes) : classée, et décomptée.
  const r2 = await envoyer(sid, { game: 'mb2', m: '1', score: '90000', data: '', age: '600000' });
  assert.equal(r2.updated, true, JSON.stringify(r2));
  assert.equal((await fd(sid, 'mb2')).remaining, avant.remaining - 1);
});

test('Kaluga : toléré, la partie finie après minuit compte au jour neuf', async () => {
  const sid = await inscrire('mink' + RUN);
  const r = await envoyer(sid, { game: 'kaluga', m: '0', score: '1500', data: '', age: String(ageDHier()) });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(!r.horsJour, JSON.stringify(r));
});

test('Grapiz et Frutibandas : les séries repartent de 0 à minuit, les bots gardent leur vitrine', () => {
  for (const f of ['../public/grapiz/server/net.js', '../public/bandas/server/net.js']) {
    const m = require(f);
    const Net = m.GrapizNet || m.BandasNet || m;
    const faux = { streaks: { alice: 7, bob: 0, robot: 12 }, _beaten: { alice: { bob: true }, robot: { x: true } }, bots: { robot: true } };
    const n = Net.prototype.remettreSeriesAZero.call(faux);
    assert.equal(n, 1);
    assert.deepEqual(faux.streaks, { alice: 0, bob: 0, robot: 12 });
    assert.deepEqual(faux._beaten, { robot: { x: true } });
  }
});
