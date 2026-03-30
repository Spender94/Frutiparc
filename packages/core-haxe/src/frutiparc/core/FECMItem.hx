package frutiparc.core;

/**
 * Portage Haxe du module AS2 FECMItem.
 * Source legacy: frutiengine/FECMItem.as
 */
class FECMItem {
  public var caption:String;
  public var callBack:CallbackDescriptor;
  public var flSeparatorBefore:Bool;
  public var flEnabled:Bool;
  public var flVisible:Bool;

  public function new(
    caption:String,
    callBack:CallbackDescriptor,
    flSeparatorBefore:Bool,
    flEnabled:Bool,
    flVisible:Bool
  ) {
    this.caption = caption;
    this.callBack = callBack;
    this.flSeparatorBefore = flSeparatorBefore;
    this.flEnabled = flEnabled;
    this.flVisible = flVisible;
  }

  public static function onSelect(mc:Dynamic, menuItem:FECMItem):Dynamic {
    var fn = Reflect.field(menuItem.callBack.obj, menuItem.callBack.method);
    return Reflect.callMethod(menuItem.callBack.obj, fn, [menuItem.callBack.args]);
  }
}

typedef CallbackDescriptor = {
  var obj:Dynamic;
  var method:String;
  var args:Dynamic;
}
