'use strict';
/*
 * MINIPIXIZ EN ANGLAIS, DANS UN VRAI NAVIGATEUR
 * ═════════════════════════════════════════════
 *
 * La page du jeu, ouverte en invité (`/minipixiz/?invite=1`) contre le vrai
 * serveur, avec `localStorage.fp_lang = 'en'` — la langue que le sélecteur du
 * site range. On y relève :
 *
 *   · la clairière (le HTML marqué, et ce que le canevas écrit — un espion sur
 *     fillText note chaque texte dessiné) ;
 *   · une mission de Gromelin et ses répliques à la porte ;
 *   · le sac, le nom et la description des objets, les sorts ;
 *   · un écran de fin (la nouvelle d'un relais) et le panneau de l'invité,
 *     qui reçoit son anglais (libelleEn, titreEn) ;
 *   · aucune requête en échec, aucune erreur de page.
 *
 * Puis la même page en français : rien n'y a bougé, et le dictionnaire
 * anglais n'est pas même téléchargé.
 *
 * Le serveur passe par un lien symbolique sans point (express refuse les
 * chemins à segment caché, et un arbre de travail vit sous `.claude/…`).
 * I18N_CAPTURES=<dossier> : des captures d'écran de chaque étape.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');

const RACINE = path.join(__dirname, '..');
const PORT = 5790;
const BASE = `http://127.0.0.1:${PORT}`;
const CAPTURES = process.env.I18N_CAPTURES || '';
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

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
  let racine = RACINE;
  if (RACINE.split(path.sep).some((s) => s.startsWith('.'))) {
    lien = path.join(os.tmpdir(), 'fp-i18n-minipixiz-' + PORT);
    try { fs.unlinkSync(lien); } catch { /* pas de lien précédent */ }
    fs.symlinkSync(RACINE, lien);
    racine = lien;
  }
  donnees = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-i18n-minipixiz-donnees-'));
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
    try { pret = (await fetch(BASE + '/minipixiz/')).ok; } catch { /* pas encore */ }
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

/**
 * La page du jeu dans une langue : ses requêtes (et celles qui échouent), ses
 * erreurs, l'espion du panneau de l'invité, et celui du canevas — chaque
 * texte que fillText écrit s'ajoute à `window.__textes`.
 */
async function ouvrir(langue) {
  const contexte = await navigateur.newContext({ viewport: { width: 600, height: 640 } });
  const page = await contexte.newPage();
  const requetes = [];
  const echecs = [];
  const erreurs = [];
  page.on('request', (r) => requetes.push(r.url().replace(BASE, '')));
  page.on('requestfailed', (r) => echecs.push(r.url().replace(BASE, '') + ' — ' + ((r.failure() || {}).errorText || '?')));
  page.on('response', (r) => { if (r.status() >= 400) echecs.push(r.url().replace(BASE, '') + ' — ' + r.status()); });
  page.on('pageerror', (e) => erreurs.push(e.message));
  await page.addInitScript((l) => {
    try { localStorage.setItem('fp_lang', l); } catch (e) { /* pas de stockage */ }
    window.__textes = [];
    const fill = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (t) {
      window.__textes.push(String(t));
      return fill.apply(this, arguments);
    };
    let mod;
    Object.defineProperty(window, 'FPInvite', {
      configurable: true,
      get() { return mod; },
      set(v) {
        window.__panneaux = [];
        const f = v.finDePartie;
        v.finDePartie = function (opts) { window.__panneaux.push(opts); return f.apply(this, arguments); };
        mod = v;
      },
    });
  }, langue);
  await page.goto(BASE + '/minipixiz/?invite=1');
  await page.waitForFunction(() => window.__plateforme && window.__menu && window.__client && window.__inventaire,
    null, { timeout: 30000 });
  await attendre(1200);
  return { contexte, page, requetes, echecs, erreurs };
}

