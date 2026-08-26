#!/usr/bin/env node
/*
 * REMETTRE D'APLOMB LA TABLE `OS/2` DES FONTES DÉJÀ EXTRAITES.
 *
 *   node scripts/reparer-os2-fontes.js [--verifier] [fichier.woff …]
 *
 * Sans argument, le script passe sur TOUS les .woff de `public/`.
 *
 * POURQUOI. `scripts/extract-swf-font.js` écrivait une OS/2 amputée de son
 * champ `sFamilyClass` : deux octets manquants, et tout ce qui suit se lit
 * deux octets trop tôt. Le dégât n'était pas cosmétique — `usWinAscent`
 * tombait sur ce qu'on avait écrit dans `usWinDescent` (216 unités au lieu de
 * 1033 pour « impact »), et `fsSelection` sur l'index du premier caractère.
 *
 * Or les navigateurs ne prennent pas tous leurs métriques verticales au même
 * endroit : Linux (FreeType) lit `hhea`, qui était juste ; Windows et macOS
 * lisent `OS/2`, qui ne l'était pas. D'où un rendu correct au banc d'essai et
 * faux chez les joueurs : dans le bureau Frutiz, le numéro de niveau remontait
 * de trois pixels au-dessus du sigle « NIV » et le rang, écrit en 22 px,
 * sortait par le haut de l'encart, que `overflow:hidden` rognait — il n'en
 * restait qu'un demi-chiffre.
 *
 * Plutôt que de retrouver le SWF et l'identifiant de chacune des vingt et une
 * fontes déjà extraites, on RÉÉCRIT la table à partir de ce que la fonte porte
 * elle-même : `head` (cadratin, boîte englobante), `hhea` (ascendante,
 * descendante, interligne), `hmtx` (les chasses) et `cmap` (les codes). Le
 * reste du fichier n'est pas touché — mêmes contours, mêmes chasses.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { batirOs2 } = require('./lib/table-os2.js');

const RACINE = path.join(__dirname, '..');

// ── Lire / écrire un WOFF ────────────────────────────────────────────────────

function lireWoff(chemin) {
  const b = fs.readFileSync(chemin);
  if (b.toString('latin1', 0, 4) !== 'wOFF') throw new Error(chemin + " n'est pas un WOFF");
  const n = b.readUInt16BE(12);
  const tables = [];
  for (let i = 0; i < n; i++) {
    const o = 44 + i * 20;
    const nom = b.toString('latin1', o, o + 4);
    const pos = b.readUInt32BE(o + 4);
    const comprime = b.readUInt32BE(o + 8);
    const brut = b.readUInt32BE(o + 12);
    let d = b.slice(pos, pos + comprime);
    if (comprime !== brut) d = zlib.inflateSync(d);
    tables.push({ nom, data: d });
  }
  return { tables, entete: b.slice(0, 44) };
}

const cale4 = (b) => (b.length % 4 === 0 ? b : Buffer.concat([b, Buffer.alloc(4 - (b.length % 4))]));

function somme(b) {
  const p = cale4(b);
  let s = 0;
  for (let i = 0; i < p.length; i += 4) s = (s + p.readUInt32BE(i)) >>> 0;
  return s >>> 0;
}

// Reconstruire le TTF (répertoire + tables), puis le remballer en WOFF.
function ecrireWoff(tables, version) {
  const tbl = tables.slice().sort((a, b) => (a.nom < b.nom ? -1 : 1));
  let portee = 16, selecteur = 0;
  while (portee * 2 <= tbl.length * 16) { portee *= 2; selecteur++; }
  const rep = Buffer.alloc(12 + tbl.length * 16);
  rep.writeUInt32BE(version >>> 0, 0);
  rep.writeUInt16BE(tbl.length, 4);
  rep.writeUInt16BE(portee, 6);
  rep.writeUInt16BE(selecteur, 8);
  rep.writeUInt16BE(tbl.length * 16 - portee, 10);
  let pos = rep.length;
  const bouts = [];
  tbl.forEach((t, i) => {
    const o = 12 + i * 16;
    rep.write(t.nom, o, 4, 'latin1');
    rep.writeUInt32BE(somme(t.data), o + 4);
    rep.writeUInt32BE(pos, o + 8);
    rep.writeUInt32BE(t.data.length, o + 12);
    t.pos = pos;
    const cale = cale4(t.data);
    bouts.push(cale);
    pos += cale.length;
  });
  const ttf = Buffer.concat([rep, ...bouts]);
  const tete = tbl.find((t) => t.nom === 'head');
  if (tete) {
    ttf.writeUInt32BE(0, tete.pos + 8);                     // remettre à zéro AVANT de sommer
    ttf.writeUInt32BE((0xB1B0AFBA - somme(ttf)) >>> 0, tete.pos + 8);
  }

  // WOFF : même répertoire, chaque table compressée si elle y gagne.
  let p = 44 + tbl.length * 20;
  const dir = Buffer.alloc(tbl.length * 20);
  const corps = [];
  tbl.forEach((t, i) => {
    const serre = zlib.deflateSync(t.data, { level: 9 });
    const pris = serre.length < t.data.length ? serre : t.data;
    const o = i * 20;
    dir.write(t.nom, o, 4, 'latin1');
    dir.writeUInt32BE(p, o + 4);
    dir.writeUInt32BE(pris.length, o + 8);
    dir.writeUInt32BE(t.data.length, o + 12);
    dir.writeUInt32BE(somme(t.data), o + 16);
    corps.push(pris);
    const reste = ((pris.length + 3) & ~3) - pris.length;
    if (reste) corps.push(Buffer.alloc(reste));
    p += (pris.length + 3) & ~3;
  });
  const tailleTtf = 12 + tbl.length * 16 + tbl.reduce((s, t) => s + ((t.data.length + 3) & ~3), 0);
  const ent = Buffer.alloc(44);
  ent.write('wOFF', 0, 4, 'latin1');
  ent.writeUInt32BE(version >>> 0, 4);
  ent.writeUInt32BE(p, 8);
  ent.writeUInt16BE(tbl.length, 12);
  ent.writeUInt16BE(0, 14);
  ent.writeUInt32BE(tailleTtf, 16);
  ent.writeUInt16BE(1, 20); ent.writeUInt16BE(0, 22);       // version majeure/mineure
  ent.writeUInt32BE(0, 24); ent.writeUInt32BE(0, 28);        // metaOffset / metaLength
  ent.writeUInt32BE(0, 32); ent.writeUInt32BE(0, 36);        // metaOrigLength / privOffset
  ent.writeUInt32BE(0, 40);                                  // privLength
  return Buffer.concat([ent, dir, ...corps]);
}

// ── Ce que la fonte sait d'elle-même ─────────────────────────────────────────

function codesDeCmap(cmap) {
  const codes = [];
  if (!cmap) return codes;
  const nb = cmap.readUInt16BE(2);
  for (let i = 0; i < nb; i++) {
    const off = cmap.readUInt32BE(8 + i * 8);
    if (cmap.readUInt16BE(off) !== 4) continue;
    const segX2 = cmap.readUInt16BE(off + 6);
    const fin = off + 14, deb = fin + segX2 + 2;
    for (let s = 0; s < segX2 / 2; s++) {
      const e = cmap.readUInt16BE(fin + s * 2), d = cmap.readUInt16BE(deb + s * 2);
      if (d === 0xffff) continue;
      for (let c = d; c <= e && c !== 0xffff; c++) codes.push(c);
    }
    break;
  }
  return codes;
}

function reparer(chemin, verifierSeulement) {
  const { tables } = lireWoff(chemin);
  const par = {};
  for (const t of tables) par[t.nom] = t.data;
  const ancienne = par['OS/2'];
  if (!par.head || !par.hhea) return { chemin, etat: 'sans head/hhea' };

  const em = par.head.readUInt16BE(18);
  const boite = {
    yMin: par.head.readInt16BE(38),
    yMax: par.head.readInt16BE(42),
  };
  const ascent = par.hhea.readInt16BE(4);
  const descent = par.hhea.readInt16BE(6);
  const lineGap = par.hhea.readInt16BE(8);
  const nHM = par.hhea.readUInt16BE(34);
  const chasses = [];
  if (par.hmtx) for (let i = 0; i < nHM && i * 4 + 2 <= par.hmtx.length; i++) chasses.push(par.hmtx.readUInt16BE(i * 4));

  const neuve = batirOs2({ em, ascent, descent, lineGap, chasses, codes: codesDeCmap(par.cmap), boite });
  const dejaBonne = ancienne && ancienne.length === 96 && ancienne.equals(neuve);
  if (verifierSeulement || dejaBonne) {
    return { chemin, etat: dejaBonne ? 'déjà juste' : 'à réparer',
      avant: ancienne ? ancienne.length : 0, ascent, descent, em };
  }

  const sorties = tables.filter((t) => t.nom !== 'OS/2').concat([{ nom: 'OS/2', data: neuve }]);
  fs.writeFileSync(chemin, ecrireWoff(sorties, 0x00010000));
  return { chemin, etat: 'réparée', avant: ancienne ? ancienne.length : 0, ascent, descent, em };
}

function principal() {
  const args = process.argv.slice(2);
  const verifier = args.includes('--verifier');
  let cibles = args.filter((a) => a !== '--verifier');
  if (!cibles.length) {
    const trouver = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return trouver(p);
      return e.name.endsWith('.woff') ? [p] : [];
    });
    cibles = trouver(path.join(RACINE, 'public')).sort();
  }
  let aFaire = 0;
  for (const c of cibles) {
    const r = reparer(c, verifier);
    if (r.etat === 'à réparer') aFaire++;
    console.log(path.relative(RACINE, c).padEnd(40), r.etat,
      r.avant !== undefined ? '(OS/2 ' + r.avant + ' octets, asc ' + r.ascent + ' desc ' + r.descent + ' em ' + r.em + ')' : '');
  }
  if (verifier && aFaire) {
    console.error('\n' + aFaire + ' fonte(s) à réparer — relancer sans --verifier.');
    process.exitCode = 1;
  }
}

if (require.main === module) principal();
module.exports = { reparer, lireWoff, ecrireWoff };
