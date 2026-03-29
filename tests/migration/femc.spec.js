const test = require('node:test');
const assert = require('node:assert/strict');

const { FEMC } = require('../../packages/core-js/src/femc');

test('FEMC setColor/killColor transforms', () => {
  const mc = {};

  const tr = FEMC.setColor(mc, 0x336699, false);
  assert.deepEqual(tr, {
    rb: 51 - 255,
    gb: 102 - 255,
    bb: 153 - 255,
    ra: 100,
    ga: 100,
    ba: 100,
  });

  const trNeg = FEMC.setColor(mc, { r: 10, g: 20, b: 30 }, true);
  assert.equal(trNeg.ra, -100);
  assert.equal(trNeg.rb, 10);

  const reset = FEMC.killColor(mc);
  assert.deepEqual(reset, {
    ra: 100, ga: 100, ba: 100, aa: 100, rb: 0, gb: 0, bb: 0, ab: 0,
  });
});

test('FEMC setPColor and morphToButton hooks', () => {
  const mc = {};
  const tr = FEMC.setPColor(mc, 0x112233, 80);
  assert.equal(tr.ra, 80);
  assert.equal(tr.rb, 17 * 0.2);

  const events = [];
  const button = {
    frames: [],
    gotoAndStop(f) { this.frames.push(f); },
    stop() { this.stopped = true; },
    onFrutiRollOver() { events.push('over'); },
    onFrutiRollOut() { events.push('out'); },
    onFrutiPress() { events.push('press'); },
    onFrutiRelease() { events.push('release'); },
  };

  FEMC.morphToButton(button);
  button.onRollOver();
  button.onRollOut();
  button.onPress();
  button.onRelease();

  assert.deepEqual(button.frames, [2, 1, 3, 2]);
  assert.deepEqual(events, ['over', 'out', 'press', 'release']);
  assert.equal(button.stopped, true);
});

test('FEMC toString builds clip path', () => {
  const root = { isRoot: true };
  const p1 = { _name: 'a', _parent: root };
  const p2 = { _name: 'b', _parent: p1 };

  assert.equal(FEMC.toString(p2), '[MovieClip: _root.a.b]');
});
