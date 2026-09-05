/*
 * Kaluga — un petit LECTEUR de liste d'affichage, à la façon du lecteur Flash.
 *
 * Le jeu de 2005 n'est pas qu'une physique : ses clips VIVENT. La tzongre bat
 * des ailes (a1.a.play()), cligne des yeux, la grenouille se retourne depuis
 * une image de son propre scénario, la porte de la carte s'ouvre pendant que
 * le jeu guette son image courante, les portraits du menu bouclent sur deux
 * images jusqu'à ce qu'on leur dise de partir. Pour rejouer tout cela sans
 * le réinventer, on rejoue les SCÉNARIOS extraits du SWF (data/*.json,
 * scripts/extract-kaluga.js) : ce que Flash pose, retire, déplace, image par
 * image — et on offre aux classes portées l'API que leur code AS2 attend :
 * _x, _y, _rotation, _xscale, _alpha, attachMovie, createEmptyMovieClip,
 * gotoAndStop, play, removeMovieClip, setMask, hitTest, lineTo, beginFill…
 *
 * Ce qui est reproduit, et pourquoi :
 *
 *   · la MATRICE d'un objet est la vérité, pas ses propriétés : un placement
 *     d'auteur peut être cisaillé (les ailes du papillon), et Flash ne perd
 *     ce cisaillement que si un script touche _rotation ou _xscale — on
 *     décompose comme lui (rotation x et y séparées, échelles positives) ;
 *   · un ALLER (gotoAndStop) ne recrée pas les objets présents aux deux
 *     images : leurs sous-clips gardent leur état, comme dans le lecteur ;
 *   · les SCRIPTS D'IMAGE s'exécutent après le script courant, dans l'ordre
 *     où ils ont été programmés — un clip attaché voit son stop() de
 *     première image exécuté après la fin de la fonction qui l'a attaché ;
 *   · les MASQUES (setMask et les masques d'auteur) découpent aux surfaces ;
 *   · les TRANSFORMATIONS DE COULEUR (Color.setTransform, celles des
 *     placements d'auteur) se rendent par composition hors écran quand elles
 *     touchent aux couleurs, par simple alpha sinon ;
 *   · la CADENCE : 40 images par seconde, et l'horloge de Std (le tmod)
 *     nourrie de vrais millisecondes — c'est la vitesse d'origine.
 */
'use strict';

