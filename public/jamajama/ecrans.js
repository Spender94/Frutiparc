/*
 * JamaJama — les écrans : le menu et ses vagues, le choix des packs, le
 * parchemin de sélection, les dialogues. Chaque écran dessine avec rendu.js
 * les mêmes symboles, aux mêmes places, avec les mêmes mouvements que le
 * fichier : la bande qui remonte d'un pixel par image (et reboucle à 31),
 * le glyphe accroché au bord droit, les articles du menu qui gonflent au
 * survol (100→130→110→140) et dégonflent en trois temps.
 *
 * Les zones de clic viennent du manifeste : la zone `hit` des boutons du SWF,
 * ou le cadre des pièces d'un enfant nommé.
 */
'use strict';

(function () {
  const R = window.JamaRegles;
  const Rendu = window.JamaRendu;
  const { Consts } = R;
  const teinte = (n) => '#' + n.toString(16).padStart(6, '0');

  // Le cadre d'un enfant nommé d'un symbole (pour les clics) : l'union des
  // pièces qui portent ce chemin, enfants compris.
  function cadreEnfant(cle, frame, prefixe) {
    const s = Rendu.symbole(cle);
    const etat = Rendu.etatDe(s, frame);
    let r = null;
    const etendre = (x, y, w, h) => {
      if (!r) r = { x, y, w, h };
      else {
        const x2 = Math.max(r.x + r.w, x + w), y2 = Math.max(r.y + r.h, y + h);
        r.x = Math.min(r.x, x); r.y = Math.min(r.y, y);
        r.w = x2 - r.x; r.h = y2 - r.y;
      }
    };
    for (const p of etat.pieces) {
      const nom = p.nom || '';
      // Sans préfixe, on mesure le symbole entier ; avec, la branche visée.
      if (prefixe != null && nom !== prefixe && nom.indexOf(prefixe + '.') !== 0) continue;
      const ox = p.m ? p.m[4] : 0, oy = p.m ? p.m[5] : 0;
      if (p.x !== undefined) etendre(p.x, p.y, p.w, p.h);
      else if (p.clip) {
        const enfant = Rendu.etatDe(Rendu.symbole(p.clip), p.frame || 1);
        for (const q of enfant.pieces) {
          if (q.x !== undefined) etendre(ox + q.x, oy + q.y, q.w, q.h);
        }
      } else if (p.champ !== undefined) {
        const c = Rendu.manifeste().champs[p.champ];
        if (c) etendre(ox + c.rect.x, oy + c.rect.y, c.rect.w, c.rect.h);
      } else if (p.bouton) {
        const z = Rendu.zoneBouton(p.bouton);
        if (z) {
          const sx = p.m ? p.m[0] : 1, sy = p.m ? p.m[3] : 1;
          etendre(ox + z.x * sx, oy + z.y * sy, z.w * sx, z.h * sy);
        }
      }
    }
    return r;
  }
  const dans = (r, x, y) => r && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

  // ── le fond commun : brun, vagues, glyphe ──
  function FondVagues() {
    this.y = 0;
  }
  FondVagues.prototype.update = function (tmod) {
    // Le fichier retire UN pixel par image, sans tmod — on garde le pas.
    this.y -= 1;
    if (this.y < -31) this.y += 31;
  };
  FondVagues.prototype.dessiner = function (ctx) {
    ctx.fillStyle = teinte(Consts.BROWN);
    ctx.fillRect(0, 0, Consts.WIDTH, Consts.HEIGHT);
    ctx.save();
    ctx.translate(0, this.y);
    try { Rendu.dessiner(ctx, 'jama_Menu_Bande', 1); } catch (e) {}
    ctx.restore();
    ctx.save();
    ctx.translate(Consts.WIDTH, 0);
    try { Rendu.dessiner(ctx, 'jama_Menu_Glyph', 1); } catch (e) {}
    ctx.restore();
  };

  // ── le menu ──
  const GROW = 1, GROW1 = 2, GROW2 = 3, SHRINK = 10, SHRINK1 = 11, SHRINK2 = 12, RIEN = 0;

  class EcranMenu {
    constructor(peutCreer) {
      this.fond = new FondVagues();
      this.items = [1, 2, 4, 5, 6, 7].map((id, pos) => ({
        id, x: Consts.WIDTH / 2, y: 150 + (pos + 1) * 30, echelle: 100, mode: RIEN, survole: false,
      }));
      this.choix = 0;
      // La zone de clic d'un article : le bouton invisible du SWF, étiré ×8.
      const z = Rendu.zoneBouton('bouton132') || { x: 0, y: 0, w: 20, h: 20 };
      this.zone = { x: -80 + (z.x * 8 - 0), y: -10 + z.y, w: z.w * 8, h: z.h };
    }
    update(tmod, souris) {
      this.fond.update(tmod);
      for (const it of this.items) {
        const k = it.echelle / 100;
        const survole = souris && dans({
          x: it.x + this.zone.x * k, y: it.y + this.zone.y * k,
          w: this.zone.w * k, h: this.zone.h * k,
        }, souris.x, souris.y);
        if (survole && !it.survole) it.mode = GROW;
        if (!survole && it.survole) it.mode = SHRINK;
        it.survole = survole;
        if (survole && souris && souris.clic) this.choix = it.id;
        switch (it.mode) {
          case RIEN:
            if (it.echelle > 100) it.echelle -= tmod;
            else if (it.echelle < 100) { it.echelle = Math.round(it.echelle) + 1; if (it.echelle > 100) it.echelle = 100; }
            break;
          case GROW:
            if (it.echelle < 130) it.echelle += tmod * 3; else it.mode = GROW1;
            break;
          case GROW1:
            if (it.echelle >= 110) it.echelle -= tmod * 2; else it.mode = GROW2;
            break;
          case GROW2:
            if (it.echelle < 140) it.echelle += tmod * 2;
            else if (it.echelle > 140) it.echelle = Math.round(it.echelle) - 1;
            break;
          case SHRINK:
            if (it.echelle > 100) it.echelle -= tmod * 2; else it.mode = SHRINK1;
            break;
          case SHRINK1:
            if (it.echelle < 110) it.echelle += tmod * 2; else it.mode = SHRINK2;
            break;
          case SHRINK2:
            if (it.echelle > 100) it.echelle -= tmod * 2; else it.mode = RIEN;
            break;
        }
      }
      const c = this.choix;
      this.choix = 0;
      return c;
    }
    dessiner(ctx) {
      this.fond.dessiner(ctx);
      ctx.save();
      ctx.translate(Consts.WIDTH / 2, 82);
      try { Rendu.dessiner(ctx, 'jama_Menu_Title', 1); } catch (e) {}
      ctx.restore();
      for (const it of this.items) {
        ctx.save();
        ctx.translate(it.x, it.y);
        ctx.scale(it.echelle / 100, it.echelle / 100);
        try {
          Rendu.dessiner(ctx, 'jama_Menu_ButtonBackground', it.id);
          Rendu.dessiner(ctx, 'jama_Menu_Button', 1, { clips: { text: it.id } });
        } catch (e) {}
        ctx.restore();
      }
    }
  }

  // ── le choix des packs ──
  class EcranPacks {
    constructor(packs) {
      this.fond = new FondVagues();
      this.packs = packs;
      this.choix = -1;
    }
    update(tmod, souris) {
      this.fond.update(tmod);
      if (souris && souris.clic) {
        for (let i = 0; i < this.packs.length; i++) {
          const y = 50 + i * 60;
          if (souris.x >= Consts.WIDTH / 2 - 160 && souris.x <= Consts.WIDTH / 2 + 160
            && souris.y >= y - 26 && souris.y <= y + 26) {
            const c = i;
            this.choix = -1;
            return c;
          }
        }
      }
      return -1;
    }
    dessiner(ctx) {
      this.fond.dessiner(ctx);
      for (let i = 0; i < this.packs.length; i++) {
        ctx.save();
        ctx.translate(Consts.WIDTH / 2, 50 + i * 60);
        try {
          Rendu.dessiner(ctx, 'jama_gui_AdventurePack', 1 + i,
            { champs: { title: this.packs[i].titre } });
        } catch (e) {}
        ctx.restore();
      }
    }
  }

  // ── le parchemin de sélection d'un niveau ──
  class EcranSelect {
    constructor() {
      this.fond = new FondVagues();
      this.titre = '';
      this.jokers = 3;
      this.complete = false;
      this.prevActif = false;
      this.nextActif = true;
      this.action = null;
      this._zones = {
        prev: cadreEnfant('jama_gui_AdventureSelect', 1, 'prev'),
        next: cadreEnfant('jama_gui_AdventureSelect', 1, 'next'),
        btnPlay: cadreEnfant('jama_gui_AdventureSelect', 1, 'btnPlay'),
      };
    }
    update(tmod, souris) {
      this.fond.update(tmod);
      if (souris && souris.clic) {
        const x = souris.x - Consts.WIDTH / 2, y = souris.y - Consts.HEIGHT / 2;
        if (this.prevActif && dans(this._zones.prev, x, y)) return 'prev';
        if (this.nextActif && dans(this._zones.next, x, y)) return 'next';
        if (dans(this._zones.btnPlay, x, y)) return 'play';
      }
      return null;
    }
    dessiner(ctx) {
      this.fond.dessiner(ctx);
      ctx.save();
      ctx.translate(Consts.WIDTH / 2, Consts.HEIGHT / 2);
      try {
        Rendu.dessiner(ctx, 'jama_gui_AdventureSelect', 1, {
          champs: { title: this.titre },
          clips: {
            prev: this.prevActif ? 'enabled' : 'disabled',
            next: this.nextActif ? 'enabled' : 'disabled',
            star1: this.jokers > 0 ? 'available' : 'used',
            star2: this.jokers > 1 ? 'available' : 'used',
            star3: this.jokers > 2 ? 'available' : 'used',
            completed: this.complete ? 'yes' : 'no',
          },
          // Les flèches inactives passent à moitié transparentes (alpha 50).
        });
      } catch (e) {}
      // L'alpha des flèches désactivées, comme disablePrev/disableNext.
      for (const [nom, actif] of [['prev', this.prevActif], ['next', this.nextActif]]) {
        if (actif) continue;
        const z = this._zones[nom];
        if (!z) continue;
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = teinte(Consts.BROWN);
        // le voile brun rend la flèche « éteinte » sans redessiner le parchemin
        ctx.globalCompositeOperation = 'destination-out';
        ctx.globalAlpha = 0.0;
        ctx.restore();
      }
      ctx.restore();
    }
  }

  // ── les options ──
  //
  // Deux cases à cocher et deux boutons, sur le fond du menu — c'est
  // options.State au détail près : la case bascule entre ses images 1 et 2
  // (« gotoAndStop(3 - _currentframe) »), « Sauver » enregistre, « Annuler »
  // revient au menu sans rien changer.
  //
  // Le VerticalPane du fichier pose ses enfants avec 50 px de marge ; on
  // garde ces places.
  class EcranOptions {
    constructor(options) {
      this.fond = new FondVagues();
      this.debut = !!options.showBeginFade;
      this.fin = !!options.showVictoFade;
      const c = cadreEnfant('jama_gui_CheckBox', 1, null) || { x: 0, y: 0, w: 220, h: 24 };
      this.cases = [
        { y: 50, dit: 'Animation de debut de partie', clef: 'debut' },
        { y: 90, dit: 'Animation de fin de partie', clef: 'fin' },
      ];
      this.cadreCase = c;
      const b = cadreEnfant('jama_gui_Button', 1, null) || { x: -40, y: -13, w: 80, h: 26 };
      this.cadreBouton = b;
      this.boutons = [
        { x: 192 - 55, y: 160, dit: 'Sauver', quoi: 'sauver' },
        { x: 192 + 55, y: 160, dit: 'Annuler', quoi: 'annuler' },
      ];
    }
    update(tmod, souris) {
      this.fond.update(tmod);
      if (!souris || !souris.clic) return null;
      for (const c of this.cases) {
        const r = { x: 50 + this.cadreCase.x, y: c.y + this.cadreCase.y,
          w: this.cadreCase.w, h: this.cadreCase.h };
        if (dans(r, souris.x, souris.y)) { this[c.clef] = !this[c.clef]; return null; }
      }
      for (const b of this.boutons) {
        const r = { x: b.x + this.cadreBouton.x, y: b.y + this.cadreBouton.y,
          w: this.cadreBouton.w, h: this.cadreBouton.h };
        if (dans(r, souris.x, souris.y)) return b.quoi;
      }
      return null;
    }
    dessiner(ctx) {
      this.fond.dessiner(ctx);
      for (const c of this.cases) {
        ctx.save();
        ctx.translate(50, c.y);
        try {
          Rendu.dessiner(ctx, 'jama_gui_CheckBox', this[c.clef] ? 2 : 1,
            { vars: { label: c.dit } });
        } catch (e) {}
        ctx.restore();
      }
      for (const b of this.boutons) {
        ctx.save();
        ctx.translate(b.x, b.y);
        try { Rendu.dessiner(ctx, 'jama_gui_Button', 1, { champs: { label: b.dit } }); } catch (e) {}
        ctx.restore();
      }
    }
  }

  // ── la liste des niveaux (le tournoi) ──
  //
  // C'est jama_gui_list à son image 1 : le fond, l'en-tête (nom, record,
  // difficulté), la rangée de boutons du bas et le compteur de pages. Les
  // lignes sont des jama_GUI_LevelSlot empilés depuis y = 50 — avec le
  // décalage d'origine : LevelsPane pose la première à (0 − 1) × hauteur,
  // si bien qu'elle chevauche l'en-tête d'une ligne. On garde ce pas.
  //
  // Un clic choisit, un second clic sur la même ligne dans la demi-seconde
  // lance la partie (doubleClickAction). Les statuts d'icône sont ceux de
  // LevelSlot : « 4 » jamais joué, « 1 » mort, « 3 » bronze, « 2 » or.
  const ICONES = { '-1': '4', 0: '1', 1: '3', 2: '2' };
  const PAR_PAGE = 15;

  class EcranListe {
    constructor(niveaux) {
      this.tous = niveaux;
      this.filtre = '';
      this.page = 0;
      this.choisi = null;
      this._dernierClic = 0;
      this._dernierId = null;
      this.recherche = '';
      // La hauteur d'une ligne, c'est celle du clip — le `_height` que
      // LevelsPane multiplie pour empiler.
      const r = cadreEnfant('jama_GUI_LevelSlot', 1, null);
      this.hauteurLigne = (r && r.h) || 19;
      this._zones = {
        butPlay: cadreEnfant('jama_gui_list', 1, 'butPlay'),
        butProp: cadreEnfant('jama_gui_list', 1, 'butProp'),
        butPrev: cadreEnfant('jama_gui_list', 1, 'butPrev'),
        butNext: cadreEnfant('jama_gui_list', 1, 'butNext'),
        butSearch: cadreEnfant('jama_gui_list', 1, 'butSearch'),
        butSort: cadreEnfant('jama_gui_list', 1, 'butSort'),
        fieldSearch: cadreEnfant('jama_gui_list', 1, 'fieldSearch'),
      };
    }
    niveaux() {
      const q = this.filtre.toLowerCase();
      if (!q) return this.tous;
      return this.tous.filter((n) => (n.titre + ' ' + n.auteur).toLowerCase().indexOf(q) >= 0);
    }
    pages() { return Math.max(1, Math.ceil(this.niveaux().length / PAR_PAGE)); }
    visibles() {
      const l = this.niveaux();
      return l.slice(this.page * PAR_PAGE, (this.page + 1) * PAR_PAGE);
    }
    update(tmod, souris, clavier) {
      if (clavier && this.saisie) {
        // Le champ de recherche a le clavier : Entrée valide, comme le
        // yota.Keyboard du fichier.
        if (clavier === 'Enter') { this.filtre = this.recherche; this.page = 0; this.saisie = false; }
        else if (clavier === 'Backspace') this.recherche = this.recherche.slice(0, -1);
        else if (clavier.length === 1) this.recherche += clavier;
      }
      if (!souris || !souris.clic) return null;
      const { x, y } = souris;
      if (dans(this._zones.fieldSearch, x, y)) { this.saisie = true; return null; }
      this.saisie = false;
      if (dans(this._zones.butSearch, x, y)) { this.filtre = this.recherche; this.page = 0; return null; }
      if (dans(this._zones.butPrev, x, y)) { if (this.page > 0) this.page -= 1; return null; }
      if (dans(this._zones.butNext, x, y)) { if (this.page + 1 < this.pages()) this.page += 1; return null; }
      if (dans(this._zones.butProp, x, y)) return this.choisi ? 'proprietes' : null;
      if (dans(this._zones.butPlay, x, y)) return this.choisi ? 'jouer' : null;
      if (dans(this._zones.butSort, x, y)) return 'tri';
      // Les lignes.
      const liste = this.visibles();
      for (let i = 0; i < liste.length; i++) {
        const ly = 50 + (i - 1) * this.hauteurLigne;
        if (y >= ly && y < ly + this.hauteurLigne && x >= 0 && x < Consts.WIDTH) {
          const avant = this._dernierId;
          this.choisi = liste[i];
          const t = Date.now();
          const double = avant === liste[i].id && (t - this._dernierClic) < 500;
          this._dernierClic = t;
          this._dernierId = liste[i].id;
          return double ? 'jouer' : null;
        }
      }
      return null;
    }
    dessiner(ctx) {
      try {
        Rendu.dessiner(ctx, 'jama_gui_list', 1, {
          champs: {
            fieldPage: (this.page + 1) + ' / ' + this.pages(),
            fieldSearch: this.recherche,
          },
        });
      } catch (e) {}
      const liste = this.visibles();
      for (let i = 0; i < liste.length; i++) {
        const n = liste[i];
        ctx.save();
        ctx.translate(0, 50 + (i - 1) * this.hauteurLigne);
        if (this.choisi && this.choisi.id === n.id) {
          // Le curseur de sélection : un liseré clair sur toute la ligne.
          ctx.save();
          ctx.globalAlpha = 0.25;
          ctx.fillStyle = teinte(Consts.LIGHT_BROWN);
          ctx.fillRect(0, 0, Consts.WIDTH, this.hauteurLigne);
          ctx.restore();
        }
        const statut = n.moi ? n.moi.s : -1;
        try {
          Rendu.dessiner(ctx, 'jama_GUI_LevelSlot', 1, {
            vars: {
              name: n.titre,
              record: n.moi && n.moi.b ? String(n.moi.b) : '-',
              // La « valeur » d'un niveau, telle que l'extension la calcule au
              // moment de le valider : le score de l'auteur, au carré sur 290.
              // Les niveaux de levels.xml n'ont pas d'attribut `p`, on la
              // recalcule donc pour eux.
              difficulty: String(n.difficulte
                || Math.round(n.score * (n.score / 290))),
            },
            clips: { icon: ICONES[String(statut)] || '4' },
          });
        } catch (e) {}
        ctx.restore();
      }
    }
  }

  // ── la fiche d'un niveau (jama_gui_LevelInfo) ──
  class FicheNiveau {
    constructor(niveau) { this.niveau = niveau; }
    update(tmod, souris) { return (souris && souris.clic) ? 'fermer' : null; }
    dessiner(ctx) {
      const n = this.niveau;
      const d = n.date ? new Date(Number(n.date)) : null;
      ctx.save();
      try {
        Rendu.dessiner(ctx, 'jama_gui_LevelInfo', 1, {
          champs: { title: n.titre },
          vars: {
            author: n.auteur || '?',
            date: d ? d.toLocaleDateString('fr-FR') : '?',
            nbrPlays: n.moi ? String(n.moi.p || 0) : '0',
            nbrVictories: n.moi ? String(n.moi.v || 0) : '0',
            value: n.score ? String(n.score) : '-',
            title: n.titre,
          },
        });
      } catch (e) {}
      ctx.restore();
    }
  }

  // ── les dialogues ──
  class Dialogue {
    /**
     * genre : 'confirm' (oui/non), 'retry' (oui/non/encore)
     */
    constructor(genre, texte) {
      this.genre = genre;
      this.texte = texte;
      this.cle = genre === 'retry' ? 'jama_GUI_ConfirmRestart' : 'jama_GUI_Confirm';
      this.reponse = null;
      this._zones = {
        yes: cadreEnfant(this.cle, 1, 'yes'),
        no: cadreEnfant(this.cle, 1, 'no'),
        retry: genre === 'retry' ? cadreEnfant(this.cle, 1, 'retry') : null,
      };
    }
    update(tmod, souris) {
      if (souris && souris.clic) {
        const x = souris.x - Consts.WIDTH / 2, y = souris.y - Consts.HEIGHT / 2;
        if (dans(this._zones.yes, x, y)) return 'oui';
        if (dans(this._zones.no, x, y)) return 'non';
        if (this._zones.retry && dans(this._zones.retry, x, y)) return 'encore';
      }
      return null;
    }
    dessiner(ctx) {
      ctx.fillStyle = teinte(Consts.BLACK_BROWN);
      ctx.fillRect(0, 0, Consts.WIDTH, Consts.HEIGHT);
      ctx.save();
      ctx.translate(Consts.WIDTH / 2, Consts.HEIGHT / 2);
      try {
        Rendu.dessiner(ctx, this.cle, 1, {
          champs: {
            content: this.texte,
            'yes.label': 'oui',
            'no.label': 'non',
            'retry.label': 'encore',
          },
        });
      } catch (e) {}
      ctx.restore();
    }
  }

  // ── l'attente (le sablier) ──
  class Attente {
    constructor() { this.frame = 1; }
    update(tmod) {
      this.frame += tmod;
      const n = Rendu.longueur('jama_gui_WaitCursor');
      if (this.frame > n) this.frame -= n;
    }
    dessiner(ctx, x, y) {
      ctx.save();
      ctx.translate(x, y);
      try { Rendu.dessiner(ctx, 'jama_gui_WaitCursor', Math.max(1, Math.round(this.frame))); } catch (e) {}
      ctx.restore();
    }
  }

  window.JamaEcrans = { EcranMenu, EcranPacks, EcranSelect, EcranListe, EcranOptions,
    FicheNiveau, Dialogue, Attente, FondVagues, cadreEnfant };
})();
