/**
 * Runtime JS mirror for Lot A follow-up SlotList.
 */
class SlotList {
  static depths = {
    slotList: {
      start: 0,
      dst: 1,
      max: 50,
    },
  };

  constructor() {
    this.arr = [];
    this.depth = -1;
    this.activeSlot = undefined;
  }

  init() {
    this.arr = [];
  }

  addSlot(slot, flGo = false) {
    const d = this.getNextDepth();
    this.arr[d] = slot;
    slot.init(this, SlotList.depths.slotList.start + SlotList.depths.slotList.dst * d, flGo);
  }

  rmSlot(slot) {
    const id = this.arr.indexOf(slot);
    if (id > -1) {
      this.arr[id] = undefined;
      if (this.activeSlot === slot) this.activeSlot = undefined;
      return true;
    }
    return false;
  }

  getNextDepth() {
    if (this.depth + 1 > (SlotList.depths.slotList.max - SlotList.depths.slotList.start)) {
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
        this.arr[i].setDepth(SlotList.depths.slotList.start + SlotList.depths.slotList.dst * i);
      }
    }
  }

  putOnTop(slot) {
    const id = this.arr.indexOf(slot);
    if (id > -1) {
      this.arr[id] = undefined;
      const d = this.getNextDepth();
      this.arr[d] = slot;
      slot.setDepth(SlotList.depths.slotList.start + SlotList.depths.slotList.dst * d);
    }
  }

  activate(slot) {
    if (slot === undefined) return false;
    if (this.activeSlot === slot) return false;
    if (slot.flClose) return false;

    if (this.activeSlot !== undefined) this.activeSlot.onDeactivate();

    this.activeSlot = slot;
    this.activeSlot.onActivate();
    return true;
  }
}

module.exports = {
  SlotList,
};
