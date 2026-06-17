// mb2gen.js — JavaScript port of the OCaml MotionBall 2 map generator
// Ported from: dungeon.ml, level.ml, assemble.ml, bitCodec.ml

const fs = require('fs');
const path = require('path');

// ============================================================================
// BitCodec — custom base64 bit-level encoder/decoder
// ============================================================================

const B64_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-';
const B64_LOOKUP = {};
for (let i = 0; i < B64_ALPHABET.length; i++) {
  B64_LOOKUP[B64_ALPHABET[i]] = i;
}

function createBitWriter() {
  const bits = [];
  return {
    write(nbits, value) {
      for (let i = nbits - 1; i >= 0; i--) {
        bits.push((value >> i) & 1);
      }
    },
    flush() {
      // pad to multiple of 6
      while (bits.length % 6 !== 0) {
        bits.push(0);
      }
    },
    toString() {
      let s = '';
      for (let i = 0; i < bits.length; i += 6) {
        let val = 0;
        for (let j = 0; j < 6; j++) {
          val = (val << 1) | (bits[i + j] || 0);
        }
        s += B64_ALPHABET[val];
      }
      return s;
    }
  };
}

function createBitReader(data) {
  const bits = [];
  for (let i = 0; i < data.length; i++) {
    const val = B64_LOOKUP[data[i]];
    if (val === undefined) continue;
    for (let j = 5; j >= 0; j--) {
      bits.push((val >> j) & 1);
    }
  }
  let pos = 0;
  return {
    read(nbits) {
      let val = 0;
      for (let i = 0; i < nbits; i++) {
        val = (val << 1) | (bits[pos++] || 0);
      }
      return val;
    }
  };
}

// ============================================================================
// Random — seeded PRNG (Mersenne Twister-like, matching OCaml Random)
// ============================================================================
// We use a simple LCG-based approach. OCaml's Random module uses a specific
// algorithm but for generation purposes we just need a decent seeded PRNG.

class Random {
  constructor() {
    this.state = new Int32Array(55);
    this.idx = 0;
  }

  init(seed) {
    // OCaml Random.init algorithm
    const st = this.state;
    st[0] = seed & 0x3FFFFFFF;
    for (let i = 1; i < 55; i++) {
      st[i] = ((st[i - 1] * 16807) + 1) & 0x3FFFFFFF;
    }
    this.idx = 0;
    // warm up
    for (let i = 0; i < 165; i++) {
      this._next();
    }
  }

  selfInit() {
    this.init((Math.random() * 0x3FFFFFFF) | 0);
  }

  _next() {
    const st = this.state;
    const i = this.idx;
    const j = (i + 24) % 55;
    const newVal = (st[i] + st[j]) & 0x3FFFFFFF;
    st[i] = newVal;
    this.idx = (i + 1) % 55;
    return newVal;
  }

  int(bound) {
    if (bound <= 0) return 0;
    // OCaml Random.int for bound <= 2^30
    while (true) {
      const r = this._next();
      const v = r % bound;
      if (r - v + bound - 1 >= 0) {
        return v;
      }
    }
  }

  bool() {
    return this.int(2) === 0;
  }
}

const rng = new Random();

// ============================================================================
// Dungeon types and constants
// ============================================================================

const FIXED_WIDTH = 8;
const FIXED_HEIGHT = 8;

// Objects
const OBJ_GREEN = 0;
const OBJ_BLUE = 1;
const OBJ_METAL = 2;
const OBJ_VIOLET = 3;
const OBJECTS = [OBJ_GREEN, OBJ_BLUE, OBJ_METAL, OBJ_VIOLET];
const OBJECTS_COUNT = OBJECTS.length;

// Bonuses
const BONUS_ORANGE = 0;
const BONUS_REDBALL = 1;
const BONUS_MAP = 2;
const BONUS_RADAR = 3;
const BONUS_KEY = 4;
const BONUS_SMALLTIME = 5;
const BONUS_BIGTIME = 6;
const BONUSES = [BONUS_ORANGE, BONUS_REDBALL, BONUS_MAP, BONUS_RADAR, BONUS_KEY, BONUS_SMALLTIME, BONUS_BIGTIME];

const BONUS_COUNTS = [[1, 1], [1, 1], [1, 1], [1, 1], [0, 99], [0, 99], [0, 2]];
const BONUS_PROBAS = [10, 10, 10, 10, 6, 7, 2];
const BONUS_MIN_COUNT = BONUS_COUNTS.reduce((acc, [min, _]) => acc + min, 0);

// Directions
const DIR_UP = 0;
const DIR_DOWN = 1;
const DIR_LEFT = 2;
const DIR_RIGHT = 3;
const DIRS = [DIR_UP, DIR_DOWN, DIR_LEFT, DIR_RIGHT];

// Path types
const PATH_OPENED = 0;
const PATH_CLOSED = 1;
const PATH_INVISIBLE = 2;
// PATH_DOORNEED stored as { type: 'door', obj: objType }

// Room types
const RTYPE_NONE = null;
const RTYPE_NORMAL = 'Normal';
const RTYPE_START = 'Start';
const RTYPE_END = 'End';
// ObjectFound/ObjectNeeded/BonusFound stored as objects

// Retry sentinel
class RetryError extends Error {
  constructor(msg) { super(msg); this.name = 'RetryError'; }
}
class MoveOutError extends Error {
  constructor() { super('MoveOut'); this.name = 'MoveOutError'; }
}

// ============================================================================
// Utility functions
// ============================================================================

function pos(x, y) { return { x, y }; }
function nullPos() { return { x: -1, y: -1 }; }
function posEq(a, b) { return a.x === b.x && a.y === b.y; }

function canBlockOnlyDoor(obj) {
  if (obj === OBJ_GREEN || obj === OBJ_BLUE) return rng.bool();
  return false;
}

function canHaveInvisibleDoor(bonus) {
  switch (bonus) {
    case BONUS_ORANGE:
    case BONUS_REDBALL:
      return rng.bool();
    case BONUS_MAP:
      return false;
    case BONUS_RADAR:
    case BONUS_KEY:
    case BONUS_SMALLTIME:
      return rng.int(4) === 0;
    case BONUS_BIGTIME:
      return true;
  }
  return false;
}

function isDoorNeed(p) {
  return p !== null && typeof p === 'object' && p.type === 'door';
}

function pathEqual(a, b) {
  if (a === b) return true;
  if (isDoorNeed(a) && isDoorNeed(b)) return a.obj === b.obj;
  return false;
}

function makeArray2D(w, h, val) {
  return Array.from({ length: w }, () => Array.from({ length: h }, () =>
    typeof val === 'function' ? val() : val
  ));
}

function ashuffle(a) {
  const len = a.length;
  for (let i = 0; i < len; i++) {
    const p = rng.int(len - i) + i;
    const tmp = a[p];
    a[p] = a[i];
    a[i] = tmp;
  }
}

function shuffle(a) {
  const copy = [...a];
  ashuffle(copy);
  return copy;
}

function scan(a, f) {
  for (let x = 0; x < a.length; x++) {
    for (let y = 0; y < a[x].length; y++) {
      f(pos(x, y), a[x][y]);
    }
  }
}

function calcBits(n) {
  let v = n - 1;
  let bits = 0;
  while (v > 0) {
    bits++;
    v = v >>> 1;
  }
  return bits;
}

// ============================================================================
// Dungeon — room and dungeon structures
// ============================================================================

function newRoom(x, y) {
  return {
    rtype: RTYPE_NONE,
    rup: PATH_CLOSED,
    rdown: PATH_CLOSED,
    rleft: PATH_CLOSED,
    rright: PATH_CLOSED,
    rpos: pos(x, y),
  };
}

function newDungeon(width, height) {
  const m = Array.from({ length: width }, (_, i) =>
    Array.from({ length: height }, (_, j) => newRoom(i, j))
  );
  return {
    dmap: m,
    dwidth: width,
    dheight: height,
    dstart: nullPos(),
    dexit: nullPos(),
    dist: 0,
    dist_table: [],
  };
}

function dungeonRoom(d, p) { return d.dmap[p.x][p.y]; }
function dungeonRtype(d, p) { return d.dmap[p.x][p.y].rtype; }

function randPos(d) {
  return pos(rng.int(d.dwidth), rng.int(d.dheight));
}

function dungeonMove(d, p, dir) {
  switch (dir) {
    case DIR_UP:    if (p.y === 0) throw new MoveOutError(); return pos(p.x, p.y - 1);
    case DIR_DOWN:  if (p.y === d.dheight - 1) throw new MoveOutError(); return pos(p.x, p.y + 1);
    case DIR_LEFT:  if (p.x === 0) throw new MoveOutError(); return pos(p.x - 1, p.y);
    case DIR_RIGHT: if (p.x === d.dwidth - 1) throw new MoveOutError(); return pos(p.x + 1, p.y);
  }
}

