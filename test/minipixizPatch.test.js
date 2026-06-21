'use strict';

// Valide le BYTECODE du saveSlot patché de minipixiz.swf sans navigateur :
// un mini-interpréteur AVM1 (le sous-ensemble d'opcodes émis par
// scripts/patch-minipixiz-client.js) exécute la fonction extraite du SWF
// réel contre une carte factice et vérifie les requêtes produites :
//   - pipe carte 33 champs (avec $time/$pond.$d/$dungeon/$rainbow/$wind/
//     $god/$help) posté avec slotId=0 ;
//   - pipe préférences `$mouse|$sound|$key` posté avec slotId=1 ;
//   - gardes : carte absente → pas de POST carte ; prefs absentes des deux
//     sources → pas de POST prefs ; repli SharedObject pour les prefs.
// Un déséquilibre de pile, un saut faux ou un registre écrasé ferait
// échouer l'exécution ou fausserait les chaînes.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { parseFaerieField } = require('../minipixizFaerie');

const SWF = path.join(__dirname, '..', 'Games', 'miniTroll', 'minipixiz.swf');

function swfBody() {
  const raw = fs.readFileSync(SWF);
  const sig = raw.slice(0, 3).toString('ascii');
  return sig === 'CWS' ? zlib.inflateSync(raw.slice(8)) : Buffer.from(raw.slice(8));
}

// Localise le DefineFunction2 de saveSlot : nom vide, 2 params (r2='n',
// r3='data'), regCount 7, flags 0x0029 — signature unique dans le SWF.
function findSaveSlotBody(body) {
  const sigBytes = Buffer.from([0x00, 0x02, 0x00, 0x07, 0x29, 0x00, 0x02, 0x6E, 0x00, 0x03, 0x64, 0x61, 0x74, 0x61, 0x00]);
  let at = -1;
  let from = 0;
  const hits = [];
  while ((at = body.indexOf(sigBytes, from)) !== -1) {
    if (body[at - 3] === 0x8E) hits.push(at);
    from = at + 1;
  }
  assert.equal(hits.length, 1, 'signature saveSlot unique dans le SWF (trouvées : ' + hits.length + ')');
  const hdrStart = hits[0];
  const codeSize = body.readUInt16LE(hdrStart + sigBytes.length);
  const codeStart = hdrStart + sigBytes.length + 2;
  return body.slice(codeStart, codeStart + codeSize);
}

// lit le pool de constantes du DoAction principal (les pushCp y pointent)
function readConstantPool(body) {
  // le pool est le premier opcode du gros DoAction : cherche 0x88 plausible
  // en scannant les tags SWF
  const nbits = (body[0] >> 3) & 0x1f;
  let p = Math.ceil((5 + nbits * 4) / 8) + 4;
  while (p < body.length) {
    const tc = body.readUInt16LE(p);
    p += 2;
    let type = tc >> 6, len = tc & 0x3f;
    if (len === 0x3f) { len = body.readUInt32LE(p); p += 4; }
    if (type === 12 && body[p] === 0x88) {
      let r = p + 3;
      const count = body.readUInt16LE(r); r += 2;
      const pool = [];
      while (pool.length < count) {
        const end = body.indexOf(0, r);
        pool.push(body.slice(r, end).toString('latin1'));
        r = end + 1;
      }
      return pool;
    }
    p += len;
    if (type === 0) break;
  }
  throw new Error('pool de constantes introuvable');
}

// ── mini-interpréteur AVM1 ──────────────────────────────────────────────────
function as2Str(v) {
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  return String(v);
}
function as2Bool(v) {
  if (typeof v === 'number') return v !== 0 && !Number.isNaN(v);
  if (typeof v === 'string') return v.length > 0;
  return !!v;
}

