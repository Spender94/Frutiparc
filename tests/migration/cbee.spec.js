const test = require('node:test');
const assert = require('node:assert/strict');

const { CBee } = require('../../packages/core-js/src/cbee');

test('CBee connect/send/cmd lifecycle', () => {
  const cbee = new CBee({ cmdList: { ping: 'p', onconnect: 'onconnect', onclose: 'onclose' } });

  cbee.connect('localhost', 9000);
  assert.equal(cbee.connected, false);
  assert.equal(cbee.send({}), false);

  cbee.onConnect(true);
  assert.equal(cbee.connected, true);
  assert.equal(cbee.cnxNb, 1);

  assert.equal(cbee.cmd('ping', { a: 1 }), true);
  assert.equal(cbee.sentLog.length, 1);
  assert.deepEqual(cbee.sentLog[0], { nodeName: 'p', attributes: { a: 1 } });

  cbee.onClose();
  assert.equal(cbee.connected, false);
});

test('CBee command listeners and specific listeners', () => {
  const cbee = new CBee({ cmdList: { msg: 'm', onconnect: 'onconnect', onclose: 'onclose' } });

  const events = [];
  const obj = {
    onMsg(node) { events.push(['all', node.attributes.kind]); },
    onSpec(node) { events.push(['spec', node.attributes.kind]); },
  };

  cbee.addListener('msg', obj, 'onMsg');
  cbee.addListener('msg', obj, 'onSpec', 'kind', 'chat');

  cbee.onXML({ nodeName: 'm', attributes: { kind: 'chat' } });
  cbee.onXML({ nodeName: 'm', attributes: { kind: 'sys' } });

  assert.deepEqual(events, [
    ['all', 'chat'],
    ['spec', 'chat'],
    ['all', 'sys'],
  ]);

  cbee.removeListenerCmdObj('msg', obj, 'kind', 'chat');
  cbee.onXML({ nodeName: 'm', attributes: { kind: 'chat' } });
  assert.deepEqual(events.at(-1), ['all', 'chat']);

  cbee.removeListenerCmd('msg');
  cbee.onXML({ nodeName: 'm', attributes: { kind: 'sys' } });
  assert.deepEqual(events.at(-1), ['all', 'chat']);
});

test('CBee global listener receives events', () => {
  const cbee = new CBee({ cmdList: { onconnect: 'onconnect', onclose: 'onclose' } });
  const events = [];

  cbee.setGlobalListener({
    obj: {
      onEvt(port, name, data) {
        events.push([port, name, data && data.nodeName]);
      },
    },
    method: 'onEvt',
  });

  cbee.connect('h', 1000);
  cbee.onConnect(false);
  cbee.onXML({ nodeName: 'foo', attributes: {} });
  cbee.onClose();

  assert.deepEqual(events, [
    [1000, 'onConnect', false],
    [1000, 'onXML', 'foo'],
    [1000, 'onClose', undefined],
  ]);
});
