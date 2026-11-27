/*
 * LE MODE INVITÉ DES JEUX — lot A : Swapou, Frutisnake, Kaluga, Burning Kiwi,
 * Mini-Fever.
 *
 * Depuis l'accueil, un visiteur sans compte ouvre `/<jeu>/?invite=1`
 * (public/js/invite.js). Ce que ces tests verrouillent, jeu par jeu, dans un
 * vrai Chromium :
 *
 *   · AUCUN SID, JAMAIS. On sème avant le chargement la session du light
 *     (`localStorage.fp_light_session`) et celle de l'onglet (sessionStorage,
 *     la clé de sid-discret.js) : ni l'une ni l'autre ne doit partir. Aucune
 *     adresse ne porte `sid=`, aucune route de session n'est appelée — certaines
 *     retombent, faute de sid, sur « la dernière session vue de cette IP »
 *     (/api/loadFrutiSlots) : un invité y lirait la partie d'un membre ;
 *   · LA VERSION COMPLÈTE, en mémoire : l'état du jeu est lu dans la page
 *     (persos, tzongres, coupes, écuries, modes) — sans les options payantes
 *     de la boutique ni l'outil de l'admin ;
 *   · LE PANNEAU DE FIN : `FPInvite.finDePartie` est espionné, puis chaque jeu
 *     est mené à sa fin. Comment, c'est dit jeu par jeu — une vraie partie
 *     quand elle est courte, sinon la routine de fin DU JEU appelée telle
 *     quelle, et la suite (écrans de fin, clics, touches) jouée pour de vrai ;
 *   · LE JOUEUR CONNECTÉ NE VOIT RIEN CHANGER : avec un vrai sid, pas de
 *     panneau, et la fiche complète n'est pas forcée.
 *
 * Le serveur tourne sans base (DATABASE_URL vide), ses fichiers dans un
 * dossier temporaire (FRUTI_DATA_DIR). Express refuse de servir un chemin qui
 * traverse un dossier caché (un arbre de travail rangé sous un dossier à point) : on passe
 * alors par un lien symbolique sans point, comme le kit de la bande-annonce.
 * Sans Playwright, les tests sont sautés.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 4231;
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
let SID = '';

before(async () => {
  if (!PW) return;
  let racine = ROOT;
  if (ROOT.split(path.sep).some((s) => s.startsWith('.'))) {
    lien = path.join(os.tmpdir(), 'mode-invite-jeux-a-' + PORT);
    try { fs.unlinkSync(lien); } catch { /* pas de lien précédent */ }
    fs.symlinkSync(ROOT, lien);
    racine = lien;
  }
  donnees = fs.mkdtempSync(path.join(os.tmpdir(), 'mode-invite-jeux-a-donnees-'));
  proc = spawn(process.execPath, ['--preserve-symlinks', '--preserve-symlinks-main', path.join(racine, 'server.js')], {
    cwd: racine,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', XMLSOCKET_PORT: '4232', FRUTISCORE_PORT: '4233',
      REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000', FRUTI_DATA_DIR: donnees,
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  let pret = false;
  for (let i = 0; i < 240 && !pret; i++) {
    try { pret = (await fetch(BASE + '/swapou/index.html')).ok; } catch { /* pas prêt */ }
    if (!pret) await attendre(250);
  }
  if (!pret) throw new Error('serveur indisponible');
  navigateur = await PW.chromium.launch();
  // Un vrai compte, pour la partie « connecté ».
  const corps = JSON.stringify({ username: 'invitea' + (Date.now() % 100000), password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corps });
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corps });
  SID = (await r.json()).sid || '';
});

after(async () => {
  if (navigateur) await navigateur.close().catch(() => {});
  if (proc) proc.kill('SIGKILL');
  if (lien) { try { fs.unlinkSync(lien); } catch { /* déjà parti */ } }
  if (donnees) { try { fs.rmSync(donnees, { recursive: true, force: true }); } catch { /* rien */ } }
});

// ── Les outils ──────────────────────────────────────────────────────────────

// Les routes qu'un invité ne doit JAMAIS toucher : la session, les sauvegardes,
// les scores, les parties vérifiées, l'anti-triche, les quêtes, le voyant.
const INTERDITES = ['/api/loadFrutiSlots', '/api/saveFrutiSlot', '/api/light/profile', '/api/saveScore',
  '/do/fdclaim', '/api/fd/status', '/api/partie/', '/api/quetes/', '/api/light/jeu-en-cours',
  '/api/antitriche/', '/api/swapou/', '/api/kaluga/', '/api/bkiwi/ghost', '/api/minifever/partie'];

