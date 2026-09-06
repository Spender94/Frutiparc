/*
 * Kaluga « Freestyle » — jouer SANS grappe, et être classé pour ça.
 *
 * Réaliser une grosse grappe tient souvent de la chance (les bons papillons au
 * bon moment) et rapporte énormément : une grappe de taille k vaut
 * 2^min(11,k) × 10 points — 1280 pour la Mega (k=7), 2560 pour l'Atomique
 * (k=8), 20480 pour la Maestro. Des joueurs s'en affranchissent : ils ont
 * leurs tableaux.
 *
 * LA RÈGLE DE PARTAGE : dès qu'une grappe de PLUS DE MILLE POINTS est passée
 * dans la partie (la Mega, taille 7), la partie est « à grappe » ; sinon elle
 * est freestyle. Deux témoins la portent, dans la donnée de score :
 *   · « tz:g » — le disque Flash rustiné (scripts/patch-kaluga-grappe.js) :
 *     g est le OU binaire des tailles encaissées. Il ne sait pas dire « une
 *     grappe de sept » (3|4 fait sept aussi) ; ce qu'il certifie exactement,
 *     c'est « une taille ≥ 8 » — sa marche reste donc l'Atomique (2560) ;
 *   · « tz:g:max » — le portage : la PLUS GROSSE grappe, telle quelle. Lui
 *     se lit à la taille près.
 *
 * Et deux étages de classement :
 *   · le DÉFI DU JOUR se partage en deux tableaux, section C tous les deux
 *     (remise à zéro chaque nuit, médailles, quota FD) : kaluga_classic, le
 *     tableau Grappe — celui d'avant le partage — et kaluga_freestyle_classic ;
 *     c'est routeRankingForSave qui aiguille, d'après kalugaAvecGrappe ;
 *   · le RECORD permanent kaluga_freestyle (section L, comme kaluga_challenge
 *     pour le jeu à grappe), nourri par toute partie certifiée sans grappe —
 *     du défi du jour Freestyle ou du Championnat (m=1). Une donnée muette
 *     (vieux SWF, vieux format) reste au tableau Grappe et ne certifie rien.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3428;
const BASE = `http://127.0.0.1:${PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let serverProc;
before(async () => {
  serverProc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      XMLSOCKET_PORT: '5252', FRUTISCORE_PORT: '5253',
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

test('une partie sans grappe va au défi Freestyle (et au record) ; une partie à grappe au tableau Grappe', async () => {
  const sid = await sidFor(pseudo('freestyleuse'));

  // Témoin 0 : aucune grappe — le défi du jour Freestyle ET le record permanent,
  // et RIEN au tableau Grappe : c'est un partage, pas un doublon.
  let r = await enregistrer(sid, B + 10, '4:0');
  assert.equal(r.ok, true, 'le score passe');
  assert.equal(r.rankingId, 'kaluga_freestyle_classic', 'aiguillé vers le défi Freestyle');
  let c = await cuves();
  assert.ok(c.kaluga_freestyle_classic, 'le défi du jour Freestyle existe');
  assert.equal(c.kaluga_freestyle_classic.name, 'Kaluga - Freestyle');
  assert.equal(c.kaluga_classic.name, 'Kaluga - Grappe', 'et le tableau d’avant s’appelle par son nom');
  assert.equal(scoreDe(c.kaluga_freestyle_classic, pseudo('freestyleuse')), B + 10, 'le défi Freestyle');
  assert.equal(scoreDe(c.kaluga_freestyle, pseudo('freestyleuse')), B + 10, 'et le record permanent');
  assert.equal(scoreDe(c.kaluga_classic, pseudo('freestyleuse')), null, 'rien au tableau Grappe');

  // Témoin 9 = 8|1 : une Atomique (2560 points) est passée — tableau Grappe,
  // et les deux cuves freestyle ne bougent pas.
  r = await enregistrer(sid, B + 50, '4:9');
  assert.equal(r.ok, true);
  assert.equal(r.rankingId, 'kaluga_classic', 'aiguillé vers le tableau Grappe');
  c = await cuves();
  assert.equal(scoreDe(c.kaluga_classic, pseudo('freestyleuse')), B + 50, 'le tableau Grappe');
  assert.equal(scoreDe(c.kaluga_freestyle_classic, pseudo('freestyleuse')), B + 10, 'le défi Freestyle ne bouge pas');
  assert.equal(scoreDe(c.kaluga_freestyle, pseudo('freestyleuse')), B + 10, 'le record non plus');

  // Plus de fruit défendu : la partie n'est plus classée — nulle part. C'est
  // aussi la preuve que le défi Freestyle est RATIONNÉ comme l'autre : sans
  // portillon, ce troisième score serait passé.
  r = await enregistrer(sid, B + 90, '4:0');
  c = await cuves();
  assert.equal(scoreDe(c.kaluga_freestyle_classic, pseudo('freestyleuse')), B + 10, 'le quota tient le défi Freestyle');
  assert.equal(scoreDe(c.kaluga_classic, pseudo('freestyleuse')), B + 50, 'et le tableau Grappe');
  assert.equal(scoreDe(c.kaluga_freestyle, pseudo('freestyleuse')), B + 10, 'et le record, du même verdict');
});

test('le OU du disque Flash : une Mega (7 = 4|2|1) reste du freestyle, il ne sait pas mieux', async () => {
  const sid = await sidFor(pseudo('megajoueuse'));
  // 7 = 4|2|1 : des tailles toutes < 8 gardent le OU < 8 — le disque ne peut
  // pas distinguer « une Mega » de « une Grappe et une Grosse-grappe ».
  const r = await enregistrer(sid, B + 25, '2:7');
  assert.equal(r.rankingId, 'kaluga_freestyle_classic');
  const c = await cuves();
  assert.equal(scoreDe(c.kaluga_freestyle_classic, pseudo('megajoueuse')), B + 25);
  assert.equal(scoreDe(c.kaluga_freestyle, pseudo('megajoueuse')), B + 25);
});

test('le portage dit LA PLUS GROSSE grappe : la taille 7 est du Grappe, la 6 du Freestyle — quoi que dise le OU', async () => {
  // « tz:g:max » — le troisième champ est le maximum, et c'est lui qui tranche.
  const sid = await sidFor(pseudo('portageuse'));
  let r = await enregistrer(sid, B + 60, '0:7:7');            // une Mega : 1280 > 1000
  assert.equal(r.rankingId, 'kaluga_classic', 'taille 7 → tableau Grappe');
  // OU = 12 (8|4) ferait croire à une Atomique ; le maximum, lui, dit 6 : que
  // des grappes de 640 au plus — freestyle.
  r = await enregistrer(sid, B + 61, '0:12:6');
  assert.equal(r.rankingId, 'kaluga_freestyle_classic', 'taille 6 → défi Freestyle, le maximum l’emporte sur le OU');
  const c = await cuves();
  assert.equal(scoreDe(c.kaluga_classic, pseudo('portageuse')), B + 60);
  assert.equal(scoreDe(c.kaluga_freestyle_classic, pseudo('portageuse')), B + 61);
  assert.equal(scoreDe(c.kaluga_freestyle, pseudo('portageuse')), B + 61, 'et le record permanent suit');
});

test('les données d\'avant le patch sont inclassables en freestyle', async () => {
  const sid = await sidFor(pseudo('vieuxclient'));
  await enregistrer(sid, B + 30, 'tz=1');           // l'ancien format des tests
  const sid2 = await sidFor(pseudo('vieuxobjet'));
  await enregistrer(sid2, B + 40, '[object Object]'); // la sérialisation d'époque
  const c = await cuves();
  // Sans témoin, on ne certifie rien : la partie reste au tableau Grappe —
  // celui d'avant le partage —, et le freestyle (défi comme record) n'invente rien.
  assert.equal(scoreDe(c.kaluga_classic, pseudo('vieuxclient')), B + 30, 'le tableau Grappe les garde');
  assert.equal(scoreDe(c.kaluga_classic, pseudo('vieuxobjet')), B + 40);
  assert.equal(scoreDe(c.kaluga_freestyle_classic, pseudo('vieuxclient')), null, 'le défi Freestyle n\'invente rien');
  assert.equal(scoreDe(c.kaluga_freestyle_classic, pseudo('vieuxobjet')), null);
  assert.equal(scoreDe(c.kaluga_freestyle, pseudo('vieuxclient')), null, 'le record non plus');
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
  assert.doesNotMatch(src, /\{ rk: '\d+', internal: 'kaluga_freestyle',/,
    'pas d\'onglet dans le tableau des scores du bureau');
  // Le DÉFI DU JOUR Freestyle, lui, a son onglet — rk '17', section C, le
  // gabarit du tzongre et la jaquette de Kaluga, comme le tableau Grappe.
  assert.match(src, /\{ rk: '17', internal: 'kaluga_freestyle_classic', ty: 'point', rn: 'Kaluga freestyle', gs: '4', g: 'kaluga', section: 'C' \}/,
    'le défi Freestyle a son onglet au bureau');
  assert.match(src, /\{ rk: '4', internal: 'kaluga_classic',\s+ty: 'point',\s+rn: 'Kaluga grappe', gs: '4', g: 'kaluga', section: 'C' \}/,
    'et le tableau d’avant dit maintenant « grappe »');
  // La preuve par l'usage : les scores freestyle sont bien là où on les
  // attend — au livre des records — même sans onglet au bureau.
  const c = await cuves();
  assert.ok(c.kaluga_freestyle, 'la cuve répond toujours à /api/club/records');
  // La section L échappe à la remise à zéro quotidienne (et à ses médailles) ;
  // en section C, un seul exclu — le proxy bkiwi, qui ferait doublon avec les
  // vrais classements par circuit.
  assert.match(src, /section === 'C' && r\.internal\s*&& r\.internal !== 'bkiwi_track5_classic'\)/,
    'DAILY_RESET_RANKING_SET ne prend que la section C');
});

test('l\'affichage du tzongre comprend les deux formats « tz:g » et « tz:g:max »', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.match(src, /if \(\/\^kaluga_\/\.test\(rankingId\)\) \{\n\s*\/\/ La donnée du SWF patché/,
    'les quatre cuves kaluga partagent le rendu');
  assert.match(src, /const paire = raw\.match\(\/\^\(-\?\\d\+\):\(\\d\+\)\(\?::\(\\d\+\)\)\?\$\/\);/,
    'et lisent le troisième champ');
  // Les deux marches : sept pour le maximum (le portage), huit pour le OU (le
  // disque Flash, qui ne sait pas mieux).
  assert.match(src, /const KALUGA_GRAPPE_TAILLE = 7;/, 'la Mega : plus de mille points');
  assert.match(src, /const KALUGA_GRAPPE_SEUIL = 8;/, 'ce que le OU certifie');
  assert.match(src, /function kalugaAvecGrappe\(raw\)/, 'et le juge');
  assert.match(src, /if \(t\.max !== null\) return t\.max >= KALUGA_GRAPPE_TAILLE;\n\s*return t\.ou >= KALUGA_GRAPPE_SEUIL;/,
    'le maximum d’abord, le OU à défaut');
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
