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
