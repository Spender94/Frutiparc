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
  dessin.compile = { ops, cadre: dessin.b, m: dessin.m ? new DOMMatrix(dessin.m) : null };
  return dessin.compile;
}
K.compilerDessin = compiler;

// L'échelle « moyenne » de la transformation courante (pour les traits).
function echelle(ctx) {
  const t = ctx.getTransform();
  return Math.sqrt(Math.abs(t.a * t.d - t.b * t.c)) || 1;
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
        ctx.imageSmoothingEnabled = lisse;
      } else {
        if (f.a !== undefined && f.a < 1) ctx.globalAlpha = alphaBase * f.a;
        ctx.fillStyle = f.c;
        ctx.fill(o.chemin, 'evenodd');
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

/**
 * Le point (x, y) — dans le repère du dessin — est-il dans un remplissage ?
 */
function contient(ctx, dessin, x, y) {
  const c = compiler(dessin);
  for (const o of c.ops) {
    if (!o.op.f) continue;
    if (ctx.isPointInPath(o.chemin, x, y, 'evenodd')) return true;
  }
  return false;
}
K.dessinContient = contient;

})(typeof window !== 'undefined' ? window : globalThis);
