/*
 * Kaluga — la CARTE (Map) et la PARTIE (Game), portées de Map.as et Game.as.
 *
 * Game est le « slot » d'une partie : il pose la carte, le fil, les décors,
 * la barre d'infos, la tzongre et le panier ; à chaque image il fait avancer
 * tout le monde dans l'ordre de 2005 (caméra, carte, tzongre, panier,
 * nuisibles, papillons, pommes, décors, particules), puis dessine les fils.
 * Les modes de jeu (modes.js) en héritent et n'écrivent que ce qui change.
 *
 * La carte charge son fond depuis le SWF de carte (map/challenge.swf…) —
 * ici la bibliothèque extraite du même nom — et prévient la partie quand il
 * est là (initGame), exactement comme le MovieClipLoader d'origine.
 */
'use strict';

(function (racine) {

const K = racine.KalugaMoteur;
const J = racine.KalugaJeu;
const Cs = J.Cs;
const random = J.random;
const Key = K.Key;

// ── Map ───────────────────────────────────────────────────────────────────
class Map extends K.Clip {
  constructeur() {
    this.dp_scroller = 650; this.lineMax = 30; this.scrollGroundHeight = 30; this.groundLevel = 10;
    this.distance = 50; this.zoomCoef = 4; this.bitmapWidth = 1000; this.rulerStep = 200;
    this.init();
  }
  init() {
    this.initDefault();
    this.initGround();
    if (this.scrollerInfo != null) this.initScroller();
  }
  initDefault() {
    if (this.width == null) this.width = Cs.mcw;
    if (this.height == null) this.height = Cs.mch;
    if (this.groundLabel == null) this.groundLabel = 'base';
  }
  initScroller() {
    this.createEmptyMovieClip('scroller', this.dp_scroller);
    this.scroller.createEmptyMovieClip('line', 10);
    const o = this.scrollerInfo;
    if (o.ecart == null) o.ecart = 400;
    if (o.startPoint == null) o.startPoint = 1400;
    if (o.largeur == null) o.largeur = 10;
    if (o.coef == null) o.coef = 0.1;
    this.scroller.attachMovie('scrollerBg', 'bg', 2);
    this.scroller.bg._xscale = Cs.mcw;
    this.scroller.bg._yscale = this.scrollerInfo.height;
    this.scroller._y = Cs.mch - (this.groundLevel + this.scrollerInfo.height);
    o.list = [];
    for (let i = o.startPoint; i < this.width; i += o.ecart) o.list.push({ x: i, r: o.largeur });
  }
  initGround() {
    this.game.attachMovie('groundBar', 'mcGround', this.game.dp_ground);
    this.game.mcGround._y = Cs.mch;
    this.game.mcGround.gotoAndStop(this.groundLabel);
  }
  initRuler(startPoint) {
    this.flRuler = true;
    this.rulerCompteurList = [];
    this.createEmptyMovieClip('ruler', 200);
    this.ruler.attachMovie('ruler', 'r', 1);
    for (let i = 0; i < 6; i++) {
      this.ruler.attachMovie('rulerCompteur', 'c' + i, 10 + i);
      const mc = this.ruler['c' + i];
      mc._x = i * this.rulerStep;
      this.rulerCompteurList.push(mc);
    }
    this.ruler.startPoint = startPoint;
  }
  update() {
    if (this.scrollerInfo != null) this.updateScroller();
    if (this.flRuler) {
      this.ruler._x = this.game.mapDecal.x % this.rulerStep;
      const d = Math.floor((-this.ruler.startPoint - this.game.mapDecal.x) / this.rulerStep);
      if (d !== this.ruler.d) {
        for (let i = 0; i < this.rulerCompteurList.length; i++) this.rulerCompteurList[i].field.text = (i + d) * 200;
      }
      this.ruler.d = d;
    }
    if (this.flScroll && this.ground) this.ground._y = this.game.mapDecal.y + (this.height - this.groundLevel);
  }
  // Le fond : la bibliothèque de la carte, posée dans `bg` ; la partie démarre quand elle est là.
  loadBackground(url) {
    this.createEmptyMovieClip('bg', 2);
    const game = this.game;
    K.chargerBiblio(url).then((b) => {
      if (!this._parent) return;                         // partie déjà quittée
      const ancien = this.bg;
      const mc = new K.Clip(b, 0);
      mc.$prof = 2;
      if (ancien) this.retirerEnfant(ancien);
      this.insererEnfant(mc);
      this.nommer(mc, 'bg');
      K.finaliser(mc, null);
      // Le lecteur voit l'image 1 du fichier chargé avant d'appeler onLoadComplete.
      game.initGame();
      K.scene.viderScripts();
    }).catch((e) => { console.error('[kaluga] carte introuvable', url, e); });
  }
  updateScroller() {
    this.scroller.line.clear();
    const list = this.scrollerInfo.list;
    const h = this.scrollerInfo.height;
    const dx = this.game.mapDecal.x;
    for (const p of list) {
      let x = Cs.mch / 2 + (p.x + dx) * this.scrollerInfo.coef;
      const a = { x: x - p.r * this.scrollerInfo.coef, y: 0 };
      const b = { x: x + p.r * this.scrollerInfo.coef, y: 0 };
      x = p.x + dx;
      const c = { x: x + p.r, y: h };
      const d = { x: x - p.r, y: h };
      this.clip(a, b, d, c, 0, Cs.mcw);
      this.drawLine(a, b, c, d);
    }
  }
  drawLine(a, b, c, d) {
    this.scroller.line.beginFill(0xFFFFFF);
    this.scroller.line.moveTo(a.x, a.y);
    this.scroller.line.lineTo(b.x, b.y);
    this.scroller.line.lineTo(c.x, c.y);
    this.scroller.line.lineTo(d.x, d.y);
    this.scroller.line.endFill();
  }
  clip(p1, p2, p3, p4, min_x, max_x) {
    if (p3.x < min_x && p4.x < min_x) {
      const a = (p2.y - p4.y) / (p2.x - p4.x);
      const b = p2.y - a * p2.x;
      const dx = p3.x - p4.x;
      const p3x = Math.min(min_x, p1.x);
      p3.x = p3x; p3.y = p3x * a + b;
      p4.x = min_x; p4.y = (min_x - dx) * a + b;
      return p1.x < min_x && p2.x < min_x;
    }
    if (p3.x > max_x && p4.x > max_x) {
      const a = (p1.y - p3.y) / (p1.x - p3.x);
      const b = p1.y - a * p1.x;
      const dx = p3.x - p4.x;
      const p3x = Math.max(max_x, p1.x);
      p3.x = p3x; p3.y = p3x * a + b;
      p4.x = max_x; p4.y = (max_x - dx) * a + b;
      return p1.x > max_x && p2.x > max_x;
    }
    return false;
  }
}
J.Map = Map;
K.registerClass('map', Map);

// ── Game ──────────────────────────────────────────────────────────────────
class Game extends J.Slot {
  constructeur() {
    this.dp_debugDraw = 6200; this.dp_endGamePanel = 5880; this.dp_mapLoading = 5864; this.dp_whiteScreen = 5860;
    this.dp_infoBar = 5840; this.dp_scroller = 5820; this.dp_feuillage = 5800; this.dp_frontDecor = 5790;
    this.dp_ground = 5780; this.dp_FX = 5000; this.dp_tzongre = 2500; this.dp_bads = 1800; this.dp_fruit = 1000;
    this.dp_fruitBack = 450; this.dp_fil = 500; this.dp_panier = 45; this.dp_decor = 15; this.dp_map = 10;
    this.depthListMax = 500; this.FXMax = 500; this.groundCaseSize = 28; this.whiteFadeSpeed = 3; this.whiteFadeMax = 60;
    this.masterStep = 0;
    this.endPanelStart = []; this.endPanelMiddle = []; this.endPanelEnd = [];
  }
  init() {
    this.initDefault();
    super.init();
    this.flFading = false;
    this.flWhiteScreen = false;
    this.initWhiteScreen(100);
    this.mapDecal = { x: 0, y: 0 };
    this.initMap(this.mapInfo);
    this.masterStep = 0;
    this.mng.music.stop(42);
    this.mng.music.loop('sJeuLoop0', 42);
    this.createEmptyMovieClip('debugDraw', this.dp_debugDraw);
    this.debugDraw.createEmptyMovieClip('line', 1);
  }
  initMap(initObj) {
    initObj.game = this;
    this.attachMovie('map', 'map', this.dp_map, initObj);
    this.map.loadBackground(initObj.skinLink, true);
    this.attachMovie('mapLoading', 'mapLoading', this.dp_mapLoading);
    this.createEmptyMovieClip('fil', this.dp_fil);
  }
  initGame() {
    if (this.mapLoading) this.mapLoading.removeMovieClip();
    this.fadeTo(60, { obj: this, method: 'initStartPanel' });
    this.stat = new J.Stat();
    this.statCombo = new J.Stat();
    this.flEndGame = false;
    this.flEndingGame = false;
    this.initList();
    for (let i = 0; i < this.depthListMax; i++) this.depthList[i] = i;
    this.fxNum = 0;
    this.score = 0;
    this.initDecor();
    this.initGroundList();
    this.initSprites();
    this.initInfoBar();
    this.initEndPanelList();
    this.debugCoef = 0;
    this.dbgGroundLineList = [];
  }
  startGame() {
    this.masterStep = 1;
    if (this.tzongre) this.tzongre.unFreeze();   // Challenge : elle n'arrive qu'à l'ouverture de la porte
  }
  initStartPanel() {
    this.attachMovie('startPanel', 'startPanel', this.dp_endGamePanel);
    this.startPanel.pano.gotoAndStop(this.type);
    this.startPanel._x = Cs.mcw / 2;
    this.startPanel._y = Cs.mch / 2;
    this.startPanel.onPress = function () { this._parent.startPanelForward(); };
    this.keyListener = { game: this };
    this.keyListener.onKeyDown = function () { if (Key.isDown(Key.SPACE)) this.game.startPanelForward(); };
    Key.addListener(this.keyListener);
  }
  startPanelForward() {
    if (!this.startPanel || !this.startPanel._parent) return;
    this.startPanel.toRead--;
    if (this.startPanel.toRead === 0) this.startPanel.gotoAndPlay('ready');
    else this.startPanel.pano.nextFrame();
  }
  endStartPanel() {
    this.startPanel.removeMovieClip();
    this.fadeTo(0, { obj: this, method: 'startGame' });
    Key.removeListener(this.keyListener);
  }
  initEndPanelList() {
    this.endPanelStart = [];
    this.endPanelMiddle = [];
    this.endPanelEnd = [];
    let max;
    switch (this.mode) {
      case 'single':
        // Le panneau « Rejouer ? » est offert à tous les modes (rustine
        // scripts/patch-kaluga-challenge.js du disque Flash : l'original le
        // réservait à $train et aux comptes blancs).
        this.addReplayPanel();
        break;
      case 'triathlon':
        max = 2;
        // fall through
      case 'heptathlon':
        if (max == null) max = 6;
        if (this.mng.tournament.eventId < max) this.addContinuePanel();
        else if (this.mng.client.isWhite()) this.endPanelEnd.push('menu');
        else this.endPanelEnd.push('kill');
        break;
      default: break;
    }
  }
  addReplayPanel() {
    this.endPanelEnd.push({ list: [
      { type: 'margin', value: 100 },
      { type: 'title', title: 'Rejouer?' },
      { type: 'but', title: 'oui', callback: { obj: this, method: 'reset' } },
      { type: 'but', title: 'non', callback: { obj: this.mng, method: 'backToMenu' } },
    ] });
  }
  addContinuePanel() {
    this.endPanelEnd.push({ list: [
      { type: 'margin', value: 100 },
      { type: 'title', title: 'Continuer?' },
      { type: 'but', title: 'oui', callback: { obj: this, method: 'kill' } },
      { type: 'but', title: 'non', callback: { obj: this.mng, method: 'backToMenu' } },
    ] });
  }
  initList() {
    this.particuleList = []; this.depthList = []; this.decorList = [];
    this.butterflyList = []; this.badList = []; this.birdList = []; this.caterpillarList = [];
    this.squirrelList = []; this.frogList = []; this.antList = [];
    this.fruitList = []; this.physList = [];
    this.spriteList = [];              // jamais initialisée en 2005 : les push y échouaient en silence
  }
  initDefault() {
    if (this.flLinkActive == null) this.flLinkActive = true;
    if (this.friction == null) this.friction = 0.982;
    if (this.groundFriction == null) this.groundFriction = 0.9;
    if (this.grav == null) this.grav = 0.5;
    if (this.level == null) this.level = 0;
    if (this.mapInfo == null) {
      this.mapInfo = { width: 700, height: 480, skinLink: this.mng.client.getFileInfos('map/dawn.swf').name };
    }
  }
  initDecor() {
    this.createEmptyMovieClip('decor', this.dp_decor);
    this.createEmptyMovieClip('frontDecor', this.dp_frontDecor);
    this.decor.d = 0;
    this.frontDecor.d = 0;
  }
  initGroundList() {
    this.groundList = [];
    const max = Math.ceil(this.map.width / this.groundCaseSize);
    for (let i = 0; i < max; i++) this.groundList.push([]);
  }
  initSprites() {}
  initScroller() { this.attachMovie('scroller', 'scroller', this.dp_scroller); }
  initInfoBar() {
    this.attachMovie('infoBar', 'infoBar', this.dp_infoBar);
    this.infoBar._x = Cs.mcw;
  }
  initFeuillage(frame) {
    if (frame == null) frame = 1;
    this.attachMovie('feuillage', 'feuillage', this.dp_feuillage);
    this.feuillage.gotoAndStop(frame);
    this.flFeuillage = true;
  }
  genPanier() {
    const initObj = { game: this, map: this.map, vity: 0, cScale: 1 };
    this.attachMovie('spPhysPanier', 'panier', this.dp_panier, initObj);
    this.panier.x = random(Cs.mcw);
    this.panier.y = this.map.height - (this.map.groundLevel + this.panier.ray);
    this.panier.endUpdate();
  }
  update() {
    if (this.flFading) this.fade();
    switch (this.masterStep) {
      case 0: break;
      case 1:
        if (this.camFocus != null) this.moveMap(true);
        this.map.update();
        this.fil.clear();
        this.fil.lineStyle(1, 0xFFFFFF, 50);
        this.frict = Math.pow(this.friction, Cs.tmod);
        this.groundFrict = Math.pow(this.groundFriction, Cs.tmod);
        if (!this.flEndGame) {
          if (this.tzongre) this.tzongre.update();
          if (this.panier) this.panier.update();
          for (let i = 0; i < this.badList.length; i++) { const b = this.badList[i]; b.update(); if (this.badList[i] !== b) i--; }
          for (let i = 0; i < this.butterflyList.length; i++) { const b = this.butterflyList[i]; b.update(); if (this.butterflyList[i] !== b) i--; }
          for (let i = 0; i < this.fruitList.length; i++) { const f = this.fruitList[i]; f.update(); if (this.fruitList[i] !== f) i--; }
          for (const d of this.decorList) this.updateDecor(d);
          this.moveParticule();
          if (this.flEndingGame) {
            this.endTimer -= Cs.tmod;
            if (this.endTimer < 0) {
              if (this.tzongre) this.tzongre.freeze();
              this.fadeTo(80, { obj: this, method: 'genEndGamePanel' });
              this.masterStep = 2;
            }
          }
        }
        if (this.tzongre) this.tzongre.drawLink();
        break;
      case 2:
        if (this.endGamePanel && this.endGamePanel.sheet && this.endGamePanel.sheet.panel) this.endGamePanel.sheet.panel.update();
        break;
      default: break;
    }
  }
  updateScore() {
    this.score = Math.max(0, this.score);
    this.scorePanel.setScore(this.score);
  }
  newFruit(initObj) {
    const d = this.depthList.pop();
    if (initObj == null) initObj = {};
    initObj.game = this;
    initObj.map = this.map;
    initObj.depth = d;
    this.attachMovie('spPhysFruit', 'fruit' + d, this.dp_fruit + d, initObj);
    const mc = this['fruit' + d];
    this.fruitList.push(mc);
    this.physList.push(mc);
    return mc;
  }
  setCameraFocus(focus) {
    if (focus != null && this.camBox == null) this.setCameraBox('wide');
    this.camFocus = focus;
  }
  setCameraBox(box) {
    if (box === 'wide') box = { x: 0, y: 0, w: this.map.width, h: this.map.height };
    this.camBox = box;
  }
  moveMap(lagFlag) {
    const c = Math.pow(0.8, Cs.tmod);
    let x = Cs.mcw / 2 - this.camFocus.x;
    let y = Cs.mch / 2 - this.camFocus.y;
    const box = this.camBox;
    x = Math.max(Cs.mcw - box.w, Math.min(x, box.x));
    y = Math.max(Cs.mch - box.h, Math.min(y, box.y));
    if (lagFlag) {
      this.mapDecal.x = c * this.mapDecal.x + x * (1 - c);
      this.mapDecal.y = c * this.mapDecal.y + y * (1 - c);
    } else {
      this.mapDecal.x = x;
      this.mapDecal.y = y;
    }
  }
  removeFromGround(list, mc) {
    if (!list) return;
    const i = list.indexOf(mc);
    if (i >= 0) { list.splice(i, 1); mc.groundId = undefined; }
  }
  newTzongre(initObj, d) {
    if (initObj == null) initObj = this.tzongreInfo;
    if (d == null) d = 0;
    initObj.game = this;
    initObj.map = this;
    this.attachMovie('spPhysTzongre', 'tzongre' + d, this.dp_tzongre + d, initObj);
    const mc = this['tzongre' + d];
    this.spriteList.push(mc);
    return mc;
  }
  newBird(initObj) {
    const d = this.depthList.pop();
    if (initObj == null) initObj = {};
    initObj.game = this; initObj.map = this.map; initObj.depth = d;
    this.attachMovie('spBadsBird', 'bird' + d, this.dp_fruit + d, initObj);
    const mc = this['bird' + d];
    this.badList.push(mc); this.birdList.push(mc); this.spriteList.push(mc);
    if (this.tzongre) this.tzongre.target = mc;
    return mc;
  }
  newCaterpillar(initObj) {
    const d = this.depthList.pop();
    if (initObj == null) initObj = {};
    initObj.game = this; initObj.map = this.map; initObj.depth = d;
    this.attachMovie('spBadsCaterpillar', 'caterpillar' + d, this.dp_bads + d, initObj);
    const mc = this['caterpillar' + d];
    this.badList.push(mc); this.caterpillarList.push(mc); this.physList.push(mc); this.spriteList.push(mc);
    return mc;
  }
  newAnt(initObj) {
    const d = this.depthList.pop();
    if (initObj == null) initObj = {};
    initObj.game = this; initObj.map = this.map; initObj.depth = d;
    this.attachMovie('spBadsAnt', 'ant' + d, this.dp_bads + d, initObj);
    const mc = this['ant' + d];
    this.antList.push(mc); this.badList.push(mc); this.physList.push(mc); this.spriteList.push(mc);
    return mc;
  }
  newSquirrel(initObj) {
    const d = this.depthList.pop();
    if (initObj == null) initObj = {};
    initObj.game = this; initObj.map = this.map; initObj.depth = d;
    this.attachMovie('spBadsSquirrel', 'squirrel' + d, this.dp_bads + d, initObj);
    const mc = this['squirrel' + d];
    this.squirrelList.push(mc); this.badList.push(mc); this.physList.push(mc); this.spriteList.push(mc);
    return mc;
  }
  newButterfly(initObj) {
    const d = this.depthList.pop();
    if (initObj == null) initObj = {};
    initObj.game = this; initObj.map = this.map; initObj.depth = d;
    this.attachMovie('spButterfly', 'butterfly' + d, this.dp_bads + d, initObj);
    const mc = this['butterfly' + d];
    this.butterflyList.push(mc); this.spriteList.push(mc);
    return mc;
  }
  newFrog(initObj) {
    const d = this.depthList.pop();
    if (initObj == null) initObj = {};
    initObj.game = this; initObj.map = this.map; initObj.depth = d;
    this.attachMovie('spBadsFrog', 'frog' + d, this.dp_bads + d, initObj);
    const mc = this['frog' + d];
    this.frogList.push(mc); this.badList.push(mc); this.physList.push(mc); this.spriteList.push(mc);
    return mc;
  }
  newFX(link) {
    this.fxNum = (this.fxNum + 1) % this.FXMax;
    this.attachMovie(link, link + '_' + this.fxNum, this.dp_FX + this.fxNum);
    const mc = this[link + '_' + this.fxNum];
    mc.x = 0; mc.y = 0; mc.vitx = 0; mc.vity = 0;
    return mc;
  }
  moveParticule() {
    for (let i = 0; i < this.particuleList.length; i++) {
      const mc = this.particuleList[i];
      let death = false;
      switch (mc.mode) {
        case 0: {
          if (mc.flGround !== true) {
            mc.vity += 0.2;
            mc.vitx *= this.frict;
            mc.vity *= this.frict;
            mc.x += mc.vitx * Cs.tmod;
            mc.y += mc.vity * Cs.tmod;
            mc._x = mc.x + this.mapDecal.x;
            mc._y = mc.y + this.mapDecal.y;
          }
          mc.time -= Cs.tmod;
          if (mc.time < 10) {
            mc._alpha = mc.time * 10;
            if (mc.time < 0) { mc.removeMovieClip(); death = true; }
          }
          const gy = this.map.height - this.map.groundLevel;
          if (mc._y > gy) { mc.flGround = true; mc._y = gy; }
          break;
        }
        case 1:
          mc._x = mc.x + this.mapDecal.x;
          mc._y = mc.y + this.mapDecal.y;
          break;
        default: break;
      }
      if (death || !mc._parent) { this.particuleList.splice(i, 1); i--; }
    }
  }
  dropFeuille(x, y) {
    const mc = this.newFX('plume');
    this.particuleList.push(mc);
    const sens = random(2) * 2 - 1;
    mc.gotoAndPlay(random(40) + 1);
    mc.vitx = random(10) - 5;
    mc.vity = 0;
    mc.x = x; mc.y = 0;
    mc._xscale = sens * 100;
    mc.time = 60 + random(20);
    mc.mode = 0;
    mc.p.gotoAndStop(2 + random(4));
    return mc;
  }
  shootFeuillage(x, power) {
    if (this.mng.pref.$param[2]) {
      const p = power / (20 * Cs.tmod);
      const max = p + random(p);
      for (let i = 0; i < max; i++) this.dropFeuille(x, -random(20));
    }
    this.mng.sfx.playSound('sBush', 11);
    this.mng.sfx.setVolume(11, power * 1.5);
  }
  deActiveLink() {
    this.flLinkActive = false;
    if (this.tzongre.linkList.length > 0) this.tzongre.release();
  }
  activeLink() { this.flLinkActive = true; }
  removeFruit(fruit) { const i = this.fruitList.indexOf(fruit); if (i >= 0) this.fruitList.splice(i, 1); }
  removePhys(phys) { const i = this.physList.indexOf(phys); if (i >= 0) this.physList.splice(i, 1); }
  removeCaterpillar(mc) { const i = this.caterpillarList.indexOf(mc); if (i >= 0) this.caterpillarList.splice(i, 1); }
  removeFromList(mc, listName) {
    const list = this[listName];
    if (!list) return;
    const i = list.indexOf(mc);
    if (i >= 0) list.splice(i, 1);
  }
  fruitJumpIn() {
    for (const fruit of this.fruitList) {
      if (fruit.flGround && !fruit.flTree) {
        fruit.exitGroundMode();
        fruit.flScNoLink = false;
        const dif = fruit.x - this.panier.x;
        fruit.vity = -(8 + (random(100) / 10) + (fruit.weight * 10));
        fruit.vitx = -dif / ((16 - (fruit.vity * 1.2)) - (fruit.weight * 4));
      }
    }
  }
  fruitJumpOut() {
    for (const fruit of this.fruitList) {
      if (!fruit.flScoreAble && fruit.flGround && !fruit.flTree) {
        fruit.exitGroundMode();
        const center = this.map.width / 2;
        const dif = (fruit.x - center);
        fruit.vitx = (center * 4 * fruit.weight) / dif;
        fruit.vity = -(6 + random(100) / 10);
      }
    }
  }
  loose(msg) {
    this.endPanelStart.push({ label: 'basic', list: [{ type: 'msg', title: 'Perdu !', msg }] });
    this.endGame();
  }
  endGame(timer) { if (!this.flEndingGame) this.initEndGame(timer); }
  initEndGame(timer) {
    if (timer == null) timer = 0;
    this.endTimer = timer;
    this.flEndingGame = true;
    // Seul le vrai mode Challenge ($classic, hors tournoi) envoie un score au classement.
    if (this.type === '$classic' && this.tournament == null) this.saveScore(this.score);
    this.mng.client.saveSlot(0);
  }
  saveScore(score) {
    this.flSavingScore = true;
    this.mng.client.saveScore(score, { tz: this.tzongreInfo.id, gOr: this.gOr | 0 });
    this.endPanelStart.push({ label: 'basic', wait: { o: this, v: 'flSavingScore' }, list: [{ type: 'msg', title: '', msg: 'sauvegarde du score...' }] });
  }
  genEndGamePanel() { this.attachMovie('endGamePanel', 'endGamePanel', this.dp_endGamePanel); }
  setEndGamePanel(sheet) {
    const initObj = { game: this, list: this.endPanelStart.concat(this.endPanelMiddle).concat(this.endPanelEnd) };
    sheet.attachMovie('panel', 'panel', 1, initObj);
  }
  checkUnlock(n) {
    if (this.mng.client.isWhite()) {
      const list = this.mng.card.$mode[n];
      if (this.level < 3 && !list[this.level + 1]) {
        this.endPanelMiddle.push({ label: 'congrat', list: [{ type: 'congrat', text: 'Vous avez débloqué le mode ' + this.mng.difNameList[this.level + 1] + '!!\n', id: 10 }] });
        this.mng.card.$mode[n][this.level + 1] = 1;
      }
      switch (this.level) {
        case 0: this.addTitem('$butterfly' + (n - 2)); break;
        case 1: this.addTitem('$smiley' + (n - 2)); break;
        case 2: {
          const tzUnlockList = [1, 4, 3, 2];
          const id = tzUnlockList[n - 2];
          this.endPanelMiddle.push({ label: 'congrat', list: [{ type: 'congrat', text: 'Vous avez débloqué une nouvelle tzongre : ' + this.mng.tzInfo[id].name + '!!\n', id }] });
          this.mng.card.$tz[id] = 1;
          this.addTitem('$tz' + id);
          break;
        }
        case 3: {
          const unlockList = ['$basket', '$bird', '$ring', '$ant'];
          this.addTitem(unlockList[n - 2]);
          break;
        }
        default: break;
      }
      this.mng.client.saveSlot(0);
    }
  }
  addTitem(str) {
    this.endPanelMiddle.push({ label: 'congrat', list: [{ type: 'congrat', text: 'Un nouveau Titem est disponible dans votre inventaire !\n', id: 10 }] });
    this.mng.client.giveItem(str);
  }
  addKagulga() {
    this.endPanelMiddle.push({ label: 'congrat', list: [{ type: 'congrat', text: 'Vous avez gagné la kagulga !\nEn véritable cuir de Tzongre, cette cagoule vous permettra de garder la fruticlasse en toutes circonstances !', id: 14 }] });
    this.mng.client.giveAccessory('$kagulga');
  }
  fade() {
    const c = Math.pow(0.8, Cs.tmod);
    const ws = this.whiteScreen;
    ws.alpha = ws.alpha * c + ws.cible * (1 - c);
    ws._alpha = ws.alpha;
    if (Math.abs(ws.alpha - ws.cible) < 3) {
      this.flFading = false;
      const cb = ws.callback;
      const cible = ws.cible;
      if (cb) cb.obj[cb.method](cb.args);
      if (cible === 0) this.removeWhiteScreen();
    }
  }
  fadeTo(cible, callback) {
    this.flFading = true;
    if (!this.flWhiteScreen) this.initWhiteScreen();
    this.whiteScreen.cible = cible;
    this.whiteScreen.callback = callback;
  }
  initWhiteScreen(alpha) {
    if (alpha == null) alpha = 0;
    this.flWhiteScreen = true;
    this.attachMovie('whiteScreen', 'whiteScreen', this.dp_whiteScreen);
    this.whiteScreen.alpha = alpha;
    this.whiteScreen._alpha = alpha;
  }
  removeWhiteScreen() {
    this.flWhiteScreen = false;
    if (this.whiteScreen) this.whiteScreen.removeMovieClip();
  }
  newDecor(link, initObj) {
    if (initObj == null) initObj = {};
    if (initObj.depthCoef == null) initObj.depthCoef = 1;
    if (initObj.xscale == null) initObj.xscale = 100;
    if (initObj.yscale == null) initObj.yscale = 100;
    if (initObj.width == null) initObj.width = 0;
    if (initObj.corner == null) initObj.corner = 0;
    initObj.visible = false;
    initObj.link = link;
    this.decorList.push(initObj);
    this.updateDecor(initObj);
    return initObj;
  }
  updateDecor(obj) {
    const mx = Cs.mcw / 2;
    const dx = (obj.x + this.mapDecal.x) - mx;
    obj.rx = mx + dx * obj.depthCoef;
    obj.ry = obj.y + this.mapDecal.y * obj.depthCoef;
    if (obj.widthCoef != null) {
      const x = dx * obj.depthCoef - dx * obj.widthCoef;
      obj.xscale = x * 2;
    }
    const w = obj.width * obj.xscale / 100;
    let xmin, xmax;
    switch (obj.corner) {
      case 1: xmin = Math.min(obj.rx, obj.rx + w); xmax = Math.max(obj.rx, obj.rx + w); break;
      default: xmin = Math.min(obj.rx - w / 2, obj.rx + w / 2); xmax = Math.max(obj.rx - w / 2, obj.rx + w / 2); break;
    }
    if (xmax < 0 || xmin > Cs.mcw) {
      if (obj.visible) {
        obj.path.removeMovieClip();
        obj.path = undefined;
        obj.visible = false;
      }
    } else {
      if (!obj.visible) {
        let base = this.decor;
        if (obj.depthCoef > 1) base = this.frontDecor;
        const d = base.d++;
        base.attachMovie(obj.link, 'decor' + d, d, obj);
        obj.path = base['decor' + d];
        if (obj.frame) obj.path.gotoAndStop(obj.frame);
        obj.path._xscale = 50 + obj.depthCoef * 50;
        obj.path._yscale = (obj.yscale / 2) + obj.depthCoef * (obj.yscale / 2);
        obj.visible = true;
      }
      const mc = obj.path;
      mc._x = obj.rx;
      mc._y = obj.ry;
      mc._xscale = obj.xscale;
    }
  }
  reset(initObj) {
    if (initObj == null) initObj = {};
    initObj.tzongreInfo = this.tzongreInfo;
    initObj.mode = 'single';
    this.mng.waitList.push({ link: 'same', initObj });
    this.kill();
  }
  onAddFruit() {}
  onFruitEatFinish() {}
  onTzDeath() { this.endGame(60); }
  onTzLink() {}
  onTzRelease() {}
  onPause() { this.mng.setPause(true); }
  kill() {
    this.mng.music.stopSound('sJeuLoop0', 42);
    if (this.keyListener) Key.removeListener(this.keyListener);
    super.kill();
  }
  scoreSaved() {}
}
J.Game = Game;

})(typeof window !== 'undefined' ? window : globalThis);
