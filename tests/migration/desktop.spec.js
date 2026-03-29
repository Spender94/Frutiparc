const test = require('node:test');
const assert = require('node:assert/strict');

const { Desktop } = require('../../packages/core-js/src/desktop');

test('Desktop initializes with empty iconList', () => {
  const desktop = new Desktop();
  assert.deepEqual(desktop.iconList, []);
});

test('Desktop.init forwards args to SlotBase and resets iconList', () => {
  const desktop = new Desktop();
  desktop.iconList.push('old-icon');

  const slotList = ['a', 'b'];
  desktop.init(slotList, 42, true);

  assert.equal(desktop.lastInitSlotList, slotList);
  assert.equal(desktop.lastInitDepth, 42);
  assert.equal(desktop.lastInitFlGo, true);
  assert.deepEqual(desktop.iconList, []);
});
