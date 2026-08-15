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
 * GATHER — « rassemble les billes ».
 *
 * Des billes rouges éparpillées, un cercle au centre : chaque appui souffle
 * une bourrasque au curseur qui les repousse. Toutes dans le cercle en même
 * temps — elles passent au bleu — et c'est gagné. La difficulté grossit les
 * billes et en ajoute.
 *
 * Dessins (voisins de gameGather #420) :
 *   sym418  le cercle central, tracé en filigrane
 *   sym414  la bille, deux images — rouge dehors, bleue dedans
 *   sym411  la bourrasque, pellicule de sept images dont quatre VIDES : la
 *           griffe s'efface au milieu et souffle un dernier fil à la fin
 */
class Gather extends Jeu {
  constructor(socle) {
    super(socle);
    this.gameTime = 300;
    this.airFriction = 0.95;      // initDefault — le seul jeu à 0.95
  }

  init() {
    super.init();
    this.rayonBille = 10 + this.dif * 0.05;
    this.rayonCercle = 70;
    this.nbBilles = 1 + Math.floor(this.dif * 0.05);
    this.rayonSouffle = 20;

    this.cercle = this.attacher('sym418', PROF.SPRITE);
    this.cercle.x = LARGEUR * 0.5;
    this.cercle.y = HAUTEUR * 0.5;
    this.cercle.sx = this.rayonCercle * 2 / 100;
    this.cercle.sy = this.rayonCercle * 2 / 100;

    this.billes = [];
    for (let i = 0; i < this.nbBilles; i++) {
      const mc = this.nouveauPhys('sym414');
      // Le tirage recommence tant que la bille naît sur le cercle.
      for (let garde = 0; garde < 1000; garde++) {
        mc.x = this.rayonBille + this.socle.hasard(Math.floor(LARGEUR - 2 * this.rayonBille));
        mc.y = this.rayonBille + this.socle.hasard(Math.floor(HAUTEUR - 2 * this.rayonBille));
        if (mc.distance(this.cercle) > this.rayonBille + this.rayonCercle) break;
      }
      // Le dessin fait un dixième des cent unités de référence : ×10.
      mc.peau.sx = this.rayonBille * 2 * 10 / 100;
      mc.peau.sy = this.rayonBille * 2 * 10 / 100;
      mc.flPhys = false;
      mc.peau.arreter();
      mc.init();
      this.billes.push(mc);
    }
  }

  update() {
    if (this.etape === 1) {
      let gagne = true;
      const p = { x: this.cercle.x, y: this.cercle.y };
      for (const mc of this.billes) {
        if (this.gagnant === null) {
          if (mc.distance(p) < this.rayonCercle - this.rayonBille) {
            mc.peau.allerA(2);
          } else {
            gagne = false;
            mc.peau.allerA(1);
          }
        }
        this.cogner(mc);
        this.borgner(mc);
      }
      if (gagne) this.gagne(true);
    }
    super.update();
  }

  click() {
    const p = { x: this.sourisX, y: this.sourisY };
    for (const mc of this.billes) {
      const d = mc.distance(p);
      const rayon = this.rayonSouffle * 2;
      if (d < rayon) {
        const a = mc.angle(p);
        const force = 10 * (rayon - d) / rayon;
        mc.vitx -= Math.cos(a) * force;
        mc.vity -= Math.sin(a) * force;
      }
    }
    // La source règle deux fois `_xscale` avant init() — du code MORT : dans
    // le SWF compilé aussi, Part.init() réécrit l'échelle à 100. La griffe
    // souffle donc en taille pleine, et sa pellicule boucle (le clip attaché
    // joue tout seul).
    const mc = this.nouvellePart('sym411');
    mc.x = p.x;
    mc.y = p.y;
    mc.flPhys = true;
    mc.peau.jouer();
    mc.init();
  }

  /** Game.checkBounds, aux murs amortis à -0.8. */
  borgner(mc) {
    const r = this.rayonBille;
    if (mc.x < r || mc.x > LARGEUR - r) {
      mc.vitx *= -0.8;
      mc.x = borner(r, mc.x, LARGEUR - r);
    }
    if (mc.y < r || mc.y > HAUTEUR - r) {
      mc.vity *= -0.8;
      mc.y = borner(r, mc.y, HAUTEUR - r);
    }
  }

  /** Gather.checkCol : les billes se poussent, moyenne des élans. */
  cogner(mc) {
    for (const mc2 of this.billes) {
      if (mc2 === mc) continue;
      const d = mc.distance(mc2);
      if (d >= this.rayonBille * 2) continue;
      const ecart = this.rayonBille * 2 - d;
      const a = mc.angle(mc2);
      const p1 = Math.sqrt(mc.vitx * mc.vitx + mc.vity * mc.vity);
      const p2 = Math.sqrt(mc2.vitx * mc2.vitx + mc2.vity * mc2.vity);
      const force = (p1 + p2) * 0.5;
      mc.x -= Math.cos(a) * ecart * 0.5;
      mc.y -= Math.sin(a) * ecart * 0.5;
      mc2.x += Math.cos(a) * ecart * 0.5;
      mc2.y += Math.sin(a) * ecart * 0.5;
      mc.vitx -= Math.cos(a) * force;
      mc.vity -= Math.sin(a) * force;
      mc2.vitx += Math.cos(a) * force;
      mc2.vity += Math.sin(a) * force;
    }
  }
}

/*
 * TUBULO — les pistons.
 *
 * Seize capsules en damier isométrique, chacune montrant un tube à trois
 * états. Appuyer sur une case plonge la croix qu'elle forme avec ses quatre
 * voisines, et chaque tube plongé avance d'un état (+1 modulo 3). Tout le
 * monde à l'état zéro, c'est gagné. La difficulté multiplie les croix du
 * mélange initial.
 *
 * Dessins (gameTubulo #214) :
 *   sym209  le tube, trois images — l'enfant nommé du clip mcTube, sorti à
 *           part par l'extracteur
 *   sym210  la FENÊTRE capsule : la forme qui servait de masque au tube, et
 *           qui redevient une découpe ici
 */
class Tubulo extends Jeu {
  constructor(socle) {
    super(socle);
    this.gameTime = 320;
  }

  init() {
    super.init();
    this.xMax = 4;
    this.yMax = 4;
    this.taille = 40;
    this.decal = 0;
    this.flVerif = false;
    this.plongeurs = [];
    this.survole = null;
    // La croix : la case et ses quatre voisines.
    this.croix = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }];

    // La grille, puis le mélange — AVANT d'accrocher les dessins, comme la
    // source (initPuzzle puis attachElements).
    this.grille = [];
    for (let x = 0; x < this.xMax; x++) {
      this.grille[x] = [];
      for (let y = 0; y < this.yMax; y++) this.grille[x].push({ id: 0, mc: null, p: 100, tp: null });
    }
    const tours = 1 + Math.round(this.dif * 0.12);
    for (let i = 0; i < tours; i++) {
      const x = this.socle.hasard(this.xMax);
      const y = this.socle.hasard(this.yMax);
      for (const c of this.croix) {
        const caseLa = this.caseEn(x + c.x, y + c.y);
        if (caseLa) caseLa.id = (caseLa.id + 2) % 3;
      }
    }

    const bx = LARGEUR * 0.5;
    const by = HAUTEUR * 0.5 - this.taille * (this.yMax + this.xMax) * 0.125;
    for (let x = 0; x < this.xMax; x++) {
      for (let y = 0; y < this.yMax; y++) {
        const slot = this.grille[x][y];
        const mc = this.attacher('sym209', PROF.SPRITE);
        slot.x = bx + x * this.taille * 0.5 + y * (-this.taille * 0.5);
        slot.y = by + x * this.taille * 0.4 + y * this.taille * 0.4;
        mc.sx = this.taille / 100;
        mc.sy = this.taille / 100;
        mc.allerA(slot.id + 1);
        mc.masque = { cle: 'sym210', x: slot.x, y: slot.y, sx: this.taille / 100, sy: this.taille / 100 };
        slot.mc = mc;
        this.poserTube(slot, 0);
      }
    }
  }

  /** L'enfant `tube` dans sa capsule : sa plongée est en unités du clip (×taille). */
  poserTube(slot, plongee) {
    slot.mc.x = slot.x;
    slot.mc.y = slot.y + plongee * this.taille / 100;
  }

  caseEn(x, y) {
    const col = this.grille[x];
    return col ? col[y] : null;     // hors grille : la croix s'y absorbe
  }

  /**
   * La case sous un point : la fenêtre capsule, la dernière posée devant —
   * comme le onPress/onRollOver du lecteur. Servie par le survol ET par
   * l'appui, qui arrive au doigt SANS survol préalable.
   */
  sousLePoint(px, py) {
    const b = (this.socle && this.socle.mesures && this.socle.mesures.sym210)
      ? this.socle.mesures.sym210.boite : { x0: -8, y0: -50, x1: 8, y1: 50 };
    const k = this.taille / 100;
    for (let x = this.xMax - 1; x >= 0; x--) {
      for (let y = this.yMax - 1; y >= 0; y--) {
        const slot = this.grille[x][y];
        if (px > slot.x + b.x0 * k && px < slot.x + b.x1 * k
          && py > slot.y + b.y0 * k && py < slot.y + b.y1 * k) return slot;
      }
    }
    return null;
  }

  /*
   * AU DOIGT, la règle Flash trahit l'œil : la boîte d'une capsule couvre son
   * tube, qui monte DERRIÈRE le hublot de la case du dessus — et la dernière
   * posée gagne (sousLePoint). À la souris, le survol teinte la croix et
   * guide la main ; au tactile il n'y a pas de survol, on tape ce qu'on VOIT
   * — et on déclenche la case du dessous. On choisit donc la case dont le
   * HUBLOT visible (le centre de la fenêtre sym210) est le plus proche du
   * doigt, dans un rayon d'une case. La souris garde la règle du lecteur.
   */
  caseVisible(px, py) {
    const b = (this.socle && this.socle.mesures && this.socle.mesures.sym210)
      ? this.socle.mesures.sym210.boite : { x0: -8, y0: -50, x1: 8, y1: 50 };
    const k = this.taille / 100;
    const cx = (b.x0 + b.x1) / 2 * k;
    const cy = (b.y0 + b.y1) / 2 * k;
    let mieux = null, meilleure = this.taille * this.taille;   // rayon : une case
    for (let x = 0; x < this.xMax; x++) {
      for (let y = 0; y < this.yMax; y++) {
        const slot = this.grille[x][y];
        const dx = px - (slot.x + cx);
        const dy = py - (slot.y + cy);
        const d = dx * dx + dy * dy;
        if (d < meilleure) { meilleure = d; mieux = slot; }
      }
    }
    return mieux;
  }

  update() {
    // Le survol : la case sous le curseur teinte sa croix (rollOver 70,
    // rollOut 100).
    const sous = this.sousLePoint(this.sourisX, this.sourisY);
    if (sous !== this.survole) {
      if (this.survole) this.teinterCroix(this.survole, 100);
      if (sous) this.teinterCroix(sous, 70);
      this.survole = sous;
    }

    switch (this.etape) {
      case 1:
        this.eclairer();
        break;
      case 2: {
        this.eclairer();
        this.decal += 40 * Temps.tmod;
        if (this.decal > 314) {
          this.etape = 1;
          this.decal = 314;
        }
        for (const slot of this.plongeurs) {
          this.poserTube(slot, Math.sin(this.decal / 100) * this.taille * 2);
        }
        if (this.flVerif && this.decal > 157) {
          this.verifier();
          this.flVerif = false;
        }
        break;
      }
      default: break;
    }
    super.update();
  }

  click() {
    if (this.etape !== 1) return;
    // La case se cherche AU POINT D'APPUI, pas dans le survol de l'image
    // d'avant : au doigt, l'appui arrive sans survol préalable — s'y fier
    // rendait le jeu muet au tactile. Et au DOIGT, c'est la case VISIBLE la
    // plus proche qui compte (caseVisible) : la boîte Flash sélectionnait la
    // case du dessous, injouable sans le guide du survol.
    const prise = (this.socle && this.socle.flTactile)
      ? this.caseVisible(this.sourisX, this.sourisY)
      : this.sousLePoint(this.sourisX, this.sourisY);
    if (!prise) return;
    let sx = -1, sy = -1;
    for (let x = 0; x < this.xMax; x++) {
      for (let y = 0; y < this.yMax; y++) {
        if (this.grille[x][y] === prise) { sx = x; sy = y; }
      }
    }
    this.plongeurs = [];
    this.etape = 2;
    this.decal = 0;
    this.flVerif = true;
    for (const c of this.croix) {
      const slot = this.caseEn(sx + c.x, sy + c.y);
      if (!slot) continue;
      this.plongeurs.push(slot);
      slot.id = (slot.id + 1) % 3;
    }
  }

  teinterCroix(centre, p) {
    let cx = -1, cy = -1;
    for (let x = 0; x < this.xMax; x++) {
      for (let y = 0; y < this.yMax; y++) {
        if (this.grille[x][y] === centre) { cx = x; cy = y; }
      }
    }
    for (const c of this.croix) {
      const slot = this.caseEn(cx + c.x, cy + c.y);
      if (slot) slot.tp = p;
    }
  }

  /** Tubulo.checkLight : la teinte blanche court vers sa cible (setPColor). */
  eclairer() {
    for (let x = 0; x < this.xMax; x++) {
      for (let y = 0; y < this.yMax; y++) {
        const slot = this.grille[x][y];
        if (slot.tp === null) continue;
        slot.p += (slot.tp - slot.p) * 0.2 * Temps.tmod;
        slot.mc.blanchi = 1 - slot.p / 100;
      }
    }
  }

  /** Tubulo.checkColor : au creux de la plongée, les états s'affichent. */
  verifier() {
    let gagne = true;
    for (let x = 0; x < this.xMax; x++) {
      for (let y = 0; y < this.yMax; y++) {
        const slot = this.grille[x][y];
        slot.mc.allerA(slot.id + 1);
        if (slot.id !== 0) gagne = false;
      }
    }
    if (gagne) this.gagne(true);
  }
}

