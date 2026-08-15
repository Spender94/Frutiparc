// GREFFE de SWF : ajouter à une pellicule une image étiquetée qui porte un
// dessin BITMAP. C'est l'outil commun des trois rustines Mini-Fever — la
// jaquette du disque (fileIcon.swf), la vignette de médaille (awards.swf) et
// l'icône de statut (main.swf) : trois feuilles d'images choisies par
// gotoAndStop(<étiquette>), gravées avant que le jeu n'existe.
//
// La recette, la même partout :
//   · définir le bitmap (DefineBitsLossless2, ARGB prémultiplié) et une forme
//     rectangulaire qui le porte (DefineShape à remplissage bitmap), AVANT le
//     point d'usage ;
//   · au bout de la pellicule visée, insérer : RemoveObject2 des profondeurs
//     que la dernière image laisse traîner, FrameLabel, PlaceObject2 (et, au
//     besoin, la copie octet à octet d'un PlaceObject2 existant — pour
//     remettre un fond commun que les dernières images ont délogé), ShowFrame ;
//   · corriger le compte d'images (du sprite ou de l'en-tête), la longueur du
//     DefineSprite s'il y en a un, et l'en-tête du fichier.
//
// Tout est en tags longs pour ne pas jongler avec la forme courte, et chaque
// rustine vérifie l'étiquette avant d'écrire : la greffe est idempotente.
'use strict';

const fs = require('fs');
const zlib = require('zlib');

function lireSwf(p) {
  const raw = fs.readFileSync(p);
  const sig = raw.slice(0, 3).toString('ascii');
  if (sig !== 'CWS' && sig !== 'FWS') throw new Error('signature inconnue : ' + sig);
  const body = sig === 'CWS' ? zlib.inflateSync(raw.slice(8)) : Buffer.from(raw.slice(8));
  return { sig, version: raw[3], body };
}

function ecrireSwf(p, sig, version, body) {
  const charge = sig === 'CWS' ? zlib.deflateSync(body, { level: 9 }) : body;
  const out = Buffer.alloc(8 + charge.length);
  out.write(sig, 0, 'ascii');
  out.writeUInt8(version, 3);
  out.writeUInt32LE(8 + body.length, 4);       // FileLength = taille décompressée
  charge.copy(out, 8);
  fs.writeFileSync(p, out);
  return out.length;
}

function debutDesTags(body) {
  const nbits = (body[0] >> 3) & 0x1f;
  return Math.ceil((5 + nbits * 4) / 8) + 4;
}

/** Parcourt les tags de premier niveau : f(code, offset, entete, longueur). */
function parcourir(body, f) {
  let o = debutDesTags(body);
  while (o < body.length - 1) {
    const hdr = body.readUInt16LE(o);
    const code = hdr >> 6;
    let len = hdr & 0x3f, h = 2;
    if (len === 0x3f) { len = body.readUInt32LE(o + 2); h = 6; }
    if (code === 0) return o;
    if (f && f(code, o, h, len) === false) return o;
    o += h + len;
  }
  return -1;
}

/** Le plus grand identifiant de caractère du fichier — pour en allouer après. */
function dernierId(body) {
  const DEFS = new Set([2, 22, 32, 83, 6, 21, 35, 20, 36, 90, 39, 7, 34, 37, 10, 48, 75, 11, 33, 14, 46, 84]);
  let max = 0;
  parcourir(body, (code, o, h) => {
    if (DEFS.has(code)) max = Math.max(max, body.readUInt16LE(o + h));
  });
  return max;
}

/** En-tête de tag LONG. */
function enteteTag(code, longueur) {
  const b = Buffer.alloc(6);
  b.writeUInt16LE((code << 6) | 0x3f, 0);
  b.writeUInt32LE(longueur, 2);
  return b;
}

/** Écriture de champs au BIT près (RECT, MATRIX). */
class Bits {
  constructor() { this.bits = []; }
  u(valeur, n) { for (let i = n - 1; i >= 0; i--) this.bits.push((valeur >> i) & 1); }
  s(valeur, n) { this.u(valeur < 0 ? (1 << n) + valeur : valeur, n); }
  buffer() {
    const out = Buffer.alloc(Math.ceil(this.bits.length / 8));
    this.bits.forEach((b, i) => { if (b) out[i >> 3] |= 0x80 >> (i & 7); });
    return out;
  }
}
const bitsPour = (...vs) => Math.max(1, ...vs.map((v) => {
  const a = v < 0 ? -v - 1 : v;                  // complément à deux
  let n = 1; while (a >= (1 << (n - 1))) n++; return n + (v < 0 ? 0 : 0);
})) + 1;                                          // 1 bit de signe de marge

