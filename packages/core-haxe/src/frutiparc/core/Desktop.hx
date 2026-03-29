package frutiparc.core;

/**
 * Portage Haxe du module AS2 Desktop.
 * Source legacy: frutiengine/Desktop.as
 */
class Desktop extends SlotBase {
  public var iconList:Array<Dynamic>;

  public function new() {
    super();
    this.iconList = [];
  }

  public override function init(slotList:Dynamic, depth:Dynamic, flGo:Dynamic):Void {
    super.init(slotList, depth, flGo);
    this.iconList = [];
  }
}