/*
 * TRAMPOLINE — « saute par-dessus le mur ».
 *
 * Le bonhomme rebondit sur le trampoline ; l'appui tend la toile (ressort
 * doublé) et le guide vers le curseur. Il faut monter plus haut que la ligne
 * du mur puis redescendre — il disparaît alors derrière. Sortir du trampoline,
 * c'est la chute. La difficulté monte le mur d'un étage par palier.
 *
 * Dessins (voisins de gameTrampoline #162) :
 *   sym157  le bonhomme, sept visages — l'ennui (1-4), la surprise du crash
 *           (5), le sourire de la victoire (6), l'inquiétude au bord (7)
 *   sym150  le trampoline
 *   sym152  le sol
 *   sym160  le mur de briques
 *   sym148  le carré rouge : le masque qui escamote le bonhomme derrière le
 *           mur une fois la victoire acquise
 */
class Trampoline extends Jeu {
  constructor(socle) {
    super(socle);
    this.gameTime = 400;
  }

  init() {
    super.init();
    this.hautToile = HAUTEUR - 40;
    this.hautSol = HAUTEUR - 6;
    this.rayonHomme = 24;
    this.rayonToile = 94;
    this.hautMur = (4 - Math.round(this.dif * 0.1)) * 32;
    this.flHaut = false;
    this.flDehors = false;
    this.flTete = true;

    this.mur = this.attacher('sym160', PROF.FOND);
    this.mur.y = this.hautMur;
    this.sol = this.attacher('sym152', PROF.FOND);

    this.homme = this.nouveauPhys('sym157');
    this.homme.x = LARGEUR * 0.5;
    this.homme.y = HAUTEUR * 0.5;
    this.homme.vitr = 0;
    this.homme.poids = 0.5;
    this.homme.peau.sx = this.rayonHomme * 2 / 100;
    this.homme.peau.sy = this.rayonHomme * 2 / 100;
    this.homme.peau.arreter();
    this.homme.init();

    // Le clip vide où l'original trace le filet (dm.empty à DP_SPRITE).
    this.filet = this.attacher(null, PROF.SPRITE);
    this.filet.dessin = [];

    this.toile = this.nouveauSprite('sym150');
    this.toile.x = LARGEUR * 0.5;
    this.toile.y = this.hautToile;
    this.toile.init();
  }

  update() {
    super.update();
    if (this.etape !== 1) return;
    const h = this.homme;
    const y = h.y + this.rayonHomme;

    // Le sommet : passer la ligne du mur gèle le verdict…
    if (!this.flHaut && y < this.hautMur) {
      this.flHaut = true;
      this.flGelResultat = true;
      h.peau.allerA(6);
    }
    // …et la repasser vers le bas le rend : gagné, et le bonhomme s'escamote
    // derrière le mur (le carré rouge en masque, posé à sa ligne).
    if (this.flHaut && y > this.hautMur) {
      this.flGelResultat = false;
      this.flHaut = false;
      this.gagne(true);
      h.peau.masque = { cle: 'sym148', x: 0, y: this.hautMur - HAUTEUR, sx: LARGEUR / 100, sy: HAUTEUR / 100 };
    }

    if (this.flDehors) {
      // Tombé à côté : le sol ne rend rien.
      if (y > this.hautSol) {
        h.y = this.hautSol - this.rayonHomme;
        h.vity *= -0.5;
        this.gagne(false);
        h.peau.allerA(5);
      }
    } else {
      if (y > this.hautToile) {
        if (Math.abs(h.x - this.toile.x) > this.rayonToile - this.rayonHomme) {
          this.flDehors = true;
          this.scene.devant(h.peau);
        }
        // La toile : un ressort, doublé quand on appuie.
        const dy = this.hautToile - y;
        h.vity += dy * 0.1 * Temps.tmod * (this.socle && this.socle.flPresse ? 2 : 1);
        if (this.socle && this.socle.flPresse) {
          const dx = (this.sourisX - h.x) + (this.aleatoire() * 2 - 1) * 5;
          h.vitx -= dx * 0.005;
          h.vitr -= dx * 0.05;
        }
        // Une grimace par rebond, tirée au sort dans l'ennui (2-4).
        if (this.flTete && Math.abs(dy) > this.rayonHomme * 1.5) {
          this.flTete = false;
          h.peau.allerA(this.socle.hasard(3) + 2);
        }
      } else {
        if (!this.flTete) this.flTete = true;
        h.vitr -= h.peau.rot * 0.002;
      }
      // Près du bord, l'inquiétude.
      if (!this.flHaut && this.gagnant === null
        && Math.abs(h.x - this.toile.x) > this.rayonToile - this.rayonHomme * 2) {
        h.peau.allerA(7);
      }
    }

    // Le filet, redessiné à chaque image quand la toile est tendue.
    const d = this.filet.dessin;
    d.length = 0;
    if (!this.flDehors && y > this.hautToile - 4) {
      d.push(['style', 1, 0x0000, 20]);
      d.push(['fond', 0xCECE79, 100]);
      d.push(['aller', this.toile.x - this.rayonToile, this.toile.y]);
      d.push(['ligne', this.toile.x + this.rayonToile, this.toile.y]);
      d.push(['courbe', (this.toile.x + this.rayonToile) * 0.3 + h.x * 0.7, y, h.x, y]);
      d.push(['courbe', (this.toile.x - this.rayonToile) * 0.3 + h.x * 0.7, y, this.toile.x - this.rayonToile, this.toile.y]);
      d.push(['fin']);
    }

    // La caméra suit le bonhomme vers le haut (le _y du clip de jeu).
    const dy = (HAUTEUR * 0.5 - h.y) - this.decalY;
    this.decalY = Math.max(0, this.decalY + dy * 0.15 * Temps.tmod);
  }
}

/*
 * ORBITAL — « abats le poussin ».
 *
 * Un poussin tourne autour d'une planète, à vitesse ondulante ; des lanceurs
 * pointent depuis le sol, chacun recharge son missile puis attend l'appui.
 * Toucher l'oiseau — à dix unités près — l'éclate en plumes. La difficulté
 * accélère l'orbite et RETIRE des lanceurs (six à un seul).
 *
 * Dessins (voisins de gameOrbital #147) :
 *   sym145  la planète
 *   sym143  le poussin
 *   sym141  le lanceur, onze images — 1 le socle vide, 2-11 la recharge du
 *           missile (un stop la tient pleine)
 *   sym137  le missile
 *   sym135  les plumes, quatre variantes
 */
