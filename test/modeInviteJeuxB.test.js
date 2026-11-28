/*
 * LE MODE INVITÉ, deuxième lot : MotionBall, Mini-Wave, JamaJama, MiniPixiz.
 *
 * Depuis l'accueil, un visiteur sans compte ouvre `/<jeu>/?invite=1` (voir
 * public/js/invite.js). Ce qu'on tient ici, dans un vrai Chromium et contre
 * le vrai serveur (en mémoire) :
 *
 *   · AUCUN SID, JAMAIS : chaque requête de la page est relevée, et aucune ne
 *     touche une route de session — ni lecture de fiche (/api/loadFrutiSlots,
 *     qui retombe sur « la dernière session vue de cette adresse » : un
 *     invité derrière la box d'un membre aurait sa partie), ni écriture, ni
 *     score, ni voyant, ni quête —, ni ne porte `sid=` ;
 *   · LA VERSION COMPLÈTE, en mémoire : les déblocages se lisent dans l'état
 *     du jeu (page.evaluate) ;
 *   · LE PANNEAU DE FIN : FPInvite.finDePartie est espionné, et chaque jeu
 *     l'appelle une fois, à la fin d'une partie menée par SES routines (dit
 *     jeu par jeu ci-dessous) ;
 *   · AVEC UNE VRAIE SESSION, rien ne change : la fiche se lit au serveur, rien
 *     n'est débloqué d'office, aucun panneau.
 *
 * Et la route publique de JamaJama (/api/jamajama/niveaux) : sans session,
 * sans cookie, sans rien de personnel.
 *
 * INVITE_CAPTURES=<dossier> : une capture de chaque jeu au moment du panneau.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');

const RACINE = path.join(__dirname, '..');
const R = require(path.join(RACINE, 'public/jamajama/regles.js'));
const PORT = 4377;
const BASE = `http://127.0.0.1:${PORT}`;
const CAPTURES = process.env.INVITE_CAPTURES || '';
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

// Les routes qu'un invité ne doit JAMAIS appeler : celles qui lisent ou
// écrivent au nom d'une session (et parfois retombent sur l'adresse IP).
const INTERDITES = [
  '/api/loadFrutiSlots', '/api/saveFrutiSlot', '/api/light/profile', '/api/saveScore',
  '/api/fd/status', '/api/quetes/', '/api/light/jeu-en-cours', '/api/antitriche/',
  '/api/jamajama/donnees', '/api/jamajama/pictos', '/api/jamajama/score',
  '/api/jamajama/aventure', '/api/jamajama/edition', '/api/minipixiz/',
];

function chromium() {
  for (const p of ['playwright', '/opt/node-tools/node_modules/playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(p).chromium; } catch { /* suivant */ }
  }
  return null;
}

let proc = null;
let navigateur = null;
let lien = null;
let donnees = null;
let pret = false;

before(async () => {
  /*
   * express (le module `send`) refuse de servir un fichier dont le chemin
   * contient un segment CACHÉ — et un arbre de travail vit souvent sous
   * `.claude/worktrees/…` : toutes les pages répondraient 404. On passe alors
   * par un lien symbolique sans point, que `--preserve-symlinks-main` garde
   * dans `__dirname` (cf. scripts/kit-bande-annonce/chat/lib/site.js).
   */
  let racine = RACINE;
  if (RACINE.split(path.sep).some((s) => s.startsWith('.'))) {
    lien = path.join(os.tmpdir(), 'fp-invite-b-' + PORT);
    try { fs.unlinkSync(lien); } catch { /* pas de lien précédent */ }
    fs.symlinkSync(RACINE, lien);
    racine = lien;
  }
  // Les fichiers de scores du serveur, à part : on n'écrit pas dans data/.
  donnees = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-invite-b-donnees-'));
  for (const f of fs.readdirSync(path.join(RACINE, 'data'))) {
    if (f.endsWith('.json')) fs.copyFileSync(path.join(RACINE, 'data', f), path.join(donnees, f));
  }
  proc = spawn(process.execPath, ['--preserve-symlinks', '--preserve-symlinks-main', path.join(racine, 'server.js')], {
    cwd: racine,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', XMLSOCKET_PORT: String(PORT + 1), FRUTISCORE_PORT: String(PORT + 2),
      FRUTI_DATA_DIR: donnees, REGISTER_MAX: '1000', REGISTER_DAILY_MAX: '1000',
    }),
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  for (let i = 0; i < 240 && !pret; i++) {
    try { pret = (await fetch(BASE + '/mb2/')).ok; } catch { /* pas encore */ }
    if (!pret) await attendre(250);
  }
  const c = chromium();
  if (pret && c) {
    try { navigateur = await c.launch(); } catch { navigateur = null; }
  }
});

