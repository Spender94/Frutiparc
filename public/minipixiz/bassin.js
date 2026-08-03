/*
 * Minipixiz (miniTroll) — le bassin aux fées.
 *
 * Traduction de base/Fountain.mt, sp/part/Bubble.mt et sp/el/FireBall.mt.
 *
 * C'est le mode par lequel tout commence : la forêt se court avec une fée, et
 * la seule façon d'en avoir une est de venir la chercher ici. Une nuit sur
 * deux, une lueur apparaît au fond du bassin (Cm.upkeep) ; le lendemain on
 * descend, et on trouve une fée enfermée dans une bulle qui dérive.
 *
 * ── Le jeu, en une phrase ──
 *
 * On ne gagne pas en vidant la grille — on gagne en CREVANT la bulle. Une fois
 * sur onze, la pièce qui tombe n'est pas une forme mais une croix de trois sur
 * trois : une boule de feu au centre, huit billes blindées autour. Faire sauter
 * un groupe à côté de la boule la souffle, elle part en projectile et poursuit
 * la bulle. Il en faut `5 + qualité×3`.
 *
 * ── Ce qui change, par rapport à la forêt ──
 *
 *   l'aire         240 sur 240 au lieu de 132 : pas d'interface à droite
 *   la réserve     UNE pièce à venir, pas dix
 *   les couleurs   elles s'AJOUTENT avec le temps (n⁴ × 16 images) au lieu
 *                  d'être fixées par le niveau, et aucune ne sort jamais
 *   la grille      vide au départ ; c'est le joueur qui la remplit
 *   la vitesse     0,03 — la plus lente du jeu
 *
 * ── Le hasard ──
 *
 * Comme partout dans ce portage, tout passe par le tirage semé de la partie :
 * une même graine rejoue le même bassin.
 */
'use strict';

