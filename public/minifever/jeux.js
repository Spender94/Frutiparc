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
];

const API = { JEUX, Basket, Lander, Pong, Flower };

if (typeof module !== 'undefined' && module.exports) module.exports = API;
else racine.MinifeverJeux = API;

})(typeof window !== 'undefined' ? window : globalThis);
