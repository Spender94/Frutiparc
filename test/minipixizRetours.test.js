/*
 * Minipixiz — le premier retour de terrain, bug par bug.
 *
 * « les niveaux se répètent »        pas de graine passée à la forêt
 * « la mana ne se recharge pas »     checkFallStats → incManaTimer jamais joué
 * « les objets sont transparents »   pas de dessin pour le sac ni la clé
 * « la fée du sac n'est pas          choisir une fée n'écrivait pas $current
 *   celle qui joue »
 * « pas de % d'XP, pas de            l'infobulle du bureau n'avait pas
 *   description des sorts »          d'équivalent tactile
 * « le sac de la clairière           l'ancre du sac ne se voit qu'en regardant
 *   n'apparaît pas seul »            à gauche — chose qu'une souris fait toute
 *                                    seule, pas un doigt
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const E = require('../public/minipixiz/engine.js');
const C = require('../public/minipixiz/combat.js');
const F = require('../public/minipixiz/faerie.js');
const I = require('../public/minipixiz/inventaire.js');

function tirage(graine) {
  let s = graine;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

test('chaque niveau de forêt part avec une graine neuve', () => {
  const page = fs.readFileSync(path.join(ROOT, 'public/minipixiz/index.html'), 'utf8');
  const lancer = /function lancerNiveau\(\) \{[\s\S]*?\n  \}/.exec(page);
  assert.ok(lancer, 'lancerNiveau est là');
  assert.match(lancer[0], /graine: Math\.floor\(Math\.random\(\) \* 1e9\)/,
    'et il tire une graine par niveau');
  // Le moteur, lui, reste déterministe : même graine, même partie.
  const a = new E.Jeu({ graine: 7, niveau: 5 });
  const b = new E.Jeu({ graine: 7, niveau: 5 });
  assert.deepEqual(
    a.eList.map((e) => [e.et, e.px, e.py, e.type]),
    b.eList.map((e) => [e.et, e.px, e.py, e.type]),
    'même graine → même décor');
  const c = new E.Jeu({ graine: 8, niveau: 5 });
  assert.notDeepEqual(
    a.eList.map((e) => [e.et, e.px, e.py, e.type]),
    c.eList.map((e) => [e.et, e.px, e.py, e.type]),
    'graine différente → décor différent');
});

test('détruire des billes recharge la mana de la fée', () => {
  // Game.checkFallStats : fi.incManaTimer(-somme × coef), coef 3 en aventure.
  const jeu = new E.Jeu({ graine: 3, niveau: 0, grille: null });
  const alea = tirage(5);
  const fsFee = F.genererGraine(alea);
  fsFee.$mana = 0;                     // à sec : la goutte a la place de tomber
  const fi = new F.Fee(fsFee, alea, { $inv: [] });
  const champ = new C.Champ(jeu, { fee: fi });
  const fee = champ.faerieList[0];
  fee.manaTimer = 4;                   // la prochaine goutte est proche
  const avant = fee.mana;

  // Un carré de quatre à détruire.
  for (const [x, y] of [[2, 15], [3, 15], [2, 16], [3, 16]]) {
    const t = jeu.genElement(E.E.JETON, x, y, 0);
    t.setType(0);
  }
  jeu.viderGroupes();
  jeu.chercherGroupes();
  jeu.initStep(E.ETAPE.DESTRUCTION);   // détruit, souffle…
  // …et la cascade se referme quelques pas plus loin (chute → destruction
  // vide → checkFallStats) : on avance jusqu'au tour suivant.
  let garde = 0;
  while (jeu.step !== E.ETAPE.JEU && !jeu.termine && garde++ < 200) jeu.update(1);

  assert.ok(fee.mana > avant, 'la goutte est tombée : ' + avant + ' → ' + fee.mana);
  // Et le bassin garde le coefficient de Base (1), pas les 3 de l'aventure.
  const bassin = fs.readFileSync(path.join(ROOT, 'public/minipixiz/bassin.js'), 'utf8');
  assert.match(bassin, /manaCoef: 1/, 'le bassin recharge au taux de Base');
});

test('le sac et la clé ont leur dessin sur la grille', () => {
  const sac = I.dessinObjet(80);
  assert.ok(sac && sac.cle === 'mSac', 'le sac ramassable se dessine (mSac)');
  const cle = I.dessinObjet(31);
  assert.ok(cle && cle.cle === 'invCle', 'la clé du donjon aussi');
  // Et les dessins existent dans le manifeste.
  const m = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'public/minipixiz/sprites/sprites.json'), 'utf8'));
  assert.ok(m.mSac && m.invCle, 'mSac et invCle sont extraits');
});

test('choisir une fée au sac, c\'est choisir la fée jouée', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/minipixiz/inventaire.js'), 'utf8');
  assert.match(src, /this\.carte\.\$current = quoi\.fee;/,
    'la sélection écrit $current');
  assert.match(src, /if \(this\.carte\.\$current !== quoi\.fee\) \{[\s\S]{0,220}surChangement/,
    'et la fiche est persistée dans la foulée');
});

test('le sac dit le % d\'XP et décrit les sorts', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/minipixiz/inventaire.js'), 'utf8');
  // La progression, écrite sous la pastille ET dite au toucher.
  assert.match(src, /fee\.limiteExp\(\)\) \* 1000\) \/ 10/, 'le pourcentage du bureau (une décimale)');
  assert.match(src, /'niveau ' \+ \(nombre\(fee\.fs\.\$level\) \+ 1\) \+ ' \(' \+ prc \+ ' %\)'/,
    'l\'infobulle du bureau, dite dans le bandeau');
  // Les sorts se présentent au toucher.
  assert.match(src, /zoneRect\(\{ sort: t \}/, 'chaque sort est touchable');
  assert.match(src, /this\.dire\(sort\.description\(\), sort\.nom\(\) \+ ' :'\)/,
    'nom et effet dans le bandeau');
});

test('au doigt, la clairière s\'ouvre le regard vers l\'arbre et son sac', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/minipixiz/menu.js'), 'utf8');
  assert.match(src, /pointer: coarse/, 'l\'écran tactile est reconnu');
  assert.match(src, /this\.xm = tactile \? 8 : SCENE \/ 2;/,
    'et le regard part à gauche, où le sac est accroché');
});

/*
 * Le deuxième retour de terrain.
 *
 * « les bombes explosées n'infligeaient   Bombe.souffler mourait sans porter
 *   aucun dégât ni à ma fée ni aux        le souffle de Bomb.blast : 200 pts
 *   démons »                              dégressifs sur 64 px, et le recul
 * « ma fée qui est fatiguée est venue     personne ne demandait
 *   avec moi en forêt sans pb »           isReadyForBattle avant le départ
 * « une 10aine de niveaux mais jamais     là, rien à corriger : les taux sont
 *   aucun objet »                         ceux du jeu — on les épingle ici
 */

