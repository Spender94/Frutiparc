/*
 * MotionBall — le NIVEAU : le donjon décodé (LevelLoader.as), la salle et
 * sa table de collision (Level.as), l'interface de la salle — portes, fonds,
 * murs, trous, compteur, défilement — (Interf.as) et les collisions
 * (Collide.as). Traduction ligne à ligne de Games/motionBall2/mb2/.
 *
 * La salle est une grille de 152×102 cases de 4 px (`coltable`) : chaque
 * bumper y pose sa silhouette (`Collide.gen_hitmap`, le clip sondé par
 * hitTest à la grille), les bordures et les portes leurs objets de
 * collision. Seize points sur le cercle de la bille sondent la table
 * (`Level.col_test`) ; l'angle moyen des points touchés donne la normale du
 * rebond.
 *
 * Là où l'AS2 lisait `walltable[x-1][y].btype` hors de la grille et
 * obtenait `undefined` sans bruit, le portage passe par `caseMur` : même
 * résultat, sans exception.
 */
'use strict';

(function (racine) {

const K = racine.KalugaMoteur;
const J = racine.Mb2Jeu;
const { Const, Tools, Std, random, int, remove } = J;
const Sound = J.Sound;

// ── LevelLoader ───────────────────────────────────────────────────────────
class LevelLoader {
  constructor(data) {
    const bc = this.bc = new J.MTBitcodec(data);
    this.width = bc.read(7);
    this.height = bc.read(7);
    this.start_x = bc.read(7);
    this.start_y = bc.read(7);
    this.dungeon = [];
    for (let x = 0; x < this.width; x++) {
      this.dungeon[x] = [];
      for (let y = 0; y < this.height; y++) this.dungeon[x][y] = this.decode_room();
    }
    bc.next_part();
    this.decode_x = 0;
    this.decode_y = 0;
    if (bc.has_error()) J.Manager.error();
  }
  // Décode les bumpers de toutes les salles jusqu'à (x, y) — dans l'ordre du fichier.
  decodeRoom(x, y) {
    let n = 0;
    while (this.decode_x < x || (this.decode_x === x && this.decode_y <= y)) {
      n++;
      this.decode_incr();
    }
  }
  decode_incr() {
    if (this.dungeon[this.decode_x] && this.dungeon[this.decode_x][this.decode_y]) {
      this.dungeon[this.decode_x][this.decode_y].bdata = this.decode_room_bumpers();
    } else this.decode_room_bumpers();
    this.decode_y++;
    if (this.decode_y === this.height) {
      this.decode_y = 0;
      this.decode_x++;
    }
  }
  decode_path() {
    const p = { ptype: this.bc.read(2) };
    if (p.ptype === 3) p.pdata = this.bc.read(2);   // OBJECT
    return p;
  }
  decode_room() {
    const r = { rtype: this.bc.read(3) };
    switch (r.rtype) {
      case 3:   // OBJECTFOUND
      case 5:   // OBJECTNEEDED
        r.rdata = this.bc.read(2);
        break;
      case 4:   // BONUS
        r.rdata = this.bc.read(3);
        break;
      default: break;
    }
    if (r.rtype !== 0) {
      r.paths = new Array(4);
      for (let d = 0; d < 4; d++) r.paths[d] = this.decode_path();
    }
    return r;
  }
  decode_room_bumpers() {
    if (this.bc.read(1) === 0) return null;
    const blist = [];
    for (;;) {
      if (this.bc.has_error()) return null;
      const r = this.bc.read(4);
      if (r === 0) break;
      const o = { x: this.bc.read(Const.POS_NBITS), y: this.bc.read(Const.POS_NBITS), btype: r };
      blist.push(o);
    }
    return blist;
  }
}
J.LevelLoader = LevelLoader;

// ── Level ─────────────────────────────────────────────────────────────────
class Level {
  constructor(game) {
    this.game = game;
    this.dmanager = game.dmanager;
    this.loader = new LevelLoader(J.Loader.last_data);
    this.width = this.loader.width;
    this.height = this.loader.height;
    this.start_x = this.loader.start_x;
    this.start_y = this.loader.start_y;
    this.dungeon = this.loader.dungeon;
    this.pos_x = this.start_x;
    this.pos_y = this.start_y;
    this.interf = new Interf(game);
    this.bonus = []; this.updates = []; this.objects = []; this.dummies = []; this.coltable = [];
    this.bonus_reds = 0;
    this.exit = null;
  }

  init_room() {
    this.interf.init_room();
    this.bonus = [];
    this.updates = [];
    this.objects = [];
    this.coltable = [];
    this.dummies = [];
    const ct = this.coltable, C = J.Collide;
    for (let x = 0; x < Const.LVL_CWIDTH; x++) ct[x] = [];
    for (let x = 0; x < Const.BORDER_CSIZE; x++) {
      for (let y = 0; y < Const.LVL_CHEIGHT; y++) ct[x][y] = C.border_collide;
      for (let y = 0; y < Const.LVL_CHEIGHT; y++) ct[Const.LVL_CWIDTH - 1 - x][y] = C.border_collide;
    }
    for (let y = 0; y < Const.BORDER_CSIZE; y++) {
      for (let x = 0; x < Const.LVL_CWIDTH; x++) ct[x][y] = C.border_collide;
      for (let x = 0; x < Const.LVL_CWIDTH; x++) ct[x][Const.LVL_CHEIGHT - 1 - y] = C.border_collide;
    }
    this.loader.decodeRoom(this.pos_x, this.pos_y);
    this.gen_room();
    return true;
  }

  free_pos(px, py, msize) {
    for (let x = 0; x < msize.w; x++) {
      for (let y = 0; y < msize.h; y++) {
        const col = this.coltable[x + px];
        if (col && col[y + py]) return false;
      }
    }
    return true;
  }

  // Pose la silhouette `map` (hitmap) dans la table, à la case p. Sans
  // silhouette (le téléporteur : hitmap[9] n'existe pas), rien — l'AS2
  // bouclait sur `undefined.length` et ne posait rien non plus.
  fill_pos(p, map, v) {
    if (!map || !map.length) return;
    const w = map.length, h = map[0].length;
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        if (map[x][y]) { const col = this.coltable[x + p.x]; if (col) col[y + p.y] = v; }
      }
    }
  }

  erase_pos(b) {
    const msize = Tools.mc_size(b.clip);
    msize.w += b.x;
    msize.h += b.y;
    for (let x = b.x; x < msize.w; x++) {
      for (let y = b.y; y < msize.h; y++) {
        const col = this.coltable[x];
        if (col && col[y] === b) col[y] = null;
      }
    }
  }

  gen_room() {
    const room = this.dungeon[this.pos_x][this.pos_y];
    room.visited = true;
    this.bonus_reds = 0;
    switch (room.rtype) {
      case 2: this.gen_boss_room(room); break;
      case 3: this.gen_object_room(room.rdata); break;
      case 4: this.gen_bonus_room(room.rdata); break;
      default: this.gen_normal_room(room.bdata); break;
    }
    this.interf.init_doors(0);
    if (this.bonus_reds === 0) this.interf.open_doors();
    this.interf.update_walls();
  }

  gen_boss_room(r) {
    this.bonus_reds = 1;
    this.updates.push({ on_update: J.Collide.boss_room_on_update });

    this.gen_bumper({ btype: 7, x: Const.BORDER_CSIZE + 1, y: Const.LVL_CHEIGHT - 10 });
    this.gen_bumper({ btype: 7, x: Const.BORDER_CSIZE + 11, y: Const.LVL_CHEIGHT - 10 });
    this.gen_bumper({ btype: 7, x: Const.BORDER_CSIZE + 1, y: Const.LVL_CHEIGHT - 20 });

    this.gen_bumper({ btype: 7, x: Const.LVL_CWIDTH - 10, y: Const.LVL_CHEIGHT - 10 });
    this.gen_bumper({ btype: 7, x: Const.LVL_CWIDTH - 20, y: Const.LVL_CHEIGHT - 10 });
    this.gen_bumper({ btype: 7, x: Const.LVL_CWIDTH - 10, y: Const.LVL_CHEIGHT - 20 });

    this.objects.push(this.gen_bumper({ btype: 3, x: 7, y: 7 }));
    this.objects.push(this.gen_bumper({ btype: 3, x: Const.LVL_CWIDTH - 17, y: 7 }));
  }

  gen_object_room(o) {
    let obj;
    switch (o) {
      case 0: obj = 1; break;   // VERTE
      case 1: obj = 4; break;   // BLEUE
      case 2: obj = 5; break;   // METAL
      case 3: obj = 6; break;   // VIOLET
      case 4: obj = 3; break;   // ORANGE
      case 5: obj = 2; break;   // ROUGE
      default: break;
    }
    const clip = this.dmanager.attach('ballbox', Const.BONUS_PLAN);
    Tools.set_mcpos(clip, Tools.pos_center(clip));
    if (clip.ball) clip.ball.gotoAndStop(obj + 1);

    const oo = { on_update: J.Collide.ball_object_on_update, obj, clip };
    this.updates.push(oo);
    this.objects.push(oo);

    this.objects.push(this.gen_bumper({ btype: 2, x: 7, y: 7 }));
    this.objects.push(this.gen_bumper({ btype: 2, x: Const.LVL_CWIDTH - 23, y: 7 }));
    this.objects.push(this.gen_bumper({ btype: 2, x: 7, y: Const.LVL_CHEIGHT - 23 }));
    this.objects.push(this.gen_bumper({ btype: 2, x: Const.LVL_CWIDTH - 23, y: Const.LVL_CHEIGHT - 23 }));

    this.objects.push(this.gen_bumper({ btype: 1, x: 50, y: 30 }));
    this.objects.push(this.gen_bumper({ btype: 1, x: Const.LVL_CWIDTH - 62, y: 30 }));
    this.objects.push(this.gen_bumper({ btype: 1, x: 50, y: Const.LVL_CHEIGHT - 42 }));
    this.objects.push(this.gen_bumper({ btype: 1, x: Const.LVL_CWIDTH - 62, y: Const.LVL_CHEIGHT - 42 }));
  }

  gen_bonus_room(bt) {
    let item, on_get_item;
    const C = J.Collide;
    switch (bt) {
      case 0: this.gen_object_room(4); return;   // B.VERTE
      case 1: this.gen_object_room(5); return;   // B.ROUGE
      case 2: item = 0; on_get_item = C.on_get_map; break;          // MAP
      case 3: item = 1; on_get_item = C.on_get_radar; break;        // RADAR
      case 4: item = 4; on_get_item = C.on_get_key; break;          // KEY
      case 5: item = 2; on_get_item = C.on_get_small_blue; break;   // SMALLTIME
      case 6: item = 3; on_get_item = C.on_get_big_blue; break;     // BIGTIME
      default: break;
    }
    if (bt !== -1) {
      const clip = this.dmanager.attach('itembox', Const.BUMPER_PLAN);
      const b = { clip, pos: Tools.pos_center(clip), hit_coef: 0.1, hit_min: 0 };
      this.fill_pos(b.pos, C.hitmap[7], b);
      Tools.set_mcpos(clip, b.pos);
      b.on_hit = C.item_box_on_hit;
      b.on_get_item = on_get_item;
      if (clip.item) clip.item.gotoAndStop(item + 1);
      this.objects.push(b);
    }
    this.objects.push(this.gen_bumper({ btype: 2, x: 7, y: 7 }));
    this.objects.push(this.gen_bumper({ btype: 2, x: Const.LVL_CWIDTH - 23, y: 7 }));
    this.objects.push(this.gen_bumper({ btype: 2, x: 7, y: Const.LVL_CHEIGHT - 23 }));
    this.objects.push(this.gen_bumper({ btype: 2, x: Const.LVL_CWIDTH - 23, y: Const.LVL_CHEIGHT - 23 }));

    this.objects.push(this.gen_bumper({ btype: 1, x: 50, y: 30 }));
    this.objects.push(this.gen_bumper({ btype: 1, x: Const.LVL_CWIDTH - 62, y: 30 }));
    this.objects.push(this.gen_bumper({ btype: 1, x: 50, y: Const.LVL_CHEIGHT - 42 }));
    this.objects.push(this.gen_bumper({ btype: 1, x: Const.LVL_CWIDTH - 62, y: Const.LVL_CHEIGHT - 42 }));
  }

  gen_normal_room(blist) {
    const C = J.Collide;
    if (blist) {
      for (let i = 0; i < blist.length; i++) {
        const b = blist[i];
        switch (b.btype) {
          case 0: break;
          case 8:
            this.bonus.push(this.gen_bonus('red', b, C.red_on_hit));
            this.bonus_reds++;
            break;
          case 9:
            this.bonus.push(this.gen_bonus('blue', b, C.blue_on_hit));
            break;
          case 15:
            this.exit = this.gen_bonus('exit', b, C.classic_exit_on_hit);
            this.exit.clip._x += 2;
            this.exit.clip._y += 2;
            this.bonus.push(this.exit);
            this.exit.clip.stop();
            break;
          default:
            this.objects.push(this.gen_bumper(b));
            break;
        }
      }
    }
    this.finalize_zappers();
  }

  finalize_zappers() {
    const zappers = [];
    let sx, sy;
    for (let i = 0; i < this.objects.length; i++) {
      const b = this.objects[i];
      if (b && b.btype === 14) {
        let zaps = zappers[b.phase];
        if (zaps == null) {
          zaps = [];
          zappers[b.phase] = zaps;
          if (sx === undefined) {
            const s = Tools.mc_size(b.clip);
            sx = s.w / 2;
            sy = s.h / 2;
          }
        }
        zaps.push(b);
      }
    }
    for (let i = 0; i < zappers.length; i++) {
      const zaps = zappers[i];
      if (!zaps) continue;
      for (let j = 0; j < zaps.length; j++) {
        for (let k = j + 1; k < zaps.length; k++) this.trace_zappers(zaps[j], zaps[k], sx, sy);
      }
    }
  }

  trace_zappers(z1, z2, sx, sy) {
    const col = { phase: z1.phase, on_hit: J.Collide.zapper_line_on_hit, is_event: true, z1, z2 };
    let dx = z2.x - z1.x;
    let dy = z2.y - z1.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    dx /= d;
    dy /= d;
    const len = int(d) + 1;
    let x = z1.x + sx;
    let y = z1.y + sy;
    for (let l = 0; l < len; l++) {
      const c = this.coltable[int(x)];
      if (c) c[int(y)] = col;
      x += dx;
      y += dy;
    }
  }

  gen_bumper(b) {
    const C = J.Collide;
    let bname;
    let upper = true;
    switch (b.btype) {
      case 1: bname = 'bnormal'; b.on_hit = C.bumper_normal_on_hit; b.hit_coef = 1.5; b.hit_min = 20; break;
      case 2: bname = 'btime'; b.on_hit = C.bumper_time_on_hit; b.hit_coef = 1.5; b.hit_min = 15; break;
      case 3: bname = 'bdeath'; b.on_hit = C.bumper_death_on_hit; b.hit_coef = 1.2; b.hit_min = 5; break;
      case 4: bname = 'bmagnet'; b.on_hit = C.bumper_magnet_on_hit; b.hit_coef = 1.0; b.hit_min = 5; break;
      case 5: bname = 'bshadow'; b.on_hit = C.bumper_shadow_on_hit; b.hit_coef = 3.0; b.hit_min = 15; break;
      case 6:
        bname = 'wall'; b.on_hit = C.wall_on_hit; b.hit_coef = 1.2; b.hit_min = 0;
        this.interf.fill_wall(b, b);
        break;
      case 10: upper = false; bname = 'bteleport'; break;
      case 11: bname = 'interupt'; b.on_hit = C.interupt_on_hit; b.hit_coef = 1.2; b.hit_min = 0; break;
      case 12:
        upper = false; bname = 'interred';
        b.on_hit = C.interupt_flag ? C.interblock_on_hit : null; b.hit_coef = 1.2; b.hit_min = 0;
        break;
      case 13:
        upper = false; bname = 'interblue';
        b.on_hit = C.interupt_flag ? null : C.interblock_on_hit; b.hit_coef = 1.2; b.hit_min = 0;
        break;
      case 14:
        bname = (J.Manager.play_mode === Const.MODE_COURSE) ? 'checkpoint' : 'zapper';
        b.on_hit = C.zapper_on_hit; b.hit_coef = 1.1; b.hit_min = 10;
        break;
      case 7:   // TROU
        this.interf.ground._visible = true;
        this.interf.fill_wall(b, b);
        return null;
      default: break;
    }

    const clip = this.dmanager.attach(bname, upper ? Const.BUMPER_PLAN : Const.SHADE_PLAN);
    this.fill_pos(b, C.hitmap[b.btype - 1], b);
    Tools.set_mcpos(clip, b);
    b.clip = clip;
    if (b.btype !== 5 && b.btype !== 6 && b.btype !== 10 && b.btype !== 12 && b.btype !== 13) {
      b.shade = this.dmanager.attach('ombre', Const.SHADE_PLAN);
      b.shade._x = b.clip._x;
      b.shade._y = b.clip._y;
      b.shade.gotoAndStop(b.btype);
    }

    switch (b.btype) {
      case 4:
        b.way = true;
        b.clip.gotoAndPlay('plus');
        b.on_update = C.bumper_magnet_on_update;
        this.updates.push(b);
        break;
      case 5:
        b.clip._visible = false;
        b.clip._alpha = 0;
        b.on_update = C.bumper_shadow_on_update;
        this.updates.push(b);
        break;
      case 2:
        b.on_update = C.bumper_time_on_update;
        b.curtime = this.game.curtime;
        b.on_update(this.game, b);
        this.updates.push(b);
        break;
      case 10:
        b.on_update = C.bumper_teleport_on_update;
        this.updates.push(b);
        b.clip.num = 5;
        for (let i = 0; i < b.clip.num; i++) {
          if (i > 0 && b.clip.c0) b.clip.c0.duplicateMovieClip('c' + i, i);
          const mc = b.clip['c' + i];
          if (!mc) continue;
          if (mc.gfx) { mc.gfx._y = random(6); mc.gfx._rotation = random(360); }
          mc.rot = 3 + random(3);
          mc.c = random(628);
        }
        break;
      case 11:
      case 13:
        b.clip._x -= 2;
        b.clip._y -= 2;
        b.clip.gotoAndStop(C.interupt_flag ? 'on' : 'off');
        break;
      case 12:
        b.clip.gotoAndStop(C.interupt_flag ? 'off' : 'on');
        break;
      case 14: {
        const s = Tools.mc_size(b.clip);
        if (J.Manager.play_mode === Const.MODE_COURSE) b.phase = 0;
        else {
          b.phase = ((b.x - s.w / 2) + (b.y - s.h / 2)) % 7;
          b.clip.gotoAndStop(1 + b.phase);
        }
        break;
      }
      default: break;
    }
    return b;
  }

  gen_bonus(bname, b, on_hit) {
    const clip = this.dmanager.attach(bname, Const.BONUS_PLAN);
    Tools.set_mcpos(clip, b);
    b.bname = bname;
    b.clip = clip;
    b.on_hit = on_hit;
    return b;
  }

  set_door_collide(d, v, delta) {
    if (delta === undefined) delta = 0;
    const ct = this.coltable;
    const poser = (x, y) => { const c = ct[x]; if (c) c[y] = v; };
    switch (d) {
      case 0:
        for (let x = 0; x < Const.BORDER_CSIZE; x++) for (let y = -delta; y < Const.DOOR_CSIZE + delta; y++) poser(x, y + Const.DOOR_CYPOS);
        break;
      case 1:
        for (let x = 0; x < Const.BORDER_CSIZE; x++) for (let y = -delta; y < Const.DOOR_CSIZE + delta; y++) poser(Const.LVL_CWIDTH - 1 - x, y + Const.DOOR_CYPOS);
        break;
      case 2:
        for (let x = -delta; x < Const.DOOR_CSIZE + delta; x++) for (let y = 0; y < Const.BORDER_CSIZE; y++) poser(x + Const.DOOR_CXPOS, y);
        break;
      case 3:
        for (let x = -delta; x < Const.DOOR_CSIZE + delta; x++) for (let y = 0; y < Const.BORDER_CSIZE; y++) poser(x + Const.DOOR_CXPOS, Const.LVL_CHEIGHT - 1 - y);
        break;
      default: break;
    }
  }

  clean_room() {
    for (let i = 0; i < this.objects.length; i++) {
      const o = this.objects[i];
      if (!o) continue;
      if (o.clip) o.clip.removeMovieClip();
      if (o.shade) o.shade.removeMovieClip();
    }
    for (let i = 0; i < this.bonus.length; i++) if (this.bonus[i] && this.bonus[i].clip) this.bonus[i].clip.removeMovieClip();
    for (let i = 0; i < this.dummies.length; i++) if (this.dummies[i].clip) this.dummies[i].clip.removeMovieClip();
    if (this.exit && this.exit.clip) this.exit.clip.removeMovieClip();
    this.exit = null;
    this.interf.holes.clear();
    this.interf.shades.clear();
    this.interf.ground._visible = false;
  }

  change_room(dx, dy) {
    this.clean_room();
    this.interf.change_room(dx, dy);
  }

  max(a, b) { return a < b ? b : a; }

  // Le test de collision de la bille en (x, y) : seize points sur son
  // cercle ; avec effets de bord (side_effects), les gestionnaires sont
  // appelés et le rebond calculé ; sans, on ne fait que dire s'il y a
  // quelque chose — c'est ce que recall() demande.
  col_test(x, y, side_effects) {
    const game = this.game;
    const asteps = 16;
    let first_col = 0, n_col = 0, tot = 0, hit_coef = 0, hit_min = 0;
    let first_ct, fpx, fpy;
    let ang;
    const in_ang = Math.atan2(game.ball.sy, game.ball.sx);   // angle d'approche
    for (let i = 0; i < asteps; i++) {
      ang = (Math.PI * 2) * i / asteps;
      const px = int((x + Math.cos(ang) * Const.BALL_RAYSIZE + Const.DELTA / 2) / Const.DELTA);
      const py = int((y + Math.sin(ang) * Const.BALL_RAYSIZE + Const.DELTA / 2) / Const.DELTA);
      const col = this.coltable[px];
      const ct = col ? col[py] : undefined;
      if (ct && ct.on_hit) {
        if (ct.is_event) {
          if (side_effects) ct.on_hit(game, ct, px, py);
        } else {
          if (!side_effects) return true;
          hit_coef = this.max(ct.hit_coef, hit_coef);
          hit_min = this.max(ct.hit_min, hit_min);
          if (n_col === 0) {
            first_col = i;
            first_ct = ct;
            fpx = px;
            fpy = py;
          } else {
            first_ct.on_hit(game, first_ct, fpx, fpy);
            ct.on_hit(game, ct, px, py);
            if (i - first_col < asteps / 2) tot += i - first_col;
            else tot += i - asteps - first_col;
          }
          n_col++;
        }
      }
    }
    if (n_col > 1) {
      tot /= n_col;
      tot += first_col;
      if (tot < 0) tot += asteps;
      ang = (Math.PI * 2) * tot / asteps - Math.PI;   // angle de la collision
      let speed = game.ball.speed * hit_coef;           // vitesse d'approche
      if (speed < hit_min) speed = hit_min;
      const out_ang = ang + Math.PI - (in_ang - ang) + Math.random() / 100;   // rebond
      if (Math.abs(Tools.rad_dif(in_ang, ang)) > Math.PI / 2 + 0.05) {
        game.ball.sx = speed * Math.cos(out_ang);
        game.ball.sy = speed * Math.sin(out_ang);
        // recalage selon la densité du choc
        game.ball.x += Math.cos(out_ang) * Std.tmod * Math.min(n_col * n_col / 10, 3);
        game.ball.y += Math.sin(out_ang) * Std.tmod * Math.min(n_col * n_col / 10, 3);
        return true;
      }
    }
    return false;
  }
}
J.Level = Level;

