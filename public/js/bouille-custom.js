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

  function opaciteDe(win, el) {
    var cs = win.getComputedStyle(el);
    var o = parseFloat(cs.opacity); if (isNaN(o)) o = 1;
    var fo = parseFloat(cs.fillOpacity); if (isNaN(fo)) fo = 1;
    return { fill: o * fo, stroke: o * (parseFloat(cs.strokeOpacity) || 1) };
  }

  /**
   * Relit un SVG retravaillé et en tire les aplats pour le moteur.
   * @param {string} svgTexte
   * @returns {Array<{d,fill,alpha,m,trait,largeur}>}
   */
  function charger(svgTexte) {
    var doc = new global.DOMParser().parseFromString(svgTexte, "image/svg+xml");
    var svg = doc.documentElement;
    if (!svg || svg.tagName.toLowerCase() !== "svg") return [];

    // getCTM exige un rendu : on greffe le SVG hors écran, on lit, on retire.
    var hote = global.document.createElement("div");
    hote.setAttribute("style", "position:absolute;left:-99999px;top:0;width:0;height:0;overflow:hidden");
    var vivant = global.document.importNode(svg, true);
    hote.appendChild(vivant);
    global.document.body.appendChild(hote);

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
      function faire(d, fill, alpha, m, avant, slot, trait, largeur) {
        var p = { d: d, fill: fill, alpha: alpha, m: m };
        if (!avant) p.avant = false;
        if (slot) p.slot = slot;
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
        var ctm = el.getCTM();                                // élément → viewBox (scène)
        var m = ctm ? [ctm.a, ctm.b, ctm.c, ctm.d, ctm.e, ctm.f] : null;
        var op = opaciteDe(global, el);
        var avant = !(gArr && gArr.contains(el));
        var slot = slotDe(el);
        var fill = couleur(global, el, "fill");
        var stroke = couleur(global, el, "stroke");
        if (fill) out.push(faire(d, fill, op.fill, m, avant, slot, false, 0));
        if (stroke) {
          var lw = parseFloat(global.getComputedStyle(el).strokeWidth) || 1;
          out.push(faire(d, stroke, op.stroke, m, avant, slot, true, lw));
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
