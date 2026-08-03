// Les objets de Minipixiz, et ce qu'ils font.
//
// La forêt en faisait déjà tomber ; jusqu'ici ils dormaient dans la fiche. Tout
// le système tient en trois façons d'agir — agir tout de suite (la clé, le
// sac), agir tant qu'on le PORTE (le gant, le parchemin), se consommer (la
// potion, le pain) — plus une quatrième, discrète : un objet resté dans le sac
// DU JOUEUR profite à TOUTES les fées. C'est ce qui distingue le globe du gant
// et le grimoire du parchemin, et c'est ce que ces tests fixent.

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const O = require(path.join(ROOT, 'public/minipixiz/items.js'));
const F = require(path.join(ROOT, 'public/minipixiz/faerie.js'));
const E = require(path.join(ROOT, 'public/minipixiz/engine.js'));

const alea = (g) => E.generateur(g);
const neuve = (g, sur) => Object.assign(F.genererGraine(alea(g || 1)), sur || {});

// ── Reconnaître un objet (Item.newIt) ─────────────────────────────────────

test('chaque plage d\'identifiant désigne bien sa famille', () => {
  const f = (n) => { const i = O.info(n); return i && i.famille; };
  assert.equal(f(0), 'carac', 'gant de cuir');
  assert.equal(f(29), 'carac');
  assert.equal(f(30), 'bocal');
  assert.equal(f(31), 'cle');
  assert.equal(f(45), 'pouvoir');
  assert.equal(f(52), 'globe');
  assert.equal(f(63), 'coloration');
  assert.equal(f(71), 'potion');
  assert.equal(f(81), 'sac');
  assert.equal(f(113), 'parchemin');
  assert.equal(f(213), 'grimoire');
  assert.equal(f(342), 'aliment');
  assert.equal(O.info(null), null, 'une case vide n\'est pas un objet');
  assert.equal(O.info(999), null, 'ni un identifiant qui ne veut rien dire');
});

test('un objet de caractéristique dit laquelle, et de combien', () => {
  // it.Carac : car = floor(type/5), inc = (type%5)+1.
  const gant = O.info(0);
  assert.equal(gant.car, O.CARAC.FORCE);
  assert.equal(gant.inc, 1);
  assert.equal(gant.nom, 'Gant de cuir');

  const brassard = O.info(2);
  assert.equal(brassard.inc, 3, 'le troisième d\'une série vaut trois points');
  assert.equal(brassard.nom, 'Brassard du dragon');

  const amethyste = O.info(25);
  assert.equal(amethyste.car, O.CARAC.MANA);
  assert.equal(amethyste.inc, 1);
});

test('un aliment connaît son nom et la taille de sa part', () => {
  // it.Food : id = floor((type-300)/3), et trois tailles par aliment.
  assert.equal(O.info(300).nom, 'Pain');
  assert.equal(O.info(300).taille, 0, 'la grande part');
  assert.equal(O.info(302).taille, 2, 'la petite');
  assert.equal(O.info(303).nom, 'Raisin', 'l\'aliment suivant');
  assert.equal(O.info(354).nom, 'Yakitori', 'le dernier de la table');
  assert.equal(O.info(357), null, 'et rien au-delà');
  assert.equal(O.ALIMENTS.length, 19, 'it.Food.NAME en compte dix-neuf');
});

test('la table des aliments est celle du jeu, dans son ordre', () => {
  // Le serveur en dépend pour ses pictos : un décalage d'un rang et « je mange
  // un pain, je débloque le picto banane ».
  const src = fs.readFileSync(path.join(ROOT, 'Games/miniTroll/src/it/Food.mt'), 'latin1');
  const noms = [...src.matchAll(/name:"([^"]+)"/g)].map((m) => m[1].trim());
  assert.equal(noms.length, O.ALIMENTS.length);
  // Les accents du fichier d'origine sont abîmés et « Oeuf » y est écrit sans
  // ligature : on ramène les deux côtés à leurs lettres nues avant de comparer.
  const nu = (s) => s.toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '').replace(/œ/g, 'oe').replace(/[^a-z]/g, '');
  for (let i = 0; i < noms.length; i++) {
    assert.equal(nu(noms[i]).slice(0, 4), nu(O.ALIMENTS[i]).slice(0, 4),
      `rang ${i} : ${noms[i]} contre ${O.ALIMENTS[i]}`);
  }
});