function verifierRequetes(requetes, jeu) {
  assert.ok(requetes.length > 0, jeu + ' : des requêtes ont bien été relevées');
  for (const r of requetes) {
    assert.ok(!/sid=/.test(r.url), jeu + ' : une adresse porte un sid — ' + r.url);
    assert.ok(!/fuite/.test(r.url + ' ' + r.corps), jeu + ' : une session semée est partie — ' + r.url);
    let chemin = r.url;
    try { chemin = new URL(r.url).pathname; } catch { /* blob:, data: */ }
    for (const p of INTERDITES) assert.ok(!chemin.startsWith(p), jeu + ' : route interdite à l\'invité — ' + r.url);
  }
}

// Une page de jeu, avec ses requêtes relevées (WebSocket comprises). En mode
// invité, on sème d'abord les deux sessions qu'un navigateur partagé pourrait
// garder : celle du light, et celle de l'onglet (sid-discret.js).
async function ouvrir(chemin, viewport, semer) {
  const ctx = await navigateur.newContext({ viewport: viewport || { width: 900, height: 620 } });
  if (semer) {
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem('fp_light_session', JSON.stringify({ sid: 'fuite-light', username: 'membre' }));
        sessionStorage.setItem('fp_sid_page:' + location.pathname, 'fuite-onglet');
      } catch (e) { /* stockage refusé */ }
    });
  }
  const page = await ctx.newPage();
  const requetes = [];
  const erreurs = [];
  page.on('request', (r) => requetes.push({ url: r.url(), corps: r.postData() || '' }));
  page.on('websocket', (w) => requetes.push({ url: w.url(), corps: '' }));
  page.on('pageerror', (e) => erreurs.push(e.message));
  await page.goto(BASE + chemin);
  return { ctx, page, requetes, erreurs };
}

// L'espion : chaque appel du panneau est noté, et le panneau s'ouvre quand même.
async function espionner(page) {
  await page.evaluate(() => {
    window.__appels = [];
    const vrai = window.FPInvite.finDePartie;
    window.FPInvite.finDePartie = function (o) {
      window.__appels.push({ score: o && o.score, libelle: o && o.libelle, rejouer: typeof (o && o.surRejouer) });
      return vrai.apply(this, arguments);
    };
  });
}
const appels = (page) => page.evaluate(() => window.__appels.slice());
const panneau = (page) => page.evaluate(() => !!document.getElementById('fp-invite'));
async function cliquerAuCentre(page, selecteur) {
  const r = await page.evaluate((s) => document.querySelector(s).getBoundingClientRect().toJSON(), selecteur);
  await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
}

// ── SWAPOU ──────────────────────────────────────────────────────────────────
//
// La fin : une partie de Challenge (puis de Classique) est posée comme le fait
// le menu, et la routine de fin du jeu, Manager.gameOver — celle qu'appelle
// Challenge.turnDone quand le plateau déborde —, est appelée avec un score :
// remplir le plateau prendrait des minutes. Le clic qui ferme la boîte de fin
// est un vrai clic.

async function swapouPartie(page, mode, score) {
  await page.evaluate(([mode, score]) => {
    SW.Data.gameMode = SW.Data[mode]; SW.Data.essai = false; SW.Data.players = [0, -1];
    const ancien = SW.Manager.mode;
    SW.Manager.mode = mode === 'CLASSIC' ? new SW.Classic() : new SW.Challenge();
    if (ancien && ancien.destroy) ancien.destroy();
    SW.Manager.mode.player.score = score;
    SW.Manager.gameOver(score);
  }, [mode, score]);
  await page.waitForFunction(() => { const g = SW.Manager.mode; return g.constructor === SW.GameOver && !g.lock && g.lock_time <= 0; }, null, { timeout: 15000 });
  await cliquerAuCentre(page, '#stage');
  await attendre(300);
}

