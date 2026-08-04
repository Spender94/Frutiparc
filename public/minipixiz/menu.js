/*
 * Minipixiz — le menu de l'aventure.
 *
 * C'est l'écran-carrefour : la clairière d'où l'on part en forêt, où l'on voit
 * le bassin s'allumer quand une fée y dort, le donjon se construire dans la
 * nuit, l'arbre grandir, le moulin tourner. Menu.mt, porté tel quel.
 *
 * ── Les dix plans ──
 *
 * Menu.initDecor empile dix plans, chacun avec son coefficient de parallaxe :
 *
 *     ciel      —     horizon .25   collines .35   forêt3 .45   forêt2 .52
 *     forêt .9  milieu 1.1   arbre 1.5   herbe 1.8   premier 3.2
 *
 * et moveDecor les décale de `-xm × c` où `xm` suit le pointeur, étiré de trente
 * pour cent au-delà des bords :
 *
 *     xm = borner(0, x × 1,6 − 72, 240)
 *
 * Plus le plan est près, plus il glisse — c'est toute la profondeur de l'écran,
 * et elle ne coûte qu'une multiplication.
 *
 * ── Le ciel EST l'horloge ──
 *
 * Menu.setNight :
 *
 *     sky.gotoAndStop( int(nc*100) + 1 )                    nc = $time.$s / un jour
 *     chaque plan → setPercentColor( max(80 − c×30, 30) × |nc−0,5| × 2, 0x274C76 )
 *
 * Le ciel a cent une images — deux morphs et une forme — et les plans bleuissent
 * d'autant plus qu'ils sont loin. À midi, rien n'est teinté ; à minuit, le fond
 * est presque entièrement bleu nuit.
 *
 * ── Les nuages ──
 *
 * Huit groupes de tailles décroissantes, huit moins i nuages par groupe, qui
 * dérivent avec le vent du jour ($wind, retiré chaque nuit).
 */
'use strict';

