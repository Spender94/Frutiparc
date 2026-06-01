/*
 * bouille-gif.js — self-contained animated-GIF (GIF89a) encoder.
 *
 * No external dependencies. Works in the browser (window.BouilleGif) and in
 * Node (module.exports) so it can be unit-tested off-browser.
 *
 * Input  : one or more frames of RGBA pixel data (Uint8ClampedArray/Uint8Array,
 *          width*height*4 bytes, as returned by CanvasRenderingContext2D
 *          .getImageData().data).
 * Output : a Uint8Array containing a valid animated GIF.
 *
 * Pipeline:
 *   quantize(frames, maxColors)  → median-cut to a shared global palette
 *                                  (one slot reserved for full transparency),
 *                                  plus per-frame indexed pixel buffers.
 *   encodeGif({...})             → assembles GIF89a: global color table,
 *                                  NETSCAPE2.0 loop block, then for each frame a
 *                                  Graphic Control Extension (delay + transparent
 *                                  index) and an LZW-compressed image.
 *
 * GIF is 256 colors max; bouilles are cartoon avatars with a limited palette,
 * so a shared median-cut palette across frames keeps files small and stable
 * (no inter-frame palette flicker) while staying faithful.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BouilleGif = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ── Median-cut quantization ─────────────────────────────────────────────
  // Collect opaque pixels from every frame, recursively split the color box
  // along its longest axis at the median, and average each final box. Returns
  // up to `maxColors` palette entries. Transparency is handled separately (a
  // reserved palette slot), so callers pass maxColors = 255 to keep slot 255
  // (or any chosen index) for transparent.
  function buildPalette(frames, width, height, maxColors) {
    var pixels = []; // packed 0xRRGGBB of opaque pixels (subsampled if huge)
    var total = width * height;
    // Subsample for very large inputs to bound CPU; bouilles are small so this
    // rarely triggers. Step keeps ~<=65k samples per frame.
    for (var f = 0; f < frames.length; f++) {
      var data = frames[f];
      var step = Math.max(1, Math.floor(total / 65536));
      for (var i = 0; i < total; i += step) {
        var a = data[i * 4 + 3];
        if (a < 128) continue; // transparent → not in palette
        pixels.push((data[i * 4] << 16) | (data[i * 4 + 1] << 8) | data[i * 4 + 2]);
      }
    }
    if (pixels.length === 0) return [[0, 0, 0]];

    function box(arr) {
      var rmin = 255, rmax = 0, gmin = 255, gmax = 0, bmin = 255, bmax = 0;
      for (var i = 0; i < arr.length; i++) {
        var p = arr[i], r = (p >> 16) & 255, g = (p >> 8) & 255, b = p & 255;
        if (r < rmin) rmin = r; if (r > rmax) rmax = r;
        if (g < gmin) gmin = g; if (g > gmax) gmax = g;
        if (b < bmin) bmin = b; if (b > bmax) bmax = b;
      }
      return { arr: arr, rmin: rmin, rmax: rmax, gmin: gmin, gmax: gmax, bmin: bmin, bmax: bmax };
    }
    function rangeAxis(bx) {
      var dr = bx.rmax - bx.rmin, dg = bx.gmax - bx.gmin, db = bx.bmax - bx.bmin;
      if (dr >= dg && dr >= db) return 0;
      if (dg >= db) return 1;
      return 2;
    }
    var boxes = [box(pixels)];
    while (boxes.length < maxColors) {
      // Pick the box with the largest single-axis range to split.
      var idx = -1, best = -1;
      for (var i = 0; i < boxes.length; i++) {
        if (boxes[i].arr.length < 2) continue;
        var bx = boxes[i];
        var span = Math.max(bx.rmax - bx.rmin, bx.gmax - bx.gmin, bx.bmax - bx.bmin);
        if (span > best) { best = span; idx = i; }
      }
      if (idx < 0) break; // nothing left to split
      var target = boxes[idx];
      var axis = rangeAxis(target);
      var shift = axis === 0 ? 16 : axis === 1 ? 8 : 0;
      target.arr.sort(function (a, b) { return ((a >> shift) & 255) - ((b >> shift) & 255); });
      var mid = target.arr.length >> 1;
      var left = target.arr.slice(0, mid), right = target.arr.slice(mid);
      boxes.splice(idx, 1, box(left), box(right));
    }
    var palette = [];
    for (var i = 0; i < boxes.length; i++) {
      var arr = boxes[i].arr, rs = 0, gs = 0, bs = 0;
      for (var j = 0; j < arr.length; j++) { var p = arr[j]; rs += (p >> 16) & 255; gs += (p >> 8) & 255; bs += p & 255; }
      var n = arr.length || 1;
      palette.push([Math.round(rs / n), Math.round(gs / n), Math.round(bs / n)]);
    }
    return palette;
  }

  // Nearest-color lookup with a small cache (bouilles repeat colors heavily).
  function makeMapper(palette) {
    var cache = Object.create(null);
    return function (r, g, b) {
      var key = (r << 16) | (g << 8) | b;
      var hit = cache[key];
      if (hit !== undefined) return hit;
      var best = 0, bestD = Infinity;
      for (var i = 0; i < palette.length; i++) {
        var pc = palette[i];
        var dr = r - pc[0], dg = g - pc[1], db = b - pc[2];
        var d = dr * dr + dg * dg + db * db;
        if (d < bestD) { bestD = d; best = i; if (d === 0) break; }
      }
      cache[key] = best;
      return best;
    };
  }

  // frames: array of RGBA Uint8(Clamped)Array. Returns indexed buffers + palette.
  function quantize(frames, width, height, maxColors) {
    maxColors = Math.max(2, Math.min(256, maxColors || 256));
    // Reserve one palette slot for transparency → at most maxColors-1 colors.
    var palette = buildPalette(frames, width, height, maxColors - 1);
    var transparentIndex = palette.length; // next free slot
    // Pad palette so its size is a power of two (GIF requirement) and append a
    // placeholder colour for the transparent index.
    var full = palette.slice();
    full.push([0, 0, 0]); // transparent slot colour (never shown)
    var size = 2;
    while (size < full.length) size <<= 1;
    while (full.length < size) full.push([0, 0, 0]);

    var map = makeMapper(palette);
    var indexedFrames = [];
    var total = width * height;
    for (var f = 0; f < frames.length; f++) {
      var data = frames[f];
      var out = new Uint8Array(total);
      for (var i = 0; i < total; i++) {
        if (data[i * 4 + 3] < 128) { out[i] = transparentIndex; continue; }
        out[i] = map(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
      }
      indexedFrames.push(out);
    }
    return { palette: full, indexedFrames: indexedFrames, transparentIndex: transparentIndex };
  }

  // ── GIF LZW compression (variable-width codes) ──────────────────────────
  function lzwEncode(minCodeSize, indices) {
    var out = [];
    var clearCode = 1 << minCodeSize;
    var endCode = clearCode + 1;
    var codeSize = minCodeSize + 1;
    var nextCode = endCode + 1;
    var dict = Object.create(null);
    function resetDict() {
      dict = Object.create(null);
      for (var i = 0; i < clearCode; i++) dict[String.fromCharCode(i)] = i;
      codeSize = minCodeSize + 1;
      nextCode = endCode + 1;
    }

    // Bit packer (LSB-first, as GIF requires).
    var cur = 0, curBits = 0;
    function emit(code) {
      cur |= code << curBits;
      curBits += codeSize;
      while (curBits >= 8) { out.push(cur & 0xff); cur >>= 8; curBits -= 8; }
    }

    resetDict();
    emit(clearCode);
    var prefix = String.fromCharCode(indices[0]);
    for (var i = 1; i < indices.length; i++) {
      var c = String.fromCharCode(indices[i]);
      var combined = prefix + c;
      if (dict[combined] !== undefined) {
        prefix = combined;
      } else {
        emit(dict[prefix]);
        dict[combined] = nextCode++;
        if (nextCode > (1 << codeSize)) {
          if (codeSize < 12) codeSize++;
          else { emit(clearCode); resetDict(); }
        }
        prefix = c;
      }
    }
    emit(dict[prefix]);
    emit(endCode);
    if (curBits > 0) out.push(cur & 0xff);
    return out;
  }

  // ── GIF assembly ────────────────────────────────────────────────────────
  function encodeGif(opts) {
    var width = opts.width, height = opts.height;
    var palette = opts.palette;            // array of [r,g,b], length = power of 2
    var frames = opts.indexedFrames;       // array of Uint8Array
    var delays = opts.delays || [];        // centiseconds per frame
    var transparentIndex = (opts.transparentIndex == null) ? -1 : opts.transparentIndex;
    var loop = (opts.loop == null) ? 0 : opts.loop; // 0 = infinite

    var bytes = [];
    function u8(v) { bytes.push(v & 0xff); }
    function u16(v) { bytes.push(v & 0xff, (v >> 8) & 0xff); }
    function str(s) { for (var i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i)); }

    // Header + Logical Screen Descriptor.
    str('GIF89a');
    u16(width); u16(height);
    var gctSize = 0; // log2(paletteSize) - 1
    var n = palette.length; while ((1 << (gctSize + 1)) < n) gctSize++;
    u8(0x80 | (gctSize & 0x07)); // global color table flag + size
    u8(0); // background color index
    u8(0); // pixel aspect ratio
    for (var i = 0; i < palette.length; i++) { u8(palette[i][0]); u8(palette[i][1]); u8(palette[i][2]); }

    // NETSCAPE2.0 looping application extension.
    u8(0x21); u8(0xff); u8(0x0b);
    str('NETSCAPE2.0');
    u8(0x03); u8(0x01); u16(loop); u8(0x00);

    var minCodeSize = Math.max(2, gctSize + 1);

    for (var fi = 0; fi < frames.length; fi++) {
      // Graphic Control Extension: delay + transparency.
      u8(0x21); u8(0xf9); u8(0x04);
      var packed = 0x00;
      if (transparentIndex >= 0) packed |= 0x01;     // transparent color flag
      packed |= 0x08;                                // disposal = 2? use 1? keep "do not dispose"=0; restore-to-bg=2.
      // Use disposal method 2 (restore to background) so transparent areas of
      // successive frames don't leave trails. Bits 2-4 = disposal.
      packed = (packed & ~0x1c) | (0x02 << 2);
      if (transparentIndex >= 0) packed |= 0x01;
      u8(packed);
      u16(delays[fi] != null ? delays[fi] : (delays[0] != null ? delays[0] : 10));
      u8(transparentIndex >= 0 ? transparentIndex : 0);
      u8(0x00);

      // Image Descriptor (full-frame, no local color table).
      u8(0x2c);
      u16(0); u16(0); u16(width); u16(height);
      u8(0x00);

      // LZW image data.
      u8(minCodeSize);
      var lzw = lzwEncode(minCodeSize, frames[fi]);
      // Sub-block packaging (max 255 bytes each).
      for (var p = 0; p < lzw.length;) {
        var blockLen = Math.min(255, lzw.length - p);
        u8(blockLen);
        for (var q = 0; q < blockLen; q++) u8(lzw[p + q]);
        p += blockLen;
      }
      u8(0x00); // block terminator
    }

    u8(0x3b); // trailer
    return Uint8Array.from(bytes);
  }

  // One-shot convenience: RGBA frames → animated GIF bytes.
  function fromRGBAFrames(frames, width, height, opts) {
    opts = opts || {};
    var q = quantize(frames, width, height, opts.maxColors || 256);
    return encodeGif({
      width: width, height: height,
      palette: q.palette,
      indexedFrames: q.indexedFrames,
      transparentIndex: q.transparentIndex,
      delays: opts.delays,
      loop: opts.loop,
    });
  }

  return {
    quantize: quantize,
    encodeGif: encodeGif,
    fromRGBAFrames: fromRGBAFrames,
    _lzwEncode: lzwEncode,
    _buildPalette: buildPalette,
  };
});