function dinv(dir) {
  switch (dir) {
    case DIR_UP: return DIR_DOWN;
    case DIR_DOWN: return DIR_UP;
    case DIR_LEFT: return DIR_RIGHT;
    case DIR_RIGHT: return DIR_LEFT;
  }
}

function setPath(d, p, dir, pval) {
  const r = d.dmap[p.x][p.y];
  switch (dir) {
    case DIR_UP: r.rup = pval; break;
    case DIR_LEFT: r.rleft = pval; break;
    case DIR_RIGHT: r.rright = pval; break;
    case DIR_DOWN: r.rdown = pval; break;
  }
}

function getRoomPath(r, dir) {
  switch (dir) {
    case DIR_UP: return r.rup;
    case DIR_LEFT: return r.rleft;
    case DIR_RIGHT: return r.rright;
    case DIR_DOWN: return r.rdown;
  }
}

function getPath(d, p, dir) {
  return getRoomPath(d.dmap[p.x][p.y], dir);
}

// ============================================================================
// Dungeon generation
// ============================================================================

function almostClose(d, p) {
  const dirs = shuffle([DIR_UP, DIR_DOWN, DIR_LEFT, DIR_RIGHT]);
  let b = false;
  for (const dir of dirs) {
    if (b && getPath(d, p, dir) !== PATH_CLOSED) {
      setPath(d, p, dir, PATH_CLOSED);
      setPath(d, dungeonMove(d, p, dir), dinv(dir), PATH_CLOSED);
    } else if (getPath(d, p, dir) !== PATH_CLOSED) {
      b = true;
    }
  }
}

function randomRoom(d, rt) {
  for (let _i = 0; _i < 10000; _i++) {
    const p = randPos(d);
    if (dungeonRtype(d, p) === RTYPE_NONE) {
      d.dmap[p.x][p.y].rtype = rt;
      return p;
    }
  }
  throw new RetryError('randomRoom: no empty room found after 10000 attempts');
}

function genRoom(d, p) {
  const dirs = shuffle([DIR_UP, DIR_DOWN, DIR_LEFT, DIR_RIGHT]);
  let ep = p;
  for (const dir of dirs) {
    try {
      const np = dungeonMove(d, p, dir);
      if (dungeonRtype(d, np) === RTYPE_NONE) {
        d.dmap[np.x][np.y].rtype = RTYPE_NORMAL;
        setPath(d, p, dir, PATH_OPENED);
        setPath(d, np, dinv(dir), PATH_OPENED);
        const nnp = genRoom(d, np);
        if (rng.int(3) === 0) {
          ep = nnp;
          continue;
        } else {
          return nnp;
        }
      }
    } catch (e) {
      if (e instanceof MoveOutError) continue;
      throw e;
    }
  }
  return ep;
}

function genPath(d, s) {
  for (let _i = 0; _i < 10000; _i++) {
    const p = randPos(d);
    if (dungeonRtype(d, p) === RTYPE_NONE) continue;
    const dirs = shuffle([DIR_UP, DIR_DOWN, DIR_LEFT, DIR_RIGHT]);
    let found = false;
    for (const dir of dirs) {
      if (dir === DIR_UP && p.y === 0) continue;
      if (dir === DIR_LEFT && p.x === 0) continue;
      if (dir === DIR_DOWN && p.y === d.dheight - 1) continue;
      if (dir === DIR_RIGHT && p.x === d.dwidth - 1) continue;
      if (pathEqual(getPath(d, p, dir), s)) continue;
      setPath(d, p, dir, s);
      const p2 = dungeonMove(d, p, dir);
      setPath(d, p2, dinv(dir), s);
      found = true;
      break;
    }
    if (found) break;
  }
}

function genPathMap(d, sp) {
  const m = makeArray2D(d.dwidth, d.dheight, -1);
  function loop(p, n) {
    m[p.x][p.y] = n;
    for (const dir of DIRS) {
      if (getPath(d, p, dir) !== PATH_CLOSED) {
        const p2 = dungeonMove(d, p, dir);
        const n2 = m[p2.x][p2.y];
        if (n2 === -1 || n2 > n + 1) loop(p2, n + 1);
      }
    }
  }
  loop(sp, 0);
  return m;
}

function genObjects(d, m) {
  let totDist = 0;
  let objCount = 0;
  let objectsFound = [];
  let objectsRooms = [];
  const mtbl = makeArray2D(d.dwidth, d.dheight, -1);

  // Using an exception-like flow: when we reach dexit, we throw ExitSignal
  class ExitSignal extends Error {}

  function loop(p, acc) {
    mtbl[p.x][p.y] = totDist;
    totDist++;

    if (posEq(p, d.dexit)) throw new ExitSignal();

    const dirs = shuffle([DIR_UP, DIR_DOWN, DIR_LEFT, DIR_RIGHT]);
    let flag = false;

    for (const dir of dirs) {
      if (getPath(d, p, dir) === PATH_CLOSED) continue;
      const p2 = dungeonMove(d, p, dir);
      if (mtbl[p2.x][p2.y] !== -1) continue;

      // gen_door
      if (acc.length > 0 && rng.int(6) === 0) {
        ashuffle(acc);
        objectsRooms.push({ p: { ...p }, dir, objIdx: acc[0] });
        acc = acc.slice(1);
      }

      const n = m[p.x][p.y];
      const n2 = m[p2.x][p2.y];
      if (n2 > n && (!flag || rng.int(4) !== 0)) {
        acc = loop(p2, acc);
        totDist++;
        flag = true;
      } else {
        flag = true;
      }
    }

    // Check dead end: count non-closed paths
    const nways = DIRS.reduce((acc2, dir2) => getPath(d, p, dir2) === PATH_CLOSED ? acc2 : acc2 + 1, 0);
    if (nways === 1 && objCount < OBJECTS_COUNT) {
      objectsFound.push({ p: { ...p }, objIdx: objCount });
      const pl = Array.from({ length: rng.int(3) + 1 }, () => objCount);
      objCount++;
      acc = pl.concat(acc);
    }

    return acc;
  }

  try {
    loop(d.dstart, []);
    throw new RetryError('exit not found');
  } catch (e) {
    if (e instanceof ExitSignal) {
      if (objCount !== OBJECTS_COUNT) throw new RetryError('not enough objects found');
      for (let i = 0; i < OBJECTS_COUNT; i++) {
        if (!objectsRooms.some(r => r.objIdx === i)) throw new RetryError('not enough objects used');
      }
      const otable = Array.from({ length: OBJECTS_COUNT }, (_, i) => i);
      ashuffle(otable);
      for (const { p, dir, objIdx } of objectsRooms) {
        const obj = OBJECTS[otable[objIdx]];
        if (canBlockOnlyDoor(obj)) {
          setPath(d, p, dir, { type: 'door', obj });
          setPath(d, dungeonMove(d, p, dir), dinv(dir), { type: 'door', obj });
        } else {
          d.dmap[p.x][p.y].rtype = { type: 'ObjectNeeded', obj };
        }
      }
      for (const { p, objIdx } of objectsFound) {
        d.dmap[p.x][p.y].rtype = { type: 'ObjectFound', obj: OBJECTS[otable[objIdx]] };
      }
    } else {
      throw e;
    }
  }
}

function distObjectsMin(d, p) {
  const table = d.dist_table[p.x][p.y];
  let bestDist = -1;
  let bestOlist = [];
  for (const [dist, olist] of table) {
    if (bestDist === -1) {
      bestDist = dist;
      bestOlist = olist;
    } else if (bestDist > dist) {
      bestDist = dist;
      bestOlist = olist;
    } else if (olist.length < bestOlist.length) {
      bestDist = dist;
      bestOlist = olist;
    } else if (dist === bestDist && olist.length === bestOlist.length) {
      bestDist = dist;
      bestOlist = olist;
    }
  }
  return [bestDist, bestOlist];
}