test('Swapou invité : tous les persos et le Classique, aucun sid, le panneau après la boîte de fin', { skip: SAUTER, timeout: 120000 }, async () => {
  const { ctx, page, requetes, erreurs } = await ouvrir('/swapou/?invite=1', null, true);
  try {
    await page.waitForFunction(() => window.SW && SW.Manager && SW.Manager.client && SW.Manager.client.connected, null, { timeout: 30000 });
    const etat = await page.evaluate(() => {
      const c = SW.Manager.client;
      return { actif: FPInvite.actif, sid: c.sid, standalone: c.standalone, chars: SW.Data.chars.slice(),
        sucre: !!c.slots[0].$items[6], features: Object.keys(c.features) };
    });
    assert.deepStrictEqual(etat, { actif: true, sid: '', standalone: true, chars: Array(9).fill(true), sucre: true, features: [] },
      'les neuf persos, le sucre (le Classique s\'ouvre) — et ni compteur de coups ni analyse');
    await espionner(page);

    await swapouPartie(page, 'CHALLENGE', 1234);
    assert.deepStrictEqual(await appels(page), [{ score: '1234', libelle: 'Ton score', rejouer: 'function' }]);
    assert.ok(await panneau(page), 'le panneau est posé');
    assert.strictEqual(await page.evaluate(() => SW.Manager.mode.constructor === SW.GameOver), true, 'le menu attend la fermeture');
    await page.click('#fp-invite .fpi-non');
    await page.waitForFunction(() => SW.Manager.mode.constructor === SW.Menu, null, { timeout: 5000 });
    assert.ok(!(await panneau(page)), '« Rejouer » ferme le panneau et rend le menu');

    await swapouPartie(page, 'CLASSIC', 870);
    assert.deepStrictEqual((await appels(page))[1], { score: '870', libelle: 'Ton score', rejouer: 'function' }, 'le Classique aussi');
    await page.click('#fp-invite .fpi-non');

    // Le Pot au feu et le Duel n'ont pas de score : pas de panneau.
    await page.evaluate(() => { SW.Data.gameMode = SW.Data.DUEL; SW.Manager.gameOver(1); });
    await page.waitForFunction(() => { const g = SW.Manager.mode; return g.constructor === SW.GameOver && g.lock_time <= 0; }, null, { timeout: 15000 });
    await cliquerAuCentre(page, '#stage');
    await attendre(300);
    assert.strictEqual((await appels(page)).length, 2, 'le Duel ne pose pas de panneau');

    verifierRequetes(requetes, 'swapou');
    assert.deepStrictEqual(erreurs, []);
  } finally { await ctx.close(); }
});

test('Swapou connecté : la fiche du compte, pas de panneau', { skip: SAUTER, timeout: 90000 }, async () => {
  const { ctx, page, erreurs } = await ouvrir('/swapou/?sid=' + SID);
  try {
    await page.waitForFunction(() => window.SW && SW.Manager && SW.Manager.client && SW.Manager.client.connected, null, { timeout: 30000 });
    const etat = await page.evaluate(() => ({ actif: FPInvite.actif, sid: !!SW.Manager.client.sid,
      chars: SW.Data.chars.slice(0, 3), sucre: !!(SW.Manager.client.slots[0].$items || [])[6] }));
    assert.deepStrictEqual(etat, { actif: false, sid: true, chars: [true, true, false], sucre: false });
    await espionner(page);
    await page.evaluate(() => {
      SW.Data.gameMode = SW.Data.CLASSIC; SW.Data.essai = false; SW.Data.players = [0, -1];
      const ancien = SW.Manager.mode;
      SW.Manager.mode = new SW.Classic();
      if (ancien && ancien.destroy) ancien.destroy();
      SW.Manager.gameOver(500);
    });
    await page.waitForFunction(() => { const g = SW.Manager.mode; return g.constructor === SW.GameOver && !g.lock && g.lock_time <= 0; }, null, { timeout: 15000 });
    await cliquerAuCentre(page, '#stage');
    await page.waitForFunction(() => SW.Manager.mode.constructor === SW.Menu, null, { timeout: 5000 });
    assert.deepStrictEqual(await appels(page), []);
    assert.ok(!(await panneau(page)));
    assert.deepStrictEqual(erreurs, []);
  } finally { await ctx.close(); }
});

// ── FRUTISNAKE ──────────────────────────────────────────────────────────────
//
// La fin : une vraie partie de Challenge, lancée par le menu ; la mort vient
// de la routine du moteur, partie.game_over() (le serpent explose, puis
// `finPartie`). L'écran de fin se ferme d'un vrai clic.

async function snakeFin(page, score) {
  await page.evaluate(() => window.__frutisnake.choixMenu(1));
  await page.waitForFunction(() => { const j = window.__frutisnake; return j.mode && j.mode.partie && j.next_mode === -1; }, null, { timeout: 30000 });
  await page.evaluate((s) => { const p = window.__frutisnake.mode.partie; p.score = s; p.game_over(); }, score);
  await page.waitForFunction(() => { const v = window.__frutisnake.mode; return v.ecran && v.ecran.surPresse && v.ecran.frame === 7; }, null, { timeout: 30000 });
}