function runAvm1(code, pool, env) {
  const stack = [];
  const regs = new Array(16).fill(undefined);
  regs[1] = env.thisObj;
  regs[2] = env.n;
  regs[3] = env.dataArg;
  let pc = 0;
  let guard = 0;
  while (pc < code.length) {
    if (guard++ > 200000) throw new Error('boucle infinie');
    const op = code[pc];
    if (op === 0) break;
    let len = 0, payload = pc + 1;
    if (op >= 0x80) { len = code.readUInt16LE(pc + 1); payload = pc + 3; }
    let next = payload + len;
    switch (op) {
      case 0x96: { // push
        let r = payload;
        while (r < payload + len) {
          const t = code[r]; r++;
          if (t === 0) { const e = code.indexOf(0, r); stack.push(code.slice(r, e).toString('latin1')); r = e + 1; }
          else if (t === 4) { stack.push(regs[code[r]]); r += 1; }
          else if (t === 5) { stack.push(code[r] !== 0); r += 1; }
          else if (t === 7) { stack.push(code.readInt32LE(r)); r += 4; }
          else if (t === 8) { stack.push(pool[code[r]]); r += 1; }
          else if (t === 9) { stack.push(pool[code.readUInt16LE(r)]); r += 2; }
          else if (t === 1) { stack.push(code.readFloatLE(r)); r += 4; }
          else if (t === 6) { stack.push(code.readDoubleLE(r)); r += 8; }
          else if (t === 2) stack.push(null);
          else if (t === 3) stack.push(undefined);
          else throw new Error('type de push inconnu ' + t);
        }
        break;
      }
      case 0x87: regs[code[payload + 0]] = stack[stack.length - 1]; break; // storeReg (peek)
      case 0x17: stack.pop(); break;
      case 0x4E: { // GET_MEMBER
        const name = stack.pop();
        const obj = stack.pop();
        stack.push(obj == null ? undefined : obj[as2Str(name)]);
        break;
      }
      case 0x4F: { // SET_MEMBER
        const val = stack.pop();
        const name = stack.pop();
        const obj = stack.pop();
        if (obj != null) obj[as2Str(name)] = val;
        break;
      }
      case 0x1C: { // GET_VARIABLE
        const name = as2Str(stack.pop());
        stack.push(env.globals[name]);
        break;
      }
      case 0x47: { // ADD2
        const b = stack.pop();
        const a = stack.pop();
        if (typeof a === 'string' || typeof b === 'string') stack.push(as2Str(a) + as2Str(b));
        else stack.push(Number(a) + Number(b));
        break;
      }
      case 0x48: { // LESS2 (a < b avec a poussé en premier)
        const b = stack.pop();
        const a = stack.pop();
        stack.push(a < b);
        break;
      }
      case 0x12: stack.push(!as2Bool(stack.pop())); break; // NOT
      case 0x9D: { // IF (saute si vrai)
        const off = code.readInt16LE(payload);
        if (as2Bool(stack.pop())) next = next + off;
        break;
      }
      case 0x99: next = next + code.readInt16LE(payload); break; // JUMP
      case 0x40: { // NEW_OBJECT
        const name = as2Str(stack.pop());
        const argc = Number(stack.pop());
        for (let i = 0; i < argc; i++) stack.pop();
        if (name === 'LoadVars') { const lv = { __lv: true }; env.loadVars.push(lv); stack.push(lv); }
        else stack.push({});
        break;
      }
      case 0x52: { // CALL_METHOD
        const name = as2Str(stack.pop());
        const obj = stack.pop();
        const argc = Number(stack.pop());
        const args = [];
        for (let i = 0; i < argc; i++) args.push(stack.pop());
        if (name === 'join') {
          stack.push(Array.isArray(obj) ? obj.map((x) => (x == null ? '' : as2Str(x))).join(as2Str(args[0]))
            : as2Str(obj));
        } else if (name === 'getLocal') {
          stack.push(env.sharedObject);
        } else if (name === 'flush') {
          env.flushed++;
          stack.push(true);
        } else if (name === 'sendAndLoad') {
          env.posts.push({ url: args[0], game: obj.game, sid: obj.sid, slotId: obj.slotId, data: obj.data, method: args[2] });
          stack.push(true);
        } else {
          throw new Error('méthode non gérée : ' + name);
        }
        break;
      }
      case 0x3D: { // CALL_FUNCTION (fonction globale, ex. escape())
        const name = as2Str(stack.pop());
        const argc = Number(stack.pop());
        const args = [];
        for (let i = 0; i < argc; i++) args.push(stack.pop());
        if (name === 'escape') stack.push(escape(as2Str(args[0])));
        else throw new Error('fonction globale non gérée : ' + name);
        break;
      }
      default:
        throw new Error('opcode non géré 0x' + op.toString(16) + ' à ' + pc);
    }
    pc = next;
  }
  return env;
}

