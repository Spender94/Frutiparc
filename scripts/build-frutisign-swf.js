#!/usr/bin/env node
// Build frutiSign.swf — a 10-frame MovieClip loaded by main.swf's de.Url widget.
//
// main.swf sets `this.sign = N` (1–10) on the loaded clip AFTER loading.
// The SWF has an onEnterFrame script that watches for `sign` being set,
// then calls gotoAndStop(sign) to show the matching fruit icon.
//
// Each frame shows a colored circle representing one of the 10 frutisignes:
//   1=pomme 2=abricot 3=poire 4=fraise 5=citron 6=kiwi 7=raisin 8=orange 9=cerise 10=banane

'use strict';

const fs = require('fs');
const path = require('path');

// ── Fruit sign colors (RGB) ───────────────────────
const FRUITS = [
  { name: 'pomme',   color: [0x4C, 0xAF, 0x50] }, // green apple
  { name: 'abricot', color: [0xFF, 0xA0, 0x40] }, // apricot orange
  { name: 'poire',   color: [0xCD, 0xDC, 0x39] }, // yellow-green pear
  { name: 'fraise',  color: [0xE5, 0x39, 0x35] }, // red strawberry
  { name: 'citron',  color: [0xFF, 0xEB, 0x3B] }, // yellow lemon
  { name: 'kiwi',    color: [0x79, 0x55, 0x48] }, // brown kiwi
  { name: 'raisin',  color: [0x7B, 0x1F, 0xA2] }, // purple grape
  { name: 'orange',  color: [0xFF, 0x98, 0x00] }, // orange
  { name: 'cerise',  color: [0xC6, 0x28, 0x28] }, // dark red cherry
  { name: 'banane',  color: [0xFF, 0xE0, 0x82] }, // light yellow banana
];

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

function bitsForSigned(v) {
  if (v === 0) return 1;
  const abs = Math.abs(v);
  let n = 1;
  while ((1 << (n - 1)) <= abs) n++;
  return n;
}

function bitsForUnsigned(v) {
  if (v === 0) return 0;
  let n = 0;
  while ((1 << n) <= v) n++;
  return n;
}

function rect(xmin, xmax, ymin, ymax) {
  const nbits = Math.max(
    bitsForSigned(xmin), bitsForSigned(xmax),
    bitsForSigned(ymin), bitsForSigned(ymax),
    1
  );
  const bw = new BitWriter();
  bw.writeBits(nbits, 5);
  const mask = (1 << nbits) - 1;
  bw.writeBits(xmin & mask, nbits);
  bw.writeBits(xmax & mask, nbits);
  bw.writeBits(ymin & mask, nbits);
  bw.writeBits(ymax & mask, nbits);
  return bw.buffer();
}

function cstr(s) { return Buffer.concat([Buffer.from(s, 'latin1'), Buffer.from([0])]); }