function checkDifficulty(d) {
  const m = makeArray2D(d.dwidth, d.dheight, () => []);

  function linclude(l1, l2) {
    let i2 = 0;
    for (let i1 = 0; i1 < l1.length; i1++) {
      while (i2 < l2.length && l2[i2] < l1[i1]) i2++;
      if (i2 >= l2.length || l2[i2] !== l1[i1]) return false;
      i2++;
    }
    return true;
  }

  function addSort(x, list) {
    const result = [];
    let inserted = false;
    for (const item of list) {
      if (item === x) return [...list]; // already in
      if (!inserted && item > x) {
        result.push(x);
        inserted = true;
      }
      result.push(item);
    }
    if (!inserted) result.push(x);
    return result;
  }

  function leq(l1, l2) {
    if (l1.length !== l2.length) return false;
    for (let i = 0; i < l1.length; i++) {
      if (l1[i] !== l2[i]) return false;
    }
    return true;
  }

  function loop(objs, dist, p) {
    const rt = dungeonRtype(d, p);
    if (rt !== null && typeof rt === 'object' && rt.type === 'ObjectFound') {
      objs = addSort(rt.obj, objs);
    }
    m[p.x][p.y].push([dist, objs]);

    function nextRoom(dir) {
      const pathVal = getPath(d, p, dir);
      if (pathVal === PATH_CLOSED) return;
      if (isDoorNeed(pathVal) && !objs.includes(pathVal.obj)) return;

      const p2 = dungeonMove(d, p, dir);
      const entries = m[p2.x][p2.y];
      if (entries.every(([, objs2]) => !linclude(objs, objs2))
        || !entries.some(([dist2, objs2]) => leq(objs, objs2) && dist2 <= dist + 1)) {
        loop(objs, dist + 1, p2);
      }
    }

    if (rt !== null && typeof rt === 'object' && rt.type === 'ObjectNeeded') {
      if (objs.includes(rt.obj)) {
        DIRS.forEach(nextRoom);
      }
      // else: blocked, don't continue
    } else if (rt !== null && typeof rt === 'object' && rt.type === 'BonusFound' && rt.bonus === BONUS_MAP) {
      DIRS.forEach(nextRoom);
    } else {
      DIRS.forEach(nextRoom);
    }
  }

  loop([], 0, d.dstart);
  d.dist_table = m;
  const [dist, objList] = distObjectsMin(d, d.dexit);
  // Original OCaml threshold is 40 % of the room count, but a 40 %-deep
  // shortest path produced a dungeon that "didn't feel like a challenge"
  // (per user feedback). Raise the floor so the start→exit detour is at
  // least 60 % of the grid, matching the difficulty most challenge maps
  // demand.
  const challengeThresholdRooms = Math.ceil(d.dwidth * d.dheight * 60 / 100);
  if (dist < challengeThresholdRooms) throw new RetryError('not enough difficulty');
  if (objList.length !== OBJECTS_COUNT) throw new RetryError('not enough objects for ending level');
  return dist;
}

function genObjectsFinal(d) {
  const impList = [];

  function isImpass(p, exclDir) {
    let tpath = null;
    const rt = dungeonRtype(d, p);
    if (rt !== RTYPE_NORMAL) return 'TooMuch';

    for (const dir of DIRS) {
      if (dir === exclDir) continue;
      if (getPath(d, p, dir) === PATH_CLOSED) continue;
      if (tpath === null) {
        tpath = dir;
      } else {
        return 'TooMuch';
      }
    }
    return tpath === null ? 'NotYet' : { type: 'Path', dir: tpath };
  }

  function impassStart(p, dir) {
    const p2 = dungeonMove(d, p, dir);
    const dir2 = dinv(dir);
    const result = isImpass(p2, dir2);
    if (typeof result === 'object' && result.type === 'Path') {
      return impassStart(p2, result.dir);
    }
    return [p2, dir2];
  }

  function check(p) {
    for (const dir of DIRS) {
      const pathVal = getPath(d, p, dir);
      if (isDoorNeed(pathVal)) {
        const p2 = dungeonMove(d, p, dir);
        if (distObjectsMin(d, p)[0] < distObjectsMin(d, p2)[0]) {
          setPath(d, p2, dinv(dir), PATH_OPENED);
        }
      }
    }
    const result = isImpass(p, undefined);
    if (typeof result === 'object' && result.type === 'Path') {
      impList.push([p, impassStart(p, result.dir)]);
    }
  }

  scan(d.dmap, (p, _) => check(p));
  const imps = [...impList];
  ashuffle(imps);
  if (imps.length < BONUS_MIN_COUNT) throw new RetryError('not enough impass for bonuses');

  const bonusTbl = new Array(imps.length).fill(-1);
  let probaTot = 0;
  let bpos = 0;
  const counts = BONUS_COUNTS.map(([min, max], n) => {
    for (let i = 0; i < min; i++) {
      bonusTbl[bpos] = n;
      if (BONUSES[n] === BONUS_MAP && distObjectsMin(d, imps[bpos][0])[0] > 10) {
        throw new RetryError('map is too far');
      }
      bpos++;
    }
    if (max > min) probaTot += BONUS_PROBAS[n];
    return max - min;
  });

  while (bpos < imps.length) {
    let p = rng.int(probaTot);
    let posIdx = 0;
    while (p > BONUS_PROBAS[posIdx] || counts[posIdx] === 0) {
      while (counts[posIdx] === 0) posIdx++;
      if (p > BONUS_PROBAS[posIdx]) {
        p -= BONUS_PROBAS[posIdx];
        posIdx++;
      }
    }
    bonusTbl[bpos] = posIdx;
    counts[posIdx]--;
    if (counts[posIdx] === 0) probaTot -= BONUS_PROBAS[posIdx];
    bpos++;
  }

  imps.forEach(([p, [sp, dir]], n) => {
    const b = BONUSES[bonusTbl[n]];
    d.dmap[p.x][p.y].rtype = { type: 'BonusFound', bonus: b };
    if (canHaveInvisibleDoor(b)) setPath(d, sp, dir, PATH_INVISIBLE);
  });
}

function genDungeon(w, h) {
  const d = newDungeon(w, h);
  const sp = randomRoom(d, RTYPE_START);
  genRoom(d, sp);
  const ep = randPos(d);
  d.dstart = sp;
  d.dexit = ep;
  d.dmap[ep.x][ep.y].rtype = RTYPE_END;

  for (let i = 0; i <= Math.floor((w * h) / 6); i++) {
    genPath(d, PATH_OPENED);
    genPath(d, PATH_CLOSED);
  }

  almostClose(d, ep);
  const m = genPathMap(d, sp);
  let count = 0;
  scan(m, (p, s) => {
    if (s === -1) {
      d.dmap[p.x][p.y].rtype = RTYPE_NONE;
    } else {
      if (d.dmap[p.x][p.y].rtype === RTYPE_NONE) d.dmap[p.x][p.y].rtype = RTYPE_NORMAL;
      count++;
    }
  });

  if (dungeonRtype(d, ep) !== RTYPE_END || dungeonRtype(d, sp) !== RTYPE_START) {
    throw new RetryError('exit or start erased');
  }
  if (count < w * h * 3 / 4) throw new RetryError('not enough superficy');

  // gen_objects with inner retry
  let genObjSuccess = false;
  for (let counter = 0; counter < 50; counter++) {
    try {
      genObjects(d, m);
      genObjSuccess = true;
      break;
    } catch (e) {
      if (e instanceof RetryError) continue;
      throw e;
    }
  }
  if (!genObjSuccess) throw new RetryError('gen_objects failed after 50 retries');

  const dist = checkDifficulty(d);
  d.dist = dist;
  genObjectsFinal(d);
  return d;
}

function genDungeonRec(w, h) {
  for (let _i = 0; _i < 500; _i++) {
    try {
      return genDungeon(w, h);
    } catch (e) {
      if (e instanceof RetryError) continue;
      throw e;
    }
  }
  throw new Error('genDungeonRec: failed after 500 attempts');
}

function makeEmptyDungeon(w, h) {
  const d = newDungeon(w, h);
  d.dstart = pos(0, 0);
  d.dexit = pos(0, 0);
  d.dist_table = makeArray2D(w, h, () => []);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      d.dmap[x][y].rtype = RTYPE_NORMAL;
    }
  }
  return d;
}

// ============================================================================
// Dungeon encoding
// ============================================================================

function encodeDungeon(b, d) {
  function encodeBonus(bonus) {
    switch (bonus) {
      case BONUS_ORANGE: b.write(3, 0); break;
      case BONUS_REDBALL: b.write(3, 1); break;
      case BONUS_MAP: b.write(3, 2); break;
      case BONUS_RADAR: b.write(3, 3); break;
      case BONUS_KEY: b.write(3, 4); break;
      case BONUS_SMALLTIME: b.write(3, 5); break;
      case BONUS_BIGTIME: b.write(3, 6); break;
    }
  }

  function encodeObject(obj) {
    switch (obj) {
      case OBJ_GREEN: b.write(2, 0); break;
      case OBJ_BLUE: b.write(2, 1); break;
      case OBJ_METAL: b.write(2, 2); break;
      case OBJ_VIOLET: b.write(2, 3); break;
    }
  }

  function encodePath(p) {
    if (p === PATH_OPENED) { b.write(2, 0); }
    else if (p === PATH_CLOSED) { b.write(2, 1); }
    else if (p === PATH_INVISIBLE) { b.write(2, 2); }
    else if (isDoorNeed(p)) { b.write(2, 3); encodeObject(p.obj); }
  }

  function encodeRoom(r) {
    const rt = r.rtype;
    if (rt === RTYPE_NONE) {
      b.write(3, 0);
    } else {
      if (rt === RTYPE_NORMAL || rt === RTYPE_START) {
        b.write(3, 1);
      } else if (rt === RTYPE_END) {
        b.write(3, 2);
      } else if (typeof rt === 'object') {
        if (rt.type === 'ObjectFound') {
          b.write(3, 3);
          encodeObject(rt.obj);
        } else if (rt.type === 'BonusFound') {
          b.write(3, 4);
          encodeBonus(rt.bonus);
        } else if (rt.type === 'ObjectNeeded') {
          b.write(3, 5);
          encodeObject(rt.obj);
        }
      }
      encodePath(r.rleft);
      encodePath(r.rright);
      encodePath(r.rup);
      encodePath(r.rdown);
    }
  }

  b.write(7, d.dwidth);
  b.write(7, d.dheight);
  b.write(7, d.dstart.x);
  b.write(7, d.dstart.y);
  scan(d.dmap, (p, r) => encodeRoom(r));
}

