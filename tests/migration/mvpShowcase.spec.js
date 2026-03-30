const test = require('node:test');
const assert = require('node:assert/strict');

const { buildMvpShowcase } = require('../../packages/core-js/src/mvpShowcase');

test('MVP showcase returns stable structure from migrated modules', () => {
  const payload = buildMvpShowcase();

  assert.equal(payload.version, 'mvp-haxe-node');
  assert.equal(typeof payload.generatedAt, 'string');

  assert.equal(payload.modules.feString, 'Salut Frutiparc, build Haxe/Node');
  assert.deepEqual(payload.modules.feColor, { r: 255, g: 136, b: 0 });

  assert.equal(typeof payload.modules.statusMng.external, 'string');
  assert.equal(typeof payload.modules.classLoader.firstUrl, 'string');
  assert.equal(payload.modules.classLoader.nextLibLoaded, 1);
  assert.equal(payload.modules.cmdList.ident, 'k');
  assert.equal(payload.modules.listenerMouse.dragDeleted, true);
  assert.equal(payload.modules.listenerMouse.lastWheelDelta, 3);
  assert.equal(payload.modules.fpTrashSlot.title, 'trash');
});
