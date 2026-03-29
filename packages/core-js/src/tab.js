const { Slot } = require('./slot');

/**
 * Runtime JS mirror for Tab module.
 */
class Tab extends Slot {
  init(slotList, depth, flGo = false) {
    super.init(slotList, depth, flGo);
  }

  addBox(box) {
    if (this.nbBox === 0) {
      super.addBox(box);
      return true;
    }
    return false;
  }

  rmBox(box) {
    super.rmBox(box);
    this.cleanDepths();
    if (this.nbBox === 0) this.close();
  }
}

module.exports = {
  Tab,
};
