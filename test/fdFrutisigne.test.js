'use strict';
/*
 * LE FRUTISIGNE AU SERVEUR : des parties de plus au Challenge, pour de vrai.
 *
 * Semaine du signe → deux parties de plus aujourd'hui, à deux jeux du
 * Challenge tirés au sort ; jour de l'ascendant → une ; les deux → trois. Le
 * crédit s'ajoute au compte du jour comme un Pass (/api/fd/status, le quota
 * qui laisse entrer ou non une partie au classement), le joueur l'apprend une
 * fois par jour, l'admin le voit sur la fiche — et un redémarrage ne retire
 * ni ne redonne rien.
 *
 * Postgres sur 5433 : c'est l'admin qui pose le signe, et ses routes passent
 * par la base. Sans base, le test se met de côté.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Client } = require(path.join(__dirname, '..', 'node_modules', 'pg'));
const FS = require(path.join(__dirname, '..', 'frutisignes.js'));

const ROOT = path.join(__dirname, '..');
const PORT = 3794;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-frutisigne';
const DB = process.env.TEST_DATABASE_URL_FRUTISIGNE || 'postgres://postgres@127.0.0.1:5433/frutiparc_frutisigne';
const JEUX = ['bkiwi', 'kaluga', 'mb2', 'snake3', 'swapou2'];
const SEAUX = { kaluga: 2 };       // Kaluga tient un compte par tableau du jour
const LIBELLES = { bkiwi: 'Burning Kiwi', snake3: 'Frutisnake', swapou2: 'Swapou', mb2: 'MotionBall', kaluga: 'Kaluga' };
const RUN = Date.now().toString(36).slice(-5);
const PSEUDO = 'signe' + RUN;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const aujourdhui = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

let proc = null, dispo = false, data = null;

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
async function demarrer() {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: DB, REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5863', FRUTISCORE_PORT: '5864', FRUTI_DATA_DIR: data,
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {}); proc.stderr.on('data', () => {});
  for (let i = 0; i < 200; i++) {
    try { if ((await fetch(BASE + '/api/online-count')).ok) break; } catch { /* pas prêt */ }
    await wait(250);
  }
  await wait(1500);           // le chargement de la base suit l'ouverture du port
}
async function arreter() {
  if (!proc) return;
  const p = proc; proc = null;
  await new Promise((ok) => { p.once('exit', ok); p.kill('SIGKILL'); });
}

before(async () => {
  data = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-frutisigne-'));
  dispo = await baseNeuve();
  if (dispo) await demarrer();
});
after(async () => {
  await arreter();
  try { fs.rmSync(data, { recursive: true, force: true }); } catch { /* rien */ }
});

const json = (r) => r.json();
const adm = (url, opts = {}) => fetch(BASE + url, Object.assign({}, opts,
  { headers: Object.assign({ 'x-admin-key': CLE, 'Content-Type': 'application/json' }, opts.headers || {}) }));
async function connecter(inscrire) {
  const body = JSON.stringify({ username: PSEUDO, password: 'secret123' });
  const h = { 'Content-Type': 'application/json' };
  if (inscrire) await fetch(BASE + '/api/auth/register', { method: 'POST', headers: h, body });
  const j = await json(await fetch(BASE + '/api/auth/login', { method: 'POST', headers: h, body }));
  assert.ok(j.sid, 'session');
  return j.sid;
}
const statut = (sid, jeu) => fetch(`${BASE}/api/fd/status?sid=${sid}&game=${jeu}`).then(json);
async function statuts(sid) {
  const out = {};
  for (const j of JEUX) out[j] = await statut(sid, j);
  return out;
}
const reserver = (sid, jeu) => fetch(`${BASE}/api/fd/claim`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sid, game: jeu }),
}).then((r) => r.json());
const poserSigne = (signe, ascendant) => adm('/api/admin/users/' + PSEUDO, {
  method: 'PATCH', body: JSON.stringify({ fruti_sign: signe, fruti_sign_b: ascendant }),
}).then((r) => { assert.ok(r.ok, 'PATCH admin ' + r.status); });
const historique = (sid) => fetch(`${BASE}/do/onident?sid=${sid}`).then((r) => r.text());

let sid = null, tires = null;

