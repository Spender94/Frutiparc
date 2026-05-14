#!/usr/bin/env node
// Patches legacy/main.swf so chat (and any other) input TextFields keep
// the caret in view while the user types — the Flash-native scrollH
// auto-advance behaviour is missing from Ruffle's AVM1 TextField.
//
// First attempt (commits e04ca08 → 9bed1fd) installed _root.onEnterFrame
// and used `eval(Selection.getFocus())` to resolve the focused field.
// Production traces confirmed the handler runs and that
// Selection.getFocus() returns the right path string, but
// `eval("_level0.main.slotListMc.…field")` returned null/undefined —
// Ruffle's eval() doesn't appear to walk multi-segment paths. The
// assignment branch therefore never fired.
//
// Second approach (this file): hook TextField.prototype.onChanged
// instead. AS2 fires this method whenever a TextField's contents
// change (typing, programmatic setText, …) with `this` bound to the
// changed field — no path resolution needed.
//
//     TextField.prototype.onChanged = function () {
//       this.scrollH = this.maxhscroll;
//     };
//
// `this` reaches the function via DefineFunction2's PreloadThisFlag
// (flags bit 0 of byte 1 = 0x01) — Ruffle puts the calling instance
// in the first register after any declared params; with 0 params,
// that's register 1.
//
// Three diagnostic trace() calls remain so the console immediately
// tells us whether each step works:
//   * "FP_KICK_INSTALL"      — emitted once when the DoAction runs.
//   * "FP_KICK_PROTO_SET"    — emitted once after we assign onChanged.
//   * "FP_KICK CHANGED …"    — emitted on every onChanged firing.
// Ruffle's logLevel is set to "info" in ruffle.html temporarily so
// these traces reach the JS console.
//
// Idempotent via the marker "__fpScrollKick__" in the const pool.

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
  // single byte (the register index). Without it Ruffle log-spams
  // "Length mismatch in AVM1 action: StoreRegister".
  return Buffer.from([0x87, 0x01, 0x00, r & 0xff]);
}

const GET_VARIABLE = simple(0x1c);
const GET_MEMBER   = simple(0x4e);
const SET_MEMBER   = simple(0x4f);
const CALL_METHOD  = simple(0x52);
const POP          = simple(0x17);
const END          = simple(0x00);
const TRACE        = simple(0x26);
const ADD2         = simple(0x47);

// ── Build the injected DoAction body ──────────────────────────────────────

