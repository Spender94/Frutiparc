#!/usr/bin/env node
/*
 * Un DÉSASSEMBLEUR ActionScript 2 (AVM1) — le pendant de lecture de
 * lib/as2-asm.js, qui n'écrit que.
 *
 * Les rustines du bureau (patch-main-*.js) citent toutes « l'AVM1 disasm » de
 * tel ou tel bloc, mais l'outil qui produisait ces lectures n'avait jamais
 * été posé dans le dépôt. Le voici : il déroule les tags DoAction (12),
 * DoInitAction (59) et les actions des DefineButton2 (34), résout les
 * ConstantPool (les Push montrent la chaîne, pas l'index), déplie les
 * DefineFunction/DefineFunction2 en blocs indentés, et donne à chaque action
 * son décalage ABSOLU dans le corps décompressé — celui-là même que les
 * rustines visent à l'octet près.
 *
 *   node scripts/disasm-as2.js legacy/main.swf            # tout
 *   node scripts/disasm-as2.js legacy/main.swf 0x2aec8    # le tag contenant
 *                                                           ce décalage
 *
 * La sortie est volumineuse : rediriger vers un fichier et fouiller au grep.
 */
'use strict';

const fs = require('fs');
const zlib = require('zlib');

// ── Les mnémoniques de l'AVM1 (la nomenclature de la spécification SWF) ──
const SANS_OPERANDE = {
  0x04: 'NextFrame', 0x05: 'PrevFrame', 0x06: 'Play', 0x07: 'Stop',
  0x08: 'ToggleQuality', 0x09: 'StopSounds', 0x0a: 'Add', 0x0b: 'Subtract',
  0x0c: 'Multiply', 0x0d: 'Divide', 0x0e: 'Equals', 0x0f: 'Less',
  0x10: 'And', 0x11: 'Or', 0x12: 'Not', 0x13: 'StringEquals',
  0x14: 'StringLength', 0x15: 'StringExtract', 0x17: 'Pop', 0x18: 'ToInteger',
  0x1c: 'GetVariable', 0x1d: 'SetVariable', 0x20: 'SetTarget2',
  0x21: 'StringAdd', 0x22: 'GetProperty', 0x23: 'SetProperty',
  0x24: 'CloneSprite', 0x25: 'RemoveSprite', 0x26: 'Trace',
  0x27: 'StartDrag', 0x28: 'EndDrag', 0x29: 'StringLess', 0x2a: 'Throw',
  0x2b: 'CastOp', 0x2c: 'ImplementsOp', 0x30: 'RandomNumber',
  0x31: 'MBStringLength', 0x32: 'CharToAscii', 0x33: 'AsciiToChar',
  0x34: 'GetTime', 0x35: 'MBStringExtract', 0x36: 'MBCharToAscii',
  0x37: 'MBAsciiToChar', 0x3a: 'Delete', 0x3b: 'Delete2',
  0x3c: 'DefineLocal', 0x3d: 'CallFunction', 0x3e: 'Return', 0x3f: 'Modulo',
  0x40: 'NewObject', 0x41: 'DefineLocal2', 0x42: 'InitArray',
  0x43: 'InitObject', 0x44: 'TypeOf', 0x45: 'TargetPath', 0x46: 'Enumerate',
  0x47: 'Add2', 0x48: 'Less2', 0x49: 'Equals2', 0x4a: 'ToNumber',
  0x4b: 'ToString', 0x4c: 'PushDuplicate', 0x4d: 'StackSwap',
  0x4e: 'GetMember', 0x4f: 'SetMember', 0x50: 'Increment', 0x51: 'Decrement',
  0x52: 'CallMethod', 0x53: 'NewMethod', 0x54: 'InstanceOf',
  0x55: 'Enumerate2', 0x60: 'BitAnd', 0x61: 'BitOr', 0x62: 'BitXor',
  0x63: 'BitLShift', 0x64: 'BitRShift', 0x65: 'BitURShift',
  0x66: 'StrictEquals', 0x67: 'Greater', 0x68: 'StringGreater',
  0x69: 'Extends',
};

function lireSwf(chemin) {
  const brut = fs.readFileSync(chemin);
  const sig = brut.slice(0, 3).toString('ascii');
  if (sig !== 'CWS' && sig !== 'FWS') throw new Error('signature inconnue : ' + sig);
  return sig === 'CWS' ? zlib.inflateSync(brut.slice(8)) : Buffer.from(brut.slice(8));
}

// Le RECT d'en-tête est à taille variable : on le saute au bit près.
function apresRect(corps) {
  const nbits = corps[0] >> 3;
  return Math.ceil((5 + nbits * 4) / 8);
}

