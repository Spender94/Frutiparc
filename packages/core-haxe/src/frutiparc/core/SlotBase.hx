package frutiparc.core;

/**
 * Base de transition pour remplacer temporairement la dépendance AS2 `Slot`.
 * Permet de préserver la signature `init(slotList, depth, flGo)` utilisée par Desktop.
 */
class SlotBase {
  public var lastInitSlotList:Dynamic = null;
  public var lastInitDepth:Dynamic = null;
  public var lastInitFlGo:Dynamic = null;

  public function new() {}

  public function init(slotList:Dynamic, depth:Dynamic, flGo:Dynamic):Void {
    this.lastInitSlotList = slotList;
    this.lastInitDepth = depth;
    this.lastInitFlGo = flGo;
  }
}
