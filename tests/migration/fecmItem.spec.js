const test = require('node:test');
const assert = require('node:assert/strict');

const { FECMItem } = require('../../packages/core-js/src/fecmItem');

test('FECMItem stores constructor data', () => {
  const cb = { obj: {}, method: 'x', args: 42 };
  const item = new FECMItem('Demo', cb, false, true, true);

  assert.equal(item.caption, 'Demo');
  assert.equal(item.callBack, cb);
  assert.equal(item.flSeparatorBefore, false);
  assert.equal(item.flEnabled, true);
  assert.equal(item.flVisible, true);
});

test('FECMItem.onSelect invokes callback method with args', () => {
  const calls = [];
  const target = {
    open(value) {
      calls.push(value);
      return `ok:${value}`;
    },
  };

  const item = new FECMItem(
    'Open',
    { obj: target, method: 'open', args: 'profile' },
    false,
    true,
    true
  );

  const result = FECMItem.onSelect(null, item);

  assert.deepEqual(calls, ['profile']);
  assert.equal(result, 'ok:profile');
});
