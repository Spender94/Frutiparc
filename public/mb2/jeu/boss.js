/*
 * MotionBall — les BOSS : le poulpe du Challenge (Boss.as), le serpent des
 * quatre premiers donjons (BossSerpent.as) et ses pouvoirs élémentaires
 * (BossPowVent, BossPowFeu, BossPowEau, BossPowTerre), la Tourneboule du
 * cinquième (BossTB.as). Traduction ligne à ligne.
 *
 * Un boss est un objet `game.boss_update` à qui Game.main confie un
 * `on_update` par image (et la Tourneboule un `onPause`). Il finit la partie
 * lui-même : `game.gameOver(CAUSE_WINS)` quand sa mort est jouée.
 *
 * Gardés du silence de l'AS2 : `mc.souffle` n'existe qu'à partir de l'image
 * « aspire » du poulpe (avant, ses échelles partaient dans le vide), et une
 * dalle découpée est reconnue « retirée » par son clip sans parent (Flash :
 * `!mc._name`).
 */
'use strict';

(function (racine) {

const K = racine.KalugaMoteur;
const J = racine.Mb2Jeu;
const { Const, Tools, Std, random, int, remove } = J;
const Sound = J.Sound;

// ── Le poulpe ─────────────────────────────────────────────────────────────
class Boss {
  constructor(game) {
    this.mc = game.dmanager.attach('boss', Const.BOSS_PLAN);
    this.mc._alpha = 0;
    this.mc.control = this;
    this.shade = game.dmanager.attach('boss shade', Const.SHADE_PLAN);
    this.shade._alpha = 0;
    this.px = Const.LVL_WIDTH / 2;
    this.py = Const.LVL_HEIGHT / 2;
    this.hits = 0;
    this.pat_jmp = false;
    this.wait = 5;
    this.change_pattern = true;
    this.color = new K.Color(this.mc);
    this.game = game;
    this.collide = false; this.hit_time = 0; this.ang = 0; this.dodo = false;
    this.jump_pos = 0; this.jump_time = 0; this.jump_speed = 0; this.jump_size = 0; this.jump_casse = 0; this.njumps = 0;
    this.ang_speed = 0; this.aspire_time = 0; this.eat_done = false; this.do_tir = false; this.tir = null; this.speed = 0;
    this.next_frame = undefined;
    this.particules = [];
    this.on_update();
    this.particules = [];
    game.ball.max_speed_enabled = false;
    this.mc.gotoAndStop('dodo');
    this.dodo = true;
    Sound.play(Sound.POULPE);
  }

  // Une dalle du sol se casse : un trou de plus, tiré au sort depuis un bord.
  casse() {
    const game = this.game;
    const wt = game.level.interf.walltable;
    let px;
    let py = 8;
    if (random(2) === 0) px = 0;
    else px = 13;
    const b = wt[px][py];
    for (;;) {
      if (wt[px][py] == null) break;
      switch (random(4)) {
        case 0: if (px > 0) px--; break;
        case 1: if (py > 0) py--; break;
        case 2: if (px < 13) px++; break;
        case 3: if (py < 8) py++; break;
        default: break;
      }
    }
    wt[px][py] = b;
    game.level.interf.update_walls();

    const dmc = game.dmanager.attach('dalle', Const.BONUS_PLAN);
    dmc._x = px * 10 * Const.DELTA + Const.BORDER_SIZE;
    dmc._y = py * 10 * Const.DELTA + Const.BORDER_SIZE;
  }

  death() {
    const game = this.game;
    Sound.play(Sound.POULPE);
    this.mc.gotoAndPlay('death');
    for (let j = 0; j < 3; j++) {
      for (let i = 0; i < 8; i++) {
        const p = game.dmanager.attach('bossParticule', Const.BOSS_PLAN);
        p._x = this.mc._x;
        p._y = this.mc._y;
        p.ang = (i / 8) * Math.PI * 2 + j * 0.5;
        p.dist = 0;
        p.speed = (j + 1) * 2.5;
        p.scale = 200 + j * 50;
        this.particules.push(p);
      }
    }
    game.ball.sx = 0;
    game.ball.sy = 0;
    game.ball.speed = 0;
    game.ball.control = false;
    game.can_loose = false;
    this.shade._visible = false;
    this.wait = 0xFFFFF;
  }

  move_particules() {
    const game = this.game;
    if (this.particules.length > 0) {
      for (let i = 0; i < this.particules.length; i++) {
        const p = this.particules[i];
        p.ang += Std.tmod * 0.1 * p.speed / 5;
        p.dist += Std.tmod * p.speed;
        p._x = this.mc._x + Math.cos(p.ang) * p.dist;
        p._y = this.mc._y + Math.sin(p.ang) * p.dist;
        p.scale -= Std.tmod * 5;
        p._xscale = p.scale;
        p._yscale = p.scale;
        if (p._x < -p._width || p._y < -p._height || p._x > Const.LVL_WIDTH + p._width || p._y > Const.LVL_HEIGHT + p._height || p.scale <= 0) {
          p.removeMovieClip();
          this.particules.splice(i, 1);
          i--;
        }
      }
      if (this.particules.length === 0) {
        game.boss_update = null;
        game.gameOver(Const.CAUSE_WINS);
      }
    }
  }

  on_update() {
    const game = this.game, mc = this.mc, shade = this.shade;
    const tmod = Std.tmod;
    this.move_particules();
    this.move_eye();

    if (mc._alpha < 100) {
      mc._alpha += 10 * Std.tmod;
      shade._alpha += 10 * Std.tmod;
      if (mc._alpha >= 100) {
        mc._alpha = 100;
        shade._alpha = 100;
      }
    }

    if (this.wait > 0) {
      this.wait -= tmod / 25;
      mc._x = this.px;
      mc._y = this.py;
      shade._x = this.px;
      shade._y = this.py;
      if (this.collide) this.do_collide();
      if (this.dodo && this.wait <= 3) {
        this.dodo = false;
        mc.gotoAndStop('normal');
        if (mc.oeil) mc.oeil.gotoAndPlay('close');
      }
      if (this.wait <= 0) {
        mc.gotoAndPlay(this.next_frame);
        this.wait = 0;
      }
      return;
    }

    if (this.hit_time > 0) {
      const a = 100 - 10 * this.hits;
      this.hit_time -= tmod / 25;
      if (this.hit_time <= 0) {
        this.color.setTransform({ ra: a, rb: 40 * this.hits, ba: a, bb: 0, ga: a, gb: 0, aa: 100, ab: 0 });
        if (this.hits >= 4) {
          this.death();
          return;
        }
      } else {
        this.color.setTransform({ ra: a, rb: 60 * this.hits + this.hit_time * 100, ba: a, bb: 0, ga: a, gb: 0, aa: 100, ab: 0 });
      }
      return;
    }
    if (this.change_pattern) {
      this.change_pattern = false;
      this.do_change_pattern();
      return;
    }
    if (this.njumps > 0) {
      this.jump_time += Std.deltaT;
      this.jump_pos = this.jump_size * Math.sin(this.jump_time * this.jump_speed / this.jump_size);
      if (this.jump_pos < 10) this.do_collide();
      if (this.jump_pos < 0) {
        this.jump_pos = 0;
        this.jump_time = 0;
        this.njumps--;
        while (this.jump_casse-- > 0) {
          Sound.play(Sound.CASSE);
          this.casse();
        }
        if (this.njumps === 0) {
          this.do_change_pattern();
          return;
        }
        Sound.play(Sound.BOSS_JUMP);
      }
    }
    if (this.ang_speed !== 0) {
      const bang = Math.atan2(game.ball.y - this.py, game.ball.x - this.px);
      const adif = Tools.rad_dif(this.ang, bang);
      if (Math.abs(adif) > this.ang_speed) {
        if (adif < 0) this.ang -= this.ang_speed * tmod;
        else this.ang += this.ang_speed * tmod;
      } else this.ang = bang + (random(3) - 1) / 100;
      this.px += Math.cos(this.ang) * this.speed * tmod;
      this.py += Math.sin(this.ang) * this.speed * tmod;
      mc._x = this.px;
      mc._y = this.py - this.jump_pos;
      if (mc.b) mc.b.gotoAndStop(Math.max(1, Math.round(this.jump_pos / 5)));
      shade._x = this.px;
      shade._y = this.py;
      shade._xscale = 100 + this.jump_pos / 3;
      shade._yscale = 100 + this.jump_pos / 3;
      let whit = false;
      if (this.px < Const.BOSS_MIN_X) { this.px = Const.BOSS_MIN_X; whit = true; }
      if (this.py < Const.BOSS_MIN_Y) { this.py = Const.BOSS_MIN_Y; whit = true; }
      if (this.px > Const.LVL_WIDTH - Const.BOSS_MIN_X) { this.px = Const.LVL_WIDTH - Const.BOSS_MIN_X; whit = true; }
      if (this.py > Const.LVL_HEIGHT - Const.BOSS_MAX_Y) { this.py = Const.LVL_HEIGHT - Const.BOSS_MAX_Y; whit = true; }
      if (whit) this.ang += Math.PI * 3 / 4 + random(45) * Math.PI / 180;
    }
    if (!game.ball.hole_death && this.aspire_time > 0) {
      this.aspire_time -= tmod / 25;
      const d = Tools.dist2(game.ball.mc, mc);
      if (d < 500) {
        game.ball.control = false;
        game.ball.sx = 0;
        game.ball.sy = 0;
        game.ball.x = this.px;
        game.ball.y = this.py + 22;
        this.aspire_time = 0;
        mc.gotoAndPlay('eat');
        this.wait = 1;
        this.collide = false;
        this.next_frame = 'throw';
        this.eat_done = true;
        return;
      }
      // les pinces s'ouvrent
      let c = Math.pow(0.6, tmod);
      if (mc.b && mc.b.p1 && mc.b.p2) {
        mc.b.p1._rotation = mc.b.p1._rotation * c + 45 * (1 - c);
        mc.b.p2._rotation = mc.b.p2._rotation * c - 45 * (1 - c);
      }
      // la taille du souffle (le clip n'existe qu'à partir de l'image « aspire »)
      c = Math.pow(0.95, tmod);
      if (mc.souffle) {
        const scale = mc.souffle._xscale * c + (100 + (this.hits * 20)) * (1 - c);
        mc.souffle._xscale = scale;
        mc.souffle._yscale = scale;
      }
      const dx = (this.px - game.ball.mc._x) / d;
      const dy = (this.py - game.ball.mc._y) / d;
      game.ball.sx += dx * (120 + this.hits * 20) * tmod;
      game.ball.sy += dy * (120 + this.hits * 20) * tmod;
      if (this.aspire_time <= 0) {
        this.do_change_pattern();
        return;
      }
    } else if (this.eat_done) {
      const ang = (random(100) + 40) * Math.PI / 180;
      game.ball.sx = 60 * Math.cos(ang);
      game.ball.sy = 60 * Math.sin(ang);
      game.ball.control = true;
      this.eat_done = false;
      this.wait = 0.5;
      this.change_pattern = true;
      return;
    } else {
      // les pinces se referment
      const c = Math.pow(0.6, tmod);
      if (mc.b && mc.b.p1 && mc.b.p2) {
        mc.b.p1._rotation = mc.b.p1._rotation * c;
        mc.b.p2._rotation = mc.b.p2._rotation * c;
      }
    }

    if (this.do_tir) {
      if (this.tir == null) {
        Sound.play(Sound.BOSS_EYE);
        mc.gotoAndPlay('looseEye');
        const tir = this.tir = game.dmanager.attach('boss tir', Const.BOSS_PLAN);
        tir.px = this.px;
        tir.py = this.py - 10;
        tir.activated = false;
        const a = 100 - 10 * this.hits;
        new K.Color(tir).setTransform({ ra: a, rb: 40 * this.hits, ba: a, bb: 0, ga: a, gb: 0, aa: 100, ab: 0 });
        const ang = Math.atan2(game.ball.mc._y - (this.py - 100), game.ball.mc._x - this.px);
        const m_speed = 5 + this.hits * 1.5;
        tir.sx = m_speed * Math.cos(ang);
        tir.sy = m_speed * Math.sin(ang);
      }
      const tir = this.tir;
      let d = Tools.dist2(game.ball.mc, tir);
      if (!game.ball.hole_death && d < 38 * 38) {
        Sound.play(Sound.WALL_HIT);
        d = Math.sqrt(d);
        tir.sx = (7 + this.hits * 1.5) * (tir.px - game.ball.mc._x) / d;
        tir.sy = (7 + this.hits * 1.5) * (tir.py - game.ball.mc._y) / d;
        if (game.ball.speed < 25) game.ball.speed = 25;
        game.ball.sx = game.ball.speed * (game.ball.mc._x - tir.px) / d;
        game.ball.sy = game.ball.speed * (game.ball.mc._y - tir.py) / d;
        tir.activated = true;
      }
      if (tir.activated && Tools.dist2(mc, tir) < 50 * 50) {
        tir.removeMovieClip();
        this.hit_time = 1;
        Sound.play(Sound.BOSS_NEW_EYE);
        mc.gotoAndPlay('newEye');
        Sound.play(Sound.POULPE);
        this.hits++;
        this.do_tir = false;
        return;
      }
      tir.px += tir.sx * tmod;
      tir.py += tir.sy * tmod;
      // (tir.ang n'est jamais posé : ces deux rebonds ne font rien, comme en 2005)
      if (tir.px < Const.BORDER_SIZE * 2 || tir.px > Const.LVL_WIDTH - Const.BORDER_SIZE * 2) tir.ang = Math.PI - tir.ang;
      if (tir.py < Const.BORDER_SIZE * 2 || tir.py > Const.LVL_HEIGHT - Const.BORDER_SIZE * 2) tir.ang *= -1;
      tir._x = tir.px;
      tir._y = tir.py;
      if (tir._x < -30 || tir._y < -30 || tir._x > Const.LVL_WIDTH + 30 || tir._y > Const.LVL_HEIGHT + 30) {
        Sound.play(Sound.BOSS_NEW_EYE);
        mc.gotoAndPlay('newEye');
        tir.removeMovieClip();
        this.tir = null;
        this.do_tir = false;
        return;
      }
      this.do_collide();
    }
  }

  do_collide() {
    const game = this.game;
    const dist = (game.ball.x - this.px) * (game.ball.x - this.px) + (game.ball.y - this.py) * (game.ball.y - this.py) * 2;
    if (dist < 2000) {
      const ang = Math.atan2(game.ball.y - this.py, game.ball.x - this.px);
      game.ball.sx += 30 * Math.cos(ang);
      game.ball.sy += 30 * Math.sin(ang);
      Sound.play(Sound.WALL_HIT);
    }
  }

  do_change_pattern() {
    this.collide = true;
    this.pat_jmp = !this.pat_jmp;
    this.jump_pos = 0;
    this.jump_casse = 0;
    this.jump_time = 0;
    this.njumps = 0;
    this.ang_speed = 0;
    this.do_tir = false;
    this.wait = 0;
    this.aspire_time = 0;
    this.hit_time = 0;
    if (this.pat_jmp) {
      this.jump_speed = 300;
      this.njumps = 3 + this.hits * 2;
      Sound.play(Sound.BOSS_JUMP);
      if (this.hits === 3) {
        this.njumps *= 5;
        this.hits++;
      }
      this.jump_size = 75 - this.hits * 10;
      this.ang_speed = 0.1 + 0.02 * this.hits;
      this.speed = 2 + this.hits * 1.5;
      this.mc.gotoAndStop('normal');
    } else {
      if (this.hits >= 4) {
        this.hit_time = 1;
        return;
      }
      switch (random(8)) {
        case 0:
        case 1:
          this.jump_casse = 1 + random(3);
          this.jump_speed = 1500;
          this.jump_size = 300;
          this.njumps = 1;
          Sound.play(Sound.BOSS_JUMP);
          this.ang_speed = 0.1 + 0.02 * this.hits;
          this.speed = 10;
          this.mc.gotoAndStop('normal');
          break;
        case 4:
          this.wait = 0.5;
          this.change_pattern = true;
          Sound.play(Sound.POULPE);
          break;
        case 2:
        case 3:
          this.wait = 1 + random(100) / 100;
          this.next_frame = 'aspire';
          this.aspire_time = 2 + 0.5 * this.hits;
          break;
        default:
          this.wait = 0.7 + random(50) / 50;
          this.next_frame = 'tir';
          this.do_tir = true;
          this.tir = null;
          break;
      }
    }
  }

  move_eye() {
    const mc = this.mc, oeil = mc.oeil;
    if (!oeil || !oeil.p) return;   // (l'œil n'a pas encore sa pupille : rien, comme en AS2)
    // la pupille suit la bille
    const difx = this.game.ball.mc._x - mc._x;
    const dify = this.game.ball.mc._y - mc._y;
    const a = Math.atan2(dify, difx);
    const x = Math.cos(a) * 28;
    const y = Math.sin(a) * 7 + 8 * Math.abs(Math.sin(a));
    const c = 0.9;
    oeil.p._x = oeil.p._x * c + x * (1 - c);
    oeil.p._y = oeil.p._y * c + y * (1 - c);
    oeil.p._xscale = 100 - Math.abs(oeil.p._x);
    oeil.p._yscale = 100 - Math.abs(oeil.p._y) * 1.5;
    // la paupière (mc.dodo n'existe pas sur le clip : la condition se réduit au hasard, comme en 2005)
    if (!mc.dodo && !random(40)) oeil.play();
  }
}
J.Boss = Boss;

// ── Le serpent ────────────────────────────────────────────────────────────
class BossSerpent {
  constructor(game) {
    const lbg = game.dmanager.attach('logoBg', Const.BG_PLAN);
    this.elt = J.Manager.play_mode_param + 1;
    lbg.gotoAndStop(this.elt);

    this.game = game;
    this.powers = [];
    this.ecailles = [];
    this.power = 3;
    this.dying = false;
    this.excite = 0;
    this.target_speed = 0;
    this.berserk_time = 0;
    this.speed = 0;
    this.ang = 0;
    this.rot_ang = 0;
    this.x = Const.LVL_WIDTH / 2;
    this.y = Const.LVL_HEIGHT / 2;
    this.timer = 0; this.state = 0; this.accel = 1.05; this.delta = 0.03; this.hit = false;
    this.initSerpent();
    this.change_pattern();
    this.setExcite(false);
    for (let i = 0; i < 5; i++) this.on_update();
  }

  updateScales() {
    for (let i = 1; i < this.parts.length - 1; i++) {
      const s = 1 - (i / this.parts.length);
      const p = this.parts[i];
      p._xscale = s * 100;
      p._yscale = s * 100;
      p.ray = s * 50;
      p.rsq = (p.ray + Const.BALL_RAYSIZE / 2) * (p.ray + Const.BALL_RAYSIZE / 2);
    }
  }

  initSerpent() {
    this.parts = [];
    this.smc = this.game.dmanager.empty(Const.BOSS_PLAN);
    const NHITS = BossSerpent.NHITS;
    for (let i = 0; i < NHITS + 2; i++) {
      const p = Std.attachMC(this.smc, 'snake', NHITS + 2 - i);
      if (i === 0) {
        p.gotoAndStop(1);
        if (p.crane) p.crane.gotoAndStop(this.elt);
        p.ray = 20;
      } else if (i === NHITS + 2 - 1) {
        p.gotoAndStop(3);
        p.ray = 25;
      } else p.gotoAndStop(2);
      p.ang = this.ang;
      if (p.gfx) p.gfx.gotoAndStop(this.elt);
      p.rsq = (p.ray + Const.BALL_RAYSIZE / 2) * (p.ray + Const.BALL_RAYSIZE / 2);
      this.parts.push(p);
    }
    this.updateScales();
    this.histo = [];
    this.histo.push({ x: this.x, y: this.y, a: this.ang });
  }

  normalize(a) {
    a %= (Math.PI * 2);
    if (a <= -Math.PI) a += Math.PI * 2;
    else if (a > Math.PI) a -= Math.PI * 2;
    return a;
  }

  toBall() { return Math.atan2(this.game.ball.y - this.y, this.game.ball.x - this.x); }

  recall() {
    this.hit = false;
    const d = 60;
    if (this.x < Const.BOSS_MIN_X + d) { this.x = Const.BOSS_MIN_X + d; this.hit = true; }
    if (this.y < Const.BOSS_MIN_Y + d) { this.y = Const.BOSS_MIN_Y + d; this.hit = true; }
    if (this.x > Const.LVL_WIDTH - Const.BOSS_MIN_X - d) { this.x = Const.LVL_WIDTH - Const.BOSS_MIN_X - d; this.hit = true; }
    if (this.y > Const.LVL_HEIGHT - Const.BOSS_MAX_Y - d) { this.y = Const.LVL_HEIGHT - Const.BOSS_MAX_Y - d; this.hit = true; }
    if (this.hit && this.state !== BossSerpent.ST_RECALL) {
      this.delta = 0.3;
      if (random(2) === 0) this.delta *= -1;
      this.state = BossSerpent.ST_RECALL;
      this.timer = 1;
    }
  }

  setExcite(b) {
    const p = this.parts[0];
    if (!p.o1 || !p.o2) return;
    if (this.berserk_time > 0) {
      p.o1.gotoAndStop(3);
      p.o2.gotoAndStop(3);
    } else {
      p.o1.gotoAndStop(b ? 1 : 2);
      p.o2.gotoAndStop(b ? 1 : 2);
    }
  }

  updateEcailles() {
    for (let i = 0; i < this.ecailles.length; i++) {
      const e = this.ecailles[i];
      e._x += Math.cos(e.ang) * Std.tmod * 10;
      e._y += Math.sin(e.ang) * Std.tmod * 10;
      e._rotation += 5 * Std.tmod;
      e._xscale -= 15 * Std.tmod;
      e._yscale -= 15 * Std.tmod;
      if (e._xscale < 10) {
        remove(this.ecailles, e);
        e.removeMovieClip();
        i--;
      }
    }
  }

  on_update() {
    const game = this.game;
    const tmod = Std.tmod;
    const S = BossSerpent;

    if (this.berserk_time === 0 && this.excite > 0) {
      this.excite -= Std.deltaT;
      if (this.excite <= 0) {
        this.excite = 0;
        this.setExcite(false);
        this.change_pattern();
      }
    }

    if (this.berserk_time > 0 && !game.ball.hole_death) {
      this.berserk_time -= Std.deltaT;
      if (this.berserk_time <= 0) {
        for (let i = 0; i < this.powers.length; i++) this.powers[i].destroy();
        this.dying = true;
      }
    }

    for (let i = 0; i < this.powers.length; i++) this.powers[i].update();
    this.updateEcailles();

    if (this.dying) {
      let cont = false;
      for (let i = 0; i < this.parts.length; i++) {
        const p = this.parts[i];
        p._rotation += 30 * Std.tmod;
        if (p._xscale > 0) {
          p._xscale -= Std.deltaT * 100;
          p._yscale -= Std.deltaT * 100;
          cont = cont || (p._xscale > 0);
        }
      }
      if (!cont) {
        this.smc.removeMovieClip();
        game.boss_update = null;
        game.gameOver(Const.CAUSE_WINS);
      }
      return;
    }

    this.timer -= Std.deltaT;
    if (this.timer <= 0) this.change_pattern();

    if (this.speed > this.target_speed) {
      this.speed *= Math.pow(0.97, tmod);
      if (this.speed < this.target_speed) this.speed = this.target_speed;
    } else if (this.speed < this.target_speed) {
      if (this.speed <= 1) this.speed = 1;
      this.speed *= Math.pow(this.accel, tmod);
      if (this.speed > this.target_speed) this.speed = this.target_speed;
    }

    switch (this.state) {
      case S.ST_WAIT: break;
      case S.ST_SEARCH: {
        const ta = this.toBall();
        const ca = this.normalize(ta - this.ang);
        const da = Math.asin(ca);
        if (da > 0) this.ang += this.delta * tmod;
        else this.ang -= this.delta * tmod;
        break;
      }
      case S.ST_FONCE: break;
      case S.ST_EVADE: {
        const ta = this.toBall() + Math.PI;
        const ca = this.normalize(ta - this.ang);
        const da = Math.asin(ca);
        if (da > 0) this.ang += this.delta * tmod;
        else this.ang -= this.delta * tmod;
        break;
      }
      case S.ST_RECALL:
        this.delta *= Math.pow(0.97, tmod);
        if (Math.abs(this.delta) < 0.1) {
          if (this.delta < 0) this.delta = -0.1;
          else this.delta = 0.1;
        }
        this.ang += this.delta * tmod;
        if (!this.hit) this.change_pattern();
        break;
      default: break;
    }

    let ds = this.speed * Std.tmod;
    this.ang = this.normalize(this.ang);

    if (ds <= 0) {
      this.collide();
      this.histo.push({ x: this.x, y: this.y, a: this.ang });
    }

    while (ds > 0) {
      const s = Math.min(ds, 1);
      ds -= 1;
      this.x += Math.cos(this.ang) * s;
      this.y += Math.sin(this.ang) * s;
      this.recall();
      this.histo.push({ x: this.x, y: this.y, a: this.ang });
      this.collide();
    }

    let p = this.histo.length - 1 + this.parts[0].ray;
    for (let i = 0; i < this.parts.length; i++) {
      const mc = this.parts[i];
      p -= mc.ray;
      mc.pos = this.histo[int(Math.max(p, 0))];
      const dif = this.normalize(mc.pos.a - mc.ang);
      mc.ang += dif * ((this.excite > 0) ? 0.4 : 0.3) * tmod;
      mc._rotation = mc.ang * 180 / Math.PI + 180;
      mc._x = mc.pos.x;
      mc._y = mc.pos.y;
      p -= mc.ray;
    }
  }

  collideBall(n) {
    const game = this.game;
    const p = this.parts[n];
    let dx = p.pos.x - game.ball.x;
    let dy = p.pos.y - game.ball.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d !== 0) {
      dx /= d;
      dy /= d;
    }
    game.ball.sx -= this.power * dx;
    game.ball.sy -= this.power * dy;
    Sound.play(Sound.SERPENT_COLLIDE);
  }

  explode() {
    if (this.parts.length > 2) {
      const p = this.parts[1];
      Sound.play(Sound.SERPENT_HIT);
      for (let i = 0; i < 5; i++) {
        const e = this.game.dmanager.attach('snakePart', Const.BOSS_PLAN);
        const ray = random(p.ray / 2) + p.ray / 2;
        e.gotoAndStop(this.elt);
        e._rotation = random(360);
        e.ang = i * Math.PI / 2.5;
        e._x = p._x + Math.cos(e.ang) * ray;
        e._y = p._y + Math.sin(e.ang) * ray;
        e._xscale = 300;
        e._yscale = 300;
        this.ecailles.push(e);
      }
      remove(this.parts, p);
      this.updateScales();
      p.removeMovieClip();
      this.excite = 1;
      if (this.parts.length === 2) {
        this.berserk_time = 10;
        this.setExcite(true);
      }
      this.change_pattern(BossSerpent.ST_FONCE);
    }
  }

  collide() {
    const game = this.game;
    if (game.ball.hole_death) return false;
    const bx = game.ball.x;
    const by = game.ball.y;
    let p = this.parts[0];
    if (p.hitTest(bx + Const.POS_X, by + Const.POS_Y, true)) {
      if (Math.abs(this.normalize(this.ang - this.toBall())) < 0.3) {
        if (p.crane && p.crane.anim) p.crane.anim.play();
        this.setExcite(true);
        if (this.excite === 0) this.explode();
        this.excite = 6 + random(4);
      }
      this.collideBall(0);
      return true;
    }
    p = this.parts[this.parts.length - 1];
    if (p.hitTest(bx + Const.POS_X, by + Const.POS_Y, true) && game.ball.clign_count <= 0) {
      Sound.play(Sound.BUMPER_DEATH);
      game.ball.die();
      return true;
    }
    for (let i = 1; i < this.parts.length; i++) {
      p = this.parts[i];
      if (!p.pos) continue;   // pas encore placé (les cinq premières mises à jour) : NaN en AS2, jamais « < rsq »
      const dx = bx - p.pos.x;
      const dy = by - p.pos.y;
      if (dx * dx + dy * dy < p.rsq) {
        this.collideBall(i);
        return true;
      }
    }
    return false;
  }

  change_pattern(s) {
    const S = BossSerpent;
    const is_excite = (this.excite > 0) || (this.berserk_time > 0);
    if (s !== undefined) this.state = s;
    else this.state = Std.randomProbas(S.STATE_PROBAS[is_excite ? 0 : 1]);
    this.accel = 1.05;
    this.delta = is_excite ? 0.05 : 0.03;
    switch (this.state) {
      case S.ST_WAIT:
        this.timer = 0.5;
        this.target_speed = 0;
        break;
      case S.ST_SEARCH:
        this.timer = 1 + random(100) / 100;
        this.target_speed = 5;
        break;
      case S.ST_FONCE:
        this.accel = 1.15;
        this.timer = 0.5;
        this.ang = this.toBall();
        this.target_speed = 15;
        break;
      case S.ST_EVADE:
        this.accel = 1.1;
        this.timer = 1 + random(100) / 100;
        this.target_speed = is_excite ? 8 : 4;
        break;
      case S.ST_POWER:
        switch (this.elt) {
          case S.VENT:
            if (this.powers.length < 1) { Sound.play(Sound.POWER_WIND); this.powers.push(new BossPowVent(this.game, this)); }
            break;
          case S.FEU:
            if (this.powers.length < 3) { Sound.play(Sound.POWER_FIRE); this.powers.push(new BossPowFeu(this.game, this)); }
            break;
          case S.EAU:
            if (this.powers.length < 2) { Sound.play(Sound.POWER_WATER); this.powers.push(new BossPowEau(this.game, this)); }
            break;
          case S.TERRE:
            if (this.powers.length < 3) { Sound.play(Sound.POWER_EARTH); this.powers.push(new BossPowTerre(this.game, this)); }
            break;
          default: break;
        }
        this.change_pattern();
        break;
      default: break;
    }
    if (this.berserk_time > 0) {
      this.timer /= 2;
      this.target_speed *= 1.3;
      this.delta *= 2;
    }
  }
}
BossSerpent.STATE_PROBAS = [[1, 5, 2, 2, 5], [2, 0, 0, 10, 2]];
BossSerpent.NHITS = 3;
BossSerpent.EAU = 1; BossSerpent.FEU = 2; BossSerpent.VENT = 3; BossSerpent.TERRE = 4;
BossSerpent.ST_WAIT = 0; BossSerpent.ST_SEARCH = 1; BossSerpent.ST_FONCE = 2; BossSerpent.ST_EVADE = 3; BossSerpent.ST_POWER = 4; BossSerpent.ST_RECALL = 5;
J.BossSerpent = BossSerpent;

// ── La Tourneboule ────────────────────────────────────────────────────────
class BossTB {
  constructor(game) {
    this.game = game;
    this.powers = [];
    this.dalles = [];
    this.x = Const.LVL_WIDTH / 2;
    this.y = Const.LVL_HEIGHT / 2;
    this.timer = 0; this.state = 0; this.accel = 1.05; this.fly_loops = 0;
    this.tx = this.x; this.ty = this.y;
    this.pause = false; this.pause_action = null;
    this.nkatas = 0; this.prev_kata = undefined; this.target_power = 0; this.bulle_active = false;
    this.initTB();
    this.on_update();
  }

  initTB() {
    const game = this.game;
    this.tb = true;
    this.mc = game.dmanager.attach('tourneboule', Const.BOSS_PLAN);
    this.bulle = game.dmanager.attach('forceBubble', Const.BOSS_PLAN);
    this.shade = game.dmanager.attach('TBShadow', Const.SHADE_PLAN);
    this.shade.gotoAndPlay('stopFly');
    this.mc.gotoAndPlay('stopFly');
    this.color = new K.Color(this.mc);
    this.hit_time = 0;
    this.state = BossTB.ST_APPEAR;
    this.speed = 0;
    this.ncasses = 0;
    this.nblocks = 0;
    this.hits = 0;
    this.target_speed = 0;
    this.bulle._visible = false;
    this.mc.animDone = () => { this.animDone(); };
    this.mc.kataDone = () => { this.kataDone(); };
  }

  fly() {
    this.mc.gotoAndPlay('startFly');
    this.shade.gotoAndPlay('startFly');
    this.state = BossTB.ST_FLYING;
    this.fly_loops = Math.round(3 / Std.tmod);
  }

  move() {
    Sound.play(Sound.TB_HIDE);
    const fx = this.game.dmanager.attach('TBVanish', Const.BOSS_PLAN);
    fx._x = this.mc._x;
    fx._y = this.mc._y;
    this.mc.gotoAndPlay('flyVanish');
    this.shade.gotoAndPlay('flyVanish');
    this.state = BossTB.ST_MOVING;
    this.accel = 1.05;
    this.target_speed = 10 + random(3);
    for (;;) {
      this.tx = 50 + random(Const.LVL_WIDTH - 100);
      this.ty = 50 + random(Const.LVL_HEIGHT - 100);
      const dx = this.x - this.tx;
      const dy = this.y - this.ty;
      if (Math.sqrt(dx * dx + dy * dy) > 200) break;
    }
  }

  moveDone() {
    const fx = this.game.dmanager.attach('TBSpawn', Const.BOSS_PLAN);
    this.mc.stop();
    fx._x = this.mc._x;
    fx._y = this.mc._y;
    fx.animDone = () => { this.animDone(); };
    this.state = BossTB.ST_COMEBACK;
  }

  visibleDone() {
    Sound.play(Sound.TB_HIDE);
    this.mc.gotoAndPlay('stopFly');
    this.shade.gotoAndPlay('stopFly');
    this.speed = 0;
    this.target_speed = 0;
    this.state = BossTB.ST_DROPING;
    this.mc._alpha = 100;
    this.shade._alpha = 100;
    this.mc._visible = true;
    this.shade._visible = true;
  }

  wait() {
    this.bulle_active = true;
    this.mc.gotoAndStop(1);
    this.shade.gotoAndStop(1);
    this.state = BossTB.ST_WAITING;
    switch (this.hits) {
      case 0: this.timer = 0.5; break;
      case 1: this.timer = 0.2; break;
      case 2: this.timer = 0.1; break;
      default: this.timer = 0; break;
    }
  }

  kataDone() {
    if (this.nkatas !== 0) return;
    const game = this.game;
    switch (this.target_power) {
      case 0: {
        Sound.play(Sound.POWER_WIND);
        this.powers.push(new BossPowVent(game, this));
        const p = new BossPowVent(game, this);
        p.ray = -50;
        this.powers.push(p);
        break;
      }
      case 1: {
        const delta = 80;
        Sound.play(Sound.POWER_FIRE);
        let p;
        if (this.x > delta) { p = new BossPowFeu(game, this); p.mc._x -= 50; p.mc.gotoAndPlay(1 + random(5)); this.powers.push(p); }
        if (this.x < Const.LVL_WIDTH - delta) { p = new BossPowFeu(game, this); p.mc._x += 50; p.mc.gotoAndPlay(1 + random(5)); this.powers.push(p); }
        if (this.y > delta) { p = new BossPowFeu(game, this); p.mc._y -= 50; p.mc.gotoAndPlay(1 + random(5)); this.powers.push(p); }
        if (this.y < Const.LVL_HEIGHT - delta) { p = new BossPowFeu(game, this); p.mc._y += 50; p.mc.gotoAndPlay(1 + random(5)); this.powers.push(p); }
        break;
      }
      case 2: {
        Sound.play(Sound.POWER_WATER);
        let p;
        p = new BossPowEau(game, this); p.ang = Math.PI / 4; this.powers.push(p);
        p = new BossPowEau(game, this); p.ang = 3 * Math.PI / 4; this.powers.push(p);
        p = new BossPowEau(game, this); p.ang = -Math.PI / 4; this.powers.push(p);
        p = new BossPowEau(game, this); p.ang = -3 * Math.PI / 4; this.powers.push(p);
        break;
      }
      case 3:
        Sound.play(Sound.POWER_EARTH);
        this.powers.push(new BossPowTerre(game, this));
        break;
      case 4: {
        const n = random(3) + 1;
        this.ncasses += n;
        for (let i = 0; i < n; i++) {
          const wt = game.level.interf.walltable;
          let px, py;
          do {
            px = random(14);
            py = random(9);
            if ((px === 0 && py === 0) || (px === 13 && py === 0) || (px === 6 && py === 4) || (px === 7 && py === 4) || (px === 6 && py === 5) || (px === 7 && py === 5)) continue;
            if (wt[px][py] == null) break;
          } while (true);   // eslint-disable-line no-constant-condition
          wt[px][py] = { btype: -1 };
          const dmc = game.dmanager.attach('FXDalleCut', Const.BONUS_PLAN);
          dmc._x = px * 10 * Const.DELTA + Const.BORDER_SIZE;
          dmc._y = py * 10 * Const.DELTA + Const.BORDER_SIZE;
          this.dalles.push({ mc: dmc, px, py });
        }
        break;
      }
      case 5: {
        const wt = game.level.interf.walltable;
        let px, py;
        this.nblocks++;
        do {
          px = random(14);
          py = random(9);
          if ((px === 0 && py === 0) || (px === 13 && py === 0) || (px === 6 && py === 4) || (px === 7 && py === 4) || (px === 6 && py === 5) || (px === 7 && py === 5)) continue;
          if (wt[px][py] == null) break;
        } while (true);   // eslint-disable-line no-constant-condition
        game.level.gen_bumper({ btype: 6, x: px * 10 + Const.BORDER_CSIZE, y: py * 10 + Const.BORDER_CSIZE });
        game.level.interf.update_walls();
        break;
      }
      default: break;
    }
  }

  die() {
    this.mc.gotoAndPlay('death');
    this.shade.gotoAndPlay('death');
    this.state = BossTB.ST_DEATH;
    for (let i = 0; i < this.powers.length; i++) this.powers[i].destroy();
  }

  nextKata() {
    if (this.nkatas === 0) {
      if (this.hits >= 20) this.die();
      else if (this.hits >= BossTB.NHITS) {
        this.hit_time = 1;
        this.hits++;
        this.waitDone();
      } else this.fly();
      return;
    }
    let k, sk;
    if (this.nkatas === 3) k = this.target_power + 1;
    else {
      do { k = random(6) + 1; } while (k === this.prev_kata);
    }
    if (this.nkatas === 1) sk = 4;
    else sk = 1 + random(3);
    Sound.play('kata' + sk);
    this.prev_kata = k;
    this.mc.gotoAndStop('kata' + k);
    this.shade.gotoAndStop('kata' + k);
    this.nkatas--;
    this.state = BossTB.ST_KATA;
  }

  waitDone() {
    const game = this.game;
    this.nkatas = 3;
    for (;;) {
      this.target_power = random(6);
      if (this.hits >= BossTB.NHITS && (this.target_power === 1 || this.target_power === 3)) continue;
      if (this.target_power === 4 && this.ncasses > 20) continue;
      if (this.target_power === 5 && this.nblocks > 20) continue;
      if (this.target_power === 3) {
        const px = int(((this.x / Const.DELTA) - Const.BORDER_CSIZE) / 10);
        const py = int(((this.y / Const.DELTA) - Const.BORDER_CSIZE) / 10);
        if (game.level.interf.typeMur(px, py) === 7) continue;
      }
      break;
    }
    this.timer = 0;
    this.nextKata();
    if (this.hits >= BossTB.NHITS) this.nkatas = 0;
  }

  animDoneReplay() {
    this.mc.play();
    this.shade.play();
    this.animDone();
  }

  animDone() {
    const game = this.game;
    if (game.game_over_flag) {
      this.mc.stop();
      this.shade.stop();
      return;
    }
    if (this.pause) {
      this.pause_action = this.animDoneReplay;
      this.mc.stop();
      this.shade.stop();
      return;
    }
    switch (this.state) {
      case BossTB.ST_APPEAR: this.fly(); break;
      case BossTB.ST_FLYING:
        if (this.fly_loops-- <= 0) this.move();
        else {
          this.mc.gotoAndPlay('fly');
          this.shade.gotoAndPlay('fly');
        }
        break;
      case BossTB.ST_DROPING: this.wait(); break;
      case BossTB.ST_KATA: this.nextKata(); break;
      case BossTB.ST_COMEBACK: this.visibleDone(); break;
      case BossTB.ST_DEATH:
        this.mc.stop();
        this.shade.stop();
        game.boss_update = null;
        game.gameOver(Const.CAUSE_WINS);
        break;
      default: break;
    }
  }

  normalize(a) {
    a %= (Math.PI * 2);
    if (a <= -Math.PI) a += Math.PI * 2;
    else if (a > Math.PI) a -= Math.PI * 2;
    return a;
  }

  toBall() { return Math.atan2(this.game.ball.y - this.y, this.game.ball.x - this.x); }

  onPause(f) {
    this.pause = f;
    if (!this.pause) {
      if (this.pause_action) this.pause_action.call(this);
      this.pause_action = null;
    }
  }

  on_update() {
    const game = this.game, mc = this.mc, shade = this.shade, bulle = this.bulle;
    const tmod = Std.tmod;

    if (this.speed > this.target_speed) {
      this.speed *= Math.pow(0.97, tmod);
      if (this.speed < this.target_speed) this.speed = this.target_speed;
    } else if (this.speed < this.target_speed) {
      if (this.speed <= 1) this.speed = 1;
      this.speed *= Math.pow(this.accel, tmod);
      if (this.speed > this.target_speed) this.speed = this.target_speed;
    }

    for (let i = 0; i < this.powers.length; i++) this.powers[i].update();

    for (let i = 0; i < this.dalles.length; i++) {
      const d = this.dalles[i];
      if (!d.mc._parent) {   // le clip s'est retiré à sa dernière image (Flash : `!d.mc._name`)
        this.dalles.splice(i, 1);
        i--;
        game.level.interf.walltable[d.px][d.py] = game.level.interf.walltable[0][8];
        const dmc = game.dmanager.attach('dalle', Const.BONUS_PLAN);
        dmc._x = d.px * 10 * Const.DELTA + Const.BORDER_SIZE;
        dmc._y = d.py * 10 * Const.DELTA + Const.BORDER_SIZE;
        if (this.dalles.length === 0) {
          Sound.play(Sound.CASSE);
          game.level.interf.update_walls();
        }
      }
    }

    switch (this.state) {
      case BossTB.ST_MOVING: {
        let dx = this.tx - this.x;
        let dy = this.ty - this.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > 0) {
          dx /= d;
          dy /= d;
        }
        const s = Math.min(this.speed * Std.tmod, d);
        this.x += dx * s;
        this.y += dy * s;
        if (game.ball.btype === 6) {
          dx = game.ball.x - this.x;
          dy = game.ball.y - this.y;
          const dball = dx * dx + dy * dy;
          const a = int(200000 / dball);
          mc._alpha = a;
          shade._alpha = a;
          mc._visible = true;
          shade._visible = true;
        } else {
          mc._visible = false;
          shade._visible = false;
        }
        if (s === d && mc._currentframe >= 169 && mc._currentframe <= 177) this.moveDone();
        break;
      }
      case BossTB.ST_KATA:
        this.timer += Math.pow(Std.tmod, 1.3);
        while (this.timer > 1 && this.state === BossTB.ST_KATA) {
          this.timer--;
          mc.nextFrame();
          shade.nextFrame();
        }
        break;
      case BossTB.ST_WAITING:
        this.timer -= Std.deltaT;
        if (this.timer <= 0) this.waitDone();
        break;
      default: break;
    }

    if (this.state === BossTB.ST_WAITING || this.state === BossTB.ST_KATA) this.collide();

    if (bulle._alpha > 0) {
      bulle._alpha -= Std.deltaT * 200;
      if (bulle._alpha < 0) {
        bulle._alpha = 0;
        bulle._visible = false;
      }
    }

    if (this.hit_time > 0) {
      this.hit_time -= Std.deltaT;
      if (this.hit_time < 0) {
        this.hit_time = 0;
        this.color.reset();
      } else {
        this.color.setTransform({ ra: 100, rb: this.hit_time * 300, ba: 100, bb: 0, ga: 100, gb: 0, aa: 100, ab: 0 });
      }
    }

    mc._x = this.x;
    mc._y = this.y;
    shade._x = this.x;
    shade._y = this.y;
    bulle._x = this.x;
    bulle._y = this.y;
  }

  collide() {
    const game = this.game;
    let dx = game.ball.x - this.x;
    let dy = game.ball.y - this.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < 30) {
      if (this.bulle_active) {
        this.bulle._visible = true;
        this.bulle._alpha = 100;
        this.bulle_active = false;
      } else if (this.hit_time === 0) {
        Sound.play(Sound.TB_HIT);
        this.hit_time = 1;
        this.hits++;
      }
      if (d !== 0) {
        dx /= d;
        dy /= d;
      }
      game.ball.sx += 30 * dx;
      game.ball.sy += 30 * dy;
    }
  }
}
BossTB.NHITS = 4;
BossTB.ST_APPEAR = 0; BossTB.ST_FLYING = 1; BossTB.ST_MOVING = 2; BossTB.ST_DROPING = 3; BossTB.ST_WAITING = 4;
BossTB.ST_KATA = 5; BossTB.ST_COMEBACK = 6; BossTB.ST_DEATH = 7;
J.BossTB = BossTB;

