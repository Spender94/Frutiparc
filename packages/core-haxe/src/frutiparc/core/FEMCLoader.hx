package frutiparc.core;

/**
 * Portage Haxe du module AS2 FEMCLoader.
 * Source legacy: frutiengine/FEMCLoader.as
 */
class FEMCLoader {
  public static var urlList:Dynamic = {};

  public var url:String;
  public var wasFirst:Bool = false;
  public var loadFn:Dynamic;
  public var onCompleteHook:Dynamic;

  public function new(?loadFn:Dynamic = null, ?onCompleteHook:Dynamic = null) {
    this.loadFn = loadFn;
    this.onCompleteHook = onCompleteHook;
  }

  public function loadClip(url:String, target:Dynamic, ?force:Bool = false):Dynamic {
    if (force) return doLoad(url, target);

    var o = Reflect.field(urlList, url);
    if (o == null) {
      this.wasFirst = true;
      Reflect.setField(urlList, url, { loaded: false, objList: [] });
      this.url = url;
      return doLoad(url, target);
    }

    this.wasFirst = false;
    if (Reflect.field(o, "loaded") == true) {
      return doLoad(url, target);
    }

    var list:Array<Dynamic> = Reflect.field(o, "objList");
    list.push({ obj: this, mc: target });
    return null;
  }

  public function onLoadComplete(mc:Dynamic):Void {
    if (this.wasFirst) {
      var o = Reflect.field(urlList, this.url);
      Reflect.setField(o, "loaded", true);
      var list:Array<Dynamic> = Reflect.field(o, "objList");
      for (i in 0...list.length) {
        list[i].obj.loadClip(this.url, list[i].mc, true);
      }
      Reflect.setField(o, "objList", []);
    }

    if (onCompleteHook != null) onCompleteHook(mc);
  }

  function doLoad(url:String, target:Dynamic):Dynamic {
    return loadFn != null ? loadFn(url, target) : null;
  }
}
