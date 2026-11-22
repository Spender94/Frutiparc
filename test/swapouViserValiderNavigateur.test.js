/*
 * VISER PUIS VALIDER, AU VRAI DOIGT — Chromium tactile, en paysage et en
 * portrait.
 *
 * Les tests de swapouViserValider.test.js donnent leurs gestes au jeu en
 * coordonnées logiques. Ici, ce sont de vrais événements tactiles (le
 * protocole du navigateur : `isTrusted` est vrai) posés à l'ÉCRAN, et c'est
 * index.html qui les ramène dans le repère du jeu (toLogical) — y compris
 * quand le canevas pivote d'un quart de tour en portrait. Les points visés se
 * calculent sur le rectangle réellement affiché du canevas, pas avec les
 * formules de la page : si l'une ou l'autre se trompait, le doigt tomberait à
 * côté.
 *
 * On vérifie, dans les deux sens de l'écran : le premier appui vise sans
 * jouer ; le second (légèrement décalé, comme un vrai doigt) joue la même
 * ligne de journal qu'un clic ; un glissé franc vers la droite du JEU (vers
 * le bas de l'écran en portrait) échange d'un geste ; un glissé ramené au
 * point d'appui ne joue rien ; un second doigt posé pendant l'appui ne compte
 * pas ; l'option coupée rend l'échange au relâcher.
 *
 * Le serveur tourne sans base (DATABASE_URL vide) : la page de Swapou n'en a
 * pas besoin hors connexion. Sans Playwright, la partie est sautée.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 3986;
const BASE = `http://127.0.0.1:${PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let proc = null;

function playwright() {
  for (const p of ['playwright', '/opt/node-tools/node_modules/playwright', '/opt/node22/lib/node_modules/playwright']) {
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
      PORT: String(PORT), DATABASE_URL: '', ADMIN_KEY: 'cle-de-test-viser-valider',
      XMLSOCKET_PORT: '5986', FRUTISCORE_PORT: '5987',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 160; i++) {
    try { if ((await fetch(BASE + '/swapou/index.html')).ok) return; } catch { /* pas prêt */ }
    await wait(250);
  }
  throw new Error('serveur indisponible');
});

after(() => { if (proc) proc.kill('SIGKILL'); });

// La page, une partie de Challenge à graine fixe, et de quoi viser une case.
async function ouvrir(browser, largeur, hauteur, stockage) {
  const ctx = await browser.newContext({ viewport: { width: largeur, height: hauteur }, hasTouch: true, isMobile: true });
  if (stockage) {
    await ctx.addInitScript((s) => {
      try { for (const k of Object.keys(s)) localStorage.setItem(k, s[k]); } catch (e) { /* rien */ }
    }, stockage);
  }
  const page = await ctx.newPage();
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  await page.goto(BASE + '/swapou/index.html');
  await page.waitForFunction(() => window.SW && SW.Manager && SW.Manager.mode, null, { timeout: 30000 });
  await page.evaluate(() => {
    SW.Data.gameMode = SW.Data.CHALLENGE; SW.Data.essai = false; SW.Data.players = [0, -1];
    const ancien = SW.Manager.mode;
    SW.Manager.client.partie = { id: 'essai', graine: 4242 };
    SW.Manager.mode = new SW.Challenge();
    if (ancien && ancien.destroy) ancien.destroy();
  });
  await wait(600);
  const cdp = await ctx.newCDPSession(page);
  return { ctx, page, cdp, erreurs };
}

// Logique (700 × 480) → écran, d'après le rectangle AFFICHÉ du canevas. En
// portrait, le canevas pivote de 90° dans le sens horaire : le haut du jeu
// est à droite de l'écran, et l'axe x du jeu descend l'écran.
async function versEcran(page, lx, ly) {
  return page.evaluate(([lx, ly]) => {
    const r = document.getElementById('stage').getBoundingClientRect();
    if (innerHeight > innerWidth)
      return { x: r.right - ly * r.width / 480, y: r.top + lx * r.height / 700 };
    return { x: r.left + lx * r.width / 700, y: r.top + ly * r.height / 480 };
  }, [lx, ly]);
}
async function etat(page) {
  return page.evaluate(() => {
    const c = SW.Manager.mode;
    return {
      lock: c.lock, journal: c.journal.slice(),
      visee: SW.visee ? { x: SW.visee.x, y: SW.visee.y, dx: SW.visee.dx, dy: SW.visee.dy } : null,
      arme: c.interf.rollover.arme, visible: c.interf.rollover.visible,
    };
  });
}
// Une paire horizontale échangeable (du bas du plateau), et la case du dessus
// occupée — pour pouvoir glisser vers la droite d'une case pleine.
async function unePaire(page, saufX) {
  return page.evaluate((saufX) => {
    const c = SW.Manager.mode, lvl = c.player.level, i = c.player.animator.getInfos();
    for (let y = lvl.height - 1; y >= 0; y--)
      for (let x = 0; x < lvl.width - 1; x++) {
        if (x === saufX) continue;
        const f1 = lvl.getFruit(x, y), f2 = lvl.getFruit(x + 1, y);
        if (f1 && f2 && f1.canSwap() && f2.canSwap()) return { x, y, px: i.px, py: i.py };
      }
    return null;
  }, saufX === undefined ? -1 : saufX);
}
async function finDuTour(page) {
  await page.waitForFunction(() => !SW.Manager.mode.lock, null, { timeout: 20000 });
  await wait(100);
}
// Un geste au protocole du navigateur : des points d'écran, un doigt.
async function glisser(cdp, pts) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pts[0].x, y: pts[0].y, id: 1 }] });
  for (let i = 1; i < pts.length; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: pts[i].x, y: pts[i].y, id: 1 }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

