package frutiparc.core;

/**
 * Portage Haxe pragmatique de FEMC (helpers non-Flash critiques).
 * Source legacy: frutiengine/FEMC.as
 */
class FEMC {
  public static function setColor(mc:Dynamic, o:Dynamic, ?negFlag:Bool = false):Dynamic {
    var col:Dynamic = null;
    if (Reflect.field(o, "r") != null) {
      var alpha = Reflect.field(o, "a");
      if (alpha == null) alpha = 0;
      col = {
        rb: Reflect.field(o, "r"),
        gb: Reflect.field(o, "g"),
        bb: Reflect.field(o, "b"),
        ab: alpha,
      };
    } else if (Std.isOfType(o, Int) || Std.isOfType(o, Float)) {
      var n:Int = Std.int(o);
      col = {
        rb: (n >> 16) & 255,
        gb: (n >> 8) & 255,
        bb: n & 255,
      };
    } else {
      return null;
    }

    if (negFlag) {
      col.ra = -100;
      col.ga = -100;
      col.ba = -100;
    } else {
      col.ra = 100;
      col.ga = 100;
      col.ba = 100;
      col.rb -= 255;
      col.gb -= 255;
      col.bb -= 255;
    }

    Reflect.setField(mc, "lastTransform", col);
    return col;
  }

  public static function setPColor(mc:Dynamic, color:Dynamic, percent:Float):Dynamic {
    var c = color;
    if (Std.isOfType(color, Int) || Std.isOfType(color, Float)) {
      c = FENumber.toColorObj(Std.int(color));
    }

    if (Reflect.field(mc, "colorObject") == null) {
      Reflect.setField(mc, "colorObject", {
        actual: {
          col: {r: 0, g: 0, b: 0},
          percent: 100,
        }
      });
    }

    if (c != null) {
      Reflect.field(mc, "colorObject").actual = {col: c, percent: percent};
    }

    var act = Reflect.field(mc, "colorObject").actual;
    var coef = (100 - act.percent) / 100;
    var tr = {
      ra: act.percent,
      ga: act.percent,
      ba: act.percent,
      aa: 100,
      rb: act.col.r * coef,
      gb: act.col.g * coef,
      bb: act.col.b * coef,
      ab: 0,
    };

    Reflect.setField(mc, "lastTransform", tr);
    return tr;
  }

  public static function killColor(mc:Dynamic):Dynamic {
    var tr = {
      ra: 100,
      ga: 100,
      ba: 100,
      aa: 100,
      rb: 0,
      gb: 0,
      bb: 0,
      ab: 0,
    };
    Reflect.setField(mc, "lastTransform", tr);
    return tr;
  }

  public static function morphToButton(mc:Dynamic):Void {
    mc.onRollOver = function() {
      mc.gotoAndStop(2);
      if (Reflect.field(mc, "onFrutiRollOver") != null) mc.onFrutiRollOver();
    }
    mc.onRollOut = function() {
      mc.gotoAndStop(1);
      if (Reflect.field(mc, "onFrutiRollOut") != null) mc.onFrutiRollOut();
    }
    mc.onPress = function() {
      mc.gotoAndStop(3);
      if (Reflect.field(mc, "onFrutiPress") != null) mc.onFrutiPress();
    }
    mc.onRelease = function() {
      mc.gotoAndStop(2);
      if (Reflect.field(mc, "onFrutiRelease") != null) mc.onFrutiRelease();
    }
    if (Reflect.field(mc, "stop") != null) mc.stop();
  }

  public static function toString(mc:Dynamic, ?l:Int = 0):String {
    if (Reflect.field(mc, "isRoot") == true) return "_root";
    if (l > 10) return "..";

    if (l == 0) {
      return "[MovieClip: " + toString(mc._parent, l + 1) + "." + mc._name + "]";
    }
    return toString(mc._parent, l + 1) + "." + mc._name;
  }
}
