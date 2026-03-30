/**
 * Runtime mirror of frutiparc/main/classLoader.as workflow.
 * Tracks sequential library loading and triggers `play` when all libs are loaded.
 */
class ClassLoader {
  constructor(obj = {}) {
    Object.assign(this, obj);

    this.libPath = this.libPath || [
      'bumdum.swf',
      'skool.swf',
      'fe.swf',
      'box.swf',
      'root.swf',
      'frusion.swf',
      'interface.swf',
      'listener.swf',
      'unsorted.swf',
    ];
    this.baseUrl = this.baseUrl || 'http://www.beta.frutiparc.com/swf/lib/';

    this.logText = '';
    this.libToLoad = this.libPath.length;
    this.libLoaded = 0;
    this.state = 'stopped';

    this.clips = {};

    if (this.loader) this.attachLoaderListeners(this.loader);
  }

  attachLoaderListeners(loader) {
    this.loader = loader;
    if (typeof loader.addListener === 'function') loader.addListener(this);
  }

  play() {
    this.state = 'playing';
    if (typeof this.onPlay === 'function') this.onPlay();
  }

  stop() {
    this.state = 'stopped';
  }

  createEmptyMovieClip(name, depth) {
    const mc = { name, depth, url: null };
    this.clips[name] = mc;
    return mc;
  }

  initLoad(id) {
    const name = `lib${id}`;
    const mc = this.createEmptyMovieClip(name, 80 + id);
    const url = `${this.baseUrl}${this.libPath[id]}`;
    mc.url = url;

    if (this.loader && typeof this.loader.loadClip === 'function') {
      this.loader.loadClip(url, mc);
    }

    return { mc, url };
  }

  start() {
    this.stop();
    this.libToLoad = this.libPath.length;
    this.libLoaded = 0;
    this.logText = '';
    return this.initLoad(0);
  }

  onLoadComplete(mc) {
    this.logText += `loadComplete(${mc.name || mc})\n`;
    this.libLoaded += 1;

    if (this.libLoaded >= this.libToLoad) {
      this.play();
    } else {
      this.initLoad(this.libLoaded);
    }
  }

  onLoadError(mc, error) {
    this.logText += `loadError(${error})\n`;
  }

  onLoadStart(mc) {
    this.logText += `loadStart(${mc.name || mc})\n`;
  }
}

module.exports = {
  ClassLoader,
};
