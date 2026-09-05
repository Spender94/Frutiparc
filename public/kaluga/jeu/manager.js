/*
 * Kaluga — le MANAGER (Manager.as) : l'horloge du jeu (Std.update puis
 * Cs.tmod = min(Std.tmod × 1,2 ; 3)), la pause (ESC ou P), les « slots »
 * (menu, parties, séquences) empilés sur la racine, la fruticard et les
 * préférences, les deux gestionnaires de sons (musique, effets).
 *
 * Et l'amorçage de la page : demarrerKaluga() charge la bibliothèque et les
 * sons, pose la scène à 40 images par seconde et crée le manager — ce que
 * faisait l'image « start » du FLA.
 */
'use strict';

(function (racine) {

const K = racine.KalugaMoteur;
const J = racine.KalugaJeu;
const Cs = J.Cs;
const Key = K.Key;

const TZ_INFO = [
  { id: 0, name: 'Kaluga', weight: 0.3, nbPower: 1, nbBoost: 1.5, nbBoostFrict: 0.98, nbFrict: 0.96, nbResist: 0.90, nbThrust: 0.9, nbTurn: 2.4, nbTurnMalus: 0.8, nbDodge: 1.0, nbMulti: 0, nbCombo: 0, nbFilMax: 200, cligneRand: 200, stats: [3, 4, 4, 3, 3] },
  { id: 1, name: 'Piwali', weight: 0.4, nbPower: 2.5, nbBoost: 3, nbBoostFrict: 0.99, nbFrict: 0.98, nbResist: 0.99, nbThrust: 0.9, nbTurn: 1.8, nbTurnMalus: 0.8, nbDodge: 1.2, nbMulti: 0, nbCombo: 1, nbFilMax: 110, cligneRand: 40, stats: [1, 2, 3, 4, 1] },
  { id: 2, name: 'Nalika', weight: 0.2, nbPower: 0.5, nbBoost: 1.5, nbBoostFrict: 0.96, nbFrict: 0.93, nbResist: 0.75, nbThrust: 0.9, nbTurn: 3.2, nbTurnMalus: 0.2, nbDodge: 0.7, nbMulti: 1, nbCombo: 0, nbFilMax: 300, cligneRand: 200, stats: [6, 5, 1, 1, 6] },
  { id: 3, name: 'Gomola', weight: 0.6, nbPower: 5, nbBoost: 4, nbBoostFrict: 0.75, nbFrict: 0.98, nbResist: 0.90, nbThrust: 0.9, nbTurn: 1.4, nbTurnMalus: 0.4, nbDodge: 2.8, nbMulti: 0, nbCombo: 0, nbFilMax: 150, cligneRand: 200, stats: [3, 1, 5, 6, 2] },
  { id: 4, name: 'Makulo', weight: 0.25, nbPower: 1.5, nbBoost: 7, nbBoostFrict: 0.985, nbFrict: 1, nbResist: 0.95, nbThrust: 0.9, nbTurn: 3.8, nbTurnMalus: 0.4, nbDodge: 3.2, nbMulti: 0, nbCombo: 0, nbFilMax: 220, cligneRand: 100, stats: [2, 6, 6, 2, 4] },
];

class Manager {
  constructor(root, client) {
    this.depthStart = 40; this.depthMax = 10; this.fadeColor = 0xADE76B; this.vers = 1.9;
    this.flTestBig = false;
    this.root = root;
    this.client = client;
    this.init();
  }
  init() {
    this.flPause = false;
    this.initConstant();
    this.depth = 0;
    this.waitList = [];
    this.slotList = [];
    this.client.mng = this;
    this.attachLoading();
    this.initSoundManager();
    this.client.serviceConnect();
  }
  update() {
    K.Std.update();
    Cs.tmod = Math.min(K.Std.tmod * 1.2, 3);
    if (Key.isDown(27) || Key.isDown(80)) {
      if (this.flReleasePause && !this.client.forcePause && this.current) {
        this.setPause();
        this.flReleasePause = false;
      }
    } else {
      this.flReleasePause = true;
    }
    if (!this.flPause) {
      for (let i = 0; i < this.slotList.length; i++) {
        const s = this.slotList[i];
        if (s.path && s.path._parent) s.path.update();
      }
    } else {
      this.pauseAlpha *= 0.5;
      J.MC.setPColor(this.current, this.fadeColor, 30 + this.pauseAlpha);
    }
  }
  addSlot(link, initObj, flNoMain) {
    if (initObj == null) initObj = {};
    initObj.mng = this;
    this.depth = (this.depth + 1) % this.depthMax;
    const d = this.depth;
    this.root.attachMovie(link, 'slot' + d, d + this.depthStart, initObj);
    const slot = this.root['slot' + d];
    this.slotList.push({ path: slot, link });
    if (flNoMain == null) this.current = slot;
  }
  removeSlot(rmSlot) {
    for (let i = 0; i < this.slotList.length; i++) {
      const slot = this.slotList[i].path;
      if (slot === rmSlot) {
        if (this.waitList.length > 0 && slot === this.current) {
          const info = this.waitList.shift();
          const link = info.link === 'same' ? this.slotList[i].link : info.link;
          this.slotList.splice(i, 1);
          this.addSlot(link, info.initObj);
          return true;
        }
        this.slotList.splice(i, 1);
        return true;
      }
    }
    return false;
  }
  loadCard() {
    this.card = this.client.slots[0];
    this.pref = this.client.slots[1];
    if (!this.client.isWhite()) this.client.lockList[0] = true;
    if (this.card == null) this.formatCard();
    if (this.pref == null) this.formatPref();
    if (this.client.isBlack() || this.client.isGrey()) {
      this.card.$mode = [1, [0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
    }
    this.reparerCard();
    if (this.card.$vs < this.vers) this.patchFruticard();
    this.updateParams();
  }
  // Une fiche d'époque peut manquer un champ (ancienne version, sauvegarde
  // tronquée) : on complète sans rien écraser, pour que le jeu ne plante pas.
  reparerCard() {
    const c = this.card;
    if (!Array.isArray(c.$tz)) c.$tz = [1, 0, 0, 0, 0];
    if (!Array.isArray(c.$seq)) c.$seq = [1, 0];
    if (!Array.isArray(c.$bonus)) c.$bonus = [0, 0];
    if (!Array.isArray(c.$mode)) c.$mode = [1, [1, 1, 1, 0, 0, 0, 0, 1, 0], [1, 0, 0, 0], [1, 0, 0, 0], [1, 0, 0, 0], [1, 0, 0, 0]];
    if (!c.$stat) c.$stat = { $fruit: 0 };
    if (!c.$classic) c.$classic = { $s: 0 };
    if (!c.$trial) c.$trial = { $st: 1, $tria: { $s: 0 }, $hept: { $s: 0 }, $list: [] };
    for (let i = 0; i < 7; i++) {
      if (!c.$trial.$list[i]) c.$trial.$list[i] = { $list: [], $tz: [], $max: 0 };
      const t = c.$trial.$list[i];
      if (!Array.isArray(t.$list)) t.$list = [];
      if (!Array.isArray(t.$tz)) t.$tz = [];
      for (let ii = 0; ii < 5; ii++) if (!t.$tz[ii]) t.$tz[ii] = { $s: 0 };
      if (t.$max == null) t.$max = 0;
    }
    if (!c.$chrono || !Array.isArray(c.$chrono.$level)) c.$chrono = { $st: 2, $level: this.chronoParDefaut() };
    for (const nom of ['$survival', '$invasion', '$ring']) {
      if (!c[nom] || !Array.isArray(c[nom].$level)) c[nom] = { $st: 2, $level: [] };
      for (let i = 0; i < 4; i++) if (!c[nom].$level[i]) c[nom].$level[i] = { $s: nom === '$ring' ? 600000 : 0, $t: 0 };
    }
    if (!this.pref.$key || this.pref.$key.length < 5) this.pref.$key = [Key.UP, Key.LEFT, Key.RIGHT, Key.DOWN, Key.SPACE];
    if (!this.pref.$param || this.pref.$param.length < 3) this.pref.$param = [1, 1, 1];
  }
  chronoParDefaut() {
    const a = [];
    for (let i = 0; i < 4; i++) {
      const a2 = [];
      const limit = 36000 + i * 6000;
      const max = 6 + i * 2;
      for (let ii = 0; ii < max; ii++) a2[ii] = (ii + 1) * limit / max;
      a[i] = a2;
    }
    return a;
  }
  formatCard() {
    this.card = {};
    this.card.$vs = this.vers;
    this.card.$tz = [1, 0, 0, 0, 0];
    this.card.$seq = [1, 0];
    this.card.$bonus = [0, 0];
    this.card.$mode = [1, [1, 1, 1, 0, 0, 0, 0, 1, 0], [1, 0, 0, 0], [1, 0, 0, 0], [1, 0, 0, 0], [1, 0, 0, 0]];
    this.card.$stat = { $fruit: 0 };
    this.card.$classic = { $s: 0 };
    this.card.$trial = { $st: 1, $tria: { $s: 0 }, $hept: { $s: 0 }, $list: [] };
    for (let i = 0; i < 7; i++) {
      const card = { $list: [], $tz: [], $max: 0 };
      for (let ii = 0; ii < 5; ii++) card.$tz[ii] = { $s: 0 };
      this.card.$trial.$list[i] = card;
    }
    this.card.$chrono = { $st: 2, $level: this.chronoParDefaut() };
    this.card.$survival = { $st: 2, $level: [] };
    this.card.$invasion = { $st: 2, $level: [] };
    this.card.$ring = { $st: 2, $level: [] };
    for (let i = 0; i < 4; i++) {
      this.card.$survival.$level[i] = { $s: 0, $t: 0 };
      this.card.$invasion.$level[i] = { $s: 0, $t: 0 };
      this.card.$ring.$level[i] = { $s: 600000, $t: 0 };
    }
    this.client.slots[0] = this.card;
    if (this.client.isWhite()) this.client.giveItem('$tz0');
    this.client.saveSlot(0);
  }
  formatPref() {
    this.pref = { $key: [Key.UP, Key.LEFT, Key.RIGHT, Key.DOWN, Key.SPACE], $param: [1, 1, 1] };
    this.client.slots[1] = this.pref;
    this.client.saveSlot(1);
  }
  patchFruticard() {
    if (this.card.$vs < 1.9) {
      if (this.card.$mode[1][8]) this.client.giveAccessory('$kagulga');
    }
    this.card.$vs = this.vers;
    this.client.saveSlot(0);
  }
  backToMenu() {
    this.waitList = [];
    this.waitList.push({ link: 'menu' });
    if (this.current) this.current.kill();
  }
  initConstant() {
    this.color = { tzPastel: [0xB8ECB7, 0xFFE0BB, 0xFECFCF, 0xCCCDEE, 0xB8C7B8] };
    this.tzInfo = TZ_INFO.map((t) => Object.assign({}, t, { stats: t.stats.slice() }));
    this.difNameList = ['facile', 'standard', 'difficile', 'infernal'];
  }
  initSoundManager() {
    this.root.attachMovie('mcSoundManager', 'music', 8);
    this.root.attachMovie('mcSoundManager', 'sfx', 9);
    this.music = this.root.music;
    this.sfx = this.root.sfx;
  }
  updateParams() {
    this.music.setActive(!!this.pref.$param[0]);
    this.sfx.setActive(!!this.pref.$param[1]);
  }
  attachLoading() { this.root.attachMovie('mcLoading', 'mcLoading', 20); }
  removeLoading() { if (this.root.mcLoading) this.root.mcLoading.removeMovieClip(); }
  connected() {
    this.loadCard();
    this.addSlot('menu');
    this.removeLoading();
  }
  started() { this.addSlot(this.startGameInfo.link, this.startGameInfo.initObj); }
  scoreSaved() {
    if (!this.current) return;
    this.current.flSavingScore = false;
    if (typeof this.current.scoreSaved === 'function') this.current.scoreSaved();
  }
  setPause(flag) {
    if (flag == null) flag = !this.flPause;
    this.flPause = flag;
    if (this.flPause) {
      this.root.attachMovie('mcPause', 'mcPause', 1080);
      this.root.mcPause.field._visible = Key.isDown(Key.ENTER);
      this.pauseStart = K.getTimer();
      this.pauseAlpha = 70;
    } else {
      if (this.root.mcPause) this.root.mcPause.removeMovieClip();
      J.MC.setPColor(this.current, this.fadeColor, 100);
      if (this.current && this.current.barTimer) this.current.barTimer.decal(K.getTimer() - this.pauseStart);
    }
  }
}
J.Manager = Manager;

// La touche du pavé tactile → le code clavier configuré dans les préférences.
J.codeTouche = function (touche) {
  const mng = J.manager;
  const k = mng && mng.pref && mng.pref.$key;
  switch (touche) {
    case 'haut': return k ? k[0] : 38;
    case 'gauche': return k ? k[1] : 37;
    case 'droite': return k ? k[2] : 39;
    case 'bas': return k ? k[3] : 40;
    case 'fil': return k ? k[4] : 32;
    case 'echap': return 27;
    default: return 0;
  }
};

const SONS = ['sWind', 'sRing', 'sRadian', 'sMenuLoop', 'sClic', 'sLink', 'sJeuLoop0', 'sHit', 'sGroundHit2', 'sGroundHit1', 'sGroundHit0',
  'sGong', 'sFrog', 'sFly', 'sCrunch', 'sCrow1', 'sCrow0', 'sBush', 'sBonus'];

/**
 * Démarre Kaluga dans un canvas. Résout avec { scene, manager } une fois le
 * menu affiché.
 */
racine.demarrerKaluga = function (options) {
  const canvas = typeof options.canvas === 'string' ? document.getElementById(options.canvas) : options.canvas;
  return K.chargerBiblio('kaluga').then((biblio) => {
    K.prechargerSons(SONS).catch(() => {});
    const scene = new K.Scene(canvas, biblio, { cadence: 40 });
    const client = new J.Client(options.sid || '');
    const manager = new Manager(scene.racine, client);
    J.manager = manager;
    scene.surTick = () => manager.update();
    scene.demarrer();
    return { scene, manager, client };
  });
};

})(typeof window !== 'undefined' ? window : globalThis);
