// In-memory cache for legacy/main.swf.
//
// Pre-loading the SWF into RAM and serving with an explicit Content-Length
// gives the Ruffle loader a real progress total and ships the bytes in one
// shot — a single dropped TCP connection is the worst case (and the
// browser retries that). The compression middleware skips application/
// x-shockwave-flash so no chunked re-encoding can interrupt the transfer.
//
// State is wrapped in an object so external readers see live updates
// after reloadMainSwf() — direct const exports would snapshot.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const MAIN_SWF_PATH = path.join(PROJECT_ROOT, 'legacy', 'main.swf');

const mainSwfCache = {
  buf: null,
  etag: null,
};

function loadMainSwfFromDisk() {
  try {
    mainSwfCache.buf = fs.readFileSync(MAIN_SWF_PATH);
    mainSwfCache.etag = '"' + crypto.createHash('sha1').update(mainSwfCache.buf).digest('hex') + '"';
    console.log(`[MAIN.SWF] cached ${mainSwfCache.buf.length} bytes, etag=${mainSwfCache.etag}`);
  } catch (e) {
    mainSwfCache.buf = null;
    mainSwfCache.etag = null;
    console.error(`[MAIN.SWF] failed to read ${MAIN_SWF_PATH}: ${e.message}`);
  }
}

module.exports = {
  MAIN_SWF_PATH,
  mainSwfCache,
  loadMainSwfFromDisk,
};