test('la bombe soufflée blesse la fée et les démons alentour', () => {
  const jeu = new E.Jeu({ graine: 3, niveau: 0, grille: null });
  const alea = tirage(5);
  const fsFee = F.genererGraine(alea);
  fsFee.$life = 3;
  const fi = new F.Fee(fsFee, alea, { $inv: [] });
  const champ = new C.Champ(jeu, { fee: fi });
  const fee = champ.faerieList[0];
  const bombe = jeu.genElement(E.E.BOMBE, 3, 10, null);
  // Bomb.blast mesure du coin de la case : la fée à dix pixels (un cœur y
  // passe), un démon à vingt (137 points — mortel pour un rang 0), un autre
  // au-delà du rayon de soixante-quatre.
  fee.x = jeu.posX(3) + 10; fee.y = jeu.posY(10);
  fee.vitx = 0; fee.vity = 0;
  const pres = champ.naitreImpy(0, jeu.posX(3) + 20, jeu.posY(10));
  const loin = champ.naitreImpy(0, jeu.posX(3) + 200, jeu.posY(10));
  const coeurs = fee.life;
  const santeLoin = loin.health;
  bombe.souffler();
  assert.ok(fee.life < coeurs, 'la fée y perd un cœur : ' + coeurs + ' → ' + fee.life);
  assert.ok(fee.vitx > 0, 'et l\'onde la repousse (vitx ' + fee.vitx.toFixed(1) + ')');
  assert.ok(!pres.vivant, 'le démon voisin meurt du souffle');
  assert.equal(loin.health, santeLoin, 'celui d\'au-delà des soixante-quatre pixels n\'a rien');
  assert.ok(!bombe.vivant, 'et la bombe y reste');
});

