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
const M = require('../public/minipixiz/menu.js');

function tirage(graine) {
  let s = graine;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

const nb = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// L'inventaire est une classe d'écran : un canevas de paille et le rendu
// débranché suffisent à éprouver sa mécanique.
function fauxInventaire(carte) {
  if (typeof global.window === 'undefined' || !global.window.addEventListener) {
    global.window = { addEventListener() {}, devicePixelRatio: 1 };
  }
  // fee() passe par `racine`, figé au chargement du module : ici c'est
  // globalThis, le fichier ayant été requis avant qu'on invente une fenêtre.
  global.window.MinipixizFee = F;
  globalThis.MinipixizFee = F;
  if (typeof global.document === 'undefined') {
    global.document = { body: { clientWidth: 240, clientHeight: 240 } };
  }
  const ctx = new Proxy({}, {
    get: (o, k) => (k in o ? o[k] : () => {}),
    set: (o, k, v) => { o[k] = v; return true; },
  });
  const canvas = {
    getContext: () => ctx, addEventListener() {}, style: {},
    parentElement: null, width: 0, height: 0,
  };
  const inv = new I.Inventaire({ canvas, plateforme: { carte }, sprites: {} });
  inv.rendre = () => {};
  return inv;
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

/*
 * ── Les SENSATIONS de jeu ────────────────────────────────────────────────────
 *
 * « le jeu est très saccadé, les billes se décalent case par case au lieu de
 *   glisser »
 * « c'est une image qui apparaît lorsqu'ils meurent au lieu de la même image en
 *   fumée qui finit par disparaître »
 * « ma fée ne vole pas dans le menu de base ? »
 *
 * Trois oublis de la même famille : le portage avait porté la LOGIQUE et laissé
 * derrière lui ce qui la rend vivante — la position entre deux cases, la
 * timeline d'un clip, et une fée entière.
 */

test('une bille qui tombe glisse entre ses cases', () => {
  // Game.fall finit par `setPos(e, e.px, e.py + c)` : `c` est la part
  // fractionnaire de la chute. Sans elle, la bille saute de case en case.
  const jeu = new E.Jeu({ graine: 21, niveau: 0, grille: null });
  const t = jeu.genElement(E.E.JETON, 3, 4, 0);
  t.setType(0);
  jeu.preparerChute();
  assert.ok(jeu.fList.includes(t), 'elle n\'a pas de sol : elle tombe');
  const py0 = t.py;
  // Un demi-pas par image : après une image, elle est à MI-CHEMIN.
  jeu.cFall = 0.5;
  jeu.tomber(jeu.cFall);
  assert.equal(t.py, py0, 'sa case n\'a pas encore changé');
  assert.ok(t.decalY > 0 && t.decalY < E.TS,
    'mais elle est déjà descendue de ' + Math.round(t.decalY) + ' px sur ' + E.TS);
  // Et le décalage repart à zéro quand elle change de case.
  jeu.tomber(1);
  assert.equal(t.py, py0 + 1);
  assert.ok(t.decalY < 0.001, 'la case suivante la reprend d\'aplomb');
});

test('la pièce PIVOTE au lieu de claquer', () => {
  const jeu = new E.Jeu({ graine: 7, niveau: 0 });
  let garde = 0;
  while (!jeu.piece && garde++ < 60) jeu.update(1);
  const p = jeu.piece;
  const repos = p.cases().map((c) => Math.round(c.x) + ',' + Math.round(c.y)).join(' ');
  const touche = { gauche: false, droite: false, bas: false, tourner: true };
  p.update(1, touche);
  assert.equal(p.ta, 90, 'le quart de tour est demandé');
  // Piece.update : `base._rotation += da × min(0.5 × tmod, 1)` — l'angle court
  // après sa cible, il ne l'atteint pas d'un coup.
  assert.ok(p.rot > 0 && p.rot < 90, 'l\'angle est en chemin (' + p.rot + '°)');
  const arc = [];
  for (let i = 0; i < 4; i++) { p.update(1, touche); arc.push(Math.round(p.rot)); }
  for (let i = 1; i < arc.length; i++) {
    assert.ok(arc[i] > arc[i - 1], 'et il progresse : ' + arc.join(' → '));
  }
  assert.ok(arc[arc.length - 1] > 85, 'jusqu\'à se poser sur le quart de tour');
  const apres = p.cases().map((c) => Math.round(c.x) + ',' + Math.round(c.y)).join(' ');
  assert.notEqual(apres, repos, 'et les billes ont bougé avec lui');
});

test('un clip à plusieurs images se DÉROULE, comme sous Flash', () => {
  // Sous Flash, un clip attaché joue sa timeline ; il faut un `gotoAndStop`
  // pour l'arrêter, et miniTroll n'en pose que sur l'éclat de pierre et
  // l'icône d'un aliment. Le portage faisait l'inverse.
  assert.ok(C.IMAGES.partDeadImp > 1, 'la fumée d\'un démon a douze images');
  const jeu = new E.Jeu({ graine: 3, niveau: 0, grille: null });
  const champ = new C.Champ(jeu, { fee: null });
  const imp = champ.naitreImpy(0, 60, 60);
  const avant = jeu.partList.length;
  imp.blesser(9999);
  const nees = jeu.partList.slice(avant);
  const fumee = nees.find((p) => p.lien === 'partDeadImp');
  assert.ok(fumee, 'la bouffée est là');
  assert.equal(fumee.joue, true, 'et elle se déroule');
  // Part.update, fadeType 0 (le défaut) : l'échelle fond sur les dix dernières
  // images. C'est la fumée qui se dissipe.
  const images = [], tailles = [];
  for (let i = 0; i < 14; i++) {
    fumee.update(1);
    images.push(fumee.frame + Math.floor(fumee.age));
    tailles.push(Math.round(fumee.sx));
  }
  assert.ok(images[5] > images[0], 'les images défilent : ' + images.join(' '));
  assert.ok(tailles[tailles.length - 1] < tailles[0], 'et la bouffée fond : ' + tailles.join(' '));
  // Une particule à UNE seule image n'a rien à dérouler.
  const cristal = champ.nouvellePart('partElementCrystal');
  cristal.init();
  assert.equal(cristal.joue, false, 'un cristal reste sur son image');
});

test('la fée du joueur vole dans la clairière et sème ses étoiles', () => {
  // Slot.initCursor : un sp.pe.Cursor, c'est-à-dire une VRAIE fée — flBound à
  // faux, et un update réduit à move() puis starFall(0.7). Slot.moveCursor lui
  // donne le pointeur pour cible à chaque image.
  const M = require('../public/minipixiz/menu.js');
  const menu = Object.create(M.Menu.prototype);
  menu.plateforme = { carte: P.carteNeuve() };
  menu.poserFee(F.genererGraine(tirage(9)));
  assert.ok(menu.fee, 'la fée est en vol');
  assert.equal(menu.fee.flBound, false, 'et rien ne la retient aux bords');

  const depart = { x: menu.fee.x, y: menu.fee.y };
  const cible = { x: 220, y: 30 };
  const loin = (p) => Math.hypot(p.x - cible.x, p.y - cible.y);
  const avant = loin(depart);
  menu.fee.trg = cible;
  // Slot.moveCursor lui redonne le pointeur À CHAQUE IMAGE — sans quoi
  // `chooseWay` lui tire une destination au hasard toutes les trente images et
  // elle part vagabonder. Son cap de départ, lui, est tiré au sort comme dans
  // le jeu : ce qui compte n'est pas qu'elle file droit, c'est qu'elle se
  // RAPPROCHE.
  for (let i = 0; i < 120; i++) {
    menu.fee.bouger(1);
    menu.fee.etoiles(0.7, 1);
    menu.fee.trg = cible;
  }
  assert.ok(menu.fee.x !== depart.x || menu.fee.y !== depart.y, 'elle s\'est déplacée');
  assert.ok(loin(menu.fee) < avant,
    'et elle s\'est rapprochée du pointeur (' + Math.round(avant) + ' → '
    + Math.round(loin(menu.fee)) + ')');
  assert.ok(menu.champ.partList.some((p) => p.lien === 'partStar'),
    'et elle laisse une poussière d\'étoiles');

  // La page la (re)pose à chaque retour à la clairière : elle a pu changer.
  const page = fs.readFileSync(path.join(ROOT, 'public/minipixiz/index.html'), 'utf8');
  assert.match(page, /menu\.poserFee\(feeCouranteSeed\(\)\);/);
  // Et le menu la dessine avec le MÊME pinceau que la forêt.
  const src = fs.readFileSync(path.join(ROOT, 'public/minipixiz/menu.js'), 'utf8');
  assert.match(src, /C\.dessinerCreatureSur\(ctx, s, this\.fee\)/);
  assert.match(src, /C\.dessinerPartsSur\(ctx, s, this\.champ\.partList\)/);
});

/*
 * ── La progression de la fée ─────────────────────────────────────────────────
 *
 * « ma fée était à 98 % d'XP, elle a stoppé à 99,9 % jusqu'au niveau 20 »
 * « je ne peux pas donner à ma fée un objet venant de ma collecte »
 */

test('la fée MONTE de niveau : le panneau de choix existe et s\'applique', () => {
  // base/Aventure.tryToCloseGame : à la fin de chaque niveau qui n'est pas un
  // multiple de vingt, si `getNextExpLimit() <= $exp`, le jeu s'arrête sur
  // initExpPanel et fait choisir. C'est la SEULE montée de niveau du jeu ; le
  // portage ne l'avait pas, l'expérience s'entassait sans jamais rien donner.
  const graine = F.genererGraine(tirage(4));
  graine.$level = 0; graine.$carac = [1, 1, 1, 1, 1, 1]; graine.$spell = [];
  const fee = new F.Fee(graine, tirage(4), { $inv: [] });
  const S = require('../public/minipixiz/sorts.js');
  fee.preparerProchainNiveau((f) => S.idAleatoire(f, tirage(8)));
  assert.equal(fee.limiteExp(), 50, 'le premier niveau coûte cinquante points');
  assert.equal(fee.peutMonter(), false, 'à zéro point, rien à choisir');

  fee.incExp(60);
  assert.equal(fee.peutMonter(), true, 'à soixante, elle peut monter');
  const carAvant = graine.$carac[graine.$next[0]];
  const appris = fee.monterNiveau(0, (f) => S.idAleatoire(f, tirage(8)));
  assert.equal(appris.genre, 'carac');
  assert.equal(graine.$level, 1, 'elle est niveau deux');
  assert.equal(graine.$exp, 10, 'et l\'expérience retombe de ce que le niveau coûtait');
  assert.equal(graine.$carac[appris.id], carAvant + 1, 'le point est posé');

  // Le panneau : deux cases, aux mesures d'initExpSlot (±46, +15).
  const src = fs.readFileSync(path.join(ROOT, 'public/minipixiz/game.js'), 'utf8');
  assert.match(src, /ouvrirEvolution\(o\)/);
  assert.match(src, /\(i \* 2 - 1\) \* 46/, 'les deux cases à ±46');
  assert.match(src, /n \+ 1 \+ c\.i \* 10/, 'l\'icône à n+1 pour la carac, n+11 pour le sort');
  // Et la page l'ouvre entre deux niveaux, pas ailleurs.
  const page = fs.readFileSync(path.join(ROOT, 'public/minipixiz/index.html'), 'utf8');
  assert.match(page, /mfXp\.fi\.peutMonter\(\)/);
  assert.match(page, /client\.ouvrirEvolution\(\{/);
  assert.match(page, /monterNiveau\(choix, sortAApprendre\)/);
  // Les dessins du panneau sont extraits du SWF.
  const m = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'public/minipixiz/sprites/sprites.json'), 'utf8'));
  assert.ok(m.expPanneau, 'le panneau');
  assert.ok(m.expChoix, 'la case de choix');
  assert.ok(m.expIcone && m.expIcone.etats.length > 20, 'et la bande d\'icônes');
});

test('un aliment de la collecte se donne DIRECTEMENT à la fée', () => {
  // Inventory.giveItem agit sur l'objet TENU, sans regarder d'où il vient :
  // `setHand` ne retient `flExtra` que pour savoir où le REPOSER. Le portage
  // exigeait un détour par le sac — une règle qui n'existe nulle part.
  const O = require('../public/minipixiz/items.js');
  const carte = P.carteNeuve();
  const graine = F.genererGraine(tirage(3));
  graine.$hunger = 10;
  carte.$faerie = [graine];
  carte.$current = 0;
  const fee = new F.Fee(graine, tirage(3), carte);
  const collecte = [300, null];
  const r = O.donner(carte, { sac: 'extra', case: 0, extra: collecte }, fee);
  assert.equal(r.ok, true, 'le don passe');
  assert.equal(r.effet.genre, 'repas');
  assert.ok(fee.fs.$hunger > 10, 'elle a mangé');
  assert.notEqual(collecte[0], 300, 'et la part entamée reste dans la collecte');

  const inv = fs.readFileSync(path.join(ROOT, 'public/minipixiz/inventaire.js'), 'utf8');
  assert.ok(!/Rangez d\\'abord cet objet dans votre sac/.test(inv),
    'le refus inventé a disparu');
  assert.match(inv, /extra: this\.extraList/, 'et la rangée du bas est passée au don');
});

test('quand la fée reste au sac, le jeu DIT pourquoi', () => {
  // Aventure.initFaerie ne l'emmène que sous `isReadyForBattle`. C'est la règle
  // du jeu et elle ne change pas — mais depuis que la colonne de droite ne
  // dessine plus de cadre vide, son absence était totalement muette : ni fée,
  // ni cadre, ni un mot. Le joueur ne pouvait pas distinguer une règle d'un bug.
  const carte = P.carteNeuve();
  const cas = [
    [{ $life: 0 }, /à bout de forces/],
    [{ $moral: 0 }, /moral/],
    [{ $mood: (() => { const m = []; m[F.ENGOURDIE] = 1; return m; })() }, /engourdie/],
    [{ $mood: (() => { const m = []; m[F.MALADE] = 1; return m; })() }, /malade/],
  ];
  for (const [patch, attendu] of cas) {
    const g = Object.assign(F.genererGraine(tirage(2)), patch);
    const fee = new F.Fee(g, tirage(2), carte);
    assert.equal(fee.preteAuCombat(), false, 'elle ne peut pas suivre');
    assert.match(fee.raisonDeRester(), attendu);
  }
  // Et une fée en forme ne dit rien : elle vient, c'est tout.
  const saine = new F.Fee(F.genererGraine(tirage(2)), tirage(2), carte);
  assert.equal(saine.preteAuCombat(), true);
  assert.equal(saine.raisonDeRester(), null);

  // La clairière l'annonce avant de partir en forêt, et le sac le répète quand
  // on touche son portrait.
  const page = fs.readFileSync(path.join(ROOT, 'public/minipixiz/index.html'), 'utf8');
  assert.match(page, /function feeQuiReste\(\)/);
  // Dit DANS la clairière : `dire` ne fait que poser le texte sur l'écran du
  // menu, et fermer le menu dans la foulée l'effacerait avant qu'on le lise.
  // La tape suivante part quand même — on prévient, on n'interdit pas.
  assert.match(page, /menu\.dire\(resteAuSac\);\s*\n\s*return;/);
  assert.match(page, /raisonDite = resteAuSac;/);
  const inv = fs.readFileSync(path.join(ROOT, 'public/minipixiz/inventaire.js'), 'utf8');
  assert.match(inv, /raisonDeRester \? fee\.raisonDeRester\(\) : null/);
});

test('la clairière coupe ses phrases aux mots plutôt que de déborder', () => {
  // La scène ne fait que 240 pixels : « Il vous faut une clé pour entrer dans
  // le donjon. » sortait déjà des deux côtés avant qu'on ajoute la moindre
  // phrase. On mesure avec une règle simple — six pixels par caractère.
  const ctx = { measureText: (s) => ({ width: s.length * 6 }) };
  const long = 'Lila est malade : elle ne quittera pas le sac aujourd\'hui. Vous partez seul.';
  const lignes = M.couperEnLignes(ctx, long, 224);
  assert.ok(lignes.length > 1, 'la phrase tient sur plusieurs lignes');
  for (const l of lignes) assert.ok(l.length * 6 <= 224, 'aucune ligne ne dépasse : ' + l);
  assert.equal(lignes.join(' '), long, 'aucun mot perdu ni ajouté');

  // Une phrase courte reste sur une seule ligne, telle quelle.
  assert.deepEqual(M.couperEnLignes(ctx, 'Pas de fée.', 224), ['Pas de fée.']);

  // Un mot plus long que la ligne déborde plutôt que d'être coupé en deux.
  assert.deepEqual(M.couperEnLignes(ctx, 'anticonstitutionnellement', 60),
    ['anticonstitutionnellement']);
});

// ── « Elle a mangé à plusieurs reprises » ─────────────────────────────────
//
// Un joueur nourrit sa fée, et elle refuse quand même de venir en forêt. La
// faim et le moral sont DEUX jauges : n'importe quel aliment remplit la
// première, seul un aliment qu'elle aime relève la seconde — et c'est la
// seconde qui décide (`isReadyForBattle`). Le cadran de santé, seul endroit du
// jeu qui montre le moral, ne se lisait qu'au survol : rien sur un téléphone.

test('la faim se remplit avec tout, le moral seulement avec ce qu\'elle aime', () => {
  const carte = { $faerie: [], $current: 0 };
  const fs = F.genererGraine(tirage(3));
  fs.$taste = [[2], [7]];
  fs.$moral = 0; fs.$hunger = 4; fs.$life = 1; fs.$mood = [];
  carte.$faerie.push(fs);
  const fee = new F.Fee(fs, tirage(3), carte);

  assert.equal(fee.preteAuCombat(), false, 'sans moral, elle reste');

  // Un aliment neutre : la faim monte, le moral ne bouge pas.
  fee.manger(5);
  assert.equal(nb(fs.$hunger), 8, 'la faim monte de quatre');
  assert.equal(nb(fs.$moral), 0, 'le moral reste à zéro');
  assert.equal(fee.preteAuCombat(), false, 'elle ne vient toujours pas');

  // Un aliment qu'elle aime : trois points de moral, et elle repart.
  fee.manger(2);
  assert.equal(nb(fs.$moral), 3, 'ce qu\'elle aime vaut trois points');
  assert.equal(fee.preteAuCombat(), true, 'elle accompagne de nouveau');

  // Un aliment qu'elle déteste les reprend.
  fee.manger(7);
  assert.equal(nb(fs.$moral), 0, 'ce qu\'elle déteste retire trois points');

  // La raison annoncée montre le remède, pas seulement le symptôme.
  assert.match(fee.raisonDeRester(), /moral/);
  assert.match(fee.raisonDeRester(), /aime/);
});

test('la fée affamée meurt au bocal et s\'enfuit quand on la porte', () => {
  // FaerieInfo.upkeep, à la lettre : `if(flFree) "morte de faim dans son
  // bocal" else "s'est enfuie car elle avait trop faim"`. Le sens surprend —
  // `flFree` désigne celle qu'on NE porte PAS — et le portage l'avait inversé.
  for (const [libre, attendu] of [[true, /morte de faim dans son bocal/],
    [false, /enfuie car elle avait trop faim/]]) {
    const fs = F.genererGraine(tirage(4));
    fs.$hunger = 0; fs.$life = 0; fs.$moral = 10; fs.$mood = [];
    const fee = new F.Fee(fs, tirage(4), { $faerie: [fs], $current: libre ? null : 0 });
    const r = fee.entretien(libre, null);
    assert.equal(r.partie, true, 'elle quitte la fiche');
    assert.match(r.messages.join(' '), attendu);
  }
});

test('le cadran de santé nomme ses deux aiguilles à la touche', () => {
  // `Mc.makeHint( mc.h0, " faim " )` / `( mc.h1, " moral " )` : deux infobulles
  // au survol dans le SWF, donc rien du tout sur un téléphone.
  const carte = { $faerie: [], $current: 0, $item: [], $bag: 0 };
  const fs = F.genererGraine(tirage(5));
  fs.$moral = 0; fs.$hunger = 12; fs.$life = 1; fs.$name = 'Pikine';
  carte.$faerie.push(fs);

  const inv = fauxInventaire(carte);
  inv.volet = 3;

  const dit = {};
  for (const q of ['vie', 'faim', 'moral']) {
    inv.agir(q);
    dit[q] = inv.titre + ' — ' + inv.message;
  }
  assert.match(dit.vie, /^Pikine — vie 1 \/ /);
  assert.match(dit.faim, /^Pikine — faim 12 \/ 20/);
  assert.match(dit.moral, /^Pikine — moral 0 \/ 20/);
  // Et le moral à zéro dit ce qu'il empêche, puisque c'est lui qui décide.
  assert.match(dit.moral, /ne vous suit plus/);
  assert.match(dit.moral, /aime/);

  // Les trois zones sont bien posées par le volet santé, du bon côté du cadran.
  inv.zones = [];
  inv.rendreVolet(inv.fee());
  const z = {};
  for (const e of inv.zones) if (typeof e.quoi === 'string') z[e.quoi] = e;
  assert.ok(z.faim && z.moral, 'les deux aiguilles sont touchables');
  assert.ok(z.faim.x < z.moral.x, 'la faim est l\'aiguille de gauche');
  assert.ok(z.vie, 'les cœurs aussi');
});

// ── « Ma fée monte d'un niveau et je ne peux cliquer sur rien » ────────────
//
// Le panneau d'évolution s'ouvrait PAR-DESSUS une partie qui continuait de
// tourner. Deux conséquences, invisibles à la souris et fatales au doigt :
//
//  · `brancherToucher` dresse la liste des écrans qui gardent leurs clics
//    (`enJeu`), et le panneau n'y était pas. Le doigt pilotait donc la pièce
//    sous le panneau — et comme `touchstart` appelle `preventDefault()`, le
//    navigateur ne synthétisait même plus le `click` sur lequel le panneau
//    écoute. Plus rien ne répondait. À la souris, tout marchait : d'où des
//    vérifications au vert et un joueur bloqué.
//
//  · la boucle continuait d'avancer le plateau, alors que
//    `Aventure.tryToCloseGame` appelle `game.kill()` AVANT `initStep(3)` :
//    on pouvait perdre la partie en choisissant sa caractéristique.

test('le panneau d\'évolution gèle le plateau et garde ses clics', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/minipixiz/game.js'), 'utf8');

  // 1. La liste d'`enJeu` doit couvrir le panneau — sinon le doigt pilote et
  //    `preventDefault` avale le clic.
  const enJeu = /const enJeu = \(\) =>([\s\S]*?);/.exec(src);
  assert.ok(enJeu, 'enJeu est là');
  assert.match(enJeu[1], /!this\.evolution/,
    'le panneau d\'évolution garde ses clics');

  // 2. Et elle doit rester alignée sur le gestionnaire de `click` : tout écran
  //    qui y est cité doit figurer dans enJeu, sans quoi le défaut revient.
  const clic = /addEventListener\('click', \(ev\) => \{\s*\n\s*if \(([\s\S]*?)\) return;/.exec(src);
  assert.ok(clic, 'le gestionnaire de clic est là');
  for (const ecran of ['carteForet', 'nouvelle', 'ornegon', 'gromelin', 'evolution']) {
    assert.match(clic[1], new RegExp('this\\.' + ecran),
      `le clic connaît ${ecran}`);
    assert.match(enJeu[1], new RegExp('!this\\.' + ecran),
      `et le doigt le laisse tranquille : ${ecran}`);
  }

  // 3. Le plateau ne tourne plus dessous.
  assert.match(src, /\} else if \(this\.evolution\) \{[\s\S]*?this\.reste = 0;/,
    'la boucle gèle le jeu tant que le panneau est ouvert');
});

test('une case d\'évolution sans offre le dit au lieu de rester muette', () => {
  // `setNextLevelUp` ne réserve un sort que s'il en existe un à la portée de la
  // fée — au premier niveau, souvent aucun. La case reste nue comme dans le jeu
  // (mc.e image 60), mais une case nue ET muette sur laquelle on tape sans
  // effet ne se distingue pas d'un écran gelé.
  const src = fs.readFileSync(path.join(ROOT, 'public/minipixiz/game.js'), 'utf8');
  assert.match(src, /'rien à apprendre'/, 'la case vide porte son libellé');
  // Et elle reste inerte au clic : on ne peut pas choisir ce qui n'existe pas.
  assert.match(src, /if \(c\.i === 1 && \(e\.fi\.fs\.\$next\[1\] === null[^)]*\)\) return;/,
    'taper une case sans offre ne choisit rien');
});

// ── « Je la nourris plusieurs fois mais rien ne change » ───────────────────
//
// C'est exact, et c'est la règle du jeu : `FaerieInfo.eat` ne touche QUE la
// faim et le moral. La vie ne remonte que de deux façons — la nuit (`upkeep`
// la ramène à hauteur du ventre plein) ou une potion (it/Potion.incLife). Une
// fée tombée en forêt garde donc zéro de vie jusqu'au lendemain, quoi qu'on
// lui donne à manger.
//
// Le portage est fidèle sur la mécanique ; c'était le MESSAGE qui mentait, en
// disant « nourrissez-la » comme si le repas suffisait.

test('nourrir ne rend pas la vie — et le message ne le promet plus', () => {
  const carte = { $faerie: [], $current: 0 };
  const fs = F.genererGraine(tirage(11));
  fs.$carac = [2, 2, 3, 2, 2, 2];
  fs.$life = 0; fs.$hunger = 4; fs.$moral = 10; fs.$mood = [];
  carte.$faerie.push(fs);
  const fee = new F.Fee(fs, tirage(11), carte);
  fee.carac = fs.$carac.slice();

  // Quatre repas : le ventre se remplit, la vie ne bouge pas d'un pouce.
  for (let i = 0; i < 4; i++) fee.manger(1);
  assert.equal(nb(fs.$hunger), 20, 'la faim monte de quatre par repas, plafond vingt');
  assert.equal(nb(fs.$life), 0, 'mais la vie reste à zéro — comme dans le jeu');
  assert.equal(fee.preteAuCombat(), false, 'elle ne repart donc pas en forêt');

  // Le message doit annoncer la NUIT, pas un effet immédiat.
  const raison = fee.raisonDeRester();
  assert.match(raison, /bout de forces/);
  assert.match(raison, /cette nuit/, 'il dit quand elle se remettra');

  // Et la nuit la remet debout, justement parce qu'elle a mangé.
  fee.entretien(false, null);
  assert.ok(nb(fs.$life) > 0, `la nuit lui rend sa vie (${fs.$life})`);
  const apres = new F.Fee(fs, tirage(11), carte);
  apres.carac = fs.$carac.slice();
  assert.equal(apres.preteAuCombat(), true, 'et elle repart');

  // À jeun, en revanche, la nuit ne rend rien : c'est le ventre qui répare.
  const fs2 = F.genererGraine(tirage(12));
  fs2.$life = 0; fs2.$hunger = 0; fs2.$moral = 10; fs2.$mood = [];
  const fee2 = new F.Fee(fs2, tirage(12), { $faerie: [fs2], $current: 0 });
  fee2.entretien(false, null);
  assert.equal(nb(fs2.$life), 0, 'sans avoir mangé, la nuit ne la relève pas');
});

test('le panneau de santé dit par quoi la vie remonte', () => {
  const carte = { $faerie: [], $current: 0, $item: [], $bag: 0 };
  const fs = F.genererGraine(tirage(13));
  fs.$life = 0; fs.$moral = 10; fs.$hunger = 12; fs.$name = 'Pikine';
  carte.$faerie.push(fs);
  const inv = fauxInventaire(carte);
  inv.volet = 3;
  inv.agir('vie');
  assert.match(inv.message, /^vie 0 \//);
  assert.match(inv.message, /cette nuit/, 'la nourriture agit la nuit');
  assert.match(inv.message, /potion/, 'et la potion tout de suite');

  // Une fée en forme n'a pas besoin de ce rappel.
  fs.$life = 2;
  inv.agir('vie');
  assert.ok(!/potion/.test(inv.message), 'pas de conseil quand tout va bien');
});

// ── « Rester sélectionné pour donner les 3 morceaux » ─────────────────────
//
// Un aliment se donne en trois parts (it.taille : 2, puis 1, puis 0). La main
// se vidait après CHAQUE bouchée : il fallait retourner chercher le même pain
// dans le sac deux fois de plus pour finir la portion. On garde donc en main
// ce qui reste du même aliment, et la case vidée relâche d'elle-même.

test('un aliment reste en main tant qu\'il en reste une part', () => {
  const F2 = require('../public/minipixiz/faerie.js');
  const carte = { $faerie: [], $current: 0, $inv: [300], $bag: 1, $mis: [], $help: [1, 1, 1] };
  const g = F2.genererGraine(tirage(21));
  g.$hunger = 2; g.$life = 2; g.$moral = 10; g.$mood = [];
  carte.$faerie.push(g);

  const inv = fauxInventaire(carte);
  // it.Food.use : la part rétrécit d'un cran à chaque bouchée (300 → 301 →
  // 302) et disparaît à la troisième.
  const part = () => { const o = inv.objetA('joueur', 0); return o ? o.taille : null; };
  assert.equal(part(), 0, 'un pain entier');

  inv.main = { sac: 'joueur', case: 0 };
  inv.agir('portrait');
  assert.equal(part(), 1, 'une bouchée de moins');
  assert.ok(inv.main, 'et le pain reste en main');

  inv.agir('portrait');
  assert.equal(part(), 2, 'la deuxième bouchée');
  assert.ok(inv.main, 'toujours en main');

  inv.agir('portrait');
  assert.equal(inv.objetA('joueur', 0), null, 'le pain est fini');
  assert.equal(inv.main, null, 'et la main se vide toute seule');
});

// ── La cadence : un pas par image, fractionnaire ──────────────────────────
//
// Le portage avançait par pas ENTIERS — quarante `update(1)` par seconde pris
// sur les images du navigateur. Sur un écran de soixante hertz cela donne deux
// tiers de pas par image, donc la cadence 1, 1, 0, 1, 1, 0 : le plateau saute
// une image sur trois. C'est le « stutter » remonté, et c'est aussi ce qui
// rendait le glissement gauche-droite nerveux (0,35 case, 0,35, puis rien)
// quand la ROTATION, qui ne dépend pas du temps, paraissait inchangée.
//
// Flash fait UNE mise à jour par image rendue, avec un `Timer.tmod`
// fractionnaire. On y revient.

test('la boucle avance d\'un pas fractionnaire par image, comme Flash', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/minipixiz/game.js'), 'utf8');
  assert.match(src, /this\.avancerDe = \(cible, tmodTotal\) =>/, 'la boucle a son avanceur');
  // Plus de boucle à pas entiers.
  assert.ok(!/while \(this\.reste >= 1 && pas < 6\)/.test(src),
    'les pas entiers ont disparu');
  assert.match(src, /pas = this\.avancerDe\(this\.jeu, this\.reste\)/,
    'le jeu avance du temps écoulé, pas d\'un nombre de crans');
  // Le pas reste borné : une image très longue ne doit pas traverser le décor.
  assert.match(src, /const MAX = 1\.5;/, 'et un long réveil se découpe');
});

test('l\'aperçu des pièces suit le placement du fichier', () => {
  // inter.Face.newPiece pose chaque bille à `ei.x × size` depuis un x FIXE (18)
  // et centre l'élément dessus (`ei.e.x = -0.5 × size`). Le portage ramenait la
  // pièce sur le coin de sa propre boîte (`o.x - xMin`) : les formes dont les
  // coordonnées partent de -1 sortaient du masque — d'où l'aperçu rogné.
  const src = fs.readFileSync(path.join(ROOT, 'public/minipixiz/game.js'), 'utf8');
  assert.match(src, /zx \+ \(o\.x - 0\.5\) \* NEXT_ZONE\.taille \* k/);
  assert.match(src, /\(o\.y - 0\.5\) \* NEXT_ZONE\.taille \* k/);
  assert.ok(!/zx \+ \(o\.x - xMin\)/.test(src), 'plus de recentrage sur la boîte');

  // Et les formes du jeu ont bien des x négatifs : c'est ce qui débordait.
  const jeu = new E.Jeu({ graine: 5, niveau: 3 });
  const neg = jeu.nextList.some((l) => l.some((o) => o.x < 0));
  assert.ok(neg, 'des pièces s\'étendent à gauche de leur ancre');
});

// ── Le bassin aux fées : « j'ai pu entrer avec ma fée hors de son bocal » ──
//
// Menu.initElements pose DEUX conditions au bassin, et le portage n'avait gardé
// que la première :
//
//     if( $pond.$fs != null ){
//         if( $current == null ) → on descend
//         else                   → mcEnterError, image 2
//     }else → useHandCursor = false
//
// Elle n'est pas décorative : `Cm.freeFaerie` fait `$current = $faerie.length`
// et pousse la nouvelle fée. Plonger avec une fée au bras, c'est donc revenir
// avec une AUTRE, l'ancienne restée en fiche sans main.

test('on ne plonge au bassin qu\'avec une fée en bocal', () => {
  const menuDe = (carte) => Object.create(M.Menu.prototype, {
    plateforme: { value: { carte } },
    carte: { get() { return carte; } },
  });
  const bassin = (carte) => menuDe(carte).etatLieu(M.LIEUX.find((l) => l.nom === 'fountain'));

  const neuve = (patch) => Object.assign(P.carteNeuve(1700000000000), patch);
  const graine = (g) => F.genererGraine(tirage(g));

  // Pas de lueur : le bassin dort, il ne s'ouvre pas et ne refuse rien non plus.
  let e = bassin(neuve({ $pond: { $fs: null } }));
  assert.equal(e.frame, 1, 'le bassin est éteint');
  assert.equal(e.ouvert, false);
  assert.equal(e.feeEnMain, false, 'et il n\'a rien à reprocher au joueur');

  // Une lueur, les mains vides : on descend.
  e = bassin(neuve({ $pond: { $fs: graine(3) }, $faerie: [], $current: null }));
  assert.equal(e.frame, 2, 'la lueur allume le bassin');
  assert.equal(e.ouvert, true, 'et on y descend');

  // Une lueur, MAIS la fée du joueur est en liberté : refus.
  const portee = graine(5);
  e = bassin(neuve({ $pond: { $fs: graine(3) }, $faerie: [portee], $current: 0 }));
  assert.equal(e.frame, 2, 'le bassin brille toujours');
  assert.equal(e.ouvert, false, 'mais on ne descend pas');
  assert.equal(e.feeEnMain, true, 'parce qu\'on a déjà une fée au bras');

  // La même fée rangée dans son bocal : la porte se rouvre.
  portee.$pos = 0;
  e = bassin(neuve({ $pond: { $fs: graine(3) }, $faerie: [portee], $current: null }));
  assert.equal(e.ouvert, true, 'la fée au bocal, on replonge');
});

test('le refus du bassin est celui du SWF, mot pour mot', () => {
  // mcEnterError (#1031) est un clip à trois images, et `initElementButError`
  // en montre la `id+1`. Les textes sont des DefineText : il a fallu décoder
  // les glyphes contre la table de codes de la police pour les relire.
  const html = fs.readFileSync(path.join(ROOT, 'public/minipixiz/index.html'), 'utf8');
  assert.match(html, /Vous avez besoin d\\?'une clé pour entrer dans donjon !!!/);
  assert.match(html, /Vous ne pouvez pas plonger dans le bassin avec une fée en liberté !/);
  assert.match(html, /Ornegon la grenouille ne peut communiquer qu\\?'avec les fées !/);
  // Et le bassin distingue ses deux refus : la lueur absente n'est pas la fée
  // au bras.
  assert.match(html, /if \(etat\.feeEnMain\) \{ menu\.dire\(REFUS\[1\]\); return; \}/);
});

// ── « les boules de feu n'avaient pas de skin » ───────────────────────────
//
// sp/el/FireBall a `link = "fireball"`, et sp.Element.init fait
// `dm.attach(link)`. Le portage n'avait aucun cas pour cet élément dans
// `poserBrut` : il tombait sur `default: break` et ne dessinait rien. La boule
// existait — elle occupait sa case et partait bien en projectile —, mais on
// voyait un trou au centre de la croix.

test('la boule de feu du bassin a son dessin', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/minipixiz/game.js'), 'utf8');
  assert.match(src, /case E\.E\.BOULE:/, 'poserBrut connaît la boule');
  assert.match(src, /rendre\(s\.fireball, f, TS/, 'et il pose le clip `fireball`');

  // Le clip est bien dans le manifeste, avec ses dix-sept images.
  const man = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'public/minipixiz/sprites/sprites.json'), 'utf8'));
  assert.ok(man.fireball, 'le clip `fireball` est extrait');
  assert.equal(man.fireball.etats.length, 17, 'la flamme enfle et retombe en dix-sept images');

  // Et la croix du bassin en pose bien une, au centre. Le compteur repart de
  // zéro : la réserve du jeu a déjà consommé les premières pièces à la
  // construction.
  const B = require('../public/minipixiz/bassin.js');
  const carte = Object.assign(P.carteNeuve(1700000000000), {
    $pond: { $fs: F.genererGraine(tirage(3)), $q: 0 },
  });
  const b = new B.Bassin({ carte, graine: 7 });
  b.bouleTimer = 0;
  const croix = b.fabriquePiece(b.jeu);
  assert.equal(croix.length, 9, 'trois sur trois');
  const centre = croix.find((o) => o.x === 0 && o.y === 0);
  assert.equal(centre.e.et, E.E.BOULE, 'une boule de feu au milieu');
  assert.equal(croix.filter((o) => o.e.et === E.E.JETON).length, 8, 'huit billes blindées autour');
});