(function (racine) {

const K = racine.KalugaMoteur = racine.KalugaMoteur || {};

const RAD = Math.PI / 180;
// Un placement d'auteur de profondeur p est rangé par le lecteur à p − 16384 :
// tout ce qu'un script attache (profondeur ≥ 0) passe par-dessus le scénario.
const DECALAGE_SCENARIO = 16384;

// ── La bibliothèque d'un SWF extrait ──────────────────────────────────────
class Bibliotheque {
  constructor(nom, json, images) {
    this.nom = nom;
    this.entete = json.entete;
    this.perso = json.perso;
    this.symboles = json.symboles || {};
    this.fontes = json.fontes || {};
    this.imagesInfo = json.images || {};
    this.images = images || {};       // id → Image chargée
    this.nomParId = {};
    for (const [n, id] of Object.entries(this.symboles)) this.nomParId[id] = n;
  }
  idDe(nom) { return this.symboles[nom]; }
  nomDe(id) { return this.nomParId[id]; }
  definition(id) { return this.perso[id]; }
}
K.Bibliotheque = Bibliotheque;

// Object.registerClass : nom de liaison → classe portée.
K.classes = {};
K.registerClass = (nom, Classe) => { K.classes[nom] = Classe; };

// ── L'objet d'affichage ───────────────────────────────────────────────────
class Affichable {
  constructor() {
    this._parent = null;
    this._name = '';
    this.$prof = 0;
    this.$a = 1; this.$b = 0; this.$c = 0; this.$d = 1; this.$tx = 0; this.$ty = 0;
    this.$sx = 1; this.$sy = 1; this.$rx = 0; this.$ry = 0;
    this.$cx = null;                   // [mr, mg, mb, ma, ar, ag, ab, aa]
    this.$visible = true;
    this.$duScenario = false;          // posé par le scénario du parent
    this.$masqueJusqua = 0;            // masque d'auteur : jusqu'à cette profondeur
    this.$masquePar = null;            // setMask
    this.$estMasque = false;           // sert de masque (ne se dessine pas)
    this.$ratio = null;
    this.$tickNaissance = -1;
    this.$id = null;
  }

  // ── matrice ──
  poserMatrice(m) {
    this.$a = m[0]; this.$b = m[1]; this.$c = m[2]; this.$d = m[3]; this.$tx = m[4]; this.$ty = m[5];
    this.decomposer();
  }
  decomposer() {
    this.$sx = Math.hypot(this.$a, this.$b);
    this.$sy = Math.hypot(this.$c, this.$d);
    this.$rx = Math.atan2(this.$b, this.$a);
    this.$ry = Math.atan2(-this.$c, this.$d);
  }
  recomposer() {
    this.$a = this.$sx * Math.cos(this.$rx); this.$b = this.$sx * Math.sin(this.$rx);
    this.$c = -this.$sy * Math.sin(this.$ry); this.$d = this.$sy * Math.cos(this.$ry);
  }
  get _x() { return this.$tx; }
  set _x(v) { if (typeof v === 'number' && !Number.isNaN(v)) this.$tx = v; }
  get _y() { return this.$ty; }
  set _y(v) { if (typeof v === 'number' && !Number.isNaN(v)) this.$ty = v; }
  get _xscale() { return this.$sx * 100; }
  set _xscale(v) { if (typeof v !== 'number' || Number.isNaN(v)) return; this.$sx = v / 100; this.recomposer(); }
  get _yscale() { return this.$sy * 100; }
  set _yscale(v) { if (typeof v !== 'number' || Number.isNaN(v)) return; this.$sy = v / 100; this.recomposer(); }
  get _rotation() {
    let d = this.$rx / RAD;
    while (d > 180) d -= 360;
    while (d <= -180) d += 360;
    return d;
  }
  set _rotation(v) {
    if (typeof v !== 'number' || Number.isNaN(v)) return;
    const r = v * RAD;
    const dr = r - this.$rx;
    this.$rx = r; this.$ry += dr;
    this.recomposer();
  }
  get _alpha() { return this.$cx ? this.$cx[3] / 256 * 100 : 100; }
  set _alpha(v) {
    if (typeof v !== 'number' || Number.isNaN(v)) return;
    if (!this.$cx) this.$cx = [256, 256, 256, 256, 0, 0, 0, 0];
    this.$cx[3] = Math.max(0, v) / 100 * 256;
  }
  get _visible() { return this.$visible; }
  set _visible(v) { this.$visible = !!v; }
  get _width() { const c = this.cadreParent(); return c ? c[2] - c[0] : 0; }
  set _width(v) { const w = this._width; if (w > 0) this._xscale = this._xscale * v / w; }
  get _height() { const c = this.cadreParent(); return c ? c[3] - c[1] : 0; }
  set _height(v) { const h = this._height; if (h > 0) this._yscale = this._yscale * v / h; }
  get _xmouse() { return this.globalToLocal({ x: K.scene.souris.x, y: K.scene.souris.y }).x; }
  get _ymouse() { return this.globalToLocal({ x: K.scene.souris.x, y: K.scene.souris.y }).y; }
  get _root() { return K.scene ? K.scene.racine : null; }

  matriceLocale() { return [this.$a, this.$b, this.$c, this.$d, this.$tx, this.$ty]; }
  matriceGlobale() {
    let M = this.matriceLocale();
    for (let p = this._parent; p; p = p._parent) M = K.composer(p.matriceLocale(), M);
    return M;
  }

  // ── cadres ──
  cadreLocal() { return null; }       // [x0, y0, x1, y1] dans le repère de l'objet
  cadreParent() { const c = this.cadreLocal(); return c ? K.transformerCadre(c, this.matriceLocale()) : null; }
  cadreGlobal() { const c = this.cadreLocal(); return c ? K.transformerCadre(c, this.matriceGlobale()) : null; }

  localToGlobal(pt) { const p = K.appliquer(this.matriceGlobale(), pt.x, pt.y); pt.x = p.x; pt.y = p.y; return pt; }
  globalToLocal(pt) {
    const inv = K.inverser(this.matriceGlobale());
    if (!inv) return pt;
    const p = K.appliquer(inv, pt.x, pt.y); pt.x = p.x; pt.y = p.y; return pt;
  }

  // hitTest(cible) — cadres globaux ; hitTest(x, y, forme) — point global.
  hitTest(x, y, forme) {
    if (x && typeof x === 'object') {
      const a = this.cadreGlobal(), b = x.cadreGlobal();
      if (!a || !b) return false;
      return a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
    }
    const c = this.cadreGlobal();
    if (!c) return false;
    if (!(x >= c[0] && x <= c[2] && y >= c[1] && y <= c[3])) return false;
    if (!forme) return true;
    return this.contientGlobal(x, y);
  }
  contientGlobal(x, y) {
    const p = this.globalToLocal({ x, y });
    return this.contientLocal(p.x, p.y);
  }
  contientLocal() { const c = this.cadreLocal(); return !!c; }

  removeMovieClip() { if (this._parent) this._parent.retirerEnfant(this); }
  swapDepths(cible) {
    if (!this._parent) return;
    if (typeof cible === 'number') { this.$prof = cible; this._parent.trierEnfants(); return; }
    const p = this.$prof; this.$prof = cible.$prof; cible.$prof = p; this._parent.trierEnfants();
  }
  getDepth() { return this.$prof; }

  // Le chemin des surfaces, posé par M (DOMMatrix), pour les masques.
  ajouterAuMasque() {}
  dessinerDans() {}
}
K.Affichable = Affichable;

// ── Outils de matrices (SVG : a b c d e f) ────────────────────────────────
K.composer = (P, E) => [
  P[0] * E[0] + P[2] * E[1], P[1] * E[0] + P[3] * E[1],
  P[0] * E[2] + P[2] * E[3], P[1] * E[2] + P[3] * E[3],
  P[0] * E[4] + P[2] * E[5] + P[4], P[1] * E[4] + P[3] * E[5] + P[5],
];
K.appliquer = (M, x, y) => ({ x: M[0] * x + M[2] * y + M[4], y: M[1] * x + M[3] * y + M[5] });
K.inverser = (M) => {
  const [a, b, c, d, e, f] = M;
  const det = a * d - b * c;
  if (!det) return null;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
};
K.transformerCadre = (c, M) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of [[c[0], c[1]], [c[2], c[1]], [c[0], c[3]], [c[2], c[3]]]) {
    const p = K.appliquer(M, x, y);
    if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
  }
  return [x0, y0, x1, y1];
};
K.unionCadres = (a, b) => {
  if (!a) return b; if (!b) return a;
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
};
const domMatrice = (M) => new DOMMatrix(M);

// ── Une forme (DefineShape, morph cuit, texte figé) ───────────────────────
class Forme extends Affichable {
  constructor(biblio, id) {
    super();
    this.$biblio = biblio;
    this.$id = id;
    this.$def = biblio.perso[id];
  }
  dessin() {
    const def = this.$def;
    if (!def) return null;
    if (def.t === 'morph') {
      const r = this.$ratio || 0;
      let cle = def.taux.includes(r) ? r : def.taux.reduce((m, t) => (Math.abs(t - r) < Math.abs(m - r) ? t : m), def.taux[0]);
      return this.$biblio.perso[this.$id + '_' + cle] || null;
    }
    return def;
  }
  cadreLocal() {
    const d = this.dessin();
    if (!d) return null;
    return d.m ? K.transformerCadre(d.b, d.m) : d.b;
  }
  contientLocal(x, y) {
    const d = this.dessin();
    if (!d) return false;
    return K.dessinContient(K.scene.ctxMesure, d, x, y);
  }
  ajouterAuMasque(chemin, M) {
    const d = this.dessin();
    if (d) K.ajouterAuMasque(chemin, d, M.multiply(domMatrice(this.matriceLocale())));
  }
  dessinerDans(ctx, alpha) {
    if (!this.$visible || this.$estMasque) return;
    const d = this.dessin();
    if (!d) return;
    K.scene.dessinerObjet(ctx, this, alpha, (ctx2, a) => {
      ctx2.globalAlpha = a;
      K.dessinerDessin(ctx2, d, this.$biblio.images, a);
    });
  }
}
K.Forme = Forme;

