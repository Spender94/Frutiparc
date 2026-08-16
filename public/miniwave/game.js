/*
 * Miniwave 2 — client de rendu (canvas) et commandes.
 *
 * Le moteur (engine.js) ne dessine rien : il joue la partie et ANNONCE ce qui
 * arrive. Ce fichier écoute ces annonces, pose les dessins extraits du SWF, et
 * transforme les appuis du joueur en commandes. Il ne décide d'aucune règle —
 * si un comportement change ici, c'est un bug.
 *
 * L'aire de jeu fait 240×240, la taille que le disque Frutiparc réserve au jeu.
 * On la rastérise à la résolution physique de l'écran (devicePixelRatio) puis on
 * l'agrandit par une mise à l'échelle ENTIÈRE tant que c'est possible : les
 * dessins d'origine sont des images de 16 à 20 pixels, et un facteur fractionnaire
 * les rendrait floues.
 *
 * Les PARTICULES du SWF (sp/Part.as) sont rejouées ici : anneaux d'onde,
 * étincelles d'impact, traînes des tirs, étoiles de warp. Chaque clip extrait
 * garde ses images ; on les fait défiler à la cadence du jeu, avec la physique
 * de Part.as — gravité, frottement, fondu de fin de vie.
 */
'use strict';

(function () {

const E = window.MiniwaveEngine;
const LARGEUR = E.LARGEUR, HAUTEUR = E.HAUTEUR;
const BASE = '/miniwave/';
/*
 * LA CADENCE — deux nombres qu'il ne faut pas confondre.
 *
 * L'en-tête de miniwave.swf dit QUARANTE : c'est la fréquence à laquelle Flash
 * REDESSINE. La vitesse du jeu, elle, ne vient pas de là. Tout le code compte
 * en `Std.tmod`, et `Std` est une classe de la bibliothèque de Motion-Twin,
 * compilée dans le SWF — absente des sources, mais lisible dans le bytecode.
 * Son bloc statique s'y trouve tel quel :
 *
 *     Std.maxDeltaTime = 0.5
 *     Std.wantedFPS    = 32
 *     Std.tmod_factor  = 0.95
 *
 * et son `update` se lit ainsi :
 *
 *     deltaT = (getTimer() - oldTime) / 1000            en SECONDES
 *     oldTime = getTimer()
 *     if( deltaT < maxDeltaTime ){
 *         tmod = tmod*tmod_factor + (1-tmod_factor)*deltaT*wantedFPS
 *     }else{
 *         deltaT = 1/wantedFPS                          l'image est PERDUE
 *     }
 *
 * `tmod` ramène donc tout à une image d'un TRENTE-DEUXIÈME de seconde. Le
 * portage en comptait quarante par seconde : vingt-cinq pour cent trop vite,
 * partout à la fois — les vaisseaux, les tirs, la descente des ennemis, les
 * transitions de niveau. C'est ce qu'un joueur d'époque sent immédiatement
 * sans pouvoir désigner un coupable. Minipixiz, même bibliothèque, mêmes
 * constantes, avait exactement le même écart (public/minipixiz/game.js).
 *
 * `tmod` n'est pas non plus le temps écoulé mais sa MOYENNE GLISSANTE à 95 % :
 * une image un peu longue n'accélère pas la scène, elle infléchit à peine la
 * cadence. Et une image de plus d'une demi-seconde est simplement perdue — le
 * jeu ne rattrape jamais son retard.
 */
const IPS = 32;                       // Std.wantedFPS
const TMOD_LISSAGE = 0.95;            // Std.tmod_factor
const TMOD_SAUT = 0.5;                // Std.maxDeltaTime, en secondes
/*
 * ET la cadence d'APPEL : deux nombres différents, les deux comptent.
 *
 * La racine du SWF boucle sur deux images (11 : `mng.update()` ; 12 :
 * `gotoAndPlay(_currentframe-1)`) — une itération par image Flash, donc
 * QUARANTE appels par seconde, la cadence de l'en-tête. À chaque appel,
 * Std.update mesure le temps réel écoulé et en tire `tmod` ≈ 32/40 = 0,8 :
 * les lignes en `*Std.tmod` avancent de 32 unités nominales par seconde, les
 * lignes « par image » (la marche de la vague, la soucoupe, les pellicules
 * des clips) avancent 40 fois par seconde, et les tirages `random(n/Std.tmod)`
 * compensent d'eux-mêmes.
 *
 * Avancer par pas ENTIERS à 32 par seconde — l'état d'avant — donnait la bonne
 * moyenne aux lignes en tmod mais ralentissait d'un cinquième tout le reste,
 * et saccadait à 32 Hz sur un écran à 60. Flash en retard SAUTE des images
 * (tmod grossit), il ne les rattrape jamais : la boucle fait pareil.
 */
const CADENCE_FLASH = 40;             // l'en-tête du SWF : mng.update() par image
const IMAGE_FLASH = 1 / CADENCE_FLASH;

// ── Chargement des dessins ────────────────────────────────────────────────
const images = new Map();
function charger(manifeste, surAvancee) {
  const fichiers = new Set();
  for (const s of Object.values(manifeste)) {
    for (const e of s.etats) for (const p of e.pieces) fichiers.add(p.fichier);
  }
  const liste = [...fichiers];
  let faits = 0;
  return Promise.all(liste.map((f) => new Promise((resoudre) => {
    const img = new Image();
    const fini = () => { faits++; if (surAvancee) surAvancee(faits / liste.length); resoudre(); };
    img.onload = () => { images.set(f, img); fini(); };
    img.onerror = fini;               // une pièce manquante ne doit pas bloquer la partie
  img.src = BASE + 'sprites/' + f;
  })));
}

// ── Transformation de couleur du SWF ──────────────────────────────────────
// sortie = source × mult/256 + add, canal par canal. C'est elle qui peint en
// blanc le halo de la bombe du Pamplemousse et qui éteint les traînes. On
// l'applique UNE fois par (image, transformation) et on garde le résultat.
const teintes = new Map();
function imageTeintee(fichier, cx) {
  const cle = fichier + '|' + cx.m.join() + '|' + cx.a.join();
  let c = teintes.get(cle);
  if (c !== undefined) return c;
  const img = images.get(fichier);
  if (!img || !(img.naturalWidth || img.width)) return null;
  const K = 3;                        // sur-échantillonné : les pièces sont petites
  const w = Math.max(1, Math.round((img.naturalWidth || img.width) * K));
  const h = Math.max(1, Math.round((img.naturalHeight || img.height) * K));
  c = document.createElement('canvas');
  c.width = w; c.height = h;
  const cc = c.getContext('2d');
  cc.drawImage(img, 0, 0, w, h);
  try {
    const d = cc.getImageData(0, 0, w, h);
    const px = d.data;
    const m = cx.m, a = cx.a;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] === 0 && !a[3]) continue;
      px[i] = Math.max(0, Math.min(255, px[i] * m[0] / 256 + a[0]));
      px[i + 1] = Math.max(0, Math.min(255, px[i + 1] * m[1] / 256 + a[1]));
      px[i + 2] = Math.max(0, Math.min(255, px[i + 2] * m[2] / 256 + a[2]));
      px[i + 3] = Math.max(0, Math.min(255, px[i + 3] * m[3] / 256 + a[3]));
    }
    cc.putImageData(d, 0, 0);
  } catch (e) { /* toile souillée : on gardera l'image telle quelle */ c = null; }
  teintes.set(cle, c);
  return c;
}

