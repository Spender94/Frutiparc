/*
 * Kaluga — les MODES de jeu : Challenge (Classic), Chrono, Invasion, Survie
 * (Survival), Piste (Ring), Préparation (Train), et les épreuves olympiques
 * (Trial : lancer de vers, lancer d'écureuil, lancer de fourmis, plantapomme,
 * planter de vers, dextéripomme, course de grenouilles). Portés de
 * Games/kaluga/class/kaluga/game/.
 */
'use strict';

(function (racine) {

const K = racine.KalugaMoteur;
const J = racine.KalugaJeu;
const Cs = J.Cs;
const random = J.random;
const Key = K.Key;
const temps = (t) => J.MTNumber.getTimeStr(t, "'", "''");

// ── Classic (Challenge) ───────────────────────────────────────────────────
class Classic extends J.Game {
  constructeur() {
    super.constructeur();
    this.caterLimit = 6; this.antLimit = 16; this.squirrelLimit = 2; this.frogLimit = 3;
    this.init();
  }
  init() {
    this.type = '$classic';
    const name = this.mng.client.getFileInfos('map/challenge.swf').name;
    this.mapInfo = { skinLink: name, groundLabel: 'challenge', width: 700, height: 480 };
    this.initOptionProba();
    super.init();
    this.step = 0;
  }
  initGame() { super.initGame(); this.initFeuillage('challenge'); }
  startGame() {
    super.startGame();
    this.difTimer = 0;
    this.kilo = 0;
    this.step = 1;
    this.initScroller();
    this.kiloPanel.setCoef(this.kilo / this.kiloMax);
    this.map.bg.animPorte.play();
    this.birdCoolDown = 10000000;
  }
  initStartPanel() { super.initStartPanel(); this.startPanel.toRead = 2; }
  initSprites() {
    super.initSprites();
    this.genPanier();
    for (let i = 0; i < Math.round(this.fruitBase / 2); i++) this.genGroundFruit();
  }
  initDefault() {
    super.initDefault();
    if (this.level == null) this.level = 0;
    if (this.fruitBase == null) this.fruitBase = 4;
    if (this.fruitBaseMax == null) this.fruitBaseMax = 8;
    if (this.kiloMax == null) this.kiloMax = 80;
    if (this.flFruitFalling == null) this.flFruitFalling = true;
  }
  initOptionProba() {
    this.optionProbaList = [30, 30, 8, 4, 12, 2, 6, 10];
    this.optionProbaTotal = 0;
    for (const p of this.optionProbaList) this.optionProbaTotal += p;
  }
  initInfoBar() {
    super.initInfoBar();
    this.kiloPanel = this.infoBar.addElement('barDisc', { width: 30, link: 'discFruit' });
    this.scorePanel = this.infoBar.addElement('barScore');
    this.updateScore();
    this.kiloPanel.setCoef(0);
  }
  getOption() {
    const rand = random(this.optionProbaTotal);
    let n = 0;
    let total = this.optionProbaList[n];
    while (total < rand) { n++; total += this.optionProbaList[n]; }
    return n;
  }
  update() {
    super.update();
    switch (this.step) {
      case 1:
        if (this.map.bg.animPorte._currentframe > 70) {
          this.step = 2;
          this.genTzongre();
          this.tzongre.unFreeze();
        }
        break;
      case 2:
        this.birdCoolDown -= Cs.tmod;
        if (this.birdCoolDown < 0 && this.frogList.length < this.frogLimit) { this.genFrog(); this.birdCoolDown = 2000; }
        this.difTimer -= Cs.tmod;
        if (this.difTimer < 0) this.levelUp();
        if (this.flFruitFalling && this.fruitList.length < this.fruitBase) this.genTreeFruit();
        this.checkFruit();
        break;
      default: break;
    }
  }
  levelUp() {
    this.level++;
    this.difTimer = 500 + 100 * this.level;
    this.fruitBase = Math.min(this.fruitBase + 0.2, this.fruitBaseMax);
    if (!random(3) && this.antList.length < this.antLimit) {
      const side = random(2) * 2 - 1;
      const max = Math.round(this.level / 2.5);
      for (let i = 0; i < max; i++) { const mc = this.genAnt(side); mc.x += side * i * 10; }
    }
    if (this.level > 1 && !random(3)) this.genButterfly();
    if (this.level > 2 && this.caterpillarList.length < this.caterLimit && !random(3)) this.genCaterpillar(random(2) * 2 - 1);
    const ratio = this.kilo / this.kiloMax;
    if (random(ratio * 100) > 40 && random(2) && this.frogList.length < this.frogLimit) this.genFrog();
    if ((this.squirrelList.length + 1) * 10 < this.level && !random(2) && this.squirrelList.length < this.squirrelLimit) this.genSquirrel();
  }
  getFruitWeight() {
    let w = 0.5 + random(10 + this.level) / 10;
    const dif = this.kiloMax - (this.kilo + w);
    if (dif < 0.5) { w = this.kiloMax - this.kilo; this.flFruitFalling = false; }
    this.kilo += w;
    return w;
  }
  genButterfly(id) {
    if (id == null) id = this.getOption();
    const mc = this.newButterfly({ id });
    const side = random(2) * 2 - 1;
    const w = this.map.width / 2;
    mc.x = w + (w + 10) * side;
    mc.y = random(this.map.height - this.map.groundLevel);
    mc.setSens(-side);
    this.stat.incVal('Nombre de papillon', 1);
    return mc;
  }
  genTzongre() {
    this.tzongre = this.newTzongre(this.tzongreInfo);
    this.tzongre.x = this.map.bg.animPorte._x;
    this.tzongre.y = this.map.bg.animPorte._y;
    this.tzongre.vitx = 8;
    this.tzongre.vity = -4;
    this.tzongre.endUpdate();
  }
  genGroundFruit() {
    const w = this.getFruitWeight();
    const r = w * 12;
    const initObj = { x: r + random(Cs.mcw - (2 * r)), weight: w };
    if (this.kilo === this.kiloMax) initObj.flGold = true;
    const mc = this.newFruit(initObj);
    mc.y = this.map.height - (this.map.groundLevel + mc.ray);
    mc.endUpdate();
    this.stat.incVal('Nombre de pomme', 1);
  }
  genTreeFruit() {
    const ratio = this.kilo / this.kiloMax;
    if (ratio === 1) return undefined;
    const w = this.getFruitWeight();
    const r = w * 12;
    const initObj = { x: r + random(Cs.mcw - 2 * r), weight: w, flTree: true, flGround: true };
    if (this.kilo === this.kiloMax) { initObj.flGold = true; this.newBird(); }
    const mc = this.newFruit(initObj);
    mc.y = -1000;
    mc.recal();
    mc.endUpdate();
    if (this.masterStep === 1) this.kiloPanel.setCoef(this.kilo / this.kiloMax);
    if (this.kilo / this.kiloMax === 1) this.kiloPanel.skin.gotoAndStop(3);
    this.stat.incVal('Nombre de pomme', 1);
    return mc;
  }
  genCaterpillar(side) {
    if (side == null) side = random(2) * 2 - 1;
    const w = this.map.width / 2;
    const mc = this.newCaterpillar({ x: w + (w + 10) * side, y: this.map.height - this.map.groundLevel });
    mc.setSens(-side);
    this.stat.incVal('Nombre de ver', 1);
    return mc;
  }
  genAnt(side) {
    if (side == null) side = random(2) * 2 - 1;
    const w = this.map.width / 2;
    const mc = this.newAnt({ x: w + (w + 10) * side, y: this.map.height - this.map.groundLevel });
    mc.setSens(-side);
    this.stat.incVal('Nombre de fourmi', 1);
    return mc;
  }
  genSquirrel(side) {
    const mc = this.newSquirrel();
    if (side == null) side = random(2) * 2 - 1;
    const w = this.map.width / 2;
    mc.x = w + (w + 10) * side;
    mc.y = this.map.height - this.map.groundLevel;
    mc.setSens(-side);
    this.stat.incVal("Nombre d'écureuil", 1);
    return mc;
  }
  genFrog() {
    const sens = (random(2) * 2) - 1;
    const w = this.map.width / 2;
    const mc = this.newFrog({ x: w - (w + 6) * sens, y: this.map.height - this.map.groundLevel, mobilite: 100 });
    mc.setSens(sens);
    mc.endUpdate();
    mc.focus = this.tzongre;
    this.stat.incVal('Nombre de grenouille', 1);
    this.mng.sfx.play('sFrog');
    return mc;
  }
  initEndGame(timer) {
    if (this.mng.client.isWhite()) {
      if (this.score > this.mng.card.$classic.$s) {
        let text = 'Record général battu !!\n';
        if (this.mng.card.$classic.$s > 0) text += 'Ancien record : ' + this.mng.card.$classic.$s + ' (' + this.mng.tzInfo[this.mng.card.$classic.$t].name + ')\n';
        text += 'Nouveau record : ' + this.score + ' (' + this.mng.tzInfo[this.tzongreInfo.id].name + ')\n';
        this.endPanelMiddle.push({ label: 'congrat', list: [{ type: 'congrat', text, id: 12 }] });
        this.mng.card.$classic.$s = this.score;
        this.mng.card.$classic.$t = this.tzongreInfo.id;
        this.mng.client.saveSlot(0);
      }
    }
    super.initEndGame(timer);
  }
  onFruitEatFinish() { super.onFruitEatFinish(); this.stat.incVal('Pommes perdues', 1); }
  onAddFruit() { super.onAddFruit(); this.birdCoolDown = 2400; }
  scoreSaved() {
    super.scoreSaved();
    let name = '', score = '';
    name += '<b>Général:</b>\n'; score += '\n';
    name += this.stat.getList('name'); score += this.stat.getList('score');
    name += '<b>Combo:</b>\n'; score += '\n';
    name += this.statCombo.getList('name'); score += this.statCombo.getList('score');
    const obj = { list: [
      { type: 'bigScore', frame: 1, score: this.score },
      { type: 'stats', box: { x: 82, y: 16, w: 280, h: 200 }, name, score },
    ] };
    if (this.mng.client.isBlack() || this.mng.client.isGrey()) {
      const rnk = this.mng.client.ranking;
      obj.list.splice(1, 0, { type: 'bigScore', frame: 7, score: rnk.bestScorePos });
      if (rnk.rankingScore === rnk.bestScore && rnk.oldPos > 0) {
        const dif = rnk.oldPos - rnk.bestScorePos;
        let txt = 'Vous avez battu votre meilleur score!!\n Vous avez gagné ' + dif + ' place';
        if (dif > 1) txt += 's ';
        txt += '\n';
        this.endPanelMiddle.push({ label: 'congrat', list: [{ type: 'congrat', text: txt, id: 11 }] });
      }
    }
    this.endPanelMiddle.push(obj);
  }
  checkFruit() { if (this.fruitList.length === 0) this.initEndGame(120); }
}
J.Classic = Classic;
K.registerClass('gameClassic', Classic);

// ── Chrono ────────────────────────────────────────────────────────────────
class Chrono extends J.Game {
  constructeur() { super.constructeur(); this.init(); }
  init() {
    this.type = '$chrono';
    this.mapInfo = { skinLink: this.mng.client.getFileInfos('map/forest.swf').name, width: 700, height: 480 };
    super.init();
    this.initScroller();
  }
  initGame() {
    this.goalList = [60000, 50000, 45000, 42000];
    super.initGame();
    this.step = 2;
    this.record = [];
  }
  startGame() {
    super.startGame();
    this.barTimer = this.infoBar.addElement('barTimer');
    this.barTimer.startTimer();
  }
  initStartPanel() {
    super.initStartPanel();
    this.startPanel.toRead = 1;
    this.startPanel.text = 'Ramassez la totalité des pommes en moins de ' + temps(this.goalList[this.level]) + ' !';
  }
  initSprites() {
    super.initSprites();
    this.genTzongre();
    this.genPanier();
    this.max = 6 + this.level * 2;
    for (let i = 0; i < this.max; i++) this.genGroundFruit();
  }
  update() {
    super.update();
    if (this.masterStep === 1 && this.step === 2) {
      this.barTimer.update();
      if (this.checkEnd()) {
        this.barTimer.stopTimer();
        this.score = this.barTimer.time;
        this.addScore();
        this.endGame();
        this.step = 3;
      }
      if (this.barTimer.time > this.goalList[this.level]) this.timeUp();
    }
  }
  genGroundFruit() {
    const w = 0.6 + (this.level * 0.4) + (random(40) / 100);
    const r = w * 12;
    const mc = this.newFruit({ x: r + random(Cs.mcw - (2 * r)), weight: w });
    mc.y = this.map.height - (this.map.groundLevel + mc.ray);
    mc.endUpdate();
  }
  genTzongre() {
    const initObj = this.tzongreInfo;
    initObj.x = Cs.mcw / 2; initObj.y = Cs.mch / 2; initObj.vity = -4;
    this.tzongre = this.newTzongre(initObj);
    this.tzongre.endUpdate();
  }
  checkEnd() {
    for (const f of this.fruitList) if (!f.flPanier) return false;
    return true;
  }
  onAddFruit() { this.record.push(this.barTimer.time); }
  addScore() {
    const card = this.mng.card.$chrono;
    const list = card.$level[this.level];
    const rec = list[list.length - 1];
    let best, worst;
    if (this.score < rec) { card.$level[this.level] = this.record; best = this.score; worst = rec; }
    else { best = rec; worst = this.score; }
    const statList = [];
    for (let i = 0; i < this.max; i++) statList.push({ value: this.record[i] / worst, ghost: list[i] / worst });
    const lineCoef = 5000 / worst;
    this.endPanelMiddle.push({ list: [
      { type: 'bigScore', frame: 3, score: temps(this.score) },
      { type: 'bigScore', frame: 2, score: temps(best) },
      { type: 'margin', value: 15 },
      { type: 'graph', gfx: 'partGraphCurve', box: { x: 20, y: 6, w: 420, h: 230 }, maxResult: this.max, margin: 10, list: statList,
        flGhost: true, flLine: true, flNode: true, flCurve: false, nodeFrame: 1, line: lineCoef, lineBase: 5, marginInt: 16, marginUp: 16, lineSuffix: 'sec.', flBackground: true },
    ] });
    if (this.score <= this.goalList[this.level]) this.checkUnlock(2);
    this.mng.client.saveSlot(0);
  }
  reset() { super.reset({ level: this.level }); }
  timeUp() {
    const msgList = [
      this.tzongre.name + " n'a pas réussi à rassembler toutes les pommes à temps.",
      'Le temps reglementaire est écoulé, ' + this.tzongre.name + ' a échoué.',
      this.tzongre.name + ' a manqué de précision sur cette partie.',
      'Le panier de ' + this.tzongre.name + " n'a pas été rempli dans les temps.",
    ];
    this.endPanelStart.push({ label: 'basic', list: [{ type: 'msg', title: 'Trops tard!', msg: msgList[random(msgList.length)] }] });
    this.step = 3;
    this.endGame();
  }
}
J.Chrono = Chrono;
K.registerClass('gameChrono', Chrono);

// ── Invasion ──────────────────────────────────────────────────────────────
class Invasion extends J.Game {
  constructeur() { super.constructeur(); this.init(); }
  init() {
    this.goalList = [90000, 120000, 150000, 180000];
    this.type = '$invasion';
    this.mapInfo = { skinLink: this.mng.client.getFileInfos('map/mordor.swf').name, width: 700, height: 480, groundLabel: 'empty' };
    super.init();
    this.initScroller();
  }
  initStartPanel() {
    super.initStartPanel();
    this.startPanel.text = 'Si vous tenez plus de ' + temps(this.goalList[this.level]) + " c'est gagné !";
    this.startPanel.toRead = 1;
  }
  startGame() {
    super.startGame();
    this.barTimer = this.infoBar.addElement('barTimer');
    this.barTimer.setTimer(0);
    this.barTimer.startTimer();
  }
  initGame() { super.initGame(); this.step = 0; this.dif = 0; this.difTimer = 0; this.difTimerBase = 1000; }
  initSprites() { super.initSprites(); this.genTzongre(); this.genGroundFruit(); this.genGroundFruit(); this.genGroundFruit(); }
  update() {
    super.update();
    if (this.masterStep === 1) {
      this.barTimer.update();
      this.difTimer -= Cs.tmod;
      if (this.difTimer < 0) this.difUp();
    }
  }
  difUp() {
    this.dif++;
    if (this.antList.length < 50) {
      const side = random(2) * 2 - 1;
      const max = Math.round(this.dif * (1 + this.level * 0.4));
      for (let i = 0; i < max; i++) { const mc = this.genAnt(side); mc.x += side * i * 10; }
    }
    this.difTimerBase = Math.max(100, this.difTimerBase - 50);
    this.difTimer = this.difTimerBase;
  }
  genGroundFruit() {
    const w = 1.8 - this.level * 0.2;
    const r = w * 12;
    const mc = this.newFruit({ x: r + random(Cs.mcw - (2 * r)), weight: w });
    mc.y = this.map.height - (this.map.groundLevel + mc.ray);
    mc.endUpdate();
  }
  genTzongre() {
    const initObj = this.tzongreInfo;
    initObj.x = Cs.mcw / 2; initObj.y = Cs.mch / 2; initObj.vity = -4;
    this.tzongre = this.newTzongre(initObj);
    this.tzongre.endUpdate();
  }
  genAnt(side) {
    const mc = this.newAnt();
    if (side == null) side = random(2) * 2 - 1;
    const w = this.map.width / 2;
    mc.x = w + (w + 10) * side;
    mc.y = this.map.height - this.map.groundLevel;
    mc.setSens(-side);
    return mc;
  }
  addScore() {
    const info = this.mng.card.$invasion.$level[this.level];
    if (this.score > info.$s) { info.$s = this.score; info.$t = this.tzongreInfo.id; }
    this.endPanelMiddle.push({ list: [
      { type: 'bigScore', frame: 3, score: temps(this.score) },
      { type: 'bigScore', frame: 2, score: temps(info.$s) },
    ] });
    if (this.score > this.goalList[this.level]) this.checkUnlock(4);
    this.mng.client.saveSlot(0);
  }
  stopTimer() { this.barTimer.stopTimer(); this.score = this.barTimer.time; this.addScore(); }
  onTzDeath() { super.onTzDeath(); this.stopTimer(); }
  reset() { super.reset({ level: this.level }); }
  onFruitEatFinish() { super.onFruitEatFinish(); this.stopTimer(); this.endGame(10); }
}
J.Invasion = Invasion;
K.registerClass('gameInvasion', Invasion);

// ── Survival ──────────────────────────────────────────────────────────────
class Survival extends J.Game {
  constructeur() { super.constructeur(); this.init(); }
  init() {
    this.goalList = [45000, 60000, 80000, 150000];
    this.type = '$survival';
    this.mapInfo = { skinLink: this.mng.client.getFileInfos('map/field.swf').name, width: 700, height: 480, groundLabel: 'field' };
    super.init();
    this.initScroller();
  }
  initStartPanel() {
    super.initStartPanel();
    let txt = 'Repoussez les assauts des corbeaux le plus longtemps possible.\n';
    txt += 'Si vous tenez plus de ' + temps(this.goalList[this.level]) + ", c'est gagné !!!";
    this.startPanel.text = txt;
    this.startPanel.toRead = 1;
  }
  startGame() {
    super.startGame();
    this.barTimer = this.infoBar.addElement('barTimer');
    this.barTimer.setTimer(0);
    this.barTimer.startTimer();
  }
  initGame() { super.initGame(); this.step = 0; this.dif = 0; this.difTimer = 0; this.difTimerBase = 1000; }
  initSprites() { super.initSprites(); this.genTzongre(); this.genGroundFruit(); }
  update() {
    super.update();
    if (this.masterStep === 1) {
      this.barTimer.update();
      this.difTimer -= Cs.tmod;
      if (this.difTimer < 0) this.difUp();
    }
  }
  difUp() {
    this.dif++;
    if (this.birdList.length < 10) this.newBird({ hitPoint: 40 + this.level * 10 });
    this.difTimerBase = Math.max(100, this.difTimerBase - 50);
    this.difTimer = this.difTimerBase;
  }
  genGroundFruit() {
    const w = 1.2 + this.level * 0.1;
    const r = w * 12;
    const mc = this.newFruit({ x: r + random(Cs.mcw - (2 * r)), weight: w });
    mc.y = this.map.height - (this.map.groundLevel + mc.ray);
    mc.endUpdate();
  }
  genTzongre() {
    const initObj = this.tzongreInfo;
    initObj.x = Cs.mcw / 2; initObj.y = Cs.mch / 2; initObj.vity = -4;
    this.tzongre = this.newTzongre(initObj);
    this.tzongre.endUpdate();
  }
  addScore() {
    const info = this.mng.card.$survival.$level[this.level];
    if (this.score > info.$s) { info.$s = this.score; info.$t = this.tzongreInfo.id; }
    this.endPanelMiddle.push({ list: [
      { type: 'bigScore', frame: 3, score: temps(this.score) },
      { type: 'bigScore', frame: 2, score: temps(info.$s) },
    ] });
    if (this.score > this.goalList[this.level]) this.checkUnlock(3);
    this.mng.client.saveSlot(0);
  }
  stopTimer() { this.barTimer.stopTimer(); this.score = this.barTimer.time; this.addScore(); }
  onTzDeath() { super.onTzDeath(); this.stopTimer(); }
  reset() { super.reset({ level: this.level }); }
}
J.Survival = Survival;
K.registerClass('gameSurvival', Survival);

// ── Ring (Piste) ──────────────────────────────────────────────────────────
const RING_DATA = [
  { e: 7000, list: [[270, 200], [260, 200], [250, 200], [260, 200], [260, 200], [250, 200], [240, 200], [230, 190], [220, 180], [210, 170], [210, 160], [220, 150], [240, 140], [260, 150], [280, 160], [300, 170], [290, 180], [280, 190], [270, 200], [260, 200], [250, 200], [260, 200], [270, 200], [270, 160]] },
  { e: 15000, ajout: 10, list: [[270, 170], [270, 170], [270, 170], [320, 170], [220, 170], [320, 170], [220, 170], [270, 170], [270, 170], [270, 160], [270, 150], [270, 140], [270, 130], [270, 120], [270, 110], [270, 100], [270, 110], [270, 120], [270, 130], [270, 140], [270, 150], [270, 160], [270, 170], [270, 170], [270, 170], [260, 170], [240, 170], [210, 170], [170, 170], [140, 170], [120, 170], [110, 170], [120, 170], [140, 170], [170, 170], [210, 170], [260, 170], [300, 170], [330, 170], [350, 170], [360, 170], [360, 170], [360, 170], [350, 170], [330, 170], [300, 170], [300, 170], [300, 170], [290, 170], [310, 170], [280, 170], [320, 170], [270, 170], [330, 170], [260, 170], [340, 170], [250, 170], [350, 170], [260, 170], [340, 170], [250, 170], [350, 170], [260, 170], [340, 170], [270, 170], [330, 170], [280, 170], [320, 170], [290, 170], [310, 170], [270, 180]] },
  { e: 16000, ajout: 20, list: [[320, 200], [310, 190], [290, 170], [260, 140], [240, 120], [230, 110], [230, 110], [220, 120], [200, 140], [170, 170], [150, 190], [140, 200], [140, 200], [150, 190], [150, 190], [170, 170], [200, 140], [220, 120], [230, 110], [230, 110], [230, 110], [230, 110], [230, 110], [250, 110], [290, 110], [310, 110], [320, 110], [320, 110], [310, 110], [290, 110], [250, 110], [240, 110], [250, 110], [290, 110], [310, 110], [320, 110], [320, 120], [310, 130], [300, 140], [290, 150], [280, 160], [270, 170], [260, 160], [250, 150], [240, 140], [230, 130], [220, 120], [210, 110], [200, 100], [190, 90], [190, 90], [190, 90], [190, 90], [180, 90], [160, 90], [130, 90], [110, 90], [100, 90], [100, 90], [110, 90], [130, 100], [160, 110], [180, 120], [190, 130], [200, 130], [210, 130], [220, 130], [230, 130], [240, 130], [250, 130], [250, 130], [250, 130], [190, 150], [310, 150], [190, 140], [310, 140], [190, 130], [310, 130], [200, 120], [300, 120], [210, 110], [290, 110], [220, 100], [280, 100], [230, 90], [270, 90], [240, 80], [250, 80], [245, 80], [250, 90], [255, 100], [260, 110], [265, 120], [270, 130]] },
  { e: 14000, list: [[320, 120], [320, 130], [320, 140], [320, 150], [320, 160], [320, 170], [320, 180], [320, 190], [320, 200], [100, 150], [300, 150], [200, 150], [400, 150], [100, 150], [300, 150], [200, 150], [400, 150], [100, 150], [200, 150], [300, 150], [400, 150], [100, 150], [200, 150], [300, 150], [400, 150], [100, 150], [200, 150], [300, 150], [400, 150], [405, 140], [415, 120], [430, 90], [440, 70], [445, 60], [445, 60], [445, 60], [445, 60], [445, 60], [445, 60], [445, 60], [445, 60], [445, 60], [445, 60], [445, 60], [445, 60], [300, 80], [300, 80], [300, 80], [300, 80], [300, 80], [300, 80], [200, 80], [200, 80], [200, 80], [200, 80], [200, 80], [200, 80], [100, 80], [100, 80], [100, 80], [100, 80], [100, 80], [100, 80], [270, 130]] },
];
class Ring extends J.Game {
  constructeur() { super.constructeur(); this.init(); }
  init() {
    this.goalList = [45000, 90000, 90000, 90000];
    this.type = '$ring';
    this.levelData = this.getLevelData();
    this.mapInfo = { skinLink: this.mng.client.getFileInfos('map/forest.swf').name, width: this.levelData.e + 150, height: 480 };
    super.init();
    this.step = 0;
    this.initScroller();
  }
  initStartPanel() {
    super.initStartPanel();
    this.startPanel.text = temps(this.goalList[this.level]);
    this.startPanel.toRead = 1;
  }
  initSprites() { super.initSprites(); this.genGroundFruit(); this.genTzongre(); this.genPiste(); }
  genPiste() {
    const pStart = this.levelData.s, pEnd = this.levelData.e;
    this.newDecor('decorPoteau', { x: pStart, y: this.map.height, depthCoef: 0.8, width: 30 });
    this.newDecor('decorPoteauGong', { x: pEnd, y: this.map.height, depthCoef: 0.9, width: 30 });
    this.newDecor('decorStartFlag', { x: pStart, y: (this.map.height - 320), depthCoef: 1, widthCoef: 0.8, width: 100 });
    this.newDecor('decorGong', { x: pEnd, y: this.map.height, depthCoef: 1, widthCoef: 0.9, width: 100 });
    const ringMax = this.levelData.list.length;
    this.ringSpace = (pEnd - pStart) / (ringMax - 1);
    this.ringList = [];
    for (let i = 0; i < (ringMax - 1); i++) {
      const info = this.levelData.list[i];
      const obj = this.newDecor('decorRing', { x: pStart + i * this.ringSpace, y: info.y, depthCoef: 1.0001, widthCoef: 0.9, width: info.r, yscale: info.r, frame: 1 });
      this.ringList.push(obj);
    }
    this.newDecor('decorPoteau', { x: pStart, y: this.map.height, depthCoef: 1.25, width: 30 });
    this.newDecor('decorPoteauGong', { x: pEnd, y: this.map.height, depthCoef: 1.11, width: 30 });
  }
  genTzongre() {
    const initObj = this.tzongreInfo;
    initObj.x = Cs.mcw / 2; initObj.y = Cs.mch / 2; initObj.vity = -4;
    this.tzongre = this.newTzongre(initObj);
    this.setCameraFocus(this.tzongre);
    this.tzongre.endUpdate();
  }
  genGroundFruit() {
    this.fruit = this.newFruit({ x: 20, weight: 1 });
    this.fruit.y = this.map.height - (this.map.groundLevel + this.fruit.ray);
    this.fruit.endUpdate();
  }
  update() {
    super.update();
    switch (this.step) {
      case 1:
        this.barTimer.update();
        if (this.fruit.x < this.levelData.s) { this.step = 1.5; this.currentRing = 0; this.changeRingLight(2); }
        break;
      case 1.5:
        this.barTimer.update();
        if (this.fruit.x > this.levelData.s) {
          if (this.checkFruitInRing()) {
            this.step = 2;
            this.changeRingLight(1);
            this.currentRing++;
            this.changeRingLight(2);
            this.barTimer.startTimer();
          } else {
            this.step = 1;
            this.changeRingLight(1);
          }
        }
        break;
      case 2: {
        this.barTimer.update();
        const nextX = this.levelData.s + this.currentRing * this.ringSpace;
        if (this.fruit.x > nextX) {
          if (this.checkFruitInRing()) {
            this.changeRingLight(1);
            this.currentRing++;
            this.changeRingLight(2);
            if (this.currentRing === this.levelData.list.length) { this.hitGong(); break; }
            this.mng.sfx.play('sRing');
          } else {
            this.tzongre.release();
            this.barTimer.kill();
            this.step = 0;
            const ring = this.levelData.list[this.currentRing];
            const dify = Math.abs(this.fruit.y - ring.y);
            if (dify < (ring.r / 2) + this.fruit.ray) this.fruit.vitx *= -0.8;
            for (let i = 0; i < this.ringList.length; i++) { this.currentRing = i; this.changeRingLight(1); }
          }
        }
        break;
      }
      case 3:
        this.timer -= Cs.tmod;
        if (this.timer < 0) { this.endGame(); this.step = 4; }
        break;
      default: break;
    }
  }
  onTzLink() {
    if (this.step === 0) {
      this.step = 1;
      this.barTimer = this.infoBar.addElement('barTimer');
      this.barTimer.setTimer(0);
    }
  }
  hitGong() {
    this.mng.sfx.play('sGong');
    this.barTimer.stopTimer();
    this.score = this.barTimer.time;
    this.addScore();
    this.timer = 24;
    this.tzongre.release();
    this.fruit.vitx *= -1;
    this.step = 3;
  }
  onTzRelease() { if (this.step === 1) { this.step = 0; this.barTimer.kill(); } }
  addScore() {
    const info = this.mng.card.$ring.$level[this.level];
    if (this.score < info.$s) { info.$s = this.score; info.$t = this.tzongreInfo.id; }
    this.endPanelMiddle.push({ list: [
      { type: 'bigScore', frame: 3, score: temps(this.score) },
      { type: 'bigScore', frame: 2, score: temps(info.$s) },
    ] });
    if (this.score <= this.goalList[this.level]) this.checkUnlock(5);
    this.mng.client.saveSlot(0);
  }
  checkFruitInRing() {
    const ring = this.levelData.list[this.currentRing];
    if (!ring) return false;
    const y = this.fruit.y;
    return (y + this.fruit.ray < ring.y + ring.r / 2 && y - this.fruit.ray > ring.y - ring.r / 2);
  }
  reset() { super.reset({ level: this.level }); }
  changeRingLight(frame) {
    const obj = this.ringList[this.currentRing];
    if (!obj) return;
    obj.frame = frame;
    if (obj.path != null) obj.path.gotoAndStop(frame);
  }
  getLevelData() {
    const d = RING_DATA[this.level] || RING_DATA[0];
    const o = { s: 250, e: d.e, list: d.list.map(([y, r]) => ({ y, r: r + (d.ajout || 0) })) };
    return o;
  }
}
J.Ring = Ring;
K.registerClass('gameRing', Ring);

// ── Train (Préparation) ───────────────────────────────────────────────────
class Train extends J.Game {
  constructeur() { super.constructeur(); this.init(); }
  init() {
    this.type = '$train';
    const name = this.mng.client.getFileInfos('map/challenge.swf').name;
    this.mapInfo = { skinLink: name, groundLabel: 'challenge', width: 700, height: 480 };
    super.init();
    this.step = 0;
  }
  initGame() { super.initGame(); this.initFeuillage('challenge'); }
  startGame() { super.startGame(); this.step = 1; this.map.bg.animPorte.play(); }
  initStartPanel() { super.initStartPanel(); this.startPanel.toRead = 3; }
  initSprites() { super.initSprites(); for (let i = 0; i < 6; i++) this.genGroundFruit(); }
  initDefault() { super.initDefault(); if (this.level == null) this.level = 0; }
  update() {
    super.update();
    switch (this.step) {
      case 1:
        if (this.map.bg.animPorte._currentframe > 70) { this.step = 2; this.genTzongre(); this.tzongre.unFreeze(); }
        break;
      case 2:
        if (!random(1000)) this.genButterfly();
        break;
      default: break;
    }
  }
  genButterfly() {
    const mc = this.newButterfly({ id: random(3) });
    const side = random(2) * 2 - 1;
    const w = this.map.width / 2;
    mc.x = w + (w + 10) * side;
    mc.y = random(this.map.height - this.map.groundLevel);
    mc.setSens(-side);
    return mc;
  }
  genTzongre() {
    this.tzongre = this.newTzongre(this.tzongreInfo);
    this.tzongre.x = this.map.bg.animPorte._x;
    this.tzongre.y = this.map.bg.animPorte._y;
    this.tzongre.vitx = 8;
    this.tzongre.vity = -4;
    this.tzongre.endUpdate();
  }
  genGroundFruit() {
    const w = 0.5 + random(10) / 10;
    const r = w * 12;
    const mc = this.newFruit({ x: r + random(Cs.mcw - (2 * r)), weight: w });
    mc.y = this.map.height - (this.map.groundLevel + mc.ray);
    mc.endUpdate();
  }
}
J.Train = Train;
K.registerClass('gameTrain', Train);

// ── Trial (les épreuves olympiques) ───────────────────────────────────────
class Trial extends J.Game {
  init() { super.init(); }
  initDefault() {
    if (this.card == null) this.card = this.mng.card.$trial.$list[this.trialId];
    super.initDefault();
  }
  addScore() {
    switch (this.mode) {
      case 'single': {
        const list = this.card.$list;
        list.push({ $s: this.score, $t: this.tzongreInfo.id });
        while (list.length > 12) list.shift();
        if (this.score > this.card.$max) {
          this.card.$max = this.score;
          this.endPanelMiddle.push({ label: 'congrat', list: [{ type: 'congrat', text: 'Record général battu!!\n', id: 12 }] });
        }
        const data = this.card.$tz[this.tzongreInfo.id];
        const best = data.$s == null ? 0 : data.$s;
        if (this.score > best) {
          data.$s = this.score;
          data.$t = this.tzongreInfo.id;
          this.endPanelMiddle.push({ label: 'congrat', list: [{ type: 'congrat', text: 'Félicitation!\nVous avez amélioré le score maximum de ' + this.tzongreInfo.name + ' !!\n', id: this.tzongre.id }] });
        }
        const maxResult = 8;
        let statList = [];
        const start = Math.max(list.length - maxResult, 0);
        for (let i = start; i < list.length; i++) {
          const d = list[i];
          statList.push({ value: d.$s / this.card.$max, num: d.$s, color: this.mng.color.tzPastel[d.$t] });
        }
        const obj = this.getEndPanelObj(statList);
        statList = [];
        let max = 0;
        for (const t of this.card.$tz) { if (t.$s != null) max = Math.max(t.$s, max); }
        for (let i = 0; i < this.card.$tz.length; i++) {
          const d = this.card.$tz[i];
          statList.push({ value: d.$s / max, num: d.$s, color: this.mng.color.tzPastel[i] });
        }
        const obj2 = { list: [
          { type: 'title', title: 'Meilleure Tzongre' },
          { type: 'margin', value: 15 },
          { type: 'graph', gfx: 'partGraphBar', box: { x: 20, y: 6, w: 420, h: 264 }, maxResult: 5, margin: 10, marginInt: 6, list: statList, flNumber: true, flBackground: true, flTriangle: true },
        ] };
        this.endPanelMiddle.push(obj, obj2);
        break;
      }
      default: break;
    }
    this.mng.client.saveSlot(0);
  }
  initEndGame(timer) {
    let max;
    switch (this.mode) {
      case 'triathlon':
        max = 2;
        // fall through
      case 'heptathlon': {
        if (max == null) max = 6;
        this.updateTournament();
        this.tournament.eventId++;
        this.endPanelMiddle.push({ list: [
          { type: 'title', title: ' Resultats ' },
          { type: 'margin', value: 8 },
          { type: 'table', box: { x: 20, y: 6, w: 460, h: 264 }, stats: this.tournament.stats },
        ] });
        if (this.tournament.eventId > max) this.endTournament();
        break;
      }
      default: break;
    }
    super.initEndGame(timer);
  }
  endTournament() {
    const list = [];
    let score = 0;
    for (let i = 0; i < this.tournament.stats.length; i++) {
      const player = this.tournament.stats[i];
      let sum = 0;
      for (const r of player.results) sum += r.score;
      list[i] = { id: player.id, sum };
      if (player.id === this.tzongreInfo.id) score = sum;
    }
    list.sort((a, b) => (a.sum > b.sum ? -1 : (a.sum < b.sum ? 1 : 0)));
    const flWin = list[0].id === this.tzongreInfo.id;
    const tz = this.mng.tzInfo;
    let text = tz[list[0].id].name + ' gagne facilement ce ' + this.mode + ' !!!\n';
    text += tz[list[1].id].name + " emporte la médaille d'argent et " + tz[list[2].id].name + ' prend la 3ème place !\n';
    text += 'Notons la pietre performance de ' + tz[list[4].id].name + ' qui se place a la dernière place avec ' + list[4].sum + ' points!\n';
    this.endPanelMiddle.push({ label: 'ladder', list: [{ type: 'ladder', text, list }] });
    if (this.mng.client.isWhite()) {
      if (flWin) {
        switch (this.mode) {
          case 'triathlon':
            this.endPanelMiddle.push({ label: 'congrat', list: [{ type: 'congrat', text: 'Vous avez débloqué 4 nouvelles épreuves ainsi que le mode heptathlon !\n', id: 10 }] });
            this.mng.card.$mode[1][3] = 1; this.mng.card.$mode[1][4] = 1; this.mng.card.$mode[1][5] = 1; this.mng.card.$mode[1][6] = 1; this.mng.card.$mode[1][8] = 1;
            this.addKagulga();
            this.mng.client.saveSlot(0);
            break;
          case 'heptathlon':
            this.endPanelMiddle.push({ label: 'congrat', list: [{ type: 'congrat', text: 'Vous avez terminé le mode heptathlon, félicitation !!!\n', id: 10 }] });
            this.mng.card.$seq[1] = 1;
            this.mng.client.saveSlot(0);
            this.addTitem('$allstar');
            break;
          default: break;
        }
      }
      const n = this.mode === 'triathlon' ? '$tria' : '$hept';
      if (score > this.mng.card.$trial[n].$s) {
        this.endPanelMiddle.push({ label: 'congrat', list: [{ type: 'congrat', text: 'Record général battu !!\nAncien record: ' + this.mng.card.$trial[n].$s + ' pts\nNouveau record: ' + score + ' pts', id: 12 }] });
        this.mng.card.$trial[n].$s = score;
        this.mng.card.$trial[n].$t = this.tzongreInfo.id;
        this.mng.client.saveSlot(0);
      }
    }
    if (score > 0) this.saveScore(score);
  }
  updateTournament() {
    if (this.score == null) this.score = 0;
    for (const player of this.tournament.stats) {
      if (player.id === this.tzongreInfo.id) {
        const results = player.results[this.tournament.eventId];
        results.base = this.score;
        results.score = results.base * results.coef;
      } else {
        this.updateResult(player);
      }
    }
  }
  updateResult(player) {
    const results = player.results[this.tournament.eventId];
    results.base = Math.round(results.base * 10) / 10;
    results.score = results.base * results.coef;
  }
  getEndPanelObj() {}
  attachMeterLog(x, y, text) {
    this.fxNum++;
    return this.newDecor('meterLog', { x, y, text });
  }
  genSquirrelJudge(x) {
    this.squirrel = this.newSquirrel({ mode: 2, x, y: this.map.height - this.map.groundLevel, flLinkable: false });
    this.squirrel.endUpdate();
  }
  // La performance simulée d'une tzongre adverse : [base, aléa] par tzongre, puis un facteur.
  resultatIA(player, table, facteur, zero) {
    const [base, alea] = table[player.id];
    let score = base + random(alea);
    if (zero && zero[player.id] && !random(zero[player.id])) score = 0;
    score *= facteur || 1;
    score *= this.tournament.difCoef / 10;
    player.results[this.tournament.eventId].base = score;
    super.updateResult(player);
  }
}
J.Trial = Trial;

const graphBarre = (statList, h) => ({ type: 'graph', gfx: 'partGraphBar', box: { x: 20, y: 6, w: 420, h }, margin: 10, marginInt: 6, list: statList, flNumber: true, flBackground: true, flTriangle: true });

// ── CaterLaunch (lancer de vers) ──────────────────────────────────────────
class CaterLaunch extends Trial {
  constructeur() { super.constructeur(); this.launchPoint = 1400; this.init(); }
  init() {
    this.type = '$caterLaunch';
    this.trialId = 0;
    this.mapInfo = { skinLink: this.mng.client.getFileInfos('map/olympic_a.swf').name, scrollerInfo: { height: 30 }, groundLabel: 'olympic', width: 10000, height: 480 };
    super.init();
    this.step = 0;
    this.initScroller();
  }
  initStartPanel() { super.initStartPanel(); this.startPanel.toRead = 3; }
  initSprites() {
    super.initSprites();
    this.genTzongre();
    this.genSquirrelJudge(this.launchPoint);
    this.genCaterpillar(-1);
    this.squirrel.focus = this.tzongre;
  }
  genTzongre() {
    const initObj = this.tzongreInfo;
    initObj.x = Cs.mcw / 2; initObj.y = Cs.mch / 2; initObj.vity = -4; initObj.flLauncher = true;
    this.tzongre = this.newTzongre(initObj);
    this.setCameraFocus(this.tzongre);
    this.moveMap(true);
    this.map.update();
    this.tzongre.endUpdate();
  }
  genCaterpillar(side) {
    const mc = this.newCaterpillar();
    if (side == null) side = random(2) * 2 - 1;
    const w = this.map.width / 2;
    mc.x = w + (w + 10) * side;
    mc.y = this.map.height - this.map.groundLevel;
    mc.setSens(-side);
    mc.endUpdate();
    this.cater = mc;
    return mc;
  }
  update() {
    super.update();
    if (this.masterStep === 1) {
      switch (this.step) {
        case 1:
          if (this.squirrel.status == null && this.cater.x > this.launchPoint) { this.squirrel.setStatus(0); this.flValidate = false; }
          break;
        case 2:
          if (this.flLinkActive) this.deActiveLink();
          if (this.squirrel.status == null && this.cater.x > this.launchPoint) { this.squirrel.setStatus(1); this.flValidate = true; }
          if (this.cater.flGround) {
            this.step = 3;
            this.timer = 120;
            this.caterPoint = Math.round((this.cater.x - 1400) * 10) / 10;
            this.distance = this.caterPoint + 'cm';
            this.attachMeterLog(this.cater.x, this.cater.y, this.caterPoint + 'cm');
          }
          break;
        case 3:
          this.timer -= Cs.tmod;
          if (this.timer < 0) {
            if (!this.flValidate) {
              this.setCameraFocus(this.squirrel);
              if (this.timer < -40) { this.loose('Vous avez dépassé la ligne de lancé !'); this.step = 4; }
            } else {
              this.score = this.caterPoint;
              this.addScore();
              this.step = 4;
              this.endGame();
            }
          }
          break;
        default: break;
      }
    }
  }
  onTzRelease(tzongre) {
    this.setCameraFocus(tzongre.linkList[0]);
    if (this.step === 1) this.step = 2;
    this.map.initRuler(this.launchPoint);
  }
  onTzLink() { this.step = 1; this.squirrel.focus = this.cater; }
  getEndPanelObj(statList) {
    const obj = { list: [
      { type: 'bigScore', frame: 1, score: this.distance },
      { type: 'bigScore', frame: 2, score: this.card.$max + 'cm' },
      { type: 'margin', value: 15 },
      graphBarre(statList, 230),
    ] };
    if (this.mng.client.isWhite()) {
      if (!this.mng.card.$bonus[0] && this.caterPoint > 1000) { this.addTitem('$squirrel0'); this.mng.card.$bonus[0] = 1; this.mng.client.saveSlot(0); }
    }
    return obj;
  }
  updateResult(player) { this.resultatIA(player, [[8000, 4000], [9000, 5000], [8000, 4000], [5000, 4000], [8000, 6000]]); }
}
K.registerClass('gameCaterLaunch', CaterLaunch);

// ── SquirrelLaunch (lancer d'écureuil) ────────────────────────────────────
class SquirrelLaunch extends Trial {
  constructeur() { super.constructeur(); this.outMargin = 40; this.init(); }
  init() {
    this.type = '$squirrelLaunch';
    this.trialId = 2;
    this.mapInfo = { skinLink: this.mng.client.getFileInfos('map/squirrel.swf').name, width: 1000, height: 2820, flScroll: true };
    super.init();
    this.step = 0;
    this.flMark = false;
    this.initScroller();
  }
  initStartPanel() { super.initStartPanel(); this.startPanel.toRead = 3; }
  initSprites() {
    super.initSprites();
    this.genTzongre();
    this.genSquirrel();
    this.newDecor('decorMegarbre', { x: 500, y: this.map.height - (this.map.groundLevel + 1250) });
    this.newDecor('decorMegarbreBase', { x: 500, y: this.map.height - (this.map.groundLevel) });
  }
  genTzongre() {
    const initObj = this.tzongreInfo;
    initObj.x = this.map.width / 2; initObj.y = this.map.height - Cs.mch / 2; initObj.vity = -4; initObj.flLauncher = true;
    this.tzongre = this.newTzongre(initObj);
    this.tzongre.setBox({ left: 0, top: this.map.height - Cs.mch, right: this.map.width, bottom: this.map.height });
    this.setTzongreFocus();
    this.moveMap(false);
    this.tzongre.endUpdate();
  }
  genSquirrel() {
    this.squirrel = this.newSquirrel({ x: 0, y: this.map.height - this.map.groundLevel });
    this.squirrel.endUpdate();
    this.squirrel.setSens(1);
  }
  update() {
    switch (this.step) {
      case 0: case 1: super.update(); break;
      case 2:
        super.update();
        if (this.flLinkActive) this.deActiveLink();
        if (!this.flMark && this.squirrel.vity > 0) this.attachMark();
        this.checkOut();
        break;
      case 3:
        this.waitTimer -= Cs.tmod;
        if (this.waitTimer < 0) { this.step = 4; this.activeLink(); }
        break;
      case 4:
        if (this.camFocus && this.camFocus.type === 'Squirrel' && this.squirrel.vity > 2.5) this.setTzongreFocus();
        this.checkGround();
        this.checkOut();
        super.update();
        break;
      case 5:
        this.waitTimer -= Cs.tmod;
        if (this.waitTimer < 0) { this.score = this.squirrelPoint; this.addScore(); this.endGame(); this.step = 99; }
        this.checkGround();
        super.update();
        break;
      default: super.update(); break;
    }
  }
  onTzRelease(tzongre) {
    this.setCameraFocus(tzongre.linkList[0]);
    this.setCameraBox('wide');
    if (this.step === 1) this.step++;
  }
  onTzLink() {
    if (!this.flMark) this.step = 1;
    else { this.step = 5; this.waitTimer = 50; this.squirrel.weight *= 2.5; }
  }
  getEndPanelObj(statList) {
    const obj = { list: [
      { type: 'bigScore', frame: 1, score: this.score + 'cm' },
      { type: 'bigScore', frame: 2, score: this.card.$max + 'cm' },
      { type: 'margin', value: 15 },
      graphBarre(statList, 230),
    ] };
    if (this.mng.client.isWhite()) {
      if (!this.mng.card.$bonus[1] && this.score > 1000) { this.addTitem('$squirrel1'); this.mng.card.$bonus[1] = 1; this.mng.client.saveSlot(0); }
    }
    return obj;
  }
  checkGround() { if (this.squirrel.flGround) { this.step = 99; this.faultGround(); } }
  checkOut() {
    const x = this.squirrel.x;
    if (x < -this.outMargin || x > this.map.width + this.outMargin) { this.step = 99; this.faultOut(); }
  }
  faultGround() {
    this.endPanelStart.push({ label: 'basic', list: [{ type: 'msg', title: 'Faute!', msg: "Pour que le lancer soit validé, il faut rattraper l'écureuil avant qu'il ne touche le sol." }] });
    this.endGame();
  }
  faultOut() {
    this.endPanelStart.push({ label: 'basic', list: [{ type: 'msg', title: 'Hors-limite!', msg: "Pour que le lancer soit validé, L'écureuil doit rester dans les limites de la zone de tir." }] });
    this.endGame();
  }
  attachMark() {
    const y = Math.round(((this.map.height - this.map.groundLevel) - this.squirrel.y) * 10) / 10;
    const obj = this.newDecor('heightLine', { x: 0, y: this.squirrel.y, width: this.map.width });
    const mc = obj.path;
    if (mc) {
      if (this.squirrel.x < this.map.width - 120) mc.f._x = this.squirrel.x + 70; else mc.f._x = this.squirrel.x - 70;
      mc.f.f.field.text = y + 'cm';
    }
    this.flMark = true;
    this.waitTimer = 32;
    this.squirrelPoint = y;
    this.step = 3;
  }
  setTzongreFocus() {
    this.setCameraBox({ x: 0, y: -(this.map.height - Cs.mch), w: this.map.width, h: this.map.height });
    this.setCameraFocus(this.tzongre);
  }
  updateResult(player) { this.resultatIA(player, [[9000, 4000], [8000, 5000], [9000, 3000], [12000, 6000], [8000, 10000]]); }
}
K.registerClass('gameSquirrelLaunch', SquirrelLaunch);

// ── AntLaunch (lancer de fourmis) ─────────────────────────────────────────
class AntLaunch extends Trial {
  constructeur() { super.constructeur(); this.launchPoint = 1400; this.init(); }
  init() {
    this.type = '$antLaunch';
    this.trialId = 4;
    this.mapInfo = { skinLink: this.mng.client.getFileInfos('map/olympic_a.swf').name, scrollerInfo: { height: 30 }, groundLabel: 'olympic', width: 10000, height: 480 };
    super.init();
    this.meterLogList = []; this.scoreList = []; this.camWaitList = [];
    this.step = 0;
    this.initScroller();
  }
  initStartPanel() { super.initStartPanel(); this.startPanel.toRead = 3; }
  initSprites() {
    super.initSprites();
    this.genTzongre();
    this.tzongre.bonusMulti = 4;
    this.tzongre.bonusCombo = 1;
    this.tzongre.updateRange();
    this.genSquirrelJudge(this.launchPoint);
    for (let i = 0; i < 4; i++) { const mc = this.genAnt(); mc.x -= i * 10; }
    this.squirrel.focus = this.tzongre;
  }
  genAnt() {
    const mc = this.newAnt();
    mc.x = 0;
    mc.y = this.map.height - this.map.groundLevel;
    mc.setSens(1);
    return mc;
  }
  genTzongre() {
    const initObj = this.tzongreInfo;
    initObj.x = Cs.mcw / 2; initObj.y = Cs.mch / 2; initObj.vity = -4; initObj.flLauncher = true;
    this.tzongre = this.newTzongre(initObj);
    this.setCameraFocus(this.tzongre);
    this.moveMap(true);
    this.map.update();
    this.tzongre.endUpdate();
  }
  update() {
    super.update();
    switch (this.step) {
      case 1:
        for (const ant of this.antList) {
          if (this.squirrel.status == null && ant.x > this.launchPoint) { this.squirrel.setStatus(0); this.flValidate = false; }
        }
        break;
      case 2: {
        if (this.flLinkActive) this.deActiveLink();
        let first;
        for (const ant of this.antList.slice()) {
          if (ant.flGround) this.landing(ant);
          if (ant.x > this.launchPoint && this.squirrel.status == null) { this.squirrel.setStatus(1); this.flValidate = true; }
          if (!ant._parent) continue;
          if (first == null || ant.y > first.y) first = ant;
        }
        if (this.camWaitList.length > 0) {
          const o = this.camWaitList[0];
          first = o.path;
          o.timer -= Cs.tmod;
          if (o.timer < 0) this.camWaitList.shift();
        }
        if (this.camFocus !== first) this.setCameraFocus(first);
        if (first == null) {
          if (this.flValidate) {
            this.score = 0;
            for (const s of this.scoreList) this.score += s;
            this.addScore();
            this.endGame();
            this.step = 99;
          } else {
            this.setCameraFocus(this.squirrel);
            this.overTheLine();
            this.timer = 60;
            this.step = 3;
          }
        }
        break;
      }
      case 3:
        this.timer -= Cs.tmod;
        if (this.timer < 0) { this.endGame(); this.step = 99; }
        break;
      default: break;
    }
  }
  landing(ant) {
    const score = Math.round((ant.x - 1400) * 10) / 10;
    this.scoreList.push(score);
    const mc = this.attachMeterLog(ant.x, ant.y, score + 'cm');
    for (let i = 0; i < this.meterLogList.length; i++) {
      const meterLog = this.meterLogList[i];
      if (meterLog.y === mc.y && Math.abs(meterLog.x - mc.x) < 100) { mc.y = meterLog.y - 36; i = 0; }
    }
    this.meterLogList.push(mc);
    const obj = this.newDecor('spBadsAnt', { x: ant.x, y: ant.y, depthCoef: 1 });
    ant.kill();
    this.camWaitList.push({ timer: 100, path: obj });
  }
  onTzRelease() { if (this.step === 1) this.step++; this.map.initRuler(this.launchPoint); }
  onTzLink() { this.step = 1; }
  overTheLine() {
    this.endPanelStart.push({ label: 'basic', list: [{ type: 'msg', title: 'Faute!', msg: "Vous devez lacher les fourmis avant que l'une d'entre elle ne franchisse la ligne !" }] });
  }
  getEndPanelObj(statList) {
    return { list: [
      { type: 'margin', value: 8 },
      { type: 'littleScore', title: 'fourmi numero 1 :', score: this.scoreList[0] + 'cm' },
      { type: 'littleScore', title: 'fourmi numero 2 :', score: this.scoreList[1] + 'cm' },
      { type: 'littleScore', title: 'fourmi numero 3 :', score: this.scoreList[2] + 'cm' },
      { type: 'littleScore', title: 'fourmi numero 4 :', score: this.scoreList[3] + 'cm' },
      { type: 'bigScore', frame: 1, score: this.score + 'cm' },
      { type: 'bigScore', frame: 2, score: this.card.$max + 'cm' },
      { type: 'margin', value: 10 },
      graphBarre(statList, 150),
    ] };
  }
  updateResult(player) { this.resultatIA(player, [[34000, 10000], [38000, 6000], [40000, 4000], [31000, 12000], [34000, 16000]], 3); }
}
K.registerClass('gameAntLaunch', AntLaunch);

// ── Plant (plantapomme) ───────────────────────────────────────────────────
class Plant extends Trial {
  constructeur() { super.constructeur(); this.plantPoint = 350; this.zoneRay = 24; this.distanceMax = 50; this.shotMax = 3; this.init(); }
  init() {
    this.type = '$plant';
    this.trialId = 5;
    this.mapInfo = { skinLink: this.mng.client.getFileInfos('map/olympic_a.swf').name, width: 700, height: 480, groundLabel: 'grassMountain' };
    super.init();
    this.scoreList = [];
    this.step = 0;
    this.initScroller();
  }
  initGame() { super.initGame(); this.shot = this.shotMax; this.distance = this.distanceMax; }
  initStartPanel() { super.initStartPanel(); this.startPanel.toRead = 2; }
  initSprites() {
    super.initSprites();
    this.genTzongre();
    this.genGroundFruit();
    const y = this.map.height - this.map.groundLevel;
    const obj = this.newDecor('decorPiquetPlant', { x: this.plantPoint, y });
    this.piquet = obj.path;
    this.piquet.p._y = -this.distanceMax;
    this.picPos = { x: this.plantPoint, y: y - this.distanceMax };
    this.newDecor('decorFrontPiquet', { x: this.plantPoint, y: Cs.mch, depthCoef: 1.01 });
  }
  genTzongre() {
    const initObj = this.tzongreInfo;
    initObj.x = Cs.mcw / 2; initObj.y = Cs.mch / 2; initObj.vity = -4; initObj.flLauncher = true;
    this.tzongre = this.newTzongre(initObj);
    this.tzongre.endUpdate();
  }
  genGroundFruit() {
    const w = 1.4;
    const r = w * 12;
    this.fruit = this.newFruit({ x: r + random(Cs.mcw - (2 * r)), weight: w });
    this.fruit.y = this.map.height - (this.map.groundLevel + this.fruit.ray);
    this.fruit.endUpdate();
  }
  update() {
    super.update();
    switch (this.step) {
      case 1: {
        const y = this.fruit.y + this.fruit.ray;
        if (this.fruit.vity > 1 && y > this.picPos.y && (y - this.fruit.vity * Cs.tmod) < this.picPos.y) {
          const dif = this.fruit.x - this.picPos.x;
          if (Math.abs(dif) < this.zoneRay) this.hitPiquet(dif);
        }
        break;
      }
      case 2:
        this.waitTimer -= Cs.tmod;
        if (this.waitTimer < 0) {
          this.score = 0;
          for (let i = 0; i < this.shotMax; i++) this.score += this.scoreList[i];
          this.addScore();
          this.endGame();
          this.step = 99;
        }
        break;
      default: break;
    }
  }
  hitPiquet(dif) {
    this.fruit.vity *= -1;
    let p = Math.max((this.fruit.getPower() - Math.abs(dif)), 0) / 2.8;
    p *= 1.4;
    p = Math.min(p, this.distance);
    this.scoreList.push(Math.round(p * 10) / 10);
    this.distance -= p;
    this.piquet.p._y = -this.distance;
    this.piquet._rotation += p * dif / 50;
    const a = (this.piquet._rotation - 90) * (Math.PI / 180);
    this.picPos.x = this.piquet.x + Math.cos(a) * this.distance;
    this.picPos.y = this.piquet.y + Math.sin(a) * this.distance;
    this.shot--;
    this.scorePanel.setScore(this.shot);
    if (this.shot > 0) this.step = 0;
    else { this.step = 2; this.waitTimer = 100; }
    this.tzongre.release();
  }
  onTzLink() {
    if (this.step === 0) {
      this.step = 1;
      if (this.scorePanel == null) { this.scorePanel = this.infoBar.addElement('barScore'); this.scorePanel.setScore(this.shot); }
    }
  }
  onTzRelease() {}
  getEndPanelObj(statList) {
    return { list: [
      { type: 'margin', value: 8 },
      { type: 'littleScore', title: '1er coup :', score: this.scoreList[0] + 'cm' },
      { type: 'littleScore', title: '2eme coup :', score: this.scoreList[1] + 'cm' },
      { type: 'littleScore', title: '3eme coup :', score: this.scoreList[2] + 'cm' },
      { type: 'bigScore', frame: 1, score: this.score + 'cm' },
      { type: 'bigScore', frame: 2, score: this.card.$max + 'cm' },
      { type: 'margin', value: 10 },
      graphBarre(statList, 150),
    ] };
  }
  updateResult(player) { this.resultatIA(player, [[80, 180], [120, 120], [40, 120], [160, 200], [60, 300]]); }
}
K.registerClass('gamePlant', Plant);

// ── CaterPlant (planter de vers) ──────────────────────────────────────────
class CaterPlant extends Trial {
  constructeur() { super.constructeur(); this.plantPoint = 350; this.zoneRay = 145; this.init(); }
  init() {
    this.type = '$caterPlant';
    this.trialId = 3;
    this.mapInfo = { skinLink: this.mng.client.getFileInfos('map/olympic_a.swf').name, width: 700, height: 480, groundLabel: 'grassMountain' };
    super.init();
    this.step = 0;
    this.initScroller();
  }
  initStartPanel() { super.initStartPanel(); this.startPanel.toRead = 4; }
  initSprites() {
    super.initSprites();
    this.genTzongre();
    this.genCaterpillar(-1);
    this.genSquirrelJudge(this.plantPoint + this.zoneRay + 130);
    this.squirrel.focus = this.tzongre;
    this.newDecor('decorFrontPiquet', { x: this.plantPoint, y: Cs.mch, depthCoef: 1.01 });
  }
  genTzongre() {
    const initObj = this.tzongreInfo;
    initObj.x = Cs.mcw / 2; initObj.y = Cs.mch / 2; initObj.vity = -4; initObj.flLauncher = true;
    this.tzongre = this.newTzongre(initObj);
    this.tzongre.endUpdate();
  }
  genCaterpillar(side) {
    const mc = this.newCaterpillar();
    if (side == null) side = random(2) * 2 - 1;
    const w = this.map.width / 2;
    mc.x = w + (w + 10) * side;
    mc.y = this.map.height - this.map.groundLevel;
    mc.setSens(-side);
    mc.endUpdate();
    this.cater = mc;
    return mc;
  }
  update() {
    super.update();
    switch (this.step) {
      case 3:
        this.waitTimer -= Cs.tmod;
        if (this.waitTimer < 0) { this.attachMeterLog(this.cater.x, this.cater.y, this.score + 'cm'); this.step = 5; this.waitTimer = 120; }
        break;
      case 5:
        this.waitTimer -= Cs.tmod;
        if (this.waitTimer < 0) { this.step = 99; this.endGame(); }
        break;
      default: break;
    }
  }
  onTzRelease(tzongre) { this.setCameraFocus(tzongre.linkList[0]); if (this.step === 1) this.step++; }
  onTzLink() { this.step = 1; this.squirrel.focus = this.cater; }
  getEndPanelObj(statList) {
    return { list: [
      { type: 'bigScore', frame: 5, score: this.score1 + 'cm' },
      { type: 'bigScore', frame: 6, score: this.score2 + 'cm' },
      { type: 'bigScore', frame: 1, score: this.score + 'cm' },
      { type: 'bigScore', frame: 2, score: this.card.$max + 'cm' },
      { type: 'margin', value: 1 },
      graphBarre(statList, 170),
    ] };
  }
  onCaterCrash(power) {
    const dif = Math.abs(this.cater.x - this.plantPoint);
    if (dif < this.zoneRay) {
      this.score1 = Math.round(power * 25) / 10;
      this.score2 = Math.round((1 - (dif / this.zoneRay)) * 1000) / 10;
      this.score = this.score1 + this.score2;
      this.addScore();
      this.squirrel.setStatus(1);
      this.step = 3;
      this.waitTimer = 20;
    } else {
      this.squirrel.setStatus(0);
      this.step = 5;
      this.waitTimer = 40;
      this.endPanelStart.push({ label: 'basic', list: [{ type: 'msg', title: 'Hors-zone!', msg: 'La chenille doit etre plantée entre les deux piquets.' }] });
    }
    this.deActiveLink();
  }
  updateResult(player) { this.resultatIA(player, [[500, 500], [300, 500], [500, 200], [450, 500], [0, 1000]], 1.5); }
}
K.registerClass('gameCaterPlant', CaterPlant);

// ── DexFruit (dextéripomme) ───────────────────────────────────────────────
class DexFruit extends Trial {
  constructeur() { super.constructeur(); this.launchPoint = 1400; this.minPoint = 1500; this.panAccel = 1; this.init(); }
  init() {
    this.type = '$dexFruit';
    this.trialId = 1;
    this.mapInfo = { skinLink: this.mng.client.getFileInfos('map/olympic_a.swf').name, scrollerInfo: { height: 30 }, groundLabel: 'olympic', width: 10000, height: 480 };
    super.init();
    this.flPanPressLeft = false;
    this.flPanPressRight = false;
    this.initScroller();
  }
  initSprites() {
    super.initSprites();
    this.genPanier();
    this.panier.x = this.minPoint;
    this.panier.y = this.map.height - (this.map.groundLevel + 90);
    this.setCameraFocus(this.panier);
    this.moveMap(false);
    this.map.update();
    this.panier.endUpdate();
    this.genSquirrelJudge(this.launchPoint);
    this.squirrel.focus = this.panier;
  }
  startGame() {
    // Pas de tzongre encore : on la crée quand le panier est placé (touche fil).
    this.masterStep = 1;
    this.attachMovie('panierCompteur', 'panCompt', this.dp_panier + 1, { _x: this.panier._x, _y: this.panier._y });
    this.step = 10;
  }
  initStartPanel() { super.initStartPanel(); this.startPanel.toRead = 2; }
  genGroundFruit() {
    this.fruit = this.newFruit({ x: 200, weight: 1 });
    this.fruit.y = this.map.height + this.map.groundLevel - this.fruit.ray;
    this.fruit.endUpdate();
  }
  genTzongre() {
    const initObj = this.tzongreInfo;
    initObj.x = Cs.mcw / 2; initObj.y = Cs.mch / 2; initObj.vity = -4; initObj.flLauncher = true;
    this.tzongre = this.newTzongre(initObj);
    this.tzongre.unFreeze();
    this.setCameraFocus(this.tzongre);
  }
  update() {
    if (this.step === 10) {
      // La partie n'a pas de tzongre : on ne joue que la caméra, la carte et le panier.
      if (this.flFading) this.fade();
      if (this.camFocus != null) this.moveMap(true);
      this.map.update();
      this.fil.clear();
      this.frict = Math.pow(this.friction, Cs.tmod);
      this.groundFrict = Math.pow(this.groundFriction, Cs.tmod);
      this.panier.update();
      for (const b of this.badList) b.update();
      for (const d of this.decorList) this.updateDecor(d);
      this.movePanier();
      if (this.step === 10) {
        this.panCompt._x = this.panCompt._x * 0.8 + this.panier._x * 0.2;
        this.panCompt._y = this.panCompt._y * 0.8 + this.panier._y * 0.2;
        this.scoreTarget = Math.round((this.panier.x - this.launchPoint));
        this.panCompt.field.text = this.scoreTarget + ' cm';
      }
      return;
    }
    super.update();
    switch (this.step) {
      case 1:
        if (this.squirrel.status == null && this.fruit.x > this.launchPoint) {
          this.squirrel.setStatus(0);
          this.flValidate = false;
          this.endPanelStart.push({ label: 'basic', list: [{ type: 'msg', title: 'Faute !', msg: 'Vous avez dépassé la ligne de lancé' }] });
        }
        break;
      case 2:
        if (this.squirrel.status == null && this.fruit.x > this.launchPoint) { this.squirrel.setStatus(1); this.flValidate = true; }
        if (this.fruit.flGround) this.miss();
        break;
      case 3:
        this.timer -= Cs.tmod;
        if (this.timer < 0) { this.endGame(); this.step = 99; }
        break;
      default: break;
    }
  }
  movePanier() {
    if (Key.isDown(this.mng.pref.$key[1]) || this.flPanPressLeft) {
      this.panier.vitx -= this.panAccel * Cs.tmod;
      this.panCompt.f1.gotoAndPlay(10);
      this.panCompt.f2.gotoAndPlay(1);
    }
    if (Key.isDown(this.mng.pref.$key[2]) || this.flPanPressRight) {
      this.panier.vitx += this.panAccel * Cs.tmod;
      this.panCompt.f1.gotoAndPlay(1);
      this.panCompt.f2.gotoAndPlay(10);
    }
    if (Key.isDown(this.mng.pref.$key[4])) {
      this.step = 0;
      this.genTzongre();
      this.setCameraFocus(this.tzongre);
      this.squirrel.focus = this.tzongre;
      this.panCompt.removeMovieClip();
      this.genGroundFruit();
    }
    if (this.panier.x < this.launchPoint + 100) { this.panier.vitx *= -1; this.panier.x = this.launchPoint + 100; }
    if (this.panier.compt) this.panier.compt._rotation = -this.panier._rotation;
  }
  miss() {
    this.step = 3;
    this.timer = 60;
    this.endPanelStart.push({ label: 'basic', list: [{ type: 'msg', title: 'Perdu !', msg: " Vous n'avez pas réussi atteindre le panier" }] });
  }
  onTzRelease() {
    this.setCameraFocus(this.tzongre.linkList[0]);
    if (this.step === 1) { this.step++; this.map.initRuler(this.launchPoint); }
    this.flLinkActive = false;
  }
  onTzLink() { this.step = 1; }
  onAddFruit() {
    this.setCameraFocus(this.panier);
    if (this.flValidate) { this.score = this.scoreTarget; this.addScore(); }
    this.timer = 50;
    this.step = 3;
  }
  getEndPanelObj(statList) {
    return { list: [
      { type: 'bigScore', frame: 1, score: this.score + 'cm' },
      { type: 'bigScore', frame: 2, score: this.card.$max + 'cm' },
      { type: 'margin', value: 15 },
      graphBarre(statList, 230),
    ] };
  }
  // Nalika (2) : le `case` de 2005 n'a pas de break et tombe dans celui de
  // Gomola — c'est donc la formule de Gomola qu'elle joue, comme à l'époque.
  updateResult(player) { this.resultatIA(player, [[500, 600], [1000, 400], [1600, 800], [1600, 800], [300, 1600]], 1, { 0: 8, 1: 2, 2: 2, 3: 2, 4: 4 }); }
}
K.registerClass('gameDexFruit', DexFruit);

// ── FrogRun (course de grenouilles) ───────────────────────────────────────
class FrogRun extends Trial {
  constructeur() { super.constructeur(); this.startPoint = 1400; this.fullTime = 40000; this.init(); }
  init() {
    this.type = '$frogRun';
    this.trialId = 6;
    this.mapInfo = { skinLink: this.mng.client.getFileInfos('map/olympic_a.swf').name, scrollerInfo: { height: 30 }, groundLabel: 'olympic', width: 10000, height: 480 };
    super.init();
    this.step = 0;
    this.initScroller();
  }
  initStartPanel() { super.initStartPanel(); this.startPanel.toRead = 3; }
  startGame() { this.initTimer(); super.startGame(); }
  initTimer() {
    this.barTimer = this.infoBar.addElement('barTimer');
    this.barTimer.setTimer(this.fullTime);
    this.endTime = K.getTimer() + this.fullTime;
  }
  initSprites() { super.initSprites(); this.genTzongre(); this.genFrog(); this.frog.focus = this.tzongre; }
  genFrog() {
    this.frog = this.newFrog({ x: this.startPoint, y: this.map.height - this.map.groundLevel, mobilite: 1000 });
    this.frog.endUpdate();
  }
  genTzongre() {
    const initObj = this.tzongreInfo;
    initObj.x = this.startPoint + 1; initObj.y = Cs.mch / 2; initObj.vity = -4; initObj.flLauncher = true;
    this.tzongre = this.newTzongre(initObj);
    this.setCameraFocus(this.tzongre);
    this.moveMap(false);
    this.map.update();
    this.tzongre.endUpdate();
  }
  update() {
    super.update();
    if (this.masterStep === 1) {
      switch (this.step) {
        case 0:
          this.timer = this.endTime - K.getTimer();
          if (this.timer > 0) this.barTimer.setTimer(this.timer);
          else { this.barTimer.setTimer(0); this.step = 1; }
          break;
        case 1:
          if (this.frog.step === 0 || this.frog.step === 1) {
            this.step = 99;
            this.score = Math.round((this.frog.x - 1400) * 10) / 10;
            this.addScore();
            this.endGame();
          }
          break;
        default: break;
      }
    }
  }
  onTzDeath() { super.onTzDeath(); this.step = 99; this.endGame(70); }
  getEndPanelObj(statList) {
    return { list: [
      { type: 'bigScore', frame: 1, score: this.score + 'cm' },
      { type: 'bigScore', frame: 2, score: this.card.$max + 'cm' },
      { type: 'margin', value: 15 },
      graphBarre(statList, 230),
    ] };
  }
  updateResult(player) { this.resultatIA(player, [[20000, 10000], [24000, 12000], [32000, 4000], [15000, 14000], [10000, 36000]], 1, { 0: 10, 1: 5, 2: 50, 3: 8, 4: 200 }); }
}
K.registerClass('gameFrogRun', FrogRun);

/* ── Bac à sable — le mode d'ESSAI ────────────────────────────────────────
 *
 * Un mode qui ne compte pas : aucun score envoyé, aucune fiche écrite, aucun
 * Fruit Défendu consommé. Il sert à VOIR le portage se comporter — les huit
 * papillons, les fourmis, les vers, l'écureuil, la grenouille, le corbeau —
 * sans devoir jouer une vraie partie pour les faire venir.
 *
 * Ce n'est PAS un mode d'époque : le jeu de 2005 n'en avait pas. Il ne
 * paraît au menu que si l'administration l'a ouvert (data/kaluga-bac.json,
 * servi par /api/kaluga/bac), et il emprunte au Challenge tout ce qui fait
 * naître les bestioles — mêmes classes, mêmes positions, même physique :
 * ce qu'on observe ici est ce qui se passe en partie.
 *
 * Deux façons de peupler :
 *   · la POPULATION DE DÉPART, réglée depuis le panneau d'administration ;
 *   · les TOUCHES, pendant la partie — 1 à 8 pour les huit papillons,
 *     9 une pomme, 0 une pomme d'or, F fourmi, V ver, E écureuil,
 *     G grenouille, C corbeau.
 *
 * Le clavier a deux contraintes. P et ÉCHAP sont la PAUSE du jeu
 * (Manager.update) : aucune touche d'ici ne doit s'y poser. Et les lettres
 * choisies (C, E, F, G, V) gardent leur place entre AZERTY et QWERTY, comme
 * la rangée des chiffres — ce qui n'est le cas ni de A, ni de Z, ni de M.
 */
const BAC_CARTES = {
  challenge: { sol: 'challenge', feuillage: 'challenge', porte: true },
  forest: {},
  field: { sol: 'field' },
  mordor: { sol: 'empty' },
};
// Les huit papillons, dans l'ordre de Tzongre.catchButterFly.
const BAC_PAPILLONS = ['Multi', 'Chaîne', 'Puissance', 'Armure', 'Super',
  'Pluie de pommes', 'Pommes en moins', 'Pousse'];
const BAC_TOUCHES = {
  49: ['papillon', 0], 50: ['papillon', 1], 51: ['papillon', 2], 52: ['papillon', 3],
  53: ['papillon', 4], 54: ['papillon', 5], 55: ['papillon', 6], 56: ['papillon', 7],
  57: ['pomme'], 48: ['or'],
  70: ['fourmi'], 86: ['ver'], 69: ['ecureuil'], 71: ['grenouille'], 67: ['corbeau'],
};

class BacASable extends Classic {
  init() {
    this.type = '$bac';
    const bac = this.bac || {};
    this.carte = BAC_CARTES[bac.carte] ? bac.carte : 'challenge';
    const decor = BAC_CARTES[this.carte];
    this.mapInfo = {
      skinLink: this.mng.client.getFileInfos('map/' + this.carte + '.swf').name,
      width: 700, height: 480,
    };
    if (decor.sol) this.mapInfo.groundLabel = decor.sol;
    this.initOptionProba();
    // Classic.init impose la carte du Challenge : on va droit à Game.init.
    J.Game.prototype.init.call(this);
    this.step = 0;
    // Rien de cet essai ne doit atteindre la fruticard : le verrou d'écriture
    // du slot 0 est celui du client d'époque, que saveSlot respecte.
    this.mng.client.lockList[0] = true;
  }
  initDefault() {
    super.initDefault();
    if (this.bac == null) this.bac = {};
    // Les pommes ne retombent de l'arbre que si on l'a demandé : un bac
    // tranquille vaut mieux pour observer une bestiole en particulier.
    this.flFruitFalling = !!this.bac.chute;
  }
  initGame() {
    J.Game.prototype.initGame.call(this);
    const decor = BAC_CARTES[this.carte];
    if (decor.feuillage) this.initFeuillage(decor.feuillage);
  }
  // PAS de panneau de départ : un bac s'ouvre et l'on joue. Ceux du SWF
  // portent tous leur consigne — dessinée (le Challenge, sur deux pages) ou
  // dans un champ d'une seule ligne (le Chrono) : la nôtre en fait trois et
  // n'y entrerait pas. Elle est posée à l'écran par `afficherAide`.
  initStartPanel() { this.fadeTo(0, { obj: this, method: 'startGame' }); }
  initSprites() {
    J.Game.prototype.initSprites.call(this);
    this.genPanier();
    const bac = this.bac;
    for (let i = 0; i < (bac.pommes | 0); i++) this.genGroundFruit();
    if (bac.or) this.genPommeOr();
    for (const id of (Array.isArray(bac.papillons) ? bac.papillons : [])) this.genButterfly(id);
    for (let i = 0; i < (bac.fourmis | 0); i++) this.genAnt();
    for (let i = 0; i < (bac.vers | 0); i++) this.genCaterpillar();
    for (let i = 0; i < (bac.ecureuils | 0); i++) this.genSquirrel();
    // Grenouilles et corbeaux visent la tzongre : ils attendent qu'elle soit là.
    this.aVenir = { grenouilles: bac.grenouilles | 0, corbeaux: bac.corbeaux | 0 };
  }
  startGame() {
    this.masterStep = 1;
    this.kilo = 0;
    this.initScroller();
    this.kiloPanel.setCoef(0);
    this.afficherAide();
    // La porte n'existe que sur la carte du Challenge : ailleurs, la tzongre
    // entre par le milieu du ciel.
    const porte = this.map.bg && this.map.bg.animPorte;
    if (porte) { porte.play(); this.step = 1; } else { this.entrerTzongre(); }
    this.toucheListener = { jeu: this };
    this.toucheListener.onKeyDown = function () { this.jeu.surTouche(Key.getCode()); };
    Key.addListener(this.toucheListener);
  }
  // La légende des touches, posée EN BAS pour toute la partie : en haut à
  // gauche passent les messages du jeu (« Multi up! »), en haut à droite la
  // barre de score. Le bandeau ne conviendrait pas pour la porter : son champ
  // est taillé pour deux mots, pas pour trois lignes.
  afficherAide() {
    const champ = this.createTextField('aide', this.dp_debugDraw + 1, 8, Cs.mch - 46, 480, 44);
    champ.multiline = true;
    champ.selectable = false;
    champ.text = 'BAC À SABLE — rien de cette partie ne compte\n'
      + '1 à 8 : les papillons  ·  9 : une pomme  ·  0 : une pomme d’or\n'
      + 'F fourmi  ·  V ver  ·  E écureuil  ·  G grenouille  ·  C corbeau';
    champ.setTextFormat({ font: 'Verdana', size: 10, color: 0xFFFFFF, bold: true });
  }
  entrerTzongre() {
    this.step = 2;
    this.genTzongre();
    this.tzongre.unFreeze();
    for (let i = 0; i < this.aVenir.grenouilles; i++) this.genFrog();
    for (let i = 0; i < this.aVenir.corbeaux; i++) this.genCorbeau();
  }
  genTzongre() {
    if (this.map.bg && this.map.bg.animPorte) { super.genTzongre(); return; }
    const initObj = this.tzongreInfo;
    initObj.x = Cs.mcw / 2; initObj.y = Cs.mch / 2; initObj.vity = -4;
    this.tzongre = this.newTzongre(initObj);
    this.tzongre.endUpdate();
  }
  update() {
    // On saute la montée en difficulté du Challenge (levelUp, corbeau
    // d'ambiance, fin de partie quand il ne reste plus de pomme) : ici la
    // population est celle qu'on a demandée, et rien d'autre.
    J.Game.prototype.update.call(this);
    if (this.step === 1 && this.map.bg.animPorte._currentframe > 70) this.entrerTzongre();
    if (this.step === 2 && this.flFruitFalling && this.fruitList.length < this.fruitBase) this.genTreeFruit();
  }
  genPommeOr() {
    const mc = this.newFruit({ x: 40 + random(Cs.mcw - 80), weight: 1.5, flGold: true });
    mc.y = this.map.height - (this.map.groundLevel + mc.ray);
    mc.endUpdate();
    return mc;
  }
  genCorbeau() { return this.newBird({ hitPoint: 40 }); }
  // Ce que fait naître une touche — et la population de départ.
  poser(quoi, id) {
    switch (quoi) {
      case 'papillon': return this.genButterfly(id == null ? random(8) : id);
      case 'fourmi': return this.genAnt();
      case 'ver': return this.genCaterpillar();
      case 'ecureuil': return this.genSquirrel();
      case 'grenouille': return this.genFrog();
      case 'corbeau': return this.genCorbeau();
      case 'pomme': return this.genGroundFruit();
      case 'or': return this.genPommeOr();
      default: return undefined;
    }
  }
  surTouche(code) {
    if (this.masterStep !== 1 || this.step !== 2 || this.flEndingGame) return;
    const ordre = BAC_TOUCHES[code];
    if (!ordre) return;
    this.poser(ordre[0], ordre[1]);
  }
  // La fin d'un essai : le panneau, ses statistiques, et rien d'envoyé.
  initEndGame(timer) {
    if (timer == null) timer = 0;
    this.endTimer = timer;
    this.flEndingGame = true;
    this.scoreSaved();
  }
  scoreSaved() {
    let name = '', score = '';
    name += '<b>Général:</b>\n'; score += '\n';
    name += this.stat.getList('name'); score += this.stat.getList('score');
    name += '<b>Combo:</b>\n'; score += '\n';
    name += this.statCombo.getList('name'); score += this.statCombo.getList('score');
    this.endPanelMiddle.push({ list: [
      { type: 'bigScore', frame: 1, score: this.score },
      { type: 'stats', box: { x: 82, y: 16, w: 280, h: 200 }, name, score },
    ] });
  }
  reset() { super.reset({ bac: this.bac }); }
  kill() {
    if (this.toucheListener) Key.removeListener(this.toucheListener);
    this.mng.client.lockList[0] = false;
    super.kill();
  }
}
J.BacASable = BacASable;
K.registerClass('gameBac', BacASable);

})(typeof window !== 'undefined' ? window : globalThis);