after(async () => {
  if (navigateur) await navigateur.close().catch(() => {});
  if (proc) proc.kill('SIGKILL');
  if (lien) { try { fs.unlinkSync(lien); } catch { /* déjà parti */ } }
  if (donnees) fs.rmSync(donnees, { recursive: true, force: true });
});

function prerequis(t) {
  if (!pret) { t.skip('le serveur ne répond pas'); return false; }
  if (!navigateur) { t.skip('Chromium absent'); return false; }
  return true;
}

async function inscrire(pseudo) {
  const corps = JSON.stringify({ username: pseudo, password: 'secret123' });
  await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corps });
  const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corps });
  const j = await r.json();
  assert.ok(j.sid, 'session ouverte pour ' + pseudo);
  return j.sid;
}

/**
 * Une page, ses requêtes relevées, ses erreurs, et l'espion du panneau :
 * `window.__panneaux` reçoit les options de chaque FPInvite.finDePartie, et
 * `window.__panneauxOuverts` compte ceux qui se sont vraiment montrés.
 */
async function ouvrir(chemin, o) {
  const page = await navigateur.newPage({ viewport: (o && o.viewport) || { width: 640, height: 640 } });
  const requetes = [];
  const erreurs = [];
  page.on('request', (r) => requetes.push(r.url().replace(BASE, '')));
  page.on('pageerror', (e) => erreurs.push(e.message));
  await page.addInitScript(() => {
    let mod;
    Object.defineProperty(window, 'FPInvite', {
      configurable: true,
      get() { return mod; },
      set(v) {
        window.__panneaux = [];
        window.__panneauxOuverts = 0;
        const f = v.finDePartie;
        v.finDePartie = function (opts) {
          // (une fonction ne sort pas de la page : on note qu'elle y était)
          window.__panneaux.push(opts && typeof opts.surRejouer === 'function'
            ? Object.assign({}, opts, { surRejouer: 'fonction' }) : opts);
          const r = f.apply(this, arguments);
          if (r) window.__panneauxOuverts++;
          return r;
        };
        mod = v;
      },
    });
  });
  if (o && o.initScript) await page.addInitScript(o.initScript);
  await page.goto(BASE + chemin);
  return { page, requetes, erreurs };
}

function sansSession(requetes, jeu) {
  const fautives = requetes.filter((u) => u.includes('sid=') || INTERDITES.some((p) => u.startsWith(p)));
  assert.deepStrictEqual(fautives, [], jeu + ' : un invité n\'appelle aucune route de session');
}

async function capturer(page, nom) {
  if (!CAPTURES) return;
  fs.mkdirSync(CAPTURES, { recursive: true });
  await page.screenshot({ path: path.join(CAPTURES, 'invite-' + nom + '.png') });
}

async function attendrePanneau(page) {
  await page.waitForFunction(() => document.getElementById('fp-invite'), null, { timeout: 30000 });
  await attendre(400);
  return page.evaluate(() => ({ appels: window.__panneaux, ouverts: window.__panneauxOuverts }));
}

// ── Les fiches d'invité, hors navigateur ─────────────────────────────────

test('MiniPixiz : la fiche d\'invité est une vraie fiche — reparer() n\'y touche pas, les nuits y passent', () => {
  globalThis.MinipixizSorts = require(path.join(RACINE, 'public/minipixiz/sorts.js'));
  globalThis.MinipixizFee = require(path.join(RACINE, 'public/minipixiz/faerie.js'));
  const P = require(path.join(RACINE, 'public/minipixiz/plateforme.js'));
  const N = require(path.join(RACINE, 'public/minipixiz/nuit.js'));
  const F = globalThis.MinipixizFee;
  let graine = 7;
  const alea = () => { graine = (graine * 1103515245 + 12345) & 0x7fffffff; return graine / 0x7fffffff; };
  const maintenant = Date.UTC(2026, 10, 27, 14, 0, 0);
  const c = P.carteInvite(maintenant, alea);
  assert.deepStrictEqual(P.reparer(JSON.parse(JSON.stringify(c))).reparations, []);
  const fs = P.feeEnMain(c);
  assert.ok(fs && fs === c.$faerie[0], 'la fée est en main');
  const fi = new F.Fee(fs, null, c);
  assert.strictEqual(fs.$level, 8);
  assert.deepStrictEqual(fs.$carac, [1, 1, 3, 2, 1, 2], 'deux de vie, un de mana, un d\'intelligence');
  assert.ok(fs.$spell.length >= 5 && fs.$spell.slice(0, 2).join() === '20,0', 'les sorts de naissance, et ceux des montées');
  assert.ok(fs.$next && fs.$next[0] >= 0 && fs.$next[0] < F.NB_CARAC, 'la prochaine montée est préparée');
  assert.ok(fi.preteAuCombat() && fs.$life === fi.vieMax() && fs.$mana === fi.manaMax());
  assert.strictEqual(c.$time.$t, maintenant, 'l\'horloge de maintenant : aucune nuit à rattraper');
  assert.strictEqual(N.passerLeTemps(JSON.parse(JSON.stringify(c)), maintenant + 1000).nuits, 0);
  // Et si l'onglet restait ouvert trois jours, les nuits passeraient sans heurt.
  const plus = JSON.parse(JSON.stringify(c));
  const r = N.passerLeTemps(plus, maintenant + 3 * N.JOUR + 1000, alea);
  assert.strictEqual(r.nuits, 3);
  assert.deepStrictEqual(P.reparer(plus).reparations, []);
  assert.strictEqual(plus.$faerie.length, 1, 'la fée est toujours là');
});