class Orbital extends Jeu {
  constructor(socle) {
    super(socle);
    this.gameTime = 400;
  }

  init() {
    super.init();
    this.vitesse = 4 + this.dif * 0.1;
    this.vitesseDecal = 0;
    this.decal = this.socle.hasard(328);
    this.rayonPlanete = 50;
    this.rayonOrbite = 108;
    this.missiles = [];
    this.vieuxCible = null;

    this.planete = this.nouveauSprite('sym145');
    this.planete.x = LARGEUR * 0.5;
    this.planete.y = HAUTEUR * 0.5;
    this.planete.peau.sx = this.rayonPlanete * 2 / 100;
    this.planete.peau.sy = this.planete.peau.sx;
    this.planete.init();

    this.cible = this.nouveauSprite('sym143');
    this.cible.init();

    // Les lanceurs : espacés d'au moins 0,2 radian, à la cadence i·4.
    this.lanceurs = [];
    const max = 6 - this.dif * 0.05;
    for (let i = 0; i < max; i++) {
      const mc = this.attacher('sym141', PROF.SPRITE);
      mc.x = this.planete.x;
      mc.y = this.planete.y;
      let a = 0;
      for (let garde = 0; garde < 1000; garde++) {
        a = this.socle.hasard(628) / 100;
        let libre = true;
        for (const l of this.lanceurs) if (Math.abs(l.a - a) < 0.2) libre = false;
        if (libre) break;
      }
      mc.rot = a / 0.0174;
      mc.arreter();
      this.lanceurs.push({ mc, a, t: i * 4, anim: null });
    }
  }

  /** Orbital.initLauncher : la recharge joue (2-11), puis le lanceur écoute. */
  armer(info) {
    info.t = null;
    info.anim = { image: 2, fin: 11 };
  }

  update() {
    super.update();
    if (this.etape !== 1) return;
    // L'orbite ondule : dix pas de phase PAR IMAGE, sans tmod, comme l'orbite
    // elle-même — le poussin est un mobile « par image ».
    this.vitesseDecal = (this.vitesseDecal + 10) % 628;
    const sp = this.vitesse + Math.cos(this.vitesseDecal / 100) * this.vitesse * 0.5;
    this.decal = (this.decal + sp) % 628;
    this.cible.x = this.planete.x + Math.cos(this.decal / 100) * this.rayonOrbite;
    this.cible.y = this.planete.y + Math.sin(this.decal / 100) * this.rayonOrbite;
    this.cible.peau.rot += 50 / sp;

    // Les recharges.
    for (const info of this.lanceurs) {
      if (info.t !== null) {
        info.t -= Temps.tmod;
        if (info.t < 0) this.armer(info);
      }
      if (info.anim) {
        info.mc.allerA(info.anim.image);
        if (info.anim.image < info.anim.fin) info.anim.image += 1;
      }
    }

    // Les missiles au contact : dix unités, et le poussin éclate.
    for (let i = 0; i < this.missiles.length; i++) {
      const m = this.missiles[i];
      if (m.distance(this.cible) < 10) {
        this.exploser(this.cible.x, this.cible.y);
        this.gagne(true);
        m.tuer();
        this.cible.tuer();
        this.missiles.splice(i, 1);
        i--;
      }
    }

    this.vieuxCible = { x: this.cible.x, y: this.cible.y };
  }

  click() {
    if (this.etape !== 1) return;
    // Le lanceur PRÊT sous le doigt : le point ramené dans son repère tourné.
    const b = (this.socle.mesures && this.socle.mesures.sym141)
      ? this.socle.mesures.sym141.boite : { x0: -10, y0: -10, x1: 10, y1: 10 };
    for (const info of this.lanceurs) {
      if (info.t !== null || !info.anim || info.anim.image < info.anim.fin) continue;
      const dx = this.sourisX - info.mc.x;
      const dy = this.sourisY - info.mc.y;
      const lx = Math.cos(-info.a) * dx - Math.sin(-info.a) * dy;
      const ly = Math.sin(-info.a) * dx + Math.cos(-info.a) * dy;
      if (lx > b.x0 && lx < b.x1 && ly > b.y0 && ly < b.y1) { this.tirer(info); return; }
    }
  }

  /** Orbital.fire — la rotation du missile porte la coquille de la source. */
  tirer(info) {
    info.t = 80;
    info.anim = null;
    info.mc.allerA(1);
    const mc = this.nouveauPhys('sym137');
    const ca = Math.cos(info.a);
    const sa = Math.sin(info.a);
    const d = this.rayonPlanete + 10;
    mc.x = info.mc.x + ca * d;
    mc.y = info.mc.y + sa * d;
    mc.vitx = ca * 6;
    mc.vity = sa * 6;
    mc.flPhys = false;
    mc.peau.rot = info.a / 0.01714;    // 0.01714, pas 0.0174 — la coquille d'origine
    mc.init();
    this.missiles.push(mc);
  }

  exploser(x, y) {
    // Les plumes héritent de l'élan du poussin : son déplacement d'une image.
    const dist = this.vieuxCible ? Math.hypot(this.cible.x - this.vieuxCible.x, this.cible.y - this.vieuxCible.y) : 0;
    const ta = this.vieuxCible ? Math.atan2(this.vieuxCible.y - this.cible.y, this.vieuxCible.x - this.cible.x) : 0;
    for (let i = 0; i < 12; i++) {
      const mc = this.nouvellePart('sym135');
      const a = this.socle.hasard(628) / 100;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const p = 0.5 + this.socle.hasard(30) * 0.1;
      const taille = 50 + this.socle.hasard(100);
      mc.x = x + ca * p * 1.5;
      mc.y = y + sa * p * 1.5;
      mc.vitx = ca * p - Math.cos(ta) * dist * 0.15;
      mc.vity = sa * p - Math.sin(ta) * dist * 0.15;
      mc.vitr = this.aleatoire() * 20;
      mc.flPhys = false;
      mc.init();
      mc.peau.allerA(this.socle.hasard(mc.peau.nbImages) + 1);
      // La source règle `_xscale` DEUX FOIS après init — jamais `_yscale` :
      // la plume est étirée en largeur seulement. On garde la coquille.
      mc.peau.sx = taille / 100;
    }
  }
}

/*
 * JUMPFISH — « photographie le poisson ».
 *
 * Une ombre tourne dans l'eau ; le poisson saute — une seule fois — et il faut
 * le prendre dans le cadre, qui suit la souris en tanguant. L'appui déclenche :
 * flash blanc, le décor se découpe au format de la photo, le poisson s'y fige.
 * Réussie si le poisson est à moins de 30 % du cadre de son centre. La
 * difficulté rétrécit le cadre et raidit le saut.
 *
 * Dessins (voisins de gameJumpFish #184) :
 *   sym182  l'eau, en toile de fond
 *   sym173  l'ombre sous la surface, dix-sept images de remous
 *   sym166  le cadre photo, deux images — visée, cliché pris
 *   sym163  le carré rouge : masque de la ligne d'eau ET du format photo
 *   sym180  le poisson, six images de nage
 *   sym16   le plouf — la bouffée partagée avec la fumée du Lander, quinze
 *           images, qui se retire d'elle-même
 */
class JumpFish extends Jeu {
  constructor(socle) {
    super(socle);
    this.gameTime = 200;
  }

  init() {
    super.init();
    this.decal = this.socle.hasard(628);
    // `speed = 4 + dif·0.2` dort dans la source : jamais relu. On le laisse.
    this.taille = 100 - this.dif * 0.4;
    this.imageOmbre = 0;
    this.flash = 0;
    this.blancEcran = 0;
    this.distance = 0;

    this.fond = this.attacher('sym182', PROF.SPRITE);
    this.ombre = this.nouveauSprite('sym173');
    this.ombre.peau.alpha = 0;
    this.ombre.peau.arreter();
    this.ombre.init();
    this.cadre = this.nouveauSprite('sym166');
    this.cadre.x = this.sourisX;
    this.cadre.y = this.sourisY;
    this.cadre.peau.sx = this.taille / 100;
    this.cadre.peau.sy = this.taille / 100;
    this.cadre.init();
    this.cadre.peau.arreter();
  }

  update() {
    super.update();
    switch (this.etape) {
      case 1: {
        this.bougerCadre();
        this.decal = (this.decal + 10 * Temps.tmod) % 628;
        const cx = LARGEUR * 0.5;
        const cy = HAUTEUR - 20;
        const ny = cy + Math.sin(this.decal / 100) * 4;
        const dy = ny - this.ombre.y;
        this.ombre.x = cx + Math.cos(this.decal / 100) * 60;
        this.ombre.y = ny;
        const echelle = 100 + (this.ombre.y - cy) * 4;
        this.imageOmbre = (this.imageOmbre + Math.abs(dy * 2)) % this.ombre.peau.nbImages;
        this.ombre.peau.allerA(Math.round(this.imageOmbre) + 1);
        this.ombre.peau.alpha = Math.min(this.ombre.peau.alpha + Temps.tmod * 2 / 100, 1);
        this.ombre.peau.sx = echelle / 100;
        this.ombre.peau.sy = echelle / 100;

        // Le saut : certain sous 100 au chrono, possible dès 140 — au taux
        // auto-compensé random(100/tmod).
        if (this.socle.timer < 100) this.sauter();
        else if (this.socle.timer < 140
          && this.socle.hasard(Math.trunc(100 / Temps.tmod)) === 0) this.sauter();
        break;
      }
      case 2: {
        this.bougerCadre();
        const a = Math.atan2(this.poisson.vity, this.poisson.vitx);
        this.poisson.peau.rot = a / 0.0174;
        if (this.socle.flPresse) { this.photographier(); break; }
        if (this.poisson.y > this.yEau) {
          this.plouf(this.poisson.x, this.poisson.y);
          this.poisson.tuer();
          // La source retire le masque, et son test « y > _y + _yscale·0.5 »
          // devient NaN — TOUJOURS faux : un seul plouf. On garde la garde.
          this.yEau = NaN;
        }
        break;
      }
      case 3:
        this.flash = Math.min(this.flash + 2 * Temps.tmod, 100);
        this.blancEcran = (100 - this.flash) / 100;
        if (this.flash > 98) this.gagne(this.distance < this.taille * 0.3);
        break;
      default: break;
    }
  }

