const test = require('node:test');
const assert = require('node:assert/strict');

const { CBeeManager } = require('../../packages/core-js/src/cbeeManager');

test('CBeeManager add/get/remove listener lifecycle', () => {
  const manager = new CBeeManager({ host: 'srv' });

  const listener = {
    status: [],
    onStatus(obj) { this.status.push(obj); },
    onXML() {},
  };

  const lc = manager.addListener(1234, listener);
  assert.ok(lc);
  assert.equal(manager.cbeeCnx['1234'].listeners.length, 1);

  const status = manager.getStatus(1234, listener);
  assert.equal(status.connected, false);
  assert.equal(listener.status.length, 1);

  manager.removeListener(1234, listener, false);
  assert.equal(manager.cbeeCnx['1234'].listeners.length, 0);

  manager.removeListener(1234, listener, true);
  assert.equal(manager.cbeeCnx['1234'], undefined);
});

test('CBeeManager onGlobalListener forwards and auto-closes idle', () => {
  const manager = new CBeeManager({ host: 'srv' });
  manager.addCnx(2345, false);

  const events = [];
  const listener = {
    onXML(data) { events.push(['xml', data.nodeName]); },
    onClose() { events.push(['close']); },
  };

  manager.addListener(2345, listener);
  manager.onGlobalListener(2345, 'onXML', { nodeName: 'msg' });
  assert.deepEqual(events.at(-1), ['xml', 'msg']);

  manager.removeListener(2345, listener, false);
  manager.onGlobalListener(2345, 'onClose');
  assert.equal(manager.cbeeCnx['2345'], undefined);
});

test('CBeeManager checkAll removes timed out empty connections', () => {
  let now = 1000;
  const manager = new CBeeManager({ host: 'srv', cnxTimeout: 50, now: () => now });
  manager.addCnx(3456, false);

  now = 1100;
  manager.checkAll();

  assert.equal(manager.cbeeCnx['3456'], undefined);
});