// ============================================================================
// Level — bumper/room generation
// ============================================================================

// Items
const ITEM_BNORMAL = 1;
const ITEM_BTIME = 2;
const ITEM_BDEATH = 3;
const ITEM_BMAGNET = 4;
const ITEM_BSHADOW = 5;
const ITEM_BBLOCK = 6;
const ITEM_BHOLE = 7;
const ITEM_BRED = 8;
const ITEM_BBLUE = 9;
const ITEM_BTELEPORT = 10;
const ITEM_INTERUPT = 11;
const ITEM_IBLOCKRED = 12;
const ITEM_IBLOCKBLUE = 13;
const ITEM_ZAPPER = 14;
const ITEM_CLASSICEXIT = 15;

// Collision types
const COL_NONE = 0;
const COL_BORDER = 1;
const COL_BUMPER = 2;
const COL_REDBLUE = 3;
const COL_BLOCK = 4;
const COL_HOLE = 5;

const DOOR_SIZE = 110;
const PI = 3.14159;
const BLOCK_MASK = 1 << 16;
const HOLE_MASK = 1 << 17;
const BIT_MASK = 0xFFFF;
const NBUMPERS = 7;
const MAX_BUMPER_TIME = 3;

// Level global state
let levelDelta = 0;
let levelCwidth = 0;
let levelCheight = 0;
let levelCborder = 0;
let levelBallRay = 0;
let levelRedCwidth = 0;
let levelRedCheight = 0;
let levelRedCtbl = [];
let levelPosNbits = 0;
let levelBumpersTbl = new Array(NBUMPERS).fill(null);
let levelClassic = false;
let levelClassicEnter = nullPos();
let levelClassicExit = nullPos();
let levelClassicExitTbl = makeArray2D(10, 10, true);

function bumperForObject(obj) {
  switch (obj) {
    case OBJ_GREEN: return ITEM_BBLOCK;
    case OBJ_BLUE: return ITEM_BHOLE;
    case OBJ_METAL: return ITEM_BMAGNET;
    case OBJ_VIOLET: return ITEM_BSHADOW;
  }
}

function collideForObject(obj) {
  switch (obj) {
    case OBJ_GREEN: return COL_BLOCK;
    case OBJ_BLUE: return COL_HOLE;
    default: throw new Error('collideForObject: invalid');
  }
}

function newColTable() {
  const ctbl = makeArray2D(levelCwidth, levelCheight, COL_NONE);
  for (let x = 0; x < levelCborder; x++) {
    for (let y = 0; y < levelCheight; y++) {
      ctbl[x][y] = COL_BORDER;
      ctbl[levelCwidth - x - 1][y] = COL_BORDER;
    }
  }
  for (let y = 0; y < levelCborder; y++) {
    for (let x = 0; x < levelCwidth; x++) {
      ctbl[x][y] = COL_BORDER;
      ctbl[x][levelCheight - y - 1] = COL_BORDER;
    }
  }
  return ctbl;
}

function genPos(ctbl, btbl, txt) {
  for (let n = 0; n < 100; n++) {
    const px = random2(levelCborder, levelCwidth - levelCborder * 2 - btbl.length);
    const py = random2(levelCborder, levelCheight - levelCborder * 2 - btbl[0].length);
    let collision = false;
    outer:
    for (let x = 0; x < btbl.length; x++) {
      for (let y = 0; y < btbl[x].length; y++) {
        if (btbl[x][y] && ctbl[px + x][py + y] !== COL_NONE) {
          collision = true;
          break outer;
        }
      }
    }
    if (!collision) return pos(px, py);
  }
  throw new RetryError(txt);
}

function random2(min, max) {
  if (max <= min) return max;
  return rng.int(max - min + 1) + min;
}

function computeDists(d) {
  const m = makeArray2D(FIXED_WIDTH, FIXED_HEIGHT, -1);
  function loop(p, n) {
    m[p.x][p.y] = n;
    for (const dir of DIRS) {
      const pathVal = getRoomPath(d.dmap[p.x][p.y], dir);
      if (pathVal !== PATH_CLOSED) {
        const p2 = simpleMove(p, dir);
        const n2 = m[p2.x][p2.y];
        if (n2 === -1 || n2 > n + 1) loop(p2, n + 1);
      }
    }
  }
  loop(d.dstart, 0);
  let tot = 0, nroom = 0;
  scan(m, (_, n) => { if (n !== -1) { nroom++; tot += n; } });
  return [m, Math.floor(tot / nroom)];
}

function simpleMove(p, dir) {
  switch (dir) {
    case DIR_UP:    return pos(p.x, p.y - 1);
    case DIR_DOWN:  return pos(p.x, p.y + 1);
    case DIR_LEFT:  return pos(p.x - 1, p.y);
    case DIR_RIGHT: return pos(p.x + 1, p.y);
  }
}

function fillPos(ctbl, btbl, p, v) {
  for (let x = 0; x < btbl.length; x++) {
    for (let y = 0; y < btbl[x].length; y++) {
      if (btbl[x][y]) ctbl[p.x + x][p.y + y] = v;
    }
  }
}

function fillDoors(r, ctbl) {
  let blist = [];
  let spos = pos(-1, -1);

  function fillDoor(rpath, sx, sy, dx, dy, dpx, dpy) {
    if (rpath !== PATH_CLOSED) {
      for (let x = 0; x < dx; x++) {
        for (let y = 0; y < dy; y++) {
          ctbl[x + sx][y + sy] = COL_NONE;
        }
      }
      if (rpath === PATH_OPENED || rpath === PATH_INVISIBLE) {
        spos = pos(sx + dpx, sy + dpy);
      }
    }
  }

  const wallXmax = Math.floor((levelCwidth - levelCborder * 2) / 10) - 1;
  const wallYmax = Math.floor((levelCheight - levelCborder * 2) / 10) - 1;

  function fillBlock(pathVal, sx, sy, ex, ey) {
    if (isDoorNeed(pathVal)) {
      const c = collideForObject(pathVal.obj);
      const bt = bumperForObject(pathVal.obj);
      for (let x = sx; x <= ex; x++) {
        for (let y = sy; y <= ey; y++) {
          const bx = levelCborder + x * 10;
          const by = levelCborder + y * 10;
          blist.push([bt, pos(bx, by)]);
          for (let i = 0; i < 10; i++) {
            for (let j = 0; j < 10; j++) {
              ctbl[bx + i][by + j] = c;
            }
          }
        }
      }
    }
  }

  const cb = levelCborder - 1;
  const doorCsize = Math.floor((DOOR_SIZE + levelDelta - 1) / levelDelta);
  const doorX = Math.floor((levelCwidth - doorCsize) / 2);
  const doorY = Math.floor((levelCheight - doorCsize) / 2);

  fillDoor(r.rleft, 1, doorY, cb, doorCsize, cb - 1, Math.floor(doorCsize / 2));
  fillDoor(r.rright, levelCwidth - levelCborder, doorY, cb, doorCsize, 1 - cb, Math.floor(doorCsize / 2));
  fillDoor(r.rup, doorX, 1, doorCsize, cb, Math.floor(doorCsize / 2), cb - 1);
  fillDoor(r.rdown, doorX, levelCheight - levelCborder, doorCsize, cb, Math.floor(doorCsize / 2), 1 - cb);

  fillBlock(r.rleft, 1, 0, 1, wallYmax);
  fillBlock(r.rright, wallXmax - 1, 0, wallXmax - 1, wallYmax);
  fillBlock(r.rup, 0, 1, wallXmax, 1);
  fillBlock(r.rdown, 0, wallYmax - 1, wallXmax, wallYmax - 1);

  return [spos, blist];
}

