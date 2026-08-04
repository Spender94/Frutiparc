/*
 * Minipixiz — l'inventaire, sur les dessins du jeu.
 *
 * Inventory.mt, à la coordonnée près. La scène fait 240 × 240 comme le reste :
 *
 *     invBg          le fond, sous tout                        (DP_BG   = 7)
 *     les cases      32 px, centrées dans 154 × 140 depuis y=20 (DP_SLOT = 4)
 *     invFace        le panneau de la fée, en 200,41           (DP_SLOT2= 6)
 *     msgPanel       le bandeau de message, en y = 240-60      (DP_MSG  = 9)
 *     invFront       le cadre, par-dessus                      (DP_FRONT=12)
 *     mcTrashcan     la poubelle, en y = 240
 *
 * La grille du sac vient de INV_SHAPE = [0,2,3,4,3] : deux colonnes avec le
 * premier sac, trois avec le deuxième, quatre avec le troisième. C'est ce qui
 * fait que l'inventaire CHANGE DE FORME à mesure qu'on trouve mieux.
 *
 * Le panneau de la fée a quatre volets, que le bouton de gauche fait tourner
 * (SECTION) : ses caractéristiques, ses sortilèges, son sac, sa santé.
 *
 * ── Le geste ──
 *
 * Le jeu tient une MAIN : on prend un objet, on le repose ailleurs, et le poser
 * sur le portrait le donne à manger (Inventory.giveItem). On garde exactement
 * ça, au doigt plutôt qu'à la souris.
 */
'use strict';

