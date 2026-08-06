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
/*
 * La CADENCE du jeu d'origine — quarante images par seconde, pas trente.
 *
 * Tout le code de miniTroll compte en `Timer.tmod`, un multiplicateur qui vaut
 * 1 quand une image dure ce qu'elle doit durer. Reste à savoir combien : le
 * compteur de mise au point de `Manager.update` le dit sans ambiguïté —
 *
 *     Log.print(">>>" + Math.round(400/Timer.tmod)/10)      // = 40 / tmod
 *
 * — tmod = 1 affiche « 40 ». Et les trois SWF livrés (minipixiz.swf, full.swf,
 * root.swf) portent bien 40 dans leur en-tête. Le portage avançait à trente :
 * chaque chute, chaque sort, chaque particule prenait un tiers de temps de plus
 * qu'au bureau. C'est ce qui donnait au jeu son air pâteux à côté du Flash.
 */
const IPS = 40;                       // Timer.tmod : 1 = une image à 40 i/s

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

// inter.Life.setHealth ne met à l'échelle que le sous-clip `c` du cœur — le
// cœur rouge, pas son fond. Dans l'export, c'est la DERNIÈRE pièce de
// l'image 2 (l'image 1 n'a que le fond) : on en fait un dessin à part, mémoïsé
// sur le sprite, pour le fondre seul.
//
// ATTENTION à la clé : `coeur` est dans ECHELLE_PIXEL, où rendre() IGNORE le
// paramètre de taille (k = 1). Garder la clé du parent dessinait le cœur à
// taille pleine, décalé par la compensation de centrage — un cœur qui
// débordait de son contour au lieu de fondre dedans. La clé dédiée rend à
// l'échelle demandée : les coordonnées de la pièce sont déjà en pixels, et
// taille/100 est exactement le facteur du _xscale du fichier.
function coeurSeul(sCoeur) {
  if (sCoeur.__seul !== undefined) return sCoeur.__seul;
  const f2 = sCoeur.etats.find((e) => e.frame === 2);
  sCoeur.__seul = (f2 && f2.pieces.length > 1)
    ? { nom: sCoeur.nom + ' (plein)', cle: 'coeurQuiFond',
      etats: [{ frame: 1, pieces: [f2.pieces[f2.pieces.length - 1]] }] }
    : null;
  return sCoeur.__seul;
}
// Le centre du cœur rouge (12,3 × 11,35 posé en 0 ; −0,15) : le point fixe de
// la fonte.
const COEUR_CENTRE = { x: 6.15, y: 5.53 };

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
// Frog.mt — chez Ornegon : les barres à x = 99 depuis y = 12, le curseur entre
// 17 et 133 autour du centre 75 ; le salut dans la bulle, le nom du sort en bas.
// Mission.mt — chez Gromelin : la récompense dans son alvéole (le clip `slot`
// à 174,193, l'objet à 50 %), et la bulle au-dessus de la porte ouverte.
const RECOMPENSE = { x: 174, y: 193 };
const BULLE_PORTE = { x: 60, y: 40 };
const ORNEGON = { barreX: 99, barreY: 12, centre: 75,
  texteX: 47, texteY: 82, texteL: 80, nomX: 163, nomY: 222 };

// Le bleu de la nuit, et la force du voile (Menu.setNight). Le coefficient de
// nuit vaut zéro à minuit, un demi à midi : |nc - 0.5| × 2 donne donc zéro en
// plein jour et un au cœur de la nuit.
// L'heure ne teinte JAMAIS l'écran de jeu : dans l'original, seul le menu
// bleuit ses plans (Menu.setNight) et le bassin change l'image de son fond —
// la forêt est la même à midi et à minuit.

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

