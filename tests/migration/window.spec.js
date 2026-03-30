const test = require('node:test');
const assert = require('node:assert/strict');

const { Window } = require('../../packages/core-js/src/window');

test('Window can be instantiated', () => {
  const instance = new Window();
  assert.ok(instance instanceof Window);
});

test('Window init exists and returns undefined (void semantics)', () => {
  const instance = new Window();
  assert.equal(typeof instance.init, 'function');
  assert.equal(instance.init(), undefined);
});
