/*
 * MotionBall — la BILLE (Ball.as) et les OPTIONS de la partie (Options.as :
 * les billes possédées, les grelots, la carte et le radar, les icônes).
 *
 * La bille est un clip vide (plan BALL) qui porte la bille dessinée (marble,
 * une image par couleur), ses grains (stone) roulant sous un masque rond,
 * et son reflet (light) ; son ombre est un clip à part (plan DECOR). Sa
 * position vit en pixels (`x, y`), sa vitesse en `sx, sy` ; `Ball.update`
 * lit les flèches, applique l'inertie et la poussée de la couleur, borne la
 * vitesse, puis avance par pas de DELTA en sondant la table de collision.
 *
 * Deux silences de l'AS2 gardés tels quels : `mc.shadow._y = 0` en fin de
 * saut vise un enfant qui n'existe pas (l'ombre est `this.shadow`), et
 * `walltable[dx-1][dy]` hors grille vaut undefined.
 */
'use strict';

(function (racine) {

const K = racine.KalugaMoteur;
const J = racine.Mb2Jeu;
const { Const, Tools, Std, random, int, remove } = J;
const Sound = J.Sound;
const Key = K.Key;

class Ball {
  constructor(game) {
    this.game = game;
    this.btype = 0;
    this.mc = game.dmanager.empty(Const.BALL_PLAN);
    this.shadow = game.dmanager.attach('shadow', Const.DECOR_PLAN);
    this.mc.attachMovie('marble', 'gfx', 10);
    this.mc.createEmptyMovieClip('stoneMc', 20);
    this.mc.attachMovie('round', 'mask', 30);
    this.mc.stoneMc.setMask(this.mc.mask);
    this.mc.attachMovie('light', 'light', 40);
    this.mc.gfx.gotoAndStop(this.btype + 1);
    this.stoneList = [];
    this.gen_stones();
    this.clign_count = 0;
    this.clign_flag = false;
    this.x = Const.LVL_CWIDTH / 2;
    this.y = Const.LVL_CHEIGHT / 2;
    this.sx = 0;
    this.sy = 0;
    Tools.set_mcpos(this.mc, this);
    this.x = this.mc._x;
    this.y = this.mc._y;
    this.control = true;
    this.max_speed_enabled = true;
    this.jump_delta = 0;
    this.jump = false; this.jump_size = 0; this.jump_way = 1; this.last_jump = false;
    this.speed = 0; this.maxspeed = 20;
    this.col_count = 0;
    this.death_hit = false; this.classic_mask = null;
    this.hole_death = false; this.hole_death_speed = 1; this.hole_mask = null;
    this.water = false;
    this.start_x = this.x; this.start_y = this.y;
  }

  gen_stones() {
    this.stoneList = [];
    const SS = Ball.STONE_STYLE[this.btype];
    for (let i = 0; i < SS.MAX; i++) {
      const mc = Std.attachMC(this.mc.stoneMc, 'stone', i);
      mc.dx = random(628);
      mc.dy = random(628);
      mc.rayon = SS.RAYMIN + random(SS.RAYMAX - SS.RAYMIN);
      mc._rotation = random(360);
      mc.gotoAndStop((random(4) + 1) + this.btype * 10);
      if (this.btype === 6 && mc.eclat) mc.eclat.gotoAndPlay(random(30) + 1);
      this.stoneList.push(mc);
    }
    this.mc.mask._width = SS.RAYMAX;
    this.mc.mask._height = SS.RAYMAX;
  }

  remove_stones() {
    for (let i = 0; i < this.stoneList.length; i++) this.stoneList[i].removeMovieClip();
  }

  move_stones() {
    const tmod = Std.tmod;
    for (let i = 0; i < this.stoneList.length; i++) {
      const mc = this.stoneList[i];
      mc.dx = mc.dx + this.sx * 10 * tmod;
      mc.dy = mc.dy + this.sy * 10 * tmod;
      if (mc.dx > 628) mc.dx -= 628;
      if (mc.dx < 0) mc.dx += 628;
      if (mc.dy > 628) mc.dy -= 628;
      if (mc.dy < 0) mc.dy += 628;
      const cs = Math.cos(mc.dx / 100);
      const sn = Math.sin(mc.dy / 100);
      mc._x = cs * mc.rayon / 2;
      mc._y = sn * mc.rayon / 2;
      const xc = Math.cos((mc.dx + 157) / 100);
      const yc = Math.cos((mc.dy + 157) / 100);
      const max = (mc.rayon / Const.BALL_RAYSIZE) * 50;
      mc._alpha = 50 + (xc + yc) * max;
    }
  }

  update_skin() {
    this.remove_stones();
    this.gen_stones();
    this.mc.gfx.gotoAndStop(this.btype + 1);
  }

  update_jump() {
    const tmod = Std.tmod;
    if (this.jump) {
      this.jump_size += tmod * this.jump_way * 60;
      this.jump_delta = Math.sqrt(this.jump_size * this.speed) / 6;
      this.shadow._y = this.x + Ball.SHADOW_DECAL + this.jump_delta;
      this.mc._xscale = 100 + this.jump_delta * 3;
      this.mc._yscale = 100 + this.jump_delta * 3;
      if (this.jump_size > 200) this.jump_way *= -1;
      else if (this.jump_size < 0) {
        this.jump_delta = 0;
        this.jump = false;
        this.mc._xscale = 100;
        this.mc._yscale = 100;
        if (this.mc.shadow) this.mc.shadow._y = 0;   // pas d'enfant « shadow » : rien, comme en AS2
        this.last_jump = true;
      }
    }
  }

  update_hole() {
    if (!this.hole_death) return false;
    this.sx *= 0.9;
    this.sy *= 0.9;
    this.mc._xscale *= Math.pow(0.92, Std.tmod * this.hole_death_speed);
    this.mc._yscale *= Math.pow(0.92, Std.tmod * this.hole_death_speed);
    this.mc._x += this.sx / 5;
    this.mc._y += this.sy / 5;
    if (this.mc._xscale < 3) {
      this.hole_death = false;
      this.mc.setMask(null);
      if (this.classic_mask) this.classic_mask.removeMovieClip();
      if (this.hole_mask) this.hole_mask.removeMovieClip();
      if (J.Manager.play_mode === Const.MODE_CLASSIC && !this.death_hit) {
        const game = this.game;
        game.curtime += Const.TIME_CLASSIC_EXTENDED;
        this.x = game.level.exit.clip._x;
        this.y = game.level.exit.clip._y + Const.LVL_HEIGHT;   // la salle défilera vers le bas
        game.level.pos_y = random(game.level.height) - 1;
        game.level.pos_x++;
        this.sx = 0;
        this.sy = 0;
        this.mc._xscale = 100;
        this.mc._yscale = 100;
        this.mc._x = this.x;
        this.mc._y = this.y;
        this.shadow._visible = true;
        this.shadow._x = this.x;
        this.shadow._y = this.y;
      } else this.kill();
    }
    return true;
  }

  update() {
    const tmod = Std.tmod;
    const game = this.game;
    if (this.clign_count > 0) {
      this.clign_count -= tmod * 1000 / 40;
      this.clign_flag = !this.clign_flag;
      this.mc._alpha = this.clign_flag ? 30 : 60;
      if (this.clign_count <= 0) this.mc._alpha = 100;
    }

    // LES TOUCHES
    let dx = 0, dy = 0;
    if (this.control && !this.jump) {
      if (Key.isDown(Key.DOWN)) dy++;
      if (Key.isDown(Key.UP)) dy--;
      if (Key.isDown(Key.LEFT)) dx--;
      if (Key.isDown(Key.RIGHT)) dx++;
    }

    // LE MOUVEMENT
    let speed_coef = 0.6;
    let inertia = 0.95;
    this.maxspeed = 20;
    switch (this.btype) {
      case 3:   // ORANGE
        speed_coef = 2.1;
        inertia = 0.85;
        break;
      case 2:   // ROUGE
        speed_coef = 0.6;
        inertia = 0.95;
        for (let i = 0; i < game.level.bonus.length; i++) {
          const b = game.level.bonus[i];
          if (b && b.bname === 'red') {
            const d = Tools.dist2(this.mc, b.clip);
            if (d < 40000) {
              b.clip._x += (this.mc._x - b.clip._x) * 150 * tmod / d;
              b.clip._y += (this.mc._y - b.clip._y) * 150 * tmod / d;
            }
          }
        }
        break;
      case 5:   // METAL
        this.maxspeed = 7;
        speed_coef = 0.2;
        inertia = 0.98;
        break;
      default:
        speed_coef = 0.85;
        inertia = 0.94;
        break;
    }

    if (this.water) {
      inertia = 0.98;
      speed_coef *= 2;
    }

    if (dx !== 0 && dy !== 0) {
      const sq2 = Math.sqrt(2);
      dx /= sq2;
      dy /= sq2;
    }

    this.sx *= Math.pow(inertia, tmod);
    this.sy *= Math.pow(inertia, tmod);
    if (Math.abs(this.sx) < 0.1) this.sx = 0;
    if (Math.abs(this.sy) < 0.1) this.sy = 0;

    this.sx += speed_coef * dx * tmod;
    this.sy += speed_coef * dy * tmod;
    this.speed = Math.sqrt(this.sx * this.sx + this.sy * this.sy);
    if (this.max_speed_enabled && this.speed > this.maxspeed) {
      if (this.speed > 3 * this.maxspeed) {
        this.speed /= 3;
        this.sx /= 3;
        this.sy /= 3;
      }
      this.speed *= Math.pow(0.8, tmod);
      this.sx *= Math.pow(0.8, tmod);
      this.sy *= Math.pow(0.8, tmod);
    }

    // LES COLLISIONS
    dx = this.sx * tmod;
    dy = this.sy * tmod;
    const ncol = 1 + int(Math.sqrt(dx * dx + dy * dy) / Const.DELTA);
    dx /= ncol;
    dy /= ncol;
    let i;
    for (i = 0; i < ncol; i++) {
      this.hole_test();
      const c = game.level.col_test(this.x + dx, this.y + dy, true);
      if (c) {
        this.col_count++;
        break;
      }
      this.x += dx;
      this.y += dy;
    }
    if (i === ncol) this.col_count = 0;
    else if (this.col_count >= 20) {
      this.sx = 0;
      this.sy = 0;
      this.recall();
    }

    this.mc._x = this.x + Const.DELTA / 2;
    this.mc._y = this.y + Const.DELTA / 2 - this.jump_delta;
    this.shadow._x = this.mc._x + Ball.SHADOW_DECAL;
    this.shadow._y = this.mc._y + Ball.SHADOW_DECAL;
    this.move_stones();
  }

  // Coincée : une case libre en spirale, huit directions par rayon.
  recall() {
    for (let ray = 1; ray < 30; ray += 2) {
      for (let a = 0; a < 8; a++) {
        const ang = a * Math.PI / 4;
        const dx = Math.cos(ang) * ray;
        const dy = Math.sin(ang) * ray;
        if (!this.game.level.col_test(this.x + dx, this.y + dy, false)) {
          this.x += dx;
          this.y += dy;
          return;
        }
      }
    }
  }

  hole_test() {
    const interf = this.game.level.interf;
    const dx = int((int(this.x / Const.DELTA) - Const.BORDER_CSIZE) / 10);
    const dy = int((int(this.y / Const.DELTA) - Const.BORDER_CSIZE) / 10);
    if (interf.typeMur(dx, dy) === 7 && !this.jump) {   // TROU
      const px = ((dx + 0.5) * 10 + Const.BORDER_CSIZE) * Const.DELTA;
      const py = ((dy + 0.5) * 10 + Const.BORDER_CSIZE) * Const.DELTA;
      const delt = 5 * Const.DELTA;
      let d = 0;

      this.sx *= 1.1;
      this.sy *= 1.1;
      this.speed *= 1.1;

      if (this.x < px && interf.typeMur(dx - 1, dy) !== 7) d |= 1;
      else if (this.x > px && interf.typeMur(dx + 1, dy) !== 7) d |= 2;
      if (this.y < py && interf.typeMur(dx, dy - 1) !== 7) d |= 4;
      else if (this.y > py && interf.typeMur(dx, dy + 1) !== 7) d |= 8;
      if (d === 15) d = 0;
      if (d & 1) this.sx++;
      if (d & 2) this.sx--;
      if (d & 4) this.sy++;
      if (d & 8) this.sy--;

      if (this.x > (px - delt + ((d & 1) ? Const.BALL_RAYSIZE : 0))
        && this.x < (px + delt - ((d & 2) ? Const.BALL_RAYSIZE : 0))
        && this.y > (py - delt + ((d & 4) ? Const.BALL_RAYSIZE : 0))
        && this.y < (py + delt - ((d & 8) ? Const.BALL_RAYSIZE : 0))) {
        this.hole_mask = Std.duplicateMC(interf.holes, Const.HOLE_PLAN * 5000 - 1);
        this.mc.setMask(this.hole_mask);
        this.shadow._visible = false;
        this.clign_count = 0;
        this.hole_death_speed = 1;
        this.death_hit = false;
        this.hole_death = true;
        return;
      } else if (this.btype === 4 && !this.last_jump) {   // BLEUE
        this.jump = true;
        this.jump_way = 1;
        this.jump_size = 0;
        this.jump_delta = 0;
        return;
      }
    } else if (this.last_jump) this.last_jump = false;
  }

  die() {
    if (this.clign_count > 0) return;
    if (!this.hole_death) {
      this.mc._alpha = 100;
      this.hole_death = true;
      this.death_hit = true;
      this.hole_death_speed = 5;
      this.shadow._visible = false;
      this.sx = 0;
      this.sy = 0;
    }
  }

  kill() {
    const game = this.game;
    this.sx = 0;
    this.sy = 0;
    this.x = this.start_x;
    this.y = this.start_y;
    this.mc._xscale = 100;
    this.mc._yscale = 100;
    this.mc._x = this.x;
    this.mc._y = this.y;
    this.mc._visible = true;
    this.mc._alpha = 100;
    this.shadow._visible = true;
    this.shadow._x = this.x;
    this.shadow._y = this.y;
    if (J.Manager.play_mode !== Const.MODE_AIDE) {
      if (this.btype !== 0 || J.Manager.play_mode !== Const.MODE_COURSE) {
        game.options.ball_types[this.btype]--;
        game.options.ball_types_chk--;
      }
    }
    this.clign_count = 400;
    this.clign_flag = true;
    const last = this.btype;
    while (!(game.options.ball_types[this.btype] > 0)) {
      this.btype++;
      this.btype %= 7;
      if (this.btype === last) {
        game.options.update_icons();
        this.shadow._visible = false;
        this.mc._visible = false;
        game.gameOver(Const.CAUSE_NOBALLS);
        return;
      }
    }
    game.options.update_icons();
    this.update_skin();
  }
}
Ball.STONE_STYLE = [
  { MAX: 6, RAYMIN: 10, RAYMAX: 20 },    // JAUNE
  { MAX: 20, RAYMIN: 0, RAYMAX: 20 },    // VERTE
  { MAX: 4, RAYMIN: 14, RAYMAX: 14 },    // ROUGE
  { MAX: 10, RAYMIN: 0, RAYMAX: 12 },    // ORANGE
  { MAX: 10, RAYMIN: 6, RAYMAX: 20 },    // BLEUE
  { MAX: 0, RAYMIN: 0, RAYMAX: 20 },     // METAL
  { MAX: 20, RAYMIN: 0, RAYMAX: 20 },    // VIOLET
];
Ball.SHADOW_DECAL = 3;
J.Ball = Ball;

// ── Options ───────────────────────────────────────────────────────────────
class Options {
  constructor(game, nballs) {
    this.game = game;
    this.ball_types = [];
    this.ball_flags = [];
    for (let i = 0; i < 7; i++) this.ball_types[i] = 0;
    this.ball_types[0] = nballs;
    this.ball_types_chk = nballs;
    this.cur_ball = 0;
    this.icons = [];
    this.grelots = [];
    this.has_map = false;
    this.has_radar = false;
    this.grelot_count = 0;
  }

  update_icons() {
    if (J.Manager.play_mode === Const.MODE_CLASSIC) return;
    const game = this.game;
    let x = 585;
    let bsum = 0;
    this.clean_icons();
    for (let i = 6; i >= 0; i--) {
      bsum += this.ball_types[i];
      for (let n = 0; n < this.ball_types[i]; n++) {
        const ico = game.dmanager.attach('ball icon', Const.ICON_PLAN);
        this.icons.push(ico);
        ico._x = x;
        ico._y = 390;
        if (ico.ball) ico.ball.gotoAndStop(i + 1);
        if (game.ball.btype === i && n === this.ball_types[i] - 1) ico.gotoAndStop('on');
        else ico.gotoAndStop('select');
        x -= 25;
      }
    }

    if (bsum !== this.ball_types_chk) J.Manager.error();

    if (this.grelots.length < this.grelot_count) {
      let xx = 575 - 25 * this.grelots.length;
      while (this.grelots.length < this.grelot_count) {
        const ico = game.dmanager.attach('icon grelot', Const.ICON_PLAN);
        this.grelots.push(ico);
        ico._x = xx;
        ico._y = 355;
        xx -= 25;
      }
    } else {
      while (this.grelots.length > this.grelot_count) {
        const g = this.grelots[this.grelots.length - 1];
        g.gotoAndPlay('hit');
        remove(this.grelots, g);
      }
    }
  }

  clean_icons() {
    for (let i = 0; i < this.icons.length; i++) this.icons[i].removeMovieClip();
    this.icons = [];
    // les grelots ne sont pas nettoyés (comme en 2005)
  }
}
J.Options = Options;

})(typeof window !== 'undefined' ? window : globalThis);
