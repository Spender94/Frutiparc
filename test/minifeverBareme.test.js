/*
 * MINI-FEVER — LE BARÈME DE NOVEMBRE 2026 : infernal ×6, parties sans plafond.
 *
 * Retours du forum, tranchés par l'admin : « enlever les caps pour chacune
 * des difficultés (celui de 100 pour difficile en particulier) » et « le ×6
 * est bien approprié » pour l'infernal. Ce que ces tests verrouillent :
 *
 *   • LE MOTEUR : sans plafond, l'objectif atteint marque le mode terminé
 *     (gagnee) mais la partie continue, à la difficulté maximale, jusqu'à la
 *     dernière vie ; avec plafond (l'ancienne règle), elle s'arrête net.
 *   • LE REJEU suit la même règle (derouler), et refuse une partie sans
 *     plafond rendue avec des vies en poche.
 *   • LE SERVEUR : la règle entre en vigueur au LENDEMAIN de la mise en ligne
 *     (le classement du jour ne mélange pas deux barèmes) ; une partie suit
 *     la règle du jour de son jeton ; le score vaut épreuves × 10 × (1, 2, 3,
 *     6) ; la donnée garde les épreuves (« palier:épreuves »), que le tableau,
 *     les quêtes et l'audit lisent telles quelles.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const E = require(path.join(ROOT, 'public/minifever/engine.js'));
const FR = require(path.join(ROOT, 'public/minifever/rejeu.js'));
const Q = require(path.join(ROOT, 'quetes.js'));
const AT = require(path.join(ROOT, 'antitricheLight.js'));
const A = require('./aideAntitriche.js');

// ── Le moteur et le rejeu ────────────────────────────────────────────────

function arcade(o) {
  const evts = [];
  const a = new E.Arcade(Object.assign({ catalogue: [], surEvenement: (n, d) => evts.push([n, d]) }, o));
  return { a, evts };
}

test('le moteur : sans plafond, l’objectif atteint, on continue à la difficulté maximale', () => {
  const info = E.PALIERS[0];
  const { a, evts } = arcade({ palier: 0, sansPlafond: true });
  for (let i = 0; i < info.lvl + 5; i++) a.monter();
  assert.equal(a.termine, false, 'la partie continue');
  assert.equal(a.gagnee, true, 'le mode est terminé');
  assert.equal(a.niveau, info.lvl + 5);
  assert.equal(a.dif, info.max, 'à la difficulté maximale');
  assert.deepEqual(evts.map((e) => e[0]), ['objectif'], 'un seul signal, au passage de l’objectif');
  assert.equal(a.bilan().sansPlafond, true);
  // L'ancienne règle : la partie s'arrête net à l'objectif.
  const v = arcade({ palier: 0 });
  for (let i = 0; i < info.lvl; i++) v.a.monter();
  assert.equal(v.a.termine, true);
  assert.deepEqual(v.evts.map((e) => e[0]), ['finPartie']);
});

test('le rejeu : la même règle, et pas de partie sans plafond rendue avec des vies en poche', () => {
  const info = E.PALIERS[0];
  const verdicts = Array(info.lvl + 3).fill(true).concat(Array(info.vies).fill(false));
  const sans = FR.derouler(info, verdicts, { sansPlafond: true });
  assert.equal(sans.ok, true, sans.raison);
  assert.deepEqual([sans.niveau, sans.gagnee, sans.jouees], [info.lvl + 3, true, info.lvl + 3 + info.vies]);
  assert.equal(sans.difs[info.lvl + 2], info.max, 'au-delà de l’objectif : la difficulté maximale');
  // Avec plafond, l'épreuve d'après l'objectif n'existe pas.
  assert.match(FR.derouler(info, verdicts).raison, /jouée après la fin de partie/);
  // Sans plafond, l'objectif seul ne finit pas une partie.
  assert.match(FR.derouler(info, Array(info.lvl).fill(true), { sansPlafond: true }).raison, /il restait des vies/);
  // Avant l'objectif, les deux règles donnent les mêmes difficultés.
  const court = [true, true, false, true].concat(Array(info.vies - 1).fill(false));
  assert.deepEqual(FR.derouler(info, court).difs, FR.derouler(info, court, { sansPlafond: true }).difs);
});

test('les quêtes et l’audit lisent les épreuves dans la donnée « palier:épreuves »', () => {
  const m = Q.MESURES['minifever-arcade3'];
  const evt = (v, data) => Q.valeurDe(m, { type: 'score', rk: 'minifever_arcade', v, data });
  assert.equal(evt(6000, '3:100'), 100, 'barème de novembre : 100 épreuves × 60');
  assert.equal(evt(400, '3'), 10, 'avant : 10 épreuves × 40');
  assert.equal(evt(600, '2:20'), null, 'un autre palier ne compte pas');
  assert.equal(Q.valeurDe(Q.MESURES['minifever-arcade1'], { type: 'score', rk: 'minifever_arcade', v: 2400, data: '1:120' }), 120,
    'au-delà de l’objectif (80 en normal)');
  const audit = (s) => AT.auditer({ arcade: [Object.assign({ username: 'x', jour: '2026-11-12', verifie: 0 }, s)] });
  assert.equal(audit({ score: 6000, data: '3:100' }).length, 0, 'au barème');
  assert.equal(audit({ score: 2400, data: '1:120' }).length, 0, 'au-delà de l’objectif : rien d’anormal');
  assert.match(audit({ score: 6050, data: '3:100' })[0].raisons.join(' '), /ne suit pas le barème/);
  assert.deepEqual(AT.MINIFEVER_MULT_V2, [1, 2, 3, 6]);
});

// ── Le serveur ───────────────────────────────────────────────────────────

const PORT = 3693;
const BASE = `http://127.0.0.1:${PORT}`;
const RUN = Date.now().toString(36).slice(-5);
const SECRET = 'bareme-secret-' + RUN + '-0123456789';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
AT.poserSecret(SECRET);
let proc = null;

function demarrer(depuis) {
  const p = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      XMLSOCKET_PORT: '5693', FRUTISCORE_PORT: '5694', ANTITRICHE_SECRET: SECRET,
      MINIFEVER_BAREME_DEPUIS: depuis || '',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  p.stdout.on('data', () => {});
  p.stderr.on('data', () => {});
  return p;
}
async function pret() {
  for (let i = 0; i < 160; i++) {
    try { if ((await fetch(BASE + '/api/minifever/bareme')).ok) return; } catch { /* pas prêt */ }
    await wait(250);
  }
  throw new Error('serveur indisponible');
}
before(async () => { proc = demarrer('2000-01-01'); await pret(); });
after(() => {
  if (proc) proc.kill('SIGKILL');
  try {
    const f = path.join(ROOT, 'data/scores.json');
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
    for (const u of Object.keys(d.users || {})) if (u.startsWith('bar')) delete d.users[u];
    fs.writeFileSync(f, JSON.stringify(d));
  } catch { /* rien à nettoyer */ }
});

