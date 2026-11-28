/*
 * LES JEUX DU MOTEUR KALUGA EN ANGLAIS — Kaluga, Burning Kiwi, MotionBall 2.
 *
 * Les trois jeux partagent un petit lecteur Flash (public/kaluga/moteur/) qui
 * dessine tout sur une toile. On ne peut donc pas lire leurs textes dans le
 * DOM : on espionne `fillText`, par où passent les champs (texte.js) et les
 * TEXTES FIGÉS que le moteur récrit en anglais (le texte statique de Flash,
 * cuit en formes, ou écrit lettre à lettre — voir scripts/textes-figes.js).
 * Le moteur écrit une ligne figée mot à mot : l'espion garde aussi les suites
 * des derniers mots écrits, pour qu'une phrase se retrouve entière.
 *
 * Ce que ces tests verrouillent, jeu par jeu, dans un vrai Chromium, en mode
 * invité (`?invite=1`) :
 *
 *   · EN ANGLAIS (`localStorage.fp_lang = 'en'`) : le menu, une page d'aide
 *     ou de tutoriel, un écran de fin sont en anglais — y compris un texte
 *     autrefois figé (« Collect the most apples! », écrit lettre à lettre par
 *     le SWF ; « Statistics », « Click to Play »…) ; le panneau de l'invité
 *     parle anglais avec le libellé du jeu (libelleEn) ;
 *   · aucune requête en échec, aucune erreur de page ;
 *   · EN FRANÇAIS : rien ne change — ni dictionnaire ni data/figes.json
 *     demandés, les textes du code et des champs en français, et aucun texte
 *     figé récrit (ils restent les formes du SWF).
 *
 * Le serveur tourne sans base (DATABASE_URL vide). Express refuse de servir un
 * chemin qui traverse un dossier caché : on passe par un lien symbolique sans
 * point. Sans Playwright, les tests sont sautés.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 5541;
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
    lien = path.join(os.tmpdir(), 'i18n-jeux-moteur-' + PORT);
    try { fs.unlinkSync(lien); } catch { /* pas de lien précédent */ }
    fs.symlinkSync(ROOT, lien);
    racine = lien;
  }
  donnees = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-jeux-moteur-donnees-'));
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
    try { pret = (await fetch(BASE + '/kaluga/index.html')).ok; } catch { /* pas prêt */ }
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

// Une page de jeu, dans une langue, avec l'espion de fillText et le relevé des
// requêtes en échec et des erreurs de page.
async function ouvrir(chemin, langue, viewport) {
  const ctx = await navigateur.newContext({ viewport: viewport || { width: 900, height: 620 } });
  await ctx.addInitScript((l) => {
    try { localStorage.setItem('fp_lang', l); } catch (e) { /* stockage refusé */ }
    const ecrits = new Set();
    const suite = [];
    window.__ecrits = ecrits;
    const vrai = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (t) {
      // (une ligne de champ garde l'espace qui précédait son <sbr />)
      const s = String(t).trim();
      if (s) suite.push(s);
      if (suite.length > 12) suite.shift();
      for (let k = 1; k <= suite.length; k++) ecrits.add(suite.slice(-k).join(' '));
      return vrai.apply(this, arguments);
    };
  }, langue);
  const page = await ctx.newPage();
  const requetes = [];
  const echecs = [];
  const erreurs = [];
  page.on('request', (r) => requetes.push(r.url()));
  page.on('requestfailed', (r) => echecs.push(r.url() + ' (' + ((r.failure() && r.failure().errorText) || '') + ')'));
  page.on('response', (r) => { if (r.status() >= 400) echecs.push(r.status() + ' ' + r.url()); });
  page.on('pageerror', (e) => erreurs.push(e.message));
  await page.goto(BASE + chemin);
  return { ctx, page, requetes, echecs, erreurs };
}