  /** JumpFish.movePhoto : le cadre court après la souris et tangue avec elle. */
  bougerCadre() {
    const c = 0.4;
    const dx = this.sourisX - this.cadre.x;
    const dy = this.sourisY - this.cadre.y;
    const dr = dx * 0.5 - this.cadre.peau.rot;
    this.cadre.x += dx * c * Temps.tmod;
    this.cadre.y += dy * c * Temps.tmod;
    this.cadre.peau.rot += dr * c * Temps.tmod;
  }

  /** JumpFish.initJump : l'ombre devient poisson, masqué à sa ligne d'eau. */
  sauter() {
    this.etape = 2;
    this.plouf(this.ombre.x, this.ombre.y);
    this.poisson = this.nouveauPhys('sym180');
    this.poisson.poids = 0.3 + this.dif * 0.015;
    this.poisson.x = this.ombre.x;
    this.poisson.y = this.ombre.y;
    const tx = LARGEUR * 0.5 + this.aleatoire() * 60;
    const ty = 50 + (this.aleatoire() * 2 - 1) * 10;
    const a = Math.atan2(ty - this.poisson.y, tx - this.poisson.x);
    const p = 9 + this.aleatoire() * 3 + this.dif * 0.15;
    this.poisson.vitx = Math.cos(a) * p;
    this.poisson.vity = Math.sin(a) * p;
    if (this.poisson.vitx < 0) this.poisson.peau.sy *= -1;   // le miroir du saut
    this.ombre.tuer();
    this.poisson.init();
    this.poisson.peau.jouer();                               // la nage continue en vol
    // La ligne d'eau : le carré rouge en masque, du haut du cadre à son départ.
    this.yEau = this.poisson.y;
    this.poisson.peau.masque = { cle: 'sym163', x: LARGEUR * 0.5, y: this.yEau * 0.5, sx: 2.4, sy: this.yEau / 100 };
  }

  /** JumpFish.makePhoto : le monde se découpe au format du cliché. */
  photographier() {
    this.etape = 3;
    this.flash = 0;
    this.blancEcran = 1;
    const m = { cle: 'sym163', x: this.cadre.x, y: this.cadre.y, rot: this.cadre.peau.rot,
      sx: this.taille / 100, sy: this.taille / 100 };
    this.fond.masque = m;
    this.cadre.peau.allerA(2);
    this.scene.devant(this.cadre.peau);
    this.distance = this.poisson.distance(this.cadre);
    // Le poisson FIGÉ, dans le fond masqué — la copie que la source attache.
    const fige = this.attacher('sym180', PROF.SPRITE);
    fige.x = this.poisson.x;
    fige.y = this.poisson.y;
    fige.rot = this.poisson.peau.rot;
    fige.sy = this.poisson.peau.sy;
    fige.allerA(this.poisson.peau.image);
    fige.masque = m;
    this.poisson.tuer();
  }

  plouf(x, y) {
    const mc = this.nouvellePart('sym16');
    mc.x = x;
    mc.y = y;
    mc.flPhys = false;
    mc.init();
    mc.peau.rot = this.aleatoire() * 10;
    mc.peau.finit = true;                // le clip se retire à sa quinzième image
    mc.peau.jouer();
  }
}

/*
 * PATATE — l'habillage du légume.
 *
 * Deux carottes : le MODÈLE à droite, coiffé de trois pièces — yeux, bouche,
 * feuillage — et la vôtre à gauche, nue. En bas, la réserve : douze pièces
 * mélangées, à glisser sur votre légume pour copier le modèle. Reposer une
 * pièce en chasse une autre du même emplacement. La difficulté RACCOURCIT le
 * temps (320 - dif·2).
 *
 * Dessins (gamePatate #237) :
 *   sym235  le légume
 *   sym40   la pièce détachée : la punaise, trois images (une par emplacement)
 *   sym26   les yeux, sym32 les bouches, sym39 les feuillages — l'enfant nommé
 *           de chaque image de sym40, sorti à part (cinq variantes, le jeu en
 *           tire quatre)
 */
// L'ancre de l'enfant dans chaque image de sym40, relevée dans le SWF ; la
// punaise est déjà décalée dans le dessin. decalList = [-12, -31, 26] des
// sources est son arrondi négatif — la pièce se centre ainsi sous le doigt.
const PATATE_TYPES = ['sym26', 'sym32', 'sym39'];
const PATATE_ANCRES = [{ x: 0, y: 12 }, { x: 0.05, y: 30.95 }, { x: -0.05, y: -26.95 }];

class Patate extends Jeu {
  constructor(socle) {
    super(socle);
    this.gameTime = 320;
  }

  init() {
    this.gameTime = 320 - this.dif * 2;
    super.init();
    this.margeHaut = 108;
    this.nbPieces = 3;
    this.nbTypes = 4;
    this.decals = [-12, -31, 26];
    this.poses = [null, null, null];   // elementList
    this.drag = null;
    this.desc = [];
    for (let i = 0; i < this.nbPieces; i++) this.desc.push(this.socle.hasard(this.nbTypes));

    this.corps = this.nouveauSprite('sym235');
    this.corps.x = LARGEUR * 0.25;
    this.corps.y = this.margeHaut * 0.5;
    this.corps.init();

    this.modele = this.nouveauSprite('sym235');
    this.modele.x = LARGEUR * 0.75;
    this.modele.y = this.margeHaut * 0.5;
    this.modele.init();
    for (let e = 0; e < this.nbPieces; e++) {
      const piece = this.nouvellePiece(e, this.desc[e]);
      this.poserPiece(piece, this.modele.x, this.modele.y);
    }

    // La réserve : la grille 3×4, remplie de pièces TIRÉES AU SORT — les
    // positions restent, les contenus se mélangent (attachElements).
    const mx = 50;
    const my = 18;
    const ex = (LARGEUR - 2 * mx) / (this.nbPieces - 1);
    const ey = (HAUTEUR - (this.margeHaut + 2 * my)) / (this.nbTypes - 1);
    const libres = [];
    for (let x = 0; x < this.nbPieces; x++) {
      for (let y = 0; y < this.nbTypes; y++) {
        libres.push({ x: mx + ex * x, y: my + this.margeHaut + ey * y });
      }
    }
    this.pieces = [];
    for (let e = 0; e < this.nbPieces; e++) {
      for (let t = 0; t < this.nbTypes; t++) {
        const idx = this.socle.hasard(libres.length);
        const place = libres[idx];
        libres.splice(idx, 1);
        const piece = this.nouvellePiece(e, t);
        piece.tx = place.x;
        piece.ty = place.y + this.decals[e];
        this.poserPiece(piece, piece.tx, piece.ty);   // le clip se place à l'attache
        this.armerPiece(piece);
        this.pieces.push(piece);
      }
    }
  }

  /** Une pièce : la punaise (image de sym40) et son motif (l'enfant, à l'ancre). */
  nouvellePiece(e, t) {
    const socle = this.attacher('sym40', PROF.SPRITE);
    socle.allerA(e + 1);
    const motif = this.attacher(PATATE_TYPES[e], PROF.SPRITE);
    motif.allerA(t + 1);
    const piece = { e, t, socle, motif, x: 0, y: 0, tx: null, ty: null, prenable: false, x0: 0, y0: 0 };
    this.poserPiece(piece, 0, 0);
    return piece;
  }

  poserPiece(piece, x, y) {
    piece.x = x;
    piece.y = y;
    piece.socle.x = x;
    piece.socle.y = y;
    piece.motif.x = x + PATATE_ANCRES[piece.e].x;
    piece.motif.y = y + PATATE_ANCRES[piece.e].y;
  }

  /** Patate.initElement : la pièce (re)devient prenable depuis SA place. */
  armerPiece(piece) {
    piece.prenable = true;
    piece.x0 = piece.x;
    piece.y0 = piece.y;
  }

  update() {
    if (this.etape === 1) {
      // Tout ce qui a une cible glisse vers elle, à mi-chemin par image.
      for (const p of this.pieces) {
        if (p.tx === null) continue;
        this.poserPiece(p,
          p.x + (p.tx - p.x) * 0.5 * Temps.tmod,
          p.y + (p.ty - p.y) * 0.5 * Temps.tmod);
      }
      if (this.drag) {
        this.drag.tx = this.sourisX;
        this.drag.ty = this.sourisY + this.decals[this.drag.e];
      }
    }
    super.update();
  }

  click() {
    if (this.etape !== 1 || this.drag) return;
    // La pièce prenable la plus HAUTE sous le doigt (la dernière dessinée).
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const p = this.pieces[i];
      if (!p.prenable) continue;
      if (!p.motif.contient(this.sourisX, this.sourisY)) continue;
      if (p.posee) { this.reprendre(p); return; }
      this.drag = p;
      this.scene.devant(p.socle);
      this.scene.devant(p.motif);
      return;
    }
  }

  relache() {
    if (!this.drag) return;
    const p = this.drag;
    this.drag = null;
    // Patate.drop : à moins de soixante unités du légume, la pièce se pose.
    if (Math.hypot(this.corps.x - p.x, this.corps.y - p.y) < 60) {
      if (this.poses[p.e]) this.reprendre(this.poses[p.e].piece);
      p.tx = this.corps.x;
      p.ty = this.corps.y;
      p.prenable = true;               // re-cliquable : c'est le retour
      p.posee = true;
      this.poses[p.e] = { t: p.t, piece: p };
      this.verifier();
    } else {
      p.tx = p.x0;
      p.ty = p.y0;
    }
  }

  /**
   * Le onPress de remplacement de la source : la pièce repart vers sa place —
   * puis initElement recapture sa position COURANTE (encore sur le légume)
   * comme nouvelle place. Une pièce reprise a donc « déménagé » : c'est la
   * bizarrerie de la source, gardée telle quelle.
   */
  reprendre(piece) {
    piece.posee = false;
    piece.tx = piece.x0;
    piece.ty = piece.y0;
    if (this.poses[piece.e] && this.poses[piece.e].piece === piece) this.poses[piece.e] = null;
    piece.x0 = piece.x;
    piece.y0 = piece.y;
    piece.prenable = true;
  }

  verifier() {
    for (let i = 0; i < this.nbPieces; i++) {
      const info = this.poses[i];
      if (!info || info.t !== this.desc[i]) return;
    }
    this.gagne(true);
  }
}