async function capturer(page, nom) {
  if (!CAPTURES) return;
  fs.mkdirSync(CAPTURES, { recursive: true });
  await page.screenshot({ path: path.join(CAPTURES, 'minipixiz-' + nom + '.png') });
}
// Les textes écrits sur les canevas depuis le dernier relevé.
const textes = (page) => page.evaluate(() => { const t = window.__textes.slice(); window.__textes.length = 0; return t; });
// Ce qui trahirait du français resté dans l'anglais.
const FRANCAIS = /\b(le|la|les|des|du|une|est|vous|votre|pour|avec|dans|fée|fées|sac|objet|mission!|jours)\b/i;

test('MiniPixiz en anglais : clairière, mission, sac, sorts, écran de fin — sans requête en échec ni erreur', async (t) => {
  if (!prerequis(t)) return;
  const { contexte, page, requetes, echecs, erreurs } = await ouvrir('en');
  try {
    assert.strictEqual(await page.evaluate(() => FPI18n.langue), 'en');
    assert.strictEqual(await page.evaluate(() => document.documentElement.lang), 'en');
    assert.ok(requetes.includes('/minipixiz/lang/en.js'), 'le dictionnaire du jeu est chargé');

    // ── LA CLAIRIÈRE : le HTML marqué, et le canevas ──
    const dom = await page.evaluate(() => ({
      sac: document.getElementById('menu-sac').textContent,
      aide: document.getElementById('aide').textContent,
      tactile: document.getElementById('aide-tactile').textContent,
      poser: document.querySelector('[data-cmd="bas"]').textContent,
      fee: document.querySelector('[data-cmd-aide]').getAttribute('aria-label'),
      moulin: document.querySelector('#moulin h2').textContent,
      retour: document.getElementById('inv-fermer').textContent,
    }));
    assert.deepStrictEqual(dom, {
      sac: '🎒 bag',
      aide: '← → to move · space to rotate · ↓ to drop · ↑ to call the fairy — keys can be remapped at the windmill',
      tactile: 'tap the board to rotate · swipe to move · pull down to drop',
      poser: 'DROP', fee: 'Call the fairy', moulin: 'The Windmill — Options', retour: 'back',
    });
    await attendre(300);
    assert.ok((await textes(page)).includes('drag to look around · tap a place to go there'), 'la consigne de la clairière');
    // Survoler un lieu écrit son nom ; un refus se dit dans la langue.
    const lieux = await page.evaluate(() => {
      const noms = [];
      for (const l of MinipixizMenu.LIEUX) {
        __menu.lieuA = () => ({ lieu: l });
        __menu.viser({ clientX: 0, clientY: 0 });
        noms.push(__menu.titre);
      }
      delete __menu.lieuA;
      const l = { va: 'fountain', nom: 'fountain', titre: 'Bassin aux fees ' };
      __menu.surChoix(l, { feeEnMain: true, ouvert: true });
      return { noms, refus: __menu.message };
    });
    assert.deepStrictEqual(lieux.noms, ['Rainbow', 'Windmill', 'Dungeon', 'Fairy pond', 'Enchanted forest',
      'Gromelin\'s hut', 'Hollow tree', 'Inventory', 'Ornegon']);
    assert.strictEqual(lieux.refus, 'You can\'t dive into the pond with a fairy on the loose!');
    await attendre(300);
    await capturer(page, 'clairiere');

    // ── GROMELIN : les répliques à la porte, puis une mission ──
    const g = await page.evaluate(() => {
      __menu.dire('');
      // Comme surChoix : la clairière se ferme, la cabane s'ouvre sur le plateau.
      __menu.arreter();
      document.getElementById('menu').classList.remove('on');
      const a = __ouvrirGromelin();
      return a.dial;
    });
    assert.strictEqual(g[0], 'Knock, knock...');
    for (const l of g) assert.ok(!FRANCAIS.test(l), 'Gromelin parle anglais : ' + l);
    assert.ok(g.includes('What are you doing here, little man?'), 'la première visite : ' + g.join(' | '));
    // La visite suivante, la fée au bocal (Gromelin ne prend qu'elles) : les offres.
    const g2 = await page.evaluate(() => {
      const fs0 = __plateforme.carte.$faerie[0];
      fs0.$pos = 0;
      const d = __ouvrirGromelin().dial;
      fs0.$pos = null;
      return d;
    });
    for (const l of g2) assert.ok(!FRANCAIS.test(l), 'Gromelin parle anglais : ' + l);
    assert.ok(g2.some((l) => /^Mmmmhhh\.\.\. I might have a job for \w+\.$/.test(l)), 'il a du travail : ' + g2.join(' | '));
    assert.ok(g2.includes('Come on in, then...'));
    const m = await page.evaluate(() => {
      const gr = __client.gromelin;
      gr.dial = []; gr.bulle = null; gr.frame = 3; gr.etape = 2; gr.porteOuverte = true;
      return new Promise((r) => setTimeout(() => r(gr.decrit), 400));
    });
    assert.ok(m && m.titre && m.enonce, 'la mission est décrite');
    for (const k of ['titre', 'enonce']) {
      assert.ok(!/\$\w/.test(m[k]), 'aucun jeton : ' + m[k]);
      assert.ok(!FRANCAIS.test(m[k]), 'la mission est en anglais : ' + m[k]);
    }
    assert.ok(['Combat', 'Search', 'Investigation', 'Race', 'Magic', 'Contest', 'Story contest'].includes(m.type), m.type);
    const ecrits = await textes(page);
    assert.ok(ecrits.includes('accept the mission!'), 'le bouton');
    assert.ok(ecrits.includes('type: ' + m.type), 'le type');
    assert.ok(ecrits.some((x) => /^length: \d+ days$/.test(x)), 'la durée');
    await capturer(page, 'mission');
    // Le panneau d'envoi.
    await page.evaluate(() => { __client.gromelin.etape = 4; __client.gromelin.frame = 4; });
    await attendre(300);
    const envoi = await textes(page);
    assert.ok(envoi.includes('select one or more fairies') && envoi.includes('confirm the mission'), envoi.join(' | '));
    await capturer(page, 'mission-envoi');
    await page.evaluate(() => { const f = __client.gromelin.surFermer; __client.gromelin = null; f(); });
    await attendre(600);

    // ── LE SAC : les objets, la fée, ses sorts ──
    const sac = await page.evaluate(() => {
      const carte = __plateforme.carte;
      // La fiche d'invité vit en mémoire : on lui garnit le sac.
      carte.$inv = [72, 31, 41, 120, 305, 30, 55, 61];
      __ouvrirSac();
      const inv = __inventaire;
      const objets = [];
      for (let i = 0; i < (carte.$inv || []).length; i++) {
        const s = inv.survolDe({ sac: 'joueur', case: i });
        if (s) objets.push(s.titre + ' ' + s.message);
      }
      inv.volet = 0;
      const prochain = inv.prochainNiveau(inv.fee());
      inv.montrerGouts();
      const gouts = inv.message;
      inv.direSante('faim');
      const faim = inv.message;
      return {
        objets, prochain, gouts, faim,
        info: [72, 31, 41, 120, 305].map((n) => MinipixizObjets.info(n)).map((it) => it.nom + ' — ' + it.desc),
        sorts: [20, 3, 13].map((n) => { const s = MinipixizSorts.nouveauSort(n, null); return s.nom() + ' — ' + s.description(); }),
        bulle: MinipixizInventaire.SECTION_BULLE.length,
      };
    });
    assert.ok(sac.objets.length > 0, 'le sac a des objets');
    for (const o of sac.objets.concat(sac.info, sac.sorts)) assert.ok(!FRANCAIS.test(o), 'en anglais : ' + o);
    assert.deepStrictEqual(sac.info, [
      'Super potion — Drinking it, your fairy gets all her hearts back.',
      'Dungeon key — It opens the dungeon door.',
      'Tribal mask — Your fairy scares the demons.',
      'Scroll: Light balls — They let fairies defend themselves against the demons.',
      'Grapes — Food keeps your fairies in shape and helps them get their health back faster overnight.',
    ]);
    assert.deepStrictEqual(sac.sorts, [
      'Light balls — They let fairies defend themselves against the demons.',
      'Meteor — Turns the next piece into a blazing, destructive meteor.',
      'Super Nova — Creates a black hole that sucks in the nearest marbles.',
    ]);
    assert.strictEqual(sac.prochain.titre, 'Next level:');
    assert.match(sac.prochain.message, /^\+1 (power|speed|life|intelligence|concentration|mana)( or .+)?$/);
    assert.match(sac.gouts, /^Likes: .*  ·  Hates: /);
    assert.match(sac.faim, /^belly \d+ \/ 20/);
    await attendre(300);
    await capturer(page, 'sac');
    // Le volet des sortilèges : les noms en bandeau, au toucher.
    const sorts = await page.evaluate(() => {
      __inventaire.volet = 1;
      __inventaire.rendre();
      const z = __inventaire.zones.find((q) => q.quoi && q.quoi.sort !== undefined);
      if (z) __inventaire.agir(z.quoi);
      return { titre: __inventaire.titre, message: __inventaire.message };
    });
    assert.ok(/:$/.test(sorts.titre) && !FRANCAIS.test(sorts.message), JSON.stringify(sorts));
    await capturer(page, 'sac-sorts');
    await page.evaluate(() => __inventaire.fermer());
    await attendre(600);

    // ── UN ÉCRAN DE FIN : la nouvelle d'un relais ──
    await page.evaluate(() => {
      __menu.arreter();
      document.getElementById('menu').classList.remove('on');
      __client.ouvrirNouvelle({ genre: 'relais', numero: 2, nom: MinipixizPlateforme.nomDuRelais(1), surFermer() {} });
    });
    await attendre(400);
    const fin = (await textes(page)).join(' ');
    assert.match(fin, /Congratulations, you have reached The serene clearing!!/);
    await capturer(page, 'relais');
    await page.evaluate(() => { __client.nouvelle = null; __ouvrirMenu(); });
    await attendre(400);

    // ── LA FORÊT PERDUE, ET LE PANNEAU DE L'INVITÉ ──
    await page.evaluate(() => {
      const l = { va: 'foret', nom: 'forest', titre: 'Foret enchantee' };
      __menu.surChoix(l, __menu.etatLieu(l));
    });
    await page.waitForFunction(() => __client.carteForet, null, { timeout: 10000 });
    await page.evaluate(() => __client.carteForet.surChoix(0));
    await page.waitForFunction(() => __client.jeu && __client.champ, null, { timeout: 15000 });
    await attendre(800);
    await capturer(page, 'foret');
    await page.evaluate(() => __client.jeu.finPartie(false));
    await page.waitForFunction(() => document.getElementById('fp-invite'), null, { timeout: 30000 });
    await attendre(400);
    const panneau = await page.evaluate(() => ({
      opts: window.__panneaux[0], texte: document.getElementById('fp-invite').innerText,
    }));
    assert.strictEqual(panneau.opts.libelleEn, 'Level reached');
    assert.match(panneau.texte, /Game over!/);
    assert.match(panneau.texte, /Level reached/);
    assert.match(panneau.texte, /Want to save your scores\?/);
    await capturer(page, 'fin-invite');

    // Le courrier, le moulin : deux dernières lignes de l'interface.
    const fins = await page.evaluate(() => {
      document.querySelector('#fp-invite .fpi-non').click();
      __ajouterCourrier(MinipixizNuit.ENVIES_DE_PARTIR.length ? 'x' : '', 3);
      __ouvrirCourrier();
      const courrier = document.getElementById('courrier-texte').innerHTML;
      __ouvrirMoulin();
      return { courrier, souris: document.getElementById('mo-souris').textContent,
        touche: document.querySelector('#moulin [data-role="2"]').textContent };
    });
    assert.match(fins.courrier, /<b>Day 3<\/b>:/);
    assert.match(fins.souris, /^(yes|no)$/);
    await capturer(page, 'moulin');

    assert.deepStrictEqual(echecs, [], 'aucune requête en échec');
    assert.deepStrictEqual(erreurs, [], 'aucune erreur de page');
  } finally { await contexte.close(); }
});