test('Mini-Wave : la fiche d\'invité ouvre tout ce que le stand vend contre des crédits, rien d\'autre', () => {
  const W = require(path.join(RACINE, 'public/miniwave/plateforme.js'));
  const c = W.carteInvite();
  assert.deepStrictEqual(W.modesOuverts(c), {
    arcade: true, missions: [1, 1, 1, 1, 1, 0, 0, 0], letter: true, survival: true,
  });
  for (const a of W.BOUTIQUE) {
    const ouvreUnePorte = a.debloque.ship !== undefined || a.debloque.mission !== undefined || a.debloque.special !== undefined;
    assert.strictEqual(W.estAchete(c, a.id), ouvreUnePorte, a.nom);
  }
  assert.deepStrictEqual(W.nouveauxPictos(W.carteNeuve(), c).filter((p) => p.genre === 'article'), [], 'aucun picto d\'article');
});

// ── JamaJama : la route publique ─────────────────────────────────────────

test('JamaJama : /api/jamajama/niveaux est publique, sans session ni rien de personnel', async (t) => {
  if (!pret) return t.skip('le serveur ne répond pas');
  // Un membre a joué depuis cette même adresse (le repli « dernière session vue
  // de cette IP » de getSidFromRequest a donc de quoi répondre) et a validé un
  // niveau de sa main : il entre au tournoi, avec son pseudo.
  const pseudo = 'invitejama' + Date.now().toString(36).slice(-5);
  const sid = await inscrire(pseudo);
  const contenu = '10033022-11b21-12b12-11';       // « Par ici la sortie ! », rejoué [→, →, ↓, ↓]
  assert.ok(R.rejouer(R.Level.depuisChaine(contenu), [1, 1, 2, 2]).victorieux);
  const v = await (await fetch(BASE + '/api/jamajama/edition/valider', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sid, titre: 'Le niveau de ' + pseudo, contenu, mouvements: [1, 1, 2, 2] }),
  })).json();
  assert.ok(v.ok && v.tournoi, 'le niveau du membre est validé et entre au tournoi');
  const d = await (await fetch(BASE + '/api/jamajama/donnees?sid=' + encodeURIComponent(sid))).json();
  assert.ok(d.tournoi.some((n) => n.auteur === pseudo), 'le membre voit son niveau au tournoi');

  // L'invité, lui, ne passe aucun sid — et en passer un ne change rien.
  for (const url of ['/api/jamajama/niveaux', '/api/jamajama/niveaux?sid=' + encodeURIComponent(sid)]) {
    const r = await fetch(BASE + url, { headers: { Cookie: 'sid=' + sid } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.headers.get('set-cookie'), null, 'aucun cookie posé');
    const j = await r.json();
    assert.deepStrictEqual(Object.keys(j).sort(), ['ok', 'packs', 'tournoi'], 'ni pseudo, ni aventure, ni options');
    assert.strictEqual(j.packs.length, 7, 'les sept packs de levels.xml');
    assert.ok(j.packs.every((p) => typeof p.titre === 'string' && Array.isArray(p.niveaux)));
    assert.ok(j.tournoi.length > 0, 'les niveaux gravés du tournoi');
    assert.ok(j.tournoi.every((n) => n.id > 200000), 'que ceux de levels.xml (ids au-delà de 200000)');
    assert.ok(j.tournoi.every((n) => n.moi === null), 'aucun statut de joueur');
    assert.ok(!JSON.stringify(j).includes(pseudo), 'rien du membre, pas même son pseudo');
  }
  // Et le code de la route ne lit aucune session.
  const src = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');
  const debut = src.indexOf("app.get('/api/jamajama/niveaux'");
  const corps = src.slice(debut, src.indexOf('\n});', debut));
  assert.ok(debut > 0, 'la route existe');
  assert.ok(!/sid|session|getSidFromRequest|resolveUsername|cookie/i.test(corps), 'la route ne touche à aucune session');
});

// ── MotionBall ───────────────────────────────────────────────────────────

