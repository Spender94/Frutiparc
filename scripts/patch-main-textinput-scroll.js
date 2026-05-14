#!/usr/bin/env node
// Patches legacy/main.swf so chat input TextFields keep the caret in
// view while the user types past the visible width of the field —
// the Flash-native scrollH-tracks-caret behaviour is missing from
// Ruffle's AVM1 EditText renderer.
//
// Earlier attempts: setting scrollH (Ruffle stores it but never
// renders with it), setTextFormat to invalidate (no-op visually),
// and a simple `this._x = -maxhscroll` shift (worked visually but
// the parent wrapper has no mask in the original SWF so the head
// of the text spilled out the left edge of the visible chat bar,
// and the shift kicked in before the text actually reached the
// right edge because the TextField is smaller than the chrome).
//
// Final approach: create a clipping mask MovieClip on the parent
// the first time onChanged fires, sized to the TextField's
// original bounds, then shift the field via _x using the more
// accurate `textWidth - _width` overflow measure. The mask sticks
// at the field's original visual position so the head of the text
// disappears off the LEFT side of the mask (matching Flash native
// behaviour) instead of leaking into the bar's chrome.
//
//     TextField.prototype.onChanged = function () {
//       if (!this.__fpMaskInit) {
//         this.__fpMaskInit = true;
//         this.__fpOrigX = this._x;
//         var mc = this._parent.createEmptyMovieClip(
//                    "__fpMask_" + this._name, 999999);
//         mc.beginFill(0);
//         mc.moveTo(this._x, this._y);
//         mc.lineTo(this._x + this._width, this._y);
//         mc.lineTo(this._x + this._width, this._y + this._height);
//         mc.lineTo(this._x, this._y + this._height);
//         mc.endFill();
//         this.setMask(mc);
//       }
//       var ovf = this.textWidth - this._width;
//       this._x = ovf > 0 ? this.__fpOrigX - ovf : this.__fpOrigX;
//       this.scrollH = this.maxhscroll;
//     };
//
// `this` reaches the function body via DefineFunction2's
// PreloadThisFlag — register 1.
//
// Idempotent via the marker "__fpScrollKick__" in the CP.

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
function pushNull()  { return Buffer.from([0x02]); }
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
  // 0x87 needs its UI16 payload-length even though the payload is a
  // single byte. Without it Ruffle log-spams "Length mismatch".
  return Buffer.from([0x87, 0x01, 0x00, r & 0xff]);
}
function actionIf(off) {
  const b = Buffer.alloc(5);
  b[0] = 0x9d;
  b.writeUInt16LE(2, 1);
  b.writeInt16LE(off, 3);
  return b;
}

const GET_VARIABLE = simple(0x1c);
const GET_MEMBER   = simple(0x4e);
const SET_MEMBER   = simple(0x4f);
const CALL_METHOD  = simple(0x52);
const POP          = simple(0x17);
const END          = simple(0x00);
const TRACE        = simple(0x26);
const ADD2         = simple(0x47);
const SUBTRACT     = simple(0x0b);
const LESS2        = simple(0x48);
const NOT          = simple(0x12);

// ── Build the injected DoAction body ──────────────────────────────────────