// La pièce de crédit qui tombe : RONDE, comme celle du clip Opt (dont le corps
// est un morph qu'on ne sait pas rejouer). On la reconstruit : un disque aux
// dégradés de la pièce du SWF (le doré ffe57d → ffcc00 → d8ab00 du compteur),
// coiffé du VRAI reflet extrait (shape1381), puis chaque pixel est remplacé
// par (luminance × couleur de la valeur) — le relief survit à la teinte, là où
// le décalage de couleur de MC.setColor écraserait tout en aplat.
const piecesTeintees = new Map();
function pieceTeintee(sprites, type) {
  let c = piecesTeintees.get(type);
  if (c !== undefined) return c;
  const K = 4, w = 12, h = 12, r = 5;
  const toile = document.createElement('canvas');
  toile.width = w * K; toile.height = h * K;
  const cc = toile.getContext('2d');
  cc.translate((w * K) / 2, (h * K) / 2);
  cc.scale(K, K);
  // Le corps : un disque éclairé par le haut, cerclé d'un bord plus sombre.
  const grad = cc.createRadialGradient(-1, -2.2, 0.5, 0, 0, r);
  grad.addColorStop(0, '#ffe57d');
  grad.addColorStop(0.55, '#ffcc00');
  grad.addColorStop(1, '#d8ab00');
  cc.fillStyle = grad;
  cc.beginPath();
  cc.arc(0, 0, r, 0, 6.2832);
  cc.fill();
  cc.lineWidth = 0.8;
  cc.strokeStyle = 'rgba(140,102,0,.9)';
  cc.stroke();
  // Le reflet du SWF (l'arc blanc du haut de la pièce du clip Opt).
  const reflet = images.get('shape1381.svg');
  if (reflet) cc.drawImage(reflet, -5, -5, 10, 7.25);
  const COLS = [[0xF2, 0xD1, 0xAA], [0xFF, 0xFF, 0xFF], [0xFF, 0xF5, 0x8A], [0xA5, 0xF8, 0x9E]];
  const col = COLS[type] || COLS[1];
  try {
    const d = cc.getImageData(0, 0, toile.width, toile.height);
    const px = d.data;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] === 0) continue;
      const lum = (0.3 * px[i] + 0.59 * px[i + 1] + 0.11 * px[i + 2]) / 255;
      px[i] = Math.min(255, lum * col[0] * 1.2);
      px[i + 1] = Math.min(255, lum * col[1] * 1.2);
      px[i + 2] = Math.min(255, lum * col[2] * 1.2);
    }
    cc.putImageData(d, 0, 0);
  } catch (e) { /* toile souillée : la pièce restera dorée */ }
  c = { canvas: toile, w, h };
  piecesTeintees.set(type, c);
  return c;
}

// Pose un état de sprite centré en (x,y). Les pièces d'un dessin composé (le
// boss) portent leur propre matrice, exprimée dans le repère du sprite, et
// parfois une origine excentrée (`o`) : les traînes s'étendent DERRIÈRE leur
// point d'ancrage, pas autour.
function poser(ctx, sprite, frame, x, y, echelle) {
  if (!sprite) return;
  const etat = sprite.etats.find((e) => e.frame === frame) || sprite.etats[0];
  if (!etat) return;
  for (const p of etat.pieces) {
    let img = null;
    let alpha = 1;
    if (p.cx) {
      // Une transformation qui ne touche QUE l'alpha se pose en globalAlpha :
      // pas de toile teintée à fabriquer pour chaque image d'un fondu.
      const m = p.cx.m, a = p.cx.a;
      if (m[0] === 256 && m[1] === 256 && m[2] === 256 && !a[0] && !a[1] && !a[2] && !a[3]) {
        alpha = m[3] / 256;
        if (alpha <= 0) continue;
      } else {
        img = imageTeintee(p.fichier, p.cx);
      }
    }
    if (!img) img = images.get(p.fichier);
    if (!img) continue;
    if (alpha !== 1) {
      const avant = ctx.globalAlpha;
      ctx.globalAlpha = avant * alpha;
      poserPiece(ctx, img, p, x, y, echelle);
      ctx.globalAlpha = avant;
    } else {
      poserPiece(ctx, img, p, x, y, echelle);
    }
  }
}

function poserPiece(ctx, img, p, x, y, echelle) {
  const m = p.m;
  ctx.save();
  ctx.translate(x, y);
  if (echelle && echelle !== 1) ctx.scale(echelle, echelle);
  ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
  const ox = p.o ? p.o[0] : -p.w / 2;
  const oy = p.o ? p.o[1] : -p.h / 2;
  ctx.drawImage(img, ox, oy, p.w, p.h);
  ctx.restore();
}

// ── Le décor ──────────────────────────────────────────────────────────────
// Le fond du jeu est une bande verticale de quatre sections de 240×1000, qu'on
// remonte au fil des niveaux : on décolle au-dessus des nuages d'une planète, on
// traverse un champ d'astéroïdes, on passe une planète rouge fissurée et ses
// galaxies, puis une station orbitale. Ce sont les images du SWF d'origine.
//
// Reproduction fidèle de Game.moveMap : deux sections empilées, celle du niveau
// courant et la suivante, décalées de `dy % 1000`. Chaque image est ancrée PAR
// LE BAS (dans le SWF elle s'étend de -1000 à 0), d'où les soustractions.
const SECTIONS = ['bitmap1.jpg', 'bitmap3.jpg', 'bitmap5.jpg', 'bitmap7.jpg'];
const HAUT_SECTION = 1000;
const decor = new Map();

function chargerDecor() {
  return Promise.all(SECTIONS.map((f) => new Promise((resoudre) => {
    const img = new Image();
    img.onload = () => { decor.set(f, img); resoudre(); };
    img.onerror = resoudre;
    img.src = BASE + 'decor/' + f;
  })));
}

function fond(ctx, dy) {
  ctx.fillStyle = '#1a0f33';
  ctx.fillRect(0, 0, LARGEUR, HAUTEUR);
  const i = Math.floor(dy / HAUT_SECTION);
  const off = dy % HAUT_SECTION;
  for (const k of [0, 1]) {
    // Au-delà de la dernière section, Flash resterait sur la dernière image :
    // on fait pareil plutôt que de laisser un trou noir en fin de parcours.
    const img = decor.get(SECTIONS[Math.min(i + k, SECTIONS.length - 1)]);
    if (img) ctx.drawImage(img, 0, HAUTEUR + off - HAUT_SECTION * (k + 1), LARGEUR, HAUT_SECTION);
  }
}

// ── Éclats simples ────────────────────────────────────────────────────────
// Les explosions projettent des éclats de couleur — un raccourci raisonnable
// des débris de fruits du SWF, gardé pour son punch.
const eclats = [];
function eclater(x, y, n, couleur, vitesse) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 6.28;
    const v = vitesse * (0.4 + Math.random() * 0.6);
    eclats.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 1, t: 10 + Math.random() * 14, c: couleur });
  }
}
function avancerEclats(tmod) {
  for (let i = eclats.length - 1; i >= 0; i--) {
    const p = eclats[i];
    p.x += p.vx * tmod;
    p.y += p.vy * tmod;
    p.vy += 0.25 * tmod;
    p.t -= tmod;
    if (p.t <= 0) eclats.splice(i, 1);
  }
}
function dessinerEclats(ctx) {
  for (const p of eclats) {
    ctx.globalAlpha = Math.min(1, p.t / 8);
    ctx.fillStyle = p.c;
    ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
  }
  ctx.globalAlpha = 1;
}

