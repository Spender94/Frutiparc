'use strict';
/*
 * JAMAJAMA ET FRUTISNAKE EN DEUX LANGUES
 * ══════════════════════════════════════
 *
 * Les deux jeux chargent /js/i18n.js et leur dictionnaire
 * (/<jeu>/lang/en.js). Dans un vrai Chromium, en mode invité
 * (`?invite=1`), avec `localStorage.fp_lang` posé avant le chargement :
 *
 *   · EN ANGLAIS, les menus et les textes de partie sont anglais — y compris
 *     les textes FIGÉS du SWF : le lettrage du menu de JamaJama a son
 *     remplaçant (sprites/paquet-en.json), les pastilles « retour » et
 *     « entrainement » de Frutisnake et ses titres d'écrans ont leur image nue
 *     (sprites/en/) et l'anglais s'écrit par-dessus ;
 *   · l'aide de JamaJama est anglaise, et la route /api/jamajama/aide sert
 *     help-en.xml à qui demande l'anglais ;
 *   · l'écran de fin de Frutisnake et le panneau de l'invité parlent anglais ;
 *   · aucune requête en échec, aucune erreur de page ;
 *   · EN FRANÇAIS, rien ne change : aucun dictionnaire ni dessin anglais n'est
 *     demandé, et les textes sont ceux d'avant.
 *
 * Ce que le canevas écrit se lit en espionnant fillText/strokeText (posé
 * avant le chargement de la page).
 *
 * Les trois illustrations que l'aide de JamaJama appelle
 * (help_illuspictos1..3) ne sont pas dans le dépôt : elles répondent 404 en
 * français comme en anglais, et ce sont les seules requêtes tolérées en échec.
 *
 * Le serveur tourne sans base. Express refuse de servir un chemin qui
 * traverse un dossier caché (un arbre de travail rangé sous un dossier à
 * point) : on passe alors par un lien symbolique sans point.
 * Sans Playwright, les tests sont sautés.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 5640;
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
  let racine = ROOT;
  if (ROOT.split(path.sep).some((s) => s.startsWith('.'))) {
    lien = path.join(os.tmpdir(), 'i18n-jama-snake-' + PORT);
    try { fs.unlinkSync(lien); } catch { /* pas de lien précédent */ }
    fs.symlinkSync(ROOT, lien);
    racine = lien;
  }
  donnees = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-jama-snake-donnees-'));
  proc = spawn(process.execPath, ['--preserve-symlinks', '--preserve-symlinks-main', path.join(racine, 'server.js')], {
    cwd: racine,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', XMLSOCKET_PORT: String(PORT + 1), FRUTISCORE_PORT: String(PORT + 2),
      FRUTI_DATA_DIR: donnees,
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  let pret = false;
  for (let i = 0; i < 240 && !pret; i++) {
    try { pret = (await fetch(BASE + '/jamajama/index.html')).ok; } catch { /* pas prêt */ }
    if (!pret) await attendre(250);
  }
  if (!pret) throw new Error('serveur indisponible');
  navigateur = await PW.chromium.launch();
});

after(async () => {
  if (navigateur) await navigateur.close().catch(() => {});
  if (proc) proc.kill('SIGKILL');
  if (lien) { try { fs.unlinkSync(lien); } catch { /* déjà parti */ } }
  if (donnees) { try { fs.rmSync(donnees, { recursive: true, force: true }); } catch { /* rien */ } }
});

// ── Les outils ──────────────────────────────────────────────────────────────

const ILLUSTRATIONS_ABSENTES = /\/games\/poulpi\/images\/help_illuspictos[123]_upgraded\.jpg$/;

