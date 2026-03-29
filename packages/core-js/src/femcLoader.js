/**
 * Runtime JS mirror for Lot A target FEMCLoader.
 */
class FEMCLoader {
  static urlList = {};

  constructor(loadFn = null, onCompleteHook = null) {
    this.url = undefined;
    this.wasFirst = false;
    this.loadFn = loadFn;
    this.onCompleteHook = onCompleteHook;
  }

  doLoad(url, target) {
    if (typeof this.loadFn === 'function') {
      return this.loadFn(url, target);
    }
    return null;
  }

  loadClip(url, target, force = false) {
    if (force) {
      return this.doLoad(url, target);
    }

    if (FEMCLoader.urlList[url] === undefined) {
      this.wasFirst = true;
      FEMCLoader.urlList[url] = { loaded: false, objList: [] };
      this.url = url;
      return this.doLoad(url, target);
    }

    this.wasFirst = false;
    const o = FEMCLoader.urlList[url];
    if (o.loaded) {
      return this.doLoad(url, target);
    }

    o.objList.push({ obj: this, mc: target });
    return null;
  }

  onLoadComplete(mc) {
    if (this.wasFirst) {
      const o = FEMCLoader.urlList[this.url];
      o.loaded = true;
      for (let i = 0; i < o.objList.length; i += 1) {
        o.objList[i].obj.loadClip(this.url, o.objList[i].mc, true);
      }
      o.objList = [];
    }

    if (typeof this.onCompleteHook === 'function') {
      this.onCompleteHook(mc);
    }
  }
}

module.exports = {
  FEMCLoader,
};
