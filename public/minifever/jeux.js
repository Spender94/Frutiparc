/*
 * MiniFever — les MINI-JEUX, portés un à un des sources « mt ».
 *
 * Chacun tient dans le contrat du socle : une durée, un décor posé à l'init, une
 * image de jeu dans update(), et un verdict. Les formules sont celles des
 * sources, à la ligne près — c'est la seule façon d'obtenir la même sensation,
 * et le seul repère qu'on ait, faute de pouvoir faire tourner l'original.
 *
 * ── Les dessins ──
 *
 * Le SWF d'origine est obfusqué : ses symboles portent des noms tirés au sort.
 * scripts/extract-minifever-sprites.js rend leur vrai nom aux vingt-sept clips
 * de mini-jeu (par l'ordre des `registerClass`), mais pas aux clips que les jeux
 * accrochent à la volée — `mcBasketBall` et consorts sont perdus. On les
 * reconnaît donc à l'œil, sur un rendu, et on note la correspondance ICI, une
 * fois pour toutes. Les caractères d'un même jeu se suivent dans le binaire, ce
 * qui restreint la recherche au voisinage de son clip.
 *
 * ── Les échelles ──
 *
 * Les sources écrivent `skin._xscale = rayon*2`, en pourcentage : elles
 * supposent un dessin de cent unités de large. Les dessins réels s'en écartent
 * un peu (le ballon fait cent dix). On garde LE MÊME facteur que l'original,
 * pas la taille « juste » — c'est ce qu'on voyait à l'écran.
 */
'use strict';