function swfTag(code, body) {
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

// ── Shape: filled circle ───────────────────────────
// Approximate circle with 8 quadratic Bezier curves
function defineCircleShape(charId, r, g, b, radius) {
  // radius in twips
  const R = radius;

  const bw = new BitWriter();

  // FillStyleArray: 1 solid fill
  bw.writeBits(1, 8); // FillStyleCount
  // SolidFill type=0x00
  bw.writeBits(0x00, 8); // fill type
  bw.writeBits(r, 8); bw.writeBits(g, 8); bw.writeBits(b, 8); // RGB

  // LineStyleArray: 0 lines
  bw.writeBits(0, 8);

  // NumFillBits=1, NumLineBits=0
  bw.writeBits(1, 4);
  bw.writeBits(0, 4);

  // Circle approximation: 8 curve segments
  // Control point distance for circle: d = R * (4/3) * tan(pi/16) ≈ R * 0.2652
  // Using 4 quadrants, each with 2 curves
  const K = Math.round(R * 0.41421356); // tan(pi/8) * R for 4-segment
  // Actually for 8 segments:
  // angle per segment = pi/4 = 45 degrees
  // For a unit circle, anchor points at 0, 45, 90, 135, 180, 225, 270, 315
  // k = (4/3) * tan(angle/2) for Bezier approx
  // For 45 deg segments: k = (4/3)*tan(22.5deg) ≈ 0.5522847

  // Actually let's use 4 cubic-approximated curves (but SWF only has quadratic).
  // Simpler: use 8 quadratic Bezier segments (more accurate).
  //
  // For a quadratic Bezier approximation of a circle arc of angle θ:
  // The control point is at distance R / cos(θ/2) from center.
  //
  // With 8 segments (θ = π/4 = 45°):
  // cos(22.5°) ≈ 0.92388
  // control distance ≈ R / 0.92388 ≈ R * 1.08239
  //
  // Anchor points at multiples of 45°:
  // (R,0), (R*cos45, R*sin45), (0,R), (-R*cos45, R*sin45), etc.

  const cos45 = 0.70711;
  const kfactor = 1.0 / Math.cos(Math.PI / 8); // ≈ 1.08239

  // Precompute anchor and control points (in twips, relative to center)
  const anchors = [];
  const controls = [];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    anchors.push([Math.round(R * Math.cos(a)), Math.round(R * Math.sin(a))]);
    const ca = a + Math.PI / 8;
    const cd = R * kfactor;
    controls.push([Math.round(cd * Math.cos(ca)), Math.round(cd * Math.sin(ca))]);
  }

  // StyleChange: move to first anchor, set fill1=1
  bw.writeBits(0, 1); // non-edge
  // flags: stateMoveTo=1, stateFillStyle0=0, stateFillStyle1=1, stateLineStyle=0, stateNewStyles=0
  bw.writeBits(1, 1); // stateNewStyles=0
  bw.writeBits(0, 1); // stateLineStyle=0
  bw.writeBits(1, 1); // stateFillStyle1=1
  bw.writeBits(0, 1); // stateFillStyle0=0
  bw.writeBits(1, 1); // stateMoveTo=1

  // MoveTo: moveBits, dx, dy — move to anchor[0] = (R, 0)
  const moveBits = bitsForSigned(R) + 1; // signed
  bw.writeBits(moveBits, 5);
  bw.writeBits(R & ((1 << moveBits) - 1), moveBits); // X = R
  bw.writeBits(0 & ((1 << moveBits) - 1), moveBits); // Y = 0

  // FillStyle1 = 1
  bw.writeBits(1, 1); // FillStyle1 = 1 (using 1 fill bit)

  // Now emit 8 curved edge records
  for (let i = 0; i < 8; i++) {
    const ctrl = controls[i];
    const nextAnchor = anchors[(i + 1) % 8];
    const prevAnchor = anchors[i];

    // Control delta from previous anchor
    const cdx = ctrl[0] - prevAnchor[0];
    const cdy = ctrl[1] - prevAnchor[1];
    // Anchor delta from control
    const adx = nextAnchor[0] - ctrl[0];
    const ady = nextAnchor[1] - ctrl[1];

    // CurvedEdge record
    bw.writeBits(1, 1); // edge
    bw.writeBits(0, 1); // curved (not straight)

    const nb = Math.max(
      bitsForSigned(cdx), bitsForSigned(cdy),
      bitsForSigned(adx), bitsForSigned(ady),
      2
    );
    bw.writeBits(nb - 2, 4); // numBits - 2

    const mask2 = (1 << nb) - 1;
    bw.writeBits(cdx & mask2, nb);
    bw.writeBits(cdy & mask2, nb);
    bw.writeBits(adx & mask2, nb);
    bw.writeBits(ady & mask2, nb);
  }

  // EndShape
  bw.writeBits(0, 1); // non-edge
  bw.writeBits(0, 5); // all flags 0 = end

  const shapeData = bw.buffer();

  // Bounds rect: (-R, R, -R, R)
  const bounds = rect(-R, R, -R, R);

  const charIdBuf = Buffer.alloc(2);
  charIdBuf.writeUInt16LE(charId, 0);

  return swfTag(2, Buffer.concat([charIdBuf, bounds, shapeData])); // Tag 2 = DefineShape
}

