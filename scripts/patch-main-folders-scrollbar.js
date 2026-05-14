#!/usr/bin/env node
// Patches legacy/main.swf to re-enable the scrollbar inside folder
// windows (Inventaire, Pictos, Accessoires, Mes contacts, …).
//
// Iteration history:
//   1. Force Component.prototype.flScrollable = true → no visible
//      effect. checkScrollNeed traces showed the flag is honoured
//      on Component instances inside winChat/winAlert/winDebug
//      (their .component799 child), but those are text frames, not
//      icon folders.
//   2. Hook IconFileBox.prototype.displayList / addFile → installed
//      cleanly (post-install verify showed [type Function]) but
//      never fire on inventory opens. IconFileBox is the FILE
//      collection class, not the icon-render component.
//   3. Class dump revealed cp.IconList (and variants
//      cp.IconListBasic / cp.IconListFile / cp.DragIconList) — those
//      extend Component and own the visual icon grid. Hooking
//      cp.IconList.prototype.build (called once per population)
//      and force-calling checkScrollNeed after the layout settles
//      should make Component's own scrollbar machinery kick in.
//
// This script keeps the Component flag flip but trades the unused
// IconFileBox hooks for a build wrapper on cp.IconList. The trace
// on the wrapper also surfaces whether build is actually called
// when opening Inventaire (vs needing to hook a subclass too).

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
function storeReg(r) { return Buffer.from([0x87, 0x01, 0x00, r & 0xff]); }
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
const EQUALS2      = simple(0x49);
const NOT          = simple(0x12);
const DELETE       = simple(0x3a);
const ADD2         = simple(0x47);

// ── Constant pool ─────────────────────────────────────────────────────────

