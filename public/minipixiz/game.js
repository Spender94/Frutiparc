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
//
// `inter.margin` s'ajoute à la hauteur : le donjon et l'arc-en-ciel donnent 10
// au portrait (`intFace.margin = 10`), ce qui pousse le mana et la vie d'autant.
function pilerInterface(margeFace) {
  const m = margeFace || 0;
  return {
    portrait: { x: COLONNE_X, y: MARGE, l: 100, h: 70 },
    mana: { x: COLONNE_X, y: MARGE + 70 + m + 3, l: 100, h: 6 },
    vie: { x: COLONNE_X, y: MARGE + 70 + m + 3 + 6 + 3, l: 100, h: 18 },
  };
}
const INTER = pilerInterface(0);
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
const ASCENSEUR_X = 8;                // base/Dungeon : `elevator._x = 8`
// Les six roues du treuil, telles que `mcWheelSystem` et `mcWheelSystemBack`
// les posent — place et taille. Les deux assemblages sont accrochés en x = 0.
const ROUES_DEVANT = [
  { x: 8, y: 2.9, k: 1 }, { x: 135.95, y: -24.45, k: 0.5 }, { x: 115.25, y: 6.4, k: 0.5 },
];
const ROUES_FOND = [
  { x: 90.15, y: 23.85, k: 1.5 }, { x: 0.25, y: -25.65, k: 0.8 }, { x: 46.9, y: -36.15, k: 0.5 },
];
// inter.Wheel — la roue de l'arc-en-ciel : 80 × 80, `mx = 10`, son moyeu en
// (42, 42), douze flammes à quarante-deux pixels, et le lot au centre à 40 %.
const ROUE_LOT = { x: COLONNE_X + 10, cx: 42, cy: 42, rayon: 42, flammes: 12, lot: 40 };

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

/**
 * Manager.fadeSlot — l'IRIS, la transition du jeu : le nouvel écran se révèle
 * dans un cercle qui grandit depuis le point touché et glisse vers le centre,
 * bordé d'un anneau de lumière. `checkFade` : prc += 0,2 par image puis ×1,2.
 *
 * On photographie l'ANCIEN écran, on le pose sur le nouveau, et on y perce le
 * trou qui grandit. Quand le cercle a tout couvert, l'iris se retire.
 */
class Iris {
  constructor(source, x, y) {
    this.img = document.createElement('canvas');
    this.img.width = SCENE;
    this.img.height = SCENE;
    this.img.getContext('2d').drawImage(source, 0, 0, SCENE, SCENE);
    this.tampon = document.createElement('canvas');
    this.tampon.width = SCENE;
    this.tampon.height = SCENE;
    this.prc = 0;
    this.x = (x === undefined || x === null) ? SCENE / 2 : x;
    this.y = (y === undefined || y === null) ? SCENE / 2 : y;
  }

  /** Dessine une image de la transition ; rend faux quand elle est finie. */
  dessiner(ctx, tmod) {
    this.prc += 0.2 * tmod;
    this.prc *= Math.pow(1.2, tmod);
    if (this.prc > 105) return false;
    const c = Math.min(1, this.prc / 100);
    const cx = SCENE / 2 * c + this.x * (1 - c);
    const cy = SCENE / 2 * c + this.y * (1 - c);
    // À 100 %, le cercle doit couvrir les coins : 170 px depuis le centre.
    const r = (this.prc / 100) * 175;
    const g = this.tampon.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, SCENE, SCENE);
    g.drawImage(this.img, 0, 0);
    g.globalCompositeOperation = 'destination-out';
    g.beginPath();
    g.arc(cx, cy, Math.max(0, r), 0, 6.2832);
    g.fill();
    ctx.drawImage(this.tampon, 0, 0, SCENE, SCENE);
    // L'anneau de lumière au bord de l'ouverture (slotMaskLight).
    if (r > 1) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,240,0.55)';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(cx, cy, r + 2, 0, 6.2832);
      ctx.stroke();
      ctx.restore();
    }
    return true;
  }
}

