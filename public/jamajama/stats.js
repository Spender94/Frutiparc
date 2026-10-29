/*
 * JamaJama — les STATISTIQUES (statlist.State, StatList, StatsPane).
 *
 * C'est jama_gui_list à son image 3 : la colonne « score », la pagination,
 * et en bas à gauche le menu déroulant du fichier (gui.component.Select) aux
 * quatre onglets — Joueurs, Createurs, Niveaux, Mes niveaux (« PCLO »). Les
 * lignes sont deux champs de texte de StatsPane : 305 points à gauche, 60
 * centrés à droite, brun noir, empilés depuis y = 50 avec le même décalage
 * d'une ligne que la liste des niveaux. Les données viennent du serveur
 * (/api/jamajama/stats) ; voir server.js pour ce que compte chaque onglet.
 */
'use strict';

(function () {
  const R = window.JamaRegles;
  const Rendu = window.JamaRendu;
  const Ecrans = window.JamaEcrans;
  const { Consts } = R;
  const teinte = (n) => '#' + n.toString(16).padStart(6, '0');
  const dans = (r, x, y) => r && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
  const W = Consts.WIDTH, H = Consts.HEIGHT;

  const MODES = 'PCLO';
  const LIBELLES = ['Joueurs', 'Createurs', 'Niveaux', 'Mes niveaux'];
  const PAR_PAGE = 15;
  const HAUTEUR = 20;                        // le champ de Std.createTextField : 100×20
  // Le champ par défaut du lecteur Flash : Times New Roman 12.
  const champ = (x, w, align) => ({
    rect: { x, y: 0, w, h: HAUTEUR }, fonte: 'Times New Roman', taille: 12,
    couleur: teinte(Consts.BLACK_BROWN), align, wrap: false, multiligne: false,
  });
  const COL1 = champ(5, 305, 'gauche');
  const COL2 = champ(320, 60, 'centre');

  /** _createStat : les deux colonnes d'une ligne, selon l'onglet. */
  function colonnes(mode, l) {
    const s = l.s != null ? l.s : l.np;
    switch (mode) {
      case 'P': return { col1: l.u, col2: l.s };
      case 'L': return { col1: l.u + ' -- ' + l.t, col2: s };
      case 'O': return { col1: l.t, col2: s };
      case 'C': return { col1: l.u, col2: s };
      default: return { col1: '', col2: '' };
    }
  }

  // ── le menu déroulant (gui.component.Select) ──
  //
  // L'article courant et sa flèche ; un clic ouvre la liste VERS LE HAUT
  // (chaque article à (i + 1) × sa hauteur au-dessus), un article choisi
  // referme et devient le courant.
  class Choix {
    constructor(x, y, libelles) {
      this.x = x; this.y = y;
      this.libelles = libelles;
      this.courant = 0;
      this.ouvert = false;
      this.cadre = Ecrans.cadreEnfant('jama_gui_Select', 1, null) || { x: -1, y: -1, w: 127, h: 20 };
      const it = Ecrans.cadreEnfant('jama_gui_SelectItem', 1, null) || { x: -1, y: -1, w: 102, h: 20 };
      this.article = it;
    }
    _zoneArticle(i) {
      const a = this.article;
      return { x: this.x + a.x, y: this.y - (i + 1) * a.h + a.y, w: a.w, h: a.h };
    }
    /** → l'indice choisi, ou null. */
    update(souris) {
      this.survol = -1;
      if (!souris) return null;
      if (this.ouvert) {
        for (let i = 0; i < this.libelles.length; i++) {
          if (dans(this._zoneArticle(i), souris.x, souris.y)) this.survol = i;
        }
      }
      if (!souris.clic) return null;
      if (this.ouvert && this.survol >= 0) {
        this.ouvert = false;
        this.courant = this.survol;
        return this.courant;
      }
      const c = this.cadre;
      if (dans({ x: this.x + c.x, y: this.y + c.y, w: c.w, h: c.h }, souris.x, souris.y)) {
        this.ouvert = !this.ouvert;
        return null;
      }
      this.ouvert = false;
      return null;
    }
    dessiner(ctx) {
      ctx.save();
      ctx.translate(this.x, this.y);
      try {
        Rendu.dessiner(ctx, 'jama_gui_Select', 1, {
          champs: { 'current.label': this.libelles[this.courant] },
        });
      } catch (e) {}
      ctx.restore();
      if (this.ouvert) {
        for (let i = 0; i < this.libelles.length; i++) {
          ctx.save();
          ctx.translate(this.x, this.y - (i + 1) * this.article.h);
          try {
            Rendu.dessiner(ctx, 'jama_gui_SelectItem', this.survol === i ? 2 : 1,
              { champs: { label: this.libelles[i] } });
          } catch (e) {}
          ctx.restore();
        }
      }
    }
  }

  class EcranStats {
    constructor() {
      this.choix = new Choix(8, H - 20, LIBELLES);
      this.lignes = [];
      this.page = 0;
      this.pages = 1;
      this.z = {
        prev: Ecrans.cadreEnfant('jama_gui_list', 3, 'butPrev'),
        next: Ecrans.cadreEnfant('jama_gui_list', 3, 'butNext'),
      };
    }
    /** setStats : page (1…), total de pages, lignes {col1, col2}. */
    setStats(page, pages, lignes) {
      this.page = page || 1;
      this.pages = pages || 1;
      this.lignes = lignes;
    }
    /** → {mode: i} | 'suivante' | 'precedente' | null */
    update(tmod, souris) {
      const c = this.choix.update(souris);
      if (c != null) return { mode: c };
      if (this.choix.ouvert || !souris || !souris.clic) return null;
      if (dans(this.z.next, souris.x, souris.y)) return 'suivante';
      if (dans(this.z.prev, souris.x, souris.y)) return 'precedente';
      return null;
    }
    dessiner(ctx) {
      try {
        Rendu.dessiner(ctx, 'jama_gui_list', 3, {
          champs: { fieldPage: this.page + ' / ' + this.pages },
        });
      } catch (e) {}
      ctx.save();
      for (let i = 0; i < this.lignes.length; i++) {
        ctx.save();
        ctx.translate(0, 50 + (i - 1) * HAUTEUR);
        Rendu.ecrireChamp(ctx, COL1, this.lignes[i].col1 || '');
        Rendu.ecrireChamp(ctx, COL2, this.lignes[i].col2 == null ? '' : String(this.lignes[i].col2));
        ctx.restore();
      }
      ctx.restore();
      this.choix.dessiner(ctx);
    }
  }

  /** statlist.State : l'onglet « Joueurs » d'abord, quinze lignes par page. */
  function EtatStats(hote) {
    const ecran = new EcranStats();
    const moi = { mode: 'P', page: 0, total: 0, attente: null, demande: 0 };
    function rafraichir() {
      const numero = ++moi.demande;
      moi.attente = new Ecrans.Attente();
      hote.plateforme.statistiques(moi.mode, moi.page).then((d) => {
        if (numero !== moi.demande) return;          // une réponse dépassée
        moi.attente = null;
        if (!d || !d.ok) { ecran.setStats(1, 1, []); return; }
        moi.total = d.total;
        ecran.setStats(moi.page + 1, Math.ceil(moi.total / PAR_PAGE),
          d.lignes.map((l) => colonnes(moi.mode, l)));
      });
    }
    rafraichir();
    return {
      nom: 'stats',
      update(tmod) {
        if (moi.attente) moi.attente.update(tmod);
        if (hote.echap()) { hote.passer(hote.menu()); return; }
        const a = ecran.update(tmod, hote.souris);
        if (a && a.mode != null) {               // changeMode
          moi.page = 0;
          moi.mode = MODES.charAt(a.mode);
          rafraichir();
        } else if (a === 'suivante') {
          if ((moi.page + 1) * PAR_PAGE >= moi.total) return;
          moi.page += 1;
          rafraichir();
        } else if (a === 'precedente') {
          if (!(moi.page > 0)) return;
          moi.page -= 1;
          rafraichir();
        }
      },
      dessiner() {
        ecran.dessiner(hote.ctx);
        if (moi.attente) moi.attente.dessiner(hote.ctx, W / 2, H / 2);
      },
    };
  }

  window.JamaStats = { EtatStats, EcranStats, colonnes, MODES, LIBELLES };
})();
