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
const P = require('../public/minipixiz/plateforme.js');

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
  // …mais seulement une fée LIBRE : en bocal ou en mission, on la regarde
  // sans la choisir (inv/Slot.mt tient la main par l'échange de bocal).
  assert.match(src,
    /if \(fs && !enMission\(fs\) && !enBocal\(fs\) && this\.carte\.\$current !== quoi\.fee\) \{[\s\S]{0,220}surChangement/,
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

/*
 * Troisième retour : « j'ai ouvert mon sac, cliqué "retour", ça m'a mis
 * direct dans l'arbre creux au lieu du menu. »
 *
 * Au doigt, REGARDER la clairière (glisser = viser) finit tout de même par un
 * `click` du navigateur au lever — sur la porte venue glisser sous le doigt.
 * Et le tap qui ferme le sac peut retomber sur la clairière révélée. Deux
 * gardes : un toucher qui a bougé n'est pas un choix, et le menu retient ses
 * clics un instant à chaque retour.
 */
test('un glissement du doigt sur la clairière n\'est pas un choix', () => {
  const M = require('../public/minipixiz/menu.js');
  const choix = [];
  const faux = {
    canvas: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
    echelle: 1,
    zones: [{ lieu: { titre: 'Arbre creux' }, etat: {}, x: 0, y: 0, l: 240, h: 240 }],
    surChoix: (l) => choix.push(l.titre),
    touche: null,
    garde: 0,
    maintenant: M.Menu.prototype.maintenant,
  };
  const clic = M.Menu.prototype.clic.bind(faux);
  // Un vrai tap — deux pixels de tremblé — choisit.
  faux.touche = { x: 50, y: 50, bouge: 2 };
  clic({ clientX: 50, clientY: 50 });
  assert.deepEqual(choix, ['Arbre creux'], 'le tap immobile entre');
  // Un toucher qui a panoramé la clairière ne choisit pas.
  faux.touche = { x: 50, y: 50, bouge: 30 };
  clic({ clientX: 80, clientY: 50 });
  assert.deepEqual(choix, ['Arbre creux'], 'le glissement, lui, n\'entre pas');
  // Au retour du sac, la clairière retient ses clics un instant.
  faux.touche = null;
  M.Menu.prototype.garder.call(faux, 60000);
  clic({ clientX: 50, clientY: 50 });
  assert.deepEqual(choix, ['Arbre creux'], 'la garde avale le clic de fermeture');
  faux.garde = 0;
  clic({ clientX: 50, clientY: 50 });
  assert.equal(choix.length, 2, 'la garde levée, on choisit à nouveau');
  // Et les deux retours arment bien cette garde : le sac, et chaque
  // ouverture du menu (retour de partie, d'Ornegon, du bassin…).
  const page = fs.readFileSync(path.join(ROOT, 'public/minipixiz/index.html'), 'utf8');
  assert.match(page, /function fermerSac\(\) \{[\s\S]{0,220}menu\.garder\(400\)/,
    'fermer le sac arme la garde');
  const src = fs.readFileSync(path.join(ROOT, 'public/minipixiz/menu.js'), 'utf8');
  assert.match(src, /demarrer\(alea\) \{\n    this\.garder\(400\);/,
    'ouvrir le menu aussi');
});

/*
 * Cinquième retour : « il manque l'animation de l'objet lorsqu'il est
 * collecté — l'objet est censé monter. »
 *
 * Game.initStep(5), l'étape ACTIVE ELEMENT : l'objet dégagé rejoint la liste
 * et le jeu ENTIER attend son envol — il monte en accélérant (vity -= 0.1),
 * sème sa traîne d'étoiles, et n'est pris qu'en sortant de l'aire (y < -20).
 * Le portage le ramassait sur place, sans une image d'envol.
 */
test('l\'objet collecté s\'envole — et n\'est pris qu\'en haut de l\'aire', () => {
  const jeu = new E.Jeu({ graine: 1, niveau: 0, grille: null });
  const e = jeu.genElement(E.E.OBJET, 2, 10, 300);
  const vus = [];
  jeu.onEvent = (n) => vus.push(n);
  jeu.initStep(E.ETAPE.ACTIF);
  assert.equal(jeu.activeList[0], e, 'dégagé, il décolle');
  assert.ok(vus.includes('objetEnvol'), 'et le départ s\'annonce');
  assert.deepEqual(jeu.objets, [], 'pas encore pris : il monte');
  // Quelques images : il est plus haut qu'avant, toujours pas pris.
  for (let i = 0; i < 10; i++) jeu.update(1);
  assert.ok(e.decalY < 0, 'dix images plus tard il est plus haut (' + e.decalY.toFixed(1) + ')');
  assert.ok(!vus.includes('objet'), 'et toujours à prendre');
  // Jusqu'en haut : la prise n'a lieu qu'en sortant de l'aire.
  let garde = 0;
  while (jeu.step === E.ETAPE.ACTIF && garde++ < 400) jeu.update(1);
  assert.ok(vus.includes('objet'), 'sorti de l\'aire, il est pris');
  assert.deepEqual(jeu.objets, [300], 'et la partie le retient');
  assert.ok(!e.vivant, 'l\'élément a quitté la grille');
  assert.ok(jeu.step !== E.ETAPE.ACTIF, 'et le jeu a repris son cycle');
});

/*
 * La suite du cinquième retour (« je te laisse gérer ça ») : les deux écarts
 * notés au commit de l'envol — le salut de la fée à l'objet qui décolle
 * (FaerieInfo.reactItem), et le rayon animé de la ponte (Eye.activeUpdate).
 */
test('la fée salue l\'objet qui décolle — reactItem, mot pour mot', () => {
  const faire = (graine) => {
    const alea = tirage(graine || 7);
    const f = F.genererGraine(alea);
    f.$humor = 0;
    f.$taste = [[9], [2]];             // elle aime la brioche, déteste la salade
    return new F.Fee(f, alea, { $inv: [] });
  };
  // Aimé : la rangée LIKE de son humeur, $food mis « à l'unité » (qt2).
  const aime = faire().salutObjet(300 + 9 * 3);
  assert.ok(['Chouette ! une brioche !', 'une brioche, youpiii'].includes(aime),
    'la brioche aimée : ' + aime);
  // Détesté : la rangée DISLIKE l'emporte.
  const deteste = faire().salutObjet(300 + 2 * 3);
  assert.ok(['une salade...', 'Dommage, une salade'].includes(deteste),
    'la salade détestée : ' + deteste);
  // Rare — dix et plus — hors goûts : la rangée RARE.
  assert.equal(faire().salutObjet(300 + 12 * 3),
    'Oh !! un poireau ! On en voit pas souvent !', 'le poireau est rare');
  // Ordinaire hors goûts : la rangée OTHER ($other reste à enrichir()).
  const banal = faire().salutObjet(300);
  assert.ok(['du pain !', 'Oh, du pain', 'tiens? du pain, on partagera avec $other']
    .includes(banal), 'le pain ordinaire : ' + banal);
  // Un objet : sa FAMILLE, jamais son nom exact (Lang.getItemFamily).
  assert.ok(faire().salutObjet(7).indexOf('un objet magique') >= 0, 'l\'objet magique');
  assert.ok(faire().salutObjet(80).indexOf('un nouveau sac') >= 0, 'le sac');
  // Et la case nulle est un silence : LIKE, humeur 5, première case.
  const f5 = F.genererGraine(tirage(7));
  f5.$humor = 5; f5.$taste = [[9], []];
  const muette = new F.Fee(f5, () => 0, { $inv: [] });
  assert.equal(muette.salutObjet(300 + 9 * 3), null, 'la case nulle est un silence');
  // Le client fait parler la fée au décollage.
  const src = fs.readFileSync(path.join(ROOT, 'public/minipixiz/game.js'), 'utf8');
  assert.match(src, /case 'objetEnvol': \{/, 'le décollage est écouté');
  assert.match(src, /this\.fee\.salutObjet\(d\.type\)/, 'et la fée salue');
});

test('la ponte de l\'œil tire son rayon — et la partie le regarde', () => {
  const jeu = new E.Jeu({ graine: 3, niveau: 0, grille: null });
  const oeil = jeu.genElement(E.E.OEIL, 4, 10, 0);
  oeil.color = 2;
  oeil.lumiere = 2;                    // chargé : la prochaine veille pond
  jeu.initStep(E.ETAPE.ACTIF);
  assert.ok(jeu.activeList.indexOf(oeil) >= 0, 'la perle posée, l\'œil rejoint la liste');
  assert.ok(oeil.rayon, 'et tient son rayon');
  const perle = jeu.eList.find((e) => e.special === E.SPECIAL.PERLE);
  assert.ok(perle, 'la perle est là');
  assert.equal(perle.type, 2, 'à sa couleur');
  let garde = 0;
  while (jeu.activeList.length > 0 && garde++ < 300) jeu.update(1);
  assert.ok(garde < 300, 'la boule sort en un temps borné (' + garde + ' images)');
  assert.equal(oeil.rayon, null, 'le rayon s\'éteint');
  assert.ok(oeil.vivant, 'et l\'œil, lui, reste');
});

/*
 * Quatrième retour : « j'ai ramassé un objet en forêt mais il n'apparaît pas
 * dans mon inventaire après la partie. »
 *
 * La course jouait sur une COPIE de la fiche, fusionnée en fin de course —
 * et le sac, ouvert pendant la course (le bouton est là), montrait la fiche
 * d'AVANT : l'objet semblait perdu. Base.grab n'a jamais eu de copie : il
 * écrit Cm.card à l'instant du ramassage. On fait pareil.
 */
test('l\'objet ramassé est dans le sac à l\'instant, pas en fin de course', () => {
  const page = fs.readFileSync(path.join(ROOT, 'public/minipixiz/index.html'), 'utf8');
  assert.match(page, /P\.ramasser\(plateforme\.carte, info\.type\)/,
    'Base.grab écrit la fiche VIVANTE');
  assert.match(page, /fiche: P\.fiche\(plateforme\.carte\)/,
    'et le tirage du niveau suivant lit la même fiche');
  assert.match(page, /avant: JSON\.parse\(JSON\.stringify\(plateforme\.carte\)\)/,
    'la photo d\'entrée ne sert qu\'à compter les pictos');
  assert.match(page, /\}, course\.avant\)\.then\(/,
    'et la fin de course la passe à l\'enregistrement');
  // Le tout, sans que la fusion ne repasse derrière : un seul exemplaire.
  const c = P.carteNeuve();
  c.$bag = 1;
  P.ramasser(c, 300);
  assert.deepEqual(c.$inv, [300], 'ramassé = rangé, avant la fin de la course');
  const fin = P.fusionner(c, { niveaux: [3], dernier: 4, objets: [300], entree: true });
  assert.deepEqual(fin.$inv, [300], 'la fusion solde la course, elle ne re-range pas');
  assert.equal(fin.$stat.$run, 16, 'et les carrés de endGame restent là');
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

// ── Le retour « combat » : cœurs, dégâts, expérience ───────────────────────
//
// « Les cœurs ne diminuent pas progressivement… elle perd d'un coup un cœur
// entier » — chaque cœur encaisse CENT points (People.health), et inter.Life
// .setHealth fait fondre le cœur COURANT à mesure. L'affichage du portage
// était binaire : six tirs d'impy mineur sans que rien ne bouge, puis un cœur
// entier au septième.
// « l'XP augmente moins vite » — vrai : base/Forest.endGame donne
// int(niveau × 1,5) + 1 à CHAQUE niveau gagné, et le portage ne payait que
// les impys abattus. Le pouvoir POW_EXP (× 1,5) manquait aussi.

test('le cœur courant fond avec la santé qui reste (inter.Life.setHealth)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/minipixiz/game.js'), 'utf8');
  // L'échelle du fichier : 10 + santé × 0,9 pour cent, sur le cœur rouge seul.
  assert.match(src, /10 \+ Math\.max\(0, mf\.health\) \* 0\.9/);
  assert.match(src, /function coeurSeul\(/);
  // Le piège vérifié contre le VRAI SWF (root.swf sous Ruffle, impys de
  // triche) : `coeur` est dans ECHELLE_PIXEL, où rendre() ignore la taille.
  // Avec la clé du parent, le cœur restait à taille pleine et la compensation
  // de centrage le poussait hors de son contour. La clé dédiée le fait fondre
  // DANS le contour, comme le sous-clip c.
  assert.match(src, /cle: 'coeurQuiFond'/);
  // Le point fixe de la fonte : le centre du dessin, comme le clip `c`.
  assert.match(src, /COEUR_CENTRE = \{ x: 6\.15, y: 5\.53 \}/);
  assert.match(src, /COEUR_CENTRE\.x \* \(1 - prc \/ 100\)/);
  // Et le sprite d'où il sort : l'image 2 du cœur a bien DEUX pièces, la
  // dernière étant le cœur rouge lui-même.
  const sprites = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'public/minipixiz/sprites/sprites.json'), 'utf8'));
  const f2 = sprites.coeur.etats.find((e) => e.frame === 2);
  assert.ok(f2 && f2.pieces.length === 2, 'fond + cœur rouge');
});

test('les dégâts du portage sont ceux du fichier, tir pour tir', () => {
  // Faerie.harm : d = tir + niveau × 0,1 (la « réduction » par niveau est une
  // ADDITION — priorité des opérateurs du fichier, gardée telle quelle), cent
  // points par cœur. Une fée Vie 4, niveau 10 : 26 tirs d'un rang 0 pour la
  // tuer. Si elle tombe en deux ou trois tirs, c'est qu'elle était déjà à un
  // cœur (la vie persiste sur la fiche, comme au bureau) face à un rang 3-4.
  const cas = [[0, 26], [1, 13], [2, 9], [3, 7], [4, 6]];
  for (const [rang, attendu] of cas) {
    const alea = tirage(3);
    const fs2 = F.genererGraine(alea);
    fs2.$carac = [4, 3, 4, 2, 2, 3];
    fs2.$level = 9;
    fs2.$life = 4;
    const jeu = new E.Jeu({ graine: 7, niveau: 25, fiche: { $stat: {} } });
    const champ = new C.Champ(jeu, { fee: new F.Fee(fs2, alea, { $inv: [] }) });
    const fee = champ.faerieList[0];
    const tir = 15 + rang * 15;
    let coups = 0;
    while (!fee.flDeath && coups < 100) { fee.blesser(tir); coups++; }
    assert.equal(coups, attendu, 'rang ' + rang + ' : ' + coups + ' tirs');
  }
});

test('chaque niveau de forêt gagné nourrit la fée — int(niveau × 1,5) + 1', () => {
  const page = fs.readFileSync(path.join(ROOT, 'public/minipixiz/index.html'), 'utf8');
  assert.match(page, /incExp\(Math\.floor\(course\.niveau \* 1\.5\) \+ 1\)/);
  // …seulement si elle est là et vivante, comme base/Forest.endGame.
  assert.match(page, /mfXp && !mfXp\.flDeath && mfXp\.fi/);
});

test('le pouvoir POW_EXP rapporte moitié plus, sans arrondi', () => {
  const alea = tirage(5);
  const fs2 = F.genererGraine(alea);
  const fee = new F.Fee(fs2, alea, { $inv: [] });
  fee.incExp(10);
  assert.equal(fee.fs.$exp, 10);
  fee.pouvoirs[4] = true;              // Cs.POW_EXP
  fee.incExp(5);
  assert.equal(fee.fs.$exp, 17.5, '5 points en font 7,5');
});

test('les impys abattus se comptent par rang dans $stat.$kill', () => {
  const page = fs.readFileSync(path.join(ROOT, 'public/minipixiz/index.html'), 'utf8');
  // Les deux écrans qui font naître des impys — la forêt et les lieux — font
  // le geste d'Imp.harm : $kill[level]++.
  const occurrences = page.match(/kills\[info\.level\]\+\+/g) || [];
  assert.equal(occurrences.length, 2, 'forêt ET donjon');
  // Et le portage ne raconte plus que $kill compte des zones.
  const plate = fs.readFileSync(path.join(ROOT, 'public/minipixiz/plateforme.js'), 'utf8');
  assert.match(plate, /un compteur par RANG d'impy/);
});

/*
 * ── La seconde vague de retours ──────────────────────────────────────────
 *
 * « la fée morte parlait encore »       le client gardait this.fee au-delà
 *                                       de la mort (V0.38 : « les fées mortes
 *                                       ne parlent plus »)
 * « ça rame quand les pièces           chaque pas du blanchiment fabriquait
 *   disparaissent »                     un canevas et repassait les pixels
 * « le sort anti-rotation n'a pas      les fils calculés n'étaient jamais
 *   ses fils, et les billes rosissent » dessinés ; la teinte inventée collait
 *                                       aux billes posées
 * « pas les mêmes explosions »          des carrés de couleur à la place des
 *                                       cristaux, flammes et pentacles du SWF
 * « je lance mes sorts avec espace »    les touches étaient figées — le
 *                                       moulin (Option.mt) les remappe
 */

test('la fée morte se tait sur-le-champ — V0.38, « les fées mortes ne parlent plus »', () => {
  const client = fs.readFileSync(path.join(ROOT, 'public/minipixiz/game.js'), 'utf8');
  assert.match(client, /if \(nom === 'feeMorte'\) \{\s*this\.fee = null;\s*this\.dialogue = null;\s*\}/,
    'la mort coupe la parole à l\'instant');
});

test('le blanchiment des billes se COMPOSE — plus un canevas par pas de fondu', () => {
  const client = fs.readFileSync(path.join(ROOT, 'public/minipixiz/game.js'), 'utf8');
  assert.match(client, /voile: \{ c: sil\.c, alpha/, 'rendre publie un voile');
  assert.match(client, /if \(r\.voile\)/, 'poserRendu le pose à l\'alpha');
  assert.match(client, /function silhouettePeinte/, 'poserVif a le même remède');
  // Le chemin chaud ne repasse plus les pixels : fondre() a quitté rendre().
  const rendreSrc = client.slice(client.indexOf('function rendre('),
    client.indexOf('function poserRendu'));
  assert.ok(!/fondre\(/.test(rendreSrc), 'rendre ne rasterise plus le mélange');
});

test('les Fils Paralysants se voient, et la pièce du Conglomérat pulse vers le NOIR', () => {
  const client = fs.readFileSync(path.join(ROOT, 'public/minipixiz/game.js'), 'utf8');
  // spell/imp/Bind : trait blanc 1 px à 75 %, la courbe s'affaisse sous 80 px.
  assert.match(client, /rgba\(255,255,255,0\.75\)/, 'le fil blanc du SWF');
  assert.match(client, /quadraticCurveTo\(cx, cy, f\.x, f\.y\)/, 'et son mou');
  const sorts = fs.readFileSync(path.join(ROOT, 'public/minipixiz/sorts.js'), 'utf8');
  // Conglomerat.mt : modColor(1, cos×40−40) — un assombrissement, pas du rose.
  assert.match(sorts, /couleur: 0x000000/, 'la pulsation est sombre');
  assert.ok(!/0xFF00AA/.test(sorts), 'le rose inventé a disparu');
  const moteur = fs.readFileSync(path.join(ROOT, 'public/minipixiz/engine.js'), 'utf8');
  assert.match(moteur, /o\.e\.melange = null;/,
    'et la pose rend la bille à sa couleur — rien ne colle à la grille');
});

test('les explosions sont celles du jeu : cristaux, flammes, pentacle et rayons', () => {
  const moteur = fs.readFileSync(path.join(ROOT, 'public/minipixiz/engine.js'), 'utf8');
  // Les cristaux sont l'effet d'`Element.explode`, que le moteur ne déclenche
  // que par `exploser()` — c'est-à-dire depuis un SORT. Un paquet de couleur
  // qui casse, lui, ne fait que blanchir (voir le test suivant).
  assert.match(moteur, /evenement\('eclats'/, 'explode() prévient le client');
  const client = fs.readFileSync(path.join(ROOT, 'public/minipixiz/game.js'), 'utf8');
  for (const lien of ['partElementCrystal', 'partFlameBall', 'partBombEplosion',
    'partPentacle', 'partRay']) {
    assert.match(client, new RegExp("nouvellePart\\('" + lien + "'\\)"), lien);
  }
  // Bomb.blast : QUATORZE flammes à poids négatif — elles flottent vers le haut.
  assert.match(client, /i < 14/, 'quatorze flammes');
  assert.match(client, /poids = -\(0\.2 \+ Math\.random\(\) \* 0\.3\)/, 'qui montent');
});

test('le moulin remappe les cinq touches — et le sort revient sur espace', () => {
  // Cm.formatPref : LEFT, RIGHT, SPACE, DOWN, UP — et la souris à faux.
  assert.deepEqual(P.normaliserPref(null).$key, [37, 39, 32, 40, 38]);
  assert.equal(P.normaliserPref(null).$mouse, false);
  // Un slot 1 remappé (le sort sur espace) est honoré tel quel.
  assert.deepEqual(P.normaliserPref({ $key: [37, 39, 38, 40, 32] }).$key,
    [37, 39, 38, 40, 32]);
  // Du bruit → les défauts, champ à champ.
  assert.deepEqual(P.normaliserPref({ $key: 'zut', $mouse: 3 }).$key,
    [37, 39, 32, 40, 38]);
  // Le client applique les rôles par keyCode, et les touches du moulin PRIMENT.
  const client = fs.readFileSync(path.join(ROOT, 'public/minipixiz/game.js'), 'utf8');
  assert.match(client, /poserPref\(p\)/);
  assert.match(client, /this\.prefRoles\[ev\.keyCode\]/);
  assert.match(client, /\$mouse/, 'et le mode souris du jeu d\'origine est là');
  // La page : le panneau, la route du lieu, et l'écriture au slot 1 (le SWF
  // du bureau relit les mêmes préférences).
  const page = fs.readFileSync(path.join(ROOT, 'public/minipixiz/index.html'), 'utf8');
  assert.match(page, /id="moulin"/);
  assert.match(page, /lieu\.va === 'option'.*ouvrirMoulin/);
  assert.match(page, /ecrirePref\(\)/);
  const plate = fs.readFileSync(path.join(ROOT, 'public/minipixiz/plateforme.js'), 'utf8');
  assert.match(plate, /slotId: '1'/, 'les préférences repartent au slot 1');
});

/*
 * ── Le deuxième retour de terrain ────────────────────────────────────────────
 *
 * « la version flash n'affiche pas les nombres de points à chaque coup »
 * « quand un joueur n'a pas de fée, inutile d'afficher le cadre vide »
 * « quand une fée parle, inutile de rafficher son image à côté de la bulle »
 *
 * Trois ajouts de trop, tous les trois inventés par le portage. On les défait,
 * et on rend au jeu ce qu'il faisait à la place — pour la cascade, la VOIX de
 * la fée.
 */

// Le client est un script de navigateur : pas de module.exports, et `window`
// comme point de chute. On le charge dans une fonction dont les paramètres
// masquent les globales — de quoi appeler ses méthodes pour de vrai.
function chargerClient() {
  const src = fs.readFileSync(path.join(ROOT, 'public/minipixiz/game.js'), 'utf8');
  const fenetre = {
    MinipixizLangue: require('../public/minipixiz/langue.js'),
    MinipixizEngine: E,
    MinipixizCombat: C,
  };
  new Function('window', 'document', 'navigator', 'Image', src)(
    fenetre,
    { createElement: () => ({ getContext: () => ({}), width: 0, height: 0 }) },
    { userAgent: '' }, function () {});
  return fenetre.MinipixizClient;
}

// Un pinceau qui note ce qu'on lui demande — et rien de plus.
function pinceauTemoin() {
  const faits = [];
  const rien = () => {};
  return {
    faits,
    ctx: {
      save: rien, restore: rien, beginPath: rien, moveTo: rien, lineTo: rien,
      arcTo: rien, quadraticCurveTo: rien, closePath: rien, clip: rien,
      fill: rien, stroke: rien, rect: rien, translate: rien, scale: rien,
      measureText: (t) => ({ width: String(t).length * 5 }),
      fillText: (t) => faits.push('texte:' + t),
      strokeText: (t) => faits.push('trait:' + t),
      drawImage: () => faits.push('image'),
      fillRect: () => faits.push('rect'),
    },
  };
}

test('une cascade ne montre AUCUN nombre — la fée la commente', () => {
  const client = fs.readFileSync(path.join(ROOT, 'public/minipixiz/game.js'), 'utf8');
  // Le bandeau « chaîne ×N +M » et « couleur terminée ! » n'ont jamais existé :
  // Game.checkFallStats ne fait qu'appeler faerieList[0].fi.reactCombo(sum), et
  // Game.updatecolorList lève un drapeau interne (flColorKill) qui ne sert qu'à
  // couper la recharge de mana du tour.
  assert.ok(!/dessinerMessage/.test(client), 'plus de bandeau de message');
  assert.ok(!/this\.messageT/.test(client), 'ni le compte à rebours qui allait avec');
  assert.ok(!/couleur terminée/.test(client), 'ni l\'annonce de couleur finie');
  assert.ok(!/chaîne ×/.test(client), 'ni le compteur de chaîne');
  assert.match(client, /case 'score': this\.reactCombo\(d\.gagne\); break;/,
    'la cascade appelle reactCombo, comme checkFallStats');

  // Et le comportement, aux seuils de FaerieInfo.reactCombo : rien sous 17,
  // les félicitations au-dessus de 16, l'emballement au-dessus de 36.
  const { Client } = chargerClient();
  const fee = { fs: { $humor: 0, $name: 'Lila' }, carac: [] };
  const essai = (somme) => {
    const dit = [];
    const faux = Object.create(Client.prototype);
    faux.fee = fee;
    faux.dialogue = null;
    faux.parler = (t) => dit.push(t);
    faux.reactCombo(somme);
    return dit;
  };
  assert.deepEqual(essai(16), [], 'seize points : la fée se tait');
  const L = require('../public/minipixiz/langue.js');
  assert.ok(L.COMBO_CHEER[0].includes(essai(17)[0]), 'dix-sept : elle félicite');
  assert.ok(L.SUPER_COMBO_CHEER[0].includes(essai(37)[0]), 'trente-sept : elle s\'emballe');
  // Les deux listes viennent de Lang.mt, une rangée par humeur (0 à 8).
  assert.equal(L.COMBO_CHEER.length, 9);
  assert.equal(L.SUPER_COMBO_CHEER.length, 9);
  const script = fs.readFileSync(path.join(ROOT, 'scripts/extract-minipixiz-lang.js'), 'utf8');
  assert.match(script, /COMBO_CHEER: rangs\('comboCheerList'\)/, 'et elles sont EXTRAITES');
  assert.match(script, /SUPER_COMBO_CHEER: rangs\('superComboCheerList'\)/);
});

test('sans fée, la colonne de droite reste nue', () => {
  const { Client } = chargerClient();
  // base/Forest.launch : `if( fi.isReadyForBattle() ) initFaerieInterface()`.
  // Le cadre du portrait, la goutte de mana et les cœurs naissent ENSEMBLE, à
  // cet instant-là, ou pas du tout. Un pinceau qui hurle au moindre trait le
  // prouve : sans fée, dessinerInterface ne pose rien.
  const faux = Object.create(Client.prototype);
  faux.fee = null;
  faux.sprites = {};
  faux.lieu = null;
  faux.champ = null;
  const hurleur = new Proxy({}, {
    get(_, p) { throw new Error('l\'interface a dessiné sans fée : ' + String(p)); },
  });
  assert.doesNotThrow(() => faux.dessinerInterface(hurleur, 1));
  const client = fs.readFileSync(path.join(ROOT, 'public/minipixiz/game.js'), 'utf8');
  assert.match(client, /isReadyForBattle/, 'et le code dit d\'où vient la règle');
  // Le montant de bois, lui, n'est pas de cette interface : c'est une peau du
  // décor (interfaceRacine), posée à part — la colonne ne devient pas un trou.
  assert.match(client, /interfaceRacine/);
});

test('la bulle de la fée en partie n\'a pas de portrait', () => {
  const { Client } = chargerClient();
  const faux = Object.create(Client.prototype);
  faux.fee = { fs: { $humor: 0, $name: 'Lila' }, carac: [] };
  faux.sprites = {};
  faux.dialogue = { texte: 'Joli coup !', timer: 40 };
  const t = pinceauTemoin();
  faux.dessinerDialogue(t.ctx, 1);
  assert.ok(t.faits.some((f) => f.startsWith('texte:')), 'la bulle porte bien son texte');
  assert.ok(!t.faits.includes('image'),
    'mais aucun médaillon : Dialog.setPic n\'a qu\'un appelant, Menu.attachDialog');
  const client = fs.readFileSync(path.join(ROOT, 'public/minipixiz/game.js'), 'utf8');
  assert.ok(!/portraitDeFee\(this\.sprites, this\.fee/.test(client),
    'le portrait ne se redessine plus à côté de la bulle');
});

test('les noms de lieux sont écrits dans la police du jeu', () => {
  // 1. LA POLICE. « Atlantis » est EMBARQUÉE dans le SWF (DefineFont2 id 165) :
  //    elle n'existe sur aucune machine, et le portage tombait sur Verdana gras
  //    11 px là où le jeu écrit en 32 px. On l'extrait du fichier d'origine.
  const woff = path.join(ROOT, 'public/minipixiz/atlantis.woff');
  assert.ok(fs.existsSync(woff), 'la police extraite est livrée');
  const octets = fs.readFileSync(woff);
  assert.equal(octets.toString('latin1', 0, 4), 'wOFF', 'et c\'est bien un WOFF');
  assert.equal(octets.readUInt32BE(8), octets.length, 'dont l\'en-tête dit la vraie taille');
  assert.ok(octets.length > 5000, 'avec de vrais contours dedans');
  assert.ok(fs.existsSync(path.join(ROOT, 'scripts/extract-swf-font.js')),
    'et l\'extraction est rejouable');

  // 2. LES TITRES, tirés de Menu.initTitleBut — au caractère près, espaces de
  //    fin comprises, et sans accents (la fonte n'en a pas : ses glyphes
  //    accentués sont déclarés mais vides).
  const menu = fs.readFileSync(path.join(ROOT, 'public/minipixiz/menu.js'), 'utf8');
  const source = fs.readFileSync(path.join(ROOT, 'Games/miniTroll/src/Menu.mt'), 'latin1');
  const attendus = [...source.matchAll(/initTitleBut\(\s*\w+\s*,\s*"([^"]*)"\s*\)/g)]
    .map((m) => m[1]);
  assert.ok(attendus.length >= 9, 'les neuf lieux de la clairière');
  const poses = [...menu.matchAll(/titre: '([^']*)'/g)].map((m) => m[1]);
  for (const t of attendus) {
    assert.ok(poses.includes(t), 'le titre « ' + t + ' » est écrit comme dans Menu.mt');
  }
  for (const t of poses) assert.ok(!/[éèêàçùôîï]/.test(t), t + ' : pas d\'accent');

  // 3. LE DESSIN : 32 px, blanc plein, en haut, sans contour — le champ de
  //    mcMenuTitle n'a ni bordure ni ombre.
  assert.match(menu, /const TITRE_FONTE = '32px Atlantis/);
  assert.match(menu, /ctx\.fillStyle = '#ffffff';\s*\n\s*ctx\.fillText\(this\.titre/);
  assert.ok(!/strokeText\(this\.titre/.test(menu), 'aucun liseré autour du titre');
  // Menu.removeTitle : le nom quitté s'éteint en halvant son alpha par image.
  assert.match(menu, /t\.alpha \*= 0\.5/);
  assert.match(menu, /t\.alpha < 2/);

  // 4. LA PAGE la déclare et l'ATTEND : un canevas ne se redessine pas tout
  //    seul quand une police arrive en retard.
  const page = fs.readFileSync(path.join(ROOT, 'public/minipixiz/index.html'), 'utf8');
  assert.match(page, /@font-face \{\s*\n\s*font-family: 'Atlantis';/);
  assert.match(page, /url\('\/minipixiz\/atlantis\.woff'\) format\('woff'\)/);
  assert.match(page, /document\.fonts\.load\('32px Atlantis'\)/);
});

test('l\'ouverture du jeu : l\'écran-titre, puis la clairière dans une ÉTOILE', () => {
  const client = fs.readFileSync(path.join(ROOT, 'public/minipixiz/game.js'), 'utf8');
  const page = fs.readFileSync(path.join(ROOT, 'public/minipixiz/index.html'), 'utf8');

  // 1. LA CADENCE. Le jeu d'origine tourne à QUARANTE images par seconde —
  //    l'en-tête des SWF livrés le dit, et le compteur de mise au point de
  //    Manager.update (`400/Timer.tmod`) affiche 40 pour tmod = 1. Le portage
  //    avançait à trente : un tiers de temps en trop sur chaque chute.
  assert.match(client, /const IPS = 40;/, 'la boucle du jeu compte 40 i/s');
  const menu = fs.readFileSync(path.join(ROOT, 'public/minipixiz/menu.js'), 'utf8');
  assert.match(menu, /const IPS = 40;/, 'la clairière aussi');
  assert.ok(!/dt \* 30/.test(menu), 'plus de trente images par seconde nulle part');
  const zlib = require('zlib');
  for (const f of ['minipixiz.swf', 'full.swf', 'swf/root.swf']) {
    const raw = fs.readFileSync(path.join(ROOT, 'Games/miniTroll', f));
    const b = raw.toString('latin1', 0, 3) === 'CWS' ? zlib.inflateSync(raw.slice(8)) : raw.slice(8);
    const o = Math.ceil((5 + ((b[0] >> 3) & 0x1f) * 4) / 8);
    assert.equal(b.readUInt16LE(o) / 256, 40, f + ' tourne à 40 i/s');
  }

  // 2. L'ÉCRAN-TITRE (sprite « loading ») : fond lavande, logo, bande qui
  //    efface les fioritures, « chargement en cours ». Les deux tracés sortent
  //    du SWF, aux coordonnées de la timeline du sprite.
  for (const f of ['titre-logo.svg', 'titre-bande.svg']) {
    assert.ok(fs.existsSync(path.join(ROOT, 'public/minipixiz', f)), f + ' est livré');
  }
  assert.match(page, /background: #ac9dec/, 'le lavande du fond');
  assert.match(page, /left: 16\.05px; top: 73\.85px/, 'le logo à sa place');
  assert.match(page, /left: 35\.95px; top: 126\.95px/, 'la bande à la sienne');
  assert.match(page, /chargement en cours/);
  assert.match(page, /fillText\('chargement en cours', 47\.95, 140\.25\)/,
    'et la ligne de base du DefineText, décalage du premier glyphe compris');

  // 3. L'OUVERTURE : Manager.connected → fadeSlot("menu", 120, 120). La
  //    clairière ne remplace pas le titre, elle s'ouvre dedans.
  assert.match(page, /function photographierTitre\(\)/);
  assert.match(page, /new window\.MinipixizClient\.Iris\(photoTitre, 120, 120\)/);

  // 4. LA FORME. `slotMask` est une étoile à cinq branches, pas un cercle —
  //    et le portage traçait un cercle dans TOUTES ses transitions.
  assert.ok(!/g\.arc\(cx, cy/.test(client), 'plus de cercle dans l\'iris');
  assert.match(client, /tracerEtoile\(g, cx, cy, k\)/, 'le masque est l\'étoile');
  // slotMaskLight : la même étoile, 1,109 fois pleine et 1,213 fois à moitié.
  assert.match(client, /k \* 1\.213/);
  assert.match(client, /k \* 1\.109/);
  assert.match(client, /return this\.prc <= 100;/, 'et elle est retirée passé 100 %');

  // Le tracé lui-même : cinq pointes, à soixante-douze degrés l'une de l'autre.
  const brut = /const ETOILE = `([^`]*)`/.exec(client);
  assert.ok(brut, 'le tracé est dans le fichier');
  const jetons = brut[1].trim().split(/[\s,]+/);
  const points = [];
  for (let i = 0; i < jetons.length;) {
    const t = jetons[i++];
    if (t === 'Z') continue;
    const n = t === 'Q' ? 4 : 2;
    const v = [];
    for (let k = 0; k < n; k++) v.push(parseFloat(jetons[i++]));
    points.push([v[n - 2], v[n - 1]]);
  }
  // Les sommets sont ARRONDIS — plusieurs points se pressent sur chacun — et le
  // point d'ancrage n'est pas le centre géométrique de l'étoile : on mesure donc
  // depuis le barycentre, et on compte les GROUPES de points éloignés. Il doit
  // y en avoir cinq, chacun bien détaché des autres, le premier droit en haut.
  const cx = points.reduce((s, p) => s + p[0], 0) / points.length;
  const cy = points.reduce((s, p) => s + p[1], 0) / points.length;
  const rayon = ([x, y]) => Math.hypot(x - cx, y - cy);
  const rMax = Math.max(...points.map(rayon));
  const angles = points.filter((p) => rayon(p) > rMax * 0.9)
    .map(([x, y]) => (Math.atan2(x - cx, -(y - cy)) * 180 / Math.PI + 360) % 360)
    .sort((a, b) => a - b);
  const pointes = [];
  for (const a of angles) {
    const derniere = pointes[pointes.length - 1];
    if (derniere && a - derniere[derniere.length - 1] < 30) derniere.push(a);
    else pointes.push([a]);
  }
  // Le tout premier groupe et le tout dernier se rejoignent par-dessus 0°.
  if (pointes.length > 1
    && 360 - pointes[pointes.length - 1][0] + pointes[0][0] < 30) {
    pointes[0] = pointes.pop().concat(pointes[0]);
  }
  assert.equal(pointes.length, 5, 'cinq pointes — une étoile, pas un cercle');
  const milieu = (g) => g.reduce((s, a) => s + (a > 180 ? a - 360 : a), 0) / g.length;
  assert.ok(Math.abs(milieu(pointes[0])) < 6, 'dont la première droit en haut');
});

test('un paquet de couleur qui casse BLANCHIT, il n\'éclate pas', () => {
  // Game.update, case 3 — le pas de destruction, en entier :
  //     timer += Timer.tmod ; blanchir de timer/10 ; si timer > 10 : kill()
  // Rien d'autre. `Token.explode` (les dix cristaux) n'a que trois appelants
  // dans tout le jeu, et ce sont des SORTS : Mass (le Météore qui écrase),
  // LightBolt (les Billes de lumière qui frappent), Dig (le Perce-puits qui
  // creuse). Aucun ne passe par la destruction ordinaire.
  const moteur = fs.readFileSync(path.join(ROOT, 'public/minipixiz/engine.js'), 'utf8');
  // Deux `case ETAPE.DESTRUCTION` existent — celui d'initStep, qui monte la
  // liste, et celui d'update, qui joue l'effacement. C'est le second.
  const pas = /case ETAPE\.DESTRUCTION:(?:(?!case ETAPE)[\s\S])*?this\.timer \+= tmod;[\s\S]*?break;/
    .exec(moteur);
  assert.ok(pas, 'le pas de destruction est là');
  assert.ok(!/evenement\(/.test(pas[0]),
    'il n\'annonce aucun effet : les billes blanchissent et s\'effacent');
  assert.match(pas[0], /for \(const e of this\.dList\) e\.tuer\(\);/);

  // Et le blanchiment JOUE : le commentaire l'a décrit un temps sans que la
  // ligne existe, et les billes disparaissaient d'un coup. On le mesure sur le
  // vrai moteur — la teinte monte, puis les billes s'en vont.
  const jeu = new E.Jeu({ graine: 11, niveau: 0, grille: null });
  for (const [x, y] of [[2, 15], [3, 15], [2, 16], [3, 16]]) {
    jeu.genElement(E.E.JETON, x, y, 0).setType(0);
  }
  jeu.viderGroupes();
  jeu.chercherGroupes();
  jeu.initStep(E.ETAPE.DESTRUCTION);
  const cible = jeu.dList[0];
  assert.ok(cible, 'le paquet part à la destruction');
  assert.equal(cible.eclat, 0, 'la bille est encore de sa couleur');
  const teintes = [];
  for (let i = 0; i < 5; i++) { jeu.update(1); teintes.push(Math.round(cible.eclat)); }
  for (let i = 1; i < teintes.length; i++) {
    assert.ok(teintes[i] > teintes[i - 1],
      'la teinte monte vers le blanc : ' + teintes.join(' → '));
  }
  // Dix images, et il ne reste rien.
  let garde = 0;
  while (jeu.dList.length && garde++ < 30) jeu.update(1);
  assert.equal(jeu.dList.length, 0, 'puis les billes s\'effacent');
  assert.ok(!cible.vivant, 'et quittent la grille');

  // La source de l'original le dit noir sur blanc : `explode()` n'est appelé
  // que par les trois sorts. On le vérifie sur le fichier d'origine.
  const src = path.join(ROOT, 'Games/miniTroll/src');
  const appelants = [];
  for (const f of fs.readdirSync(path.join(src, 'spell'))) {
    if (!f.endsWith('.mt')) continue;
    if (/\.explode\(\)/.test(fs.readFileSync(path.join(src, 'spell', f), 'latin1'))) {
      appelants.push(f.replace('.mt', ''));
    }
  }
  assert.deepEqual(appelants.sort(), ['Dig', 'LightBolt', 'Mass'],
    'et les trois sorts sont bien les seuls');

  // Côté portage, ce sont exactement les trois qui appellent `exploser()`.
  const sorts = fs.readFileSync(path.join(ROOT, 'public/minipixiz/sorts.js'), 'utf8');
  assert.equal((sorts.match(/\.exploser\(\)/g) || []).length, 3,
    'Perce-puits, Météore, Billes de lumière — et personne d\'autre');
  // Et le client ne pose les cristaux que pour un JETON.
  const client = fs.readFileSync(path.join(ROOT, 'public/minipixiz/game.js'), 'utf8');
  assert.match(client, /case 'eclats': \{\s*\n\s*if \(!this\.champ \|\| d\.et !== E\.E\.JETON\) break;/);

  // Le bassin, lui, a bien son effet propre : base/Fountain.onDestroyElement
  // relâche une bulle par bille effacée. C'est le SEUL lieu qui surcharge ce
  // rendez-vous — Base.onDestroyElement est vide.
  const bassin = fs.readFileSync(path.join(ROOT, 'public/minipixiz/bassin.js'), 'utf8');
  assert.match(bassin, /onDestroyElement/);
});