test('Frutisnake invité : aucun sid, le Battle en ligne grisé, le panneau après l\'écran de fin', { skip: SAUTER, timeout: 120000 }, async () => {
  const { ctx, page, requetes, erreurs } = await ouvrir('/snake3/?invite=1', null, true);
  try {
    await page.waitForFunction(() => window.__frutisnake && window.__frutisnake.mode, null, { timeout: 30000 });
    assert.deepStrictEqual(await page.evaluate(() => ({ actif: FPInvite.actif, sid: window.__frutisnake.plateforme.sid,
      options: Object.keys(window.__frutisnake.plateforme.options) })), { actif: true, sid: '', options: [] },
    'pas de sid, et pas le pack de la boutique');
    await espionner(page);

    // Le sous-menu Battle : la pastille 10 (en ligne) est grisée, et la choisir ne mène nulle part.
    await page.evaluate(() => window.__frutisnake.choixMenu(2));
    await page.waitForFunction(() => { const j = window.__frutisnake; return j.next_mode === -1 && j.mode && j.mode.menus && j.mode.menus.some((m) => m.id === 6); }, null, { timeout: 15000 });
    const pastilles = await page.evaluate(() => window.__frutisnake.mode.menus.map((m) => [m.id, m.inactif]));
    assert.deepStrictEqual(pastilles, [[6, false], [7, false], [8, false], [10, true], [5, false]]);
    await page.evaluate(() => window.__frutisnake.choixMenu(10));
    await attendre(300);
    assert.strictEqual(await page.evaluate(() => window.__frutisnake.next_mode), -1, 'la pastille grisée n\'ouvre pas le salon');
    await page.evaluate(() => window.__frutisnake.choixMenu(5));
    await page.waitForFunction(() => window.__frutisnake.next_mode === -1, null, { timeout: 15000 });

    // Le tournoi passe par le même refus « hors_ligne » que le Challenge.
    assert.strictEqual(await page.evaluate(() => window.__frutisnake.plateforme.sauverScoreTournoi(10).then((r) => r.error)), 'hors_ligne');

    await snakeFin(page, 4321);
    const texte = await page.evaluate(() => window.__frutisnake.mode.ecran.texte);
    assert.strictEqual(texte, 'Votre score : 4321\n', 'ni « ATTENTION » ni « Connectez-vous » pour l\'invité');
    assert.deepStrictEqual(await appels(page), [], 'le panneau attend que le joueur quitte l\'écran de fin');
    await cliquerAuCentre(page, '#scene');
    await attendre(300);
    assert.deepStrictEqual(await appels(page), [{ score: '4321', libelle: 'Ton score', rejouer: 'function' }]);
    assert.ok(await panneau(page));
    await page.click('#fp-invite .fpi-non');
    await page.waitForFunction(() => window.__frutisnake.next_mode === 0 || window.__frutisnake.mode.constructor.name === 'Menu', null, { timeout: 5000 });

    verifierRequetes(requetes, 'snake3');
    assert.ok(!requetes.some((r) => /^wss?:/.test(r.url)), 'aucune WebSocket ouverte');
    assert.deepStrictEqual(erreurs, []);
  } finally { await ctx.close(); }
});

test('Frutisnake connecté : le Battle en ligne ouvert, pas de panneau', { skip: SAUTER, timeout: 90000 }, async () => {
  const { ctx, page, erreurs } = await ouvrir('/snake3/?sid=' + SID);
  try {
    await page.waitForFunction(() => window.__frutisnake && window.__frutisnake.mode, null, { timeout: 30000 });
    assert.strictEqual(await page.evaluate(() => FPInvite.actif), false);
    await espionner(page);
    await page.evaluate(() => window.__frutisnake.choixMenu(2));
    await page.waitForFunction(() => { const j = window.__frutisnake; return j.next_mode === -1 && j.mode && j.mode.menus && j.mode.menus.some((m) => m.id === 6); }, null, { timeout: 15000 });
    assert.deepStrictEqual(await page.evaluate(() => window.__frutisnake.mode.menus.find((m) => m.id === 10).inactif), false);
    await page.evaluate(() => window.__frutisnake.choixMenu(5));
    await page.waitForFunction(() => window.__frutisnake.next_mode === -1, null, { timeout: 15000 });
    await snakeFin(page, 120);
    await cliquerAuCentre(page, '#scene');
    await attendre(400);
    assert.deepStrictEqual(await appels(page), []);
    assert.ok(!(await panneau(page)));
    assert.deepStrictEqual(erreurs, []);
  } finally { await ctx.close(); }
});

// ── KALUGA ──────────────────────────────────────────────────────────────────
//
// La fin : une vraie partie lancée par le menu ; le panneau de consignes se
// passe comme au clavier (startPanelForward), puis la routine de fin du jeu,
// Game.endGame — la porte gardée qu'empruntent le panier plein, la tzongre
// mangée ou le temps écoulé —, ferme la partie. Les pages du panneau de fin
// défilent par Panel.nextPage, ce que fait le bouton invisible qui le couvre.