(function (racine) {

const sousNode = (typeof module !== 'undefined' && module.exports);
const E = sousNode ? require('./engine.js') : racine.MinipixizEngine;
const C = sousNode ? require('./combat.js') : racine.MinipixizCombat;
const F = sousNode ? require('./faerie.js') : racine.MinipixizFee;

const COTE = 240;                     // base/Fountain.initGame : game.width/height
const VITESSE = 0.03;                 // setPieceSpeed(0.03 + level*0.001), level = 0
const RESERVE = 1;                    // game.nextLimit
const CADENCE_BOULE = 10;             // fireBallTimer : une croix toutes les onze pièces
const VIE_BULLE = 5;                  // Bubble : 5 + $q×3 coups à encaisser
const DEGATS_BOULE = 80;              // onFireBall : la boule frappe fort, mais la
                                      // bulle ne compte que les coups, pas les dégâts

const nombre = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const borner = (a, v, b) => Math.min(Math.max(a, v), b);

/**
 * sp/part/Bubble.mt — la bulle qui retient la fée.
 *
 * Elle se choisit un point au hasard, y va mollement, et rebondit sur les
 * bords. Chaque coup encaissé la fait tressauter (`vd = 40`, ce qui accélère sa
 * pulsation) et lui coûte UN point de vie, quels que soient les dégâts : la
 * boule de feu ne fait pas plus mal qu'autre chose, il faut juste la toucher
 * assez de fois.
 */
class Bulle extends C.Particule {
  constructor(champ, fs, q) {
    super(champ, 'mcFaerieBubble');
    this.fs = fs;
    this.decal = 0;
    this.ray = 10;
    this.vie = VIE_BULLE + nombre(q) * 3;
    this.vieMax = this.vie;
    this.vd = 10;
    this.trg = null;
    this.x = this.jeu.largeur * 0.5;
    this.y = this.jeu.hauteur * 0.5;
  }

  update(tmod) {
    // La pulsation revient toujours vers dix : un coup l'affole, puis elle se
    // calme. C'est le seul signe visible qu'on l'a touchée.
    this.vd += (10 - this.vd) * 0.1 * tmod;
    this.decal = (this.decal + this.vd * tmod) % 628;
    this.sx = 100 + Math.cos(this.decal / 100) * 10;
    this.sy = 100 + Math.sin(this.decal / 100) * 10;

    if (!this.trg) this.choisirCap();
    this.versVitesse(this.trg, 0.02, 0.05, tmod);
    if (this.distance(this.trg) < 5) this.trg = null;

    this.verifierBords();
    super.update(tmod);
  }

  choisirCap() {
    const m = 20;
    this.trg = {
      x: m + this.alea() * (this.jeu.largeur - 2 * m),
      y: m + this.alea() * (this.jeu.hauteur - 2 * m),
    };
  }

  verifierBords() {
    if (this.x < this.ray || this.x > this.jeu.largeur - this.ray) {
      this.x = borner(this.ray, this.x, this.jeu.largeur - this.ray);
      this.vd *= 1.5;
      this.vitx *= -1;
    }
    if (this.y < this.ray || this.y > this.jeu.hauteur - this.ray) {
      this.y = borner(this.ray, this.y, this.jeu.hauteur - this.ray);
      this.vd *= 1.5;
      this.vity *= -1;
    }
  }

  blesser() {
    this.vd = 40;
    this.vie--;
    this.champ.evenement('bulleTouchee', { vie: this.vie, max: this.vieMax });
    if (this.vie <= 0 && this.bassin) this.bassin.libererLaFee();
  }
}

/**
 * base/Fountain.mt — le mode.
 *
 * On l'installe autour d'une partie et il s'occupe du reste : la bulle, les
 * croix de boule de feu, les couleurs qui s'ajoutent, et la fée qui s'envole.
 */
class Bassin {
  /**
   * @param {object} o
   *   carte    la fiche du joueur — c'est elle qui porte $pond
   *   graine   entier, pour rejouer le même bassin
   *   surEvenement (nom, données)
   */
  constructor(o) {
    const opts = o || {};
    this.carte = opts.carte;
    this.surEvenement = opts.surEvenement || null;
    this.fini = false;
    this.gagne = false;
    this.bouleTimer = 0;              // fireBallTimer : la première pièce est une croix

    this.jeu = new E.Jeu({
      graine: opts.graine === undefined ? 1 : opts.graine,
      niveau: 0,
      largeur: COTE,
      hauteur: COTE,
      reserve: RESERVE,
      // base/Fountain n'a pas de getLevel : la grille est VIDE, c'est le joueur
      // qui la remplit. Toute la tension du mode vient de là.
      grille: null,
      vitesse: VITESSE,
      couleursSeVident: false,
      fabriquePiece: (jeu) => this.fabriquePiece(jeu),
      onEvent: (n, d) => this.annonce(n, d),
    });
    this.champ = new C.Champ(this.jeu, { surEvenement: (n, d) => this.annonce(n, d) });
    this.jeu.entree = this.jeu.entree;

    this.bulle = null;
    this.fee = null;                  // la fée libérée, quand elle s'envole
    this.poserLaBulle();
  }

  evenement(nom, d) { if (this.surEvenement) this.surEvenement(nom, d); }

  // Le puzzle et le champ parlent tous les deux ici ; on écoute ce qui nous
  // regarde et on relaie le reste.
  annonce(nom, d) {
    if (nom === 'bouleDeFeu') this.lancerLaBoule(d);
    if (nom === 'destruction') this.bullesDeDestruction();
    if (nom === 'finPartie') { this.fini = true; this.gagne = !!d.gagne; }
    this.evenement(nom, d);
  }

  // base/Fountain.initBubbleFaerie : pas de lueur, pas de bulle — on peut
  // toujours descendre au bassin, mais il n'y a rien à y prendre.
  poserLaBulle() {
    const fs = this.carte && this.carte.$pond && this.carte.$pond.$fs;
    if (!fs) return null;
    this.bulle = new Bulle(this.champ, fs, this.carte.$pond.$q);
    this.bulle.bassin = this;
    this.bulle.ajouterA(this.champ.partList);
    this.bulle.init();
    return this.bulle;
  }

  /**
   * base/Fountain.newPieceList — une fois sur onze, la croix.
   *
   * Le compteur part de zéro, donc la TOUTE PREMIÈRE pièce est une croix : le
   * joueur a de quoi tirer dès la première seconde. Les huit billes autour sont
   * blindées, ce qui l'oblige à les casser en deux temps.
   */
  fabriquePiece(jeu) {
    if (this.bouleTimer > 0) { this.bouleTimer--; return null; }
    this.bouleTimer = CADENCE_BOULE;
    const list = [];
    for (let x = 0; x < 3; x++) {
      for (let y = 0; y < 3; y++) {
        const centre = (x === 1 && y === 1);
        list.push({
          x: x - 1,
          y: y - 1,
          e: centre
            ? new E.Boule(jeu, {})
            : new E.Jeton(jeu, { type: jeu.getColor(), special: E.SPECIAL.ARMURE }),
        });
      }
    }
    return list;
  }

  /**
   * base/Fountain.onFireBall — la boule soufflée devient un projectile qui
   * POURSUIT la bulle. Sa limite de bord est négative : elle a le droit de
   * sortir largement de l'écran avant de mourir, sans quoi une bulle collée au
   * bord serait intouchable.
   */
  lancerLaBoule(d) {
    const jeu = this.jeu;
    const s = new C.Tir(this.champ, 'shotFireball');
    s.x = jeu.posX(d.x) + jeu.ts * 0.5;
    s.y = jeu.posY(d.y) + jeu.ts * 0.5;
    s.ray = 6;
    s.n0 = 10 + this.champ.jeu.rng() * 10;
    s.orienteToujours = true;
    s.types.push(C.T.CREPITE, C.T.REBONDIT);
    s.ajouterA(this.champ.shotList);
    if (this.bulle && this.bulle.vivant) {
      s.ajouterCible(this.bulle);
      s.degats = DEGATS_BOULE;
      s.vLim = -150;
      s.initPoursuite(4, 0.2, 0.25, 0);
      // L'original vise DEPUIS la bulle : la boule part donc à l'opposé et
      // revient sur elle en courbe. C'est ce qui lui donne son vol de comète.
      s.angle_ = this.bulle.angle(s);
      s.majVitesse();
    } else {
      s.initDirect(4);
    }
    s.init();
    this.evenement('bouleLancee', { x: s.x, y: s.y });
    return s;
  }

  // base/Fountain.onDestroyElement : chaque bille effacée relâche une bulle qui
  // remonte. C'est de la décoration, mais c'est elle qui fait qu'on est SOUS
  // l'eau et pas devant un plateau.
  bullesDeDestruction() {
    for (const e of this.jeu.dList) {
      const b = this.nouvelleBulle(
        this.jeu.posX(e.px) + this.jeu.ts * 0.5,
        this.jeu.posY(e.py) + this.jeu.ts * 0.5, 5);
      b.sommeil = 5 + this.jeu.rng() * 4;
      b.init();
    }
  }

  nouvelleBulle(x, y, r) {
    const b = this.champ.nouvellePart('partBubble');
    b.x = x;
    b.y = y;
    if (r) {
      const a = this.jeu.rng() * 6.28;
      const d = this.jeu.rng() * r;
      b.x += Math.cos(a) * d;
      b.y += Math.sin(a) * d;
    }
    b.friction = 1.06;
    b.vity = -(0.5 + this.jeu.rng() * 2);
    b.timer = 14 + this.jeu.rng() * 10;
    b.echelle = 50 + this.jeu.rng() * 50;
    return b;
  }

  // Fountain.getColorLimit : la quatrième couleur arrive au bout de 3⁴×16 =
  // 1 296 images (trois quarts de minute), la cinquième au bout de 4 096. La
  // partie devient donc de plus en plus dure toute seule, sans qu'on ait rien
  // à faire — c'est la pression du mode.
  limiteCouleur(n) { return Math.pow(n, 4) * 16; }

  update(tmod) {
    if (this.fini) return;
    const jeu = this.jeu;

    if (jeu.mainTimer > this.limiteCouleur(jeu.colorList.length)
      && jeu.colorList.length < E.COULEURS.length) {
      jeu.colorList.push(jeu.colorList.length);
      jeu.viderReserve();
      this.evenement('nouvelleCouleur', { couleurs: jeu.colorList.length });
    }

    // La fée libérée monte et s'en va : c'est la fin de la partie.
    if (this.fee && this.fee.y < -20) {
      this.fee.tuer();
      this.fee = null;
      this.fini = true;
      this.gagne = true;
      this.evenement('feeEnvolee', {});
    }

    // Des bulles montent de ce qui tombe et de la pièce en cours. Elles vont
    // bien plus vite quand le joueur pousse : la pièce « fend » l'eau.
    switch (jeu.step) {
      case E.ETAPE.CHUTE:
        for (const e of jeu.fList) {
          if (jeu.hasard(3) !== 0) continue;
          const r = jeu.ts * 0.5;
          const b = this.nouvelleBulle(jeu.posX(e.px) + r, jeu.posY(e.py) + r, r);
          b.echelle = 25 + jeu.rng() * 50;
          b.init();
        }
        break;
      case E.ETAPE.JEU: {
        const p = jeu.piece;
        if (p) {
          const rnd = (p.speeder > 0 || p.da > 8) ? 3 : 80;
          for (const o of p.list) {
            if (jeu.hasard(rnd) !== 0) continue;
            const r = jeu.ts * 0.5;
            const b = this.nouvelleBulle(
              jeu.posX(o.x + p.x + p.cx + 0.5), jeu.posY(o.y + p.y + p.cy + 0.5), r);
            b.echelle = 25 + jeu.rng() * 50;
            b.init();
          }
        }
        break;
      }
      default: break;
    }

    jeu.update(tmod);
  }

  /**
   * base/Fountain.freeFaerie — la bulle cède.
   *
   * La fée entre dans la fiche du joueur et devient AUSSITÔT celle qu'il
   * emmène ($current). Puis elle s'envole par le haut, et le jeu revient au
   * menu. C'est le seul endroit du jeu où une fée s'ajoute.
   */
  libererLaFee() {
    if (!this.bulle) return null;
    const fs = this.carte.$pond.$fs;
    this.carte.$pond.$fs = null;
    this.carte.$pond.$q = 0;
    this.carte.$current = this.carte.$faerie.length;
    this.carte.$faerie.push(fs);

    const fi = new F.Fee(fs, this.jeu.rng, this.carte);
    this.fee = this.champ.naitreFee(fi);
    this.fee.x = this.bulle.x;
    this.fee.y = this.bulle.y;
    this.fee.vitx = this.bulle.vitx * 0.8;
    this.fee.vity = this.bulle.vity * 0.8;
    this.fee.trg = { x: this.fee.x, y: -20 };
    this.fee.flForceWay = true;

    for (let i = 0; i < 10; i++) this.nouvelleBulle(this.bulle.x, this.bulle.y, 16).init();
    this.bulle.tuer();
    this.bulle = null;
    // Le puzzle s'arrête net : plus de pièce, la fée a la scène pour elle.
    this.jeu.step = E.ETAPE.FIGE;
    this.jeu.piece = null;
    this.evenement('feeLiberee', { fs, fi });
    return fi;
  }

  // Ce qu'il faut au client pour l'entête : combien de coups la bulle tient
  // encore, et depuis combien de temps on joue.
  etat() {
    return {
      bulle: this.bulle ? { vie: this.bulle.vie, max: this.bulle.vieMax } : null,
      couleurs: this.jeu.colorList.length,
      pieces: this.jeu.pieces,
      fini: this.fini,
      gagne: this.gagne,
    };
  }
}

const API = {
  Bassin, Bulle, COTE, VITESSE, RESERVE, CADENCE_BOULE, VIE_BULLE, DEGATS_BOULE,
};

if (typeof module !== 'undefined' && module.exports) module.exports = API;
else racine.MinipixizBassin = API;

})(typeof window !== 'undefined' ? window : globalThis);
