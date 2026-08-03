/*
 * Minipixiz — client de rendu (canvas) et commandes.
 *
 * Le moteur (engine.js) ne dessine rien : il joue la partie et annonce ce qui
 * arrive. Ce fichier écoute, pose les dessins extraits du SWF, et transforme les
 * appuis en commandes. Il ne décide d'aucune règle.
 *
 * ── L'aire ──
 *
 * La grille fait 8 × 17 cases de 16 px, mais l'aire visible n'en montre que
 * 132 × 240. C'est voulu : marginUp vaut -32, donc les deux premières lignes
 * sont AU-DESSUS du cadre. Elles servent d'antichambre à la pièce qui descend —
 * et c'est pour ça que la partie s'arrête quand la ligne 2, la première visible,
 * est occupée.
 *
 * ── La teinte ──
 *
 * Les dessins du SWF sont en niveaux de gris ; le jeu les colore à l'exécution
 * par une transformation de couleur de Flash (Mc.setColor puis modColor) :
 *
 *     sortie = source + (couleur - 255) + 25
 *
 * C'est un DÉCALAGE, pas une multiplication : le gris clair devient une teinte
 * claire, le gris foncé une teinte foncée, et le relief du dessin est conservé.
 * On refait le calcul une fois par (dessin, couleur) au chargement, et on garde
 * le résultat — dix-sept images pour huit couleurs, c'est vite fait.
 */
'use strict';

(function () {

const E = window.MinipixizEngine;
const CONCENTRATION = (window.MinipixizFee && window.MinipixizFee.CARAC.CONCENTRATION) || 4;
const BASE = '/minipixiz/';
const TS = E.TS;
const IPS = 30;                       // Timer.tmod du jeu d'origine

// L'aire de JEU : les deux lignes d'antichambre restent hors cadre.
const LARGEUR = E.LARGEUR;            // 132
const HAUTEUR = E.HAUTEUR;            // 240
const LIGNES_CACHEES = 2;

// ── L'écran, tel que le jeu le compose ────────────────────────────────────
//
// La scène fait 240 × 240 (Cs.mcw / Cs.mch), pas 132 : le plateau occupe la
// gauche et la fée sa colonne à droite. base/Aventure.updatePos :
//
//     game._x = 0 ; game._y = 0
//     var m = 4 ; var x = 132+m ; var y = m
//     pour chaque élément d'interface : _x = x+mx ; _y = y+my
//                                       y += height + margin + m*0.75
//
// et l'ordre de interList vient de initFaerieInterface : le portrait, le mana,
// la vie. D'où les trois positions ci-dessous, calculées une fois pour toutes.
const SCENE = 240;
const MARGE = 4;
const COLONNE_X = LARGEUR + MARGE;    // 136
const INTER = {
  portrait: { x: COLONNE_X, y: MARGE, l: 100, h: 70 },
  mana: { x: COLONNE_X, y: MARGE + 70 + 3, l: 100, h: 6 },
  vie: { x: COLONNE_X, y: MARGE + 70 + 3 + 6 + 3, l: 100, h: 18 },
};
const ECART_COEUR = 14;               // inter.Life : un cœur tous les 14 px
const ECART_MANA = 6;                 // inter.Mana : une goutte tous les 6 px

// inter.Face.updateImage — le cadre du portrait n'occupe pas toute la boîte :
//
//     mc._xscale = mc._yscale = height          // 70 %
//     mc._x = (width - height) * align          // 22,5 px, ou 30 s'il y a un aperçu
//
// C'est ce qui laisse la place, à sa gauche, à la colonne des pièces à venir.
const FACE_ECHELLE = 0.70;
const FACE_ALIGN = 0.75;              // align passe à 1 quand la fée voit venir
// inter.Face.setFaerie : `nextLimit = floor(carac[WISDOM] * 0.5)`. La sagesse de
// la fée décide COMBIEN de pièces à venir le joueur voit — zéro pour une fée
// ordinaire, une à partir de deux points, et ainsi de suite.
const NEXT_ZONE = { x: 18, y: 120, taille: 10 };

// Le cadre de la forêt (base/Forest.initSkin) : trois images d'un même clip,
// posées à trois profondeurs — l'image 3 DERRIÈRE le plateau, l'image 2 devant,
// l'image 1 par-dessus tout. C'est cet empilement qui donne l'impression de
// jouer entre des racines.
const CADRE_FOND = 3, CADRE_MILIEU = 2, CADRE_DESSUS = 1;

// L'arbre creux : la plaque du score en (2,2), et l'escargot en x = 38. Le champ
// de la plaque est centré dans une boîte qui va de 1,95 à 61,25 — son milieu
// tombe donc à 31,6 du coin de la plaque — et sa ligne de base à 13.
const SCORE_ARBRE = { x: 2, y: 2, cx: 31.6, base: 13, couleur: 'rgb(104,69,34)' };
const ESCARGOT_X = 38;

// Le bleu de la nuit, et la force du voile (Menu.setNight). Le coefficient de
// nuit vaut zéro à minuit, un demi à midi : |nc - 0.5| × 2 donne donc zéro en
// plein jour et un au cœur de la nuit.
const BLEU_NUIT = { r: 0x27, v: 0x4C, b: 0x76 };
const NUIT_MAX = 0.55;                // le voile ne noie jamais complètement le jeu

// ── Chargement ────────────────────────────────────────────────────────────
const images = new Map();

function charger(manifeste, surAvancee) {
  const fichiers = new Set();
  for (const [cle, s] of Object.entries(manifeste)) {
    s.cle = cle;                       // rendre() en a besoin pour l'ancrage
    for (const e of s.etats) {
      for (const p of e.pieces) fichiers.add(p.fichier);
      // Le dessin d'un masque partiel sert de pochoir : il faut le charger comme
      // les autres, même s'il ne se voit jamais.
      for (const m of (e.masquesPartiels || [])) if (m.fichier) fichiers.add(m.fichier);
    }
  }
  const liste = [...fichiers];
  let faits = 0;
  return Promise.all(liste.map((f) => new Promise((resoudre) => {
    const img = new Image();
    const fini = () => { faits++; if (surAvancee) surAvancee(faits / liste.length); resoudre(); };
    img.onload = () => { images.set(f, img); fini(); };
    img.onerror = fini;                // une pièce manquante ne bloque pas la partie
    img.src = BASE + 'sprites/' + f;
  })));
}

// ── Teinture ──────────────────────────────────────────────────────────────
const teintes = new Map();

// ── Où se pose un dessin ──────────────────────────────────────────────────
//
// Les dessins ne partagent pas tous la même origine, et la différence vient du
// jeu, pas de l'extraction.
//
// Le jeton est deux clips : `token` (#41) porte le contour, et il place son
// clip intérieur (#32) en 50,50 — l'art de #32 est donc centré sur son propre
// zéro. Aplatis, les dix-sept états occupent exactement 0..100 : la CASE. Les
// autres éléments du plateau (pierre, cellule, bombe) suivent la même règle.
//
// Mais Token.mt accroche la perle et l'étoile DANS le clip intérieur :
//
//     bm = Std.attachMC( Std.cast(skin).skin, "mcBlackMarble", 5 )
//
// leur zéro est donc le CENTRE de la case, pas son coin. Sans ce décalage
// elles se posaient au coin haut-gauche, à cheval sur la case d'à côté.
//
// Enfin, un dessin peut légitimement déborder de sa case — le halo de l'objet
// s'étend de -30 à 130. Flash ne coupait rien ; on rend donc dans un canevas à
// la taille du dessin, et on rend aussi le décalage à appliquer.
const ANCRE_CENTRE = new Set(['marble', 'star']);

// Les habitants du plateau ne sont pas à la même échelle que ses cases.
// Element.mt les met à l'échelle de la case :
//
//     setScale(game.ts)   →   skin._xscale = skin._yscale = 16
//
// donc leurs 100 unités valent 16 px. L'impy, lui, est accroché sans échelle
// (Imp.mt : `dm.attach("imp", …)`), et son dessin est déjà en pixels : 20 × 24,
// une case et demie. Le réduire à 100 unités le rendrait minuscule.
// Le portrait et son cadre, eux, sont dessinés sur cent unités comme le reste :
// inter.Face les met à l'échelle (`_xscale = height`), donc ils suivent la règle
// commune. Ne restent en pixels que les dessins accrochés SANS échelle.
const ECHELLE_PIXEL = new Set(['imp', 'coeur', 'mana', 'fee']);

// Mc.setPic : la fée n'a pas une couleur mais trois, et chaque morceau du
// portrait sait laquelle lui revient.
//
//     setColor( pic.f.k0/k1/k2,        skin.col1 )   les cheveux
//     setColor( pic.f.o0.p/o1.p/cloth, skin.col2 )   les yeux et la robe
//     setColor( pic.f.w0/w1,           skin.col3 )   les ailes
//
// Sans ça, toutes les fées se ressemblent — or c'est leur apparence unique qui
// fait qu'on s'y attache.
// `prefixe` sert quand le portrait n'est pas seul mais imbriqué dans un
// panneau : dans invFace, les mêmes morceaux s'appellent « pic.f.k0 ».
function partiesDeFee(couleurs, prefixe) {
  const p = prefixe || '';
  const t = {};
  for (const n of ['f.k0', 'f.k1', 'f.k2']) t[p + n] = couleurs[0];
  for (const n of ['f.o0.p', 'f.o1.p', 'f.cloth']) t[p + n] = couleurs[1];
  for (const n of ['f.w0', 'f.w1']) t[p + n] = couleurs[2];
  return t;
}

// CXFORMWITHALPHA : sortie = source × mult / 256 + add, par canal. C'est la
// transformation que Flash a POSÉE dans le fichier, à ne pas confondre avec
// celle que le jeu applique à l'exécution (teinter).
function transformer(g, x, y, l, h, cx) {
  if (l <= 0 || h <= 0) return;
  const d = g.getImageData(x, y, l, h);
  const px = d.data;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) continue;
    px[i] = Math.max(0, Math.min(255, px[i] * cx[0] / 256 + cx[4]));
    px[i + 1] = Math.max(0, Math.min(255, px[i + 1] * cx[1] / 256 + cx[5]));
    px[i + 2] = Math.max(0, Math.min(255, px[i + 2] * cx[2] / 256 + cx[6]));
    px[i + 3] = Math.max(0, Math.min(255, px[i + 3] * cx[3] / 256 + cx[7]));
  }
  g.putImageData(d, x, y);
}