// ── L'eau : une boule qui rend la bille glissante ──────────────────────────
class BossPowEau {
  constructor(g, b) {
    this.game = g;
    this.boss = b;
    this.init();
    this.update();
  }
  init() {
    this.active = false;
    this.mc = this.game.dmanager.attach('FXWater', Const.DUMMY_PLAN);
    this.x = this.boss.x;
    this.y = this.boss.y;
    this.parts = [];
    this.ang = this.boss.toBall();
    this.speed = 1;
    this.gliss_time = 0;
    this.da = this.boss.tb ? 0.01 : 0;
    this.acc = this.boss.tb ? 1.03 : 1;
  }
  genParts() {
    const ddx = [-1, -2, 1, 2];
    for (let i = 0; i < 4; i++) {
      const p = this.game.dmanager.attach('FXWaterParticule', Const.DUMMY_PLAN);
      p.dx = ddx[i];
      p.dy = -(3 + random(2));
      p._x = this.x;
      p._y = this.y;
      p.gotoAndStop(1 + random(3));
      this.parts.push(p);
    }
  }
  updateParts() {
    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i];
      p._x += p.dx * Std.tmod;
      p._y += p.dy * Std.tmod;
      p.dy += 0.4 * Std.tmod;
      p._xscale -= 200 * Std.deltaT;
      p._yscale -= 200 * Std.deltaT;
      if (p._xscale < 5) {
        remove(this.parts, p);
        p.removeMovieClip();
      }
    }
  }
  updateTrainee() {
    const game = this.game;
    if (this.active) {
      if (game.ball.hole_death) {
        this.gliss_time = 0;
        return;
      }
      const trainee = game.dmanager.attach('FXWaterQueue', Const.BONUS_PLAN);
      trainee._x = game.ball.x + 2;
      trainee._y = game.ball.y + 2;
      trainee._rotation = (Math.atan2(game.ball.sy, game.ball.sx) + Math.PI) * 180 / Math.PI;
      trainee._xscale = game.ball.speed * 3;
      trainee._alpha = Math.min(this.gliss_time, 1) * 100;
    }
  }
  update() {
    const game = this.game;
    this.updateParts();
    this.updateTrainee();
    if (this.active) {
      this.gliss_time -= Std.deltaT;
      game.ball.water = true;
      if (this.gliss_time < 0 && this.parts.length === 0) {
        this.active = false;
        game.ball.water = false;
        remove(this.boss.powers, this);
      }
      return;
    }
    this.ang += this.da * Std.tmod;
    this.speed *= Math.pow(this.acc, Std.tmod);
    this.x += Math.cos(this.ang) * Std.tmod * this.speed;
    this.y += Math.sin(this.ang) * Std.tmod * this.speed;
    if (this.x < -50 || this.y < -50 || this.x > Const.LVL_WIDTH + 50 || this.y > Const.LVL_HEIGHT + 50) {
      this.mc.removeMovieClip();
      remove(this.boss.powers, this);
      return;
    }
    this.mc._x = this.x;
    this.mc._y = this.y;
    const d = Math.sqrt(Tools.dist2(game.ball.mc, this.mc));
    if (d < 25) this.explode();
  }
  explode() {
    this.mc.removeMovieClip();
    this.gliss_time = 10 + random(5);
    this.genParts();
    this.active = true;
    this.update();
  }
  destroy() {
    if (!this.active) this.explode();
    this.gliss_time = 0;
    this.update();
  }
}
J.BossPowEau = BossPowEau;

