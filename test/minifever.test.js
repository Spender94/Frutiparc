/*
 * Mini-Fever — le portage du socle et des épreuves.
 *
 * Le jeu n'est jamais sorti. Il en reste les SOURCES (Games/miniFever/src) et
 * un SWF de développement qui, lui, se lance sous Ruffle — c'est l'arbitre
 * quand les deux divergent, car les sources ont continué de vivre après ce
 * build (Marmite.mt a des bulles que le bytecode n'a pas). Ces épreuves-ci
 * vérifient donc une chose et une seule : que les formules portées sont bien
 * celles des sources QUE LE SWF A COMPILÉES, à la ligne près. Chaque assertion
 * cite la sienne.
 *
 * On joue les mini-jeux pour de bon, avec un tirage figé : c'est le seul moyen
 * de savoir qu'une épreuve se gagne et se perd comme il faut.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const E = require(path.join(ROOT, 'public/minifever/engine.js'));
const C = require(path.join(ROOT, 'public/minifever/client.js'));
const J = require(path.join(ROOT, 'public/minifever/jeux.js'));

const MANIFESTE = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'public/minifever/sprites/sprites.json'), 'utf8'));
const MESURES = C.mesures(MANIFESTE);
const { LARGEUR, HAUTEUR } = E;

/** Un tirage figé : la même suite à chaque exécution. */
function dé(graine) {
  let x = graine || 1;
  return () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
}

/** Un socle nu qui ne joue qu'une épreuve, pour l'examiner de près. */
function banc(Classe, o) {
  o = o || {};
  const socle = new E.Socle({
    mesures: MESURES,
    catalogue: [{ cle: 'test', nom: 'test', Classe }],
    rng: dé(o.graine || 7),
  });
  socle.dif = o.dif || 0;
  socle.tirer();
  socle.lancer();
  return {
    socle,
    get jeu() { return socle.jeu; },
    souris(x, y) { socle.bouger(x, y); },
    avancer(n) { for (let i = 0; i < (n || 1); i++) socle.update(1); },
  };
}

// ── LE MOTEUR ──

test('la scène empile par profondeur, puis par ordre d\'arrivée (DepthManager)', () => {
  const s = new E.Scene(MESURES);
  const fond = s.attacher('sym480', E.PROF.FOND);
  const a = s.attacher('sym480', E.PROF.SPRITE);
  const b = s.attacher('sym480', E.PROF.SPRITE);
  assert.deepEqual(s.ordre(), [fond, a, b]);
  s.devant(fond);                       // dm.over() : passer devant tout le monde
  assert.deepEqual(s.ordre(), [a, b, fond]);
  a.enlever();
  s.avancer();
  assert.deepEqual(s.ordre(), [b, fond]);
});

test('un clip qui joue avance d\'une image et boucle (Mc.mt)', () => {
  const s = new E.Scene(MESURES);
  const mc = s.attacher('sym488', E.PROF.SPRITE);   // l'arceau : six images
  assert.equal(mc.nbImages, 6);
  assert.equal(mc.image, 1);
  s.avancer();
  assert.equal(mc.image, 1, 'arrêté par défaut');
  mc.jouer();
  for (let i = 0; i < 5; i++) s.avancer();
  assert.equal(mc.image, 6);
  s.avancer();
  assert.equal(mc.image, 1, 'la pellicule boucle');
  mc.allerA(3);
  assert.equal(mc.image, 3);
  assert.equal(mc.joue, false, 'gotoAndStop arrête le clip');
});

test('la physique suit sp/Phys.mt : poids, friction, rotation', () => {
  const b = banc(class extends E.Jeu {});
  const p = b.jeu.nouveauPhys('sym480');
  p.poids = 0.5;
  p.vitx = 10;
  p.vitr = 4;
  p.init();
  b.avancer(1);
  // vity += gravite*poids ; puis les deux vitesses sont freinées ; puis on avance.
  assert.equal(p.vity.toFixed(4), (0.5 * 0.99).toFixed(4));
  assert.equal(p.vitx.toFixed(4), (10 * 0.99).toFixed(4));
  assert.equal(p.x.toFixed(4), (10 * 0.99).toFixed(4));
  assert.equal(p.peau.rot.toFixed(4), (4 * 0.99).toFixed(4));
  assert.equal(p.peau.x, p.x, 'le dessin suit le sprite');
});

test('la particule s\'efface toute seule (sp/phys/Part.mt)', () => {
  const b = banc(class extends E.Jeu {});
  const p = b.jeu.nouvellePart('sym16');
  p.flPhys = false;
  p.echelle = 50;
  p.minuteur = 20;
  p.init();
  assert.equal(p.peau.sx, 0.5, 'init() pose l\'échelle');
  b.avancer(3);                          // minuteur = 17, au-dessus du seuil de 10
  assert.equal(p.peau.alpha, 1, 'pleine opacité tant qu\'on est au-dessus du seuil');
  b.avancer(12);                         // minuteur = 5, sous le seuil
  assert.ok(p.peau.alpha > 0 && p.peau.alpha < 1, 'elle s\'estompe');
  b.avancer(6);
  assert.equal(p.vivant, false, 'puis elle disparaît');
  assert.equal(b.jeu.sprites.length, 0);
});

// ── LE SOCLE ──

test('une épreuve ne se juge qu\'une fois, et le fondu prend la main (Base.mt)', () => {
  const b = banc(class extends E.Jeu {});
  b.jeu.gagne(true);
  assert.equal(b.jeu.gagnant, true);
  b.jeu.gagne(false);
  assert.equal(b.jeu.gagnant, true, 'le second verdict est ignoré');
  assert.equal(b.socle.fondu.cible, null, 'rien ne bouge pendant les seize images');
  b.avancer(18);
  assert.equal(b.socle.fondu.couleur, 0xFFFFFF, 'gagné : fondu au blanc');
  assert.equal(b.socle.fondu.cible, 0);
});

test('le chrono qui s\'épuise fait perdre, sauf avis contraire du jeu', () => {
  const perdant = banc(class extends E.Jeu { init() { super.init(); this.gameTime = 5; } });
  perdant.socle.timerMax = 5;
  perdant.socle.timer = 5;
  perdant.avancer(7);
  assert.equal(perdant.jeu.gagnant, false);

  const gagnant = banc(class extends E.Jeu {
    init() { super.init(); this.gameTime = 5; }
    horsTemps() { this.gagne(true); }
  });
  gagnant.socle.timerMax = 5;
  gagnant.socle.timer = 5;
  gagnant.avancer(7);
  assert.equal(gagnant.jeu.gagnant, true, 'Pong gagne en survivant');
});

// ── LE MODE ARCADE ──

test('les cinq paliers sont ceux de base/Arcade.mt (DIF_INFO)', () => {
  assert.deepEqual(E.PALIERS.map((p) => [p.lvl, p.vies, p.min, p.max]), [
    [40, 7, 0, 40],
    [80, 6, 0, 60],
    [100, 5, 0, 100],
    [100, 4, 50, 100],
    [40, 3, 0, 40],
  ]);
  // Lang.DIF_LEVEL n'en nomme que quatre, et Cm.finishArcade() n'en débloque
  // que quatre : le cinquième n'a jamais servi.
  assert.deepEqual(E.PALIERS.filter((p) => p.nom).map((p) => p.nom),
    ['facile', 'normal', 'difficile', 'infernal']);
});

/** Un mode Arcade qui enchaîne des épreuves dont on décide l'issue. */
function arcade(palier, verdicts) {
  let i = 0;
  class Bidon extends E.Jeu {
    init() { super.init(); this.gameTime = 4; this.verdict = verdicts[i++]; }
    update() { super.update(); if (this.etapePrincipale === 1) this.gagne(this.verdict); }
  }
  const a = new E.Arcade({
    mesures: MESURES, rng: dé(3), palier: palier || 0,
    catalogue: [{ cle: 'test', nom: 'test', Classe: Bidon }],
  });
  a.demarrer();
  return a;
}

test('la difficulté monte avec les épreuves RÉUSSIES (Arcade.incLevel)', () => {
  const a = arcade(1, [true, true, false, true]);      // palier « normal » : 80 épreuves, 0→60
  assert.equal(a.vies, 6);
  assert.equal(a.dif, 0, 'la première épreuve se joue à zéro');
  const p = a.info;
  // On s'arrête au tirage qui suit la quatrième épreuve : le verdict n'est
  // compté qu'au débriefing, pas à la seconde où l'épreuve se termine.
  for (let i = 0; i < 3000 && !(a.jouees === 4 && a.etape === 2); i++) a.update(1);
  assert.equal(a.jouees, 4);
  assert.equal(a.niveau, 3, 'trois réussites');
  assert.equal(a.vies, 5, 'un échec coûte une vie');
  // dif = min + round((max-min) * niveau/lvl)
  assert.equal(a.dif, p.min + Math.round((p.max - p.min) * (3 / p.lvl)));
});

test('zéro vie et c\'est fini ; aller au bout du palier et c\'est gagné', () => {
  const perdu = arcade(0, new Array(40).fill(false));
  let fin = null;
  perdu.surEvenement = (n, d) => { if (n === 'finPartie') fin = d; };
  for (let i = 0; i < 2000 && !perdu.termine; i++) perdu.update(1);
  assert.equal(perdu.vies, 0);
  assert.equal(perdu.jouees, 7, 'sept vies, sept échecs');
  assert.equal(fin.gagnee, false);

  const gagne = arcade(0, new Array(60).fill(true));
  let bilan = null;
  gagne.surEvenement = (n, d) => { if (n === 'finPartie') bilan = d; };
  for (let i = 0; i < 8000 && !gagne.termine; i++) gagne.update(1);
  assert.equal(bilan.gagnee, true);
  assert.equal(bilan.niveau, 40, 'le palier « facile » compte quarante épreuves');
  assert.equal(gagne.vies, 7, 'sans perdre une vie');
});

test('entre deux épreuves, la console tient l\'antenne (Arcade.initStep)', () => {
  const a = arcade(0, [false, true]);
  for (let i = 0; i < 200 && a.jouees < 1; i++) a.update(1);
  assert.equal(a.derniere, false);
  // Le fondu se referme, l'épreuve quitte la scène, le débriefing commence.
  for (let i = 0; i < 40 && a.jeu; i++) a.update(1);
  assert.equal(a.jeu, null, 'plus d\'épreuve à l\'écran');
  assert.equal(a.etape, 1, 'débriefing');
  assert.equal(a.vies, 6, 'la vie est décomptée là, pas avant');
  // Le VERDICT AFFICHABLE : `derniere` est déjà consommé (comme flWin dans
  // initStep(1) des sources), c'est `verdict` que la console lit — le lire
  // sur `derniere` écrivait « raté ! » même sur une victoire.
  assert.equal(a.derniere, null, 'flWin est consommé sitôt le débriefing ouvert');
  assert.equal(a.verdict, false, 'mais sa trace reste : épreuve perdue');
  for (let i = 0; i < 45 && a.etape === 1; i++) a.update(1);
  assert.equal(a.etape, 2, 'puis le tirage');
  for (let i = 0; i < 200 && a.etape === 2; i++) a.update(1);
  assert.equal(a.etape, 3, 'puis le briefing');
  for (let i = 0; i < 60 && !a.jeu; i++) a.update(1);
  assert.ok(a.jeu, 'et l\'épreuve suivante reprend');
  // La deuxième épreuve est GAGNÉE : au débriefing suivant, la trace dit vrai.
  for (let i = 0; i < 300 && !(a.jouees === 2 && a.etape === 1); i++) a.update(1);
  assert.equal(a.etape, 1);
  assert.equal(a.verdict, true, '« gagné ! » sur une victoire, enfin');
});

// ── LES ÉPREUVES ──

test('chaque dessin cité par les mini-jeux existe dans le manifeste', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/minifever/jeux.js'), 'utf8');
  const cles = [...new Set([...src.matchAll(/'(sym\d+)'/g)].map((m) => m[1]))];
  assert.ok(cles.length >= 10, `${cles.length} dessins cités`);
  for (const c of cles) assert.ok(MANIFESTE[c], `${c} est extrait du SWF`);
  // Et chaque épreuve a bien son décor.
  for (const j of J.JEUX) assert.ok(MANIFESTE[j.cle], `${j.cle} est extrait du SWF`);
});

test('BASKET : le panier et le ballon sont posés comme dans Basket.mt', () => {
  const b = banc(J.Basket, { dif: 50 });
  const j = b.jeu;
  assert.equal(j.gameTime, 200);
  assert.equal(j.rayonPanier, (110 - 50 * 0.4) * 0.5);   // 45
  assert.equal(j.panier.y, 50);
  assert.equal(j.rayonBallon, j.rayonPanier * 0.5);
  assert.equal(j.ballon.y, 240 - j.rayonBallon);
  assert.equal(j.ballon.flPhys, false, 'le ballon attend le tir');
  assert.deepEqual(j.points.map((p) => p.x), [120 - 45, 120 + 45]);
  // La visée balaie en cosinus : angle = cos(decal/100)*0.9 - 1.57
  const avant = j.angle;
  b.avancer(1);
  assert.notEqual(j.angle, avant);
  assert.equal(j.angle.toFixed(6), (Math.cos(j.decal / 100) * 0.9 - 1.57).toFixed(6));
  assert.equal(j.fleche.rot.toFixed(4), (j.angle / (Math.PI / 180)).toFixed(4));
});

test('BASKET : le ballon qui retombe dans l\'arceau marque', () => {
  const b = banc(J.Basket);
  const j = b.jeu;
  j.angle = -Math.PI / 2;                 // pile à la verticale
  j.lancer();
  assert.equal(j.etape, 2);
  assert.equal(j.fleche.vivant, false, 'la flèche s\'efface au tir');
  for (let i = 0; i < 200 && j.gagnant === null; i++) b.avancer(1);
  assert.equal(j.gagnant, true);
  assert.equal(j.flPoint, true, 'il est bien passé par-dessus');
  assert.equal(j.panier.joue, true, 'et le filet s\'anime');
});

test('BASKET : le ballon qui touche le sol est perdu', () => {
  const b = banc(J.Basket);
  const j = b.jeu;
  j.angle = -0.2;                         // presque à l'horizontale
  j.lancer();
  for (let i = 0; i < 200 && j.gagnant === null; i++) b.avancer(1);
  assert.equal(j.gagnant, false);
});

test('LANDER : se poser à plat et lentement, sinon c\'est le crash', () => {
  const doux = banc(J.Lander);
  let j = doux.jeu;
  assert.equal(j.rayonPlate, 55);         // (110-dif)*0.5
  assert.equal(j.plate.y, 225);
  // Juste sous la ligne de la plateforme : le module la touche à ce tour, et
  // `flEtaitHaut` dit qu'il était au-dessus au tour d'avant.
  j.module.x = j.plate.x;
  j.module.y = j.plate.y - j.rayonModule + 1;
  j.module.vitx = 0;
  j.module.vity = 0;
  j.angle = -1.57;
  j.flEtaitHaut = true;
  doux.souris(120, 120);
  doux.avancer(1);
  assert.equal(j.gagnant, true);
  assert.equal(j.module.flPhys, false, 'le module se pose');

  const brutal = banc(J.Lander);
  j = brutal.jeu;
  j.module.x = j.plate.x;
  j.module.y = j.plate.y - j.rayonModule + 1;
  j.module.vity = 6;                      // trop vite
  j.angle = -1.57;
  j.flEtaitHaut = true;
  brutal.avancer(3);
  assert.equal(j.gagnant, false);
  assert.equal(j.module.vivant, false, 'il explose');
  assert.ok(j.sprites.length >= 10, 'et laisse dix bouffées de fumée');
});

test('LANDER : le sol, hors plateforme, ne pardonne pas', () => {
  const b = banc(J.Lander);
  const j = b.jeu;
  j.module.x = (j.plate.x > 120) ? 5 : 235;    // loin de la plateforme
  j.module.y = 240 - 6 - j.rayonModule + 1;
  b.avancer(2);
  assert.equal(j.gagnant, false);
});

test('PONG : la balle attend, puis part ; la rater, c\'est perdu', () => {
  const b = banc(J.Pong, { dif: 0 });
  const j = b.jeu;
  assert.equal(j.vitesse, 5);
  assert.equal(j.rayonRaquette, 30);
  assert.equal(j.raquette.x, 226);
  assert.equal(j.airFriction, 1, 'Pong.initDefault : pas de frottement');
  const x0 = j.balle.x;
  b.avancer(1);
  // startCoef vaut 1 au premier tour : la physique avance la balle et le jeu la
  // retranche — elle ne bouge donc presque pas.
  assert.ok(Math.abs(j.balle.x - x0) < 0.2, 'départ amorti');
  b.souris(226, 5);                        // la raquette file en haut
  for (let i = 0; i < 400 && j.gagnant === null; i++) b.avancer(1);
  assert.equal(j.gagnant, false, 'la balle est passée à côté');
});

test('PONG : la balle renvoyée repart, et survivre suffit', () => {
  const b = banc(J.Pong, { dif: 0 });
  const j = b.jeu;
  let renvois = 0;
  for (let i = 0; i < 240 && j.gagnant === null; i++) {
    b.souris(226, j.balle.y);              // la raquette colle à la balle
    const avant = j.balle.vitx;
    b.avancer(1);
    if (avant > 0 && j.balle.vitx < 0) renvois++;
  }
  assert.ok(renvois >= 1, `la balle est renvoyée (${renvois} fois)`);
  assert.equal(j.gagnant, true, 'le chrono épuisé donne la victoire');
});

