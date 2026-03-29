const test = require('node:test');
const assert = require('node:assert/strict');

const { Tab } = require('../../packages/core-js/src/tab');

function makeBox(name) {
  return {
    name,
    initCalls: [],
    setDepthCalls: [],
    init(...args) { this.initCalls.push(args); },
    setDepth(depth) { this.setDepthCalls.push(depth); },
    onActivate() {},
    onDeactivate() {},
    onSlotActivate() {},
    onSlotDeactivate() {},
    tryToClose() {},
  };
}

test('Tab accepts only one box', () => {
  const removed = [];
  const tab = new Tab();
  tab.init({ activate() {}, rmSlot(slot) { removed.push(slot); } }, 50, false);

  const box1 = makeBox('b1');
  const box2 = makeBox('b2');

  assert.equal(tab.addBox(box1), true);
  assert.equal(tab.nbBox, 1);
  assert.equal(tab.addBox(box2), false);
  assert.equal(tab.nbBox, 1);
});

test('Tab rmBox compacts depth and closes when empty', () => {
  const removed = [];
  const tab = new Tab();
  tab.init({ activate() {}, rmSlot(slot) { removed.push(slot); } }, 10, false);

  const box = makeBox('b1');
  tab.addBox(box);

  tab.rmBox(box);
  assert.equal(tab.nbBox, 0);
  assert.equal(tab.flClose, true);
  assert.equal(removed.length, 1);
});
