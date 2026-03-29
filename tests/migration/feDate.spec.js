const test = require('node:test');
const assert = require('node:assert/strict');

const FEDate = require('../../packages/core-js/src/feDate');

test('newFromString parses YYYY-MM-DD HH:II:SS', () => {
  const d = FEDate.newFromString('2024-03-05 06:07:08');
  assert.equal(d.getFullYear(), 2024);
  assert.equal(d.getMonth(), 2);
  assert.equal(d.getDate(), 5);
  assert.equal(d.getHours(), 6);
  assert.equal(d.getMinutes(), 7);
  assert.equal(d.getSeconds(), 8);
});

test('newFromTime rebuilds a date from timestamp', () => {
  const ts = 1710000000000;
  const d = FEDate.newFromTime(ts);
  assert.equal(d.getTime(), ts);
});

test('getObject returns zero-padded date fields', () => {
  const d = new Date(2024, 0, 2, 3, 4, 5);
  assert.deepEqual(FEDate.getObject(d), {
    y: '2024',
    m: '01',
    d: '02',
    h: '03',
    i: '04',
    s: '05',
  });
});

test('getCompleteObject returns expanded fields', () => {
  const d = new Date(2024, 0, 2, 3, 4, 5);
  const obj = FEDate.getCompleteObject(d);

  assert.equal(obj.Y, '2024');
  assert.equal(obj.y, '24');
  assert.equal(obj.n, '1');
  assert.equal(obj.N, '01');
  assert.equal(obj.d, '2');
  assert.equal(obj.D, '02');
  assert.equal(obj.h, '3');
  assert.equal(obj.H, '03');
  assert.equal(obj.i, '4');
  assert.equal(obj.I, '04');
  assert.equal(obj.s, '5');
  assert.equal(obj.S, '05');
});
