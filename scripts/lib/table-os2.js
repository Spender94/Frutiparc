/*
 * La table `OS/2` d'une fonte TrueType, écrite au format que la spec demande.
 *
 * POURQUOI UN MODULE À PART. La version 4 de cette table fait 96 octets, ni
 * plus ni moins, et l'ordre des champs n'a rien d'indicatif : un champ oublié
 * décale TOUT ce qui suit. C'est ce qui était arrivé — `sFamilyClass` manquait,
 * si bien que le lecteur prenait `usWinAscent` là où l'on avait écrit
 * `usWinDescent`, et lisait 216 unités d'ascendante au lieu de 1033.
 *
 * Ce n'est pas une coquette : selon la plate-forme, un navigateur prend ses
 * métriques verticales dans `hhea` (Linux, via FreeType) ou dans `OS/2`
 * (Windows, macOS). Une OS/2 fausse donne donc un rendu JUSTE ici et FAUX
 * ailleurs — des chiffres qui remontent de trois pixels, et un encart qui les
 * rogne. D'où deux précautions, désormais :
 *
 *   — les métriques verticales sont écrites TROIS fois et concordantes :
 *     `sTypoAscender/Descender/LineGap`, `usWinAscent/Descent`, et la `hhea`
 *     que l'appelant remplit des mêmes valeurs ;
 *   — le bit 7 de `fsSelection` (USE_TYPO_METRICS) est levé, ce qui ordonne à
 *     tout moteur récent de s'en tenir aux `sTypo*`. Les trois jeux étant
 *     d'accord, la fonte tombe au même endroit partout.
 */
'use strict';

/**
 * @param {object} o
 * @param {number} o.em            unités par cadratin (1024 pour un DefineFont2)
 * @param {number} o.ascent        ascendante, en unités de l'em (positive)
 * @param {number} o.descent       descendante, en unités de l'em (NÉGATIVE)
 * @param {number} o.lineGap       interligne, en unités de l'em
 * @param {number[]} o.chasses     les chasses, pour la moyenne
 * @param {number[]} o.codes       les points de code couverts
 * @param {{yMin:number,yMax:number}} o.boite  la boîte englobante des contours
 * @returns {Buffer} 96 octets
 */
function batirOs2(o) {
  const { em, ascent, descent, lineGap, chasses, codes, boite } = o;
  const utiles = (chasses || []).filter((c) => c > 0);
  const moyenne = utiles.length ? Math.round(utiles.reduce((s, c) => s + c, 0) / utiles.length) : Math.round(em / 2);
  const tries = (codes || []).filter((c) => c > 0 && c <= 0xffff).sort((a, b) => a - b);
  // Windows rogne à `usWinAscent/Descent` : ils doivent couvrir les contours,
  // pas seulement l'ascendante déclarée.
  const winAsc = Math.max(ascent, boite ? boite.yMax : 0, 1);
  const winDesc = Math.max(-descent, boite ? -boite.yMin : 0, 0);

  const w = [];
  const u16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16BE(v & 0xffff); w.push(b); };
  const i16 = (v) => { const b = Buffer.alloc(2); b.writeInt16BE(Math.max(-32768, Math.min(32767, Math.round(v)))); w.push(b); };
  const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32BE(v >>> 0); w.push(b); };
  const brut = (b) => w.push(b);

  u16(4);                                   // version
  i16(moyenne);                             // xAvgCharWidth
  u16(400);                                 // usWeightClass — Regular
  u16(5);                                   // usWidthClass  — Medium
  u16(0);                                   // fsType — aucune restriction
  i16(0); i16(0); i16(0); i16(0);           // ySubscript X/Y size, X/Y offset
  i16(0); i16(0); i16(0); i16(0);           // ySuperscript X/Y size, X/Y offset
  i16(0); i16(0);                           // yStrikeout size, position
  i16(0);                                   // sFamilyClass — LE CHAMP OUBLIÉ
  brut(Buffer.from([2, 0, 5, 3, 0, 0, 0, 0, 0, 0]));        // panose
  u32(0x00000003); u32(0); u32(0); u32(0);  // ulUnicodeRange1..4 — latin de base
  brut(Buffer.from('SWFX', 'latin1'));      // achVendID
  u16(0x0040 | 0x0080);                     // fsSelection : REGULAR + USE_TYPO_METRICS
  u16(tries[0] || 32);                      // usFirstCharIndex
  u16(tries[tries.length - 1] || 126);      // usLastCharIndex
  i16(ascent); i16(descent); i16(lineGap);  // sTypoAscender / Descender / LineGap
  u16(winAsc); u16(winDesc);                // usWinAscent / usWinDescent
  u32(1); u32(0);                           // ulCodePageRange1..2 — Latin-1
  i16(Math.round(em * 0.5));                // sxHeight
  i16(Math.round(em * 0.7));                // sCapHeight
  u16(0);                                   // usDefaultChar
  u16(32);                                  // usBreakChar
  u16(1);                                   // usMaxContext

  const out = Buffer.concat(w);
  if (out.length !== 96) throw new Error('OS/2 v4 mal formée : ' + out.length + ' octets au lieu de 96');
  return out;
}

module.exports = { batirOs2 };
