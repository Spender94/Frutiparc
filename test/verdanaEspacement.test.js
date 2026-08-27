'use strict';
/*
 * L'INTERLETTRAGE DE LA VERDANA D'ÉPOQUE.
 *
 * « J'ai l'impression que le rendu sur main.swf est légèrement plus resserré. »
 * Il l'est, et le SWF dit de combien.
 *
 * main.swf porte un texte STATIQUE en Verdana 10 px : « chargement du truc en
 * cours » (DefineText #603 et #606, fonte #602 « verdana_10pt_st »). Un texte
 * statique ne stocke pas des lettres mais des couples (glyphe, avance) — et
 * Flash y a écrit des avances en PIXELS ENTIERS. Le navigateur, lui, avance au
 * centième de pixel : sur la même phrase il occupe 145,75 px là où le SWF en
 * relève 144.
 *
 * Ce fichier relit les avances dans le SWF, refait la soustraction, et vérifie
 * que le réglage posé dans la feuille de style tombe bien dans l'intervalle
 * mesuré. Si quelqu'un touche au chiffre sans raison, le test le dit.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.join(__dirname, '..');
const SWF = path.join(ROOT, 'legacy/main.swf');
const CSS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.css'), 'utf8');

/*
 * Verdana, avances de dessin en 1/2048 d'em.
 *
 * Cette table n'est pas de confiance aveugle : main.swf embarque UNE Verdana
 * qui déclare sa mise en page (fonte #148, en gras), et sa table d'avances
 * donne 684 716 680 350 1084 703 716 509 pour a d e i m o p r — soit, au
 * centième de pixel près à 10 px, les avances de Verdana Gras. La fonte
 * embarquée est donc la vraie, et la table ci-dessous s'y accorde.
 */
const VERDANA = {
  ' ': 726, a: 1220, b: 1300, c: 1067, d: 1300, e: 1216, f: 698, g: 1300,
  h: 1298, i: 569, j: 569, k: 1181, l: 569, m: 1998, n: 1298, o: 1253,
  p: 1300, q: 1300, r: 855, s: 1067, t: 803, u: 1298, v: 1181, w: 1729,
  x: 1181, y: 1181, z: 1046,
};

function corpsSwf(chemin) {
  const b = fs.readFileSync(chemin);
  const sig = b.toString('latin1', 0, 3);
  if (sig === 'CWS') return zlib.inflateSync(b.slice(8));
  if (sig === 'FWS') return b.slice(8);
  throw new Error('signature inconnue : ' + sig);
}

// Le corps du SWF commence après le RECT de la scène, puis 4 octets (cadence
// et nombre d'images).
function debutDesBalises(b) {
  const nbits = b[0] >> 3;
  return Math.ceil((5 + nbits * 4) / 8) + 4;
}

function* balises(b) {
  let p = debutDesBalises(b);
  while (p < b.length - 1) {
    const entete = b.readUInt16LE(p); p += 2;
    const code = entete >> 6;
    let len = entete & 0x3f;
    if (len === 0x3f) { len = b.readUInt32LE(p); p += 4; }
    yield { code, debut: p, len };
    if (code === 0) return;
    p += len;
  }
}

// La table des codes de caractères d'une fonte DefineFont3 : elle dit à quel
// caractère répond le glyphe n° i, et c'est elle qui rend lisibles les couples
// (glyphe, avance) d'un texte statique.
function codesDeLaFonte(b, cible) {
  for (const t of balises(b)) {
    if (t.code !== 48 || b.readUInt16LE(t.debut) !== cible) continue;
    let q = t.debut + 2;
    // Les huit drapeaux se lisent du bit de poids fort au faible.
    const fl = b[q++]; q++;                       // drapeaux, langue
    const nl = b[q++]; q += nl;                   // nom de la fonte
    const n = b.readUInt16LE(q); q += 2;
    const larges = !!(fl & 0x08), codesLarges = !!(fl & 0x04);
    const table = q;
    // Le décalage de la table des codes est la (n+1)-ième entrée de la table
    // des décalages, comptée depuis le début de celle-ci.
    const dec = larges ? b.readUInt32LE(table + n * 4) : b.readUInt16LE(table + n * 2);
    let cq = table + dec;
    const codes = [];
    for (let i = 0; i < n; i++) {
      codes.push(codesLarges ? b.readUInt16LE(cq + i * 2) : b[cq + i]);
    }
    return codes.map((c) => String.fromCharCode(c));
  }
  return null;
}