function computeRoomTbl(ctbl, spos) {
  const fdelta = levelDelta;
  const demiDelta = fdelta / 2;
  const bray = levelBallRay + demiDelta;
  const cb = Math.floor(levelCborder / 2);
  const m = makeArray2D(levelCwidth, levelCheight, -1);

  for (let y = cb; y <= levelCheight - 1 - cb; y++) {
    for (let x = cb; x <= levelCwidth - 1 - cb; x++) {
      const sx = (x + 0.5) * fdelta;
      const sy = (y + 0.5) * fdelta;
      let acc = 0;
      let blocked = false;
      for (let n = 0; n < 32; n++) {
        const ang = n * 2 * PI / 32;
        const px = Math.floor((sx + Math.cos(ang) * bray) / fdelta);
        const py = Math.floor((sy + Math.sin(ang) * bray) / fdelta);
        const cv = ctbl[px][py];
        if (cv === COL_NONE || cv === COL_REDBLUE) {
          // ok
        } else if (cv === COL_HOLE) {
          acc = acc | HOLE_MASK;
        } else if (cv === COL_BLOCK) {
          acc = acc | BLOCK_MASK;
        } else {
          blocked = true;
          break;
        }
      }
      m[x][y] = blocked ? -1 : acc;
    }
  }

  // Iterative flood fill to avoid stack overflow
  // OCaml recursive version checks (get(nx,ny) & BIT_MASK) === 0 BEFORE recursing
  // and immediately updates m[x][y] so re-entry is prevented.
  // We replicate this by checking the condition at push time AND at pop time.
  {
    const startVal = m[spos.x][spos.y];
    if ((startVal & BIT_MASK) !== 0) {
      // Starting cell is blocked or already visited
      return m;
    }
    const stack = [[spos.x, spos.y, 0]];
    while (stack.length > 0) {
      const [x, y, inAcc] = stack.pop();
      const b = m[x][y];
      if ((b & BIT_MASK) !== 0) continue; // already processed or blocked
      const acc = inAcc | (b & (HOLE_MASK | BLOCK_MASK));
      m[x][y] = (b + 1) | acc;
      // OCaml recurses neighbours in L, R, U, D order (depth-first). A LIFO
      // stack must be PUSHED in reverse (D, U, R, L) so it POPS in L, R, U, D —
      // otherwise the traversal is mirrored, the "first path" that reaches each
      // cell changes, and the accumulated HOLE/BLOCK masks (hence reachability
      // used by check_doors / check_red) come out wrong → unsolvable rooms
      // where the doors never open.
      if ((m[x][y + 1] & BIT_MASK) === 0) stack.push([x, y + 1, acc]);
      if ((m[x][y - 1] & BIT_MASK) === 0) stack.push([x, y - 1, acc]);
      if ((m[x + 1][y] & BIT_MASK) === 0) stack.push([x + 1, y, acc]);
      if ((m[x - 1][y] & BIT_MASK) === 0) stack.push([x - 1, y, acc]);
    }
  }
  return m;
}

function calcMask(obj) {
  // obj is null or an OBJ_* value
  if (obj === null || obj === undefined) return 0xFFFFFF;
  if (obj === OBJ_GREEN) return 0xFFFFFF - BLOCK_MASK;
  if (obj === OBJ_BLUE) return 0xFFFFFF - HOLE_MASK;
  throw new Error('calcMask: invalid obj');
}

function checkRed(p, mtbl, obj) {
  const mask = calcMask(obj);
  for (let x = 0; x < levelRedCwidth; x++) {
    for (let y = 0; y < levelRedCheight; y++) {
      if ((mtbl[p.x + x][p.y + y] & mask) !== 1) throw new RetryError('check red');
    }
  }
}

function putRedblue(mtbl, ctbl, obj) {
  for (let n = 0; n < 100; n++) {
    const p = genPos(ctbl, levelRedCtbl, 'redblue');
    try {
      checkRed(p, mtbl, obj);
      fillPos(ctbl, levelRedCtbl, p, COL_REDBLUE);
      return p;
    } catch (e) {
      if (e instanceof RetryError) continue;
      throw e;
    }
  }
  throw new RetryError('put redblue');
}

function genRedblues(mtbl, ctbl, obj, n, t) {
  const result = [];
  for (let i = 0; i < n; i++) {
    const p = putRedblue(mtbl, ctbl, obj);
    result.push([t, p]);
  }
  return result;
}

function checkDoors(r, mtbl, obj) {
  const mask = calcMask(obj);
  function checkDoor(rpath, sx, sy, dx, dy) {
    if (rpath !== PATH_CLOSED) {
      let m = mask;
      if (isDoorNeed(rpath)) m = m & calcMask(rpath.obj);
      for (let x = 0; x < dx; x++) {
        for (let y = 0; y < dy; y++) {
          if ((mtbl[x + sx][y + sy] & m) !== 1) throw new RetryError('check door');
        }
      }
    }
  }
  const cb = levelCborder - 1;
  const doorCsize = Math.floor((DOOR_SIZE + levelDelta - 1) / levelDelta) - 6;
  const doorXpos = Math.floor((levelCwidth - doorCsize) / 2);
  const doorYpos = Math.floor((levelCheight - doorCsize) / 2);
  checkDoor(r.rleft, cb, doorYpos, 1, doorCsize);
  checkDoor(r.rright, levelCwidth - levelCborder, doorYpos, 1, doorCsize);
  checkDoor(r.rup, doorXpos, cb, doorCsize, 1);
  checkDoor(r.rdown, doorXpos, levelCheight - levelCborder, doorCsize, 1);
}

function fillWall(blist, x, y, ctbl, c, btype) {
  const sx = levelCborder + x * 10;
  const sy = levelCborder + y * 10;
  if (ctbl[sx][sy] === COL_NONE) {
    blist.push([btype, pos(sx, sy)]);
    for (let i = 0; i < 10; i++) {
      for (let j = 0; j < 10; j++) {
        ctbl[i + sx][j + sy] = c;
      }
    }
  }
}

function objectNeeded(dp, obj) {
  const [d, p] = dp;
  return d.dist_table[p.x][p.y].every(([, l]) => l.includes(obj));
}

function genSeparators(r, ctbl, btype, ecart) {
  const xmin = 0;
  const ymin = 0;
  const xmax = Math.floor((levelCwidth - levelCborder * 2) / 10);
  const ymax = Math.floor((levelCheight - levelCborder * 2) / 10);
  const xdoor = Math.floor(xmax / 2) - 1;
  const xdoor2 = Math.floor(xmax / 2) + 1;
  const ydoor = Math.floor(ymax / 2) - 1;
  const ydoor2 = Math.floor(ymax / 2) + 1;
  let blist = [];

  function loop(horiz, n) {
    if (n === 0) return;
    const yp = random2(ymin + 1 + Math.floor(ecart / 2), ymax - 2 - Math.floor((ecart - 1) / 2));
    const xp = random2(xmin + 1 + Math.floor(ecart / 2), xmax - 2 - Math.floor((ecart - 1) / 2));

    if (!horiz && xp >= xdoor && xp <= xdoor2 && (r.rup !== PATH_CLOSED || r.rdown !== PATH_CLOSED)) {
      loop(horiz, n - 1);
      return;
    }
    if (horiz && yp >= ydoor && yp <= ydoor2 && (r.rleft !== PATH_CLOSED || r.rright !== PATH_CLOSED)) {
      loop(horiz, n - 1);
      return;
    }
    if (!horiz && !((xp >= xdoor2 && r.rright !== PATH_CLOSED) || (xp <= xdoor && r.rleft !== PATH_CLOSED))) {
      loop(horiz, n - 1);
      return;
    }
    if (horiz && !((yp >= ydoor2 && r.rdown !== PATH_CLOSED) || (yp <= ydoor && r.rup !== PATH_CLOSED))) {
      loop(horiz, n - 1);
      return;
    }

    if (horiz) {
      for (let x = xmin; x < xmax; x++) {
        if (x < xp - Math.floor(ecart / 2) || x > xp + Math.floor((ecart - 1) / 2)) {
          fillWall(blist, x, yp, ctbl, COL_BORDER, btype);
        }
      }
    } else {
      for (let y = ymin; y < ymax; y++) {
        if (y < yp - Math.floor(ecart / 2) || y > yp + Math.floor((ecart - 1) / 2)) {
          fillWall(blist, xp, y, ctbl, COL_BORDER, btype);
        }
      }
    }
  }

  const horiz = rng.bool();
  loop(horiz, 2);
  if (blist.length > 0) loop(!horiz, 2);
  return blist;
}

function genObjectNeed(ctbl, obj) {
  const blist = [];
  const c = collideForObject(obj);
  const bt = bumperForObject(obj);
  const xmax = Math.floor((levelCwidth - levelCborder * 2) / 10) - 1;
  const ymax = Math.floor((levelCheight - levelCborder * 2) / 10) - 1;
  const xsize = random2(obj === OBJ_BLUE ? 4 : 3, xmax - 2) - 1;
  const ysize = random2(obj === OBJ_BLUE ? 4 : 3, ymax - 2) - 1;
  const xp = random2(1, xmax - 1 - xsize);
  const yp = random2(1, ymax - 1 - ysize);

  for (let i = xp; i <= xp + xsize; i++) {
    fillWall(blist, i, yp, ctbl, c, bt);
    fillWall(blist, i, yp + ysize, ctbl, c, bt);
  }
  for (let j = yp; j <= yp + ysize; j++) {
    fillWall(blist, xp, j, ctbl, c, bt);
    fillWall(blist, xp + xsize, j, ctbl, c, bt);
  }

  const p = pos(
    xp * 10 + (xsize + 1) * 5 + Math.floor(levelRedCwidth / 2),
    yp * 10 + (ysize + 1) * 5 + Math.floor(levelRedCheight / 2)
  );
  fillPos(ctbl, levelRedCtbl, p, COL_REDBLUE);
  return [[ITEM_BRED, p], ...blist];
}