const STR = [
  '__fpFolderScroll__',         // 0 marker
  '_root',                      // 1
  'onEnterFrame',               // 2
  '_global',                    // 3
  'Component',                  // 4
  'cp',                         // 5
  'IconList',                   // 6
  'prototype',                  // 7
  '__fpFolderInit',             // 8
  'flScrollable',               // 9
  'build',                      // 10
  '__fpOrigBuild',              // 11
  'checkScrollNeed',            // 12
  // Debug
  'FP_FOLDERS_INSTALL',         // 13
  'FP_FOLDERS_HOOKED',          // 14
  'FP_FOLDERS_TICK Component=', // 15
  ' IconList=',                 // 16
  'FP_FOLDERS_VERIFY build=',   // 17
  'FP_FOLDERS_BUILD this=',     // 18
];
const CP = {
  MARKER:0, _ROOT:1, ON_ENTER_FRAME:2, _GLOBAL:3, COMPONENT:4,
  CP_NS:5, ICONLIST:6, PROTOTYPE:7, FOLDER_INIT:8, FL_SCROLLABLE:9,
  BUILD:10, ORIG_BUILD:11, CHECK_NEED:12,
  T_INSTALL:13, T_HOOKED:14, T_TICK:15, T_TICK_ICONLIST:16,
  T_VERIFY:17, T_BUILD:18,
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

// Helpers to push values used in many places below.
function pushGlobalMember(memberCp) {
  // Pushes _global.<member> onto the stack.
  return Buffer.concat([
    actionPush(pushCp8(CP._GLOBAL)), GET_VARIABLE,
    actionPush(pushCp8(memberCp)), GET_MEMBER,
  ]);
}
function pushCpIconList() {
  // Pushes _global.cp.IconList onto the stack.
  return Buffer.concat([
    actionPush(pushCp8(CP._GLOBAL)), GET_VARIABLE,
    actionPush(pushCp8(CP.CP_NS)), GET_MEMBER,
    actionPush(pushCp8(CP.ICONLIST)), GET_MEMBER,
  ]);
}
function pushCpIconListProto() {
  return Buffer.concat([
    pushCpIconList(),
    actionPush(pushCp8(CP.PROTOTYPE)), GET_MEMBER,
  ]);
}

// ── cp.IconList.prototype.build wrapper ───────────────────────────────────
//
//   function () {
//     this.__fpOrigBuild();
//     trace("FP_FOLDERS_BUILD this=" + this);
//     this.flScrollable = true;
//     this.checkScrollNeed();
//   }
//
// With PreloadThisFlag, register 1 holds `this` (the cp.IconList
// instance). build() takes no parameters that we need to preserve.
function buildBuildWrapperBody() {
  return Buffer.concat([
    // this.__fpOrigBuild()
    actionPush(pushInt(0), pushReg(1), pushCp8(CP.ORIG_BUILD)),
    CALL_METHOD,
    POP,
    // trace("FP_FOLDERS_BUILD this=" + this)
    actionPush(pushCp8(CP.T_BUILD), pushReg(1)),
    ADD2,
    TRACE,
    // this.flScrollable = true
    actionPush(pushReg(1), pushCp8(CP.FL_SCROLLABLE), pushBool(true)),
    SET_MEMBER,
    // this.checkScrollNeed()
    actionPush(pushInt(0), pushReg(1), pushCp8(CP.CHECK_NEED)),
    CALL_METHOD,
    POP,
    END,
  ]);
}

function buildDefineFunction2(funcBody, numRegs = 1, flags = 0) {
  const nameTerm = Buffer.from([0x00]);
  const hdr = Buffer.alloc(2 + 1 + 2);
  hdr.writeUInt16LE(0, 0);
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

// ── onEnterFrame body ─────────────────────────────────────────────────────

function buildOnEnterFrameBody() {
  const buildFn = buildDefineFunction2(buildBuildWrapperBody(), 2, 0x0001);

  const setMembers = Buffer.concat([
    // Component.prototype.__fpFolderInit = true
    pushGlobalMember(CP.COMPONENT),
    actionPush(pushCp8(CP.PROTOTYPE)), GET_MEMBER,
    actionPush(pushCp8(CP.FOLDER_INIT), pushBool(true)),
    SET_MEMBER,
    // Component.prototype.flScrollable = true
    pushGlobalMember(CP.COMPONENT),
    actionPush(pushCp8(CP.PROTOTYPE)), GET_MEMBER,
    actionPush(pushCp8(CP.FL_SCROLLABLE), pushBool(true)),
    SET_MEMBER,
    // cp.IconList.prototype.__fpOrigBuild = cp.IconList.prototype.build
    pushCpIconListProto(),
    actionPush(pushCp8(CP.ORIG_BUILD)),
    pushCpIconListProto(),
    actionPush(pushCp8(CP.BUILD)), GET_MEMBER,
    SET_MEMBER,
    // cp.IconList.prototype.build = <wrapper>
    pushCpIconListProto(),
    actionPush(pushCp8(CP.BUILD)),
    buildFn,
    SET_MEMBER,
    // Verification trace: dump whether build is now our wrapper.
    actionPush(pushCp8(CP.T_VERIFY)),
    pushCpIconListProto(),
    actionPush(pushCp8(CP.BUILD)), GET_MEMBER,
    ADD2,
    TRACE,
    // trace("FP_FOLDERS_HOOKED")
    actionPush(pushCp8(CP.T_HOOKED)),
    TRACE,
    // delete _root.onEnterFrame (self-destruct)
    actionPush(pushCp8(CP._ROOT)), GET_VARIABLE,
    actionPush(pushCp8(CP.ON_ENTER_FRAME)),
    DELETE,
  ]);

  // Diagnostic tick on every frame until the hooks fire. Shows what
  // _global.Component and _global.cp.IconList currently resolve to,
  // so we can tell whether the polling is waiting on Component, on
  // cp.IconList, or on something else.
  const tick = Buffer.concat([
    actionPush(pushCp8(CP.T_TICK)),
    pushGlobalMember(CP.COMPONENT),
    ADD2,
    actionPush(pushCp8(CP.T_TICK_ICONLIST)),
    ADD2,
    pushCpIconList(),
    ADD2,
    TRACE,
  ]);

  // Guards: don't proceed until both Component and cp.IconList are
  // registered, and the prototype hooks haven't yet been installed.
  const guardInit = Buffer.concat([
    pushGlobalMember(CP.COMPONENT),
    actionPush(pushCp8(CP.PROTOTYPE)), GET_MEMBER,
    actionPush(pushCp8(CP.FOLDER_INIT)), GET_MEMBER,
    actionIf(setMembers.length),    // skip if already initialised
  ]);

  const guardedSection = Buffer.concat([guardInit, setMembers]);

  // Need to ensure both Component and cp.IconList exist before
  // setMembers runs.
  const guardIconList = Buffer.concat([
    pushCpIconList(),
    actionPush(pushUndef()),
    EQUALS2,
    actionIf(guardedSection.length),
  ]);

  const guardComponent = Buffer.concat([
    pushGlobalMember(CP.COMPONENT),
    actionPush(pushUndef()),
    EQUALS2,
    actionIf(guardIconList.length + guardedSection.length),
  ]);

  return Buffer.concat([
    tick,
    guardComponent,
    guardIconList,
    guardedSection,
    END,
  ]);
}

// ── Top-level DoAction body ───────────────────────────────────────────────

function buildDoActionBody() {
  const cp = buildConstantPool();
  const enterFrameFn = buildDefineFunction2(buildOnEnterFrameBody(), 1, 0);
  const install = Buffer.concat([
    actionPush(pushCp8(CP.T_INSTALL)), TRACE,
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
