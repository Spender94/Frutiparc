/*
 * LES LOGS SE REFERMENT DANS L'APPLI iOS.
 *
 * « Sur l'application mobile (iOS) y'a pas moyen de fermer les logs sans
 *   quitter l'appli. »
 *
 * Les logs d'un salon (« … voir les messages précédents … », /log, /logs,
 * /chatlog, /chatlogs, /histo) s'ouvraient par `window.open` — une fenêtre à
 * part. L'appli de l'écran d'accueil (manifest `display: standalone`) n'a ni
 * onglets, ni barre d'adresse, ni bouton retour : la page des logs y
 * recouvrait le chat, et elle-même n'offrait aucune croix. Seule issue : tuer
 * l'appli.
 *
 * Désormais :
 *   · hors du bureau d'un vrai navigateur, les logs s'ouvrent dans une
 *     FEUILLE du light (un cadre), dont la croix reste sous la zone sûre ;
 *     Échap la referme, depuis la page comme depuis le cadre ;
 *   · la page des logs, ouverte seule, porte sa propre croix « Fermer »
 *     (fenêtre à part : elle se ferme ; page qui a pris la place de l'appli :
 *     retour, ou le chat).
 *
 * La partie Chromium joue un iPhone 13 en appli installée
 * (`navigator.standalone`, `display-mode: standalone`) ; sans Playwright,
 * elle est sautée.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const LIGHT = fs.readFileSync(path.join(ROOT, 'public', 'light.html'), 'utf8');
const SRV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

// ── 1. Le source ────────────────────────────────────────────────────────────

test('light : window.open seulement sur le bureau d\'un navigateur, la feuille partout ailleurs', () => {
  const i = LIGHT.indexOf('function ouvrirLogs(room) {');
  const corps = LIGHT.slice(i, LIGHT.indexOf('\n  }\n', i));
  assert.match(corps, /if \(surBureau && !estInstallee\(\)\) \{\s*window\.open\(url, "fp_histo"/);
  assert.match(corps, /ouvrirFeuilleLogs\(url, room\);/);
  // La feuille : sa croix, son cadre, et la zone sûre de l'encoche.
  assert.match(LIGHT, /<div id="logs-sheet" class="sheet sheet-logs" role="dialog"/);
  assert.match(LIGHT, /<button type="button" id="logs-sheet-close" aria-label="Fermer les logs"/);
  assert.match(LIGHT, /<iframe id="logs-cadre"/);
  assert.match(LIGHT, /\.sheet\.sheet-logs \{[^}]*max-height: calc\(var\(--app-h, 100dvh\) - env\(safe-area-inset-top, 0px\) - 12px\)/);
  // Échap, et le relais du cadre.
  assert.match(LIGHT, /ev\.key === "Escape" && \$\("#logs-sheet"\)\.classList\.contains\("show"\)/);
  assert.match(LIGHT, /ev\.data\.fpLogs !== "fermer"/);
});

test('serveur : la page des logs a sa croix, et la cède à la feuille dans un cadre', () => {
  const i = SRV.indexOf("app.get('/api/chat/histo'");
  const route = SRV.slice(i, SRV.indexOf('\n});\n', i));
  assert.match(route, /<button type="button" class="fermer" id="fermer"/);
  assert.match(route, /top: max\(8px, calc\(env\(safe-area-inset-top, 0px\) \+ 6px\)\)/);
  assert.match(route, /viewport-fit=cover/);
  assert.match(route, /html\[data-cadre\] \.fermer \{ display: none; \}/);
  assert.match(route, /window\.parent\.postMessage\(\{ fpLogs: 'fermer' \}, location\.origin\)/);
  assert.match(route, /location\.replace\('\/light'\)/);
});

// ── 2. Pour de vrai : un iPhone, l'appli installée ──────────────────────────

const PORT = 3881;
const BASE = `http://127.0.0.1:${PORT}`;
const RUN = Date.now().toString(36).slice(-5);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let proc = null;

function playwright() {
  for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(p); } catch { /* suivant */ }
  }
  return null;
}
const PW = playwright();

