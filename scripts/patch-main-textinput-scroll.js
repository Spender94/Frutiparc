#!/usr/bin/env node
// Patches legacy/main.swf so that input TextFields keep the caret in view
// while the user types — the Flash-native behaviour of a single-line input
// (auto-advance scrollH so the cursor stays visible past the field width)
// is not implemented in Ruffle's AVM1 TextField, so typing a long chat
// message scrolls the typed text off the right edge with no way to see
// what you're writing.
//
// We don't have the AS source. The fix is to inject a small DoAction at
// the very end of frame 1 of the root timeline that installs:
//
//   _root.onEnterFrame = function () {
//     var p = Selection.getFocus();
//     if (p == null) return;
//     var f = eval(p);
//     if (f == null) return;
//     if (f.type == "input") {
//       f.scrollH = f.maxhscroll;
//     }
//   };
//
// Ruffle implements Selection.getFocus(), eval(), TextField.type / scrollH /
// maxhscroll correctly — it's only the implicit "auto-track caret" that's
// missing. Polling every frame and pinning scrollH to its maximum keeps the
// caret pinned to the right edge while typing, which is the practical
// behaviour Flash Player had natively.
//
// Idempotent: a marker constant ("__fpScrollKick__") in the injected
// ActionConstantPool lets us detect a prior run and skip.

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

// ── AS2 bytecode primitives (matching the conventions used by
//    patch-minipixiz-client.js so behaviour is consistent across patches) ──

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
function storeReg(r) { return Buffer.from([0x87, r & 0xff]); }
function actionIf(off) {
  const b = Buffer.alloc(3); b[0] = 0x9d; b.writeInt16LE(off, 1); return b;
}

const GET_VARIABLE = simple(0x1c);
const CALL_METHOD  = simple(0x52);
const CALL_FUNCTION= simple(0x3d);
const POP          = simple(0x17);
const EQUALS2      = simple(0x49);
const NOT          = simple(0x12);
const GET_MEMBER   = simple(0x4e);
const SET_MEMBER   = simple(0x4f);
const END          = simple(0x00);

// ── Build the injected DoAction tag body ──────────────────────────────────

// Strings used inside the new DoAction. The first one ("__fpScrollKick__")
// is purely a marker so we can detect that the patch has already been
// applied on a subsequent run and skip; the AS code never references it.
const STR = [
  '__fpScrollKick__', // 0 (marker, never used at runtime)
  '_root',            // 1
  'onEnterFrame',     // 2
  'Selection',        // 3
  'getFocus',         // 4
  'eval',             // 5
  'type',             // 6
  'input',            // 7
  'scrollH',          // 8
  'maxhscroll',       // 9
  // Debug-only trace strings — output goes through trace() and shows up
  // in the JS console when Ruffle's logLevel is "info" or lower.
  'FP_KICK_INSTALL',  // 10
  'FP_KICK FOCUS=',   // 11
  'FP_KICK INPUT scrollH=', // 12
  ' maxh=',           // 13
];
const CP = {
  MARKER:0, _ROOT:1, ON_ENTER_FRAME:2, SELECTION:3, GET_FOCUS:4,
  EVAL:5, TYPE:6, INPUT:7, SCROLL_H:8, MAX_HS:9,
  TRACE_INSTALL:10, TRACE_FOCUS:11, TRACE_INPUT:12, TRACE_MAXH:13,
};

const TRACE = Buffer.from([0x26]); // ActionTrace — pops top of stack and logs it
const ADD2  = Buffer.from([0x47]);

function buildConstantPool() {
  // ActionConstantPool: 0x88, UI16 payloadLen, UI16 count, then null-
  // terminated UTF-8 strings.
  const strBytes = Buffer.concat(STR.map(s => Buffer.concat([Buffer.from(s, 'utf8'), Buffer.from([0])])));
  const payload = Buffer.concat([
    (() => { const b = Buffer.alloc(2); b.writeUInt16LE(STR.length, 0); return b; })(),
    strBytes,
  ]);
  const hdr = Buffer.alloc(3);
  hdr[0] = 0x88;
  hdr.writeUInt16LE(payload.length, 1);
  return Buffer.concat([hdr, payload]);
}

