/*
 * Un compte, plusieurs casquettes.
 *
 * Les rôles admin s'excluaient : il fallait choisir entre « Responsable des
 * scores », « Animateur » et « Chapelier » pour un même bénévole. Ils
 * s'additionnent désormais — ses onglets sont la RÉUNION de ceux de ses rôles,
 * et ses accès aussi.
 *
 * Le test passe par la vraie porte : /api/admin/login avec les identifiants de
 * jeu, puis le token obtenu sur des endpoints appartenant à chaque rôle. Un
 * onglet affiché sans l'accès qui va avec (ou l'inverse) ne servirait à rien.
 *
 * Les rôles ne vivent qu'en base (la fiche joueur de l'admin écrit la colonne
 * `admin_role`) : il faut donc une VRAIE base, comme shopFeaturePersistence.
 * Sans base de test joignable, les cas sont sautés plutôt que faussement verts.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'));

const ROOT = path.join(__dirname, '..');
const PORT = 3509;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-de-test-roles-cumules';
const DB = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/frutiparc_roles';
const RUN = Date.now().toString(36).slice(-5);
const MDP = 'secret123';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const hdrCle = { 'Content-Type': 'application/json', 'x-admin-key': CLE };

// Un endpoint par rôle : si le token l'ouvre, l'onglet est réellement accessible.
const PORTES = {
  scores: '/api/admin/scores',
  animateur: '/api/admin/kiloute/questions',
  chapelier: '/api/admin/shop',
};

let proc = null;
let dispo = false;

async function baseDisponible() {
  const admin = new Client({ connectionString: DB.replace(/\/[^/]+$/, '/postgres') });
  try {
    await admin.connect();
    const nom = DB.split('/').pop();
    await admin.query(`DROP DATABASE IF EXISTS ${nom}`);
    await admin.query(`CREATE DATABASE ${nom}`);
    await admin.end();
    return true;
  } catch { try { await admin.end(); } catch {} return false; }
}

before(async () => {
  dispo = await baseDisponible();
  if (!dispo) return;
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: DB, REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5268', FRUTISCORE_PORT: '5269',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  // Le serveur répond en HTTP avant la fin de ses migrations : on attend que la
  // table des comptes existe, sinon l'inscription tombe sur « relation "users"
  // does not exist ».
  for (let i = 0; i < 160; i++) {
    try {
      if ((await fetch(BASE + '/do/prefdef')).ok) {
        const c = new Client({ connectionString: DB });
        await c.connect();
        const { rows } = await c.query(
          `SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'admin_role'`);
        await c.end();
        if (rows.length) return;
      }
    } catch { /* pas prêt */ }
    await wait(250);
  }
  throw new Error('serveur ou schéma indisponible');
});

after(() => { if (proc) proc.kill('SIGKILL'); });

async function inscrire(pseudo) {
  const body = JSON.stringify({ username: pseudo, password: MDP });
  await fetch(BASE + '/api/auth/register',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
}

// Attribue des rôles comme le fait la fiche joueur de l'admin (cases cochées →
// liste séparée par des virgules).
async function donnerRoles(pseudo, roles) {
  const r = await fetch(`${BASE}/api/admin/users/${encodeURIComponent(pseudo)}`, {
    method: 'PATCH', headers: hdrCle,
    body: JSON.stringify({ admin_role: Array.isArray(roles) ? roles.join(',') : roles }),
  });
  return r.status;
}

async function seConnecter(pseudo) {
  const r = await fetch(BASE + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: pseudo, password: MDP }),
  });
  return { statut: r.status, corps: await r.json() };
}

const ouvre = async (token, chemin) =>
  (await fetch(BASE + chemin, { headers: { 'x-admin-token': token } })).status;

// ── Le cas de Rémi : les trois d'un coup ───────────────────────────────────

test('un compte peut porter les trois rôles à la fois', async (t) => {
  if (!dispo) return t.skip('pas de base PostgreSQL de test disponible');
  const pseudo = 'troiscasq' + RUN;
  await inscrire(pseudo);
  assert.equal(await donnerRoles(pseudo, ['scores', 'animateur', 'chapelier']), 200);

  const { statut, corps } = await seConnecter(pseudo);
  assert.equal(statut, 200, 'connexion admin acceptée : ' + JSON.stringify(corps).slice(0, 160));
  assert.deepEqual(corps.roles, ['scores', 'animateur', 'chapelier'], 'les trois rôles sont portés');
  assert.match(corps.label, /Responsable des scores.*Animateur.*Chapelier/,
    'l\'étiquette les nomme tous : ' + corps.label);

  // Les onglets sont la réunion des trois.
  for (const onglet of ['scores', 'challenge', 'kiloute', 'channels', 'tournoi', 'trombinoscope', 'dons', 'shop']) {
    assert.ok(corps.tabs.includes(onglet), `l'onglet « ${onglet} » est ouvert`);
  }

  // Et les accès suivent vraiment, endpoint par endpoint.
  for (const [role, porte] of Object.entries(PORTES)) {
    assert.equal(await ouvre(corps.token, porte), 200, `${porte} (${role}) est accessible`);
  }
});

// ── Un seul rôle reste un seul rôle ────────────────────────────────────────