// ── Porter (faerieEffect) ─────────────────────────────────────────────────

test('un gant porté rend la fée plus forte, et le reprendre annule le bonus', () => {
  const fs2 = neuve(3, { $carac: [1, 1, 1, 1, 1, 1], $inv: [2] });
  const avec = new F.Fee(fs2, null, null);
  assert.equal(avec.carac[O.CARAC.FORCE], 4, '1 de base + 3 du brassard');
  assert.equal(fs2.$carac[O.CARAC.FORCE], 1, 'la fiche, elle, n\'a pas bougé');

  fs2.$inv = [];
  const sans = new F.Fee(fs2, null, null);
  assert.equal(sans.carac[O.CARAC.FORCE], 1, 'reposer l\'objet annule tout');
});

test('un pouvoir spécial et une coloration s\'appliquent en la portant', () => {
  const fs2 = neuve(4, { $skin: [0, 0x112233, 0x445566, 0x778899], $inv: [45, 63] });
  const fee = new F.Fee(fs2, null, null);
  assert.equal(fee.pouvoirs[5], true, 'le serre-tête à corne');
  assert.equal(fee.apparence().couleurs[0], O.COULEURS_CHEVEUX[3],
    'la coloration remplace la couleur de cheveux');
  assert.equal(fs2.$skin[1], 0x112233, 'sans toucher à la fiche');
});

test('un parchemin donne le sort à celle qui le porte, pas aux autres', () => {
  const porteuse = new F.Fee(neuve(5, { $inv: [113] }), null, null);
  assert.ok(porteuse.sorts.indexOf(13) >= 0);
  const voisine = new F.Fee(neuve(6, { $inv: [] }), null, null);
  assert.equal(voisine.sorts.indexOf(13), -1, 'la voisine ne l\'a pas');
});

// ── Le sac du joueur (groupEffect) ────────────────────────────────────────

test('un globe dans VOTRE sac profite à toutes les fées', () => {
  const carte = { $inv: [52], $faerie: [] };
  const a = new F.Fee(neuve(7, { $carac: [1, 1, 1, 1, 1, 1] }), null, carte);
  const b = new F.Fee(neuve(8, { $carac: [1, 1, 1, 1, 1, 1] }), null, carte);
  assert.equal(a.carac[O.CARAC.VIE], 2);
  assert.equal(b.carac[O.CARAC.VIE], 2, 'les deux, sans avoir rien à porter');
});

test('le même globe DANS le sac d\'une fée ne fait plus rien', () => {
  // it.CaracAll n'a qu'un groupEffect : c'est toute la différence avec le gant,
  // et c'est ce qui fait qu'on ne range pas ses globes n'importe où.
  const fs2 = neuve(9, { $carac: [1, 1, 1, 1, 1, 1], $inv: [52] });
  const fee = new F.Fee(fs2, null, { $inv: [], $faerie: [fs2] });
  assert.equal(fee.carac[O.CARAC.VIE], 1, 'rangé chez elle, le globe dort');
});

test('un grimoire dans votre sac apprend le sort à tout le monde', () => {
  const carte = { $inv: [207], $faerie: [] };
  const a = new F.Fee(neuve(10), null, carte);
  const b = new F.Fee(neuve(11), null, carte);
  assert.ok(a.sorts.indexOf(7) >= 0);
  assert.ok(b.sorts.indexOf(7) >= 0);
});

// ── Consommer (use) ───────────────────────────────────────────────────────

