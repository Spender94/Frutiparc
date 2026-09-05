/*
 * Kaluga — les SPRITES du jeu : la tzongre, les pommes, le panier, les
 * papillons, et les nuisibles (fourmi, ver, corbeau, grenouille, écureuil).
 * Portés ligne à ligne de Games/kaluga/class/kaluga/sp/ — c'est là qu'est
 * toute la physique : gravité, frottements, fil de la tzongre (updateLink),
 * rebonds, points de combo. Les nombres sont ceux de 2005.
 *
 * Deux conventions de l'AS2 à garder en tête en lisant :
 *   · `x`, `y`, `vitx`, `vity` sont la position MONDE du sprite ; `_x`/`_y`
 *     (la position à l'écran) n'en dérivent qu'à endUpdate(), décalées par
 *     la caméra (game.mapDecal) ;
 *   · Cs.tmod est le multiplicateur de temps : tout ce qui bouge le porte.
 */
'use strict';

(function (racine) {

const K = racine.KalugaMoteur;
const J = racine.KalugaJeu;
const Cs = J.Cs;
const random = J.random;
const Key = K.Key;
const RAD = Math.PI / 180;
// Un clip disparu (retiré de la scène) : ses propriétés valent « undefined » en Flash.
const vif = (mc) => !!(mc && mc._parent);

// ── Sprite ────────────────────────────────────────────────────────────────
class Sprite extends K.Clip {
  constructeur() {}
  init() {
    this.map = this.game.map;
    this.initDefault();
  }
  initDefault() {
    if (this.x == null) this.x = 0;
    if (this.y == null) this.y = 0;
    if (this.vitx == null) this.vitx = 0;
    if (this.vity == null) this.vity = 0;
    if (this.flFreeze == null) this.flFreeze = false;
  }
  update() {}
  endUpdate() {
    if (!this.flFreeze) {
      this._x = this.x + this.game.mapDecal.x;
      this._y = this.y + this.game.mapDecal.y;
    }
  }
  kill() {
    if (this.flGround) this.game.removeFromGround(this.gList, this);
    if (this.depth != null) this.game.depthList.push(this.depth);
    this.game.removeFromList(this, 'spriteList');
    this.removeMovieClip();
  }
  initGroundMode() { this.flGround = true; }
  exitGroundMode() {
    this.flGround = false;
    this.game.removeFromGround(this.gList, this);
    this.groundId = undefined;
  }
  updateGroundId() {
    const id = Math.floor(this.x / this.game.groundCaseSize);
    if (id !== this.groundId) {
      this.game.removeFromGround(this.gList, this);
      this.gList = this.game.groundList[id];
      if (this.gList) this.gList.push(this);
      this.groundId = id;
    }
  }
  getDist(mc) {
    const difx = this.x - mc.x, dify = this.y - mc.y;
    return Math.sqrt(difx * difx + dify * dify);
  }
}
J.Sprite = Sprite;

// ── Phys ──────────────────────────────────────────────────────────────────
class Phys extends Sprite {
  init() {
    super.init();
    this.linkList = [];
    this.initDefault();
    this.power = 0;
    this.searchTimer = 0;
    this.tension = { x: 0, y: 0 };
  }
  initDefault() {
    super.initDefault();
    if (this.weight == null) this.weight = 1;
    if (this.nbTake == null) this.nbTake = 80;
    if (this.flPhys == null) this.flPhys = true;
    if (this.flLinkable == null) this.flLinkable = true;
    if (this.adr == null) this.adr = 0;
    if (this.nbResist == null) this.nbResist = 1;
    if (this.range == null) this.range = 1;
    if (this.volume == null) this.volume = 1;
  }
  update() {
    super.update();
    if (this.flPhys) {
      if (!this.flGround) this.vity += this.game.grav * this.weight * Cs.tmod;
      const frict = Math.pow(this.game.frict, this.volume);
      this.vitx *= frict;
      this.vity *= frict;
      this.x += this.vitx * Cs.tmod;
      this.y += this.vity * Cs.tmod;
    }
    if (this.flGround) {
      const pow = Math.abs(this.tension.x) + Math.abs(this.tension.y);
      if (pow > this.adr) this.exitGroundMode(true);
      this.tension = { x: 0, y: 0 };
    }
  }
  unLink() {
    while (this.linkList.length > 0) {
      const mc = this.linkList.pop();
      mc.unLink();
      mc.parentLink = undefined;
    }
  }
  updateLink(tensionMax, collideList) {
    if (this.flPhys) {
      for (const mc of collideList) {
        if (mc.flPhys && !mc.flGround) {
          const distMax = this.ray + mc.ray;
          const difx = this.x - mc.x, dify = this.y - mc.y;
          const dist = Math.sqrt(difx * difx + dify * dify);
          if (dist < distMax) {
            const power = dist - distMax;
            const a = Math.atan2(dify, difx);
            const cos = Math.cos(a), sin = Math.sin(a);
            const p = 20;
            this.vitx -= cos * power / p;
            if (!this.flGround) this.vity -= sin * power / p;
            mc.vitx += cos * power / p;
            if (!mc.flGround) mc.vity += sin * power / p;
          }
        }
      }
    }
    collideList.push(this);
    for (const mc of this.linkList) {
      const ca = this, cb = mc;
      const difx = ca.x - cb.x, dify = ca.y - cb.y;
      const dist = Math.sqrt(difx * difx + dify * dify);
      const a = Math.atan2(dify, difx);
      if (dist > tensionMax) {
        const dif = (dist - tensionMax) / 30;
        const cos = Math.cos(a), sin = Math.sin(a);
        const wa = ca.weight + ca.power, wb = cb.weight + cb.power;
        const ratio = wb / (wa + wb);
        let px = cos * dif * ratio, py = sin * dif * ratio;
        if (ca.flGround) { ca.tension.x += px; ca.tension.y += py; }
        else { ca.vitx -= px * ca.nbResist * Cs.tmod; ca.vity -= py * ca.nbResist * Cs.tmod; }
        px = cos * dif * (1 - ratio); py = sin * dif * (1 - ratio);
        if (cb.flGround) { cb.tension.x += px; cb.tension.y += py; }
        else { cb.vitx += px * cb.nbResist * Cs.tmod; cb.vity += py * cb.nbResist * Cs.tmod; }
        mc.filFall = 0;
      } else {
        mc.filFall = (tensionMax - dist) / 2;
      }
      mc.updateLink(tensionMax / 2, collideList);
    }
  }
  drawLink() {
    for (const mc of this.linkList) {
      const x1 = this.x + this.game.mapDecal.x, y1 = this.y + this.game.mapDecal.y;
      const x2 = mc.x + this.game.mapDecal.x, y2 = mc.y + this.game.mapDecal.y;
      this.game.fil.moveTo(x1, y1);
      if (mc.filFall > 0) {
        const x = (x1 + x2) / 2;
        const y = Math.min((y1 + y2) / 2 + mc.filFall * 3, (this.map.height + 4) - this.map.groundLevel);
        this.game.fil.curveTo(x, y, x2, y2);
      }
      this.game.fil.lineTo(x2, y2);
      mc.drawLink();
    }
  }
  onLink(parent) { this.parentLink = parent; }
  removeLink(mc) {
    const i = this.linkList.indexOf(mc);
    if (i >= 0) {
      mc.unLink();
      this.linkList.splice(i, 1);
      mc.parentLink = undefined;
    }
  }
  search(combo) {
    if (this.searchTimer <= 0) {
      let link;
      let max = this.nbTake;
      if (this.linkList.length < this.range) {
        for (const mc of this.game.physList) {
          if (mc.parentLink == null && mc !== this && !mc.flPanier && !mc.flTree && mc.linkList.length === 0 && mc.flLinkable) {
            const difx = mc.x - this.x, dify = mc.y - this.y;
            const dist = Math.abs(difx) + Math.abs(dify);
            if (dist < max) { link = mc; max = dist; }
          }
        }
        if (link != null) {
          this.linkTo(link);
          this.searchTimer = 12;
          link.searchTimer = 12;
          link.onLink(this);
        }
      }
    } else {
      this.searchTimer -= Cs.tmod;
    }
    for (const link of this.linkList) if (combo > 0) link.search(combo - 1);
  }
  initPhysMode() { this.flPhys = true; }
  exitPhysMode() { this.flPhys = false; }
  getPower() { return this.weight * 2 + Math.abs(this.vitx) + Math.abs(this.vity); }
  kill() {
    if (this.parentLink) this.parentLink.removeLink(this);
    if (this.linkList.length > 0) this.unLink();
    this.game.removePhys(this);
    super.kill();
  }
  linkTo(link) {
    this.game.mng.sfx.play('sLink');
    this.linkList.push(link);
    link.fillFall = 0;
  }
}
J.Phys = Phys;

// ── Tzongre ───────────────────────────────────────────────────────────────
class Tzongre extends Phys {
  constructeur() {
    this.dp_line = 10; this.cBoundSide = 0.8; this.margin = 10; this.pitchAccel = 1; this.eyeRay = 3.4; this.groundResist = 8;
    this.init();
  }
  init() {
    this.type = 'Tzongre';
    this.dashUpCount = 0;
    this.flSky = false; this.flScotched = false; this.flReleaseShoot = false; this.flLift = false; this.flSuper = false;
    this.coolDownShoot = 0;
    this.bonusMulti = 0; this.bonusCombo = 0; this.bonusPower = 0; this.bonusDodge = 0; this.bonusFilMax = 0;
    this.bzzz = 0; this.lNum = 0; this.pitch = 0; this.cBoost = 1; this.searchTimer = 0;
    this.thrustCoef = 1 / Math.pow(this.nbFrict, 8);
    super.init();
    this.setSkin();
    this.updateRange();
    this.updateTake();
    if (this.box == null) this.setBox();
    this.game.mng.sfx.stop(10);
    this.game.mng.sfx.loop('sFly', 10);
    this.game.mng.sfx.setVolume(10, 0);
    this.freeze();
  }
  initDefault() {
    if (this.weight == null) this.weight = 0.3;
    if (this.nbTake == null) this.nbTake = 120;
    super.initDefault();
    if (this.nbThrust == null) this.nbThrust = 0.9;
    if (this.nbTurn == null) this.nbTurn = 2.4;
    if (this.nbFall == null) this.nbFall = 0.8;
    if (this.flLauncher == null) this.flLauncher = false;
    if (this.nbTurnMalus == null) this.nbTurnMalus = 0.8;
    if (this.nbDashUp == null) this.nbDashUp = 20;
    if (this.nbDashBottom == null) this.nbDashBottom = 24;
    if (this.nbMulti == null) this.nbMulti = 0;
    if (this.nbCombo == null) this.nbCombo = 0;
    if (this.nbDodge == null) this.nbDodge = 1;
    if (this.nbFilMax == null) this.nbFilMax = 200;
    if (this.key == null) {
      const k = this.game.mng.pref.$key;
      this.key = { left: k[1], right: k[2], up: k[0], down: k[3], shoot: k[4] };
    }
    if (this.fil == null) this.fil = { tensionMax: 60 };
  }
  control() {
    const sensible = 3;
    if (this.flDashUp) this.dashUpCount -= Cs.tmod;
    if (Key.isDown(this.key.left)) {
      this._rotation -= this.nbTurn * Cs.tmod;
      this.power = Math.max(0, this.power - (this.nbTurnMalus * Cs.tmod));
    }
    if (Key.isDown(this.key.right)) {
      this._rotation += this.nbTurn * Cs.tmod;
      this.power = Math.max(0, this.power - (this.nbTurnMalus * Cs.tmod));
    }
    if (Key.isDown(this.key.up)) {
      const bonus = 0;
      this.dashUpCount = sensible;
      this.flDashUp = false;
      this.thrust(bonus);
      this.pitch += this.pitchAccel;
      this.cBoost *= this.nbBoostFrict;
      this.updatePower();
      this.bzzz = Math.min(this.bzzz + 0.1 * Cs.tmod, 1);
    } else {
      if (!this.flDashUp) {
        this.flDashUp = true;
        this.cBoost = 1;
        this.updatePower();
        this.a1.gotoAndStop(1);
        this.a2.gotoAndStop(1);
      }
      this.bzzz = Math.max(this.bzzz - 0.1 * Cs.tmod, 0);
    }
    this.game.mng.sfx.setVolume(10, 2 + this.bzzz * 8);
    if (Key.isDown(this.key.down)) {
      this.vity += this.nbFall * Cs.tmod * (0.5 + this.thrustCoef * 0.5);
    }
    this.coolDownShoot -= Cs.tmod;
    if (Key.isDown(this.key.shoot)) {
      if (this.coolDownShoot <= 0 && this.game.flLinkActive) this.search(this.nbCombo + this.bonusCombo);
      if (this.flLift) { this.coolDownShoot = 6; this.release(); }
      this.flReleaseShoot = false;
    } else {
      if (!this.flReleaseShoot) this.activeLink();
      this.flReleaseShoot = true;
      this.searchTimer = 0;
    }
  }
  update() {
    if (this.flScotched) { this.endUpdate(); return; }
    this.control();
    super.update();
    if (this.y < this.box.top) {
      if (!this.flSky && this.game.flFeuillage) this.game.shootFeuillage(this.x, this.getPower());
      this.flSky = true;
      if (this.vity < 0) this.vity *= 0.5;
      if (this.y < this.box.top - 20) { this.vity = 0; this.y = this.box.top - 20; }
    } else {
      if (this.flSky && this.game.flFeuillage) this.game.shootFeuillage(this.x, this.getPower());
      this.flSky = false;
    }
    if (this.x > this.box.right) { this.x = this.box.right; this.vitx *= -this.cBoundSide; }
    if (this.x < this.box.left) { this.x = this.box.left; this.vitx *= -this.cBoundSide; }
    if (this.y > this.box.bottom) {
      this.y = this.box.bottom;
      if (this.vity + Math.abs(this.vitx) / 2 < this.groundResist * (this.nbDodge + this.bonusDodge)) {
        this.vity *= -0.6;
      } else {
        this.y += this.margin;
        this.groundCrash();
      }
    }
    if (this.flLift) this.updateLink(this.fil.tensionMax, []);
    if (!this.flReleaseShoot) {
      for (let i = 0; i < this.linkList.length; i++) {
        const link = this.linkList[i];
        const difx = this.x - link.x, dify = this.y - link.y;
        const dist = Math.sqrt(difx * difx + dify * dify);
        if (dist > (this.nbFilMax + this.bonusFilMax)) { this.removeLink(link); i--; }
      }
    }
    this.pitch *= this.game.groundFrict;
    // Après un scotch() dans ce même tick, l'image « scotched » n'a plus ces enfants :
    // en AS2 les affectations tombent dans le vide, on les saute donc.
    if (this.yeux) {
      this.yeux._y = -this.pitch / 2;
      this.corps._y = this.pitch / 2;
      this.corps._yscale = 100 + this.pitch * 2;
      this.pattes._y = this.pitch / 2;
      this.pattes._yscale = this.pitch * 20;
    }
    this.updateLook();
    for (let i = 0; i < this.game.butterflyList.length; i++) {
      const mc = this.game.butterflyList[i];
      const difx = mc.x - this.x, dify = mc.y - this.y;
      if (Math.abs(difx) + Math.abs(dify) < 32) { this.catchButterFly(mc); i--; }
    }
    if (this.flSuper) {
      this.superTimer -= Cs.tmod;
      if (this.superTimer > 0) {
        if (random(Cs.tmod * this.superTimer) > 20) {
          const d = (this.lNum++) % 100;
          this.fx.attachMovie('superLine', 'line' + d, this.dp_line + d);
          const mc = this.fx['line' + d];
          mc._alpha = 50;
          mc._rotation = random(360);
        }
      } else {
        this.bonusMulti = this.bonusMemory.multi;
        this.bonusCombo = this.bonusMemory.combo;
        this.bonusPower = this.bonusMemory.power;
        this.bonusDodge = this.bonusMemory.dodge;
        this.updateRange();
        this.flSuper = false;
      }
    }
    const frict = Math.pow(this.nbFrict, Cs.tmod);
    this.vitx *= frict;
    this.vity *= frict;
    this.endUpdate();
  }
  updateLook() {
    const p1 = this.yeux && this.yeux.p1, p2 = this.yeux && this.yeux.p2;
    if (!vif(this.target) || this.target._visible !== true) {
      if (this.linkList.length > 0) { this.target = this.linkList[0]; return; }
      if (!p1) return; // sans yeux (image « scotched »), le reste est un no-op en AS2
      p1.x = -2.5; p1.y = 1; p2.x = 2.5; p2.y = 1;
    } else {
      if (!p1) return;
      const difx = this.target.x - this.x, dify = this.target.y - this.y;
      const a = Math.atan2(dify, difx) - this._rotation * RAD;
      const cos = Math.cos(a), sin = Math.sin(a);
      const r = this.eyeRay - 1;
      p1.x = cos * r - this.eyeRay; p1.y = sin * r;
      p2.x = cos * r + this.eyeRay; p2.y = sin * r;
    }
    const c = Math.pow(0.8, Cs.tmod);
    p1._x = p1._x * c + p1.x * (1 - c);
    p1._y = p1._y * c + p1.y * (1 - c);
    p2._x = p2._x * c + p2.x * (1 - c);
    p2._y = p2._y * c + p2.y * (1 - c);
    if (!random(this.cligneRand / Cs.tmod)) this.yeux.play();
  }
  thrust(bonus) {
    const a = (this._rotation - 90) * RAD;
    const vit = (this.nbThrust + bonus) * Cs.tmod * this.thrustCoef;
    this.vitx += Math.cos(a) * vit;
    this.vity += Math.sin(a) * vit;
    this.a1.nextFrame();
    this.a2.nextFrame();
  }
  release() {
    this.game.onTzRelease(this);
    if (this.linkList[0] === this.target) this.target = undefined;
    this.flLift = false;
    this.unLink();
  }
  activeLink() { if (this.linkList.length > 0) this.flLift = true; }
  scotch(mc) {
    this.game.mng.sfx.stopSound('sFly', 10);
    this.game.onTzDeath();
    this.flScotched = true;
    this.vitx = 0; this.vity = 0;
    if (this.linkList.length > 0) this.release();
    if (mc != null) {
      const point = { x: this.x - mc.x, y: this.y - mc.y };
      mc.localToGlobal(point);
      mc.pomme.globalToLocal(point);
      mc.pomme.attachMovie('spPhysTzongre', 'tzongre', 120, this);
      mc.pomme.tzongre._xscale = 100 / (mc.pomme._xscale / 100);
      mc.pomme.tzongre._yscale = mc.pomme.tzongre._xscale;
      mc.pomme.tzongre.scotch();
      mc.pomme.tzongre._x = point.x;
      mc.pomme.tzongre._y = point.y;
      mc.pomme.tzongre._rotation = this._rotation;
      this._visible = false;
    } else {
      this.gotoAndStop('scotched');
    }
  }
  kill() {
    this.game.mng.sfx.stopSound('sFly', 10);
    this.release();
    super.kill();
  }
  hit() { if (this.yeux) this.yeux.play(); }
  setSkin() {
    this.corps.gotoAndStop(this.id + 1);
    this.yeux.gotoAndStop((this.id + 1) * 10);
    this.yeux.p1.gotoAndStop(this.id + 1);
    this.yeux.p2.gotoAndStop(this.id + 1);
    this.pattes.gotoAndStop(this.id + 1);
    if (this.id === 2) { this.a1._xscale = 180; this.a2._xscale = 180; }
    else if (this.id !== 3) { this.a1._xscale = 120; this.a2._xscale = 120; }
  }
  catchButterFly(mc) {
    switch (mc.id) {
      case 0: this.nbMulti++; this.game.scroller.put('Multi up!', '(' + this.nbMulti + ')'); this.updateRange(); break;
      case 1: this.nbCombo++; this.game.scroller.put('Chain up!', '(' + this.nbCombo + ')'); break;
      case 2: this.bonusPower += 2; this.game.scroller.put('Power up!', '(' + (this.bonusPower / 2) + ')'); break;
      case 3: this.bonusDodge += 1; this.game.scroller.put('Armor up!', '(' + this.bonusDodge + ')'); break;
      case 4:
        this.flSuper = true;
        this.bonusMemory = { multi: this.bonusMulti, combo: this.bonusCombo, power: this.bonusPower, dodge: this.bonusDodge };
        this.bonusMulti = 5; this.bonusCombo = 5; this.bonusPower = 10; this.bonusDodge = 10;
        this.superTimer = 500;
        this.updateRange();
        break;
      case 5: this.game.fruitJumpIn(); break;
      case 6: this.game.fruitJumpOut(); break;
      case 7:
        for (let i = 0; i < 10; i++) { const fruit = this.game.genTreeFruit(); if (fruit) fruit.growCoefBonus = 6; }
        break;
      default: break;
    }
    if (this.game.mng.pref.$param[2]) {
      for (let i = 0; i < 10 / Cs.tmod; i++) {
        const p = mc.dropPaillette();
        p.vitx = 2 * (random(200) - 100) / 100;
        p.vity = 2 * (random(200) - 100) / 100;
      }
    }
    this.game.mng.sfx.play('sRadian');
    mc.kill();
  }
  updatePower() { this.power = this.nbPower + this.nbBoost * (1 - this.cBoost) + this.bonusPower; }
  updateRange() { this.range = this.nbMulti + this.bonusMulti + 1; }
  updateTake() { this.nbTake = (this.nbFilMax + this.bonusFilMax) * 0.7; }
  groundCrash() {
    const titleList = ['Splorch!', 'Sbleurch!', 'Ploush!', 'Skonk!'];
    const msgList = [
      this.name + " s'est ecrasé(e) sur le sol...",
      'La gravité a rattrapé ' + this.name,
      this.name + ' a joué trop près du sol...',
    ];
    this.game.endPanelStart.push({ label: 'basic', list: [{ type: 'msg', title: titleList[random(titleList.length)], msg: msgList[random(msgList.length)] }] });
    this.flGround = true;
    this.scotch();
  }
  fruitCrash(fruit) {
    const titleList = ['Plourch!', 'Blaarch!', 'Sponk!', 'Paf!'];
    const msgList = [
      this.name + ' a percuté la pomme un peu trop fort.',
      this.name + " n'a pas réussi à éviter la pomme.",
      'La pomme a percuté de plein fouet notre pauvre ' + this.name + ', paix a son  âme...',
      'Malgré de bons reflexes, ' + this.name + " n'a pas pu esquiver la pomme à temps.",
      'La pomme dans un élan meurtrier a emporté ' + this.name + ' dans sa chute.',
      'La pomme lancée a grande vitesse, a ecrasé ' + this.name + ' qui passait par là.',
    ];
    this.game.endPanelStart.push({ label: 'basic', list: [{ type: 'msg', title: titleList[random(titleList.length)], msg: msgList[random(msgList.length)] }] });
    this.scotch(fruit);
  }
  setBox(box) {
    if (box == null) box = { left: 0, right: this.map.width, top: 0, bottom: this.map.height - this.map.groundLevel };
    box.left += this.margin; box.right -= this.margin; box.top += this.margin; box.bottom -= this.margin;
    this.box = box;
  }
  linkTo(link) { super.linkTo(link); this.game.onTzLink(this); }
  // Sur l'image « scotched » les ailes n'existent plus : no-op silencieux en AS2.
  unFreeze() { if (this.a1 && this.a1.a) { this.a1.a.play(); this.a2.a.play(); } }
  freeze() { if (this.a1 && this.a1.a) { this.a1.a.stop(); this.a2.a.stop(); } }
}
J.Tzongre = Tzongre;
K.registerClass('spPhysTzongre', Tzongre);

// ── Fruit ─────────────────────────────────────────────────────────────────
class Fruit extends Phys {
  constructeur() {
    this.antResist = 400; this.cBoundGround = 0.7; this.cBoundSide = 0.9; this.maxCrunchFrame = 6; this.dunkPowerLimit = 18; this.treeFallSpeed = 0.04;
    this.init();
  }
  init() {
    this.type = 'Fruit';
    super.init();
    this.holeNum = 0; this.caterNum = 0; this.depthNum = 0; this.vitRoll = 0;
    this.antList = [];
    this.flPanier = false; this.flSky = false; this.flScoreAble = true;
    if (this.flGold) this.gotoAndStop(2); else this.gotoAndStop(1);
    this.pomme.stop();
    this.setRay(this.weight * 12);
    this.pomme._xscale = this.ray * 2; this.pomme._yscale = this.ray * 2;
    this.light._xscale = this.ray * 2; this.light._yscale = this.ray * 2;
    this.queue._xscale = this.ray * 2; this.queue._yscale = this.ray * 2;
    this.flScDirect = !!this.flTree;
    this.flScBound = false; this.flScSide = false; this.flScDunk = false; this.flScNoLink = true;
    this.flScHead = false; this.flScSquirrel = false; this.flScBird = false; this.flScLateral = false;
  }
  initDefault() {
    if (this.weight == null) this.weight = 1;
    super.initDefault();
    if (this.treeTimer == null) this.treeTimer = 0;
    if (this.crunch == null) this.crunch = 0;
    if (this.flGold == null) this.flGold = false;
    if (this.growCoefBonus == null) this.growCoefBonus = 1;
  }
  update() {
    super.update();
    if (this.headCoolDown > 0) this.headCoolDown -= Cs.tmod;
    if (this.flTree) {
      this.treeTimer += this.treeFallSpeed * this.growCoefBonus * Cs.tmod;
      const r = this.ray;
      this.y = this.treeTimer - r;
      if (this.treeTimer > 2 * r) { this.flTree = false; this.exitGroundMode(); }
    } else {
      if (this.flGround) {
        if (!this.flPanier) {
          const vx = Math.abs(this.vitx);
          if (vx > 0 || this.groundId == null) {
            this.vitRoll = (this.vitx / this.circ) * 360;
            this.vitx *= this.game.groundFrict;
            this.updateGroundId();
            if (vx < 0.01) this.vitx = 0;
          }
        }
        if (this.caterNum === 2 && this.game.caterpillarList.length < this.game.caterLimit && random(4000 / Cs.tmod) < this.weight * 6) {
          const mc = this.dropCaterpillar();
          mc.setScale(40);
          mc.flGrowing = true;
          this.caterNum++;
          this.game.stat.incVal('bébé vers', 1);
        }
        const m = 2;
        if (this.x + this.ray < m || this.x - this.ray > this.map.width - m) {
          while (this.caterNum > 0) this.dropCaterpillar();
          while (this.antList.length > 0) this.dropLastAnt();
          this.kill();
          return;
        }
      } else {
        if (!this.game.flEndGame && this.game.tzongre && !this.game.tzongre.flScotched) {
          const dist = this.getDist(this.game.tzongre);
          if (dist < this.ray) this.hitTzongre(this.game.tzongre);
        }
        if (!this.flPanier) {
          if (this.vity > 0 && this.parentLink == null && this.game.panier) {
            const x = this.x - this.game.panier.x;
            const r = this.ray;
            const pr = this.game.panier.openRay;
            const niv = this.game.panier.y + this.game.panier.openLevel;
            if (x - r >= -pr && x + r <= pr && this.y + r > niv && !this.game.flEndGame) {
              if ((this.y + r) - (this.vity * Cs.tmod) < niv) {
                this.flScDunk = this.vity > this.dunkPowerLimit;
                this.flScLateral = Math.abs(this.vitx) > Math.abs(this.vity);
                this.game.panier.addFruit(this);
                return;
              }
            }
          }
        }
        if (this.y < 0) {
          if (!this.flSky && this.game.flFeuillage) this.game.shootFeuillage(this.x, this.getPower());
          this.flSky = true;
        } else {
          if (this.flSky && this.game.flFeuillage) this.game.shootFeuillage(this.x, this.getPower());
          this.flSky = false;
        }
        let gy;
        if (this.flPanier) gy = this.panier.ray; else gy = this.map.height - this.map.groundLevel;
        if (this.vity > 0 && this.y + this.ray > gy) {
          this.y = gy - this.ray;
          this.flScDirect = false;
          if (this.vity > 4) {
            this.playHitSound();
            if (!this.flPanier) this.hitGround();
            this.vity *= -this.cBoundGround;
            this.vitRoll += (this.vitx / this.circ) * 100;
          } else if (this.parentLink == null) {
            this.vity = 0;
            this.initGroundMode();
          }
        }
        this.checkFlyCollision();
        this.vitRoll *= this.game.frict;
        if (this.antList.length > 0) {
          this.antMove += random((Math.abs(this.vitx) + Math.abs(this.vity)) * Cs.tmod);
          if (this.antMove > this.antResist) { this.antMove = random(this.antResist); this.dropLastAnt(); }
        }
      }
      let limitLeft, limitRight;
      if (this.flPanier) { limitLeft = -this.panier.openRay; limitRight = this.panier.openRay; }
      else { limitLeft = 0; limitRight = this.map.width; }
      if (this.x + this.ray > limitRight && this.flScoreAble) {
        this.x = limitRight - this.ray;
        if (this.flPanier && this.y + this.ray > this.panier.openLevel) this.panier.vitx += this.vitx * this.weight;
        this.vitx *= -this.cBoundSide;
        this.flScSide = true;
      }
      if (this.x - this.ray < limitLeft && this.flScoreAble) {
        this.x = limitLeft + this.ray;
        if (this.flPanier && this.y + this.ray > this.panier.openLevel) this.panier.vitx += this.vitx * this.weight;
        this.vitx *= -this.cBoundSide;
        this.flScSide = true;
      }
      if (this.flPanier && this.flGround) {
        this.y += this.panier.glurpSpeed * Cs.tmod;
        if ((this.y - this.ray) * 0.9 > this.game.panier.openLevel) { this.kill(); return; }
      }
    }
    if (this.antList.length > 0) {
      this.updateAspect();
      if (this.crunch / this.weight > 1) {
        while (this.antList.length > 0) this.dropLastAnt();
        this.flScoreAble = false;
        this.game.onFruitEatFinish(this);
      }
    }
    for (let i = 0; i < this.antList.length; i++) this.antList[i].update();
    this.pomme._rotation += this.vitRoll;
    this.queue._rotation += this.vitRoll;
    this.endUpdate();
  }
  exitGroundMode() { super.exitGroundMode(); this.antMove = 0; }
  checkFlyCollision() {
    const power = this.vity * this.weight;
    if (this.vity > 0 && power > 10 && this.parentLink == null) {
      for (const mc of this.game.birdList) {
        if (mc.mode === 0 && this.hitTest(mc.sub.h)) {
          this.playHitSound();
          mc.fruitHit(power);
          this.vity *= -0.6;
          this.flScBird = true;
        }
      }
    }
  }
  hitTzongre(tzongre) {
    this.flScHead = true;
    const power = this.getPower();
    if (this.weight > 1 && power / (tzongre.nbDodge + tzongre.bonusDodge) > 12) {
      this.game.tzongre.fruitCrash(this);
    } else {
      const difx = this.x - tzongre.x, dify = this.y - tzongre.y;
      const a = Math.atan2(dify, difx);
      const cos = Math.cos(a), sin = Math.sin(a);
      const p = 2;
      tzongre.vitx -= cos * power / p;
      tzongre.vity -= sin * power / p;
      this.vitx += cos * power / p;
      this.vity += sin * power / p;
      tzongre.hit(power);
      if (this.headCoolDown < 0 || this.headCoolDown == null) {
        this.game.stat.incVal('Coups-de-tête', 1);
        this.headCoolDown = 8;
      }
    }
    this.vitRoll = (random(2) * 2 - 1) * power / (this.weight * 2);
  }
  addCaterpillar() {
    if (this.caterNum === 0) this.game.stat.incVal('Quantité mangée par des vers', this.weight * 10);
    this.holeNum++;
    this.caterNum++;
    let flTryAgain;
    let t = 0;
    do {
      this.attachMovie('trou', 'trou' + this.holeNum, this.holeNum);
      const mc = this['trou' + this.holeNum];
      const dMax = Math.round(this.ray);
      const d = random(dMax - 2);
      mc.t._y = d;
      mc.t._yscale = 100 * Math.cos((d / dMax) * 1.57);
      mc.t._xscale = 100;
      mc._rotation = random(360);
      t++;
      flTryAgain = this.holeNum === 2 && mc.hitTest(this.trou1) && t < 10;
    } while (flTryAgain);
    this.flScoreAble = false;
    while (this.antList.length > 0) this.dropLastAnt();
  }
  kill() {
    if (this.flPanier) {
      if (this.mask) this.mask.removeMovieClip();
      this.panier.removeFruit(this);
    } else {
      this.game.removeFruit(this);
    }
    super.kill();
  }
  hitGround() {
    this.flScBound = true;
    const id = Math.floor(this.x / this.game.groundCaseSize);
    const list0 = this.game.groundList[id] || [];
    for (const mc of list0.slice()) if (mc.type === 'Caterpillar') mc.splash();
    let list = [];
    for (let i = -1; i <= 1; i++) list = list.concat(this.game.groundList[id + i] || []);
    for (const mc of list) {
      const power = this.getPower();
      if (mc.type === 'Squirrel' && power > 20) { mc.stunCounter = power * 20; mc.initMode(3); }
    }
  }
  addAnt(mc) {
    mc.fruit = this;
    mc.mode = 1;
    mc.x = 0; mc.y = 0;
    this.game.removeFromGround(mc.gList, mc);
    const d = this.game.depthList.pop();
    this.attachMovie('spBadsAnt', 'ant_' + d, 10 + d, mc);
    this.antList.push(this['ant_' + d]);
    mc.kill();
  }
  dropLastAnt() {
    const mcf = this.antList.pop();
    const mc = this.game.newAnt(mcf);
    mc.exitGroundMode();
    mc.mode = 0;
    mc.flFreeze = false;
    mc.x = this.x; mc.y = this.y;
    mc.vitx = this.vitx + (random(200) - 100) / 100;
    mc.vity = this.vity + -random(200) / 100;
    mc.vitr = random((Math.abs(mc.vitx) + Math.abs(mc.vity)) * 2);
    mcf.removeMovieClip();
  }
  dropCaterpillar() {
    if (this.caterNum > 0) {
      this.caterNum--;
      const mc = this.game.newCaterpillar();
      mc.x = this.x + random(20) - 10;
      mc.y = this.map.height - this.map.groundLevel;
      mc.setSens((random(2) * 2) - 1);
      return mc;
    }
    return undefined;
  }
  setRay(ray) { this.ray = ray; this.circ = Math.PI * 2 * this.ray; }
  onLink(parent) { super.onLink(parent); this.flScSquirrel = false; this.flScBird = false; this.flScNoLink = false; }
  unLink() { super.unLink(); this.flScBound = false; this.flScSide = false; this.flScHead = false; }
  recal() {
    if (this.x + this.ray > this.map.width) this.x = this.map.width - this.ray;
    if (this.x - this.ray < 0) this.x = this.ray;
  }
  updateAspect() {
    const ratio = this.crunch / this.weight;
    const frame = 1 + Math.floor(ratio * this.maxCrunchFrame);
    this.pomme.gotoAndStop(frame);
    this.light.gotoAndStop(frame);
  }
  playHitSound() {
    const chan = 100 + random(100);
    const r = random(3);
    const link = ['sGroundHit0', 'sGroundHit1', 'sGroundHit2'][r];
    this.game.mng.sfx.playSound(link, chan);
    this.game.mng.sfx.setVolume(chan, this.vity * 2);
  }
  traceInfo() {}
}
J.Fruit = Fruit;
K.registerClass('spPhysFruit', Fruit);

// ── Panier ────────────────────────────────────────────────────────────────
const GRAP_NAMES = ['Zero-grappe ', 'Mono-grappe ', 'Mini-grappe ', 'Grappe ', 'Grosse-grappe ', 'Enorme-grappe ', 'Super-grappe ',
  'Mega-grappe ', 'Atomique-grappe ', 'Hypopo-grappe ', 'Divine-grappe ', 'Maestro-grappe '];
const COMBOS = [
  ['rondade ricochet ', 'double-bande '], ['double-bande tete ', 'triple-impact '], ['triple-impact ecureuil ', 'quadruple-impact '],
  ['quadruple-impact corbeau ', 'pentacle mystique '], ['rondade lateral ', 'shaker '], ['double-bande lateral ', 'double-shaker '],
  ['pure direct ', 'coup-de-bol '], ['pure dunk direct ', 'lucky dunk '], ['pure ecureuil ', 'wild ecureuil '],
  ['ecureuil corbeau ', 'nature cooperation '], ['pure corbeau ', 'wild corbeau '], ['wild nature cooperation ', 'harmonie '],
  ['ecureuil corbeau tete', 'trinitée '], ['pure tete ', 'tete plongeante '], ['rondade ecureuil ', 'wild side '],
  ['latéral dunk ', 'demi-lune '], ['demi-lune direct ', 'pleine-lune '], ['shaker dunk ', 'maxi-shaker '],
  ['rondade tete ', 'tete déviée '], ['pure tete déviée', 'tete plongeante déviée '], ['déviée dunk ', 'du mammouth '],
  ['ricochet tete ', 'alouette '], ['alouette lateral ', 'alouette courbée'], ['ricochet corbeaux ', 'croc '],
  ['tete dunk ', 'granite '], ['rondade dunk ', 'coquelicot '],
];
class Panier extends Phys {
  constructeur() {
    this.dp_fruit = 400; this.dp_score = 300; this.ray = 90; this.openLevel = 53; this.openRay = 42;
    this.cBoundGround = 0.6; this.cBoundSide = 0.5; this.glurpSpeed = 0.1;
    this.init();
  }
  init() {
    this.fruitList = [];
    this.flScore = false;
    this.animList = new J.AnimList();
    super.init();
    this.grapName = GRAP_NAMES;
    this.fNum = 0; this.sNum = 0; this.grappe = 0;
  }
  initDefault() { if (this.weight == null) this.weight = 10; super.initDefault(); }
  update() {
    super.update();
    if (this.flGround) this.vitx *= Math.pow(0.75, Cs.tmod);
    const gy = this.map.height - this.map.groundLevel;
    if (this.y + this.ray > gy) {
      this.y = gy - this.ray;
      if (this.vity > 6) this.vity *= -this.cBoundGround;
      else if (this.parentLink == null) { this.vity = 0; this.flGround = true; }
    }
    if (this.x + this.openRay > this.map.width) { this.x = this.map.width - this.openRay; this.vitx *= -this.cBoundSide; }
    if (this.x - this.openRay < 0) { this.x = this.openRay; this.vitx *= -this.cBoundSide; }
    for (let i = 0; i < this.fruitList.length; i++) {
      const f = this.fruitList[i];
      f.update();
      if (this.fruitList[i] !== f) i--;
    }
    this.endUpdate();
  }
  endUpdate() {
    super.endUpdate();
    this._x += this.vitx * Cs.tmod;
    this._rotation = this.vitx / 2 * Cs.tmod;
  }
  addFruit(fruit) {
    this.game.onAddFruit();
    if (this.game.endingGame) return;
    if (this.game.type === '$classic') {
      if (fruit.flScoreAble && fruit.antList.length === 0) {
        let point = Math.round((fruit.weight - fruit.crunch) * 100) * (fruit.flGold ? 10 : 1);
        if (point > 0) {
          this.addScore(point);
          const bonus = this.checkCombo(fruit);
          if (bonus > 0) point += bonus;
          this.game.mng.sfx.play('sBonus');
        }
        this.game.score += point;
      } else {
        this.game.scroller.put('beurk!', '-500');
        this.game.score -= 500;
      }
      this.game.updateScore();
    } else {
      this.game.mng.sfx.play('sBonus');
    }
    this.game.mng.card.$stat.$fruit += 1;
    this.fNum++;
    this.attachMovie('spPhysFruit', 'fruit' + this.fNum, this.dp_fruit + this.fNum, fruit);
    const mc = this['fruit' + this.fNum];
    mc.flPanier = true;
    mc.panier = this;
    mc.x = fruit.x - this.x;
    mc.y = fruit.y - this.y;
    mc._x = mc.x; mc._y = mc.y;
    mc.pomme._rotation = fruit.pomme._rotation;
    mc.updateAspect();
    mc.depth = undefined;
    fruit.kill();
    this.fruitList.push(mc);
    this.fNum++;
    this.attachMovie('maskPanier', 'mask' + this.fNum, this.dp_fruit + this.fNum);
    const mask = this['mask' + this.fNum];
    mc.setMask(mask);
    mc.mask = mask;
  }
  removeFruit(fruit) {
    const i = this.fruitList.indexOf(fruit);
    if (i >= 0) this.fruitList.splice(i, 1);
  }
  addScore(score) {
    this.sNum = (this.sNum + 1) % 40;
    this.attachMovie('numb', 'score' + this.sNum, this.dp_score + this.sNum, { num: score, scale: 80 });
    const mc = this['score' + this.sNum];
    let h = -20;
    if (vif(this.lastScore) && this.lastScore._visible) h += (this.lastScore.pos.y + 20) - (this.lastScore._height + 4);
    mc.regular = { x: 0, y: -10 };
    mc.pos = { x: 0, y: h };
    this.animList.addSlide('anim' + this.sNum, mc, { obj: this, method: 'endAnimScore', args: mc });
    this.lastScore = mc;
    this.grappe++;
  }
  endAnimScore(mc) { mc.animId = K.setInterval(this, 'removeScore', 1000, mc); }
  removeScore(mc) {
    K.clearInterval(mc.animId);
    mc.animId = K.setInterval(this, 'turnOutScore', 40, mc);
    mc.rot = 0.1;
    if (this.grappe > 1) {
      const bonus = Math.pow(2, Math.min(this.grappe, 11)) * 10;
      this.game.scroller.put(this.grapName[this.grappe], '+' + bonus);
      this.game.score += bonus;
      this.game.stat.bestVal('Grappe maximum', this.grappe);
      this.game.updateScore();
    }
    // Le témoin de grappe du disque rustiné (scripts/patch-kaluga-grappe.js) :
    // le OU binaire des tailles rencontrées, engrangées ou non.
    this.game.gOr = (this.game.gOr | 0) | this.grappe;
    this.grappe = 0;
  }
  turnOutScore(mc) {
    mc.rot *= Math.pow(1.4, Cs.tmod);
    mc._rotation = mc.rot;
    mc._xscale = 100 - mc.rot / 2;
    mc._yscale = 100 - mc.rot / 2;
    if (mc.rot > 200) { K.clearInterval(mc.animId); mc.removeMovieClip(); }
  }
  checkCombo(fruit) {
    let b = 0;
    let name = '';
    if (fruit.flScNoLink) { b += 2; name += 'pure '; }
    if (fruit.flScSide) { b += 2; name += 'rondade '; }
    if (fruit.flScBound) { b += 4; name += 'ricochet '; }
    if (fruit.flScHead) { b += 10; name += 'tete '; }
    if (fruit.flScSquirrel) { b += 12; name += 'ecureuil '; }
    if (fruit.flScBird) { b += 24; name += 'corbeau '; }
    if (fruit.flScLateral) { b += 8; name += 'lateral '; }
    if (fruit.flScDunk) { b += 10; name += 'dunk '; }
    if (fruit.flScDirect) { b += 4; name += 'direct '; }
    for (const [search, rep] of COMBOS) name = this.replace(name, search, rep);
    b *= 10;
    if (b > 0) this.game.scroller.put(name, '+' + b);
    if (name !== '') this.game.statCombo.incVal(name, 1);
    return b;
  }
  replace(str, search, rep) {
    if (search.length === 1) return str.split(search).join(rep);
    if (str.indexOf(search) === -1) return str;
    return str.split(search).join(rep);
  }
}
J.Panier = Panier;
K.registerClass('spPhysPanier', Panier);

// ── Butterfly ─────────────────────────────────────────────────────────────
class Butterfly extends Sprite {
  constructeur() { this.margin = 10; this.speed = 0.15; this.shake = 0; this.flySpeed = 40; this.init(); }
  init() {
    this.type = 'Butterfly';
    super.init();
    this.mode = 0; this.sens = 1; this.wScale = 0; this.fly = 0; this.flySpeedMod = 0;
  }
  update() {
    super.update();
    if (this.mode === 0) {
      this.flySpeedMod += 2 * ((random(200) - 100) / 100) * Cs.tmod;
      this.flySpeedMod *= this.game.frict;
      this.fly = (this.fly + (this.flySpeed + Math.min(0, this.flySpeedMod)) * Cs.tmod) % 628;
      const s = Math.cos((this.fly - 314) / 100) * 100;
      this.w1._yscale = s;
      this.w2._yscale = s + random(20) - 10;
      if (this.wa1) this.wa1._yscale = this.wScale;
      if (this.wa2) this.wa2._yscale = this.wScale;
      this.vity += (s - this.wScale) / 20;
      this.wScale = s;
      this.vitx += (this.speed * this.sens * 1.2) + (this.speed * 2.5) * (random(200) - 100) / 100 * Cs.tmod;
      this.vity += (this.speed * this.sens) + (this.speed * 2.5) * (random(200) - 100) / 100 * Cs.tmod;
      this.vitx *= this.game.frict;
      this.vity *= this.game.frict;
      this.x += (this.vitx + this.shake * (random(200) - 100) / 100) * Cs.tmod;
      this.y += (this.vity + this.shake * (random(200) - 100) / 100) * Cs.tmod;
      this._rotation = this.vity * 4 * this.sens;
      const gy = this.map.height - this.map.groundLevel;
      if (this.y + this.margin > gy) { this.y = gy - this.margin; this.vity -= Cs.tmod; }
      const limitLeft = this.margin, limitRight = this.map.width - this.margin;
      if (this.x < limitLeft) { this.vitx = 0; this.x = limitLeft; this.setSens(1); }
      if (this.x > limitRight) { this.vitx = 0; this.x = limitRight; this.setSens(-1); }
      if (this.y < this.margin) this.vity += Cs.tmod;
      if (!random(300 / Cs.tmod)) this.setSens(-this.sens);
      if (!random(50 / Cs.tmod)) this.dropPaillette();
    }
    this.endUpdate();
  }
  dropPaillette() {
    const mc = this.game.newFX('paillette');
    this.game.particuleList.push(mc);
    mc.vitx = this.vitx / 2;
    mc.vity = this.vity / 2;
    mc.x = this.x; mc.y = this.y;
    mc.time = 20 + random(10);
    mc.mode = 0;
    mc.gotoAndStop(this.id + 1);
    return mc;
  }
  setSens(sens) { this.sens = sens; this._xscale = this.sens * 100; }
  kill() { this.game.removeFromList(this, 'butterflyList'); this.removeMovieClip(); }
}
J.Butterfly = Butterfly;
K.registerClass('spButterfly', Butterfly);

// ── Bads ──────────────────────────────────────────────────────────────────
class Bads extends Phys {
  init() { super.init(); }
  kill() { this.game.removeFromList(this, 'badList'); super.kill(); }
}
J.Bads = Bads;

// ── Ant ───────────────────────────────────────────────────────────────────
class Ant extends Bads {
  constructeur() { this.speed = 0.3; this.crunchSpeed = 0.0002; this.init(); }
  init() {
    this.type = 'Ant';
    this.timer = 0;
    super.init();
    this.initGroundMode();
  }
  initDefault() {
    if (this.flPhys == null) this.flPhys = false;
    if (this.volume == null) this.volume = 0.4;
    if (this.weight == null) this.weight = 0.1;
    super.initDefault();
    if (this.mode == null) this.mode = 0;
    if (this.vitr == null) this.vitr = 0;
  }
  update() {
    super.update();
    switch (this.mode) {
      case 0:
        if (!this.flPhys) {
          this.x += this.speed * this.sens * Cs.tmod * (this.game.debugCoef + 1);
          this.updateGroundId();
          if (this.sens === 1 && this.x > this.map.width) this.setSens(-1);
          if (this.sens === -1 && this.x < 0) this.setSens(1);
          if (this.gList && this.gList.length > 1) this.fruitSeek();
        } else {
          this.vitr *= this.game.frict;
          this._rotation += this.vitr * Cs.tmod;
          const gy = this.map.height - this.map.groundLevel;
          if (this.y > gy) {
            this.y = gy; this.vity = 0; this.vitx = 0;
            this.initGroundMode();
            break;
          }
          if (this.game.type === '$invasion') {
            if (this.x > this.map.width) { this.x = this.map.width; this.vitx = -Math.abs(this.vitx) * 0.9; this.setSens(-1); }
            if (this.x < 0) { this.x = 0; this.vitx = Math.abs(this.vitx) * 0.9; this.setSens(1); }
          }
        }
        break;
      case 1: {
        this.timer -= Cs.tmod;
        if (this.timer < 0) this.changeFruitPoint();
        if (this.fruitPoint != null) {
          this._rotation = this._rotation * 0.8 + this.fruitPoint.rot * 0.2;
          this.x += this.vitx;
          this.y += this.vity;
          if (Math.abs(this.x - this.fruitPoint.x) + Math.abs(this.y - this.fruitPoint.y) < 1) { this.fruitPoint = undefined; this.flFreeze = true; }
        }
        const crunch = this.crunchSpeed * Cs.tmod;
        this.fruit.crunch += crunch;
        this.game.stat.incVal('Quantité mangée par les fourmis', crunch * 10, 'gr');
        break;
      }
      default: break;
    }
    this.endUpdate();
  }
  initGroundMode() {
    super.initGroundMode();
    if (this.game.type === '$classic') {
      const w = this.map.width / 2;
      const dist = Math.abs(this.x - w);
      if (dist > w + 10) {
        const d = Math.round((dist - w) * 10) / 10;
        this.game.stat.bestVal('Meilleur lancer de fourmi', d);
        this.game.scroller.put('Lancer de fourmi ', d + ' cm');
      }
    }
    this.exitPhysMode();
    this._rotation = 0;
  }
  exitGroundMode() { super.exitGroundMode(); this.initPhysMode(); }
  setSens(sens) { if (sens != null) this.sens = sens; this._xscale = -100 * this.sens; }
  fruitSeek() {
    for (const mc of this.gList.slice()) {
      if (mc.type === 'Fruit' && mc.crunch < mc.weight && mc.caterNum === 0 && !mc.flGold) { mc.addAnt(this); return; }
    }
  }
  changeFruitPoint() {
    const r = random(this.fruit.ray);
    let a = random(624) / 100;
    this.fruitPoint = { x: Math.cos(a) * r, y: Math.sin(a) * r };
    const difx = this.fruitPoint.x - this.x, dify = this.fruitPoint.y - this.y;
    a = Math.atan2(dify, difx);
    this.vitx = Math.cos(a) * this.speed;
    this.vity = Math.sin(a) * this.speed;
    this.fruitPoint.rot = a / RAD;
    this.timer = random(200 * Cs.tmod);
    this.flFreeze = false;
  }
  kill() { this.game.removeFromList(this, 'antList'); super.kill(); }
}
J.Ant = Ant;
K.registerClass('spBadsAnt', Ant);

// ── Caterpillar ───────────────────────────────────────────────────────────
class Caterpillar extends Bads {
  constructeur() { this.speed = 0.6; this.length = 36; this.posListMaxLength = 20; this.growingSpeed = 0.3; this.init(); }
  init() {
    this.mode = 0;
    this.type = 'Caterpillar';
    this.posList = [];
    this.anim = new J.FrameAnimManager({ end: 22, root: this });
    super.init();
    this.initGroundMode();
    this.stop();
  }
  initDefault() {
    if (this.flPhys == null) this.flPhys = false;
    if (this.flGrowing == null) this.flGrowing = false;
    if (this.weight == null) this.weight = 0.8;
    if (this.volume == null) this.volume = 0.8;
    if (this.adr == null) this.adr = 2;
    if (this.scale == null) this.scale = 100;
    super.initDefault();
  }
  update() {
    super.update();
    switch (this.mode) {
      case 0:
        this.anim.update(this.game.debugCoef + 1);
        this.x += this.speed * this.sens * Cs.tmod * (this.game.debugCoef + 1);
        this.updateGroundId();
        if (this.sens === 1 && this.x > this.map.width) this.setSens(-1);
        if (this.sens === -1 && this.x < 0) this.setSens(1);
        if (this.gList && this.gList.length > 1) { if (this.fruitSeek()) return; }
        if (this.flGrowing) {
          this.scale += this.growingSpeed * Cs.tmod;
          if (this.scale >= 100) { this.scale = 100; this.flGrowing = false; }
          this.setScale(this.scale);
        }
        this.updatePosList();
        break;
      case 1: {
        const gy = this.map.height - this.map.groundLevel;
        if (this.y > gy) {
          this.y = gy;
          const power = this.getPower();
          this.vitx = 0; this.vity = 0;
          if (this.game.type === '$caterLaunch' || power > 10) {
            this.initMode(2);
            this.stunTimer = (power - 10) * 170;
            const l = Math.min(Math.max(0, this.length - (power - 10)), this.length);
            this.updateDraw(l);
            if (this.game.type === '$caterPlant') this.game.onCaterCrash(power);
          } else {
            this.initMode(0);
          }
          this.initGroundMode();
          break;
        }
        this.updateDraw(this.length);
        this.updatePosList();
        break;
      }
      case 2:
        this.stunTimer -= Cs.tmod;
        if (this.stunTimer < 0 && this.game.type !== '$caterLaunch') this.initMode(0);
        break;
      default: break;
    }
    this.endUpdate();
  }
  updateDraw(l) {
    const pList = [];
    let oldpos = { x: 0, y: 0 };
    for (let i = 0; i < this.posList.length; i++) {
      const pos = { x: this.posList[i].x + oldpos.x, y: this.posList[i].y + oldpos.y };
      const difx = pos.x - oldpos.x, dify = pos.y - oldpos.y;
      const dist = Math.sqrt(difx * difx + dify * dify);
      if (l - dist > 0) {
        l -= dist;
        pList.push({ x: pos.x, y: pos.y });
        oldpos = pos;
      } else {
        const a = Math.atan2(dify, difx);
        pos.x = oldpos.x + Math.cos(a) * l;
        pos.y = oldpos.y + Math.sin(a) * l;
        pList.push({ x: pos.x, y: pos.y });
        break;
      }
    }
    this.line.clear();
    this.line.lineStyle(6.8, 0x000000);
    this.line.moveTo(0, 0);
    for (const p of pList) this.line.lineTo(p.x, p.y);
    this.line.lineStyle(5, 0x25892B);
    this.line.moveTo(0, 0);
    for (const p of pList) this.line.lineTo(p.x, p.y);
  }
  updatePosList() {
    for (const p of this.posList) p.y += this.game.grav * this.weight * Cs.tmod * 2;
    this.posList.unshift({ x: -this.vitx, y: -this.vity });
    while (this.posList.length > this.posListMaxLength) this.posList.pop();
  }
  initGroundMode() {
    const w = this.map.width / 2;
    const dist = Math.abs(this.x - w);
    if (dist > w + 10) {
      const d = Math.round((dist - w) * 10) / 10;
      this.game.stat.bestVal('Meilleur lancer de vers', d);
      this.game.scroller.put('Lancer de vers ', d + ' cm');
    }
    super.initGroundMode();
    this.exitPhysMode();
  }
  exitGroundMode() { super.exitGroundMode(); this.initPhysMode(); }
  initPhysMode() { super.initPhysMode(); this.initMode(1); }
  initMode(mode) {
    this.exitMode(this.mode);
    switch (mode) {
      case 1: this.setSens(-1); this.gotoAndStop('fly'); break;
      case 2: this.gotoAndStop('plante'); break;
      case 3: this.gotoAndPlay('splash'); this.flFreeze = true; break;
      default: break;
    }
    this.mode = mode;
  }
  exitMode(mode) {
    switch (mode) {
      case 1: this.line.clear(); break;
      case 2: this.line.clear(); break;
      case 3: this.flFreeze = false; break;
      default: break;
    }
  }
  setSens(sens) { if (sens != null) this.sens = sens; this._xscale = -this.scale * this.sens; }
  fruitSeek() {
    for (const mc of this.gList.slice()) {
      if (mc.type === 'Fruit') {
        if (mc.weight > 0.9 && (mc.holeNum === 0 || (mc.holeNum === 1 && mc.weight > 1.2)) && mc.crunch * 2 < mc.weight && !mc.flGold) {
          this.game.mng.sfx.play('sCrunch');
          mc.addCaterpillar();
          this.kill();
          return true;
        }
      }
    }
    return false;
  }
  splash() { this.initMode(3); }
  kill() { this.game.removeCaterpillar(this); super.kill(); }
  setScale(scale) { this.scale = scale; this._xscale = -scale * this.sens; this._yscale = scale; }
}
J.Caterpillar = Caterpillar;
K.registerClass('spBadsCaterpillar', Caterpillar);

// ── Bird ──────────────────────────────────────────────────────────────────
class Bird extends Bads {
  constructeur() { this.margin = 40; this.eatDist = 40; this.init(); }
  init() {
    this.type = 'Bird';
    this.flPrepareDash = false; this.flEatTzongre = false; this.flDigere = false; this.flPhys = false;
    this.sens = 1; this.stunTimer = 0;
    super.init();
    this.findTarget();
    this.initFlyMode();
  }
  initDefault() {
    super.initDefault();
    if (this.wait == null) this.wait = 200;
    if (this.precision == null) this.precision = 20;
    if (this.cDashSpeed == null) this.cDashSpeed = 0.6;
    if (this.hitPoint == null) this.hitPoint = 40;
  }
  update() {
    super.update();
    if (!vif(this.target) || this.target._visible !== true) this.findTarget();
    switch (this.mode) {
      case 0: {
        if (this.stunTimer > 0) {
          this.stunTimer -= Cs.tmod;
          if (this.stunTimer < 0) this.sub.h.gotoAndStop('normal');
        } else if (this.target != null && !this.flDigere) {
          this.waitTimer -= Cs.tmod;
          if (this.waitTimer < this.precision && this.wayPoint == null) {
            if (this.target.x > 0 && this.target.x < this.map.width) this.wayPoint = { x: this.target.x, y: this.target.y };
            else this.findTarget();
          }
          if (!this.flPrepareDash && this.waitTimer < 10) this.prepareDash();
          if (this.waitTimer < 0) { this.initDashMode(); break; }
        }
        if (this.flDigere) {
          this.digereTimer -= Cs.tmod;
          if (this.digereTimer < 0) {
            this.flDigere = false;
            this.sub.h.h.bec.gotoAndPlay('Caterpillar');
            this.powerUp();
          }
        }
        this.vitx += Cs.tmod * (random(200) - 100) / 100;
        this.vity += Cs.tmod * (random(200) - 100) / 100;
        this.vitx *= this.game.frict;
        this.vity *= this.game.frict;
        this.x += this.vitx * Cs.tmod;
        this.y += this.vity * Cs.tmod;
        const gy = this.map.height - this.map.groundLevel;
        if (this.y + this.margin > gy) this.y = gy - this.margin;
        const limitLeft = this.margin, limitRight = this.map.width - this.margin;
        if (this.x < limitLeft) { this.vitx = 0; this.x = limitLeft; }
        if (this.y < this.margin) this.vity += Cs.tmod;
        if (this.x > limitRight) { this.vitx = 0; this.x = limitRight; }
        if (this.stunTimer <= 0 && this.target != null) {
          if (this.sens * (this.x - this.target.x) > 0) this.swap();
          const difx = this.target.x - this.x, dify = this.target.y - this.y;
          const a = Math.atan2(dify, difx * this.sens);
          const rot = a / RAD;
          this._rotation = rot * 0.2 * this.sens;
          this.sub.h.h._rotation = rot * 0.6;
          this.sub.h.h._y = Math.min(Math.max(-6, dify / 10), 6);
          if (!this.game.flEndGame && !this.flDigere) {
            const dx = this.target.x - (this.x + this.sub.h._x);
            const dy = this.target.y - (this.y + this.sub.h._y);
            const dist = Math.abs(dx) + Math.abs(dy);
            this.miniDashCountDown -= Cs.tmod;
            if (dist < this.eatDist * 2 && this.miniDashCountDown < 0) {
              this.miniDashCountDown = 20;
              this.vitx += dx / 6;
              this.vity += dy / 6;
              this.sub.h.h.bec.gotoAndPlay('open');
            }
            if (dist < this.eatDist) this.eat(this.target);
          }
          if (!random(100 / Cs.tmod)) {
            this.game.mng.sfx.play(random(2) === 0 ? 'sCrow0' : 'sCrow1');
            this.sub.h.h.bec.gotoAndPlay('open');
          }
        }
        break;
      }
      case 1:
        this.x = this.x * this.cDashSpeed + this.wayPoint.x * (1 - this.cDashSpeed);
        this.y = this.y * this.cDashSpeed + this.wayPoint.y * (1 - this.cDashSpeed);
        if (!this.game.flEndGame && this.target != null) {
          if (this.getDist(this.target) < 40) { this.initFlyMode(); this.eat(this.target); }
        }
        if (this.wayPoint && Math.abs(this.x - this.wayPoint.x) + Math.abs(this.y - this.wayPoint.y) < 36) {
          this.initFlyMode();
          if (this.target != null && this.target.type === 'Caterpillar' && this.target.flGround) this.eat(this.target);
          this.findTarget();
        }
        break;
      case 2:
        this.waitTimer -= Cs.tmod;
        if (this.waitTimer < 0) this.exitStaseMode();
        break;
      case 3: {
        this.vitx += Cs.tmod * (random(200) - 100) / 100;
        this.vity -= Cs.tmod * 0.3;
        this.vitx *= this.game.frict;
        this.vity *= this.game.frict;
        this.x += this.vitx * Cs.tmod;
        this.y += this.vity * Cs.tmod;
        const limitLeft = this.margin;
        if (this.x < limitLeft) { this.vitx = 0; this.x = limitLeft; }
        const gy = this.map.height - this.map.groundLevel;
        if (this.y + this.margin > gy) this.y = gy - this.margin;
        if (this.y < -100) {
          if (this.flEatTzongre) this.game.onTzDeath();
          this.kill();
          return;
        }
        break;
      }
      default: break;
    }
    if (!random(Math.round(400 / Cs.tmod))) this.dropPlume();
    this.endUpdate();
  }
  initStaseMode() {
    this.mode = 2;
    this.wait *= 0.9;
    this.waitTimer = this.wait * 4 + random(this.wait);
    this._visible = false;
  }
  exitStaseMode() { this.initFlyMode(); this.findTarget(); this._visible = true; }
  initFlyMode(nextMode) {
    if (nextMode == null) nextMode = 0;
    this.gotoAndStop('fly');
    this.waitTimer = this.wait + random(this.wait / 4);
    this.mode = nextMode;
    this._rotation = 0;
    this.miniDashCountDown = 10;
    this.flPrepareDash = false;
    this.wayPoint = undefined;
  }
  initDashMode() {
    this.gotoAndStop('dash');
    this.mode = 1;
    this.sens = 1;
    this._xscale = 100;
    const difx = this.wayPoint.x - this.x, dify = this.wayPoint.y - this.y;
    this._rotation = Math.atan2(dify, difx) / RAD;
    const max = 2 + random(2);
    for (let i = 0; i < max; i++) { const mc = this.dropPlume(); mc.vity = -(2 + random(4)); }
    this.vitx = 0; this.vity = 0;
  }
  findTarget() {
    this.target = undefined;
    for (const cater of this.game.caterpillarList) {
      if (cater.x > 0 && cater.x < this.map.width) { this.target = cater; return; }
    }
    if (vif(this.game.tzongre) && this.game.tzongre._visible) this.target = this.game.tzongre;
  }
  swap() {
    this.sub.memoryFrame = this.sub._currentframe;
    this.sub.gotoAndPlay('swap');
    this.sens = -this.sens;
    this._xscale = this.sens * 100;
  }
  prepareDash() {
    this.flPrepareDash = true;
    const difx = this.wayPoint.x - this.x, dify = this.wayPoint.y - this.y;
    const a = Math.atan2(dify, difx);
    this.vitx -= Math.cos(a) * 10;
    this.vity -= Math.sin(a) * 10;
  }
  eat(mc) {
    this.sub.h.h.bec.gotoAndStop(mc.type);
    if (mc.type === 'Tzongre') {
      const titleList = ['Miam!', 'Crunch!', 'Glurps!', 'Scrounch!'];
      const msgList = [
        mc.name + ' a été avalé par le corbeau.',
        mc.name + " n'a pas réussi a esquiver les attaques du corbeau.",
        'Le corbeau a avalé ' + mc.name + ' en une seule bouchée',
        'Les assauts répétés du corbeau ont eu raison de notre pauvre ' + mc.name,
      ];
      this.game.endPanelStart.push({ label: 'basic', list: [{ type: 'msg', title: titleList[random(titleList.length)], msg: msgList[random(msgList.length)] }] });
      this.sub.h.h.bec.gotoAndStop(20 + mc.id);
      mc.kill();
      this.flEatTzongre = true;
      this.initFlyMode(3);
    } else if (mc.type === 'Caterpillar') {
      this.game.stat.incVal('Vers mangés par le corbeau', 1);
      this.flDigere = true;
      this.digereTimer = 200;
      mc.kill();
    }
  }
  powerUp() {
    this.sub.h.attachMovie('powerUp', 'powerUp', 2);
    this.sub.h.powerUp._x = 9;
    this.hitPoint += 60;
  }
  fruitHit(power) {
    this.vity += power;
    this.stunTimer += power * 16;
    this.sub.h.gotoAndStop('stun');
    this.hitPoint -= power;
    if (this.hitPoint < 0) {
      if (this.mode !== 3) this.game.stat.incVal('Corbeaux vaincus', 1);
      this.mode = 3;
    }
    if (this.flDigere) {
      this.game.stat.incVal('vers sauvés des corbeaux', 1);
      this.sub.h.h.bec.gotoAndPlay('spit');
      this.flDigere = false;
      const mc = this.game.newCaterpillar();
      mc.x = this.x + this.sub.h._x + 4;
      mc.y = this.y + this.sub.h._y + 2;
      mc.exitGroundMode();
    }
    this.game.stat.incVal('Coups de pomme sur les corbeaux', 1);
  }
  dropPlume() {
    this.game.stat.incVal('Plumes perdues par les corbeaux', 1);
    const mc = this.game.newFX('plume');
    this.game.particuleList.push(mc);
    const sens = random(2) * 2 - 1;
    mc.gotoAndPlay(random(40) + 1);
    mc.vitx = this.vitx + random(10) - 5;
    mc.vity = this.vity;
    mc.x = this.x - mc.p._x * sens;
    mc.y = this.y;
    mc._xscale = sens * 100;
    mc.p.stop();
    mc.time = 60 + random(20);
    mc.mode = 0;
    return mc;
  }
  kill() { this.game.removeFromList(this, 'birdList'); super.kill(); }
}
J.Bird = Bird;
K.registerClass('spBadsBird', Bird);

// ── Frog ──────────────────────────────────────────────────────────────────
class Frog extends Bads {
  constructeur() {
    this.eyeRay = 1.8; this.eyeRange = 400; this.eatRange = 100; this.nbFrameJump = 16;
    this.defMobilite = 80; this.defSensRange = 400; this.defTensionMax = 200;
    this.init();
  }
  init() {
    this.type = 'Frog';
    super.init();
    this.flEating = false; this.flLinkable = false; this.flLostControl = false; this.flEscape = false;
    this.step = 0;
    this.setSens(1);
    this.tension = this.tensionMax;
    this.stop();
  }
  initDefault() {
    if (this.flPhys == null) this.flPhys = false;
    if (this.weight == null) this.weight = 0.6;
    if (this.mobilite == null) this.mobilite = this.defMobilite;
    if (this.sensRange == null) this.sensRange = this.defSensRange;
    if (this.tensionMax == null) this.tensionMax = this.defTensionMax;
    if (this.hitPoint == null) this.hitPoint = 20;
    super.initDefault();
  }
  update() {
    // Phys.update lit `tension` comme un vecteur ; la grenouille en fait un
    // nombre (sa nervosité) — comme l'original, on la lui rend après.
    const tensionFrog = this.tension;
    this.tension = { x: 0, y: 0 };
    super.update();
    this.tension = tensionFrog;
    if (this.flEating) {
      let rot;
      if (this.focus != null) {
        const difx = this.x - this.focus.x, dify = this.y - this.focus.y;
        rot = Math.atan2(dify, -difx * this.sens) / RAD;
        rot += (this._rotation + this.h._rotation) * this.sens;
      } else rot = 0;
      this.h.h._rotation = this.h.h._rotation * 0.5 + this.getAngle(rot) * 0.5;
    }
    switch (this.step) {
      case 0: {
        this.centerEye();
        if (this.flEscape) {
          const dif = this.x - (this.map.width / 2);
          if (Math.abs(dif) > 40 + this.map.width / 2) { this.kill(); return; }
          this.vitx = 7 * this.sens; this.vity = -7;
          this.initJump();
          break;
        }
        if (!random(100 / Cs.tmod)) { this.h.h.g.play(); this.game.mng.sfx.play('sFrog'); }
        const w = this.map.width / 2;
        const dif = this.x - w;
        if (!random(150 / Cs.tmod) || (Math.abs(this.x - w) > w && dif * this.sens > 0)) {
          this.gotoAndPlay('turn');
          this.step = 3;
          break;
        }
        if (!random(this.mobilite / Cs.tmod)) {
          this.vitx = this.sens * (4 + random(5));
          this.vity = -(5 + random(5));
          this.initJump();
          break;
        }
        if (this.focusView(this.sensRange)) {
          this.step = 1;
          this.tension = this.tensionMax;
          this.oldFocus = this.focus;
          break;
        }
        break;
      }
      case 1: {
        this.updateEye();
        if (this.focusView(this.sensRange)) {
          const dx = Math.abs(this.focus.x - this.oldFocus.x), dy = Math.abs(this.focus.y - this.oldFocus.y);
          const dist = this.getDist(this.focus);
          const ratio = 1 - Math.min(dist / this.sensRange, 1);
          this.tension -= (dx + dy) * ratio * Cs.tmod;
        } else {
          this.tension += 6 * Cs.tmod;
        }
        const frame = 20 - Math.round(this.nbFrameJump * (this.tension / this.tensionMax));
        this.gotoAndStop(frame);
        if (this.tension < 0) {
          const difx = this.focus.x - this.x, dify = this.focus.y - this.y;
          this.vity = Math.min(-8, dify / 19);
          this.vitx = difx / 23;
          this.initJump();
          break;
        }
        if (this.tension > this.tensionMax) { this.gotoAndStop('base'); this.step = 0; break; }
        this.oldFocus = { x: this.focus.x, y: this.focus.y };
        break;
      }
      case 2: {
        let rot = 0;
        if (!this.flLostControl && this.parentLink != null && this.game.tzongre.flLift && !this.flEating) {
          this.flLostControl = true;
          this.gotoAndStop('linked');
        }
        if (this.flLostControl) {
          const d = (this.x - this.game.map.width / 2) / 50;
          if (this.up) this.up._rotation = this.vity * 2 - this.vitx * 2 * this.sens;
          if (this.ca) this.ca._rotation = (-this.vity * 2 - d) - this.vitx * 2 * this.sens;
          if (this.cb) this.cb._rotation = (-this.vity * 2 + d) - this.vitx * 2 * this.sens;
          const dy = (this.map.height - this.map.groundLevel) - this.y;
          if (dy < 10 && this.vity > 0) {
            if (this.vity > 8) {
              this.hitPoint -= this.vity;
              if (this.hitPoint < 0) { this.flEscape = true; this.flLinkable = false; }
              this.vity *= -0.8;
            } else {
              if (this.parentLink) this.parentLink.removeLink(this);
              this.flLostControl = false;
              this.land();
              break;
            }
          }
        } else {
          const a = Math.atan2(-this.vity, -this.vitx);
          rot = a / RAD;
          if (this.sens === 1) rot = this.getAngle(rot + 180);
          const dy = (this.map.height - this.map.groundLevel) - this.y;
          const frame = 30 + Math.round(Math.min(Math.max(dy / 12, 0), 10));
          this.gotoAndStop(frame);
          if (this.vity > 0) {
            if (dy < 10) { rot = 0; this.land(); }
            else if (dy < 40) { rot *= dy / 40; }
          }
          if (!this.flEating && this.focusView(this.eatRange)) this.eat();
        }
        this._rotation = this._rotation * 0.5 + rot * 0.5;
        break;
      }
      default: break;
    }
    this.endUpdate();
  }
  land() {
    this.step = 0;
    this._rotation = 0;
    this.flLinkable = false;
    this.flPhys = false;
    this.gotoAndStop('base');
    this.y = this.map.height - this.map.groundLevel;
  }
  eat() {
    this.h.h.play();
    this.flLinkable = false;
    this.flEating = true;
    this.game.onTzDeath();
  }
  crunch() {
    const titleList = ['Miam!', 'Crunch!', 'Glurps!', 'Scrounch!'];
    const nom = this.focus ? this.focus.name : '';
    const msgList = [
      nom + ' a été absorbé par la grenouille.',
      nom + " n'a pas éviter la langue de la grenouille.",
      'La grenouille a gobé ' + nom + ' en un éclair.',
      'La persévérance de la grenouille a eu raison de notre pauvre ' + nom + '.',
    ];
    this.game.endPanelStart.push({ label: 'basic', list: [{ type: 'msg', title: titleList[random(titleList.length)], msg: msgList[random(msgList.length)] }] });
    this.h.h.tz.gotoAndStop(this.game.tzongreInfo.id + 1);
    if (this.focus) this.focus.kill();
    this.focus = undefined;
    this.game.setCameraFocus(this);
  }
  focusView(range) {
    return vif(this.focus) && (this.focus.x - this.x) * this.sens > 0 && this.getDist(this.focus) < range;
  }
  initJump() {
    this.flPhys = true;
    if (!this.flEscape && this.game.type === '$classic') this.flLinkable = true;
    this.step = 2;
  }
  centerEye() { this.h.h.o.p._x *= 0.8; this.h.h.o.p._y *= 0.8; }
  updateEye() {
    const difx = this.focus.x - this.x, dify = this.focus.y - this.y;
    const dist = Math.sqrt(difx * difx + dify * dify);
    const ratio = Math.min(dist / this.eyeRange, 1);
    const a = Math.atan2(dify, difx * (-this.sens));
    this.h.h.o.p._x = this.eyeRay * ratio * Math.cos(a);
    this.h.h.o.p._y = this.eyeRay * ratio * Math.sin(a);
  }
  setSens(sens) { if (sens != null) this.sens = sens; this._xscale = -100 * this.sens; }
  turn() { this.setSens(-this.sens); this.gotoAndStop('base'); this.step = 0; }
  kill() { this.game.removeFromList(this, 'frogList'); super.kill(); }
  getAngle(a) { while (a < -180) a += 360; while (a > 180) a -= 360; return a; }
}
J.Frog = Frog;
K.registerClass('spBadsFrog', Frog);

// ── Squirrel ──────────────────────────────────────────────────────────────
class Squirrel extends Bads {
  constructeur() { this.speed = 10; this.baseSpeed = 15; this.margin = 120; this.maxJumpDist = 300; this.init(); }
  init() {
    this.type = 'Squirrel';
    this.anim = new J.FrameAnimManager({ start: 24, end: 40, root: this });
    this.flJump = false;
    super.init();
    if (this.mode == null) this.initMode(0); else this.initMode(this.mode);
  }
  initDefault() {
    if (this.flPhys == null) this.flPhys = false;
    if (this.weight == null) this.weight = 0.5;
    if (this.adr == null) this.adr = 2;
    super.initDefault();
  }
  update() {
    super.update();
    switch (this.mode) {
      case 0: {
        this.anim.update(this.game.debugCoef + (this.speed / this.baseSpeed));
        this.x += this.speed * this.sens * Cs.tmod * (this.game.debugCoef + 1);
        this.updateGroundId();
        if (this.sens === 1 && this.x > this.map.width + this.margin) this.setSens(-1);
        if (this.sens === -1 && this.x < -this.margin) this.setSens(1);
        const list = (this.game.tzongre ? this.game.tzongre.linkList : []).concat(this.game.butterflyList);
        for (const mc of list) {
          if (mc.type === 'Fruit' || mc.type === 'Butterfly') {
            const difx = mc.x - this.x, dify = mc.y - this.y;
            if (difx * this.sens > 0) {
              const dist = Math.sqrt(difx * difx + dify * dify);
              if (dist > 50 && dist < this.maxJumpDist) {
                let a = Math.atan2(dify, difx);
                const jumpHighCoef = 0.8;
                const jumpPower = 24 * (dist / 300);
                a = a * jumpHighCoef - (Math.PI / 2) * (1 - jumpHighCoef);
                this.vitx = Math.cos(a) * jumpPower;
                this.vity = Math.sin(a) * jumpPower;
                this.flJump = true;
                this.jumpTarget = mc;
                this.initMode(1);
                this.gotoAndStop('jump');
                break;
              }
            }
          }
        }
        break;
      }
      case 1: {
        const gy = this.map.height - this.map.groundLevel;
        if (this.y > gy) { this.y = gy; this.landing(); break; }
        if (!this.flJump) {
          const a = Math.atan2(this.vity - 8, -this.vitx * this.sens);
          const a1 = this.body._rotation - 90;
          const a2 = a / RAD;
          let dif = a1 - a2;
          while (dif > 180) dif -= 360;
          while (dif < -180) dif += 360;
          this.body._rotation -= dif / 4;
          this.head._rotation += dif / 2;
          this.head._rotation /= 1.5;
          this.head.head.gotoAndStop(Math.max(1, Math.round(-this.vity * 5)));
          let mc = this.body;
          while (mc && mc._visible) { mc = mc.q; if (mc) mc._rotation = dif / 1.5; }
          for (let i = 1; i <= 4; i++) { mc = this.body['p' + i]; if (mc) mc._rotation = dif; }
        } else {
          const a = Math.atan2(this.vity, this.vitx);
          this._rotation = a / RAD + 180 * (1 - (this.sens + 1) / 2);
          if (vif(this.jumpTarget)) { if (this.hitTest(this.jumpTarget)) this.hitTarget(); }
        }
        if (this.parentLink != null && !random(70 / Cs.tmod)) {
          this.vitx += (Math.random() * 2 - 1) * 8;
          this.vity += (Math.random() * 2 - 1) * 8;
        }
        break;
      }
      case 2: {
        if (this.focus) {
          const coef = this.focus.y / this.map.height;
          this.head.head.gotoAndStop(22 - Math.round(21 * coef));
          const d = Math.max(-3, Math.min((this.focus.x - this.x) / 100, 3));
          this.head.head.yeux.o1.p._x = d;
          this.head.head.yeux.o2.p._x = d;
        }
        break;
      }
      case 3:
        this.stunCounter -= Cs.tmod;
        if (this.stunCounter < 0) this.initMode(0);
        break;
      default: break;
    }
    this.endUpdate();
  }
  hitTarget() {
    if (this.jumpTarget.type === 'Fruit') {
      this.jumpTarget.flScSquirrel = true;
      this.game.tzongre.release();
      this.jumpTarget.vitx += this.vitx;
      if (!this.jumpTarget.flGround) this.jumpTarget.vity += this.vity;
    } else if (this.jumpTarget.type === 'Butterfly') {
      this.h.attachMovie('powerUp', 'powerUp', 2);
      switch (this.jumpTarget.id) {
        case 0: case 1: this.maxJumpDist += 80; break;
        default: this.speed += 4; break;
      }
      for (let i = 0; i < 10 / Cs.tmod; i++) {
        const p = this.jumpTarget.dropPaillette();
        p.vitx = 2 * (random(200) - 100) / 100;
        p.vity = 2 * (random(200) - 100) / 100;
      }
      this.jumpTarget.kill();
    }
    this.jumpTarget = undefined;
  }
  landing() {
    this.vity = 0;
    const dif = Math.abs(this.x - (this.map.width / 2));
    if (dif < (this.map.width / 2) + this.margin || this.flJump) this.initMode(0);
    else { this.stunCounter = dif * 2; this.initMode(3); }
  }
  exitGroundMode(flExt) { super.exitGroundMode(); if (flExt) this.initMode(1); }
  initMode(mode) {
    this.exitMode(this.mode);
    switch (mode) {
      case 0: this.initGroundMode(); this.flJump = false; this._rotation = 0; break;
      case 1: this.initPhysMode(); if (!this.flJump) this.setSens(-1); this.gotoAndStop('fly'); this.head.stop(); break;
      case 2: this.gotoAndStop('judge'); this.head.head.stop(); break;
      case 3: this.gotoAndPlay('stunned'); this.flGround = true; break;
      default: break;
    }
    this.mode = mode;
  }
  exitMode(mode) {
    switch (mode) {
      case 0: this.exitGroundMode(); break;
      case 1: this.exitPhysMode(); break;
      case 2: this.flFreeze = false; break;
      default: break;
    }
  }
  setSens(sens) { if (sens != null) this.sens = sens; this._xscale = -100 * this.sens; }
  setStatus(status) { this.status = status; this.gotoAndPlay('flag'); }
  kill() { this.game.removeFromList(this, 'squirrelList'); super.kill(); }
}
J.Squirrel = Squirrel;
K.registerClass('spBadsSquirrel', Squirrel);

})(typeof window !== 'undefined' ? window : globalThis);
