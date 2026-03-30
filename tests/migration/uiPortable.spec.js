const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const js = fs.readFileSync('public/app.js', 'utf8');

test('portable UI binds migrated app state endpoints', () => {
  assert.ok(js.includes('/api/app/state'));
  assert.ok(js.includes('/api/app/messages'));
});

test('portable UI includes desktop and window interactions', () => {
  assert.ok(js.includes('desktop-icon'));
  assert.ok(js.includes('pointerdown'));
  assert.ok(js.includes('minBtn'));
  assert.ok(js.includes('closeBtn'));
});