/*
 * game/Frog.mt — LA GRENOUILLE : la pêche à l'envers.
 *
 * Une grenouille somnole au bord de la falaise (limit = 700, le sol y tombe de
 * cent vingt pixels). On tient une canne à pêche : l'appât pend au bout du fil,
 * la canne suit la souris, et l'APPUI la redresse (tr passe de -1 à -2,7 rad).
 * L'agacer, c'est agiter l'appât SOUS son nez : sa patience (`nerve`, 1000)
 * fond de c·d2·8 par unité de temps — c = proximité (max(0, 180-d1)/180),
 * d2 = le chemin parcouru par l'appât depuis l'image d'avant. À bout de nerfs,
 * elle BONDIT sur l'appât (p = 16 + d·0,02) : trop près, elle le gobe
 * (d < 20 → looseTimer 12, perdu) ; assez loin, elle le dépasse — et si elle
 * retombe au-delà de la falaise, vingt éclats de terre saluent la victoire.
 * Retombée au sol d'origine : elle se rassoit (image 1), perdu.
 *
 * Tout est vérifié contre le bytecode (classe « 2N9i1 » du SWF de dev) :
 *   · gameTime = 360 - dif — la SOURCE nue dit 360, le compilé retranche la
 *     difficulté (le champ « 9FH ») : l'arbitre a raison ;
 *   · la CANNE est DESSINÉE (lineStyle(3, 0x8B6830) — moveTo(manche, 0),
 *     curveTo vers la pointe fléchie par bRot). Deux coquilles d'époque
 *     conservées : la pointe DESSINÉE raccourcit de |bRot|·15
 *     (getCanneSize), la pointe PHYSIQUE de |bRot|·10 — elles divergent dès
 *     que le bois plie ; et bRot *= 0,9 s'applique par image, sans tmod ;
 *   · le FIL : tendu au-delà de tensionMax (ressort c·20 sur l'appât, et
 *     au-delà de vingt pour cent d'étirement l'appât est ramené de force),
 *     détendu en-dessous — la courbe pend alors de (tensionMax-dist)·0,5 ;
 *   · les YEUX suivent l'appât : le jeu déplace la PUPILLE
 *     (skin.«8».«8».«51».«61»._x/_y, f.h.h.o.p des sources) de
 *     1,8·(1-c)·cos/sin(a) dans le repère de l'œil. Le dessin extrait la
 *     sépare (sym673_pupille) avec `lin`, la chaîne des placements — les deux
 *     miroirs (corps -1,34, œil -1,2) se composent en +1,61 : le regard suit
 *     bien l'appât, sans inversion ;
 *   · la CAMÉRA (camBox) : cx 0,1 et suivi plein (sp 1) pendant l'affût, puis
 *     au saut cx 0,5, sp 0,2, yMin -200 et xMax = -frog.x — l'écran
 *     accompagne le bond mais ne revient jamais en arrière ;
 *   · la pellicule de la grenouille : images 1-20 l'énervement
 *     (20 - round(nerve/1000·10) : de 10 posée à 20 furieuse), « jump » à 30
 *     (jouée jusqu'au stop d'époque, 42), « eat » à 46.
 *
 * Les dessins : sym673 la grenouille (sans sa pupille), sym673_pupille le
 * regard, sym635 le manche de la canne, sym633 l'appât, sym637 le sol de la
 * falaise (posé à gl, ATTACHÉ EN DERNIER — il passe DEVANT le fil et l'appât,
 * comme dans le SWF : l'ordre d'accrochage fait l'ordre de dessin),
 * sym631 les éclats de terre, gameFrog le ciel (1525 px de long).
 */
class Frog extends Jeu {
  constructor(socle) {
    super(socle);
  }

  init() {
    this.gameTime = 360 - this.dif;
    super.init();
    this.mancheSize = 30;
    this.canneSize = 80;
    this.tensionMax = 80;
    this.limit = 700;
    this.gl = HAUTEUR - 10;
    this.cRot = -1.57;
    this.bRot = 0;
    this.nerveMax = 1000;
    this.nerve = this.nerveMax;
    this.flEat = false;
    this.looseTimer = null;
    this.camBox = { xMin: -9999, xMax: 9999, yMin: 0, yMax: 0, cx: 0.1, sp: 1 };
    this.attachElements();
    this.ob = { x: this.bait.x, y: this.bait.y };
  }

  attachElements() {
    this.frog = this.nouveauPhys('sym673');
    this.frog.x = this.limit - (50 + this.dif * 2);
    this.frog.y = this.gl;
    this.frog.poids = 1;
    this.frog.flPhys = false;
    this.frog.peau.arreter();
    this.frog.init();

    // La pupille, détachée du dessin : même image et même rotation que la
    // grenouille, décalée du vecteur du regard (posé par checkFrog).
    this.pupille = this.attacher('sym673_pupille', PROF.SPRITE);
    this.pupille.arreter();
    this.oeil = { x: 0, y: 0 };            // p._x/_y des sources

    this.canne = this.nouveauSprite('sym635');
    this.canne.x = LARGEUR * 0.5;
    this.canne.y = HAUTEUR * 0.5;
    this.canne.peau.rot = this.cRot / 0.0174;
    this.canne.init();
    // Le clip vide où l'original trace le BOIS de la canne (skin.clear() +
    // curveTo, dans le repère tourné du manche — on tourne les points à la
    // main, même dessin).
    this.tige = this.attacher(null, PROF.SPRITE);
    this.tige.dessin = [];

    this.bait = this.nouveauPhys('sym633');
    this.bait.x = LARGEUR - 0.5;
    this.bait.y = HAUTEUR - 0.5;
    this.bait.poids = 0.7;
    this.bait.init();

    // Le fil (dm.empty), PUIS le décor : l'original accroche le sol en
    // dernier, il couvre le fil et l'appât qui pendouille dessous.
    this.fil = this.attacher(null, PROF.SPRITE);
    this.fil.dessin = [];
    this.decor = this.attacher('sym637', PROF.SPRITE);
    this.decor.y = this.gl;
  }

  update() {
    super.update();
    switch (this.etape) {
      case 1:
        this.moveCam();
        this.moveCanne();
        this.checkFrog();
        this.ob = { x: this.bait.x, y: this.bait.y };
        break;
      case 2:
        this.moveCam();
        this.moveCanne();
        if (this.flEat) {
          this.frog.x = this.bait.x;
          this.frog.y = this.bait.y;
          const dr = -90 - this.frog.peau.rot;
          this.frog.vitr += dr * 0.01 * Temps.tmod;
        } else {
          this.checkLand();
          if (this.frog.flPhys) {
            this.frog.alignerRot();
            this.checkEat();
          }
        }
        if (this.looseTimer !== null) {
          this.looseTimer -= Temps.tmod;
          if (this.looseTimer < 0) {
            this.gagne(false);
            this.looseTimer = 0;
          }
        }
        break;
    }
    // Le stop d'époque au bout du bond (l'image 42 de la pellicule).
    if (this.frog.peau.joue && this.frog.peau.image >= 42) this.frog.peau.arreter();
    this.poserPupille();
    // L'original recale les skins de la canne et de l'appât à chaque image,
    // dans tous les cas — nos Sprites le font déjà (Sprite.update), la tige et
    // le fil se redessinent dans moveCanne.
  }

  /*
   * Frog.moveCam — la caméra : le CLIP ENTIER du jeu se déplace (this._x/_y
   * des sources), nos décalages de scène font pareil. Le suivi vise
   * (mcw·cx - frog.x, mch/2 - frog.y), amorti par camBox.sp, borné par la
   * boîte — que initJump referme sur le présent (xMax = -frog.x).
   */
  moveCam() {
    const c = this.camBox.sp;
    const x = LARGEUR * this.camBox.cx - this.frog.x;
    const y = HAUTEUR * 0.5 - this.frog.y;
    const dx = x - this.decalX;
    const dy = y - this.decalY;
    this.decalX = Math.min(Math.max(this.camBox.xMin, this.decalX + dx * c * Temps.tmod), this.camBox.xMax);
    this.decalY = Math.min(Math.max(this.camBox.yMin, this.decalY + dy * c * Temps.tmod), this.camBox.yMax);
  }