test('une potion rend des cœurs et disparaît', () => {
  const fee = new F.Fee(neuve(12, { $carac: [1, 1, 5, 1, 1, 1], $life: 1 }), null, null);
  const r = O.utiliser(O.info(71), fee);
  assert.equal(r.reste, null, 'elle est bue');
  assert.equal(r.effet.gagne, 3);
  assert.equal(fee.fs.$life, 4);

  const grande = O.utiliser(O.info(72), fee);
  assert.equal(fee.fs.$life, 5, 'la super potion remplit tout');
  assert.equal(grande.effet.gagne, 1, 'et ne rend que ce qui manquait');
});

test('une grande part de nourriture se mange en trois fois', () => {
  // it.Food.use : type++, et l'objet disparaît quand (type-300)%3 revient à 0.
  const fee = new F.Fee(neuve(13, { $taste: [[], []], $hunger: 0 }), null, null);
  let t = 300;
  const restes = [];
  for (let i = 0; i < 3; i++) {
    const r = O.utiliser(O.info(t), fee);
    restes.push(r.reste);
    t = r.reste;
  }
  assert.deepEqual(restes, [301, 302, null], 'grande, moyenne, petite, puis plus rien');
  assert.equal(fee.fs.$hunger, 12, 'trois bouchées de quatre');
});

test('ce qu\'elle aime la réjouit, ce qu\'elle déteste la boude', () => {
  const aime = new F.Fee(neuve(14, { $taste: [[1], [2]] }), null, null);
  assert.equal(O.utiliser(O.info(303), aime).effet.moral, 3, 'le raisin, qu\'elle adore');
  assert.equal(O.utiliser(O.info(306), aime).effet.moral, -3, 'la salade, qu\'elle déteste');
  assert.equal(O.utiliser(O.info(300), aime).effet.moral, 0, 'et le pain, sans avis');
});

// ── Les sacs ──────────────────────────────────────────────────────────────

test('la taille du sac suit Cs.bagLimit', () => {
  assert.deepEqual(O.PLACES_SAC, [0, 4, 6, 8, 9]);
  assert.equal(O.placesJoueur({ $bag: 0 }), 0, 'sans sac, aucune place');
  assert.equal(O.placesJoueur({ $bag: 2 }), 6);
  assert.equal(O.placesJoueur({}), 0);
  assert.equal(O.placesFee({ $bagMax: 2 }), 2, 'une fée neuve porte deux objets');
});

test('déplacer un objet d\'un sac à l\'autre, et échanger si la place est prise', () => {
  const fs2 = neuve(15, { $bagMax: 2, $inv: [null, null] });
  const carte = { $bag: 1, $inv: [70, null, null, null], $faerie: [fs2] };

  assert.equal(O.deplacer(carte, { sac: 'joueur', case: 0 }, { sac: 0, case: 0 }), true);
  assert.deepEqual(carte.$inv, [null, null, null, null]);
  assert.deepEqual(fs2.$inv, [70, null]);

  carte.$inv[1] = 71;
  assert.equal(O.deplacer(carte, { sac: 'joueur', case: 1 }, { sac: 0, case: 0 }), true);
  assert.deepEqual(fs2.$inv, [71, null], 'la potion prend la place');
  assert.equal(carte.$inv[1], 70, 'et l\'autre revient dans votre sac');
});

test('on ne pose rien hors du sac, ni deux vides l\'un dans l\'autre', () => {
  const fs2 = neuve(16, { $bagMax: 2, $inv: [null, null] });
  const carte = { $bag: 1, $inv: [70, null, null, null], $faerie: [fs2] };
  assert.equal(O.deplacer(carte, { sac: 'joueur', case: 0 }, { sac: 0, case: 5 }), false,
    'la fée n\'a que deux places');
  assert.equal(O.deplacer(carte, { sac: 'joueur', case: 9 }, { sac: 0, case: 0 }), false);
  assert.equal(O.deplacer(carte, { sac: 'joueur', case: 2 }, { sac: 0, case: 1 }), false,
    'deux cases vides, rien à faire');
  assert.deepEqual(carte.$inv, [70, null, null, null], 'et rien n\'a bougé');
});

