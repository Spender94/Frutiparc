#!/usr/bin/env node
// Patches legacy/main.swf to re-enable the scrollbar inside folder
// windows (Inventaire, Pictos, Accessoires, Mes contacts, …).
//
// The SWF already ships the full scroll machinery (Component class
// with addScrollBar / checkScrollNeed / getContentBounds, ScrollBar
// widget at _global.ScrollBar, IconFileBox extends Component). The
// scrollbar normally appears when `instance.flScrollable === true`
// — but on Ruffle the bar never shows up, suggesting that flag is
// either never set or being reset somewhere along the init chain.
//
// First-attempt fix: force `Component.prototype.flScrollable = true`
// so every instance inherits the flag by default. If the prototype
// assignment alone isn't enough (e.g. constructors explicitly set
// `this.flScrollable = false`, or checkScrollNeed is failing for a
// different reason such as getBounds returning zero), we'll escalate
// — but this single line is the smallest possible kick and worth
// trying first.
//
// Because `_global.Component` is registered lazily (its __Packages
// init runs from a DoInitAction tag, not necessarily before our
// frame-1 DoAction), we poll for it via `_root.onEnterFrame`:
//
//     _root.onEnterFrame = function () {
//       if (_global.Component != undefined
//           && _global.Component.prototype != undefined
//           && !_global.Component.prototype.__fpFolderInit) {
//         _global.Component.prototype.__fpFolderInit = true;
//         _global.Component.prototype.flScrollable = true;
//         // self-destruct: no point polling forever
//         delete _root.onEnterFrame;
//       }
//     };
//
// One-shot, idempotent via the marker "__fpFolderScroll__" in the
// const pool.

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

// ── AS2 bytecode primitives ────────────────────────────────────────────────

function pushCp8(i)  { return Buffer.from([0x08, i & 0xff]); }
function pushReg(r)  { return Buffer.from([0x04, r & 0xff]); }
function pushUndef() { return Buffer.from([0x03]); }
function pushBool(v) { return Buffer.from([0x05, v ? 0x01 : 0x00]); }
function actionPush(...items) {
  const data = Buffer.concat(items);
  const hdr = Buffer.alloc(3);
  hdr[0] = 0x96;
  hdr.writeUInt16LE(data.length, 1);
  return Buffer.concat([hdr, data]);
}
function simple(op) { return Buffer.from([op]); }
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
const POP          = simple(0x17);
const END          = simple(0x00);
const TRACE        = simple(0x26);
const EQUALS2      = simple(0x49);
const NOT          = simple(0x12);
const DELETE       = simple(0x3a);

// ── Constant pool ─────────────────────────────────────────────────────────

