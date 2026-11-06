/*
 * Le neuvième lot de retours MiniPixiz : les sorts et l'expérience.
 *
 *   · « Pixiz (Ornegon) : si un sort a été appris une deuxième fois, il
 *     apparaît également deux fois sur la page d'Ornegon. » — setNextLevelUp
 *     tire au plus cent fois un sort inconnu, puis garde le dernier : une
 *     jeune fée qui sait déjà tout ce qui est à sa portée se voit offrir un
 *     doublon, que levelUp pousse dans `$spell`. La fiche le garde ; Ornegon
 *     n'en montre plus qu'un (Fee.sortsConnus).
 *   · « Sur la fiche des stats de la fée, il est impossible de savoir si le
 *     sort affiché a été appris au lvl up ou grâce à un grimoire. » — l'origine
 *     se lit déjà dans la fiche (`$spell` ne reçoit que la naissance et les
 *     montées ; grimoires et parchemins se rejouent à chaque chargement) : la
 *     bille est dorée pour un grimoire, rose pour un parchemin, la phrase le
 *     dit au toucher, et une légende l'explique dans le tableau de bois. Et
 *     comme chez Ornegon, une bille par sort, même appris deux fois.
 *   · « Ajouter le % d'xp de la fée en forêt sous le portrait » — sous les
 *     cœurs de la colonne de la fée, « XP 42 % » et une jauge fine.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const lire = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const F = require(path.join(ROOT, 'public/minipixiz/faerie.js'));
const E = require(path.join(ROOT, 'public/minipixiz/engine.js'));
const CB = require(path.join(ROOT, 'public/minipixiz/combat.js'));
globalThis.MinipixizFee = F;
globalThis.MinipixizSorts = require(path.join(ROOT, 'public/minipixiz/sorts.js'));
const I = require(path.join(ROOT, 'public/minipixiz/inventaire.js'));

function tirage(g) {
  let s = g;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

// Une fée de niveau 5 qui a appris le Météore (5) deux fois et l'Ascension
// (3), qui porte le parchemin de la Valse fossile (7), et dont le joueur garde
// les grimoires de l'Ascension (3, déjà apprise) et du Tranche-cimes (9).
function feeDuJoueur() {
  const fs = F.genererGraine(tirage(5));
  fs.$level = 4; fs.$exp = 700;
  fs.$spell = [20, 0, 5, 3, 5];
  fs.$inv = [107, null];
  const carte = { $inv: [203, 209, null], $faerie: [fs], $current: 0 };
  return { fs, carte, fee: new F.Fee(fs, null, carte) };
}

// Le client est un script de navigateur : on le charge dans une fonction dont
// les paramètres masquent les globales (comme minipixizOrnegon.test.js).
function chargerClient() {
  const src = lire('public/minipixiz/game.js');
  const fenetre = {
    MinipixizLangue: require(path.join(ROOT, 'public/minipixiz/langue.js')),
    MinipixizEngine: E, MinipixizCombat: CB, MinipixizSorts: globalThis.MinipixizSorts,
  };
  new Function('window', 'document', 'navigator', 'Image', src)(
    fenetre,
    { createElement: () => ({ getContext: () => ({}), width: 0, height: 0 }) },
    { userAgent: '' }, function () {});
  return fenetre.MinipixizClient;
}

// Un contexte de dessin qui retient ce qu'on y écrit.
function ctxEspion() {
  const textes = [], rects = [];
  return {
    textes, rects,
    save() {}, restore() {}, beginPath() {}, arc() {}, fill() {}, stroke() {}, strokeRect() {},
    measureText: (t) => ({ width: String(t).length * 5 }),
    fillText(t, x, y) { textes.push({ t, x, y }); },
    fillRect(x, y, l, h) { rects.push({ x, y, l, h, c: this.fillStyle }); },
  };
}

// ── 1. Ornegon : un sort, une barre ─────────────────────────────────────────

test('un sort appris deux fois reste deux fois dans la fiche, une seule dans sortsConnus', () => {
  const { fs, fee } = feeDuJoueur();
  assert.deepStrictEqual(fs.$spell, [20, 0, 5, 3, 5], 'la fiche n\'est pas touchée');
  assert.deepStrictEqual(fee.sorts, [20, 0, 5, 3, 5, 7, 9],
    'la liste de combat non plus (FaerieInfo.initSpellList garde son poids)');
  const connus = fee.sortsConnus();
  assert.deepStrictEqual(connus.map((k) => k.sid), [20, 0, 5, 3, 7, 9], 'un sort, une entrée');
  const meteore = connus.find((k) => k.sid === 5);
  assert.strictEqual(meteore.fois, 2, 'mais on sait qu\'il a été appris deux fois');
});

test('le doublon vient bien du tirage : levelUp apprend un sort déjà su', () => {
  const fs = F.genererGraine(tirage(9));
  fs.$spell = [20, 0, 5];
  fs.$exp = 10000;
  const fee = new F.Fee(fs, tirage(2), null);
  // setNextLevelUp : cent essais, tous sur le Météore — c'est le dernier tiré
  // qui reste réservé.
  fee.preparerProchainNiveau(() => 5);
  assert.strictEqual(fs.$next[1], 5);
  fee.monterNiveau(1, () => 5);
  assert.deepStrictEqual(fs.$spell, [20, 0, 5, 5], 'Cm.levelUp le pousse sans regarder');
  assert.deepStrictEqual(fee.sortsConnus().map((k) => k.sid), [20, 0, 5]);
});

test('chez Ornegon, une barre par sort — plus de barre en double', () => {
  const K = chargerClient();
  const c = Object.create(K.Client.prototype);
  c.sprites = {};
  c.pointeur = null;
  const { fee } = feeDuJoueur();
  c.ouvrirOrnegon({ fee, surFermer() {} });
  // Le tir de lumière (20) n'a pas de barre, comme avant (sid < 20).
  assert.deepStrictEqual(c.ornegon.sorts, [0, 5, 3, 7, 9]);
  c.dessinerOrnegon(ctxEspion());
  assert.strictEqual(c.ornegon.zones.length, 5, 'cinq barres');
  assert.deepStrictEqual(c.ornegon.zones.map((z) => z.sid), [0, 5, 3, 7, 9]);
  // Une fée sans sortsConnus (un appelant qui fabrique la sienne) est
  // dédoublonnée tout de même.
  c.ouvrirOrnegon({ fee: { fs: { $name: 'Lili', $spellCoef: [] }, sorts: [1, 2, 1, 20, 2] } });
  assert.deepStrictEqual(c.ornegon.sorts, [1, 2]);
});

// ── 2. La fiche : d'où vient le sort ────────────────────────────────────────

test('l\'origine se lit dans la fiche : naissance, montée, parchemin, grimoire', () => {
  const { fee } = feeDuJoueur();
  const par = Object.fromEntries(fee.sortsConnus().map((k) => [k.sid, k]));
  assert.strictEqual(par[20].origine, 'naissance');
  assert.strictEqual(par[0].origine, 'naissance');
  assert.strictEqual(par[5].origine, 'niveau');
  assert.deepStrictEqual(par[3].sources, ['niveau', 'grimoire'],
    'appris ET donné par un grimoire : appris d\'abord — il reste sans le livre');
  assert.strictEqual(par[3].origine, 'niveau');
  assert.strictEqual(par[7].origine, 'parchemin');
  assert.strictEqual(par[9].origine, 'grimoire');
  assert.deepStrictEqual(F.SORTS_DE_NAISSANCE, [20, 0]);
});

test('une vieille fiche, sans rien de neuf, se lit comme avant', () => {
  // Rien n'est écrit dans la fiche pour l'origine : une fée d'avant n'a ni
  // champ manquant ni affichage changé — ses sorts appris restent blancs.
  const fs = { $name: 'Ancienne', $carac: [2, 2, 2, 2, 2, 2], $spell: [20, 0, 12], $inv: [] };
  const avant = JSON.stringify(fs);
  const fee = new F.Fee(fs, null, null);
  fee.sortsConnus();
  assert.strictEqual(JSON.stringify(fs), avant, 'la lecture n\'écrit rien dans la fiche');
  assert.deepStrictEqual(fee.sortsConnus().map((k) => k.origine), ['naissance', 'naissance', 'niveau']);
  // Et une fée sans $spell du tout ne casse rien.
  assert.deepStrictEqual(new F.Fee({ $carac: [], $inv: [] }, null, null).sortsConnus(), []);
});

// Un sac sans canevas : rendreVolet dessine dans un faux client qui retient
// la teinte de chaque bille.
function voletMagie(fee) {
  const poses = [];
  globalThis.MinipixizClient = {
    rendre: (sp, frame, taille, couleur) => ({ cle: sp.cle, frame, couleur }),
    poserRendu: (ctx, r, x, y) => poses.push(Object.assign({ x, y }, r)),
  };
  const inv = Object.create(I.Inventaire.prototype);
  inv.sprites = { sortBille: { cle: 'sortBille' }, sortSymbole: { cle: 'sortSymbole', etats: [] } };
  inv.ctx = ctxEspion();
  inv.zones = [];
  inv.volet = 1;
  inv.rendreVolet(fee);
  delete globalThis.MinipixizClient;
  return { inv, billes: poses.filter((p) => p.cle === 'sortBille') };
}

test('la bille d\'un sort de grimoire est dorée, celle d\'un parchemin rose ; un sort appris garde la sienne', () => {
  const { fee } = feeDuJoueur();
  const { inv, billes } = voletMagie(fee);
  const pleines = billes.filter((b) => b.frame === 1);
  assert.strictEqual(pleines.length, 6, 'six sorts, six billes — le Météore n\'est plus en double');
  assert.deepStrictEqual(pleines.map((b) => b.couleur),
    [undefined, undefined, undefined, undefined, I.TEINTE_SORT.parchemin, I.TEINTE_SORT.grimoire]);
  assert.strictEqual(billes.filter((b) => b.frame === 2).length, 20 - 6, 'les autres restent vides');
  const zones = inv.zones.filter((z) => z.quoi.sort !== undefined);
  assert.deepStrictEqual(zones.map((z) => z.quoi.sort), [20, 0, 5, 3, 7, 9]);
  assert.deepStrictEqual(zones[3].quoi.sources, ['niveau', 'grimoire']);
});

test('toucher un sort dit d\'où il vient', () => {
  const inv = Object.create(I.Inventaire.prototype);
  inv.rendre = () => {};
  inv.agir({ sort: 3, sources: ['niveau', 'grimoire'] });
  assert.match(inv.message, /\(appris en montant de niveau \+ grimoire du sac\)$/);
  assert.match(inv.titre, / :$/);
  inv.agir({ sort: 9, sources: ['grimoire'] });
  assert.match(inv.message, /\(grimoire du sac\)$/);
  inv.agir({ sort: 7, sources: ['parchemin'] });
  assert.match(inv.message, /\(parchemin porté\)$/);
  inv.agir({ sort: 0, sources: ['naissance'] });
  assert.match(inv.message, /\(connu de naissance\)$/);
  // Une zone sans sources (un appelant d'avant) dit l'effet seul.
  inv.agir({ sort: 9 });
  assert.doesNotMatch(inv.message, /\(/);
  // Le plus long des cas — trois sources sur la plus longue description —
  // passe en 8 px, pour tenir dans les trois lignes du tableau de bois.
  inv.agir({ sort: 27, sources: ['niveau', 'parchemin', 'grimoire'] });
  assert.strictEqual(inv.messageTaille, 8);
});

test('la légende ne parle que des teintes présentes', () => {
  const inv = Object.create(I.Inventaire.prototype);
  inv.ctx = ctxEspion();
  const { fee } = feeDuJoueur();
  assert.strictEqual(inv.legendeSorts(fee, 220), true);
  assert.deepStrictEqual(inv.ctx.textes.map((t) => t.t), ['grimoire du sac', 'parchemin porté']);
  // Une fée qui n'a que des sorts appris : rien à expliquer.
  inv.ctx = ctxEspion();
  const seule = new F.Fee({ $carac: [], $inv: [], $spell: [20, 0, 4] }, null, null);
  assert.strictEqual(inv.legendeSorts(seule, 220), false);
  assert.strictEqual(inv.ctx.textes.length, 0);
  // Et elle s'affiche sous le mot par défaut du volet des sortilèges, pas
  // par-dessus un message.
  const src = lire('public/minipixiz/inventaire.js');
  assert.match(src, /if \(fee && this\.volet === 1 && !this\.message && [^\n]*\) \{\s*this\.legendeSorts\(fee,/);
});

// ── 3. L'expérience en forêt ────────────────────────────────────────────────

test('pourcentExp : le chemin vers le niveau suivant, en pour cent entiers', () => {
  const fee = new F.Fee({ $carac: [], $inv: [], $spell: [], $level: 4, $exp: 700 }, null, null);
  assert.strictEqual(fee.limiteExp(), 1250);
  assert.strictEqual(fee.pourcentExp(), 56);
  fee.fs.$exp = 0; assert.strictEqual(fee.pourcentExp(), 0);
  fee.fs.$exp = 1249.5; assert.strictEqual(fee.pourcentExp(), 99, 'pas d\'arrondi qui annonce 100 trop tôt');
  fee.fs.$exp = 1250; assert.strictEqual(fee.pourcentExp(), 100, 'de quoi monter');
  fee.fs.$exp = 4000; assert.strictEqual(fee.pourcentExp(), 100, 'borné');
  fee.fs.$level = F.NIVEAU_MAX; assert.strictEqual(fee.pourcentExp(), null, 'au plafond, plus de chemin');
});

test('la colonne de la fée écrit « XP 56 % » sous les cœurs, avec sa jauge', () => {
  const K = chargerClient();
  const c = Object.create(K.Client.prototype);
  const { fee } = feeDuJoueur();
  const ctx = ctxEspion();
  const boite = { vie: { x: 136, y: 86, l: 100, h: 18 } };
  c.dessinerExperience(ctx, fee, boite, { decalBas: 0 });
  assert.strictEqual(ctx.textes.length, 1);
  assert.strictEqual(ctx.textes[0].t, 'XP 56 %');
  assert.strictEqual(ctx.textes[0].x, 186, 'centré dans la colonne');
  assert.ok(ctx.textes[0].y > 86 + 12, 'sous la rangée de cœurs');
  const [fond, plein] = ctx.rects;
  assert.ok(Math.abs(plein.l - fond.l * 0.56) < 1e-9, 'la jauge remplie à 56 %');
  // Deux rangées de cœurs : le texte descend d'autant.
  const ctx2 = ctxEspion();
  c.dessinerExperience(ctx2, fee, boite, { decalBas: 14 });
  assert.strictEqual(ctx2.textes[0].y, ctx.textes[0].y + 14);
  // Au plafond : « niveau max », sans jauge.
  fee.fs.$level = F.NIVEAU_MAX;
  const ctx3 = ctxEspion();
  c.dessinerExperience(ctx3, fee, boite, { decalBas: 0 });
  assert.strictEqual(ctx3.textes[0].t, 'niveau max');
  assert.strictEqual(ctx3.rects.length, 0);
});

test('en forêt seulement : le donjon et l\'arc-en-ciel n\'ont pas la ligne', () => {
  const src = lire('public/minipixiz/game.js');
  assert.match(src, /if \(fee && !this\.lieu\) this\.dessinerExperience\(ctx, fee, boite, lignes\);/);
  // Elle vient APRÈS les cœurs, dans dessinerInterface.
  const corps = src.slice(src.indexOf('  dessinerInterface(ctx, tmod) {'), src.indexOf('  dessinerExperience(ctx, fee, boite, lignes) {'));
  assert.ok(corps.indexOf('LA VIE (inter.Life)') < corps.indexOf('this.dessinerExperience('));
});

// ── 4. Dans un vrai navigateur ──────────────────────────────────────────────
//
// Le jeu complet, sans compte (pas de ?sid : la fiche reste locale) : la fée
// du joueur entre en forêt, chez Ornegon, puis dans le sac. On espionne
// fillText pour lire ce que la colonne écrit, et on lit les pixels des billes.

function chromium() {
  for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(p).chromium; } catch { /* suivant */ }
  }
  return null;
}

