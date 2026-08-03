/*
 * Minipixiz (miniTroll) — les sorts.
 *
 * Traduction de Spell.mt et de spell/*.mt (spell/Base, les dix-sept sorts de
 * fée, les huit tirs). C'est le plus gros morceau du jeu après le puzzle
 * lui-même, et c'est lui qui donne un sens à la fée : sans sorts elle ne fait
 * que voler.
 *
 * ── Quand un sort part ──
 *
 * Jamais quand la fée veut. Le joueur APPELLE (Game.callHelp, la touche
 * d'aide), ce qui lève `flAide` ; à la fin du tour en cours — la cascade close,
 * juste avant la pièce suivante — le jeu demande à chaque fée de choisir UN
 * sort (Game.initSpell → Faerie.checkSpell), puis rabaisse le drapeau. Une
 * pression, un sort. C'est ce rythme qui fait tout l'équilibre : appeler coûte
 * du mana et un tour d'attention.
 *
 * ── Comment elle choisit ──
 *
 * Chaque sort sait dire ce qu'il VAUT dans la position actuelle
 * (`pertinence`) : combien de billes il ferait sauter, combien de démons il
 * bannirait, ce que la grille y gagnerait. On divise par le coût en mana, on
 * multiplie par le goût de la fée pour ce sort ($spellCoef), on trie, et on
 * pioche d'autant plus près de la tête que la fée est INTELLIGENTE :
 *
 *     index = plancher( hasard × longueur / intelligence )
 *
 * Une fée bête lance n'importe quoi, une fée brillante lance le bon sort. C'est
 * la seule différence entre les deux, et elle suffit.
 *
 * ── Ce que « pertinence » a le droit de faire ──
 *
 * Simuler, jamais toucher. Les sorts qui rangent la grille (le Schème, le
 * Perce-Puits) travaillent sur le MODÈLE (jeu.modeleGrille) : une copie où ne
 * restent que les jetons groupables. Ils y essaient leur coup, comptent les
 * groupes qui sauteraient, et comparent au score de départ. La vraie grille
 * n'est touchée qu'au moment du lancer.
 *
 * ── Une prudence que Flash n'avait pas ──
 *
 * Dans ActionScript 2, lire ou écrire un champ d'un objet nul ne fait rien.
 * Plusieurs sorts en profitent : la Cloche déplace sa bulle à chaque image
 * alors qu'elle n'existe qu'à partir de sa troisième étape, le Météore lit la
 * pièce courante alors qu'il n'y en a pas pendant une cascade, l'Exaltation
 * décompte un chrono qui n'existe pas encore. Ici, ces mêmes lignes lèveraient
 * et emporteraient la partie : on garde donc le test, et seulement le test.
 */
'use strict';

