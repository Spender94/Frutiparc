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

    return { scene, cadence, formes, sprites, racine, exports };
  }

  const API = { lire, decompresser, CX_NEUTRE, cxNeutre,
    charger: function (url) {
      return fetch(url).then((r) => {
        if (!r.ok) throw new Error('SWF introuvable : ' + url);
        return r.arrayBuffer();
      }).then(decompresser).then(lire);
    } };

  if (typeof module === 'object' && module.exports) module.exports = API;
  else global.FPBouilleSwf = API;
})(typeof window !== 'undefined' ? window : globalThis);
