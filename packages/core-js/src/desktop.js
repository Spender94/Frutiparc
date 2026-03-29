const { SlotBase } = require('./slotBase');

/**
 * Runtime JS mirror for Lot A target Desktop.
 */
class Desktop extends SlotBase {
  constructor() {
    super();
    this.iconList = [];
  }

  init(slotList, depth, flGo) {
    super.init(slotList, depth, flGo);
    this.iconList = [];
  }
}

module.exports = {
  Desktop,
};
