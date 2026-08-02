/*
 * Miniwave 2 — moteur de jeu (logique pure, sans DOM ni canvas).
 *
 * Traduction directe des classes AS2 d'origine (Games/miniWave2/class/miniwave) :
 * Sprite, sp/Hero, sp/Shot, sp/Bads, Game et game/Main. Le rendu, les sons et les
 * particules ne sont pas ici : le moteur les ANNONCE par des événements, et le
 * client canvas les joue. C'est ce qui permet de faire tourner tout le jeu sous
 * Node, sans navigateur, et donc de le tester.
 *
 * Deux conventions du jeu d'origine qu'il faut avoir en tête :
 *
 *   • `tmod` — Flash tournait à 40 images/s, mais Std.tmod corrigeait les
 *     ralentissements : toutes les vitesses sont multipliées par lui. tmod = 1
 *     signifie « une image nominale ». On le garde tel quel, sinon le jeu
 *     changerait de difficulté selon la machine.
 *   • `random(n)` d'AS2 rend un entier de 0 à n-1, et le jeu écrit souvent
 *     `if(!random(f))` pour dire « une chance sur f ». Le générateur est
 *     INJECTABLE ici : une partie rejouée avec la même graine se déroule à
 *     l'identique, ce qui rend les tests possibles.
 *
 * L'aire de jeu fait 240×240 : c'est la taille que le disque Frutiparc réserve
 * au jeu (cf. la fiche miniwave1 du serveur), et toutes les coordonnées des
 * niveaux sont dans ce repère.
 */
'use strict';

