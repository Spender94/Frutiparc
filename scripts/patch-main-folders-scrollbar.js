#!/usr/bin/env node
// Patches legacy/main.swf to attach a ScrollBar widget directly on
// every cp.IconList instance, bypassing Component's overflow check
// (which is the path that previously caused recursion + 9 % init
// stall on Firefox).
//
// Background from previous iterations:
//   * cp.IconList extends Component and powers the icon grid inside
//     folder windows (Inventaire / Pictos / Accessoires / Explorer).
//   * Component owns the scrollbar machinery (addScrollBar /
//     rmScrollBar / checkScrollNeed) but checkScrollNeed never gets
//     called on cp.IconList instances during a normal inventory
//     open — that's why the bar was missing.
//   * Force-calling checkScrollNeed from a build wrapper produced a
//     recursive build → checkScrollNeed → build loop. Chrome
//     tolerated it (several extra build traces) but Firefox stalled
//     at 9 % during init.
//
// Safer strategy: skip checkScrollNeed entirely. Call addScrollBar
// directly — it attaches the ScrollBar widget without triggering a
// layout re-check. Guarded by a per-instance __fpKicked flag so
// build can fire multiple times without re-attaching the bar.
//
//     cp.IconList.prototype.build = function () {
//       this.__fpOrigBuild();
//       if (!this.__fpKicked) {
//         this.__fpKicked   = true;
//         this.flScrollable = true;
//         if (this.addScrollBar) this.addScrollBar();
//         trace("FP_FOLDERS_KICK this=<path> sb=<bar>");
//       }
//     };
//
// Idempotent via the marker "__fpFolderScroll__" in the const pool.

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
  '__fpFolderScroll__',       // 0 marker
  '_root',                    // 1
  'onEnterFrame',             // 2
  '_global',                  // 3
  'Component',                // 4
  'cp',                       // 5
  'IconList',                 // 6
  'prototype',                // 7
  '__fpFolderInit',           // 8
  'flScrollable',             // 9
  'build',                    // 10
  '__fpOrigBuild',            // 11
  '__fpKicked',               // 12
  'addScrollBar',             // 13
  // Debug
  'FP_FOLDERS_INSTALL',       // 14
  'FP_FOLDERS_HOOKED',        // 15
  'FP_FOLDERS_KICK this=',    // 16
  ' addSB=',                  // 17
];
const CP = {
  MARKER:0, _ROOT:1, ON_ENTER_FRAME:2, _GLOBAL:3, COMPONENT:4,
  CP_NS:5, ICONLIST:6, PROTOTYPE:7, FOLDER_INIT:8, FL_SCROLLABLE:9,
  BUILD:10, ORIG_BUILD:11, KICKED:12, ADD_SB:13,
  T_INSTALL:14, T_HOOKED:15, T_KICK:16, T_ADDSB:17,
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

function pushGlobalMember(memberCp) {
  return Buffer.concat([
    actionPush(pushCp8(CP._GLOBAL)), GET_VARIABLE,
    actionPush(pushCp8(memberCp)), GET_MEMBER,
  ]);
}
function pushCpIconList() {
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
//     if (!this.__fpKicked) {
//       this.__fpKicked   = true;
//       this.flScrollable = true;
//       if (this.addScrollBar) this.addScrollBar();
//       trace("FP_FOLDERS_KICK this=<path> addSB=<value>");
//     }
//   }
//
// PreloadThisFlag → register 1 holds `this`.
function buildBuildWrapperBody() {
  // Body of the "if (!__fpKicked)" branch, built first so we know
  // its length for the guarding ActionIf.
  const kickBody = Buffer.concat([
    // this.__fpKicked = true
    actionPush(pushReg(1), pushCp8(CP.KICKED), pushBool(true)),
    SET_MEMBER,
    // this.flScrollable = true
    actionPush(pushReg(1), pushCp8(CP.FL_SCROLLABLE), pushBool(true)),
    SET_MEMBER,
    // if (this.addScrollBar) this.addScrollBar();
    //   guard: push this.addScrollBar, Not, ActionIf(skip call)
    //
    // Build the call first to know its size.
    Buffer.concat([
      actionPush(pushReg(1), pushCp8(CP.ADD_SB)), GET_MEMBER,
      NOT,
      // — placeholder offset patched in below —
    ]),
    // ⏎ continue below with the actual If + call
  ]);
  // The above is awkward — rebuild cleanly.

  // this.addScrollBar()
  const callAddSb = Buffer.concat([
    actionPush(pushInt(0), pushReg(1), pushCp8(CP.ADD_SB)),
    CALL_METHOD,
    POP,
  ]);
  // if (!this.addScrollBar) skip callAddSb
  const guardAddSb = Buffer.concat([
    actionPush(pushReg(1), pushCp8(CP.ADD_SB)), GET_MEMBER,
    NOT,
    actionIf(callAddSb.length),
  ]);

  // Trace: "FP_FOLDERS_KICK this=" + this + " addSB=" + this.addScrollBar
  const traceLine = Buffer.concat([
    actionPush(pushCp8(CP.T_KICK), pushReg(1)), ADD2,
    actionPush(pushCp8(CP.T_ADDSB)),            ADD2,
    actionPush(pushReg(1), pushCp8(CP.ADD_SB)), GET_MEMBER,
    ADD2,
    TRACE,
  ]);

  const kickBranch = Buffer.concat([
    // this.__fpKicked = true
    actionPush(pushReg(1), pushCp8(CP.KICKED), pushBool(true)),
    SET_MEMBER,
    // this.flScrollable = true
    actionPush(pushReg(1), pushCp8(CP.FL_SCROLLABLE), pushBool(true)),
    SET_MEMBER,
    // if (this.addScrollBar) this.addScrollBar();
    guardAddSb, callAddSb,
    // trace
    traceLine,
  ]);

  // if (this.__fpKicked) skip kickBranch  (i.e. only run once)
  const kickGate = Buffer.concat([
    actionPush(pushReg(1), pushCp8(CP.KICKED)), GET_MEMBER,
    actionIf(kickBranch.length),
  ]);

  return Buffer.concat([
    // this.__fpOrigBuild()
    actionPush(pushInt(0), pushReg(1), pushCp8(CP.ORIG_BUILD)),
    CALL_METHOD,
    POP,
    // gated kick branch
    kickGate, kickBranch,
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

// ── onEnterFrame body (polling for class registration) ────────────────────

function buildOnEnterFrameBody() {
  const buildFn = buildDefineFunction2(buildBuildWrapperBody(), 2, 0x0001);

  const setMembers = Buffer.concat([
    // Component.prototype.__fpFolderInit = true  — marker so we
    // never re-run the install path.
    pushGlobalMember(CP.COMPONENT),
    actionPush(pushCp8(CP.PROTOTYPE)), GET_MEMBER,
    actionPush(pushCp8(CP.FOLDER_INIT), pushBool(true)),
    SET_MEMBER,
    // Component.prototype.flScrollable = true (default for all
    // Component instances; harmless on the ones that already had it).
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
    // trace("FP_FOLDERS_HOOKED")
    actionPush(pushCp8(CP.T_HOOKED)),
    TRACE,
    // delete _root.onEnterFrame  — one-shot, no per-frame cost from here.
    actionPush(pushCp8(CP._ROOT)), GET_VARIABLE,
    actionPush(pushCp8(CP.ON_ENTER_FRAME)),
    DELETE,
  ]);

  const guardInit = Buffer.concat([
    pushGlobalMember(CP.COMPONENT),
    actionPush(pushCp8(CP.PROTOTYPE)), GET_MEMBER,
    actionPush(pushCp8(CP.FOLDER_INIT)), GET_MEMBER,
    actionIf(setMembers.length),    // skip if already initialised
  ]);

  const guardedSection = Buffer.concat([guardInit, setMembers]);

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
