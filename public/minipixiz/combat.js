/*
 * Minipixiz (miniTroll) — ce qui vole au-dessus du plateau.
 *
 * Traduction de Sprite.mt, sp/Part.mt, sp/part/Shot.mt, sp/People.mt,
 * sp/pe/Faerie.mt et sp/pe/Imp.mt.
 *
 * Le puzzle (engine.js) ne sait rien de tout ça : il fait tomber des pièces et
 * casse des groupes. Par-dessus lui vit une seconde partie, en temps réel — une
 * fée, des impys, leurs tirs et leurs charges. Les deux se touchent en trois
 * points, et trois seulement :
 *
 *   1. une cellule cassée LIBÈRE un impy ;
 *   2. la fée LANCE un sort, qui a le droit de toucher la grille — c'est le
 *      seul moment où la partie s'interrompt pour lui laisser la main
 *      (ETAPE.MAGIE) ;
 *   3. un impy mort DONNE de l'expérience à la fée.
 *
 * ── Deux classes s'appellent « Fee » ──
 *
 * Dans le fichier d'origine, `FaerieInfo` est la FICHE (ce que la sauvegarde
 * retient : nom, niveau, caractéristiques) et `sp.pe.Faerie` est la fée qui
 * VOLE. On garde la même séparation : la fiche est `MinipixizFee.Fee`, la
 * voltigeuse est `MinipixizCombat.Fee`. La seconde tient la première dans son
 * champ `fi`, comme l'original.
 *
 * ── Le hasard ──
 *
 * L'original tire sur le hasard global de Flash. Ici tout passe par le tirage
 * SEMÉ de la partie (`jeu.hasard`), si bien qu'une même graine rejoue le même
 * combat — c'est ce qui rend ce fichier vérifiable sous Node.
 */
'use strict';

