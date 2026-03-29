const test = require('node:test');
const assert = require('node:assert/strict');

const { SlotList } = require('../../packages/core-js/src/slotList');

function makeSlot(name) {
  return {
    name,
    flClose: false,
    initCalls: [],
    depthCalls: [],
    activated: 0,
    deactivated: 0,
    init(...args) { this.initCalls.push(args); },
    setDepth(depth) { this.depthCalls.push(depth); },
    onActivate() { this.activated += 1; },
    onDeactivate() { this.deactivated += 1; },
  };
}

test('SlotList add/rm/init depth flow', () => {
  SlotList.depths = { slotList: { start: 100, dst: 10, max: 105 } };

  const list = new SlotList();
  list.init();

  const a = makeSlot('a');
  const b = makeSlot('b');

  list.addSlot(a, true);
  list.addSlot(b, false);

  assert.deepEqual(a.initCalls[0], [list, 100, true]);
  assert.deepEqual(b.initCalls[0], [list, 110, false]);
  assert.equal(list.rmSlot(a), true);
  assert.equal(list.rmSlot(a), false);
});

test('SlotList cleanDepths and putOnTop reorder depths', () => {
  SlotList.depths = { slotList: { start: 10, dst: 2, max: 11 } };

  const list = new SlotList();
  const a = makeSlot('a');
  const b = makeSlot('b');
  const c = makeSlot('c');

  list.addSlot(a, false);
  list.addSlot(b, false);
  list.addSlot(c, false); // triggers cleanDepths due to max

  list.rmSlot(b);
  list.cleanDepths();

  assert.equal(a.depthCalls.at(-1), 10);
  assert.equal(c.depthCalls.at(-1), 12);

  list.putOnTop(a);
  assert.equal(a.depthCalls.at(-1), 16);
});

test('SlotList activate switches active slot', () => {
  const list = new SlotList();
  const a = makeSlot('a');
  const b = makeSlot('b');

  assert.equal(list.activate(undefined), false);
  assert.equal(list.activate(a), true);
  assert.equal(list.activate(a), false);

  b.flClose = true;
  assert.equal(list.activate(b), false);
  b.flClose = false;

  assert.equal(list.activate(b), true);
  assert.equal(a.deactivated, 1);
  assert.equal(b.activated, 1);
});
