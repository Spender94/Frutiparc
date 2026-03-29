package frutiparc.core;

/**
 * Portage Haxe (noyau métier) du module AS2 WinBox.
 * Source legacy: frutiengine/WinBox.as
 */
class WinBox {
  public var initialized:Bool = false;
  public var slot:Dynamic;
  public var depth:Int;
  public var flShow:Bool = false;
  public var flActive:Bool = false;
  public var wasShow:Bool = false;
  public var title:String;
  public var flClosed:Bool = false;
  public var window:Dynamic;
  public var mode:String;

  public function new() {}

  public function preInit():Void {
    if (this.title == null) this.title = "";
  }

  public function init(slot:Dynamic, depth:Int):Bool {
    var rs = !this.initialized;
    if (rs) this.preInit();

    this.initialized = true;
    this.slot = slot;
    this.depth = depth;
    this.flShow = true;

    return rs;
  }

  public function setDepth(depth:Int):Void {
    this.depth = depth;
  }

  public function close():Void {
    this.slot.rmBox(this);
    this.flClosed = true;
  }

  public function tryToClose():Void {
    this.close();
  }

  public function hide():Void {
    this.flShow = false;
  }

  public function show():Void {
    this.flShow = true;
  }

  public function onActivate():Void {
    this.flActive = true;
  }

  public function onDeactivate():Void {
    this.flActive = false;
  }

  public function onSlotActivate():Void {
    if (this.wasShow) this.show();
    this.wasShow = false;
  }

  public function onSlotDeactivate():Void {
    if (this.flShow) {
      this.wasShow = true;
      this.hide();
    } else {
      this.wasShow = false;
    }
  }

  public function activate():Void {
    this.slot.activate(this);
  }

  public function move(newSlot:Dynamic):Bool {
    if (this.slot == newSlot) return false;

    this.slot.move(this, newSlot);
    return true;
  }

  public function setTitle(t:String):Void {
    this.title = t;
  }
}