async function kalugaPasserConsignes(page) {
  for (let i = 0; i < 60; i++) {
    if (await page.evaluate(() => KalugaJeu.manager.current.masterStep === 1)) return;
    await page.evaluate(() => { const g = KalugaJeu.manager.current; if (g.startPanel && g.startPanel._parent) g.startPanelForward(); });
    await attendre(200);
  }
  throw new Error('le panneau de consignes ne s\'est pas refermé');
}
// Fait défiler le panneau de fin jusqu'à sa dernière page (ou au panneau de
// l'invité) ; rend ce qu'on y a vu.
async function kalugaDefiler(page) {
  await page.waitForFunction(() => { const g = KalugaJeu.manager.current; return g.masterStep === 2 && g.endGamePanel && g.endGamePanel.sheet && g.endGamePanel.sheet.panel; }, null, { timeout: 30000 });
  for (let i = 0; i < 60; i++) {
    const st = await page.evaluate(() => {
      const g = KalugaJeu.manager.current;
      const p = g.endGamePanel && g.endGamePanel.sheet && g.endGamePanel.sheet.panel;
      if (!p) return { fini: true };
      const der = p.list[p.list.length - 1];
      const ici = p.list[p.pageNum];
      return { n: p.pageNum, len: p.list.length, derniere: typeof der === 'string' ? der : 'page',
        attend: !!(ici && typeof ici === 'object' && ici.wait), invite: !!document.getElementById('fp-invite') };
    });
    if (st.fini || st.invite || st.n >= st.len - 1) return st;
    // « sauvegarde du score… » : la page tourne d'elle-même à la réponse.
    if (!st.attend) await page.evaluate(() => KalugaJeu.manager.current.endGamePanel.sheet.panel.nextPage());
    await attendre(150);
  }
  throw new Error('le panneau de fin ne finit pas');
}
const kalugaMenu = (page) => page.waitForFunction(() => { const c = KalugaJeu.manager && KalugaJeu.manager.current; return c && c.menuList; }, null, { timeout: 60000 });

test('Kaluga invité : la fiche complète, aucun sid, le panneau au bout d\'une partie et d\'un triathlon', { skip: SAUTER, timeout: 180000 }, async () => {
  const { ctx, page, requetes, erreurs } = await ouvrir('/kaluga/?invite=1', null, true);
  try {
    await kalugaMenu(page);
    const etat = await page.evaluate(() => {
      const m = KalugaJeu.manager;
      return { actif: FPInvite.actif, sid: m.client.sid, tz: m.card.$tz, mode: m.card.$mode, seq: m.card.$seq, defi: m.card.$defi,
        menu: m.current.menuList.map((x) => x.name + (x.list ? ':' + x.list.length : '')) };
    });
    assert.deepStrictEqual(etat, {
      actif: true, sid: '', tz: [1, 1, 1, 1, 1],
      mode: [1, [1, 1, 1, 1, 1, 1, 1, 1, 1], [1, 1, 1, 1], [1, 1, 1, 1], [1, 1, 1, 1], [1, 1, 1, 1]],
      seq: [1, 1], defi: [1, 1, 1],
      // ESSAIS : sans session, le premier mode ne se classe pas (Client.isRanked).
      menu: ['ESSAIS', 'OLYMPIQUE:9', 'CHRONO:4', 'SURVIE:4', 'INVASION:4', 'PISTE:4', 'SEQUENCE:2', 'EPREUVES:3', 'PREPARATION', 'OPTIONS'],
    });
    await espionner(page);

    // Une partie de Challenge (« ESSAIS »).
    await page.evaluate(() => KalugaJeu.manager.current.selectSlot(0));
    await page.waitForFunction(() => { const c = KalugaJeu.manager.current; return c && c.type === '$classic' && c.stat; }, null, { timeout: 30000 });
    await kalugaPasserConsignes(page);
    await page.evaluate(() => { const g = KalugaJeu.manager.current; g.score = 5000; g.endGame(); });
    const fin = await kalugaDefiler(page);
    assert.strictEqual(fin.derniere, 'page', 'la dernière page est le « Rejouer ? » du jeu');
    assert.deepStrictEqual(await appels(page), [{ score: '5000', libelle: 'Ton score', rejouer: 'undefined' }]);
    // Le Titem et la Kagulga ne s'annoncent pas à l'invité.
    assert.strictEqual(await page.evaluate(() => KalugaJeu.manager.current.endPanelMiddle.some((p) => p.list && p.list.some((x) => /Titem|kagulga/i.test(x.text || '')))), false);
    await page.click('#fp-invite .fpi-non');
    assert.ok(!(await panneau(page)), 'le « Rejouer ? » du jeu reprend la main');
    await page.evaluate(() => KalugaJeu.manager.backToMenu());
    await kalugaMenu(page);

    // Un triathlon : trois épreuves ; le panneau ne vient qu'au bout, à la
    // place du retour au menu, qu'il rend en se fermant.
    await page.evaluate(() => KalugaJeu.manager.current.selectSlot(17));
    for (let ev = 0; ev < 3; ev++) {
      await page.waitForFunction((ev) => { const c = KalugaJeu.manager.current; return c && c.mode === 'triathlon' && c.stat && KalugaJeu.manager.tournament.eventId === ev; }, ev, { timeout: 30000 });
      await kalugaPasserConsignes(page);
      await page.evaluate(() => { const g = KalugaJeu.manager.current; g.score = 120; g.endGame(); });
      const st = await kalugaDefiler(page);
      if (ev < 2) {
        assert.strictEqual(st.derniere, 'page', 'entre deux épreuves : « Continuer ? »');
        assert.strictEqual((await appels(page)).length, 1, 'pas de panneau entre deux épreuves');
        await page.evaluate(() => KalugaJeu.manager.current.kill());          // « Continuer ? » → oui
      } else {
        assert.strictEqual(st.derniere, 'menu');
      }
    }
    const a = await appels(page);
    assert.strictEqual(a.length, 2);
    assert.match(a[1].score, /^[\d.]+ pts$/);
    assert.deepStrictEqual([a[1].libelle, a[1].rejouer], ['Ton total', 'function']);
    await page.click('#fp-invite .fpi-non');
    await kalugaMenu(page);

    verifierRequetes(requetes, 'kaluga');
    assert.deepStrictEqual(erreurs, []);
  } finally { await ctx.close(); }
});

