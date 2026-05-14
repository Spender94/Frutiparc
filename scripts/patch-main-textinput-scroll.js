#!/usr/bin/env node
// Patches legacy/main.swf so chat input TextFields keep the caret in
// view while the user types past the visible width of the field —
// the Flash-native scrollH-tracks-caret behaviour is missing from
// Ruffle's AVM1 EditText renderer.
//
// Iteration history (kept terse because of the long road):
//   * scrollH = maxhscroll alone  → Ruffle stores but ignores scrollH;
//                                   no visual change.
//   * scrollH + setTextFormat     → no extra invalidation path either.
//   * _x = -maxhscroll            → field shifts visually, caret
//                                   stays in view. Two issues: shift
//                                   starts a few px before text fills
//                                   the visible chat bar (because
//                                   maxhscroll uses TextField._width,
//                                   not the chrome width), and there's
//                                   no parent mask so the head of the
//                                   text leaks out the left edge.
//   * dynamic mask + _x shift     → masking does the wrong thing on
//                                   TextField in this Ruffle build;
//                                   produced a visible black rectangle
//                                   and ended up rendering the field's
//                                   text in the wrong spot.
//
// Final shape: drop the mask experiment entirely. The user is fine
// with the head-of-text leaking out the left as long as the caret
// stays glued to the right edge of the visible bar.
//
//     TextField.prototype.onChanged = function () {
//       if (this.__fpOrigX === undefined) this.__fpOrigX = this._x;
//       var ovf = this.textWidth - this._width;
//       this._x = ovf > 0 ? this.__fpOrigX - ovf : this.__fpOrigX;
//       this.scrollH = this.maxhscroll;
//     };
//
// Using `textWidth - _width` instead of `maxhscroll` makes the shift
// start exactly when the text needs to overflow — Ruffle's
// maxhscroll picks up gutter/rounding a few px early, which the user
// noticed as "decalage avant la fin de la barre". `_width` matches
// the visible bar width here.
//
// `this` is preloaded into register 1 via DefineFunction2's
// PreloadThisFlag.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SWF_PATH = path.resolve(__dirname, '..', 'legacy', 'main.swf');

// ── SWF helpers ────────────────────────────────────────────────────────────

function readSwf(filePath) {
  const raw = fs.readFileSync(filePath);
  const sig = raw.slice(0, 3).toString('ascii');
  if (sig !== 'CWS' && sig !== 'FWS') throw new Error('Unsupported sig: ' + sig);
  const version = raw[3];
  const body = sig === 'CWS' ? zlib.inflateSync(raw.slice(8)) : Buffer.from(raw.slice(8));
  return { sig, version, body };
}
function writeSwf(outPath, sig, version, body) {
  const fileLen = 8 + body.length;
  const payload = sig === 'CWS' ? zlib.deflateSync(body) : body;
  const out = Buffer.alloc(8 + payload.length);
  out.write(sig, 0, 'ascii');
  out.writeUInt8(version, 3);
  out.writeUInt32LE(fileLen, 4);
  payload.copy(out, 8);
  fs.writeFileSync(outPath, out);
  return out.length;
}

// ── AS2 bytecode primitives (spec-correct payload-length form) ────────────

function pushCp8(i)  { return Buffer.from([0x08, i & 0xff]); }
function pushReg(r)  { return Buffer.from([0x04, r & 0xff]); }
function pushUndef() { return Buffer.from([0x03]); }
function pushInt(v)  {
  const b = Buffer.alloc(5); b[0] = 0x07; b.writeInt32LE(v, 1); return b;
}
function actionPush(...items) {
  const data = Buffer.concat(items);
  const hdr = Buffer.alloc(3);
  hdr[0] = 0x96;
  hdr.writeUInt16LE(data.length, 1);
  return Buffer.concat([hdr, data]);
}
function simple(op) { return Buffer.from([op]); }
function storeReg(r) {
  return Buffer.from([0x87, 0x01, 0x00, r & 0xff]);
}
function actionIf(off) {
  const b = Buffer.alloc(5);
  b[0] = 0x9d;
  b.writeUInt16LE(2, 1);
  b.writeInt16LE(off, 3);
  return b;
}
function actionJump(off) {
  const b = Buffer.alloc(5);
  b[0] = 0x99;
  b.writeUInt16LE(2, 1);
  b.writeInt16LE(off, 3);
  return b;
}

const GET_VARIABLE = simple(0x1c);
const GET_MEMBER   = simple(0x4e);
const SET_MEMBER   = simple(0x4f);
const POP          = simple(0x17);
const END          = simple(0x00);
const TRACE        = simple(0x26);
const SUBTRACT     = simple(0x0b);
const ADD2         = simple(0x47);
const LESS2        = simple(0x48);
const EQUALS2      = simple(0x49);
const NOT          = simple(0x12);

// ── Constant pool ─────────────────────────────────────────────────────────

