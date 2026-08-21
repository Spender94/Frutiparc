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
      if (nom !== prefixe && nom.indexOf(prefixe + '.') !== 0) continue;
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

  window.JamaEcrans = { EcranMenu, EcranPacks, EcranSelect, Dialogue, Attente, FondVagues, cadreEnfant };
})();
