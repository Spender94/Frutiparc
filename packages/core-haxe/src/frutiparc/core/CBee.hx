package frutiparc.core;

/**
 * Portage Haxe pragmatique de CBee (orchestration commandes/listeners).
 * Source legacy: frutiengine/CBee.as
 */
class CBee {
  public var listeners:Map<String, Array<Dynamic>>;
  public var specificListeners:Map<String, Dynamic>;
  public var cmdList:Map<String, String>;
  public var host:String;
  public var port:Int;
  public var connected:Bool;
  public var globalListener:Dynamic;
  public var cnxNb:Int = 0;
  public var sentLog:Array<Dynamic>;

  public function new(?o:Dynamic = null) {
    this.cmdList = new Map();
    this.cmdList.set("onclose", "onclose");
    this.cmdList.set("onconnect", "onconnect");

    this.listeners = new Map();
    this.specificListeners = new Map();
    this.sentLog = [];
    this.connected = false;

    if (o != null) for (n in Reflect.fields(o)) Reflect.setField(this, n, Reflect.field(o, n));
  }

  public function debug(str:String):Void {}

  public function connect(host:String, port:Int):Void {
    this.host = host;
    this.port = port;
    this.connected = false;
  }

  public function onConnect(success:Bool):Void {
    callGlobalListener("onConnect", success);
    if (success) {
      this.connected = true;
      this.cnxNb++;
    } else {
      this.connected = false;
    }
    callListenersArray(this.listeners.get("onconnect"), success);
  }

  public function onClose():Void {
    callGlobalListener("onClose", null);
    this.connected = false;
    callListenersArray(this.listeners.get("onclose"), null);
  }

  public function onXML(node:Dynamic):Void {
    if (node == null) return;

    var cmdName = Std.string(Reflect.field(node, "nodeName")).toLowerCase();
    callListenersArray(this.listeners.get(cmdName), node);

    var attrs:Dynamic = Reflect.field(node, "attributes");
    if (attrs != null) {
      for (attrib in Reflect.fields(attrs)) {
        var byCmd = specificListeners.get(cmdName);
        if (byCmd == null) continue;
        var byAttr = Reflect.field(byCmd, attrib);
        if (byAttr == null) continue;
        var val = Std.string(Reflect.field(attrs, attrib));
        callListenersArray(Reflect.field(byAttr, val), node);
      }
    }

    callGlobalListener("onXML", node);
  }

  public function setGlobalListener(obj:Dynamic):Void {
    this.globalListener = obj;
  }

  public function callGlobalListener(event:String, data:Dynamic):Void {
    if (this.globalListener == null) return;
    this.globalListener.obj[this.globalListener.method](this.port, event, data);
  }

  public function send(x:Dynamic):Bool {
    if (!this.connected) return false;
    this.sentLog.push(x);
    return true;
  }

  public function cmd(cmd:String, attr:Dynamic, ?child:Dynamic = null):Bool {
    var cbeeCmdName = this.cmdList.get(Std.string(cmd).toLowerCase());
    if (cbeeCmdName == null) return false;

    var x:Dynamic = {nodeName: cbeeCmdName, attributes: {}};
    if (attr != null) for (n in Reflect.fields(attr)) Reflect.setField(x.attributes, n, Reflect.field(attr, n));

    if (child != null) Reflect.setField(x, "child", child);

    return this.send(x);
  }

  public function addListener(cmd:String, obj:Dynamic, method:String, ?attrib:String = null, ?value:Dynamic = null):Void {
    var c = Std.string(cmd).toLowerCase();
    var cbeeCmd = this.cmdList.get(c);
    if (cbeeCmd == null) return;

    if (attrib == null) {
      var arr = this.listeners.get(cbeeCmd);
      if (arr == null) {
        arr = [];
        this.listeners.set(cbeeCmd, arr);
      }
      arr.push({obj: obj, method: method});
    } else {
      if (!this.specificListeners.exists(cbeeCmd)) this.specificListeners.set(cbeeCmd, {});
      var byCmd = this.specificListeners.get(cbeeCmd);
      if (Reflect.field(byCmd, attrib) == null) Reflect.setField(byCmd, attrib, {});
      var byAttr = Reflect.field(byCmd, attrib);
      var key = Std.string(value);
      if (Reflect.field(byAttr, key) == null) Reflect.setField(byAttr, key, []);
      Reflect.field(byAttr, key).push({obj: obj, method: method});
    }
  }

  public function removeListenerCmd(cmd:String, ?attrib:String = null, ?value:Dynamic = null):Void {
    var cbeeCmd = this.cmdList.get(Std.string(cmd).toLowerCase());
    if (cbeeCmd == null) return;
    if (attrib == null) {
      this.listeners.set(cbeeCmd, []);
    } else {
      var byCmd = this.specificListeners.get(cbeeCmd);
      if (byCmd == null) return;
      var byAttr = Reflect.field(byCmd, attrib);
      if (byAttr == null) return;
      Reflect.setField(byAttr, Std.string(value), []);
    }
  }

  public function removeListenerCmdObj(cmd:String, obj:Dynamic, ?attrib:String = null, ?value:Dynamic = null):Void {
    var cbeeCmd = this.cmdList.get(Std.string(cmd).toLowerCase());
    if (cbeeCmd == null) return;
    if (attrib == null) {
      var arr = this.listeners.get(cbeeCmd);
      if (arr == null) return;
      filterObj(arr, obj);
    } else {
      var byCmd = this.specificListeners.get(cbeeCmd);
      if (byCmd == null) return;
      var byAttr = Reflect.field(byCmd, attrib);
      if (byAttr == null) return;
      var arr2:Array<Dynamic> = Reflect.field(byAttr, Std.string(value));
      if (arr2 == null) return;
      filterObj(arr2, obj);
    }
  }

  public function callListenersArray(arr:Array<Dynamic>, node:Dynamic):Void {
    if (arr == null) return;
    for (l in arr) l.obj[l.method](node);
  }

  function filterObj(arr:Array<Dynamic>, obj:Dynamic):Void {
    var i = 0;
    while (i < arr.length) {
      if (arr[i].obj == obj) arr.splice(i, 1); else i++;
    }
  }
}
