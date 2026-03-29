/**
 * Runtime JS mirror for Lot A follow-up WinBox.
 */
class WinBox {
  constructor() {
    this.initialized = false;
    this.slot = undefined;
    this.depth = undefined;
    this.flShow = false;
    this.flActive = false;
    this.wasShow = false;
    this.title = undefined;
    this.flClosed = false;
    this.window = undefined;
    this.mode = undefined;
  }

  preInit() {
    if (this.title === undefined) this.title = '';
  }

  init(slot, depth) {
    const rs = !this.initialized;
    if (rs) this.preInit();

    this.initialized = true;
    this.slot = slot;
    this.depth = depth;
    this.flShow = true;

    return rs;
  }

  setDepth(depth) {
    this.depth = depth;
  }

  close() {
    this.slot.rmBox(this);
    this.flClosed = true;
  }

  tryToClose() {
    this.close();
  }

  hide() {
    this.flShow = false;
  }

  show() {
    this.flShow = true;
  }

  onActivate() {
    this.flActive = true;
  }

  onDeactivate() {
    this.flActive = false;
  }

  onSlotActivate() {
    if (this.wasShow) this.show();
    this.wasShow = false;
  }

  onSlotDeactivate() {
    if (this.flShow) {
      this.wasShow = true;
      this.hide();
    } else {
      this.wasShow = false;
    }
  }

  activate() {
    this.slot.activate(this);
  }

  move(newSlot) {
    if (this.slot === newSlot) return false;

    this.slot.move(this, newSlot);
    return true;
  }

  setTitle(t) {
    this.title = t;
  }
}

module.exports = {
  WinBox,
};
