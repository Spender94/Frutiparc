/*
 * MotionBall — les ÉCRANS : l'intro (Intro.as : les lettres du titre, le
 * « 2 » qui tombe, les fissures, « press start »), le menu (Menu.as : les
 * boules en orbite, la rotation à la souris, les sous-menus Course, Aventure,
 * Options), la pause et sa carte (Pause.as), les panneaux de fin (GameOver.as,
 * GameOverCourse.as : les records et les TItems). Traduction ligne à ligne.
 *
 * Silences de l'AS2 gardés : `b.title` (les boules du menu n'ont pas
 * d'enfant de ce nom — leur titre est dans la boule elle-même),
 * `infos.dy` et `infos._y` sans cadre d'information, `shade_deux._alpha`
 * avant la naissance du « 2 », `MENU_IDS[-1]` (la liste vide qui fait
 * disparaître les boules).
 */
'use strict';

(function (racine) {

const K = racine.KalugaMoteur;
const J = racine.Mb2Jeu;
const { Const, Tools, Std, random, int } = J;
const Sound = J.Sound;
const Prefs = J.Prefs;
const Key = K.Key;

// ── Intro ─────────────────────────────────────────────────────────────────
class Intro {
  constructor(mc) {
    this.root_mc = mc;
    this.dmanager = new J.DepthManager(mc);
    this.letters = [];
    this.dmanager.attach('intro_bg', 0);
    for (let i = 0; i < 10; i++) {
      const t = this.dmanager.attach('title', 3);
      this.letters[i] = t;
      if (i < 6) {
        t._x = i * 80 + 110;
        t._y = 100 + random(10);
        t.base_y = t._y;
        t._xscale = 0;
        t._yscale = 0;
      } else {
        t.dx = (i - 6) * 70 + 200;
        t.dy = 280 + random(10);
        t.base_y = t.dy;
        t.sx = (t.dx - 305) * 10 + 305;
        t.sy = 400 + random(100);
        t._x = t.sx;
        t._y = t.sy;
      }
      t.gotoAndStop(i + 1);
    }
    this.tot_time = 0;
    this.menu_time = 0;
    this.menu_phase = 0;
    this.scale_factor = 10;
    this.scale_factor_way = true;
    this.deux = null; this.deux_speed = 0; this.deux_color = null; this.shade_deux = null;
    this.menu_trembl = 0; this.menu_trembl_way = 1; this.fade_time = 0; this.press_start = null;

    mc.onMouseDown = () => {
      this.onMouseDown();
      mc.onMouseDown = undefined;
    };
    mc.useHandCursor = false;
    Sound.playMusic(Sound.MUSIC_INTRO);
  }

  onMouseDown() { J.Manager.gotoMenu(); }

  main() {
    const tmod = Std.tmod;
    this.tot_time += tmod;
    this.menu_time += tmod / 30;
    if (this.menu_time > 1) this.menu_time = 1;
    switch (this.menu_phase) {
      case 0: {
        for (let i = 0; i < 6; i++) {
          const t = this.letters[i];
          const s = this.menu_time * 100 + this.scale_factor * Math.cos(i + this.tot_time / 20);
          t._y = t.base_y + (s - 100) / 2;
          t._xscale = s;
          t._yscale = s;
        }
        for (let i = 6; i < 10; i++) {
          const t = this.letters[i];
          t._x = (t.dx - t.sx) * this.menu_time + t.sx;
          t._y = (t.dy - t.sy) * this.menu_time + t.sy;
          t._rotation += 10 * tmod + random(3);
          t.retrot = true;
          t.rotspeed = 1;
          t.rotfactor = 2;
        }
        if (this.menu_time === 1) this.menu_phase++;
        break;
      }
      case 1: {
        for (let i = 0; i < 10; i++) {
          const t = this.letters[i];
          const s = 100 + this.scale_factor * Math.cos(i + this.tot_time / 20);
          t._y = t.base_y + (s - 100) / 2;
          t._xscale = s;
          t._yscale = s;
          if (t.retrot) {
            t._rotation += tmod * t.rotfactor * t.rotspeed;
            if (Math.abs(t._rotation) < 5) t.retrot = false;
          }
        }
        if (this.shade_deux) this.shade_deux._alpha += tmod / 2;   // avant sa naissance : rien, comme en AS2
        if (this.tot_time > 80 && !this.shade_deux) {
          const sd = this.shade_deux = this.dmanager.attach('deux', 0);
          sd.color = new K.Color(sd);
          sd.color.setRGB(0x9241C2);
          sd.time = 1;
          sd._x = 305;
          sd._y = 205;
          sd._xscale = 300;
          sd._yscale = 300;
        }
        if (this.tot_time > 100) {
          for (let i = 0; i < 10; i++) {
            const t = this.letters[i];
            t.sx = t._x;
            t.sy = t._y;
            t.dx = t.sx - 305;
            t.dy = t.sy - 205;
            t.sy /= 2;
            const l = Math.sqrt(t.dx * t.dx + t.dy * t.dy);
            t.dx /= l;
            t.dy /= l;
          }
          this.menu_phase++;
        }
        break;
      }
      case 2: {
        const sd = this.shade_deux;
        sd._xscale += tmod;
        sd._yscale += tmod;
        sd.time -= Std.tmod / 70;
        const rgb = (int(0x92 * sd.time) << 16) | (int(0x41 * sd.time) << 8) | int(0xC2 * sd.time);
        sd.color.setRGB(rgb);

        let b = true;
        for (let i = 0; i < 10; i++) {
          const t = this.letters[i];
          t._x += t.dx * 10;
          t._y += t.dy * 10;
          t.dx *= Math.pow(1.2, tmod);
          t.dy *= Math.pow(1.2, tmod);
          if (t._x > -50 && t._x < 660) b = false;
        }
        if (b) {
          const deux = this.deux = this.dmanager.attach('deux', 1);
          deux._x = 305;
          deux._y = 800;
          deux._xscale = 800;
          deux._yscale = 800;
          this.deux_speed = 3;
          this.menu_phase++;
        }
        break;
      }
      case 3: {
        const deux = this.deux, sd = this.shade_deux;
        this.deux_speed *= Math.pow(1.06, tmod);
        if (deux._y >= sd._y) {
          deux._y -= tmod * this.deux_speed;
          if (deux._y < sd._y) deux._y = sd._y;
        }
        if (deux._xscale >= sd._xscale) {
          deux._xscale -= tmod * this.deux_speed / 1.2;
          deux._yscale -= tmod * this.deux_speed / 1.2;
        } else {
          sd.removeMovieClip();
          deux.sy = deux._y;
          deux.ox = deux._x;
          deux.oy = deux._y;
          this.menu_phase++;
          this.menu_trembl = 5;
          this.menu_trembl_way = 1;
          for (let i = 0; i < 20; i++) {
            const f = this.dmanager.attach('fissure', 0);
            f.gotoAndStop(random(f._totalframes) + 1);
            f._rotation = 360 * i / 20;
            f._xscale = 100 + random(50);
            f._yscale = 100 + random(50);
            f._x = deux._x;
            f._y = deux._y;
            this.letters.push(f);
          }
        }
        break;
      }
      case 4:
        this.deux.oy = this.deux._y;
        this.deux._y = this.deux.sy;
        this.root_mc._y = this.menu_trembl * this.menu_trembl_way;
        this.menu_trembl -= 0.3;
        if (this.menu_trembl <= 0) this.menu_phase++;
        this.menu_trembl_way *= -1;
        break;
      case 5: {
        this.root_mc._y = 0;
        let b = true;
        for (let i = 0; i < 10; i++) {
          const t = this.letters[i];
          const s = 100 + this.scale_factor * Math.cos(i + this.tot_time / 20);
          t._x += (t.sx - t._x) / 10;
          t._y += (t.sy - t._y) / 10;
          t._xscale = s;
          t._yscale = s;
          if (Math.abs(t._x - t.sx) + Math.abs(t._y - t.sy) > 3) b = false;
        }
        if (b) {
          this.menu_phase++;
          this.fade_time = 0;
          this.deux_color = new K.Color(this.deux);
          this.press_start = this.dmanager.attach('press start', 1);
        }
        break;
      }
      case 6: {
        this.fade_time += tmod * 10;
        if (this.fade_time > 255) this.fade_time = 255;
        const alpha = 100 - this.fade_time / 2.55;
        this.deux_color.setTransform({ ra: alpha, rb: this.fade_time * 0.8 * 0.5, ga: alpha, gb: 0, ba: alpha, bb: this.fade_time * 0.5, aa: 100, ab: 0 });

        for (let i = 0; i < 10; i++) {
          const t = this.letters[i];
          const s = 100 + this.scale_factor * Math.cos(i + this.tot_time / 20);
          t._y = (t.base_y / 2) + (s - 100) / 2;
          t._xscale = s;
          t._yscale = s;
          if (!t.hasrot && !t.retrot && random(1000) === 0) {
            t.rotfactor = 5 + random(2);
            t.rotspeed = 1;
            t.hasrot = true;
          }
          if (t.hasrot) {
            t.rotspeed *= Math.pow(1.03, tmod);
            t._rotation += tmod * t.rotfactor * t.rotspeed;
            if (t.rotspeed > 3) t.rotfactor *= Math.pow(0.95, tmod);
            if (t.rotspeed * t.rotfactor < 4) {
              t.hasrot = false;
              t.retrot = true;
            }
          }
          if (t.retrot) {
            t._rotation += tmod * t.rotfactor * t.rotspeed;
            if (Math.abs(t._rotation) < 5) t.retrot = false;
          }
        }
        if (random(30) === 0 || this.scale_factor < 5 || this.scale_factor > 15) this.scale_factor_way = !this.scale_factor_way;
        if (this.scale_factor_way) this.scale_factor += 0.1;
        else this.scale_factor -= 0.1;
        break;
      }
      default: break;
    }
  }

  destroy() {
    this.root_mc.onMouseDown = undefined;
    this.dmanager.destroy();
    this.root_mc._y = 0;
    for (let i = 0; i < this.letters.length; i++) this.letters[i].removeMovieClip();
  }
}
J.Intro = Intro;

// ── Menu ──────────────────────────────────────────────────────────────────
class Menu {
  constructor(mc) {
    this.mc = mc;
    this.dmanager = new J.DepthManager(mc);
    this.bg = this.dmanager.attach('fondMenu', 0);
    this.balls = [];
    this.infos = null;
    Sound.play(Sound.MENU_ENTER);
    this.show(0);
    this.cur_ray = 450;
    this.cur_ang = 0;
    this.ray_speed = -1.0;
    this.ray_acc = 1.05;
    this.ang_speed = 0.05;
    this.ang_acc = 1.01;
    this.cos_ray = 0;
    this.cos_speed = 0;
    this.menu_phase = 0;
    this.menu_time = 0;
    this.go_hole = false;
    this.next_menu_id = 0; this.next_mode = undefined; this.next_mode_param = undefined;
    Sound.playMusic(Sound.MUSIC_MENU);
  }

  has_true_flag(a) {
    for (let i = 0; i < a.length; i++) if (a[i]) return true;
    return false;
  }

  show(n) {
    const client = J.Manager.client;
    for (let i = 0; i < this.balls.length; i++) this.balls[i].removeMovieClip();
    this.balls = [];
    const m = Menu.MENU_IDS[n] || [];   // show(-1) : aucune boule
    for (let i = 0; i < m.length; i++) {
      const b = this.dmanager.attach('menu balls', 0);
      let id = m[i];
      b.state = 1;
      switch (id) {
        case 1: if (!Prefs.challenge_mode_enabled) b.state = 0; break;
        case 2: if (!this.has_true_flag(Prefs.courses) || client.isChallengeDisc()) b.state = 0; break;
        case 3: if (!this.has_true_flag(Prefs.dungeons) || client.isChallengeDisc()) b.state = 0; break;
        case 4: if (!Prefs.classic_mode_enabled || client.isChallengeDisc()) b.state = 0; break;
        case 20: if (!Prefs.music_enabled) id += 1; break;
        case 22: if (!Prefs.sound_enabled) id += 1; break;
        default: break;
      }
      // D'époque : « challenge » sur le disque noir (classé), « challenge
      // entrainement » (image 7) sur le disque blanc. Ici la session est
      // toujours blanche et c'est le quota de Fruits Défendus qui décide du
      // classement : la boule dit la vérité — comme le CHALLENGE / ESSAIS de
      // Kaluga (Client.isRanked).
      if (id === 1 && client.isWhite() && !client.isRanked()) id = 7;
      if (id >= 40 && id <= 46 && !Prefs.courses[id - 40]) b.state = 0;
      if (id >= 60 && id <= 64) {
        if (!Prefs.dungeons[id - 60]) b.state = 0;
      }

      b.useHandCursor = false;
      b.onRollOver = () => { this.select(b); };
      b.onRollOut = () => { this.unselect(b); };
      b.onPress = () => { this.enter(b); };
      b.gotoAndStop(b.state ? 'normal' : 'disable');
      if (b.title) b.title.gotoAndStop(id);   // pas d'enfant « title » : rien, comme en AS2
      if (b.ball) b.ball.gotoAndStop(id);

      if (id >= 60 && id <= 63 && b.ball && b.ball.mask) {
        if (client.fcard.$dungeons_done[id - 60]) b.ball.mask.gotoAndStop(2);
        else b.ball.mask.stop();
      }
      if (id === 64 && b.state === 0 && b.ball && b.ball.logo) b.ball.logo.stop();

      switch (id) {
        case 1:
        case 7: b.infos = 1; break;
        case 2: b.infos = 3; break;
        case 3: b.infos = 2; break;
        case 4: b.infos = 4; break;
        default: break;
      }

      b.ang = i * 2 * Math.PI / m.length;
      b.id = id;
      this.balls.push(b);
    }
  }

  showInfos(i) {
    if (i === undefined) {
      if (this.infos) this.infos.dy = 10;
      return;
    }
    if (this.infos == null) {
      this.infos = this.dmanager.attach('cadreInfo', 1);
      this.infos.gotoAndStop(i);
      this.infos._x = Const.LVL_WIDTH / 2;
      this.infos._y = Const.LVL_HEIGHT + 50;
      this.infos.dy = -10;
    } else {
      this.infos.dy = -10;
      this.infos.gotoAndStop(i);
    }
  }

  select(b) {
    if (b.state === 1) {
      Sound.play(Sound.MENU_SELECT);
      b.state = 2;
      b.gotoAndStop('selected');
      this.showInfos(b.infos);
    }
  }

  unselect(b) {
    if (b.state === 2) {
      b.state = 1;
      b.gotoAndStop('normal');
      this.showInfos(undefined);
    }
  }

  enter(b) {
    if (this.menu_phase === 1 && b.state === 2) {
      Sound.play(Sound.MENU_ENTER);
      this.start(b.id);
    }
  }

  run_menu(n) {
    this.menu_phase = 3;
    this.next_menu_id = n;
    this.ray_speed = -5.0;
    this.ray_acc = 1.1;
    this.ang_speed = 0.2;
    this.ang_acc = 1.02;
    this.cos_speed = 0;
    this.cos_ray = 0;
    this.mc.onMouseMove = undefined;
  }

  run_mode(mname, mparam) {
    this.menu_phase = 2;
    this.next_mode = mname;
    this.next_mode_param = mparam;
    this.ray_speed = 7.0;
    this.ray_acc = 1.05;
    this.ang_speed = 0.1;
    this.ang_acc = 1.05;
    this.cos_speed = 0;
    this.cos_ray = 0;
    this.go_hole = true;
    this.mc.onMouseMove = undefined;
  }

  start(id) {
    switch (id) {
      case 1:
      case 7: this.run_mode(Const.MODE_CHALLENGE, undefined); break;
      case 2: this.run_menu(1); break;
      case 3: this.run_menu(2); break;
      case 4: this.run_mode(Const.MODE_CLASSIC, undefined); break;
      case 5: this.run_menu(3); break;
      case 6: this.run_mode(Const.MODE_AIDE, undefined); break;
      case 40: case 41: case 42: case 43: case 44: case 45: case 46:
        this.run_mode(Const.MODE_COURSE, id - 40); break;
      case 60: case 61: case 62: case 63: case 64:
        this.run_mode(Const.MODE_AVENTURE, id - 60); break;
      case 47:
      case 65: this.run_menu(0); break;
      case 20:
      case 21: Prefs.toggleMusic(); this.run_menu(3); break;
      case 22:
      case 23: Prefs.toggleSounds(); this.run_menu(3); break;
      case 24: J.Manager.client.savePrefs(); this.run_menu(0); break;
      default: break;
    }
  }

  change() {
    const xm = Std.xmouse();
    const delta = Math.min(200, Math.abs(305 - xm));
    if (xm > 305) this.ang_speed = delta * 0.05 / 100;
    else this.ang_speed = -delta * 0.05 / 100;
  }

  main() {
    const tmod = Std.tmod;
    this.menu_time += tmod / 30;
    this.ray_speed *= Math.pow(this.ray_acc, tmod);

    if (this.infos) {
      this.infos._y += this.infos.dy * tmod;
      if (this.infos._y > Const.LVL_HEIGHT + 50) {
        this.infos.removeMovieClip();
        this.infos = null;
      } else if (this.infos._y < Const.LVL_HEIGHT - 40) this.infos._y = Const.LVL_HEIGHT - 40;
    }

    // corrigé : bug en cas d'explosion du tmod (passage bureau fp2)
    if (this.menu_phase > 1 && Math.abs(this.ray_speed) < 3) {
      if (this.ray_speed < 0) this.ray_speed = -3;
      else this.ray_speed = 3;
    }

    this.ang_speed *= Math.pow(this.ang_acc, tmod);
    this.cos_ray += this.cos_speed;
    this.cur_ray += this.ray_speed;
    this.cur_ang += this.ang_speed;
    if (this.cur_ang > Math.PI) {
      const pi2 = Math.PI * 2;
      this.cur_ang -= int(this.cur_ang / pi2) * pi2;
    }
    for (let i = 0; i < this.balls.length; i++) {
      const b = this.balls[i];
      const a = b.ang + this.cur_ang;
      const r = Math.cos(b.ang + this.menu_time) * this.cos_ray;
      b._x = Math.cos(a) * (this.cur_ray + r) + 305;
      b._y = Math.sin(a) * (this.cur_ray + r) + 205;
    }

    switch (this.menu_phase) {
      case 0:
        if (this.cur_ray <= 136) {
          this.cur_ray = 136;
          this.ray_speed = 0.0;
          this.ang_acc = 0.99;
          this.cos_speed = 0.1;
          this.mc.onMouseMove = () => { this.change(); };
          this.menu_phase++;
        }
        break;
      case 1:
        if (Math.abs(this.cos_ray) > 10) this.cos_speed *= -1;
        break;
      case 2:
        if (this.cur_ray > 450) {
          this.show(-1);
          this.mc.onMouseMove = undefined;
          if (this.next_mode === Menu.GOTO_AIDE) J.Manager.gotoAide();
          else J.Manager.startGame(this.next_mode, this.next_mode_param);
        }
        break;
      case 3:
        if (this.cur_ray < this.ray_speed) {
          this.show(this.next_menu_id);
          this.ang_speed *= -1;
          this.ray_speed *= -1;
          this.ray_acc = 1 / this.ray_acc;
          this.ang_acc = 0.97;
          this.menu_phase++;
          this.main();
        }
        break;
      case 4:
        if (this.cur_ray >= 130) {
          this.ray_speed = 0;
          this.cur_ray = 135;
          this.menu_phase = 0;
        }
        break;
      default: break;
    }
    if (this.go_hole && this.bg.hole) {
      this.bg.hole._xscale *= Math.pow(1.1, tmod);
      this.bg.hole._yscale = this.bg.hole._xscale;
    }
  }

  destroy() {
    this.mc.onMouseMove = undefined;
    this.dmanager.destroy();
  }
}
Menu.GOTO_AIDE = -1;
Menu.MENU_IDS = [
  [1, 2, 3, 4, 5, 6],                 // MENU PRINCIPAL
  [40, 41, 42, 43, 44, 45, 46, 47],   // MENU COURSE
  [60, 61, 62, 63, 64, 65],           // MENU AVENTURE
  [20, 22, 24],                       // MENU OPTIONS
];
J.Menu = Menu;

// ── Pause : la partie teintée, la carte du donjon ─────────────────────────
class Pause {
  constructor(game) {
    this.game = game;
    this.carte = null; this.cmanager = null; this.last_map_item = undefined;
    if (game.options.has_map || game.options.has_radar) this.show_map();
    game.main_color.setTransform({ ra: 50, rb: 30, ga: 70, gb: 0, ba: 50, bb: 30, aa: 100, ab: 0 });
    game.root_mc._parent.attachMovie('pause', 'pause_mc', 0);
    this.pause_mc = game.root_mc._parent.pause_mc;
  }

  endPause() {
    const game = this.game;
    if (this.carte) this.carte.removeMovieClip();
    if (this.pause_mc) this.pause_mc.removeMovieClip();
    game.main_color.reset();
    if (game.boss_update && typeof game.boss_update.onPause === 'function') game.boss_update.onPause(false);
    game.pause = null;
  }

  destroy() { this.endPause(); }

  main() {
    const game = this.game;
    if (Key.isDown(Key.ESCAPE) && !J.Manager.client.forcePause) {
      if (!game.pause_key_flag) {
        game.pause_key_flag = true;
        this.endPause();
      }
    } else game.pause_key_flag = false;
  }

  gen_map_item(px, py, frame) {
    if (frame === 0) return undefined;
    const mc2 = this.cmanager.attach('room', (frame > 14) ? 0 : 1);
    mc2._x = px;
    mc2._y = py;
    mc2.gotoAndStop(frame);
    if (frame > 14) this.last_map_item = mc2;
    return mc2;
  }

  path_open(x, y, n) {
    const col = this.game.level.dungeon[x];
    const room = col ? col[y] : undefined;
    const p = room && room.paths ? room.paths[n].ptype : undefined;
    return p !== 1 && p !== 2;
  }

  show_map() {
    const game = this.game;
    game.root_mc._parent.attachMovie('carte', 'carte_mc', 1);
    this.carte = game.root_mc._parent.carte_mc;
    this.cmanager = new J.DepthManager(this.carte);
    this.carte._x = 95;
    this.carte._y = 55;
    for (let x = 0; x < 8; x++) {
      for (let y = 0; y < 8; y++) {
        const col = game.level.dungeon[x];
        const room = col ? col[y] : undefined;
        if (!room) continue;   // au-delà du donjon : rien à dessiner (undefined en AS2)
        const px = 18 + 48 * x;
        const py = 16 + 36 * y;
        if (room.rtype !== 0) {
          let t = 0;
          if (x === game.level.pos_x && y === game.level.pos_y) {
            this.gen_map_item(px, py, 34);
            t = 8;
          } else if (room.visited && game.options.has_map) {
            this.gen_map_item(px, py, 33);
            t = 4;
          }
          if (game.options.has_map) {
            const st = t;
            if (this.path_open(x, y, 0) && this.path_open(x - 1, y, 1)) {
              if (x - 1 === game.level.pos_x && y === game.level.pos_y) t = 8;
              else if (t !== 8 && col[y] && game.level.dungeon[x - 1] && game.level.dungeon[x - 1][y] && game.level.dungeon[x - 1][y].visited) t = 4;
              this.gen_map_item(px, py, 1 + t);
            }
            t = st;
            if (this.path_open(x, y, 2) && this.path_open(x, y - 1, 3)) {
              if (x === game.level.pos_x && y - 1 === game.level.pos_y) t = 8;
              else if (t !== 8 && col[y - 1] && col[y - 1].visited) t = 4;
              this.gen_map_item(px, py, 2 + t);
            }
          }
        }
        switch (room.rtype) {
          case 0:
            if (game.options.has_map) this.gen_map_item(px, py, 14 + random(4));
            break;
          case 1:   // NORMAL
          case 5:   // OBJNEED
            if (game.options.has_radar && x === game.level.start_x && y === game.level.start_y) this.gen_map_item(px, py, 26);
            break;
          case 2:   // EXIT
            if (game.options.has_radar) this.gen_map_item(px, py, 31);
            break;
          case 3:   // OBJFOUND
            if (game.options.has_radar && room.rdata !== -1) this.gen_map_item(px, py, Pause.OBJFRAMES[room.rdata]);
            break;
          case 4:   // BONUSFOUND
            if (game.options.has_radar && room.rdata !== -1) this.gen_map_item(px, py, Pause.BONUSFRAMES[room.rdata]);
            break;
          default: break;
        }
      }
    }
    if (this.carte.grille && this.last_map_item) this.carte.grille.swapDepths(this.last_map_item);
  }
}
Pause.OBJFRAMES = [19, 22, 23, 24];
Pause.BONUSFRAMES = [21, 20, 28, 0, 27, 29, 30];
J.Pause = Pause;

// ── GameOver : le panneau de fin (Challenge, Aventure, Classique) ─────────
class GameOver {
  constructor(mc, mode, cause) {
    this.mode = mode;
    this.cause = cause;
    Sound.fadeMix(Sound.MUSIC_GAME_OVER);
    Sound.play(Sound.GAME_OVER);
    this.screen = mode.dmanager.attach('panGameOver', Const.ICON_PLAN);
    this.screen._x = Const.LVL_WIDTH / 2;
    this.screen._y = Const.LVL_HEIGHT / 2;
    if (cause === Const.CAUSE_WINS) this.screen.gotoAndStop('victory');
    else this.screen.gotoAndStop('gameOver');
    this.screen.mainField.text = 'Connexion en cours...';
    this.screen.mainField._y = 30 - this.screen.mainField.textHeight / 2;
    this.fx = new J.PopupFX(this.screen, 0, 100, 10, 3, 1.2, 0.6, 0.5, 1);
    this.fx.main();
  }

  onClassicScore(score, record, titem) {
    this.setText('Votre score : niveau ' + score + '\nVotre record : niveau ' + record + (titem ? '\nTItem gagne !!' : ''));
  }

  onScore(score, old_score, old_pos, new_pos, ti) {
    let txt = '';
    if (old_score < score && old_score > 0) txt += 'Record battu !\n';
    if (old_pos > new_pos && old_pos > 0) txt += 'Vous avez gagne ' + (old_pos - new_pos) + ' places.\n';
    txt += ((score % 100) + 1) + ' pourcent du niveau accomplis\n';
    txt += 'Votre score : ' + int(score / 100) + '\n';
    if (new_pos > 0) txt += 'Votre classement : ' + new_pos;
    if (ti) txt += 'Nouveau TItem gagne !';
    this.setText(txt);
  }

  setText(txt) {
    this.screen.mainField.text = txt;
    this.screen.mainField._y = 30 - this.screen.mainField.textHeight / 2;
    this.screen.onPress = () => { this.click(); };
  }

  click() {
    this.screen.onPress = null;
    J.Manager.gameFinished();
  }

  calcScore(cause) { return this.mode.calcScore(cause); }
  get dmanager() { return this.mode.dmanager; }

  main() {
    this.fx.main();
    this.mode.main();
  }

  destroy() { this.mode.destroy(); }
}
J.GameOver = GameOver;

// ── GameOverCourse : les records d'une course ─────────────────────────────
class GameOverCourse {
  constructor(mc, mode, score) {
    this.mode = mode;
    this.score = score;
    Sound.fadeMix(Sound.MUSIC_GAME_OVER);
    Sound.play(Sound.GAME_OVER);
    this.screen = mode.dmanager.attach('panGameOver', Const.ICON_PLAN);
    this.screen._x = Const.LVL_WIDTH / 2;
    this.screen._y = Const.LVL_HEIGHT / 2;
    this.screen.gotoAndStop('records');
    this.saveRecords();
    this.fx = new J.PopupFX(this.screen, 0, 100, 10, 3, 1.2, 0.6, 0.5, 1);
    this.fx.main();
    this.screen.onPress = () => {
      this.click();
      this.screen.onPress = undefined;
    };
  }

  saveRecords() {
    const score = this.score;
    const plrecord = { $t: score, $c: false };
    const card = J.Manager.client.fcard;
    const param = J.Manager.play_mode_param;
    const records = card.$records[param];
    let p = 0;
    let cp = 0;
    let titems = 0;
    while (p < 3) {
      if (records[p].$t > score) {
        // (records[p], et non records[j] : le source d'époque, gardé tel quel)
        for (let j = p; j < 3; j++) {
          if (records[p].$c) {
            titems += J.TItems.giveCourse(param, cp);
            cp++;
          }
        }
        if (!card.$courses[param + 1]) card.$courses[param + 1] = true;
        records.splice(p, 0, plrecord);
        break;
      }
      if (records[p].$c) cp++;
      p++;
    }

    this.screen.mainField.text = '';
    if (p === 3) {
      if (records.length === 3) records.push(plrecord);
      else this.screen.mainField.text = "Vous n'etes pas classe.";
    }
    if (titems > 0) this.screen.mainField.text += titems + ' titems gagnes !';

    this.displayRecords(score, records);
    records.splice(3, records.length - 3);
    J.Manager.client.saveSlot(0);
  }

  displayRecords(s, r) {
    let cp = 0;
    for (let i = 0; i < 4; i++) {
      const rpan = this.screen[GameOverCourse.NAMES[i]];
      if (!rpan) continue;
      if (rpan.slot && rpan.slot.time_text) rpan.slot.time_text.text = J.Interf.makeTime(r[i].$t);
      let rtype = 5;
      if (r[i].$c) rtype = ++cp;
      else if (r[i].$t === s) rtype = 4;
      if (rpan.b1) rpan.b1.gotoAndStop(rtype);
      if (rpan.b2) rpan.b2.gotoAndStop(rtype);
    }
  }

  click() { J.Manager.gameFinished(); }

  calcScore(cause) { return this.mode.calcScore(cause); }
  get dmanager() { return this.mode.dmanager; }

  main() {
    this.fx.main();
    this.mode.main();
  }

  destroy() { this.mode.destroy(); }
}
GameOverCourse.NAMES = ['s1', 's2', 's3', 's4'];
J.GameOverCourse = GameOverCourse;

})(typeof window !== 'undefined' ? window : globalThis);