// ── Le dessin par script (lineStyle, moveTo, lineTo, curveTo, beginFill…) ──
class Trace {
  constructor() { this.clear(); }
  clear() {
    this.ops = [];            // { f, d } | { s, d }
    this.style = null;        // trait courant
    this.rempl = null;        // remplissage courant
    this.dTrait = ''; this.dRempl = '';
    this.x = 0; this.y = 0;
    this.cadre = null;
    this.compile = null;
  }
  point(x, y) {
    if (!this.cadre) this.cadre = [x, y, x, y];
    else { if (x < this.cadre[0]) this.cadre[0] = x; if (x > this.cadre[2]) this.cadre[2] = x; if (y < this.cadre[1]) this.cadre[1] = y; if (y > this.cadre[3]) this.cadre[3] = y; }
  }
  finirTrait() { if (this.style && this.dTrait) this.ops.push({ s: this.style, d: this.dTrait }); this.dTrait = ''; this.compile = null; }
  lineStyle(w, rgb, alpha) {
    this.finirTrait();
    if (w === undefined) { this.style = null; return; }
    this.style = { w: w || 0, c: K.hex(rgb === undefined ? 0 : rgb), a: alpha === undefined ? 1 : alpha / 100 };
    this.dTrait = `M${this.x} ${this.y}`;
  }
  moveTo(x, y) {
    this.x = x; this.y = y;
    if (this.style) { this.finirTrait(); this.dTrait = `M${x} ${y}`; }
    if (this.rempl) this.dRempl += `M${x} ${y}`;
    this.point(x, y);
  }
  lineTo(x, y) {
    if (this.style) { if (!this.dTrait) this.dTrait = `M${this.x} ${this.y}`; this.dTrait += `L${x} ${y}`; }
    if (this.rempl) { if (!this.dRempl) this.dRempl = `M${this.x} ${this.y}`; this.dRempl += `L${x} ${y}`; }
    this.x = x; this.y = y; this.point(x, y); this.compile = null;
  }
  curveTo(cx, cy, x, y) {
    if (this.style) { if (!this.dTrait) this.dTrait = `M${this.x} ${this.y}`; this.dTrait += `Q${cx} ${cy} ${x} ${y}`; }
    if (this.rempl) { if (!this.dRempl) this.dRempl = `M${this.x} ${this.y}`; this.dRempl += `Q${cx} ${cy} ${x} ${y}`; }
    this.x = x; this.y = y; this.point(x, y); this.point(cx, cy); this.compile = null;
  }
  beginFill(rgb, alpha) {
    this.endFill();
    this.rempl = { c: K.hex(rgb === undefined ? 0 : rgb), a: alpha === undefined ? 1 : alpha / 100 };
    this.dRempl = `M${this.x} ${this.y}`;
  }
  endFill() {
    if (this.rempl && this.dRempl) this.ops.push({ f: this.rempl, d: this.dRempl + 'Z' });
    this.rempl = null; this.dRempl = ''; this.compile = null;
  }
  dessin() {
    // Un dessin au format de swf-formes, traits en cours compris.
    const ops = this.ops.slice();
    if (this.rempl && this.dRempl) ops.push({ f: this.rempl, d: this.dRempl + 'Z' });
    if (this.style && this.dTrait && this.dTrait.length > 12) ops.push({ s: this.style, d: this.dTrait });
    if (!ops.length) return null;
    if (!this.compile || this.compile.n !== ops.length) this.compile = { n: ops.length, b: this.cadre || [0, 0, 0, 0], ops };
    return this.compile;
  }
}
K.hex = (rgb) => '#' + ((rgb >>> 0) & 0xffffff).toString(16).padStart(6, '0');

// ── Le clip (MovieClip) ───────────────────────────────────────────────────
class Clip extends Affichable {
  constructor(biblio, id) {
    super();
    this.$biblio = biblio;
    this.$id = (id === undefined) ? null : id;
    this.$def = (this.$id !== null && biblio) ? biblio.perso[this.$id] : null;
    if (this.$def && this.$def.t !== 'clip') this.$def = null;
    this.$enfants = [];
    this.$frame = 0;
    this.$joue = true;
    this.$trace = null;
    this.$etiquettes = null;
  }

  // ── scénario ──
  get _currentframe() { return this.$frame || 1; }
  get _totalframes() { return this.$def ? this.$def.n : 1; }

  initialiserScenario() {
    if (!this.$def) { this.$frame = 1; return; }
    this.aller(1, true, true);
  }
  numeroImage(f) {
    if (typeof f === 'string') {
      if (!this.$etiquettes) {
        this.$etiquettes = {};
        if (this.$def) this.$def.frames.forEach((fr, i) => { if (fr.lab) this.$etiquettes[fr.lab] = i + 1; });
      }
      const n = this.$etiquettes[f];
      if (n === undefined) { const v = Number(f); return Number.isNaN(v) ? null : v; }
      return n;
    }
    return f;
  }
  play() { this.$joue = true; }
  stop() { this.$joue = false; }
  gotoAndStop(f) { const n = this.numeroImage(f); if (n !== null) this.aller(n, false); }
  gotoAndPlay(f) { const n = this.numeroImage(f); if (n !== null) this.aller(n, true); }
  nextFrame() { this.aller(this._currentframe + 1, false); }
  prevFrame() { this.aller(this._currentframe - 1, false); }

  // Va à l'image f. Si c'est l'image courante, ne change que l'état de lecture.
  aller(f, joue, force) {
    if (typeof f !== 'number' || Number.isNaN(f)) return;   // gotoAndPlay(undefined) : le lecteur ne bouge pas
    this.$joue = joue;
    if (!this.$def) { this.$frame = 1; return; }
    const n = this.$def.n;
    f = Math.max(1, Math.min(n, Math.floor(f)));
    if (f === this.$frame && !force) return;
    const etat = this.instantane(f);
    this.$frame = f;
    // 1. les enfants du scénario que l'image cible ne connaît pas, ou remplace
    for (const e of this.$enfants.slice()) {
      if (!e.$duScenario) continue;
      const s = etat.get(e.$prof);
      if (!s || s.c !== e.$id) this.retirerEnfant(e);
    }
    // 2. ceux qu'elle pose ou reprend
    for (const [prof, s] of etat) {
      let e = this.parProf(prof);
      if (e && e.$duScenario && e.$id === s.c) { this.appliquerEtat(e, s); continue; }
      if (e) this.retirerEnfant(e);
      e = this.creerDuScenario(s.c, prof);
      this.appliquerEtat(e, s);
      K.finaliser(e, null);
    }
    this.programmerScript(f);
  }

