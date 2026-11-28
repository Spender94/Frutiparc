/*
 * LE FORUM, LE CLUB ET LES PRUNOSTICS EN ANGLAIS — et toujours en français.
 *
 * Les trois pages chargent /js/i18n.js dans leur <head> et demandent leurs
 * dictionnaires (`commun` + forum, club ou paris) ; tout ce que le CLIENT
 * écrit passe par T() / T.n() / data-i18n, le français restant le repli écrit
 * dans le code. Ce que le serveur ou les joueurs écrivent (messages, titres
 * de sujets, noms de forums, pseudos) ne bouge pas.
 *
 * Deux choses à voir en vrai, dans Chromium :
 *   · en anglais (`localStorage.fp_lang = 'en'`), <html lang="en">, un
 *     échantillon de textes anglais, les dates et les nombres à l'anglaise
 *     (« ×2.5 », « 1,250 kikooz »), et sur le forum les deux PASTILLES CSS
 *     « new » / « reply » à la place des images post.gif / reply.gif, qui
 *     portent leur mot en français — de jour comme de nuit, où la pastille
 *     prend le prune des dessins de nuit ; aucun dictionnaire en échec ;
 *   · en français, le texte d'origine et les images d'origine, sans le moindre
 *     dictionnaire chargé.
 *
 * Le serveur tourne sans base (DATABASE_URL vide) : la connexion est vraie,
 * mais le contenu du forum, du club et des paris est servi par des réponses
 * posées dans la page (page.route) — c'est le rendu du client qu'on éprouve.
 * Sans Playwright, la partie navigateur est sautée.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const lire = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// ── La source ────────────────────────────────────────────────────────────────

test('source : chaque page charge les langues dans son <head>, avant ses autres scripts', () => {
  for (const [page, zone] of [['public/fb/index.html', 'forum'], ['public/club/index.html', 'club'], ['public/paris/index.html', 'paris']]) {
    const html = lire(page);
    const tete = html.slice(0, html.indexOf('</head>'));
    const i18n = tete.indexOf('<script src="/js/i18n.js"></script>');
    assert.ok(i18n > 0, page + ' : /js/i18n.js dans le <head>');
    assert.ok(tete.includes("<script>FPI18n.charger(['commun', '" + zone + "']);</script>"), page + ' : les dictionnaires de la page');
    // Le premier script de la page, sauf sid-discret.js, qui doit le rester
    // (test/sidDiscret.test.js) : i18n.js vient juste après lui.
    const premier = html.indexOf('<script');
    const sid = html.indexOf('<script src="/js/sid-discret.js"></script>');
    assert.ok(premier === i18n || (premier === sid && html.indexOf('<script', sid + 1) === i18n),
      page + ' : i18n.js passe avant les autres scripts');
    assert.ok(html.includes('FPI18n.appliquer(document);'), page + ' : le HTML marqué est traduit');
  }
});

test('source : le forum garde ses images françaises et leur donne une pastille anglaise', () => {
  const html = lire('public/fb/index.html');
  assert.match(html, /<img class="img-fr" src="\/fb\/' \+ \(repondre \? 'reply\.gif' : 'post\.gif'\) \+ '"/);
  assert.match(html, /<span class="pastille-fb txt-en' \+ \(repondre \? ' repondre' : ''\) \+ '"/);
  assert.match(html, /html\[lang="en"\] \.img-fr \{ display: none !important; \}/);
  assert.match(html, /\.pastille-fb::before \{[^}]*background: url\('\/fb\/post\.gif'\)/);
  // La nuit, la cerise passe d'elle-même au dessin de nuit, et le corps de la
  // pastille au prune de ce dessin.
  const nuit = lire('public/fb/nuit.css');
  assert.match(nuit, /\.pastille-fb::before \{\n\s*background: url\('\/fb\/post-nuit\.png\?v=[0-9a-f]{8}'\)/);
  assert.match(nuit, /\.pastille-fb\.repondre::before \{\n\s*background-image: url\('\/fb\/reply-nuit\.png\?v=[0-9a-f]{8}'\)/);
  assert.match(lire('scripts/nuit-retouches-forum.css'), /\.pastille-fb \.mot \{\n\s*border-color: #a762a0;/);
});

// ── Pour de vrai ────────────────────────────────────────────────────────────

const PORT = 4741;
const BASE = `http://127.0.0.1:${PORT}`;
const RUN = Date.now().toString(36).slice(-5);
const DONNEES = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-forum-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let proc = null;
let lien = null;
let SID = '';

function playwright() {
  for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(p); } catch { /* suivant */ }
  }
  return null;
}
const PW = playwright();

