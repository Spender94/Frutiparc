const test = require('node:test');
const assert = require('node:assert/strict');

const { CBeeLC } = require('../../packages/core-js/src/cbeeLc');

test('CBeeLC delegates send and cmd to cbee instance', () => {
  const calls = [];
  const cbee = {
    send(payload) {
      calls.push(['send', payload]);
      return `sent:${payload}`;
    },
    cmd(a, b, c) {
      calls.push(['cmd', a, b, c]);
      return `${a}|${b}|${c}`;
    },
  };

  const lc = new CBeeLC(cbee);

  assert.equal(lc.send('hello'), 'sent:hello');
  assert.equal(lc.cmd('A', 'B', 'C'), 'A|B|C');
  assert.deepEqual(calls, [
    ['send', 'hello'],
    ['cmd', 'A', 'B', 'C'],
  ]);
});
