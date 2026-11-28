'use strict';
/*
 * SWAPOU EN DEUX LANGUES
 * ══════════════════════
 *
 * Le français reste écrit dans le code du jeu ; l'anglais vit dans
 * public/swapou/lang/en.js (clés `swapou.*`), chargé par index.html quand la
 * langue est l'anglais. Ce que ces tests verrouillent :
 *
 *   1. SANS i18n.js — le bac à sable du serveur qui rejoue les parties, les
 *      tests, les outils —, le jeu parle le français d'avant, gabarits
 *      remplis, et ses grands tableaux sont ceux du code ;
 *   2. LE DICTIONNAIRE a la forme exacte du français (une réplique de plus ou
 *      de moins décalerait le tirage), s'écrit dans les fontes ASCII de 2005,
 *      et laisse les jeux de mots en français (choix de l'admin) ;
 *   3. le panneau de l'analyse (l'« IA ») dans les deux langues ;
 *   4. DANS CHROMIUM, en mode invité : le menu, une réplique, le Pot au feu,
 *      les fins (lettrage « victory! ») et le panneau d'inscription en
 *      anglais, sans requête manquée ni erreur ; puis le français, inchangé,
 *      sans rien télécharger de l'anglais.
 *
 * Le serveur tourne sans base. Express refuse un chemin qui traverse un
 * dossier caché (un arbre de travail rangé sous un dossier à point) : on
 * passe alors par un lien symbolique sans point. Sans Playwright, la partie
 * navigateur est sautée.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SWAPOU = path.join(ROOT, 'public', 'swapou');
const lire = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const FICHIERS = ['engine.js', 'assets.js', 'ui.js', 'data.js', 'game.js', 'screens.js'];

// ── Un Swapou sans navigateur, avec ou sans l'anglais ───────────────────────
function bac(langue) {
  const s = {
    console: { log() {}, warn() {}, error() {}, info() {} },
    setTimeout, clearTimeout, URLSearchParams, Intl,
    performance: { now: () => Date.now() }, Date, Math, JSON,
  };
  s.self = s;
  s.window = s;
  vm.createContext(s);
  if (langue) {
    s.document = { readyState: 'complete', documentElement: {} };
    s.location = { search: '?lang=' + langue };
    s.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
    vm.runInContext(lire('public/js/i18n.js'), s, { filename: 'i18n.js' });
    vm.runInContext(lire('public/swapou/lang/en.js'), s, { filename: 'en.js' });
    assert.equal(s.FPI18n.langue, langue);
  }
  for (const f of FICHIERS) vm.runInContext(fs.readFileSync(path.join(SWAPOU, f), 'utf8'), s, { filename: f });
  s.SW.A.img = (n) => ({ nom: n, naturalWidth: 130, naturalHeight: 133, complete: true });
  s.SW.A.has = () => false;
  s.SW.A.play = () => {};
  s.SW.A.playMusic = () => {};
  // Le menu des modes lit l'inventaire (le sucre ouvre le Classique).
  s.SW.Manager.client = { slots: [{ $items: [] }], savePrefs() {} };
  s.DATA = vm.runInContext('SwapouData', s);
  return s;
}

// Un contexte 2D qui ne garde que les textes écrits.
function ctxTextes() {
  const textes = [];
  const rien = () => {};
  const ctx = new Proxy({ textes }, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'fillText') return (s) => textes.push(String(s));
      if (k === 'measureText') return (s) => ({ width: String(s).length * 7 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop: rien });
      return rien;
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  return ctx;
}

function boutons(SW, phase) {
  const menu = new SW.Menu();
  menu.jump(phase);
  return { menu, labels: menu.btList.map((b) => b.label), aides: menu.btList.map((b) => b.help), titres: menu.titles.map((t) => t.text) };
}

// ── 1. Sans i18n.js : le français d'avant ───────────────────────────────────

test('sans i18n.js, Swapou parle le français d’avant, tableaux du code compris', () => {
  const s = bac(null);
  const SW = s.SW, DATA = s.DATA;
  assert.equal(s.FPI18n, undefined, 'pas de module des langues (le rejeu du serveur, les tests)');

  let m = boutons(SW, 10);
  assert.deepEqual(m.labels, [' jouer ', ' options ']);
  assert.deepEqual(m.aides, ['Choisir un mode de jeu', 'Paramètres de jeu']);
  m = boutons(SW, 11);
  assert.deepEqual(m.titres, ['Paramètres de jeu']);
  assert.deepEqual(m.labels.slice(0, 3), ['son :  oui ', 'musique :  oui ', 'details :  hauts '], 'deux espaces, comme avant');
  m = boutons(SW, 20);
  assert.deepEqual(m.labels, [' challenge ', ' essai ', ' duel ', 'pot au feu', ' classique ', ' retour ']);
  assert.equal(m.aides[1], 'Le Challenge pour s\'entraîner : illimité, hors classement (les pictos comptent)');
  m = boutons(SW, 42);
  assert.deepEqual(m.titres, ['Difficulté']);
  assert.deepEqual(m.labels, [' enfantin ', ' facile ', ' moyen ', ' difficile ', ' sauvage ', ' retour ']);

  // Les tableaux de data.js : ceux du code, tels quels (même objet).
  assert.equal(DATA.TAUNT_QUESTION[0][0], 'Abandonne ! tu n\'as aucune chance contre moi !');
  assert.equal(DATA.TAUNT_LOOSE[5][6], 'Savoure ta victoire, petit scarabée, la joie sera de courte durée.');
  assert.equal(DATA.SCENARIO[0][2].txt, 'Il était une fois, au royaume de Légumia...');
  assert.equal(DATA.SCENARIO[7].filter((d) => d.txt).pop().txt, 'Fin');
  assert.equal(DATA.TXT_VOTRE_SCORE(12), 'votre score : 12');
  assert.equal(DATA.TXT_PLACE_GAGNEES(1), 'vous avez gagné une place dans le classement !');
  assert.equal(DATA.TXT_PLACE_GAGNEES(3), 'vous avez gagné 3 places dans le classement !');
  assert.equal(DATA.TXT_VOTRE_PLACE(4), 'votre classement aujourd\'hui : 4');

  // La boîte de fin, le titem, le classique.
  const g = new SW.GameOver({ main() {}, draw() {}, destroy() {} });
  g.winTitem(1);
  assert.equal(g.titemText, 'Vous avez gagné un nouveau titem Frutiparc !');
  g.winTitem(4);
  assert.equal(g.titemText, 'Vous avez gagné 4 nouveaux titems Frutiparc !');
  assert.equal(SW.U.tr('swapou.niveau', 'Niveau {n}', { n: 3 }), 'Niveau 3');
  assert.equal(SW.U.lettrage('victoire!', 'or'), null, 'pas de canevas hors navigateur : l’image d’origine');
});

// ── 2. Le dictionnaire ──────────────────────────────────────────────────────

test('le dictionnaire anglais : même forme que le français, ASCII, jeux de mots en français', () => {
  const fr = bac(null), en = bac('en');
  const dico = en.FPI18n._dicos.en;
  for (const k of Object.keys(dico).filter((k) => !k.startsWith('commun.') && !k.startsWith('widgets.'))) {
    assert.ok(k.startsWith('swapou.'), 'clé hors zone : ' + k);
  }
  // Les répliques : autant par perso qu'en français, toutes traduites.
  for (const k of ['TAUNT_QUESTION', 'TAUNT_ANSWER', 'TAUNT_WINS', 'TAUNT_LOOSE']) {
    assert.deepEqual(en.DATA[k].map((r) => r.length), fr.DATA[k].map((r) => r.length), k);
  }
  for (const [cle, k] of [['question', 'TAUNT_QUESTION'], ['reponse', 'TAUNT_ANSWER'], ['victoire', 'TAUNT_WINS'], ['defaite', 'TAUNT_LOOSE']]) {
    assert.deepEqual(dico['swapou.repliques.' + cle].map((r) => r.length), fr.DATA[k].map((r) => r.length), 'swapou.repliques.' + cle);
  }
  // Le scénario : une chaîne par ligne de texte de chaque phase.
  const lignes = (sc) => sc.map((ph) => ph.filter((d) => d.txt !== undefined).length);
  assert.deepEqual(dico['swapou.scenario'].map((ph) => ph.length), lignes(fr.DATA.SCENARIO));
  // La structure du scénario ne bouge pas : qui parle, quelle cinématique.
  const forme = (sc) => sc.map((ph) => ph.map((d) => JSON.stringify(Object.assign({}, d, { txt: d.txt === undefined ? undefined : 1 }))));
  assert.deepEqual(forme(en.DATA.SCENARIO), forme(fr.DATA.SCENARIO));
  assert.equal(en.DATA.SCENARIO[0][2].txt, 'Once upon a time, in the kingdom of Legumia...');
  assert.equal(en.DATA.SCENARIO[0][7].txt, '$#! $#!', 'les marques des jumeaux restent');
  // Les combos, les pouvoirs : la forme du code.
  assert.equal(dico['swapou.combos'].length, 11);
  assert.equal(dico['swapou.combosClassique'].length, 9);
  assert.equal(dico['swapou.attaques'].length, en.SW.E.ATTACK_NAMES.length);
  assert.equal(dico['swapou.defenses'].length, en.SW.E.DEFENSE_NAMES.length);
  // Les jeux de mots restent en français : null, donc le français du code.
  const atq = en.SW.U.tr.table('swapou.attaques', en.SW.E.ATTACK_NAMES);
  const dfs = en.SW.U.tr.table('swapou.defenses', en.SW.E.DEFENSE_NAMES);
  assert.equal(atq[2], 'PETIT PEPIN');
  assert.equal(dfs[0], ' MOISE ');
  assert.equal(dfs[4], 'COLORANT E21');
  assert.equal(atq[4], ' EARTHQUAKE ');
  const combos = en.SW.U.tr.grille('swapou.combos', [['a', 'b'], ['a', 'b'], ['a', 'b'], ['a', 'b'], ['a', 'b'], ['kiwi-ti-kiwi'], ['orange', "folie's"], ['a', 'b'], ['a', 'b'], ['a', 'b'], ['cocktail', 'swapolotof']]);
  assert.deepEqual([combos[5], combos[6], combos[10]], [['kiwi-ti-kiwi'], ['orange', "folie's"], ['cocktail', 'swapolotof']]);
  assert.deepEqual(combos[0], ['strawberry', 'jam']);
  // Les noms des épices ne se traduisent pas.
  assert.deepEqual(en.SW.E.CHAR_NAMES, fr.SW.E.CHAR_NAMES);
  assert.match(dico['swapou.scenario'][3].slice(-1)[0], /Chevalier Moutarde$/);
  // Les fontes de 2005 n'ont que l'ASCII : ni apostrophe courbe, ni « … », ni accent.
  const tout = JSON.stringify(Object.fromEntries(Object.entries(dico).filter(([k]) => k.startsWith('swapou.'))));
  for (const c of ['’', '…', 'é', 'è', 'à', 'ê', 'ç', 'É', 'â', 'î', 'ô', 'û']) assert.ok(!tout.includes(c), 'caractère hors ASCII : ' + c);
});

test('les gabarits anglais : pluriels, trous, tableaux', () => {
  const en = bac('en');
  const SW = en.SW, DATA = en.DATA;
  let m = boutons(SW, 11);
  assert.deepEqual(m.titres, ['Game settings']);
  assert.deepEqual(m.labels.slice(0, 3), ['sound:  on ', 'music:  on ', 'details:  high ']);
  m = boutons(SW, 20);
  assert.deepEqual(m.labels, [' challenge ', ' practice ', ' duel ', 'pot au feu', ' classic ', ' back ']);
  assert.equal(m.aides[3], 'Progress through the story and unlock new characters');
  assert.equal(DATA.TXT_PLACE_GAGNEES(1), 'you climbed one place in the rankings!');
  assert.equal(DATA.TXT_PLACE_GAGNEES(0 + 5), 'you climbed 5 places in the rankings!');
  assert.equal(DATA.TXT_VOTRE_RECORD(900), 'your personal best: 900');
  const g = new SW.GameOver({ main() {}, draw() {}, destroy() {} });
  g.winTitem(1);
  assert.equal(g.titemText, 'You won a new Frutiparc titem!');
  g.winTitem(2);
  assert.equal(g.titemText, 'You won 2 new Frutiparc titems!');
  assert.equal(SW.U.tr('swapou.niveau', 'Niveau {n}', { n: 7 }), 'Level 7');
});

// ── 3. Le panneau de l'analyse ──────────────────────────────────────────────

function panneau(s, conseil) {
  const SW = s.SW;
  SW.Data.players = [3, -1];   // Poivre : sa défense est COMBOS CLASSIQUES (DEFENSE_PLAYERS[3])
  const a = new SW.AnalyseChallenge({ lock: true, pause: { activated: () => false } });
  a.conseil = conseil;
  const ctx = ctxTextes();
  a.drawPanneau(ctx, conseil);
  return ctx.textes;
}
const COMBO = { nature: 'combo', gain: { score: 120, pieces: 5, phases: 2 } };
const PREP = { nature: 'preparation', suite: { score: 300, pieces: 4, phases: 1 } };
const DEF = { nature: 'defense', gain: { score: 0, cracked: 2 }, pleine: true };

test('le panneau de l’IA, en français puis en anglais', () => {
  const fr = bac(null), en = bac('en');
  const conseil = { coups: [COMBO, PREP, DEF], meilleur: COMBO, tempsMs: 12 };
  assert.deepEqual(panneau(fr, conseil), ['IA', 'JOUER', 'COMBO', '+120', '5 fruits · 2 phases', '2. prép. 300', '3. défense', '12 ms']);
  assert.deepEqual(panneau(en, conseil), ['AI', 'PLAY', 'COMBO', '+120', '5 fruits · 2 phases', '2. prep. 300', '3. defence', '12 ms']);
  const nom = fr.SW.E.DEFENSE_NAMES[fr.SW.E.DEFENSE_PLAYERS[3]].trim() + ' ' + fr.SW.E.DEFENSE_STARS[3] + '★';
  const d = { coups: [DEF], meilleur: DEF };
  assert.deepEqual(panneau(fr, d), ['IA', 'JOUER', nom, 'pouvoir', '2 armures', 'banque pleine : à dépenser']);
  const nomEn = en.SW.U.tr.table('swapou.defenses', en.SW.E.DEFENSE_NAMES)[en.SW.E.DEFENSE_PLAYERS[3]].trim() + ' ' + en.SW.E.DEFENSE_STARS[3] + '★';
  assert.deepEqual(panneau(en, d), ['AI', 'PLAY', nomEn, 'power', '2 armours', 'bank full: spend it']);
  const p = { coups: [PREP], meilleur: PREP };
  assert.deepEqual(panneau(fr, p).slice(2), ['COUP SILENCIEUX', 'prépare 300', '4 fruits · 1 ph.']);
  assert.deepEqual(panneau(en, p).slice(2), ['QUIET MOVE', 'sets up 300', '4 fruits · 1 ph.']);
});

// ── 4. Dans Chromium ────────────────────────────────────────────────────────

const PORT = 5441;
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
let proc = null, lien = null, donnees = null, navigateur = null;

before(async () => {
  if (!PW) return;
  let racine = ROOT;
  if (ROOT.split(path.sep).some((s) => s.startsWith('.'))) {
    lien = path.join(os.tmpdir(), 'i18n-swapou-' + PORT);
    try { fs.unlinkSync(lien); } catch { /* pas de lien précédent */ }
    fs.symlinkSync(ROOT, lien);
    racine = lien;
  }
  donnees = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-swapou-donnees-'));
  proc = spawn(process.execPath, ['--preserve-symlinks', '--preserve-symlinks-main', path.join(racine, 'server.js')], {
    cwd: racine,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', XMLSOCKET_PORT: '5442', FRUTISCORE_PORT: '5444',
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
});