  // L'état de la liste d'affichage à l'image f : rejeu des placements 1..f.
  instantane(f) {
    const etat = new Map();
    for (let i = 0; i < f; i++) {
      for (const op of this.$def.frames[i].ops) {
        if (op.x !== undefined) { etat.delete(op.x - DECALAGE_SCENARIO); continue; }
        const avant = etat.get(op.p - DECALAGE_SCENARIO);
        if (op.c !== undefined && !(op.mv && avant)) {
          etat.set(op.p - DECALAGE_SCENARIO, { c: op.c, m: op.m || null, cx: op.cx || null, r: op.r, n: op.n, k: op.k ? op.k - DECALAGE_SCENARIO : 0 });
          continue;
        }
        if (!avant) continue;
        if (op.c !== undefined) avant.c = op.c;
        if (op.m) avant.m = op.m;
        if (op.cx !== undefined) avant.cx = op.cx;
        if (op.r !== undefined) avant.r = op.r;
        if (op.n) avant.n = op.n;
        if (op.k) avant.k = op.k - DECALAGE_SCENARIO;
      }
    }
    return etat;
  }
  appliquerEtat(e, s) {
    if (s.m) e.poserMatrice(s.m);
    e.$cx = s.cx ? s.cx.slice() : null;
    if (s.r !== undefined) e.$ratio = s.r;
    if (s.n && e._name !== s.n) { if (e._name && this[e._name] === e) delete this[e._name]; e._name = s.n; this[s.n] = e; }
    e.$masqueJusqua = s.k || 0;
  }
  creerDuScenario(c, prof) {
    const e = K.instancier(this.$biblio, c);
    e.$duScenario = true;
    e.$prof = prof;
    e.$tickNaissance = K.scene ? K.scene.numeroTick : -1;
    this.insererEnfant(e);
    return e;
  }

  // Une image de plus (appelé par la scène à chaque tick, pour les clips qui jouent).
  avancer() {
    if (!this.$def || this.$def.n < 2) return;
    let f = this.$frame + 1;
    if (f > this.$def.n) { this.aller(1, true, true); return; }
    this.$frame = f;
    this.appliquerOps(this.$def.frames[f - 1].ops);
    this.programmerScript(f);
  }
  appliquerOps(ops) {
    for (const op of ops) {
      if (op.x !== undefined) { const e = this.parProf(op.x - DECALAGE_SCENARIO); if (e) this.retirerEnfant(e); continue; }
      const e = this.parProf(op.p - DECALAGE_SCENARIO);
      if (op.c !== undefined && !(e && e.$duScenario && e.$id === op.c && op.mv)) {
        // Un nouveau caractère : il remplace ce qui occupait la profondeur ;
        // avec le drapeau « déplacement », il hérite de ce qu'il ne redit pas.
        const neuf = this.creerDuScenario(op.c, op.p - DECALAGE_SCENARIO);
        if (e && op.mv) {
          if (!op.m) neuf.poserMatrice(e.matriceLocale());
          if (op.cx === undefined) neuf.$cx = e.$cx ? e.$cx.slice() : null;
          if (!op.n && e._name) op = Object.assign({}, op, { n: e._name });
          if (!op.k) neuf.$masqueJusqua = e.$masqueJusqua;
        }
        if (e) this.retirerEnfant(e);
        this.appliquerOp(neuf, op);
        K.finaliser(neuf, null);
        continue;
      }
      if (e) this.appliquerOp(e, op);
    }
  }
  appliquerOp(e, op) {
    if (op.m) e.poserMatrice(op.m);
    if (op.cx !== undefined) e.$cx = op.cx ? op.cx.slice() : null;
    if (op.r !== undefined) e.$ratio = op.r;
    if (op.n && e._name !== op.n) { if (e._name && this[e._name] === e) delete this[e._name]; e._name = op.n; this[op.n] = e; }
    if (op.k) e.$masqueJusqua = op.k - DECALAGE_SCENARIO;
  }
  programmerScript(f) {
    const a = this.$def && this.$def.frames[f - 1] && this.$def.frames[f - 1].a;
    if (a && K.scene) K.scene.programmerScript(this, a);
  }

  // ── enfants ──
  parProf(p) { for (const e of this.$enfants) if (e.$prof === p) return e; return null; }
  insererEnfant(e) {
    e._parent = this;
    this.$enfants.push(e);
    this.trierEnfants();
  }
  trierEnfants() { this.$enfants.sort((x, y) => x.$prof - y.$prof); }
  retirerEnfant(e) {
    const i = this.$enfants.indexOf(e);
    if (i >= 0) this.$enfants.splice(i, 1);
    if (e._name && this[e._name] === e) delete this[e._name];
    e._parent = null;
    if (K.scene) K.scene.objetRetire(e);
  }
  nommer(e, nom) {
    if (e._name && this[e._name] === e) delete this[e._name];
    e._name = nom;
    this[nom] = e;
  }

  attachMovie(lien, nom, prof, init) {
    const id = this.$biblio.idDe(lien);
    if (id === undefined) { console.warn('[kaluga] attachMovie : lien inconnu', lien); return undefined; }
    const e = K.instancier(this.$biblio, id);
    e.$prof = prof;
    e.$tickNaissance = K.scene ? K.scene.numeroTick : -1;
    const avant = this.parProf(prof);
    if (avant) this.retirerEnfant(avant);
    this.insererEnfant(e);
    this.nommer(e, nom);
    K.finaliser(e, init);
    return e;
  }
  createEmptyMovieClip(nom, prof) {
    const e = new Clip(this.$biblio, null);
    e.$prof = prof;
    e.$tickNaissance = K.scene ? K.scene.numeroTick : -1;
    const avant = this.parProf(prof);
    if (avant) this.retirerEnfant(avant);
    this.insererEnfant(e);
    this.nommer(e, nom);
    e.$frame = 1;
    return e;
  }
  createTextField(nom, prof, x, y, l, h) {
    const e = new K.Texte(this.$biblio, null);
    e.$rect = [0, 0, l, h];
    e.$tx = x; e.$ty = y;
    e.$prof = prof;
    const avant = this.parProf(prof);
    if (avant) this.retirerEnfant(avant);
    this.insererEnfant(e);
    this.nommer(e, nom);
    return e;
  }
  setMask(mc) {
    if (this.$masquePar) this.$masquePar.$estMasque = false;
    this.$masquePar = mc || null;
    if (mc) mc.$estMasque = true;
  }

