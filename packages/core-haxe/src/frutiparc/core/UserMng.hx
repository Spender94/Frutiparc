package frutiparc.core;

/**
 * Portage Haxe (noyau métier) du module AS2 UserMng.
 * Source legacy: frutiengine/UserMng.as
 */
class UserMng {
  public static function xpToLevel(xp:Float):Int {
    var value = Math.max(0, xp);
    return Math.floor(Math.sqrt(value / 10000) + 1);
  }

  public static function levelToXp(level:Float):Float {
    var v = Math.max(1, level);
    return Math.pow(v - 1, 2) * 10000;
  }

  public static function xpLevelCompletionRate(xp:Float):Float {
    var level = xpToLevel(xp);
    var xpOk = xp - levelToXp(level);
    var between = levelToXp(level + 1) - levelToXp(level);
    return xpOk / between;
  }

  public static function birthdayToAge(bd:String, now:Date):Int {
    if (bd == null || bd == "0000-00-00" || bd.length < 10) return 0;
    var y = Std.parseInt(bd.substr(0, 4));
    var m = Std.parseInt(bd.substr(5, 2));
    var d = Std.parseInt(bd.substr(8, 2));

    var ly = now.getFullYear();
    var lm = now.getMonth() + 1;
    var ld = now.getDate();

    return (lm > m || (lm == m && ld >= d)) ? ly - y : ly - y - 1;
  }

  public static function birthdayToMonthAge(bd:String, now:Date):Int {
    if (bd == null || bd == "0000-00-00 00:00:00" || bd.length < 19) return 0;
    var y = Std.parseInt(bd.substr(0, 4));
    var m = Std.parseInt(bd.substr(5, 2));
    var d = Std.parseInt(bd.substr(8, 2));

    var ly = now.getFullYear();
    var lm = now.getMonth() + 1;
    var ld = now.getDate();

    return (ly - y) * 12 + (lm - m) - (ld < d ? 1 : 0);
  }

  public static function formatInfoBasic(node:Dynamic, now:Date, langText:Dynamic):Dynamic {
    return {
      xpLevel: xpToLevel(Std.parseFloat(node.attributes.x)),
      xpCompletionRate: xpLevelCompletionRate(Std.parseFloat(node.attributes.x)),
      nickname: node.attributes.u,
      gender: node.attributes.sx,
      age: birthdayToAge(node.attributes.bd, now),
      birthday: node.attributes.bd,
      country: Lang.country(node.attributes.co, langText),
      countryCode: node.attributes.co,
      region: Lang.region(node.attributes.co, node.attributes.rg, langText),
    };
  }

  public var mcList:Array<Dynamic>;
  public var u:String;
  public var flMode:Bool;
  public var sortString:String;
  public var infoBasic:Dynamic;

  public function new(u:String, ?iB:Dynamic = null, ?flMode:Bool = false) {
    this.u = u;
    this.flMode = flMode;
    this.mcList = [];
    this.updateSortString();

    this.infoBasic = {
      status: { internal: null, external: null, emote: null },
      fbouille: "000503000000111010",
      presence: 0,
      xpLevel: 1,
      xpCompletionRate: 0,
      nickname: u,
      gender: "M",
      age: null,
      birthday: "",
      country: "",
      region: "",
      flMute: false,
    };

    if (iB != null) {
      for (n in Reflect.fields(iB)) Reflect.setField(this.infoBasic, n, Reflect.field(iB, n));
    }
  }

  public function setMc(mc:Dynamic):Void {
    if (mc == null) return;
    if (mcList.indexOf(mc) == -1) mcList.push(mc);
    if (this.infoBasic != null && Reflect.field(mc, "onInfoBasic") != null) mc.onInfoBasic(this.getInfoBasic());
  }

  public function unsetMc(mc:Dynamic):Void {
    var idx = mcList.indexOf(mc);
    if (idx >= 0) mcList.splice(idx, 1);
  }

  public function onAction(act:Dynamic):Void {
    for (mc in mcList) if (Reflect.field(mc, "onAction") != null) mc.onAction(act);
  }

  public function onStatusObj(obj:Dynamic):Void {
    if (obj == null) return;
    for (n in Reflect.fields(obj)) Reflect.setField(this.infoBasic, n, Reflect.field(obj, n));
    for (mc in mcList) if (Reflect.field(mc, "onInfoBasic") != null) mc.onInfoBasic(obj);
  }

  public function setInfoBasic(obj:Dynamic):Void {
    for (n in Reflect.fields(obj)) Reflect.setField(this.infoBasic, n, Reflect.field(obj, n));
  }

  public function getInfoBasic():Dynamic return this.infoBasic;

  public function updateSortString():Void {
    this.sortString = (this.flMode ? "0" : "1") + this.u.toLowerCase();
  }
}
