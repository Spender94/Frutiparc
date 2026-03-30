const test = require('node:test');
const assert = require('node:assert/strict');

const { toRGBObj, toRGBInt } = require('../../packages/core-js/src/feColor');

test('toRGBObj splits integer color into channels', () => {
  assert.deepEqual(toRGBObj(0x112233), { r: 0x11, g: 0x22, b: 0x33 });
  assert.deepEqual(toRGBObj(0x000000), { r: 0, g: 0, b: 0 });
  assert.deepEqual(toRGBObj(0xffffff), { r: 255, g: 255, b: 255 });
});

test('toRGBInt combines channels into integer color', () => {
  assert.equal(toRGBInt({ r: 0x11, g: 0x22, b: 0x33 }), 0x112233);
  assert.equal(toRGBInt({ r: 0, g: 0, b: 0 }), 0);
  assert.equal(toRGBInt({ r: 255, g: 255, b: 255 }), 0xffffff);
});

test('roundtrip is stable for sample values', () => {
  const samples = [0, 1, 255, 0x123456, 0xffffff, 0xabc123];
  for (const value of samples) {
    assert.equal(toRGBInt(toRGBObj(value)), value);
  }
});
