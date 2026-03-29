package frutiparc.core;

/**
 * Portage Haxe (subset pragmatique) du module AS2 FEString.
 * Source legacy: frutiengine/FEString.as
 */
class FEString {
  public static function replace(str:String, search:String, repl:String):String {
    if (search.length == 0) return str;
    return str.split(search).join(repl);
  }

  public static function decode62(n:String):Float {
    var r:Float = 0;
    var coef:Float = 1;
    for (i in 0...n.length) {
      var c = n.substr(n.length - 1 - i, 1);
      var t:Float;
      if (c.toLowerCase() == c) {
        t = parseInt(c, 36);
      } else {
        t = parseInt(c.toLowerCase(), 36) + 26;
      }
      r += t * coef;
      coef *= 62;
    }
    return r;
  }

  public static function unHTML(r:String):String {
    if (r.length <= 0) return r;
    return replace(replace(replace(r, "&", "&amp;"), "<", "&lt;"), ">", "&gt;");
  }

  public static function rmChr(r:String, aChar:String):String {
    if (r.length <= 0) return r;
    return replace(r, aChar, "");
  }

  public static function ltrim(str:String):String {
    var i = 0;
    while (i < str.length && (str.substr(i, 1) == " " || str.substr(i, 1) == String.fromCharCode(13))) i++;
    return str.substring(i);
  }

  public static function rtrim(str:String):String {
    var i = str.length - 1;
    while (i >= 0 && (str.substr(i, 1) == " " || str.substr(i, 1) == String.fromCharCode(13))) i--;
    return str.substr(0, i + 1);
  }

  public static function trim(str:String):String {
    return ltrim(rtrim(str));
  }

  public static function repeat(str:String, l:Int):String {
    var r = "";
    for (i in 0...l) r += str;
    return r;
  }

  public static function countUpperCase(str:String):Int {
    var count = 0;
    for (i in 0...str.length) {
      var t = str.substr(i, 1);
      if (t != t.toLowerCase()) count++;
    }
    return count;
  }

  public static function startsWith(str1:String, str2:String):Bool {
    return str1.substr(0, str2.length) == str2;
  }

  public static function endsWith(str1:String, str2:String):Bool {
    return str1.substr(str1.length - str2.length) == str2;
  }

  public static function checkRepeat(str:String, max:Int):Bool {
    if (str.length == 0) return false;
    var last = str.charAt(0);
    var nb = 1;
    for (i in 1...str.length) {
      var j = str.charAt(i);
      if (j == last) nb++; else {
        nb = 1;
        last = j;
      }
      if (nb > max) return true;
    }
    return false;
  }


  public static function formatVars(str:String, obj:Dynamic):String {
    var pos = str.indexOf("$");
    while (pos > -1) {
      var n = str.substr(pos + 1, 1);
      if (n == "$") {
        str = str.substr(0, pos) + "$" + str.substring(pos + 2, str.length);
        pos = str.indexOf("$", pos + 2);
      } else {
        var r:Dynamic = Reflect.field(obj, n);
        str = str.substr(0, pos) + Std.string(r) + str.substring(pos + 2, str.length);
        pos = str.indexOf("$", pos + Std.string(r).length);
      }
    }
    return str;
  }

  public static function replaceBackSlashN(r:String):String {
    return replace(r, "\\n", "\n");
  }
}
