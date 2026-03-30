const test = require('node:test');
const assert = require('node:assert/strict');

const FEObject = require('../../packages/core-js/src/feObject');

test('clone performs shallow copy', () => {
  const source = { a: 1, b: { c: 2 } };
  const cloned = FEObject.clone(source);

  assert.deepEqual(cloned, source);
  assert.notEqual(cloned, source);
  assert.equal(cloned.b, source.b);
});

test('recursiveClone performs deep copy', () => {
  const source = { a: 1, b: { c: 2 } };
  const cloned = FEObject.recursiveClone(source);

  assert.deepEqual(cloned, source);
  assert.notEqual(cloned, source);
  assert.notEqual(cloned.b, source.b);
});

test('addObject fills missing fields and supports splash', () => {
  const base = { a: 1 };
  FEObject.addObject(base, { a: 2, b: 3 }, false);
  assert.deepEqual(base, { a: 1, b: 3 });

  FEObject.addObject(base, { a: 9 }, true);
  assert.deepEqual(base, { a: 9, b: 3 });
});

test('toColNumber creates numeric color from rgb object', () => {
  assert.equal(FEObject.toColNumber({ r: 0x11, g: 0x22, b: 0x33 }), 0x112233);
});