(function (racine) {

const sousNode = (typeof module !== 'undefined' && module.exports);
const E = sousNode ? require('./engine.js') : racine.MinipixizEngine;
// sorts.js et ce fichier se citent l'un l'autre : la fée a besoin de ses sorts,
// et un sort a besoin de tirer. On résout donc à l'APPEL, jamais au chargement.
function sorts() { return sousNode ? require('./sorts.js') : racine.MinipixizSorts; }

// ── Les constantes (Cs) ───────────────────────────────────────────────────
const FRICT = 0.95;               // Cs.frict, appliqué par image
const BASE_TIR = 180;             // Cs.shootBase
const BASE_CHARGE = 260;          // Cs.dashBase
const CADENCE_SORT_IMPY = 400;    // Cs.impSpellRate

// Cs : les six caractéristiques, dans l'ordre du fichier de sauvegarde. Le
// fichier d'origine appelle la cinquième « WISDOM » ; le jeu, lui, l'affiche
// sous le nom de concentration — c'est le même nombre.
const FORCE = 0, RAPIDITE = 1, VIE = 2, INTELLIGENCE = 3, CONCENTRATION = 4, MANA = 5;

// Cs.POW_* — les pouvoirs spéciaux qu'un objet porté peut donner.
const POUVOIR = {
  INVISIBILITE: 0, PEUR: 1, REGEN_VIE: 2, REGEN_MANA: 3, EXP: 4, BERSERK: 5, TOTOCHE: 6,
};

// Cs.SILENCE… — les états visibles au-dessus d'une tête.
const STATUT = { SILENCE: 0, POISON: 1, MORAL: 10, SOIN: 11, ENGOURDIE: 12, MALADE: 13 };

// Cs.impColorList : chaque rang d'impy a sa peau et ses ailes.
const COULEURS_IMPY = [
  [0xE2EB3F, 0xA3D51E],
  [0xFF9900, 0xD87C0E],
  [0x9F0B0B, 0xE21010],
  [0x540505, 0x9F0B0B],
  [0x000000, 0xF9E266],
];

/**
 * Les clips qui SE JOUENT puis s'effacent.
 *
 * Dans le fichier Flash, ces clips-là finissent leur scénario par un
 * `removeMovieClip()` — c'est pour cela que le code d'origine les lance sans
 * jamais leur donner de durée : le clip s'occupe de disparaître. Une traînée
 * naît à CHAQUE image d'un tir ; sans ce nettoyage, elles s'accumuleraient
 * jusqu'à noyer l'écran.
 *
 * Les autres clips sans durée — l'étoile de la Dactylo, les billes de la
 * Cloche, le trou noir — bouclent au contraire et attendent qu'un sort les
 * range : ils ne sont pas dans cette liste, et c'est voulu.
 *
 * La durée est le nombre d'images du clip, relevé dans root.swf.
 */
const EPHEMERES = {
  partQueueStandard: 12, partQueuePhantom: 8, partJet: 48, partMiniExplosion: 12,
  partOnde: 4, partBlackJuice: 15, partConcentrationRay: 11, partDeadImp: 12,
};

const nombre = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
const borner = (a, v, b) => Math.min(Math.max(a, v), b);

// Cs.round : ramène un écart d'angle dans ]-π, π].
function ramener(a, lim) {
  let v = a;
  while (v > lim) v -= lim * 2;
  while (v < -lim) v += lim * 2;
  return v;
}

// ── Sprite.mt ─────────────────────────────────────────────────────────────
//
// La base de tout ce qui bouge : une position, et de quoi viser autre chose.
class Corps {
  constructor(champ) {
    this.champ = champ;
    this.jeu = champ ? champ.jeu : null;
    this.x = 0;
    this.y = 0;
    this.vivant = true;
    this.listes = [];
  }

  ajouterA(liste) { liste.push(this); this.listes.push(liste); }

  tuer() {
    this.vivant = false;
    for (const l of this.listes) {
      const i = l.indexOf(this);
      if (i >= 0) l.splice(i, 1);
    }
    this.listes = [];
  }

  distance(o) {
    const dx = o.x - this.x, dy = o.y - this.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  angle(o) { return Math.atan2(o.y - this.y, o.x - this.x); }

  // Sprite.toward : on GLISSE vers la cible, sans passer par la vitesse.
  vers(o, c, tmod) {
    this.x += (o.x - this.x) * c * tmod;
    this.y += (o.y - this.y) * c * tmod;
  }

  // Sprite.towardSpeed : on POUSSE vers la cible, dans la limite donnée.
  versVitesse(o, c, lim, tmod) {
    this.vitx += borner(-lim, (o.x - this.x) * c * tmod, lim);
    this.vity += borner(-lim, (o.y - this.y) * c * tmod, lim);
  }

  hasard(n) { return this.jeu ? this.jeu.hasard(n) : Math.floor(Math.random() * n); }
  alea() { return this.jeu ? this.jeu.rng() : Math.random(); }
}

// ── sp/Part.mt ────────────────────────────────────────────────────────────
//
// Une particule : un dessin que le CODE pilote entièrement — position,
// échelle, rotation, transparence. Beaucoup de sorts s'en servent comme d'un
// vrai acteur : la boule de lumière qui poursuit un impy, la poussière qui
// tourne autour de la fée, le trou noir qui aspire les billes. Les supprimer
// reviendrait à supprimer les sorts.
class Particule extends Corps {
  constructor(champ, lien) {
    super(champ);
    this.lien = lien;
    this.frame = 1;
    this.joue = false;            // gotoAndPlay : le clip déroule ses images
    this.age = 0;
    this.vitx = 0;
    this.vity = 0;
    this.vitr = null;
    this.vits = null;
    this.timer = null;
    this.sommeil = null;
    this.poids = 1;
    this.friction = null;
    this.echelle = 100;
    this.alpha = 100;
    this.fondu = [0];             // fadeTypeList
    this.fadeLimit = 10;
    this.fadeCouleur = 0;
    this.flGrav = false;
    // Ce que le clip AFFICHE — Flash le tient dans skin._xscale et compagnie ;
    // ici c'est ce que le client lit pour dessiner.
    this.sx = 100;
    this.sy = 100;
    this.sa = 100;
    this.rot = 0;
    this.melange = null;          // setPercentColor posé par un fondu
    this.couleur = null;          // setColor posé par un sort
  }

  init() {
    this.sx = this.echelle;
    this.sy = this.echelle;
    this.sa = this.alpha;
    if (this.timer === null && EPHEMERES[this.lien]) {
      this.timer = EPHEMERES[this.lien];
      this.fondu = [];            // il joue jusqu'au bout, il ne s'estompe pas
    }
    return this;
  }

  update(tmod) {
    if (this.sommeil !== null) {
      this.sommeil -= tmod;
      if (this.sommeil < 0) this.sommeil = null;
      return;
    }
    this.age += tmod;
    let flTuer = false;
    if (this.flGrav) this.vity += this.poids * tmod;

    // Part.update : la friction par défaut est déjà ajustée à l'image ; celle
    // qu'un sort pose ne l'est pas. On garde la bizarrerie de l'original.
    const frict = (this.friction !== null) ? this.friction : Math.pow(FRICT, tmod);
    this.vitx *= frict;
    this.vity *= frict;
    this.x += this.vitx * tmod;
    this.y += this.vity * tmod;

    if (this.timer !== null) {
      this.timer -= tmod;
      if (this.timer < 0) flTuer = true;
      else if (this.timer < this.fadeLimit) {
        const c = this.timer / this.fadeLimit;
        for (const type of this.fondu) {
          switch (type) {
            case 0: this.sx = c * this.echelle; this.sy = c * this.echelle; break;
            case 1: this.sa = c * this.alpha; break;
            case 2: this.melange = { prc: 100 - c * 100, couleur: this.fadeCouleur }; break;
            case 3: this.sx = this.echelle * (2 - c); this.sy = this.echelle * (2 - c); break;
            case 4: this.sy = c * this.echelle; break;
            default: break;
          }
        }
      }
    }
    if (this.vitr !== null) { this.vitr *= frict; this.rot += this.vitr * tmod; }
    if (this.vits !== null) {
      this.vits *= frict;
      this.echelle += this.vits * tmod;
      this.sx = this.echelle;
      this.sy = this.echelle;
    }
    if (flTuer) this.tuer();
  }

  orienter() { this.rot = Math.atan2(this.vity, this.vitx) / 0.0174; }
}

// ── sp/part/Shot.mt ───────────────────────────────────────────────────────
//
// Un tir. `types` est la liste de ses comportements : il peut poursuivre,
// laisser une traînée, palpiter, grossir en apparaissant… Un même tir en cumule
// plusieurs, et c'est ce qui distingue une mèche fantôme d'une damaïde.
const T = {
  FLOT: 1, POURSUITE: 2, TRAINEE: 3, PALPITE: 4, APPARITION: 5,
  DECLENCHE: 6, SPHERE: 7, VIRE: 22, ONDULE: 23, CREPITE: 24, REBONDIT: 30,
};

class Tir extends Particule {
  constructor(champ, lien) {
    super(champ, lien);
    this.vLim = 0;
    this.ray = 1;
    this.degats = 0;
    this.recul = 1.5;
    this.cibles = [];
    this.types = [];
    this.decal = 0;
    this.n0 = 0;
    this.angle_ = 0;
    this.vitesse = 0;
    this.lanceur = null;
    this.sort = null;
    this.op = null;
    this.orienteToujours = false;
    this.queueLien = null;
    this.poursuite = null;
    this.palpite = null;
    this.declencheur = 0;
  }

  ajouterCible(pe) { if (pe) this.cibles.push(pe); }

  // Shot.initDirect : il part droit sur la première cible, et le lanceur
  // ENCAISSE le recul — c'est ce qui fait reculer la fée quand elle tire.
  initDirect(p) {
    this.vitesse = p;
    this.angle_ = this.angle(this.cibles[0] || { x: this.x, y: this.y - 1 });
    this.majVitesse();
    if (this.lanceur) {
      this.lanceur.vitx -= Math.cos(this.angle_) * this.recul;
      this.lanceur.vity -= Math.sin(this.angle_) * this.recul;
    }
    this.friction = 1;
    return this;
  }

  initPoursuite(p, va, la, sommeil) {
    this.initDirect(p);
    this.types.push(T.POURSUITE);
    this.poursuite = { va, la, sommeil };
    return this;
  }

  initTrainee(lien) { this.types.push(T.TRAINEE); this.queueLien = lien; return this; }

  initPalpite(sc, ds, sp) {
    this.palpite = { sc, dec: 0, ds, sp };
    this.types.push(T.PALPITE);
    return this;
  }

  initDeclencheur(t) { this.declencheur = t; this.types.push(T.DECLENCHE); return this; }

  majVitesse() {
    this.vitx = Math.cos(this.angle_) * this.vitesse;
    this.vity = Math.sin(this.angle_) * this.vitesse;
  }

  poserVitesse(a, sp) {
    this.vitx = Math.cos(a) * sp;
    this.vity = Math.sin(a) * sp;
  }

  update(tmod) {
    this.verifierCibles();
    this.verifierBords();
    if (!this.vivant) return;
    if (this.orienteToujours) this.orienter();

    for (let i = 0; i < this.types.length; i++) {
      switch (this.types[i]) {
        case T.FLOT: {
          const p = this.fondeur(0x00FFFF, this.alea() * this.ray * 1.5);
          p.timer = 20 + this.alea() * 20;
          p.init();
          break;
        }
        case T.POURSUITE: {
          const trg = this.cibles[0] || { x: this.jeu.largeur * 0.5, y: -40 };
          let da = this.angle(trg) - this.angle_;
          da = borner(-this.poursuite.la, ramener(da, 3.14), this.poursuite.la);
          this.angle_ += da * this.poursuite.va * tmod;
          this.majVitesse();
          break;
        }
        case T.TRAINEE:
          this.queue(this.queueLien);
          break;
        case T.PALPITE: {
          const b = this.palpite;
          b.dec = (b.dec + b.ds * tmod) % 628;
          const ca = Math.cos(b.dec / 100), sa = Math.sin(b.dec / 100);
          this.sx = (100 + ca * b.sc) * this.echelle / 100;
          this.sy = (100 + sa * b.sc) * this.echelle / 100;
          if (b.sp !== null && b.sp !== undefined) { this.vitesse += ca * b.sp; this.majVitesse(); }
          break;
        }
        case T.APPARITION: {
          const c = 0.2;
          this.echelle = this.echelle * (1 - c) + 100 * c;
          this.sx = this.echelle;
          this.sy = this.echelle;
          break;
        }
        case T.DECLENCHE:
          this.declencheur -= tmod;
          if (this.declencheur <= 0) {
            if (this.sort) this.sort.declencher(this);
            this.types.splice(i--, 1);
          }
          break;
        case T.SPHERE: {
          const trg = this.cibles[0];
          if (!trg) break;
          const a = this.angle(trg), dist = this.distance(trg);
          this.frame = 1 + Math.round(Math.min(dist / 80, 1) * 20);
          const sens = (Math.cos(a) > 0) ? 1 : -1;
          this.sx = sens * 100;
          this.rot = Math.sin(a) * 45 * sens;
          break;
        }
        case T.VIRE:
          this.decal = (this.decal + 30) % 628;
          this.vitr = Math.cos(this.decal / 100) * 28;
          break;
        case T.ONDULE:
          this.decal = (this.decal + 49) % 628;
          this.poserVitesse(this.angle_ + Math.sin(this.decal / 100) * 0.2, this.vitesse);
          this.orienter();
          this.queue('partQueueStandard');
          break;
        case T.CREPITE: {
          const p = this.fondeur(0xFF6600, this.alea() * this.ray);
          p.timer = this.n0 + 5 + this.alea() * 10;
          p.init();
          break;
        }
        case T.REBONDIT:
          if (this.x < this.ray || this.x > this.jeu.largeur - this.ray) {
            this.x = borner(this.ray, this.x, this.jeu.largeur - this.ray);
            this.vitx *= -1;
            this.angle_ = Math.atan2(this.vity, this.vitx);
          }
          if (this.y < this.ray || this.y > this.jeu.hauteur - this.ray) {
            this.y = borner(this.ray, this.y, this.jeu.hauteur - this.ray);
            this.vity *= -1;
            this.angle_ = Math.atan2(this.vity, this.vitx);
          }
          break;
        default: break;
      }
    }
    super.update(tmod);
  }

  verifierBords() {
    if (this.x < this.vLim || this.x > this.jeu.largeur - this.vLim
      || this.y < this.vLim || this.y > this.jeu.hauteur - this.vLim) this.tuer();
  }

  // Un tir ne touche que pendant le JEU : pendant une cascade ou un sort, tout
  // le monde est intouchable. C'est ce qui empêche de mourir à un moment où
  // l'on n'a pas la main.
  verifierCibles() {
    if (!this.jeu || this.jeu.step !== E.ETAPE.JEU) return;
    for (let i = 0; i < this.cibles.length; i++) {
      const trg = this.cibles[i];
      if (!trg.vivant || trg.flDeath) { this.cibles.splice(i--, 1); continue; }
      if (this.distance(trg) < this.ray + trg.ray) {
        if (this.sort) this.sort.toucherCible(trg, this);
        this.toucher(trg);
        return;
      }
    }
  }

  toucher(trg) {
    const p = this.degats * 0.1;
    const a = Math.atan2(this.vity, this.vitx);
    trg.vitx += Math.cos(a) * p;
    trg.vity += Math.sin(a) * p;
    trg.blesser(this.degats);
    this.tuer();
  }

  fondeur(couleur, d) {
    const p = this.champ.nouvellePart('partFader');
    const a = this.alea() * 6.28;
    p.x = this.x + Math.cos(a) * d;
    p.y = this.y + Math.sin(a) * d;
    p.echelle = 30 + this.alea() * 70;
    p.poids = 0.01 + (p.echelle / 100) * 0.05;
    p.flGrav = true;
    p.timer = 10;
    p.fadeCouleur = couleur;
    p.fondu = [0, 2];
    return p;
  }

  // La traînée : un segment tendu entre la position précédente et l'actuelle.
  queue(lien) {
    if (!this.op) this.op = { x: this.x, y: this.y };
    const p = this.champ.nouvellePart(lien);
    p.x = this.x;
    p.y = this.y;
    p.rot = p.angle(this.op) / 0.0174;
    p.init();
    p.sx = p.distance(this.op);
    this.op = { x: this.x, y: this.y };
  }
}

// ── sp/People.mt ──────────────────────────────────────────────────────────
//
// Une créature volante. Elle choisit un point au hasard, s'oriente vers lui par
// petits crans (`cTurn`), accélère (`speed`), freine (`frict`) et rebondit sur
// les bords. Toute la maniabilité d'une fée tient dans ces trois nombres, et
// c'est sa RAPIDITÉ qui les fixe.
class Personne extends Corps {
  constructor(champ) {
    super(champ);
    this.flForceWay = false;
    this.flBound = true;
    this.angle_ = 1.57;
    this.speed = 0;
    this.cTurn = 0.1;
    this.frict = 0.95;
    this.freqShoot = 300;
    this.freqDash = 0;
    this.noTrgTimer = 0;
    this.vitx = 0;
    this.vity = 0;
    this.ray = 6;
    this.ta = 0;
    this.flDeath = false;
    this.flFear = false;
    this.wingDecal = 0;
    this.flyMode = 0;
    this.health = 100;
    this.life = 0;
    this.mana = 0;
    this.spinFrame = 0;
    this.spinSpeed = null;
    this.stun = null;
    this.statut = [];
    this.statutTimer = [];
    this.trg = null;
    this.peTrg = null;
    this.fightStep = 0;
    this.dashTimer = 0;
    this.sortEnCours = null;
    this.colorBlink = null;
    this.xInc = 0;
    this.yInc = 0;
    // Ce que le client dessine.
    this.penche = 0;              // mc._rotation
    this.penchePart = 0;          // mc.body._rotation
    this.corps = 1;               // l'image du sous-clip « body »
    this.charge = 0;              // l'aura de charge, 0 à 100
    this.chargeAngle = 0;
    this.aile = { yi: 0, xs: 100, rot: 0, ecart: 0 };
    this.melange = null;
  }

  update(tmod) {
    if (this.peTrg) {
      if (this.peTrg.vivant && !this.peTrg.flDeath) {
        if (this.jeu.step === E.ETAPE.JEU) this.combattre(tmod);
      } else {
        this.flyMode = 0;
        this.peTrg = null;
        this.charge = 0;
      }
    }
    this.bouger(tmod);

    const cb = this.colorBlink;
    if (cb) {
      cb.t -= tmod;
      let prc = 0;
      if (cb.t > 0) {
        cb.d = (cb.d + cb.sp * tmod) % 628;
        prc = 50 + Math.cos(cb.d / 100) * 50;
      }
      this.melange = prc > 0 ? { prc, couleur: cb.c } : null;
      if (cb.t <= 0) this.colorBlink = null;
    }

    for (let i = 0; i < this.statutTimer.length; i++) {
      if (this.statutTimer[i] === null || this.statutTimer[i] === undefined) continue;
      this.statutTimer[i] -= tmod;
      if (this.statutTimer[i] <= 0) {
        this.statutTimer[i] = null;
        this.poserStatut(i, false);
      }
    }
  }

  bouger(tmod) {
    let f = this.frict;
    this.ta = this.choisirCap(tmod);

    let da = this.ta - this.angle_;
    if (da > 3.14) da -= 6.28;
    if (da < -3.14) da += 6.28;
    this.angle_ += da * this.cTurn * tmod;

    if (this.stun === null) {
      this.vitx += Math.cos(this.angle_) * this.speed * tmod;
      this.vity += Math.sin(this.angle_) * this.speed * tmod;
      // Tourner FREINE : une fée qui zigzague avance moins vite qu'une fée qui
      // file droit. C'est ce qui rend la rapidité si précieuse.
      f *= Math.pow(f, Math.abs(da));
    }
    f = Math.pow(f, tmod);
    this.vitx *= f;
    this.vity *= f;
    this.x += this.vitx * tmod;
    this.y += this.vity * tmod;

    if (this.flBound) this.verifierBords();
    if (this.spinSpeed !== null) this.tournoyer(tmod);
    else this.battreDesAiles(tmod);
  }

  choisirCap(tmod) {
    if (this.flFear && this.peTrg) return this.peTrg.angle(this);
    if (this.noTrgTimer > 0) {
      this.noTrgTimer -= tmod;
    } else if (!this.flForceWay && this.hasard(Math.floor(30 / tmod)) === 0) {
      this.trg = { x: this.hasard(this.jeu.largeur), y: this.hasard(this.jeu.hauteur) };
    }
    return this.trg ? this.angle(this.trg) : this.ta;
  }

  verifierBords() {
    const m = 6;
    if (this.x < m + this.jeu.margeGauche || this.x > this.jeu.largeur - m) {
      this.angle_ = this.angleDeFuite(this.angle_, 30);
      this.vitx *= -0.3;
      this.x = borner(m + this.jeu.margeGauche, this.x, this.jeu.largeur - m);
    }
    if (this.y < m + this.jeu.margeHaut || this.y > this.jeu.hauteur - m) {
      this.angle_ = this.angleDeFuite(this.angle_, 30);
      this.vity *= -0.3;
      this.y = borner(m + this.jeu.margeHaut, this.y, this.jeu.hauteur - m);
    }
  }

  // People.moveWings — les ailes suivent la vitesse verticale : elle monte, les
  // ailes s'ouvrent et battent large ; elle descend, elles se replient. Le
  // corps se penche du côté où elle va.
  battreDesAiles(tmod) {
    const dy = borner(0, 0.5 + this.vity * 0.15, 1) - this.yInc;
    this.yInc += dy * 0.2 * tmod;
    let xi = this.xInc;
    let yi = this.yInc;
    if (this.flyMode === 1 && this.peTrg) {
      const a = this.angle(this.peTrg);
      yi = (1 + Math.sin(a)) * 0.5;
      xi = Math.cos(a) * 2;
    }
    this.wingDecal = (this.wingDecal + (80 - this.vity * 16)) % 628;
    const sup = Math.cos(this.wingDecal / 100) * 45 * (1 - yi) + 75 * yi;

    const dx = this.vitx - xi;
    xi += dx * 0.2 * tmod;
    this.xInc = xi;

    this.aile = {
      yi,                                              // w0.w.w._yscale = 100 - 80·yi
      xs: 50 + sup,                                    // w0.w.w._xscale
      rot: Math.cos(this.wingDecal / 100) * 70 * yi,   // w0.w._rotation
      ecart: xi * 12,                                  // w0._xscale = 100 ± écart
    };
    this.penche = xi * 12;                  // mc._rotation
    this.penchePart = xi * 5;               // mc.body._rotation
    this.corps = 1 + Math.floor(yi * 40);   // mc.body.gotoAndStop
  }

  tournoyer(tmod) {
    this.spinFrame = (this.spinFrame + this.spinSpeed * tmod) % 38;
    this.corps = 10 + Math.floor(this.spinFrame);
  }

  arreterTournoiement() { this.spinSpeed = null; this.corps = 1; }

  poserVie(n) { this.life = n; }
  poserMana(n) { this.mana = n; }
  incMana(n) { this.poserMana(this.mana + n); }

  poserStatut(id, drapeau) { this.statut[id] = drapeau; }

  poserCible(pe) {
    this.peTrg = pe;
    this.flyMode = 1;
    this.initEtapeCombat(0);
  }

  chercherCible(liste) {
    if (!this.peTrg && liste.length > 0) this.poserCible(liste[this.hasard(liste.length)]);
  }

  // ── Le combat ──
  initEtapeCombat(n) {
    this.fightStep = n;
    if (n === 1) { this.dashTimer = 18; this.charge = 0; }
  }

  combattre(tmod) {
    const dist = this.distance(this.peTrg);
    const a = this.angle(this.peTrg);
    switch (this.fightStep) {
      case 0:
        this.charge = 0;
        if (dist > this.zoneDeTir()) this.verifierTir(tmod);
        if (dist < 100 && dist > 40) this.verifierCharge(tmod);
        break;
      case 1: {
        const vitesse = this.vitesse();
        this.dashTimer -= tmod;
        if (this.dashTimer < 0) { this.initEtapeCombat(0); break; }
        this.versVitesse(this.peTrg, 1, 1.5, tmod);
        this.chargeAngle = a / 0.0174;
        this.charge = Math.min(100, vitesse * 10);
        const r = this.ray + this.peTrg.ray;
        if (dist < r) {
          if (vitesse > 5) {
            const d = (r - dist) * 0.5;
            const ca = Math.cos(a), sa = Math.sin(a);
            this.x -= ca * d; this.y -= sa * d;
            this.peTrg.x += ca * d; this.peTrg.y += sa * d;
            const p0 = this.peTrg.impactCharge();
            const p1 = this.impactCharge();
            this.blesser(p0);
            this.peTrg.blesser(p1);
            this.vitx -= ca * p0; this.vity -= sa * p0;
            this.peTrg.vitx += ca * p1; this.peTrg.vity += sa * p1;
            const part = this.champ.nouvellePart('partOnde');
            part.x = (this.x + this.peTrg.x) * 0.5;
            part.y = (this.y + this.peTrg.y) * 0.5;
            part.init();
            this.champ.evenement('choc', { x: part.x, y: part.y });
          } else {
            this.initEtapeCombat(0);
          }
        }
        break;
      }
      default: break;
    }
  }

  // People.checkShoot : freqShoot tirages à une chance sur 180. Une cadence de
  // dix ne tire donc pas dix fois — elle a dix fois plus de CHANCES de tirer.
  verifierTir(tmod) {
    for (let i = 0; i < this.freqShoot; i++) {
      if (this.hasard(Math.floor(BASE_TIR / tmod)) === 0) { this.tirer(); break; }
    }
  }

  verifierCharge(tmod) {
    for (let i = 0; i < this.freqDash; i++) {
      if (this.hasard(Math.floor(BASE_CHARGE / tmod)) === 0) { this.initEtapeCombat(1); break; }
    }
  }

  tirer() {}

  nouveauTir(lien) {
    const s = new Tir(this.champ, lien);
    s.x = this.x;
    s.y = this.y;
    s.lanceur = this;
    s.ajouterA(this.champ.shotList);
    return s;
  }

  blesser(degats) {
    this.health -= degats;
    this.colorBlink = { t: degats, d: 0, c: 0xFF0000, sp: 50 };
  }

  impactCharge() {
    let c = 1;
    if (this.fightStep === 1) { c *= 3; this.initEtapeCombat(0); }
    return c;
  }

  zoneDeTir() { return 50; }
  vitesse() { return Math.sqrt(this.vitx * this.vitx + this.vity * this.vity); }

  // People.getEvadeAngle : on ouvre l'angle de part et d'autre du cap voulu
  // jusqu'à trouver une direction qui ne sorte pas de l'aire. C'est ce qui
  // évite qu'une fée acculée se colle au bord.
  angleDeFuite(a, dist) {
    let sens = 1, dif = 0, ta = a, tx = 0, ty = 0;
    do {
      ta += dif * 2 * sens;
      tx = this.x + Math.cos(ta) * dist;
      ty = this.y + Math.sin(ta) * dist;
      dif += 0.05;
      sens *= -1;
      if (dif > 3) break;
    } while (!this.jeu.estDans(tx, ty, 12));
    return ta;
  }

  etoiles() {}

  tuer() {
    this.flDeath = true;
    if (this.sortEnCours) this.sortEnCours.arretUrgence();
    super.tuer();
  }
}

// ── sp/pe/Faerie.mt ───────────────────────────────────────────────────────
class Fee extends Personne {
  constructor(champ, fi) {
    super(champ);
    this.manaTimer = 50;
    this.starTimer = 0;
    this.tirCourant = null;
    this.berserk = false;
    this.x = this.jeu.largeur * 0.5;
    this.y = this.jeu.hauteur * 0.5;
    this.poserInfo(fi);
  }

  // Faerie.setInfo — c'est ici que la fiche devient une maniabilité. Rien
  // n'est arrondi : une fée de rapidité 3 vole vraiment autrement qu'une fée
  // de rapidité 2.
  poserInfo(fi) {
    this.fi = fi;
    // FaerieInfo.initSpellList tourne AVANT que la fée n'existe : ses sorts
    // appartiennent à la fiche. On les monte donc en premier, car poserMana
    // choisit aussitôt le meilleur tir qu'elle puisse payer.
    this.monterSorts(fi);
    this.poserVie(nombre(fi.fs.$life));
    this.poserMana(nombre(fi.fs.$mana));
    this.manaMax = nombre(fi.carac[MANA]) * 2;

    this.speed = 0.1 + nombre(fi.carac[RAPIDITE]) * 0.13;
    this.frict = 0.95;
    this.cTurn = 0.03 + nombre(fi.carac[RAPIDITE]) * 0.04;

    this.freqDash = 7 + nombre(fi.carac[FORCE]) * 2;
    if (fi.pouvoirs[POUVOIR.BERSERK]) this.freqDash *= 2;
    this.ray = 8;

    this.tirCourant = this.meilleurTir();
  }

  // FaerieInfo.initSpellList : les sorts d'un côté, les tirs de l'autre, ces
  // derniers triés du plus cher au moins cher — getBestShotAvailable prend le
  // premier qu'elle peut payer, donc le meilleur.
  monterSorts(fi) {
    const S = sorts();
    this.sortList = [];
    this.tirList = [];
    for (const id of (fi.sorts || [])) {
      const s = S.nouveauSort(id, this.champ);
      if (!s) continue;
      s.fi = fi;
      s.lanceur = this;
      if (s.flTir) this.tirList.push(s); else this.sortList.push(s);
    }
    this.tirList.sort((a, b) => b.cout - a.cout);
  }

  meilleurTir() {
    for (const t of this.tirList) if (nombre(this.fi.fs.$mana) >= t.cout) return t;
    return null;
  }

  update(tmod) {
    super.update(tmod);
    this.regenerer(tmod);
    if (this.jeu.flAide) this.etoiles(0.7, tmod);
    this.chercherCible(this.champ.impList);
    if (!this.flForceWay) this.esquiver();
  }

  // Faerie.dodge : elle repère le tir qui la vise, et s'écarte. Le rayon de sa
  // vigilance grandit avec sa rapidité — une fée lente ne voit rien venir.
  esquiver() {
    const zoneRay = 30 + nombre(this.fi.carac[RAPIDITE]) * 15;
    let ea = null, distMax = zoneRay;
    for (const shot of this.champ.shotList) {
      if (shot.cibles.indexOf(this) < 0) continue;
      const dist = this.distance(shot);
      if (dist >= distMax) continue;
      ea = this.angleDeFuite(this.angle(shot) - 3.14, 50);
      distMax = dist;
    }
    if (ea !== null) {
      this.angle_ = ea;
      this.trg = null;
      this.noTrgTimer = 6;
    }
  }

  // POW_REGENERATE_MANA accélère la remontée d'un demi ; sans lui, une goutte
  // de mana coûte quatre-vingts images, soit près de trois secondes.
  incManaTimer(inc) {
    let i = inc;
    if (this.fi.pouvoirs[POUVOIR.REGEN_MANA]) i *= 1.5;
    this.manaTimer += i;
    if (this.mana < this.manaMax && this.manaTimer < 0) {
      this.manaTimer += 80;
      this.poserMana(this.mana + 1);
    }
  }

  regenerer(tmod) {
    if (this.health < 100 && this.fi.pouvoirs[POUVOIR.REGEN_VIE]) {
      this.health = Math.min(this.health + tmod, 100);
    }
  }

  // Faerie.checkSpell — le CŒUR de la mécanique : la fée ne lance jamais rien
  // d'elle-même. Le joueur appelle, et à la fin du tour elle choisit UN sort.
  // Son intelligence resserre le tirage vers la tête de liste : à 1 elle prend
  // au hasard, à 5 elle prend presque toujours le meilleur.
  verifierSort() {
    if (!this.jeu.flAide) return;
    const liste = this.listeDeSorts();
    if (liste.length === 0) return;
    const intel = Math.max(1, nombre(this.fi.carac[INTELLIGENCE]));
    const index = Math.floor(this.alea() * liste.length / intel);
    const s = liste[Math.min(index, liste.length - 1)];
    if (s) s.sort.ranger();
  }

  // getSpellList : chaque sort dit sa PERTINENCE, qu'on divise par son coût et
  // qu'on multiplie par le goût de la fée pour lui ($spellCoef). Un sort cher
  // doit être bien plus utile qu'un sort d'un point de mana pour passer devant.
  listeDeSorts() {
    const liste = [];
    for (const s of this.sortList) {
      const rel = s.pertinence();
      if (!(rel > 0) || !isFinite(rel) || !s.disponible()) continue;
      const coef = (this.fi.fs.$spellCoef || {})[s.sid];
      const multi = (coef === null || coef === undefined) ? 10 : coef;
      liste.push({ rel: (rel * multi) / s.cout, sort: s });
    }
    liste.sort((a, b) => b.rel - a.rel);
    return liste;
  }

  poserVie(n) {
    super.poserVie(n);
    if (this.fi) this.fi.fs.$life = Math.floor(Math.max(0, n));
  }

  poserMana(n) {
    super.poserMana(n);
    if (!this.fi) return;
    this.fi.fs.$mana = n;
    this.tirCourant = this.meilleurTir();
  }

  verifierTir(tmod) {
    if (!this.tirCourant) return;
    this.tirCourant.update(tmod);
  }

  zoneDeTir() { return this.tirCourant ? this.tirCourant.zoneMin : 50; }

  // Faerie.harm : le niveau amortit les coups. Chaque centaine de points de
  // dégâts coûte UN cœur ; le dernier cœur perdu tue.
  blesser(degats) {
    const d = degats / 1 + nombre(this.fi.fs.$level) * 0.1;
    super.blesser(d);
    while (this.health <= 0) {
      this.poserVie(this.life - 1);
      if (this.life > 0) {
        this.health += 100;
        this.champ.evenement('feeTouchee', {});
      } else {
        this.champ.evenement('feeMorte', {});
        this.explosionFinale();
        this.tuer();
        break;
      }
    }
  }

  impactCharge() {
    const c = super.impactCharge();
    let p = (1 + nombre(this.fi.carac[FORCE]) * 2) * c;
    if (this.fi.pouvoirs[POUVOIR.BERSERK]) p = Math.round(p * 1.5);
    return p;
  }

  // callHelp : sans mana, l'appel échoue — et la fée le dit.
  appelerAide() {
    if (this.mana > 0) {
      this.jeu.flAide = true;
      this.colorBlink = { t: 1000, d: 0, c: 0xFFFFFF, sp: 20 };
      this.champ.evenement('aide', { ok: true });
      return true;
    }
    this.champ.evenement('aide', { ok: false });
    return false;
  }

  etoiles(coef, tmod) {
    this.starTimer -= (tmod === undefined ? 1 : tmod) * coef;
    while (this.starTimer < 0) {
      this.starTimer++;
      const p = this.champ.nouvellePart('partStar');
      const a = this.alea() * 6.28;
      const d = this.alea() * 14;
      p.x = this.x + Math.cos(a) * d;
      p.y = this.y + Math.sin(a) * d;
      p.echelle = 20 + this.alea() * 90;
      p.poids = 0.1;
      p.flGrav = true;
      p.timer = 5 + this.alea() * 15;
      p.couleur = this.fi.apparence().couleurs[0];
      p.init();
    }
  }

  explosionFinale() {
    for (let i = 0; i < 4; i++) {
      const a0 = (i % 2) * 1.57;
      for (let n = 0; n < 6; n++) {
        const a = a0 + (n / 6) * 6.28;
        const p = this.champ.nouvellePart('partLightBallFlip');
        p.x = this.x; p.y = this.y;
        const vitesse = 1.5 + i * 1.5;
        p.vitx += Math.cos(a) * vitesse;
        p.vity += Math.sin(a) * vitesse;
        p.timer = 30 - i * 5;
        p.init();
      }
    }
  }

  apparence() { return this.fi.apparence(); }
}

// ── sp/pe/Imp.mt ──────────────────────────────────────────────────────────
//
// L'impy. Il sort d'une cellule cassée, cherche la fée, tire et charge. Son
// RANG (0 à 4) fixe tout : sa peau, sa vie, sa cadence, ses dégâts, et les
// sorts qu'il a le droit de jeter sur la grille.
class Impy extends Personne {
  constructor(champ, niveau) {
    super(champ);
    this.action = 8 + this.hasard(4);
    this.spellCoolDown = CADENCE_SORT_IMPY * 0.5;
    this.poserNiveau(niveau || 0);
  }

  poserNiveau(n) {
    this.level = n;
    this.freqShoot = 1 + n * 2;
    this.health = 50 + 50 * n;
    this.freqDash = 2 + Math.floor(n * 0.5);
    this.ray = 8;
    this.speed = 0.2;
    this.cTurn = 0.11;
    this.couleurs = COULEURS_IMPY[Math.min(n, COULEURS_IMPY.length - 1)];
  }

  update(tmod) {
    super.update(tmod);
    if (this.jeu.step === E.ETAPE.JEU) {
      if (this.spellCoolDown > 0) {
        // Devant une fée, il réfléchit trois fois moins vite : c'est elle qui
        // le distrait, et c'est pour ça qu'une partie sans fée est plus dure.
        this.spellCoolDown -= (this.champ.faerieList.length > 0 ? 0.3 : 1) * tmod;
      }
      // action 0 : il a fini son compte de sorts et s'en va par le haut.
      if (this.action === 0) {
        this.flForceWay = true;
        this.trg = { x: this.jeu.largeur * 0.5, y: -30 };
        if (this.y < -20) this.tuer();
      }
    }
    this.chercherCible(this.champ.faerieList);
  }

  chercherCible(liste) {
    super.chercherCible(liste);
    if (this.peTrg && this.peTrg.fi && this.peTrg.fi.pouvoirs[POUVOIR.PEUR]) this.flFear = true;
  }

  tirer() {
    if (!this.peTrg) return;
    const s = this.nouveauTir('shotImp');
    s.ajouterCible(this.peTrg);
    s.types = [20 + this.level];
    s.ray = 4 + this.level;
    s.degats = 15 + this.level * 15;
    s.initDirect(4 + this.level * 0.4);
    if (this.peTrg.fi && this.peTrg.fi.pouvoirs[POUVOIR.INVISIBILITE]) {
      s.angle_ += (this.alea() * 2 - 1) * 1.3;
      s.majVitesse();
    }
    s.frame = 1 + this.level;
    s.init();
  }

  impactCharge() { return (this.level + 1) * super.impactCharge(); }

  blesser(degats) {
    super.blesser(degats);
    if (this.health > 0) return;
    // L'expérience de la fée vient de là, et de là seulement : (rang+2)².
    const f = this.champ.faerieList[0];
    if (f && !f.flDeath) f.fi.incExp(Math.pow(this.level + 2, 2));
    const pa = this.champ.nouvellePart('partDeadImp');
    pa.x = this.x; pa.y = this.y;
    pa.echelle = 100 + this.level * 20;
    pa.timer = 15;
    pa.init();
    for (let i = 0; i < 10 + this.level * 2; i++) {
      const p = this.champ.nouvellePart('partJet');
      p.x = this.x; p.y = this.y;
      p.rot = this.alea() * 360;
      p.frame = this.hasard(12) + 1;
      p.joue = true;
      p.init();
      p.sx = 50 + this.alea() * 50;
      p.sy = p.sx;
    }
    this.champ.evenement('impyMort', { x: this.x, y: this.y, level: this.level });
    this.tuer();
  }

  // Imp.checkSpell : un impy silencieux ne lance rien, et chaque sort consomme
  // une de ses actions. Quand il n'en a plus, il quitte le niveau.
  verifierSort() {
    if (this.statut[STATUT.SILENCE] || this.action === 0) return;
    if (this.spellCoolDown > 0) return;
    const s = this.sortDuRang();
    if (!s) return;
    this.spellCoolDown = CADENCE_SORT_IMPY;
    s.ranger();
    this.action--;
  }

  // Imp.getSpell : la table de tirage, rang par rang. Les seuils sont ceux du
  // fichier — un impy n'a qu'une chance sur dix de faire tomber des billes, et
  // la Nuit reste rarissime.
  sortDuRang() {
    const S = sorts();
    const rnd = this.alea();
    const table = [
      [[0.10, 'ChuteJetons'], [0.15, 'Lien']],
      [[0.10, 'ChuteJetons'], [0.14, 'Conglomerat'], [0.20, 'Fumee'], [0.23, 'GrandeForme'], [0.25, 'Lien'], [0.26, 'Nuit']],
      [[0.10, 'ChuteJetons'], [0.15, 'Conglomerat'], [0.20, 'Armure'], [0.25, 'GrandeForme'], [0.26, 'Lien'], [0.28, 'Nuit']],
      [[0.10, 'ChuteJetons'], [0.15, 'Armure'], [0.18, 'Conglomerat'], [0.21, 'GrandeForme'], [0.25, 'Mur'], [0.28, 'Nuit']],
      [[0.10, 'ChuteJetons'], [0.15, 'Armure'], [0.16, 'Conglomerat'], [0.18, 'GrandeForme'], [0.24, 'Mur'], [0.26, 'Nuit'], [0.29, 'Origine']],
    ];
    for (const [seuil, nom] of (table[Math.min(this.level, 4)] || [])) {
      if (rnd < seuil) {
        const s = S.nouveauSortImpy(nom, this.champ);
        if (s) { s.lanceur = this; s.imp = this; }
        return s;
      }
    }
    return null;
  }
}

// ── Le champ ──────────────────────────────────────────────────────────────
//
// Ce qui relie le puzzle à ce qui vole au-dessus. On l'installe sur une partie
// et il s'occupe du reste : il fait naître la fée, sort un impy de chaque
// cellule cassée, et avance tout le monde d'une image à chaque tour de boucle.
class Champ {
  constructor(jeu, o) {
    const opts = o || {};
    this.jeu = jeu;
    this.surEvenement = opts.surEvenement || null;
    this.pList = [];
    this.faerieList = [];
    this.impList = [];
    this.shotList = [];
    this.partList = [];
    jeu.champ = this;
    jeu.pList = this.pList;
    jeu.faerieList = this.faerieList;
    jeu.impList = this.impList;
    jeu.shotList = this.shotList;
    jeu.partList = this.partList;
    if (opts.fee) this.naitreFee(opts.fee);
  }

  evenement(nom, d) {
    if (this.surEvenement) this.surEvenement(nom, d);
    this.jeu.evenement(nom, d);
  }

  naitreFee(fi) {
    const f = new Fee(this, fi);
    f.ajouterA(this.pList);
    f.ajouterA(this.faerieList);
    return f;
  }

  naitreImpy(niveau, x, y) {
    const i = new Impy(this, niveau);
    i.x = x;
    i.y = y;
    i.ajouterA(this.pList);
    i.ajouterA(this.impList);
    return i;
  }

  nouvellePart(lien) {
    const p = new Particule(this, lien);
    p.ajouterA(this.partList);
    return p;
  }

  // Game.update : tout ce qui vole avance AVANT le puzzle, quelle que soit
  // l'étape. C'est pour ça que la fée continue de voler pendant une cascade.
  update(tmod) {
    for (const p of this.pList.slice()) p.update(tmod);
    for (const p of this.partList.slice()) p.update(tmod);
    for (const s of this.shotList.slice()) s.update(tmod);
    for (const s of this.jeu.sList.slice()) s.update(tmod);
  }

  appelerAide() {
    let ok = false;
    for (const f of this.faerieList.slice()) ok = f.appelerAide() || ok;
    return ok;
  }
}

const API = {
  Corps, Particule, Tir, Personne, Fee, Impy, Champ,
  FORCE, RAPIDITE, VIE, INTELLIGENCE, CONCENTRATION, MANA,
  POUVOIR, STATUT, COULEURS_IMPY, EPHEMERES, T,
  FRICT, BASE_TIR, BASE_CHARGE, CADENCE_SORT_IMPY,
};

if (typeof module !== 'undefined' && module.exports) module.exports = API;
else racine.MinipixizCombat = API;

})(typeof window !== 'undefined' ? window : globalThis);
