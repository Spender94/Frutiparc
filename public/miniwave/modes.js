/*
 * Miniwave 2 — les trois autres modes de jeu.
 *
 * L'arcade (miniwave.game.Main) est déjà dans engine.js. Le jeu en compte trois
 * de plus, tous bâtis sur le même moteur de vague :
 *
 *   • MISSION   (miniwave.game.Mission)  — un parcours court et nommé, avec une
 *     prime en crédits à la clé et une distribution de bonus resserrée : ni
 *     sauts de niveau ni presque de vies, puisque le parcours est justement
 *     fait pour être terminé. C'est ce mode qui alimente $cons.$bonus, donc les
 *     pictos de mission.
 *
 *   • SURVIVAL  (miniwave.game.Survival) — pas de parcours du tout : des lignes
 *     de fruits tombent sans fin, une nouvelle dès que la précédente est
 *     descendue, et la difficulté monte avec le temps. Une seule vie.
 *
 *   • LETTER    (miniwave.game.Letter)   — on ne tire plus : chaque monstre
 *     porte une lettre ou un chiffre, et c'est la touche du clavier qui le
 *     détruit. Quatre boucliers, perdus un par un sur une faute de frappe.
 *     Les enchaînements rapportent le carré du nombre de touches réussies.
 *
 * Une correction assumée, dans Survival — voir SURVIVAL_MONTEE_EN_DIFFICULTE.
 */
'use strict';

