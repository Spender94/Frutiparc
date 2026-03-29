package frutiparc.core;

/**
 * Portage Haxe (noyau état/événements) du module AS2 FileLoader.
 * Source legacy: frutiengine/FileLoader.as
 */
class FileLoader {
  public var url:String;
  public var size:Null<Float>;
  public var mc:Dynamic;
  public var loaded:Bool = false;
  public var bytesTotal:Float = 0;
  public var bytesLoaded:Float = 0;
  public var bytesToLoad:Float = 0;
  public var percent:Float = 0;
  public var timeStart:Float = 0;
  public var timeElapsed:Float = 0;
  public var estimatedTimeLeft:Float = 0;
  public var transferRate:Float = 0;
  public var loader:Dynamic;

  var listeners:Array<Dynamic> = [];

  public function new(url:String, ?size:Null<Float> = null, ?loader:Dynamic = null) {
    this.url = url;
    this.size = size;
    this.loader = loader;
  }

  public function addListener(listener:Dynamic):Void listeners.push(listener);
  public function removeListener(listener:Dynamic):Void listeners = listeners.filter(function(l) return l != listener);

  public function loadClip(mc:Dynamic, ?now:Float = -1):Void {
    this.mc = mc;
    this.timeStart = now >= 0 ? now : Date.now().getTime();
    if (loader != null) loader.loadClip(this.url, this.mc, this);
  }

  public function onLoadError(a:Dynamic, b:Dynamic):Void {
    this.loaded = false;
    broadcastMessage("onFileNotFoundError", [a, b]);
  }

  public function onLoadStart():Void broadcastMessage("onLoadStart", []);

  public function onLoadProgress(mc:Dynamic, loadedBytes:Float, totalBytes:Float, ?now:Float = -1):Void {
    this.bytesLoaded = loadedBytes;
    this.bytesTotal = totalBytes;
    this.bytesToLoad = this.bytesTotal - this.bytesLoaded;
    this.percent = this.bytesTotal == 0 ? 0 : Math.round(this.bytesLoaded * 10000 / this.bytesTotal) / 100;

    var current = now >= 0 ? now : Date.now().getTime();
    this.timeElapsed = current - this.timeStart;
    this.transferRate = this.timeElapsed <= 0 ? 0 : this.bytesLoaded / this.timeElapsed;
    this.estimatedTimeLeft = this.transferRate <= 0 ? 0 : this.bytesToLoad / this.transferRate;

    broadcastMessage("onLoadProgress", [mc, loadedBytes, totalBytes]);
  }

  public function onLoadComplete(?progress:Dynamic = null):Void {
    if (progress != null) {
      this.bytesLoaded = progress.bytesLoaded;
      this.bytesTotal = progress.bytesTotal;
    }

    if (this.size == null || this.size == this.bytesLoaded) {
      this.loaded = true;
      broadcastMessage("onLoadComplete", []);
    } else {
      broadcastMessage("onFalseSizeError", []);
    }
  }

  public function onLoadInit():Void {
    if (this.size == null || this.size == this.bytesLoaded) broadcastMessage("onLoadInit", []);
    else broadcastMessage("onFalseSizeError", []);
  }

  function broadcastMessage(method:String, args:Array<Dynamic>):Void {
    for (l in listeners) {
      var fn = Reflect.field(l, method);
      if (fn != null) Reflect.callMethod(l, fn, args);
    }
  }
}
