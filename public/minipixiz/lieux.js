/*
 * Minipixiz (miniTroll) — les trois autres lieux.
 *
 * Traduction de base/Dungeon.mt, base/Tree.mt et base/Rainbow.mt.
 *
 * Le même puzzle, trois fois, avec à chaque fois une seule règle en plus — et
 * cette règle change tout :
 *
 *   LE DONJON      le sol MONTE. Toutes les deux cent cinquante images, la
 *                  grille remonte d'une ligne et l'aire de jeu rétrécit d'autant.
 *                  Dix niveaux d'affilée, une clé à l'entrée, un diamant au bout.
 *
 *   L'ARBRE CREUX  pas de fin. On joue pour le score, la chute accélère toute
 *                  seule, et chaque palier ajoute une couleur ET un
 *                  multiplicateur. Le record va dans la fiche.
 *
 *   L'ARC-EN-CIEL  une roue tombe de cent à zéro, un cran et demi par pièce.
 *                  Tenir quatre-vingt-sept pièces sans déborder, et l'objet est
 *                  à vous. Huit couleurs d'entrée de jeu, grille vide.
 *
 * Chacun se pose autour d'une partie (engine.js) et d'un champ (combat.js) : la
 * fée vole et lance ses sorts dans les trois, exactement comme en forêt.
 */
'use strict';

