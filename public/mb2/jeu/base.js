/*
 * MotionBall — la BASE : les constantes (Const.as), les outils (Tools.as),
 * les bibliothèques que le SWF seul contenait — désassemblées, faute de
 * source — et les petites classes du jeu.
 *
 *   · Std : le tmod est celui du moteur partagé (K.Std, wantedFPS 32) ; on
 *     lui rend ses EXTENSIONS d'époque — attachMC / createEmptyMC /
 *     duplicateMC, qui nomment les clips « nom@compteur », randomProbas,
 *     random, xmouse/ymouse — et l'`Array.prototype.remove` de Motion-Twin
 *     (ici une fonction `remove`, même sémantique : le premier élément égal) ;
 *   · asml.DepthManager : des PLANS de mille profondeurs (plan p → p·1000…
 *     p·1000+999), compactés quand un plan est plein ;
 *   · asml.UpdateList : des rappels (objet, méthode) joués à l'envers (le
 *     for…in de l'AVM1) ;
 *   · asml.SoundManager : des canaux (un clip vide chacun, un volume, ses
 *     sons attachés par nom), play/loop/stop, un FONDU entre deux canaux
 *     (`fade`, dont la longueur absente vaut un fondu instantané — NaN dans
 *     la comparaison, comme dans le lecteur) ;
 *   · asml.PopupFX : le ressort du panneau de fin (amplitude, vitesse,
 *     accélération, amortissement) ;
 *   · ext.util.MTBitcodec : le décodeur binaire des cartes (base 64
 *     « a-zA-Z0-9-_ », six bits par caractère, `next_part` remet le compte
 *     de bits à zéro sans sauter de caractère).
 *
 * Puis Card, Prefs, Sound, TItems, Text, Aide, Transition et Loader :
 * traduits ligne à ligne de Games/motionBall2/mb2/.
 */
'use strict';