async function sidPour(username) {
  const body = JSON.stringify({ username, password: 'secret123' });
  const h = { 'Content-Type': 'application/json' };
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: h, body });
  const j = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: h, body })).json();
  assert.ok(j.sid, 'connexion → sid');
  return j.sid;
}
const finir = (sid, corps) => fetch(BASE + '/api/minifever/score', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ sid }, corps)),
}).then((r) => r.json());
function partie(username, palier, victoires, graine, regle) {
  const c = A.arcadeConstruite(graine, palier, victoires, regle);
  const j = AT.creerJeton({ jeu: 'minifever', username, mode: palier, graine, t: Date.now() - c.minimumMs - 60000 });
  return Object.assign({}, c, { corps: Object.assign({ jeton: j.jeton }, c.corps) });
}

test('serveur : le barème du jour se lit, et le jeton dit la règle', async () => {
  const b = await (await fetch(BASE + '/api/minifever/bareme')).json();
  assert.deepEqual([b.mult, b.sansPlafond, b.depuis], [[1, 2, 3, 6], true, '2000-01-01']);
  const sid = await sidPour('bara' + RUN);
  const p = await (await fetch(BASE + '/api/minifever/partie', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sid, palier: 3 }) })).json();
  assert.equal(p.ok, true);
  assert.deepEqual(p.regle, { sansPlafond: true, mult: 6 });
});

test('serveur : l’infernal paie ×6, et le tableau dit les épreuves', async () => {
  const u = 'barb' + RUN;
  const sid = await sidPour(u);
  const i = partie(u, 3, 4, 902, { sansPlafond: true });
  assert.ok(i.niveau >= 1);
  const r = await finir(sid, i.corps);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.score, i.niveau * 10 * 6);
  assert.equal(r.mult, 6);
  const d = await (await fetch(`${BASE}/api/light/challenge?sid=${encodeURIComponent(sid)}`)).json();
  const moi = d.games.find((g) => g.game === 'minifever').scores.find((s) => s.isMe);
  assert.equal(moi.label, `${(i.niveau * 60).toLocaleString('fr-FR')} · ${i.niveau} épreuve${i.niveau > 1 ? 's' : ''} en infernal`);
});

test('serveur : au-delà de l’objectif, plus de refus « niveau » — la partie va au rejeu', async () => {
  // (Le banc d'essai ne sait pas gagner quarante épreuves au hasard : le
  // passage de l'objectif se vérifie sur le rejeu, plus haut. Ici, la porte :
  // 41 épreuves en facile ne sont plus refusées d'office ; sans jeton, c'est
  // le défaut de jeton qui parle.)
  const sid = await sidPour('barc' + RUN);
  const r = await finir(sid, { palier: 0, niveau: 41, jouees: 41 + E.PALIERS[0].vies });
  assert.equal(r.error, 'partie_non_verifiee', JSON.stringify(r));
});

test('serveur : sans date fixée, le barème attend le lendemain — la règle d’avant d’ici là', async () => {
  proc.kill('SIGKILL');
  await wait(300);
  proc = demarrer('');
  await pret();
  const b = await (await fetch(BASE + '/api/minifever/bareme')).json();
  const demain = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(Date.now() + 24 * 3600 * 1000));
  assert.deepEqual([b.mult, b.sansPlafond, b.depuis], [[1, 2, 3, 4], false, demain]);
  const u = 'bard' + RUN;
  const sid = await sidPour(u);
  const i = partie(u, 3, 3, 904);
  const r = await finir(sid, i.corps);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.score, i.niveau * 10 * 4, 'aujourd’hui encore ×4');
  // L'ancien plafond tient : pas plus d'épreuves que l'objectif.
  assert.equal((await finir(sid, { palier: 0, niveau: 41, jouees: 41 })).error, 'niveau');
});