test('pendant la semaine de son signe, deux jeux du Challenge gagnent une partie', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  sid = await connecter(true);
  const avant = await statuts(sid);
  for (const j of JEUX) {
    assert.equal(avant[j].allowance, 2 * (SEAUX[j] || 1), `${j} : le compte de départ`);
    assert.equal(avant[j].frutisigne, 0, `${j} : pas de cadeau sans signe révélé`);
  }

  const jour = aujourdhui();
  // Son signe est celui de la semaine ; son ascendant, surtout pas celui du jour.
  await poserSigne(FS.signeDeLaSemaine(jour), (FS.signeDuJour(jour) + 5) % 10);
  const apres = await statuts(sid);
  tires = JEUX.filter((j) => apres[j].frutisigne === 1);
  assert.equal(tires.length, 2, `deux jeux reçoivent une partie (${tires.join(', ')})`);
  assert.deepEqual(tires.slice().sort(), FS.tirerLesJeux(PSEUDO, jour, JEUX, 2).slice().sort(),
    'ceux du tirage du jour pour ce joueur');
  for (const j of JEUX) {
    const plus = tires.includes(j) ? (SEAUX[j] || 1) : 0;
    assert.equal(apres[j].allowance, avant[j].allowance + plus, `${j} : le crédit du jour`);
    assert.equal(apres[j].remaining, avant[j].remaining + plus, `${j} : les parties restantes`);
  }
});

test('la partie offerte se joue : une troisième partie classée, pas une quatrième', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  const jeu = tires[0];
  for (let k = 1; k <= 3; k++) {
    const r = await reserver(sid, jeu);
    assert.equal(r.ok, true, `${jeu} : la partie ${k} est accordée (${JSON.stringify(r)})`);
  }
  const refus = await reserver(sid, jeu);
  assert.equal(refus.ok, false, 'la quatrième ne l\'est pas');
  assert.equal(refus.error, 'no_fd');
});

test('le joueur l\'apprend une fois par jour, en clair', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  await historique(sid);
  const xml = await historique(sid);
  const lignes = xml.match(/C'est ta semaine ![^<]*/g) || [];
  assert.equal(lignes.length, 1, `une seule annonce (${lignes.length})`);
  const noms = FS.tirerLesJeux(PSEUDO, aujourdhui(), JEUX, 2).map((j) => LIBELLES[j]);
  assert.equal(lignes[0].replace(/&apos;/g, '\''),
    `C'est ta semaine ! Le Frutisigne t'offre une partie de plus à ${noms[0]} et à ${noms[1]} aujourd'hui.`);
});

test('la fiche admin dit le cadeau du jour', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  const d = await adm('/api/admin/users/' + PSEUDO).then(json);
  assert.ok(d.frutisigne, 'la fiche porte le Frutisigne du jour');
  assert.equal(d.frutisigne.semaine, true);
  assert.equal(d.frutisigne.ascendant, false);
  assert.equal(d.frutisigne.parties, 2);
  assert.deepEqual(d.frutisigne.jeux.slice().sort(), tires.slice().sort());
  assert.deepEqual(d.frutisigne.semaineDuSigne, FS.bornesDeLaSemaine(aujourdhui()));
});

test('le jour de l\'ascendant pendant la semaine du signe : trois parties, les deux premières inchangées', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  const jour = aujourdhui();
  await poserSigne(FS.signeDeLaSemaine(jour), FS.signeDuJour(jour));
  const s = await statuts(sid);
  const maintenant = JEUX.filter((j) => s[j].frutisigne === 1);
  assert.equal(maintenant.length, 3, 'trois jeux servis');
  for (const j of tires) assert.ok(maintenant.includes(j), `${j} garde sa partie`);
  // Le jour de l'ascendant SEUL : une partie.
  await poserSigne((FS.signeDeLaSemaine(jour) + 1) % 10, FS.signeDuJour(jour));
  const seul = await statuts(sid);
  assert.equal(JEUX.filter((j) => seul[j].frutisigne === 1).length, 1, 'une seule partie le jour de l\'ascendant');
  // Retour à la semaine seule pour la suite.
  await poserSigne(FS.signeDeLaSemaine(jour), (FS.signeDuJour(jour) + 5) % 10);
});

test('un redémarrage ne retire ni ne redonne rien', async (t) => {
  if (!dispo) return t.skip('Postgres indisponible sur 5433');
  const avant = await statuts(sid);
  await arreter();
  await demarrer();
  sid = await connecter(false);
  const apres = await statuts(sid);
  for (const j of JEUX) {
    assert.equal(apres[j].frutisigne, avant[j].frutisigne, `${j} : même cadeau`);
    assert.equal(apres[j].allowance, avant[j].allowance, `${j} : même crédit`);
    assert.equal(apres[j].used, avant[j].used, `${j} : les parties jouées sont restées jouées`);
  }
  // Et l'annonce n'est pas refaite : son drapeau a survécu avec l'état FD.
  const xml = await historique(sid);
  assert.equal((xml.match(/C'est ta semaine !/g) || []).length, 1, 'toujours une seule annonce');
});
