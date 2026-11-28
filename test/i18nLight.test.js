'use strict';
/*
 * LE CLIENT LIGHT EN ANGLAIS.
 *
 * light.html écrit son français en clair (argument de repli de T()) et trouve
 * l'anglais dans /i18n/en/light.js. On l'ouvre ici pour de vrai, avec un
 * compte inscrit en anglais : au bureau (grand écran) puis au téléphone, on
 * relève une quinzaine de textes de l'interface — tuiles de l'accueil, barre
 * du haut, réglages, saisie du chat, une date — et l'on vérifie qu'ils sont
 * anglais, que la page se dit `lang="en"` et qu'aucun dictionnaire n'a manqué
 * à l'appel. Puis le sélecteur de langue des réglages bascule en français et
 * revient, et le même relevé, en français, rend le texte d'origine.
 *
 * Le serveur part d'un LIEN SYMBOLIQUE sans point quand le dépôt vit sous un
 * dossier caché (`.claude/worktrees/…`) : express refuse de servir un fichier
 * dont le chemin a un segment caché (cf. scripts/kit-bande-annonce/chat/lib/site.js).
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 4561;
const BASE = `http://127.0.0.1:${PORT}`;
const RUN = Date.now().toString(36).slice(-5);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function playwright() {
  for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(p); } catch { /* suivant */ }
  }
  return null;
}
const PW = playwright();