// Une page de jeu dans une langue : requêtes, échecs, erreurs, et tout ce que
// le canevas écrit.
async function ouvrir(chemin, langue, viewport) {
  const ctx = await navigateur.newContext({ viewport: viewport || { width: 900, height: 620 } });
  await ctx.addInitScript((l) => {
    try {
      localStorage.setItem('fp_lang', l);
      localStorage.setItem('snake3.tourne', '1');
    } catch (e) { /* stockage refusé */ }
    window.__textes = new Set();
    const P = CanvasRenderingContext2D.prototype;
    for (const nom of ['fillText', 'strokeText']) {
      const vrai = P[nom];
      P[nom] = function (t) { window.__textes.add(String(t)); return vrai.apply(this, arguments); };
    }
  }, langue);
  const page = await ctx.newPage();
  const requetes = [];
  const echecs = [];
  const erreurs = [];
  page.on('request', (r) => requetes.push(r.url()));
  page.on('requestfailed', (r) => echecs.push('échec ' + r.url()));
  page.on('response', (r) => { if (r.status() >= 400 && !ILLUSTRATIONS_ABSENTES.test(r.url())) echecs.push(r.status() + ' ' + r.url()); });
  page.on('pageerror', (e) => erreurs.push(e.message));
  await page.goto(BASE + chemin);
  return { ctx, page, requetes, echecs, erreurs };
}
const textes = (page) => page.evaluate(() => [...window.__textes]);
const viderTextes = (page) => page.evaluate(() => window.__textes.clear());

// ── JAMAJAMA ────────────────────────────────────────────────────────────────

async function jamaPret(page) {
  await page.waitForFunction(() => window.JamaRendu && window.JamaRendu.manifeste() && window.__textes, null, { timeout: 30000 });
  await attendre(1200);
}
// Un clic en coordonnées du jeu (384 × 384).
async function jamaClic(page, x, y) {
  const r = await page.evaluate(() => { const b = document.getElementById('jama').getBoundingClientRect(); return { x: b.left, y: b.top, k: b.width / 384 }; });
  await page.mouse.click(r.x + x * r.k, r.y + y * r.k);
  await attendre(500);
}

test('JamaJama en anglais : menu, textes figés, options, fiche, aide', { skip: SAUTER, timeout: 120000 }, async () => {
  const { ctx, page, requetes, echecs, erreurs } = await ouvrir('/jamajama/?invite=1', 'en', { width: 600, height: 600 });
  try {
    await jamaPret(page);
    assert.strictEqual(await page.evaluate(() => FPI18n.langue), 'en');
    assert.ok(requetes.some((u) => u.endsWith('/jamajama/lang/en.js')), 'le dictionnaire du jeu est chargé');
    assert.ok(requetes.some((u) => u.endsWith('/jamajama/sprites/paquet-en.json')), 'le paquet des textes figés aussi');
    // Le lettrage du menu (SkaterDudes) et ses halos ont leur remplaçant ;
    // « options » est le même mot, il n'en a pas.
    assert.deepStrictEqual(await page.evaluate(() => ['texte107.svg', 'texte109.svg', 'texte117.svg', 'shape864.svg',
      'texte119.svg', 'shape861.svg'].map((f) => JamaRendu.remplace(f))), [true, true, true, true, false, true]);
    assert.strictEqual(await page.evaluate(() => document.querySelector('#jama-manette [data-action]').textContent), 'Ghost');

    // Les options (article 4 du menu de l'invité).
    await jamaClic(page, 192, 270);
    await attendre(500);
    let t = await textes(page);
    for (const s of ['Level start animation', 'Level end animation', 'Save', 'Cancel']) assert.ok(t.includes(s), 'options : ' + s);
    assert.ok(!t.includes('Sauver') && !t.includes('Animation de debut de partie'), 'plus de français');
    await page.keyboard.press('Escape');
    await attendre(500);

    // Le tournoi : l'en-tête de la liste, puis la fiche d'un niveau.
    await viderTextes(page);
    await jamaClic(page, 192, 180);
    await attendre(800);
    t = await textes(page);
    assert.ok(t.includes('level name') && t.includes('difficulty'), 'l’en-tête de la liste');
    await jamaClic(page, 100, 40);
    const z = await page.evaluate(() => JamaEcrans.cadreEnfant('jama_gui_list', 1, 'butProp'));
    await jamaClic(page, z.x + z.w / 2, z.y + z.h / 2);
    await attendre(400);
    t = await textes(page);
    for (const s of ['Author:', 'Created:', 'Plays:', 'Wins:', 'Difficulty:']) assert.ok(t.includes(s), 'la fiche : ' + s);
    await jamaClic(page, 192, 192);                   // la fiche se ferme
    await page.keyboard.press('Escape');
    await attendre(500);

    // L'aide (article 3) : le HTML de help-en.xml, posé sur le canevas.
    await jamaClic(page, 192, 240);
    await page.waitForFunction(() => { const b = document.querySelector('.jama-aide'); return b && /Welcome to JamaJama!/.test(b.textContent); }, null, { timeout: 15000 });
    assert.ok(requetes.some((u) => u.endsWith('/api/jamajama/aide?lang=en')), 'le jeu demande l’aide en anglais');

    // Les dialogues de partie et la confirmation de l'éditeur.
    assert.deepStrictEqual(await page.evaluate(() => [T('jamajama.abandonner', ''), T('jamajama.oui', ''),
      T('jamajama.champ.743', 'Auteur :'), new JamaEcrans.EcranOptions({}).boutons.map((b) => b.dit)]),
    ['Give up this game?', 'yes', 'Author:', ['Save', 'Cancel']]);

    assert.deepStrictEqual(echecs, []);
    assert.deepStrictEqual(erreurs, []);
  } finally { await ctx.close(); }
});

