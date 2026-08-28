/*
  FPBouilleMoteur — le lecteur de frutibouilles, en JavaScript.

  Il tient trois rôles que Flash tenait à lui seul :

    · la LISTE D'AFFICHAGE — des clips imbriqués, chacun avec sa pellicule et
      sa tête de lecture (bouille-swf.js lui donne les ordres image par image) ;
    · le DESSIN — un canevas 2D, à la résolution de l'écran ;
    · la BOUILLE elle-même — le décodage de la chaîne de vingt-quatre caractères,
      les teintes, les huit humeurs et les treize animations, portés au mot près
      depuis le script racine des SWF de famille.

  ── LA CHAÎNE D'ÉTAT ──────────────────────────────────────────────────────
  Vingt-quatre caractères, douze paires en base 62 (0-9 puis a-z puis A-Z) :

     0  famille      2  yeux        4  iris        6  cheveux
     8  bouche      10  couleur1   12  couleur2   14  accessoire
    16  accessoire2 18  accCouleur1 20 accCouleur2 22 accCouleur3

  ── L'ARBRE DU VISAGE ─────────────────────────────────────────────────────
    face
      ├ cb .......... cheveux ARRIÈRE, image = cheveux+1
      │   └ c ....... accessoire, image = accessoire+1
      │       ├ col ..... teinte couleur2      ├ acc ... image = accessoire2+1
      │       └ col3 .... teinte couleur1      └ acc2 .. idem (voir plus bas)
      ├ pb.col ...... peau arrière, teinte couleur1
      ├ pa.col ...... peau avant,   teinte couleur1
      ├ b ........... bouche, image = bouche+1
      │   └ b ....... l'animation de bouche, image = humeurBouche+1
      │       └ col.col . teinte couleur1
      ├ oa, ob ...... yeux, image = yeux+1
      │   └ o ....... l'animation d'œil, image = humeurŒil+1
      │       └ p ... iris, image = iris+1
      └ ca .......... cheveux AVANT, même structure que cb

  ── LA TEINTE D'ÉPOQUE ────────────────────────────────────────────────────
  `FEMC.setColor(mc, {r,g,b})` (frutiengine/FEMC.as, lu dans loader_bouille.swf)
  ne pose PAS un aplat : il pose la transformation de couleur

      ra = ga = ba = 100 %        rb = r - 255, gb = g - 255, bb = b - 255

  autrement dit **sortie = source + (couleur − 255)**, canal par canal. Les
  dessins teintés sont donc peints en gris clairs : le blanc devient exactement
  la couleur de la palette, et les gris plus sombres en donnent les ombres. C'est
  ce décalage — et non un remplissage — qui donne son modelé à une bouille. On le
  calcule ici sur la couleur d'origine de chaque tracé : exact, et sans filtre.

  ── UN BOGUE D'ÉPOQUE CONSERVÉ ────────────────────────────────────────────
  `apply()` cale `ca.c.acc`, `ca.c.acc2` et `cb.c.acc` sur l'accessoire
  secondaire, mais OUBLIE `cb.c.acc2`. Le second accessoire de l'arrière-plan
  reste donc sur sa première image. On ne corrige pas : c'est le rendu d'époque.
*/
(function (global) {
  'use strict';

  const Avm = (typeof module === 'object' && module.exports)
    ? require('./bouille-avm.js') : global.FPBouilleAvm;

  // ── Base 62, comme String.prototype.decode62 du SWF ──────────────────────
  function dec62(c) {
    if (c >= '0' && c <= '9') return c.charCodeAt(0) - 48;
    if (c >= 'a' && c <= 'z') return c.charCodeAt(0) - 87;
    if (c >= 'A' && c <= 'Z') return c.charCodeAt(0) - 29;
    return 0;
  }
  function decode62(s) {
    let v = 0;
    for (let i = 0; i < s.length; i++) v = v * 62 + dec62(s.charAt(i));
    return v;
  }
  function encode62(n, larg) {
    let s = '';
    n = Math.max(0, Math.floor(n));
    while (n > 0) {
      const r = n % 62;
      s = (r < 36 ? r.toString(36) : (r - 26).toString(36).toUpperCase()) + s;
      n = (n - r) / 62;
    }
    while (s.length < (larg || 1)) s = '0' + s;
    return s;
  }

  // ── generalPalette (loader_bouille.swf, _global.generalPalette) ──────────
  const PALETTE = [
    [255, 231, 206], [252, 220, 216], [251, 200, 190], [250, 180, 164], [230, 155, 80],
    [215, 125, 60], [200, 100, 40], [160, 100, 45], [138, 87, 37], [108, 68, 30],
    [75, 48, 20], [230, 215, 150], [220, 200, 115], [210, 185, 80], [180, 230, 125],
    [150, 215, 55], [130, 200, 32], [120, 185, 25], [110, 170, 20], [230, 125, 125],
    [220, 85, 85], [210, 55, 55], [190, 30, 30], [110, 160, 225], [80, 130, 210],
    [50, 105, 175], [150, 100, 200], [121, 61, 182], [95, 55, 150], [250, 225, 60],
    [230, 200, 10], [215, 183, 9], [250, 160, 50], [230, 120, 10], [200, 100, 9],
    [255, 200, 217], [254, 171, 197], [253, 140, 183], [173, 183, 197], [150, 160, 180],
    [110, 125, 150], [205, 200, 172], [185, 177, 142], [162, 152, 104], [169, 202, 168],
    [143, 185, 142], [113, 167, 112], [147, 179, 210], [117, 158, 198], [96, 142, 189],
    [55, 190, 180], [50, 155, 155], [255, 245, 245],
  ];

  // emoteList et actionList du script racine des familles.
  const HUMEURS = [[0, 0], [1, 2], [2, 1], [0, 3], [3, 4], [1, 4], [2, 3], [2, 6]];
  const ANIMATIONS = ['stop', 'parle', 'rire', 'mdr', 'langue', 'rougir', 'regard',
    'siffle', 'gum', 'question', 'miam', 'pleure', 'larme'];
  // Les noms tels que le parc les affiche déjà — ceux du forum (EXPRESSIONS,
  // public/fb/index.html) et de la page de démonstration. Le SWF, lui, ne
  // nomme pas ses humeurs : emoteList n'est qu'un tableau de couples.
  const NOMS_HUMEURS = ['Neutre', 'Colère', 'Triste', 'Sourire', 'Joie',
    'Déterminé', 'Embarrassé', 'Totoché'];
  const NOMS_ANIMATIONS = ['Repos', 'Parler', 'Rire', 'MDR', 'Langue', 'Rougir',
    'Regard', 'Sifflote', 'Chewing-gum', 'Question', 'Miam', 'Pleurer', 'Larme'];
  // actionList nomme « siffle » et « pleure » ce que la pellicule étiquette
  // « sifflote » et « pleurer ». playAnim() vise les étiquettes.
  const ETIQUETTES = { siffle: 'sifflote', pleure: 'pleurer' };

  // ── Transformations de couleur ───────────────────────────────────────────
  const CX_NEUTRE = { mr: 256, mv: 256, mb: 256, ma: 256, ar: 0, av: 0, ab: 0, aa: 0 };
  function composerCx(P, E) {
    if (!P) return E || null;
    if (!E) return P;
    return {
      mr: P.mr * E.mr / 256, mv: P.mv * E.mv / 256,
      mb: P.mb * E.mb / 256, ma: P.ma * E.ma / 256,
      ar: P.mr * E.ar / 256 + P.ar, av: P.mv * E.av / 256 + P.av,
      ab: P.mb * E.ab / 256 + P.ab, aa: P.ma * E.aa / 256 + P.aa,
    };
  }
  // Une teinte FEMC.setColor exprimée en transformation de couleur.
  function cxTeinte(rgb) {
    return { mr: 256, mv: 256, mb: 256, ma: 256,
      ar: rgb[0] - 255, av: rgb[1] - 255, ab: rgb[2] - 255, aa: 0 };
  }
  const borne = (v) => v < 0 ? 0 : (v > 255 ? 255 : v);
  function teindre(rgb, cx) {
    if (!cx) return 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')';
    return 'rgb(' + Math.round(borne(rgb[0] * cx.mr / 256 + cx.ar)) + ','
      + Math.round(borne(rgb[1] * cx.mv / 256 + cx.av)) + ','
      + Math.round(borne(rgb[2] * cx.mb / 256 + cx.ab)) + ')';
  }
  function opacite(a, cx) {
    if (!cx) return a;
    return Math.max(0, Math.min(1, a * cx.ma / 256 + cx.aa / 255));
  }

  // ── Matrices ─────────────────────────────────────────────────────────────
  const IDENTITE = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  function composerM(P, E) {
    return {
      a: P.a * E.a + P.c * E.b, b: P.b * E.a + P.d * E.b,
      c: P.a * E.c + P.c * E.d, d: P.b * E.c + P.d * E.d,
      e: P.a * E.e + P.c * E.f + P.e, f: P.b * E.e + P.d * E.f + P.f,
    };
  }

  // ── L'état d'une pellicule à l'image n ───────────────────────────────────
  //
  // Une image ne fait que MODIFIER la liste d'affichage laissée par la
  // précédente. On résout donc les ordres depuis l'image 1 — une fois pour
  // toutes, le résultat ne dépendant que de la pellicule.
  function etatsDe(def) {
    if (def._etats) return def._etats;
    const etats = [];
    let courant = new Map();
    for (let i = 0; i < def.images.length; i++) {
      courant = new Map(courant);
      for (const ordre of def.images[i]) {
        if (ordre.t === 'retire') courant.delete(ordre.prof);
        else if (ordre.t === 'pose') {
          const avant = courant.get(ordre.prof);
          let ch = ordre.ch, M = ordre.M, nom = ordre.nom,
            masque = ordre.masque, cx = ordre.cx, ratio = ordre.ratio;
          // Un DÉPLACEMENT reprend ce que l'étiquette ne redit pas. L'atelier
          // de Flash écrit aussi « déplacement + caractère » quand une image-clé
          // ne change que le symbole d'un calque : la position déjà en place
          // vaut alors toujours.
          if (ordre.deplace || ch < 0) {
            if (!avant) { if (ch < 0) continue; } else {
              if (ch < 0) ch = avant.ch;
              if (M === null) M = avant.M;
              if (nom === null) nom = avant.nom;
              if (!masque) masque = avant.masque;
              if (cx === null) cx = avant.cx;
              if (ratio === null || ratio === undefined) ratio = avant.ratio;
            }
          }
          if (ch < 0) continue;
          courant.set(ordre.prof, { ch, M: M || IDENTITE, nom: nom || null,
            masque: masque || 0, cx: cx || null, ratio: ratio });
        }
      }
      etats.push(courant);
    }
    def._etats = etats;
    return etats;
  }
  function scriptsDe(def, n) {
    const im = def.images[n - 1];
    if (!im) return null;
    const s = im.filter((o) => o.t === 'script');
    return s.length ? s : null;
  }

  // ── Le clip ──────────────────────────────────────────────────────────────
  function Clip(moteur, def, parent, nom) {
    this.moteur = moteur;
    this.def = def;
    this.parent = parent || null;
    this.nom = nom || null;
    this.frame = 0;
    this.enLecture = true;
    this.neuf = true;
    this.enfants = new Map();          // profondeur → { ch, M, nom, masque, cx, objet }
    this.vars = Object.create(null);
    this.teinte = null;                // {r,g,b} posée par FEMC.setColor
    this.cxPlacement = null;
    this.alpha = 100;
    this.visible = true;
    this.echX = 1; this.echY = 1;      // _xscale/_yscale, en facteur
    this.dx = 0; this.dy = 0;          // décalage de _x/_y par rapport au placement
    this.drot = 0;                     // écart de _rotation, en degrés
    this.M = IDENTITE;
  }

  /*
   * La matrice du clip : son placement, augmenté de ce que les scripts lui ont
   * fait — l'échelle, le décalage, et LA ROTATION.
   *
   * `_rotation` fait tourner le clip dans le repère de son PARENT, autour de sa
   * propre origine : la rotation se compose donc À GAUCHE de la partie linéaire
   * du placement, et la translation n'y touche pas. C'est ce que Flash fait en
   * recomposant a/b/c/d à partir de l'angle et des deux échelles.
   *
   * Elle manquait, et deux accessoires d'époque en dépendent entièrement : la
   * variante 25 de l'accessoire 3 (famille 0) est un moulinet dont les deux
   * pales ne bougent que par script —
   *
   *     image 1 : vit = -(random(5) + 3)          (l'autre pale : random(3) + 2)
   *     image 2 : _parent.col2._rotation += vit
   *     image 3 : gotoAndPlay(_currentframe - 1)
   *
   * — trois images qui posent toutes le même dessin au même endroit. Sans
   * `_rotation`, la pellicule tournait bel et bien, mais l'accessoire restait
   * rigoureusement immobile.
   */
  Clip.prototype.matrice = function () {
    const M = this.M;
    if (this.echX === 1 && this.echY === 1 && !this.dx && !this.dy && !this.drot) return M;
    let a = M.a * this.echX, b = M.b * this.echX, c = M.c * this.echY, d = M.d * this.echY;
    if (this.drot) {
      const r = this.drot * Math.PI / 180, co = Math.cos(r), si = Math.sin(r);
      const a2 = a * co - b * si, b2 = a * si + b * co;
      const c2 = c * co - d * si, d2 = c * si + d * co;
      a = a2; b = b2; c = c2; d = d2;
    }
    return { a, b, c, d, e: M.e + this.dx, f: M.f + this.dy };
  };

  // L'angle DU PLACEMENT, en degrés : ce que `_rotation` vaut avant que le
  // moindre script y touche.
  Clip.prototype.rotationPosee = function () {
    return Math.atan2(this.M.b, this.M.a) * 180 / Math.PI;
  };
  // Flash ramène toujours `_rotation` dans ]-180, 180].
  function angle180(v) {
    v = ((v + 180) % 360 + 360) % 360 - 180;
    return v === -180 ? 180 : v;
  }

  // Boîte englobante LOCALE (avant sa propre matrice) — ce que _width mesure.
  Clip.prototype.boite = function (prof) {
    prof = prof || 0;
    if (prof > 8) return null;
    let b = null;
    for (const e of this.enfants.values()) {
      if (e.masque) continue;
      let sb = null;
      if (e.objet) { const t = e.objet.boite(prof + 1); if (t) sb = t; }
      else {
        const t = this.moteur.formeDe(e.ch, e.ratio);
        if (t) sb = t.f.bounds;
      }
      if (!sb) continue;
      const M = e.objet ? composerM(e.M, ecartClip(e.objet)) : e.M;
      const xs = [sb.x, sb.x + sb.w], ys = [sb.y, sb.y + sb.h];
      for (const x of xs) for (const y of ys) {
        const px = M.a * x + M.c * y + M.e, py = M.b * x + M.d * y + M.f;
        if (!b) b = { x0: px, y0: py, x1: px, y1: py };
        else { b.x0 = Math.min(b.x0, px); b.y0 = Math.min(b.y0, py); b.x1 = Math.max(b.x1, px); b.y1 = Math.max(b.y1, py); }
      }
    }
    return b ? { x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 } : null;
  };
  function ecartClip(c) {
    return { a: c.echX, b: 0, c: 0, d: c.echY, e: c.dx, f: c.dy };
  }

  /*
   * `mc.nom` — LE DERNIER POSÉ GAGNE.
   *
   * Flash range les enfants d'un clip par leur nom d'instance au fur et à
   * mesure des PlaceObject : deux enfants du même nom, et c'est celui de la
   * PLUS HAUTE PROFONDEUR — le dernier posé — que `mc.nom` désigne. Le portage
   * rendait le premier.
   *
   * Un seul endroit s'en soucie dans tout le corpus des familles, mais il
   * existe : `face.ca.c.acc.col3` de l'accessoire 9 variante 5 (famille 0)
   * porte DEUX `col3`. Le portage teignait celui du dessous et laissait celui
   * du dessus dans ses couleurs brutes.
   */
  Clip.prototype.enfantNomme = function (nom) {
    let trouve = null;
    for (const e of this.enfants.values()) if (e.nom === nom && e.objet) trouve = e.objet;
    return trouve;
  };

  // Rejoue les ordres jusqu'à l'image n. Un enfant survit s'il retrouve sa
  // PROFONDEUR avec le MÊME caractère : c'est ainsi que le visage garde ses
  // cheveux et sa bouche pendant les cent-soixante-neuf images d'une animation.
  Clip.prototype.poser = function (n) {
    const etats = etatsDe(this.def);
    const cible = etats[n - 1] || new Map();
    for (const prof of Array.from(this.enfants.keys())) {
      const t = cible.get(prof);
      if (!t || t.ch !== this.enfants.get(prof).ch) this.enfants.delete(prof);
    }
    const neufs = [];
    for (const [prof, p] of cible) {
      let e = this.enfants.get(prof);
      if (!e) {
        e = { ch: p.ch, objet: null };
        const sp = this.moteur.defs.sprites.get(p.ch);
        if (sp) { e.objet = new Clip(this.moteur, sp, this, p.nom); e.objet.poser(1); neufs.push(e.objet); }
        this.enfants.set(prof, e);
      }
      e.M = p.M; e.nom = p.nom; e.masque = p.masque; e.cx = p.cx; e.ratio = p.ratio;
      if (e.objet) { e.objet.nom = p.nom; e.objet.M = p.M; e.objet.cxPlacement = p.cx; }
    }
    this.frame = n;
    // Un clip qui vient d'être posé joue le script de son image 1 : c'est là
    // que dorment les stop() qui figent un accessoire ou une bouche.
    for (const c of neufs) this.moteur.executer(c, 1);
  };

  Clip.prototype.allerImage = function (cadre, jouer) {
    let n;
    if (typeof cadre === 'string' && this.def.labels[cadre]) n = this.def.labels[cadre];
    else {
      n = Math.round(Avm.nombre(cadre));
      if (!(n >= 1)) n = 1;
      if (n > this.def.n) n = this.def.n;
    }
    this.enLecture = !!jouer;
    if (n !== this.frame) this.poser(n);
    this.moteur.executer(this, n);
  };

  /*
   * VRAI si quelque chose, quelque part sous ce clip, a encore une image à
   * jouer.
   *
   * Une tête de lecture arrêtée le RESTE : seule l'exécution d'un script peut
   * la relancer, et un script ne s'exécute qu'au passage d'une image — donc
   * jamais si plus rien n'avance. Un arbre entièrement figé est donc figé pour
   * de bon, tant que personne n'appelle apply(), une humeur ou une animation.
   *
   * C'est ce qui permet de trancher, bouille par bouille, entre l'image fixe
   * (dessinée une fois, au suréchantillonnage plein) et la pellicule vivante.
   */
  Clip.prototype.peutBouger = function (prof) {
    prof = prof || 0;
    if (prof > 12) return false;
    if (this.enLecture && this.def.n > 1) return true;
    for (const e of this.enfants.values()) {
      if (e.objet && e.objet.peutBouger(prof + 1)) return true;
    }
    return false;
  };

  // Rend VRAI si quelque chose a bougé — le lecteur s'en sert pour ne pas
  // redessiner une bouille qui n'a pas changé. Relevé sur les dix familles :
  // une bouille au repos n'a AUCUNE tête de lecture en marche (`apply()` les
  // arrête toutes, une à une) ; seul un accessoire animé en remet une.
  Clip.prototype.avancer = function () {
    let bouge = false;
    if (this.neuf) { this.neuf = false; }
    else if (this.enLecture && this.def.n > 1) {
      const n = this.frame >= this.def.n ? 1 : this.frame + 1;
      this.poser(n);
      this.moteur.executer(this, n);
      bouge = true;
    }
    for (const e of Array.from(this.enfants.values())) if (e.objet && e.objet.avancer()) bouge = true;
    return bouge;
  };

  // ── Le clip vu par l'interpréteur ────────────────────────────────────────
  Clip.prototype.avmGet = function (nom) {
    switch (nom) {
      case '_parent': return this.parent;
      case '_root': return this.moteur.racine;
      case '_currentframe': return this.frame;
      case '_totalframes': return this.def.n;
      case '_name': return this.nom;
      case '_visible': return this.visible;
      case '_alpha': return this.alpha;
      case '_x': return this.M.e + this.dx;
      case '_y': return this.M.f + this.dy;
      case '_xscale': return this.echX * 100;
      case '_yscale': return this.echY * 100;
      case '_rotation': return angle180(this.rotationPosee() + this.drot);
      case '_width': { const b = this.boite(); return b ? b.w * this.echX : 0; }
      case '_height': { const b = this.boite(); return b ? b.h * this.echY : 0; }
      default: break;
    }
    const enf = this.enfantNomme(nom);
    if (enf) return enf;
    return this.vars[nom];
  };
  Clip.prototype.avmSet = function (nom, v) {
    switch (nom) {
      case '_visible': this.visible = Avm.estVrai(v); return;
      case '_alpha': this.alpha = Avm.nombre(v); return;
      case '_x': this.dx = Avm.nombre(v) - this.M.e; return;
      case '_y': this.dy = Avm.nombre(v) - this.M.f; return;
      case '_xscale': this.echX = Avm.nombre(v) / 100; return;
      case '_yscale': this.echY = Avm.nombre(v) / 100; return;
      case '_rotation': this.drot = Avm.nombre(v) - this.rotationPosee(); return;
      case '_width': { const b = this.boite(); if (b && b.w) this.echX = Avm.nombre(v) / b.w; return; }
      case '_height': { const b = this.boite(); if (b && b.h) this.echY = Avm.nombre(v) / b.h; return; }
      default: this.vars[nom] = v;
    }
  };
  Clip.prototype.avmAppel = function (nom, args) {
    switch (nom) {
      case 'play': this.enLecture = true; return undefined;
      case 'stop': this.enLecture = false; return undefined;
      case 'gotoAndStop': this.allerImage(args[0], false); return undefined;
      case 'gotoAndPlay': this.allerImage(args[0], true); return undefined;
      case 'allerImage': this.allerImage(args[0], args[1]); return undefined;
      case 'nextFrame': this.allerImage(this.frame + 1, false); return undefined;
      case 'prevFrame': this.allerImage(this.frame - 1, false); return undefined;
      default: break;
    }
    const v = this.vars[nom];
    if (typeof v === 'function') return v.apply(this, args);
    return undefined;
  };

  // ── Le moteur ────────────────────────────────────────────────────────────
  function Moteur(defs, options) {
    options = options || {};
    this.defs = defs;
    this.alea = options.alea || Math.random;
    this.profondeurScript = 0;
    // Un accessoire « maison » : une liste d'aplats SVG (repère de la scène)
    // qu'un graphiste a dessinés, posée PAR-DESSUS la bouille. Voir
    // exporterAccessoire (la sortie) et bouille-custom.js (l'entrée).
    this.accessoireCustom = options.accessoireCustom || null;
    // Les trois niveaux de couleur d'un accessoire maison (hex) : un tracé marqué
    // slot 1/2/3 se peint avec la couleur correspondante ; les autres gardent la
    // leur. C'est l'analogue des col/col2/col3 des accessoires d'époque.
    this.accessoireCouleurs = options.accessoireCouleurs || null;
    // Les tracés et les morphs calculés se rangent sur la FAMILLE, pas sur le
    // lecteur : une grille de quarante-huit vignettes partage alors un seul jeu
    // de Path2D au lieu d'en reconstruire quarante-huit.
    if (!defs._chemins) defs._chemins = new Map();
    if (!defs._morphsCalcules) defs._morphsCalcules = new Map();
    this.chemins = defs._chemins;
    this.morphsCalcules = defs._morphsCalcules;

    // _root : les variables et les fonctions du script racine des familles.
    const moteur = this;
    this.racine = {
      next: 1, flStop: true, emoteEye: 0, emoteMouth: 0, groumph: 0, s: '',
      face: null, _parent: null,
      avmGet: function (n) {
        if (n === 'face') return this.face;
        if (n === '_root' || n === 'this') return this;
        if (n === '_parent') return null;
        return this[n];
      },
      avmSet: function (n, v) { this[n] = v; },
      avmAppel: function (n, args) {
        if (typeof this[n] === 'function') return this[n].apply(this, args);
        return undefined;
      },
      // endAnim() du SWF remonte à _parent (le porteur, absent ici).
      endAnim: function () { if (moteur.surFinAnim) moteur.surFinAnim(); },
      /*
       * applyColor(mc) — la fonction du script racine (offset 1012 du SWF de
       * famille) :
       *
       *     FEMC.setColor(mc, generalPalette[faceColor])
       *
       * Elle manquait, et c'est elle qui tient tout l'édifice. `apply(s)` ne
       * teinte QU'UNE FOIS, en parcourant l'arbre tel qu'il est à cet instant.
       * Or une pellicule qui change d'image remplace ses pièces : Flash ne
       * garde un enfant que s'il retrouve sa PROFONDEUR avec le MÊME caractère
       * (`Clip.poser` applique la même règle). Dès que la bouche changeait de
       * dessin — une humeur, une animation —, la nouvelle pièce arrivait
       * VIERGE et la bouche perdait sa couleur.
       *
       * L'époque ne rattrape pas le coup après coup : chaque pièce colorée
       * porte, sur SA propre image 1, un script de soixante et onze octets qui
       * rappelle la teinte elle-même —
       *
       *     _parent._parent._parent._parent.applyColor(this.col)
       *
       * soit, depuis `face.b.b.col`, quatre crans jusqu'à la racine. Trente-six
       * pièces le font dans famille0.swf. La teinte revient donc au moment même
       * où la pièce naît, et `Clip.poser` joue déjà le script d'image 1 des
       * clips qu'il vient de créer : il suffisait que la racine sache répondre.
       */
      applyColor: function (mc) {
        if (!mc) return undefined;
        mc.teinte = PALETTE[this.faceColor] || PALETTE[0];
        return undefined;
      },
      playAnim: function (id) { moteur.jouerAnim(id); },
      applyEmote: function (id) { moteur.humeur(id); },
      emote: function () { moteur.appliquerHumeur(); },
      action: function (id) { moteur.action(id); },
      apply: function (s) { moteur.definir(s); },
    };
  }

  Moteur.prototype.executer = function (clip, n) {
    const scripts = scriptsDe(clip.def, n);
    if (!scripts || this.profondeurScript > 12) return;
    this.profondeurScript++;
    try {
      for (const s of scripts) {
        Avm.jouer(s.code, { cible: clip, racine: this.racine, alea: this.alea });
      }
    } finally { this.profondeurScript--; }
  };

  // Le visage : le clip nommé « face » de l'image 2 de la racine.
  Moteur.prototype.creerVisage = function () {
    const etats = etatsDe(this.defs.racine);
    const dernier = etats[etats.length - 1] || new Map();
    let cible = null;
    for (const p of dernier.values()) {
      if (p.nom === 'face') { cible = p; break; }
      if (!cible && this.defs.sprites.has(p.ch)) cible = p;
    }
    if (!cible) throw new Error('pas de clip « face » dans ce SWF de famille');
    const face = new Clip(this, this.defs.sprites.get(cible.ch), this.racine, 'face');
    face.M = cible.M;
    face.poser(1);
    face.enLecture = false;
    this.racine.face = face;
    return face;
  };

  // ── apply(s) — le décodage d'époque, au mot près ─────────────────────────
  Moteur.prototype.definir = function (s) {
    s = String(s || '');
    while (s.length < 24) s += '0';
    const face = this.racine.face || this.creerVisage();
    const P = PALETTE;
    const n = (i) => decode62(s.substring(i, i + 2));
    const eyeId = n(2), eyeSc = n(4), hairId = n(6), mouthId = n(8);
    const faceColor = n(10), secondColor = n(12);
    const accId = n(14), accSecId = n(16);
    const accColor1 = n(18), accColor2 = n(20), accColor3 = n(22);
    this.racine.s = s;
    this.etat = { eyeId, eyeSc, hairId, mouthId, faceColor, secondColor,
      accId, accSecId, accColor1, accColor2, accColor3, famille: n(0) };
    // `apply(s)` du SWF pose ces douze valeurs en VARIABLES DE RACINE — c'est
    // là que `applyColor` va chercher `faceColor` quand une pièce se recolore
    // toute seule. Sans elles, la fonction rendait la palette 0 à tout le monde.
    Object.assign(this.racine, this.etat);

    const ca = face.enfantNomme('ca'), cb = face.enfantNomme('cb');
    const oa = face.enfantNomme('oa'), ob = face.enfantNomme('ob');
    const b = face.enfantNomme('b');
    const pa = face.enfantNomme('pa'), pb = face.enfantNomme('pb');
    const aller = (c, i) => { if (c) c.allerImage(i, false); };

    aller(ca, hairId + 1); aller(cb, hairId + 1);
    const caC = ca && ca.enfantNomme('c'), cbC = cb && cb.enfantNomme('c');
    aller(caC, accId + 1); aller(cbC, accId + 1);
    const caAcc = caC && caC.enfantNomme('acc'), caAcc2 = caC && caC.enfantNomme('acc2');
    const cbAcc = cbC && cbC.enfantNomme('acc'), cbAcc2 = cbC && cbC.enfantNomme('acc2');
    aller(caAcc, accSecId + 1); aller(caAcc2, accSecId + 1); aller(cbAcc, accSecId + 1);
    // cb.c.acc2 n'est PAS calé : bogue d'origine, conservé (cf. en-tête).

    aller(oa, eyeId + 1); aller(ob, eyeId + 1);
    const oaO = oa && oa.enfantNomme('o'), obO = ob && ob.enfantNomme('o');
    aller(oaO && oaO.enfantNomme('p'), eyeSc + 1);
    aller(obO && obO.enfantNomme('p'), eyeSc + 1);
    aller(b, mouthId + 1);
    const bb = b && b.enfantNomme('b');
    if (bb) bb.enLecture = false;

    const cP = (i) => P[i] || P[0];
    const teinter = (c, i) => { if (c) c.teinte = cP(i); };
    teinter(pa && pa.enfantNomme('col'), faceColor);
    teinter(pb && pb.enfantNomme('col'), faceColor);
    const bbCol = bb && bb.enfantNomme('col');
    teinter(bbCol && bbCol.enfantNomme('col'), faceColor);
    teinter(caC && caC.enfantNomme('col'), secondColor);
    teinter(caC && caC.enfantNomme('col3'), faceColor);
    teinter(cbC && cbC.enfantNomme('col'), secondColor);
    teinter(cbC && cbC.enfantNomme('col3'), faceColor);
    /*
     * C'EST L'AVANT QUI DÉCIDE POUR LES DEUX. `apply()` du SWF de famille ne
     * teste QU'UNE visibilité par jeu, celle de la couche AVANT, et teinte
     * ensuite les deux couches :
     *
     *     if (face.ca.c.acc._visible) {
     *       accColor1 → ca.c.acc.col   accColor1 → cb.c.acc.col
     *       accColor2 → ca.c.acc.col2  accColor2 → cb.c.acc.col2
     *       accColor3 → ca.c.acc.col3  accColor3 → cb.c.acc.col3
     *     }
     *     if (face.ca.c.acc2._visible) { … idem pour acc2 …
     *
     * Le portage testait CHAQUE couche séparément : une pièce d'arrière-plan
     * que le SWF cache gardait sa couleur brute là où l'époque la teignait
     * quand même, et l'inverse aussi. Six `setColor` par jeu, sous une seule
     * condition — celle de l'avant.
     */
    const jeu = (avant, arriere) => {
      if (!avant || !avant.visible) return;
      for (const acc of [avant, arriere]) {
        if (!acc) continue;
        teinter(acc.enfantNomme('col'), accColor1);
        teinter(acc.enfantNomme('col2'), accColor2);
        teinter(acc.enfantNomme('col3'), accColor3);
      }
    };
    jeu(caAcc, cbAcc);
    jeu(caAcc2, cbAcc2);
    this.appliquerHumeur();
    return this;
  };

  // ── emote() / applyEmote(id) ─────────────────────────────────────────────
  Moteur.prototype.appliquerHumeur = function () {
    const face = this.racine.face;
    if (!face) return;
    const r = this.racine;
    const b = face.enfantNomme('b'), bb = b && b.enfantNomme('b');
    if (bb) bb.allerImage(r.emoteMouth + 1, false);
    for (const nom of ['oa', 'ob']) {
      const o = face.enfantNomme(nom), oo = o && o.enfantNomme('o');
      if (oo) oo.allerImage(r.emoteEye + 1, false);
    }
  };
  Moteur.prototype.humeur = function (id) {
    const h = HUMEURS[id] || HUMEURS[0];
    this.racine.emoteEye = h[0];
    this.racine.emoteMouth = h[1];
    this.appliquerHumeur();
    return this;
  };

  // ── action(id) / playAnim(id) — porté du script racine ───────────────────
  Moteur.prototype.action = function (id) {
    this.racine.next = id;
    if (this.racine.flStop) this.jouerAnim(id);
    return this;
  };

  Moteur.prototype.jouerAnim = function (id) {
    const face = this.racine.face;
    if (!face) return this;
    if (id === undefined || id === null) id = 1;
    id = Avm.nombre(id);
    const r = this.racine;
    const b = face.enfantNomme('b'), bb = b && b.enfantNomme('b');
    const oa = face.enfantNomme('oa'), ob = face.enfantNomme('ob');
    const oaO = oa && oa.enfantNomme('o'), obO = ob && ob.enfantNomme('o');
    const oeil = (c) => { if (oaO) oaO.allerImage(c, false); if (obO) obO.allerImage(c, false); };
    const oeilJoue = (ca, cb) => { if (oaO) oaO.allerImage(ca, true); if (obO) obO.allerImage(cb, true); };
    const oeilCompt = (v) => { if (oaO) oaO.vars.compt = v; if (obO) obO.vars.compt = v; };
    const muet = () => { if (bb) bb.vars.flMute = true; };

    if (id === 0) {
      r.endAnim();
      r.flStop = true;
      face.allerImage(1, false);
      oeil(r.emoteEye + 1);
      muet();
      if (bb) bb.allerImage(r.emoteMouth + 1, false);
    } else if (id === 1) {
      r.flStop = false;
      face.allerImage('parle', true);
      oeil(r.emoteEye + 1);
      muet();
      if (bb) bb.allerImage('parle' + Math.floor(this.alea() * 4), true);
    } else if (id === 2 || id === 3) {
      const nom = id === 2 ? 'rire' : 'mdr';
      r.flStop = false; r.next = 0;
      face.vars.compt = 4;
      face.allerImage(nom, true);
      oeil(4);
      muet();
      if (bb) bb.allerImage(nom + '0', true);
    } else if (id === 4) {
      r.flStop = false; r.next = 0;
      face.allerImage('langue', true);
      oeil(2);
      if (bb) { bb.allerImage('langue', true); bb.vars.flMute = true; bb.vars.compt = 10; }
    } else if (id === 5) {
      r.flStop = false; r.next = 0;
      face.allerImage('rougir', true);
      oeil(3);
      muet();
      if (bb) bb.allerImage(1, false);
      face.vars.compt = 40;
    } else if (id === 6) {
      r.flStop = false; r.next = 0;
      face.allerImage('regard', true);
      face.vars.compt = 30;
      oeilJoue('regardG', 'regardD');
      muet();
      if (bb) bb.allerImage(r.emoteMouth + 1, false);
      oeilCompt(30);
    } else if (id === 7) {
      r.flStop = false; r.next = 0;
      face.allerImage('sifflote', true);
      oeilJoue('regardH', 'regardH');
      muet();
      if (bb) { bb.allerImage('siffle', true); bb.vars.compt = 7; }
      face.vars.compt = 5;
      oeilCompt(55);
    } else if (id === 8) {
      r.flStop = false; r.next = 0;
      face.allerImage('gum', true);
      oeil(r.emoteEye + 1);
      muet();
      if (bb) bb.allerImage('souffle', false);
    } else if (id === 9) {
      r.flStop = false; r.next = 0;
      face.allerImage('question', false);
      oeilJoue('regardH', 'regardH');
      face.vars.compt = 3;
      muet();
      if (bb) bb.allerImage(2, false);
      oeilCompt(80);
    } else if (id === 10) {
      r.flStop = false; r.next = 0;
      face.vars.compt = 60;
      face.allerImage('miam', true);
      oeil(3);
      muet();
      if (bb) bb.allerImage('bave', true);
    } else if (id === 11) {
      r.flStop = false; r.next = 0;
      face.vars.compt = 4;
      face.allerImage('pleurer', true);
      oeil('ferme');
      muet();
      if (bb) bb.allerImage('rire0', true);
    } else if (id === 12) {
      r.flStop = false; r.next = 0;
      face.allerImage('larme', false);
      oeil('triste');
      muet();
      if (bb) bb.allerImage(2, false);
    }
    return this;
  };

  Moteur.prototype.avancer = function () {
    return this.racine.face ? this.racine.face.avancer() : false;
  };

  /** VRAI tant que l'arbre a une pellicule en marche (cf. Clip.peutBouger). */
  Moteur.prototype.enMouvement = function () {
    return this.racine.face ? this.racine.face.peutBouger() : false;
  };

  // ── Dessin ───────────────────────────────────────────────────────────────
  Moteur.prototype.chemin = function (cle, d) {
    let p = this.chemins.get(cle);
    if (!p) { p = new global.Path2D(d); this.chemins.set(cle, p); }
    return p;
  };

  // Une forme, ordinaire ou INTERPOLÉE. Un morph n'existe qu'à un taux donné —
  // le champ `ratio` du placement, de 0 à 65535 — d'où le calcul à la demande,
  // mis en cache par taux (le fard de « rougir » n'en prend qu'une poignée).
  Moteur.prototype.formeDe = function (ch, ratio) {
    const f = this.defs.formes.get(ch);
    if (f) return { f, cle: String(ch) };
    const m = this.defs.morphs && this.defs.morphs.get(ch);
    if (!m) return null;
    const t = Math.max(0, Math.min(1, (ratio || 0) / 65535));
    const cle = ch + '@' + Math.round(t * 1000);
    let r = this.morphsCalcules.get(cle);
    if (!r) {
      const swf = (typeof module === 'object' && module.exports)
        ? require('./bouille-swf.js') : global.FPBouilleSwf;
      r = swf.interpolerMorph(m, t);
      this.morphsCalcules.set(cle, r);
    }
    return { f: r, cle };
  };

  // L'ÉCHELLE réellement appliquée par le contexte, en pixels par unité de
  // dessin : la racine du déterminant de la transformation courante. C'est elle
  // qui dit la largeur d'un pixel dans le repère où l'on trace.
  function echelleDe(ctx) {
    if (!ctx.getTransform) return 1;
    const T = ctx.getTransform();
    const det = Math.abs(T.a * T.d - T.b * T.c);
    return det > 0 ? Math.sqrt(det) : 1;
  }

  // ── LA COUTURE ────────────────────────────────────────────────────────────
  //
  // Deux aplats voisins d'une même forme partagent leur bord au twip près. Le
  // canevas les peint pourtant l'un APRÈS l'autre : chacun couvre son pixel de
  // bord à moitié et se mélange au FOND, pas à son voisin. Il reste entre les
  // deux un liséré du fond — un cheveu clair qui court le long de chaque
  // contour. Flash ne l'a pas : son rastériseur calcule la couverture de tous
  // les remplissages d'une forme en une passe.
  //
  // Le remède de secours : après le remplissage, repasser le MÊME tracé au
  // trait, de la même couleur, sur une largeur d'un pixel. Les deux aplats se
  // chevauchent alors d'un demi-pixel au lieu de se toucher, et le fond ne passe
  // plus — à 1 pixel par unité, cela ôte 78 % des coutures.
  //
  // Mais il ÉPAISSIT la silhouette d'un demi-pixel, et c'est cher payé : mesuré
  // contre un Flash rendu quatre fois plus grand puis réduit, l'erreur moyenne
  // passe de 0,86 à 1,65 sur 255. Le vrai remède est ailleurs — dans le
  // suréchantillonnage (cf. Bouille.rendre), qui descend les coutures à 0,55 %
  // des pixels, SOUS les 0,63 % que Flash lui-même affiche à la même aune, et
  // sans toucher à la géométrie.
  //
  // Le liséré ne sert donc plus que de filet : on ne l'arme que lorsque le
  // suréchantillonnage n'a pas pu se faire (facteur 1).
  const LISERE = 1.0;                    // largeur du raccord, en pixels écran

  Moteur.prototype.dessinerForme = function (ctx, id, M, cx, alpha, ratio) {
    const t = this.formeDe(id, ratio);
    if (!t) return;
    const f = t.f, id2 = t.cle;
    ctx.save();
    ctx.transform(M.a, M.b, M.c, M.d, M.e, M.f);
    const raccord = this.antiCouture === false ? 0 : LISERE / echelleDe(ctx);
    for (let i = 0; i < f.couches.length; i++) {
      const c = f.couches[i];
      const p = this.chemin(id2 + ':' + i, c.d);
      const o = opacite(c.alpha, cx) * alpha;
      if (o <= 0) continue;
      ctx.globalAlpha = o;
      if (c.trait) {
        ctx.strokeStyle = teindre(c.rgb, cx);
        ctx.lineWidth = c.largeur;
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.stroke(p);
      } else if (c.degrade) {
        ctx.fillStyle = this.degrade(ctx, c.degrade, cx);
        ctx.save();
        const G = c.degrade.M;
        ctx.transform(G.a / 20, G.b / 20, G.c / 20, G.d / 20, G.e / 20, G.f / 20);
        const pg = p2dDegrade(this, id2, i, c, G);
        ctx.fill(pg, 'evenodd');
        if (raccord) {
          // Le tracé du dégradé vit dans le repère du dégradé : le liséré s'y
          // mesure à l'échelle de CE repère.
          ctx.strokeStyle = ctx.fillStyle;
          ctx.lineWidth = LISERE / echelleDe(ctx);
          ctx.lineJoin = 'round'; ctx.lineCap = 'round';
          ctx.stroke(pg);
        }
        ctx.restore();
      } else {
        ctx.fillStyle = teindre(c.rgb, cx);
        ctx.fill(p, 'evenodd');
        if (raccord) {
          ctx.strokeStyle = ctx.fillStyle;
          ctx.lineWidth = raccord;
          ctx.lineJoin = 'round'; ctx.lineCap = 'round';
          ctx.stroke(p);
        }
      }
    }
    ctx.restore();
  };

  // Un dégradé se peint dans SON repère : le carré de 32768 twips centré sur
  // l'origine, envoyé par la matrice du style. On y entre, donc le tracé doit
  // faire le chemin inverse — d'où ce tracé pré-transformé, mis en cache.
  function p2dDegrade(moteur, id, i, c, G) {
    const cle = 'g' + id + ':' + i;
    let p = moteur.chemins.get(cle);
    if (!p) {
      const det = (G.a * G.d - G.b * G.c) / 400;
      const m = det ? new global.DOMMatrix([G.a / 20, G.b / 20, G.c / 20, G.d / 20, G.e / 20, G.f / 20]).inverse()
        : new global.DOMMatrix();
      p = new global.Path2D();
      p.addPath(new global.Path2D(c.d), m);
      moteur.chemins.set(cle, p);
    }
    return p;
  }

  Moteur.prototype.degrade = function (ctx, g, cx) {
    const arrets = g.arrets;
    const grad = g.radial
      ? ctx.createRadialGradient(g.focale * 16384, 0, 0, 0, 0, 16384)
      : ctx.createLinearGradient(-16384, 0, 16384, 0);
    for (const a of arrets) {
      const col = teindre(a.rgb, cx);
      const o = opacite(a.alpha, cx);
      grad.addColorStop(Math.max(0, Math.min(1, a.ratio / 255)),
        o < 1 ? col.replace('rgb(', 'rgba(').replace(')', ',' + Math.round(o * 1000) / 1000 + ')') : col);
    }
    return grad;
  };

  // Dessine un clip : ses enfants par profondeur croissante, avec les masques.
  Moteur.prototype.dessinerClip = function (ctx, clip, M, cx, alpha) {
    if (!clip.visible) return;
    const mc = clip.teinte ? cxTeinte(clip.teinte) : clip.cxPlacement;
    const cxi = composerCx(cx, mc || null);
    const ai = alpha * (clip.alpha / 100);
    if (ai <= 0) return;
    const Mi = composerM(M, clip.matrice());
    const profs = Array.from(clip.enfants.keys()).sort((a, b) => a - b);
    let i = 0;
    while (i < profs.length) {
      const e = clip.enfants.get(profs[i]);
      if (e.masque) {
        // Le masque découpe les profondeurs qui vont de la sienne à sa
        // profondeur de découpe — et ne se dessine pas lui-même.
        const chemin = new global.Path2D();
        this.accumuler(chemin, e, Mi);
        ctx.save();
        ctx.clip(chemin, 'evenodd');
        i++;
        while (i < profs.length && profs[i] <= e.masque) {
          this.dessinerEnfant(ctx, clip.enfants.get(profs[i]), Mi, cxi, ai);
          i++;
        }
        ctx.restore();
        continue;
      }
      this.dessinerEnfant(ctx, e, Mi, cxi, ai);
      i++;
    }
  };

  Moteur.prototype.dessinerEnfant = function (ctx, e, M, cx, alpha) {
    if (e.objet) this.dessinerClip(ctx, e.objet, M, cx, alpha);
    else this.dessinerForme(ctx, e.ch, composerM(M, e.M), composerCx(cx, e.cx || null), alpha, e.ratio);
  };

  // Accumule le TRACÉ d'un masque (toutes ses formes, matrices comprises) dans
  // le repère du canevas, pour en faire une découpe.
  Moteur.prototype.accumuler = function (chemin, e, M, prof) {
    prof = prof || 0;
    if (prof > 8) return;
    if (e.objet) {
      const Mi = composerM(composerM(M, e.M ? IDENTITE : IDENTITE), e.objet.matrice());
      for (const s of e.objet.enfants.values()) this.accumuler(chemin, s, Mi, prof + 1);
      return;
    }
    const t = this.formeDe(e.ch, e.ratio);
    if (!t) return;
    const A = composerM(M, e.M);
    const m = new global.DOMMatrix([A.a, A.b, A.c, A.d, A.e, A.f]);
    for (let i = 0; i < t.f.couches.length; i++) {
      if (t.f.couches[i].trait) continue;
      chemin.addPath(this.chemin(t.cle + ':' + i, t.f.couches[i].d), m);
    }
  };

  Moteur.prototype.dessiner = function (ctx, M) {
    const face = this.racine.face;
    if (!face) return;
    const ac = this.accessoireCustom;
    // Un accessoire « maison » a deux couches, comme celui d'époque : l'ARRIÈRE
    // (p.avant === false) passe DERRIÈRE les cheveux de devant, l'AVANT par-
    // dessus tout. Sans couche arrière, on garde le chemin simple.
    const arriere = ac ? ac.filter((p) => p.avant === false) : null;
    if (arriere && arriere.length) {
      this.dessinerFaceAvecArriere(ctx, face, M || IDENTITE, arriere);
    } else {
      this.dessinerClip(ctx, face, M || IDENTITE, null, 1);
    }
    if (ac) {
      const avant = ac.filter((p) => p.avant !== false);
      if (avant.length) this.dessinerAccessoireCustom(ctx, avant);
    }
  };

  // L'accessoire ARRIÈRE se glisse là où le SWF met `cb.c` : derrière les cheveux
  // de devant (`ca`), mais devant le visage. On dessine tout SAUF ca, on pose
  // l'arrière, puis ca par-dessus. (Un bandeau sous la frange se range là.)
  Moteur.prototype.dessinerFaceAvecArriere = function (ctx, face, M, arriere) {
    let eCa = null;
    for (const e of face.enfants.values()) if (e.nom === 'ca') eCa = e;
    const ca = eCa && eCa.objet;
    let vis;
    if (ca) { vis = ca.visible; ca.visible = false; }
    this.dessinerClip(ctx, face, M, null, 1);              // tout sauf ca
    if (ca) ca.visible = vis;
    this.dessinerAccessoireCustom(ctx, arriere);           // l'accessoire arrière
    if (ca) {                                              // puis ca (cheveux devant)
      const mc = face.teinte ? cxTeinte(face.teinte) : face.cxPlacement;
      const cxi = composerCx(null, mc || null);
      const ai = face.alpha / 100;
      const Mi = composerM(M, face.matrice());
      this.dessinerEnfant(ctx, eCa, Mi, cxi, ai);
    }
  };

  // ── Accessoire custom : peindre les aplats SVG d'un graphiste ──────────────
  // Les tracés arrivent DÉJÀ dans le repère de la scène (le viewBox de l'export
  // = defs.scene) : on les remplit tels quels. On ne cache pas les Path2D sur la
  // FAMILLE (defs._chemins est partagé entre toutes les bouilles) — chaque tracé
  // garde le sien sur lui.
  Moteur.prototype.dessinerAccessoireCustom = function (ctx, paths) {
    paths = paths || this.accessoireCustom;
    if (!paths || !paths.length) return;
    for (let i = 0; i < paths.length; i++) {
      const p = paths[i];
      if (!p._p2d) { try { p._p2d = new global.Path2D(p.d); } catch (e) { continue; } }
      ctx.save();
      // Un tracé importé garde SON repère (celui de ses groupes Illustrator) :
      // on applique sa matrice `m` par-dessus le repère scène→canevas. L'export,
      // lui, émet déjà en repère scène (pas de m) — les deux passent par ici.
      if (p.m) ctx.transform(p.m[0], p.m[1], p.m[2], p.m[3], p.m[4], p.m[5]);
      ctx.globalAlpha = (p.alpha == null ? 1 : p.alpha);
      // Un tracé « à niveau » (slot 1/2/3) prend la couleur du niveau si elle est
      // fournie ; sinon il garde la sienne.
      const teinte = (p.slot && this.accessoireCouleurs && this.accessoireCouleurs[p.slot - 1])
        ? this.accessoireCouleurs[p.slot - 1] : p.fill;
      if (p.trait) {
        ctx.strokeStyle = teinte; ctx.lineWidth = p.largeur || 1;
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        ctx.stroke(p._p2d);
      } else {
        ctx.fillStyle = teinte;
        ctx.fill(p._p2d, 'evenodd');
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  };

  // ── EXPORT : l'accessoire APLATI en tracés SVG (repère de la scène) ─────────
  //
  // On refait la marche de dessinerClip — mêmes matrices, mêmes teintes, même
  // ordre de profondeur — mais au lieu de peindre, on émet pour chaque aplat
  // SOUS UN ROULEAU d'accessoire (face.ca.c à l'avant, face.cb.c à l'arrière)
  // un { d, fill, alpha }. Le résultat est l'accessoire exactement tel qu'il se
  // voit, dans le repère de la scène (donc du viewBox) : prêt pour Illustrator.
  //
  // Le rouleau `c` est l'enfant nommé « c » d'une coiffure (`ca`/`cb`). Tout ce
  // qui en descend est l'accessoire ; le reste (cheveux, visage, yeux) est
  // ignoré. Les dégradés sont aplatis à leur première couleur (v1) ; les masques
  // ne sont pas rejoués (un accessoire n'en porte pas d'ordinaire).
  Moteur.prototype.exporterAccessoire = function () {
    const self = this;
    const face = this.racine.face;
    const sortie = [];
    if (!face) return { scene: this.defs.scene, paths: sortie };
    const R = (v) => Math.round(v * 100) / 100;
    function transformer(d, m) {
      return d.replace(/([MLQ])([^MLQZ]*)/g, function (_, cmd, args) {
        const n = args.trim().split(/[\s,]+/).filter((s) => s.length).map(Number);
        const out = [];
        for (let i = 0; i < n.length; i += 2) {
          const x = n[i], y = n[i + 1];
          out.push(R(m.a * x + m.c * y + m.e), R(m.b * x + m.d * y + m.f));
        }
        return cmd + out.join(' ');
      });
    }
    function emettre(ch, M, cx, alpha, ratio, avant) {
      const t = self.formeDe(ch, ratio);
      if (!t) return;
      for (let i = 0; i < t.f.couches.length; i++) {
        const c = t.f.couches[i];
        const o = opacite(c.alpha, cx) * alpha;
        if (o <= 0) continue;
        const p = { avant: avant, alpha: Math.round(o * 1000) / 1000, d: transformer(c.d, M) };
        if (c.trait) { p.trait = true; p.largeur = c.largeur; p.fill = teindre(c.rgb, cx); }
        else if (c.degrade) {
          const a0 = c.degrade.arrets && c.degrade.arrets[0];
          p.fill = teindre((a0 && a0.rgb) || [136, 136, 136], cx);
        } else p.fill = teindre(c.rgb, cx);
        sortie.push(p);
      }
    }
    function marcher(clip, M, cx, alpha, ctxt) {
      if (!clip.visible) return;
      const mc = clip.teinte ? cxTeinte(clip.teinte) : clip.cxPlacement;
      const cxi = composerCx(cx, mc || null);
      const ai = alpha * (clip.alpha / 100);
      if (ai <= 0) return;
      const Mi = composerM(M, clip.matrice());
      const profs = Array.from(clip.enfants.keys()).sort((a, b) => a - b);
      for (let k = 0; k < profs.length; k++) {
        const e = clip.enfants.get(profs[k]);
        let sous = ctxt;
        if (ctxt === 'r' && e.nom === 'ca') sous = 'Cav';
        else if (ctxt === 'r' && e.nom === 'cb') sous = 'Car';
        else if (ctxt === 'Cav' && e.nom === 'c') sous = 'Rav';
        else if (ctxt === 'Car' && e.nom === 'c') sous = 'Rar';
        if (e.objet) marcher(e.objet, Mi, cxi, ai, sous);
        else if (sous === 'Rav' || sous === 'Rar') {
          emettre(e.ch, composerM(Mi, e.M), composerCx(cxi, e.cx || null), ai, e.ratio, sous === 'Rav');
        }
      }
    }
    marcher(face, IDENTITE, null, 1, 'r');
    return { scene: Object.assign({}, this.defs.scene), paths: sortie };
  };

  // ── L'objet public ───────────────────────────────────────────────────────
  //
  // Une bouille attachée à un canevas : elle se redimensionne toute seule à la
  // densité de l'écran, et n'anime que lorsqu'on le lui demande.
  function Bouille(canvas, defs, options) {
    options = options || {};
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.moteur = new Moteur(defs, options);
    this.moteur.creerVisage();
    this.cadence = defs.cadence || 40;
    this.taille = options.taille || defs.scene.w || 100;
    this.fond = options.fond || null;
    /*
     * LES DEUX FINESSES.
     *
     * `super` est le facteur de suréchantillonnage demandé (cf. plus bas). Une
     * bouille IMMOBILE se dessine une seule fois : elle se paie le ×4 sans
     * compter. Une bouille qui TOURNE se redessine quarante fois par seconde,
     * et le ×4 y coûte quatre fois plus de pixels pour une différence que l'œil
     * ne voit pas en mouvement — on la met à ×2.
     *
     * On ne choisit donc pas à la construction mais à chaque changement d'état,
     * dans `ajuster()`, selon ce que l'arbre a réellement à jouer. Un `super`
     * explicite (les relevés) fige les deux valeurs : un relevé doit rendre ce
     * qu'on lui demande.
     */
    this.superRepos = options.super === undefined ? 4 : Math.max(1, options.super | 0);
    this.superAnime = options.super === undefined ? 2 : this.superRepos;
    this.superDemande = this.superRepos;
    this.couturesForcees = options.antiCouture;      // undefined = automatique
    /*
     * `anime` — ce que la bouille a le DROIT de faire, pas ce qu'elle fait :
     *
     *   false  la boucle est interdite. Les planches de relevés
     *          (bouille-js.html) avancent le moteur à la main, image par image ;
     *   true   la bouille est destinée à jouer des animations (la réaction qui
     *          passe sur le chat) : on lui laisse la finesse de mouvement même
     *          entre deux réactions, pour ne pas refaire ses tampons à chaque
     *          fois ;
     *   absent AUTOMATIQUE — et c'est le cas courant. `ajuster()` demande à
     *          l'arbre s'il a quelque chose à jouer : un accessoire animé, une
     *          humeur en cours, une animation. Sinon, image fixe.
     *
     * C'était `anime !== false` : toute vignette posée restait figée, et les
     * accessoires animés d'époque (famille 0 : 3, 6, 10) ne tournaient nulle
     * part — ni sur la fiche, ni dans l'éditeur, ni dans un salon.
     */
    this.anime = options.anime === undefined ? null : !!options.anime;
    this.enMarche = false;
    this.calme = 0;
    this.attache = false;
    this._boucle = null;
    this.moteur.surFinAnim = options.surFinAnim || null;
    if (options.etat) this.moteur.definir(options.etat);
    if (options.humeur) this.moteur.humeur(options.humeur);
    this.redimensionner();
    this.ajuster();
    this.rendre();
  }

  /*
   * Faut-il faire tourner cette bouille, et à quelle finesse ?
   *
   * Appelée après tout ce qui peut remettre une pellicule en marche — la
   * construction, apply(), une humeur, une animation — et par la boucle
   * elle-même quand plus rien ne bouge, pour qu'elle s'éteigne d'elle-même et
   * rende à la bouille sa finesse de repos.
   *
   * Rend VRAI quand les tampons ont changé de taille : l'appelant doit alors
   * redessiner.
   */
  Bouille.prototype.ajuster = function () {
    const vivante = this.anime === false ? false : this.moteur.enMouvement();
    const sup = (vivante || this.anime === true) ? this.superAnime : this.superRepos;
    let refaire = false;
    if (sup !== this.superDemande) { this.superDemande = sup; this.redimensionner(); refaire = true; }
    if (vivante) this.demarrer(); else this.arreter();
    return refaire;
  };

  // ── LE SURÉCHANTILLONNAGE ────────────────────────────────────────────────
  //
  // Une bouille s'affiche petite — quarante pixels dans la barre de contacts,
  // quatre-vingts sur le bureau — et elle est faite de courbes. À cette taille,
  // l'anticrénelage du canevas décide seul du sort de chaque contour, et le
  // liséré de raccord (cf. dessinerForme) se voit encore.
  //
  // On dessine donc dans un TAMPON plus grand que la vignette, et on le réduit
  // d'un coup : chaque pixel affiché est alors la moyenne de n × n pixels
  // calculés. Les contours y gagnent la finesse que Flash tirait de son propre
  // rastériseur, et le liséré passe sous le seuil du visible.
  //
  // Le facteur suit la taille FINALE : une vignette peut se permettre quatre
  // fois plus de pixels, une grande vue n'en a pas besoin (elle en a déjà).
  // Le facteur est une PUISSANCE DE DEUX, et la réduction se fait par
  // demi-tailles successives. Ce n'est pas une coquetterie : réduire d'un coup
  // d'un facteur 3 ou 5 laisse le navigateur choisir son filtre, et le résultat
  // est nettement moins bon qu'une suite de moitiés — chacune étant, elle, une
  // moyenne exacte de quatre pixels. Mesuré contre un Flash rendu six fois plus
  // grand : 0,46 d'erreur moyenne en puissance de deux contre 0,77 à 0,91
  // autrement.
  function facteurPour(cote, demande) {
    let f = 1;
    while (f * 2 <= demande && cote * f * 2 <= 2048) f *= 2;
    return f;
  }

  Bouille.prototype.redimensionner = function () {
    const dpr = global.devicePixelRatio || 1;
    const css = this.canvas.clientWidth || this.taille;
    const cssH = this.canvas.clientHeight || this.taille;
    const l = Math.max(1, Math.round(css * dpr)), h = Math.max(1, Math.round(cssH * dpr));
    if (this.canvas.width !== l || this.canvas.height !== h) {
      this.canvas.width = l; this.canvas.height = h;
    }
    this.facteur = facteurPour(Math.max(l, h), this.superDemande);
    // Le liséré de raccord ne s'arme que sans suréchantillonnage : ailleurs il
    // épaissirait la silhouette pour rien (cf. le commentaire de LISERE).
    this.moteur.antiCouture = this.couturesForcees === undefined
      ? this.facteur === 1 : !!this.couturesForcees;
    if (this.facteur > 1) {
      if (!this.tampon) {
        this.tampon = global.document
          ? global.document.createElement('canvas') : null;
        if (this.tampon) this.ctxTampon = this.tampon.getContext('2d');
      }
      if (this.tampon) {
        const tl = l * this.facteur, th = h * this.facteur;
        if (this.tampon.width !== tl || this.tampon.height !== th) {
          this.tampon.width = tl; this.tampon.height = th;
        }
      } else this.facteur = 1;
    }
    return this;
  };

  /** Un des deux tampons de service de la réduction par moitiés. */
  Bouille.prototype.tamponDeService = function (i, l, h) {
    if (!this.service) this.service = [];
    let c = this.service[i];
    if (!c) { c = global.document.createElement('canvas'); this.service[i] = c; }
    if (c.width !== l || c.height !== h) { c.width = l; c.height = h; }
    return c;
  };

  Bouille.prototype.rendre = function () {
    const sc = this.moteur.defs.scene;
    const f = this.facteur || 1;
    const W = this.canvas.width, H = this.canvas.height;
    const ctx = f > 1 ? this.ctxTampon : this.ctx;
    const w = W * f, h = H * f;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (this.fond) { ctx.fillStyle = this.fond; ctx.fillRect(0, 0, w, h); }
    const k = Math.min(w / sc.w, h / sc.h);
    // Flash cale la scène au CENTRE de sa fenêtre quand les rapports diffèrent
    // (`scaleMode = "showAll"`). Sans ce décalage, une boîte non carrée — celle
    // de l'aperçu de pack de l'admin fait 160 × 180 — collerait la bouille en
    // haut à gauche et mettrait toute la marge du même côté. Sur une boîte
    // carrée, dx et dy valent zéro : rien ne change.
    const dx = (w - sc.w * k) / 2, dy = (h - sc.h * k) / 2;
    ctx.setTransform(k, 0, 0, k, dx - sc.x * k, dy - sc.y * k);
    this.moteur.dessiner(ctx, IDENTITE);
    if (f > 1) {
      // Réduction par MOITIÉS, d'un tampon vers un autre. Replier un canevas
      // sur lui-même ne réduit rien : la source et la destination se
      // chevauchent, et le navigateur rend la vignette d'origine. On alterne
      // donc deux tampons de service.
      let src = this.tampon, sw = w, sh = h, tour = 0;
      while (sw > W * 2) {
        const nw = sw >> 1, nh = sh >> 1;
        const dst = this.tamponDeService(tour, nw, nh);
        const c2 = dst.getContext('2d');
        c2.setTransform(1, 0, 0, 1, 0, 0);
        c2.globalAlpha = 1;
        c2.clearRect(0, 0, nw, nh);
        c2.imageSmoothingEnabled = true;
        c2.imageSmoothingQuality = 'high';
        c2.drawImage(src, 0, 0, sw, sh, 0, 0, nw, nh);
        src = dst; sw = nw; sh = nh; tour ^= 1;
      }
      const d = this.ctx;
      d.setTransform(1, 0, 0, 1, 0, 0);
      d.globalAlpha = 1;
      d.clearRect(0, 0, W, H);
      d.imageSmoothingEnabled = true;
      d.imageSmoothingQuality = 'high';
      d.drawImage(src, 0, 0, sw, sh, 0, 0, W, H);
    }
    return this;
  };

  // Les trois portes qui peuvent remettre une pellicule en marche — ou l'en
  // retirer : chacune repasse par `ajuster()`.
  Bouille.prototype.definir = function (etat) { this.moteur.definir(etat); this.ajuster(); return this.rendre(); };
  Bouille.prototype.humeur = function (id) { this.moteur.humeur(id); this.ajuster(); return this.rendre(); };
  Bouille.prototype.animer = function (id) {
    if (typeof id === 'string') id = Math.max(0, ANIMATIONS.indexOf(id));
    this.moteur.action(id);
    // `ajuster` peut refaire les tampons (la finesse change) : sans ce rendu,
    // le canevas resterait vide jusqu'à la première image qui bouge.
    if (this.ajuster()) this.rendre();
    return this;
  };
  Bouille.prototype.etat = function () { return this.moteur.etat; };

  // Une seconde de calme plat avant de se demander si l'on peut s'éteindre :
  // quarante images, la longueur d'une pellicule d'accessoire.
  const CALME_MAX = 40;

  Bouille.prototype.demarrer = function () {
    if (this.enMarche) return this;
    this.enMarche = true;
    this.calme = 0;
    const self = this;
    let precedent = (global.performance || Date).now();
    let reste = 0;
    const pas = 1000 / this.cadence;
    (function tic() {
      if (!self.enMarche) return;
      self._boucle = global.requestAnimationFrame(tic);
      // Un canevas qui a QUITTÉ le document n'a plus rien à dessiner. Le bureau
      // remplace des écrans de salon sans prévenir personne (`vieux.remove()`),
      // et le chat refait sa scène de réaction : sans ce garde-fou, chaque
      // remplacement laisserait une boucle tourner pour un canevas invisible.
      if (self.attache) { if (!self.canvas.isConnected) { self.arreter(); return; } }
      else if (self.canvas.isConnected !== false) self.attache = true;
      const t = (global.performance || Date).now();
      reste += Math.min(200, t - precedent);
      precedent = t;
      let bouge = false;
      while (reste >= pas) { reste -= pas; if (self.moteur.avancer()) bouge = true; }
      if (bouge) { self.calme = 0; self.rendre(); return; }
      // Rien n'a bougé depuis une seconde : l'animation est finie. Si l'arbre
      // n'a plus rien à jouer, la boucle s'éteint et la bouille reprend sa
      // finesse de repos — c'est le pendant de `ajuster()`, vu du lecteur.
      if (++self.calme > CALME_MAX) {
        self.calme = 0;
        if (self.ajuster()) self.rendre();
      }
    })();
    return this;
  };
  Bouille.prototype.arreter = function () {
    this.enMarche = false;
    if (this._boucle) global.cancelAnimationFrame(this._boucle);
    this._boucle = null;
    return this;
  };

  Bouille.prototype.enMouvement = function () { return this.moteur.enMouvement(); };

  const API = {
    Moteur, Bouille, Clip,
    PALETTE, HUMEURS, ANIMATIONS, NOMS_HUMEURS, NOMS_ANIMATIONS, ETIQUETTES,
    decode62, encode62, teindre, cxTeinte, composerCx, composerM, etatsDe, facteurPour,
    /** Famille d'une chaîne d'état : les deux premiers caractères, en base 62. */
    familleDe: function (s) { return decode62(String(s || '00').substring(0, 2)); },
    /** Attache une bouille à un canevas, la famille étant chargée à la volée. */
    creer: function (canvas, etat, options) {
      options = options || {};
      const swf = (typeof module === 'object' && module.exports)
        ? require('./bouille-swf.js') : global.FPBouilleSwf;
      const dossier = options.dossier || '/fbouille/';
      const fam = API.familleDe(etat);
      return swf.charger(dossier + 'famille' + fam + '.swf').then(function (defs) {
        const o = Object.assign({}, options);
        o.etat = etat;
        return new Bouille(canvas, defs, o);
      });
    },
  };

  if (typeof module === 'object' && module.exports) module.exports = API;
  else global.FPBouilleMoteur = API;
})(typeof window !== 'undefined' ? window : globalThis);