// Token.updateSkin : `Mc.setColor(downcast(skin).skin, …)` — la couleur ne
// touche que la PEAU du jeton (le clip `skin`, et son enfant sur l'armure).
// Le rebord anonyme posé au-dessus — le liseré clair des billes — reste tel
// quel : c'est lui qui les fait briller. Teindre tout le canevas éteignait
// ce reflet, et les billes paraissaient plates.
function partiesJeton(couleur) {
  return { skin: couleur, 'skin.d': couleur };
}

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
// Mc.setColor + modColor(1, ajout) : un décalage additif, borné. L'ajout vaut
// 25 par défaut (l'éclat des jetons) ; la perle et l'étoile, attachées DANS le
// clip teinté et éclaircies en plus (bmEnlight, +100), montent à 125.
function teinter(g, x, y, l, h, couleur, ajout) {
  if (l <= 0 || h <= 0) return;
  const a = 255 - ((ajout === undefined) ? 25 : ajout);
  const d = g.getImageData(x, y, l, h);
  const px = d.data;
  const dr = ((couleur >> 16) & 0xFF) - a;
  const dv = ((couleur >> 8) & 0xFF) - a;
  const db = (couleur & 0xFF) - a;
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

// La silhouette d'un fichier peint : la même découpe, remplie de la couleur du
// voile. Une par (fichier, teinte, couleur) — le fondu qui s'anime n'invente
// plus de canevas.
function silhouettePeinte(fichier, teinte, cx, couleur) {
  const cle = fichier + '/' + teinte + '/' + (cx ? cx.join(',') : '') + '/sil' + couleur;
  const deja = peintes.get(cle);
  if (deja) return deja;
  const base = (teinte === undefined || teinte === null) && !cx
    ? images.get(fichier) : imagePeinte(fichier, teinte, null, cx);
  if (!base) return null;
  const l = base.naturalWidth || base.width, h = base.naturalHeight || base.height;
  const c = document.createElement('canvas');
  c.width = l; c.height = h;
  const g = c.getContext('2d');
  g.drawImage(base, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = '#' + ('00000' + (couleur >>> 0).toString(16)).slice(-6);
  g.fillRect(0, 0, l, h);
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
    const brut = (teinte === undefined || teinte === null) && !p.cx;
    const img = brut ? images.get(p.fichier) : imagePeinte(p.fichier, teinte, null, p.cx);
    if (!img) continue;
    // Le mélange animé (le fondu d'une particule vers sa fadeCouleur) se pose
    // en VOILE — la silhouette de la couleur à l'alpha du pourcentage — au
    // lieu d'être cuit dans un canevas neuf à chaque pas. Même remède que
    // rendre() : c'est ce qui rendait les explosions coûteuses.
    const voile = (o.melange && o.melange.prc > 0)
      ? silhouettePeinte(p.fichier, teinte, p.cx, o.melange.couleur) : null;
    const k = voile ? Math.min(100, o.melange.prc) / 100 : 0;
    const d = o.deform ? o.deform(p.nom) : null;
    ctx.save();
    if (p.m && p.vb) {
      ctx.transform(p.m[0], p.m[1], p.m[2], p.m[3], p.m[4], p.m[5]);
      if (d) for (const t of d) appliquerDeform(ctx, t);
      ctx.drawImage(img, p.vb[0], p.vb[1], p.vb[2], p.vb[3]);
      if (voile) {
        const a = ctx.globalAlpha;
        ctx.globalAlpha = a * k;
        ctx.drawImage(voile, p.vb[0], p.vb[1], p.vb[2], p.vb[3]);
        ctx.globalAlpha = a;
      }
    } else {
      ctx.drawImage(img, p.x, p.y, p.w, p.h);
      if (voile) {
        const a = ctx.globalAlpha;
        ctx.globalAlpha = a * k;
        ctx.drawImage(voile, p.x, p.y, p.w, p.h);
        ctx.globalAlpha = a;
      }
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
 * `couleur` non définie = le dessin d'origine, en gris. Un nombre teinte avec
 * l'éclat des jetons (+25) ; `{ col, ajout }` règle l'éclat — la perle et
 * l'étoile, éclaircies en plus par bmEnlight, passent par là.
 * `parties` associe un chemin de clip nommé à une couleur — c'est ce que fait
 * Mc.setPic pour la fée, qui n'a pas une teinte mais trois.
 *
 * Renvoie { c, dx, dy } : le canevas, et où le poser depuis le coin de la case.
 */
function rendre(sprite, frame, taille, couleur, parties, tranche, rotations, melange) {
  // Un MÉLANGE (setPercentColor) qui s'anime — le blanchiment des billes à la
  // destruction monte de 0 à 100 en dix images — frappait le cache une fois
  // par pas : chaque pas fabriquait un canevas neuf et repassait tous les
  // pixels (fondre). C'était LE petit accroc senti à chaque cascade. On ne
  // cuit plus le mélange dans le dessin : on rend la BASE (en cache, une
  // fois), une SILHOUETTE de la couleur (en cache, une fois), et le fondu
  // devient un simple drawImage à alpha — mathématiquement le même résultat,
  // sortie = source × (1−k) + couleur × k.
  if (melange && melange.prc > 0) {
    const base = rendre(sprite, frame, taille, couleur, parties, tranche, rotations, null);
    const cleSil = sprite.nom + '/' + frame + '/' + taille + '/'
      + ((couleur && typeof couleur === 'object') ? couleur.col : couleur)
      + (parties ? '/' + JSON.stringify(parties) : '')
      + (tranche ? '/' + tranche : '')
      + (rotations ? '/' + JSON.stringify(rotations) : '')
      + '/sil' + melange.couleur;
    let sil = teintes.get(cleSil);
    if (!sil) {
      const c = document.createElement('canvas');
      c.width = base.c.width; c.height = base.c.height;
      const g = c.getContext('2d');
      g.drawImage(base.c, 0, 0);
      g.globalCompositeOperation = 'source-in';
      g.fillStyle = '#' + ('00000' + (melange.couleur >>> 0).toString(16)).slice(-6);
      g.fillRect(0, 0, c.width, c.height);
      sil = { c, dx: base.dx, dy: base.dy };
      teintes.set(cleSil, sil);
    }
    return { c: base.c, dx: base.dx, dy: base.dy,
      voile: { c: sil.c, alpha: Math.min(100, melange.prc) / 100 } };
  }
  const colNum = (couleur && typeof couleur === 'object') ? couleur.col : couleur;
  const colAjout = (couleur && typeof couleur === 'object') ? couleur.ajout : undefined;
  const cle = sprite.nom + '/' + frame + '/' + taille + '/'
    + (colNum === undefined ? 'gris' : colNum + (colAjout !== undefined ? '+' + colAjout : ''))
    + (parties ? '/' + JSON.stringify(parties) : '')
    + (tranche ? '/' + tranche : '')
    + (rotations ? '/' + JSON.stringify(rotations) : '');
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
  if (colNum !== undefined) teinter(g, 0, 0, l, h, colNum, colAjout);
  const rendu = { c, dx, dy };
  teintes.set(cle, rendu);
  return rendu;
}

// Pose un rendu à la case (x, y), en pixels. Le VOILE — le fondu vers une
// couleur (setPercentColor) — se pose par-dessus, à l'alpha du pourcentage.
function poserRendu(ctx, r, x, y) {
  ctx.drawImage(r.c, x + r.dx, y + r.dy);
  if (r.voile) {
    const a = ctx.globalAlpha;
    ctx.globalAlpha = a * r.voile.alpha;
    ctx.drawImage(r.voile.c, x + r.dx, y + r.dy);
    ctx.globalAlpha = a;
  }
}

/*
 * L'ÉTOILE de `slotMask` (forme 1208 du SWF), relevée telle quelle.
 *
 * Une étoile à cinq branches aux sommets arrondis, pointe en haut, décrite
 * autour de son point d'ancrage — celui que `fadeSlot` pose au centre de la
 * scène. Ses coordonnées sont celles de l'échelle 100 %, où elle déborde
 * largement d'une scène de 240 : c'est voulu, le masque grandit jusqu'à
 * 113 % avant d'être retiré.
 */
const ETOILE = `M 17.7 -298.05 Q 25.55 -292.3 28.55 -283.05 L 80.6 -122.9
  L 248.95 -122.9 Q 258.6 -122.9 266.5 -117.15 Q 274.4 -111.45 277.45 -102.15
  Q 280.5 -92.9 277.5 -83.65 Q 274.45 -74.45 266.6 -68.6 L 130.4 30.35
  L 182.45 190.5 Q 185.45 199.75 182.45 209 Q 179.4 218.25 171.55 224
  Q 163.65 229.75 153.95 229.75 Q 144.25 229.75 136.3 224.05 L 0 125.05
  L -136.2 224.05 Q -144.2 229.8 -153.9 229.8 Q -163.6 229.75 -171.5 224
  Q -179.4 218.25 -182.4 209 Q -185.4 199.75 -182.35 190.5 L -130.35 30.35
  L -266.55 -68.6 Q -274.45 -74.45 -277.45 -83.65 Q -280.5 -92.9 -277.45 -102.15
  Q -274.4 -111.45 -266.5 -117.15 Q -258.6 -122.9 -248.95 -122.9 L -80.55 -122.9
  L -28.5 -283.05 Q -25.5 -292.3 -17.6 -298.05 Q -9.75 -303.8 0.05 -303.8
  Q 9.8 -303.8 17.7 -298.05 Z`;

// Le tracé, une fois pour toutes : [type, …nombres].
const ETOILE_TRAITS = (() => {
  const jetons = ETOILE.trim().split(/[\s,]+/);
  const traits = [];
  for (let i = 0; i < jetons.length;) {
    const t = jetons[i++];
    if (t === 'Z') { traits.push(['Z']); continue; }
    const n = t === 'Q' ? 4 : 2;
    const v = [];
    for (let k = 0; k < n; k++) v.push(parseFloat(jetons[i++]));
    traits.push([t, ...v]);
  }
  return traits;
})();

function tracerEtoile(g, cx, cy, k) {
  g.beginPath();
  for (const t of ETOILE_TRAITS) {
    if (t[0] === 'M') g.moveTo(cx + t[1] * k, cy + t[2] * k);
    else if (t[0] === 'L') g.lineTo(cx + t[1] * k, cy + t[2] * k);
    else if (t[0] === 'Q') {
      g.quadraticCurveTo(cx + t[1] * k, cy + t[2] * k, cx + t[3] * k, cy + t[4] * k);
    } else g.closePath();
  }
}

/**
 * Manager.fadeSlot — l'IRIS, la transition du jeu : le nouvel écran se révèle
 * dans une ÉTOILE qui grandit depuis le point touché et glisse vers le centre,
 * bordée d'un halo lui aussi en étoile. `checkFade` : prc += 0,2 par image puis
 * ×1,2 — vingt-quatre images, six dixièmes de seconde.
 *
 * On photographie l'ANCIEN écran, on le pose sur le nouveau, et on y perce le
 * trou qui grandit. Passé cent pour cent, le masque est retiré d'un coup : les
 * derniers coins d'ancien écran, entre les branches, disparaissent d'un bloc —
 * c'est ce que fait le jeu d'origine, `removeMovieClip` sans fondu.
 *
 * Le halo est `slotMaskLight` : la MÊME étoile deux fois, sous le nouvel écran,
 * donc visible seulement en débordement — blanche pleine à 1,109 fois le
 * masque, blanche à moitié transparente à 1,213 fois.
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
    // `mask._x = 120·c + x0·(1−c)` : l'étoile part du point touché et glisse
    // vers le centre à mesure qu'elle grandit.
    const c = this.prc / 100;
    const cx = SCENE / 2 * c + this.x * (1 - c);
    const cy = SCENE / 2 * c + this.y * (1 - c);
    const k = Math.max(0, c);
    const g = this.tampon.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, SCENE, SCENE);
    g.drawImage(this.img, 0, 0);
    // Le halo, sur l'ancien écran : la grande étoile à demi transparente, puis
    // la moyenne, pleine. Le trou percé juste après en découpera le cœur.
    if (k > 0.01) {
      g.fillStyle = 'rgba(255,255,255,0.5)';
      tracerEtoile(g, cx, cy, k * 1.213);
      g.fill();
      g.fillStyle = '#ffffff';
      tracerEtoile(g, cx, cy, k * 1.109);
      g.fill();
      g.globalCompositeOperation = 'destination-out';
      tracerEtoile(g, cx, cy, k);
      g.fill();
    }
    ctx.drawImage(this.tampon, 0, 0, SCENE, SCENE);
    // `if( fadePrc > 100 ) removeMovieClip()` — l'image de l'excès est bien
    // dessinée, puis tout s'efface d'un coup.
    return this.prc <= 100;
  }
}

/**
 * Une fée ou un impy, peint sur n'importe quel canevas.
 *
 * Les deux partagent le même clip : ce n'est pas un scénario qui les anime,
 * c'est le code — l'inclinaison, le battement d'ailes, la déformation du vol,
 * la teinte de leurs trois couleurs. La clairière s'en sert aussi, pour la fée
 * qui suit le pointeur.
 */
function dessinerCreatureSur(ctx, s, pe) {
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

// Les particules d'un champ, sur n'importe quel canevas — la clairière a les
// siennes (la poussière d'étoiles que la fée sème en volant).
function dessinerPartsSur(ctx, s, liste) {
  for (const p of liste) {
    poserVif(ctx, s[p.lien], p.joue ? p.frame + Math.floor(p.age) : p.frame, {
      x: p.x, y: p.y, sx: p.sx, sy: p.sy, rot: p.rot, alpha: p.sa,
      couleur: p.couleur === null ? undefined : p.couleur, melange: p.melange,
    });
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
const couleurCss = (n) => '#' + (n >>> 0).toString(16).padStart(6, '0');
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
    this.dernier = 0;
    this.reste = 0;
    // La fée qui accompagne la partie, et l'heure qu'il est dans le jeu.
    this.fee = o.fee || null;
    this.bassin = null;
    this.lieu = null;
    this.champ = null;
    this.coefNuit = (o.coefNuit === undefined) ? 0.5 : o.coefNuit;
    this.poserPref(o.pref || null);
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
    this.canvas.addEventListener('mousemove', () => {
      if (!this.ornegon || !this.pointeur) return;
      const z = (this.ornegon.zones || []).find((q) => this.pointeur.x >= q.x
        && this.pointeur.x <= q.x + q.l && this.pointeur.y >= q.y
        && this.pointeur.y <= q.y + q.h);
      this.ornegon.survole = z ? z.sid : null;
    });
    this.canvas.addEventListener('mouseleave', () => { this.pointeur = null; });
    this.brancherToucher();
    this.canvas.addEventListener('click', (ev) => {
      if (!this.carteForet && !this.nouvelle && !this.ornegon && !this.gromelin) return;
      suivre(ev.clientX, ev.clientY);
      if (this.gromelin) {
        this.clicGromelin(this.pointeur.x, this.pointeur.y);
        return;
      }
      if (this.ornegon) {
        this.clicOrnegon(this.pointeur.x, this.pointeur.y);
        return;
      }
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
    this.ornegon = null;
    this.gromelin = null;
    this.pause = false;
    this.commencerOuverture((opts.niveau || 0) + 1);
    if (opts.fee !== undefined) this.fee = opts.fee;
    if (opts.coefNuit !== undefined) this.coefNuit = opts.coefNuit;
    // Forest.launch : le même isReadyForBattle décide de l'interface ET de la
    // fée en vol — fatiguée, la partie entière la tient pour absente, et la
    // colonne de droite garde son cadre vide.
    if (this.fee && !this.fee.preteAuCombat()) this.fee = null;
    this.jeu = new E.Jeu(Object.assign({}, opts, { onEvent: (n, d) => this.annonce(n, d) }));
    this.jeu.entree = this.entree;
    // Le champ — la fée, les impys, les tirs. Il existe MÊME SANS fée : le jeu
    // d'origine garde toujours son terrain, et une cellule cassée y lâche son
    // impy que la fée soit là ou non (ImpCell.blast → Cs.game.addImp).
    const Combat = window.MinipixizCombat;
    this.champ = Combat ? new Combat.Champ(this.jeu, { fee: this.fee || null }) : null;
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
    this.ornegon = null;
    this.gromelin = null;
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
    this.ornegon = null;
    this.gromelin = null;
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
    this.ornegon = null;
    this.gromelin = null;
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
    // V0.38 du jeu : « Les fées mortes ne parlent plus ». La fée du client
    // s'éteint À L'INSTANT de la mort — sans ça, l'ambiance (un mot toutes
    // les ~500 images), le salut des objets qui décollent et le bravo de fin
    // de niveau parlaient d'outre-tombe jusqu'au niveau suivant, pendant
    // qu'aucune fée ne volait. L'interface, elle, suit déjà faerieList.
    if (nom === 'feeMorte') {
      this.fee = null;
      this.dialogue = null;
    }
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
      case 'etoile': eclater(px(d.x), py(d.y), 24, '#ffffff', 3.2); break;
      case 'pierreCassee': eclater(px(d.x), py(d.y), 10, '#d8d2bb', 2.4); break;
      case 'pierreEntamee': eclater(px(d.x), py(d.y), 4, '#d8d2bb', 1.6); break;
      case 'armureBrisee': eclater(px(d.x), py(d.y), 6, '#ffffff', 2); break;
      // ImpCell.blast : le PENTACLE s'imprime au sol et dix RAYONS de lumière
      // jaillissent — étirés en longueur (xscale 20..320), penchés au hasard,
      // tournant à peine. C'est la signature de la capsule qui lâche son démon.
      case 'impyLibere': {
        if (!this.champ) break;
        const pen = this.champ.nouvellePart('partPentacle');
        pen.x = px(d.x); pen.y = py(d.y);
        pen.fondu = [1];
        pen.timer = 16;
        pen.init();
        for (let i = 0; i < 10; i++) {
          const p = this.champ.nouvellePart('partRay');
          p.x = px(d.x); p.y = py(d.y);
          p.timer = 10 + Math.random() * 10;
          p.vitr = Math.random() * 2;
          p.rot = Math.random() * 360;
          p.init();
          p.sx = 20 + Math.random() * 300;   // _xscale seul : le rayon s'étire
        }
        break;
      }
      // Bomb.blast : QUATORZE boules de flammes en couronne, à poids NÉGATIF —
      // elles flottent vers le haut, chacune démarrant son clip à une image
      // différente — et le clip d'explosion au centre. (Le jeu écrit deux fois
      // vitx : les flammes n'ont pas d'élan vertical propre, on garde la
      // bizarrerie.)
      case 'bombe': {
        if (!this.champ) break;
        const bx = px(d.x), by = py(d.y);
        for (let i = 0; i < 14; i++) {
          const p = this.champ.nouvellePart('partFlameBall');
          const a = Math.random() * 6.28;
          p.x = bx + Math.cos(a) * (TS / 2);
          p.y = by + Math.sin(a) * (TS / 2);
          p.vitx = Math.cos(a) * (Math.random() * 2);
          p.poids = -(0.2 + Math.random() * 0.3);
          p.flGrav = true;
          p.timer = 8 + Math.random() * 20;
          p.echelle = 100 + Math.random() * 100;
          p.joue = true;
          p.frame = 1 + Math.floor((1 - i / 14) * 6);
          p.fondu = [1];
          p.init();
        }
        const bp = this.champ.nouvellePart('partBombEplosion');
        bp.x = bx; bp.y = by;
        bp.joue = true;
        bp.init();
        break;
      }
      /*
       * Element.explode — l'élément vole en éclats. Trois sorts seulement le
       * déclenchent (Mass, LightBolt, Dig, plus Eye.blast), JAMAIS la
       * destruction d'un paquet de couleur : celle-là blanchit et s'efface.
       *
       * Token.fxCrystal : dix éclats de cristal aux couleurs de la bille
       * (teintés et éclaircis), qui tournoient en retombant.
       */
      case 'eclats': {
        if (!this.champ || d.et !== E.E.JETON) break;
        const couleur = E.COULEURS[d.type] || E.COULEURS[0];
        for (let i = 0; i < 10; i++) {
          const p = this.champ.nouvellePart('partElementCrystal');
          p.x = px(d.x); p.y = py(d.y);
          const a = Math.random() * 6.28;
          const v = 2 + Math.random() * 6;
          p.vitx = Math.cos(a) * v;
          p.vity = Math.sin(a) * v;
          p.vitr = (Math.random() * 2 - 1) * 10;
          p.timer = 5 + Math.random() * 10;
          p.echelle = 20 + Math.random() * 50;
          p.rot = Math.random() * 360;
          p.couleur = couleur;
          p.init();
        }
        break;
      }
      // Item.initActiveStep : la fée salue l'objet qui décolle (reactItem) —
      // et les trous de ses tables sont ses silences.
      case 'objetEnvol': {
        if (this.fee && this.fee.salutObjet) {
          const texte = this.enrichir(this.fee.salutObjet(d.type));
          if (texte) this.parler(texte);
        }
        break;
      }
      // Eye.blast : l'onde et les éclats sombres de sa couleur.
      case 'oeilDetruit':
        eclater(px(d.x), py(d.y), 14, couleurCss(E.COULEURS[d.couleur] || 0xffffff), 3);
        break;
      // Eye.initEffect : le rayon et la boule qui file vers la ponte.
      case 'oeilPond':
        eclater(px(d.deX), py(d.deY), 8, '#ffffff', 2.2);
        eclater(px(d.x), py(d.y), 10, couleurCss(E.COULEURS[d.couleur] || 0xffffff), 2.6);
        break;
      // Game.checkFallStats : le seul écho d'une cascade est la VOIX de la fée.
      case 'score': this.reactCombo(d.gagne); break;
      default: break;
    }
    const dest = cible || this.surEvenement;
    if (dest) dest(nom, d);
  }

  // La boucle. Le jeu d'origine tourne à quarante images par seconde (voir IPS)
  // et ses tirages en dépendent : on avance par pas d'UNE image nominale,
  // jamais à moitié.
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
      this.piloterAuDoigt();
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
    if (this.gromelin) { this.dessinerGromelin(ctx, tmod); return; }
    if (this.ornegon) { this.dessinerOrnegon(ctx); return; }
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
      this.dessinerActifs(ctx);
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

    // 5. La bulle de la fée, le bouquet d'ouverture, et s'il faut mourir, le
    //    rideau par-dessus tout.
    this.dessinerDialogue(ctx, tmod);
    this.dessinerOuverture(ctx, tmod);
    this.dessinerCine(ctx, tmod);
  }

  /**
   * Frog.mt — chez ORNEGON. La grenouille demande à la fée ses sorts préférés :
   * une barre par sort appris, un curseur par barre, et chaque réglage écrit
   * `$spellCoef` — le goût qui pèse dans le choix des sorts en pleine partie.
   * Un clic sur la barre pousse le curseur de cinq pixels vers le doigt, comme
   * l'original.
   *
   * @param {object} o  { fee, surFermer }
   */
  ouvrirOrnegon(o) {
    this.bassin = null;
    this.lieu = null;
    this.jeu = null;
    this.champ = null;
    this.cine = null;
    this.ouverture = null;
    this.nouvelle = null;
    this.dialogue = null;
    this.pause = false;
    this.carteForet = null;
    const fee = o.fee;
    const sorts = (fee && fee.sorts ? fee.sorts : [])
      .filter((sid) => sid !== null && sid !== undefined && sid < 20);
    this.ornegon = {
      fee,
      sorts,
      surFermer: o.surFermer || null,
      survole: null,
      // Le curseur garde SA position en pixels : le goût n'est écrit qu'en
      // dixièmes, et le recalculer à chaque image le ferait revenir en
      // arrière — cinq pixels n'y changent pas toujours un dixième.
      positions: {},
    };
    for (const sid of sorts) {
      this.ornegon.positions[sid] = ORNEGON.centre + ((this.coefDuSort(sid) / 10) - 1) * 58;
    }
    return this.ornegon;
  }

  dessinerOrnegon(ctx) {
    const s = this.sprites, or = this.ornegon;
    if (s.ecranOrnegon) poserRendu(ctx, rendre(s.ecranOrnegon, 1, 100), 0, 0);
    else { ctx.fillStyle = '#1c3a24'; ctx.fillRect(0, 0, SCENE, SCENE); }

    // Le salut de la grenouille (fieldFrog) — dix pixels, rouge sombre, dans
    // la bulle de gauche.
    const fee = or.fee;
    ctx.font = 'bold 9px Verdana, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgb(126,16,1)';
    const salut = decouperTexte(ctx,
      'Salut,\n' + (fee ? fee.fs.$name : '') + ' !\nDis-moi quels sont tes sorts préférés...',
      ORNEGON.texteL);
    let sy = ORNEGON.texteY;
    for (const l of salut) { ctx.fillText(l, ORNEGON.texteX, sy); sy += 11; }

    // Frog.initSpellBars : les barres à x = 99 depuis y = 12, serrées si la
    // fée sait beaucoup de sorts.
    or.zones = [];
    const n = or.sorts.length;
    const pas = Math.min(20, (SCENE - 22) / Math.max(1, n));
    let y = ORNEGON.barreY;
    for (const sid of or.sorts) {
      if (s.barreSort) poserRendu(ctx, rendre(s.barreSort, 1, 100), ORNEGON.barreX, y);
      if (s.sortSymbole && s.sortSymbole.etats.some((e) => e.frame === sid + 1)) {
        poserRendu(ctx, rendre(s.sortSymbole, sid + 1, 100), ORNEGON.barreX, y);
      }
      const bx = or.positions[sid];
      if (s.curseurSort) poserRendu(ctx, rendre(s.curseurSort, 1, 100), ORNEGON.barreX + bx, y);
      or.zones.push({ sid, x: ORNEGON.barreX + 10, y: y - 9, l: 130, h: Math.max(18, pas),
        curseur: bx });
      y += pas;
    }

    // Le nom du sort visé (fieldSpell), en blanc au bas.
    if (or.survole !== null && or.survole !== undefined) {
      const X = window.MinipixizSorts;
      const sort = X && X.nouveauSort(or.survole);
      if (sort) {
        ctx.font = 'bold 14px "Berlin Sans FB Demi", "Trebuchet MS", Verdana, sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(sort.nom(), ORNEGON.nomX, ORNEGON.nomY);
      }
    }
    this.dessinerBoutonQuitter(ctx);
  }

  coefDuSort(sid) {
    const fs = this.ornegon.fee.fs;
    if (!Array.isArray(fs.$spellCoef)) fs.$spellCoef = [];
    if (fs.$spellCoef[sid] === null || fs.$spellCoef[sid] === undefined) {
      fs.$spellCoef[sid] = 10;
    }
    return fs.$spellCoef[sid];
  }

  clicOrnegon(x, y) {
    const or = this.ornegon;
    if (x > SCENE - 50 && y > SCENE - 50) {
      const f = or.surFermer;
      this.ornegon = null;
    this.gromelin = null;
      if (f) f();
      return;
    }
    for (const z of (or.zones || [])) {
      if (x < z.x || x > z.x + z.l || y < z.y || y > z.y + z.h) continue;
      // Frog.clickBar : cinq pixels vers le doigt, entre 17 et 133.
      const local = x - ORNEGON.barreX;
      let bx = or.positions[z.sid];
      bx = local < bx ? Math.max(17, bx - 5) : Math.min(133, bx + 5);
      or.positions[z.sid] = bx;
      // Frog.release : c = 1 + (x − 75)/58, gardé en dixièmes.
      or.fee.fs.$spellCoef[z.sid] = Math.floor((1 + (bx - ORNEGON.centre) / 58) * 10);
      return;
    }
  }

  /**
   * Mission.mt — chez GROMELIN. On toque, la porte s'ouvre (ou pas), Gromelin
   * parle, et s'il a du travail on entre : le panneau des missions — titre,
   * énoncé, difficulté, récompense, les flèches pour en changer —, puis le
   * panneau d'envoi où l'on coche les fées et où la chance de succès s'affiche.
   * Valider scelle la mission et referme la porte.
   *
   * @param {object} o
   *   carte       la fiche (les missions y sont, l'envoi y écrit)
   *   dial        les répliques de l'accueil, avec les marqueurs openDoor /
   *               closeDoor / gotoMission de Mission.init
   *   fees        les fiches des fées en bocal, prêtes à partir
   *   surFermer   () → retour à la clairière
   *   surAccepter (résultat) → la mission est scellée, la fiche a changé
   */
  ouvrirChezGromelin(o) {
    this.bassin = null;
    this.lieu = null;
    this.jeu = null;
    this.champ = null;
    this.cine = null;
    this.ouverture = null;
    this.nouvelle = null;
    this.dialogue = null;
    this.ornegon = null;
    this.gromelin = null;
    this.pause = false;
    this.carteForet = null;
    this.gromelin = {
      carte: o.carte,
      dial: (o.dial || []).slice(),
      fees: o.fees || [],
      surFermer: o.surFermer || null,
      surAccepter: o.surAccepter || null,
      frame: 1,
      etape: 1,                        // 1 dialogue, 2 panneau, 4 envoi, 11 rideau
      porteOuverte: false,
      bulle: null,
      timer: 0,
      index: 0,
      coches: [],
      zones: [],
    };
    return this.gromelin;
  }

  avancerGromelin(tmod) {
    const g = this.gromelin;
    if (g.bulle) {
      g.bulle.timer -= tmod;
      if (g.bulle.timer <= 0) g.bulle = null;
      return;
    }
    if (g.etape === 11) {
      g.timer -= tmod;
      if (g.timer < 0 && g.surFermer) { const f = g.surFermer; this.gromelin = null; f(); }
      return;
    }
    if (g.etape !== 1 || !g.dial.length) return;
    const d = g.dial[0];
    if (d.time > 0) { d.time -= tmod; return; }
    g.dial.shift();
    // Mission.playDial : les marqueurs pilotent la porte et la suite.
    if (d.txt === 'openDoor') { g.frame = 2; g.porteOuverte = true; return; }
    if (d.txt === 'closeDoor') { g.frame = 1; g.etape = 11; g.timer = 16; return; }
    if (d.txt === 'gotoMission') { g.frame = 3; g.etape = 2; return; }
    g.bulle = { texte: d.txt, timer: 18 + d.txt.length * 1.9 };
  }

  dessinerGromelin(ctx, tmod) {
    const s = this.sprites, g = this.gromelin;
    this.avancerGromelin(tmod);
    if (!this.gromelin) return;        // la porte vient de se refermer
    g.zones = [];
    if (s.ecranMission) poserRendu(ctx, rendre(s.ecranMission, g.frame, 100), 0, 0);
    else { ctx.fillStyle = '#2a1c10'; ctx.fillRect(0, 0, SCENE, SCENE); }

    const M = window.MinipixizMissions;
    if (g.etape === 2 || g.etape === 4) {
      const infos = g.carte.$mission || [];
      const info = infos[g.index];
      if (!g.decrit || g.decrit.index !== g.index) {
        g.decrit = info ? Object.assign({ index: g.index }, M.decrire(info)) : null;
      }
      // Les flèches (s0/s1) : dans le fichier, le « bouton » est le RAIL doré
      // lui-même — le clip 994 n'est que la bande de 26 × 192 posée à 16,75 et
      // 223,25 (frame 3 de `mission`), sans le moindre glyphe par-dessus. La
      // zone doit donc couvrir le rail que le joueur voit, du haut en bas —
      // c'est là qu'il touche pour feuilleter les six missions du jour.
      g.zones.push({ quoi: 'avant', x: 3.75, y: 37.75, l: 26, h: 192 });
      g.zones.push({ quoi: 'apres', x: 210.25, y: 37.75, l: 26, h: 192 });
      if (g.decrit && g.etape === 2) {
        ctx.textBaseline = 'top';
        ctx.textAlign = 'left';
        // fieldTitle — seize pixels (fontHeight 320), écru rgb(239,230,216),
        // aligné à GAUCHE dans sa boîte posée en (5,75 ; 5,95), large de 234.
        ctx.font = 'bold 16px "Berlin Sans FB Demi", "Trebuchet MS", Verdana, sans-serif';
        ctx.fillStyle = 'rgb(239,230,216)';
        let ty = 5.95;
        for (const l of decouperTexte(ctx, g.decrit.titre, 230)) {
          ctx.fillText(l, 5.75, ty); ty += 17;
        }
        // fieldDesc — dix pixels, brun, boîte en (36,45 ; 48,3) large de 165 ;
        // displayMission recentre son _y autour de 96 selon la hauteur.
        ctx.font = '10px Verdana, Arial, sans-serif';
        ctx.fillStyle = 'rgb(81,61,47)';
        const lignes = decouperTexte(ctx, g.decrit.enonce, 160);
        let dy = 96 - (lignes.length * 11) * 0.5;
        for (const l of lignes) { ctx.fillText(l, 36.45, dy); dy += 11; }
        // fieldInfo — même boîte à gauche, sous l'énoncé (36,6 ; 171,45).
        const L = window.MinipixizLangue;
        const rang = (L.MISSION_DIF_RANK || [])[info[0]] || '';
        const inf = ['type: ' + ((L.MISSION[info[1]] || {}).type || ''),
          'difficulté: ' + rang, 'durée: ' + info[2] + ' jours'];
        let iy = 173.4;
        for (const l of inf) { ctx.fillText(l, 36.6, iy); iy += 11; }
        // La récompense, dans son alvéole, à moitié de taille.
        const I = window.MinipixizInventaire;
        const dp = I && I.dessinObjet(info[3]);
        if (dp && s[dp.cle]) {
          poserRendu(ctx, rendre(s[dp.cle], dp.frame, 50, undefined, dp.parties),
            RECOMPENSE.x, RECOMPENSE.y);
        }
        // butAccept — un bouton-TEXTE (DefineEditText 1000), sans plaque :
        // « accepter la mission! » en rgb(213,185,151), boîte de 125 posée en
        // (57,3 ; 223,3), texte au ras de sa gouttière.
        ctx.fillStyle = 'rgb(213,185,151)';
        ctx.fillText('accepter la mission!', 59.3, 225.3);
        g.zones.push({ quoi: 'accepter', x: 57.3, y: 223.3, l: 125.5, h: 16 });
      }
    }

    if (g.etape === 4) {
      // Le panneau d'envoi. La frame 4 RETIRE le titre de la mission et pose à
      // sa place l'en-tête statique (EditText 1004, écru, en 10,1 ; 6,9) — ses
      // deux lignes sont celles du fichier, coupure comprise.
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      ctx.font = '10px Verdana, Arial, sans-serif';
      ctx.fillStyle = 'rgb(239,230,216)';
      ctx.fillText('selectionner une ou plusieurs fées', 10.1, 8.9);
      ctx.fillText('pour cette mission', 10.1, 20.9);
      // Une ligne par fée en bocal, sa case à cocher, et la chance de succès
      // qui bouge à chaque coche.
      for (let i = 0; i < g.fees.length; i++) {
        const y = 54 + i * 16;
        if (s.caseMission) {
          poserRendu(ctx, rendre(s.caseMission, g.coches[i] ? 2 : 1, 100), 40, y);
        }
        ctx.fillStyle = 'rgb(91,71,53)';
        ctx.fillText(g.fees[i].$name, 44, y + 2);
        g.zones.push({ quoi: 'coche', i, x: 40, y: y - 2, l: 156, h: 16 });
      }
      // « chance de succes: » (EditText 1009 en 36,55 ; 202,95) et le
      // pourcentage (fieldPrc, EditText 1010 en 120,65 ; 202,9) — deux champs
      // alignés à gauche, comme dans le fichier.
      ctx.fillStyle = 'rgb(91,71,53)';
      ctx.fillText('chance de succes:', 36.55, 204.95);
      const cochees = g.fees.filter((f, i) => g.coches[i]);
      const prc = cochees.length
        ? Math.floor(M.chances(g.carte.$mission[g.index], cochees, g.carte) * 100) : 0;
      ctx.fillText(prc + '%', 120.65, 204.9);
      // butAccept de la frame 4 — même bouton-texte, même boîte.
      ctx.fillStyle = 'rgb(213,185,151)';
      ctx.fillText('valider la mission', 59.3, 224.8);
      g.zones.push({ quoi: 'valider', x: 57.3, y: 222.8, l: 125.5, h: 16 });
    }

    // La bulle de Gromelin — sans portrait ; avant l'ouverture elle vient du
    // coin (les coups frappés), ensuite de la porte.
    if (g.bulle) {
      this.dessinerBulleTexte(ctx, g.bulle.texte,
        g.porteOuverte ? BULLE_PORTE.x : 8, g.porteOuverte ? BULLE_PORTE.y : 8,
        g.porteOuverte);
    }
    this.dessinerBoutonQuitter(ctx);
  }

  // Le corps d'une bulle de dialogue, sans locuteur — Gromelin parle derrière
  // sa porte.
  dessinerBulleTexte(ctx, texte, x, y, pointe) {
    ctx.font = '9px Verdana, Arial, sans-serif';
    const w = Math.min(Math.max(70, texte.length * 3), 130);
    const lignes = decouperTexte(ctx, texte, w - 8);
    const h = lignes.length * 11 + 8;
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
    if (pointe) {
      ctx.fillStyle = '#E7E3F0';
      ctx.beginPath();
      ctx.moveTo(x + 18, y + h - 1);
      ctx.lineTo(x + 30, y + h - 1);
      ctx.lineTo(x + 22, y + h + 10);
      ctx.fill();
    }
    ctx.fillStyle = 'rgb(108,89,159)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    let ty = y + 4;
    for (const l of lignes) { ctx.fillText(l, x + w / 2, ty); ty += 11; }
  }

  clicGromelin(x, y) {
    const g = this.gromelin;
    // Une bulle en cours se laisse presser : le clic l'écourte.
    if (g.bulle) { g.bulle.timer = Math.min(g.bulle.timer, 6); return; }
    if (x > SCENE - 50 && y > SCENE - 50) {
      const f = g.surFermer;
      this.gromelin = null;
      if (f) f();
      return;
    }
    const M = window.MinipixizMissions;
    for (const z of (g.zones || [])) {
      if (x < z.x || x > z.x + z.l || y < z.y || y > z.y + z.h) continue;
      const n = (g.carte.$mission || []).length;
      if (z.quoi === 'avant') { g.index = Math.max(0, g.index - 1); return; }
      if (z.quoi === 'apres') { g.index = Math.min(n - 1, g.index + 1); return; }
      if (z.quoi === 'accepter') { g.etape = 4; g.frame = 4; g.coches = []; return; }
      if (z.quoi === 'coche') { g.coches[z.i] = !g.coches[z.i]; return; }
      if (z.quoi === 'valider') {
        const cochees = g.fees.filter((f, i) => g.coches[i]);
        if (!cochees.length) return;
        const resultat = M.accepter(g.carte, g.index, cochees);
        if (g.surAccepter) g.surAccepter(resultat);
        // Mission.validate → quit() : la porte se referme sur le marché conclu.
        const f = g.surFermer;
        this.gromelin = null;
        if (f) f();
        return;
      }
    }
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
  /**
   * FaerieInfo.reactCombo — ce que le jeu d'origine fait d'une cascade.
   *
   * `Game.checkFallStats` additionne les maillons pondérés par leur rang
   * (`fs.list[i] × (i+1)`) et passe la somme à `faerieList[0].fi.reactCombo` :
   * au-delà de seize, la fée félicite ; au-delà de trente-six, elle s'emballe.
   * Sous seize, elle ne dit rien — et dans TOUS les cas, pas un chiffre ne
   * s'affiche. Les deux répliques se choisissent dans la rangée de son humeur,
   * si bien qu'une fée aigrie sait aussi bien dénigrer le coup que l'applaudir.
   */
  reactCombo(somme) {
    const L = window.MinipixizLangue || {};
    if (somme > 36) this.react(L.SUPER_COMBO_CHEER);
    else if (somme > 16) this.react(L.COMBO_CHEER);
  }

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
    // Et RIEN d'autre. Le médaillon de la parleuse — `Dialog.setPic`, qui
    // accroche « mcDialogPicture » à quarante-quatre pixels sur la gauche — n'a
    // qu'un seul appelant dans tout le jeu : `Menu.attachDialog`, la clairière,
    // où la fée n'a pas de cadre à elle et où la pointe est justement masquée.
    // En partie, `Aventure.attachDialog` ne pose que le panneau et sa pointe,
    // qu'il vise sur x = 190 — le cadre du portrait. Redessiner la fée à côté
    // de sa propre bulle doublait ce que la pointe désignait déjà.
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
    // Rien d'écrit ici non plus : `base/Fountain.mt` n'a pas un seul champ de
    // texte, et le bassin partage le checkFallStats de tout le monde.
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
    this.dessinerActifs(ctx);
    bougerEclats(ctx, tmod);

    // L'escargot est posé à DP_SKIN_MIDDLE, comme le montant du tronc, mais
    // avant lui : il grimpe DERRIÈRE l'écorce. Le plancher du donjon et ses
    // roues de devant, eux, sont à DP_SPRITE_FRONT — au-dessus des jetons.
    this.dessinerEscargot(ctx);
    this.dessinerAscenseur(ctx, true);
    if (cadre) poserRendu(ctx, rendre(cadre, CADRE_MILIEU, 100), 0, 0);
    if (this.champ && this.champ.faerieList.length) this.dessinerInterface(ctx, tmod);
    const col = lieu.colonneSuivantes;
    if (col) this.dessinerSuivantes(ctx, col.x, col.y, col.echelle, col.image, col.nombre);
    this.dessinerEnteteLieu(ctx);
    if (cadre) poserRendu(ctx, rendre(cadre, CADRE_DESSUS, 100), 0, 0);
    this.dessinerNuitNoire(ctx);
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
        poserRendu(ctx, rendre(s.token, 1, NEXT_ZONE.taille * k, undefined,
          partiesJeton(E.COULEURS[o.e.type] || E.COULEURS[0])),
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
    // spell/imp/Bind : les FILS PARALYSANTS se voient — un trait blanc d'un
    // pixel à 75 %, du démon vers chaque bille de la pièce. À moins de 80 px
    // le fil a du MOU : la courbe s'affaisse d'autant (Cs.game.line du SWF).
    for (const sort of (jeu.sList || [])) {
      if (!sort.fils || !sort.fils.length || !sort.lanceur) continue;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const f of sort.fils) {
        ctx.moveTo(sort.lanceur.x, sort.lanceur.y);
        const dx = f.x - sort.lanceur.x, dy = f.y - sort.lanceur.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const lim = 80;
        if (dist < lim) {
          const cx = (f.x + sort.lanceur.x) * 0.5;
          const cy = (f.y + sort.lanceur.y) * 0.5 + (lim * 0.5) * (1 - dist / lim);
          ctx.quadraticCurveTo(cx, cy, f.x, f.y);
        } else {
          ctx.lineTo(f.x, f.y);
        }
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  // Une fée ou un impy : le même clip, animé par le code — pas par un scénario.
  // Le corps du dessin vit hors de la classe : la clairière a sa propre fée
  // (sp.pe.Cursor) et son propre canevas, et doit pouvoir la peindre pareil.
  dessinerCreature(ctx, pe) { dessinerCreatureSur(ctx, this.sprites, pe); }

  // L'étape ACTIF, vue du client — la tête de liste vit, le dessin suit :
  //
  //   · l'OBJET qui s'envole sème une étoile par image (Item.activeUpdate) —
  //     posée au hasard dans un rayon de douze pixels, couleur tirée au sort
  //     et éclaircie (setColor + modColor 180), qui retombe derrière lui ;
  //   · l'ŒIL qui vient de pondre tient son RAYON (Eye.activeUpdate) — le
  //     trait qui s'affine d'image en image (partSlash, yscale × 0.8) et la
  //     boule de sa couleur qui file vers la perle (partEyeBall, BALL_SPEED).
  dessinerActifs(ctx) {
    const jeu = this.jeu;
    if (!jeu || jeu.step !== E.ETAPE.ACTIF) return;
    const e = jeu.activeList[0];
    if (!e) return;
    if (e.et === E.E.OBJET) {
      const a = Math.random() * 6.28;
      const d = Math.random() * 12;
      eclats.push({
        x: jeu.posX(e.px) + TS / 2 + Math.cos(a) * d,
        y: jeu.posY(e.py) + (e.decalY || 0) + TS / 2 + Math.sin(a) * d,
        vx: 0, vy: -0.2, t: 5 + Math.random() * 15,
        c: 'hsl(' + Math.floor(Math.random() * 360) + ', 95%, 75%)',
      });
      return;
    }
    if (e.et === E.E.OEIL && e.rayon) {
      const cx = jeu.posX(e.px) + TS / 2;
      const cy = jeu.posY(e.py) + TS / 2;
      const lg = E.Oeil.VITESSE_BOULE * e.rayon.t;
      const bx = cx + Math.cos(e.rayon.ang) * lg;
      const by = cy + Math.sin(e.rayon.ang) * lg;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = Math.max(0.4, 6 * Math.pow(0.8, e.rayon.t));
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(bx, by); ctx.stroke();
      ctx.fillStyle = couleurCss(E.COULEURS[e.color] || 0xffffff);
      ctx.beginPath(); ctx.arc(bx, by, 3.5, 0, 6.29); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath(); ctx.arc(bx, by, 1.6, 0, 6.29); ctx.fill();
      ctx.restore();
    }
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
        poserRendu(ctx,
          rendre(s.token, frame, TS, undefined, partiesJeton(couleur), null, null, melange), x, y);
        // Les marques se posent par-dessus : la perle noire et l'étoile.
        // Token.setSpecial les attache DANS le clip teinté (attachMC sur
        // skin.skin) et les éclaircit (bmEnlight, +100) : leur noyau prend la
        // couleur de la bille — sortie = source + couleur − 130.
        if (e.special === E.SPECIAL.PERLE && s.marble) {
          poserRendu(ctx, rendre(s.marble, 1, TS, { col: couleur, ajout: 125 }), x, y);
        }
        if (e.special === E.SPECIAL.ETOILE && s.star) {
          poserRendu(ctx, rendre(s.star, 1, TS, { col: couleur, ajout: 125 }), x, y);
        }
        break;
      }
      case E.E.PIERRE:
        // stone : trois images, de la plus intacte à la plus fendue.
        poserRendu(ctx, rendre(s.stone, Math.max(1, Math.min(3, e.life)), TS), x, y);
        break;
      case E.E.CELLULE: {
        // ImpCell.setLevel : la boule (`ball`) et son occupant (`bz`) prennent
        // les couleurs du rang du démon — c'est à sa teinte qu'on lit sa force.
        const Cb = window.MinipixizCombat;
        const paire = Cb && Cb.COULEURS_IMPY
          ? Cb.COULEURS_IMPY[Math.min(e.level || 0, Cb.COULEURS_IMPY.length - 1)] : null;
        poserRendu(ctx, rendre(s.impCell, 1, TS, undefined,
          paire ? { ball: paire[0], bz: paire[1] } : null), x, y);
        break;
      }
      case E.E.BOMBE:
        poserRendu(ctx, rendre(s.bomb, 1, TS), x, y);
        break;
      case E.E.OBJET: {
        // sp/el/Item : la bulle, et le dessin de l'objet posé en son centre
        // (Item.setType → it.getPic, attaché en 50,50).
        poserRendu(ctx, rendre(s.elItem, 1, TS), x, y);
        const I = window.MinipixizInventaire;
        const d = I ? I.dessinObjet(e.type) : null;
        if (d && s[d.cle]) {
          poserRendu(ctx, rendre(s[d.cle], d.frame, TS, undefined, d.parties),
            x + TS / 2, y + TS / 2);
        }
        break;
      }
      case E.E.OEIL: {
        // Le clip `eye` du jeu : le halo, la boule `col` teintée de sa couleur,
        // et la pupille `center` que la charge fait grossir —
        // Eye.updateLight : 20 + light×40 pour cent.
        const teinte = E.COULEURS[e.color] || E.COULEURS[0];
        const etat = s.eye && (s.eye.etats.find((q) => q.frame === 1) || s.eye.etats[0]);
        const pupille = etat && etat.pieces.find((p) => p.nom === 'center');
        if (etat && pupille) {
          poserRendu(ctx, rendre(s.eye, 1, TS, undefined, { col: teinte }, '<center'), x, y);
          const img = images.get(pupille.fichier);
          if (img) {
            const k = TS / 100;
            const charge = (20 + Math.min(2, e.lumiere || 0) * 40) / 100;
            ctx.save();
            ctx.translate(x + pupille.m[4] * k, y + pupille.m[5] * k);
            ctx.scale(k * charge, k * charge);
            ctx.drawImage(img, pupille.vb[0], pupille.vb[1], pupille.vb[2], pupille.vb[3]);
            ctx.restore();
          }
        } else {
          // Sans le clip (vieux manifeste), l'ancien dépannage : un jeton marqué.
          poserRendu(ctx, rendre(s.token, 1, TS, undefined, partiesJeton(teinte)), x, y);
          ctx.fillStyle = '#ffffff';
          ctx.beginPath(); ctx.arc(x + TS / 2, y + TS / 2, 4, 0, 6.28); ctx.fill();
          ctx.fillStyle = '#1a1030';
          ctx.beginPath(); ctx.arc(x + TS / 2, y + TS / 2, 2, 0, 6.28); ctx.fill();
        }
        break;
      }
      default:
        break;
    }
  }

  // La colonne de droite : le portrait de la fée, son mana, sa vie, et sous
  // elle la pièce suivante et l'objectif du niveau.
  dessinerInterface(ctx, tmod) {
    const s = this.sprites;
    const fee = this.fee;

    // SANS FÉE, RIEN. `base/Forest.launch` — comme Dungeon.init et
    // Rainbow.init — n'appelle `initFaerieInterface()` que sous
    // `fi.isReadyForBattle()` : le cadre du portrait, la goutte de mana et les
    // cœurs sont créés ENSEMBLE, à ce moment-là, ou jamais. Partir sans fée
    // (ou la laisser endormie, malade, à bout de moral) laisse la colonne de
    // droite nue — le montant de bois, lui, reste : c'est `interfaceRacine`,
    // une peau du décor posée à part, et non un morceau de cette interface.
    if (!fee) return;

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
    // Combien de pièces à venir la fée laisse-t-elle voir ? Sa concentration en
    // décide, et c'est aussi ce qui décale son portrait vers la droite.
    const voitVenir = Math.floor((fee.carac[CONCENTRATION] || 0) * 0.5);
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
      // inter.Life.setHealth : le cœur COURANT rétrécit avec la santé qui
      // reste — échelle 10 + santé × 0,9 % — car chaque cœur encaisse CENT
      // points avant de céder (Faerie.harm). Sans lui, la vie semblait tomber
      // d'un bloc : six tirs d'impy mineur sans que rien ne bouge, puis un
      // cœur entier au septième. La santé vit sur la fée du CHAMP.
      const mf = this.champ && this.champ.faerieList && this.champ.faerieList[0];
      const vie = Math.max(0, Math.floor(Number(fee.fs.$life) || 0));
      for (let i = 0; i < max; i++) {
        const x = boite.vie.x + m + ECART_COEUR * i - 1, y = boite.vie.y;
        if (i === vie - 1 && mf && !mf.flDeath && mf.health < 100) {
          // Le fond du cœur (image 1), puis le cœur rouge seul, fondu sur
          // place — c'est le sous-clip `c` que le fichier met à l'échelle.
          poserRendu(ctx, rendre(sCoeur, 1, 100), x, y);
          const plein = coeurSeul(sCoeur);
          if (plein) {
            // Arrondi au pour cent : le rendu est mémoïsé par taille, et la
            // régénération (POW_REGENERATE_LIFE) glisse en continu.
            const prc = Math.round(10 + Math.max(0, mf.health) * 0.9);
            // L'échelle du renderer part du coin du dessin : on recale pour
            // que le cœur fonde autour de son centre, comme le clip `c`.
            poserRendu(ctx, rendre(plein, 1, prc),
              x + COEUR_CENTRE.x * (1 - prc / 100), y + COEUR_CENTRE.y * (1 - prc / 100));
          } else {
            poserRendu(ctx, rendre(sCoeur, 2, 100), x, y);
          }
          continue;
        }
        poserRendu(ctx, rendre(sCoeur, i < vie ? 2 : 1, 100), x, y);
      }
    }

    // Et c'est TOUT. `base/Aventure.initFaerieInterface` ne construit que ces
    // trois éléments-là — le portrait, le mana, la vie. Le nom de la fée, la
    // rangée des couleurs restantes, une deuxième boîte « pièce suivante » et le
    // score n'existent nulle part à l'écran : `inter.Score` est déclaré mais
    // jamais instancié, et la pièce à venir se lit DANS le cadre du portrait
    // (mcNext), quand la concentration de la fée la laisse voir.
    //
    // Et aucun NOMBRE ne vole non plus au milieu du plateau : une cascade ne
    // s'annonce que par la voix de la fée (voir `reactCombo`), une couleur
    // épuisée par rien du tout — `Game.updatecolorList` lève un simple drapeau
    // interne, `flColorKill`, qui ne sert qu'à couper la recharge de mana du
    // tour (`Aventure.getManaReplenishCoef`).
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
  /**
   * Le jeu AU DOIGT — la pièce se joue sur le plateau même, comme les Tetris
   * de téléphone :
   *
   *   tapoter        → la pièce pivote (une impulsion de `tourner`)
   *   glisser        → elle SUIT le doigt, colonne par colonne : on vise la
   *                    colonne du doigt et le moteur y glisse à sa vitesse
   *   tirer en bas   → la descente rapide, qui pose la pièce en arrivant
   *
   * On ne pilote pas la pièce directement : on écrit dans `entree`, comme le
   * clavier et la manette. C'est le moteur qui glisse, refuse un mur, refuse
   * une rotation impossible — le doigt n'a pas de passe-droit.
   */
  brancherToucher() {
    this.doigt = null;
    const scene = (t) => {
      const r = this.canvas.getBoundingClientRect();
      return { x: (t.clientX - r.left) / this.echelle, y: (t.clientY - r.top) / this.echelle };
    };
    const enJeu = () => this.jeu && !this.carteForet && !this.nouvelle && !this.ornegon
      && !this.gromelin && !this.pause && !this.cine;

    this.canvas.addEventListener('touchstart', (ev) => {
      if (!enJeu()) return;            // les écrans gardent leurs clics
      const t = ev.changedTouches[0];
      if (this.doigt) return;          // un seul doigt pilote
      ev.preventDefault();
      const p = scene(t);
      this.doigt = {
        id: t.identifier,
        x0: p.x, y0: p.y, x: p.x, y: p.y,
        depart: Date.now(),
        bouge: false,
        piece: this.jeu.piece || null,
        colonne0: this.jeu.piece ? this.jeu.piece.x : 0,
        cible: null,
      };
    }, { passive: false });

    this.canvas.addEventListener('touchmove', (ev) => {
      const d = this.doigt;
      if (!d) return;
      const t = [...ev.changedTouches].find((q) => q.identifier === d.id);
      if (!t) return;
      ev.preventDefault();
      const p = scene(t);
      d.x = p.x; d.y = p.y;
      if (Math.abs(p.x - d.x0) > 6 || Math.abs(p.y - d.y0) > 6) d.bouge = true;
      // La colonne visée suit le doigt depuis la prise : un cran par case.
      d.cible = d.colonne0 + Math.round((p.x - d.x0) / TS);
    }, { passive: false });

    const lacher = (ev) => {
      const d = this.doigt;
      if (!d) return;
      const t = [...ev.changedTouches].find((q) => q.identifier === d.id);
      if (!t) return;
      ev.preventDefault();
      this.doigt = null;
      this.entree.gauche = false;
      this.entree.droite = false;
      this.entree.bas = false;
      // Un toucher bref et immobile : la pièce pivote.
      if (!d.bouge && Date.now() - d.depart < 400 && ev.type !== 'touchcancel') {
        this.pulseTourner = 2;
      }
    };
    this.canvas.addEventListener('touchend', lacher, { passive: false });
    this.canvas.addEventListener('touchcancel', lacher, { passive: false });

    // Cm.pref.$mouse — le MODE SOURIS du jeu d'origine : la pièce se joue au
    // pointeur (clic bref = tourner, glisser = suivre la colonne, tirer vers
    // le bas = la descente rapide). On rejoue exactement le chemin du doigt.
    this.canvas.addEventListener('mousedown', (ev) => {
      if (!(this.pref && this.pref.$mouse)) return;
      if (!enJeu() || this.doigt) return;
      ev.preventDefault();
      const p = scene(ev);
      this.doigt = {
        id: 'souris',
        x0: p.x, y0: p.y, x: p.x, y: p.y,
        depart: Date.now(),
        bouge: false,
        piece: this.jeu.piece || null,
        colonne0: this.jeu.piece ? this.jeu.piece.x : 0,
        cible: null,
      };
    });
    this.canvas.addEventListener('mousemove', (ev) => {
      const d = this.doigt;
      if (!d || d.id !== 'souris') return;
      const p = scene(ev);
      d.x = p.x; d.y = p.y;
      if (Math.abs(p.x - d.x0) > 6 || Math.abs(p.y - d.y0) > 6) d.bouge = true;
      d.cible = d.colonne0 + Math.round((p.x - d.x0) / TS);
    });
    const lacherSouris = (ev) => {
      const d = this.doigt;
      if (!d || d.id !== 'souris') return;
      this.doigt = null;
      this.entree.gauche = false;
      this.entree.droite = false;
      this.entree.bas = false;
      if (!d.bouge && Date.now() - d.depart < 400 && ev.type !== 'mouseleave') {
        this.pulseTourner = 2;
      }
    };
    this.canvas.addEventListener('mouseup', lacherSouris);
    this.canvas.addEventListener('mouseleave', lacherSouris);
  }

  // Une image de pilotage au doigt, avant que le moteur ne lise `entree`.
  piloterAuDoigt() {
    if (this.pulseTourner > 0) {
      this.entree.tourner = true;
      if (--this.pulseTourner === 0) this.finPulseTourner = true;
    } else if (this.finPulseTourner) {
      this.entree.tourner = false;
      this.finPulseTourner = false;
    }
    const d = this.doigt;
    if (!d || !this.jeu) return;
    const piece = this.jeu.piece;
    if (!piece) { this.entree.gauche = this.entree.droite = this.entree.bas = false; return; }
    // Une pièce neuve sous le doigt : on repart d'elle, sans lâcher la prise.
    if (piece !== d.piece) {
      d.piece = piece;
      d.colonne0 = piece.x;
      d.x0 = d.x;
      d.y0 = d.y;
      d.cible = null;
      this.entree.bas = false;
      return;
    }
    // Tirer vers le bas déclenche la descente rapide ; remonter la coupe.
    this.entree.bas = (d.y - d.y0) > TS * 1.5;
    // Et la pièce court après la colonne du doigt, à sa vitesse à elle.
    if (d.cible === null) return;
    const ou = piece.x + piece.cx;
    this.entree.droite = d.cible > ou + 0.35;
    this.entree.gauche = d.cible < ou - 0.35;
  }

  // Cm.pref.$key — les CINQ touches du jeu, remappables au moulin comme dans
  // l'original (Option.mt) : gauche, droite, tourner, descendre, sort. Les
  // codes sont ceux de Key.getCode, identiques aux keyCode du navigateur.
  // C'est ici que le joueur historique retrouve son sort sur ESPACE.
  poserPref(p) {
    this.pref = p || null;
    this.prefRoles = {};
    const roles = ['gauche', 'droite', 'tourner', 'bas', 'sort'];
    const cles = (p && p.$key) || [];
    for (let i = 0; i < roles.length; i++) {
      if (cles[i]) this.prefRoles[cles[i]] = roles[i];
    }
  }

  brancherCommandes(racine) {
    const touches = {
      ArrowLeft: 'gauche', ArrowRight: 'droite', ArrowDown: 'bas', ArrowUp: 'tourner',
      q: 'gauche', d: 'droite', s: 'bas', z: 'tourner', a: 'gauche', w: 'tourner',
      ' ': 'tourner',
    };
    if (!this.prefRoles) this.prefRoles = {};
    window.addEventListener('keydown', (ev) => {
      if (this.captureTouche) return;   // le moulin écoute : rien ne joue
      // Manager.update : P ou Échap mettent en PAUSE — un voile violet, le
      // panneau, et plus rien ne bouge jusqu'au prochain appui.
      if (ev.key === 'p' || ev.key === 'P' || ev.key === 'Escape') {
        if (!this.pauseEnfoncee) { this.pauseEnfoncee = true; this.basculerPause(); }
        ev.preventDefault();
        return;
      }
      // Les touches du moulin d'abord : elles PRIMENT sur les commodités du
      // port (sinon remapper espace vers le sort le laisserait tourner).
      const role = this.prefRoles[ev.keyCode];
      if (role === 'sort') {
        // Game.update : seul le premier appui compte (flHelpRelease).
        if (!this.aideEnfoncee) { this.aideEnfoncee = true; this.appelerFee(); }
        ev.preventDefault();
        return;
      }
      if (role) { this.entree[role] = true; ev.preventDefault(); return; }
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
      if (this.prefRoles[ev.keyCode] === 'sort'
        || ev.key === 'Control' || ev.key === 'Shift' || ev.key === 'e') this.aideEnfoncee = false;
      if (ev.key === 'p' || ev.key === 'P' || ev.key === 'Escape') this.pauseEnfoncee = false;
    });
    window.addEventListener('keyup', (ev) => {
      const role = this.prefRoles[ev.keyCode];
      if (role && role !== 'sort') { this.entree[role] = false; ev.preventDefault(); return; }
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
  dessinerCreatureSur, dessinerPartsSur,
  fondre, teinter,
  LARGEUR, HAUTEUR, LIGNES_CACHEES, SCENE, COLONNE_X, INTER, ECART_COEUR, ECART_MANA,
};

})();
