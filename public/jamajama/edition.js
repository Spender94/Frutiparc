/*
 * JamaJama — le MODE ÉDITION : la liste des niveaux du joueur
 * (editlist.State), l'éditeur (editor.State, Editor, Panel, Playground et ses
 * trois curseurs), les parties d'essai (game.TestState, game.ValidateState).
 * Chaque morceau est la transcription de sa classe du SWF ; les dessins sont
 * ceux du fichier (jama_gui_list image 2, jama_gui_LevelDesign_*, jama_gui_lens,
 * jama_gui_LevelInfoEdit, jama_gui_LevelSizeEdit, jama_GUI_ConfirmQuit).
 *
 * Les états reçoivent de jeu.js un « hôte » : la souris, le canevas, la
 * plateforme, et de quoi changer d'état (passer, menu, partie).
 *
 * Ce que le portage ajoute au fichier, pour le doigt : un élément de la
 * palette se choisit aussi en le touchant (le Flash n'avait que les deux
 * flèches), et les champs de saisie sont de vrais champs de page, qui
 * appellent le clavier du téléphone.
 */
'use strict';

(function () {
  const R = window.JamaRegles;
  const Rendu = window.JamaRendu;
  const Ecrans = window.JamaEcrans;
  const { Consts, Element, Direction, Coord, Dimension, Level } = R;
  const teinte = (n) => '#' + n.toString(16).padStart(6, '0');
  const dans = (r, x, y) => r && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
  const decaler = (r, dx, dy) => r && { x: r.x + dx, y: r.y + dy, w: r.w, h: r.h };
  const NOMS_DIR = ['North', 'East', 'South', 'West'];
  const W = Consts.WIDTH, H = Consts.HEIGHT;

  // Les textes du fichier (Consts).
  const TEXTES = {
    SUPPR_CONFIRM: 'Supprimer le level ',
    QUIT_EDITION: 'Sauver avant de quitter ?',
    VALIDATE_WARNING: 'Gagnez le niveau pour le valider, il sera alors jouable par les autres joueurs.',
  };

  // ── le clavier de l'éditeur ──
  //
  // L'éditeur lit des touches que la partie ignore (Inser, Suppr, Fin, les
  // pages) : il les prend à la source, dans l'ordre, comme le yota.Keyboard
  // du fichier (une touche par image). Échap reste à jeu.js.
  const clavier = { actif: false, file: [] };
  const TOUCHES_EDITEUR = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ',
    'PageUp', 'PageDown', 'Insert', 'Delete', 'End'];
  // Le dernier geste vient-il du doigt ? (jeu.js retient les souris
  // simulées après un toucher : seul un vrai mouvement de souris le dément.)
  let auDoigt = false;
  window.addEventListener('touchstart', () => { auDoigt = true; }, { passive: true });
  window.addEventListener('mousemove', () => { auDoigt = false; }, { passive: true });
  window.addEventListener('keydown', (e) => {
    if (!clavier.actif || TOUCHES_EDITEUR.indexOf(e.key) < 0) return;
    if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    clavier.file.push(e.key);
    e.preventDefault();
  });

  // ── la pose d'un élément, immobile ──
  //
  // L'éditeur ne joue rien : chaque élément y est dans l'image de son show()
  // (sur le plateau) ou de son showEditor() (dans la palette). Le mur et
  // l'eau prennent leur raccord de leurs voisins, comme en partie.
  function pose(s, board, palette) {
    const o = s.orientation >= 0 && s.orientation <= 3 ? s.orientation : Direction.SOUTH;
    const p = { cle: 'jama_' + Element.nameOf(s.id), frame: 1, clips: {}, compteur: 0 };
    switch (s.id) {
      case Element.EXIT: p.frame = NOMS_DIR[o]; break;
      case Element.WATER:
      case Element.BRIDGE: p.clips = { j: Number(R.frameEau(board, s.pos)) || 1 }; break;
      case Element.WALL: p.frame = Number(R.frameMur(board, s.pos)) || 1; break;
      case Element.ONE_WAY:
      case Element.ONE_WAY_STRICT:
      case Element.MAGNET:
      case Element.GMAGNET:
      case Element.SPIDER: p.frame = NOMS_DIR[o]; break;
      case Element.LURKER: p.frame = NOMS_DIR[o]; p.clips = { j: 1 }; break;
      case Element.FRUIT: p.clips = { j: s.param > 0 ? s.param : 1 }; break;
      case Element.HERO: p.clips = { j: o + 1 }; break;
      // Louki et Winkle : la pose de showEditor dans la palette, celle de
      // show() sur le plateau.
      case Element.LOUKI: p.frame = palette ? 'moveFullSouth' : 'default'; break;
      case Element.WINKLE: p.frame = palette ? 'sleep' : 'default'; break;
      // Kohl : l'aide dit qu'il pivote — on montre donc son orientation.
      case Element.KOHL: p.frame = NOMS_DIR[o]; break;
      case Element.EYE: p.frame = 'Close'; break;
      case Element.JADE: p.frame = 'normal'; break;
      case Element.ARCHER: p.frame = 'default'; break;
      case Element.BOMB: p.compteur = s.param > 0 ? s.param : 5; break;
      default: p.frame = 1;
    }
    return p;
  }
  function dessinerElement(ctx, s, board, palette, x, y) {
    const p = pose(s, board, palette);
    ctx.save();
    ctx.translate(x, y);
    try { Rendu.dessiner(ctx, p.cle, p.frame, { clips: p.clips }); } catch (e) {}
    if (p.compteur > 0) {
      ctx.translate(16, 0);
      try { Rendu.dessiner(ctx, 'jama_fx_BombCounter', String(p.compteur)); } catch (e) {}
    }
    ctx.restore();
  }

  // Le paramètre d'un élément (le fruit : 1 à 5, la bombe : 1 à 9) et son
  // défaut — Fruit/Bomb.setParameter : hors bornes, on repart à 1.
  const PARAMETRES = { [Element.FRUIT]: { def: 1, max: 5 }, [Element.BOMB]: { def: 5, max: 9 } };
  function avecParametre(id) { return !!PARAMETRES[id]; }
  function borner(id, p) {
    const q = PARAMETRES[id];
    if (!q) return p;
    if (p === -1 || p == null) return q.def;
    return (p > q.max || !(p > 0)) ? 1 : p;
  }
  // Tout avatar se tourne vers le sud dans son show() — sauf Kohl, dont le
  // show() ne touche pas à l'orientation.
  function orientationPosee(id, o) {
    return (id === Element.HERO || id === Element.LOUKI || id === Element.WINKLE) ? Direction.SOUTH : o;
  }

  // ── le plateau de l'éditeur (editor.Playground) ──
  let uid = 1000000;
  class Terrain {
    constructor(dim) {
      this.dim = dim.clone();
      this.board = new R.Board(this.dim);
      this.sprites = [];
      this.modifie = false;
      this.padX = (W - this.dim.width * Consts.SPRITE_WIDTH) / 2;
      this.padY = (H - this.dim.height * Consts.SPRITE_HEIGHT) / 2;
      // Le moteur demande un playground à ses sprites ; ici rien ne bouge.
      const board = this.board;
      this._pg = { getBoard: () => board, emet() {}, push() {}, pushEffect() {} };
    }
    _creer(data) {
      const s = R.creerSprite(data);
      if (!s) return null;                  // le PIN, que Sprite.create ignore
      s.uid = uid++;
      s.setPlayground(this._pg);
      s.orientation = orientationPosee(s.id, data.orientation);
      if (avecParametre(s.id)) s.param = borner(s.id, data.param);
      return s;
    }
    _poser(s) {
      this.board.set(s.pos, s);
      this.sprites.push(s);
    }
    setLevel(level) {
      if (level.id === -1) this.modifie = true;
      for (const t of level.tiles) {
        if (!this.board.isValid(t.pos)) continue;
        const s = this._creer(t);
        if (s) this._poser(s);
      }
      if (this.board.get(level.startPos).id !== Element.NONE) return;
      const e = new Element(null);
      e.id = Element.HERO;
      e.pos = level.startPos.clone();
      e.orientation = Direction.SOUTH;
      const h = this._creer(e);
      if (h) this._poser(h);
    }
    toLevel() {
      const l = new Level();
      l.tiles = [];
      for (const s of this.sprites) {
        if (s.id === Element.HERO) l.startPos = s.pos.clone();
        else l.tiles.push(new Element(s));
      }
      l.size = this.dim.clone();
      return l;
    }
    coordDe(x, y) {
      return new Coord(Math.floor((x - this.padX) / Consts.SPRITE_WIDTH),
        Math.floor((y - this.padY) / Consts.SPRITE_HEIGHT));
    }
    _trouver(id) { return this.sprites.find((s) => s.id === id) || null; }
    _effacer(s) {
      if (!s || s.id === Element.NONE) return;
      this.board.erase(s);
      const i = this.sprites.indexOf(s);
      if (i >= 0) this.sprites.splice(i, 1);
      this.modifie = true;
    }
    /** addSprite : la case est vidée (dessus et dessous), puis l'élément posé. */
    ajouter(data, c) {
      if (!this.board.isValid(c)) return false;
      if (data.id === Element.HERO) this._effacer(this._trouver(Element.HERO));
      const e = new Element(null);
      e.id = data.id;
      e.pos = c.clone();
      e.param = data.param;
      e.orientation = data.orientation;
      this._effacer(this.board.get(c));
      this._effacer(this.board.getBelow(c));
      const s = this._creer(e);
      if (!s) return false;
      this._poser(s);
      this.modifie = true;
      return true;
    }
    elementEn(c) {
      if (!this.board.isValid(c)) return null;
      const s = this.board.get(c);
      return s.id === Element.NONE ? null : s;
    }
    /** delSpriteUnderCursor : le dessus d'abord, le dessous s'il est seul. */
    effacerEn(c) {
      if (!this.board.isValid(c)) return;
      this.modifie = true;
      this._effacer(this.board.get(c));
    }
    dessiner(ctx) {
      ctx.fillStyle = teinte(Consts.BLACK_BROWN);
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.translate(this.padX, this.padY);
      ctx.fillStyle = teinte(Consts.BACKGROUND);
      ctx.fillRect(0, 0, this.dim.width * 32, this.dim.height * 32);
      // Les bords (jama_Side), comme le plateau de jeu.
      const larg = this.dim.width, haut = this.dim.height;
      const cote = (frame, x, y) => {
        ctx.save(); ctx.translate(x, y);
        try { Rendu.dessiner(ctx, 'jama_Side', frame); } catch (e) {}
        ctx.restore();
      };
      for (let x = 0; x < larg; x++) { cote(1, x * 32, 0); cote(3, x * 32, (haut - 1) * 32); }
      for (let y = 0; y < haut; y++) { cote(4, 0, y * 32); cote(2, (larg - 1) * 32, y * 32); }
      cote(5, 0, 0); cote(6, (larg - 1) * 32, 0);
      cote(7, (larg - 1) * 32, (haut - 1) * 32); cote(8, 0, (haut - 1) * 32);
      // Les profondeurs du gui.Board : le dessous, puis le dessus, case par case.
      const rang = (s) => s.pos.y * larg + s.pos.x;
      const tri = this.sprites.slice().sort((a, b) =>
        (a.below === b.below ? 0 : (a.below ? -1 : 1)) || rang(a) - rang(b));
      for (const s of tri) dessinerElement(ctx, s, this.board, false, s.pos.x * 32, s.pos.y * 32);
      ctx.restore();
    }
  }

  // ── les champs de saisie posés sur le canevas ──
  //
  // Le titre et la taille d'un niveau sont des champs de saisie dans le
  // fichier. Un canevas n'en a pas : on pose un vrai <input> sur le cadre du
  // champ, à l'échelle — il prend le clavier, celui du téléphone compris.
  function champSaisie(hote, meta, valeur, max, numerique) {
    const el = document.createElement('input');
    el.type = 'text';
    el.value = valeur;
    el.maxLength = max;
    if (numerique) { el.inputMode = 'numeric'; el.pattern = '[0-9]*'; }
    el.autocomplete = 'off';
    el.spellcheck = false;
    Object.assign(el.style, {
      position: 'fixed', zIndex: 6, border: 'none', outline: 'none', padding: '0', margin: '0',
      background: 'transparent', color: meta.couleur, textAlign: 'center',
      fontFamily: '"' + meta.fonte + '", Arial, sans-serif',
    });
    // La page écoute le clavier pour le jeu (l'espace y est retenu) : la
    // frappe dans le champ ne doit pas remonter jusque-là.
    el.addEventListener('keydown', (e) => e.stopPropagation());
    el.addEventListener('keyup', (e) => e.stopPropagation());
    // « ... vide ... » se remplace d'un geste : le champ entier se sélectionne.
    el.addEventListener('focus', () => { try { el.select(); } catch (e) {} });
    document.body.appendChild(el);
    return {
      el,
      placer(x, y, w, h) {
        const r = hote.canvas.getBoundingClientRect();
        const K = hote.echelle();
        el.style.left = (r.left + x * K) + 'px';
        el.style.top = (r.top + y * K) + 'px';
        el.style.width = (w * K) + 'px';
        el.style.height = (h * K) + 'px';
        el.style.fontSize = (meta.taille * K) + 'px';
      },
      retirer() { el.remove(); },
    };
  }

  // ── les fenêtres du titre et de la taille (LevelInfoEdit, LevelSizeEdit) ──
  //
  // Sur fond brun noir, la fenêtre centrée ; « valider », « annuler ». La
  // taille se vérifie comme _onValidate : un nombre, positif, sans dépasser le
  // maximum — sinon le champ fautif revient au maximum, et rien ne part.
  class FenetreSaisie {
    constructor(hote, genre, valeurs) {
      this.hote = hote;
      this.genre = genre;                    // 'titre' | 'taille'
      this.cle = genre === 'titre' ? 'jama_gui_LevelInfoEdit' : 'jama_gui_LevelSizeEdit';
      const cadre = Ecrans.cadreEnfant(this.cle, 1, null) || { x: 0, y: 0, w: 368, h: 180 };
      this.x = Math.round((W - cadre.w) / 2);
      this.y = Math.round((H - cadre.h) / 2);
      this.zones = {
        valider: decaler(Ecrans.cadreEnfant(this.cle, 1, 'btnValidate'), this.x, this.y),
        annuler: decaler(Ecrans.cadreEnfant(this.cle, 1, 'btnCancel'), this.x, this.y),
      };
      const M = Rendu.manifeste().champs;
      this.champs = [];
      const creer = (nom, num, valeur, max, numerique) => {
        const z = decaler(Ecrans.cadreEnfant(this.cle, 1, nom), this.x, this.y);
        const c = champSaisie(hote, M[num], String(valeur), max, numerique);
        c.zone = z;
        c.el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); this._demande = 'valider'; }
          if (e.key === 'Escape') { e.preventDefault(); this._demande = 'annuler'; }
        });
        this.champs.push(c);
        return c;
      };
      if (genre === 'titre') {
        this.titre = creer('levelTitle', 447, valeurs.titre, 40, false);
      } else {
        this.largeur = creer('width', 439, valeurs.largeur, 2, true);
        this.hauteur = creer('height', 440, valeurs.hauteur, 2, true);
        this.max = { largeur: valeurs.largeur, hauteur: valeurs.hauteur };
      }
      this._demande = null;
      this.placer();
      // Sur ordinateur, le curseur va droit dans le premier champ.
      try { if (!('ontouchstart' in window)) this.champs[0].el.focus(); } catch (e) {}
    }
    placer() {
      for (const c of this.champs) c.placer(c.zone.x + 2, c.zone.y + 1, c.zone.w - 4, c.zone.h - 2);
    }
    /** → null, 'annuler', ou la valeur validée ({titre} ou {largeur, hauteur}). */
    update(tmod, souris) {
      this.placer();
      let quoi = this._demande;
      this._demande = null;
      if (!quoi && souris && souris.clic) {
        if (dans(this.zones.valider, souris.x, souris.y)) quoi = 'valider';
        else if (dans(this.zones.annuler, souris.x, souris.y)) quoi = 'annuler';
      }
      if (quoi === 'annuler') return 'annuler';
      if (quoi !== 'valider') return null;
      if (this.genre === 'titre') return { titre: this.titre.el.value };
      const w = parseInt(this.largeur.el.value, 10), h = parseInt(this.hauteur.el.value, 10);
      let ok = true;
      if (isNaN(w) || !(w > 0) || w > this.max.largeur) { ok = false; this.largeur.el.value = String(this.max.largeur); }
      if (isNaN(h) || !(h > 0) || h > this.max.hauteur) { ok = false; this.hauteur.el.value = String(this.max.hauteur); }
      return ok ? { largeur: w, hauteur: h } : null;
    }
    dessiner(ctx) {
      ctx.fillStyle = teinte(Consts.BLACK_BROWN);
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.translate(this.x, this.y);
      try {
        Rendu.dessiner(ctx, this.cle, 1, {
          champs: { levelTitle: '', width: '', height: '',
            'btnValidate.label': 'valider', 'btnCancel.label': 'annuler' },
        });
      } catch (e) {}
      ctx.restore();
    }
    quitter() { for (const c of this.champs) c.retirer(); }
  }

  // ── « Sauver avant de quitter ? » (editor.SaveExitDialog) ──
  //
  // La fenêtre est jama_GUI_ConfirmQuit, centrée sur fond brun noir, avec
  // ses trois boutons : oui (sauver puis quitter), non, retour.
  class DialogueQuitter {
    constructor(texte) {
      this.texte = texte;
      this.zones = {
        oui: Ecrans.cadreEnfant('jama_GUI_ConfirmQuit', 1, 'yes'),
        non: Ecrans.cadreEnfant('jama_GUI_ConfirmQuit', 1, 'no'),
        retour: Ecrans.cadreEnfant('jama_GUI_ConfirmQuit', 1, 'cancel'),
      };
    }
    update(tmod, souris) {
      if (!souris || !souris.clic) return null;
      const x = souris.x - W / 2, y = souris.y - H / 2;
      for (const k of ['oui', 'non', 'retour']) if (dans(this.zones[k], x, y)) return k;
      return null;
    }
    dessiner(ctx) {
      ctx.fillStyle = teinte(Consts.BLACK_BROWN);
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.translate(W / 2, H / 2);
      try {
        Rendu.dessiner(ctx, 'jama_GUI_ConfirmQuit', 1, {
          champs: { content: this.texte, 'yes.label': 'oui', 'no.label': 'non', 'cancel.label': 'retour' },
        });
      } catch (e) {}
      ctx.restore();
    }
  }

  // ── un mot au joueur (une sauvegarde refusée, le réseau perdu…) ──
  //
  // Le fichier n'avait pas de chemin d'erreur : la requête partait, le
  // sablier tournait. Le portage le dit, en bandeau, quelques secondes.
  class Bandeau {
    constructor() { this.texte = ''; this.reste = 0; }
    dire(texte) { this.texte = texte; this.reste = 32 * 4; }
    update(tmod) { if (this.reste > 0) this.reste -= tmod; }
    dessiner(ctx) {
      if (this.reste <= 0 || !this.texte) return;
      ctx.save();
      ctx.globalAlpha = Math.min(1, this.reste / 16);
      ctx.font = '11px Verdana, sans-serif';
      const w = Math.min(W - 16, ctx.measureText(this.texte).width + 20);
      ctx.fillStyle = teinte(Consts.BLACK_BROWN);
      ctx.fillRect((W - w) / 2, 6, w, 22);
      ctx.fillStyle = teinte(Consts.LIGHT_BROWN);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.texte, W / 2, 17, W - 24);
      ctx.restore();
    }
  }
  const ERREURS = {
    plein: 'Toutes vos cases sont prises : supprimez un niveau.',
    valide: 'Ce niveau est validé : il ne se modifie plus.',
    contenu: 'Le serveur refuse ce niveau.',
    perdu: 'Le serveur n\'a pas vu la victoire : validation refusée.',
    session: 'Session expirée : rechargez le jeu.',
    horsLigne: 'Hors du site : rien ne s\'enregistre.',
  };
  const erreur = (d) => ERREURS[d && d.error] || 'Le serveur ne répond pas.';

  // ── l'aide d'un élément (Panel._updateHelp), en vrai HTML ──
  //
  // Même parti que l'écran d'aide : le champ HTML du fichier devient un bloc
  // de page posé sur son cadre (27, 185, 327×153), qui défile au doigt.
  let aideSections = null, aideStyle = '';
  let aideDemandee = null;
  function chargerAide() {
    if (!aideDemandee) {
      aideDemandee = fetch('/api/jamajama/aide').then((r) => r.json()).then((d) => {
        if (d && d.ok) { aideSections = d.sections; aideStyle = d.style; }
      }).catch(() => {});
    }
    return aideDemandee;
  }
  class BoiteAide {
    constructor(hote) {
      this.hote = hote;
      this.el = document.createElement('div');
      this.el.className = 'jama-aide';
      this.el.style.display = 'none';
      document.body.appendChild(this.el);
      this.cle = null;
    }
    montrer(cle) {
      this.cle = cle;
      const poser = () => {
        if (this.cle !== cle) return;
        const html = (aideSections && aideSections[cle]) || '<p>…</p>';
        this.el.innerHTML = '<style>' + aideStyle + '</style>' + html;
        this.el.scrollTop = 0;
        for (const img of this.el.querySelectorAll('img')) img.addEventListener('error', () => img.remove());
        // Les renvois appellent showSection(clé) : requestHelpContent.
        for (const a of this.el.querySelectorAll('a[href]')) {
          const cible = (a.getAttribute('href') || '').replace(/^asfunction:[^,]*,/, '');
          a.addEventListener('click', (e) => {
            e.preventDefault();
            if (aideSections && cible in aideSections) this.montrer(cible);
          });
        }
      };
      poser();
      chargerAide().then(poser);
    }
    defiler(sens) { this.el.scrollTop += sens * 40; }
    placer(visible) {
      this.el.style.display = visible ? 'block' : 'none';
      if (!visible) return;
      const r = this.hote.canvas.getBoundingClientRect();
      const K = this.hote.echelle();
      Object.assign(this.el.style, {
        left: (r.left + 27 * K) + 'px', top: (r.top + 185 * K) + 'px',
        width: (327 * K) + 'px', height: (153 * K) + 'px', fontSize: (11 * K) + 'px',
      });
    }
    retirer() { this.el.remove(); }
  }

  // ── l'éditeur (editor.Editor + editor.Panel) ──
  const MINIMAL = 1, MEDIUM = 2, FULL = 3;
  const AJOUT = 1, EFFACER = 2, DEPLACER = 3;          // les trois curseurs
  // Les places du panneau, mode par mode (Panel.changeMode).
  const DISPOSITIONS = {
    [MINIMAL]: { fond: null, titre: 368 },
    [MEDIUM]: { fond: 2, titre: 269, menu: 285, barre: 314 },
    [FULL]: { fond: 3, titre: 64, menu: 80, barre: 106 },
  };

  class EcranEditeur {
    constructor(hote, niveau) {
      this.hote = hote;
      this.niveau = niveau;
      this.terrain = new Terrain(niveau.size);
      this.mode = MINIMAL;
      this.aide = false;
      this.boite = new BoiteAide(hote);
      // La palette : un exemplaire de chaque élément, dans l'ordre de leur
      // enregistrement (SpriteOrder.IDS) — les vingt-deux de l'aide. Tous
      // sont ouverts : l'extension donnait au joueur la liste complète.
      // Chacun dans la pose de son showEditor : les avatars et le lurker face
      // au sud, les autres tels que new Element les crée (au nord).
      const AU_SUD = [Element.HERO, Element.LOUKI, Element.WINKLE, Element.KOHL, Element.LURKER];
      this.palette = Element.EDITOR_IDS.map((id) => ({
        id, orientation: AU_SUD.indexOf(id) >= 0 ? Direction.SOUTH : Direction.NORTH,
        param: avecParametre(id) ? PARAMETRES[id].def : -1,
        pos: new Coord(0, 0),
      }));
      this.index = 0;
      this._planche = new R.Board(new Dimension(1, 1));   // pour le raccord des murs seuls
      this.curseur = null;
      this.terrain.setLevel(niveau);
      // Le Panel, en se construisant, lance le curseur de la palette : on
      // entre dans l'éditeur prêt à poser la sortie (« par défaut la sortie »).
      this._curseurElement();
      const T = 'jama_gui_LevelDesign_TitleBar', MB = 'jama_gui_LevelDesign_MenuBar';
      const SB = 'jama_gui_LevelDesign_SpriteBar', L = 'jama_gui_lens';
      this.z = {
        mode: Ecrans.cadreEnfant(T, 1, 'butMode'),
        ajout: Ecrans.cadreEnfant(T, 1, 'butFlag2'),
        deplacer: Ecrans.cadreEnfant(T, 1, 'butFlag1'),
        effacer: Ecrans.cadreEnfant(T, 1, 'butFlag0'),
        sauver: Ecrans.cadreEnfant(MB, 1, 'butSave'),
        valider: Ecrans.cadreEnfant(MB, 1, 'butSubmit'),
        tester: Ecrans.cadreEnfant(MB, 1, 'butTest'),
        quitter: Ecrans.cadreEnfant(MB, 1, 'butQuit'),
        gauche: Ecrans.cadreEnfant(SB, 1, 'butLeft'),
        droite: Ecrans.cadreEnfant(SB, 1, 'butRight'),
        tourner: Ecrans.cadreEnfant(L, 1, 'butTurn'),
        varier: Ecrans.cadreEnfant(L, 1, 'butCycle'),
        aide: Ecrans.cadreEnfant(L, 1, 'butHelp'),
      };
      const barre = Ecrans.cadreEnfant(SB, 1, null) || { x: 5, y: 0, w: 374, h: 60 };
      // _width et _height de la barre : le pas de la palette en découle (un
      // septième de la largeur), et la lentille se pose en son milieu.
      this.barreW = barre.x + barre.w;
      this.barreH = barre.y + barre.h;
      this.masque = Ecrans.cadreEnfant('jama_gui_barMask', 1, null) || { x: -175, y: -26, w: 348, h: 52 };
    }

    get modifie() { return this.terrain.modifie; }
    choisi() { return this.palette[this.index]; }
    getLevel() { return this.terrain.toLevel(); }
    _lay() { return DISPOSITIONS[this.mode]; }
    /** hasMouse : la souris est sur le panneau (sous le haut de sa barre de titre). */
    _surPanneau(y) { return y >= this._lay().titre; }

    // — les curseurs —
    _curseurElement() {
      const s = this.choisi();
      this.curseur = { type: AJOUT, id: s.id, orientation: s.orientation, param: s.param };
    }
    _changerMode(m) {
      this.mode = m;
    }
    basculer() {                               // toggleVisibility
      if (this.mode === FULL || this.mode === MEDIUM) this._changerMode(MINIMAL);
      else this._changerMode(this.aide ? FULL : MEDIUM);
    }
    _rafraichir() {                            // _refreshSprites + updateEditorSprite
      this._curseurElement();
      if (this.mode === FULL) this.boite.montrer(Element.nameOf(this.choisi().id));
    }
    defilerPalette(sens) {
      const i = this.index + sens;
      if (i < 0 || i >= this.palette.length) return;
      this.index = i;
      this._rafraichir();
    }
    choisirElement(id, orientation, param) {   // setSelectedSprite
      const i = this.palette.findIndex((s) => s.id === id);
      if (i < 0) return;
      const s = this.palette[i];
      s.orientation = orientation;
      s.param = avecParametre(id) ? borner(id, param) : param;
      this.index = i;
      this._rafraichir();
    }
    tourner() {                                // turnSprite
      const s = this.choisi();
      s.orientation = Direction.next(s.orientation);
      this._curseurElement();
    }
    varier() {                                 // cycleSprite : le fruit, la bombe
      const s = this.choisi();
      if (!avecParametre(s.id)) return;
      s.param = borner(s.id, s.param + 1);
      this._curseurElement();
    }
    basculerAide() {                           // toggleHelp
      if (this.mode === FULL) { this.aide = false; this._changerMode(MEDIUM); }
      else {
        this.aide = true;
        this._changerMode(FULL);
        this.boite.montrer(Element.nameOf(this.choisi().id));
      }
    }

    // — la touche, au curseur d'élément (SpriteCursor.handleKey) —
    _toucheCurseur(k) {
      const c = this.curseur;
      if (!c || c.type !== AJOUT) return;
      let id = c.id, o = c.orientation, p = c.param;
      const param = avecParametre(id);
      if (k === 'ArrowUp') { if (param) p = borner(id, p + 1); else o = Direction.NORTH; }
      else if (k === 'ArrowDown') { if (param) p = borner(id, p - 1); else o = Direction.SOUTH; }
      else if (k === 'ArrowLeft') { if (param) return; o = Direction.WEST; }
      else if (k === 'ArrowRight') { if (param) return; o = Direction.EAST; }
      else if (k === 'PageUp' || k === 'PageDown') {
        const ids = Element.EDITOR_IDS;
        const j = ids.indexOf(id) + (k === 'PageUp' ? 1 : -1);
        if (j < 0 || j >= ids.length) return;
        id = ids[j]; o = Direction.SOUTH; p = avecParametre(id) ? PARAMETRES[id].def : -1;
      } else return;
      this.choisirElement(id, o, p);           // onSpriteChange
    }

    /**
     * Une image : les touches (Editor._processInputs), puis la souris.
     * Rend l'ordre donné à l'état : 'sauver', 'valider', 'tester', 'quitter'.
     */
    update(tmod, souris, touches) {
      for (const k of touches) {
        if (k === ' ') {
          this.basculer();
          if (this.mode === MINIMAL) this._curseurElement();
        } else if (k === 'Delete') this.curseur = { type: EFFACER };
        else if (k === 'Insert') this.curseur = { type: DEPLACER };
        else if (k === 'End') this._curseurElement();
        else if (souris && this._surPanneau(souris.y)) {
          // Panel.handleKey : les pages font défiler la palette.
          if (k === 'PageDown') this.defilerPalette(-1);
          if (k === 'PageUp') this.defilerPalette(1);
        } else this._toucheCurseur(k);
      }
      this.boite.placer(this.mode === FULL);
      if (!souris || !souris.clic) return null;
      const x = souris.x, y = souris.y;
      if (this._surPanneau(y)) return this._clicPanneau(x, y);
      // Le clic du curseur, sur le plateau.
      const c = this.terrain.coordDe(x, y);
      const cur = this.curseur;
      if (!cur) return null;
      if (cur.type === AJOUT) this.terrain.ajouter(cur, c);
      else if (cur.type === EFFACER) this.terrain.effacerEn(c);
      else if (cur.type === DEPLACER) {
        // _selectSprite : on soulève l'élément, il devient le curseur.
        const s = this.terrain.elementEn(c);
        if (!s) return null;
        const o = s.orientation, p = s.param, id = s.id;
        this.terrain.effacerEn(c);
        this.choisirElement(id, o, p);
      }
      return null;
    }
    _clicPanneau(x, y) {
      const lay = this._lay();
      // Une marge de quelques points autour des boutons de 14 points : au
      // doigt, la cible du fichier est trop petite.
      const pres = (z, dy, m) => z && dans({ x: z.x - m, y: z.y + dy - m, w: z.w + 2 * m, h: z.h + 2 * m }, x, y);
      const t = lay.titre;
      if (pres(this.z.mode, t, 3)) { this.basculer(); return null; }
      if (pres(this.z.ajout, t, 1)) { this._curseurElement(); return null; }
      if (pres(this.z.deplacer, t, 1)) { this.curseur = { type: DEPLACER }; return null; }
      if (pres(this.z.effacer, t, 1)) { this.curseur = { type: EFFACER }; return null; }
      if (this.mode === MINIMAL) return null;
      for (const k of ['sauver', 'valider', 'tester', 'quitter']) if (pres(this.z[k], lay.menu, 0)) return k;
      const b = lay.barre;
      const lx = this.barreW / 2, ly = b + this.barreH / 2;   // la lentille
      if (dans(decaler(this.z.tourner, lx, ly), x, y)) { this.tourner(); return null; }
      if (dans(decaler(this.z.varier, lx, ly), x, y)) { this.varier(); return null; }
      if (dans(decaler(this.z.aide, lx, ly), x, y)) { this.basculerAide(); return null; }
      if (pres(this.z.gauche, b, 2)) { this.defilerPalette(-1); return null; }
      if (pres(this.z.droite, b, 2)) { this.defilerPalette(1); return null; }
      // Toucher un élément de la palette le choisit (ajout du portage).
      const pas = this.barreW / 7;
      if (y >= b + 4 && y < b + this.barreH - 4) {
        const k = Math.floor(x / pas);
        const i = this.index - 3 + k;
        if (k >= 0 && k < 7 && i >= 0 && i < this.palette.length && i !== this.index) {
          this.index = i;
          this._rafraichir();
          return null;
        }
      }
      if (this.mode === FULL) {
        if (dans({ x: 356, y: 189, w: 22, h: 22 }, x, y)) this.boite.defiler(-1);
        if (dans({ x: 356, y: 318, w: 22, h: 22 }, x, y)) this.boite.defiler(1);
      }
      return null;
    }

    dessiner(ctx, souris) {
      this.terrain.dessiner(ctx);
      const lay = this._lay();
      // Le fond du panneau (jama_gui_LevelDesignBack 2 ou 3).
      if (lay.fond) { try { Rendu.dessiner(ctx, 'jama_gui_LevelDesignBack', lay.fond); } catch (e) {} }
      // La barre de titre : le titre du niveau et les trois curseurs
      // (butFlag2 ajout, butFlag1 déplacement, butFlag0 suppression).
      ctx.save();
      ctx.translate(0, lay.titre);
      try {
        Rendu.dessiner(ctx, 'jama_gui_LevelDesign_TitleBar', 1, {
          champs: { levelTitle: this.niveau.title },
          clips: { butFlag2: 1, butFlag1: 2, butFlag0: 3 },
        });
      } catch (e) {}
      // Le curseur en cours, souligné (le Flash le montrait par le pointeur).
      const actif = this.curseur && { [AJOUT]: this.z.ajout, [DEPLACER]: this.z.deplacer,
        [EFFACER]: this.z.effacer }[this.curseur.type];
      if (actif) {
        ctx.strokeStyle = teinte(Consts.BLACK_BROWN);
        ctx.lineWidth = 1;
        ctx.strokeRect(actif.x - 0.5, actif.y - 0.5, actif.w + 1, actif.h + 1);
      }
      ctx.restore();
      if (this.mode !== MINIMAL) {
        ctx.save();
        ctx.translate(0, lay.menu);
        try { Rendu.dessiner(ctx, 'jama_gui_LevelDesign_MenuBar', 1); } catch (e) {}
        ctx.restore();
        this._dessinerPalette(ctx, lay.barre);
        if (this.mode === FULL) {
          for (const [y, r] of [[200, 90], [329, 270]]) {
            ctx.save();
            ctx.translate(367, y);
            ctx.rotate(r * Math.PI / 180);
            try { Rendu.dessiner(ctx, 'jama_gui_ScrollArrow', 1); } catch (e) {}
            ctx.restore();
          }
        }
      }
      this._dessinerCurseur(ctx, souris);
    }
    _dessinerPalette(ctx, b) {
      ctx.save();
      ctx.translate(0, b);
      try { Rendu.dessiner(ctx, 'jama_gui_LevelDesign_SpriteBar', 1); } catch (e) {}
      ctx.restore();
      // Les sept cases visibles autour de l'élément choisi, sous le masque
      // de la barre (jama_gui_barMask).
      const pas = this.barreW / 7;
      const marge = (pas - Consts.SPRITE_WIDTH) / 2;
      const m = this.masque;
      const mx = 5 + this.barreW / 2, my = b + this.barreH / 2;
      ctx.save();
      ctx.beginPath();
      ctx.rect(mx + m.x, my + m.y, m.w, m.h);
      ctx.clip();
      const py = b + this.barreH / 2 - 10;
      for (let k = 0; k < 7; k++) {
        const i = this.index - 3 + k;
        if (i < 0 || i >= this.palette.length) continue;
        dessinerElement(ctx, this.palette[i], this._planche, true, marge + k * pas, py);
      }
      ctx.restore();
      ctx.save();
      ctx.translate(this.barreW / 2, b + this.barreH / 2);
      try { Rendu.dessiner(ctx, 'jama_gui_lens', 1); } catch (e) {}
      ctx.restore();
    }
    _dessinerCurseur(ctx, souris) {
      // Les curseurs suivent la souris (startDrag) et se cachent sur le panneau.
      const c = this.curseur;
      if (!c || !souris || souris.x < 0 || souris.y < 0 || souris.x > W || souris.y > H) return;
      // Au doigt, pas de pointeur à suivre : le curseur resterait planté sur
      // la dernière case touchée, par-dessus l'élément qu'on vient d'y poser.
      if (auDoigt) return;
      if (this._surPanneau(souris.y)) return;
      const x = souris.x, y = souris.y;
      ctx.save();
      if (c.type === AJOUT) {
        // SpriteCursor : un carré du vert du plateau, l'élément dessus,
        // décalé de 12 points vers le haut et la gauche.
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = teinte(Consts.BACKGROUND);
        ctx.fillRect(x - 12, y - 12, 32, 32);
        dessinerElement(ctx, Object.assign({ pos: new Coord(0, 0) }, c), this._planche, false, x - 12, y - 12);
      } else {
        const pts = c.type === DEPLACER
          ? [[-10, -10], [-5, 10], [0, 0], [10, -5]]
          : [[-10, -10], [-10, -5], [-5, 0], [-10, 5], [-10, 10], [-5, 10], [0, 5], [5, 10], [10, 10],
            [10, 5], [5, 0], [10, -5], [10, -10], [5, -10], [0, -5], [-5, -10]];
        ctx.translate(x, y);
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
        ctx.closePath();
        ctx.fillStyle = c.type === DEPLACER ? '#0000ff' : '#ff0000';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.restore();
    }
    quitter() { this.boite.retirer(); }
  }

  // ── la liste des niveaux du joueur (editlist.EditList, image 2) ──
  //
  // Quinze lignes par page ; après les niveaux du joueur, des cases
  // « ... vide ... » tant qu'il lui en reste (_onSlotListReceived). Un clic
  // choisit (le curseur brun foncé de LevelCursor), un second dans la
  // demi-seconde vaut la clé à molette. L'icône : l'étoile verte tant que le
  // niveau n'est pas validé, le tiki d'or ensuite.
  const PAR_PAGE = 15;
  class EcranListeEdition {
    constructor(niveaux, cases) {
      this.niveaux = niveaux;
      this.cases = cases;
      this.page = 0;
      this.choisi = null;
      this.choisiId = 0;
      this._dernierClic = 0;
      const r = Ecrans.cadreEnfant('jama_GUI_LevelSlot', 1, null);
      this.hauteurLigne = (r && r.h) || 19;
      this.z = {};
      for (const n of ['butPlay', 'butEdit', 'butDelete', 'butProp', 'butPrev', 'butNext']) {
        this.z[n] = Ecrans.cadreEnfant('jama_gui_list', 2, n);
      }
    }
    total() { return Math.min(this.niveaux.length, this.cases); }
    pages() { return Math.max(1, Math.ceil(this.total() / PAR_PAGE)); }
    entrees() {
      const debut = this.page * PAR_PAGE;
      const liste = this.niveaux.slice(debut, debut + PAR_PAGE);
      while (debut + liste.length < this.cases && liste.length < PAR_PAGE) {
        liste.push({ id: -1, titre: Consts.EMPTY_LEVEL_TITLE, vide: true });
      }
      return liste;
    }
    _bouton(quoi) {
      // EditList.onButtonActivated
      const id = this.choisiId, n = this.choisi;
      if (quoi === 'edit') {
        if (id > 0 && !n.valide) return { action: 'editer', entree: n };
        if (id === -1) return { action: 'nouveau' };
        return null;
      }
      if (quoi === 'delete') return id > 0 ? { action: 'supprimer', entree: n } : null;
      if (quoi === 'prop') return id !== 0 && id !== -1 ? { action: 'proprietes', entree: n } : null;
      return null;                            // le bouton de lecture : « aucun effet. :) »
    }
    update(tmod, souris) {
      if (!souris || !souris.clic) return null;
      const { x, y } = souris;
      if (dans(this.z.butPrev, x, y)) { if (this.page > 0) { this.page -= 1; this.choisi = null; this.choisiId = 0; } return null; }
      if (dans(this.z.butNext, x, y)) {
        if (!((this.page + 1) * PAR_PAGE > this.total())) { this.page += 1; this.choisi = null; this.choisiId = 0; }
        return null;
      }
      if (dans(this.z.butEdit, x, y)) return this._bouton('edit');
      if (dans(this.z.butDelete, x, y)) return this._bouton('delete');
      if (dans(this.z.butProp, x, y)) return this._bouton('prop');
      if (dans(this.z.butPlay, x, y)) return null;
      const liste = this.entrees();
      for (let i = 0; i < liste.length; i++) {
        const ly = 50 + (i - 1) * this.hauteurLigne;
        if (y >= ly && y < ly + this.hauteurLigne && x >= 0 && x < W) {
          const avant = this.choisiId, avantLigne = this._ligne;
          this.choisi = liste[i];
          this.choisiId = liste[i].id;
          this._ligne = i;
          const t = Date.now();
          const double = avant === this.choisiId && avantLigne === i && (t - this._dernierClic) < 500;
          this._dernierClic = t;
          return double ? this._bouton('edit') : null;
        }
      }
      return null;
    }
    dessiner(ctx) {
      try {
        Rendu.dessiner(ctx, 'jama_gui_list', 2, {
          champs: { fieldPage: (this.page + 1) + ' / ' + this.pages() },
        });
      } catch (e) {}
      const liste = this.entrees();
      if (this.choisi && this._ligne != null && liste[this._ligne] && liste[this._ligne].id === this.choisiId) {
        ctx.save();
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = teinte(Consts.DARK_BROWN);
        ctx.fillRect(0, 50 + (this._ligne - 1) * this.hauteurLigne, 384, 20);
        ctx.restore();
      }
      for (let i = 0; i < liste.length; i++) {
        const n = liste[i];
        ctx.save();
        ctx.translate(0, 50 + (i - 1) * this.hauteurLigne);
        // La difficulté et le record ne se calculent qu'à la validation.
        const record = n.valide && n.record ? n.record : null;
        try {
          Rendu.dessiner(ctx, 'jama_GUI_LevelSlot', 1, {
            vars: {
              name: n.titre,
              difficulty: record ? String(Math.round(record * (record / 290))) : '-',
              record: record ? String(record) : '-',
            },
            clips: { icon: n.valide ? '2' : '4' },
          });
        } catch (e) {}
        ctx.restore();
      }
    }
  }

  // ══ les ÉTATS ══

  // L'attente réseau : le sablier du fichier (Jama.wait / endWait).
  function attendre(moi, promesse, puis) {
    moi.attente = new Ecrans.Attente();
    return Promise.resolve(promesse).then((d) => { moi.attente = null; puis(d); },
      () => { moi.attente = null; puis({ ok: false, error: 'reseau' }); });
  }

  /** editlist.State : la liste des niveaux du joueur. */
  function EtatEdition(hote) {
    const pf = hote.plateforme;
    const moi = { liste: null, attente: null, fenetre: null, dialogue: null, fiche: null, bandeau: new Bandeau() };
    const recharger = () => attendre(moi, pf.listeEdition(), (d) => {
      if (!d.ok) moi.bandeau.dire(erreur(d));
      const page = moi.liste ? moi.liste.page : 0;
      moi.liste = new EcranListeEdition(d.ok ? d.niveaux : [], d.ok ? d.cases : 0);
      moi.liste.page = Math.min(page, moi.liste.pages() - 1);
    });
    recharger();
    function fermerFenetre() { if (moi.fenetre) moi.fenetre.quitter(); moi.fenetre = null; }

    // _onCreateNewLevel : le titre, puis la taille, puis l'éditeur.
    function nouveau() {
      const niveau = new Level();
      niveau.id = -1;
      niveau.title = Consts.EMPTY_LEVEL_TITLE;
      moi.fenetre = new FenetreSaisie(hote, 'titre', { titre: niveau.title });
      moi.surFenetre = (v) => {
        fermerFenetre();
        if (v === 'annuler') return;
        niveau.title = v.titre === Consts.EMPTY_LEVEL_TITLE || !v.titre.trim() ? Consts.WITHOUT_TITLE : v.titre.trim();
        moi.fenetre = new FenetreSaisie(hote, 'taille',
          { largeur: Consts.MAX_LEVEL_WIDTH, hauteur: Consts.MAX_LEVEL_HEIGHT });
        moi.surFenetre = (t) => {
          fermerFenetre();
          if (t === 'annuler') return;
          niveau.size = new Dimension(t.largeur, t.hauteur);
          hote.passer(EtatEditeur(hote, niveau));
        };
      };
    }
    // _onPropRequest : la fiche d'un niveau validé, le titre sinon.
    function proprietes(n) {
      if (n.valide) {
        const t = pf.tournoi.find((x) => x.id === n.id);
        moi.fiche = new Ecrans.FicheNiveau({
          titre: n.titre, auteur: pf.user, date: n.date, score: n.record, moi: t ? t.moi : null,
        });
        return;
      }
      moi.fenetre = new FenetreSaisie(hote, 'titre', { titre: n.titre });
      moi.surFenetre = (v) => {
        fermerFenetre();
        if (v === 'annuler') return;
        const titre = v.titre === Consts.EMPTY_LEVEL_TITLE || !v.titre.trim() ? Consts.WITHOUT_TITLE : v.titre.trim();
        attendre(moi, pf.renommerNiveau(n.id, titre), (d) => {
          if (!d.ok) moi.bandeau.dire(erreur(d));
          recharger();
        });
      };
    }
    function supprimer(n) {
      moi.dialogue = new Ecrans.Dialogue('confirm', TEXTES.SUPPR_CONFIRM + '"' + n.titre + '"');
      moi.surDialogue = (r) => {
        moi.dialogue = null;
        if (r !== 'oui') return;
        attendre(moi, pf.supprimerNiveau(n.id), (d) => {
          if (!d.ok) moi.bandeau.dire(erreur(d));
          // Un niveau validé quitte aussi le tournoi.
          else pf.tournoi = pf.tournoi.filter((t) => t.id !== n.id);
          recharger();
        });
      };
    }
    function editer(n) {
      const niveau = Level.depuisChaine(n.contenu);
      niveau.id = n.id;
      niveau.title = n.titre;
      hote.passer(EtatEditeur(hote, niveau));
    }

    return {
      nom: 'edition',
      update(tmod) {
        const s = hote.souris;
        moi.bandeau.update(tmod);
        if (moi.attente) { moi.attente.update(tmod); hote.echap(); return; }
        if (moi.fenetre) {
          const v = moi.fenetre.update(tmod, s);
          if (hote.echap()) { moi.surFenetre('annuler'); return; }
          if (v) moi.surFenetre(v);
          return;
        }
        if (moi.dialogue) {
          const r = moi.dialogue.update(tmod, s);
          if (hote.echap()) { moi.surDialogue('non'); return; }
          if (r) moi.surDialogue(r);
          return;
        }
        if (moi.fiche) {
          if (moi.fiche.update(tmod, s) === 'fermer' || hote.echap()) moi.fiche = null;
          return;
        }
        if (hote.echap()) { hote.passer(hote.menu()); return; }
        if (!moi.liste) return;
        const a = moi.liste.update(tmod, s);
        if (!a) return;
        if (a.action === 'nouveau') nouveau();
        else if (a.action === 'editer') editer(a.entree);
        else if (a.action === 'supprimer') supprimer(a.entree);
        else if (a.action === 'proprietes') proprietes(a.entree);
      },
      dessiner() {
        const ctx = hote.ctx;
        if (moi.fenetre) moi.fenetre.dessiner(ctx);
        else if (moi.dialogue) moi.dialogue.dessiner(ctx);
        else {
          if (moi.liste) moi.liste.dessiner(ctx);
          else { ctx.fillStyle = teinte(Consts.BROWN); ctx.fillRect(0, 0, W, H); }
          if (moi.fiche) moi.fiche.dessiner(ctx);
        }
        if (moi.attente) moi.attente.dessiner(ctx, W / 2, H / 2);
        moi.bandeau.dessiner(ctx);
      },
      quitter() { fermerFenetre(); },
    };
  }

  /**
   * editor.State : l'éditeur d'un niveau. `modifie` : l'état de retour d'une
   * partie d'essai (TestState._backToEditor rend la marque « modifié »).
   */
  function EtatEditeur(hote, niveau, modifie) {
    const pf = hote.plateforme;
    const ecran = new EcranEditeur(hote, niveau);
    if (modifie) ecran.terrain.modifie = true;
    const moi = { attente: null, dialogue: null, bandeau: new Bandeau() };
    clavier.actif = true;
    clavier.file = [];

    // getLevel : le plateau, avec l'id et le titre du niveau.
    function niveauCourant() {
      const l = ecran.getLevel();
      l.id = niveau.id;
      l.title = niveau.title;
      return l;
    }
    function partir(etat) {
      clavier.actif = false;
      hote.passer(etat);
    }
    // slotSave : la case reçoit son id au premier enregistrement.
    function sauver(puis) {
      const l = niveauCourant();
      attendre(moi, pf.sauverNiveau(l), (d) => {
        if (!d.ok) { moi.bandeau.dire(erreur(d)); return; }
        niveau.id = d.niveau.id;
        ecran.terrain.modifie = false;
        if (puis) puis();
      });
    }
    function tester() {
      const l = niveauCourant();
      const etaitModifie = ecran.modifie;
      partir(EtatEssai(hote, l, () => {
        hote.passer(EtatEditeur(hote, l, etaitModifie));
      }));
    }
    // validateLevel → validateLevelConfirmed → game.ValidateState.
    function valider() {
      moi.dialogue = new Ecrans.Dialogue('confirm', TEXTES.VALIDATE_WARNING);
      moi.surDialogue = (r) => {
        moi.dialogue = null;
        if (r !== 'oui') return;
        const lancer = () => {
          const l = niveauCourant();
          partir(EtatEssai(hote, l, (bilan) => {
            if (!bilan.victorieux) { hote.passer(EtatEditeur(hote, l, false)); return; }
            // La victoire : le niveau et la partie partent ensemble, le
            // serveur rejoue, puis retour à la liste (_levelValidated).
            const etat = EtatEnvoi(hote, pf.validerNiveau(l, bilan.mouvements), (d) => {
              if (d.ok) hote.passer(EtatEdition(hote));
              else {
                const e = EtatEditeur(hote, l, false);
                e.dire(erreur(d));
                hote.passer(e);
              }
            });
            hote.passer(etat);
          }));
        };
        // Un niveau modifié s'enregistre avant la partie de validation.
        if (ecran.modifie) sauver(lancer);
        else lancer();
      };
    }
    // quitLevel
    function quitter() {
      if (!ecran.modifie) { partir(EtatEdition(hote)); return; }
      moi.dialogue = new DialogueQuitter(TEXTES.QUIT_EDITION);
      moi.surDialogue = (r) => {
        moi.dialogue = null;
        if (r === 'oui') sauver(() => partir(EtatEdition(hote)));
        else if (r === 'non') partir(EtatEdition(hote));
      };
    }

    return {
      nom: 'editeur',
      dire(texte) { moi.bandeau.dire(texte); },
      update(tmod) {
        const s = hote.souris;
        moi.bandeau.update(tmod);
        const touches = clavier.file;
        clavier.file = [];
        // L'aide d'élément est un bloc de page : elle s'efface sous les dialogues.
        if (moi.attente || moi.dialogue) ecran.boite.placer(false);
        if (moi.attente) { moi.attente.update(tmod); hote.echap(); return; }
        if (moi.dialogue) {
          const r = moi.dialogue.update(tmod, s);
          if (hote.echap()) { moi.surDialogue(moi.dialogue instanceof DialogueQuitter ? 'retour' : 'non'); return; }
          if (r) moi.surDialogue(r);
          return;
        }
        if (hote.echap()) { quitter(); return; }
        const a = ecran.update(tmod, s, touches);
        if (a === 'sauver') { if (ecran.modifie) sauver(); }
        else if (a === 'tester') tester();
        else if (a === 'valider') valider();
        else if (a === 'quitter') quitter();
      },
      dessiner() {
        const ctx = hote.ctx;
        if (moi.dialogue) moi.dialogue.dessiner(ctx);
        else ecran.dessiner(ctx, hote.souris);
        if (moi.attente) moi.attente.dessiner(ctx, W / 2, H / 2);
        moi.bandeau.dessiner(ctx);
      },
      quitter() {
        clavier.actif = false;
        ecran.quitter();
      },
    };
  }

  /** Un écran d'attente le temps d'une requête (la validation part au serveur). */
  function EtatEnvoi(hote, promesse, puis) {
    const sablier = new Ecrans.Attente();
    let fini = false;
    Promise.resolve(promesse).then((d) => d, () => ({ ok: false, error: 'reseau' })).then((d) => {
      fini = true;
      puis(d);
    });
    return {
      nom: 'envoi',
      update(tmod) { if (!fini) sablier.update(tmod); hote.echap(); },
      dessiner() {
        const ctx = hote.ctx;
        ctx.fillStyle = teinte(Consts.BLACK_BROWN);
        ctx.fillRect(0, 0, W, H);
        sablier.dessiner(ctx, W / 2, H / 2);
      },
    };
  }

  /**
   * La partie d'ESSAI d'un niveau de l'éditeur — game.TestState (« tester »)
   * et game.ValidateState (« valider ») : la vraie partie de jeu.js, dont
   * l'état d'essai garde la main sur la sortie. La victoire, la défaite,
   * l'abandon ramènent à l'éditeur (`surFin` reçoit le bilan) ; « encore »
   * relance la partie. Rien ne part au classement.
   *
   * jeu.js consulte `intercepter` à chaque changement d'état demandé pendant
   * que l'essai est l'état courant : la partie croit retourner au menu, c'est
   * l'essai qui décide où l'on va.
   */
  function EtatEssai(hote, niveau, surFin) {
    let bilan = null;
    let sortie = false;
    const source = {
      type: 'essai',
      // La plateforme remet à l'essai les mouvements de la partie finie
      // (ou abandonnée) ; on les rejoue pour savoir si elle est gagnée.
      surFin(mouvements) {
        const v = R.rejouer(niveau, mouvements);
        bilan = { victorieux: v.victorieux, fini: v.fini, coups: v.coups, mouvements: mouvements.slice() };
      },
    };
    let partie = hote.partie(niveau, source);
    function partir() {
      if (sortie) return;
      sortie = true;
      surFin(bilan || { victorieux: false, fini: false, coups: 0, mouvements: [] });
    }
    return {
      nom: 'partie',                         // le doigt y joue comme en partie
      update(tmod) {
        if (sortie) return;
        partie.update(tmod);
        // La défaite rend l'éditeur tout de suite, sans « Recommencer ? » :
        // c'est onDefeat de TestState et de ValidateState.
        if (!sortie && bilan && bilan.fini && !bilan.victorieux) partir();
      },
      dessiner() { partie.dessiner(); },
      clicEsc(x, y) { return !!(partie.clicEsc && partie.clicEsc(x, y)); },
      intercepter(nouvel) {
        if (sortie) return false;
        // « encore » : la partie relancée remplace la précédente.
        if (nouvel && nouvel.nom === 'partie') { partie = nouvel; bilan = null; return true; }
        partir();
        return true;
      },
    };
  }

  window.JamaEdition = {
    EtatEdition, EtatEditeur, EtatEssai,
    EcranEditeur, EcranListeEdition, Terrain, FenetreSaisie, DialogueQuitter,
    pose, clavier,
  };
})();
