/*
 * MiniFever — le RENDU.
 *
 * Le moteur ne connaît que des positions ; ce fichier les dessine. Il charge le
 * manifeste sorti du SWF (sprites.json et ses tracés SVG), pose chaque objet de
 * la scène à sa profondeur, et tient la boucle — un pas d'UNE image nominale,
 * comme les quarante images par seconde du jeu d'origine.
 *
 * Le décor d'une épreuve est le clip du mini-jeu lui-même (`gameBasket`…), posé
 * au fond ; les acteurs viennent par-dessus.
 */
'use strict';

(function (racine) {

const sousNode = (typeof module !== 'undefined' && module.exports);
const E = sousNode ? require('./engine.js') : racine.MinifeverEngine;
const { LARGEUR, HAUTEUR, IPS, TMOD_LISSAGE, TMOD_SAUT, CADENCE_FLASH } = E;
const IMAGE_FLASH = 1 / CADENCE_FLASH;

const images = new Map();          // fichier SVG → Image
let manifeste = null;
let baseDessins = '/minifever/sprites/';

/*
 * LES PICTOS DES ÉPREUVES — le dessin qui NOMME un mini-jeu.
 *
 * La console de l'entre-deux-épreuves montrait le symbole `gameX` brut, c'est
 * à dire le DÉCOR NU : la salle vide, sans un seul acteur. La moitié des
 * épreuves s'y réduisait à un aplat de couleur — le renvoi un rectangle rouge,
 * la bombe un rectangle vert, le taquin un rectangle brun — et la photo, dont
 * le décor est un fond noir, ne montrait rien du tout. Pendant le tirage,
 * regarder défiler des rectangles n'apprend rien de l'épreuve qui vient.
 *
 * Les pictos, eux, existent déjà : scripts/make-minifever-pictos.js recoud le
 * décor ET ses acteurs en un SVG par épreuve (le panier avec son ballon, le
 * maillet avec sa bestiole…). C'est le dessin de l'album ; c'est donc lui que
 * la console doit montrer. Une seule source, un seul dessin.
 *
 * Le nom du fichier se déduit de la clef : `gameJumpFish` → `jumpfish.svg`.
 */
const pictos = new Map();          // clef de jeu → Image (ou null si absent)
let basePictos = '/minifever/pictos/';
const fichierPicto = (cle) => String(cle || '').replace(/^game/, '').toLowerCase() + '.svg';

/** Charge le manifeste et tous ses dessins. `surAvance` suit le chargement. */
function charger(base, surAvance) {
  base = base || '/minifever/sprites/';
  baseDessins = base;
  return fetch(base + 'sprites.json', { cache: 'force-cache' })
    .then((r) => r.json())
    .then((m) => {
      manifeste = m;
      const fichiers = new Set();
      for (const s of Object.values(m)) for (const e of s.etats) for (const p of e.pieces) fichiers.add(p.fichier);
      const liste = [...fichiers];
      let faits = 0;
      return Promise.all(liste.map((f) => new Promise((res) => {
        const im = new Image();
        im.onload = im.onerror = () => {
          images.set(f, im.naturalWidth ? im : null);
          if (surAvance) surAvance(++faits / liste.length);
          res();
        };
        im.src = base + f;
      }))).then(() => m);
    });
}

/**
 * Les pictos des épreuves, chargés à part — un par clef du catalogue.
 *
 * Ils ne sont PAS dans le manifeste : ce sont des dessins de plateforme
 * (comme les monstres de MiniWave), pas des symboles du SWF. On les charge
 * donc à côté, sans bloquer la partie : un picto qui manque laisse la console
 * retomber sur le décor du jeu, comme avant.
 */
function chargerPictos(catalogue, base) {
  basePictos = base || basePictos;
  const cles = (catalogue || []).map((j) => j.cle).filter(Boolean);
  return Promise.all(cles.map((cle) => new Promise((res) => {
    if (pictos.has(cle)) return res();
    const im = new Image();
    im.onload = im.onerror = () => { pictos.set(cle, im.naturalWidth ? im : null); res(); };
    im.src = basePictos + fichierPicto(cle);
  })));
}

/**
 * Les mesures dont le moteur a besoin : nombre d'images et boîte du dessin.
 * C'est elle qui tient lieu de `getBounds()` — les mini-jeux s'en servent pour
 * savoir où finit un dessin. Elle prend un manifeste en argument pour rester
 * vérifiable hors navigateur.
 */
function mesures(m) {
  const out = {};
  for (const [cle, s] of Object.entries(m || manifeste || {})) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    // La boîte se lit sur la première image DESSINÉE — une pellicule peut
    // commencer ou finir sur une image-clé vide (le souffle de Gather).
    const e = s.etats.find((t) => t.pieces.length) || s.etats[0];
    for (const p of e.pieces) {
      const ox = p.o ? p.o[0] : -p.w / 2;
      const oy = p.o ? p.o[1] : -p.h / 2;
      for (const [cx, cy] of [[ox, oy], [ox + p.w, oy], [ox, oy + p.h], [ox + p.w, oy + p.h]]) {
        const X = p.m[0] * cx + p.m[2] * cy + p.m[4];
        const Y = p.m[1] * cx + p.m[3] * cy + p.m[5];
        x0 = Math.min(x0, X); x1 = Math.max(x1, X);
        y0 = Math.min(y0, Y); y1 = Math.max(y1, Y);
      }
    }
    out[cle] = {
      // Le NUMÉRO de la dernière image, pas le compte d'états : une pellicule
      // clairsemée (images-clés tenues) va au-delà de ses états.
      nbImages: s.etats[s.etats.length - 1].frame,
      boite: isFinite(x0) ? { x0, y0, x1, y1 } : { x0: -10, y0: -10, x1: 10, y1: 10 },
    };
    // La chaîne de l'œil (sym673_pupille) : la partie linéaire du chemin des
    // placements jusqu'à l'œil, par image — le jeu s'en sert pour traduire le
    // décalage du regard en décalage écran.
    if (s.etats.some((e) => e.lin)) out[cle].lins = s.etats.map((e) => e.lin || null);
    if (s.contour) out[cle].contour = s.contour;   // la forme de collision (grotte)
  }
  return out;
}

/*
 * Les MASQUES — `skin.setMask(mc)` des sources.
 *
 * Un Mc qui porte `masque: 'sym202'` ne se dessine QUE dans la forme de ce
 * symbole (l'ingrédient de la marmite disparaît dans la soupe en passant la
 * courbe du bord). La forme vient du SVG extrait : ses chemins, posés dans les
 * coordonnées du symbole — ici celles de la scène, le masque s'accrochant en
 * (0,0) — deviennent un Path2D que la toile applique en découpe. Le fichier se
 * lit à la première demande ; d'ici là, le Mc se dessine entier, comme un clip
 * Flash avant son setMask.
 *
 * Un masque qui BOUGE s'écrit `masque: { cle, x, y, sx, sy }` — la forme du
 * symbole, posée là : le carré du trampoline suit la ligne du mur, la fenêtre
 * capsule de Tubulo se pose sur chaque case.
 *
 * Un masque qui GRANDIT porte des `enfants: [{ cle, x, y, sx, sy, rot }]` —
 * les clips que le jeu accroche DANS le masque, aux coordonnées locales du
 * masque (Std.attachMC(mask, …) d'époque) : chaque morsure de la pomme est
 * une forme de plus dans la découpe, et le tout suit la position et la
 * rotation du masque.
 */
const masques = new Map();         // clé de symbole → Path2D (null : en cours)

function cheminMasque(cle) {
  if (masques.has(cle)) return masques.get(cle);
  masques.set(cle, null);
  const s = manifeste && manifeste[cle];
  if (!s) return null;
  Promise.all(s.etats[0].pieces.map((p) => fetch(baseDessins + p.fichier, { cache: 'force-cache' })
    .then((r) => r.text()).then((t) => ({ p, t }))))
    .then((morceaux) => {
      const chemin = new Path2D();
      for (const { p, t } of morceaux) {
        const M = new DOMMatrix(p.m);
        for (const m of t.matchAll(/\bd="([^"]+)"/g)) chemin.addPath(new Path2D(m[1]), M);
      }
      masques.set(cle, chemin);
    })
    .catch(() => { masques.delete(cle); });
  return null;
}

/**
 * Pose un dessin (une image d'un symbole) sur la toile.
 *
 * L'image demandée se résout comme dans le lecteur : la dernière IMAGE-CLÉ
 * atteinte tient jusqu'à la suivante. Une image-clé vide ne dessine rien —
 * c'est ainsi que la bouffée du souffle s'éteint au milieu de sa pellicule.
 */
function poser(ctx, cle, image, x, y, sx, sy, rot, alpha) {
  const s = manifeste && manifeste[cle];
  if (!s) return;
  let etat = null;
  for (const e of s.etats) {
    if (e.frame > image) break;
    etat = e;
  }
  etat = etat || s.etats[0];
  if (!etat.pieces.length) return;
  ctx.save();
  ctx.translate(x, y);
  if (rot) ctx.rotate(rot * Math.PI / 180);
  if (sx !== 1 || sy !== 1) ctx.scale(sx, sy);
  if (alpha !== undefined && alpha !== 1) ctx.globalAlpha *= alpha;
  for (const p of etat.pieces) {
    const im = images.get(p.fichier);
    if (!im) continue;
    ctx.save();
    ctx.transform(p.m[0], p.m[1], p.m[2], p.m[3], p.m[4], p.m[5]);
    ctx.drawImage(im, p.o ? p.o[0] : -p.w / 2, p.o ? p.o[1] : -p.h / 2, p.w, p.h);
    ctx.restore();
  }
  ctx.restore();
}

class Client {
  constructor(o) {
    this.canvas = o.canvas;
    this.ctx = this.canvas.getContext('2d');
    this.socle = null;
    this.raf = null;
    this.dernier = 0;
    this.attente = 0;              // le temps accumulé vers la prochaine image Flash
    this.derniereImage = 0;
    this.tmod = 1;                 // Timer.tmod, initialisé à 1 comme dans le SWF
    this.echelle = 1;
    this.surEvenement = o.surEvenement || null;
    this.redimensionner();
    window.addEventListener('resize', () => this.redimensionner());
    // Le cadre bouge aussi SANS que la fenêtre bouge : le bandeau se
    // remplit après le premier tour (« chargement… » puis trois lignes), le
    // panneau du light s'ouvre, le téléphone pivote. On observe donc la
    // boîte elle-même — sans quoi la scène, mesurée trop tôt, déborde.
    if (typeof ResizeObserver === 'function' && this.canvas.parentElement) {
      this.observateur = new ResizeObserver(() => this.redimensionner());
      this.observateur.observe(this.canvas.parentElement);
    }
    this.brancher();
  }

  /*
   * La scène est carrée (240 × 240, Cs.mcw × Cs.mch) et elle prend TOUT le
   * cadre : sur un téléphone de 390 px, elle fait 390 de large.
   *
   * Minipixiz, lui, s'agrandit d'un facteur ENTIER tant qu'il peut — ses
   * dessins font seize pixels, une fraction les rendrait flous. Mini-Fever
   * n'a pas ce souci : son art est VECTORIEL (des chemins SVG), il s'affine
   * en grandissant au lieu de pixelliser. On prend donc le facteur juste,
   * fraction comprise, et la toile reçoit autant de pixels que l'écran en a
   * vraiment (le facteur × la densité, plafonnée à trois) ; tout le tracé se
   * fait ensuite en coordonnées de SCÈNE grâce à `pixels`, la transformation
   * posée en tête de chaque image.
   */
  redimensionner() {
    const parent = this.canvas.parentElement || document.body;
    const k = Math.min((parent.clientWidth || LARGEUR) / LARGEUR,
      (parent.clientHeight || HAUTEUR) / HAUTEUR);
    this.echelle = k;
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.pixels = k * this.dpr;
    this.canvas.width = Math.max(1, Math.round(LARGEUR * this.pixels));
    this.canvas.height = Math.max(1, Math.round(HAUTEUR * this.pixels));
    this.canvas.style.width = (LARGEUR * k) + 'px';
    this.canvas.style.height = (HAUTEUR * k) + 'px';
  }

  /** La position d'un événement, ramenée au repère de la scène (240 × 240). */
  versScene(ev) {
    const r = this.canvas.getBoundingClientRect();
    const cx = (ev.clientX !== undefined) ? ev.clientX : (ev.touches && ev.touches[0] ? ev.touches[0].clientX : 0);
    const cy = (ev.clientY !== undefined) ? ev.clientY : (ev.touches && ev.touches[0] ? ev.touches[0].clientY : 0);
    return { x: (cx - r.left) / (r.width || 1) * LARGEUR, y: (cy - r.top) / (r.height || 1) * HAUTEUR };
  }

  brancher() {
    // Au doigt comme à la souris, la POSITION compte autant que l'appui : la
    // moitié des mini-jeux vise avec `_xmouse`. Un appui pose donc aussi le
    // pointeur, sans quoi le premier tour de boucle jouerait à côté.
    const bouger = (ev) => {
      if (!this.socle) return;
      const p = this.versScene(ev);
      this.socle.bouger(p.x, p.y);
    };
    const bas = (ev) => {
      if (ev.cancelable) ev.preventDefault();
      bouger(ev);
      if (this.socle) {
        // Doigt ou souris ? Certains jeux en tiennent compte : Tubulo vise la
        // case VISIBLE au doigt (pas de survol pour guider la main), le
        // maillet la tête la plus proche, le point à point élargit son
        // couloir. pointerType peut être VIDE (la spécification l'autorise
        // quand le navigateur ne sait pas) : dans le doute, un écran qui n'a
        // qu'un pointeur grossier est un écran tactile.
        this.socle.flTactile = ev.pointerType
          ? ev.pointerType !== 'mouse'
          : (String(ev.type).startsWith('touch')
            || !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches));
        this.socle.click();
      }
    };
    const haut = (ev) => {
      if (ev && ev.cancelable) ev.preventDefault();
      if (this.socle) this.socle.relache();
    };
    if (window.PointerEvent) {
      this.canvas.addEventListener('pointerdown', bas);
      window.addEventListener('pointermove', bouger);
      window.addEventListener('pointerup', haut);
      window.addEventListener('pointercancel', haut);
    } else {
      this.canvas.addEventListener('touchstart', bas, { passive: false });
      this.canvas.addEventListener('touchmove', bouger, { passive: false });
      window.addEventListener('touchend', haut);
      this.canvas.addEventListener('mousedown', bas);
      window.addEventListener('mousemove', bouger);
      window.addEventListener('mouseup', haut);
    }
    // Une fenêtre qui part ne rend jamais le doigt levé.
    window.addEventListener('blur', haut);
    // L'appui long d'Android ouvre un menu contextuel ET coupe le flux de
    // pointeurs (pointercancel) : viser en restant appuyé — panier, fusée,
    // arrosage — devenait une loterie au doigt.
    this.canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());
  }

  nouvellePartie(Mode, catalogue, opt) {
    this.socle = new Mode(Object.assign({
      mesures: mesures(),
      catalogue,
      surEvenement: (n, d) => { if (this.surEvenement) this.surEvenement(n, d); },
    }, opt || {}));
    this.socle.demarrer();
    this.dernier = 0;
    this.attente = 0;
    this.derniereImage = 0;
    this.etoiles = 0;
    return this.socle;
  }

  demarrer() {
    if (this.raf) return;
    const boucle = (t) => {
      this.raf = requestAnimationFrame(boucle);
      if (!this.dernier) { this.dernier = t; this.attente = 0; this.derniereImage = t; return; }
      this.attente += (t - this.dernier) / 1000;
      this.dernier = t;
      // La boucle du LECTEUR, comme Mini-Wave : la racine du SWF appelle son
      // update UNE fois par image Flash (la boucle gotoAndPlay des images 6-7),
      // à la cadence de l'en-tête — et Timer.update en tire un tmod
      // FRACTIONNAIRE (≈ 32/40 = 0,8 sur une machine à l'aise), la moyenne
      // glissante du temps réel entre images exécutées. En retard, Flash saute
      // des images, il ne les rattrape pas : l'excédent est perdu.
      if (this.attente >= IMAGE_FLASH) {
        this.attente = Math.min(this.attente - IMAGE_FLASH, IMAGE_FLASH);
        const ecart = (t - this.derniereImage) / 1000;
        this.derniereImage = t;
        if (ecart > 0 && ecart < TMOD_SAUT) {
          this.tmod = this.tmod * TMOD_LISSAGE + (1 - TMOD_LISSAGE) * ecart * IPS;
        }
        if (this.socle && !this.socle.termine) this.socle.update(this.tmod);
      }
      this.dessiner();
    };
    this.raf = requestAnimationFrame(boucle);
  }
  arreter() { if (this.raf) cancelAnimationFrame(this.raf); this.raf = null; }

  dessiner() {
    const ctx = this.ctx;
    // La toile porte les pixels de l'écran ; tout le tracé, lui, se fait en
    // coordonnées de SCÈNE (240 × 240) — cf. redimensionner.
    ctx.setTransform(this.pixels, 0, 0, this.pixels, 0, 0);
    ctx.clearRect(0, 0, LARGEUR, HAUTEUR);
    const s = this.socle;
    if (!s) return;

    // L'écran d'accueil (Menu.mt reconstruit) : le mouvement vient du moteur,
    // le dessin est d'ici — cf. dessinerMenu.
    if (s.estMenu) { this.dessinerMenu(ctx, s); return; }

    // GameOver.mt : l'écran de fin — le clip `gameOver` du SWF plein cadre, et
    // la pomme (sym544, quinze images) qui joue sa grimace une fois.
    if (s.ecranFin) {
      poser(ctx, 'gameOver', 1, 0, 0, 1, 1, 0, 1);
      // Les cerises, posées pour que leur CENTRE VISUEL tombe au milieu : leur
      // origine est décalée dans le dessin (boîte -34,7..48,7 × -45,7..31,3).
      poser(ctx, 'sym544', Math.floor(s.pomme), 113, 127, 1, 1, 0, 1);
      this.dessinerFondu(ctx, s);
      return;
    }

    if (s.jeu) {
      const jeu = s.jeu;
      ctx.save();
      ctx.translate(jeu.decalX || 0, jeu.decalY || 0);
      // Le décor : le clip du mini-jeu, posé au fond. Flash l'accrochait en
      // (0,0) — ses dessins couvrent la scène depuis le coin, pas depuis le
      // centre, et certains débordent (le terrain de basket monte à -391, le
      // niveau de la grenouille file à 1524 sur la droite).
      if (s.suivant) poser(ctx, s.suivant.cle, 1, 0, 0, 1, 1, 0, 1);
      for (const mc of jeu.scene.ordre()) {
        // Un Mc peut porter un DESSIN à main levée au lieu d'une pellicule —
        // le clip vide où Trampoline trace son filet (dm.empty + lineTo).
        if (mc.dessin) { if (mc.dessin.length) this.dessinerTraits(ctx, mc.dessin); continue; }
        let decoupe = mc.masque ? cheminMasque(typeof mc.masque === 'string' ? mc.masque : mc.masque.cle) : null;
        if (decoupe && typeof mc.masque === 'object') {
          const m = mc.masque;
          let M = new DOMMatrix().translate(m.x || 0, m.y || 0);
          if (m.rot) M = M.rotate(m.rot);
          M = M.scale(m.sx === undefined ? 1 : m.sx, m.sy === undefined ? 1 : m.sy);
          const place = new Path2D();
          place.addPath(decoupe, M);
          // Les enfants du masque : leurs formes s'ajoutent à la découpe,
          // posées dans le repère du masque (position, rotation et échelle
          // du parent comprises).
          for (const en of (m.enfants || [])) {
            const forme = cheminMasque(en.cle);
            if (!forme) continue;
            let M2 = M.translate(en.x || 0, en.y || 0);
            if (en.rot) M2 = M2.rotate(en.rot);
            M2 = M2.scale(en.sx === undefined ? 1 : en.sx, en.sy === undefined ? 1 : en.sy);
            place.addPath(forme, M2);
          }
          decoupe = place;
        }
        if (decoupe) {
          ctx.save();
          ctx.clip(decoupe);
          this.poserMc(ctx, mc);
          ctx.restore();
        } else {
          this.poserMc(ctx, mc);
        }
      }
      // Le VOILE BLANC d'un jeu (Mc.setPColor(this, 0xFFFFFF, p) — le flash de
      // l'appareil photo) : chaque pixel = dessin×p + blanc×(1-p). Il couvre
      // la scène du jeu, pas la barre de temps, accrochée au-dessus.
      if (jeu.blancEcran > 0) {
        ctx.globalAlpha = Math.min(1, jeu.blancEcran);
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, LARGEUR, HAUTEUR);
        ctx.globalAlpha = 1;
      }
      ctx.restore();

      // La barre de temps — mcTimerBar (sym547) tel que Base.initGameTimer la
      // pose : à gauche, à 50 % d'alpha, au-dessus de la scène (profondeur 12).
      // Sa PREMIÈRE pièce est le cadre ; la SECONDE est le remplissage, dont
      // updateGameTimer réduit `_yscale` — accroché en haut, il se vide donc
      // par le bas.
      if (s.flTimer) this.dessinerBarre(ctx, Math.max(0, Math.min(1, s.timer / s.timerMax)));
    } else {
      this.dessinerConsole(ctx, s);
    }

    this.dessinerFondu(ctx, s);
  }

  /**
   * Un Mc, avec sa teinte éventuelle. `blanchi` (0..1) est le setPColor blanc
   * des sources : sortie = dessin × (1-b) + blanc × b. La toile ne sait pas
   * teinter en posant, alors le Mc passe par un tampon — dessiné seul, blanchi
   * sur place (source-atop), reporté.
   */
  poserMc(ctx, mc) {
    if (!mc.blanchi) {
      poser(ctx, mc.cle, mc.image, mc.x, mc.y, mc.sx, mc.sy, mc.rot, mc.alpha);
      return;
    }
    // Le tampon suit la densité de la toile, sinon la teinte reviendrait
    // floue sur un écran agrandi.
    if (!this.tampon) {
      this.tampon = document.createElement('canvas');
      this.tamponCtx = this.tampon.getContext('2d');
      this.tamponPixels = 0;
    }
    if (this.tamponPixels !== this.pixels) {
      this.tampon.width = Math.max(1, Math.round(LARGEUR * this.pixels));
      this.tampon.height = Math.max(1, Math.round(HAUTEUR * this.pixels));
      this.tamponPixels = this.pixels;
    }
    const t = this.tamponCtx;
    t.setTransform(this.pixels, 0, 0, this.pixels, 0, 0);
    t.clearRect(0, 0, LARGEUR, HAUTEUR);
    poser(t, mc.cle, mc.image, mc.x, mc.y, mc.sx, mc.sy, mc.rot, mc.alpha);
    t.save();
    t.globalCompositeOperation = 'source-atop';
    t.globalAlpha = Math.min(1, mc.blanchi);
    t.fillStyle = '#fff';
    t.fillRect(0, 0, LARGEUR, HAUTEUR);
    t.restore();
    ctx.drawImage(this.tampon, 0, 0, LARGEUR, HAUTEUR);
  }

  /**
   * L'API de dessin d'AS2, rejouée : une liste de commandes posée par le jeu
   * — ['style', épaisseur, couleur, alpha%], ['fond', couleur, alpha%],
   * ['aller', x, y], ['ligne', x, y], ['courbe', cx, cy, x, y], ['fin'].
   * Comme dans le lecteur, le fond se remplit et le trait se tire par-dessus.
   */
  dessinerTraits(ctx, commandes) {
    ctx.save();
    let chemin = null, trait = null, fond = null;
    const finir = () => {
      if (!chemin) return;
      if (fond) {
        ctx.globalAlpha = fond.alpha / 100;
        ctx.fillStyle = fond.couleur;
        ctx.fill(chemin);
      }
      if (trait) {
        ctx.globalAlpha = trait.alpha / 100;
        ctx.strokeStyle = trait.couleur;
        ctx.lineWidth = trait.epaisseur;
        ctx.stroke(chemin);
      }
      chemin = null;
    };
    const teinte = (c) => '#' + (c & 0xffffff).toString(16).padStart(6, '0');
    for (const c of commandes) {
      switch (c[0]) {
        case 'style': trait = { epaisseur: c[1], couleur: teinte(c[2]), alpha: c[3] }; break;
        case 'fond': fond = { couleur: teinte(c[1]), alpha: c[2] }; break;
        case 'aller': if (!chemin) chemin = new Path2D(); chemin.moveTo(c[1], c[2]); break;
        case 'ligne': if (chemin) chemin.lineTo(c[1], c[2]); break;
        case 'courbe': if (chemin) chemin.quadraticCurveTo(c[1], c[2], c[3], c[4]); break;
        case 'fin': finir(); break;
        default: break;
      }
    }
    finir();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /*
   * L'écran d'accueil — le MOUVEMENT est celui de Menu.mt (rejoué par
   * engine.Menu) ; les dessins d'époque (menuTitle, menuBubble, mcMenuSlot)
   * n'ont survécu nulle part, alors le portage pose les siens : LES CERISES
   * du jeu (sym544, son seul personnage) en guise de titre, des bulles
   * vertes ombrées comme sp/Bubble les ordonne (ombre à +6 d'échelle, la
   * dixième et les suivantes DEVANT le titre), et des cases crème au style de
   * la console. Tout le reste — ressort du titre, sinusoïde, glissements,
   * verrous à 50 % — vient du moteur.
   */
  dessinerMenu(ctx, s) {
    const rond = (x, y, r, couleur) => {
      ctx.fillStyle = couleur;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(0, r), 0, Math.PI * 2);
      ctx.fill();
    };
    // Les ombres d'abord (profondeur 9 de la source), puis les bulles
    // d'ARRIÈRE, le titre, et les bulles de DEVANT (dm.over à la dixième).
    for (const b of s.bulles) rond(b.x + 2, b.y + 3, (b.echelle + 6) / 2, '#8fc45e');
    const bulle = (b) => {
      rond(b.x, b.y, b.echelle / 2, '#bfe98f');
      rond(b.x - b.echelle * 0.15, b.y - b.echelle * 0.15, b.echelle / 6, '#e2f6c8');
    };
    for (const b of s.bulles) if (!b.devant) bulle(b);

    const t = s.titre;
    if (t.sc > 0.5) {
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.scale(t.sc / 100, t.sc / 100);
      // Les cerises, centre visuel (7, -7.2) — cf. l'écran de fin.
      poser(ctx, 'sym544', 1, -7, -8, 0.9, 0.9, 0, 1);
      // Le nom, pendant l'INTRO seulement (titre au centre) : une fois les
      // cases en place, il passerait sous la première — les cerises seules
      // font l'écusson en haut.
      if (s.etape < 2) {
        ctx.textAlign = 'center';
        ctx.font = 'bold 26px "Trebuchet MS", sans-serif';
        ctx.lineWidth = 5;
        ctx.strokeStyle = '#ffffff';
        ctx.strokeText('MINI FEVER', 0, 52);
        ctx.fillStyle = '#d94f2b';
        ctx.fillText('MINI FEVER', 0, 52);
      }
      ctx.restore();
    }
    for (const b of s.bulles) if (b.devant) bulle(b);

    // Les cases : glissantes (mList) et escamotées (dList, échelle ×0,7).
    const carte = (c) => {
      const k = c.echelle / 100;
      if (k <= 0.01) return;
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.scale(k, k);
      if (c.verrou) ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#f0e0a0';
      ctx.strokeStyle = '#b48a4a';
      ctx.lineWidth = 2;
      const L = 150, H = 26, r = 8;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(-L / 2, -H / 2, L, H, r);
      else ctx.rect(-L / 2, -H / 2, L, H);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = c.verrou ? '#8a713f' : '#6b4a1f';
      ctx.textAlign = 'center';
      ctx.font = 'bold 13px "Trebuchet MS", sans-serif';
      ctx.fillText(String(c.nom).toUpperCase(), 0, 5);
      ctx.restore();
      ctx.globalAlpha = 1;
    };
    for (const c of s.dList) carte(c);
    for (const c of s.mList) carte(c);
  }

  dessinerBarre(ctx, c) {
    const b = manifeste && manifeste.sym547;
    if (!b) return;
    const pieces = b.etats[0].pieces;
    ctx.save();
    ctx.globalAlpha = 0.5;                       // tbar._alpha = 50
    pieces.forEach((p, i) => {
      const im = images.get(p.fichier);
      if (!im) return;
      ctx.save();
      ctx.transform(p.m[0], p.m[1], p.m[2], p.m[3], p.m[4], p.m[5]);
      if (i > 0) ctx.scale(1, c);                // tbar.b._yscale = c*100
      ctx.drawImage(im, p.o ? p.o[0] : -p.w / 2, p.o ? p.o[1] : -p.h / 2, p.w, p.h);
      ctx.restore();
    });
    ctx.restore();
  }

  /** Base.updateFade : blanc gagné, rouge perdu, sur toute la scène. */
  dessinerFondu(ctx, s) {
    const f = s.fondu;
    if (f.prc >= 100) return;
    const col = f.couleur;
    ctx.globalAlpha = 1 - f.prc / 100;
    ctx.fillStyle = 'rgb(' + ((col >> 16) & 255) + ',' + ((col >> 8) & 255) + ',' + (col & 255) + ')';
    ctx.fillRect(0, 0, LARGEUR, HAUTEUR);
    ctx.globalAlpha = 1;
  }

  /*
   * L'entre-deux-épreuves : le verdict, le niveau, les vies, la jauge de
   * difficulté et la vignette du jeu qui vient.
   *
   * Attention — c'est le SEUL écran de ce portage qui ne sorte pas du SWF. Le
   * build de développement ne contient ni `mcConsole`, ni `bgStar`, ni
   * `menuBubble` : les modes n'y étaient pas compilés, donc leurs dessins n'ont
   * pas été embarqués. On en garde la STRUCTURE — Arcade.attachConsole() : le
   * numéro de niveau au centre, les vies en bulles autour, neuf témoins de
   * difficulté, la vignette du prochain jeu qui défile pendant le tirage — sans
   * pouvoir en garder le trait.
   */
  dessinerConsole(ctx, s) {
    this.etoiles = (this.etoiles || 0) + 0.5 + (s.dif || 0) * 0.05;
    const d = this.etoiles % 60;

    ctx.fillStyle = '#101830';
    ctx.fillRect(0, 0, LARGEUR, HAUTEUR);
    // bgStar : un damier d'étoiles qui glisse en diagonale, d'autant plus vite
    // que la difficulté monte (Arcade.scrollBg).
    ctx.fillStyle = '#2a3a68';
    for (let y = -60; y < HAUTEUR + 60; y += 60) {
      for (let x = -60; x < LARGEUR + 60; x += 60) {
        ctx.fillRect(x + d, y + d, 2, 2);
        ctx.fillRect(x + d + 31, y + d + 17, 1, 1);
        ctx.fillRect(x + d + 12, y + d + 43, 1, 1);
      }
    }

    // La vignette du prochain jeu, réduite au centre haut. Pendant le tirage
    // elle saute d'un jeu à l'autre — le « toss » d'Arcade.updateVignette().
    const cat = s.catalogue || [];
    let vue = s.suivant;
    if (s.etape === 2 && cat.length) {
      const i = (cat.indexOf(s.suivant) + Math.ceil(s.toss)) % cat.length;
      vue = cat[(i + cat.length) % cat.length];
    }
    const vx = LARGEUR / 2, vy = 74, vr = 44;
    ctx.save();
    ctx.beginPath();
    ctx.rect(vx - vr, vy - vr, vr * 2, vr * 2);
    ctx.clip();
    ctx.fillStyle = '#000';
    ctx.fillRect(vx - vr, vy - vr, vr * 2, vr * 2);
    if (vue) {
      // Le PICTO de l'épreuve — le décor AVEC ses acteurs. À défaut (picto
      // pas encore chargé, ou absent), le décor nu du jeu : moins parlant,
      // mais jamais un carré noir.
      const pic = pictos.get(vue.cle);
      if (pic) {
        ctx.drawImage(pic, vx - vr, vy - vr, vr * 2, vr * 2);
      } else {
        ctx.save();
        ctx.translate(vx - vr, vy - vr);
        ctx.scale(vr * 2 / LARGEUR, vr * 2 / HAUTEUR);
        poser(ctx, vue.cle, 1, 0, 0, 1, 1, 0, 1);
        ctx.restore();
      }
    }
    ctx.restore();
    ctx.strokeStyle = '#f0e0a0';
    ctx.lineWidth = 2;
    ctx.strokeRect(vx - vr, vy - vr, vr * 2, vr * 2);

    // Le verdict de l'épreuve qu'on vient de jouer.
    ctx.textAlign = 'center';
    ctx.font = 'bold 15px "Trebuchet MS", sans-serif';
    if (s.etape === 1) {
      // s.verdict, pas s.derniere : apresFondu efface `derniere` sitôt le
      // débriefing lancé (comme flWin dans initStep(1) des sources) — le lire
      // ici affichait « raté ! » même sur une victoire.
      ctx.fillStyle = s.verdict ? '#7ce04a' : '#ff5a5a';
      ctx.fillText(s.verdict ? 'gagné !' : 'raté !', LARGEUR / 2, 24);
    } else if (vue) {
      ctx.fillStyle = '#f0e0a0';
      ctx.fillText(vue.nom, LARGEUR / 2, 24);
    }

    // Le niveau atteint, au centre.
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 34px "Trebuchet MS", sans-serif';
    ctx.fillText(String((s.niveau || 0) + 1), LARGEUR / 2, 158);
    ctx.font = '10px "Trebuchet MS", sans-serif';
    ctx.fillStyle = '#8fa0c8';
    ctx.fillText('sur ' + (s.info ? s.info.lvl : '?'), LARGEUR / 2, 172);

    // Les vies, en bulles.
    const n = Math.max(0, s.vies || 0);
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i - (n - 1) / 2) * 0.42;
      const bx = LARGEUR / 2 + Math.cos(a) * 6 + (i - (n - 1) / 2) * 17;
      const by = 200 + Math.sin(a * 2) * 2;
      const g = ctx.createRadialGradient(bx - 2, by - 3, 1, bx, by, 8);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(1, '#3aa0e0');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(bx, by, 7, 0, 6.2832);
      ctx.fill();
    }

    // Les neuf témoins de difficulté (Arcade.attachConsole : `dif*0.09 >= i`).
    for (let i = 0; i < 9; i++) {
      ctx.fillStyle = ((s.dif || 0) * 0.09 >= i) ? '#ffd040' : '#33406a';
      ctx.fillRect(72 + i * 11, 224, 8, 6);
    }
    ctx.textAlign = 'left';
  }
}

const API = { Client, charger, chargerPictos, mesures, poser, images, pictos, fichierPicto };

if (sousNode) module.exports = API;
else racine.MinifeverClient = API;

})(typeof window !== 'undefined' ? window : globalThis);
