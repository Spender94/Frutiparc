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

/** Charge le manifeste et tous ses dessins. `surAvance` suit le chargement. */
function charger(base, surAvance) {
  base = base || '/minifever/sprites/';
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
 * Les mesures dont le moteur a besoin : nombre d'images et boîte du dessin.
 * C'est elle qui tient lieu de `getBounds()` — les mini-jeux s'en servent pour
 * savoir où finit un dessin. Elle prend un manifeste en argument pour rester
 * vérifiable hors navigateur.
 */
function mesures(m) {
  const out = {};
  for (const [cle, s] of Object.entries(m || manifeste || {})) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const e = s.etats[0];
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
      nbImages: s.etats.length,
      boite: isFinite(x0) ? { x0, y0, x1, y1 } : { x0: -10, y0: -10, x1: 10, y1: 10 },
    };
  }
  return out;
}

/** Pose un dessin (une image d'un symbole) sur la toile. */
function poser(ctx, cle, image, x, y, sx, sy, rot, alpha) {
  const s = manifeste && manifeste[cle];
  if (!s) return;
  const etat = s.etats.find((e) => e.frame === image) || s.etats[0];
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
    this.brancher();
  }

  redimensionner() {
    const dispo = Math.min(this.canvas.parentElement.clientWidth || LARGEUR,
      this.canvas.parentElement.clientHeight || HAUTEUR);
    // Un agrandissement ENTIER : les dessins sont petits, un facteur
    // fractionnaire les rendrait flous.
    const k = Math.max(1, Math.floor(dispo / LARGEUR));
    this.echelle = k;
    this.canvas.width = LARGEUR;
    this.canvas.height = HAUTEUR;
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
      if (this.socle) this.socle.click();
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
    ctx.clearRect(0, 0, LARGEUR, HAUTEUR);
    const s = this.socle;
    if (!s) return;

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
      ctx.translate(0, jeu.decalY || 0);
      // Le décor : le clip du mini-jeu, posé au fond. Flash l'accrochait en
      // (0,0) — ses dessins couvrent la scène depuis le coin, pas depuis le
      // centre, et certains débordent (le terrain de basket monte à -391, le
      // niveau de la grenouille file à 1524 sur la droite).
      if (s.suivant) poser(ctx, s.suivant.cle, 1, 0, 0, 1, 1, 0, 1);
      for (const mc of jeu.scene.ordre()) {
        poser(ctx, mc.cle, mc.image, mc.x, mc.y, mc.sx, mc.sy, mc.rot, mc.alpha);
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
      ctx.save();
      ctx.translate(vx - vr, vy - vr);
      ctx.scale(vr * 2 / LARGEUR, vr * 2 / HAUTEUR);
      poser(ctx, vue.cle, 1, 0, 0, 1, 1, 0, 1);
      ctx.restore();
    }
    ctx.restore();
    ctx.strokeStyle = '#f0e0a0';
    ctx.lineWidth = 2;
    ctx.strokeRect(vx - vr, vy - vr, vr * 2, vr * 2);

    // Le verdict de l'épreuve qu'on vient de jouer.
    ctx.textAlign = 'center';
    ctx.font = 'bold 15px "Trebuchet MS", sans-serif';
    if (s.etape === 1) {
      ctx.fillStyle = s.derniere ? '#7ce04a' : '#ff5a5a';
      ctx.fillText(s.derniere ? 'gagné !' : 'raté !', LARGEUR / 2, 24);
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

const API = { Client, charger, mesures, poser, images };

if (sousNode) module.exports = API;
else racine.MinifeverClient = API;

})(typeof window !== 'undefined' ? window : globalThis);