before(async () => {
  if (!PW) return;
  proc = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', ADMIN_KEY: 'cle-de-test-logs-ios',
      XMLSOCKET_PORT: '5881', FRUTISCORE_PORT: '5882',
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

test('iPhone 13, appli installée : /logs ouvre une feuille qui se referme (croix, Échap, Échap dans le cadre)', async (t) => {
  if (!PW) return t.skip('Playwright absent');
  const pseudo = 'ios' + RUN;
  const body = JSON.stringify({ username: pseudo, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const j = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).json();
  assert.ok(j.sid, 'session');

  const browser = await PW.chromium.launch();
  try {
    const ctx = await browser.newContext({ ...PW.devices['iPhone 13'] });
    // L'appli de l'écran d'accueil, telle que le light la reconnaît (estInstallee).
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, 'standalone', { get: () => true });
      const mm = window.matchMedia.bind(window);
      window.matchMedia = (q) => (/display-mode:\s*standalone/.test(q)
        ? { matches: true, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }
        : mm(q));
    });
    const page = await ctx.newPage();
    const fenetres = [];
    page.on('popup', (p) => fenetres.push(p.url()));
    await page.goto(`${BASE}/light?sid=${j.sid}`);
    await page.waitForSelector('#compose-input', { state: 'visible', timeout: 15000 });

    const ouverte = () => page.evaluate(() => document.querySelector('#logs-sheet').classList.contains('show'));
    async function taper(cmd) {
      await page.fill('#compose-input', cmd);
      await page.press('#compose-input', 'Enter');
      await page.waitForFunction(() => document.querySelector('#logs-sheet').classList.contains('show'));
    }

    // 1. /logs → la feuille, pas de fenêtre à part ; la croix est À L'ÉCRAN.
    await taper('/logs');
    assert.strictEqual(fenetres.length, 0, 'aucune fenêtre à part');
    // La feuille a fini de glisser (0,25 s) : on la mesure en place.
    await page.waitForFunction(() => /^(none|matrix\(1, 0, 0, 1, 0, 0\))$/
      .test(getComputedStyle(document.querySelector('#logs-sheet')).transform));
    const geo = await page.evaluate(() => {
      const b = document.querySelector('#logs-sheet-close').getBoundingClientRect();
      const x = b.left + b.width / 2, y = b.top + b.height / 2;
      return { top: b.top, bas: b.bottom, droite: b.right, l: innerWidth, h: innerHeight,
        dessus: document.elementFromPoint(x, y) === document.querySelector('#logs-sheet-close'),
        src: document.querySelector('#logs-cadre').getAttribute('src') };
    });
    assert.ok(geo.top >= 12 && geo.bas <= geo.h && geo.droite <= geo.l, 'la croix est dans l\'écran : ' + JSON.stringify(geo));
    assert.ok(geo.dessus, 'et rien ne la recouvre');
    assert.match(geo.src, /^\/api\/chat\/histo\?sid=[0-9a-f]+&g=[^&]+&cadre=1$/);
    const cadre = page.frames().find((f) => f.url().includes('/api/chat/histo'));
    await cadre.waitForSelector('.fenetre');
    assert.deepStrictEqual(await cadre.evaluate(() => [
      document.documentElement.hasAttribute('data-cadre'),
      getComputedStyle(document.getElementById('fermer')).display,
    ]), [true, 'none'], 'dans le cadre, la croix est celle de la feuille');

    // 2. Échap depuis la page.
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#logs-sheet').classList.contains('show'));
    assert.strictEqual(await page.evaluate(() => document.querySelector('#logs-cadre').getAttribute('src')), 'about:blank',
      'le cadre se vide');

    // 3. Échap depuis le cadre (la touche y reste, il la relaie).
    await taper('/chatlog');
    const cadre2 = page.frames().find((f) => f.url().includes('/api/chat/histo'));
    await cadre2.waitForSelector('.corps');
    await cadre2.click('.corps');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#logs-sheet').classList.contains('show'));

    // 4. La croix, au doigt — et l'on est toujours dans l'appli.
    await taper('/log');
    await page.tap('#logs-sheet-close');
    await page.waitForFunction(() => !document.querySelector('#logs-sheet').classList.contains('show'));
    assert.strictEqual(await ouverte(), false);
    assert.match(page.url(), /\/light\?sid=/, 'on n\'a pas quitté le chat');
    assert.strictEqual(fenetres.length, 0);

    // 5. La page des logs seule (une fenêtre restée d'avant, un lien d'époque) :
    // sa croix est visible, sous l'encoche, et ramène au chat.
    const seule = await ctx.newPage();
    await seule.goto(`${BASE}/light?sid=${j.sid}`);
    await seule.goto(`${BASE}/api/chat/histo?sid=${j.sid}&g=pomme`);
    const croix = await seule.evaluate(() => {
      const b = document.getElementById('fermer').getBoundingClientRect();
      return { vue: getComputedStyle(document.getElementById('fermer')).display !== 'none',
        top: b.top, droite: b.right, l: innerWidth };
    });
    assert.ok(croix.vue && croix.top >= 8 && croix.droite <= croix.l, 'la croix de la page seule : ' + JSON.stringify(croix));
    await seule.tap('#fermer');
    await seule.waitForURL(/\/light\?sid=/);
  } finally {
    await browser.close();
  }
});
