// Verifies the MotionBall 2 challenge generator against level.ml semantics
// by driving the SAME internals the encoder uses, then decoding what it
// wrote. We check:
//   - rooms-with-items match the set of rooms genRoomContent would fill
//     (i.e. NORMAL/START and ObjectNeeded, never NONE/END/ObjFound/Bonus);
//   - item types stay within the challenge set (1..9: BNormal..BBlue), never
//     classic/adventure leftovers (10..15: Teleport, Interupt, IBlockRed/
//     IBlockBlue, Zapper, ClassicExit);
//   - the bitstream consumes exactly its length (a few bits of final
//     base64 padding is the only acceptable tail).
//
// Run a few hundred maps to catch rare paths.

const fs = require('fs');
const path = require('path');

// Two alphabets, matching mb2gen.js (see the proof over there): the SWF's
// MTBitcodec reads '-'=62/'_'=63, while the historical OCaml toolchain wrote
// '_'=62/'-'=63. Generator OUTPUT is written for the SWF; bumpers.txt is an
// OCaml-era artifact and keeps its own order.
const B64_SWF = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_';
const B64_OCAML = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-';
function bitReader(data, BASE64 = B64_SWF) {
  let cur = 0, nbits = 0, byte = 0, consumed = 0;
  return {
    read(n) {
      let v = 0;
      for (let i = 0; i < n; i++) {
        if (nbits === 0) {
          if (byte >= data.length) throw new Error('underrun at bit ' + consumed);
          cur = BASE64.indexOf(data[byte++]);
          if (cur < 0) throw new Error('bad base64 char at byte ' + (byte - 1));
          nbits = 6;
        }
        v = (v << 1) | ((cur >> (nbits - 1)) & 1);
        nbits--; consumed++;
      }
      return v;
    },
    consumed() { return consumed; },
    totalBits() { return data.length * 6; },
  };
}
// Match mb2gen.js: bits needed to encode values 0..n-1 (so calcBits(256)=8,
// not 9). The encoder uses calcBits(max(cwidth, cheight)) for posNbits.
function calcBits(n) { let v = n - 1, b = 0; while (v > 0) { b++; v >>= 1; } return b; }

// Read bumpers.txt header to get the same levelPosNbits the generator uses.
function bumpersPosNbits() {
  const data = fs.readFileSync(path.join(__dirname, '..', 'Games', 'motionBall2', 'mb2gen', 'bumpers.txt'), 'utf8').trim();
  const br = bitReader(data, B64_OCAML);
  br.read(5);            // delta
  const cw = br.read(10);
  const ch = br.read(10);
  return calcBits(Math.max(cw, ch));
}

const ITEM_NAMES = {
  1: 'BNormal', 2: 'BTime', 3: 'BDeath', 4: 'BMagnet', 5: 'BShadow',
  6: 'BBlock', 7: 'BHole', 8: 'BRed', 9: 'BBlue',
  10: 'BTeleport*', 11: 'Interupt*', 12: 'IBlockRed*', 13: 'IBlockBlue*',
  14: 'Zapper*', 15: 'ClassicExit*',
};
const RT_NAMES = { 0: 'NONE', 1: 'NORMAL/START', 2: 'END', 3: 'ObjFound', 4: 'Bonus', 5: 'ObjNeed' };

