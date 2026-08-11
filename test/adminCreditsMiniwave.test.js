/*
 * Donner des crédits Mini-Wave depuis l'admin.
 *
 * Les crédits sont la monnaie INTERNE du jeu — le stand, où l'on achète les
 * vaisseaux, les modes et les smileys. Ce n'est pas le kikooz du site. Ils
 * vivent dans `$credit` de la fiche Mini-Wave, slot 0.
 *
 * Ce que ça sert : dédommager. Le serveur ne garde aucun historique des
 * crédits — un solde perdu ne peut donc pas être recalculé, seulement redonné.
 * Sans outil, il fallait éditer la fiche à la main en base.
 *
 * Ce fichier vérifie la chaîne complète : lecture du solde, ajout, retrait,
 * plancher à zéro, garde-fous de saisie, et surtout que le crédit SURVIT — en
 * mémoire comme en base — et que le jeu le relit.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const { Client } = require('pg');

const ROOT = path.join(__dirname, '..');
const PORT = 3498;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-de-test-credits';
const DB = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/frutiparc_mwcred';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let proc = null, dispo = false;

// Le module plateforme est écrit pour le navigateur : on lui fabrique un
// `window` et un `fetch` qui parlent au vrai serveur. C'est donc bien le
// fichier servi au joueur qu'on exerce.
function chargerPlateforme() {
  const src = fs.readFileSync(path.join(ROOT, 'public/miniwave/plateforme.js'), 'utf8');
  const bac = {
    window: {}, Promise, JSON, Number, Array, Object, String, Error, Math,
    fetch: (url, opt) => fetch(url.indexOf('http') === 0 ? url : BASE + url, opt),
  };
  bac.globalThis = bac;
  vm.createContext(bac);
  vm.runInContext(src, bac, { filename: 'plateforme.js' });
  return bac.window.MiniwavePlateforme;
}

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

before(async () => {
  dispo = await baseNeuve();
  if (!dispo) return;
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: DB, REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5178', FRUTISCORE_PORT: '5179',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 160; i++) {
    try {
      if ((await fetch(BASE + '/api/loadFrutiSlots?game=snake3')).ok) {
        const c = new Client({ connectionString: DB });
        await c.connect();
        const { rows } = await c.query(
          `SELECT 1 FROM information_schema.tables WHERE table_name = 'users'`);
        await c.end();
        if (rows.length) return;
      }
    } catch { /* pas prêt */ }
    await wait(250);
  }
  throw new Error('serveur ou schéma indisponible');
});
after(() => { if (proc) proc.kill('SIGKILL'); });

const hdrAdmin = { 'Content-Type': 'application/json', 'x-admin-key': CLE };

async function inscrire(pseudo) {
  const body = JSON.stringify({ username: pseudo, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const r = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const d = await r.json();
  assert.ok(d.sid, 'connexion → sid');
  return d.sid;
}

const lire = (u) => fetch(`${BASE}/api/admin/users/${u}/miniwave-credits`, { headers: hdrAdmin })
  .then((r) => r.json());
const donner = (u, corps) => fetch(`${BASE}/api/admin/users/${u}/miniwave-credits`,
  { method: 'POST', headers: hdrAdmin, body: JSON.stringify(corps) })
  .then(async (r) => ({ statut: r.status, corps: await r.json() }));

// ── La lecture ────────────────────────────────────────────────────────────

test('un joueur qui n\'a jamais lancé Mini-Wave n\'a pas de fiche — et on le dit', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible');
  await inscrire('creneuf');
  const d = await lire('creneuf');
  assert.equal(d.carte, false, 'pas de fiche');
  assert.equal(d.credits, null, 'donc pas de solde à montrer');

  // Et on refuse de créditer : poser une fiche ici entrerait en conflit avec la
  // toute première sauvegarde du joueur.
  const r = await donner('creneuf', { delta: 50 });
  assert.equal(r.statut, 400, 'refus net');
  assert.match(r.corps.error, /fiche Mini-Wave/, 'avec la raison');
});

test('le solde lu est celui de la fiche de jeu', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible');
  const P = chargerPlateforme();
  const sid = await inscrire('crelu');
  const p = new P.Plateforme(sid);
  await p.charger();
  p.carte.$credit = 137;
  p.carte.$arcade.$bestScore = 24000;
  p.carte.$arcade.$bestLevel = 18;
  await p.ecrire(p.carte);

  const d = await lire('crelu');
  assert.equal(d.carte, true);
  assert.equal(d.credits, 137, 'le solde du stand');
  assert.equal(d.bestScore, 24000, 'et le record d\'arcade, pour situer le joueur');
  assert.equal(d.bestLevel, 18);
});

// ── Donner, retirer ───────────────────────────────────────────────────────