  moveCanne() {
    // La canne se redresse à l'appui (tr -1 → -2,7 rad), en s'amortissant.
    let tr = -1;
    if (this.socle && this.socle.flPresse) tr = -2.7;
    const dr = tr - this.cRot;
    this.cRot += dr * 0.2 * Temps.tmod;
    this.canne.peau.rot = this.cRot / 0.0174;

    // Elle suit la souris, à moitié chemin par unité de temps.
    this.canne.vers({ x: this.sourisX, y: this.sourisY }, 0.5, null);

    // LE BOIS : l'original dessine dans le repère TOURNÉ du manche
    // (moveTo(mancheSize, 0), curveTo(manche + cs·0,8, 0, x, y)) — on tourne
    // les trois points de cRot et on trace en coordonnées de scène.
    const cs = this.getCanneSize();
    const cosR = Math.cos(this.cRot), sinR = Math.sin(this.cRot);
    const tourne = (x, y) => ({
      x: this.canne.x + x * cosR - y * sinR,
      y: this.canne.y + x * sinR + y * cosR,
    });
    const xB = Math.cos(this.bRot) * cs + this.mancheSize;
    const yB = Math.sin(this.bRot) * cs;
    const p0 = tourne(this.mancheSize, 0);
    const pc = tourne(this.mancheSize + cs * 0.8, 0);
    const p1 = tourne(xB, yB);
    this.tige.dessin = [
      ['style', 3, 0x8B6830, 100],
      ['aller', p0.x, p0.y],
      ['courbe', pc.x, pc.y, p1.x, p1.y],
    ];

    // La POINTE physique — raccourcie de |bRot|·10 là où le dessin retire 15 :
    // la coquille d'époque, conservée.
    const bx = this.canne.x + Math.cos(this.cRot) * this.mancheSize;
    const by = this.canne.y + Math.sin(this.cRot) * this.mancheSize;
    const px = bx + Math.cos(this.cRot + this.bRot) * (this.canneSize - Math.abs(this.bRot) * 10);
    const py = by + Math.sin(this.cRot + this.bRot) * (this.canneSize - Math.abs(this.bRot) * 10);

    // L'APPÂT au bout du fil : ressort au-delà de tensionMax, rappel de force
    // au-delà de vingt pour cent d'étirement, mou dessous.
    const dxF = px - this.bait.x;
    const dyF = py - this.bait.y;
    const dist = Math.sqrt(dxF * dxF + dyF * dyF);
    const a = Math.atan2(dyF, dxF);
    let g = null;
    let pression = null;
    if (dist > this.tensionMax) {
      const c = (dist - this.tensionMax) / this.tensionMax;
      const p = 20;
      pression = { a, p: c * p };
      this.bait.vitx += Math.cos(a) * c * p;
      this.bait.vity += Math.sin(a) * c * p;
      const lim = 0.2;
      if (c > lim) {
        this.bait.x = px - Math.cos(a) * this.tensionMax * (1 + lim);
        this.bait.y = py - Math.sin(a) * this.tensionMax * (1 + lim);
      }
    } else {
      g = (this.tensionMax - dist) * 0.5;
    }
    this.bait.vitx *= Math.pow(0.95, Temps.tmod);
    this.bait.vity *= Math.pow(0.95, Temps.tmod);

    // La TENSION DU BOIS : la traction fait plier la canne (bRot), plus fort
    // quand la grenouille pend au bout (flEat). L'amortissement 0,9 est PAR
    // IMAGE, sans tmod — comme gravé.
    if (pression !== null) {
      const sa = pression.a - this.cRot;
      const pr = Math.sin(sa + 3.14) * pression.p;
      this.bRot += pr * 0.02 * (this.bait.poids + (this.flEat ? 2 : 0)) * Temps.tmod;
    }
    this.bRot *= 0.9;

    // LE FIL : blanc, un pixel — droit sous tension, pendant de g sinon.
    const fil = [['style', 1, 0xFFFFFF, 100], ['aller', px, py]];
    if (g === null) {
      fil.push(['ligne', this.bait.x, this.bait.y]);
    } else {
      const mx = (this.bait.x + px) * 0.5;
      const my = (this.bait.y + py) * 0.5 + g;
      fil.push(['courbe', mx, my, this.bait.x, this.bait.y]);
    }
    this.fil.dessin = fil;
  }

  getCanneSize() {
    return this.canneSize - Math.abs(this.bRot) * 15;
  }

  checkFrog() {
    // La patience remonte de 2 par unité de temps, fond de c·d2·8 — c la
    // proximité de l'appât, d2 son agitation depuis l'image d'avant.
    this.nerve = Math.min(this.nerve + 2 * Temps.tmod, 1000);
    const d1 = this.frog.distance(this.bait);
    const d2 = this.bait.distance(this.ob);
    const c = Math.max(0, 180 - d1) / 180;
    this.nerve -= c * d2 * 8 * Temps.tmod;

    if (this.nerve < 0) {
      this.initJump();
    } else {
      const frame = 20 - Math.round((this.nerve / this.nerveMax) * 10);
      this.frog.peau.allerA(frame);
    }

    // LES YEUX : la pupille glisse de 1,8·(1-c) vers l'appât — même après le
    // déclenchement du bond (l'original pose les yeux APRÈS le if, sans
    // retour anticipé).
    const a = this.frog.angle(this.bait);
    this.oeil.x = 1.8 * (1 - c) * Math.cos(a);
    this.oeil.y = 1.8 * (1 - c) * Math.sin(a);
  }

  /*
   * La pupille suit la grenouille : même image, même rotation, décalée du
   * vecteur du regard transformé par la chaîne de l'œil (`lin`, par image),
   * puis par la rotation du corps — translate(pos)∘R∘translate(o) =
   * translate(pos + R·o)∘R.
   */
  poserPupille() {
    const peau = this.frog.peau;
    const p = this.pupille;
    p.image = peau.image;
    p.rot = peau.rot;
    const lin = (p.lins && p.lins[peau.image - 1]) || [1, 0, 0, 1];
    const ox = lin[0] * this.oeil.x + lin[2] * this.oeil.y;
    const oy = lin[1] * this.oeil.x + lin[3] * this.oeil.y;
    const r = peau.rot * 0.0174;
    const cosR = Math.cos(r), sinR = Math.sin(r);
    p.x = this.frog.x + ox * cosR - oy * sinR;
    p.y = this.frog.y + ox * sinR + oy * cosR;
    p.visible = peau.visible;
  }

  initJump() {
    this.etape = 2;
    const a = this.frog.angle(this.bait);
    const d = this.frog.distance(this.bait);
    const p = 16 + d * 0.02;
    this.frog.vitx += Math.cos(a) * p;
    this.frog.vity += Math.sin(a) * p;
    this.frog.flPhys = true;
    this.frog.peau.allerA(30);            // « jump », jouée jusqu'au stop (42)
    this.frog.peau.jouer();
    this.camBox.yMin = -200;
    this.camBox.yMax = 0;
    this.camBox.cx = 0.5;
    this.camBox.sp = 0.2;
    this.camBox.xMax = -this.frog.x;
    this.flHorsTemps = true;              // flTimeProof : le sort est déjà joué
  }

  checkEat() {
    const d = this.frog.distance(this.bait);
    if (d < 20) {
      this.flEat = true;
      this.bait.vitx += this.frog.vitx;
      this.bait.vity += this.frog.vity;
      this.bait.peau.visible = false;
      this.frog.flPhys = false;
      this.frog.vitx = 0;
      this.frog.vity = 0;
      this.frog.vitr = 0;
      this.frog.peau.allerA(46);          // « eat »
      this.camBox.sp = 0;
      this.looseTimer = 12;
    }
  }

  checkLand() {
    let g = this.gl;
    if (this.frog.x > this.limit) g += 120;
    if (this.frog.y > g) {
      this.frog.y = g;
      this.frog.flPhys = false;
      this.frog.vitx = 0;
      this.frog.vity = 0;
      if (g === this.gl) {
        this.frog.peau.allerA(1);
        this.frog.peau.rot = 0;
        this.gagne(false);
      } else {
        this.gagne(true);
        for (let i = 0; i < 20; i++) {
          const mc = this.nouvellePart('sym631');
          mc.x = this.frog.x;
          mc.y = this.frog.y;
          mc.vitx = 5 * (this.aleatoire() * 2 - 1);
          mc.vity = -(3 + this.aleatoire() * 6);
          mc.echelle = 30 + this.socle.hasard(60);
          mc.poids = 0.5;
          mc.init();
        }
      }
    }
  }
}

/*
 * game/Apple.mt — LA POMME : la croquer toute, au bout de son élastique.
 *
 * Une pomme pend au fil (ancre fil = {120, 0}, longueur max 120) : au-delà,
 * un ressort la rappelle (c = (dist-max)/max, force 4) — et chaque BOUCHÉE la
 * repousse (recul 14 à l'opposé de la souris). Cliquer la pomme la croque :
 * la morsure s'ajoute au MASQUE qui découvre le ciel — la chair disparaît, le
 * trognon apparaît là où le cœur passe. Tout croqué (au sondage : sur
 * cinquante points tirés dans le rayon, deux tolérés encore pleins), gagné.
 * Perdu seulement au chrono (gameTime = 350 - dif·2,5).
 *
 * Tout est vérifié contre le bytecode (classe « 68iuA1 » du SWF de dev) :
 *   · ray 50, crunchSize 50, airFriction 0,97 (initDefault d'époque) ;
 *   · le « TRES TRES SALE » de la source, conservé : l'angle du fil se mesure
 *     depuis un point UN RAYON PLUS BAS que la pomme (apple.y += ray, getAng,
 *     apple.y -= ray) — la distance, elle, se mesure au centre ;
 *   · la peau s'oriente a/0,0174 + 90 ; le fil se trace lineStyle(4,
 *     0x448800), de (fil.x, -ray) en courbe vers le bord de la pomme, la
 *     détente creusant le ventre (fall = min(0, max-dist)·0,5) ;
 *   · la MORSURE : huit miettes tirées en couronne (angle random(628)/100,
 *     portée 1 + random(10), ×2,5), gardées seulement sur la CHAIR pas
 *     encore mangée ; le blob de morsure s'accroche dans le masque à
 *     l'échelle crunchSize ; le recul vaut 14 ; la fin sonde cinquante
 *     points (rayon random(50), angle random(628)/100) et tolère deux
 *     survivants — setWin(true) SANS toucher à step : l'élastique continue
 *     de vivre, et on peut encore mordre dans le vide après la victoire ;
 *   · COQUILLE des miettes, conservée : la source les pose à
 *     apple.x + skin._xmouse — la souris LOCALE (repère tourné de la peau)
 *     ajoutée telle quelle à la position MONDE : pomme tournée, les miettes
 *     dérivent un peu du point mordu. On fait pareil.
 *
 * Les appuis et les formes — hitTest(x, y, true) d'époque, approché sur les
 * géométries extraites (comme la case au doigt de Tubulo) :
 *   · le disque d'APPUI : shape225, un rond magenta de 130 px à alpha 0
 *     (fill-opacity 0 dans le SVG extrait) sous la pomme — rayon 65 ;
 *   · la CHAIR (image 3 de mcApple, shape229, cachée par _alpha = 0 comme le
 *     crunchZone d'époque) : une galette 96,5 × 73,6 centrée (-0,45, 3,65)
 *     dans le repère de la peau — approchée par cette ellipse ;
 *   · la MORSURE (shape221) : un blob rond festonné de 100 px — approché par
 *     son cercle, rayon 50 × crunchSize % = 25 ;
 *   · la BASE du masque (shape223) : un fil de 0,05 px — rien de visible au
 *     départ, ignorée des sondages.
 *
 * Les dessins : gameApple la scène — qui n'est QUE le ciel (sym232 posé à
 * l'identité) : mordre révèle le fond même —, sym230 la pomme (1 pleine,
 * 2 trognon, 3 chair), sym232 le ciel à révéler, sym224 la base du masque,
 * sym222 le blob de morsure, sym220 les miettes (cinq poses au hasard).
 */