test('l\'horloge du clip tourne même quand le plateau ne joue pas', () => {
  // Sous Flash un clip attaché déroule sa timeline au rythme du FILM : la
  // flamme pulse pendant les chutes et les cassures comme pendant le jeu.
  // `mainTimer` ne compte que les images passées à jouer — il fige la flamme
  // dès qu'une cascade démarre. D'où la seconde horloge.
  const B = require('../public/minipixiz/bassin.js');
  const carte = Object.assign(P.carteNeuve(1700000000000), {
    $pond: { $fs: F.genererGraine(tirage(3)), $q: 0 },
  });
  const jeu = new B.Bassin({ carte, graine: 7 }).jeu;
  jeu.step = E.ETAPE.CHUTE;
  const mAvant = jeu.mainTimer, hAvant = jeu.horloge;
  jeu.update(1);
  assert.equal(jeu.mainTimer, mAvant, 'une image de CHUTE ne compte pas dans mainTimer');
  assert.equal(jeu.horloge, hAvant + 1, 'mais elle compte dans l\'horloge du film');
  jeu.update(1); jeu.update(1);
  assert.equal(jeu.horloge, hAvant + 3, 'qui ne s\'arrête jamais');

  // Et chaque boule retient l'instant de son attache : deux boules posées à
  // deux moments ne pulsent pas ensemble.
  const a = new E.Boule(jeu, {});
  jeu.update(5);
  const b2 = new E.Boule(jeu, {});
  assert.ok(b2.ne > a.ne, 'la seconde boule est née plus tard');
});