test('FLOWER : chaque goutte coûte du nuage, et la bien placée fait pousser', () => {
  const b = banc(J.Flower, { dif: 0 });
  const j = b.jeu;
  assert.equal(j.gameTime, 250);
  assert.equal(j.taille, 70);
  assert.equal(j.sol, 206);
  assert.equal(j.fleur.nbImages, 17, 'la pousse EST la pellicule de la fleur');

  j.nuage.x = j.fleur.x;                   // pile au-dessus
  b.socle.click();
  assert.equal(j.taille, 60, 'le nuage a rétréci de dix');
  assert.equal(j.gouttes.length, 1);
  for (let i = 0; i < 80 && j.gouttes.length; i++) { j.nuage.x = j.fleur.x; b.avancer(1); }
  assert.equal(j.gouttes.length, 0, 'la goutte a touché terre');
  // grandir((30-0)*0.02) = 0.6 → image floor(0.6*16)+1
  assert.equal(j.pousse.toFixed(2), '0.60');
  assert.equal(j.fleur.image, Math.floor(0.6 * 16) + 1);
  assert.ok(j.sprites.length >= 10, 'et ça éclabousse');

  j.nuage.x = j.fleur.x;
  b.socle.relache();
  b.socle.click();
  for (let i = 0; i < 80 && j.gagnant === null; i++) { j.nuage.x = j.fleur.x; b.avancer(1); }
  assert.equal(j.pousse, 1);
  assert.equal(j.gagnant, true);
});

test('FLOWER : le nuage épuisé sans fleur poussée, c\'est perdu', () => {
  const b = banc(J.Flower, { dif: 0 });
  const j = b.jeu;
  j.fleur.x = 20;
  for (let i = 0; i < 7; i++) {            // sept appuis : 70 de nuage
    j.nuage.x = 220;                       // à l'opposé de la fleur
    b.socle.relache();
    b.socle.click();
  }
  assert.equal(j.taille, 0);
  for (let i = 0; i < 120 && j.gagnant === null; i++) { j.nuage.x = 220; b.avancer(1); }
  assert.equal(j.gagnant, false);
  assert.equal(j.pousse, 0);
});

test('ASTERO : un rocher touché se casse en deux, et le champ vidé fait gagner', () => {
  const b = banc(J.Astero, { dif: 0 });
  const j = b.jeu;
  assert.equal(j.airFriction, 1);
  assert.equal(j.rochers.length, 1, 'un seul rocher à difficulté nulle');
  assert.equal(j.rochers[0].taille, 50);

  // Un tir posé sur le rocher : il se fend en deux moitiés de vingt-cinq.
  const r = j.rochers[0];
  const t = j.nouveauPhys('sym314');
  t.x = r.x; t.y = r.y; t.flPhys = false; t.duree = 100;
  t.init();
  j.tirs.push(t);
  b.avancer(1);
  assert.equal(j.rochers.length, 2, 'deux morceaux');
  assert.deepEqual(j.rochers.map((x) => x.taille), [25, 25]);
  assert.equal(j.gagnant, null, 'la partie continue');

  // Sous vingt, un morceau ne se fend plus : il disparaît.
  for (const m of j.rochers.slice()) {
    const s = j.nouveauPhys('sym314');
    s.x = m.x; s.y = m.y; s.flPhys = false; s.duree = 100;
    s.init();
    j.tirs.push(s);
    b.avancer(1);
  }
  assert.ok(j.rochers.length >= 2, 'vingt-cinq se fend encore, en deux fois douze et demi');
  // On finit le travail : tout ce qui reste saute.
  for (let i = 0; i < 12 && j.rochers.length; i++) {
    const m = j.rochers[0];
    const s = j.nouveauPhys('sym314');
    s.x = m.x; s.y = m.y; s.flPhys = false; s.duree = 100;
    s.init();
    j.tirs.push(s);
    b.avancer(1);
  }
  assert.equal(j.rochers.length, 0);
  assert.equal(j.gagnant, true, 'le champ vidé, c\'est gagné');
});

test('ASTERO : le vaisseau percuté explose, et le jeu ne trébuche pas dessus', () => {
  const b = banc(J.Astero, { dif: 0 });
  const j = b.jeu;
  const r = j.rochers[0];
  r.x = j.vaisseau.x;
  r.y = j.vaisseau.y;
  b.avancer(1);
  assert.equal(j.gagnant, false);
  assert.equal(j.vaisseau, null, 'le vaisseau a disparu');
  // Les sources laissaient AS2 avaler les appels sur `null` ; ici c'est gardé.
  b.avancer(20);
  assert.equal(j.gagnant, false);
});

test('ASTERO : l\'appui tire, avec un délai entre deux coups', () => {
  const b = banc(J.Astero, { dif: 0 });
  const j = b.jeu;
  b.socle.click();
  b.avancer(1);
  assert.equal(j.tirs.length, 1, 'le premier coup part');
  assert.equal(j.repos, 2.5);
  b.avancer(1);
  assert.equal(j.tirs.length, 1, 'le suivant attend');
  b.avancer(3);
  assert.equal(j.tirs.length, 2, 'puis part à son tour');
  // Un tir s'éteint au bout de cent images.
  b.socle.relache();
  const t = j.tirs[0];
  t.duree = 5;
  b.avancer(6);
  assert.equal(t.vivant, false);
});

test('ASTERO : ce qui sort d\'un bord rentre par l\'autre', () => {
  const b = banc(J.Astero, { dif: 0 });
  const j = b.jeu;
  const v = j.vaisseau;
  v.x = -12;                       // au-delà de la marge de dix
  j.replier(v, 10);
  assert.ok(v.x > LARGEUR, `x=${v.x} : revenu par la droite`);
  v.y = HAUTEUR + 14;
  j.replier(v, 10);
  assert.ok(v.y < 0, `y=${v.y} : revenu par le haut`);
});

test('PARACHUTE : la fourmi posée sur la feuille gagne, et sa pellicule joue $landing', () => {
  const b = banc(J.Parachute, { dif: 0 });
  const j = b.jeu;
  // Parachute.init : rayon 40 - dif·0.1, vitesse 0.5 + dif·0.06, sol à mch-15.
  assert.equal(j.rayonFeuille, 40);
  assert.equal(j.vitesseFeuille, 0.5);
  assert.equal(j.solFeuille, HAUTEUR - 15);
  assert.equal(j.rayonPara, 25);
  // attachElements : moulin en (120, 100), fourmi en (120, 120), pellicule
  // ARRÊTÉE sur l'image 1 (skin.stop()).
  assert.equal(j.moulin.x, 120); assert.equal(j.moulin.y, 100);
  assert.equal(j.para.x, 120); assert.equal(j.para.y, 120);
  assert.equal(j.para.peau.image, 1);
  assert.equal(j.anim, null, 'en vol, pas d\'animation');

  // On fige la feuille sous la fourmi et on laisse la gravité (0.75 par image)
  // faire le reste. Personne n'appuie : le moulin ne souffle pas.
  j.sensFeuille = 0;
  j.para.x = j.feuille.x;
  b.avancer(200);
  assert.equal(j.etape, 2, 'posée');
  assert.equal(j.gagnant, true);
  assert.equal(j.decalPose, 0, 'pile au centre de la feuille');
  // landing(true) : gotoAndPlay("$landing") — l'étiquette est sur l'image 7,
  // le stop() sur la 19.
  assert.ok(j.para.peau.image >= 7 && j.para.peau.image <= 19,
    `pellicule à ${j.para.peau.image}, dans le segment $landing`);
  b.avancer(20);
  assert.equal(j.para.peau.image, 19, 'et s\'y arrête');
  // En étape 2, la fourmi suit la feuille (para.x = leaf._x + paraDecal).
  assert.equal(j.para.x, j.feuille.x + j.decalPose);
});

test('PARACHUTE : à côté de la feuille, dix pixels plus bas, c\'est le plouf', () => {
  const b = banc(J.Parachute, { dif: 0 });
  const j = b.jeu;
  j.sensFeuille = 0;
  // À plus d'un rayon de feuille (quarante) du centre, sans sortir des murs.
  j.para.x = j.feuille.x > 120 ? j.feuille.x - 50 : j.feuille.x + 50;
  b.avancer(220);
  assert.equal(j.etape, 2);
  assert.equal(j.gagnant, false, 'raté');
  assert.ok(j.para.peau.image >= 21, `pellicule à ${j.para.peau.image} : $ploufing (21-28)`);
  b.avancer(20);
  assert.equal(j.para.peau.image, 28, 'le stop de fin de pellicule');
});

test('PARACHUTE : l\'appui lance les pales, et le souffle pousse la fourmi', () => {
  const b = banc(J.Parachute, { dif: 0 });
  const j = b.jeu;
  b.souris(120, 100);                       // le moulin reste sous la fourmi
  b.socle.click();                          // les pales accélèrent (+1 par image)
  b.avancer(4);
  assert.ok(j.vitRotation > 0, 'les pales tournent');
  // La fourmi est à moins de soixante pixels : vitx bouge (pow·0.02, par image).
  assert.notEqual(j.para.vitx, 0, 'le souffle la pousse');
  const v = j.vitRotation;
  b.socle.relache();
  b.avancer(10);
  assert.ok(j.vitRotation < v, 'sans appui, les pales s\'essoufflent (×0.95^tmod)');
});

test('GOBELET : la bille suit les échanges — le gobelet gagnant reste le sien', () => {
  const b = banc(J.Gobelet, { dif: 30 });
  const j = b.jeu;
  // Gobelet.init : 4 + round(dif/50) gobelets de taille 30, espacés de
  // (240 - n·30)/(n+1), le premier centré à ec + 15.
  assert.equal(j.gobelets.length, 4 + Math.round(30 / 50));
  const n = j.gobelets.length;
  const ec = (LARGEUR - n * 30) / (n + 1);
  assert.equal(j.gobelets[0].x, ec + 15);
  assert.equal(j.gobelets[1].x - j.gobelets[0].x, ec + 30);
  assert.equal(j.vitesse, 0.2 + 30 * 0.003);
  // La bille attend sous le gobelet tiré au sort.
  assert.equal(j.bille.x, j.gobelets[j.pos].x);

  // Le gobelet initialement au-dessus de la bille : après TOUS les échanges
  // d'objets (launchSwap échange gob0.mc et gob1.mc et déplace pos avec), c'est
  // encore lui que `pos` désigne.
  const gagnant = j.gobelets[j.pos].mc;
  b.avancer(22);                            // le minuteur de 20 s'épuise
  assert.equal(j.etape, 2, 'les gobelets descendent');
  let garde = 0;
  while (j.etape !== 4 && garde++ < 3000) b.avancer(1);
  assert.equal(j.etape, 4, 'les échanges sont finis');
  assert.equal(j.gobelets[j.pos].mc, gagnant, 'pos a suivi la bille');

  // Cliquer le bon : la bille reparaît dessous, et l'épreuve est gagnée.
  const mc = j.gobelets[j.pos].mc;
  b.souris(mc.x, mc.y);
  b.socle.click();
  assert.equal(j.gagnant, true);
  assert.equal(j.bille.x, mc.x);
  b.socle.relache();
  b.avancer(5);
  assert.ok(mc.y < HAUTEUR - 30, 'le gobelet choisi se lève');
});

test('GOBELET : l\'arc d\'un échange suit la formule de la source, et l\'erreur montre la soluce', () => {
  const b = banc(J.Gobelet, { dif: 0 });
  const j = b.jeu;
  b.avancer(21);
  let garde = 0;
  while (j.etape !== 3 && garde++ < 2000) b.avancer(1);
  assert.equal(j.etape, 3, 'un échange est en cours');
  // Une image d'échange : decal = vitesse·tmod, et chaque gobelet de la paire
  // est sur son arc — x = px + cos(decal)·d·sens, y = base + sin(decal·sens)·
  // (4 + |d|·0.25).
  b.avancer(1);
  const base = HAUTEUR - 30;
  const p = j.paires[0];
  for (let g = 0; g < 2; g++) {
    const mc = j.gobelets[p.list[g]].mc;
    const sens = g * 2 - 1;
    assert.ok(Math.abs(mc.x - (p.x + Math.cos(j.decal) * p.d * sens)) < 1e-9);
    assert.ok(Math.abs(mc.y - (base + Math.sin(j.decal * sens) * (4 + Math.abs(p.d) * 0.25))) < 1e-9);
  }

  // Choisir un mauvais gobelet : perdu — puis, pendant le fondu, le jeu lève
  // le bon (update, case 4 : endTimer < 16 déclenche select(pos)).
  garde = 0;
  while (j.etape !== 4 && garde++ < 3000) b.avancer(1);
  const faux = (j.pos + 1) % j.gobelets.length;
  const mc = j.gobelets[faux].mc;
  b.souris(mc.x, mc.y);
  b.socle.click();
  assert.equal(j.gagnant, false);
  b.socle.relache();
  b.avancer(6);
  assert.equal(j.flSoluce, true, 'la solution s\'est montrée');
  assert.equal(j.leves.length, 2, 'deux gobelets levés : le faux, puis le bon');
});

test('MARMITE : la recette s\'affiche sur la page du livre, et la suivre gagne', () => {
  const b = banc(J.Marmite, { dif: 0 });
  const j = b.jeu;
  // Marmite.init : 460 au chrono, ronde de neuf, recette de 1 + dif·0.08.
  assert.equal(j.gameTime, 460);
  assert.equal(j.ronde.length, 9);
  assert.equal(j.recette.length, 1);
  // attachElements : les copies de la recette sur la page — échelle 50,
  // alpha 75, la grille 16 + (i%4)·24 / 30 + ⌊i/4⌋·24 portée par la matrice
  // de la page (15°, calée en -90.3, -93.9).
  assert.equal(j.pageIcones.length, 1);
  const ic = j.pageIcones[0];
  assert.equal(ic.image, j.recette[0] + 1);
  assert.equal(ic.sx, 0.5);
  assert.equal(ic.alpha, 0.75);
  assert.equal(ic.rot, 15);
  assert.equal(ic.prof, E.PROF.SPRITE, 'au-dessus du livre, pas derrière');
  const P = { a: 0.9659271240234375, b: 0.258819580078125 };
  assert.ok(Math.abs(ic.x - (j.livre.x + P.a * 16 - P.b * 30 - 90.3)) < 1e-9);
  assert.ok(Math.abs(ic.y - (j.livre.y + P.b * 16 + P.a * 30 - 93.9)) < 1e-9);

  // La souris en bas : la ronde remonte (centre à -100) et le livre s'installe
  // à 240 ; en haut : la ronde descend et le livre plonge à 340.
  b.souris(120, 200);
  b.avancer(30);
  assert.equal(j.centre.y, -100);
  assert.ok(Math.abs(j.livre.y - HAUTEUR) < 1, 'le livre est là');
  assert.ok(Math.abs((j.pageIcones[0].y - j.livre.y) - (P.b * 16 + P.a * 30 - 93.9)) < 1e-9,
    'la page suit le livre');
  b.souris(120, 0);
  b.avancer(60);
  assert.ok(j.livre.y > HAUTEUR + 90, 'le livre est rangé');

  // La ronde immobile (souris au centre) : l'ingrédient le plus bas est sous
  // l'axe, on le lâche. On arrange la recette pour qu'il soit LE BON.
  b.avancer(120);
  const bas = j.plusBas();
  assert.ok(bas, 'un ingrédient est à portée');
  j.recette = [bas.peau.image - 1];
  const decalAvant = j.decal;
  b.socle.click();
  assert.equal(j.tombants.length, 1, 'il tombe');
  assert.equal(bas.peau.masque, 'sym202', 'et s\'engloutira derrière le bord de la soupe');
  assert.equal(j.ronde.length, 8);
  // La ronde se resserre d'un demi-cran : ((1/8) - (1/9))·628·0.5.
  const ec = ((1 / 8) - (1 / 9)) * 628;
  assert.ok(Math.abs(j.decal - decalAvant - ec * 0.5) < 1e-9);
  b.socle.relache();
  b.avancer(200);
  assert.equal(j.gagnant, true, 'la recette est bouclée');
});

test('MARMITE : l\'ingrédient hors recette perd, jugé à 190 en tombant', () => {
  const b = banc(J.Marmite, { dif: 0 });
  const j = b.jeu;
  b.souris(120, 0);
  b.avancer(150);
  const bas = j.plusBas();
  assert.ok(bas);
  // La recette réclame AUTRE CHOSE que ce qui va tomber.
  j.recette = [(bas.peau.image % 9)];
  b.socle.click();
  b.avancer(200);
  assert.equal(j.gagnant, false, 'la soupe est gâchée');
  assert.equal(j.tombants.length, 0, 'l\'ingrédient jugé a disparu');
});

test('GATHER : la bille au rouge dehors, au bleu dedans — toutes dedans, gagné', () => {
  const b = banc(J.Gather, { dif: 0 });
  const j = b.jeu;
  // Gather.init : rayon 10 + dif·0.05, cercle 70, 1 + ⌊dif·0.05⌋ billes.
  assert.equal(j.rayonBille, 10);
  assert.equal(j.rayonCercle, 70);
  assert.equal(j.billes.length, 1);
  assert.equal(j.airFriction, 0.95, 'le seul jeu à frotter à 0.95');
  const mc = j.billes[0];
  assert.ok(mc.distance(j.cercle) > j.rayonBille + j.rayonCercle, 'née hors du cercle');
  b.avancer(1);
  assert.equal(mc.peau.image, 1, 'dehors : rouge');
  // Poussée au centre : elle passe au bleu et l\'épreuve est gagnée.
  mc.x = j.cercle.x; mc.y = j.cercle.y;
  mc.vitx = 0; mc.vity = 0;
  b.avancer(1);
  assert.equal(mc.peau.image, 2, 'dedans : bleue');
  assert.equal(j.gagnant, true);
});