test('JamaJama en français : rien de changé, rien d’anglais demandé', { skip: SAUTER, timeout: 90000 }, async () => {
  const { ctx, page, requetes, echecs, erreurs } = await ouvrir('/jamajama/?invite=1', 'fr', { width: 600, height: 600 });
  try {
    await jamaPret(page);
    assert.strictEqual(await page.evaluate(() => FPI18n.langue), 'fr');
    assert.ok(!requetes.some((u) => /\/lang\/en\.js|paquet-en\.json|\/i18n\/en\//.test(u)), 'aucun fichier anglais');
    assert.strictEqual(await page.evaluate(() => JamaRendu.remplace('texte107.svg')), false);
    assert.strictEqual(await page.evaluate(() => document.querySelector('#jama-manette [data-action]').textContent), 'Fantôme');
    await jamaClic(page, 192, 270);
    await attendre(500);
    const t = await textes(page);
    for (const s of ['Animation de debut de partie', 'Animation de fin de partie', 'Sauver', 'Annuler']) assert.ok(t.includes(s), s);
    await page.keyboard.press('Escape');
    await attendre(400);
    await jamaClic(page, 192, 240);
    await page.waitForFunction(() => { const b = document.querySelector('.jama-aide'); return b && /Bienvenue dans JamaJama !/.test(b.textContent); }, null, { timeout: 15000 });
    assert.ok(requetes.some((u) => u.endsWith('/api/jamajama/aide?lang=fr')));
    assert.deepStrictEqual(echecs, []);
    assert.deepStrictEqual(erreurs, []);
  } finally { await ctx.close(); }
});

test('/api/jamajama/aide : help-en.xml en anglais, help.xml sinon, même structure', { skip: SAUTER }, async () => {
  const en = await (await fetch(BASE + '/api/jamajama/aide?lang=en')).json();
  const fr = await (await fetch(BASE + '/api/jamajama/aide?lang=fr')).json();
  const parDefaut = await (await fetch(BASE + '/api/jamajama/aide')).json();
  const entete = await (await fetch(BASE + '/api/jamajama/aide', { headers: { 'Accept-Language': 'en-GB,en;q=0.8' } })).json();
  assert.strictEqual(en.ok, true);
  assert.match(en.sections.index, /Welcome to JamaJama!/);
  assert.match(fr.sections.index, /Bienvenue dans JamaJama !/);
  assert.match(parDefaut.sections.index, /Bienvenue dans JamaJama !/, 'sans langue (fetch envoie « * »), le français');
  assert.match(entete.sections.index, /Welcome to JamaJama!/, 'sans lang, Accept-Language décide');
  assert.deepStrictEqual(Object.keys(en.sections), Object.keys(fr.sections), 'les mêmes sections');
  assert.strictEqual(en.style, fr.style);
  // L'annexe anglaise se complète des mêmes vingt-deux fiches, en anglais.
  const titres = [...en.sections.index_annex.matchAll(/<p class="subtitle">([^<]+)<\/p>/g)].map((m) => m[1]);
  assert.strictEqual(titres.length, 22);
  assert.deepStrictEqual(titres.slice(0, 4), ['Tiki', 'The exit hatch', 'The fruits', 'The crate']);
  assert.ok(!/[àâçéèêëîïôûù]/i.test(en.sections.index_controls), 'pas de français oublié dans les contrôles');
});

// ── FRUTISNAKE ──────────────────────────────────────────────────────────────

async function snakePret(page) {
  await page.waitForFunction(() => window.__frutisnake && window.__frutisnake.mode && window.__frutisnake.next_mode === -1, null, { timeout: 60000 });
  await attendre(800);
}
const snakeLibre = (page) => page.waitForFunction(() => window.__frutisnake.next_mode === -1, null, { timeout: 30000 });

// La partie de Challenge, menée à sa fin par la routine du moteur
// (partie.game_over), jusqu'à l'écran « Game over » prêt à être cliqué.
async function snakeFin(page, score) {
  await page.evaluate(() => window.__frutisnake.choixMenu(1));
  await page.waitForFunction(() => { const j = window.__frutisnake; return j.mode && j.mode.partie && j.next_mode === -1; }, null, { timeout: 30000 });
  await page.evaluate((s) => { const p = window.__frutisnake.mode.partie; p.score = s; p.game_over(); }, score);
  await page.waitForFunction(() => { const v = window.__frutisnake.mode; return v.ecran && v.ecran.surPresse && v.ecran.frame === 7; }, null, { timeout: 30000 });
}

test('Frutisnake en anglais : pastilles, options, livre, écrans et fin de partie', { skip: SAUTER, timeout: 180000 }, async () => {
  const { ctx, page, requetes, echecs, erreurs } = await ouvrir('/snake3/?invite=1', 'en');
  try {
    await snakePret(page);
    assert.strictEqual(await page.evaluate(() => FPI18n.langue), 'en');
    assert.ok(requetes.some((u) => u.endsWith('/snake3/lang/en.js')));
    assert.deepStrictEqual(await page.evaluate(() => [SnakeConst.TXT_VOTRE_SCORE(12), SnakeConst.TXT_BATTLE_WIN(1),
      SnakeConst.TXT_PLACE_GAGNEES(1), SnakeConst.TXT_SCORE_SANS_FD.split('\n').length, SnakeConst.FRUIT_NAMES[1]]),
    ['Your score: 12', 'The red snake wins!', 'You moved up one place in the rankings!', 3, 'pomme chauve'],
    'les noms de fruits (jeux de mots) restent français');
    // « challenge », « battle », « options », « encyclopéfruit » gardent leur
    // lettrage ; « retour » (5) et « entrainement » (9) ont leur pastille nue.
    assert.deepStrictEqual(await page.evaluate(() => [1, 2, 3, 4, 5, 9].map((n) => SnakeDessin.sansTexte('menu', n))),
      [false, false, false, false, true, true]);

    // Le sous-menu Battle : la pastille 5 s'écrit « back », la 10 « CHAMPIONSHIP ».
    await page.evaluate(() => window.__frutisnake.choixMenu(2));
    await snakeLibre(page);
    await attendre(800);
    let t = await textes(page);
    assert.ok(t.includes('back') && t.includes('CHAMPIONSHIP') && t.includes('1 vs 1 online'), 'le sous-menu Battle');
    assert.ok(requetes.some((u) => u.endsWith('/snake3/sprites/en/menu005.svg')), 'la pastille nue');
    assert.ok(!t.includes('CHAMPIONNAT') && !t.includes('retour'));
    // La pastille 9 (le tournoi), posée devant le carrousel.
    await page.evaluate(() => { const j = window.__frutisnake; j.mode = new window.SnakeMenu.Menu(j, [9, 1, 2, 3, 4], () => {}); });
    await attendre(600);
    assert.ok((await textes(page)).includes('training'));
    await page.evaluate(() => window.__frutisnake.forcerMode(0));
    await snakeLibre(page);

    // Les options.
    await page.evaluate(() => window.__frutisnake.choixMenu(3));
    await snakeLibre(page);
    await attendre(600);
    t = await textes(page);
    for (const s of ['music', 'sound effects', 'Controls:', 'Back to Menu >', 'player 1', 'player 4', 'on', 'left', 'pad 7']) {
      assert.ok(t.includes(s), 'options : ' + s);
    }
    await page.evaluate(() => window.__frutisnake.retourMenu());
    await snakeLibre(page);

    // L'Encyclopéfruit : la couverture, le sommaire, une page de fruit.
    await page.evaluate(() => window.__frutisnake.choixMenu(4));
    await snakeLibre(page);
    await attendre(1500);
    await page.evaluate(() => { const e = window.__frutisnake.mode; e.main = () => {}; e.pageCourante = 0; e.rotation = 0; });
    await attendre(800);
    await page.evaluate(() => { const e = window.__frutisnake.mode; e.pageCourante = 4; });
    await attendre(800);
    t = await textes(page);
    for (const s of ['FrutiMag special issue', '2004 Edition', 'CONTENTS', 'You have picked up 0 fruits.', 'Value', 'Quantity', 'Unknown', 'None']) {
      assert.ok(t.some((x) => x.trim() === s), 'le livre : ' + s);
    }
    assert.ok(requetes.some((u) => u.endsWith('/snake3/sprites/en/pageSans004.svg')));
    await page.evaluate(() => window.__frutisnake.retourMenu());
    await snakeLibre(page);

    // La fin de partie : l'écran « Game over » (déjà de l'anglais) et son
    // texte, puis le panneau de l'invité.
    await viderTextes(page);
    await snakeFin(page, 4321);
    assert.strictEqual(await page.evaluate(() => window.__frutisnake.mode.ecran.texte), 'Your score: 4321\n');
    await attendre(500);
    assert.ok((await textes(page)).includes('Your score: 4321'));
    // Les titres redessinés des autres écrans.
    for (const [ecran, titre] of [['connexion', 'Connecting'], ['resultat', 'Results'], ['fruit', 'New Fruit']]) {
      await page.evaluate((e) => { const j = window.__frutisnake; const s = j.mode.ecran.surPresse; j.mode.ecran = new window.SnakeJeu.Ecran(j, e, ''); j.mode.ecran.poserPresse(s); }, ecran);
      await attendre(500);
      assert.ok((await textes(page)).includes(titre), 'l’écran ' + ecran);
    }
    await page.evaluate(() => window.__frutisnake.mode.ecran.presser());
    await page.waitForSelector('#fp-invite', { timeout: 10000 });
    assert.strictEqual(await page.evaluate(() => document.querySelector('#fp-invite .fpi-score').textContent), 'Your score: 4321');
    await page.click('#fp-invite .fpi-non');

    assert.deepStrictEqual(echecs, []);
    assert.deepStrictEqual(erreurs, []);
  } finally { await ctx.close(); }
});

test('Frutisnake en français : rien de changé, rien d’anglais demandé', { skip: SAUTER, timeout: 120000 }, async () => {
  const { ctx, page, requetes, echecs, erreurs } = await ouvrir('/snake3/?invite=1', 'fr');
  try {
    await snakePret(page);
    assert.strictEqual(await page.evaluate(() => FPI18n.langue), 'fr');
    assert.deepStrictEqual(await page.evaluate(() => [SnakeConst.TXT_VOTRE_SCORE(12), SnakeConst.TXT_BATTLE_WIN(1),
      SnakeDessin.sansTexte('menu', 5)]), ['Votre score : 12', 'Le serpent rouge a gagné !', false]);
    await page.evaluate(() => window.__frutisnake.choixMenu(2));
    await snakeLibre(page);
    await attendre(800);
    const t = await textes(page);
    assert.ok(t.includes('CHAMPIONNAT') && t.includes('1 contre 1 en ligne'));
    assert.ok(!t.includes('back'));
    await page.evaluate(() => window.__frutisnake.choixMenu(5));
    await snakeLibre(page);
    await snakeFin(page, 4321);
    assert.strictEqual(await page.evaluate(() => window.__frutisnake.mode.ecran.texte), 'Votre score : 4321\n');
    assert.ok(!requetes.some((u) => /\/lang\/en\.js|\/sprites\/en\/|\/i18n\/en\//.test(u)), 'aucun fichier anglais');
    assert.deepStrictEqual(echecs, []);
    assert.deepStrictEqual(erreurs, []);
  } finally { await ctx.close(); }
});