test('MotionBall en invité : courses et donjons ouverts, aucun sid, le panneau après le panneau de fin', async (t) => {
  if (!prerequis(t)) return;
  const { page, requetes, erreurs } = await ouvrir('/mb2/?invite=1', { viewport: { width: 800, height: 560 } });
  try {
    await page.waitForFunction(() => window.Mb2Jeu && Mb2Jeu.Manager.mode && Mb2Jeu.Manager.mode.constructor.name === 'Intro', null, { timeout: 30000 });
    const etat = await page.evaluate(() => ({
      actif: FPInvite.actif, invite: Mb2Jeu.Manager.client.invite, sid: Mb2Jeu.Manager.client.sid,
      courses: Mb2Jeu.Prefs.courses.slice(), donjons: Mb2Jeu.Prefs.dungeons.slice(),
      carte: [Mb2Jeu.Manager.client.fcard.$courses.length, Mb2Jeu.Manager.client.fcard.$dungeons.length],
    }));
    assert.strictEqual(etat.actif, true);
    assert.strictEqual(etat.invite, true);
    assert.strictEqual(etat.sid, '');
    assert.deepStrictEqual(etat.courses, [true, true, true, true, true, true, true], 'les sept courses (boules 40 à 46)');
    assert.deepStrictEqual(etat.donjons, [true, true, true, true, true], 'les cinq donjons, le cinquième compris (64)');

    // Une partie de Classique, finie par la routine du jeu : Manager.gameOver
    // (la bille perdue, CAUSE_NOBALLS) pose le panneau de fin du jeu ; le
    // clic sur ce panneau (GameOver.click) mène à Manager.gameFinished.
    await page.evaluate(() => Mb2Jeu.Manager.startGame(Mb2Jeu.Const.MODE_CLASSIC));
    await page.waitForFunction(() => Mb2Jeu.Manager.mode && Mb2Jeu.Manager.mode.constructor.name === 'Game', null, { timeout: 30000 });
    await attendre(800);
    await page.evaluate(() => Mb2Jeu.Manager.gameOver(Mb2Jeu.Const.CAUSE_NOBALLS));
    await attendre(600);
    assert.deepStrictEqual(await page.evaluate(() => window.__panneaux), [], 'pas de panneau tant que celui du jeu attend son clic');
    await page.evaluate(() => Mb2Jeu.Manager.mode.click());
    const p = await attendrePanneau(page);
    assert.deepStrictEqual(p.appels, [{ score: 'niveau 1', libelle: 'Ton score' }], 'une fois, avec le score affiché par le jeu');
    assert.strictEqual(p.ouverts, 1);
    await capturer(page, 'mb2');
    sansSession(requetes, 'MotionBall');
    assert.deepStrictEqual(erreurs, []);
  } finally { await page.close(); }
});

// ── Mini-Wave ────────────────────────────────────────────────────────────

test('Mini-Wave en invité : six vaisseaux, cinq missions, deux modes spéciaux, aucun sid, le panneau sur l\'écran de fin', async (t) => {
  if (!prerequis(t)) return;
  const { page, requetes, erreurs } = await ouvrir('/miniwave/?invite=1', { viewport: { width: 600, height: 700 } });
  try {
    await page.waitForFunction(() => window.__plateforme && window.__ui && window.miniwaveClient, null, { timeout: 30000 });
    const c = await page.evaluate(() => ({ invite: __plateforme.invite, sid: __plateforme.sid, charge: __plateforme.charge, carte: __plateforme.carte }));
    assert.strictEqual(c.invite, true);
    assert.strictEqual(c.sid, '');
    assert.strictEqual(c.charge, false, 'la fiche ne s\'enregistrera jamais');
    assert.deepStrictEqual(c.carte.$ship, [1, 1, 1, 1, 1, 1]);
    assert.deepStrictEqual(c.carte.$mode[1], [1, 1, 1, 1, 1, 0, 0, 0], 'les cinq missions qui existent');
    assert.deepStrictEqual(c.carte.$mode[2], [1, 1, 0], 'Letter Invader et Endurance');
    // Au stand : vaisseaux, missions et modes acquis ; les pictos (10 à 14), non.
    assert.deepStrictEqual(c.carte.$shop.map((v, i) => (v === 0 ? i : -1)).filter((i) => i >= 0),
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 15, 16]);
    assert.strictEqual(c.carte.$credit, 0, 'pas un crédit d\'office');

    // Une partie d'arcade avec le Rycher (vaisseau 5, à vendre d'ordinaire),
    // finie par le moteur lui-même (Game.finPartie, l'escadron perdu).
    await page.evaluate(() => __ui.lancer({ mode: 'arcade', niveaux: __ui.niveaux.main[0].levels, vies: 1, nom: 'Arcade' }, [5]));
    await attendre(1200);
    assert.strictEqual(await page.evaluate(() => miniwaveClient.jeu.heroList[0]), 5);
    await page.evaluate(() => miniwaveClient.jeu.finPartie('gameover'));
    const p = await attendrePanneau(page);
    assert.strictEqual(await page.evaluate(() => document.getElementById('fin').classList.contains('on')), true,
      'l\'écran de fin du jeu est là, dessous');
    // libelleEn : le libellé du panneau en anglais (docs/I18N.md, « Les jeux »).
    assert.deepStrictEqual(p.appels, [{ score: '0 points', libelle: 'Ton score', libelleEn: 'Your score' }]);
    assert.strictEqual(p.ouverts, 1);
    assert.strictEqual(await page.evaluate(() => document.getElementById('fin-pictos').textContent), '',
      'plus de « Partie hors compte. »');
    await capturer(page, 'miniwave');
    // « Rejouer » du panneau le ferme : l'écran de fin et ses boutons restent.
    await page.click('#fp-invite .fpi-non');
    assert.strictEqual(await page.evaluate(() => !!document.getElementById('fp-invite')), false);
    assert.strictEqual(await page.evaluate(() => document.getElementById('fin').classList.contains('on')), true);
    sansSession(requetes, 'Mini-Wave');
    assert.deepStrictEqual(erreurs, []);
  } finally { await page.close(); }
});