test('MiniPixiz en français : rien n\'a bougé, et l\'anglais n\'est pas téléchargé', async (t) => {
  if (!prerequis(t)) return;
  const { contexte, page, requetes, echecs, erreurs } = await ouvrir('fr');
  try {
    assert.strictEqual(await page.evaluate(() => FPI18n.langue), 'fr');
    assert.ok(!requetes.some((u) => u.includes('/lang/')), 'aucun dictionnaire de jeu');
    const html = fs.readFileSync(path.join(RACINE, 'public/minipixiz/index.html'), 'utf8');
    const dom = await page.evaluate(() => ({
      sac: document.getElementById('menu-sac').textContent,
      aide: document.getElementById('aide').textContent,
      poser: document.querySelector('[data-cmd="bas"]').textContent,
      fee: document.querySelector('[data-cmd-aide]').getAttribute('aria-label'),
      moulin: document.querySelector('#moulin h2').textContent,
    }));
    assert.strictEqual(dom.sac, '🎒 sac');
    assert.ok(html.includes('>' + dom.aide + '</div>'), 'l\'aide, telle que la page l\'écrit');
    assert.strictEqual(dom.poser, 'POSER');
    assert.strictEqual(dom.fee, 'Appeler la fée');
    assert.strictEqual(dom.moulin, 'Le Moulin — Options');
    await attendre(300);
    assert.ok((await textes(page)).includes('glissez pour regarder autour · touchez un lieu pour y aller'));
    // La mission de l'écran est celle de `decrire`, au caractère près.
    const m = await page.evaluate(() => {
      __menu.arreter();
      document.getElementById('menu').classList.remove('on');
      __ouvrirGromelin();
      const gr = __client.gromelin;
      gr.dial = []; gr.bulle = null; gr.frame = 3; gr.etape = 2;
      return new Promise((r) => setTimeout(() => {
        const info = __plateforme.carte.$mission[gr.index];
        const d = MinipixizMissions.decrire(info);
        r({ ecran: { titre: gr.decrit.titre, enonce: gr.decrit.enonce, type: gr.decrit.type },
          decrire: { titre: d.titre, enonce: d.enonce, type: d.type } });
      }, 400));
    });
    assert.deepStrictEqual(m.ecran, m.decrire);
    const ecrits = await textes(page);
    assert.ok(ecrits.includes('accepter la mission!'));
    assert.ok(ecrits.includes('type: ' + m.decrire.type));
    const sac = await page.evaluate(() => {
      const f = __client.gromelin.surFermer; __client.gromelin = null; f();
      return [72, 31, 120].map((n) => MinipixizObjets.info(n).nom).concat(MinipixizSorts.nouveauSort(20, null).nom());
    });
    assert.deepStrictEqual(sac, ['Super potion', 'Clé du donjon', 'Parchemin : Balles de lumières', 'Balles de lumières']);
    await capturer(page, 'fr-mission');
    // Le panneau de l'invité, en français.
    await page.evaluate(() => {
      const l = { va: 'foret', nom: 'forest', titre: 'Foret enchantee' };
      __menu.surChoix(l, __menu.etatLieu(l));
    });
    await page.waitForFunction(() => __client.carteForet, null, { timeout: 10000 });
    await page.evaluate(() => __client.carteForet.surChoix(0));
    await page.waitForFunction(() => __client.jeu && __client.champ, null, { timeout: 15000 });
    await page.evaluate(() => __client.jeu.finPartie(false));
    await page.waitForFunction(() => document.getElementById('fp-invite'), null, { timeout: 30000 });
    await attendre(400);
    const texte = await page.evaluate(() => document.getElementById('fp-invite').innerText);
    assert.match(texte, /Partie terminée !/);
    assert.match(texte, /Niveau atteint/);
    assert.deepStrictEqual(echecs, [], 'aucune requête en échec');
    assert.deepStrictEqual(erreurs, [], 'aucune erreur de page');
  } finally { await contexte.close(); }
});
