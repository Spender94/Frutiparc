const test = require('node:test');
const assert = require('node:assert/strict');

const { CBeeLocal } = require('../../packages/core-js/src/cbeeLocal');

test('CBeeLocal init binds manager and propagates status', () => {
  const sent = [];
  const manager = {
    addListener(port, obj) {
      return { send(payload) { sent.push([port, payload]); }, cmd() {} };
    },
    getStatus() { return { connected: true, logged: false }; },
    removeListener() {},
  };

  const cbl = new CBeeLocal({ port: 1001, cbeeManager: manager });
  cbl.init();

  assert.equal(cbl.initialized, true);
  assert.equal(cbl.connected, true);

  assert.equal(cbl.send('hello'), true);
  assert.deepEqual(sent, [[1001, 'hello']]);
});

test('CBeeLocal listeners and specific listeners dispatch', () => {
  const cbl = new CBeeLocal();
  const events = [];
  const obj = {
    onAny(node) { events.push(['any', node.attributes.t]); },
    onSpec(node) { events.push(['spec', node.attributes.t]); },
  };

  cbl.addListener('ident', obj, 'onAny');
  cbl.addListener('ident', obj, 'onSpec', 't', 'chat');

  cbl.onXML({ nodeName: 'ident', attributes: { t: 'chat' } });
  cbl.onXML({ nodeName: 'ident', attributes: { t: 'sys' } });

  assert.deepEqual(events, [
    ['any', 'chat'],
    ['spec', 'chat'],
    ['any', 'sys'],
  ]);

  cbl.removeListenerCmdObj('ident', obj, 't', 'chat');
  cbl.onXML({ nodeName: 'ident', attributes: { t: 'chat' } });
  assert.deepEqual(events.at(-1), ['any', 'chat']);
});

test('CBeeLocal ident/login and close behavior', () => {
  const removed = [];
  const cbl = new CBeeLocal({
    cbeeManager: { removeListener(port, obj) { removed.push([port, obj]); } },
    port: 1234,
  });

  cbl.onIdent({ attributes: {} });
  assert.equal(cbl.logged, true);

  cbl.onIdent({ attributes: { k: 'ko' } });
  assert.equal(cbl.logged, false);

  cbl.close();
  assert.equal(removed.length, 1);
});