test('le bassin bleuit tout le plateau, comme Base.elementColor', () => {
  // `elementColor = {prc:16, col:0x0000FF}` dans le constructeur de Fountain,
  // posé par sp.Element.updateSkin sur chaque élément. C'est la seule teinte de
  // mode du jeu, et c'est elle qui met les billes SOUS l'eau.
  const B = require('../public/minipixiz/bassin.js');
  assert.deepEqual(B.TEINTE, { prc: 16, couleur: 0x0000FF });
  const carte = Object.assign(P.carteNeuve(1700000000000), {
    $pond: { $fs: F.genererGraine(tirage(3)), $q: 0 },
  });
  assert.deepEqual(new B.Bassin({ carte, graine: 7 }).teinteElements, B.TEINTE);

  const src = fs.readFileSync(path.join(ROOT, 'public/minipixiz/game.js'), 'utf8');
  assert.match(src, /this\.bassin && this\.bassin\.teinteElements/);
  // Un « sinon » : la destruction REMPLACE la transformation du clip
  // (`new Color(e.skin).setTransform`), elle ne s'y ajoute pas.
  assert.match(src, /\} else if \(this\.bassin && this\.bassin\.teinteElements\) \{/);
});

// ══════════════════════════════════════════════════════════════════════════
//  Le lot du donjon — la capture d'un joueur, et six anomalies derrière
// ══════════════════════════════════════════════════════════════════════════

