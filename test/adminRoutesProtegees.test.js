'use strict';
/*
 * TOUTE ROUTE /api/admin EST GARDÉE.
 *
 * `POST /api/admin/clearScores` n'avait aucun contrôle d'accès : un POST
 * anonyme vidait un classement entier, en mémoire et en base. Ce test relit
 * server.js et exige qu'aucune route /api/admin ne soit déclarée sans
 * `adminAuth`, `adminScope(…)` ou un garde explicite — puis le vérifie en vrai
 * sur la route fautive.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SERVEUR = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const PORT = 3687;
const BASE = `http://127.0.0.1:${PORT}`;
const DONNEES = fs.mkdtempSync(path.join(os.tmpdir(), 'frutiparc-admin-gardes-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('aucune route /api/admin sans garde', () => {
  const routes = [...SERVEUR.matchAll(/app\.(get|post|put|patch|delete)\(\s*(\[[^\]]*\]|'[^']*'|"[^"]*"),\s*([^\n]*)/g)]
    .filter((m) => /\/api\/admin\b/.test(m[2]));
  assert.ok(routes.length > 100, 'les routes admin sont bien lues (' + routes.length + ')');
  // Trois routes sont ouvertes PAR NATURE : s'identifier, se déconnecter, et
  // « qui suis-je ? » (elle ne rend que la session de l'appelant).
  const OUVERTES = new Set(["'/api/admin/login'", "'/api/admin/logout'", "'/api/admin/me'"]);
  const nues = routes.filter((m) => !OUVERTES.has(m[2]))
    .filter((m) => !/^(adminAuth\b|adminScope\(|tournoiScope\b)/.test(m[3].trim()))
    .map((m) => m[1].toUpperCase() + ' ' + m[2] + '  →  ' + m[3].trim().slice(0, 60));
  assert.deepEqual(nues, [], 'routes admin sans garde :\n' + nues.join('\n'));
});

let proc = null;
before(async () => {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', ADMIN_KEY: 'cle-gardes',
      XMLSOCKET_PORT: '5825', FRUTISCORE_PORT: '5826', FRUTI_DATA_DIR: DONNEES,
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

test('clearScores refuse un appel anonyme, accepte l’admin', async () => {
  const corps = JSON.stringify({ ranking: 'snake3_classic' });
  const anonyme = await fetch(BASE + '/api/admin/clearScores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corps });
  assert.ok([401, 403].includes(anonyme.status), 'statut ' + anonyme.status);
  const admin = await fetch(BASE + '/api/admin/clearScores', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-key': 'cle-gardes' }, body: corps });
  assert.equal(admin.status, 200);
});