// ── JamaJama ─────────────────────────────────────────────────────────────

// La plateforme et le menu vivent dans la fermeture de jeu.js : on les attrape
// au vol, à leur création, sans rien changer au jeu.
function espionJama() {
  let p, e;
  Object.defineProperty(window, 'JamaPlateforme', {
    configurable: true, get() { return p; },
    set(v) {
      const Base = v.Plateforme;
      v.Plateforme = class extends Base { constructor(...a) { super(...a); window.__jama = this; } };
      p = v;
    },
  });
  Object.defineProperty(window, 'JamaEcrans', {
    configurable: true, get() { return e; },
    set(v) {
      const Base = v.EcranMenu;
      v.EcranMenu = class extends Base { constructor(...a) { super(...a); window.__jamaMenu = this; } };
      e = v;
    },
  });
}

/** Une solution du niveau, trouvée en le jouant (largeur d'abord). */
function resoudre(chaine, profondeur) {
  const file = [[]];
  const vus = new Set();
  while (file.length) {
    const chemin = file.shift();
    if (chemin.length > profondeur) return null;
    const v = R.rejouer(R.Level.depuisChaine(chaine), chemin);
    if (v.victorieux) return chemin;
    if (v.fini) continue;
    const cle = chemin.join(',');
    if (vus.has(cle)) continue;
    vus.add(cle);
    for (const d of [0, 1, 2, 3]) file.push(chemin.concat([d]));
  }
  return null;
}

test('JamaJama en invité : toute l\'aventure jouable, le tournoi gravé, ni éditeur ni stats, le panneau sur la victoire', async (t) => {
  if (!prerequis(t)) return;
  const { page, requetes, erreurs } = await ouvrir('/jamajama/?invite=1', { viewport: { width: 600, height: 600 }, initScript: espionJama });
  try {
    await page.waitForFunction(() => window.__jama && window.__jama.pret && window.__jamaMenu, null, { timeout: 30000 });
    const etat = await page.evaluate(() => ({
      invite: __jama.invite, sid: __jama.sid,
      packs: __jama.packsOuverts().map((p) => ({ titre: p.titre.trim(), indice: p.indice, n: p.niveaux.length,
        vides: p.niveaux.filter((n) => !n.contenu).length })),
      tournoi: __jama.tournoi.map((n) => n.moi),
      menu: __jamaMenu.items.map((i) => i.id),
    }));
    assert.strictEqual(etat.invite, true);
    assert.strictEqual(etat.sid, '');
    assert.deepStrictEqual(etat.packs.map((p) => p.indice), [0, 1, 2, 6],
      'tous les packs qui ont de quoi jouer — sans les trois paliers vides de levels.xml');
    assert.ok(etat.packs.every((p) => p.n > 0 && p.vides === 0), 'aucun niveau vide');
    assert.ok(etat.tournoi.length > 0 && etat.tournoi.every((m) => m === null), 'le tournoi gravé, en partie libre');
    assert.deepStrictEqual(etat.menu, [1, 2, 6, 7], 'tournoi, aventure, aide, options — ni édition ni statistiques');

    // Le premier niveau, joué au clavier jusqu'à la victoire (la solution est
    // cherchée en le rejouant avec regles.js). Le panneau suit le fondu de
    // victoire, sur le plateau final ; la liste du pack attend qu'il se ferme.
    // Le fondu d'OUVERTURE, lui, est coupé comme le joueur le ferait dans
    // les options : le niveau se joue tout de suite.
    await page.evaluate(() => { __jama.options.showBeginFade = false; });
    const k = 600 / 384;
    await page.mouse.click(300, 210 * k);            // « aventure »
    await attendre(1200);
    await page.mouse.click(300, 50 * k);             // le premier pack
    await attendre(1200);
    // Le parchemin : des jokers sans fond, on va où l'on veut dans le pack.
    await page.mouse.click(397, 433);                // « JOUER »
    await attendre(1500);
    const d = await (await fetch(BASE + '/api/jamajama/niveaux')).json();
    const solution = resoudre(d.packs[0].niveaux[0].contenu, 8);
    assert.ok(solution, 'le premier niveau a une solution');
    const fleches = ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'];
    for (const m of solution) { await page.keyboard.press(fleches[m]); await attendre(900); }
    const p = await attendrePanneau(page);
    assert.deepStrictEqual(p.appels, [{ titre: 'Niveau réussi !', score: solution.length, libelle: 'Coups joués', surRejouer: 'fonction' }],
      'une fois, avec les coups joués — et la suite du jeu (surRejouer) quand il se ferme');
    assert.strictEqual(p.ouverts, 1);
    await capturer(page, 'jamajama');
    // « Rejouer » ferme le panneau, et le jeu reprend : retour au parchemin,
    // le niveau fini (en mémoire seulement).
    await page.click('#fp-invite .fpi-non');
    await attendre(800);
    assert.strictEqual(await page.evaluate(() => __jama.aventure.hasCompletedLevel(0, 0)), true);
    sansSession(requetes, 'JamaJama');
    assert.ok(requetes.includes('/api/jamajama/niveaux'), 'les niveaux viennent de la route publique');
    assert.deepStrictEqual(erreurs, []);
  } finally { await page.close(); }
});