test('dans Chromium : la forêt dit l\'XP, Ornegon une barre par sort, le sac teinte ses billes', async (t) => {
  const pw = chromium();
  if (!pw) { t.skip('Playwright absent'); return; }
  const { spawn } = require('node:child_process');
  const PORT = 5611;
  const proc = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: '', ADMIN_KEY: 'cle-test',
      XMLSOCKET_PORT: '5612', FRUTISCORE_PORT: '5613',
    }),
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  let navigateur = null;
  try {
    let pret = false;
    for (let i = 0; i < 100 && !pret; i++) {
      try { pret = (await fetch(`http://localhost:${PORT}/minipixiz/index.html`)).ok; } catch { /* pas encore */ }
      if (!pret) await new Promise((r) => setTimeout(r, 100));
    }
    if (!pret) { t.skip('le serveur ne répond pas'); return; }
    try { navigateur = await pw.launch(); } catch (e) { t.skip('Chromium absent : ' + e.message); return; }
    const p = await navigateur.newPage({ viewport: { width: 760, height: 760 }, deviceScaleFactor: 1 });
    const erreurs = [];
    p.on('pageerror', (e) => erreurs.push(e.message));
    await p.addInitScript(() => {
      window.__textes = [];
      const f = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (txt, x, y) {
        window.__textes.push(String(txt));
        return f.apply(this, arguments);
      };
    });
    await p.goto(`http://localhost:${PORT}/minipixiz/index.html`);
    await p.waitForFunction(() => window.__plateforme && window.__client && window.__entrerEnForet);
    await p.evaluate(() => {
      const c = window.__plateforme.carte;
      const fs = window.MinipixizFee.genererGraine();
      fs.$carac = [3, 3, 3, 3, 3, 4]; fs.$life = 3; fs.$mana = 8; fs.$hunger = 20; fs.$moral = 20;
      fs.$level = 4; fs.$exp = 700;
      fs.$spell = [20, 0, 5, 3, 5];
      fs.$inv = [107, null];
      c.$faerie.push(fs); c.$current = c.$faerie.length - 1;
      c.$bag = 2;
      c.$inv[0] = 203; c.$inv[1] = 209;
    });

    // La forêt : « XP 56 % » finit par s'écrire (la gerbe d'ouverture passée).
    await p.evaluate(() => window.__entrerEnForet());
    await p.waitForFunction(() => window.__textes.indexOf('XP 56 %') >= 0, null, { timeout: 15000 });

    // Ornegon : cinq barres, pas six.
    const barres = await p.evaluate(() => {
      window.__client.jeu = null;
      const fi = new window.MinipixizFee.Fee(window.__feeCouranteSeed(), null, window.__plateforme.carte);
      const or = window.__client.ouvrirOrnegon({ fee: fi, surFermer() {} });
      return or.sorts;
    });
    assert.deepStrictEqual(barres, [0, 5, 3, 7, 9]);

    // Le sac, volet des sortilèges : six billes, la légende, et des teintes.
    const sac = await p.evaluate(() => {
      window.__client.ornegon = null;
      window.__ouvrirSac();
      const inv = window.__inventaire;
      inv.volet = 1;
      window.__textes = [];
      inv.rendre();
      const zones = inv.zones.filter((z) => z.quoi && z.quoi.sort !== undefined);
      // Le pixel du bord gauche de chaque bille (le symbole occupe le centre).
      const g = inv.canvas.getContext('2d');
      const k = inv.nettete;
      const pixels = zones.map((z) => {
        const d = g.getImageData(Math.round((z.x + 3) * k), Math.round((z.y + 9) * k), 1, 1).data;
        return [d[0], d[1], d[2]];
      });
      return { sorts: zones.map((z) => z.quoi.sort), pixels, textes: window.__textes.slice() };
    });
    assert.deepStrictEqual(sac.sorts, [20, 0, 5, 3, 7, 9]);
    assert.ok(sac.textes.includes('grimoire du sac') && sac.textes.includes('parchemin porté'), 'la légende');
    const [, , , appris, parchemin, grimoire] = sac.pixels;
    // Doré : plus de rouge que de bleu ; rose : le bleu ne domine plus ; un
    // sort appris garde sa bille bleutée.
    assert.ok(appris[2] >= appris[0], 'bille apprise bleutée : ' + appris);
    assert.ok(grimoire[0] > grimoire[2] + 40, 'bille du grimoire dorée : ' + grimoire);
    assert.ok(parchemin[0] > parchemin[2], 'bille du parchemin rose : ' + parchemin);
    assert.deepStrictEqual(erreurs, []);
  } finally {
    if (navigateur) await navigateur.close();
    proc.kill();
  }
});
