'use strict';
/*
 * LE FEUTRE MULTICOLORE, LISIBLE LA NUIT — POUR DE BON.
 *
 * Capture de l'admin : en mode nuit, chaque message au feutre multicolore
 * n'était plus qu'une barre de dégradé arc-en-ciel, sans un mot lisible. Le
 * correctif précédent (« éclairci sur le fond nuit ») avait reposé le dégradé
 * avec le RACCOURCI `background: linear-gradient(…)`. Or ce raccourci remet à
 * leur valeur initiale toutes les sous-propriétés qu'il ne nomme pas —
 * `background-clip` revient à `border-box`. Les lettres restaient
 * transparentes (`-webkit-text-fill-color`), et le dégradé, au lieu d'être
 * peint DANS les lettres, peignait toute la boîte.
 *
 * Deux endroits le faisaient, et le générateur en fabriquait un troisième :
 *   · scripts/nuit-retouches.css (le dégradé éclairci) ;
 *   · public/nuit.css engendré : la surcharge ne recopie que les déclarations
 *     COLORÉES d'une règle — le `background:`, pas le `background-clip` ;
 *   · la page des logs (/api/chat/histo) : le zébrage `.ligne:nth-child(even)`,
 *     plus spécifique que `.mc`, remettait le découpage à zéro une ligne sur
 *     deux — de jour comme de nuit. Et ses espaces s'y lisaient « &nbsp; ».
 *
 * Partie « navigateur » : Chromium par Playwright, s'il est là ; sinon sautée.
 * Partie « serveur vivant » : PostgreSQL de test (port 5433) ; sinon sautée.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const lire = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const NUIT = lire('public/nuit.css');
const RETOUCHES = lire('scripts/nuit-retouches.css');
const LIGHT = lire('public/light.html');
const SRV = lire('server.js');
const GEN = require('../scripts/generer-nuit.js');

// Les règles d'une feuille plate (pas d'@media autour de .mc-text) :
// [{ tete, decls: [[prop, valeur]…] }].
function regles(css) {
  const sans = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(sans))) {
    const decls = m[2].split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
      const i = d.indexOf(':');
      return [d.slice(0, i).trim().toLowerCase(), d.slice(i + 1).trim()];
    });
    out.push({ tete: m[1].trim(), decls });
  }
  return out;
}
const visent = (r, sel) => r.tete.split(',').map((s) => s.trim()).includes(sel);

// ── 1. Le générateur ────────────────────────────────────────────────────────

test('générateur : un `background:` coloré ne défait plus le background-clip de sa règle', () => {
  const sortie = GEN.surcharge(`.arc {
    background: linear-gradient(90deg, #FF6600, #6666CC);
    -webkit-background-clip: text; background-clip: text;
    -webkit-text-fill-color: transparent; color: transparent;
    font-weight: bold;
  }`);
  const r = regles(sortie).find((x) => x.tete === '.arc');
  assert.ok(r, 'la règle est surchargée');
  const props = r.decls.map((d) => d[0]);
  const fond = props.indexOf('background');
  assert.ok(fond >= 0, 'le dégradé est teint');
  assert.ok(props.indexOf('-webkit-background-clip') > fond, 'le découpage webkit suit le raccourci');
  assert.ok(props.indexOf('background-clip') > fond, 'le découpage standard suit le raccourci');
  assert.ok(!props.includes('font-weight'), 'le reste, sans couleur, n\'entre toujours pas');

  // Sans découpage dans la source, rien n'est ajouté.
  const simple = regles(GEN.surcharge('.boite { background: #FFFFFF; }'))[0];
  assert.deepStrictEqual(simple.decls.map((d) => d[0]), ['background']);
});

// ── 2. La feuille de nuit ───────────────────────────────────────────────────

test('nuit.css : aucune règle de .mc-text ne laisse le dégradé déborder des lettres', () => {
  // Le jour : le dégradé, puis le découpage au texte, dans la même règle.
  assert.match(LIGHT, /\.mc-text \{\s*background: linear-gradient\(90deg[^;]*\);\s*-webkit-background-clip: text; background-clip: text;/);
  // La nuit : on rejoue la cascade sur toutes les règles de .mc-text, dans
  // l'ordre de la feuille. Le dernier mot sur background-clip doit être `text`.
  let clip = 'text';         // celui du jour (light.html), chargé avant
  let image = null;
  for (const r of regles(NUIT).filter((x) => visent(x, '.mc-text'))) {
    for (const [p, v] of r.decls) {
      if (p === 'background') { clip = 'border-box'; image = v; }
      if (p === 'background-image') image = v;
      if (p === 'background-clip') clip = v;
    }
  }
  assert.strictEqual(clip, 'text', 'background-clip retombe à border-box : barres sans texte');
  assert.match(image, /^linear-gradient\(90deg, #FF8A3D, #FFD23F, #5BEB7A, #6FD6E8, #9D9DFF, #C98BFF, #FF9EE8\)$/,
    'c\'est bien l\'arc-en-ciel éclairci qui gagne');
  // Les retouches n'emploient plus le raccourci pour le multicolore.
  const ret = regles(RETOUCHES).filter((x) => visent(x, '.mc-text'));
  assert.ok(ret.length >= 1);
  for (const r of ret) {
    assert.ok(!r.decls.some(([p]) => p === 'background'), 'le raccourci `background` revient dans nuit-retouches.css');
  }
});

// ── 3. Le rendu, dans un vrai navigateur ────────────────────────────────────

function chromium() {
  for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(p).chromium; } catch { /* suivant */ }
  }
  return null;
}
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

