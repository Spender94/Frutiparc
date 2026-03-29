package frutiparc.core;

/**
 * Portage Haxe pragmatique de CBeeLocal.
 * Supporte les variantes internes (CBeeManager) et externes (LocalConnection).
 */
class CBeeLocal {
  public var cmdList:Map<String, String>;
  public var listeners:Map<String, Array<Dynamic>>;
  public var specificListeners:Map<String, Dynamic>;
  public var initialized:Bool;
  public var connected:Bool;
  public var logged:Bool;
  public var port:Int;
  public var cbeeLC:Dynamic;
  public var cbeeManager:Dynamic;

  // External variant fields
  public var sid:Dynamic;
  public var lcName:String;
  public var managerChannel:String;
  public var serverChannel:String;
  public var inboundConnection:Dynamic;
  public var localConnectionFactory:Dynamic;

  public function new(?obj:Dynamic = null) {
    this.cmdList = new Map();
    this.cmdList.set("onclose", "onclose");
    this.cmdList.set("onconnect", "onconnect");
    this.cmdList.set("ident", "ident");

    this.listeners = new Map();
    this.specificListeners = new Map();
    this.initialized = false;
    this.connected = false;
    this.logged = false;

    if (obj != null) for (n in Reflect.fields(obj)) Reflect.setField(this, n, Reflect.field(obj, n));

    this.addListener("ident", this, "onIdent");
  }

  inline function isInternalMode():Bool {
    return this.cbeeManager != null;
  }

  static function randomId():String {
    return StringTools.replace(Std.string(Math.random()), "0.", "");
  }

  public function init():Void {
    if (this.port == null) return;

    if (isInternalMode()) {
      this.initialized = true;
      this.cbeeLC = this.cbeeManager.addListener(this.port, this, true);

      var obj = this.cbeeManager.getStatus(this.port);
      if (obj != null && obj.connected) this.onConnect(true);
      if (obj != null && obj.logged) this.callListenersArray(this.listeners.get(this.cmdList.get("ident")), null);
      return;
    }

    if (this.sid == null || this.localConnectionFactory == null) return;
    if (this.lcName == null) this.lcName = 'fp_cblc_${this.sid}_${this.port}_${randomId()}';
    if (this.managerChannel == null) this.managerChannel = 'fp_cbeeMng_${this.sid}';

    if (this.inboundConnection != null && Reflect.field(this.inboundConnection, "connect") != null) {
      this.inboundConnection.connect(this.lcName);
    }

    var lc = this.localConnectionFactory();
    lc.obj = this;
    lc.onStatus = function(obj:Dynamic) {
      if (obj != null && obj.level == "error") this.looseLocalConnection();
      else this.initialized = true;
    };
    lc.send(this.managerChannel, "addListener", this.port, this.lcName);
    lc.send(this.managerChannel, "getStatus", this.port, this.lcName);
  }

  public function close():Void {
    if (this.cbeeManager != null) this.cbeeManager.removeListener(this.port, this);
  }

  public function check():Void {}

  public function looseLocalConnection():Void {
    this.initialized = false;
    this.onClose();
  }

  public function onConnect(success:Bool):Void {
    this.connected = success;
    this.logged = false;
    this.callListenersArray(this.listeners.get("onconnect"), success);
  }

  public function onClose():Void {
    this.connected = false;
    this.logged = false;
    this.callListenersArray(this.listeners.get("onclose"), null);
  }

  public function onXML(node:Dynamic):Void {
    if (node == null) return;
    var cmdName = Std.string(node.nodeName).toLowerCase();
    callListenersArray(this.listeners.get(cmdName), node);

    var attrs:Dynamic = Reflect.field(node, "attributes");
    if (attrs != null) {
      for (attrib in Reflect.fields(attrs)) {
        var byCmd = specificListeners.get(cmdName);
        if (byCmd == null) continue;
        var byAttr = Reflect.field(byCmd, attrib);
        if (byAttr == null) continue;
        callListenersArray(Reflect.field(byAttr, Std.string(Reflect.field(attrs, attrib))), node);
      }
    }
  }

  public function onStatus(obj:Dynamic):Void {
    if (obj != null && obj.connected) this.onConnect(true);
    this.logged = obj != null && obj.logged == true;
  }

  public function send(s:Dynamic):Bool {
    if (isInternalMode()) {
      if (!this.initialized) return false;
      if (this.cbeeLC == null || Reflect.field(this.cbeeLC, "send") == null) return false;
      this.cbeeLC.send(s);
      return true;
    }

    if (!this.initialized || !this.connected || this.localConnectionFactory == null) return false;
    var lc = this.localConnectionFactory();
    lc.obj = this;
    lc.onStatus = function(obj:Dynamic) {
      if (obj != null && obj.level == "error") this.looseLocalConnection();
    };
    var channel = this.serverChannel != null ? this.serverChannel : 'fp_cbee_${this.port}_${this.sid}';
    lc.send(channel, "send", s);
    return true;
  }

  public function cmd(cmd:String, attr:Dynamic, ?child:Dynamic = null):Bool {
    if (!isInternalMode()) {
      if (!this.initialized || !this.connected || this.localConnectionFactory == null) return false;
      var lc = this.localConnectionFactory();
      lc.obj = this;
      lc.onStatus = function(obj:Dynamic) {
        if (obj != null && obj.level == "error") this.looseLocalConnection();
      };
      var channel = this.serverChannel != null ? this.serverChannel : 'fp_cbee_${this.port}_${this.sid}';
      lc.send(channel, "cmd", cmd, attr, child);
      return true;
    }

    var cbeeCmdName = this.cmdList.get(Std.string(cmd).toLowerCase());
    if (cbeeCmdName == null) return false;

    var x:Dynamic = {nodeName: cbeeCmdName, attributes: {}};
    if (attr != null) for (n in Reflect.fields(attr)) Reflect.setField(x.attributes, n, Reflect.field(attr, n));
    if (child != null) Reflect.setField(x, "child", child);
    return this.send(x);
  }

  public function onIdent(node:Dynamic):Void {
    this.connected = true;
    if (node == null || node.attributes == null || node.attributes.k == null) this.logged = true;
    else this.logged = false;
  }

  public function addListener(cmd:String, obj:Dynamic, method:String, ?attrib:String = null, ?value:Dynamic = null):Void {
    var cbeeCmd = this.cmdList.get(Std.string(cmd).toLowerCase());
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

    if (attrib == null) this.listeners.set(cbeeCmd, []);
    else {
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