(function (racine) {

const K = racine.KalugaMoteur;
const J = racine.Mb2Jeu = racine.Mb2Jeu || {};

// ── L'AVM1 ────────────────────────────────────────────────────────────────
// random(n) : un entier de [0, n[, n tronqué (0 si n ≤ 0 ou NaN).
const random = (n) => { const m = Math.trunc(n) || 0; return m > 0 ? Math.floor(Math.random() * m) : 0; };
// int(x) : troncature vers zéro.
const int = (x) => { const v = Math.trunc(x); return Number.isNaN(v) ? 0 : v; };
// Array.prototype.remove (Std) : retire le PREMIER élément égal, dit s'il l'a fait.
const remove = (a, v) => { for (let i = 0; i < a.length; i++) if (a[i] == v) { a.splice(i, 1); return true; } return false; };   // eslint-disable-line eqeqeq
J.random = random; J.int = int; J.remove = remove;

// ── Std : les extensions de Motion-Twin, sur le Std du moteur ─────────────
const Std = K.Std;
Std.counter = 0;
Std.attachMC = function (mc, nom, prof) { const n = nom + '@' + (Std.counter++); mc.attachMovie(nom, n, prof); return mc[n]; };
Std.createEmptyMC = function (mc, prof) { const n = '_empty@' + (Std.counter++); mc.createEmptyMovieClip(n, prof); return mc[n]; };
Std.duplicateMC = function (mc, prof) { const n = '_dup@' + (Std.counter++); mc.duplicateMovieClip(n, prof); return mc._parent ? mc._parent[n] : undefined; };
Std.randomProbas = function (a) {
  let tot = 0;
  for (let i = a.length - 1; i >= 0; i--) tot += a[i];
  let r = random(tot);
  let i = 0;
  while (r >= a[i]) { r -= a[i]; i++; }
  return i;
};
Std.random = random;
Std.xmouse = function () { return K.scene ? K.scene.souris.x : 0; };
Std.ymouse = function () { return K.scene ? K.scene.souris.y : 0; };
Std.cast = function (x) { return x; };
J.Std = Std;

// ── Const ─────────────────────────────────────────────────────────────────
const Const = {
  POS_X: 0, POS_Y: 0,
  MODE_CHALLENGE: 1, MODE_CLASSIC: 3, MODE_COURSE: 10, MODE_AVENTURE: 20, MODE_AIDE: 100,
  TIME_CHALLENGE: 15 * 60 * 1000, TIME_CLASSIC: 1 * 60 * 1000, TIME_CLASSIC_EXTENDED: 5 * 1000,
  CHALLENGE_DATA: 'mb2data.dat', CLASSIC_DATA: 'mb2classic.dat', TUTO_DATA: 'mb2tuto.dat',
  AVENTURE_DATA: (n) => 'mb2adv' + (n + 1) + '.dat',
  COURSE_DATA: (n) => 'mb2run' + (n + 1) + '.dat',
  DELTA: 4, LVL_WIDTH: 610, LVL_HEIGHT: 410, MAX_BUMPERS: 50, BORDER_SIZE: 25, BALL_RAYSIZE: 8,
  HOLE_BORDER_SIZE: 7, DOOR_SIZE: 110,
  DOORS_FRAMES: [4, 3, 2, 1, 1, 2, 3, 4],
  DOOR_COLLIDE_DELTA: 5,
  CAUSE_NOTIME: 1, CAUSE_NOBALLS: 2, CAUSE_WINS: 3,
  BG_PLAN: 0, SHADE_PLAN: 1, DECOR_PLAN: 2, DOOR_PLAN: 2, HOLE_PLAN: 3, BONUS_PLAN: 4, BALL_PLAN: 5,
  BUMPER_PLAN: 6, DUMMY_PLAN: 7, BOSS_PLAN: 8, ICON_PLAN: 9,
};
Const.LVL_CWIDTH = int(Const.LVL_WIDTH / Const.DELTA);        // 152
Const.LVL_CHEIGHT = int(Const.LVL_HEIGHT / Const.DELTA);      // 102
Const.BORDER_CSIZE = int(Const.BORDER_SIZE / Const.DELTA);    // 6
Const.DOOR_CSIZE = Math.ceil(Const.DOOR_SIZE / Const.DELTA);  // 28
Const.DOOR_CXPOS = int((Const.LVL_CWIDTH - Const.DOOR_CSIZE) / 2);
Const.DOOR_CYPOS = int((Const.LVL_CHEIGHT - Const.DOOR_CSIZE) / 2);
Const.POS_NBITS = Math.ceil(Math.log(Math.max(Const.LVL_CWIDTH, Const.LVL_CHEIGHT)) / Math.LN2);   // 8
Const.BOSS_MIN_X = Const.BORDER_SIZE * 2;
Const.BOSS_MIN_Y = Const.BORDER_SIZE;
Const.BOSS_MAX_Y = Const.BORDER_SIZE;
J.Const = Const;

// ── Tools ─────────────────────────────────────────────────────────────────
const Tools = {
  mc_size(mc) {
    return { w: Math.ceil((mc._width / 2) / Const.DELTA) * 2, h: Math.ceil((mc._height / 2) / Const.DELTA) * 2 };
  },
  set_mcpos(mc, p) {
    const s = Tools.mc_size(mc);
    mc._x = (p.x + s.w / 2) * Const.DELTA;
    mc._y = (p.y + s.h / 2) * Const.DELTA;
  },
  pos_center(mc) {
    const s = Tools.mc_size(mc);
    return {
      x: int((Const.LVL_CWIDTH - Const.BORDER_CSIZE * 2) / 2 + Const.BORDER_CSIZE) - s.w / 2,
      y: int((Const.LVL_CHEIGHT - Const.BORDER_CSIZE * 2) / 2 + Const.BORDER_CSIZE) - s.h / 2,
    };
  },
  to_deg(a) { return int(a * 180 / Math.PI + 360) % 360; },
  rad_dif(a, b) {
    let d = b - a;
    d -= int(d / (2 * Math.PI)) * Math.PI * 2;
    if (d > Math.PI) return d - Math.PI * 2;
    if (d <= -Math.PI) return d + Math.PI * 2;
    return d;
  },
  dist2(mc1, mc2) { const dx = mc1._x - mc2._x, dy = mc1._y - mc2._y; return dx * dx + dy * dy; },
  drawSmoothSquare(mc, pos, col, curve, alpha) {
    mc.moveTo(pos.x + curve, pos.y);
    mc.beginFill(col, alpha);
    mc.lineTo(pos.x + (pos.w - curve), pos.y);
    mc.curveTo(pos.x + pos.w, pos.y, pos.x + pos.w, pos.y + curve);
    mc.lineTo(pos.x + pos.w, pos.y + (pos.h - curve));
    mc.curveTo(pos.x + pos.w, pos.y + pos.h, pos.x + (pos.w - curve), pos.y + pos.h);
    mc.lineTo(pos.x + curve, pos.y + pos.h);
    mc.curveTo(pos.x, pos.y + pos.h, pos.x, pos.y + (pos.h - curve));
    mc.lineTo(pos.x, pos.y + curve);
    mc.curveTo(pos.x, pos.y, pos.x + curve, pos.y);
    mc.endFill();
  },
};
J.Tools = Tools;

// ── asml.DepthManager ─────────────────────────────────────────────────────
class DepthManager {
  constructor(mc) { this.mc = mc; this.planes = []; }
  getMC() { return this.mc; }
  getPlane(p) {
    let pl = this.planes[p];
    if (pl === undefined) { pl = { list: [], n: 0 }; this.planes[p] = pl; }
    return pl;
  }
  // Un plan plein : on tasse les clips encore vivants (en Flash : ceux dont
  // le _name existe encore ; ici : ceux qui ont encore un parent).
  compact(p) {
    const pl = this.planes[p];
    const list = pl.list, n = pl.n, base = p * 1000;
    let k = 0;
    for (let i = 0; i < n; i++) {
      const e = list[i];
      if (e && e._parent) { e.swapDepths(base + k); list[k] = e; k++; }
    }
    pl.n = k;
  }
  attach(nom, p) {
    const pl = this.getPlane(p);
    if (pl.n === 1000) { this.compact(p); return this.attach(nom, p); }
    const mc = Std.attachMC(this.mc, nom, pl.n + p * 1000);
    pl.list[pl.n] = mc;
    pl.n++;
    return mc;
  }
  empty(p) {
    const pl = this.getPlane(p);
    if (pl.n === 1000) { this.compact(p); return this.empty(p); }
    const mc = Std.createEmptyMC(this.mc, pl.n + p * 1000);
    pl.list[pl.n] = mc;
    pl.n++;
    return mc;
  }
  register(mc, p) {
    const pl = this.getPlane(p);
    if (pl.n === 1000) { this.compact(p); return this.register(mc, p); }
    pl.list[pl.n] = mc;
    pl.n++;
    return (pl.n - 1) + p * 1000;
  }
  changePlane(mc, p) {
    const cur = int(mc.getDepth() / 1000);
    if (cur === p) return;
    const pl = this.getPlane(cur);
    for (let i = 0; i < pl.n; i++) if (pl.list[i] === mc) { pl.list[i] = null; break; }
    mc.swapDepths(this.register(mc, p));
  }
  toBack(mc) {
    const d = mc.getDepth(), p = int(d / 1000), pl = this.getPlane(p), i = d % 1000;
    if (pl.list[i] === mc) {
      pl.list[i] = null;
      pl.list.unshift(mc);
      pl.n++;
      this.compact(p);
    }
  }
  toFront(mc) {
    const d = mc.getDepth(), p = int(d / 1000), pl = this.getPlane(p), i = d % 1000;
    if (pl.list[i] === mc) {
      pl.list[i] = null;
      if (pl.n === 1000) this.compact(p);
      const n = pl.n;
      pl.n++;
      mc.swapDepths(n + p * 1000);
      pl.list[n] = mc;
    }
  }
  clear(p) {
    const pl = this.getPlane(p);
    for (let i = 0; i < pl.n; i++) if (pl.list[i]) pl.list[i].removeMovieClip();
    pl.n = 0;
  }
  destroy() { for (const p of Object.keys(this.planes)) this.clear(+p); }
}
J.DepthManager = DepthManager;

// ── asml.UpdateList ───────────────────────────────────────────────────────
class UpdateList {
  constructor() { this.list = []; }
  push(obj, fn) { this.list.push({ obj, fn }); }
  remove(obj, fn) {
    for (let i = 0; i < this.list.length; i++) {
      const e = this.list[i];
      if (e.fn === fn && e.obj === obj) { this.list.splice(i, 1); return; }
    }
  }
  // Le for…in de l'AVM1 parcourt un tableau à l'envers.
  main() {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      if (e) e.fn.call(e.obj);
    }
  }
}
J.UpdateList = UpdateList;

// ── asml.SoundManager ─────────────────────────────────────────────────────
class SoundManager {
  constructor(mc, depth) {
    this.mc = mc; this.depth = depth;
    this.channels = [];
    this.fade_t = -1;
  }
  destroy() {
    for (let i = 0; i < this.channels.length; i++) {
      const c = this.channels[i];
      if (!c) continue;
      for (const k of Object.keys(c.sounds)) c.sounds[k].stop();
      c.mc.removeMovieClip();
    }
    this.channels = [];
  }
  getChannel(n) {
    let c = this.channels[n];
    if (c === undefined) {
      const cmc = Std.createEmptyMC(this.mc, this.depth++);
      c = { mc: cmc, sounds: {}, vol: 100, snd: new K.Sound(cmc), id: n, enabled: true };
      this.channels[n] = c;
    }
    return c;
  }
  getSound(nom, chan) {
    const c = this.getChannel(chan);
    let s = c.sounds[nom];
    if (s === undefined) {
      s = new K.Sound(c.mc);
      s.attachSound(nom);
      s.onSoundComplete = function () { this.playing = false; };
      s.playing = false;
      c.sounds[nom] = s;
    }
    return s;
  }
  playSound(nom, chan) { const s = this.getSound(nom, chan); s.start(0, 1); s.playing = true; }
  play(nom) { this.playSound(nom, 0); }
  loop(nom, chan) { const s = this.getSound(nom, chan); s.start(0, 65535); s.playing = true; }
  stopSound(nom, chan) { const s = this.getSound(nom, chan); s.stop(); s.playing = false; }
  // fade(de, vers, durée) : le canal `vers` monte au volume de `de`, qui
  // descend puis s'arrête. Un fondu déjà en cours est fini d'un coup.
  fade(de, vers, duree) {
    if (this.fade_t !== -1) {
      this.setVolume(this.fadeTo.id, this.fadeFromVol);
      this.stop(this.fadeFrom.id);
      this.setVolume(this.fadeFrom.id, this.fadeFromVol);
    }
    this.fadeFrom = this.getChannel(de);
    this.fadeTo = this.getChannel(vers);
    this.fadeToVol = this.fadeTo.vol;
    this.fadeFromVol = this.fadeFrom.vol;
    this.fade_t = 0;
    this.fadeLength = duree;
  }
  main() {
    if (this.fade_t === -1) return;
    let done = false;
    // Sans durée, deltaT / undefined vaut NaN : « NaN < 1 » est faux, le
    // fondu est immédiat — c'est ainsi que startMix et nextMix basculent.
    this.fade_t += Std.deltaT / this.fadeLength;
    if (!(this.fade_t < 1)) { this.fade_t = 1; done = true; }
    const v = (this.fadeFromVol - this.fadeToVol) * this.fade_t + this.fadeToVol;
    this.setVolume(this.fadeTo.id, v);
    this.setVolume(this.fadeFrom.id, this.fadeFromVol - v);
    if (done) {
      this.fade_t = -1;
      this.stop(this.fadeFrom.id);
      this.setVolume(this.fadeFrom.id, this.fadeFromVol);
    }
  }
  enable(chan, flag) {
    const c = this.getChannel(chan);
    c.enabled = flag;
    c.snd.setVolume(c.enabled ? c.vol : 0);
  }
  stop(chan) {
    const c = this.getChannel(chan);
    for (const k of Object.keys(c.sounds)) { c.sounds[k].stop(); c.sounds[k].playing = false; }
  }
  isPlaying(nom, chan) { return this.getSound(nom, chan).playing; }
  setVolume(chan, v) {
    const c = this.getChannel(chan);
    c.vol = v;
    if (c.enabled) c.snd.setVolume(c.vol);
  }
}
J.SoundManager = SoundManager;

// ── asml.PopupFX ──────────────────────────────────────────────────────────
class PopupFX {
  constructor(mc, start, end, amp, vit, acc, amort, frict, min) {
    this.mc = mc; this.start = start; this.end = end;
    this.amp = amp; this.vit = vit; this.acc = acc; this.amort = amort; this.frict = frict; this.min = min;
    this.dir = start < end;
    this.cur = start;
  }
  main() {
    const tmod = Std.tmod;
    if (this.dir) {
      this.cur += tmod * this.vit;
      this.vit *= Math.pow(this.acc, tmod);
      if (this.cur > this.end + this.amp) {
        this.cur = this.end + this.amp;
        this.amp *= this.amort;
        this.vit *= this.frict;
        this.dir = !this.dir;
      }
    } else {
      this.cur -= tmod * this.vit;
      this.vit *= Math.pow(this.acc, tmod);
      if (this.cur < this.end - this.amp) {
        this.cur = this.end - this.amp;
        this.amp *= this.amort;
        this.vit *= this.frict;
        this.dir = !this.dir;
      }
    }
    if (this.amp < this.min) { this.amp = 0; this.cur = this.end; this.vit = 0; }
    this.mc._xscale = this.cur;
    this.mc._yscale = this.cur;
  }
  destroy() { this.mc.removeMovieClip(); }
}
J.PopupFX = PopupFX;

// ── ext.util.MTBitcodec ───────────────────────────────────────────────────
class MTBitcodec {
  constructor(input) {
    this.error = false;
    this.nbits = 0;
    this.bits = 0;
    this.output = '';
    this.input = String(input === undefined || input === null ? '' : input);
    this.pos = 0;
  }
  static charVal(c) {
    if (c >= 'a' && c <= 'z') return c.charCodeAt(0) - 97;
    if (c >= 'A' && c <= 'Z') return c.charCodeAt(0) - 65 + 26;
    if (c >= '0' && c <= '9') return c.charCodeAt(0) - 48 + 52;
    if (c === '-') return 62;
    if (c === '_') return 63;
    return null;
  }
  static valChar(v) {
    if (v < 0) return '?';
    if (v < 26) return String.fromCharCode(v + 97);
    if (v < 52) return String.fromCharCode(v - 26 + 65);
    if (v < 62) return String.fromCharCode(v - 52 + 48);
    if (v === 62) return '-';
    if (v === 63) return '_';
    return '?';
  }
  read(n) {
    while (this.nbits < n) {
      const c = MTBitcodec.charVal(this.input.charAt(this.pos++));
      if (this.pos > this.input.length || c === null) {
        this.error = true;
        this.has_error();
        return -1;
      }
      this.nbits += 6;
      this.bits = (this.bits << 6) | c;
    }
    this.nbits -= n;
    return (this.bits >> this.nbits) & ((1 << n) - 1);
  }
  next_part() { this.nbits = 0; }
  has_error() { return this.error; }
  write(n, v) {
    this.nbits += n;
    this.bits = (this.bits << n) | v;
    while (this.nbits >= 6) {
      this.nbits -= 6;
      this.output += MTBitcodec.valChar((this.bits >> this.nbits) & 63);
    }
  }
  toString() {
    if (this.nbits > 0) this.write(6 - this.nbits, 0);
    return this.output;
  }
}
J.MTBitcodec = MTBitcodec;

// ── Card ──────────────────────────────────────────────────────────────────
class Card {
  static times_cpu(t1, t2, t3) { return [{ $t: t1, $c: true }, { $t: t2, $c: true }, { $t: t3, $c: true }]; }
  static time(m, s) { return (m * 60 + s) * 100; }
  static scoreDonjon(c, score) {
    const id = J.Manager.play_mode_param;
    let old = c.$dtimes[id];
    if (old === undefined) old = 0;
    if (old < score) {
      c.$dtimes[id] = score;
      J.Manager.client.saveSlot(0);
      return old;
    }
    return old;
  }
  constructor() {
    this.$items = [];
    this.$challenge = true;
    this.$classic = true;
    this.$dungeons = [true, true, true, true];
    this.$dungeons_done = [];
    this.$courses = [true];
    this.$classic_score = 0;
    this.$dtimes = [];
    this.$records = [
      Card.times_cpu(Card.time(3, 0), Card.time(3, 40), Card.time(4, 20)),
      Card.times_cpu(Card.time(4, 0), Card.time(4, 40), Card.time(5, 20)),
      Card.times_cpu(Card.time(4, 30), Card.time(5, 15), Card.time(6, 0)),
      Card.times_cpu(Card.time(2, 30), Card.time(3, 0), Card.time(3, 30)),
      Card.times_cpu(Card.time(3, 0), Card.time(3, 30), Card.time(4, 0)),
      Card.times_cpu(Card.time(4, 0), Card.time(4, 40), Card.time(5, 20)),
      Card.times_cpu(Card.time(4, 0), Card.time(4, 40), Card.time(5, 20)),
    ];
  }
}
J.Card = Card;

// ── Prefs ─────────────────────────────────────────────────────────────────
const Prefs = {
  challenge_mode_enabled: true,
  classic_mode_enabled: false,
  courses: [],
  dungeons: [],
  sound_enabled: true,
  music_enabled: true,
  toggleMusic() {
    Prefs.music_enabled = !Prefs.music_enabled;
    for (let i = 1; i < Sound.MUSIC_NLOOPS + 3; i++) Sound.smanager.enable(i, Prefs.music_enabled);
  },
  toggleSounds() {
    Prefs.sound_enabled = !Prefs.sound_enabled;
    Sound.smanager.enable(0, Prefs.sound_enabled);
  },
};
J.Prefs = Prefs;

// ── Sound ─────────────────────────────────────────────────────────────────
const Sound = {
  BALL_CHANGE: 'bonus_blip2',
  MENU_ENTER: 'menu_enter', MENU_SELECT: 'menu_select',
  BOSS_EYE: 'eye', BOSS_JUMP: 'sound_boss_saut', BOSS_NEW_EYE: 'eye_new', POULPE: 'sound_poulpe', CASSE: 'sound_casse',
  WALL_HIT: 'wall_bump', BUMPER_NORMAL: 'bumper_metal', BUMPER_TIME: 'wall_bump', BUMPER_DEATH: 'sound_bdeath',
  BUMPER_DEATH_PROTECT: 'bumper_metal', BUMPER_MAGNET: 'bumper_metal', BUMPER_SHADOW: 'bumper_metal',
  GREEN_BLOCK_HIT: 'wall_bump', INTER_BLOCK_HIT: 'wall_bump', INTERUPT_HIT: 'bumper_metal', ZAPPER_HIT: 'bumper_metal',
  ZAPPER_ACTIVATE: 'sound_zapper', GREEN_BLOCK_DESTROY: 'wall_bump',
  GET_ITEM: 'object_found', GET_BALL: 'object_found', GET_RED: 'bonus_blip', GET_BLUE: 'bonus_blip3',
  GRELOT: 'sound_grelot', OPEN_DOOR: 'door_open', GAME_OVER: 'game_over',
  POWER_WIND: 'wind', POWER_FIRE: 'sound_casse', POWER_WATER: 'water', POWER_EARTH: 'earth',
  SERPENT_HIT: 'touched', SERPENT_COLLIDE: 'wall_bump', TB_HIT: 'touched', TB_HIDE: 'hide',
  MUSIC_MENU: 'menu', MUSIC_INTRO: 'menu', MUSIC_BOSS: 'boss_loop', MUSIC_GAME_OVER: '',
  MIX_VOLUME: 20, MUSIC_VOLUME: 20, MUSIC_NLOOPS: 5,
  smanager: null, channel_music: true, time: 0, mix_nb: undefined, last_time: undefined, last_sound: undefined,

  init(mc) {
    Sound.smanager = new SoundManager(mc, 50000);
    Sound.smanager.setVolume(1, Sound.MUSIC_VOLUME);
    Sound.smanager.setVolume(2, Sound.MUSIC_VOLUME);
    Sound.time = 0;
    Sound.mix_nb = undefined;
    Sound.last_time = undefined;
    Sound.last_sound = undefined;
    Sound.channel_music = true;
  },
  destroy() { Sound.smanager.destroy(); },
  main() { Sound.time += Std.deltaT; Sound.smanager.main(); },
  // Un même son deux fois dans la même image ne part qu'une fois.
  play(nom) {
    if (nom !== Sound.last_sound || Sound.time !== Sound.last_time) {
      Sound.smanager.play(nom);
      Sound.last_sound = nom;
      Sound.last_time = Sound.time;
    }
  },
  playMusic(nom) {
    Sound.stopMix();
    const s = Sound.smanager;
    if (!s.isPlaying(nom, Sound.channel_music ? 1 : 2)) {
      Sound.channel_music = !Sound.channel_music;
      s.setVolume(Sound.channel_music ? 1 : 2, 0);
      s.fade(Sound.channel_music ? 2 : 1, Sound.channel_music ? 1 : 2, 1);
      s.loop(nom, Sound.channel_music ? 1 : 2);
    }
  },
  startMix() {
    const s = Sound.smanager;
    Sound.stopMix();
    for (let i = 0; i < Sound.MUSIC_NLOOPS; i++) s.setVolume(i + 3, 0);
    s.setVolume(Sound.channel_music ? 1 : 2, Sound.MIX_VOLUME);
    s.fade(Sound.channel_music ? 1 : 2, 3);
    for (let i = 0; i < Sound.MUSIC_NLOOPS; i++) s.loop('loop$' + (i + 1), i + 3);
    Sound.mix_nb = 0;
  },
  nextMix() {
    const s = Sound.smanager;
    if (Sound.mix_nb < 4) {
      s.setVolume(Sound.mix_nb + 3, Sound.MIX_VOLUME + (Sound.mix_nb + 1) * 10);
      s.fade(Sound.mix_nb + 3, Sound.mix_nb + 4);
      Sound.mix_nb++;
    }
  },
  fadeMix(nom) {
    const s = Sound.smanager;
    Sound.channel_music = true;
    s.setVolume(Sound.mix_nb + 3, Sound.MUSIC_VOLUME);
    s.setVolume(1, 0);
    s.fade(Sound.mix_nb + 3, 1, 2.0);
    s.loop(nom, 1);
  },
  stopMix() { for (let i = 0; i < 4; i++) Sound.smanager.stop(3 + i); },
};
J.Sound = Sound;

// ── TItems ────────────────────────────────────────────────────────────────
const TItems = {
  TITEMS: [
    '$c1or', '$c1argent', '$c1',   // jaune
    '$c2or', '$c2argent', '$c2',   // verte
    '$c3or', '$c3argent', '$c3',   // rouge
    '$c4or', '$c4argent', '$c4',   // orange
    '$c5or', '$c5argent', '$c5',   // bleue
    '$c6or', '$c6argent', '$c6',   // metal
    '$c7or', '$c7argent', '$c7',   // violette
    '$bfacettes',
    '$bnormal', '$btime', '$bdeath', '$bmagnet', '$bshadow',
    '$oeil', '$masque',
    // 0 : eau, 1 : feu, 2 : air, 3 : terre
    '$eca0', '$eca1', '$eca2', '$eca3',
    '$symb0', '$symb1', '$symb2', '$symb3',
  ],
  TITEMS_COURSE: 0, TITEM_CLASSIC: 21, TITEMS_END: 22, TITEMS_SERPENT: 29, TITEMS_SYMBOL: 33,
  giveCourse(cnb, inb) {
    let t = 0;
    if (TItems.giveItem(TItems.TITEMS_COURSE + inb + cnb * 3)) t++;
    if (inb < 2) t += TItems.giveCourse(cnb, inb + 1);
    return t;
  },
  giveClassic(lvl) {
    if (lvl < 40) return false;
    return TItems.giveItem(TItems.TITEM_CLASSIC);
  },
  giveAventure(av) {
    if (av < 4) {
      if (TItems.giveItem(TItems.TITEMS_SYMBOL + av)) return true;
      return TItems.giveItem(TItems.TITEMS_SERPENT + av);
    }
    let ntry = 100;
    while (ntry-- > 0) {
      if (TItems.giveItem(TItems.TITEMS_END + random(7))) return true;
    }
    return false;
  },
  giveItem(i) {
    const fc = J.Manager.client.fcard.$items;
    if (fc[i] || TItems.TITEMS[i] === '') return false;
    fc[i] = true;
    J.Manager.client.giveItem(TItems.TITEMS[i]);
    J.Manager.client.saveSlot(0);
    return true;
  },
};
J.TItems = TItems;

// ── Text : un panneau à texte (« Connexion en cours... », « ERREUR ») ─────
class Text {
  constructor(mc, txt) {
    this.screen = Std.attachMC(mc, 'panGameOver', 0);
    this.screen._x = Const.LVL_WIDTH / 2;
    this.screen._y = Const.LVL_HEIGHT / 2;
    this.screen.gotoAndStop('texte');
    this.screen.mainField.text = txt;
    this.screen.mainField._y = 30 - this.screen.mainField.textHeight / 2;
  }
  setText(txt) {
    this.screen.mainField.text = txt;
    this.screen.mainField._y = 30 - this.screen.mainField.textHeight / 2;
  }
  main() {}
  destroy() { this.screen.removeMovieClip(); }
}
J.Text = Text;

// ── Aide : le panneau d'aide, un clic pour revenir au menu ────────────────
class Aide {
  constructor(mc) {
    this.screen = Std.attachMC(mc, 'panGameOver', 0);
    this.screen._x = Const.LVL_WIDTH / 2;
    this.screen._y = Const.LVL_HEIGHT / 2;
    this.screen.gotoAndStop('aide');
    this.screen.onPress = () => { this.click(); this.screen.onPress = undefined; };
  }
  click() { J.Manager.gotoMenu(); }
  main() {}
  destroy() { this.screen.removeMovieClip(); }
}
J.Aide = Aide;

// ── Transition : le masque en losange qui se referme, puis s'ouvre ────────
class Transition {
  constructor(mc, mode) {
    this.mc = mc;
    this.mode = mode;
    this.reversed = false;
    this.mask = Std.createEmptyMC(mc._parent, 999);
    this.mask_size = 350;
    this.mask._x = 610 / 2;
    this.mask._y = 410 / 2;
    this.diag = 0.3 + random(300) / 100;
    mc.setMask(this.mask);
    this.main();
  }
  main() {
    const mask = this.mask;
    this.mask_size -= Std.tmod * 15;
    mask._rotation += Std.tmod * 3;
    mask.clear();
    mask.moveTo(0, -this.mask_size);
    mask.beginFill(0, 100);
    const d = this.mask_size * this.diag;
    mask.curveTo(d, -d, this.mask_size, 0);
    mask.curveTo(d, d, 0, this.mask_size);
    mask.curveTo(-d, d, -this.mask_size, 0);
    mask.curveTo(-d, -d, 0, -this.mask_size);
    mask.endFill();
    if (this.mode) this.mode.main();

    if (!this.reversed && this.mask_size < 0) {
      this.reversed = true;
      if (this.mode) this.mode.destroy();
      this.mode = J.Manager.nextMode();
    }
    if (this.mask_size < -400) {
      const m = this.mode;
      this.mode = null;
      J.Manager.switchMode(m);
    }
  }
  destroy() {
    if (this.mode) this.mode.destroy();
    this.mc.setMask(null);
    this.mask.removeMovieClip();
  }
}
J.Transition = Transition;

// ── Loader : l'écran de chargement d'une carte (.dat, un LoadVars) ────────
// Le LoadVars d'époque garde en mémoire chaque carte déjà lue (data_stream
// [nom]) ; on fait pareil, pour la session de la page.
class Loader {
  constructor(mc, data) {
    if (Loader.data_stream === null) Loader.data_stream = { ddata: null, bytesTotal: 0, bytesLoaded: 0 };
    const ds = Loader.data_stream;
    this.cur_data = data;
    this.ready = false;
    if (ds[data] == null) {
      const file = J.Manager.client.getFileInfos(data).name;
      this.loaded = false;
      ds.bytesTotal = 0; ds.bytesLoaded = 0;
      J.Manager.client.chargerFichier(file).then((texte) => {
        if (this.cur_data !== data || Loader.courant !== this) return;
        if (texte === null) { this.onLoad(false); return; }
        ds.ddata = Loader.decoderLoadVars(texte).ddata;
        ds.bytesTotal = texte.length; ds.bytesLoaded = texte.length;
        this.onLoad(ds.ddata !== undefined);
      });
    } else {
      ds.ddata = ds[data];
      ds.bytesTotal = ds.ddata.length; ds.bytesLoaded = ds.bytesTotal;
      this.loaded = true;
    }
    Loader.courant = this;
    this.load_mc = Std.attachMC(mc, 'loading', 0);
    this.load_mc.loadReady = () => { this.ready = true; };
    this.load_mc.loadFinish = () => { this.finish(); };
  }
  static decoderLoadVars(texte) {
    const o = {};
    for (const morceau of String(texte).split('&')) {
      const eq = morceau.indexOf('=');
      if (eq < 0) continue;
      const v = morceau.slice(eq + 1).replace(/\+/g, ' ');
      let d;
      try { d = decodeURIComponent(v); } catch (e) { d = v; }
      o[morceau.slice(0, eq)] = d.replace(/[\r\n]+$/, '');
    }
    return o;
  }
  main() {
    const ds = Loader.data_stream;
    const btot = ds.bytesTotal, bload = ds.bytesLoaded;
    let progress;
    if (btot < 10 || bload < 10) progress = 0 + ' %';
    else {
      if (this.loaded && this.ready) {
        this.ready = false;
        this.load_mc.play();
      }
      progress = Math.min(100, int(bload * 100 / btot)) + ' %';
    }
    this.load_mc.progress = progress;
  }
  setText(txt) {
    this.loaded = false;
    this.load_mc.gotoAndPlay(1);
    if (this.load_mc.chargement) this.load_mc.chargement.txt = txt;
  }
  onLoad(flag) {
    if (!flag) J.Manager.error();
    else this.loaded = true;
  }
  finish() {
    this.load_mc.stop();
    this.load_mc.progress = '';
    Loader.last_data = Loader.data_stream.ddata;
    Loader.data_stream[this.cur_data] = Loader.last_data;
    J.Manager.loadDone();
  }
  destroy() {
    if (Loader.courant === this) Loader.courant = null;
    this.load_mc.removeMovieClip();
  }
}
Loader.data_stream = null;
Loader.last_data = null;
Loader.courant = null;
J.Loader = Loader;

})(typeof window !== 'undefined' ? window : globalThis);
