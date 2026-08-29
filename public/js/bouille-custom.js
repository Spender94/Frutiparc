/*
  FPBouilleCustom — accessoires « maison » pour les frutibouilles.

  L'idée : un graphiste retravaille l'accessoire DANS Illustrator, sur un SVG, et
  on réinjecte son dessin dans le moteur JS — sans jamais toucher au .swf.

  Deux portes :

    exporterSVG(bouille)   →  un document SVG propre : une couche « accessoire »
                              (l'accessoire APLATI, tel qu'il se voit) et une
                              couche « repere » verrouillable (la tête en fond,
                              pour se repérer). viewBox = la scène (100×100).

    charger(svgTexte)      →  relit un SVG retravaillé et en tire la liste
                              d'aplats { d, fill, alpha, m } que le moteur peint
                              par-dessus la bouille (option `accessoireCustom`,
                              ou Moteur.accessoireCustom).

  Repère : le SVG est en coordonnées de SCÈNE (le carré du visage). L'export y
  émet directement ; à l'import, on lit la matrice cumulée de chaque tracé
  (getCTM) — donc les transformations des groupes Illustrator sont respectées
  sans qu'on ait à « aplatir » le `d` nous-mêmes.

  Un accessoire maison est un accessoire À PART : on le pose sur une tête dont
  l'accessoire SWF vaut 0 (« Rien »). Il ne remplace donc rien — il s'ajoute.
*/
(function (global) {
  "use strict";

  var SVGNS = "http://www.w3.org/2000/svg";
  var XLINKNS = "http://www.w3.org/1999/xlink";

  // ── EXPORT ────────────────────────────────────────────────────────────────

  // La tête SEULE (accessoire mis à « Rien »), rendue en PNG : le fond de repère
  // du graphiste. On la rend à la taille de la scène, sans marge (dx=dy=0), pour
  // qu'elle se cale pile sur le viewBox.
  function fondTete(defs, etat, cote) {
    var Moteur = global.FPBouilleMoteur;
    var nu = etat.substring(0, 14) + "0" + etat.substring(15); // pos 14-15 → accId 0
    // On force la scène carrée à `cote` px : une Bouille dont le canevas fait
    // exactement la scène ne recentre pas (showAll sans marge).
    var c = global.document.createElement("canvas");
    c.width = cote; c.height = cote;
    // eslint-disable-next-line no-new
    new Moteur.Bouille(c, defs, { etat: nu, anime: false, alea: function () { return 0.5; }, super: 4 });
    try { return c.toDataURL("image/png"); } catch (e) { return null; }
  }

  function num(v) { return Math.round(v * 100) / 100; }

  // Un aplat de l'export → un <path> SVG. `avant`/`arriere` ne servent qu'au
  // classement : ici on garde l'ordre d'émission (déjà par profondeur).
  function pathXml(p) {
    var attrs = 'd="' + p.d + '"';
    if (p.trait) {
      attrs += ' fill="none" stroke="' + p.fill + '"';
      if (p.largeur) attrs += ' stroke-width="' + num(p.largeur) + '"';
      attrs += ' stroke-linejoin="round" stroke-linecap="round"';
    } else {
      attrs += ' fill="' + p.fill + '"';
    }
    if (p.alpha != null && p.alpha < 1) attrs += ' opacity="' + num(p.alpha) + '"';
    return "    <path " + attrs + " />";
  }

  /**
   * Construit le document SVG à confier au graphiste.
   * @param {Bouille} bouille  une bouille déjà montée sur la famille voulue
   * @param {object}  [opts]   { cote, nom }
   * @returns {string} le SVG
   */
  function exporterSVG(bouille, opts) {
    opts = opts || {};
    var ex = bouille.moteur.exporterAccessoire();
    var sc = ex.scene || { x: 0, y: 0, w: 100, h: 100 };
    var cote = opts.cote || 512;
    var etat = bouille.moteur.racine.s || "";
    var fond = fondTete(bouille.moteur.defs, etat, cote);

    var avant = ex.paths.filter(function (p) { return p.avant !== false; }).map(pathXml).join("\n");
    var arriere = ex.paths.filter(function (p) { return p.avant === false; }).map(pathXml).join("\n");
    var viewBox = sc.x + " " + sc.y + " " + sc.w + " " + sc.h;
    var image = fond
      ? '    <image x="' + sc.x + '" y="' + sc.y + '" width="' + sc.w + '" height="' + sc.h
        + '" href="' + fond + '" xlink:href="' + fond + '" />'
      : "";

    // Trois groupes NOMMÉS = trois calques dans Illustrator, dans l'ordre où ils
    // se peignent : l'ARRIÈRE (derrière les cheveux de devant), puis le REPÈRE
    // (la tête, un simple fond), puis l'AVANT (par-dessus tout). Le graphiste
    // dessine dans « accessoire » (avant) et/ou « accessoire-arriere », jamais
    // dans « repere » (verrouillé, ignoré au retour).
    return '<?xml version="1.0" encoding="UTF-8"?>\n'
      + '<svg xmlns="' + SVGNS + '" xmlns:xlink="' + XLINKNS + '" '
      + 'viewBox="' + viewBox + '" width="' + sc.w + '" height="' + sc.h + '">\n'
      + "  <!--\n"
      + "    Frutiparc — accessoire" + (opts.nom ? " « " + opts.nom + " »" : "") + " à retravailler.\n"
      + "    · « accessoire »          : ce qui passe PAR-DESSUS (le gros de l'objet).\n"
      + "    · « accessoire-arriere »  : ce qui passe DERRIÈRE les cheveux de devant\n"
      + "                                (un bandeau sous la frange, l'arrière d'un chapeau…).\n"
      + "    · « repere » (la tête)    : un simple fond — verrouille-le, il est ignoré au retour.\n"
      + "    NIVEAUX DE COULEUR (optionnel) : place des formes dans un groupe nommé\n"
      + "    « couleur1 », « couleur2 » ou « couleur3 » (dans l'un ou l'autre calque).\n"
      + "    Ces zones se recolorent ensuite depuis l'admin (3 niveaux, palette du parc) ;\n"
      + "    le reste garde sa couleur. Dessine-les en aplats — la teinte les remplace.\n"
      + "    OMBRES & LUMIÈRES : garde-les à part. Une ombre = une forme noire en mode\n"
      + "    « Produit » (multiply), une lumière = une forme blanche en « Superposition\n"
      + "    d'écran » (screen), avec l'opacité que tu veux (sur la forme OU le calque).\n"
      + "    Posées PAR-DESSUS une zone de couleur, elles la foncent / l'éclaircissent\n"
      + "    quel que soit le coloris — donc le relief suit la recolorisation.\n"
      + "    · Repère = le carré du visage (" + sc.w + "×" + sc.h + "). N'agrandis pas le plan de travail.\n"
      + "  -->\n"
      + '  <g id="accessoire-arriere">\n' + arriere + "\n  </g>\n"
      + '  <g id="repere" opacity="0.85" style="pointer-events:none">\n' + image + "\n  </g>\n"
      + '  <g id="accessoire">\n' + avant + "\n  </g>\n"
      + "</svg>\n";
  }

  // ── IMPORT ────────────────────────────────────────────────────────────────

  // Un élément dessinable → un `d` de tracé. On ne « cuit » pas la matrice : le
  // moteur l'appliquera (chaque tracé porte sa `m`, lue par getCTM).
  function elementVersD(el) {
    var t = el.tagName.toLowerCase();
    var f = function (n) { return parseFloat(el.getAttribute(n)) || 0; };
    if (t === "path") return el.getAttribute("d") || "";
    if (t === "rect") {
      var x = f("x"), y = f("y"), w = f("width"), h = f("height");
      if (!w || !h) return "";
      return "M" + x + " " + y + "H" + (x + w) + "V" + (y + h) + "H" + x + "Z";
    }
    if (t === "circle") {
      var cx = f("cx"), cy = f("cy"), r = f("r");
      if (!r) return "";
      return "M" + (cx - r) + " " + cy + "A" + r + " " + r + " 0 1 0 " + (cx + r) + " " + cy
        + "A" + r + " " + r + " 0 1 0 " + (cx - r) + " " + cy + "Z";
    }
    if (t === "ellipse") {
      var ex = f("cx"), ey = f("cy"), rx = f("rx"), ry = f("ry");
      if (!rx || !ry) return "";
      return "M" + (ex - rx) + " " + ey + "A" + rx + " " + ry + " 0 1 0 " + (ex + rx) + " " + ey
        + "A" + rx + " " + ry + " 0 1 0 " + (ex - rx) + " " + ey + "Z";
    }
    if (t === "line") {
      return "M" + f("x1") + " " + f("y1") + "L" + f("x2") + " " + f("y2");
    }
    if (t === "polygon" || t === "polyline") {
      var pts = (el.getAttribute("points") || "").trim().split(/[\s,]+/).map(Number);
      if (pts.length < 4) return "";
      var d = "M" + pts[0] + " " + pts[1];
      for (var i = 2; i < pts.length - 1; i += 2) d += "L" + pts[i] + " " + pts[i + 1];
      return d + (t === "polygon" ? "Z" : "");
    }
    return "";
  }

  // La couleur PEINTE d'un élément : le style calculé résout classes, `style=`,
  // héritage et `currentColor`. On rend une chaîne CSS que le canevas comprend.
  function couleur(win, el, prop) {
    var cs = win.getComputedStyle(el);
    var v = cs[prop];
    if (!v || v === "none") return null;
    return v;
  }

  // Opacité EFFECTIVE : celle de la forme ET de tous ses groupes parents.
  // Illustrator pose souvent l'opacité sur un CALQUE d'ombre entier, pas sur
  // chaque forme — `getComputedStyle(el).opacity` ne rend que celle de l'élément.
  function opaciteAncetres(win, el, racine) {
    var o = 1;
    for (var n = el; n && n.nodeType === 1 && n !== racine.parentNode; n = n.parentNode) {
      var v = parseFloat(win.getComputedStyle(n).opacity);
      if (!isNaN(v)) o *= v;
    }
    return o;
  }
  function opaciteDe(win, el, racine) {
    var cs = win.getComputedStyle(el);
    var fo = parseFloat(cs.fillOpacity); if (isNaN(fo)) fo = 1;
    var so = parseFloat(cs.strokeOpacity); if (isNaN(so)) so = 1;
    var oc = opaciteAncetres(win, el, racine);
    return { fill: oc * fo, stroke: oc * so };
  }
  // Le mode de fusion (multiply pour une ombre, screen pour une lumière…) : on
  // remonte les groupes, car Illustrator le pose souvent sur un CALQUE entier.
  // On prend le premier non-« normal » rencontré. Le canevas comprend les mêmes noms.
  function fusionDe(win, el, racine) {
    for (var n = el; n && n.nodeType === 1 && n !== racine.parentNode; n = n.parentNode) {
      var m = win.getComputedStyle(n).mixBlendMode;
      if (m && m !== "normal") return m;
    }
    return null;
  }

  /**
   * Relit un SVG retravaillé et en tire les aplats pour le moteur.
   * @param {string} svgTexte
   * @returns {Array<{d,fill,alpha,m,trait,largeur}>}
   */
  function charger(svgTexte, opts) {
    var doc = new global.DOMParser().parseFromString(svgTexte, "image/svg+xml");
    var svg = doc.documentElement;
    if (!svg || svg.tagName.toLowerCase() !== "svg") return [];

    // getCTM exige un rendu : on greffe le SVG hors écran, on lit, on retire.
    var hote = global.document.createElement("div");
    hote.setAttribute("style", "position:absolute;left:-99999px;top:0;width:0;height:0;overflow:hidden");
    var vivant = global.document.importNode(svg, true);
    hote.appendChild(vivant);
    global.document.body.appendChild(hote);

    /*
     * REMETTRE LE DESSIN À L'ÉCHELLE DE LA SCÈNE.
     *
     * Le gabarit part en 100 × 100 — le carré du visage — mais un aller-retour
     * par Illustrator n'en revient pas toujours ainsi : ré-exporter en « pixels »
     * donne couramment un plan de travail de 1000, viewBox comprise. Les tracés
     * arrivent alors DIX FOIS trop grands, et un accessoire qui couvre tout le
     * canevas ressemble à une bouille disparue — sans la moindre erreur pour le
     * dire. (Constaté : x −31..871 au lieu de −3..87.)
     *
     * On ne se fie donc plus à `width`/`height` : on lit la VIEWBOX, on force le
     * SVG greffé à ses dimensions (ainsi `getCTM` rend des coordonnées de
     * viewBox), et on compose le passage viewBox → scène. Un gabarit resté en
     * 100 × 100 traverse sans rien changer ; un plan de travail redimensionné
     * revient à sa place tout seul.
     */
    var SCENE = (opts && opts.scene) || 100;      // la scène d'une bouille : 100 × 100
    var vb = String(svg.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number);
    var aVb = vb.length === 4 && vb.every(function (n) { return isFinite(n); }) && vb[2] > 0 && vb[3] > 0;
    if (aVb) {
      vivant.setAttribute("width", vb[2]);
      vivant.setAttribute("height", vb[3]);
    }
    var sx = aVb ? SCENE / vb[2] : 1, sy = aVb ? SCENE / vb[3] : 1;
    var versScene = { a: sx, b: 0, c: 0, d: sy, e: aVb ? -vb[0] * sx : 0, f: aVb ? -vb[1] * sy : 0 };
    function composer(P, E) {
      return {
        a: P.a * E.a + P.c * E.b, b: P.b * E.a + P.d * E.b,
        c: P.a * E.c + P.c * E.d, d: P.b * E.c + P.d * E.d,
        e: P.a * E.e + P.c * E.f + P.e, f: P.b * E.e + P.d * E.f + P.f,
      };
    }

    var out = [];
    try {
      var repere = vivant.querySelector("#repere");
      var gArr = vivant.querySelector("#accessoire-arriere");
      // L'AVANT / ARRIÈRE vient du calque de tête (« accessoire-arriere »). Le
      // NIVEAU DE COULEUR (1, 2 ou 3) vient d'un groupe ancêtre nommé
      // « couleur1/2/3 » (Illustrator peut y accoler un « _1 » : on tolère). Un
      // tracé sans un tel ancêtre garde sa couleur fixe (niveau 0).
      function slotDe(el) {
        for (var n = el; n && n !== vivant.parentNode; n = n.parentNode) {
          var m = /^couleur([123])/i.exec(n.id || "");
          if (m) return Number(m[1]);
        }
        return 0;
      }
      function faire(d, fill, alpha, m, avant, slot, trait, largeur, blend) {
        var p = { d: d, fill: fill, alpha: alpha, m: m };
        if (!avant) p.avant = false;
        if (slot) p.slot = slot;
        if (blend) p.blend = blend;
        if (trait) { p.trait = true; p.largeur = largeur; }
        return p;
      }
      // Une seule passe sur tous les dessinables (hors repère) : l'ordre du
      // document = l'ordre de peinture.
      var els = vivant.querySelectorAll("path,rect,circle,ellipse,line,polygon,polyline");
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (repere && repere.contains(el)) continue;          // le fond, jamais
        var d = elementVersD(el);
        if (!d) continue;
        // élément → viewBox, puis viewBox → scène : le dessin retrouve sa taille
        // quel que soit le plan de travail dont il revient.
        var ctm = el.getCTM();
        var mm = ctm ? composer(versScene, { a: ctm.a, b: ctm.b, c: ctm.c, d: ctm.d, e: ctm.e, f: ctm.f })
                     : versScene;
        var m = [mm.a, mm.b, mm.c, mm.d, mm.e, mm.f];
        var op = opaciteDe(global, el, vivant);
        var blend = fusionDe(global, el, vivant);
        var avant = !(gArr && gArr.contains(el));
        var slot = slotDe(el);
        var fill = couleur(global, el, "fill");
        var stroke = couleur(global, el, "stroke");
        if (fill) out.push(faire(d, fill, op.fill, m, avant, slot, false, 0, blend));
        if (stroke) {
          var lw = parseFloat(global.getComputedStyle(el).strokeWidth) || 1;
          out.push(faire(d, stroke, op.stroke, m, avant, slot, true, lw, blend));
        }
      }
    } finally {
      global.document.body.removeChild(hote);
    }
    return out;
  }

  // Un aperçu tout fait : monte une bouille (accessoire SWF à « Rien ») et pose
  // l'accessoire maison par-dessus. `source` = un tableau d'aplats (charger) ou
  // un texte SVG.
  function apercu(canvas, defs, etat, source, humeur) {
    var Moteur = global.FPBouilleMoteur;
    var paths = typeof source === "string" ? charger(source) : source;
    var nu = etat.substring(0, 14) + "0" + etat.substring(15);
    var b = new Moteur.Bouille(canvas, defs, {
      etat: nu, anime: false, alea: function () { return 0.5; }, accessoireCustom: paths,
    });
    if (humeur) b.moteur.humeur(humeur);
    b.rendre();
    return b;
  }

  var API = { exporterSVG: exporterSVG, charger: charger, apercu: apercu };
  global.FPBouilleCustom = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
