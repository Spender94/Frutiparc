const test = require('node:test');
const assert = require('node:assert/strict');

const { ClassLoader } = require('../../packages/core-js/src/classLoader');

test('ClassLoader starts first load and chains until play', () => {
  const calls = [];
  const loader = {
    listener: null,
    addListener(l) { this.listener = l; },
    loadClip(url, mc) { calls.push([url, mc.name, mc.depth]); },
  };

  let played = 0;
  const cl = new ClassLoader({
    loader,
    libPath: ['a.swf', 'b.swf'],
    baseUrl: 'https://cdn/',
    onPlay() { played += 1; },
  });

  cl.start();
  assert.equal(cl.state, 'stopped');
  assert.deepEqual(calls[0], ['https://cdn/a.swf', 'lib0', 80]);

  cl.onLoadComplete({ name: 'lib0' });
  assert.equal(cl.libLoaded, 1);
  assert.deepEqual(calls[1], ['https://cdn/b.swf', 'lib1', 81]);

  cl.onLoadComplete({ name: 'lib1' });
  assert.equal(cl.state, 'playing');
  assert.equal(played, 1);
});

test('ClassLoader logs load events', () => {
  const cl = new ClassLoader({ libPath: ['x.swf'] });

  cl.onLoadStart({ name: 'lib0' });
  cl.onLoadError({ name: 'lib0' }, '404');
  cl.onLoadComplete({ name: 'lib0' });

  assert.match(cl.logText, /loadStart\(lib0\)/);
  assert.match(cl.logText, /loadError\(404\)/);
  assert.match(cl.logText, /loadComplete\(lib0\)/);
});