class Apple extends Jeu {
  constructor(socle) {
    super(socle);
  }

  init() {
    this.gameTime = 350 - this.dif * 2.5;
    super.init();
    this.airFriction = 0.97;             // initDefault() d'époque
    this.fil = { x: LARGEUR * 0.5, y: 0, max: HAUTEUR * 0.5 };
    this.ray = 50;
    this.crunchSize = 50;
    this.depthRun = 0;
    this.morsures = [];                  // les enfants du masque (attachMC d'époque)
    this.attachElements();
  }

  attachElements() {
    // APPLE — la peau ne règle que _xscale (coquille de la source) ; à
    // ray·2 = 100 %, ça ne change rien, on l'écrit quand même.
    this.pomme = this.nouveauPhys('sym230');
    this.pomme.x = LARGEUR * 0.5;
    this.pomme.y = -this.ray;
    this.pomme.peau.sx = this.ray * 2 / 100;
    this.pomme.peau.allerA(1);
    this.pomme.init();

    // SKY — le ciel à révéler, et le trognon accroché DEDANS : tous deux ne
    // se voient qu'à travers le masque des morsures (sky.setMask d'époque —
    // un seul objet masque, partagé).
    this.ciel = this.attacher('sym232', PROF.SPRITE);
    this.trognon = this.attacher('sym230', PROF.SPRITE);
    this.trognon.allerA(2);
    this.trognon.x = this.pomme.x;
    this.trognon.y = this.pomme.y;
    this.trognon.sx = this.ray * 2 / 100;
    this.trognon.sy = this.ray * 2 / 100;

    // MASK — la base filiforme (sym224) plus les morsures à venir.
    this.masque = { cle: 'sym224', x: this.pomme.x, y: this.pomme.y,
      sx: this.ray * 2 / 100, sy: this.ray * 2 / 100, rot: 0, enfants: this.morsures };
    this.ciel.masque = this.masque;
    this.trognon.masque = this.masque;

    // MCFIL — le clip vide où se trace l'élastique.
    this.mcFil = this.attacher(null, PROF.SPRITE);
    this.mcFil.dessin = [];
  }

  update() {
    super.update();
    switch (this.etape) {
      case 1: {
        // FIL — la distance au centre, l'angle un rayon plus bas.
        const dist = this.pomme.distance(this.fil);
        this.pomme.y += this.ray;            // TRES TRES SALE (sic, la source)
        const a = this.pomme.angle(this.fil);
        this.pomme.y -= this.ray;            // TRES TRES SALE

        if (dist > this.fil.max) {
          const c = (dist - this.fil.max) / this.fil.max;
          const p = 4;
          this.pomme.vitx += Math.cos(a) * c * p;
          this.pomme.vity += Math.sin(a) * c * p;
        }
        this.pomme.peau.rot = a / 0.0174 + 90;

        // DRAW
        const x = this.pomme.x + Math.cos(a) * this.ray;
        const y = this.pomme.y + Math.sin(a) * this.ray;
        const fall = Math.min(0, this.fil.max - dist) * 0.5;
        const mx = (this.fil.x + x) * 0.5;
        const my = (this.fil.y + y) * 0.5;
        this.mcFil.dessin = [
          ['style', 4, 0x448800, 100],
          ['aller', this.fil.x, this.fil.y - this.ray],
          ['courbe', mx, my + fall, x, y],
        ];
        break;
      }
      default: break;
    }
    // Le masque et le trognon suivent la pomme — chaque image, étape ou pas.
    this.masque.x = this.pomme.x;
    this.masque.y = this.pomme.y;
    this.masque.rot = this.pomme.peau.rot;
    this.trognon.x = this.pomme.x;
    this.trognon.y = this.pomme.y;
    this.trognon.rot = this.pomme.peau.rot;
  }

  /** La souris dans le repère de la peau (skin._xmouse/_ymouse d'époque). */
  enLocal(x, y) {
    const r = -this.pomme.peau.rot * Math.PI / 180;
    const dx = x - this.pomme.x;
    const dy = y - this.pomme.y;
    return { x: dx * Math.cos(r) - dy * Math.sin(r), y: dx * Math.sin(r) + dy * Math.cos(r) };
  }

  /** crunchZone.hitTest : la chair (shape229), approchée par son ellipse. */
  estChair(x, y) {
    const l = this.enLocal(x, y);
    const ex = (l.x + 0.45) / 48.25;
    const ey = (l.y - 3.65) / 36.8;
    return ex * ex + ey * ey <= 1;
  }

  /** sky.hitTest : le point n'est « ciel » qu'à travers une morsure du masque. */
  estMange(x, y) {
    const l = this.enLocal(x, y);
    const r = 50 * (this.crunchSize / 100);
    for (const m of this.morsures) {
      const dx = l.x - m.x;
      const dy = l.y - m.y;
      if (dx * dx + dy * dy <= r * r) return true;
    }
    return false;
  }

  /** onPress du dessin : le disque d'appui invisible de 130 px (rayon 65). */
  click() {
    if (this.pomme.distance({ x: this.sourisX, y: this.sourisY }) <= 65) this.crunch();
  }

  crunch() {
    const lm = this.enLocal(this.sourisX, this.sourisY);

    // PARTICULE — huit miettes en couronne, gardées sur la chair encore
    // pleine. La position MONDE reçoit la souris LOCALE telle quelle
    // (coquille d'époque, conservée).
    for (let i = 0; i < 8; i++) {
      const a = this.socle.hasard(628) / 100;
      const p = 1 + this.socle.hasard(10);
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const x = this.pomme.x + lm.x + ca * p * 2.5;
      const y = this.pomme.y + lm.y + sa * p * 2.5;
      if (this.estChair(x, y) && !this.estMange(x, y)) {
        const mc = this.nouvellePart('sym220');
        mc.x = x;
        mc.y = y;
        mc.vitx = ca * p;
        mc.vity = sa * p;
        mc.vitr = this.aleatoire() * 20;
        mc.peau.rot = a / 0.0174;
        mc.init();
        mc.peau.allerA(this.socle.hasard(mc.peau.nbImages) + 1);
      }
    }

    // ATTACH CRUNCH — la morsure entre dans le masque, à l'échelle crunchSize.
    this.depthRun++;
    this.morsures.push({ cle: 'sym222', x: lm.x, y: lm.y,
      sx: this.crunchSize / 100, sy: this.crunchSize / 100 });

    // Le recul : à l'opposé de la souris JEU.
    const m = { x: this.sourisX, y: this.sourisY };
    const a2 = this.pomme.angle(m);
    const p2 = 14;
    this.pomme.vitx -= Math.cos(a2) * p2;
    this.pomme.vity -= Math.sin(a2) * p2;

    // CHECK END — cinquante sondages, deux survivants tolérés. setWin(true)
    // sans toucher à step : l'élastique continue, on peut mordre le vide.
    let tol = 0;
    for (let i = 0; i < 50; i++) {
      const d = this.socle.hasard(Math.round(this.ray));
      const an = this.socle.hasard(628) / 100;
      const x = this.pomme.x + Math.cos(an) * d;
      const y = this.pomme.y + Math.sin(an) * d;
      if (this.estChair(x, y) && !this.estMange(x, y)) {
        tol++;
        if (tol > 2) return;
      }
    }
    this.gagne(true);
  }
}

/*
 * game/Bomb.mt — LA BOMBE : éteindre la mèche.
 *
 * Une braise remonte la mèche (speed = 0,5 + dif·0,015 px par unité de temps)
 * vers la bombe, au bout à droite (limit = 169). Le monstre du coin tient
 * l'arrosage : APPUYER charge (power monte de 0,5 par temps, plafond 10 — sa
 * pose suit, images 20 à 30), RELÂCHER lance une boule d'eau en cloche
 * (angle fixe -3π/4, vitesse power·0,8, poids 0,5) — mais seulement si
 * power > 2,5 : le lancer mou est avalé sans boule. Chaque boule qui passe
 * SOUS la ligne de la mèche y éclate en dix gouttes ; à moins de dix pixels
 * de la braise, c'est éteint — gagné. La braise au bout : la bombe saute.
 *
 * Tout est vérifié contre le bytecode (classe « 8__V1 » du SWF de dev) :
 *   · gameTime = 540 - dif·3 ; limit 169 ; angle -2.356194490192345 ;
 *     speed 0,5 + dif·0,015 ; charge min(power + 0,5·tmod, 10) — le 10 est
 *     un littéral, powerMax (10 aussi) déclaré mais jamais lu ;
 *   · la boule part de (monster._x - 39, monster._y - 63), peau à 60 %,
 *     et ondule (vingt et une images rebouclées par le DoAction du clip) ;
 *   · l'éclat : dix gouttes, vitx 5·(2·hasard-1) + vitx de la boule,
 *     vity -(3 + hasard·8), échelle 40 + random(60), minuteur 10 +
 *     random(10), fondu par l'échelle (type 1), alpha 60 % ;
 *   · COQUILLE de la victoire, conservée : la branche « éteinte » pose
 *     setWin(true) et step = 2 SANS play() ni return — le tour de
 *     charge/lancer s'exécute donc encore cette image-là (un appui tenu y
 *     charge une dernière fois la pose du monstre) ; la défaite, elle, fait
 *     play() et return ;
 *   · la MÈCHE (l'enfant « bomb » de la source, jamais piloté) est masquée
 *     par sym67 — un rectangle 100×100 accroché en haut à gauche, donc
 *     _xscale y vaut des PIXELS : mask._x = spark._x, _xscale =
 *     Cs.mcw - spark._x — la mèche n'existe qu'à droite de la braise, le
 *     brûlé disparaît ;
 *   · var flReady, déclarée dans la source et jamais lue : c'est la TIMELINE
 *     du monstre qui la pose (stop() puis _parent.flReady = true à son image
 *     quinze, la fin de son entrée) — vestige d'époque, reproduit tel quel.
 *
 * Les timelines, rejouées à la main comme le lecteur les jouait :
 *   · l'étincelle (sym73) boucle ses flammes 1-2-3 — le DoAction de l'image
 *     4 rembobine AVANT le rendu, et son dessin (le même que la 3) ne
 *     s'affiche jamais ; « fumée » (étiquette obfusquée « 3w07p », image 5)
 *     se joue jusqu'au stop de l'image 22 ;
 *   · le monstre (sym88) joue son entrée 1-14 et s'arrête à 15 ;
 *   · la scène (la cellule gameBomb, extraite sans ses enfants nommés) est
 *     stoppée sur son image 1 (le pré) ; jouée à la défaite, elle déroule
 *     l'explosion — deux éclairs plein cadre (images 2-3, plus personne
 *     d'affiché), puis le monstre REPLACÉ par la timeline, instance fraîche
 *     soufflée en tournoyant (trois poses relevées sur les PlaceObject,
 *     rotation ~25,3°), stop à 6.
 *
 * Les dessins : gameBomb la scène (sans ses enfants nommés — le client la
 * pose déjà en décor, on l'accroche AUSSI en Mc pour jouer l'explosion),
 * sym64 la mèche et sa bombe (ancrées à la bombe, la mèche file à gauche),
 * sym73 l'étincelle, sym88 le monstre, sym67 la fenêtre du masque, sym62 la
 * boule d'eau (mcWaterBall), sym422 la goutte (mcPartGoutte, partagée).
 */
