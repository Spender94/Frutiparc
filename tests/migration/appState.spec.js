const test = require('node:test');
const assert = require('node:assert/strict');

const { createAppState } = require('../../packages/core-js/src/appState');

test('AppState initializes from migrated modules and appends messages', () => {
  const app = createAppState();
  const initial = app.getState();

  assert.ok(initial.users.includes('dalmatien17'));
  assert.ok(initial.users.includes('groingroin'));
  assert.equal(typeof initial.status.external, 'string');

  const ok = app.addMessage('vous', 'hello frutiparc');
  assert.equal(ok, true);
  const next = app.getState();
  assert.equal(next.messages.at(-1).text, 'hello frutiparc');
});

test('AppState rejects empty messages', () => {
  const app = createAppState();
  assert.equal(app.addMessage('x', '   '), false);
});