function* tags(corps) {
  let o = apresRect(corps) + 4;         // + cadence (u16) + nombre d'images (u16)
  while (o + 2 <= corps.length) {
    const cl = corps.readUInt16LE(o);
    const code = cl >> 6;
    let taille = cl & 0x3f;
    let debut = o + 2;
    if (taille === 0x3f) { taille = corps.readUInt32LE(debut); debut += 4; }
    yield { code, debut, taille };
    o = debut + taille;
    if (code === 0) break;
  }
}

// ── Le désassemblage d'un flot d'actions ──
function chaineC(corps, o) {
  let fin = o;
  while (corps[fin] !== 0) fin++;
  return { texte: corps.slice(o, fin).toString('latin1'), fin: fin + 1 };
}

function lisible(s) {
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    .replace(/[\x00-\x1f]/g, (c) => '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0')) + '"';
}

function desassembler(corps, debut, fin, sortie, retrait, pool) {
  let o = debut;
  const marge = '  '.repeat(retrait);
  while (o < fin) {
    const ici = o;
    const op = corps[o++];
    if (op === 0) { sortie.push(marge + hex(ici) + '  End'); continue; }
    if (op < 0x80) {
      sortie.push(marge + hex(ici) + '  ' + (SANS_OPERANDE[op] || ('op_' + op.toString(16))));
      continue;
    }
    const taille = corps.readUInt16LE(o); o += 2;
    const finOp = o + taille;
    switch (op) {
      case 0x88: {                      // ConstantPool
        const n = corps.readUInt16LE(o); let p = o + 2;
        pool.length = 0;
        for (let i = 0; i < n; i++) { const c = chaineC(corps, p); pool.push(c.texte); p = c.fin; }
        sortie.push(marge + hex(ici) + '  ConstantPool (' + n + ' chaînes)');
        break;
      }
      case 0x96: {                      // Push
        const valeurs = [];
        let p = o;
        while (p < finOp) {
          const type = corps[p++];
          if (type === 0) { const c = chaineC(corps, p); valeurs.push(lisible(c.texte)); p = c.fin; }
          else if (type === 1) { valeurs.push(String(corps.readFloatLE(p))); p += 4; }
          else if (type === 2) valeurs.push('null');
          else if (type === 3) valeurs.push('undefined');
          else if (type === 4) { valeurs.push('reg' + corps[p]); p += 1; }
          else if (type === 5) { valeurs.push(corps[p] ? 'true' : 'false'); p += 1; }
          else if (type === 6) {
            // Le « double » de l'AVM1 : les deux moitiés 32 bits inversées.
            const b = Buffer.alloc(8);
            corps.copy(b, 4, p, p + 4); corps.copy(b, 0, p + 4, p + 8);
            valeurs.push(String(b.readDoubleLE(0))); p += 8;
          }
          else if (type === 7) { valeurs.push(String(corps.readInt32LE(p))); p += 4; }
          else if (type === 8) { valeurs.push(lisible(pool[corps[p]] ?? ('cp' + corps[p]))); p += 1; }
          else if (type === 9) { valeurs.push(lisible(pool[corps.readUInt16LE(p)] ?? ('cp' + corps.readUInt16LE(p)))); p += 2; }
          else { valeurs.push('?type' + type); p = finOp; }
        }
        sortie.push(marge + hex(ici) + '  Push ' + valeurs.join(', '));
        break;
      }
      case 0x99: case 0x9d: {           // Jump / If
        const delta = corps.readInt16LE(o);
        sortie.push(marge + hex(ici) + '  ' + (op === 0x99 ? 'Jump' : 'If')
          + ' -> ' + hex(finOp + delta));
        break;
      }
      case 0x9b: {                      // DefineFunction
        const nom = chaineC(corps, o);
        let p = nom.fin;
        const nparams = corps.readUInt16LE(p); p += 2;
        const params = [];
        for (let i = 0; i < nparams; i++) { const c = chaineC(corps, p); params.push(c.texte); p = c.fin; }
        const tailleCorps = corps.readUInt16LE(p); p += 2;
        sortie.push(marge + hex(ici) + '  DefineFunction ' + (nom.texte || '(anonyme)')
          + '(' + params.join(', ') + ') {');
        desassembler(corps, finOp, finOp + tailleCorps, sortie, retrait + 1, pool);
        sortie.push(marge + '}');
        o = finOp + tailleCorps;
        continue;
      }
      case 0x8e: {                      // DefineFunction2
        const nom = chaineC(corps, o);
        let p = nom.fin;
        const nparams = corps.readUInt16LE(p); p += 2;
        const nregs = corps[p]; p += 1;
        const drapeaux = corps.readUInt16LE(p); p += 2;
        const params = [];
        for (let i = 0; i < nparams; i++) {
          const reg = corps[p]; p += 1;
          const c = chaineC(corps, p); p = c.fin;
          params.push((reg ? 'reg' + reg + '=' : '') + c.texte);
        }
        const tailleCorps = corps.readUInt16LE(p); p += 2;
        sortie.push(marge + hex(ici) + '  DefineFunction2 ' + (nom.texte || '(anonyme)')
          + '(' + params.join(', ') + ') regs=' + nregs
          + ' flags=0x' + drapeaux.toString(16) + ' {');
        desassembler(corps, finOp, finOp + tailleCorps, sortie, retrait + 1, pool);
        sortie.push(marge + '}');
        o = finOp + tailleCorps;
        continue;
      }
      case 0x94: {                      // With
        const tailleBloc = corps.readUInt16LE(o);
        sortie.push(marge + hex(ici) + '  With {');
        desassembler(corps, finOp, finOp + tailleBloc, sortie, retrait + 1, pool);
        sortie.push(marge + '}');
        o = finOp + tailleBloc;
        continue;
      }
      case 0x87: sortie.push(marge + hex(ici) + '  StoreRegister reg' + corps[o]); break;
      case 0x8c: sortie.push(marge + hex(ici) + '  GoToLabel ' + lisible(chaineC(corps, o).texte)); break;
      case 0x81: sortie.push(marge + hex(ici) + '  GotoFrame ' + corps.readUInt16LE(o)); break;
      case 0x9f: sortie.push(marge + hex(ici) + '  GotoFrame2 flags=' + corps[o]); break;
      case 0x9a: sortie.push(marge + hex(ici) + '  GetURL2 flags=' + corps[o]); break;
      case 0x83: {
        const url = chaineC(corps, o); const cible = chaineC(corps, url.fin);
        sortie.push(marge + hex(ici) + '  GetURL ' + lisible(url.texte) + ' ' + lisible(cible.texte));
        break;
      }
      default:
        sortie.push(marge + hex(ici) + '  op_0x' + op.toString(16) + ' (' + taille + ' octets)');
    }
    o = finOp;
  }
}