// ── Le client ─────────────────────────────────────────────────────────────
class Client {
  constructor(o) {
    this.canvas = o.canvas;
    this.ctx = this.canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.sprites = o.sprites;
    this.niveaux = o.niveaux;
    this.surEvenement = o.surEvenement || null;
    this.surPause = o.surPause || null;// prévient l'interface (bouton ⏸/▶)
    this.panneau = null;               // texte affiché entre deux niveaux
    this.panneauT = 0;
    this.echelle = 1;
    // Le compteur d'images doit exister DÈS la construction : le menu tourne sur
    // la même boucle, et il s'ouvre avant la première partie. Sans ces valeurs,
    // l'attente vaut NaN, la condition d'avancement n'est jamais vraie et rien
    // ne bouge — ni le menu ni, plus tard, le jeu.
    this.dernier = 0;
    this.attente = 0;                  // le temps accumulé vers la prochaine image Flash
    this.derniereImage = 0;            // l'instant de la dernière image exécutée
    this.imagesAvantDessin = 0;
    this.tmod = 1;                     // Std.tmod, initialisé à 1 comme dans le SWF
    this.animT = 0;                    // horloge des clips à images (soucoupe, tuyère)
    this.parts = [];                   // particules du SWF en cours de lecture
    this.flPause = false;
    this.entree = { gauche: false, droite: false, tir: false, bombe: false };
    this.brancherCommandes(o.racine || document);
    this.redimensionner();
    window.addEventListener('resize', () => this.redimensionner());
    window.addEventListener('orientationchange', () => setTimeout(() => this.redimensionner(), 120));
    // L'onglet qui passe derrière met la partie en PAUSE (et pas seulement la
    // boucle) : au retour, rien n'a bougé et rien n'a « rattrapé ».
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { this.relacherTout(); this.pauser(true); }
    });
    // La fenêtre qui perd le focus ne reçoit plus les RELÂCHEMENTS : une touche
    // enfoncée au moment du basculement reste enfoncée pour toujours. Gauche et
    // droite coincées ensemble s'annulent — le vaisseau est alors cloué sur
    // place, et un pointeur dont le « lever » s'est perdu le ramène à son
    // dernier point de visée à chaque image. C'est le vaisseau qui « ne bouge
    // plus du tout jusqu'à l'explosion ». On lâche donc tout ce qui était tenu.
    window.addEventListener('blur', () => this.relacherTout());
  }

  // Remet les commandes à zéro : plus rien n'est tenu.
  relacherTout() {
    this.entree.gauche = false;
    this.entree.droite = false;
    this.entree.tir = false;
    this.entree.bombe = false;
    this.entree.cibleX = null;
    if (this.surfaces) {
      for (const s of this.surfaces) { s.pointeur = null; s.el.classList.remove('on'); }
    }
    const boutons = document.querySelectorAll('[data-cmd].on');
    Array.prototype.forEach.call(boutons, (b) => b.classList.remove('on'));
  }

  // `mode` choisit la classe : l'arcade est le moteur nu, les trois autres sont
  // dans modes.js. Le reste des options passe telle quelle — chaque mode y
  // prend ce qui le concerne (missionNum et prime pour une mission, rien pour
  // l'endurance qui n'a pas de parcours).
  nouvellePartie(opts) {
    opts = opts || {};
    const graine = opts.graine === undefined ? (Date.now() & 0x7fffffff) : opts.graine;
    eclats.length = 0;
    this.parts.length = 0;
    this.pauser(false);
    const M = window.MiniwaveModes || {};
    const Classe = { mission: M.Mission, survival: M.Survival, letter: M.Letter }[opts.mode] || E.Game;
    this.jeu = new Classe(Object.assign({}, opts, {
      levels: opts.niveaux || this.niveaux,
      graine,
      onEvent: (n, d) => this.annonce(n, d),
    }));
    this.mode = opts.mode || 'arcade';
    this.jeu.entree = this.entree;
    // Le solde de la fiche à l'entrée en partie : le compteur affiche
    // portefeuille + récolte, comme le bureau qui crédite en direct.
    this.jeu.portefeuille = Number(opts.portefeuille) || 0;
    this.dernier = 0;
    this.attente = 0;
    this.derniereImage = 0;
    return this.jeu;
  }

  // ── Particules (sp/Part.as) ──
  // Un clip extrait, une position, la physique de Part.as : gravité (0.5 par
  // défaut), frottement du jeu, fondu sur les dix dernières images du timer.
  // Sans timer, le clip se joue UNE fois et s'en va.
  jouerPart(cle, o) {
    if (cle && !this.sprites[cle]) return null;
    const p = Object.assign({
      cle, x: 0, y: 0, vitx: 0, vity: 0, vitr: 0, rot: 0,
      sx: 1, sy: 1, alpha: 1, frame: 1, flGrav: false, weight: 0.5,
    }, o);
    this.parts.push(p);
    if (this.parts.length > 200) this.parts.splice(0, this.parts.length - 200);
    return p;
  }

  // Avance toutes les particules d'un pas et dessine celles du PLAN DU FOND
  // (traînes, ondes — le SWF les pose sous les sprites, dp_underPart) ; les
  // étincelles d'impact et les étoiles passent AU-DESSUS (dp_part), dessinées
  // par poserPartsDessus une fois les sprites en place.
  /*
   * Part.update, une image Flash : la physique suit Std.tmod, la ROTATION et
   * la PELLICULE avancent d'un cran par image — `this._rotation += this.vitr`
   * n'a pas de tmod dans les sources, et la pellicule d'un clip joue à la
   * cadence de l'en-tête, pas à la cadence nominale.
   */
  avancerParts(tmod) {
    const f = Math.pow(0.95, tmod);    // Game.friction, comme Part.update
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      if (p.flGrav) p.vity += p.weight * tmod;
      p.vitx *= f; p.vity *= f; p.vitr *= f;
      p.x += p.vitx * tmod;
      p.y += p.vity * tmod;
      p.rot += p.vitr * (Math.PI / 180);
      p.frame += 1;
      p._alpha = p.alpha;
      if (p.timer !== undefined) {
        p.timer -= tmod;
        if (p.timer < 0) { this.parts.splice(i, 1); continue; }
        if (p.timer < 10) p._alpha *= p.timer / 10;
      }
      if (p.texte === undefined) {
        const sp = this.sprites[p.cle];
        if (!sp) { this.parts.splice(i, 1); continue; }
        let idx = Math.floor(p.frame) - 1;
        if (idx >= sp.etats.length) {
          if (p.timer === undefined && !p.boucle) { this.parts.splice(i, 1); continue; }
          idx = p.boucle ? idx % sp.etats.length : sp.etats.length - 1;
        }
        p._idx = Math.max(0, idx);
      }
    }
  }

  dessinerParts(ctx, dessus) {
    for (const p of this.parts) {
      if (!p.dessus === !dessus) this.poserPart(ctx, p);
    }
    ctx.globalAlpha = 1;
  }

  poserPartsDessus(ctx) {
    for (const p of this.parts) if (p.dessus) this.poserPart(ctx, p);
    ctx.globalAlpha = 1;
  }

  poserPart(ctx, p) {
    if (p.texte !== undefined) {       // PartField : un « +5 » qui s'élève
      ctx.save();
      ctx.globalAlpha = p._alpha;
      ctx.font = 'bold 8px Verdana, Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#F2D1AA';
      ctx.strokeStyle = 'rgba(0,0,0,.7)';
      ctx.lineWidth = 2;
      ctx.strokeText(p.texte, p.x, p.y);
      ctx.fillText(p.texte, p.x, p.y);
      ctx.restore();
      return;
    }
    const sp = this.sprites[p.cle];
    if (!sp || p._idx === undefined) return;
    ctx.save();
    ctx.translate(p.x, p.y);
    if (p.rot) ctx.rotate(p.rot);
    if (p.sx !== 1 || p.sy !== 1) ctx.scale(p.sx, p.sy);
    ctx.globalAlpha = p._alpha;
    poser(ctx, sp, sp.etats[p._idx].frame, 0, 0, p.echelle);
    ctx.restore();
  }

  // Shot.queue du SWF : le segment publié par le moteur devient une traîne —
  // le clip d'origine, étiré sur la distance parcourue (_xscale = dist), qui
  // s'éteint sur place. Le bleu du Curaso fait 8 px d'épaisseur : c'est lui
  // qui donne aux tirs jumeaux leur ruban.
  tracer(d) {
    const cles = {
      curaso: 'queueCuraso', homing: 'queueHoming',
      kumquat: 'queueKumquat', groseille: 'queueGroseille',
    };
    const cle = cles[d.genre];
    if (!cle) return;
    const dx = d.x1 - d.x0, dy = d.y1 - d.y0;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 0.05) return;
    this.jouerPart(cle, {
      x: d.x1, y: d.y1,
      rot: Math.atan2(dy, dx),
      sx: dist / 100,                  // les traînes sont dessinées longues de 100
    });
  }

  annonce(nom, d) {
    switch (nom) {
      case 'panneau':
        // Les panneaux du SWF (miniWave2Msg) : type 0 = niveau, 3 = boss.
        // Ils fondent à l'ouverture et à la fermeture (Msg.update).
        // « level » en MINUSCULES : c'est la chaîne exacte de game/Main.as, et
        // l'Arcade Classic du SWF n'embarque d'ailleurs que ces glyphes-là
        // (e, l, v — pas de L majuscule).
        this.panneau = {
          type: d.boss ? 3 : 0,
          titre: d.boss ? '' : ('level ' + (d.level + 1)),
          texte: d.boss
            ? 'Attention ! Vous entrez dans une zone à haut risque : la présence de "Orangre" le boss des fruits mutants est détectée dans ce secteur...'
            : (d.name || ''),
          alpha: 0, ta: 1,
        };
        this.panneauT = d.boss ? 160 : 80;
        break;
      case 'traine': this.tracer(d); break;
      case 'impact':
        this.jouerPart('partImpact', { x: d.x, y: d.y, rot: Math.random() * 6.28, dessus: true });
        break;
      case 'tirDisparait':
        this.jouerPart('partVanish', { x: d.x, y: d.y, timer: 8, dessus: true });
        break;
      case 'badsExplose': eclater(d.x, d.y, 6, '#ffd76a', 2.6); break;
      case 'badsEcaille': eclater(d.x, d.y, 3, '#ffffff', 1.6); break;
      case 'badsWarp':
        this.jouerPart('partBadsWarp', { x: d.x, y: d.y, rot: Math.random() * 6.28, echelle: 0.7, dessus: true });
        break;
      case 'heroExplose':
        // Hero.hit : l'anneau d'onde, en grand (150 %) pour la mort.
        this.jouerPart('partOnde', { x: d.x, y: d.y, echelle: 1.5 });
        eclater(d.x, d.y, 14, '#8fd0ff', 3.2);
        break;
      case 'heroTouche':
        if (!d.mort) this.jouerPart('partOnde', { x: d.x, y: d.y, echelle: 0.5 });
        eclater(d.x, d.y, 5, '#ffffff', 2);
        break;
      case 'ondeChoc':
        // La bombe du Tequila : le même anneau, doublé (Tequila.bomb pose
        // l'onde à 200 %).
        this.jouerPart('partOnde', { x: d.x, y: d.y, echelle: 2 });
        eclater(d.x, d.y, 20, '#ffffff', 3.4);
        break;
      case 'warp': {
        // Hero.update : les étoiles filantes du passage du bord droit.
        for (let i = 0; i < 10; i++) {
          this.jouerPart('partWarpStar', {
            x: LARGEUR + 6, y: HAUTEUR - 12 + (Math.random() * 2 - 1) * 8,
            vitx: -(3 + Math.random() * 6), vity: (Math.random() * 2 - 1) * 4,
            vitr: Math.random() * 30, timer: 30, boucle: true, dessus: true,
          });
        }
        break;
      }
      case 'bossRenvoi': eclater(d.x, d.y, 3, '#cfe8ff', 2); break;
      case 'bossExplose': eclater(d.x, d.y, 40, '#ffb04a', 4); break;
      case 'soucoupeExplose': eclater(d.x, d.y, 10, '#cfe8ff', 3); break;
      case 'bonus':
        // Game.incCred : le « +n » qui s'élève du vaisseau à la collecte.
        if (d.credit !== undefined && this.jeu && this.jeu.hero) {
          this.jouerPart(null, {
            texte: '+' + d.credit,
            x: this.jeu.hero.x, y: this.jeu.hero.y - 10,
            vity: -1, timer: 30, dessus: true,
          });
        }
        break;
      case 'saut': eclater(LARGEUR / 2, HAUTEUR / 2, 24, '#8fd0ff', 4); break;
      case 'finPartie':
        this.pauser(false);
        // Type 1 = game over, type 2 = félicitations (Main.getEndMsg).
        this.panneau = (d.raison === 'fin')
          ? { type: 2, titre: '', texte: 'vous avez repoussé l\'attaque des fruits mutants', alpha: 0, ta: 1 }
          : { type: 1, titre: 'GAME OVER', texte: '', alpha: 0, ta: 1 };
        this.panneauT = 1e9;
        break;
      default: break;
    }
    if (this.surEvenement) this.surEvenement(nom, d);
  }

  // ── Pause ──
  // Le jeu d'origine s'arrête sur P ou Échap (Manager.update), en assombrissant
  // la scène et en posant l'écusson PAUSE. La partie ne bouge plus, le son se
  // suspend — et rien ne « rattrape » à la reprise.
  pauser(etat) {
    const voulu = (etat === undefined) ? !this.flPause : !!etat;
    if (voulu === this.flPause) return;
    // Pas de pause hors partie (menu ouvert, écran de fin) : rien à figer.
    if (voulu && (!this.jeu || this.jeu.termine || (this.avant && this.avant.visible))) return;
    this.flPause = voulu;
    if (this.surPause) this.surPause(this.flPause);
  }

  // ── Boucle ──
  // On avance le moteur par pas d'UNE image nominale — un trente-deuxième de
  // seconde, cf. IPS — et les tirages au sort en dépendent : un pas se joue
  // entier ou pas du tout. Un écran à 60 Hz exécute donc parfois deux pas,
  // parfois aucun, jamais un pas « à moitié ».
  demarrer() {
    if (this.raf) return;                           // une seule boucle
    const boucle = (t) => {
      this.raf = requestAnimationFrame(boucle);
      if (!this.dernier) { this.dernier = t; this.attente = 0; this.derniereImage = t; return; }
      this.attente += (t - this.dernier) / 1000;
      this.dernier = t;

      // Une image Flash au plus par rafraîchissement, comme le lecteur : en
      // retard, Flash SAUTE des images — `tmod` grossit pour compenser — il ne
      // les rattrape jamais. L'excédent au-delà d'une image est donc perdu.
      if (this.attente >= IMAGE_FLASH) {
        this.attente = Math.min(this.attente - IMAGE_FLASH, IMAGE_FLASH);
        // Std.update, au mot près : tmod est la moyenne glissante (à 95 %) du
        // temps réel entre deux images EXÉCUTÉES, ramené à la seconde de
        // trente-deux ; une image de plus d'une demi-seconde le laisse tel quel.
        const ecart = (t - this.derniereImage) / 1000;
        this.derniereImage = t;
        if (ecart > 0 && ecart < TMOD_SAUT) {
          this.tmod = this.tmod * TMOD_LISSAGE + (1 - TMOD_LISSAGE) * ecart * IPS;
        }
        this.imageFlash(this.tmod);
        this.imagesAvantDessin++;
      }

      // Le rendu, à chaque rafraîchissement. Le menu avance une part de ses
      // effets EN dessinant (la pluie d'étoiles des vitrines) : on lui passe le
      // temps nominal des images exécutées depuis le dernier rendu — zéro
      // quand aucune ne l'a été — pour qu'ils suivent la cadence Flash.
      const tmodDessin = this.tmod * this.imagesAvantDessin;
      this.imagesAvantDessin = 0;
      if (this.avant && this.avant.visible) { this.avant.dessiner(tmodDessin); return; }
      if (!this.jeu) return;
      this.dessiner();
      if (this.flPause) this.dessinerPause(this.ctx);
    };
    this.raf = requestAnimationFrame(boucle);
  }
  arreter() { if (this.raf) cancelAnimationFrame(this.raf); this.raf = null; }

  /** UNE image Flash : mng.update() — le jeu ou le menu, puis l'habillage. */
  imageFlash(tmod) {
    if (this.avant && this.avant.visible) { this.avant.update(tmod); return; }
    if (!this.jeu || this.flPause) return;
    this.jeu.update(tmod);
    // L'habillage vit à la même cadence : les pellicules des clips avancent
    // d'UNE image par image Flash, la physique des particules suit tmod.
    this.animT += 1;
    this.avancerParts(tmod);
    avancerEclats(tmod);
    if (this.panneauT > 0) {
      this.panneauT -= tmod;
      const p = this.panneau;
      if (p && typeof p === 'object') {
        if (this.panneauT <= 12) p.ta = 0;           // l'extinction s'amorce
        p.alpha = p.alpha * 0.8 + p.ta * 0.2;        // le fondu de Msg.as
      }
    }
  }

  dessiner() {
    const ctx = this.ctx, jeu = this.jeu;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    fond(ctx, jeu.defilementDecor());

    for (const b of jeu.badsList) {
      // L'image de coque suit les points de vie : intact = image 1, entamé = 2…
      const sp = this.sprites['bads' + b.type];
      // La Batmandarine a une seconde image, sa pose d'esquive : le SWF y passe
      // le temps du glissement (Mandarine : gotoAndStop(2) au départ, 1 à
      // l'arrivée). Elle n'a qu'un point de vie — l'image 2 ne servait à rien.
      const etat = b.flStrafe && sp && sp.etats.length > 1 ? 2
        : (sp ? Math.min(sp.etats.length, (b.profil.hp || 1) - b.hp + 1) : 1);
      // `dx` : le rattrapage de la Batmandarine. Elle change de place d'un coup
      // — pour la vague et pour les tirs — mais son DESSIN la rejoint en
      // glissant (Mandarine.endUpdate pose le clip à x+dx puis remet x).
      // `px/py` : là où le fruit se MONTRE. Pour presque tous c'est sa place
      // de vague ; l'Aubergine folle, elle, garde son créneau et se dessine au
      // bout de sa charge (Aubergine.endUpdate : `_x = kx ; _y = ky`).
      // `rot` : la charge se tourne dans le sens de sa course.
      const bx = b.px + (b.dx || 0);
      const cadre = sp ? sp.etats[Math.max(0, etat - 1)].frame : 1;
      if (b.rot) {
        ctx.save();
        ctx.translate(bx, b.py);
        ctx.rotate(b.rot);
        poser(ctx, sp, cadre, 0, 0);
        ctx.restore();
      } else {
        poser(ctx, sp, cadre, bx, b.py);
      }
      // La Figue-laser ouvre un rayon sous elle (flShooting) : montée en
      // puissance, colonne mortelle, extinction — le moteur fait le dégât
      // entre timer 36 et 12, le dessin suit les mêmes bornes.
      if (b.flShooting && b.timer > 0) this.dessinerRayonFigue(ctx, b);
      // Letter Invader : le caractère à taper, posé sur le monstre. C'est la
      // seule information du mode — sans elle il n'y a pas de jeu.
      if (b.affiche) {
        ctx.font = 'bold 13px Verdana, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,.85)';
        ctx.strokeText(b.affiche, b.x, b.y + 1);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(b.affiche, b.x, b.y + 1);
        ctx.textBaseline = 'alphabetic';
        ctx.textAlign = 'left';
      }
    }

    // La soucoupe passe au-dessus de la mêlée ; les bonus tombent devant.
    for (const s of jeu.saucerList) {
      const sp = this.sprites.saucer;
      const etat = sp ? sp.etats[Math.floor(this.animT) % sp.etats.length] : null;
      poser(ctx, sp, etat ? etat.frame : 1, s.x, s.y);
    }
    for (const o of jeu.optList) this.dessinerBonus(ctx, o);

    if (jeu.boss) this.dessinerBoss(ctx, jeu.boss);

    // Les traînes et étincelles passent SOUS les tirs : le trait s'éteint
    // derrière la balle (le SWF les met sous la couche des sprites).
    this.dessinerParts(ctx, false);
    for (const t of jeu.bShotList) this.dessinerTir(ctx, t, false);
    for (const t of jeu.hShotList) this.dessinerTir(ctx, t, true);

    if (jeu.hero) this.dessinerHero(ctx, jeu.hero);

    // Les étincelles d'impact, étoiles de warp et « +n » passent au-dessus de
    // la mêlée (dp_part du SWF).
    this.dessinerParts(ctx, true);
    dessinerEclats(ctx);
    this.dessinerInterface(ctx);
  }

  dessinerHero(ctx, h) {
    const sp = this.sprites['hero' + h.type];
    const fiche = E.VAISSEAUX[h.type] || {};
    // Le rayon du Cherry se dessine sous le vaisseau, ancré à lui.
    if (h.laser > 0 && h.laserDemi > 0) this.dessinerCherryLaser(ctx, h);
    // L'image de coque : les vaisseaux à deux points de vie (Pastaga, Cherry)
    // ont une image « fissurée » — dessinée dans le SWF mais jamais branchée
    // pour le Pastaga ; le doute sur ses points de vie disparaît avec elle.
    //
    // La coque ne s'ANIME PAS : sp/Hero.init appelle `this.stop()` sur le clip
    // du vaisseau, et rien ne le relance jamais. Le Tequila porte bien douze
    // images sur sa ligne de temps, mais le jeu les fige sur la première — le
    // portage les déroulait en boucle, d'où le scintillement permanent sous le
    // vaisseau de départ, celui que tout le monde pilote en arcade.
    let etatIdx = 0;
    if (sp && fiche.hp === 2 && sp.etats.length >= 2) etatIdx = (h.hp === 1) ? 1 : 0;
    ctx.save();
    if (h.newShield) {
      // Le bouclier d'apparition : le jeu d'origine ne CACHE pas le vaisseau, il
      // le fait palpiter en blanc (une teinte en cosinus). On garde le principe —
      // le masquer par intermittence le rendrait difficile à suivre au moment
      // précis où l'on vient de le perdre.
      const pulse = 0.55 + Math.cos(h.newShield.t / 3) * 0.45;
      ctx.globalAlpha = 0.55 + pulse * 0.45;
    }
    poser(ctx, sp, sp ? sp.etats[etatIdx].frame : 1, h.x, h.y);
    ctx.restore();
    if (h.flEMP) {                       // brouillé : l'aura du SWF tourne en boucle
      const emp = this.sprites.emp;
      if (emp) {
        ctx.save();
        if (h.EMPTimer < 20) ctx.globalAlpha = Math.max(0, h.EMPTimer / 20);
        poser(ctx, emp, emp.etats[Math.floor(this.animT) % emp.etats.length].frame, h.x, h.y);
        ctx.restore();
      } else {
        ctx.strokeStyle = 'rgba(120,220,255,.8)';
        ctx.beginPath();
        ctx.arc(h.x, h.y, 10 + Math.sin(this.animT / 2) * 2, 0, 6.28);
        ctx.stroke();
      }
    }
  }

  // Cherry.bomb : le pilier de lumière. Le gfx du SWF fait 40×100, ancré au
  // vaisseau et étiré sur toute la hauteur ; sa largeur du moment vient du
  // moteur (laserDemi), qui s'en sert aussi pour faucher.
  dessinerCherryLaser(ctx, h) {
    const sp = this.sprites.cherryLaser;
    if (!sp || !sp.etats.length) return;
    const sx = (h.laserDemi * 2) / 40;
    const pieces = sp.etats[0].pieces;
    ctx.save();
    ctx.translate(h.x, h.y - 4);
    // Le faisceau : étiré en largeur selon la rampe, en hauteur sur tout
    // l'écran (gfx._yscale = mch dans Cherry.bomb).
    if (pieces[0]) {
      ctx.save();
      ctx.scale(sx, HAUTEUR / 100);
      const p = pieces[0];
      const img = images.get(p.fichier);
      if (img) ctx.drawImage(img, p.o ? p.o[0] : -p.w / 2, p.o ? p.o[1] : -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    // L'éclat au pied du rayon suit la même rampe.
    for (let i = 1; i < pieces.length; i++) {
      const p = pieces[i];
      const img = images.get(p.fichier);
      if (!img) continue;
      ctx.save();
      ctx.scale(sx, 1);
      ctx.transform(p.m[0], p.m[1], p.m[2], p.m[3], p.m[4], p.m[5]);
      ctx.drawImage(img, p.o ? p.o[0] : -p.w / 2, p.o ? p.o[1] : -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    ctx.restore();
  }

  // La Figue-laser : un rayon qui s'allume sous elle. Montée (48→36), colonne
  // mortelle (36→12), extinction (12→0) — les bornes du moteur.
  dessinerRayonFigue(ctx, b) {
    const t = b.timer;
    let c;
    if (t > 36) c = (48 - t) / 12 * 0.35;       // il s'amorce
    else if (t > 12) c = 1;                     // il fauche
    else c = t / 12;                            // il s'éteint
    const demi = 2 + 6 * c;
    const grad = ctx.createLinearGradient(b.x - demi, 0, b.x + demi, 0);
    grad.addColorStop(0, 'rgba(255,80,220,0)');
    grad.addColorStop(0.3, 'rgba(255,255,255,' + (0.85 * c) + ')');
    grad.addColorStop(0.7, 'rgba(255,255,255,' + (0.85 * c) + ')');
    grad.addColorStop(1, 'rgba(255,80,220,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(b.x - demi, b.y + 6, demi * 2, HAUTEUR - b.y - 6);
  }

  dessinerBoss(ctx, b) {
    const sp = this.sprites.boss;
    if (!sp) return;
    const frame = (b.forme === E.FORME.COQUILLE) ? sp.etats[0].frame : sp.etats[sp.etats.length - 1].frame;
    ctx.save();
    ctx.translate(b.x, b.y);
    if (b.forme === E.FORME.COQUILLE) ctx.rotate(b.rotation * Math.PI / 180);
    if (b.flash > 0) ctx.globalAlpha = 0.6;   // il vient d'encaisser
    poser(ctx, sp, frame, 0, 0);
    ctx.restore();
    ctx.globalAlpha = 1;
    // Jauge de vie du boss, en haut de l'écran.
    const c = Math.max(0, b.hp / b.hpMax);
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.fillRect(30, 6, LARGEUR - 60, 4);
    ctx.fillStyle = c > 0.5 ? '#7ed957' : (c > 0.25 ? '#ffd76a' : '#ff5a5a');
    ctx.fillRect(30, 6, (LARGEUR - 60) * c, 4);
  }

  // Les bonus : pièces, sauts et cartes gardent leur rendu par famille, avec
  // les couleurs du jeu. Le bonus VAISSEAU montre le vaisseau qu'il donne —
  // le halo étoilé et la silhouette (image 4 du clip Opt du SWF), choisie au
  // largage par le moteur. L'Aliquet n'y figure jamais : il ne se gagne pas.
  dessinerBonus(ctx, o) {
    const b = E.BONUS[o.type] || {};
    const pulse = 0.75 + Math.sin(o.y / 6) * 0.25;
    ctx.save();
    ctx.translate(o.x, o.y);
    if (b.credit !== undefined) {
      // La pièce du SWF, COLORÉE par valeur — Opt.as teinte le clip `piece`
      // (bronze F2D1AA, argent FFFFFF, or FFF58A, platine A5F89E). Le corps
      // d'origine est un morph qu'on ne sait pas rejouer : on prend le dessin
      // de la pièce du compteur et on le colore par sa lumière, ce qui garde
      // son relief. Elle toupille sur son axe au fil de la chute.
      const img = pieceTeintee(this.sprites, o.type);
      if (img) {
        const c = Math.max(0.22, Math.abs(Math.cos(o.y / 5)));
        ctx.scale(c, 1);
        ctx.drawImage(img.canvas, -img.w / 2, -img.h / 2, img.w, img.h);
      } else {
        const cols = ['#F2D1AA', '#FFFFFF', '#FFF58A', '#A5F89E'];
        ctx.fillStyle = cols[o.type] || '#fff';
        ctx.beginPath();
        ctx.arc(0, 0, 5, 0, 6.28);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,.45)';
        ctx.stroke();
      }
    } else if (b.warp !== undefined) {
      this.dessinerSaut(ctx, o);
    } else if (b.nom === 'vie') {
      const halo = this.sprites.optHalo;
      const mini = this.sprites.optVaisseau;
      ctx.globalAlpha = pulse;
      if (halo) poser(ctx, halo, 1, 0, 0);
      if (mini && o.shipId) {
        const etat = mini.etats[Math.max(0, Math.min(mini.etats.length - 1, o.shipId - 1))];
        // opt.gotoAndStop(id+1) à l'échelle 0.2 du clip d'origine.
        poser(ctx, mini, etat.frame, 0, 0, 0.2);
      } else {
        poser(ctx, this.sprites['hero' + (o.shipId || 1)], 1, 0, 0, 0.8);
      }
      ctx.globalAlpha = 1;
    } else {
      const cols = { carteRouge: '#ff4a4a', carteVerte: '#5aff7a', carteBleue: '#5aa8ff' };
      ctx.fillStyle = cols[b.nom] || '#fff';
      ctx.globalAlpha = pulse;
      ctx.fillRect(-5, -7, 10, 14);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(255,255,255,.8)';
      ctx.strokeRect(-5, -7, 10, 14);
    }
    ctx.restore();
  }

  /*
   * Le bonus de SAUT (+5, +10, +20 niveaux) — l'image 2 du clip Opt du SWF.
   *
   * C'est un atome, pas une pastille : un halo, un noyau dont la COULEUR dit la
   * valeur (Opt.as fait `center.gotoAndStop(type-3)` — orange, vert, violet
   * pour +5, +10, +20), un anneau, et QUATRE électrons en orbite — le clip
   * `atome` dupliqué quatre fois, chacun tourné au hasard et lancé sur une
   * image au hasard de sa boucle de quarante-deux. Le portage dessinait à la
   * place un rond bleu avec le chiffre écrit en Verdana par-dessus.
   *
   * La moitié de l'orbite qui passe DERRIÈRE le noyau est celle que le SWF
   * découpe au masque : l'extraction marque ces images, on y dessine donc
   * l'électron sous le noyau au lieu de le poser dessus.
   */
  dessinerSaut(ctx, o) {
    const noyau = this.sprites.optSautNoyau;
    if (!noyau) {                                   // dessins absents : un repère
      ctx.fillStyle = '#8fd0ff';
      ctx.beginPath(); ctx.arc(0, 0, 6, 0, 6.28); ctx.fill();
      return;
    }
    const atome = this.sprites.optSautAtome;
    const derriere = [], devant = [];
    if (atome) {
      const n = atome.etats.length;
      for (const a of (o.atomes || [])) {
        const f = 1 + ((a.image - 1 + Math.floor(o.age || 0)) % n);
        const etat = atome.etats.find((e) => e.frame === f);
        (etat && etat.masque ? derriere : devant).push({ rot: a.rot, f });
      }
    }
    const poserAtome = (e) => {
      ctx.save();
      ctx.rotate(e.rot * Math.PI / 180);
      poser(ctx, atome, e.f, 0, 0);
      ctx.restore();
    };
    for (const e of derriere) poserAtome(e);
    poser(ctx, this.sprites.optSautHalo, 1, 0, 0);
    // Le noyau est posé à 0,777 dans le clip du bonus — sans cette échelle, il
    // déborderait de son anneau.
    poser(ctx, noyau, Math.max(1, Math.min(3, o.type - 3)), 0, 0, 0.777);
    poser(ctx, this.sprites.optSautAnneau, 1, 0, 0);
    for (const e of devant) poserAtome(e);
  }

  dessinerTir(ctx, t, duHero) {
    const sp = this.sprites.shot;
    // L'aspect vient du moteur quand le tir en a un propre (les spéciales, les
    // mines, les cartes) ; sinon c'est l'aspect standard du camp — celui du
    // vaisseau (1+type) ou de l'espèce (10+type), comme les gotoAndStop du SWF.
    const frame = t.aspect || (duHero ? 1 + (t.heroType || 0) : 10 + (t.badsType || 0));

    // Le rayon de la Cosmirabelle (comportement 5) est un dessin composé :
    // la boule file, le rayon GRANDIT derrière elle, et l'éclat du départ
    // s'éteint sur place (Shot.update case 5 pilote square et flare).
    if (t.behaviourId === 5) { this.dessinerRayonMirabelle(ctx, t); return; }
    // La mine du Brugnon (comportement 23) n'est pas un dessin mais un CLIP
    // ANIMÉ : l'image 58 des projectiles ne fait que le poser.
    if (t.behaviourId === 23) { this.dessinerMine(ctx, t); return; }
    // Deux autres projectiles posent un sous-clip qui JOUE — le trou noir de
    // la Nectarine et l'éclatement du tir de Kiwi (cf. CLIPS_TIR). Tant qu'ils
    // dorment sur leur image 1, c'est le petit projectile du départ ; dès que
    // Shot.as les lance, c'est leur pellicule qu'on voit.
    const clip = E.CLIPS_TIR[t.behaviourId];
    if (clip && this.sprites[clip.cle]) {
      const sp2 = this.sprites[clip.cle];
      const n = Math.max(1, Math.min(t.clipImage || 1, sp2.etats[sp2.etats.length - 1].frame));
      ctx.save();
      ctx.translate(t.x, t.y);
      // Le trou noir, une fois ouvert, ne tourne plus avec sa vitesse : il est
      // posé à plat, comme le clip d'époque qui s'arrête sur place.
      if (!t.clipJoue) ctx.rotate((t.rot !== undefined) ? t.rot : Math.atan2(t.vity, t.vitx));
      poser(ctx, sp2, n, 0, 0);
      ctx.restore();
      return;
    }

    if (sp && sp.etats.some((e) => e.frame === frame)) {
      // Les projectiles sont dessinés pointe à droite ; le jeu les oriente selon
      // leur vitesse (Shot.updateRotation) — ou selon leur toupie (`rot`) quand
      // ils tournent sur eux-mêmes, comme l'étoile du Coing mutant.
      const a = (t.rot !== undefined) ? t.rot : Math.atan2(t.vity, t.vitx);
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.rotate(a);
      let echelle = 1;
      if (t.behaviourId === 7) {
        // Le souffle d'explosion s'étire avec son rayon (_xscale = ray*2) et
        // s'estompe sur ses cinq dernières images.
        echelle = (t.behaviourInfo.ray * 2) / 100;
        if (t.behaviourInfo.timer < 10) ctx.globalAlpha = Math.max(0, t.behaviourInfo.timer / 10);
      } else if (frame === 18) {
        // La bombe du Pamplemousse bat comme un cœur : le halo blanc du SWF
        // gonfle et retombe sur vingt images.
        const c = 0.5 - 0.5 * Math.cos((t.age % 20) / 20 * 6.28);
        echelle = 1 + 0.2 * c;
      }
      poser(ctx, sp, frame, 0, 0, echelle);
      ctx.restore();
      ctx.globalAlpha = 1;
      return;
    }
    // Aspect inconnu (un comportement spécial sans image dédiée) : un point,
    // plutôt qu'un projectile invisible qui tuerait sans prévenir.
    ctx.fillStyle = duHero ? '#bff18d' : '#ff8a5a';
    ctx.fillRect(t.x - 1, t.y - 2, 2, 4);
  }

  /*
   * La MINE du Brugnon cuirassé.
   *
   * L'image 58 du clip des projectiles ne pose pas un dessin : elle pose un
   * sous-clip qui JOUE. La mine s'amorce en grossissant (images 1→10), atteint
   * ses vingt-quatre pixels et bat sur place en boucle (11→23, l'image 23
   * renvoyant à la 11), puis, abattue, joue sa destruction (24→33).
   *
   * L'extraction l'avait aplatie à son image 1 — deux pixels de large. On voyait
   * donc les éclats qu'elle sème partir de nulle part, sans jamais voir ce qui
   * les lançait. Elle se dessine ici à l'image où elle en est.
   */
  dessinerMine(ctx, t) {
    const sp = this.sprites.mineBrugnon;
    if (!sp) { ctx.fillStyle = '#ff8a5a'; ctx.fillRect(t.x - 3, t.y - 3, 6, 6); return; }
    let frame;
    if (t.mourant !== undefined) {
      frame = Math.min(33, 24 + Math.floor(t.mourant));
    } else {
      const n = Math.floor(t.age || 0);
      frame = n < E.MINE_AMORCE ? 1 + n : 11 + ((n - E.MINE_AMORCE) % E.MINE_BOUCLE);
    }
    ctx.save();
    ctx.translate(t.x, t.y);
    if (t.rot !== undefined) ctx.rotate(t.rot);
    poser(ctx, sp, frame, 0, 0);
    ctx.restore();
  }

  // Mirabelle.shoot : la boule de tête tire un rayon long de `length` px qui
  // se déploie derrière elle à mesure qu'elle avance (square._xscale suit le
  // parcouru), pendant qu'un éclat s'amenuise au point de départ. Le moteur
  // fauche sur toute la colonne du rayon — le dessin doit la montrer.
  dessinerRayonMirabelle(ctx, t) {
    const o = t.behaviourInfo;
    const long = Math.min(o.parcouru || 0, o.length || 160);
    const a = Math.atan2(t.vity, t.vitx);
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.rotate(a);
    if (long > 1) {
      // Le rayon, du blanc chaud bordé de rose — étiré de la boule vers
      // l'arrière, comme le square du SWF.
      const grad = ctx.createLinearGradient(0, -2.6, 0, 2.6);
      grad.addColorStop(0, 'rgba(250,110,250,0)');
      grad.addColorStop(0.35, 'rgba(255,255,255,.95)');
      grad.addColorStop(0.65, 'rgba(255,255,255,.95)');
      grad.addColorStop(1, 'rgba(250,110,250,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(-long, -2.6, long, 5.2);
    }
    // La boule de tête : le disque blanc auréolé de cyan du SWF (la pièce
    // 14×14 de l'image 33) — SANS le carré du rayon, dessiné en dégradé
    // ci-dessus.
    const boule = images.get('shape1200.svg');
    if (boule) ctx.drawImage(boule, -7, -7, 14, 14);
    else { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, 4, 0, 6.28); ctx.fill(); }
    ctx.restore();
    // L'éclat du départ, qui s'éteint à mesure que le rayon s'étire.
    if (o.sx !== undefined) {
      const c = Math.min((o.parcouru || 0) / (o.length || 160), 1);
      if (c < 1) {
        ctx.save();
        ctx.globalAlpha = 1 - c;
        ctx.fillStyle = 'rgba(255,255,255,.9)';
        ctx.beginPath();
        ctx.arc(o.sx, o.sy, 4 * (1 - c), 0, 6.28);
        ctx.fill();
        ctx.restore();
      }
    }
  }

  dessinerInterface(ctx, tmod) {
    const jeu = this.jeu;
    // Le panneau de score du SWF : les chiffres en Jawbreaker 24, blanc à
    // 60 %, CENTRÉS en haut, flanqués des pointillés d'ornement (b1 en
    // miroir à gauche, b2 à droite — panel/Score.as).
    ctx.font = '24px Jawbreaker, Verdana, sans-serif';
    ctx.textBaseline = 'top';
    const texte = String(jeu.score);
    const tw = ctx.measureText(texte).width;
    const px = (LARGEUR - tw) / 2;
    ctx.fillStyle = 'rgba(255,255,255,.6)';
    ctx.fillText(texte, px, -2);
    const orne = this.sprites.scoreOrne;
    if (orne) {
      ctx.save();
      ctx.translate(px - 0.7, 2.4);
      ctx.scale(-1, 1);
      poser(ctx, orne, 1, 0, 0);
      ctx.restore();
      poser(ctx, orne, 1, px + tw + 6, 2.4);
    }

    // Les vies : l'escadron en réserve, rangé en BAS À DROITE à 40 %
    // (LifePanel.as : taille 8 sur des dessins de 20).
    for (let i = 0; i < Math.min(jeu.heroList.length, 8); i++) {
      poser(ctx, this.sprites['hero' + (jeu.heroList[i] || 0)], 1,
        LARGEUR - (i + 0.5) * 12, HAUTEUR - 6, 0.4);
    }
    // Bombe disponible : elle ne sert qu'une fois, autant que ça se voie.
    if (jeu.hero && jeu.hero.flBomb) {
      ctx.fillStyle = '#ffd76a';
      ctx.beginPath();
      ctx.arc(5, HAUTEUR - 24, 2.5, 0, 6.28);
      ctx.fill();
    }
    // Le compteur de crédits : le PORTEFEUILLE, pas la seule récolte de la
    // manche. Le jeu d'origine crédite la fiche en direct (Game.incCred fait
    // $credit += n pendant la partie) — le joueur du bureau lit donc toujours
    // son solde total. On affiche le même nombre : fiche + manche en cours,
    // derrière la pièce du compteur du SWF, en bas à gauche.
    const bourse = (jeu.portefeuille || 0) + jeu.credits;
    if (bourse > 0) {
      poser(ctx, this.sprites.piece, 1, 7, HAUTEUR - 9);
      ctx.font = '14px Jawbreaker, Verdana, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      ctx.fillText(String(bourse), 15, HAUTEUR - 16);
    }
    // Letter Invader : les boucliers, à la place des vies (il n'y a pas de
    // vaisseau à perdre, seulement des fautes de frappe à ne pas faire).
    ctx.font = '10px VerdanaPix, Verdana, sans-serif';
    if (jeu.boucliers !== undefined) {
      ctx.textAlign = 'right';
      ctx.fillStyle = jeu.boucliers > 1 ? '#8fd0ff' : '#ff8a5a';
      ctx.fillText('◆'.repeat(Math.max(0, jeu.boucliers)), LARGEUR - 4, 3);
      ctx.textAlign = 'left';
      if (jeu.combo && jeu.combo.num > 1) {
        ctx.fillStyle = '#ffd76a';
        ctx.fillText('combo ' + jeu.combo.num, 4, 3);
      }
    }
    // Endurance : le palier atteint, seule mesure d'avancement du mode.
    if (this.mode === 'survival') {
      ctx.fillStyle = '#8fd0ff';
      ctx.fillText('palier ' + (jeu.level + 1), 4, 3);
    }

    if (this.panneauT > 0 && this.panneau) this.dessinerMessage(ctx);
  }

  // Les panneaux du SWF (miniWave2Msg) : le bandeau de l'image type+1, centré
  // verticalement, qui FOND à l'ouverture et à la fermeture (Msg.update fait
  // alpha = alpha*0.8 + cible*0.2). Les textes reprennent les polices et
  // tailles des champs d'origine.
  dessinerMessage(ctx) {
    const p = this.panneau;
    const sp = this.sprites.msg;
    if (!p || typeof p !== 'object') return;
    if (p.alpha < 0.01) return;

    const etat = sp && sp.etats[Math.min(p.type, sp.etats.length - 1)];
    const h = etat ? etat.pieces[0].h : 58;
    const oy = etat && etat.pieces[0].o ? etat.pieces[0].o[1] : 0;
    const y = (HAUTEUR - h) / 2 - oy;
    ctx.save();
    ctx.globalAlpha = p.alpha;
    if (etat) poser(ctx, sp, etat.frame, 0, y);
    else { ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.fillRect(0, y, LARGEUR, h); }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const haut = y + oy;                             // le bord haut du bandeau
    switch (p.type) {
      case 0:                                        // niveau : titre + nom
        ctx.font = '32px ArcadeClassic, Verdana, sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(p.titre, LARGEUR / 2, haut + 10);
        ctx.font = '10px VerdanaPix, Verdana, sans-serif';
        ctx.fillText(p.texte, LARGEUR / 2, haut + 38);
        break;
      case 1:                                        // game over
        // La Jawbreaker : l'Arcade Classic du SWF n'a ni G ni M — le panneau
        // d'origine posait ce texte dans une autre police.
        ctx.font = '24px Jawbreaker, Verdana, sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.fillText('GAME OVER', LARGEUR / 2, haut + 24);
        break;
      case 2:                                        // fin du parcours
        ctx.font = '32px ArcadeClassic, Verdana, sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.fillText('BRAVO', LARGEUR / 2, haut + 30);
        ctx.font = '10px VerdanaPix, Verdana, sans-serif';
        this.texteMultiligne(ctx, p.texte, LARGEUR / 2, haut + 72, 200, 12);
        break;
      case 3:                                        // l'avertissement du boss
        ctx.font = '10px VerdanaPix, Verdana, sans-serif';
        ctx.fillStyle = '#ffffff';
        this.texteMultiligne(ctx, p.texte, LARGEUR / 2, haut + 38, 200, 12);
        break;
      default: break;
    }
    ctx.textAlign = 'left';
    ctx.restore();
  }

  // Un petit repli de texte : les champs du SWF étaient multilignes.
  texteMultiligne(ctx, texte, x, y, largeur, interligne) {
    const mots = String(texte).split(' ');
    let ligne = '';
    for (const mot of mots) {
      const essai = ligne ? ligne + ' ' + mot : mot;
      if (ctx.measureText(essai).width > largeur && ligne) {
        ctx.fillText(ligne, x, y);
        y += interligne;
        ligne = mot;
      } else {
        ligne = essai;
      }
    }
    if (ligne) ctx.fillText(ligne, x, y);
  }

  // Le voile de pause : la scène assombrie de moitié (Manager.setPause pose un
  // setPColor noir à 50) et l'écusson du SWF — le cadre arrondi et son mot.
  dessinerPause(ctx) {
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = 'rgba(0,0,0,.5)';
    ctx.fillRect(0, 0, LARGEUR, HAUTEUR);
    // Le cadre du SWF porte ses coordonnées de scène (le clip mcPause était
    // posé à l'origine) : on le pose donc à 0,0 et il se centre tout seul.
    poser(ctx, this.sprites.pause, 1, 0, 0);
    ctx.font = '14px Jawbreaker, Verdana, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('PAUSE', LARGEUR / 2, HAUTEUR / 2 - 1.5);
    ctx.font = '10px VerdanaPix, Verdana, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,.75)';
    ctx.fillText('P, Échap ou ⏸ pour reprendre', LARGEUR / 2, HAUTEUR / 2 + 22);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  // ── Mise à l'échelle ──
  // Les dessins font 16 à 20 pixels : un facteur ENTIER les garde nets. Mais un
  // écran de 400 points ne loge que ×1 d'une aire de 240, ce qui laisserait 40 %
  // de largeur inutilisée — on préfère alors remplir. Règle : l'entier s'il
  // occupe au moins 85 % de la place, sinon la valeur exacte.
  redimensionner() {
    const parent = this.canvas.parentElement || document.body;
    const dispo = Math.min(parent.clientWidth, parent.clientHeight) || 240;
    const exact = dispo / LARGEUR;
    const entier = Math.floor(exact);
    const k = (entier >= 1 && entier / exact >= 0.85) ? entier : exact;
    this.echelle = k;
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.canvas.width = LARGEUR * this.dpr;
    this.canvas.height = HAUTEUR * this.dpr;
    this.canvas.style.width = (LARGEUR * k) + 'px';
    this.canvas.style.height = (HAUTEUR * k) + 'px';
    this.ctx.imageSmoothingEnabled = false;
  }

  // ── Commandes ──
  // Clavier pour le bureau (les flèches et l'espace, comme le jeu d'origine), et
  // trois zones tactiles pour le téléphone. Le tir est MAINTENU : le vaisseau a
  // sa propre cadence, inutile de marteler.
  brancherCommandes(racine) {
    this.surfaces = [];
    const touches = {
      ArrowLeft: 'gauche', ArrowRight: 'droite', ' ': 'tir',
      q: 'gauche', d: 'droite', a: 'gauche',
      ArrowUp: 'tir', Shift: 'bombe',
    };
    /*
     * REPRENDRE LE FOCUS — sinon le clavier ne sert à rien.
     *
     * Sur /light le jeu tourne dans une IFRAME, et les touches ne lui arrivent
     * que si elle a le focus. Or le pilotage au pointeur appelle
     * `preventDefault()` sur `pointerdown` (il le faut : c'est ce qui empêche
     * le navigateur de sélectionner et de faire défiler pendant qu'on vise) —
     * et ce faisant il annule aussi le transfert de focus que le clic aurait
     * provoqué. Résultat : on pouvait cliquer autant qu'on voulait, les touches
     * partaient à la page parente et le vaisseau restait sourd au clavier.
     *
     * On réclame donc le focus à la main, à la première interaction et à
     * chaque appui. En fenêtre autonome (le disque dans la Frusion) c'est sans
     * effet — elle l'a déjà.
     */
    const reprendreFocus = () => { try { window.focus(); } catch (e) { /* refusé */ } };
    for (const ev of ['pointerdown', 'touchstart', 'mousedown']) {
      window.addEventListener(ev, reprendreFocus, { capture: true, passive: true });
    }

    window.addEventListener('keydown', (ev) => {
      // P et Échap : la pause, comme Manager.update (touches 80 et 27). Le
      // « P » ne désigne jamais un monstre de Letter Invader — il est libre.
      if (ev.key === 'p' || ev.key === 'P' || ev.key === 'Escape') {
        if (this.jeu && !(this.avant && this.avant.visible)) {
          this.pauser();
          ev.preventDefault();
          return;
        }
      }
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

    // ── Le pilotage au doigt ──
    // Le pouce MONTRE la destination : sa position X (sur la bande OU sur le
    // jeu lui-même — l'instinct pose le doigt n'importe où) devient la cible,
    // que le vaisseau rejoint à SA vitesse (c'est le moteur qui marche). Le
    // tir est continu tant que le pouce est posé — la cadence reste celle du
    // vaisseau, c'est le coolDown qui gouverne — et s'arrête au relâcher. Un
    // double-tap déclenche la spéciale. Pas de bouton de tir : c'est toute
    // l'idée.
    //
    // POINTER EVENTS d'abord (iOS 13+, Android, souris — un seul chemin, et
    // setPointerCapture garantit le suivi même quand le doigt déborde de la
    // surface) ; repli touch/mouse pour les navigateurs d'un autre âge.
    let dernierTap = 0;
    const piloter = (surface, horsMenu) => {
      if (!surface) return;
      const viser = (ev) => {
        const t = (ev.touches && ev.touches[0]) || ev;
        const r = surface.getBoundingClientRect();
        if (!r.width) return;
        const gx = ((t.clientX - r.left) / r.width) * LARGEUR;
        this.entree.cibleX = Math.max(0, Math.min(LARGEUR, gx));
      };
      const poser_ = (ev) => {
        // Sur le canevas, les appuis appartiennent au MENU tant qu'il est
        // ouvert (il écoute pointerdown lui aussi) : on ne pilote qu'en jeu.
        if (horsMenu && this.avant && this.avant.visible) return;
        if (ev.cancelable) ev.preventDefault();
        if (this.flPause) return;                      // figé : on ne pilote pas
        viser(ev);
        this.entree.tir = true;
        surface.classList.add('on');
        const t = Date.now();
        if (t - dernierTap < 320) {                    // double-tap : la spéciale
          this.entree.bombe = true;
          setTimeout(() => { this.entree.bombe = false; }, 120);
        }
        dernierTap = t;
      };
      const glisser = (ev) => {
        if (ev.cancelable) ev.preventDefault();
        if (this.entree.tir) viser(ev);
      };
      // Deux surfaces pilotent (la bande tactile et le canevas) et partagent la
      // même commande. Sans savoir QUI tient le doigt, le relâchement de l'une
      // effaçait la prise de l'autre : le pouce resté posé ne visait plus rien
      // (glisser ne vise que si `tir`), et le vaisseau restait cloué à son
      // dernier point. Chaque surface retient donc son pointeur.
      const etat = { el: surface, pointeur: null };
      this.surfaces.push(etat);
      const lever = (ev) => {
        if (ev && ev.cancelable) ev.preventDefault();
        if (ev && ev.pointerId !== undefined && etat.pointeur !== null
          && ev.pointerId !== etat.pointeur) return;   // ce n'est pas notre doigt
        etat.pointeur = null;
        this.entree.tir = false;
        this.entree.cibleX = null;                     // le clavier reprend la main
        surface.classList.remove('on');
      };
      if (window.PointerEvent) {
        surface.addEventListener('pointerdown', (ev) => {
          try { surface.setPointerCapture(ev.pointerId); } catch (e) { /* vieux moteurs */ }
          etat.pointeur = ev.pointerId;
          poser_(ev);
        });
        surface.addEventListener('pointermove', glisser);
        surface.addEventListener('pointerup', lever);
        surface.addEventListener('pointercancel', lever);
        // Le « lever » se perd parfois (fenêtre qui bascule, capture rompue) :
        // sans lui, la prise resterait éternelle.
        surface.addEventListener('lostpointercapture', lever);
      } else {
        surface.addEventListener('touchstart', poser_, { passive: false });
        surface.addEventListener('touchmove', glisser, { passive: false });
        surface.addEventListener('touchend', lever, { passive: false });
        surface.addEventListener('touchcancel', lever, { passive: false });
        surface.addEventListener('mousedown', poser_);
        surface.addEventListener('mousemove', glisser);
        surface.addEventListener('mouseup', lever);
        surface.addEventListener('mouseleave', lever);
      }
    };
    piloter((racine.querySelector ? racine : document).querySelector('#pave-tactile'), false);
    piloter(this.canvas, true);
  }
}

window.MiniwaveClient = { Client, charger, chargerDecor, poser, images, decor };

})();
