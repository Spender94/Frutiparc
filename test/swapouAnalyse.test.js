'use strict';
/*
 * L'IA DE SWAPOU — L'ANALYSE EN PARTIE, ACCORDÉE PAR L'ADMIN
 * ═══════════════════════════════════════════════════════════
 *
 * Le module d'analyse (public/swapou/analyse.js) dit le meilleur coup du mode
 * Challenge, sa nature — combo, coup silencieux, défense — et sa raison. Ses
 * propres tests (public/swapou/analyse.test.js) répondent de ce qu'il décide ;
 * ceux-ci verrouillent le BRANCHEMENT :
 *
 *   · l'option `swapouAnalyse` existe côté serveur SANS numéro d'article —
 *     elle ne se vend pas, ne se liste pas, et l'admin l'accorde par la même
 *     route que les options de la boutique ;
 *   · `/api/features` la rend au client — y compris sans testeur nommé, ce
 *     qui n'était pas le cas des options de la table (elle n'itérait que les
 *     testeurs) ;
 *   · le client ne la montre qu'en Challenge, dans un Worker, et jette une
 *     réponse arrivée après le coup suivant ;
 *   · la fiche joueur de l'admin porte l'interrupteur.
 *
 * Le joueur assisté joue au classement comme les autres : c'est voulu, le
 * temps des essais.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SERVEUR = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const JEU = fs.readFileSync(path.join(ROOT, 'public/swapou/game.js'), 'utf8');
const ADMIN = fs.readFileSync(path.join(ROOT, 'public/admin.html'), 'utf8');
const WORKER = fs.readFileSync(path.join(ROOT, 'public/swapou/analyse.worker.js'), 'utf8');
const ANALYSE = fs.readFileSync(path.join(ROOT, 'public/swapou/analyse.js'), 'utf8');

test('l’option existe, sans article de boutique', () => {
  assert.match(SERVEUR, /swapouAnalyse: \{\s*\n\s*name: 'IA de Swapou',\s*\n\s*label: 'analyse en partie de Swapou',\s*\n\s*\},/);
  // Pas de shopId : la table des articles ne la connaît pas…
  const bloc = SERVEUR.slice(SERVEUR.indexOf('swapouAnalyse: {'), SERVEUR.indexOf('label: \'analyse en partie de Swapou\''));
  assert.ok(!/shopId|price/.test(bloc), 'l’IA n’a ni numéro d’article ni prix');
  assert.match(SERVEUR, /Object\.entries\(GAME_FEATURES\)\.filter\(\(\[, v\]\) => v\.shopId\)\.map\(\(\[k, v\]\) => \[v\.shopId, k\]\)\);/,
    'seules les options vendues entrent dans la table par numéro d’article');
  // …et la rubrique Packs non plus.
  const packs = SERVEUR.slice(SERVEUR.indexOf('const SHOP_GAME_PACKS_DEFAULT = ['), SERVEUR.indexOf('// ── Feutres spéciaux'));
  assert.ok(!packs.includes('swapouAnalyse'), 'la rubrique Packs ne la vend pas');
});

test('/api/features rend toutes les options, pas seulement celles qui ont un testeur', () => {
  assert.match(SERVEUR, /const noms = new Set\(\[\.\.\.Object\.keys\(GAME_FEATURES\), \.\.\.Object\.keys\(FEATURE_TESTERS\)\]\);/);
  assert.match(SERVEUR, /for \(const name of noms\) out\[name\] = userHasFeature\(username, name\);/);
});

test('le client : Challenge seulement, dans un Worker, et rien de périmé', () => {
  assert.match(JEU, /function AnalyseChallenge\(game\) \{/);
  // Le mode : Challenge, pas Classique (qui partage le code).
  assert.match(JEU, /return SW\.Data\.gameMode === SW\.Data\.CHALLENGE\s*\n\s*&& !!\(c && c\.features && c\.features\.swapouAnalyse\)\s*\n\s*&& typeof Worker === 'function';/);
  // Le Worker, et son protocole numéroté.
  assert.match(JEU, /this\.worker = new Worker\('analyse\.worker\.js'\);/);
  assert.match(JEU, /if \(m\.id !== me\.serie\) return;\s*\/\/ périmée/);
  assert.match(WORKER, /importScripts\('engine\.js', 'bot\.js', 'analyse\.js'\);/);
  assert.match(WORKER, /self\.postMessage\(\{ id: m\.id, resultat: resultat \}\);/);
  // On demande quand le plateau est stable, on oublie dès qu'on joue.
  assert.match(JEU, /this\.analyse = AnalyseChallenge\.active\(\) \? new AnalyseChallenge\(this\) : null;\s*\n\s*if \(this\.analyse\) this\.analyse\.demander\(\);/);
  assert.match(JEU, /this\.interf\.pl\[0\]\.face\.setHappy\(D\.CHALLENGE_HAPPY_TIME\);\s*\n(?:\s*\/\/[^\n]*\n)*\s*if \(this\.analyse\) this\.analyse\.demander\(\);/);
  const oublis = (JEU.match(/if \(this\.analyse\) this\.analyse\.oublier\(\);/g) || []).length;
  assert.strictEqual(oublis, 2, 'l’échange ET la défense périment le conseil');
  assert.match(JEU, /if \(this\.analyse\) \{ this\.analyse\.destroy\(\); this\.analyse = null; \}/);
  // Dessiné par-dessus tout, sauf la pause.
  assert.match(JEU, /if \(this\.analyse\) this\.analyse\.draw\(ctx\);\s*\n\s*this\.drawExtra\(ctx\);/);
  // Le cadre sur la paire suit la géométrie du survol (U.Rollover.setPair).
  assert.match(JEU, /if \(p\.dy > 0\) \{ rot = 90; tx \+= D\.FRUIT_HEIGHT; \}/);
});

test('l’analyseur : tout le faisceau à deux coups, et les coups silencieux dans l’ordre', () => {
  // Les mesures ont renversé le plan : c'est la LARGEUR qui paie.
  assert.match(ANALYSE, /profondeur: 2,\s*\n\s*K1: 400,/);
  // Sous budget, combos et coups silencieux sont approfondis EN ALTERNANCE :
  // un tri à un coup les aurait tous mis derrière.
  assert.match(ANALYSE, /if \(i < combos\.length\) ordre\.push\(combos\[i\+\+\]\);\s*\n\s*if \(j < silencieux\.length\) ordre\.push\(silencieux\[j\+\+\]\);/);
  assert.match(ANALYSE, /if \(juges >= 8 && maintenant\(\) >= fin\) break;/);
  // Les quatre natures, et la règle de la préparation : elle bat le meilleur
  // combo ET elle prépare quelque chose.
  assert.match(ANALYSE, /out\.nature = \(c\.v > meilleurCombo && out\.suite && out\.suite\.score > 0\)\s*\n\s*\? 'preparation' : 'attente';/);
});

test('l’admin a l’interrupteur', () => {
  assert.match(ADMIN, /IA de Swapou \(analyse en partie\)/);
  assert.match(ADMIN, /JSON\.parse\(user\.owned_features\|\|'\[\]'\)\|\|\[\]\)\.indexOf\('swapouAnalyse'\)>=0/);
  assert.match(ADMIN, /async function adminGameFeature\(username, feature, owned\) \{/);
  assert.match(ADMIN, /\/game-feature`, \{ method: 'POST', headers: hdr\(\), body: JSON\.stringify\(\{ feature, owned \}\) \}\);/);
});

// ── Les décisions de l'analyseur, telles que ses propres tests les gardent ──
// public/swapou/*.test.js ne sont pas ramassés par `node --test test/` : on
// lance celui de l'analyseur d'ici, pour qu'une régression du module casse
// la suite du dépôt et pas seulement une commande qu'on oublie de taper.
test('les tests de l’analyseur passent (public/swapou/analyse.test.js)', () => {
  const { spawnSync } = require('node:child_process');
  const r = spawnSync(process.execPath, [path.join(ROOT, 'public/swapou/analyse.test.js')],
    { encoding: 'utf8', timeout: 120000 });
  assert.strictEqual(r.status, 0, 'analyse.test.js : ' + (r.stderr || r.stdout || '').trim().slice(-400));
  assert.match(r.stdout, /^OK — \d+ assertions \(analyse\)/m);
});

// ── Et en vrai : accordée par l'admin, rendue au client ─────────────────────
const PORT = 3431;
const BASE = `http://127.0.0.1:${PORT}`;
const CLE = 'cle-de-test';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let serverProc;
before(async () => {
  serverProc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
      ADMIN_KEY: CLE, XMLSOCKET_PORT: '5114', FRUTISCORE_PORT: '5115',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProc.stdout.on('data', () => {});
  serverProc.stderr.on('data', () => {});
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(BASE + '/api/loadFrutiSlots?game=snake3')).ok) return; } catch {}
    await wait(250);
  }
  throw new Error('serveur indisponible');
});
after(() => { if (serverProc) serverProc.kill('SIGKILL'); });

test('accordée à la main, l’option arrive au client — et repart', async () => {
  const body = JSON.stringify({ username: 'iaswapou', password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const login = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).json();
  assert.ok(login.sid, 'connexion');

  const lire = async () => (await (await fetch(BASE + '/api/features?sid=' + encodeURIComponent(login.sid))).json()).features;
  let f = await lire();
  assert.strictEqual(f.swapouAnalyse, false, 'inactive au départ, et bien PRÉSENTE dans la réponse');

  const admin = { 'Content-Type': 'application/json', 'X-Admin-Key': CLE };
  const donne = await fetch(BASE + '/api/admin/users/iaswapou/game-feature', {
    method: 'POST', headers: admin, body: JSON.stringify({ feature: 'swapouAnalyse', owned: true }),
  });
  assert.strictEqual(donne.status, 200, 'l’admin accorde (' + donne.status + ')');
  f = await lire();
  assert.strictEqual(f.swapouAnalyse, true, 'accordée → rendue au client');
  assert.strictEqual(f.swapouMoves, false, 'sans toucher aux autres options');

  const retire = await fetch(BASE + '/api/admin/users/iaswapou/game-feature', {
    method: 'POST', headers: admin, body: JSON.stringify({ feature: 'swapouAnalyse', owned: false }),
  });
  assert.strictEqual(retire.status, 200, 'l’admin retire');
  f = await lire();
  assert.strictEqual(f.swapouAnalyse, false, 'retirée → éteinte');
});
