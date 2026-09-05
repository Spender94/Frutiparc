/*
 * Kaluga — les classes de SERVICE du jeu, portées de l'ActionScript 2 de
 * 2005 (Games/kaluga/class/kaluga/) : constantes (Cs), utilitaires (MC,
 * Stat, MTNumber, KeyManager), animations par intervalles (AnimList,
 * FrameAnimManager), compteurs et bandeaux (Numb, Scroller, InfoBar et ses
 * barres), les panneaux de fin de partie (Panel et ses parts), le
 * gestionnaire de sons et la classe de base des « slots » (Slot).
 *
 * La règle du portage : ligne à ligne, mêmes noms, mêmes nombres. Les
 * classes qui étaient des MovieClip héritent de K.Clip et gardent leur
 * constructeur AS2 sous le nom `constructeur()` — le moteur l'appelle après
 * avoir copié l'objet d'initialisation d'attachMovie, comme le lecteur.
 *
 * Trois bibliothèques externes de l'époque sont restituées d'après leur
 * bytecode (scripts/disasm-as2.js sur lib/menu.swf) :
 *   · ext.game.Stat — un sac de compteurs, listé dans l'ORDRE INVERSE de
 *     création (le for…in de l'AVM1 remonte la liste) ;
 *   · ext.util.MTNumber.getTimeStr — mm'ss''cc ;
 *   · asml.KeyManager — les noms français des touches ;
 *   · ext.geom.CoefSquare — le masque « camembert carré » des disques.
 */
'use strict';