// ── AVM1 Actions ───────────────────────────────────
function actionStop() { return Buffer.from([0x07]); } // ActionStop
function actionGotoFrame2() {
  // ActionGotoFrame2: opcode 0x9F, length 1, flags=0 (stop)
  return Buffer.from([0x9F, 0x01, 0x00, 0x00]);
}
function actionPushInt(v) {
  // opcode(1) + payloadLen(2) + type(1) + int32(4) = 8 bytes
  const buf = Buffer.alloc(8);
  buf[0] = 0x96;
  buf.writeUInt16LE(5, 1);
  buf[3] = 7;
  buf.writeInt32LE(v, 4);
  return buf;
}
function actionPushStr(s) {
  const strBuf = Buffer.from(s + '\0', 'ascii');
  const buf = Buffer.alloc(3 + 1 + strBuf.length);
  buf[0] = 0x96; // Push
  buf.writeUInt16LE(1 + strBuf.length, 1);
  buf[3] = 0; // type = string
  strBuf.copy(buf, 4);
  return buf;
}
function actionGetVariable() { return Buffer.from([0x1C]); }
function actionGetMember() { return Buffer.from([0x4E]); }
function actionNot() { return Buffer.from([0x12]); }
function actionIf(offset) {
  const buf = Buffer.alloc(5);
  buf[0] = 0x9D;
  buf.writeUInt16LE(2, 1);
  buf.writeInt16LE(offset, 3);
  return buf;
}
function actionSubtract() { return Buffer.from([0x0B]); }
function actionEnd() { return Buffer.from([0x00]); }