test('Kaluga connecté : la fiche du compte, pas de panneau', { skip: SAUTER, timeout: 120000 }, async () => {
  const { ctx, page, erreurs } = await ouvrir('/kaluga/?sid=' + SID);
  try {
    await kalugaMenu(page);
    assert.deepStrictEqual(await page.evaluate(() => ({ actif: FPInvite.actif, tz: KalugaJeu.manager.card.$tz, makulo: KalugaJeu.manager.card.$makulo })),
      { actif: false, tz: [1, 0, 0, 0, 0], makulo: 0 });
    await espionner(page);
    await page.evaluate(() => KalugaJeu.manager.current.selectSlot(0));
    await page.waitForFunction(() => { const c = KalugaJeu.manager.current; return c && c.type === '$classic' && c.stat; }, null, { timeout: 30000 });
    await kalugaPasserConsignes(page);
    await page.evaluate(() => { const g = KalugaJeu.manager.current; g.score = 300; g.endGame(); });
    const fin = await kalugaDefiler(page);
    assert.strictEqual(fin.derniere, 'page');
    await attendre(200);
    assert.deepStrictEqual(await appels(page), []);
    assert.ok(!(await panneau(page)));
    assert.deepStrictEqual(erreurs, []);
  } finally { await ctx.close(); }
});

// ── BURNING KIWI ────────────────────────────────────────────────────────────
//
// La fin : une vraie course de contre-la-montre, lancée comme le fait la
// grille (mainPhase 3, cf. bkiwiCadence.test.js) ; boucler trois tours au
// pilote automatique prendrait des minutes, alors on pose le temps de course
// et l'on arme le compte à rebours de fin du moteur (`timerEnd`), celui que
// pose la ligne d'arrivée. Les écrans de fin (classement, stats) se passent à
// la barre d'espace, de vraies touches.

const bkiwiPret = (page) => page.waitForFunction(() => {
  const J = window.BkiwiJeu; const M = J && J.M;
  return M && M.vs && J.client && J.client.connected && M.trackStats && M.controls && M.controls[0] != null;
}, null, { timeout: 90000 });

async function bkiwiCourse(page, temps) {
  await page.evaluate(() => { const M = BkiwiJeu.M; M.musicON = false; M.vs.gameMode = M.TIMETRIAL; M.vs.selectedTrack = 0; M.vs.selectedCar = 2; M.vs.menuPhase = -1; M.vs.mainPhase = 3; });
  await page.waitForFunction(() => { const M = BkiwiJeu.M; return M.vs.mainPhase === 1 && M.cars && M.cars[0] && !M.starting; }, null, { timeout: 60000 });
  await page.evaluate((t) => { const M = BkiwiJeu.M; M.cars[0].vs.totalTime = t; M.timerEnd = 1; }, temps);
  await page.waitForFunction(() => BkiwiJeu.M.vs.mainPhase === 2, null, { timeout: 20000 });
  for (let i = 0; i < 40; i++) {
    if (await page.evaluate(() => BkiwiJeu.M.vs.mainPhase === 0 || !!document.getElementById('fp-invite'))) return;
    await page.keyboard.down('Space'); await attendre(100); await page.keyboard.up('Space');
    await attendre(250);
  }
  throw new Error('la fin de course ne rend pas le menu');
}