test('les trous du sac se gardent : une place vide reste une place', () => {
  const fs2 = neuve(17, { $bagMax: 2, $inv: [null, null] });
  const carte = { $bag: 2, $inv: [70, 71, 72, null, null, null], $faerie: [fs2] };
  O.deplacer(carte, { sac: 'joueur', case: 1 }, { sac: 0, case: 0 });
  assert.deepEqual(carte.$inv, [70, null, 72, null, null, null],
    'le trou du milieu ne se tasse pas');
  assert.equal(carte.$inv.length, 6, 'et le sac garde sa taille');
});

// ── Donner à manger, et l'album ───────────────────────────────────────────

test('nourrir une fée fait monter le compteur de l\'album', () => {
  const fs2 = neuve(18, { $taste: [[], []], $hunger: 0 });
  const carte = { $bag: 1, $inv: [300, null, null, null], $faerie: [fs2], $stat: { $eat: [] } };
  const fee = new F.Fee(fs2, null, carte);

  const r = O.donner(carte, { sac: 'joueur', case: 0 }, fee);
  assert.equal(r.ok, true);
  assert.equal(carte.$stat.$eat[0], 1, 'Cm.incEatStat');
  assert.equal(carte.$inv[0], 301, 'il reste une part moyenne');
  assert.deepEqual(r.pictos, ['$pixiz_food302'], 'le premier palier, dès la première bouchée');
});

test('les trois paliers de l\'album tombent à 1, 5 et 20 repas', () => {
  const fs2 = neuve(19, { $taste: [[], []] });
  const carte = { $bag: 1, $inv: [], $faerie: [fs2], $stat: { $eat: [] } };
  const fee = new F.Fee(fs2, null, carte);
  const gagnes = [];
  for (let i = 1; i <= 20; i++) {
    carte.$inv[0] = 300;
    const r = O.donner(carte, { sac: 'joueur', case: 0 }, fee);
    for (const p of r.pictos) gagnes.push(i + ':' + p);
  }
  assert.deepEqual(gagnes,
    ['1:$pixiz_food302', '5:$pixiz_food301', '20:$pixiz_food300'],
    'grand, moyen, petit — les trois variantes du picto');
});

test('la règle des paliers est bien celle du serveur', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.match(src, /if \(count >= 1\)\s+addIfNew\(`\$pixiz_food\$\{300 \+ n \* 3 \+ 2\}`\)/);
  assert.match(src, /if \(count >= 5\)\s+addIfNew\(`\$pixiz_food\$\{300 \+ n \* 3 \+ 1\}`\)/);
  assert.match(src, /if \(count >= 20\) addIfNew\(`\$pixiz_food\$\{300 \+ n \* 3\}`\)/);
});

test('un objet qui ne se mange pas ne se donne pas', () => {
  const fs2 = neuve(20);
  const carte = { $bag: 1, $inv: [2, null, null, null], $faerie: [fs2], $stat: { $eat: [] } };
  const fee = new F.Fee(fs2, null, carte);
  const r = O.donner(carte, { sac: 'joueur', case: 0 }, fee);
  assert.equal(r.ok, false);
  assert.equal(carte.$inv[0], 2, 'le brassard est toujours là');
});

// ── L'accrochage à la page ────────────────────────────────────────────────

test('les objets se dessinent avec l\'art du jeu, pas avec les GIF de l\'album', () => {
  // Les GIF de bmp/titems servent l'album du site ; l'inventaire du jeu, lui,
  // a ses propres clips vectoriels dans gfx.swf. C'est ceux-là qu'on veut.
  const src = fs.readFileSync(path.join(ROOT, 'public/minipixiz/inventaire.js'), 'utf8');
  assert.doesNotMatch(src, /titems/, 'plus de chemin vers les GIF');
  assert.match(src, /itCarac/, 'mais les dessins de gfx.swf');
});

