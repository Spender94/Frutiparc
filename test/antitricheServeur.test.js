/*
 * L'anti-triche des portages, de bout en bout (serveur sans base).
 *
 * Les deux classements du challenge que le navigateur calculait seul ne
 * s'écrivent plus que par une partie REJOUÉE (antitricheLight.js) :
 *
 *   MiniPixiz — /api/minipixiz/arbre/partie (graine + jeton), puis
 *               /api/minipixiz/arbre/fin (score + journal) ;
 *   Mini-Fever — /api/minifever/partie, puis /api/minifever/score.
 *
 * Ce fichier vérifie qu'une partie honnête passe et se classe, et que les
 * formes que prend un score forgé — pas de jeton, jeton rejoué ou falsifié,
 * score impossible, journal retouché, partie rendue trop vite, porte générique
 * (saveScore, URL du SWF), fiche du bureau trafiquée — n'entrent pas au
 * classement.
 *
 * Les parties honnêtes sont jouées ici par le vrai moteur ; pour qu'elles
 * n'aient pas à durer leurs minutes réelles, le test signe lui-même un jeton
 * « donné il y a dix minutes », avec le secret qu'il passe au serveur
 * (ANTITRICHE_SECRET). Le jeton que le serveur donne, lui, sert à vérifier
 * qu'une partie rendue aussitôt est refusée.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3671;
const BASE = `http://127.0.0.1:${PORT}`;
const RUN = Date.now().toString(36).slice(-5);
const SECRET = 'banc-antitriche-' + RUN + '-0123456789';
const CLE = 'atl-' + RUN;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const AT = require(path.join(ROOT, 'antitricheLight.js'));
const A = require('./aideAntitriche.js');
AT.poserSecret(SECRET);

let proc = null;
let journal = '';
before(async () => {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      XMLSOCKET_PORT: '5741', FRUTISCORE_PORT: '5742', ADMIN_KEY: CLE, ANTITRICHE_SECRET: SECRET,
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', (d) => { journal += d.toString(); });
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(BASE + '/api/loadFrutiSlots?game=snake3')).ok) return; } catch { /* pas prêt */ }
    await wait(250);
  }
  throw new Error('serveur indisponible');
});
after(() => {
  if (proc) proc.kill('SIGKILL');
  try {
    const f = path.join(ROOT, 'data/scores.json');
    const d = JSON.parse(fs.readFileSync(f, 'utf8'));
    for (const u of Object.keys(d.users || {})) if (u.startsWith('atl')) delete d.users[u];
    fs.writeFileSync(f, JSON.stringify(d));
  } catch { /* rien à nettoyer */ }
});

const joueur = (base) => 'atl' + base + RUN;
async function sidPour(username) {
  const body = JSON.stringify({ username, password: 'secret123' });
  const h = { 'Content-Type': 'application/json' };
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: h, body });
  const j = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: h, body })).json();
  assert.ok(j.sid, 'connexion → sid');
  return j.sid;
}
const poster = (url, corps) => fetch(BASE + url, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps),
}).then(async (r) => Object.assign({ statut: r.status }, await r.json()));
async function classement(rk) {
  const j = await (await fetch(`${BASE}/api/light/challenge?limit=50`)).json();
  return (j.games || []).find((g) => g.id === rk) || { scores: [] };
}
const ligne = async (rk, u) => (await classement(rk)).scores.find((s) => String(s.user).toLowerCase() === u) || null;

// Un jeton « donné il y a `ilya` millisecondes », signé du même secret.
const jetonAncien = (jeu, username, ilya, mode, graine) =>
  AT.creerJeton({ jeu, username, mode: mode || 0, graine, t: Date.now() - ilya });

// ── MiniPixiz : l'Arbre creux ──────────────────────────────────────────────