(function (racine) {

const E = (typeof module !== 'undefined' && module.exports)
  ? require('./engine.js') : racine.MinifeverEngine;

const { Jeu, Temps, LARGEUR, HAUTEUR, PROF, borner } = E;

/*
 * BASKET — « marque le panier ».
 *
 * Une flèche balaie de gauche à droite au-dessus du ballon ; l'appui la fige et
 * lance le tir. Le ballon doit passer PAR-DESSUS l'arceau puis redescendre entre
 * ses deux bords — d'où les deux points de rebond, un par bord, contre lesquels
 * il ricoche. Toucher le sol, c'est perdu. La difficulté rétrécit le panier et
 * accélère le balayage.
 *
 * Dessins (voisins de gameBasket #492, identifiés au rendu) :
 *   sym488  l'arceau et son filet, six images — l'animation du panier marqué
 *   sym480  le ballon
 *   sym478  la flèche de visée, pointée vers la droite au repos
 */
class Basket extends Jeu {
  constructor(socle) {
    super(socle);
    this.gameTime = 200;
  }

  init() {
    super.init();
    // PANIER
    this.rayonPanier = (110 - this.dif * 0.4) * 0.5;
    this.panier = this.attacher('sym488', PROF.SPRITE);
    this.panier.x = LARGEUR / 2;
    this.panier.y = 50;
    this.panier.arreter();
    this.panier.sx = this.rayonPanier * 2 / 100;
    this.panier.sy = this.rayonPanier * 2 / 100;
    // La hauteur du clip une fois mis à l'échelle : c'est elle qui dit jusqu'où
    // descend le filet (`basket._height` des sources).
    const b = this.panier.boite || { y0: 0, y1: 85 };
    this.hauteurPanier = (b.y1 - b.y0) * this.panier.sy;

    // Les deux bords de l'arceau : le ballon ricoche dessus.
    this.points = [];
    for (let i = 0; i < 2; i++) {
      this.points.push({ x: this.panier.x + this.rayonPanier * (i * 2 - 1), y: this.panier.y });
    }

    // BALLON
    this.rayonBallon = this.rayonPanier * 0.5;
    this.ballon = this.nouveauPhys('sym480');
    this.ballon.x = LARGEUR * 0.5;
    this.ballon.y = HAUTEUR - this.rayonBallon;
    this.ballon.peau.sx = this.rayonBallon * 2 / 100;
    this.ballon.peau.sy = this.rayonBallon * 2 / 100;
    this.ballon.flPhys = false;
    this.ballon.init();

    // FLÈCHE
    this.fleche = this.attacher('sym478', PROF.SPRITE);
    this.fleche.x = this.ballon.x;
    this.fleche.y = this.ballon.y;
    this.fleche.rot = -90;

    this.flPoint = false;
    this.flEtaitHaut = false;
    this.decal = 0;
    this.angle = this.socle ? this.socle.hasard(628) : 0;
  }

  update() {
    super.update();
    switch (this.etape) {
      case 1: {
        // La visée balaie en cosinus — plus vite quand c'est dur.
        const vitesse = (4 + this.dif * 0.05) * Temps.tmod;
        this.decal = (this.decal + vitesse) % 628;
        this.angle = Math.cos(this.decal / 100) * 0.9 - 1.57;
        this.fleche.rot = this.angle / (Math.PI / 180);
        if (this.socle && this.socle.flPresse) this.lancer();
        break;
      }
      case 2: {
        const b = this.ballon;
        if (this.flPoint) {
          // Les bords de l'arceau : un ricochet, et le ballon part en toupie.
          for (const p of this.points) {
            if (b.distance(p) < this.rayonBallon) {
              const vit = Math.sqrt(b.vitx * b.vitx + b.vity * b.vity);
              const a = b.angle(p);
              b.x = p.x - Math.cos(a) * this.rayonBallon;
              b.y = p.y - Math.sin(a) * this.rayonBallon;
              b.vitx = -Math.cos(a) * vit;
              b.vity = -Math.sin(a) * vit;
              b.vitr = this.aleatoire() * 10;
            }
          }
        } else if (b.y + this.rayonBallon < this.panier.y) {
          // Le ballon est monté au-dessus de l'arceau : il passe devant, et les
          // rebonds s'activent.
          this.flPoint = true;
          this.scene.devant(this.panier);
        }

        // Les murs.
        if (b.x < this.rayonBallon || b.x > LARGEUR - this.rayonBallon) {
          b.vitx *= -1;
          b.x = borner(this.rayonBallon, b.x, LARGEUR - this.rayonBallon);
          b.vitr = this.aleatoire() * 10;
        }
        // Le sol : c'est perdu.
        if (b.y > HAUTEUR - (this.rayonBallon + 10)) {
          b.vity *= -0.8;
          b.y = HAUTEUR - (this.rayonBallon + 10);
          this.gagne(false);
        }

        // La caméra suit le ballon vers le haut.
        const y = b.y - HAUTEUR / 2;
        const d = this.decalY - Math.max(0, -y);
        this.decalY -= d * 0.2 * Temps.tmod;

        // Le verdict : redescendre sous l'arceau, entre ses deux bords.
        const haut = b.y < this.panier.y;
        if (this.flEtaitHaut && this.flPoint && !haut) {
          if (Math.abs(this.panier.x - b.x) < this.rayonPanier) {
            this.panier.jouer();
            this.gagne(true);
          }
        }
        this.flEtaitHaut = haut;

        b.peau.x = b.x;
        b.peau.y = b.y;

        // Le filet retient le ballon marqué, puis l'amortit.
        if (this.gagnant && b.y < this.panier.y + this.hauteurPanier) {
          let min = this.points[0].x + this.rayonBallon;
          let max = this.points[1].x - this.rayonBallon;
          if (b.x < min || b.x > max) {
            b.x = borner(min, b.x, max);
            b.vitx *= -1;
          }
          min *= 0.2;
          max *= 0.2;
          if (b.x < min || b.x > max) b.vitx *= Math.pow(0.95, Temps.tmod);
        }
        break;
      }
      default: break;
    }
  }

  lancer() {
    if (this.etape !== 1) return;
    const force = 30;
    this.etape = 2;
    this.ballon.flPhys = true;
    this.ballon.vitx = Math.cos(this.angle) * force;
    this.ballon.vity = Math.sin(this.angle) * force;
    this.fleche.enlever();
  }
}

/*
 * LANDER — « pose-toi sur la plateforme ».
 *
 * Le module tombe ; la souris l'incline, l'appui allume la poussée. Il faut
 * arriver sur la plateforme à plat et lentement — moins d'une unité de vitesse
 * dans chaque sens — sinon il explose. La difficulté rétrécit la plateforme.
 *
 * Dessins (voisins de gameLander #476) :
 *   sym467  le module et son pilote, deux images — réacteur éteint / allumé
 *   sym474  la plateforme
 *   sym16   la bouffée de fumée de l'explosion, quinze images
 */
class Lander extends Jeu {
  constructor(socle) {
    super(socle);
    this.gameTime = 200;
  }

  init() {
    super.init();
    this.angle = -1.57;
    this.puissance = 0.25;
    this.flEtaitHaut = false;

    // MODULE
    this.rayonModule = 11;
    this.module = this.nouveauPhys('sym467');
    this.module.x = LARGEUR * 0.5;
    this.module.y = HAUTEUR * 0.5;
    this.module.poids = 0.04;
    this.module.peau.arreter();
    this.module.init();

    // PLATEFORME
    this.rayonPlate = (110 - this.dif) * 0.5;
    this.plate = this.attacher('sym474', PROF.SPRITE);
    const r = this.rayonPlate + 10;
    this.plate.x = r + this.socle.hasard(Math.round(LARGEUR - r * 2));
    this.plate.y = HAUTEUR - 15;
    this.plate.sx = (this.rayonPlate - 6) * 2 / 100;
  }

  update() {
    switch (this.etape) {
      case 1: {
        // L'inclinaison suit la souris, mollement.
        const vise = ((this.sourisX / LARGEUR) * 2 - 1) * 1.2 - 1.57;
        this.angle += (vise - this.angle) * 0.1 * Temps.tmod;
        this.module.peau.rot = this.angle / 0.0175;

        const pousse = !!(this.socle && this.socle.flPresse);
        if (pousse) {
          this.module.vitx += Math.cos(this.angle) * this.puissance;
          this.module.vity += Math.sin(this.angle) * this.puissance;
        }
        this.module.peau.allerA(pousse ? 2 : 1);

        const haut = this.module.y + this.rayonModule < this.plate.y;
        const dedans = Math.abs(this.module.x - this.plate.x) < this.rayonPlate;
        if (!haut) {
          if (dedans) this.poser();
          if (this.module.y + this.rayonModule > LARGEUR - 6) this.exploser();
        }
        this.flEtaitHaut = haut;
        break;
      }
      default: break;
    }
    super.update();
  }

  /** À plat, lentement, et par le dessus : sinon c'est un crash. */
  poser() {
    const m = this.module;
    const da = -1.57 - this.angle;
    if (Math.abs(m.vitx) < 1 && Math.abs(m.vity) < 1 && da < 0.1 && this.flEtaitHaut) {
      m.flPhys = false;
      m.vitx = 0;
      m.vity = 0;
      m.peau.allerA(1);
      m.peau.rot = -90;
      this.gagne(true);
      this.etape = 2;
    } else {
      this.exploser();
    }
  }

  exploser() {
    for (let i = 0; i < 10; i++) {
      const p = this.nouvellePart('sym16');
      const a = this.aleatoire() * 6.28;
      const vit = 0.5 + this.socle.hasard(6);
      p.x = this.module.x;
      p.y = this.module.y;
      p.vitx = Math.cos(a) * vit;
      p.vity = Math.sin(a) * vit;
      p.echelle = 50 + this.socle.hasard(50);
      p.poids = 0.1;
      p.minuteur = 10 + this.socle.hasard(10);
      p.fonduType = 1;
      p.init();
      p.peau.allerA(i + 1);
    }
    this.module.tuer();
    this.gagne(false);
    this.etape = 2;
  }
}

/*
 * PONG — « ne laisse pas passer la balle ».
 *
 * Une raquette à droite, une balle qui va et vient. La renvoyer suffit ; tenir
 * jusqu'au bout du chrono, c'est gagné — d'où le `horsTemps` qui donne la
 * victoire au lieu de la défaite. Le point de contact sur la raquette décide de
 * l'angle de renvoi. La difficulté accélère la balle et raccourcit la raquette.
 *
 * Le départ est amorti : la balle est immobile pendant une cinquantaine
 * d'images, le temps que `startCoef` s'annule. Les sources s'y prennent d'une
 * façon retorse — la physique avance la balle, et le jeu la retranche.
 *
 * Dessins (voisins de gamePong #285) :
 *   sym279  la balle, une pastille lumineuse dessinée sur trois cents unités
 *   sym283  la raquette
 *   sym19   la traînée de la balle
 */
class Pong extends Jeu {
  constructor(socle) {
    super(socle);
    this.gameTime = 200;
    this.airFriction = 1;
  }

  init() {
    super.init();
    this.vitesse = 5 + this.dif * 0.15;
    this.rayonRaquette = 30 - this.dif * 0.1;
    this.rayonBalle = 5;
    this.flEtaitGauche = true;
    this.coefDepart = 1;
    this.avant = null;

    // BALLE
    this.balle = this.nouveauPhys('sym279');
    const a = 3.14 + (this.aleatoire() * 2 - 1) * 0.5;
    this.balle.x = LARGEUR - 20;
    this.balle.y = HAUTEUR * 0.5;
    this.balle.vitx = Math.cos(a) * this.vitesse;
    this.balle.vity = Math.sin(a) * this.vitesse;
    this.balle.flPhys = false;
    this.balle.peau.sx = this.rayonBalle * 2 / 100;
    this.balle.peau.sy = this.rayonBalle * 2 / 100;
    this.balle.init();

    // RAQUETTE
    this.raquette = this.nouveauSprite('sym283');
    this.raquette.x = LARGEUR - 14;
    this.raquette.y = HAUTEUR * 0.5;
    this.raquette.peau.sy = this.rayonRaquette * 2 / 100;
    this.raquette.init();
  }

  /** Le chrono qui s'épuise, ici, c'est la victoire. */
  horsTemps() { this.gagne(true); }

  update() {
    super.update();
    if (this.etape !== 1) return;
    const b = this.balle;
    this.coefDepart = Math.max(0, this.coefDepart - 0.02 * Temps.tmod);
    b.x -= b.vitx * Temps.tmod * this.coefDepart;
    b.y -= b.vity * Temps.tmod * this.coefDepart;

    const r = this.rayonBalle;
    if (b.x < r) { b.x = r; b.vitx *= -1; }
    if (b.y < r || b.y > HAUTEUR - r) {
      b.y = borner(r, b.y, HAUTEUR - r);
      b.vity *= -1;
    }

    const gauche = b.x < this.raquette.x;
    if (!gauche && this.flEtaitGauche) {
      const d = b.y - this.raquette.y;
      if (Math.abs(d) < r + this.rayonRaquette) {
        b.x = this.raquette.x - r;
        b.peau.x = b.x;
        const a = 3.14 - (d / (r + this.rayonRaquette)) * 0.8;
        b.vitx = Math.cos(a) * this.vitesse;
        b.vity = Math.sin(a) * this.vitesse;
      } else {
        this.gagne(false);
      }
    }
    this.flEtaitGauche = gauche;

    // La raquette rejoint la souris à mi-chemin, chaque image.
    this.raquette.y += (this.sourisY - this.raquette.y) * 0.5 * Temps.tmod;

    // La traînée : un segment posé entre les deux dernières positions. Les
    // sources en font un clip de vingt images qui se retire tout seul ; on lui
    // donne ici la même durée, en particule.
    if (this.avant) {
      const t = this.nouvellePart('sym19', PROF.SPRITE2);
      t.x = b.x;
      t.y = b.y;
      const a = t.angle(this.avant);
      const d = t.distance(this.avant);
      t.flPhys = false;
      t.minuteur = 20;
      t.fonduSeuil = 20;
      t.init();
      // Après init() : c'est lui qui pose l'échelle des particules, et celle-ci
      // n'est pas carrée — le segment s'étire sur la distance parcourue.
      t.peau.sx = d / 100;
      t.peau.sy = this.rayonBalle * 2 / 100;
      t.peau.rot = a / 0.0174;
    }
    this.avant = { x: b.x, y: b.y };
  }
}

/*
 * FLOWER — « fais pousser la fleur ».
 *
 * Un nuage passe et repasse ; chaque appui lâche une goutte et le nuage
 * rétrécit d'autant. La goutte doit tomber au pied de la fleur : plus elle
 * tombe près, plus la fleur pousse. Le nuage épuisé sans fleur poussée, c'est
 * perdu. La difficulté raccourcit le chrono, réduit le nuage et l'accélère.
 *
 * Dessins (voisins de gameFlower #446) :
 *   sym426  le nuage
 *   sym424  la goutte
 *   sym422  les éclaboussures
 *   sym444  la fleur, dix-sept images — c'est sa pellicule qui EST la pousse
 */
class Flower extends Jeu {
  constructor(socle) {
    super(socle);
  }

  init() {
    this.gameTime = 250 - this.dif * 1.5;
    super.init();
    this.vitesse = 8 + this.dif * 0.2;
    this.taille = 70 - this.dif * 0.3;
    this.decal = 0;
    this.pousse = 0;
    this.sol = HAUTEUR - 34;
    this.gouttes = [];

    // NUAGE
    this.nuage = this.attacher('sym426', PROF.SPRITE);
    this.nuage.x = LARGEUR * 0.5;
    this.nuage.y = 30;
    this.nuage.sx = this.taille / 100;
    this.nuage.sy = this.taille / 100;
    const b = this.nuage.boite || { x0: -20, x1: 20 };
    this.largeurNuage = b.x1 - b.x0;

    // FLEUR
    this.fleur = this.attacher('sym444', PROF.SPRITE);
    const m = 60;
    this.fleur.x = m + this.socle.hasard(LARGEUR - 2 * m);
    this.fleur.y = (this.sol + HAUTEUR) * 0.5;
    this.fleur.arreter();
  }

  update() {
    if (this.etape === 1) {
      // Le nuage balaie la scène, en restant entier à l'écran.
      this.decal = (this.decal + this.vitesse * Temps.tmod) % 628;
      const m = LARGEUR * 0.5;
      const demi = this.largeurNuage * this.nuage.sx * 0.5;
      this.nuage.x = m + Math.cos(this.decal / 100) * (m - demi);
      // Il fond vers sa taille cible, moitié-moitié à chaque image.
      this.nuage.sx = this.nuage.sx * 0.5 + (this.taille / 100) * 0.5;
      this.nuage.sy = this.nuage.sx;

      this.bougerGouttes();

      if (this.taille === 0 && this.gouttes.length === 0) this.gagne(false);
    }
    super.update();
  }

  click() {
    if (this.taille <= 0) return;
    this.taille = Math.max(0, this.taille - 10);
    const g = this.nouveauPhys('sym424');
    g.x = this.nuage.x;
    g.y = this.nuage.y + 20;
    g.poids = 0.5;
    g.init();
    this.gouttes.push(g);
  }

  /** Une goutte tombée au sol : la fleur pousse, et ça éclabousse. */
  bougerGouttes() {
    for (let i = 0; i < this.gouttes.length; i++) {
      const g = this.gouttes[i];
      if (g.y <= this.sol) continue;
      const d = Math.abs(g.x - this.fleur.x);
      const limite = 30;
      if (d < limite) this.grandir((limite - d) * 0.02);
      for (let n = 0; n < 10; n++) {
        const p = this.nouvellePart('sym422');
        p.x = g.x;
        p.y = g.y;
        p.vitx = 6 * (this.aleatoire() * 2 - 1);
        p.vity = -(2 + this.aleatoire() * 6);
        p.echelle = 40 + this.socle.hasard(60);
        p.poids = 0.3;
        p.flPhys = true;
        p.minuteur = 10 + this.socle.hasard(10);
        p.fonduType = 1;
        p.init();
      }
      g.tuer();
      this.gouttes.splice(i, 1);
      i--;
    }
  }

  grandir(s) {
    this.pousse = Math.min(this.pousse + s, 1);
    this.fleur.allerA(Math.floor(this.pousse * (this.fleur.nbImages - 1)) + 1);
    if (this.pousse === 1) this.gagne(true);
  }
}

/*
 * ASTERO — « nettoie le champ d'astéroïdes ».
 *
 * Un Asteroids complet en trois secondes. Le vaisseau se tourne vers la souris
 * et la rejoint quand on ne tire pas ; l'appui tire, et le tir immobilise. Un
 * astéroïde touché se casse en deux moitiés plus petites et plus rapides, deux
 * fois de suite — les rendre tous, c'est gagné ; s'en prendre un, c'est perdu.
 * Tout ce qui sort d'un bord rentre par l'autre. La difficulté ajoute des
 * rochers.
 *
 * Comme Pong, le départ est amorti par `startCoef` : la physique avance les
 * rochers, le jeu les retranche, et ils se dégèlent en une soixantaine
 * d'images.
 *
 * Dessins (voisins de gameAstero #330) :
 *   sym316  le vaisseau
 *   sym318  l'astéroïde, cent unités — mis à l'échelle en pourcentage
 *   sym314  le tir
 *   sym328  l'explosion du vaisseau, dix-sept images de feu
 *   sym312  la poussière d'un rocher qui se casse, vingt-six images
 */
class Astero extends Jeu {
  constructor(socle) {
    super(socle);
    this.gameTime = 320;
    this.airFriction = 1;
  }

  init() {
    super.init();
    this.angle = 0;
    this.repos = 0;                    // `cool` : le délai entre deux tirs
    this.coefDepart = 1;
    this.tirs = [];
    this.rochers = [];

    this.vaisseau = this.nouveauPhys('sym316');
    this.vaisseau.x = LARGEUR * 0.5;
    this.vaisseau.y = HAUTEUR * 0.5;
    this.vaisseau.flPhys = false;
    this.vaisseau.init();

    const max = 1 + Math.floor(this.dif * 0.07);
    for (let i = 0; i < max; i++) {
      const r = this.nouveauRocher(50);
      const a = (i / max) * 6.28;
      r.x = this.vaisseau.x + Math.cos(a) * 70;
      r.y = this.vaisseau.y + Math.sin(a) * 70;
      const a2 = this.socle.hasard(628) / 100;
      r.vitx = Math.cos(a2);
      r.vity = Math.sin(a2);
      r.flPhys = false;
      r.init();
    }
  }

  nouveauRocher(taille) {
    const r = this.nouveauPhys('sym318');
    r.peau.sx = taille / 100;
    r.peau.sy = taille / 100;
    r.taille = taille;                 // `skin._xscale` des sources, en unités
    r.flPhys = false;
    this.rochers.push(r);
    return r;
  }

  /** Une explosion : le clip joue sa pellicule, puis s'efface. */
  eclat(cle, x, y, echelle, rot) {
    const p = this.nouvellePart(cle);
    p.flPhys = false;
    p.x = x;
    p.y = y;
    p.echelle = echelle;
    p.fonduSeuil = 0;                  // le dessin s'éteint tout seul
    p.init();
    p.peau.jouer();
    p.minuteur = p.peau.nbImages;
    if (rot !== undefined) p.peau.rot = rot;
    return p;
  }

  update() {
    if (this.etape === 1) {
      this.coefDepart = Math.max(0, this.coefDepart - 0.015 * Temps.tmod);
      this.bougerVaisseau();
      this.bougerRochers();
      this.suivreTirs();
    }
    super.update();
  }

  bougerVaisseau() {
    // Le vaisseau détruit ne pilote plus rien : les sources laissaient AS2
    // avaler les appels sur `null`, ici il faut le dire.
    if (!this.vaisseau) return;
    const v = this.vaisseau;
    this.repos = Math.max(0, this.repos - Temps.tmod);
    const m = { x: this.sourisX, y: this.sourisY };
    let da = v.angle(m) - this.angle;
    while (da > 3.14) da -= 6.28;
    while (da < -3.14) da += 6.28;
    this.angle += da * 0.5 * Temps.tmod;
    v.peau.rot = this.angle / 0.0174;

    if (this.socle && this.socle.flPresse) {
      if (this.repos === 0 && this.gagnant === null) {
        const t = this.nouveauPhys('sym314');
        const ca = Math.cos(this.angle);
        const sa = Math.sin(this.angle);
        t.x = v.x + ca * 8;
        t.y = v.y + sa * 8;
        t.vitx = ca * 4;
        t.vity = sa * 4;
        t.flPhys = false;
        t.peau.rot = this.angle / 0.0174;
        t.duree = 100;
        t.init();
        this.tirs.push(t);
        this.repos = 2.5;
      }
    } else {
      // Sans tir, le vaisseau se laisse porter vers la souris — d'autant moins
      // qu'il doit encore tourner pour lui faire face.
      const d = v.distance(m);
      const vit = borner(0, (d - Math.abs(da) * 5) * 0.005, 0.5);
      v.vitx += Math.cos(this.angle) * vit * (1 - this.coefDepart);
      v.vity += Math.sin(this.angle) * vit * (1 - this.coefDepart);
    }
    const f = Math.pow(0.95, Temps.tmod);
    v.vitx *= f;
    v.vity *= f;
    this.replier(v, 10);
  }

  bougerRochers() {
    for (const r of this.rochers) {
      r.x -= r.vitx * Temps.tmod * this.coefDepart;
      r.y -= r.vity * Temps.tmod * this.coefDepart;
      if (this.vaisseau && r.distance(this.vaisseau) < r.taille * 0.5 + 4) {
        this.eclat('sym328', this.vaisseau.x, this.vaisseau.y, 50);
        this.vaisseau.tuer();
        this.vaisseau = null;
        this.gagne(false);
      }
      this.replier(r, r.taille * 0.5);
    }
  }

  suivreTirs() {
    for (let i = 0; i < this.tirs.length; i++) {
      const t = this.tirs[i];
      let mort = false;
      for (let n = 0; n < this.rochers.length; n++) {
        const r = this.rochers[n];
        if (t.distance(r) >= r.taille * 0.5) continue;
        // Un rocher assez gros se casse en deux moitiés plus vives.
        if (r.taille > 20) {
          const ang = this.socle.hasard(628) / 100;
          const ca = Math.cos(ang);
          const sa = Math.sin(ang);
          const ns = r.taille * 0.5;
          const vit = Math.sqrt(r.vitx * r.vitx + r.vity * r.vity) * 1.2;
          for (let ii = 0; ii < 2; ii++) {
            const sens = ii * 2 - 1;
            const nr = this.nouveauRocher(ns);
            nr.x = r.x + ca * ns * 0.5 * sens;
            nr.y = r.y + sa * ns * 0.5 * sens;
            nr.vitx = ca * vit * sens;
            nr.vity = sa * vit * sens;
            nr.flPhys = false;
            nr.init();
          }
        }
        this.eclat('sym312', r.x, r.y, r.taille * 2, this.socle.hasard(360));
        r.tuer();
        this.rochers.splice(n, 1);
        mort = true;
        break;
      }
      t.duree -= Temps.tmod;
      if (t.duree < 0) mort = true;
      else if (t.duree < 10) t.peau.alpha = t.duree / 10;
      this.replier(t, 8);
      if (mort) { t.tuer(); this.tirs.splice(i, 1); i--; }
    }
    if (this.rochers.length === 0) this.gagne(true);
  }

  /** checkWarp : ce qui sort d'un bord rentre par l'autre. */
  replier(o, m) {
    if (o.x < -m) o.x = LARGEUR + m + (o.x + m);
    if (o.x > LARGEUR + m) o.x = -m + (o.x - (LARGEUR + m));
    if (o.y < -m) o.y = HAUTEUR + m + (o.y + m);
    if (o.y > HAUTEUR + m) o.y = -m + (o.y - (HAUTEUR + m));
  }
}

/*
 * PARACHUTE — « pose la fourmi sur la feuille ».
 *
 * Une fourmi descend en parachute ; un moulin à vent suit la souris et souffle
 * dessus quand il tourne — l'appui le fait tourner. Il faut la poser sur la
 * feuille qui glisse au ras du sol. La difficulté rétrécit la feuille et
 * l'accélère.
 *
 * Dessins (voisins de gameParachute #406) :
 *   sym404  la fourmi sous son parachute, vingt-huit images. L'obfuscation n'a
 *           pas touché les étiquettes de pellicule : « $landing » est posée sur
 *           l'image 7 (un stop() l'arrête à la 19), « $ploufing » sur la 21
 *           (stop à la fin). En vol, la pellicule est ARRÊTÉE sur l'image 1 —
 *           attachElements appelle skin.stop().
 *   sym382  le moulin, neuf images d'inclinaison (prevFrame/nextFrame)
 *   sym384  la feuille
 */
const PARA_LANDING = [7, 19];
const PARA_PLOUF = [21, 28];

class Parachute extends Jeu {
  constructor(socle) {
    super(socle);
    this.gameTime = 140;
  }

  init() {
    super.init();
    this.rayonFeuille = 40 - this.dif * 0.1;
    this.vitesseFeuille = 0.5 + this.dif * 0.06;
    this.sensFeuille = this.socle.hasard(2) * 2 - 1;
    this.rayonPara = 25;
    this.solFeuille = HAUTEUR - 15;
    this.vitRotation = 0;
    this.flEtaitHaut = false;
    this.decalPose = 0;

    // FEUILLE — le tirage des sources ne retranche le rayon QUE d'un côté.
    this.feuille = this.attacher('sym384', PROF.SPRITE);
    this.feuille.x = this.rayonFeuille + this.socle.hasard(Math.round(LARGEUR - this.rayonFeuille));
    this.feuille.y = this.solFeuille;
    this.feuille.sx = this.rayonFeuille * 2 / 100;
    this.feuille.sy = this.rayonFeuille * 2 / 100;

    // MOULIN
    this.moulin = this.attacher('sym382', PROF.SPRITE);
    this.moulin.x = LARGEUR * 0.5;
    this.moulin.y = HAUTEUR * 0.5 - 20;
    this.moulin.arreter();

    // PARACHUTE
    this.para = this.nouveauPhys('sym404');
    this.para.x = LARGEUR * 0.5;
    this.para.y = HAUTEUR * 0.5;
    this.para.vitr = 0;
    this.para.flPhys = false;
    this.para.peau.arreter();
    this.para.init();
    this.anim = null;             // en vol, la pellicule reste sur l'image 1
  }

  update() {
    switch (this.etape) {
      case 1: {
        this.bougerFeuille();

        // La gravité, à la main (le phys est éteint).
        this.para.y += 0.75 * Temps.tmod;

        // Le souffle du moulin, s'il est à moins de soixante pixels.
        const dx = this.para.x - this.moulin.x;
        const gauche = dx > 0;
        if (Math.abs(dx) < 60) {
          const force = this.vitRotation * (gauche ? 1 : -1);
          this.para.vitx += force * 0.02;
          this.para.vitr -= force * 0.05;
        }

        // La fourmi se redresse d'elle-même.
        this.para.vitr -= borner(-1, this.para.peau.rot * 0.05, 1) * Temps.tmod;
        this.para.vitr *= Math.pow(0.95, Temps.tmod);

        // Les murs.
        if (this.para.x < this.rayonPara || this.para.x > LARGEUR - this.rayonPara) {
          this.para.vitx *= -0.5;
          this.para.x = borner(this.rayonPara, this.para.x, LARGEUR - this.rayonPara);
        }

        this.bougerMoulin();

        // L'atterrissage : le point sous la fourmi, incliné avec elle.
        const y = this.para.y + Math.cos(this.para.peau.rot * 0.0175) * this.rayonPara;
        const haut = y < this.solFeuille;
        if (!haut) {
          if (this.flEtaitHaut) {
            const d = this.para.x - this.feuille.x;
            if (Math.abs(d) < this.rayonFeuille) {
              this.decalPose = d;
              this.atterrir(true);
            }
          }
          if (y > this.solFeuille + 10) this.atterrir(false);
        }
        this.flEtaitHaut = haut;
        break;
      }
      case 2:
        this.bougerFeuille();
        this.para.x = this.feuille.x + this.decalPose;
        this.moulin.alpha *= 0.5;
        break;
      default: break;
    }
    // La pellicule de la fourmi : gotoAndPlay(étiquette), une image par image,
    // jusqu'au stop() du segment.
    if (this.anim && this.para.vivant) {
      this.para.peau.allerA(this.anim.image);
      if (this.anim.image < this.anim.fin) this.anim.image += 1;
    }
    super.update();
  }

  bougerFeuille() {
    this.feuille.x += this.sensFeuille * this.vitesseFeuille;
    if (this.feuille.x < this.rayonFeuille || this.feuille.x > LARGEUR - this.rayonFeuille) {
      this.sensFeuille *= -1;
      this.feuille.x = borner(this.rayonFeuille, this.feuille.x, LARGEUR - this.rayonFeuille);
    }
  }

  bougerMoulin() {
    const m = this.moulin;
    m.x = m.x * 0.5 + this.sourisX * 0.5;
    m.y = m.y * 0.5 + this.sourisY * 0.5;
    // L'inclinaison : une image de pellicule par image, sans boucler.
    const gauche = (this.para.x - m.x) > 0;
    m.image = borner(1, m.image + (gauche ? -1 : 1), m.nbImages);
    m.rot = (this.para.y - m.y) * 0.2 * (gauche ? 1 : -1);
    // L'appui lance les pales ; elles s'essoufflent seules.
    if (this.socle && this.socle.flPresse) this.vitRotation += 1 * Temps.tmod;
    this.vitRotation *= Math.pow(0.95, Temps.tmod);
  }

  atterrir(reussi) {
    this.etape = 2;
    this.anim = reussi
      ? { image: PARA_LANDING[0], fin: PARA_LANDING[1] }
      : { image: PARA_PLOUF[0], fin: PARA_PLOUF[1] };
    this.gagne(reussi);
    this.para.peau.rot = 0;
    this.para.vitx = 0;
    this.para.vity = 0;
    this.para.vitr = 0;
  }
}

/*
 * GOBELET — le bonneteau.
 *
 * Une bille verte se cache sous un gobelet ; les gobelets descendent, se
 * mélangent par paires, et il faut cliquer le bon. La difficulté ajoute des
 * gobelets (quatre à six), des échanges (quatre à quatorze) et de la vitesse.
 * Après un mauvais choix, le jeu montre la solution.
 *
 * Dessins (voisins de gameGobelet #454) :
 *   sym452  le gobelet
 *   sym448  la bille verte
 *   sym450  l'ombre au sol
 */
class Gobelet extends Jeu {
  constructor(socle) {
    super(socle);
    this.gameTime = 220;
  }

  init() {
    super.init();
    this.minuteur = 20;
    this.vitesse = 0.2 + this.dif * 0.003;
    this.nbGobelets = 4 + Math.round(this.dif / 50);
    this.taille = 30;
    this.flSoluce = false;
    this.pos = this.socle.hasard(this.nbGobelets);
    this.decal = 0;
    this.echanges = 0;
    this.paires = [];
    this.leves = [];

    const base = HAUTEUR - 30;
    const ec = (LARGEUR - this.nbGobelets * this.taille) / (this.nbGobelets + 1);
    this.gobelets = [];
    for (let i = 0; i < this.nbGobelets; i++) {
      const x = ec + this.taille * 0.5 + i * (ec + this.taille);
      const ombre = this.attacher('sym450', PROF.SPRITE);
      ombre.x = x; ombre.y = base;
      ombre.sx = this.taille / 100; ombre.sy = this.taille / 100;
      if (this.pos === i) this.poserBille(x, base);
      const mc = this.attacher('sym452', PROF.SPRITE);
      mc.x = x; mc.y = HAUTEUR * 0.5;
      mc.sx = this.taille / 100; mc.sy = this.taille / 100;
      this.gobelets.push({ mc, ombre, t: 4 * i, x });
    }
  }

  poserBille(x, y) {
    this.bille = this.attacher('sym448', PROF.SPRITE);
    this.bille.x = x; this.bille.y = y;
    this.bille.sx = this.taille / 100; this.bille.sy = this.taille / 100;
  }

  update() {
    const base = HAUTEUR - 30;
    switch (this.etape) {
      case 1:
        if (this.minuteur < 0) this.etape = 2;
        else this.minuteur -= Temps.tmod;
        break;
      case 2: {
        // Chaque gobelet attend son tour, puis descend coiffer sa place.
        let tous = true;
        for (const g of this.gobelets) {
          if (g.t < 0) {
            const d = base - g.mc.y;
            g.mc.y += Math.min(d * 0.2, 10) * Temps.tmod;
            if (Math.abs(d) < 0.5) g.mc.y = base;
            else tous = false;
          } else {
            g.t -= Temps.tmod;
            tous = false;
          }
        }
        if (tous) {
          this.echanges = 4 + Math.round(this.dif / 10);
          for (const g of this.gobelets) g.ombre.enlever();
          this.bille.enlever();
          this.melanger();
        }
        break;
      }
      case 3: {
        // L'échange : les deux gobelets décrivent chacun un demi-arc.
        this.decal = Math.min(this.decal + this.vitesse * Temps.tmod, 3.14);
        for (const p of this.paires) {
          for (let g = 0; g < 2; g++) {
            const mc = this.gobelets[p.list[g]].mc;
            const sens = g * 2 - 1;
            mc.x = p.x + Math.cos(this.decal) * p.d * sens;
            mc.y = base + Math.sin(this.decal * sens) * (4 + Math.abs(p.d) * 0.25);
          }
        }
        if (this.decal === 3.14) this.melanger();
        break;
      }
      case 4:
        for (const mc of this.leves) {
          const d = HAUTEUR * 0.5 - mc.y;
          mc.y += Math.min(d * 0.2, 10) * Temps.tmod;
        }
        // Perdu : la solution se montre pendant le fondu.
        if (this.gagnant === false && this.finTimer < 16 && this.leves.length < 2 && !this.flSoluce) {
          this.choisir(this.pos);
          this.flSoluce = true;
        }
        break;
      default: break;
    }
    super.update();
  }

  melanger() {
    this.echanges--;
    if (this.echanges === 0) { this.etape = 4; return; }
    this.etape = 3;
    this.decal = 0;
    this.paires = [];
    let max = 1;
    if (this.socle.hasard(Math.max(1, Math.round(this.dif))) > 20) max++;
    const restants = this.gobelets.map((_, i) => i);
    for (let i = 0; i < max && restants.length >= 2; i++) {
      const p = [];
      for (let g = 0; g < 2; g++) {
        const idx = this.socle.hasard(restants.length);
        p.push(restants[idx]);
        restants.splice(idx, 1);
      }
      const g0 = this.gobelets[p[0]], g1 = this.gobelets[p[1]];
      this.paires.push({ list: p, x: (g0.x + g1.x) * 0.5, d: (g0.x - g1.x) * 0.5 });
      this.scene.devant(g0.mc);
      this.scene.derriere(g1.mc);
      // L'échange d'OBJETS : les places gardent leur x, les gobelets circulent.
      const t = g0.mc; g0.mc = g1.mc; g1.mc = t;
      if (this.pos === p[0]) this.pos = p[1];
      else if (this.pos === p[1]) this.pos = p[0];
    }
  }

  /** L'appui : en phase de choix, le gobelet sous le doigt se lève. */
  click() {
    if (this.etape !== 4 || this.gagnant !== null) return;
    for (let i = 0; i < this.gobelets.length; i++) {
      const mc = this.gobelets[i].mc;
      if (this.leves.includes(mc)) continue;
      if (mc.contient(this.sourisX, this.sourisY)) { this.choisir(i); return; }
    }
  }

  choisir(i) {
    const mc = this.gobelets[i].mc;
    const ombre = this.attacher('sym450', PROF.SPRITE);
    ombre.x = mc.x; ombre.y = mc.y;
    ombre.sx = this.taille / 100; ombre.sy = this.taille / 100;
    if (i === this.pos) {
      this.poserBille(mc.x, mc.y);
      this.gagne(true);
    } else {
      this.gagne(false);
    }
    this.scene.devant(mc);
    this.leves.push(mc);
  }
}

/*
 * MARMITE — « suis la recette ».
 *
 * Neuf ingrédients tournent en ellipse au-dessus de la marmite ; le livre de
 * recette dit lesquels y jeter, DANS L'ORDRE. La souris fait tourner la ronde
 * (sa position gauche-droite donne la vitesse), le bas de l'écran remonte la
 * ronde et cache le livre, l'appui lâche l'ingrédient le plus proche du
 * centre. Un ingrédient hors recette, c'est perdu. La difficulté allonge la
 * recette (une à neuf étapes).
 *
 * Dessins (voisins de gameMarmite #204) :
 *   sym200  les ingrédients, douze images — la recette en affiche des copies
 *   sym187  le livre de recette
 *   sym202  le masque de la marmite — l'ingrédient lâché le reçoit (setMask) et
 *           disparaît DANS la soupe : la forme s'arrête à la courbe du bord
 *
 * Les sources (Marmite.mt) ont aussi une écume — updateBubble(), une bulle par
 * image dans une zone masquée. Elle est POSTÉRIEURE au SWF de développement :
 * le bytecode de la classe compilée n'a ni la méthode, ni son appel, ni le clip
 * mcPartMarmiteBubble parmi les symboles exportés. Le portage suit le SWF, la
 * seule version qui se lance — pas de bulles.
 */
// La matrice du sous-clip `page` dans sym187 : rotation de quinze degrés
// (a = cos, b = sin), calage en (-90.3, -93.9). Relevée dans le SWF.
const PAGE_LIVRE = { a: 0.9659271240234375, b: 0.258819580078125, x: -90.3, y: -93.9, rot: 15 };

class Marmite extends Jeu {
  constructor(socle) {
    super(socle);
    this.gameTime = 460;
  }

  init() {
    super.init();
    this.rx = 100;
    this.ry = 60;
    this.nbIngredients = 9;
    this.decal = 0;
    this.centre = { x: LARGEUR * 0.5, y: 0 };
    this.posLivre = HAUTEUR;
    this.tombants = [];

    // LA RECETTE : un tirage sans remise, d'autant plus long que c'est dur.
    this.recette = [];
    const noms = [];
    for (let i = 0; i < this.nbIngredients; i++) noms.push(i);
    const max = 1 + this.dif * 0.08;
    for (let i = 0; i < max; i++) {
      const idx = this.socle.hasard(noms.length);
      this.recette.push(noms[idx]);
      noms.splice(idx, 1);
    }

    // LA RONDE
    this.ronde = [];
    for (let i = 0; i < this.nbIngredients; i++) {
      const mc = this.nouveauPhys('sym200');
      mc.x = LARGEUR * 0.5;
      mc.y = 0;
      mc.peau.allerA(i + 1);
      mc.init();
      mc.flPhys = false;
      this.ronde.push(mc);
    }

    // LE LIVRE, et sa page : les copies d'ingrédients de la recette,
    // accrochées UNE FOIS — la page montre la recette entière jusqu'au bout,
    // c'est au joueur de se souvenir d'où il en est. Grille de
    // attachElements : x = 16 + (i%4)·24, y = 30 + ⌊i/4⌋·24, échelle 50,
    // alpha 75, dans le sous-clip `page` du livre.
    this.livre = this.nouveauSprite('sym187');
    this.livre.x = LARGEUR * 0.5;
    this.livre.y = this.posLivre;
    this.livre.init();
    this.pageIcones = [];
    for (let i = 0; i < this.recette.length; i++) {
      const mc = this.attacher('sym200', PROF.SPRITE);
      mc.allerA(this.recette[i] + 1);
      mc.sx = 0.5; mc.sy = 0.5;
      mc.alpha = 0.75;
      mc.rot = PAGE_LIVRE.rot;
      this.pageIcones.push(mc);
    }
    this.poserPage();
  }

  /**
   * Les icônes suivent le livre : dans le Flash, elles sont les enfants de sa
   * page, qui porte la matrice du clip 186 dans sym187 — quinze degrés,
   * calée en (-90.3, -93.9). Le livre glisse, ses enfants avec lui.
   */
  poserPage() {
    const P = PAGE_LIVRE;
    for (let i = 0; i < this.pageIcones.length; i++) {
      const lx = 16 + (i % 4) * 24;
      const ly = 30 + Math.floor(i / 4) * 24;
      const mc = this.pageIcones[i];
      mc.x = this.livre.x + P.a * lx - P.b * ly + P.x;
      mc.y = this.livre.y + P.b * lx + P.a * ly + P.y;
    }
  }

  update() {
    if (this.etape === 1) {
      // La moitié basse de l'écran remonte la ronde et range le livre.
      if (this.sourisY > HAUTEUR * 0.5) {
        this.centre.y = -100;
        this.posLivre = HAUTEUR;
      } else {
        this.centre.y = 0;
        this.posLivre = HAUTEUR + 100;
      }

      // La ronde tourne au gré de la souris.
      const vitesse = (this.sourisX - LARGEUR * 0.5) * 0.3;
      this.decal = (this.decal + vitesse * Temps.tmod) % 628;
      for (let i = 0; i < this.ronde.length; i++) {
        const a = (this.decal / 100) + (i / this.ronde.length) * 6.28;
        const mc = this.ronde[i];
        mc.x += (this.centre.x + Math.cos(a) * this.rx - mc.x) * 0.2 * Temps.tmod;
        mc.y += (this.centre.y + Math.sin(a) * this.ry - mc.y) * 0.2 * Temps.tmod;
      }

      // Le livre glisse vers sa place, sa page de recette avec lui.
      this.livre.y += (this.posLivre - this.livre.y) * 0.2 * Temps.tmod;
      this.poserPage();

      // Les ingrédients lâchés : à 190, la marmite avale et juge.
      for (let i = 0; i < this.tombants.length; i++) {
        const mc = this.tombants[i];
        if (mc.y > 190) {
          const id = mc.peau.image - 1;
          if (id === this.recette[0]) {
            this.recette.shift();
            if (this.recette.length === 0) this.gagne(true);
          } else {
            this.gagne(false);
          }
          mc.tuer();
          this.tombants.splice(i, 1);
          i--;
        }
      }
    }
    super.update();
  }

  click() {
    if (this.etape !== 1) return;
    const mc = this.plusBas();
    if (!mc) return;
    mc.flPhys = true;                                // il tombe
    mc.peau.masque = 'sym202';                       // et s'engloutira dans la soupe
    this.tombants.push(mc);
    // La ronde se resserre d'un demi-cran.
    const ec = ((1 / (this.ronde.length - 1)) - (1 / this.ronde.length)) * 628;
    this.decal += ec * 0.5;
    const i = this.ronde.indexOf(mc);
    if (i >= 0) this.ronde.splice(i, 1);
  }

  /** Marmite.getBottom : l'ingrédient le plus proche du centre, sous l'axe. */
  plusBas() {
    let dx = 50;
    let bas = null;
    for (const mc of this.ronde) {
      const d = Math.abs(mc.x - LARGEUR * 0.5);
      if (d < dx && mc.y > 0) { dx = d; bas = mc; }
    }
    return bas;
  }
}

/*
 * Le catalogue : la clef du dessin de fond, le nom, la classe.
 *
 * L'ordre est celui de Base.genGameList(), qui donnait à chaque épreuve une
 * fréquence de tirage identique. Les noms, eux, n'ont jamais été écrits — le
 * tableau Lang.GAME_NAME des sources ne contient que « Nom du jeu », quatre-
 * vingt-dix fois. Ceux-là sont donc de nous.
 */
const JEUX = [
  { cle: 'gameBasket', nom: 'panier', Classe: Basket },
  { cle: 'gameLander', nom: 'alunissage', Classe: Lander },
  { cle: 'gameFlower', nom: 'arrosage', Classe: Flower },
  { cle: 'gamePong', nom: 'renvoi', Classe: Pong },
  { cle: 'gameAstero', nom: 'astéroïdes', Classe: Astero },
  { cle: 'gameParachute', nom: 'parachute', Classe: Parachute },
  { cle: 'gameGobelet', nom: 'bonneteau', Classe: Gobelet },
  { cle: 'gameMarmite', nom: 'marmite', Classe: Marmite },
];

const API = { JEUX, Basket, Lander, Pong, Flower, Astero, Parachute, Gobelet, Marmite };

if (typeof module !== 'undefined' && module.exports) module.exports = API;
else racine.MinifeverJeux = API;

})(typeof window !== 'undefined' ? window : globalThis);