// Build the function body bytecode. The body uses 2 free registers:
//   r1 = Selection.getFocus() — the focus path string
//   r2 = eval(r1)             — the resolved TextField object
function buildFunctionBody() {
  // Build the post-bail-out tail FIRST so we know the bytes between each
  // If and the End opcode.
  const setScrollH = Buffer.concat([
    actionPush(pushReg(2), pushCp8(CP.SCROLL_H), pushReg(2), pushCp8(CP.MAX_HS)),
    GET_MEMBER,    // → r2.maxhscroll on stack
    SET_MEMBER,    // r2.scrollH = (top of stack)
  ]);

  // type-check block: if (r2.type != "input") bail to end
  const typeCheck = Buffer.concat([
    actionPush(pushReg(2), pushCp8(CP.TYPE)),
    GET_MEMBER,
    actionPush(pushCp8(CP.INPUT)),
    EQUALS2,
    NOT,
  ]);

  // null-check block for r2: if (r2 == null) bail to end
  const r2NullCheck = Buffer.concat([
    actionPush(pushReg(2), pushNull()),
    EQUALS2,
    NOT,
    NOT,
  ]);

  // null-check block for r1: same shape
  const r1NullCheck = Buffer.concat([
    actionPush(pushReg(1), pushNull()),
    EQUALS2,
    NOT,
    NOT,
  ]);

  // Build the eval() call: r2 = eval(r1)
  const evalCall = Buffer.concat([
    // Push args (path string) THEN argCount, THEN the function-name lookup
    actionPush(pushReg(1), pushInt(1), pushCp8(CP.EVAL)),
    CALL_FUNCTION,
    storeReg(2),
    POP,
  ]);

  // Selection.getFocus() call → r1
  // CallMethod's stack expectation (top → bottom):
  //     method_name, object, argCount, args...
  // so the *push* order must be: args first (none here), then argCount,
  // then the object, then the method name.
  const getFocusCall = Buffer.concat([
    actionPush(pushInt(0)),                  // argCount = 0 (bottom)
    actionPush(pushCp8(CP.SELECTION)),
    GET_VARIABLE,                            // Selection object (middle)
    actionPush(pushCp8(CP.GET_FOCUS)),       // method name (top)
    CALL_METHOD,
    storeReg(1),
    POP,
  ]);

  // Debug trace, every frame: trace("FP_KICK FOCUS=" + r1)
  const traceFocus = Buffer.concat([
    actionPush(pushCp8(CP.TRACE_FOCUS), pushReg(1)),
    ADD2,
    TRACE,
  ]);

  // Debug trace inside the input branch (right before the assignment):
  // trace("FP_KICK INPUT scrollH=" + r2.scrollH + " maxh=" + r2.maxhscroll)
  const traceInput = Buffer.concat([
    actionPush(pushCp8(CP.TRACE_INPUT)),
    actionPush(pushReg(2), pushCp8(CP.SCROLL_H)),
    GET_MEMBER,
    ADD2,
    actionPush(pushCp8(CP.TRACE_MAXH)),
    ADD2,
    actionPush(pushReg(2), pushCp8(CP.MAX_HS)),
    GET_MEMBER,
    ADD2,
    TRACE,
  ]);

  // Now we wire the If branches. The If skips OVER the subsequent block
  // when its boolean argument is true. We want:
  //   - if (r1 == null)    skip [evalCall + r2NullCheck + If2 + typeCheck + If3 + setScrollH]
  //   - if (r2 == null)    skip [typeCheck + If3 + setScrollH]
  //   - if (r2.type != "input") skip [setScrollH]
  //
  // Build from the bottom up so each If offset can use the actual size of
  // its subsequent block.

  // The traceInput debug block sits between if3 and setScrollH, so when
  // the user is typing in an input we see both that we reached the
  // assignment branch and the scrollH/maxhscroll values.
  const inputBranch = Buffer.concat([traceInput, setScrollH]);

  // If3: after typeCheck, skip traceInput + setScrollH
  const if3 = actionIf(inputBranch.length);
  // typeBlockAfterIf3 = typeCheck + if3 + inputBranch
  const typeBlock = Buffer.concat([typeCheck, if3, inputBranch]);

  // If2: after r2NullCheck, skip (typeBlock)
  const if2 = actionIf(typeBlock.length);
  const r2Block = Buffer.concat([r2NullCheck, if2, typeBlock]);

  // If1: after r1NullCheck, skip (evalCall + r2Block)
  const evalAndR2 = Buffer.concat([evalCall, r2Block]);
  const if1 = actionIf(evalAndR2.length);

  const body = Buffer.concat([
    getFocusCall,
    traceFocus,    // every-frame trace BEFORE the null check so we see
                   // "FOCUS=null" too — helps diagnose if focus detection
                   // is the failure mode rather than the assignment.
    r1NullCheck,
    if1,
    evalAndR2,
    END, // function-body terminator
  ]);
  return body;
}