test('arbre : le serveur donne graine et jeton, et refuse une partie rendue aussitôt', async () => {
  const u = joueur('ar');
  const sid = await sidPour(u);
  const p = await poster('/api/minipixiz/arbre/partie', { sid });
  assert.equal(p.ok, true);
  assert.ok(Number.isInteger(p.graine) && p.jeton, 'une graine et un jeton');
  const jeu = A.arbreHonnete(p.graine, 3);
  // Joué « en zéro seconde » : la partie dit trois minutes de jeu.
  const r = await poster('/api/minipixiz/arbre/fin', { sid, jeton: p.jeton, score: jeu.score, journal: jeu.journal });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'partie_refusee');
  assert.match(r.raison, /plus longue que le temps écoulé/);
  assert.equal(await ligne('minipixiz_classic', u), null, 'rien au classement');
});

test('arbre : une partie honnête se rejoue, se classe, et ne se rend qu\'une fois', async () => {
  const u = joueur('ah');
  const sid = await sidPour(u);
  const jeu = A.arbreHonnete(31337, 5);
  const p = jetonAncien('minipixiz', u, jeu.tempsJeuMs + 20000, 0, 31337);
  const r = await poster('/api/minipixiz/arbre/fin', { sid, jeton: p.jeton, score: jeu.score, journal: jeu.journal });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.verdict, 'conforme');
  assert.equal(r.score, jeu.score);
  assert.equal(r.rankingId, 'minipixiz_classic');
  assert.equal((await ligne('minipixiz_classic', u) || {}).score, jeu.score, 'le score est au challenge du jour');
  // Le MÊME jeton, une seconde fois.
  const bis = await poster('/api/minipixiz/arbre/fin', { sid, jeton: p.jeton, score: jeu.score, journal: jeu.journal });
  assert.equal(bis.ok, false);
  assert.equal(bis.error, 'jeton_deja_rendu');
});

test('arbre : score impossible, journal retouché, jeton absent ou falsifié — rien n\'entre', async () => {
  const u = joueur('af');
  const sid = await sidPour(u);
  const jeu = A.arbreHonnete(2024, 9);
  const neuf = () => jetonAncien('minipixiz', u, jeu.tempsJeuMs + 20000, 0, 2024).jeton;

  const impossible = await poster('/api/minipixiz/arbre/fin', { sid, jeton: neuf(), score: 999999, journal: jeu.journal });
  assert.equal(impossible.error, 'partie_refusee');
  assert.match(impossible.raison, /score rejoué/);

  const coupe = jeu.journal.slice(0, Math.floor(jeu.journal.length * 0.6));
  const retouche = await poster('/api/minipixiz/arbre/fin', { sid, jeton: neuf(), score: jeu.score, journal: coupe });
  assert.equal(retouche.error, 'partie_refusee');

  const sans = await poster('/api/minipixiz/arbre/fin', { sid, score: jeu.score, journal: jeu.journal });
  assert.equal(sans.error, 'partie_non_verifiee');

  const [corps] = neuf().split('.');
  const faux = await poster('/api/minipixiz/arbre/fin', { sid, jeton: corps + '.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', score: jeu.score, journal: jeu.journal });
  assert.equal(faux.error, 'jeton');
  assert.match(faux.raison, /falsifié/);

  // Le jeton d'un autre joueur.
  const autre = jetonAncien('minipixiz', joueur('zz'), jeu.tempsJeuMs + 20000, 0, 2024).jeton;
  const vole = await poster('/api/minipixiz/arbre/fin', { sid, jeton: autre, score: jeu.score, journal: jeu.journal });
  assert.equal(vole.error, 'jeton');

  assert.equal(await ligne('minipixiz_classic', u), null, 'rien au classement');
});