// ── Interf ────────────────────────────────────────────────────────────────
class Interf {
  constructor(game) {
    this.game = game;
    const dmanager = game.dmanager;
    this.doors = [];
    for (let d = 0; d < 4; d++) {
      let door = dmanager.attach('door', Const.DOOR_PLAN);
      this.doors[d] = door;
      const b = Const.BORDER_SIZE / 2;
      switch (d) {
        case 0: door.sx = b; door.sy = Const.LVL_HEIGHT / 2; door._rotation = -90; break;
        case 1: door.sx = Const.LVL_WIDTH - b; door.sy = Const.LVL_HEIGHT / 2; door._rotation = 90; break;
        case 2: door.sx = Const.LVL_WIDTH / 2; door.sy = b; break;
        case 3: door.sx = Const.LVL_WIDTH / 2; door.sy = Const.LVL_HEIGHT - b; door._rotation = 180; break;
        default: break;
      }
      door._x = door.sx;
      door._y = door.sy;
      door.stop();
      if (door.porteA) door.porteA.stop();
      if (door.porteB) door.porteB.stop();

      door = dmanager.attach('door', Const.DOOR_PLAN);
      door.stop();
      if (door.porteA) door.porteA.stop();
      if (door.porteB) door.porteB.stop();
      this.doors[d + 4] = door;
      door._rotation = this.doors[d]._rotation;
      door._visible = false;
    }
    this.bg1 = dmanager.attach('background', Const.BG_PLAN);
    this.bg2 = dmanager.attach('background', Const.BG_PLAN);
    this.ground = dmanager.attach('ground', Const.HOLE_PLAN);
    this.holes = dmanager.empty(Const.HOLE_PLAN);
    this.shades = dmanager.empty(Const.SHADE_PLAN - 1);
    this.decor1 = dmanager.attach('border', Const.DECOR_PLAN);
    this.decor2 = dmanager.attach('border', Const.DECOR_PLAN);
    this.tview = dmanager.attach('time counter', Const.ICON_PLAN);

    switch (J.Manager.play_mode) {
      case Const.MODE_CLASSIC: this.tview.gotoAndStop('classic'); break;
      case Const.MODE_COURSE: this.tview.gotoAndStop('time'); break;
      default: this.tview.gotoAndStop(1); break;
    }

    this.tview._x = Const.LVL_WIDTH;
    this.bg2.stop();
    this.bg2._visible = false;
    this.decor2._visible = false;
    this.ground.setMask(this.holes);
    this.ground._visible = false;

    this.walltable = [];
    this.old_time = undefined;
    this.scroll_dx = 0; this.scroll_dy = 0; this.scroll_x = 0; this.scroll_y = 0; this.scroll_end = false;
    this.save_tmod = undefined;
  }

