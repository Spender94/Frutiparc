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
 *   • le logo se pose en (120, 24), la page occupe (10, 54) sur 220 × 176
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
const PAGE_H = HAUTEUR - (MARGE + MARGE_HAUT);        // 176
const FOND = '#4a4a84';                               // le rectangle de miniWave2Menu
const OUVERT = { fond: '#BCBCDA', trait: '#FFFFFF' };
const FERME = { fond: '#8A8ABD', trait: '#BCBCDA' };
// box/Menu.setActive : l'encadré survolé fonce d'un cran. Et box/ShipDemo et
// box/Life se posent d'emblée sur ce ton sombre — ce sont des vitrines, pas des
// boutons, et le jeu les distingue par la couleur.
const SURVOL = { fond: '#A0A0CB', trait: '#FFFFFF' };
const VITRINE = { fond: '#8A8ABD', trait: '#FFFFFF' };
const ENCRE = '#4e5387';                              // l'encre du SWF (verdana2 #4e5387)
const VITESSE_MAX = 8;                                // Box.speedMax
const COEF = 0.5;                                     // Box.speedCoef

// L'ordre du menu d'accueil, repris de page/Main.as. « Options » n'a pas de
// contenu à porter (le réglage du son est le bouton de la page) et « Time »
// n'existe pas dans le jeu livré : ni l'un ni l'autre n'apparaît.
// `illus` est l'image du panneau de droite (box/InfoMain.setIllus) : une par
// rubrique, plus celle de l'accueil. Le titre et le texte sont ceux du jeu.
const RUBRIQUES = [
  { id: 'arcade', nom: 'ARCADE', illus: 2, titre: 'action',
    desc: 'Repoussez les fruits mutants au confin du Frunivers et gagnez des Crédits.' },
  { id: 'bonus', nom: 'BONUS', illus: 3, titre: 'missions',
    desc: 'Débloquez et validez les 8 missions du mode bonus.' },
  // « SPECIAL » sans accent, comme page/Main.as — et la Jawbreaker n'a pas le É.
  { id: 'special', nom: 'SPECIAL', illus: 4, titre: 'secret?',
    desc: 'Decouvrez les projets les plus secrets de la mini-airforce.' },
  { id: 'stand', nom: 'STAND', illus: 5, titre: 'achats',
    desc: 'Dépensez vos crédits et améliorez votre arsenal.' },
];

/*
 * La GRILLE du menu d'accueil, telle que page/Main.as la pose.
 *
 * Cinq rangées de trente pixels, mais pas d'affilée : après la TROISIÈME
 * (`if(i==2)`), le jeu saute `height - (5*30 - 10)` — les deux dernières
 * rubriques tombent au bas de la page. Le portage sautait après la DEUXIÈME, ce
 * qui poussait SPECIAL en bas avec STAND et laissait un trou au milieu.
 *
 * Il nous manque OPTION, la cinquième : son écran (page/Option.as) n'est pas
 * porté. On garde la grille d'origine et on met STAND sur la DERNIÈRE rangée,
 * pour que le groupe du bas reste calé sur le bas de page comme dans le jeu.
 */