(function (racine) {

// items.js s'expose sur `window` dans le navigateur et par module.exports sous
// Node : les tests peuvent ainsi vérifier la géométrie sans navigateur.
const O = (typeof module !== 'undefined' && module.exports)
  ? require('./items.js') : racine.MinipixizObjets;
const N = (typeof module !== 'undefined' && module.exports)
  ? require('./nuit.js') : null;
const nuit = () => N || racine.MinipixizNuit;

// Les constantes d'Inventory.mt, telles quelles.
const SCENE = 240;
const MARGIN_UP = 20;
const SLOT_SIZE = 32;
const INV_WIDTH = 154;
const INV_HEIGHT = 140;
const INV_SHAPE = [0, 2, 3, 4, 3];
const SECTION = ['voir les caractéristiques', 'voir les sortilèges',
  'voir l\'équipement', 'voir la santé'];

// Le panneau de la fée et ses volets (initFaeriePanel / initFaerieIntMode).
const PANNEAU = { x: 200, y: 41 };
const BARRE = { x: 173, y: 97, pas: 14, point0: 9, pointPas: 6, points: 8 };
const SORT = { x: 175, y: 98, pas: 17, colonnes: 4, lignes: 5 };
const SAC_FEE = { x: 184, pas: 32, colonnes: 2 };
const SANTE = { coeurY: 92, coeurPas: 9, coeurEchelle: 60, cadranX: 200, cadranY: 137 };
const MSG_Y = SCENE - 60;

// La rangée du bas (initExtraDisplay) : la clé, l'étoile, cinq diamants.
const EXTRA = { y: 168, cleX: 19, etoileX: 54, diamX: 85, diamPas: 15, diamants: 5 };
// Où chaque contenu se pose dans son alvéole, et à quelle taille. Ce sont les
// matrices de placement de `invSmallSlot`, lues telles quelles : la clé est un
// dessin de cent unités réduit à 14,8 %, l'étoile est à sa taille, le diamant
// à 72,9 %.
const DEDANS = {
  cle: { echelle: 14.825, dx: -2.2, dy: 0.45 },
  etoile: { echelle: 100, dx: -2.85, dy: -0.3 },
  diamant: { echelle: 72.897, dx: 0, dy: 0 },
};

// Les lettres des six barres. Le fichier les porte en texte STATIQUE (chars 622
// à 627, Berlin Sans FB Demi 10 px, rgb(73,116,186)), une par image du clip —
// et un texte statique n'est pas une forme : l'extracteur ne peut pas le sortir.
// On les redessine donc, à la place que donnent les matrices : le coin haut
// gauche de la lettre tombe à 2,45 px à gauche du repère de la barre, sa ligne
// de base 3,3 px en dessous.
const LETTRES = ['F', 'R', 'V', 'I', 'C', 'M'];
const LETTRE_COULEUR = 'rgb(73,116,186)';
const LETTRE_X = 2.35;
const LETTRE_BASE = 3.3;
// Le compteur de clés et d'étoiles : même fonte, deux fois plus haute, centrée
// dans une boîte qui déborde à droite de l'alvéole, et à peine opaque.
const COMPTE_COULEUR = 'rgba(67,100,175,.70)';
const COMPTE_X = 13;
const COMPTE_BASE = 4;
const FONTE = '"Berlin Sans FB Demi", "Trebuchet MS", Verdana, sans-serif';

const nombre = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// Item.getPic : quel dessin, et sur quelle image, pour un type donné.
function dessinObjet(type) {
  const it = O.info(type);
  if (!it) return null;
  switch (it.famille) {
    case 'carac': return { cle: 'itCarac', frame: it.type + 1 };
    case 'pouvoir': return { cle: 'itPouvoir', frame: it.id + 1 };
    case 'globe': return { cle: 'itGlobe', frame: it.id + 1 };
    // it.Color.getPic teinte le sous-clip `col` de la couleur de la mèche.
    case 'coloration': return { cle: 'itColoration', frame: 1, parties: { col: it.couleur } };
    case 'potion': return { cle: 'itPotion', frame: it.id + 1 };
    case 'parchemin': return { cle: 'itParchemin', frame: it.sort + 1 };
    case 'grimoire': return { cle: 'itGrimoire', frame: it.sort + 1 };
    case 'bocal': return { cle: 'itBocal', frame: 1 };
    // Le sac et la clé n'entrent jamais dans une case du sac (l'un devient de
    // la place, l'autre monte le trousseau) — mais sur la GRILLE de la forêt,
    // ils doivent se voir : sans dessin, la bulle paraissait vide.
    case 'sac': return { cle: 'mSac', frame: (it.id || 0) + 1 };
    case 'cle': return { cle: 'invCle', frame: 1 };
    // L'aliment se lit à deux index : lequel, et quelle part il en reste.
    case 'aliment': return { cle: 'itAliment' + (it.taille + 1), frame: it.id + 1 };
    default: return null;
  }
}

/**
 * @param {object} o
 *   canvas       le canevas 240 × 240 de l'inventaire
 *   plateforme   la Plateforme, pour lire et écrire la fiche
 *   sprites      le manifeste des dessins
 *   surChangement appelé à chaque modification de la fiche
 *   surFermeture appelé quand le joueur referme
 */
class Inventaire {
  constructor(o) {
    this.canvas = o.canvas;
    this.ctx = this.canvas.getContext('2d');
    this.plateforme = o.plateforme;
    this.sprites = o.sprites;
    this.surChangement = o.surChangement || null;
    this.surFermeture = o.surFermeture || null;

    this.main = null;                 // l'objet tenu : {sac, case}
    this.feeCourante = 0;
    this.volet = 0;                   // faerieIntMode
    this.aConfirmer = null;           // la fée qu'on s'apprête à relâcher
    this.message = '';
    this.titre = '';
    this.zones = [];                  // les rectangles cliquables, refaits à chaque rendu
    this.dpr = 1;

    this.canvas.addEventListener('click', (ev) => this.clic(ev));
    // Le coin de sortie s'allume au survol (mcButQuit image 2). L'écran ne se
    // redessine que quand l'état change — pas à chaque mouvement.
    this.surLeCoin = false;
    this.canvas.addEventListener('mousemove', (ev) => {
      const r = this.canvas.getBoundingClientRect();
      const x = (ev.clientX - r.left) / this.echelle;
      const y = (ev.clientY - r.top) / this.echelle;
      const dessus = x > SCENE - 46 && y > SCENE - 46;
      if (dessus !== this.surLeCoin) { this.surLeCoin = dessus; this.rendre(); }
    });
    this.canvas.addEventListener('mouseleave', () => {
      if (this.surLeCoin) { this.surLeCoin = false; this.rendre(); }
    });
    this.redimensionner();
    window.addEventListener('resize', () => { this.redimensionner(); this.rendre(); });
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

  // La fée regardée, vivante — avec tout ce qu'elle porte appliqué.
  fee() {
    const fs = (this.carte.$faerie || [])[this.feeCourante];
    return fs ? new racine.MinipixizFee.Fee(fs, null, this.carte) : null;
  }

  // ── La grille du sac (Inventory.initSlot) ──
  grilleJoueur() {
    const bag = Math.max(0, Math.min(nombre(this.carte.$bag), INV_SHAPE.length - 1));
    const max = O.PLACES_SAC[bag];
    if (!max) return { max: 0, cases: [] };
    const xMax = INV_SHAPE[bag];
    const yMax = Math.ceil(max / xMax);
    const smx = (INV_WIDTH - xMax * SLOT_SIZE) * 0.5;
    const smy = MARGIN_UP + (INV_HEIGHT - yMax * SLOT_SIZE) * 0.5;
    const cases = [];
    let x = 0, y = 0;
    for (let i = 0; i < max; i++) {
      cases.push({ i, cx: smx + (x + 0.5) * SLOT_SIZE, cy: smy + (y + 0.5) * SLOT_SIZE });
      if (++x === xMax) { x = 0; y++; }
    }
    return { max, cases };
  }

  // Le sac de la fée, dans le volet « équipement ».
  grilleFee() {
    const fs = (this.carte.$faerie || [])[this.feeCourante];
    if (!fs) return { max: 0, cases: [] };
    const max = O.placesFee(fs);
    const by = 130 - Math.floor(max / 2) * 16;
    const cases = [];
    let x = 0, y = 0;
    for (let i = 0; i < max; i++) {
      cases.push({ i, cx: SAC_FEE.x + x * SAC_FEE.pas, cy: by + y * SAC_FEE.pas });
      if (++x === SAC_FEE.colonnes) { x = 0; y++; }
    }
    return { max, cases };
  }

  // ── Le rendu ──
  rendre() {
    const C = racine.MinipixizClient;
    const ctx = this.ctx, s = this.sprites;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, SCENE, SCENE);
    this.zones = [];

    const poser = (cle, frame, taille, x, y, couleur, parties) => {
      if (!s[cle]) return;
      C.poserRendu(ctx, C.rendre(s[cle], frame, taille, couleur, parties), x, y);
    };

    // 1. Le dessin de l'ÉCRAN lui-même : le grand panneau clair. Ce n'est pas un
    //    décor attaché, c'est le clip « inventory » que Manager.genSlot pose, et
    //    sans lui tout l'inventaire flottait sur du noir.
    poser('invEcran', 1, 100, 0, 0);

    // 2. Les cases du sac du joueur, et ce qu'elles portent (DP_SLOT = 4).
    const g = this.grilleJoueur();
    const liste = O.contenu(this.carte.$inv, g.max);
    for (const c of g.cases) {
      this.caseAvecObjet(c.cx, c.cy, SLOT_SIZE, liste[c.i], 'joueur', c.i);
    }
    if (!g.max) {
      this.texte('Pas encore de sac', INV_WIDTH / 2, MARGIN_UP + INV_HEIGHT / 2, '#6b5b3a', 10);
    }

    // 3. La rangée du bas : ce qu'on a rapporté du monde (DP_SLOT lui aussi).
    this.rendreExtra();

    // 4. Le volet de la fée, puis son panneau par-dessus (DP_SLOT2 = 6).
    const fee = this.fee();
    if (fee) this.rendreVolet(fee);
    this.rendrePanneau(fee);

    // 5. Les lianes (invBg) : malgré son nom, le jeu les pose à DP_BG = 7, donc
    //    PAR-DESSUS les cases et le panneau. Elles retombent sur l'écran.
    poser('invFond', 1, 100, 0, 0);

    // 6. Le bandeau de message, le cadre, la poubelle.
    poser('invMessage', this.titre ? 2 : 1, 100, 0, MSG_Y);
    if (this.message) {
      this.texte(this.message, SCENE / 2, MSG_Y + (this.titre ? 26 : 22), '#2a2416', 9, 200);
      if (this.titre) this.texte(this.titre, SCENE / 2, MSG_Y + 10, '#6b3a1a', 10);
    }
    poser('invDevant', 1, 100, 0, 0);
    poser('invPoubelle', 1, 100, 0, SCENE);
    this.zoneRect('poubelle', 0, SCENE - 32, 24, 32);

    // 7. Le coin de sortie — Slot.initButQuit : mcButQuit posé en (mcw, mch),
    //    image 2 au survol, et le clic ramène à la clairière.
    poser('boutonQuitter', this.surLeCoin ? 2 : 1, 100, SCENE, SCENE);
    this.zoneRect('quitter', SCENE - 46, SCENE - 46, 46, 46);

    // 5. L'objet tenu suit le doigt : on le montre au coin de sa case d'origine,
    //    entouré, pour qu'on sache toujours ce qu'on a en main.
    if (this.main) {
      const r = this.caseDeLaMain();
      if (r) {
        ctx.strokeStyle = '#ffd76a';
        ctx.lineWidth = 2;
        ctx.strokeRect(r.x - 16, r.y - 16, 32, 32);
      }
    }
  }

  caseDeLaMain() {
    if (!this.main) return null;
    const g = this.main.sac === 'joueur' ? this.grilleJoueur() : this.grilleFee();
    const c = g.cases.find((q) => q.i === this.main.case);
    return c ? { x: c.cx, y: c.cy } : null;
  }

  // Une case, son objet, et sa zone cliquable.
  caseAvecObjet(cx, cy, taille, type, sac, index) {
    const C = racine.MinipixizClient, s = this.sprites, ctx = this.ctx;
    if (s.invCase) {
      const r = C.rendre(s.invCase, 1, taille);
      C.poserRendu(ctx, r, cx, cy);
    }
    const d = dessinObjet(type);
    if (d && s[d.cle]) {
      // Un objet occupe la case sans la remplir : le jeu le pose à l'échelle de
      // la case, comme n'importe quel dessin de cent unités.
      const r = C.rendre(s[d.cle], d.frame, taille * 0.82, undefined, d.parties);
      C.poserRendu(ctx, r, cx, cy);
    }
    // inv/Item.updatePic : un bocal habité montre SA locataire. Sans ce dessin,
    // rien ne dirait au joueur laquelle de ses fées Gromelin acceptera.
    if (sac === 'joueur' && type === O.IT_BOCAL) {
      const dedans = (this.carte.$faerie || []).find((f) => f && f.$pos === index);
      if (dedans && s.fee) {
        const a = new racine.MinipixizFee.Fee(dedans, null, null).apparence();
        C.poserVif(ctx, s.fee, 1, {
          x: cx, y: cy + taille * 0.12, sx: 52, sy: 52,
          parties: C.partiesDeCorps(a.couleurs),
        });
      }
    }
    this.zoneRect({ sac, case: index }, cx - taille / 2, cy - taille / 2, taille, taille);
  }

  /**
   * Inventory.initExtraDisplay — la clé, l'étoile et les cinq diamants.
   *
   * Chaque alvéole existe toujours ; c'est son CONTENU qui s'efface quand on n'a
   * rien. Et sous la clé comme sous l'étoile s'affiche un compte, qui disparaît
   * lui aussi à zéro.
   */
  rendreExtra() {
    const C = racine.MinipixizClient, s = this.sprites, ctx = this.ctx;
    const c = this.carte;
    const alveole = (frame, x) => {
      if (s.invPetiteCase) C.poserRendu(ctx, C.rendre(s.invPetiteCase, frame, 100), x, EXTRA.y);
    };
    const dedans = (cle, frame, x, d) => {
      if (!s[cle]) return;
      C.poserRendu(ctx, C.rendre(s[cle], frame, d.echelle), x + d.dx, EXTRA.y + d.dy);
    };

    alveole(1, EXTRA.cleX);
    if (nombre(c.$key) > 0) {
      dedans('invCle', 1, EXTRA.cleX, DEDANS.cle);
      this.compte(String(nombre(c.$key)), EXTRA.cleX);
    }

    alveole(2, EXTRA.etoileX);
    if (nombre(c.$star) > 0) {
      dedans('invEtoile', 1, EXTRA.etoileX, DEDANS.etoile);
      this.compte(String(nombre(c.$star)), EXTRA.etoileX);
    }

    for (let i = 0; i < EXTRA.diamants; i++) {
      const x = EXTRA.diamX + i * EXTRA.diamPas;
      alveole(3, x);
      // `sub.gotoAndStop(1+i)` : le i-ième diamant a sa propre teinte.
      if (nombre(c.$diam) > i) dedans('invDiamant', i + 1, x, DEDANS.diamant);
    }
  }

  compte(t, x) {
    const ctx = this.ctx;
    ctx.font = 'bold 11px ' + FONTE;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = COMPTE_COULEUR;
    ctx.fillText(t, x + COMPTE_X, EXTRA.y + COMPTE_BASE);
    ctx.textBaseline = 'top';
  }

  rendreVolet(fee) {
    const C = racine.MinipixizClient, s = this.sprites, ctx = this.ctx;
    switch (this.volet) {
      case 0: {                        // CARACS
        for (let i = 0; i < 6; i++) {
          const y = BARRE.y + i * BARRE.pas;
          if (s.invBarre) C.poserRendu(ctx, C.rendre(s.invBarre, i + 1, 100), BARRE.x, y);
          ctx.font = 'bold 10px ' + FONTE;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'alphabetic';
          ctx.fillStyle = LETTRE_COULEUR;
          ctx.fillText(LETTRES[i], BARRE.x + LETTRE_X, y + LETTRE_BASE);
          ctx.textBaseline = 'top';
          for (let p = 0; p < BARRE.points; p++) {
            if (!s.invPoint) break;
            C.poserRendu(ctx, C.rendre(s.invPoint, p < nombre(fee.carac[i]) ? 2 : 1, 100),
              BARRE.x + BARRE.point0 + p * BARRE.pointPas, y);
          }
        }
        break;
      }
      case 1: {                        // MAGIE
        let i = 0;
        for (let y = 0; y < SORT.lignes; y++) {
          for (let x = 0; x < SORT.colonnes; x++, i++) {
            const px = SORT.x + x * SORT.pas, py = SORT.y + y * SORT.pas;
            const t = fee.sorts[i];
            const vide = (t === undefined || t === null);
            if (s.sortBille) C.poserRendu(ctx, C.rendre(s.sortBille, vide ? 2 : 1, 100), px, py);
            if (!vide && s.sortSymbole && s.sortSymbole.etats.some((e) => e.frame === t + 1)) {
              C.poserRendu(ctx, C.rendre(s.sortSymbole, t + 1, 100), px, py);
            }
            // Toucher un sort en dit le nom et l'effet (Spell.getDesc du
            // bureau, montré là-bas en infobulle).
            if (!vide) this.zoneRect({ sort: t }, px - 9, py - 9, 18, 18);
          }
        }
        break;
      }
      case 2: {                        // ÉQUIPEMENT
        const g = this.grilleFee();
        const fs = (this.carte.$faerie || [])[this.feeCourante];
        const l = O.contenu(fs && fs.$inv, g.max);
        for (const c of g.cases) {
          this.caseAvecObjet(c.cx, c.cy, SLOT_SIZE, l[c.i], this.feeCourante, c.i);
        }
        break;
      }
      case 3: {                        // SANTÉ
        const max = fee.vieMax();
        for (let i = 0; i < max; i++) {
          if (!s.coeur) break;
          C.poserRendu(ctx, C.rendre(s.coeur, i < nombre(fee.fs.$life) ? 2 : 1, SANTE.coeurEchelle),
            SANTE.cadranX - 4 + (i - (max - 1) * 0.5) * SANTE.coeurPas, SANTE.coeurY);
        }
        // mcManPower : deux aiguilles, faim et moral, sur un demi-tour.
        if (s.invSante) {
          C.poserRendu(ctx, C.rendre(s.invSante, 1, 100, undefined, null, null, {
            'h0.h': 180 + (nombre(fee.fs.$hunger) / 20) * 180,
            'h1.h': 180 + (nombre(fee.fs.$moral) / 20) * 180,
          }), SANTE.cadranX, SANTE.cadranY);
        }
        break;
      }
      default: break;
    }
  }

  rendrePanneau(fee) {
    const C = racine.MinipixizClient, s = this.sprites, ctx = this.ctx;
    if (!s.invPanneau) return;
    const px = PANNEAU.x, py = PANNEAU.y;

    // `Mc.setPic(facePanel.pic, fi.skin)` fait DEUX choses : il envoie le clip du
    // portrait sur l'image du visage tiré — d'où une sortie du panneau par
    // visage —, et il teinte ses mèches, ce que `parties` applique ici. Le
    // médaillon est un disque, et c'est le masque du fichier qui le découpe.
    if (fee) {
      const a = fee.apparence();
      C.poserRendu(ctx, C.rendre(s.invPanneau, a.num + 1, 100, undefined,
        C.partiesDeFee(a.couleurs, 'pic.'), null), px, py);
    } else {
      // Sans fée, le médaillon reste vide : le panneau n'a plus que son cadre.
      C.poserRendu(ctx, C.rendre(s.invPanneau, 1, 100, undefined, null, '>pic'), px, py);
    }

    // Les deux boutons et la pastille de niveau, aux ancres que le fichier
    // donne. Le bouton de gauche montre le volet SUIVANT — c'est ce qu'on
    // obtiendra en le touchant —, celui de droite toujours l'image 6, la fée
    // qu'on relâche.
    const a = (s.invPanneau.ancrages) || {};
    const pose = (cle, frame, an) => {
      if (!s[cle] || !an) return;
      C.poserRendu(ctx, C.rendre(s[cle], frame, 100), px + an.x, py + an.y);
    };
    pose('invBouton', ((this.volet + 1) % 4) + 1, a.swap);
    if (fee) {
      pose('invBouton', 6, a.quit);
      pose('invNiveau', 1, a.level);
      // Le niveau, dans sa pastille (facePanel.level.field) — et dessous, la
      // progression vers le suivant, que le bureau ne disait qu'en infobulle :
      // « niveau N (42.3%) ».
      if (a.level) {
        this.texte(String(nombre(fee.fs.$level) + 1), px + a.level.x, py + a.level.y - 5,
          '#3a2a12', 10);
        const prc = Math.min(99.9, Math.round((nombre(fee.fs.$exp) / fee.limiteExp()) * 1000) / 10);
        this.texte(prc + ' %', px + a.level.x, py + a.level.y + 9, '#5a4a22', 7);
        this.zoneRect({ pastille: 1 }, px + a.level.x - 10, py + a.level.y - 12, 20, 26);
      }
    }

    // Les trois zones à toucher, sur le dessin de chacune.
    const zone = (quoi, an, r) => {
      if (an) this.zoneRect(quoi, px + an.x - r, py + an.y - r, r * 2, r * 2);
    };
    zone('volet', a.swap, 10);
    this.zoneRect('portrait', px - 29.4, py - 29.4, 58.8, 58.8);
    if (fee) zone('liberer', a.quit, 10);

    // Plusieurs fées : de quoi passer de l'une à l'autre.
    const l = this.carte.$faerie || [];
    if (l.length > 1) {
      for (let i = 0; i < l.length && i < 6; i++) {
        const bx = 150 + i * 15, by = 8;
        ctx.fillStyle = i === this.feeCourante ? '#ffd76a' : 'rgba(255,255,255,.35)';
        ctx.beginPath(); ctx.arc(bx, by, 5, 0, 6.28); ctx.fill();
        this.zoneRect({ fee: i }, bx - 7, by - 7, 14, 14);
      }
    }
  }

  texte(t, x, y, couleur, taille, largeurMax) {
    const ctx = this.ctx;
    ctx.font = 'bold ' + (taille || 10) + 'px Verdana, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = couleur;
    if (largeurMax && ctx.measureText(t).width > largeurMax) {
      // Le bandeau du jeu tient sur deux lignes : on coupe au dernier espace.
      const mots = t.split(' ');
      let l1 = '', l2 = '';
      for (const m of mots) {
        if (ctx.measureText(l1 + ' ' + m).width < largeurMax && !l2) l1 += (l1 ? ' ' : '') + m;
        else l2 += (l2 ? ' ' : '') + m;
      }
      ctx.fillText(l1, x, y);
      ctx.fillText(l2, x, y + (taille || 10) + 2);
    } else {
      ctx.fillText(t, x, y);
    }
  }

  zoneRect(quoi, x, y, l, h) { this.zones.push({ quoi, x, y, l, h }); }

  // ── Les gestes ──
  clic(ev) {
    const r = this.canvas.getBoundingClientRect();
    const x = (ev.clientX - r.left) / this.echelle;
    const y = (ev.clientY - r.top) / this.echelle;
    // La dernière zone posée est la plus haute : on cherche à l'envers.
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i];
      if (x >= z.x && x <= z.x + z.l && y >= z.y && y <= z.y + z.h) {
        this.agir(z.quoi);
        return;
      }
    }
  }

  agir(quoi) {
    // Un geste, quel qu'il soit, annule la libération qu'on venait d'annoncer.
    if (quoi !== 'liberer') this.aConfirmer = null;
    if (quoi === 'volet') {
      // Le bouton fait tourner les quatre volets, mais pas les mains pleines :
      // `if( me.hand == null )` dans initFaerieIntMode.
      if (this.main) { this.dire('Reposez d\'abord ce que vous tenez.'); return; }
      this.volet = (this.volet + 1) % 4;
      this.dire(SECTION[(this.volet + 1) % 4]);
      return;
    }
    if (quoi === 'portrait') { this.donnerALaFee(); return; }
    if (quoi === 'liberer') { this.liberer(); return; }
    if (quoi === 'poubelle') { this.jeter(); return; }
    if (quoi === 'quitter') { this.fermer(); return; }
    // Le sort touché se présente : son nom, puis son effet (Spell.getDesc).
    if (quoi && quoi.sort !== undefined) {
      const S = racine.MinipixizSorts;
      const sort = S && S.nouveauSort ? S.nouveauSort(quoi.sort, null) : null;
      if (sort) this.dire(sort.description(), sort.nom() + ' :');
      return;
    }
    // La pastille de niveau dit la progression, comme l'infobulle du bureau.
    if (quoi && quoi.pastille !== undefined) {
      const fee = this.fee();
      if (fee) {
        const prc = Math.min(99.9, Math.round((nombre(fee.fs.$exp) / fee.limiteExp()) * 1000) / 10);
        this.dire('niveau ' + (nombre(fee.fs.$level) + 1) + ' (' + prc + ' %)');
      }
      return;
    }
    if (quoi && quoi.fee !== undefined) {
      this.feeCourante = quoi.fee;
      // Choisir une fée ici, c'est choisir la fée JOUÉE : la forêt lit
      // $current (Cm.getCurrentFaerie), pas l'affichage du sac. Sans cette
      // écriture, on regardait une fée et on en jouait une autre.
      if (this.carte.$current !== quoi.fee) {
        this.carte.$current = quoi.fee;
        if (this.surChangement) this.surChangement();
      }
      this.main = null; this.dire(''); return;
    }
    if (quoi && quoi.sac !== undefined) { this.toucher(quoi.sac, quoi.case); return; }
  }

  objetA(sac, index) {
    const liste = sac === 'joueur' ? this.carte.$inv
      : ((this.carte.$faerie || [])[sac] || {}).$inv;
    return O.info(Array.isArray(liste) ? liste[index] : null);
  }

  /**
   * inv/Item.addFaerie — la fée entre dans son BOCAL.
   *
   * `$pos` est l'index de la case du sac où se trouve le bocal qui l'abrite.
   * C'est une notion de session : le serveur ne l'enregistre jamais (une fée
   * persistée « en bocal » apparaissait à la fois dedans et dehors, ce qui la
   * dupliquait). On la repose donc à chaque visite — comme le SWF.
   *
   * Et ce n'est pas un détail décoratif : Gromelin ne prend QUE les fées en
   * bocal. Sans ce geste, ses missions sont hors d'atteinte.
   */
  bocal(index) {
    const l = this.carte.$faerie || [];
    const dedans = l.find((f) => f && f.$pos === index);
    if (dedans) {
      dedans.$pos = null;
      this.dire(dedans.$name + ' sort de son bocal.');
      this.changer();
      return true;
    }
    const fs = l[this.feeCourante];
    if (!fs) { this.dire('Aucune fée ne vous accompagne encore.'); return true; }
    if (fs.$pos !== null && fs.$pos !== undefined) {
      this.dire(fs.$name + ' est déjà dans un bocal.');
      return true;
    }
    fs.$pos = index;
    this.dire(fs.$name + ' s\'installe dans le bocal. Gromelin l\'acceptera.');
    this.changer();
    return true;
  }

  toucher(sac, index) {
    const it = this.objetA(sac, index);
    // Un bocal du sac du JOUEUR se touche pour y mettre — ou en sortir — la fée
    // qu'on regarde. Les mains pleines, il redevient un objet ordinaire qu'on
    // peut déplacer.
    if (!this.main && sac === 'joueur' && it && it.famille === 'bocal') {
      return this.bocal(index);
    }
    if (!this.main) {
      if (!it) { this.dire(''); return; }
      this.main = { sac, case: index };
      this.dire(it.desc, it.nom);
      return;
    }
    if (this.main.sac === sac && this.main.case === index) { this.main = null; this.dire(''); return; }
    const bouge = O.deplacer(this.carte,
      { sac: this.main.sac, case: this.main.case }, { sac, case: index });
    this.main = null;
    if (!bouge) { this.dire('Impossible de poser là.'); return; }
    this.changer();
  }

  /**
   * Cm.withdraw — on rend sa liberté à la fée.
   *
   * Le jeu demande confirmation (`attachChoice`) avant : on ne relâche pas une
   * compagne de quinze niveaux d'un doigt qui glisse. Et à partir du niveau 15,
   * elle laisse une étoile en souvenir.
   */
  liberer() {
    const fs = (this.carte.$faerie || [])[this.feeCourante];
    if (!fs) { this.dire('Aucune fée ne vous accompagne encore.'); return; }
    if (this.aConfirmer !== this.feeCourante) {
      this.aConfirmer = this.feeCourante;
      this.dire('Touchez encore pour rendre sa liberté à ' + fs.$name + '.', 'Êtes-vous sûr ?');
      return;
    }
    this.aConfirmer = null;
    let msg = fs.$name + ' est repartie au pays des fées ! ';
    if (nombre(fs.$level) >= 15) {
      msg += 'En souvenir de vos aventures, elle vous offre une étoile !';
      this.carte.$star = nombre(this.carte.$star) + 1;
    }
    // Une fée en bocal doit d'abord en sortir, sinon le bocal garderait un
    // occupant qui n'existe plus.
    fs.$pos = null;
    nuit().effacerFee(this.carte, fs);
    this.feeCourante = Math.max(0, Math.min(this.feeCourante,
      (this.carte.$faerie || []).length - 1));
    this.main = null;
    this.dire(msg);
    this.changer();
  }

  // Inventory.trash : ce qu'on jette ne revient pas.
  jeter() {
    if (!this.main) { this.dire('Prenez un objet, puis touchez la poubelle.'); return; }
    const it = this.objetA(this.main.sac, this.main.case);
    const liste = this.main.sac === 'joueur' ? this.carte.$inv
      : ((this.carte.$faerie || [])[this.main.sac] || {}).$inv;
    if (Array.isArray(liste)) liste[this.main.case] = null;
    this.main = null;
    this.dire(it ? (it.nom + ' jeté.') : '');
    this.changer();
  }

  // Inventory.giveItem : l'objet tenu est consommé sur la fée.
  donnerALaFee() {
    const fee = this.fee();
    if (!fee) { this.dire('Aucune fée ne vous accompagne encore.'); return; }
    if (!this.main) {
      // setFaerieFace : la regarder, c'est apprendre ce qu'elle aime — le jeu
      // met son nom en titre du bandeau et ses goûts en dessous.
      const g = fee.gouts();
      this.dire(g || 'Amenez un aliment ici pour la nourrir.', fee.fs.$name);
      return;
    }
    const it = this.objetA(this.main.sac, this.main.case);
    if (!it || !it.flUse) {
      this.dire((it ? it.nom : 'Cet objet') + ' ne se donne pas à manger.');
      return;
    }
    const r = O.donner(this.carte, { sac: this.main.sac, case: this.main.case }, fee);
    if (!r.ok) { this.dire(r.message); return; }

    // La fée vit dans la fiche : ce que `donner` a changé doit y retourner.
    const fs = (this.carte.$faerie || [])[this.feeCourante];
    fs.$life = fee.fs.$life; fs.$mana = fee.fs.$mana;
    fs.$hunger = fee.fs.$hunger; fs.$moral = fee.fs.$moral;

    this.main = null;
    let msg;
    if (r.effet.genre === 'repas') {
      msg = fee.fs.$name + (r.effet.moral > 0 ? ' se régale !'
        : r.effet.moral < 0 ? ' mange sans enthousiasme.' : ' mange.');
    } else {
      msg = fee.fs.$name + ' récupère ' + r.effet.gagne + ' cœur' + (r.effet.gagne > 1 ? 's' : '') + '.';
    }
    if (r.pictos.length) msg += ' Album : +' + r.pictos.length + ' !';
    this.dire(msg);
    this.changer();
  }

  dire(message, titre) {
    this.message = message || '';
    this.titre = titre || '';
    this.rendre();
  }

  changer() {
    this.rendre();
    if (this.surChangement) this.surChangement();
  }

  ouvrir() {
    this.main = null;
    // Inventory.mt s'ouvre sur la fée COURANTE (Cm.getCurrentFaerie lit
    // $faerie[$current]) — pas sur la première du bocal.
    const l = this.carte.$faerie || [];
    const c = nombre(this.carte.$current);
    this.feeCourante = (c >= 0 && c < l.length && l[c]) ? c : 0;
    this.redimensionner();
    this.dire('');
  }

  fermer() { if (this.surFermeture) this.surFermeture(); }
}

const API = { Inventaire, dessinObjet, INV_SHAPE, SLOT_SIZE, INV_WIDTH, INV_HEIGHT,
  SECTION, PANNEAU, EXTRA, BARRE, LETTRES };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
else racine.MinipixizInventaire = API;

})(typeof window !== 'undefined' ? window : globalThis);
