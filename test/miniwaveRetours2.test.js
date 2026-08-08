/*
 * Deuxième vague de retours joueurs sur Miniwave light — chaque correction
 * vérifiée contre le comportement du SWF d'origine (Games/miniWave2/class).
 *
 *   1. La bombe du Pastaga ($ship02) ne faisait qu'un projectile : Shot.as
 *      case 6 fait SAUTER le missile au rappel du tir, et onKill (case 6)
 *      pose l'explosion de zone — behaviour 7, raySpeed 12, frict 0.85,
 *      timer 22 — qui fauche tout ce qu'elle couvre. Par où que le missile
 *      meure (rappel, contact, sortie d'écran), le souffle part.
 *   2. Le rayon de la Cosmirabelle ($bads23) ne touchait « que la boule » :
 *      Mirabelle.as donne au tir un killMargin égal à la longueur du rayon
 *      (160) — avec la marge ordinaire de 20, le rayon disparaissait avant
 *      d'avoir balayé la ligne du vaisseau.
 *   3. Le missile du Kamikaze ($bads4) se figeait en pleine plongée dès que
 *      l'escadre changeait d'étape : les update() du SWF tournent à CHAQUE
 *      image, quelle que soit l'étape.
 *   4. Le drop « vaisseau » de la soucoupe montrait l'Aliquet : Opt.as tire
 *      l'identité AU LARGAGE (random(5) → vaisseaux 1 à 5) et l'affiche.
 *   5. La carte bleue ne faisait rien : Shot.as case 25 fait exploser tout
 *      ennemi resté sous le front de l'onde qui monte.
 *   6. Le rayon du Cherry fauchait une colonne de 12 px : le gfx du SWF fait
 *      40 px à pleine échelle, et la largeur suit la rampe de Cherry.update.
 *   7. L'étoile du Coing ($bads10) ne tournait pas : le clip du SWF l'anime —
 *      le moteur porte désormais la toupie (vitRot), le rendu la pose.
 *   8. La bombe du Pamplemousse ($bads8) se tirait mal : sa cible est
 *      l'enveloppe du clip (halo compris), pas les 4 px d'un tir nu.
 *   9. Les aspects des tirs spéciaux (gotoAndStop 150-165 du SWF) sont posés
 *      par le moteur et rendus par le client.
 *  10. Les volumes du SWF : bips de vague à 25, laser ennemi à 20, jingle à
 *      80 — et une couche audio qui ne s'effondre pas sur iPhone.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const E = require(path.join(ROOT, 'public/miniwave/engine.js'));
const NIVEAUX = require(path.join(ROOT, 'public/miniwave/levels.json'));
const ARCADE = NIVEAUX.main[0].levels;

function partie(o) {
  o = o || {};
  const journal = [];
  const jeu = new E.Game({
    levels: ARCADE,
    graine: o.graine === undefined ? 7 : o.graine,
    ship: o.ship,
    onEvent: (n, d) => journal.push({ n, d }),
  });
  return { jeu, journal };
}

function jusquAuCombat(jeu) {
  for (let i = 0; i < 600 && jeu.step !== E.ETAPE.COMBAT; i++) jeu.update(1);
  assert.equal(jeu.step, E.ETAPE.COMBAT, 'le combat est engagé');
}

// Remplace l'escadre du niveau par des figurants posés là où le test les veut.
// `toKill` doit suivre : à zéro, le niveau avancerait et nettoyerTirs (fidèle à
// cleanShots) balaierait les tirs qu'on observe.
function poserFigurants(jeu, liste) {
  while (jeu.badsList.length > 0) jeu.badsList[0].tuer();
  const nes = liste.map((o) => jeu.newBads(o.type === undefined ? 0 : o.type,
    Object.assign({ waveId: 0, lineId: 0, wpTimer: -1, flWave: false }, o)));
  for (const b of nes) b.flReady = true;
  jeu.toKill = jeu.badsList.length + 1;   // le +1 tient le niveau ouvert
  return nes;
}

// ── 1. La bombe du Pastaga ────────────────────────────────────────────────

test('le missile du Pastaga saute au rappel du tir et laisse son souffle', () => {
  const { jeu, journal } = partie({ ship: 2 });
  jusquAuCombat(jeu);
  const h = jeu.hero;
  assert.equal(h.type, 2, 'le Pastaga est aux commandes');

  // La spéciale part pouce posé (tir maintenu) : le missile ne doit PAS
  // sauter tout de suite — il s'arme au relâcher.
  jeu.entree.tir = true;
  h.bombe();
  const missile = jeu.hShotList.find((t) => t.behaviourId === 6);
  assert.ok(missile, 'le missile est parti');
  assert.equal(missile.aspect, 152, 'avec son aspect propre (gotoAndStop 152)');
  assert.equal(missile.vity, -2, 'à la vitesse de Pastaga.bomb');
  jeu.update(1);
  jeu.update(1);
  assert.ok(missile.vivant, 'tir maintenu : le missile monte toujours');

  // Relâcher puis rappuyer : il saute (Shot.as case 6 — Key.isDown du tir).
  jeu.entree.tir = false;
  jeu.update(1);
  assert.ok(missile.vivant, 'relâché : il monte encore');
  jeu.entree.tir = true;
  jeu.update(1);
  assert.ok(!missile.vivant, 'rappuyé : il saute');

  // Le souffle est là, avec les chiffres de Shot.onKill case 6.
  const souffle = jeu.hShotList.find((t) => t.behaviourId === 7);
  assert.ok(souffle, 'l\'explosion de zone est posée');
  assert.equal(souffle.aspect, 153, 'l\'aspect de l\'explosion');
  assert.equal(souffle.behaviourInfo.raySpeed, 12, 'raySpeed 12 (Pastaga, pas Pommette)');
  assert.equal(souffle.behaviourInfo.frict, 0.85, 'frict 0.85');
  assert.equal(souffle.behaviourInfo.timer, 22, 'timer 22');
  assert.ok(journal.some((e) => e.n === 'missileExplose'), 'et le client saura le sonoriser');
});

test('le souffle du missile fauche les ennemis alentour — l\'effet bombe', () => {
  const { jeu } = partie({ ship: 2 });
  jusquAuCombat(jeu);
  const h = jeu.hero;

  // Trois ennemis autour du point d'explosion, un autre loin.
  const nes = poserFigurants(jeu, [
    { x: 120 - 14, y: 100 }, { x: 120, y: 100 }, { x: 120 + 14, y: 100 },
    { x: 20, y: 100 },
  ]);
  const pres = nes.slice(0, 3);
  const loin = nes[3];

  // Le missile monte jusqu'à hauteur du groupe, puis on le fait sauter.
  jeu.entree.tir = false;
  h.flBomb = true;
  h.bombe();
  const missile = jeu.hShotList.find((t) => t.behaviourId === 6);
  missile.x = 120;
  missile.y = 100;
  jeu.entree.tir = true;
  jeu.update(1);
  assert.ok(!missile.vivant, 'le missile a sauté sur place');

  // Le souffle grandit : quelques images plus tard, les trois proches sont
  // fauchés, le lointain respire encore.
  for (let i = 0; i < 8; i++) jeu.update(1);
  for (const b of pres) assert.ok(!b.vivant, 'l\'ennemi sous le souffle est fauché');
  assert.ok(loin.vivant, 'l\'ennemi hors du souffle survit');
});

test('le missile explose aussi au contact d\'un ennemi', () => {
  const { jeu } = partie({ ship: 2 });
  jusquAuCombat(jeu);
  const h = jeu.hero;
  const cible = jeu.badsList[0];
  assert.ok(cible, 'une escadre est en place');

  jeu.entree.tir = false;
  h.bombe();
  const missile = jeu.hShotList.find((t) => t.behaviourId === 6);
  missile.x = cible.x;
  missile.y = cible.y;
  jeu.update(1);
  assert.ok(!missile.vivant, 'le contact l\'a fait sauter');
  assert.ok(jeu.hShotList.some((t) => t.behaviourId === 7), 'et le souffle est parti');
});

// ── 2. Le rayon de la Cosmirabelle ────────────────────────────────────────

test('le rayon de la Cosmirabelle vit 160 px sous l\'écran et balaie le vaisseau', () => {
  const { jeu } = partie();
  jusquAuCombat(jeu);
  const h = jeu.hero;
  poserFigurants(jeu, [{ x: 30, y: 40 }]);   // le niveau reste ouvert
  h.newShield = undefined;             // plus d'invulnérabilité d'apparition
  h.flLine = true;

  // Le scénario du retour joueur : on ESQUIVE la boule (elle tombe à côté),
  // elle sort de l'écran… et on revient se placer sous la colonne — où la
  // queue du rayon, longue de 160 px, balaie encore. Avec l'ancienne marge de
  // 20 px, le tir était déjà mort : « le collider n'est que sur la boule ».
  const colonne = 120;
  h.x = 60;                            // à l'abri pendant la descente
  const tir = jeu.newBShot({
    x: colonne, y: 40, vitx: 0, vity: 4, badsType: 23,
    behaviourId: 5, behaviourInfo: { length: 160, parcouru: 0, sx: colonne, sy: 40 },
    killMargin: 160,
  });
  assert.equal(tir.killMargin, 160, 'Mirabelle.as : killMargin = la longueur du rayon');

  // La boule traverse et sort (killMargin ordinaire dépassé, rayon vivant).
  for (let i = 0; i < 80 && tir.y <= E.HAUTEUR + 24; i++) { jeu.update(1); h.x = 60; }
  assert.ok(tir.vivant, 'sorti de l\'écran de plus de 20 px, le tir vit encore');
  assert.ok(tir.y > E.HAUTEUR + 20, 'la boule est bien dehors (' + Math.round(tir.y) + ')');

  // Le pilote se replace sous la colonne : la queue du rayon le fauche.
  h.x = colonne;
  const hpAvant = h.hp;
  let touche = false;
  for (let i = 0; i < 30 && tir.vivant && !touche; i++) {
    jeu.update(1);
    h.x = colonne;
    touche = (h.hp < hpAvant) || !!h.newShield;
  }
  assert.ok(touche, 'la queue du rayon touche encore, boule dehors');
  for (let i = 0; i < 80 && tir.vivant; i++) jeu.update(1);
  assert.ok(!tir.vivant, 'et le tir finit par mourir, à 160 px sous le bord');
});

test('un tir ordinaire meurt toujours à 20 px du bord — la marge n\'a pas bougé', () => {
  const { jeu } = partie();
  jusquAuCombat(jeu);
  const tir = jeu.newBShot({ x: 120, y: E.HAUTEUR - 2, vitx: 0, vity: 4 });
  for (let i = 0; i < 30 && tir.vivant; i++) tir.update(1);
  assert.ok(!tir.vivant, 'mort');
  assert.ok(tir.y < E.HAUTEUR + 30, 'sans traîner au-delà de la marge de 20');
});

// ── 3. Le missile du Kamikaze ─────────────────────────────────────────────

test('la plongée du Kamikaze continue même quand l\'escadre bat en retraite', () => {
  const { jeu } = partie();
  jusquAuCombat(jeu);
  const [b] = poserFigurants(jeu, [{ type: 4, x: 120, y: 60 }]);
  b.mode = 1; b.vity = 0; b.flWave = false;   // plongée déclenchée

  // L'escadre repasse en phase d'ARRIVÉE (le vaisseau vient de mourir) : le
  // missile, lui, ne s'arrête pas en l'air.
  jeu.step = E.ETAPE.ARRIVEE;
  const y0 = b.y;
  b.update(1);
  b.update(1);
  assert.ok(b.y > y0 + 1, 'il tombe toujours (les update() du SWF tournent à chaque image)');

  // Et la chute suit la rampe de Citron.update : +0.5 par image, plafond 8.
  jeu.step = E.ETAPE.COMBAT;
  let vMax = 0;
  let t = 0;
  while (b.vivant && t++ < 100) { b.update(1); vMax = Math.max(vMax, b.vity); }
  assert.ok(Math.abs(vMax - 8) < 0.01, 'plafond de 8 px par image');
  assert.ok(!b.vivant, 'et il sort par le bas');
});

// ── 4. Le drop « vaisseau » de la soucoupe ────────────────────────────────

test('le bonus vaisseau choisit sa silhouette au largage — jamais l\'Aliquet', () => {
  const vus = new Set();
  for (let graine = 0; graine < 40; graine++) {
    const jeu = new E.Game({ levels: ARCADE, graine });
    const vieType = E.BONUS.findIndex((b) => b.nom === 'vie');
    const o = new E.Opt(jeu, { x: 120, y: 40, type: vieType });
    assert.ok(o.shipId >= 1 && o.shipId <= 5,
      'le vaisseau annoncé est un des cinq à gagner (jamais 0, l\'Aliquet)');
    vus.add(o.shipId);

    // Et c'est CE vaisseau qui rejoint l'escadron au ramassage.
    const avant = jeu.heroList.length;
    o.ramasser();
    assert.equal(jeu.heroList.length, avant + 1, 'une vie de plus');
    assert.equal(jeu.heroList[0], o.shipId, 'celle du vaisseau montré');
  }
  assert.ok(vus.size >= 3, 'le tirage varie selon la graine (' + [...vus].join(',') + ')');
});

// ── 5. La carte bleue ─────────────────────────────────────────────────────

test('la carte bleue : l\'onde qui monte fait exploser tout ce qu\'elle dépasse', () => {
  const { jeu, journal } = partie();
  jusquAuCombat(jeu);
  const [haut, bas] = poserFigurants(jeu, [{ x: 60, y: 40 }, { x: 180, y: 160 }]);

  const scoreAvant = jeu.score;
  const onde = jeu.newHShot({
    x: E.LARGEUR / 2, y: 200, vitx: 0, vity: -10,
    flIndestructible: true, behaviourId: 25, aspect: 165,
  });
  // L'onde monte de 10 px par image : elle dépasse l'ennemi bas (y 160) en
  // quelques images — le haut (y 40) attend son tour.
  for (let i = 0; i < 6; i++) jeu.update(1);
  assert.ok(!bas.vivant, 'l\'ennemi bas, dépassé par l\'onde, a explosé');
  assert.ok(haut.vivant, 'celui du haut attend son tour');
  for (let i = 0; i < 30 && onde.vivant; i++) jeu.update(1);
  assert.ok(!haut.vivant, 'l\'onde est montée : plus personne');
  assert.ok(jeu.score > scoreAvant, 'et chaque explosion a payé ses points');
  assert.ok(journal.some((e) => e.n === 'badsExplose'), 'en explosant pour de vrai');
});

// ── 6. Le rayon du Cherry ─────────────────────────────────────────────────

test('le rayon du Cherry s\'ouvre à 40 px et fauche sur toute sa largeur', () => {
  const { jeu } = partie({ ship: 5 });
  jusquAuCombat(jeu);
  const h = jeu.hero;
  const [bord, hors] = poserFigurants(jeu,
    [{ x: h.x + 15, y: 100 }, { x: h.x + 30, y: 100 }]);

  jeu.entree.gauche = false; jeu.entree.droite = false;
  h.bombe();
  assert.equal(h.laser, 40, 'le rayon est ouvert pour 40 images');

  // Rampe du SWF : la colonne s'élargit en dix images jusqu'à 40 px.
  h.update(1);
  assert.ok(h.laserDemi < 3, 'à peine ouvert, il est étroit');
  for (let i = 0; i < 12; i++) h.update(1);
  assert.ok(Math.abs(h.laserDemi - 20) < 0.5, 'pleine largeur : 20 px de part et d\'autre');
  assert.ok(!bord.vivant, 'l\'ennemi à 15 px de l\'axe est fauché');
  assert.ok(hors.vivant, 'celui à 30 px est hors du faisceau');

  for (let i = 0; i < 40; i++) h.update(1);
  assert.ok(h.laser <= 0 && !(h.laserDemi > 0), 'éteint, il ne fauche plus');
  assert.equal(h.speed, 3, 'et le vaisseau retrouve sa vitesse');
});

// ── 7. L'étoile du Coing ──────────────────────────────────────────────────

test('l\'étoile du Coing tourne sur elle-même (la toupie du clip du SWF)', () => {
  const { jeu } = partie();
  jusquAuCombat(jeu);
  const [b] = poserFigurants(jeu, [{ type: 10, x: 120, y: 60 }]);
  b.tirer();
  const t = jeu.bShotList[jeu.bShotList.length - 1];
  assert.equal(t.vitRot, 12, '12 degrés par image, la cadence du clip');
  t.update(1);                          // le premier tour amorce l'angle
  const r0 = t.rot;
  assert.ok(r0 !== undefined, 'l\'angle est amorcé sur l\'orientation du tir');
  t.update(1);
  t.update(1);
  assert.ok(Math.abs((t.rot - r0) - 2 * 12 * Math.PI / 180) < 1e-9,
    'l\'angle avance de 12° par image — le rendu n\'a qu\'à le poser');
});

// ── 8. La bombe du Pamplemousse ───────────────────────────────────────────

test('la bombe du Pamplemousse se tire sur son enveloppe, pas sur un point', () => {
  const { jeu } = partie();
  jusquAuCombat(jeu);
  const [b] = poserFigurants(jeu, [{ type: 8, x: 120, y: 60 }]);
  b.tirer();
  const bombe = jeu.bShotList.find((t) => t.behaviourId === 0);
  assert.ok(bombe, 'la bombe est lâchée');
  assert.equal(bombe.ray, 6, 'sa cible est l\'enveloppe du clip (halo compris)');

  // Un tir du vaisseau qui frôle à 5 px la fait éclater — avec l'ancien rayon
  // de 4, il passait au travers.
  const tir = jeu.newHShot({ x: bombe.x + 5, y: bombe.y, vitx: 0, vity: 0, flStandardHeroShot: true });
  bombe.update(1);
  assert.ok(!bombe.vivant, 'éclatée');
  assert.ok(!tir.vivant, 'le tir y est passé');
  const eclats = jeu.bShotList.filter((t) => t.aspect === 150);
  assert.equal(eclats.length, 2, 'les deux éclats portent l\'aspect 150 du SWF');
});

// ── 9. Les aspects des tirs spéciaux ──────────────────────────────────────

test('chaque spéciale porte l\'aspect du SWF (gotoAndStop 150-165)', () => {
  // Porto : la gerbe de douze en 151.
  {
    const { jeu } = partie({ ship: 1 });
    jusquAuCombat(jeu);
    jeu.hero.bombe();
    const gerbe = jeu.hShotList.filter((t) => t.aspect === 151);
    assert.equal(gerbe.length, 12, 'Porto : douze tirs en 151');
  }
  // Manzana : huit chercheuses en 154, libres jusqu'à 200 px.
  {
    const { jeu } = partie({ ship: 3 });
    jusquAuCombat(jeu);
    jeu.hero.bombe();
    const tetes = jeu.hShotList.filter((t) => t.behaviourId === 8);
    assert.equal(tetes.length, 8, 'huit têtes chercheuses');
    for (const t of tetes) {
      assert.equal(t.aspect, 154, 'l\'aspect 154');
      assert.equal(t.killMargin, 200, 'Manzana.bomb : killMargin 200');
    }
  }
  // Curaso : la boule 155.
  {
    const { jeu } = partie({ ship: 4 });
    jusquAuCombat(jeu);
    jeu.hero.bombe();
    assert.ok(jeu.hShotList.some((t) => t.behaviourId === 10 && t.aspect === 155),
      'Curaso : l\'aspect 155');
  }
  // Cherry entamé : l'éventail 156.
  {
    const { jeu } = partie({ ship: 5 });
    jusquAuCombat(jeu);
    const h = jeu.hero;
    h.newShield = undefined;
    h.frapper();
    assert.equal(h.hp, 1, 'entamé');
    h.coolDown = 0;
    jeu.entree.tir = true;
    h.commander(1);
    assert.ok(jeu.hShotList.some((t) => t.aspect === 156), 'l\'éventail porte l\'aspect 156');
  }
  // Les cartes : 163 (rouge), 164 (verte, 200 px), 165 (bleue).
  {
    const { jeu } = partie();
    jusquAuCombat(jeu);
    const essayer = (nom) => {
      const type = E.BONUS.findIndex((b) => b.nom === nom);
      const o = new E.Opt(jeu, { x: 120, y: 100, type });
      o.ramasser();
    };
    essayer('carteRouge');
    assert.equal(jeu.hShotList.filter((t) => t.aspect === 163).length, 32, 'hanabi : 32 tirs en 163');
    jeu.nettoyerTirs();
    essayer('carteVerte');
    const verte = jeu.hShotList.find((t) => t.aspect === 164);
    assert.ok(verte && verte.killMargin === 200, 'la chercheuse verte vagabonde à 200 px');
    jeu.nettoyerTirs();
    essayer('carteBleue');
    assert.ok(jeu.hShotList.some((t) => t.aspect === 165 && t.behaviourId === 25), 'l\'onde bleue');
  }
});

test('les mines du Brugnon essaiment des étoiles 162 qui tournoient', () => {
  const { jeu } = partie();
  jusquAuCombat(jeu);
  const [b] = poserFigurants(jeu, [{ type: 48, x: 120, y: 60 }]);
  b.tirer();
  const mine = jeu.bShotList.find((t) => t.behaviourId === 23);
  assert.ok(mine, 'la mine est posée');
  for (let i = 0; i < 400 && !jeu.bShotList.some((t) => t.aspect === 162); i++) jeu.update(1);
  const etoile = jeu.bShotList.find((t) => t.aspect === 162);
  assert.ok(etoile, 'la mine a essaimé');
  assert.ok(etoile.vitRot !== undefined && etoile.vitRot >= -30 && etoile.vitRot < 30,
    'chaque étoile tournoie (vitRot ±30, comme le SWF)');
});

// ── 10. Les sons et le rendu ──────────────────────────────────────────────

test('les volumes du SWF sont posés : bips à 25, laser ennemi à 20, jingle à 80', () => {
  const source = fs.readFileSync(path.join(ROOT, 'public/miniwave/sons.js'), 'utf8');
  assert.match(source, /sWaveBeep0: 25/, 'les bips de vague à 25 (Game.updateWave)');
  assert.match(source, /sLaser5: 20/, 'le laser ennemi à 20 (Bads.shoot)');
  assert.match(source, /sJingle2: 80/, 'le jingle de niveau à 80');
  assert.match(source, /sLaser1: 50/, 'le laser du Tequila à 50');
  assert.match(source, /sLaser0: 40/, 'celui du Manzana à 40');

  // La robustesse : un gain PERSISTANT par canal (rien ne s'accumule), le
  // décodage rattrapé si l'appui précède le chargement, l'anti-rafale.
  assert.match(source, /canal\(num\)/, 'le gain par canal est persistant');
  assert.match(source, /if \(this\.ctx\) this\.decoder\(n\)/, 'décodage rattrapé au fil de l\'eau');
  assert.match(source, /t - d < 35/, 'anti-rafale : un même son ne repart pas deux fois par poignée de ms');
  assert.match(source, /src\.onended/, 'les sources finies se détachent du graphe');
  assert.match(source, /suspendre\(oui\)/, 'et la pause suspend le contexte');

  // Le Cherry entamé change de son de tir (sLaser7) : l'annonce porte les hp.
  assert.match(source, /d\.type === 5 && d\.hp === 1\) \? 'sLaser7'/, 'sLaser7 pour le Cherry entamé');
  const moteur = fs.readFileSync(path.join(ROOT, 'public/miniwave/engine.js'), 'utf8');
  assert.match(moteur, /'tirHero', \{ x: this\.x, y: this\.y - 6, type: this\.type, hp: this\.hp \}/,
    'le moteur annonce les hp avec le tir');
});

test('le rendu pose les nouveautés : fissures, halo blanc, traînes, pause', () => {
  const rendu = fs.readFileSync(path.join(ROOT, 'public/miniwave/game.js'), 'utf8');
  // Le Pastaga (et le Cherry) fissurés à 1 PV — l'image 2 dessinée dans le
  // SWF et jamais branchée pour le Pastaga.
  assert.match(rendu, /fiche\.hp === 2 && sp\.etats\.length >= 2/, 'l\'image fissurée à 1 PV');
  // Les aspects du moteur passent au rendu.
  assert.match(rendu, /t\.aspect \|\|/, 'l\'aspect du tir vient du moteur');
  // La toupie.
  assert.match(rendu, /t\.rot !== undefined\) \? t\.rot/, 'la toupie des étoiles est posée');
  // Le rayon de la Cosmirabelle est composé (boule + rayon + éclat).
  assert.match(rendu, /dessinerRayonMirabelle/, 'le rayon composé de la Cosmirabelle');
  // Le rayon du Cherry.
  assert.match(rendu, /dessinerCherryLaser/, 'le pilier du Cherry');
  // Les traînes du SWF, étirées sur la distance (les queues font 100 de long).
  assert.match(rendu, /queueCuraso/, 'la traîne du Curaso (8 px d\'épaisseur, celle du SWF)');
  assert.match(rendu, /sx: dist \/ 100/, 'étirée sur la distance parcourue');
  // L'onde de choc du Tequila (PartOnde à 200 %).
  assert.match(rendu, /'partOnde', \{ x: d\.x, y: d\.y, echelle: 2 \}/, 'l\'onde du Tequila');
  // La pause.
  assert.match(rendu, /dessinerPause/, 'le voile de pause');
  assert.match(rendu, /'Escape'/, 'Échap met en pause');
  // Le bonus vaisseau montre la silhouette tirée au largage.
  assert.match(rendu, /optVaisseau/, 'la silhouette du vaisseau à gagner');
  assert.match(rendu, /o\.shipId/, 'celle que le moteur a choisie');
  // La transformation de couleur du SWF est appliquée (le halo BLANC).
  assert.match(rendu, /imageTeintee/, 'les pièces teintées (cxform) sont posées');

  const manifeste = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'public/miniwave/sprites/sprites.json'), 'utf8'));
  for (const cle of ['partOnde', 'partImpact', 'queueCuraso', 'queueHoming', 'queueKumquat',
    'queueGroseille', 'cherryLaser', 'emp', 'pause', 'optVaisseau', 'optHalo', 'partBadsWarp']) {
    assert.ok(manifeste[cle] && manifeste[cle].etats.length > 0, 'le manifeste porte ' + cle);
  }
  assert.equal(manifeste.optVaisseau.etats.length, 5, 'cinq silhouettes — jamais l\'Aliquet');
  // Le halo de la bombe du Pamplemousse est peint en blanc par sa
  // transformation de couleur (add 255,255,255) — le cœur du retour « bombe
  // noire trop discrète ».
  const bombe = manifeste.shot.etats.find((e) => e.frame === 18);
  assert.ok(bombe.pieces.some((p) => p.cx && p.cx.a[0] === 255 && p.cx.a[1] === 255 && p.cx.a[2] === 255),
    'le halo blanc de la bombe est dans le manifeste');
  // Les traînes s'ancrent derrière leur origine (o excentré).
  const traine = manifeste.queueCuraso.etats[0].pieces[0];
  assert.ok(traine.o && traine.o[0] === -100, 'la traîne s\'étend derrière son point d\'ancrage');
});

test('la page branche la pause et estampille les scripts', () => {
  const page = fs.readFileSync(path.join(ROOT, 'public/miniwave/index.html'), 'utf8');
  assert.match(page, /id="pause"/, 'le bouton de pause est là');
  assert.match(page, /client\.pauser\(\)/, 'et branché');
  assert.match(page, /surPause/, 'l\'interface suit l\'état de pause');
  assert.match(page, /sons\.suspendre\(pausee\)/, 'le son se fige avec le jeu');
  assert.match(page, /v=fidele3/, 'les scripts sont ré-estampillés');
});

// ── Le boss : la morsure du soleil ────────────────────────────────────────

test('la morsure du soleil aveugle le pilote au lieu de tirer', () => {
  const { jeu } = partie();
  jusquAuCombat(jeu);
  const h = jeu.hero;
  const boss = new E.Boss(jeu, {});
  jeu.boss = boss;
  jeu.spriteList.push(boss);
  boss.initStep(20);                    // l'orange à nu
  boss.initStep(24);                    // la morsure
  assert.equal(boss.shootInfo.step, 0, 'la charge commence');
  let t = 0;
  while (boss.shootInfo.step === 0 && t++ < 200) boss.update(1);
  assert.equal(boss.shootInfo.step, 1, 'elle a mordu');
  assert.equal(h.sens, -1, 'le pilote est aveuglé : les commandes s\'inversent');
  assert.ok(h.blindTimer > 290, 'pour 300 images (Boss.as : blind(300))');
  while (boss.step === 24 && t++ < 300) boss.update(1);
  assert.equal(boss.step, 21, 'puis l\'orange reprend sa veille');
});
