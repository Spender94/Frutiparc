/*
 * LA RÉSERVE DE MANA — LE RELEVÉ, UNE FOIS POUR TOUTES.
 *
 * Ce point a été retourné deux fois par deux retours contraires :
 *
 *   « On recommence un niveau avec le mana du niveau d'avant »  (4ᵉ lot)
 *   « Le bug qui nous fait récupérer tout le mana à chaque fin de niveau »
 *   « Le bogue de la mana qui ne se récupère pas après les niveaux est de
 *     retour ! »                                                  (6ᵉ lot)
 *
 * Chaque correction a défait la précédente. Ce fichier existe pour que cela
 * s'arrête : il porte le RELEVÉ du fichier d'origine, et les tests qui le
 * tiennent. Avant de re-basculer la règle, il faut donc démentir le relevé.
 *
 * ── Ce qui écrit $mana, dans TOUT le jeu d'origine ────────────────────────
 *
 *   base/Aventure.mt:23    `fi.fs.$mana = fi.carac[Cs.MANA]*2`  ← LA SEULE
 *                          recharge, dans le CONSTRUCTEUR de l'aventure.
 *   sp/pe/Faerie.mt:173    `fi.fs.$mana = n` — la recopie de setMana : ce que
 *                          la fée dépense ou gagne en jouant.
 *   Cm.mt:604              `fs.$mana = fs.$carac[Cs.MANA]*2` — à la NAISSANCE
 *                          d'une fée (genFaerieSeed).
 *
 * Et rien d'autre : ni potion, ni étoile, ni objet. (Relevé : `grep -n
 * '\$mana' Games/miniTroll/src/` — dix lignes, dont six en lecture.)
 *
 * ── Quand le constructeur d'aventure tourne-t-il ? ───────────────────────
 *
 * Une fois par ENTRÉE DANS LE LIEU, et pas une fois par niveau :
 *
 *   base/Forest.setWin      `level += 1; initStep(2)`   ← la MÊME base
 *   base/Aventure.update(2) `endGame()`
 *   base/Forest.endGame     `super.endGame()`           (hors relais)
 *   base/Aventure.endGame   `tryToCloseGame()`
 *   base/Aventure:173       `game.kill(); … initStep(0)` ← un Game neuf,
 *                           la MÊME base : `new` ne repasse pas.
 *
 * Un `new base.Forest` ne naît que d'un `Manager.fadeSlot`, et le relevé de
 * ses treize appels ne montre aucun enchaînement de niveaux : Menu.mt:349
 * (la clairière → un lieu), et douze retours vers « menu », « news » ou
 * « inventory ». Entre deux niveaux, personne ne rattache l'écran.
 *
 * ── Ce qui rend le mana en JOUANT ────────────────────────────────────────
 *
 *   Game.checkFallStats  `fi.incManaTimer( -fs.sum × base.getManaReplenishCoef() )`
 *   Aventure             `getManaReplenishCoef() → flColorKill ? 0 : 3`
 *   sp/pe/Faerie         `manaTimer = 50` à la naissance (donc à chaque
 *                        niveau) ; sous zéro, `manaTimer += 80` et un point
 *                        de mana. Le pouvoir POW_REGENERATE_MANA multiplie
 *                        l'apport par 1,5.
 *
 * `flColorKill` se lève dès qu'une COULEUR du niveau est entièrement
 * éliminée (Game.updatecolorList), et ne retombe qu'au `Game.init` du niveau
 * suivant. C'est ce qui rend les fins de niveau tendues : on y vit sur ses
 * réserves, et la forêt se gagne justement en vidant les couleurs.
 *
 * ── Ce que ça donne à l'écran (mesuré, forêt, fée mana 3 → réserve 6) ────
 *
 *   niveau 0 à l'ouverture : réserve 6 / 6, manaTimer 50, coef 3
 *   niveau 0, trente cascades de quatre jetons : +4 points
 *   niveau 1 à l'ouverture : la réserve du niveau d'avant, manaTimer 50
 *   niveau 1, mêmes trente cascades : +4 points
 *
 * La réserve se refait donc EN JOUANT, à chaque niveau — mais elle ne
 * repart jamais pleine, et elle se coupe dès la première couleur vidée.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const lire = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const E = require(path.join(ROOT, 'public/minipixiz/engine.js'));
const C = require(path.join(ROOT, 'public/minipixiz/combat.js'));
const F = require(path.join(ROOT, 'public/minipixiz/faerie.js'));
const L = require(path.join(ROOT, 'public/minipixiz/lieux.js'));
const P = require(path.join(ROOT, 'public/minipixiz/plateforme.js'));

const graine = (n) => () => {
  n = (n * 1103515245 + 12345) % 2147483648;
  return n / 2147483648;
};

// Une fiche avec une fée de mana 3 — réserve six, comme dans le relevé.
function fiche() {
  const c = P.carteNeuve();
  const f = F.genererGraine(graine(7));
  f.$carac = [2, 2, 6, 2, 2, 3];
  f.$life = 6; f.$mana = 6; f.$hunger = 20; f.$moral = 10;
  f.$mission = null; f.$pos = null; f.$mood = [];
  c.$faerie = [f]; c.$current = 0;
  c.$key = 5; c.$dungeon = { $lvl: 0, $f: true, $day: 0 };
  return { c, f };
}

// Une cascade de quatre jetons, comme la chute d'une pièce en produit.
function cascade(jeu) {
  jeu.initStatsChute();
  jeu.fs.list.push(4);
  jeu.fs.sum = 4;
  jeu.verifierStatsChute();
}

test('la réserve est pleine à l’ENTRÉE du lieu — et nulle part ailleurs', () => {
  const { c, f } = fiche();
  f.$mana = 1;
  const lieu = new L.Donjon({ carte: c, graine: 7, fee: f, surEvenement: () => {} });
  assert.equal(f.$mana, 6, 'base/Aventure.new : $mana = carac[MANA] × 2');
  assert.equal(lieu.level, 0);

  // On en dépense la moitié, puis on gagne le niveau : le donjon enchaîne
  // SANS repasser par le constructeur, donc sans refaire la réserve.
  lieu.champ.faerieList[0].poserMana(3);
  assert.equal(f.$mana, 3);
  lieu.jeu.finPartie(true);
  assert.equal(lieu.level, 1, 'le donjon a enchaîné');
  assert.equal(f.$mana, 3, 'la fée entre au niveau suivant avec ce qu’il lui reste');
  assert.equal(lieu.champ.faerieList[0].mana, 3, 'et le champ la reçoit telle quelle');
});

test('mais elle se refait EN JOUANT, à chaque niveau', () => {
  const { c, f } = fiche();
  const lieu = new L.Donjon({ carte: c, graine: 7, fee: f, surEvenement: () => {} });

  const refaire = () => {
    const fee = lieu.champ.faerieList[0];
    fee.poserMana(0);
    assert.equal(fee.manaTimer, 50, 'sp/pe/Faerie : manaTimer repart de 50 au niveau');
    for (let i = 0; i < 30 && !lieu.jeu.termine; i++) cascade(lieu.jeu);
    return fee.mana;
  };

  const n0 = refaire();
  assert.ok(n0 > 0, 'le niveau 0 rend du mana (' + n0 + ')');
  lieu.jeu.finPartie(true);
  const n1 = refaire();
  assert.equal(n1, n0, 'le niveau 1 en rend autant : la recharge n’est pas cassée');
});

test('une couleur vidée coupe la recharge — jusqu’au niveau suivant, pas au-delà', () => {
  const { c, f } = fiche();
  const lieu = new L.Donjon({ carte: c, graine: 7, fee: f, surEvenement: () => {} });
  const jeu = lieu.jeu;
  const fee = lieu.champ.faerieList[0];

  assert.equal(jeu.flColorKill, false, 'drapeau baissé à l’ouverture du niveau');
  assert.equal(jeu.manaCoef, 3, 'Aventure.getManaReplenishCoef → 3');

  // On vide une couleur du plateau : Game.updatecolorList lève le drapeau.
  const couleur = jeu.colorList[0];
  jeu.eList.slice().forEach((el) => {
    if (el.et === E.E.JETON && el.type === couleur) el.tuer();
  });
  jeu.majCouleurs();
  assert.equal(jeu.flColorKill, true);

  fee.poserMana(0);
  fee.manaTimer = 1;
  cascade(jeu);
  assert.equal(fee.mana, 0, 'plus une goutte pour le reste du niveau');

  // …et le niveau suivant repart avec un plateau neuf, drapeau baissé.
  jeu.finPartie(true);
  assert.equal(lieu.jeu.flColorKill, false, 'Game.init remet le drapeau à zéro');
  const fee2 = lieu.champ.faerieList[0];
  fee2.poserMana(0);
  fee2.manaTimer = 1;
  cascade(lieu.jeu);
  assert.equal(fee2.mana, 1, 'la recharge est revenue avec le niveau');
});

test('la forêt refait la réserve au départ de la COURSE, pas à chaque niveau', () => {
  // base/Forest.setWin enchaîne ses vingt niveaux dans la même base : la
  // recharge vit donc dans `nouvelleCourse`, jamais dans `lancerNiveau`.
  const PAGE = lire('public/minipixiz/index.html');
  const course = PAGE.slice(PAGE.indexOf('function nouvelleCourse('),
    PAGE.indexOf('function sortAApprendre('));
  assert.match(course, /fiDepart\.rechargerMana\(\);/,
    'l’entrée en forêt refait la réserve');
  const niveau = PAGE.slice(PAGE.indexOf('function lancerNiveau('),
    PAGE.indexOf('function lancerNiveau(') + 1200);
  assert.ok(!/rechargerMana/.test(niveau),
    'le niveau suivant, lui, se joue sur ce qu’il en reste');

  // Et dans les lieux, c'est le CONSTRUCTEUR qui recharge — pas `commencer()`,
  // que chaque niveau rappelle.
  const LIEUX = lire('public/minipixiz/lieux.js');
  const ctor = LIEUX.slice(LIEUX.indexOf('  constructor(o) {'), LIEUX.indexOf('  evenement(nom, d)'));
  assert.match(ctor, /rechargerMana\(\);/);
  const commencer = LIEUX.slice(LIEUX.indexOf('  commencer() {'), LIEUX.indexOf('  update(tmod) {'));
  assert.ok(!/rechargerMana/.test(commencer), 'commencer() ne recharge pas');

  // Le champ non plus : c'était « le bug qui nous fait récupérer tout le mana
  // à chaque fin de niveau ».
  const COMBAT = lire('public/minipixiz/combat.js');
  const code = COMBAT.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/\$mana\s*=\s*nombre\(fi\.carac\[MANA\]\)/.test(code),
    'la naissance de la fée du champ ne remplit plus la réserve');
});

test('rien d’autre ne rend du mana : ni potion, ni objet, ni étoile', () => {
  // Le fichier d'origine n'a que deux sources — la recharge d'entrée et la
  // goutte de `incManaTimer`. Une potion soigne, elle ne recharge pas.
  const O = require(path.join(ROOT, 'public/minipixiz/items.js'));
  const { c, f } = fiche();
  const fee = new F.Fee(f, null, c);
  fee.fs.$mana = 0;
  for (const it of (O.POTIONS || [])) {
    const info = O.info(it && it.type !== undefined ? it.type : it);
    if (!info || !info.flUse) continue;
    O.utiliser(info, fee);
    assert.equal(fee.fs.$mana, 0, (info.nom || '?') + ' ne rend pas de mana');
  }
  // Et l'étoile du plateau ne passe pas par la mana : sa règle ne lit que
  // flSpecial (Game.checkFallStats).
  const ENG = lire('public/minipixiz/engine.js');
  assert.match(ENG, /if \(!this\.fs\.flSpecial\) \{/);
});

test('le relevé du fichier d’origine reste consultable', () => {
  // Si les sources d'époque sont là, on vérifie que le relevé de l'en-tête
  // dit vrai — c'est lui qui empêchera la prochaine bascule.
  const src = path.join(ROOT, 'Games/miniTroll/src');
  if (!fs.existsSync(src)) return;                    // dépôt sans les sources
  const av = fs.readFileSync(path.join(src, 'base/Aventure.mt'), 'utf8');
  assert.match(av, /fi\.fs\.\$mana\s*=\s*fi\.carac\[Cs\.MANA\]\*2/,
    'la recharge est bien dans le constructeur de l’aventure');
  // …et le constructeur n'est PAS rappelé entre deux niveaux : tryToCloseGame
  // se contente de tuer le Game et de revenir à l'étape 0.
  assert.match(av, /function tryToCloseGame\(\)\{[\s\S]*?game\.kill\(\);[\s\S]*?initStep\(0\)/);
  const forest = fs.readFileSync(path.join(src, 'base/Forest.mt'), 'utf8');
  assert.match(forest, /function setWin\(flag\)\{[\s\S]*?level\+=1;[\s\S]*?initStep\(2\)/,
    'un niveau gagné avance le compteur dans la MÊME base');
});
