/*
 * Miniwave 2 — le menu, les écrans de choix et le stand.
 *
 * Dessinés sur le MÊME canevas 240 × 240 que le jeu, avec les mêmes dessins que
 * le SWF : le logo « mini2wave », les icônes du stand, les vignettes des modes
 * spéciaux, la pièce du compteur. Ils sont extraits du fichier d'origine
 * (scripts/extract-miniwave-sprites.js), pas redessinés.
 *
 * Tout vient des sources AS2, à la valeur près :
 *
 *   • le fond du menu est le rectangle #4a4a84 de miniWave2Menu ;
 *   • le logo se pose en (120, 24), la page occupe (10, 54) sur 220 × 186
 *     (Menu.margin = 10, Menu.marginUp = 54) ;
 *   • chaque encadré est un rectangle arrondi tracé à l'exécution — bordure de
 *     2 px, rayon min(w/2, h/2, 10) — en #BCBCDA bordé de blanc quand il est
 *     ouvert, en #8A8ABD bordé de #BCBCDA quand il est verrouillé (Box.init) ;
 *   • ils ARRIVENT en s'ouvrant depuis leur coin haut-gauche, décalés les uns
 *     des autres, et repartent en se refermant sur leur coin bas-droit
 *     (Box.tweenAll et Box.vanish). C'est l'animation qui donne au menu son
 *     allure ; sans elle, les mêmes couleurs paraissent mortes.
 *
 * Le module ne connaît ni le moteur ni le réseau : on lui passe la fiche du
 * joueur et un callback de lancement. C'est ce qui le rend testable.
 */
'use strict';

