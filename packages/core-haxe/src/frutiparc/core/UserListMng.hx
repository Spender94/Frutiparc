package frutiparc.core;

/**
 * Portage Haxe (noyau métier) du module AS2 UserListMng.
 * Source legacy: frutiengine/UserListMng.as
 */
class UserListMng {
  public var list:Map<String, UserMng>;
  public var arr:Array<UserMng>;
  public var length:Int;
  public var listenerList:Array<Dynamic>;
  public var userMngClass:Dynamic;

  public function new(?userMngClass:Dynamic = null) {
    this.list = new Map();
    this.arr = [];
    this.listenerList = [];
    this.length = 0;
    this.userMngClass = userMngClass == null ? UserMng : userMngClass;
  }

  public function addUser(u:Dynamic, ?infoBasic:Dynamic = null, ?flMode:Bool = false, ?callOnChange:Bool = true):Void {
    var key = Std.string(u);
    if (!list.exists(key)) {
      length++;
      var user:UserMng = Type.createInstance(userMngClass, [key, infoBasic, flMode]);
      list.set(key, user);
      arr.push(user);
    }
    if (callOnChange) onChange();
  }

  public function rmUser(u:Dynamic, ?callOnChange:Bool = true):Bool {
    var key = Std.string(u);
    var user = list.get(key);
    var removed = false;

    if (user != null) {
      var idx = arr.indexOf(user);
      if (idx >= 0) {
        arr.splice(idx, 1);
        removed = true;
      }
      length--;
      user.onDelete();
      list.remove(key);
    }

    if (callOnChange) onChange();
    return removed;
  }

  public function rmAll():Void {
    for (user in arr) user.onDelete();
    list = new Map();
    arr = [];
    length = 0;
  }

  public function defineMc(u:Dynamic, mc:Dynamic):Void {
    var key = Std.string(u);
    if (key.length == 0) return;
    var user = list.get(key);
    if (user != null) user.setMc(mc);
  }

  public function undefineMc(u:Dynamic, mc:Dynamic):Void {
    var key = Std.string(u);
    if (key.length == 0) return;
    var user = list.get(key);
    if (user != null) user.unsetMc(mc);
  }

  public function onChange():Void {
    arr.sort(function(a, b) return Reflect.compare(a.sortString, b.sortString));
    sendToAllListeners();
  }

  public function onUserAction(u:Dynamic, act:Dynamic):Void {
    var key = Std.string(u);
    if (key.length == 0) return;
    var user = list.get(key);
    if (user != null) user.onAction(act);
  }

  public function wantList(obj:Dynamic, method:String, start:Int, length:Int):Void {
    var listener = getListenerByObj(obj);
    if (listener == null) {
      listener = {obj: obj, method: method, length: length, start: start};
      listenerList.push(listener);
    } else {
      listener.method = method;
      listener.length = length;
      listener.start = start;
    }

    sendToListener(listener);
  }

  public function noMoreList(obj:Dynamic):Bool {
    for (i in 0...listenerList.length) {
      if (Reflect.field(listenerList[i], "obj") == obj) {
        listenerList.splice(i, 1);
        return true;
      }
    }
    return false;
  }

  public function sendToAllListeners():Void {
    for (listener in listenerList) sendToListener(listener);
  }

  public function sendToListener(listener:Dynamic):Void {
    var start:Int = Reflect.field(listener, "start");
    var count:Int = Reflect.field(listener, "length");
    var method:String = Reflect.field(listener, "method");
    var obj:Dynamic = Reflect.field(listener, "obj");
    var users = getPartAttrib(start, count, "u");
    Reflect.callMethod(obj, Reflect.field(obj, method), [users, this.length]);
  }

  public function isInList(user:String):Bool {
    return list.exists(Std.string(user));
  }

  public function getRealUserName(user:String):String {
    var asked = Std.string(user);
    var askedLower = asked.toLowerCase();
    for (u in arr) {
      if (u.u.toLowerCase() == askedLower) return u.u;
    }
    return asked;
  }

  public function modePresent():Bool {
    for (u in arr) if (u.flMode) return true;
    return false;
  }

  public function isMode(user:String):Bool {
    var u = list.get(Std.string(user));
    return u != null && u.flMode;
  }

  public function getUserArray():Array<String> {
    return getPartAttrib(0, this.length, "u");
  }

  function getListenerByObj(obj:Dynamic):Dynamic {
    for (listener in listenerList) if (Reflect.field(listener, "obj") == obj) return listener;
    return null;
  }

  function getPartAttrib(start:Int, count:Int, attr:String):Array<String> {
    var s = start < 0 ? 0 : start;
    var c = count < 0 ? 0 : count;
    var end = s + c;
    if (end > arr.length) end = arr.length;

    var out:Array<String> = [];
    for (i in s...end) out.push(Std.string(Reflect.field(arr[i], attr)));
    return out;
  }
}
