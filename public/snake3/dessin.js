/*
 * Frutisnake — le chargement des dessins et les aides de rendu.
 *
 * Les sprites sont les SVG extraits du SWF (sprites/sprites.json les
 * recense : clé → frames → fichier + cadre en pixels de scène 700×480).
 * Comme sur MiniPixiz : chaque frame se RASTERISE une fois par échelle
 * demandée, à k·DENSITE pixels physiques, dans un canvas hors écran mis en
 * cache — dessiner ensuite est un simple drawImage, et rien n'est flou même
 * sur écran dense (le navigateur ne re-rasterise pas un SVG déjà peint).
 *
 * S'y ajoutent deux mécaniques du jeu recopiées du SWF :
 *   · PopupFX (asml.PopupFX, décompilé du bytecode — sprite 719) : le rebond
 *     élastique des écrans et du terrier ;
 *   · Nombre (asml.NumberMC) : une rangée de clips-chiffres (policeVert 515,
 *     policePointRed 561, policePointYellow 590 — l'image n+1 porte le
 *     chiffre n), alignable au centre comme le fait Popup.as.
 */
'use strict';

(function (racine) {

const BASE = '/snake3/sprites/';

let manifeste = null;
const images = new Map();             // fichier → Image (le SVG décodé)
const rendus = new Map();             // fichier@k → { c, dx, dy, lw, lh }
let DENSITE = 1;                      // pixels physiques par pixel logique (1..4)

function chargerManifeste() {
  return fetch(BASE + 'sprites.json')
    .then((r) => r.json())
    .then((m) => { manifeste = m; return m; });
}

// Pour les tests sous Node : injecter le manifeste sans fetch ni DOM.
function poserManifeste(m) { manifeste = m; }

function image(fichier) {
  let im = images.get(fichier);
  if (!im) {
    im = new Image();
    im.src = BASE + fichier;
    images.set(fichier, im);
  }
  return im;
}

// Précharge les images d'un jeu de clés (avant d'ouvrir le jeu).
function precharger(cles) {
  const promesses = [];
  for (const cle of cles) {
    const clip = manifeste.clips[cle];
    if (!clip) continue;
    for (const f of Object.values(clip.frames)) {
      const im = image(f.fichier);
      if (!im.complete) promesses.push(new Promise((res) => { im.onload = res; im.onerror = res; }));
    }
  }
  return Promise.all(promesses);
}

function poserDensite(n) {
  const d = Math.max(1, Math.min(4, Math.ceil(n)));
  if (d !== DENSITE) { DENSITE = d; rendus.clear(); }
}

// Le cadre d'une frame (pixels de scène, x/y = coin par rapport au point
// d'ancrage du clip).
function cadre(cle, frame) {
  const clip = manifeste.clips[cle];
  const f = clip && (clip.frames[frame] || clip.frames[1]);
  return f ? f.cadre : null;
}

// La frame rasterisée à l'échelle k : canvas en pixels physiques (k·DENSITE),
// et sa géométrie LOGIQUE (dx/dy = coin, lw/lh = taille à dessiner).
function rendre(cle, frame, k) {
  const clip = manifeste.clips[cle];
  if (!clip) return null;
  const f = clip.frames[frame] || clip.frames[1];
  if (!f) return null;
  return rendreFichier(f.fichier, f.cadre, k);
}

function rendreFichier(fichier, cadre, k) {
  k = k || 1;
  const clefK = Math.max(0.05, Math.round(k * 20) / 20);
  const clef = fichier + '@' + clefK;
  let r = rendus.get(clef);
  if (r) return r;
  const im = image(fichier);
  if (!im.complete || !im.naturalWidth) return null;
  const kd = clefK * DENSITE;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(im.naturalWidth * kd));
  c.height = Math.max(1, Math.ceil(im.naturalHeight * kd));
  c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
  r = {
    c,
    dx: cadre.x,
    dy: cadre.y,
    lw: c.width / DENSITE / clefK,
    lh: c.height / DENSITE / clefK,
  };
  rendus.set(clef, r);
  return r;
}

// La frame rasterisée puis TEINTE en silhouette (Color.setRGB, ou le cxform
// de l'image « ombre ») : chaque pixel opaque prend la couleur. Le fond
// passe par un canvas intermédiaire — un source-atop sur le canvas de scène
// teinterait tout ce qui est déjà peint dessous.
function rendreTeinte(cle, frame, k, couleur) {
  const base = rendre(cle, frame, k);
  if (!base) return null;
  const clef = cle + '#' + frame + '@' + k + '/' + couleur;
  let r = rendus.get(clef);
  if (r) return r;
  const c = document.createElement('canvas');
  c.width = base.c.width;
  c.height = base.c.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(base.c, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = couleur;
  ctx.fillRect(0, 0, c.width, c.height);
  r = { c, dx: base.dx, dy: base.dy, lw: base.lw, lh: base.lh };
  rendus.set(clef, r);
  return r;
}

// La frame sous un cxform MULTIPLICATIF (les pastilles du menu : ra=p,
// ga=0,6p+0,4, ba=p) : multiplie chaque canal par le facteur, l'alpha
// d'origine étant restauré ensuite. Les facteurs sont quantifiés au 1/32
// pour borner le cache.
function rendreMultiplie(cle, frame, k, mr, mv, mb) {
  const q = (v) => Math.round(Math.max(0, Math.min(1, v)) * 32) / 32;
  mr = q(mr); mv = q(mv); mb = q(mb);
  if (mr === 1 && mv === 1 && mb === 1) return rendre(cle, frame, k);
  const base = rendre(cle, frame, k);
  if (!base) return null;
  const clef = cle + '#' + frame + '@' + k + '*' + mr + ',' + mv + ',' + mb;
  let r = rendus.get(clef);
  if (r) return r;
  const c = document.createElement('canvas');
  c.width = base.c.width;
  c.height = base.c.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(base.c, 0, 0);
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = 'rgb(' + Math.round(mr * 255) + ',' + Math.round(mv * 255) + ',' + Math.round(mb * 255) + ')';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(base.c, 0, 0);
  r = { c, dx: base.dx, dy: base.dy, lw: base.lw, lh: base.lh };
  rendus.set(clef, r);
  return r;
}

// Dessine la frame au point d'ancrage (x, y), échelle sx/sy (1 = taille du
// SWF), rotation en radians. Le contexte est déjà en repère logique.
function poser(ctx, cle, frame, x, y, sx, sy, rot, alpha) {
  const r = rendre(cle, frame, Math.max(Math.abs(sx || 1), Math.abs(sy || 1)));
  if (!r) return;
  ctx.save();
  ctx.translate(x, y);
  if (rot) ctx.rotate(rot);
  ctx.scale(sx == null ? 1 : sx, sy == null ? 1 : sy);
  if (alpha != null && alpha < 100) ctx.globalAlpha *= Math.max(0, alpha / 100);
  ctx.drawImage(r.c, r.dx, r.dy, r.lw, r.lh);
  ctx.restore();
}

// ── PopupFX — asml.PopupFX, décompilé de snake3.swf (DoInitAction 719) ────
// z part de `depart` vers `cible` à `vitesse`·tmod par image, la vitesse
// multipliée par accel^tmod ; au-delà de cible±dépassement, on plaque, le
// dépassement et la vitesse décroissent, et le sens s'inverse — jusqu'à ce
// que le dépassement passe sous `seuil` : z se verrouille sur la cible.
// Le jeu l'applique à _xscale/_yscale (écrans : 0→100 rebond ; terrier :
// 100→0 tout droit, détruit dès z < 3).
class PopupFX {
  constructor(depart, cible, depassement, vitesse, accel, decroitDep, decroitVit, seuil) {
    this.z = depart;
    this.cible = cible;
    this.depassement = depassement;
    this.vitesse = vitesse;
    this.accel = accel;
    this.decroitDep = decroitDep;
    this.decroitVit = decroitVit;
    this.seuil = seuil;
    this.monte = depart < cible;
  }

  main(tmod) {
    if (this.monte) {
      this.z += tmod * this.vitesse;
      this.vitesse *= Math.pow(this.accel, tmod);
      if (this.z > this.cible + this.depassement) {
        this.z = this.cible + this.depassement;
        this.depassement *= this.decroitDep;
        this.vitesse *= this.decroitVit;
        this.monte = !this.monte;
      }
    } else {
      this.z -= tmod * this.vitesse;
      this.vitesse *= Math.pow(this.accel, tmod);
      if (this.z < this.cible - this.depassement) {
        this.z = this.cible - this.depassement;
        this.depassement *= this.decroitDep;
        this.vitesse *= this.decroitVit;
        this.monte = !this.monte;
      }
    }
    if (this.depassement < this.seuil) {
      this.depassement = 0;
      this.z = this.cible;
      this.vitesse = 0;
    }
  }
}

// ── Nombre — asml.NumberMC, décompilé de snake3.swf (sprite 715) ──────────
// `police` est la clé du clip de chiffres ; l'image n+1 porte le chiffre n.
// setVal pose les chiffres de DROITE À GAUCHE (unités d'abord), chacun reculé
// de sa propre chasse (_width) : l'ancre du nombre est son bord DROIT — c'est
// ainsi que le score, posé à x = WIDTH−BORDER, s'étend vers la gauche.
// alignCenter recale ensuite de +largeur/2 (et le centrage vertical, que
// Popup.as demande toujours avec, remonte de la demi-hauteur du chiffre).
class Nombre {
  constructor(police) {
    this.police = police;
    this.valeur = null;
    this.chiffres = [];
    this.centre = false;
    this.largeur = 0;
    this.hauteur = 0;
  }

  poserVal(n) {
    const v = Math.floor(Math.abs(n));
    if (v === this.valeur) return;
    this.valeur = v;
    this.chiffres = [];
    const texte = String(v);
    let x = 0;
    for (let i = texte.length - 1; i >= 0; i--) {
      const d = texte.charCodeAt(i) - 48;
      const c = cadre(this.police, d + 1);
      const w = c ? c.w : 10;
      x -= w;
      this.chiffres.push({ d, x });
    }
    this.largeur = -x;
    const c0 = cadre(this.police, 1);
    this.hauteur = c0 ? c0.h : 20;
  }

  // Dessine à (x, y) — l'ancre au bord droit, ou au centre si `centre`.
  dessiner(ctx, x, y, echelle) {
    const k = echelle == null ? 1 : echelle;
    const dx = this.centre ? this.largeur / 2 : 0;
    const dy = this.centre ? -this.hauteur / 2 : 0;
    for (const c of this.chiffres) {
      poser(ctx, this.police, c.d + 1, x + (c.x + dx) * k, y + dy * k, k, k, 0);
    }
  }
}

const API = {
  chargerManifeste, poserManifeste, precharger, poserDensite, cadre, rendre, rendreFichier,
  rendreTeinte, rendreMultiplie, poser, image, PopupFX, Nombre,
  get manifeste() { return manifeste; },
  get DENSITE() { return DENSITE; },
};
if (typeof module !== 'undefined' && module.exports) module.exports = API;
else racine.SnakeDessin = API;

})(typeof window !== 'undefined' ? window : globalThis);
