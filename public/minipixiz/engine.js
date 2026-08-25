/*
 * Minipixiz (miniTroll) — le moteur du puzzle.
 *
 * Traduction des sources d'origine (Games/miniTroll/src, écrites en « .mt », le
 * langage typé de Motion-Twin) : Game.mt, Piece.mt, Group.mt, sp/Element.mt et
 * sp/el/*.mt. Aucun rendu ici — le moteur joue la partie et ANNONCE ce qui
 * arrive ; c'est ce qui permet de le faire tourner sous Node et de vérifier les
 * règles plutôt que des pixels.
 *
 * ── Le jeu, en une phrase ──
 *
 * Des pièces de une à six cases tombent dans une grille. Quatre jetons de même
 * couleur qui se touchent (orthogonalement) disparaissent, ce qui fait tomber ce
 * qui était au-dessus, ce qui peut former de nouveaux groupes : c'est la
 * cascade, et c'est elle qui rapporte. Quand une couleur n'est plus présente
 * nulle part, elle sort du tirage ; quand il n'en reste plus, le niveau est
 * terminé. Si un élément atteint la troisième ligne, la partie s'arrête.
 *
 * ── Ce qui n'est pas un jeton ──
 *
 * La grille porte aussi des pierres (qui s'effritent quand une explosion les
 * touche), des cellules d'impy, des bombes, des objets à ramasser et des yeux.
 * Ils ne se groupent pas : ils encombrent, et réagissent au SOUFFLE des
 * destructions voisines.
 *
 * ── Les quatre états d'un jeton (Token.setSpecial) ──
 *
 *   0  ordinaire
 *   1  perle noire — se groupe, mais ne COMPTE PAS dans les quatre requis
 *   2  armure — ne se groupe pas ; le premier souffle la brise en jeton normal
 *   3  étoile — détruit d'un coup toute sa couleur sur la grille
 */
'use strict';