// Build the onEnterFrame script:
// if (this.sign != undefined) {
//   gotoAndStop(this.sign);
//   delete this.onEnterFrame;
// }
function buildWatcherScript() {
  // Push "this" (use empty string trick or register)
  // Actually in DoAction context, there's no 'this'. Use _root or the current clip path.
  // In a DoAction inside a DefineSprite, we can use '' to refer to current clip.
  //
  // Strategy: Use a frame 1 DoAction that sets onEnterFrame
  //
  // Frame 1 DoAction:
  //   stop();
  //   this.onEnterFrame = function() {
  //     if (this.sign != undefined) {
  //       this.gotoAndStop(this.sign);
  //       delete this.onEnterFrame;
  //     }
  //   };
  //
  // Using DefineFunction and storeRegister approach.
  // Actually for the main timeline of a loaded SWF, 'this' in DoAction refers to the clip.

  // Simple approach: use ActionConstantPool + bytecode
  const CP_SIGN = 0;
  const CP_ONENTERFRAME = 1;
  const CP_GOTOANDSTOP = 2;

  const cpStrings = ['sign', 'onEnterFrame', 'gotoAndStop'];
  const cpPayload = Buffer.concat([
    (() => { const b = Buffer.alloc(2); b.writeUInt16LE(cpStrings.length, 0); return b; })(),
    ...cpStrings.map(s => cstr(s))
  ]);
  const cpAction = Buffer.concat([
    Buffer.from([0x88]),
    (() => { const b = Buffer.alloc(2); b.writeUInt16LE(cpPayload.length, 0); return b; })(),
    cpPayload
  ]);

  // Push CP index helpers
  function pushCp(idx) {
    if (idx < 256) return Buffer.from([0x96, 0x02, 0x00, 0x08, idx]);
    const b = Buffer.alloc(6);
    b[0] = 0x96; b.writeUInt16LE(3, 1); b[3] = 0x09; b.writeUInt16LE(idx, 4);
    return b;
  }
  function pushUndefined() { return Buffer.from([0x96, 0x01, 0x00, 0x03]); }
  function pushReg(r) { return Buffer.from([0x96, 0x02, 0x00, 0x04, r]); }

  // stop()
  const stop = actionStop();

  // Build the function body for onEnterFrame:
  //   Push this.sign  (push "sign", GetVariable won't work... need "this")
  //   Actually in AVM1 function context, 'this' is available as register or via scope
  //
  // Use DefineFunction2 with preloadThis flag

  // Function body:
  //   push r1 (this), push "sign", getMember -> stack: sign_value
  //   push undefined
  //   equals2
  //   not
  //   if false -> skip
  //   push r1, push "sign", getMember  (sign value)
  //   push 1, push r1, push "gotoAndStop", callMethod
  //   push r1, push "onEnterFrame", delete
  //   // end skip:

  const bodyActions = [];

  // r1 = this (preloaded)
  // Check: if (this.sign != undefined)
  bodyActions.push(pushReg(1));         // this
  bodyActions.push(pushCp(CP_SIGN));    // "sign"
  bodyActions.push(Buffer.from([0x4E])); // GetMember -> this.sign
  bodyActions.push(pushUndefined());
  bodyActions.push(Buffer.from([0x49])); // Equals2
  bodyActions.push(actionNot());         // Not -> true if sign is defined

  // Build the "then" block
  const thenBlock = Buffer.concat([
    // this.gotoAndStop(this.sign)
    pushReg(1),                         // this
    pushCp(CP_SIGN),                    // "sign"
    Buffer.from([0x4E]),                // GetMember -> sign value
    actionPushInt(1),                   // 1 arg
    pushReg(1),                         // this (object)
    pushCp(CP_GOTOANDSTOP),            // "gotoAndStop"
    Buffer.from([0x52]),                // CallMethod

    Buffer.from([0x17]),                // Pop (discard return)

    // delete this.onEnterFrame
    pushReg(1),                         // this
    pushCp(CP_ONENTERFRAME),           // "onEnterFrame"
    Buffer.from([0x3A]),                // Delete2... actually Delete (0x3A) pops obj, name
    // Delete pops name then object, returns bool
    Buffer.from([0x17]),                // Pop (discard bool)
  ]);

  // If sign is undefined, skip thenBlock
  bodyActions.push(actionIf(thenBlock.length)); // if true (sign defined), fall through; else skip
  // Wait - actionIf jumps if TRUE. So if NOT equals (sign IS defined), jump over skip.
  // Let me redo the logic:
  // stack has: true if sign != undefined
  // actionIf jumps if true. We want to jump TO the thenBlock code if true.
  // Actually... we want: if sign == undefined, skip thenBlock.
  // After Not + Equals2:
  //   this.sign != undefined -> Equals2 = false -> Not = true
  //   this.sign == undefined -> Equals2 = true  -> Not = false
  // actionIf: jump if top of stack is true (nonzero)
  // If sign is defined -> true -> jump. But we want to EXECUTE thenBlock, not skip.
  // So we should NOT use If to skip; we should use If to skip past thenBlock when sign is UNDEFINED.
  //
  // Correct logic:
  //   this.sign == undefined  -> Equals2 = true
  //   If(true) -> jump past thenBlock (skip)
  //   (fall through to thenBlock when sign is defined)

  // Redo: remove the Not
  const funcBody = Buffer.concat([
    pushReg(1),                         // this
    pushCp(CP_SIGN),                    // "sign"
    Buffer.from([0x4E]),                // GetMember -> this.sign
    pushUndefined(),                    // undefined
    Buffer.from([0x49]),                // Equals2 -> true if sign==undefined
    actionIf(thenBlock.length),         // skip thenBlock if sign is undefined
    thenBlock,
  ]);

  // DefineFunction2 for onEnterFrame
  // opcode 0x8E, payloadLen(UI16), name\0, numParams(UI16), regCount(UI8), flags(UI16),
  // [params...], codeSize(UI16)
  //
  // flags: preloadThis = bit0 of flags = 0x0001...
  // Actually SWF DefineFunction2 flags:
  // UI16 flags:
  //   bit0: preloadParent
  //   bit1: preloadRoot
  //   bit2: suppressSuper
  //   bit3: preloadSuper
  //   bit4: suppressArguments
  //   bit5: preloadArguments
  //   bit6: suppressThis
  //   bit7: preloadThis  (puts 'this' into r1)
  //   bit8: preloadGlobal (SWF7+)
  const flags = 0x0080; // preloadThis -> this in r1

  const funcName = Buffer.from([0]); // anonymous
  const numParams = Buffer.alloc(2); numParams.writeUInt16LE(0, 0);
  const regCount = Buffer.from([2]); // r0 unused, r1 = this
  const flagsBuf = Buffer.alloc(2); flagsBuf.writeUInt16LE(flags, 0);
  const codeSize = Buffer.alloc(2); codeSize.writeUInt16LE(funcBody.length, 0);

  const df2Payload = Buffer.concat([funcName, numParams, regCount, flagsBuf, codeSize]);
  const df2Header = Buffer.alloc(3);
  df2Header[0] = 0x8E;
  df2Header.writeUInt16LE(df2Payload.length, 1);

  // Full frame 1 DoAction:
  // ConstantPool
  // stop
  // Push "", Push "onEnterFrame", Push <function>, SetMember
  // End

  // Actually for 'this' in DoAction (not inside a function), we need to push '' + GetVariable
  // or use the register-based approach. In a sprite's DoAction, 'this' is the sprite.
  // We can use: push "", GetVariable to get the current clip reference.
  // Or just: SetVariable "onEnterFrame" with the function.
  // But SetVariable sets on the _root scope, not the clip scope...
  //
  // In DoAction within a DefineSprite, variables set via SetVariable go to the clip's scope.
  // Actually no - in a DefineSprite's timeline DoAction, SetVariable sets on the clip.
  // So we can do: push <function>, push "onEnterFrame", SetVariable

  const setOnEnterFrame = Buffer.concat([
    actionPushStr('onEnterFrame'),      // variable name
    df2Header, df2Payload, funcBody,    // the function value is on the stack
    Buffer.from([0x1D]),                // SetVariable
  ]);

  const doActionBody = Buffer.concat([
    cpAction,
    stop,
    setOnEnterFrame,
    actionEnd()
  ]);

  return swfTag(12, doActionBody); // Tag 12 = DoAction
}

