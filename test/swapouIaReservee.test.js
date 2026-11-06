'use strict';
/*
 * LE BOT ET L'ANALYSEUR DE SWAPOU NE SONT SERVIS QU'À L'AYANT DROIT.
 *
 * public/swapou/bot.js, analyse.js, analyse.worker.js (et le harnais
 * bot.run.js, la page ia.html) soufflent le meilleur coup du Challenge. Ils
 * ne se servent qu'au joueur qui a l'option `swapouAnalyse` et à l'admin ;
 * le moteur du jeu (engine.js) et le jeu lui-même restent publics.
 *
 * Et pour l'ayant droit, la chaîne doit tenir : game.js lance le Worker avec
 * le sid dans l'adresse, le Worker le repasse à ses importScripts. On rejoue
 * ici cette chaîne telle quelle : le vrai analyse.worker.js, dans un bac à
 * sable, demande ses scripts ; on va les chercher au serveur avec l'adresse
 * qu'il a construite, et l'analyseur doit répondre.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3925;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-swapou-ia';
const DONNEES = fs.mkdtempSync(path.join(os.tmpdir(), 'frutiparc-swapou-ia-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const JSN = { 'Content-Type': 'application/json' };

let proc = null;
before(async () => {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', ADMIN_KEY: CLE, REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      XMLSOCKET_PORT: '5927', FRUTISCORE_PORT: '5928', FRUTI_DATA_DIR: DONNEES,
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
  try { fs.rmSync(DONNEES, { recursive: true, force: true }); } catch { /* déjà parti */ }
});

async function inscrire(pseudo) {
  const body = JSON.stringify({ username: pseudo, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: JSN, body });
  const j = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: JSN, body })).json();
  assert.ok(j.sid, 'connexion → sid');
  return j.sid;
}
const statut = async (url, h) => (await fetch(BASE + url, { headers: h || {} })).status;
const RESERVES = ['bot.js', 'analyse.js', 'analyse.worker.js', 'bot.run.js', 'ia.html'];

test('sans l’option, ni le bot ni l’analyseur ne se servent ; le jeu, si', async () => {
  for (const f of RESERVES) assert.strictEqual(await statut('/swapou/' + f), 403, f + ' sans session');
  // Les chemins détournés que express.static aurait normalisés.
  for (const u of ['/swapou/./bot.js', '/swapou/%62ot.js', '/swapou//analyse.js', '/swapou/x/../bot.js', '/swapou/BOT.js']) {
    assert.notStrictEqual(await statut(u), 200, u);
  }
  const sid = await inscrire('sansoption');
  for (const f of RESERVES) assert.strictEqual(await statut(`/swapou/${f}?sid=${sid}`), 403, f + ' sans l’option');
  // Le Referer d'une page du joueur ne change rien non plus.
  assert.strictEqual(await statut('/swapou/bot.js', { Referer: `${BASE}/swapou/?sid=${sid}` }), 403);
  // Le jeu reste public.
  for (const f of ['engine.js', 'game.js', 'screens.js', '']) assert.strictEqual(await statut('/swapou/' + f), 200, f || 'index');
});

test('l’ayant droit et l’admin les reçoivent, et la chaîne du Worker tient', async () => {
  const pseudo = 'avecoption';
  const sid = await inscrire(pseudo);
  const r = await fetch(`${BASE}/api/admin/users/${pseudo}/game-feature`, {
    method: 'POST', headers: Object.assign({ 'x-admin-key': CLE }, JSN), body: JSON.stringify({ feature: 'swapouAnalyse', owned: true }),
  });
  assert.strictEqual(r.status, 200);
  for (const f of RESERVES) assert.strictEqual(await statut(`/swapou/${f}?sid=${sid}`), 200, f + ' pour l’ayant droit');
  const rep = await fetch(`${BASE}/swapou/bot.js?sid=${sid}`);
  assert.match(rep.headers.get('cache-control') || '', /private/);
  assert.match(await rep.text(), /SwapouBot/);
  for (const f of RESERVES) assert.strictEqual(await statut(`/swapou/${f}?key=${CLE}`), 200, f + ' pour l’admin');

  // La chaîne réelle : l'adresse que game.js donne au Worker…
  const jeu = fs.readFileSync(path.join(ROOT, 'public/swapou/game.js'), 'utf8');
  assert.match(jeu, /new Worker\('analyse\.worker\.js' \+ \(sid \? '\?sid=' \+ encodeURIComponent\(sid\) : ''\)\)/);
  const adresseWorker = `/swapou/analyse.worker.js?sid=${encodeURIComponent(sid)}`;
  const codeWorker = await (await fetch(BASE + adresseWorker)).text();
  // …puis les importScripts que le Worker construit lui-même, résolus contre
  // son adresse, servis par le serveur, et exécutés dans l'ordre.
  const ctx = { location: new URL(BASE + adresseWorker) };
  ctx.self = ctx;
  const demandes = [];
  ctx.importScripts = (...urls) => { demandes.push(...urls); };
  vm.createContext(ctx);
  vm.runInContext(codeWorker, ctx);
  assert.deepStrictEqual(demandes, ['engine.js', `bot.js?sid=${sid}`, `analyse.js?sid=${sid}`]);
  for (const u of demandes) {
    const reponse = await fetch(new URL(u, BASE + adresseWorker));
    assert.strictEqual(reponse.status, 200, u);
    vm.runInContext(await reponse.text(), ctx);
  }
  assert.strictEqual(typeof ctx.SwapouAnalyse.analyserGrille, 'function', 'l’analyseur est chargé dans le Worker');
  assert.strictEqual(typeof ctx.onmessage, 'function', 'et le Worker écoute');
});
