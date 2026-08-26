/*
  FPBouilleSwf — lecteur de SWF réduit à ce qu'une frutibouille demande.

  POURQUOI. Une bouille, aujourd'hui, c'est Ruffle : un interpréteur AVM1 complet
  en WebAssembly (plus d'un mégaoctet) pour animer un visage de cent pixels de
  côté. Sur le bureau Frutiz, où le gros main.swf tourne déjà, chaque avatar du
  salon en ajoute une instance. D'où ce lecteur : il ne sait rien faire d'autre
  que des bouilles, et c'est exactement ce qu'il faut.

  CE QU'IL LIT. Les SWF de famille (public/fbouille/famille<N>.swf) ne contiennent
  que du dessin vectoriel et des pellicules :

    DefineShape 1/2/3/4 (2, 22, 32, 83)   les tracés
    DefineSprite (39)                     les clips, avec leur propre pellicule
    PlaceObject 1/2/3 (4, 26, 70)         pose un caractère à une PROFONDEUR
    RemoveObject 1/2 (5, 28)              vide une profondeur
    ShowFrame (1)                         l'image est complète
    FrameLabel (43)                       l'étiquette d'une image
    DoAction (12)                         le script d'une image
    ExportAssets (56/76)                  les noms d'auteur

  Aucune image matricielle, aucun son, aucune police : rien que des formes. Les
  deux DefineMorphShape de famille0 ne sont pas atteints par le visage.

  CE QU'IL NE FAIT PAS. Il ne dessine pas et n'exécute rien : il rend une
  structure. C'est bouille-moteur.js qui pose le SVG et bouille-avm.js qui joue
  les scripts d'image.

  LES COORDONNÉES. Le fichier parle en TWIPS (1/20 de pixel) ; on sort en PIXELS,
  comme le reste du parc (scripts/extract-swf-shapes.js suit la même règle). La
  scène d'une famille fait 100 × 100 pixels, à 40 images par seconde.
*/
(function (global) {
  'use strict';

  // ── Décompression ────────────────────────────────────────────────────────
  //
  // Un SWF « CWS » est un en-tête de huit octets suivi du corps compressé au
  // format zlib. Le navigateur sait le faire depuis DecompressionStream('deflate')
  // — 'deflate' désigne bien l'enveloppe zlib, 'deflate-raw' le flux nu.
  function decompresser(buf) {
    const u8 = new Uint8Array(buf);
    const sig = String.fromCharCode(u8[0], u8[1], u8[2]);
    if (sig === 'FWS') return Promise.resolve(u8.subarray(8));
    if (sig !== 'CWS') return Promise.reject(new Error('signature inconnue : ' + sig));
    const charge = u8.subarray(8);
    if (typeof global.DecompressionStream === 'function') {
      const flux = new global.DecompressionStream('deflate');
      const w = flux.writable.getWriter();
      w.write(charge); w.close();
      return new Response(flux.readable).arrayBuffer().then((a) => new Uint8Array(a));
    }
    // Node (tests, outillage) : zlib fait l'affaire.
    if (typeof require === 'function') {
      const zlib = require('zlib');
      return Promise.resolve(new Uint8Array(zlib.inflateSync(Buffer.from(charge))));
    }
    return Promise.reject(new Error('pas de décompresseur disponible'));
  }

  // ── Lecture binaire ──────────────────────────────────────────────────────
  function Bits(b, o) { this.b = b; this.o = o; this.bit = 0; }
  Bits.prototype.u = function (n) {
    let v = 0;
    for (let i = 0; i < n; i++) {
      v = (v << 1) | ((this.b[this.o] >> (7 - this.bit)) & 1);
      if (++this.bit === 8) { this.bit = 0; this.o++; }
    }
    return v >>> 0;
  };
  Bits.prototype.s = function (n) {
    if (!n) return 0;
    const v = this.u(n);
    return (v & (1 << (n - 1))) ? v - (1 << n) : v;
  };
  Bits.prototype.aligner = function () { if (this.bit) { this.bit = 0; this.o++; } return this.o; };
  Bits.prototype.u8 = function () { return this.b[this.o++]; };
  Bits.prototype.u16 = function () { const v = this.b[this.o] | (this.b[this.o + 1] << 8); this.o += 2; return v; };
  Bits.prototype.u32 = function () {
    const v = (this.b[this.o] | (this.b[this.o + 1] << 8) | (this.b[this.o + 2] << 16)
      | (this.b[this.o + 3] << 24)) >>> 0;
    this.o += 4; return v;
  };
  Bits.prototype.rect = function () {
    const n = this.u(5);
    const r = { x0: this.s(n), x1: this.s(n), y0: this.s(n), y1: this.s(n) };
    this.aligner();
    return r;
  };
  Bits.prototype.matriceT = function () {          // matrice en TWIPS
    const M = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    if (this.u(1)) { const n = this.u(5); M.a = this.s(n) / 65536; M.d = this.s(n) / 65536; }
    if (this.u(1)) { const n = this.u(5); M.b = this.s(n) / 65536; M.c = this.s(n) / 65536; }
    const n = this.u(5); M.e = this.s(n); M.f = this.s(n);
    this.aligner();
    return M;
  };
  Bits.prototype.rgba = function () {
    const c = { r: this.b[this.o], v: this.b[this.o + 1], b: this.b[this.o + 2], a: this.b[this.o + 3] };
    this.o += 4;
    return c;
  };

  const u16 = (b, o) => b[o] | (b[o + 1] << 8);
  const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  const hex = (r, v, bl) => '#' + ((1 << 24) | (r << 16) | (v << 8) | bl).toString(16).slice(1);

  function lireRect(b, o) {
    const r = new Bits(b, o), n = r.u(5);
    const v = [r.s(n), r.s(n), r.s(n), r.s(n)];
    r.aligner();
    return { v, fin: r.o };
  }

  function lireChaine(b, o) {
    let e = o;
    while (b[e]) e++;
    let s = '';
    for (let i = o; i < e; i++) s += String.fromCharCode(b[i]);
    // Les noms d'instance du parc sont en ASCII ; decodeURIComponent remet les
    // accents d'un éventuel UTF-8 sans casser le cas courant.
    try { s = decodeURIComponent(escape(s)); } catch (err) { /* déjà lisible */ }
    return { texte: s, fin: e + 1 };
  }

  function lireMatrice(bits) {
    const M = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    if (bits.u(1)) { const n = bits.u(5); M.a = bits.s(n) / 65536; M.d = bits.s(n) / 65536; }
    if (bits.u(1)) { const n = bits.u(5); M.b = bits.s(n) / 65536; M.c = bits.s(n) / 65536; }
    const n = bits.u(5);
    M.e = bits.s(n) / 20; M.f = bits.s(n) / 20;      // twips → pixels
    bits.aligner();
    return M;
  }

  // CXFORMWITHALPHA : sortie = source × mult / 256 + add.
  const CX_NEUTRE = { mr: 256, mv: 256, mb: 256, ma: 256, ar: 0, av: 0, ab: 0, aa: 0 };
  function lireTransfoCouleur(bits, avecAlpha) {
    const add = bits.u(1), mult = bits.u(1), n = bits.u(4);
    const c = { mr: 256, mv: 256, mb: 256, ma: 256, ar: 0, av: 0, ab: 0, aa: 0 };
    if (mult) { c.mr = bits.s(n); c.mv = bits.s(n); c.mb = bits.s(n); if (avecAlpha) c.ma = bits.s(n); }
    if (add) { c.ar = bits.s(n); c.av = bits.s(n); c.ab = bits.s(n); if (avecAlpha) c.aa = bits.s(n); }
    bits.aligner();
    return c;
  }
  const cxNeutre = (c) => !c || (c.mr === 256 && c.mv === 256 && c.mb === 256
    && c.ma === 256 && !c.ar && !c.av && !c.ab && !c.aa);

  // ── Styles d'une forme ───────────────────────────────────────────────────
  function lireStyles(b, o, alpha, shape4) {
    const remplissages = [];
    let n = b[o]; o += 1;
    if (n === 0xff) { n = u16(b, o); o += 2; }
    for (let i = 0; i < n; i++) {
      const t = b[o];
      if (t === 0x00) {
        remplissages.push({ couleur: hex(b[o + 1], b[o + 2], b[o + 3]),
          rgb: [b[o + 1], b[o + 2], b[o + 3]], alpha: alpha ? b[o + 4] / 255 : 1 });
        o += alpha ? 5 : 4;
      } else if (t === 0x10 || t === 0x12 || t === 0x13) {
        const m = new Bits(b, o + 1);
        const M = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
        if (m.u(1)) { const nb = m.u(5); M.a = m.s(nb) / 65536; M.d = m.s(nb) / 65536; }
        if (m.u(1)) { const nb = m.u(5); M.b = m.s(nb) / 65536; M.c = m.s(nb) / 65536; }
        const nb = m.u(5); M.e = m.s(nb); M.f = m.s(nb); m.aligner();
        let q = m.o, focale = 0;
        if (t === 0x13) { focale = (u16(b, q) << 16 >> 16) / 256; q += 2; }
        const etalement = b[q] >> 6, interpolation = (b[q] >> 4) & 3, nArrets = b[q] & 0x0f; q += 1;
        const arrets = [];
        for (let k = 0; k < nArrets; k++) {
          arrets.push({ ratio: b[q], rgb: [b[q + 1], b[q + 2], b[q + 3]],
            couleur: hex(b[q + 1], b[q + 2], b[q + 3]), alpha: alpha ? b[q + 4] / 255 : 1 });
          q += alpha ? 5 : 4;
        }
        remplissages.push({ degrade: { radial: t !== 0x10, focale, etalement, interpolation, M, arrets } });
        o = q;
      } else if (t >= 0x40 && t <= 0x43) {
        // Aucun remplissage par image dans les familles : on garde la place
        // pour ne pas dérailler si une famille exotique en portait un.
        const m = new Bits(b, o + 3);
        if (m.u(1)) { const nb = m.u(5); m.s(nb); m.s(nb); }
        if (m.u(1)) { const nb = m.u(5); m.s(nb); m.s(nb); }
        const nb = m.u(5); m.s(nb); m.s(nb); m.aligner();
        remplissages.push({ bitmap: u16(b, o + 1) });
        o = m.o;
      } else throw new Error('remplissage inconnu 0x' + t.toString(16));
    }
    const traits = [];
    let ln = b[o]; o += 1;
    if (ln === 0xff) { ln = u16(b, o); o += 2; }
    for (let i = 0; i < ln; i++) {
      if (shape4) {
        const drapeaux = u16(b, o + 2);
        let q = o + 4;
        if (((drapeaux >> 4) & 0x03) === 2) q += 2;      // joint mitre
        traits.push({ largeur: u16(b, o) / 20, couleur: hex(b[q], b[q + 1], b[q + 2]),
          rgb: [b[q], b[q + 1], b[q + 2]], alpha: b[q + 3] / 255 });
        o = q + 4;
      } else {
        traits.push({ largeur: u16(b, o) / 20, couleur: hex(b[o + 2], b[o + 3], b[o + 4]),
          rgb: [b[o + 2], b[o + 3], b[o + 4]], alpha: alpha ? b[o + 5] / 255 : 1 });
        o += alpha ? 6 : 5;
      }
    }
    return { remplissages, traits, fin: o };
  }

  // ── SHAPERECORDs → arêtes ────────────────────────────────────────────────
  //
  // Le format ne décrit pas des contours fermés mais un trait continu qui dit,
  // à chaque instant, quel remplissage se trouve de chaque côté. Recoller les
  // surfaces est le travail d'`assembler`.
  function lireArêtes(b, o, alpha, shape4, tableaux) {
    const r = new Bits(b, o);
    let nFill = r.u(4), nLine = r.u(4);
    let ti = 0, x = 0, y = 0, f0 = 0, f1 = 0, ls = 0;
    const aretes = [];
    for (;;) {
      if (r.u(1) === 0) {
        const nouveaux = r.u(1), trait = r.u(1), fill1 = r.u(1), fill0 = r.u(1), bouge = r.u(1);
        if (!nouveaux && !trait && !fill1 && !fill0 && !bouge) break;
        if (bouge) { const nb = r.u(5); x = r.s(nb); y = r.s(nb); }
        if (fill0) f0 = r.u(nFill);
        if (fill1) f1 = r.u(nFill);
        if (trait) ls = r.u(nLine);
        if (nouveaux) {
          r.aligner();
          const st = lireStyles(b, r.o, alpha, shape4);
          tableaux.push(st);
          ti = tableaux.length - 1;
          f0 = 0; f1 = 0; ls = 0;
          const suite = new Bits(b, st.fin);
          nFill = suite.u(4); nLine = suite.u(4);
          r.o = suite.o; r.bit = suite.bit;
        }
      } else if (r.u(1) === 1) {
        const nb = r.u(4) + 2;
        let dx = 0, dy = 0;
        if (r.u(1)) { dx = r.s(nb); dy = r.s(nb); }
        else if (r.u(1)) { dy = r.s(nb); }
        else { dx = r.s(nb); }
        aretes.push({ ti, f0, f1, ls, x0: x, y0: y, x1: x + dx, y1: y + dy, cx: null, cy: null });
        x += dx; y += dy;
      } else {
        const nb = r.u(4) + 2;
        const cx = x + r.s(nb), cy = y + r.s(nb);
        const x2 = cx + r.s(nb), y2 = cy + r.s(nb);
        aretes.push({ ti, f0, f1, ls, x0: x, y0: y, x1: x2, y1: y2, cx, cy });
        x = x2; y = y2;
      }
    }
    return aretes;
  }

  // Recolle des arêtes en contours : partir d'une arête, chercher celle qui
  // commence là où la précédente finit. Fermer chaque tronçon isolément
  // découperait une surface en éclats.
  function assembler(aretes) {
    const cle = (x, y) => x + ',' + y;
    const parDebut = new Map();
    for (const a of aretes) {
      const k = cle(a.x0, a.y0);
      if (!parDebut.has(k)) parDebut.set(k, []);
      parDebut.get(k).push(a);
    }
    const contours = [];
    const restantes = new Set(aretes);
    for (const depart of aretes) {
      if (!restantes.has(depart)) continue;
      const contour = [];
      let a = depart;
      for (;;) {
        restantes.delete(a);
        contour.push(a);
        const suite = (parDebut.get(cle(a.x1, a.y1)) || []).find((c) => restantes.has(c));
        if (!suite) break;
        a = suite;
        if (a === depart) break;
      }
      contours.push(contour);
    }
    return contours;
  }

  const PX = (v) => Math.round(v / 20 * 100) / 100;
  function tracer(contour, ferme) {
    const a0 = contour[0];
    let d = 'M' + PX(a0.x0) + ' ' + PX(a0.y0);
    for (const a of contour) {
      d += a.cx === null ? 'L' + PX(a.x1) + ' ' + PX(a.y1)
        : 'Q' + PX(a.cx) + ' ' + PX(a.cy) + ' ' + PX(a.x1) + ' ' + PX(a.y1);
    }
    return d + (ferme ? 'Z' : '');
  }
  const retourner = (a) => ({ ti: a.ti, f0: a.f0, f1: a.f1, ls: a.ls,
    x0: a.x1, y0: a.y1, x1: a.x0, y1: a.y0, cx: a.cx, cy: a.cy });

  // « 1:3 » → tableau 1, style 3. Ce tri restitue l'ordre de peinture.
  const cleTriee = (a, b) => {
    const pa = a.split(':'), pb = b.split(':');
    return (+pa[0]) - (+pb[0]) || (+pa[1]) - (+pb[1]);
  };

  // Une forme lue → { bounds, couches: [ … ] }, chaque couche portant SA
  // couleur d'origine. Le moteur en a besoin : la teinte d'époque n'est pas un
  // aplat mais un DÉCALAGE ajouté à la couleur source (cf. bouille-moteur.js).
  function lireForme(b, corps, code) {
    const alpha = code === 32 || code === 83;
    const shape4 = code === 83;
    let o = corps;
    const id = u16(b, o); o += 2;
    const rc = lireRect(b, o); o = rc.fin;
    if (shape4) { o = lireRect(b, o).fin; o += 1; }
    const tableaux = [lireStyles(b, o, alpha, shape4)];
    const aretes = lireArêtes(b, tableaux[0].fin, alpha, shape4, tableaux);

    const parFill = new Map(), parTrait = new Map();
    const ranger = (carte, k, a) => { if (!carte.has(k)) carte.set(k, []); carte.get(k).push(a); };
    for (const a of aretes) {
      if (a.f1) ranger(parFill, a.ti + ':' + a.f1, a);
      if (a.f0) ranger(parFill, a.ti + ':' + a.f0, retourner(a));
      if (a.ls) ranger(parTrait, a.ti + ':' + a.ls, a);
    }

    const couches = [];
    const clefs = Array.from(parFill.keys()).sort(cleTriee);
    for (const k of clefs) {
      const p = k.split(':');
      const st = (tableaux[+p[0]] || { remplissages: [] }).remplissages[(+p[1]) - 1];
      if (!st) continue;
      const d = assembler(parFill.get(k)).map((c) => tracer(c, true)).join('');
      if (!d) continue;
      couches.push({ d, rgb: st.rgb || null, alpha: st.alpha === undefined ? 1 : st.alpha,
        degrade: st.degrade || null, trait: false });
    }
    const clefsT = Array.from(parTrait.keys()).sort(cleTriee);
    for (const k of clefsT) {
      const p = k.split(':');
      const st = (tableaux[+p[0]] || { traits: [] }).traits[(+p[1]) - 1];
      if (!st) continue;
      const d = assembler(parTrait.get(k)).map((c) => tracer(c, false)).join('');
      if (!d) continue;
      couches.push({ d, rgb: st.rgb, alpha: st.alpha === undefined ? 1 : st.alpha,
        largeur: st.largeur, trait: true });
    }
    const v = rc.v;
    return { id, bounds: { x: v[0] / 20, y: v[2] / 20, w: (v[1] - v[0]) / 20, h: (v[3] - v[2]) / 20 }, couches };
  }

  // ── Les formes INTERPOLÉES (DefineMorphShape 45 / MorphShape2 46) ────────
  //
  // Un morph n'est pas un dessin mais DEUX, plus la promesse que le lecteur sait
  // passer de l'un à l'autre : le fichier range la forme de départ, celle
  // d'arrivée et deux jeux de styles, et le TAUX de mélange arrive au moment du
  // placement (le champ `ratio` de PlaceObject2, de 0 à 65535).
  //
  // Sur une bouille, c'est le FARD de « rougir » : deux morphs, posés à la
  // profondeur 10 du visage entre les images 51 et 65, dont le taux monte au fil
  // des images. Sans les lire, la bouille rougit… sans rougir.
  function lireStylesMorph(r) {
    let n = r.u8();
    if (n === 0xff) n = r.u16();
    const l = [];
    for (let i = 0; i < n; i++) {
      const type = r.u8();
      if (type === 0x00) {
        l.push({ type, c0: r.rgba(), c1: r.rgba() });
      } else if (type === 0x10 || type === 0x12 || type === 0x13) {
        const m0 = r.matriceT(), m1 = r.matriceT();
        const nb = r.u8();
        const arrets = [];
        for (let k = 0; k < nb; k++) arrets.push({ t0: r.u8(), c0: r.rgba(), t1: r.u8(), c1: r.rgba() });
        const st = { type, m0, m1, arrets };
        if (type === 0x13) { st.focal0 = r.u16(); st.focal1 = r.u16(); }
        l.push(st);
      } else {
        l.push({ type, bitmap: r.u16(), m0: r.matriceT(), m1: r.matriceT() });
      }
    }
    return l;
  }
  function lireTraitsMorph(r, v2) {
    let n = r.u8();
    if (n === 0xff) n = r.u16();
    const l = [];
    for (let i = 0; i < n; i++) {
      const t = { w0: r.u16(), w1: r.u16() };
      if (v2) {
        const drapeaux = r.u16();
        const aRemplissage = (drapeaux >> 3) & 1;
        r.u8();
        if (((drapeaux >> 8) & 3) === 2) r.u16();
        if (aRemplissage) { t.remplissage = true; lireStylesMorph(r); }
        else { t.c0 = r.rgba(); t.c1 = r.rgba(); }
      } else { t.c0 = r.rgba(); t.c1 = r.rgba(); }
      l.push(t);
    }
    return l;
  }
  function lireAretesMorph(r) {
    let nb = r.u8();
    let nFillBits = nb >> 4, nLineBits = nb & 15;
    const out = [];
    let x = 0, y = 0;
    for (;;) {
      if (r.u(1)) {
        const droite = r.u(1);
        const nbits = r.u(4) + 2;
        if (droite) {
          let dx = 0, dy = 0;
          if (r.u(1)) { dx = r.s(nbits); dy = r.s(nbits); }
          else if (r.u(1)) dy = r.s(nbits);
          else dx = r.s(nbits);
          x += dx; y += dy;
          out.push({ type: 'ligne', x, y });
        } else {
          const cx = x + r.s(nbits), cy = y + r.s(nbits);
          x = cx + r.s(nbits); y = cy + r.s(nbits);
          out.push({ type: 'courbe', cx, cy, x, y });
        }
      } else {
        const drapeaux = r.u(5);
        if (drapeaux === 0) break;
        if (drapeaux & 1) { const n = r.u(5); x = r.s(n); y = r.s(n); out.push({ type: 'move', x, y }); }
        if (drapeaux & 2) out.push({ type: 'fill0', style: r.u(nFillBits) });
        if (drapeaux & 4) out.push({ type: 'fill1', style: r.u(nFillBits) });
        if (drapeaux & 8) out.push({ type: 'trait', style: r.u(nLineBits) });
        if (drapeaux & 16) {
          r.aligner();
          lireStylesMorph(r); lireTraitsMorph(r, false);
          const z = r.u8(); nFillBits = z >> 4; nLineBits = z & 15;
        }
      }
    }
    r.aligner();
    return out;
  }
  function lireMorph(b, corps, len, code) {
    // La spécification donne quatre rectangles à DefineMorphShape2 et deux à
    // DefineMorphShape, mais tous les ateliers ne l'ont pas suivie. Plutôt que
    // de croire l'étiquette, on essaie les deux dispositions et l'on garde celle
    // dont le champ Offset tombe dans le tag.
    const essayer = (quatre) => {
      const r = new Bits(b, corps);
      const id = r.u16();
      r.rect(); r.rect();
      if (quatre) { r.rect(); r.rect(); r.u8(); }
      const off = r.u32();
      return { r, id, off, apres: r.o, quatre, ok: off > 0 && off < len };
    };
    let t = essayer(code === 46);
    if (!t.ok) t = essayer(code !== 46);
    if (!t.ok) return null;
    const rb = new Bits(b, corps);
    rb.u16();
    const bd0 = rb.rect(), bd1 = rb.rect();
    const styles = lireStylesMorph(t.r);
    const traits = lireTraitsMorph(t.r, code === 46 && t.quatre);
    const a = lireAretesMorph(t.r);
    t.r.o = t.apres + t.off; t.r.bit = 0;
    const fin = lireAretesMorph(t.r);        // l'arrivée : la géométrie seule
    return { id: t.id, bounds: [bd0, bd1], styles, traits, debut: a, fin };
  }

  const mel = (a, b, t) => a + (b - a) * t;
  /** Un morph au taux `t` (0 = début, 1 = fin), au FORMAT DES FORMES. */
  function interpolerMorph(m, t) {
    const geoB = m.fin.filter((e) => e.type !== 'fill0' && e.type !== 'fill1' && e.type !== 'trait');
    let iB = 0;
    const point = (e) => {
      const f = geoB[iB++];
      if (!f || f.type !== e.type) return e;
      const p = { type: e.type, x: mel(e.x, f.x, t), y: mel(e.y, f.y, t) };
      if (e.type === 'courbe') { p.cx = mel(e.cx, f.cx, t); p.cy = mel(e.cy, f.cy, t); }
      return p;
    };
    const chemins = new Map();
    let style = 0, d = '', ouvert = false, cx = 0, cy = 0;
    const finir = () => {
      if (ouvert && d && style > 0) {
        if (!chemins.has(style)) chemins.set(style, '');
        chemins.set(style, chemins.get(style) + d + 'Z');
      }
      d = '';
    };
    for (const e of m.debut) {
      if (e.type === 'fill1' || e.type === 'fill0') {
        finir(); style = e.style; ouvert = true;
        d = 'M' + PX(cx) + ' ' + PX(cy);
        continue;
      }
      if (e.type === 'trait') continue;
      const p = point(e);
      cx = p.x; cy = p.y;
      if (p.type === 'move') { finir(); d = 'M' + PX(p.x) + ' ' + PX(p.y); ouvert = true; }
      else if (p.type === 'ligne') d += 'L' + PX(p.x) + ' ' + PX(p.y);
      else d += 'Q' + PX(p.cx) + ' ' + PX(p.cy) + ' ' + PX(p.x) + ' ' + PX(p.y);
    }
    finir();
    const couches = [];
    for (const [num, chemin] of chemins) {
      const st = m.styles[num - 1];
      if (!st) continue;
      if (st.type === 0x00) {
        couches.push({ d: chemin, rgb: [Math.round(mel(st.c0.r, st.c1.r, t)),
          Math.round(mel(st.c0.v, st.c1.v, t)), Math.round(mel(st.c0.b, st.c1.b, t))],
          alpha: mel(st.c0.a, st.c1.a, t) / 255, trait: false });
      } else if (st.type === 0x10 || st.type === 0x12 || st.type === 0x13) {
        const M = { a: mel(st.m0.a, st.m1.a, t), b: mel(st.m0.b, st.m1.b, t),
          c: mel(st.m0.c, st.m1.c, t), d: mel(st.m0.d, st.m1.d, t),
          e: mel(st.m0.e, st.m1.e, t), f: mel(st.m0.f, st.m1.f, t) };
        const arrets = st.arrets.map((s) => ({
          ratio: Math.round(mel(s.t0, s.t1, t)),
          rgb: [Math.round(mel(s.c0.r, s.c1.r, t)), Math.round(mel(s.c0.v, s.c1.v, t)),
            Math.round(mel(s.c0.b, s.c1.b, t))],
          alpha: mel(s.c0.a, s.c1.a, t) / 255,
        }));
        couches.push({ d: chemin, rgb: [0, 0, 0], alpha: 1, trait: false,
          degrade: { radial: st.type !== 0x10, focale: 0, etalement: 0, interpolation: 0, M, arrets } });
      }
    }
    const bd = {
      x: mel(m.bounds[0].x0, m.bounds[1].x0, t) / 20,
      y: mel(m.bounds[0].y0, m.bounds[1].y0, t) / 20,
      w: (mel(m.bounds[0].x1, m.bounds[1].x1, t) - mel(m.bounds[0].x0, m.bounds[1].x0, t)) / 20,
      h: (mel(m.bounds[0].y1, m.bounds[1].y1, t) - mel(m.bounds[0].y0, m.bounds[1].y0, t)) / 20,
    };
    return { id: m.id, bounds: bd, couches };
  }

  // ── Le fichier entier ────────────────────────────────────────────────────
  //
  // Les pellicules sortent image par image, sous forme d'ORDRES : c'est bien
  // ainsi que Flash procède — une image ne fait que modifier une liste
  // d'affichage que l'image précédente laisse en place.
  function lire(u8) {
    const b = u8;
    const rc = lireRect(b, 0);
    const scene = { x: rc.v[0] / 20, y: rc.v[2] / 20,
      w: (rc.v[1] - rc.v[0]) / 20, h: (rc.v[3] - rc.v[2]) / 20 };
    const cadence = u16(b, rc.fin) / 256;
    const debut = rc.fin + 4;

    const formes = new Map();
    const morphs = new Map();           // id → forme interpolable
    const sprites = new Map();          // id → { n, labels, images: [ordres] }
    const exports = new Map();
    const racine = { n: 0, labels: {}, images: [] };

    function pellicule(id) {
      if (id === 0) return racine;
      if (!sprites.has(id)) sprites.set(id, { n: 0, labels: {}, images: [] });
      return sprites.get(id);
    }
    function ordres(id, frame) {
      const p = pellicule(id);
      while (p.images.length < frame) p.images.push([]);
      return p.images[frame - 1];
    }

    (function scan(from, to, id) {
      let o = from, frame = 1;
      while (o < to) {
        const hdr = u16(b, o), code = hdr >> 6;
        let len = hdr & 0x3f, hs = 2;
        if (len === 0x3f) { len = u32(b, o + 2); hs = 6; }
        if (code === 0) break;
        const corps = o + hs;

        if (code === 2 || code === 22 || code === 32 || code === 83) {
          const f = lireForme(b, corps, code);
          formes.set(f.id, f);
        } else if (code === 45 || code === 46) {
          // Un morph illisible ne doit pas arrêter la lecture du fichier.
          try { const m = lireMorph(b, corps, len, code); if (m) morphs.set(m.id, m); } catch (e) { /* passé */ }
        } else if (code === 39) {
          const sid = u16(b, corps);
          const p = pellicule(sid);
          p.n = u16(b, corps + 2);
          scan(corps + 4, corps + len, sid);
        } else if (code === 56 || code === 76) {
          let p = corps;
          const n = u16(b, p); p += 2;
          for (let i = 0; i < n; i++) {
            const cid = u16(b, p); p += 2;
            const r = lireChaine(b, p);
            exports.set(r.texte, cid);
            p = r.fin;
          }
        } else if (code === 43) {
          pellicule(id).labels[lireChaine(b, corps).texte] = frame;
        } else if (code === 12) {
          ordres(id, frame).push({ t: 'script', code: b.subarray(corps, corps + len) });
        } else if (code === 5) {
          ordres(id, frame).push({ t: 'retire', prof: u16(b, corps + 2) });
        } else if (code === 28) {
          ordres(id, frame).push({ t: 'retire', prof: u16(b, corps) });
        } else if (code === 4) {
          ordres(id, frame).push({ t: 'pose', ch: u16(b, corps), prof: u16(b, corps + 2),
            M: lireMatrice(new Bits(b, corps + 4)), nom: null, masque: 0, cx: null, deplace: false });
        } else if (code === 26 || code === 70) {
          const drapeaux = b[corps];
          let p = corps + 1;
          if (code === 70) p += 1;
          const prof = u16(b, p); p += 2;
          const aCar = !!(drapeaux & 2);
          if (code === 70 && (b[corps + 1] & 0x10)) p = lireChaine(b, p).fin;
          let ch = -1;
          if (aCar) { ch = u16(b, p); p += 2; }
          const bits = new Bits(b, p);
          const M = (drapeaux & 4) ? lireMatrice(bits) : null;
          const cx = (drapeaux & 8) ? lireTransfoCouleur(bits, true) : null;
          p = bits.aligner();
          let ratio = null;
          if (drapeaux & 16) { ratio = u16(b, p); p += 2; }
          let nom = null;
          if (drapeaux & 32) { const r = lireChaine(b, p); nom = r.texte; p = r.fin; }
          let masque = 0;
          if (drapeaux & 64) { masque = u16(b, p); p += 2; }
          ordres(id, frame).push({ t: 'pose', ch, prof, M, nom, masque,
            cx: cxNeutre(cx) ? null : cx, ratio, deplace: !!(drapeaux & 1) });
        } else if (code === 1) {
          ordres(id, frame);           // garantit l'existence de l'image
          frame++;
        }
        o += hs + len;
      }
      const p = pellicule(id);
      while (p.images.length < Math.max(p.n, frame - 1)) p.images.push([]);
      if (!p.n) p.n = p.images.length;
    })(debut, b.length, 0);

    return { scene, cadence, formes, morphs, sprites, racine, exports };
  }

  const API = { lire, decompresser, interpolerMorph, CX_NEUTRE, cxNeutre,
    charger: function (url) {
      return fetch(url).then((r) => {
        if (!r.ok) throw new Error('SWF introuvable : ' + url);
        return r.arrayBuffer();
      }).then(decompresser).then(lire);
    } };

  if (typeof module === 'object' && module.exports) module.exports = API;
  else global.FPBouilleSwf = API;
})(typeof window !== 'undefined' ? window : globalThis);
