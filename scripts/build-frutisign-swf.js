#!/usr/bin/env node
// Build a minimal frutiSign.swf containing the 10 fruit signs as exported library
// symbols. The Flash UI box.Frutiz attaches each symbol by its linkage name
// (matches Lang.sign(N) values: pomme, abricot, …).
//
// Each symbol is a 40x40 sprite containing a centered DefineEditText showing
// the sign name. The SWF also keeps 10 main-timeline frames with FrameLabels
// matching the same fruit names — covers both attachMovie() and gotoAndStop()
// usages.

'use strict';

const fs = require('fs');
const path = require('path');

const SIGN_NAMES = ['pomme','abricot','poire','fraise','citron','kiwi','raisin','orange','cerise','banane'];

// Twips: 1 px = 20 twips. Symbol bounds: 40x40 px = 800x800 twips.
const SYMBOL_W = 40 * 20;
const SYMBOL_H = 40 * 20;

// ── Bit writer ─────────────────────────────────────
class BitWriter {
  constructor() { this.bytes = []; this.bitBuf = 0; this.bitCount = 0; }
  writeBits(value, nBits) {
    for (let i = nBits - 1; i >= 0; i--) {
      this.bitBuf = (this.bitBuf << 1) | ((value >> i) & 1);
      this.bitCount++;
      if (this.bitCount === 8) {
        this.bytes.push(this.bitBuf & 0xff);
        this.bitBuf = 0; this.bitCount = 0;
      }
    }
  }
  flush() {
    if (this.bitCount > 0) {
      this.bytes.push((this.bitBuf << (8 - this.bitCount)) & 0xff);
      this.bitBuf = 0; this.bitCount = 0;
    }
  }
  buffer() { this.flush(); return Buffer.from(this.bytes); }
}

// SB (signed bit) RECT: nbits + 4 SB values (Xmin, Xmax, Ymin, Ymax)
function rect(xmin, xmax, ymin, ymax) {
  // Determine min nbits needed (signed)
  function bitsForSigned(v) {
    if (v === 0) return 1;
    const abs = Math.abs(v);
    let n = 1;
    while ((1 << (n - 1)) <= abs) n++;
    return n + 1; // sign bit
  }
  const nbits = Math.max(
    bitsForSigned(xmin), bitsForSigned(xmax),
    bitsForSigned(ymin), bitsForSigned(ymax)
  );
  const bw = new BitWriter();
  bw.writeBits(nbits, 5);
  bw.writeBits(xmin & ((1 << nbits) - 1), nbits);
  bw.writeBits(xmax & ((1 << nbits) - 1), nbits);
  bw.writeBits(ymin & ((1 << nbits) - 1), nbits);
  bw.writeBits(ymax & ((1 << nbits) - 1), nbits);
  return bw.buffer();
}

// String + null terminator
function cstr(s) { return Buffer.concat([Buffer.from(s, 'latin1'), Buffer.from([0])]); }

// Build a SWF tag (TagCodeAndLength + body)
function tag(code, body) {
  const len = body.length;
  if (len < 0x3f) {
    const header = Buffer.alloc(2);
    header.writeUInt16LE((code << 6) | len, 0);
    return Buffer.concat([header, body]);
  }
  const header = Buffer.alloc(6);
  header.writeUInt16LE((code << 6) | 0x3f, 0);
  header.writeUInt32LE(len, 2);
  return Buffer.concat([header, body]);
}

// Tag 37: DefineEditText
function defineEditText(charId, text) {
  // Bounds: full symbol
  const bounds = rect(0, SYMBOL_W, 0, SYMBOL_H);

  // Flags (16 bits, little-endian per SWF spec — actually it's a UI16):
  // bit15: hasText
  // bit14: wordWrap
  // bit13: multiline
  // bit12: password
  // bit11: readOnly
  // bit10: hasTextColor
  // bit9 : hasMaxLength
  // bit8 : hasFont
  // bit7 : reserved (hasFontClass in 8+, leave 0)
  // bit6 : autoSize
  // bit5 : hasLayout
  // bit4 : noSelect
  // bit3 : border
  // bit2 : reserved (wasStatic)
  // bit1 : html
  // bit0 : useOutlines
  // We want: hasText=1, readOnly=1, hasTextColor=1, hasFont=1, useOutlines=1
  let flags = 0;
  flags |= 1 << 15; // hasText
  flags |= 1 << 11; // readOnly
  flags |= 1 << 10; // hasTextColor
  flags |= 1 << 8;  // hasFont
  flags |= 1 << 0;  // useOutlines
  // hasLayout=1 to set alignment center
  flags |= 1 << 5;  // hasLayout

  const charIdBuf = Buffer.alloc(2); charIdBuf.writeUInt16LE(charId, 0);
  const flagsBuf = Buffer.alloc(2); flagsBuf.writeUInt16LE(flags, 0);

  // hasFont: FontID(2) + FontHeight(2) — use FontID=0xFFFF (device font fallback)
  // Most Flash players treat FontID 0 + useOutlines=0 as device. We use a fake font ID
  // and rely on useOutlines=0 + readOnly... Actually a safer approach:
  // Use FontID=1 referring to a non-existent font, set useOutlines=0 → renders as device font.
  // Or simpler: set hasFontClass instead. The minimal path that works in Ruffle:
  // hasFont=1 with FontID=0 + height=240 + readOnly. Ruffle falls back to device font.
  const fontId = Buffer.alloc(2); fontId.writeUInt16LE(0, 0);
  const fontHeight = Buffer.alloc(2); fontHeight.writeUInt16LE(240, 0); // 12pt = 240 twips

  // hasTextColor: RGBA
  const textColor = Buffer.from([0x00, 0x00, 0x00, 0xff]); // black

  // hasLayout: align(1) + leftMargin(2) + rightMargin(2) + indent(2) + leading(2)
  // align: 0=left, 1=right, 2=center, 3=justify
  const layout = Buffer.from([
    2,    // align center
    0, 0, // leftMargin
    0, 0, // rightMargin
    0, 0, // indent
    0, 0, // leading
  ]);

  // VariableName (null-terminated)
  const varName = Buffer.from([0]); // empty

  // InitialText
  const initText = cstr(text);

  return tag(37, Buffer.concat([
    charIdBuf,
    bounds,
    flagsBuf,
    fontId,
    fontHeight,
    textColor,
    layout,
    varName,
    initText,
  ]));
}