// ── données factices ───────────────────────────────────────────────────────
function mockCard() {
  return {
    $stat: {
      $item: [true, null, true], $eat: [3, 0, 1], $kill: [1, 2, 3, 4, 5],
      $run: 4242, $game: [5, 1, 2, 0, 3], $forestMax: 900, $treeMax: 120, $misNum: 2,
    },
    $diam: 3, $key: 2, $star: 7, $bag: 4,
    $dungeon: { $lvl: 1, $f: false, $day: 6, $loop: 0 },
    $rainbow: { $f: false, $day: 2, $it: 40 },
    $pond: { $q: 2, $d: 1, $fs: null },
    $frog: true,
    // Fées RICHES : tout l'état doit être sérialisé dans le token (sinon le
    // serveur resynthétise par défaut → bugs cheveux/goûts/carac/équipement…).
    $faerie: [
      { $name: 'Lumina', $level: 3, $humor: 3, $exp: 1287, $hunger: 9, $moral: 10, $bagMax: 4, $shot: 0, $life: 18, $mana: 6, $mission: null, $pos: 3,
        $carac: [3, 1, 1, 1, 1, 1], $skin: [2, 111, 222, 333], $next: [0, 0], $inv: [5, null, 12], $spell: [20, 0, 7], $spellCoef: [1, 2], $mood: [8], $behaviour: [0], $taste: [[1, 3], [2, 9]] },
      { $name: 'Pigone', $level: 12, $humor: 1, $exp: 50, $hunger: 4, $moral: 8, $bagMax: 2, $shot: 1, $life: 9, $mana: 4, $mission: 2, $pos: null,
        $carac: [7, 7, 7, 7, 7, 8], $skin: [0, 1, 2, 3], $next: [1, 1], $inv: [], $spell: [20, 0], $spellCoef: [], $mood: [], $behaviour: [], $taste: [[5], [6]] },
    ],
    $vs: 1.2,
    $inv: [5, null, 12], $current: null, $checkpoint: 2,
    $time: { $t: 1770000000000, $d: 9, $s: 3600000 },
    $wind: 0.42,
    $god: [false, null, true],
    $help: [true, null, true],
    // Missions actives (fées parties) + missions du jour (Gromelin). $string
    // avec accents + virgule pour vérifier l'escape/unescape.
    $mis: [
      { $d: 5, $gift: 83, $type: 2, $string: 'a réussi, bravo !' },
      { $d: 2, $gift: null, $type: 1, $string: 'a échoué...' },
    ],
    $mission: [[0, 2, 3, 83, 4567], [1, 0, 5, 71, 1234]],
  };
}
const PREF = { $mouse: false, $sound: [1, 1], $key: [37, 39, 32, 40, 38] };

function makeEnv(over) {
  return Object.assign({
    thisObj: { slots: [mockCard(), PREF] },
    n: 0, dataArg: null,
    globals: { _root: { sid: 'SIDTEST' }, SharedObject: { __so: true } },
    sharedObject: { data: { ']D,mH(': [null, null] }, },
    loadVars: [], posts: [], flushed: 0,
  }, over || {});
}

const body = swfBody();
const pool = readConstantPool(body);
const code = findSaveSlotBody(body);

// Champs du pipe carte HORS fées (index 17 = fées, vérifié séparément par
// round-trip parse car le token riche est volumineux).
const EXPECTED_PARTS = [
  'true,,true', '3,0,1', '1,2,3,4,5', '4242', '5,1,2,0,3', '900', '120', '2',
  '3', '2', '7', '4',
  '1', 'false', 'false', '2', 'true',
  null, /* 17: fées (round-trip) */ '1.2',
  '5,,12', 'null', '2',
  '1770000000000', '9', '3600000', '1', '6', '0', '2', '40', '0.42',
  'false,,true', 'true,,true',
  // 33: $mis ("$d~$gift~$type~escape($string)" par mission, "," final) ;
  // 34: $mission ("dif~type~duree~gift~seed" par mission, "," final).
  '5~83~2~' + escape('a réussi, bravo !') + ',2~null~1~' + escape('a échoué...') + ',',
  '0~2~3~83~4567,1~0~5~71~1234,',
];