(function (racine) {

// ── Constantes du jeu ──────────────────────────────────────────────────────
const LARGEUR = 240;              // mng.mcw
const HAUTEUR = 240;              // mng.mch
const TAILLE_BADS = 24;           // Game.badsSize — largeur d'un ennemi pour le rebond
const FLUX_BADS = 10;             // Game.badsFlow — ennemis déplacés par tour de vague
const FRICTION = 0.95;            // Game.friction
const MARGE_TIR = 20;             // Shot.killMargin
const DECOR_DECAL = 18.7;         // Game.decorDecal — défilement du fond par niveau

// badsInfo.as : valeur au score, rang de déblocage et nom de chaque ennemi.
// L'index EST le type stocké dans les niveaux.
const ENNEMIS = [
  { value: 5, rank: 0, name: 'Fraise-bouclier' },
  { value: 30, rank: 3, name: 'Orangeonaute' },
  { value: 10, rank: 1, name: 'Banana' },
  { value: 15, rank: 2, name: 'Clémentine mécanique' },
  { value: 35, rank: 8, name: 'Kamikaze' },
  { value: 25, rank: 6, name: 'Cerises-duo' },
  { value: 20, rank: 4, name: 'Fraise des bois' },
  { value: 40, rank: 5, name: 'Poire sous cloche' },
  { value: 60, rank: 11, name: 'Astro-Pamplemousse' },
  { value: 40, rank: 9, name: 'Cosmo-Prune' },
  { value: 30, rank: 7, name: 'Coing mutant' },
  { value: 75, rank: 19, name: 'Figue-laser' },
  { value: 45, rank: 10, name: 'Batmandarine' },
  { value: 50, rank: 12, name: "Pomme d'épines" },
  { value: 55, rank: 14, name: 'Astro-Datte' },
  { value: 80, rank: 25, name: 'Pruneau magnétique' },
  { value: 70, rank: 23, name: 'Mère chercheuse' },
  { value: 120, rank: 18, name: 'Citrus' },
  { value: 80, rank: 26, name: 'Astéropulpe' },
  { value: 85, rank: 27, name: 'Baies à tête chercheuse' },
  { value: 55, rank: 15, name: 'Aigrelle assassine' },
  { value: 65, rank: 20, name: 'Mangue-strike' },
  { value: 70, rank: 17, name: 'Tyson' },
  { value: 50, rank: 13, name: 'Cosmirabelle' },
  { value: 60, rank: 16, name: 'Astro-Quetsch' },
  { value: 150, rank: 24, name: 'Ananas sauvage' },
  { value: 180, rank: 34, name: 'Myrtillerie lourde' },
  { value: 65, rank: 21, name: 'Fraise-shuriken' },
  { value: 95, rank: 29, name: 'Aubergine folle' },
  { value: 90, rank: 28, name: 'Space-Groseille' },
  { value: 95, rank: 33, name: 'Pêche astronomique' },
  { value: 95, rank: 31, name: 'Abricot guerrier' },
  { value: 120, rank: 30, name: 'Nectarine trou-noir' },
  { value: 250, rank: 41, name: 'Pruneau passe-muraille' },
  { value: 110, rank: 36, name: 'Astro-raisin' },
  { value: 120, rank: 32, name: 'Betterave astrale' },
  { value: 150, rank: 37, name: 'Scarabé pulpé' },
  { value: 110, rank: 38, name: 'Space-Kumquat' },
  { value: 180, rank: 39, name: 'Poivri le poivron violent' },
  { value: 70, rank: 22, name: 'Kiwi interstellaire' },
  { value: 110, rank: 40, name: 'Prune sidérale' },
  { value: 110, rank: 35, name: 'Prune paralysante' },
  { value: 200, rank: 42, name: 'Demon lemon' },
  { value: 180, rank: 43, name: 'Pêche jongleuse' },
  { value: 200, rank: 44, name: 'Courge céleste' },
  { value: 150, rank: 45, name: 'Bulbe spatial' },
  { value: 180, rank: 46, name: 'Cosmo-Cassis' },
  { value: 150, rank: 47, name: 'Pois casseur' },
  { value: 220, rank: 48, name: 'Brugnon cuirassé' },
  { value: 5, rank: 49, name: 'Nitro-pruneau' },
  { value: 50, rank: 50, name: 'Letter-monster' },
];

// heroName.as : les six vaisseaux, dans l'ordre où le jeu les indexe — et leur
// armement (sp/hero/*.as). Seul le premier est offert au départ ; les autres
// s'achètent à la boutique interne du jeu ($ship = [1,0,0,0,0,0] au démarrage).
//
// Chacun a sa vitesse, sa cadence, son tir et sa bombe. C'est ce qui donne un
// intérêt au déblocage : le Pastaga est lent mais encaisse deux coups et tire
// double, le Manzana file vite et tire loin, le Cherry se dédouble une fois
// entamé et déclenche un rayon vertical.
const VAISSEAUX = [
  {
    link: 'Tequila', name: 'aliquet', speed: 3, cdSpeed: 3.2,
    // Le tir de base. Sa bombe est une onde de choc qui balaie TOUS les tirs.
    bombe: (h) => { h.jeu.evenement('ondeChoc', { x: h.x, y: h.y }); h.jeu.nettoyerTirs(); },
  },
  {
    link: 'Porto', name: 'proto', speed: 3, cdSpeed: 5,
    tirer: (h, t) => {
      const a = ((h.jeu.hasard(80) - 40) / 100) - Math.PI / 2;   // tir légèrement dispersé
      t.vitx = Math.cos(a) * 3;
      t.vity = Math.sin(a) * 3;
    },
    bombe: (h) => {                                             // gerbe de douze
      for (let i = 0; i < 12; i++) {
        const c = ((i / 11) * 2) - 1;
        const a = (77 * c - 157) / 100;
        const s = 5 - Math.abs(c) * 2;
        const t = h.tirBase();
        t.vitx = Math.cos(a) * s;
        t.vity = Math.sin(a) * s;
      }
    },
  },
  {
    link: 'Pastaga', name: 'gapatsa', speed: 2, cdSpeed: 2.2, hp: 2,
    tirer: (h, t) => {                                          // deux canons
      t.x += 6; t.vity = -2.6;
      const u = h.tirBase();
      u.x -= 6; u.vity = -2.6;
    },
    // Un missile qu'on fait sauter quand on veut : il explose au tir suivant
    // (comportement 6 → il meurt dès qu'on rappuie).
    bombe: (h) => { const t = h.tirBase(); t.behaviourId = 6; t.vity = -2; },
  },
  {
    link: 'Manzana', name: 'namazan', speed: 4.5, cdSpeed: 3.6,
    tirer: (h, t) => { t.vity = -6; },                          // rapide et loin
    bombe: (h) => {                                             // huit têtes chercheuses
      for (let i = 0; i < 8; i++) {
        const c = ((i / 7) * 2) - 1;
        const a = (77 * c - 157) / 100;
        h.jeu.newHShot({
          x: h.x, y: h.y - 6,
          vitx: Math.cos(a) * 4, vity: Math.sin(a) * 4,
          behaviourId: 8, heroType: 3,
        });
      }
    },
  },
  {
    link: 'Curaso', name: 'sacuro', speed: 3, cdSpeed: 3,
    tirer: (h, t) => {                                          // deux tirs qui ondulent
      t.behaviourId = 9;
      t.behaviourInfo = { x: h.x, d: 314, decalSpeed: 20, decal: 8 };
      t.x = h.x - 7;
      t.vity = -3.5;
      const u = h.tirBase();
      u.behaviourId = 9;
      u.behaviourInfo = { x: h.x, d: 0, decalSpeed: 20, decal: 8 };
      u.x = h.x + 7;
      u.vity = -3.5;
    },
    bombe: (h) => {
      h.jeu.newHShot({ x: h.x, y: h.y - 6, vitx: 0, vity: -5, behaviourId: 10, heroType: 4 });
    },
  },
  {
    link: 'Cherry', name: 'rycher', speed: 3, cdSpeed: 3, hp: 2,
    // Entamé, il tire en éventail au lieu d'un seul trait — et sa cadence double.
    tirer: (h) => {
      if (h.hp !== 1) return;
      for (let i = 0; i < 2; i++) {
        const s = (i * 2) - 1;
        h.jeu.newHShot({
          x: h.x + s * 5, y: h.y - 6, vitx: s * 0.5, vity: -2.5,
          flStandardHeroShot: true, heroType: 5,
        });
      }
    },
    auCoup: (h) => { if (h.hp === 1) h.coolDownSpeed = 2; },
    // Un rayon vertical qui pulvérise tout ce qui passe dans sa colonne, au prix
    // de la mobilité : le vaisseau est ralenti tant qu'il tire.
    bombe: (h) => { h.laser = 40; h.speed = 1; h.bossTimer = 0; },
  },
];

// Les étapes de game/Main.initStep, telles que le jeu les numérote. Le vaisseau
// ne peut tirer qu'en 1, 2 et 4 (Hero.shootOK).
const ETAPE = { PANNEAU: 0, ARRIVEE: 1, COMBAT: 2, SUIVANT: 3, BOSS: 4 };

// ── Générateur pseudo-aléatoire reproductible ──────────────────────────────
// Le jeu appelle random() à chaque tir ennemi et à chaque explosion. Pour qu'une
// partie soit rejouable — condition sine qua non pour la tester — on l'injecte.
// Mulberry32 : court, rapide, et suffisamment uniforme pour du jeu.
function generateur(graine) {
  let a = graine >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Sprite : le socle commun ───────────────────────────────────────────────
class Sprite {
  constructor(jeu, o) {
    this.jeu = jeu;
    this.x = 0;
    this.y = 0;
    this.vivant = true;
    Object.assign(this, o || {});
  }
  distance(o) { const dx = o.x - this.x, dy = o.y - this.y; return Math.sqrt(dx * dx + dy * dy); }
  angle(o) { return Math.atan2(o.y - this.y, o.x - this.x); }
  // hTest d'origine s'appuyait sur la boîte du clip Flash. Sans clip, on prend
  // le rayon du sprite — la même chose à un pixel près pour des vaisseaux de 24.
  touche(x, y) {
    const r = this.ray || 10;
    return Math.abs(x - this.x) < r && Math.abs(y - this.y) < r;
  }
  tuer() { this.vivant = false; }
}

// ── Le vaisseau ────────────────────────────────────────────────────────────
class Hero extends Sprite {
  constructor(jeu, o) {
    super(jeu, o);
    if (this.type === undefined) this.type = 0;
    // Chaque vaisseau a sa fiche : vitesse, cadence, robustesse et armement.
    const v = VAISSEAUX[this.type] || {};
    this.fiche = v;
    if (this.hp === undefined) this.hp = v.hp || 1;
    if (this.speed === undefined) this.speed = v.speed || 3;
    if (this.coolDownSpeed === undefined) this.coolDownSpeed = v.cdSpeed || 4;
    if (this.ray === undefined) this.ray = 8;
    if (this.moveLine === undefined) this.moveLine = 11;
    this.flLine = false;
    this.coolDown = 0;
    this.flBomb = true;
    this.sens = 1;                       // inversé par `blind()` — commande à l'envers
    this.newShield = { t: 160, d: 0 };   // invulnérabilité d'apparition
    this.flEMP = false;
    this.EMPTimer = 0;
    this.blindTimer = undefined;
  }

  update(tmod) {
    const jeu = this.jeu;
    // Descente vers la ligne de tir à l'apparition.
    if (!this.flLine) {
      const ty = HAUTEUR - this.moveLine;
      const dy = this.y - ty;
      this.y -= Math.min(2, dy * 0.3);
      if (Math.abs(dy) < 0.5) { this.y = ty; this.flLine = true; }
    }

    this.coolDown -= this.coolDownSpeed * tmod;
    this.commander(tmod);

    // Collision avec les tirs ennemis.
    for (let i = 0; i < jeu.bShotList.length; i++) {
      const t = jeu.bShotList[i];
      if (Math.abs(t.x - this.x) < this.ray && Math.abs(t.y - this.y) < this.ray) {
        if (t.flHit) this.frapper();
        t.auContact();
      }
    }

    // Retour sur la ligne après avoir été poussé (trou noir de la Nectarine…).
    const ty = HAUTEUR - this.moveLine;
    if (this.y < ty) this.y += 0.8 * tmod;

    if (this.flEMP) {                    // brouillage : plus de tir
      if (this.EMPTimer > 0) this.EMPTimer -= tmod;
      else this.flEMP = false;
    }
    if (this.blindTimer !== undefined) { // commandes inversées
      this.blindTimer -= tmod;
      if (this.blindTimer < 0) { this.sens = 1; this.blindTimer = undefined; }
    }
    if (this.newShield !== undefined) {
      if (this.newShield.t > 0) this.newShield.t -= tmod;
      else this.newShield = undefined;
    }

    // Rayon du Cherry : tout ce qui passe dans sa colonne est pulvérisé, et le
    // boss encaisse aussi — mais avec un temps de latence, sinon il fondrait.
    if (this.laser > 0) {
      this.laser -= tmod;
      for (const b of jeu.badsList.slice()) if (Math.abs(b.x - this.x) < 6) b.frapper();
      if (jeu.boss) {
        if (this.bossTimer > 0) this.bossTimer -= tmod;
        else if (Math.abs(jeu.boss.x - this.x) < jeu.boss.ray + 6) {
          jeu.boss.frapper(null);
          this.bossTimer = 2.5;
        }
      }
      if (this.laser <= 0) this.speed = this.fiche.speed || 3;
    }

    // Sortie par la droite : le vaisseau saute au niveau suivant (le « warp »).
    if (this.x > LARGEUR + this.ray) {
      jeu.evenement('warp', {});
      jeu.setWarp(100);
      this.tuer();
    }
  }

  commander(tmod) {
    const e = this.jeu.entree;
    if (e.gauche) {
      this.x = Math.max(this.x - this.speed * this.sens * tmod, this.jeu.shipBounds.min + this.ray);
    }
    if (e.droite) {
      this.x = Math.min(this.x + this.speed * this.sens * tmod, this.jeu.shipBounds.max - this.ray);
    }
    if (this.coolDown <= 0 && e.tir && !this.flEMP && this.peutTirer()) this.tirer();
    if (this.flBomb && e.bombe && this.peutTirer()) this.bombe();
  }

  // Le tir « nu », celui que les vaisseaux ajustent (super.shoot en AS2).
  tirBase() {
    return this.jeu.newHShot({
      x: this.x, y: this.y - 6, vitx: 0, vity: -3,
      flStandardHeroShot: true, heroType: this.type,   // aspect du tir = vaisseau
    });
  }

  tirer() {
    this.coolDown = 100;
    const t = this.tirBase();
    if (this.fiche.tirer) this.fiche.tirer(this, t);
    this.jeu.evenement('tirHero', { x: this.x, y: this.y - 6, type: this.type });
    return t;
  }

  // La bombe ne sert qu'UNE fois par vaisseau : c'est le dernier recours.
  bombe() {
    this.flBomb = false;
    if (this.fiche.bombe) this.fiche.bombe(this);
    this.jeu.evenement('bombe', { type: this.type, x: this.x, y: this.y });
  }

  frapper(power) {
    if (power === undefined) power = 1;
    if (this.newShield !== undefined) return;   // encore invulnérable
    this.hp -= power;
    if (this.hp <= 0) this.exploser();
    else {
      this.newShield = { t: 80, d: 0 };
      // Le Cherry entamé change d'arme et double sa cadence.
      if (this.fiche.auCoup) this.fiche.auCoup(this);
    }
    this.jeu.evenement('heroTouche', { x: this.x, y: this.y, mort: this.hp <= 0 });
  }

  frapperEMP(deg) {
    if (this.flEMP) this.EMPTimer += deg;
    else { this.flEMP = true; this.EMPTimer = deg; }
  }

  aveugler(t) { this.blindTimer = (t === undefined) ? 100 : t; this.sens = -1; }

  exploser() {
    this.jeu.evenement('heroExplose', { x: this.x, y: this.y, type: this.type });
    this.jeu.onHeroKill();
    this.tuer();
  }

  tuer() { super.tuer(); if (this.jeu.hero === this) this.jeu.hero = null; }

  // Hero.shootOK : on ne tire pas pendant les panneaux ni la transition.
  peutTirer() {
    const s = this.jeu.step;
    return s === ETAPE.ARRIVEE || s === ETAPE.COMBAT || s === ETAPE.BOSS;
  }
}

// ── Les tirs ───────────────────────────────────────────────────────────────
// Un seul type de sprite pour les deux camps : c'est `behaviourId` qui décide
// de la trajectoire. Les comportements sans effet purement graphique sont
// implémentés ici ; ceux qui n'existent que pour poser une traînée de particules
// sont annoncés au client et ne changent rien à la logique.
class Shot extends Sprite {
  constructor(jeu, o) {
    super(jeu, o);
    if (this.vitx === undefined) this.vitx = 0;
    if (this.vity === undefined) this.vity = 0;
    if (this.flHit === undefined) this.flHit = true;
    if (this.flIndestructible === undefined) this.flIndestructible = false;
    if (this.behaviourInfo === undefined) this.behaviourInfo = {};
    if (this.ray === undefined) this.ray = 4;
  }

  update(tmod) {
    const jeu = this.jeu;
    this.x += this.vitx * tmod;
    this.y += this.vity * tmod;

    switch (this.behaviourId) {
      case 1: {                       // Mûre : dérive vers le vaisseau
        const h = jeu.cibleHero();
        const d = h.x - this.x;
        this.x += Math.min(Math.max(-1.8, d / 8), 1.8);
        break;
      }
      case 2:                         // Baies : tête chercheuse molle
        this.suivre(jeu.cibleHero(), 0.3, 0.5, tmod);
        break;
      case 3:                         // Citrus : retombe en cloche
        this.vity += tmod * 0.4;
        this.vitx *= jeu.frict;
        this.vity *= jeu.frict;
        break;
      case 8: {                       // Tir à tête chercheuse du vaisseau
        const o = this.behaviourInfo;
        if (!o.target || !o.target.vivant) {
          const l = jeu.badsList;
          if (l.length > 0) o.target = l[jeu.hasard(l.length)];
          else if (jeu.step === ETAPE.BOSS && jeu.boss) o.target = jeu.boss;
          else { this.disparaitre(); return; }
        }
        this.suivre(o.target, 1, 0.5, tmod);
        break;
      }
      case 9: {                       // Curaso : ondule autour de son axe
        const o = this.behaviourInfo;
        o.d = (o.d + o.decalSpeed) % 628;
        this.x = o.x + Math.cos(o.d / 100) * o.decal;
        break;
      }
      case 12:                        // Groseille : poursuite, meurt en bas
        this.suivre(this.behaviourInfo.target, 0.7, 0.5, tmod);
        if (this.y > HAUTEUR + 4) { this.tuer(); return; }
        break;
      case 0: {                       // Astro-Pamplemousse : éclate en deux
        let eclate = this.y > HAUTEUR - 12;
        for (let i = 0; i < jeu.hShotList.length; i++) {
          const m = jeu.hShotList[i];
          if (this.touche(m.x, m.y)) { m.tuer(); eclate = true; }
        }
        if (eclate) {
          for (const s of [2, -2]) jeu.newBShot({ x: this.x, y: this.y, vitx: s, vity: 0, time: 40 });
          this.tuer();
          return;
        }
        break;
      }
      case 4: {                       // Tyson : le poing part et revient
        const o = this.behaviourInfo;
        if (o.step === 0) {
          if (this.y > HAUTEUR - 10) { o.step = 1; o.coef = 0; this.flHit = false; }
        } else {
          o.coef += 0.02 * tmod;
          const p = o.path;
          const cx = p.x + (o.id * 9 - 4.5), cy = p.y + 4.5;
          if (o.coef < 0.6) {
            this.x = this.x * (1 - o.coef) + cx * o.coef;
            this.y = this.y * (1 - o.coef) + cy * o.coef;
          } else {
            if (p.rendrePoing) p.rendrePoing(o.id);
            this.tuer();
            return;
          }
        }
        break;
      }
      case 5: {                       // Cosmirabelle : un rayon vertical
        const o = this.behaviourInfo;
        o.parcouru += this.vity;
        const h = jeu.hero;
        if (h && this.y > h.y - h.ray && this.y - o.length < h.y + h.ray
          && Math.abs(h.x - this.x) < h.ray) h.frapper();
        break;
      }
      case 7: {                       // Souffle d'explosion : un disque qui grandit
        const o = this.behaviourInfo;
        o.ray += o.raySpeed * tmod;
        o.ray *= Math.pow(o.frict, tmod);
        o.timer -= tmod;
        if (o.timer < 0) { this.tuer(); return; }
        if (o.timer > 5) {
          for (const b of jeu.badsList.slice()) {
            const dx = b.x - this.x, dy = b.y - this.y;
            if (Math.sqrt(dx * dx + dy * dy) < o.ray) b.frapper();
          }
        }
        break;
      }
      case 11: {                      // Fraise-shuriken : va, puis revient au tireur
        const o = this.behaviourInfo;
        let c;
        if (o.timer > 0) { o.timer -= tmod; c = jeu.cibleHero(); }
        else {
          c = o.launcher && o.launcher.vivant ? o.launcher : { x: LARGEUR / 2, y: -200 };
          if (this.distance(c) < 10) {
            if (o.launcher && o.launcher.reprendreTir) o.launcher.reprendreTir();
            this.tuer();
            return;
          }
        }
        this.suivre(c, 0.3, 0.5, tmod);
        break;
      }
      case 13: {                      // Nectarine : se fige et aspire le vaisseau
        const o = this.behaviourInfo;
        const c = jeu.cibleHero();
        if (this.y > c.y) {
          this.y = c.y; this.vitx = 0; this.vity = 0;
          o.flBlackHole = true; o.timer = 100;
        }
        if (o.flBlackHole && o.timer > 0 && jeu.hero) {
          o.timer -= tmod;
          const dif = jeu.hero.x - this.x;
          if (dif !== 0) jeu.hero.x -= Math.min(Math.max(-2, 40 / dif), 2) * tmod;
        }
        break;
      }
      case 14: {                      // Astro-raisin : avance par à-coups
        const o = this.behaviourInfo;
        const c = Math.pow(0.8, tmod);
        this.vitx *= c;
        this.vity *= c;
        if (this.vity < 0.1) {
          this.vity = o.speed;
          this.vitx = o.speed * (jeu.hasard(3) - 1);
        }
        break;
      }
      case 15:                        // Space-Kumquat : rebrousse vers le vaisseau
        if ((this.x < 0 || this.x > LARGEUR) && this.y < HAUTEUR - 10) {
          const a = this.angle(jeu.cibleHero());
          this.vitx = Math.cos(a) * 4;
          this.vity = Math.sin(a) * 4;
        }
        break;
      case 17: {                      // Demon lemon : boule qui charge de près
        const o = this.behaviourInfo;
        if (o.step === undefined) o.step = 0;
        for (let i = 0; i < jeu.hShotList.length; i++) {
          const m = jeu.hShotList[i];
          if (this.touche(m.x, m.y)) { m.tuer(); this.flHit = false; }
        }
        if (this.flHit && jeu.hero) {
          if (o.step === 0) { if (this.distance(jeu.hero) < 100) o.step = 1; }
          else this.suivre(jeu.hero, 0.7, 2, tmod);
        }
        break;
      }
      case 20:                        // Bulbe : chercheuse lourde
        this.suivre(jeu.cibleHero(), 0.25, 5, tmod);
        this.vity += 0.3 * tmod;
        break;
      case 21: {                      // Cosmo-Cassis : chercheuse à durée limitée
        const o = this.behaviourInfo;
        if (o.timer > 0) {
          o.timer -= tmod;
          this.suivre(jeu.cibleHero(), 0.5, 1, tmod);
          if (o.timer <= 0) this.time = 100;
        }
        break;
      }
      case 22: {                      // Pois casseur : file, se replace, repart
        const o = this.behaviourInfo;
        if (o.step === 0) {
          if (jeu.hasard(60) === 0) {
            o.step = 1;
            o.ty = this.y - 80;
            o.vitx = -this.vitx; o.vity = this.vity;
            this.vitx = 0; this.vity = 0;
          }
          if (this.x < 0) this.vitx = Math.abs(this.vitx);
          if (this.x > LARGEUR) this.vitx = -Math.abs(this.vitx);
        } else {
          const dy = o.ty - this.y;
          this.y += dy * Math.pow(0.5, tmod);
          if (Math.abs(dy) < 2) { this.vitx = o.vitx; this.vity = o.vity; o.step = 0; }
        }
        break;
      }
      case 23:                        // Brugnon : mine destructible qui essaime
        for (let i = 0; i < jeu.hShotList.length; i++) {
          const m = jeu.hShotList[i];
          if (this.distance(m) < 10) { m.tuer(); this.flHit = false; }
        }
        if (this.flHit && jeu.hasard(Math.max(1, Math.round(18 / tmod))) === 0) {
          const a = jeu.hasard(628) / 100;
          jeu.newBShot({ x: this.x, y: this.y, vitx: Math.cos(a) * 4, vity: Math.sin(a) * 4 });
        }
        break;
      case 16: {                      // Tir destructible par le vaisseau
        for (let i = 0; i < jeu.hShotList.length; i++) {
          const m = jeu.hShotList[i];
          if (this.touche(m.x, m.y)) { m.tuer(); this.flHit = false; }
        }
        break;
      }
      case 19: {                      // Courge : sinusoïde qui s'élargit
        const o = this.behaviourInfo;
        o.amp += tmod * 0.6;
        o.d = (o.d + 18) % 628;
        this.x = o.x + Math.sin(o.d / 100) * o.amp;
        break;
      }
      case 24:                        // Rebondit sur les bords et le bas
        if (this.x < 0) this.vitx = Math.abs(this.vitx);
        if (this.x > LARGEUR) this.vitx = -Math.abs(this.vitx);
        if (this.y > HAUTEUR) this.vity = -Math.abs(this.vity);
        break;
      default:
        break;
    }

    if (this.time !== undefined) {
      this.time -= tmod;
      if (this.time < 0) { this.tuer(); return; }
    }

    // Hors limites. Un tir du vaisseau parti dans le vide COÛTE un point : c'est
    // ce qui empêche d'arroser l'écran pour faire du score.
    if (this.x < -MARGE_TIR || this.x > LARGEUR + MARGE_TIR
      || this.y < -MARGE_TIR || this.y > HAUTEUR + MARGE_TIR) {
      if (this.flStandardHeroShot) jeu.incScore(-1);
      this.tuer();
    }
  }

  disparaitre() { this.jeu.evenement('tirDisparait', { x: this.x, y: this.y }); this.tuer(); }

  auContact() {
    if (this.behaviourId === 18) {     // Prune paralysante : brouille le vaisseau
      this.jeu.hero && this.jeu.hero.frapperEMP(100);
      this.tuer();
      return;
    }
    this.jeu.evenement('impact', { x: this.x, y: this.y });
    if (!this.flIndestructible) this.tuer();
  }

  suivre(cible, vitesse, tol, tmod) {
    if (!cible) return;
    const dx = cible.x - this.x, dy = cible.y - this.y;
    if (dx > tol) this.vitx += tmod * vitesse;
    if (dx < -tol) this.vitx -= tmod * vitesse;
    if (dy > tol) this.vity += tmod * vitesse;
    if (dy < -tol) this.vity -= tmod * vitesse;
    this.vitx *= this.jeu.frict;
    this.vity *= this.jeu.frict;
  }

  tuer() {
    super.tuer();
    const l = (this.listName === 'hShot') ? this.jeu.hShotList : this.jeu.bShotList;
    const i = l.indexOf(this);
    if (i >= 0) l.splice(i, 1);
  }
}

// ── Les ennemis ────────────────────────────────────────────────────────────
class Bads extends Sprite {
  constructor(jeu, o) {
    super(jeu, o);
    // Le profil de l'espèce (cadence, robustesse, armes) vient de la table TYPES.
    const p = TYPES[this.type] || {};
    this.profil = p;
    if (this.flWave === undefined) this.flWave = (p.flWave === undefined) ? true : p.flWave;
    if (this.freq === undefined) this.freq = (p.freq === undefined) ? 200 : p.freq;
    if (this.coolDownSpeed === undefined) this.coolDownSpeed = (p.cdSpeed === undefined) ? 5 : p.cdSpeed;
    if (this.coolDown === undefined) this.coolDown = 0;
    if (this.ray === undefined) this.ray = 10;
    if (this.hp === undefined) this.hp = (p.hp === undefined) ? 1 : p.hp;
    this.flReady = false;
    this.ty = this.y;
  }

  // Déplacement de la VAGUE : appelé par tranches (Game.updateWave), pas pour
  // tout le monde à chaque image. C'est ce qui donne son ondulation au bloc.
  waveUpdate(tmod) {
    const jeu = this.jeu;
    if (this.flWave) {
      this.x += jeu.waveSpeed * jeu.waveSens;
      const w = TAILLE_BADS / 2;
      if (jeu.waveSens < 0 && this.x < w) this.auBord();
      if (jeu.waveSens > 0 && this.x > LARGEUR - w) this.auBord();
      // Toucher le bas, c'est perdu : l'escadre a atteint la Terre.
      if (this.y > HAUTEUR - this.ray && jeu.hero) jeu.hero.exploser();
    }
    if (this.profil.vague) this.profil.vague(this, tmod);
    if (this.tirePendantLaVague()) this.verifierTir(tmod);
    this.verifierTirsHero();
    if (jeu.hero && this.y + this.ray > jeu.hero.y - jeu.hero.ray) this.verifierChocHero();
  }

  // Le jeu d'origine décide espèce par espèce : la classe de base ne tire pas,
  // et chaque sous-classe appelle (ou non) checkShoot depuis son waveUpdate.
  tirePendantLaVague() {
    if (this.profil.tire === false) return false;
    if (this.profil.peutTirer) return this.profil.peutTirer(this);
    return true;
  }

  verifierChocHero() {
    const h = this.jeu.hero;
    if (!h) return;
    const limite = 1.2 * (this.ray + h.ray) / 2;
    if (Math.abs(h.x - this.x) < limite && Math.abs(h.y - this.y) < limite) {
      this.frapper();
      h.frapper();
    }
  }

  verifierTirsHero() {
    for (let i = 0; i < this.jeu.hShotList.length; i++) {
      const m = this.jeu.hShotList[i];
      if (m.flHit && this.touche(m.x, m.y)) { m.auContact(); this.frapper(); return; }
    }
  }

  verifierTir(tmod) {
    if (this.coolDown > 0) return;
    // AS2 : if(!random(freq/tmod)) — une chance sur freq/tmod à chaque image.
    // L'Ananas remplace ce tirage par sa propre condition (il n'ouvre le feu que
    // lorsque le vaisseau passe sous lui).
    const tire = this.profil.cadence
      ? this.profil.cadence(this, tmod)
      : this.jeu.hasard(Math.max(1, Math.round(this.freq / tmod))) === 0;
    if (tire) {
      this.coolDown = 100;
      this.tirer();
    }
  }

  update(tmod) {
    const jeu = this.jeu;
    switch (jeu.step) {
      case ETAPE.ARRIVEE:
        if (this.wpTimer < 0) {
          const wp = this.wayPoint;
          if (wp.dist < jeu.gridInfo.ss) {
            this.x = wp.x;
            this.y = wp.y;
            if (wp.id === this.waveId) { this.flReady = true; this.ty = this.y; }
            else this.pointSuivant();
          } else {
            this.x += wp.dx;
            this.y += wp.dy;
            wp.dist -= jeu.gridInfo.ss;
          }
        } else {
          this.wpTimer -= tmod;
        }
        this.verifierTirsHero();
        break;
      case ETAPE.COMBAT:
        if (this.coolDown > 0) this.coolDown -= this.coolDownSpeed;
        if (this.flWave) {
          const dy = (this.ty - this.y) * 0.3;
          this.y += Math.min(dy, 4) * tmod;
        }
        if (this.profil.tic) this.profil.tic(this, tmod);
        break;
      default:
        break;
    }
  }

  // Chaîne les points de passage de sa ligne jusqu'au sien (waveId). Les cases
  // vides du niveau sont des points de passage sans vaisseau : on les traverse.
  pointSuivant(id) {
    const ligne = this.jeu.gridInfo.list[this.lineId];
    if (this.wayPoint === undefined) this.wayPoint = { id: 0 };
    else {
      do { this.wayPoint.id++; }
      while (this.wayPoint.id < ligne.length
        && !ligne[this.wayPoint.id]
        && this.wayPoint.id !== this.waveId);
    }
    if (id !== undefined) this.wayPoint.id = id;

    const data = ligne[this.wayPoint.id];
    if (!data) { this.flReady = true; this.ty = this.y; return; }
    this.wayPoint.x = data.x;
    this.wayPoint.y = data.y;
    const dx = data.x - this.x, dy = data.y - this.y;
    const a = Math.atan2(dy, dx);
    const ss = this.jeu.gridInfo.ss;
    this.wayPoint.dx = Math.cos(a) * ss;
    this.wayPoint.dy = Math.sin(a) * ss;
    this.wayPoint.dist = Math.sqrt(dx * dx + dy * dy);
  }

  // Le Pruneau passe-muraille ne fait pas rebondir la vague : il traverse.
  auBord() {
    if (this.profil.flWave !== false) this.jeu.flChangeSens = true;
    if (this.profil.auBord) this.profil.auBord(this);
  }

  exploser() {
    if (!this.vivant) return;
    if (this.profil.exploser) this.profil.exploser(this);
    this.jeu.evenement('badsExplose', { x: this.x, y: this.y, type: this.type });
    this.jeu.incScore(ENNEMIS[this.type].value);
    this.jeu.badsKill[this.type] = (this.jeu.badsKill[this.type] || 0) + 1;
    this.tuer();
  }

  // Les espèces à coques encaissent : chaque coup ôte un point de vie, et
  // certaines changent de comportement en se dégradant (la Poire s'affole,
  // la Myrtillerie se transforme en kamikaze).
  frapper() {
    this.hp--;
    if (this.hp <= 0) { this.exploser(); return; }
    this.jeu.evenement('badsEcaille', { x: this.x, y: this.y, type: this.type, hp: this.hp });
    if (this.profil.auCoup) this.profil.auCoup(this);
  }

  // Le tir « nu » de la classe de base : c'est lui que les espèces ajustent.
  tirBase() {
    // `badsType` sert au rendu : le jeu choisit l'aspect du projectile par
    // gotoAndStop(10 + type), et le client fait la même chose.
    const t = this.jeu.newBShot({ x: this.x, y: this.y, vitx: 0, vity: 2, badsType: this.type });
    this.jeu.evenement('tirBads', { x: this.x, y: this.y, type: this.type });
    return t;
  }

  tirer() {
    if (this.profil.tirer) return this.profil.tirer(this);
    return this.tirBase();
  }

  // Fin de l'arrivée : l'escadre passe en formation et se met à onduler.
  startWaveAttack() { this.wayPoint = undefined; }

  tuer() {
    super.tuer();
    const i = this.jeu.badsList.indexOf(this);
    if (i >= 0) this.jeu.badsList.splice(i, 1);
    this.jeu.toKill--;
  }
}

// ── Le boss ────────────────────────────────────────────────────────────────
// Un seul adversaire, mais TROIS formes qui s'enchaînent : la coquille, puis le
// casque, puis l'orange qu'ils protégeaient. Chacune a ses trente points de vie,
// sa façon de se déplacer et son répertoire d'attaques, tirées au sort dès que
// son temps de récupération est écoulé.
//
// Le détail qui fait le combat : sur la coquille, un tir n'entame rien tant
// qu'elle tourne vite (elle le renvoie). Il faut la frapper entre deux
// accélérations — et chaque coup encaissé l'accélère justement.
const FORME = { COQUILLE: 0, CASQUE: 1, ORANGE: 2 };

class Boss extends Sprite {
  constructor(jeu, o) {
    super(jeu, o);
    this.ray = 25;
    this.turning = 3;
    this.speedCoef = 1;
    this.vitx = 0;
    this.vity = 0;
    this.mvx = 0;
    this.mvy = 0;
    this.rotation = 0;                  // l'angle de la coquille : il dit sa vitesse
    this.specialCoolDown = 0;
    this.flash = 0;
    this.mains = [{ x: -20, y: 18 }, { x: 20, y: 18 }];
    this.initStep(0);
  }

  initStep(step) {
    const jeu = this.jeu;
    this.step = step;
    switch (step) {
      case 0:                            // la coquille descend du haut
        this.forme = FORME.COQUILLE;
        this.x = LARGEUR / 2;
        this.y = -100;
        this.hpMax = 30;
        this.hp = 30;
        this.vitx = 0; this.vity = 0;
        this.specialCoolDown = 0;
        // Deux oscillateurs indépendants : c'est eux qui lui donnent sa
        // trajectoire flottante, jamais deux fois la même.
        this.mvt = [
          { d: 157, s: 0, st: 5 + jeu.hasard(5) },
          { d: 157, s: 0, st: 5 + jeu.hasard(5) },
        ];
        jeu.evenement('bossArrive', { forme: this.forme });
        break;
      case 1:                            // état de veille : il choisit une attaque
        break;
      case 2:                            // ruée latérale, en tirant
        this.shootInfo = { type: 1, toShoot: 3, timer: 0, interval: 2 };
        this.vitx += 15 * ((this.x < LARGEUR / 2) ? -1 : 1);
        this.speedCoef = 8;
        this.specialCoolDown = 100;
        break;
      case 3:                            // roue de la mort : dix missiles
        this.shootInfo = { type: 1, toShoot: 10, timer: 36, interval: 3 };
        this.specialCoolDown = 200;
        break;
      case 9:                            // la coquille se disloque
        this.timer = 20;
        this.cible = { x: LARGEUR / 2, y: 120 };
        this.vitx = 0; this.vity = 0;
        jeu.evenement('bossForme', { forme: this.forme, fin: true });
        break;
      case 10:                           // le casque apparaît
        this.forme = FORME.CASQUE;
        this.hpMax = 30;
        this.hp = 30;
        this.specialCoolDown = 100;
        this.timer = 10;
        this.vitx = 0; this.vity = 0;
        this.mvt = { dy: 0, vy: 10, cy: 80, ey: 30, coy: 1, cox: 1, speed: 2, sens: 1 };
        jeu.evenement('bossArrive', { forme: this.forme });
        break;
      case 11:
        this.mvt.cox = 1;
        break;
      case 12:                           // souffle de flammes en balayant
        this.shootInfo = { type: 2, toShoot: 50, timer: 40, interval: 2.5 };
        this.specialCoolDown = 200;
        this.mvt.ty = 132;
        this.mvt.cox = 0.2;
        break;
      case 13:                           // double laser
        this.shootInfo = { type: 3, toShoot: 3, timer: 60, interval: 20 };
        this.specialCoolDown = 100;
        break;
      case 14:                           // laser d'une seule main
        this.shootInfo = { type: 3, toShoot: 6, timer: 70, interval: 9, hand: jeu.hasard(2) };
        this.specialCoolDown = 100;
        break;
      case 19:                           // le casque éclate
        this.mvt = { d: 10, timerMax: 10, x: this.x, y: this.y };
        this.timer = 10;
        jeu.evenement('bossForme', { forme: this.forme, fin: true });
        break;
      case 20:                           // l'orange, à nu
        this.forme = FORME.ORANGE;
        this.timer = 20;
        this.vitx = 0; this.vity = 0;
        this.hpMax = 30;
        this.hp = 30;
        this.mvt = { dy: 0, ty: 100, vy: 16, cy: 100, ey: 60, coy: 1, cox: 1, speed: 4, sens: 1 };
        jeu.evenement('bossArrive', { forme: this.forme });
        break;
      case 21:
        this.mvt.cy = 100;
        this.mvt.ey = 60;
        break;
      case 22:                           // gerbes circulaires
        this.shootInfo = { type: 4, toShoot: 5, timer: 20, interval: 14, hand: jeu.hasard(2) };
        this.specialCoolDown = 140;
        break;
      case 23:                           // il se couvre d'une escorte
        this.shootInfo = { timerMax: 60 };
        this.timer = 60;
        this.specialCoolDown = 180;
        break;
      case 24:                           // la morsure du soleil : il descend et charge
        this.shootInfo = { step: 0 };
        this.mvt.ty = 0;
        this.mvt.cy = 50;
        this.mvt.ey = 10;
        this.timer = 80;
        this.specialCoolDown = 200;
        break;
      case 25:                           // rafale en glissant sur le côté
        this.shootInfo = {
          type: 6, toShoot: 8, timer: 0, interval: 3,
          hand: (this.x < LARGEUR / 2) ? 0 : 1,
        };
        this.specialCoolDown = 80;
        break;
      case 29:                           // agonie
        this.mvt = { d: 8, timerMax: 80, x: this.x, y: this.y };
        this.timer = 80;
        jeu.evenement('bossForme', { forme: this.forme, fin: true });
        break;
      case 30:                           // explosion finale
        this.timer = 80;
        jeu.evenement('bossExplose', { x: this.x, y: this.y });
        break;
      default:
        break;
    }
  }

  update(tmod) {
    const jeu = this.jeu;
    this.speedCoef = this.speedCoef * 0.9 + 0.1;
    if (this.flash > 0) this.flash -= tmod;
    this.verifierChocHero();

    switch (this.step) {
      case 0:
        this.rotation += this.turning * this.speedCoef;
        this.y += 6 * tmod;
        if (this.y > HAUTEUR / 2) this.initStep(1);
        break;
      case 1:
        this.tournerCoquille(tmod);
        this.bougerCoquille(tmod);
        this.choisirAttaque(tmod);
        this.verifierTirsHero();
        break;
      case 2:
      case 3:
        this.tournerCoquille(tmod);
        this.bougerCoquille(tmod);
        this.tirer(tmod);
        if (this.step === 3) {
          this.mvt[0].s *= 0.8;
          this.mvt[1].s *= 0.8;
          this.speedCoef *= 1.1;
        }
        if (this.shootInfo.toShoot === 0) this.step = 1;
        this.verifierTirsHero();
        break;
      case 9:                             // dislocation, puis le casque
        this.derive(tmod);
        this.timer -= tmod;
        if (this.timer < 0) this.initStep(10);
        break;
      case 10:
        this.timer -= tmod;
        if (this.timer < 0) this.initStep(11);
        break;
      case 11:
        this.bougerOrange(tmod);
        this.choisirAttaque(tmod);
        this.verifierTirsHero();
        // En veille, il lâche des lasers de temps à autre : plus il est bas en
        // vie, plus c'est fréquent.
        if (jeu.hasard(Math.max(1, Math.round((40 + 40 * (this.hp / this.hpMax)) / tmod))) === 0) {
          this.shootInfo = { type: 3, toShoot: 0, timer: -1 };
          this.tirer(tmod);
        }
        break;
      case 12:
      case 13:
      case 14:
        this.bougerOrange(tmod);
        this.tirer(tmod);
        if (this.shootInfo.toShoot === 0) this.initStep(11);
        this.verifierTirsHero();
        break;
      case 19:
        this.timer -= tmod;
        if (this.timer < 0) this.initStep(20);
        break;
      case 20:
        this.timer -= tmod;
        if (this.timer < 0) this.initStep(21);
        break;
      case 21:
        this.bougerOrange(tmod);
        this.choisirAttaque(tmod);
        this.verifierTirsHero();
        break;
      case 22:
      case 25:
        this.bougerOrange(tmod);
        this.tirer(tmod);
        if (this.shootInfo.toShoot === 0) this.initStep(21);
        this.verifierTirsHero();
        break;
      case 23: {                          // escorte : il appelle des ennemis
        this.bougerOrange(tmod);
        this.timer -= tmod;
        if (this.timer === Math.floor(this.timer) && jeu.badsList.length < 6
          && jeu.hasard(Math.max(1, Math.round(10 / tmod))) === 0) {
          const b = jeu.newBads(0, {
            x: this.x + (jeu.hasard(80) - 40), y: this.y + 30,
            waveId: 0, lineId: 0, wpTimer: -1, flWave: false,
          });
          b.flReady = true;
        }
        if (this.timer < 0) this.initStep(21);
        this.verifierTirsHero();
        break;
      }
      case 24: {                          // morsure du soleil : invulnérable en charge
        this.bougerOrange(tmod);
        this.timer -= tmod;
        if (this.shootInfo.step === 0 && this.timer < 0) {
          this.shootInfo.step = 1;
          this.shootInfo.type = 5;
          this.shootInfo.toShoot = 12;
          this.shootInfo.timer = 0;
          this.shootInfo.interval = 4;
        }
        if (this.shootInfo.step === 1) {
          this.tirer(tmod);
          if (this.shootInfo.toShoot === 0) this.initStep(21);
        }
        this.verifierTirsHero();
        break;
      }
      case 29:
        this.timer -= tmod;
        if (this.timer < 0) this.initStep(30);
        break;
      case 30:
        this.timer -= tmod;
        if (this.timer < 0) this.tuer();
        break;
      default:
        break;
    }
  }

  tournerCoquille(tmod) { this.rotation += this.turning * this.speedCoef * tmod; }

  // Deux sinus décorrélés : la coquille flotte sans jamais répéter le même
  // trajet, et ses à-coups (o.st retiré au hasard) la rendent imprévisible.
  bougerCoquille(tmod) {
    for (let i = 0; i < 2; i++) {
      const o = this.mvt[i];
      o.s = o.s * 0.95 + o.st * 0.05;
      o.d = (o.d + o.s * tmod) % 628;
      if (this.jeu.hasard(Math.max(1, Math.round(200 / tmod))) === 0) o.st = 5 + this.jeu.hasard(5);
    }
    const w = LARGEUR / 2;
    this.x = w + Math.cos(this.mvt[0].d / 100) * (w - 50);
    this.y = 100 + Math.sin(this.mvt[1].d / 100) * 40;
  }

  derive(tmod) {
    const dx = this.cible.x - this.x, dy = this.cible.y - this.y;
    this.vitx += Math.min(Math.max(-1, dx / 10), 1) * tmod;
    this.vity += Math.min(Math.max(-1, dy / 10), 1) * tmod;
    const f = Math.pow(0.99, tmod);
    this.vitx *= f; this.vity *= f;
    this.x += this.vitx; this.y += this.vity;
  }

  // Casque et orange : glissement horizontal, hauteur en sinus, et une vitesse
  // qui AUGMENTE à mesure qu'il perd des points de vie. Acculé, il devient
  // beaucoup plus difficile à suivre.
  bougerOrange(tmod) {
    const m = this.mvt;
    const chp = this.hp / this.hpMax;
    this.x += (m.speed + (1 - chp) * 6) * m.cox * m.sens * tmod;
    m.dy = (m.dy + m.vy * m.coy * tmod) % 628;
    const y = m.cy + Math.cos(m.dy / 100) * m.ey;
    if (m.ty !== undefined) {
      if (this.step === 11 || this.step === 21 || this.step === 24) {
        m.ty = y;
        if (Math.abs(this.y - m.ty) < 2) m.ty = undefined;
      }
      if (m.ty !== undefined) this.y = this.y * 0.9 + m.ty * 0.1;
    }
    if (m.ty === undefined) this.y = y;
    if (this.x < this.ray) { this.x = this.ray; m.sens *= -1; }
    if (this.x > LARGEUR - this.ray) { this.x = LARGEUR - this.ray; m.sens *= -1; }
    this.mvx = (m.speed + (1 - chp) * 6) * m.cox * m.sens;
    this.mains[0].x = -20; this.mains[1].x = 20;
  }

  // checkBehaviour : dès que le temps de récupération est écoulé, chaque forme
  // pioche dans SON répertoire.
  choisirAttaque(tmod) {
    if (this.specialCoolDown >= 0) { this.specialCoolDown -= tmod; return; }
    const jeu = this.jeu;
    const un = (n) => jeu.hasard(Math.max(1, Math.round(n / tmod))) === 0;
    const chp = this.hp / this.hpMax;
    switch (this.forme) {
      case FORME.COQUILLE:
        if (this.y < 100 && un(100)) { this.vity = 18; this.specialCoolDown = 80; }
        if (un(100)) this.initStep(2);
        if (chp < 0.5 && un(100)) this.initStep(3);   // la roue n'arrive qu'à mi-vie
        break;
      case FORME.CASQUE:
        if (un(100)) this.initStep(12);
        if (un(100)) this.initStep(13);
        if (un(100)) this.initStep(14);
        break;
      case FORME.ORANGE:
        if (un(100)) this.initStep(22);
        if (un(60)) this.initStep(23);
        if (un(160)) this.initStep(24);
        if (un(100)) this.initStep(25);
        break;
      default:
        break;
    }
  }

  tirer(tmod) {
    const o = this.shootInfo;
    if (!o) return;
    if (o.timer >= 0) { o.timer -= tmod; return; }
    const jeu = this.jeu;
    const h = jeu.cibleHero();
    switch (o.type) {
      case 0:
      case 1: {                            // missile guidé
        const a = this.angle(h);
        jeu.newBShot({ x: this.x, y: this.y, vitx: Math.cos(a) * 6.5, vity: Math.sin(a) * 6.5 });
        break;
      }
      case 2:                              // deux jets de flamme
        for (let i = 0; i < 2; i++) {
          jeu.newBShot({
            x: this.x + this.mains[i].x, y: this.y + 28,
            vitx: this.mvx * 0.8 + (jeu.hasard(20) - 10) / 20, vity: 6,
          });
        }
        break;
      case 3:                              // laser (une main ou les deux)
        for (let i = 0; i < 2; i++) {
          if (o.hand !== undefined && o.hand !== i) continue;
          jeu.newBShot({ x: this.x + this.mains[i].x, y: this.y + this.mains[i].y + 10, vitx: 0, vity: 10 });
        }
        break;
      case 4: {                            // gerbe circulaire de dix-huit boules
        const max = 18;
        const m = this.mains[o.hand || 0];
        for (let i = 0; i < max; i++) {
          const a = (i / max) * 6.28 + (o.toShoot % 2) * (6.28 / (max * 2));
          jeu.newBShot({
            x: this.x + m.x, y: this.y + m.y,
            vitx: Math.cos(a) * 5, vity: Math.sin(a) * 5,
          });
        }
        break;
      }
      case 5: {                            // boule d'énergie vers le vaisseau
        const a = this.angle(h);
        jeu.newBShot({
          x: this.x + Math.cos(a) * 25, y: this.y + Math.sin(a) * 25,
          vitx: Math.cos(a) * 3.5, vity: Math.sin(a) * 3.5,
        });
        break;
      }
      case 6: {                            // rafale d'une main
        const m = this.mains[o.hand || 0];
        jeu.newBShot({
          x: this.x + m.x, y: this.y + m.y,
          vitx: 2 * (jeu.rng() * 2 - 1), vity: 4,
        });
        break;
      }
      default:
        break;
    }
    this.jeu.evenement('bossTire', { type: o.type, x: this.x, y: this.y });
    if (o.toShoot === 0 || o.toShoot === undefined) o.toShoot = 0;
    else { o.toShoot--; o.timer += o.interval; }
  }

  verifierChocHero() {
    const h = this.jeu.hero;
    if (!h) return;
    if (this.distance(h) < this.ray + h.ray) h.frapper(10);
  }

  verifierTirsHero() {
    for (const t of this.jeu.hShotList.slice()) {
      if (t.flHit && this.touchePar(t.x, t.y)) this.essayerDeToucher(t);
    }
  }

  touchePar(x, y) {
    // La coquille présente une cible plus large que les deux autres formes.
    const coef = (this.forme === FORME.COQUILLE) ? 1.3 : 1;
    return this.distance({ x, y }) < this.ray * coef;
  }

  // Tout ne l'entame pas : la coquille lancée renvoie les tirs, et l'orange en
  // pleine « morsure du soleil » est invulnérable le temps de sa charge.
  essayerDeToucher(t) {
    const renvoi = (this.forme === FORME.COQUILLE && this.speedCoef > 1.5)
      || (this.step === 24 && this.shootInfo && this.shootInfo.step === 0);
    if (renvoi) {
      this.jeu.evenement('bossRenvoi', { x: t.x, y: t.y });
      t.tuer();
      return;
    }
    this.frapper(t);
    t.auContact();
    t.tuer();
  }

  frapper(t) {
    this.hp--;
    this.flash = 20;
    // Le tir à tête chercheuse du vaisseau secoue dix fois moins : sans quoi il
    // suffirait de l'arroser pour l'envoyer au plafond.
    const coef = (t && t.behaviourId === 8) ? 0.1 : 1;
    this.jeu.evenement('bossTouche', { hp: this.hp, hpMax: this.hpMax, forme: this.forme });
    switch (this.forme) {
      case FORME.COQUILLE:
        this.speedCoef += 4;              // chaque coup l'accélère, donc la protège
        this.vitx += (this.x - (t ? t.x : this.x)) / 6;
        this.vity += -12 * coef;
        if (this.hp <= 0) this.initStep(9);
        break;
      case FORME.CASQUE:
        this.vity += -1 * coef;
        if (this.hp <= 0) this.initStep(19);
        break;
      default:
        this.vity += -2 * coef;
        if (this.hp <= 0) this.initStep(29);
        break;
    }
  }

  // La mort du vaisseau interrompt l'attaque en cours : le boss reprend sa veille.
  onHeroKill() {
    this.specialCoolDown = 100;
    if (this.step === 2 || this.step === 3) this.step = 1;
    else if (this.step >= 12 && this.step <= 14) this.initStep(11);
    else if (this.step === 22) this.initStep(21);
  }

  tuer() {
    super.tuer();
    this.jeu.boss = null;
    this.jeu.bossVaincu();
  }
}

// ── Les 51 ennemis ─────────────────────────────────────────────────────────
// Le jeu d'origine en fait 51 sous-classes d'une trentaine de lignes, dont
// l'écrasante majorité ne change que trois valeurs (cadence, robustesse) et la
// façon de tirer. Une table dit la même chose sans 51 fichiers, et la garde
// LISIBLE : on voit d'un coup d'œil qui tire quoi.
//
//   freq / cdSpeed  cadence de tir (une chance sur freq par image, refroidie
//                   à cdSpeed par image)
//   hp              nombre de coups à encaisser (défaut 1)
//   flWave          false = ne suit pas l'ondulation de l'escadre
//   tire            false = ne tire pas de lui-même (il a une autre arme)
//   tirer(b)        sa façon de tirer
//   vague/tic(b,t)  ce qu'il fait en plus, pendant la vague / à chaque image
//   auBord(b)       sa réaction quand l'escadre touche un bord
//   exploser(b)     ce qu'il laisse derrière lui
//   peutTirer(b,t)  condition de tir, quand elle n'est pas la règle générale
const TYPES = {};
const def = (t, o) => { TYPES[t] = o; };

// Un tir de base, puis on l'ajuste : c'est exactement ce que fait super.shoot().
const base = (b) => b.tirBase();
const versHero = (b, vitesse, tir) => {
  const a = b.angle(b.jeu.cibleHero());
  tir.vitx = Math.cos(a) * vitesse;
  tir.vity = Math.sin(a) * vitesse;
  return tir;
};

def(0, { tire: false });                                          // Fraise-bouclier : inoffensive
def(1, { freq: 800, cdSpeed: 1, hp: 2 });                         // Orangeonaute : encaisse deux coups
def(2, { tirer: (b) => { const t = base(b); t.vitx = (b.jeu.hasard(200) - 100) / 100; t.vity = 2.5; } });
def(3, {                                                          // Clémentine : deux tirs divergents
  freq: 400, cdSpeed: 1,
  tirer: (b) => { for (let i = 0; i < 2; i++) { const s = i * 2 - 1, t = base(b); t.x = b.x + 3 * s; t.vitx = 0.5 * s; t.vity = 2; } },
});
def(4, {                                                          // Kamikaze : plonge quand on passe dessous
  tire: false,
  vague: (b, tmod) => {
    if (b.mode) return;
    const h = b.jeu.cibleHero();
    if (Math.abs(h.x - b.x) < 10 && b.jeu.hasard(Math.max(1, Math.round(30 / tmod))) === 0) {
      b.mode = 1; b.vity = 0; b.flWave = false;
    }
  },
  tic: (b, tmod) => {
    if (b.mode !== 1) return;
    b.vity = Math.min(b.vity + 0.5, 8) * tmod;
    b.y += b.vity * tmod;
    if (b.y > HAUTEUR + 20) b.tuer();
  },
});
def(5, {                                                          // Cerises-duo : une gerbe de trois
  freq: 400, cdSpeed: 0.5,
  tirer: (b) => { for (let i = 0; i < 3; i++) { const s = i - 1, t = base(b); t.x = b.x + 4 * s; t.vitx = 0.8 * s; t.vity = 1.5 + 0.3 * (1 - Math.abs(s)); } },
});
def(6, { freq: 130, cdSpeed: 10 });                               // Fraise des bois : tire vite
def(7, {                                                          // Poire sous cloche : la coque cassée, elle s'affole
  hp: 2, peutTirer: (b) => b.hp === 1,
  auCoup: (b) => { b.freq = 10; b.cdSpeed = 5; },
  tirer: (b) => { base(b).vity = 3; },
});
def(8, {                                                          // Astro-Pamplemousse : bombe qui éclate
  freq: 600, cdSpeed: 5,
  peutTirer: (b) => b.y < HAUTEUR - 70,
  tirer: (b) => { const t = base(b); t.vity = 1; t.behaviourId = 0; },
});
def(9, {                                                          // Cosmo-Prune : descend d'un cran au bord
  tire: false,
  auBord: (b) => {
    let y = HAUTEUR - 60;
    while (y > b.y) { if (b.jeu.placeLibre(b.x, y)) { b.ty = y; break; } y -= 24; }
  },
});
def(10, {                                                         // Coing mutant : tir en éventail aléatoire
  freq: 200, cdSpeed: 10,
  tirer: (b) => { const t = base(b), a = (57 + b.jeu.hasard(200)) / 100; t.vitx = Math.cos(a) * 2.5; t.vity = Math.sin(a) * 2.5; },
});
def(11, {                                                         // Figue-laser : un rayon qui balaie sa colonne
  freq: 200, cdSpeed: 0.5,
  peutTirer: (b) => !b.flShooting,
  tirer: (b) => { b.flShooting = true; b.timer = 48; b.jeu.evenement('rayonFigue', { x: b.x, y: b.y }); },
  vague: (b, tmod) => {
    if (!b.flShooting) return;
    if (b.timer <= 0) { b.flShooting = false; return; }
    // Entre l'ouverture et la fermeture, la colonne sous lui est mortelle.
    if (b.timer <= 36 && b.timer > 12) {
      const h = b.jeu.hero;
      if (h && Math.abs(h.x - b.x) < h.ray) h.frapper();
    }
  },
  tic: (b, tmod) => { if (b.flShooting) b.timer -= tmod; },
});
def(12, {                                                         // Batmandarine : se téléporte sur le côté
  freq: 280, cdSpeed: 1,
  vague: (b) => {
    if (b.flStrafe) { b.flStrafe = false; return; }
    if (b.jeu.hasard(200) !== 0) return;
    for (let i = 0; i < 10; i++) {
      const x = 15 + b.jeu.hasard(LARGEUR - 30);
      if (Math.abs(b.x - x) < 60 && b.jeu.placeLibre(x, b.y)) { b.x = x; b.flStrafe = true; break; }
    }
  },
});
def(13, {                                                         // Pomme d'épines : arrose en mourant
  tire: false,
  exploser: (b) => {
    for (let i = 0; i < 5; i++) { const t = b.tirBase(); const c = ((i * 2) - 4) / 4; t.vitx = c * 3; t.vity = 2.5; }
  },
});
def(14, {                                                         // Astro-Datte : rafale de trois vers le vaisseau
  freq: 240, cdSpeed: 4,
  peutTirer: (b) => !(b.toShot > 0),
  tirer: (b) => {
    if (!b.toShot) b.toShot = 2;
    versHero(b, 3, base(b));
    b.timer = 5;
  },
  vague: (b) => { if (b.toShot > 0 && b.timer < 0) { versHero(b, 3, base(b)); b.toShot--; b.timer = 5; } },
  tic: (b, tmod) => { if (b.toShot > 0) b.timer -= tmod; },
});
def(15, {                                                         // Pruneau magnétique : aspire le vaisseau vers le haut
  freq: 240, cdSpeed: 50,
  tic: (b, tmod) => {
    const h = b.jeu.hero;
    if (b.jeu.step === ETAPE.COMBAT && h && Math.abs(b.x - h.x) < b.ray + 2 && h.flLine) h.y -= 1.5 * tmod;
  },
});
def(16, { freq: 220, cdSpeed: 4, tirer: (b) => { base(b).behaviourId = 1; } });   // Mère chercheuse
def(17, {                                                         // Citrus : trois coques, puis une pluie
  freq: 280, cdSpeed: 3, hp: 3,
  peutTirer: (b) => b.hp === 1,
  tirer: (b) => {
    for (let i = 0; i < 5; i++) {
      const t = base(b);
      t.vitx = 8 * (b.jeu.hasard(200) - 100) / 100;
      t.vity = -(3 + b.jeu.hasard(30) / 10);
      t.behaviourId = 3;
    }
  },
});
def(18, {                                                         // Astéropulpe : gerbe en touchant le bord
  freq: 500, cdSpeed: 8,
  tirer: (b) => {
    for (const s of [1, -1]) { const t = base(b); t.vitx = 3 * s; t.vity = 3; }
  },
  auBord: (b) => {
    for (let i = 0; i < 5; i++) {
      const a = (Math.PI / 2) + ((i + 1) / 5 * (Math.PI / 2)) * b.jeu.waveSens;
      const t = b.tirBase();
      t.vitx = Math.cos(a) * 3;
      t.vity = Math.sin(a) * 3;
    }
  },
});
def(19, {                                                         // Baies : trois têtes chercheuses posthumes
  tire: false,
  exploser: (b) => {
    for (let i = 0; i < 3; i++) {
      const t = b.tirBase();
      t.vitx = 8 * (b.jeu.hasard(200) - 100) / 100;
      t.vity = -(3 + b.jeu.hasard(30) / 10);
      t.behaviourId = 2;
    }
  },
});
def(20, { freq: 300, cdSpeed: 20, tirer: (b) => versHero(b, 3, base(b)) });        // Aigrelle assassine
def(21, {                                                         // Mangue-strike : balaie en éventail
  freq: 400, cdSpeed: 100,
  peutTirer: (b) => !(b.toShot > 0),
  tirer: (b) => {
    if (!b.toShot) b.toShot = 7;
    const c = b.toShot / 8, d = Math.PI / 2, a = d + ((c * 2) - 1) * d;
    const t = base(b);
    t.vitx = Math.cos(a) * 3;
    t.vity = Math.sin(a) * 3;
    b.timer = 3;
    b.toShot--;
  },
  vague: (b) => { if (b.toShot > 0 && b.timer < 0) TYPES[21].tirer(b); },
  tic: (b, tmod) => { if (b.toShot > 0) b.timer -= tmod; },
});
def(22, {                                                         // Tyson : envoie ses deux poings
  freq: 240, cdSpeed: 20,
  tirer: (b) => {
    if (!b.poings) b.poings = [true, true];
    for (let i = 0; i < 2; i++) {
      if (!b.poings[i]) continue;
      const t = base(b);
      t.vity = 10;
      t.behaviourId = 4;
      t.behaviourInfo = { id: i, step: 0, path: b };
      b.poings[i] = false;
      b.rendrePoing = (id) => { b.poings[id] = true; };
      return;
    }
  },
});
def(23, {                                                         // Cosmirabelle : un rayon de 160 px
  freq: 220, cdSpeed: 4,
  tirer: (b) => {
    const t = base(b);
    t.vity = 4;
    t.behaviourId = 5;
    t.behaviourInfo = { length: 160, parcouru: 0 };
  },
});
def(24, {                                                         // Astro-Quetsch : dévie les tirs qui l'approchent
  freq: 320, cdSpeed: 2,
  tirer: (b) => { base(b).vity = 4; },
  tic: (b) => {
    for (const m of b.jeu.hShotList) {
      const dx = m.x - b.x, dy = m.y - b.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < 26 && d > 0) { const a = Math.atan2(dy, dx); m.x += Math.cos(a) * 2; m.y += Math.sin(a) * 2; }
    }
  },
});
def(25, {                                                         // Ananas sauvage : ne tire que sur la verticale
  cdSpeed: 15,
  peutTirer: () => true,
  cadence: (b, tmod) => {
    const d = Math.abs(b.x - b.jeu.cibleHero().x);
    return b.jeu.hasard(Math.max(1, Math.round((d * 3) / tmod))) === 0;
  },
  tirer: (b) => { base(b).vity = 8; },
});
def(26, {                                                         // Myrtillerie lourde : à moitié détruite, elle fonce
  hp: 2, tire: false,
  auCoup: (b) => { b.flKamikaze = true; b.flWave = false; b.vitx = 0; b.vity = 0; },
  tic: (b, tmod) => {
    if (!b.flKamikaze) return;
    const h = b.jeu.cibleHero();
    const dx = h.x - b.x, dy = h.y - b.y;
    if (dx > 5) b.vitx += tmod * 0.2;
    if (dx < -5) b.vitx -= tmod * 0.2;
    if (dy > 5) b.vity += tmod * 0.2;
    if (dy < -5) b.vity -= tmod * 0.2;
    const c = Math.pow(0.98, tmod);
    b.vitx *= c; b.vity *= c;
    b.x += b.vitx; b.y += b.vity;
  },
});
def(27, {                                                         // Fraise-shuriken : un seul projectile, qui revient
  freq: 320, cdSpeed: 4,
  peutTirer: (b) => b.flShotReady !== false,
  tirer: (b) => {
    const t = base(b);
    t.behaviourId = 11;
    t.behaviourInfo = { timer: 44, launcher: b };
    t.vitx = (b.jeu.hasard(2) * 2 - 1) * 8;
    t.vity = 0;
    b.flShotReady = false;
    b.reprendreTir = () => { b.flShotReady = true; };
  },
});
def(28, {                                                         // Aubergine folle : charge en laissant sa place
  tire: false,
  vague: (b) => {
    if (b.step) return;
    if (b.jeu.hasard(300) !== 0) return;
    const c = b.jeu.cibleHero();
    b.step = 1;
    b.kx = b.x; b.ky = b.y;
    b.timer = b.distance(c) / 6.6;
    b.cible = { x: c.x, y: c.y };
    b.vitx = 0; b.vity = 0;
  },
  tic: (b, tmod) => {
    if (b.step !== 1) return;
    const t = b.cible;
    const dx = t.x - b.kx, dy = t.y - b.ky;
    if (dx > 1) b.vitx += tmod * 0.5;
    if (dx < -1) b.vitx -= tmod * 0.5;
    if (dy > 1) b.vity += tmod * 0.5;
    if (dy < -1) b.vity -= tmod * 0.5;
    b.vitx *= b.jeu.frict; b.vity *= b.jeu.frict;
    b.kx += b.vitx; b.ky += b.vity;
    if (b.timer > 0) b.timer -= tmod;
    else {
      b.cible = { x: b.x, y: b.y };
      const ddx = b.kx - b.x, ddy = b.ky - b.y;
      if (Math.sqrt(ddx * ddx + ddy * ddy) < 6) b.step = 0;
    }
  },
});
def(29, {                                                         // Space-Groseille : plonge en piqué
  freq: 400, cdSpeed: 100,
  tirer: (b) => {
    const t = base(b);
    const h = b.jeu.cibleHero();
    t.behaviourId = 12;
    t.behaviourInfo = { target: { x: h.x, y: h.y } };
    const u = (Math.PI / 4) * 100;
    const a = (b.jeu.hasard(2 * u) - u * 3) / 100;
    t.vitx = Math.cos(a) * 12;
    t.vity = Math.sin(a) * 12;
  },
});
def(30, {                                                         // Pêche astronomique : tir oblique rapide
  freq: 220, cdSpeed: 6,
  tirer: (b) => {
    const u = (Math.PI / 4) * 100;
    const a = (u * 3 - b.jeu.hasard(2 * u)) / 100;
    const t = base(b);
    t.vitx = Math.cos(a) * 6;
    t.vity = Math.sin(a) * 6;
  },
});
def(31, { tire: false, auBord: (b) => versHero(b, 6, b.tirBase()) });             // Abricot guerrier
def(32, { freq: 400, cdSpeed: 2, tirer: (b) => { base(b).behaviourId = 13; } });   // Nectarine trou-noir
def(33, {                                                         // Pruneau passe-muraille : traverse l'écran
  flWave: false, tire: false,
  vague: (b, tmod) => {
    b.x += b.jeu.waveSpeed;
    if (b.x > LARGEUR + 10) { b.x = -10; b.cote = true; }
    b.y += Math.min((b.ty - b.y) * 0.3, 4) * tmod;
    const cote = b.x < LARGEUR / 2;
    if (b.cote !== undefined && b.cote !== cote) { b.aTirer = 3; b.timer = -1; }
    b.cote = cote;
  },
  tic: (b, tmod) => {
    if (!(b.aTirer > 0)) return;
    if (b.timer < 0) { b.aTirer--; versHero(b, 4, b.tirBase()); b.timer = 4; }
    else b.timer -= tmod;
  },
});
def(34, {                                                         // Astro-raisin : deux tirs saccadés
  freq: 200, cdSpeed: 1,
  tirer: (b) => {
    for (let i = 0; i < 2; i++) {
      const t = base(b);
      t.x = b.x + ((i * 2) - 1) * 6;
      t.vitx = 0; t.vity = 6;
      t.behaviourId = 14;
      t.behaviourInfo = { speed: 6 };
    }
  },
});
def(35, {                                                         // Betterave astrale : trois tirs en cône
  freq: 240, cdSpeed: 10,
  tirer: (b) => {
    for (let i = 0; i < 3; i++) {
      const a = (Math.PI / 2) + 0.4 * ((i / 2) * 2 - 1);
      const t = base(b);
      t.vitx = Math.cos(a) * 4.5;
      t.vity = Math.sin(a) * 4.5;
    }
  },
});
def(36, {                                                         // Scarabé pulpé : descend d'un cran par surprise
  freq: 400, cdSpeed: 4,
  tirer: (b) => { const t = base(b); t.vity = 4; },
  vague: (b, tmod) => {
    if (b.cdFall > 0) return;
    if (b.jeu.hasard(Math.max(1, Math.round(240 / tmod))) === 0 && b.jeu.placeLibre(b.x, b.y + 24, 12)) {
      b.ty += 24;
      b.cdFall = 12;
    }
  },
  tic: (b, tmod) => { b.cdFall = (b.cdFall || 0) - tmod; },
});
def(37, {                                                         // Space-Kumquat : rebondit sur les bords
  freq: 280, cdSpeed: 8,
  tirer: (b) => {
    const t = base(b);
    t.behaviourId = 15;
    t.vitx = 4 * (b.jeu.hasard(2) * 2 - 1);
    t.vity = 2;
  },
});
def(38, {                                                         // Poivri : vise là où le vaisseau VA
  freq: 220, cdSpeed: 40,
  tirer: (b) => {
    const h = b.jeu.cibleHero();
    const e = b.jeu.entree;
    const s = e.gauche ? -1 : (e.droite ? 1 : 0);
    const c = Math.min(b.distance(h) / 6, 24);
    const a = b.angle({ x: h.x + c * s * (h.speed || 0), y: h.y });
    const t = base(b);
    t.vitx = Math.cos(a) * 6;
    t.vity = Math.sin(a) * 6;
  },
});
def(39, {                                                         // Kiwi interstellaire : huit tirs destructibles
  freq: 360, cdSpeed: 1,
  tirer: (b) => {
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI / 2) + 0.8 * ((i / 7) * 2 - 1);
      const t = base(b);
      t.vitx = Math.cos(a) * 3.5;
      t.vity = Math.sin(a) * 3.5;
      t.behaviourId = 16;
    }
  },
});
def(40, {                                                         // Prune sidérale : mitraille vers le bas
  freq: 80, cdSpeed: 10,
  tirer: (b) => {
    const t = base(b);
    t.vitx = 3 * (b.jeu.hasard(200) - 100) / 100;
    t.vity = 7;
    t.y = b.y + 12;
  },
});
def(41, {                                                         // Prune paralysante : brouille au lieu de blesser
  freq: 220, cdSpeed: 10,
  tirer: (b) => {
    const t = versHero(b, 8, base(b));
    t.behaviourId = 18;
    t.flHit = false;
  },
});
def(42, {                                                         // Demon lemon : boule qui charge
  freq: 400, cdSpeed: 1,
  tirer: (b) => { const t = base(b); t.vity = 2.2; t.behaviourId = 17; },
});
def(43, {                                                         // Pêche jongleuse : tire souvent, un peu au hasard
  freq: 40, cdSpeed: 10,
  tirer: (b) => {
    const a = (157 + b.jeu.hasard(75) * (b.jeu.rng() * 2 - 1)) / 100;
    const t = base(b);
    t.vitx = Math.cos(a) * 5;
    t.vity = Math.sin(a) * 5;
  },
});
def(44, {                                                         // Courge céleste : tir en sinusoïde
  freq: 240, cdSpeed: 10,
  tirer: (b) => {
    const t = base(b);
    t.behaviourId = 19;
    t.behaviourInfo = { amp: 0, d: 0, x: b.x };
  },
});
def(45, {                                                         // Bulbe spatial : deux chercheuses lentes
  freq: 180, cdSpeed: 6,
  tirer: (b) => {
    for (let i = 0; i < 2; i++) {
      const t = base(b);
      t.vitx = (i * 2 - 1) * 5;
      t.vity = -2;
      t.behaviourId = 20;
    }
  },
});
def(46, {                                                         // Cosmo-Cassis : accumule des satellites puis les lâche
  freq: 400, cdSpeed: 10,
  vague: (b, tmod) => {
    if (!b.jetons) b.jetons = 0;
    if (b.jeu.hasard(Math.max(1, Math.round(60 / tmod))) === 0) b.jetons++;
    if (b.jetons > 10) TYPES[46].tirer(b);
  },
  tirer: (b) => {
    const n = b.jetons || 1;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 2 * Math.PI;
      const t = base(b);
      t.x = b.x + Math.cos(a) * 12;
      t.y = b.y + Math.sin(a) * 12;
      t.vitx = Math.cos(a) * 4;
      t.vity = Math.sin(a) * 4;
      t.behaviourId = 21;
      t.behaviourInfo = { timer: 14 };
    }
    b.jetons = 0;
  },
});
def(47, {                                                         // Pois casseur : tir erratique
  freq: 240, cdSpeed: 4,
  tirer: (b) => {
    const t = base(b);
    t.vitx = 6 * (b.jeu.hasard(2) * 2 - 1);
    t.vity = 6;
    t.behaviourId = 22;
    t.behaviourInfo = { step: 0 };
  },
});
def(48, {                                                         // Brugnon cuirassé : pose des mines
  freq: 360, cdSpeed: 1, hp: 2,
  tirer: (b) => { const t = base(b); t.vity = 0.6; t.behaviourId = 23; },
});
def(49, {                                                         // Nitro-pruneau : explose en chaîne
  freq: 200, cdSpeed: 50, tire: false,
  exploser: (b) => {
    const t = b.jeu.newHShot({
      x: b.x, y: b.y, vitx: b.vitx || 0, vity: 0,
      behaviourId: 7,
      behaviourInfo: { ray: 0, raySpeed: 16, frict: 0.77, timer: 16 },
    });
    return t;
  },
  tic: (b) => { b.vitx = b.x - (b.oldx === undefined ? b.x : b.oldx); b.oldx = b.x; },
});
def(50, { tire: false });                                          // Letter-monster : porte une lettre