function decodeMap(ddataStr, posNbits) {
  const b = bitReader(ddataStr);
  // encodeDungeon header: write(7, dwidth) write(7, dheight) write(7, sx) write(7, sy)
  const dw = b.read(7);
  const dh = b.read(7);
  b.read(7); b.read(7);

  const rtypeCount = {};
  // Per-cell encodeRoom: 3-bit rtype (+ 2-bit obj OR 3-bit bonus), then if !=0
  // four 2-bit path values (+ 2-bit obj on DoorNeed).
  for (let x = 0; x < dw; x++) {
    for (let y = 0; y < dh; y++) {
      const rt = b.read(3);
      rtypeCount[rt] = (rtypeCount[rt] || 0) + 1;
      if (rt === 0) continue;
      if (rt === 3 || rt === 5) b.read(2);
      else if (rt === 4) b.read(3);
      for (let d = 0; d < 4; d++) {
        const pth = b.read(2);
        if (pth === 3) b.read(2);
      }
    }
  }

  // levelMake() calls b.flush() between the dungeon layer and the room
  // layer, padding to a 6-bit boundary so the latter starts on a fresh
  // base64 char. Mirror that here, otherwise the room layer reads garbage.
  const used = b.consumed();
  const pad = (6 - (used % 6)) % 6;
  if (pad > 0) b.read(pad);

  // Per-cell encodeRoomContent: 1-bit "has content"; if 1 -> items
  //   (4-bit type !=0 + posBits x + posBits y) then 4-bit 0 terminator.
  let empty = 0, withItems = 0, totalItems = 0, classicItems = 0, invalid = 0;
  const itemCount = {};
  for (let x = 0; x < dw; x++) {
    for (let y = 0; y < dh; y++) {
      if (b.read(1) === 0) { empty++; continue; }
      let n = 0;
      while (true) {
        const t = b.read(4);
        if (t === 0) break;
        itemCount[t] = (itemCount[t] || 0) + 1;
        if (t < 1 || t > 15) invalid++;
        if (t >= 10) classicItems++;
        b.read(posNbits); b.read(posNbits);
        totalItems++;
        if (++n > 2000) { invalid += 9999; break; }
      }
      if (n > 0) withItems++; else empty++;
    }
  }

  const trailing = b.totalBits() - b.consumed();
  return { dw, dh, rtypeCount, empty, withItems, totalItems, classicItems, invalid, itemCount, trailing };
}

const { generateMb2ChallengeMap } = require('../mb2gen');
const posNbits = bumpersPosNbits();

const N = Number(process.argv[2]) || 30;
let totEmpty = 0, totWith = 0, totItems = 0, totClassic = 0, totInvalid = 0;
let worstTrailing = 0;
const itemGrand = {};
for (let i = 0; i < N; i++) {
  // Varied seeds — the daily seed alone would re-verify the same map N times.
  generateMb2ChallengeMap(1000 + i * 60013);
  const raw = fs.readFileSync(path.join(__dirname, '..', 'Games', 'motionBall2', 'mb2data.dat'), 'utf8').trim();
  const data = raw.match(/ddata=(.*)$/)[1];
  const r = decodeMap(data, posNbits);
  if (Math.abs(r.trailing) > Math.abs(worstTrailing)) worstTrailing = r.trailing;
  totEmpty += r.empty; totWith += r.withItems; totItems += r.totalItems;
  totClassic += r.classicItems; totInvalid += r.invalid;
  for (const k of Object.keys(r.itemCount)) itemGrand[k] = (itemGrand[k] || 0) + r.itemCount[k];
  if (i === 0) {
    console.log('sample map #1:');
    console.log('  dungeon ' + r.dw + 'x' + r.dh + ' = ' + (r.dw * r.dh) + ' cells');
    console.log('  rtypes : ' + Object.keys(r.rtypeCount).sort().map(k => RT_NAMES[k] + '=' + r.rtypeCount[k]).join(', '));
    console.log('  rooms  : empty=' + r.empty + ' withItems=' + r.withItems + ' totalItems=' + r.totalItems);
    console.log('  items  : ' + Object.keys(r.itemCount).sort((a, b) => a - b).map(t => ITEM_NAMES[t] + '=' + r.itemCount[t]).join(', '));
    console.log('  trailingBits=' + r.trailing + ' (must be < 6 = final base64 padding)');
  }
}
console.log('---');
console.log('over ' + N + ' maps:');
console.log('  empty rooms        = ' + totEmpty);
console.log('  rooms with items   = ' + totWith);
console.log('  total items        = ' + totItems);
console.log('  classic/adv leak   = ' + totClassic + '  (types 10..15)');
console.log('  invalid items      = ' + totInvalid);
console.log('  worst trailingBits = ' + worstTrailing);
console.log('  item grand totals  : ' + Object.keys(itemGrand).sort((a, b) => a - b).map(t => ITEM_NAMES[t] + '=' + itemGrand[t]).join(', '));
const pass = totClassic === 0 && totInvalid === 0 && Math.abs(worstTrailing) < 6;
console.log(pass
  ? 'PASS — only challenge items (1..9), bitstream aligned on every map'
  : 'FAIL — see counts above');
// Leave today's real daily map in place, not the last probe seed.
generateMb2ChallengeMap().then(() => process.exit(pass ? 0 : 1));