// Mc.setPercentColor : sortie = source × (100-prc)/100 + (prc/100) × couleur.
function fondre(g, x, y, l, h, prc, couleur) {
  if (l <= 0 || h <= 0) return;
  const k = Math.max(0, Math.min(100, prc)) / 100;
  const d = g.getImageData(x, y, l, h);
  const px = d.data;
  const cr = ((couleur >> 16) & 0xFF) * k;
  const cv = ((couleur >> 8) & 0xFF) * k;
  const cb = (couleur & 0xFF) * k;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) continue;
    px[i] = Math.max(0, Math.min(255, px[i] * (1 - k) + cr));
    px[i + 1] = Math.max(0, Math.min(255, px[i + 1] * (1 - k) + cv));
    px[i + 2] = Math.max(0, Math.min(255, px[i + 2] * (1 - k) + cb));
  }
  g.putImageData(d, x, y);
}

// Applique la teinte de Flash à une zone de canevas.
// Mc.setColor + modColor(1, 25) : un décalage additif, borné.
function teinter(g, x, y, l, h, couleur) {
  if (l <= 0 || h <= 0) return;
  const d = g.getImageData(x, y, l, h);
  const px = d.data;
  const dr = ((couleur >> 16) & 0xFF) - 230;
  const dv = ((couleur >> 8) & 0xFF) - 230;
  const db = (couleur & 0xFF) - 230;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) continue;
    px[i] = Math.max(0, Math.min(255, px[i] + dr));
    px[i + 1] = Math.max(0, Math.min(255, px[i + 1] + dv));
    px[i + 2] = Math.max(0, Math.min(255, px[i + 2] + db));
  }
  g.putImageData(d, x, y);
}

// ── Le dessin VIF ─────────────────────────────────────────────────────────
//
// `rendre` met en cache un dessin fini : parfait pour une bille, impossible
// pour une particule, qui tourne et grandit à chaque image. Ce qui vole se
// dessine donc directement, avec sa matrice — et ce qui coûte cher, la teinte,
// se met en cache une fois par (fichier, couleur) au lieu d'une fois par image.
const peintes = new Map();
const SUPER = 4;                       // le rendu tramé est fait plus grand que
                                       // nature : la matrice l'agrandit souvent

function imagePeinte(fichier, couleur, melange, cx) {
  const cle = fichier + '/' + couleur + '/'
    + (melange ? Math.round(melange.prc / 5) * 5 + ',' + melange.couleur : '')
    + (cx ? '/' + cx.join(',') : '');
  const deja = peintes.get(cle);
  if (deja) return deja;
  const img = images.get(fichier);
  if (!img) return null;
  const l = Math.max(1, Math.ceil((img.naturalWidth || img.width || 1) * SUPER));
  const h = Math.max(1, Math.ceil((img.naturalHeight || img.height || 1) * SUPER));
  const c = document.createElement('canvas');
  c.width = l; c.height = h;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0, l, h);
  if (cx) transformer(g, 0, 0, l, h, cx);
  if (couleur !== undefined && couleur !== null) teinter(g, 0, 0, l, h, couleur);
  if (melange && melange.prc > 0) fondre(g, 0, 0, l, h, melange.prc, melange.couleur);
  peintes.set(cle, c);
  return c;
}

// Une déformation posée sur un clip INTERMÉDIAIRE : elle tourne et met à
// l'échelle autour de l'origine de ce clip, exprimée dans le repère de la pièce
// qu'on dessine. C'est ainsi que Flash anime une aile — le battement est sur
// `w0.w`, pas sur le dessin lui-même.
function appliquerDeform(ctx, t) {
  ctx.translate(t.p[0], t.p[1]);
  if (t.r) ctx.rotate(t.r * Math.PI / 180);
  if (t.sx !== 1 || t.sy !== 1) ctx.scale(t.sx, t.sy);
  ctx.translate(-t.p[0], -t.p[1]);
}

/**
 * Dessine un état de sprite tel quel, à l'échelle et à l'angle demandés.
 *
 * `o` : { x, y, sx, sy, rot, alpha, couleur, parties, melange, deform }
 * — sx/sy/alpha en pourcentage, rot en degrés, comme dans Flash.
 */
function poserVif(ctx, sprite, frame, o) {
  if (!sprite || !sprite.etats.length) return;
  let etat = sprite.etats.find((e) => e.frame === frame);
  if (!etat) {
    // Un clip qu'on fait JOUER déroule ses images ; s'il en manque une, on
    // prend la dernière avant elle plutôt que de sauter au début.
    for (const e of sprite.etats) if (e.frame <= frame) etat = e;
    if (!etat) etat = sprite.etats[0];
  }
  const sx = (o.sx === undefined ? 100 : o.sx) / 100;
  const sy = (o.sy === undefined ? 100 : o.sy) / 100;
  if (sx === 0 || sy === 0) return;
  ctx.save();
  ctx.translate(o.x, o.y);
  if (o.rot) ctx.rotate(o.rot * Math.PI / 180);
  ctx.scale(sx, sy);
  if (o.alpha !== undefined && o.alpha < 100) ctx.globalAlpha *= Math.max(0, o.alpha / 100);
  for (const p of etat.pieces) {
    let teinte = o.couleur;
    if (o.parties && p.nom !== undefined && o.parties[p.nom] !== undefined) {
      teinte = o.parties[p.nom];
    }
    const brut = (teinte === undefined || teinte === null) && !o.melange && !p.cx;
    const img = brut ? images.get(p.fichier) : imagePeinte(p.fichier, teinte, o.melange, p.cx);
    if (!img) continue;
    const d = o.deform ? o.deform(p.nom) : null;
    ctx.save();
    if (p.m && p.vb) {
      ctx.transform(p.m[0], p.m[1], p.m[2], p.m[3], p.m[4], p.m[5]);
      if (d) for (const t of d) appliquerDeform(ctx, t);
      ctx.drawImage(img, p.vb[0], p.vb[1], p.vb[2], p.vb[3]);
    } else {
      ctx.drawImage(img, p.x, p.y, p.w, p.h);
    }
    ctx.restore();
  }
  ctx.restore();
}

