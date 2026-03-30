const test = require('node:test');
const assert = require('node:assert/strict');

const { onMouseDown, onMouseWheel } = require('../../packages/core-js/src/mouse');

test('onMouseDown deletes drag icon when available', () => {
  let deleted = false;
  const result = onMouseDown({
    dragIcon: { id: 1 },
    deleteDragIcon() {
      deleted = true;
    },
  });

  assert.equal(result, true);
  assert.equal(deleted, true);
});

test('onMouseWheel forwards delta to active box', () => {
  let deltaSeen = null;

  onMouseWheel(7, {
    activeSlot: {
      activeBox: {
        onWheel(delta) {
          deltaSeen = delta;
        },
      },
    },
  });

  assert.equal(deltaSeen, 7);
});
