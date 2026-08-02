// Lecture des sprites d'un SWF : la partie commune aux extracteurs de jeux.
//
// Un SWF est une suite de tags. Ceux qui nous intéressent :
//
//   DefineSprite (39)         un clip, avec sa propre suite de tags et ses images
//   PlaceObject 1/2/3 (4/26/70) pose un caractère à une PROFONDEUR donnée
//   RemoveObject 1/2 (5/28)   vide une profondeur
//   ShowFrame (1)             l'image est complète
//   ExportAssets (56/76)      les noms d'auteur, par lesquels on retrouve un clip
//
// Le point à ne pas manquer : Flash tient une LISTE D'AFFICHAGE indexée par
// profondeur, qu'une image ne fait que MODIFIER. Un clip dont l'image 7 ne
// touche qu'une profondeur garde tout le reste de l'image 6. Ne retenir que les
// placements de l'image courante donne des dessins amputés — un fond commun qui
// disparaît, un vaisseau qui perd ses images intermédiaires.

'use strict';

const fs = require('fs');
const zlib = require('zlib');

function lireSwf(p) {
  const raw = fs.readFileSync(p);
  const sig = raw.slice(0, 3).toString('ascii');
  if (sig !== 'CWS' && sig !== 'FWS') throw new Error('Signature inconnue : ' + sig);
  return sig === 'CWS' ? zlib.inflateSync(raw.slice(8)) : raw.slice(8);
}

const IDENTITE = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

// Composition parent ∘ enfant.
function composer(P, E) {
  return {
    a: P.a * E.a + P.c * E.b,
    b: P.b * E.a + P.d * E.b,
    c: P.a * E.c + P.c * E.d,
    d: P.b * E.c + P.d * E.d,
    e: P.a * E.e + P.c * E.f + P.e,
    f: P.b * E.e + P.d * E.f + P.f,
  };
}

/**
 * Ouvre un SWF et en tire tout ce qu'il faut pour reconstituer ses dessins.
 *
 * @returns {{
 *   b: Buffer, noms: Map<string,number>, parSprite: Map<number,Map<number,Array>>,
 *   estForme: (id:number)=>boolean, estSprite: (id:number)=>boolean,
 *   aplatir: (ch:number, M:object, prof?:number, frame?:number)=>Array,
 *   composer: Function, IDENTITE: object
 * }}
 */