// Les couples (caractère, avance) des textes statiques, par fonte et par
// taille. L'avance est en twips — 20 par pixel.
function textesStatiques(b) {
  const parFonte = new Map();
  for (const t of balises(b)) {
    if (t.code !== 11 && t.code !== 33) continue;
    const fin = t.debut + t.len;
    let q = t.debut + 2;                          // identifiant
    const nbits = b[q] >> 3;
    // Le RECT, puis la MATRIX, tous deux à lire au bit près.
    let bq = (q + Math.ceil((5 + nbits * 4) / 8)) * 8;
    const bit = () => (b[bq >> 3] >> (7 - (bq++ & 7))) & 1;
    const ub = (k) => { let v = 0; for (let i = 0; i < k; i++) v = v * 2 + bit(); return v; };
    const sb = (k) => { if (!k) return 0; const v = ub(k); return v >= (1 << (k - 1)) ? v - (1 << k) : v; };
    if (bit()) { const k = ub(5); sb(k); sb(k); }  // échelle
    if (bit()) { const k = ub(5); sb(k); sb(k); }  // rotation
    { const k = ub(5); sb(k); sb(k); }             // translation
    q = Math.ceil(bq / 8);
    const bitsGlyphe = b[q++], bitsAvance = b[q++];
    let fonte = null, taille = null;
    while (q < fin) {
      const h = b[q++];
      if (h === 0) break;
      if (h & 0x80) {                              // un en-tête de style
        const aFonte = h & 0x08, aCouleur = h & 0x04, aY = h & 0x02, aX = h & 0x01;
        if (aFonte) { fonte = b.readUInt16LE(q); q += 2; }
        if (aCouleur) q += (t.code === 33 ? 4 : 3);
        if (aX) q += 2;
        if (aY) q += 2;
        if (aFonte) { taille = b.readUInt16LE(q); q += 2; }
      } else {                                     // une suite de glyphes
        const n = h & 0x7f;
        let gb = q * 8;
        const g1 = () => (b[gb >> 3] >> (7 - (gb++ & 7))) & 1;
        const gub = (k) => { let v = 0; for (let i = 0; i < k; i++) v = v * 2 + g1(); return v; };
        const gsb = (k) => { if (!k) return 0; const v = gub(k); return v >= (1 << (k - 1)) ? v - (1 << k) : v; };
        const suite = [];
        for (let i = 0; i < n; i++) suite.push([gub(bitsGlyphe), gsb(bitsAvance)]);
        q = Math.ceil(gb / 8);
        const cle = fonte + '@' + taille;
        if (!parFonte.has(cle)) parFonte.set(cle, []);
        parFonte.get(cle).push(...suite);
      }
    }
  }
  return parFonte;
}

const b = corpsSwf(SWF);
const codes602 = codesDeLaFonte(b, 602);
const suite602 = (textesStatiques(b).get('602@200') || [])
  .map(([g, a]) => [codes602[g], a]);

test('main.swf porte bien la phrase en Verdana 10 px', () => {
  assert.ok(codes602, 'la fonte #602 « verdana_10pt_st » doit exister');
  assert.ok(suite602.length >= 27,
    'au moins une phrase relevée (relevé : ' + suite602.length + ' glyphes)');
  const mot = suite602.map(([c]) => c).join('');
  assert.match(mot, /chargement du /, 'la phrase attendue : ' + mot);
});

test('les avances d’époque sont des PIXELS ENTIERS', () => {
  for (const [c, a] of suite602) {
    assert.strictEqual(a % 20, 0,
      'l’avance du « ' + c + ' » vaut ' + a + ' twips, soit ' + (a / 20) + ' px');
  }
});

test('le navigateur est plus large, et la feuille de style rattrape l’écart', () => {
  // La phrase, mesurée des deux côtés.
  let ere = 0, navigateur = 0, n = 0;
  for (const [c, a] of suite602) {
    if (VERDANA[c] === undefined) continue;        // hors de la table : on passe
    ere += a / 20;
    navigateur += VERDANA[c] / 2048 * 10;
    n++;
  }
  assert.ok(n >= 27, 'assez de caractères mesurés (' + n + ')');
  const parCaractere = (ere - navigateur) / n;
  assert.ok(parCaractere < 0,
    'le SWF doit être le plus serré (relevé : ' + parCaractere.toFixed(4) + ' px)');

  // La même moyenne, pondérée par la fréquence des lettres en français : c'est
  // l'écart que voit un joueur sur du texte quelconque, pas sur cette phrase.
  const FREQ = {
    e: .147, a: .076, i: .075, s: .079, n: .071, r: .066, t: .072, o: .054,
    l: .055, u: .063, d: .037, c: .033, m: .030, p: .030, v: .016, q: .014,
    f: .011, b: .009, g: .009, h: .007, j: .005, x: .004, y: .003, z: .001,
  };
  let somme = 0, poids = 0;
  for (const c of Object.keys(FREQ)) {
    const av = VERDANA[c] / 2048 * 10;
    somme += FREQ[c] * (Math.round(av) - av);
    poids += FREQ[c];
  }
  const pondere = somme / poids;

  // Le réglage livré doit tomber entre les deux relevés — ni au hasard, ni
  // au-delà de ce que le SWF autorise.
  const m = /body\.bureau-frutiz \{ letter-spacing: (-?[\d.]+)em; \}/.exec(CSS);
  assert.ok(m, 'la règle d’interlettrage doit être posée sur body.bureau-frutiz');
  const pose = Number(m[1]) * 10;                  // en px, à la taille de base
  const bas = Math.min(parCaractere, pondere), haut = Math.max(parCaractere, pondere);
  assert.ok(pose >= bas - 0.005 && pose <= haut + 0.005,
    'réglé à ' + pose.toFixed(4) + ' px/caractère ; relevés '
    + bas.toFixed(4) + ' … ' + haut.toFixed(4));
});

test('les fontes sorties du SWF gardent leur propre chasse', () => {
  // Elles placent leurs glyphes avec la table de la fonte, sans arrondi à
  // rattraper : l'interlettrage du bureau ne doit pas les atteindre.
  const m = /letter-spacing: normal;/.test(CSS);
  assert.ok(m, 'une remise à zéro doit exister pour les fontes embarquées');
  for (const sel of ['.enc-trophy .val', '.enc-niv .lvl', '.fa-niv b']) {
    assert.ok(CSS.includes(sel), 'sélecteur remis à zéro : ' + sel);
  }
});