(function () {

const P = (typeof module !== 'undefined' && module.exports)
  ? require('./plateforme.js')
  : window.MiniwavePlateforme;

// ── Les mesures du jeu ────────────────────────────────────────────────────
const LARGEUR = 240, HAUTEUR = 240;
const MARGE = 10, MARGE_HAUT = 54;                    // Menu.margin / Menu.marginUp
const PAGE_L = LARGEUR - MARGE * 2;                   // 220
const PAGE_H = HAUTEUR - (MARGE + MARGE_HAUT);        // 186
const FOND = '#4a4a84';                               // le rectangle de miniWave2Menu
const OUVERT = { fond: '#BCBCDA', trait: '#FFFFFF' };
const FERME = { fond: '#8A8ABD', trait: '#BCBCDA' };
const ENCRE = '#2b2b52';                              // le texte sur les encadrés
const VITESSE_MAX = 8;                                // Box.speedMax
const COEF = 0.5;                                     // Box.speedCoef

// L'ordre du menu d'accueil, repris de page/Main.as. « Options » n'a pas de
// contenu à porter (le réglage du son est le bouton de la page) et « Time »
// n'existe pas dans le jeu livré : ni l'un ni l'autre n'apparaît.
const RUBRIQUES = [
  { id: 'arcade', nom: 'ARCADE', desc: 'Le grand parcours : 200 vagues et le boss.' },
  { id: 'bonus', nom: 'BONUS', desc: 'Les missions, courtes et primées.' },
  { id: 'special', nom: 'SPÉCIAL', desc: 'Letter Invader et Endurance.' },
  { id: 'stand', nom: 'STAND', desc: 'Vaisseaux, missions et pictos à acheter.' },
];

// SelectSpecial.select : deux modes portés sur les trois du jeu. Le troisième
// (« Time ») n'a pas de classe dans les sources — il n'a jamais été écrit.
const SPECIAUX = [
  { id: 'letter', nom: 'Letter Invader', index: 0,
    desc: 'On ne tire plus : on tape la lettre portée par chaque monstre.' },
  { id: 'survival', nom: 'Endurance', index: 1,
    desc: 'Les vagues tombent sans fin. Un seul vaisseau.' },
];

// ── Ce que la fiche autorise ──────────────────────────────────────────────

function entrees(carte, niveaux) {
  const ouverts = P.modesOuverts(carte);
  return {
    arcade: [{
      id: 'arcade', nom: 'Arcade', ouvert: true,
      detail: (carte.$arcade.$bestLevel > 0)
        ? ('meilleur : niveau ' + carte.$arcade.$bestLevel + ' · ' + carte.$arcade.$bestScore + ' pts')
        : 'jamais joué',
      lancement: {
        mode: 'arcade', niveaux: niveaux.main[0].levels,
        vies: niveaux.main[0].ship, nom: 'Arcade',
      },
    }],
    // Une mission n'est proposée que si elle a été achetée ET qu'elle existe :
    // $mode[1] compte huit cases, le jeu n'en a rempli que cinq.
    bonus: niveaux.bonus.map((p, i) => ({
      id: 'mission' + i, nom: p.name, ouvert: !!ouverts.missions[i],
      pourcent: carte.$cons.$bonus[i],
      detail: (carte.$cons.$bonus[i] > 0)
        ? (carte.$cons.$bonus[i] + ' % · prime ' + p.prime + ' ¤')
        : ('prime ' + p.prime + ' ¤'),
      pourAcheter: 'À acheter au stand.',
      lancement: {
        mode: 'mission', niveaux: p.levels, vies: p.ship,
        missionNum: i, prime: p.prime, nom: p.name,
      },
    })),
    special: SPECIAUX.map((s) => ({
      id: s.id, nom: s.nom, ouvert: !!ouverts[s.id], detail: s.desc, index: s.index,
      pourAcheter: 'À acheter au stand.',
      lancement: (s.id === 'letter')
        ? { mode: 'letter', niveaux: niveaux.letter[0].levels, vies: 1, nom: s.nom }
        : { mode: 'survival', niveaux: [], vies: 1, nom: s.nom },
    })),
  };
}

// SelectShip : on compose un escadron de `shipMax` vaisseaux, choisis un par un
// parmi ceux qu'on possède. C'est ce qui fait que l'ordre compte — on perd les
// vaisseaux dans l'ordre où on les a rangés.
function vaisseauxDisponibles(carte) {
  const l = [];
  for (let i = 0; i < P.NB_VAISSEAUX; i++) if (carte.$ship[i]) l.push(i);
  return l;
}

// Le rayon du stand, tel qu'il s'affiche. `ico` est l'image du clip d'origine :
// box/ShopSlot.as fait `ico.gotoAndStop(id + 1)`.
function rayon(carte) {
  return P.BOUTIQUE.map((a) => {
    const d = a.debloque;
    let ouvre = '';
    if (d.ship !== undefined) ouvre = 'vaisseau ' + P.VAISSEAUX[d.ship];
    else if (d.mission !== undefined) ouvre = 'mission ' + (d.mission + 1);
    else if (d.special !== undefined) ouvre = (d.special === 0 ? 'Letter Invader' : 'Endurance');
    else if (d.picto) ouvre = 'picto Frutiparc';
    return {
      id: a.id, nom: a.nom, prix: a.prix, ouvre, ico: a.id + 1,
      achete: P.estAchete(carte, a.id),
      abordable: carte.$credit >= a.prix,
    };
  });
}

// ── L'encadré (miniwave.Box) ──────────────────────────────────────────────
// Il s'ouvre depuis son coin haut-gauche jusqu'à sa taille, à vitesse
// proportionnelle à ce qui reste et plafonnée. C'est tout le ressort du menu.
class Boite {
  constructor(o) {
    Object.assign(this, o);
    this.x = this.gx; this.y = this.gy;
    this.w = 0; this.h = 0;
    this.timer = this.attente || 0;
    this.etape = 0;                    // 0 = attente, 1 = ouverture, 2 = posée
    this.flVanish = false;
    this.ouverte = false;
  }

  get couleurs() { return this.verrou ? FERME : OUVERT; }

  update(tmod) {
    if (this.etape === 0) {
      this.timer -= tmod;
      if (this.timer <= 0) this.etape = 1;
      return;
    }
    if (this.etape !== 1) return;
    const frict = Math.pow(COEF, tmod);
    let dif = 0;
    const vers = (v, g) => {
      const d = g - v;
      dif += Math.abs(d);
      return v + Math.min(Math.max(-VITESSE_MAX, d * (1 - frict)), VITESSE_MAX);
    };
    this.x = vers(this.x, this.gx);
    this.y = vers(this.y, this.gy);
    this.w = vers(this.w, this.gw);
    this.h = vers(this.h, this.gh);
    if (dif < 0.5) {
      this.x = this.gx; this.y = this.gy; this.w = this.gw; this.h = this.gh;
      this.etape = 2;
      // Box.tryToInitContent : le contenu n'apparaît qu'une fois l'encadré
      // ouvert, et pas du tout s'il est verrouillé.
      this.ouverte = !this.verrou;
      this.morte = this.flVanish;
    }
  }

  // Box.vanish : il se referme sur son coin bas-droit.
  disparaitre(attente) {
    this.timer = attente || 0;
    this.etape = 0;
    this.flVanish = true;
    this.ouverte = false;
    this.gx = (this.gx + this.gw) - 4;
    this.gy = (this.gy + this.gh) - 4;
    this.gw = 4; this.gh = 4;
  }

  // Box.updateDraw : rectangle arrondi, bordure de 2, rayon plafonné à 10.
  dessiner(ctx) {
    const c = this.couleurs;
    const r = Math.min(this.w / 2, this.h / 2, 10);
    ctx.beginPath();
    ctx.moveTo(this.x + r, this.y);
    ctx.arcTo(this.x + this.w, this.y, this.x + this.w, this.y + this.h, r);
    ctx.arcTo(this.x + this.w, this.y + this.h, this.x, this.y + this.h, r);
    ctx.arcTo(this.x, this.y + this.h, this.x, this.y, r);
    ctx.arcTo(this.x, this.y, this.x + this.w, this.y, r);
    ctx.closePath();
    ctx.fillStyle = c.fond;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = c.trait;
    ctx.stroke();
  }

  contient(x, y) {
    return this.etape === 2 && !this.flVanish
      && x >= this.x && x <= this.x + this.w && y >= this.y && y <= this.y + this.h;
  }
}

// ── L'interface ───────────────────────────────────────────────────────────
// Une page est une liste d'encadrés plus une façon de les remplir. On garde le
// découpage du jeu : Main, SelectLevel, SelectSpecial, SelectShip, Shop.
class Interface {
  /**
   * @param {object} o
   *   canvas    le canevas du jeu (240×240)
   *   sprites   le manifeste des dessins
   *   poser     (ctx, sprite, frame, x, y, echelle) — le poseur du client
   *   plateforme la fiche du joueur
   *   niveaux   levels.json
   *   surChoix  (lancement) → lance la partie
   *   surSon    (nom) → joue un son du menu
   */
  constructor(o) {
    this.canvas = o.canvas;
    this.ctx = this.canvas.getContext('2d');
    this.sprites = o.sprites;
    this.poser = o.poser;
    this.plateforme = o.plateforme;
    this.niveaux = o.niveaux;
    this.surChoix = o.surChoix || (() => {});
    this.surSon = o.surSon || (() => {});
    this.visible = false;
    this.boites = [];
    this.page = null;
    this.message = null;
    this.messageT = 0;
    this.escadron = null;
  }

  get carte() { return this.plateforme.carte; }

  ouvrir(page, arg) {
    if (this.page && this.boites.length) {
      // Page.vanish : tout se referme, en cascade, avant la page suivante.
      this.boites.forEach((b, i) => b.disparaitre(i * 4));
      this.suivante = { page, arg };
      this.visible = true;
      return;
    }
    this.poserPage(page, arg);
    this.visible = true;
  }

  poserPage(page, arg) {
    this.page = page;
    this.arg = arg;
    this.boites = [];
    this.suivante = null;
    this.surSon('page');
    const f = this['page' + page[0].toUpperCase() + page.slice(1)];
    if (f) f.call(this, arg);
  }

  fermer() { this.visible = false; }

  dire(texte) { this.message = texte; this.messageT = 120; }

  boite(o) {
    const b = new Boite(o);
    this.boites.push(b);
    return b;
  }

  // ── Les pages ──

  // page/Main.as : quatre rubriques à gauche, la description à droite.
  pageAccueil() {
    let y = 0;
    RUBRIQUES.forEach((r, i) => {
      this.boite({
        gx: 0, gy: y, gw: 100, gh: 20, attente: i * 8,
        texte: r.nom, action: { rubrique: r.id }, info: r.desc,
      });
      y += 30;
      // Le jeu pousse les deux dernières rubriques en bas de page.
      if (i === 1) y += PAGE_H - (RUBRIQUES.length * 30 - 10);
    });
    const c = this.carte;
    this.boite({
      gx: 110, gy: 0, gw: 110, gh: PAGE_H, attente: 0, statique: true,
      lignes: [P.GRADES[P.grade(c)], c.$credit + ' crédits', '',
        'record arcade', c.$arcade.$bestLevel ? ('niv. ' + c.$arcade.$bestLevel) : '—'],
    });
  }

  // page/SelectLevel.as : un titre par mission, et son pourcentage à droite.
  pageMissions() {
    const l = entrees(this.carte, this.niveaux).bonus;
    l.forEach((m, i) => {
      this.boite({
        gx: 0, gy: 23 * i, gw: PAGE_L - 56, gh: 18, attente: 4 * i,
        texte: m.nom, verrou: !m.ouvert,
        action: m.ouvert ? { lancer: m.lancement } : { refus: m.pourAcheter },
        info: m.ouvert ? m.detail : m.pourAcheter,
      });
      this.boite({
        gx: PAGE_L - 50, gy: 23 * i, gw: 50, gh: 18, attente: 20 + 4 * i,
        verrou: !m.ouvert, statique: true,
        texte: m.ouvert ? (m.pourcent + '%') : '',
      });
    });
    this.retour(0, PAGE_H - 20);
  }

  // page/SelectSpecial.as : deux grandes vignettes.
  pageSpeciaux() {
    const l = entrees(this.carte, this.niveaux).special;
    const m = 6, h = (PAGE_H - 22 - m * (l.length - 1)) / l.length;
    l.forEach((s, i) => {
      this.boite({
        gx: 0, gy: (h + m) * i, gw: PAGE_L, gh: h, attente: 8 * i,
        texte: s.nom, verrou: !s.ouvert, vignette: s.index + 1,
        action: s.ouvert ? { lancer: s.lancement } : { refus: s.pourAcheter },
        info: s.ouvert ? s.detail : s.pourAcheter,
      });
    });
    this.retour(0, PAGE_H - 20);
  }

  // page/SelectShip.as : on choisit son escadron, un vaisseau à la fois.
  pageEscadron(lancement) {
    if (!this.escadron || this.escadron.lancement !== lancement) {
      this.escadron = { lancement, choix: [] };
    }
    const dispo = vaisseauxDisponibles(this.carte);
    const max = dispo.length;
    const w = (PAGE_L - (max - 1) * 8) / max;
    dispo.forEach((n, i) => {
      this.boite({
        gx: i * (w + 8), gy: 0, gw: w, gh: PAGE_H - 28, attente: i * 8,
        vaisseau: n, texte: P.VAISSEAUX[n], action: { vaisseau: n },
        info: P.VAISSEAUX[n],
      });
    });
    // Le bandeau du bas : le décompte à gauche, l'escadron composé à droite.
    // Les deux se relisent à chaque image — SelectShip.select ne redessine pas
    // la page à chaque choix, il ne fait qu'ajouter une vie au panneau.
    this.boite({
      gx: 0, gy: PAGE_H - 20, gw: PAGE_L - 100, gh: 20, attente: 16, compteur: true,
    });
    this.boite({
      gx: PAGE_L - 96, gy: PAGE_H - 20, gw: 96, gh: 20, attente: 24,
      escadronChoisi: true, action: { rubrique: 'accueil' }, texte: '',
    });
  }

  // page/Shop.as : la grille cinq par trois, le compteur et le retour.
  pageStand() {
    const m = 5, lowHeight = 20;
    const w = (PAGE_L - (5 - 1) * m) / 5;
    const h = (PAGE_H - ((3 - 1) * m + lowHeight + 7)) / 3;
    const r = rayon(this.carte);
    // Shop.initBox : les emplacements 5 et 6 laissent place aux missions 4 et 5
    // une fois les premières achetées — la grille ne s'allonge pas.
    const visible = [];
    for (let i = 0; i < 15; i++) {
      let id = i;
      if (i === 5 && this.carte.$mode[1][0]) id = 15;
      if (i === 6 && this.carte.$mode[1][1]) id = 16;
      visible.push(r.find((a) => a.id === id) || null);
    }
    let n = 0;
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 5; x++, n++) {
        const a = visible[n];
        if (!a) continue;
        this.boite({
          gx: x * (w + m), gy: y * (h + m), gw: w, gh: h, attente: n * 3,
          article: a, verrou: a.achete,
          action: a.achete ? { refus: 'Déjà acquis.' } : { acheter: a.id },
          info: a.nom + ' — ' + a.ouvre + (a.achete ? ' (acquis)' : ' — ' + a.prix + ' ¤'),
        });
      }
    }
    this.boite({
      gx: 0, gy: PAGE_H - lowHeight, gw: PAGE_L - 105, gh: lowHeight,
      attente: 15, statique: true, credits: true,
    });
    this.retour(PAGE_L - 100, PAGE_H - lowHeight, 35);
  }

  retour(gx, gy, attente) {
    this.boite({
      gx, gy, gw: 100, gh: 20, attente: attente === undefined ? 20 : attente,
      texte: 'RETOUR', action: { rubrique: 'accueil' },
    });
  }

  // ── Interaction ──
  auClic(px, py) {
    if (!this.visible) return false;
    const x = px - MARGE, y = py - MARGE_HAUT;
    for (const b of this.boites) {
      if (!b.contient(x, y) || !b.action) continue;
      this.agir(b.action);
      return true;
    }
    return false;
  }

  agir(a) {
    if (a.refus) { this.surSon('refus'); this.dire(a.refus); return; }
    this.surSon('clic');
    if (a.rubrique) return this.choisirRubrique(a.rubrique);
    if (a.lancer) return this.preparer(a.lancer);
    if (a.vaisseau !== undefined) return this.choisirVaisseau(a.vaisseau);
    if (a.acheter !== undefined) return this.acheter(a.acheter);
  }

  choisirRubrique(id) {
    if (id === 'accueil') return this.ouvrir('accueil');
    if (id === 'arcade') return this.preparer(entrees(this.carte, this.niveaux).arcade[0].lancement);
    if (id === 'bonus') return this.ouvrir('missions');
    if (id === 'special') return this.ouvrir('speciaux');
    if (id === 'stand') return this.ouvrir('stand');
  }

  // Les modes à une seule vie se passent de l'écran d'escadron : il n'y a rien
  // à composer. Un joueur qui n'a qu'un vaisseau non plus.
  preparer(lancement) {
    const dispo = vaisseauxDisponibles(this.carte);
    if (lancement.vies <= 1 || dispo.length === 1) {
      const escadron = [];
      for (let i = 0; i < lancement.vies; i++) escadron.push(dispo[0] || 0);
      return this.lancer(lancement, escadron);
    }
    this.escadron = { lancement, choix: [] };
    this.ouvrir('escadron', lancement);
  }

  choisirVaisseau(n) {
    const e = this.escadron;
    if (!e) return;
    e.choix.push(n);
    if (e.choix.length >= e.lancement.vies) return this.lancer(e.lancement, e.choix.slice());
    // Rien d'autre à faire : le décompte et l'escadron se relisent à l'image
    // suivante. Redessiner la page rejouerait toute l'ouverture des encadrés,
    // et le joueur attendrait entre chaque choix.
  }

  lancer(lancement, escadron) {
    this.escadron = null;
    this.fermer();
    this.surChoix(lancement, escadron);
  }

  acheter(id) {
    this.plateforme.acheter(id).then((r) => {
      if (!r.ok) {
        this.surSon('refus');
        this.dire(r.raison === 'credit' ? ('Il manque ' + r.manque + ' ¤') : 'Déjà acquis.');
        return;
      }
      this.surSon('achat');
      this.dire(r.article.nom + ' acheté !');
      this.poserPage('stand');
    });
  }

  // ── Boucle ──
  update(tmod) {
    if (!this.visible) return;
    for (const b of this.boites) b.update(tmod);
    this.boites = this.boites.filter((b) => !b.morte);
    if (this.suivante && this.boites.length === 0) {
      const s = this.suivante;
      this.suivante = null;
      this.poserPage(s.page, s.arg);
    }
    if (this.messageT > 0) { this.messageT -= tmod; if (this.messageT <= 0) this.message = null; }
  }

  dessiner(tmod) {
    if (!this.visible) return;
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const dpr = this.canvas.width / LARGEUR;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = FOND;
    ctx.fillRect(0, 0, LARGEUR, HAUTEUR);
    this.poser(ctx, this.sprites.titre, 1, LARGEUR / 2, 24);

    ctx.save();
    ctx.translate(MARGE, MARGE_HAUT);
    for (const b of this.boites) {
      b.dessiner(ctx);
      if (b.ouverte) this.contenu(ctx, b);
    }
    ctx.restore();

    // Le bandeau s'affiche SOUS le logo, pas en bas : la dernière rangée du
    // stand porte le compteur de crédits et le retour, qu'il masquerait au
    // moment précis où le joueur veut les lire.
    if (this.message) {
      ctx.font = '8px Verdana, Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const l = ctx.measureText(this.message).width + 12;
      ctx.fillStyle = 'rgba(20,20,45,.92)';
      ctx.fillRect((LARGEUR - l) / 2, MARGE_HAUT - 16, l, 15);
      ctx.fillStyle = '#ffd76a';
      ctx.fillText(this.message, LARGEUR / 2, MARGE_HAUT - 8);
      ctx.textAlign = 'left';
    }
  }

  // Le contenu d'un encadré, une fois qu'il s'est ouvert.
  contenu(ctx, b) {
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillStyle = ENCRE;

    if (b.article) {
      // box/ShopSlot : le prix en haut, l'icône au centre. Les trois smileys
      // (10 à 12) gardent leur taille d'origine, les autres remplissent la case.
      const a = b.article;
      ctx.font = '7px Verdana, Arial, sans-serif';
      ctx.fillText(a.achete ? 'acquis' : (a.prix + ' ¤'), b.x + b.w / 2, b.y + 6);
      const sp = this.sprites.shopIco;
      const etat = sp && sp.etats.find((e) => e.frame === a.ico);
      if (etat) {
        const petit = (a.id >= 10 && a.id <= 12);
        const taille = Math.max(...etat.pieces.map((p) => Math.max(p.w, p.h)));
        const k = petit ? 1 : (b.gw - 10) / taille;
        ctx.save();
        if (a.achete) ctx.globalAlpha = 0.45;
        this.poser(ctx, sp, a.ico, b.x + b.w / 2, b.y + b.h / 2 + 3, k);
        ctx.restore();
      }
      return;
    }

    if (b.credits) {
      // box/Credit : le solde, la pièce juste après.
      ctx.font = 'bold 9px Verdana, Arial, sans-serif';
      const t = String(this.carte.$credit);
      const l = ctx.measureText(t).width;
      ctx.textAlign = 'left';
      ctx.fillText(t, b.x + b.w / 2 - l / 2 - 5, b.y + b.h / 2);
      // La pièce tourne sur deux images : la première la montre par la tranche
      // (un simple trait), la seconde de face. C'est celle-là qu'on veut.
      this.poser(ctx, this.sprites.piece, 2, b.x + b.w / 2 + l / 2 + 4, b.y + b.h / 2, 0.8);
      ctx.textAlign = 'center';
      return;
    }

    if (b.vaisseau !== undefined) {
      this.poser(ctx, this.sprites['hero' + b.vaisseau], 1, b.x + b.w / 2, b.y + b.h / 2 - 6, 1.6);
      ctx.font = '7px Verdana, Arial, sans-serif';
      ctx.fillText(b.texte, b.x + b.w / 2, b.y + b.h - 8);
      return;
    }

    if (b.compteur) {
      const e = this.escadron;
      ctx.font = 'bold 9px Verdana, Arial, sans-serif';
      ctx.fillText('escadron ' + (e ? e.choix.length : 0) + '/' + (e ? e.lancement.vies : 0),
        b.x + b.w / 2, b.y + b.h / 2);
      return;
    }

    if (b.escadronChoisi) {
      const e = this.escadron;
      const n = e ? e.lancement.vies : 0;
      for (let i = 0; i < n; i++) {
        const x = b.x + 10 + i * 16;
        if (e.choix[i] === undefined) {
          ctx.fillStyle = '#8A8ABD';
          ctx.beginPath();
          ctx.arc(x, b.y + b.h / 2, 3, 0, 6.28);
          ctx.fill();
        } else {
          this.poser(ctx, this.sprites['hero' + e.choix[i]], 1, x, b.y + b.h / 2, 0.7);
        }
      }
      return;
    }

    if (b.vignette) {
      // box/Special : la vignette du mode, rognée aux coins de l'encadré.
      const sp = this.sprites.specialIco;
      ctx.save();
      const r = Math.min(b.w / 2, b.h / 2, 10) - 2;
      ctx.beginPath();
      ctx.moveTo(b.x + 4 + r, b.y + 4);
      ctx.arcTo(b.x + b.w - 4, b.y + 4, b.x + b.w - 4, b.y + b.h - 4, r);
      ctx.arcTo(b.x + b.w - 4, b.y + b.h - 4, b.x + 4, b.y + b.h - 4, r);
      ctx.arcTo(b.x + 4, b.y + b.h - 4, b.x + 4, b.y + 4, r);
      ctx.arcTo(b.x + 4, b.y + 4, b.x + b.w - 4, b.y + 4, r);
      ctx.clip();
      this.poser(ctx, sp, b.vignette, b.x + b.w / 2, b.y + b.h / 2, (b.w - 8) / 242);
      ctx.restore();
      ctx.font = 'bold 9px Verdana, Arial, sans-serif';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,.7)';
      ctx.strokeText(b.texte, b.x + b.w / 2, b.y + b.h - 10);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(b.texte, b.x + b.w / 2, b.y + b.h - 10);
      return;
    }

    if (b.lignes) {
      ctx.font = '8px Verdana, Arial, sans-serif';
      b.lignes.forEach((t, i) => {
        ctx.fillText(t, b.x + b.w / 2, b.y + 14 + i * 12);
      });
      return;
    }

    if (b.texte) {
      ctx.font = 'bold 9px Verdana, Arial, sans-serif';
      ctx.fillText(b.texte, b.x + b.w / 2, b.y + b.h / 2);
    }
  }
}

const API = { RUBRIQUES, SPECIAUX, entrees, vaisseauxDisponibles, rayon, Boite, Interface,
  LARGEUR, HAUTEUR, MARGE, MARGE_HAUT, PAGE_L, PAGE_H, FOND, OUVERT, FERME };

if (typeof module !== 'undefined' && module.exports) module.exports = API;
else window.MiniwaveMenu = API;

})();