// Coupe un texte aux espaces pour tenir dans une largeur — les champs du jeu
// enveloppent leurs phrases, le canevas ne sait pas le faire seul.
function decouperTexte(ctx, texte, largeur) {
  const lignes = [];
  for (const brut of String(texte).split('\n')) {
    let ligne = '';
    for (const mot of brut.split(' ')) {
      const essai = ligne ? ligne + ' ' + mot : mot;
      if (ctx.measureText(essai).width > largeur && ligne) {
        lignes.push(ligne);
        ligne = mot;
      } else {
        ligne = essai;
      }
    }
    lignes.push(ligne);
  }
  return lignes;
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
const nombreSur = (v, n) => Math.max(0, Math.min(Math.floor(Number(v) || 0), n - 1));

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
    // La carte de la forêt suit la souris (base/Forest.update) et se touche :
    // on garde la position du pointeur dans le repère de la scène.
    this.pointeur = null;
    const suivre = (cx, cy) => {
      const r = this.canvas.getBoundingClientRect();
      this.pointeur = { x: (cx - r.left) / this.echelle, y: (cy - r.top) / this.echelle };
    };
    this.canvas.addEventListener('mousemove', (ev) => suivre(ev.clientX, ev.clientY));
    this.canvas.addEventListener('touchmove', (ev) => {
      if (ev.touches[0]) suivre(ev.touches[0].clientX, ev.touches[0].clientY);
    }, { passive: true });
    this.canvas.addEventListener('mouseleave', () => { this.pointeur = null; });
    this.canvas.addEventListener('click', (ev) => {
      if (!this.carteForet && !this.nouvelle) return;
      suivre(ev.clientX, ev.clientY);
      if (this.nouvelle) {
        // Le bouton de sortie, au coin — News.tryToQuit.
        if (this.pointeur.x > SCENE - 50 && this.pointeur.y > SCENE - 50) {
          const n = this.nouvelle;
          this.nouvelle = null;
          if (n.surFermer) n.surFermer();
        }
        return;
      }
      this.clicCarteForet(this.pointeur.x, this.pointeur.y);
    });
    this.redimensionner();
    window.addEventListener('resize', () => this.redimensionner());
    window.addEventListener('orientationchange', () => setTimeout(() => this.redimensionner(), 120));
  }

  nouvellePartie(opts) {
    opts = opts || {};
    eclats.length = 0;
    this.bassin = null;
    this.lieu = null;
    this.cine = null;
    this.carteForet = null;
    this.nouvelle = null;
    this.nouvelleEnAttente = null;
    this.dialogue = null;
    this.pause = false;
    this.commencerOuverture((opts.niveau || 0) + 1);
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
    this.cine = null;
    this.carteForet = null;
    this.nouvelle = null;
    this.nouvelleEnAttente = null;
    this.dialogue = null;
    this.pause = false;
    this.ouverture = null;             // le bassin s'ouvre sur sa bulle, pas sur la gerbe
    // Les événements passent par `annonce` pour les effets de dessin, puis vont
    // au gestionnaire DU BASSIN — pas à celui de la forêt. L'écraser envoyait
    // la fin d'une partie de bassin au code des courses, qui affichait son
    // écran « PERDU » pendant que personne ne ramenait au menu.
    this.bassin = new B.Bassin(Object.assign({}, opts || {},
      { surEvenement: (n, d) => this.annonce(n, d, opts && opts.surEvenement) }));
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
    this.cine = null;
    this.carteForet = null;
    this.nouvelle = null;
    this.nouvelleEnAttente = null;
    this.dialogue = null;
    this.pause = false;
    // Même chose qu'au bassin : les événements du lieu vont au gestionnaire du
    // LIEU, une fois les effets de dessin servis.
    this.lieu = new X[classe](Object.assign({}, opts || {},
      { surEvenement: (n, d) => this.annonce(n, d, opts && opts.surEvenement) }));
    // Les lieux descendent tous de l'aventure : chacun s'ouvre sur son bouquet.
    this.commencerOuverture((this.lieu.level || 0) + 1);
    this.jeu = this.lieu.jeu;
    this.champ = this.lieu.champ;
    this.jeu.entree = this.entree;
    if (this.lieu.fi) this.fee = this.lieu.fi;
    this.dernier = 0;
    this.reste = 0;
    return this.lieu;
  }

  /**
   * base/Forest.initCheckpoint — la carte de la forêt.
   *
   * Une pancarte par relais gagné (mcCheckpointPicture, une image chacune),
   * empilées tous les 108 pixels dans un chariot qui suit la souris, et le
   * bouton de sortie dans le coin. Elle ne s'affiche que si un relais existe :
   * sinon la course part directement (le jeu fait pareil).
   *
   * @param {object} o  { relais: [{niveau, nom}], surChoix(niveau), surQuitter() }
   */
  ouvrirCarteForet(o) {
    this.bassin = null;
    this.lieu = null;
    this.jeu = null;
    this.champ = null;
    this.cine = null;
    this.ouverture = null;
    this.nouvelle = null;
    this.pause = false;
    this.carteForet = {
      relais: o.relais || [],
      surChoix: o.surChoix || null,
      surQuitter: o.surQuitter || null,
      defile: 0,
      sMax: Math.max(0, (16 + (o.relais || []).length * 108) - SCENE),
      zones: [],
    };
    return this.carteForet;
  }

  fermerCarteForet() { this.carteForet = null; }

  dessinerCarteForet(ctx, tmod) {
    const s = this.sprites, c = this.carteForet;
    // Le fond de la carte est un décor plein cadre ; le cadre de la forêt vit
    // derrière lui, comme dans le jeu (la carte s'attache dans l'écran de la
    // forêt, par-dessus son décor).
    if (s.carteForet) poserRendu(ctx, rendre(s.carteForet, 1, 100), 0, 0);
    else { ctx.fillStyle = '#1c3a24'; ctx.fillRect(0, 0, SCENE, SCENE); }

    // Le chariot suit la souris : dy = (souris − 120) × 0,1 par image.
    if (this.pointeur && c.sMax > 0) {
      const dy = (this.pointeur.y - SCENE * 0.5) * 0.1 * tmod;
      c.defile = Math.max(-c.sMax, Math.min(c.defile - dy, 0));
    }

    c.zones = [];
    for (let i = 0; i < c.relais.length; i++) {
      const r = c.relais[i];
      const x = 8, y = 8 + i * 108 + c.defile;
      if (y > SCENE || y < -120) continue;
      if (s.relaisImage) {
        const frame = Math.min(i + 1, s.relaisImage.etats.length);
        poserRendu(ctx, rendre(s.relaisImage, frame, 100), x, y);
      }
      // Les deux champs de la pancarte : le grand numéro vert (fonte de titre,
      // 110 px dans le jeu) et le nom du relais au-dessus.
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.font = 'bold 96px "Berlin Sans FB Demi", "Trebuchet MS", Verdana, sans-serif';
      ctx.fillStyle = 'rgb(32,149,64)';
      ctx.fillText(String(r.niveau + 1), x + 167, y + 96);
      ctx.font = 'bold 13px "Berlin Sans FB Demi", "Trebuchet MS", Verdana, sans-serif';
      ctx.fillStyle = 'rgb(189,240,199)';
      ctx.fillText(r.nom || '', x + 167, y + 16);
      ctx.textBaseline = 'top';
      c.zones.push({ niveau: r.niveau, x: 0, y, l: SCENE, h: 108 });
    }

    // Le bouton de sortie, accroché au coin bas-droit (Slot.initButQuit). Le
    // survoler déplie son étiquette (image 2), comme dans le jeu.
    this.dessinerBoutonQuitter(ctx);
    c.zones.push({ quitter: true, x: SCENE - 46, y: SCENE - 46, l: 46, h: 46 });
  }

  clicCarteForet(x, y) {
    const c = this.carteForet;
    if (!c) return;
    // Le bouton de sortie d'abord : il est par-dessus les pancartes.
    for (let i = c.zones.length - 1; i >= 0; i--) {
      const z = c.zones[i];
      if (x < z.x || x > z.x + z.l || y < z.y || y > z.y + z.h) continue;
      if (z.quitter) { if (c.surQuitter) c.surQuitter(); return; }
      if (c.surChoix) c.surChoix(z.niveau);
      return;
    }
  }

  annonce(nom, d, cible) {
    // Aventure.initStep(2) : le niveau gagné, la fée s'exclame en s'envolant.
    if (nom === 'finPartie' && d && d.gagne) {
      this.react((window.MinipixizLangue || {}).END_CHEER);
    }
    // base/Tree.gameOver : un record vaut mieux qu'un panneau de défaite — le
    // jeu montre alors l'écran de nouvelle à la place du « Game Over ».
    if (nom === 'record' && d && d.score !== undefined) {
      this.nouvelleEnAttente = { genre: 'record', score: d.score };
    }
    // Base.gameOver — perdre ne pose pas de question : l'écran vire au noir,
    // le panneau s'affiche une centaine d'images, puis `tryToClose` ramène à
    // la clairière. On lance ici le fondu ; `dessinerCine` fera le reste et
    // émettra « rideau » quand il sera temps de partir.
    if (nom === 'finPartie' && d && !d.gagne && !this.cine && !this.nouvelle) {
      if (this.nouvelleEnAttente) {
        const attente = this.nouvelleEnAttente;
        this.nouvelleEnAttente = null;
        this.ouvrirNouvelle(Object.assign(attente, {
          surFermer: () => this.annonce('rideau', {}, cible || null),
        }));
      } else {
        this.cine = { phase: 1, prc: 1, cible: cible || null };
      }
    }
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
    const dest = cible || this.surEvenement;
    if (dest) dest(nom, d);
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
      if (this.pause) {
        this.reste = 0;
      } else if (this.cine && this.cine.phase === 2) {
        // Base.initStep(11) : au noir complet, `game.kill()`. Plus rien ne bouge
        // sous le panneau de fin.
        this.reste = 0;
      } else if (this.nouvelle) {
        this.reste = 0;
      } else if (this.ouverture) {
        // Le bouquet d'abord : le plateau attend que la gerbe se referme
        // (Aventure.initStep(1) ne lance le jeu qu'après).
        this.reste = 0;
      } else if (mode) {
        while (this.reste >= 1 && pas < 6) { mode.update(1); this.reste -= 1; pas++; }
      } else if (this.jeu) {
        while (this.reste >= 1 && pas < 6) { this.jeu.update(1); this.reste -= 1; pas++; }
      } else {
        this.reste = 0;
      }
      // Game.update, étape JEU : toutes les ~cinq cents images, si personne ne
      // parle déjà, la fée regarde autour d'elle et dit un mot.
      if (pas && this.jeu && this.jeu.step === E.ETAPE.JEU && this.fee
        && !this.dialogue && Math.random() * 500 < pas) {
        this.ambiance();
      }
      this.dessiner(dt * IPS);
    };
    this.raf = requestAnimationFrame(boucle);
  }

  // Manager.fadeSlot : le nouvel écran s'ouvre dans l'iris — le cercle qui
  // grandit depuis le point touché. On photographie l'écran qu'on quitte.
  irisDepuis(source, x, y) {
    if (source) this.iris = new Iris(source, x, y);
  }

  dessiner(tmod) {
    this.dessinerScene(tmod);
    this.dessinerPause(this.ctx, tmod);
    if (this.iris && !this.iris.dessiner(this.ctx, tmod)) this.iris = null;
  }

  dessinerScene(tmod) {
    const ctx = this.ctx, jeu = this.jeu;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, SCENE, SCENE);
    const s = this.sprites;
    if (this.nouvelle) { this.dessinerNouvelle(ctx); return; }
    if (this.carteForet) { this.dessinerCarteForet(ctx, tmod); return; }
    if (this.bassin) { this.dessinerBassin(ctx, tmod); this.dessinerCine(ctx, tmod); return; }
    if (this.lieu) {
      this.dessinerLieu(ctx, tmod);
      this.dessinerDialogue(ctx, tmod);
      this.dessinerOuverture(ctx, tmod);
      this.dessinerCine(ctx, tmod);
      return;
    }

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

    // 6. La bulle de la fée, le bouquet d'ouverture, et s'il faut mourir, le
    //    rideau par-dessus tout.
    this.dessinerDialogue(ctx, tmod);
    this.dessinerOuverture(ctx, tmod);
    this.dessinerCine(ctx, tmod);
  }

  /**
   * Manager.setPause — la pause. Le voile violet monte vite (pauseAlpha part de
   * −90 et se divise par deux à chaque image), le panneau s'affiche, et plus
   * rien ne bouge. Elle ne vaut que pendant une partie : les écrans d'attente
   * n'ont rien à suspendre.
   */
  basculerPause() {
    const enJeu = (this.jeu || this.bassin || this.lieu)
      && !this.cine && !this.nouvelle && !this.carteForet;
    if (!this.pause && !enJeu) return;
    this.pause = !this.pause;
    if (this.pause) this.pauseAlpha = -90;
  }

  dessinerPause(ctx, tmod) {
    if (!this.pause) return;
    this.pauseAlpha *= Math.pow(0.5, tmod);
    const prc = Math.min(90, 90 + this.pauseAlpha);
    // Mc.setPercentColor(slot, prc, 0x938DC3) : un fondu linéaire vers le
    // violet — un aplat de cette couleur, à cette opacité.
    ctx.fillStyle = 'rgba(147,141,195,' + (prc / 100).toFixed(3) + ')';
    ctx.fillRect(0, 0, SCENE, SCENE);
    // Le panneau porte déjà le mot, en pleins et déliés.
    if (this.sprites.panPause) {
      poserRendu(ctx, rendre(this.sprites.panPause, 1, 100), 0, 0);
    }
  }

  /**
   * FaerieInfo.react / speak — la fée PARLE. Une bulle arrondie près de son
   * portrait, le temps de lire (18 images + 1,9 par lettre), une seule à la
   * fois. Sa rangée d'HUMEUR décide de ce qu'elle dit — et les trous de la
   * rangée sont ses silences.
   */
  react(rangees) {
    const fee = this.fee;
    if (!fee || !rangees) return;
    const rang = rangees[nombreSur(fee.fs.$humor, rangees.length)];
    if (!rang || !rang.length) return;
    const brut = rang[Math.floor(Math.random() * rang.length)];
    const texte = this.enrichir(brut);
    if (texte) this.parler(texte);
  }

  // FaerieInfo.getRichStr — les mots à trous du dialogue.
  enrichir(str) {
    if (str === null || str === undefined) return null;
    const fee = this.fee;
    const L = window.MinipixizLangue || {};
    const O = window.MinipixizObjets;
    if (L.CLOUD_SHAPE && str.indexOf('$cloud') >= 0) {
      str = str.split('$cloud').join(
        L.CLOUD_SHAPE[Math.floor(Math.random() * L.CLOUD_SHAPE.length)]);
    }
    str = str.split('$name').join(fee.fs.$name);
    if (str.indexOf('$other') >= 0) {
      // Une autre fée de la fiche — et sans compagne, le silence.
      const liste = ((fee.carte || {}).$faerie || []).filter((f) => f && f !== fee.fs);
      if (!liste.length) return null;
      str = str.split('$other').join(liste[Math.floor(Math.random() * liste.length)].$name);
    }
    const gout = (quel) => {
      const l = ((fee.fs.$taste || [])[quel]) || [];
      const id = l.length ? 300 + l[Math.floor(Math.random() * l.length)] * 3 : 300;
      const it = O && O.info(id);
      return (it && it.nom) || 'de la brioche';
    };
    if (str.indexOf('$like') >= 0) str = str.split('$like').join(gout(0));
    if (str.indexOf('$dislike') >= 0) str = str.split('$dislike').join(gout(1));
    return str;
  }

  parler(texte) {
    if (this.dialogue) return;         // Manager.slot.dial : une bulle à la fois
    this.dialogue = { texte: String(texte), timer: 18 + String(texte).length * 1.9 };
  }

  /**
   * FaerieInfo.reactAmbience — le bavardage de jeu. Toutes les ~cinq cents
   * images, la fée regarde le plateau : presque vide, elle sent la fin ; des
   * démons, elle crie ; trop plein, elle s'inquiète ; sinon, elle papote.
   */
  ambiance() {
    const L = window.MinipixizLangue || {};
    const jeu = this.jeu;
    if (!jeu || !jeu.coefRemplissage) return;
    let liste = L.AMBIANCE_NORMAL, rnd = 3;
    const c = jeu.coefRemplissage();
    if (c < 0.1) { liste = L.AMBIANCE_FINISH; rnd = 3; }
    if (this.champ && this.champ.impList.length > 0) { liste = L.AMBIANCE_BATTLE; rnd = 1; }
    if (c > 0.5) { liste = L.AMBIANCE_STRESS; rnd = 2; }
    if (Math.floor(Math.random() * rnd) === 0) this.react(liste);
  }

  dessinerDialogue(ctx, tmod) {
    const d = this.dialogue;
    if (!d) return;
    d.timer -= tmod;
    if (d.timer <= 0) { this.dialogue = null; return; }
    // Dialog.setSkin + Aventure.attachDialog, à la géométrie près : la largeur
    // suit le texte, la bulle s'accroche vers (190, 64) et sa pointe la relie
    // au portrait.
    ctx.font = '9px Verdana, Arial, sans-serif';
    const w = Math.min(Math.max(70, d.texte.length * 3), 130);
    const lignes = decouperTexte(ctx, d.texte, w - 8);
    const h = lignes.length * 11 + 8;
    const x = Math.min(190 - w * 0.5, SCENE - w - 4);
    const y = 64;
    const arrondi = (px, py, pw, ph, r, couleur) => {
      ctx.fillStyle = couleur;
      ctx.beginPath();
      ctx.moveTo(px + r, py);
      ctx.arcTo(px + pw, py, px + pw, py + ph, r);
      ctx.arcTo(px + pw, py + ph, px, py + ph, r);
      ctx.arcTo(px, py + ph, px, py, r);
      ctx.arcTo(px, py, px + pw, py, r);
      ctx.fill();
    };
    arrondi(x - 2, y - 2, w + 4, h + 4, 8, '#AB9CC9');
    arrondi(x, y, w, h, 4, '#E7E3F0');
    // La pointe, vers le haut — c'est de là que vient la voix.
    const px = Math.min(x + w - 14, 190 - 6);
    ctx.fillStyle = '#E7E3F0';
    ctx.beginPath();
    ctx.moveTo(px, y + 1);
    ctx.lineTo(px + 12, y + 1);
    ctx.lineTo(px + 9, y - 9);
    ctx.fill();
    ctx.fillStyle = 'rgb(108,89,159)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    let ty = y + 4;
    for (const l of lignes) { ctx.fillText(l, x + w / 2, ty); ty += 11; }
    // Le portrait de la parleuse, dans son médaillon, à gauche de la bulle.
    if (this.fee) {
      if (!d.portrait) d.portrait = portraitDeFee(this.sprites, this.fee, 34);
      ctx.drawImage(d.portrait, x - 40, y - 4);
    }
  }

  /**
   * News.setNews — l'écran des bonnes nouvelles : un relais gagné (avec la
   * photo du lieu) ou un record à l'arbre creux. Il attend qu'on le quitte par
   * son bouton, et alors seulement la clairière revient.
   *
   * @param {object} o  { genre: 'relais'|'record', numero, nom, score, surFermer }
   */
  ouvrirNouvelle(o) {
    this.cine = null;
    this.ouverture = null;
    this.nouvelle = o || {};
  }

  dessinerNouvelle(ctx) {
    const s = this.sprites, n = this.nouvelle;
    const relais = n.genre === 'relais';
    if (s.nouvelle) poserRendu(ctx, rendre(s.nouvelle, relais ? 1 : 2, 100), 0, 0);
    else { ctx.fillStyle = '#1c3a24'; ctx.fillRect(0, 0, SCENE, SCENE); }
    if (relais && s.nouvelleImage) {
      // Le plan pose la photo à 130 % (ancre `pic` de l'écran).
      const a = (s.nouvelle && s.nouvelle.ancrages && s.nouvelle.ancrages.pic)
        || { x: 51, y: 14, k: 1.3 };
      const frame = Math.max(1, Math.min(n.numero || 1, s.nouvelleImage.etats.length));
      poserRendu(ctx, rendre(s.nouvelleImage, frame, 100 * (a.k || 1)), a.x, a.y);
    }
    // field0 — vingt pixels, vert pâle, centré. Les mots du jeu, tels quels.
    const texte = relais
      ? 'Felicitations vous avez atteint ' + (n.nom || '') + ' !!'
      : 'Bravo vous avez etabli un nouveau record !!\n' + (n.score || 0) + ' points!';
    ctx.font = 'bold 15px "Berlin Sans FB Demi", "Trebuchet MS", Verdana, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgb(200,242,201)';
    let y = relais ? 166 : 158;
    for (const ligne of decouperTexte(ctx, texte, 205)) {
      ctx.fillText(ligne, 122, y);
      y += 17;
    }
    this.dessinerBoutonQuitter(ctx);
  }

  dessinerBoutonQuitter(ctx) {
    const s = this.sprites;
    if (!s.boutonQuitter) return;
    const p = this.pointeur;
    const dessus = p && p.x > SCENE - 46 && p.y > SCENE - 46;
    poserRendu(ctx, rendre(s.boutonQuitter, dessus ? 2 : 1, 100), SCENE, SCENE);
  }

  /**
   * Aventure.initBouquet — l'ouverture d'un niveau. La gerbe jaillit d'un
   * point (ressort : vit += écart×0,1, frottement 0,75), porte le numéro du
   * niveau, tient quarante images puis se referme ; alors seulement les pièces
   * tombent. Pendant ce temps, rien ne bouge — le plateau attend.
   */
  commencerOuverture(numero) {
    this.ouverture = { sc: 1, vit: 0, trg: 100, tenue: 40, numero };
  }

  dessinerOuverture(ctx, tmod) {
    const o = this.ouverture;
    if (!o) return;
    const ds = o.trg - o.sc;
    o.vit += Math.max(-10, Math.min(ds * 0.1, 10)) * tmod;
    o.vit *= Math.pow(0.75, tmod);
    o.sc += o.vit * tmod;
    if (o.trg === 100) {
      o.tenue -= tmod;
      if (o.tenue < 0) o.trg = 0;
    } else if (o.sc < 1) {
      this.ouverture = null;
      return;
    }
    const jeu = this.jeu;
    const cx = jeu ? (jeu.margeGauche + jeu.largeur) * 0.5 : SCENE / 2;
    const cy = jeu ? jeu.hauteur * 0.5 : SCENE / 2;
    const k = Math.max(0.01, o.sc / 100);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(k, k);
    if (this.sprites.bouquet) {
      poserRendu(ctx, rendre(this.sprites.bouquet, 1, 100), 0, 0);
    }
    // panel.field : le numéro du niveau, en gros, au cœur de la gerbe.
    ctx.font = 'bold 74px "Berlin Sans FB Demi", "Trebuchet MS", Verdana, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgb(136,84,158)';
    ctx.fillText(String(o.numero), 1, 28);
    ctx.textBaseline = 'top';
    ctx.restore();
  }

  /**
   * Base.gameOver, en deux temps : le fondu au noir (flashInfo prc 1 → 100,
   * ×1,1 par image), puis le panneau « Game Over » pendant une centaine
   * d'images. À dix images de la fin, `tryToClose` — ici l'événement `rideau`,
   * que la page écoute pour rouvrir la clairière.
   */
  dessinerCine(ctx, tmod) {
    const c = this.cine;
    if (!c) return;
    if (c.phase === 1) {
      c.prc = Math.min(100, c.prc * Math.pow(1.1, tmod));
      ctx.fillStyle = 'rgba(0,0,0,' + (c.prc / 100).toFixed(3) + ')';
      ctx.fillRect(0, 0, SCENE, SCENE);
      if (c.prc >= 100) { c.phase = 2; c.timer = 100; }
      return;
    }
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, SCENE, SCENE);
    // Le panneau est un tableau plein cadre : la forêt sous un ciel violet.
    if (this.sprites.panPerdu) {
      poserRendu(ctx, rendre(this.sprites.panPerdu, 1, SCENE), SCENE / 2, SCENE / 2);
    }
    c.timer -= tmod;
    if (c.timer <= 10 && !c.dit) {
      c.dit = true;
      this.annonce('rideau', {}, c.cible);
    }
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

    // Les fruits du multiplicateur pendent DERRIÈRE le tronc (`dm.under`), et
    // les roues du fond du donjon tournent derrière la grille (DP_UNDER).
    this.dessinerFruits(ctx);
    this.dessinerAscenseur(ctx, false);

    for (const e of jeu.eList) this.dessinerElement(ctx, e, e.px, e.py);
    if (jeu.piece) for (const c of jeu.piece.cases()) this.poser(ctx, c.e, c.x, c.y);
    this.dessinerVol(ctx);
    bougerEclats(ctx, tmod);

    // L'escargot est posé à DP_SKIN_MIDDLE, comme le montant du tronc, mais
    // avant lui : il grimpe DERRIÈRE l'écorce. Le plancher du donjon et ses
    // roues de devant, eux, sont à DP_SPRITE_FRONT — au-dessus des jetons.
    this.dessinerEscargot(ctx);
    this.dessinerAscenseur(ctx, true);
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

  /**
   * base/Dungeon.initElevator — le plancher qui monte, et son treuil.
   *
   * `mcElevator` en x = 8, `mcWheelSystem` et `mcWheelSystemBack` en x = 0, tous
   * trois à la hauteur du sol. Six roues, chacune à son rapport : trois devant
   * la grille, trois derrière.
   *
   * @param {boolean} devant vrai pour DP_SPRITE_FRONT, faux pour DP_UNDER
   */
  dessinerAscenseur(ctx, devant) {
    const s = this.sprites;
    const e = this.lieu.etat();
    if (e.ascenseur === undefined) return;
    const y = e.ascenseur;
    const rot = e.rotations || [0, 0, 0, 0, 0, 0];
    const poserRoue = (r, angle) => {
      if (!s.roue) return;
      // La roue tourne au CANEVAS, pas au rendu : un dessin par angle aurait
      // rempli le cache d'une image par battement d'horloge.
      const rendu = rendre(s.roue, 1, 100 * r.k);
      ctx.save();
      ctx.translate(r.x, y + r.y);
      ctx.rotate(angle * Math.PI / 180);
      ctx.drawImage(rendu.c, rendu.dx, rendu.dy);
      ctx.restore();
    };
    const jeu = devant ? ROUES_DEVANT : ROUES_FOND;
    const de = devant ? 0 : 3;
    if (devant && s.ascenseur) poserRendu(ctx, rendre(s.ascenseur, 1, 100), ASCENSEUR_X, y);
    for (let i = 0; i < jeu.length; i++) poserRoue(jeu[i], rot[de + i]);
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

  /**
   * Ce que le lieu affiche en propre.
   *
   * L'arbre creux a sa PLAQUE (base/Tree.initScore) : `panScore` en (2,2), dont
   * le champ est centré, en Berlin Sans 18 et brun.
   *
   * L'arc-en-ciel a sa ROUE (inter.Wheel), douze flammes en couronne autour du
   * lot à gagner. Chaque flamme éteinte est une pièce de moins à poser.
   *
   * Le donjon, lui, n'affiche RIEN : ni son rang, ni son niveau. On le sent
   * monter, on ne le lit pas.
   */
  dessinerEnteteLieu(ctx) {
    const s = this.sprites;
    const e = this.lieu.etat();
    if (e.multi !== undefined && s.panScore) {
      poserRendu(ctx, rendre(s.panScore, 1, 100), SCORE_ARBRE.x, SCORE_ARBRE.y);
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
    if (e.roue === undefined || !s.roueLot) return;

    // inter.Wheel — la roue vient après le portrait, le mana et la vie dans la
    // pile de `updatePos`, avec `mx = 10`.
    const boite = pilerInterface(this.lieu.margeFace);
    const x = ROUE_LOT.x, y = boite.vie.y + boite.vie.h + 3;
    poserRendu(ctx, rendre(s.roueLot, 1, 100), x, y);

    // Le lot, au centre de la roue, au tiers et demi de sa taille.
    const O = window.MinipixizInventaire;
    const d = O && e.prix !== null && e.prix !== undefined ? O.dessinObjet(e.prix) : null;
    if (d && s[d.cle]) {
      poserRendu(ctx, rendre(s[d.cle], d.frame, ROUE_LOT.lot, undefined, d.parties),
        x + ROUE_LOT.cx, y + ROUE_LOT.cy);
    }

    // `addFlame` : une flamme par douzième de compte, posée sur le cercle en
    // partant du haut et en tournant à l'envers.
    if (!s.flamme) return;
    const n = Math.ceil((e.roue / 100) * ROUE_LOT.flammes);
    for (let i = 0; i < n; i++) {
      const a = (1 - (i / ROUE_LOT.flammes)) * 6.28 - 1.57;
      poserRendu(ctx, rendre(s.flamme, 1, 100),
        x + ROUE_LOT.cx + Math.cos(a) * ROUE_LOT.rayon,
        y + ROUE_LOT.cy + Math.sin(a) * ROUE_LOT.rayon);
    }
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

    // La PEAU de l'interface : la forêt garde la première, le donjon prend la
    // deuxième, l'arc-en-ciel la troisième — et ces deux-là ajoutent en plus dix
    // pixels sous le portrait (`intFace.margin = 10`).
    const peau = (this.lieu && this.lieu.peau) || 1;
    const suf = peau > 1 ? String(peau) : '';
    const boite = pilerInterface((this.lieu && this.lieu.margeFace) || 0);
    const sCadre = s['interFace' + suf] || s.interFace;
    const sMana = s['mana' + suf] || s.mana;
    const sCoeur = s['coeur' + suf] || s.coeur;

    // ── LE PORTRAIT (inter.Face) ──
    // Le cadre est là même sans fée : c'est un élément du décor, et son absence
    // creuserait un trou dans le panneau.
    // Combien de pièces à venir la fée laisse-t-elle voir ? Sa concentration en
    // décide, et c'est aussi ce qui décale son portrait vers la droite.
    const voitVenir = fee ? Math.floor((fee.carac[CONCENTRATION] || 0) * 0.5) : 0;
    const align = voitVenir > 0 ? 1 : FACE_ALIGN;
    const cx = boite.portrait.x + (boite.portrait.l - boite.portrait.l * FACE_ECHELLE) * align;
    const cy = boite.portrait.y;
    const t = boite.portrait.l * FACE_ECHELLE;

    // La colonne des pièces à venir, sous le cadre : elle n'existe que si la fée
    // est assez concentrée pour l'offrir.
    if (voitVenir > 0) {
      this.dessinerSuivantes(ctx, boite.portrait.x, cy, FACE_ECHELLE, peau, voitVenir);
    }

    // Le portrait se glisse ENTRE le passe-partout du cadre et son liseré, et
    // le masque du cadre le découpe : c'est mot pour mot ce que fait
    // `Std.attachMC(skin.cadre.pic, "picFace", 10)`.
    if (sCadre) {
      const fond = rendre(sCadre, 1, t, undefined, null, 'pic');
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
      poserRendu(ctx, rendre(sCadre, 1, t, undefined, null, '>pic'), cx, cy);
    }

    // ── LE MANA (inter.Mana) ── une goutte tous les six pixels, centrées.
    if (fee && sMana) {
      const max = fee.manaMax();
      const m = (boite.mana.l - ECART_MANA * max) * 0.5;
      for (let i = 0; i < max; i++) {
        poserRendu(ctx, rendre(sMana, i < fee.fs.$mana ? 2 : 1, 100),
          boite.mana.x + m + ECART_MANA * i - 1, boite.mana.y);
      }
    }

    // ── LA VIE (inter.Life) ── un cœur tous les quatorze.
    if (fee && sCoeur) {
      const max = fee.vieMax();
      const m = (boite.vie.l - ECART_COEUR * max) * 0.5;
      for (let i = 0; i < max; i++) {
        poserRendu(ctx, rendre(sCoeur, i < fee.fs.$life ? 2 : 1, 100),
          boite.vie.x + m + ECART_COEUR * i - 1, boite.vie.y);
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
      // Manager.update : P ou Échap mettent en PAUSE — un voile violet, le
      // panneau, et plus rien ne bouge jusqu'au prochain appui.
      if (ev.key === 'p' || ev.key === 'P' || ev.key === 'Escape') {
        if (!this.pauseEnfoncee) { this.pauseEnfoncee = true; this.basculerPause(); }
        ev.preventDefault();
        return;
      }
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
      if (ev.key === 'p' || ev.key === 'P' || ev.key === 'Escape') this.pauseEnfoncee = false;
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
  Client, Iris, charger, rendre, poserRendu, poserVif, imagePeinte, imageJeton, images,
  portraitDeFee, jauge, partiesDeFee, partiesDeCorps, partiesDImpy, deformationsDeVol,
  fondre, teinter,
  LARGEUR, HAUTEUR, LIGNES_CACHEES, SCENE, COLONNE_X, INTER, ECART_COEUR, ECART_MANA,
};

})();
