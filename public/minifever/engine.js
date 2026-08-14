/*
 * MiniFever — le SOCLE, porté des sources « mt » de Motion Twin.
 *
 * MiniFever est un jeu de mini-jeux : des épreuves de trois à cinq secondes qui
 * s'enchaînent, une consigne implicite, un timer qui descend, gagné ou perdu, au
 * suivant. Il n'a jamais été mis en ligne ; il en reste les sources (Games/
 * miniFever/src) et un SWF de développement dont on a sorti les dessins.
 *
 * Le contrat d'un mini-jeu est minuscule, et c'est ce qui rend le portage
 * praticable — Game.mt :
 *
 *   gameTime      la durée de l'épreuve, en images
 *   init()        pose le décor et les acteurs
 *   update()      une image de jeu
 *   click()       le doigt se pose        release()  il se lève
 *   gagne(bool)   l'épreuve est jouée — le socle enchaîne
 *
 * Ce fichier porte ce contrat et ce qu'il y a dessous : la liste d'affichage
 * (l'équivalent des MovieClip de Flash, réduit à ce dont les jeux se servent),
 * le sprite, la physique, et le SOCLE qui enchaîne les épreuves.
 *
 * Deux libertés prises sur l'original, assumées :
 *
 *   · `Timer.tmod` était une variable globale ; ici c'est `Temps.tmod`, posé par
 *     la boucle. Les mini-jeux le lisent de la même façon — on garde la lettre
 *     des sources, qui en sont truffées.
 *   · Flash faisait vivre les clips dans un arbre de profondeurs par
 *     `attachMovie`. On garde la PROFONDEUR (les jeux s'en servent pour passer
 *     un dessin devant un autre) sans l'arbre, dont aucun des vingt-sept jeux
 *     compilés n'a besoin.
 */
'use strict';