// ── La partie ──────────────────────────────────────────────────────────────
class Game {
  /**
   * @param {object} o
   *   levels   tableau de niveaux (public/miniwave/levels.json, champ `levels`)
   *   graine   entier — même graine, même partie
   *   vies     nombre de vaisseaux (défaut 3, comme le jeu)
   *   ship     index du vaisseau
   *   onEvent  (nom, données) → le client y accroche sons et particules
   */
  constructor(o) {
    o = o || {};
    this.waveInfo = o.levels || [];
    this.rng = generateur(o.graine === undefined ? 1 : o.graine);
    this.onEvent = o.onEvent || null;
    this.heroList = [];
    const type = (o.ship === undefined) ? 0 : o.ship;
    for (let i = 0; i < (o.vies === undefined ? 3 : o.vies); i++) this.heroList.push(type);

    this.spriteList = [];
    this.badsList = [];
    this.hShotList = [];
    this.bShotList = [];
    this.badsKill = {};

    this.level = 0;
    this.score = 0;
    this.toKill = 0;
    this.waveIndex = 0;
    this.waveSens = 1;
    this.flChangeSens = false;
    this.flGameOver = false;
    this.termine = false;
    this.hero = null;
    this.boss = null;
    this.frict = FRICTION;
    this.entree = { gauche: false, droite: false, tir: false, bombe: false };
    this.shipBounds = { min: 0, max: LARGEUR };
    this.timer = 0;
    this.step = ETAPE.PANNEAU;
    this.attente = 0;               // décompte du panneau avant le niveau

    this.initStep(0);
  }