// ── « L'élément de gauche masque les blocs » ──────────────────────────────
//
// Une forme qui n'est QU'UNE IMAGE n'est pas tracée : on recopie l'image. Mais
// le SVG d'une image porte sa taille en pixels et son coin à zéro, alors que la
// forme, elle, est posée où le SWF veut. Le montant du donjon (#342) est déclaré
// de −14 à 242 ; substitué par son image, il se dessinait de 0 à 256 — quatorze
// pixels trop à droite, assez pour recouvrir la première colonne de billes.

test('les formes remplacées par leur image gardent le cadre du SWF', () => {
  const man = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'public/minipixiz/sprites/sprites.json'), 'utf8'));
  const piece = (cle, frame) => man[cle].etats.find((e) => e.frame === frame).pieces[0];

  // Le montant du donjon : −14, −2 (et non 0, 0).
  assert.deepEqual(piece('cadreDonjon', 2).vb, [-14, -2, 256, 245]);
  // Son fond : −2,25 et la taille de la FORME (138×241), pas celle de l'image.
  assert.deepEqual(piece('cadreDonjon', 3).vb, [-2.25, 0, 138, 241]);
  // L'ascenseur tombait, lui, sur le repli 100 × 100 : `cadre()` lit un
  // viewBox, et un PNG n'en a pas.
  const roues = man.ascenseur.etats[0].pieces.filter((p) => /bitmap800/.test(p.fichier));
  assert.equal(roues.length, 3, 'les trois poulies du treuil');
  for (const r of roues) assert.deepEqual(r.vb, [-1, -1, 96, 102]);
  // Et le panneau de défaite, une image JPEG, se dessinait au quart de sa taille.
  assert.deepEqual(man.panPerdu.etats[0].pieces[0].vb, [0, 0, 240, 240]);
});

