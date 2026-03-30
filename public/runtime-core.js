/* Browser runtime mirrors extracted from packages/core-js/src for UI wiring */
class SlotList {
  static depths = { slotList: { start: 0, dst: 1, max: 50 } };
  constructor() { this.arr = []; this.depth = -1; this.activeSlot = undefined; }
  init() { this.arr = []; }
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
    if (this.depth + 1 > (SlotList.depths.slotList.max - SlotList.depths.slotList.start)) this.cleanDepths();
    this.depth += 1;
    return this.depth;
  }
  cleanDepths() {
    for (let i = 0; i < this.arr.length; i += 1) {
      if (this.arr[i] === undefined) { this.arr.splice(i, 1); i -= 1; }
      else this.arr[i].setDepth(SlotList.depths.slotList.start + SlotList.depths.slotList.dst * i);
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

class Slot {
  static depths = { boxList: { start: 0, dst: 1, max: 100 } };
  constructor() {
    this.slotList = undefined; this.arr = []; this.nbBox = 0; this.flActive = false;
    this.baseDepth = 0; this.depth = -1; this.activeBox = null; this.flClose = false;
  }
  init(slotList, baseDepth, flGo = false) { this.arr = []; this.slotList = slotList; this.baseDepth = baseDepth; if (flGo) this.slotList.activate(this); }
  setDepth(baseDepth) { this.baseDepth = baseDepth; this.cleanDepths(); }
  addBox(box) {
    const d = this.getNextDepth();
    this.arr[d] = box;
    this.nbBox += 1;
    box.init(this, this.baseDepth + Slot.depths.boxList.start + Slot.depths.boxList.dst * d);
    this.activate(box);
  }
  rmBox(box) {
    const id = this.arr.indexOf(box);
    if (id > -1) { this.arr[id] = undefined; this.nbBox -= 1; }
    this.cleanDepths();
    if (this.arr.filter(Boolean).length === 0) this.close();
  }
  getNextDepth() { if (this.depth + 1 > (Slot.depths.boxList.max - Slot.depths.boxList.start)) this.cleanDepths(); this.depth += 1; return this.depth; }
  cleanDepths() {
    for (let i = 0; i < this.arr.length; i += 1) {
      if (this.arr[i] === undefined) { this.arr.splice(i, 1); i -= 1; }
      else this.arr[i].setDepth(this.baseDepth + Slot.depths.boxList.start + Slot.depths.boxList.dst * i);
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
  close() { this.flClose = true; this.slotList.rmSlot(this); }
  onActivate() { this.flActive = true; this.arr.forEach((b) => b && b.onSlotActivate()); }
  onDeactivate() { this.flActive = false; this.arr.forEach((b) => b && b.onSlotDeactivate()); }
  activate(box) {
    if (this.activeBox === box) return false;
    if (this.activeBox !== null) this.activeBox.onDeactivate();
    this.activeBox = box;
    this.putOnTop(box);
    this.activeBox.onActivate();
    return true;
  }
  move(box, newSlot) { this.rmBox(box); newSlot.addBox(box); }
}

class WinBox {
  constructor() {
    this.initialized = false; this.slot = undefined; this.depth = undefined; this.flShow = false;
    this.flActive = false; this.wasShow = false; this.flClosed = false; this.title = undefined;
  }
  preInit() { if (this.title === undefined) this.title = ''; }
  init(slot, depth) {
    const rs = !this.initialized;
    if (rs) this.preInit();
    this.initialized = true; this.slot = slot; this.depth = depth; this.flShow = true;
    return rs;
  }
  setDepth(depth) { this.depth = depth; }
  close() { this.slot.rmBox(this); this.flClosed = true; }
  hide() { this.flShow = false; }
  show() { this.flShow = true; }
  onActivate() { this.flActive = true; }
  onDeactivate() { this.flActive = false; }
  onSlotActivate() { if (this.wasShow) this.show(); this.wasShow = false; }
  onSlotDeactivate() { if (this.flShow) { this.wasShow = true; this.hide(); } else this.wasShow = false; }
  activate() { this.slot.activate(this); }
  move(newSlot) { if (this.slot === newSlot) return false; this.slot.move(this, newSlot); return true; }
}

window.FrutiparcCore = { SlotList, Slot, WinBox };
