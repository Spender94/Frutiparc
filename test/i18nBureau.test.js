'use strict';
/*
 * LE BUREAU FRUTIZ EN ANGLAIS (public/bureau-frutiz.js, /i18n/en/bureau.js).
 *
 * Le français reste écrit dans le code, argument de repli de T() ; l'anglais
 * vit dans le dictionnaire, chargé par light.html seulement quand la langue
 * est l'anglais. On vérifie, dans un vrai navigateur, que le bureau parle
 * anglais quand `fp_lang` vaut 'en' — titres de fenêtre, onglet, menus,
 * infobulles, courrier, boutique, page de chargement, phrases de l'explorateur
 * (« faites glisser les disques dans la Frusion »), l'afficheur LCD du rang —,
 * qu'il parle toujours français sinon, et que le choix « Langue / Language »
 * des préférences du bureau change bien la langue du compte.
 *
 * Ce qui vient du SERVEUR (noms de dossiers du carnet, articles de la
 * boutique, libellés des préférences) n'est pas vérifié ici : il sera traduit
 * côté serveur.
 *
 * La partie navigateur a besoin de Playwright ; sans lui, elle est sautée.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const I = require('../public/js/i18n.js');

// ── Le dictionnaire, sans navigateur ────────────────────────────────────────

global.FPI18n = I;
require('../public/i18n/en/bureau.js');
delete global.FPI18n;

test('les mots de l’afficheur LCD tiennent dans la fonte LcdSwf (a-z, chiffres, % et .)', () => {
  const JS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.js'), 'utf8');
  const noms = /var GS_NOMS = \{([\s\S]*?)\};/.exec(JS)[1];
  const cles = [...noms.matchAll(/T\('(bureau\.lcd\w+)', '([^']+)'\)/g)];
  assert.strictEqual(cles.length, 6, 'les six noms de `nameList`');
  for (const [, cle, fr] of cles) {
    const en = I.traduire('en', cle, fr);
    assert.notStrictEqual(en, cle, cle + ' a une traduction');
    assert.match(fr, /^[a-z0-9%.]+$/, cle + ' (fr) hors de la fonte');
    assert.match(en, /^[a-z0-9%.]+$/, cle + ' (en) hors de la fonte : ' + en);
  }
  assert.strictEqual(I.traduire('en', 'bureau.lcdHistorique', 'historique'), 'history');
});

test('la date longue du courrier : « jeudi 27 aout 20:17 » / « Thursday, August 27 20:17 »', () => {
  const p = { jour: 'jeudi', j: 27, mois: 'aout', heure: '20:17', js: 3, ms: 7 };
  assert.strictEqual(I.traduire('fr', 'bureau.mailDateLongue', '{jour} {j} {mois} {heure}', p), 'jeudi 27 aout 20:17');
  assert.strictEqual(I.traduire('en', 'bureau.mailDateLongue', '{jour} {j} {mois} {heure}', p), 'Thursday, August 27 20:17');
});

test('le compte des réponses de la recherche suit la règle de chaque langue', () => {
  const formes = { one: '{page}/{pages} - {n} réponse', other: '{page}/{pages} - {n} réponses' };
  const p = { page: 1, pages: 1 };
  assert.strictEqual(I.pluriel('fr', 'bureau.rcReponses', 0, formes, p), '1/1 - 0 réponse');
  assert.strictEqual(I.pluriel('en', 'bureau.rcReponses', 0, formes, p), '1/1 - 0 answers');
  assert.strictEqual(I.pluriel('en', 'bureau.rcReponses', 1, formes, p), '1/1 - 1 answer');
});

// ── Pour de vrai : le serveur, par un lien sans point, et Chromium ─────────

const PORT = 4641;
const BASE = `http://127.0.0.1:${PORT}`;
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

function playwright() {
  for (const p of ['playwright', '/opt/node-tools/node_modules/playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(p); } catch { /* suivant */ }
  }
  return null;
}
const PW = playwright();
const SAUTER = PW ? false : 'Playwright absent';

let proc = null;
let navigateur = null;
let lien = null;
let donnees = null;