// ── La fée et l'impy, en vol ──────────────────────────────────────────────
//
// Leurs deux clips ont exactement la même charpente : deux ailes en trois
// niveaux (w0 → w → w) et un corps en trois morceaux. Les nombres ci-dessous
// sont l'ORIGINE de chaque clip intermédiaire, lue dans root.swf et exprimée
// dans le repère du dessin qu'elle porte : c'est le point autour duquel
// People.moveWings fait battre et pencher.
//
// Les placements du fichier sont en TWIPS ; les pièces extraites, en pixels.
// D'où la division par vingt — sans elle, tourner la tête l'enverrait à cinq
// pixels du corps.
const TWIP = 1 / 20;
const pv = (x, y) => [x * TWIP, y * TWIP];
const PIVOT_AILE_W = pv(0, 0);         // w0.w — le battement
const PIVOT_AILE = pv(-5, 0);          // w0   — la perspective
const PIVOT_CORPS = {
  'body.corps': pv(0, 11), 'body.corps.m': pv(2, -10), 'body.corps.col': pv(-12, -98),
  'body.epaule': pv(-4, 18), 'body.epaule.m': pv(-1, 44), 'body.epaule.col': pv(-11, 3),
  'body.tete': pv(9, 115), 'body.tete.kami': pv(9, 117), 'body.tete.col': pv(9, 124),
};

// People.moveWings, traduit en gestes de dessin.
function deformationsDeVol(pe) {
  const a = pe.aile;
  return (nom) => {
    if (nom === 'w0.w.w' || nom === 'w1.w.w') {
      const sens = (nom === 'w0.w.w') ? 1 : -1;
      return [
        { p: PIVOT_AILE, sx: Math.abs(100 + sens * a.ecart) / 100, sy: 1, r: 0 },
        { p: PIVOT_AILE_W, sx: 1, sy: 1, r: a.rot },
        { p: PIVOT_AILE_W, sx: a.xs / 100, sy: (100 - 80 * a.yi) / 100, r: 0 },
      ];
    }
    const piv = PIVOT_CORPS[nom];
    return piv ? [{ p: piv, sx: 1, sy: 1, r: pe.penchePart }] : null;
  };
}

// Faerie.setColor : les cheveux, la robe, les ailes — trois couleurs tirées de
// la fiche, et c'est ce qui fait qu'on reconnaît SA fée du premier coup d'œil.
function partiesDeCorps(couleurs) {
  return {
    'body.tete.kami': couleurs[0],
    'body.corps.m': couleurs[1],
    'body.epaule.m': couleurs[1],
    'w0.w.w': couleurs[2],
    'w1.w.w': couleurs[2],
  };
}

// Imp.setSkin : la peau puis les ailes, selon le rang (Cs.impColorList).
function partiesDImpy(couleurs) {
  return {
    'body.tete.col': couleurs[0],
    'body.corps.col': couleurs[0],
    'body.epaule.col': couleurs[0],
    'w0.w.w': couleurs[1],
    'w1.w.w': couleurs[1],
  };
}

/**
 * Rend un état de sprite pour une case de `taille` px.
 *
 * `couleur` non définie = le dessin d'origine, en gris.
 * `parties` associe un chemin de clip nommé à une couleur — c'est ce que fait
 * Mc.setPic pour la fée, qui n'a pas une teinte mais trois.
 *
 * Renvoie { c, dx, dy } : le canevas, et où le poser depuis le coin de la case.
 */
function rendre(sprite, frame, taille, couleur, parties, tranche, rotations, melange) {
  const cle = sprite.nom + '/' + frame + '/' + taille + '/'
    + (couleur === undefined ? 'gris' : couleur)
    + (parties ? '/' + JSON.stringify(parties) : '')
    + (tranche ? '/' + tranche : '')
    + (rotations ? '/' + JSON.stringify(rotations) : '')
    + (melange ? '/m' + melange.prc + ',' + melange.couleur : '');
  const dejaLa = teintes.get(cle);
  if (dejaLa) return dejaLa;

  const complet = sprite.etats.find((e) => e.frame === frame) || sprite.etats[0];
  let etat = complet;

  // Une TRANCHE coupe le dessin en deux au clip nommé, pour qu'on puisse
  // glisser quelque chose entre les deux — c'est ainsi que le jeu pose le
  // portrait de la fée : `Std.attachMC(skin.cadre.pic, "picFace", 10)`. Le fond
  // et le passe-partout du cadre sont SOUS le portrait, le liseré est DESSUS ;
  // tout dessiner d'un bloc cacherait la fée derrière le passe-partout.
  //
  //   '<pic'  les pièces d'avant
  //   'pic'   les pièces jusqu'à `pic` incluse
  //   '>pic'  celles d'après
  //
  // Le cadre du canevas reste celui du dessin ENTIER : les deux moitiés doivent
  // se superposer exactement.
  if (tranche && complet) {
    const signe = tranche.charAt(0);
    const apres = signe === '>';
    const avant = signe === '<';
    const nom = (apres || avant) ? tranche.slice(1) : tranche;
    // Le nom est un CHEMIN de clips ("cadre.pic") : on accepte le suffixe, pour
    // que l'appelant n'ait pas à connaître toute la hiérarchie — et le PRÉFIXE,
    // parce qu'un clip dont on veut la place peut n'apparaître que par ses
    // enfants (le portrait de l'inventaire ne pose que des « pic.f… »).
    const vise = (p) => p.nom && (p.nom === nom
      || p.nom.slice(-(nom.length + 1)) === '.' + nom
      || p.nom.indexOf(nom + '.') === 0
      || p.nom.indexOf('.' + nom + '.') >= 0);
    const premier = complet.pieces.findIndex(vise);
    let dernier = -1;
    for (let i = complet.pieces.length - 1; i >= 0; i--) {
      if (vise(complet.pieces[i])) { dernier = i; break; }
    }
    const morceaux = (premier < 0) ? ((apres || avant) ? [] : complet.pieces)
      : apres ? complet.pieces.slice(dernier + 1)
        : avant ? complet.pieces.slice(0, premier)
          : complet.pieces.slice(0, dernier + 1);
    etat = { frame: complet.frame, pieces: morceaux, masques: complet.masques,
      masquesPartiels: complet.masquesPartiels };
  }
  const k = ECHELLE_PIXEL.has(sprite.cle) ? 1 : taille / 100;
  const zero = ANCRE_CENTRE.has(sprite.cle) ? 50 : 0;
  const masques = (etat && etat.masques) || [];

  // Le cadre du dessin, dans le repère de la case. Un masque RÉTRÉCIT le
  // dessin : rien ne dépasse de la découpe, ce n'est donc pas la peine de
  // préparer un canevas plus grand.
  let x0 = 0, y0 = 0, x1 = 100, y1 = 100;
  if (complet && complet.pieces.length) {
    x0 = y0 = Infinity; x1 = y1 = -Infinity;
    for (const p of complet.pieces) {
      x0 = Math.min(x0, p.x + zero); y0 = Math.min(y0, p.y + zero);
      x1 = Math.max(x1, p.x + zero + p.w); y1 = Math.max(y1, p.y + zero + p.h);
    }
    for (const m of masques) {
      x0 = Math.max(x0, m.x + zero); y0 = Math.max(y0, m.y + zero);
      x1 = Math.min(x1, m.x + zero + m.w); y1 = Math.min(y1, m.y + zero + m.h);
    }
  }
  const dx = Math.floor(x0 * k), dy = Math.floor(y0 * k);
  const l = Math.max(1, Math.ceil(x1 * k) - dx), h = Math.max(1, Math.ceil(y1 * k) - dy);

  const c = document.createElement('canvas');
  c.width = l;
  c.height = h;
  const g = c.getContext('2d');
  if (etat) {
    // Poser une pièce : la matrice du placement, mise à l'échelle de la case.
    // C'est elle qui retourne les ailes et étire les cadres — un simple coin
    // plus une taille perdrait les deux.
    const poser = (dest, p, img) => {
      const m = p.m, vb = p.vb;
      dest.save();
      if (m && vb) {
        dest.setTransform(m[0] * k, m[1] * k, m[2] * k, m[3] * k,
          (m[4] + zero) * k - dx, (m[5] + zero) * k - dy);
        // Une ROTATION vive, autour du point d'accroche de la pièce. Le jeu s'en
        // sert pour les deux aiguilles des cadrans de faim et de moral :
        //     mc.h0.h._rotation = 180 + ($hunger/20)*180
        // Elles ne sont pas dessinées penchées, elles TOURNENT.
        const a = rotations && p.nom ? rotations[p.nom] : undefined;
        if (a !== undefined) {
          const r = a * Math.PI / 180;
          dest.translate(-m[4], -m[5]);
          dest.rotate(r);
          dest.translate(m[4], m[5]);
        }
        dest.drawImage(img, vb[0], vb[1], vb[2], vb[3]);
      } else {
        dest.drawImage(img, (p.x + zero) * k - dx, (p.y + zero) * k - dy, p.w * k, p.h * k);
      }
      dest.restore();
    };

    // Un masque PARTIEL ne découpe qu'une tranche du dessin — la sienne. Le
    // médaillon du panneau de l'inventaire s'arrête au portrait ; le fond du
    // panneau, ses deux boutons et sa pastille de niveau vivent au-dessus de lui
    // et doivent rester entiers. Le pousser en fenêtre du canevas, comme un
    // masque qui prend tout, rognait le panneau à son médaillon.
    //
    // Et c'est bien le DESSIN du masque qui découpe, pas son cadre : celui du
    // médaillon est un disque, s'en tenir à son carré laisserait dépasser les
    // quatre coins du portrait.
    const partiels = new Map();
    for (const m of (etat.masquesPartiels || [])) partiels.set(m.num, m);
    const decouper = (dest, m) => {
      const img = images.get(m.fichier);
      dest.globalCompositeOperation = 'destination-in';
      if (img) poser(dest, m, img);
      else {
        dest.setTransform(1, 0, 0, 1, 0, 0);
        dest.fillStyle = '#000';
        dest.fillRect((m.x + zero) * k - dx, (m.y + zero) * k - dy, m.w * k, m.h * k);
      }
      dest.globalCompositeOperation = 'source-over';
    };

    for (const p of etat.pieces) {
      const img = images.get(p.fichier);
      if (!img) continue;
      const t = (parties && p.nom !== undefined) ? parties[p.nom] : undefined;
      const coupe = p.msq ? partiels.get(p.msq) : null;
      if (t === undefined && !p.cx && !coupe) { poser(g, p, img); continue; }
      // Une pièce teintée se dessine SEULE sur un calque, se teinte là — où
      // elle est la seule à porter des pixels opaques — puis se colle. Teinter
      // son rectangle sur le dessin commun repeindrait ce qu'il y a dessous :
      // la chevelure de la fée couvre presque tout son portrait, et sa couleur
      // aurait débordé sur le visage. Le même calque sert de plan de découpe.
      const calque = document.createElement('canvas');
      calque.width = l; calque.height = h;
      const gc = calque.getContext('2d');
      poser(gc, p, img);
      if (coupe) decouper(gc, coupe);
      // La transformation de couleur du fichier d'abord — c'est celle que Flash
      // avait déjà appliquée — puis la teinte demandée par le jeu.
      if (p.cx) transformer(gc, 0, 0, l, h, p.cx);
      if (t !== undefined) teinter(gc, 0, 0, l, h, t);
      g.drawImage(calque, 0, 0);
    }
  }
  if (couleur !== undefined) teinter(g, 0, 0, l, h, couleur);
  // Mc.setPercentColor : un fondu linéaire vers une couleur.
  //     sortie = source × (100 - prc)/100 + (prc/100) × couleur
  // C'est ce que le menu applique à chaque plan pour le faire bleuir la nuit.
  if (melange && melange.prc > 0) fondre(g, 0, 0, l, h, melange.prc, melange.couleur);
  const rendu = { c, dx, dy };
  teintes.set(cle, rendu);
  return rendu;
}