  // ── dessin par script ──
  laTrace() { if (!this.$trace) this.$trace = new Trace(); return this.$trace; }
  lineStyle(w, rgb, a) { this.laTrace().lineStyle(w, rgb, a); }
  moveTo(x, y) { this.laTrace().moveTo(x, y); }
  lineTo(x, y) { this.laTrace().lineTo(x, y); }
  curveTo(cx, cy, x, y) { this.laTrace().curveTo(cx, cy, x, y); }
  beginFill(rgb, a) { this.laTrace().beginFill(rgb, a); }
  endFill() { this.laTrace().endFill(); }
  clear() { if (this.$trace) this.$trace.clear(); }

  // ── cadres ──
  cadreLocal() {
    let c = null;
    if (this.$trace && this.$trace.cadre) c = this.$trace.cadre.slice();
    for (const e of this.$enfants) {
      if (!e.$visible || e.$estMasque || e.$masqueJusqua) continue;
      c = K.unionCadres(c, e.cadreParent());
    }
    return c;
  }
  contientLocal(x, y) {
    if (this.$trace && this.$trace.dessin() && K.dessinContient(K.scene.ctxMesure, this.$trace.dessin(), x, y)) return true;
    for (const e of this.$enfants) {
      if (!e.$visible || e.$estMasque || e.$masqueJusqua) continue;
      const inv = K.inverser(e.matriceLocale());
      if (!inv) continue;
      const p = K.appliquer(inv, x, y);
      if (e.contientLocal(p.x, p.y)) return true;
    }
    return false;
  }
  ajouterAuMasque(chemin, M) {
    const Ml = M.multiply(domMatrice(this.matriceLocale()));
    if (this.$trace) { const d = this.$trace.dessin(); if (d) K.ajouterAuMasque(chemin, d, Ml); }
    for (const e of this.$enfants) if (e.$visible) e.ajouterAuMasque(chemin, Ml);
  }

  // ── rendu ──
  dessinerDans(ctx, alpha) {
    if (!this.$visible || this.$estMasque) return;
    K.scene.dessinerObjet(ctx, this, alpha, (ctx2, a) => this.dessinerContenu(ctx2, a));
  }
  dessinerContenu(ctx, a) {
    if (this.$trace) {
      const d = this.$trace.dessin();
      if (d) { ctx.globalAlpha = a; K.dessinerDessin(ctx, d, null, a); }
    }
    let finMasque = -1;
    for (const e of this.$enfants) {
      if (finMasque >= 0 && e.$prof > finMasque) { ctx.restore(); finMasque = -1; }
      if (e.$masqueJusqua) {
        ctx.save();
        const chemin = new Path2D();
        e.ajouterAuMasque(chemin, new DOMMatrix());
        ctx.clip(chemin, 'nonzero');
        finMasque = e.$masqueJusqua;
        continue;
      }
      e.dessinerDans(ctx, a);
    }
    if (finMasque >= 0) ctx.restore();
  }
}
K.Clip = Clip;

// ── Le bouton (DefineButton2) ─────────────────────────────────────────────
// Les états : 1 = repos, 2 = survol, 4 = enfoncé, 8 = zone active.
class Bouton extends Affichable {
  constructor(biblio, id) {
    super();
    this.$biblio = biblio;
    this.$id = id;
    this.$def = biblio.perso[id];
    this.$etat = 1;
    this.enabled = true;
    this.useHandCursor = true;
    this.$pieces = (this.$def.rec || []).map((r) => {
      const e = K.instancier(biblio, r.c);
      e.poserMatrice(r.m);
      if (r.cx) e.$cx = r.cx.slice();
      e._parent = this;
      e.$prof = r.p;
      K.finaliser(e, null);
      return { e, etats: r.e };
    });
    this.$pieces.sort((x, y) => x.e.$prof - y.e.$prof);
  }
  get enfants() { return this.$pieces.map((p) => p.e); }
  cadreLocal() {
    let c = null;
    for (const p of this.$pieces) if (p.etats & 1) c = K.unionCadres(c, p.e.cadreParent());
    if (!c) for (const p of this.$pieces) c = K.unionCadres(c, p.e.cadreParent());
    return c;
  }
  // La zone active : les pièces « hit » (à défaut, celles du repos).
  contientLocal(x, y) {
    let zones = this.$pieces.filter((p) => p.etats & 8);
    if (!zones.length) zones = this.$pieces.filter((p) => p.etats & 1);
    for (const p of zones) {
      const inv = K.inverser(p.e.matriceLocale());
      if (!inv) continue;
      const q = K.appliquer(inv, x, y);
      if (p.e.contientLocal(q.x, q.y)) return true;
    }
    return false;
  }
  ajouterAuMasque(chemin, M) {
    const Ml = M.multiply(domMatrice(this.matriceLocale()));
    for (const p of this.$pieces) if (p.etats & 1) p.e.ajouterAuMasque(chemin, Ml);
  }
  dessinerDans(ctx, alpha) {
    if (!this.$visible || this.$estMasque) return;
    K.scene.dessinerObjet(ctx, this, alpha, (ctx2, a) => {
      for (const p of this.$pieces) if (p.etats & this.$etat) p.e.dessinerDans(ctx2, a);
    });
  }
  // Les gestionnaires : ceux du script d'auteur (scripts-images), puis ceux posés par le code.
  declencher(nom) {
    const s = this.$def.a && K.scriptsBoutons && K.scriptsBoutons[this.$def.a];
    if (s && s[nom]) s[nom].call(this._parent, this);
    if (typeof this['on' + nom[0].toUpperCase() + nom.slice(1)] === 'function') this['on' + nom[0].toUpperCase() + nom.slice(1)]();
  }
}
K.Bouton = Bouton;

// ── Instanciation d'un caractère ──────────────────────────────────────────
K.instancier = (biblio, id) => {
  const def = biblio.perso[id];
  if (!def) return new Clip(biblio, null);
  switch (def.t) {
    case 'forme': case 'morph': return new Forme(biblio, id);
    case 'texte': return new K.Texte(biblio, id);
    case 'bouton': return new Bouton(biblio, id);
    case 'clip': {
      const nom = biblio.nomDe(id);
      const Classe = (nom && K.classes[nom]) || Clip;
      return new Classe(biblio, id);
    }
    default: return new Clip(biblio, null);
  }
};