(function (racine) {

const SCENE = 240;

// Menu.initDecor — l'ordre d'empilement et le coefficient de parallaxe.
const PLANS = [
  { cle: 'horizon', c: 0.25 },
  { cle: 'collines', c: 0.35 },
  { cle: 'foret3', c: 0.45 },
  { cle: 'foret2', c: 0.52 },
  { cle: 'foret', c: 0.9 },
  { cle: 'milieu', c: 1.1 },
  { cle: 'arbre', c: 1.5 },
  { cle: 'herbe', c: 1.8 },
  { cle: 'premier', c: 3.2 },
];

// Les lieux, avec le plan qui les accroche et ce qu'ils ouvrent.
const LIEUX = [
  { cle: 'mArcEnCiel', plan: 'horizon', nom: 'rainbow', titre: 'Arc en ciel', va: 'rainbow' },
  { cle: 'mMoulin', plan: 'collines', nom: 'windMill', titre: 'Moulin', va: 'option' },
  { cle: 'mDonjon', plan: 'collines', nom: 'dungeon', titre: 'Donjon', va: 'dungeon' },
  { cle: 'mBassin', plan: 'foret', nom: 'fountain', titre: 'Bassin aux fées', va: 'fountain' },
  { cle: 'mForet', plan: 'foret', nom: 'forest', titre: 'Forêt enchantée', va: 'foret' },
  { cle: 'mCabane', plan: 'foret', nom: 'house', titre: 'Cabane de Gromelin', va: 'mission' },
  { cle: 'mArbre', plan: 'milieu', nom: 'tree', titre: 'Arbre creux', va: 'tree' },
  { cle: 'mSac', plan: 'arbre', nom: 'bag', titre: 'Inventaire', va: 'inventaire' },
  { cle: 'mGrenouille', plan: 'premier', nom: 'frog', titre: 'Ornegon', va: 'frog' },
];

const BLEU_NUIT = 0x274C76;
const BLEU_NUAGE = 0x8EB3D7;
const MARGE_SOURIS = 0.3;             // Menu.update : `var ma = 0.3`
const NB_GROUPES_NUAGES = 8;          // Menu.initDecor : `var max = 8`
const TREE_LIMIT = [500, 1000, 2000, 4000, 8000];   // Cs.treeLimit

const nombre = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const borner = (min, v, max) => Math.max(min, Math.min(v, max));

/**
 * @param {object} o
 *   canvas       le canevas 240 × 240
 *   plateforme   la Plateforme, pour lire la fiche
 *   sprites      le manifeste des dessins
 *   surChoix     (destination) → quand le joueur touche un lieu
 */
class Menu {
  constructor(o) {
    this.canvas = o.canvas;
    this.ctx = this.canvas.getContext('2d');
    this.plateforme = o.plateforme;
    this.sprites = o.sprites;
    this.surChoix = o.surChoix || null;

    // Au bureau, la souris place le regard dès le premier survol. Au doigt,
    // rien ne bouge tant qu'on ne glisse pas : on ouvre le regard vers la
    // GAUCHE, là où vivent l'arbre et son sac — sans quoi le sac restait
    // invisible tant qu'on ne savait pas qu'il fallait glisser.
    const tactile = typeof window !== 'undefined' && window.matchMedia
      && window.matchMedia('(pointer: coarse)').matches;
    // Le sac pend au pied de l'arbre, tout à gauche du plan (x ≈ 28, parallaxe
    // 1,5) : il faut un regard presque au bord pour l'avoir entier à l'écran.
    this.xm = tactile ? 8 : SCENE / 2;
    this.titre = '';
    this.message = '';
    this.zones = [];
    this.rotationMoulin = 0;
    this.nuages = [];
    this.dpr = 1;
    this.actif = false;

    this.canvas.addEventListener('click', (ev) => this.clic(ev));
    this.canvas.addEventListener('mousemove', (ev) => this.viser(ev));
    // Au doigt, REGARDER et CHOISIR passent par les mêmes gestes : glisser
    // panorame la clairière (viser), et le navigateur clôt tout de même le
    // toucher par un `click` — qui tomberait sur le lieu venu GLISSER sous le
    // doigt. On mesure donc chaque toucher : ce qui a bougé était un regard.
    this.touche = null;
    this.canvas.addEventListener('touchstart', (ev) => {
      const t = ev.touches[0];
      if (t) this.touche = { x: t.clientX, y: t.clientY, bouge: 0 };
    }, { passive: true });
    this.canvas.addEventListener('touchmove', (ev) => {
      const t = ev.touches[0];
      if (!t) return;
      if (this.touche) {
        this.touche.bouge = Math.max(this.touche.bouge,
          Math.hypot(t.clientX - this.touche.x, t.clientY - this.touche.y));
      }
      this.viser(t);
    }, { passive: true });
    this.redimensionner();
    window.addEventListener('resize', () => this.redimensionner());
  }

  get carte() { return this.plateforme.carte; }

  redimensionner() {
    const parent = this.canvas.parentElement || document.body;
    const dispo = Math.min((parent.clientWidth || SCENE) / SCENE,
      (parent.clientHeight || SCENE) / SCENE);
    const entier = Math.floor(dispo);
    this.echelle = (entier >= 1 && entier / dispo >= 0.8) ? entier : dispo;
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.canvas.width = SCENE * this.dpr;
    this.canvas.height = SCENE * this.dpr;
    this.canvas.style.width = (SCENE * this.echelle) + 'px';
    this.canvas.style.height = (SCENE * this.echelle) + 'px';
  }

  // Cm.getNightCoef : zéro à minuit, un demi à midi.
  coefNuit() {
    const t = this.carte.$time || {};
    let s = nombre(t.$s);
    if (s < 0) s = 0;
    return (s % 86400000) / 86400000;
  }

  vent() { return nombre(this.carte.$wind); }

  /**
   * Menu.initDecor — huit groupes de nuages, de plus en plus petits et de plus
   * en plus lents. Le premier groupe en compte huit, le dernier un seul : c'est
   * ce dégradé de densité qui donne la profondeur du ciel.
   */
  semerNuages(alea) {
    const hasard = alea || Math.random;
    this.nuages = [];
    const max = NB_GROUPES_NUAGES;
    for (let i = 0; i < max; i++) {
      const c = i / max;
      for (let n = 0; n < (max - i); n++) {
        const w = 50 + c * 100;
        this.nuages.push({
          c: c * 0.2,
          w,
          x: hasard() * (SCENE + w) - w,
          y: (170 - c * 40) + (hasard() * 2 - 1) * c * 20,
          image: 1 + Math.floor(hasard() * 3),
          prc: 80 * (1 - c),
        });
      }
    }
  }

  // Menu.moveDecor, une image de jeu.
  avancer(tmod) {
    const wc = this.vent();
    for (const n of this.nuages) {
      n.x += n.c * wc * 3 * tmod;
      const m = 100;
      if (n.x > SCENE + m) n.x = -(n.w + m);
    }
    this.rotationMoulin += wc * 2 * tmod;
  }

  // Menu.update : le pointeur commande la parallaxe, avec trente pour cent de
  // marge de chaque côté pour qu'on atteigne les bords du décor.
  viser(ev) {
    const r = this.canvas.getBoundingClientRect();
    const x = (ev.clientX - r.left) / this.echelle;
    const y = (ev.clientY - r.top) / this.echelle;
    this.xm = borner(0, x * (1 + 2 * MARGE_SOURIS) - SCENE * MARGE_SOURIS, SCENE);
    // Menu.initTitleBut : survoler un lieu écrit son nom. Le décor bouge en même
    // temps, donc on relit la zone APRÈS avoir déplacé le regard — sinon le nom
    // désignerait l'endroit qu'on vient de quitter.
    const z = this.lieuA(x, y);
    this.titre = z ? z.lieu.titre : '';
  }

  // ── Ce que la fiche dit de chaque lieu (Menu.initElements) ──
  etatLieu(l) {
    const c = this.carte;
    switch (l.nom) {
      case 'bag': {
        const b = nombre(c.$bag);
        return { visible: b > 0, frame: Math.max(1, b) };
      }
      case 'dungeon': {
        const d = c.$dungeon || {};
        return { visible: !!d.$f, frame: nombre(d.$lvl) + 1,
          ouvert: nombre(c.$key) > 0 };
      }
      case 'fountain': {
        const p = c.$pond || {};
        const pret = p.$fs !== null && p.$fs !== undefined;
        return { visible: true, frame: pret ? 2 : 1, ouvert: pret };
      }
      case 'frog':
        return { visible: !!c.$frog, frame: 1 };
      case 'rainbow':
        return { visible: !!((c.$rainbow || {}).$f), frame: 1 };
      case 'tree': {
        let f = 1;
        for (const seuil of TREE_LIMIT) if (nombre((c.$stat || {}).$treeMax) > seuil) f++;
        return { visible: true, frame: f };
      }
      default:
        return { visible: true, frame: 1 };
    }
  }

  // ── Le rendu ──
  rendre() {
    const C = racine.MinipixizClient;
    const ctx = this.ctx, s = this.sprites;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, SCENE, SCENE);
    this.zones = [];

    const nc = this.coefNuit();
    const nuit = Math.abs(nc - 0.5) * 2;      // zéro à midi, un à minuit

    // 1. LE CIEL — l'image dit l'heure. `int(nc*100)+1`, de 1 à 101.
    if (s.ciel) {
      const f = borner(1, Math.floor(nc * 100) + 1, 101);
      C.poserRendu(ctx, C.rendre(s.ciel, f, 100), 0, 0);
    }

    // 2. LES NUAGES — au-dessus du ciel, sous tout le reste.
    if (s.nuage) {
      for (const n of this.nuages) {
        const r = C.rendre(s.nuage, n.image, n.w, undefined, null, null, null,
          { prc: Math.round(n.prc / 5) * 5, couleur: BLEU_NUAGE });
        const x = (0 - this.xm) * n.c + n.x;
        ctx.save();
        // modColor(1, -|nc-0.5|×130) : la nuit les efface presque.
        ctx.globalAlpha = borner(0.15, 1 - nuit * 0.5, 1);
        C.poserRendu(ctx, r, x, n.y);
        ctx.restore();
      }
    }

    // 3. LES PLANS, du plus loin au plus près, chacun teinté selon l'heure.
    for (const p of PLANS) {
      const sp = s[p.cle];
      if (!sp) continue;
      // setNight : `max(80 - c*30, 30) × |nc-0,5| × 2`.
      const prc = Math.round(Math.max(80 - p.c * 30, 30) * nuit / 5) * 5;
      const x = -this.xm * p.c;
      C.poserRendu(ctx, C.rendre(sp, sp.etats[0].frame, 100, undefined, null, null, null,
        { prc, couleur: BLEU_NUIT }), x, 0);

      // Les lieux accrochés à ce plan suivent son décalage.
      for (const l of LIEUX) {
        if (l.plan !== p.cle) continue;
        const sl = s[l.cle];
        const ancre = (sp.ancrages || {})[l.nom];
        if (!sl || !ancre) continue;
        const et = this.etatLieu(l);
        if (!et.visible) continue;
        const frame = borner(1, et.frame, sl.etats[sl.etats.length - 1].frame);
        const lx = x + ancre.x, ly = ancre.y;
        const rot = (l.nom === 'windMill') ? { 'w.w': this.rotationMoulin } : null;
        // Le plan ne fait pas que poser un lieu : le moulin est réduit à 70 %,
        // et l'arc-en-ciel posé sous un alpha de 30 % — c'est ce voile qui rend
        // ses couleurs si douces. Sans lui, il criait.
        const k = ancre.k || 1;
        if (ancre.alpha !== undefined) {
          ctx.save();
          ctx.globalAlpha = ancre.alpha;
        }
        C.poserRendu(ctx, C.rendre(sl, frame, 100 * k, undefined, null, null, rot,
          { prc, couleur: BLEU_NUIT }), lx, ly);
        if (ancre.alpha !== undefined) ctx.restore();
        // Sa zone sensible, au même endroit que son dessin.
        const e = sl.etats.find((q) => q.frame === frame) || sl.etats[0];
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const q of e.pieces) {
          x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y);
          x1 = Math.max(x1, q.x + q.w); y1 = Math.max(y1, q.y + q.h);
        }
        this.zones.push({ lieu: l, etat: et,
          x: lx + x0 * k, y: ly + y0 * k, l: (x1 - x0) * k, h: (y1 - y0) * k });
      }
    }

    // 4. Le titre du lieu visé, et le bandeau d'information.
    ctx.font = 'bold 11px Verdana, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    if (this.titre) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(10,25,40,.85)';
      ctx.strokeText(this.titre, SCENE / 2, 10);
      ctx.fillStyle = '#ffe9a8';
      ctx.fillText(this.titre, SCENE / 2, 10);
    }
    // Sur un écran tactile il n'y a pas de survol : on dit comment se promener.
    if (!this.message && !this.titre) {
      ctx.font = '9px Verdana, Arial, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,.55)';
      ctx.fillText('glissez pour regarder autour · touchez un lieu pour y aller',
        SCENE / 2, SCENE - 14);
    }
    if (this.message) {
      ctx.font = 'bold 9px Verdana, Arial, sans-serif';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(10,25,40,.85)';
      ctx.strokeText(this.message, SCENE / 2, SCENE - 22);
      ctx.fillStyle = '#e8f0ff';
      ctx.fillText(this.message, SCENE / 2, SCENE - 22);
    }
  }

  clic(ev) {
    // Le clic qui referme un GLISSEMENT n'est pas un choix : le décor a
    // défilé sous le doigt, et l'endroit relâché n'est pas celui qu'on a
    // touché. Huit pixels laissent passer le tremblé d'un vrai tap.
    const touche = this.touche;
    this.touche = null;
    if (touche && touche.bouge > 8) return;
    // Et au retour d'un autre écran (le sac, une partie), un court silence :
    // le tap qui a fermé là-bas ne doit pas choisir ici.
    if (this.garde && this.maintenant() < this.garde) return;
    const r = this.canvas.getBoundingClientRect();
    const x = (ev.clientX - r.left) / this.echelle;
    const y = (ev.clientY - r.top) / this.echelle;
    // L'iris de la prochaine transition s'ouvrira d'ici (Manager.fadeSlot).
    this.dernierClic = { x, y };
    // Le plus proche du joueur d'abord : les zones sont posées du fond vers
    // l'avant, on cherche donc à l'envers.
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i];
      if (x >= z.x && x <= z.x + z.l && y >= z.y && y <= z.y + z.h) {
        this.titre = z.lieu.titre;
        if (this.surChoix) this.surChoix(z.lieu, z.etat);
        return;
      }
    }
  }

  // Quel lieu se trouve sous un point ? Utile aux vérifications automatisées.
  lieuA(x, y) {
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i];
      if (x >= z.x && x <= z.x + z.l && y >= z.y && y <= z.y + z.h) return z;
    }
    return null;
  }

  dire(message) { this.message = message || ''; }

  maintenant() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }

  // Ignorer les clics un instant — le temps qu'un doigt qui vient de fermer
  // un écran au même endroit ne retombe pas sur la clairière.
  garder(ms) { this.garde = this.maintenant() + (ms || 400); }

  demarrer(alea) {
    this.garder(400);
    if (!this.nuages.length) this.semerNuages(alea);
    // On mesure à l'ouverture : tant que le panneau est caché, il n'a pas de
    // taille, et le canevas resterait à l'échelle un.
    this.redimensionner();
    this.actif = true;
    if (this.raf) return;
    let dernier = 0;
    const boucle = (t) => {
      this.raf = requestAnimationFrame(boucle);
      if (!this.actif) return;
      const dt = dernier ? Math.min((t - dernier) / 1000, 0.25) : 0;
      dernier = t;
      this.avancer(dt * 30);
      this.rendre();
      // La clairière aussi s'ouvre dans l'iris du jeu.
      if (this.iris && !this.iris.dessiner(this.ctx, dt * 30)) this.iris = null;
    };
    this.raf = requestAnimationFrame(boucle);
  }

  arreter() { this.actif = false; }
}

const API = { Menu, PLANS, LIEUX, TREE_LIMIT, BLEU_NUIT, BLEU_NUAGE, MARGE_SOURIS };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
else racine.MinipixizMenu = API;

})(typeof window !== 'undefined' ? window : globalThis);