const STR = [
  '__fpScrollKick__',                  // 0  marker
  'TextField',                         // 1
  'prototype',                         // 2
  'onChanged',                         // 3
  'scrollH',                           // 4
  'maxhscroll',                        // 5
  'textWidth',                         // 6
  '_width',                            // 7
  '_height',                           // 8
  '_x',                                // 9
  '_y',                                // 10
  '_name',                             // 11
  '_parent',                           // 12
  'createEmptyMovieClip',              // 13
  'beginFill',                         // 14
  'moveTo',                            // 15
  'lineTo',                            // 16
  'endFill',                           // 17
  'setMask',                           // 18
  '__fpMaskInit',                      // 19
  '__fpOrigX',                         // 20
  '__fpMask_',                         // 21  prefix concatenated with this._name
  'FP_KICK_INSTALL',                   // 22
  'FP_KICK_PROTO_SET',                 // 23
];
const CP = {
  MARKER:0, TEXT_FIELD:1, PROTOTYPE:2, ON_CHANGED:3,
  SCROLL_H:4, MAX_HS:5, TEXT_WIDTH:6,
  _WIDTH:7, _HEIGHT:8, _X:9, _Y:10, _NAME:11, _PARENT:12,
  CREATE_EMC:13, BEGIN_FILL:14, MOVE_TO:15, LINE_TO:16, END_FILL:17, SET_MASK:18,
  MASK_INIT:19, ORIG_X:20, MASK_PREFIX:21,
  T_INSTALL:22, T_PROTO:23,
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

// Helpers to fetch `this.<prop>` and push to stack
function getThisMember(propIdx) {
  return Buffer.concat([
    actionPush(pushReg(1), pushCp8(propIdx)),
    GET_MEMBER,
  ]);
}

// ── Mask-creation block ───────────────────────────────────────────────────
// Pseudocode (with `this` in r1):
//
//   this.__fpMaskInit = true;
//   this.__fpOrigX    = this._x;
//   r2 = this._parent;
//   r3 = r2.createEmptyMovieClip("__fpMask_" + this._name, 999999);
//   r3.beginFill(0);
//   r3.moveTo(this._x, this._y);
//   r3.lineTo(this._x + this._width, this._y);
//   r3.lineTo(this._x + this._width, this._y + this._height);
//   r3.lineTo(this._x, this._y + this._height);
//   r3.endFill();
//   this.setMask(r3);
//
function buildMaskInit() {
  // this.__fpMaskInit = true
  const setInit = Buffer.concat([
    actionPush(pushReg(1), pushCp8(CP.MASK_INIT)),
    actionPush(Buffer.from([0x05, 0x01])),    // pushBool true (type 5, val 1)
    SET_MEMBER,
  ]);
  // this.__fpOrigX = this._x
  const setOrigX = Buffer.concat([
    actionPush(pushReg(1), pushCp8(CP.ORIG_X)),
    getThisMember(CP._X),
    SET_MEMBER,
  ]);
  // r2 = this._parent
  const loadParent = Buffer.concat([
    getThisMember(CP._PARENT),
    storeReg(2), POP,
  ]);
  // r3 = r2.createEmptyMovieClip("__fpMask_" + this._name, 999999)
  //   args order on stack (bottom→top): name, depth, argCount, object, method
  const createMask = Buffer.concat([
    // arg1: "__fpMask_" + this._name
    actionPush(pushCp8(CP.MASK_PREFIX)),
    getThisMember(CP._NAME),
    ADD2,
    // arg2: 999999
    actionPush(pushInt(999999)),
    // argCount, object, method
    actionPush(pushInt(2), pushReg(2), pushCp8(CP.CREATE_EMC)),
    CALL_METHOD,
    storeReg(3), POP,
  ]);
  // r3.beginFill(0)
  const beginFill = Buffer.concat([
    actionPush(pushInt(0), pushInt(1), pushReg(3), pushCp8(CP.BEGIN_FILL)),
    CALL_METHOD,
    POP,
  ]);
  // r3.moveTo(this._x, this._y)
  const moveTo = Buffer.concat([
    getThisMember(CP._X),
    getThisMember(CP._Y),
    actionPush(pushInt(2), pushReg(3), pushCp8(CP.MOVE_TO)),
    CALL_METHOD,
    POP,
  ]);
  // r3.lineTo(this._x + this._width, this._y)
  const lineTo1 = Buffer.concat([
    getThisMember(CP._X),
    getThisMember(CP._WIDTH),
    ADD2,
    getThisMember(CP._Y),
    actionPush(pushInt(2), pushReg(3), pushCp8(CP.LINE_TO)),
    CALL_METHOD,
    POP,
  ]);
  // r3.lineTo(this._x + this._width, this._y + this._height)
  const lineTo2 = Buffer.concat([
    getThisMember(CP._X),
    getThisMember(CP._WIDTH),
    ADD2,
    getThisMember(CP._Y),
    getThisMember(CP._HEIGHT),
    ADD2,
    actionPush(pushInt(2), pushReg(3), pushCp8(CP.LINE_TO)),
    CALL_METHOD,
    POP,
  ]);
  // r3.lineTo(this._x, this._y + this._height)
  const lineTo3 = Buffer.concat([
    getThisMember(CP._X),
    getThisMember(CP._Y),
    getThisMember(CP._HEIGHT),
    ADD2,
    actionPush(pushInt(2), pushReg(3), pushCp8(CP.LINE_TO)),
    CALL_METHOD,
    POP,
  ]);
  // r3.endFill()
  const endFill = Buffer.concat([
    actionPush(pushInt(0), pushReg(3), pushCp8(CP.END_FILL)),
    CALL_METHOD,
    POP,
  ]);
  // this.setMask(r3)
  const setMask = Buffer.concat([
    actionPush(pushReg(3), pushInt(1), pushReg(1), pushCp8(CP.SET_MASK)),
    CALL_METHOD,
    POP,
  ]);
  return Buffer.concat([
    setInit, setOrigX, loadParent, createMask,
    beginFill, moveTo, lineTo1, lineTo2, lineTo3, endFill,
    setMask,
  ]);
}

// ── Shift + scrollH update — runs every call ──────────────────────────────
function buildShiftAndScroll() {
  // ovf = this.textWidth - this._width  (store in r4)
  const computeOvf = Buffer.concat([
    getThisMember(CP.TEXT_WIDTH),
    getThisMember(CP._WIDTH),
    SUBTRACT,
    storeReg(4), POP,
  ]);
  // Branches:
  //   if (r4 > 0)  this._x = this.__fpOrigX - r4;
  //   else         this._x = this.__fpOrigX;
  //
  // overflow > 0 = !(overflow <= 0) = !(0 < r4 inverted)
  // Simpler: push 0, push r4, Less2 → r4 < 0?  inverted.
  // Even simpler: push 0, push r4, Less2 → (0 < r4) → true iff r4 > 0
  const ifOvfPositive = Buffer.concat([
    actionPush(pushInt(0), pushReg(4)),
    LESS2,                                   // → (0 < r4) i.e. r4>0
  ]);

  // Block executed when r4 > 0: this._x = this.__fpOrigX - r4
  const shiftLeft = Buffer.concat([
    actionPush(pushReg(1), pushCp8(CP._X)),
    getThisMember(CP.ORIG_X),
    actionPush(pushReg(4)),
    SUBTRACT,
    SET_MEMBER,
  ]);

  // Block executed when r4 <= 0: this._x = this.__fpOrigX
  const resetX = Buffer.concat([
    actionPush(pushReg(1), pushCp8(CP._X)),
    getThisMember(CP.ORIG_X),
    SET_MEMBER,
  ]);

  // Build the if/else. ActionIf(off) jumps `off` bytes forward when
  // true. We want: if r4>0 jump to shiftLeft, else fall through to
  // resetX + unconditional jump past shiftLeft.
  //
  // Easier idiom: invert the predicate so we can fall through to
  // shiftLeft and jump only when not-overflow:
  //   compute (r4>0) → Not → 1 iff not-overflow
  //   ActionIf(skipShift) → jump over shiftLeft, land on resetX
  //   shiftLeft
  //   ActionJump(pastResetX) → skip resetX
  //   resetX
  //
  // We have to know byte lengths upfront for both jumps. Build the
  // blocks first, then wire the jumps.
  const actionJump = (off) => {
    const b = Buffer.alloc(5);
    b[0] = 0x99;
    b.writeUInt16LE(2, 1);
    b.writeInt16LE(off, 3);
    return b;
  };

  const jumpPastResetX = actionJump(resetX.length);
  const shiftPlusJump = Buffer.concat([shiftLeft, jumpPastResetX]);
  const skipShiftJump = actionIf(shiftPlusJump.length);

  const branch = Buffer.concat([
    ifOvfPositive,
    NOT,
    skipShiftJump,
    shiftPlusJump,
    resetX,
  ]);

  // this.scrollH = this.maxhscroll
  const setScrollH = Buffer.concat([
    actionPush(pushReg(1), pushCp8(CP.SCROLL_H)),
    getThisMember(CP.MAX_HS),
    SET_MEMBER,
  ]);

  return Buffer.concat([computeOvf, branch, setScrollH]);
}

function buildOnChangedBody() {
  const maskInit = buildMaskInit();
  const shiftAndScroll = buildShiftAndScroll();

  // Wrap mask init in `if (!this.__fpMaskInit) { ... }`. Same idiom:
  //   push this.__fpMaskInit
  //   ActionIf(skipInit) → jumps past mask creation when already set
  const initGate = Buffer.concat([
    getThisMember(CP.MASK_INIT),
    actionIf(maskInit.length),               // skip when truthy
  ]);

  return Buffer.concat([initGate, maskInit, shiftAndScroll, END]);
}

function buildDefineFunction2(funcBody) {
  // DefineFunction2 (0x8E) header — PreloadThisFlag puts `this` in r1.
  // We use up to r4 for ovf, so numRegs=5.
  const nameTerm = Buffer.from([0x00]);
  const hdr = Buffer.alloc(2 + 1 + 2);
  hdr.writeUInt16LE(0, 0);     // numParams
  hdr[2] = 5;                   // numRegisters
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