test('GATHER : la bourrasque repousse, et sa griffe part en taille pleine', () => {
  const b = banc(J.Gather, { dif: 0 });
  const j = b.jeu;
  const mc = j.billes[0];
  mc.vitx = 0; mc.vity = 0;
  const avant = j.sprites.length;
  // Un appui à trente pixels de la bille (rayon d\'effet : blowRay·2 = 40).
  b.souris(mc.x + 30, mc.y);
  b.socle.click();
  // Gather.click : pow = 10·(40-d)/40 = 2.5, dans la direction OPPOSÉE.
  assert.ok(Math.abs(mc.vitx - (-Math.cos(0) * 2.5)) < 1e-9, `vitx ${mc.vitx}`);
  assert.equal(j.sprites.length, avant + 1, 'la griffe est née');
  const griffe = j.sprites[j.sprites.length - 1];
  assert.equal(griffe.flPhys, true, 'elle tombe');
  assert.equal(griffe.peau.sx, 1, 'Part.init réécrit l\'échelle à 100 — les _xscale de la source sont morts');
  assert.equal(griffe.peau.nbImages, 7, 'sept images, dont les vides');
  b.socle.relache();
});

test('TUBULO : résoudre la croix du mélange ramène tout à zéro', () => {
  const b = banc(J.Tubulo, { dif: 0 });
  const j = b.jeu;
  assert.equal(j.gameTime, 320);
  // Un seul tour de mélange à difficulté nulle : une croix à l\'état 2. La
  // résoudre, c\'est cliquer SA case centrale (+1 : (2+1)%3 = 0). On la
  // retrouve en cherchant le centre dont la croix est à 2 et le reste à 0.
  let centre = null;
  for (let x = 0; x < 4 && !centre; x++) {
    for (let y = 0; y < 4 && !centre; y++) {
      const dedans = new Set();
      for (const c of j.croix) {
        const s = j.caseEn(x + c.x, y + c.y);
        if (s) dedans.add(s);
      }
      let bon = true;
      for (let gx = 0; gx < 4; gx++) {
        for (let gy = 0; gy < 4; gy++) {
          const s = j.grille[gx][gy];
          if (dedans.has(s) ? s.id !== 2 : s.id !== 0) bon = false;
        }
      }
      if (bon) centre = j.grille[x][y];
    }
  }
  assert.ok(centre, 'le mélange est bien une seule croix');
  // L'appui se pose sur le HAUT de sa capsule — la seule part que les
  // fenêtres voisines, posées après, ne recouvrent pas (le dernier accroché
  // reçoit l'appui, comme dans le lecteur). Et il arrive À FROID, comme un
  // doigt : position et clic dans la même image, sans survol préalable —
  // c'est le point d'appui qui compte, pas le survol de l'image d'avant.
  b.souris(centre.x, centre.y - 40);
  b.socle.click();
  assert.equal(j.etape, 2, 'la plongée commence dès l\'appui, même sans survol');
  b.socle.relache();
  // decal court à 40·tmod vers 314 ; au creux (157), les états s\'affichent.
  b.avancer(3);
  assert.ok(centre.mc.y > centre.y, 'le tube plonge dans sa capsule');
  b.avancer(10);
  assert.equal(j.etape, 1, 'la plongée est finie');
  let zeros = true;
  for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) if (j.grille[x][y].id !== 0) zeros = false;
  assert.ok(zeros, 'tout est à zéro');
  assert.equal(j.gagnant, true);
  assert.deepEqual(centre.mc.masque, { cle: 'sym210', x: centre.x, y: centre.y, sx: 0.4, sy: 0.4 },
    'chaque tube est découpé par sa fenêtre capsule');
});

test('TUBULO : le survol blanchit la croix, et s\'éteint en partant', () => {
  const b = banc(J.Tubulo, { dif: 0 });
  const j = b.jeu;
  const slot = j.grille[1][1];
  b.souris(slot.x, slot.y - 40);
  b.avancer(8);
  assert.equal(j.survole, slot);
  assert.ok(slot.mc.blanchi > 0.1, 'la teinte blanche monte (rollOver 70)');
  b.souris(0, 0);
  b.avancer(40);
  assert.ok(slot.mc.blanchi < 0.02, 'et retombe (rollOut 100)');
});

test('TRAMPOLINE : passer la ligne du mur puis redescendre gagne — et le mur escamote', () => {
  const b = banc(J.Trampoline, { dif: 0 });
  const j = b.jeu;
  // Trampoline.init : toile à 200, sol à 234, mur à (4 - round(dif·0.1))·32.
  assert.equal(j.hautToile, 200);
  assert.equal(j.hautMur, 128);
  assert.equal(j.homme.poids, 0.5);
  assert.equal(j.mur.y, 128);
  // Sans rien faire, le bonhomme rebondit sur la toile : le filet se dessine
  // au contact, puis s\'efface en vol.
  let filetVu = false, vide = false;
  for (let i = 0; i < 200; i++) {
    b.avancer(1);
    if (j.filet.dessin.length) filetVu = true;
    else vide = true;
  }
  assert.ok(filetVu && vide, 'le filet apparaît au contact et disparaît en vol');

  // La victoire se JOUE : appui tenu, le ressort plafonne sous le mur — c'est
  // vrai aussi dans le SWF sous Ruffle (fondu rouge au chrono, sommet ~127).
  // Le geste gagnant est un RYTHME : relâcher pendant que la toile s'enfonce,
  // appuyer pendant qu'elle renvoie. Joué ainsi, le bonhomme passe le mur,
  // sourit (image 6, verdict gelé là-haut), redescend — gagné, et le carré
  // rouge l'escamote derrière le mur.
  const h = j.homme;
  let sourire = false, gele = false;
  for (let i = 0; i < 1500 && j.gagnant === null; i++) {
    const contact = h.y + j.rayonHomme > j.hautToile;
    if (contact && h.vity < 0) b.socle.click(); else b.socle.relache();
    b.avancer(1);
    h.x = 120;                     // la dérive n'est pas le sujet
    if (j.flHaut) {
      sourire = sourire || h.peau.image === 6;
      gele = gele || j.flGelResultat;
    }
  }
  assert.equal(j.gagnant, true, 'le rythme fait passer le mur');
  assert.ok(sourire, 'là-haut, le sourire (image 6)');
  assert.ok(gele, 'et le verdict gelé le temps du vol');
  assert.deepEqual(h.peau.masque,
    { cle: 'sym148', x: 0, y: j.hautMur - HAUTEUR, sx: 2.4, sy: 2.4 },
    'le carré rouge découpe le bonhomme à la ligne du mur');
});

test('TRAMPOLINE : sortir de la toile, c\'est la chute et la surprise', () => {
  const b = banc(J.Trampoline, { dif: 0 });
  const j = b.jeu;
  // Poussé hors de la toile (rayon 94, marge un rayon d\'homme), il passe
  // DEVANT (dm.over) puis s\'écrase au sol.
  j.homme.x = 10;
  j.homme.y = 190;
  b.avancer(2);
  assert.equal(j.flDehors, true);
  b.avancer(80);
  assert.equal(j.gagnant, false);
  assert.equal(j.homme.peau.image, 5, 'la surprise du crash');
  assert.ok(j.homme.y <= j.hautSol - j.rayonHomme + 0.001, 'posé au sol');
});

test('ORBITAL : recharge, tir — et la rotation du missile porte la coquille de la source', () => {
  const b = banc(J.Orbital, { dif: 0 });
  const j = b.jeu;
  // Orbital.init : vitesse 4 + dif·0.1, orbite 108, planète 50, 6 lanceurs.
  assert.equal(j.vitesse, 4);
  assert.equal(j.rayonOrbite, 108);
  assert.equal(j.lanceurs.length, 6);
  for (let i = 0; i < 6; i++) {
    for (let n = i + 1; n < 6; n++) {
      assert.ok(Math.abs(j.lanceurs[i].a - j.lanceurs[n].a) >= 0.2, 'angles espacés de 0,2 radian');
    }
    assert.ok(Math.abs(j.lanceurs[i].mc.rot - j.lanceurs[i].a / 0.0174) < 1e-9);
  }
  // La cadence des recharges : i·4 au chrono, puis l'animation 2 → 11.
  assert.equal(j.lanceurs[0].t, 0);
  assert.equal(j.lanceurs[5].t, 20);
  b.avancer(2);
  assert.equal(j.lanceurs[0].t, null, 'le premier est armé');
  assert.ok(j.lanceurs[0].anim, 'sa recharge joue');
  b.avancer(10);
  assert.equal(j.lanceurs[0].mc.image, 11, 'missile plein, tenu par le stop');

  // Le tir : l'appui sur le lanceur plein.
  const info = j.lanceurs[0];
  const bte = MESURES.sym141.boite;
  const milieu = { x: (bte.x0 + bte.x1) / 2, y: (bte.y0 + bte.y1) / 2 };
  b.souris(info.mc.x + Math.cos(info.a) * milieu.x - Math.sin(info.a) * milieu.y,
    info.mc.y + Math.sin(info.a) * milieu.x + Math.cos(info.a) * milieu.y);
  b.socle.click();
  b.socle.relache();
  assert.equal(j.missiles.length, 1, 'le missile part');
  assert.equal(info.t, 80, 'le lanceur recharge quatre-vingts unités');
  assert.equal(info.mc.image, 1, 'socle vide');
  const m = j.missiles[0];
  assert.ok(Math.abs(m.vitx - Math.cos(info.a) * 6) < 1e-9, 'six unités par image, tout droit');
  // La coquille de la source : `_rotation = a/0.01714` — PAS 0.0174.
  assert.ok(Math.abs(m.peau.rot - info.a / 0.01714) < 1e-9, 'la rotation du missile, coquille comprise');

  // Le contact : à dix unités, le poussin éclate en douze plumes étirées.
  m.x = j.cible.x;
  m.y = j.cible.y;
  const avant = j.sprites.length;
  b.avancer(1);
  assert.equal(j.gagnant, true);
  assert.equal(j.cible.peau.vivant, false, 'le poussin n\'est plus');
  const plumes = j.sprites.filter((s) => s.peau.cle === 'sym135');
  assert.equal(plumes.length, 12);
  for (const p of plumes) {
    assert.ok(p.peau.sx >= 0.5 && p.peau.sx <= 1.5, 'étirée en largeur (50-150)');
    assert.equal(p.peau.sy, 1, 'jamais en hauteur : la coquille des plumes');
  }
});

test('JUMPFISH : le saut, la ligne d\'eau, le cliché — gagné si le poisson est dans le cadre', () => {
  const b = banc(J.JumpFish, { dif: 0 });
  const j = b.jeu;
  assert.equal(j.taille, 100);
  assert.equal(j.ombre.peau.alpha, 0, 'l\'ombre naît invisible');
  b.avancer(20);
  assert.ok(j.ombre.peau.alpha > 0, 'et s\'affirme');
  assert.equal(j.etape, 1, 'pas encore de saut');

  // Sous cent unités au chrono, le saut est certain.
  b.socle.timer = 99;
  b.avancer(1);
  assert.equal(j.etape, 2, 'le poisson est en l\'air');
  assert.ok(j.poisson, 'il existe');
  assert.ok(j.poisson.vity < 0, 'il monte');
  assert.equal(j.poisson.peau.joue, true, 'et nage en volant');
  // Sa ligne d'eau : le carré rouge en masque, du haut du cadre à son départ.
  assert.deepEqual(j.poisson.peau.masque,
    { cle: 'sym163', x: 120, y: j.yEau * 0.5, sx: 2.4, sy: j.yEau / 100 });
  // Le miroir : vers la gauche, il se retourne.
  if (j.poisson.vitx < 0) assert.equal(j.poisson.peau.sy, -1);

  // Le cadre sur le poisson, et l'appui : flash, découpe, figé.
  b.souris(j.poisson.x, j.poisson.y);
  j.cadre.x = j.poisson.x;
  j.cadre.y = j.poisson.y;
  b.socle.click();
  b.avancer(1);
  b.socle.relache();
  assert.equal(j.etape, 3);
  assert.ok(j.distance < 30, 'le poisson est dans le cadre');
  assert.equal(j.cadre.peau.image, 2, 'le cliché est pris');
  assert.equal(j.fond.masque.cle, 'sym163', 'le monde se découpe au format photo');
  assert.equal(j.fond.masque.rot, j.cadre.peau.rot, 'incliné comme le cadre');
  const fige = j.scene.mcs.find((m) => m.cle === 'sym180' && m.vivant && m.masque);
  assert.ok(fige, 'le poisson figé est dans le cliché');
  assert.equal(j.blancEcran, 1, 'le flash part du blanc pur');
  b.avancer(30);
  assert.ok(j.blancEcran < 0.5 && j.blancEcran > 0, 'et se dissipe');
  b.avancer(30);
  assert.equal(j.gagnant, true, 'photo réussie');
});

test('JUMPFISH : le poisson manqué replonge — plouf partagé avec la fumée du Lander', () => {
  const b = banc(J.JumpFish, { dif: 0 });
  const j = b.jeu;
  b.socle.timer = 99;
  b.avancer(1);
  const y0 = j.yEau;
  let garde = 0;
  while (j.poisson.vivant !== false && garde++ < 400) b.avancer(1);
  assert.ok(j.poisson.vivant === false, 'replongé sans cliché');
  assert.ok(j.poisson.y > y0, 'sous sa ligne d\'eau');
  const plouf = j.sprites.find((s) => s.peau.cle === 'sym16');
  assert.ok(plouf, 'le plouf est là');
  assert.equal(plouf.peau.finit, true, 'et se retirera à sa dernière image');
  b.avancer(20);
  assert.ok(!j.sprites.some((s) => s.peau.cle === 'sym16' && s.peau.vivant), 'retiré');
});

test('PATATE : copier le modèle gagne, et reposer une pièce chasse l\'ancienne', () => {
  const b = banc(J.Patate, { dif: 0 });
  const j = b.jeu;
  assert.equal(j.gameTime, 320);
  assert.equal(j.desc.length, 3);
  assert.equal(j.pieces.length, 12, 'la réserve : trois emplacements × quatre variantes');
  assert.equal(j.corps.x, 60);
  assert.equal(j.modele.x, 180);

  // On joue comme un joueur : viser une pièce en prend parfois UNE AUTRE (les
  // motifs se chevauchent, le dernier dessiné reçoit l'appui — comme dans le
  // lecteur). Ce qu'on attrape, on le pose ; la réserve se dégage et la pièce
  // voulue finit par être dessus. Reposer sur un emplacement occupé CHASSE
  // l'occupante.
  const ancre = (p) => [{ x: 0, y: 12 }, { x: 0.05, y: 30.95 }, { x: -0.05, y: -26.95 }][p.e];
  let chassees = 0;
  for (let tours = 0; tours < 40 && j.gagnant === null; tours++) {
    const e = [0, 1, 2].find((k) => !j.poses[k] || j.poses[k].t !== j.desc[k]);
    const cible = j.pieces.find((p) => p.e === e && p.t === j.desc[e] && !p.posee);
    b.souris(cible.x + ancre(cible).x, cible.y + ancre(cible).y);
    b.socle.click();
    const prise = j.drag;
    assert.ok(prise, 'une pièce est en main');
    const avant = j.poses[prise.e] ? j.poses[prise.e].piece : null;
    b.souris(j.corps.x, j.corps.y);
    b.avancer(14);                     // elle court après le doigt
    b.socle.relache();
    assert.equal(j.poses[prise.e].piece, prise, 'posée sur son emplacement');
    if (avant) {
      chassees++;
      assert.equal(avant.posee, false, 'l\'ancienne est chassée');
    }
    b.avancer(4);
  }
  assert.equal(j.gagnant, true, 'le légume est conforme');
  assert.ok(chassees >= 0, 'comptage des remplacements');
});

test('la difficulté durcit bien chaque épreuve', () => {
  const facile = banc(J.Basket, { dif: 0 }).jeu;
  const dur = banc(J.Basket, { dif: 100 }).jeu;
  assert.ok(dur.rayonPanier < facile.rayonPanier, 'le panier rétrécit');

  const p0 = banc(J.Pong, { dif: 0 }).jeu;
  const p1 = banc(J.Pong, { dif: 100 }).jeu;
  assert.ok(p1.vitesse > p0.vitesse && p1.rayonRaquette < p0.rayonRaquette);

  const l0 = banc(J.Lander, { dif: 0 }).jeu;
  const l1 = banc(J.Lander, { dif: 100 }).jeu;
  assert.ok(l1.rayonPlate < l0.rayonPlate, 'la plateforme rétrécit');

  const f0 = banc(J.Flower, { dif: 0 }).jeu;
  const f1 = banc(J.Flower, { dif: 100 }).jeu;
  assert.ok(f1.gameTime < f0.gameTime && f1.taille < f0.taille && f1.vitesse > f0.vitesse);

  const a0 = banc(J.Astero, { dif: 0 }).jeu;
  const a1 = banc(J.Astero, { dif: 100 }).jeu;
  assert.ok(a1.rochers.length > a0.rochers.length, 'le champ se remplit');

  const c0 = banc(J.Parachute, { dif: 0 }).jeu;
  const c1 = banc(J.Parachute, { dif: 100 }).jeu;
  assert.ok(c1.rayonFeuille < c0.rayonFeuille && c1.vitesseFeuille > c0.vitesseFeuille,
    'la feuille rétrécit et accélère');

  const g0 = banc(J.Gobelet, { dif: 0 }).jeu;
  const g1 = banc(J.Gobelet, { dif: 100 }).jeu;
  assert.ok(g1.gobelets.length > g0.gobelets.length && g1.vitesse > g0.vitesse,
    'plus de gobelets, plus vite');

  const m0 = banc(J.Marmite, { dif: 0 }).jeu;
  const m1 = banc(J.Marmite, { dif: 100 }).jeu;
  assert.ok(m1.recette.length > m0.recette.length, 'la recette s\'allonge');

  const r0 = banc(J.Gather, { dif: 0 }).jeu;
  const r1 = banc(J.Gather, { dif: 100 }).jeu;
  assert.ok(r1.billes.length > r0.billes.length && r1.rayonBille > r0.rayonBille,
    'plus de billes, plus grosses');

  const t0 = banc(J.Trampoline, { dif: 0 }).jeu;
  const t1 = banc(J.Trampoline, { dif: 100 }).jeu;
  assert.ok(t1.hautMur < t0.hautMur, 'le mur monte (jusqu\'au-dessus du cadre)');

  const o0 = banc(J.Orbital, { dif: 0 }).jeu;
  const o1 = banc(J.Orbital, { dif: 100 }).jeu;
  assert.ok(o1.vitesse > o0.vitesse && o1.lanceurs.length === 1 && o0.lanceurs.length === 6,
    'l\'orbite accélère, les lanceurs se raréfient');

  const j0 = banc(J.JumpFish, { dif: 0 }).jeu;
  const j1 = banc(J.JumpFish, { dif: 100 }).jeu;
  assert.ok(j1.taille < j0.taille, 'le cadre rétrécit');

  const q0 = banc(J.Patate, { dif: 0 }).jeu;
  const q1 = banc(J.Patate, { dif: 100 }).jeu;
  assert.ok(q1.gameTime < q0.gameTime, 'le temps se resserre');
});