const STR = [
  '__fpScrollKick__',                  // 0 marker (never accessed)
  'TextField',                         // 1
  'prototype',                         // 2
  'onChanged',                         // 3
  'scrollH',                           // 4
  'maxhscroll',                        // 5
  'textWidth',                         // 6
  '_width',                            // 7
  '_x',                                // 8
  '__fpOrigX',                         // 9
  // Debug — kept temporarily so we can confirm the right SWF runs
  // and the handler installs cleanly. Once the user is happy, this
  // patch will be re-run without these and RufflePlayer.config
  // logLevel will go back to "warn".
  'FP_KICK_INSTALL',                   // 10
  'FP_KICK_PROTO_SET',                 // 11
];
const CP = {
  MARKER:0, TEXT_FIELD:1, PROTOTYPE:2, ON_CHANGED:3,
  SCROLL_H:4, MAX_HS:5, TEXT_WIDTH:6,
  _WIDTH:7, _X:8, ORIG_X:9,
  T_INSTALL:10, T_PROTO:11,
};

function buildConstantPool() {
  const strBytes = Buffer.concat(STR.map(s => Buffer.concat([Buffer.from(s, 'utf8'), Buffer.from([0])])));
  const countLE = Buffer.alloc(2); countLE.writeUInt16LE(STR.length, 0);
  const payload = Buffer.concat([countLE, strBytes]);
  const hdr = Buffer.alloc(3);
  hdr[0] = 0x88;
  hdr.writeUInt16LE(payload.length, 1);
  return Buffer.concat([hdr, payload]);
}

// ── onChanged body ────────────────────────────────────────────────────────
//
// Pseudocode (this in r1, ovf in r2):
//   if (this.__fpOrigX === undefined) this.__fpOrigX = this._x;
//   r2 = this.textWidth - this._width;
//   if (r2 > 0) this._x = this.__fpOrigX - r2;
//   else        this._x = this.__fpOrigX;
//   this.scrollH = this.maxhscroll;
//
function buildOnChangedBody() {
  // Capture original _x once. Test:
  //   this.__fpOrigX != undefined  →  truthy → skip capture
  const capture = Buffer.concat([
    actionPush(pushReg(1), pushCp8(CP.ORIG_X)),
    actionPush(pushReg(1), pushCp8(CP._X)),
    GET_MEMBER,
    SET_MEMBER,
  ]);
  const captureGate = Buffer.concat([
    actionPush(pushReg(1), pushCp8(CP.ORIG_X)),
    GET_MEMBER,
    actionPush(pushUndef()),
    EQUALS2,                       // → __fpOrigX == undefined
    NOT,                           // → __fpOrigX != undefined
    actionIf(capture.length),      // skip capture when already defined
  ]);

  // r2 = this.textWidth - (this._width + RIGHT_PADDING)
  //
  // RIGHT_PADDING is the amount of chrome at the right side of the
  // chat input bar that visually obscures any text rendered there.
  // The chat bar has some decoration in its rightmost ~30 px that
  // sits on top of the TextField, so positioning the caret at the
  // field's actual right edge ends up underneath that chrome and
  // the last few characters become invisible.
  //
  // A *negative* padding pulls the post-shift caret back from the
  // field's right edge by that many pixels, keeping the typed text
  // entirely inside the visible (non-occluded) portion of the bar.
  // -30 matches the user's eyeball measurement; reduce towards 0
  // if the bar looks like it has unused space on the right, or go
  // further negative if some chrome is still obscuring text.
  const RIGHT_PADDING = -30;
  const computeOvf = Buffer.concat([
    actionPush(pushReg(1), pushCp8(CP.TEXT_WIDTH)),
    GET_MEMBER,
    actionPush(pushReg(1), pushCp8(CP._WIDTH)),
    GET_MEMBER,
    actionPush(pushInt(RIGHT_PADDING)),
    ADD2,                              // → _width + RIGHT_PADDING
    SUBTRACT,                          // → textWidth - (_width + RIGHT_PADDING)
    storeReg(2), POP,
  ]);

  // shiftLeft = this._x = this.__fpOrigX - r2
  const shiftLeft = Buffer.concat([
    actionPush(pushReg(1), pushCp8(CP._X)),
    actionPush(pushReg(1), pushCp8(CP.ORIG_X)),
    GET_MEMBER,
    actionPush(pushReg(2)),
    SUBTRACT,
    SET_MEMBER,
  ]);

  // resetX = this._x = this.__fpOrigX
  const resetX = Buffer.concat([
    actionPush(pushReg(1), pushCp8(CP._X)),
    actionPush(pushReg(1), pushCp8(CP.ORIG_X)),
    GET_MEMBER,
    SET_MEMBER,
  ]);

  // if (r2 > 0) shiftLeft else resetX
  // Encode as: push !(0 < r2), ActionIf(over shiftLeft+jump)
  //            shiftLeft
  //            ActionJump(over resetX)
  //            resetX
  const jumpPastResetX = actionJump(resetX.length);
  const shiftPlusJump = Buffer.concat([shiftLeft, jumpPastResetX]);
  const ovfBranch = Buffer.concat([
    actionPush(pushInt(0), pushReg(2)),
    LESS2,                                 // → 0 < r2 = r2 > 0
    NOT,                                   // → r2 <= 0
    actionIf(shiftPlusJump.length),        // skip shift when not-overflow
    shiftPlusJump,
    resetX,
  ]);

  // this.scrollH = this.maxhscroll  (harmless extra in case anything
  // else reads scrollH; Ruffle doesn't render with it but storing
  // the right value is cheap and matches semantics).
  const setScrollH = Buffer.concat([
    actionPush(pushReg(1), pushCp8(CP.SCROLL_H)),
    actionPush(pushReg(1), pushCp8(CP.MAX_HS)),
    GET_MEMBER,
    SET_MEMBER,
  ]);

  return Buffer.concat([
    captureGate, capture,
    computeOvf, ovfBranch,
    setScrollH,
    END,
  ]);
}

