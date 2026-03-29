/**
 * Runtime JS mirror for Lot A follow-up Slot.
 */
class Slot {
  static depths = {
    boxList: {
      start: 0,
      dst: 1,
      max: 100,
    },
  };

  constructor() {
    this.slotList = undefined;
    this.arr = [];
    this.nbBox = 0;
    this.flActive = false;
    this.baseDepth = 0;
    this.depth = -1;
    this.activeBox = null;
    this.title = undefined;
    this.flWarning = false;
    this.flDesktopable = false;
    this.flClose = false;
  }

  init(slotList, baseDepth, flGo = false) {
    this.arr = [];
    this.slotList = slotList;
    this.baseDepth = baseDepth;

    if (flGo) this.slotList.activate(this);
  }

  setDepth(baseDepth) {
    this.baseDepth = baseDepth;
    this.cleanDepths();
  }

  addBox(box) {
    const d = this.getNextDepth();
    this.arr[d] = box;
    this.nbBox += 1;
    box.init(this, this.baseDepth + Slot.depths.boxList.start + Slot.depths.boxList.dst * d);
    this.activate(box);
    this.onBoxListChanged();
  }

  rmBox(box) {
    const id = this.arr.indexOf(box);
    if (id > -1) {
      this.arr[id] = undefined;
      this.nbBox -= 1;
      this.onBoxListChanged();
    }
  }

  getNextDepth() {
    if (this.depth + 1 > (Slot.depths.boxList.max - Slot.depths.boxList.start)) {
      this.cleanDepths();
    }
    this.depth += 1;
    return this.depth;
  }

  cleanDepths() {
    for (let i = 0; i < this.arr.length; i += 1) {
      if (this.arr[i] === undefined) {
        this.arr.splice(i, 1);
        i -= 1;
      } else {
        this.arr[i].setDepth(this.baseDepth + Slot.depths.boxList.start + Slot.depths.boxList.dst * i);
      }
    }
  }

  putOnTop(box) {
    const id = this.arr.indexOf(box);
    if (id > -1) {
      this.arr[id] = undefined;
      const d = this.getNextDepth();
      this.arr[d] = box;
      box.setDepth(this.baseDepth + Slot.depths.boxList.start + Slot.depths.boxList.dst * d);
    }
  }

  onBoxListChanged() {}

  close() {
    this.flClose = true;
    this.slotList.rmSlot(this);
  }

  tryToClose() {
    if (this.arr.length === 0) {
      this.close();
    } else {
      for (let i = 0; i < this.arr.length; i += 1) {
        if (this.arr[i] !== undefined) this.arr[i].tryToClose();
      }
    }
  }

  onActivate() {
    this.flActive = true;

    if (this.flWarning) this.onStopWarning();

    for (let i = 0; i < this.arr.length; i += 1) {
      if (this.arr[i] !== undefined) this.arr[i].onSlotActivate();
    }
  }

  onDeactivate() {
    this.flActive = false;
    for (let i = 0; i < this.arr.length; i += 1) {
      if (this.arr[i] !== undefined) this.arr[i].onSlotDeactivate();
    }
  }

  activate(box) {
    if (this.activeBox === box) return false;
    if (this.activeBox !== null) this.activeBox.onDeactivate();

    this.activeBox = box;
    this.putOnTop(box);
    this.activeBox.onActivate();
    return true;
  }

  move(box, newSlot) {
    this.rmBox(box);
    newSlot.addBox(box);
  }

  setTitle(t) {
    this.title = t;
  }

  warning() {
    if (this.flActive) return false;
    if (this.flWarning) return false;

    this.onWarning();
    return true;
  }

  onWarning() {
    if (this.flWarning) return false;

    this.flWarning = true;
    return true;
  }

  onStopWarning() {
    if (!this.flWarning) return false;

    this.flWarning = false;
    return true;
  }

  onStageResize() {}
}

module.exports = {
  Slot,
};