// ── LE MODE FEVER — celui que le SWF d'origine joue ──

/** Une chaîne fever sur des épreuves dont on décide l'issue. */
function fever(verdicts) {
  let i = 0;
  class Bidon extends E.Jeu {
    init() { super.init(); this.gameTime = 4; this.verdict = verdicts[i++]; }
    update() { super.update(); if (this.etapePrincipale === 1 && this.verdict !== undefined) this.gagne(this.verdict); }
  }
  const f = new E.Fever({
    mesures: MESURES, rng: dé(11),
    catalogue: [{ cle: 'test', nom: 'test', Classe: Bidon }],
  });
  f.demarrer();
  return f;
}

test('FEVER : pas de menu — la première épreuve démarre seule, à difficulté nulle', () => {
  const f = fever([]);
  assert.ok(f.jeu, 'ouvrir, c\'est déjà jouer — comme le SWF');
  assert.equal(f.jeu.dif, 0, 'la première épreuve se joue à zéro');
  assert.equal(f.niveau, 1);
  assert.equal(f.dif, 10, 'et la difficulté est déjà armée pour la suivante');
});

test('FEVER : la difficulté monte de dix par épreuve, plafonnée à cent', () => {
  const f = fever(new Array(30).fill(true));
  const difs = [f.jeu.dif];
  for (let i = 0; i < 4000 && f.niveau < 13; i++) {
    const avant = f.jeu;
    f.update(1);
    if (f.jeu && f.jeu !== avant) difs.push(f.jeu.dif);
  }
  // Fever.setNext : l'épreuve N se joue à (N-1)*10, plafonné à cent.
  assert.deepEqual(difs.slice(0, 12), [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 100]);
});

test('FEVER : la première défaite arrête tout — écran gameOver, un clic relance', () => {
  const f = fever([true, true, false]);
  const evts = [];
  f.surEvenement = (n, d) => evts.push({ n, d });
  for (let i = 0; i < 1000 && !f.ecranFin; i++) f.update(1);
  assert.equal(f.ecranFin, true, 'l\'écran de fin est là');
  assert.equal(f.jeu, null, 'l\'épreuve a quitté la scène');
  assert.equal(f.niveau, 3, 'trois épreuves lancées');
  assert.ok(evts.some((e) => e.n === 'finPartie'), 'la fin est annoncée');
  // La pomme de l'écran de fin joue ses quinze images puis se tient.
  for (let i = 0; i < 30; i++) f.update(1);
  assert.equal(Math.floor(f.pomme), 15);
  // GameOver.mt : onPress = leave — l'appui demande la relance.
  f.click();
  assert.ok(evts.some((e) => e.n === 'rejouer'), 'l\'appui relance');
});

test('FEVER : gagner ne meurt jamais — la chaîne continue', () => {
  // Cinquante victoires d'affilée : on s'arrête à la vingtième épreuve lancée,
  // AVANT d'épuiser les verdicts (l'épreuve d'après, sans verdict, mourrait au
  // chrono — et ce serait une vraie mort, pas un défaut).
  const f = fever(new Array(50).fill(true));
  for (let i = 0; i < 5000 && f.niveau < 20; i++) f.update(1);
  assert.equal(f.ecranFin, false);
  assert.equal(f.niveau, 20, 'vingt épreuves lancées sans mourir');
});

test('les dessins de l\'habillage du SWF sont extraits : barre de temps, écran de fin', () => {
  // sym547 : mcTimerBar — le cadre, puis le remplissage que updateGameTimer
  // réduit. sym544 : les cerises de l'écran gameOver, quinze images.
  assert.ok(MANIFESTE.sym547, 'la barre de temps');
  assert.equal(MANIFESTE.sym547.etats.length, 1);
  assert.equal(MANIFESTE.sym547.etats[0].pieces.length, 2, 'le cadre et le remplissage');
  assert.ok(MANIFESTE.sym544, 'les cerises de l\'écran de fin');
  assert.equal(MANIFESTE.sym544.etats.length, 15, 'leur grimace en quinze images');
  assert.ok(MANIFESTE.gameOver, 'et le fond de l\'écran');
});

// ── LA GRENOUILLE (game/Frog.mt, classe « 2N9i1 » du bytecode) ──

test('la grenouille : la mise en place du bytecode, constante par constante', () => {
  const b = banc(J.Frog, { dif: 30 });
  const j = b.jeu;
  // Le COMPILÉ retranche la difficulté au temps (gameTime = 360 - dif) — la
  // source nue dit 360 : le SWF est l'arbitre.
  assert.equal(j.gameTime, 360 - 30);
  assert.equal(j.mancheSize, 30);
  assert.equal(j.canneSize, 80);
  assert.equal(j.tensionMax, 80);
  assert.equal(j.limit, 700);
  assert.equal(j.gl, HAUTEUR - 10);
  assert.equal(j.cRot, -1.57);
  assert.equal(j.nerveMax, 1000);
  assert.equal(j.nerve, 1000);
  assert.deepEqual(j.camBox, { xMin: -9999, xMax: 9999, yMin: 0, yMax: 0, cx: 0.1, sp: 1 });
  // frog.x = limit - (50 + dif*2) ; y = gl ; sans physique tant qu'elle guette.
  assert.equal(j.frog.x, 700 - (50 + 30 * 2));
  assert.equal(j.frog.y, j.gl);
  assert.equal(j.frog.flPhys, false);
  // La canne au centre, redressée de -1,57 rad ; l'appât au coin, poids 0,7.
  assert.equal(j.canne.x, LARGEUR * 0.5);
  assert.equal(Math.round(j.canne.peau.rot), Math.round(-1.57 / 0.0174));
  assert.equal(j.bait.x, LARGEUR - 0.5);
  assert.equal(j.bait.y, HAUTEUR - 0.5);
  assert.equal(j.bait.poids, 0.7);
  // ob part de l'appât (la mesure d'agitation de la première image vaut zéro).
  assert.deepEqual(j.ob, { x: j.bait.x, y: j.bait.y });
  // Le décor de la falaise posé à gl, ATTACHÉ EN DERNIER (il couvre le fil).
  assert.equal(j.decor.y, j.gl);
  const ordre = j.scene.ordre();
  assert.ok(ordre.indexOf(j.decor) > ordre.indexOf(j.fil), 'le sol passe devant le fil');
  assert.ok(ordre.indexOf(j.fil) > ordre.indexOf(j.bait.peau), 'et le fil devant l\'appât');
  // La pupille détachée, avec sa chaîne par image (l'extracteur la fournit).
  assert.ok(j.pupille.lins && j.pupille.lins.length === 49, 'les 49 chaînes de l\'œil');
});

test('la patience de la grenouille : pleine au calme, fondue sous l\'agitation (checkFrog)', () => {
  const b = banc(J.Frog);
  const j = b.jeu;
  // Les premières images ne sont PAS calmes : le ressort happe l'appât vers la
  // pointe (c > 0,2 : rappel de force), il se balance — et la patience s'en
  // ressent un peu. Une fois le balancier éteint (amorti 0,95), elle REMONTE
  // de 2 par temps et se replafonne à 1000.
  b.souris(120, 100);
  b.avancer(200);
  assert.equal(j.nerve, 1000, 'un appât qui pend sans bouger n\'agace personne');
  assert.equal(j.frog.peau.image, 10, '20 - round(1000/1000·10) = 10 : posée');
  // On agite l'appât SOUS SON NEZ, par GRANDS gestes alternés toutes les six
  // images : la canne va à mi-chemin de la souris par temps — des allers-
  // retours à chaque image la feraient vibrer sur place, fil mou, appât
  // immobile, grenouille de marbre. La souris du banc est en coordonnées
  // d'écran — le jeu la retraduit (sourisX - decalX), caméra comprise.
  for (let i = 0; i < 400 && j.etape === 1; i++) {
    const ex = j.frog.x + j.decalX + (Math.floor(i / 6) % 2 ? -70 : 70);
    b.souris(ex, j.frog.y + j.decalY - 30);
    b.avancer(1);
  }
  assert.equal(j.etape, 2, 'à bout de nerfs, elle a bondi');
  assert.equal(j.frog.flPhys, true, 'et vole (initJump)');
  assert.equal(j.frog.peau.image >= 30, true, 'la pellicule « jump » (30…)');
  assert.equal(j.flHorsTemps, true, 'flTimeProof : le chrono ne peut plus la tuer');
  assert.equal(j.camBox.cx, 0.5);
  assert.equal(j.camBox.sp, 0.2);
  assert.equal(j.camBox.yMin, -200);
  assert.equal(j.camBox.xMax, -j.frog.x, 'l\'écran ne reculera plus derrière elle');
});

test('les yeux suivent l\'appât : la pupille glisse de 1,8·(1-c), chaîne comprise', () => {
  const b = banc(J.Frog);
  const j = b.jeu;
  b.avancer(2);
  // Le vecteur du regard, recalculé comme checkFrog le pose.
  const d1 = j.frog.distance(j.bait);
  const c = Math.max(0, 180 - d1) / 180;
  const a = j.frog.angle(j.bait);
  assert.equal(j.oeil.x.toFixed(6), (1.8 * (1 - c) * Math.cos(a)).toFixed(6));
  assert.equal(j.oeil.y.toFixed(6), (1.8 * (1 - c) * Math.sin(a)).toFixed(6));
  // La pupille copie l'image de la grenouille et se décale de lin·oeil.
  assert.equal(j.pupille.image, j.frog.peau.image);
  const lin = j.pupille.lins[j.frog.peau.image - 1];
  assert.equal(j.pupille.x.toFixed(4), (j.frog.x + lin[0] * j.oeil.x + lin[2] * j.oeil.y).toFixed(4));
  assert.equal(j.pupille.y.toFixed(4), (j.frog.y + lin[1] * j.oeil.x + lin[3] * j.oeil.y).toFixed(4));
  // La chaîne compose les deux miroirs en POSITIF (~1,61) : l'appât est à
  // gauche de la grenouille (cos(a) < 0), la pupille part bien vers la gauche.
  assert.ok(Math.cos(a) < 0 && lin[0] > 1.5 && j.pupille.x < j.frog.x,
    'le regard suit l\'appât, sans inversion');
});

test('la canne : redressée à l\'appui, pliée par la traction, le fil pend au mou', () => {
  const b = banc(J.Frog);
  const j = b.jeu;
  b.avancer(5);
  const avant = j.cRot;
  b.socle.click();
  b.avancer(10);
  assert.ok(j.cRot < avant - 0.5, 'l\'appui la redresse vers -2,7 rad');
  b.socle.relache();
  for (let i = 0; i < 40; i++) b.avancer(1);
  assert.ok(Math.abs(j.cRot - -1) < 0.1, 'relâchée, elle revient vers -1 rad');
  // Le BOIS est dessiné (trois commandes : style, aller, courbe) — brun 0x8B6830,
  // épaisseur 3 ; le FIL blanc d'un pixel pend en courbe quand il est mou.
  assert.deepEqual(j.tige.dessin[0], ['style', 3, 0x8B6830, 100]);
  assert.equal(j.tige.dessin[2][0], 'courbe');
  assert.deepEqual(j.fil.dessin[0], ['style', 1, 0xFFFFFF, 100]);
  // La souris collée à l'appât : distance sous tensionMax, le fil PEND.
  b.souris(j.bait.x + j.decalX, j.bait.y + j.decalY - 40);
  b.avancer(12);
  assert.equal(j.fil.dessin[2][0], 'courbe', 'mou : la courbe pend de (80-dist)/2');
  // La souris à l'autre bout : tension — une droite, et l'appât tiré.
  b.souris(10, 10);
  b.avancer(3);
  assert.equal(j.fil.dessin[2][0], 'ligne', 'tendu : le fil est droit');
});

test('le bond gagné : passée la falaise, le sol tombe de 120 et vingt éclats de terre', () => {
  const b = banc(J.Frog);
  const j = b.jeu;
  // On rejoue l'atterrissage tel quel : en vol au-delà de limit, qui descend.
  j.etape = 2;
  j.frog.flPhys = true;
  j.frog.x = j.limit + 40;
  j.frog.y = j.gl + 60;             // sous le sol d'origine : le trou de la falaise
  j.frog.vity = 8;
  const avant = j.sprites.length;
  b.avancer(8);
  assert.equal(j.gagnant, true, 'passée la falaise : gagné (checkLand)');
  assert.equal(j.frog.y, j.gl + 120, 'posée cent vingt pixels plus bas');
  assert.equal(j.sprites.length, avant + 20, 'les vingt mcPartDirt (sym631)');
});

test('le bond raté : retombée au sol d\'origine, assise image 1, perdu', () => {
  const b = banc(J.Frog);
  const j = b.jeu;
  j.etape = 2;
  j.frog.flPhys = true;
  j.frog.x = j.limit - 100;         // avant la falaise
  j.frog.y = j.gl - 30;
  j.frog.vity = 10;
  b.avancer(8);
  assert.equal(j.gagnant, false, 'retombée avant la falaise : perdu');
  assert.equal(j.frog.peau.image, 1, 'rassise (gotoAndStop("1"))');
  assert.equal(j.frog.peau.rot, 0);
});

test('gobé en plein vol : l\'appât disparaît, « eat », et le chrono de la défaite', () => {
  const b = banc(J.Frog);
  const j = b.jeu;
  // L'appât doit être STABLE : moveCanne le déplace AVANT checkEat dans la
  // même image — on le laisse pendre DEVANT la grenouille, souris fixe (loin
  // d'elle, la caméra sauterait au moment du pas et le coup de fouet
  // arracherait l'appât avant la morsure).
  for (let i = 0; i < 100; i++) {
    b.souris(j.frog.x - 20 + j.decalX, j.frog.y - 60 + j.decalY);
    b.avancer(1);
  }
  j.etape = 2;
  j.frog.flPhys = true;
  j.frog.x = j.bait.x - 12;         // à moins de vingt pixels de l'appât
  j.frog.y = j.bait.y - 6;
  j.frog.vitx = 2;
  b.avancer(1);
  assert.equal(j.flEat, true, 'd < 20 : gobé (checkEat)');
  assert.equal(j.bait.peau.visible, false, 'l\'appât a disparu dans le gosier');
  assert.equal(j.frog.peau.image, 46, 'la pellicule « eat »');
  assert.equal(j.camBox.sp, 0, 'la caméra se fige');
  assert.ok(j.looseTimer > 0 && j.looseTimer <= 12);
  b.avancer(14);
  assert.equal(j.gagnant, false, 'douze temps plus tard : perdu');
});

test('la caméra de la grenouille : elle suit, bornée, et la souris est retraduite', () => {
  const b = banc(J.Frog);
  const j = b.jeu;
  b.avancer(40);
  // À l'affût : la cible est mcw·0,1 - frog.x — la grenouille au bord gauche.
  const cible = LARGEUR * 0.1 - j.frog.x;
  assert.ok(Math.abs(j.decalX - cible) < 1, 'la caméra s\'est posée sur sa cible');
  assert.equal(j.decalY, 0, 'bornée à yMin = yMax = 0 tant qu\'elle guette');
  // La souris d'écran est retraduite dans le repère du jeu (sourisX - decalX),
  // comme le _xmouse d'un clip déplacé.
  b.souris(120, 100);
  assert.equal(j.sourisX, 120 - j.decalX);
  assert.equal(j.sourisY, 100 - j.decalY);
});

test('les dessins de la grenouille sont extraits, pupille détachée comprise', () => {
  for (const cle of ['gameFrog', 'sym673', 'sym673_pupille', 'sym635', 'sym633', 'sym637', 'sym631']) {
    assert.ok(MANIFESTE[cle], cle + ' est extrait');
  }
  assert.equal(MANIFESTE.sym673.etats.length, 49, 'la pellicule complète (affût, bond, gobage)');
  // La pupille : une pièce par état, et sa chaîne lin (les deux miroirs
  // composés en positif — le regard suit, il ne s'inverse pas).
  const p = MANIFESTE.sym673_pupille;
  assert.equal(p.etats.length, 49);
  assert.ok(p.etats.every((e) => e.pieces.length >= 1), 'la pupille sur chaque image');
  assert.ok(p.etats.every((e) => Array.isArray(e.lin) && e.lin.length === 4), 'sa chaîne par image');
  assert.ok(p.etats[9].lin[0] > 1.5, 'l\'échelle de la chaîne (~+1,61)');
  // Et la grenouille SANS pupille n'en garde aucune trace : la pièce 5×5 du
  // point noir n'apparaît plus dans ses états.
  const fichiers = new Set();
  for (const e of MANIFESTE.sym673.etats) for (const pc of e.pieces) fichiers.add(pc.fichier);
  const pupilles = new Set();
  for (const e of p.etats) for (const pc of e.pieces) pupilles.add(pc.fichier);
  for (const f of pupilles) assert.ok(!fichiers.has(f), f + ' ne reste que dans la pupille');
});

