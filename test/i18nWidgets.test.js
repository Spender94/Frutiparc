'use strict';
/*
 * LES WIDGETS PARTAGÉS ET LES PETITES PAGES, EN DEUX LANGUES
 * ══════════════════════════════════════════════════════════
 *
 * Les widgets de public/js (parties en différé, quêtes de Gromelin, moteur et
 * palette des bouilles, recherche par bouille, bandeau FD, guetteur
 * d'éjection) servent aussi dans des pages qui ne chargent pas encore
 * i18n.js — les jeux. Ils doivent donc :
 *   · SANS FPI18n, parler français, gabarits remplis (le texte d'avant) ;
 *   · AVEC FPI18n et le dictionnaire anglais (/i18n/en/widgets.js), parler
 *     anglais ;
 *   · et la palette, que le serveur charge par require(), garder ses noms
 *     de référence et ses surnoms d'accessoires (des identifiants) intacts.
 *
 * Puis, dans un vrai navigateur, quelques petites pages en anglais, et la
 * politique de confidentialité : anglaise avec ?lang=en, française par défaut.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const lire = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const FINE = String.fromCharCode(0x202f);   // l'espace fine insécable des milliers

// ── Un navigateur de poche (vm) ─────────────────────────────────────────────
//
// `window` est le contexte lui-même. Avec une langue, on y charge i18n.js
// (qui la lit dans ?lang=) puis les dictionnaires anglais ; sans langue,
// FPI18n n'existe pas — c'est le cas des jeux.
function executer(ctx, f) { vm.runInContext(lire(f), ctx, { filename: f }); }
function contexte(langue, extra) {
  const ctx = Object.assign({
    console, URLSearchParams, Intl,
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
  }, extra || {});
  ctx.window = ctx;
  ctx.self = ctx;
  vm.createContext(ctx);
  if (langue) {
    if (!ctx.document) ctx.document = { readyState: 'complete', documentElement: {} };
    if (!ctx.location) ctx.location = { search: '?lang=' + langue };
    ctx.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
    executer(ctx, 'public/js/i18n.js');
    for (const z of ['commun', 'widgets']) executer(ctx, 'public/i18n/en/' + z + '.js');
    assert.equal(ctx.FPI18n.langue, langue);
  }
  return ctx;
}
const tourner = () => new Promise((r) => setImmediate(r));

// Le bandeau FD et le guetteur d'éjection parlent au DOM et au réseau : un
// document minimal, un fetch qui répond ce qu'on lui dit.
function pageDeJeu(langue, reponse, intervalles) {
  const corps = {
    enfants: [],
    appendChild(e) { this.enfants.push(e); e.parentNode = this; },
    removeChild(e) { this.enfants = this.enfants.filter((x) => x !== e); },
  };
  const document = {
    readyState: 'complete', title: 'jeu', body: corps, documentElement: {},
    currentScript: { getAttribute: (k) => (k === 'data-jeu' ? 'kaluga' : null) },
    createElement: (tag) => ({ tag, style: {}, textContent: '', setAttribute(k, v) { this[k] = v; } }),
    addEventListener() {},
  };
  return contexte(langue, {
    document,
    location: { search: '?sid=abc' + (langue ? '&lang=' + langue : '') },
    fetch: async () => ({ ok: true, json: async () => reponse }),
    setInterval: (fn) => { if (intervalles) intervalles.push(fn); return 1; },
    setTimeout: (fn) => { fn(); return 1; },
    close() {}, closed: false,
  });
}
async function bandeau(langue, reponse) {
  const ctx = pageDeJeu(langue, reponse);
  executer(ctx, 'public/js/fd-badge.js');
  for (let i = 0; i < 5; i++) await tourner();
  const b = ctx.document.body.enfants[0];
  return b ? b.textContent : null;
}
async function ejection(langue) {
  const intervalles = [];
  const ctx = pageDeJeu(langue, { ejected: true }, intervalles);
  executer(ctx, 'public/js/eject-watch.js');
  assert.equal(intervalles.length, 1, 'le guetteur bat');
  intervalles[0]();
  for (let i = 0; i < 5; i++) await tourner();
  return { titre: ctx.document.title, voile: (ctx.document.body.enfants[0] || {}).textContent };
}

function widgets(langue) {
  const ctx = contexte(langue);
  for (const f of ['bouille-palette', 'bouille-recherche', 'bouille-moteur', 'differe-ui', 'quetes-light']) {
    executer(ctx, 'public/js/' + f + '.js');
  }
  return ctx;
}
const PRIMES = [
  { rk: 'a', jeu: 'swapou2', ouverte: true, record: '26 777 points', tenant: 'goyave', gain: 1500, semaines: 3, etiquette: { nom: 'Swapou' } },
  { rk: 'b', jeu: 'snake3', ouverte: false, prisePar: 'kiwi', record: '3', tenant: 'x', gain: 50, semaines: 1, etiquette: { nom: 'Frutisnake' } },
];

// ── 1. Sans i18n.js : le français d'avant ───────────────────────────────────

test('sans FPI18n, chaque widget parle français, gabarits remplis', async () => {
  const w = widgets(null);
  assert.equal(w.FPI18n, undefined, 'pas de module des langues');

  // Les parties en différé : les durées et les salles.
  const D = w.DiffereUI;
  assert.deepEqual([0, 61000, 3600000, 4500000, 86400000, 93600000].map(D.fmtDelai),
    ['moins d’une minute', '1 min', '1 h', '1 h 15 min', '1 j', '1 j 2 h']);
  assert.equal(D.nomSalle('champ'), 'Championnat');
  assert.equal(D.SALLES.amical, 'Amical', 'la table lue par Grapiz reste française');

  // Les quêtes : le bouton, l'enseigne, le pluriel, les milliers.
  const Q = w.QuetesLight;
  assert.match(Q._proposition({ i: 2, gain: 10, titre: 'T', detail: 'D' }), /data-i="2">Signer<\/button>/);
  Q._etat({ echange: { possible: true }, primes: PRIMES });
  assert.match(Q._carte({ id: 'x', gain: 8, titre: 't', detail: '', ligne: '', pc: 0, jeu: 'forum' }),
    /title="Une fois par semaine, une seule quête">Changer<\/button>/);
  const af = Q._primes();
  assert.match(af, /data-texte="Mises à prix"><span>Mises à prix<\/span>/);
  assert.match(af, /record de <b>goyave<\/b><br>tenu depuis 3 semaines/);
  assert.match(af, /tenu depuis 1 semaine</, 'le singulier');
  assert.match(af, /Prise par kiwi/);
  assert.ok(af.includes('1' + FINE + '500'), 'les milliers à la française');
  Q._etat(null);

  // Le moteur, la palette, la recherche : les noms de référence.
  assert.equal(w.FPBouilleMoteur.nomHumeur(7), 'Totoché');
  assert.equal(w.FPBouilleMoteur.nomAnimation(17), 'Clin d’œil');
  assert.equal(w.FPBouilleMoteur.nomAnimation(99), '', 'un indice inconnu ne se nomme pas');
  assert.deepEqual([3, 29, 38, 52, 99].map(w.FPBouille.colorName), ['Skin dark 1', 'Mega jaune 1', 'Gris bleu 1', 'Blanc', '#99']);
  assert.deepEqual([0, 6, 16, 17].map(w.FPBouille.accName), ['Rien', 'Bananocle', 'Carapace', 'Type 17']);
  assert.deepEqual(w.FPBouilleRecherche.CHAMPS.map((c) => c.libelle),
    ['yeux', 'iris', 'cheveux', 'bouche', 'couleur1', 'couleur2', 'accessoire', 'coul. acc.']);
  assert.equal(w.FPBouilleRecherche.nomValeur('peau', 38), 'Gris bleu 1');

  // Le bandeau FD et le voile d'éjection.
  assert.equal(await bandeau(null, { ok: true, limited: true, remaining: 2, allowance: 3 }), 'Challenge · 2 parties sur 3');
  assert.equal(await bandeau(null, { ok: true, limited: true, remaining: 1, allowance: 3, frutisigne: 1 }),
    'Challenge · 1 partie sur 3 · Frutisigne +1');
  assert.equal(await bandeau(null, { ok: true, limited: true, remaining: 0, allowance: 3 }), 'Challenge · plus de partie classée');
  assert.equal(await bandeau(null, { ok: true, limited: false }), null, 'un jeu sans quota : pas de bandeau');
  assert.deepEqual(await ejection(null),
    { titre: 'Disque éjecté', voile: 'Disque éjecté de la Frusion — cette fenêtre peut être fermée.' });
});

// ── 2. Avec i18n.js et le dictionnaire anglais ──────────────────────────────

test('avec FPI18n en anglais, les mêmes widgets parlent anglais', async () => {
  const w = widgets('en');

  const D = w.DiffereUI;
  assert.deepEqual([0, 3600000, 4500000, 93600000].map(D.fmtDelai), ['less than a minute', '1 h', '1 h 15 min', '1 d 2 h']);
  assert.equal(D.nomSalle('champ'), 'Championship');
  assert.equal(D.SALLES.champ, 'Championnat', 'l’identifiant d’affichage de Grapiz ne bouge pas');

  const Q = w.QuetesLight;
  assert.match(Q._proposition({ i: 2, gain: 10, titre: 'T', detail: 'D' }), /data-i="2">Sign<\/button>/);
  Q._etat({ echange: { possible: true }, primes: PRIMES });
  assert.match(Q._carte({ id: 'x', gain: 8, titre: 'Titre du serveur', detail: '', ligne: '', pc: 0, jeu: 'forum' }),
    /title="Once a week, just one quest">Swap<\/button>/);
  assert.match(Q._carte({ id: 'x', gain: 8, titre: 'Titre du serveur', detail: '', ligne: '', pc: 0, jeu: 'forum' }),
    /Titre du serveur/, 'le texte du serveur passe tel quel');
  const af = Q._primes();
  assert.match(af, /data-texte="Bounties"><span>Bounties<\/span>/);
  assert.match(af, /record held by <b>goyave<\/b><br>held for 3 weeks/);
  assert.match(af, /held for 1 week</);
  assert.match(af, /Claimed by kiwi/);
  assert.ok(af.includes('1,500'), 'les milliers à l’anglaise');
  Q._etat(null);

  assert.equal(w.FPBouilleMoteur.nomHumeur(7), 'Totoched');
  assert.equal(w.FPBouilleMoteur.nomAnimation(17), 'Wink');
  assert.equal(w.FPBouilleMoteur.NOMS_ANIMATIONS[17], 'Clin d’œil', 'la table de référence reste française');
  assert.deepEqual([3, 29, 38, 52].map(w.FPBouille.colorName), ['Skin dark 1', 'Mega yellow 1', 'Blue gray 1', 'White']);
  assert.deepEqual([0, 6, 16, 17].map(w.FPBouille.accName), ['None', 'Bananocle', 'Turtle shell', 'Type 17']);
  assert.equal(w.FPBouille.ACCESSORIES[0], 'Rien', 'les noms de référence ne bougent pas');
  assert.equal(w.FPBouille.COLORS[38].name, 'Gris bleu 1');
  assert.deepEqual(w.FPBouilleRecherche.CHAMPS.map((c) => c.cle),
    ['yeux', 'iris', 'cheveux', 'bouche', 'peau', 'colch', 'acc', 'acccol'], 'les identifiants restent');
  assert.equal(w.FPBouilleRecherche.CHAMPS[0].libelle, 'eyes');
  assert.equal(w.FPBouilleRecherche.nomValeur('acc', 10), 'Glasses');

  assert.equal(await bandeau('en', { ok: true, limited: true, remaining: 2, allowance: 3, frutisigne: 1 }),
    'Challenge · 2 of 3 games left · Frutisign +1');
  assert.equal(await bandeau('en', { ok: true, limited: true, remaining: 0, allowance: 3 }), 'Challenge · no ranked games left');
  assert.deepEqual(await ejection('en'),
    { titre: 'Disc ejected', voile: 'Disc ejected from the Frusion — you can close this window.' });
});

// ── 3. La palette côté serveur ──────────────────────────────────────────────

test('bouille-palette sous require() : le serveur garde ses noms et ses surnoms', () => {
  const P = require(path.join(ROOT, 'public/js/bouille-palette.js'));
  assert.equal(P.COLORS.length, 53);
  assert.equal(P.ACCESSORIES.length, 17);
  assert.equal(P.colorName(38), 'Gris bleu 1', 'sans FPI18n, le français');
  assert.equal(P.accName(3), 'Casquette');
  // Les surnoms baptisés sont des IDENTIFIANTS (la vitrine les enregistre) :
  // ils sont les mêmes, que la page soit en anglais ou non.
  const en = widgets('en').FPBouille;
  for (const s of ['9020t0a00', '3000g0000', '6010100a0', 'g0a0b0c00']) {
    for (let essai = 0; essai < 5; essai++) assert.equal(en.accessoryName(s, essai), P.accessoryName(s, essai), s + ' / ' + essai);
  }
  assert.equal(P.accessoryName('3000g0000'), 'Kiwix', 'casquette + kiwi, le nom d’origine');
  // Et le serveur ne lit jamais un nom À AFFICHER : il n'a pas de langue.
  const srv = lire('server.js');
  const appels = new Set([...srv.matchAll(/FPBouille\.(\w+)/g)].map((m) => m[1]));
  assert.ok(appels.has('accessoryName') && appels.has('accessoryParts'), 'les surnoms et les pièces');
  assert.ok(!appels.has('colorName') && !appels.has('accName'), 'jamais colorName ni accName côté serveur');
});

// ── 4. Dans un navigateur : les petites pages, la politique ─────────────────

const PORT = 4861;
const BASE = `http://127.0.0.1:${PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let proc = null, lien = null, donnees = null;

function playwright() {
  for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(p); } catch { /* suivant */ }
  }
  return null;
}
const PW = playwright();