(function (racine) {

const sousNode = (typeof module !== 'undefined' && module.exports);
const E = sousNode ? require('./engine.js') : racine.MinipixizEngine;
const C = sousNode ? require('./combat.js') : racine.MinipixizCombat;
const F = sousNode ? require('./faerie.js') : racine.MinipixizFee;
const P = sousNode ? require('./plateforme.js') : racine.MinipixizPlateforme;

const nombre = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// ── Le tronc commun (base/Aventure) ───────────────────────────────────────
//
// Un lieu monte une partie, y installe le champ, et fait avancer les deux. Ce
// qui le distingue tient dans `options()`, `niveauDeDepart()` et `update()`.
class Lieu {
  constructor(o) {
    const opts = o || {};
    this.carte = opts.carte;
    this.fee = opts.fee || null;          // la fiche de la fée qu'on emmène
    this.surEvenement = opts.surEvenement || null;
    this.graine = opts.graine === undefined ? 1 : opts.graine;
    this.level = 0;
    this.fini = false;
    this.gagne = false;
    this.commencer();
  }

  evenement(nom, d) { if (this.surEvenement) this.surEvenement(nom, d); }

  annonce(nom, d) {
    if (nom === 'finPartie') this.surFinDePartie(d);
    if (nom === 'score') this.surScore(d);
    if (nom === 'nouveauTour') this.surNouveauTour();
    this.evenement(nom, d);
  }

  options() { return {}; }
  niveauDeDepart() { return undefined; }   // undefined = le moteur génère
  emmeneLaFee() { return true; }
  // Les pièces à venir se lisent d'ordinaire dans le cadre du portrait, donc
  // seulement en aventure ; l'arbre creux, lui, a sa propre colonne.
  get colonneSuivantes() { return null; }
  // La PEAU de l'interface. Le cadre du portrait, le cœur et la goutte de mana
  // ont chacun trois habits, et le lieu choisit — la forêt garde le premier, le
  // donjon prend la pierre, l'arc-en-ciel les nuages. Les deux qui changent de
  // peau glissent aussi dix pixels sous le portrait.
  get peau() { return 1; }
  get margeFace() { return this.peau > 1 ? 10 : 0; }

  commencer() {
    this.jeu = new E.Jeu(Object.assign({
      graine: this.graine,
      niveau: this.level,
      onEvent: (n, d) => this.annonce(n, d),
      grille: this.niveauDeDepart(),
    }, this.options()));
    // base/Aventure.initFaerie : elle n'est du voyage que si elle tient debout —
    // et si le lieu l'emmène. L'arbre creux, lui, se joue seul.
    const prete = this.emmeneLaFee() && this.fee
      && new F.Fee(this.fee, null, this.carte).preteAuCombat();
    this.champ = new C.Champ(this.jeu, {
      fee: prete ? new F.Fee(this.fee, null, this.carte) : null,
      surEvenement: (n, d) => this.evenement(n, d),
    });
    this.fi = this.champ.faerieList[0] ? this.champ.faerieList[0].fi : null;
    this.jeu.entree = this.jeu.entree;
  }

  update(tmod) {
    if (this.fini) return;
    this.jeu.update(tmod);
  }

  surScore() {}
  surNouveauTour() {}

  surFinDePartie(d) {
    this.fini = true;
    this.gagne = !!d.gagne;
  }

  // Le gain d'expérience de la fée, quand elle est là et vivante.
  donnerExp(n) {
    const f = this.champ.faerieList[0];
    if (f && !f.flDeath) f.fi.incExp(n);
  }

  etat() {
    return { niveau: this.level, fini: this.fini, gagne: this.gagne, score: this.jeu.score };
  }
}

// ══════════════════════════════════════════════════════════════════════════
//  base/Dungeon.mt — le donjon
// ══════════════════════════════════════════════════════════════════════════
//
// Dix niveaux d'affilée, sans reprendre son souffle. Le sol monte, l'aire
// rétrécit, et la seule sortie est de vider chaque niveau avant d'être écrasé.
//
// Le RANG du donjon ($dungeon.$lvl, de 0 à 4) dit sa difficulté et le diamant
// qu'on en rapporte. Le rang 5 n'existe pas : au bout du cinquième, le compteur
// revient à zéro et `$loop` monte — on recommence, avec une couleur de plus.
const DONJON_NIVEAUX = 10;

class Donjon extends Lieu {
  get cadre() { return 'cadreDonjon'; }
  // base/Dungeon.initFaerieInterface : la pierre.
  get peau() { return 2; }

  constructor(o) {
    const c = (o || {}).carte;
    // Une clé à l'entrée, et elle est prise TOUT DE SUITE : abandonner ne la
    // rend pas.
    if (c) c.$key = Math.max(0, Math.min(nombre(c.$key) - 1, 9));
    super(o);
    if (c) c.$stat.$game[2] = nombre(c.$stat.$game[2]) + 1;
  }

  options() {
    const d = (this.carte && this.carte.$dungeon) || {};
    this.difficulte = nombre(d.$lvl);
    return {
      largeur: 132,
      hauteur: 240,
      couleurs: 3 + nombre(d.$loop),
      vitesse: 0.03 + this.level * 0.001,
    };
  }

  commencer() {
    super.commencer();
    // Le cycle de l'ascenseur. Le dernier niveau laisse deux fois plus de
    // temps : c'est celui où il y a des démons.
    this.heightCycle = (this.level < 9) ? 250 : 500;
    this.heightTimer = this.heightCycle * 0.5;
    this.wSpeed = 0;
    this.rotations = [0, 0, 0, 0, 0, 0];   // ws.r0..r2 puis wsb.r0..r2
    if (this.level === 9) {
      for (let i = 0; i < 2; i++) {
        this.champ.naitreImpy(this.difficulte, this.jeu.largeur * 0.5, this.jeu.hauteur * 0.5);
      }
    }
  }

  /**
   * base/Dungeon.getLevel — la pile de départ.
   *
   * Une dalle de PIERRE en surface, et sous elle des billes toutes marquées :
   * perle si la difficulté tombe sur une demie basse, armure sinon. On ne casse
   * donc jamais un groupe du premier coup — il faut d'abord user la couche.
   */
  niveauDeDepart() {
    const d = (this.carte && this.carte.$dungeon) || {};
    const dif = this.level * (0.3 + nombre(d.$lvl) * 0.1);
    const special = (dif % 1 > 0.5) ? 2 : 1;
    let h = Math.floor(dif) + 2;
    if (this.level === 9) h--;

    const xMax = Math.floor((132 - E.MARGE_GAUCHE) / E.TS);
    const yMax = Math.floor((240 - E.MARGE_HAUT) / E.TS);
    const g = [];
    for (let x = 0; x < xMax; x++) {
      g[x] = new Array(yMax).fill(null);
      for (let y = yMax - h; y < yMax; y++) {
        g[x][y] = (y === yMax - h) ? { et: E.E.PIERRE, n: 2 } : { et: E.E.JETON, n: special };
      }
    }
    return g;
  }

  update(tmod) {
    if (this.fini) return;
    if (this.jeu.step === E.ETAPE.JEU) this.heightTimer -= tmod;
    // La roue prend de la vitesse dès que le compte est écoulé, puis retombe.
    // C'est elle qu'on entend monter avant que le sol ne bouge.
    if (this.heightTimer < 0) this.wSpeed += 1 * tmod;
    if (this.wSpeed > 0.1) {
      this.wSpeed *= Math.pow(0.95, tmod);
      // Les six roues, chacune à son rapport. Celles de devant tournent plus
      // vite que le treuil, celles du fond à contresens : c'est ce désaccord
      // qui donne l'impression d'un mécanisme, et non d'un décor qui pivote.
      const r = this.rotations;
      r[0] += this.wSpeed; r[1] += this.wSpeed * 2; r[2] -= this.wSpeed * 2;
      r[3] -= this.wSpeed * 0.66; r[4] -= this.wSpeed * 1.25; r[5] += this.wSpeed * 2;
    }
    super.update(tmod);
  }

  /**
   * L'ASCENSEUR. Quand la roue a assez tourné, tout ce qui est sur la grille
   * remonte d'une ligne et la grille perd sa dernière : le plafond ne bouge
   * pas, c'est le plancher qui monte. On finit par ne plus avoir la place de
   * poser une pièce.
   */
  surNouveauTour() {
    if (!(this.heightTimer <= 0 && this.wSpeed > 8)) return;
    this.heightTimer = this.heightCycle;
    const jeu = this.jeu;
    for (let x = 0; x < jeu.xMax; x++) {
      for (let y = 0; y < jeu.yMax; y++) {
        const e = jeu.grille[x][y];
        if (!e) continue;
        jeu.retirerDeLaGrille(e);
        e.py--;
        jeu.insererDansGrille(e);
      }
    }
    jeu.yMax--;
    this.evenement('ascenseur', { yMax: jeu.yMax });
  }

  // Un niveau vidé n'arrête pas la partie : il en ouvre un autre, sur la même
  // fée et le même souffle.
  surFinDePartie(d) {
    if (!d.gagne) { this.fini = true; this.gagne = false; return; }
    if (this.level >= DONJON_NIVEAUX - 1) {
      this.donnerExp(100 * this.difficulte);
      this.gagnerLeDonjon();
      this.fini = true;
      this.gagne = true;
      return;
    }
    this.level++;
    this.donnerExp(this.level * (this.difficulte + 1));
    this.evenement('niveauDonjon', { niveau: this.level });
    // On rejoue, en gardant la fée telle qu'elle est sortie du niveau.
    const fee = this.champ.faerieList[0];
    this.fee = fee ? fee.fi.fs : this.fee;
    this.graine = this.graine + 1;
    this.commencer();
  }

  /**
   * Cm.winDungeon — ce que le donjon change dans la fiche.
   *
   * Le deuxième rang libère Ornegon, le cinquième fait apparaître un
   * arc-en-ciel et relance la boucle. Le diamant n'est donné qu'au PREMIER
   * tour : les suivants ne rapportent plus que le plaisir.
   */
  gagnerLeDonjon() {
    const c = this.carte;
    if (!c) return null;
    const d = c.$dungeon;
    const gains = { diamant: null, ornegon: false, arcEnCiel: false };
    if (nombre(d.$lvl) === 4) {
      if (c.$rainbow.$day === null || c.$rainbow.$day === undefined) {
        c.$rainbow.$day = 0;
        c.$rainbow.$f = true;
        c.$rainbow.$it = (sousNode ? require('./nuit.js') : racine.MinipixizNuit)
          .objetArcEnCiel(c, (n) => Math.floor(this.jeu.rng() * n));
        gains.arcEnCiel = true;
      }
      d.$loop = nombre(d.$loop) + 1;
    }
    if (nombre(d.$lvl) === 2 && !c.$frog) { c.$frog = true; gains.ornegon = true; }
    if (nombre(d.$loop) === 0) gains.diamant = nombre(d.$lvl);

    d.$lvl = (nombre(d.$lvl) + 1) % 5;
    d.$f = false;
    d.$day = nombre(c.$time.$d);
    c.$diam = Math.max(nombre(c.$diam), nombre(d.$lvl));
    this.evenement('donjonGagne', gains);
    return gains;
  }

  etat() {
    return Object.assign(super.etat(), {
      rang: this.difficulte,
      sur: DONJON_NIVEAUX,
      roue: this.wSpeed,
      montee: Math.max(0, this.heightTimer),
      lignes: this.jeu.yMax,
      // `elevator._y = game.getY(game.yMax)` : le plancher est à la première
      // ligne PERDUE, pas à la dernière jouable.
      ascenseur: this.jeu.posY(this.jeu.yMax),
      rotations: this.rotations,
    });
  }
}

// ══════════════════════════════════════════════════════════════════════════
//  base/Tree.mt — l'arbre creux
// ══════════════════════════════════════════════════════════════════════════
//
// Le mode sans fin : on joue pour le score, et le score seul. Un escargot monte
// le long du tronc pour dire où en est le chronomètre ; à chaque tour complet
// la chute accélère, et de temps en temps le jeu ajoute une couleur ET un
// multiplicateur d'un coup — ce qui rend la partie plus dure et plus rentable
// en même temps.
const ARBRE_TEMPS = 1000;                    // TIME_LIMIT
const ARBRE_VITESSES = [0.15, 0.35, 0.5];    // SPEED_LIMIT, par nombre de couleurs
const ARBRE_VALEURS = [1, 5, 7, 8, 9, 10];   // VALUE_LIMIT, par rang de maillon
const FRUIT_ELASTIQUE = 40;                  // au-delà, l'élastique rappelle le fruit
const FRICT = 0.95;                          // Cs.frict, le frottement de tout ce qui vole

class Arbre extends Lieu {
  get cadre() { return 'cadreArbre'; }

  // base/Tree.initGame n'appelle PAS initFaerie : l'arbre creux est le seul
  // lieu où l'on joue sans fée. Pas de sorts, pas de démons, pas de portrait —
  // le tronc, l'escargot et le score.
  emmeneLaFee() { return false; }

  /**
   * base/Tree.initNextPiece — l'arbre montre TOUJOURS trois pièces à venir.
   *
   * Il se sert d'un `inter.Face` dont `supaMorph()` efface le cadre pour ne
   * garder que la colonne, agrandie d'un cinquième (`height*1.2` = 84) et posée
   * en (132+4+68, 4+4). C'est le seul mode où la fée n'a pas son mot à dire :
   * ici on voit venir, quelle que soit sa concentration — et pour cause, elle
   * n'est pas du voyage.
   */
  get colonneSuivantes() {
    return { x: 204, y: 8, echelle: 0.84, image: 4, nombre: 3 };
  }

  constructor(o) {
    super(o);
    const c = (o || {}).carte;
    if (c) c.$stat.$game[4] = nombre(c.$stat.$game[4]) + 1;
  }

  options() {
    return {
      // L'aire est décalée à droite : la colonne de gauche porte le tronc et
      // l'escargot.
      margeGauche: 48,
      largeur: 196,
      hauteur: 240,
      vitesse: 0.03,
      monteeAuto: false,
      grille: null,
      // base/Tree.onNewTurn n'appelle PAS updatecolorList : ici une couleur ne
      // sort jamais du tirage, et vider la grille ne gagne rien. Il n'y a rien
      // à gagner — on joue jusqu'à déborder.
      couleursSeVident: false,
    };
  }

  commencer() {
    super.commencer();
    this.timer = 0;
    this.multi = 1;
    this.score = 0;
    this.fruits = [];
    this.blinder();
  }

  /**
   * base/Tree.multiUp — un fruit de plus pend du haut de l'écran.
   *
   * Ils ne sont pas posés : ils TOMBENT depuis y = −60, et un élastique les
   * rappelle dès qu'ils s'éloignent de plus de quarante pixels de leur point
   * d'accroche. Le dernier de la grappe pend à −60, les autres sont tirés vers
   * −240, si bien que la grappe s'étire vers le haut à mesure qu'elle grandit.
   */
  ajouterFruit() {
    this.fruits.push({
      x: 20 + (this.jeu.hasard(1e6) / 1e6) * 10, y: -60,
      vitx: 0, vity: 0, vitr: 0, rot: ((this.jeu.hasard(1e6) / 1e6) * 2 - 1) * 90,
      image: Math.min(this.multi, 4),
    });
  }

  bougerFruits(tmod) {
    const f = this.fruits || [];
    for (let i = 0; i < f.length; i++) {
      const p = f[i];
      const at = (i < f.length - 1) ? { x: 22, y: -240 } : { x: 22, y: -60 };
      const dx = at.x - p.x, dy = at.y - p.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > FRUIT_ELASTIQUE) {
        const c = (dist - FRUIT_ELASTIQUE) / FRUIT_ELASTIQUE;
        const a = Math.atan2(dy, dx);
        p.vitx += Math.cos(a) * c;
        p.vity += Math.sin(a) * c;
      }
      // Le fruit se redresse : sa rotation le freine d'autant plus qu'il penche.
      p.vitr -= Math.max(-0.5, Math.min(p.rot * 0.05, 0.5)) * tmod;
      p.vity += tmod;                  // flGrav, weight = 1
      p.vitx *= FRICT; p.vity *= FRICT; p.vitr *= FRICT;
      p.x += p.vitx * tmod;
      p.y += p.vity * tmod;
      p.rot += p.vitr * tmod;
    }
  }

  /**
   * base/Tree.newPieceListElement — une bille sur huit porte une armure.
   *
   * On repasse sur la réserve après coup : le moteur ne sait pas faire cette
   * retouche, et c'est plus honnête que de lui apprendre une règle qui n'est
   * vraie qu'ici.
   */
  blinder() {
    for (const forme of this.jeu.nextList) {
      for (const o of forme) {
        if (o.e.et !== E.E.JETON || o.e.special !== 0) continue;
        if (this.jeu.hasard(8) === 0) o.e.setSpecial(E.SPECIAL.ARMURE);
      }
    }
  }

  update(tmod) {
    if (this.fini) return;
    const jeu = this.jeu;
    if (jeu.step === E.ETAPE.JEU) {
      this.timer += tmod;
      if (this.timer > ARBRE_TEMPS) {
        this.timer -= ARBRE_TEMPS;
        jeu.pSpeed += 0.05;
        // Le palier : quand la chute dépasse la limite de son nombre de
        // couleurs, on gagne un multiplicateur, une couleur, et la vitesse
        // repart d'en bas. C'est le seul répit du mode.
        const lim = ARBRE_VITESSES[jeu.colorList.length - 3];
        if (lim !== undefined && jeu.pSpeed > lim && jeu.colorList.length < 6) {
          this.multi++;
          this.ajouterFruit();
          jeu.colorList.push(jeu.colorList.length);
          jeu.pSpeed = jeu.colorList.length * 0.01;
          jeu.viderReserve();
          this.blinder();
          this.evenement('multiplicateur', { multi: this.multi, couleurs: jeu.colorList.length });
        }
      }
    }
    this.bougerFruits(tmod);
    const avant = jeu.nextList.length;
    super.update(tmod);
    if (jeu.nextList.length > avant) this.blinder();
  }

  /**
   * base/Tree.onFallStats — le score de l'arbre.
   *
   * Un maillon de rang n vaut VALUE_LIMIT[n] par bille, et non n+1 comme en
   * forêt : la cinquième réaction en chaîne rapporte dix fois la première. Tout
   * le mode tient dans cet écart — on ne joue pas pour poser des pièces, on
   * joue pour déclencher des cascades.
   */
  surScore(d) {
    let somme = 0;
    const liste = d.liste || [];
    for (let i = 0; i < liste.length; i++) {
      somme += liste[i] * ARBRE_VALEURS[Math.min(i, 5)] * this.multi;
    }
    this.score += somme;
    this.evenement('scoreArbre', { gagne: somme, score: this.score, multi: this.multi });
  }

  // Le record entre dans la fiche : c'est la seule trace que l'arbre laisse.
  surFinDePartie(d) {
    super.surFinDePartie(d);
    if (!this.carte) return;
    if (this.score > nombre(this.carte.$stat.$treeMax)) {
      this.carte.$stat.$treeMax = this.score;
      this.evenement('record', { score: this.score });
    }
  }

  // L'escargot : sa hauteur DIT le chronomètre. Il grimpe de 240 à 20.
  hauteurEscargot() { return 240 - (this.timer / ARBRE_TEMPS) * 220; }

  etat() {
    return Object.assign(super.etat(), {
      score: this.score, multi: this.multi,
      escargot: this.hauteurEscargot(),
      fruits: this.fruits || [],
      couleurs: this.jeu.colorList.length,
    });
  }
}

// ══════════════════════════════════════════════════════════════════════════
//  base/Rainbow.mt — l'arc-en-ciel
// ══════════════════════════════════════════════════════════════════════════
//
// Le seul mode qu'on ne gagne pas en jouant bien : on le gagne en TENANT. Une
// roue de cent crans perd un cran et demi à chaque pièce posée ; il faut donc
// en poser quatre-vingt-sept sans déborder. Et pour compliquer, les huit
// couleurs sont là d'entrée.
const ROUE_DEPART = 100;
const ROUE_PAS = 1.15;

class ArcEnCiel extends Lieu {
  get cadre() { return 'cadreArcEnCiel'; }
  // base/Rainbow.initFaerieInterface : les nuages.
  get peau() { return 3; }

  constructor(o) {
    super(o);
    const c = (o || {}).carte;
    if (c) c.$stat.$game[3] = nombre(c.$stat.$game[3]) + 1;
  }

  options() {
    return {
      largeur: 132,
      hauteur: 226,
      couleurs: 8,
      grille: null,
      // Comme l'arbre : la grille de départ est vide, et la vider ne gagne
      // rien. Ce qui compte, c'est la roue.
      couleursSeVident: false,
      vitesse: 0.03 + this.level * 0.001,
    };
  }

  commencer() {
    super.commencer();
    this.roue = ROUE_DEPART;
    this.prix = (this.carte && this.carte.$rainbow) ? this.carte.$rainbow.$it : null;
    this.recolte = false;
  }

  surNouveauTour() {
    if (this.recolte) return;
    this.roue = Math.max(0, this.roue - ROUE_PAS);
    this.evenement('roue', { roue: this.roue });
    if (this.roue > 0) return;
    // Le compte est bon. Le puzzle s'arrête et l'objet est à nous.
    this.jeu.step = E.ETAPE.FIGE;
    this.jeu.piece = null;
    this.recolte = true;
    this.donnerExp(100);
    this.recolter();
  }

  /**
   * base/Rainbow.initStep(22) — on empoche, et l'arc-en-ciel s'efface du ciel
   * pour de bon. Un seul objet par arc-en-ciel, et il faut le mériter.
   */
  recolter() {
    const c = this.carte;
    let ou = 'perdu';
    if (c && this.prix !== null && this.prix !== undefined) {
      ou = P.ramasser(c, this.prix);
      c.$rainbow.$day = 0;
      c.$rainbow.$f = false;
    }
    this.fini = true;
    this.gagne = true;
    this.evenement('prix', { objet: this.prix, ou });
    return ou;
  }

  etat() {
    return Object.assign(super.etat(), {
      roue: this.roue,
      tours: Math.ceil(this.roue / ROUE_PAS),
      prix: this.prix,
      recolte: this.recolte,
    });
  }
}

const API = {
  Lieu, Donjon, Arbre, ArcEnCiel,
  DONJON_NIVEAUX, ARBRE_TEMPS, ARBRE_VITESSES, ARBRE_VALEURS, ROUE_DEPART, ROUE_PAS,
};

if (typeof module !== 'undefined' && module.exports) module.exports = API;
else racine.MinipixizLieux = API;

})(typeof window !== 'undefined' ? window : globalThis);
