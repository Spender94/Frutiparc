package frutiparc.core;

/**
 * Portage Haxe (subset utile) du module AS2 FEDate.
 * Source legacy: frutiengine/FEDate.as
 */
class FEDate {
  public static function newFromString(str:String):Date {
    var y = Std.parseInt(str.substr(0, 4));
    var m = Std.parseInt(str.substr(5, 2));
    var d = Std.parseInt(str.substr(8, 2));

    var h = Std.parseInt(str.substr(11, 2));
    var i = Std.parseInt(str.substr(14, 2));
    var s = Std.parseInt(str.substr(17, 2));

    var hh = (h == null) ? 0 : h;
    var ii = (i == null) ? 0 : i;
    var ss = (s == null) ? 0 : s;

    return Date.fromTime(DateTools.makeUtc(y, m, d, hh, ii, ss));
  }

  public static function newFromTime(t:Float):Date {
    return Date.fromTime(t);
  }

  public static function getObject(d:Date):DateObject {
    return {
      y: FENumber.toStringL(d.getFullYear(), 4),
      m: FENumber.toStringL(d.getMonth() + 1, 2),
      day: FENumber.toStringL(d.getDate(), 2),
      h: FENumber.toStringL(d.getHours(), 2),
      i: FENumber.toStringL(d.getMinutes(), 2),
      s: FENumber.toStringL(d.getSeconds(), 2),
    };
  }

  public static function getCompleteObject(d:Date):CompleteDateObject {
    var b = d.getDay();
    if (b == 0) b = 7;

    return {
      y: FENumber.toStringL(d.getFullYear() % 100, 2),
      Y: FENumber.toStringL(d.getFullYear(), 4),
      b: FENumber.toStringL(b, 1),
      day: FENumber.toStringL(d.getDate(), 1),
      D: FENumber.toStringL(d.getDate(), 2),
      n: FENumber.toStringL(d.getMonth() + 1, 1),
      N: FENumber.toStringL(d.getMonth() + 1, 2),
      h: FENumber.toStringL(d.getHours(), 1),
      H: FENumber.toStringL(d.getHours(), 2),
      i: FENumber.toStringL(d.getMinutes(), 1),
      I: FENumber.toStringL(d.getMinutes(), 2),
      s: FENumber.toStringL(d.getSeconds(), 1),
      S: FENumber.toStringL(d.getSeconds(), 2),
    };
  }
}

typedef DateObject = {
  var y:String;
  var m:String;
  var day:String;
  var h:String;
  var i:String;
  var s:String;
}

typedef CompleteDateObject = {
  var y:String;
  var Y:String;
  var b:String;
  var day:String;
  var D:String;
  var n:String;
  var N:String;
  var h:String;
  var H:String;
  var i:String;
  var I:String;
  var s:String;
  var S:String;
}