// ── Le feu : une flamme qui tue ───────────────────────────────────────────
class BossPowFeu {
  constructor(g, b) {
    this.game = g;
    this.boss = b;
    this.init();
    this.update();
  }
  init() {
    this.mc = this.game.dmanager.attach('FXFire', Const.DUMMY_PLAN);
    this.mc.flLoopv = true;
    this.mc._x = this.boss.x;
    this.mc._y = this.boss.y;
    this.time = 10 + random(10);
  }
  update() {
    const game = this.game;
    this.time -= Std.deltaT;
    if (this.time < 0) {
      this.mc.flLoopv = false;
      remove(this.boss.powers, this);
    }
    if (game.ball.hole_death || game.ball.clign_count > 0 || this.mc._currentframe < 16) return;
    const dx = this.mc._x - game.ball.mc._x;
    const dy = this.mc._y - game.ball.mc._y;
    const d = Math.sqrt(dx * dx + (dy * dy) / 3);
    if (d < 15) {
      this.time = 0;
      game.ball.kill();
    }
  }
  destroy() { this.time = 0; }
}
J.BossPowFeu = BossPowFeu;

// ── La terre : un bourgeon, puis une liane qui retient la bille ───────────
class BossPowTerre {
  constructor(g, b) {
    this.game = g;
    this.boss = b;
    this.casse = false;
    this.init();
    this.update();
  }
  init() {
    this.tied = false;
    this.mc = this.game.dmanager.attach('FXbourgeon', Const.BONUS_PLAN);
    this.px = (this.boss.x / Const.DELTA) - Const.BORDER_CSIZE;
    this.py = (this.boss.y / Const.DELTA) - Const.BORDER_CSIZE;
    this.px -= this.px % 10;
    this.py -= this.py % 10;
    this.mc._x = this.px * Const.DELTA + Const.BORDER_SIZE + 20;
    this.mc._y = this.py * Const.DELTA + Const.BORDER_SIZE + 20;
    this.time = 10 + random(10);
    this.moveList = [];
  }
  initLiane() {
    const maxElement = 10;
    let prev = null;
    this.mc.gotoAndPlay('explode');
    for (let i = 0; i < maxElement; i++) {
      const mc = this.game.dmanager.attach('FXLiane', Const.BONUS_PLAN);
      mc.x = this.mc._x;
      mc.y = this.mc._y;
      mc.sx = 0;
      mc.sy = 0;
      mc.link = prev;
      if (i === 0) mc.flFixe = true;
      prev = mc;
      this.moveList.push(mc);
    }
    this.game.ball.link = prev;
    this.moveList.push(this.game.ball);
  }
  updateLiane() {
    const game = this.game;
    if (this.casse) {
      for (let i = 0; i < this.moveList.length - 1; i++) {
        const mc = this.moveList[i];
        mc._alpha -= 10 * Std.tmod;
        if (mc._alpha <= 0) {
          remove(this.moveList, mc);
          mc.removeMovieClip();
          i--;
        }
      }
      if (this.moveList.length === 1) {
        this.casse = false;
        this.tied = false;
        this.time = 0;
      }
      return;
    }

    const ropeBasicLength = 5;
    for (let i = 0; i < this.moveList.length; i++) {
      const mc = this.moveList[i];
      if (mc.link != null) {
        let dx = mc.link.x - mc.x;
        let dy = mc.link.y - mc.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > ropeBasicLength) {
          const c = (d / ropeBasicLength) - 1;
          dx *= c * 0.01;
          dy *= c * 0.01;
          mc.sx += dx;
          mc.sy += dy;
          mc.link.sx -= dx;
          mc.link.sy -= dy;
        }
      }
      mc.sx *= Math.pow(0.95, Std.tmod);
      mc.sy *= Math.pow(0.95, Std.tmod);
      if (!mc.flFixe) {
        mc.x += mc.sx * Std.tmod;
        mc.y += mc.sy * Std.tmod;
      }
      mc._x = mc.x;
      mc._y = mc.y;
    }
    for (let i = 0; i < this.moveList.length - 1; i++) {
      const mc1 = this.moveList[i];
      const mc2 = this.moveList[i + 1];
      const dy = mc2.y - mc1.y;
      const dx = mc2.x - mc1.x;
      const d = Math.sqrt(dx * dx + dy * dy);
      mc1._rotation = Math.atan2(dy, dx) * 180 / Math.PI;
      if (mc1.liane) mc1.liane._xscale = d;
    }

