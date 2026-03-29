const test = require('node:test');
const assert = require('node:assert/strict');

const { CBeeLocal } = require('../../packages/core-js/src/cbeeLocal');

test('CBeeLocal init binds manager and propagates status', () => {
  const sent = [];
  const manager = {
    addListener(port) {
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

test('CBeeLocal external mode init/send/cmd mirrors LocalConnection flow', () => {
  const sent = [];
  const makeConnection = () => ({
    onStatus: null,
    send(...args) {
      sent.push(args);
      if (typeof this.onStatus === 'function' && args[0] === 'fp_cbeeMng_SID42') this.onStatus({ level: 'status' });
    },
  });
  const inbound = { connectedTo: null, connect(name) { this.connectedTo = name; } };

  const cbl = new CBeeLocal({
    port: 4321,
    sid: 'SID42',
    inboundConnection: inbound,
    localConnectionFactory: makeConnection,
  });

  cbl.init();
  assert.equal(typeof inbound.connectedTo, 'string');
  assert.deepEqual(sent[0], ['fp_cbeeMng_SID42', 'addListener', 4321, inbound.connectedTo]);
  assert.deepEqual(sent[1], ['fp_cbeeMng_SID42', 'getStatus', 4321, inbound.connectedTo]);

  cbl.onStatus({ connected: true, logged: true });
  assert.equal(cbl.connected, true);
  assert.equal(cbl.logged, true);

  assert.equal(cbl.send('payload'), true);
  assert.deepEqual(sent.at(-1), ['fp_cbee_4321_SID42', 'send', 'payload']);

  assert.equal(cbl.cmd('join', { x: 1 }, 'child'), true);
  assert.deepEqual(sent.at(-1), ['fp_cbee_4321_SID42', 'cmd', 'join', { x: 1 }, 'child']);
});