test('arbre : les portes génériques n\'écrivent plus le classement', async () => {
  const u = joueur('ag');
  const sid = await sidPour(u);
  // Le /api/saveScore du portage d'avant — une ligne de console.
  const r = await fetch(`${BASE}/api/saveScore?sid=${sid}&game=minipixiz&m=0&score=7400`);
  assert.equal(r.status, 400);
  const j = await r.json();
  assert.equal(j.error, 'partie_non_verifiee');
  // Le repli loadVariables des SWF — une URL à taper.
  const swf = await (await fetch(`${BASE}/swf/games/minipixiz/s99999?sid=${sid}`)).text();
  assert.match(swf, /ok=0/);
  // La fiche du bureau, au record trafiqué.
  const fiche = (treeMax) => JSON.stringify({
    $stat: { $item: [], $eat: [], $kill: [0, 0, 0, 0, 0], $run: 40,
      $game: [0, 0, 0, 0, 3], $forestMax: 5, $treeMax: treeMax, $misNum: 0 },
    $diam: 0, $key: 2, $star: 4, $bag: 2, $frog: false, $checkpoint: 0,
    $dungeon: { $lvl: 0, $f: false, $loop: 0, $day: 0 },
    $rainbow: { $f: false, $day: 0, $it: 0 }, $pond: { $q: 0, $d: 0, $fs: null },
    $faerie: [], $vs: 1.2, $inv: [], $current: null, $help: [true, true, true],
    $mis: [], $mission: [], $wind: 0, $god: [false, false, false],
    $time: { $t: Date.now(), $d: 3, $s: 21600000 },
  });
  const sauver = (t) => fetch(BASE + '/api/saveFrutiSlot', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sid, game: 'minipixiz', slotId: '0', data: fiche(t) }),
  }).then((x) => x.text());
  await sauver(2000);
  await sauver(150000);
  assert.equal(await ligne('minipixiz_classic', u), null, 'ni saveScore, ni l\'URL, ni la fiche ne classent');
  assert.match(journal, /sans partie vérifiable \(saveScore\)/, 'l\'essai est noté au journal');
  assert.match(journal, /sans partie vérifiable \(bureau\)/);
});

test('arbre : l\'admin peut rouvrir le pont du bureau (non vérifiable)', async () => {
  const hdr = { 'Content-Type': 'application/json', 'x-admin-key': CLE };
  const on = await (await fetch(BASE + '/api/admin/antitriche/bureau', { method: 'POST', headers: hdr, body: JSON.stringify({ on: true }) })).json();
  assert.equal(on.bureauAccepte, true);
  const u = joueur('ab');
  const sid = await sidPour(u);
  const fiche = (treeMax) => JSON.stringify({
    $stat: { $item: [], $eat: [], $kill: [0, 0, 0, 0, 0], $run: 4, $game: [0, 0, 0, 0, 3],
      $forestMax: 5, $treeMax: treeMax, $misNum: 0 },
    $diam: 0, $key: 2, $star: 4, $bag: 2, $frog: false, $checkpoint: 0,
    $dungeon: { $lvl: 0, $f: false, $loop: 0, $day: 0 }, $rainbow: { $f: false, $day: 0, $it: 0 },
    $pond: { $q: 0, $d: 0, $fs: null }, $faerie: [], $vs: 1.2, $inv: [], $current: null,
    $help: [true, true, true], $mis: [], $mission: [], $wind: 0, $god: [false, false, false],
    $time: { $t: Date.now(), $d: 3, $s: 21600000 },
  });
  for (const t of [2000, 5600]) {
    await fetch(BASE + '/api/saveFrutiSlot', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sid, game: 'minipixiz', slotId: '0', data: fiche(t) }) });
  }
  assert.equal((await ligne('minipixiz_classic', u) || {}).score, 5600, 'pont rouvert : le record du bureau se classe');
  await fetch(BASE + '/api/admin/antitriche/bureau', { method: 'POST', headers: hdr, body: JSON.stringify({ on: false }) });
});

// ── Mini-Fever : l'arcade ──────────────────────────────────────────────────

test('arcade : une partie honnête du vrai socle passe, au barème des victoires rejouées', async () => {
  const u = joueur('fh');
  const sid = await sidPour(u);
  const jeu = A.arcadeHonnete(4444, 1, 21);
  const p = jetonAncien('minifever', u, jeu.tempsJeuMs + 600000, 1, 4444);
  const r = await poster('/api/minifever/score', { sid, jeton: p.jeton, palier: 1,
    niveau: jeu.fin.niveau, jouees: jeu.fin.jouees, gagnee: jeu.fin.gagnee, journal: jeu.journal });
  if (jeu.fin.niveau > 0) {
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.verdict, 'conforme');
    assert.equal(r.score, jeu.fin.niveau * 10 * 2);
  } else {
    assert.equal(r.ok, false, 'aucune victoire : rien à classer');
  }
});