test('un rôle unique n\'ouvre que ses onglets', async (t) => {
  if (!dispo) return t.skip('pas de base PostgreSQL de test disponible');
  const pseudo = 'unecasq' + RUN;
  await inscrire(pseudo);
  await donnerRoles(pseudo, 'chapelier');

  const { corps } = await seConnecter(pseudo);
  assert.deepEqual(corps.roles, ['chapelier']);
  assert.deepEqual(corps.tabs, ['shop'], 'la boutique, et rien d\'autre');
  assert.equal(await ouvre(corps.token, PORTES.chapelier), 200, 'la boutique s\'ouvre');
  assert.equal(await ouvre(corps.token, PORTES.scores), 403, 'les scores restent fermés');
  assert.equal(await ouvre(corps.token, PORTES.animateur), 403, 'MikeHorny reste fermé');
});

test('l\'ancien format (une valeur seule) reste valide', async (t) => {
  if (!dispo) return t.skip('pas de base PostgreSQL de test disponible');
  // Rien à migrer en base : « chapelier » est une liste d'un élément.
  const pseudo = 'ancien' + RUN;
  await inscrire(pseudo);
  await donnerRoles(pseudo, 'scores');
  const { corps } = await seConnecter(pseudo);
  assert.deepEqual(corps.roles, ['scores']);
  assert.equal(await ouvre(corps.token, PORTES.scores), 200);
});

// ── Le badge Animateur s'ajoute, il ne remplace plus ───────────────────────

test('le badge Animateur s\'ajoute aux rôles explicites', async (t) => {
  if (!dispo) return t.skip('pas de base PostgreSQL de test disponible');
  // Avant, un rôle explicite masquait le badge : un responsable des scores qui
  // animait aussi perdait MikeHorny en prenant les scores.
  const pseudo = 'badge' + RUN;
  await inscrire(pseudo);
  await donnerRoles(pseudo, 'scores');
  const maj = await fetch(`${BASE}/api/admin/users/${encodeURIComponent(pseudo)}`, {
    method: 'PATCH', headers: hdrCle, body: JSON.stringify({ is_animator: true }),
  });
  assert.equal(maj.status, 200, 'badge animateur posé');

  const { corps } = await seConnecter(pseudo);
  assert.deepEqual(corps.roles, ['scores', 'animateur'], 'les deux casquettes tiennent ensemble');
  assert.equal(await ouvre(corps.token, PORTES.scores), 200, 'les scores restent ouverts');
  assert.equal(await ouvre(corps.token, PORTES.animateur), 200, 'et MikeHorny l\'est aussi');
});

// ── Garde-fous ─────────────────────────────────────────────────────────────

test('les rôles inconnus sont écartés, la liste est rangée', async (t) => {
  if (!dispo) return t.skip('pas de base PostgreSQL de test disponible');
  const pseudo = 'bizarre' + RUN;
  await inscrire(pseudo);
  // Ordre inversé, doublon, valeur inventée, espaces, casse.
  await donnerRoles(pseudo, ' CHAPELIER , scores ,scores, roi-du-monde ');
  const { corps } = await seConnecter(pseudo);
  assert.deepEqual(corps.roles, ['scores', 'chapelier'],
    'ordre canonique, sans doublon ni rôle inventé');
  assert.ok(!corps.tabs.includes('kiloute'), 'et rien de plus que ce qui a été coché');
});

test('retirer toutes les cases ferme la porte', async (t) => {
  if (!dispo) return t.skip('pas de base PostgreSQL de test disponible');
  const pseudo = 'retrait' + RUN;
  await inscrire(pseudo);
  await donnerRoles(pseudo, ['scores', 'chapelier']);
  const avant = await seConnecter(pseudo);
  assert.equal(avant.statut, 200, 'il entrait bien avant');

  await donnerRoles(pseudo, '');                       // toutes les cases décochées
  const apres = await seConnecter(pseudo);
  assert.equal(apres.statut, 403, 'sans rôle, plus d\'accès à l\'admin');
  // Et son ancien jeton ne survit pas au retrait.
  assert.equal(await ouvre(avant.corps.token, PORTES.scores), 403,
    'le jeton en cours est révoqué du même coup');
});

test('un compte sans rôle n\'entre pas', async (t) => {
  if (!dispo) return t.skip('pas de base PostgreSQL de test disponible');
  const pseudo = 'quidam' + RUN;
  await inscrire(pseudo);
  const { statut } = await seConnecter(pseudo);
  assert.equal(statut, 403);
});

// ── L'ONGLET D'ARRIVÉE ────────────────────────────────────────────────────
// L'admin s'ouvrait sur le PREMIER onglet des droits — MikeHorny pour un
// animateur, qu'on consulte une fois par semaine, alors que son travail
// commence aux Salons. Le serveur désigne donc l'onglet d'arrivée.

test('un animateur arrive sur les Salons, pas sur MikeHorny', async (t) => {
  if (!dispo) return t.skip('pas de base PostgreSQL de test disponible');
  const pseudo = 'arrive' + RUN;
  await inscrire(pseudo);
  await donnerRoles(pseudo, ['animateur']);
  const j = await (await fetch(BASE + '/api/admin/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: pseudo, password: MDP }),
  })).json();
  assert.ok(j.ok, 'connexion admin : ' + JSON.stringify(j).slice(0, 140));
  assert.equal(j.accueil, 'channels', 'il atterrit sur les Salons');
  assert.ok(j.tabs.includes('kiloute'), 'MikeHorny lui reste ouvert');
  assert.notEqual(j.accueil, 'kiloute', 'mais ce n\'est plus la porte d\'entrée');
  // Et /api/admin/me le redit, pour un rechargement de page.
  const me = await (await fetch(BASE + '/api/admin/me', {
    headers: { 'x-admin-token': j.token },
  })).json();
  assert.equal(me.accueil, 'channels', 'le contexte le porte aussi');
});
