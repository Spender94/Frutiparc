/*
 * WOFF (version 1) → TTF, et lecture des tables `name` et `cmap`.
 *
 * Les polices du site sont des WOFF 1 — pour la plupart sorties des SWF par
 * scripts/extract-swf-font.js. Un logiciel de montage veut un TTF : le WOFF 1
 * n'en est qu'un emballage, chaque table étant compressée (zlib) derrière un
 * en-tête `wOFF`. On décompresse, on recompose l'en-tête sfnt, c'est tout —
 * aucun contour n'est touché.
 *
 * `cmap` (formats 4 et 12) dit quels caractères la police porte VRAIMENT :
 * les polices extraites d'un SWF n'embarquent que les glyphes dont le jeu se
 * servait — souvent pas d'accents, parfois pas de minuscules.
 */
'use strict';

const zlib = require('zlib');

function woffVersTtf(buf) {
  if (buf.readUInt32BE(0) !== 0x774F4646) throw new Error('pas un WOFF 1');
  const flavor = buf.readUInt32BE(4);
  const n = buf.readUInt16BE(12);
  const tables = [];
  for (let i = 0; i < n; i++) {
    const o = 44 + i * 20;
    const tag = buf.toString('latin1', o, o + 4);
    const off = buf.readUInt32BE(o + 4), comp = buf.readUInt32BE(o + 8), orig = buf.readUInt32BE(o + 12);
    const csum = buf.readUInt32BE(o + 16);
    let data = buf.subarray(off, off + comp);
    if (comp !== orig) data = zlib.inflateSync(data);
    tables.push({ tag, data, csum });
  }
  tables.sort((a, b) => (a.tag < b.tag ? -1 : 1));
  let p2 = 1, e = 0; while (p2 * 2 <= n) { p2 *= 2; e++; }
  const entete = Buffer.alloc(12 + 16 * n);
  entete.writeUInt32BE(flavor, 0); entete.writeUInt16BE(n, 4);
  entete.writeUInt16BE(p2 * 16, 6); entete.writeUInt16BE(e, 8); entete.writeUInt16BE(n * 16 - p2 * 16, 10);
  let off = entete.length;
  const morceaux = [entete];
  tables.forEach((t, i) => {
    const o = 12 + i * 16;
    entete.write(t.tag, o, 'latin1');
    entete.writeUInt32BE(t.csum, o + 4); entete.writeUInt32BE(off, o + 8); entete.writeUInt32BE(t.data.length, o + 12);
    const pad = (4 - (t.data.length % 4)) % 4;
    morceaux.push(t.data, Buffer.alloc(pad));
    off += t.data.length + pad;
  });
  return Buffer.concat(morceaux);
}

function tablesTtf(ttf) {
  const n = ttf.readUInt16BE(4), t = {};
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16;
    t[ttf.toString('latin1', o, o + 4)] = ttf.subarray(ttf.readUInt32BE(o + 8), ttf.readUInt32BE(o + 8) + ttf.readUInt32BE(o + 12));
  }
  return t;
}

/** Les noms (famille, style, copyright…) : { 0: '…', 1: '…', … }. */
function noms(ttf) {
  const t = tablesTtf(ttf).name;
  const res = {};
  if (!t) return res;
  const nb = t.readUInt16BE(2), stock = t.readUInt16BE(4);
  for (let i = 0; i < nb; i++) {
    const o = 6 + i * 12;
    const plat = t.readUInt16BE(o), id = t.readUInt16BE(o + 6), len = t.readUInt16BE(o + 8), off = t.readUInt16BE(o + 10);
    const brut = t.subarray(stock + off, stock + off + len);
    let s;
    if (plat === 0 || plat === 3) { s = ''; for (let k = 0; k + 1 < brut.length; k += 2) s += String.fromCharCode(brut.readUInt16BE(k)); }
    else s = brut.toString('latin1');
    if (!res[id] || plat === 3) res[id] = s;
  }
  return res;
}

/** L'ensemble des points de code présents (cmap 4 ou 12). */
function caracteres(ttf) {
  const t = tablesTtf(ttf).cmap;
  const res = new Set();
  if (!t) return res;
  const nb = t.readUInt16BE(2);
  for (let i = 0; i < nb; i++) {
    const off = t.readUInt32BE(4 + i * 8 + 4);
    const fmt = t.readUInt16BE(off);
    if (fmt === 4) {
      const segX2 = t.readUInt16BE(off + 6);
      const fin = off + 14, debut = fin + segX2 + 2, delta = debut + segX2, ranges = delta + segX2;
      for (let s = 0; s < segX2 / 2; s++) {
        const e = t.readUInt16BE(fin + s * 2), d = t.readUInt16BE(debut + s * 2);
        const dl = t.readInt16BE(delta + s * 2), ro = t.readUInt16BE(ranges + s * 2);
        for (let c = d; c <= e && c !== 0xFFFF; c++) {
          let g;
          if (ro === 0) g = (c + dl) & 0xFFFF;
          else { const a = ranges + s * 2 + ro + (c - d) * 2; g = t.readUInt16BE(a); if (g) g = (g + dl) & 0xFFFF; }
          if (g) res.add(c);
        }
      }
    } else if (fmt === 12) {
      const ng = t.readUInt32BE(off + 12);
      for (let g = 0; g < ng; g++) {
        const o = off + 16 + g * 12;
        for (let c = t.readUInt32BE(o); c <= t.readUInt32BE(o + 4); c++) res.add(c);
      }
    }
  }
  return res;
}

module.exports = { woffVersTtf, noms, caracteres };
