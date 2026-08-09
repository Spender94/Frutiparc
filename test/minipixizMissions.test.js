/*
 * Minipixiz — le troisième lot de retours Pixiz : la fée en mission, les six
 * missions de Gromelin sous le doigt, le courrier de la clairière, et la
 * rangée des objets à ranger quand le sac déborde.
 *
 * Les références : Mission.mt, Cm.mt (addMission, getCurrentFaerie), inv/Slot.mt
 * (l'échange de bocal et son verrou de mission), it/Flask.mt (l'icône et la
 * description d'une fée partie), Menu.mt (initMsgIcon, displayLog),
 * Inventory.mt (setExtraList, update — la sortie condamnée), Base.mt (grab,
 * tryToClose).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

const N = require('../public/minipixiz/nuit.js');
const P = require('../public/minipixiz/plateforme.js');
const F = require('../public/minipixiz/faerie.js');
const M = require('../public/minipixiz/missions.js');

function tirage(graine) {
  let s = graine;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

function carteNeuve() { return P.carteNeuve(1700000000000); }

function ajouterFee(carte, opts) {
  const o = opts || {};
  const fs = F.genererGraine(tirage(o.graine || 3));
  Object.assign(fs, o.fs || {});
  carte.$faerie.push(fs);
  return fs;
}

// L'inventaire est une classe d'écran : on lui donne un canevas de paille et on
// débranche son rendu — c'est sa MÉCANIQUE qu'on éprouve, pas ses pixels.
function fauxInventaire(carte) {
  if (typeof global.window === 'undefined' || !global.window.addEventListener) {
    global.window = { addEventListener() {}, devicePixelRatio: 1 };
  }
  // fee() passe par racine.MinipixizFee, le chemin du navigateur.
  global.window.MinipixizFee = F;
  if (typeof global.document === 'undefined') {
    global.document = { body: { clientWidth: 240, clientHeight: 240 } };
  }
  const I = require('../public/minipixiz/inventaire.js');
  const ctx = new Proxy({}, {
    get: (o, k) => (k in o ? o[k] : () => {}),
    set: (o, k, v) => { o[k] = v; return true; },
  });
  const canvas = {
    getContext: () => ctx,
    addEventListener() {},
    setPointerCapture() {},
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    style: {},
    parentElement: null,
    width: 0,
    height: 0,
  };
  const inv = new I.Inventaire({ canvas, plateforme: { carte }, sprites: {} });
  inv.rendre = () => {};
  return inv;
}

// ── 1. La fée en mission n'accompagne plus ────────────────────────────────

test('la page ne prend jamais une fée en mission ou en bocal pour la forêt', () => {
  // Cm.getCurrentFaerie ne rend que $faerie[$current] ; dans le SWF une fée en
  // mission est structurellement hors d'atteinte (en bocal, bocal verrouillé).
  // La règle vit dans `plateforme.feeEnMain`, et la forêt, Ornegon et le
  // bassin la lisent tous les trois — c'est le fond de l'affaire, pas le texte
  // de la page : on l'éprouve donc en la faisant tourner.

  // Une fée courante ordinaire s'emmène.
  let c = carteNeuve();
  const libre = ajouterFee(c, { graine: 3 });
  c.$current = 0;
  assert.equal(P.feeEnMain(c), libre, 'la fée courante part en forêt');

  // La même, partie en mission : elle n'est plus là.
  c = carteNeuve();
  ajouterFee(c, { graine: 3, fs: { $mission: 0 } });
  c.$current = 0;
  assert.equal(P.feeEnMain(c), null, 'une fée en mission ne suit pas');

  // La même, rangée dans son bocal : le joueur part seul, et c'est normal.
  c = carteNeuve();
  ajouterFee(c, { graine: 3, fs: { $pos: 0 } });
  c.$current = 0;
  assert.equal(P.feeEnMain(c), null, 'une fée en bocal reste au bocal');

  // Le repli des vieux comptes (sans `$current`) rend la première fée libre…
  c = carteNeuve();
  ajouterFee(c, { graine: 5, fs: { $mission: 1 } });
  const seconde = ajouterFee(c, { graine: 7 });
  c.$current = null;
  assert.equal(P.feeEnMain(c), seconde, 'le vieux compte emmène sa fée libre');

  // …mais s'efface dès qu'une fée dort en bocal : c'est le signe que le joueur
  // a VOULU les mains vides. Sans ça, revenir du bassin emmenait en forêt une
  // ancienne fée à la place de celle qu'on venait de gagner.
  c = carteNeuve();
  ajouterFee(c, { graine: 5, fs: { $pos: 0 } });
  ajouterFee(c, { graine: 7 });
  c.$current = null;
  assert.equal(P.feeEnMain(c), null, 'un bocal occupé coupe le repli');

  // Et la page passe bien par là, pour la forêt comme pour le donjon.
  const html = fs.readFileSync(path.join(ROOT, 'public/minipixiz/index.html'), 'utf8');
  assert.match(html, /return P\.feeEnMain\(plateforme\.carte\);/);
  assert.match(html, /fee: feeCouranteSeed\(\),/);
});

test('l\'échange de bocal tient la main : entrer efface $current, sortir le prend', () => {
  // inv/Slot.mt : `Cm.card.$current = null` à l'entrée, `Cm.card.$current =
  // Cm.getFaerieIndex(fi.fs)` à la sortie. C'est ce va-et-vient qui interdit
  // « en bocal ET en forêt à la fois ».
  const carte = carteNeuve();
  carte.$bag = 1;
  carte.$inv = [30, null];             // un bocal en case 0
  const fee = ajouterFee(carte);
  carte.$current = 0;
  const inv = fauxInventaire(carte);
  inv.ouvrir();

  // La fée courante entre dans le bocal : elle n'est plus « en main ».
  inv.toucher('joueur', 0);
  assert.equal(fee.$pos, 0, 'la fée est dans le bocal de la case 0');
  assert.equal(carte.$current, null, 'entrer en bocal retire la main');

  // La ressortir la remet en main.
  inv.toucher('joueur', 0);
  assert.equal(fee.$pos, null);
  assert.equal(carte.$current, 0, 'sortir du bocal rend la main');
});

test('l\'échange de Slot.mt : la fée du bocal sort, celle qu\'on avait en main y entre', () => {
  const carte = carteNeuve();
  carte.$bag = 1;
  carte.$inv = [30, null];
  const enBocal = ajouterFee(carte, { graine: 3 });
  const enMain = ajouterFee(carte, { graine: 7 });
  enBocal.$pos = 0;
  carte.$current = 1;
  const inv = fauxInventaire(carte);
  inv.ouvrir();

  inv.toucher('joueur', 0);
  assert.equal(enBocal.$pos, null, 'la locataire est sortie');
  assert.equal(carte.$current, 0, 'et elle a pris la main');
  assert.equal(enMain.$pos, 0, 'l\'ancienne main a pris le bocal');
});

test('une fée en mission ne sort pas de son bocal, et le bocal dit quand elle rentre', () => {
  // inv/Slot.mt refuse (`item.fi.fs.$mission==null`), it/Flask.getDesc parle :
  // « … Elle reviendra demain / après-demain / dans N jours. »
  const carte = carteNeuve();
  carte.$bag = 1;
  carte.$inv = [30, null];
  const fee = ajouterFee(carte);
  fee.$pos = 0;
  fee.$mission = 0;
  carte.$mis = [{ $d: 3, $gift: null, $type: 0, $string: '' }];
  const inv = fauxInventaire(carte);
  inv.ouvrir();

  inv.toucher('joueur', 0);
  assert.equal(fee.$pos, 0, 'toujours dans son bocal');
  assert.notEqual(carte.$current, 0, 'et toujours pas en main');
  assert.match(inv.message, /est actuellement en mission\. Elle reviendra dans 3 jours\./);

  carte.$mis[0].$d = 1;
  assert.match(inv.descMission(fee), / demain\.$/);
  carte.$mis[0].$d = 2;
  assert.match(inv.descMission(fee), / après-demain\.$/);
});

test('regarder une fée en bocal ou en mission ne la choisit pas pour la forêt', () => {
  const carte = carteNeuve();
  const rangee = ajouterFee(carte, { graine: 3 });
  ajouterFee(carte, { graine: 7 });
  rangee.$pos = 0;
  carte.$current = 1;
  const inv = fauxInventaire(carte);
  inv.ouvrir();

  inv.agir({ fee: 0 });                // on regarde la fée en bocal
  assert.equal(inv.feeCourante, 0, 'le sac la montre');
  assert.equal(carte.$current, 1, 'mais la forêt garde l\'autre');

  inv.agir({ fee: 1 });                // la fée libre, elle, se choisit
  assert.equal(carte.$current, 1);
});

test('le bocal d\'une fée en mission porte l\'icône, pas la locataire', () => {
  // it/Flask.updatePic : mcIconMission à 360 % — le sprite est sorti du SWF et
  // le sac le pose à la place de la fée.
  const src = fs.readFileSync(path.join(ROOT, 'public/minipixiz/inventaire.js'), 'utf8');
  assert.match(src, /dedans && enMission\(dedans\)/);
  assert.match(src, /iconeMission, 1, taille \* 0\.82 \* 3\.6/);
  const sprites = require(path.join(ROOT, 'public/minipixiz/sprites/sprites.json'));
  assert.ok(sprites.iconeMission, 'le manifeste porte l\'icône de mission');
  assert.ok(fs.existsSync(path.join(ROOT, 'public/minipixiz/sprites',
    sprites.iconeMission.etats[0].pieces[0].fichier)));
});

// ── 2. Les six missions de Gromelin, sous le doigt ────────────────────────

test('les rails dorés du panneau sont les boutons de feuilletage', () => {
  // Dans le fichier, s0/s1 (frame 3 de `mission`) ne sont QUE la bande de
  // 26 × 192 posée en x = 3,75 et 210,25 — aucun glyphe. Les zones du portage
  // couvraient un coin où rien ne se voyait : le joueur ne feuilletait jamais.
  const src = fs.readFileSync(path.join(ROOT, 'public/minipixiz/game.js'), 'utf8');
  assert.match(src, /\{ quoi: 'avant', x: 3\.75, y: 37\.75, l: 26, h: 192 \}/);
  assert.match(src, /\{ quoi: 'apres', x: 210\.25, y: 37\.75, l: 26, h: 192 \}/);
});

test('le panneau écrit ses champs là où le fichier les pose', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/minipixiz/game.js'), 'utf8');
  // fieldTitle : 16 px (fontHeight 320), à gauche, en (5,75 ; 5,95).
  assert.match(src, /bold 16px "Berlin Sans FB Demi"/);
  assert.match(src, /ctx\.fillText\(l, 5\.75, ty\)/);
  // butAccept : un bouton-texte sans plaque, boîte en (57,3 ; 223,3).
  assert.match(src, /'accepter la mission!', 59\.3, 225\.3/);
  assert.match(src, /\{ quoi: 'accepter', x: 57\.3, y: 223\.3, l: 125\.5, h: 16 \}/);
  // La frame 4 remplace le titre par l'en-tête statique du fichier.
  assert.match(src, /'selectionner une ou plusieurs fées', 10\.1/);
  assert.match(src, /'pour cette mission', 10\.1/);
  // fieldPrc à gauche en 120,65 — plus d'alignement à droite inventé.
  assert.match(src, /ctx\.fillText\(prc \+ '%', 120\.65/);
});

test('accepter une mission la retire du carnet et marque les fées parties', () => {
  // Cm.addMission : $mis reçoit {$d,$gift,$type,$string}, chaque fée envoyée
  // prend l'index, et la mission quitte $mission (splice).
  const carte = carteNeuve();
  carte.$stat.$run = 2000;
  const fee = ajouterFee(carte);
  fee.$pos = 0;
  N.genererMissions(carte, tirage(5));
  assert.equal(carte.$mission.length, 6);

  const r = M.accepter(carte, 2, [fee], tirage(9));
  assert.ok(r);
  assert.equal(carte.$mission.length, 5, 'la mission acceptée quitte le carnet');
  assert.equal(fee.$mission, 0, 'la fée porte l\'index de sa mission');
  assert.equal(carte.$mis.length, 1);
  assert.equal(carte.$stat.$misNum, 1);
});

// ── 3. Le courrier ────────────────────────────────────────────────────────

test('les nuits déposent un courrier daté, à côté des messages bruts', () => {
  // Manager.addMsg garde {d, txt} — le jour de la fiche au moment où la
  // nouvelle tombe. passerLeTemps rend les deux formes, alignées.
  const c = carteNeuve();
  const t0 = Number(c.$time.$t);
  const r = N.passerLeTemps(c, t0 + 3 * N.JOUR + 1000, tirage(4));
  assert.equal(r.nuits, 3);
  assert.ok(Array.isArray(r.courrier));
  assert.equal(r.courrier.length, r.messages.length, 'chaque message est daté');
  for (let i = 0; i < r.courrier.length; i++) {
    assert.equal(r.courrier[i].txt, r.messages[i], 'même texte, même ordre');
    assert.ok(Number.isFinite(r.courrier[i].d) && r.courrier[i].d > 0);
  }
  // Les jours ne reculent jamais d'un message au suivant.
  for (let i = 1; i < r.courrier.length; i++) {
    assert.ok(r.courrier[i].d >= r.courrier[i - 1].d);
  }
});

test('la clairière porte l\'enveloppe qui clignote et la lettre du fichier', () => {
  const menu = fs.readFileSync(path.join(ROOT, 'public/minipixiz/menu.js'), 'utf8');
  // Menu.update (MSG BLINK) : la phase avance de 40, modulo 628, et le cosinus
  // fait le battement vers le blanc.
  assert.match(menu, /this\.decalCourrier \+ 40 \* tmod\) % 628/);
  assert.match(menu, /50 \+ Math\.cos\(this\.decalCourrier \/ 100\) \* 50/);
  // L'enveloppe s'accroche au bord droit (msgIcon._x = Cs.mcw) et disparaît
  // pendant la lecture.
  assert.match(menu, /!courrier\.ouvert/);
  assert.match(menu, /SCENE, 0\);/);

  const html = fs.readFileSync(path.join(ROOT, 'public/minipixiz/index.html'), 'utf8');
  // Menu.displayLog : groupé par jour, « Jour N » en gras, et la lettre est le
  // parchemin du clip mcMail avec ses flèches.
  assert.match(html, /<b>Jour ' \+ o\.d \+ '<\/b>/);
  assert.match(html, /shape1039\.svg/);
  assert.match(html, /shape1042\.svg/);
  // Le défilé de bulles d'autrefois a disparu au profit du courrier.
  assert.ok(!/menu\.dire\(msg\.shift\(\)\)/.test(html));

  const sprites = require(path.join(ROOT, 'public/minipixiz/sprites/sprites.json'));
  for (const cle of ['iconeCourrier', 'lettreCourrier', 'flecheCourrier']) {
    assert.ok(sprites[cle], cle + ' est dans le manifeste');
  }
});

// ── 4. La rangée des objets à ranger ──────────────────────────────────────

test('le sac plein, l\'objet ramassé attend dans la rangée au lieu de se perdre', () => {
  // Base.grab : pas de place → itemList.push(type) ; la page relaie le
  // 'perdu' de ramasser vers course.enAttente, et la clairière ouvre le sac.
  const html = fs.readFileSync(path.join(ROOT, 'public/minipixiz/index.html'), 'utf8');
  assert.match(html, /=== 'perdu'/);
  assert.match(html, /course\.enAttente = course\.enAttente \|\| \[\]/);
  assert.match(html, /objetsARanger = course\.enAttente\.slice\(\)/);
  assert.match(html, /inventaire\.setExtraList\(aRanger\)/);
  // Le bouton « retour » passe par la porte condamnable, plus par fermerSac.
  assert.match(html, /\$\('#inv-fermer'\)\.addEventListener\('click', function \(\) \{ inventaire\.fermer\(\); \}\)/);
});

test('la rangée se range, s\'échange, se jette — et la sortie attend la fin', () => {
  const carte = carteNeuve();
  carte.$bag = 1;                      // deux places
  carte.$inv = [301, 302];             // pleines toutes les deux
  const inv = fauxInventaire(carte);
  inv.ouvrir();
  let ferme = 0;
  inv.surFermeture = () => { ferme++; };

  inv.setExtraList([303, 304, 305]);
  assert.equal(inv.extraMax, 3);
  assert.match(inv.message, /Rangez vos nouveaux objets avant de partir!/);

  // Sortie condamnée (Inventory.update : butQuit débranché).
  inv.fermer();
  assert.equal(ferme, 0, 'la porte ne s\'ouvre pas');
  assert.match(inv.message, /Rangez vos nouveaux objets/);

  // Jeter un objet du sac pour faire de la place, y poser un nouveau.
  inv.toucher('joueur', 0);            // en main : l'aliment 301
  inv.jeter();
  assert.equal(carte.$inv[0], null);
  inv.toucher('extra', 0);             // en main : le 303 de la rangée
  inv.toucher('joueur', 0);            // posé dans la case libérée
  assert.equal(carte.$inv[0], 303);
  assert.equal(inv.extraList[0], null);

  // Échange direct : la case occupée du sac contre l'objet de la rangée.
  inv.toucher('extra', 1);
  inv.toucher('joueur', 1);
  assert.equal(carte.$inv[1], 304);
  assert.equal(inv.extraList[1], 302, 'l\'échange rend l\'ancien au comptoir');

  // L'objet rendu à la rangée se jette aussi (c'est souvent le prix de la place).
  inv.toucher('extra', 1);
  inv.jeter();
  assert.equal(inv.extraList[1], null);

  inv.toucher('extra', 2);
  inv.jeter();
  assert.match(inv.message, /Tout est rangé/);

  // Tout est vidé : la porte s'ouvre, et la rangée disparaît.
  inv.fermer();
  assert.equal(ferme, 1);
  assert.equal(inv.extraList, null);
});

test('les flèches feuillettent la rangée un cran à la fois, mains vides', () => {
  const carte = carteNeuve();
  carte.$bag = 1;
  carte.$inv = [301, 302];
  const inv = fauxInventaire(carte);
  inv.ouvrir();
  inv.setExtraList([303, 304, 305, 306, 307, 308]);
  assert.equal(inv.extraMax, 4, 'quatre alvéoles au plus (setExtraList)');

  inv.agir({ extraDefile: 1 });
  assert.equal(inv.extraIndex, 1);
  inv.agir({ extraDefile: 1 });
  inv.agir({ extraDefile: 1 });
  assert.equal(inv.extraIndex, 2, 'borné à length - extraMax (incExtraIndex)');
  inv.agir({ extraDefile: -1 });
  assert.equal(inv.extraIndex, 1);

  // Les mains pleines, la flèche ne répond pas (initExtraArrowBut).
  inv.toucher('extra', 1);
  inv.agir({ extraDefile: -1 });
  assert.equal(inv.extraIndex, 1);
});

test('pendant le rangement, le bocal ne se DÉPLACE plus — mais la fée en sort', () => {
  // inv/Slot.mt, relu de près : « PAS DE MANIP DE FEE EN FIN DE MATCH » ne
  // bloque que le clic qui PREND le bocal habité (le déplacement). L'échange
  // de fée — ESPACE+clic au bureau, l'appui simple ici — passe toujours :
  // `Key.isDown(Key.SPACE)` court-circuite le verrou. Le portage bloquait
  // tout, en silence, et le joueur qui rangeait sa fée « pour un test »
  // pendant la rangée ne pouvait plus l'en sortir sans quitter le sac.
  const carte = carteNeuve();
  carte.$bag = 1;
  carte.$inv = [30, 301];
  const fee = ajouterFee(carte);
  fee.$pos = 0;
  carte.$current = null;
  const inv = fauxInventaire(carte);
  inv.ouvrir();
  inv.setExtraList([303]);

  // L'appui simple : la fée sort, rangement ou pas.
  inv.toucher('joueur', 0);
  assert.equal(fee.$pos, null, 'la fée ressort de son bocal');
  assert.equal(inv.main, null, 'sans que le bocal vienne en main');

  // Elle y retourne du même geste.
  inv.toucher('joueur', 0);
  assert.equal(fee.$pos, 0, 'et y retourne à l\'appui suivant');

  // DÉPLACER le bocal habité, en revanche, attend la fin du rangement — à
  // mains pleines comme au glisser, et le jeu le dit au lieu de se taire.
  inv.main = { sac: 'extra', case: 0 };
  inv.toucher('joueur', 0);
  assert.equal(carte.$inv[0], 30, 'le bocal n\'a pas bougé');
  assert.match(inv.message, /Rangez vos nouveaux objets/, 'et le jeu explique');
  inv.main = null;
  inv.zones = [];
  inv.zoneRect({ sac: 'joueur', case: 0 }, 45, 58, 32, 32);
  inv.doigtPose({ clientX: 61, clientY: 74 });
  inv.doigtBouge({ clientX: 70, clientY: 84 });
  assert.equal(inv.glisse, null, 'le glisser est retenu');
  assert.match(inv.message, /Rangez vos nouveaux objets/, 'avec la même explication');
});

test('la rangée NOURRIT sans détour, mais n\'équipe pas une fée', () => {
  const carte = carteNeuve();
  carte.$bag = 1;
  carte.$inv = [301, null];
  ajouterFee(carte);
  carte.$current = 0;
  const inv = fauxInventaire(carte);
  inv.ouvrir();
  inv.setExtraList([303]);

  // Inventory.giveItem agit sur l'objet TENU, sans regarder d'où il vient :
  // `setHand` ne retient `flExtra` que pour savoir où le REPOSER. Exiger un
  // passage par le sac était une règle inventée — elle obligeait à libérer une
  // case avant de pouvoir nourrir.
  inv.toucher('extra', 0);
  inv.donnerALaFee();
  assert.notEqual(inv.extraList[0], 303, 'l\'aliment a bien été entamé');
  assert.ok(!/Rangez d'abord/.test(inv.message), 'plus de refus : ' + inv.message);

  // Vers le sac d'une fée : refusé — la rangée ne cause qu'avec le sac.
  const bouge = inv.deplacerExtra({ sac: 'extra', case: 0 }, { sac: 0, case: 0 });
  assert.equal(bouge, false);
});

test('la flèche de la rangée est sortie du fichier (bouton 682, forme 680)', () => {
  const sprites = require(path.join(ROOT, 'public/minipixiz/sprites/sprites.json'));
  assert.ok(sprites.flecheExtra, 'flecheExtra est dans le manifeste');
  assert.equal(sprites.flecheExtra.etats[0].pieces[0].fichier, 'shape680.svg');
  assert.ok(fs.existsSync(path.join(ROOT, 'public/minipixiz/sprites/shape680.svg')));
});

// ── « Au moment de choisir une mission, tout est vide » ────────────────────
//
// Accepter une mission RETIRE l'offre de la liste — `accepter` la splice, comme
// Cm.addMission — et les six ne se renouvellent qu'à la nuit, et seulement si
// le joueur a assez couru. Prendre les dernières vide donc le tableau.
//
// Or le test d'entrée de Gromelin est `!carte.$mission`, et un tableau VIDE
// n'est pas `null` : il passait. Gromelin promettait du travail (« J'ai
// peut-être du boulot pour X... Rentre donc à l'intérieur ») puis ouvrait le
// panneau sur un parchemin nu, sans un mot. Le jeu d'origine a le même trou —
// son `Cm.card.$mission == null` ne couvre pas davantage l'array vide.

test('Gromelin n\'ouvre pas son panneau sur une liste d\'offres vide', () => {
  const E = require('../public/minipixiz/engine.js');
  const carte = P.reparer(null).carte;
  carte.$stat.$run = 5000;                 // il a assez couru pour intéresser Gromelin
  carte.$help = [1, 1, 1];                 // ce n'est pas sa première visite
  const fee = F.genererGraine(E.generateur(4));
  fee.$pos = 0;                            // en bocal : la seule sorte qu'il accepte
  carte.$faerie = [fee];
  carte.$current = null;
  carte.$item = [30];
  N.genererMissions(carte, E.generateur(9));

  assert.equal(carte.$mission.length, 6, 'six offres au départ');
  assert.equal(M.accueil(carte, 0.5, true).missions, true, 'il propose du travail');

  // Le joueur prend tout ce qu'il peut, jour après jour.
  for (let i = 6; i > 0; i--) {
    M.accepter(carte, 0, [fee], E.generateur(i), true);
    fee.$mission = null;                   // elle revient, et repart
  }
  assert.equal(carte.$mission.length, 0, 'la liste est vidée');

  const a = M.accueil(carte, 0.5, true);
  assert.equal(a.ouvre, true, 'il est là, et il ouvre : ce n\'est pas la nuit');
  assert.equal(a.missions, false, 'mais il n\'ouvre PAS le panneau sur du vide');
  assert.match(a.dial.join(' '), /plus rien/, 'et il dit pourquoi');
  // Surtout : il ne promet plus ce qu'il n'a pas.
  assert.ok(!/Rentre donc/.test(a.dial.join(' ')), 'il ne fait plus entrer pour rien');

  // Et la nuit lui rend du travail.
  N.genererMissions(carte, E.generateur(21));
  fee.$mission = null;
  assert.equal(M.accueil(carte, 0.5, true).missions, true, 'les offres reviennent');
});

test('le panneau des missions ne reste jamais muet', () => {
  // Ceinture et bretelles : même si une fiche ancienne menait au panneau avec
  // une liste vide, l'écran doit dire ce qu'il en est plutôt que de rester nu.
  const src = fs.readFileSync(path.join(ROOT, 'public/minipixiz/game.js'), 'utf8');
  assert.match(src, /if \(!info && g\.etape === 2\) \{/,
    'le cas « aucune offre à afficher » est traité');
  // Les apostrophes sont échappées dans la source : on les accepte des deux
  // façons plutôt que de figer une graphie.
  assert.match(src, /Gromelin n\\?'a plus rien à proposer aujourd\\?'hui/,
    'et il l\'écrit sur le parchemin');
});