test('Burning Kiwi invité : coupes, écuries et modes ouverts, aucun sid, le panneau au retour au menu', { skip: SAUTER, timeout: 180000 }, async () => {
  const { ctx, page, requetes, erreurs } = await ouvrir('/bkiwi/?invite=1', { width: 700, height: 600 }, true);
  try {
    await bkiwiPret(page);
    const etat = await page.evaluate(() => {
      const J = BkiwiJeu, M = J.M;
      return {
        actif: FPInvite.actif, sid: J.client.sid, charge: J.client.charge,
        coupes: [M.vs.$ws, M.vs.$wss, M.vs.$wc, M.vs.$wcs], ecuries: M.availableCars.slice(), modes: M.frutiSlots[M.SLOT_MODES].slice(),
        records: M.trackStats.map((t) => t.$fcLap === Infinity && t.$fcTotal === Infinity),
        ouverts: [M.DUEL, M.SURVIVOR, M.KIWIRUN, M.GHOSTRUN, M.TIMETRIAL, M.FRUTICUP, M.TRAINING].map((m) => !!J.checkMode(m)),
        challenge: !!J.checkMode(M.ARCADE), enLigne: M.MULTI !== undefined ? !!J.checkMode(M.MULTI) : false,
        duJour: J.client.dailyData,
      };
    });
    assert.deepStrictEqual(Object.assign({}, etat, { duJour: !!etat.duJour }), {
      actif: true, sid: '', charge: false,
      coupes: [true, true, true, true], ecuries: [true, true, true, true, true], modes: Array(9).fill(true),
      records: Array(6).fill(true), ouverts: Array(7).fill(true),
      challenge: false, enLigne: false,        // les essais (pas de classement), la course en ligne grisée
      duJour: true,                            // la course du jour, publique
    });
    await espionner(page);

    await bkiwiCourse(page, 83456);
    assert.deepStrictEqual(await appels(page), [{ score: '1\'23"456', libelle: 'Ton temps', rejouer: 'undefined' }]);
    assert.ok(await panneau(page));
    assert.strictEqual(await page.evaluate(() => BkiwiJeu.M.vs.mainPhase), 0, 'le menu revient sous le panneau');
    await page.click('#fp-invite .fpi-non');

    // Entre deux courses d'un tournoi, gotoMenu ne pose PAS le panneau.
    assert.strictEqual(await page.evaluate(() => { const M = BkiwiJeu.M; M.skipToTrackPresent = true; M.vs.gameMode = M.FRUTICUP; const r = BkiwiJeu.finInvite(); M.skipToTrackPresent = false; return r; }), false);

    verifierRequetes(requetes, 'bkiwi');
    assert.ok(requetes.some((r) => /\/api\/bkiwi\/daily$/.test(r.url)), 'la course du jour vient du serveur, sans sid');
    assert.ok(!requetes.some((r) => /^wss?:/.test(r.url)), 'aucune WebSocket ouverte');
    assert.deepStrictEqual(erreurs, []);
  } finally { await ctx.close(); }
});

test('Burning Kiwi connecté : la fruticard du compte, pas de panneau', { skip: SAUTER, timeout: 150000 }, async () => {
  const { ctx, page, erreurs } = await ouvrir('/bkiwi/?sid=' + SID, { width: 700, height: 600 });
  try {
    await bkiwiPret(page);
    assert.deepStrictEqual(await page.evaluate(() => { const M = BkiwiJeu.M; return { actif: FPInvite.actif, ws: M.vs.$ws, wcs: M.vs.$wcs, ecuries: M.availableCars.slice() }; }),
      { actif: false, ws: false, wcs: false, ecuries: [false, false, true, true, false] });
    await espionner(page);
    await bkiwiCourse(page, 90000);
    await attendre(300);
    assert.deepStrictEqual(await appels(page), []);
    assert.ok(!(await panneau(page)));
    assert.deepStrictEqual(erreurs, []);
  } finally { await ctx.close(); }
});

// ── MINI-FEVER ──────────────────────────────────────────────────────────────
//
// Le fever : une VRAIE partie — le lien « fever » du bandeau, puis la
// première épreuve, perdue d'elle-même quand son temps s'écoule ; le clic sur
// l'écran gameOver est un vrai clic. L'arcade (sept vies) serait trop longue :
// elle part d'un vrai clic sur « facile », puis le débriefing du moteur
// (Arcade.initEtape(1)) est appelé sur la dernière vie, avec douze épreuves
// gagnées — c'est lui qui clôt la partie.

const feverPret = (page) => page.waitForFunction(() => window.__minifever && window.__minifever.socle, null, { timeout: 60000 });

async function arcadeFin(page) {
  await page.click('#modes a:text-is("facile")');
  await page.waitForFunction(() => { const s = window.__minifever.socle; return s && s.palier === 0 && s.info && !s.termine; }, null, { timeout: 30000 });
  await page.evaluate(() => { const s = window.__minifever.socle; s.niveau = 12; s.vies = 1; s.derniere = false; s.initEtape(1); });
  await page.waitForFunction(() => window.__minifever.socle.termine, null, { timeout: 30000 });
}

