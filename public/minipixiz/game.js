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
    for (const e of s.etats) for (const p of e.pieces) fichiers.add(p.fichier);
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
function partiesDeFee(couleurs) {
  const t = {};
  for (const n of ['f.k0', 'f.k1', 'f.k2']) t[n] = couleurs[0];
  for (const n of ['f.o0.p', 'f.o1.p', 'f.cloth']) t[n] = couleurs[1];
  for (const n of ['f.w0', 'f.w1']) t[n] = couleurs[2];
  return t;
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

/**
 * Rend un état de sprite pour une case de `taille` px.
 *
 * `couleur` non définie = le dessin d'origine, en gris.
 * `parties` associe un chemin de clip nommé à une couleur — c'est ce que fait
 * Mc.setPic pour la fée, qui n'a pas une teinte mais trois.
 *
 * Renvoie { c, dx, dy } : le canevas, et où le poser depuis le coin de la case.
 */
function rendre(sprite, frame, taille, couleur, parties, tranche) {
  const cle = sprite.nom + '/' + frame + '/' + taille + '/'
    + (couleur === undefined ? 'gris' : couleur)
    + (parties ? '/' + JSON.stringify(parties) : '')
    + (tranche ? '/' + tranche : '');
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
  //   'pic'   les pièces jusqu'à `pic` incluse
  //   '>pic'  celles d'après
  //
  // Le cadre du canevas reste celui du dessin ENTIER : les deux moitiés doivent
  // se superposer exactement.
  if (tranche && complet) {
    const apres = tranche.charAt(0) === '>';
    const nom = apres ? tranche.slice(1) : tranche;
    // Le nom est un CHEMIN de clips ("cadre.pic") : on accepte le suffixe, pour
    // que l'appelant n'ait pas à connaître toute la hiérarchie.
    const i = complet.pieces.findIndex((p) => p.nom === nom
      || (p.nom && p.nom.slice(-(nom.length + 1)) === '.' + nom));
    const morceaux = (i < 0) ? (apres ? [] : complet.pieces)
      : (apres ? complet.pieces.slice(i + 1) : complet.pieces.slice(0, i + 1));
    etat = { frame: complet.frame, pieces: morceaux, masques: complet.masques };
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
        dest.drawImage(img, vb[0], vb[1], vb[2], vb[3]);
      } else {
        dest.drawImage(img, (p.x + zero) * k - dx, (p.y + zero) * k - dy, p.w * k, p.h * k);
      }
      dest.restore();
    };

    for (const p of etat.pieces) {
      const img = images.get(p.fichier);
      if (!img) continue;
      const t = (parties && p.nom !== undefined) ? parties[p.nom] : undefined;
      if (t === undefined) { poser(g, p, img); continue; }
      // Une pièce teintée se dessine SEULE sur un calque, se teinte là — où
      // elle est la seule à porter des pixels opaques — puis se colle. Teinter
      // son rectangle sur le dessin commun repeindrait ce qu'il y a dessous :
      // la chevelure de la fée couvre presque tout son portrait, et sa couleur
      // aurait débordé sur le visage.
      const calque = document.createElement('canvas');
      calque.width = l; calque.height = h;
      const gc = calque.getContext('2d');
      poser(gc, p, img);
      teinter(gc, 0, 0, l, h, t);
      g.drawImage(calque, 0, 0);
    }
  }
  if (couleur !== undefined) teinter(g, 0, 0, l, h, couleur);
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

