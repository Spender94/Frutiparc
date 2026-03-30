const test = require('node:test');
const assert = require('node:assert/strict');

const { FEMCLoader } = require('../../packages/core-js/src/femcLoader');

test('FEMCLoader deduplicates in-flight loads per URL', () => {
  FEMCLoader.urlList = {};
  const calls = [];

  const l1 = new FEMCLoader((url, target) => calls.push(['load', 'l1', url, target.id]));
  const l2 = new FEMCLoader((url, target) => calls.push(['load', 'l2', url, target.id]));

  l1.loadClip('/a.swf', { id: 'mc1' });
  l2.loadClip('/a.swf', { id: 'mc2' });

  assert.deepEqual(calls, [['load', 'l1', '/a.swf', 'mc1']]);

  l1.onLoadComplete({ id: 'mc1' });

  assert.deepEqual(calls, [
    ['load', 'l1', '/a.swf', 'mc1'],
    ['load', 'l2', '/a.swf', 'mc2'],
  ]);
  assert.equal(FEMCLoader.urlList['/a.swf'].loaded, true);
});

test('FEMCLoader loads immediately when URL already loaded', () => {
  FEMCLoader.urlList = {
    '/done.swf': { loaded: true, objList: [] },
  };

  const calls = [];
  const loader = new FEMCLoader((url, target) => calls.push([url, target.id]));

  loader.loadClip('/done.swf', { id: 'mcX' });

  assert.deepEqual(calls, [['/done.swf', 'mcX']]);
});