// Ce que la toile a écrit jusqu'ici (lignes, mots, suites de mots).
const ecrits = (page) => page.evaluate(() => [...window.__ecrits]);
async function attendreEcrit(page, texte, timeout) {
  await page.waitForFunction((t) => window.__ecrits.has(t), texte, { timeout: timeout || 20000 });
}
function verifierPropre(o, jeu) {
  assert.deepStrictEqual(o.echecs, [], jeu + ' : aucune requête en échec');
  assert.deepStrictEqual(o.erreurs, [], jeu + ' : aucune erreur de page');
}
function sansAnglais(o, jeu) {
  const charges = o.requetes.filter((u) => /\/lang\/|figes\.json|\/i18n\/en\//.test(u));
  assert.deepStrictEqual(charges, [], jeu + ' : en français, ni dictionnaire ni data/figes.json');
}

// ── Kaluga ──────────────────────────────────────────────────────────────────

// Le menu, le temps qu'il soit dessiné (`premier` : son premier mode), puis
// le panneau de départ du Challenge.
async function kalugaJusquAuPanneau(page, premier) {
  await page.waitForFunction(() => { const c = KalugaJeu.manager && KalugaJeu.manager.current; return c && c.menuList; }, null, { timeout: 60000 });
  await attendreEcrit(page, premier, 30000);
  await page.evaluate(() => KalugaJeu.manager.current.selectSlot(0));
  await page.waitForFunction(() => { const g = KalugaJeu.manager.current; return g.startPanel && g.startPanel._parent; }, null, { timeout: 30000 });
}
async function kalugaFin(page) {
  for (let i = 0; i < 60; i++) {
    if (await page.evaluate(() => KalugaJeu.manager.current.masterStep === 1)) break;
    await page.evaluate(() => { const g = KalugaJeu.manager.current; if (g.startPanel && g.startPanel._parent) g.startPanelForward(); });
    await attendre(200);
  }
  await page.evaluate(() => { const g = KalugaJeu.manager.current; g.score = 870; if (g.tzongre) g.tzongre.groundCrash(); g.endGame(); });
  await page.waitForFunction(() => { const g = KalugaJeu.manager.current; return g.masterStep === 2 && g.endGamePanel && g.endGamePanel.sheet && g.endGamePanel.sheet.panel; }, null, { timeout: 30000 });
}
async function kalugaDefiler(page) {
  for (let i = 0; i < 40; i++) {
    const fini = await page.evaluate(() => {
      if (document.getElementById('fp-invite')) return true;
      const p = KalugaJeu.manager.current.endGamePanel.sheet.panel;
      if (p.pageNum >= p.list.length - 1) return true;
      const ici = p.list[p.pageNum];
      if (!(ici && typeof ici === 'object' && ici.wait)) p.nextPage();
      return false;
    });
    await attendre(300);
    if (fini) return;
  }
}

test('Kaluga en anglais : menu, tutoriel, fin de partie, textes figés récrits', { skip: SAUTER, timeout: 180000 }, async () => {
  const o = await ouvrir('/kaluga/?invite=1', 'en');
  try {
    const { page } = o;
    await kalugaJusquAuPanneau(page, 'PRACTICE');
    // Le menu : les noms des modes (l'invité joue les « essais »).
    let vu = await ecrits(page);
    for (const t of ['PRACTICE', 'OLYMPICS', 'TIME TRIAL', 'OPTIONS']) assert.ok(vu.includes(t), 'menu : ' + t);
    assert.ok(!vu.includes('ESSAIS') && !vu.includes('OLYMPIQUE'), 'plus de nom de mode français');
    // Le tutoriel : un champ du SWF (kaluga.champ.907) et un titre que le SWF
    // écrivait LETTRE À LETTRE (kaluga.fige.1074.1).
    await attendreEcrit(page, 'Catch as many apples as you can and');
    await attendreEcrit(page, 'Collect the most apples!');
    vu = await ecrits(page);
    assert.ok(!vu.includes('Attrape le plus de pommes possible et'), 'plus de champ français');
    // La fin : l'en-tête dessiné du panneau (« Partie Terminée », kaluga.fige.638)
    // et le grand score (une phrase lettre à lettre, kaluga.fige.668.1).
    await kalugaFin(page);
    await attendreEcrit(page, 'Game Over');
    await kalugaDefiler(page);
    vu = await ecrits(page);
    assert.ok(vu.includes('Your score:'), 'le grand score : « Your score: »');
    assert.ok(vu.includes('Overall:') || vu.some((s) => /^<b>Overall:/.test(s)) || vu.includes('Apples:'), 'les statistiques en anglais');
    // Le panneau de l'invité, en anglais, avec le libellé du jeu.
    await page.waitForSelector('#fp-invite', { timeout: 20000 });
    const panneau = await page.textContent('#fp-invite');
    assert.match(panneau, /Game over!/);
    assert.match(panneau, /Your score: 870/);
    verifierPropre(o, 'Kaluga');
  } finally { await o.ctx.close(); }
});

test('Kaluga en français : rien ne change', { skip: SAUTER, timeout: 180000 }, async () => {
  const o = await ouvrir('/kaluga/?invite=1', 'fr');
  try {
    const { page } = o;
    await kalugaJusquAuPanneau(page, 'ESSAIS');
    await attendreEcrit(page, 'Attrape le plus de pommes possible et');
    const vu = await ecrits(page);
    assert.ok(vu.includes('ESSAIS') && vu.includes('OLYMPIQUE'), 'les noms des modes en français');
    // Les textes figés restent les formes du SWF : aucun n'est récrit.
    for (const t of ['Collect the most apples!', 'Ramasser le plus de pommes !', 'Ramasser']) assert.ok(!vu.includes(t), 'pas de texte figé récrit : ' + t);
    sansAnglais(o, 'Kaluga');
    verifierPropre(o, 'Kaluga');
  } finally { await o.ctx.close(); }
});

// ── Burning Kiwi ────────────────────────────────────────────────────────────

const bkiwiPret = (page) => page.waitForFunction(() => {
  const J = window.BkiwiJeu; const M = J && J.M;
  return M && M.vs && J.client && J.client.connected && M.trackStats && M.controls && M.controls[0] != null;
}, null, { timeout: 90000 });
async function bkiwiMenu(page) {
  await bkiwiPret(page);
  await page.evaluate(() => { BkiwiJeu.M.musicON = false; });
  await page.locator('canvas').first().focus();
  for (let i = 0; i < 120; i++) {
    if (await page.evaluate(() => { const M = BkiwiJeu.M; return M.vs.menuPhase === -1 && M.buttons && M.buttons.length > 1; })) return;
    await page.keyboard.press('Space');
    await attendre(500);
  }
  throw new Error('le menu de Burning Kiwi ne vient pas');
}
// Un bouton du menu, d'un vrai clic (la scène fait 350 × 350) ; la page
// suivante vient quand les boutons ont fini de partir.
async function bkiwiClic(page, x, y) {
  const r = await page.locator('canvas').first().boundingBox();
  const k = r.width / 350;
  await page.mouse.click(r.x + x * k, r.y + y * k);
  await attendre(1500);
  await page.waitForFunction(() => { const M = BkiwiJeu.M; return M.vs.menuPhase === -1 && M.buttons && M.buttons.length > 0; }, null, { timeout: 20000 });
  await attendre(600);
}
const bkiwiModes = (page) => bkiwiClic(page, 120, 80);                       // menu principal → modes de jeu
// → options → touches (la page des touches attend une touche : pas de boutons à guetter)
async function bkiwiTouches(page) {
  await bkiwiClic(page, 120, 160);
  const r = await page.locator('canvas').first().boundingBox();
  const k = r.width / 350;
  await page.mouse.click(r.x + 120 * k, r.y + 240 * k);
  await attendre(2000);
}

test('Burning Kiwi en anglais : menu, touches, présentation du circuit, fin de course', { skip: SAUTER, timeout: 240000 }, async () => {
  const o = await ouvrir('/bkiwi/?invite=1', 'en', { width: 700, height: 600 });
  try {
    const { page } = o;
    await bkiwiMenu(page);
    await bkiwiModes(page);
    // Le survol d'un bouton : le panneau d'information.
    await page.evaluate(() => { const b = BkiwiJeu.M.buttons.find((x) => x.onOver); b.onOver(); });
    await attendreEcrit(page, 'game modes');
    let vu = await ecrits(page);
    for (const t of ['practice', 'tutorial', 'back']) assert.ok(vu.includes(t), 'bouton : ' + t);
    assert.ok(!vu.includes('retour') && !vu.includes('modes de jeu'), 'plus de libellé français');
    // L'aide des touches : un texte figé (bkiwi.fige.559) et les commandes.
    await bkiwiClic(page, 60, 320);                                           // retour au menu principal
    await bkiwiTouches(page);
    await attendreEcrit(page, 'Click the keys you want to change');
    await attendreEcrit(page, 'Accelerate');
    // La présentation d'un circuit : son résumé (un champ lié, traduit à l'affichage).
    await page.evaluate(() => { const M = BkiwiJeu.M; BkiwiJeu.removeAllButtons(); M.vs.gameMode = M.ARCADE; M.vs.selectedTrack = 1; M.vs.selectedCar = 2; M.vs.menuPhase = 90; });
    await attendreEcrit(page, 'click to continue');
    vu = await ecrits(page);
    assert.ok(vu.some((s) => /Legend has it/.test(s)), 'le résumé du circuit en anglais');
    // Une course raccourcie, puis ses écrans de fin (les vraies touches).
    await page.evaluate(() => { const M = BkiwiJeu.M; M.vs.gameMode = M.TIMETRIAL; M.vs.selectedTrack = 0; M.vs.selectedCar = 2; M.vs.menuPhase = -1; M.vs.mainPhase = 3; });
    await page.waitForFunction(() => { const M = BkiwiJeu.M; return M.vs.mainPhase === 1 && M.cars && M.cars[0] && !M.starting; }, null, { timeout: 60000 });
    await page.evaluate(() => { const M = BkiwiJeu.M; M.cars[0].vs.totalTime = 83456; M.timerEnd = 1; });
    await page.waitForFunction(() => BkiwiJeu.M.vs.mainPhase === 2, null, { timeout: 20000 });
    for (let i = 0; i < 40; i++) {
      if (await page.evaluate(() => BkiwiJeu.M.vs.mainPhase === 0 || !!document.getElementById('fp-invite'))) break;
      await attendre(500);
      await page.keyboard.down('Space'); await attendre(100); await page.keyboard.up('Space');
    }
    vu = await ecrits(page);
    // Les statistiques de la course : des textes figés (bkiwi.fige.359, .380, .391).
    for (const t of ['Statistics', 'Best lap', 'Off-track', 'Perfect laps']) assert.ok(vu.includes(t), 'fin de course : ' + t);
    await page.waitForSelector('#fp-invite', { timeout: 20000 });
    const panneau = await page.textContent('#fp-invite');
    assert.match(panneau, /Game over!/);
    assert.match(panneau, /Your time: 1'23"456/);
    verifierPropre(o, 'Burning Kiwi');
  } finally { await o.ctx.close(); }
});

test('Burning Kiwi en français : rien ne change', { skip: SAUTER, timeout: 180000 }, async () => {
  const o = await ouvrir('/bkiwi/?invite=1', 'fr', { width: 700, height: 600 });
  try {
    const { page } = o;
    await bkiwiMenu(page);
    await bkiwiModes(page);
    await attendreEcrit(page, 'modes de jeu');
    await bkiwiClic(page, 60, 320);
    await bkiwiTouches(page);
    await attendreEcrit(page, 'Accélérer');
    const vu = await ecrits(page);
    for (const t of ['essais', 'retour']) assert.ok(vu.includes(t), 'bouton : ' + t);
    for (const t of ['Click the keys you want to change', 'Cliquez sur les touches à modifier']) assert.ok(!vu.includes(t), 'pas de texte figé récrit : ' + t);
    sansAnglais(o, 'Burning Kiwi');
    verifierPropre(o, 'Burning Kiwi');
  } finally { await o.ctx.close(); }
});

// ── MotionBall 2 ────────────────────────────────────────────────────────────

async function mb2Menu(page) {
  await page.waitForFunction(() => window.Mb2Jeu && Mb2Jeu.Manager.mode && Mb2Jeu.Manager.mode.constructor.name === 'Intro', null, { timeout: 30000 });
}

test('MotionBall 2 en anglais : accueil, menu, aide, fin de partie', { skip: SAUTER, timeout: 180000 }, async () => {
  const o = await ouvrir('/mb2/?invite=1', 'en');
  try {
    const { page } = o;
    await mb2Menu(page);
    // L'accueil : « Cliquez pour Jouer », un texte figé en Kiloton (mb2.fige.75).
    await attendreEcrit(page, 'Click to', 30000);
    await attendreEcrit(page, 'Play');
    const r = await page.locator('canvas').first().boundingBox();
    await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
    await page.waitForFunction(() => { const m = Mb2Jeu.Manager.mode; return m && m.balls && m.balls.length > 1; }, null, { timeout: 30000 });
    // Le menu : la description d'un mode, au survol de sa boule (mb2.fige.890…).
    const n = await page.evaluate(() => Mb2Jeu.Manager.mode.balls.length);
    for (let i = 0; i < n; i++) {
      await page.evaluate((k) => { const m = Mb2Jeu.Manager.mode; m.balls.forEach((x) => m.unselect(x)); m.select(m.balls[k]); }, i);
      await attendre(400);
    }
    let vu = await ecrits(page);
    assert.ok(vu.includes('Master the 7 tracks and win the'), 'le menu : la description de la Course');
    // L'aide : trois textes figés.
    await page.evaluate(() => Mb2Jeu.Manager.gotoAide());
    await attendreEcrit(page, 'Help the poor ball find its way through a dreadful maze!');
    await attendreEcrit(page, '- Use the arrow keys to move.');
    // Une fin de partie (le Classique, plus de balles).
    await page.evaluate(() => Mb2Jeu.Manager.startGame(Mb2Jeu.Const.MODE_CLASSIC));
    await page.waitForFunction(() => Mb2Jeu.Manager.mode && Mb2Jeu.Manager.mode.constructor.name === 'Game', null, { timeout: 30000 });
    await page.evaluate(() => Mb2Jeu.Manager.gameOver(Mb2Jeu.Const.CAUSE_NOBALLS));
    await attendreEcrit(page, 'Your score: level 1');
    vu = await ecrits(page);
    assert.ok(!vu.some((s) => /Votre score/.test(s)), 'plus de bilan français');
    await page.evaluate(() => Mb2Jeu.Manager.mode.click());
    await page.waitForSelector('#fp-invite', { timeout: 20000 });
    const panneau = await page.textContent('#fp-invite');
    assert.match(panneau, /Your score: level 1/);
    verifierPropre(o, 'MotionBall 2');
  } finally { await o.ctx.close(); }
});

test('MotionBall 2 en français : rien ne change', { skip: SAUTER, timeout: 180000 }, async () => {
  const o = await ouvrir('/mb2/?invite=1', 'fr');
  try {
    const { page } = o;
    await mb2Menu(page);
    await page.evaluate(() => Mb2Jeu.Manager.gotoAide());
    await attendre(1500);
    await page.evaluate(() => Mb2Jeu.Manager.startGame(Mb2Jeu.Const.MODE_CLASSIC));
    await page.waitForFunction(() => Mb2Jeu.Manager.mode && Mb2Jeu.Manager.mode.constructor.name === 'Game', null, { timeout: 30000 });
    await page.evaluate(() => Mb2Jeu.Manager.gameOver(Mb2Jeu.Const.CAUSE_NOBALLS));
    await attendreEcrit(page, 'Votre score : niveau 1');
    const vu = await ecrits(page);
    for (const t of ['Click to', 'Help the poor ball find its way through a dreadful maze!']) assert.ok(!vu.includes(t), 'pas de texte figé récrit : ' + t);
    sansAnglais(o, 'MotionBall 2');
    verifierPropre(o, 'MotionBall 2');
  } finally { await o.ctx.close(); }
});
