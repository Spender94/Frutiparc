const test = require('node:test');
const assert = require('node:assert/strict');

const { CMD_LIST, createCmdList } = require('../../packages/core-js/src/cmdList');

test('CMD_LIST mirrors legacy command aliases', () => {
  assert.equal(CMD_LIST.error, 'a');
  assert.equal(CMD_LIST.ident, 'k');
});

test('createCmdList supports overrides', () => {
  const cmdList = createCmdList({ ping: 'PING' });
  assert.equal(cmdList.ping, 'PING');
  assert.equal(cmdList.error, 'a');
});