(function (racine) {

const sousNode = (typeof module !== 'undefined' && module.exports);
const E = sousNode ? require('./engine.js') : racine.MinipixizEngine;
// combat.js et ce fichier se citent l'un l'autre — on résout à l'appel.
function combat() { return sousNode ? require('./combat.js') : racine.MinipixizCombat; }

const FORCE = 0, RAPIDITE = 1, INTELLIGENCE = 3, CONCENTRATION = 4;

const nombre = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
const borner = (a, v, b) => Math.min(Math.max(a, v), b);

/**
 * Spell.spellList — la table de tirage des parchemins et des grimoires.
 *
 *   freq  son poids dans le tirage (0 = jamais tiré : la Balle de lumière est
 *         donnée d'office, pas trouvée)
 *   min   le niveau de fée minimum
 *   lvl   le niveau de jeu minimum, pour l'objet qui l'enseigne
 *   cost  ce qu'il coûte en mana
 */
const TABLE = [
  { id: 1, freq: 500, min: 1, lvl: 20, cost: 2 },
  { id: 2, freq: 750, min: 0, lvl: 10, cost: 1 },
  { id: 3, freq: 200, min: 12, lvl: 80, cost: 6 },
  { id: 4, freq: 350, min: 3, lvl: 10, cost: 3 },
  { id: 5, freq: 100, min: 4, lvl: 40, cost: 4 },
  { id: 6, freq: 150, min: 4, lvl: 28, cost: 3 },
  { id: 7, freq: 800, min: 0, lvl: 15, cost: 1 },
  { id: 8, freq: 50, min: 6, lvl: 40, cost: 3 },
  { id: 9, freq: 300, min: 0, lvl: 10, cost: 2 },
  { id: 10, freq: 500, min: 1, lvl: 20, cost: 1 },
  { id: 11, freq: 100, min: 6, lvl: 40, cost: 7 },
  { id: 12, freq: 700, min: 0, lvl: 15, cost: 1 },
  { id: 13, freq: 20, min: 7, lvl: 25, cost: 5 },
  { id: 14, freq: 150, min: 8, lvl: 50, cost: 4 },
  { id: 15, freq: 300, min: 1, lvl: 25, cost: 3 },
  { id: 16, freq: 2, min: 14, lvl: 20, cost: 3 },
  { id: 20, freq: 0, min: 99, lvl: 10, cost: 1 },
  { id: 21, freq: 500, min: 0, lvl: 18, cost: 2 },
  { id: 22, freq: 400, min: 1, lvl: 22, cost: 3 },
  { id: 23, freq: 300, min: 2, lvl: 28, cost: 4 },
  { id: 24, freq: 50, min: 3, lvl: 36, cost: 5 },
  { id: 25, freq: 150, min: 4, lvl: 50, cost: 6 },
  { id: 26, freq: 300, min: 3, lvl: 30, cost: 8 },
  { id: 27, freq: 200, min: 3, lvl: 100, cost: 10 },
];

// ── spell/Base.mt ─────────────────────────────────────────────────────────
class Sort {
  constructor(champ) {
    this.champ = champ;
    this.jeu = champ ? champ.jeu : null;
    this.flLance = false;         // flCast — il a commencé
    this.flOccupe = false;        // flBusy — il est déjà dans la file
    this.flTir = false;           // flShoot — c'est un tir, pas un sort de tour
    this.cout = 0;
    this.sid = 0;
    this.fi = null;               // la fiche de la fée
    this.lanceur = null;          // la voltigeuse
    this.step = 0;
    // `null` et non zéro : un sort qui compte à rebours est dans sList dès
    // qu'on le range, donc son `update` tourne AVANT son premier initStep. Dans
    // ActionScript, `undefined - 1` donnait NaN et la comparaison était fausse ;
    // ici il faut le dire.
    this.timer = null;
  }

  hasard(n) { return this.jeu.hasard(n); }
  alea() { return this.jeu.rng(); }

  // store : le sort entre dans la file. sList le fait vivre à chaque image,
  // saList lui donne la main sur la partie.
  ranger() {
    this.jeu.saList.push(this);
    this.jeu.sList.push(this);
    this.flOccupe = true;
  }

  // cast : le mana part MAINTENANT, et un sort déjà en cours chez la même fée
  // est interrompu net.
  lancer() {
    this.flLance = true;
    this.lanceur.incMana(-this.cout);
    if (this.lanceur.sortEnCours) this.lanceur.sortEnCours.arretUrgence();
    this.lanceur.sortEnCours = this;
    this.initStep(0);
  }

  initStep(n) { this.step = n; }
  update() {}
  updateActif() {}
  pertinence() { return 1; }

  disponible() { return nombre(this.fi.fs.$mana) >= this.cout && !this.flOccupe; }

  dissiper() {
    if (this.lanceur && this.lanceur.sortEnCours === this) this.lanceur.sortEnCours = null;
    this.flOccupe = false;
    const i = this.jeu.sList.indexOf(this);
    if (i >= 0) this.jeu.sList.splice(i, 1);
  }

  // endActive : il rend la main au puzzle. Son effet, lui, peut continuer —
  // c'est le cas de l'Exaltation et de la Dactylo, qui restent dans sList.
  finActif() {
    this.champ.evenement('reaction', { genre: 'sortReussi', sort: this.nom() });
    this.flLance = false;
    const i = this.jeu.saList.indexOf(this);
    if (i >= 0) this.jeu.saList.splice(i, 1);
  }

  toutFinir() {
    if (this.lanceur) { this.lanceur.flForceWay = false; this.lanceur.trg = null; }
    this.finActif();
    this.dissiper();
  }

  arretUrgence() { this.toutFinir(); }
  surEntretien() {}

  nom() { return 'sort'; }
  description() { return ''; }

  trierParScore(r) { r.sort((a, b) => b.score - a.score); }

  // ── Les outils du lanceur ──
  ralentirLanceur(c, tmod) {
    const f = Math.pow(c, tmod);
    this.lanceur.vitx *= f;
    this.lanceur.vity *= f;
  }

  centrerLanceur() { this.lanceurVers(this.jeu.largeur * 0.5, this.jeu.hauteur * 0.5); }

  lanceurVers(x, y) {
    this.lanceur.trg = { x, y };
    this.lanceur.flForceWay = true;
  }

  lanceurPret(lim) {
    const l = (lim === undefined) ? 6 : lim;
    return this.lanceur.trg ? this.lanceur.distance(this.lanceur.trg) < l : false;
  }

  /**
   * getRemoveValue — ce que vaut la disparition d'un élément. C'est l'unité de
   * compte de toute la magie : une bille ordinaire vaut un demi-point, une
   * cellule d'impy de rang 4 en vaut onze. Les sorts s'en servent pour comparer
   * des coups qui n'ont rien à voir entre eux.
   */
  valeurRetrait(e) {
    switch (e.et) {
      case E.E.JETON:
        if (e.special === 0) return 0.5;
        if (e.special === 1) return 0.6;
        if (e.special === 2) return 0.85;
        return 0;                              // l'étoile : Flash renvoyait null
      case E.E.PIERRE: return e.life * 0.4;
      case E.E.CELLULE: return Math.pow(e.level + 1, 1.5);
      case E.E.BOMBE: return 0.9;
      case E.E.OBJET: return 0;
      case E.E.OEIL: return 1;
      default: return 0;
    }
  }

  nouvelleOnde() {
    const p = this.champ.nouvellePart('partLightCircle');
    p.x = this.lanceur.x;
    p.y = this.lanceur.y;
    p.timer = 16;
    p.vits = 30;
    p.echelle = 6;
    p.fondu = [1];
    p.init();
    return p;
  }
}

// ── spell/Shot.mt ─────────────────────────────────────────────────────────
//
// Un tir n'est pas un sort de tour : il n'entre jamais dans la file. La fée
// garde le plus cher qu'elle peut payer (getBestShotAvailable) et le laisse
// tirer tout seul pendant le combat.
class Tir extends Sort {
  constructor(champ) {
    super(champ);
    this.flTir = true;
    this.freq = 100;
    this.cd = 0;
    this.cdMax = 20;
    this.zoneMin = 40;
  }

  update(tmod) {
    if (this.cd < 0) {
      if (this.hasard(Math.max(1, Math.floor(this.freq / tmod))) === 0) {
        this.tirer();
        this.cd = this.cdMax;
      }
    } else {
      this.cd -= tmod;
    }
  }

  tirer() {}

  // Un tir de fée vise TOUS les impys à la fois : le premier touché encaisse.
  nouveauTir(lien) {
    const C = combat();
    const s = new C.Tir(this.champ, lien);
    s.x = this.lanceur.x;
    s.y = this.lanceur.y;
    s.lanceur = this.lanceur;
    s.sort = this;
    s.ajouterA(this.champ.shotList);
    for (const imp of this.champ.impList) s.cibles.push(imp);
    return s;
  }

  toucherCible() {}
  declencher() {}
}

// ── 20 · Balles de lumière ────────────────────────────────────────────────
// Le tir de départ : toute fée l'a ($spell commence par [20, 0]).
class TirBilles extends Tir {
  constructor(c) { super(c); this.cout = 1; this.freq = 5; this.cdMax = 20; }
  tirer() {
    const s = this.nouveauTir('shotLightBall');
    s.degats = 15;
    s.ray = 4;
    s.init();
    s.initDirect(4);
  }
  nom() { return 'Balles de lumières'; }
  description() { return 'Elles permettent aux fées de se défendre contre les démons.'; }
}

// ── 21 · Théo laser ───────────────────────────────────────────────────────
class TirLaser extends Tir {
  constructor(c) { super(c); this.cout = 2; this.freq = 20; this.cdMax = 8; }
  tirer() {
    const s = this.nouveauTir('shotLightBeam');
    s.degats = 15;
    s.ray = 2;
    s.init();
    s.initDirect(6);
    s.orienter();
  }
  nom() { return 'Théo laser'; }
  description() { return 'Ce tir rapide permet de toucher les démons les plus nerveux.'; }
}

// ── 22 · Solero shot ──────────────────────────────────────────────────────
class TirSolero extends Tir {
  constructor(c) { super(c); this.cout = 3; this.freq = 1; this.cdMax = 30; }
  tirer() {
    const s = this.nouveauTir('shotSolero');
    s.degats = 35;
    s.ray = 5;
    s.init();
    s.initDirect(4.5);
    s.orienter();
  }
  nom() { return 'Solero shot'; }
  description() { return 'Tir efficace bien que vert.'; }
}

// ── 23 · Mèches fantômes ──────────────────────────────────────────────────
class TirMeches extends Tir {
  constructor(c) { super(c); this.cout = 4; this.freq = 60; this.cdMax = 4; }
  tirer() {
    for (let i = 0; i < 3; i++) {
      const s = this.nouveauTir('shotWisp');
      s.degats = 8;
      s.ray = 3;
      s.init();
      s.initPoursuite(4, 0.4, 0.08, 0);
      s.initTrainee('partQueueStandard');
      s.angle_ += (i - 1) * 0.6;
      s.majVitesse();
    }
  }
  nom() { return 'Mèches fantômes'; }
  description() { return 'Les mèches poursuivent votre ennemi, mais elles ne sont pas très puissantes.'; }
}

// ── 24 · Glumelle ─────────────────────────────────────────────────────────
// Elle ne tue pas : elle ENGLUE. Un impy touché perd la moitié de sa cadence de
// tir et un tiers de sa vitesse — c'est le seul tir qui affaiblit durablement.
class TirGlumelle extends Tir {
  constructor(c) { super(c); this.cout = 5; this.freq = 50; this.cdMax = 12; }
  tirer() {
    const C = combat();
    const s = this.nouveauTir('shotGlue');
    s.degats = 32;
    s.ray = 10;
    s.recul = 3;
    s.echelle = 0;
    s.init();
    s.initDirect(2);
    s.types.push(C.T.APPARITION);
    s.initPalpite(20, 36, -0.6);
    s.palpite.dec = 314;
    s.orienter();
  }
  toucherCible(trg, shot) {
    trg.speed *= 0.6;
    trg.freqShoot = Math.ceil(Math.max(trg.freqShoot * 0.5, 1));
    trg.melange = { prc: 50, couleur: 0xDDDD00 };
    const cx = (trg.x + shot.x) * 0.5;
    const cy = (trg.y + shot.y) * 0.5;
    for (let i = 0; i < 12; i++) {
      const p = this.champ.nouvellePart('partGlue');
      const a = this.alea() * 6.28;
      const sp = 1 + this.alea() * 3;
      const ca = Math.cos(a), sa = Math.sin(a);
      p.x = cx + ca * sp * 2;
      p.y = cy + sa * sp * 2;
      p.vitx = ca * sp;
      p.vity = sa * sp;
      p.timer = 2 + this.alea() * 10;
      p.echelle = 100 + (this.alea() * 2 - 1) * 50;
      p.init();
      p.orienter();
    }
  }
  nom() { return 'Glumelle'; }
  description() { return 'La glumelle ralentit les démons touchés.'; }
}

// ── 25 · Clametorche ──────────────────────────────────────────────────────
// À très courte portée : la fée COLLE au démon le plus proche (zoneMin = 0) et
// crache des boules qui retombent en flammes.
class TirClametorche extends Tir {
  constructor(c) {
    super(c);
    this.cout = 6; this.freq = 1; this.cdMax = 0; this.zoneMin = 0; this.trg = null;
  }
  update(tmod) {
    super.update(tmod);
    let r = 70;
    this.trg = null;
    for (const imp of this.champ.impList) {
      const dist = this.lanceur.distance(imp);
      if (dist < r) { r = dist; this.trg = imp; }
    }
    if (this.trg) this.lanceur.trg = this.trg;
  }
  tirer() {
    if (!this.trg) return;
    const s = this.nouveauTir('partFlameBall');
    s.degats = 2.2;
    s.ray = 5;
    s.recul = 0;
    s.initDeclencheur(12);
    s.initDirect(4);
    s.friction = 1.05;
    s.init();
    s.angle_ = s.angle(this.trg);
    s.majVitesse();
  }
  declencher(shot) {
    shot.poids = -(0.6 + this.alea() * 1.5);
    shot.cibles = [];
    shot.vitx *= 0.6;
    shot.vity *= 0.6;
    shot.flGrav = true;
    shot.fondu = [3, 1];
    shot.timer = 4 + this.alea() * 10;
  }
  nom() { return 'Clametorche'; }
  description() { return 'C\'est une arme redoutable malgré sa courte portée.'; }
}

// ── 26 · Damaïdes ─────────────────────────────────────────────────────────
class TirDamaide extends Tir {
  constructor(c) { super(c); this.cout = 8; this.freq = 1; this.cdMax = 80; this.zoneMin = 60; }
  tirer() {
    const C = combat();
    const s = this.nouveauTir('shotHolyBall');
    s.degats = 80;
    s.ray = 10;
    s.recul = 8;
    s.initDirect(4);
    s.friction = 1.01;
    s.types.push(C.T.FLOT);
    s.init();
  }
  nom() { return 'Damaïdes'; }
  description() { return 'Ce sont de puissantes vagues d\'énergie qui détruisent tout sur leur passage.'; }
}

// ── 27 · Âme en peine ─────────────────────────────────────────────────────
class TirAmeEnPeine extends Tir {
  constructor(c) { super(c); this.cout = 10; this.freq = 50; this.cdMax = 10; }
  tirer() {
    const C = combat();
    const s = this.nouveauTir('shotPhantom');
    s.degats = 40;
    s.ray = 8;
    s.initPoursuite(3, 0.4, 0.25, 0);
    s.initTrainee('partQueuePhantom');
    s.types.push(C.T.SPHERE);
    s.init();
  }
  nom() { return 'Âme en peine'; }
  description() { return 'Elle poursuit sa victime jusqu\'à ce que celle-ci soit vidée de sa substance vitale.'; }
}

// ── 0 · Schème de Dimitri ─────────────────────────────────────────────────
//
// Le sort le plus intelligent du jeu : il essaie CHAQUE échange horizontal
// possible sur le modèle, garde ceux qui feraient sauter un groupe, et exécute
// le meilleur. C'est la seule magie qui ne détruit rien — elle range.
class SchemeDeDimitri extends Sort {
  constructor(c) { super(c); this.cout = 1; this.pair = null; this.best = null; this.decal = 0; }

  initStep(n) {
    this.step = n;
    if (n === 0) {
      this.choisirPaire();
      if (!this.pair) { this.toutFinir(); return; }
      this.lanceurVers(
        this.jeu.posX((this.pair[0].px + this.pair[1].px) * 0.5) + this.jeu.ts * 0.5,
        this.jeu.posY(this.pair[0].py) + this.jeu.ts * 0.5);
      this.timer = 100;
    } else if (n === 1) {
      for (let i = 0; i < 2; i++) {
        for (let m = 0; m < 3; m++) {
          const sp = this.champ.nouvellePart('partJet');
          sp.x = this.lanceur.trg.x;
          sp.y = this.lanceur.trg.y;
          sp.echelle = 50 + this.alea() * 40;
          sp.init();
          sp.rot = 20 * (this.alea() * 2 - 1) + (i * 2 - 1) * 90;
          sp.frame = this.hasard(4) + 1;
          sp.joue = true;
        }
      }
      for (const e of this.pair) e.isoler();
      this.lanceur.flForceWay = false;
      this.decal = 0;
    }
  }

  choisirPaire() {
    const best = this.meilleurResultat();
    this.pair = best
      ? [this.jeu.grille[best.x][best.y], this.jeu.grille[best.x + 1][best.y]]
      : null;
    if (this.pair && (!this.pair[0] || !this.pair[1])) this.pair = null;
  }

  resultats() {
    const liste = [];
    const gm = this.jeu.modeleGrille();
    const ref = this.jeu.scoreModele(this.jeu.evaluerModele(gm).gList);
    for (let x = 0; x < this.jeu.xMax; x++) {
      for (let y = 0; y < this.jeu.yMax; y++) {
        const e0 = gm[x][y];
        if (!e0) continue;
        const e1 = gm[x + 1] ? gm[x + 1][y] : null;
        if (!e1 || e0.t === e1.t) continue;
        // On repart d'un modèle NEUF : evaluerModele écrit les groupes dans les
        // unités, un modèle déjà évalué mentirait au coup suivant.
        const gMod = this.jeu.modeleGrille();
        const c0 = gMod[x][y];
        gMod[x][y] = gMod[x + 1][y];
        gMod[x + 1][y] = c0;
        const score = this.jeu.scoreModele(this.jeu.evaluerModele(gMod).gList) - ref;
        liste.push({ x, y, score });
      }
    }
    return liste;
  }

  // getBestResult : le tirage ne prend que les SEIZE meilleurs, et l'intelligence
  // resserre encore. Le +0,5 évite la division par zéro d'une fée sans esprit.
  meilleurResultat() {
    const r = this.resultats();
    this.trierParScore(r);
    if (r.length === 0) return null;
    const index = Math.floor((this.alea() * Math.min(16, r.length))
      / (nombre(this.fi.carac[INTELLIGENCE]) + 0.5));
    return r[Math.min(index, r.length - 1)] || null;
  }

  updateActif(tmod) {
    switch (this.step) {
      case 0:
        if (this.lanceur.distance(this.lanceur.trg) < 20) { this.initStep(1); break; }
        this.lanceur.etoiles(2, tmod);
        this.lanceur.vers(this.lanceur.trg, 0.1, tmod);
        break;
      case 1: {
        this.decal = Math.min(this.decal + 7 * tmod, 157);
        for (let i = 0; i < this.pair.length; i++) {
          const e = this.pair[i];
          const sens = i * 2 - 1;
          e.decalX = Math.sin((this.decal + 314 * i) / 100) * this.jeu.ts;
          e.eclat = 157 - this.decal;
          if (this.decal === 157) {
            this.jeu.retirerDeLaGrille(e);
            e.px -= sens;
            e.decalX = 0;
            e.eclat = 0;
          }
        }
        if (this.decal === 157) {
          for (const e of this.pair) this.jeu.insererDansGrille(e);
          this.finActif();
          this.dissiper();
        }
        this.lanceur.etoiles(0.2, tmod);
        break;
      }
      default: break;
    }
  }

  pertinence() {
    this.best = this.meilleurResultat();
    return this.best ? Math.max(0.001, this.best.score / 100) : 0;
  }

  nom() { return 'Schème de Dimitri'; }
  description() { return 'Échange deux billes adjacentes du niveau.'; }
}

// ── 1 · Perce-Puits ───────────────────────────────────────────────────────
//
// La fée pique et TRAVERSE une colonne, emportant tout ce qu'elle rencontre. Le
// choix de la colonne se fait au modèle : celle dont le vidage laisse la
// meilleure grille. Elle s'arrête à la première pierre, cellule ou bombe — et ne
// peut pas emporter plus de deux fois sa FORCE en éléments.
class PercePuits extends Sort {
  constructor(c) { super(c); this.cout = 1; this.best = null; this.destroyList = []; this.x = 0; }

  initStep(n) {
    this.step = n;
    const l = this.lanceur;
    if (n === 0) {
      if (!this.best || this.best.list.length === 0) { this.toutFinir(); return; }
      this.x = this.best.x;
      this.destroyList = this.best.list.slice();
      l.trg = { x: this.jeu.posX(this.x + 0.5), y: this.jeu.posY(this.destroyList[0].y) };
      l.flForceWay = true;
    } else if (n === 1) {
      l.vity += 16;
      l.trg = { x: this.jeu.posX(this.x + 0.5), y: this.jeu.posY(this.jeu.yMax) };
    } else if (n === 2) {
      l.vity -= 6;
      this.timer = 8;
    }
  }

  updateActif(tmod) {
    const l = this.lanceur;
    switch (this.step) {
      case 0: {
        l.etoiles(1.5, tmod);
        l.vers(l.trg, 0.1, tmod);
        const dx = Math.abs(l.trg.x - l.x);
        const dy = Math.abs(l.trg.y - l.y);
        if (dx < 2 && dy < 20) this.initStep(2);
        break;
      }
      case 1:
        l.vitx *= Math.pow(0.75, tmod);
        l.etoiles(3, tmod);
        l.vers(l.trg, 0.15, tmod);
        while (this.destroyList.length > 0
          && (this.destroyList[0].y - 1.5) * this.jeu.ts < l.y) {
          const e = this.destroyList.shift().e;
          e.exploser();
          this.jeu.retirerDeLaGrille(e);
          e.tuer();
        }
        if (this.destroyList.length === 0) {
          l.vity *= -0.8;
          this.toutFinir();
        }
        break;
      case 2:
        this.timer -= tmod;
        if (this.timer < 0) this.initStep(1);
        break;
      default: break;
    }
  }

  meilleursResultats() {
    const jeu = this.jeu;
    const gm = jeu.modeleGrille();
    const ref = jeu.scoreModele(jeu.evaluerModele(gm).gList);
    const result = [];
    const forceMax = Math.max(1, nombre(this.fi.carac[FORCE]) * 2);
    for (let x = 0; x < jeu.xMax; x++) {
      const gMod = jeu.modeleGrille();
      const list = [];
      for (let y = 0; y < jeu.yMax; y++) {
        if (!gMod[x][y]) continue;
        list.push({ y, e: jeu.grille[x][y] });
        gMod[x][y] = null;
        const dessous = jeu.element(x, y + 1);
        const bloque = dessous
          && (dessous.et === E.E.PIERRE || dessous.et === E.E.CELLULE || dessous.et === E.E.BOMBE);
        if (bloque || list.length >= forceMax) break;
      }
      let score = jeu.scoreModele(jeu.evaluerModele(gMod).gList) - ref;
      for (const o of list) score += this.valeurRetrait(o.e);
      result.push({ x, score, list });
    }
    this.trierParScore(result);
    const index = Math.floor(this.alea() * (result.length
      / Math.max(1, nombre(this.fi.carac[INTELLIGENCE]))));
    return result[Math.min(index, result.length - 1)];
  }

  pertinence() {
    this.best = this.meilleursResultats();
    return this.best ? this.best.score / 100 : 0;
  }

  nom() { return 'Perce-Puits'; }
  description() { return 'Détruit le sommet d\'une colonne de billes.'; }
}

// ── 2 · Dactylo ───────────────────────────────────────────────────────────
//
// Le seul sort qui agit sur les pièces À VENIR : elles auront une bille de
// moins. L'effet dure quatre pièces par point de concentration, puis se dissipe
// tout seul.
class Dactylo extends Sort {
  constructor(c) {
    super(c);
    this.cout = 2; this.bList = []; this.startPiece = null;
    this.decal = 0; this.dSpeed = 1; this.nStar = 0;
  }

  lancer() {
    this.startPiece = this.jeu.pieces;
    this.nStar = nombre(this.fi.carac[CONCENTRATION]);
    super.lancer();
  }

  update() {
    if (this.startPiece === null) return;
    if (this.jeu.pieces - this.startPiece > nombre(this.fi.carac[CONCENTRATION]) * 4) {
      this.dissiper();
    }
  }

  initStep(n) {
    this.step = n;
    if (n === 0) {
      this.bList = [];
      for (let i = 0; i < this.nStar; i++) {
        const p = this.champ.nouvellePart('partLightStar');
        p.x = this.lanceur.x;
        p.y = this.lanceur.y;
        p.init();
        this.bList.push(p);
      }
      this.decal = 0;
      this.dSpeed = 1;
    } else if (n === 1) {
      this.timer = 0;
    } else if (n === 2) {
      this.executer();
    }
  }

  updateActif(tmod) {
    this.ralentirLanceur(0.5, tmod);
    switch (this.step) {
      case 0: {
        this.decal = (this.decal + this.dSpeed * tmod) % 628;
        this.dSpeed *= 1.1;
        const sLim = 40;
        for (let i = 0; i < this.bList.length; i++) {
          const p = this.bList[i];
          const a = (this.decal / 100) - (i / this.bList.length) * 6.28;
          p.vers({ x: this.lanceur.x + Math.cos(a) * 30, y: this.lanceur.y + Math.sin(a) * 30 },
            0.2, tmod);
          if (this.dSpeed > sLim) {
            p.vitx += Math.cos(a + 1.2) * 10;
            p.vity += Math.sin(a + 1.2) * 10;
          }
        }
        if (this.dSpeed > sLim) this.initStep(1);
        break;
      }
      case 1: {
        this.timer += tmod;
        for (let i = 0; i < this.bList.length; i++) {
          const p = this.bList[i];
          for (let n = 0; n < 2; n++) {
            const part = this.champ.nouvellePart('partLightBall');
            const a = this.alea() * 6.28;
            part.x = p.x; part.y = p.y;
            part.vitx = Math.cos(a) * 2;
            part.vity = Math.sin(a) * 2;
            part.echelle = 30 + this.alea() * 50;
            part.poids = 0.1;
            part.flGrav = true;
            part.timer = 10 + this.alea() * 10;
            part.init();
          }
          if (this.timer > i * 2) {
            // Les étoiles montent se ranger dans le portrait de la fée : c'est
            // là que l'interface montre l'effet en cours.
            const trg = { x: this.jeu.largeur + 12, y: 10 + (i / this.bList.length) * 64 };
            p.versVitesse(trg, 0.01, 1, tmod);
            if (p.distance(trg) < 32) {
              p.vitx = 0; p.vity = 0;
              p.tuer();
              this.bList.splice(i--, 1);
              this.champ.evenement('portraitFlash', {});
            }
          }
        }
        if (this.bList.length === 0) { this.executer(); this.finActif(); }
        break;
      }
      default: break;
    }
  }

  executer() {
    this.jeu.shapeNumInc--;
    this.jeu.viderReserve();
    this.champ.evenement('effetPiece', { id: 0, actif: true });
  }

  dissiper() {
    if (this.flOccupe) {
      this.jeu.shapeNumInc++;
      this.jeu.viderReserve();
      this.champ.evenement('effetPiece', { id: 0, actif: false });
    }
    super.dissiper();
  }

  pertinence() { return this.alea() * nombre(this.fi.carac[CONCENTRATION]) * 2; }
  nom() { return 'Dactylo'; }
  description() { return 'Les prochaines pièces contiendront une bille de moins.'; }
}

// ── 3 · Météore ───────────────────────────────────────────────────────────
//
// La fée assemble un météore, l'emmène en haut, et la PIÈCE SUIVANTE brûle tout
// ce qu'elle touche en tombant. C'est le sort le plus destructeur du jeu, et le
// seul dont l'effet se joue pendant le tour d'après.
class Meteore extends Sort {
  constructor(c) {
    super(c);
    this.cout = 6; this.msList = []; this.m = null; this.flUsed = false; this.burnTimer = 100;
  }

  lancer() { this.flUsed = false; super.lancer(); }

  update() {
    if (this.jeu.step === E.ETAPE.JEU) {
      this.flUsed = true;
      const p = this.jeu.piece;
      if (!p) return;                   // Flash lisait un objet nul sans rien dire
      for (const o of p.list) {
        const px = o.x + p.x;
        const py = o.y + p.y;
        for (let n = 0; n < 2; n++) {
          const part = this.champ.nouvellePart('partFlameBall');
          const a = this.alea() * 6.28;
          part.x = this.jeu.posX(px + p.cx + 0.5 + Math.cos(a) * 0.5);
          part.y = this.jeu.posY(py + p.cy + 0.5 + Math.sin(a) * 0.5);
          part.echelle = 80 + this.alea() * 50;
          part.poids = -0.1 + this.alea() * 0.2;
          part.flGrav = true;
          part.timer = 10 + this.alea() * 10;
          part.init();
        }
        // La pièce POSÉE brûle ce qui est sous chacune de ses cases. `element`
        // plutôt que `!estLibre` : sous la dernière ligne il n'y a pas une case
        // occupée, il n'y a PAS de case — Flash y lisait un vide qu'il traitait
        // comme libre.
        const e = this.jeu.element(px, py + 1);
        if (p.flGround && e) {
          this.jeu.retirerDeLaGrille(e);
          e.exploser();
          e.tuer();
        }
      }
    } else if (this.flUsed) {
      this.dissiper();
    }
  }

  initStep(n) {
    this.step = n;
    if (n === 0) {
      this.m = this.champ.nouvellePart('partMeteore');
      this.m.x = this.lanceur.x;
      this.m.y = this.lanceur.y;
      this.m.echelle = 0;
      this.m.init();
      this.burnTimer = 100;
      this.msList = [];
    } else if (n === 1) {
      for (const p of this.msList) {
        p.timer = 10;
        p.poids = 0.1 + this.alea() * 0.3;
        p.flGrav = true;
      }
      this.lanceur.vity += 5;
      this.timer = 6;
    } else if (n === 2) {
      this.lanceurVers(this.m.x, -10);
    }
  }

  updateActif(tmod) {
    this.brulerMeteore(tmod);
    switch (this.step) {
      case 0: {
        this.ralentirLanceur(0.5, tmod);
        this.m.sx = this.m.echelle;
        this.m.sy = this.m.echelle;
        this.m.rot += 2 * tmod;
        this.m.versVitesse(this.lanceur, 0.001, 1, tmod);

        const ms = this.champ.nouvellePart('partMeteoreStone');
        const a = this.alea() * 6.28;
        ms.x = this.m.x + Math.cos(a) * 36;
        ms.y = this.m.y + Math.sin(a) * 36;
        ms.init();
        this.msList.push(ms);

        for (let i = 0; i < this.msList.length; i++) {
          const p = this.msList[i];
          const dist = p.distance(this.m);
          if (dist < 5) {
            p.tuer();
            this.msList.splice(i--, 1);
            this.m.echelle += 1.5;
          } else {
            p.vers(this.m, 0.1, tmod);
            p.echelle = borner(0, 1 - (dist / 36), 1) * 100;
            p.sx = p.echelle;
            p.sy = p.echelle;
          }
        }
        if (this.m.echelle > 100) this.initStep(1);
        break;
      }
      case 1:
        this.timer -= tmod;
        if (this.timer < 0) this.initStep(2);
        this.m.versVitesse(this.lanceur, 0.1, 1, tmod);
        break;
      case 2:
        this.m.vity -= 2 * tmod;
        this.lanceur.versVitesse(this.lanceur.trg, 0.2, 2, tmod);
        if (this.m.y < -100) {
          this.lanceur.flForceWay = false;
          this.m.tuer();
          this.finActif();
        }
        break;
      default: break;
    }
  }

  brulerMeteore(tmod) {
    this.burnTimer -= tmod * this.m.echelle;
    while (this.burnTimer < 0) {
      const part = this.champ.nouvellePart('partFlameBall');
      const a = this.alea() * 6.28;
      const d = this.alea() * (this.m.echelle / 100) * 18;
      part.x = this.m.x + Math.cos(a) * d;
      part.y = this.m.y + Math.sin(a) * d;
      part.echelle = 80 + this.alea() * 50;
      part.poids = -0.1 + this.alea() * 0.2;
      part.flGrav = true;
      part.timer = 10 + this.alea() * 10;
      part.init();
      this.burnTimer += 80;
    }
  }

  // Il cherche les DEUX puis TROIS colonnes les plus chargées : la pièce tombera
  // quelque part, autant que ce soit là où il y a le plus à brûler.
  pertinence() {
    let best0 = -1, best1 = -1;
    for (let x = 0; x < this.jeu.xMax; x++) {
      let n = 0, r0 = 0, r1 = 0;
      for (let dx = 0; dx < 3; dx++) {
        const px = x + dx;
        if (px < this.jeu.xMax) {
          for (let y = 0; y < this.jeu.yMax; y++) {
            const e = this.jeu.grille[px][y];
            if (e) n += this.valeurRetrait(e);
          }
        }
        if (dx === 1) r0 = n;
        if (dx === 2) r1 = n;
      }
      best0 = Math.max(r0, best0);
      best1 = Math.max(r1, best1);
    }
    return (best0 + best1) * 0.5;
  }

  nom() { return 'Météore'; }
  description() { return 'Transforme la prochaine pièce en un météore ardent destructeur.'; }
}

// ── 4 · Gobeur de perles ──────────────────────────────────────────────────
// Les perles noires appartiennent au groupe sans compter dedans : elles
// EMPÊCHENT les groupes de sauter. Ce sort les enlève toutes d'un coup.
class GobeurDePerles extends Sort {
  constructor(c) { super(c); this.cout = 2; this.perleList = []; this.pList = []; this.bs = null; }

  initStep(n) {
    this.step = n;
    if (n === 0) {
      this.centrerLanceur();
    } else if (n === 1) {
      this.bs = this.champ.nouvellePart('partMiniStar');
      this.bs.x = this.lanceur.x;
      this.bs.y = this.lanceur.y;
      this.bs.echelle = 1000;
      this.bs.alpha = 0;
      this.bs.init();
    } else if (n === 2) {
      this.pList = [];
      this.perleList = this.perles();
      for (const e of this.perleList) {
        e.setSpecial(0);
        const p = this.champ.nouvellePart('partMiniStar');
        p.x = this.jeu.posX(e.px + 0.5);
        p.y = this.jeu.posY(e.py + 0.5);
        p.ajouterA(this.pList);
        // L'original prend deux fois l'ANGLE — sa « distance » n'en est pas
        // une. On garde la bizarrerie : c'est elle qui donne aux perles leur
        // envol désordonné.
        const a = this.lanceur.angle(p);
        p.vitx = Math.cos(a) * (1 + a / 6);
        p.vity = Math.sin(a) * (1 + a / 6);
        p.timer = 20 + this.alea() * 10;
        p.init();
      }
    }
  }

  updateActif(tmod) {
    switch (this.step) {
      case 0:
        this.lanceur.etoiles(1.5, tmod);
        this.lanceur.vers(this.lanceur.trg, 0.1, tmod);
        if (this.lanceur.distance(this.lanceur.trg) < 10) this.initStep(1);
        break;
      case 1:
        this.bs.echelle *= Math.pow(0.7, tmod);
        this.bs.alpha = Math.min(this.bs.alpha + 10 * tmod, 100);
        this.bs.sx = this.bs.echelle;
        this.bs.sy = this.bs.echelle;
        this.bs.sa = this.bs.alpha;
        if (this.bs.echelle < 5) { this.bs.tuer(); this.initStep(2); }
        break;
      case 2:
        if (this.pList.length === 0) this.toutFinir();
        break;
      default: break;
    }
  }

  perles() {
    return this.jeu.eList.filter((e) => e.et === E.E.JETON && e.special === 1);
  }

  pertinence() { return Math.pow(this.perles().length, 1.3) * 0.25; }
  nom() { return 'Gobeur de perles'; }
  description() { return 'Détruit toutes les perles présentes dans les billes colorées.'; }
}

// ── 5 · Dépressurisation ──────────────────────────────────────────────────
// L'armure interdit à une bille de se grouper. Ce sort la retire partout.
class Depressurisation extends Sort {
  constructor(c) { super(c); this.cout = 4; this.aList = []; this.pList = []; this.cList = []; }

  initStep(n) {
    this.step = n;
    if (n === 0) {
      this.centrerLanceur();
    } else if (n === 1) {
      this.aList = this.armures();
      this.cList = [];
      for (let i = 0; i < this.aList.length; i++) {
        const p = this.champ.nouvellePart('partMiniCircle');
        const a = this.alea() * 6.28;
        const dist = 10 + this.alea() * 10;
        p.x = this.lanceur.x + Math.cos(a) * dist;
        p.y = this.lanceur.y + Math.sin(a) * dist;
        p.alpha = 0;
        p.init();
        p.ajouterA(this.cList);
      }
      this.timer = 30;
    } else if (n === 2) {
      for (const p of this.cList) { p.friction = 0.8; p.timer = 50; }
    } else if (n === 3) {
      this.pList = [];
      for (const e of this.aList) {
        e.setSpecial(0);
        const p = this.champ.nouvellePart('partMiniCircle');
        p.x = this.jeu.posX(e.px + 0.5);
        p.y = this.jeu.posY(e.py + 0.5);
        p.ajouterA(this.pList);
        p.timer = 8 + this.alea() * 3;
        p.echelle = 100;
        p.fondu = [1];
        p.init();
      }
    }
  }

  updateActif(tmod) {
    switch (this.step) {
      case 0:
        this.lanceur.etoiles(1.5, tmod);
        this.lanceur.vers(this.lanceur.trg, 0.1, tmod);
        if (this.lanceur.distance(this.lanceur.trg) < 10) this.initStep(1);
        break;
      case 1:
        for (const p of this.cList) {
          p.alpha = Math.min(p.alpha + 20 * tmod, 50);
          p.sa = p.alpha;
          p.versVitesse(this.lanceur, 0.1, 0.5, tmod);
        }
        this.timer -= tmod;
        if (this.timer < 0) this.initStep(2);
        break;
      case 2:
        for (let i = 0; i < this.cList.length; i++) {
          const e = this.aList[i];
          if (!e) continue;
          this.cList[i].versVitesse(
            { x: this.jeu.posX(e.px + 0.5), y: this.jeu.posY(e.py + 0.5) }, 0.1, 2, tmod);
        }
        if (this.cList.length === 0) this.initStep(3);
        break;
      case 3:
        for (const p of this.pList) {
          p.echelle *= 1.05;
          p.sx = p.echelle;
          p.sy = p.echelle;
        }
        if (this.pList.length === 0) this.toutFinir();
        break;
      default: break;
    }
  }

  armures() {
    return this.jeu.eList.filter((e) => e.et === E.E.JETON && e.special === 2);
  }

  pertinence() { return Math.pow(this.armures().length, 1.3) * 0.4; }
  nom() { return 'Dépressurisation'; }
  description() { return 'Retire l\'armure de toutes les billes colorées du niveau.'; }
}

// ── 6 · Valse Fossile ─────────────────────────────────────────────────────
//
// Elle choisit une COULEUR et la change entièrement en pierres. Sur une grille à
// trois couleurs, c'en supprime une du tirage : le niveau se termine d'autant
// plus vite — mais les pierres restent, et elles encombrent.
class ValseFossile extends Sort {
  constructor(c) { super(c); this.cout = 3; this.dList = []; this.tList = []; this.best = null; }

  initStep(n) {
    this.step = n;
    if (n === 0) {
      this.centrerLanceur();
      this.lanceur.spinSpeed = 0.6;
      this.timer = 6;
      this.dList = [];
      this.tList = this.best ? this.best.list.slice() : [];
    } else if (n === 1) {
      this.timer = 10;
    } else if (n === 2) {
      for (let i = 0; i < this.dList.length; i++) {
        const p = this.dList[i];
        const dist = p.distance(this.lanceur);
        // L'original mesure l'angle mais s'en sert comme d'une distance : on
        // garde le geste, la poussière part en spirale.
        const a = this.lanceur.distance(p);
        p.vitx = Math.cos(a) * dist * 0.5;
        p.vity = Math.sin(a) * dist * 0.5;
        if (i >= this.tList.length) p.timer = 10 + this.alea() * 10;
      }
    }
  }

  updateActif(tmod) {
    switch (this.step) {
      case 0:
        this.lanceur.spinSpeed = Math.min(this.lanceur.spinSpeed + 0.02 * tmod, 4);
        this.timer -= this.lanceur.spinSpeed;
        if (this.timer < 0) {
          if (this.dList.length === this.tList.length * 2) {
            if (this.lanceur.spinSpeed > 3) this.initStep(1);
          } else {
            this.timer = 6;
            const d = this.nouvellePoussiere();
            if (this.dList.length <= this.tList.length) {
              d.echelle = 150; d.sx = 150; d.sy = 150;
            }
          }
        }
        this.ralentirLanceur(0.5, tmod);
        this.bougerPoussiere(tmod);
        break;
      case 1:
        this.lanceur.spinSpeed *= Math.pow(1.1, tmod);
        this.timer -= tmod;
        if (this.timer < 0) this.initStep(2);
        break;
      case 2:
        for (let i = 0; i < this.tList.length; i++) {
          const e = this.tList[i];
          const p = this.dList[i];
          if (!p) continue;
          const trg = { x: this.jeu.posX(e.px + 0.5), y: this.jeu.posY(e.py + 0.5) };
          p.versVitesse(trg, 0.05, 2, tmod);
          if (p.distance(trg) >= 8) continue;
          const x = e.px, y = e.py;
          e.tuer();
          // `tuer` retire déjà la poussière de dList — la lister deux fois
          // décalerait les paires et laisserait des jetons sans grain.
          p.tuer();
          this.tList.splice(i--, 1);
          this.jeu.genElement(E.E.PIERRE, x, y, 2);
          const c = this.champ.nouvellePart('partStoneCrack');
          c.x = this.jeu.posX(x + 0.5);
          c.y = this.jeu.posY(y + 0.5);
          c.timer = 10;
          c.fondu = [1];
          c.rot = this.alea() * 360;
          c.echelle = this.jeu.ts;
          c.init();
        }
        if (this.lanceur.spinSpeed !== null) {
          if (this.lanceur.spinSpeed < 0.7) {
            if (Math.abs(this.lanceur.spinFrame - 10) < 5) this.lanceur.arreterTournoiement();
          } else {
            this.lanceur.spinSpeed *= 0.95;
          }
        } else if (this.tList.length === 0) {
          this.toutFinir();
        }
        break;
      default: break;
    }
  }

  // getBestResult : une couleur pleine d'armures est un meilleur choix qu'une
  // couleur ordinaire — on s'en débarrasse ET on retire les gêneuses.
  meilleurResultat() {
    const parType = [];
    for (const e of this.jeu.eList) {
      if (e.et !== E.E.JETON) continue;
      if (!parType[e.type]) parType[e.type] = { score: 0, list: [], type: e.type };
      const o = parType[e.type];
      if (e.special === 0) o.score += -0.5;
      else if (e.special === 2) o.score += 0.5;
      o.list.push(e);
    }
    const result = parType.filter(Boolean);
    this.trierParScore(result);
    if (result.length === 0) return null;
    const index = Math.floor(this.alea()
      * (result.length / Math.max(1, nombre(this.fi.carac[INTELLIGENCE]))));
    return result[Math.min(index, result.length - 1)];
  }

  bougerPoussiere(tmod) {
    for (const p of this.dList) {
      p.dx = (p.dx + p.dsx * this.lanceur.spinSpeed * tmod) % 628;
      p.dy = (p.dy + p.dsy * tmod) % 628;
      const ca = Math.cos(p.dx / 100);
      const sa = (p.dy / 628) * 2 - 1;
      p.versVitesse({
        x: this.lanceur.x + ca * (60 - Math.abs(sa) * 60),
        y: this.lanceur.y + sa * 20,
      }, 0.1, 2, tmod);
    }
  }

  nouvellePoussiere() {
    const p = this.champ.nouvellePart('partDust');
    p.x = this.alea() * this.jeu.largeur;
    p.y = this.alea() * this.jeu.hauteur;
    p.dx = this.alea() * 628;
    p.dy = this.alea() * 628;
    p.dsx = 20;
    p.dsy = 8;
    p.friction = 0.9;
    p.init();
    p.ajouterA(this.dList);
    return p;
  }

  pertinence() {
    this.best = this.meilleurResultat();
    if (!this.best) return 0;
    return Math.pow(this.jeu.colorList.length - 1, 2) + this.best.score;
  }

  nom() { return 'Valse Fossile'; }
  description() { return 'Élimine une couleur présente à l\'écran en la remplaçant par des pierres.'; }
}

// ── 7 · Ascension ─────────────────────────────────────────────────────────
// Elle prend la bille la plus haute d'une colonne et l'envoie au ciel. Simple,
// pas cher, et la fée le connaît presque toujours.
class Ascension extends Sort {
  constructor(c) {
    super(c);
    this.cout = 1; this.best = null; this.e = null; this.tube = null; this.vy = 0; this.ey = 0;
  }

  initStep(n) {
    this.step = n;
    if (n === 0) {
      if (!this.best) { this.toutFinir(); return; }
      this.e = this.best.e;
      this.e.isoler();
      this.jeu.retirerDeLaGrille(this.e);
      this.tube = this.champ.nouvellePart('partLightTube');
      this.tube.x = this.jeu.posX(this.e.px) + this.jeu.ts * 0.5;
      this.tube.y = this.jeu.posY(this.e.py) + this.jeu.ts;
      this.tube.init();
      this.tube.sy = this.tube.y;
      this.tube.sx = 0;
    } else if (n === 1) {
      this.vy = -0.5;
      this.ey = this.jeu.posY(this.e.py);
    }
  }

  updateActif(tmod) {
    switch (this.step) {
      case 0:
        this.tube.sx = Math.min(this.tube.sx + 10 * tmod, 100);
        if (this.tube.sx === 100) this.initStep(1);
        break;
      case 1: {
        this.vy *= Math.pow(1.1, tmod);
        this.ey += this.vy;
        this.e.decalY = this.ey - this.jeu.posY(this.e.py);
        if (this.ey < -20) { this.e.tuer(); this.initStep(2); break; }
        const p = this.champ.nouvellePart('partVertiLight');
        p.x = this.tube.x + (this.alea() * 2 - 1) * (this.jeu.ts * 0.5 - 4);
        p.y = this.tube.y - this.alea() * this.tube.sy;
        p.vity = -(2 + this.alea() * 10);
        p.timer = 10 + this.alea() * 20;
        p.init();
        break;
      }
      case 2:
        this.tube.sx = Math.max(this.tube.sx - 10 * tmod, 0);
        if (this.tube.sx === 0) { this.tube.tuer(); this.toutFinir(); }
        break;
      default: break;
    }
  }

  // Une bille haute vaut mieux qu'une bille basse : on ajoute 1 - y/yMax, ce qui
  // pousse la fée à décoiffer la pile plutôt qu'à creuser dedans.
  meilleurResultat() {
    const result = [];
    for (let x = 0; x < this.jeu.xMax; x++) {
      for (let y = 0; y < this.jeu.yMax; y++) {
        const e = this.jeu.grille[x][y];
        if (!e) continue;
        result.push({ e, score: this.valeurRetrait(e) + 1 - (y / this.jeu.yMax) });
        break;
      }
    }
    this.trierParScore(result);
    if (result.length === 0) return null;
    const index = Math.floor(this.alea()
      * (result.length / Math.max(1, nombre(this.fi.carac[INTELLIGENCE]))));
    return result[Math.min(index, result.length - 1)];
  }

  pertinence() {
    this.best = this.meilleurResultat();
    return this.best ? this.best.score : 0;
  }

  nom() { return 'Ascension'; }
  description() { return 'Élimine une bille haute en la projetant dans les cieux.'; }
}

// ── 8 · Exaltation ────────────────────────────────────────────────────────
// Quatre cents images de fureur : +5 en force, et vingt fois plus de charges. Le
// seul sort qui ne touche pas la grille — il transforme la fée.
class Exaltation extends Sort {
  static get MULTI() { return 20; }
  constructor(c) { super(c); this.cout = 3; }

  initStep(n) {
    this.step = n;
    if (n !== 0) return;
    this.champ.evenement('exaltation', { actif: true });
    this.lanceur.berserk = true;
    this.finActif();
    this.timer = 400;
    this.fi.carac[FORCE] = nombre(this.fi.carac[FORCE]) + 5;
    this.lanceur.freqDash *= Exaltation.MULTI;
  }

  update(tmod) {
    if (this.timer === null) return;
    this.timer -= tmod;
    if (this.timer < 0) this.dissiper();
  }

  dissiper() {
    if (this.flOccupe && this.timer !== null) {
      this.fi.carac[FORCE] = nombre(this.fi.carac[FORCE]) - 5;
      this.lanceur.freqDash = Math.floor(this.lanceur.freqDash / Exaltation.MULTI);
      this.lanceur.berserk = false;
      this.champ.evenement('exaltation', { actif: false });
    }
    super.dissiper();
  }

  pertinence() {
    let score = 0;
    for (const imp of this.champ.impList) score += Math.pow(imp.level + 1, 2);
    return score;
  }

  nom() { return 'Exaltation'; }
  description() { return 'Transforme votre fée en une impitoyable machine à tuer.'; }
}

// ── 9 · Tranche-Cimes ─────────────────────────────────────────────────────
// Un aller-retour d'un bord à l'autre, et tout ce qui dépasse tombe. La hauteur
// de coupe suit la concentration : 0,43 ligne par point.
class TrancheCimes extends Sort {
  constructor(c) { super(c); this.cout = 2; this.cutList = []; this.cy = 0; this.cutHeight = 0; }

  initStep(n) {
    this.step = n;
    if (n === 0) {
      this.lanceurVers(this.jeu.ts * 0.8, this.cy);
    } else if (n === 1) {
      this.lanceurVers(this.jeu.largeur - this.jeu.ts * 0.8, this.cy);
    } else if (n === 2) {
      const slash = this.champ.nouvellePart('partSlash');
      slash.x = 0;
      slash.y = this.cy;
      slash.fondu = [1];
      slash.timer = 10;
      slash.init();
      slash.sx = this.jeu.largeur;
      this.lanceur.flForceWay = false;
      for (const o of this.cutList) {
        o.vx = 0.5; o.vy = 0.5; o.timer = 18;
        o.e.isoler();
        this.jeu.retirerDeLaGrille(o.e);
      }
    }
  }

  updateActif(tmod) {
    switch (this.step) {
      case 0:
        this.lanceur.vers(this.lanceur.trg, 0.1, tmod);
        if (this.lanceur.distance(this.lanceur.trg) < 8) this.initStep(1);
        break;
      case 1:
        this.lanceur.vers(this.lanceur.trg, 0.3, tmod);
        if (this.lanceur.distance(this.lanceur.trg) < 5) this.initStep(2);
        break;
      case 2:
        for (let i = 0; i < this.cutList.length; i++) {
          const o = this.cutList[i];
          o.e.decalX += o.vx * tmod;
          o.e.decalY += o.vy * tmod;
          o.timer -= tmod;
          if (o.timer < 0) { o.e.tuer(); this.cutList.splice(i--, 1); }
          else if (o.timer < 10) o.e.alpha = o.timer * 10;
        }
        if (this.cutList.length === 0) this.toutFinir();
        break;
      default: break;
    }
  }

  pertinence() {
    const ym = this.jeu.hauteurMax();
    if (ym > this.jeu.yMax - 2) return 0;
    this.cutHeight = Math.floor(Math.min(this.jeu.yMax - 2,
      ym + Math.floor(nombre(this.fi.carac[CONCENTRATION]) * 0.43)));
    this.cy = this.jeu.posY(this.cutHeight + 1);
    this.cutList = [];
    let score = 0;
    for (let x = 0; x < this.jeu.xMax; x++) {
      for (let y = 0; y <= this.cutHeight; y++) {
        const e = this.jeu.grille[x][y];
        if (!e) continue;
        this.cutList.push({ e, vx: 0, vy: 0, timer: 10 });
        score += this.valeurRetrait(e);
      }
    }
    return score;
  }

  nom() { return 'Tranche-Cimes'; }
  description() { return 'Coupe et supprime les plus hautes billes du niveau.'; }
}

// ── 10 · Silence ──────────────────────────────────────────────────────────
// Une onde qui repousse les démons et les EMPÊCHE de lancer leurs sorts. La
// durée tient à la concentration de la fée et baisse avec le rang du démon.
class Silence extends Sort {
  constructor(c) { super(c); this.cout = 1; }

  initStep(n) {
    this.step = n;
    if (n === 0) {
      this.centrerLanceur();
    } else if (n === 1) {
      const C = combat();
      for (const imp of this.champ.impList) {
        const a = this.lanceur.angle(imp);
        const p = borner(0, 300 / Math.max(0.001, this.lanceur.distance(imp)), 30);
        imp.vitx = Math.cos(a) * p;
        imp.vity = Math.sin(a) * p;
        imp.poserStatut(C.STATUT.SILENCE, true);
        imp.statutTimer[C.STATUT.SILENCE] =
          (nombre(this.fi.carac[CONCENTRATION]) * 300) / (1 + imp.level * 0.5) + this.alea() * 100;
      }
      this.nouvelleOnde();
      this.timer = 20;
    }
  }

  updateActif(tmod) {
    if (this.step === 0) {
      this.lanceur.vers(this.lanceur.trg, 0.1, tmod);
      if (this.lanceurPret(20)) this.initStep(1);
    } else {
      this.ralentirLanceur(0.3, tmod);
      this.timer -= tmod;
      if (this.timer <= 0) this.toutFinir();
    }
  }

  pertinence() {
    const C = combat();
    return this.champ.impList.filter((i) => !i.statut[C.STATUT.SILENCE]).length * 2;
  }

  nom() { return 'Silence'; }
  description() { return 'Empêche les démons de lancer leurs sortilèges.'; }
}

// ── 11 · Tremblement de terre ─────────────────────────────────────────────
// Le sort le plus cher (7 de mana) : il détruit UNE BILLE SUR DEUX, tirée au
// hasard. C'est le seul qui vide vraiment un niveau bouché.
class Tremblement extends Sort {
  constructor(c) { super(c); this.cout = 7; this.tList = []; }

  initStep(n) {
    this.step = n;
    if (n === 0) {
      this.timer = 50;
    } else if (n === 1) {
      const p = this.nouvelleOnde();
      p.timer = 12;
      p.vits = 40;
      for (const t of this.tList) t.isoler();
      this.timer = 100;
    } else if (n === 2) {
      for (const t of this.tList) {
        const p = this.champ.nouvellePart('partMiniExplosion');
        p.x = this.jeu.posX(t.px + 0.5);
        p.y = this.jeu.posY(t.py + 0.5);
        p.echelle = 150 + this.alea() * 100;
        p.init();
        p.frame = this.hasard(3) + 1;
        p.joue = true;
        p.rot = this.alea() * 360;
        t.tuer();
      }
      this.timer = 8;
    }
  }

  updateActif(tmod) {
    switch (this.step) {
      case 0:
        this.ralentirLanceur(0.3, tmod);
        for (let i = 0; i < 2; i++) {
          const p = this.champ.nouvellePart('partConcentrationRay');
          p.x = this.lanceur.x;
          p.y = this.lanceur.y;
          p.init();
          p.sx = 50 + this.alea() * 100;
          p.rot = this.alea() * 360;
        }
        this.timer -= tmod;
        if (this.timer <= 0) this.initStep(1);
        break;
      case 1:
        for (const t of this.tList) {
          if (this.hasard(Math.max(1, Math.floor(this.timer * 0.5))) === 0) {
            const p = this.champ.nouvellePart('partMiniExplosion');
            p.x = this.jeu.posX(t.px) + this.alea() * this.jeu.ts;
            p.y = this.jeu.posY(t.py) + this.alea() * this.jeu.ts;
            p.init();
            p.rot = this.alea() * 360;
          }
          t.melange = { prc: 100 - this.timer, couleur: 0xFFFFFF };
        }
        this.timer -= tmod * 1.5;
        if (this.timer <= 0) this.initStep(2);
        break;
      case 2:
        this.timer -= tmod;
        if (this.timer <= 0) this.toutFinir();
        break;
      default: break;
    }
  }

  pertinence() {
    this.tList = [];
    let score = 0;
    for (const e of this.jeu.eList) {
      if (e.et !== E.E.JETON) continue;
      if (this.hasard(2) === 0) { this.tList.push(e); score += this.valeurRetrait(e); }
    }
    return score;
  }

  nom() { return 'Tremblement de terre'; }
  description() { return 'Détruit une partie des billes colorées du niveau.'; }
}

// ── 12 · Cloche d'immunité ────────────────────────────────────────────────
// Trente-deux billes de lumière montent en orbite et forment une bulle qui
// REPOUSSE tirs et démons. Elle tient d'autant plus longtemps que la fée est
// concentrée.
class Cloche extends Sort {
  static get RAY() { return 36; }
  constructor(c) {
    super(c);
    this.cout = 1; this.pList = []; this.bulle = null; this.decal = 0; this.speed = 6;
  }

  initStep(n) {
    this.step = n;
    if (n === 0) { this.centrerLanceur(); this.pList = []; } else if (n === 1) {
      this.decal = 0; this.speed = 6;
    } else if (n === 2) {
      for (const p of this.pList) {
        const a = this.lanceur.angle(p);
        const sp = 8 + this.alea() * 12;
        p.vitx = Math.cos(a) * sp;
        p.vity = Math.sin(a) * sp;
        p.timer = 10 + this.alea() * 10;
      }
      this.bulle = this.champ.nouvellePart('partForceBubble');
      this.bulle.x = this.lanceur.x;
      this.bulle.y = this.lanceur.y;
      this.bulle.init();
      this.timer = 20;
    }
  }

  update(tmod) {
    if (!this.bulle) return;              // Flash déplaçait une bulle inexistante
    this.bulle.x = this.lanceur.x;
    this.bulle.y = this.lanceur.y;
    for (const shot of this.champ.shotList) {
      if (shot.cibles[0] === this.lanceur) this.repousser(shot);
    }
    for (const imp of this.champ.impList) this.repousser(imp);
    if (this.jeu.step === E.ETAPE.JEU) {
      this.timer -= tmod;
      if (this.timer <= 0) this.dissiper();
      else if (this.timer < 40) this.bulle.sa = this.timer * 2.5;
    }
  }

  updateActif(tmod) {
    switch (this.step) {
      case 0:
        if (this.hasard(4) === 0) {
          const p = this.champ.nouvellePart('partShieldBall');
          const d = 50 + this.alea() * 30;
          const a = this.alea() * 6.28;
          p.x = this.lanceur.x + Math.cos(a) * d;
          p.y = this.lanceur.y + Math.sin(a) * d;
          p.init();
          this.pList.push(p);
        }
        for (const p of this.pList) p.versVitesse(this.lanceur, 0.3, 0.5, tmod);
        if (this.pList.length > 32) this.initStep(1);
        break;
      case 1: {
        this.decal = (this.decal + 20 * tmod) % 628;
        this.speed += 0.7 * tmod;
        this.ralentirLanceur(0.5, tmod);
        for (let i = 0; i < this.pList.length; i++) {
          const a = (i / this.pList.length) * 6.28 + this.decal / 100;
          this.pList[i].versVitesse({
            x: this.lanceur.x + Math.cos(a) * 40,
            y: this.lanceur.y + Math.sin(a) * 40,
          }, 0.3, 1.25, tmod);
        }
        if (this.speed > 50) this.initStep(2);
        break;
      }
      case 2:
        this.ralentirLanceur(0.3, tmod);
        this.timer -= tmod;
        if (this.timer <= 0) {
          this.timer = 200 + nombre(this.fi.carac[CONCENTRATION]) * 100;
          this.finActif();
        }
        break;
      default: break;
    }
  }

  dissiper() {
    if (this.bulle) { this.bulle.tuer(); this.bulle = null; }
    super.dissiper();
  }

  repousser(trg) {
    const a = this.lanceur.angle(trg);
    const dist = this.lanceur.distance(trg) + (trg.ray || 0);
    if (dist >= Cloche.RAY) return;
    const d = Cloche.RAY - dist;
    trg.x += Math.cos(a) * d;
    trg.y += Math.sin(a) * d;
  }

  // Plus il y a de démons et moins elle a de cœurs, plus la cloche est urgente.
  pertinence() {
    const vie = Math.max(1, nombre(this.fi.fs.$life));
    return this.champ.impList.length * 0.5 / vie;
  }

  nom() { return 'Cloche d\'immunité'; }
  description() { return 'Crée un bouclier d\'énergie qui protège votre fée des tirs et des charges.'; }
}

// ── 13 · Super Nova ───────────────────────────────────────────────────────
// Un trou noir au bas de l'aire, qui aspire tout ce qui passe à sa portée.
class SuperNova extends Sort {
  constructor(c) {
    super(c);
    this.cout = 5; this.cibles = []; this.dList = []; this.ball = null;
    this.ray = 65; this.center = { x: 0, y: 0 }; this.size = 0; this.sizeSpeed = 1;
  }

  initStep(n) {
    this.step = n;
    if (n === 0) {
      this.lanceurVers(this.center.x, this.center.y);
    } else if (n === 1) {
      this.ball = this.champ.nouvellePart('partSuperNova');
      this.ball.x = this.center.x;
      this.ball.y = this.center.y;
      this.ball.echelle = 0;
      this.ball.init();
      this.size = 0;
      this.sizeSpeed = 1;
    } else if (n === 2) {
      this.ball.timer = 6;
      this.ball.fadeLimit = 6;
      this.timer = 10;
    }
  }

  updateActif(tmod) {
    switch (this.step) {
      case 0:
        this.lanceur.etoiles(1.5, tmod);
        this.lanceur.vers(this.lanceur.trg, 0.1, tmod);
        if (this.lanceurPret(20)) this.initStep(1);
        break;
      case 1: {
        this.ralentirLanceur(0.1, tmod);
        this.sizeSpeed += 0.2 * tmod;
        this.size += this.sizeSpeed * tmod;
        this.ball.echelle = (this.size / 100) * this.ray * 2;
        if (this.size > 100) this.size = 100;
        this.ball.sx = this.ball.echelle;
        this.ball.sy = this.ball.echelle;

        const m = this.jeu.ts * 0.5;
        const c = { x: this.center.x - m, y: this.center.y - m };
        for (let i = 0; i < this.cibles.length; i++) {
          if (this.dList[i] >= this.ball.echelle * 0.5) continue;
          const el = this.cibles[i];
          // Element.morphToPart : la bille QUITTE la grille et devient une
          // particule qui garde son dessin — c'est elle qu'on voit tomber dans
          // le trou noir.
          const p = this.champ.nouvellePart('partElementCrystal');
          p.x = this.jeu.posX(el.px);
          p.y = this.jeu.posY(el.py);
          p.echelle = this.jeu.ts;
          const a = p.angle(c);
          const sp = this.dList[i] * 0.05;
          p.vitx = Math.cos(a) * sp;
          p.vity = Math.sin(a) * sp;
          p.timer = 7 + this.alea() * 10;
          p.couleurJeton = (el.et === E.E.JETON) ? el.type : null;
          p.init();
          el.isoler();
          this.jeu.retirerDeLaGrille(el);
          el.tuer();
          this.cibles.splice(i, 1);
          this.dList.splice(i--, 1);
        }
        for (let i = 0; i < Math.floor(this.sizeSpeed / 8); i++) {
          const p = this.champ.nouvellePart('partBlackJuice');
          const a = this.alea() * 6.28;
          p.x = this.center.x + Math.cos(a) * this.ray;
          p.y = this.center.y + Math.sin(a) * this.ray;
          p.init();
          p.rot = a / 0.0174;
          p.sx = 60 + (this.alea() * 2 - 1) * 15;
          p.sy = 60 + (this.alea() * 2 - 1) * 8;
        }
        for (let i = 0; i < 2; i++) {
          const p = this.champ.nouvellePart('partConcentrationRay');
          p.x = this.lanceur.x; p.y = this.lanceur.y;
          p.vitx = this.lanceur.vitx; p.vity = this.lanceur.vity;
          p.vitr = (this.alea() * 2 - 1) * 10;
          p.init();
          p.sx = 10 + this.alea() * 30;
          p.rot = this.alea() * 360;
        }
        if (this.sizeSpeed > 16) this.initStep(2);
        break;
      }
      case 2:
        this.timer -= tmod;
        if (this.timer <= 0) this.toutFinir();
        break;
      default: break;
    }
  }

  // Le rayon est écrit en dur dans l'original — `30 + 7*5`, la ligne qui
  // consultait la concentration ayant été mise en commentaire. On garde le
  // nombre : c'est lui qui a été équilibré.
  pertinence() {
    this.ray = 30 + 7 * 5;
    this.center = { x: this.jeu.largeur * 0.5, y: this.jeu.hauteur - this.ray };
    const m = this.jeu.ts * 0.5;
    const c = { x: this.center.x - m, y: this.center.y - m };
    this.cibles = [];
    this.dList = [];
    let score = 0;
    for (const e of this.jeu.eList) {
      const dx = this.jeu.posX(e.px) - c.x, dy = this.jeu.posY(e.py) - c.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist >= this.ray) continue;
      score += this.valeurRetrait(e);
      this.cibles.push(e);
      this.dList.push(dist);
    }
    return score;
  }

  nom() { return 'Super Nova'; }
  description() { return 'Crée un trou noir aspirant les billes les plus proches.'; }
}

// ── 14 · Bannissement ─────────────────────────────────────────────────────
// Une onde qui grandit et efface tous les démons sur son passage. Elle ne touche
// pas la grille : c'est le sort de survie.
class Bannissement extends Sort {
  constructor(c) { super(c); this.cout = 4; this.ray = 0; }

  initStep(n) {
    this.step = n;
    if (n === 0) { this.centrerLanceur(); return; }
    let p = this.champ.nouvellePart('partLightCircle');
    p.x = this.lanceur.x; p.y = this.lanceur.y;
    p.echelle = 20; p.timer = 10; p.fondu = [1]; p.vits = 40;
    p.init();
    p = this.champ.nouvellePart('partFaerieWhiteShade');
    p.x = this.lanceur.x; p.y = this.lanceur.y;
    p.fondu = [1]; p.fadeLimit = 7; p.timer = 8;
    p.init();
    this.ray = 0;
  }

  updateActif(tmod) {
    if (this.step === 0) {
      this.lanceur.vers(this.lanceur.trg, 0.1, tmod);
      if (this.lanceurPret(10)) this.initStep(1);
      return;
    }
    this.ray += 8 * tmod;
    for (const imp of this.champ.impList.slice()) {
      if (this.lanceur.distance(imp) >= this.ray) continue;
      const a = this.lanceur.angle(imp);
      const ca = Math.cos(a), sa = Math.sin(a);
      for (let n = 0; n < 8; n++) {
        const da = this.alea() * 6.28;
        const d = this.alea() * 24;
        const p = this.champ.nouvellePart('partHoriLight');
        p.x = imp.x + Math.cos(da) * d * 0.5;
        p.y = imp.y + Math.sin(da) * d;
        const sp = 0.5 + this.alea() * 3;
        p.vitx = ca * sp;
        p.vity = sa * sp;
        p.timer = 10 + this.alea() * 10;
        p.init();
        p.sx = 300 - d * 10;
        p.rot = a / 0.0174;
      }
      imp.tuer();
    }
    if (this.ray > 200) this.toutFinir();
  }

  // (rang+2)² : un démon de rang 4 vaut trente-six, un rang 0 en vaut quatre.
  pertinence() {
    let score = 0;
    for (const imp of this.champ.impList) score += Math.pow(imp.level + 2, 2);
    return score;
  }

  nom() { return 'Bannissement'; }
  description() { return 'Bannit définitivement tous les démons en liberté du niveau.'; }
}

// ── 15 · Billes de lumière ────────────────────────────────────────────────
// Une bille par point de concentration, plus une. Chacune cherche un démon ; à
// défaut, elle prend un élément de la grille au hasard et le fait sauter.
class BillesDeLumiere extends Sort {
  constructor(c) { super(c); this.cout = 3; this.bList = []; }

  initStep(n) {
    this.step = n;
    if (n !== 0) return;
    this.bList = [];
    const max = 1 + nombre(this.fi.carac[CONCENTRATION]);
    const iList = this.champ.impList.slice();
    const eList = this.jeu.eList.slice();
    for (let i = 0; i < max; i++) {
      const p = this.champ.nouvellePart('partFlipGlow');
      p.x = this.lanceur.x;
      p.y = this.lanceur.y;
      p.echelle = 30;
      p.trg = null;
      p.trgType = null;
      if (iList.length > 0) {
        p.trg = iList.pop();
        p.trgType = 0;
      } else {
        if (eList.length === 0) { p.tuer(); break; }
        p.trg = eList.splice(this.hasard(eList.length), 1)[0];
        p.trgType = 1;
      }
      const cible = this.positionCible(p);
      const a = p.angle(cible);
      const sp = 3 + this.alea() * 4;
      p.vitx = -Math.cos(a) * sp;
      p.vity = -Math.sin(a) * sp;
      p.init();
      this.bList.push(p);
    }
    if (this.bList.length === 0) this.toutFinir();
  }

  positionCible(p) {
    if (p.trgType === 1) {
      return {
        x: this.jeu.posX(p.trg.px) + this.jeu.ts * 0.5,
        y: this.jeu.posY(p.trg.py) + this.jeu.ts * 0.5,
      };
    }
    return { x: p.trg.x, y: p.trg.y };
  }

  updateActif(tmod) {
    if (this.step !== 0) return;
    for (let i = 0; i < this.bList.length; i++) {
      const p = this.bList[i];
      // Une cible peut mourir entre-temps : sa bille s'éteint plutôt que de
      // poursuivre un fantôme.
      if (!p.trg || !p.trg.vivant) {
        p.timer = 6; p.fondu = [1];
        this.bList.splice(i--, 1);
        continue;
      }
      const trg = this.positionCible(p);
      p.versVitesse(trg, 0.15, 0.6, tmod);
      const m = 10;
      if (p.x < m || p.x > this.jeu.largeur - m) { p.vitx *= -0.8; p.x = borner(m, p.x, this.jeu.largeur - m); }
      if (p.y < m || p.y > this.jeu.hauteur - m) { p.vity *= -0.8; p.y = borner(m, p.y, this.jeu.hauteur - m); }
      if (p.distance(trg) < 10) {
        if (p.trgType === 0) {
          p.trg.vitx += p.vitx * 0.5;
          p.trg.vity += p.vity * 0.5;
          p.trg.blesser(80);
        } else {
          p.trg.isoler();
          p.trg.exploser();
          this.jeu.retirerDeLaGrille(p.trg);
          p.trg.tuer();
        }
        p.vits = 20;
        p.timer = 8;
        p.fondu = [1];
        this.bList.splice(i--, 1);
      }
    }
    if (this.bList.length === 0) this.toutFinir();
  }

  pertinence() {
    return (nombre(this.fi.carac[CONCENTRATION]) + this.champ.impList.length) * 0.4;
  }

  nom() { return 'Billes de lumière'; }
  description() { return 'Elles anéantiront vos ennemis ou les billes du niveau.'; }
}

// ── 16 · Pigmentation ─────────────────────────────────────────────────────
// La fée passe en volant et REPEINT les billes qu'elle frôle. C'est le sort le
// plus rare du jeu (fréquence 2 sur des milliers), et le seul qui demande de la
// patience : cent images pour repeindre ce qu'elle peut.
class Pigmentation extends Sort {
  constructor(c) { super(c); this.cout = 3; this.cid = 0; }

  initStep(n) {
    this.step = n;
    if (n === 0) {
      this.cid = this.jeu.colorList[this.hasard(this.jeu.colorList.length)];
      this.centrerLanceur();
    } else if (n === 1) {
      this.timer = 100;
    }
  }

  updateActif(tmod) {
    if (this.step === 0) {
      this.lanceur.vers(this.lanceur.trg, 0.1, tmod);
      if (this.lanceurPret(10)) this.initStep(1);
      return;
    }
    const tList = [];
    let repeint = false;
    for (const e of this.jeu.eList) {
      if (e.et !== E.E.JETON) continue;
      const trg = {
        x: this.jeu.posX(e.px) + this.jeu.ts * 0.5,
        y: this.jeu.posY(e.py) + this.jeu.ts * 0.5,
      };
      if (this.lanceur.distance(trg) < 20 && e.type !== this.cid) {
        e.setType(this.cid);
        repeint = true;
        for (let n = 0; n < 4; n++) {
          const p = this.champ.nouvellePart('partPaint');
          const a = p.angle(trg);
          p.x = trg.x; p.y = trg.y;
          const sp = this.alea() * 4;
          p.vitx = -Math.cos(a) * sp;
          p.vity = -Math.sin(a) * sp;
          p.echelle = 40 + this.alea() * 60;
          p.timer = 10 + this.alea() * 10;
          p.flGrav = true;
          p.poids = 0.35;
          p.couleur = E.COULEURS[this.cid];
          p.init();
        }
      }
      if (e.type !== this.cid) tList.push(trg);
    }
    // Repeindre relie des billes : il faut refaire les groupes, sinon la grille
    // afficherait des taches qui ne se touchent pas.
    if (repeint) { this.jeu.viderGroupes(); this.jeu.chercherGroupes(); }

    this.timer -= tmod;
    if (tList.length === 0 || this.timer < 0) { this.toutFinir(); return; }
    if (this.lanceurPret(16)) {
      this.lanceur.flForceWay = true;
      this.lanceur.trg = tList[this.hasard(tList.length)];
    }
  }

  pertinence() {
    let score = 0;
    for (const e of this.jeu.eList) if (e.et === E.E.JETON) score += 0.05;
    return score * Math.pow(nombre(this.fi.carac[RAPIDITE]), 0.5);
  }

  nom() { return 'Pigmentation'; }
  description() { return 'Votre fée peint d\'une couleur unique les billes du niveau en les touchant.'; }
}

// ══════════════════════════════════════════════════════════════════════════
//  spell/imp/*.mt — les sorts des démons
//
//  Symétriques de ceux de la fée, et pourtant tout autres : ils ne cherchent
//  pas à ranger la grille mais à l'encombrer. Un impy n'a pas de mana ; il a
//  des ACTIONS — huit à onze, tirées à sa naissance — et une cadence
//  (Cs.impSpellRate). Quand il n'a plus d'actions, il quitte le niveau par le
//  haut. C'est ce compte qui borne les dégâts qu'un démon peut faire.
//
//  Le tirage est dans Imp.getSpell (combat.js) : à chaque rang sa table.
// ══════════════════════════════════════════════════════════════════════════

class SortImpy extends Sort {
  constructor(c) { super(c); this.imp = null; }
  // Un impy ne paie rien et n'est jamais interrogé sur sa disponibilité : il
  // lance quand sa cadence le lui permet.
  disponible() { return true; }
  finActif() {
    this.flLance = false;
    const i = this.jeu.saList.indexOf(this);
    if (i >= 0) this.jeu.saList.splice(i, 1);
  }
}

// ── Éboulement (TokenFall) ────────────────────────────────────────────────
// Il monte des billes au ciel, et elles retombent au sommet des colonnes.
// Autant que son rang le permet, jamais plus qu'il n'y a de colonnes.
class ChuteJetons extends SortImpy {
  constructor(c) { super(c); this.pList = []; this.cList = []; this.max = 0; }

  initStep(n) {
    this.step = n;
    if (n === 1) {
      this.max = Math.round(Math.min(this.jeu.xMax, (this.imp.level + 1) * (1 + this.alea())));
      this.imp.epauleActive = true;
      this.timer = 20;
    } else if (n === 2) {
      this.imp.epauleActive = false;
      this.cList = [];
      for (let i = 0; i < this.max; i++) this.cList.push(this.jeu.getColor());
      this.pList = [];
      for (let i = 0; i < this.max; i++) {
        const p = this.champ.nouvellePart('partBallColor');
        p.tx = this.alea() * this.jeu.largeur;
        p.x = this.lanceur.x;
        p.y = this.lanceur.y - 10;
        p.vitx = 4 * (this.alea() * 2 - 1);
        p.vity = -(1 + this.alea() * 2);
        p.couleur = E.COULEURS[this.cList[i]];
        p.init();
        this.pList.push(p);
      }
      this.lanceur.vity += 4;
    }
  }

  updateActif(tmod) {
    switch (this.step) {
      case 0:
        this.centrerLanceur();
        this.lanceur.vers(this.lanceur.trg, 0.1, tmod);
        if (this.lanceurPret(20)) this.initStep(1);
        break;
      case 1:
        for (let i = 0; i < this.max; i++) {
          const p = this.champ.nouvellePart('partLightBallFlip');
          const a = this.alea() * 6.28;
          const r = this.alea() * 8;
          p.x = this.lanceur.x + Math.cos(a) * r;
          p.y = this.lanceur.y - 10 + Math.sin(a) * r;
          p.timer = 6 + this.alea() * 10;
          p.fondu = [2];
          p.echelle = 50 + this.alea() * 20;
          p.fadeCouleur = this.hasard(0xFFFFFF);
          p.init();
        }
        this.timer -= tmod;
        if (this.timer < 0) this.initStep(2);
        break;
      case 2:
        for (let i = 0; i < this.pList.length; i++) {
          const p = this.pList[i];
          p.versVitesse({ x: p.tx, y: -30 }, 0.1, 0.4, tmod);
          if (p.x < 0 || p.x > this.jeu.largeur) {
            p.x = borner(0, p.x, this.jeu.largeur);
            p.vitx *= -0.8;
          }
          if (p.y < -20) { this.pList.splice(i--, 1); p.tuer(); }
        }
        if (this.pList.length === 0) {
          // Une colonne au plus par bille, tirées au hasard, et rien ne tombe
          // au-delà de la troisième ligne : le sort encombre, il ne tue pas.
          const xList = [];
          for (let i = 0; i < this.jeu.xMax; i++) xList.push(i);
          for (let i = xList.length - 1; i > 0; i--) {
            const j = this.hasard(i + 1);
            const t = xList[i]; xList[i] = xList[j]; xList[j] = t;
          }
          for (const couleur of this.cList) {
            const x = xList.pop();
            if (x === undefined) break;
            let y = 0;
            while (!this.jeu.estLibre(x, y) && y < 20) y++;
            if (y < 3) {
              const t = this.jeu.genElement(E.E.JETON, x, y, 1);
              if (t) t.setType(couleur);
            }
          }
          this.toutFinir();
        }
        break;
      default: break;
    }
  }

  nom() { return 'Éboulement'; }
  description() { return 'Fait retomber des billes au sommet des colonnes.'; }
}

// ── Fils Paralysants (Bind) ───────────────────────────────────────────────
// La pièce ne tourne plus. Un seul tour, mais il suffit à gâcher un coup.
class Lien extends SortImpy {
  lancer() {
    this.flLance = true;
    this.lanceur.sortEnCours = this;
    this.finActif();                     // il rend la main aussitôt : l'effet dure
  }

  update(tmod) {
    const p = this.jeu.piece;
    if (!p) return;
    p.flBind = true;
    // Il tire sur ses fils : la pièce trop loin le RAMÈNE vers elle.
    for (const o of p.list) {
      const trg = {
        x: this.jeu.posX(o.x + p.x + p.cx + 0.5),
        y: this.jeu.posY(o.y + p.y + p.cy + 0.5),
      };
      const dist = this.lanceur.distance(trg);
      const lim = 80;
      if (dist > lim) {
        const a = this.lanceur.angle(trg);
        const po = (dist - lim) / lim;
        this.lanceur.vitx += Math.cos(a) * po * tmod;
        this.lanceur.vity += Math.sin(a) * po * tmod;
      }
    }
    this.fils = p.list.map((o) => ({
      x: this.jeu.posX(o.x + p.x + p.cx + 0.5),
      y: this.jeu.posY(o.y + p.y + p.cy + 0.5),
    }));
  }

  surEntretien() { this.dissiper(); }

  dissiper() {
    if (this.jeu.piece) this.jeu.piece.flBind = false;
    this.fils = null;
    super.dissiper();
  }

  nom() { return 'Fils Paralysants'; }
  description() { return 'La pièce en cours ne peut plus tourner.'; }
}

// ── Fumée troublante (Smoke) ──────────────────────────────────────────────
// Il DISPARAÎT, et revient au tour suivant. Le tuer devient impossible tant
// qu'il n'est pas ressorti — c'est une esquive, pas une attaque.
class Fumee extends SortImpy {
  lancer() {
    this.flLance = true;
    this.pos = { x: this.lanceur.x, y: this.lanceur.y };
    this.niveau = this.imp.level;
    this.nuage();
    this.finActif();
    this.lanceur.tuer();
  }

  update() {
    const p = this.jeu.piece;
    if (!p) return;
    for (const o of p.list) {
      this.grainDeNuage(
        this.jeu.posX(o.x + p.x + p.cx + 0.5),
        this.jeu.posY(o.y + p.y + p.cy + 0.5));
    }
  }

  grainDeNuage(x, y) {
    const a = this.alea() * 6.28;
    const d = this.alea() * 6;
    const p = this.champ.nouvellePart('partLightBall');
    p.x = x + Math.cos(a) * d;
    p.y = y + Math.sin(a) * d;
    p.echelle = 300 + (this.alea() * 2 - 1) * 100;
    p.alpha = 60;
    p.timer = 2 + this.alea() * 10;
    p.init();
  }

  nuage() {
    for (let i = 0; i < 6; i++) {
      const a = this.alea() * 6.28;
      const d = this.alea() * 14;
      const p = this.champ.nouvellePart('partCloud');
      p.x = this.pos.x + Math.cos(a) * d;
      p.y = this.pos.y + Math.sin(a) * d;
      p.echelle = Math.max(30, 120 - d * 10);
      p.frame = this.hasard(3) + 1;
      p.joue = true;
      p.init();
    }
  }

  surEntretien() {
    this.nuage();
    this.champ.naitreImpy(this.niveau, this.pos.x, this.pos.y);
    this.dissiper();
  }

  // Il n'est plus là : rien ne peut l'interrompre.
  arretUrgence() {}

  nom() { return 'Fumée troublante'; }
  description() { return 'Le démon s\'évapore et reparaît au tour suivant.'; }
}

// ── Quintal (Wall) ────────────────────────────────────────────────────────
// Un mur de pierres en travers de la grille, aussi haut que son rang.
class Mur extends SortImpy {
  constructor(c) { super(c); this.pList = []; this.ym = 0; this.x = 0; }

  initStep(n) {
    this.step = n;
    if (n === 0) this.centrerLanceur();
    else if (n === 1) {
      this.pList = [];
      this.ym = Math.floor(Math.min(this.imp.level + 1, this.jeu.hauteurMax() - 1));
      this.x = 0;
      this.timer = 0;
    }
  }

  updateActif(tmod) {
    if (this.step === 0) {
      this.lanceur.vers(this.lanceur.trg, 0.1, tmod);
      if (this.lanceurPret(20)) this.initStep(1);
      return;
    }
    for (let i = 0; i < this.pList.length; i++) {
      const p = this.pList[i];
      p.versVitesse(p.trg, 0.2, 0.4, tmod);
      const dist = p.distance(p.trg);
      p.vers(p.trg, borner(0, 3 / Math.max(0.001, dist), 0.5), tmod);
      if (dist < 5) {
        if (this.jeu.estLibre(p.t.x, p.t.y)) this.jeu.genElement(E.E.PIERRE, p.t.x, p.t.y, 2);
        p.tuer();
        this.pList.splice(i--, 1);
      }
    }
    if (this.x < this.jeu.xMax) {
      this.timer -= tmod;
      if (this.timer <= 0) {
        this.timer = 8;
        for (let y = 2; y < this.ym; y++) {
          const p = this.champ.nouvellePart('partDust');
          p.x = this.lanceur.x;
          p.y = this.lanceur.y;
          const a = this.alea() * 6.28;
          const po = 1 + this.alea() * 8;
          p.vitx = Math.cos(a) * po;
          p.vity = Math.sin(a) * po;
          p.trg = { x: this.jeu.posX(this.x), y: this.jeu.posY(y) };
          p.t = { x: this.x, y };
          p.echelle = 250;
          p.init();
          this.pList.push(p);
        }
        this.x++;
      }
    } else if (this.pList.length === 0) {
      this.toutFinir();
    }
  }

  nom() { return 'Quintal'; }
  description() { return 'Dresse un mur de pierres en travers du niveau.'; }
}

// ── Cuirasse (Armor) ──────────────────────────────────────────────────────
// Rang² billes reçoivent une armure : elles ne se groupent plus tant qu'un
// souffle ne l'a pas brisée.
class Armure extends SortImpy {
  constructor(c) { super(c); this.eList = []; }

  initStep(n) {
    this.step = n;
    if (n === 0) {
      this.lanceurVers(this.jeu.largeur * 0.5, 20);
    } else if (n === 1) {
      this.eList = [];
      const list = this.jeu.eList.slice();
      for (let i = list.length - 1; i > 0; i--) {
        const j = this.hasard(i + 1);
        const t = list[i]; list[i] = list[j]; list[j] = t;
      }
      const max = Math.pow(this.imp.level, 2);
      while (this.eList.length < max && list.length > 0) {
        const e = list.pop();
        if (e.et === E.E.JETON && e.special === 0) this.eList.push(e);
      }
      this.timer = 0;
    }
  }

  updateActif(tmod) {
    if (this.step === 0) {
      this.lanceur.vers(this.lanceur.trg, 0.1, tmod);
      if (this.lanceurPret(20)) this.initStep(1);
      return;
    }
    this.timer -= tmod;
    if (this.timer < 0) {
      this.timer = 8;
      const e = this.eList.pop();
      if (e && e.vivant) {
        e.isoler();
        e.setSpecial(2);
        const trg = { x: this.jeu.posX(e.px + 0.5), y: this.jeu.posY(e.py + 0.5) };
        const a = this.lanceur.angle(trg);
        const dist = this.lanceur.distance(trg);
        const ca = Math.cos(a), sa = Math.sin(a);
        const p = this.champ.nouvellePart('partFullRay');
        p.x = this.lanceur.x; p.y = this.lanceur.y;
        p.timer = 12; p.fondu = [4];
        p.init();
        p.sx = dist;
        p.rot = a / 0.0174;
        for (let i = 0; i < 3; i++) {
          const sr = this.champ.nouvellePart('partHoriLight');
          const d = this.alea() * 0.8 * dist;
          const sp = 1 + this.alea() * 5;
          sr.x = this.lanceur.x + ca * d;
          sr.y = this.lanceur.y + sa * d;
          sr.vitx = ca * sp; sr.vity = sa * sp;
          sr.timer = 16 + this.alea() * 10;
          sr.fondu = [1];
          sr.init();
          sr.rot = a / 0.0174;
          sr.sx = 100 + this.alea() * 50;
        }
        const lb = this.champ.nouvellePart('partLightBall');
        lb.x = trg.x; lb.y = trg.y;
        lb.timer = 24; lb.fondu = [1]; lb.echelle = 150;
        lb.init();
      }
    }
    if (this.eList.length === 0) this.toutFinir();
  }

  nom() { return 'Cuirasse'; }
  description() { return 'Blinde une partie des billes du niveau.'; }
}

// ── Conglomérat ───────────────────────────────────────────────────────────
// Il avale une pièce et la recrache énorme : six cases plus son rang.
class Conglomerat extends SortImpy {
  constructor(c) { super(c); this.ball = null; this.decal = 0; }

  initStep(n) {
    this.step = n;
    if (n === 0) {
      this.timer = 20;
      this.jeu.imposerForme(6 + this.imp.level);
    } else if (n === 1) {
      this.lanceur.vity += 4;
      this.ball = this.champ.nouvellePart('partBlackBall');
      this.ball.x = this.lanceur.x;
      this.ball.y = this.lanceur.y;
      this.ball.init();
    } else if (n === 2) {
      this.lanceur.flForceWay = false;
      this.finActif();
      this.decal = 0;
    }
  }

  updateActif(tmod) {
    switch (this.step) {
      case 0:
        this.ralentirLanceur(0.5, tmod);
        this.grainNoir(this.lanceur.x, this.lanceur.y);
        this.timer -= tmod;
        if (this.timer < 0) this.initStep(1);
        break;
      case 1: {
        this.grainNoir(this.lanceur.x, this.lanceur.y);
        this.ball.versVitesse({ x: this.jeu.largeur * 0.5, y: -30 }, 0.2, 0.3, tmod);
        const mc = this.champ.nouvellePart('mcBlackBallSpark');
        const a = this.alea() * 6.28;
        const d = 2 + this.alea() * 10;
        mc.x = this.ball.x + Math.cos(a) * d;
        mc.y = this.ball.y + Math.sin(a) * d;
        mc.rot = this.alea() * 360;
        mc.timer = 4;
        mc.init();
        if (this.ball.y < -30) { this.ball.tuer(); this.ball = null; this.initStep(2); }
        break;
      }
      default: break;
    }
  }

  update(tmod) {
    if (this.step !== 2) return;
    this.decal = (this.decal + 73 * tmod) % 628;
    if (!this.jeu.piece) return;
    // La pièce maudite clignote en rose : c'est le seul avertissement qu'on ait.
    // L'original teinte le clip qui la porte ; ici on teinte ses billes, ce qui
    // revient au même et se lit au dessin.
    const m = { prc: 30 + Math.cos(this.decal / 100) * 30, couleur: 0xFF00AA };
    for (const o of this.jeu.piece.list) o.e.melange = m;
    this.grainNoir(this.lanceur.x, this.lanceur.y);
  }

  grainNoir(x, y) {
    const p = this.champ.nouvellePart('partFader');
    const a = this.alea() * 6.28;
    const d = 2 + this.alea() * 10;
    p.x = x + Math.cos(a) * d;
    p.y = y + Math.sin(a) * d;
    p.timer = 4 + this.alea() * 10;
    p.fondu = [0, 1, 2];
    p.fadeCouleur = 0x000000;
    p.init();
    return p;
  }

  surEntretien() { this.dissiper(); }

  dissiper() {
    if (this.jeu.piece) for (const o of this.jeu.piece.list) o.e.melange = null;
    super.dissiper();
  }

  nom() { return 'Conglomérat'; }
  description() { return 'La prochaine pièce sera énorme.'; }
}

// ── Migraine (ShapeBig) ───────────────────────────────────────────────────
// L'exact contraire de la Dactylo de la fée : une bille de PLUS par pièce,
// pendant quatre pièces par rang.
class GrandeForme extends SortImpy {
  constructor(c) {
    super(c);
    this.bList = []; this.startPiece = null; this.decal = 0; this.dSpeed = 1; this.nStar = 0;
  }

  lancer() {
    this.flLance = true;
    this.lanceur.sortEnCours = this;
    this.startPiece = this.jeu.pieces;
    this.nStar = this.imp.level;
    this.initStep(0);
  }

  update() {
    if (this.startPiece === null) return;
    if (this.jeu.pieces - this.startPiece > this.imp.level * 4) this.dissiper();
  }

  initStep(n) {
    this.step = n;
    if (n === 0) {
      this.bList = [];
      for (let i = 0; i < this.nStar; i++) {
        const p = this.champ.nouvellePart('partLightGrim');
        p.x = this.lanceur.x;
        p.y = this.lanceur.y;
        p.init();
        this.bList.push({ p, tx: this.alea() * this.jeu.largeur });
      }
      this.decal = 0;
      this.dSpeed = 1;
    } else if (n === 1) {
      this.timer = 0;
    } else if (n === 2) {
      this.executer();
    }
  }

  updateActif(tmod) {
    this.ralentirLanceur(0.5, tmod);
    switch (this.step) {
      case 0: {
        this.decal = (this.decal + this.dSpeed * tmod) % 628;
        this.dSpeed *= 1.1;
        for (let i = 0; i < this.bList.length; i++) {
          const p = this.bList[i].p;
          const a = (this.decal / 100) - (i / this.bList.length) * 6.28;
          p.vers({ x: this.lanceur.x + Math.cos(a) * 30, y: this.lanceur.y + Math.sin(a) * 30 },
            0.2, tmod);
          if (this.dSpeed > 40) {
            p.vitx += Math.cos(a + 1.2) * 10;
            p.vity += Math.sin(a + 1.2) * 10;
          }
        }
        if (this.dSpeed > 40) this.initStep(1);
        break;
      }
      case 1: {
        this.timer += tmod;
        for (let i = 0; i < this.bList.length; i++) {
          const info = this.bList[i];
          const p = info.p;
          for (let n = 0; n < 2; n++) {
            const part = this.champ.nouvellePart('partLightBall');
            const a = this.alea() * 6.28;
            part.x = p.x; part.y = p.y;
            part.vitx = Math.cos(a) * 2;
            part.vity = Math.sin(a) * 2;
            part.echelle = 30 + this.alea() * 50;
            part.poids = 0.1;
            part.flGrav = true;
            part.timer = 10 + this.alea() * 10;
            part.init();
          }
          if (this.timer > i * 2) {
            p.frame = 2;
            p.versVitesse({ x: info.tx, y: -30 }, 0.01, 1, tmod);
            const ray = 16;
            if (p.x < ray || p.x > this.jeu.largeur + ray) {
              p.vitx *= -1;
              p.x = borner(ray, p.x, this.jeu.largeur + ray);
            }
            if (p.y < -20) { p.tuer(); this.bList.splice(i--, 1); }
          }
        }
        if (this.bList.length === 0) { this.executer(); this.finActif(); }
        break;
      }
      default: break;
    }
  }

  executer() {
    this.jeu.shapeNumInc++;
    this.jeu.viderReserve();
    this.champ.evenement('effetPiece', { id: 1, actif: true });
  }

  dissiper() {
    if (this.flOccupe && this.startPiece !== null) {
      this.jeu.shapeNumInc--;
      this.jeu.viderReserve();
      this.champ.evenement('effetPiece', { id: 1, actif: false });
    }
    super.dissiper();
  }

  nom() { return 'Migraine'; }
  description() { return 'Les prochaines pièces contiendront une bille de plus.'; }
}

// ── Nuit Noire (Night) ────────────────────────────────────────────────────
// L'écran s'éteint : il ne reste qu'un rond de lumière autour de la pièce.
// Un seul démon peut l'invoquer à la fois, et l'effet dure autant de pièces
// que son rang.
class Nuit extends SortImpy {
  lancer() {
    this.flLance = true;
    this.lanceur.sortEnCours = this;
    if (this.jeu.nuit) {                 // une nuit à la fois
      this.finActif();
      Sort.prototype.dissiper.call(this);
      return;
    }
    this.pieceTimer = this.imp.level;
    this.initStep(0);
  }

  initStep(n) {
    this.step = n;
    if (n === 0) this.centrerLanceur();
    else if (n === 1) this.prc = 0;
    else if (n === 2) this.tomberLaNuit();
  }

  updateActif(tmod) {
    switch (this.step) {
      case 0:
        this.lanceur.vers(this.lanceur.trg, 0.1, tmod);
        if (this.lanceurPret(10)) this.initStep(1);
        break;
      case 1:
        this.prc = Math.min(this.prc + tmod * 1.5, 100);
        this.jeu.nuit = { x: this.lanceur.x, y: this.lanceur.y, prc: this.prc, ouverture: 0 };
        if (this.prc === 100) { this.prc = 0; this.initStep(2); }
        break;
      case 2:
        this.echelle *= Math.pow(0.92, tmod);
        if (this.echelle < 1) this.echelle = 0;
        this.jeu.nuit.ouverture = 100 - this.echelle;
        if (this.echelle === 0) this.finActif();
        break;
      default: break;
    }
  }

  // Le rond suit la PIÈCE, pas le démon : c'est ce qui rend le sort jouable.
  update(tmod) {
    if (!this.jeu.nuit) return;
    const p = this.jeu.piece;
    let tx = this.lanceur.x, ty = this.lanceur.y;
    if (p) {
      tx = this.jeu.posX(p.x + p.cx + 0.5);
      ty = this.jeu.posY(p.y + p.cy + 0.5);
    }
    this.jeu.nuit.x += (tx - this.jeu.nuit.x) * 0.2 * tmod;
    this.jeu.nuit.y += (ty - this.jeu.nuit.y) * 0.2 * tmod;
  }

  surEntretien() {
    this.pieceTimer--;
    if (this.pieceTimer <= 0) this.dissiper();
  }

  dissiper() {
    this.jeu.nuit = null;
    super.dissiper();
  }

  tomberLaNuit() {
    this.echelle = 100;
    this.jeu.nuit = { x: this.lanceur.x, y: this.lanceur.y, prc: 100, ouverture: 0 };
  }

  nom() { return 'Nuit Noire'; }
  description() { return 'Éteint le niveau, sauf autour de la pièce.'; }
}

// ── Origine ───────────────────────────────────────────────────────────────
// Le pire de tous : il AJOUTE une couleur au niveau. Tant qu'elle est là, le
// niveau ne peut pas se terminer.
class Origine extends SortImpy {
  constructor(c) { super(c); this.pList = []; this.fp = null; this.tok = null; }

  initStep(n) {
    this.step = n;
    if (n === 0) {
      if (!this.jeu.estLibre(Math.floor(this.jeu.xMax * 0.5), 0)) { this.toutFinir(); return; }
      // La première couleur qui n'est PAS déjà en jeu.
      this.color = 0;
      while (this.jeu.colorList.indexOf(this.color) >= 0) this.color++;
      if (this.color >= E.COULEURS.length) { this.toutFinir(); return; }
      this.cv = E.COULEURS[this.color];
      this.centrerLanceur();
    } else if (n === 1) {
      this.pList = [];
      this.timer = 80;
      this.fp = this.champ.nouvellePart('partFlipGlow');
      this.fp.x = this.lanceur.x;
      this.fp.y = this.lanceur.y;
      this.fp.echelle = 0;
      this.fp.init();
    } else if (n === 2) {
      this.jeu.colorList.push(this.color);
      this.tok = this.jeu.genElement(E.E.JETON, Math.floor(this.jeu.xMax * 0.5), 0, 0);
      if (this.tok) this.tok.setType(this.color);
      for (const p of this.pList) {
        const dist = p.distance(this.lanceur);
        const a = p.angle(this.lanceur);
        const sp = dist * 0.2;
        p.vitx = -Math.cos(a) * sp;
        p.vity = -Math.sin(a) * sp;
        p.timer = 12 + this.alea() * 15;
        p.couleur = this.cv;
      }
      this.fp.timer = 10;
      this.timer = 20;
    }
  }

  updateActif(tmod) {
    switch (this.step) {
      case 0:
        this.lanceur.vers(this.lanceur.trg, 0.1, tmod);
        if (this.lanceurPret(20)) this.initStep(1);
        break;
      case 1: {
        this.ralentirLanceur(0.5, tmod);
        const np = this.champ.nouvellePart('partLightBallFlip');
        const a = this.alea() * 6.28;
        const d = 30 + this.alea() * 30;
        np.x = this.lanceur.x + Math.cos(a) * d;
        np.y = this.lanceur.y + Math.sin(a) * d;
        np.echelle = 50;
        np.alpha = 50;
        np.ajouterA(this.pList);
        np.init();

        for (let i = 0; i < this.pList.length; i++) {
          const p = this.pList[i];
          p.versVitesse(this.lanceur, 0.1, 0.2, tmod);
          const dist = p.distance(this.lanceur);
          p.melange = { prc: Math.max(0, 100 - dist * 3), couleur: this.cv };
          const sc = Math.max(0, 160 - dist * 3);
          p.sx = sc; p.sy = sc;
          if (dist < 6) { p.tuer(); i--; }
        }
        this.fp.x = this.lanceur.x;
        this.fp.y = this.lanceur.y;
        const sc = Math.max(0, 100 - this.timer * 1.5);
        this.fp.sx = sc; this.fp.sy = sc;
        this.timer -= tmod;
        if (this.timer < 0) this.initStep(2);
        break;
      }
      case 2:
        for (let i = 0; i < Math.floor(this.timer * 0.5); i++) {
          const p = this.champ.nouvellePart('partVertiLight');
          p.x = this.jeu.posX(Math.floor(this.jeu.xMax * 0.5) + this.alea());
          const c = this.alea();
          p.y = this.lanceur.y * c + (this.tok ? this.jeu.posY(this.tok.py) : 0) * (1 - c);
          p.vity = -(2 + this.alea() * 12);
          p.timer = 8 + this.alea() * 10;
          p.init();
          p.sy = 100 + this.alea() * 200;
        }
        this.timer -= tmod;
        if (this.timer < 0) this.toutFinir();
        break;
      default: break;
    }
  }

  nom() { return 'Origine'; }
  description() { return 'Ajoute une couleur au niveau.'; }
}

const CLASSES_IMPY = {
  ChuteJetons, Lien, Fumee, Mur, Armure, Conglomerat, GrandeForme, Nuit, Origine,
};

// ── Spell.newSpell ────────────────────────────────────────────────────────
const CLASSES = {
  0: SchemeDeDimitri, 1: PercePuits, 2: Dactylo, 3: Meteore, 4: GobeurDePerles,
  5: Depressurisation, 6: ValseFossile, 7: Ascension, 8: Exaltation, 9: TrancheCimes,
  10: Silence, 11: Tremblement, 12: Cloche, 13: SuperNova, 14: Bannissement,
  15: BillesDeLumiere, 16: Pigmentation,
  20: TirBilles, 21: TirLaser, 22: TirSolero, 23: TirMeches, 24: TirGlumelle,
  25: TirClametorche, 26: TirDamaide, 27: TirAmeEnPeine,
};

function nouveauSort(n, champ) {
  const C = CLASSES[n];
  if (!C) return null;
  const s = new C(champ);
  s.sid = n;
  return s;
}

/**
 * Spell.getRandomId — quel sort un parchemin va-t-il enseigner ? On ne retient
 * que ceux que la fée peut porter (son niveau) et payer (son mana × 2), puis on
 * tire au poids. C'est ce qui fait qu'une jeune fée n'apprend que des petits
 * sorts, même sur un parchemin trouvé tard.
 */
function idAleatoire(fi, hasard) {
  const tirage = hasard || ((n) => Math.floor(Math.random() * n));
  const liste = [];
  let somme = 0;
  for (const o of TABLE) {
    if (nombre(fi.fs.$level) < o.min) continue;
    if (nombre(fi.carac[5]) * 2 < o.cost) continue;
    liste.push(o);
    somme += o.freq;
  }
  if (somme <= 0) return null;
  const n = tirage(somme);
  let s = 0;
  for (const o of liste) {
    s += o.freq;
    if (s > n) return o.id;
  }
  return null;
}

// Imp.getSpell : la table de tirage vit dans combat.js, ici seulement la
// fabrique.
function nouveauSortImpy(nom, champ) {
  const C = CLASSES_IMPY[nom];
  return C ? new C(champ) : null;
}

const API = {
  Sort, Tir, SortImpy, TABLE, CLASSES, CLASSES_IMPY,
  nouveauSort, nouveauSortImpy, idAleatoire,
  ChuteJetons, Lien, Fumee, Mur, Armure, Conglomerat, GrandeForme, Nuit, Origine,
  SchemeDeDimitri, PercePuits, Dactylo, Meteore, GobeurDePerles, Depressurisation,
  ValseFossile, Ascension, Exaltation, TrancheCimes, Silence, Tremblement, Cloche,
  SuperNova, Bannissement, BillesDeLumiere, Pigmentation,
  TirBilles, TirLaser, TirSolero, TirMeches, TirGlumelle, TirClametorche,
  TirDamaide, TirAmeEnPeine,
};

if (typeof module !== 'undefined' && module.exports) module.exports = API;
else racine.MinipixizSorts = API;

})(typeof window !== 'undefined' ? window : globalThis);
