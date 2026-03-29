package frutiparc.core;

/**
 * Portage Haxe du module AS2 FEColor.
 * Source legacy: frutiengine/FEColor.as
 */
class FEColor {
  public static function toRGBObj(nb:Int):RGB {
    var r = (nb >> 16) & 255;
    var g = (nb >> 8) & 255;
    var b = nb & 255;
    return { r: r, g: g, b: b };
  }

  public static function toRGBInt(obj:RGB):Int {
    return obj.r * 256 * 256 + obj.g * 256 + obj.b;
  }
}

typedef RGB = {
  var r:Int;
  var g:Int;
  var b:Int;
}
