const test = require('node:test');
const assert = require('node:assert/strict');

const { WinBox } = require('../../packages/core-js/src/winBox');

test('WinBox init/preInit and visibility toggles', () => {
  const box = new WinBox();
  const slot = { rmBox() {}, activate() {}, move() {} };

  assert.equal(box.init(slot, 42), true);
  assert.equal(box.title, '');
  assert.equal(box.flShow, true);

  box.title = 'Persisted';
  assert.equal(box.init(slot, 50), false);
  assert.equal(box.title, 'Persisted');

  box.hide();
  assert.equal(box.flShow, false);
  box.show();
  assert.equal(box.flShow, true);
});

test('WinBox activate/deactivate and slot activation hooks', () => {
  const box = new WinBox();
  box.init({ rmBox() {}, activate() {}, move() {} }, 1);

  box.onActivate();
  assert.equal(box.flActive, true);
  box.onDeactivate();
  assert.equal(box.flActive, false);

  box.flShow = true;
  box.onSlotDeactivate();
  assert.equal(box.wasShow, true);
  assert.equal(box.flShow, false);

  box.onSlotActivate();
  assert.equal(box.wasShow, false);
  assert.equal(box.flShow, true);
});

test('WinBox delegates close/activate/move to slot', () => {
  const calls = [];
  const slotA = {
    rmBox(box) { calls.push(['rmBox', box]); },
    activate(box) { calls.push(['activate', box]); },
    move(box, newSlot) { calls.push(['move', box, newSlot]); },
  };
  const slotB = {};

  const box = new WinBox();
  box.init(slotA, 5);

  box.setDepth(8);
  assert.equal(box.depth, 8);

  box.activate();
  assert.equal(calls[0][0], 'activate');

  assert.equal(box.move(slotA), false);
  assert.equal(box.move(slotB), true);
  assert.equal(calls[1][0], 'move');

  box.tryToClose();
  assert.equal(box.flClosed, true);
  assert.equal(calls[2][0], 'rmBox');

  box.setTitle('My title');
  assert.equal(box.title, 'My title');
});
