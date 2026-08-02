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
const BASE = '/minipixiz/';
const TS = E.TS;
const IPS = 30;                       // Timer.tmod du jeu d'origine

// L'aire visible : les deux lignes d'antichambre restent hors cadre.
const LARGEUR = E.LARGEUR;            // 132
const HAUTEUR = E.HAUTEUR;            // 240
const LIGNES_CACHEES = 2;

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
const ECHELLE_PIXEL = new Set(['imp']);

// Rend un état de sprite pour une case de `taille` px, éventuellement teinté.
// `couleur` non définie = le dessin d'origine, en gris.
// Renvoie { c, dx, dy } : le canevas, et où le poser depuis le coin de la case.
function rendre(sprite, frame, taille, couleur) {
  const cle = sprite.nom + '/' + frame + '/' + taille + '/' + (couleur === undefined ? 'gris' : couleur);
  const dejaLa = teintes.get(cle);
  if (dejaLa) return dejaLa;

  const etat = sprite.etats.find((e) => e.frame === frame) || sprite.etats[0];
  const k = ECHELLE_PIXEL.has(sprite.cle) ? 1 : taille / 100;
  const zero = ANCRE_CENTRE.has(sprite.cle) ? 50 : 0;

  // Le cadre du dessin, dans le repère de la case.
  let x0 = 0, y0 = 0, x1 = 100, y1 = 100;
  if (etat && etat.pieces.length) {
    x0 = y0 = Infinity; x1 = y1 = -Infinity;
    for (const p of etat.pieces) {
      x0 = Math.min(x0, p.x + zero); y0 = Math.min(y0, p.y + zero);
      x1 = Math.max(x1, p.x + zero + p.w); y1 = Math.max(y1, p.y + zero + p.h);
    }
  }
  const dx = Math.floor(x0 * k), dy = Math.floor(y0 * k);
  const l = Math.max(1, Math.ceil(x1 * k) - dx), h = Math.max(1, Math.ceil(y1 * k) - dy);

  const c = document.createElement('canvas');
  c.width = l;
  c.height = h;
  const g = c.getContext('2d');
  if (etat) {
    for (const p of etat.pieces) {
      const img = images.get(p.fichier);
      if (!img) continue;
      g.drawImage(img, (p.x + zero) * k - dx, (p.y + zero) * k - dy, p.w * k, p.h * k);
    }
  }
  if (couleur !== undefined) {
    // Mc.setColor + modColor(1, 25) : un décalage additif, borné.
    const d = g.getImageData(0, 0, l, h);
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
    g.putImageData(d, 0, 0);
  }
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
    this.brancherCommandes(o.racine || document);
    this.redimensionner();
    window.addEventListener('resize', () => this.redimensionner());
    window.addEventListener('orientationchange', () => setTimeout(() => this.redimensionner(), 120));
  }

  nouvellePartie(opts) {
    opts = opts || {};
    eclats.length = 0;
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
    ctx.fillStyle = '#241c3a';
    ctx.fillRect(0, 0, LARGEUR, HAUTEUR);
    if (!jeu) return;

    // Le damier, pour que les colonnes se lisent.
    ctx.fillStyle = 'rgba(255,255,255,.035)';
    for (let x = 0; x < jeu.xMax; x += 2) {
      ctx.fillRect(E.MARGE_GAUCHE + x * TS, 0, TS, HAUTEUR);
    }

    for (const e of jeu.eList) this.dessinerElement(ctx, e, e.px, e.py);

    // La pièce en cours flotte entre deux cases : elle a ses propres positions.
    if (jeu.piece) {
      for (const c of jeu.piece.cases()) this.poser(ctx, c.e, c.x, c.y);
    }

    bougerEclats(ctx, tmod);
    this.dessinerInterface(ctx, tmod);
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

  dessinerInterface(ctx, tmod) {
    const jeu = this.jeu;
    ctx.font = 'bold 9px Verdana, Arial, sans-serif';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#e6dcff';
    ctx.fillText(String(jeu.score), 4, 3);

    // Les couleurs encore en jeu : c'est l'objectif du niveau, il doit se voir.
    let x = LARGEUR - 6;
    ctx.textAlign = 'right';
    for (let i = jeu.colorList.length - 1; i >= 0; i--) {
      ctx.fillStyle = enHexa(E.COULEURS[jeu.colorList[i]]);
      ctx.beginPath();
      ctx.arc(x, 7, 3, 0, 6.28);
      ctx.fill();
      x -= 9;
    }

    // La pièce suivante, en miniature.
    const suite = jeu.nextList[0];
    if (suite) {
      const k = 6;
      let xMin = 0, yMin = 0;
      for (const o of suite) { xMin = Math.min(xMin, o.x); yMin = Math.min(yMin, o.y); }
      for (const o of suite) {
        ctx.fillStyle = enHexa(E.COULEURS[o.e.type] || E.COULEURS[0]);
        ctx.fillRect(4 + (o.x - xMin) * k, 16 + (o.y - yMin) * k, k - 1, k - 1);
      }
    }

    if (this.messageT > 0 && this.message) {
      this.messageT -= tmod;
      ctx.textAlign = 'center';
      ctx.font = 'bold 10px Verdana, Arial, sans-serif';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(20,10,40,.9)';
      ctx.strokeText(this.message, LARGEUR / 2, HAUTEUR / 2 - 20);
      ctx.fillStyle = '#ffd76a';
      ctx.fillText(this.message, LARGEUR / 2, HAUTEUR / 2 - 20);
      ctx.textAlign = 'left';
    }
  }

  // L'aire est haute et étroite : on l'agrandit du facteur qui tient à l'écran,
  // entier tant que possible (les dessins font 16 px, un facteur fractionnaire
  // les rendrait flous).
  redimensionner() {
    const parent = this.canvas.parentElement || document.body;
    const dispo = Math.min(
      (parent.clientWidth || LARGEUR) / LARGEUR,
      (parent.clientHeight || HAUTEUR) / HAUTEUR);
    const entier = Math.floor(dispo);
    const k = (entier >= 1 && entier / dispo >= 0.8) ? entier : dispo;
    this.echelle = k;
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.canvas.width = LARGEUR * this.dpr;
    this.canvas.height = HAUTEUR * this.dpr;
    this.canvas.style.width = (LARGEUR * k) + 'px';
    this.canvas.style.height = (HAUTEUR * k) + 'px';
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

window.MinipixizClient = { Client, charger, rendre, poserRendu, imageJeton, images, LARGEUR, HAUTEUR, LIGNES_CACHEES };

})();