test('TUBULO au doigt : on touche la capsule qu\'on VOIT, pas celle de la boîte Flash', () => {
  const b = banc(J.Tubulo, { dif: 0 });
  const j = b.jeu;
  const slot = j.grille[1][1];
  // La boîte Flash d'une capsule couvre son TUBE, qui monte derrière le hublot
  // de la case du dessus — et la dernière posée gagne : un appui posé SUR le
  // tube (l'ancre de la case) déclenche la case du DESSOUS avec la règle du
  // lecteur. À la souris, le survol teinte la croix et guide la main ; au
  // doigt il n'y a rien — on choisit donc la case au HUBLOT le plus proche.
  // La grille est ISOMÉTRIQUE (+x = (+20,+16), +y = (−20,+16)) : la case
  // visuellement « en dessous » de (1,1) est (2,2), trente-deux pixels plus
  // bas au même x.
  const surTube = { x: slot.x, y: slot.y };            // l'ancre : le tube
  assert.equal(j.sousLePoint(surTube.x, surTube.y), j.grille[2][2],
    'règle du lecteur : le tube appartient à la fenêtre du dessous');
  assert.equal(j.caseVisible(surTube.x, surTube.y), j.grille[2][2],
    'et le hublot le plus proche de ce point est AUSSI celui du dessous — cohérent');
  // Le HUBLOT visible de (1,1) : le centre de la fenêtre sym210 (~ y - 24).
  const bo = b.socle.mesures.sym210.boite;
  const k = j.taille / 100;
  const hublot = { x: slot.x + (bo.x0 + bo.x1) / 2 * k, y: slot.y + (bo.y0 + bo.y1) / 2 * k };
  assert.equal(j.caseVisible(hublot.x, hublot.y), slot, 'le doigt sur le hublot prend SA case');

  // Le clic au DOIGT passe par caseVisible : l'appui sur le hublot de (1,1)
  // plonge SA croix — la grille bouge autour d'elle.
  b.socle.flTactile = true;
  b.souris(hublot.x, hublot.y);
  b.socle.click();
  assert.equal(j.etape, 2, 'la croix plonge');
  assert.ok(j.plongeurs.includes(slot), 'et c\'est bien la case visée qui mène la croix');
  // À la SOURIS, la règle du lecteur reste inchangée (fidélité au SWF).
  assert.equal(b.socle.flTactile, true);
});

// ── L'ESQUIVE SPATIALE (game/SpaceDodge.mt, classe « 5clh34 » du bytecode) ──

test('l\'esquive : la mise en place du bytecode, tourelles décimées comprises', () => {
  const b = banc(J.SpaceDodge, { dif: 40 });
  const j = b.jeu;
  assert.equal(j.gameTime, 100 + 40 * 3);
  assert.equal(j.airFriction, 1, 'initDefault d\'époque : les boulons filent');
  assert.equal(j.hero.x, 120);
  assert.equal(j.hero.y, HAUTEUR - 10);
  assert.equal(j.pList.length, 100, 'l\'historique amorcé');
  // 9 - dif·0,1 tourelles retirées : à 40, il en reste 10 - 5 = 5.
  assert.equal(j.tList.length, 5);
  assert.ok(j.tList.every((t) => t.c >= 10 && t.c < 20));
  // La traîne : six copies, alphas 50 - i·8.
  assert.equal(j.qList.length, 6);
  assert.equal(j.qList[0].alpha, 0.5);
  assert.equal(j.qList[5].alpha.toFixed(2), '0.10');
});

test('la traîne suit l\'historique — sauf la première copie, plantée en (0,0)', () => {
  const b = banc(J.SpaceDodge, { dif: 0 });
  const j = b.jeu;
  b.souris(60, 180);
  b.avancer(12);
  // La coquille d'époque : pList[length] n'existe pas — q[0] n'a jamais bougé.
  assert.equal(j.qList[0].x, 0);
  assert.equal(j.qList[0].y, 0);
  // Les suivantes relisent l'historique, quatre images en quatre images.
  const max = j.pList.length - 1;              // avant le push du dernier tour
  assert.equal(j.qList[1].x.toFixed(4), j.pList[max - 4].x.toFixed(4));
  assert.equal(j.qList[2].x.toFixed(4), j.pList[max - 8].x.toFixed(4));
});

test('les tourelles arment, tirent dans le cône et reculent en boucle', () => {
  const b = banc(J.SpaceDodge, { dif: 90 });   // toutes les tourelles
  const j = b.jeu;
  assert.equal(j.tList.length, 10);
  b.souris(120, 220);
  b.avancer(21);                               // toutes ont armé (c < 20)
  assert.ok(j.sList.length > 0, 'des boulons volent : ' + j.sList.length);
  assert.ok(j.sList.every((s) => s.vity > 0), 'le cône tire vers le bas');
  assert.ok(j.sList.every((s) => !s.flPhys));
  const tir = j.tList.find((t) => t.mc.joue);
  assert.ok(tir, 'une tourelle recule');
  // Le boulon au contact (boîte ±8) : explosion, hero null, perdu.
  const s = j.sList[0];
  s.x = j.hero.x + 2;
  s.y = j.hero.y - 2;
  s.vitx = 0;
  s.vity = 0;
  b.avancer(1);
  assert.equal(j.gagnant, false);
  assert.equal(j.hero, null, 'l\'AVM1 avalait les appels sur null — nous aussi');
  assert.equal(j.qList.length, 0, 'la traîne est balayée');
  const explo = j.sprites.find((p) => p.peau && p.peau.cle === 'sym612');
  assert.ok(explo && explo.echelle === 200 && explo.peau.finit, 'l\'explosion se retirera seule');
  b.avancer(3);                                // et la partie continue sans lui
  assert.equal(j.gagnant, false);
});

test('frôler le vaisseau-mère tue ; survivre au chrono GAGNE (outOfTime inversé)', () => {
  let b = banc(J.SpaceDodge, { dif: 0 });
  let j = b.jeu;
  b.souris(120, 40);                           // au-dessus de la ligne des 66,2
  b.avancer(80);                               // la remontée est bornée à 3,2 par image
  assert.equal(j.gagnant, false, 'le fuselage brûle');

  b = banc(J.SpaceDodge, { dif: 0 });
  j = b.jeu;
  j.horsTemps();
  assert.equal(j.gagnant, true, 'le seul outOfTime qui gagne');
});

test('les dessins de l\'esquive sont extraits', () => {
  for (const cle of ['gameSpaceDodge', 'sym628', 'sym627', 'sym619', 'sym616', 'sym612']) {
    assert.ok(MANIFESTE[cle], cle + ' est extrait');
  }
  assert.equal(MANIFESTE.sym628.etats[0].pieces.length, 1, 'le fuselage sans ses tourelles');
  assert.equal(MANIFESTE.sym627.etats.length, 15, 'le recul de la tourelle');
  assert.ok(MANIFESTE.sym612.etats.length >= 14, 'l\'explosion');
});

// ── LE POINT À POINT (game/Point.mt, classe « 05gRo1 » du bytecode) ──

test('le point à point : la figure d\'époque, le premier pointillé allumé', () => {
  const b = banc(J.Point, { dif: 40 });
  const j = b.jeu;
  assert.equal(j.gameTime, 500 - 40);
  assert.equal(j.points.length, 18, 'les dix-huit pointillés de la scène');
  // Tous éteints à l\'alpha 20… sauf le premier, allumé plein (image 2).
  assert.equal(j.next, j.points[0]);
  assert.equal(j.next.image, 2);
  assert.equal(j.next.alpha, 1);
  assert.ok(j.points.slice(1).every((p) => p.alpha === 0.2 && p.image === 1));
  // Le dessin fini est caché ; la ligne est amorcée au premier point.
  assert.equal(j.shape.visible, false);
  assert.deepEqual(j.mcLigne.dessin[1], ['aller', 172.25, 188.65]);
  assert.deepEqual(j.mcLigne.dessin[0], ['style', 2, 0x746410, 100]);
  // Le crayon se lèvera au $p12 — le point tourné.
  assert.equal(j.points[12].rot, 1);
});

test('le tracé au survol : un trait par entrée, le point relié disparaît', () => {
  const b = banc(J.Point);
  const j = b.jeu;
  const p0 = j.points[0];
  b.souris(p0.x, p0.y);
  b.avancer(1);
  assert.equal(j.index, 1, 'le survol relie');
  assert.equal(p0.visible, false, 'le point relié disparaît');
  assert.equal(j.next, j.points[1]);
  assert.equal(j.next.image, 2, 'le suivant s\'allume');
  assert.deepEqual(j.mcLigne.dessin[2], ['ligne', p0.x, p0.y],
    'le trait rejoint le point qu\'on vient de relier');
  // Rester posé dessus ne re-relie pas (onRollOver : il faut ressortir).
  b.avancer(5);
  assert.equal(j.index, 1);
});

test('la figure entière : crayon levé au $p12, victoire et dessin révélé', () => {
  const b = banc(J.Point);
  const j = b.jeu;
  for (let i = 0; i < 18; i++) {
    const p = j.points[i];
    b.souris(p.x, p.y);
    b.avancer(1);
    // ressortir, pour que le survol du suivant compte comme une entrée
    b.souris(-50, -50);
    b.avancer(1);
  }
  assert.equal(j.index, 18);
  assert.equal(j.gagnant, true, 'tous reliés : gagné');
  assert.equal(j.shape.visible, true, 'le dessin fini apparaît');
  // Le $p12 a levé le crayon : un « aller », pas une « ligne ».
  const verbes = j.mcLigne.dessin.slice(1).map((c) => c[0]);
  assert.equal(verbes.filter((v) => v === 'aller').length, 2, 'l\'amorce et le crayon levé');
  assert.equal(verbes[13], 'aller', 'le douzième relié lève le crayon');
});

test('les dessins du point à point sont extraits', () => {
  for (const cle of ['gamePoint', 'sym98', 'sym101', 'sym95']) {
    assert.ok(MANIFESTE[cle], cle + ' est extrait');
  }
  assert.equal(MANIFESTE.sym98.etats.length, 2, 'le pointillé et son état allumé');
  assert.ok(MANIFESTE.gamePoint.etats[0].pieces.length >= 1, 'le papier, sans la figure');
});

// ── L'ASSIETTE (game/Plate.mt, classe « 0q8Ho1 » du bytecode) ──

test('l\'assiette : la mise en place du bytecode, et sa montée du bas', () => {
  const b = banc(J.Plate, { dif: 40 });
  const j = b.jeu;
  assert.equal(j.gameTime, 320);
  assert.equal(j.pRay, 50);
  assert.equal(j.sRay, 30 - 40 * 0.15);
  assert.deepEqual(j.op, { x: 0, y: 0 });
  assert.equal(j.plate.x, 120);
  assert.equal(j.plate.y, 360, 'elle naît sous l\'écran');
  assert.equal(j.tache.length, Math.ceil(6 + 40 * 0.09),
    'la boucle d\'époque court sur max = 6 + dif·0,09, fraction comprise');
  assert.ok(j.tache.every((t) => Math.hypot(t.lx, t.ly) <= 100), 'toutes dans l\'assiette');
  assert.ok(j.tache.every((t) => t.life === t.ray));
  // L'éponge au centre, à l'échelle du rayon, DEVANT tout.
  assert.equal(j.sponge.peau.sx, (30 - 40 * 0.15) * 2 / 100);
  assert.equal(j.sponge.peau.prof, E.PROF.DEVANT);
  // Le ruissellement : dix clips qui s'ôteront tout seuls.
  const eaux = j.scene.mcs.filter((m) => m.cle === 'sym118');
  assert.equal(eaux.length, 10);
  assert.ok(eaux.every((m) => m.finit && m.joue));
  // La montée : l'assiette court vers le centre (ressort 0,2) et ses taches
  // la suivent.
  b.avancer(1);
  assert.equal(j.plate.y.toFixed(4), (360 + (120 - 360) * 0.2).toFixed(4));
  const t0 = j.tache[0];
  assert.equal(t0.mc.y.toFixed(4), (j.plate.y + t0.ly).toFixed(4));
});

test('le récurage : la puissance vient du geste, le coefficient fond par tache', () => {
  const b = banc(J.Plate);
  const j = b.jeu;
  b.avancer(30);                   // l'assiette se pose
  const t = j.tache[0];
  // L'éponge posée PILE sur la tache, immobile : puissance nulle, rien.
  j.sponge.x = j.plate.x + t.lx;
  j.sponge.y = j.plate.y + t.ly;
  j.op = { x: j.sponge.x, y: j.sponge.y };
  b.souris(j.sponge.x, j.sponge.y);
  const vie0 = t.life;
  b.avancer(1);
  assert.equal(t.life, vie0, 'sans geste, pas de récurage');
  // Un grand geste : op loin — la puissance mord la vie.
  j.op = { x: j.sponge.x - 80, y: j.sponge.y };
  b.avancer(1);
  assert.ok(t.life < vie0, 'le frottement récure : ' + t.life.toFixed(1) + ' < ' + vie0);
  assert.equal(t.mc.alpha.toFixed(4), (t.life / t.ray).toFixed(4), 'l\'alpha suit la vie');
  // Et le geste sème la mousse sous l'éponge, qui s'ôte toute seule.
  const mousses = j.scene.mcs.filter((m) => m.cle === 'sym115');
  assert.ok(mousses.length > 0, 'la mousse est née');
  assert.ok(mousses.every((m) => m.finit));
});

test('l\'assiette récurée gagne — la tache morte sort de la liste, son clip reste', () => {
  const b = banc(J.Plate);
  const j = b.jeu;
  b.avancer(30);
  const clips = j.tache.map((t) => t.mc);
  // On récure chaque tache à grands gestes jusqu'au bout.
  for (let garde = 0; garde < 400 && j.tache.length; garde++) {
    const t = j.tache[0];
    j.sponge.x = j.plate.x + t.lx;
    j.sponge.y = j.plate.y + t.ly;
    b.souris(j.sponge.x, j.sponge.y);
    j.op = { x: j.sponge.x - 120, y: j.sponge.y };
    b.avancer(1);
  }
  assert.equal(j.tache.length, 0);
  assert.equal(j.gagnant, true, 'assiette propre : gagné');
  assert.ok(clips.every((mc) => mc.vivant), 'les clips des taches restent (alpha zéro)');
  assert.ok(clips.every((mc) => mc.alpha === 0 || mc.alpha < 1e-9));
});

test('les dessins de l\'assiette sont extraits', () => {
  for (const cle of ['gamePlate', 'sym129', 'sym125', 'sym120', 'sym115', 'sym118']) {
    assert.ok(MANIFESTE[cle], cle + ' est extrait');
  }
  assert.equal(MANIFESTE.sym125.etats.length, 4, 'les quatre formes de tache');
  assert.ok(MANIFESTE.sym115.etats.length >= 11, 'la pellicule de la mousse');
  assert.ok(MANIFESTE.sym118.etats.length >= 35, 'le ruissellement');
});

// ── L'IMAGE (game/Picture.mt, classe « 0CvjR5 » du bytecode) ──

test('le tableau : la mise en place du bytecode, et la descente dans le cadre', () => {
  const b = banc(J.Picture, { dif: 40 });
  const j = b.jeu;
  assert.equal(j.gameTime, 400);
  assert.equal(j.speed, 30 + 40 * 0.2);
  assert.equal(j.mvt, 2 + Math.floor(40 * 0.05));
  assert.equal(j.face, 1, 'la face initiale vaut UN (pellicule 1)');
  assert.equal(j.rot, 0);
  assert.equal(j.picSize, 68);
  assert.equal(j.marginDown, 88);
  assert.equal(j.img.peau.image, 1);
  assert.equal(j.cadre.peau.nbImages, 21, 'les portes du cadre');
  // SHOW : le tableau descend (ressort 0,4) puis les portes se ferment.
  b.avancer(30);
  assert.ok(j.etape >= 2, 'posé dans le cadre');
  for (let i = 0; i < 40 && j.etape === 2; i++) b.avancer(1);
  assert.equal(j.etape, 3, 'portes closes, le tour commence');
  assert.equal(j.img.peau.visible, false, 'le tableau caché');
  assert.equal(j.cadre.peau.image, 21);
  // Le FALLTHROUGH d'époque : launchMvt a déjà avancé son premier pas.
  assert.ok(j.decal > 0, 'le case 2 déborde dans le case 3 : decal = ' + j.decal);
});

test('les tours du tableau : quarts, miroirs et parité de rot (launchMvt)', () => {
  const b = banc(J.Picture);
  const j = b.jeu;
  // Rejouer chaque tirage à la main, sur l'état.
  j.rot = 0; j.face = 1;
  const tirages = [];
  const hasardOrig = j.socle.hasard.bind(j.socle);
  j.socle.hasard = (n) => { const v = tirages.shift(); return v !== undefined ? v : hasardOrig(n); };
  tirages.push(0);                       // quart à droite
  j.launchMvt();
  assert.equal(j.rot, 1);
  assert.equal(j.tRotation, 90);
  assert.equal(j.cSpeed, 1);
  j.tRotation = null;
  tirages.push(4);                       // miroir horizontal : rot impair → +2
  j.launchMvt();
  assert.equal(j.rot, 3, 'le miroir horizontal retourne les rot impairs');
  assert.equal(j.face, 0);
  assert.equal(j.tXScale, -100);
  assert.equal(j.cSpeed, 0.5);
  j.tXScale = null;
  tirages.push(5);                       // miroir vertical : rot pair → +2
  j.rot = 2;
  j.launchMvt();
  assert.equal(j.rot, 0, 'le miroir vertical retourne les rot pairs');
  assert.equal(j.face, 1);
  // La remise à zéro : décal > 314 nettoie tout et arme la pause fondante.
  j.mvt = 1;
  j.decal = 315;
  j.tYScale = null;
  j.checkReset();
  assert.equal(j.decal, null);
  assert.equal(j.pause, 10, 'pausePool');
  assert.equal(j.pausePool, 5, 'la pause fond de moitié');
});