    const dx = this.mc._x - game.ball.x;
    const dy = this.mc._y - game.ball.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > 225 || game.ball.hole_death) this.casse = true;
  }
  update() {
    this.time -= Std.deltaT;
    if (this.tied) this.updateLiane();
    else {
      if (this.time < 0) {
        this.mc.gotoAndPlay('death');
        remove(this.boss.powers, this);
        return;
      }
      const d = Math.sqrt(Tools.dist2(this.mc, this.game.ball.mc));
      if (d < 30) {
        this.casse = false;
        this.tied = true;
        this.initLiane();
        this.updateLiane();
      }
    }
  }
  destroy() {
    this.time = 0;
    this.casse = true;
  }
}
J.BossPowTerre = BossPowTerre;

// ── Le vent : des volutes qui repoussent ──────────────────────────────────
class BossPowVent {
  constructor(g, b) {
    this.game = g;
    this.boss = b;
    this.init();
    this.update();
  }
  init() {
    this.ray = 0;
    this.ang = 0;
    this.hit = 0;
    this.x = this.boss.x;
    this.y = this.boss.y;
    this.parts = [];
    const nparts = 5;
    for (let i = 0; i < nparts; i++) {
      const p = this.game.dmanager.attach('FXWind', Const.BOSS_PLAN);
      p.ang = Math.PI * 2 * i / nparts;
      p.time = 2;
      p.ox = this.x;
      p.oy = this.y;
      this.parts.push(p);
    }
  }
  update() {
    const game = this.game;
    this.ray += 5 * Std.tmod;
    this.ang += Std.tmod / 12;
    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i];
      p.time -= Std.deltaT;
      if (p.time < 0) {
        p.removeMovieClip();
        remove(this.parts, p);
        i--;
      } else {
        const s = Math.min(this.ray, 100);
        p._xscale = s;
        p._yscale = s;
        const a = p.ang + this.ang;
        const px = Math.cos(a) * this.ray + this.x;
        const py = Math.sin(a) * this.ray + this.y;
        p._x = px;
        p._y = py;
        const va = Math.atan2(py - p.oy, px - p.ox);
        p._rotation = va * 180 / Math.PI;
        p.ox = px;
        p.oy = py;
      }
    }

    if (this.hit === 0) {
      let dx = this.x - game.ball.x;
      let dy = this.y - game.ball.y;
      let d = Math.sqrt(dx * dx + dy * dy);
      if (d < 10) d = 10;
      if (d < this.ray) {
        dx /= d;
        dy /= d;
        const pow = (this.boss.tb ? 30 : 10) / Math.sqrt(d);
        game.ball.sx -= dx * pow;
        game.ball.sy -= dy * pow;
      }
    } else {
      this.hit -= Std.deltaT;
      if (this.hit <= 0) this.hit = 0;
    }

    if (this.parts.length === 0) remove(this.boss.powers, this);
  }
  destroy() {}
}
J.BossPowVent = BossPowVent;

})(typeof window !== 'undefined' ? window : globalThis);
