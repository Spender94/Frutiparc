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
    aligner() { if (this.bit) { this.bit = 0; this.o++; } return this.o; }
  }
  function lireMatriceBits(m) {
    const M = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };   // a b c d e f, comme en SVG
    if (m.u(1)) { const n = m.u(5); M.a = m.s(n) / 65536; M.d = m.s(n) / 65536; }
    if (m.u(1)) { const n = m.u(5); M.b = m.s(n) / 65536; M.c = m.s(n) / 65536; }
    const n = m.u(5); M.e = m.s(n); M.f = m.s(n);       // translation, en twips
    m.aligner();
    return M;
  }
  function lireMatrice(o) { return lireMatriceBits(new Bits(o)); }

  // CXFORMWITHALPHA — on n'en garde rien, mais il faut le TRAVERSER : c'est lui
  // qui sépare la matrice du nom d'instance et de la profondeur de masque.
  function sauterTransfoCouleur(m) {
    const add = m.u(1), mult = m.u(1), n = m.u(4);
    if (mult) { m.s(n); m.s(n); m.s(n); m.s(n); }
    if (add) { m.s(n); m.s(n); m.s(n); m.s(n); }
    m.aligner();
  }

  function lireChaine(o) {
    let e = o; while (e < b.length && b[e] !== 0) e++;
    return { texte: b.slice(o, e).toString('utf8'), fin: e + 1 };
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
      let ch = -1, M = IDENTITE, prof = -1, nom = null, masque = 0;
      if (code === 4) {
        ch = b.readUInt16LE(corps);
        prof = b.readUInt16LE(corps + 2);
        M = lireMatrice(corps + 4);
      } else if (code === 26 || code === 70) {
        // PlaceObject2/3. Les champs se suivent dans l'ordre des drapeaux, et
        // il faut tous les traverser pour atteindre le nom d'instance et la
        // profondeur de masque — deux choses dont on a besoin :
        //
        //   le NOM, parce que le jeu tient ses sous-clips par leur nom
        //     (Mc.setPic colore pic.f.k0, pic.f.o0.p, pic.f.w0…) ;
        //   le MASQUE (ClipDepth), parce qu'un masque est une forme comme une
        //     autre dans le fichier. Sans le repérer, le rectangle rouge qui
        //     découpe le portrait de la fée se dessine PAR-DESSUS le portrait.
        const flags = b[corps];
        let o = corps + 1;
        if (code === 70) o += 1;                       // PlaceObject3 : drapeaux étendus
        prof = b.readUInt16LE(o); o += 2;
        const aCar = !!(flags & 2);
        if (code === 70 && (b[corps + 1] & 0x10)) {    // HasClassName
          o = lireChaine(o).fin;
        }
        if (aCar) { ch = b.readUInt16LE(o); o += 2; }
        const bits = new Bits(o);
        if (flags & 4) M = lireMatriceBits(bits);
        if (flags & 8) sauterTransfoCouleur(bits);
        o = bits.aligner();
        if (flags & 16) o += 2;                        // ratio (morph)
        if (flags & 32) { const r = lireChaine(o); nom = r.texte; o = r.fin; }
        if (flags & 64) { masque = b.readUInt16LE(o); o += 2; }

        if (!aCar) {
          // Simple modification : on garde le caractère en place et on ne
          // remplace que ce que l'étiquette redéfinit.
          const avant = l.get(prof);
          if (!avant) return;
          ch = avant.ch;
          if (!(flags & 4)) M = avant.M;
          if (nom === null) nom = avant.nom;
          if (!masque) masque = avant.masque;
        }
      }
      if (ch < 0 || prof < 0) return;
      l.set(prof, { ch, M, nom: nom || null, masque: masque || 0 });
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
   *
   * Chaque forme rendue porte :
   *   shape   son identifiant
   *   M       sa matrice absolue
   *   chemin  le chemin des clips NOMMÉS qui la contiennent ("f.o0.p"), parce
   *           que le jeu tient ses morceaux par leur nom — Mc.setPic colore
   *           pic.f.k0 d'une couleur, pic.f.o0.p d'une autre, pic.f.w0 d'une
   *           troisième. Sans le chemin, une fée n'aurait qu'une seule teinte.
   *   masque  vrai si la forme sert de DÉCOUPE et non de dessin. Flash range un
   *           masque comme n'importe quelle forme ; la dessiner telle quelle
   *           collait un rectangle rouge en travers du portrait.
   */
  function aplatir(ch, M, profondeur, frame, chemin) {
    profondeur = profondeur || 0;
    chemin = chemin || '';
    if (profondeur > 6) return [];
    if (estForme(ch)) return [{ shape: ch, M, chemin }];
    if (!estSprite(ch)) return [];
    const frames = parSprite.get(ch);
    if (!frames) return [];
    let cle;
    if (frame !== undefined && frames.has(frame)) cle = frame;
    else cle = [...frames.keys()].sort((x, y) => x - y)[0];
    const out = [];
    for (const p of (frames.get(cle) || [])) {
      const sous = p.nom ? (chemin ? chemin + '.' + p.nom : p.nom) : chemin;
      const morceaux = aplatir(p.ch, composer(M, p.M), profondeur + 1, frame, sous);
      if (p.masque) for (const m of morceaux) m.masque = true;
      out.push(...morceaux);
    }
    return out;
  }

  return { b, noms, parSprite, estForme, estSprite, aplatir, composer, IDENTITE, parcourir };
}

module.exports = { ouvrir, lireSwf, composer, IDENTITE };