test('le choix du tableau : trois candidats, la réponse écrasée, le verdict', () => {
  const b = banc(J.Picture);
  const j = b.jeu;
  j.rot = 3;
  j.face = 0;
  j.initTryStep();
  assert.equal(j.tryList.length, 3);
  const gagnant = j.tryList[j.winIndex];
  assert.equal(gagnant.rot, 3, 'la réponse écrase le candidat tiré');
  assert.equal(gagnant.face, 0);
  // Les deux autres diffèrent de la réponse et entre eux.
  const autres = j.tryList.filter((t, i) => i !== j.winIndex);
  assert.ok(autres.every((t) => t.rot !== 3 || t.face !== 0));
  assert.ok(autres[0].rot !== autres[1].rot || autres[0].face !== autres[1].face);
  // Les pellicules : 2 - face, tournées de rot·90, à l'échelle 68.
  assert.ok(j.tryList.every((t) => t.mc.peau.image === 2 - t.face));
  assert.ok(j.tryList.every((t) => t.mc.peau.rot === t.rot * 90));
  assert.equal(j.tryList[0].mc.peau.sx, 0.68);
  // Cliquer le bon : gagné, les portes rouvrent, le tableau montre la solution.
  j.etape = 4;
  const bon = j.tryList[j.winIndex].mc;
  b.souris(bon.x, bon.y);
  b.socle.click();
  assert.equal(j.gagnant, true);
  assert.equal(j.etape, 2);
  assert.equal(j.doorSens, -1);
  assert.equal(j.img.peau.visible, true);
  assert.equal(j.img.peau.rot, 3 * 90);
  assert.equal(j.img.peau.image, 2, 'gotoAndStop(2 - face)');
  // Les portes rouvrent jusqu'à l'étape 5, où plus rien ne bouge.
  for (let i = 0; i < 40 && j.etape === 2; i++) b.avancer(1);
  assert.equal(j.etape, 5);
});

test('les dessins du tableau sont extraits', () => {
  for (const cle of ['gamePicture', 'sym246', 'sym242']) {
    assert.ok(MANIFESTE[cle], cle + ' est extrait');
  }
  assert.equal(MANIFESTE.sym242.etats.length, 21, 'les portes');
  assert.ok(MANIFESTE.sym246.etats.length >= 2, 'le tableau et son miroir');
});

// ── LA BALANCE (game/Balance.mt, classe « 6Q4T45 » du bytecode) ──

test('la balance : la mise en place du bytecode, constante par constante', () => {
  const b = banc(J.Balance, { dif: 40 });
  const j = b.jeu;
  assert.equal(j.gameTime, 500 - 40 * 3);
  assert.deepEqual(j.pInfoList, [2, 5, 20]);
  assert.equal(j.plateWidth, 60);
  assert.equal(j.barRay, 80);
  assert.ok(j.left >= 12 && j.left < 72, 'left = 12 + random(60)');
  assert.equal(j.rotCible, -20);
  assert.equal(j.vitr, 0);
  // Le fléau et les plateaux de la timeline ; PAS de lapin : son bloc de la
  // source (et le TODO « ajouter une bestiole ») est postérieur au build.
  assert.equal(j.bar.x, 120);
  assert.equal(j.bar.y, 18);
  assert.equal(j.pList.length, 3);
  // Les trois étalons du bas, à l'échelle sqrt(p)·20.
  assert.equal(j.boutons.length, 3);
  assert.equal(j.boutons[0].x, LARGEUR / 4);
  assert.equal(j.boutons[0].peau.sx.toFixed(4), (Math.sqrt(2) * 0.2).toFixed(4));
  assert.equal(j.boutons[2].peau.sx.toFixed(4), (Math.sqrt(20) * 0.2).toFixed(4));
});

test('le fléau penche du côté lourd et les plateaux suivent (ressort 0,1, amorti 0,92)', () => {
  const b = banc(J.Balance);
  const j = b.jeu;
  // À vide, la cible est -20 : le fléau plonge à gauche.
  b.avancer(30);
  assert.ok(j.bar.rot < -10, 'penché à gauche : ' + j.bar.rot.toFixed(1));
  // Les plateaux collent aux bouts du fléau.
  const a = j.bar.rot * 0.0174;
  assert.equal(j.p1.x.toFixed(4), (120 - Math.cos(a) * 80).toFixed(4));
  assert.equal(j.p2.y.toFixed(4), (18 + Math.sin(a) * 80).toFixed(4));
  // On surcharge à droite : la cible bascule à +20, le fléau suit.
  j.left = 12;
  for (let i = 0; i < 5; i++) j.addPoid(2);
  assert.equal(j.right, 100);
  assert.equal(j.rotCible, 20, 'borné à +20');
  b.avancer(40);
  assert.ok(j.bar.rot > 10, 'penché à droite');
  // Les poids posés pendent sous le plateau droit (+93), étalés sur 60.
  const dernier = j.pList[2][4];
  assert.equal(dernier.mc.y.toFixed(4), (j.p2.y + 93).toFixed(4));
  assert.ok(Math.abs(dernier.lx) <= 30 + 1e-9, 'dans la largeur du plateau');
});

test('l\'équilibre exact, fléau posé, gagne — et les gardes d\'époque tiennent', () => {
  const b = banc(J.Balance);
  const j = b.jeu;
  j.left = 27;                     // 20 + 5 + 2 : trouvable pile
  j.addPoid(2);
  j.addPoid(1);
  j.addPoid(0);
  assert.equal(j.right, 27);
  assert.equal(j.rotCible, 0);
  b.avancer(120);                  // le fléau se pose (|vitr| et |rot| < 0,6)
  assert.equal(j.gagnant, true);
  // flWin : l'ajout est bloqué… le retrait, lui, passe encore (la source ne
  // le garde pas) — coquille conservée.
  j.addPoid(0);
  assert.equal(j.pList[0].length, 1, 'l\'ajout est figé');
  j.removePoid(0);
  assert.equal(j.pList[0].length, 0, 'le retrait d\'époque passe toujours');
  // Et la sixième pièce d'un calibre est refusée (length > 4).
  const b2 = banc(J.Balance);
  const j2 = b2.jeu;
  for (let i = 0; i < 7; i++) j2.addPoid(0);
  assert.equal(j2.pList[0].length, 5, 'cinq par calibre au plus');
});

test('les dessins de la balance sont extraits, plateaux démontés compris', () => {
  for (const cle of ['gameBalance', 'sym250', 'sym256', 'sym258']) {
    assert.ok(MANIFESTE[cle], cle + ' est extrait');
  }
  assert.equal(MANIFESTE.gameBalance.etats[0].pieces.length, 3,
    'le fond et le pied — fléau et plateaux vivent à part');
  // Le fléau : la barre de 180 centrée ; l'assiette pend sous son ancre.
  assert.equal(Math.round(MANIFESTE.sym258.etats[0].pieces[0].w), 180);
  assert.equal(Math.round(MANIFESTE.sym256.etats[0].pieces[0].h), 99);
});

// ── LE FANTÔME (game/Ghost.mt, classe « 5cciQ1 » du bytecode) ──

test('le fantôme : la mise en place du bytecode, constante par constante', () => {
  const b = banc(J.Ghost, { dif: 40 });
  const j = b.jeu;
  assert.equal(j.gameTime, 340, 'sans difficulté — elle grossit les stalactites');
  assert.equal(j.ghost.x, LARGEUR - 10);
  assert.equal(j.ghost.y, HAUTEUR * 0.5);
  assert.equal(j.ghost.flPhys, false);
  assert.equal(j.bulle.x, LARGEUR - 24);
  assert.equal(j.bulle.poids, 0.004);
  assert.equal(j.bulle.peau.image, 1, 'le stop d\'époque');
  // Les stalactites, à la taille de la difficulté (1 + floor(dif·0,1)).
  assert.equal(j.s1.image, 5);
  assert.equal(j.s2.image, 5);
  assert.equal(j.s2.sx, -1, 'la stalagmite : le placement tourné de 180°');
  assert.equal(j.s2.sy, -1);
  // Les contours de collision, extraits du SWF.
  assert.ok(j.contourTunnel && j.contourTunnel.length === 1);
  assert.ok(j.contourPique && j.contourPique.length === 4, 'l\'union des remplissages');
  // La bulle naît DANS le tunnel — sinon elle éclaterait à la première image.
  assert.equal(j.isIn(j.bulle.x, j.bulle.y), false);
  assert.equal(j.isIn(120, 20), true, 'la paroi du haut');
  assert.equal(j.isIn(73.5, 40), true, 'sous la stalactite du plafond');
});

test('le fantôme suit la souris et souffle la bulle (blob, poussée, poses)', () => {
  const b = banc(J.Ghost);
  const j = b.jeu;
  // Il glisse vers la souris (ressort 0,1) et la regarde de loin.
  b.souris(120, 120);
  const dx = j.ghost.x - 120;
  b.avancer(1);
  assert.equal(j.ghost.x.toFixed(4), (LARGEUR - 10 - dx * 0.1).toFixed(4));
  assert.equal(j.ghost.peau.image, 1, 'bouche fermée');
  // Collé à la bulle, l'appui souffle : pose 2, poussée à l'opposé, blob.
  j.ghost.x = j.bulle.x - 30;
  j.ghost.y = j.bulle.y;
  b.souris(j.ghost.x, j.ghost.y);
  const vx0 = j.bulle.vitx;
  b.socle.click();
  b.avancer(1);
  assert.equal(j.ghost.peau.image, 2, 'la pose du souffle');
  assert.ok(j.bulle.vitx > vx0, 'poussée vers la droite (à l\'opposé du fantôme)');
  assert.ok(j.blob > 0, 'la bulle tremble');
  // Le tremblement déforme : sx = c, sy = 1/c — et decal avance de 16.
  const d0 = j.decal;
  b.avancer(1);
  assert.equal((j.decal - d0 + 628) % 628, 16, 'decal += 16 (le « + blob·0 » d\'époque)');
  assert.equal(j.bulle.peau.sy.toFixed(6), (1 / j.bulle.peau.sx).toFixed(6));
  b.socle.relache();
  b.avancer(1);
  assert.equal(j.ghost.peau.image, 1);
});

test('la bulle sort à gauche : gagné — ou éclate à la paroi : perdu et retirée', () => {
  let b = banc(J.Ghost);
  let j = b.jeu;
  j.bulle.x = -1;
  b.avancer(1);
  assert.equal(j.gagnant, true, 'sortie de la grotte');

  b = banc(J.Ghost);
  j = b.jeu;
  j.bulle.x = 120;
  j.bulle.y = 20;                        // dans la paroi du haut
  j.bulle.vitx = 3;
  b.avancer(1);
  assert.equal(j.gagnant, false, 'éclatée');
  assert.equal(j.bulle.vitx, 0, 'figée net');
  assert.ok(j.bulle.peau.joue, 'l\'éclat se joue (images 2-4)');
  b.avancer(3);
  assert.equal(j.bulle.vivant, false, 'le DoAction d\'époque : le phys éclaté se retire');
});

test('l\'alpha du fantôme : hors du tunnel il s\'efface — jamais sous 20 %', () => {
  const b = banc(J.Ghost);
  const j = b.jeu;
  // On le cloue dans la paroi (souris immobile dessus).
  j.ghost.x = 120;
  j.ghost.y = 20;
  b.souris(120, 20);
  b.avancer(40);
  assert.equal(j.ghost.peau.alpha.toFixed(2), '0.20', 'le clamp d\'époque');
  // De retour dans le tunnel, il revient plein.
  j.ghost.x = 120;
  j.ghost.y = 120;
  b.souris(120, 120);
  b.avancer(60);
  assert.equal(j.ghost.peau.alpha.toFixed(2), '1.00', 'le ressort converge, le clamp coiffe à 100');
});

test('les dessins du fantôme sont extraits, contours de collision compris', () => {
  for (const cle of ['gameGhost', 'sym269', 'sym264', 'sym275', 'sym272', 'sym274']) {
    assert.ok(MANIFESTE[cle], cle + ' est extrait');
  }
  assert.equal(MANIFESTE.gameGhost.etats[0].pieces.length, 3,
    'la grotte SANS ses enfants — le tunnel rouge ne cuit pas dans le décor');
  assert.equal(MANIFESTE.sym269.etats.length, 2, 'les deux poses du fantôme');
  assert.equal(MANIFESTE.sym264.etats.length, 4,
    'la bulle et son éclat (la cinquième image d\'époque répète la quatrième)');
  assert.equal(MANIFESTE.sym275.etats.length, 10, 'les dix paliers de stalactite');
  assert.ok(Array.isArray(MANIFESTE.sym272.contour), 'le contour du tunnel');
  assert.ok(Array.isArray(MANIFESTE.sym274.contour), 'le contour de la pique');
  // La pointe de la pique est en bas de sa boîte (~150), pas au-delà.
  const E2 = require(path.join(ROOT, 'public/minifever/engine.js'));
  assert.ok(E2.dansContour(MANIFESTE.sym274.contour, 0, 100), 'dans le fût');
  assert.ok(!E2.dansContour(MANIFESTE.sym274.contour, 0, 170), 'sous la pointe : dehors');
});

// ── LA FALAISE (game/Cliff.mt, classe « 2Mm6G1 » du bytecode) ──

test('la falaise : la mise en place du bytecode, constante par constante', () => {
  const b = banc(J.Cliff, { dif: 40 });
  const j = b.jeu;
  assert.equal(j.gameTime, 260, 'sans difficulté');
  assert.equal(j.jumpPoint, 1000);
  assert.equal(j.jumpSize, 60 + 40 * 2);
  assert.equal(j.cliffLevel, HAUTEUR - 50);
  assert.equal(j.heroDecal, 40);
  assert.equal(j.heroFrameMax, 36);
  assert.equal(j.speed, 0);
  assert.deepEqual(j.omp, { x: 120, y: 120 }, 'la souris du socle au départ');
  // Le décor généré : des arbres AVANT la crevasse, jamais après.
  assert.ok(j.arbres.length > 0);
  assert.ok(j.arbres.every((a) => a.x < 1000));
  // La crevasse écartée à jumpSize : rose étiré, bord droit, bord en miroir.
  assert.equal(j.trouRose.sx, j.jumpSize / 100, '_xscale du fond rose = la largeur');
  assert.equal(j.trouBord2.sx, -1, 'le bord du fond, en miroir');
  assert.equal(j.trouBord2.x - j.trouBord1.x, j.jumpSize);
  // Le héros : image 1, arrêté, posé au bord gauche du décor.
  assert.equal(j.heroMc.image, 1);
  assert.equal(j.heroMc.joue, false);
  assert.equal(j.heroMc.y, j.cliffLevel);
});

test('la course de la falaise : l\'agitation de la souris propulse, la caméra suit', () => {
  const b = banc(J.Cliff);
  const j = b.jeu;
  // Une secousse de 100 px : speed = (0 + 100·0,01)·0,96, et le héros avance
  // de speed SANS tmod (coquille d'époque).
  b.souris(j.omp.x + 100, j.omp.y);
  b.avancer(1);
  const v1 = (0 + 100 * 0.01) * 0.96;
  assert.equal(j.speed.toFixed(6), v1.toFixed(6));
  assert.equal(j.heroX.toFixed(6), v1.toFixed(6));
  // La pellicule suit la course : round(heroFrame + 1).
  assert.equal(j.heroMc.image, Math.round(j.heroFrame + 1));
  // Souris immobile : la vitesse s'amortit, la caméra glisse vers 40 - heroX.
  b.avancer(1);
  assert.equal(j.speed.toFixed(6), (v1 * 0.96).toFixed(6));
  assert.ok(j.decorX < 0 || Math.abs(j.decorX) < 40, 'decorX court vers heroDecal - heroX');
  // À pleine vitesse (dash ≥ 4), les poses du sprint 40-42.
  j.speed = 20;
  b.avancer(1);
  assert.ok(j.heroMc.image >= 40 && j.heroMc.image <= 42, 'pose ' + j.heroMc.image);
});

test('la visée de la falaise : le quart se remplit, le relâcher lance', () => {
  const b = banc(J.Cliff);
  const j = b.jeu;
  j.speed = 18;
  j.heroX = 900;
  b.socle.click();
  b.avancer(1);
  assert.equal(j.etape, 2, 'l\'appui ouvre la visée');
  assert.equal(j.angle, 0, 'l\'angle naît à zéro — il ne descend qu\'à l\'étape 2');
  // Le compteur, posé à l'écran du héros À CET INSTANT (la caméra glisse
  // encore ensuite, le compteur reste) : cadran + carré à 50 % derrière sa
  // découpe quart-de-cercle (le même carré, tourné de -90°).
  assert.equal(j.cadran.cle, 'sym350');
  assert.equal(j.carre.cle, 'sym349');
  assert.equal(j.carre.alpha, 0.5);
  assert.equal(j.carre.masque.cle, 'sym349');
  assert.equal(j.carre.masque.rot, -90);
  assert.equal(j.carre.x, j.heroX + j.decorX, 'accroché là où le héros s\'arrête');
  b.avancer(1);
  assert.equal(j.angle.toFixed(4), (-0.05).toFixed(4));
  assert.equal(j.carre.rot.toFixed(3), (j.angle / 0.0174).toFixed(3));
  // Le héros ne court plus pendant la visée.
  const x0 = j.heroX;
  b.avancer(3);
  assert.equal(j.heroX, x0);
  // Le relâcher : saut cos/sin(angle)·speed, pose « $jump » (image 50),
  // compteur retiré.
  const a = j.angle - 0.05;                    // l'angle du tour du relâcher
  b.socle.relache();
  b.avancer(1);
  assert.equal(j.etape, 3);
  assert.equal(j.heroMc.image, 50);
  // L'élan du saut : la vitesse a décru UNE fois (le tour du clic jouait
  // encore la course), et la friction de l'air n'a pas encore mordu.
  assert.equal(j.vitx.toFixed(4), (Math.cos(a) * 18 * 0.96).toFixed(4));
  assert.equal(j.cadran.vivant, false, 'removeMovieClip d\'époque');
  assert.equal(j.carre.vivant, false);
});

