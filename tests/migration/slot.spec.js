const test = require('node:test');
const assert = require('node:assert/strict');

const { Slot } = require('../../packages/core-js/src/slot');

function makeBox(name) {
  return {
    name,
    initCalls: [],
    depthCalls: [],
    active: 0,
    deactive: 0,
    slotActive: 0,
    slotDeactive: 0,
    closeCalls: 0,
    init(...args) { this.initCalls.push(args); },
    setDepth(depth) { this.depthCalls.push(depth); },
    onActivate() { this.active += 1; },
    onDeactivate() { this.deactive += 1; },
    onSlotActivate() { this.slotActive += 1; },
    onSlotDeactivate() { this.slotDeactive += 1; },
    tryToClose() { this.closeCalls += 1; },
  };
}

test('Slot addBox/activate/rmBox lifecycle', () => {
  Slot.depths = { boxList: { start: 10, dst: 2, max: 20 } };

  const slot = new Slot();
  const listCalls = [];
  slot.init({ activate(s) { listCalls.push(s); }, rmSlot() {} }, 100, true);
  assert.equal(listCalls.length, 1);

  const a = makeBox('a');
  const b = makeBox('b');

  slot.addBox(a);
  slot.addBox(b);

  assert.deepEqual(a.initCalls[0], [slot, 110]);
  assert.deepEqual(b.initCalls[0], [slot, 114]);
  assert.equal(slot.nbBox, 2);
  assert.equal(a.deactive, 1);
  assert.equal(b.active, 1);

  slot.rmBox(a);
  assert.equal(slot.nbBox, 1);
});

test('Slot cleanDepths/putOnTop/move/update title', () => {
  Slot.depths = { boxList: { start: 0, dst: 5, max: 1 } };

  const slotA = new Slot();
  slotA.init({ activate() {}, rmSlot() {} }, 50, false);
  const slotB = new Slot();
  slotB.init({ activate() {}, rmSlot() {} }, 200, false);

  const a = makeBox('a');
  const b = makeBox('b');

  slotA.addBox(a);
  slotA.addBox(b); // triggers cleanDepths path due to max
  slotA.rmBox(a);
  slotA.cleanDepths();
  assert.equal(b.depthCalls.at(-1), 50);

  slotA.putOnTop(b);
  assert.equal(b.depthCalls.at(-1), 70);

  slotA.move(b, slotB);
  assert.equal(slotA.nbBox, 0);
  assert.equal(slotB.nbBox, 1);

  slotB.setTitle('Chat');
  assert.equal(slotB.title, 'Chat');
});

test('Slot warning/activate/deactivate/close flow', () => {
  const removed = [];
  const slot = new Slot();
  slot.init({ activate() {}, rmSlot(s) { removed.push(s); } }, 0, false);

  const box = makeBox('box');
  slot.addBox(box);

  assert.equal(slot.warning(), true);
  assert.equal(slot.warning(), false);

  slot.onActivate();
  assert.equal(slot.flWarning, false);
  assert.equal(box.slotActive, 1);

  slot.onDeactivate();
  assert.equal(box.slotDeactive, 1);

  slot.tryToClose();
  assert.equal(box.closeCalls, 1);

  slot.arr = [];
  slot.tryToClose();
  assert.equal(slot.flClose, true);
  assert.equal(removed.length, 1);
});