  // ── Aléatoire ──
  hasard(n) { return Math.floor(this.rng() * n); }

  evenement(nom, donnees) { if (this.onEvent) this.onEvent(nom, donnees); }

  // ── Étapes (game/Main.initStep) ──
  initStep(step) {
    this.step = step;
    switch (step) {
      case ETAPE.PANNEAU: {
        const info = this.waveInfo[this.level];
        if (info === undefined) { this.finPartie('fin'); return; }
        // Un niveau qui s'appelle « boss » n'a pas d'escadre : c'est le combat
        // de fin de parcours, annoncé plus longuement.
        this.estBoss = (info.name === 'boss');
        this.evenement('panneau', { level: this.level, name: info.name, boss: this.estBoss });
        this.attente = this.estBoss ? 160 : 80;
        break;
      }
      case ETAPE.ARRIVEE:
        this.initLevel();
        this.verifierHero();
        break;
      case ETAPE.COMBAT:
        for (let i = 0; i < this.badsList.length; i++) this.badsList[i].startWaveAttack();
        this.verifierHero();
        break;
      case ETAPE.SUIVANT:
        this.timer = 40;
        // `nextLevel` peut avoir été fixé plus loin (sortie par la droite, boss
        // vaincu) ; sinon c'est simplement le niveau suivant. Le client s'en sert
        // pour faire défiler le décor pendant la transition.
        if (this.nextLevel === undefined || this.nextLevel <= this.level) this.nextLevel = this.level + 1;
        this.nettoyerTirs();
        break;
      case ETAPE.BOSS:
        this.boss = new Boss(this, {});
        this.spriteList.push(this.boss);
        this.verifierHero();
        break;
      default:
        break;
    }
  }