function rect(x0, x1, y0, y1) {
  const n = bitsPour(x0, x1, y0, y1);
  const b = new Bits();
  b.u(n, 5); b.s(x0, n); b.s(x1, n); b.s(y0, n); b.s(y1, n);
  return b.buffer();
}

/** MATRIX : échelle 16.16 optionnelle + translation en twips. */
function matrice(scale, tx, ty) {
  const b = new Bits();
  if (scale !== undefined && scale !== null) {
    const s = Math.round(scale * 65536);
    const n = bitsPour(s);
    b.u(1, 1); b.u(n, 5); b.s(s, n); b.s(s, n);
  } else b.u(0, 1);
  b.u(0, 1);                                      // pas de rotation
  const n = bitsPour(tx || 0, ty || 0);
  b.u(n, 5); b.s(tx || 0, n); b.s(ty || 0, n);
  return b.buffer();
}

/**
 * DefineBitsLossless2 (36) depuis un PNG : ARGB prémultiplié, compressé zlib.
 * Le décodage PNG vient de pngjs, chargé au besoin (les rustines tournent
 * hors dépôt de dépendances : NODE_PATH du bac à sable).
 */
function tagBitmap(id, png) {
  const { PNG } = require('pngjs');
  const im = PNG.sync.read(png);
  const argb = Buffer.alloc(im.width * im.height * 4);
  for (let i = 0; i < im.width * im.height; i++) {
    const a = im.data[i * 4 + 3];
    argb[i * 4] = a;
    argb[i * 4 + 1] = Math.round(im.data[i * 4] * a / 255);
    argb[i * 4 + 2] = Math.round(im.data[i * 4 + 1] * a / 255);
    argb[i * 4 + 3] = Math.round(im.data[i * 4 + 2] * a / 255);
  }
  const corps = Buffer.concat([
    Buffer.from([id & 255, id >> 8, 5]),
    Buffer.from([im.width & 255, im.width >> 8, im.height & 255, im.height >> 8]),
    zlib.deflateSync(argb, { level: 9 }),
  ]);
  return { tag: Buffer.concat([enteteTag(36, corps.length), corps]), w: im.width, h: im.height };
}

/**
 * DefineShape (2) : un rectangle rempli par le bitmap `bitmapId`. La boîte va
 * de (-w/2·k, -h/2·k) à (w/2·k, h/2·k) en twips, où k = 20/facteur — un
 * `facteur` de 2 pose un bitmap 2× dans une boîte moitié : net sur le bureau.
 */
function tagFormeBitmap(id, bitmapId, w, h, facteur) {
  const k = 20 / (facteur || 1);
  const x0 = Math.round(-w * k / 2), x1 = Math.round(w * k / 2);
  const y0 = Math.round(-h * k / 2), y1 = Math.round(h * k / 2);
  const bornes = rect(x0, x1, y0, y1);
  // Le style : un remplissage bitmap « clipped » (0x41), calé sur la boîte.
  const styles = Buffer.concat([
    Buffer.from([1, 0x41, bitmapId & 255, bitmapId >> 8]), matrice(k, x0, y0),
    Buffer.from([0]),                              // aucun trait
  ]);
  // Les enregistrements de forme : moveTo(x0,y0) avec fill1 = 1, puis le tour
  // du rectangle en quatre arêtes droites, puis la fin.
  const b = new Bits();
  b.u(1, 4); b.u(0, 4);                            // 1 bit de fill, 0 de trait
  b.u(0, 1);                                       // enregistrement d'ÉTAT
  b.u(0b00101, 5);                                 // FillStyle1 + MoveTo
  const nM = bitsPour(x0, y0);
  b.u(nM, 5); b.s(x0, nM); b.s(y0, nM);
  b.u(1, 1);                                       // fill1 = style 1 (sur 1 bit)
  const arete = (dx, dy) => {
    const n = Math.max(2, bitsPour(dx, dy));
    b.u(1, 1); b.u(1, 1);                          // arête, droite
    b.u(n - 2, 4);
    if (dx !== 0 && dy !== 0) { b.u(1, 1); b.s(dx, n); b.s(dy, n); }
    else { b.u(0, 1); b.u(dy !== 0 ? 1 : 0, 1); b.s(dx || dy, n); }
  };
  arete(x1 - x0, 0); arete(0, y1 - y0); arete(x0 - x1, 0); arete(0, y0 - y1);
  b.u(0, 1); b.u(0, 5);                            // fin des enregistrements
  const corps = Buffer.concat([
    Buffer.from([id & 255, id >> 8]), bornes, styles, b.buffer(),
  ]);
  return Buffer.concat([enteteTag(2, corps.length), corps]);
}