  // La case de la grille des murs, ou undefined hors grille — comme l'AS2.
  caseMur(x, y) { const col = this.walltable[x]; return col ? col[y] : undefined; }
  typeMur(x, y) { const c = this.caseMur(x, y); return c ? c.btype : undefined; }

  init_room() {
    const WWIDTH = int(Const.LVL_CWIDTH / 10);
    this.walltable = [];
    for (let x = 0; x < WWIDTH; x++) this.walltable[x] = [];
    this.bg1.gotoAndStop(this.selectBg(this.game.level.pos_x, this.game.level.pos_y));
  }

  init_doors(ddelta) {
    const game = this.game, C = J.Collide;
    const room = game.level.dungeon[game.level.pos_x][game.level.pos_y];
    for (let d = 0; d < 4; d++) {
      const p = room.paths[d];
      const door = this.doors[ddelta + d];
      let pt = p.ptype;
      if (pt === 3 && J.Manager.play_mode !== Const.MODE_CHALLENGE) pt = -2;
      switch (pt) {
        case -2: {   // ONE-WAY
          let x = game.ball.x;
          let y = game.ball.y;
          if (ddelta !== 0) {
            x -= this.scroll_dx * Const.LVL_WIDTH;
            y -= this.scroll_dy * Const.LVL_HEIGHT;
          }
          if ((d === 0 && this.scroll_dx === 1) || (d === 1 && this.scroll_dx === -1)
            || (d === 2 && this.scroll_dy === 1) || (d === 3 && this.scroll_dy === -1)) {
            if (ddelta === 0) {
              game.level.updates.push({ d, validate: (p.ptype === -2), on_update: C.autoclose_door_on_update });
            }
            door.gotoAndStop('opened');
            game.level.set_door_collide(d, C.border_collide_no_recal, Const.DOOR_COLLIDE_DELTA);
            game.level.set_door_collide(d, null);
          } else {
            door.gotoAndStop('off');
            game.level.set_door_collide(d, C.border_collide);
          }
          break;
        }
        case -1:   // OPEN
          door.gotoAndStop('opened');
          game.level.set_door_collide(d, C.border_collide_no_recal, Const.DOOR_COLLIDE_DELTA);
          game.level.set_door_collide(d, null);
          break;
        case 0:    // DOOR
        case 3: {  // NEED
          door.gotoAndStop(game.level.bonus_reds ? 'off' : 'on');
          const o = { on_hit: C.door_on_hit, hit_coef: C.border_collide.hit_coef, hit_min: C.border_collide.hit_min, d };
          game.level.set_door_collide(d, o);
          break;
        }
        case 2:    // INVISIBLE
          door.gotoAndStop('nodoor' + d);
          game.level.set_door_collide(d, C.border_collide_no_recal, Const.DOOR_COLLIDE_DELTA);
          game.level.set_door_collide(d, null);
          break;
        case 1:    // NO DOOR
        default:   // NO ROOM
          door.gotoAndStop('nodoor' + d);
          game.level.set_door_collide(d, C.border_collide);
          break;
      }
      const pA = door.porteA, pB = door.porteB;
      if (pA && pB) {
        switch (d) {
          case 0: pA.gotoAndStop(2); pB.gotoAndStop(1); break;
          case 1: pA.gotoAndStop(3); pB.gotoAndStop(4); break;
          case 2: pA.gotoAndStop(1); pB.gotoAndStop(2); break;
          case 3: pA.gotoAndStop(4); pB.gotoAndStop(3); break;
          default: break;
        }
      }
    }
  }

