/*
 * Le neuvième lot de retours MiniPixiz : les sorts.
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