function buildDefineFunction2(funcBody) {
  // DefineFunction2 (0x8E): name (null-term), UI16 numParams, UI8 numRegs,
  // UI16 flags, parameter list, UI16 codeSize, code body.
  // We use:
  //   name = ""
  //   numParams = 0
  //   numRegs = 3 (we use r1 and r2 — r0 is unused, register list is
  //               sized to fit the highest index we reference)
  //   flags = 0 (no auto-preload of this/args/super/_root/_parent/_global)
  const nameTerm = Buffer.from([0x00]);
  const hdr = Buffer.alloc(2 + 1 + 2); // numParams + numRegs + flags
  hdr.writeUInt16LE(0, 0);   // numParams
  hdr[2] = 3;                // numRegisters
  hdr.writeUInt16LE(0, 3);   // flags
  // (no parameter entries because numParams = 0)
  const codeSize = Buffer.alloc(2);
  codeSize.writeUInt16LE(funcBody.length, 0);

  const payload = Buffer.concat([nameTerm, hdr, codeSize]);

  // Now wrap the whole DefineFunction2 in its tag header.
  const tagHdr = Buffer.alloc(3);
  tagHdr[0] = 0x8e;
  tagHdr.writeUInt16LE(payload.length, 1);
  // The function body bytes follow the DefineFunction2 tag in the bytecode
  // stream (the codeSize in the header tells AVM how many bytes belong to
  // the function); they are NOT part of payload itself.
  return Buffer.concat([tagHdr, payload, funcBody]);
}

function buildDoActionBody() {
  const cp = buildConstantPool();
  const funcBody = buildFunctionBody();
  const defFunc = buildDefineFunction2(funcBody);
  const installTrace = Buffer.concat([
    actionPush(pushCp8(CP.TRACE_INSTALL)),
    TRACE,
  ]);
  const assign = Buffer.concat([
    installTrace,   // logs "FP_KICK_INSTALL" on first frame so we can
                    // verify in the JS console that the patched SWF is
                    // the one actually running.
    // Stack: push _root, getVariable → _root object
    actionPush(pushCp8(CP._ROOT)),
    GET_VARIABLE,
    // Push "onEnterFrame" member name
    actionPush(pushCp8(CP.ON_ENTER_FRAME)),
    // Function definition (pushes function reference onto stack)
    defFunc,
    // _root.onEnterFrame = <function>
    SET_MEMBER,
    END,
  ]);
  return Buffer.concat([cp, assign]);
}

function buildDoActionTag(body) {
  // DoAction is tag code 12. We always use the long-form (UI32 length) for
  // safety regardless of size, so the tag length field is wide enough for
  // any future growth.
  const tagCodeAndShort = Buffer.alloc(2);
  tagCodeAndShort.writeUInt16LE((12 << 6) | 0x3f, 0);
  const longLen = Buffer.alloc(4);
  longLen.writeUInt32LE(body.length, 0);
  return Buffer.concat([tagCodeAndShort, longLen, body]);
}

// ── Tag-walker: locate the first ShowFrame at the root timeline ───────────

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

// ── Idempotency check: scan for the marker string ─────────────────────────

function alreadyPatched(body) {
  const needle = Buffer.from('__fpScrollKick__\0', 'latin1');
  return body.indexOf(needle) >= 0;
}

// ── Run ───────────────────────────────────────────────────────────────────

function patch() {
  const { sig, version, body } = readSwf(SWF_PATH);

  if (alreadyPatched(body)) {
    console.log('[textinput-scroll] Marker found — already patched, skipping.');
    return;
  }

  const showFrameOff = findFirstShowFrameOffset(body);
  if (showFrameOff < 0) {
    throw new Error('Could not locate first root ShowFrame');
  }

  const newDoActionBody = buildDoActionBody();
  const newTag = buildDoActionTag(newDoActionBody);

  console.log('[textinput-scroll] First ShowFrame at offset ' + showFrameOff);
  console.log('[textinput-scroll] Injecting DoAction tag: '
    + newTag.length + ' bytes (body=' + newDoActionBody.length + ')');

  // Splice the new tag in just before the ShowFrame.
  const before = body.slice(0, showFrameOff);
  const after  = body.slice(showFrameOff);
  const newBody = Buffer.concat([before, newTag, after]);

  const totalLen = writeSwf(SWF_PATH, sig, version, newBody);
  console.log('[textinput-scroll] Wrote ' + SWF_PATH + ' (' + totalLen + ' bytes)');
}

patch();