  // Game.initLevel : place les escadres. Chaque ligne du niveau décrit un chemin ;
  // les vaisseaux entrent PAR L'EXTÉRIEUR de l'écran, en reculant le long de la
  // direction ligne[0]→ligne[1] jusqu'à sortir du cadre, puis rejoignent leur
  // point de passage. Les cases vides décalent l'arrivée des suivants.
  initLevel() {
    this.waveSens = 1;
    this.flChangeSens = false;
    this.shipBounds = { min: 0, max: LARGEUR };
    this.gridInfo = this.waveInfo[this.level];
    // Un niveau du parcours d'essai a un moveSpeed absent (NaN à l'origine, null
    // en JSON) : sans repli, toute la vague resterait figée.
    this.waveSpeed = Number.isFinite(this.gridInfo.moveSpeed) ? this.gridInfo.moveSpeed : 1;
    this.fallSpeed = Number.isFinite(this.gridInfo.fallSpeed) ? this.gridInfo.fallSpeed : 6;
    if (!Number.isFinite(this.gridInfo.sd)) this.gridInfo.sd = 6;
    if (!Number.isFinite(this.gridInfo.ss)) this.gridInfo.ss = 6;
    this.toKill = 0;
    this.badsList = [];
    this.waveIndex = 0;

    for (let n = 0; n < this.gridInfo.list.length; n++) {
      const ligne = this.gridInfo.list[n];
      if (!ligne || ligne.length <= 1) continue;
      if (!ligne[0] || !ligne[1]) continue;

      const a = Math.atan2(ligne[0].y - ligne[1].y, ligne[0].x - ligne[1].x);
      const dx = Math.cos(a) * 10, dy = Math.sin(a) * 10;
      const sp = { x: ligne[0].x, y: ligne[0].y };
      let garde = 0;
      do {
        sp.x += dx;
        sp.y += dy;
      } while (!this.horsCadre(sp.x, sp.y, 20) && garde++ < 100);

      let nbShip = 0;
      for (let i = 0; i < ligne.length; i++) if (ligne[i] && ligne[i].t !== undefined) nbShip++;
      let wp = 0;
      for (let i = 0; i < ligne.length; i++) {
        const data = ligne[i];
        if (data && data.t !== undefined) {
          const b = this.newBads(data.t, {
            x: sp.x, y: sp.y,
            wpTimer: (nbShip - ((i - wp) + 1)) * this.gridInfo.sd,
            waveId: i, lineId: n,
          });
          b.pointSuivant();
          this.toKill++;
        } else {
          wp++;
        }
      }
    }
  }

