const test = require('node:test');
const assert = require('node:assert/strict');

const { WinStandard } = require('../../packages/core-js/src/winStandard');

test('WinStandard init defaults and desktop recal/resize', () => {
  WinStandard.env = { frameMode: false, mcw: 300, mch: 200, cornerX: 10, cornerY: 20, tmod: 1 };

  const win = new WinStandard();
  win.init();

  assert.equal(win.flInterface, true);
  assert.equal(win.flResizable, true);
  assert.equal(win.flMoveAnim, true);

  win.minimum = { w: 80, h: 70 };
  win.pos = { x: -5, y: -8, w: 500, h: 500 };

  assert.equal(win.recal(), true);
  assert.deepEqual(win.pos, { x: 10, y: 20, w: 290, h: 180 });

  win.resize(100, 90);
  assert.deepEqual(win.pos, { x: 10, y: 20, w: 100, h: 90 });
  assert.equal(win.xPos, 10);
  assert.equal(win.yPos, 20);
});

test('WinStandard tab mode updates position and size', () => {
  WinStandard.env = { frameMode: false, mcw: 640, mch: 480, cornerX: 30, cornerY: 40, tmod: 1 };

  const win = new WinStandard();
  win.init();
  win.box.mode = 'tab';

  win.onChangeMode();
  assert.equal(win.xPos, 30);
  assert.equal(win.yPos, 40);
  assert.deepEqual(win.tab, { w: 610, h: 440 });
});

test('WinStandard helpers: frameMode, title, gelatine', () => {
  WinStandard.env = { frameMode: true, mcw: 200, mch: 100, cornerX: 0, cornerY: 0, tmod: 2 };

  const win = new WinStandard();
  win.pos = { x: -20, y: -20, w: 300, h: 200 };
  win.minimum = { w: 50, h: 50 };

  assert.equal(win.recal(), false); // disabled by frameMode

  win.setTitle('Main chat');
  assert.equal(win.title, 'Main chat');

  const x0 = win.xScale;
  const y0 = win.yScale;
  win.gelatine();
  assert.notEqual(win.xScale, x0);
  assert.notEqual(win.yScale, y0);
});
