/*
 * Kaluga — les SÉQUENCES : les scripts d'image des deux films que le menu
 * charge (SEQUENCE → INTRODUCTION : anim/intro/intro.swf ; CREDITS :
 * anim/credits/credits.swf), portés depuis le bytecode des DoAction (le
 * désassembleur du dépôt) — pas depuis les code.as des dossiers, qui ne
 * sont pas tout à fait ceux qui ont été compilés (l'intro du FLA n'attache
 * plus « che », fond ses décors en deux exemplaires, etc.).
 *
 * Les deux films sont bâtis pareil : un clip de quatre images — l'image 1
 * définit les fonctions sur le clip (init, main…), la 2 appelle init(), la 3
 * main(), la 4 revient à la 3 : main() tourne à chaque image. Les variables
 * de scénario (scene, vitFor, mainCompt…) sont des propriétés du clip.
 *
 * Ce que l'AVM1 fait en silence, on le garde : une lecture sur un enfant
 * absent (all.sub.che quand `sub` est un autre décor) ne fait rien, un
 * removeMovieClip sur une instance du scénario ne la retire pas, l'appel de
 * `_currentframe()` comme méthode vaut undefined, et « appleEnd() » trouve
 * AppleEnd (le SWF des crédits est en version 6, insensible à la casse).
 *
 * Std est CELUI DU JEU : chargé dans le jeu, le film voit la classe déjà
 * définie par kaluga.swf (une seule par lecteur), donc le même tmod, mis à
 * jour deux fois par image (Manager.update, puis main() du film) — c'est ce
 * que faisait le disque. Le `Std.cast(Std).wantedFPS = 40` des crédits
 * touche donc aussi le jeu ; l'AnimLoader rétablit 32 en partant (voir
 * menu.js) : on ne reproduit pas l'accélération du jeu après le générique.
 */
'use strict';

