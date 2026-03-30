package frutiparc.core;

/**
 * Portage Haxe pragmatique de CBeeManager.
 * Focus: orchestration des connexions CBee + listeners (sans LocalConnection Flash).
 */
class CBeeManager {
  public var className:String = "CBee";
  public var timeout:Int = 1000;
  public var cnxTimeout:Int = 60000;
  public var cbeeCnx:Map<String, Dynamic>;
  public var now:Void->Float;
  public var host:String;

  public function new(?o:Dynamic = null) {
    this.cbeeCnx = new Map();
    this.now = function() return Date.now().getTime();
    this.host = "localhost";

    if (o != null) for (n in Reflect.fields(o)) Reflect.setField(this, n, Reflect.field(o, n));
  }

  public function addListener(port:Int, lc:Dynamic, ?notRecallMe:Bool = false):Dynamic {
    if (lc == null) return null;
    var key = Std.string(port);

    if (!cbeeCnx.exists(key)) {
      addCnx(port, false, null);
    } else if (!cbeeCnx.get(key).cbee.connected) {
      cbeeCnx.get(key).cbee.connect(this.host, port);
    }

    var listeners:Array<Dynamic> = cbeeCnx.get(key).listeners;
    if (listeners.indexOf(lc) == -1) listeners.push(lc);

    return cbeeCnx.get(key).lc;
  }

  public function getStatus(port:Int, lc:Dynamic):Dynamic {
    var cc = cbeeCnx.get(Std.string(port));
    if (cc == null) return null;

    var obj = {
      connected: cc.cbee.connected,
      logged: Reflect.field(cc.cbee, "logged") == true,
    };

    if (lc != null && Reflect.field(lc, "onStatus") != null) lc.onStatus(obj);
    return obj;
  }

  public function removeListener(port:Int, lc:Dynamic, ?forceClose:Bool = false):Void {
    var cc = cbeeCnx.get(Std.string(port));
    if (cc == null) return;

    var i = cc.listeners.indexOf(lc);
    if (i >= 0) cc.listeners.splice(i, 1);

    if (cc.listeners.length == 0) {
      if (forceClose) removeCnx(port);
      else cc.emptyTime = now();
    }
  }

  public function addCnx(port:Int, ?force:Bool = false, ?obj:Dynamic = null):Dynamic {
    var cbee = new CBee(obj);
    cbee.connect(this.host, port);
    cbee.setGlobalListener({obj: this, method: "onGlobalListener"});

    var lc = new CBeeLC(cbee);

    cbeeCnx.set(Std.string(port), {
      cbee: cbee,
      lc: lc,
      listeners: [],
      emptyTime: now(),
      force: force,
    });

    return cbee;
  }

  public function removeCnx(port:Int):Void {
    var key = Std.string(port);
    var cc = cbeeCnx.get(key);
    if (cc == null) return;

    cc.cbee.setGlobalListener(null);
    cbeeCnx.remove(key);
  }

  public function onGlobalListener(port:Int, event:String, data:Dynamic):Void {
    var cc = cbeeCnx.get(Std.string(port));
    if (cc == null) return;

    if (event == "onClose" && !cc.force && cc.listeners.length == 0) {
      removeCnx(port);
      return;
    }

    for (e in cc.listeners) {
      if (e != null && Reflect.field(e, event) != null) Reflect.callMethod(e, Reflect.field(e, event), [data]);
    }
  }

  public function checkAll():Void {
    for (port in cbeeCnx.keys()) {
      var cc = cbeeCnx.get(port);
      if (!cc.force && cc.listeners.length == 0 && now() - cc.emptyTime > cnxTimeout) {
        removeCnx(Std.parseInt(port));
      }
    }
  }
}