after(async () => {
  if (navigateur) await navigateur.close().catch(() => {});
  if (proc) proc.kill('SIGKILL');
  if (lien) { try { fs.unlinkSync(lien); } catch { /* déjà parti */ } }
  if (donnees) { try { fs.rmSync(donnees, { recursive: true, force: true }); } catch { /* rien */ } }
});

// Swapou en mode invité, dans une langue (localStorage.fp_lang, comme le
// sélecteur de langue du site). Les requêtes manquées et les erreurs sont
// relevées.
async function ouvrir(langue) {
  const ctx = await navigateur.newContext({ viewport: { width: 700, height: 480 } });
  await ctx.addInitScript((l) => { try { localStorage.setItem('fp_lang', l); } catch (e) { /* stockage refusé */ } }, langue);
  const page = await ctx.newPage();
  const erreurs = [], echecs = [], requetes = [];
  page.on('pageerror', (e) => erreurs.push(e.message));
  page.on('requestfailed', (r) => echecs.push(r.url() + ' ' + ((r.failure() || {}).errorText || '')));
  page.on('response', (r) => { if (r.status() >= 400) echecs.push(r.status() + ' ' + r.url()); });
  page.on('request', (r) => requetes.push(r.url()));
  await page.goto(BASE + '/swapou/?invite=1');
  await page.waitForFunction(() => window.SW && SW.Manager && SW.Manager.client && SW.Manager.client.connected, null, { timeout: 30000 });
  // Le logo s'efface au premier clic : le menu principal.
  await attendre(500);
  await page.mouse.click(350, 240);
  await page.waitForFunction(() => SW.Manager.mode.btList && SW.Manager.mode.btList.length === 2 && SW.Manager.mode.btList.every((b) => b.stable), null, { timeout: 10000 });
  return { ctx, page, erreurs, echecs, requetes };
}