const STR = [
  '__fpScrollKick__',                  // 0 marker (never accessed)
  'TextField',                         // 1
  'prototype',                         // 2
  'onChanged',                         // 3
  'scrollH',                           // 4
  'maxhscroll',                        // 5
  // Debug traces (Ruffle logLevel: info)
  'FP_KICK_INSTALL',                   // 6
  'FP_KICK_PROTO_SET',                 // 7
  'FP_KICK CHANGED scrollH=',          // 8
  ' maxh=',                            // 9
  // The Ruffle-bug workaround: shift the TextField's own _x left by
  // maxhscroll so its parent mask reveals the tail of the text. See
  // the shiftX block in buildOnChangedBody() for the rationale.
  '_x',                                // 10
];
const CP = {
  MARKER:0, TEXT_FIELD:1, PROTOTYPE:2, ON_CHANGED:3,
  SCROLL_H:4, MAX_HS:5,
  T_INSTALL:6, T_PROTO:7, T_CHANGED:8, T_MAXH:9,
  _X:10,
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

// Body of the onChanged handler. PreloadThisFlag puts `this` in register
// 1 (no params declared). The body is:
//
//   trace("FP_KICK CHANGED scrollH=" + this.scrollH + " maxh=" + this.maxhscroll)
//   this.scrollH = this.maxhscroll
//
function buildOnChangedBody() {
  // Build the trace string by concatenating prefix, this.scrollH,
  // " maxh=", this.maxhscroll.
  const traceCall = Buffer.concat([
    actionPush(pushCp8(CP.T_CHANGED)),                   // "FP_KICK CHANGED scrollH="
    actionPush(pushReg(1), pushCp8(CP.SCROLL_H)), GET_MEMBER,
    ADD2,
    actionPush(pushCp8(CP.T_MAXH)),                      // " maxh="
    ADD2,
    actionPush(pushReg(1), pushCp8(CP.MAX_HS)), GET_MEMBER,
    ADD2,
    TRACE,
  ]);
  // this.scrollH = this.maxhscroll (kept in case some other AS code
  // reads scrollH, e.g. a scrollbar widget — even though Ruffle does
  // not actually use it for rendering)
  const assign = Buffer.concat([
    actionPush(pushReg(1), pushCp8(CP.SCROLL_H),
               pushReg(1), pushCp8(CP.MAX_HS)),
    GET_MEMBER,    // → this.maxhscroll
    SET_MEMBER,    // this.scrollH = (top of stack)
  ]);
  // Ruffle stores scrollH/maxhscroll correctly but its EditText
  // renderer ignores scrollH when laying out content — confirmed
  // from production traces (scrollH tracks maxhscroll on every
  // keystroke yet the caret still slides off the right edge).
  // setTextFormat() to force an invalidation didn't help either.
  //
  // Sidestep the engine bug entirely by physically shifting the
  // TextField inside its parent: this._x = -this.maxhscroll. The
  // chat say-bar (and most Flash input components) lives inside a
  // wrapper MovieClip with a mask clipping it to the visible width,
  // so moving the field left by maxhscroll pushes the early text
  // off the LEFT side of the mask and reveals the caret on the
  // right — matching the Flash-native scroll behaviour visually.
  //
  // maxhscroll is 0 when the text fits, so _x stays at its layout
  // origin (0 by convention for child clips); only once the text
  // overflows does _x go negative.
  //
  // Bytecode for: this._x = 0 - this.maxhscroll
  //   Push this, "_x"             → [this, "_x"]
  //   Push 0                       → [this, "_x", 0]
  //   Push this, "maxhscroll"      → [this, "_x", 0, this, "maxhscroll"]
  //   GetMember                    → [this, "_x", 0, maxhscroll]
  //   Subtract (0x0B): pops top    → [this, "_x", -maxhscroll]
  //   SetMember                    → []
  const SUBTRACT = Buffer.from([0x0B]);
  const shiftX = Buffer.concat([
    actionPush(pushReg(1), pushCp8(CP._X)),
    actionPush(pushInt(0), pushReg(1), pushCp8(CP.MAX_HS)),
    GET_MEMBER,
    SUBTRACT,
    SET_MEMBER,
  ]);
  return Buffer.concat([traceCall, assign, shiftX, END]);
}

function buildDefineFunction2(funcBody) {
  // DefineFunction2 (0x8E):
  //   name (null-term) + numParams(UI16) + numRegs(UI8) + flags(UI16) +
  //   parameters + codeSize(UI16)
  // Flags byte-1 bit-0 = PreloadThisFlag → put `this` in register 1.
  const nameTerm = Buffer.from([0x00]);
  const hdr = Buffer.alloc(2 + 1 + 2);
  hdr.writeUInt16LE(0, 0);     // numParams
  hdr[2] = 2;                   // numRegisters (r0 + r1=this)
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
    // Trace: "FP_KICK_INSTALL"
    actionPush(pushCp8(CP.T_INSTALL)), TRACE,

    // TextField.prototype.onChanged = function () { ... }
    actionPush(pushCp8(CP.TEXT_FIELD)), GET_VARIABLE,          // TextField
    actionPush(pushCp8(CP.PROTOTYPE)),  GET_MEMBER,            // .prototype
    actionPush(pushCp8(CP.ON_CHANGED)),                        // "onChanged"
    onChangedFn,                                                // function on stack
    SET_MEMBER,                                                 // assign

    // Trace: "FP_KICK_PROTO_SET" — fires only if SetMember succeeded
    // without throwing, confirming TextField.prototype was reachable.
    actionPush(pushCp8(CP.T_PROTO)), TRACE,

    END,
  ]);

  return Buffer.concat([cp, install]);
}

function buildDoActionTag(body) {
  // DoAction is tag code 12. Long-form length so we can grow freely.
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
