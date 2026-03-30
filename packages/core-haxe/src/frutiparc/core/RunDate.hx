package frutiparc.core;

/**
 * Portage Haxe du module AS2 RunDate.
 * Source legacy: frutiengine/RunDate.as
 */
class RunDate {
  public var ref:Date;
  public var refLocal:Date;
  public var diff:Float;

  public function new() {
    this.diff = 0;
  }

  public function setFromString(str:String):Void {
    this.refLocal = Date.now();
    this.ref = FEDate.newFromString(str);
    this.diff = this.ref.getTime() - this.refLocal.getTime();
  }

  public function getTime():Float {
    var d = Date.now();
    if (this.ref != null) return d.getTime() + this.diff;
    return d.getTime();
  }

  public function getDateObject():Date {
    var d = Date.now();
    if (this.ref != null) d = Date.fromTime(d.getTime() + this.diff);
    return d;
  }

  public function getObject():Dynamic {
    return FEDate.getObject(getDateObject());
  }

  public function getCompleteObject():Dynamic {
    return FEDate.getCompleteObject(getDateObject());
  }

  public function toString():String {
    return getDateObject().toString();
  }

  public function toFormat(format:String, formatter:Dynamic->String->String):String {
    return formatter(this.getCompleteObject(), format);
  }

  public function getCurrentFSign():Dynamic {
    var t = this.getTime() / 1000;
    return {
      sign: Math.floor(((t - 345600) / 604800) % 10),
      signb: Math.floor((t / 3600) % 10),
      signCompletion: ((t - 345600) / 604800) % 1,
      signbCompletion: (t / 3600) % 1,
    };
  }
}