// Ce que fait le lecteur après avoir posé un objet : copier l'objet d'initialisation,
// afficher la première image, puis appeler le constructeur de la classe.
K.finaliser = (e, init) => {
  // L'objet d'initialisation peut être un AUTRE CLIP (la pomme attachée au
  // panier, la tzongre collée à une pomme) : on copie ses propriétés de jeu,
  // jamais l'état du moteur ($…), ni la parenté (_parent, _name), ni les
  // méthodes de sa classe.
  if (init) {
    for (const k of Object.keys(init)) {
      if (k[0] === '$' || k === '_parent' || k === '_name') continue;
      const v = init[k];
      if (typeof v === 'function') continue;
      e[k] = v;
    }
  }
  if (e instanceof Clip) e.initialiserScenario();
  if (typeof e.constructeur === 'function') e.constructeur();
  // Hors d'un script (un chargement de carte, un intervalle, un clic), le
  // lecteur exécute les actions de première image avant l'image suivante :
  // on vide la file tout de suite, sinon un stop() arriverait après l'avance.
  if (K.scene && !K.scene.dansScript) K.scene.viderScripts();
};

// ── L'horloge et Std (le tmod de Motion-Twin) ─────────────────────────────
// Std.update() : deltaT en secondes depuis l'image précédente ; tmod lissé
// (0,95 / 0,05) vers deltaT × wantedFPS ; au-delà de maxDeltaTime, deltaT
// retombe à une image et tmod ne bouge pas (le retour d'un onglet caché).
// wantedFPS vaut 32 : l'appel initTimer(40) du script d'amorçage ne trouve
// aucune fonction de ce nom — c'est ainsi que le jeu tournait.
K.getTimer = () => (K.scene ? K.scene.horloge : 0);
class Std_ {
  constructor() { this.reset(); }
  reset() {
    this.wantedFPS = 32; this.tmod = 1; this.deltaT = 1; this.maxDeltaTime = 0.5; this.tmod_factor = 0.95;
    this.oldTime = K.getTimer(); this.init_flag = false; this.frameCount = 0;
  }
  init(fps) { this.init_flag = true; this.wantedFPS = fps; }
  update() {
    if (!this.init_flag) this.init(this.wantedFPS);
    this.frameCount++;
    const t = K.getTimer();
    this.deltaT = (t - this.oldTime) / 1000;
    this.oldTime = t;
    if (this.deltaT < this.maxDeltaTime) {
      this.tmod = this.tmod * this.tmod_factor + (1 - this.tmod_factor) * this.deltaT * this.wantedFPS;
    } else {
      this.deltaT = 1 / this.wantedFPS;
    }
  }
  cast(x) { return x; }
}
K.Std = new Std_();

// setInterval(obj, "methode", ms, args…) — la forme AS2.
K.setInterval = (obj, methode, ms, ...args) => racine.setInterval(() => {
  const f = typeof methode === 'function' ? methode : obj[methode];
  if (typeof f === 'function') f.apply(obj, args);
  if (K.scene) K.scene.viderScripts();
}, ms);
K.clearInterval = (id) => racine.clearInterval(id);

// ── Le clavier (Key) ──────────────────────────────────────────────────────
K.Key = {
  UP: 38, DOWN: 40, LEFT: 37, RIGHT: 39, SPACE: 32, ENTER: 13, SHIFT: 16, ESCAPE: 27, CONTROL: 17, TAB: 9, BACKSPACE: 8, DELETEKEY: 46,
  enfoncees: {},
  dernier: 0,
  auditeurs: [],
  isDown(code) { return !!this.enfoncees[code]; },
  getCode() { return this.dernier; },
  addListener(o) { if (!this.auditeurs.includes(o)) this.auditeurs.push(o); },
  removeListener(o) { const i = this.auditeurs.indexOf(o); if (i >= 0) this.auditeurs.splice(i, 1); },
  presser(code) {
    const deja = this.enfoncees[code];
    this.enfoncees[code] = true; this.dernier = code;
    if (!deja) for (const a of this.auditeurs.slice()) if (typeof a.onKeyDown === 'function') a.onKeyDown();
    if (K.scene) K.scene.viderScripts();
  },
  relacher(code) {
    if (!this.enfoncees[code]) return;
    delete this.enfoncees[code]; this.dernier = code;
    for (const a of this.auditeurs.slice()) if (typeof a.onKeyUp === 'function') a.onKeyUp();
    if (K.scene) K.scene.viderScripts();
  },
  toutRelacher() { for (const c of Object.keys(this.enfoncees)) this.relacher(+c); },
};

// ── La couleur (Color) ────────────────────────────────────────────────────
class Color {
  constructor(mc) { this.mc = mc; }
  setTransform(t) {
    const cx = this.mc.$cx || [256, 256, 256, 256, 0, 0, 0, 0];
    const v = (x, def) => (x === undefined ? def : x);
    this.mc.$cx = [v(t.ra, 100) * 2.56, v(t.ga, 100) * 2.56, v(t.ba, 100) * 2.56, v(t.aa, cx[3] / 2.56) * 2.56,
      v(t.rb, 0), v(t.gb, 0), v(t.bb, 0), v(t.ab, 0)];
  }
  getTransform() {
    const cx = this.mc.$cx || [256, 256, 256, 256, 0, 0, 0, 0];
    return { ra: cx[0] / 2.56, ga: cx[1] / 2.56, ba: cx[2] / 2.56, aa: cx[3] / 2.56, rb: cx[4], gb: cx[5], bb: cx[6], ab: cx[7] };
  }
  setRGB(rgb) {
    const cx = this.mc.$cx || [256, 256, 256, 256, 0, 0, 0, 0];
    this.mc.$cx = [0, 0, 0, cx[3], (rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255, 0];
  }
  getRGB() { const cx = this.mc.$cx; return cx ? ((cx[4] & 255) << 16) | ((cx[5] & 255) << 8) | (cx[6] & 255) : 0; }
}
K.Color = Color;

// ── La scène ──────────────────────────────────────────────────────────────
class Scene {
  constructor(canvas, biblio, options) {
    K.scene = this;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.$biblio = biblio;
    this.largeur = biblio.entete.l; this.hauteur = biblio.entete.h;
    this.fond = biblio.entete.fond || '#ffffff';
    this.periode = 1000 / (options && options.cadence || biblio.entete.cadence || 40);
    this.racine = new Clip(biblio, null);
    this.racine.$frame = 1;
    this.racine.test = '';
    this.fileScripts = [];
    this.numeroTick = 0;
    this.horloge = 0;                 // ms virtuelles : getTimer()
    this.accumule = 0;
    this.tPrecedent = null;
    this.actif = false;
    this.surTick = options && options.surTick || null;
    this.souris = { x: -1000, y: -1000, enfonce: false };
    this.sousSouris = null;
    this.appuye = null;
    this.tampons = [];
    this.niveauTeinte = 0;
    this.echelleCanvas = 1;
    const mesure = document.createElement('canvas');
    mesure.width = 4; mesure.height = 4;
    this.ctxMesure = mesure.getContext('2d');
    this.installerEntrees();
    K.Std.reset();
  }

