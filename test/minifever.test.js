/*
 * Mini-Fever — le portage du socle et des épreuves.
 *
 * Le jeu n'est jamais sorti et son SWF ne tourne plus : les SOURCES sont la
 * seule référence. Ces épreuves-là vérifient donc une chose et une seule — que
 * les formules portées sont bien celles de Games/miniFever/src, à la ligne
 * près. Chaque assertion cite la sienne.
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
  for (let i = 0; i < 45 && a.etape === 1; i++) a.update(1);
  assert.equal(a.etape, 2, 'puis le tirage');
  for (let i = 0; i < 200 && a.etape === 2; i++) a.update(1);
  assert.equal(a.etape, 3, 'puis le briefing');
  for (let i = 0; i < 60 && !a.jeu; i++) a.update(1);
  assert.ok(a.jeu, 'et l\'épreuve suivante reprend');
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
});
