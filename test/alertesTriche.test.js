'use strict';
/*
 * LES ALERTES DE TRICHE — le registre commun.
 *
 * Ce qui ne passe pas la vérification n'est pas classé et part en alerte
 * (signalerTriche) ; l'admin lit la liste, le décompte par joueur, et classe
 * ou traite chaque alerte. Ici, en mémoire (sans base) : un score posté par
 * la porte générique sur un classement vérifié (l'Arbre creux de MiniPixiz) est refusé, et
 * l'alerte paraît dans l'admin.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3689;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-alertes';
const DONNEES = fs.mkdtempSync(path.join(os.tmpdir(), 'frutiparc-alertes-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const JSN = { 'Content-Type': 'application/json' };
const ADMIN = { 'x-admin-key': CLE, 'Content-Type': 'application/json' };

let proc = null;
before(async () => {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', ADMIN_KEY: CLE, REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      XMLSOCKET_PORT: '5827', FRUTISCORE_PORT: '5828', FRUTI_DATA_DIR: DONNEES,
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
  return (await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: JSN, body })).json()).sid;
}

test('un score forgé est refusé, l’alerte paraît, l’admin la traite', async () => {
  const sid = await inscrire('forgeur');
  const b = new URLSearchParams({ sid, game: 'minipixiz', m: '0', score: '99999', data: '' });
  await fetch(BASE + '/api/saveScore', { method: 'POST', body: b });
  await wait(200);
  // Réservé à l'admin.
  assert.ok([401, 403].includes((await fetch(BASE + '/api/admin/triche/alertes')).status));
  const l = await (await fetch(BASE + '/api/admin/triche/alertes?username=forgeur', { headers: ADMIN })).json();
  assert.equal(l.ok, true);
  const a = l.alertes.find((x) => x.type === 'score_sans_partie');
  assert.ok(a, 'l’alerte du score sans partie : ' + JSON.stringify(l.alertes));
  assert.deepEqual([a.username, a.jeu, a.gravite, a.statut], ['forgeur', 'minipixiz', 'suspect', 'ouverte']);
  assert.match(a.resume, /score 99999 sans partie vérifiable \(saveScore\)/);
  // Répété aussitôt : une seule alerte (pas de noyade).
  await fetch(BASE + '/api/saveScore', { method: 'POST', body: b });
  await wait(200);
  const l2 = await (await fetch(BASE + '/api/admin/triche/alertes?username=forgeur', { headers: ADMIN })).json();
  assert.equal(l2.alertes.filter((x) => x.type === 'score_sans_partie').length, 1);
  // Le décompte par joueur.
  const j = await (await fetch(BASE + '/api/admin/triche/joueurs', { headers: ADMIN })).json();
  assert.deepEqual(j.joueurs.find((x) => x.username === 'forgeur'), Object.assign({}, j.joueurs.find((x) => x.username === 'forgeur'), { total: 1, ouvertes: 1 }));
  // Le traitement.
  const t = await (await fetch(BASE + '/api/admin/triche/alertes/' + a.id, { method: 'POST', headers: ADMIN,
    body: JSON.stringify({ statut: 'traitee', note: 'score retiré' }) })).json();
  assert.equal(t.ok, true);
  assert.deepEqual([t.alerte.statut, t.alerte.note], ['traitee', 'score retiré']);
  const ouvertes = await (await fetch(BASE + '/api/admin/triche/alertes?statut=ouverte&username=forgeur', { headers: ADMIN })).json();
  assert.equal(ouvertes.alertes.length, 0);
  assert.equal((await fetch(BASE + '/api/admin/triche/alertes/' + a.id, { method: 'POST', headers: ADMIN,
    body: JSON.stringify({ statut: 'n_importe' }) })).status, 400);
});
