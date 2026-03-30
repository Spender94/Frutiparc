package frutiparc.core;

/**
 * Portage Haxe du module frutiparc/listener/mouse.as.
 */
class Mouse {
  public static function onMouseDown(globalCtx:Dynamic):Bool {
    if (globalCtx != null && Reflect.hasField(globalCtx, "dragIcon") && Reflect.field(globalCtx, "dragIcon") != null) {
      if (Reflect.hasField(globalCtx, "deleteDragIcon")) {
        Reflect.callMethod(globalCtx, Reflect.field(globalCtx, "deleteDragIcon"), []);
        return true;
      }
    }
    return false;
  }

  public static function onMouseWheel(delta:Float, slotList:Dynamic):Void {
    if (slotList == null) return;
    var activeSlot = Reflect.field(slotList, "activeSlot");
    if (activeSlot == null) return;
    var activeBox = Reflect.field(activeSlot, "activeBox");
    if (activeBox == null) return;
    if (Reflect.hasField(activeBox, "onWheel")) {
      Reflect.callMethod(activeBox, Reflect.field(activeBox, "onWheel"), [delta]);
    }
  }
}