// Pose un rendu à la case (x, y), en pixels.
function poserRendu(ctx, r, x, y) {
  ctx.drawImage(r.c, x + r.dx, y + r.dy);
}

// ── Les liaisons d'un jeton (Group.draw) ──────────────────────────────────
// L'image dit à quels voisins DU MÊME GROUPE le jeton est relié : haut 1,
// droite 2, bas 4, gauche 8, plus un. C'est ce qui fait qu'un groupe se lit
// comme une seule tache et non comme quatre carrés.
const DIRS = [{ x: 0, y: -1, v: 1 }, { x: 1, y: 0, v: 2 }, { x: 0, y: 1, v: 4 }, { x: -1, y: 0, v: 8 }];

function imageJeton(jeu, e) {
  if (e.special === E.SPECIAL.ARMURE) return 20;
  if (!e.groupe) return 1;
  let frame = 1;
  for (const d of DIRS) {
    const v = jeu.element(e.px + d.x, e.py + d.y);
    if (v && v.groupe === e.groupe) frame += d.v;
  }
  return frame;
}

// ── Particules ────────────────────────────────────────────────────────────
const eclats = [];
function eclater(x, y, n, couleur, vitesse) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 6.28;
    const v = vitesse * (0.4 + Math.random() * 0.6);
    eclats.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 1, t: 8 + Math.random() * 12, c: couleur });
  }
}
function bougerEclats(ctx, tmod) {
  for (let i = eclats.length - 1; i >= 0; i--) {
    const p = eclats[i];
    p.x += p.vx * tmod; p.y += p.vy * tmod; p.vy += 0.3 * tmod; p.t -= tmod;
    if (p.t <= 0) { eclats.splice(i, 1); continue; }
    ctx.globalAlpha = Math.min(1, p.t / 6);
    ctx.fillStyle = p.c;
    ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
  }
  ctx.globalAlpha = 1;
}

const borner01 = (v) => Math.max(0, Math.min(1, v));

// ── Le client ─────────────────────────────────────────────────────────────
class Client {
  constructor(o) {
    this.canvas = o.canvas;
    this.ctx = this.canvas.getContext('2d');
    this.sprites = o.sprites;
    this.surEvenement = o.surEvenement || null;
    this.entree = { gauche: false, droite: false, bas: false, tourner: false };
    this.message = null;
    this.messageT = 0;
    this.dernier = 0;
    this.reste = 0;
    // La fée qui accompagne la partie, et l'heure qu'il est dans le jeu.
    this.fee = o.fee || null;
    this.bassin = null;
    this.lieu = null;
    this.champ = null;
    this.coefNuit = (o.coefNuit === undefined) ? 0.5 : o.coefNuit;
    this.brancherCommandes(o.racine || document);
    this.redimensionner();
    window.addEventListener('resize', () => this.redimensionner());
    window.addEventListener('orientationchange', () => setTimeout(() => this.redimensionner(), 120));
  }

  nouvellePartie(opts) {
    opts = opts || {};
    eclats.length = 0;
    this.bassin = null;
    this.lieu = null;
    if (opts.fee !== undefined) this.fee = opts.fee;
    if (opts.coefNuit !== undefined) this.coefNuit = opts.coefNuit;
    this.jeu = new E.Jeu(Object.assign({}, opts, { onEvent: (n, d) => this.annonce(n, d) }));
    this.jeu.entree = this.entree;
    // Le champ — la fée, les impys, les tirs. Sans fée le puzzle se joue tout
    // seul, comme dans le jeu d'origine quand aucune n'est en état de sortir.
    const Combat = window.MinipixizCombat;
    this.champ = (Combat && this.fee) ? new Combat.Champ(this.jeu, { fee: this.fee }) : null;
    this.dernier = 0;
    this.reste = 0;
    return this.jeu;
  }

  /**
   * Le BASSIN (bassin.js) — l'autre mode. Il apporte sa propre partie, son
   * aire de 240 sur 240 et sa bulle ; le client se contente de le dessiner et
   * de lui passer les commandes.
   */
  nouveauBassin(opts) {
    const B = window.MinipixizBassin;
    if (!B) return null;
    eclats.length = 0;
    this.lieu = null;
    this.bassin = new B.Bassin(Object.assign({}, opts || {},
      { surEvenement: (n, d) => this.annonce(n, d) }));
    this.jeu = this.bassin.jeu;
    this.champ = this.bassin.champ;
    this.jeu.entree = this.entree;
    this.dernier = 0;
    this.reste = 0;
    return this.bassin;
  }

  /**
   * Un LIEU (lieux.js) — le donjon, l'arbre creux, l'arc-en-ciel. Comme le
   * bassin, chacun apporte sa partie et ses règles ; le client le dessine et
   * lui passe les commandes.
   */
  nouveauLieu(classe, opts) {
    const X = window.MinipixizLieux;
    if (!X || !X[classe]) return null;
    eclats.length = 0;
    this.bassin = null;
    this.lieu = new X[classe](Object.assign({}, opts || {},
      { surEvenement: (n, d) => this.annonce(n, d) }));
    this.jeu = this.lieu.jeu;
    this.champ = this.lieu.champ;
    this.jeu.entree = this.entree;
    if (this.lieu.fi) this.fee = this.lieu.fi;
    this.dernier = 0;
    this.reste = 0;
    return this.lieu;
  }