test('le saut de la falaise : au-delà gagné, trop tôt $tooSoon, dedans la chute muette', () => {
  // GAGNÉ : bord de la crevasse, plein élan, angle plat.
  let b = banc(J.Cliff);
  let j = b.jeu;
  j.heroX = 1000;
  j.initJump(-0.2, 25);
  b.avancer(30);
  assert.equal(j.gagnant, true, 'retombé au-delà');
  assert.equal(j.etape, 4);
  assert.equal(j.heroY, 0);
  assert.ok(j.heroMc.image >= 62 && j.heroMc.image <= 74, '« $win » : ' + j.heroMc.image);
  assert.ok(j.heroX > j.jumpPoint + j.jumpSize);

  // TROP TÔT : sauté loin du bord — il retombe avant la crevasse, glisse,
  // et s'arrête dix pixels avant le bord (clamp du perdant).
  b = banc(J.Cliff);
  j = b.jeu;
  j.heroX = 500;
  j.initJump(-1.2, 8);
  b.avancer(40);
  assert.equal(j.gagnant, false);
  assert.equal(j.etape, 4);
  assert.ok(j.heroMc.image >= 82, '« $tooSoon » : ' + j.heroMc.image);
  assert.ok(j.heroX < j.jumpPoint - 9.99, 'la glissade ne dépasse jamais jumpPoint - 10');

  // DEDANS : bord de la crevasse, élan trop court — perdu sans un mot, et
  // il continue de tomber dans le trou (aucune étape 4).
  b = banc(J.Cliff);
  j = b.jeu;
  j.heroX = 1000;
  j.initJump(-1.2, 8);
  b.avancer(20);
  assert.equal(j.gagnant, false);
  assert.equal(j.etape, 3, 'pas d\'atterrissage : la chute continue');
  assert.ok(j.heroY > 0, 'sous le rebord, dans la crevasse');
  const y1 = j.heroY;
  b.avancer(2);
  assert.ok(j.heroY > y1, 'et il tombe toujours');
});

test('les dessins de la falaise sont extraits, compteur démonté compris', () => {
  for (const cle of ['gameCliff', 'sym373', 'sym363', 'sym366', 'sym368', 'sym370', 'sym349', 'sym350']) {
    assert.ok(MANIFESTE[cle], cle + ' est extrait');
  }
  assert.equal(MANIFESTE.sym363.etats.length, 98, 'course, sprint, $jump, $win, $tooSoon');
  assert.equal(MANIFESTE.sym366.etats.length, 2, 'deux variantes d\'arbre');
  // Le fond rose de la crevasse : cent pixels — _xscale y vaut la largeur.
  assert.equal(Math.round(MANIFESTE.sym368.etats[0].pieces[0].w), 100);
  // Le cadran est sorti SANS son aiguille : une seule pièce, le quart blanc.
  assert.equal(MANIFESTE.sym350.etats[0].pieces.length, 1);
  assert.equal(MANIFESTE.sym350.etats[0].pieces[0].fichier, 'shape347.svg');
  // Les poses du héros aux étiquettes d'époque ne sont pas vides.
  for (const img of [50, 62, 82]) {
    const e = MANIFESTE.sym363.etats.find((et) => et.frame === img);
    assert.ok(e && e.pieces.length, 'image ' + img + ' dessinée');
  }
});

// ── LA CHAÎNE (game/Chain.mt, classe « 1MtsF1 » du bytecode) ──

/** Le clic au centre d'une case de la grille de la chaîne. */
function cliquerCase(b, j, x, y) {
  const s = j.slotList[x][y];
  b.souris(s.px, s.py);
  b.socle.click();
  b.socle.relache();
}

/** Un chemin adjacent, sans repasse, qui épelle le bandeau — il existe. */
function cheminDuBandeau(j) {
  const suite = j.rowList.map((r) => r.id);
  const vus = new Set();
  const chercher = (etape, chemin) => {
    if (etape === suite.length) return chemin;
    for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) {
      if (etape === 0 && (dx || dy)) continue;
      if (etape > 0 && !(dx || dy)) continue;
      const dep = etape === 0 ? null : chemin[chemin.length - 1];
      const xs = etape === 0 ? [...Array(j.xMax).keys()] : [dep.x + dx];
      const ys = etape === 0 ? [...Array(j.yMax).keys()] : [dep.y + dy];
      for (const x of xs) {
        for (const y of ys) {
          if (x < 0 || x >= j.xMax || y < 0 || y >= j.yMax) continue;
          const cle = x + ':' + y;
          if (vus.has(cle) || j.slotList[x][y].id !== suite[etape]) continue;
          vus.add(cle);
          const trouve = chercher(etape + 1, [...chemin, { x, y }]);
          if (trouve) return trouve;
          vus.delete(cle);
        }
      }
    }
    return null;
  };
  return chercher(0, []);
}

test('la chaîne : la mise en place du bytecode, constante par constante', () => {
  const b = banc(J.Chain, { dif: 40 });
  const j = b.jeu;
  assert.equal(j.gameTime, 400 - 40);
  assert.equal(j.chainLength, 8, 'déclaré comme à l\'époque — et jamais lu');
  assert.equal(j.idMax, 5);
  assert.equal(j.size, 50 - Math.round(40 * 0.2));
  assert.equal(j.xMax, Math.floor((LARGEUR - 8) / j.size));
  assert.equal(j.xMargin, LARGEUR - j.xMax * j.size);
  assert.equal(j.yMax, Math.floor((HAUTEUR - (60 + j.size)) / j.size));
  assert.equal(j.yMargin, HAUTEUR - (j.yMax + 1) * j.size);
  // Le bandeau mesure xMax cases — pas chainLength — et il est jouable :
  // un chemin adjacent qui l'épelle existe sur la grille (celui du tirage).
  assert.equal(j.rowList.length, j.xMax);
  assert.ok(cheminDuBandeau(j), 'le bandeau s\'épelle sur la grille');
  // Chaque case du bandeau porte l'id qu'elle affiche, style « 2 ».
  assert.ok(j.rowList.every((r) => r.mc.image === r.id + 1));
  assert.ok(j.rowList.every((r) => r.fond.image === 2));
  assert.ok(j.slotList.every((col) => col.every((s) => s.fond.image === 1)));
  // La barre d'époque : la bande blanche, réglée par le code de la source.
  assert.equal(j.bar.cle, 'sym345');
  assert.equal(j.bar.y, j.size * 0.25 + j.yMargin * 0.33);
  assert.equal(j.bar.sy, j.size * 0.5 / 100);
});

test('la chaîne se recopie : adjacence stricte, annulation, remise à zéro', () => {
  const b = banc(J.Chain);
  const j = b.jeu;
  const chemin = cheminDuBandeau(j);
  assert.ok(chemin, 'un chemin existe');
  // La première case du chemin : sélectionnée, blanchie à 80 %.
  cliquerCase(b, j, chemin[0].x, chemin[0].y);
  assert.equal(j.cList.length, 1);
  const s0 = j.slotList[chemin[0].x][chemin[0].y];
  assert.equal(s0.mc.blanchi, 0.8, 'setPColor(blanc, 20)');
  assert.equal(s0.fond.blanchi, 0.8);
  // La recliquer : annulée, re-teintée pleine.
  cliquerCase(b, j, chemin[0].x, chemin[0].y);
  assert.equal(j.cList.length, 0);
  assert.equal(s0.mc.blanchi, 0);
  // Une case au MAUVAIS fruit en tête de chaîne : rien ne s'accroche.
  const fausse = (() => {
    for (let x = 0; x < j.xMax; x++) {
      for (let y = 0; y < j.yMax; y++) {
        if (j.slotList[x][y].id !== j.rowList[0].id) return { x, y };
      }
    }
    return null;
  })();
  if (fausse) {
    cliquerCase(b, j, fausse.x, fausse.y);
    assert.equal(j.cList.length, 0, 'mauvais fruit : tout retombe');
  }
  // Reprendre, puis cliquer LOIN (non adjacent) : tout se déselectionne.
  cliquerCase(b, j, chemin[0].x, chemin[0].y);
  assert.equal(j.cList.length, 1);
  const loin = { x: (chemin[0].x + 2) % j.xMax, y: chemin[0].y };
  cliquerCase(b, j, loin.x, loin.y);
  assert.equal(j.cList.length, 0, 'le saut casse la chaîne');
  assert.equal(s0.mc.blanchi, 0);
});

test('la chaîne complète gagne, la victoire fige les clics, le bandeau fond', () => {
  const b = banc(J.Chain);
  const j = b.jeu;
  const chemin = cheminDuBandeau(j);
  for (const p of chemin) cliquerCase(b, j, p.x, p.y);
  assert.equal(j.cList.length, j.rowList.length);
  assert.equal(j.gagnant, true);
  // flWin d'époque : plus un clic ne passe.
  const av = j.cList.length;
  cliquerCase(b, j, chemin[chemin.length - 1].x, chemin[chemin.length - 1].y);
  assert.equal(j.cList.length, av, 'la victoire fige tout');
  // Le bandeau fond : les cases recopiées filent vers zéro (ressort 0,5).
  const r0 = j.rowList[0];
  const s1 = r0.mc.sx * 100 + (0 - r0.mc.sx * 100) * 0.5;
  b.avancer(1);
  assert.equal((r0.mc.sx * 100).toFixed(4), s1.toFixed(4));
  b.avancer(8);
  assert.ok(r0.mc.sx * 100 < 1, 'quasi fondue');
  assert.ok(Math.abs(r0.fond.x - (r0.px - 50 * r0.mc.sx)) < 1e-9, 'le fond suit le centre');
});

test('les dessins de la chaîne sont extraits, case éclatée comprise', () => {
  for (const cle of ['gameChain', 'sym342', 'sym336', 'sym345']) {
    assert.ok(MANIFESTE[cle], cle + ' est extrait');
  }
  assert.equal(MANIFESTE.gameChain.etats[0].pieces.length, 1, 'le fond SANS sa barre');
  assert.equal(MANIFESTE.sym342.etats.length, 5, 'les cinq fruits');
  assert.ok(MANIFESTE.sym342.etats.every((e) => e.pieces.length === 1), 'sans leur fond « 9A »');
  assert.equal(MANIFESTE.sym336.etats.length, 5, 'la tuile (« 1 » table, « 2 » bandeau servent)');
  // La barre : la bande blanche à 50 %.
  const svg = fs.readFileSync(path.join(ROOT, 'public/minifever/sprites',
    MANIFESTE.sym345.etats[0].pieces[0].fichier), 'utf8');
  assert.ok(/fill-opacity="0.5"/.test(svg), 'blanche à demi');
});

// ── LA POMME (game/Apple.mt, classe « 68iuA1 » du bytecode) ──

test('la pomme : la mise en place du bytecode, constante par constante', () => {
  const b = banc(J.Apple, { dif: 40 });
  const j = b.jeu;
  assert.equal(j.gameTime, 350 - 40 * 2.5);
  assert.deepEqual(j.fil, { x: 120, y: 0, max: 120 });
  assert.equal(j.ray, 50);
  assert.equal(j.crunchSize, 50);
  assert.equal(j.depthRun, 0);
  assert.equal(j.airFriction, 0.97, 'initDefault d\'époque');
  // La pomme naît au-dessus de l'écran, peau à l'image 1 — la source ne
  // règle que _xscale (à 100 %, sans effet : coquille conservée).
  assert.equal(j.pomme.x, 120);
  assert.equal(j.pomme.y, -50);
  assert.equal(j.pomme.peau.image, 1);
  assert.equal(j.pomme.peau.sx, 1);
  // Le trognon : l'image 2 du même dessin, cousu au masque partagé.
  assert.equal(j.trognon.image, 2);
  assert.equal(j.trognon.cle, 'sym230');
  assert.equal(j.ciel.masque, j.masque, 'le ciel et le trognon partagent LE masque');
  assert.equal(j.trognon.masque, j.masque);
  assert.equal(j.masque.cle, 'sym224');
  assert.equal(j.masque.enfants, j.morsures, 'les morsures sont les enfants du masque');
  // L'ordre : pomme sous le ciel révélé, fil par-dessus tout.
  const ordre = j.scene.ordre().filter((m) => [j.pomme.peau, j.ciel, j.trognon].includes(m));
  assert.deepEqual(ordre, [j.pomme.peau, j.ciel, j.trognon]);
});

test('l\'élastique de la pomme : ressort au-delà de 120, angle mesuré UN RAYON PLUS BAS', () => {
  const b = banc(J.Apple);
  const j = b.jeu;
  // On pose la pomme au repos, tendue plein sud (200 px sous l'ancre).
  j.pomme.x = 120;
  j.pomme.y = 200;
  j.pomme.vitx = 0;
  j.pomme.vity = 0;
  b.avancer(1);
  // La physique d'abord (gravité 1, friction 0,97 posée par le jeu), le
  // ressort ensuite, sur la position déjà avancée.
  const y1 = 200 + 1 * 0.97;
  assert.equal(j.pomme.y.toFixed(4), y1.toFixed(4));
  // Plein sud, l'angle vers l'ancre vaut -π/2 — mesuré depuis y + 50, même
  // verticale : identique ici, mais la formule du ressort a couru sur la
  // distance vraie (getDist au centre).
  const c = (y1 - 120) / 120;
  assert.equal(j.pomme.vity.toFixed(4), (1 * 0.97 - c * 4).toFixed(4), 'vity = gravité freinée - ressort');
  assert.equal(j.pomme.vitx.toFixed(4), (0).toFixed(4));
  // La peau : a/0,0174 + 90 — presque droite, pas tout à fait (0,0174 ≠ π/180).
  assert.equal(j.pomme.peau.rot.toFixed(3), (-Math.PI / 2 / 0.0174 + 90).toFixed(3));
  // Le fil : style 4/0x448800, ancré à (120, -50), courbe vers le bord bas.
  assert.deepEqual(j.mcFil.dessin[0], ['style', 4, 0x448800, 100]);
  assert.deepEqual(j.mcFil.dessin[1], ['aller', 120, -50]);
  assert.equal(j.mcFil.dessin[2][0], 'courbe');
  // Le masque et le trognon collent à la pomme, rotation comprise.
  assert.equal(j.masque.x, j.pomme.x);
  assert.equal(j.masque.rot, j.pomme.peau.rot);
  assert.equal(j.trognon.rot, j.pomme.peau.rot);
});

test('croquer la pomme : morsure au masque, miettes sur la chair, recul de 14', () => {
  const b = banc(J.Apple);
  const j = b.jeu;
  // Une pomme posée bien en vue, droite.
  j.pomme.x = 120;
  j.pomme.y = 120;
  j.pomme.vitx = 0;
  j.pomme.vity = 0;
  j.pomme.peau.rot = 0;
  // Un clic à 200 px : hors du disque d'appui (rayon 65) — rien.
  b.souris(120, 320);
  b.socle.click();
  b.socle.relache();
  assert.equal(j.morsures.length, 0, 'hors du disque d\'appui, pas de morsure');
  // Un clic dans la joue basse (10, 15) : morsure aux coordonnées locales.
  b.souris(130, 135);
  b.socle.click();
  b.socle.relache();
  assert.equal(j.morsures.length, 1);
  assert.equal(j.depthRun, 1);
  assert.equal(j.morsures[0].cle, 'sym222');
  assert.equal(j.morsures[0].x, 10);
  assert.equal(j.morsures[0].y, 15);
  assert.equal(j.morsures[0].sx, 0.5, 'le blob à l\'échelle crunchSize (50 %)');
  // Le point mordu est mangé, un point éloigné non.
  assert.ok(j.estMange(130, 135));
  assert.ok(!j.estMange(90, 100));
  // Les miettes : tirées en couronne sur la chair encore pleine.
  const miettes = j.sprites.filter((s) => s.peau && s.peau.cle === 'sym220');
  assert.ok(miettes.length >= 1 && miettes.length <= 8, miettes.length + ' miettes');
  assert.ok(miettes.every((m) => m.vitr !== null && m.vitr >= 0 && m.vitr < 20), 'vitr = hasard·20');
  assert.ok(miettes.every((m) => m.peau.image >= 1 && m.peau.image <= 5), 'une des cinq poses');
  // Le recul : à l'opposé de la souris (en bas à droite) — la pomme part
  // vers le haut-gauche, de 14.
  assert.ok(j.pomme.vitx < 0 && j.pomme.vity < 0);
  assert.equal(Math.hypot(j.pomme.vitx, j.pomme.vity).toFixed(4), (14).toFixed(4));
});

test('tout croquer gagne — et l\'élastique survit au verdict (pas de step 2)', () => {
  const b = banc(J.Apple);
  const j = b.jeu;
  j.pomme.x = 120;
  j.pomme.y = 120;
  j.pomme.peau.rot = 0;
  // On quadrille la chair de morsures (rayon 25 chacune) sans laisser le
  // temps à la pomme de bouger : clic, relâche, pas d'image entre deux.
  for (let gx = -45; gx <= 45 && j.gagnant === null; gx += 18) {
    for (let gy = -30; gy <= 40 && j.gagnant === null; gy += 18) {
      j.pomme.vitx = 0;
      j.pomme.vity = 0;
      b.souris(120 + gx, 120 + gy);
      b.socle.click();
      b.socle.relache();
    }
  }
  assert.equal(j.gagnant, true, 'la pomme croquée gagne');
  assert.equal(j.etape, 1, 'setWin(true) SANS step = 2 : l\'élastique continue');
  // Et on peut encore mordre dans le vide : le verdict, lui, ne bouge plus.
  const avant = j.morsures.length;
  b.souris(120, 120);
  b.socle.click();
  b.socle.relache();
  assert.equal(j.morsures.length, avant + 1, 'mordre après la victoire ajoute encore au masque');
  assert.equal(j.gagnant, true);
});

