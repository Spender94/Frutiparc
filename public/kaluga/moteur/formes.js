/*
 * Kaluga — le rendu des DESSINS extraits du SWF (scripts/extract-kaluga.js,
 * format de scripts/lib/swf-formes.js) sur un canvas.
 *
 * Un dessin est une liste de tracés : chacun est un chemin SVG (repris tel
 * quel par Path2D) avec un remplissage — couleur, dégradé, image — ou un
 * trait. On ne rasterise rien d'avance : la tzongre tourne, les pommes
 * grossissent avec leur poids, les panneaux glissent, et tout reste net à
 * toute échelle, comme dans le lecteur Flash.
 *
 * Trois points de fidélité :
 *
 *   · les DÉGRADÉS de Flash vivent dans un carré de 32768 twips (819,2 px)
 *     centré sur l'origine, qu'une matrice envoie dans la forme. Le canvas
 *     ne sait pas transformer un dégradé, mais il sait transformer un
 *     CHEMIN : on pose la matrice du dégradé comme transformation courante,
 *     on remplit le chemin ramené par la matrice inverse — le résultat est
 *     exactement le dégradé de Flash, ellipses et obliques comprises ;
 *   · les TRAITS ne descendent jamais sous un pixel d'écran, quelle que soit
 *     l'échelle (la règle du lecteur) ;
 *   · les IMAGES des remplissages (les bandes d'herbe, le tronc du grand
 *     arbre, les portraits) sont des motifs (createPattern) posés par la
 *     matrice du remplissage — celle du fichier, pixels d'image vers twips.
 */
'use strict';