class Bomb extends Jeu {
  constructor(socle) {
    super(socle);
  }

  init() {
    this.gameTime = 540 - this.dif * 3;
    super.init();
    this.limit = 169;
    this.powerMax = 10;            // déclaré comme à l'époque… et comme à l'époque, jamais lu
    this.angle = -Math.PI * 0.75;
    this.speed = 0.5 + this.dif * 0.015;
    this.water = [];
    this.power = null;
    this.fumee = false;
    this.flReady = false;
    this.tourFlamme = 0;
    this.monstreSouffle = false;
    this.attachElements();
  }

  attachElements() {
    // Vide dans la source : la scène (sym92 du SWF) porte déjà ses acteurs.
    // On rejoue ici ses PlaceObject, aux positions du SWF, tous sous
    // PROF.FOND — l'ordre d'accrochage refait l'ordre des profondeurs de la
    // timeline (1, 2, 4, 11, 15), et les clips attachés par script (boules,
    // gouttes) passent devant, comme les attachMovie d'époque au-dessus de
    // la timeline.
    this.fond = this.attacher('gameBomb', PROF.FOND);
    this.fond.arreter();                   // stop() d'époque sur l'image 1

    this.bombe = this.attacher('sym64', PROF.FOND);
    this.bombe.x = 200.8;
    this.bombe.y = 199.85;
    // La fenêtre du masque, aux valeurs posées dans le SWF — l'image 1 du jeu
    // les remplace aussitôt par celles de l'étincelle. Le _yscale d'auteur
    // (99,9466 %) n'est jamais retouché par le code : on le garde.
    this.bombe.masque = { cle: 'sym67', x: 12.45, y: 138.9, sx: 2.409088, sy: 0.999466 };

    this.etincelle = this.attacher('sym73', PROF.FOND);
    this.etincelle.x = -13.25;
    this.etincelle.y = 229.45;

    this.monstre = this.attacher('sym88', PROF.FOND);
    this.monstre.x = 200.8;
    this.monstre.y = 199.85;
    this.monstre.jouer();                  // son entrée, images 1 à 14
  }

  update() {
    super.update();

    // Les TIMELINES — ce que le lecteur Flash faisait tout seul.
    if (!this.fumee && this.fond.image < 2) {
      this.etincelle.allerA(1 + (this.tourFlamme % 3));   // flammes 1-2-3
      this.tourFlamme++;
    } else if (this.etincelle.joue && this.etincelle.image >= 22) {
      this.etincelle.arreter();            // le stop au bout de la fumée
    }
    if (this.monstre.joue && this.monstre.image >= 15) {
      this.monstre.arreter();              // stop() de l'image 15…
      this.flReady = true;                 // …et son _parent.flReady = true
    }
    if (this.fond.joue && this.fond.image >= 6) this.fond.arreter();
    if (this.fond.image >= 2) {
      // L'explosion : la timeline d'époque n'y place plus ni mèche ni
      // étincelle ni masque, et le monstre revient à l'image 4 — instance
      // fraîche (pellicule redémarrée), soufflée en tournoyant.
      this.etincelle.visible = false;
      this.bombe.visible = false;
      const pose = BOMB_SOUFFLE[this.fond.image];
      if (pose) {
        if (!this.monstreSouffle) {
          this.monstreSouffle = true;
          this.monstre.allerA(1);
          this.monstre.jouer();
        }
        this.monstre.visible = true;
        this.monstre.x = pose.x;
        this.monstre.y = pose.y;
        this.monstre.rot = pose.rot;
        this.monstre.sx = pose.s;
        this.monstre.sy = pose.s;
      } else {
        this.monstre.visible = false;
      }
    }

    switch (this.etape) {
      case 1:
        // LA BRAISE remonte la mèche.
        this.etincelle.x += this.speed * Temps.tmod;
        if (this.etincelle.x > this.limit) {
          this.gagne(false);
          this.etape = 2;
          this.fond.jouer();               // play() : la scène déroule l'explosion
          return;
        }
        this.bombe.masque = { cle: 'sym67', x: this.etincelle.x, y: 138.9,
          sx: (LARGEUR - this.etincelle.x) / 100, sy: 0.999466 };

        // L'EAU : toute boule passée sous la ligne de la mèche y éclate.
        for (let i = 0; i < this.water.length; i++) {
          const mc = this.water[i];
          if (mc.y > this.etincelle.y) {
            if (Math.abs(this.etincelle.x - mc.x) < 10) {
              this.fumee = true;           // gotoAndPlay(« smoke »)
              this.etincelle.allerA(5);
              this.etincelle.jouer();
              this.gagne(true);
              this.etape = 2;
              // pas de play() ni de return : coquille d'époque — la charge
              // ci-dessous tourne encore cette image-là.
            }
            this.explosion(mc.x, this.etincelle.y, mc.vitx);
            mc.tuer();
            this.water.splice(i, 1);
            i--;
          }
        }

        // LA CHARGE, tant qu'on appuie ; le lancer au relâchement.
        if (this.socle.flPresse) {
          if (this.power === null) {
            this.power = 0;
          } else {
            this.power = Math.min(this.power + 0.5 * Temps.tmod, 10);
            this.monstre.allerA(Math.round(this.power + 20));
          }
        } else if (this.power !== null) {
          this.launch();
        }
        break;
      default: break;
    }
  }

  launch() {
    if (this.power > 2.5) {
      const mc = this.nouveauPhys('sym62');
      mc.x = this.monstre.x - 39;
      mc.y = this.monstre.y - 63;
      mc.vitx = Math.cos(this.angle) * this.power * 0.8;
      mc.vity = Math.sin(this.angle) * this.power * 0.8;
      mc.poids = 0.5;
      mc.init();
      mc.peau.sx = 0.6;
      mc.peau.sy = 0.6;
      mc.peau.jouer();                     // la boule ondule, en boucle
      this.water.push(mc);
    }
    this.monstre.allerA(20);               // gotoAndStop("20")
    this.power = null;
  }

  explosion(x, y, vx) {
    for (let n = 0; n < 10; n++) {
      const g = this.nouvellePart('sym422');
      g.x = x;
      g.y = y;
      g.vitx = 5 * (this.aleatoire() * 2 - 1) + vx;
      g.vity = -(3 + this.aleatoire() * 8);
      g.echelle = 40 + this.socle.hasard(60);
      g.poids = 0.5;
      g.minuteur = 10 + this.socle.hasard(10);
      g.fonduType = 1;
      g.peau.alpha = 0.6;
      g.init();
    }
  }
}

// Les trois poses du monstre soufflé — les PlaceObject des images 4, 5 et 6
// de la scène (rotation en degrés, échelle du quantifié Flash, ~1).
const BOMB_SOUFFLE = {
  4: { x: 60.5, y: 96.3, rot: 25.34, s: 0.9984 },
  5: { x: 12.6, y: 28.15, rot: 25.31, s: 0.9971 },
  6: { x: -35.5, y: -40.15, rot: 25.34, s: 0.9984 },
};

/*
 * Le catalogue : la clef du dessin de fond, le nom, la classe.
 *
 * L'ordre est celui du portage, épreuve après épreuve — à fréquences de
 * tirage égales (Base.genGameList() donnait freq: 10 à toutes), l'ordre du
 * tableau est sans effet sur le hasard. Les noms, eux, n'ont jamais été
 * écrits — le tableau Lang.GAME_NAME des sources ne contient que « Nom du
 * jeu », quatre-vingt-dix fois. Ceux-là sont donc de nous.
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
  { cle: 'gameGather', nom: 'bourrasque', Classe: Gather },
  { cle: 'gameTubulo', nom: 'pistons', Classe: Tubulo },
  { cle: 'gameTrampoline', nom: 'trampoline', Classe: Trampoline },
  { cle: 'gameOrbital', nom: 'orbite', Classe: Orbital },
  { cle: 'gameJumpFish', nom: 'photo', Classe: JumpFish },
  { cle: 'gamePatate', nom: 'légume', Classe: Patate },
  { cle: 'gameApple', nom: 'pomme', Classe: Apple },
  { cle: 'gameBomb', nom: 'bombe', Classe: Bomb },
  { cle: 'gameFrog', nom: 'grenouille', Classe: Frog },
];

const API = { JEUX, Basket, Lander, Pong, Flower, Astero, Parachute, Gobelet, Marmite,
  Gather, Tubulo, Trampoline, Orbital, JumpFish, Patate, Apple, Bomb, Frog };

if (typeof module !== 'undefined' && module.exports) module.exports = API;
else racine.MinifeverJeux = API;

})(typeof window !== 'undefined' ? window : globalThis);