  // ── boucle ──
  demarrer() {
    if (this.actif) return;
    this.actif = true;
    this.tPrecedent = null;
    const boucle = (t) => {
      if (!this.actif) return;
      if (this.tPrecedent === null) { this.tPrecedent = t; }
      this.accumule += Math.min(t - this.tPrecedent, 500);
      this.tPrecedent = t;
      let n = 0;
      while (this.accumule >= this.periode && n < 3) {
        this.accumule -= this.periode;
        this.horloge += this.periode;
        this.tick();
        n++;
      }
      if (this.accumule >= this.periode) {
        // En retard : on saute, comme le lecteur saute des images — le temps passe.
        const saut = Math.floor(this.accumule / this.periode) * this.periode;
        this.accumule -= saut;
        this.horloge += saut;
      }
      if (n) this.rendre();
      this.rafId = requestAnimationFrame(boucle);
    };
    this.rafId = requestAnimationFrame(boucle);
  }
  arreter() { this.actif = false; if (this.rafId) cancelAnimationFrame(this.rafId); K.Key.toutRelacher(); }

  tick() {
    this.numeroTick++;
    this.avancerTous(this.racine);
    if (this.surTick) this.fileScripts.unshift([this.racine, this.surTick]);
    this.viderScripts();
  }
  avancerTous(clip) {
    // Les enfants nés à ce tick (attachés par un script, posés par une
    // image) affichent leur première image et n'avancent qu'au suivant.
    for (const e of clip.$enfants.slice()) {
      if (!(e instanceof Clip) || e._parent !== clip) continue;
      if (e.$tickNaissance === this.numeroTick) continue;
      if (e.$joue) e.avancer();
      if (e._parent === clip) this.avancerTous(e);
    }
  }
  programmerScript(clip, cle) {
    const f = typeof cle === 'function' ? cle : (K.scriptsImages && K.scriptsImages[cle]);
    if (!f) { if (typeof cle === 'string' && !(K.scriptsInconnus || (K.scriptsInconnus = {}))[cle]) { K.scriptsInconnus[cle] = true; console.warn('[kaluga] script d\'image non porté :', cle); } return; }
    this.fileScripts.push([clip, f]);
  }
  viderScripts() {
    if (this.dansScript) return;
    this.dansScript = true;
    let garde = 0;
    try {
      while (this.fileScripts.length && garde++ < 10000) {
        const [clip, f] = this.fileScripts.shift();
        if (clip !== this.racine && !clip._parent) continue;   // retiré entre-temps
        try { f.call(clip, clip); } catch (e) { console.error('[kaluga] script', e); }
      }
    } finally { this.dansScript = false; }
  }
  objetRetire(e) {
    if (this.sousSouris === e) this.sousSouris = null;
    if (this.appuye === e) this.appuye = null;
  }

  // ── rendu ──
  rendre() {
    const ctx = this.ctx;
    const s = this.echelleCanvas;
    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = this.fond;
    ctx.fillRect(0, 0, this.largeur, this.hauteur);
    this.base = ctx.getTransform();
    this.racine.dessinerDans(ctx, 1);
  }
  tampon(niveau) {
    let t = this.tampons[niveau];
    if (!t) {
      const c = document.createElement('canvas');
      t = { canvas: c, ctx: c.getContext('2d') };
      this.tampons[niveau] = t;
    }
    if (t.canvas.width !== this.canvas.width || t.canvas.height !== this.canvas.height) {
      t.canvas.width = this.canvas.width; t.canvas.height = this.canvas.height;
    }
    return t;
  }
  // Dessine un objet : matrice, masque, transformation de couleur, puis son contenu.
  dessinerObjet(ctx, obj, alpha, contenu) {
    const cx = obj.$cx;
    const a = alpha * (cx ? Math.max(0, Math.min(1, cx[3] / 256)) : 1);
    if (a <= 0.001) return;
    const teinte = cx && (cx[0] !== 256 || cx[1] !== 256 || cx[2] !== 256 || cx[4] || cx[5] || cx[6]);
    if (teinte && !obj.$sansTeinte) { this.dessinerTeinte(ctx, obj, alpha, contenu); return; }
    ctx.save();
    ctx.transform(obj.$a, obj.$b, obj.$c, obj.$d, obj.$tx, obj.$ty);
    if (obj.$masquePar) {
      const T = ctx.getTransform();
      const chemin = new Path2D();
      obj.$masquePar.ajouterAuMasque(chemin, new DOMMatrix());
      const Mm = obj.$masquePar._parent ? obj.$masquePar._parent.matriceGlobale() : [1, 0, 0, 1, 0, 0];
      const global = new Path2D();
      global.addPath(chemin, domMatrice(Mm));
      ctx.setTransform(this.base);
      ctx.clip(global, 'nonzero');
      ctx.setTransform(T);
    }
    contenu(ctx, a);
    ctx.restore();
  }
  // Composition hors écran pour une transformation de couleur (mult + add).
  dessinerTeinte(ctx, obj, alpha, contenu) {
    const niveau = this.niveauTeinte++;
    const t1 = this.tampon(niveau * 2), t2 = this.tampon(niveau * 2 + 1);
    const T = ctx.getTransform();
    const W = t1.canvas.width, H = t1.canvas.height;
    t1.ctx.setTransform(1, 0, 0, 1, 0, 0);
    t1.ctx.clearRect(0, 0, W, H);
    t1.ctx.setTransform(T);
    obj.$sansTeinte = true;
    const cx = obj.$cx;
    const alphaObj = cx[3];
    cx[3] = 256;
    try { this.dessinerObjet(t1.ctx, obj, 1, contenu); } finally { obj.$sansTeinte = false; cx[3] = alphaObj; }
    this.niveauTeinte--;
    const c2 = t2.ctx;
    c2.setTransform(1, 0, 0, 1, 0, 0);
    c2.globalAlpha = 1;
    c2.globalCompositeOperation = 'source-over';
    c2.clearRect(0, 0, W, H);
    c2.drawImage(t1.canvas, 0, 0);
    if (cx[0] !== 256 || cx[1] !== 256 || cx[2] !== 256) {
      c2.globalCompositeOperation = 'multiply';
      c2.fillStyle = `rgb(${Math.round(Math.max(0, Math.min(256, cx[0])) / 256 * 255)},${Math.round(Math.max(0, Math.min(256, cx[1])) / 256 * 255)},${Math.round(Math.max(0, Math.min(256, cx[2])) / 256 * 255)})`;
      c2.fillRect(0, 0, W, H);
      c2.globalCompositeOperation = 'destination-in';
      c2.drawImage(t1.canvas, 0, 0);
    }
    if (cx[4] || cx[5] || cx[6]) {
      c2.globalCompositeOperation = 'lighter';
      c2.fillStyle = `rgb(${Math.max(0, Math.min(255, Math.round(cx[4])))},${Math.max(0, Math.min(255, Math.round(cx[5])))},${Math.max(0, Math.min(255, Math.round(cx[6])))})`;
      c2.fillRect(0, 0, W, H);
      c2.globalCompositeOperation = 'destination-in';
      c2.drawImage(t1.canvas, 0, 0);
    }
    c2.globalCompositeOperation = 'source-over';
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = alpha * Math.max(0, Math.min(1, alphaObj / 256));
    ctx.drawImage(t2.canvas, 0, 0);
    ctx.restore();
  }