(function (racine) {

const K = racine.KalugaMoteur = racine.KalugaMoteur || {};

const RAYON_DEGRADE = 819.2;      // 16384 twips

// La couleur CSS d'un [r, g, b] hexa + alpha.
function rgba(hex, a) {
  if (a === undefined || a >= 1) return hex;
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}
K.rgba = rgba;

// Un dégradé Flash, dans SON repère (le carré de 819,2 px).
function creerDegrade(ctx, g) {
  let deg;
  if (g.r) {
    const fx = (g.fo || 0) * RAYON_DEGRADE;
    deg = ctx.createRadialGradient(fx, 0, 0, 0, 0, RAYON_DEGRADE);
  } else {
    deg = ctx.createLinearGradient(-RAYON_DEGRADE, 0, RAYON_DEGRADE, 0);
  }
  for (const [pos, coul, alpha] of g.st) deg.addColorStop(Math.min(1, Math.max(0, pos)), rgba(coul, alpha));
  return deg;
}

function inverse(m) {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (!det) return null;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

/*
 * LES ARÊTES PARTAGÉES.
 *
 * Une forme du SWF est une soupe d'ARÊTES : chacune sait quel remplissage
 * elle a à sa gauche et lequel à sa droite. L'extracteur range une arête dans
 * le tracé du remplissage de droite telle quelle, et dans celui de gauche à
 * l'envers — si bien qu'une arête INTÉRIEURE (du décor contre l'herbe, du
 * pare-brise contre la carrosserie) se retrouve dans DEUX tracés, aux mêmes
 * coordonnées, tandis qu'une arête de SILHOUETTE n'apparaît qu'une fois.
 *
 * On relit donc les chemins pour recompter les arêtes : celles vues deux fois
 * sont les coutures, et elles seules ont besoin du débord (voir `deborder`).
 * La silhouette, elle, garde le bord lissé que Flash lui donne.
 */
const RE_CMD = /([MLQZ])([^MLQZ]*)/g;

// Les segments d'un chemin, dans l'ordre : [x0, y0, cx|null, cy, x1, y1].
// Le `Z` ne donne PAS de segment : l'extracteur écrit chaque arête du contour
// et n'ajoute le `Z` que par convention. Un contour resté ouvert (une soupe
// d'arêtes mal recollée) ne doit pas se voir prêter une arête inventée.
function segmentsDe(d) {
  const out = [];
  let x = 0, y = 0, sx = 0, sy = 0, m;
  RE_CMD.lastIndex = 0;
  while ((m = RE_CMD.exec(d))) {
    const t = m[2].trim();
    const v = t ? t.split(' ').map(Number) : [];
    if (m[1] === 'M') { x = sx = v[0]; y = sy = v[1]; }
    else if (m[1] === 'L') { out.push([x, y, null, null, v[0], v[1]]); x = v[0]; y = v[1]; }
    else if (m[1] === 'Q') { out.push([x, y, v[0], v[1], v[2], v[3]]); x = v[2]; y = v[3]; }
    else { x = sx; y = sy; }
  }
  return out;
}

// La clé d'un segment, indifférente au sens de parcours. Le préfixe isole les
// tracés posés par leur propre matrice (deux « o » d'un même texte figé ont le
// même chemin et ne sont pourtant pas voisins).
function cleSegment(s, prefixe) {
  const a = s[0] + ',' + s[1], b = s[4] + ',' + s[5];
  const c = s[2] === null ? '' : s[2] + ',' + s[3];
  return prefixe + (a < b ? a + '|' + b : b + '|' + a) + '|' + c;
}

const versChemin = (s) => (s[2] === null ? 'L' + s[4] + ' ' + s[5] : 'Q' + s[2] + ' ' + s[3] + ' ' + s[4] + ' ' + s[5]);

/**
 * Pour chaque tracé d'un dessin, le chemin des seules arêtes qu'il PARTAGE
 * avec un autre remplissage du même dessin, recollées en polylignes — ou
 * `null` s'il n'en a aucune (un trait, ou un dessin sans couture).
 */
function cheminsDebord(ops) {
  const compte = new Map();
  const releve = [];
  for (const op of ops) {
    if (!op.f) { releve.push(null); continue; }
    const prefixe = (op.m ? op.m.join(',') : '') + '#';
    const segs = segmentsDe(op.d);
    releve.push({ segs, prefixe });
    for (const s of segs) {
      const k = cleSegment(s, prefixe);
      compte.set(k, (compte.get(k) || 0) + 1);
    }
  }
  return releve.map((r) => {
    if (!r) return null;
    let d = '', fx = NaN, fy = NaN;
    for (const s of r.segs) {
      // Vue une seule fois : c'est une arête de silhouette, on la laisse.
      if (compte.get(cleSegment(s, r.prefixe)) < 2) { fx = NaN; continue; }
      if (s[0] !== fx || s[1] !== fy) d += 'M' + s[0] + ' ' + s[1];
      d += versChemin(s);
      fx = s[4]; fy = s[5];
    }
    return d || null;
  });
}
K.cheminsDebord = cheminsDebord;

// Le même relevé, posé en Path2D dans le repère où chaque tracé se remplit.
function repererCoutures(ops) {
  const chemins = cheminsDebord(ops.map((o) => o.op));
  for (let i = 0; i < ops.length; i++) {
    if (!chemins[i]) continue;
    let ch = new Path2D(chemins[i]);
    if (ops[i].op.m) { const p = new Path2D(); p.addPath(ch, new DOMMatrix(ops[i].op.m)); ch = p; }
    if (ops[i].op.f.g) {
      const inv = inverse(ops[i].op.f.g.m);
      if (!inv) continue;
      const p = new Path2D(); p.addPath(ch, new DOMMatrix(inv)); ch = p;
    }
    ops[i].cheminDebord = ch;
  }
}

/**
 * Compile un dessin : Path2D par tracé, et pour un dégradé le chemin ramené
 * dans le repère du dégradé. Le résultat est gardé sur le dessin lui-même.
 */
function compiler(dessin) {
  if (dessin.compile) return dessin.compile;
  const ops = [];
  for (const op of dessin.ops) {
    const o = { op, chemin: new Path2D(op.d) };
    if (op.m) {
      // Un tracé posé par sa propre matrice (les glyphes des textes figés).
      const p = new Path2D();
      p.addPath(o.chemin, new DOMMatrix(op.m));
      o.chemin = p;
    }
    if (op.f && op.f.g) {
      const inv = inverse(op.f.g.m);
      if (inv) {
        const p = new Path2D();
        p.addPath(o.chemin, new DOMMatrix(inv));
        o.cheminDegrade = p;
      }
    }
    ops.push(o);
  }
  repererCoutures(ops);
  dessin.compile = { ops, cadre: dessin.b, m: dessin.m ? new DOMMatrix(dessin.m) : null };
  return dessin.compile;
}
K.compilerDessin = compiler;

// L'échelle « moyenne » de la transformation courante (pour les traits).
function echelle(ctx) {
  const t = ctx.getTransform();
  return Math.sqrt(Math.abs(t.a * t.d - t.b * t.c)) || 1;
}

/*
 * LES COUTURES ENTRE REMPLISSAGES VOISINS.
 *
 * Une forme du SWF pave son plan : l'herbe, la route, et chaque touffe de
 * décor sont des surfaces JOINTIVES d'un même dessin. Flash les rasterise
 * ensemble — un balayage, une couverture par pixel — et les bords tombent
 * exactement l'un contre l'autre.
 *
 * Le canevas, lui, remplit un chemin à la fois, chacun avec son lissage. Sur
 * un bord partagé, le premier couvre le pixel à 60 %, le second aux 40 %
 * restants… du RESTE : il manque toujours un quart de couverture, et c'est le
 * fond du tampon — transparent — qui transparaît. D'où un trait d'un pixel
 * AUTOUR DE CHAQUE ÉLÉMENT DU DÉCOR, que les joueurs voient comme un
 * quadrillage disgracieux sur toute la piste.
 *
 * On fait donc DÉBORDER chaque remplissage d'un demi-pixel d'écran, avec sa
 * propre peinture : les voisins se recouvrent, la couture disparaît. Le
 * débord ne suit QUE les arêtes partagées (`repererCoutures`) : une
 * silhouette qu'on épaissirait de la sorte serait, elle, un contresens — son
 * bord lissé est exactement celui de Flash.
 *
 * Mesuré sur le circuit Green Hill, pixels en creux d'une image de course :
 * 1 538 avant, 614 après — et 624 pour la même image rendue par Ruffle.
 */
function deborder(ctx, chemin) {
  const e = echelle(ctx);
  const ss = ctx.strokeStyle, lw = ctx.lineWidth, lj = ctx.lineJoin, lc = ctx.lineCap;
  ctx.strokeStyle = ctx.fillStyle;
  ctx.lineWidth = 1 / e;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke(chemin);
  ctx.strokeStyle = ss; ctx.lineWidth = lw; ctx.lineJoin = lj; ctx.lineCap = lc;
}

/**
 * Dessine un dessin dans le repère courant du contexte.
 * `images` : id → Image (les remplissages par image), peut manquer.
 * `alpha` : l'alpha multiplicatif hérité (0..1).
 */
function dessiner(ctx, dessin, images, alpha) {
  const c = compiler(dessin);
  if (c.m) { ctx.save(); ctx.transform(c.m.a, c.m.b, c.m.c, c.m.d, c.m.e, c.m.f); }
  const alphaBase = ctx.globalAlpha;
  for (const o of c.ops) {
    const op = o.op;
    if (op.f) {
      const f = op.f;
      if (f.g) {
        if (!o.cheminDegrade) continue;
        ctx.save();
        const m = f.g.m;
        ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
        if (!o.degrade) o.degrade = creerDegrade(ctx, f.g);
        ctx.fillStyle = o.degrade;
        ctx.fill(o.cheminDegrade, 'evenodd');
        if (o.cheminDebord) deborder(ctx, o.cheminDebord);
        ctx.restore();
      } else if (f.bm) {
        const img = images && images[f.bm.id];
        if (!img || !img.complete || !img.naturalWidth) continue;
        if (!o.motif || o.motifCtx !== ctx) {
          try {
            o.motif = ctx.createPattern(img, f.bm.rp ? 'repeat' : 'no-repeat');
            o.motif.setTransform(new DOMMatrix(f.bm.m));
            o.motifCtx = ctx;
          } catch (e) { continue; }
        }
        const lisse = ctx.imageSmoothingEnabled;
        if (!f.bm.sm) ctx.imageSmoothingEnabled = false;
        ctx.fillStyle = o.motif;
        ctx.fill(o.chemin, 'evenodd');
        if (o.cheminDebord) deborder(ctx, o.cheminDebord);
        ctx.imageSmoothingEnabled = lisse;
      } else {
        if (f.a !== undefined && f.a < 1) ctx.globalAlpha = alphaBase * f.a;
        ctx.fillStyle = f.c;
        ctx.fill(o.chemin, 'evenodd');
        if (o.cheminDebord) deborder(ctx, o.cheminDebord);
        ctx.globalAlpha = alphaBase;
      }
    } else if (op.s) {
      const s = op.s;
      const e = echelle(ctx);
      // La règle du lecteur : jamais moins d'un pixel d'écran.
      ctx.lineWidth = Math.max(s.w || 0, 1 / e);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (s.a !== undefined && s.a < 1) ctx.globalAlpha = alphaBase * s.a;
      ctx.strokeStyle = s.c;
      ctx.stroke(o.chemin);
      ctx.globalAlpha = alphaBase;
    }
  }
  if (c.m) ctx.restore();
}
K.dessinerDessin = dessiner;

/**
 * Ajoute au Path2D `cible` les remplissages du dessin, posés par `M`
 * (DOMMatrix). Sert aux MASQUES : un masque Flash ne retient que les
 * surfaces, jamais les traits.
 */
function ajouterAuMasque(cible, dessin, M) {
  const c = compiler(dessin);
  const Mt = c.m ? M.multiply(c.m) : M;
  for (const o of c.ops) {
    if (!o.op.f) continue;
    cible.addPath(o.chemin, Mt);
  }
}
K.ajouterAuMasque = ajouterAuMasque;

// Les pixels d'une image de remplissage, décodés une fois (pour son alpha).
const pixelsImages = new WeakMap();
function alphaImage(img, u, v) {
  let p = pixelsImages.get(img);
  if (p === undefined) {
    p = null;
    try {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const cx = c.getContext('2d', { willReadFrequently: true });
      cx.drawImage(img, 0, 0);
      p = { d: cx.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height };
    } catch (e) { /* image d'une autre origine : pas de lecture, on la tient pour opaque */ }
    pixelsImages.set(img, p);
  }
  if (!p) return 255;
  const i = Math.floor(v) * p.w + Math.floor(u);
  return p.d[i * 4 + 3];
}

/**
 * Le point (x, y) — dans le repère du dessin — est-il dans un remplissage ?
 *
 * Un remplissage PAR IMAGE ne compte que là où l'image est opaque : c'est ce
 * que fait le lecteur (hitTest avec le drapeau de forme, et Ruffle après
 * lui). Les bumpers de Motion Ball sont des carrés remplis d'un PNG rond aux
 * coins transparents ; tester le seul tracé en faisait des zones de contact
 * CARRÉES, et la bille rebondissait à trois pixels d'un bumper qu'elle ne
 * touchait pas — en frôlant à vive allure, on s'y faisait prendre. Hors de
 * l'image (sans répétition), rien.
 */
function contient(ctx, dessin, x, y, images) {
  const c = compiler(dessin);
  for (const o of c.ops) {
    const f = o.op.f;
    if (!f) continue;
    if (!ctx.isPointInPath(o.chemin, x, y, 'evenodd')) continue;
    if (f.bm && images) {
      const img = images[f.bm.id];
      const inv = img && img.complete && img.naturalWidth ? inverse(f.bm.m) : null;
      if (inv) {
        let u = inv[0] * x + inv[2] * y + inv[4], v = inv[1] * x + inv[3] * y + inv[5];
        const w = img.naturalWidth, h = img.naturalHeight;
        if (f.bm.rp) { u = ((u % w) + w) % w; v = ((v % h) + h) % h; }
        else if (u < 0 || v < 0 || u >= w || v >= h) continue;
        if (alphaImage(img, u, v) === 0) continue;
      }
    }
    return true;
  }
  return false;
}
K.dessinContient = contient;

})(typeof window !== 'undefined' ? window : globalThis);