test('saveSlot patché : pipe carte 35 champs + pipe prefs, exécutés depuis le SWF réel', () => {
  const env = runAvm1(code, pool, makeEnv());
  assert.equal(env.posts.length, 2, 'deux POSTs (carte + prefs)');
  const cardPost = env.posts[0];
  assert.equal(cardPost.url, '/api/saveFrutiSlot');
  assert.equal(cardPost.method, 'POST');
  assert.equal(cardPost.game, 'minipixiz');
  assert.equal(cardPost.sid, 'SIDTEST');
  assert.equal(cardPost.slotId, '0');
  const parts = cardPost.data.split('|');
  assert.equal(parts.length, 35, '35 champs (33 + $mis + $mission)');
  // tous les champs hors fées identiques
  EXPECTED_PARTS.forEach((exp, i) => { if (exp !== null) assert.equal(parts[i], exp, 'champ ' + i); });
  // champ 17 : le token RICHE reparse exactement vers l'état des fées (le vrai
  // fix — équipement, faim, exp, carac, cheveux, goûts, sorts survivent).
  assert.deepEqual(parseFaerieField(parts[17]), mockCard().$faerie, 'fées riches round-trip');
  const prefPost = env.posts[1];
  assert.equal(prefPost.slotId, '1');
  assert.equal(prefPost.data, 'false|1,1|37,39,32,40,38');
  assert.equal(env.flushed, 1, 'SharedObject.flush appelé');
});

test('saveSlot patché : carte absente → pas de POST carte, prefs envoyées quand même', () => {
  const env = runAvm1(code, pool, makeEnv({ thisObj: { slots: [null, PREF] } }));
  assert.equal(env.posts.length, 1);
  assert.equal(env.posts[0].slotId, '1');
  assert.equal(env.posts[0].data, 'false|1,1|37,39,32,40,38');
});

test('saveSlot patché : prefs absentes de slots[1] → repli sur le SharedObject', () => {
  const env = makeEnv({ thisObj: { slots: [mockCard(), null] } });
  env.sharedObject = { data: { ']D,mH(': [null, { $mouse: true, $sound: [0, 1], $key: [65, 66, 67, 68, 69] }] } };
  runAvm1(code, pool, env);
  assert.equal(env.posts.length, 2);
  assert.equal(env.posts[1].slotId, '1');
  assert.equal(env.posts[1].data, 'true|0,1|65,66,67,68,69');
});

test('saveSlot patché : aucune pref nulle part → un seul POST (carte)', () => {
  const env = makeEnv({ thisObj: { slots: [mockCard(), null] } });
  env.sharedObject = { data: { ']D,mH(': [null] } };
  runAvm1(code, pool, env);
  assert.equal(env.posts.length, 1);
  assert.equal(env.posts[0].slotId, '0');
});

test('le pipe carte produit est accepté par le serveur (round-trip parse)', () => {
  const env = runAvm1(code, pool, makeEnv());
  const parts = env.posts[0].data.split('|');
  assert.equal(parts.length, 35);
  assert.equal(Number(parts[22]), 1770000000000);
  assert.equal(Number(parts[23]), 9);
  assert.equal(parts[31], 'false,,true');
  // les fées reparsent vers leur état riche complet
  const fa = parseFaerieField(parts[17]);
  assert.equal(fa.length, 2);
  assert.equal(fa[0].$name, 'Lumina');
  assert.deepEqual(fa[0].$inv, [5, null, 12]);
  assert.deepEqual(fa[0].$carac, [3, 1, 1, 1, 1, 1]);
  assert.equal(fa[1].$name, 'Pigone');
  assert.equal(fa[1].$pos, null);
  assert.equal(fa[1].$mission, 2, 'index de mission de la fée préservé');
  // $mis (champ 33) : jours restants + cadeau + texte exact (accents, virgule)
  const mis = parts[33].split(',').filter(Boolean).map((t) => t.split('~'));
  assert.equal(mis.length, 2);
  assert.equal(Number(mis[0][0]), 5, '$d (jours restants)');
  assert.equal(Number(mis[0][1]), 83, '$gift');
  assert.equal(Number(mis[0][2]), 2, '$type');
  assert.equal(unescape(mis[0][3]), 'a réussi, bravo !', '$string exact');
  assert.equal(mis[1][1], 'null', '$gift null pour mission ratée');
  // $mission (champ 34) : missions du jour de Gromelin
  const misn = parts[34].split(',').filter(Boolean).map((t) => t.split('~').map(Number));
  assert.deepEqual(misn, [[0, 2, 3, 83, 4567], [1, 0, 5, 71, 1234]]);
});

