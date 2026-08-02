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
    Object.assign(this, o || {});
  }

  // Element.init : il entre dans la liste et dans la grille.
  poser() {
    this.jeu.eList.push(this);
    this.jeu.insererDansGrille(this);
  }

  // Element.haveGround : le sol, ou un élément qui ne tombe pas lui-même.
  aUnSol() {
    if (this.py + 1 >= this.jeu.yMax) return true;
    const e = this.jeu.grille[this.px][this.py + 1];
    return !!e && !e.flFalling;
  }

  // Le souffle d'une destruction voisine. Chaque espèce y réagit à sa façon.
  souffler() {}

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
      this.jeu.evenement('impyLibere', { x: this.px, y: this.py, level: this.level });
      this.tuer();
    } else {
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
  souffler() {
    this.jeu.evenement('bombe', { x: this.px, y: this.py });
    this.tuer();
  }
}

// sp/el/Item.mt — l'objet à ramasser. Il ne se ramasse que dégagé par le haut
// (Item.initActiveStep : la case au-dessus doit être libre).
class Objet extends Element {
  constructor(jeu, o) {
    super(jeu, o);
    this.et = E.OBJET;
    if (this.type === undefined) this.type = 0;
  }
  degage() { return this.jeu.estLibre(this.px, this.py - 1); }
}

// sp/el/Eye.mt — l'œil porte une couleur et la retient dans le tirage tant
// qu'il est là (Game.updatecolorList le compte comme un jeton).
class Oeil extends Element {
  constructor(jeu, o) {
    super(jeu, o);
    this.et = E.OEIL;
    if (this.color === undefined) this.color = 0;
  }
}

const CLASSES = {
  [E.JETON]: Jeton, [E.OBJET]: Objet, [E.PIERRE]: Pierre,
  [E.CELLULE]: Cellule, [E.BOMBE]: Bombe, [E.OEIL]: Oeil,
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
        this.tourner(1);
        if (!this.placeLibre(0, 0)) this.tourner(-1);
        else this.ta = (this.ta + 90) % 360;
      }
    } else {
      this.flTurn = true;
    }

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
      o.e.poser();
    }
    this.jeu.surPiecePosee();
  }

  // Position d'affichage, en pixels — le client n'a pas à la recalculer.
  cases() {
    return this.list.map((o) => ({
      e: o.e,
      x: MARGE_GAUCHE + (this.x + this.cx + o.x) * TS,
      y: MARGE_HAUT + (this.y + this.cy + o.y) * TS,
    }));
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
    this.xMax = Math.floor((LARGEUR - MARGE_GAUCHE) / TS);
    this.yMax = Math.floor((HAUTEUR - MARGE_HAUT) / TS);
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
    this.pieces = 0;                 // pieceTimer : le nombre de pièces posées
    this.termine = false;
    this.gagne = false;
    this.entree = { gauche: false, droite: false, bas: false, tourner: false };

    // base/Forest.initGame : la vitesse de chute monte avec le niveau.
    this.pSpeedStart = 0.03 + this.niveau * 0.002;
    this.pSpeed = this.pSpeedStart;

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
      const g = genererNiveau(this.niveau, (n) => this.hasard(n), this.xMax, this.yMax);
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
    else if (et === E.OEIL) o.color = n || 0;
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
    while (this.nextList.length < RESERVE) this.nextList.push(this.nouvelleForme());
  }

  // Game.updateNextList + Base.newPieceList : une forme, puis un jeton par case.
  nouvelleForme() {
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
        this.pSpeed = Math.min(this.pSpeed + 0.0015, this.pSpeedStart * 3);
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
          this.nouveauTour();
        }
        break;
      case ETAPE.FIGE:
        break;
      default:
        break;
    }
  }

  // Game.update — la boucle, un pas d'image à la fois.
  update(tmod) {
    if (this.termine) return;
    if (tmod === undefined) tmod = 1;
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
        this.piece.update(tmod, this.entree);
        break;
      case ETAPE.DESTRUCTION:
        // L'effacement dure dix images dans le jeu d'origine ; on garde le
        // délai, c'est lui qui rend la cascade lisible.
        this.timer += tmod;
        if (this.timer > 10) {
          for (const e of this.dList) e.tuer();
          this.dList = [];
          this.initStep(ETAPE.CHUTE);
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
      this.evenement('score', { gagne: somme, score: this.score, chaine: this.fs.list.length, max: this.fs.bm });
    }
    // Sans étoile dans le lot, les jetons détruits nourrissent la prochaine.
    if (!this.fs.flSpecial) this.starWait += this.fs.sum;
  }

  // Game.newTurn : nouvelle pièce, sauf si la pile a atteint la ligne fatale.
  //
  // C'est ICI que les couleurs sont recomptées, et nulle part ailleurs
  // (base/Forest.onNewTurn). Le faire pendant la cascade viderait la liste dès
  // la première image d'une grille encore vide, et la partie s'annoncerait
  // gagnée avant d'avoir commencé.
  nouveauTour() {
    if (this.termine) return;
    this.majCouleurs();
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
    this.initStatsChute();
    this.initStep(ETAPE.CHUTE);
  }

  finPartie(gagne) {
    if (this.termine) return;
    this.termine = true;
    this.gagne = !!gagne;
    this.step = ETAPE.FIGE;
    this.evenement('finPartie', {
      gagne: this.gagne, score: this.score, niveau: this.niveau, pieces: this.pieces,
    });
  }

  // ── Lecture pour le client ──
  hauteurPile() {
    for (let y = 0; y < this.yMax; y++) {
      for (let x = 0; x < this.xMax; x++) if (this.grille[x][y]) return this.yMax - y;
    }
    return 0;
  }
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
function genererNiveau(niveau, hasard, xMax, yMax) {
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

  return { grille, couleurs, hauteur: h };
}

const API = {
  Jeu, Piece, Groupe, Element, Jeton, Pierre, Cellule, Bombe, Objet, Oeil,
  generateur, genererNiveau, tableElements,
  COULEURS, E, SPECIAL, ETAPE, FORMES,
  TS, LARGEUR, HAUTEUR, MARGE_HAUT, MARGE_GAUCHE, GROUPE_MIN, COULEURS_DEPART,
  RESERVE, ETOILE_SEUIL, LIGNE_MORT,
};

if (typeof module !== 'undefined' && module.exports) module.exports = API;
else racine.MinipixizEngine = API;

})(typeof window !== 'undefined' ? window : globalThis);