const STR = [
  '__fpFolderScroll__',       // 0 marker (never accessed)
  '_root',                    // 1
  'onEnterFrame',             // 2
  'Component',                // 3
  'prototype',                // 4
  '__fpFolderInit',           // 5
  'flScrollable',             // 6
  // Debug
  'FP_FOLDERS_INSTALL',       // 7  emitted once when DoAction runs
  'FP_FOLDERS_HOOKED',        // 8  emitted when the prototype is patched
];
const CP = {
  MARKER:0, _ROOT:1, ON_ENTER_FRAME:2, COMPONENT:3, PROTOTYPE:4,
  FOLDER_INIT:5, FL_SCROLLABLE:6,
  T_INSTALL:7, T_HOOKED:8,
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

// Body of the onEnterFrame handler. Uses no registers (besides what
// DefineFunction2 reserves), so numRegs = 1.
//
// Logic:
//   1. If Component is undefined → return.
//   2. If Component.prototype is undefined → return.
//   3. If Component.prototype.__fpFolderInit is truthy → return.
//   4. Set Component.prototype.__fpFolderInit = true.
//   5. Set Component.prototype.flScrollable = true.
//   6. trace("FP_FOLDERS_HOOKED").
//   7. delete _root.onEnterFrame (one-shot).
function buildOnEnterFrameBody() {
  // Each early-return tests a value, NOTs it, and ActionIfs past the
  // remainder of the function. Build the post-checks block first so
  // we can compute the jump offsets.
  const setMembers = Buffer.concat([
    // Component.prototype.__fpFolderInit = true
    actionPush(pushCp8(CP.COMPONENT)), GET_VARIABLE,
    actionPush(pushCp8(CP.PROTOTYPE)), GET_MEMBER,
    actionPush(pushCp8(CP.FOLDER_INIT)),
    actionPush(pushBool(true)),
    SET_MEMBER,
    // Component.prototype.flScrollable = true
    actionPush(pushCp8(CP.COMPONENT)), GET_VARIABLE,
    actionPush(pushCp8(CP.PROTOTYPE)), GET_MEMBER,
    actionPush(pushCp8(CP.FL_SCROLLABLE)),
    actionPush(pushBool(true)),
    SET_MEMBER,
    // trace("FP_FOLDERS_HOOKED")
    actionPush(pushCp8(CP.T_HOOKED)),
    TRACE,
    // delete _root.onEnterFrame
    actionPush(pushCp8(CP._ROOT)), GET_VARIABLE,
    actionPush(pushCp8(CP.ON_ENTER_FRAME)),
    DELETE,
  ]);

  // Guard 3: Component.prototype.__fpFolderInit is truthy
  //   push value, ActionIf(end) → jumps over setMembers if truthy
  const guard3 = Buffer.concat([
    actionPush(pushCp8(CP.COMPONENT)), GET_VARIABLE,
    actionPush(pushCp8(CP.PROTOTYPE)), GET_MEMBER,
    actionPush(pushCp8(CP.FOLDER_INIT)), GET_MEMBER,
    actionIf(setMembers.length),
  ]);

  // Guard 2: Component.prototype != undefined
  //   push Component.prototype == undefined → ActionIf jumps if true
  const guard2Body = Buffer.concat([guard3, setMembers]);
  const guard2 = Buffer.concat([
    actionPush(pushCp8(CP.COMPONENT)), GET_VARIABLE,
    actionPush(pushCp8(CP.PROTOTYPE)), GET_MEMBER,
    actionPush(pushUndef()),
    EQUALS2,                       // → prototype == undefined
    actionIf(guard2Body.length),   // skip when undefined
  ]);

  // Guard 1: Component != undefined
  const guard1Body = Buffer.concat([guard2, guard2Body]);
  const guard1 = Buffer.concat([
    actionPush(pushCp8(CP.COMPONENT)), GET_VARIABLE,
    actionPush(pushUndef()),
    EQUALS2,                       // → Component == undefined
    actionIf(guard1Body.length),   // skip when undefined
  ]);

  return Buffer.concat([guard1, guard1Body, END]);
}

function buildDefineFunction2(funcBody, numRegs = 1, flags = 0) {
  const nameTerm = Buffer.from([0x00]);
  const hdr = Buffer.alloc(2 + 1 + 2);
  hdr.writeUInt16LE(0, 0);           // numParams
  hdr[2] = numRegs;
  hdr.writeUInt16LE(flags, 3);
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
  const enterFrameFn = buildDefineFunction2(buildOnEnterFrameBody(), 1, 0);
  const install = Buffer.concat([
    actionPush(pushCp8(CP.T_INSTALL)), TRACE,
    // _root.onEnterFrame = function () { ... }
    actionPush(pushCp8(CP._ROOT)), GET_VARIABLE,
    actionPush(pushCp8(CP.ON_ENTER_FRAME)),
    enterFrameFn,
    SET_MEMBER,
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
  return body.indexOf(Buffer.from('__fpFolderScroll__\0', 'latin1')) >= 0;
}

function patch() {
  const { sig, version, body } = readSwf(SWF_PATH);
  if (alreadyPatched(body)) {
    console.log('[folder-scroll] Marker found — already patched, skipping.');
    return;
  }
  const showFrameOff = findFirstShowFrameOffset(body);
  if (showFrameOff < 0) throw new Error('Could not locate first root ShowFrame');

  const newDoActionBody = buildDoActionBody();
  const newTag = buildDoActionTag(newDoActionBody);

  console.log('[folder-scroll] First ShowFrame at offset ' + showFrameOff);
  console.log('[folder-scroll] Injecting DoAction tag: '
    + newTag.length + ' bytes (body=' + newDoActionBody.length + ')');

  const before = body.slice(0, showFrameOff);
  const after  = body.slice(showFrameOff);
  const newBody = Buffer.concat([before, newTag, after]);

  const totalLen = writeSwf(SWF_PATH, sig, version, newBody);
  console.log('[folder-scroll] Wrote ' + SWF_PATH + ' (' + totalLen + ' bytes)');
}

patch();