/*
 * Express (le module `send`) refuse de servir un chemin qui contient un
 * dossier caché — et un arbre de travail vit souvent sous `.claude/…`. On
 * passe alors par un lien symbolique sans point, comme le kit de la bande
 * annonce (scripts/kit-bande-annonce/chat/lib/site.js).
 */
function racineServie() {
  if (!ROOT.split(path.sep).some((s) => s.startsWith('.'))) return ROOT;
  lien = path.join(os.tmpdir(), 'i18n-forum-site-' + PORT);
  try { fs.unlinkSync(lien); } catch { /* pas de lien précédent */ }
  fs.symlinkSync(ROOT, lien);
  return lien;
}

before(async () => {
  if (!PW) return;
  const racine = racineServie();
  proc = spawn(process.execPath, ['--preserve-symlinks', '--preserve-symlinks-main', path.join(racine, 'server.js')], {
    cwd: racine,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', XMLSOCKET_PORT: '4742', FRUTISCORE_PORT: '4743',
      REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000', FRUTI_DATA_DIR: DONNEES,
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 200; i++) {
    try { if ((await fetch(BASE + '/fb/')).ok) break; } catch { /* pas prêt */ }
    await wait(250);
  }
  const corps = JSON.stringify({ username: 'lang' + RUN, password: 'secret123' });
  const json = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corps };
  await fetch(BASE + '/api/auth/register', json);
  SID = (await (await fetch(BASE + '/api/auth/login', json)).json()).sid;
  assert.ok(SID, 'une session');
});

after(() => {
  if (proc) proc.kill('SIGKILL');
  if (lien) { try { fs.unlinkSync(lien); } catch { /* déjà parti */ } }
  try { fs.rmSync(DONNEES, { recursive: true, force: true }); } catch { /* déjà parti */ }
});

