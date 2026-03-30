const test = require('node:test');
const assert = require('node:assert/strict');

const { FPTrashSlot } = require('../../packages/core-js/src/fpTrashSlot');

test('FPTrashSlot sets trash mode on added boxes', () => {
  const slot = new FPTrashSlot();

  const box = {
    init() {},
    setDepth() {},
    onActivate() {},
    onDeactivate() {},
    onSlotActivate() {},
    onSlotDeactivate() {},
    tryToClose() {},
  };

  slot.init({ activate() {}, rmSlot() {} }, 0, false);
  slot.addBox(box);

  assert.equal(slot.title, 'trash');
  assert.equal(box.mode, 'trash');
});
