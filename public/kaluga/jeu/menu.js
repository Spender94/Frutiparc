/*
 * Kaluga — le MENU (Menu.as) et sa CONSOLE (Console.as) : la barre des
 * modes à gauche, le portrait de la tzongre à droite avec sa courbe de
 * puissance et ses cinq barres de caractéristiques, le tableau des options
 * (musique, sons, particules, et les cinq touches).
 *
 * Et l'AnimLoader, le « slot » qui joue les séquences (intro, crédits) —
 * chargées d'époque par loadClip depuis anim/intro.swf et anim/credits.swf ;
 * ici, la bibliothèque extraite du même nom (data/intro.json,
 * data/credits.json) dont la racine remplace `anim.mc.mc`, et les scripts
 * d'image des films dans moteur/scripts-sequences.js. Un clic rend la main
 * au menu, comme le onPress d'origine.
 */
'use strict';

(function (racine) {

const K = racine.KalugaMoteur;
const J = racine.KalugaJeu;
const Cs = J.Cs;
const random = J.random;
const Key = K.Key;

// ── Menu ──────────────────────────────────────────────────────────────────
class Menu extends J.Slot {
  constructeur() { this.init(); }
  init() {
    super.init();
    this.animList = new J.AnimList();
    this.slotNum = 0;
    this.ombreList = [];
    this.genMenuList();
    this.attachBar();
    this.attachConsole();
    this.mng.music.loop('sMenuLoop', 40);
  }
  genMenuList() {
    this.menuList = [
      { id: 0, name: 'CHALLENGE' },
      { id: 1, name: 'OLYMPIQUE', list: [
        { id: 10, name: 'LANCER DE VERS' }, { id: 11, name: "LANCER D'ECUREUIL" }, { id: 12, name: 'PLANTAPOMME' },
        { id: 13, name: 'LANCER DE FOURMIS' }, { id: 14, name: 'PLANTER DE VERS' }, { id: 15, name: 'DEXTERIPOMME' },
        { id: 16, name: 'COURSE GRENOUILLES' }, { id: 17, name: 'TRIATHLON' }, { id: 18, name: 'HEPTATHLON' }] },
      { id: 2, name: 'CHRONO', list: [{ id: 20, name: 'FACILE' }, { id: 21, name: 'STANDARD' }, { id: 22, name: 'DIFFICILE' }, { id: 23, name: 'INFERNAL' }] },
      { id: 3, name: 'SURVIE', list: [{ id: 30, name: 'FACILE' }, { id: 31, name: 'STANDARD' }, { id: 32, name: 'DIFFICILE' }, { id: 33, name: 'INFERNAL' }] },
      { id: 4, name: 'INVASION', list: [{ id: 40, name: 'FACILE' }, { id: 41, name: 'STANDARD' }, { id: 42, name: 'DIFFICILE' }, { id: 43, name: 'INFERNAL' }] },
      { id: 5, name: 'PISTE', list: [{ id: 50, name: 'FACILE' }, { id: 51, name: 'STANDARD' }, { id: 52, name: 'DIFFICILE' }, { id: 53, name: 'INFERNAL' }] },
      { id: 6, name: 'SEQUENCE', list: [{ id: 60, name: 'INTRODUCTION' }, { id: 61, name: 'CREDITS' }] },
      { id: 9, name: 'PREPARATION' },
      { id: 7, name: 'OPTIONS' },
    ];
    // CHALLENGE quand la partie ira au classement, ESSAIS quand elle n'ira
    // pas — c'est le renommage d'époque (session blanche = disque de démo),
    // rendu au quota de Fruits Défendus que le serveur tient (Client.isRanked).
    if (!this.mng.client.isRanked()) this.menuList[0].name = 'ESSAIS';
    // CASSE MODES
    const modes = this.mng.card.$mode;
    for (let m = 0; m < modes.length; m++) {
      const a = modes[m];
      if (m === 0) {
        if (!a) this.menuList[0] = undefined;
      } else if (this.menuList[m]) {
        let visible = false;
        for (let i = 0; i < a.length; i++) {
          if (!a[i]) this.menuList[m].list[i] = undefined; else visible = true;
        }
        if (!visible) this.menuList[m] = undefined;
      }
    }
    // CASSE SEQ
    const seq = this.mng.card.$seq;
    for (let i = 0; i < seq.length; i++) if (!seq[i] && this.menuList[6]) this.menuList[6].list[i] = undefined;
    for (let m = 0; m < this.menuList.length; m++) {
      const a = this.menuList[m];
      if (a == null) { this.menuList.splice(m, 1); m--; continue; }
      if (a.list) for (let i = 0; i < a.list.length; i++) if (a.list[i] == null) { a.list.splice(i, 1); i--; }
    }
  }
  attachBar() {
    this.attachMovie('menuBar', 'menuBar', 10);
    this.menuBar.createEmptyMovieClip('menu', 10);
    this.menuBar.createEmptyMovieClip('shadow', 8);
    this.menuBar.shadow._x = 20;
    this.displayMenu();
  }
  addSlot(info) {
    const d = this.slotNum++;
    this.menuBar.menu.createEmptyMovieClip('slot' + d, 10 + d);
    const mc = this.menuBar.menu['slot' + d];
    mc._x = this.menuBar.shadow._x;
    mc.attachMovie('slotTitle', 'title', 100);
    mc.title.gotoAndStop(info.id + 1);
    mc.title.title.text = info.name;
    mc.attachMovie('transp', 'but', 110);
    mc.but._xscale = 232;
    mc.but._yscale = 32;
    const menu = this;
    mc.but.onPress = function () { menu.selectSlot(mc.info.id); };
    mc.but.onRollOver = function () { menu.rollOverSlot(mc.info.id, mc); };
    mc.but.onRollOut = function () { menu.rollOutSlot(mc.info.id, mc); };
    mc.but.onDragOut = mc.but.onRollOut;
    this.menuBar.shadow.attachMovie('slotShadow', 'shadow' + d, 10 + d);
    mc.shadow = this.menuBar.shadow['shadow' + d];
    mc.shadow.gotoAndStop(info.id + 1);
    mc.title.light.gotoAndStop(info.id + 1);
    mc.title.light.alpha = 0;
    mc.title.light._alpha = 0;
    mc.title.light._visible = false;
    mc.info = info;
    info.path = mc;
    info.flOpen = false;
    return mc;
  }
  removeSlot(info) {
    if (!info.path) return;
    info.path.shadow.removeMovieClip();
    info.path.removeMovieClip();
    info.path = undefined;
  }
  update() {
    this.console.update();
    for (const mc of this.ombreList) {
      mc.d = (mc.d + 10) % 628;
      const c = Math.cos(mc.d / 100);
      mc.base._xscale = 100 + c * 6;
      mc.base._y = mc.y + c * 2;
    }
  }
  selectSlot(id) {
    this.mng.sfx.play('sClic');
    switch (id) {
      case 1: case 2: case 3: case 4: case 5: case 6: this.toggle(id); break;
      case 9: this.launchGame('gameTrain'); break;
      case 7: this.displayOption(); break;
      case 8: this.displayMenu(); break;
      case 0: this.launchGame('gameClassic'); break;
      case 10: this.launchGame('gameCaterLaunch'); break;
      case 11: this.launchGame('gameSquirrelLaunch'); break;
      case 12: this.launchGame('gamePlant'); break;
      case 13: this.launchGame('gameAntLaunch'); break;
      case 14: this.launchGame('gameCaterPlant'); break;
      case 15: this.launchGame('gameDexFruit'); break;
      case 16: this.launchGame('gameFrogRun'); break;
      case 17: this.launchTournament('triathlon'); break;
      case 18: this.launchTournament('heptathlon'); break;
      case 20: case 21: case 22: case 23: this.launchGame('gameChrono', { level: id - 20 }); break;
      case 30: case 31: case 32: case 33: this.launchGame('gameSurvival', { level: id - 30 }); break;
      case 40: case 41: case 42: case 43: this.launchGame('gameInvasion', { level: id - 40 }); break;
      case 50: case 51: case 52: case 53: this.launchGame('gameRing', { level: id - 50 }); break;
      case 60: this.launchAnim('animLoader', { link: 'anim/intro.swf', width: 350, height: 240 }); break;
      case 61: this.launchAnim('animLoader', { link: 'anim/credits.swf', width: 350, height: 135 }); break;
      default: break;
    }
  }
  rollOverSlot(id, mc) {
    this.animList.addAnim('anim' + id, K.setInterval(this, 'animSlotLight', 25, mc.title.light, 1, id));
    this.animList.addPaint('paint' + id, mc.title.title, { r: 255, g: 255, b: 255 }, 0, undefined, 2);
    mc.title.light._visible = true;
  }
  rollOutSlot(id, mc) {
    this.animList.addPaint('paint' + id, mc.title.title, { r: 172, g: 70, b: 45 }, 100, undefined, 2);
    this.animList.addAnim('anim' + id, K.setInterval(this, 'animSlotLight', 25, mc.title.light, -1, id));
  }
  animSlotLight(mc, sens, id) {
    if (!mc._parent) { this.animList.remove('anim' + id); return; }
    mc.alpha = Math.max(0, Math.min(mc.alpha + (sens * Cs.tmod * 10), 100));
    mc._alpha = mc.alpha;
    if (sens === -1 && mc.alpha === 0) { this.animList.remove('anim' + id); mc._visible = false; }
    if (sens === 1 && mc.alpha === 100) this.animList.remove('anim' + id);
  }
  sortSlot() {
    let y = 100;
    for (const info of this.menuList) {
      if (!info.path) continue;
      info.path._y = y;
      info.path.shadow._y = y;
      y += 29;
      if (info.flOpen) {
        for (const sInfo of info.list) {
          if (!sInfo.path) continue;
          sInfo.path._y = y;
          sInfo.path.shadow._y = y;
          y += 21;
        }
      }
    }
  }
  toggle(id) {
    let info;
    for (const i of this.menuList) { info = i; if (info.id === id) break; }
    if (!info || !info.list) return;
    if (info.flOpen) {
      for (const s of info.list) this.removeSlot(s);
      info.flOpen = false;
    } else {
      for (const s of info.list) this.addSlot(s);
      info.flOpen = true;
    }
    this.sortSlot();
  }
  launchGame(link, initObj) {
    if (initObj == null) initObj = {};
    if (initObj.mode == null) initObj.mode = 'single';
    initObj.root = this.root;
    initObj.tzongreInfo = this.mng.tzInfo[this.console.tzList[this.console.index]];
    this.mng.startGameInfo = { link, initObj };
    this.mng.started();
    this.kill();
  }
  launchTournament(mode) {
    const ti = this.mng.tzInfo[this.console.tzList[this.console.index]];
    const playerList = [0, 1, 2, 3, 4];
    playerList.splice(ti.id, 1);
    playerList.push(ti.id);
    this.mng.tournament = { eventId: 0, stats: [] };
    const coefList = [1, 1, 50, 0.1, 10, 3, 0.4];
    let max, difCoef;
    if (mode === 'triathlon') { max = 3; difCoef = 0.8; } else { max = 7; difCoef = 1.2; }
    for (let i = 0; i < playerList.length; i++) {
      const player = { id: playerList[i], results: [] };
      for (let r = 0; r < max; r++) player.results[r] = { base: 0, coef: coefList[r], score: 0 };
      this.mng.tournament.stats[i] = player;
    }
    this.mng.tournament.difCoef = difCoef;
    const initObj = { mode, tournament: this.mng.tournament };
    this.mng.waitList.push({ link: 'gameSquirrelLaunch', initObj });
    this.mng.waitList.push({ link: 'gamePlant', initObj });
    if (mode === 'heptathlon') {
      this.mng.waitList.push({ link: 'gameAntLaunch', initObj });
      this.mng.waitList.push({ link: 'gameCaterPlant', initObj });
      this.mng.waitList.push({ link: 'gameDexFruit', initObj });
      this.mng.waitList.push({ link: 'gameFrogRun', initObj });
    }
    this.launchGame('gameCaterLaunch', initObj);
  }
  launchAnim(link, initObj) {
    if (initObj == null) initObj = {};
    initObj.root = this.root;
    this.mng.addSlot(link, initObj);
    this.kill();
  }
  attachConsole() {
    this.attachMovie('console', 'console', 4, { menu: this });
    this.console._x = 240;
    this.console.update();
  }
  displayOption() {
    for (const info of this.menuList) this.removeSlot(info);
    this.attachMovie('optionTable', 'optionTable', 32);
    this.optionTable._x = 138;
    this.optionTable._y = 330;
    for (let i = 0; i < 3; i++) {
      const mc = this.optionTable['b' + i];
      mc.id = i;
      mc.flag = this.mng.pref.$param[i];
      this.updateDisc(mc);
    }
    this.optionTable.tabCode = new J.KeyManager();
    for (let i = 0; i < 6; i++) {
      const mc = this.optionTable['k' + i];
      if (!mc) continue; // la table n'a que k0…k4 : en AS2 le sixième tour est un no-op silencieux
      mc.id = i;
      this.setKeyCode(mc, this.mng.pref.$key[i]);
    }
  }
  closeOption() {
    if (this.optionTable) this.optionTable.removeMovieClip();
    this.displayMenu();
  }
  initKey(mc) {
    if (this.optionTable.mck != null) {
      if (this.optionTable.mck === mc) return;
      this.pushKey(this.mng.pref.$key[this.optionTable.mck.id]);
    }
    this.optionTable.mck = mc;
    const listener = { root: this };
    listener.onKeyDown = function () { this.root.pushKey(Key.getCode()); Key.removeListener(this); };
    mc.gotoAndPlay(2);
    if (mc.field) mc.field.text = '---';
    Key.addListener(listener);
  }
  pushKey(n) {
    if (this.optionTable && this.optionTable.mck != null) {
      const id = this.optionTable.mck.id;
      this.setKeyCode(this.optionTable.mck, n);
      this.mng.pref.$key[id] = n;
      this.mng.client.saveSlot(1);
      this.optionTable.mck.gotoAndStop(1);
      this.optionTable.mck = undefined;
    }
  }
  setKeyCode(mc, n) { if (mc.field) mc.field.text = this.optionTable.tabCode.getKeyName(n); }
  rOver(mc) {
    let txt;
    switch (mc._name) {
      case 'k0': txt = "redéfinir la touche d'acceleration."; break;
      case 'k1': txt = 'redéfinir la touche pour tourner vers la gauche.'; break;
      case 'k2': txt = 'redéfinir la touche pour tourner vers la droite.'; break;
      case 'k3': txt = 'redéfinir la touche pour foncer vers le sol.'; break;
      case 'k4': txt = 'redéfinir la touche pour lancer le fil de la tzongre.'; break;
      case 'k5': txt = 'redefinir la touche qui ne sert a rien.'; break;
      case 'b0': case 'b1': case 'b2':
        if (mc._name === 'b0') txt = 'la musique du jeu.';
        else if (mc._name === 'b1') txt = 'les effets sonores du jeu.';
        else txt = 'les effets de particules.';
        txt = (mc.flag ? 'desactiver ' : 'activer ') + txt;
        break;
      default: break;
    }
    this.setDesc(txt);
  }
  rOut() { this.setDesc(''); }
  setDesc(str) {
    if (!this.optionTable) return;
    this.optionTable.field.text = str == null ? '' : str;
    this.optionTable.field._y = -232 - this.optionTable.field.textHeight / 2;
  }
  updateDisc(mc) { mc.gotoAndStop((10 * (mc.flag ? 1 : 0)) + mc.id + 1); }
  pushDisc(mc) {
    mc.flag = !mc.flag;
    this.mng.pref.$param[mc.id] = mc.flag ? 1 : 0;
    this.mng.client.saveSlot(1);
    this.mng.updateParams();
    this.updateDisc(mc);
    this.rOver(mc);
  }
  displayMenu() {
    for (const info of this.menuList) this.addSlot(info);
    this.sortSlot();
  }
  kill() {
    this.mng.music.stopSound('sMenuLoop', 40);
    this.animList.removeAll();
    super.kill();
  }
}
J.Menu = Menu;
K.registerClass('menu', Menu);

// ── Console ───────────────────────────────────────────────────────────────
class Console extends K.Clip {
  constructeur() { this.graphStep = 100; this.graphMax = 8; this.statMax = 5; this.init(); }
  init() {
    this.index = -1;
    this.pNum = 0;
    this.genTzList();
    this.initBut();
    this.initBar();
    this.nextTzongre();
  }
  update() { this.drawBar(); }
  genTzList() {
    this.tzList = [];
    const list = this.menu.mng.card.$tz;
    for (let i = 0; i < list.length; i++) if (list[i]) this.tzList.push(i);
  }
  initBut() {
    const d = 80;
    this.attachMovie('transp', 'but', 200);
    this.but.onPress = function () { if (this._parent.tzList.length > 0) this._parent.nextTzongre(); };
    this.but._x = d;
    this.but._xscale = Cs.mcw - (this._x + d);
    this.but._yscale = Cs.mch;
  }
  nextTzongre() {
    this.menu.mng.sfx.play('sWind');
    if (this.current) {
      this.current.flGoAway = true;
      if (this.current.shadow) this.current.shadow.flGoAway = true;
    }
    this.index = (this.index + 1) % this.tzList.length;
    const id = this.tzList[this.index];
    const info = this.menu.mng.tzInfo[id];
    this.attachTzongre(id);
    this.drawGraphic(info);
    const stats = info.stats;
    for (let i = 0; i < this.statMax; i++) {
      const bonus = 0.5;
      this['bar' + i].h = ((stats[i] + bonus) / (6 + bonus)) * 120;
    }
  }
  attachTzongre(index) {
    let d = this.pNum++;
    this.pic.attachMovie('portrait' + index, 'portrait' + d, 10000 - d);
    const mc = this.pic['portrait' + d];
    mc.flGoAway = false;
    mc.gotoAndPlay(2);
    this.current = mc;
    this.gotoAndStop(this.tzList[this.index] + 1);
    d = this.pNum++;
    this.pic.attachMovie('portrait' + index, 'portrait' + d, 10000 - d);
    mc.shadow = this.pic['portrait' + d];
    mc.shadow._alpha = 40;
  }
  drawGraphic(info) {
    const step = 160 / this.graphStep;
    const ratio = 120 / this.graphMax;
    const line = this.graphic.line || this.graphic.createEmptyMovieClip('line', 1);
    line.clear();
    line.lineStyle(1, 0xBAD595);
    for (let i = 0; i < Math.round(this.graphStep / 10); i++) {
      line.lineStyle(1, 0xBAD595, 0);
      line.lineTo(10 * step * i, -120);
      line.lineStyle(1, 0xBAD595, 100);
      line.lineTo(10 * step * i, 0);
    }
    line.lineStyle(1, 0xBAD595);
    line.beginFill(0xF5F8F0);
    line.moveTo(0, -info.nbPower * ratio);
    for (let i = 0; i <= this.graphStep; i++) {
      const power = 0.5 + info.nbPower + info.nbBoost * (1 - Math.pow(info.nbBoostFrict, i * 2)) - (info.weight * 3.5);
      line.lineTo(step * i, -power * ratio);
    }
    line.lineTo(160, 0);
    line.lineTo(0, 0);
    line.endFill();
  }
  initBar() {
    const s = 10;
    const w = (180 - (10 * (this.statMax - 1))) / this.statMax;
    for (let i = 0; i < this.statMax; i++) {
      this.attachMovie('statBar', 'bar' + i, 110 + i);
      const mc = this['bar' + i];
      mc._xscale = w;
      mc._yscale = 10;
      mc._x = 260 + i * (w + s);
      mc._y = 470;
      this.attachMovie('iconBar', 'icon' + i, 120 + i);
      const ico = this['icon' + i];
      ico._x = mc._x;
      ico._y = mc._y;
      ico._xscale = ico._yscale = w;
      ico.gotoAndStop(i + 1);
    }
  }
  drawBar() {
    for (let i = 0; i < this.statMax; i++) {
      const mc = this['bar' + i];
      mc._yscale = mc._yscale * 0.9 + (mc.h || 0) * 0.1;
    }
  }
}
J.Console = Console;
K.registerClass('console', Console);

// ── AnimLoader ────────────────────────────────────────────────────────────
class AnimLoader extends J.Slot {
  constructeur() { this.init(); }
  init() {
    this.initLoad();
    this.onPress = function () { this.mng.backToMenu(); };
  }
  initLoad() {
    this.attachMovie('loadingAnim', 'loading', 12);
    this.createEmptyMovieClip('anim', 10);
    this.anim.createEmptyMovieClip('mc', 1);
    this.anim.mc.createEmptyMovieClip('mc', 1);
    this.anim.createEmptyMovieClip('mask', 2);
    const x = (Cs.mcw - this.width) / 2;
    const y = (Cs.mch - this.height) / 2;
    J.MC.drawSquare(this.anim.mask, { x: 0, y: 0, w: this.width, h: this.height }, 0xFF0000);
    const d = 6;
    const col = [0x9DBE5F, 0xBAD595];
    for (let i = 2; i > 0; i--) {
      J.MC.drawSquare(this.anim, { x: -i * d, y: -i * d, w: i * d * 2 + this.width, h: i * d * 2 + this.height }, col[2 - i]);
    }
    this.anim._x = x;
    this.anim._y = y;
    this.anim.mc.setMask(this.anim.mask);
    this.loading._x = Cs.mcw / 2;
    this.loading._y = Cs.mch / 2;
    // MCL : loadClip(name, anim.mc.mc) — le film chargé prend la place du clip
    // vide (même nom, même profondeur) ; onLoadComplete retire la jauge.
    const nom = this.mng.client.getFileInfos(this.link).name;
    this.wantedFPSAvant = K.Std.wantedFPS;
    K.chargerBiblio(nom).then((b) => {
      if (!this._parent) return;                          // séquence déjà quittée
      const conteneur = this.anim.mc;
      const ancien = conteneur.mc;
      const film = new K.Clip(b, 0);
      film.$prof = ancien ? ancien.$prof : 1;
      if (ancien) conteneur.retirerEnfant(ancien);
      conteneur.insererEnfant(film);
      conteneur.nommer(film, 'mc');
      K.finaliser(film, null);
      if (this.loading) this.loading.removeMovieClip();
      K.scene.viderScripts();
    }).catch((e) => {
      console.error('[kaluga] séquence introuvable', nom, e);
      if (this.loading) this.loading.removeMovieClip();
    });
  }
  update() {}
  kill() {
    // Le film part avec son slot : sa musique aussi (un Sound d'un clip retiré
    // se tait en Flash). Et l'on rend au jeu son wantedFPS : le générique
    // pose 40 sur le Std partagé, ce qui accélérait le jeu après — un accident
    // d'époque qu'on ne reproduit pas.
    const film = this.anim && this.anim.mc && this.anim.mc.mc;
    if (film && film.music && typeof film.music.stop === 'function') film.music.stop();
    if (this.wantedFPSAvant !== undefined) K.Std.wantedFPS = this.wantedFPSAvant;
    super.kill();
  }
}
J.AnimLoader = AnimLoader;
K.registerClass('animLoader', AnimLoader);

})(typeof window !== 'undefined' ? window : globalThis);