function buildDefineFunction2(funcBody) {
  // PreloadThisFlag → register 1 = this.
  const nameTerm = Buffer.from([0x00]);
  const hdr = Buffer.alloc(2 + 1 + 2);
  hdr.writeUInt16LE(0, 0);     // numParams
  hdr[2] = 3;                   // numRegisters (we use r1=this, r2=ovf)
  hdr.writeUInt16LE(0x0001, 3); // flags: PreloadThisFlag
  const codeSize = Buffer.alloc(2);
  codeSize.writeUInt16LE(funcBody.length, 0);
  const payload = Buffer.concat([nameTerm, hdr, codeSize]);
  const tagHdr = Buffer.alloc(3);
  tagHdr[0] = 0x8e;
  tagHdr.writeUInt16LE(payload.length, 1);
  return Buffer.concat([tagHdr, payload, funcBody]);
}

function buildDoActionBody() {
  const cp = buildConstantPool();
  const onChangedFn = buildDefineFunction2(buildOnChangedBody());
  const install = Buffer.concat([
    actionPush(pushCp8(CP.T_INSTALL)), TRACE,
    actionPush(pushCp8(CP.TEXT_FIELD)), GET_VARIABLE,
    actionPush(pushCp8(CP.PROTOTYPE)),  GET_MEMBER,
    actionPush(pushCp8(CP.ON_CHANGED)),
    onChangedFn,
    SET_MEMBER,
    actionPush(pushCp8(CP.T_PROTO)), TRACE,
    END,
  ]);
  return Buffer.concat([cp, install]);
}

function buildDoActionTag(body) {
  const head = Buffer.alloc(2);
  head.writeUInt16LE((12 << 6) | 0x3f, 0);
  const len = Buffer.alloc(4);
  len.writeUInt32LE(body.length, 0);
  return Buffer.concat([head, len, body]);
}

// ── Locate first root ShowFrame to inject before ──────────────────────────

function findFirstShowFrameOffset(body) {
  const nbits = (body[0] >> 3) & 0x1f;
  const rectBytes = Math.ceil((5 + nbits * 4) / 8);
  let p = rectBytes + 4;
  while (p < body.length) {
    const hdr = body.readUInt16LE(p);
    const code = hdr >> 6;
    let len = hdr & 0x3f;
    let hSize = 2;
    if (len === 0x3f) { len = body.readUInt32LE(p + 2); hSize = 6; }
    if (code === 1) return p;
    if (code === 0) return -1;
    p += hSize + len;
  }
  return -1;
}

function alreadyPatched(body) {
  return body.indexOf(Buffer.from('__fpScrollKick__\0', 'latin1')) >= 0;
}

function patch() {
  const { sig, version, body } = readSwf(SWF_PATH);
  if (alreadyPatched(body)) {
    console.log('[textinput-scroll] Marker found — already patched, skipping.');
    return;
  }
  const showFrameOff = findFirstShowFrameOffset(body);
  if (showFrameOff < 0) throw new Error('Could not locate first root ShowFrame');

  const newDoActionBody = buildDoActionBody();
  const newTag = buildDoActionTag(newDoActionBody);

  console.log('[textinput-scroll] First ShowFrame at offset ' + showFrameOff);
  console.log('[textinput-scroll] Injecting DoAction tag: '
    + newTag.length + ' bytes (body=' + newDoActionBody.length + ')');

  const before = body.slice(0, showFrameOff);
  const after  = body.slice(showFrameOff);
  const newBody = Buffer.concat([before, newTag, after]);

  const totalLen = writeSwf(SWF_PATH, sig, version, newBody);
  console.log('[textinput-scroll] Wrote ' + SWF_PATH + ' (' + totalLen + ' bytes)');
}

patch();