(function (racine) {

const E = (typeof module !== 'undefined' && module.exports)
  ? require('./engine.js')
  : racine.MiniwaveEngine;

const { Game, ETAPE, LARGEUR, HAUTEUR } = E;

// ── MISSION ────────────────────────────────────────────────────────────────
// Mission.genOptionList : la table de bonus des missions. Comparée à celle de
// l'arcade, les trois sauts de niveau tombent à zéro — sauter un niveau d'un
// parcours de quarante n'aurait aucun sens, et fausserait le pourcentage
// d'achèvement dont dépend la prime.
const BONUS_MISSION = [40, 20, 5, 1, 0, 0, 0, 5, 5, 5, 8];

class Mission extends Game {
  /**
   * @param {object} o  comme Game, plus :
   *   missionNum  index de la mission (0 à 4) — c'est lui qui indexe
   *               $cons.$bonus, donc le picto $mis{n}
   *   prime       crédits versés quand la mission est bouclée à 100 %
   */
  constructor(o) {
    super(o);
    this.mode = 'mission';
    this.missionNum = (o && o.missionNum) || 0;
    this.prime = (o && o.prime) || 0;
    this.nom = (o && o.nom) || '';
  }

  // Même tirage pondéré que le moteur, sur l'autre table.
  typeDeBonus() {
    const total = BONUS_MISSION.reduce((a, b) => a + b, 0);
    const n = this.hasard(total);
    let cumul = 0;
    for (let i = 0; i < BONUS_MISSION.length; i++) {
      cumul += BONUS_MISSION[i];
      if (cumul > n) return i;
    }
    return 0;
  }

  // Mission.getEndMsg : la prime n'est versée qu'une fois, à la première
  // mission bouclée entièrement. `consAcquis` est ce que porte déjà la fiche.
  primeGagnee(consAcquis) {
    return (this.getCons() >= 100 && (consAcquis || 0) < 100) ? this.prime : 0;
  }

  finPartie(raison) {
    if (this.flGameOver) return;
    this.cons = this.getCons();
    super.finPartie(raison);
  }
}

// ── SURVIVAL ───────────────────────────────────────────────────────────────
const SURVIVAL_SEUIL_SPAWN = 48;     // Survival.spawnLimit
const SURVIVAL_TYPE_MAX = 45;        // Survival.badsTypeMax
const SURVIVAL_ESPACE = 24;          // Survival.waveSpace
const SURVIVAL_PALIER = 800;         // durée du premier palier, en images

// SURVIVAL_MONTEE_EN_DIFFICULTE
// ------------------------------
// L'original écrit, dans initStep(2) :
//
//     this.levelTimerFull = 800;
//     this.levelTimer = this.levelTimer;     // ← lui-même, jamais initialisé
//
// `levelTimer` vaut donc undefined, `undefined <= 0` est faux, la soustraction
// suivante en fait NaN, et `NaN <= 0` est faux pour toujours : levelUp() n'est
// JAMAIS appelé. Le mode reste bloqué au palier 0 — quatre colonnes, vitesse
// 0,6, et seulement les trois premières espèces du bestiaire, indéfiniment.
//
// C'est une faute de frappe (`levelTimer` pour `levelTimerFull`), pas une
// intention : tout le reste du fichier — levelUp(), la largeur en racine du
// palier, la vitesse qui croît, le plafond à 45 espèces — n'existe que pour
// être atteint. Elle est passée inaperçue parce que le mode s'achète en
// boutique et que personne n'a joué assez longtemps pour trouver ça anormal.
//
// On porte donc l'intention, pas la coquille, et ce choix est vérifié par un
// test. Sans lui, « Endurance » serait un mode qui ne monte jamais.
class Survival extends Game {
  constructor(o) {
    o = Object.assign({}, o);
    // Survival.init : une seule vie, et pas de parcours.
    if (o.vies === undefined) o.vies = 1;
    o.levels = [];
    super(o);
    this.mode = 'survival';
    this.waveWidth = 4;
    this.paliersuivant = SURVIVAL_PALIER;
    this.levelTimer = SURVIVAL_PALIER;
    this.initStep(ETAPE.COMBAT);
  }

  // Le mode n'a ni panneau ni transition : on tombe directement en combat.
  initStep(step) {
    if (step !== ETAPE.COMBAT) return;
    this.step = ETAPE.COMBAT;
    this.initLevel();
    this.verifierHero();
  }

  /**
   * Survival.onHeroKill — l'endurance ne connaît PAS la retraite de la vague.
   *
   * Le mode n'a pas de grille d'entrée : ses rangées naissent en haut de
   * l'écran et descendent, il n'y a donc aucune case de départ où renvoyer
   * quiconque. L'original le dit en clair — game.Survival redéfinit
   * onHeroKill et se contente de décompter la vie, là où game.Main (arcade et
   * missions) fait battre l'escadre en retraite.
   */
  onHeroKill() {
    this.evenement('viePerdue', { restant: this.heroList.length });
  }

  // Trois rangées pour commencer, centrées.
  initLevel() {
    this.waveSens = 1;
    this.flChangeSens = false;
    this.shipBounds = { min: 0, max: LARGEUR };
    this.fallSpeed = 5;
    this.waveSpeed = 0.6;
    this.badsList = [];
    this.waveIndex = 0;
    this.toKill = 0;
    for (let y = 0; y < 3; y++) this.poserLigne((y + 1) * SURVIVAL_ESPACE, 0);
  }

  // Survival.genNewLine : une rangée de plus. `plongeon` est la hauteur d'où
  // elle descend — les rangées ajoutées en cours de partie arrivent d'au-dessus
  // de l'écran, la formation de départ est déjà en place.
  poserLigne(ty, plongeon) {
    const dx = (LARGEUR - this.waveWidth * SURVIVAL_ESPACE) / 2;
    for (let x = 0; x < this.waveWidth; x++) {
      const type = this.hasard(Math.min(this.level + 3, SURVIVAL_TYPE_MAX));
      const b = this.newBads(type, { x: dx + x * SURVIVAL_ESPACE, y: ty - plongeon });
      b.ty = ty;
      b.flReady = true;               // pas de vol d'entrée : la vague est déjà là
    }
  }

  // Survival.checkLast : dès que la rangée la plus haute est descendue sous le
  // seuil, on en pose une nouvelle au-dessus. C'est ce qui rend le mode sans fin.
  verifierDerniere() {
    let y = HAUTEUR;
    for (let i = 0; i < this.badsList.length; i++) y = Math.min(y, this.badsList[i].ty);
    if (y > SURVIVAL_SEUIL_SPAWN) this.poserLigne(SURVIVAL_ESPACE, 40);
  }

  // Survival.levelUp : le palier suivant dure 10 % de plus, la formation
  // s'élargit en racine du palier (plafonnée à huit) et la vague accélère.
  // Le tirage des espèces monte lui aussi : palier+3, jusqu'à 45.
  monterDUnPalier() {
    this.level++;
    this.paliersuivant *= 1.1;
    this.levelTimer = this.paliersuivant;
    this.waveWidth = Math.min(3 + Math.floor(Math.sqrt(this.level)), 8);
    this.waveSpeed = 0.6 + this.level * 0.03;
    this.evenement('palier', { level: this.level, largeur: this.waveWidth, vitesse: this.waveSpeed });
  }

  update(tmod) {
    if (this.termine) return;
    if (tmod === undefined) tmod = 1;
    this.frict = Math.pow(E.FRICTION, tmod);

    this.verifierDerniere();
    this.verifierEvenement(tmod);
    this.updateWave(tmod);
    if (this.levelTimer <= 0) this.monterDUnPalier();
    else this.levelTimer -= tmod;

    this.bougerTout(tmod);
    this.rangerMorts();

    if (!this.hero && !this.flGameOver) {
      if (this.heroList.length === 0) this.finPartie('gameover');
      else this.verifierHero();
    }
  }

  // Il n'y a pas de parcours : le « pourcentage » du mode n'a pas de sens.
  getCons() { return 0; }
}

// ── LETTER ─────────────────────────────────────────────────────────────────
const LETTER_BOUCLIERS = 4;          // lifePanel.addLife(4)
const LETTER_COMBO = 8;              // Letter.comboTimer
const LETTER_TYPE = 50;              // le Letter-monster du bestiaire

// Letter.translateCode : le code interne (0 à 35) devient un caractère affiché
// et une ou deux touches acceptées. Les chiffres se tapent au pavé numérique
// comme en haut du clavier — d'où les deux codes.
function traduireCode(code) {
  if (code >= 0 && code < 26) return { affiche: code + 65, touches: [code + 65] };
  return { affiche: 22 + code, touches: [22 + code, 70 + code] };
}

// Letter.pushKey : lettres, chiffres du haut, pavé numérique. La touche P est
// écartée : c'est celle de la pause.
function toucheJouable(c) {
  if (c === 80) return false;
  return (c >= 65 && c < 91) || (c > 48 && c < 58) || (c > 96 && c < 106);
}

class Letter extends Game {
  constructor(o) {
    super(o);
    this.mode = 'letter';
    this.boucliers = LETTER_BOUCLIERS;
    this.combo = null;
  }

  // Letter.newBads : le type est imposé (Letter-monster), et chaque monstre
  // tire son caractère. Au-delà du niveau 10 les chiffres entrent dans le jeu.
  // Deux codes sont écartés : 15 (« P », réservée à la pause) et 26 (« 0 »,
  // trop proche du « O » à l'écran).
  newBads(type, o) {
    let code;
    do {
      code = this.hasard(this.level > 10 ? 36 : 26);
    } while (code === 15 || code === 26);
    const b = super.newBads(LETTER_TYPE, o);
    b.code = code;
    const t = traduireCode(code);
    b.affiche = String.fromCharCode(t.affiche);
    b.touches = t.touches;
    return b;
  }

  // La frappe du joueur. Renvoie ce qui s'est passé, pour que le client puisse
  // réagir (son, secousse) sans relire l'état du jeu.
  frapper(c) {
    if (this.flGameOver || this.step === ETAPE.PANNEAU || this.step === ETAPE.SUIVANT) return null;
    if (!toucheJouable(c)) return null;
    for (let i = 0; i < this.badsList.length; i++) {
      const b = this.badsList[i];
      if (b.touches && b.touches.indexOf(c) !== -1) { this.toucher(b); return { touche: true, cible: b }; }
    }
    this.boucliers--;
    this.evenement('faute', { restant: this.boucliers });
    if (this.boucliers <= 0) this.finPartie('gameover');
    return { touche: false };
  }

  // Letter.hit : le monstre explose, et l'enchaînement se prolonge.
  toucher(b) {
    b.exploser();
    if (this.combo) {
      this.combo.num++;
      this.combo.timer = LETTER_COMBO;
    } else {
      this.combo = { num: 1, timer: LETTER_COMBO };
    }
    this.evenement('combo', { num: this.combo.num });
  }

  // Letter.checkCombo : l'enchaînement se clôt tout seul. Deux touches ou plus
  // d'affilée rapportent le carré du compte, en dizaines.
  verifierCombo(tmod) {
    if (!this.combo) return;
    if (this.combo.timer < 0) {
      if (this.combo.num > 1) {
        const points = Math.pow(this.combo.num, 2) * 10;
        this.incScore(points);
        this.evenement('comboFini', { num: this.combo.num, points });
      }
      this.combo = null;
      return;
    }
    this.combo.timer -= tmod;
  }

  // Letter.updateWave : ici, un monstre qui touche le bas met fin à la partie —
  // il n'y a pas de vaisseau à perdre, seulement la ligne à tenir.
  updateWave(tmod) {
    super.updateWave(tmod);
    for (let i = 0; i < this.badsList.length; i++) {
      const b = this.badsList[i];
      if (b.y + b.ray > HAUTEUR) { this.finPartie('gameover'); return; }
    }
  }

  // Letter.checkEnd : on ne passe au niveau suivant qu'une fois l'enchaînement
  // clos — ses points ne sont comptés qu'à ce moment-là. Et pas de soucoupe :
  // elle n'apporte que des bonus de tir, dont ce mode n'a que faire.
  peutAvancer() { return this.toKill <= 0 && !this.combo; }
  avecSoucoupe() { return false; }

  update(tmod) {
    if (tmod === undefined) tmod = 1;
    // L'ordre compte : l'original teste la fin du niveau AVANT de faire courir
    // l'enchaînement, si bien qu'un combo tout juste expiré retient encore le
    // passage d'une image. On garde ce décalage.
    super.update(tmod);
    if (this.step === ETAPE.ARRIVEE || this.step === ETAPE.COMBAT) this.verifierCombo(tmod);
  }
}

const API = { Mission, Survival, Letter, BONUS_MISSION, traduireCode, toucheJouable,
  SURVIVAL_SEUIL_SPAWN, SURVIVAL_ESPACE, SURVIVAL_PALIER, LETTER_BOUCLIERS, LETTER_COMBO };

if (typeof module !== 'undefined' && module.exports) module.exports = API;
else racine.MiniwaveModes = API;

})(typeof window !== 'undefined' ? window : globalThis);