function genExit(ctbl) {
  const px = levelClassicExit.x;
  const py = levelClassicExit.y;
  for (let x = 0; x < levelClassicExitTbl.length; x++) {
    for (let y = 0; y < levelClassicExitTbl[x].length; y++) {
      if (levelClassicExitTbl[x][y] && ctbl[px + x][py + y] !== COL_NONE) {
        throw new Error('cannot put exit');
      }
    }
  }
  const p = pos(px, py);
  fillPos(ctbl, levelClassicExitTbl, p, COL_HOLE);
}

function genNormalRoom(dp, r, lvl, obj) {
  const minBumpers = Math.floor(lvl / 3) + 5;
  const maxBumpers = Math.floor(lvl * 3 / 3) + 7;
  const nbumpers = Math.min(random2(minBumpers, maxBumpers), 30);
  let availableBtime = MAX_BUMPER_TIME;
  let availableMagnet = objectNeeded(dp, OBJ_METAL) && rng.int(2) === 0
    ? Math.min(random2(0, 4), random2(0, 4))
    : Math.min(random2(0, 1), random2(0, 1));
  let availableShadow = objectNeeded(dp, OBJ_VIOLET) && rng.int(3) === 0
    ? Math.min(random2(0, 2), random2(0, 2))
    : 0;

  const ctbl = newColTable();
  let spos, blist;

  if (!levelClassic) {
    const [sp, bl] = fillDoors(r, ctbl);
    spos = lvl === 0 ? pos(Math.floor(levelCwidth / 2), Math.floor(levelCheight / 2)) : sp;
    blist = [...bl];
  } else {
    const p = levelClassicEnter;
    if (random2(0, 5) !== 0) {
      availableMagnet = 0;
      availableShadow = 0;
    }
    spos = pos(p.x + 5, p.y + 5);
    blist = [];
  }

  if (levelClassic) {
    genExit(ctbl);
    blist.push([ITEM_CLASSICEXIT, { ...levelClassicExit }]);
  }

  if (obj !== null && obj !== undefined) {
    blist = blist.concat(genObjectNeed(ctbl, obj));
  }

  if (!levelClassic) {
    blist = blist.concat(genSeparators(r, ctbl, rng.int(3) === 0 ? ITEM_BHOLE : ITEM_BBLOCK, Math.max(5 - Math.floor(lvl / 4), 1)));
  }

  const bumpers = [];
  for (let i = 0; i < nbumpers; i++) {
    if (rng.int(100) < Math.floor(lvl * 100 / 40)) {
      if (availableMagnet > 0) {
        availableMagnet--;
        bumpers.push([ITEM_BMAGNET, levelBumpersTbl[3]]);
      } else if (availableShadow > 0) {
        availableShadow--;
        bumpers.push([ITEM_BSHADOW, levelBumpersTbl[4]]);
      } else if (availableBtime > 0 && rng.int(5) !== 0) {
        availableBtime--;
        bumpers.push([ITEM_BTIME, levelBumpersTbl[1]]);
      } else {
        bumpers.push([ITEM_BDEATH, levelBumpersTbl[2]]);
      }
    } else {
      bumpers.push([ITEM_BNORMAL, levelBumpersTbl[0]]);
    }
  }

  for (const [btype, btbl] of bumpers) {
    let bpos;
    while (true) {
      bpos = genPos(ctbl, btbl, 'bumper');
      if ((btype === ITEM_BMAGNET || btype === ITEM_BDEATH) &&
          (bpos.x < 15 || bpos.y < 15 || bpos.x > levelCwidth - 15 || bpos.y > levelCheight - 15)) {
        continue;
      }
      break;
    }
    fillPos(ctbl, btbl, bpos, COL_BUMPER);
    blist.push([btype, bpos]);
  }

  const minReds = Math.floor(lvl / 3) + 1;
  const maxReds = Math.floor(lvl * 2 / 3) + 1;
  const mtbl = computeRoomTbl(ctbl, spos);

  // OCaml binds `let nblues, nreds = … , …` and evaluates tuple components
  // RIGHT-to-LEFT, so the `nreds` expression is drawn BEFORE the two `nblues`
  // draws. Match that order (drawing nblues first gave both counts the wrong
  // random values and desynced the genRedblues draws that follow).
  let nblues, nreds;
  if (!levelClassic) {
    nreds = Math.min(random2(minReds, maxReds), 10);
    nblues = Math.min(random2(0, 4), random2(0, 4)) - 1;
  } else {
    nreds = Math.min(random2(Math.floor(lvl * 2 / 3), lvl), 10);
    nblues = Math.min(random2(0, 3), random2(0, 3)) - 1;
  }

  for (const [t, p] of blist) {
    if (t === ITEM_BRED) checkRed(p, mtbl, obj);
  }
  checkDoors(r, mtbl, obj);
  blist = blist.concat(genRedblues(mtbl, ctbl, obj, nreds, ITEM_BRED));
  blist = blist.concat(genRedblues(mtbl, ctbl, obj, nblues, ITEM_BBLUE));
  return blist;
}

function genSpecialRoom(r, obj) {
  const ctbl = newColTable();
  let btype, btbl, nbumpers;
  if (obj === OBJ_METAL) {
    btype = ITEM_BMAGNET; btbl = levelBumpersTbl[3]; nbumpers = 20;
  } else if (obj === OBJ_VIOLET) {
    btype = ITEM_BSHADOW; btbl = levelBumpersTbl[4]; nbumpers = 20;
  } else {
    throw new Error('genSpecialRoom: invalid obj');
  }

  const [spos, bl] = fillDoors(r, ctbl);
  let blist = [...bl];
  blist = blist.concat(genSeparators(r, ctbl, ITEM_BHOLE, 3));

  for (let i = 0; i < nbumpers; i++) {
    const p = genPos(ctbl, btbl, 'spe-bumper');
    fillPos(ctbl, btbl, p, COL_BUMPER);
    blist.push([btype, p]);
  }

  const ndeaths = random2(2, 5);
  const deathtbl = levelBumpersTbl[2];
  for (let i = 0; i < ndeaths; i++) {
    const p = genPos(ctbl, deathtbl, 'death');
    fillPos(ctbl, deathtbl, p, COL_BUMPER);
    blist.push([ITEM_BDEATH, p]);
  }

  const nreds = random2(4, 10);
  const mtbl = computeRoomTbl(ctbl, spos);
  for (const [t, p] of blist) {
    if (t === ITEM_BRED) checkRed(p, mtbl, null);
  }
  checkDoors(r, mtbl, null);
  blist = blist.concat(genRedblues(mtbl, ctbl, null, nreds, ITEM_BRED));
  return blist;
}

function genRoomContent(dp, lvl, r) {
  const rt = r.rtype;
  if (rt === RTYPE_NONE) return null;
  if (rt === RTYPE_END) return null;
  if (typeof rt === 'object' && (rt.type === 'ObjectFound' || rt.type === 'BonusFound')) return null;
  if (rt === RTYPE_START || rt === RTYPE_NORMAL) {
    return genNormalRoom(dp, r, lvl, null);
  }
  if (typeof rt === 'object' && rt.type === 'ObjectNeeded') {
    const obj = rt.obj;
    if (obj === OBJ_GREEN || obj === OBJ_BLUE) {
      return genNormalRoom(dp, r, lvl, obj);
    }
    if (obj === OBJ_VIOLET && rng.int(4) !== 0) {
      return genSpecialRoom(r, obj);
    }
    if (obj === OBJ_METAL && rng.int(3) !== 0) {
      return genSpecialRoom(r, obj);
    }
    return genNormalRoom(dp, r, lvl, null);
  }
  return null;
}

function genRoomRec(dp, dist, r, maxCount) {
  for (let count = 0; count < maxCount; count++) {
    try {
      // OCaml gen_room_rec computes `lvl` ONLY for its random2 side-effect (the
      // PRNG draw) and then passes `dist` — not `lvl` — to gen_room. Passing the
      // random `lvl` (≈ dist) here scrambled every level-scaled quantity in
      // challenge rooms (bumper/red counts, separator spacing `5 - lvl/4`,
      // special-bumper odds `lvl*100/40`). Keep the discarded draw for parity,
      // but scale the room by `dist` like the original.
      if (dist !== -1 && dist !== 0) random2(Math.floor(dist * 2 / 3), dist);
      return genRoomContent(dp, dist, r);
    } catch (e) {
      if (e instanceof RetryError) continue;
      throw e;
    }
  }
  throw new Error('Aborted at room generation');
}

function genRoomLvlRec(dp, lvl, r, maxCount) {
  for (let count = 0; count < maxCount; count++) {
    try {
      return genRoomContent(dp, lvl, r);
    } catch (e) {
      if (e instanceof RetryError) continue;
      throw e;
    }
  }
  throw new Error('Aborted at room generation (classic)');
}