// Ce que le serveur aurait répondu, avec sa base : du contenu de joueurs (en
// français, et qui doit le rester) et des codes. Les heures sont LOCALES (pas
// de « Z ») : la date affichée ne dépend pas du fuseau de la machine.
const REPONSES = {
  '/api/forum/index': { categories: [{ name: 'Le coin des Frutiz', boards: [{ id: 7, name: 'Discussions générales',
    description: 'On parle de tout et de rien', unread: true, topicCount: 12, postCount: 345,
    lastActivity: '2026-03-12T14:05:00', lastActivityBy: 'Kiwi' }] }] },
  '/api/forum/board/7': { board: { id: 7, name: 'Discussions générales' }, total: 1, perPage: 20, page: 1, peutPoster: true,
    topics: [{ id: 42, title: 'Bonjour à tous', author: 'Kiwi', replyCount: 3, viewCount: 50, isSticky: true,
      lastPostAt: '2026-03-12T14:05:00', lastPostBy: 'Pomme', unread: false, followed: false }] },
  '/api/forum/topic/42': { total: 2, perPage: 20, page: 1, peutModerer: false, followed: false, forumNotify: 1, canManagePoll: false,
    topic: { id: 42, title: 'Bonjour à tous', boardId: 7, boardName: 'Discussions générales', isLocked: false, lastPostBy: 'pomme', author: 'Kiwi' },
    poll: { id: 5, question: 'Ton fruit préféré ?', totalVotes: 4, myOptionId: 1, isClosed: false,
      options: [{ id: 1, label: 'Le kiwi', votes: 3 }, { id: 2, label: 'La pomme', votes: 1 }] },
    posts: [
      { id: 1, author: 'Kiwi', content: 'Salut [b]tout le monde[/b] !', createdAt: '2026-03-12T14:05:00' },
      { id: 2, author: 'Pomme', content: '[quote=Kiwi]Salut[/quote]Coucou', createdAt: '2026-03-12T15:30:00' },
    ] },
  '/api/club/medalists': { medalists: [{ user: 'Kiwi', gold: 3, silver: 1, bronze: 1, total: 5 }],
    games: [{ id: 'swapou', nom: 'Swapou', total: 5 }], game: 'all', totalMedals: 5 },
  '/api/club/players': { joueurs: ['Kiwi'] },
  '/api/club/player': { ok: true, user: 'Kiwi', bouille: '000000010000000000000000',
    medailles: { or: 3, argent: 1, bronze: 1, total: 5, rang: 2 },
    medaillesParMois: [{ cle: '2026-03', mois: 'Mars 2026', or: 3, argent: 1, bronze: 1, total: 5 }],
    medaillesParJeu: [{ nom: 'Swapou', or: 3, argent: 1, bronze: 1, total: 5 }],
    records: [{ jeu: 'swapou', jeuNom: 'Swapou', nom: 'Swapou - Classique', label: '12 345', rang: 1, sur: 40 }] },
  '/api/paris/challenge': { ok: true, actif: true, moi: 'lang', solde: 1250, jour: '2026-11-28', jourLisible: 'samedi 28 novembre',
    plafond: 50, dejaMise: 10, cagnotte: 120, autresParis: [],
    jeux: [{ cle: 'swapou2_challenge', nom: 'Swapou', pots: { podium: 100, or: 40 }, mesParis: [],
      candidats: [{ pseudo: 'kiwi', nom: 'Kiwi', joues: 12, podiums: 3, ors: 1,
        pot: { podium: { cote: 2.5, mises: 1500 }, or: { cote: null, mises: 0 } } }] }],
    defi: { actif: true, plafond: 20, dejaMise: 0, mesDefis: [],
      jeux: [{ cle: 'swapou2_challenge', nom: 'Swapou', joues: 5, podiums: 2, argents: 1, ors: 0, cotes: { bronze: 1.8, argent: 3.2, or: 6.5 } }] },
    hier: { jour: '2026-11-26', jourLisible: 'jeudi 26 novembre', mesParis: [], podiums: [{ cle: 'swapou2_challenge', nom: 'Swapou', podium: ['Kiwi', 'Pomme', 'Poire'] }] } },
  '/api/paris': { ok: true, moi: 'lang', solde: 1250, tournois: [] },
  '/api/paris/registre': { ok: true, moi: 'lang', seuil: 100, grosCoups: [],
    mois: { lisible: 'novembre 2026', minParis: 3, classement: [], moi: null, passee: null, cagnotte: 120, plafondCagnotte: 500 },
    bilan: { paris: 4, gagnes: 2, perdus: 1, mises: 40, gains: 75, net: 35, enJeu: 10 },
    lignes: [{ quand: '2026-11-20T10:00:00', sorte: 'challenge', type: 'podium', quoi: 'Kiwi médaillé à Swapou', mise: 10, cote: 2.5, statut: 'gagne', gain: 25 }] },
};

async function servir(page) {
  await page.route((url) => Object.prototype.hasOwnProperty.call(REPONSES, url.pathname), (route) => {
    const p = new URL(route.request().url()).pathname;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(REPONSES[p]) });
  });
}

