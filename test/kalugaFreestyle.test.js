/*
 * Kaluga « Freestyle » — le classement SANS grappe du Club.
 *
 * Réaliser une grosse grappe tient souvent de la chance (les bons papillons au
 * bon moment) et rapporte énormément : une grappe de taille k vaut
 * 2^min(11,k) × 10 points — 1280 pour la Mega (k=7), 2560 pour l'Atomique
 * (k=8), 20480 pour la Maestro. Des joueurs revendiquent le « freestyle »
 * (jouer sans grappe) : on distingue donc deux records.
 *
 * La chaîne complète :
 *   · le SWF patché (scripts/patch-kaluga-grappe.js) accumule
 *     « jeu.gOr |= taille » à chaque fin de grappe et envoie la donnée de
 *     score « tz:gOr » — le OU binaire des tailles rend le test « ≥ 8 »
 *     équivalent à « une grappe de plus de 2000 points est passée » (la
 *     première marche au-dessus est 2560) ;
 *   · le serveur (parseKalugaGrappe) classe la partie : témoin < 8 → le score
 *     nourrit AUSSI kaluga_freestyle ; témoin ≥ 8 ou donnée d'avant le patch
 *     (« [object Object] », tz=1…) → classements historiques seulement ;
 *   · le Club (bureau : LEGACY_RANKINGS rk '12', section L comme les Contest —
 *     record permanent, pas de médailles quotidiennes en plus ; light : le
 *     livre des records qui itère RANKINGS) montre la nouvelle cuve.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3463;
const BASE = `http://127.0.0.1:${PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let serverProc;
before(async () => {
  serverProc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      XMLSOCKET_PORT: '5198', FRUTISCORE_PORT: '5199',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProc.stdout.on('data', () => {});
  serverProc.stderr.on('data', () => {});
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(BASE + '/api/loadFrutiSlots?game=snake3')).ok) return; } catch { /* pas prêt */ }
    await wait(250);
  }
  throw new Error('serveur indisponible');
});
// Les pseudos de ce fichier, pour le ménage de fin.
const BASES = ['freestyleuse', 'megajoueuse', 'vieuxclient', 'vieuxobjet', 'championne'];

after(() => {
  if (serverProc) serverProc.kill('SIGKILL');
  // MÉNAGE — indispensable, pas cosmétique. Les scores sont écrits sur le
  // disque (data/scores.json, hors dépôt) et SURVIVENT à l'exécution ; le
  // livre des records ne rend que le top 20. Sans ce nettoyage, une vingtaine
  // de passages suffisait à remplir la fenêtre de résidus et le test se
  // mettait à échouer sans qu'une ligne de code ait bougé.
  try {
    const fichier = path.join(ROOT, 'data/scores.json');
    const d = JSON.parse(fs.readFileSync(fichier, 'utf8'));
    for (const u of Object.keys(d.users || {})) {
      if (BASES.some((b) => u.startsWith(b))) delete d.users[u];
    }
    fs.writeFileSync(fichier, JSON.stringify(d));
  } catch { /* rien à nettoyer */ }
});

// Des pseudos UNIQUES par exécution : deux passages qui se chevauchent ne se
// marchent pas dessus (le ménage ci-dessus efface les deux séries).
const CRU = Date.now().toString(36).slice(-6);
const pseudo = (base) => base + CRU;
// Le livre des records ne montre que le top 20 : nos scores doivent dominer
// ceux des autres suites. Une base très haute suffit — l'unicité entre
// exécutions, elle, vient du ménage de fin et non de cette valeur (qui
// reboucle toutes les mille secondes).
const B = 900000000 + (Date.now() % 1000000) * 100;

