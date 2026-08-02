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

// heroName.as : les six vaisseaux, dans l'ordre où le jeu les indexe.
const VAISSEAUX = [
  { link: 'Tequila', name: 'aliquet' },
  { link: 'Porto', name: 'proto' },
  { link: 'Pastaga', name: 'gapatsa' },
  { link: 'Manzana', name: 'namazan' },
  { link: 'Curaso', name: 'sacuro' },
  { link: 'Cherry', name: 'rycher' },
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
    if (this.hp === undefined) this.hp = 1;
    if (this.speed === undefined) this.speed = 3;
    if (this.coolDownSpeed === undefined) this.coolDownSpeed = 4;
    if (this.ray === undefined) this.ray = 8;
    if (this.moveLine === undefined) this.moveLine = 11;
    if (this.type === undefined) this.type = 0;
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

  tirer() {
    this.coolDown = 100;
    const t = this.jeu.newHShot({ x: this.x, y: this.y - 6, vitx: 0, vity: -3, flStandardHeroShot: true });
    this.jeu.evenement('tirHero', { x: this.x, y: this.y - 6 });
    return t;
  }

  bombe() { this.flBomb = false; this.jeu.evenement('bombe', {}); }

  frapper(power) {
    if (power === undefined) power = 1;
    if (this.newShield !== undefined) return;   // encore invulnérable
    this.hp -= power;
    if (this.hp <= 0) this.exploser();
    else this.newShield = { t: 80, d: 0 };
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
    if (this.flWave === undefined) this.flWave = true;
    if (this.freq === undefined) this.freq = 200;
    if (this.coolDownSpeed === undefined) this.coolDownSpeed = 5;
    if (this.coolDown === undefined) this.coolDown = 0;
    if (this.ray === undefined) this.ray = 10;
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
    this.verifierTirsHero();
    if (jeu.hero && this.y + this.ray > jeu.hero.y - jeu.hero.ray) this.verifierChocHero();
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
    if (this.jeu.hasard(Math.max(1, Math.round(this.freq / tmod))) === 0) {
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
        this.verifierTir(tmod);
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

  auBord() { this.jeu.flChangeSens = true; }

  exploser() {
    this.jeu.evenement('badsExplose', { x: this.x, y: this.y, type: this.type });
    this.jeu.incScore(ENNEMIS[this.type].value);
    this.jeu.badsKill[this.type] = (this.jeu.badsKill[this.type] || 0) + 1;
    this.tuer();
  }

  frapper() { this.exploser(); }

  tirer() {
    const t = this.jeu.newBShot({ x: this.x, y: this.y, vitx: 0, vity: 2 });
    this.jeu.evenement('tirBads', { x: this.x, y: this.y, type: this.type });
    return t;
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
        this.evenement('panneau', { level: this.level, name: info.name });
        this.attente = 80;                  // le panneau « level N » reste affiché
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
        this.nettoyerTirs();
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
        if (this.attente <= 0) this.initStep(ETAPE.ARRIVEE);
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
        if (this.timer <= 0) { this.level++; this.initStep(ETAPE.PANNEAU); }
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

  // Le vaisseau sorti par la droite saute `n` niveaux d'un coup.
  setWarp(n) {
    this.level = Math.min(this.level + Math.max(1, Math.floor(n / 100)), this.waveInfo.length - 1);
  }

  onHeroKill() {
    this.evenement('viePerdue', { restant: this.heroList.length });
  }

  finPartie(raison) {
    if (this.flGameOver) return;
    this.flGameOver = true;
    this.termine = true;
    this.evenement('finPartie', { raison, score: this.score, level: this.level });
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

const API = { Game, Hero, Bads, Shot, Sprite, ENNEMIS, VAISSEAUX, ETAPE, generateur,
  LARGEUR, HAUTEUR, TAILLE_BADS, FLUX_BADS, FRICTION };

if (typeof module !== 'undefined' && module.exports) module.exports = API;
else racine.MiniwaveEngine = API;

})(typeof globalThis !== 'undefined' ? globalThis : this);