const hex = (n) => '0x' + n.toString(16).padStart(5, '0');

// ── Les tags porteurs de code ──
function principal() {
  const chemin = process.argv[2];
  if (!chemin) { console.error('usage : disasm-as2.js <fichier.swf> [décalage]'); process.exit(1); }
  const vise = process.argv[3] !== undefined ? Number(process.argv[3]) : null;
  const corps = lireSwf(chemin);

  for (const t of tags(corps)) {
    if (t.code !== 12 && t.code !== 59 && t.code !== 34) continue;
    if (vise !== null && !(vise >= t.debut && vise < t.debut + t.taille)) continue;
    const sortie = [];
    const pool = [];
    if (t.code === 59) {
      const sprite = corps.readUInt16LE(t.debut);
      sortie.push('═══ DoInitAction sprite#' + sprite + '  [' + hex(t.debut) + '..' + hex(t.debut + t.taille) + '] ═══');
      desassembler(corps, t.debut + 2, t.debut + t.taille, sortie, 0, pool);
    } else if (t.code === 12) {
      sortie.push('═══ DoAction  [' + hex(t.debut) + '..' + hex(t.debut + t.taille) + '] ═══');
      desassembler(corps, t.debut, t.debut + t.taille, sortie, 0, pool);
    } else {
      // DefineButton2 : l'en-tête pointe les actions par ActionOffset.
      const bouton = corps.readUInt16LE(t.debut);
      let p = t.debut + 3;
      const premierOffset = corps.readUInt16LE(p);
      if (!premierOffset) continue;     // bouton sans actions
      sortie.push('═══ DefineButton2 #' + bouton + '  [' + hex(t.debut) + '] ═══');
      let bloc = t.debut + 3 + premierOffset;
      while (bloc && bloc < t.debut + t.taille) {
        const condSuivant = corps.readUInt16LE(bloc);
        const cond = corps.readUInt16LE(bloc + 2);
        sortie.push('— conditions 0x' + cond.toString(16) + ' —');
        desassembler(corps, bloc + 4, condSuivant ? bloc + condSuivant : t.debut + t.taille, sortie, 1, pool);
        bloc = condSuivant ? bloc + condSuivant : 0;
      }
    }
    console.log(sortie.join('\n') + '\n');
  }
}

principal();