for (const [nom, largeur, hauteur] of [['paysage', 844, 390], ['portrait', 390, 844]]) {
  test(`Chromium, ${nom} ${largeur}×${hauteur} : viser, valider, glisser, annuler`, async (t) => {
    if (!PW) return t.skip('Playwright absent');
    const browser = await PW.chromium.launch();
    try {
      const { page, cdp, erreurs } = await ouvrir(browser, largeur, hauteur);
      assert.strictEqual(await page.evaluate(() => SW.viserValider), true, 'à oui par défaut');
      assert.strictEqual(await page.evaluate(() => SW.tactilePossible()), true, 'écran tactile : l’option a sa ligne au menu');

      // 1. Viser, puis valider d'un appui un peu décalé.
      const p = await unePaire(page);
      const pt = await versEcran(page, p.px + p.x * 35 + 30, p.py + p.y * 35 + 17);
      await page.touchscreen.tap(pt.x, pt.y);
      await wait(120);
      let e = await etat(page);
      assert.strictEqual(e.lock, false, nom + ' : le premier appui ne joue pas');
      assert.strictEqual(e.journal.length, 0);
      assert.deepStrictEqual(e.visee, { x: p.x, y: p.y, dx: 1, dy: 0 }, nom + ' : la paire touchée est armée');
      assert.ok(e.visible && e.arme, nom + ' : elle reste montrée, et pulse');
      await page.touchscreen.tap(pt.x + 3, pt.y - 2);
      e = await etat(page);
      assert.strictEqual(e.lock, true, nom + ' : le second appui joue');
      assert.strictEqual(e.journal.length, 1);
      assert.match(e.journal[0], new RegExp('^s' + p.x + ',' + p.y + ',0@\\d+$'), nom + ' : la ligne d’un clic sur cette paire');
      await finDuTour(page);

      // 2. Un glissé franc vers la droite du jeu, depuis le centre d'une case.
      const q = await unePaire(page);
      const c = { x: q.px + q.x * 35 + 17, y: q.py + q.y * 35 + 17 };
      const pts = [];
      for (const d of [0, 6, 14, 24, 32]) pts.push(await versEcran(page, c.x + d, c.y + (d ? 2 : 0)));
      await glisser(cdp, pts);
      e = await etat(page);
      assert.strictEqual(e.lock, true, nom + ' : le glissé échange d’un geste');
      assert.match(e.journal[1], new RegExp('^s' + q.x + ',' + q.y + ',0@'), nom + ' : vers la droite du jeu');
      await finDuTour(page);

      // 3. Un glissé ramené près du point d'appui : rien.
      const r = await unePaire(page);
      const c2 = { x: r.px + r.x * 35 + 17, y: r.py + r.y * 35 + 17 };
      const aller = [];
      for (const d of [0, 15, 30, 15, 3]) aller.push(await versEcran(page, c2.x + d, c2.y));
      await glisser(cdp, aller);
      e = await etat(page);
      assert.strictEqual(e.lock, false, nom + ' : glissé annulé, rien n’est joué');
      assert.strictEqual(e.visee, null, nom + ' : et rien n’est visé');
      assert.strictEqual(e.journal.length, 2);

      // 4. Un second doigt pendant l'appui (la paume) ne compte pas.
      const a = await unePaire(page);
      const b = await unePaire(page, a.x);
      const pa = await versEcran(page, a.px + a.x * 35 + 30, a.py + a.y * 35 + 17);
      const pb = await versEcran(page, b.px + b.x * 35 + 30, b.py + b.y * 35 + 17);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pa.x, y: pa.y, id: 1 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pa.x, y: pa.y, id: 1 }, { x: pb.x, y: pb.y, id: 2 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: pa.x, y: pa.y, id: 1 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      e = await etat(page);
      assert.strictEqual(e.lock, false);
      assert.deepStrictEqual(e.visee, { x: a.x, y: a.y, dx: 1, dy: 0 }, nom + ' : seul le premier doigt a visé');

      // 5. Un appui hors du plateau désarme.
      const dehors = await versEcran(page, 40, 300);
      await page.touchscreen.tap(dehors.x, dehors.y);
      await wait(120);
      e = await etat(page);
      assert.strictEqual(e.visee, null, nom + ' : hors du plateau, désarmé');
      assert.strictEqual(e.visible, false);
      assert.deepStrictEqual(erreurs, [], 'aucune erreur dans la page');
    } finally {
      await browser.close();
    }
  });
}

test('Chromium : l’option coupée (retenue par l’appareil) rend l’échange au relâcher', async (t) => {
  if (!PW) return t.skip('Playwright absent');
  const browser = await PW.chromium.launch();
  try {
    const { page } = await ouvrir(browser, 390, 844, { swapou2_viser: '0' });
    assert.strictEqual(await page.evaluate(() => SW.viserValider), false, 'relu au chargement');
    const p = await unePaire(page);
    const pt = await versEcran(page, p.px + p.x * 35 + 30, p.py + p.y * 35 + 17);
    await page.touchscreen.tap(pt.x, pt.y);
    const e = await etat(page);
    assert.strictEqual(e.lock, true, 'un seul appui joue');
    assert.match(e.journal[0], new RegExp('^s' + p.x + ',' + p.y + ',0@'));
  } finally {
    await browser.close();
  }
});
