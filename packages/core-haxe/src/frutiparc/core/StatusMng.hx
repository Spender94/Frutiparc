package frutiparc.core;

/**
 * Portage Haxe (noyau métier) du module AS2 StatusMng.
 * Source legacy: frutiengine/StatusMng.as
 */
class StatusMng {
  public static var externalList:Array<Dynamic> = [null, "eat", "work", "zzz", "phone", "away"];
  public static var internalList:Array<Dynamic> = [null, "forum", "bkiwi", "mb2", "swapou2", "snake3", "bandas", "grapiz", "kaluga", "miniwave"];

  public static function analyseStr(str:String):Dynamic {
    var iExt = FEString.decode62(str.substr(0, 1));
    if (Math.isNaN(iExt)) iExt = 0;

    var iInt = FEString.decode62(str.substr(1, 2));
    if (Math.isNaN(iInt)) iInt = 0;

    var iEmote = FEString.decode62(str.substr(3, 1));
    if (Math.isNaN(iEmote)) iEmote = 0;

    return {
      external: externalList[Std.int(iExt)],
      internal: internalList[Std.int(iInt)],
      emote: Std.int(iEmote),
    };
  }

  public var external:Int = 0;
  public var internal:Int = 0;
  public var emote:Int = 0;
  public var cnx:Dynamic;
  public var last:String;

  public function new() {}

  public function setExternal(name:String):Void {
    this.external = 0;
    for (i in 0...externalList.length) {
      if (externalList[i] == name) {
        this.external = i;
        break;
      }
    }
    send();
  }

  public function setInternal(name:String):Void {
    var idx = internalList.indexOf(name);
    this.internal = idx < 0 ? 0 : idx;
    send();
  }

  public function unsetInternal(name:String):Void {
    var idx = internalList.indexOf(name);
    if (this.internal == idx) {
      this.internal = 0;
      send();
    }
  }

  public function setEmote(eId:Dynamic):Void {
    var parsed = Std.parseInt(Std.string(eId));
    if (parsed == null) return;

    this.emote = parsed;
    send();
  }

  public function setCnx(cnx:Dynamic):Void {
    this.cnx = cnx;
  }

  public function send():Bool {
    var str = FENumber.encode62(this.external, 1) + FENumber.encode62(this.internal, 2) + FENumber.encode62(this.emote, 0);
    if (str == this.last) return false;
    if (this.cnx != null && Reflect.field(this.cnx, "cmd") != null) {
      this.cnx.cmd("status", {s: str});
    }
    this.last = str;
    return true;
  }
}