async function sidFor(username) {
  const body = JSON.stringify({ username, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const j = await r.json();
  assert.ok(j.sid, 'connexion → sid');
  return j.sid;
}
const enregistrer = (sid, score, data, m) =>
  fetch(`${BASE}/api/saveScore?sid=${encodeURIComponent(sid)}&game=kaluga` +
        `&m=${m || 0}&score=${score}&data=${encodeURIComponent(data || '')}`).then((r) => r.json());
async function cuves() {
  const j = await (await fetch(`${BASE}/api/club/records?limit=20`)).json();
  const par = {};
  for (const r of j.rankings || []) par[r.id] = r;
  return par;
}
const scoreDe = (cuve, pseudo) => {
  const ligne = ((cuve && cuve.scores) || []).find((s) => String(s.user).toLowerCase() === pseudo);
  return ligne ? ligne.score : null;
};

// ── La règle de classement, de bout en bout ───────────────────────────────

test('une partie sans grappe entre au freestyle, une partie à grappe non', async () => {
  const sid = await sidFor(pseudo('freestyleuse'));

  // Témoin 0 : aucune grappe — les deux cuves.
  let r = await enregistrer(sid, B + 10, '4:0');
  assert.equal(r.ok, true, 'le score passe');
  let c = await cuves();
  assert.ok(c.kaluga_freestyle, 'la cuve freestyle existe');
  assert.equal(c.kaluga_freestyle.name, 'Kaluga - Freestyle');
  assert.equal(scoreDe(c.kaluga_classic, pseudo('freestyleuse')), B + 10, 'le classement historique');
  assert.equal(scoreDe(c.kaluga_freestyle, pseudo('freestyleuse')), B + 10, 'et le freestyle');

  // Témoin 9 = 8|1 : une Atomique (2560 points) est passée — freestyle intact.
  r = await enregistrer(sid, B + 50, '4:9');
  assert.equal(r.ok, true);
  c = await cuves();
  assert.equal(scoreDe(c.kaluga_classic, pseudo('freestyleuse')), B + 50, 'le record général monte');
  assert.equal(scoreDe(c.kaluga_freestyle, pseudo('freestyleuse')), B + 10, 'le freestyle ne bouge pas');

  // Plus de fruit défendu : la partie n'est plus classée — freestyle non plus.
  r = await enregistrer(sid, B + 90, '4:0');
  c = await cuves();
  assert.equal(scoreDe(c.kaluga_classic, pseudo('freestyleuse')), B + 50, 'le quota tient le général');
  assert.equal(scoreDe(c.kaluga_freestyle, pseudo('freestyleuse')), B + 10, 'et tient le freestyle du même verdict');
});

test('le témoin en dessous du seuil : une Mega (1280 points) reste du freestyle', async () => {
  const sid = await sidFor(pseudo('megajoueuse'));
  // 7 = 4|2|1 : des grappes jusqu'à la Mega — toutes sous 2000 points.
  await enregistrer(sid, B + 25, '2:7');
  const c = await cuves();
  assert.equal(scoreDe(c.kaluga_freestyle, pseudo('megajoueuse')), B + 25,
    'des tailles toutes < 8 gardent le OU < 8');
});

test('les données d\'avant le patch sont inclassables en freestyle', async () => {
  const sid = await sidFor(pseudo('vieuxclient'));
  await enregistrer(sid, B + 30, 'tz=1');           // l'ancien format des tests
  const sid2 = await sidFor(pseudo('vieuxobjet'));
  await enregistrer(sid2, B + 40, '[object Object]'); // la sérialisation d'époque
  const c = await cuves();
  assert.equal(scoreDe(c.kaluga_classic, pseudo('vieuxclient')), B + 30, 'le général les garde');
  assert.equal(scoreDe(c.kaluga_classic, pseudo('vieuxobjet')), B + 40);
  assert.equal(scoreDe(c.kaluga_freestyle, pseudo('vieuxclient')), null, 'le freestyle n\'invente rien');
  assert.equal(scoreDe(c.kaluga_freestyle, pseudo('vieuxobjet')), null);
});

test('le mode Championnat (m=1) nourrit aussi le freestyle', async () => {
  const sid = await sidFor(pseudo('championne'));
  await enregistrer(sid, B + 15, '3:0', 1);
  const c = await cuves();
  assert.equal(scoreDe(c.kaluga_challenge, pseudo('championne')), B + 15, 'la cuve Championnat');
  assert.equal(scoreDe(c.kaluga_freestyle, pseudo('championne')), B + 15, 'et le freestyle');
});

// ── Le Club (bureau) : l'onglet piloté serveur ────────────────────────────

test('le freestyle vit dans les records, pas dans le tableau des scores', async () => {
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  // La cuve existe (c'est elle que le livre des records et /api/club/records
  // itèrent) …
  assert.match(src, /kaluga_freestyle:\s+\{ name: 'Kaluga - Freestyle',\s+game: 'kaluga',\s+type: 'L' \}/,
    'la cuve dans RANKINGS');
  // … mais AUCUNE ligne de la table du bureau ne la porte : décision
  // d'exploitation, pour garder le tableau des scores lisible pendant
  // l'animation des classements pilotes.
  assert.doesNotMatch(src, /\{ rk: '\d+', internal: 'kaluga_freestyle'/,
    'pas d\'onglet dans le tableau des scores du bureau');
  // La preuve par l'usage : les scores freestyle sont bien là où on les
  // attend — au livre des records — même sans onglet au bureau.
  const c = await cuves();
  assert.ok(c.kaluga_freestyle, 'la cuve répond toujours à /api/club/records');
  // La section L échappe à la remise à zéro quotidienne (et à ses médailles) ;
  // en section C, deux exclus explicites — le proxy bkiwi et Mini-Fever, le
  // record permanent affiché sous Challenge.
  assert.match(src, /section === 'C' && r\.internal\s*&& r\.internal !== 'bkiwi_track5_classic' && r\.internal !== 'minifever_arcade'/,
    'DAILY_RESET_RANKING_SET ne prend que la section C');
});

test('l\'affichage du tzongre comprend le nouveau format « tz:g »', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.match(src, /rankingId === 'kaluga_classic' \|\| rankingId === 'kaluga_freestyle'\n\s*\|\| rankingId === 'kaluga_challenge'/,
    'les trois cuves kaluga partagent le rendu');
  assert.match(src, /const KALUGA_GRAPPE_SEUIL = 8;/, 'le seuil : taille 8 = 2560 points');
  assert.match(src, /function parseKalugaGrappe\(raw\)/, 'et son lecteur');
});

// ── Le SWF : le témoin est bien embarqué ──────────────────────────────────

test('full.swf patché : gOr accumulé dans la classe des grappes et envoyé par saveScore', () => {
  const raw = fs.readFileSync(path.join(ROOT, 'Games/kaluga/full.swf'));
  const body = raw.slice(0, 3).toString('ascii') === 'CWS'
    ? zlib.inflateSync(raw.slice(8)) : raw.slice(8);
  // Les deux classes patchées portent l'entrée de pool « gOr » ; le
  // séparateur « : » est celui de la donnée « tz:g ».
  let gOr = 0, pos = -1;
  while ((pos = body.indexOf(Buffer.from('gOr\0', 'latin1'), pos + 1)) >= 0) gOr++;
  assert.equal(gOr, 2, 'gOr dans la classe des grappes ET dans kaluga.Game');
  // Et le patch est rejouable sans casse (idempotent) : la présence du témoin
  // suffit à le prouver, le script se relance en « déjà corrigé ».
  const script = fs.readFileSync(path.join(ROOT, 'scripts/patch-kaluga-grappe.js'), 'utf8');
  assert.match(script, /déjà corrigé/, 'le script sait se reconnaître');
  assert.match(script, /jeu\.gOr = jeu\.gOr \| this\.grappe/, 'l\'accumulateur documenté');
});