test('la page charge l\'inventaire et enregistre chaque changement', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/minipixiz/index.html'), 'utf8');
  assert.match(html, /src="\/minipixiz\/items\.js"/);
  assert.match(html, /src="\/minipixiz\/inventaire\.js"/);
  assert.match(html, /new window\.MinipixizInventaire\.Inventaire\(/);
  assert.match(html, /surChangement: function \(\) \{\s*plateforme\.ecrire/,
    'un repas est enregistré tout de suite');
  // poserFee et non une simple affectation : la fée QUI VOLE relit sa fiche
  // (Faerie.setInfo), sans quoi un globe posé dans le sac ne se sentirait qu'à
  // la partie suivante.
  assert.match(html, /client\.poserFee\(feeCourante\(\)\)/,
    'et la fée du plateau reprend ce qu\'elle porte');
  assert.match(html, /new window\.MinipixizFee\.Fee\(fs, null, plateforme\.carte\)/,
    'la fiche est passée pour que les globes agissent');
});

// ── L'inventaire, sur les dessins du jeu ──────────────────────────────────
//
// Ce n'est pas un panneau de notre invention : c'est l'écran d'Inventory.mt,
// avec ses constantes, ses quatre volets et son geste — prendre, puis reposer.

test('la grille du sac change de forme avec le sac', () => {
  // INV_SHAPE = [0,2,3,4,3] : deux colonnes avec le premier sac, trois avec le
  // deuxième, quatre avec le troisième. L'inventaire ne fait pas que grandir,
  // il se réorganise.
  const I = require(path.join(ROOT, 'public/minipixiz/inventaire.js'));
  assert.deepEqual(I.INV_SHAPE, [0, 2, 3, 4, 3]);
  assert.equal(I.SLOT_SIZE, 32);
  assert.equal(I.INV_WIDTH, 154);
  assert.equal(I.INV_HEIGHT, 140);
  assert.deepEqual(I.SECTION, ['voir les caractéristiques', 'voir les sortilèges',
    'voir l\'équipement', 'voir la santé']);
  assert.deepEqual(I.PANNEAU, { x: 200, y: 41 }, 'initFaeriePanel : _x = 200, _y = 41');
});

test('les constantes de l\'inventaire sont celles du fichier .mt', () => {
  const src = fs.readFileSync(path.join(ROOT, 'Games/miniTroll/src/Inventory.mt'), 'latin1');
  assert.match(src, /MARGIN_UP\s*=\s*20/);
  assert.match(src, /SLOT_SIZE\s*=\s*32/);
  assert.match(src, /INV_WIDTH\s*=\s*154/);
  assert.match(src, /INV_HEIGHT\s*=\s*140/);
  assert.match(src, /INV_SHAPE\s*=\s*\[0,2,3,4,3\]/);
  assert.match(src, /facePanel\._x = 200;/);
  assert.match(src, /facePanel\._y = 41;/);
});

test('chaque objet sait quel dessin et quelle image le représentent', () => {
  const I = require(path.join(ROOT, 'public/minipixiz/inventaire.js'));
  const sprites = require(path.join(ROOT, 'public/minipixiz/sprites/sprites.json'));
  // Item.getPic : l'image se déduit du type, famille par famille.
  assert.deepEqual(I.dessinObjet(2), { cle: 'itCarac', frame: 3 });
  assert.deepEqual(I.dessinObjet(71), { cle: 'itPotion', frame: 2 });
  assert.deepEqual(I.dessinObjet(113), { cle: 'itParchemin', frame: 14 });
  // L'aliment se lit à DEUX index : lequel, et quelle part il en reste.
  assert.deepEqual(I.dessinObjet(300), { cle: 'itAliment1', frame: 1 });
  assert.deepEqual(I.dessinObjet(301), { cle: 'itAliment2', frame: 1 });
  assert.deepEqual(I.dessinObjet(305), { cle: 'itAliment3', frame: 2 });
  // Et les dessins existent vraiment.
  for (const t of [0, 2, 30, 45, 52, 63, 70, 113, 213, 300, 304, 350]) {
    const d = I.dessinObjet(t);
    assert.ok(d, 'objet ' + t + ' : un dessin');
    const sp = sprites[d.cle];
    assert.ok(sp, d.cle + ' est extrait');
    assert.ok(sp.etats.some((e) => e.frame === d.frame),
      `${d.cle} a bien l'image ${d.frame} (objet ${t})`);
  }
});

test('les dessins des objets viennent de gfx.swf, pas de root.swf', () => {
  // C'est le fichier que le jeu charge à part : chercher itemCarac dans
  // root.swf ne donne rien, et c'est ce qui nous avait fait prendre les GIF de
  // l'album pour seule ressource.
  const src = fs.readFileSync(path.join(ROOT, 'scripts/extract-minipixiz-sprites.js'), 'utf8');
  assert.match(src, /gfx: path\.join\(RACINE, 'Games\/miniTroll\/swf\/gfx\.swf'\)/);
  assert.ok(fs.existsSync(path.join(ROOT, 'Games/miniTroll/swf/gfx.swf')));
  const sprites = require(path.join(ROOT, 'public/minipixiz/sprites/sprites.json'));
  for (const cle of ['itCarac', 'itPotion', 'itAliment1', 'sortBille', 'sortSymbole']) {
    assert.ok(sprites[cle], cle + ' est extrait');
    assert.ok(sprites[cle].etats[0].pieces.every((p) => /^g\//.test(p.fichier)),
      cle + ' vient bien du second fichier');
  }
});

test('les vingt-cinq symboles de sort sont teintés pour se voir', () => {
  // Le symbole est un tracé BLANC posé sur une bille BLANCHE : sans la
  // transformation de couleur que le fichier porte (mult 0, add 142/179/215),
  // les vingt-cinq sortilèges étaient invisibles.
  const sprites = require(path.join(ROOT, 'public/minipixiz/sprites/sprites.json'));
  const bille = sprites.sortBille.etats.find((e) => e.frame === 1);
  const symbole = bille.pieces.find((p) => p.nom === 'symbol');
  assert.ok(symbole, 'la bille porte un emplacement de symbole');
  assert.ok(Array.isArray(symbole.cx), 'et une transformation de couleur');
  assert.deepEqual(symbole.cx.slice(0, 3), [0, 0, 0], 'la source est effacée');
  assert.deepEqual(symbole.cx.slice(4, 7), [142, 179, 215], 'et remplacée par un bleu ardoise');
  assert.ok(sprites.sortSymbole.etats.length >= 25, 'les vingt-cinq symboles sont là');
});

test('la fée dit ce qu\'elle aime, avec les mots du jeu', () => {
  // getMsgTaste, et it.Food.getQt pour les tournures (« le pain », « les poires »).
  const fee = new F.Fee(neuve(31, { $name: 'Lila', $taste: [[0, 4], [1]] }), null, null);
  assert.equal(fee.gouts(), 'Lila aime le pain et les poires. Elle déteste le raisin.');
  const muette = new F.Fee(neuve(32, { $name: 'Zoé', $taste: [[], []] }), null, null);
  assert.equal(muette.gouts(), '', 'une fée sans goût n\'a rien à dire');
  const seulementContre = new F.Fee(neuve(33, { $name: 'Ana', $taste: [[], [2]] }), null, null);
  assert.equal(seulementContre.gouts(), 'Ana déteste la salade.');
});

test('la page ouvre l\'inventaire sur son propre canevas', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public/minipixiz/index.html'), 'utf8');
  assert.match(html, /<canvas id="inv-stage" width="240" height="240">/,
    'la scène de l\'inventaire fait 240 × 240 comme le jeu');
  assert.match(html, /canvas: \$\('#inv-stage'\)/);
  assert.match(html, /surChangement: function \(\) \{\s*plateforme\.ecrire/);
});