  annonce(nom, d) {
    // Un lieu qui enchaîne ses niveaux (le donjon) remonte une partie neuve :
    // il faut la reprendre, sans quoi on continuerait de dessiner l'ancienne.
    if (nom === 'niveauDonjon' && this.lieu) {
      this.jeu = this.lieu.jeu;
      this.champ = this.lieu.champ;
      this.jeu.entree = this.entree;
    }
    // Les marges sont celles de la PARTIE, pas du module : l'arbre creux décale
    // son aire de quarante-huit pixels pour laisser la place au tronc.
    const px = (gx) => (this.jeu ? this.jeu.posX(gx + 0.5) : E.MARGE_GAUCHE + (gx + 0.5) * TS);
    const py = (gy) => (this.jeu ? this.jeu.posY(gy + 0.5) : E.MARGE_HAUT + (gy + 0.5) * TS);
    switch (nom) {
      case 'destruction': this.message = null; break;
      case 'etoile': eclater(px(d.x), py(d.y), 24, '#ffffff', 3.2); break;
      case 'pierreCassee': eclater(px(d.x), py(d.y), 10, '#d8d2bb', 2.4); break;
      case 'pierreEntamee': eclater(px(d.x), py(d.y), 4, '#d8d2bb', 1.6); break;
      case 'armureBrisee': eclater(px(d.x), py(d.y), 6, '#ffffff', 2); break;
      case 'impyLibere': eclater(px(d.x), py(d.y), 16, '#ff66cc', 3); break;
      case 'score':
        if (d.chaine > 1) { this.message = 'chaîne ×' + d.chaine + '  +' + d.gagne; this.messageT = 50; }
        break;
      case 'couleurFinie': this.message = 'couleur terminée !'; this.messageT = 60; break;
      default: break;
    }
    if (this.surEvenement) this.surEvenement(nom, d);
  }

  // La boucle. Le jeu d'origine tourne à 30 images par seconde et ses tirages en
  // dépendent : on avance par pas d'UNE image nominale, jamais à moitié.
  demarrer() {
    if (this.raf) return;
    const boucle = (t) => {
      this.raf = requestAnimationFrame(boucle);
      if (!this.dernier) { this.dernier = t; return; }
      let dt = (t - this.dernier) / 1000;
      this.dernier = t;
      if (dt > 0.25) dt = 0.25;
      this.reste += dt * IPS;
      let pas = 0;
      const mode = this.bassin || this.lieu;
      if (mode) {
        while (this.reste >= 1 && pas < 6) { mode.update(1); this.reste -= 1; pas++; }
      } else if (this.jeu) {
        while (this.reste >= 1 && pas < 6) { this.jeu.update(1); this.reste -= 1; pas++; }
      } else {
        this.reste = 0;
      }
      this.dessiner(dt * IPS);
    };
    this.raf = requestAnimationFrame(boucle);
  }

  dessiner(tmod) {
    const ctx = this.ctx, jeu = this.jeu;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, SCENE, SCENE);
    const s = this.sprites;
    if (this.bassin) { this.dessinerBassin(ctx, tmod); return; }
    if (this.lieu) { this.dessinerLieu(ctx, tmod); return; }

    // 1. LE FOND — l'image 3 du cadre, posée sous le plateau (DP_SKIN_DOWN).
    //    C'est le vert profond des racines : sans lui, le plateau flotte.
    if (s.cadre) poserRendu(ctx, rendre(s.cadre, CADRE_FOND, 100), 0, 0);
    else { ctx.fillStyle = '#241c3a'; ctx.fillRect(0, 0, LARGEUR, HAUTEUR); }

    if (jeu) {
      for (const e of jeu.eList) this.dessinerElement(ctx, e, e.px, e.py);
      // La pièce en cours flotte entre deux cases : elle a ses propres positions.
      if (jeu.piece) for (const c of jeu.piece.cases()) this.poser(ctx, c.e, c.x, c.y);
      // Puis tout ce qui vole. L'ordre est celui des profondeurs de Flash :
      // les particules derrière, les créatures, les tirs devant.
      this.dessinerVol(ctx);
      bougerEclats(ctx, tmod);
    }

    // 2. LE MONTANT — l'image 2, devant le plateau (DP_SKIN_MIDDLE) : c'est le
    //    panneau de la colonne de droite, où vit la fée.
    if (s.cadre) poserRendu(ctx, rendre(s.cadre, CADRE_MILIEU, 100), 0, 0);

    // 3. L'INTERFACE (DP_INTER), puis le feuillage qui passe par-dessus tout.
    if (jeu) this.dessinerInterface(ctx, tmod);
    if (s.cadre) poserRendu(ctx, rendre(s.cadre, CADRE_DESSUS, 100), 0, 0);

    // 4. LA NUIT NOIRE d'un impy : elle éteint TOUT, interface comprise, et ne
    //    laisse qu'un rond autour de la pièce. C'est pour ça qu'elle vient ici,
    //    après le reste.
    this.dessinerNuitNoire(ctx);