const enHexa = (n) => '#' + n.toString(16).padStart(6, '0');

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
    this.coefNuit = (o.coefNuit === undefined) ? 0.5 : o.coefNuit;
    this.brancherCommandes(o.racine || document);
    this.redimensionner();
    window.addEventListener('resize', () => this.redimensionner());
    window.addEventListener('orientationchange', () => setTimeout(() => this.redimensionner(), 120));
  }

  nouvellePartie(opts) {
    opts = opts || {};
    eclats.length = 0;
    if (opts.fee !== undefined) this.fee = opts.fee;
    if (opts.coefNuit !== undefined) this.coefNuit = opts.coefNuit;
    this.jeu = new E.Jeu(Object.assign({}, opts, { onEvent: (n, d) => this.annonce(n, d) }));
    this.jeu.entree = this.entree;
    this.dernier = 0;
    this.reste = 0;
    return this.jeu;
  }

  annonce(nom, d) {
    const px = (gx) => E.MARGE_GAUCHE + (gx + 0.5) * TS;
    const py = (gy) => E.MARGE_HAUT + (gy + 0.5) * TS;
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
      if (this.jeu) {
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

    // 1. LE FOND — l'image 3 du cadre, posée sous le plateau (DP_SKIN_DOWN).
    //    C'est le vert profond des racines : sans lui, le plateau flotte.
    if (s.cadre) poserRendu(ctx, rendre(s.cadre, CADRE_FOND, 100), 0, 0);
    else { ctx.fillStyle = '#241c3a'; ctx.fillRect(0, 0, LARGEUR, HAUTEUR); }

    if (jeu) {
      for (const e of jeu.eList) this.dessinerElement(ctx, e, e.px, e.py);
      // La pièce en cours flotte entre deux cases : elle a ses propres positions.
      if (jeu.piece) for (const c of jeu.piece.cases()) this.poser(ctx, c.e, c.x, c.y);
      bougerEclats(ctx, tmod);
    }

    // 2. LE MONTANT — l'image 2, devant le plateau (DP_SKIN_MIDDLE) : c'est le
    //    panneau de la colonne de droite, où vit la fée.
    if (s.cadre) poserRendu(ctx, rendre(s.cadre, CADRE_MILIEU, 100), 0, 0);

    // 3. L'INTERFACE (DP_INTER), puis le feuillage qui passe par-dessus tout.
    if (jeu) this.dessinerInterface(ctx, tmod);
    if (s.cadre) poserRendu(ctx, rendre(s.cadre, CADRE_DESSUS, 100), 0, 0);

    // 4. LA NUIT, en dernier : elle teinte la scène entière.
    this.dessinerNuit(ctx);
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

  dessinerElement(ctx, e, gx, gy) {
    this.poser(ctx, e, E.MARGE_GAUCHE + gx * TS, E.MARGE_HAUT + gy * TS);
  }

  // Pose un élément à un point en pixels. C'est le seul endroit qui sait à quoi
  // ressemble chaque espèce.
  poser(ctx, e, x, y) {
    const s = this.sprites;
    switch (e.et) {
      case E.E.JETON: {
        const frame = this.jeu ? imageJeton(this.jeu, e) : 1;
        const couleur = E.COULEURS[e.type] || E.COULEURS[0];
        poserRendu(ctx, rendre(s.token, frame, TS, couleur), x, y);
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
    if (voitVenir > 0 && s.suivante) {
      poserRendu(ctx, rendre(s.suivante, 1, t), INTER.portrait.x, cy);
      const k = FACE_ECHELLE;
      const zx = INTER.portrait.x + NEXT_ZONE.x * k;
      const zy = cy + NEXT_ZONE.y * k;
      const ec = 100 / (voitVenir + 1);
      for (let n = 0; n < voitVenir; n++) {
        const liste = jeu.nextList[n];
        if (!liste) continue;
        const dy = ((n + 1) * ec - NEXT_ZONE.y) * k;
        let xMin = 9, yMin = 9;
        for (const o of liste) { xMin = Math.min(xMin, o.x); yMin = Math.min(yMin, o.y); }
        for (const o of liste) {
          poserRendu(ctx, rendre(s.token, 1, NEXT_ZONE.taille * k,
            E.COULEURS[o.e.type] || E.COULEURS[0]),
          zx + (o.x - xMin) * NEXT_ZONE.taille * k,
          zy + dy + (o.y - yMin) * NEXT_ZONE.taille * k);
        }
      }
    }

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

    ctx.font = 'bold 9px Verdana, Arial, sans-serif';
    ctx.textBaseline = 'top';

    // Le nom de la fée, sous ses barres.
    if (fee) {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#0d3d24';
      ctx.fillText(fee.fs.$name, COLONNE_X + 50, INTER.vie.y + 22);
      ctx.fillStyle = '#bfe8cf';
      ctx.fillText(fee.fs.$name, COLONNE_X + 50, INTER.vie.y + 21);
    }

    // ── LE SCORE ── en haut du plateau, comme dans le jeu.
    ctx.textAlign = 'left';
    ctx.fillStyle = '#0d3d24';
    ctx.fillText(String(jeu.score), 5, 4);
    ctx.fillStyle = '#e6f5ec';
    ctx.fillText(String(jeu.score), 4, 3);

    // ── L'OBJECTIF ── les couleurs encore en jeu. Le niveau se gagne quand la
    // rangée est vide : elle doit se lire d'un coup d'œil.
    let x = COLONNE_X + 8;
    const yObj = INTER.vie.y + 40;
    for (let i = 0; i < jeu.colorList.length; i++) {
      ctx.fillStyle = enHexa(E.COULEURS[jeu.colorList[i]]);
      ctx.beginPath();
      ctx.arc(x, yObj, 4, 0, 6.28);
      ctx.fill();
      ctx.strokeStyle = 'rgba(10,50,30,.6)';
      ctx.lineWidth = 1;
      ctx.stroke();
      x += 11;
      if (x > COLONNE_X + 92) { x = COLONNE_X + 8; }
    }

    // ── LA PIÈCE SUIVANTE ── dans sa boîte, sous l'objectif.
    const suite = jeu.nextList[0];
    if (suite) {
      const k = 9;
      let xMin = 9, yMin = 9;
      for (const o of suite) { xMin = Math.min(xMin, o.x); yMin = Math.min(yMin, o.y); }
      const bx = COLONNE_X + 34, by = yObj + 16;
      for (const o of suite) {
        poserRendu(ctx, rendre(s.token, 1, k, E.COULEURS[o.e.type] || E.COULEURS[0]),
          bx + (o.x - xMin) * k, by + (o.y - yMin) * k);
      }
    }

    if (this.messageT > 0 && this.message) {
      this.messageT -= tmod;
      ctx.textAlign = 'center';
      ctx.font = 'bold 10px Verdana, Arial, sans-serif';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(10,40,25,.9)';
      ctx.strokeText(this.message, LARGEUR / 2, HAUTEUR / 2 - 20);
      ctx.fillStyle = '#ffd76a';
      ctx.fillText(this.message, LARGEUR / 2, HAUTEUR / 2 - 20);
      ctx.textAlign = 'left';
    }
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
      const k = touches[ev.key];
      if (k) { this.entree[k] = true; ev.preventDefault(); }
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
  }
}

window.MinipixizClient = {
  Client, charger, rendre, poserRendu, imageJeton, images,
  LARGEUR, HAUTEUR, LIGNES_CACHEES, SCENE, COLONNE_X, INTER,
};

})();
