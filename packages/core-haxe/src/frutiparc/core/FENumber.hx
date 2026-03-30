package frutiparc.core;

/**
 * Portage Haxe (subset utile) du module AS2 FENumber.
 * Source legacy: frutiengine/FENumber.as
 */
class FENumber {
  public static function toColorObj(nb:Int):ColorObj {
    return {
      r: (nb >> 16) & 0xFF,
      g: (nb >> 8) & 0xFF,
      b: nb & 0xFF,
    };
  }

  public static function toAlphaString(nb:Int):String {
    if (nb > 26) {
      var next:String;
      if (nb % 26 == 0) {
        next = toAlphaString(Std.int(Math.floor((nb - 1) / 26)));
        nb = 26;
      } else {
        next = toAlphaString(Std.int(Math.floor(nb / 26)));
        nb %= 26;
      }
      nb += 9;
      return next + base36Char(nb);
    }
    return base36Char(nb + 9);
  }

  public static function encode62(n:Int, ?strlen:Int = 1):String {
    var ret = "";
    var value = n;
    while (value > 0) {
      var t = value % 62;
      if (t < 36) ret = base36Char(t).toLowerCase() + ret;
      else ret = base36Char(t - 26).toUpperCase() + ret;
      value = Std.int((value - t) / 62);
    }
    while (strlen > ret.length) ret = "0" + ret;
    return ret;
  }

  public static function toStringL(n:Dynamic, l:Int):String {
    var value:Float = (n == null || Math.isNaN(n)) ? 0 : n;
    var s = Std.string(Std.int(value));
    while (s.length < l) s = "0" + s;
    return s;
  }

  public static function modCol(nb:Int, ?inc:Float = 0, ?coef:Float = 1):Int {
    var c = toColorObj(nb);
    var r = clamp(Math.round((c.r + inc) * coef));
    var g = clamp(Math.round((c.g + inc) * coef));
    var b = clamp(Math.round((c.b + inc) * coef));
    return (r << 16) + (g << 8) + b;
  }

  static function clamp(v:Int):Int {
    return Std.int(Math.min(Math.max(0, v), 255));
  }

  static function base36Char(v:Int):String {
    return "0123456789abcdefghijklmnopqrstuvwxyz".charAt(v);
  }
}

typedef ColorObj = {
  var r:Int;
  var g:Int;
  var b:Int;
}
