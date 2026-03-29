const test = require('node:test');
const assert = require('node:assert/strict');

const { RunDate } = require('../../packages/core-js/src/runDate');

test('RunDate returns near-now time before reference is set', () => {
  const rd = new RunDate();
  const now = Date.now();
  const t = rd.getTime();
  assert.ok(Math.abs(t - now) < 1000);
});

test('setFromString updates diff and aligned object helpers', () => {
  const rd = new RunDate();
  rd.setFromString('2024-03-05 06:07:08');

  const obj = rd.getObject();
  assert.equal(obj.y, '2024');
  assert.equal(obj.m, '03');
  assert.equal(obj.d, '05');

  const complete = rd.getCompleteObject();
  assert.equal(complete.Y, '2024');
  assert.equal(complete.N, '03');
});

test('toFormat delegates to formatter callback', () => {
  const rd = new RunDate();
  rd.setFromString('2024-03-05 06:07:08');

  const out = rd.toFormat('Y-N-D', (o, fmt) => `${fmt}:${o.Y}-${o.N}-${o.D}`);
  assert.equal(out, 'Y-N-D:2024-03-05');
});

test('getCurrentFSign returns expected shape', () => {
  const rd = new RunDate();
  const sign = rd.getCurrentFSign();

  assert.equal(typeof sign.sign, 'number');
  assert.equal(typeof sign.signb, 'number');
  assert.equal(typeof sign.signCompletion, 'number');
  assert.equal(typeof sign.signbCompletion, 'number');
});