function encodeRoomContent(b, r) {
  function encodeItem([t, p]) {
    b.write(4, t);
    b.write(levelPosNbits, p.x);
    b.write(levelPosNbits, p.y);
  }
  if (r === null) {
    b.write(1, 0);
  } else {
    b.write(1, 1);
    for (const item of r) {
      encodeItem(item);
    }
    b.write(4, 0);
  }
}

function loadBumpers() {
  const filePath = path.join(__dirname, 'Games', 'motionBall2', 'mb2gen', 'bumpers.txt');
  const data = fs.readFileSync(filePath, 'utf8').trim();
  const br = createBitReader(data);

  levelDelta = br.read(5);
  levelCwidth = br.read(10);
  levelCheight = br.read(10);
  levelCborder = br.read(5);
  levelRedCwidth = br.read(5);
  levelRedCheight = br.read(5);
  levelBallRay = br.read(8) / 10.0 * 1.3;

  for (let i = 0; i < NBUMPERS; i++) {
    const width = br.read(5);
    const height = br.read(5);
    const coltable = makeArray2D(width, height, false);
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        coltable[x][y] = br.read(1) === 1;
      }
    }
    levelBumpersTbl[i] = coltable;
  }

  levelRedCtbl = makeArray2D(levelRedCwidth, levelRedCheight, true);
  levelPosNbits = calcBits(Math.max(levelCwidth, levelCheight));
}

// ============================================================================
// Level.make — random dungeon mode
// ============================================================================

function levelMake() {
  // levelClassic is module-level state. In the original OCaml each mode ran
  // in its own process, so the `classic` ref never leaked. Here the server
  // is long-lived: if a previous levelMakeClassic() left the flag set (e.g.
  // by throwing mid-generation), levelMake() would silently emit a CLASSIC
  // map — sparse rooms plus classic-only items like ClassicExit. Challenge
  // is never classic, so force it off at entry.
  levelClassic = false;
  const ddata = genDungeonRec(FIXED_WIDTH, FIXED_HEIGHT);
  const [dists, dmoy] = computeDists(ddata);
  const b = createBitWriter();
  encodeDungeon(b, ddata);
  b.flush();

  scan(ddata.dmap, (p, r) => {
    const roomContent = genRoomRec(
      [ddata, pos(p.x, p.y)],
      Math.floor(dists[p.x][p.y] * 10 / dmoy),
      r,
      1000
    );
    encodeRoomContent(b, roomContent);
  });

  return { data: b.toString(), dist: ddata.dist, totalRooms: FIXED_WIDTH * FIXED_HEIGHT };
}

// ============================================================================
// Level.make_classic — classic mode
// ============================================================================

function randomExit() {
  const xmax = Math.floor((levelCwidth - levelCborder * 2) / 10) - 1;
  const ymax = Math.floor((levelCheight - levelCborder * 2) / 10) - 1;
  // Ensure exit doesn't overlap with the spos (enter + 5) region
  // spos = (enter.x + 5, enter.y + 5); exit occupies (ex..ex+9, ey..ey+9)
  // Overlap when ex <= spos.x <= ex+9 AND ey <= spos.y <= ey+9
  const sposX = levelClassicEnter.x + 5;
  const sposY = levelClassicEnter.y + 5;
  for (let attempt = 0; attempt < 200; attempt++) {
    const px = levelCborder + random2(0, xmax) * 10;
    const py = levelCborder + random2(0, ymax) * 10;
    // Check if spos would be inside the exit's 10x10 area
    if (sposX >= px && sposX <= px + 9 && sposY >= py && sposY <= py + 9) continue;
    return pos(px, py);
  }
  // Fallback: just pick any position
  const px = levelCborder + random2(0, xmax) * 10;
  const py = levelCborder + random2(0, ymax) * 10;
  return pos(px, py);
}

function levelMakeClassic(choiceRooms) {
  const nrooms = 100;
  levelClassic = true;
  // try/finally so the module-level `levelClassic` flag is ALWAYS cleared,
  // even if room generation throws — otherwise the next challenge
  // levelMake() would inherit classic=true and emit a broken (classic-style)
  // daily map.
  try {
    levelClassicEnter = pos(Math.floor(levelCwidth / 2) - 3, Math.floor(levelCheight / 2) - 3);
    levelClassicExit = randomExit();

    const ddata = makeEmptyDungeon(nrooms, choiceRooms);
    const b = createBitWriter();
    encodeDungeon(b, ddata);
    b.flush();

    for (let j = 0; j < nrooms; j++) {
      for (let i = 0; i < choiceRooms; i++) {
        const roomContent = genRoomLvlRec(
          [ddata, pos(j, i)],
          Math.floor(j / 2),
          ddata.dmap[j][i],
          1000
        );
        encodeRoomContent(b, roomContent);
      }
      levelClassicEnter = { ...levelClassicExit };
      levelClassicExit = randomExit();
    }

    return b.toString();
  } finally {
    levelClassic = false;
  }
}

// ============================================================================
// Assemble — pre-made room file loading
// ============================================================================

const SINGLE_WAY = { type: 'door', obj: OBJ_GREEN }; // hack matching OCaml

function assembleDecode(data) {
  const br = createBitReader(data);

  function decodePath() {
    const v = br.read(2);
    switch (v) {
      case 0: return PATH_CLOSED;
      case 1: return PATH_OPENED;
      case 2: return PATH_INVISIBLE;
      case 3: return SINGLE_WAY;
      default: throw new Error('Invalid path data');
    }
  }

  function decodeBumpers() {
    const result = [];
    while (true) {
      const bt = br.read(4);
      if (bt === 0) break;
      const itemTypes = {
        1: ITEM_BNORMAL, 2: ITEM_BTIME, 3: ITEM_BDEATH, 4: ITEM_BMAGNET,
        5: ITEM_BSHADOW, 6: ITEM_BBLOCK, 7: ITEM_BHOLE, 8: ITEM_BRED,
        9: ITEM_BBLUE, 10: ITEM_BTELEPORT, 11: ITEM_INTERUPT, 12: ITEM_IBLOCKRED,
        13: ITEM_IBLOCKBLUE, 14: ITEM_ZAPPER, 15: ITEM_CLASSICEXIT
      };
      if (!itemTypes[bt]) throw new Error('Invalid bumper data: ' + bt);
      const x = br.read(levelPosNbits);
      const y = br.read(levelPosNbits);
      result.push([itemTypes[bt], pos(x, y)]);
    }
    return result;
  }

  const rl = decodePath();
  const rr = decodePath();
  const ru = decodePath();
  const rd = decodePath();
  br.read(1); // unused bit

  return {
    rbumpers: decodeBumpers(),
    r_left: rl,
    r_right: rr,
    r_up: ru,
    r_down: rd,
  };
}

function assembleHandle(x, y, line, startPos) {
  const eqIdx = line.indexOf('=');
  let rtype, rdata;
  if (eqIdx === -1) {
    rtype = line;
    rdata = '';
  } else {
    rtype = line.substring(0, eqIdx);
    rdata = line.substring(eqIdx + 1);
  }

  switch (rtype) {
    case 'NONE': return [null, startPos];
    case 'DATA': return [{ tag: 'RData', data: assembleDecode(rdata) }, startPos];
    case 'ITEM': {
      const itemMap = {
        'KEY': { tag: 'RBonusFound', bonus: BONUS_KEY },
        'ORANGE': { tag: 'RBonusFound', bonus: BONUS_ORANGE },
        'BLUE': { tag: 'RObjectFound', obj: OBJ_BLUE },
        'METAL': { tag: 'RObjectFound', obj: OBJ_METAL },
        'VIOLET': { tag: 'RObjectFound', obj: OBJ_VIOLET },
        'GREEN': { tag: 'RObjectFound', obj: OBJ_GREEN },
        'RED': { tag: 'RBonusFound', bonus: BONUS_REDBALL },
        'MAP': { tag: 'RBonusFound', bonus: BONUS_MAP },
        'RADAR': { tag: 'RBonusFound', bonus: BONUS_RADAR },
        'BIGTIME': { tag: 'RBonusFound', bonus: BONUS_BIGTIME },
        'SMALLTIME': { tag: 'RBonusFound', bonus: BONUS_SMALLTIME },
      };
      if (!itemMap[rdata]) throw new Error('Invalid item: ' + rdata);
      return [itemMap[rdata], startPos];
    }
    case 'START':
      return [{ tag: 'RData', data: assembleDecode(rdata) }, pos(x, y)];
    case 'END':
      return [{ tag: 'REnd' }, startPos];
    default:
      throw new Error('Invalid room type: ' + rtype);
  }
}

