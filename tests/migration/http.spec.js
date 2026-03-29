const test = require('node:test');
const assert = require('node:assert/strict');

const { HTTP } = require('../../packages/core-js/src/http');

test('HTTP processes queue sequentially and merges default params', async () => {
  HTTP.queue = [];
  HTTP.flIdle = true;
  HTTP.defaultParams = { token: 'abc' };

  const events = [];
  const callbackObj = {
    onResult(success, data, extra) {
      events.push(['callback', success, data.action, extra]);
    },
  };

  const transport = (action, output, method, done) => {
    events.push(['submit', action, method, output.token, output.local]);
    setTimeout(() => done(true, { action }), 5);
  };

  new HTTP('do/one', { local: 'x' }, { obj: callbackObj, method: 'onResult' }, 'GET', 'e1', transport);
  new HTTP('do/two', { local: 'y' }, { obj: callbackObj, method: 'onResult' }, 'POST', 'e2', transport);

  await new Promise((resolve) => setTimeout(resolve, 40));

  assert.deepEqual(events, [
    ['submit', 'do/one', 'GET', 'abc', 'x'],
    ['callback', true, 'do/one', 'e1'],
    ['submit', 'do/two', 'POST', 'abc', 'y'],
    ['callback', true, 'do/two', 'e2'],
  ]);
  assert.equal(HTTP.flIdle, true);
});

test('HTTP without transport fails gracefully', () => {
  HTTP.queue = [];
  HTTP.flIdle = true;

  let called = null;
  const callbackObj = {
    onResult(success, data, extra) {
      called = { success, data, extra };
    },
  };

  new HTTP('do/none', {}, { obj: callbackObj, method: 'onResult' }, 'GET', 'extra', null);

  assert.deepEqual(called, { success: false, data: null, extra: 'extra' });
  assert.equal(HTTP.flIdle, true);
});