    // 5. L'heure qu'il est, en dernier : elle teinte la scène entière.
    this.dessinerNuit(ctx);
  }

  /**
   * La scène du bassin. Pas de colonne d'interface : l'aire occupe les 240
   * pixels, et le fond est le même dégradé d'heure que le menu — base/Fountain
   * pose `sub.bg.gotoAndStop(nuit×100 + 1)`, c'est-à-dire la même centaine
   * d'images de ciel, vue depuis le fond de l'eau.
   */
  dessinerBassin(ctx, tmod) {
    const jeu = this.jeu, s = this.sprites, bassin = this.bassin;
    const heure = Math.round(borner01(this.coefNuit) * 100);
    const ciel = s['ciel' + heure] || s.ciel0;
    if (ciel) poserRendu(ctx, rendre(ciel, 1, SCENE), 0, 0);
    else { ctx.fillStyle = '#12365a'; ctx.fillRect(0, 0, SCENE, SCENE); }
    // Le décor du lieu par-dessus le ciel : c'est lui qui met l'eau et la roche.
    if (s.cadreBassin) poserRendu(ctx, rendre(s.cadreBassin, 3, 100), 0, 0);

    for (const e of jeu.eList) this.dessinerElement(ctx, e, e.px, e.py);
    if (jeu.piece) for (const c of jeu.piece.cases()) this.poser(ctx, c.e, c.x, c.y);
    this.dessinerVol(ctx);
    // La bulle et sa prisonnière, par-dessus tout : c'est l'objectif, il ne
    // faut jamais la perdre de vue.
    if (bassin.bulle) this.dessinerBulle(ctx, bassin.bulle);
    bougerEclats(ctx, tmod);
    this.dessinerNuit(ctx);
    this.dessinerMessage(ctx, tmod);
  }

  /**
   * La scène d'un lieu. Chacun a son cadre — interfaceDungeon, interfaceTree,
   * interfaceRainbow — bâti comme celui de la forêt : trois images pour trois
   * profondeurs, le fond dessous et le feuillage dessus.
   */
  dessinerLieu(ctx, tmod) {
    const jeu = this.jeu, s = this.sprites, lieu = this.lieu;
    const cadre = s[lieu.cadre || 'cadre'];
    if (cadre) poserRendu(ctx, rendre(cadre, CADRE_FOND, 100), 0, 0);
    else { ctx.fillStyle = '#241c3a'; ctx.fillRect(0, 0, SCENE, SCENE); }

    // Les fruits du multiplicateur pendent DERRIÈRE le tronc (`dm.under`).
    this.dessinerFruits(ctx);

    for (const e of jeu.eList) this.dessinerElement(ctx, e, e.px, e.py);
    if (jeu.piece) for (const c of jeu.piece.cases()) this.poser(ctx, c.e, c.x, c.y);
    this.dessinerVol(ctx);
    bougerEclats(ctx, tmod);

    // L'escargot est posé à DP_SKIN_MIDDLE, comme le montant du tronc, mais
    // avant lui : il grimpe DERRIÈRE l'écorce.
    this.dessinerEscargot(ctx);
    if (cadre) poserRendu(ctx, rendre(cadre, CADRE_MILIEU, 100), 0, 0);
    if (this.champ && this.champ.faerieList.length) this.dessinerInterface(ctx, tmod);
    else this.dessinerMessage(ctx, tmod);
    const col = lieu.colonneSuivantes;
    if (col) this.dessinerSuivantes(ctx, col.x, col.y, col.echelle, col.image, col.nombre);
    this.dessinerEnteteLieu(ctx);
    if (cadre) poserRendu(ctx, rendre(cadre, CADRE_DESSUS, 100), 0, 0);
    this.dessinerNuitNoire(ctx);
    this.dessinerNuit(ctx);
  }

  /**
   * inter.Face.newPiece — la colonne des pièces à venir (`mcNext`).
   *
   * Les pièces y entrent par le bas (`piece._y = 120`) et remontent vers leur
   * place, `(i+1) × 100/(n+1)`. Un masque borde la colonne : sans lui, on les
   * verrait passer par-dessous. Deux endroits s'en servent — le portrait de la
   * fée en aventure, et le tronc de l'arbre creux, qui la montre toujours.
   *
   * @param {number} x,y   le coin du clip mcNext
   * @param {number} k     son échelle (0,70 en aventure, 0,84 dans l'arbre)
   * @param {number} frame son image (`setSkin`)
   * @param {number} n     combien de pièces
   */
  dessinerSuivantes(ctx, x, y, k, frame, n) {
    const s = this.sprites, jeu = this.jeu;
    if (!s.suivante || !jeu) return;
    poserRendu(ctx, rendre(s.suivante, frame, 100 * k), x, y);
    const zx = x + NEXT_ZONE.x * k;
    const zy = y + NEXT_ZONE.y * k;
    const ec = 100 / (n + 1);
    const etat = s.suivante.etats.find((e) => e.frame === frame) || s.suivante.etats[0];
    const decoupe = (etat.masquesPartiels || [])[0];
    ctx.save();
    if (decoupe) {
      ctx.beginPath();
      ctx.rect(x + decoupe.x * k, y + decoupe.y * k, decoupe.w * k, decoupe.h * k);
      ctx.clip();
    }
    for (let i = 0; i < n; i++) {
      const liste = jeu.nextList[i];
      if (!liste) continue;
      const dy = ((i + 1) * ec - NEXT_ZONE.y) * k;
      let xMin = 9, yMin = 9;
      for (const o of liste) { xMin = Math.min(xMin, o.x); yMin = Math.min(yMin, o.y); }
      for (const o of liste) {
        poserRendu(ctx, rendre(s.token, 1, NEXT_ZONE.taille * k,
          E.COULEURS[o.e.type] || E.COULEURS[0]),
        zx + (o.x - xMin) * NEXT_ZONE.taille * k,
        zy + dy + (o.y - yMin) * NEXT_ZONE.taille * k);
      }
    }
    ctx.restore();
  }

  // base/Tree.initEscargot — l'escargot grimpe le long du tronc à mesure que le
  // chronomètre tourne : `esc._y = 240 - (timer/1000)*220`. C'est LUI qui
  // annonce la prochaine accélération, et c'est la seule horloge du mode.
  dessinerEscargot(ctx) {
    const e = this.lieu.etat();
    if (e.escargot === undefined || !this.sprites.escargot) return;
    poserRendu(ctx, rendre(this.sprites.escargot, 1, 100), ESCARGOT_X, e.escargot);
  }

  // base/Tree.multiUp — les fruits du multiplicateur, au bout de leur élastique.
  dessinerFruits(ctx) {
    const s = this.sprites;
    const l = (this.lieu.etat().fruits) || [];
    if (!l.length || !s.multiFruit) return;
    for (const p of l) {
      const r = rendre(s.multiFruit, p.image, 100);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot * Math.PI / 180);
      ctx.drawImage(r.c, r.dx, r.dy);
      ctx.restore();
    }
  }

  // Ce que chaque lieu doit dire au joueur, et que la forêt n'a pas : à quel
  // niveau de donjon il en est, combien de pièces la roue attend encore.
  //
  // L'arbre creux, lui, a sa PLAQUE (base/Tree.initScore) : `panScore` en (2,2),
  // dont le champ est centré, en Berlin Sans 18 et brun.
  dessinerEnteteLieu(ctx) {
    const e = this.lieu.etat();
    if (e.multi !== undefined && this.sprites.panScore) {
      poserRendu(ctx, rendre(this.sprites.panScore, 1, 100), SCORE_ARBRE.x, SCORE_ARBRE.y);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.font = 'bold 15px "Berlin Sans FB Demi", "Trebuchet MS", Verdana, sans-serif';
      ctx.fillStyle = SCORE_ARBRE.couleur;
      ctx.fillText(String(e.score), SCORE_ARBRE.x + SCORE_ARBRE.cx,
        SCORE_ARBRE.y + SCORE_ARBRE.base);
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      return;
    }
    const l = [];
    if (e.sur) l.push('donjon ' + (e.niveau + 1) + '/' + e.sur);
    if (e.tours !== undefined) l.push(e.tours + ' pièces');
    if (!l.length) return;
    ctx.textAlign = 'left';
    ctx.font = 'bold 9px Verdana, Arial, sans-serif';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(10,20,35,.9)';
    // Sous le bord haut : les deux premières lignes de la grille sont cachées,
    // l'entête n'y masque donc rien de jouable.
    const x = this.lieu.jeu.margeGauche + 2;
    ctx.strokeText(l.join('   '), x, 12);
    ctx.fillStyle = '#ffd76a';
    ctx.fillText(l.join('   '), x, 12);
  }

  dessinerBulle(ctx, b) {
    const s = this.sprites;
    const F = window.MinipixizFee;
    if (s.fee && b.fs && F) {
      const a = new F.Fee(b.fs, null, null).apparence();
      poserVif(ctx, s.fee, 1, {
        x: b.x, y: b.y + 2, sx: b.sx * 0.8, sy: b.sy * 0.8,
        parties: partiesDeCorps(a.couleurs),
      });
    }
    if (s.mcFaerieBubble) {
      poserVif(ctx, s.mcFaerieBubble, 1, { x: b.x, y: b.y, sx: b.sx, sy: b.sy });
    }
  }

  // spell/imp/Night : Manager.setNightMask masque tout le slot, puis le trou
  // s'ouvre (mask._xscale = 100 - scale). On refait le geste : un voile noir,
  // dans lequel le clip du masque perce une ouverture.
  dessinerNuitNoire(ctx) {
    const n = this.jeu && this.jeu.nuit;
    if (!n || !(n.prc > 0)) return;
    if (!this.calqueNuit) {
      this.calqueNuit = document.createElement('canvas');
      this.calqueNuit.width = SCENE;
      this.calqueNuit.height = SCENE;
    }
    const g = this.calqueNuit.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, SCENE, SCENE);
    g.fillStyle = '#000';
    g.fillRect(0, 0, SCENE, SCENE);
    if (n.ouverture > 0 && this.sprites.nuit) {
      g.globalCompositeOperation = 'destination-out';
      poserVif(g, this.sprites.nuit, 1,
        { x: n.x, y: n.y, sx: n.ouverture * 2.2, sy: n.ouverture * 2.2 });
      g.globalCompositeOperation = 'source-over';
    }
    ctx.save();
    ctx.globalAlpha = Math.min(1, n.prc / 100);
    ctx.drawImage(this.calqueNuit, 0, 0);
    ctx.restore();
    // mcBlackRing : le liseré sombre qui borde l'ouverture.
    if (n.ouverture > 0 && this.sprites.mcBlackRing) {
      poserVif(ctx, this.sprites.mcBlackRing, 1,
        { x: n.x, y: n.y, sx: n.ouverture * 2.2, sy: n.ouverture * 2.2 });
    }
  }

  // Menu.setNight : la scène bleuit à mesure qu'on s'éloigne de midi. Le jeu
  // applique une teinte par plan ; ici la scène est plate, donc un seul voile.
  dessinerNuit(ctx) {
    const c = Math.abs(this.coefNuit - 0.5) * 2;
    if (!(c > 0.02)) return;
    const k = c * NUIT_MAX;
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = 'rgb(' + Math.round(255 - (255 - BLEU_NUIT.r) * k) + ','
      + Math.round(255 - (255 - BLEU_NUIT.v) * k) + ','
      + Math.round(255 - (255 - BLEU_NUIT.b) * k) + ')';
    ctx.fillRect(0, 0, SCENE, SCENE);
    ctx.restore();
  }

  // ── Ce qui vole (combat.js) ──
  dessinerVol(ctx) {
    const jeu = this.jeu, s = this.sprites;
    if (!jeu.partList) return;
    for (const p of jeu.partList) {
      poserVif(ctx, s[p.lien], p.joue ? p.frame + Math.floor(p.age) : p.frame, {
        x: p.x, y: p.y, sx: p.sx, sy: p.sy, rot: p.rot, alpha: p.sa,
        couleur: p.couleur === null ? undefined : p.couleur, melange: p.melange,
      });
    }
    for (const pe of jeu.pList) this.dessinerCreature(ctx, pe);
    for (const t of jeu.shotList) {
      poserVif(ctx, s[t.lien], t.frame, {
        x: t.x, y: t.y, sx: t.sx, sy: t.sy, rot: t.rot, alpha: t.sa, melange: t.melange,
      });
    }
  }

  // Une fée ou un impy : le même clip, animé par le code — pas par un scénario.
  dessinerCreature(ctx, pe) {
    const s = this.sprites;
    const fee = !!pe.fi;
    const sprite = fee ? s.fee : s.imp;
    if (!sprite) return;
    // L'aura de charge : elle grandit avec la vitesse, et dit qu'un choc arrive.
    if (pe.charge > 0 && s.mcDashAura) {
      poserVif(ctx, s.mcDashAura, 1,
        { x: pe.x, y: pe.y, rot: pe.chargeAngle, alpha: pe.charge });
    }
    const couleurs = fee ? pe.apparence().couleurs : pe.couleurs;
    const parties = fee ? partiesDeCorps(couleurs) : partiesDImpy(couleurs);
    // POW_INVISIBILITY : elle ne se voit qu'à quarante pour cent, et les démons
    // la manquent d'autant.
    const invisible = fee && pe.fi.pouvoirs
      && pe.fi.pouvoirs[window.MinipixizCombat.POUVOIR.INVISIBILITE];
    poserVif(ctx, sprite, pe.spinSpeed !== null ? Math.min(24, pe.corps) : 1, {
      x: pe.x, y: pe.y, rot: pe.penche, alpha: invisible ? 40 : 100,
      parties, melange: pe.melange, deform: pe.spinSpeed !== null ? null : deformationsDeVol(pe),
    });
  }

  dessinerElement(ctx, e, gx, gy) {
    // Idem : c'est la partie qui sait où sa grille commence. S'en remettre aux
    // constantes du module posait la pile de l'arbre creux quarante-quatre
    // pixels à gauche de la pièce qui venait de la former.
    this.poser(ctx, e, this.jeu.posX(gx), this.jeu.posY(gy));
  }

  // Pose un élément à un point en pixels. C'est le seul endroit qui sait à quoi
  // ressemble chaque espèce.
  poser(ctx, e, x0, y0) {
    // Un sort peut soulever une bille, la faire glisser, l'effacer ou la blanchir
    // sans jamais toucher sa case : tout cela se lit ici.
    const x = x0 + (e.decalX || 0);
    const y = y0 + (e.decalY || 0);
    // Mc.modColor(1, n) pour l'éclat blanc de l'échange, setPercentColor pour le
    // tremblement de terre : les deux sont le même fondu vers une couleur. On
    // l'arrondit au dixième, sans quoi le cache des teintes enflerait d'une
    // entrée par image.
    let melange = null;
    const blanc = Math.round(Math.max(e.eclat || 0, e.melange ? e.melange.prc : 0) / 10) * 10;
    if (blanc > 0) {
      melange = { prc: Math.min(100, blanc), couleur: e.melange ? e.melange.couleur : 0xFFFFFF };
    }
    const pale = e.alpha !== undefined && e.alpha < 100;
    if (pale) { ctx.save(); ctx.globalAlpha = Math.max(0, e.alpha / 100); }
    this.poserBrut(ctx, e, x, y, melange);
    if (pale) ctx.restore();
  }

  poserBrut(ctx, e, x, y, melange) {
    const s = this.sprites;
    switch (e.et) {
      case E.E.JETON: {
        const frame = this.jeu ? imageJeton(this.jeu, e) : 1;
        const couleur = E.COULEURS[e.type] || E.COULEURS[0];
        poserRendu(ctx, rendre(s.token, frame, TS, couleur, null, null, null, melange), x, y);
        // Les marques se posent par-dessus : la perle noire et l'étoile.
        if (e.special === E.SPECIAL.PERLE && s.marble) {
          poserRendu(ctx, rendre(s.marble, 1, TS), x, y);
        }
        if (e.special === E.SPECIAL.ETOILE && s.star) {
          poserRendu(ctx, rendre(s.star, 1, TS), x, y);
        }
        break;
      }
      case E.E.PIERRE:
        // stone : trois images, de la plus intacte à la plus fendue.
        poserRendu(ctx, rendre(s.stone, Math.max(1, Math.min(3, e.life)), TS), x, y);
        break;
      case E.E.CELLULE:
        poserRendu(ctx, rendre(s.impCell, 1, TS), x, y);
        break;
      case E.E.BOMBE:
        poserRendu(ctx, rendre(s.bomb, 1, TS), x, y);
        break;
      case E.E.OBJET:
        poserRendu(ctx, rendre(s.elItem, 1, TS), x, y);
        break;
      case E.E.OEIL: {
        // L'œil n'a pas de dessin propre dans root.swf : on le rend par un
        // jeton de sa couleur, marqué. Il se distingue par sa pupille.
        poserRendu(ctx, rendre(s.token, 1, TS, E.COULEURS[e.color] || E.COULEURS[0]), x, y);
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(x + TS / 2, y + TS / 2, 4, 0, 6.28); ctx.fill();
        ctx.fillStyle = '#1a1030';
        ctx.beginPath(); ctx.arc(x + TS / 2, y + TS / 2, 2, 0, 6.28); ctx.fill();
        break;
      }
      default:
        break;
    }
  }

  // La colonne de droite : le portrait de la fée, son mana, sa vie, et sous
  // elle la pièce suivante et l'objectif du niveau.
  dessinerInterface(ctx, tmod) {
    const jeu = this.jeu, s = this.sprites;
    const fee = this.fee;

    // ── LE PORTRAIT (inter.Face) ──
    // Le cadre est là même sans fée : c'est un élément du décor, et son absence
    // creuserait un trou dans le panneau.
    // Combien de pièces à venir la fée laisse-t-elle voir ? Sa concentration en
    // décide, et c'est aussi ce qui décale son portrait vers la droite.
    const voitVenir = fee ? Math.floor((fee.carac[CONCENTRATION] || 0) * 0.5) : 0;
    const align = voitVenir > 0 ? 1 : FACE_ALIGN;
    const cx = INTER.portrait.x + (INTER.portrait.l - INTER.portrait.l * FACE_ECHELLE) * align;
    const cy = INTER.portrait.y;
    const t = INTER.portrait.l * FACE_ECHELLE;

    // La colonne des pièces à venir, sous le cadre : elle n'existe que si la fée
    // est assez concentrée pour l'offrir.
    if (voitVenir > 0) this.dessinerSuivantes(ctx, INTER.portrait.x, cy, FACE_ECHELLE, 1, voitVenir);

    // Le portrait se glisse ENTRE le passe-partout du cadre et son liseré, et
    // le masque du cadre le découpe : c'est mot pour mot ce que fait
    // `Std.attachMC(skin.cadre.pic, "picFace", 10)`.
    if (s.interFace) {
      const fond = rendre(s.interFace, 1, t, undefined, null, 'pic');
      poserRendu(ctx, fond, cx, cy);
      if (fee && s.portrait) {
        const a = fee.apparence();
        ctx.save();
        ctx.beginPath();
        ctx.rect(cx + fond.dx, cy + fond.dy, fond.c.width, fond.c.height);
        ctx.clip();
        // gotoAndStop(skin.num + 1) : six corps, six images.
        poserRendu(ctx, rendre(s.portrait, a.num + 1, t, undefined, partiesDeFee(a.couleurs)),
          cx, cy);
        ctx.restore();
      }
      poserRendu(ctx, rendre(s.interFace, 1, t, undefined, null, '>pic'), cx, cy);
    }

    // ── LE MANA (inter.Mana) ── une goutte tous les six pixels, centrées.
    if (fee && s.mana) {
      const max = fee.manaMax();
      const m = (INTER.mana.l - ECART_MANA * max) * 0.5;
      for (let i = 0; i < max; i++) {
        poserRendu(ctx, rendre(s.mana, i < fee.fs.$mana ? 2 : 1, 100),
          INTER.mana.x + m + ECART_MANA * i - 1, INTER.mana.y);
      }
    }

    // ── LA VIE (inter.Life) ── un cœur tous les quatorze.
    if (fee && s.coeur) {
      const max = fee.vieMax();
      const m = (INTER.vie.l - ECART_COEUR * max) * 0.5;
      for (let i = 0; i < max; i++) {
        poserRendu(ctx, rendre(s.coeur, i < fee.fs.$life ? 2 : 1, 100),
          INTER.vie.x + m + ECART_COEUR * i - 1, INTER.vie.y);
      }
    }

    // Et c'est TOUT. `base/Aventure.initFaerieInterface` ne construit que ces
    // trois éléments-là — le portrait, le mana, la vie. Le nom de la fée, la
    // rangée des couleurs restantes, une deuxième boîte « pièce suivante » et le
    // score n'existent nulle part à l'écran : `inter.Score` est déclaré mais
    // jamais instancié, et la pièce à venir se lit DANS le cadre du portrait
    // (mcNext), quand la concentration de la fée la laisse voir.

    this.dessinerMessage(ctx, tmod);
  }

  // Le bandeau qui annonce une chaîne ou une couleur finie. Les deux modes s'en
  // servent, d'où sa place à part.
  dessinerMessage(ctx, tmod) {
    if (!(this.messageT > 0) || !this.message) return;
    this.messageT -= tmod;
    const l = this.bassin ? SCENE : LARGEUR;
    ctx.textAlign = 'center';
    ctx.font = 'bold 10px Verdana, Arial, sans-serif';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(10,40,25,.9)';
    ctx.strokeText(this.message, l / 2, HAUTEUR / 2 - 20);
    ctx.fillStyle = '#ffd76a';
    ctx.fillText(this.message, l / 2, HAUTEUR / 2 - 20);
    ctx.textAlign = 'left';
  }

  // La scène est carrée (240 × 240, Cs.mcw × Cs.mch) : on l'agrandit du facteur
  // qui tient à l'écran, entier tant que possible — les dessins font 16 px, un
  // facteur fractionnaire les rendrait flous.
  redimensionner() {
    const parent = this.canvas.parentElement || document.body;
    const dispo = Math.min(
      (parent.clientWidth || SCENE) / SCENE,
      (parent.clientHeight || SCENE) / SCENE);
    const entier = Math.floor(dispo);
    const k = (entier >= 1 && entier / dispo >= 0.8) ? entier : dispo;
    this.echelle = k;
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.canvas.width = SCENE * this.dpr;
    this.canvas.height = SCENE * this.dpr;
    this.canvas.style.width = (SCENE * k) + 'px';
    this.canvas.style.height = (SCENE * k) + 'px';
  }

  // ── Commandes ──
  // Clavier pour le bureau, quatre zones tactiles pour le téléphone. Le jeu
  // d'origine se joue aux flèches (Cm.pref.$key) ; on garde ça, plus ZQSD.
  brancherCommandes(racine) {
    const touches = {
      ArrowLeft: 'gauche', ArrowRight: 'droite', ArrowDown: 'bas', ArrowUp: 'tourner',
      q: 'gauche', d: 'droite', s: 'bas', z: 'tourner', a: 'gauche', w: 'tourner',
      ' ': 'tourner',
    };
    window.addEventListener('keydown', (ev) => {
      // Cm.pref.$key[4] — la touche d'AIDE. Le jeu d'origine n'écoute que le
      // premier appui (flHelpRelease) : rester appuyé n'enchaîne pas les sorts.
      if (ev.key === 'Control' || ev.key === 'Shift' || ev.key === 'e') {
        if (!this.aideEnfoncee) { this.aideEnfoncee = true; this.appelerFee(); }
        ev.preventDefault();
        return;
      }
      const k = touches[ev.key];
      if (k) { this.entree[k] = true; ev.preventDefault(); }
    });
    window.addEventListener('keyup', (ev) => {
      if (ev.key === 'Control' || ev.key === 'Shift' || ev.key === 'e') this.aideEnfoncee = false;
    });
    window.addEventListener('keyup', (ev) => {
      const k = touches[ev.key];
      if (k) { this.entree[k] = false; ev.preventDefault(); }
    });
    const boutons = racine.querySelectorAll('[data-cmd]');
    Array.prototype.forEach.call(boutons, (b) => {
      const cmd = b.getAttribute('data-cmd');
      const on = (ev) => { ev.preventDefault(); this.entree[cmd] = true; b.classList.add('on'); };
      const off = (ev) => { ev.preventDefault(); this.entree[cmd] = false; b.classList.remove('on'); };
      b.addEventListener('touchstart', on, { passive: false });
      b.addEventListener('touchend', off, { passive: false });
      b.addEventListener('touchcancel', off, { passive: false });
      b.addEventListener('mousedown', on);
      b.addEventListener('mouseup', off);
      b.addEventListener('mouseleave', off);
    });
    const aide = racine.querySelector('[data-cmd-aide]');
    if (aide) {
      const appel = (ev) => { ev.preventDefault(); this.appelerFee(); };
      aide.addEventListener('touchstart', appel, { passive: false });
      aide.addEventListener('mousedown', appel);
    }
  }

  /**
   * La fée a changé — elle a mangé, on lui a donné un objet, on en a choisi une
   * autre. Faerie.setInfo relit la fiche : ses caractéristiques, sa maniabilité
   * et ses sorts en dépendent, et un globe posé dans le sac du joueur doit se
   * sentir tout de suite.
   */
  poserFee(fi) {
    this.fee = fi;
    if (this.champ && this.champ.faerieList[0] && fi) this.champ.faerieList[0].poserInfo(fi);
  }

  // Le joueur appelle sa fée. Elle ne lancera son sort qu'au bout du tour —
  // c'est ce délai qui fait qu'on appelle en prévision, pas en réaction.
  appelerFee() {
    if (!this.jeu || this.jeu.termine) return false;
    return this.jeu.appelerAide();
  }
}