before(async () => {
  if (!PW) return;
  // express refuse un chemin qui traverse un dossier caché (`.claude/…`) :
  // on passe par un lien symbolique sans point.
  let racine = ROOT;
  if (ROOT.split(path.sep).some((s) => s.startsWith('.'))) {
    lien = path.join(os.tmpdir(), 'i18n-bureau-' + PORT);
    try { fs.unlinkSync(lien); } catch { /* pas de lien précédent */ }
    fs.symlinkSync(ROOT, lien);
    racine = lien;
  }
  donnees = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-bureau-donnees-'));
  proc = spawn(process.execPath, ['--preserve-symlinks', '--preserve-symlinks-main', path.join(racine, 'server.js')], {
    cwd: racine,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', XMLSOCKET_PORT: '4642', FRUTISCORE_PORT: '4643',
      REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000', FRUTI_DATA_DIR: donnees,
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  let pret = false;
  for (let i = 0; i < 240 && !pret; i++) {
    try { pret = (await fetch(BASE + '/light')).ok; } catch { /* pas prêt */ }
    if (!pret) await attendre(250);
  }
  if (!pret) throw new Error('serveur indisponible');
  navigateur = await PW.chromium.launch();
});

after(async () => {
  if (navigateur) await navigateur.close();
  if (proc) proc.kill('SIGKILL');
  if (lien) { try { fs.unlinkSync(lien); } catch { /* déjà parti */ } }
  if (donnees) { try { fs.rmSync(donnees, { recursive: true, force: true }); } catch { /* tant pis */ } }
});

async function json(chemin, corps) {
  const r = await fetch(BASE + chemin, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps),
  });
  return r.json();
}

// Un compte neuf, une bouille posée (sans elle, l'éditeur s'ouvre par-dessus
// le bureau), et un courrier à lui-même pour la visionneuse.
async function compte(prefixe) {
  const pseudo = prefixe + (Date.now() % 1000000).toString(36);
  const corps = { username: pseudo, password: 'secret123' };
  await json('/api/auth/register', corps);
  const j = await json('/api/auth/login', corps);
  assert.ok(j.sid, 'session pour ' + pseudo);
  await fetch(BASE + '/do/eb?sid=' + j.sid + '&b=' + encodeURIComponent('00030507020f0m09020t0a00'));
  const m = await json('/api/light/mail/send', { sid: j.sid, to: pseudo, subject: 'Coucou', body: 'Un petit mot.' });
  assert.ok(m.ok, 'le courrier part');
  return { pseudo, sid: j.sid, corps };
}