(function (racine) {

// ── Les constantes du jeu (Game.initDefault, base/Forest.initGame) ─────────
const TS = 16;                    // Game.ts — le côté d'une case
const MARGE_HAUT = -TS * 2;       // Game.marginUp — deux lignes cachées au-dessus
const MARGE_GAUCHE = 4;           // Game.marginLeft
const LARGEUR = 132;              // base/Forest : la largeur de l'aire
const HAUTEUR = 240;              // et sa hauteur
const GROUPE_MIN = 4;             // Game.groupMax — le nombre qui fait disparaître
const COULEURS_DEPART = 3;        // Game.colMax
const FORMES_DEPART = 3;          // Game.shapeNum
const RESERVE = 10;               // Game.nextLimit — la file des pièces à venir
const ETOILE_SEUIL = 80;          // Base.newPieceListElement : starWait > 80
const LIGNE_MORT = 2;             // Game.checkFull : grid[x][2] occupé = perdu

// Piece.new
const PIECE_GLISSE = 0.35;        // sSpeed
const PIECE_POSE = 4;             // groundTimerMax — le sursis avant de se fixer
const PIECE_BOOST = 1;            // speeder, quand le joueur presse « bas »

// Les huit couleurs (Cs.colorList). Les trois premières suffisent au début ;
// le mode en ajoute au fil des niveaux.
const COULEURS = [0xFF3300, 0xFFCC00, 0x33DD00, 0x00DDFF, 0x0088FF, 0x9900DD, 0xFF44DD, 0xFF8800];

// Les types d'élément (Cs.E_*).
const E = { JETON: 0, OBJET: 1, PIERRE: 2, CELLULE: 3, BOMBE: 4, BOULE: 5, OEIL: 6 };

// Les états d'un jeton.
const SPECIAL = { AUCUN: 0, PERLE: 1, ARMURE: 2, ETOILE: 3 };

// Les étapes de la partie (Game.initStep).
const ETAPE = { ATTENTE: 0, CHUTE: 1, JEU: 2, DESTRUCTION: 3, MAGIE: 4, ACTIF: 5, FIGE: 10 };

// Combien d'images un sort a le droit de garder la main (voir surveillerSort).
const TENUE_MAX = 1800;

// Game.shapeList : les formes, par nombre de cases. Au-delà de quatre, elles
// sont tirées au sort (getBigShape).
const FORMES = [
  [],
  [[{ x: 0, y: 0 }]],
  [[{ x: 0, y: 0 }, { x: 1, y: 0 }]],
  [
    [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
    [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: -1, y: 0 }],
  ],
  [
    [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
    [{ x: 0, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
  ],
];

// Générateur reproductible (mulberry32) : même graine, même partie. Le jeu
// d'origine s'en remet à Std.random ; ici on veut pouvoir rejouer une partie à
// l'identique dans un test.
function generateur(graine) {
  let a = graine >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Les éléments de la grille ─────────────────────────────────────────────

class Element {
  constructor(jeu, o) {
    this.jeu = jeu;
    this.et = E.JETON;
    this.px = 0;
    this.py = 0;
    this.flFalling = false;
    this.flDestroy = false;
    this.vivant = true;
    // Ce qu'un sort peut poser par-dessus, et que le client dessine : un
    // décalage en pixels (une bille qu'on échange, qu'on soulève, qu'on
    // tranche), une transparence, un éclat blanc, un fondu vers une couleur.
    this.decalX = 0;
    this.decalY = 0;
    this.alpha = 100;
    this.eclat = 0;
    this.melange = null;
    Object.assign(this, o || {});
  }

  // Element.init : il entre dans la liste et dans la grille.
  poser() {
    this.jeu.eList.push(this);
    this.jeu.insererDansGrille(this);
  }

  /**
   * Element.quake — LE TREMBLEMENT DE CE QUI RÉSISTE.
   *
   *     quakeList.push({ sp:this, pos:{x,y}, ray:3, timer:10, fadeLimit:10 })
   *
   * Dix images, trois pixels de rayon, en s'estompant. Deux endroits l'appellent,
   * et les deux disent la même chose au joueur : « tu l'as touché, mais il tient
   * encore ». Le coffre d'un démon qu'un combo n'ouvre pas (une fois sur deux),
   * et la pierre qu'un souffle entame sans casser.
   *
   * Le portage ne l'avait pas du tout : le coffre qui résistait ne bronchait
   * pas, et un joueur ne pouvait pas distinguer « raté » de « rien ne s'est
   * passé ».
   */
  trembler() {
    if (!this.jeu) return;
    this.jeu.secousses.push({ e: this, ray: 3, timer: 10, fadeLimit: 10 });
  }

  // Element.haveGround : le sol, ou un élément qui ne tombe pas lui-même.
  aUnSol() {
    if (this.py + 1 >= this.jeu.yMax) return true;
    const e = this.jeu.grille[this.px][this.py + 1];
    return !!e && !e.flFalling;
  }

  // Le souffle d'une destruction voisine. Chaque espèce y réagit à sa façon.
  souffler() {}

  // Element.isolate — un sort SORT l'élément du jeu normal avant d'en faire ce
  // qu'il veut : le soulever, le trancher, le changer en pierre. Sans ça il
  // resterait relié à son groupe, et le groupe compterait un absent.
  isoler() {}

  // Element.initActiveStep / activeUpdate — le tour de l'élément, une fois la
  // cascade close (étape ACTIF). Seuls l'objet et l'œil s'en servent.
  initActiveStep() {}
  majActive() {}

  // Element.explode — purement visuel (fxCrystal) : l'élément vole en éclats.
  // Le retirer de la grille reste au sort qui l'a appelé, comme dans l'original.
  exploser() {
    this.jeu.evenement('eclats', { x: this.px, y: this.py, et: this.et, type: this.type });
  }

  tuer() {
    if (!this.vivant) return;
    this.vivant = false;
    const i = this.jeu.eList.indexOf(this);
    if (i >= 0) this.jeu.eList.splice(i, 1);
    this.jeu.retirerDeLaGrille(this);
  }
}

// sp/el/Token.mt — le jeton de couleur, la pièce maîtresse du jeu.
class Jeton extends Element {
  constructor(jeu, o) {
    super(jeu, o);
    this.et = E.JETON;
    if (this.type === undefined) this.type = 0;
    if (this.special === undefined) this.special = SPECIAL.AUCUN;
    this.groupe = null;
    this.flGroupable = (this.special !== SPECIAL.ARMURE);
  }

  setSpecial(n) {
    this.special = n;
    // Seule l'armure interdit le groupement ; la perle et l'étoile s'y prêtent.
    this.flGroupable = (n !== SPECIAL.ARMURE);
  }

  // Token.blast : l'armure encaisse le premier souffle et redevient un jeton.
  souffler() {
    if (this.special === SPECIAL.ARMURE) {
      this.setSpecial(SPECIAL.AUCUN);
      this.jeu.evenement('armureBrisee', { x: this.px, y: this.py });
    }
  }

  setType(t) { this.type = t; }

  isoler() { if (this.groupe) this.groupe.retirer(this); }

  tuer() {
    if (this.groupe) this.groupe.retirer(this);
    super.tuer();
  }
}

// sp/el/Stone.mt — la pierre s'effrite d'un point à chaque souffle.
class Pierre extends Element {
  constructor(jeu, o) {
    super(jeu, o);
    this.et = E.PIERRE;
    if (this.life === undefined) this.life = 3;
  }
  souffler() {
    this.life--;
    if (this.life <= 0) {
      this.jeu.evenement('pierreCassee', { x: this.px, y: this.py });
      this.tuer();
    } else {
      // Stone.setLife : des éclats, ET la secousse.
      this.trembler();
      this.jeu.evenement('pierreEntamee', { x: this.px, y: this.py, life: this.life });
    }
  }
}

// sp/el/ImpCell.mt — une chance sur deux qu'un souffle en libère un impy.
class Cellule extends Element {
  constructor(jeu, o) {
    super(jeu, o);
    this.et = E.CELLULE;
    if (this.level === undefined) this.level = 0;
  }
  souffler() {
    if (this.jeu.hasard(2) === 0) {
      // C'est le seul endroit où le puzzle PEUPLE le ciel : la cellule cède, et
      // l'impy qu'elle tenait s'échappe au milieu de la case.
      if (this.jeu.champ) {
        this.jeu.champ.naitreImpy(this.level,
          this.jeu.posX(this.px + 0.5), this.jeu.posY(this.py + 0.5));
      }
      this.jeu.evenement('impyLibere', { x: this.px, y: this.py, level: this.level });
      this.tuer();
    } else {
      // ImpCell.blast, branche `else` : le coffre TREMBLE et reste fermé.
      this.trembler();
      this.jeu.evenement('celluleSecouee', { x: this.px, y: this.py });
    }
  }
}

// sp/el/Bomb.mt — elle explose au souffle et blesse ce qui l'entoure.
class Bombe extends Element {
  constructor(jeu, o) {
    super(jeu, o);
    this.et = E.BOMBE;
  }
  // Bomb.blast : quiconque vit à moins de RAY pixels — fée comme démons —
  // encaisse jusqu'à 200 points, dégressifs avec la distance, et l'onde le
  // repousse. La liste se lit par index pendant qu'un mort s'en retire : le
  // voisin de rang d'un démon tué net échappe au souffle, ici comme là-bas.
  souffler() {
    const list = this.jeu.pList;
    if (list) {
      const x = this.jeu.posX(this.px);
      const y = this.jeu.posY(this.py);
      for (let i = 0; i < list.length; i++) {
        const f = list[i];
        const dx = f.x - x;
        const dy = f.y - y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist >= Bombe.RAYON) continue;
        const a = Math.atan2(dy, dx);
        const c = 1 - dist / Bombe.RAYON;
        f.blesser(c * 200);
        f.vitx += Math.cos(a) * c * 20;
        f.vity += Math.sin(a) * c * 20;
      }
    }
    this.jeu.evenement('bombe', { x: this.px, y: this.py });
    this.tuer();
  }
}
Bombe.RAYON = 64;                  // Bomb.RAY — quatre cases tout rond

// sp/el/Item.mt — l'objet à ramasser. Il ne se ramasse que dégagé par le haut
// (Item.initActiveStep : la case au-dessus doit être libre).
class Objet extends Element {
  constructor(jeu, o) {
    super(jeu, o);
    this.et = E.OBJET;
    if (this.type === undefined) this.type = 0;
  }
  degage() { return this.jeu.estLibre(this.px, this.py - 1); }

  // Item.initActiveStep : dégagé, il DÉCOLLE — et le tour entier l'attend.
  initActiveStep() {
    if (!this.degage()) return;
    this.montee = 0;                 // Item.vity — la vitesse de l'envol
    this.jeu.activeList.push(this);
    this.jeu.actifRelance = true;    // sa case rendue peut faire tomber le reste
    this.jeu.evenement('objetEnvol', { type: this.type, x: this.px, y: this.py });
  }

  // Item.activeUpdate : il monte en accélérant (vity -= 0.1), et la PRISE n'a
  // lieu qu'en sortant de l'aire — Cs.base.grab quand y passe sous -20. C'est
  // l'envol qui dit au joueur « c'est à toi » ; la traîne d'étoiles est semée
  // par le client, qui lit decalY.
  majActive(tmod) {
    this.montee -= 0.1 * tmod;
    this.decalY = (this.decalY || 0) + this.montee * tmod;
    if (this.jeu.posY(this.py) + this.decalY < -20) {
      // L'élément quitte la liste et la grille AVANT que la prise ne
      // s'annonce : un gestionnaire qui lève ne doit pas pouvoir laisser
      // l'envol se reprendre à chaque image.
      this.jeu.retirerActif(this);
      this.tuer();
      this.jeu.objets.push(this.type);
      this.jeu.evenement('objet', { type: this.type, x: this.px, y: this.py });
    }
  }
}

// sp/el/FireBall.mt — la boule de feu du bassin. Elle ne se groupe pas et ne
// rapporte rien : elle ATTEND qu'une destruction voisine la souffle, et part
// alors en projectile vers la bulle qui retient la fée. C'est la seule arme du
// mode, et c'est pour ça que le bassin se joue autrement que la forêt.
class Boule extends Element {
  constructor(jeu, o) {
    super(jeu, o);
    this.et = E.BOULE;
    // L'instant de l'attache. Le clip `fireball` compte dix-sept images —
    // la flamme qui enfle et retombe — et il BOUCLE. Deux boules posées à
    // deux moments ne pulsent donc pas ensemble, et c'est ce décalage qu'on
    // retient ici.
    this.ne = (jeu && jeu.horloge) || 0;
  }
  souffler() {
    this.jeu.evenement('bouleDeFeu', { x: this.px, y: this.py, e: this });
    this.tuer();
  }
}

// sp/el/Eye.mt — l'œil porte une couleur et la retient dans le tirage tant
// qu'il est là (Game.updatecolorList le compte comme un jeton). À chaque tour
// il se charge d'un cran (sa pupille grossit), et chargé il POND une perle de
// sa couleur en haut du plateau — c'est lui qui rallonge le niveau, et il faut
// le détruire pour que sa couleur puisse enfin s'épuiser.
class Oeil extends Element {
  constructor(jeu, o) {
    super(jeu, o);
    this.et = E.OEIL;
    if (this.color === undefined) this.color = 0;
    this.lumiere = 0;               // Eye.light — la charge, dite par la pupille
  }

  // Eye.blast : un seul souffle l'emporte — explode() puis kill().
  souffler() {
    this.jeu.evenement('oeilDetruit', { x: this.px, y: this.py, couleur: this.color });
    this.exploser();
    this.tuer();
  }

  // Eye.initActiveStep — chargé (light > 1), il cherche une case libre en haut
  // du plateau : vingt tirages sur la première ligne, puis on descend d'une
  // ligne tous les vingt échecs, et au centième on renonce (la charge reste).
  pondre() {
    if (this.lumiere <= 1) { this.lumiere++; return false; }
    let tx = this.jeu.hasard(this.jeu.xMax);
    let ty = 0;
    let tr = 0;
    while (!this.jeu.estLibre(tx, ty)) {
      tr++;
      tx = this.jeu.hasard(this.jeu.xMax);
      if (tr > 20) ty++;
      if (tr > 100) return false;
    }
    // genElement(0, tx, ty, 1) : la ponte est une PERLE, à la couleur de l'œil.
    const t = this.jeu.genElement(E.JETON, tx, ty, SPECIAL.PERLE);
    t.setType(this.color);
    this.lumiere = 0;
    // Eye.initActiveStep, la fin : la perle posée, l'œil TIRE — un rayon qui
    // s'affine, et une boule de sa couleur qui file (BALL_SPEED). Le tour
    // entier le regarde faire : l'œil rejoint la liste active, coin à coin
    // comme l'original mesure (getAng sur les x,y de getX/getY).
    this.rayon = {
      t: 0,
      ang: Math.atan2(this.jeu.posY(ty) - this.jeu.posY(this.py),
        this.jeu.posX(tx) - this.jeu.posX(this.px)),
    };
    this.jeu.activeList.push(this);
    this.jeu.evenement('oeilPond',
      { deX: this.px, deY: this.py, x: tx, y: ty, couleur: this.color });
    return true;
  }

  // Eye.activeUpdate : fini quand la boule est sortie par le haut
  // (ball.y < -60). L'original ne borne que là ; on borne aussi les trois
  // autres côtés — une perle pondue SOUS l'œil enverrait sinon la boule vers
  // le bas pour toujours, et la partie avec elle.
  majActive(tmod) {
    if (!this.rayon) { this.jeu.retirerActif(this); return; }
    this.rayon.t += tmod;
    const bx = this.jeu.posX(this.px) + TS / 2 + Math.cos(this.rayon.ang) * Oeil.VITESSE_BOULE * this.rayon.t;
    const by = this.jeu.posY(this.py) + TS / 2 + Math.sin(this.rayon.ang) * Oeil.VITESSE_BOULE * this.rayon.t;
    if (by < -60 || by > this.jeu.posY(this.jeu.yMax) + 60
      || bx < -60 || bx > this.jeu.posX(this.jeu.xMax) + 60) {
      this.rayon = null;
      this.jeu.retirerActif(this);
    }
  }
}
Oeil.VITESSE_BOULE = 40;             // Eye.BALL_SPEED

const CLASSES = {
  [E.JETON]: Jeton, [E.OBJET]: Objet, [E.PIERRE]: Pierre,
  [E.CELLULE]: Cellule, [E.BOMBE]: Bombe, [E.BOULE]: Boule, [E.OEIL]: Oeil,
};

// ── Les groupes (Group.mt) ────────────────────────────────────────────────
// Un groupe est un ensemble de jetons de même couleur qui se touchent. Il se
// reconstruit entièrement à chaque cycle : c'est plus simple que de le tenir à
// jour, et c'est ce que fait le jeu d'origine (clearGroup puis checkGroup).
class Groupe {
  constructor(jeu) {
    this.jeu = jeu;
    this.list = [];
    jeu.gList.push(this);
  }
  ajouter(e) { e.groupe = this; this.list.push(e); }
  retirer(e) {
    e.groupe = null;
    const i = this.list.indexOf(e);
    if (i >= 0) this.list.splice(i, 1);
  }
  // Group.eat : deux groupes qui se rejoignent n'en font plus qu'un.
  avaler(autre) {
    for (const e of autre.list) { e.groupe = this; this.list.push(e); }
    const i = this.jeu.gList.indexOf(autre);
    if (i >= 0) this.jeu.gList.splice(i, 1);
  }
  // Le compte qui décide : les perles ne comptent pas.
  taille() {
    let n = 0;
    for (const e of this.list) if (e.special !== SPECIAL.PERLE) n++;
    return n;
  }
  detruire() { for (const e of this.list) e.groupe = null; }
}

// ── La pièce qui tombe (Piece.mt) ─────────────────────────────────────────
class Piece {
  constructor(jeu, liste) {
    this.jeu = jeu;
    this.list = liste;                 // [{x, y, e}] — décalages et éléments
    this.x = Math.floor(jeu.xMax / 2);
    this.y = 0;
    this.cx = 0;
    this.cy = 0;
    this.ta = 0;                       // l'angle visé, par quarts de tour
    this.flGround = false;
    this.flBind = false;              // spell/imp/Bind : la pièce ne tourne plus
    this.flTurn = true;                // relâchement de la touche de rotation
    this.flSpeedable = false;
    this.slideWay = 0;
    this.groundTimer = 0;
    this.fSpeed = 0.05;
    this.posee = false;

    // Piece.init : une forme de côté impair tourne autour d'un demi-décalage.
    let xMin = 0, xMax = 0, yMin = 0, yMax = 0;
    for (const o of this.list) {
      xMin = Math.min(xMin, o.x); xMax = Math.max(xMax, o.x);
      yMin = Math.min(yMin, o.y); yMax = Math.max(yMax, o.y);
    }
    this.dRot = Math.min(Math.round((xMax - xMin) % 2), Math.round((yMax - yMin) % 2)) * 0.5;

    /*
     * La ROTATION est jouée, pas subie.
     *
     * Dans Piece.init, chaque bille est posée UNE FOIS dans le clip `base`, à
     * `(o.x - dRot) × ts`, et n'en bouge plus. `turn()` ne déplace que les
     * coordonnées LOGIQUES (celles qui servent aux collisions) et pousse
     * l'angle visé `ta` d'un quart de tour ; c'est `base._rotation` qui court
     * après lui, un demi-écart par image :
     *
     *     base._rotation += da × min(0.5 × Timer.tmod, 1)
     *     et chaque bille garde son aplomb : mc._rotation = -base._rotation
     *
     * Les billes décrivent donc un arc jusqu'à leur nouvelle case. Le portage
     * les y téléportait — d'où la pièce qui « claque » au lieu de pivoter.
     */
    this.rot = 0;
    for (const o of this.list) { o.ox = o.x - this.dRot; o.oy = o.y - this.dRot; }
  }

  // Piece.update — l'ordre compte : chute, rotation, glissement.
  update(tmod, entree) {
    if (this.posee) return;
    // Le boost n'est actif qu'une fois la touche relâchée : sans ça, garder le
    // doigt appuyé ferait tomber toutes les pièces d'affilée sans reprise.
    let boost = 0;
    if (entree.bas) { if (this.flSpeedable) boost = PIECE_BOOST; } else { this.flSpeedable = true; }

    if (this.flGround) {
      if (!this.placeLibre(0, 1)) {
        this.groundTimer += tmod;
        if ((this.groundTimer > PIECE_POSE || boost > 0.5) && this.slideWay === 0) {
          this.valider();
          return;
        }
      } else {
        this.flGround = false;
      }
    }

    if (!this.flGround) {
      this.cy += (this.fSpeed + boost) * tmod;
      let n = Math.floor(this.cy);
      this.cy = this.cy % 1;
      while (n > 0) {
        this.y++;
        if (!this.placeLibre(0, 1)) {
          this.flGround = true;
          this.cy = 0;
          this.groundTimer = 0;
          break;
        }
        n--;
      }
    }

    // Piece : la rotation ne se déclenche qu'au passage de la touche, et
    // s'annule si la forme tournée ne rentre pas.
    if (entree.tourner) {
      if (this.flTurn) {
        this.flTurn = false;
        // Les fils paralysants d'un impy (spell/imp/Bind) empêchent la rotation :
        // la pièce se contente de gîter, et il faut la poser telle quelle.
        if (this.flBind) {
          this.jeu.evenement('pieceLiee', {});
        } else {
          this.tourner(1);
          if (!this.placeLibre(0, 0)) this.tourner(-1);
          else this.ta = (this.ta + 90) % 360;
        }
      }
    } else {
      this.flTurn = true;
    }

    // L'angle court après sa cible par le plus court chemin.
    let da = this.ta - this.rot;
    while (da > 180) da -= 360;
    while (da < -180) da += 360;
    if (Math.abs(da) > 0.5) this.rot += da * Math.min(0.5 * tmod, 1);

    this.glisser(tmod, entree);
  }

  tourner(sens) {
    for (const o of this.list) {
      const x = o.x - this.dRot, y = o.y - this.dRot;
      o.x = Math.round(-y * sens + this.dRot);
      o.y = Math.round(x * sens + this.dRot);
    }
  }

  glisser(tmod, entree) {
    if (this.slideWay === 0) this.verifierGlissement(entree);
    if (this.slideWay === 0) return;
    const lim = 0.8;
    this.cx += Math.max(-lim, Math.min(PIECE_GLISSE * this.slideWay * tmod, lim));
    while (Math.abs(this.cx) >= 1) {
      this.x += this.slideWay;
      this.cx -= this.slideWay;
      const sens = this.slideWay;
      this.verifierGlissement(entree);
      if (this.slideWay !== sens) { this.cx = 0; this.slideWay = 0; return; }
    }
  }

  // Piece.checkSlide : on ne glisse plus une fois le sursis de pose écoulé,
  // sinon la pièce se dérobe au moment où elle se fixe.
  verifierGlissement(entree) {
    const sens = entree.gauche ? -1 : (entree.droite ? 1 : 0);
    this.slideWay = (sens !== 0 && this.placeLibre(sens, 0)
      && (!this.flGround || this.groundTimer < PIECE_POSE)) ? sens : 0;
  }

  // Piece.checkCanvas : toutes les cases de la forme tiennent-elles ?
  formeTient(x, y) {
    for (const o of this.list) if (!this.jeu.estLibre(o.x + x, o.y + y)) return false;
    return true;
  }

  // Piece.checkActualCanvas : on teste les quatre cases entières que la pièce
  // chevauche pendant qu'elle glisse — c'est ce qui l'empêche de traverser un
  // mur en biais.
  placeLibre(dx, dy) {
    for (let nx = Math.floor(this.x + this.cx) + dx; nx <= Math.ceil(this.x + this.cx) + dx; nx++) {
      for (let ny = Math.floor(this.y + this.cy) + dy; ny <= Math.ceil(this.y + this.cy) + dy; ny++) {
        if (!this.formeTient(nx, ny)) return false;
      }
    }
    return true;
  }

  valider() {
    this.posee = true;
    for (const o of this.list) {
      o.e.px = this.x + o.x;
      o.e.py = this.y + o.y;
      // La teinte d'un sort vit sur la PIÈCE — dans le jeu d'origine, sur le
      // clip qui la porte, détruit à la pose. Une bille posée redevient une
      // bille : le Conglomérat ne marque pas la grille.
      o.e.melange = null;
      o.e.poser();
    }
    this.jeu.surPiecePosee();
  }

  /*
   * Position d'affichage, en pixels — le client n'a pas à la recalculer.
   *
   * `base._x = marginLeft + (x + cx + 0.5 + dRot) × ts`, et chaque bille est
   * accrochée à `(o.x - dRot) × ts` DANS le clip qui tourne : sa place à
   * l'écran est donc cet ancrage pivoté de l'angle courant, autour du centre
   * de la pièce. Le demi-pas de `base` vise le CENTRE de la case (les billes
   * y sont centrées) ; nos coins se lisent donc sans lui.
   */
  cases() {
    const a = this.rot * Math.PI / 180;
    const cos = Math.cos(a), sin = Math.sin(a);
    return this.list.map((o) => {
      // Rotation horaire : l'axe des ordonnées descend, comme chez Flash.
      const rx = o.ox * cos - o.oy * sin;
      const ry = o.ox * sin + o.oy * cos;
      return {
        e: o.e,
        x: this.jeu.posX(this.x + this.cx + this.dRot + rx),
        y: this.jeu.posY(this.y + this.cy + this.dRot + ry),
      };
    });
  }
}

// ── La partie ─────────────────────────────────────────────────────────────
class Jeu {
  /**
   * @param {object} o
   *   graine     entier — même graine, même partie
   *   niveau     le numéro de niveau (règle la vitesse de chute)
   *   couleurs   nombre de couleurs en jeu (3 au départ, monte avec les niveaux)
   *   grille     tableau [x][y] de {et, n} pour préremplir — sinon vide
   *   onEvent    (nom, données) → le client y accroche dessins et sons
   */
  constructor(o) {
    o = o || {};
    this.rng = generateur(o.graine === undefined ? 1 : o.graine);
    this.onEvent = o.onEvent || null;
    this.niveau = o.niveau || 0;

    this.ts = TS;
    // L'aire de jeu. La forêt est étroite (132 de large : le reste de l'écran
    // porte l'interface) ; le bassin occupe les 240 pixels (base/Fountain.initGame).
    // Game.initDefault pose les marges, et c'est d'elles que la grille se déduit.
    this.margeGauche = (o.margeGauche === undefined) ? MARGE_GAUCHE : o.margeGauche;
    this.margeHaut = (o.margeHaut === undefined) ? MARGE_HAUT : o.margeHaut;
    this.largeur = o.largeur || LARGEUR;
    this.hauteur = o.hauteur || HAUTEUR;
    this.xMax = Math.floor((this.largeur - this.margeGauche) / TS);
    this.yMax = Math.floor((this.hauteur - this.margeHaut) / TS);
    this.groupMax = GROUPE_MIN;
    this.colMax = o.couleurs || COULEURS_DEPART;
    this.shapeNum = FORMES_DEPART;
    this.shapeNumInc = 0;

    this.eList = [];
    this.fList = [];
    this.dList = [];
    this.gList = [];
    this.nextList = [];
    this.piece = null;
    this.nextPiece = null;
    this.starWait = 0;
    this.score = 0;
    // Les objets ramassés pendant la partie : c'est ce que la fiche du joueur
    // retient (Cm.getItem → $stat.$item → picto de l'album).
    this.objets = [];
    this.flActiviteAFaire = false;
    this.activeList = [];            // Game.activeElementList — ceux qui vivent leur tour
    this.actifRelance = false;
    this.pieces = 0;                 // pieceTimer : le nombre de pièces posées
    this.mainTimer = 0;              // Game.mainTimer : les images passées À JOUER
    // Et l'autre horloge, celle de Flash : sous le lecteur, un clip attaché
    // DÉROULE sa timeline au rythme du film, que la partie soit en train de
    // jouer, de faire tomber ou de casser. `mainTimer` ne convient donc pas
    // pour animer un clip — il s'arrête dès que le plateau s'occupe. Celle-ci
    // ne s'arrête jamais.
    this.horloge = 0;
    // Game.quakeList — ce qui tremble sans céder (voir Element.trembler).
    this.secousses = [];
    // Game.nextLimit — la forêt en montre dix, le bassin une seule.
    this.nextLimit = o.reserve || RESERVE;
    // base/*.newPieceList : un mode peut IMPOSER la composition d'une pièce.
    // Le bassin s'en sert pour sa croix de boule de feu, une fois sur onze.
    this.fabriquePiece = o.fabriquePiece || null;
    // base/Forest.onNewTurn appelle updatecolorList : une couleur qui n'est
    // plus sur la grille sort du tirage, et le niveau se gagne quand il n'en
    // reste aucune. Le BASSIN ne le fait pas — on n'y gagne pas en vidant la
    // grille mais en libérant la fée, et il ajoute des couleurs au lieu d'en
    // retirer.
    this.couleursSeVident = (o.couleursSeVident === undefined) ? true : !!o.couleursSeVident;
    // Game.flAutoRaiseSpeed : dans la forêt, chaque pièce accélère un peu la
    // chute. L'arbre creux coupe ça — c'est SON chronomètre qui décide, et par
    // paliers bien plus francs.
    this.monteeAuto = (o.monteeAuto === undefined) ? true : !!o.monteeAuto;
    this.termine = false;
    this.gagne = false;
    this.entree = { gauche: false, droite: false, bas: false, tourner: false };

    // ── Ce qui vole au-dessus (combat.js) ──
    // Le puzzle tourne très bien sans : ces listes restent vides tant qu'aucun
    // champ n'est installé, et rien ici n'en dépend. C'est ce qui permet de
    // vérifier les règles du puzzle seules.
    this.champ = null;
    this.pList = [];
    this.faerieList = [];
    this.impList = [];
    this.shotList = [];
    this.partList = [];
    this.sList = [];        // Game.sList — les sorts dont l'effet DURE
    this.saList = [];       // Game.saList — le sort qui a la main sur la partie
    this.sortTenu = null;   // le sort qui l'a en ce moment, et depuis quand
    this.sortTenue = 0;
    this.flAide = false;    // Game.flHelp — le joueur vient d'appeler sa fée
    this.sortsAFaire = false;

    // base/Forest.initGame : la vitesse de chute monte avec le niveau. Chaque
    // mode a la sienne — Game.setPieceSpeed.
    this.pSpeedStart = (o.vitesse === undefined) ? 0.03 + this.niveau * 0.002 : o.vitesse;
    this.pSpeed = this.pSpeedStart;
    // Aventure.getManaReplenishCoef : ce que chaque bille détruite rend en
    // mana — `flColorKill ? 0 : 3`. TOUTES les bases jouables (Forest, Dungeon,
    // Fountain, Tree, Rainbow) héritent d'Aventure : le taux est le même
    // partout, bassin compris — le « 1 » de Base n'est jamais servi. Et dès
    // qu'une COULEUR a été éliminée du niveau, la recharge se coupe pour tout
    // ce qui reste de la partie : c'est ce qui rend la fin de niveau tendue,
    // on y vit sur ses réserves. Le portage rechargait plein pot jusqu'au bout.
    this.manaCoef = (o.manaCoef === undefined) ? 3 : o.manaCoef;
    this.flColorKill = false;         // Game.flColorKill — posé par majCouleurs

    this.colorList = [];
    for (let i = 0; i < this.colMax; i++) this.colorList.push(i);

    this.initGrille();
    // Game.launch : le décor du niveau d'abord, la réserve de pièces ensuite —
    // sinon les premières pièces seraient tirées avant que les couleurs du
    // niveau ne soient connues.
    // `grille: null` demande explicitement une grille vide (utile aux tests) ;
    // l'absence de champ fait générer le niveau, comme le jeu.
    let modele = o.grille;
    if (modele === undefined) {
      const g = genererNiveau(this.niveau, (n) => this.hasard(n), this.xMax, this.yMax, o.fiche);
      modele = g.grille;
      this.colMax = g.couleurs;
      this.hauteurDepart = g.hauteur;
      this.colorList = [];
      for (let i = 0; i < this.colMax; i++) this.colorList.push(i);
    }
    if (modele) this.remplirNiveau(modele);
    this.remplirReserve();
    this.initStatsChute();
    this.initStep(ETAPE.CHUTE);
  }

  hasard(n) { return Math.floor(this.rng() * n); }
  evenement(nom, d) { if (this.onEvent) this.onEvent(nom, d); }

  // ── La grille ──
  initGrille() {
    this.grille = [];
    for (let x = 0; x < this.xMax; x++) {
      this.grille[x] = new Array(this.yMax).fill(null);
    }
  }
  // Flash laissait un tableau s'étendre tout seul : écrire hors grille y était
  // silencieux. En JavaScript, `grille[-1][y]` lève et emporte la partie. On
  // refuse donc la case invalide plutôt que de planter — et on le signale, car
  // y arriver est un bug, pas un cas de jeu.
  insererDansGrille(e) {
    if (!this.grille[e.px] || e.py < 0 || e.py >= this.yMax) {
      this.evenement('caseHorsGrille', { x: e.px, y: e.py, et: e.et });
      e.vivant = false;
      return;
    }
    this.grille[e.px][e.py] = e;
  }
  retirerDeLaGrille(e) {
    if (this.grille[e.px] && this.grille[e.px][e.py] === e) this.grille[e.px][e.py] = null;
  }
  estLibre(x, y) {
    return x >= 0 && x < this.xMax && y >= 0 && y < this.yMax && this.grille[x][y] === null;
  }
  element(x, y) {
    if (x < 0 || x >= this.xMax || y < 0 || y >= this.yMax) return null;
    return this.grille[x][y];
  }

  // Game.genElement
  genElement(et, x, y, n) {
    const C = CLASSES[et];
    if (!C) return null;
    const o = { px: x, py: y };
    // Game.genElement : pour un jeton, la couleur est TOUJOURS tirée au sort et
    // `n` désigne son état (perle, armure, étoile) — pas sa couleur.
    if (et === E.JETON) { o.type = this.getColor(); o.special = n || 0; }
    else if (et === E.PIERRE) o.life = (n === undefined || n === null) ? 3 : n;
    else if (et === E.CELLULE) o.level = n || 0;
    else if (et === E.OBJET) o.type = n || 0;
    // Eye.init tire lui-même sa couleur dans la liste du niveau — le `n` du
    // modèle ne lui dit rien (genElement, cas E_EYE : il est ignoré).
    else if (et === E.OEIL) o.color = this.getColor();
    const e = new C(this, o);
    e.poser();
    return e;
  }

  // Game.fillLevel : on pose le décor du niveau, puis on PROTÈGE les groupes
  // déjà formés — sinon la partie commencerait par une cascade gratuite.
  remplirNiveau(modele) {
    for (let x = 0; x < this.xMax; x++) {
      for (let y = 0; y < this.yMax; y++) {
        const o = modele[x] && modele[x][y];
        if (!o) continue;
        this.genElement(o.et, x, y, o.n);
      }
    }
    let garde = 0;
    do {
      this.viderGroupes();
      this.chercherGroupes();
    } while (this.protegerGroupe() && garde++ < 200);
  }

  // Game.protectGroup : un groupe déjà complet reçoit une perle, qui le fait
  // repasser sous le seuil.
  protegerGroupe() {
    for (const g of this.gList) {
      if (g.taille() >= this.groupMax) {
        g.list[this.hasard(g.list.length)].setSpecial(SPECIAL.PERLE);
        return true;
      }
    }
    return false;
  }

  // ── Les couleurs ──
  getColor() { return this.colorList[this.hasard(this.colorList.length)]; }

  // Game.updatecolorList : une couleur absente de la grille sort du tirage.
  // Quand il n'en reste plus, le niveau est gagné.
  majCouleurs() {
    const presentes = {};
    for (const c of this.colorList) presentes[c] = false;
    for (const e of this.eList) {
      if (e.et === E.JETON) presentes[e.type] = true;
      if (e.et === E.OEIL) presentes[e.color] = true;
    }
    let retirees = false;
    for (let i = 0; i < this.colorList.length; i++) {
      if (!presentes[this.colorList[i]]) {
        this.evenement('couleurFinie', { couleur: this.colorList[i] });
        // Game.updatecolorList : le drapeau reste levé jusqu'à la fin du
        // niveau — la recharge de mana est coupée pour de bon.
        this.flColorKill = true;
        this.colorList.splice(i--, 1);
        retirees = true;
      }
    }
    if (!retirees) return;
    if (this.colorList.length > 0) this.viderReserve();
    else this.finPartie(true);
  }

  // ── La file des pièces à venir ──
  remplirReserve() {
    while (this.nextList.length < this.nextLimit) this.nextList.push(this.nouvelleForme());
  }

  // Game.updateNextList + Base.newPieceList : une forme, puis un jeton par case.
  nouvelleForme() {
    if (this.fabriquePiece) {
      const imposee = this.fabriquePiece(this);
      if (imposee) return imposee;
    }
    const sn = Math.min(Math.max(1, this.shapeNum + this.shapeNumInc), 6);
    let forme;
    if (sn <= 4) {
      const cat = FORMES[sn];
      forme = cat[this.hasard(cat.length)];
    } else {
      forme = this.grandeForme(sn);
    }
    return forme.map((c) => ({
      x: c.x, y: c.y,
      e: new Jeton(this, { type: this.getColor(), special: this.tirerEtoile() }),
    }));
  }

  // Base.newPieceListElement : l'étoile arrive quand assez de jetons ont été
  // détruits SANS qu'une étoile s'en mêle — c'est une récompense de régularité.
  tirerEtoile() {
    if (this.starWait > ETOILE_SEUIL) { this.starWait = 0; return SPECIAL.ETOILE; }
    return SPECIAL.AUCUN;
  }

  // Game.getBigShape : au-delà de quatre cases, la forme est tirée au sort —
  // on ajoute des cases contiguës jusqu'au compte voulu.
  grandeForme(n) {
    const list = [{ x: 0, y: 0 }];
    let garde = 0;
    while (list.length < n && garde++ < 500) {
      const x = this.hasard(5) - 2, y = this.hasard(5) - 2;
      let valide = false;
      for (const p of list) {
        const dif = Math.abs(p.x - x) + Math.abs(p.y - y);
        if (dif === 0) { valide = false; break; }
        if (dif === 1) valide = true;
      }
      if (valide) list.push({ x, y });
    }
    return list;
  }

  // spell/imp/Conglomerat : l'impy IMPOSE la pièce suivante, aussi grosse qu'il
  // est fort. Elle passe devant la file — c'est le seul moment où le jeu ne
  // tire pas lui-même ce qui va tomber.
  imposerForme(n) {
    this.nextPiece = this.grandeForme(n).map((c) => ({
      x: c.x, y: c.y,
      e: new Jeton(this, { type: this.getColor(), special: this.tirerEtoile() }),
    }));
    return this.nextPiece;
  }

  // Game.clearNext : quand une couleur disparaît, la file est renouvelée pour
  // ne plus proposer de pièces d'une couleur qui n'existe plus.
  viderReserve() {
    this.nextList = [];
    this.nextPiece = null;
    this.remplirReserve();
  }

  // ── Les étapes ──
  initStep(s) {
    if (this.step === ETAPE.FIGE) return;
    this.step = s;
    switch (s) {
      case ETAPE.CHUTE:
        this.cFall = 0;
        this.preparerChute();
        break;
      case ETAPE.JEU: {
        if (this.colorList.length === 0) { this.finPartie(true); return; }
        if (this.monteeAuto) this.pSpeed = Math.min(this.pSpeed + 0.0015, this.pSpeedStart * 3);
        const liste = this.nextPiece || this.nextList.shift();
        this.nextPiece = null;
        this.remplirReserve();
        this.piece = new Piece(this, liste);
        this.piece.fSpeed = this.pSpeed;
        this.pieces++;
        this.evenement('nouvellePiece', { pieces: this.pieces });
        break;
      }
      case ETAPE.DESTRUCTION:
        this.fs.list.push(0);
        this.detruireGroupes();
        this.timer = 0;
        this.souffler();
        if (this.dList.length === 0) {
          this.verifierStatsChute();
          // Game.initStep(3) : la cascade close, c'est le moment de la MAGIE. La
          // fée n'agit qu'ici, une fois par pièce posée, et seulement si le
          // joueur l'a appelée. Tant qu'un sort tient la main, le puzzle attend.
          if (this.sortsAFaire) { this.initSorts(); this.sortsAFaire = false; }
          if (this.saList.length > 0) { this.initStep(ETAPE.MAGIE); break; }
          // Game.initStep(5) : une fois la cascade close, chaque élément vit
          // son tour — les yeux se chargent et pondent, les objets dégagés
          // DÉCOLLENT. La partie attend la fin de leur envol pour reprendre.
          if (this.flActiviteAFaire) {
            this.flActiviteAFaire = false;
            this.initStep(ETAPE.ACTIF);
            break;
          }
          this.nouveauTour();
        }
        break;
      case ETAPE.ACTIF:
        this.activeList = [];
        // La ponte d'abord (elle peut mûrir la grille), puis les décollages.
        this.actifRelance = this.veillerYeux();
        for (const e of this.eList.slice()) e.initActiveStep();
        break;
      case ETAPE.MAGIE:
      case ETAPE.FIGE:
        break;
      default:
        break;
    }
  }

  // Game.newCycle : on repart d'une chute, avec un compte de cascade neuf.
  nouveauCycle() {
    this.initStep(ETAPE.CHUTE);
    this.initStatsChute();
  }

  // Game.initSpell — appelé UNE fois par tour. Chaque fée regarde si on l'a
  // appelée ; les impys, eux, n'ont le droit d'agir que sur une grille déjà
  // encombrée (plus d'un dixième), sans quoi ils étoufferaient un début de
  // niveau.
  initSorts() {
    for (const f of this.faerieList.slice()) f.verifierSort();
    if (this.coefRemplissage() > 0.1) {
      for (const i of this.impList.slice()) i.verifierSort();
    }
    this.flAide = false;
  }

  /**
   * Le garde-fou de l'étape MAGIE — la ceinture par-dessus les bretelles.
   *
   * Un sort garde la main jusqu'à ce qu'il la rende. C'est la règle du jeu
   * d'origine, et c'est aussi sa fragilité : un sort qui attend une condition
   * qui n'arrivera pas fige la partie POUR DE BON, sans message, sans issue —
   * « les billes bougent mais n'atteignent pas leur cible, je dois quitter ».
   * Chaque cas connu est corrigé à sa source (voir sorts.js) ; ceci n'attrape
   * que l'inconnu.
   *
   * Le seuil est large à dessein : la plus longue main mesurée sur des
   * milliers de sorts est de 430 images, celle des Billes de lumière qui
   * poursuivent un démon en fuite. Dix-huit cents images — quarante-cinq
   * secondes — ne peuvent donc être qu'une panne. On rend alors la main comme
   * le sort l'aurait fait lui-même (finishAll), et la partie repart.
   */
  surveillerSort(s, tmod) {
    if (!s) { this.sortTenu = null; this.sortTenue = 0; return; }
    if (s !== this.sortTenu) { this.sortTenu = s; this.sortTenue = 0; }
    this.sortTenue += tmod;
    if (this.sortTenue <= TENUE_MAX) return;
    this.sortTenu = null;
    this.sortTenue = 0;
    this.evenement('sortBloque', { nom: s.nom(), id: s.sid, step: s.step });
    if (typeof s.toutFinir === 'function') s.toutFinir();
    // Un sort qui ne se retire pas de lui-même : on l'écarte à la main, sans
    // quoi le garde-fou se redéclencherait indéfiniment.
    const i = this.saList.indexOf(s);
    if (i >= 0) this.saList.splice(i, 1);
  }

  /**
   * Game.callHelp : la touche d'aide. Sans mana, la fée refuse — et le dit.
   *
   * `Key.isDown(Cm.pref.$key[4])` n'est SONDÉ que dans `case 2` de Game.update,
   * l'étape où l'on joue. Pendant une chute, une cassure, et surtout pendant
   * l'animation d'un sort (étape 4), la touche n'est pas lue du tout : l'appui
   * n'est ni pris ni mis en attente, il est PERDU. C'est la mécanique du jeu,
   * pas un oubli — sans elle, taper pendant la cloche d'immunité enchaînerait
   * un second sort qui l'annulerait aussitôt (spell/Base.cast arrête le sort
   * en cours).
   *
   * Le portage, lui, écoutait un `keydown` du navigateur à n'importe quelle
   * étape et gardait `flAide` jusqu'au prochain `initSorts` — c'est-à-dire
   * jusqu'à la fin de l'animation en cours. D'où « l'input est gardé et la fée
   * utilise un sort après l'animation ».
   */
  appelerAide() {
    if (this.step !== ETAPE.JEU) return false;
    let ok = false;
    for (const f of this.faerieList.slice()) ok = f.appelerAide() || ok;
    return ok;
  }

  /**
   * Game.update, la boucle de `quakeList` — elle tourne à CHAQUE image, quelle
   * que soit l'étape.
   *
   *     o.timer -= tmod
   *     c = 1, puis 0 quand le compte est fini, sinon timer/fadeLimit
   *     skin._x = pos.x + cos(hasard)·hasard·ray·c
   *
   * L'amplitude fond avec le compte, et la dernière image remet l'élément à sa
   * place exacte (c = 0). Ici, `pos` est la case elle-même : on écrit dans
   * `decalX/decalY`, que le client ajoute déjà à la position de la grille.
   */
  bougerSecousses(tmod) {
    for (let i = 0; i < this.secousses.length; i++) {
      const o = this.secousses[i];
      o.timer -= tmod;
      let c = 1;
      if (o.timer < 0) { this.secousses.splice(i--, 1); c = 0; }
      else if (o.timer < o.fadeLimit) c = o.timer / o.fadeLimit;
      if (!o.e.vivant) continue;
      const a = this.rng() * 6.28;
      const d = this.rng() * o.ray * c;
      o.e.decalX = Math.cos(a) * d;
      o.e.decalY = Math.sin(a) * d;
    }
  }

  // Game.update — la boucle, un pas d'image à la fois.
  update(tmod) {
    if (this.termine) return;
    if (tmod === undefined) tmod = 1;
    this.horloge += tmod;
    this.bougerSecousses(tmod);
    // Tout ce qui vole avance AVANT le puzzle, quelle que soit l'étape : c'est
    // ce qui fait que la fée continue de voler pendant une cascade.
    if (this.champ) this.champ.update(tmod);
    switch (this.step) {
      case ETAPE.CHUTE:
        this.cFall += 0.5 * tmod;
        this.tomber(this.cFall);
        while (this.cFall >= 1) this.cFall--;
        if (this.fList.length === 0) {
          this.viderGroupes();
          this.chercherGroupes();
          this.initStep(ETAPE.DESTRUCTION);
        }
        break;
      case ETAPE.JEU:
        // Game.update case 2 : le seul compteur qui n'avance QUE pendant qu'on
        // joue. Le bassin s'en sert pour ajouter ses couleurs.
        this.mainTimer += tmod;
        this.piece.update(tmod, this.entree);
        break;
      case ETAPE.DESTRUCTION:
        /*
         * Game.update, case 3 — et c'est TOUT ce qui arrive à un paquet de
         * couleur qui casse :
         *
         *     timer += Timer.tmod
         *     pour chaque e de dList : blanchir de timer/10
         *     si timer > 10 : e.kill()
         *
         * Les billes BLANCHISSENT sur dix images, puis disparaissent. Pas un
         * éclat, pas une particule. Les cristaux (`Token.fxCrystal`) viennent
         * de `Token.explode`, que rien n'appelle ici : seuls trois sorts le
         * font — le Météore qui écrase, les Billes de lumière qui frappent, le
         * Perce-puits qui creuse (voir `exploser`). Les poser sur la
         * destruction ordinaire couvrait la forêt d'éclats que le jeu d'origine
         * n'a jamais montrés.
         */
        this.timer += tmod;
        // `col.setTransform({ rb: 255*p, gb: 255*p, bb: 255*p })` — la teinte
        // monte vers le blanc à mesure que le compteur court. C'est la SEULE
        // chose que le joueur voit d'un paquet qui casse ; sans elle les billes
        // s'évanouissent d'un coup, et la cascade devient illisible.
        for (const e of this.dList) e.eclat = Math.min(1, this.timer / 10) * 100;
        if (this.timer > 10) {
          for (const e of this.dList) e.tuer();
          this.dList = [];
          this.initStep(ETAPE.CHUTE);
        }
        break;
      // Game.update case 5 : l'élément de tête, UN par image — le jeu entier
      // regarde l'objet s'envoler. La liste vidée, le cycle reprend si la
      // grille a changé ; sinon le tour s'achève.
      case ETAPE.ACTIF:
        if (this.activeList.length > 0) this.activeList[0].majActive(tmod);
        if (this.activeList.length === 0) {
          if (this.actifRelance) this.nouveauCycle();
          else this.nouveauTour();
        }
        break;
      // Game.update case 4 : le sort a la main. Il se lance à sa première image
      // et pilote la partie jusqu'à ce qu'il la rende (endActive), après quoi le
      // cycle reprend.
      case ETAPE.MAGIE:
        if (this.saList.length > 0) {
          const s = this.saList[0];
          if (!s.flLance) {
            s.lancer();
            this.evenement('sort', { nom: s.nom(), id: s.sid, cout: s.cout });
          }
          // Un sort peut se terminer NET dans son lancer même — Perce-Puits
          // sans colonne à vider, Ascension sans bille : initStep(0) fait
          // toutFinir() et le sort sort des listes avant d'avoir joué. Lui
          // donner quand même son image d'updateActif le faisait dérouler son
          // étape 0 sans cible (`l.trg` nul, tube absent) : la boucle de jeu
          // levait une exception à CHAQUE image et la partie gelait.
          if (this.saList[0] === s) s.updateActif(tmod);
          this.surveillerSort(this.saList[0] === s ? s : null, tmod);
        } else {
          this.sortTenu = null;
          this.sortTenue = 0;
          this.nouveauCycle();
        }
        break;
      default:
        break;
    }
  }

  // ── La chute (Game.fall / checkFall) ──
  preparerChute() {
    // Game.checkFall trie du bas vers le haut : un élément ne peut tomber que
    // si celui d'en dessous est déjà parti.
    const liste = this.eList.slice().sort((a, b) => b.py - a.py);
    this.fList = [];
    for (const e of liste) {
      if (!e.aUnSol()) { this.fList.push(e); e.flFalling = true; }
    }
  }

  /*
   * Game.fall — et sa dernière ligne, qui fait tout : `setPos(e, e.px, e.py+c)`.
   *
   * `c` est la part FRACTIONNAIRE de la chute : la bille n'est pas posée sur sa
   * case, elle est posée ENTRE deux cases, à `py + c` rangées. Comme le compteur
   * monte d'un demi par image, une case prend deux images et la bille glisse.
   * Le portage ne gardait que le `py` entier : les billes sautaient de case en
   * case, et toute la cascade paraissait hachée à côté du Flash.
   */
  tomber(cFall) {
    for (let i = 0; i < this.fList.length; i++) {
      const e = this.fList[i];
      let c = cFall;
      while (c >= 1) {
        this.retirerDeLaGrille(e);
        e.py++;
        this.insererDansGrille(e);
        if (e.aUnSol()) {
          c = 0;
          e.flFalling = false;
          this.fList.splice(i--, 1);
        } else {
          c -= 1;
        }
      }
      // La position entre deux cases, en pixels — le client dessine chaque
      // élément sur sa case, décalé de ce qu'on lui pose là.
      e.decalY = c * TS;
    }
  }

  // ── Les groupes ──
  viderGroupes() {
    while (this.gList.length > 0) this.gList.pop().detruire();
  }

  // Game.checkGroup : on balaie la grille et on relie chaque jeton à son voisin
  // de droite et à celui du dessous. Deux groupes qui se rencontrent fusionnent.
  chercherGroupes() {
    const dir = [{ x: 1, y: 0 }, { x: 0, y: 1 }];
    for (let x = 0; x < this.xMax; x++) {
      for (let y = 0; y < this.yMax; y++) {
        const e = this.grille[x][y];
        if (!e || e.et !== E.JETON || !e.flGroupable) continue;
        if (!e.groupe) new Groupe(this).ajouter(e);
        for (const d of dir) {
          const v = this.element(x + d.x, y + d.y);
          if (!v || v.et !== E.JETON || !v.flGroupable || v.type !== e.type) continue;
          if (v.groupe) { if (e.groupe !== v.groupe) e.groupe.avaler(v.groupe); }
          else e.groupe.ajouter(v);
        }
      }
    }
  }

  // Game.destroyGroup : tout groupe au-dessus du seuil disparaît. Une étoile
  // dans le lot emporte toute sa couleur.
  detruireGroupes() {
    this.dList = [];
    for (let i = 0; i < this.gList.length; i++) {
      const g = this.gList[i];
      const max = g.taille();
      if (max < this.groupMax) continue;
      for (const e of g.list) {
        if (e.special === SPECIAL.ETOILE) {
          this.evenement('etoile', { couleur: e.type, x: e.px, y: e.py });
          this.detruireCouleur(e.type);
          this.fs.flSpecial = true;
        }
        this.detruireElement(e);
      }
      this.gList.splice(i--, 1);
      this.fs.bm = Math.max(this.fs.bm, max);
      this.fs.list[this.fs.list.length - 1] += max;
      this.fs.sum += max;
    }
    if (this.dList.length) {
      this.evenement('destruction', { nombre: this.dList.length, chaine: this.fs.list.length });
    }
  }

  detruireElement(e) {
    if (e.flDestroy) return;
    e.flDestroy = true;
    this.dList.push(e);
  }

  // Game.destroyColor : l'étoile balaie toute une couleur.
  detruireCouleur(type) {
    for (const e of this.eList.slice()) {
      if (e.et === E.JETON && e.type === type) this.detruireElement(e);
    }
  }

  // Game.checkBlast : les quatre voisins d'une case détruite reçoivent le
  // souffle. C'est ce qui casse les pierres et libère les impys.
  souffler() {
    const dir = [{ x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }, { x: 1, y: 0 }];
    const vus = new Set();
    for (const de of this.dList) {
      for (const d of dir) {
        const e = this.element(de.px + d.x, de.py + d.y);
        if (!e || vus.has(e) || e.flDestroy) continue;
        vus.add(e);
        e.souffler();
      }
    }
  }

  // ── Le tour ──
  initStatsChute() { this.fs = { bm: 0, list: [], sum: 0, flSpecial: false }; }

  // Game.checkFallStats : le score d'une cascade. Chaque maillon vaut son rang,
  // ce qui récompense les enchaînements bien plus que les gros groupes isolés.
  verifierStatsChute() {
    let somme = 0;
    for (let i = 0; i < this.fs.list.length; i++) somme += this.fs.list[i] * (i + 1);
    if (somme > 0) {
      this.score += somme;
      this.evenement('score', {
        gagne: somme, score: this.score, chaine: this.fs.list.length, max: this.fs.bm,
        // Le détail maillon par maillon : l'arbre creux ne compte pas comme la
        // forêt, et c'est de là qu'il tire son score.
        liste: this.fs.list.slice(),
      });
    }
    // Sans étoile dans le lot, les jetons détruits nourrissent la prochaine —
    // et rechargent la mana des fées : Game.checkFallStats fait
    // fi.incManaTimer(-somme × coef), coef = Aventure.getManaReplenishCoef()
    // — 3, mais ZÉRO dès qu'une couleur du niveau a été éliminée (flColorKill).
    // L'étoile, elle, n'est pas coupée : sa règle ne lit que flSpecial.
    if (!this.fs.flSpecial) {
      this.starWait += this.fs.sum;
      const coef = this.flColorKill ? 0 : this.manaCoef;
      for (const f of this.faerieList) {
        if (f && f.incManaTimer) f.incManaTimer(-this.fs.sum * coef);
      }
    }
  }

  // Game.newTurn : nouvelle pièce, sauf si la pile a atteint la ligne fatale.
  //
  // C'est ICI que les couleurs sont recomptées, et nulle part ailleurs
  // (base/Forest.onNewTurn). Le faire pendant la cascade viderait la liste dès
  // la première image d'une grille encore vide, et la partie s'annoncerait
  // gagnée avant d'avoir commencé.
  nouveauTour() {
    if (this.termine) return;
    // base/*.onNewTurn : c'est ici que les lieux prennent la main — le donjon
    // fait monter son ascenseur, l'arc-en-ciel avance sa roue.
    this.evenement('nouveauTour', { pieces: this.pieces });
    if (this.termine) return;
    if (this.couleursSeVident) this.majCouleurs();
    if (this.termine) return;
    if (this.grilleTropHaute()) { this.finPartie(false); return; }
    this.initStep(ETAPE.JEU);
  }

  // Game.checkFull : un élément sur la troisième ligne, et c'est fini.
  grilleTropHaute() {
    for (let x = 0; x < this.xMax; x++) if (this.grille[x][LIGNE_MORT]) return true;
    return false;
  }

  // Game.onPieceValidate → newUpkeep → newCycle
  surPiecePosee() {
    this.piece = null;
    // Game.newUpkeep : la pose d'une pièce ouvre un tour, et c'est à la fin de
    // ce tour que les objets dégagés se ramassent et que la magie opère.
    for (const s of this.sList.slice()) s.surEntretien();
    this.sortsAFaire = true;
    this.flActiviteAFaire = true;
    this.initStatsChute();
    this.initStep(ETAPE.CHUTE);
  }

  // Un élément a fini de vivre son tour (envol terminé, rayon éteint) : il
  // rend la main. La liste vide, l'étape ACTIF s'achève.
  retirerActif(e) {
    const i = this.activeList.indexOf(e);
    if (i >= 0) this.activeList.splice(i, 1);
  }

  // Eye.initActiveStep, pour tous les yeux du plateau : chacun se charge d'un
  // cran, et ceux qui sont pleins pondent. Dit si la grille a changé.
  veillerYeux() {
    let ponte = false;
    for (const e of this.eList.slice()) {
      if (e.et === E.OEIL && e.vivant && e.pondre()) ponte = true;
    }
    return ponte;
  }

  finPartie(gagne) {
    if (this.termine) return;
    this.termine = true;
    this.gagne = !!gagne;
    this.step = ETAPE.FIGE;
    this.evenement('finPartie', {
      gagne: this.gagne, score: this.score, niveau: this.niveau, pieces: this.pieces,
      objets: this.objets.slice(),
    });
  }

  // ── Lecture pour le client ──
  hauteurPile() {
    for (let y = 0; y < this.yMax; y++) {
      for (let x = 0; x < this.xMax; x++) if (this.grille[x][y]) return this.yMax - y;
    }
    return 0;
  }

  // ── Géométrie de l'aire (Game.getX / getY / isIn) ──
  //
  // La grille est posée à MARGE_GAUCHE et MARGE_HAUT ; MARGE_HAUT vaut -32,
  // donc les deux premières lignes sont HORS de l'écran. C'est l'espace où la
  // fée peut monter, et c'est aussi pourquoi l'aire fait 240 de haut pour
  // dix-sept lignes de seize.
  posX(gx) { return this.margeGauche + gx * TS; }
  posY(gy) { return this.margeHaut + gy * TS; }
  estDans(x, y, m) {
    return x > m + this.margeGauche && y > m + this.margeHaut
      && x < this.largeur - m && y < this.hauteur - m;
  }

  // Game.getHeightMax : la ligne de la case occupée la plus haute (yMax si la
  // grille est vide). Tranche-Cimes s'en sert pour choisir sa hauteur de coupe.
  hauteurMax() {
    let ym = this.yMax;
    for (let x = 0; x < this.xMax; x++) {
      for (let y = 0; y < this.yMax; y++) {
        if (this.grille[x][y]) { ym = Math.min(y, ym); break; }
      }
    }
    return ym;
  }

  // Game.getCoefFull : la part de la grille occupée. Au-delà de 10 %, les impys
  // ont le droit de lancer leurs sorts à eux.
  coefRemplissage() {
    let score = 0;
    for (let x = 0; x < this.xMax; x++) {
      for (let y = 0; y < this.yMax; y++) if (this.grille[x][y]) score++;
    }
    return score / (this.xMax * this.yMax);
  }

  // ── Le modèle de grille (Game.getGridModel / evalGridModel) ──
  //
  // C'est le CERVEAU des sorts. La fée ne raisonne jamais sur la vraie grille :
  // elle en prend une copie allégée où ne subsistent que les jetons groupables
  // — { t: couleur, g: groupe, s: état spécial } — puis simule dessus (échanger
  // deux billes, vider une colonne) et compare les scores. Rien de ce qu'elle
  // essaie ne touche la partie.
  modeleGrille() {
    const liste = [];
    for (let x = 0; x < this.xMax; x++) {
      liste[x] = new Array(this.yMax).fill(null);
      for (let y = 0; y < this.yMax; y++) {
        const e = this.grille[x][y];
        if (e && e.et === E.JETON && e.flGroupable) {
          liste[x][y] = { t: e.type, g: null, s: e.special };
        }
      }
    }
    return liste;
  }

  // Relie chaque unité à sa voisine de droite et à celle du dessous, exactement
  // comme chercherGroupes le fait sur la vraie grille — deux groupes qui se
  // rencontrent fusionnent.
  evaluerModele(liste) {
    const gList = [];
    for (let x = 0; x < this.xMax; x++) {
      for (let y = 0; y < this.yMax; y++) {
        const e = liste[x] && liste[x][y];
        if (!e) continue;
        if (!e.g) { e.g = [e]; gList.push(e.g); }
        for (const d of [{ x: 1, y: 0 }, { x: 0, y: 1 }]) {
          const col = liste[x + d.x];
          const se = col ? col[y + d.y] : null;
          if (!se || se.t !== e.t) continue;
          if (se.g) {
            if (se.g === e.g) continue;
            const n = gList.indexOf(se.g);
            if (n >= 0) gList.splice(n, 1);
            for (const gre of se.g.slice()) { e.g.push(gre); gre.g = e.g; }
          } else {
            e.g.push(se);
            se.g = e.g;
          }
        }
      }
    }
    return { gList, liste };
  }

  // Game.getGroupModelScore : seuls comptent les groupes qui EXPLOSERAIENT, et
  // seules les billes ordinaires (s === 0) comptent dans le décompte — une
  // perle appartient au groupe mais ne le fait pas sauter. Un groupe trop petit
  // ne rapporte rien du tout : la fée cherche des coups qui marchent, pas des
  // demi-mesures.
  scoreModele(gList) {
    let score = 0;
    for (const g of gList) {
      let tr = 0;
      for (const u of g) if (u.s === 0) tr++;
      if (tr >= this.groupMax) score += tr * 50;
    }
    return score;
  }
}


// ── Le tirage d'un objet (Item.getRandomId) ───────────────────────────────
//
// L'ordre compte, et il dit toute la progression du jeu :
//
//   1. le SAC. Tant qu'on n'en a pas le troisième, il peut tomber — mais
//      seulement passé le niveau 20×(sac déjà acquis), et de plus en plus
//      rarement. C'est la vraie porte d'entrée.
//   2. SANS SAC, rien d'autre ne tombe. Un joueur qui commence ne ramasse donc
//      que son premier sac, et c'est voulu : il n'aurait nulle part où ranger.
//   3. la FLASQUE, d'autant plus rare qu'on en a déjà.
//   4. sinon, une pioche pondérée — une fois sur quatre dans les objets, trois
//      fois sur quatre dans la nourriture — parmi ce que le niveau autorise.
//
// Table Item.itemList / Item.foodList : { id, freq, lvl } où `lvl` est le
// niveau minimum. Les parchemins (100+) et grimoires (200+) sont ajoutés à
// partir de Spell.spellList — fréquence de moitié pour l'un, du cinquième pour
// l'autre, et niveau doublé pour le grimoire.
const SORTS = [
  { id: 1, freq: 500, lvl: 20 }, { id: 2, freq: 750, lvl: 10 }, { id: 3, freq: 200, lvl: 80 },
  { id: 4, freq: 350, lvl: 10 }, { id: 5, freq: 100, lvl: 40 }, { id: 6, freq: 150, lvl: 28 },
  { id: 7, freq: 800, lvl: 15 }, { id: 8, freq: 50, lvl: 40 }, { id: 9, freq: 300, lvl: 10 },
  { id: 10, freq: 500, lvl: 20 }, { id: 11, freq: 100, lvl: 40 }, { id: 12, freq: 700, lvl: 15 },
  { id: 13, freq: 20, lvl: 25 }, { id: 14, freq: 150, lvl: 50 }, { id: 15, freq: 300, lvl: 25 },
  { id: 16, freq: 2, lvl: 20 }, { id: 20, freq: 0, lvl: 10 }, { id: 21, freq: 500, lvl: 18 },
  { id: 22, freq: 400, lvl: 22 }, { id: 23, freq: 300, lvl: 28 }, { id: 24, freq: 50, lvl: 36 },
  { id: 25, freq: 150, lvl: 50 }, { id: 26, freq: 300, lvl: 30 }, { id: 27, freq: 200, lvl: 100 },
];

const OBJETS = [
  { id: 0, freq: 400, lvl: 10 }, { id: 1, freq: 50, lvl: 30 }, { id: 2, freq: 10, lvl: 70 },
  { id: 5, freq: 400, lvl: 10 }, { id: 6, freq: 50, lvl: 30 }, { id: 7, freq: 10, lvl: 70 },
  { id: 10, freq: 300, lvl: 10 }, { id: 11, freq: 40, lvl: 30 }, { id: 12, freq: 8, lvl: 70 },
  { id: 15, freq: 400, lvl: 10 }, { id: 16, freq: 50, lvl: 30 }, { id: 17, freq: 10, lvl: 70 },
  { id: 20, freq: 400, lvl: 10 }, { id: 21, freq: 50, lvl: 30 }, { id: 22, freq: 10, lvl: 70 },
  { id: 25, freq: 400, lvl: 10 }, { id: 26, freq: 50, lvl: 30 }, { id: 27, freq: 10, lvl: 70 },
  { id: 30, freq: 0, lvl: 0 },                       // flasque : jamais par la pioche
  { id: 31, freq: 600, lvl: 0 },                     // clé de donjon
  { id: 40, freq: 20, lvl: 30 }, { id: 41, freq: 10, lvl: 20 }, { id: 42, freq: 10, lvl: 60 },
  { id: 43, freq: 10, lvl: 70 }, { id: 44, freq: 15, lvl: 50 }, { id: 45, freq: 5, lvl: 40 },
  { id: 46, freq: 100, lvl: 10 },
  { id: 70, freq: 700, lvl: 0 }, { id: 71, freq: 300, lvl: 10 }, { id: 72, freq: 80, lvl: 20 },
].concat(
  SORTS.map((s) => ({ id: 100 + s.id, freq: Math.floor(s.freq * 0.5), lvl: s.lvl })),
  SORTS.map((s) => ({ id: 200 + s.id, freq: Math.floor(s.freq * 0.2), lvl: Math.floor(s.lvl * 2) })),
);

const NOURRITURE = [
  { id: 300, freq: 800, lvl: 0 }, { id: 303, freq: 300, lvl: 0 }, { id: 306, freq: 500, lvl: 0 },
  { id: 309, freq: 600, lvl: 0 }, { id: 312, freq: 500, lvl: 0 },
  { id: 315, freq: 75, lvl: 10 }, { id: 318, freq: 125, lvl: 10 }, { id: 321, freq: 125, lvl: 10 },
  { id: 324, freq: 175, lvl: 10 }, { id: 327, freq: 125, lvl: 10 },
  { id: 330, freq: 8, lvl: 20 }, { id: 333, freq: 12, lvl: 20 }, { id: 336, freq: 20, lvl: 20 },
  { id: 339, freq: 18, lvl: 20 }, { id: 342, freq: 24, lvl: 20 }, { id: 345, freq: 16, lvl: 20 },
  { id: 348, freq: 2, lvl: 20 }, { id: 351, freq: 6, lvl: 20 }, { id: 354, freq: 4, lvl: 20 },
];

const ITEM_RATE = 2;              // Cs.itemRate : une chance sur deux

/**
 * @param {number} niveau
 * @param {function} hasard
 * @param {{sac:number, flasques:number}} fiche  ce que la fiche du joueur porte
 * @returns {number|null} l'identifiant tiré, ou null s'il n'y a rien à donner
 */
function tirerObjet(niveau, hasard, fiche) {
  const sac = (fiche && fiche.sac) || 0;
  const flasques = (fiche && fiche.flasques) || 0;

  // 1. LE SAC — la porte d'entrée de tout le reste.
  if (sac < 3 && niveau > sac * 20 && hasard(2 + sac * 20) === 0) return 80 + sac;

  // 2. Sans sac, rien : le joueur n'a nulle part où ranger.
  if (sac === 0) return null;

  // 3. LA FLASQUE — d'autant plus rare qu'on en a déjà (cube du compte).
  if (hasard(1e9) / 1e9 * Math.pow(flasques + 2, 3) < 1) return 30;

  // 4. La pioche : une fois sur quatre un objet, sinon de la nourriture.
  const source = (hasard(4) === 0) ? OBJETS : NOURRITURE;
  const liste = source.filter((o) => niveau >= o.lvl);
  const somme = liste.reduce((n, o) => n + o.freq, 0);
  if (somme <= 0) return null;
  let n = hasard(somme), s = 0;
  for (const o of liste) { s += o.freq; if (s > n) return o.id; }
  return null;
}

// ── La génération d'un niveau (base/Forest.getLevel) ──────────────────────
//
// Tout le jeu tient dans ce budget. On part d'une difficulté `10 + 2×niveau`,
// et chaque chose posée sur la grille en dépense : de la hauteur de départ (au
// carré, ou presque — c'est ce qui la rend si coûteuse), des yeux, des cellules
// d'impy. Ce qui reste au-delà de 40 achète une couleur de plus, et le prix de
// la suivante double. C'est de là que vient la courbe du jeu.
function tableElements(niveau) {
  // { et, n } : le type d'élément et son état. Les commentaires du jeu
  // d'origine appellent `n:1` une étoile — c'est en réalité la perle noire
  // (Token.setSpecial(1)). On suit la valeur, pas l'étiquette.
  const t = [
    { et: E.JETON, n: SPECIAL.AUCUN, freq: 0 },
    { et: E.JETON, n: SPECIAL.PERLE, freq: 0 },
    { et: E.JETON, n: SPECIAL.ARMURE, freq: 0 },
    { et: E.PIERRE, n: 2, freq: 0 },
    { et: E.BOMBE, n: null, freq: 0 },
  ];
  if (niveau < 3) { t[0].freq = 1000; }
  else if (niveau < 8) { t[0].freq = 700; t[1].freq = 300; }
  else if (niveau < 15) { t[0].freq = 500; t[1].freq = 400; t[2].freq = 100; }
  else if (niveau < 30) { t[0].freq = 400; t[1].freq = 350; t[2].freq = 250; }
  else { t[0].freq = 200; t[1].freq = 400; t[2].freq = 400; }
  if (niveau > 10) t[3].freq = Math.min(niveau * 6, 200);
  if (niveau > 25) t[4].freq = Math.min(niveau, 100);
  return { sum: t.reduce((s, x) => s + x.freq, 0), list: t };
}

/**
 * Dessine le contenu de départ d'un niveau, et dit combien de couleurs il
 * demande. Rendu séparé du moteur pour être vérifiable seul : c'est lui qui
 * décide si un niveau est jouable ou étouffant.
 *
 * @returns {{grille: Array, couleurs: number, hauteur: number}}
 */
function genererNiveau(niveau, hasard, xMax, yMax, fiche) {
  let dif = 10 + niveau * 2;
  let couleurs = COULEURS_DEPART;

  // HAUTEUR — la pile de départ. Son coût monte en puissance 2,2 : deux rangées
  // de plus coûtent bien plus cher que deux couleurs de plus.
  const hMax = Math.floor(Math.min(Math.sqrt(niveau), yMax - 7));
  const h = Math.floor(Math.max(Math.pow(niveau, 0.35), 2 + hasard(Math.max(1, hMax))));
  dif -= Math.pow(h, 2.2);

  // COULEUR — chaque couleur supplémentaire coûte le double de la précédente.
  let prix = 40;
  while (dif > prix) { dif -= prix; couleurs++; prix *= 2; }

  const table = tableElements(niveau);
  const grille = [];
  for (let x = 0; x < xMax; x++) {
    grille[x] = new Array(yMax).fill(null);
    for (let y = yMax - h; y < yMax; y++) {
      if (table.sum <= 0) break;
      const n = hasard(table.sum);
      let s = 0;
      for (const it of table.list) {
        s += it.freq;
        if (s > n) { grille[x][y] = { et: it.et, n: it.n }; break; }
      }
    }
  }

  // ŒIL — il retient sa couleur dans le tirage : tant qu'il est là, elle ne
  // peut pas disparaître, et le niveau ne peut pas se terminer.
  let yeux = 0;
  while (dif > 0 && hasard(Math.max(1, Math.floor(dif))) > 10 && yeux < Math.floor(niveau / 10)) {
    const he = 1 + hasard(h);
    dif -= (h - he) * 7;
    grille[hasard(xMax)][yMax - he] = { et: E.OEIL, n: 0 };
    yeux++;
  }

  // CELLULE D'IMPY — jusqu'à sept, de plus en plus fortes, tant que le budget
  // le permet. Une cellule de rang n coûte (n+1)×6.
  let impys = 0;
  while (dif > 7 && impys < 7) {
    const maxRang = Math.floor(Math.min(Math.pow(niveau, 0.4), 5));
    if (maxRang === 0) break;
    let n = hasard(maxRang) + 1, cout;
    do { n--; cout = (n + 1) * 6; } while (dif < cout && n > 0);
    if (dif < cout) break;
    dif -= cout;
    grille[hasard(xMax)][yMax - (1 + hasard(h))] = { et: E.CELLULE, n };
    impys++;
  }

  // OBJET — base/Forest.getLevel : jamais dans les trois premiers niveaux d'un
  // palier de vingt, et une fois sur deux seulement.
  if (niveau % 20 > 2 && hasard(ITEM_RATE) === 0) {
    const n = tirerObjet(niveau, hasard, fiche);
    if (n !== null) {
      grille[hasard(xMax)][yMax - (1 + hasard(Math.max(1, h - 1)))] = { et: E.OBJET, n };
    }
  }

  return { grille, couleurs, hauteur: h };
}

const API = {
  Jeu, Piece, Groupe, Element, Jeton, Pierre, Cellule, Bombe, Boule, Objet, Oeil,
  generateur, genererNiveau, tableElements, tirerObjet, OBJETS, NOURRITURE, SORTS, ITEM_RATE,
  COULEURS, E, SPECIAL, ETAPE, FORMES,
  TS, LARGEUR, HAUTEUR, MARGE_HAUT, MARGE_GAUCHE, GROUPE_MIN, COULEURS_DEPART,
  RESERVE, ETOILE_SEUIL, LIGNE_MORT,
};

if (typeof module !== 'undefined' && module.exports) module.exports = API;
else racine.MinipixizEngine = API;

})(typeof window !== 'undefined' ? window : globalThis);