(function (racine) {

const K = racine.KalugaMoteur = racine.KalugaMoteur || {};
const random = (n) => Math.floor(Math.random() * n);
const stop = function () { this.stop(); };
// Les trois et deux parents : depuis « che », _parent._parent._parent est le
// clip du film (vitFor), _parent._parent le clip « all » (fact).
const p2 = (c) => c._parent && c._parent._parent;
const p3 = (c) => { const p = p2(c); return p && p._parent; };
const vif = (c) => !!(c && c._parent);
const poserVitFor = function (v) { const f = p3(this); if (f) f.vitFor = v; };
const vitForFact = function (k) { const f = p3(this), a = p2(this); if (f) f.vitFor = k * (a ? a.fact : undefined); };
const allVers = function (n) { const a = p2(this); if (a) a.gotoAndStop(n); };

// ── L'INTRODUCTION (intro.swf, 350×240, scène de #468) ────────────────────
function introInit() {
  this.scene = 1;
  this.interval = 2;
  this.vit = this.interval;
  this.compt = 0;
  this.stand = true;
  this.vit2 = 5;
  this.change = true;
}
function introMain() {
  // Le voile blanc s'efface (le removeMovieClip qui suit vise une instance du
  // scénario : sans effet, comme en Flash).
  if (this.mask) { this.mask._alpha -= 1.5; if (!(this.mask._alpha > 0)) this.mask.removeMovieClip(); }
  const all = this.all;
  const sub = all && all.sub;
  const che = sub && sub.che;
  const decor = (nom) => sub && sub[nom];
  const lancer = (etiquette) => { if (che) { che.gotoAndPlay(etiquette); if (che.o) che.o.gotoAndStop(2); } };
  const retirerMasque = () => { if (sub && sub.mask) sub.mask.removeMovieClip(); };
  if (this.scene == 3) { this.interval = 0; retirerMasque(); lancer('speed'); this.scene = 0; }
  if (this.scene == 6) { this.interval = 0; retirerMasque(); lancer('run'); this.scene = 0; }
  if (this.scene == 8) {
    this.interval = 0; this.vitFor = 0; retirerMasque();
    for (const n of ['grass1', 'grass2', 'forest1', 'forest2']) if (decor(n)) decor(n).gotoAndStop(2);
    lancer('fast'); this.scene = 0;
  }
  if (this.scene == 10) {
    this.interval = 0; this.vitFor = 0; retirerMasque();
    for (const n of ['grass1', 'grass2', 'forest1', 'forest2']) if (decor(n)) decor(n).gotoAndStop(2);
    lancer('faster'); this.scene = 0;
  }
  if (this.scene == 12) {
    this.interval = 0; this.vitFor = 1; retirerMasque();
    for (const n of ['grass1', 'grass2', 'forest1', 'forest2']) if (decor(n)) decor(n).gotoAndStop(1);
    lancer('fil'); this.scene = 0;
  }
  this.compt++;
  this.vit--;
  if (!(this.vit > 0)) { if (che) che.nextFrame(); this.vit = this.interval; }
  if (this.compt >= 200 && this.stand == true && che && che._currentframe == 1) {
    this.interval = 4;
    che.gotoAndPlay('stand');
    this.stand = false;
  }
  const f1 = decor('forest1'), f2 = decor('forest2'), g1 = decor('grass1'), g2 = decor('grass2');
  if (f1) f1._x -= this.vitFor;
  if (f2) f2._x -= this.vitFor;
  if (g1) g1._x -= this.vitFor * 1.5;
  if (g2) g2._x -= this.vitFor * 1.5;
  if (f1 && f2) {
    if (f1._x <= 0 && f1._x > f2._x) f2._x = f1._x + 1535;
    if (f2._x <= 0 && f1._x < f2._x) f1._x = f2._x + 1535;
  }
  if (g1 && g2) {
    if (g1._x <= 0 && g1._x > g2._x) g2._x = g1._x + 1535;
    if (g2._x <= 0 && g1._x < g2._x) g1._x = g2._x + 1535;
  }
}

const INTRO = {
  'intro:3:1': stop,
  'intro:18:1': stop,
  'intro:156:88': stop,
  'intro:185:1': stop,
  'intro:394:1': stop,
  // le titre : stop ; à la scène 3 (vue de quatre parents), il saute à l'image 2
  'intro:35:1': function () { this.stop(); const p = p2(this); const q = p && p2(p); if (q && q.scene == 3) this.gotoAndStop(2); },
  'intro:35:24': stop,
  'intro:125:18': function () { this.stop(); this.removeMovieClip(); },
  // « che », la tzongre qui court : elle règle le défilement des décors
  'intro:175:1': function () { this.stop(); poserVitFor.call(this, 1); },
  'intro:175:11': function () { vitForFact.call(this, 2); },
  'intro:175:12': function () { vitForFact.call(this, 3); },
  'intro:175:13': function () { vitForFact.call(this, 5); },
  'intro:175:14': function () { vitForFact.call(this, 6); },
  'intro:175:15': function () { vitForFact.call(this, 3); },
  'intro:175:16': function () { this.gotoAndStop(1); },
  'intro:175:20': function () { poserVitFor.call(this, 13); this.compt = 5; },
  'intro:175:22': function () { poserVitFor.call(this, 10); },
  'intro:175:29': function () { poserVitFor.call(this, 13); },
  'intro:175:30': function () { poserVitFor.call(this, 17); },
  'intro:175:39': function () { this.compt--; this.gotoAndStop('runLoop'); if (!(this.compt > 0)) allVers.call(this, 7); },
  'intro:175:44': function () { if (this.o) this.o.gotoAndStop(2); poserVitFor.call(this, 0); },
  'intro:175:49': function () { this.compt = 35; },
  'intro:175:50': function () { this.compt--; },
  'intro:175:51': function () { this.gotoAndPlay(this._currentframe - 1); if (!(this.compt > 0)) allVers.call(this, 2); },
  'intro:175:52': function () { poserVitFor.call(this, 0); this.compt = 6; },
  'intro:175:87': function () { poserVitFor.call(this, 4); },
  'intro:175:97': function () { vitForFact.call(this, 2); },
  'intro:175:98': function () { vitForFact.call(this, 3); },
  'intro:175:99': function () { vitForFact.call(this, 5); },
  'intro:175:100': function () { vitForFact.call(this, 6); },
  'intro:175:101': function () { vitForFact.call(this, 3); },
  'intro:175:102': function () { this.compt--; if (!(this.compt > 0)) allVers.call(this, 5); this.gotoAndPlay('loop'); },
  'intro:175:107': function () { vitForFact.call(this, 6); this.compt = 17; },
  'intro:175:114': function () { this.gotoAndPlay('fastLoop'); this.compt--; if (!(this.compt > 0)) allVers.call(this, 9); },
  'intro:175:116': function () { vitForFact.call(this, 6); this.compt = 25; },
  'intro:175:123': function () {
    this.gotoAndPlay('fasterLoop');
    this.compt--;
    if (!(this.compt > 8)) allVers.call(this, 11);
    if (this.compt == 18 && this.o && this.o.clin) this.o.clin.gotoAndPlay(1);
  },
  'intro:175:295': function () { poserVitFor.call(this, 0); },
  'intro:175:448': function () { const a = p2(this); if (a) a.gotoAndPlay(13); },
  // les décors d'une scène : à leur dernière image, « all » passe à la suivante
  'intro:244:219': function () { if (this._parent) this._parent.gotoAndStop(3); },
  'intro:266:96': function () { if (this._parent) this._parent.gotoAndStop(4); },
  'intro:329:214': function () { if (this._parent) this._parent.gotoAndStop(6); },
  'intro:375:70': function () { if (this._parent) this._parent.gotoAndStop(12); },
  'intro:350:1': function () { if (this.ver) this.ver._y = this.ver._y - 1; },
  'intro:350:2': function () { this.gotoAndPlay(1); },
  'intro:356:1': function () { this.compt = 3; },
  'intro:356:39': function () { this.compt--; if (!(this.compt > 0) && this._parent) this._parent.gotoAndStop(8); this.gotoAndPlay(2); },
  'intro:357:1': function () { this.compt = 4; },
  'intro:357:23': function () { this.compt--; if (!(this.compt > 0) && this._parent) this._parent.gotoAndStop(10); this.gotoAndPlay(2); },
  'intro:466:244': function () { if (this.sub && this.sub.kal) this.sub.kal.gotoAndPlay(2); },
  'intro:466:658': stop,
  // « all » : ses images posent la scène et le facteur de vitesse
  'intro:467:1': function () { this.stop(); this.fact = 1; },
  'intro:467:4': function () { if (this._parent) this._parent.scene = 3; this.fact = 2; },
  'intro:467:6': function () { if (this._parent) this._parent.scene = 6; this.fact = 1; },
  'intro:467:8': function () { if (this._parent) this._parent.scene = 8; this.fact = 0; },
  'intro:467:10': function () { if (this._parent) this._parent.scene = 10; this.fact = 0; },
  'intro:467:12': function () { if (this._parent) this._parent.scene = 12; this.fact = 1; },
  'intro:467:36': stop,
  // le film
  'intro:468:1': function () { this.init = introInit; this.main = introMain; },
  'intro:468:2': function () { this.init(); },
  'intro:468:3': function () { this.main(); },
  'intro:468:4': function () { this.gotoAndPlay(this._currentframe - 1); },
};

// ── LES CRÉDITS (credits.swf, 350×135, scène de #124 posée à l'échelle ½) ──
function creditsInit() {
  this.apple = true; this.kaluga = false; this.piwali = false; this.nalika = false; this.gomola = false; this.makulo = false;
  this.rand1 = false;
  this.portrait = true; this.portrait2 = true; this.portrait3 = true; this.portrait4 = true;
  this.last2 = false;
  this.changeBg = true; this.changeBg2 = true;
  this.kalugaAt = false;
  this.all = false;
  this.tzScale = 20; this.mainCompt = 0; this.comptNum = 0; this.d = 50;
  this.comptS = random(3) + 1; this.comptS2 = random(3) + 1;
  this.vitx = 1; this.vity = 1;
  this.enableTz = true;
  this.appleEndFlag = false;
  this.amort = 0.8; this.ressort = 1.8;
  K.Std.cast(K.Std).wantedFPS = 40;
  this.compt = 0;
  this.vitBg = 0.5;
  this.vitTz = 4.8;
  this.music = new K.Sound(this);
  this.music.attachSound('music');
  this.tzList = []; this.speedList = []; this.scaleList = [];
  this.depthList = [];
  for (let i = 0; i < 100; i++) this.depthList[i] = i;
}
function creditsMain() {
  const sub = this.sub;
  if (this.mainCompt == 0) this.music.start();
  this.shake();
  this.vit = this.vitTz * this.tmod;
  K.Std.update();
  this.tmod = K.Std.tmod;
  this.mainCompt += this.tmod;
  if (this.mainCompt >= 1650) this.last2 = true;
  if (this.mainCompt >= 2340) {
    if (sub) { sub.gotoAndStop(3); if (sub.bg1) sub.bg1.gotoAndStop(43); if (sub.bg2) sub.bg2.gotoAndStop(43); }
    this.last2 = false;
  }
  if (this.mainCompt >= 2740) this.all = true;
  if (this.mainCompt >= 1790 && this.portrait == true) { this.portrait = false; this.killTz(); if (sub) sub.gotoAndStop(2); }
  if (this.mainCompt >= 1926 && this.portrait2 == true) { if (sub && sub.pic) { sub.pic.gotoAndStop(2); sub.pic._x = 0; } this.portrait2 = false; }
  if (this.mainCompt >= 2070 && this.portrait3 == true) { if (sub && sub.pic) { sub.pic.gotoAndStop(3); sub.pic._x = 0; } this.portrait3 = false; }
  if (this.mainCompt >= 2205 && this.portrait4 == true) { if (sub && sub.pic) { sub.pic.gotoAndStop(4); sub.pic._x = 0; } this.portrait4 = false; }
  if (this.mainCompt >= 3390) {
    if (this.kalugaAt == false) { this.kalugaAttach(); this.kalugaAt = true; }
    this.kalugaFinal();
  }
  if (sub && vif(sub.kaluga2) && sub.kaluga2._x >= 1983) { sub.gotoAndStop(4); this.killTz(); this.enableTz = false; }
  this.appleEnd();
  if (sub && sub.bg1) {
    sub.bg1._x -= this.vitBg * this.tmod;
    if (sub.bg1._x <= -132) sub.bg1._x = 0;
  }
  const a = sub && sub.appleAnim;
  if (a && a._x >= 600) {
    if (this.changeBg == true) { if (sub.bg1) sub.bg1.gotoAndPlay(2); this.changeBg = false; }
    this.kaluga = true;
  }
  if (sub && sub.kaluga && sub.kaluga._x >= 600) this.piwali = true;
  if (sub && sub.piwali && sub.piwali._x >= 600) this.nalika = true;
  if (sub && sub.nalika && sub.nalika._x >= 600) this.gomola = true;
  if (sub && sub.gomola && sub.gomola._x >= 600) this.rand1 = true;
  if (this.apple == true && a) {
    a._x += this.vitTz / 1.9 * this.tmod;
    a._y = 160;
    if (a.apple2 && a.apple2.apple) a.apple2.apple._rotation += this.vitTz * this.tmod;
    if (a._x >= 800) a._x = 800;
  }
  for (const nom of ['kaluga', 'piwali', 'nalika', 'gomola']) {
    if (this[nom] != true) continue;
    const tz = sub && sub[nom];
    if (!tz) continue;
    tz._x += this.vit;
    tz._y = 135;
    if (tz._x >= 800) tz._x = 800;
  }
  if (this.rand1 == true) {
    if (this.last2 == false) { if (this.enableTz) this.genTz(); }
    if (this.changeBg2 == true) { if (sub && sub.bg1) sub.bg1.gotoAndPlay(16); this.changeBg2 = false; }
  }
  if (this.enableTz) this.moveTz();
}
function creditsGenTz() {
  this.comptNum--;
  if (!this.all) this.ecart = 15;
  if (this.all) this.ecart = 1;
  if (!(this.comptNum > 0)) { this.createTz(); this.comptNum = random(30) + this.ecart; }
}
function creditsCreateTz() {
  this.d = (this.d + 1) % 100;
  if (!this.all) this.scale = 100;
  if (this.all) {
    const index = random(this.depthList.length);
    this.d = this.depthList[index];
    this.depthList.splice(index, 1);
    this.scale = this.d * 2;
  }
  if (!this.sub) return undefined;
  this.sub.attachMovie('tz', 'tz' + this.d, this.d);
  const mc = this.sub['tz' + this.d];
  if (!mc) return undefined;
  mc._xscale = this.scale;
  mc._yscale = this.scale;
  mc._x = 0 - mc._width / 2;
  if (this.all) { mc._y = 135 + this.scale / 3; mc.d = this.d; } else { mc._y = 135; }
  mc.gotoAndStop(random(13) + 1);
  if (mc.sub && mc.sub.tz) mc.sub.tz.gotoAndStop(random(6) + 1);
  this.last = undefined;                       // « mc._currentframe() » : un nombre appelé, undefined en AVM1
  mc.vity = 0 - (this.scale * 0.05 + random(10) / 10);
  this.tzList.push(mc);
  return mc;
}
function creditsMoveTz() {
  for (let i = 0; i < this.tzList.length; i++) {
    const mc = this.tzList[i];
    let speed = 5;
    if (mc.d != undefined) speed = mc.d * 0.1;
    mc._x += speed * this.tmod;
    if (mc._x >= 700 + mc._width / 2) {
      if (mc.d != undefined) this.depthList.push(mc.d);
      mc.removeMovieClip();
      this.tzList.splice(i, 1);
      i--;
    }
  }
}
function creditsKillTz() {
  for (let i = 0; i < this.tzList.length; i++) this.tzList[i].removeMovieClip();
  this.tzList = [];
}
function creditsShake() {
  this.comptS--;
  if (!(this.comptS > 0)) { this.coordY = random(10) * (random(2) * 2 - 1); this.comptS = random(5) + 3; }
  this.comptS2--;
  if (!(this.comptS2 > 0)) { this.coordX = random(20) * (random(2) * 2 - 1); this.comptS2 = random(3) + 2; }
  const sub = this.sub;
  const pic = sub && sub.pic, lens = sub && sub.lens;
  // Sans portrait (images 1, 3, 4 de « sub »), tout ceci tombe dans le vide.
  this.elastiky = (this.coordY - (pic ? pic._y : undefined)) * 0.06 + 0 * this.elastiky;
  this.fact = random(100) / 100;
  if (pic) { pic._x += this.fact; pic._y += this.elastiky; }
  this.elastikx = (this.coordX - (lens ? lens._xscale : undefined) + 100) * 0.06 + 0 * this.elastikx;
  if (lens) { lens._xscale += this.elastikx; lens._yscale = lens._xscale; }
}
function creditsKalugaAttach() {
  if (!this.sub) return;
  this.sub.attachMovie('kaluga2', 'kaluga2', 5000000);
  const k = this.sub.kaluga2;
  if (!k) return;
  k._x = -500;
  k._xscale = -1321;
  k._yscale = 1321;
  k._y = 173;
}
function creditsKalugaFinal() {
  const k = this.sub && this.sub.kaluga2;
  if (k) k._x += 30 * this.tmod;
}
function creditsAppleEnd() {
  if (this.mainCompt >= 3425) {
    if (!this.appleEndFlag) { this.attachMovie('appleClip', 'appleClip', 100); this.appleEndFlag = true; }
    const ac = this.appleClip;
    if (ac) {
      ac._x += this.vitTz / 1.5 * this.tmod;
      ac._y = 360;
      if (ac.apple2 && ac.apple2.apple) ac.apple2.apple._rotation += this.vitTz / 1.5 * this.tmod;
    }
  }
  const ac = this.appleClip;
  if (vif(ac) && ac._x >= 350) {
    this.attachMovie('happyEndo', 'happyEndo', 150);
    if (this.happyEndo) { this.happyEndo._x = ac._x; this.happyEndo._y = ac._y; }
    ac.removeMovieClip();
  }
}

const CREDITS = {
  'credits:72:1': stop,
  'credits:74:1': stop,
  'credits:96:38': stop,
  'credits:107:1': stop,
  'credits:107:15': stop,
  'credits:107:29': stop,
  'credits:107:43': stop,
  'credits:115:1': stop,
  'credits:119:1': stop,
  'credits:124:1': function () {
    this.init = creditsInit; this.main = creditsMain;
    this.genTz = creditsGenTz; this.createTz = creditsCreateTz; this.moveTz = creditsMoveTz; this.killTz = creditsKillTz;
    this.shake = creditsShake; this.kalugaAttach = creditsKalugaAttach; this.kalugaFinal = creditsKalugaFinal;
    this.AppleEnd = creditsAppleEnd; this.appleEnd = creditsAppleEnd;
  },
  'credits:124:2': function () { this.init(); },
  'credits:124:3': function () { this.main(); },
  'credits:124:4': function () { this.gotoAndPlay(this._currentframe - 1); },
};

K.scriptsImages = Object.assign(K.scriptsImages || {}, INTRO, CREDITS);

})(typeof window !== 'undefined' ? window : globalThis);
