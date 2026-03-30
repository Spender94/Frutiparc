/**
 * Runtime JS mirror for frutiparc/listener/mouse.as.
 */
function onMouseDown(context = globalThis) {
  if (context.dragIcon !== undefined && typeof context.deleteDragIcon === 'function') {
    context.deleteDragIcon();
    return true;
  }
  return false;
}

function onMouseWheel(delta, slotList) {
  const targetSlotList = slotList || globalThis.slotList;
  targetSlotList?.activeSlot?.activeBox?.onWheel?.(delta);
}

module.exports = {
  onMouseDown,
  onMouseWheel,
};