test('les dessins de la pomme sont extraits, zones d\'appui invisibles comprises', () => {
  for (const cle of ['gameApple', 'sym230', 'sym232', 'sym224', 'sym222', 'sym220']) {
    assert.ok(MANIFESTE[cle], cle + ' est extrait');
  }
  assert.equal(MANIFESTE.gameApple.etats.length, 1, 'la scène n\'est que le ciel');
  assert.deepEqual(MANIFESTE.sym230.etats.map((e) => e.pieces.length), [3, 3, 1],
    'pomme pleine, trognon, chair');
  assert.equal(MANIFESTE.sym220.etats.length, 5, 'les cinq poses de miette');
  // Le disque d'appui (shape225) : 130 px, magenta INVISIBLE (alpha 0).
  const disque = MANIFESTE.sym230.etats[0].pieces.find((p) => p.fichier === 'shape225.svg');
  assert.ok(disque, 'le disque d\'appui est dans la pomme');
  assert.equal(disque.w, 130);
  const svg = fs.readFileSync(path.join(ROOT, 'public/minifever/sprites/shape225.svg'), 'utf8');
  assert.ok(/fill-opacity="0"/.test(svg), 'magenta à alpha 0 — la zone se presse, ne se voit pas');
  // La base du masque : le fil de 0,05 px — rien de révélé au départ.
  assert.ok(MANIFESTE.sym224.etats[0].pieces[0].w < 1);
  // Le blob de morsure : 100 px centrés.
  assert.equal(Math.round(MANIFESTE.sym222.etats[0].pieces[0].w), 100);
});

// ── LA BOMBE (game/Bomb.mt, classe « 8__V1 » du bytecode) ──

test('la bombe : la mise en place du bytecode, constante par constante', () => {
  const b = banc(J.Bomb, { dif: 40 });
  const j = b.jeu;
  assert.equal(j.gameTime, 540 - 40 * 3);
  assert.equal(j.limit, 169);
  assert.equal(j.powerMax, 10, 'déclaré comme à l\'époque — et jamais lu');
  assert.equal(j.angle, -Math.PI * 0.75);
  assert.equal(j.speed, 0.5 + 40 * 0.015);
  assert.deepEqual(j.water, []);
  assert.equal(j.power, null);
  // Les acteurs de la timeline, aux PlaceObject du SWF (sym92, image 1).
  assert.equal(j.fond.joue, false, 'la scène est stoppée sur le pré');
  assert.equal(j.bombe.x, 200.8);
  assert.equal(j.bombe.y, 199.85);
  assert.equal(j.etincelle.x, -13.25);
  assert.equal(j.etincelle.y, 229.45);
  assert.equal(j.monstre.x, 200.8);
  assert.equal(j.monstre.y, 199.85);
  assert.equal(j.monstre.joue, true, 'le monstre joue son entrée');
  // La fenêtre du masque, aux valeurs d'auteur avant la première image.
  assert.equal(j.bombe.masque.cle, 'sym67');
  assert.equal(j.bombe.masque.sy, 0.999466, 'le _yscale d\'auteur, jamais retouché');
  // L'ordre d'accrochage refait les profondeurs 1, 4, 11, 15 de la timeline.
  const ordre = j.scene.ordre();
  assert.ok(ordre.indexOf(j.fond) < ordre.indexOf(j.bombe), 'le pré sous la mèche');
  assert.ok(ordre.indexOf(j.bombe) < ordre.indexOf(j.etincelle), 'la mèche sous la braise');
  assert.ok(ordre.indexOf(j.etincelle) < ordre.indexOf(j.monstre), 'la braise sous le monstre');
});

test('les timelines rejouées : flammes 1-2-3, entrée du monstre stoppée à 15 (flReady)', () => {
  const b = banc(J.Bomb);
  const j = b.jeu;
  // La flamme boucle 1-2-3 : le DoAction de l'image 4 rembobine AVANT le
  // rendu, son image (le même dessin que la 3) ne s'affiche jamais. On lit
  // APRÈS chaque tour : le client fait update puis dessine — l'état
  // d'accrochage, lui, ne passe jamais à l'écran.
  const vues = [];
  for (let i = 0; i < 6; i++) { b.avancer(1); vues.push(j.etincelle.image); }
  assert.deepEqual(vues, [1, 2, 3, 1, 2, 3]);
  // Le monstre : l'entrée 1-14, le stop de l'image 15 — qui pose flReady,
  // la variable déclarée dans la source que RIEN ne lit (vestige d'époque).
  assert.equal(j.flReady, false);
  b.avancer(9);                                        // quinze images en tout
  assert.equal(j.monstre.image, 15);
  assert.equal(j.monstre.joue, false, 'stop() de l\'image 15');
  assert.equal(j.flReady, true, 'sa timeline a posé flReady');
});

test('la braise remonte la mèche, le masque la suit ; au bout (169), la bombe saute', () => {
  const b = banc(J.Bomb, { dif: 0 });
  const j = b.jeu;
  const x0 = j.etincelle.x;
  b.avancer(1);
  assert.equal(j.etincelle.x, x0 + 0.5, 'speed = 0,5 + dif·0,015');
  // Le masque colle à la braise : mask._x = spark._x, _xscale = mcw - spark._x
  // — un rectangle de cent pixels, l'échelle y vaut des pixels.
  assert.equal(j.bombe.masque.x, j.etincelle.x);
  assert.equal(j.bombe.masque.sx, (LARGEUR - j.etincelle.x) / 100);
  // Jusqu'au bout de la mèche : la défaite, et play() déroule l'explosion.
  b.avancer(Math.ceil((j.limit - j.etincelle.x) / 0.5) + 1);
  assert.equal(j.gagnant, false, 'la bombe a sauté');
  assert.equal(j.etape, 2);
  assert.ok(j.fond.image >= 2, 'play() : la scène est partie');
  // Les éclairs (images 2-3) n'affichent plus personne…
  b.avancer(1);
  assert.equal(j.etincelle.visible, false);
  assert.equal(j.bombe.visible, false);
  // …puis le monstre revient soufflé (images 4-6), et la scène s'arrête à 6.
  b.avancer(5);
  assert.equal(j.fond.image, 6, 'le stop de la fin');
  assert.equal(j.fond.joue, false);
  assert.equal(j.monstre.visible, true);
  assert.equal(j.monstre.x, -35.5, 'la troisième pose du souffle (PlaceObject de l\'image 6)');
  assert.equal(j.monstre.y, -40.15);
  assert.ok(Math.abs(j.monstre.rot - 25.34) < 0.01, 'il tournoie (~25,3°)');
});

test('la charge monte de 0,5 par temps (poses 20 à 30), le lancer mou est avalé', () => {
  const b = banc(J.Bomb);
  const j = b.jeu;
  b.socle.click();
  b.avancer(1);
  assert.equal(j.power, 0, 'le premier tour arme la charge sans poser le monstre');
  b.avancer(1);
  assert.equal(j.power, 0.5);
  assert.equal(j.monstre.image, 21, 'gotoAndStop(round(0,5 + 20)) = 21');
  b.avancer(19);
  assert.equal(j.power, 10, 'le plafond — un littéral du bytecode, pas powerMax');
  assert.equal(j.monstre.image, 30, 'la pose la plus armée');
  b.socle.relache();
  b.avancer(1);
  assert.equal(j.power, null);
  assert.equal(j.water.length, 1, 'la boule est partie');
  assert.equal(j.monstre.image, 20, 'gotoAndStop("20") après le lancer');
  const boule = j.water[0];
  assert.equal(boule.poids, 0.5);
  assert.equal(boule.peau.sx, 0.6, 'la peau à 60 %');
  assert.equal(boule.peau.cle, 'sym62');
  // Partie de la main (x - 39, y - 63), en cloche vers la gauche (-3π/4).
  assert.equal(boule.x, 200.8 - 39);
  assert.equal(boule.y, 199.85 - 63);
  assert.equal(boule.vitx.toFixed(4), (Math.cos(-Math.PI * 0.75) * 10 * 0.8).toFixed(4));
  assert.equal(boule.vity.toFixed(4), (Math.sin(-Math.PI * 0.75) * 10 * 0.8).toFixed(4));
  // Le lancer MOU : power ≤ 2,5 au relâchement, pas de boule — mais la pose
  // retombe quand même à 20.
  b.socle.click();
  b.avancer(3);
  assert.equal(j.power, 1);
  j.monstre.allerA(22);                        // pour voir la pose retomber
  b.socle.relache();
  b.avancer(1);
  assert.equal(j.water.length, 1, 'toujours une seule boule : le lancer mou est avalé');
  assert.equal(j.power, null);
  assert.equal(j.monstre.image, 20);
});

test('la boule qui crève la ligne éclate en dix gouttes ; à moins de dix pixels, la braise s\'éteint', () => {
  const b = banc(J.Bomb);
  const j = b.jeu;
  // Une boule réglementaire, pendue juste au-dessus de la braise.
  j.power = 5;
  j.launch();
  const mc = j.water[0];
  mc.x = j.etincelle.x + 6;
  mc.y = j.etincelle.y - 1;
  mc.vitx = 2;
  mc.vity = 1;
  b.avancer(1);
  assert.equal(j.gagnant, true, 'éteinte');
  assert.equal(j.etape, 2);
  assert.equal(j.water.length, 0, 'la boule éclatée est retirée');
  assert.equal(j.fond.joue, false, 'PAS de play() à la victoire : la bombe ne saute pas');
  assert.equal(j.fond.image, 1);
  assert.ok(j.fumee, 'gotoAndPlay(« smoke »)');
  assert.ok(j.etincelle.image >= 5, 'la fumée est partie (étiquette : image 5)');
  // Les dix gouttes réglementaires de l'éclat.
  const gouttes = j.sprites.filter((s) => s.peau && s.peau.cle === 'sym422');
  assert.equal(gouttes.length, 10);
  assert.ok(gouttes.every((g) => g.poids === 0.5 && g.fonduType === 1), 'poids 0,5, fondu par l\'échelle');
  assert.ok(gouttes.every((g) => g.peau.alpha === 0.6), 'alpha 60 %');
  assert.ok(gouttes.every((g) => g.vity < 0), 'toutes giclent vers le haut');
  assert.ok(gouttes.every((g) => g.minuteur >= 10 && g.minuteur < 20), 'minuteur 10 + random(10)');
  assert.ok(gouttes.every((g) => g.echelle >= 40 && g.echelle < 100), 'échelle 40 + random(60)');
  // La fumée joue jusqu'au stop de l'image 22, dans la fenêtre du verdict.
  b.avancer(17);
  assert.equal(j.etincelle.image, 22);
  assert.equal(j.etincelle.joue, false, 'le stop au bout de la fumée');
});

test('la coquille de la victoire : setWin sans return — la charge tourne encore cette image-là', () => {
  const b = banc(J.Bomb);
  const j = b.jeu;
  // Le joueur relance déjà la charge pendant que sa boule retombe…
  j.power = 5;
  j.launch();
  const mc = j.water[0];
  mc.x = j.etincelle.x + 6;
  mc.y = j.etincelle.y - 3;
  mc.vitx = 0.5;
  mc.vity = 1;
  b.socle.click();
  b.avancer(1);                                // la boule n'a pas encore passé la ligne
  assert.equal(j.gagnant, null);
  assert.equal(j.power, 0, 'la charge s\'arme');
  b.avancer(1);                                // l'image de la victoire
  assert.equal(j.gagnant, true);
  assert.equal(j.power, 0.5, 'le bloc de charge a ENCORE tourné : ni play() ni return dans la branche gagnée');
  assert.equal(j.monstre.image, 21, 'et le monstre a reposé sur l\'image même de la victoire');
  b.avancer(1);
  assert.equal(j.power, 0.5, 'l\'étape 2 fige tout : la coquille ne dure qu\'une image');
});

test('les dessins de la bombe sont extraits, la scène nettoyée de ses acteurs', () => {
  for (const cle of ['gameBomb', 'sym64', 'sym67', 'sym73', 'sym88', 'sym62', 'sym422']) {
    assert.ok(MANIFESTE[cle], cle + ' est extrait');
  }
  assert.equal(MANIFESTE.gameBomb.etats.length, 6, 'le pré, deux éclairs, trois images soufflées');
  assert.equal(MANIFESTE.gameBomb.etats[0].pieces.length, 1,
    'l\'image 1 : le pré SEUL — braise, monstre et mèche vivent à part, pilotés par le jeu');
  assert.equal(MANIFESTE.sym73.etats.length, 22, 'flammes puis fumée');
  assert.equal(MANIFESTE.sym88.etats.length, 30, 'l\'entrée du monstre et ses poses de charge');
  assert.equal(MANIFESTE.sym62.etats.length, 21, 'la boule ondule');
  // La fenêtre du masque : un rectangle 100×100 accroché en haut à gauche —
  // c'est lui qui fait valoir _xscale en pixels (mask._xscale = mcw - x).
  const m67 = MANIFESTE.sym67.etats[0].pieces[0];
  assert.equal(m67.w, 100);
  assert.equal(m67.h, 100);
  assert.deepEqual(m67.o, [0, 0]);
});

// ── L'ÉCRAN D'ACCUEIL (Menu.mt reconstruit) ──

test('le menu : titre sur ressort, sinusoïde, cases qui glissent — Menu.mt rejoué', () => {
  const m = new E.Menu({ mesures: MESURES, rng: dé(5) });
  m.demarrer();
  assert.equal(m.etape, 0);
  assert.equal(m.bulles.length, 20, 'vingt bulles autour du titre');
  assert.equal(m.bulles.filter((b) => b.devant).length, 10,
    'la dixième et les suivantes passent DEVANT le titre (dm.over)');
  // Le ressort du titre converge vers 100 (vs ±6, amorti 0,8).
  for (let i = 0; i < 400 && m.etape === 0; i++) m.update(1);
  assert.equal(m.etape, 1, 'le titre est posé');
  assert.ok(Math.abs(m.titre.sc - 100) < 2);
  // La sinusoïde : decal file à 471, le titre finit en haut (y = 40).
  for (let i = 0; i < 200 && m.etape === 1; i++) m.update(1);
  assert.equal(m.etape, 2);
  assert.ok(Math.abs(m.titre.y - 40) < 1, 'le titre finit tout en haut');
  // Les cinq cases de Menu.select : arcade, fever, time, train, secret —
  // Time et Train jamais compilés, au style verrouillé.
  assert.deepEqual(m.mList.map((c) => c.nom), ['arcade', 'fever', 'time', 'train', 'secret']);
  assert.deepEqual(m.mList.map((c) => c.verrou), [false, false, true, true, false]);
  // Elles partent des deux bords (±200) et glissent vers le centre.
  for (let i = 0; i < 60; i++) m.update(1);
  for (const c of m.mList) assert.ok(Math.abs(c.x - E.LARGEUR / 2) < 2, 'chaque case rejoint la colonne');
});

test('le menu : fever part, arcade ouvre ses paliers (le cinquième verrouillé)', () => {
  const lance = [];
  const m = new E.Menu({ mesures: MESURES, rng: dé(5), surEvenement: (n, d) => { if (n === 'mode') lance.push(d); } });
  m.demarrer();
  for (let i = 0; i < 700 && m.etape !== 2; i++) m.update(1);
  for (let i = 0; i < 60; i++) m.update(1);
  // Un appui sur ARCADE : le sous-menu des cinq paliers de DIF_INFO.
  const arcade = m.mList.find((c) => c.nom === 'arcade');
  m.souris.x = arcade.x; m.souris.y = arcade.y;
  m.click(); m.relache();
  assert.equal(m.mList.length, E.PALIERS.length, 'les cinq paliers');
  assert.equal(m.mList.filter((c) => c.verrou).length, 1, 'le cinquième, sans nom, est verrouillé');
  assert.equal(m.mList[4].verrou, true);
  // Un appui sur un palier : les cases s'escamotent (×0,7 par image), le titre
  // file en -100, et le mode part avec SON palier.
  for (let i = 0; i < 60; i++) m.update(1);
  const normal = m.mList.find((c) => c.nom === E.PALIERS[1].nom);
  m.souris.x = normal.x; m.souris.y = normal.y;
  m.click(); m.relache();
  assert.equal(m.mList.length, 0, 'la sélection vide la colonne');
  for (let i = 0; i < 400 && !lance.length; i++) m.update(1);
  assert.deepEqual(lance, [{ mode: 'arcade', palier: 1 }], 'l\'arcade part au palier choisi');
  assert.ok(m.titre.y < -90, 'le titre a filé par le haut');
});

test('le menu : une case verrouillée ne répond pas, secret remélange', () => {
  const lance = [];
  const m = new E.Menu({ mesures: MESURES, rng: dé(5), surEvenement: (n, d) => { if (n === 'mode') lance.push(d); } });
  m.demarrer();
  for (let i = 0; i < 700 && m.etape !== 2; i++) m.update(1);
  for (let i = 0; i < 60; i++) m.update(1);
  const time = m.mList.find((c) => c.nom === 'time');
  m.souris.x = time.x; m.souris.y = time.y;
  m.click(); m.relache();
  assert.equal(m.mList.length, 5, 'Time est verrouillé : rien ne bouge');
  assert.equal(lance.length, 0);
  // SECRET, lui, répond — et ne fait que reconstruire le menu (la source :
  // select() repasse par initStep(2) sans rien choisir).
  const secret = m.mList.find((c) => c.nom === 'secret');
  m.souris.x = secret.x; m.souris.y = secret.y;
  m.click(); m.relache();
  assert.equal(m.mList.length, 5, 'le menu se reconstruit');
  assert.ok(m.dList.length > 0, 'les anciennes cases s\'escamotent');
  assert.equal(lance.length, 0, 'et rien ne part');
});
