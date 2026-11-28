'use strict';
/*
 * L'ACCUEIL DU TÉLÉPHONE (public/login-bis.html, sous 760 px).
 *
 * « Le bureau garde l'accueil d'époque ; le téléphone a sa page d'accueil. »
 *
 *   1. les sources : la page du téléphone est masquée hors de la requête
 *      média, ses textes ont tous leur anglais, ses jeux leur fiche ;
 *   2. dans Chromium, en téléphone : la scène et les trois parties paraissent,
 *      l'accueil d'époque s'efface, les feuilles montent et se referment, un
 *      jeu se lance en invité, et la page parle anglais en anglais ;
 *   3. dans Chromium, en bureau : rien de tout cela — ni affiché, ni même
 *      téléchargé.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const lire = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const PAGE = lire('public/login-bis.html');

test('sources : la page du téléphone n’existe pas au bureau, et chacun de ses textes a son anglais', () => {
  // `.m-only` masqué d'office, montré seulement sous la requête média.
  // « Téléphone » : étroit, ou tactile et bas (le même, tenu à l'horizontale).
  const REQUETE = '(max-width: 760px), (pointer: coarse) and (max-height: 500px)';
  const media = PAGE.indexOf('@media ' + REQUETE + ' {\n      html, body { overflow-x: hidden; }');
  assert.ok(media > 0, 'la requête média du téléphone');
  assert.ok(PAGE.includes("window.matchMedia('" + REQUETE + "')"), 'le script suit la même requête');
  const masque = PAGE.indexOf('.m-only { display: none; }');
  assert.ok(masque > 0 && masque < media, 'masqué AVANT (donc hors de) la requête média');
  assert.match(PAGE, /<main class="landing m-only" id="landing">/);
  // Ses images ne se chargent pas au bureau.
  const landing = PAGE.slice(PAGE.indexOf('<main class="landing'), PAGE.indexOf('</main>'));
  for (const img of landing.match(/<img [^>]*>/g)) assert.match(img, /loading="lazy"/, img);
  // Chaque clé « accueil.m.* » de la page a sa traduction anglaise.
  const cles = new Set([...PAGE.matchAll(/['"](accueil\.m\.[A-Za-z0-9]+)['"]/g)].map((m) => m[1]));
  for (const m of PAGE.matchAll(/data-i18n(?:-html)?="(accueil\.m\.[A-Za-z0-9]+)"/g)) cles.add(m[1]);
  for (const m of PAGE.matchAll(/data-i18n-attr="[a-z-]+:(accueil\.m\.[A-Za-z0-9]+)"/g)) cles.add(m[1]);
  assert.ok(cles.size > 40, 'les clés sont relevées');
  const dico = {};
  global.FPI18n = { ajouter: (l, d) => Object.assign(dico, d) };
  try { require(path.join(ROOT, 'public/i18n/en/accueil.js')); } finally { delete global.FPI18n; }
  for (const c of cles) {
    // « Salon Pomme » : les salons sont communs aux deux langues, leur nom aussi.
    if (c === 'accueil.m.salon') continue;
    assert.ok(dico[c] !== undefined, 'anglais manquant : ' + c);
  }
  // Chaque jeu du carrousel a sa fiche (genre, phrase).
  const ordre = PAGE.match(/const ORDRE_MOBILE = \[([^\]]+)\]/)[1].match(/'([a-z]+)'/g).map((s) => s.slice(1, -1));
  const fiches = PAGE.slice(PAGE.indexOf('const FICHES = {'), PAGE.indexOf('const ORDRE_MOBILE'));
  assert.equal(ordre.length, 11);
  for (const id of ordre) assert.match(fiches, new RegExp('\\n      ' + id + ': \\['), id);
  // Les vignettes nettes existent.
  for (const f of ['logo', 'fruits', 'bk', 'frutisnake', 'mb', 'fb', 'swapou', 'grapiz', 'kaluga', 'mwave', 'jamajama', 'mpixiz']) {
    assert.ok(fs.existsSync(path.join(ROOT, 'public/images/m', f + '.webp')), f + '.webp');
  }
});

test('Chromium : le téléphone a sa page d’accueil, le bureau garde la sienne', async (t) => {
  const pw = chromium();
  if (!pw) { t.skip('Playwright absent'); return; }
  const { spawn } = require('node:child_process');
  const PORT = 5731;
  const BASE = `http://127.0.0.1:${PORT}`;
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PORT: String(PORT), DATABASE_URL: '', XMLSOCKET_PORT: '5732', FRUTISCORE_PORT: '5733' }),
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  let navigateur = null;
  try {
    let pret = false;
    for (let i = 0; i < 150 && !pret; i++) {
      try { pret = (await fetch(BASE + '/')).ok; } catch { /* pas encore */ }
      if (!pret) await new Promise((r) => setTimeout(r, 100));
    }
    if (!pret) { t.skip('le serveur ne répond pas'); return; }
    try { navigateur = await pw.launch(); } catch (e) { t.skip('Chromium absent : ' + e.message); return; }
    const visible = (p, sel) => p.evaluate((s) => {
      const e = document.querySelector(s);
      return !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0;
    }, sel);

    // ── En téléphone, en français ──
    const ctx = await navigateur.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'fr-FR' });
    const p = await ctx.newPage();
    const erreurs = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.goto(BASE + '/?lang=fr', { waitUntil: 'networkidle' });
    assert.ok(await visible(p, '#landing'), 'la page du téléphone');
    assert.equal(await p.textContent('.m-devise'), 'Des fruits, des jeux,du chat !');
    for (const sel of ['#m-jeux', '#m-chat', '#m-fruits']) assert.ok(await visible(p, sel), sel);
    for (const sel of ['.layout > .games', '#welcome-text', '#topbar', '#register-form']) {
      assert.ok(!(await visible(p, sel)), sel + ' : l’accueil d’époque s’efface');
    }
    assert.equal(await p.locator('#m-carrousel .m-jeu').count(), 11, 'onze jeux');
    assert.equal(await p.locator('#m-carrousel .m-jeu-badge').count(), 2, 'deux jeux en ligne');
    assert.equal(await p.locator('#m-ecrans .m-ecran').count(), 4, 'quatre frutiz au salon');
    assert.ok(await p.locator('#m-fil .m-ligne').count() >= 3, 'le salon n’est jamais vide');
    // La connexion monte en feuille, et se referme (voile, Échap, croix).
    await p.click('.m-connexion');
    assert.equal(await p.evaluate(() => document.body.dataset.feuille), 'connexion');
    assert.ok(await visible(p, '#topbar'), 'la feuille de connexion');
    assert.equal(await p.evaluate(() => document.activeElement.id), 'username', 'le champ du pseudo a le focus');
    await p.keyboard.press('Escape');
    assert.equal(await p.evaluate(() => document.body.dataset.feuille || ''), '');
    assert.ok(!(await visible(p, '#topbar')));
    // L'inscription : des champs à la hauteur d'un doigt.
    await p.click('.m-actions [data-m-inscription]');
    assert.equal(await p.evaluate(() => document.body.dataset.feuille), 'inscription');
    const hauteurs = await p.evaluate(() => [...document.querySelectorAll('#register-form input')].map((i) => i.getBoundingClientRect().height));
    assert.deepEqual(hauteurs, [48, 48, 48, 48]);
    assert.equal(await p.textContent('#status'), '', 'pas de bulle : la feuille a son titre');
    await p.click('#register-form .feuille-fermer');
    assert.ok(!(await visible(p, '#register-form')));
    // Le code oublié, depuis la feuille de connexion ; le voile referme.
    await p.click('.m-connexion');
    await p.click('.feuille-oubli');
    assert.equal(await p.evaluate(() => document.body.dataset.feuille), 'oubli');
    assert.ok(await visible(p, '#forgot-box'));
    await p.mouse.click(20, 20);
    assert.equal(await p.evaluate(() => document.body.dataset.feuille || ''), '');
    assert.ok(!(await visible(p, '#forgot-box')));
    // Une erreur de connexion : une bulle en haut de l'écran.
    await p.click('.m-connexion');
    await p.fill('#username', 'personne' + Date.now().toString(36).slice(-4));
    await p.fill('#password', 'mauvais1');
    await p.click('#login-form button[type=submit]');
    await p.waitForFunction(() => document.getElementById('status').textContent.length > 0);
    assert.equal(await p.evaluate(() => getComputedStyle(document.getElementById('status')).position), 'fixed');
    await p.keyboard.press('Escape');
    // Un jeu, d'un doigt : le jeu en invité.
    await p.click('#m-carrousel .m-jeu >> nth=0');
    assert.ok(await visible(p, '#jeu-invite'));
    assert.match(await p.getAttribute('#ji-cadre', 'src'), /^\/bkiwi\/\?invite=1$/);
    await p.click('#ji-fermer');
    // Un jeu en ligne propose l'inscription — qui monte en feuille.
    await p.click('#m-carrousel .m-jeu >> nth=9');
    await p.click('#ji-message button');
    assert.equal(await p.evaluate(() => document.body.dataset.feuille), 'inscription');
    assert.deepEqual(erreurs, []);
    await ctx.close();

    // ── En téléphone, en anglais ──
    const ctxEn = await navigateur.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'en-US' });
    const en = await ctxEn.newPage();
    await en.goto(BASE + '/?lang=en', { waitUntil: 'networkidle' });
    assert.equal(await en.textContent('.m-devise'), 'Fruits, gamesand chat!');
    assert.equal(await en.textContent('#m-jouer'), 'Play now');
    assert.equal(await en.textContent('#m-carrousel .m-jeu-genre >> nth=0'), 'Racing');
    assert.match(await en.textContent('#m-fil'), /Kiwinette: Hi everyone!!!/);
    await ctxEn.close();

    // ── Le téléphone tenu à l'horizontale : toujours sa page, pas le bureau ──
    const ctxH = await navigateur.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, locale: 'fr-FR' });
    const h = await ctxH.newPage();
    await h.goto(BASE + '/?lang=fr', { waitUntil: 'networkidle' });
    assert.ok(await visible(h, '#landing'), 'à l’horizontale aussi');
    assert.ok(!(await visible(h, '.layout > .games')));
    assert.equal(await h.evaluate(() => document.documentElement.scrollWidth), 844, 'pas de défilement de côté');
    await ctxH.close();

    // ── Au bureau : l'accueil d'époque, et rien du téléphone ──
    const ctxB = await navigateur.newContext({ viewport: { width: 1280, height: 860 }, locale: 'fr-FR' });
    const bureau = await ctxB.newPage();
    const urls = [];
    bureau.on('request', (r) => urls.push(r.url()));
    await bureau.goto(BASE + '/?lang=fr', { waitUntil: 'networkidle' });
    assert.ok(!(await visible(bureau, '#landing')), 'pas de page du téléphone');
    assert.ok(await visible(bureau, '#topbar'), 'la barre de connexion d’époque');
    assert.ok(await visible(bureau, '.layout > .games'), 'la liste des jeux d’époque');
    assert.ok(!(await visible(bureau, '.feuille-tete')), 'pas d’en-tête de feuille');
    const mobiles = urls.filter((u) => /\/images\/m\/|\/js\/bouille-|online-count|alba\.woff|\/fbouille\//.test(u));
    assert.deepEqual(mobiles, [], 'rien du téléphone n’est téléchargé');
    await ctxB.close();
  } finally {
    if (navigateur) await navigateur.close().catch(() => {});
    proc.kill('SIGKILL');
  }
});

function chromium() {
  for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(p).chromium; } catch { /* suivant */ }
  }
  return null;
}
