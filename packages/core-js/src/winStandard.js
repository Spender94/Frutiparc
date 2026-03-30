const { Window } = require('./window');

/**
 * Runtime JS mirror for pragmatic WinStandard migration subset.
 */
class WinStandard extends Window {
  static env = {
    frameMode: false,
    mcw: 800,
    mch: 600,
    cornerX: 0,
    cornerY: 0,
    tmod: 1,
  };

  constructor() {
    super();
    this.pos = { x: 0, y: 0, w: 0, h: 0 };
    this.minimum = { w: 0, h: 0 };
    this.tab = { w: 0, h: 0 };
    this.box = { mode: 'desktop' };
    this.gel = 0;
    this.flResizable = undefined;
    this.flMoveAnim = undefined;
    this.flInterface = undefined;
    this.title = undefined;
    this.xScale = 100;
    this.yScale = 100;
    this.xPos = 0;
    this.yPos = 0;
  }

  init() {
    if (this.flInterface === undefined) this.flInterface = true;
    super.init();
    if (this.flResizable === undefined) this.flResizable = true;
    if (this.flMoveAnim === undefined) this.flMoveAnim = true;
  }

  update() {
    this.updateSize();
    this.updatePos();
  }

  updatePos() {
    if (this.box.mode === 'desktop') this.updateDeskPos();
    else if (this.box.mode === 'tab') this.updateTabPos();
  }

  updateSize() {
    if (this.box.mode === 'desktop') this.updateDeskSize();
    else if (this.box.mode === 'tab') this.updateTabSize();
  }

  updateDeskPos() {
    this.recal();
    this.moveToPos();
  }

  moveToPos() {
    this.xPos = this.pos.x;
    this.yPos = this.pos.y;
  }

  updateDeskSize() {
    this.minimum.w = Math.max(0, this.minimum.w);
    this.minimum.h = Math.max(0, this.minimum.h);
  }

  updateTabPos() {
    this.xPos = WinStandard.env.cornerX;
    this.yPos = WinStandard.env.cornerY;
  }

  updateTabSize() {
    this.tab.w = WinStandard.env.mcw - WinStandard.env.cornerX;
    this.tab.h = WinStandard.env.mch - WinStandard.env.cornerY;
  }

  recal() {
    if (WinStandard.env.frameMode) return false;

    const oldPos = { ...this.pos };

    this.pos.w = Math.max(Math.min(WinStandard.env.mcw - WinStandard.env.cornerX, this.pos.w), this.minimum.w);
    this.pos.h = Math.max(Math.min(WinStandard.env.mch - WinStandard.env.cornerY, this.pos.h), this.minimum.h);
    this.pos.x = Math.max(Math.min(this.pos.x, WinStandard.env.mcw - this.pos.w), WinStandard.env.cornerX);
    this.pos.y = Math.max(Math.min(this.pos.y, WinStandard.env.mch - this.pos.h), WinStandard.env.cornerY);

    return oldPos.x !== this.pos.x || oldPos.y !== this.pos.y || oldPos.w !== this.pos.w || oldPos.h !== this.pos.h;
  }

  resize(w, h) {
    this.pos.w = w;
    this.pos.h = h;
    this.recal();
    this.update();
  }

  onChangeMode() {
    if (this.box.mode === 'desktop') this.initDesktopMode();
    else this.initTabMode();
    this.update();
  }

  initDesktopMode() {}

  initTabMode() {}

  onStageResize() {
    this.update();
  }

  setTitle(title) {
    this.title = title;
  }

  gelatine() {
    this.gel = (this.gel + WinStandard.env.tmod * 10) % 628;
    this.xScale = 100 + Math.cos(this.gel / 100) * 4;
    this.yScale = 100 + Math.sin(this.gel / 100) * 4;
  }
}

module.exports = {
  WinStandard,
};
