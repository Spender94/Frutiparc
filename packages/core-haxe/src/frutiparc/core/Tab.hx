package frutiparc.core;

/**
 * Portage Haxe du module AS2 Tab.
 * Source legacy: frutiengine/Tab.as
 */
class Tab extends Slot {
  public function new() {
    super();
  }

  override public function init(slotList:Dynamic, baseDepth:Int, ?flGo:Bool = false):Void {
    super.init(slotList, baseDepth, flGo);
  }

  public function addTabBox(box:Dynamic):Bool {
    if (this.nbBox == 0) {
      super.addBox(box);
      return true;
    }
    return false;
  }

  override public function rmBox(box:Dynamic):Void {
    super.rmBox(box);
    this.cleanDepths();
    if (this.nbBox == 0) this.close();
  }
}
