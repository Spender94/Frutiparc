// Round-trip test for the animated-GIF encoder (public/js/bouille-gif.js).
//
// We can't view the GIF here, so we prove correctness structurally: build
// synthetic RGBA frames, encode them, then decode with an INDEPENDENT minimal
// GIF89a decoder (LZW + frame compositing) written here, and assert that:
//   - the GIF header/structure is valid and parseable,
//   - the frame count, size, and loop block are right,
//   - decoded opaque pixels match the originals within the quantization error
//     budget (palette is lossy by design, so we allow a small per-channel delta
//     when the source has few distinct colors → here exact),
//   - transparency survives.
//
// Run: node test/bouilleGif.test.js   (uses node:test + node:assert)

const test = require('node:test');
const assert = require('node:assert');
const BouilleGif = require('../public/js/bouille-gif.js');

// ── Minimal GIF89a decoder (enough to verify our encoder) ────────────────
function decodeGif(bytes) {
  let p = 0;
  const u8 = () => bytes[p++];
  const u16 = () => { const v = bytes[p] | (bytes[p + 1] << 8); p += 2; return v; };
  const sig = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5]);
  assert.strictEqual(sig, 'GIF89a', 'bad signature');
  p = 6;
  const width = u16(), height = u16();
  const packed = u8();
  u8(); u8(); // bg, aspect
  const gctFlag = (packed & 0x80) !== 0;
  const gctSize = gctFlag ? (1 << ((packed & 0x07) + 1)) : 0;
  const gct = [];
  for (let i = 0; i < gctSize; i++) gct.push([u8(), u8(), u8()]);

  const frames = [];
  let loop = null;
  let gce = null; // pending graphic control extension

  function readSubBlocks() {
    const chunks = [];
    let len;
    while ((len = u8()) !== 0) { for (let i = 0; i < len; i++) chunks.push(u8()); }
    return chunks;
  }

  function lzwDecode(minCodeSize, data) {
    const clear = 1 << minCodeSize;
    const end = clear + 1;
    let codeSize = minCodeSize + 1;
    let dict = [];
    const resetDict = () => {
      dict = [];
      for (let i = 0; i < clear; i++) dict.push([i]);
      dict.push(null); // clear
      dict.push(null); // end
      codeSize = minCodeSize + 1;
    };
    resetDict();
    const out = [];
    let bitBuf = 0, bitCnt = 0, dp = 0;
    let prev = null;
    function readCode() {
      while (bitCnt < codeSize) {
        if (dp >= data.length) return end; // graceful
        bitBuf |= data[dp++] << bitCnt; bitCnt += 8;
      }
      const code = bitBuf & ((1 << codeSize) - 1);
      bitBuf >>= codeSize; bitCnt -= codeSize;
      return code;
    }
    for (;;) {
      const code = readCode();
      if (code === clear) { resetDict(); prev = null; continue; }
      if (code === end) break;
      let entry;
      if (code < dict.length && dict[code]) entry = dict[code].slice();
      else if (prev) entry = prev.concat(prev[0]); // KwKwK case
      else break;
      for (let i = 0; i < entry.length; i++) out.push(entry[i]);
      if (prev) {
        dict.push(prev.concat(entry[0]));
        if (dict.length === (1 << codeSize) && codeSize < 12) codeSize++;
      }
      prev = entry;
    }
    return out;
  }

  for (;;) {
    const b = u8();
    if (b === 0x3b) break; // trailer
    if (b === 0x21) { // extension
      const label = u8();
      if (label === 0xf9) { // graphic control
        u8(); // block size = 4
        const gpacked = u8();
        const delay = u16();
        const tindex = u8();
        u8(); // terminator
        gce = { disposal: (gpacked >> 2) & 0x07, transparent: (gpacked & 0x01) !== 0, tindex, delay };
      } else if (label === 0xff) { // application
        u8(); // block size = 11
        let app = ''; for (let i = 0; i < 11; i++) app += String.fromCharCode(u8());
        const sub = readSubBlocks();
        if (app === 'NETSCAPE2.0' && sub.length >= 3) loop = sub[1] | (sub[2] << 8);
      } else {
        readSubBlocks();
      }
      continue;
    }
    if (b === 0x2c) { // image descriptor
      const ix = u16(), iy = u16(), iw = u16(), ih = u16();
      const ipacked = u8();
      assert.strictEqual((ipacked & 0x80), 0, 'unexpected local color table');
      const minCodeSize = u8();
      const lzwData = readSubBlocks();
      const indices = lzwDecode(minCodeSize, lzwData);
      assert.strictEqual(indices.length, iw * ih, 'frame pixel count mismatch');
      frames.push({ ix, iy, iw, ih, indices, gce });
      gce = null;
      continue;
    }
    throw new Error('unexpected block 0x' + b.toString(16) + ' at ' + (p - 1));
  }

  return { width, height, gct, frames, loop };
}

// Composite a decoded frame to RGBA using the global color table.
function frameToRGBA(dec, frame) {
  const { width, height, gct } = dec;
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < frame.indices.length; i++) {
    const idx = frame.indices[i];
    const transparent = frame.gce && frame.gce.transparent && idx === frame.gce.tindex;
    if (transparent) { rgba[i * 4 + 3] = 0; continue; }
    const c = gct[idx] || [0, 0, 0];
    rgba[i * 4] = c[0]; rgba[i * 4 + 1] = c[1]; rgba[i * 4 + 2] = c[2]; rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

// ── Synthetic frame helpers ──────────────────────────────────────────────
function makeFrame(width, height, painter) {
  const d = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const c = painter(x, y); // [r,g,b,a]
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = c[3];
    }
  }
  return d;
}

