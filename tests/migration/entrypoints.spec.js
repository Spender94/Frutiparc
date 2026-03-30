const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const indexHtml = fs.readFileSync('public/index.html', 'utf8');
const ruffleHtml = fs.readFileSync('public/ruffle.html', 'utf8');

test('root entrypoint is Node/Haxe MVP (no Ruffle/main.swf)', () => {
  assert.ok(indexHtml.includes('/api/mvp/showcase'));
  assert.ok(!indexHtml.includes('@ruffle-rs/ruffle'));
  assert.ok(!indexHtml.includes('data="main.swf"'));
});

test('legacy entrypoint keeps Flash facade and uses legacy SWF route', () => {
  assert.ok(ruffleHtml.includes('@ruffle-rs/ruffle'));
  assert.ok(ruffleHtml.includes('data="/legacy/main.swf"'));
});