(function (racine) {

const K = racine.KalugaMoteur;
const J = racine.KalugaJeu = racine.KalugaJeu || {};

const random = (n) => Math.floor(Math.random() * n);
J.random = random;

// ── Cs ────────────────────────────────────────────────────────────────────
const Cs = { mcw: 700, mch: 480, tmod: 1 };
J.Cs = Cs;

// ── MC ────────────────────────────────────────────────────────────────────
const MC = {
  drawSquare(mc, pos, col) {
    if (col == null) col = mc.lastColor;
    mc.moveTo(pos.x, pos.y);
    mc.beginFill(col);
    mc.lineTo(pos.x + pos.w, pos.y);
    mc.lineTo(pos.x + pos.w, pos.y + pos.h);
    mc.lineTo(pos.x, pos.y + pos.h);
    mc.lineTo(pos.x, pos.y);
    mc.endFill();
  },
  setPColor(mc, color, percent) {
    if (typeof color === 'number') {
      const hex = color.toString(16);
      color = { r: Number('0x' + hex.substring(0, 2)), g: Number('0x' + hex.substring(2, 4)), b: Number('0x' + hex.substring(4, 6)) };
    }
    if (mc.colorObject == null) {
      mc.colorObject = { actual: { col: { r: 0, g: 0, b: 0 }, percent: 100 } };
      mc.colorObject.col = new K.Color(mc);
    }
    if (color != null) mc.colorObject.actual = { col: color, percent };
    const act = mc.colorObject.actual;
    const coef = (100 - act.percent) / 100;
    const r = act.col.r * coef, g = act.col.g * coef, b = act.col.b * coef;
    mc.colorObject.col.setTransform({ ra: act.percent, ga: act.percent, ba: act.percent, aa: 100, rb: r, gb: g, bb: b, ab: 0 });
  },
};
J.MC = MC;

// ── ext.game.Stat ─────────────────────────────────────────────────────────
class Stat {
  constructor() { this.vals = {}; this.ordre = []; }
  setVal(name, v) { if (!(name in this.vals)) this.ordre.push(name); this.vals[name] = v; }
  incVal(name, v) { if (this.vals[name] === undefined) { this.vals[name] = 0; this.ordre.push(name); } this.vals[name] += v; }
  bestVal(name, v) { if (this.vals[name] === undefined) { this.vals[name] = -Infinity; this.ordre.push(name); } if (this.vals[name] < v) this.vals[name] = v; }
  getList(type) {
    if (type === undefined) type = 'all';
    const l = [];
    // Le for…in de l'AVM1 énumère du plus récent au plus ancien.
    for (let i = this.ordre.length - 1; i >= 0; i--) {
      const name = this.ordre[i];
      if (type === 'name') l.push(name + ' : \n');
      else if (type === 'score') l.push(Math.round(this.vals[name] * 10) / 10 + '\n');
      else l.push(name + ' : ' + this.vals[name] + '\n');
    }
    return l.join('');
  }
}
J.Stat = Stat;

// ── ext.util.MTNumber ─────────────────────────────────────────────────────
J.MTNumber = {
  getTimeStr(t, sepMin, sepSec) {
    let min = Math.floor(t / 60000);
    let sec = Math.floor((t - min * 60000) / 1000);
    let mil = Math.round((t - (min * 60000 + sec * 1000)) / 10);
    min = String(min); sec = String(sec); mil = String(mil);
    if (min.length < 2) min = '0' + min;
    if (sec.length < 2) sec = '0' + sec;
    if (mil.length < 2) mil = '0' + mil;
    let r = min;
    if (sepMin !== undefined) r += sepMin + sec;
    if (sepSec !== undefined) r += sepSec + mil;
    return r;
  },
};

// ── asml.KeyManager ───────────────────────────────────────────────────────
const KEYNAMES = [];
for (let i = 0; i < 256; i++) KEYNAMES[i] = '?';
for (let i = 65; i <= 90; i++) KEYNAMES[i] = String.fromCharCode(i);
for (let i = 48; i <= 57; i++) KEYNAMES[i] = String.fromCharCode(i);
for (let i = 96; i <= 105; i++) KEYNAMES[i] = 'PavNum ' + (i - 96);
Object.assign(KEYNAMES, { 106: 'PavNum *', 107: 'PavNum +', 108: 'PavNum Entrée', 109: 'PavNum -', 110: 'PavNum Suppr', 111: 'PavNum /' });
for (let i = 112; i <= 123; i++) KEYNAMES[i] = 'F ' + (i - 111);
Object.assign(KEYNAMES, {
  8: 'Retour', 9: 'TAB', 12: 'Supprimer', 13: 'Entrée', 16: 'Majuscule', 17: 'Controle', 18: 'Alt', 20: 'Verr.Maj.', 27: 'Echappe',
  32: 'Espace', 33: 'Page préc.', 34: 'Page suiv.', 35: 'Fin', 36: 'Début', 37: 'Gauche', 38: 'Haut', 39: 'Droite', 40: 'Bas',
  45: 'Insérer', 46: 'Supprimer', 47: 'Aide', 144: 'VerrNum', 186: '$ £', 187: ' =  +', 189: '- _', 191: ': /', 192: 'ù %',
  219: '° )', 220: '* µ', 221: '^ ¨', 222: '²',
});
class KeyManager {
  constructor() { this.config = []; }
  setConfig(id, key) { this.config[id] = key; }
  getConfig(id) { return this.config[id]; }
  getKeyName(key) { return KEYNAMES[key] === undefined ? '?' : KEYNAMES[key]; }
}
KeyManager.KEYNAMES = KEYNAMES;
J.KeyManager = KeyManager;

// ── ext.geom.CoefSquare ───────────────────────────────────────────────────
class CoefSquare extends K.Clip {
  constructor(biblio, id) { super(biblio, id); }
  constructeur() { this.init(); }
  init() {
    if (this.color == null) this.color = 0xFF0000;
    if (this.alpha == null) this.alpha = 100;
    if (this.ray == null) this.ray = 10;
    if (this.coef == null) this.coef = 1;
  }
  update() {
    const r = this.ray;
    this.clear();
    this.beginFill(this.color, this.alpha);
    this.moveTo(0, 0);
    this.lineTo(0, -r);
    this.lineTo(r, -r);
    if (this.coef >= 0.25) {
      this.lineTo(r, r);
      if (this.coef >= 0.5) {
        this.lineTo(-r, r);
        if (this.coef >= 0.75) this.lineTo(-r, -r);
      }
    }
    const a = this.coef * 6.28 - 1.57;
    this.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    this.endFill();
  }
}
J.CoefSquare = CoefSquare;
K.registerClass('geomCoefSquare', CoefSquare);

// ── AnimList ──────────────────────────────────────────────────────────────
class AnimList {
  constructor() { this.init(); }
  init() { this.list = []; }
  addAnim(name, id, endCall) {
    for (const anim of this.list) {
      if (anim.name === name) { K.clearInterval(anim.id); anim.id = id; anim.endCall = endCall; return; }
    }
    this.list.push({ name, id, endCall });
  }
  remove(name) {
    for (let i = 0; i < this.list.length; i++) {
      const anim = this.list[i];
      if (anim.name === name) {
        if (anim.endCall && anim.endCall.obj && typeof anim.endCall.obj[anim.endCall.method] === 'function') anim.endCall.obj[anim.endCall.method](anim.endCall.args);
        K.clearInterval(anim.id);
        this.list.splice(i, 1);
        return;
      }
    }
  }
  removeAll() { while (this.list.length > 0) { const anim = this.list[0]; K.clearInterval(anim.id); this.list.shift(); } }
  addSlide(name, target, endCall, ratio) {
    if (target.regular == null) target.regular = {};
    target.regular.x = target._x;
    target.regular.y = target._y;
    if (ratio == null) ratio = 1;
    this.addAnim(name, K.setInterval(this, 'slide', 25, name, target, ratio), endCall);
  }
  slide(name, mc, ratio) {
    if (!mc._parent) { this.remove(name); return; }
    const c = Math.pow(0.8, Cs.tmod * ratio);
    mc.regular.x = mc.regular.x * c + mc.pos.x * (1 - c);
    mc.regular.y = mc.regular.y * c + mc.pos.y * (1 - c);
    mc._x = mc.regular.x;
    mc._y = mc.regular.y;
    if (Math.round(mc.regular.y) === Math.round(mc.pos.y) && Math.round(mc.regular.x) === Math.round(mc.pos.x)) {
      mc._x = mc.pos.x;
      mc._y = mc.pos.y;
      this.remove(name);
    }
    if (mc.followList && mc.followList.length > 0) {
      for (const mc2 of mc.followList) { mc2._x = mc._x; mc2._y = mc._y; }
    }
  }
  addPaint(name, mc, color, percent, endCall, ratio) {
    if (mc.colorObject == null) MC.setPColor(mc);
    mc.colorObject.target = { col: color, percent };
    if (ratio == null) ratio = 1;
    this.addAnim(name, K.setInterval(this, 'paint', 25, name, mc, ratio), endCall);
  }
  paint(name, mc, ratio) {
    if (!mc._parent) { this.remove(name); return; }
    const c = Math.pow(0.8, Cs.tmod * ratio);
    const act = mc.colorObject.actual, targ = mc.colorObject.target;
    act.col.r = act.col.r * c + targ.col.r * (1 - c);
    act.col.g = act.col.g * c + targ.col.g * (1 - c);
    act.col.b = act.col.b * c + targ.col.b * (1 - c);
    act.percent = act.percent * c + targ.percent * (1 - c);
    MC.setPColor(mc);
    if (Math.abs(act.percent - targ.percent) + Math.abs(act.col.r - targ.col.r) + Math.abs(act.col.g - targ.col.g) + Math.abs(act.col.b - targ.col.b) < 4) this.remove(name);
  }
}
J.AnimList = AnimList;

// ── FrameAnimManager ──────────────────────────────────────────────────────
class FrameAnimManager {
  constructor(initObj) { Object.assign(this, initObj); this.init(); }
  init() {
    if (this.start == null) this.start = 1;
    if (this.frame == null) this.frame = this.start;
    if (this.end == null) this.end = 21;
    if (this.flLoop == null) this.flLoop = true;
    if (this.flLoop) this.dif = this.end - this.start;
  }
  update(coef) {
    if (coef == null) coef = 1;
    this.frame += Cs.tmod * coef;
    let f = Math.round(this.frame);
    if (f >= this.end) {
      if (this.flLoop) {
        while (f >= this.end) { this.frame -= this.dif; f -= this.dif; }
      } else {
        f = this.end;
        if (this.callBack) this.callBack.obj[this.callBack.method](this.callBack.args);
      }
    }
    this.root.gotoAndStop(f);
  }
}
J.FrameAnimManager = FrameAnimManager;

// ── Numb ──────────────────────────────────────────────────────────────────
class Numb extends K.Clip {
  constructeur() { this.init(); }
  init() {
    if (this.align == null) this.align = 1;
    if (this.scale == null) this.scale = 100;
    if (this.link == null) this.link = 'numberRed';
    if (this.num) this.setNum(this.num);
  }
  setNum(num) {
    this.num = num;
    this.createEmptyMovieClip('compteur', 1);
    const n = Number(num).toString();
    let x = 0;
    for (let i = 0; i < n.length; i++) {
      this.compteur.attachMovie(this.link, 'n' + i, i);
      const mc = this.compteur['n' + i];
      const c = n.substr(i, 1);
      if (c !== '.') mc.gotoAndStop(Number(c) + 1); else mc.gotoAndStop(11);
      mc._x = x;
      x += mc._width;
    }
    this.compteur._xscale = this.scale;
    this.compteur._yscale = this.scale;
    this.compteur._x = (-this.compteur._width / 2) * this.align;
  }
}
J.Numb = Numb;
K.registerClass('numb', Numb);

// ── Scroller ──────────────────────────────────────────────────────────────
class Scroller extends K.Clip {
  constructeur() { this.init(); }
  init() { this.tNum = 0; this.list = []; this.animList = new AnimList(); }
  update() {}
  put(name, bonus) {
    this.list.push({ name, bonus });
    if (this.list.length === 1) this.displayNext();
  }
  displayNext() {
    const d = (this.tNum++) % 100;
    this.attachMovie('scrollText', 't' + d, d);
    const mc = this['t' + d];
    mc.nameField.text = this.list[0].name + ' ' + this.list[0].bonus;
    mc.regular = { x: 0, y: -40 };
    mc.pos = { x: 0, y: 0 };
    mc._x = mc.regular.x;
    mc._y = mc.regular.y;
    mc.d = d;
    this.animList.addSlide('slide' + d, mc, { obj: this, method: 'setWait', args: mc });
  }
  setWait(mc) { mc.waitId = K.setInterval(this, 'remove', 1000, mc); }
  remove(mc) {
    K.clearInterval(mc.waitId);
    mc.pos = { x: 0, y: -40 };
    this.animList.addSlide('slide' + mc.d, mc, { obj: mc, method: 'removeMovieClip' });
    this.list.shift();
    if (this.list.length > 0) this.displayNext();
  }
}
J.Scroller = Scroller;
K.registerClass('scroller', Scroller);

// ── SoundManager ──────────────────────────────────────────────────────────
class SoundManager extends K.Clip {
  constructeur() { this.channels = []; this.fade_pos = -1; this.flActive = true; }
  destroy() {
    for (const c of this.channels) {
      if (!c) continue;
      for (const s of Object.keys(c.sounds)) c.sounds[s].stop();
      c.mc.removeMovieClip();
    }
    this.channels = [];
  }
  getChannel(chan) {
    let c = this.channels[chan];
    if (c == null) {
      const mc = this.createEmptyMovieClip('chan' + chan, chan);
      c = { mc, sounds: {}, vol: 100, vol_ctrl: new K.Sound(mc), nb: chan, enabled: true };
      this.channels[chan] = c;
    }
    return c;
  }
  getSound(name, chan) {
    const c = this.getChannel(chan);
    let s = c.sounds[name];
    if (s == null) {
      s = new K.Sound(c.mc);
      s.attachSound(name);
      s.onSoundComplete = function () { this.playing = false; };
      s.playing = false;
      c.sounds[name] = s;
    }
    return s;
  }
  playSound(name, chan) {
    const s = this.getSound(name, chan);
    s.start(0, 1);
    s.playing = true;
    this.enable(chan, this.flActive);
  }
  play(name) { this.playSound(name, 0); }
  loop(name, chan) {
    const s = this.getSound(name, chan);
    s.start(0, 0xFFFF);
    s.playing = true;
    this.enable(chan, this.flActive);
  }
  stopSound(name, chan) {
    const s = this.getSound(name, chan);
    s.stop();
    s.playing = false;
  }
  fade(chan_from, chan_to, length) {
    if (this.fade_pos !== -1) {
      this.setVolume(this.fade_to.nb, this.fade_end);
      this.stop(this.fade_from.nb);
      this.setVolume(this.fade_from.nb, this.fade_end);
    }
    this.fade_from = this.getChannel(chan_from);
    this.fade_to = this.getChannel(chan_to);
    this.fade_start = this.fade_to.vol;
    this.fade_end = this.fade_from.vol;
    this.fade_pos = 0;
    this.fade_len = length;
  }
  main() {
    if (this.fade_pos !== -1) {
      let last_fade = false;
      this.fade_pos += K.Std.deltaT / this.fade_len;
      if (this.fade_pos >= 1) { this.fade_pos = 1; last_fade = true; }
      const volume = (this.fade_end - this.fade_start) * this.fade_pos + this.fade_start;
      this.setVolume(this.fade_to.nb, volume);
      this.setVolume(this.fade_from.nb, this.fade_end - volume);
      if (last_fade) { this.fade_pos = -1; this.stop(this.fade_from.nb); this.setVolume(this.fade_from.nb, this.fade_end); }
    }
  }
  enable(chan, flag) {
    const c = this.getChannel(chan);
    c.enabled = flag;
    if (c.enabled) c.vol_ctrl.setVolume(c.vol); else c.vol_ctrl.setVolume(0);
  }
  stop(chan) {
    const c = this.getChannel(chan);
    for (const s of Object.keys(c.sounds)) { c.sounds[s].stop(); c.sounds[s].playing = false; }
  }
  isPlaying(name, chan) { return this.getSound(name, chan).playing; }
  setVolume(chan, volume) {
    const c = this.getChannel(chan);
    c.vol = volume;
    if (c.enabled) c.vol_ctrl.setVolume(c.vol);
  }
  setActive(flag) {
    this.flActive = flag;
    for (const o of this.channels) if (o != null) this.enable(o.nb, this.flActive);
  }
}
J.SoundManager = SoundManager;
K.registerClass('mcSoundManager', SoundManager);

// ── Slot ──────────────────────────────────────────────────────────────────
class Slot extends K.Clip {
  init() {}
  kill() {
    this.mng.removeSlot(this);
    this.removeMovieClip();
  }
}
J.Slot = Slot;

// ── Bar, InfoBar, bar.Score, bar.Disc, bar.Timer ──────────────────────────
class Bar extends K.Clip {
  init() { this.initDefault(); }
  initDefault() {
    if (this.width == null) this.width = 10;
    if (this.margin == null) this.margin = { x: { ratio: 0.5, min: 6 }, y: { ratio: 0, min: 3 } };
  }
  update() {}
  kill() { this.infoBar.removeElement(this); this.removeMovieClip(); }
}
J.Bar = Bar;

class InfoBar extends K.Clip {
  constructeur() { this.init(); }
  init() { this.list = []; this.eNum = 0; }
  addElement(link, initObj) {
    if (initObj == null) initObj = {};
    initObj.infoBar = this;
    const d = (this.eNum++) % 100;
    this.attachMovie(link, 'element' + d, d, initObj);
    const mc = this['element' + d];
    this.list.push(mc);
    this.updatePos();
    return mc;
  }
  removeElement(mc) {
    const i = this.list.indexOf(mc);
    if (i >= 0) this.list.splice(i, 1);
  }
  updatePos() {
    let x = 0;
    for (const mc of this.list) { mc._x = x; x -= mc.width + mc.margin.x.min; }
  }
  update() { for (const mc of this.list) mc.update(); }
}
J.InfoBar = InfoBar;
K.registerClass('infoBar', InfoBar);

class BarScore extends Bar {
  constructeur() { this.scale = 100; this.init(); }
  init() { super.init(); }
  initDefault() { if (this.width == null) this.width = 160; super.initDefault(); }
  setScore(score) {
    this.attachMovie('numb', 'score', 1, { num: score, scale: this.scale, align: 2, link: 'numberGreen' });
    this.score._y = this.margin.x.ratio * this.margin.x.min + 15 * (this.scale / 100);
    this.score._x = -this.margin.y.ratio * this.margin.y.min;
  }
}
J.BarScore = BarScore;
K.registerClass('barScore', BarScore);

class BarDisc extends Bar {
  constructeur() { this.init(); }
  init() {
    super.init();
    this.initSkin();
    this.initMask();
    this.mask.update();
  }
  initDefault() {
    super.initDefault();
    if (this.link == null) this.link = 'discFruit';
    if (this.flShadow == null) this.flShadow = true;
  }
  initSkin() {
    this.attachMovie(this.link, 'skin', 10);
    this.skin._xscale = this.width;
    this.skin._yscale = this.width;
    this.skin._x = -(this.margin.x.ratio * this.margin.x.min + this.width / 2);
    this.skin._y = (1 - this.margin.y.ratio) * this.margin.y.min + this.width / 2;
    this.skin.stop();
    if (this.flShadow) {
      this.attachMovie(this.link, 'shadow', 8);
      this.shadow.gotoAndStop(2);
      this.shadow._xscale = this.width;
      this.shadow._yscale = this.width;
      this.shadow._x = this.skin._x;
      this.shadow._y = this.skin._y;
    }
  }
  initMask() {
    this.attachMovie('geomCoefSquare', 'mask', 14, { ray: this.width / 2 });
    this.skin.setMask(this.mask);
    this.mask._x = this.skin._x;
    this.mask._y = this.skin._y;
  }
  setCoef(c) { this.mask.coef = c; this.mask.update(); }
}
J.BarDisc = BarDisc;
K.registerClass('barDisc', BarDisc);

class BarTimer extends Bar {
  constructeur() { this.init(); }
  init() { this.width = 120; this.flAutoUpdate = false; super.init(); }
  setTimer(t) {
    let min = Math.floor(t / 60000);
    let sec = Math.floor((t - min * 60000) / 1000);
    let mil = Math.round((t - (min * 60000 + sec * 1000)) / 10);
    min = String(min); sec = String(sec); mil = String(mil);
    if (min.length < 2) min = '0' + min;
    if (sec.length < 2) sec = '0' + sec;
    if (mil.length < 2) mil = '0' + mil;
    this.fieldMin.text = min;
    this.fieldSec.text = sec;
    this.fieldMil.text = mil;
  }
  update() {
    super.update();
    if (this.flAutoUpdate) {
      const now = K.getTimer();
      this.time = now - this.startValue;
      this.setTimer(this.time);
    }
  }
  decal(n) { this.startValue += n; }
  startTimer() { this.startValue = K.getTimer(); this.flAutoUpdate = true; }
  stopTimer() { this.flAutoUpdate = false; }
}
J.BarTimer = BarTimer;
K.registerClass('barTimer', BarTimer);

// ── Panel ─────────────────────────────────────────────────────────────────
class Panel extends K.Clip {
  constructeur() { this.mcw = 464; this.mch = 344; this.init(); }
  init() {
    this.margin = { x: { min: 20, ratio: 0.5 }, y: { min: 30, ratio: 1 } };
    this.depth = 0;
    this.pageNum = 0;
    this.attachMovie('transp', 'nextBut', 4);
    this.nextBut.onPress = function () { this._parent.nextPage(); };
    this.nextBut._xscale = this.mcw;
    this.nextBut._yscale = this.mch;
    this.setPage();
  }
  setPage() {
    const page = this.list[this.pageNum];
    if (page === 'menu') { this.game.mng.backToMenu(); return; }
    if (page === 'kill') { this.game.mng.client.closeService(); }
    if (page == null || typeof page !== 'object') return;
    this._parent.gotoAndStop(1);
    this.updateList = [];
    this.createEmptyMovieClip('mcPage', 10);
    if (page.label == null) this.gotoAndStop('empty'); else this.gotoAndStop(page.label);
    let y = this.margin.y.min * this.margin.y.ratio;
    for (const part of page.list) y += this.setPart(part, y) || 0;
    this.nextBut._visible = (page.wait == null) && (this.pageNum < this.list.length - 1);
  }
  setPart(part, y) {
    let d, mc;
    switch (part.type) {
      case 'bigScore':
        d = this.depth++;
        this.mcPage.attachMovie('partBigScore', 'part' + d, d, part);
        mc = this.mcPage['part' + d];
        mc._y = y;
        return 42;
      case 'littleScore':
        d = this.depth++;
        this.mcPage.attachMovie('partLittleScore', 'part' + d, d, part);
        mc = this.mcPage['part' + d];
        mc.fieldTitle.text = part.title;
        mc.fieldScore.text = part.score;
        mc._y = y;
        return 22;
      case 'title':
        d = this.depth++;
        this.mcPage.attachMovie('partTitle', 'part' + d, d, part);
        mc = this.mcPage['part' + d];
        mc.field.text = part.title;
        mc._y = y;
        return 42;
      case 'stats':
        d = this.depth++;
        this.mcPage.attachMovie('partStats', 'part' + d, d, part);
        mc = this.mcPage['part' + d];
        mc._y = y;
        this.updateList.push(mc);
        return part.box.h + 12;
      case 'graph':
        d = this.depth++;
        this.mcPage.attachMovie(part.gfx, 'part' + d, d, part);
        mc = this.mcPage['part' + d];
        mc._y = y;
        return part.box.h + 12;
      case 'msg':
        this.fieldTitle.text = part.title;
        this.fieldText.text = part.msg;
        return this.fieldText.textHeight + 40;
      case 'congrat':
        this._parent.gotoAndStop(2);
        this.fieldText.text = part.text;
        this.fieldText._y = 60 + (80 - this.fieldText.textHeight) / 2;
        this.illus.gotoAndStop(part.id + 1);
        return 100;
      case 'ladder':
        this._parent.gotoAndStop(3);
        this.fieldText.text = part.text;
        this.fieldText._y = 60 + (80 - this.fieldText.textHeight) / 2;
        this.illus.p0.gotoAndStop(part.list[0].id + 1);
        this.illus.p1.gotoAndStop(part.list[1].id + 1);
        this.illus.p2.gotoAndStop(part.list[2].id + 1);
        return 100;
      case 'but':
        d = this.depth++;
        this.mcPage.attachMovie('partBut', 'part' + d, d, part);
        mc = this.mcPage['part' + d];
        mc._y = y;
        return 28;
      case 'table':
        d = this.depth++;
        this.mcPage.attachMovie('partTable', 'part' + d, d, part);
        mc = this.mcPage['part' + d];
        mc._y = y;
        return part.box.h + 12;
      case 'margin':
        return part.value;
      default:
        return 0;
    }
  }
  nextPage() { this.pageNum++; this.setPage(); }
  update() {
    for (const p of this.updateList) p.update();
    const page = this.list[this.pageNum];
    if (page && typeof page === 'object' && page.wait != null) {
      if (!page.wait.o[page.wait.v]) this.nextPage();
    }
  }
}
J.Panel = Panel;
K.registerClass('panel', Panel);

// ── Part et ses déclinaisons ──────────────────────────────────────────────
// Les fontes que le code nomme par leur nom : « President » et « Donald » sont
// EMBARQUÉES dans le SWF (aucun joueur ne les avait sur sa machine), on écrit
// donc avec elles ; « Verdana » reste la fonte système.
const FONTES_NOMMEES = { president: 648, donald: 92, impact: 430 };
function fonteDe(nom) {
  if (typeof nom !== 'string') return nom;
  const id = FONTES_NOMMEES[nom.toLowerCase()];
  return id === undefined ? nom : id;
}
J.fonteDe = fonteDe;

class Part extends K.Clip {
  init() {}
  drawBackground() {
    const box = this.box;
    this.lineStyle(1, 0xBAD595);
    this.beginFill(0xE8EFD8);
    this.moveTo(box.x, box.y);
    this.lineTo(box.x + box.w, box.y);
    this.lineTo(box.x + box.w, box.y + box.h);
    this.lineTo(box.x, box.y + box.h);
    this.lineTo(box.x, box.y);
    this.endFill();
  }
  createField(mc, text, pos, depth, align, textFormat) {
    if (textFormat == null) textFormat = { font: 'Verdana', size: 10, color: 0xBAD595 };
    mc.createTextField('field' + depth, depth, pos.x, pos.y, pos.w, pos.h);
    const field = mc['field' + depth];
    field.text = text;
    field.selectable = false;
    const tf = field.getTextFormat();
    for (const elem of Object.keys(textFormat)) tf[elem] = textFormat[elem];
    if (align != null) tf.align = align;
    if (tf.font) tf.font = fonteDe(tf.font);
    field.setTextFormat(tf);
    return field;
  }
}
J.Part = Part;

class PartBigScore extends Part {
  constructeur() { this.init(); }
  init() { super.init(); this.gotoAndStop(this.frame); this.field.text = this.score; }
}
K.registerClass('partBigScore', PartBigScore);

class PartBut extends Part {
  constructeur() { this.center = 232; this.init(); }
  init() { super.init(); this.field.text = this.title; this.initTzongres(); }
  initTzongres() {
    const dx = 36 + (this.field.textWidth / 2);
    this.tz1._x = this.center - dx;
    this.tz2._x = this.center + dx;
    this.tz1._visible = false;
    this.tz2._visible = false;
  }
  select() { this.callback.obj[this.callback.method](this.callback.args); }
  rOver() { this.tz1._visible = true; this.tz2._visible = true; }
  rOut() { this.tz1._visible = false; this.tz2._visible = false; }
}
K.registerClass('partBut', PartBut);

class PartStats extends Part {
  constructeur() { this.margin = 8; this.init(); }
  init() { super.init(); this.drawBackground(); this.initFields(); }
  initFields() {
    const box = this.box, margin = this.margin;
    this.attachMovie('whiteSquare', 'mask', 130);
    this.mask._x = box.x;
    this.mask._y = box.y;
    this.mask._xscale = box.w;
    this.mask._yscale = box.h;
    this.createEmptyMovieClip('content', 125);
    this.content.setMask(this.mask);
    this.content.createTextField('fieldName', 10, box.x + margin, box.y, box.w - margin, box.h);
    this.content.fieldName.html = true;
    this.content.fieldName.selectable = false;
    this.content.fieldName.multiline = true;
    this.content.fieldName.htmlText = this.name;
    let tf = this.content.fieldName.getTextFormat();
    tf.font = fonteDe('Verdana'); tf.size = 10; tf.align = 'left'; tf.color = 0x637c32;
    this.content.fieldName.setTextFormat(tf);
    this.content.createTextField('fieldScore', 12, box.x, box.y, box.w - margin, box.h);
    this.content.fieldScore.selectable = false;
    this.content.fieldScore.multiline = true;
    this.content.fieldScore.text = this.score;
    tf = this.content.fieldScore.getTextFormat();
    tf.font = fonteDe('Verdana'); tf.size = 10; tf.align = 'right'; tf.color = 0x637c32;
    this.content.fieldScore.setTextFormat(tf);
    this.content.fieldName._height = this.content.fieldName.textHeight + 8;
    this.content.fieldScore._height = this.content.fieldScore.textHeight + 8;
  }
  update() {
    const h = this.box.h / 2;
    const dif = (this._ymouse - this.box.y) - h;
    if (Math.abs(dif) < h) {
      const y = this.content._y - dif / 50;
      this.content._y = Math.min(Math.max(y, this.box.h - this.content._height), 0);
    }
  }
}
K.registerClass('partStats', PartStats);

class PartTable extends Part {
  constructeur() {
    this.slotWidth = 72; this.cutWidth = 51; this.slotHeight = 36; this.cutHeight = 15; this.slotSpace = 6;
    this.init();
  }
  init() { super.init(); this.depthRun = 0; this.display(); }
  display() {
    this.clear();
    const max = this.stats.length;
    const margin = (this.box.w - (max * (this.slotWidth + this.slotSpace))) / 2;
    for (let i = 0; i < max; i++) {
      const player = this.stats[i];
      let x = margin + i * (this.slotWidth + this.slotSpace);
      if (i === max - 1) x += this.slotSpace;
      const d = this.depthRun++;
      this.attachMovie('partTableTzIcon', 'icon' + i, d);
      const mc = this['icon' + i];
      mc._x = x;
      mc.gotoAndStop(player.id + 1);
      const list = player.results;
      for (let e = 0; e < list.length; e++) this.drawSlot(x, 24 + e * this.slotHeight, list[e]);
      this.drawSum(x, 24 + list.length * this.slotHeight + 8, list);
    }
  }
  drawSlot(x, y, slotInfo) {
    this.lineStyle(1, 0xBAD595);
    this.moveTo(x, y);
    this.lineTo(x + this.slotWidth, y);
    this.lineTo(x + this.slotWidth, y + this.slotHeight);
    this.lineTo(x, y + this.slotHeight);
    this.lineTo(x, y);
    this.moveTo(x + this.cutWidth, y);
    this.lineTo(x + this.cutWidth, y + this.cutHeight);
    this.moveTo(x, y + this.cutHeight);
    this.lineTo(x + this.slotWidth, y + this.cutHeight);
    let tf = { font: 'President', size: 12, color: 0xBAD595 };
    let pos = { x, y, w: this.cutWidth, h: this.cutHeight };
    this.createField(slotInfo.base, pos, 'center', tf);
    tf = { font: 'Verdana', size: 10, bold: true, color: 0xBAD595 };
    pos = { x: x + this.cutWidth, y: y - 1, w: this.slotWidth - this.cutWidth, h: this.cutHeight };
    this.createField(slotInfo.coef, pos, 'center', tf);
    tf = { font: 'President', size: 18, color: 0x637C32 };
    pos = { x, y: y + this.cutHeight - 1, w: this.slotWidth, h: this.slotHeight - this.cutHeight };
    this.createField(slotInfo.score, pos, 'center', tf);
  }
  drawSum(x, y, list) {
    this.moveTo(x, y);
    this.lineTo(x + this.slotWidth, y);
    this.lineTo(x + this.slotWidth, y + this.slotHeight - this.cutHeight);
    this.lineTo(x, y + this.slotHeight - this.cutHeight);
    this.lineTo(x, y);
    let sum = 0;
    for (const r of list) sum += r.score;
    const tf = { font: 'President', size: 18, color: 0x637C32 };
    const pos = { x, y: y - 1, w: this.slotWidth, h: this.slotHeight - this.cutHeight };
    this.createField(sum, pos, 'center', tf);
  }
  createField(text, pos, align, textFormat) {
    const depth = this.depthRun++;
    return super.createField(this, text, pos, depth, align, textFormat);
  }
}
K.registerClass('partTable', PartTable);

class PartGraph extends Part {
  init() { this.draw(); }
  draw() { if (this.flBackground) this.drawBackground(); }
  modCol(nb, inc, coef) {
    if (inc == null) inc = 0;
    if (coef == null) coef = 1;
    let r = (nb >> 16) & 0xFF, g = (nb >> 8) & 0xFF, b = nb & 0xFF;
    r = Math.min(Math.max(0, Math.round((r + inc) * coef)), 255);
    g = Math.min(Math.max(0, Math.round((g + inc) * coef)), 255);
    b = Math.min(Math.max(0, Math.round((b + inc) * coef)), 255);
    return (r << 16) | (g << 8) | b;
  }
}
J.PartGraph = PartGraph;

class PartGraphBar extends PartGraph {
  constructeur() { this.tSide = 20; this.tSpace = 5; this.init(); }
  init() {
    if (this.color == null) this.color = { main: 0xF5F8F0, line: 0xBAD595 };
    super.init();
  }
  draw() {
    super.draw();
    const box = this.box, margin = this.margin;
    const size = (box.w - (margin * 2 + (this.list.length - 1) * this.marginInt)) / this.list.length;
    for (let i = 0; i < this.list.length; i++) {
      const data = this.list[i];
      const h = data.value * (box.h - margin * 2);
      if (this.flTriangle && h > this.tSide) {
        this.createEmptyMovieClip('bar' + i, i);
        const mc = this['bar' + i];
        mc.lineStyle(1, this.color.line);
        mc.beginFill(this.color.main);
        const pos = { x: box.x + margin + i * (size + this.marginInt), y: box.y + box.h - margin, w: size, h };
        mc.moveTo(pos.x, pos.y);
        if (this.flTriangle) {
          mc.lineTo((pos.x + pos.w) - this.tSide, pos.y);
          mc.lineTo(pos.x + pos.w, pos.y - this.tSide);
        } else {
          mc.lineTo(pos.x + pos.w, pos.y);
        }
        mc.lineTo(pos.x + pos.w, pos.y - pos.h);
        mc.lineTo(pos.x, pos.y - pos.h);
        mc.lineTo(pos.x, pos.y);
        mc.endFill();
        mc.lineStyle(1, this.modCol(data.color, -40));
        mc.beginFill(data.color);
        if (this.flTriangle) {
          mc.moveTo(pos.x + pos.w, pos.y);
          mc.lineTo(pos.x + pos.w, (pos.y + this.tSpace) - this.tSide);
          mc.lineTo((pos.x + pos.w + this.tSpace) - this.tSide, pos.y);
          mc.lineTo(pos.x + pos.w, pos.y);
          mc.endFill();
        }
        if (this.flNumber && h > 20) {
          const p = { x: pos.x, y: pos.y - pos.h, w: pos.w, h: 20 };
          this.createField(mc, data.num, p, 1, 'center');
        }
      }
    }
  }
}
K.registerClass('partGraphBar', PartGraphBar);

class PartGraphCurve extends PartGraph {
  constructeur() { this.init(); }
  init() {
    if (this.color == null) this.color = { main: 0xF5F8F0, curve: 0xBAD595, line: 0xDFEACA, ghost: 0xFF0000 };
    if (this.flCurve == null) this.flCurve = true;
    if (this.marginInt == null) this.marginInt = 0;
    if (this.marginUp == null) this.marginUp = 0;
    super.init();
  }
  draw() {
    super.draw();
    const box = this.box;
    const pos = { x: box.x + this.margin, y: box.y + this.margin, w: box.w - 2 * this.margin, h: box.h - 2 * this.margin };
    if (this.flLine) {
      this.lineStyle(1, this.color.line);
      let coef = this.line;
      let h = this.lineBase;
      let d = 0;
      while (coef < 1) {
        d++;
        const y = (pos.y + pos.h) - coef * (pos.h - this.marginUp);
        this.moveTo(pos.x, y);
        this.lineTo(pos.x + pos.w, y);
        const p = { x: pos.x, y: y - 14, w: pos.x + 50, h: 16 };
        this.createField(this, h + this.lineSuffix, p, d);
        h += this.lineBase;
        coef += this.line;
        if (d > 1000) break;
      }
    }
    this.lineStyle(1, this.color.curve);
    this.moveTo(pos.x, pos.y);
    this.lineTo(pos.x, pos.y + pos.h);
    this.lineTo(pos.x + pos.w, pos.y + pos.h);
    this.lineTo(pos.x + pos.w, pos.y);
    if (this.flNode) this.createEmptyMovieClip('nodeLayer', 67);
    if (this.flCurve) {
      this.lineStyle(1, this.color.curve);
      this.moveTo(pos.x + this.marginInt, pos.y + pos.h);
      this.beginFill(this.color.main);
    }
    const step = (pos.w - this.marginInt * 2) / (this.list.length - 1);
    for (let i = 0; i < this.list.length; i++) {
      const data = this.list[i];
      const x = pos.x + this.marginInt + i * step;
      const y = pos.y + pos.h - (data.value * (pos.h - this.marginUp));
      if (this.flCurve) this.lineTo(x, y);
      if (this.flNode) {
        const d = i + 100;
        this.nodeLayer.attachMovie('node', 'node' + d, 100 + d);
        const mc = this.nodeLayer['node' + d];
        mc._x = x; mc._y = y;
        mc.gotoAndStop(this.nodeFrame);
      }
    }
    if (this.flCurve) { this.lineTo(pos.x + (pos.w - this.marginInt), pos.y + pos.h); this.endFill(); }
    if (this.flGhost) {
      for (let i = 0; i < this.list.length; i++) {
        const data = this.list[i];
        const x = pos.x + this.marginInt + i * step;
        const y = pos.y + pos.h - (data.ghost * (pos.h - this.marginUp));
        if (this.flNode) {
          this.nodeLayer.attachMovie('node', 'node' + i, i);
          const mc = this.nodeLayer['node' + i];
          mc._x = x; mc._y = y;
          mc._alpha = 20;
          mc.gotoAndStop(this.nodeFrame);
        }
      }
    }
  }
}
K.registerClass('partGraphCurve', PartGraphCurve);

})(typeof window !== 'undefined' ? window : globalThis);