test('donner des crédits augmente le solde, et le jeu les relit', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible');
  const P = chargerPlateforme();
  const sid = await inscrire('credon');
  const p = new P.Plateforme(sid);
  await p.charger();
  p.carte.$credit = 21;
  await p.ecrire(p.carte);

  const r = await donner('credon', { delta: 79 });     // le dédommagement du rapport
  assert.equal(r.statut, 200);
  assert.equal(r.corps.avant, 21, 'le solde d\'avant est rendu, pour la trace');
  assert.equal(r.corps.credits, 100);

  // La vérification qui compte : le JEU voit-il les crédits ?
  const relu = await new P.Plateforme(sid).charger();
  assert.equal(relu.$credit, 100, 'le client relit bien le nouveau solde');
});

test('retirer ne descend jamais sous zéro', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible');
  const P = chargerPlateforme();
  const sid = await inscrire('creret');
  const p = new P.Plateforme(sid);
  await p.charger();
  p.carte.$credit = 30;
  await p.ecrire(p.carte);

  assert.equal((await donner('creret', { delta: -10 })).corps.credits, 20);
  const plancher = await donner('creret', { delta: -999 });
  assert.equal(plancher.corps.credits, 0, 'plancher à zéro, pas de solde négatif');
  assert.equal((await new P.Plateforme(sid).charger()).$credit, 0);
});

test('on peut aussi fixer un solde exact', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible');
  const P = chargerPlateforme();
  const sid = await inscrire('crefix');
  const p = new P.Plateforme(sid);
  await p.charger();
  p.carte.$credit = 5;
  await p.ecrire(p.carte);

  const r = await donner('crefix', { set: 250 });
  assert.equal(r.corps.credits, 250);
  assert.equal((await new P.Plateforme(sid).charger()).$credit, 250);
});

// ── Les garde-fous ────────────────────────────────────────────────────────

test('une saisie absurde ou vide est refusée', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible');
  const P = chargerPlateforme();
  const sid = await inscrire('cregarde');
  const p = new P.Plateforme(sid);
  await p.charger();
  p.carte.$credit = 42;
  await p.ecrire(p.carte);

  assert.equal((await donner('cregarde', {})).statut, 400, 'ni delta ni set');
  assert.equal((await donner('cregarde', { delta: 10000000 })).statut, 400, 'un zéro de trop');
  assert.equal((await donner('cregarde', { set: -5 })).statut, 400, 'un solde négatif');

  // Rien n'a bougé.
  assert.equal((await lire('cregarde')).credits, 42, 'le solde est intact après les refus');
});

test('l\'admin est exigé', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible');
  const sans = await fetch(`${BASE}/api/admin/users/cregarde/miniwave-credits`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ delta: 1000 }),
  });
  assert.ok(sans.status === 401 || sans.status === 403,
    `sans clé admin, on n'entre pas (${sans.status})`);
});

// ── Le reste de la fiche est intact ───────────────────────────────────────

test('créditer ne touche à rien d\'autre dans la fiche', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible');
  const P = chargerPlateforme();
  const sid = await inscrire('creintact');
  const p = new P.Plateforme(sid);
  await p.charger();
  p.carte.$credit = 10;
  p.carte.$ship = [1, 1, 0, 1, 0, 0];
  p.carte.$mode[2] = [0, 1, 0];
  p.carte.$arcade = { $bestScore: 31000, $bestLevel: 24 };
  p.carte.$badsKill[3] = 212;
  await p.ecrire(p.carte);

  await donner('creintact', { delta: 500 });

  const relu = await new P.Plateforme(sid).charger();
  assert.equal(relu.$credit, 510, 'le solde a bougé');
  assert.deepEqual(relu.$ship, [1, 1, 0, 1, 0, 0], 'les vaisseaux sont là');
  assert.deepEqual(relu.$mode[2], [0, 1, 0], 'les modes achetés aussi');
  assert.equal(relu.$arcade.$bestScore, 31000, 'le record d\'arcade est intact');
  assert.equal(relu.$arcade.$bestLevel, 24);
  assert.equal(relu.$badsKill[3], 212, 'et le compteur d\'éliminations');
});

// ── L'écran d'admin ───────────────────────────────────────────────────────

test('la fiche joueur de l\'admin porte la ligne et ses boutons', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/admin.html'), 'utf8');
  assert.match(src, /<tr><td>Crédits Mini-Wave<\/td><td id="mw-credits-cell">/,
    'la ligne existe dans le tableau');
  assert.match(src, /async function chargerCreditsMiniwave\(username\)/, 'elle se remplit');
  assert.match(src, /chargerCreditsMiniwave\(user\.username \|\| u\);/,
    'et l\'affichage de la fiche la déclenche');
  assert.match(src, /async function donnerCreditsMiniwave\(username, signe\)/,
    'donner et retirer passent par la même fonction');
  // L'avertissement compte autant que le bouton : créditer un joueur EN JEU se
  // fera écraser par sa prochaine sauvegarde.
  assert.match(src, /prochaine sauvegarde écrasera ce solde/,
    'le bouton prévient du cas « joueur en train de jouer »');
});
