package frutiparc.core;

/**
 * Portage pragmatique de frutiparc/main/classLoader.as
 * (orchestration de chargement séquentiel des bibliothèques .swf).
 */
class ClassLoader {
  public var libPath:Array<String>;
  public var baseUrl:String;
  public var logText:String;
  public var libToLoad:Int;
  public var libLoaded:Int;
  public var state:String;
  public var clips:Map<String, Dynamic>;
  public var loader:Dynamic;
  public var onPlay:Void->Void;

  public function new(?obj:Dynamic = null) {
    this.libPath = [
      "bumdum.swf",
      "skool.swf",
      "fe.swf",
      "box.swf",
      "root.swf",
      "frusion.swf",
      "interface.swf",
      "listener.swf",
      "unsorted.swf"
    ];
    this.baseUrl = "http://www.beta.frutiparc.com/swf/lib/";
    this.logText = "";
    this.libToLoad = this.libPath.length;
    this.libLoaded = 0;
    this.state = "stopped";
    this.clips = new Map();

    if (obj != null) for (n in Reflect.fields(obj)) Reflect.setField(this, n, Reflect.field(obj, n));

    if (this.loader != null) this.attachLoaderListeners(this.loader);
  }

  public function attachLoaderListeners(loader:Dynamic):Void {
    this.loader = loader;
    if (loader != null && Reflect.field(loader, "addListener") != null) loader.addListener(this);
  }

  public function play():Void {
    this.state = "playing";
    if (this.onPlay != null) this.onPlay();
  }

  public function stop():Void {
    this.state = "stopped";
  }

  public function createEmptyMovieClip(name:String, depth:Int):Dynamic {
    var mc:Dynamic = {name: name, depth: depth, url: null};
    this.clips.set(name, mc);
    return mc;
  }

  public function initLoad(id:Int):Dynamic {
    var name = 'lib$id';
    var mc = createEmptyMovieClip(name, 80 + id);
    var url = this.baseUrl + this.libPath[id];
    mc.url = url;

    if (this.loader != null && Reflect.field(this.loader, "loadClip") != null) {
      this.loader.loadClip(url, mc);
    }

    return {mc: mc, url: url};
  }

  public function start():Dynamic {
    this.stop();
    this.libToLoad = this.libPath.length;
    this.libLoaded = 0;
    this.logText = "";
    return initLoad(0);
  }

  public function onLoadComplete(mc:Dynamic):Void {
    this.logText += 'loadComplete(${Reflect.field(mc, "name") != null ? Reflect.field(mc, "name") : Std.string(mc)})\n';
    this.libLoaded++;

    if (this.libLoaded >= this.libToLoad) {
      this.play();
    } else {
      this.initLoad(this.libLoaded);
    }
  }

  public function onLoadError(mc:Dynamic, error:Dynamic):Void {
    this.logText += 'loadError(${Std.string(error)})\n';
  }

  public function onLoadStart(mc:Dynamic):Void {
    this.logText += 'loadStart(${Reflect.field(mc, "name") != null ? Reflect.field(mc, "name") : Std.string(mc)})\n';
  }
}