  verifierHero() {
    if (this.hero || this.heroList.length === 0) return;
    const type = this.heroList.shift();
    this.hero = new Hero(this, { x: LARGEUR / 2, y: HAUTEUR + 14, type });
    this.spriteList.push(this.hero);
    this.evenement('nouveauHero', { type, restant: this.heroList.length });
  }

  // ── Fabriques ──
  newBads(type, o) {
    const b = new Bads(this, Object.assign({ type }, o));
    this.spriteList.push(b);
    this.badsList.push(b);
    return b;
  }
  newHShot(o) {
    const t = new Shot(this, Object.assign({ listName: 'hShot' }, o));
    this.spriteList.push(t);
    this.hShotList.push(t);
    return t;
  }
  newBShot(o) {
    const t = new Shot(this, Object.assign({ listName: 'bShot' }, o));
    this.spriteList.push(t);
    this.bShotList.push(t);
    return t;
  }

  // ── Boucle ──
  update(tmod) {
    if (this.termine) return;
    if (tmod === undefined) tmod = 1;
    this.frict = Math.pow(FRICTION, tmod);

    switch (this.step) {
      case ETAPE.PANNEAU:
        this.attente -= tmod;
        if (this.attente <= 0) this.initStep(this.estBoss ? ETAPE.BOSS : ETAPE.ARRIVEE);
        break;
      case ETAPE.ARRIVEE:
        if (this.vagueEnPlace()) this.initStep(ETAPE.COMBAT);
        break;
      case ETAPE.COMBAT:
        this.updateWave(tmod);
        if (this.toKill <= 0) this.initStep(ETAPE.SUIVANT);
        break;
      case ETAPE.SUIVANT:
        this.timer -= tmod;
        if (this.timer <= 0) {
          this.level = this.nextLevel;
          this.nextLevel = undefined;
          this.initStep(ETAPE.PANNEAU);
        }
        break;
      case ETAPE.BOSS:
        // Le boss se conduit lui-même ; il faut juste ramasser ses escortes.
        this.updateWave(tmod);
        break;
      default:
        break;
    }

    this.bougerTout(tmod);
    this.rangerMorts();

    // Plus de vaisseau et plus de vie en réserve : la partie s'arrête.
    if (!this.hero && !this.flGameOver && this.step !== ETAPE.PANNEAU) {
      if (this.heroList.length === 0) this.finPartie('gameover');
      else this.verifierHero();
    }
  }

