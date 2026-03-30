package frutiparc.core;

/**
 * Portage Haxe (noyau orchestration) du module AS2 HTTP.
 * Source legacy: frutiengine/HTTP.as
 *
 * Cette version conserve surtout la logique de file (queue) et de callback,
 * en déléguant l'I/O à une fonction `transport` injectable.
 */
class HTTP {
  public static var queue:Array<HTTP> = [];
  public static var flIdle:Bool = true;
  public static var defaultParams:Dynamic = {};
  public static var defaultHeaders:Dynamic = {};

  public var action:String;
  public var params:Dynamic;
  public var callback:Dynamic;
  public var method:String;
  public var extra:Dynamic;
  public var output:Dynamic;
  public var transport:Dynamic;

  public function new(action:String, params:Dynamic, callback:Dynamic, ?method:String = "GET", ?extra:Dynamic = null, ?transport:Dynamic = null) {
    this.action = action;
    this.params = params;
    this.callback = callback;
    this.method = method;
    this.extra = extra;
    this.transport = transport;

    this.output = FEObject.clone(defaultParams);
    FEObject.addObject(this.output, params, true);

    submitMe(this);
  }

  public static function submitMe(obj:HTTP):Void {
    if (flIdle) {
      flIdle = false;
      obj.submit();
    } else {
      queue.push(obj);
    }
  }

  public static function goNext():Void {
    if (queue.length == 0) {
      flIdle = true;
    } else {
      var t = queue.shift();
      t.submit();
    }
  }

  function submit():Void {
    if (transport == null) {
      callback.obj[callback.method](false, null, extra);
      HTTP.goNext();
      return;
    }

    var self = this;
    transport(action, output, method, function(success:Bool, data:Dynamic) {
      self.callback.obj[self.callback.method](success, data, self.extra);
      HTTP.goNext();
    });
  }
}
