package frutiparc.core;

/**
 * Portage Haxe (noyau métier) du module AS2 SlotList.
 * Source legacy: frutiengine/SlotList.as
 */
class SlotList {
  public static var depths:Dynamic = {
    slotList: {
      start: 0,
      dst: 1,
      max: 50,
    }
  };

  public var arr:Array<Dynamic>;
  public var depth:Int = -1;
  public var activeSlot:Dynamic = null;

  public function new() {}

  public function init():Void {
    this.arr = [];
  }

  public function addSlot(slot:Dynamic, ?flGo:Bool = false):Void {
    var d = this.getNextDepth();
    this.arr[d] = slot;
    slot.init(this, depths.slotList.start + depths.slotList.dst * d, flGo);
  }

  public function rmSlot(slot:Dynamic):Bool {
    var id = this.arr.indexOf(slot);
    if (id > -1) {
      this.arr[id] = null;
      if (this.activeSlot == slot) this.activeSlot = null;
      return true;
    }
    return false;
  }

  public function getNextDepth():Int {
    if (this.depth + 1 > (depths.slotList.max - depths.slotList.start)) {
      this.cleanDepths();
    }
    this.depth++;
    return this.depth;
  }

  public function cleanDepths():Void {
    var i = 0;
    while (i < arr.length) {
      if (arr[i] == null) {
        arr.splice(i, 1);
      } else {
        arr[i].setDepth(depths.slotList.start + depths.slotList.dst * i);
        i++;
      }
    }
  }

  public function putOnTop(slot:Dynamic):Void {
    var id = this.arr.indexOf(slot);
    if (id > -1) {
      this.arr[id] = null;
      var d = this.getNextDepth();
      this.arr[d] = slot;
      slot.setDepth(depths.slotList.start + depths.slotList.dst * d);
    }
  }

  public function activate(slot:Dynamic):Bool {
    if (slot == null) return false;
    if (this.activeSlot == slot) return false;
    if (slot.flClose == true) return false;

    if (this.activeSlot != null) this.activeSlot.onDeactivate();

    this.activeSlot = slot;
    this.activeSlot.onActivate();
    return true;
  }
}