  // Game.updateWave : seuls `badsFlow` ennemis avancent par image, en tourniquet.
  // Quand le tour est bouclé, on applique le changement de sens demandé — c'est
  // ce décalage qui fait descendre l'escadre d'un cran en bout de course.
  updateWave(tmod) {
    for (let i = 0; i < FLUX_BADS; i++) {
      if (this.badsList.length === 0) break;
      const b = this.badsList[this.waveIndex];
      if (b) { b.waveUpdate(tmod); this.waveIndex++; }
      if (this.waveIndex >= this.badsList.length) {
        this.waveIndex = 0;
        this.verifierSens();
      }
    }
  }

  verifierSens() {
    if (!this.flChangeSens) return;
    this.flChangeSens = false;
    this.waveSens *= -1;
    for (let i = 0; i < this.badsList.length; i++) this.badsList[i].ty += this.fallSpeed;
  }

  bougerTout(tmod) {
    const l = this.spriteList.slice();
    for (let i = 0; i < l.length; i++) if (l[i].vivant) l[i].update(tmod);
  }

  rangerMorts() {
    this.spriteList = this.spriteList.filter((s) => s.vivant);
  }

  vagueEnPlace() {
    for (let i = 0; i < this.badsList.length; i++) if (!this.badsList[i].flReady) return false;
    return true;
  }

