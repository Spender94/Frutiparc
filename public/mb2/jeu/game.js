/*
 * MotionBall — la PARTIE (Game.as) : le niveau, la bille, les options selon
 * le mode, le temps, la boucle `main` (défilement, pause, mises à jour des
 * bumpers, la bille, le boss, les bonus, le changement de salle), le score.
 *
 *   · Challenge : 15 min, trois billes, `calcScore = int(salles visitées ×
 *     100 / salles) − 1`, plus `int(temps restant / 100) × 100` si le boss
 *     est vaincu ;
 *   · Classique : 1 min (+5 s par sortie), une bille, score = le rang de la
 *     salle, plafond de 100 s ;
 *   · Course : le temps monte (deltaT), trois tours, score = int(temps × 100) ;
 *   · Aventure : 18 min, cinq billes ;
 *   · Aide : 15 min, trois billes.
 *
 * Le temps de partie descend de `tmod × 1000 / 40` ms par image : à 40 i/s
 * avec un tmod de 0,8, le chrono court à 80 % du temps réel — comme sur le
 * disque. `boss_update` est nul tant qu'aucun boss n'est né : l'AS2
 * appelait alors `undefined.on_update` sans bruit, on teste.
 */
'use strict';

(function (racine) {

const K = racine.KalugaMoteur;
const J = racine.Mb2Jeu;
const { Const, Tools, Std, random, int } = J;
const Sound = J.Sound;
const Key = K.Key;

class Game {
  constructor(mc) {
    this.root_mc = mc;
    this.can_loose = true;
    this.course_validated = false;
    this.course_nturns = 0;
    this.scroll_on = false;
    this.pause = null;
    this.pause_key_flag = false;
    this.space_key_flag = false;
    this.boss_update = null;
    this.dmanager = new J.DepthManager(mc);

    J.Collide.init(this);
    this.level = new J.Level(this);
    this.ball = new J.Ball(this);

    switch (J.Manager.play_mode) {
      case Const.MODE_CLASSIC:
        this.curtime = Const.TIME_CLASSIC;
        this.options = new J.Options(this, 1);
        this.level.pos_x = 0;
        this.level.pos_y = random(this.level.height);
        break;
      case Const.MODE_AIDE:
        this.curtime = Const.TIME_CHALLENGE;
        this.options = new J.Options(this, 3);
        break;
      case Const.MODE_COURSE:
        this.course_nturns = 3;
        this.curtime = 0;
        this.options = new J.Options(this, 1);
        break;
      case Const.MODE_AVENTURE:
        this.curtime = Const.TIME_CHALLENGE * 1.2;
        this.options = new J.Options(this, 5);
        break;
      default:
        this.curtime = Const.TIME_CHALLENGE;
        this.options = new J.Options(this, 3);
        break;
    }

    this.main_color = new K.Color(mc);
    this.game_over_flag = false;
    this.ball.update_skin();
    this.options.update_icons();
    this.next_room();
    Sound.startMix();
  }

  calcScore(cause) {
    if (J.Manager.play_mode === Const.MODE_CLASSIC) return this.level.pos_x + 1;
    if (J.Manager.play_mode === Const.MODE_COURSE) return int(this.curtime * 100);

    let score = 0;
    let trooms = 0;
    let vrooms = 0;
    for (let x = 0; x < this.level.width; x++) {
      for (let y = 0; y < this.level.height; y++) {
        const r = this.level.dungeon[x][y];
        if (r.rtype !== 0) trooms++;
        if (r.visited) vrooms++;
      }
    }
    score += int(vrooms * 100 / trooms) - 1;
    if (cause === Const.CAUSE_WINS) score += int(this.curtime / 100) * 100;
    return score;
  }

  course_turn_done() {
    if (!this.course_validated) return;
    this.level.interf.tview.play();
    this.course_nturns--;
    if (this.course_nturns === 0) this.gameOver(Const.CAUSE_WINS);
    this.course_validated = false;
    for (let x = 0; x < this.level.width; x++) {
      for (let y = 0; y < this.level.height; y++) {
        if (x !== this.level.pos_x || y !== this.level.pos_y) {
          const r = this.level.dungeon[x][y];
          r.visited = false;
          if (r.paths) {
            for (let i = 0; i < 4; i++) if (r.paths[i].ptype === -1) r.paths[i].ptype = 0;
          }
          if (r.bdata) {
            for (let i = 0; i < r.bdata.length; i++) {
              const b = r.bdata[i];
              if (b.old_btype) b.btype = b.old_btype;
            }
          }
        }
      }
    }
  }

  next_room() {
    this.level.init_room();
    this.ball.sx /= 3;
    this.ball.sy /= 3;
    this.ball.speed /= 3;
    this.ball.start_x = this.ball.x;
    this.ball.start_y = this.ball.y;
    const tview = this.level.interf.tview;
    if (tview.niv_txt) tview.niv_txt.text = this.level.pos_x + 1;
  }

  gameOver(cause) {
    if (cause !== Const.CAUSE_WINS && !this.can_loose) return;
    if (!this.game_over_flag) {
      this.game_over_flag = true;
      J.Manager.gameOver(cause);
    }
  }

  is_door_opened(p) {
    if (!p) return false;
    return p.ptype === -1 || p.ptype === -2 || (p.ptype === 3 && J.Manager.play_mode !== Const.MODE_CHALLENGE) || p.ptype === 2;
  }

  main() {
    const tmod = Std.tmod;
    if (this.game_over_flag) return;

    if (this.scroll_on) {
      this.level.interf.scroll_room();
      return;
    }

    if (this.pause != null) {
      this.pause.main();
      return;
    }

    if (J.Manager.play_mode === Const.MODE_COURSE) {
      if (this.curtime < 0) this.curtime = 0;
      this.curtime += Std.deltaT;
    } else {
      this.curtime -= tmod * 1000 / 40;
      if (this.curtime < 0) {
        this.curtime = 0;
        if (!this.ball.hole_death) this.gameOver(Const.CAUSE_NOTIME);
      } else if (J.Manager.play_mode === Const.MODE_CLASSIC && this.curtime > 100000) this.curtime = 100000;
    }

    this.level.interf.update();
    this.ball.update_jump();

    // LES MISES À JOUR (un retrait pendant le parcours saute l'élément suivant, comme en 2005)
    for (let i = 0; i < this.level.updates.length; i++) this.level.updates[i].on_update(this, this.level.updates[i]);

    if (this.game_over_flag) return;

    if (this.ball.update_hole()) {
      if (this.boss_update) this.boss_update.on_update(this, this.boss_update);
      return;
    }

    if (Key.isDown(Key.SPACE) && J.Manager.play_mode !== Const.MODE_CLASSIC) {
      if (!this.space_key_flag) {
        this.space_key_flag = true;
        do {
          this.ball.btype++;
          this.ball.btype %= 7;
        } while (!this.options.ball_types[this.ball.btype]);
        this.options.update_icons();
        this.ball.update_skin();
        Sound.play(Sound.BALL_CHANGE);
      }
    } else this.space_key_flag = false;

    if (J.Manager.client.forcePause || Key.isDown(Key.ESCAPE)) {
      if (!this.pause_key_flag) {
        this.pause_key_flag = true;
        this.setPause();
        return;
      }
    } else this.pause_key_flag = false;

    this.ball.update();
    if (this.boss_update) this.boss_update.on_update(this, this.boss_update);

    // LES BONUS
    for (let i = 0; i < this.level.bonus.length; i++) {
      const b = this.level.bonus[i];
      if (b && Tools.dist2(b.clip, this.ball.mc) < 300 && b.on_hit(this, b)) {
        b.old_btype = b.btype;
        b.btype = 0;
        this.level.bonus[i] = null;
      }
    }

    const room = this.level.dungeon[this.level.pos_x] ? this.level.dungeon[this.level.pos_x][this.level.pos_y] : undefined;
    const paths = room && room.paths ? room.paths : [];
    const is_classic = (J.Manager.play_mode === Const.MODE_CLASSIC);
    if (this.ball.x < 0) {
      if (is_classic || this.is_door_opened(paths[0])) this.level.change_room(-1, 0);
      else this.ball.x = 5;
    } else if (this.ball.x > Const.LVL_WIDTH) {
      if (is_classic || this.is_door_opened(paths[1])) this.level.change_room(1, 0);
      else this.ball.x = Const.LVL_WIDTH - 5;
    } else if (this.ball.y < 0) {
      if (is_classic || this.is_door_opened(paths[2])) this.level.change_room(0, -1);
      else this.ball.y = 5;
    } else if (this.ball.y > Const.LVL_HEIGHT) {
      if (is_classic || this.is_door_opened(paths[3])) this.level.change_room(0, 1);
      else this.ball.y = Const.LVL_HEIGHT - 5;
    }
  }

  setPause() {
    this.pause = new J.Pause(this);
    if (this.boss_update && typeof this.boss_update.onPause === 'function') this.boss_update.onPause(true);
  }

  destroy() {
    if (this.ball.hole_mask) this.ball.hole_mask.removeMovieClip();
    if (this.pause) this.pause.destroy();
    this.dmanager.destroy();
  }
}
J.Game = Game;

})(typeof window !== 'undefined' ? window : globalThis);
