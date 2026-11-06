/*
 * LE FORUM EN FENÊTRE RÉDUITE.
 *
 * « Manque slidebar gauche droite quand la fenêtre forum est réduite ;
 *   lorsqu'on poste un message il n'y a pas tous nos accessoires car ils
 *   sont dans la partie cachée. »
 *
 * Deux causes, l'une sur l'autre :
 *   · la grille des bouilles du formulaire (huit vignettes de 80 px, 668 px
 *     d'un seul tenant) ne passait jamais à la ligne (`flex-wrap: nowrap`) ;
 *   · le cadre du forum (`.forum-shell`) était en `overflow: hidden` : ce qui
 *     dépassait était COUPÉ, sans barre de défilement.
 * À 800 px déjà, la dernière vignette tombait dans la partie coupée ; à
 * 480 px, trois. Et la rangée centrée des boutons (Envoyer, Prévisualiser…)
 * débordait des deux côtés sur un petit téléphone — « Envoyer » à gauche,
 * hors d'atteinte de tout défilement.
 *
 * La grille passe à la ligne, les boutons aussi, et le cadre ne coupe plus :
 * ce qui ne peut vraiment pas rétrécir fait défiler la PAGE de gauche à
 * droite.
 *
 * La partie Chromium n'a pas besoin de base : /api/forum/me répond sans
 * PostgreSQL (accessoires par défaut), et on lui ajoute dix accessoires pour
 * remplir la grille. Sans Playwright, elle est sautée.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PAGE = fs.readFileSync(path.join(ROOT, 'public', 'fb', 'index.html'), 'utf8');

// La règle CSS d'un sélecteur, telle qu'écrite dans le <style> du forum.
function regle(sel) {
  const i = PAGE.indexOf('\n  ' + sel + ' {');
  assert.ok(i > 0, 'la règle ' + sel + ' existe');
  return PAGE.slice(i, PAGE.indexOf('}', i));
}

test('source : la grille et les boutons passent à la ligne, le cadre ne coupe plus', () => {
  assert.match(regle('.bouille-grid'), /flex-wrap: wrap;/);
  assert.match(regle('.editor-actions'), /flex-wrap: wrap;/);
  const shell = regle('.forum-shell');
  assert.doesNotMatch(shell, /overflow/, 'plus d\'overflow: hidden sur le cadre');
  assert.match(shell, /display: flow-root;/, 'le cadre garde son contexte de bloc');
  // Ni le html ni le corps de la page n'interdisent le défilement horizontal.
  assert.doesNotMatch(PAGE, /(html|body)\s*\{[^}]*overflow(-x)?:\s*hidden/);
});

// ── Pour de vrai ────────────────────────────────────────────────────────────

const PORT = 3883;
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
      PORT: String(PORT), DATABASE_URL: '', ADMIN_KEY: 'cle-de-test-forum-reduit',
      XMLSOCKET_PORT: '5883', FRUTISCORE_PORT: '5884',
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

const NOMS = ['Chapeau pointu', 'Lunettes de soleil', 'Couronne', 'Bandeau', 'Moustache',
  'Casquette', 'Nœud papillon', 'Cornes', 'Auréole', 'Bonnet'];

test('Chromium : à 480, 640 et 800 px, de jour comme de nuit, chaque accessoire du formulaire est atteignable', async (t) => {
  if (!PW) return t.skip('Playwright absent');
  const pseudo = 'red' + RUN;
  const body = JSON.stringify({ username: pseudo, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  const j = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).json();
  assert.ok(j.sid, 'session');

  const browser = await PW.chromium.launch();
  try {
    for (const nuit of [false, true]) {
      for (const largeur of [480, 640, 800]) {
        const quand = (nuit ? 'nuit' : 'jour') + ' ' + largeur + ' px';
        const ctx = await browser.newContext({ viewport: { width: largeur, height: 800 } });
        if (nuit) await ctx.addInitScript(() => { try { localStorage.setItem('fp_nuit', '1'); } catch (e) { /* rien */ } });
        const page = await ctx.newPage();
        // Dix accessoires de plus : la grille a ses huit vignettes.
        await page.route('**/api/forum/me*', async (route) => {
          const d = await (await route.fetch()).json();
          d.accessories = NOMS.map((n, i) => ({ name: n, value: '000000010000000' + String(i + 1).padStart(2, '0') + '0000000' }));
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(d) });
        });
        await page.goto(`${BASE}/fb/?sid=${j.sid}`);
        await page.waitForFunction(() => typeof currentUser === 'string' && currentUser.length > 0);
        // L'accueil a fini de se charger : il ne viendra pas écraser le formulaire.
        await page.waitForFunction(() => document.getElementById('app').innerHTML.length > 0
          && !document.querySelector('#app .loading'));
        if (nuit) assert.ok(await page.evaluate(() => !!document.getElementById('nuit-css') || document.documentElement.hasAttribute('data-nuit')), quand + ' : la nuit est allumée');
        await page.evaluate(() => showNewTopicForm(1));
        await page.waitForSelector('.bouille-item');

        const m = await page.evaluate(() => {
          const shell = document.querySelector('.forum-shell').getBoundingClientRect();
          const items = [...document.querySelectorAll('.bouille-item')].map((it) => {
            const r = it.getBoundingClientRect();
            return { g: r.left, d: r.right };
          });
          const boutons = [...document.querySelectorAll('.editor-actions .edit-btn')].map((b) => {
            const r = b.getBoundingClientRect();
            return { g: r.left, d: r.right };
          });
          return { items, boutons, shellG: shell.left, shellD: shell.right, l: innerWidth,
            sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
        });
        assert.strictEqual(m.items.length, 8, quand + ' : huit vignettes');
        for (const it of m.items) {
          assert.ok(it.g >= m.shellG && it.d <= m.shellD + 0.5, quand + ' : vignette dans le cadre ' + JSON.stringify({ it, m: [m.shellG, m.shellD] }));
        }
        for (const b of m.boutons) {
          assert.ok(b.g >= 0 && b.d <= m.l, quand + ' : bouton à l\'écran ' + JSON.stringify(b));
        }
        assert.strictEqual(m.sw, m.cw, quand + ' : rien ne déborde, pas de défilement inutile');

        // On peut CLIQUER la dernière vignette (le dernier accessoire de la page).
        await page.locator('.bouille-item').last().click();
        assert.ok(await page.evaluate(() => {
          const r = document.querySelectorAll('.bouille-item .b-radio');
          return r[r.length - 1].checked;
        }), quand + ' : le dernier accessoire se choisit');

        // Ce qui ne peut VRAIMENT pas rétrécir fait défiler la page.
        const defile = await page.evaluate(() => {
          const large = document.createElement('div');
          large.style.cssText = 'width: 1400px; height: 20px';
          large.id = 'trop-large';
          document.getElementById('app').appendChild(large);
          const sw = document.documentElement.scrollWidth;
          window.scrollTo(sw, window.scrollY);
          const r = large.getBoundingClientRect();
          return { sw, cw: document.documentElement.clientWidth, x: window.scrollX, droite: r.right, l: innerWidth };
        });
        assert.ok(defile.sw > defile.cw, quand + ' : la page s\'élargit ' + JSON.stringify(defile));
        assert.ok(defile.x > 0 && defile.droite <= defile.l + 0.5, quand + ' : et défile jusqu\'au bout ' + JSON.stringify(defile));
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
  }
});
