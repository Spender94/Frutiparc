const test = require('node:test');
const assert = require('node:assert/strict');

const { StatusMng } = require('../../packages/core-js/src/statusMng');

test('StatusMng.analyseStr decodes external/internal/emote', () => {
  const decoded = StatusMng.analyseStr('102A');
  assert.deepEqual(decoded, {
    external: 'eat',
    internal: 'bkiwi',
    emote: 36,
  });
});

test('StatusMng send deduplicates payloads and pushes via cnx.cmd', () => {
  const status = new StatusMng();
  const calls = [];

  status.setCnx({
    cmd(name, payload) {
      calls.push([name, payload]);
    },
  });

  status.setExternal('work');
  status.setInternal('mb2');
  status.setEmote(5);

  const before = calls.length;
  status.send();
  assert.equal(calls.length, before);

  assert.deepEqual(calls, [
    ['status', { s: '200' }],
    ['status', { s: '203' }],
    ['status', { s: '2035' }],
  ]);
});

test('StatusMng unsetInternal only sends when current internal matches', () => {
  const status = new StatusMng();
  const calls = [];

  status.setCnx({
    cmd(name, payload) {
      calls.push([name, payload]);
    },
  });

  status.setInternal('snake3');
  status.unsetInternal('forum');
  assert.equal(calls.length, 1);

  status.unsetInternal('snake3');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.at(-1), ['status', { s: '000' }]);
});