function assembleConvertRoom(rooms, x, y) {
  function getPath(rx, ry, dir) {
    if (rx < 0 || rx >= FIXED_WIDTH || ry < 0 || ry >= FIXED_HEIGHT) return PATH_CLOSED;
    const r = rooms[rx][ry];
    if (r === null) return PATH_CLOSED;
    if (r.tag === 'RData') {
      let p;
      switch (dir) {
        case DIR_UP: p = r.data.r_up; break;
        case DIR_LEFT: p = r.data.r_left; break;
        case DIR_RIGHT: p = r.data.r_right; break;
        case DIR_DOWN: p = r.data.r_down; break;
      }
      if (p === PATH_CLOSED) return PATH_CLOSED;
      return PATH_OPENED;
    }
    return PATH_CLOSED;
  }

  const r = rooms[x][y];
  if (r === null) {
    return {
      rtype: RTYPE_NONE,
      rup: PATH_CLOSED,
      rdown: PATH_CLOSED,
      rleft: PATH_CLOSED,
      rright: PATH_CLOSED,
      rpos: pos(x, y),
    };
  }

  if (r.tag === 'RData') {
    return {
      rtype: RTYPE_NORMAL,
      rup: r.data.r_up,
      rleft: r.data.r_left,
      rright: r.data.r_right,
      rdown: r.data.r_down,
      rpos: pos(x, y),
    };
  }

  // For ObjectFound, BonusFound, End: determine paths from neighbors
  function convertRoom(rt) {
    return {
      rtype: rt,
      rup: getPath(x, y - 1, DIR_DOWN),
      rdown: getPath(x, y + 1, DIR_UP),
      rleft: getPath(x - 1, y, DIR_RIGHT),
      rright: getPath(x + 1, y, DIR_LEFT),
      rpos: pos(x, y),
    };
  }

  if (r.tag === 'RObjectFound') {
    return convertRoom({ type: 'ObjectFound', obj: r.obj });
  }
  if (r.tag === 'RBonusFound') {
    return convertRoom({ type: 'BonusFound', bonus: r.bonus });
  }
  if (r.tag === 'REnd') {
    return convertRoom(RTYPE_END);
  }

  throw new Error('Unknown room tag: ' + r.tag);
}

function assembleGetExitPos(rooms) {
  for (let x = 0; x < FIXED_WIDTH; x++) {
    for (let y = 0; y < FIXED_HEIGHT; y++) {
      if (rooms[x][y] !== null && rooms[x][y].tag === 'REnd') {
        return pos(x, y);
      }
    }
  }
  throw new Error('No END');
}

function assembleConvertLevel(rooms, x, y) {
  const r = rooms[x][y];
  if (r === null) return null;
  if (r.tag === 'RData') return r.data.rbumpers;
  return null;
}

function assembleMake(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);

  const rooms = makeArray2D(FIXED_WIDTH, FIXED_HEIGHT, null);
  let startPos = pos(-1, -1);
  let x = 0, y = 0;
  let lineIdx = 0;

  while (y < FIXED_HEIGHT) {
    if (lineIdx >= lines.length) throw new Error('Incomplete file: ' + filePath);
    const l = lines[lineIdx++];
    if (l === '' || l[0] === '#') continue;
    const [roomData, newStartPos] = assembleHandle(x, y, l, startPos);
    rooms[x][y] = roomData;
    startPos = newStartPos;
    x++;
    if (x === FIXED_WIDTH) {
      x = 0;
      y++;
    }
  }

  if (startPos.x === -1) throw new Error('No start!');

  const b = createBitWriter();
  const d = {
    dmap: Array.from({ length: FIXED_WIDTH }, (_, x) =>
      Array.from({ length: FIXED_HEIGHT }, (_, y) => assembleConvertRoom(rooms, x, y))
    ),
    dwidth: FIXED_WIDTH,
    dheight: FIXED_HEIGHT,
    dstart: startPos,
    dexit: assembleGetExitPos(rooms),
    dist: 0,
    dist_table: [],
  };

  encodeDungeon(b, d);
  b.flush();

  for (let rx = 0; rx < FIXED_WIDTH; rx++) {
    for (let ry = 0; ry < FIXED_HEIGHT; ry++) {
      encodeRoomContent(b, assembleConvertLevel(rooms, rx, ry));
    }
  }

  const basename = path.basename(filePath);
  return `dseed=${basename}&ddata=${b.toString()}`;
}

// ============================================================================
// Regenerate ONLY the challenge map (mb2data.dat). Used both by the daily
// roll and by the initial boot. Writes atomically via tmp+rename so a player
// loading the file mid-write never sees a torn dseed/ddata pair.
//
// The seed is derived deterministically from the Europe/Paris calendar day, so
// the generated map is identical across server reboots within the same day —
// mb2data.dat is gitignored and regenerated on every fresh container, which is
// why a random seed made the "map of the day" change on each reboot. It only
// rolls over at Paris midnight, in step with the challenge medals (see
// parisDayKey in server.js).
function dailyChallengeSeed(date) {
  const dayKey = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date || new Date()); // "YYYY-MM-DD"
  // FNV-1a 32-bit hash, reduced to the generator's 30-bit seed space.
  let h = 0x811c9dc5;
  for (let i = 0; i < dayKey.length; i++) {
    h = Math.imul(h ^ dayKey.charCodeAt(i), 0x01000193);
  }
  return (h >>> 0) & 0x3FFFFFFF;
}

async function generateMb2ChallengeMap(forceSeed) {
  const outputDir = path.join(__dirname, 'Games', 'motionBall2');
  loadBumpers();
  let lastErr = null;
  // Default: deterministic per-Paris-day seed (stable across reboots / fresh
  // containers — see dailyChallengeSeed). A caller may pass forceSeed to roll a
  // specific/random map instead (used by the admin "regenerate" override so a
  // manual click always yields a different map).
  const baseSeed = (forceSeed !== undefined && forceSeed !== null)
    ? ((Number(forceSeed) >>> 0) & 0x3FFFFFFF)
    : dailyChallengeSeed();
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      // The attempt offset (deterministic) only matters when a seed fails level
      // validation, so a reboot reproduces the same successful map.
      const seed = (baseSeed + attempt * 7919) & 0x3FFFFFFF;
      rng.init(seed);
      loadBumpers();
      const ddata = levelMake();
      const output = `dseed=${seed}&ddata=${ddata.data}\n`;
      const finalPath = path.join(outputDir, 'mb2data.dat');
      const tmpPath = finalPath + '.tmp';
      fs.writeFileSync(tmpPath, output);
      fs.renameSync(tmpPath, finalPath);
      const pct = Math.round(ddata.dist * 100 / ddata.totalRooms);
      return { seed, distPct: pct, log: `mb2data.dat (seed=${seed}, dist=${ddata.dist}/${ddata.totalRooms} rooms = ${pct}%)` };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('mb2data.dat generation failed after 10 attempts');
}

// Main: generateMB2Maps
// ============================================================================

async function generateMB2Maps() {
  const outputDir = path.join(__dirname, 'Games', 'motionBall2');
  const dungeonDir = path.join(outputDir, 'dungeon');
  const log = [];

  // Load bumpers collision tables
  loadBumpers();

  // 1. Generate random dungeon (challenge mode): mb2data.dat
  {
    const r = await generateMb2ChallengeMap();
    log.push(`Generated ${r.log}`);
  }

  // 2. Generate classic mode: mb2classic.dat
  {
    let generated = false;
    for (let attempt = 0; attempt < 10 && !generated; attempt++) {
      try {
        rng.selfInit();
        const classicSeed = rng.int(0x3FFFFFFF);
        rng.init(classicSeed);
        loadBumpers();
        const ddata = levelMakeClassic(5);
        const output = `dseed=${classicSeed}&ddata=${ddata}\n`;
        fs.writeFileSync(path.join(outputDir, 'mb2classic.dat'), output);
        log.push(`Generated mb2classic.dat (classic mode, seed=${classicSeed}, 100 levels x 5 rooms)`);
        generated = true;
      } catch (e) {
        if (attempt === 9) throw e;
      }
    }
  }

  // 3. Generate tutorial: mb2tuto.dat
  {
    const output = assembleMake(path.join(dungeonDir, 'tuto.txt'));
    fs.writeFileSync(path.join(outputDir, 'mb2tuto.dat'), output);
    log.push('Generated mb2tuto.dat (tutorial)');
  }

  // 4. Generate adventure levels: mb2adv1.dat - mb2adv5.dat
  for (let i = 1; i <= 5; i++) {
    const output = assembleMake(path.join(dungeonDir, `adv_${i}.txt`));
    fs.writeFileSync(path.join(outputDir, `mb2adv${i}.dat`), output);
    log.push(`Generated mb2adv${i}.dat (adventure ${i})`);
  }

  // 5. Generate course levels: mb2run1.dat - mb2run7.dat
  for (let i = 1; i <= 7; i++) {
    const output = assembleMake(path.join(dungeonDir, `course_${i}.txt`));
    fs.writeFileSync(path.join(outputDir, `mb2run${i}.dat`), output);
    log.push(`Generated mb2run${i}.dat (course ${i})`);
  }

  return log.join('\n');
}

module.exports = { generateMB2Maps, generateMb2ChallengeMap, dailyChallengeSeed };

// Run directly if executed as a script
if (require.main === module) {
  generateMB2Maps()
    .then(log => console.log(log))
    .catch(err => { console.error(err); process.exit(1); });
}