function grilleAccueil(hauteur) {
  const y = [];
  let v = 0;
  for (let i = 0; i < 5; i++) {
    y.push(v);
    v += 30;
    if (i === 2) v += hauteur - (5 * 30 - 10);
  }
  return [y[0], y[1], y[2], y[4]];
}

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

  get couleurs() {
    if (this.verrou) return FERME;
    if (this.survole && !this.statique) return SURVOL;
    // Les VITRINES (les alvéoles de l'escadron, le panneau des vies) naissent
    // déjà sur le ton sombre : box/ShipDemo et box/Life posent colBack à
    // 0x8A8ABD dès leur init.
    return this.vitrine ? VITRINE : OUVERT;
  }

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
    const y = grilleAccueil(PAGE_H);
    RUBRIQUES.forEach((r, i) => {
      this.boite({
        // box/Menu : cent sur vingt, toujours.
        gx: 0, gy: y[i], gw: 100, gh: 20, attente: i * 8,
        texte: r.nom, action: { rubrique: r.id }, rubrique: i,
      });
    });
    // box/InfoMain : le panneau de droite. Il s'ouvre sur « bienvenue » et suit
    // le survol des rubriques.
    this.boite({
      gx: 110, gy: 0, gw: 110, gh: PAGE_H, attente: 0, statique: true, info: true,
    });
    this.infoPage = 0;
    this.infoT = 0;
  }

  /**
   * box/InfoMain.setPage — ce que le panneau raconte, selon la rubrique survolée.
   * L'image 0 est l'accueil : le salut au joueur, avec son grade.
   */
  infoContenu() {
    if (this.infoPage > 0) {
      const r = RUBRIQUES[this.infoPage - 1];
      return r ? { titre: r.titre, texte: r.desc, illus: r.illus } : null;
    }
    const c = this.carte;
    const h = new Date().getHours();
    const bonjour = (h > 5 && h < 16) ? 'Bonjour ' : 'Bonsoir ';
    // Le jeu affiche `grade + " " + client.getUser()`. Sans nom de joueur, le
    // SWF écrivait « Chef d'escadre undefined » — on s'arrête au grade.
    const nom = this.plateforme && this.plateforme.pseudo;
    return {
      titre: 'bienvenue', illus: 1,
      texte: bonjour + P.GRADES[P.grade(c)] + (nom ? ' ' + nom : '')
        + ', choisissez votre section.',
    };
  }

  // page/SelectLevel.as : un titre par mission, et son pourcentage à droite.
  // Pas de bouton retour : la bannière du haut ramène à l'accueil.
  pageMissions() {
    const l = entrees(this.carte, this.niveaux).bonus;
    l.forEach((m, i) => {
      this.boite({
        gx: 0, gy: 23 * i, gw: PAGE_L - 56, gh: 18, attente: 4 * i,
        titreMission: m.nom, verrou: !m.ouvert,
        action: m.ouvert ? { lancer: m.lancement } : { refus: m.pourAcheter },
      });
      // box/Pourcentage : cinquante sur dix-huit, avec sa jauge derrière le
      // texte (`bar._xscale = ratio`).
      this.boite({
        gx: PAGE_L - 50, gy: 23 * i, gw: 50, gh: 18, attente: 20 + 4 * i,
        verrou: !m.ouvert, statique: true,
        pourcent: m.ouvert ? m.pourcent : null,
      });
    });
  }

  // page/SelectSpecial.as : trois grandes vignettes, une par case de $mode[2].
  // La troisième (« Time ») n'a jamais eu de jeu derrière — dans le SWF non
  // plus : elle reste là, verrouillée, parce que c'est ce qu'on voit à l'écran.
  pageSpeciaux() {
    const l = entrees(this.carte, this.niveaux).special;
    const max = 3, m = 6, h = (PAGE_H - m * (max - 1)) / max;
    for (let i = 0; i < max; i++) {
      const s = l[i];
      this.boite({
        gx: 0, gy: (h + m) * i, gw: PAGE_L, gh: h, attente: 8 * i,
        verrou: !(s && s.ouvert), vignette: i + 1,
        action: (s && s.ouvert) ? { lancer: s.lancement }
          : { refus: s ? s.pourAcheter : 'Ce mode n\'a jamais vu le jour.' },
      });
    }
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
        // Les vitrines s'arrêtent au-dessus du bandeau : `height-(lowHeight+8)`.
        gx: i * (w + 8), gy: 0, gw: w, gh: PAGE_H - 28, attente: i * 8,
        vaisseau: n, action: { vaisseau: n }, vitrine: true, etoiles: [],
      });
    });
    // Le bandeau du bas, aux mesures de SelectShip.initBox : la plaque de
    // description à gauche, le panneau d'escadron à droite.
    const wd = PAGE_L - (20 + lancement.vies * 16);
    this.boite({
      gx: 0, gy: PAGE_H - 20, gw: wd, gh: 20, attente: 16, statique: true,
      descVaisseau: true,
    });
    this.boite({
      gx: 8 + wd, gy: PAGE_H - 20, gw: PAGE_L - (8 + wd), gh: 20, attente: 24,
      statique: true, vitrine: true, escadronChoisi: true,
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
      gx: 0, gy: PAGE_H - lowHeight, gw: PAGE_L, gh: lowHeight,
      attente: 15, statique: true, credits: true,
    });
  }

  // ── Interaction ──
  //
  // Menu.init : `this.title.onPress = … mng.backToMenu()`. LA BANNIÈRE EST LE
  // BOUTON RETOUR — le jeu n'en a pas d'autre, et aucune page ne porte de
  // « RETOUR ». On lui donne donc toute la bande du haut.
  auClic(px, py) {
    if (!this.visible) return false;
    if (py < MARGE_HAUT) {
      if (this.page !== 'accueil') { this.surSon('clic'); this.ouvrir('accueil'); }
      return true;
    }
    const x = px - MARGE, y = py - MARGE_HAUT;
    for (const b of this.boites) {
      if (!b.contient(x, y) || !b.action) continue;
      this.agir(b.action);
      return true;
    }
    return false;
  }

  /**
   * Le SURVOL. Le jeu s'en sert partout : l'encadré du menu fonce (box/Menu
   * .setActive), le panneau d'accueil change de page (page/Main.rOver), et la
   * plaque de l'escadron affiche le nom du vaisseau visé (SelectShip.rOver).
   * Sans lui, le portage restait muet — d'où le panneau figé et les noms de
   * vaisseaux écrits en dur sous chaque vitrine.
   */
  auSurvol(px, py) {
    if (!this.visible) return;
    const x = px - MARGE, y = py - MARGE_HAUT;
    let vu = null;
    for (const b of this.boites) {
      b.survole = false;
      if (b.contient(x, y) && b.action) vu = b;
    }
    if (vu) vu.survole = true;
    this.survol = vu;
    // page/Main.rOver / rOut : le panneau suit la rubrique visée, et revient à
    // l'accueil dès qu'on en sort.
    if (this.page === 'accueil') {
      const n = (vu && vu.rubrique !== undefined) ? vu.rubrique + 1 : 0;
      if (n !== this.infoPage) { this.infoPage = n; this.infoT = 0; }
    }
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
    // box/ShipDemo.select : après un choix, le bouton du vaisseau disparaît —
    // SAUF pour le basique (id 0), que le jeu ré-attache aussitôt. Un escadron
    // ne compte donc jamais deux fois le même vaisseau, hormis l'aliquet.
    if (n !== 0 && e.choix.indexOf(n) >= 0) {
      this.surSon('refus');
      this.dire('Un seul ' + (P.VAISSEAUX[n] || 'vaisseau') + ' par escadron !');
      return;
    }
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
      if (b.ouverte) this.contenu(ctx, b, tmod);
    }
    ctx.restore();

    // Le bandeau s'affiche SOUS le logo, pas en bas : la dernière rangée du
    // stand porte le compteur de crédits et le retour, qu'il masquerait au
    // moment précis où le joueur veut les lire.
    if (this.message) {
      ctx.font = '10px VerdanaPix, Verdana, sans-serif';
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

  /**
   * box/ShipDemo.updateStars — la pluie d'étoiles au fond de chaque alvéole.
   *
   * Des traits blancs verticaux qui tombent, à demi transparents, régénérés
   * tant qu'il en manque. C'est ce qui donne aux vitrines leur profondeur ; sans
   * elles, les alvéoles sont des rectangles morts.
   */
  etoiles(ctx, b, tmod) {
    const t = (tmod === undefined || !(tmod > 0)) ? 1 : tmod;
    const max = 40 / (this.boites.filter((x) => x.vaisseau !== undefined).length || 1);
    if (t < 1.3 && b.etoiles.length < max) {
      b.etoiles.push({ x: Math.random() * b.gw, y: 0, s: 8 + Math.random() * 80 });
    }
    ctx.save();
    ctx.beginPath();
    const r = Math.min(b.w / 2, b.h / 2, 10);
    ctx.moveTo(b.x + r, b.y);
    ctx.arcTo(b.x + b.w, b.y, b.x + b.w, b.y + b.h, r);
    ctx.arcTo(b.x + b.w, b.y + b.h, b.x, b.y + b.h, r);
    ctx.arcTo(b.x, b.y + b.h, b.x, b.y, r);
    ctx.arcTo(b.x, b.y, b.x + b.w, b.y, r);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < b.etoiles.length; i++) {
      const o = b.etoiles[i];
      const sp = o.s * t;
      const h = sp * 3;
      o.y += sp;
      if (o.y - h > b.gh) { b.etoiles.splice(i, 1); i--; continue; }
      ctx.moveTo(b.x + o.x, b.y + o.y);
      ctx.lineTo(b.x + o.x, b.y + o.y - h);
    }
    ctx.stroke();
    ctx.restore();
  }

  /**
   * box/InfoMain — le panneau de droite de l'accueil.
   *
   * Trois étages : le TITRE de la rubrique, son ILLUSTRATION, puis le TEXTE qui
   * s'écrit lettre à lettre (`mainTxtIndex += tmod`, avec un souligné tant qu'il
   * reste à taper) et se cale verticalement dans ce qui reste sous les
   * quatre-vingt-quatorze premiers pixels.
   *
   * Le portage n'affichait qu'une liste figée — grade, crédits, record —, sans
   * titre ni image. C'était lisible, mais ce n'était pas le jeu.
   */
  panneauInfo(ctx, b, tmod) {
    const info = this.infoContenu();
    if (!info) return;
    this.infoT += (tmod === undefined ? 1 : tmod);

    // Le titre. Les sources l'écrivent en bas de casse (« bienvenue ») mais le
    // champ du SWF le rend avec une capitale : c'est le RENDU qu'on reproduit,
    // dans la police proportionnelle du jeu et non la pixel — celle-ci n'a que
    // des capitales et donnerait un titre en criant.
    ctx.font = '10px VerdanaPix, Verdana, sans-serif';
    ctx.fillStyle = ENCRE;
    ctx.textAlign = 'center';
    ctx.fillText(info.titre.charAt(0).toUpperCase() + info.titre.slice(1),
      b.x + b.w / 2, b.y + 10);

    // L'illustration : 96 × 76, centrée sous le titre.
    const sp = this.sprites.illus;
    if (sp && info.illus) {
      this.poser(ctx, sp, info.illus, b.x + (b.w - 96) / 2, b.y + 20, 1);
    }

    // Le texte, tapé au fil des images puis centré dans le bas du panneau.
    const HAUT_TEXTE = 94;
    const n = Math.round(this.infoT);
    let texte = info.texte.slice(0, n);
    if (n < info.texte.length) texte += '_';
    ctx.font = '10px VerdanaPix, Verdana, sans-serif';
    const lignes = this.decouper(ctx, texte, b.w - 10);
    const hb = b.h - HAUT_TEXTE;
    let y = b.y + HAUT_TEXTE + Math.max(0, (hb - lignes.length * 11)) / 2 + 6;
    for (const l of lignes) {
      ctx.fillText(l, b.x + b.w / 2, y);
      y += 11;
    }
  }

  // Coupe un texte aux mots pour tenir dans `large`.
  decouper(ctx, texte, large) {
    const out = [];
    let courante = '';
    for (const mot of String(texte).split(' ')) {
      const essai = courante ? courante + ' ' + mot : mot;
      if (courante && ctx.measureText(essai).width > large) {
        out.push(courante);
        courante = mot;
      } else {
        courante = essai;
      }
    }
    if (courante) out.push(courante);
    return out;
  }

  // Le contenu d'un encadré, une fois qu'il s'est ouvert.
  contenu(ctx, b, tmod) {
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillStyle = ENCRE;

    if (b.article) {
      // box/ShopSlot : le prix en haut, l'icône au centre. Les trois smileys
      // (10 à 12) gardent leur taille d'origine, les autres remplissent la case.
      const a = b.article;
      ctx.font = '14px Jawbreaker, Verdana, sans-serif';
      ctx.fillText(a.achete ? 'acquis' : String(a.prix), b.x + b.w / 2, b.y + 8);
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
      ctx.font = '14px Jawbreaker, Verdana, sans-serif';
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
      /*
       * box/ShipDemo — la vitrine d'un vaisseau.
       *
       * Deux choses que le portage avait perdues : le vaisseau est posé À SA
       * TAILLE (attachHero ne met aucune échelle) et il se tient DOUZE PIXELS
       * AU-DESSUS DU BAS de l'alvéole (`mc.y = this.gh-12`), pas au milieu. Et
       * son nom ne s'écrit pas ici — il apparaît sur la plaque du bas quand on
       * le survole (SelectShip.rOver).
       */
      const enrole = this.escadron && b.vaisseau !== 0
        && this.escadron.choix.indexOf(b.vaisseau) >= 0;
      this.etoiles(ctx, b, tmod);
      if (enrole) ctx.globalAlpha = 0.25;
      this.poser(ctx, this.sprites['hero' + b.vaisseau], 1, b.x + b.w / 2, b.y + b.h - 12, 1);
      if (enrole) ctx.globalAlpha = 1;
      return;
    }

    if (b.descVaisseau) {
      // box/Desc : deux lignes. Le nom du vaisseau visé, ou le libellé du mode.
      const v = this.survol && this.survol.vaisseau;
      if (v !== undefined && v !== null && v !== false) {
        ctx.font = '14px Jawbreaker, Verdana, sans-serif';
        ctx.fillText(P.VAISSEAUX[v] || '', b.x + b.w / 2, b.y + b.h / 2 + 0.5);
      } else {
        ctx.font = '10px VerdanaPix, Verdana, sans-serif';
        ctx.fillText('escadron selection', b.x + b.w / 2, b.y + b.h / 2 + 0.5);
      }
      return;
    }

    if (b.escadronChoisi) {
      // box/Life : les vaisseaux enrôlés, alignés DEPUIS LA DROITE (le panneau
      // se pose en `gw-6`) et à la taille 12.
      const e = this.escadron;
      if (!e) return;
      for (let i = 0; i < e.choix.length; i++) {
        this.poser(ctx, this.sprites['hero' + e.choix[i]], 1,
          b.x + b.w - 10 - i * 14, b.y + b.h / 2, 0.75);
      }
      return;
    }

    if (b.vignette) {
      /*
       * box/Special — l'illustration REMPLIT l'encadré.
       *
       * Le dessin fait 242 × 56 et s'accroche au COIN de la boîte, sans échelle,
       * découpé par un masque en retrait de quatre pixels. Le portage le posait
       * centré et réduit : on n'en voyait qu'une vignette collée en bas à
       * droite, avec le nom du mode écrit par-dessus. Le jeu, lui, n'écrit rien
       * — l'image dit tout.
       */
      const sp = this.sprites.specialIco;
      ctx.save();
      const is = 4;
      const r = Math.max(0, Math.min((b.w - is * 2) / 2, (b.h - is * 2) / 2, 10 - is));
      ctx.beginPath();
      ctx.moveTo(b.x + is + r, b.y + is);
      ctx.arcTo(b.x + b.w - is, b.y + is, b.x + b.w - is, b.y + b.h - is, r);
      ctx.arcTo(b.x + b.w - is, b.y + b.h - is, b.x + is, b.y + b.h - is, r);
      ctx.arcTo(b.x + is, b.y + b.h - is, b.x + is, b.y + is, r);
      ctx.arcTo(b.x + is, b.y + is, b.x + b.w - is, b.y + is, r);
      ctx.clip();
      this.poser(ctx, sp, b.vignette, b.x, b.y, 1);
      ctx.restore();
      return;
    }

    if (b.titreMission) {
      // box/LevelTitle : le nom de la mission, dans la police PROPORTIONNELLE
      // du jeu et sa casse d'origine — « Fruit d'artifice », pas « FRUIT
      // D'ARTIFICE ». La Jawbreaker n'a que des capitales et coupait les titres
      // longs.
      ctx.font = '11px VerdanaPix, Verdana, sans-serif';
      ctx.fillText(b.titreMission, b.x + b.w / 2, b.y + b.h / 2 + 0.5);
      return;
    }

    if (b.pourcent !== undefined) {
      // box/Pourcentage : une jauge derrière (`bar._xscale = ratio`), le chiffre
      // devant. Rien du tout si la mission n'est pas ouverte.
      if (b.pourcent === null) return;
      const p = Math.max(0, Math.min(100, Number(b.pourcent) || 0));
      if (p > 0) {
        ctx.save();
        ctx.beginPath();
        const r = Math.min(b.w / 2, b.h / 2, 10);
        ctx.moveTo(b.x + r, b.y);
        ctx.arcTo(b.x + b.w, b.y, b.x + b.w, b.y + b.h, r);
        ctx.arcTo(b.x + b.w, b.y + b.h, b.x, b.y + b.h, r);
        ctx.arcTo(b.x, b.y + b.h, b.x, b.y, r);
        ctx.arcTo(b.x, b.y, b.x + b.w, b.y, r);
        ctx.clip();
        // Discrète, comme dans le jeu : un éclaircissement, pas un pavé sombre.
        // Une jauge trop marquée se lit à l'envers — l'œil prend la part NON
        // remplie pour la barre.
        ctx.fillStyle = 'rgba(255,255,255,.38)';
        ctx.fillRect(b.x, b.y, b.w * (p / 100), b.h);
        ctx.restore();
        ctx.fillStyle = ENCRE;
      }
      ctx.font = '11px VerdanaPix, Verdana, sans-serif';
      ctx.fillText(p + '%', b.x + b.w / 2, b.y + b.h / 2 + 0.5);
      return;
    }

    if (b.info) {
      this.panneauInfo(ctx, b, tmod);
      return;
    }

    if (b.texte) {
      ctx.font = '14px Jawbreaker, Verdana, sans-serif';
      ctx.fillText(b.texte, b.x + b.w / 2, b.y + b.h / 2 + 0.5);
    }
  }
}

const API = { RUBRIQUES, SPECIAUX, entrees, vaisseauxDisponibles, rayon, Boite, Interface,
  LARGEUR, HAUTEUR, MARGE, MARGE_HAUT, PAGE_L, PAGE_H, FOND, OUVERT, FERME };

if (typeof module !== 'undefined' && module.exports) module.exports = API;
else window.MiniwaveMenu = API;

})();