test('encodes a valid single-frame GIF with exact colors (few-color image)', () => {
  const W = 16, H = 16;
  // 4 distinct opaque colors in quadrants — well within palette budget → exact.
  const colors = [[200, 30, 30], [30, 200, 30], [30, 30, 200], [220, 220, 40]];
  const frame = makeFrame(W, H, (x, y) => {
    const q = (y < H / 2 ? 0 : 2) + (x < W / 2 ? 0 : 1);
    return [colors[q][0], colors[q][1], colors[q][2], 255];
  });
  const gif = BouilleGif.fromRGBAFrames([frame], W, H, { delays: [10] });
  assert.ok(gif instanceof Uint8Array && gif.length > 0);
  const dec = decodeGif(gif);
  assert.strictEqual(dec.width, W);
  assert.strictEqual(dec.height, H);
  assert.strictEqual(dec.frames.length, 1);
  assert.strictEqual(dec.loop, 0, 'should loop infinitely');
  const out = frameToRGBA(dec, dec.frames[0]);
  // Exact match expected (only 4 colors).
  for (let i = 0; i < frame.length; i++) {
    assert.strictEqual(out[i], frame[i], 'pixel byte ' + i + ' differs');
  }
});

test('preserves transparency', () => {
  const W = 12, H = 12;
  const frame = makeFrame(W, H, (x, y) => {
    // transparent border, solid magenta center
    if (x === 0 || y === 0 || x === W - 1 || y === H - 1) return [0, 0, 0, 0];
    return [200, 0, 200, 255];
  });
  const gif = BouilleGif.fromRGBAFrames([frame], W, H, { delays: [10] });
  const dec = decodeGif(gif);
  const out = frameToRGBA(dec, dec.frames[0]);
  // Corners transparent, center opaque magenta.
  assert.strictEqual(out[3], 0, 'corner should be transparent');
  const ci = ((6 * W) + 6) * 4;
  assert.strictEqual(out[ci + 3], 255, 'center should be opaque');
  assert.ok(Math.abs(out[ci] - 200) <= 4 && Math.abs(out[ci + 2] - 200) <= 4, 'center color near magenta');
});

test('encodes multi-frame animation with per-frame delays and loop', () => {
  const W = 10, H = 10;
  const mk = (col) => makeFrame(W, H, () => [col[0], col[1], col[2], 255]);
  const frames = [mk([255, 0, 0]), mk([0, 255, 0]), mk([0, 0, 255])];
  const gif = BouilleGif.fromRGBAFrames(frames, W, H, { delays: [5, 8, 11], loop: 0 });
  const dec = decodeGif(gif);
  assert.strictEqual(dec.frames.length, 3, 'three frames');
  assert.strictEqual(dec.loop, 0);
  assert.strictEqual(dec.frames[0].gce.delay, 5);
  assert.strictEqual(dec.frames[1].gce.delay, 8);
  assert.strictEqual(dec.frames[2].gce.delay, 11);
  // Each frame's dominant color matches.
  const want = [[255, 0, 0], [0, 255, 0], [0, 0, 255]];
  for (let f = 0; f < 3; f++) {
    const out = frameToRGBA(dec, dec.frames[f]);
    assert.ok(Math.abs(out[0] - want[f][0]) <= 4 && Math.abs(out[1] - want[f][1]) <= 4 && Math.abs(out[2] - want[f][2]) <= 4,
      'frame ' + f + ' color');
  }
});

test('handles a richer gradient within quantization budget (<=256 colors)', () => {
  const W = 32, H = 32;
  const frame = makeFrame(W, H, (x, y) => [(x * 8) & 255, (y * 8) & 255, 128, 255]);
  const gif = BouilleGif.fromRGBAFrames([frame], W, H, { delays: [10], maxColors: 256 });
  const dec = decodeGif(gif);
  const out = frameToRGBA(dec, dec.frames[0]);
  // Average absolute error should be small (median-cut on a smooth gradient).
  let err = 0, n = 0;
  for (let i = 0; i < frame.length; i += 4) {
    if (frame[i + 3] < 128) continue;
    err += Math.abs(out[i] - frame[i]) + Math.abs(out[i + 1] - frame[i + 1]) + Math.abs(out[i + 2] - frame[i + 2]);
    n += 3;
  }
  const mae = err / n;
  assert.ok(mae < 24, 'mean abs error too high: ' + mae.toFixed(2));
});

test('LZW sub-blocks never exceed 255 bytes and stream is self-terminating', () => {
  // Large noisy frame stresses the bit-packer and sub-block chunking.
  const W = 64, H = 64;
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const frame = makeFrame(W, H, () => [Math.floor(rnd() * 256), Math.floor(rnd() * 256), Math.floor(rnd() * 256), 255]);
  const gif = BouilleGif.fromRGBAFrames([frame], W, H, { delays: [10] });
  // Decoding without throwing proves block framing + LZW are consistent.
  const dec = decodeGif(gif);
  assert.strictEqual(dec.frames.length, 1);
  assert.strictEqual(dec.frames[0].indices.length, W * H);
});