// ── Le disque brun sur le panneau de pierre ───────────────────────────────
//
// `dessinerEnteteLieu` décide de dessiner la roue de loterie de l'arc-en-ciel
// sur la seule présence d'un champ `roue` dans l'état du lieu. Le donjon y
// rendait la vitesse de son treuil : la grande roue en bois s'affichait
// par-dessus le panneau de pierre.

test('le donjon ne rend plus un champ « roue »', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/minipixiz/lieux.js'), 'utf8');
  const donjon = src.slice(src.indexOf('class Donjon'), src.indexOf('class Arbre'));
  assert.ok(!/^\s*roue:/m.test(donjon), 'le champ « roue » a quitté le donjon');
  assert.match(donjon, /treuil: this\.wSpeed,/, 'il s\'appelle « treuil »');
  // Et l'entête ne dessine le lot que sur un vrai champ `roue`.
  const jeu = fs.readFileSync(path.join(ROOT, 'public/minipixiz/game.js'), 'utf8');
  assert.match(jeu, /if \(e\.roue === undefined \|\| !s\.roueLot\) return;/);
});

// ── « La partie s'arrête après le premier niveau du donjon » ──────────────
//
// base/Dungeon.setWin : `level+=1` puis `initStep(2)` — les dix étages
// s'enchaînent sans repasser par la clairière, et seul le dixième ferme la
// porte. Le portage rentrait au premier niveau vidé, et la clé était perdue
// pour les neuf autres.