// ── validation structurelle des autres fonctions patchées ──────────────────
// serviceConnect (0 param, regCount 11) et son onLoad inline (1 param
// 'success') ont perdu leurs balises diag : on vérifie que chaque flux
// d'actions reste bien formé (opcodes connus, sauts en bornes, DF2 inline
// correctement délimités).
function validateActions(code, label) {
  const KNOWN = new Set([0x96, 0x87, 0x17, 0x4E, 0x4F, 0x1C, 0x1D, 0x47, 0x48, 0x49,
    0x12, 0x9D, 0x99, 0x40, 0x42, 0x43, 0x52, 0x3D, 0x44, 0x26, 0x8E, 0x9B, 0x3E, 0x00]);
  let pc = 0;
  let ops = 0;
  while (pc < code.length) {
    const op = code[pc];
    if (op === 0) { pc++; continue; }
    ops++;
    assert.ok(KNOWN.has(op), label + ' : opcode inconnu 0x' + op.toString(16) + ' à ' + pc);
    if (op < 0x80) { pc++; continue; }
    const len = code.readUInt16LE(pc + 1);
    const payload = pc + 3;
    if (op === 0x9D || op === 0x99) {
      const target = payload + len + code.readInt16LE(payload);
      assert.ok(target >= 0 && target <= code.length, label + ' : saut hors bornes à ' + pc + ' → ' + target);
    }
    if (op === 0x8E) { // DefineFunction2 inline : le code suit le header
      // header : name\0, numParams u16, regCount u8, flags u16,
      // params (u8 + name\0)*, codeSize u16
      let r = payload;
      const nameEnd = code.indexOf(0, r); r = nameEnd + 1;
      const numParams = code.readUInt16LE(r); r += 2;
      r += 1 + 2; // regCount + flags
      for (let i = 0; i < numParams; i++) { r += 1; r = code.indexOf(0, r) + 1; }
      const codeSize = code.readUInt16LE(r);
      pc = payload + len + codeSize;
      continue;
    }
    pc = payload + len;
  }
  assert.ok(ops > 3, label + ' : flux non vide');
}

function findFnBody(body, sigBytes, label) {
  let at = -1, from = 0;
  const hits = [];
  while ((at = body.indexOf(sigBytes, from)) !== -1) {
    if (body[at - 3] === 0x8E) hits.push(at);
    from = at + 1;
  }
  assert.equal(hits.length, 1, label + ' : signature unique (trouvées ' + hits.length + ')');
  const codeSize = body.readUInt16LE(hits[0] + sigBytes.length);
  const start = hits[0] + sigBytes.length + 2;
  return body.slice(start, start + codeSize);
}

test('serviceConnect patché : flux d\'actions bien formé (diag retirés)', () => {
  // name '' | 0 params | regCount 11 | flags 0x29 — signature partagée par
  // des fonctions natives : on isole NOTRE serviceConnect par son onLoad
  // inline (seul DF2 du SWF avec un paramètre nommé `success`).
  const sig = Buffer.from([0x00, 0x00, 0x00, 0x0B, 0x29, 0x00]);
  const onLoadMark = Buffer.from('\x02success\x00', 'latin1');
  let at = -1, from = 0;
  const hits = [];
  while ((at = body.indexOf(sig, from)) !== -1) {
    if (body[at - 3] === 0x8E) {
      const codeSize = body.readUInt16LE(at + sig.length);
      const start = at + sig.length + 2;
      const fnBody = body.slice(start, start + codeSize);
      if (fnBody.indexOf(onLoadMark) !== -1) hits.push(fnBody);
    }
    from = at + 1;
  }
  assert.equal(hits.length, 1, 'un seul serviceConnect avec onLoad(success) (trouvés ' + hits.length + ')');
  const sc = hits[0];
  validateActions(sc, 'serviceConnect');
  const text = sc.toString('latin1');
  assert.ok(!text.includes('SC_RAN') && !text.includes('MARSHAL'), 'balises diag absentes');
});

test('onLoad patché : flux bien formé, balises diag absentes', () => {
  const sig = Buffer.concat([
    Buffer.from([0x00, 0x01, 0x00, 0x0B, 0x29, 0x00, 0x02]),
    Buffer.from('success\0', 'latin1'),
  ]);
  const ol = findFnBody(body, sig, 'onLoad');
  validateActions(ol, 'onLoad');
  const text = ol.toString('latin1');
  assert.ok(!text.includes('ONLOAD|s=') && !text.includes('FAERIE|t='), 'balises diag absentes');
});