// Ouvre /light en grand écran dans une langue, et rend ce que le bureau montre.
async function lireBureau(lang) {
  const { sid, pseudo } = await compte('i18n' + lang);
  const ctx = await navigateur.newContext({ viewport: { width: 1280, height: 860 } });
  // Une seule fois : un rechargement (le choix de la langue) garde ce que la
  // page a écrit elle-même.
  await ctx.addInitScript((l) => {
    try {
      if (sessionStorage.getItem('i18n-bureau')) return;
      sessionStorage.setItem('i18n-bureau', '1');
      localStorage.setItem('fp_lang', l);
    } catch (e) { /* rien */ }
  }, lang);
  const page = await ctx.newPage();
  const ratees = [];
  page.on('requestfailed', (r) => { if (/\/i18n\//.test(r.url())) ratees.push(r.url()); });
  page.on('response', (r) => { if (/\/i18n\//.test(r.url()) && r.status() >= 400) ratees.push(r.status() + ' ' + r.url()); });
  const erreurs = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  // Le manifeste du chargement arrive en retard : la page de chargement reste
  // le temps qu'on la lise.
  await page.route('**/frutiz/sprites/chargement.json', async (route) => { await attendre(1500); await route.continue(); });
  await page.goto(BASE + '/light?sid=' + sid);
  await page.waitForSelector('#fb-chargement .ch-titre', { timeout: 30000 });
  const chargement = await page.evaluate(() => ({
    titre: document.querySelector('#fb-chargement .ch-titre').textContent,
    champ: document.querySelector('#fb-chargement .ch-champ').textContent,
    infoTitre: document.querySelector('#fb-chargement .ch-info-titre').textContent,
    info: document.querySelector('#fb-chargement .ch-info').textContent,
  }));
  await page.waitForFunction(() => window.BureauFrutiz && BureauFrutiz.actif()
    && !document.getElementById('fb-chargement'), null, { timeout: 30000 });

  const titreDe = (sel) => page.evaluate((s) => {
    const p = document.querySelector(s);
    const f = p && p.closest('.fen');
    return f ? f.querySelector('.fen-titre .txt').textContent : null;
  }, sel);
  const vu = { chargement };
  vu.lang = await page.evaluate(() => document.documentElement.lang);
  vu.onglet = await page.textContent('.fb-onglet[data-slot="bureau"] span');
  vu.recherche = await page.evaluate(() => {
    const b = document.querySelector('#side-list .sl-recherche');
    return { texte: b.textContent, titre: b.title };
  });
  vu.frusion = await page.evaluate(() => [document.querySelector('#frusion-boite .fr-casque').title,
    document.querySelector('#frusion-boite .fr-eject').title]);
  vu.cadran = await page.evaluate(() => document.querySelector('#frutimandala .md-mandalaSwap').title);
  // L'afficheur du rang : survoler une icône de la rangée y écrit son nom.
  vu.lcd = await page.evaluate(() => {
    const b = document.querySelector('#bureau-coin .mb-shortcuts .sc-btn[data-sc="Historique"]');
    b.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    return document.querySelector('#bureau-coin .enc-trophy .val').textContent;
  });
  // Le menu de l'onglet du bureau.
  await page.click('.fb-onglet[data-slot="bureau"] .fb-onglet-ico');
  vu.menu = await page.$$eval('.ot-menu button', (l) => l.map((b) => b.textContent));
  await page.mouse.click(700, 700);

  // Mes disques : le titre, et la phrase de l'explorateur sur la Frusion.
  await page.evaluate(() => BureauFrutiz.ouvrirDisques());
  await page.waitForSelector('#ex-disques-panel .ex-alerte:not([hidden])', { timeout: 15000 });
  vu.disques = { titre: await titreDe('#ex-disques-panel'), alerte: await page.textContent('#ex-disques-panel .ex-alerte') };
  // La boutique et ses boutons à elle.
  await page.evaluate(() => BureauFrutiz.ouvrirBoutique());
  await page.waitForSelector('#shop-sheet .bq-plus');
  vu.boutique = {
    titre: await titreDe('#shop-sheet'),
    plus: await page.getAttribute('#shop-sheet .bq-plus', 'title'),
    icones: await page.$$eval('#shop-sheet .bq-ico', (l) => l.map((b) => b.title)),
  };
  // La recherche de frutiz.
  await page.evaluate(() => BureauFrutiz.ouvrirRecherche());
  await page.waitForSelector('#recherche-panel .rc-lbl');
  vu.rechercheFen = {
    titre: await titreDe('#recherche-panel'),
    etiquette: await page.textContent('#recherche-panel .rc-lbl'),
    avancee: await page.textContent('#recherche-panel .rc-avance'),
  };
  // Le courrier : la liste, la lecture, puis la réponse.
  await page.evaluate(() => activateTab('mail'));
  await page.waitForSelector('#mail-liste .mx-rang', { timeout: 15000 });
  vu.mail = {
    titre: await titreDe('#mail-panel'),
    colonnes: await page.$$eval('#mail-panel .mx-col .t', (l) => l.map((t) => t.textContent)),
  };
  await page.click('#mail-liste .mx-rang');
  await page.waitForFunction(() => document.querySelector('#mail-panel.mx-lit'));
  vu.lecture = await page.evaluate(() => ({
    etiquettes: [...document.querySelectorAll('#mail-vue-lecture .mx-info .mx-lab')].map((e) => e.textContent),
    date: document.querySelector('#mail-vue-lecture .mx-val[data-champ="date"]').textContent,
    boutons: ['#mail-retour', '#mail-supprimer', '#mail-repondre', '#mail-transferer']
      .map((s) => document.querySelector(s).textContent),
  }));
  await page.click('#mail-repondre');
  await page.waitForFunction(() => document.querySelector('#mail-panel.mx-ecrit'));
  vu.reponse = await page.evaluate(() => ({
    titre: document.querySelector('#mail-panel').closest('.fen').querySelector('.fen-titre .txt').textContent,
    sujet: document.querySelector('#mail-sujet').value,
    corps: document.querySelector('#mail-texte').value,
    de: document.querySelector('#mail-vue-ecriture .mx-de .mx-lab').textContent,
    copie: document.querySelector('#mail-panel .mx-copie span').textContent,
    envoyer: document.querySelector('#mail-envoyer').textContent,
    gras: document.querySelector('#mail-panel .mx-flag-gras').title,
  }));
  // Mes préférences : les rubriques du bureau et le choix de la langue.
  await page.evaluate(() => activateTab('reglages'));
  await page.waitForSelector('#reglages-panel .pf-pref', { timeout: 15000 });
  vu.prefs = {
    titre: await titreDe('#reglages-panel'),
    rubriques: await page.$$eval('#reglages-panel .pf-rub', (l) => l.map((b) => b.textContent)),
    boutons: await page.$$eval('#reglages-panel .pf-but', (l) => l.map((b) => b.textContent)),
  };
  vu.ratees = ratees;
  vu.erreurs = erreurs;
  return { vu, page, ctx, pseudo };
}

test('Chromium : en anglais, le bureau parle anglais — et le dictionnaire arrive sans faute', { skip: SAUTER }, async () => {
  const { vu, ctx } = await lireBureau('en');
  try {
    assert.deepStrictEqual(vu.ratees, [], 'aucune requête /i18n/ ratée');
    assert.deepStrictEqual(vu.erreurs, [], 'aucune erreur dans la page');
    assert.strictEqual(vu.lang, 'en');
    // La page de chargement.
    assert.strictEqual(vu.chargement.titre, 'LOADING');
    assert.match(vu.chargement.champ, /^files remaining: \d+%$/);
    assert.strictEqual(vu.chargement.infoTitre, 'Information:');
    assert.match(vu.chargement.info, /^This loads every part of the frutiparc interface/);
    // Le shell : l'onglet, la bande des contacts, la Frusion, le frutimandala.
    assert.strictEqual(vu.onglet, 'Desktop');
    assert.deepStrictEqual(vu.recherche, { texte: 'Search', titre: 'Find a frutiz' });
    assert.deepStrictEqual(vu.frusion, ['Restart the game', 'Eject the disc']);
    assert.strictEqual(vu.cadran, 'Switch dial');
    assert.strictEqual(vu.lcd, 'history');
    assert.deepStrictEqual(vu.menu.slice().sort(), ['Flash mode', 'Log out', 'Quick mode', 'Search']);
    // Les fenêtres.
    assert.strictEqual(vu.disques.titre, 'My discs');
    assert.match(vu.disques.alerte, /^(To play, drag the discs into the Frusion|Out of Fruti-Discs\?)/);
    assert.deepStrictEqual(vu.boutique, { titre: 'Shop', plus: 'Get kikooz', icones: ['Kikooz history', 'Get kikooz'] });
    assert.deepStrictEqual(vu.rechercheFen, { titre: 'Find a frutiz', etiquette: 'username:', avancee: 'advanced' });
    // Le courrier, de la liste à la réponse.
    assert.strictEqual(vu.mail.titre, 'Inbox');
    assert.deepStrictEqual(vu.mail.colonnes, ['Sender', 'Subject', 'Date']);
    assert.deepStrictEqual(vu.lecture.etiquettes, ['Date:', 'From:', 'To:', 'Subject:']);
    assert.match(vu.lecture.date, /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), [A-Z][a-z]+ \d{1,2} \d\d:\d\d$/);
    assert.deepStrictEqual(vu.lecture.boutons, ['Back', 'Delete', 'Reply', 'Forward']);
    assert.strictEqual(vu.reponse.titre, 'Write a new message');
    assert.strictEqual(vu.reponse.sujet, 'Re: Coucou');
    assert.match(vu.reponse.corps, /^\n\n--- Original message ---\nDate: \w+, \w+ \d+ \d\d:\d\d\nFrom: \w+\nTo: \w+\nSubject: Coucou\n\nUn petit mot\.$/);
    assert.strictEqual(vu.reponse.de, 'From:');
    assert.strictEqual(vu.reponse.copie, 'Add to "Sent messages"');
    assert.strictEqual(vu.reponse.envoyer, 'Send');
    assert.strictEqual(vu.reponse.gras, 'Bold');
    // Les préférences : les rubriques du bureau (celles du serveur viendront
    // traduites par lui), ses deux boutons.
    assert.strictEqual(vu.prefs.titre, 'My preferences');
    assert.ok(vu.prefs.rubriques.includes('This device') && vu.prefs.rubriques.includes('My account'),
      'rubriques du bureau : ' + vu.prefs.rubriques.join(', '));
    assert.deepStrictEqual(vu.prefs.boutons, ['Default values', 'Save']);
  } finally {
    await ctx.close();
  }
});

test('Chromium : en français, rien n’a bougé', { skip: SAUTER }, async () => {
  const { vu, ctx } = await lireBureau('fr');
  try {
    assert.deepStrictEqual(vu.ratees, [], 'en français, aucun dictionnaire n’est demandé');
    assert.deepStrictEqual(vu.erreurs, [], 'aucune erreur dans la page');
    assert.strictEqual(vu.lang, 'fr');
    assert.strictEqual(vu.chargement.titre, 'CHARGEMENT');
    assert.match(vu.chargement.champ, /^fichiers restants : \d+%$/);
    assert.strictEqual(vu.chargement.infoTitre, 'Information :');
    assert.strictEqual(vu.onglet, 'Bureau');
    assert.deepStrictEqual(vu.recherche, { texte: 'Recherche', titre: 'Recherche de frutiz' });
    assert.deepStrictEqual(vu.frusion, ['Redémarrer le jeu', 'Éjecter le disque']);
    assert.strictEqual(vu.cadran, 'Changer de cadran');
    assert.strictEqual(vu.lcd, 'historique');
    assert.deepStrictEqual(vu.menu.slice().sort(), ['Mode Flash', 'Mode rapide', 'Recherche', 'Se déconnecter']);
    assert.strictEqual(vu.disques.titre, 'Mes disques');
    assert.match(vu.disques.alerte, /^(Pour jouer, faîtes glisser les disques dans la Frusion|Vous n’avez plus de Fruti-Disque)/);
    assert.deepStrictEqual(vu.boutique, { titre: 'Boutique', plus: 'Obtenir des kikooz', icones: ['Historique Kikooz', 'Obtenir des kikooz'] });
    assert.deepStrictEqual(vu.rechercheFen, { titre: 'Recherche de frutiz', etiquette: 'pseudo :', avancee: 'avancée' });
    assert.strictEqual(vu.mail.titre, 'Boîte de réception');
    assert.deepStrictEqual(vu.mail.colonnes, ['Expéditeur', 'Sujet', 'Date']);
    assert.deepStrictEqual(vu.lecture.etiquettes, ['Date :', 'De :', 'A :', 'Sujet :']);
    assert.match(vu.lecture.date, /^(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche) \d{1,2} [a-zéû]+ \d\d:\d\d$/);
    assert.deepStrictEqual(vu.lecture.boutons, ['Retour', 'Supprimer', 'Répondre', 'Transférer']);
    assert.strictEqual(vu.reponse.titre, 'Composer un nouveau message');
    assert.strictEqual(vu.reponse.sujet, 'Re: Coucou');
    assert.match(vu.reponse.corps, /^\n\n--- En réponse au message ---\nDate : \S+ \d+ \S+ \d\d:\d\d\nDe : \w+\nA : \w+\nSujet : Coucou\n\nUn petit mot\.$/);
    assert.strictEqual(vu.reponse.de, 'De :');
    assert.strictEqual(vu.reponse.copie, 'Ajouter dans "Messages envoyés"');
    assert.strictEqual(vu.reponse.envoyer, 'Envoyer');
    assert.strictEqual(vu.reponse.gras, 'Gras');
    assert.strictEqual(vu.prefs.titre, 'Mes préférences');
    assert.ok(vu.prefs.rubriques.includes('Cet appareil') && vu.prefs.rubriques.includes('Mon compte'));
    assert.deepStrictEqual(vu.prefs.boutons, ['Valeurs par défaut', 'Enregistrer']);
  } finally {
    await ctx.close();
  }
});

test('Chromium : « Langue / Language » change la langue du compte, puis recharge la page', { skip: SAUTER }, async () => {
  const { page, ctx, pseudo } = await lireBureau('en');
  try {
    // La rubrique est écrite dans les deux langues ; elle montre la langue en cours.
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('#reglages-panel .pf-pref')].find((x) => x.textContent === 'Langue / Language');
      b.scrollIntoView();
      b.click();
    });
    await page.waitForSelector('#reglages-panel input[name="pf-langue"]');
    assert.strictEqual(await page.$eval('#reglages-panel input[name="pf-langue"]:checked', (r) => r.value), 'en');
    const envoi = page.waitForRequest((r) => r.url().endsWith('/api/light/langue') && r.method() === 'POST');
    const recharge = page.waitForNavigation({ timeout: 20000 });
    await page.check('#reglages-panel input[name="pf-langue"][value="fr"]');
    const corps = JSON.parse((await envoi).postData());
    assert.strictEqual(corps.lang, 'fr');
    assert.ok(corps.sid, 'la requête porte la session');
    await recharge;
    await page.waitForFunction(() => window.BureauFrutiz && BureauFrutiz.actif(), null, { timeout: 30000 });
    assert.strictEqual(await page.evaluate(() => document.documentElement.lang), 'fr');
    assert.strictEqual(await page.evaluate(() => localStorage.getItem('fp_lang')), 'fr');
    assert.strictEqual(await page.textContent('.fb-onglet[data-slot="bureau"] span'), 'Bureau');
    // Le serveur a retenu la langue du compte : la connexion suivante la rend.
    const j = await json('/api/auth/login', { username: pseudo, password: 'secret123' });
    assert.strictEqual(j.lang, 'fr');
  } finally {
    await ctx.close();
  }
});