test('la fée fatiguée reste au bocal — la partie se joue sans elle', () => {
  // Aventure.initFaerie + FaerieInfo.isReadyForBattle : vie et moral au-dessus
  // de zéro, ni engourdie (mood 0) ni malade (mood 1). Sinon, pas de fée.
  const faire = (retouche) => {
    const alea = tirage(5);
    const f = F.genererGraine(alea);
    retouche(f);
    return new C.Champ(new E.Jeu({ graine: 3, niveau: 0, grille: null }),
      { fee: new F.Fee(f, alea, { $inv: [] }) });
  };
  assert.equal(faire((f) => { f.$moral = 0; }).faerieList.length, 0, 'sans moral, pas de vol');
  assert.equal(faire((f) => { f.$life = 0; }).faerieList.length, 0, 'sans vie non plus');
  assert.equal(faire((f) => { f.$mood = [1]; }).faerieList.length, 0, 'engourdie, elle reste');
  assert.equal(faire((f) => { f.$mood = [0, 1]; }).faerieList.length, 0, 'malade aussi');
  assert.equal(faire(() => {}).faerieList.length, 1, 'prête, elle vole');
  // Et la forêt cache aussi son interface : le même test décide des deux,
  // comme Forest.launch ne monte l'intFace que prête.
  const src = fs.readFileSync(path.join(ROOT, 'public/minipixiz/game.js'), 'utf8');
  assert.match(src, /if \(this\.fee && !this\.fee\.preteAuCombat\(\)\) this\.fee = null;/,
    'pas prête, pas d\'interface non plus');
});

test('les objets tombent au rythme du jeu — sans sac, seul le sac', () => {
  const h = (g) => {
    let s = (g * 48271) % 0x7fffffff || 1;
    return (n) => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s % n; };
  };
  // Item.getRandomId, $bag = 0 : l'issue est le premier sac (80), ou rien —
  // un débutant n'a nulle part où ranger autre chose.
  const vues = new Set();
  for (let g = 1; g <= 300; g++) {
    const n = E.tirerObjet(5, h(g), { sac: 0, flasques: 0 });
    if (n !== null) vues.add(n);
  }
  assert.deepEqual([...vues], [80], 'rien d\'autre que le sac ne tombe sans sac');
  // Forest.getLevel : les trois premiers niveaux d'un palier de vingt ne
  // donnent JAMAIS d'objet (level % 20 > 2).
  for (const niveau of [1, 2, 20, 21, 22]) {
    for (let g = 1; g <= 40; g++) {
      const jeu = new E.Jeu({ graine: g * 7 + niveau, niveau });
      assert.ok(!jeu.eList.some((e) => e.et === E.E.OBJET), 'objet au niveau ' + niveau);
    }
  }
  // …et un niveau éligible en donne une fois sur quatre au débutant :
  // la porte (1/2, Cs.itemRate) fois le tirage du sac (1/2).
  let avec = 0;
  const total = 400;
  for (let g = 1; g <= total; g++) {
    const jeu = new E.Jeu({ graine: g * 13 + 5, niveau: 5 });
    if (jeu.eList.some((e) => e.et === E.E.OBJET)) avec++;
  }
  assert.ok(avec > total * 0.17 && avec < total * 0.33,
    'un quart des niveaux éligibles, en gros : ' + avec + '/' + total);
});
