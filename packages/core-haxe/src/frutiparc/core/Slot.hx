package frutiparc.core;

/**
 * Portage Haxe (noyau métier) du module AS2 Slot.
 * Source legacy: frutiengine/Slot.as
 */
class Slot {
  public static var depths:Dynamic = {
    boxList: {
      start: 0,
      dst: 1,
      max: 100,
    }
  };

  public var slotList:Dynamic;
  public var arr:Array<Dynamic>;
  public var nbBox:Int;
  public var flActive:Bool;
  public var baseDepth:Int;
  public var depth:Int;
  public var activeBox:Dynamic;
  public var title:String;
  public var flWarning:Bool;
  public var flDesktopable:Bool;
  public var flClose:Bool;

  public function new() {
    this.nbBox = 0;
    this.flActive = false;
    this.flWarning = false;
    this.depth = -1;
    this.activeBox = null;
    this.flDesktopable = false;
    this.flClose = false;
    this.arr = [];
    this.baseDepth = 0;
  }

  public function init(slotList:Dynamic, baseDepth:Int, ?flGo:Bool = false):Void {
    this.arr = [];
    this.slotList = slotList;
    this.baseDepth = baseDepth;

    if (flGo) this.slotList.activate(this);
  }

  public function setDepth(baseDepth:Int):Void {
    this.baseDepth = baseDepth;
    this.cleanDepths();
  }

  public function addBox(box:Dynamic):Void {
    var d = this.getNextDepth();
    this.arr[d] = box;
    this.nbBox++;
    box.init(this, this.baseDepth + depths.boxList.start + depths.boxList.dst * d);
    this.activate(box);
    this.onBoxListChanged();
  }

  public function rmBox(box:Dynamic):Void {
    var id = this.arr.indexOf(box);
    if (id > -1) {
      this.arr[id] = null;
      this.nbBox--;
      this.onBoxListChanged();
    }
  }

  public function getNextDepth():Int {
    if (this.depth + 1 > (depths.boxList.max - depths.boxList.start)) {
      this.cleanDepths();
    }
    this.depth++;
    return this.depth;
  }

  public function cleanDepths():Void {
    var i = 0;
    while (i < this.arr.length) {
      if (this.arr[i] == null) {
        this.arr.splice(i, 1);
      } else {
        this.arr[i].setDepth(this.baseDepth + depths.boxList.start + depths.boxList.dst * i);
        i++;
      }
    }
  }

  public function putOnTop(box:Dynamic):Void {
    var id = this.arr.indexOf(box);
    if (id > -1) {
      this.arr[id] = null;
      var d = this.getNextDepth();
      this.arr[d] = box;
      box.setDepth(this.baseDepth + depths.boxList.start + depths.boxList.dst * d);
    }
  }

  public function onBoxListChanged():Void {}

  public function close():Void {
    this.flClose = true;
    this.slotList.rmSlot(this);
  }

  public function tryToClose():Void {
    if (this.arr.length == 0) {
      this.close();
    } else {
      for (i in 0...this.arr.length) {
        if (this.arr[i] != null) this.arr[i].tryToClose();
      }
    }
  }

  public function onActivate():Void {
    this.flActive = true;

    if (this.flWarning) this.onStopWarning();

    for (i in 0...this.arr.length) if (this.arr[i] != null) this.arr[i].onSlotActivate();
  }

  public function onDeactivate():Void {
    this.flActive = false;
    for (i in 0...this.arr.length) if (this.arr[i] != null) this.arr[i].onSlotDeactivate();
  }

  public function activate(box:Dynamic):Bool {
    if (this.activeBox == box) return false;
    if (this.activeBox != null) this.activeBox.onDeactivate();

    this.activeBox = box;
    this.putOnTop(box);
    this.activeBox.onActivate();
    return true;
  }

  public function move(box:Dynamic, newSlot:Dynamic):Void {
    this.rmBox(box);
    newSlot.addBox(box);
  }

  public function setTitle(t:String):Void {
    this.title = t;
  }

  public function warning():Bool {
    if (this.flActive) return false;
    if (this.flWarning) return false;

    this.onWarning();
    return true;
  }

  public function onWarning():Bool {
    if (this.flWarning) return false;

    this.flWarning = true;
    return true;
  }

  public function onStopWarning():Bool {
    if (!this.flWarning) return false;

    this.flWarning = false;
    return true;
  }

  public function onStageResize():Void {}
}
