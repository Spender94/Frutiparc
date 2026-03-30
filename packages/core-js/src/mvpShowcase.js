const { formatVars } = require('./feString');
const { toRGBObj } = require('./feColor');
const { StatusMng } = require('./statusMng');
const { ClassLoader } = require('./classLoader');
const { createCmdList } = require('./cmdList');
const { onMouseDown, onMouseWheel } = require('./mouse');
const { FPTrashSlot } = require('./fpTrashSlot');

function buildMvpShowcase() {
  const greeting = formatVars('Salut $0, build $1', { 0: 'Frutiparc', 1: 'Haxe/Node' });

  const color = toRGBObj(0xff8800);

  const parsedStatus = StatusMng.analyseStr('10a0');

  const loader = new ClassLoader({ libPath: ['core.swf', 'ui.swf'], baseUrl: 'https://assets.example/' });
  const firstLoad = loader.start();
  loader.onLoadComplete({ name: 'lib0' });

  const cmdList = createCmdList();

  let wheelDelta = null;
  onMouseWheel(3, { activeSlot: { activeBox: { onWheel: (delta) => { wheelDelta = delta; } } } });

  let deleteCalled = false;
  const dragDeleted = onMouseDown({
    dragIcon: { id: 1 },
    deleteDragIcon() {
      deleteCalled = true;
    },
  });

  const slot = new FPTrashSlot();

  return {
    version: 'mvp-haxe-node',
    generatedAt: new Date().toISOString(),
    modules: {
      feString: greeting,
      feColor: color,
      statusMng: parsedStatus,
      classLoader: {
        firstUrl: firstLoad.url,
        nextLibLoaded: loader.libLoaded,
        state: loader.state,
      },
      cmdList,
      listenerMouse: {
        dragDeleted,
        deleteCalled,
        lastWheelDelta: wheelDelta,
      },
      fpTrashSlot: {
        title: slot.title,
      },
    },
  };
}

module.exports = {
  buildMvpShowcase,
};