// Tag 26: PlaceObject2 — place an object at a depth
function placeObject2(charId, depth) {
  // Flags: hasCharacter=1, hasMatrix=0
  const flags = 0x02; // bit1: hasCharacter
  const buf = Buffer.alloc(5);
  buf.writeUInt8(flags, 0);
  buf.writeUInt16LE(depth, 1);
  buf.writeUInt16LE(charId, 3);
  return tag(26, buf);
}

// Tag 1: ShowFrame
function showFrame() { return tag(1, Buffer.alloc(0)); }

// Tag 39: DefineSprite — sprite with control tags
function defineSprite(spriteId, frameCount, controlTags) {
  const body = Buffer.alloc(4);
  body.writeUInt16LE(spriteId, 0);
  body.writeUInt16LE(frameCount, 2);
  return tag(39, Buffer.concat([body, controlTags]));
}

// Tag 56: ExportAssets
function exportAssets(pairs) {
  // Count UI16 + (CharID UI16 + Name STRING)
  const count = Buffer.alloc(2); count.writeUInt16LE(pairs.length, 0);
  const items = pairs.map(([id, name]) => {
    const idBuf = Buffer.alloc(2); idBuf.writeUInt16LE(id, 0);
    return Buffer.concat([idBuf, cstr(name)]);
  });
  return tag(56, Buffer.concat([count, ...items]));
}

// Tag 9: SetBackgroundColor (RGB)
function setBackgroundColor(r, g, b) {
  return tag(9, Buffer.from([r, g, b]));
}

// Tag 43: FrameLabel
function frameLabel(label) { return tag(43, cstr(label)); }

// Tag 0: End
function endTag() { return tag(0, Buffer.alloc(0)); }

// ── Build SWF ──────────────────────────────────────
function buildSwf() {
  const tags = [];
  tags.push(setBackgroundColor(0xff, 0xff, 0xff));

  const sprites = [];
  let charId = 1;

  for (const name of SIGN_NAMES) {
    // Define an EditText for this sign
    const textId = charId++;
    const editText = defineEditText(textId, name);
    tags.push(editText);

    // Define a sprite containing the text
    const spriteId = charId++;
    const spriteBody = Buffer.concat([
      placeObject2(textId, 1),
      showFrame(),
      endTag(),
    ]);
    tags.push(defineSprite(spriteId, 1, spriteBody));

    sprites.push([spriteId, name]);
  }

  // Export all sprites by linkage name
  tags.push(exportAssets(sprites));

  // Main timeline: 10 frames each with FrameLabel matching a fruit
  // and the corresponding sprite placed at depth 1 (so gotoAndStop also works).
  for (let i = 0; i < SIGN_NAMES.length; i++) {
    const name = SIGN_NAMES[i];
    const [spriteId] = sprites[i];
    tags.push(frameLabel(name));
    if (i > 0) {
      // Remove previous sprite at depth 1
      // RemoveObject2 (Tag 28): just depth UI16
      const rmBuf = Buffer.alloc(2); rmBuf.writeUInt16LE(1, 0);
      tags.push(tag(28, rmBuf));
    }
    tags.push(placeObject2(spriteId, 1));
    tags.push(showFrame());
  }
  tags.push(endTag());

  // Movie header
  const stage = rect(0, SYMBOL_W, 0, SYMBOL_H);
  const frameRate = Buffer.alloc(2); frameRate.writeUInt16LE(12 * 256, 0); // 12 fps (8.8 fixed)
  const frameCount = Buffer.alloc(2); frameCount.writeUInt16LE(SIGN_NAMES.length, 0);

  const body = Buffer.concat([stage, frameRate, frameCount, ...tags]);

  // SWF header (uncompressed FWS)
  const fileLen = 8 + body.length;
  const header = Buffer.alloc(8);
  header.write('FWS', 0, 'ascii');
  header.writeUInt8(7, 3);           // version 7
  header.writeUInt32LE(fileLen, 4);  // total file length

  return Buffer.concat([header, body]);
}

const out = buildSwf();
const target = path.resolve(__dirname, '..', 'public', 'swf', 'frutiSign.swf');
fs.writeFileSync(target, out);
console.log(`Wrote ${target} (${out.length} bytes)`);