// Ce que l'écran dit, relevé pendant une image : les textes écrits par
// SwapouUI.text, et les lettrages demandés.
async function textesDuneImage(page) {
  return page.evaluate(async () => {
    const U = SW.U, vu = { textes: [], lettrages: [] };
    const text = U.text, lettrage = U.lettrage;
    U.text = function (ctx, s) { vu.textes.push(String(s)); return text.apply(this, arguments); };
    U.lettrage = function (t, st) { vu.lettrages.push(st + ':' + t); return lettrage.apply(this, arguments); };
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    U.text = text; U.lettrage = lettrage;
    return vu;
  });
}

async function finDeDuel(page, gagne) {
  await page.evaluate((gagne) => {
    SW.Manager.startMenu();
    SW.Data.players = [0, 2]; SW.Data.difficulty = 1; SW.Data.gameMode = SW.Data.DUEL;
    SW.Manager.startDuel();
    SW.Manager.gameOver(gagne ? 1 : 0);
  }, gagne);
  await page.waitForFunction(() => { const g = SW.Manager.mode; return g.constructor === SW.GameOver && g.lock_time <= 0; }, null, { timeout: 15000 });
  return textesDuneImage(page);
}

async function panneauInvite(page) {
  await page.evaluate(() => {
    SW.Data.gameMode = SW.Data.CHALLENGE; SW.Data.essai = false; SW.Data.players = [0, -1];
    const ancien = SW.Manager.mode;
    SW.Manager.mode = new SW.Challenge();
    if (ancien && ancien.destroy) ancien.destroy();
    SW.Manager.mode.player.score = 1234;
    SW.Manager.gameOver(1234);
  });
  await page.waitForFunction(() => { const g = SW.Manager.mode; return g.constructor === SW.GameOver && !g.lock && g.lock_time <= 0; }, null, { timeout: 15000 });
  await page.mouse.click(350, 240);
  await page.waitForSelector('#fp-invite .fpi-score', { timeout: 5000 });
  const t = await page.textContent('#fp-invite .fpi-score');
  await page.click('#fp-invite .fpi-non');
  return t;
}

