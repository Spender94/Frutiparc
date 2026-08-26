/*
 * LES FONTES TIRÉES DES SWF : leur table `OS/2` doit être d'aplomb.
 *
 * Le bogue qui a motivé ce fichier ne se voyait pas au banc d'essai. La table
 * `OS/2` était écrite à la main et il y manquait `sFamilyClass` — deux octets.
 * Tout ce qui suit se lisait donc deux octets trop tôt : `usWinAscent` tombait
 * sur la valeur écrite pour `usWinDescent` (216 unités au lieu de 1033 pour
 * « impact »), et `fsSelection` sur l'index du premier caractère.
 *
 * Or les navigateurs ne prennent pas leurs métriques verticales au même
 * endroit : Linux (FreeType) lit `hhea`, qui était juste ; Windows et macOS
 * lisent `OS/2`, qui ne l'était pas. Le rendu était donc correct sur la machine
 * qui l'auditait et faux chez les joueurs — dans le bureau Frutiz, le numéro de
 * niveau remontait au-dessus du sigle « NIV », et le rang, écrit en 22 px,
 * sortait par le haut de l'encart, que `overflow:hidden` rognait.
 *
 * Ce test relit CHAQUE .woff livré et vérifie que les trois jeux de métriques
 * (hhea, sTypo*, usWin*) disent la même chose. `scripts/reparer-os2-fontes.js`
 * les remet d'aplomb au besoin.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.join(__dirname, '..');

function tousLesWoff(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return tousLesWoff(p);
    return e.name.endsWith('.woff') ? [p] : [];
  });
}

function tables(chemin) {
  const b = fs.readFileSync(chemin);
  assert.strictEqual(b.toString('latin1', 0, 4), 'wOFF', chemin + " n'est pas un WOFF");
  const n = b.readUInt16BE(12);
  const out = {};
  for (let i = 0; i < n; i++) {
    const o = 44 + i * 20;
    const nom = b.toString('latin1', o, o + 4);
    const pos = b.readUInt32BE(o + 4);
    const comprime = b.readUInt32BE(o + 8);
    const brut = b.readUInt32BE(o + 12);
    let d = b.slice(pos, pos + comprime);
    if (comprime !== brut) d = zlib.inflateSync(d);
    assert.strictEqual(d.length, brut, chemin + ' : table ' + nom + ' de longueur inattendue');
    out[nom] = d;
  }
  return out;
}

const FICHIERS = tousLesWoff(path.join(ROOT, 'public')).sort();

test('il y a bien des fontes SWF livrées', () => {
  assert.ok(FICHIERS.length >= 20, 'seulement ' + FICHIERS.length + ' fonte(s) trouvée(s)');
});

for (const chemin of FICHIERS) {
  const nom = path.relative(ROOT, chemin);

  test(nom + ' : OS/2 complète et métriques concordantes', () => {
    const t = tables(chemin);
    for (const requise of ['OS/2', 'head', 'hhea', 'hmtx', 'cmap', 'glyf', 'loca', 'maxp', 'name', 'post']) {
      assert.ok(t[requise], nom + ' : table ' + requise + ' absente');
    }
    const os2 = t['OS/2'];
    // La version 4 fait 96 octets PILE. C'est cette longueur qui trahissait le
    // champ manquant : on en écrivait 100, décalés de deux.
    assert.strictEqual(os2.readUInt16BE(0), 4, nom + ' : OS/2 doit être en version 4');
    assert.strictEqual(os2.length, 96, nom + ' : OS/2 v4 doit faire 96 octets');

    // La marque du fondeur est à sa place : c'est le premier symptôme d'un
    // décalage, car elle se lisait « FX\0@ ».
    assert.strictEqual(os2.toString('latin1', 58, 62), 'SWFX', nom + ' : achVendID décalé');

    // REGULAR (0x40) et USE_TYPO_METRICS (0x80) — ce dernier ordonne à tous les
    // moteurs de s'en tenir aux sTypo*, donc au même rendu partout.
    assert.strictEqual(os2.readUInt16BE(62), 0x00C0, nom + ' : fsSelection inattendu');

    const asc = t.hhea.readInt16BE(4);
    const desc = t.hhea.readInt16BE(6);
    const gap = t.hhea.readInt16BE(8);
    assert.strictEqual(os2.readInt16BE(68), asc, nom + ' : sTypoAscender ≠ hhea.ascender');
    assert.strictEqual(os2.readInt16BE(70), desc, nom + ' : sTypoDescender ≠ hhea.descender');
    assert.strictEqual(os2.readInt16BE(72), gap, nom + ' : sTypoLineGap ≠ hhea.lineGap');

    // usWinAscent/Descent sont POSITIFS et couvrent au moins l'ascendante et la
    // descendante déclarées — sans quoi Windows rogne les contours.
    const yMin = t.head.readInt16BE(38), yMax = t.head.readInt16BE(42);
    assert.ok(os2.readUInt16BE(74) >= Math.max(asc, yMax), nom + ' : usWinAscent trop court');
    assert.ok(os2.readUInt16BE(76) >= Math.max(-desc, -yMin), nom + ' : usWinDescent trop court');

    // Et la cohérence de base : autant de chasses que de glyphes annoncés.
    const nGlyphes = t.maxp.readUInt16BE(4);
    const nHM = t.hhea.readUInt16BE(34);
    assert.ok(nHM > 0 && nHM <= nGlyphes, nom + ' : numberOfHMetrics (' + nHM + ') hors de ' + nGlyphes);
    assert.strictEqual(t.hmtx.length, nHM * 4, nom + ' : hmtx de longueur inattendue');
  });
}

test('les deux fontes de l’encart gardent les chasses inscrites dans main.swf', () => {
  // `DefineEditText` #430 tire sur la fonte #428 « impact » en 11 px, #413 sur
  // la fonte #412 « lcd » en 22 px. Les chasses viennent du SWF : c'est d'elles
  // que dépend le centrage du niveau dans sa colonne de 12,7 px.
  const attendu = {
    'public/frutiz/fontes/impact.woff': { 0x30: 549, 0x31: 390, 0x33: 543, 0x4E: 555 },
    'public/frutiz/fontes/lcd.woff': { 0x30: 505, 0x31: 280, 0x32: 478, 0x38: 506 },
  };
  for (const [rel, chasses] of Object.entries(attendu)) {
    const t = tables(path.join(ROOT, rel));
    const nHM = t.hhea.readUInt16BE(34);
    const cmap = t.cmap;
    // cmap format 4, sous-table unique (3, 1).
    const off = cmap.readUInt32BE(8);
    const segX2 = cmap.readUInt16BE(off + 6);
    const fin = off + 14, deb = fin + segX2 + 2, delta = deb + segX2, rang = delta + segX2;
    const indexDe = (c) => {
      for (let s = 0; s < segX2 / 2; s++) {
        if (c > cmap.readUInt16BE(fin + s * 2) || c < cmap.readUInt16BE(deb + s * 2)) continue;
        const ro = cmap.readUInt16BE(rang + s * 2);
        if (ro === 0) return (c + cmap.readInt16BE(delta + s * 2)) & 0xFFFF;
        return cmap.readUInt16BE(rang + s * 2 + ro + (c - cmap.readUInt16BE(deb + s * 2)) * 2);
      }
      return 0;
    };
    for (const [code, chasse] of Object.entries(chasses)) {
      const gi = indexDe(Number(code));
      assert.ok(gi > 0 && gi < nHM, rel + ' : le code ' + code + ' ne pointe sur aucun glyphe');
      assert.strictEqual(t.hmtx.readUInt16BE(gi * 4), chasse,
        rel + ' : chasse du caractère ' + String.fromCharCode(Number(code)));
    }
  }
});