/**
 * Le portrait d'une fée, seul, dans son cadre — pour l'inventaire, où on la
 * regarde en face au lieu de la voir du coin de l'œil pendant la partie.
 *
 * @returns {HTMLCanvasElement}
 */
function portraitDeFee(sprites, fee, taille) {
  const c = document.createElement('canvas');
  c.width = taille; c.height = taille;
  const g = c.getContext('2d');
  if (!sprites.interFace) return c;
  const fond = rendre(sprites.interFace, 1, taille, undefined, null, 'pic');
  g.drawImage(fond.c, fond.dx, fond.dy);
  if (fee && sprites.portrait) {
    const a = fee.apparence();
    g.save();
    g.beginPath();
    g.rect(fond.dx, fond.dy, fond.c.width, fond.c.height);
    g.clip();
    const p = rendre(sprites.portrait, a.num + 1, taille, undefined, partiesDeFee(a.couleurs));
    g.drawImage(p.c, p.dx, p.dy);
    g.restore();
  }
  const dessus = rendre(sprites.interFace, 1, taille, undefined, null, '>pic');
  g.drawImage(dessus.c, dessus.dx, dessus.dy);
  return c;
}

// Une ligne de cœurs ou de gouttes, comme inter.Life / inter.Mana.
function jauge(sprites, cle, plein, max, ecart) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, ecart * max + 4);
  c.height = ecart + 10;
  const g = c.getContext('2d');
  const s = sprites[cle];
  if (!s) return c;
  for (let i = 0; i < max; i++) {
    const r = rendre(s, i < plein ? 2 : 1, 100);
    g.drawImage(r.c, ecart * i + r.dx, r.dy + 2);
  }
  return c;
}

window.MinipixizClient = {
  Client, charger, rendre, poserRendu, poserVif, imagePeinte, imageJeton, images,
  portraitDeFee, jauge, partiesDeFee, partiesDeCorps, partiesDImpy, deformationsDeVol,
  fondre, teinter,
  LARGEUR, HAUTEUR, LIGNES_CACHEES, SCENE, COLONNE_X, INTER, ECART_COEUR, ECART_MANA,
};

})();
