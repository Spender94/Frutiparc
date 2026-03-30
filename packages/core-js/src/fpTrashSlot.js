const { Slot } = require('./slot');

/**
 * Runtime JS mirror for frutiparc/FPTrashSlot.as.
 */
class FPTrashSlot extends Slot {
  constructor() {
    super();
    this.title = 'trash';
  }

  addBox(box) {
    box.mode = 'trash';
    super.addBox(box);
  }
}

module.exports = {
  FPTrashSlot,
};