let proc = null;
let lien = null;
before(async () => {
  if (!PW) return;
  let racine = ROOT;
  if (ROOT.split(path.sep).some((s) => s.startsWith('.'))) {
    lien = path.join(os.tmpdir(), 'fp-i18n-light-' + PORT);
    try { fs.unlinkSync(lien); } catch { /* pas de lien précédent */ }
    fs.symlinkSync(ROOT, lien);
    racine = lien;
  }
  proc = spawn(process.execPath,
    ['--preserve-symlinks', '--preserve-symlinks-main', path.join(racine, 'server.js')], {
      cwd: racine,
      env: Object.assign({}, process.env, {
        PORT: String(PORT), DATABASE_URL: '', REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
        XMLSOCKET_PORT: String(PORT + 1), FRUTISCORE_PORT: String(PORT + 2),
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 200; i++) {
    try { if ((await fetch(BASE + '/light')).ok) return; } catch { /* pas prêt */ }
    await wait(250);
  }
  throw new Error('serveur indisponible');
});

after(() => {
  if (proc) proc.kill('SIGKILL');
  if (lien) { try { fs.unlinkSync(lien); } catch { /* déjà parti */ } }
});

async function poster(route, corps) {
  const r = await fetch(BASE + route, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps),
  });
  return r.json();
}

// Un compte inscrit EN ANGLAIS : la connexion doit rendre sa langue.
async function compteAnglais(suffixe) {
  const username = 'en' + suffixe + RUN;
  const password = 'secret123';
  const inscrit = await poster('/api/auth/register', { username, password, lang: 'en' });
  assert.ok(inscrit.ok, 'inscription : ' + JSON.stringify(inscrit));
  const j = await poster('/api/auth/login', { username, password });
  assert.ok(j.sid, 'session');
  assert.strictEqual(j.lang, 'en', 'la connexion rend la langue du compte');
  return { username, password, sid: j.sid };
}

// Une page du light, la langue posée d'avance dans le navigateur, et le
// registre de ce qui a raté : dictionnaires, erreurs de script.
async function ouvrir(browser, options, lang, sid) {
  const ctx = await browser.newContext(options);
  await ctx.addInitScript((l) => {
    try { if (!sessionStorage.getItem('fp_test_pose')) { localStorage.setItem('fp_lang', l); sessionStorage.setItem('fp_test_pose', '1'); } } catch (e) { /* rien */ }
  }, lang);
  const page = await ctx.newPage();
  const rates = [];
  const dicos = [];
  page.on('requestfailed', (r) => { if (/\/i18n\//.test(r.url())) rates.push(r.url() + ' ' + (r.failure() || {}).errorText); });
  page.on('response', (r) => {
    if (/\/i18n\//.test(r.url())) { dicos.push(r.url()); if (r.status() >= 400) rates.push(r.url() + ' ' + r.status()); }
  });
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(String(e && e.message || e)));
  await page.goto(`${BASE}/light${sid ? '?sid=' + encodeURIComponent(sid) : ''}`);
  return { ctx, page, rates, dicos, erreurs };
}

// L'appli est prête quand l'accueil a nommé le joueur. Un compte neuf passe
// d'abord par « Ma Frutibouille » (le serveur réclame une bouille) : on la
// valide telle quelle, une fois — elle couvrirait les tuiles.
async function pret(page) {
  await page.waitForFunction(() => document.querySelector('#home-pseudo')
    && document.querySelector('#home-pseudo').textContent !== '…', null, { timeout: 20000 });
  for (let i = 0; i < 20; i++) {
    if (await page.isVisible('#fb-editor-valider')) {
      await page.click('#fb-editor-valider');
      await page.waitForSelector('#fb-editor-valider', { state: 'hidden', timeout: 10000 });
      return;
    }
    await wait(250);
  }
}

// Le relevé : la même liste, en anglais ou en français.
const ECHANTILLON = {
  en: {
    tuileBoutique: 'Shop', tuileDisques: 'My discs', tuileSalons: 'Chat rooms',
    tuileMessagerie: 'Mail', tuileInventaire: 'Inventory', tuileReglages: 'Settings',
    accueil: 'Back to home', connectes: "Show / hide who's online",
    saisie: 'Type a message…', envoyer: 'Send',
    seDeconnecter: 'Log out', connecteEnTantQue: /^Logged in as /,
    nuit: 'The park at night', diag: 'Check', donnees: 'Download my data',
    reglagesTitre: 'App settings',
  },
  fr: {
    tuileBoutique: 'Boutique', tuileDisques: 'Mes disques', tuileSalons: 'Salons',
    tuileMessagerie: 'Messagerie', tuileInventaire: 'Inventaire', tuileReglages: 'Réglages',
    accueil: "Retour à l'accueil", connectes: 'Afficher / masquer les connectés',
    saisie: 'Message…', envoyer: 'Envoyer',
    seDeconnecter: 'Se déconnecter', connecteEnTantQue: /^Connecté en tant que /,
    nuit: 'Le parc, la nuit', diag: 'Faire le point', donnees: 'Télécharger mes données',
    reglagesTitre: "Réglages de l'appli",
  },
};
function releve(page) {
  return page.evaluate(() => {
    const t = (s) => { const e = document.querySelector(s); return e ? e.textContent.trim() : null; };
    const a = (s, n) => { const e = document.querySelector(s); return e ? e.getAttribute(n) : null; };
    return {
      lang: document.documentElement.lang,
      tuileBoutique: t('.home-tile[data-go="shop"] .lbl'),
      tuileDisques: t('.home-tile[data-go="disques"] .lbl'),
      tuileSalons: t('.home-tile[data-go="chat"] .lbl'),
      tuileMessagerie: t('.home-tile[data-go="mail"] .lbl'),
      tuileInventaire: t('.home-tile[data-go="inventaire"] .lbl'),
      tuileReglages: t('.home-tile[data-go="reglages"] .lbl'),
      accueil: a('#menu-btn', 'aria-label'),
      connectes: a('#users-btn', 'title'),
      saisie: a('#compose-input', 'placeholder'),
      envoyer: t('#compose-send'),
      seDeconnecter: t('#logout-btn'),
      connecteEnTantQue: t('.hc-qui'),
      nuit: t('#reg-carte-nuit .reg-titre'),
      diag: t('#reg-diag-btn'),
      donnees: t('#reg-export-btn'),
      reglagesTitre: t('#reglages-panel .fen-titre span'),
    };
  });
}
function comparer(vu, lang, ou) {
  assert.strictEqual(vu.lang, lang, ou + ' : <html lang>');
  const attendu = ECHANTILLON[lang];
  for (const k of Object.keys(attendu)) {
    if (attendu[k] instanceof RegExp) assert.match(String(vu[k]), attendu[k], ou + ' : ' + k);
    else assert.strictEqual(vu[k], attendu[k], ou + ' : ' + k);
  }
}

// La date du pied des scores : « 28 nov. 26 » en français, « 11/28/26 » en
// anglais (le mois d'abord, comme T.date).
async function dateDesScores(page) {
  await page.click('.home-tile[data-go="scores"]');
  await page.waitForFunction(() => {
    const e = document.querySelector('#sc-jour');
    return e && e.textContent.trim().length > 0;
  }, null, { timeout: 15000 });
  return page.evaluate(() => document.querySelector('#sc-jour').textContent.trim());
}

const BUREAU = { viewport: { width: 1366, height: 860 } };
const TELEPHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

test('au bureau (grand écran), un compte anglais voit le light en anglais', async (t) => {
  if (!PW) return t.skip('Playwright absent');
  const c = await compteAnglais('b');
  const browser = await PW.chromium.launch();
  try {
    const o = await ouvrir(browser, BUREAU, 'en', c.sid);
    await pret(o.page);
    comparer(await releve(o.page), 'en', 'bureau');
    // « LV » à la place de « NIV » : l'image anglaise est substituée.
    const niv = await o.page.evaluate(() => {
      const i = document.querySelector('.niv-img');
      return { alt: i.getAttribute('alt'), content: getComputedStyle(i).content };
    });
    assert.strictEqual(niv.alt, 'LV');
    assert.match(niv.content, /Niveau-en\.svg/);
    assert.ok(o.dicos.some((u) => /\/i18n\/en\/light\.js$/.test(u)), 'le dictionnaire du light est chargé');
    assert.deepStrictEqual(o.rates, [], 'aucun dictionnaire ne manque');
    assert.deepStrictEqual(o.erreurs, [], 'aucune erreur de script');
    await o.ctx.close();
  } finally {
    await browser.close();
  }
});

test('au téléphone : l’anglais, une date, puis le sélecteur bascule en français et revient', async (t) => {
  if (!PW) return t.skip('Playwright absent');
  const c = await compteAnglais('t');
  const browser = await PW.chromium.launch();
  try {
    const o = await ouvrir(browser, TELEPHONE, 'en', c.sid);
    const page = o.page;
    await page.waitForSelector('#home-grid', { state: 'visible', timeout: 20000 });
    await pret(page);
    comparer(await releve(page), 'en', 'téléphone');
    assert.match(await dateDesScores(page), /^\d{2}\/\d{2}\/\d{2}$/, 'la date des scores, à l’anglaise');
    assert.deepStrictEqual(o.rates, [], 'aucun dictionnaire ne manque');
    assert.deepStrictEqual(o.erreurs, [], 'aucune erreur de script');

    // Le sélecteur des réglages : « Français » → la page se recharge en
    // français, et le compte l'a retenu.
    await page.evaluate(() => window.activateTab('reglages'));
    await page.waitForSelector('#reg-langue', { state: 'visible' });
    assert.ok(await page.isChecked('#reg-langue input[value="en"]'), 'l’anglais est coché');
    await Promise.all([
      page.waitForNavigation({ timeout: 20000 }),
      page.check('#reg-langue input[value="fr"]'),
    ]);
    await pret(page);
    comparer(await releve(page), 'fr', 'après le passage au français');
    const relu = await poster('/api/auth/login', { username: c.username, password: c.password });
    assert.strictEqual(relu.lang, 'fr', 'le compte a retenu le français');

    // Et retour à l'anglais, par le même chemin.
    await page.evaluate(() => window.activateTab('reglages'));
    await page.waitForSelector('#reg-langue', { state: 'visible' });
    assert.ok(await page.isChecked('#reg-langue input[value="fr"]'), 'le français est coché');
    await Promise.all([
      page.waitForNavigation({ timeout: 20000 }),
      page.check('#reg-langue input[value="en"]'),
    ]);
    await pret(page);
    comparer(await releve(page), 'en', 'après le retour à l’anglais');
    const relu2 = await poster('/api/auth/login', { username: c.username, password: c.password });
    assert.strictEqual(relu2.lang, 'en', 'le compte est revenu à l’anglais');
    assert.deepStrictEqual(o.rates, [], 'aucun dictionnaire ne manque');
    await o.ctx.close();
  } finally {
    await browser.close();
  }
});

test('en français (fp_lang=fr), le même relevé rend le texte d’origine', async (t) => {
  if (!PW) return t.skip('Playwright absent');
  const c = await compteAnglais('f');
  const browser = await PW.chromium.launch();
  try {
    for (const [nom, options] of [['bureau', BUREAU], ['téléphone', TELEPHONE]]) {
      const o = await ouvrir(browser, options, 'fr', c.sid);
      // Le compte est anglais, mais le navigateur a CHOISI le français : la
      // reprise de session ne le fait pas changer d'avis.
      await pret(o.page);
      comparer(await releve(o.page), 'fr', nom);
      assert.deepStrictEqual(o.dicos, [], nom + ' : en français, aucun dictionnaire n’est chargé');
      assert.deepStrictEqual(o.erreurs, [], nom + ' : aucune erreur de script');
      if (nom === 'téléphone') {
        assert.match(await dateDesScores(o.page), /^\d{1,2} (janv\.|fevr\.|mars|avril|mai|juin|juil\.|aout|sept\.|oct\.|nov\.|dec\.) \d{2}$/,
          'la date des scores, à la française du SWF');
      }
      await o.ctx.close();
    }
  } finally {
    await browser.close();
  }
});

test('déconnecté : l’écran de connexion a son sélecteur, et il bascule', async (t) => {
  if (!PW) return t.skip('Playwright absent');
  const browser = await PW.chromium.launch();
  try {
    const o = await ouvrir(browser, TELEPHONE, 'en', '');
    const page = o.page;
    await page.waitForSelector('#login-form', { state: 'visible' });
    const lire = () => page.evaluate(() => ({
      lang: document.documentElement.lang,
      pseudo: document.querySelector('label[for="li-user"]').textContent,
      bouton: document.querySelector('#li-btn').textContent,
      inscrire: document.querySelector('#show-register').textContent,
      courant: (document.querySelector('#lg-langues [aria-current="true"]') || {}).textContent,
    }));
    assert.deepStrictEqual(await lire(),
      { lang: 'en', pseudo: 'Username', bouton: 'Log in', inscrire: 'Sign up for free', courant: 'English' });
    await Promise.all([page.waitForNavigation(), page.click('#lg-langues button[data-lang="fr"]')]);
    await page.waitForSelector('#login-form', { state: 'visible' });
    assert.deepStrictEqual(await lire(),
      { lang: 'fr', pseudo: 'Pseudo', bouton: 'Se connecter', inscrire: "S'inscrire gratuitement", courant: 'Français' });
    await Promise.all([page.waitForNavigation(), page.click('#lg-langues button[data-lang="en"]')]);
    await page.waitForSelector('#login-form', { state: 'visible' });
    assert.strictEqual((await lire()).lang, 'en');
    assert.deepStrictEqual(o.rates, [], 'aucun dictionnaire ne manque');
    await o.ctx.close();
  } finally {
    await browser.close();
  }
});