// ── PlaceObject2 ───────────────────────────────────
function placeObject2(charId, depth, matrix) {
  let flags = 0x02; // hasCharacter
  if (matrix) flags |= 0x04; // hasMatrix
  const parts = [
    Buffer.from([flags]),
    (() => { const b = Buffer.alloc(2); b.writeUInt16LE(depth, 0); return b; })(),
    (() => { const b = Buffer.alloc(2); b.writeUInt16LE(charId, 0); return b; })(),
  ];
  if (matrix) parts.push(matrix);
  return swfTag(26, Buffer.concat(parts));
}

function removeObject2(depth) {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(depth, 0);
  return swfTag(28, buf);
}

// Identity matrix (no transform)
function identityMatrix() {
  const bw = new BitWriter();
  bw.writeBits(0, 1); // hasScale = false
  bw.writeBits(0, 1); // hasRotate = false
  // TranslateNbits, translateX, translateY
  bw.writeBits(0, 5); // 0 bits = no translate
  return bw.buffer();
}

// Translate matrix
function translateMatrix(tx, ty) {
  const bw = new BitWriter();
  bw.writeBits(0, 1); // hasScale = false
  bw.writeBits(0, 1); // hasRotate = false
  const nb = Math.max(bitsForSigned(tx), bitsForSigned(ty), 1);
  bw.writeBits(nb, 5);
  const mask = (1 << nb) - 1;
  bw.writeBits(tx & mask, nb);
  bw.writeBits(ty & mask, nb);
  return bw.buffer();
}

function showFrame() { return swfTag(1, Buffer.alloc(0)); }
function endTag() { return swfTag(0, Buffer.alloc(0)); }
function setBackgroundColor(r, g, b) { return swfTag(9, Buffer.from([r, g, b])); }

// ── Build SWF ──────────────────────────────────────
function buildSwf() {
  const tags = [];
  tags.push(setBackgroundColor(0xff, 0xff, 0xff));

  const RADIUS = 300; // 15px radius in twips (40x40 symbol -> 15px radius centered in 20x20)
  const CENTER_OFFSET = 0; // shapes are centered at origin

  let charId = 1;

  // Define 10 circle shapes (one per fruit)
  const shapeIds = [];
  for (const fruit of FRUITS) {
    const sid = charId++;
    tags.push(defineCircleShape(sid, fruit.color[0], fruit.color[1], fruit.color[2], RADIUS));
    shapeIds.push(sid);
  }

  // Frame 1: place first shape + DoAction with stop() + onEnterFrame watcher
  tags.push(buildWatcherScript());
  tags.push(placeObject2(shapeIds[0], 1));
  tags.push(showFrame());

  // Frames 2-10: remove previous shape, place next shape
  for (let i = 1; i < 10; i++) {
    tags.push(removeObject2(1));
    tags.push(placeObject2(shapeIds[i], 1));
    tags.push(showFrame());
  }

  tags.push(endTag());

  // Movie header
  const stage = rect(-RADIUS, RADIUS, -RADIUS, RADIUS);
  const frameRate = Buffer.alloc(2);
  frameRate.writeUInt16LE(24 * 256, 0); // 24 fps
  const frameCount = Buffer.alloc(2);
  frameCount.writeUInt16LE(10, 0);

  const body = Buffer.concat([stage, frameRate, frameCount, ...tags]);
  const fileLen = 8 + body.length;
  const header = Buffer.alloc(8);
  header.write('FWS', 0, 'ascii');
  header.writeUInt8(7, 3);
  header.writeUInt32LE(fileLen, 4);

  return Buffer.concat([header, body]);
}

const out = buildSwf();
const target = path.resolve(__dirname, '..', 'public', 'swf', 'frutiSign.swf');
fs.writeFileSync(target, out);
console.log(`Wrote ${target} (${out.length} bytes)`);
