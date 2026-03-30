const test = require('node:test');
const assert = require('node:assert/strict');

const { FileLoader } = require('../../packages/core-js/src/fileLoader');

test('FileLoader tracks progress and emits events', () => {
  const events = [];
  const listener = {
    onLoadStart() { events.push('start'); },
    onLoadProgress(_mc, loaded, total) { events.push(`progress:${loaded}/${total}`); },
    onLoadComplete() { events.push('complete'); },
  };

  const loader = new FileLoader('/asset.swf', 1000);
  loader.addListener(listener);

  loader.loadClip({ id: 'mc1' }, 1000);
  loader.onLoadStart();
  loader.onLoadProgress({ id: 'mc1' }, 250, 1000, 1500);
  loader.onLoadComplete({ bytesLoaded: 1000, bytesTotal: 1000 });

  assert.equal(loader.loaded, true);
  assert.equal(loader.percent, 25);
  assert.equal(loader.bytesToLoad, 750);
  assert.deepEqual(events, ['start', 'progress:250/1000', 'complete']);
});

test('FileLoader emits false-size error when loaded size differs', () => {
  let falseSize = 0;
  const listener = {
    onFalseSizeError() { falseSize += 1; },
  };

  const loader = new FileLoader('/asset.swf', 500);
  loader.addListener(listener);
  loader.onLoadComplete({ bytesLoaded: 400, bytesTotal: 400 });
  loader.onLoadInit();

  assert.equal(falseSize, 2);
  assert.equal(loader.loaded, false);
});

test('FileLoader not-found path emits expected event', () => {
  let notFound = 0;
  const listener = {
    onFileNotFoundError() { notFound += 1; },
  };

  const loader = new FileLoader('/missing.swf');
  loader.addListener(listener);
  loader.onLoadError('404', 'Not Found');

  assert.equal(notFound, 1);
  assert.equal(loader.loaded, false);
});