  open_doors() {
    const exit = this.game.level.exit;
    if (exit != null) exit.clip.gotoAndPlay('anim_open');
    for (let d = 0; d < 4; d++) this.open_door(d);
  }

  open_door(d) {
    const game = this.game, C = J.Collide;
    const room = game.level.dungeon[game.level.pos_x][game.level.pos_y];
    const p = room.paths ? room.paths[d] : undefined;
    if (!p) return;
    if (p.ptype === 0 || p.ptype === 3) {   // DOOR | NEED
      if (p.ptype === 3 && J.Manager.play_mode !== Const.MODE_CHALLENGE) {
        p.ptype = -2;
        return;
      }
      p.ptype = -1;
      this.doors[d].gotoAndPlay('open');
      game.level.set_door_collide(d, C.border_collide_no_recal, Const.DOOR_COLLIDE_DELTA);
      game.level.set_door_collide(d, null);
    }
  }

  update_walls() {
    const WWIDTH = int(Const.LVL_CWIDTH / 10);
    const WHEIGHT = int(Const.LVL_CHEIGHT / 10);
    if (this.holes === undefined) return;

    this.holes.clear();
    this.shades.clear();
    for (let x = 0; x < WWIDTH; x++) {
      for (let y = 0; y < WHEIGHT; y++) {
        const b = this.caseMur(x, y);
        if (b) {
          let frame = 0;
          if (this.typeMur(x - 1, y) === b.btype) frame += 1;
          if (this.typeMur(x, y - 1) === b.btype) frame += 2;
          if (this.typeMur(x + 1, y) === b.btype) frame += 4;
          if (this.typeMur(x, y + 1) === b.btype) frame += 8;
          if (b.btype === 7) {   // HOLE
            const w = Const.DELTA * 10;
            let h = 0;
            const px = (Const.BORDER_CSIZE + x * 10) * Const.DELTA + 1;
            const py = (Const.BORDER_CSIZE + y * 10) * Const.DELTA + 1;
            if (y > 0 && (frame & 2) === 0) {
              h = Const.HOLE_BORDER_SIZE;
              this.shades.moveTo(px, py);
              this.shades.beginFill(0x9B76BC);
              this.shades.lineTo(px + w, py);
              this.shades.lineTo(px + w, py + Const.HOLE_BORDER_SIZE);
              this.shades.lineTo(px, py + Const.HOLE_BORDER_SIZE);
              this.shades.endFill();
            }
            this.holes.moveTo(px, py + h);
            this.holes.beginFill(0);
            this.holes.lineTo(px + w, py + h);
            this.holes.lineTo(px + w, py + w);
            this.holes.lineTo(px, py + w);
            this.holes.endFill();
          }
          b.frame = frame;
          if (b.clip) b.clip.gotoAndStop(frame + 1);
        }
      }
    }
    const decal = 4;
    for (let x = 0; x < WWIDTH; x++) {
      for (let y = 0; y < WHEIGHT; y++) {
        const b = this.caseMur(x, y);
        if (b && b.btype === 6) {   // WALL
          let p = null;
          if ((b.frame & 2) === 0) {
            let dy = 1;
            while (this.typeMur(x, y + dy) === 6) dy++;
            p = {
              x: (Const.BORDER_CSIZE + x * 10) * Const.DELTA + decal,
              y: (Const.BORDER_CSIZE + y * 10) * Const.DELTA + decal,
              w: 10 * Const.DELTA,
              h: dy * 10 * Const.DELTA,
            };
            Tools.drawSmoothSquare(this.shades, p, 0, 8, 20);
          }
          if ((b.frame & 1) === 0) {
            let dx = 1;
            while (this.typeMur(x + dx, y) === 6) dx++;
            if (p === null) {
              p = {
                x: (Const.BORDER_CSIZE + x * 10) * Const.DELTA + decal,
                y: (Const.BORDER_CSIZE + y * 10) * Const.DELTA + decal,
              };
            }
            p.w = dx * 10 * Const.DELTA;
            p.h = 10 * Const.DELTA;
            Tools.drawSmoothSquare(this.shades, p, 0, 8, 20);
          }
        }
      }
    }
  }