test('Chromium, en anglais : menu, répliques, Pot au feu, fins, panneau d’inscription', { skip: SAUTER, timeout: 120000 }, async () => {
  const { ctx, page, erreurs, echecs, requetes } = await ouvrir('en');
  try {
    assert.equal(await page.getAttribute('html', 'lang'), 'en');
    assert.equal((await page.textContent('#rotate-hint')).trim(), '📱 Turn your phone sideways');
    assert.ok(requetes.some((u) => u.endsWith('/swapou/lang/en.js')), 'le dictionnaire du jeu est chargé');

    // Le logo sans son sous-titre est là ; le menu principal parle anglais.
    assert.equal(await page.evaluate(() => SW.A.has('logoSansSousTitre')), true);
    const menu = await page.evaluate(() => SW.Manager.mode.btList.map((b) => b.label));
    assert.deepEqual(menu, [' play ', ' options ']);
    await page.evaluate(() => SW.Manager.mode.jump(20));
    await page.waitForFunction(() => SW.Manager.mode.btList.filter((b) => !b.kill).length >= 6, null, { timeout: 10000 });
    const modes = await page.evaluate(() => ({
      labels: SW.Manager.mode.btList.filter((b) => !b.kill && b.linkId !== undefined && b.phase !== 'hide').map((b) => b.label),
      titres: SW.Manager.mode.titles.filter((t) => !t.kill).map((t) => t.text),
    }));
    assert.deepEqual(modes.labels, [' challenge ', ' practice ', ' duel ', 'pot au feu', ' classic ', ' back ']);
    assert.deepEqual(modes.titres, [' Modes ']);

    // Une réplique du versus, dans la table anglaise.
    const versus = await page.evaluate(() => {
      SW.Data.players = [4, 5];
      const m = new SW.Menu();
      m.showVersus(undefined, function () {});
      m.attachVersus();
      return { t1: m.versus.t1, t2: m.versus.t2, q: SwapouData.TAUNT_QUESTION[4], r: SwapouData.TAUNT_ANSWER[5] };
    });
    assert.ok(versus.q.includes(versus.t1) && versus.r.includes(versus.t2));
    assert.ok(versus.q.includes('See this citrus press?'), 'les répliques de Moutarde sont anglaises');

    // Le Pot au feu : la carte, la première ligne du conte.
    await page.evaluate(() => { SW.Data.players = [0, -1]; SW.Data.gameMode = SW.Data.HISTORY; SW.Data.histoPhase = 0; SW.Manager.startHistoryMap(); });
    const conte = await page.evaluate(() => SW.Manager.mode.dial.txt);
    assert.equal(conte, 'Once upon a time, in the kingdom of Legumia...');

    // Les fins : « victory! » et « you lose! » en lettrage, la boîte en anglais.
    const victoire = await finDeDuel(page, true);
    assert.ok(victoire.lettrages.includes('or:victory!'), JSON.stringify(victoire));
    assert.ok(victoire.textes.includes('— click to continue —'));
    const defaite = await finDeDuel(page, false);
    assert.ok(defaite.lettrages.includes('or:you lose!'), JSON.stringify(defaite));

    // Le panneau du mode invité : son libellé de score.
    assert.equal(await panneauInvite(page), 'Your score: 1234');

    assert.deepEqual(echecs, [], 'aucune requête manquée');
    assert.deepEqual(erreurs, [], 'aucune erreur de page');
  } finally { await ctx.close(); }
});