// Un contexte dans une langue (et une nuit), et les dictionnaires qu'il demande.
async function ouvrir(browser, langue, nuit) {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 900 } });
  await ctx.addInitScript(([l, n]) => {
    try { localStorage.setItem('fp_lang', l); if (n) localStorage.setItem('fp_nuit', '1'); } catch (e) { /* rien */ }
  }, [langue, nuit]);
  const page = await ctx.newPage();
  const dicos = [];
  page.on('response', (r) => { if (/\/i18n\//.test(r.url())) dicos.push({ url: r.url(), statut: r.status() }); });
  page.on('requestfailed', (r) => { if (/\/i18n\//.test(r.url())) dicos.push({ url: r.url(), statut: 'échec' }); });
  await servir(page);
  return { ctx, page, dicos };
}

function dicosCharges(dicos, zone, quand) {
  assert.ok(dicos.length, quand + ' : des dictionnaires demandés');
  for (const d of dicos) assert.strictEqual(d.statut, 200, quand + ' : ' + d.url + ' a échoué (' + d.statut + ')');
  for (const z of ['commun', zone]) {
    assert.ok(dicos.some((d) => d.url.endsWith('/i18n/en/' + z + '.js')), quand + ' : /i18n/en/' + z + '.js chargé');
  }
}

const texte = (page) => page.evaluate(() => document.body.innerText);
const langue = (page) => page.evaluate(() => document.documentElement.lang);
// Le premier élément visible du sélecteur : sa boîte n'est pas vide.
const visible = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}, sel);

test('Chromium : le forum en anglais — textes, dates, pastilles « new » et « reply », de jour comme de nuit', async (t) => {
  if (!PW) return t.skip('Playwright absent');
  const browser = await PW.chromium.launch();
  try {
    const { ctx, page, dicos } = await ouvrir(browser, 'en', false);
    await page.goto(`${BASE}/fb/?sid=${SID}`);
    await page.waitForSelector('#app .cat-header');
    assert.strictEqual(await langue(page), 'en');
    let tx = await texte(page);
    for (const s of ['Mark all as read', 'Topics', 'Posts', 'Last post', 'Search', 'Forum created by',
      'Mar 12, 2026 14:05']) assert.ok(tx.includes(s), 'accueil : « ' + s + ' »');
    // Le contenu des joueurs et le nom du forum ne se traduisent pas.
    assert.ok(tx.includes('Discussions générales') && tx.includes('On parle de tout et de rien'), 'le nom du forum reste');
    assert.ok(tx.includes('Forum Frutiparc'), 'le nom du site reste');
    assert.strictEqual(await page.getAttribute('#search-toggle', 'title'), 'Search the forum');
    assert.strictEqual(await page.getAttribute('#search-q', 'placeholder'), 'Search the forum… (auteur:username for an author)');

    await page.click('.row .title a');
    await page.waitForSelector('.topic-row');
    tx = await texte(page);
    for (const s of ['Replies', 'Views', 'by Kiwi', 'Sticky:', 'Page 1 of 1']) assert.ok(tx.includes(s), 'forum : « ' + s + ' »');
    // La pastille « new » prend la place de post.gif.
    assert.ok(await visible(page, '.pastille-fb:not(.repondre)'), 'la pastille « new » se voit');
    assert.strictEqual(await page.textContent('.pastille-fb:not(.repondre) .mot'), 'new');
    assert.strictEqual(await page.getAttribute('.pastille-fb:not(.repondre)', 'aria-label'), 'New topic');
    assert.strictEqual(await visible(page, 'img[src="/fb/post.gif"]'), false, 'post.gif est caché');
    const cerise = await page.evaluate(() => getComputedStyle(document.querySelector('.pastille-fb'), '::before').backgroundImage);
    assert.match(cerise, /\/fb\/post\.gif/, 'la cerise vient de post.gif');

    await page.click('.topic-row .title a');
    await page.waitForSelector('.post');
    tx = await texte(page);
    for (const s of ['Author', 'Posted Thursday, March 12, 2026 at 14:05', 'Post subject: Bonjour à tous', 'quote',
      'Kiwi wrote:', 'Poll', '(your vote)', 'Total: 4 votes', '3 votes — 75%', 'Show posts from:', 'Oldest first', 'Follow'])
      assert.ok(tx.includes(s), 'sujet : « ' + s + ' »');
    assert.ok(tx.includes('Salut tout le monde !'), 'le message reste tel quel');
    assert.ok(await visible(page, '.pastille-fb.repondre'), 'la pastille « reply » se voit');
    assert.strictEqual(await page.textContent('.pastille-fb.repondre .mot'), 'reply');
    assert.strictEqual(await visible(page, 'img[src="/fb/reply.gif"]'), false, 'reply.gif est caché');
    dicosCharges(dicos, 'forum', 'forum en anglais');
    await ctx.close();

    // La nuit : la cerise passe au dessin de nuit, le corps à son prune.
    const n = await ouvrir(browser, 'en', true);
    await n.page.goto(`${BASE}/fb/?sid=${SID}`);
    await n.page.waitForSelector('#app .cat-header');
    await n.page.click('.row .title a');
    await n.page.waitForSelector('.pastille-fb');
    await n.page.waitForFunction(() => {
      const l = document.getElementById('nuit-css');
      return l && l.sheet && getComputedStyle(document.querySelector('.pastille-fb .mot')).color === 'rgb(244, 243, 246)';
    });
    const s = await n.page.evaluate(() => {
      const p = document.querySelector('.pastille-fb');
      const m = getComputedStyle(p.querySelector('.mot'));
      return { avant: getComputedStyle(p, '::before').backgroundImage, fond: m.backgroundImage, liseré: m.borderTopColor,
        gauche: m.borderLeftWidth };
    });
    assert.match(s.avant, /\/fb\/post-nuit\.png/, 'la cerise de nuit');
    assert.match(s.fond, /rgb\(118, 58, 93\)/, 'le prune de post-nuit.png');
    assert.strictEqual(s.liseré, 'rgb(167, 98, 160)', 'le liseré de post-nuit.png');
    // La cerise découpée porte le bord gauche : la feuille de nuit ne doit pas
    // en rajouter un entre elle et le mot.
    assert.strictEqual(s.gauche, '0px', 'pas de liseré entre la cerise et le mot');
    await n.ctx.close();
  } finally {
    await browser.close();
  }
});

test('Chromium : le forum en français — le texte et les images d’origine, aucun dictionnaire', async (t) => {
  if (!PW) return t.skip('Playwright absent');
  const browser = await PW.chromium.launch();
  try {
    const { page, dicos } = await ouvrir(browser, 'fr', false);
    await page.goto(`${BASE}/fb/?sid=${SID}`);
    await page.waitForSelector('#app .cat-header');
    assert.strictEqual(await langue(page), 'fr');
    let tx = await texte(page);
    for (const s of ['Tout marquer comme lu', 'Sujets', 'Dernier message', '12 mar 2026 14:05', 'Forum créé par'])
      assert.ok(tx.includes(s), 'accueil : « ' + s + ' »');
    await page.click('.row .title a');
    await page.waitForSelector('.topic-row');
    tx = await texte(page);
    for (const s of ['Rép.', 'Vues', 'par Kiwi', 'Post-it:', 'Page 1 sur 1']) assert.ok(tx.includes(s), 'forum : « ' + s + ' »');
    assert.ok(await visible(page, 'img[src="/fb/post.gif"]'), 'post.gif se voit');
    assert.strictEqual(await page.getAttribute('img[src="/fb/post.gif"]', 'alt'), 'Nouveau sujet');
    assert.strictEqual(await visible(page, '.pastille-fb'), false, 'pas de pastille en français');
    await page.click('.topic-row .title a');
    await page.waitForSelector('.post');
    tx = await texte(page);
    for (const s of ['Auteur', 'Posté le Jeudi 12 mars 2026 14:05', 'Sujet du message: Bonjour à tous', 'citer',
      'Kiwi a dit :', 'Sondage', '(ton vote)', 'Total : 4 votes', 'Montrer les messages depuis:'])
      assert.ok(tx.includes(s), 'sujet : « ' + s + ' »');
    assert.ok(await visible(page, 'img[src="/fb/reply.gif"]'), 'reply.gif se voit');
    assert.deepStrictEqual(dicos, [], 'aucun dictionnaire en français');
  } finally {
    await browser.close();
  }
});

test('Chromium : le club en anglais (ordinal, mois, nombres) et en français', async (t) => {
  if (!PW) return t.skip('Playwright absent');
  const browser = await PW.chromium.launch();
  try {
    const en = await ouvrir(browser, 'en', false);
    await en.page.goto(`${BASE}/club/?p=Kiwi`);
    await en.page.waitForSelector('.fiche-nom');
    assert.strictEqual(await langue(en.page), 'en');
    assert.strictEqual(await en.page.title(), 'Frutiparc Club');
    const tx = await texte(en.page);
    for (const s of ['Top medalists', 'Records by game', 'Player card', 'Medals by date', 'Medals by game', 'March 2026',
      'Month', 'Gold', 'Silver', '#1 / 40', '1 record', 'Username:']) assert.ok(tx.includes(s), 'club : « ' + s + ' »');
    const ligne = await en.page.innerHTML('.fiche-ligne');
    assert.strictEqual(ligne, '<b>Kiwi</b> has won <b>5</b> medals — 2<sup>nd</sup> on the medal table');
    assert.strictEqual(await en.page.textContent('#medalist-game option[value="all"]'), 'All games (5)');
    dicosCharges(en.dicos, 'club', 'club en anglais');

    const fr = await ouvrir(browser, 'fr', false);
    await fr.page.goto(`${BASE}/club/?p=Kiwi`);
    await fr.page.waitForSelector('.fiche-nom');
    assert.strictEqual(await langue(fr.page), 'fr');
    assert.strictEqual(await fr.page.title(), 'Club Frutiparc');
    const txf = await texte(fr.page);
    for (const s of ['Top médaillés', 'Records par jeu', 'Médailles classées par date', 'Mars 2026', 'n° 1 / 40'])
      assert.ok(txf.includes(s), 'club : « ' + s + ' »');
    assert.strictEqual(await fr.page.innerHTML('.fiche-ligne'), '<b>Kiwi</b> a obtenu <b>5</b> médailles — 2<sup>e</sup> au tableau des médaillés');
    assert.deepStrictEqual(fr.dicos, [], 'aucun dictionnaire en français');
  } finally {
    await browser.close();
  }
});

test('Chromium : les Prunostics en anglais (cotes, kikooz, dates) et en français', async (t) => {
  if (!PW) return t.skip('Playwright absent');
  const browser = await PW.chromium.launch();
  try {
    const en = await ouvrir(browser, 'en', false);
    await en.page.goto(`${BASE}/paris/?sid=${SID}`);
    await en.page.waitForSelector('#vue-challenge .soustitre');
    assert.strictEqual(await langue(en.page), 'en');
    let tx = await texte(en.page);
    for (const s of ['Tournaments', 'Ledger', 'The park', 'Challenge for Saturday, November 28', 'How does it work?',
      '1,250 kikooz', 'your balance', '×2.5', '1,500 kikooz staked', 'grab it!', 'Medal dare', '×6.5', 'silver or gold',
      '3 podiums in 12 days', 'The Challenge for Thursday, November 26']) assert.ok(tx.includes(s), 'challenge : « ' + s + ' »');
    await en.page.click('.onglets [data-vue=registre]');
    await en.page.waitForSelector('#vue-registre .bilan');
    tx = await texte(en.page);
    for (const s of ['Prunosticator of the month', 'My bets', 'Stake', 'Odds', 'Nov 20', 'won', '(25 received)', 'kikooz staked'])
      assert.ok(tx.includes(s), 'registre : « ' + s + ' »');
    dicosCharges(en.dicos, 'paris', 'Prunostics en anglais');

    const fr = await ouvrir(browser, 'fr', false);
    await fr.page.goto(`${BASE}/paris/?sid=${SID}`);
    await fr.page.waitForSelector('#vue-challenge .soustitre');
    assert.strictEqual(await langue(fr.page), 'fr');
    tx = await texte(fr.page);
    // Le séparateur des milliers est celui du français (une espace fine).
    assert.match(tx, /1\s250 kikooz/);
    for (const s of ['Tournois', 'Registre', 'Challenge de samedi 28 novembre', 'Comment ça marche ?', '×2,5', 'à prendre',
      'Défi médaille', '×6,5', 'l’argent ou l’or', '3 podiums sur 12 j.']) assert.ok(tx.includes(s), 'challenge : « ' + s + ' »');
    assert.deepStrictEqual(fr.dicos, [], 'aucun dictionnaire en français');
  } finally {
    await browser.close();
  }
});
