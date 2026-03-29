/**
 * Transitional base class mirroring the minimal Slot init contract.
 */
class SlotBase {
  constructor() {
    this.lastInitSlotList = null;
    this.lastInitDepth = null;
    this.lastInitFlGo = null;
  }

  init(slotList, depth, flGo) {
    this.lastInitSlotList = slotList;
    this.lastInitDepth = depth;
    this.lastInitFlGo = flGo;
  }
}

module.exports = {
  SlotBase,
};