// ── MiniPixiz ────────────────────────────────────────────────────────────

test('MiniPixiz en invité : la fiche d\'habitué, tous les lieux, aucun sid, le panneau sur la clairière', async (t) => {
  if (!prerequis(t)) return;
  const { page, requetes, erreurs } = await ouvrir('/minipixiz/?invite=1', { viewport: { width: 600, height: 640 } });
  try {
    await page.waitForFunction(() => window.__plateforme && window.__menu && window.__client, null, { timeout: 30000 });
    await attendre(1500);
    const c = await page.evaluate(() => {
      const carte = __plateforme.carte;
      const fs = carte.$faerie[0];
      const fi = new MinipixizFee.Fee(fs, null, carte);
      return {
        invite: __plateforme.invite, sid: __plateforme.sid, charge: __plateforme.charge,
        bag: carte.$bag, key: carte.$key, checkpoint: carte.$checkpoint, frog: carte.$frog,
        donjon: carte.$dungeon, arc: carte.$rainbow, lueur: !!carte.$pond.$fs, run: carte.$stat.$run,
        missions: (carte.$mission || []).length, current: carte.$current, fees: carte.$faerie.length,
        fee: { level: fs.$level, sorts: fs.$spell.length, prete: fi.preteAuCombat(), vie: fs.$life, vieMax: fi.vieMax() },
        relais: __plateforme.carteDesRelais().length,
        album: carte.$stat.$item.filter(Boolean).length, diam: carte.$diam,
        reparations: MinipixizPlateforme.reparer(JSON.parse(JSON.stringify(carte))).reparations,
      };
    });
    assert.strictEqual(c.invite, true);
    assert.strictEqual(c.sid, '');
    assert.strictEqual(c.charge, false);
    assert.strictEqual(c.bag, 4, 'le dernier sac');
    assert.strictEqual(c.key, 9, 'le trousseau plein');
    assert.strictEqual(c.checkpoint, 6);
    assert.strictEqual(c.relais, 7, 'les sept relais de la forêt');
    assert.strictEqual(c.frog, true, 'Ornegon');
    assert.deepStrictEqual(c.donjon, { $lvl: 0, $f: true, $day: 0, $loop: 0 }, 'la petite tour, debout');
    assert.strictEqual(c.arc.$f, true, 'un arc-en-ciel ce matin');
    assert.ok(c.arc.$it >= 60 && c.arc.$it <= 72, 'avec un lot que la nuit aurait tiré');
    assert.strictEqual(c.lueur, true, 'une lueur au fond du bassin');
    assert.ok(c.run > 5000);
    assert.strictEqual(c.missions, 6, 'les six offres de Gromelin');
    assert.strictEqual(c.current, 0);
    assert.strictEqual(c.fees, 1);
    assert.strictEqual(c.fee.level, 8);
    assert.ok(c.fee.sorts >= 3, 'la fée sait quelques sorts');
    assert.strictEqual(c.fee.prete, true, 'elle est prête au combat');
    assert.strictEqual(c.fee.vie, c.fee.vieMax);
    assert.strictEqual(c.album, 0, 'rien à l\'album');
    assert.strictEqual(c.diam, 0, 'ni diamant');
    assert.deepStrictEqual(c.reparations, [], 'une fiche que reparer() n\'a pas à toucher');

    const choisir = (va, nom) => page.evaluate(([va, nom]) => {
      const l = { va, nom, titre: nom };
      __menu.surChoix(l, __menu.etatLieu(l));
    }, [va, nom]);

    // LA FORÊT : le premier relais, puis la défaite par le moteur lui-même
    // (Jeu.finPartie : la pile déborde) — fondu, panneau « Game Over »,
    // `rideau`, et la clairière revient. Le panneau s'y pose.
    await choisir('foret', 'forest');
    await page.waitForFunction(() => __client.carteForet, null, { timeout: 10000 });
    await page.evaluate(() => __client.carteForet.surChoix(0));
    await page.waitForFunction(() => __client.jeu && __client.champ && __client.champ.faerieList[0], null, { timeout: 15000 });
    await page.evaluate(() => __client.jeu.finPartie(false));
    await attendre(500);
    assert.deepStrictEqual(await page.evaluate(() => window.__panneaux), [], 'rien pendant le fondu et le Game Over');
    let p = await attendrePanneau(page);
    // Le panneau porte son anglais à côté du français (libelleEn, titreEn).
    assert.deepStrictEqual(p.appels, [{ titre: undefined, titreEn: undefined, score: 1, libelle: 'Niveau atteint',
      libelleEn: 'Level reached' }]);
    assert.ok(await page.evaluate(() => document.getElementById('menu').classList.contains('on')), 'sur la clairière');
    await capturer(page, 'minipixiz');
    await page.click('#fp-invite .fpi-non');
    await attendre(800);

    // LE DONJON, L'ARC-EN-CIEL, L'ARBRE CREUX : par la clairière, comme au
    // doigt ; chacun perdu par son moteur, chacun son panneau (second rideau).
    const attendus = {
      Donjon: { titre: undefined, titreEn: undefined, score: '1 / 10', libelle: 'Étage atteint', libelleEn: 'Floor reached' },
      ArcEnCiel: { titre: undefined, titreEn: undefined },
      Arbre: { score: 0, libelle: 'Ton score', libelleEn: 'Your score' },
    };
    for (const [va, nom, classe] of [['dungeon', 'dungeon', 'Donjon'], ['rainbow', 'rainbow', 'ArcEnCiel'], ['tree', 'tree', 'Arbre']]) {
      await choisir(va, nom);
      await page.waitForFunction(() => __client.lieu && __client.lieu.jeu, null, { timeout: 15000 });
      assert.strictEqual(await page.evaluate(() => __client.lieu.constructor.name), classe);
      await attendre(1500);
      await page.evaluate(() => __client.lieu.jeu.finPartie(false));
      p = await attendrePanneau(page);
      assert.deepStrictEqual(p.appels[p.appels.length - 1], attendus[classe], classe);
      await page.click('#fp-invite .fpi-non');
      await attendre(800);
    }
    p = await page.evaluate(() => ({ appels: window.__panneaux.length, ouverts: window.__panneauxOuverts }));
    assert.deepStrictEqual(p, { appels: 4, ouverts: 4 }, 'un panneau par partie, pas plus');
    assert.strictEqual(await page.evaluate(() => __plateforme.carte.$key), 8, 'le donjon a pris sa clé');
    sansSession(requetes, 'MiniPixiz');
    assert.deepStrictEqual(erreurs, []);
  } finally { await page.close(); }
});

