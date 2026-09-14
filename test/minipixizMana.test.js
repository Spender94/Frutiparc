/*
 * LA RÉSERVE DE MANA — LE RELEVÉ, ET L'ÉCART.
 *
 * Ce point a été retourné deux fois par des retours contraires, chaque
 * correction défaisant la précédente :
 *
 *   « On recommence un niveau avec le mana du niveau d'avant »   (4ᵉ lot)
 *   « Le bug qui nous fait récupérer tout le mana à chaque fin de niveau »
 *   « Le bogue de la mana qui ne se récupère pas après les niveaux est de
 *     retour ! »                                                  (6ᵉ lot)
 *
 * Ce fichier existe pour que cela s'arrête. Il porte DEUX choses, qu'il ne
 * faut pas confondre : ce que fait le jeu d'origine — établi, relevé,
 * vérifiable — et ce que le parc a DÉCIDÉ de faire autrement.
 *
 * ══ 1. CE QUE FAIT LE JEU D'ORIGINE ═══════════════════════════════════════
 *
 * Ce qui écrit $mana, dans tout le fichier — trois endroits, pas un de plus :
 *
 *   base/Aventure.mt:23    `fi.fs.$mana = fi.carac[Cs.MANA]*2`  ← LA SEULE
 *                          recharge, dans le CONSTRUCTEUR de l'aventure.
 *   sp/pe/Faerie.mt:173    `fi.fs.$mana = n` — la recopie de setMana : ce que
 *                          la fée dépense ou gagne en jouant.
 *   Cm.mt:604              `fs.$mana = fs.$carac[Cs.MANA]*2` — à la NAISSANCE
 *                          d'une fée (genFaerieSeed).
 *
 * Ni potion, ni objet, ni étoile. (Relevé : `grep -n '\$mana'
 * Games/miniTroll/src/` — dix lignes, dont six en lecture.)
 *
 * Et le constructeur ne tourne qu'à l'ENTRÉE DU LIEU, pas à chaque niveau :
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
 * Ce qui rend du mana en JOUANT, en revanche, vaut à chaque niveau :
 *
 *   Game.checkFallStats  `fi.incManaTimer( -fs.sum × base.getManaReplenishCoef() )`
 *   Aventure             `getManaReplenishCoef() → flColorKill ? 0 : 3`
 *   sp/pe/Faerie         `manaTimer = 50` à la naissance (donc à chaque
 *                        niveau) ; sous zéro, `manaTimer += 80` et un point
 *                        de mana. POW_REGENERATE_MANA multiplie par 1,5.
 *
 * ══ 2. CE QUE LE PARC FAIT AUTREMENT ══════════════════════════════════════
 *
 * LA RÉSERVE REPART PLEINE À CHAQUE NIVEAU. C'est un écart assumé, décidé
 * après trois retours de joueurs, et non une lecture du fichier.
 *
 * La raison : `flColorKill` coupe la recharge dès qu'une COULEUR du niveau
 * est entièrement vidée — et la forêt se gagne justement en vidant les
 * couleurs. La fin de chaque niveau se joue donc sans mana, et sur vingt
 * niveaux d'affilée la réserve ne remonte jamais : les sorts, tout un pan du
 * jeu, s'éteignent au bout de deux ou trois niveaux.
 *
 * Ce que l'écart NE change pas : le taux de recharge en jouant (3), la
 * coupure par couleur vidée, le plafond (carac[MANA] × 2), et le fait que
 * rien d'autre ne rende du mana. La fin de niveau reste tendue ; c'est le
 * niveau SUIVANT qui repart d'aplomb.
 *
 * Où ça vit, en un seul endroit par chemin :
 *   · public/minipixiz/lieux.js   `Lieu.commencer()` — que chaque niveau
 *     rappelle, donc l'entrée du lieu comme les suivants ;
 *   · public/minipixiz/index.html `lancerNiveau()` — idem pour la forêt.
 * Et NULLE PART ailleurs : surtout pas à la naissance de la fée du champ,
 * qui rendrait aussi la réserve à qui n'ouvre pas un niveau.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const lire = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const E = require(path.join(ROOT, 'public/minipixiz/engine.js'));
const F = require(path.join(ROOT, 'public/minipixiz/faerie.js'));
const L = require(path.join(ROOT, 'public/minipixiz/lieux.js'));
const P = require(path.join(ROOT, 'public/minipixiz/plateforme.js'));

const graine = (n) => () => {
  n = (n * 1103515245 + 12345) % 2147483648;
  return n / 2147483648;
};

// Une fiche avec une fée de mana 3 — réserve six.
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

// ── L'écart : pleine à chaque niveau ──────────────────────────────────────

test('la réserve est pleine à l’entrée du lieu', () => {
  const { c, f } = fiche();
  f.$mana = 1;
  const lieu = new L.Donjon({ carte: c, graine: 7, fee: f, surEvenement: () => {} });
  assert.equal(f.$mana, 6, '$mana = carac[MANA] × 2');
  assert.equal(lieu.champ.faerieList[0].mana, 6, 'et la fée du plateau la voit');
  assert.equal(lieu.level, 0);
});

test('…et pleine À CHAQUE NIVEAU SUIVANT — l’écart assumé', () => {
  const { c, f } = fiche();
  const lieu = new L.Donjon({ carte: c, graine: 7, fee: f, surEvenement: () => {} });

  for (let n = 0; n < 3; n++) {
    // On vide la réserve dans le niveau…
    lieu.champ.faerieList[0].poserMana(0);
    assert.equal(f.$mana, 0, 'niveau ' + lieu.level + ' : dépensée');
    // …on le gagne, et le donjon enchaîne.
    const avant = lieu.level;
    lieu.jeu.finPartie(true);
    assert.equal(lieu.level, avant + 1, 'le donjon a enchaîné');
    assert.equal(f.$mana, 6, 'niveau ' + lieu.level + ' : la réserve repart pleine');
    assert.equal(lieu.champ.faerieList[0].mana, 6, 'et la fée du plateau aussi');
  }
});

test('la recharge en jouant n’a pas bougé : trois par jeton, compteur à 50', () => {
  const { c, f } = fiche();
  const lieu = new L.Donjon({ carte: c, graine: 7, fee: f, surEvenement: () => {} });
  const fee = lieu.champ.faerieList[0];
  assert.equal(lieu.jeu.manaCoef, 3, 'Aventure.getManaReplenishCoef → 3');
  assert.equal(fee.manaTimer, 50, 'sp/pe/Faerie : manaTimer part de 50');

  fee.poserMana(0);
  fee.manaTimer = 1;
  cascade(lieu.jeu);
  assert.equal(fee.mana, 1, 'quatre jetons × 3 font tomber la goutte');
  assert.equal(fee.manaTimer, 69, 'et le compteur remonte de 80');
});

test('une couleur vidée coupe toujours la recharge du niveau', () => {
  const { c, f } = fiche();
  const lieu = new L.Donjon({ carte: c, graine: 7, fee: f, surEvenement: () => {} });
  const jeu = lieu.jeu;
  const fee = lieu.champ.faerieList[0];
  assert.equal(jeu.flColorKill, false);

  const couleur = jeu.colorList[0];
  jeu.eList.slice().forEach((el) => {
    if (el.et === E.E.JETON && el.type === couleur) el.tuer();
  });
  jeu.majCouleurs();
  assert.equal(jeu.flColorKill, true, 'Game.updatecolorList lève le drapeau');

  fee.poserMana(0);
  fee.manaTimer = 1;
  cascade(jeu);
  assert.equal(fee.mana, 0, 'plus une goutte pour le reste du niveau');

  // Le niveau suivant repart plein ET drapeau baissé.
  jeu.finPartie(true);
  assert.equal(lieu.jeu.flColorKill, false, 'Game.init remet le drapeau à zéro');
  assert.equal(f.$mana, 6, 'et la réserve est pleine');
});

test('la recharge vit dans les DEUX endroits où un niveau commence, et nulle part ailleurs', () => {
  // Un seul point par chemin : `commencer()` pour les lieux (que chaque
  // niveau rappelle), `lancerNiveau()` pour la forêt.
  const LIEUX = lire('public/minipixiz/lieux.js');
  const commencer = LIEUX.slice(LIEUX.indexOf('  commencer() {'), LIEUX.indexOf('  update(tmod) {'));
  assert.match(commencer, /rechargerMana\(\);/, 'le lieu recharge à chaque niveau');
  // AVANT le champ : la fée du plateau lit $mana à sa naissance.
  assert.ok(commencer.indexOf('rechargerMana') < commencer.indexOf('new C.Champ'),
    'la recharge précède le champ');
  const ctor = LIEUX.slice(LIEUX.indexOf('  constructor(o) {'), LIEUX.indexOf('  evenement(nom, d)'));
  assert.ok(!/rechargerMana/.test(ctor), 'le constructeur n’a plus la sienne : commencer() suffit');

  const PAGE = lire('public/minipixiz/index.html');
  const niveau = PAGE.slice(PAGE.indexOf('function lancerNiveau('),
    PAGE.indexOf('// Cm.getCurrentFaerie'));
  assert.match(niveau, /fiNiveau\.rechargerMana\(\);/, 'la forêt recharge à chaque niveau');
  const course = PAGE.slice(PAGE.indexOf('function nouvelleCourse('),
    PAGE.indexOf('// Spell.getRandomId'));
  assert.ok(!/rechargerMana/.test(course),
    'et plus au départ de la course : lancerNiveau la couvre déjà');

  // PAS à la naissance de la fée du champ : elle rendrait la réserve à qui
  // n'ouvre pas un niveau (le bassin, un clone).
  const COMBAT = lire('public/minipixiz/combat.js');
  const code = COMBAT.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/rechargerMana|\$mana\s*=\s*nombre\(fi\.carac\[MANA\]\)/.test(code),
    'le champ relit la fiche, il ne la remplit pas');
});

test('rien d’autre ne rend du mana : ni potion, ni objet, ni étoile', () => {
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
  const ENG = lire('public/minipixiz/engine.js');
  assert.match(ENG, /if \(!this\.fs\.flSpecial\) \{/, 'l’étoile ne passe pas par la mana');
});

test('le relevé du fichier d’origine reste consultable', () => {
  // L'écart est une décision ; le relevé, lui, doit rester vrai — c'est à lui
  // qu'on se reportera le jour où l'on voudra revenir en arrière.
  const src = path.join(ROOT, 'Games/miniTroll/src');
  if (!fs.existsSync(src)) return;                    // dépôt sans les sources
  const av = fs.readFileSync(path.join(src, 'base/Aventure.mt'), 'utf8');
  assert.match(av, /fi\.fs\.\$mana\s*=\s*fi\.carac\[Cs\.MANA\]\*2/,
    'la recharge d’origine est dans le constructeur de l’aventure');
  assert.match(av, /function tryToCloseGame\(\)\{[\s\S]*?game\.kill\(\);[\s\S]*?initStep\(0\)/,
    'et un niveau enchaîné ne le rappelle pas');
  const forest = fs.readFileSync(path.join(src, 'base/Forest.mt'), 'utf8');
  assert.match(forest, /function setWin\(flag\)\{[\s\S]*?level\+=1;[\s\S]*?initStep\(2\)/,
    'un niveau gagné avance le compteur dans la MÊME base');
});
