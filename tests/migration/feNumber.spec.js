const test = require('node:test');
const assert = require('node:assert/strict');

const FENumber = require('../../packages/core-js/src/feNumber');

test('toColorObj splits RGB int', () => {
  assert.deepEqual(FENumber.toColorObj(0x123456), { r: 0x12, g: 0x34, b: 0x56 });
});

test('toAlphaString follows legacy sequence', () => {
  assert.equal(FENumber.toAlphaString(1), 'a');
  assert.equal(FENumber.toAlphaString(26), 'z');
  assert.equal(FENumber.toAlphaString(27), 'aa');
  assert.equal(FENumber.toAlphaString(52), 'az');
  assert.equal(FENumber.toAlphaString(53), 'ba');
});

test('encode62 and toStringL helpers', () => {
  assert.equal(FENumber.encode62(0), '0');
  assert.equal(FENumber.encode62(61), 'Z');
  assert.equal(FENumber.encode62(62), '10');
  assert.equal(FENumber.encode62(15, 3), '00f');
  assert.equal(FENumber.toStringL(42, 5), '00042');
  assert.equal(FENumber.toStringL(undefined, 3), '000');
});

test('modCol applies inc/coef with clamping', () => {
  assert.equal(FENumber.modCol(0x112233, 10, 1), 0x1b2c3d);
  assert.equal(FENumber.modCol(0xff0000, 0, 0.5), 0x800000);
  assert.equal(FENumber.modCol(0x000000, -10, 1), 0x000000);
});
