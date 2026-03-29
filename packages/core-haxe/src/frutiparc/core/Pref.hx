package frutiparc.core;

/**
 * Portage Haxe (noyau métier) du module AS2 Pref.
 * Source legacy: frutiengine/Pref.as
 */
class Pref {
  public var types:Dynamic;
  public var prefs:Dynamic;
  public var prefsId:Array<String>;

  public function new() {
    this.types = { b: "bool", i: "int", s: "string" };
    this.prefs = {};
    this.prefsId = [];
  }

  public function onLoadPrefDef(success:Bool, data:Dynamic):Void {
    if (!success) return;
    var str:String = Reflect.field(data, "PrefDef");
    while (str.length > 0) {
      var id = Std.int(FEString.decode62(str.substr(0, 2)));
      str = str.substr(2);

      var t:String = Reflect.field(types, str.substr(0, 1));
      str = str.substr(1);

      var l1 = Std.int(FEString.decode62(str.substr(0, 2)));
      var name = str.substr(2, l1);
      str = str.substr(l1 + 2);

      var l2 = Std.int(FEString.decode62(str.substr(0, 2)));
      var defaultValue:Dynamic = str.substr(2, l2);
      str = str.substr(l2 + 2);

      defaultValue = convert(defaultValue, t);
      var entry:Dynamic = { type: t, default_value: defaultValue, value: defaultValue, id: id };
      Reflect.setField(this.prefs, name, entry);
      this.prefsId[id] = name;
    }
  }

  public function useMyPref(str:String):Void {
    while (str.length > 0) {
      var id = Std.int(FEString.decode62(str.substr(0, 2)));
      var l = Std.int(FEString.decode62(str.substr(2, 2)));
      var value:Dynamic = str.substr(4, l);
      str = str.substr(l + 4);

      var name = this.prefsId[id];
      var pref = Reflect.field(this.prefs, name);
      var t = Reflect.field(pref, "type");
      value = convert(value, t);
      if (value != null) Reflect.setField(pref, "value", value);
    }
  }

  public function getFormatedPref():String {
    var r = "";
    for (n in Reflect.fields(this.prefs)) {
      var o:Dynamic = Reflect.field(this.prefs, n);
      if (Reflect.field(o, "value") != Reflect.field(o, "default_value")) {
        var content:String;
        switch (Reflect.field(o, "type")) {
          case "bool":
            content = Reflect.field(o, "value") ? "Y" : "N";
          case "int":
            content = FENumber.encode62(Std.int(Reflect.field(o, "value")));
          default:
            content = Std.string(Reflect.field(o, "value"));
        }
        r += FENumber.encode62(Std.int(Reflect.field(o, "id")), 2);
        r += FENumber.encode62(content.length, 2) + content;
      }
    }
    return r;
  }

  public function getPref(n:String):Dynamic {
    var pref = Reflect.field(this.prefs, n);
    if (n == "cache_length" && Reflect.field(pref, "value") == null) return 30;
    return Reflect.field(pref, "value");
  }

  public function setPref(n:String, v:Dynamic):Void {
    var pref = Reflect.field(this.prefs, n);
    Reflect.setField(pref, "value", v);
  }

  public function setFromCopy(nPrefs:Dynamic):Void {
    for (n in Reflect.fields(nPrefs)) {
      var u = Reflect.field(nPrefs, n);
      var o = Reflect.field(this.prefs, Reflect.field(u, "name"));
      if (o == null) continue;
      Reflect.setField(o, "value", Reflect.field(u, "value"));
    }
  }

  public function getACopy():Dynamic {
    return FEObject.recursiveClone(this.prefs);
  }

  public function convert(value:Dynamic, t:String):Dynamic {
    if (t == "int") {
      var v = FEString.decode62(Std.string(value));
      return Math.isNaN(v) ? null : v;
    }
    if (t == "bool") return Std.string(value) == "Y";
    return value;
  }
}
