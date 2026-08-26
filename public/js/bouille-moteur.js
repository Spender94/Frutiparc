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
    this.M = IDENTITE;
  }

  Clip.prototype.matrice = function () {
    const M = this.M;
    if (this.echX === 1 && this.echY === 1 && !this.dx && !this.dy) return M;
    return { a: M.a * this.echX, b: M.b * this.echX, c: M.c * this.echY, d: M.d * this.echY,
      e: M.e + this.dx, f: M.f + this.dy };
  };

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

  Clip.prototype.enfantNomme = function (nom) {
    for (const e of this.enfants.values()) if (e.nom === nom) return e.objet || null;
    return null;
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

  Clip.prototype.avancer = function () {
    if (this.neuf) { this.neuf = false; }
    else if (this.enLecture && this.def.n > 1) {
      const n = this.frame >= this.def.n ? 1 : this.frame + 1;
      this.poser(n);
      this.moteur.executer(this, n);
    }
    for (const e of Array.from(this.enfants.values())) if (e.objet) e.objet.avancer();
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
    this.chemins = new Map();          // clé de tracé → Path2D

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
    for (const acc of [caAcc, cbAcc]) {
      if (!acc || !acc.visible) continue;
      teinter(acc.enfantNomme('col'), accColor1);
      teinter(acc.enfantNomme('col2'), accColor2);
      teinter(acc.enfantNomme('col3'), accColor3);
    }
    for (const acc of [caAcc2, cbAcc2]) {
      if (!acc || !acc.visible) continue;
      teinter(acc.enfantNomme('col'), accColor1);
      teinter(acc.enfantNomme('col2'), accColor2);
      teinter(acc.enfantNomme('col3'), accColor3);
    }
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
    if (this.racine.face) this.racine.face.avancer();
    return this;
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
    if (!this.morphsCalcules) this.morphsCalcules = new Map();
    let r = this.morphsCalcules.get(cle);
    if (!r) {
      const swf = (typeof module === 'object' && module.exports)
        ? require('./bouille-swf.js') : global.FPBouilleSwf;
      r = swf.interpolerMorph(m, t);
      this.morphsCalcules.set(cle, r);
    }
    return { f: r, cle };
  };

  Moteur.prototype.dessinerForme = function (ctx, id, M, cx, alpha, ratio) {
    const t = this.formeDe(id, ratio);
    if (!t) return;
    const f = t.f, id2 = t.cle;
    ctx.save();
    ctx.transform(M.a, M.b, M.c, M.d, M.e, M.f);
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
        ctx.fill(p2dDegrade(this, id2, i, c, G), 'evenodd');
        ctx.restore();
      } else {
        ctx.fillStyle = teindre(c.rgb, cx);
        ctx.fill(p, 'evenodd');
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
    this.dessinerClip(ctx, face, M || IDENTITE, null, 1);
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
    this.enMarche = false;
    this._boucle = null;
    this.moteur.surFinAnim = options.surFinAnim || null;
    if (options.etat) this.moteur.definir(options.etat);
    if (options.humeur) this.moteur.humeur(options.humeur);
    this.redimensionner();
    this.rendre();
    // Une bouille au repos n'est PAS immobile : `face` est arrêté, mais les
    // clips imbriqués — l'éclat de l'iris, le frémissement d'un accessoire —
    // continuent de tourner, exactement comme sous Flash. On tourne donc par
    // défaut ; `anime: false` sert aux vignettes (Bouilloscope, trombinoscope),
    // où quarante-huit têtes qui scintillent ne valent pas le courant dépensé.
    if (options.anime !== false) this.demarrer();
  }

  Bouille.prototype.redimensionner = function () {
    const dpr = global.devicePixelRatio || 1;
    const css = this.canvas.clientWidth || this.taille;
    const cssH = this.canvas.clientHeight || this.taille;
    const l = Math.max(1, Math.round(css * dpr)), h = Math.max(1, Math.round(cssH * dpr));
    if (this.canvas.width !== l || this.canvas.height !== h) {
      this.canvas.width = l; this.canvas.height = h;
    }
    return this;
  };

  Bouille.prototype.rendre = function () {
    const ctx = this.ctx, sc = this.moteur.defs.scene;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.fond) { ctx.fillStyle = this.fond; ctx.fillRect(0, 0, this.canvas.width, this.canvas.height); }
    const k = Math.min(this.canvas.width / sc.w, this.canvas.height / sc.h);
    ctx.setTransform(k, 0, 0, k, -sc.x * k, -sc.y * k);
    this.moteur.dessiner(ctx, IDENTITE);
    return this;
  };

  Bouille.prototype.definir = function (etat) { this.moteur.definir(etat); return this.rendre(); };
  Bouille.prototype.humeur = function (id) { this.moteur.humeur(id); return this.rendre(); };
  Bouille.prototype.animer = function (id) {
    if (typeof id === 'string') id = Math.max(0, ANIMATIONS.indexOf(id));
    this.moteur.action(id);
    this.demarrer();
    return this;
  };
  Bouille.prototype.etat = function () { return this.moteur.etat; };

  Bouille.prototype.demarrer = function () {
    if (this.enMarche) return this;
    this.enMarche = true;
    const self = this;
    let precedent = (global.performance || Date).now();
    let reste = 0;
    const pas = 1000 / this.cadence;
    (function tic() {
      if (!self.enMarche) return;
      self._boucle = global.requestAnimationFrame(tic);
      const t = (global.performance || Date).now();
      reste += Math.min(200, t - precedent);
      precedent = t;
      let bouge = false;
      while (reste >= pas) { reste -= pas; self.moteur.avancer(); bouge = true; }
      if (bouge) self.rendre();
    })();
    return this;
  };
  Bouille.prototype.arreter = function () {
    this.enMarche = false;
    if (this._boucle) global.cancelAnimationFrame(this._boucle);
    this._boucle = null;
    return this;
  };

  const API = {
    Moteur, Bouille, Clip,
    PALETTE, HUMEURS, ANIMATIONS, NOMS_HUMEURS, NOMS_ANIMATIONS, ETIQUETTES,
    decode62, encode62, teindre, cxTeinte, composerCx, composerM, etatsDe,
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
