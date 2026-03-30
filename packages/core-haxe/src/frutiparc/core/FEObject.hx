package frutiparc.core;

/**
 * Portage Haxe du module AS2 FEObject.
 * Source legacy: frutiengine/FEObject.as
 */
class FEObject {
  public static function clone(obj:Dynamic):Dynamic {
    var r:Dynamic = {};
    for (f in Reflect.fields(obj)) {
      Reflect.setField(r, f, Reflect.field(obj, f));
    }
    return r;
  }

  public static function recursiveClone(obj:Dynamic):Dynamic {
    var r:Dynamic = {};
    for (f in Reflect.fields(obj)) {
      var value = Reflect.field(obj, f);
      if (Reflect.isObject(value) && value != null) {
        Reflect.setField(r, f, recursiveClone(value));
      } else {
        Reflect.setField(r, f, value);
      }
    }
    return r;
  }

  public static function addObject(obj:Dynamic, o:Dynamic, ?splash:Bool = false):Void {
    for (element in Reflect.fields(o)) {
      var current = Reflect.field(obj, element);
      if (current == null || splash) {
        Reflect.setField(obj, element, Reflect.field(o, element));
      }
    }
  }

  public static function toColNumber(obj:RGB):Int {
    var str = "0x" + StringTools.hex(obj.r, 1).toLowerCase() + StringTools.hex(obj.g, 1).toLowerCase() + StringTools.hex(obj.b, 1).toLowerCase();
    return Std.parseInt(str);
  }
}

typedef RGB = {
  var r:Int;
  var g:Int;
  var b:Int;
}