(function (racine) {

const sousNode = (typeof module !== 'undefined' && module.exports);

// La scène du SWF : 240 × 240 à 40 images par seconde (Cs.mcw / Cs.mch).
const LARGEUR = 240;
const HAUTEUR = 240;
const IPS = 40;

// Le multiplicateur de temps, lu par tous les mini-jeux. La boucle avance le
// moteur par pas d'UNE image nominale, donc il vaut 1 — mais les sources le
// citent partout, et le garder permet de porter leurs formules à la lettre.
const Temps = { tmod: 1 };

// Les couches de Game.mt, dans l'ordre où Flash les empilait.
const PROF = { FOND: 1, SPRITE2: 3, SPRITE: 4, PART: 6, DEVANT: 7 };

// Cs.mm : borner une valeur.
const borner = (min, n, max) => Math.min(Math.max(min, n), max);

/**
 * Un objet d'affichage — ce que `dm.attach("mcBasketBall", prof)` rendait.
 *
 * Il porte un dessin (`cle`, une entrée de sprites.json), l'image où il en est,
 * sa position et sa transformation. `jouer()`/`arreter()` pilotent sa pellicule
 * comme play()/stop() en AS2 : un clip qui joue avance d'une image par tour.
 */
class Mc {
  constructor(cle, prof) {
    this.cle = cle;
    this.prof = prof || 0;
    this.image = 1;
    this.joue = false;
    this.nbImages = 1;          // renseigné par la scène, d'après les dessins
    this.x = 0; this.y = 0;
    this.sx = 1; this.sy = 1;   // _xscale/_yscale, en fraction (100 % = 1)
    this.rot = 0;               // _rotation, en DEGRÉS comme en AS2
    this.alpha = 1;
    this.visible = true;
    this.vivant = true;
  }
  arreter() { this.joue = false; }
  jouer() { this.joue = true; }
  allerA(n) { this.image = borner(1, Math.round(n), this.nbImages); this.joue = false; }
  enlever() { this.vivant = false; }
  // Sprite.hTest : la boîte du dessin, comme getBounds(_parent). La scène pose
  // `boite` d'après les dessins extraits ; sans elle, un carré de 10.
  contient(x, y) {
    const b = this.boite || { x0: -10, y0: -10, x1: 10, y1: 10 };
    return x > this.x + b.x0 * this.sx && x < this.x + b.x1 * this.sx
      && y > this.y + b.y0 * this.sy && y < this.y + b.y1 * this.sy;
  }
  avancer() {
    if (!this.joue) return;
    this.image++;
    if (this.image > this.nbImages) this.image = 1;
  }
}

/**
 * La scène : la liste d'affichage d'un mini-jeu, tenue par profondeur.
 * C'est le DepthManager des sources, réduit à ce dont les jeux se servent.
 */
class Scene {
  constructor(mesures) {
    this.mcs = [];
    this.mesures = mesures || null;   // cle → { nbImages, boite }
    this.suivant = 1000;              // profondeurs libres, pour `devant`
  }
  attacher(cle, prof) {
    const mc = new Mc(cle, prof);
    const m = this.mesures && this.mesures[cle];
    if (m) { mc.nbImages = m.nbImages; mc.boite = m.boite; }
    this.mcs.push(mc);
    return mc;
  }
  // dm.over(mc) : passer un dessin devant tous les autres.
  devant(mc) { mc.prof = this.suivant++; }
  vider() { this.mcs.length = 0; }
  // L'ordre de tracé : par profondeur, puis par ordre d'arrivée.
  ordre() {
    return this.mcs.filter((m) => m.vivant && m.visible)
      .map((m, i) => ({ m, i }))
      .sort((a, b) => (a.m.prof - b.m.prof) || (a.i - b.i))
      .map((o) => o.m);
  }
  avancer() {
    for (let i = this.mcs.length - 1; i >= 0; i--) {
      if (!this.mcs[i].vivant) { this.mcs.splice(i, 1); continue; }
      this.mcs[i].avancer();
    }
  }
}

/** Sprite.mt : une position, un dessin, et sa place dans les listes du jeu. */
class Sprite {
  constructor(jeu, mc) {
    this.jeu = jeu;
    this.peau = mc;
    this.x = 0; this.y = 0;
    this.vivant = true;
  }
  init() {
    this.jeu.sprites.push(this);
    this.peau.x = this.x;
    this.peau.y = this.y;
  }
  update() { this.peau.x = this.x; this.peau.y = this.y; }
  tuer() {
    this.vivant = false;
    const i = this.jeu.sprites.indexOf(this);
    if (i >= 0) this.jeu.sprites.splice(i, 1);
    this.peau.enlever();
  }
  distance(o) { const dx = o.x - this.x, dy = o.y - this.y; return Math.sqrt(dx * dx + dy * dy); }
  angle(o) { return Math.atan2(o.y - this.y, o.x - this.x); }
  contient(x, y) { return this.peau.contient(x, y); }
  // Sprite.toward : se rapprocher d'un point, d'une fraction du chemin.
  vers(o, c, lim) {
    const l = (lim === undefined || lim === null) ? Infinity : lim;
    const dx = o.x - this.x, dy = o.y - this.y;
    this.x += borner(-l, dx, l) * c * Temps.tmod;
    this.y += borner(-l, dy, l) * c * Temps.tmod;
  }
}

/** sp/Phys.mt : le sprite qui tombe, glisse et rebondit. */
class Phys extends Sprite {
  constructor(jeu, mc) {
    super(jeu, mc);
    this.vitx = 0; this.vity = 0;
    this.vitr = null;
    this.poids = 1;
    this.friction = null;
    this.flPhys = true;
  }
  update() {
    if (this.flPhys) this.vity += (this.jeu.gravite * this.poids) * Temps.tmod;
    const f = (this.friction !== null && this.friction !== undefined)
      ? this.friction : this.jeu.airFrict;
    this.vitx *= f;
    this.vity *= f;
    this.x += this.vitx * Temps.tmod;
    this.y += this.vity * Temps.tmod;
    if (this.vitr !== null && this.vitr !== undefined) {
      this.vitr *= this.jeu.airFrict;
      this.peau.rot += this.vitr;
    }
    super.update();
  }
  alignerRot() { this.peau.rot = Math.atan2(this.vity, this.vitx) / 0.0174; }
  versVitesse(t, c, lim) {
    const dx = t.x - this.x, dy = t.y - this.y;
    this.vitx += borner(-lim, dx * c * Temps.tmod, lim);
    this.vity += borner(-lim, dy * c * Temps.tmod, lim);
  }
  // Phys.checkBounds : rebondir sur les murs de la scène.
  bornes(c, m, b) {
    const coef = (c === undefined || c === null) ? -1 : c;
    const marge = m || 0;
    const boite = b || { xMin: 0, xMax: LARGEUR, yMin: 0, yMax: HAUTEUR };
    if (this.x < boite.xMin + marge || this.x > boite.xMax - marge) {
      this.x = borner(boite.xMin + marge, this.x, boite.xMax - marge);
      this.vitx *= coef;
    }
    if (this.y < boite.yMin + marge || this.y > boite.yMax - marge) {
      this.y = borner(boite.yMin + marge, this.y, boite.yMax - marge);
      this.vity *= coef;
    }
  }
}

/** sp/phys/Part.mt : la particule — un phys qui s'efface tout seul. */
class Part extends Phys {
  constructor(jeu, mc) {
    super(jeu, mc);
    this.minuteur = null;         // `timer`
    this.fonduSeuil = 10;         // `timerFadeLimit`
    this.fonduType = 0;           // 0 alpha, 1 échelle, 2 hauteur
    this.echelle = 100;           // `scale`, en pourcentage comme en AS2
  }
  init() {
    super.init();
    this.peau.sx = this.echelle / 100;
    this.peau.sy = this.echelle / 100;
  }
  update() {
    super.update();
    if (this.minuteur === null || this.minuteur === undefined) return;
    this.minuteur -= Temps.tmod;
    if (this.minuteur < 0) { this.tuer(); return; }
    if (this.minuteur >= this.fonduSeuil) return;
    const c = this.minuteur / this.fonduSeuil;
    switch (this.fonduType) {
      case 0: this.peau.alpha = c; break;
      case 1: this.peau.sx = c * this.echelle / 100; this.peau.sy = this.peau.sx; break;
      case 2: this.peau.sy = c * this.echelle / 100; break;
      default: break;
    }
  }
}

/**
 * Game.mt : une ÉPREUVE. Elle pose son décor, avance d'une image à la fois, et
 * se termine par `gagne(true|false)` — ou par le temps qui s'épuise.
 */
class Jeu {
  constructor(socle) {
    this.socle = socle;
    this.scene = new Scene(socle ? socle.mesures : null);
    this.sprites = [];
    this.gameTime = 200;          // en images ; chaque jeu pose la sienne
    this.dif = socle ? socle.dif : 0;
    this.etape = 0;               // `step` des sources
    this.etapePrincipale = 0;     // `mainStep`
    this.gagnant = null;
    this.finTimer = 0;
    this.airFriction = 0.99;
    this.airFrict = 0.99;
    this.gravite = 1;
    this.flGelResultat = false;
    this.flHorsTemps = false;
    this.decalY = 0;              // le jeu peut faire défiler sa scène (Basket)
  }
  init() { this.etape = 1; this.etapePrincipale = 1; }
  click() {}
  relache() {}
  update() {
    this.airFrict = Math.pow(this.airFriction, Temps.tmod);
    for (const s of this.sprites.slice()) s.update();
    if (this.etapePrincipale === 2) {
      if (this.finTimer < 0) {
        this.etapePrincipale = 3;
        if (this.socle) this.socle.resultat(this.gagnant);
      } else {
        this.finTimer -= Temps.tmod;
      }
    }
  }
  /** Le verdict. Une épreuve ne se juge qu'une fois. */
  gagne(flag) {
    if (this.etapePrincipale !== 1 || this.flGelResultat) return;
    this.etapePrincipale = 2;
    this.gagnant = !!flag;
    this.finTimer = 16;
  }
  horsTemps() { if (!this.flHorsTemps) this.gagne(false); }
  // Les fabriques des sources : newSprite / newPhys.
  nouveauSprite(cle, prof) {
    const s = new Sprite(this, this.scene.attacher(cle, prof === undefined ? PROF.SPRITE : prof));
    return s;
  }
  nouveauPhys(cle, prof) {
    const s = new Phys(this, this.scene.attacher(cle, prof === undefined ? PROF.SPRITE : prof));
    return s;
  }
  nouvellePart(cle, prof) {
    const s = new Part(this, this.scene.attacher(cle, prof === undefined ? PROF.PART : prof));
    return s;
  }
  attacher(cle, prof) { return this.scene.attacher(cle, prof); }

  /*
   * `this._xmouse` / `this._ymouse` des sources : la souris dans le repère du
   * mini-jeu. Le clip est posé en 0,0 sur la scène, au décalage vertical près —
   * la moitié des vingt-sept jeux compilés s'en sert, aucun n'a besoin du
   * clavier.
   */
  get sourisX() { return this.socle ? this.socle.souris.x : LARGEUR / 2; }
  get sourisY() { return (this.socle ? this.socle.souris.y : HAUTEUR / 2) - this.decalY; }
  /** Un tirage flottant, pour `Math.random()`. */
  aleatoire() { return this.socle ? this.socle.rng() : Math.random(); }
}

/**
 * Base.mt : le SOCLE. Il enchaîne les épreuves — une transition, un tirage, le
 * temps qui descend, le verdict, le fondu (blanc gagné, rouge perdu), la suite.
 */
class Socle {
  constructor(o) {
    o = o || {};
    this.mesures = o.mesures || null;
    this.catalogue = o.catalogue || [];      // [{ cle, Classe }]
    this.rng = o.rng || Math.random;
    this.surEvenement = o.surEvenement || null;
    this.dif = 0;
    this.jeu = null;
    this.flPresse = false;
    this.flTimer = false;
    this.timer = 0;
    this.timerMax = 1;
    this.fondu = { couleur: 0xFFFFFF, prc: 100, cible: null };
    this.suivant = null;
    this.termine = false;
    this.souris = { x: LARGEUR / 2, y: HAUTEUR / 2 };
  }
  hasard(n) { return Math.floor(this.rng() * n); }
  evenement(nom, d) { if (this.surEvenement) this.surEvenement(nom, d || {}); }

  /** L'entrée : un jeu tiré au sort, puis on enchaîne. */
  demarrer() { this.tirer(); this.lancer(); }

  tirer() {
    if (!this.catalogue.length) return;
    this.suivant = this.catalogue[this.hasard(this.catalogue.length)];
  }

  /** Base.newGame() : le jeu tiré prend la main, et son chrono démarre. */
  lancer() {
    if (!this.suivant) return;
    if (this.jeu) this.jeu.scene.vider();
    this.jeu = new this.suivant.Classe(this);
    this.jeu.dif = this.dif;
    this.jeu.init();
    this.timerMax = this.jeu.gameTime;
    this.timer = this.timerMax;
    this.flTimer = true;
    this.evenement('jeu', { cle: this.suivant.cle, dif: this.dif });
  }

  /** Base.closeGame() : l'épreuve quitte la scène. */
  fermer() { if (this.jeu) { this.jeu.scene.vider(); this.jeu = null; } this.flTimer = false; }

  click() {
    if (this.flPresse) return;         // Base.initMouse : un seul appui à la fois
    this.flPresse = true;
    if (this.jeu) this.jeu.click();
  }
  relache() {
    if (!this.flPresse) return;
    this.flPresse = false;
    if (this.jeu) this.jeu.relache();
  }
  /** La souris, en coordonnées de scène (240 × 240). */
  bouger(x, y) { this.souris.x = x; this.souris.y = y; }

  update(tmod) {
    Temps.tmod = tmod;
    if (this.jeu) { this.jeu.update(); this.jeu.scene.avancer(); }
    if (this.fondu.cible !== null) this.majFondu();
    if (this.flTimer && this.jeu) {
      this.timer -= tmod;
      if (this.timer < 0) { this.jeu.horsTemps(); this.timer = 0; }
    }
  }

  /** Le verdict d'une épreuve — repris par les modes pour compter. */
  resultat(gagne) {
    this.flTimer = false;
    this.evenement('resultat', { gagne: !!gagne });
    this.fonduSortant(gagne ? 0xFFFFFF : 0xFF0000);
  }

  fonduSortant(couleur) { this.fondu.couleur = couleur; this.fondu.cible = 0; }
  fonduEntrant() { this.fondu.cible = 100; }
  majFondu() {
    const d = this.fondu.cible - this.fondu.prc;
    this.fondu.prc += d * 0.4 * Temps.tmod;
    if (Math.abs(this.fondu.prc - this.fondu.cible) < 1) {
      this.fondu.prc = this.fondu.cible;
      this.fondu.cible = null;
      if (this.fondu.prc === 0) this.apresFondu();
    }
  }
  /** Le fondu s'est refermé : au mode de dire ce qui vient ensuite. */
  apresFondu() { this.tirer(); this.lancer(); }
}

/**
 * base/Arcade.mt : le mode principal. On CHOISIT sa difficulté au menu ; elle
 * fixe le nombre d'épreuves à enchaîner et le nombre de vies. La difficulté
 * d'une épreuve (`dif`, que chaque mini-jeu lit pour se durcir) monte
 * linéairement de `min` à `max` au fil des épreuves RÉUSSIES : rater ne fait pas
 * reculer, ça coûte une vie. Zéro vie, c'est fini ; aller au bout du palier,
 * c'est gagné (l'original affichait alors son écran de félicitations).
 *
 * Les noms des quatre paliers sont ceux de Lang.DIF_LEVEL. DIF_INFO en compte
 * cinq, mais Cm.finishArcade() n'en débloque que quatre — le cinquième n'a
 * jamais servi.
 */
const PALIERS = [
  { nom: 'facile', lvl: 40, vies: 7, min: 0, max: 40 },
  { nom: 'normal', lvl: 80, vies: 6, min: 0, max: 60 },
  { nom: 'difficile', lvl: 100, vies: 5, min: 0, max: 100 },
  { nom: 'infernal', lvl: 100, vies: 4, min: 50, max: 100 },
  { lvl: 40, vies: 3, min: 0, max: 40 },
];

// Les temps de la console, en images (Arcade.initStep).
const T_DEBRIEF = 40;
const T_BRIEF = 20;

class Arcade extends Socle {
  constructor(o) {
    super(o);
    this.palier = (o && o.palier) || 0;
    const p = PALIERS[Math.min(this.palier, PALIERS.length - 1)];
    this.niveau = 0;               // épreuves RÉUSSIES
    this.vies = p.vies;
    this.jouees = 0;
    this.etape = 3;                // 0 rien, 1 débriefing, 2 tirage, 3 briefing
    this.minuteur = T_BRIEF;
    this.toss = 0;
    this.gagnee = false;           // le palier est allé à son terme
    this.derniere = null;          // le verdict de l'épreuve qu'on vient de jouer
  }

  get info() { return PALIERS[Math.min(this.palier, PALIERS.length - 1)]; }

  demarrer() { this.tirer(); this.initEtape(3); }

  /** Arcade.incLevel : la difficulté monte avec les épreuves réussies. */
  monter() {
    this.niveau++;
    const o = this.info;
    if (this.niveau >= o.lvl) {
      this.gagnee = true;
      this.termine = true;
      this.evenement('finPartie', this.bilan());
      return;
    }
    this.dif = o.min + Math.round((o.max - o.min) * (this.niveau / o.lvl));
  }

  bilan() {
    return { gagnee: this.gagnee, palier: this.palier, nom: this.info.nom,
      niveau: this.niveau, objectif: this.info.lvl, vies: this.vies,
      jouees: this.jouees, dif: this.dif };
  }

  initEtape(n) {
    this.etape = n;
    switch (n) {
      case 1:                       // DÉBRIEFING : le verdict s'affiche
        this.flTimer = false;
        if (this.derniere) this.monter(); else this.vies--;
        this.minuteur = T_DEBRIEF;
        break;
      case 2:                       // TIRAGE : la vignette défile
        this.tirer();
        this.toss = 10;
        break;
      case 3:                       // BRIEFING : on annonce l'épreuve
        this.minuteur = T_BRIEF;
        break;
      default: break;
    }
  }

  update(tmod) {
    super.update(tmod);
    if (this.termine) return;
    switch (this.etape) {
      case 1:
        this.minuteur -= tmod;
        if (this.minuteur < 0) {
          if (this.vies > 0) this.initEtape(2);
          else { this.termine = true; this.evenement('finPartie', this.bilan()); }
        }
        break;
      case 2:
        this.toss -= Math.max(0.05, this.toss * 0.05) * tmod;
        if (this.toss < 0) { this.toss = 0; this.initEtape(3); }
        break;
      case 3:
        this.minuteur -= tmod;
        if (this.minuteur < 0) { this.fonduSortant(0xFFFFFF); this.initEtape(0); }
        break;
      default: break;
    }
  }

  /** Le verdict d'une épreuve : on referme, puis la console reprend la main. */
  resultat(gagne) {
    this.jouees++;
    this.derniere = !!gagne;
    super.resultat(gagne);
  }

  /** Le fondu s'est refermé — sur la fin d'une épreuve, ou sur un briefing. */
  apresFondu() {
    if (this.derniere !== null) {   // on sort d'une épreuve : place à la console
      this.fermer();
      this.initEtape(1);
      this.derniere = null;
    } else {                        // on sort du briefing : place à l'épreuve
      this.lancer();
    }
    this.fonduEntrant();
  }
}

const API = { Mc, Scene, Sprite, Phys, Part, Jeu, Socle, Arcade, Temps,
  LARGEUR, HAUTEUR, IPS, PROF, PALIERS, borner };

if (sousNode) module.exports = API;
else racine.MinifeverEngine = API;

})(typeof window !== 'undefined' ? window : globalThis);
