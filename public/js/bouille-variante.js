/*
  FPBouilleVariante — de VRAIES variantes d'accessoire, injectées dans la famille.

  Pas une surcouche : une variante créée ici devient un accessoire d'époque à part
  entière. Elle s'encode dans la chaîne de 24 caractères (type + variante + trois
  couleurs de palette), occupe le créneau accessoire (elle ne s'ajoute donc pas
  par-dessus un autre), et se teinte par le mécanisme d'origine.

  ── CE QUI REND LA CHOSE SIMPLE ────────────────────────────────────────────────

  Un accessoire d'époque s'encode en deux temps :

      type      (positions 14-15)  quel CARACTÈRE le rouleau de la coiffure pose
      variante  (positions 16-17)  quelle IMAGE de ce caractère

  Or le caractère d'un type donné est PARTAGÉ par toutes les coiffures : pour la
  casquette (type 3) de la famille 0, les 67 coiffures posent le même `#748`.
  Ajouter une image à `#748`, c'est donc ajouter une variante disponible sur
  TOUTES les coupes d'un coup — sans rien adapter.

  Mieux : la matrice qui mène de la scène (le carré du visage) au repère de cet
  `acc` est CONSTANTE d'une coiffure à l'autre. Relevé sur la famille 0, casquette,
  coiffures 0/8/20/40/66 : translation (+42, +29), échelle 1, à 0,16 px près. Un
  dessin fait sur UNE coiffure de référence tombe donc juste sur les autres.

  ── LES TROIS COULEURS ─────────────────────────────────────────────────────────

  Elles ne sont pas des aplats : `apply()` teinte les sous-clips nommés `col`,
  `col2` et `col3` de l'accessoire avec `generalPalette[accCouleur1..3]`, et
  FEMC.setColor est un DÉCALAGE (sortie = source + couleur − 255). D'où la règle
  pour le graphiste : une zone recolorable se dessine en NIVEAUX DE GRIS — le
  blanc rend la couleur pleine, les gris en donnent les ombres. Le relief vient
  donc du dessin lui-même, et il suit la couleur choisie.

  ── CE QU'ON NE FAIT PAS (encore) ──────────────────────────────────────────────

  Les variantes injectées sont STATIQUES : pas de script d'image, donc pas de
  pièce qui tourne comme la variante 25 de la casquette. Le reste — masque,
  superposition, placement par coiffure — vient de la mécanique d'époque, pas de
  nous.

  Rien de tout cela ne touche au .swf : on enrichit l'arbre que le lecteur JS a
  monté en mémoire (`defs`), après chargement.
*/
(function (global) {
  "use strict";

  var ID = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  function mul(P, E) {
    return {
      a: P.a * E.a + P.c * E.b, b: P.b * E.a + P.d * E.b,
      c: P.a * E.c + P.c * E.d, d: P.b * E.c + P.d * E.d,
      e: P.a * E.e + P.c * E.f + P.e, f: P.b * E.e + P.d * E.f + P.f,
    };
  }
  function inverse(M) {
    var det = M.a * M.d - M.b * M.c;
    if (!det) return ID;
    return {
      a: M.d / det, b: -M.b / det, c: -M.c / det, d: M.a / det,
      e: (M.c * M.f - M.d * M.e) / det, f: (M.b * M.e - M.a * M.f) / det,
    };
  }

  // Les identifiants qu'on fabrique : au-dessus de tout ce qu'un SWF contient
  // (les familles montent à ~1900), et comptés par famille pour ne jamais
  // recouvrir un caractère existant.
  var BASE_ID = 900000;
  // Le moteur, des deux côtés : `global` dans le navigateur, `require` sous Node
  // (c'est l'idiome déjà suivi par bouille-moteur.js pour aller chercher le SWF).
  function moteur() {
    return (typeof module === "object" && module.exports)
      ? require("./bouille-moteur.js") : global.FPBouilleMoteur;
  }
  function prochainId(defs) {
    if (!defs._varSeq) defs._varSeq = 0;
    defs._varSeq += 1;
    return BASE_ID + defs._varSeq;
  }

  /**
   * Le repère d'un type d'accessoire : où vit son caractère `acc`, et comment
   * passer du carré du visage à SON repère local.
   *
   * On monte une bouille témoin portant l'accessoire, et on compose les matrices
   * de placement le long de face → ca → c → acc, exactement comme le fait le
   * rendu. La matrice rendue mène de l'ACC vers la SCÈNE ; son inverse fait le
   * chemin retour, celui dont l'injection a besoin.
   *
   * @returns {{accId:number, sprite:object, versScene:object, versAcc:object, variantes:number}|null}
   */
  function repere(defs, type, coiffureRef) {
    var M = moteur();
    var mo = new M.Moteur(defs, { alea: function () { return 0.5; } });
    mo.creerVisage();
    var p = function (n) { return M.encode62(n, 2); };
    var co = (coiffureRef == null) ? 8 : coiffureRef;
    // Une tête neutre qui PORTE l'accessoire : c'est le port qui fait exister
    // la chaîne ca → c → acc.
    mo.definir(p(0) + p(3) + p(0) + p(co) + p(0) + p(2) + p(7) + p(type) + p(0) + p(1) + p(0) + p(0));

    var face = mo.racine.face;
    if (!face) return null;
    var Mx = mul(ID, face.matrice());
    var cur = face, accEnt = null;
    var noms = ["ca", "c", "acc"];
    for (var i = 0; i < noms.length; i++) {
      var ent = null;
      cur.enfants.forEach(function (e) { if (e.nom === noms[i]) ent = e; });
      if (!ent) return null;
      Mx = mul(Mx, ent.objet ? ent.objet.matrice() : (ent.M || ID));
      accEnt = ent;
      cur = ent.objet;
      if (!cur) break;
    }
    if (!accEnt || !accEnt.objet) return null;
    var sprite = defs.sprites.get(accEnt.ch);
    if (!sprite) return null;
    return {
      accId: accEnt.ch, sprite: sprite,
      versScene: Mx, versAcc: inverse(Mx),
      variantes: sprite.n,
    };
  }

  /**
   * LE GABARIT — l'art d'une variante existante, rendu en coordonnées de SCÈNE.
   *
   * C'est ce qu'on donne au graphiste pour qu'il parte d'une casquette qui existe
   * plutôt que d'une page blanche. Les couleurs rendues sont celles du DESSIN
   * (des gris pour les zones recolorables) : c'est la vérité de l'art, et c'est
   * ce que la teinte transformera.
   *
   * @returns {Array<{d,fill,alpha,m,slot}>} en repère scène
   */
  function exporter(defs, type, variante, coiffureRef) {
    var rep = repere(defs, type, coiffureRef);
    if (!rep) return [];
    var etats = etatsDe(defs, rep.sprite);
    var liste = etats[Math.max(0, Math.min(variante, etats.length - 1))];
    if (!liste) return [];

    var SLOTS = { col: 1, col2: 2, col3: 3 };
    var out = [];
    // On descend chaque calque posé par l'image de la variante. Un sous-clip
    // nommé col/col2/col3 marque le NIVEAU DE COULEUR de tout ce qu'il contient.
    function descendre(ch, Mparent, slot, prof) {
      if (prof > 6) return;
      var sp = defs.sprites.get(ch);
      if (sp) {
        var st = etatsDe(defs, sp)[0] || new Map();
        var profs = [];
        st.forEach(function (v, k) { profs.push(k); });
        profs.sort(function (a, b) { return a - b; });
        for (var i = 0; i < profs.length; i++) {
          var e = st.get(profs[i]);
          var s2 = SLOTS[e.nom] || slot;
          descendre(e.ch, mul(Mparent, e.M || ID), s2, prof + 1);
        }
        return;
      }
      var f = defs.formes.get(ch);
      if (!f) return;
      for (var k = 0; k < f.couches.length; k++) {
        var c = f.couches[k];
        if (!c.rgb) continue;                       // dégradés : hors périmètre v1
        out.push({
          d: c.d,
          fill: "rgb(" + c.rgb[0] + "," + c.rgb[1] + "," + c.rgb[2] + ")",
          alpha: (c.alpha == null ? 1 : c.alpha),
          m: [Mparent.a, Mparent.b, Mparent.c, Mparent.d, Mparent.e, Mparent.f],
          slot: slot || 0,
          trait: !!c.trait, largeur: c.largeur || 0,
        });
      }
    }
    var profs = [];
    liste.forEach(function (v, k) { profs.push(k); });
    profs.sort(function (a, b) { return a - b; });
    for (var i = 0; i < profs.length; i++) {
      var e = liste.get(profs[i]);
      descendre(e.ch, mul(rep.versScene, e.M || ID), SLOTS[e.nom] || 0, 0);
    }
    return out;
  }

  // `etatsDe` du moteur n'est pas exporté : on refait la même résolution (une
  // image = la liste d'affichage laissée par les précédentes), et on la range
  // sur la pellicule pour ne la calculer qu'une fois.
  function etatsDe(defs, def) {
    if (def._etatsVar) return def._etatsVar;
    var etats = [], courant = new Map();
    for (var i = 0; i < def.images.length; i++) {
      courant = new Map(courant);
      var ordres = def.images[i];
      for (var j = 0; j < ordres.length; j++) {
        var o = ordres[j];
        if (o.t === "retire") courant.delete(o.prof);
        else if (o.t === "pose") {
          var avant = courant.get(o.prof);
          var ch = o.ch, M = o.M, nom = o.nom;
          if (o.deplace || ch < 0) {
            if (!avant) { if (ch < 0) continue; } else {
              if (ch < 0) ch = avant.ch;
              if (M === null) M = avant.M;
              if (nom === null) nom = avant.nom;
            }
          }
          if (ch < 0) continue;
          courant.set(o.prof, { ch: ch, M: M || ID, nom: nom || null });
        }
      }
      etats.push(courant);
    }
    def._etatsVar = etats;
    return etats;
  }

  /**
   * INJECTE une nouvelle variante dans le caractère `acc` du type demandé.
   *
   * `paths` arrive en coordonnées de SCÈNE (celles de l'atelier), chaque tracé
   * portant éventuellement son `slot` (1/2/3 = les trois niveaux de couleur) et
   * sa matrice `m` (celle de ses groupes Illustrator). On fabrique :
   *
   *   · une FORME par tracé (le moteur dessine une forme par son `couches[]`) ;
   *   · un sous-clip nommé `col`, `col2`, `col3` par niveau de couleur présent,
   *     plus un clip pour ce qui garde sa couleur ;
   *   · une IMAGE de plus dans le caractère `acc`, qui efface les calques de la
   *     variante précédente et pose les nôtres.
   *
   * Le tout dans le repère de l'acc : on compose la matrice inverse relevée par
   * `repere()`, si bien qu'un dessin fait à l'écran tombe exactement là.
   *
   * @returns {{variante:number, accId:number}|null} l'index à mettre en positions 16-17
   */
  function injecter(defs, opts) {
    opts = opts || {};
    var type = (opts.type == null) ? 3 : opts.type;
    var paths = opts.paths || [];
    if (!paths.length) return null;
    var rep = repere(defs, type, opts.coiffureRef);
    if (!rep) return null;

    /*
     * L'ORDRE DE PEINTURE EST TOUT — et il ne se regroupe pas par couleur.
     *
     * La casquette d'époque alterne : le fond, puis `col`, puis une pièce fixe,
     * puis `col2`, puis le micro PAR-DESSUS. Regrouper d'abord tout ce qui garde
     * sa couleur, ensuite les niveaux, cachait le micro sous la calotte.
     *
     * On garde donc l'ordre du dessin, profondeur par profondeur : chaque tracé
     * à couleur fixe est posé TEL QUEL (une forme se pose aussi bien qu'un clip),
     * et chaque niveau de couleur est un sous-clip UNIQUE — `apply()` le retrouve
     * par son nom, et deux clips du même nom se voleraient la teinte — posé à la
     * profondeur de sa PREMIÈRE apparition.
     */
    var NOMS = { 1: "col", 2: "col2", 3: "col3" };
    var sousClips = {};     // slot → { img: [ordres], prof: profondeur de pose }
    var poses = [];
    for (var i = 0; i < paths.length; i++) {
      var p = paths[i];
      if (!p || !p.d) continue;
      var slot = (p.slot === 1 || p.slot === 2 || p.slot === 3) ? p.slot : 0;
      var rgb = versRgb(p.fill);
      if (!rgb) continue;
      var fid = prochainId(defs);
      defs.formes.set(fid, {
        id: fid,
        bounds: { x: 0, y: 0, w: 1, h: 1 },     // informatif : le rendu n'en dépend pas
        couches: [{
          d: p.d, rgb: rgb, alpha: (p.alpha == null ? 1 : p.alpha),
          trait: !!p.trait, largeur: p.largeur || 1, degrade: null,
        }],
      });
      // scène → acc, puis la matrice propre du tracé.
      var mp = Array.isArray(p.m)
        ? { a: p.m[0], b: p.m[1], c: p.m[2], d: p.m[3], e: p.m[4], f: p.m[5] } : ID;
      var Mfinal = mul(rep.versAcc, mp);
      var prof = (i + 1) * 2;
      if (!slot) {
        poses.push({ t: "pose", ch: fid, prof: prof, M: Mfinal,
          nom: null, masque: 0, cx: null, deplace: false });
      } else {
        if (!sousClips[slot]) sousClips[slot] = { img: [], prof: prof };
        var sc = sousClips[slot];
        // Dans le sous-clip, la matrice est déjà celle de l'acc : le clip lui-même
        // est posé sans transformation, ses membres portent la leur.
        sc.img.push({ t: "pose", ch: fid, prof: sc.img.length + 1, M: Mfinal,
          nom: null, masque: 0, cx: null, deplace: false });
      }
    }
    for (var s in sousClips) {
      if (!Object.prototype.hasOwnProperty.call(sousClips, s)) continue;
      var g = sousClips[s];
      var sid = prochainId(defs);
      defs.sprites.set(sid, { n: 1, labels: {}, images: [g.img] });
      poses.push({ t: "pose", ch: sid, prof: g.prof, M: ID,
        nom: NOMS[s], masque: 0, cx: null, deplace: false });
    }
    if (!poses.length) return null;

    // L'image neuve : on efface d'abord TOUS les calques que les variantes
    // précédentes ont pu laisser (une pellicule garde ce que l'image d'avant a
    // posé), puis on pose les nôtres.
    var maxProf = 64;
    for (var q = 0; q < poses.length; q++) if (poses[q].prof > maxProf) maxProf = poses[q].prof;
    var retires = [];
    for (var pr = 1; pr <= maxProf; pr++) retires.push({ t: "retire", prof: pr });
    rep.sprite.images.push(retires.concat(poses));
    rep.sprite.n = rep.sprite.images.length;
    // Les états résolus sont mis en cache par le moteur ET par nous : les deux
    // caches parlent d'une pellicule qui vient de changer.
    delete rep.sprite._etats;
    delete rep.sprite._etatsVar;

    return { variante: rep.sprite.n - 1, accId: rep.accId };
  }

  // « rgb(1,2,3) », « #abc », « #aabbcc » → [r,g,b]. Rien d'autre n'est accepté :
  // une couleur qu'on ne sait pas lire ne doit pas devenir un tracé noir.
  function versRgb(v) {
    var s = String(v == null ? "" : v).trim();
    var m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s);
    if (m) return [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3])];
    m = /^#([0-9a-f]{3})$/i.exec(s);
    if (m) {
      return [parseInt(m[1][0] + m[1][0], 16), parseInt(m[1][1] + m[1][1], 16), parseInt(m[1][2] + m[1][2], 16)];
    }
    m = /^#([0-9a-f]{6})$/i.exec(s);
    if (m) {
      return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
    }
    return null;
  }

  var API = { repere: repere, exporter: exporter, injecter: injecter, versRgb: versRgb };
  if (typeof module === "object" && module.exports) module.exports = API;
  else global.FPBouilleVariante = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
