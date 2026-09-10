/*
 * L'admin peut ÉDITER et SUPPRIMER les scores du Challenge du jour.
 *
 * Jusqu'ici l'admin ne touchait que le livre des records (/api/admin/scores) —
 * et ses routes purgent aussi l'ARCHIVE : parfait pour un record, destructeur
 * pour le challenge, dont les journées passées et leurs médailles vivent là.
 * Les nouvelles routes /api/admin/challenge/scores/... n'opèrent QUE sur la
 * journée en cours : la mémoire, le fichier, la ligne live en base — le
 * rollover de minuit lit donc la valeur corrigée, l'archive ne bouge pas.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const PORT = 3464;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-challenge-jour';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const RUN = String(Date.now()).slice(-5);
const JOUEUR = 'chj' + RUN;
// La liste quotidienne vient de la section C des classements du bureau : ce
// sont les internals « _classic » (héritage — la section C EST le challenge
// du jour ; les permanents vivent en section L).
const RK = 'swapou2_classic';

let proc = null;

before(async () => {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5210', FRUTISCORE_PORT: '5211',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(BASE + '/light')).ok) return; } catch {}
    await wait(250);
  }
  throw new Error('serveur indisponible');
});
after(() => {
  if (proc) proc.kill('SIGKILL');
  // data/scores.json survit d'une exécution à l'autre : on retire nos entrées.
  try {
    const fichier = path.join(ROOT, 'data/scores.json');
    const d = JSON.parse(fs.readFileSync(fichier, 'utf8'));
    for (const u of Object.keys(d.users || {})) {
      if (u.slice(0, 3) === 'chj') delete d.users[u];
    }
    fs.writeFileSync(fichier, JSON.stringify(d));
  } catch { /* rien à nettoyer */ }
});

const hdr = { 'Content-Type': 'application/json', 'x-admin-key': CLE };
const statut = async () =>
  (await fetch(BASE + '/api/admin/challenge/status', { headers: hdr })).json();
const duJour = (d) => ((d.scores[RK] || {}).entries || [])
  .find((e) => e.username === JOUEUR);

test('le statut admin donne le classement COMPLET du jour, nommé', async () => {
  // On sème l'entrée du jour par la route records (elle sait créer) — c'est le
  // score qu'un tricheur viendrait de poser.
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: hdr,
    body: JSON.stringify({ username: JOUEUR, password: 'secret123' }) });
  const r = await fetch(`${BASE}/api/admin/scores/${JOUEUR}/${RK}`, {
    method: 'PATCH', headers: hdr, body: JSON.stringify({ score: 4200 }),
  });
  assert.ok(r.ok, 'graine posée');

  const d = await statut();
  assert.ok(d.challengeRankings.includes(RK), 'le classement challenge existe');
  assert.ok(d.rankingNames && d.rankingNames[RK], 'et porte un nom lisible');
  const e = duJour(d);
  assert.ok(e, 'l\'entrée du jour est dans la liste complète');
  assert.equal(e.score, 4200);
});

test('l\'admin édite un score du jour — et seulement un classement challenge', async () => {
  const r = await fetch(`${BASE}/api/admin/challenge/scores/${JOUEUR}/${RK}`, {
    method: 'PATCH', headers: hdr, body: JSON.stringify({ score: 100 }),
  });
  assert.ok(r.ok, 'édition acceptée');
  assert.equal((duJour(await statut()) || {}).score, 100, 'le classement du jour suit');

  // Un classement PERMANENT n'a rien à faire ici : c'est l'affaire des records.
  const refus = await fetch(`${BASE}/api/admin/challenge/scores/${JOUEUR}/snake3_contest`, {
    method: 'PATCH', headers: hdr, body: JSON.stringify({ score: 1 }),
  });
  assert.equal(refus.status, 400, 'classement non-challenge refusé');
});

test('l\'admin supprime un score du jour — une fois', async () => {
  const r = await fetch(`${BASE}/api/admin/challenge/scores/${JOUEUR}/${RK}`, {
    method: 'DELETE', headers: hdr,
  });
  assert.ok(r.ok, 'suppression acceptée');
  assert.equal(duJour(await statut()), undefined, 'plus d\'entrée aujourd\'hui');

  const encore = await fetch(`${BASE}/api/admin/challenge/scores/${JOUEUR}/${RK}`, {
    method: 'DELETE', headers: hdr,
  });
  assert.equal(encore.status, 404, 'rien à supprimer deux fois');
});

test('les routes du jour ne touchent JAMAIS l\'archive, et l\'admin le montre', () => {
  const serveur = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  // Le bloc des routes « jour » ne mentionne aucune des purges d'archive.
  const debut = serveur.indexOf("app.patch('/api/admin/challenge/scores");
  const fin = serveur.indexOf("app.get('/api/admin/challenge/archive");
  assert.ok(debut > 0 && fin > debut);
  const bloc = serveur.slice(debut, fin);
  assert.ok(!/deleteArchivedScore/.test(bloc), 'pas de purge d\'archive côté jour');
  assert.match(bloc, /archive intacte/, 'et le journal le dit');

  const admin = fs.readFileSync(path.join(ROOT, 'public/admin.html'), 'utf8');
  assert.match(admin, /editChallengeScore\(/, 'le bouton Modifier du jour');
  assert.match(admin, /deleteChallengeScore\(/, 'le bouton Supprimer du jour');
  assert.match(admin, /\/api\/admin\/challenge\/scores\//, 'branchés sur les routes du jour');
  assert.match(admin, /l'archive et les médailles des jours passés restent intactes/,
    'la confirmation explique la portée');
});