function ouvrir(chemin) {
  const b = lireSwf(chemin);
  const debut = Math.ceil((5 + ((b[0] >> 3) & 0x1f) * 4) / 8) + 4;

  function parcourir(visiter) {
    (function scan(from, to, id) {
      let o = from, frame = 1;
      while (o < to) {
        const hdr = b.readUInt16LE(o), code = hdr >> 6;
        let len = hdr & 0x3f, hs = 2;
        if (len === 0x3f) { len = b.readUInt32LE(o + 2); hs = 6; }
        if (code === 0) break;
        const corps = o + hs;
        if (code === 39) scan(corps + 4, corps + len, b.readUInt16LE(corps));
        visiter(code, corps, len, id, frame);
        if (code === 1) frame++;
        o += hs + len;
      }
    })(debut, b.length, 0);
  }

  // Les noms d'auteur : c'est par eux qu'on trouve un clip.
  const noms = new Map();
  parcourir((code, corps, len) => {
    if (code !== 56 && code !== 76) return;
    let p = corps;
    const n = b.readUInt16LE(p); p += 2;
    for (let i = 0; i < n; i++) {
      const id = b.readUInt16LE(p); p += 2;
      let e = p; while (e < corps + len && b[e] !== 0) e++;
      noms.set(b.slice(p, e).toString('utf8'), id);
      p = e + 1;
    }
  });

  // Nature de chaque caractère : une forme se trace, un sprite se traverse.
  const TYPE = new Map();
  parcourir((code, corps) => {
    if ([2, 22, 32, 83, 39].includes(code)) TYPE.set(b.readUInt16LE(corps), code);
  });
  const estForme = (id) => [2, 22, 32, 83].includes(TYPE.get(id));
  const estSprite = (id) => TYPE.get(id) === 39;

  // Lecture d'une MATRIX (champs non alignés sur l'octet).
  class Bits {
    constructor(o) { this.o = o; this.bit = 0; }
    u(n) {
      let v = 0;
      for (let i = 0; i < n; i++) {
        v = (v << 1) | ((b[this.o] >> (7 - this.bit)) & 1);
        if (++this.bit === 8) { this.bit = 0; this.o++; }
      }
      return v >>> 0;
    }
    s(n) { if (!n) return 0; const v = this.u(n); return (v & (1 << (n - 1))) ? v - (1 << n) : v; }
  }
  function lireMatrice(o) {
    const m = new Bits(o);
    const M = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };   // a b c d e f, comme en SVG
    if (m.u(1)) { const n = m.u(5); M.a = m.s(n) / 65536; M.d = m.s(n) / 65536; }
    if (m.u(1)) { const n = m.u(5); M.b = m.s(n) / 65536; M.c = m.s(n) / 65536; }
    const n = m.u(5); M.e = m.s(n); M.f = m.s(n);       // translation, en twips
    return M;
  }

  // Le contenu image par image de chaque sprite, liste d'affichage tenue à jour.
  const parSprite = new Map();
  {
    const listes = new Map();                          // sprite → profondeur → {ch, M}
    const derniere = new Map();
    const photographier = (id, frame) => {
      const l = listes.get(id);
      if (!l || l.size === 0) return;
      if (!parSprite.has(id)) parSprite.set(id, new Map());
      parSprite.get(id).set(frame, [...l.keys()].sort((x, y) => x - y).map((d) => l.get(d)));
    };
    parcourir((code, corps, len, id, frame) => {
      if (!id) return;
      if (!listes.has(id)) listes.set(id, new Map());
      const l = listes.get(id);
      if (code === 1) { photographier(id, frame); derniere.set(id, frame); return; }
      if (code === 5) { l.delete(b.readUInt16LE(corps + 2)); return; }
      if (code === 28) { l.delete(b.readUInt16LE(corps)); return; }
      let ch = -1, M = IDENTITE, prof = -1;
      if (code === 4) {
        ch = b.readUInt16LE(corps);
        prof = b.readUInt16LE(corps + 2);
        M = lireMatrice(corps + 4);
      } else if (code === 26 || code === 70) {
        const flags = b[corps];
        prof = b.readUInt16LE(corps + 1);
        if (!(flags & 2)) {
          // Simple modification : on garde le caractère en place et on ne
          // remplace que ce que l'étiquette redéfinit.
          const avant = l.get(prof);
          if (!avant) return;
          ch = avant.ch;
          M = (flags & 4) ? lireMatrice(corps + 3) : avant.M;
        } else {
          ch = b.readUInt16LE(corps + 3);
          M = (flags & 4) ? lireMatrice(corps + 5) : IDENTITE;
        }
      }
      if (ch < 0 || prof < 0) return;
      l.set(prof, { ch, M });
    });
    // La dernière image d'un sprite n'est pas toujours suivie d'un ShowFrame.
    for (const [id, l] of listes) {
      if (l.size === 0) continue;
      const f = (derniere.get(id) || 0) + 1;
      if (!parSprite.has(id) || !parSprite.get(id).has(f - 1)) photographier(id, f);
    }
  }

  /**
   * Aplatit un caractère en une liste de formes avec leur matrice absolue.
   *
   * `frame` synchronise les clips imbriqués : quand il est fourni, un enfant qui
   * possède cette image l'utilise plutôt que sa première. C'est nécessaire pour
   * les dessins que le jeu pilote à deux niveaux — le jeton de Minipixiz, dont
   * le corps et le contour sont deux clips que Group.draw envoie sur la MÊME
   * image. Sans ça, tous les contours seraient corrects et tous les corps
   * identiques.
   */
  function aplatir(ch, M, profondeur, frame) {
    profondeur = profondeur || 0;
    if (profondeur > 6) return [];
    if (estForme(ch)) return [{ shape: ch, M }];
    if (!estSprite(ch)) return [];
    const frames = parSprite.get(ch);
    if (!frames) return [];
    let cle;
    if (frame !== undefined && frames.has(frame)) cle = frame;
    else cle = [...frames.keys()].sort((x, y) => x - y)[0];
    const out = [];
    for (const p of (frames.get(cle) || [])) {
      out.push(...aplatir(p.ch, composer(M, p.M), profondeur + 1, frame));
    }
    return out;
  }

  return { b, noms, parSprite, estForme, estSprite, aplatir, composer, IDENTITE, parcourir };
}

module.exports = { ouvrir, lireSwf, composer, IDENTITE };