  fill_wall(b, v) {
    const col = this.walltable[int((b.x - Const.BORDER_CSIZE) / 10)];
    if (col) col[int((b.y - Const.BORDER_CSIZE) / 10)] = v;
  }

  scroll_room() {
    const game = this.game;
    const tmod = Std.tmod;
    this.scroll_x -= this.scroll_dx * tmod * (Const.LVL_WIDTH / 20);
    this.scroll_y -= this.scroll_dy * tmod * (Const.LVL_HEIGHT / 20);
    if (this.scroll_end) {
      game.scroll_on = false;
      this.bg2._visible = false;
      this.decor2._visible = false;
      for (let d = 0; d < 4; d++) this.doors[d + 4]._visible = false;
      game.ball.x -= this.scroll_dx * Const.LVL_WIDTH;
      game.ball.y -= this.scroll_dy * Const.LVL_HEIGHT;
      this.scroll_x = 0;
      this.scroll_y = 0;
      Std.tmod = this.save_tmod;
      game.next_room();
    }
    if (Math.abs(this.scroll_x) >= Math.abs(this.scroll_dx * Const.LVL_WIDTH) && Math.abs(this.scroll_y) >= Math.abs(this.scroll_dy * Const.LVL_HEIGHT)) {
      this.scroll_end = true;
      this.scroll_x = -this.scroll_dx * Const.LVL_WIDTH;
      this.scroll_y = -this.scroll_dy * Const.LVL_HEIGHT;
    }
    this.bg2._x = this.scroll_dx * Const.LVL_WIDTH + this.scroll_x;
    this.bg2._y = this.scroll_dy * Const.LVL_HEIGHT + this.scroll_y;
    this.decor2._x = this.bg2._x;
    this.decor2._y = this.bg2._y;
    this.bg1._x = this.scroll_x;
    this.bg1._y = this.scroll_y;
    this.decor1._x = this.scroll_x;
    this.decor1._y = this.scroll_y;
    game.ball.mc._x = game.ball.x + this.scroll_x;
    game.ball.mc._y = game.ball.y + this.scroll_y;
    game.ball.shadow._x = game.ball.mc._x + J.Ball.SHADOW_DECAL;
    game.ball.shadow._y = game.ball.mc._y + J.Ball.SHADOW_DECAL;
    for (let d = 0; d < 4; d++) {
      const door = this.doors[d];
      door._x = this.doors[d].sx + this.scroll_x;
      door._y = this.doors[d].sy + this.scroll_y;
    }
    for (let d = 0; d < 4; d++) {
      const door = this.doors[d + 4];
      door._x = this.doors[d].sx + this.scroll_x + this.scroll_dx * Const.LVL_WIDTH;
      door._y = this.doors[d].sy + this.scroll_y + this.scroll_dy * Const.LVL_HEIGHT;
    }
  }