function harnais(bureau) {
  const styles = [...LIGHT.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
  const ligne = '<div class="msg"><span class="time mc-text">[13:27:40] </span>'
    + '<span class="from mc-text">Sgrota : </span><span class="body mc-text">Bonjour en multicolore</span></div>';
  return `<!doctype html><html data-nuit="1"><head><meta charset="utf-8">
<style>${styles}</style><style>${lire('public/bureau-frutiz.css')}</style><style>${NUIT}</style></head>
<body class="${bureau ? 'bureau-frutiz' : ''}">${bureau ? '<div class="fen">' : ''}
<section class="panel" id="chat-panel"><div id="messages">${ligne}</div></section>
${bureau ? '</div>' : ''}</body></html>`;
}

test('navigateur : de nuit, le dégradé est découpé dans les lettres (salon light et bureau)', async (t) => {
  const c = chromium();
  if (!c || !fs.existsSync(CHROME)) return t.skip('Chromium/Playwright absent');
  const b = await c.launch({ executablePath: CHROME });
  try {
    const p = await b.newPage();
    for (const bureau of [false, true]) {
      await p.setContent(harnais(bureau));
      const styles = await p.$$eval('.mc-text', (els) => els.map((e) => {
        const s = getComputedStyle(e);
        return { clip: s.webkitBackgroundClip || s.backgroundClip, fill: s.webkitTextFillColor, image: s.backgroundImage };
      }));
      assert.strictEqual(styles.length, 3);
      for (const s of styles) {
        assert.strictEqual(s.clip, 'text', (bureau ? 'bureau' : 'light') + ' : le dégradé déborde des lettres');
        assert.strictEqual(s.fill, 'rgba(0, 0, 0, 0)');
        assert.match(s.image, /rgb\(255, 138, 61\)/, 'l\'arc-en-ciel éclairci de nuit');
      }
    }
  } finally { await b.close(); }
});

// ── 4. La page des logs ─────────────────────────────────────────────────────

test('logs : le dégradé vit dans un span intérieur, la page suit la nuit, &nbsp; redevient un espace', () => {
  const i = SRV.indexOf("app.get('/api/chat/histo'");
  const route = SRV.slice(i, SRV.indexOf('\n});\n', i));
  // Le dégradé n'est plus sur la ligne (que le zébrage repeint) mais dedans.
  assert.match(route, /\(l\.mc \? '<span class="arc">' \+ dedans \+ '<\/span>' : dedans\)/);
  assert.match(route, /\.mc \.arc \{\s*background-image: linear-gradient\(90deg, #FF6600/);
  assert.doesNotMatch(route, /\.mc \{\s*background:/, 'le raccourci sur .mc revient');
  // La nuit : même clé fp_nuit que le light, et l'arc-en-ciel éclairci.
  assert.match(route, /localStorage\.getItem\('fp_nuit'\)/);
  assert.match(route, /html\[data-nuit\] \.mc \.arc \{\s*background-image: linear-gradient\(90deg, #FF8A3D/);
  // Les entités du htmlText multicolore.
  assert.match(route, /replace\(\/&nbsp;\/gi, ' '\)/);
  assert.match(route, /cd \? texteMailLight\(corps\)/);
});

const PORT = 3653;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/frutiparc_mcnuit';
const RUN = Date.now().toString(36).slice(-5);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let proc = null, dispo = false;

async function baseNeuve() {
  let Client;
  try { ({ Client } = require(path.join(ROOT, 'node_modules', 'pg'))); } catch { return false; }
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
      ADMIN_KEY: 'cle-de-test-mc', XMLSOCKET_PORT: '5653', FRUTISCORE_PORT: '5654',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 160; i++) {
    try { if ((await fetch(BASE + '/do/prefdef')).ok) return; } catch { /* pas prêt */ }
    await wait(250);
  }
  throw new Error('serveur indisponible');
});

after(() => { if (proc) proc.kill('SIGKILL'); });

test('serveur vivant : trois lignes multicolores, toutes dans leur arc, sans « &nbsp; »', async (t) => {
  if (!dispo) return t.skip('pas de base PostgreSQL de test disponible');
  const pseudo = 'arc' + RUN;
  const body = JSON.stringify({ username: pseudo, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const j = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).json();
  assert.ok(j.sid);
  const r = await fetch(`${BASE}/api/admin/users/${pseudo}/feutre`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-key': 'cle-de-test-mc' },
    body: JSON.stringify({ kind: 'mc', owned: true }),
  });
  assert.strictEqual(r.status, 200, 'feutre multicolore accordé');
  const WebSocket = require(path.join(ROOT, 'node_modules', 'ws'));
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/`);
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  try {
    ws.send(`<k l="${pseudo}" s="${j.sid}" lc="1" />\0`);
    await wait(400);
    ws.send('<o g="pomme" />\0');
    await wait(400);
    for (const m of ['un deux', 'trois quatre', 'cinq &lt; six']) {
      ws.send(`<t g="pomme" t="m" p="mc">${m}</t>\0`);
      await wait(200);
    }
    await wait(400);
  } finally { ws.close(); }
  const page = await (await fetch(`${BASE}/api/chat/histo?sid=${j.sid}&g=pomme`)).text();
  const lignes = page.match(/<div class="ligne mc"><span class="arc">[^\n]*<\/span><\/div>/g) || [];
  assert.strictEqual(lignes.length, 3, 'les trois lignes, paires comprises, ont leur arc');
  assert.ok(!/&amp;nbsp;|&nbsp;/.test(lignes.join('')), 'plus de « &nbsp; » en toutes lettres');
  assert.ok(lignes[0].includes(':</b> un deux</span>'), lignes[0]);
  assert.ok(lignes[2].includes(':</b> cinq &lt; six</span>'), 'le < reste un caractère, échappé une fois : ' + lignes[2]);
});