  // ── entrées ──
  installerEntrees() {
    const canvas = this.canvas;
    const position = (ev) => {
      const r = canvas.getBoundingClientRect();
      return { x: (ev.clientX - r.left) * this.largeur / r.width, y: (ev.clientY - r.top) * this.hauteur / r.height };
    };
    canvas.addEventListener('pointermove', (ev) => { const p = position(ev); this.souris.x = p.x; this.souris.y = p.y; this.surSouris(false, false); });
    canvas.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      const p = position(ev); this.souris.x = p.x; this.souris.y = p.y;
      this.souris.enfonce = true;
      this.surSouris(true, false);
      try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* rien */ }
      if (typeof canvas.focus === 'function') canvas.focus();
    });
    const relacher = (ev) => {
      if (!this.souris.enfonce) return;
      if (ev && ev.clientX !== undefined) { const p = position(ev); this.souris.x = p.x; this.souris.y = p.y; }
      this.souris.enfonce = false;
      this.surSouris(false, true);
    };
    canvas.addEventListener('pointerup', relacher);
    canvas.addEventListener('pointercancel', relacher);
    racine.addEventListener('pointerup', relacher);
    canvas.addEventListener('pointerleave', () => { if (!this.souris.enfonce) { this.souris.x = -1000; this.souris.y = -1000; this.surSouris(false, false); } });
    const cible = options_cibleClavier(canvas);
    cible.addEventListener('keydown', (ev) => {
      if (ev.repeat) { if ([32, 37, 38, 39, 40, 9].includes(ev.keyCode)) ev.preventDefault(); return; }
      K.Key.presser(ev.keyCode);
      if ([32, 37, 38, 39, 40, 9].includes(ev.keyCode)) ev.preventDefault();
    });
    cible.addEventListener('keyup', (ev) => { K.Key.relacher(ev.keyCode); });
    racine.addEventListener('blur', () => K.Key.toutRelacher());
  }
  // Ce qui est sous la souris : un bouton (zone active) ou un clip à gestionnaire.
  objetSous(x, y) {
    const chercher = (clip) => {
      for (let i = clip.$enfants.length - 1; i >= 0; i--) {
        const e = clip.$enfants[i];
        if (!e.$visible || e.$estMasque || e.$masqueJusqua) continue;
        if (e instanceof Bouton) {
          if (e.enabled && e.contientGlobal(x, y)) return e;
          continue;
        }
        if (e instanceof Clip) {
          const interactif = typeof e.onPress === 'function' || typeof e.onRelease === 'function'
            || typeof e.onRollOver === 'function' || typeof e.onRollOut === 'function';
          if (interactif) {
            if (e.hitTest(x, y, true)) return e;
            continue;
          }
          const r = chercher(e);
          if (r) return r;
        }
      }
      return null;
    };
    return chercher(this.racine);
  }
  declencher(e, nom) {
    if (!e) return;
    if (e instanceof Bouton) e.declencher(nom);
    else {
      const f = e['on' + nom[0].toUpperCase() + nom.slice(1)];
      if (typeof f === 'function') f.call(e);
    }
    this.viderScripts();
  }
  surSouris(presse, relache) {
    const sous = this.objetSous(this.souris.x, this.souris.y);
    if (sous !== this.sousSouris) {
      if (this.sousSouris) {
        if (this.appuye === this.sousSouris) this.declencher(this.sousSouris, 'dragOut');
        else this.declencher(this.sousSouris, 'rollOut');
        if (this.sousSouris instanceof Bouton) this.sousSouris.$etat = 1;
      }
      this.sousSouris = sous;
      if (sous && (!this.appuye || this.appuye === sous)) {
        this.declencher(sous, 'rollOver');
        if (sous instanceof Bouton) sous.$etat = this.appuye === sous ? 4 : 2;
      }
    }
    if (presse && sous) {
      this.appuye = sous;
      if (sous instanceof Bouton) sous.$etat = 4;
      this.declencher(sous, 'press');
    }
    if (relache && this.appuye) {
      const a = this.appuye;
      this.appuye = null;
      if (a instanceof Bouton) a.$etat = (sous === a) ? 2 : 1;
      this.declencher(a, sous === a ? 'release' : 'releaseOutside');
    }
    canvasCurseur(this.canvas, !!sous && (!(sous instanceof Bouton) || sous.useHandCursor));
  }
}
function options_cibleClavier(canvas) { return racine; }
function canvasCurseur(canvas, main) { canvas.style.cursor = main ? 'pointer' : 'default'; }
K.Scene = Scene;

})(typeof window !== 'undefined' ? window : globalThis);