  static makeTime(t) {
    return Interf.padNumber(int(t / 6000), 2) + ':' + Interf.padNumber(int(t / 100) % 60, 2) + ':' + Interf.padNumber(t % 100, 2);
  }
  static padNumber(x, n) {
    x = '' + x;
    while (x.length < n) x = '0' + x;
    return x;
  }

  update() {
    const game = this.game, tview = this.tview;
    if (J.Manager.play_mode === Const.MODE_COURSE) {
      if (tview.lap_txt) tview.lap_txt.text = game.course_nturns - 1;
      if (tview._currentframe !== 11) {
        this.old_time = 1.5;
        return;
      }
      if (this.old_time > 0) {
        this.old_time -= Std.deltaT;
        return;
      }
      const tp = tview.timerPanel;
      if (tp) {
        tp.min_txt.text = Interf.padNumber(int(game.curtime / 60), 2);
        tp.sec_txt.text = Interf.padNumber(int(game.curtime) % 60, 2);
        tp.mil_txt.text = Interf.padNumber(int(game.curtime * 100) % 100, 2);
      }
    } else {
      const t = int(game.curtime / 100);
      if (this.old_time !== t) {
        this.old_time = t;
        if (tview.tview_txt) tview.tview_txt.text = t;
      }
    }
  }

  selectBg(x, y) { return 1 + (x + y) % 4; }

  change_room(dx, dy) {
    const game = this.game;
    this.save_tmod = Std.tmod;
    this.scroll_x = 0;
    this.scroll_y = 0;
    this.scroll_dx = dx;
    this.scroll_dy = dy;
    this.bg2._visible = true;
    this.decor2._visible = true;
    this.bg2._x = -1000;
    this.decor2._x = -1000;
    for (let d = 0; d < 4; d++) {
      const door = this.doors[d + 4];
      door._visible = true;
      door._x = -1000;
      door._y = -1000;
    }
    game.level.pos_x += this.scroll_dx;
    game.level.pos_y += this.scroll_dy;
    this.bg2.gotoAndStop(this.selectBg(game.level.pos_x, game.level.pos_y));

    let dir;
    if (dx < 0) dir = 1;
    else if (dx > 0) dir = 0;
    else if (dy < 0) dir = 3;
    else if (dy > 0) dir = 2;
    this.open_door(dir);
    // les portes ne s'ouvrent pas toutes seules :)
    game.level.bonus_reds = 1;
    this.init_doors(4);
    game.scroll_on = true;
    this.scroll_end = false;
    this.scroll_room();
  }
}
J.Interf = Interf;