test('Mini-Fever invité : aucun sid, le panneau au bout du fever et de l\'arcade', { skip: SAUTER, timeout: 150000 }, async () => {
  const { ctx, page, requetes, erreurs } = await ouvrir('/minifever/?invite=1', { width: 600, height: 700 }, true);
  try {
    await feverPret(page);
    assert.strictEqual(await page.evaluate(() => FPInvite.actif), true);
    await espionner(page);

    await page.click('#modes a:text-is("fever")');
    await page.waitForFunction(() => { const s = window.__minifever.socle; return s && s.ecranFin; }, null, { timeout: 60000 });
    assert.deepStrictEqual(await appels(page), [], 'l\'écran gameOver d\'abord');
    await cliquerAuCentre(page, '#stage');
    await attendre(300);
    const a = await appels(page);
    assert.strictEqual(a.length, 1);
    assert.match(a[0].score, /^\d+$/);
    assert.deepStrictEqual([a[0].libelle, a[0].rejouer], ['Épreuves remportées', 'function']);
    assert.strictEqual(await page.evaluate(() => window.__minifever.socle.ecranFin), true, 'la relance attend le panneau');
    await page.click('#fp-invite .fpi-non');
    await page.waitForFunction(() => !window.__minifever.socle.ecranFin, null, { timeout: 5000 });

    await arcadeFin(page);
    assert.doesNotMatch(await page.textContent('#etat'), /connecte-toi/, 'pas de « connecte-toi » au bandeau');
    await page.waitForFunction(() => !!document.getElementById('fp-invite'), null, { timeout: 5000 });
    assert.deepStrictEqual((await appels(page))[1], { score: '120 pts', libelle: 'Ton score', rejouer: 'function' },
      '12 épreuves × 10 points, palier facile (× 1)');
    await page.click('#fp-invite .fpi-non');
    await page.waitForFunction(() => !window.__minifever.socle.termine, null, { timeout: 10000 });

    verifierRequetes(requetes, 'minifever');
    assert.deepStrictEqual(erreurs, []);
  } finally { await ctx.close(); }
});

test('Mini-Fever connecté : pas de panneau', { skip: SAUTER, timeout: 90000 }, async () => {
  const { ctx, page, erreurs } = await ouvrir('/minifever/?sid=' + SID, { width: 600, height: 700 });
  try {
    await feverPret(page);
    assert.strictEqual(await page.evaluate(() => FPInvite.actif), false);
    await espionner(page);
    await arcadeFin(page);
    await attendre(1800);                     // plus que le délai du panneau de l'invité
    assert.deepStrictEqual(await appels(page), []);
    assert.ok(!(await panneau(page)));
    assert.deepStrictEqual(erreurs, []);
  } finally { await ctx.close(); }
});

// ── AU DOIGT ────────────────────────────────────────────────────────────────
//
// Sur un téléphone, les boutons du panneau doivent répondre au doigt. Swapou
// écoute le toucher sur la FENÊTRE et annule l'action par défaut : un doigt
// levé sur « Rejouer » n'y faisait plus un clic, et le panneau restait. Ici le
// panneau est posé tel quel (FPInvite.finDePartie), puis touché pour de vrai.

test('au doigt, sur un téléphone, « Rejouer » ferme le panneau dans les cinq jeux', { skip: SAUTER, timeout: 240000 }, async () => {
  const PRETS = {
    swapou: () => window.SW && SW.Manager && SW.Manager.client && SW.Manager.client.connected,
    snake3: () => window.__frutisnake && window.__frutisnake.mode,
    kaluga: () => window.KalugaJeu && KalugaJeu.manager && KalugaJeu.manager.current && KalugaJeu.manager.current.menuList,
    bkiwi: () => window.BkiwiJeu && BkiwiJeu.M && BkiwiJeu.M.vs && BkiwiJeu.client && BkiwiJeu.client.connected,
    minifever: () => window.__minifever && window.__minifever.socle,
  };
  for (const [jeu, pret] of Object.entries(PRETS)) {
    const ctx = await navigateur.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
    try {
      const page = await ctx.newPage();
      await page.goto(BASE + '/' + jeu + '/?invite=1');
      await page.waitForFunction(pret, null, { timeout: 90000 });
      await page.evaluate(() => { window.__rejoue = 0; FPInvite.finDePartie({ score: 1, surRejouer: () => { window.__rejoue++; } }); });
      await page.tap('#fp-invite .fpi-non');
      await attendre(300);
      assert.deepStrictEqual(await page.evaluate(() => ({ ferme: !document.getElementById('fp-invite'), rejoue: window.__rejoue })),
        { ferme: true, rejoue: 1 }, jeu);
    } finally { await ctx.close(); }
  }
});

// ── LES PAGES ───────────────────────────────────────────────────────────────

test('les cinq pages chargent invite.js juste après sid-discret.js, avant tout autre script', () => {
  for (const jeu of ['swapou', 'snake3', 'kaluga', 'bkiwi', 'minifever']) {
    const html = fs.readFileSync(path.join(ROOT, 'public', jeu, 'index.html'), 'utf8');
    assert.ok(html.includes('<script src="/js/sid-discret.js"></script>\n<script src="/js/invite.js"></script>'), jeu);
  }
});