// ── Avec une vraie session, rien ne change ───────────────────────────────

test('avec une vraie session : la fiche se lit au serveur, rien n\'est débloqué d\'office, aucun panneau', async (t) => {
  if (!prerequis(t)) return;
  const sid = await inscrire('invitemembre' + Date.now().toString(36).slice(-5));
  const q = '?sid=' + encodeURIComponent(sid);

  // MotionBall
  let o = await ouvrir('/mb2/' + q, { viewport: { width: 800, height: 560 } });
  try {
    await o.page.waitForFunction(() => window.Mb2Jeu && Mb2Jeu.Manager.mode && Mb2Jeu.Manager.mode.constructor.name === 'Intro', null, { timeout: 30000 });
    const e = await o.page.evaluate(() => ({ actif: FPInvite.actif, invite: Mb2Jeu.Manager.client.invite, sid: !!Mb2Jeu.Manager.client.sid,
      courses: Mb2Jeu.Prefs.courses.slice(), donjons: Mb2Jeu.Prefs.dungeons.slice() }));
    assert.deepStrictEqual(e, { actif: false, invite: false, sid: true, courses: [true], donjons: [true, true, true, true] });
    assert.ok(o.requetes.some((u) => u.startsWith('/api/loadFrutiSlots')), 'MotionBall lit la fiche du membre');
    await o.page.evaluate(() => Mb2Jeu.Manager.startGame(Mb2Jeu.Const.MODE_CLASSIC));
    await o.page.waitForFunction(() => Mb2Jeu.Manager.mode && Mb2Jeu.Manager.mode.constructor.name === 'Game', null, { timeout: 30000 });
    await o.page.evaluate(() => Mb2Jeu.Manager.gameOver(Mb2Jeu.Const.CAUSE_NOBALLS));
    await attendre(300);
    await o.page.evaluate(() => Mb2Jeu.Manager.mode.click());
    await attendre(800);
    assert.deepStrictEqual(await o.page.evaluate(() => [window.__panneaux, !!document.getElementById('fp-invite')]), [[], false]);
    assert.deepStrictEqual(o.erreurs, []);
  } finally { await o.page.close(); }

  // Mini-Wave
  o = await ouvrir('/miniwave/' + q, { viewport: { width: 600, height: 700 } });
  try {
    await o.page.waitForFunction(() => window.__plateforme && window.__ui && window.miniwaveClient && window.__plateforme.charge, null, { timeout: 30000 });
    const e = await o.page.evaluate(() => ({ invite: __plateforme.invite, ship: __plateforme.carte.$ship, m: __plateforme.carte.$mode[1] }));
    assert.deepStrictEqual(e, { invite: false, ship: [1, 0, 0, 0, 0, 0], m: [0, 0, 0, 0, 0, 0, 0, 0] });
    assert.ok(o.requetes.some((u) => u.startsWith('/api/loadFrutiSlots')), 'Mini-Wave lit la fiche du membre');
    await o.page.evaluate(() => __ui.lancer({ mode: 'arcade', niveaux: __ui.niveaux.main[0].levels, vies: 1, nom: 'Arcade' }, [0]));
    await attendre(800);
    await o.page.evaluate(() => miniwaveClient.jeu.finPartie('gameover'));
    await attendre(1500);
    assert.deepStrictEqual(await o.page.evaluate(() => [window.__panneaux, !!document.getElementById('fp-invite')]), [[], false]);
    assert.deepStrictEqual(o.erreurs, []);
  } finally { await o.page.close(); }

  // JamaJama
  o = await ouvrir('/jamajama/' + q, { viewport: { width: 600, height: 600 }, initScript: espionJama });
  try {
    await o.page.waitForFunction(() => window.__jama && window.__jama.pret && window.__jamaMenu, null, { timeout: 30000 });
    const e = await o.page.evaluate(() => ({ invite: __jama.invite, packs: __jama.packsOuverts().length, menu: __jamaMenu.items.map((i) => i.id) }));
    assert.deepStrictEqual(e, { invite: false, packs: 2, menu: [1, 2, 4, 5, 6, 7] },
      'les deux premiers packs (le second attend son dernier niveau), et le menu entier');
    assert.ok(o.requetes.some((u) => u.startsWith('/api/jamajama/donnees')), 'JamaJama lit les données du membre');
    assert.ok(!o.requetes.includes('/api/jamajama/niveaux'));
    assert.deepStrictEqual(o.erreurs, []);
  } finally { await o.page.close(); }

  // MiniPixiz
  o = await ouvrir('/minipixiz/' + q, { viewport: { width: 600, height: 640 } });
  try {
    await o.page.waitForFunction(() => window.__plateforme && window.__menu && window.__client && window.__plateforme.charge, null, { timeout: 30000 });
    const e = await o.page.evaluate(() => {
      const c = __plateforme.carte;
      return { invite: __plateforme.invite, bag: c.$bag, key: c.$key, cp: c.$checkpoint, frog: c.$frog, fees: c.$faerie.length, donjon: c.$dungeon.$f };
    });
    assert.deepStrictEqual(e, { invite: false, bag: 0, key: 0, cp: 0, frog: false, fees: 0, donjon: false });
    assert.ok(o.requetes.some((u) => u.startsWith('/api/loadFrutiSlots')), 'MiniPixiz lit la fiche du membre');
    await o.page.evaluate(() => __entrerEnForet());
    await o.page.waitForFunction(() => __client.jeu, null, { timeout: 15000 });
    await o.page.evaluate(() => __client.jeu.finPartie(false));
    await o.page.waitForFunction(() => document.getElementById('menu').classList.contains('on'), null, { timeout: 30000 });
    await attendre(500);
    assert.deepStrictEqual(await o.page.evaluate(() => [window.__panneaux, !!document.getElementById('fp-invite')]), [[], false]);
    assert.deepStrictEqual(o.erreurs, []);
  } finally { await o.page.close(); }
});