function tagFrameLabel(nom) {
  const txt = Buffer.from(nom + '\0', 'latin1');
  return Buffer.concat([enteteTag(43, txt.length), txt]);
}

function tagRemoveObject2(prof) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(prof, 0);
  return Buffer.concat([enteteTag(28, 2), b]);
}

function tagPlaceObject2(prof, charId, mat) {
  const m = mat || matrice(undefined, 0, 0);
  const corps = Buffer.concat([
    Buffer.from([0x06]),                           // hasChar + hasMatrix
    Buffer.from([prof & 255, prof >> 8, charId & 255, charId >> 8]),
    m,
  ]);
  return Buffer.concat([enteteTag(26, corps.length), corps]);
}

const tagShowFrame = () => Buffer.from([(1 << 6), 0]).slice(0, 2);

/** L'étiquette existe-t-elle déjà quelque part dans le fichier ? */
function aEtiquette(body, nom) {
  const motif = Buffer.from(nom + '\0', 'latin1');
  let vu = false;
  const visiter = (from, to) => {
    let o = from;
    while (o < to - 1 && !vu) {
      const hdr = body.readUInt16LE(o);
      const code = hdr >> 6;
      let len = hdr & 0x3f, h = 2;
      if (len === 0x3f) { len = body.readUInt32LE(o + 2); h = 6; }
      if (code === 0) return;
      if (code === 43 && body.slice(o + h, o + h + len).equals(motif)) vu = true;
      if (code === 39) visiter(o + h + 4, o + h + len);
      o += h + len;
    }
  };
  visiter(debutDesTags(body), body.length);
  return vu;
}

/** Le DefineSprite d'un identifiant : { offset, entete, longueur, finInterne }. */
function trouverSprite(body, id) {
  let trouve = null;
  parcourir(body, (code, o, h, len) => {
    if (code === 39 && body.readUInt16LE(o + h) === id) {
      // La fin interne : l'offset du tag End DANS le sprite.
      let p = o + h + 4;
      while (p < o + h + len - 1) {
        const hdr = body.readUInt16LE(p);
        const c2 = hdr >> 6;
        let l2 = hdr & 0x3f, h2 = 2;
        if (l2 === 0x3f) { l2 = body.readUInt32LE(p + 2); h2 = 6; }
        if (c2 === 0) break;
        p += h2 + l2;
      }
      trouve = { offset: o, entete: h, longueur: len, finInterne: p };
      return false;
    }
  });
  return trouve;
}

/**
 * Insère `noeuds` (tags concaténés, une image de plus) à la FIN d'un sprite,
 * juste avant son End. Corrige le compte d'images du sprite et la longueur du
 * tag. Exige un DefineSprite en forme longue (c'est le cas de nos feuilles).
 */
function grefferDansSprite(body, spriteId, noeuds) {
  const sp = trouverSprite(body, spriteId);
  if (!sp) throw new Error('DefineSprite ' + spriteId + ' introuvable');
  if (sp.entete !== 6) throw new Error('DefineSprite ' + spriteId + ' en forme courte');
  const out = Buffer.concat([
    body.slice(0, sp.finInterne), noeuds, body.slice(sp.finInterne),
  ]);
  out.writeUInt32LE(sp.longueur + noeuds.length, sp.offset + 2);
  const nbImages = out.readUInt16LE(sp.offset + 6 + 2);
  out.writeUInt16LE(nbImages + 1, sp.offset + 6 + 2);
  return out;
}

/** Insère `noeuds` avant le End de la PELLICULE PRINCIPALE (+1 au compte). */
function grefferDansTimeline(body, noeuds) {
  const finO = parcourir(body, null);
  if (finO < 0) throw new Error('tag End introuvable');
  const out = Buffer.concat([body.slice(0, finO), noeuds, body.slice(finO)]);
  const oCompte = debutDesTags(out) - 2;
  out.writeUInt16LE(out.readUInt16LE(oCompte) + 1, oCompte);
  return out;
}

/** Insère des tags de DÉFINITION avant un offset donné (avant l'usage). */
function insererAvant(body, offset, tags) {
  return Buffer.concat([body.slice(0, offset), tags, body.slice(offset)]);
}

module.exports = {
  lireSwf, ecrireSwf, debutDesTags, parcourir, dernierId, aEtiquette,
  trouverSprite, grefferDansSprite, grefferDansTimeline, insererAvant,
  tagBitmap, tagFormeBitmap, tagFrameLabel, tagRemoveObject2, tagPlaceObject2,
  tagShowFrame, matrice, enteteTag,
};