  nettoyerTirs() {
    while (this.bShotList.length > 0) this.bShotList[0].disparaitre();
    while (this.hShotList.length > 0) this.hShotList[0].disparaitre();
  }

  incScore(n) {
    this.score += n;
    this.evenement('score', { score: this.score, delta: n });
  }

  // Le vaisseau sorti par la droite saute `n` niveaux d'un coup. On passe par
  // `nextLevel` : le décor doit défiler d'autant, pas sauter d'un coup.
  setWarp(n) {
    this.nextLevel = Math.min(this.level + Math.max(1, Math.floor(n / 100)), this.waveInfo.length - 1);
    this.initStep(ETAPE.SUIVANT);
  }

  // Game.decorDecal : de combien le décor défile par niveau franchi. C'est ce
  // qui fait qu'on traverse les quatre sections de 1000 px au fil du parcours.
  defilementDecor() {
    if (this.step === ETAPE.SUIVANT && this.nextLevel !== undefined) {
      const c = Math.max(0, this.timer) / 40;
      const d = (this.nextLevel - this.level) * c;
      return (this.nextLevel - d) * DECOR_DECAL;
    }
    return this.level * DECOR_DECAL;
  }

  onHeroKill() {
    this.evenement('viePerdue', { restant: this.heroList.length });
    if (this.boss) this.boss.onHeroKill();
  }

  // Boss.kill : le parcours reprend au niveau suivant.
  bossVaincu() {
    this.evenement('bossVaincu', { level: this.level, score: this.score });
    this.initStep(ETAPE.SUIVANT);
  }

  finPartie(raison) {
    if (this.flGameOver) return;
    this.flGameOver = true;
    this.termine = true;
    this.evenement('finPartie', { raison, score: this.score, level: this.level });
  }

  // Game.isFree : y a-t-il de la place à cet endroit ? Sert à la Batmandarine
  // (qui se téléporte), au Scarabé (qui descend d'un cran) et à la Cosmo-Prune.
  placeLibre(x, y, ray) {
    if (ray === undefined) ray = 24;
    for (let i = 0; i < this.badsList.length; i++) {
      const b = this.badsList[i];
      if (Math.abs(b.x - x) < ray && Math.abs(b.ty - y) < ray) return false;
    }
    return true;
  }

  horsCadre(x, y, m) {
    if (m === undefined) m = 0;
    return x < -m || x > LARGEUR + m || y < -m || y > HAUTEUR + m;
  }

  // Game.getHeroTarget : quand le vaisseau est mort, les tirs à tête chercheuse
  // visent le bas du centre plutôt que de partir en NaN.
  cibleHero() {
    return this.hero || { x: LARGEUR / 2, y: HAUTEUR, speed: 0 };
  }

  // Rang du joueur au sens du jeu : la progression dans le parcours, en pour cent.
  getCons() {
    return Math.round((this.level / this.waveInfo.length) * 100);
  }
}

const API = { Game, Hero, Bads, Boss, Shot, Sprite, ENNEMIS, VAISSEAUX, TYPES, ETAPE, FORME, generateur,
  LARGEUR, HAUTEUR, TAILLE_BADS, FLUX_BADS, FRICTION, DECOR_DECAL };

if (typeof module !== 'undefined' && module.exports) module.exports = API;
else racine.MiniwaveEngine = API;

})(typeof globalThis !== 'undefined' ? globalThis : this);