test('le donjon enchaîne ses dix niveaux sans rentrer à la clairière', () => {
  const carte = Object.assign(P.carteNeuve(1700000000000), {
    $key: 1, $dungeon: { $lvl: 1, $f: true, $day: 0, $loop: 0 },
  });
  const graine = F.genererGraine(tirage(9));
  carte.$faerie = [graine]; carte.$current = 0;
  const X = require('../public/minipixiz/lieux.js');
  const d = new X.Donjon({ carte, fee: graine, graine: 5 });

  for (let n = 0; n < 9; n++) {
    assert.equal(d.level, n, 'on est à l\'étage ' + n);
    d.surFinDePartie({ gagne: true });
    assert.equal(d.fini, false, 'l\'étage ' + n + ' vidé n\'arrête pas la partie');
  }
  assert.equal(d.level, 9, 'le dixième et dernier étage');
  d.surFinDePartie({ gagne: true });
  assert.equal(d.fini, true, 'celui-là ferme la porte');
  assert.equal(d.gagne, true);

  // Et la page ne rentre QUE sur un lieu fini.
  const html = fs.readFileSync(path.join(ROOT, 'public/minipixiz/index.html'), 'utf8');
  assert.match(html, /if \(info && info\.gagne && \(!lieu \|\| lieu\.fini\)\) \{/);
});

// ── « Level up : le nom du sort n'apparaît pas » ──────────────────────────
//
// initExpSlot lit le nom sur le SORT — `Spell.newSpell(n).getName()` — et sa
// description en bulle (`Mc.makeHint`, 120 px). Le portage cherchait un champ
// `nom` dans la table de TIRAGE, qui n'en porte pas : il retombait toujours sur
// « un nouveau sort ».

test('le panneau de montée de niveau nomme le sort et le décrit', () => {
  const S = require('../public/minipixiz/sorts.js');
  // La table de tirage ne porte AUCUN nom — c'est bien la classe qu'il faut.
  assert.ok(S.TABLE.every((o) => o.nom === undefined), 'la table de tirage ne nomme rien');
  const cloche = S.nouveauSort(12, null);
  assert.equal(cloche.nom(), 'Cloche d\'immunité');
  assert.match(cloche.description(), /bouclier d'énergie/);

  const src = fs.readFileSync(path.join(ROOT, 'public/minipixiz/game.js'), 'utf8');
  assert.match(src, /const sort = S && S\.nouveauSort \? S\.nouveauSort\(n, null\) : null;/);
  assert.ok(!/S\.TABLE\[n\]\.nom/.test(src), 'plus de lecture dans la table de tirage');
  // Et le résumé des caractéristiques, tiré de Lang.caracResume.
  assert.equal(F.RESUME_CARAC.length, 6);
  assert.match(F.RESUME_CARAC[4], /voir les pièces en avance/);
});

// ── « L'input sort est gardé pendant l'animation » ────────────────────────
//
// `Key.isDown(Cm.pref.$key[4])` n'est SONDÉ que dans `case 2` de Game.update.
// Pendant une chute, une cassure, et surtout pendant l'animation d'un sort
// (étape 4), l'appui n'est ni pris ni mis en attente : il est PERDU.

test('la touche de sort ne s\'entend que pendant qu\'on joue', () => {
  const jeu = new E.Jeu({ graine: 5, niveau: 0 });
  const alea = tirage(11);
  const fsFee = F.genererGraine(alea);
  fsFee.$mana = 8;
  const champ = new C.Champ(jeu, { fee: new F.Fee(fsFee, alea, { $inv: [] }) });
  assert.ok(champ.faerieList[0], 'la fée est en jeu');

  jeu.step = E.ETAPE.JEU;
  assert.equal(jeu.appelerAide(), true, 'en jeu, la fée entend');
  jeu.flAide = false;

  for (const etape of [E.ETAPE.CHUTE, E.ETAPE.DESTRUCTION, E.ETAPE.MAGIE]) {
    jeu.step = etape;
    assert.equal(jeu.appelerAide(), false, 'à l\'étape ' + etape + ', rien');
    assert.equal(jeu.flAide, false, 'et rien n\'est mis en attente');
  }
});

// ── « Le coffre ne tremble plus quand le combo ne l'ouvre pas » ───────────
//
// Element.quake : dix images, trois pixels de rayon, en s'estompant. Deux
// endroits l'appellent — le coffre d'un démon qu'un combo n'ouvre pas (une fois
// sur deux) et la pierre qu'un souffle entame sans casser.

test('ce qui résiste tremble : le coffre et la pierre entamée', () => {
  const jeu = new E.Jeu({ graine: 5, niveau: 0, grille: null });
  const cellule = new E.Cellule(jeu, { px: 2, py: 5, level: 0 });
  cellule.poser();
  // On force la branche qui NE libère PAS l'impy.
  const vraiHasard = jeu.hasard.bind(jeu);
  jeu.hasard = (n) => (n === 2 ? 1 : vraiHasard(n));
  cellule.souffler();
  assert.equal(cellule.vivant, true, 'le coffre tient');
  assert.equal(jeu.secousses.length, 1, 'et il tremble');

  jeu.bougerSecousses(1);
  assert.ok(cellule.decalX !== 0 || cellule.decalY !== 0, 'il bouge dans son rayon');
  assert.ok(Math.hypot(cellule.decalX, cellule.decalY) <= 3.001, 'de trois pixels au plus');

  // Dix images, puis il revient exactement à sa place.
  for (let i = 0; i < 12; i++) jeu.bougerSecousses(1);
  assert.equal(jeu.secousses.length, 0, 'la secousse est finie');
  assert.equal(cellule.decalX, 0);
  assert.equal(cellule.decalY, 0);

  // Une pierre entamée tremble aussi ; une pierre cassée, non — elle n'est plus là.
  const pierre = new E.Pierre(jeu, { px: 3, py: 5, life: 2 });
  pierre.poser();
  pierre.souffler();
  assert.equal(pierre.vivant, true);
  assert.equal(jeu.secousses.length, 1, 'la pierre entamée tremble');
});

// ── « Plus de croix rouge sur la fée blessée » ────────────────────────────
//
// Slot.initCursor appelle `cursor.showStatus()` : vie 0 → NEED_HEAL (la croix
// rouge), moral 0 → NEED_MORAL, puis engourdie et malade. Le clip
// `mcPeopleStatus` porte les quatorze images, et People.updateStatus retient
// la DERNIÈRE vraie.

test('la fée de la clairière porte son panonceau d\'état', () => {
  const jeu = new E.Jeu({ graine: 5, niveau: 0 });
  const alea = tirage(13);
  const faire = (retouche) => {
    const g = F.genererGraine(alea);
    g.$mood = [];
    retouche(g);
    const champ = new C.Champ(jeu, {});
    const fee = champ.naitreFee(new F.Fee(g, alea, { $inv: [] }));
    return fee.montrerStatut();
  };

  let f = faire((g) => { g.$life = 0; });
  assert.equal(f.statut[C.STATUT.SOIN], true, 'sans cœur : la croix rouge');

  f = faire((g) => { g.$life = 3; g.$moral = 0; });
  assert.equal(f.statut[C.STATUT.MORAL], true, 'sans moral : son panonceau');

  f = faire((g) => { g.$life = 3; g.$moral = 8; g.$mood = [1]; });
  assert.equal(f.statut[C.STATUT.ENGOURDIE], true, 'endormie');

  f = faire((g) => { g.$life = 3; g.$moral = 8; g.$mood = [0, 1]; });
  assert.equal(f.statut[C.STATUT.MALADE], true, 'malade');

  f = faire((g) => { g.$life = 3; g.$moral = 8; });
  assert.ok(!f.statut.some(Boolean), 'et rien du tout quand tout va bien');

  // Le clip est extrait, avec ses quatorze images, et le client le pose.
  const man = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'public/minipixiz/sprites/sprites.json'), 'utf8'));
  assert.equal(man.mcPeopleStatus.etats.length, 14);
  const src = fs.readFileSync(path.join(ROOT, 'public/minipixiz/game.js'), 'utf8');
  assert.match(src, /poserVif\(ctx, s\.mcPeopleStatus, image/);
  // Et la clairière l'allume à la naissance, comme Slot.initCursor.
  const menu = fs.readFileSync(path.join(ROOT, 'public/minipixiz/menu.js'), 'utf8');
  assert.match(menu, /fee\.montrerStatut\(\);/);
});