test('arcade : seules les victoires rejouées donnent points et pictos', async () => {
  const u = joueur('fc');
  const sid = await sidPour(u);
  const c = A.arcadeConstruite(9090, 0, 5);
  const p = jetonAncien('minifever', u, c.minimumMs + 60000, 0, 9090);
  const r = await poster('/api/minifever/score', Object.assign({ sid, jeton: p.jeton,
    // Le client d'avant envoyait la liste des épreuves gagnées : elle ne
    // compte plus — la clef inventée ne donne rien.
    gagnees: ['gameInexistant', 'gameTaquin'] }, c.corps));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.score, c.niveau * 10);
  const attendus = [...new Set(c.gagnees)];
  assert.equal(r.pictos.length, attendus.length, 'un picto par épreuve gagnée (et rejouée), pas plus');
  assert.equal((await ligne('minifever_arcade', u) || {}).score, c.niveau * 10);
  // Rendue deux fois : refusée.
  const bis = await poster('/api/minifever/score', Object.assign({ sid, jeton: p.jeton }, c.corps));
  assert.equal(bis.error, 'jeton_deja_rendu');
});

test('arcade : sans jeton, trop vite, retouchée ou sur un autre palier — refusée', async () => {
  const u = joueur('ff');
  const sid = await sidPour(u);
  const c = A.arcadeConstruite(7171, 0, 4);
  // La requête d'avant, à la main : trois nombres.
  const main = await poster('/api/minifever/score', { sid, palier: 3, niveau: 100, jouees: 100 });
  assert.equal(main.error, 'partie_non_verifiee');
  // Le jeton du serveur, rendu aussitôt : la partie demande ses minutes.
  const p = await poster('/api/minifever/partie', { sid, palier: 0 });
  assert.equal(p.ok, true);
  const c2 = A.arcadeConstruite(p.graine, 0, 3);
  const vite = await poster('/api/minifever/score', Object.assign({ sid, jeton: p.jeton }, c2.corps));
  assert.equal(vite.error, 'partie_refusee');
  assert.match(vite.raison, /trop vite|plus longue que le temps écoulé/);
  // Une défaite maquillée en victoire.
  const j = JSON.parse(JSON.stringify(c.corps.journal));
  const k = j.epreuves.findIndex((e) => !e.g);
  j.epreuves[k].g = 1;
  const t1 = jetonAncien('minifever', u, c.minimumMs + 60000, 0, 7171).jeton;
  const maquille = await poster('/api/minifever/score', Object.assign({}, c.corps,
    { sid, jeton: t1, journal: j, niveau: c.niveau + 1 }));
  assert.equal(maquille.error, 'partie_refusee');
  // Le jeton d'un AUTRE palier que celui de la partie rendue.
  const t2 = jetonAncien('minifever', u, c.minimumMs + 60000, 1, 7171).jeton;
  const palier = await poster('/api/minifever/score', Object.assign({}, c.corps, { sid, jeton: t2 }));
  assert.equal(palier.error, 'jeton');
  assert.equal(await ligne('minifever_arcade', u), null, 'rien au classement');
});

test('l\'audit (lecture seule) répond même sans base', async () => {
  const r = await (await fetch(BASE + '/api/admin/antitriche/audit?jours=7', { headers: { 'x-admin-key': CLE } })).json();
  assert.equal(r.ok, true);
  assert.ok(Array.isArray(r.suspects));
  assert.equal(r.sansBase, true);
  const refus = await fetch(BASE + '/api/admin/antitriche/audit');
  assert.equal(refus.status, 403, 'réservé à l\'admin');
});