before(async () => {
  donnees = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-i18n-widgets-'));
  // express refuse un chemin qui traverse un dossier caché (un arbre de
  // travail sous .claude/worktrees/…) : on passe alors par un lien sans point.
  let racine = ROOT;
  if (ROOT.split(path.sep).some((s) => s.startsWith('.'))) {
    lien = path.join(os.tmpdir(), 'fp-i18n-widgets-' + PORT);
    try { fs.unlinkSync(lien); } catch { /* pas de lien précédent */ }
    fs.symlinkSync(ROOT, lien);
    racine = lien;
  }
  proc = spawn(process.execPath, ['--preserve-symlinks', '--preserve-symlinks-main', path.join(racine, 'server.js')], {
    cwd: racine,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', XMLSOCKET_PORT: '4862', FRUTISCORE_PORT: '4863',
      REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000', FRUTI_DATA_DIR: donnees,
      RGPD_RESPONSABLE: '', RGPD_CONTACT: '',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  for (let i = 0; i < 160; i++) {
    try { if ((await fetch(BASE + '/reset.html')).ok) return; } catch { /* pas prêt */ }
    await wait(250);
  }
  throw new Error('serveur indisponible');
});

after(() => {
  if (proc) proc.kill('SIGKILL');
  if (lien) { try { fs.unlinkSync(lien); } catch { /* déjà parti */ } }
  if (donnees) fs.rmSync(donnees, { recursive: true, force: true });
});

test('les petites pages, en anglais avec ?lang=en, et en français sinon', async (t) => {
  if (!PW) return t.skip('Playwright absent');
  const browser = await PW.chromium.launch();
  try {
    const ctx = await browser.newContext({ locale: 'fr-FR' });
    const page = await ctx.newPage();
    const erreurs = [];
    page.on('pageerror', (e) => erreurs.push(e.message));

    // Nouveau code secret : le HTML marqué, le titre, un message du script.
    await page.goto(BASE + '/reset.html?lang=en&token=' + 'a'.repeat(64));
    assert.equal(await page.textContent('h1'), 'New secret code');
    assert.equal(await page.title(), 'Frutiparc — New secret code');
    assert.equal(await page.getAttribute('html', 'lang'), 'en');
    await page.fill('#pw1', 'abcdef');
    await page.fill('#pw2', 'abcdeg');
    await page.click('#submit-btn');
    assert.equal(await page.textContent('#msg'), "The two codes don't match.");

    // Le stockage local d'un jeu : un paragraphe à balises, un pluriel du script.
    await page.goto(BASE + '/reset-game-storage.html?lang=en');
    assert.equal(await page.textContent('h1'), "Reset a game's local storage");
    assert.match(await page.innerHTML('[data-i18n-html="pages.stockageIntro1"]'), /<em>SharedObject<\/em>/);
    await page.click('text=Kaluga');
    assert.equal(await page.textContent('#result'), 'No localStorage key matches kaluga. Nothing to erase.');

    // La galerie des pictos, sans session : la liste vide.
    await page.goto(BASE + '/pictos-gallery.html?lang=en');
    await page.waitForSelector('.state:not([data-i18n])');
    assert.match(await page.textContent('#app'), /No pictos yet\.Play the games to collect some!/);
    assert.equal(await page.title(), 'My Pictos - Frutiparc');

    // Et le français, une fois la langue reprise : le texte d'origine.
    await page.goto(BASE + '/reset.html?lang=fr');
    assert.equal(await page.textContent('h1'), 'Nouveau code secret');
    assert.equal(await page.textContent('#done-msg'), "Lien invalide ou incomplet. Refais une demande depuis la page d'accueil.");
    assert.equal(await page.title(), 'Frutiparc — Nouveau code secret');
    assert.deepEqual(erreurs, [], 'aucune erreur de script');
  } finally {
    await browser.close();
  }
});

test('la politique de confidentialité : anglaise avec ?lang=en, française par défaut', async (t) => {
  // Sans navigateur d'abord : la langue de la requête décide du fichier.
  const fr = await fetch(BASE + '/confidentialite');
  assert.match(fr.headers.get('vary') || '', /Accept-Language/, 'un cache ne mélange pas les deux');
  const pageFr = await fr.text();
  assert.match(pageFr, /<h1>Politique de confidentialité<\/h1>/, 'sans préférence : le français');
  assert.match(pageFr, /href="\/confidentialite\?lang=en"[^>]*>English version</, 'le lien vers l’anglais');
  assert.match(pageFr, /<b>l’équipe bénévole de Frutiparc<\/b>/, 'le repli du responsable, en français');
  const pageAccept = await (await fetch(BASE + '/confidentialite', { headers: { 'Accept-Language': 'en-US,en;q=0.9' } })).text();
  assert.match(pageAccept, /<h1>Privacy policy<\/h1>/, 'un navigateur anglophone : l’anglais');
  const pageForcee = await (await fetch(BASE + '/confidentialite?lang=fr', { headers: { 'Accept-Language': 'en-US' } })).text();
  assert.match(pageForcee, /<h1>Politique de confidentialité<\/h1>/, '?lang=fr l’emporte sur le navigateur');

  if (!PW) return t.skip('Playwright absent');
  const browser = await PW.chromium.launch();
  try {
    const ctx = await browser.newContext({ locale: 'fr-FR' });
    const page = await ctx.newPage();
    await page.goto(BASE + '/confidentialite?lang=en');
    assert.equal(await page.getAttribute('html', 'lang'), 'en');
    assert.equal(await page.textContent('h1'), 'Privacy policy');
    assert.match(await page.textContent('#traduction'), /translation provided for convenience[\s\S]*French\s+version\s+prevails/);
    const corps = await page.textContent('body');
    assert.match(corps, /The controller of your data is the Frutiparc volunteer team\./, 'le gabarit est rempli, en anglais');
    assert.ok(!corps.includes('{{'), 'plus aucun gabarit');
    for (const mot of ['Legal basis', 'youtube-nocookie', 'Resend', 'CNIL', '3 years', '24 hours', '6 months',
      'under 15', 'adult audience', 'Download my data', 'Delete my account']) {
      assert.ok(corps.includes(mot), 'la traduction parle de : ' + mot);
    }
    // Le lien vers le français, qui fait foi.
    await page.click('header >> text=Version française');
    await page.waitForURL(/\/confidentialite\?lang=fr$/);
    assert.equal(await page.textContent('h1'), 'Politique de confidentialité');

    // Un navigateur français, sans ?lang : le français.
    await page.goto(BASE + '/confidentialite');
    assert.equal(await page.getAttribute('html', 'lang'), 'fr');
    assert.equal(await page.textContent('h1'), 'Politique de confidentialité');
  } finally {
    await browser.close();
  }
});
