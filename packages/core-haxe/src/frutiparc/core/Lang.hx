package frutiparc.core;

/**
 * Portage Haxe (noyau métier) du module AS2 Lang.
 * Source legacy: frutiengine/Lang.as
 */
class Lang {
  public static var varName = "langText";

  public static function fv(path:String, obj:Dynamic, langText:Dynamic):String {
    var base:Dynamic = dig(langText, path);
    return base != null ? FEString.formatVars(Std.string(base), obj) : "[ERR] " + path;
  }

  public static function formatDateObject(obj:Dynamic, format:String, langText:Dynamic):String {
    Reflect.setField(obj, "A", dig(langText, "date.day_short." + Reflect.field(obj, "b")));
    Reflect.setField(obj, "a", dig(langText, "date.day." + Reflect.field(obj, "b")));
    Reflect.setField(obj, "M", dig(langText, "date.month_short." + Reflect.field(obj, "n")));
    Reflect.setField(obj, "m", dig(langText, "date.month." + Reflect.field(obj, "n")));

    var base:Dynamic = (format != null) ? dig(langText, "date.format_" + format) : null;
    return base != null ? FEString.formatVars(Std.string(base), obj) : FEString.formatVars("$Y-$N-$D $H:$I:$S", obj);
  }

  public static function formatDate(date:Date, format:String, langText:Dynamic):String {
    return formatDateObject(FEDate.getCompleteObject(date), format, langText);
  }

  public static function formatDateString(date:String, format:String, langText:Dynamic):String {
    return formatDate(FEDate.newFromString(date), format, langText);
  }

  public static function formatDateTime(t:Float, format:String, langText:Dynamic):String {
    return formatDate(FEDate.newFromTime(t), format, langText);
  }

  public static function formatDuration(dur:Float, format:String, langText:Dynamic):String {
    var d = Math.round(dur);
    var obj:Dynamic = {
      m: d % 1000,
      s: Math.floor(d / 1000) % 60,
      i: Math.floor(d / 60000) % 60,
      h: Math.floor(d / 3600000),
    };
    var f = format == null ? "default" : format;
    if (obj.h > 0) return FEString.formatVars(dig(langText, "duration.format_" + f + ".h"), obj);
    if (obj.i > 0) return FEString.formatVars(dig(langText, "duration.format_" + f + ".i"), obj);
    if (obj.s > 0) return FEString.formatVars(dig(langText, "duration.format_" + f + ".s"), obj);
    return FEString.formatVars(dig(langText, "duration.format_" + f + ".m"), obj);
  }

  public static function card2ord(p:Int, langText:Dynamic):String {
    var key = switch (p) {
      case 1: "first";
      case 2: "second";
      case 3: "third";
      case 4: "fourth";
      case 5: "fifth";
      default: "def";
    }
    return Std.string(p) + Std.string(dig(langText, "ordinal." + key));
  }

  public static function country(co:String, langText:Dynamic):String {
    var r = dig(langText, "countries." + co + ".name");
    return r == null ? "Inconnu" : Std.string(r);
  }

  public static function region(co:String, rg:String, langText:Dynamic):String {
    var r = dig(langText, "countries." + co + ".region." + rg);
    return r == null ? "Inconnu" : Std.string(r);
  }

  public static function sign(fs:Int, langText:Dynamic):Dynamic {
    return dig(langText, "sign." + fs);
  }

  public static function gameName(discName:String, langText:Dynamic):String {
    var r = dig(langText, "disc_to_game." + discName);
    return r == null ? discName : Std.string(r);
  }

  public static function getTipDoc(id:String, langText:Dynamic):Dynamic {
    return dig(langText, "tip_doc." + id);
  }

  static function dig(obj:Dynamic, path:String):Dynamic {
    var cur:Dynamic = obj;
    for (part in path.split(".")) {
      if (cur == null) return null;
      cur = Reflect.field(cur, part);
    }
    return cur;
  }
}
