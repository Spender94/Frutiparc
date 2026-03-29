/**
 * Runtime JS mirror for Lot A target FileLoader (state + event flow).
 */
class FileLoader {
  constructor(url, size = undefined, loader = null) {
    this.url = url;
    this.size = size;
    this.loader = loader;

    this.mc = null;
    this.loaded = false;
    this.bytesTotal = 0;
    this.bytesLoaded = 0;
    this.bytesToLoad = 0;
    this.percent = 0;
    this.timeStart = 0;
    this.timeElapsed = 0;
    this.estimatedTimeLeft = 0;
    this.transferRate = 0;

    this.listeners = [];
  }

  addListener(listener) {
    this.listeners.push(listener);
  }

  removeListener(listener) {
    this.listeners = this.listeners.filter((l) => l !== listener);
  }

  broadcastMessage(method, ...args) {
    for (const l of this.listeners) {
      if (typeof l[method] === 'function') {
        l[method](...args);
      }
    }
  }

  loadClip(mc, now = Date.now()) {
    this.mc = mc;
    this.timeStart = now;
    if (this.loader && typeof this.loader.loadClip === 'function') {
      this.loader.loadClip(this.url, this.mc, this);
    }
  }

  onLoadError(a, b) {
    this.loaded = false;
    this.broadcastMessage('onFileNotFoundError', a, b);
  }

  onLoadStart() {
    this.broadcastMessage('onLoadStart');
  }

  onLoadProgress(mc, loadedBytes, totalBytes, now = Date.now()) {
    this.bytesLoaded = loadedBytes;
    this.bytesTotal = totalBytes;
    this.bytesToLoad = this.bytesTotal - this.bytesLoaded;
    this.percent = this.bytesTotal === 0 ? 0 : Math.round((this.bytesLoaded * 10000) / this.bytesTotal) / 100;

    this.timeElapsed = now - this.timeStart;
    this.transferRate = this.timeElapsed <= 0 ? 0 : this.bytesLoaded / this.timeElapsed;
    this.estimatedTimeLeft = this.transferRate <= 0 ? 0 : this.bytesToLoad / this.transferRate;

    this.broadcastMessage('onLoadProgress', mc, loadedBytes, totalBytes);
  }

  onLoadComplete(progress = null) {
    if (progress) {
      this.bytesLoaded = progress.bytesLoaded;
      this.bytesTotal = progress.bytesTotal;
    }

    if (this.size === undefined || this.size === this.bytesLoaded) {
      this.loaded = true;
      this.broadcastMessage('onLoadComplete');
    } else {
      this.broadcastMessage('onFalseSizeError');
    }
  }

  onLoadInit() {
    if (this.size === undefined || this.size === this.bytesLoaded) {
      this.broadcastMessage('onLoadInit');
    } else {
      this.broadcastMessage('onFalseSizeError');
    }
  }
}

module.exports = {
  FileLoader,
};