// ── Ce qui est CONFORME, et qu'il ne faut pas « corriger » ────────────────
//
// Deux retours du même lot décrivent le jeu d'origine, pas un défaut. On les
// épingle pour que personne ne les « répare » plus tard.

test('la cloche d\'immunité tombe bien quand on lance un autre sort', () => {
  // spell/Base.cast : `if( caster.currentSpell != null ) currentSpell
  // .emergencyStop()`. Un second sort ARRÊTE le premier — la cloche comprise.
  const src = fs.readFileSync(path.join(ROOT, 'public/minipixiz/sorts.js'), 'utf8');
  assert.match(src, /if \(this\.lanceur\.sortEnCours\) this\.lanceur\.sortEnCours\.arretUrgence\(\);/);
  // Et sa durée : 200 + concentration × 100 images DE JEU (game.step == 2).
  assert.match(src, /this\.timer = 200 \+ nombre\(this\.fi\.carac\[CONCENTRATION\]\) \* 100;/);
  assert.match(src, /if \(this\.jeu\.step === E\.ETAPE\.JEU\) \{\n\s*this\.timer -= tmod;/);
});

test('la mana ne se recharge pas entre deux parties', () => {
  // FaerieInfo.upkeep ne touche jamais à $mana : elle ne remonte que par les
  // combos en partie (Game.checkFallStats → incManaTimer) et d'un coup à la
  // montée de niveau. Perdre en ayant tout dépensé laisse donc la fée à sec.
  const carte = P.carteNeuve(1700000000000);
  const g = F.genererGraine(tirage(17));
  g.$mana = 0; g.$hunger = 20; g.$moral = 10; g.$life = 3; g.$mood = [];
  carte.$faerie = [g];
  const N = require('../public/minipixiz/nuit.js');
  N.entretien(carte, tirage(19));
  assert.equal(carte.$faerie[0].$mana, 0, 'la nuit ne remplit pas la mana');
});
