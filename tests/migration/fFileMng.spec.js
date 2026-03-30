const test = require('node:test');
const assert = require('node:assert/strict');

const { FFileMng } = require('../../packages/core-js/src/fFileMng');

function linkSiblings(children) {
  for (let i = 0; i < children.length - 1; i += 1) {
    children[i].nextSibling = children[i + 1];
  }
  if (children.length) children[children.length - 1].nextSibling = null;
  return children[0] || null;
}

function node(nodeName, attributes = {}, children = []) {
  const n = {
    nodeType: 1,
    nodeName,
    attributes,
    firstChild: null,
    nextSibling: null,
    hasChildNodes() {
      return this.firstChild !== null;
    },
  };
  n.firstChild = linkSiblings(children);
  return n;
}

function fileNode(uid, lines) {
  return {
    nodeType: 1,
    nodeName: 'e',
    attributes: { u: uid, t: 'mail', s: '42', d: '2024-01-01', a: 'rw' },
    firstChild: { nodeValue: lines },
    nextSibling: null,
    hasChildNodes() { return true; },
  };
}

test('onLoadTree parses folder IDs and tree structure', () => {
  const mng = new FFileMng();

  const childFolder = node('f', { u: 'inbox', n: 'Inbox', t: 'sys', p: 'tpl' });
  const rootFolder = node('f', {
    u: 'messages',
    n: 'Messages',
    t: 'sys',
    p: 'tpl',
    b: 'messages;inbox;outbox;blackbox;draftbox;disc;inv;contact;bin',
  }, [childFolder]);

  const ok = mng.onLoadTree(true, { lastChild: rootFolder });

  assert.equal(ok, true);
  assert.equal(mng.messages, 'messages');
  assert.equal(mng.inbox, 'inbox');
  assert.deepEqual(mng.tree.messages.childs, ['inbox']);
  assert.equal(mng.tree.inbox.parent, 'messages');
});

test('analyseXml builds folder/file listing', () => {
  const mng = new FFileMng();
  mng.tree.messages = { name: 'Messages', type: 'sys', tpl: 'tpl', parent: undefined, childs: [] };
  mng.tree.sub = { name: 'Sub', type: 'usr', tpl: 'tpl2', parent: 'messages', childs: [] };

  const nestedFolder = node('f', { u: 'sub' }, [fileNode('f2', 'Nested\r\nFile')]);
  const rootXml = node('f', { u: 'messages' }, [fileNode('f1', 'Hello\r\nWorld'), nestedFolder]);

  const result = mng.analyseXml(rootXml);

  assert.equal(result.uid, 'messages');
  assert.equal(result.list.length, 2);
  assert.equal(result.list[0].uid, 'f1');
  assert.deepEqual(result.list[0].desc, ['Hello', 'World']);
  assert.equal(result.list[1].uid, 'sub');
  assert.equal(result.list[1].list[0].uid, 'f2');
});