test('Chromium, en français : le jeu d’avant, sans rien de l’anglais', { skip: SAUTER, timeout: 120000 }, async () => {
  const { ctx, page, erreurs, echecs, requetes } = await ouvrir('fr');
  try {
    assert.equal(await page.getAttribute('html', 'lang'), 'fr');
    assert.equal((await page.textContent('#rotate-hint')).trim(), '📱 Tournez votre téléphone');
    assert.ok(!requetes.some((u) => /\/lang\/en\.js|\/i18n\/en\/|logo-sans-sous-titre/.test(u)), 'rien de l’anglais n’est téléchargé');
    assert.equal(await page.evaluate(() => SW.A.has('logoSansSousTitre')), false);
    assert.deepEqual(await page.evaluate(() => SW.Manager.mode.btList.map((b) => b.label)), [' jouer ', ' options ']);
    const donnees = await page.evaluate(() => ({ q: SwapouData.TAUNT_QUESTION[0][0], h: SwapouData.SCENARIO[0][2].txt }));
    assert.deepEqual(donnees, { q: 'Abandonne ! tu n\'as aucune chance contre moi !', h: 'Il était une fois, au royaume de Légumia...' });
    const victoire = await finDeDuel(page, true);
    assert.deepEqual(victoire.lettrages, [], 'l’image d’origine, « victoire! »');
    assert.ok(victoire.textes.includes('— cliquez pour continuer —'));
    assert.equal(await panneauInvite(page), 'Ton score : 1234');
    assert.deepEqual(echecs, []);
    assert.deepEqual(erreurs, []);
  } finally { await ctx.close(); }
});
