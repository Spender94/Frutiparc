/*
 * Le neuvième lot de retours MiniPixiz : les sorts.
 *
 *   · « Pixiz (Ornegon) : si un sort a été appris une deuxième fois, il
 *     apparaît également deux fois sur la page d'Ornegon. » — setNextLevelUp
 *     tire au plus cent fois un sort inconnu, puis garde le dernier : une
 *     jeune fée qui sait déjà tout ce qui est à sa portée se voit offrir un
 *     doublon, que levelUp pousse dans `$spell`. La fiche le garde ; Ornegon
 *     n'en montre plus qu'un (Fee.sortsConnus).
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
