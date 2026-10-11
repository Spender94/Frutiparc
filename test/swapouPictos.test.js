/*
 * Les pictos de Swapou 2 : qui donne quoi.
 *
 * Deux retours de joueurs :
 *   « Les pictos gagnés ne correspondent pas avec le boss qu'on vient
 *     d'affronter : battre Dimitri débloque le picto d'un autre perso. »
 *   « Le fruit 10 ne se débloque pas ? »
 *
 * Le jeu (TItem.as, repris tel quel dans game.js) ne connaît que des INDEX :
 * un picto gagné, c'est `$items[i] = true` dans le slot 0, et c'est le serveur
 * qui traduit l'index en clé (`SWAPOU2_TITEMS`) puis la clé en nom et en image
 * (`GAME_ITEMS`). Ce fichier fixe la table d'origine de bout en bout :
 *
 *   - Pot au feu (HistoMap.as + TItem.histoItems) : l'adversaire de chaque
 *     étape et l'objet qu'il laisse — Sel → $sel, le frère ou la sœur → rien,
 *     Poivre → $poivre, Moutarde → $epee, TomTom → $piment, Wasabii → $dent,
 *     Wasabii 2e forme → $sucre et un métal/glace/étoile au hasard ;
 *   - Duel sauvage (Duel.as : `difficulty == 4`, TItem.duelItem) : la photo de
 *     l'adversaire, à PHOTO_TITEMS + son id — $photo01 est celle de Dimitri
 *     (id 0), $photo03 celle de Sel (id 2) ;
 *   - Classique (Challenge.turnDone → TItem.classicItems) : à la fin de la
 *     partie, un fruit par niveau atteint — le fruit 10 veut le niveau 9, soit
 *     173 échanges joués (CLASSIC_LEVELS) puis le game over.
 *
 * Les trois tableaux (TItem.as, game.js, server.js) sont comparés mot à mot,
 * et les noms que le serveur affiche pour les photos sont confrontés à l'id de
 * l'adversaire qui les donne.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const SWAPOU = path.join(ROOT, 'public', 'swapou');
const SOURCE = path.join(ROOT, 'Games', 'swapou2', 'swapou2');

// ── un client Swapou complet, sans navigateur ───────────────────────────────
// Même montage que public/swapou/client.test.js : rien n'est dessiné, et sans
// `sid` le client est autonome (aucun réseau), le slot 0 part vierge.
function client() {
  const bac = {
    console: console, setTimeout: setTimeout, URLSearchParams: URLSearchParams,
    performance: { now: function () { return Date.now(); } },
    Date: Date, Math: Math, JSON: JSON,
  };
  bac.self = bac;
  bac.window = bac;
  vm.createContext(bac);
  for (const f of ['engine.js', 'assets.js', 'ui.js', 'data.js', 'game.js', 'screens.js'])
    vm.runInContext(fs.readFileSync(path.join(SWAPOU, f), 'utf8'), bac, { filename: f });
  bac.SW.A.play = function () {};
  bac.SW.A.playMusic = function () {};
  bac.SW.Manager.init('');
  return { SW: bac.SW, E: bac.SwapouEngine };
}

// Les clés données par un appel, dans l'ordre : on remplace le pont serveur
// (un no-op dans le portage) par un mouchard.
function mouchard(SW) {
  const donnes = [];
  SW.Manager.client.giveItem = function (nom) { donnes.push(nom); };
  return donnes;
}

// ── la table d'origine ──────────────────────────────────────────────────────
// Les persos, dans l'ordre de Data.CHAR_NAMES (= l'id de `Data.players[]`).
const PERSOS = ['Dimitri', 'Natacha', 'Sel', 'Poivre', 'Moutarde', 'TomTom', 'Wasabi'];

// Pot au feu : étape → [id de l'adversaire, clé donnée] — HistoMap.as
// (`opponent`) et TItem.histoItems (HISTO_TITEMS + histoPhase). L'étape 1 est
// le frère ou la sœur du héros : TITEMS[1] est vide, elle ne donne rien.
function tableAventure(heros) {
  return [
    { etape: 0, adversaire: 2, picto: '$sel' },
    { etape: 1, adversaire: 1 - heros, picto: null },
    { etape: 2, adversaire: 3, picto: '$poivre' },
    { etape: 3, adversaire: 4, picto: '$epee' },
    { etape: 4, adversaire: 5, picto: '$piment' },
    { etape: 5, adversaire: 6, picto: '$dent' },
    { etape: 6, adversaire: 6, picto: '$sucre' },
  ];
}

// Duel sauvage : id de l'adversaire → photo (PHOTO_TITEMS + id).
const TABLE_DUEL = ['$photo01', '$photo02', '$photo03', '$photo04', '$photo05', '$photo06', '$photo07'];

// TITEMS tel que TItem.as l'écrit.
function titemsOrigine() {
  const src = fs.readFileSync(path.join(SOURCE, 'TItem.as'), 'latin1');
  const m = /static var TITEMS = \[([\s\S]*?)\];/.exec(src);
  assert.ok(m, 'TItem.as : TITEMS trouvé');
  return m[1].match(/"[^"]*"/g).map(function (s) { return s.slice(1, -1); });
}

// SWAPOU2_TITEMS et les noms des photos, lus dans server.js (sans l'exécuter).
function serveur() {
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const m = /const SWAPOU2_TITEMS = \[([\s\S]*?)\];/.exec(src);
  assert.ok(m, 'server.js : SWAPOU2_TITEMS trouvé');
  const titems = m[1].match(/'[^']*'/g).map(function (s) { return s.slice(1, -1); });
  const photos = {};
  const re = /'(\$photo0\d)':\s*\{\s*name:\s*'([^']+)'[^}]*gif:\s*'([^']+)'/g;
  let p;
  while ((p = re.exec(src)) != null) photos[p[1]] = { nom: p[2], gif: p[3] };
  return { titems: titems, photos: photos };
}

// ── les trois tableaux sont le même ─────────────────────────────────────────
test('TITEMS : le portage et le serveur reprennent TItem.as case pour case', function () {
  const origine = titemsOrigine();
  assert.strictEqual(origine.length, 46);
  assert.strictEqual(origine[1], '', 'la case 1 (étape du frère/de la sœur) est vide');
  const { SW } = client();
  // (copies hôtes : les tableaux du bac à sable ont un autre prototype Array)
  assert.deepStrictEqual(Array.from(SW.TItem.TITEMS), origine, 'game.js');
  assert.deepStrictEqual(serveur().titems, origine, 'server.js');
  assert.deepStrictEqual(
    [SW.TItem.HISTO_TITEMS, SW.TItem.HISTO_END_TITEMS, SW.TItem.FRUIT_TITEMS, SW.TItem.COMBO_TITEMS, SW.TItem.PHOTO_TITEMS],
    [0, 7, 16, 27, 38]);
});

// ── Pot au feu : chaque boss laisse son objet ───────────────────────────────
for (const heros of [0, 1]) {
  test('Pot au feu en ' + PERSOS[heros] + ' : l\'objet de chaque étape est celui du boss battu', function () {
    const { SW, E } = client();
    const donnes = mouchard(SW);
    for (const ligne of tableAventure(heros)) {
      SW.Data.gameMode = SW.Data.HISTORY;
      SW.Data.histoPhase = ligne.etape;
      SW.Data.players = [heros, -1];
      SW.Manager.mode.destroy();
      SW.Manager.mode = new SW.HistoMap();   // c'est la carte qui désigne l'adversaire
      assert.strictEqual(SW.Data.players[1], ligne.adversaire,
        'étape ' + ligne.etape + ' : adversaire ' + E.CHAR_NAMES[ligne.adversaire]);
      donnes.length = 0;
      const n = SW.TItem.histoItems();     // ce que Duel.turnDone donne à la victoire
      if (ligne.picto == null) {
        assert.strictEqual(n, 0, 'étape 1 : rien');
        assert.deepStrictEqual(donnes, []);
        continue;
      }
      assert.strictEqual(donnes[0], ligne.picto, 'étape ' + ligne.etape);
      if (ligne.etape < 6) {
        assert.strictEqual(n, 1);
      } else {
        // La fin : le sucre, et un seul des neuf métal/glace/étoile (7..15).
        assert.strictEqual(n, 2);
        const i = SW.TItem.TITEMS.indexOf(donnes[1]);
        assert.ok(i >= 7 && i <= 15, 'second objet de fin dans 7..15, reçu ' + donnes[1]);
      }
      // Posé dans le slot à l'index de la clé — c'est cela que le serveur relit.
      const items = SW.Manager.client.slots[0].$items;
      assert.strictEqual(items[SW.TItem.TITEMS.indexOf(ligne.picto)], true);
    }
    // Les photos ne se gagnent pas au Pot au feu.
    assert.ok(!donnes.some(function (k) { return /^\$photo/.test(k); }));
  });
}

// ── Duel sauvage : la photo de l'adversaire ─────────────────────────────────
test('Duel sauvage : battre un perso donne SA photo, PHOTO_TITEMS + son id', function () {
  const { SW } = client();
  const donnes = mouchard(SW);
  for (let id = 0; id < 7; id++) {
    SW.Data.gameMode = SW.Data.DUEL;
    SW.Data.difficulty = 4;
    SW.Data.players = [(id + 1) % 7, id];
    donnes.length = 0;
    assert.strictEqual(SW.TItem.duelItem(), 1, PERSOS[id]);
    assert.deepStrictEqual(donnes, [TABLE_DUEL[id]], 'battre ' + PERSOS[id]);
    assert.strictEqual(SW.Manager.client.slots[0].$items[SW.TItem.PHOTO_TITEMS + id], true);
  }
  // Une photo ne se gagne qu'une fois.
  SW.Data.players = [1, 0];
  assert.strictEqual(SW.TItem.duelItem(), 0, 'Dimitri déjà pris');
  // Et $photo08 n'a pas d'adversaire : il n'y a que sept persos.
  assert.strictEqual(SW.TItem.TITEMS[SW.TItem.PHOTO_TITEMS + 7], '$photo08');
});

test('Duel : la photo ne tombe qu\'en « sauvage » (difficulté 4), jamais au Pot au feu', function () {
  const src = fs.readFileSync(path.join(SWAPOU, 'game.js'), 'utf8');
  // La condition de Duel.as, reprise mot à mot dans Duel.turnDone du portage.
  assert.match(src, /gameMode === SW\.Data\.HISTORY\)\s*\n\s*g\.winTitem\(TItem\.histoItems\(\)\);\s*\n\s*else if \(SW\.Data\.gameMode === SW\.Data\.DUEL && SW\.Data\.difficulty === 4\)\s*\n\s*g\.winTitem\(TItem\.duelItem\(\)\);/);
  const as = fs.readFileSync(path.join(SOURCE, 'Duel.as'), 'latin1');
  assert.match(as, /Data\.gameMode == Data\.DUEL && Data\.difficulty == 4/);
});

// ── le nom que le serveur affiche pour chaque photo ─────────────────────────
// Le jeu écrit la case PHOTO_TITEMS + id de l'adversaire ; le serveur doit donc
// nommer $photo01 « Dimitri », $photo02 « Natacha », $photo03 « Sel »…
// Tant que server.js garde son ordre (Sel, Moutarde, Dimitri, Natacha, Poivre),
// battre Dimitri affiche « Photo Sel » : c'est le retour des joueurs. Ce test
// est marqué « à faire » jusqu'au correctif de server.js (hors de ce portage).
test('server.js : le nom de chaque $photoNN est celui du perso qui la donne', function () {
  const photos = serveur().photos;
  for (let id = 0; id < 7; id++) {
    const cle = TABLE_DUEL[id];
    assert.ok(photos[cle], cle + ' défini côté serveur');
    assert.match(photos[cle].nom, new RegExp(PERSOS[id], 'i'),
      cle + ' est donnée en battant ' + PERSOS[id] + ', le serveur l\'appelle « ' + photos[cle].nom + ' »');
    assert.match(photos[cle].gif, new RegExp('photo_' + PERSOS[id].toLowerCase(), 'i'));
  }
});

// ── Classique : les fruits, et le fruit 10 ──────────────────────────────────
test('Classique : $fruit10 est la case FRUIT_TITEMS + 9, donnée au niveau 9 et pas avant', function () {
  const { SW } = client();
  assert.strictEqual(SW.TItem.TITEMS[SW.TItem.FRUIT_TITEMS + 9], '$fruit10');
  const donnes = mouchard(SW);
  // Niveau 8 : neuf fruits, pas le dixième.
  assert.strictEqual(SW.TItem.classicItems(8), 9);
  assert.ok(!donnes.includes('$fruit10'));
  assert.ok(donnes.includes('$fruit09'));
  // Niveau 9 : le dixième, et ceux d'avant déjà acquis ne se redonnent pas.
  donnes.length = 0;
  assert.strictEqual(SW.TItem.classicItems(9), 1);
  assert.deepStrictEqual(donnes, ['$fruit10']);
  assert.strictEqual(SW.Manager.client.slots[0].$items[25], true);
  // Partie vierge au niveau 9 : les dix d'un coup, du dixième au premier.
  SW.Manager.client.slots[0].$items = [];
  donnes.length = 0;
  assert.strictEqual(SW.TItem.classicItems(9), 10);
  assert.deepStrictEqual(donnes, ['$fruit10', '$fruit09', '$fruit08', '$fruit07', '$fruit06',
    '$fruit05', '$fruit04', '$fruit03', '$fruit02', '$fruit01']);
});

test('Classique : le niveau 9 s\'atteint au 173e échange (CLASSIC_LEVELS), comme dans Classic.as', function () {
  const { SW, E } = client();
  assert.deepStrictEqual(Array.from(E.CLASSIC_LEVELS.slice(0, 12)), [0, 10, 15, 15, 20, 20, 25, 25, 35, 45, 50, 100]);
  // Classic.as : ncoups part à 1, le niveau monte dès que ncoups > CLASSIC_LEVELS[level]
  // et ncoups repart de 0 — le niveau 1 tombe donc avant le premier coup, puis
  // chaque niveau coûte CLASSIC_LEVELS[level] + 1 échanges.
  let attendu = 0;
  for (let l = 1; l <= 8; l++) attendu += E.CLASSIC_LEVELS[l] + 1;
  assert.strictEqual(attendu, 173);

  SW.Data.gameMode = SW.Data.CLASSIC;
  SW.Data.players = [0, -1];
  SW.Manager.mode.destroy();
  SW.Manager.mode = new SW.Classic();
  const classique = SW.Manager.mode;
  SW.Manager.main(1, 1 / 40);
  assert.strictEqual(classique.level, 1, 'le niveau 1 avant le premier coup');
  let echanges = 0;
  while (classique.level < 9 && echanges < 1000) {
    classique.ncoups++;            // ce que jouerPaire fait à chaque échange
    echanges++;
    SW.Manager.main(1, 1 / 40);    // l'image suivante regarde le palier
  }
  assert.strictEqual(echanges, 173, 'échanges pour atteindre le niveau 9');
  assert.strictEqual(classique.level, 9);
});

test('Classique : les fruits tombent au GAME OVER de la partie, avec le niveau atteint', function () {
  const { SW } = client();
  const donnes = mouchard(SW);
  SW.Data.gameMode = SW.Data.CLASSIC;
  SW.Data.players = [0, -1];
  SW.Manager.mode.destroy();
  SW.Manager.mode = new SW.Classic();
  const classique = SW.Manager.mode;
  classique.level = 9;
  // La ligne ne peut plus monter : c'est la fin (Challenge.turnDone).
  classique.player.genLine = function () { return false; };
  classique.special_power = false;
  classique.turnDone();
  assert.notStrictEqual(SW.Manager.mode, classique, 'écran de fin');
  assert.strictEqual(SW.Manager.mode.titemText, 'Vous avez gagné 10 nouveaux titems Frutiparc !');
  assert.ok(donnes.includes('$fruit10'), 'le fruit 10 est parti');
  const items = SW.Manager.client.slots[0].$items;
  for (let i = 16; i <= 25; i++) assert.strictEqual(items[i], true, 'case ' + i);
  assert.ok(!items[26], 'pas de $fruit11 au niveau 9');
});