// ── Collide ───────────────────────────────────────────────────────────────
const Collide = {
  game: null,
  hitmap: null,
  border_collide: null,
  border_collide_no_recal: null,
  frame_nb: 0,
  interupt_flag: false,

  init(game) {
    Collide.game = game;
    Collide.hitmap = [];
    const bumpers = ['bnormal', 'btime', 'bdeath', 'bmagnet', 'bshadow', 'wall', 'wall', 'itembox'];
    for (let i = 0; i < bumpers.length; i++) Collide.hitmap[i] = Collide.gen_hitmap(bumpers[i]);
    Collide.hitmap[10] = Collide.gen_hitmap('interupt');
    Collide.hitmap[11] = Collide.hitmap[5];
    Collide.hitmap[12] = Collide.hitmap[5];
    Collide.hitmap[13] = Collide.gen_hitmap('zapper');
    Collide.interupt_flag = false;
    Collide.border_collide = { on_hit: Collide.border_on_hit, is_border: true, hit_min: 4, hit_coef: 1.1 };
    Collide.border_collide_no_recal = { on_hit: Collide.border_on_hit_no_recal, is_border: true, hit_min: 4, hit_coef: 1.1 };
  },

  // La silhouette d'un clip, échantillonnée à la grille de 4 px (hitTest
  // en coordonnées globales : d'où POS_X/POS_Y, la position du jeu).
  gen_hitmap(item) {
    const mc = Collide.game.dmanager.attach(item, 0);
    const msize = Tools.mc_size(mc);
    const dx = Const.DELTA / 2 - (msize.w / 2) * Const.DELTA;
    const dy = Const.DELTA / 2 - (msize.h / 2) * Const.DELTA;
    const ctbl = new Array(msize.w);
    for (let x = 0; x < msize.w; x++) {
      ctbl[x] = new Array(msize.h);
      for (let y = 0; y < msize.h; y++) {
        ctbl[x][y] = !!mc.hitTest(x * Const.DELTA + dx + Const.POS_X, y * Const.DELTA + dy + Const.POS_Y, true);
      }
    }
    mc.removeMovieClip();
    return ctbl;
  },

  on_get_map(game) { game.options.has_map = true; game.setPause(); },
  on_get_radar(game) { game.options.has_radar = true; game.setPause(true); },
  on_get_key(game) { game.options.grelot_count += 3; game.options.update_icons(); },
  on_get_small_blue(game) { if (J.Manager.play_mode !== Const.MODE_COURSE) game.curtime += 1 * 60 * 1000; },
  on_get_big_blue(game) { if (J.Manager.play_mode !== Const.MODE_COURSE) game.curtime += 3 * 60 * 1000; },

  gen_hit(game, px, py) {
    const hit = game.dmanager.attach('hit', Const.DUMMY_PLAN);
    hit._x = px * Const.DELTA + Const.DELTA / 2;
    hit._y = py * Const.DELTA + Const.DELTA / 2;
    // (sy, sy) : tel quel dans le source.
    hit._rotation = Math.atan2(game.ball.sy, game.ball.sy) * 180 / Math.PI;
  },

  border_on_hit(game, mc, px, py) {
    Collide.gen_hit(game, px, py);
    let size = Const.BORDER_SIZE + Const.DELTA;
    if (game.ball.x < size) game.ball.x = size;
    if (game.ball.y < size) game.ball.y = size;
    size += Const.DELTA * 2;
    if (game.ball.x > Const.LVL_WIDTH - size) game.ball.x = Const.LVL_WIDTH - size;
    if (game.ball.y > Const.LVL_HEIGHT - size) game.ball.y = Const.LVL_HEIGHT - size;
    Sound.play(Sound.WALL_HIT);
  },

  border_on_hit_no_recal(game, mc, px, py) {
    Collide.gen_hit(game, px, py);
    Sound.play(Sound.WALL_HIT);
  },

  item_box_on_hit(game, mc, px, py) {
    if (mc.item === -1) return;
    Sound.play(Sound.GET_ITEM);
    Collide.gen_hit(game, px, py);
    game.level.fill_pos(mc.pos, Collide.hitmap[7], null);
    mc.clip.gotoAndPlay('hit');
    game.level.dungeon[game.level.pos_x][game.level.pos_y].rdata = -1;
    mc.on_get_item(game);
    mc.item = -1;
    game.options.update_icons();
  },

  red_on_hit(game, mc) {
    game.level.bonus_reds--;
    if (game.level.bonus_reds === 0) {
      game.level.interf.open_doors();
      Sound.play(Sound.OPEN_DOOR);
    }
    mc.clip.gotoAndPlay('hit');
    Sound.play(Sound.GET_RED);
    return true;
  },

  classic_exit_on_hit(game, mc) {
    if (!mc.clip.flOpen) return false;
    game.ball.classic_mask = game.dmanager.attach('maskHole', Const.BUMPER_PLAN);
    game.ball.classic_mask._x = mc.clip._x;
    game.ball.classic_mask._y = mc.clip._y;
    game.ball.mc.setMask(game.ball.classic_mask);
    game.ball.hole_death_speed = 3;
    game.ball.death_hit = false;
    game.ball.hole_death = true;
    game.ball.shadow._visible = false;
    return true;
  },

  blue_on_hit(game, mc) {
    if (J.Manager.play_mode === Const.MODE_COURSE) game.curtime -= 1;            // 1 sec
    else if (J.Manager.play_mode === Const.MODE_CLASSIC) game.curtime += 2 * 1000;   // 2 sec
    else game.curtime += 10 * 1000;                                              // 10 sec
    mc.clip.gotoAndPlay('hit');
    Sound.play(Sound.GET_BLUE);
    return true;
  },

  bumper_normal_on_hit(game, mc) {
    if (mc.clip._currentframe === 1) {
      mc.clip.gotoAndPlay('hit');
      Sound.play(Sound.BUMPER_NORMAL);
    }
  },

  bumper_time_on_hit(game, mc) {
    if (mc.clip._currentframe === 1) {
      mc.clip.gotoAndPlay('hit');
      Sound.play(Sound.BUMPER_TIME);
      if (J.Manager.play_mode === Const.MODE_COURSE) game.curtime += 5;   // 5 sec
      else game.curtime -= 5000;
    }
  },

  bumper_death_on_hit(game, mc) {
    if (game.ball.btype !== 5 && game.ball.clign_count <= 0) {   // METAL
      Sound.play(Sound.BUMPER_DEATH);
      mc.clip.gotoAndPlay('hit');
      game.ball.die();
    } else Sound.play(Sound.BUMPER_DEATH_PROTECT);
  },

  bumper_magnet_on_hit(game, mc) {
    if (mc.way) {
      mc.way = false;
      Sound.play(Sound.BUMPER_MAGNET);
      mc.clip.gotoAndPlay('neg');
    }
  },

  bumper_shadow_on_hit(game, mc) {
    if (mc.clip._currentframe === 1) {
      Sound.play(Sound.BUMPER_SHADOW);
      mc.clip.gotoAndPlay('hit');
      if (game.ball.btype !== 6) {
        mc.alpha = 100;
        mc.clip._alpha = 100;
        mc.clip._visible = true;
      }
    }
  },

  door_on_hit(game, mc, px, py) {
    const room = game.level.dungeon[game.level.pos_x][game.level.pos_y];
    if (game.options.grelot_count > 0 && room.paths[mc.d].ptype !== -1) {
      game.options.grelot_count--;
      game.options.update_icons();
      Sound.play(Sound.GRELOT);
      game.level.interf.open_door(mc.d);
    } else Collide.border_on_hit(game, mc, px, py);
  },

  wall_on_hit(game, mc, px, py) {
    if (game.ball.btype === 1) {   // VERTE
      if (mc.btype === 0) return;
      Sound.play(Sound.GREEN_BLOCK_DESTROY);
      game.level.erase_pos(mc);
      game.level.interf.fill_wall(mc, null);
      game.level.interf.update_walls();
      if (mc.shade) mc.shade.removeMovieClip();
      mc.clip.removeMovieClip();
      mc.old_btype = mc.btype;
      mc.btype = 0;
      const ballang = Math.atan2(game.ball.sy, game.ball.sx);
      const sfact = game.ball.speed;
      for (let i = 0; i < 4; i++) {
        const speed = (Math.random() * (sfact / 2) + sfact / 2) / 4 + 1;
        const ang = (Math.random() - 0.5) + ballang;
        const p = {};
        p.clip = game.dmanager.attach('wallpart', Const.DUMMY_PLAN);
        p.clip._rotation = random(360);
        p.x = random(10 * Const.DELTA) + mc.x * Const.DELTA;
        p.y = random(10 * Const.DELTA) + mc.y * Const.DELTA;
        p.rspeed = speed;
        p.sx = Math.cos(ang) * speed;
        p.sy = Math.sin(ang) * speed;
        p.on_update = Collide.wall_dummy_on_update;
        p.stime = 50;
        p.time = 30;
        game.level.updates.push(p);
        game.level.dummies.push(p);
      }
    } else {
      Sound.play(Sound.GREEN_BLOCK_HIT);
      Collide.gen_hit(game, px, py);
    }
  },

  zapper_on_hit(game, mc, px, py) {
    Sound.play(Sound.ZAPPER_HIT);
    Collide.gen_hit(game, px, py);
  },

  zapper_line_on_hit(game, mc) {
    if (J.Manager.play_mode === Const.MODE_COURSE) {
      game.course_turn_done();
      return;
    }
    if (game.ball.btype !== mc.phase) {
      const flashLine = game.dmanager.attach('flashLine', Const.DUMMY_PLAN);
      flashLine._x = mc.z1.clip._x;
      flashLine._y = mc.z1.clip._y;
      if (flashLine.gfx) flashLine.gfx.gotoAndStop(mc.phase + 1);
      const difx = mc.z2.clip._x - mc.z1.clip._x;
      const dify = mc.z2.clip._y - mc.z1.clip._y;
      const dist = Math.sqrt(difx * difx + dify * dify);
      flashLine._width = dist;
      flashLine._rotation = Math.atan2(dify, difx) / (Math.PI / 180);
      Sound.play(Sound.ZAPPER_ACTIVATE);
      game.ball.die();
    }
  },

  interblock_on_hit(game, mc, px, py) {
    Sound.play(Sound.INTER_BLOCK_HIT);
    Collide.gen_hit(game, px, py);
  },

  interupt_on_hit(game, mc, px, py) {
    if (mc.last_frame_hit == null || mc.last_frame_hit < Collide.frame_nb - 20) {
      mc.last_frame_hit = Collide.frame_nb;
      Sound.play(Sound.INTERUPT_HIT);
      Collide.gen_hit(game, px, py);
      Collide.interupt_flag = !Collide.interupt_flag;
      const bumpers = game.level.objects;
      for (let i = 0; i < bumpers.length; i++) {
        const b = bumpers[i];
        if (!b) continue;
        const t = b.btype;
        if (t === 11) {
          b.clip.gotoAndPlay(Collide.interupt_flag ? 'playOn' : 'playOff');
        } else if (t === 13) {
          b.clip.gotoAndPlay(Collide.interupt_flag ? 'playOn' : 'playOff');
          b.on_hit = Collide.interupt_flag ? null : Collide.interblock_on_hit;
        } else if (t === 12) {
          b.clip.gotoAndPlay(Collide.interupt_flag ? 'playOff' : 'playOn');
          b.on_hit = Collide.interupt_flag ? Collide.interblock_on_hit : null;
        }
      }
    }
  },

  bumper_magnet_on_update(game, mc) {
    if (game.ball.btype === 5) return;
    const tmod = Std.tmod;
    const d = Tools.dist2(game.ball.mc, mc.clip);
    if (d < 30000) {
      const w = mc.way ? 1 : -1;
      const dx = (mc.clip._x - game.ball.mc._x) / d;
      const dy = (mc.clip._y - game.ball.mc._y) / d;
      game.ball.sx += w * dx * 30 * tmod;
      game.ball.sy += w * dy * 30 * tmod;
    }
    if (mc.way === false && random(1000 / Std.tmod) === 0) {
      mc.way = true;
      mc.clip.gotoAndPlay('plus');
    }
  },

  bumper_shadow_on_update(game, mc) {
    const tmod = Std.tmod;
    if (game.ball.btype === 6) {   // VIOLET
      const d = Tools.dist2(game.ball.mc, mc.clip);
      mc.alpha = int(200000 / d);
      if (mc.alpha <= 0) mc.alpha = 0;
      if (mc.alpha > 100) mc.alpha = 100;
      mc.clip._visible = (mc.alpha > 0);
      mc.clip._alpha = mc.alpha;
    } else if (mc.alpha > 0) {
      mc.alpha -= tmod * 4;
      if (mc.alpha <= 0) {
        mc.alpha = 0;
        mc.clip._visible = false;
      }
      mc.clip._alpha = mc.alpha;
    }
  },

  bumper_time_on_update(game, mc) {
    mc.curtime = mc.curtime * 0.95 + game.curtime * 0.05;
    if (mc.clip.aig) mc.clip.aig._rotation = -(mc.curtime / 3600);
    if (mc.clip.aig2) mc.clip.aig2._rotation = -(mc.curtime % 3600) / 10;
  },

  wall_dummy_on_update(game, mc) {
    const tmod = Std.tmod;
    mc.x += mc.sx;
    mc.y += mc.sy;
    mc.clip._x = mc.x;
    mc.clip._y = mc.y;
    mc.clip._xscale = mc.time * 200 / mc.stime;
    mc.clip._yscale = mc.time * 200 / mc.stime;
    mc.clip._rotation += 5 * tmod;
    mc.time -= tmod;
    if (mc.time < 0) {
      remove(game.level.updates, mc);
      remove(game.level.dummies, mc);
      mc.clip.removeMovieClip();
    }
  },

  ball_object_on_update(game, mc) {
    const d = Math.sqrt(Tools.dist2(mc.clip, game.ball.mc));
    if (d < Const.BALL_RAYSIZE * 3) {
      remove(game.level.updates, mc);
      mc.clip.gotoAndPlay('hit');
      game.options.ball_types_chk -= game.options.ball_types[mc.obj];
      Sound.play(Sound.GET_BALL);
      game.options.ball_types[mc.obj] = 1;
      game.options.ball_types_chk++;
      game.ball.btype = mc.obj;
      game.options.update_icons();
      game.ball.update_skin();
      if (!game.options.ball_flags[mc.obj]) {
        game.options.ball_flags[mc.obj] = true;
        Sound.nextMix();
      }
    }
  },

  bumper_teleport_on_update(game, mc) {
    let d = Math.sqrt(Tools.dist2(mc.clip, game.ball.mc));
    d += 0.1;
    for (let i = 0; i < mc.clip.num; i++) {
      const circle = mc.clip['c' + i];
      if (!circle) continue;
      circle._rotation += circle.rot * Std.tmod * (1 + (60 / d));
      circle.c += Std.tmod * (20 + (200 / d));
      const a = circle.c / 100;
      circle._xscale = 100 + Math.cos(a) * 50;
      circle._yscale = 100 + Math.sin(a) * 50;
    }
    if (d < Const.BALL_RAYSIZE) {
      if (!mc.teleport) {
        const bumpers = game.level.updates;
        let i;
        for (i = 0; i < bumpers.length; i++) if (bumpers[i].btype === 10 && bumpers[i] !== mc) break;
        mc.teleport = true;
        const autre = bumpers[i];
        if (autre) {
          autre.teleport = true;
          game.ball.x = autre.clip._x;
          game.ball.y = autre.clip._y;
          game.ball.mc._x = game.ball.x;
          game.ball.mc._y = game.ball.y;
        }
      }
    } else mc.teleport = false;
  },

  boss_room_on_update(game, mc) {
    const sz = Const.BORDER_SIZE + Const.BALL_RAYSIZE;
    const bpos = game.ball;
    if (bpos.x > sz && bpos.y > sz && bpos.x < Const.LVL_WIDTH - sz && bpos.y < Const.LVL_HEIGHT - sz) {
      remove(game.level.updates, mc);
      const room = game.level.dungeon[game.level.pos_x][game.level.pos_y];
      for (let d = 0; d < 4; d++) {
        const door = game.level.interf.doors[d];
        if (room.paths[d].ptype === -1) {
          door.gotoAndStop('off');
          game.level.set_door_collide(d, Collide.border_collide);
        }
      }
      game.ball.start_x = Const.LVL_WIDTH / 2;
      game.ball.start_y = Const.LVL_HEIGHT / 2;

      if (J.Manager.play_mode === Const.MODE_AIDE) {
        Sound.fadeMix(Sound.MUSIC_MENU);
        J.Manager.gameOver(true);
        return;
      }

      let boss;
      Sound.fadeMix(Sound.MUSIC_BOSS);
      if (J.Manager.play_mode === Const.MODE_AVENTURE) {
        if (J.Manager.play_mode_param === 4) boss = new J.BossTB(game);
        else boss = new J.BossSerpent(game);
      } else boss = new J.Boss(game);
      game.boss_update = boss;
    }
  },

  autoclose_door_on_update(game, mc) {
    const sz = Const.BORDER_SIZE + Const.BALL_RAYSIZE;
    const bpos = game.ball;
    if (bpos.x > sz && bpos.y > sz && bpos.x < Const.LVL_WIDTH - sz && bpos.y < Const.LVL_HEIGHT - sz) {
      remove(game.level.updates, mc);
      game.level.interf.doors[mc.d].gotoAndStop('off');
      game.level.set_door_collide(mc.d, Collide.border_collide);
      if (mc.validate) game.course_validated = true;
    }
  },
};
J.Collide = Collide;

})(typeof window !== 'undefined' ? window : globalThis);
