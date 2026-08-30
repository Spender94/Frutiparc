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

  ── LE GABARIT SE LIT SUR L'ÉCRAN, PAS SUR LA PELLICULE ────────────────────────

  L'export marche l'arbre que `definir()` vient de monter, dans l'ordre exact où
  `dessinerClip` le peint. Refaire à côté la lecture des pellicules, c'était
  refaire aussi les exceptions d'époque — et il y en a six, toutes trouvées à
  l'usage, toutes invisibles jusqu'à ce qu'un accessoire les révèle :

    · une POSE peut teindre ce qu'elle porte (le casque-mouche est un dessin
      blanc verdi par son placement, les verres de lunettes un dessin assombri) ;
    · une forme peut être MORPHÉE (les branches d'une paire de lunettes) ;
    · un MASQUE d'écrêtage découpe ce qui le suit (la casquette 25, le type 16) ;
    · un accessoire a parfois DEUX rouleaux, `acc` et `acc2`, à des profondeurs
      différentes, tous deux suivant la variante ;
    · la dernière image d'un rouleau est un MARQUEUR d'atelier, un aplat de la
      taille de la scène, que le rendu saute déjà ;
    · et quand deux sous-clips portent le même nom, `apply()` n'en teint qu'UN,
      le dernier posé (l'accessoire 9 variante 5 en dépend).

  Quel niveau de couleur porte quel clip, on ne le redit pas non plus : on monte
  la bouille témoin avec trois couleurs SENTINELLES, et le clip qu'`apply()` a
  choisi de teindre se reconnaît à l'identité de sa teinte.

  ── CE QU'ON NE FAIT PAS ───────────────────────────────────────────────────────

  Les variantes injectées sont STATIQUES : pas de script d'image, donc pas de
  pièce qui tourne toute seule. Une variante d'époque animée s'exporte dans la
  pose où on la prend.

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

    /*
     * DEUX COUCHES, PAS UNE — ET SOUS CHACUNE, PLUSIEURS ROULEAUX.
     *
     * Un accessoire vit sur `ca` (devant les cheveux) ET sur `cb` (derrière la
     * tête) : deux caractères distincts. Onze types sur seize ont une partie
     * arrière — les bananes qui pendent dans le dos, l'arrière d'un chapeau, un
     * bandeau qui fait le tour. Ne suivre que l'avant, c'était livrer au
     * graphiste un gabarit amputé, sans le dire.
     *
     * Et sous `c`, il n'y a pas toujours un seul rouleau. Trois types portent un
     * SECOND `acc2`, qui suit la même variante et se peint à sa propre
     * profondeur : au-dessus pour le bonnet de bain (type 2) et le type 15, en
     * dessous pour la casquette (type 3). L'ignorer coûtait deux fois — le
     * gabarit y perdait une pièce, et une variante ajoutée au-delà de sa longueur
     * s'y BORNAIT, héritant du bandeau rose du bonnet de bain sans l'avoir
     * demandé. On les relève donc tous, dans l'ordre où ils se peignent.
     */
    function suivre(cote) {
      var Mx = mul(ID, face.matrice());
      var cur = face;
      var noms = [cote, "c"];
      for (var i = 0; i < noms.length; i++) {
        var trouve = null;
        cur.enfants.forEach(function (e) { if (e.nom === noms[i]) trouve = e; });
        if (!trouve || !trouve.objet) return null;
        Mx = mul(Mx, trouve.objet.matrice());
        cur = trouve.objet;
      }
      // Les rouleaux de l'accessoire : `acc`, et ses compagnons `acc2`, `acc3`…
      // Tout le reste sous `c` (la coiffure elle-même, posée en `col`) n'est pas
      // de l'accessoire et ne se touche pas.
      var reels = [];
      cur.enfants.forEach(function (e, prof) {
        if (!e.nom || !/^acc\d*$/.test(e.nom) || !e.objet) return;
        var sp = defs.sprites.get(e.ch);
        if (!sp) return;
        var Mr = mul(Mx, e.objet.matrice());
        reels.push({ nom: e.nom, id: e.ch, sprite: sp, prof: prof,
          versScene: Mr, versAcc: inverse(Mr) });
      });
      reels.sort(function (a, b) { return a.prof - b.prof; });
      var principal = null;
      for (var k = 0; k < reels.length; k++) if (reels[k].nom === "acc") principal = reels[k];
      if (!principal) return null;
      return { id: principal.id, sprite: principal.sprite,
        versScene: principal.versScene, versAcc: principal.versAcc, reels: reels };
    }

    var av = suivre("ca");
    if (!av) return null;
    var ar = suivre("cb");
    // UN SEUL ROULEAU POUR LES DEUX CÔTÉS, parfois : le type 13 pose le même
    // caractère devant et derrière. Il n'y a alors pas de couche arrière à
    // distinguer — la prendre pour telle, c'était exporter chaque tracé en
    // double, puis écraser l'image qu'on venait d'injecter en croyant écrire
    // derrière.
    if (ar && ar.id === av.id) ar = null;
    return {
      accId: av.id, sprite: av.sprite,
      versScene: av.versScene, versAcc: av.versAcc,
      variantes: av.sprite.n, reels: av.reels,
      // L'arrière : absent pour cinq types (lunettes, nez…), c'est normal.
      arriere: ar ? { accId: ar.id, sprite: ar.sprite, versScene: ar.versScene,
        versAcc: ar.versAcc, variantes: ar.sprite.n, reels: ar.reels } : null,
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
    var M = moteur();
    var rep = repere(defs, type, coiffureRef);
    if (!rep) return [];

    /*
     * ON LIT L'ARBRE MONTÉ, PAS LES PELLICULES.
     *
     * Refaire à côté ce que le rendu fait déjà, c'était refaire aussi ses
     * exceptions — et il y en a. En huit essais, l'exportateur « structurel »
     * a manqué : les transformations de couleur d'une pose (le casque-mouche
     * est un dessin BLANC verdi par son placement), les formes MORPHÉES, les
     * MASQUES, le second rouleau `acc2`, le marqueur d'atelier, et la règle du
     * DERNIER `col` posé. On marche donc l'arbre que `definir()` vient de
     * monter, dans l'ordre exact où `dessinerClip` le peint.
     *
     * Reste à savoir quel niveau de couleur porte quel clip. Plutôt que de
     * redire la règle, on la LIT : on monte la bouille avec trois couleurs
     * SENTINELLES, et le clip qu'`apply()` a choisi de teindre se reconnaît à
     * l'identité de sa teinte. C'est vrai par construction.
     */
    var p = function (n) { return M.encode62(n, 2); };
    var co = (coiffureRef == null) ? 8 : coiffureRef;
    var S = [1, 3, 4];                   // trois index de palette, tous distincts
    var mo = new M.Moteur(defs, { alea: function () { return 0.5; } });
    mo.creerVisage();
    mo.definir(p(0) + p(3) + p(0) + p(co) + p(0) + p(2) + p(7) + p(type)
      + p(variante) + p(S[0]) + p(S[1]) + p(S[2]));
    var PAL = M.PALETTE;
    var sentinelles = [PAL[S[0]] || PAL[0], PAL[S[1]] || PAL[0], PAL[S[2]] || PAL[0]];
    var face = mo.racine.face;
    if (!face) return [];

    var out = [], nDecoupe = 0;
    marcher(face, ID, null, 1, 0, "r", true, null, false, null);
    return out;

    function slotDe(clip) {
      var t = clip && clip.teinte;
      if (!t) return 0;
      for (var i = 0; i < 3; i++) if (t === sentinelles[i]) return i + 1;
      return 0;
    }

    function emettre(ch, Mx, cx, alpha, ratio, slot, avant, decoupe, estDecoupe, reel) {
      var t = mo.formeDe(ch, ratio);
      if (!t) return;
      var f = t.f;
      for (var k = 0; k < f.couches.length; k++) {
        var c = f.couches[k];
        // Un tracé de DÉCOUPE ne se peint pas : seule sa forme compte. Un trait
        // n'y découpe rien (le rendu ne retient que les pleins).
        if (estDecoupe && c.trait) continue;
        // Un dégradé n'a pas de couleur unique : on le transporte tel quel, et
        // `fill` ne sert plus que de repli pour un lecteur qui l'ignorerait.
        if (!c.rgb && !c.degrade && !estDecoupe) continue;
        var a = opacite(c.alpha == null ? 1 : c.alpha, cx) * alpha;
        if (a <= 0 && !estDecoupe) continue;
        var repli = c.rgb || (c.degrade && c.degrade.arrets[0] && c.degrade.arrets[0].rgb)
          || [136, 136, 136];
        var p = {
          d: c.d,
          fill: M.teindre(repli, cx),
          degrade: c.degrade ? teindreDegrade(c.degrade, cx) : null,
          alpha: Math.round(a * 1000) / 1000,
          m: [Mx.a, Mx.b, Mx.c, Mx.d, Mx.e, Mx.f],
          slot: slot || 0,
          avant: avant,
          trait: !!c.trait, largeur: c.largeur || 0,
          // De quel rouleau vient ce tracé. Le gabarit s'en moque — tout ira dans
          // `acc` — mais savoir si le rouleau PRINCIPAL a dessiné quelque chose,
          // c'est savoir si la variante existe : le type 15 déclare seize images
          // et n'en dessine que deux, les autres ne montrant que le reliquat
          // d'`acc2` qui s'y borne.
          reel: reel || null,
        };
        if (decoupe) {
          p.decoupe = decoupe;
          if (estDecoupe) { p.estDecoupe = true; p.alpha = 1; p.slot = 0; }
        }
        out.push(p);
      }
    }

    function poser(e, Mi, cxi, ai, s, ctxt, avant, decoupe, estDecoupe, reel) {
      var sous = ctxt, av = avant, rl = reel;
      if (ctxt === "r" && (e.nom === "ca" || e.nom === "cb")) {
        sous = "C"; av = e.nom === "ca";
      } else if (ctxt === "C" && e.nom === "c") sous = "A";
      else if (ctxt === "A" && e.nom && /^acc\d*$/.test(e.nom)) { sous = "R"; rl = e.nom; }
      if (e.objet) marcher(e.objet, Mi, cxi, ai, s, sous, av, decoupe, estDecoupe, rl);
      else if (ctxt.charAt(0) === "R") {
        emettre(e.ch, M.composerM(Mi, e.M), M.composerCx(cxi, e.cx || null),
          ai, e.ratio, s, av, decoupe, estDecoupe, rl);
      }
    }

    /*
     * Le même parcours que `dessinerClip`, à deux choses près :
     *   · on ne peint que ce qui est DANS un rouleau d'accessoire (`ctxt` en R) ;
     *   · la teinte du joueur ne s'exporte pas — elle devient un NIVEAU, pour que
     *     le graphiste retrouve des gris qu'il pourra faire recolorer.
     *
     * LES DÉCOUPES SE TRANSPORTENT. Deux variantes d'époque en portent une (la
     * casquette 25 et le type 16 variante 1). L'exporter sans elle laissait la
     * lueur rouge du micro s'étaler sur tout le visage ; la sauter emportait les
     * plumes bleues avec. Chaque découpe reçoit donc un numéro : son tracé part
     * marqué `estDecoupe`, ce qu'elle rogne part marqué du même numéro, et le
     * SVG les rend en `<clipPath>` — ce qu'Illustrator appelle un masque
     * d'écrêtage, et que le graphiste peut donc faire aussi.
     */
    function marcher(clip, Mx, cx, alpha, slot, ctxt, avant, decoupe, estDecoupe, reel) {
      if (!clip.visible || clip.marqueur) return;
      var dedans = ctxt.charAt(0) === "R";
      // Un clip teint remplace sa transformation de placement par la teinte :
      // c'est ce que fait le rendu, et l'une exclut donc l'autre.
      var mc = clip.teinte ? null : clip.cxPlacement;
      var cxi = M.composerCx(cx, mc || null);
      var ai = alpha * (clip.alpha / 100);
      if (ai <= 0) return;
      var Mi = M.composerM(Mx, clip.matrice());
      var s = dedans ? (slotDe(clip) || slot) : 0;
      var profs = Array.from(clip.enfants.keys()).sort(function (a, b) { return a - b; });
      var i = 0;
      while (i < profs.length) {
        var e = clip.enfants.get(profs[i]);
        if (e.masque && !decoupe) {
          var mid = "d" + (++nDecoupe);
          poser(e, Mi, cxi, ai, s, ctxt, avant, mid, true, reel);
          i++;
          while (i < profs.length && profs[i] <= e.masque) {
            poser(clip.enfants.get(profs[i]), Mi, cxi, ai, s, ctxt, avant, mid, false, reel);
            i++;
          }
          continue;
        }
        poser(e, Mi, cxi, ai, s, ctxt, avant, decoupe, estDecoupe, reel);
        i++;
      }
    }
  }

  /**
   * Cette variante EXISTE-T-ELLE VRAIMENT ?
   *
   * Un rouleau déclare souvent plus d'images qu'il n'en dessine — le type 15 en
   * annonce seize et n'en peint que deux, le type 1 trente-deux pour huit. Les
   * images de queue ne portent rien, ou seulement le reliquat d'un rouleau
   * compagnon qui s'y borne : les proposer comme gabarit, c'était promettre un
   * dessin qui n'existe pas. On demande donc au rouleau PRINCIPAL s'il a peint.
   */
  function dessinee(defs, type, variante, coiffureRef) {
    var l = exporter(defs, type, variante, coiffureRef);
    // C'EST L'AVANT QUI DÉCIDE — comme `apply()`, qui ne teste que la visibilité
    // de `ca.c.acc` et fait suivre l'arrière. Le rouleau arrière de la casquette
    // n'a qu'une image, servie à ses trente-huit variantes ET à sa queue vide :
    // s'y fier, c'était compter des variantes qui ne montrent rien.
    for (var i = 0; i < l.length; i++) {
      if (l[i].reel === "acc" && l[i].avant !== false) return true;
    }
    return false;
  }

  // L'opacité d'un aplat sous une transformation de couleur, comme le moteur la
  // calcule (le multiplicateur est en 8.8, l'ajout en 0-255).
  function opacite(a, cx) {
    if (!cx) return a;
    return Math.max(0, Math.min(1, a * cx.ma / 256 + cx.aa / 255));
  }

  // Un dégradé teint : chaque arrêt subit la transformation, comme au rendu.
  function teindreDegrade(g, cx) {
    if (!cx) return g;
    var M = moteur();
    var out = { type: g.type, matrice: g.matrice, etalement: g.etalement, arrets: [] };
    for (var i = 0; i < g.arrets.length; i++) {
      var a = g.arrets[i], rgb = M.teindre(a.rgb, cx);
      var n = /(\d+),(\d+),(\d+)/.exec(rgb);
      out.arrets.push({
        pos: a.pos,
        rgb: n ? [+n[1], +n[2], +n[3]] : a.rgb,
        alpha: opacite(a.alpha == null ? 1 : a.alpha, cx),
      });
    }
    return out;
  }

  // La résolution d'une pellicule (une image = la liste d'affichage laissée par
  // les précédentes) est celle du MOTEUR, pas une seconde écriture : la nôtre
  // oubliait la transformation de couleur, le masque et le ratio de morph — trois
  // choses qui font la différence entre le dessin d'époque et notre copie.
  function etatsDe(defs, def) { return moteur().etatsDe(def); }

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
  /*
   * Les calques d'une couche : une forme par tracé, un sous-clip par niveau de
   * couleur. Sortie commune à l'avant et à l'arrière — c'est le même travail des
   * deux côtés, seule la matrice « scène → acc » change.
   *
   * L'ORDRE DE PEINTURE EST TOUT, et il ne se regroupe pas par couleur. La
   * casquette d'époque alterne : le fond, puis `col`, une pièce fixe, `col2`,
   * puis le micro PAR-DESSUS. Regrouper d'abord les couleurs fixes cachait le
   * micro sous la calotte. Chaque tracé fixe est donc posé tel quel, à sa
   * profondeur ; chaque niveau est un sous-clip UNIQUE (deux clips du même nom se
   * voleraient la teinte) posé à la profondeur de sa première apparition.
   */
  function construirePoses(defs, paths, versAcc) {
    var NOMS = { 1: "col", 2: "col2", 3: "col3" };
    var poses = [], serie = null;
    // Une profondeur PAIRE par tracé, dans l'ordre : les impaires restent libres
    // pour les masques, qui doivent se glisser JUSTE sous ce qu'ils rognent.
    var prof = function (i) { return (i + 1) * 2; };

    function formeDe(p) {
      var rgb = versRgb(p.fill);
      if (!rgb) return 0;
      var fid = prochainId(defs);
      defs.formes.set(fid, {
        id: fid,
        bounds: { x: 0, y: 0, w: 1, h: 1 },     // informatif : le rendu n'en dépend pas
        couches: [{
          d: p.d, rgb: rgb, alpha: (p.alpha == null ? 1 : p.alpha),
          // Un dégradé EN GRIS se teinte comme un aplat, ombres comprises : c'est
          // la façon la plus directe de donner du volume à une zone recolorable.
          trait: !!p.trait, largeur: p.largeur || 1, degrade: p.degrade || null,
        }],
      });
      return fid;
    }
    function matriceDe(p) {
      var mp = Array.isArray(p.m)
        ? { a: p.m[0], b: p.m[1], c: p.m[2], d: p.m[3], e: p.m[4], f: p.m[5] } : ID;
      return mul(versAcc, mp);
    }

    var i = 0, decoupeEnCours = null;
    while (i < paths.length) {
      var p = paths[i];
      if (!p || !p.d) { i++; continue; }
      // Entrer ou sortir d'une découpe ferme la série de couleur en cours : son
      // clip est posé à une profondeur, et cette profondeur est rognée ou non.
      if ((p.decoupe || null) !== decoupeEnCours) {
        decoupeEnCours = p.decoupe || null;
        serie = null;
      }

      /*
       * UN MASQUE D'ÉCRÊTAGE. Son tracé va dans un clip à lui — il peut en compter
       * plusieurs, chacun avec sa matrice — posé sur une profondeur IMPAIRE juste
       * sous ce qu'il rogne, et sa profondeur de découpe va jusqu'au dernier tracé
       * rogné. C'est le mécanisme d'époque, celui que `dessinerClip` applique déjà.
       */
      if (p.estDecoupe && p.decoupe) {
        var id = p.decoupe, img = [], k = i;
        while (k < paths.length && paths[k] && paths[k].estDecoupe && paths[k].decoupe === id) {
          var fd = paths[k].d ? formeDe(paths[k]) : 0;
          if (fd) {
            img.push({ t: "pose", ch: fd, prof: img.length + 1, M: matriceDe(paths[k]),
              nom: null, masque: 0, cx: null, deplace: false });
          }
          k++;
        }
        var fin = k;
        while (fin < paths.length && paths[fin] && paths[fin].decoupe === id && !paths[fin].estDecoupe) fin++;
        if (img.length && fin > k) {
          var mid = prochainId(defs);
          defs.sprites.set(mid, { n: 1, labels: {}, images: [img] });
          poses.push({ t: "pose", ch: mid, prof: prof(i) - 1, M: ID,
            nom: null, masque: prof(fin - 1), cx: null, deplace: false });
        }
        serie = null;                       // un masque coupe la série de couleur
        i = k;
        continue;
      }

      var slot = (p.slot === 1 || p.slot === 2 || p.slot === 3) ? p.slot : 0;
      var fid = formeDe(p);
      if (!fid) { i++; continue; }
      var Mfinal = matriceDe(p);
      if (!slot) {
        serie = null;
        poses.push({ t: "pose", ch: fid, prof: prof(i), M: Mfinal,
          nom: null, masque: 0, cx: null, deplace: false });
        i++;
        continue;
      }
      // UNE SÉRIE, UN CLIP. Un même niveau qui revient après autre chose — le
      // type 15 peint du niveau 2, une ombre, puis encore du niveau 2 — ouvre un
      // NOUVEAU clip à sa place dans la pile. Tout regrouper sous un seul clip,
      // comme on le faisait, ramenait la seconde série à la place de la première
      // et faisait passer l'ombre par-dessus. Le moteur teint tous nos clips.
      if (!serie || serie.slot !== slot) {
        var sous = [];
        var sid = prochainId(defs);
        defs.sprites.set(sid, { n: 1, labels: {}, images: [sous], varTeinte: slot });
        poses.push({ t: "pose", ch: sid, prof: prof(i), M: ID,
          nom: NOMS[slot], masque: 0, cx: null, deplace: false });
        serie = { slot: slot, img: sous };
      }
      serie.img.push({ t: "pose", ch: fid, prof: serie.img.length + 1, M: Mfinal,
        nom: null, masque: 0, cx: null, deplace: false });
      i++;
    }
    return poses;
  }

  /*
   * EFFACER TOUT CE QUE LE ROULEAU PEUT PORTER — pas seulement nos propres
   * calques. Une pellicule GARDE ce que l'image précédente a posé : une variante
   * de quarante tracés monte jusqu'à la profondeur 80, et la suivante, plus
   * courte, héritait de ses derniers calques. On balaie donc jusqu'à la plus
   * haute profondeur que le rouleau ait jamais utilisée.
   */
  function effacements(sprite, poses) {
    var max = 64;
    for (var q = 0; q < poses.length; q++) if (poses[q].prof > max) max = poses[q].prof;
    for (var im = 0; im < sprite.images.length; im++) {
      var o = sprite.images[im];
      for (var oi = 0; oi < o.length; oi++) if (o[oi].prof > max) max = o[oi].prof;
    }
    var out = [];
    for (var pr = 1; pr <= max; pr++) out.push({ t: "retire", prof: pr });
    return out;
  }

  /*
   * L'état où un rouleau se BORNE — celui que voient les variantes dont l'index
   * dépasse sa longueur (`allerImage` borne à la dernière image).
   *
   * Il faut le connaître pour allonger un rouleau ARRIÈRE sans rien casser :
   * la casquette n'a qu'une image d'arrière, partagée par ses trente-huit
   * variantes. L'allonger avec des images VIDES ferait disparaître l'arrière de
   * toutes celles qui s'y bornaient. On comble donc avec une copie de cet état.
   */
  function etatDeBornage(sprite) {
    if (sprite._bornage) return sprite._bornage;
    var st = etatsDe(null, sprite)[sprite.images.length - 1] || new Map();
    var poses = [];
    var profs = [];
    st.forEach(function (v, k) { profs.push(k); });
    profs.sort(function (a, b) { return a - b; });
    for (var i = 0; i < profs.length; i++) {
      var e = st.get(profs[i]);
      poses.push({ t: "pose", ch: e.ch, prof: profs[i], M: e.M || ID,
        nom: e.nom || null, masque: 0, cx: null, deplace: false });
    }
    sprite._bornage = poses;
    return poses;
  }

  function injecter(defs, opts) {
    opts = opts || {};
    var type = (opts.type == null) ? 3 : opts.type;
    var tous = opts.paths || [];
    // `vide` : une image SANS rien, qui ne sert qu'à garder sa place. Une variante
    // retirée du catalogue s'injecte ainsi — sinon toutes celles publiées après
    // elle reculeraient d'un cran, et les joueurs qui les portent verraient un
    // autre accessoire.
    if (!tous.length && !opts.vide) return null;
    var rep = repere(defs, type, opts.coiffureRef);
    if (!rep) return null;

    // Deux couches : ce qui passe devant les cheveux, et ce qui passe derrière la
    // tête. Le gabarit les sépare en calques ; on les renvoie chacune dans SON
    // rouleau, à la même place.
    var devant = [], derriere = [];
    for (var k = 0; k < tous.length; k++) {
      (tous[k] && tous[k].avant === false ? derriere : devant).push(tous[k]);
    }

    var poses = construirePoses(defs, devant, rep.versAcc);
    // Un accessoire qui ne se voit QUE derrière la tête reste un accessoire : il
    // occupe une image du rouleau de devant, vide, pour tenir sa place — le refuser
    // aurait été refuser une queue de cheval ou une écharpe qui pend dans le dos.
    if (!poses.length && !derriere.length && !opts.vide) return null;
    var retires = effacements(rep.sprite, poses);

    /*
     * L'INDEX EST UN FAIT, PAS UNE CONSÉQUENCE.
     *
     * Une variante valait par son RANG d'injection : la troisième publiée tombait
     * à l'index 40 parce que deux autres étaient passées avant. Tout écart entre
     * ce qu'un client avait chargé et ce que le serveur savait donnait alors un
     * AUTRE accessoire — silencieusement. La variante tombe donc à la place
     * demandée, et à celle-là seulement.
     *
     * ON Y ÉCRIT MÊME SI LE ROULEAU EST DÉJÀ PLUS LONG. On comblait jusqu'à la
     * place demandée puis on AJOUTAIT À LA FIN — ce qui revient au même tant que
     * le catalogue n'avance que par index croissants, mais plus du tout dès qu'une
     * variante d'AVANT l'index (il n'y en avait pas alors) a déjà allongé le
     * rouleau : la place 38 demandée devenait 40, et l'accessoire que les joueurs
     * portaient sous le numéro 38 n'existait plus. On écrit donc PAR-DESSUS.
     *
     * Un plancher, tout de même : jamais en dessous des images d'époque. Un index
     * fautif ne doit pas pouvoir effacer la casquette de tout le monde.
     */
    if (rep.sprite._varDebut == null) rep.sprite._varDebut = rep.sprite.images.length;
    var cible = (opts.index == null)
      ? rep.sprite.images.length
      : Math.max(rep.sprite._varDebut, Math.floor(opts.index));
    while (rep.sprite.images.length < cible) rep.sprite.images.push(retires.slice());
    if (rep.sprite.images.length > cible) rep.sprite.images[cible] = retires.concat(poses);
    else rep.sprite.images.push(retires.concat(poses));
    rep.sprite.n = rep.sprite.images.length;
    delete rep.sprite._etats;
    var index = cible;

    /*
     * L'ARRIÈRE, dès qu'il y a un rouleau pour l'accueillir — MÊME SANS DESSIN.
     *
     * Une variante neuve dont le graphiste n'a rien mis derrière la tête doit
     * n'avoir rien derrière la tête. Ne pas toucher au rouleau arrière, comme on
     * le faisait, la laissait s'y BORNER : le bonnet de bain prêtait son arrière
     * d'époque à un accessoire qui ne le demandait pas. On y écrit donc toujours,
     * quitte à n'y écrire que du vide.
     */
    if (rep.arriere) {
      var spAr = rep.arriere.sprite;
      var bornage = etatDeBornage(spAr);
      var posesAr = construirePoses(defs, derriere, rep.arriere.versAcc);
      var retiresAr = effacements(spAr, posesAr.concat(bornage));
      // L'arrière doit tomber au MÊME index que l'avant. Deux cas :
      //  · le rouleau arrière est plus court — on le comble jusque-là, puis on
      //    pose (le bonnet de nuit, la casquette : une seule image d'arrière) ;
      //  · il est plus LONG que l'index — le bonnet type 1 a seize images devant
      //    et vingt-cinq derrière. Les images d'arrière au-delà de la longueur de
      //    l'avant ne sont JAMAIS choisies (`apply` cale les deux sur le même
      //    numéro) : on écrit donc par-dessus, sans rien retirer à personne.
      //    Ajouter à la fin, comme on le faisait, décalait l'arrière de neuf
      //    crans — l'accessoire perdait sa partie arrière.
      while (spAr.images.length < index) spAr.images.push(retiresAr.concat(bornage));
      if (spAr.images.length > index) spAr.images[index] = retiresAr.concat(posesAr);
      else spAr.images.push(retiresAr.concat(posesAr));
      spAr.n = spAr.images.length;
      delete spAr._etats;
    }

    // LES ROULEAUX COMPAGNONS SE TAISENT à notre index. Tout le dessin part dans
    // `acc` ; si `acc2` gardait son mot à dire, il se bornerait à sa dernière
    // image et poserait le bandeau du bonnet de bain sur une variante qui ne l'a
    // jamais demandé. On le comble jusqu'à nous avec son état de bornage — c'est
    // le comportement d'époque, dû aux variantes d'origine — et on le vide À notre
    // place, à la nôtre seulement.
    taire(rep, index);
    if (rep.arriere) taire(rep.arriere, index);

    return { variante: index, accId: rep.accId };
  }

  function taire(r, index) {
    var reels = r.reels || [];
    for (var i = 0; i < reels.length; i++) {
      var sp = reels[i].sprite;
      if (sp === r.sprite) continue;              // le rouleau principal, lui, parle
      var vide = effacements(sp, []);
      var bornage = etatDeBornage(sp);
      while (sp.images.length < index) sp.images.push(vide.concat(bornage));
      if (sp.images.length > index) sp.images[index] = vide.slice();
      else sp.images.push(vide.slice());
      sp.n = sp.images.length;
      delete sp._etats;
    }
  }

  /*
   * LE GABARIT, EN SVG — ce qu'on confie au graphiste.
   *
   * La casquette d'époque est bâtie exactement comme on aimerait qu'il travaille :
   * la variante 0 est la casquette NUE (son corps en niveaux de gris, dans le
   * calque « couleur1 »), et les variantes 1 à 7 ne font qu'insérer leur décor
   * dans « couleur3 ». Ajouter une variante, c'est donc reprendre ce gabarit et
   * y poser son motif.
   *
   * Deux choses à savoir, et elles sont dans l'en-tête du fichier :
   *
   *   · LES ZONES RECOLORABLES SE DESSINENT EN GRIS. La teinte d'époque est un
   *     DÉCALAGE (sortie = source + couleur − 255) : le blanc rend la couleur
   *     pleine, les gris en donnent les ombres. C'est ce qui fait que le relief
   *     suit la couleur choisie — il ne faut donc surtout pas peindre en couleur.
   *   · L'ORDRE DES CALQUES EST L'ORDRE DE PEINTURE, et chaque niveau de couleur
   *     n'existe QU'UNE FOIS à l'écran : si un même niveau revient à deux
   *     endroits de la pile, tout ce niveau sera peint à la place du premier.
   *     (C'est la contrainte d'époque : un seul sous-clip `col` par accessoire.)
   */
  function exporterSVG(defs, opts) {
    opts = opts || {};
    var type = (opts.type == null) ? 3 : opts.type;
    var variante = opts.variante || 0;
    var co = (opts.coiffure == null) ? 8 : opts.coiffure;
    var paths = exporter(defs, type, variante, co);
    var sc = defs.scene || { x: 0, y: 0, w: 100, h: 100 };
    var NOMS = { 1: "couleur1", 2: "couleur2", 3: "couleur3" };

    /*
     * UN IDENTIFIANT NE SERT À RIEN S'IL N'EST PAS UNIQUE.
     *
     * Un niveau de couleur peut revenir à plusieurs endroits de la pile : le
     * niveau 1 presque toujours (une fois derrière la tête, une fois devant), le
     * niveau 2 quand un accessoire l'emploie en deux fois. On écrivait alors deux
     * fois `id="couleur1"` — ce qu'un document XML n'autorise pas. Illustrator
     * tranchait à sa façon : il gardait le premier, celui de l'ARRIÈRE, et
     * laissait le groupe de devant sans nom. Au retour, tout le devant du niveau 1
     * revenait donc en couleur FIXE — les gris du dessin, que la couleur du joueur
     * ne touchait plus. C'était toujours le niveau 1, jamais les autres, et rien
     * ne le disait.
     *
     * Le premier garde le nom simple ; les suivants sont numérotés. Le lecteur ne
     * regarde que le début du nom, donc `couleur1-2` vaut `couleur1`.
     */
    var pris = {};
    function nomDeNiveau(s) {
      var base = NOMS[s];
      pris[base] = (pris[base] || 0) + 1;
      return pris[base] === 1 ? base : base + "-" + pris[base];
    }

    // Les tracés, dans l'ordre de peinture, groupés par SÉRIES de même niveau :
    // un calque nommé par série, pour qu'Illustrator montre des calques parlants.
    var corps = [];
    /*
     * LES DÉGRADÉS, dans l'autre sens.
     *
     * Le moteur peint un dégradé dans un carré de 32768 unités centré sur
     * l'origine, envoyé par la matrice du style (divisée par 20 au dessin). Pour
     * l'écrire en SVG, on renvoie les deux bouts de ce carré par cette même
     * matrice : ils donnent l'axe du `linearGradient`, ou le centre et le rayon
     * du `radialGradient`. En `userSpaceOnUse`, ces coordonnées vivent dans le
     * même repère que le `d` du tracé — et la transformation du tracé s'applique
     * ensuite aux deux, comme il se doit.
     */
    var defsGrad = [], defsDecoupe = [];
    function refDegrade(g) {
      var E = { a: g.M.a / 20, b: g.M.b / 20, c: g.M.c / 20, d: g.M.d / 20, e: g.M.e / 20, f: g.M.f / 20 };
      var R = function (v) { return Math.round(v * 100) / 100; };
      var id = "grad" + (defsGrad.length + 1);
      var arrets = g.arrets.map(function (a) {
        var c = "rgb(" + a.rgb[0] + "," + a.rgb[1] + "," + a.rgb[2] + ")";
        var o = (a.alpha == null || a.alpha >= 1) ? "" : ' stop-opacity="' + (Math.round(a.alpha * 1000) / 1000) + '"';
        return '      <stop offset="' + (Math.round(a.ratio / 255 * 1000) / 1000) + '" stop-color="' + c + '"' + o + " />";
      }).join("\n");
      if (g.radial) {
        var r = 16384 * Math.sqrt(E.a * E.a + E.b * E.b);
        defsGrad.push('    <radialGradient id="' + id + '" gradientUnits="userSpaceOnUse" cx="'
          + R(E.e) + '" cy="' + R(E.f) + '" r="' + R(r) + '"'
          + (g.focale ? ' fx="' + R(E.e + g.focale * r) + '"' : "") + ">\n" + arrets + "\n    </radialGradient>");
      } else {
        var x1 = E.a * -16384 + E.e, y1 = E.b * -16384 + E.f;
        var x2 = E.a * 16384 + E.e, y2 = E.b * 16384 + E.f;
        defsGrad.push('    <linearGradient id="' + id + '" gradientUnits="userSpaceOnUse" x1="'
          + R(x1) + '" y1="' + R(y1) + '" x2="' + R(x2) + '" y2="' + R(y2) + '">\n' + arrets + "\n    </linearGradient>");
      }
      return id;
    }
    function ligne(p) {
      var m = p.m || [1, 0, 0, 1, 0, 0];
      var t = (m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0)
        ? "" : ' transform="matrix(' + m.map(function (v) { return Math.round(v * 1e4) / 1e4; }).join(",") + ')"';
      var teinte = p.degrade ? ("url(#" + refDegrade(p.degrade) + ")") : p.fill;
      var peint = p.trait
        ? ' fill="none" stroke="' + teinte + '" stroke-width="' + (p.largeur || 1) + '" stroke-linejoin="round" stroke-linecap="round"'
        : ' fill="' + teinte + '"';
      var op = (p.alpha != null && p.alpha < 1) ? ' opacity="' + (Math.round(p.alpha * 1000) / 1000) + '"' : "";
      return '      <path d="' + p.d + '"' + peint + op + t + " />";
    }
    // Les tracés d'UNE couche, groupés par séries de même niveau de couleur.
    function serieDe(liste) {
      var out = [], i = 0;
      while (i < liste.length) {
        var s = liste[i].slot || 0, j = i;
        while (j < liste.length && (liste[j].slot || 0) === s) j++;
        var bloc = liste.slice(i, j).map(ligne).join("\n");
        if (s) out.push('    <g id="' + nomDeNiveau(s) + '">\n' + bloc + "\n    </g>");
        else out.push(bloc);
        i = j;
      }
      return out.join("\n");
    }
    // Une DÉCOUPE devient un masque d'écrêtage : le tracé va dans un `clipPath`,
    // ce qu'il rogne dans le groupe qui s'y réfère. Illustrator ouvre et rend
    // l'un et l'autre, et un graphiste qui crée son propre masque d'écrêtage
    // repassera par le même chemin au retour.
    function corpsDe(liste) {
      var out = [], i = 0;
      while (i < liste.length) {
        var dec = liste[i].decoupe || null, j = i;
        while (j < liste.length && (liste[j].decoupe || null) === dec) j++;
        var bloc = liste.slice(i, j);
        if (!dec) out.push(serieDe(bloc));
        else {
          var tracé = bloc.filter(function (p) { return p.estDecoupe; });
          var rogné = bloc.filter(function (p) { return !p.estDecoupe; });
          defsDecoupe.push('    <clipPath id="' + dec + '">\n'
            + tracé.map(function (p) { return "  " + ligne(p); }).join("\n") + "\n    </clipPath>");
          out.push('    <g clip-path="url(#' + dec + ')">\n' + serieDe(rogné) + "\n    </g>");
        }
        i = j;
      }
      return out.join("\n");
    }
    // DEUX CALQUES, comme sur la bouille : ce qui passe derrière la tête et ce
    // qui passe devant. Tout mettre dans « accessoire » — ce qu'on faisait —
    // ramenait la partie arrière devant au réimport : les bananes qui pendent
    // derrière la tête se retrouvaient plaquées sur le visage.
    var corpsArriere = corpsDe(paths.filter(function (p) { return p.avant === false; }));
    var corpsAvant = corpsDe(paths.filter(function (p) { return p.avant !== false; }));

    var fond = opts.fondTete || "";
    var image = fond
      ? '    <image x="' + sc.x + '" y="' + sc.y + '" width="' + sc.w + '" height="' + sc.h
        + '" href="' + fond + '" xlink:href="' + fond + '" />'
      : "";

    return '<?xml version="1.0" encoding="UTF-8"?>\n'
      + '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
      + 'viewBox="' + sc.x + " " + sc.y + " " + sc.w + " " + sc.h + '" width="' + sc.w + '" height="' + sc.h + '">\n'
      + "  <!--\n"
      + "    Frutiparc — gabarit d'accessoire" + (opts.nom ? " (" + opts.nom + ")" : "")
      + ", variante " + variante + ".\n"
      + "\n"
      + "    DESSINE LES ZONES RECOLORABLES EN NIVEAUX DE GRIS.\n"
      + "    Les calques « couleur1 », « couleur2 » et « couleur3 » sont teintés par les\n"
      + "    trois couleurs de l'accessoire. La teinte est un DÉCALAGE : le blanc rend la\n"
      + "    couleur pleine, les gris en donnent les ombres. Peindre en couleur ici, c'est\n"
      + "    perdre le relief — et la couleur choisie par le joueur.\n"
      + "\n"
      + "    LES DÉGRADÉS SONT ACCEPTÉS, et c'est même le moyen le plus direct de donner\n"
      + "    du volume : un dégradé de GRIS dans un calque « couleurN » se teinte comme\n"
      + "    un aplat, ombres comprises, quel que soit le coloris. Linéaires et radiaux,\n"
      + "    avec transparence si tu veux.\n"
      + "\n"
      + "    DES COULEURS EN DUR ? Tout ce qui est HORS des calques « couleurN » garde sa\n"
      + "    couleur telle quelle — un contour noir, un reflet blanc, un logo. Un dessin\n"
      + "    entièrement peint hors de ces calques donne donc un accessoire à couleurs\n"
      + "    FIXES, que les trois niveaux ne modifieront pas. Les deux se mélangent\n"
      + "    librement dans un même accessoire.\n"
      + "\n"
      + "    L'ORDRE DES CALQUES EST L'ORDRE DE PEINTURE. Un même niveau peut revenir\n"
      + "    à plusieurs endroits de la pile ; comme deux calques ne peuvent pas porter\n"
      + "    le même nom, les suivants sont NUMÉROTÉS : « couleur1 », « couleur1-2 »…\n"
      + "    Seul le début du nom compte, tu peux donc en créer d'autres sur ce modèle.\n"
      + "    Un calque de niveau qui perd son nom perd son niveau : son dessin revient en\n"
      + "    gris, en couleur fixe.\n"
      + "\n"
      + "    DEUX CALQUES DE DESSIN, de bas en haut :\n"
      + "      · « accessoire-arriere » : ce qui passe DERRIÈRE la tête (la mèche d'un\n"
      + "        bonnet, ce qui pend dans le dos). Souvent vide.\n"
      + "      · « accessoire »         : ce qui passe DEVANT. C'est le calque habituel.\n"
      + "    Un tracé rangé dans le mauvais des deux ressortira du mauvais côté du visage.\n"
      + "\n"
      + "    « repere » (la tête) n'est qu'un fond : verrouille-le, il est ignoré au retour.\n"
      + "    Ne change pas la taille du plan de travail (" + sc.w + "×" + sc.h + ").\n"
      + "  -->\n"
      + ((defsGrad.length || defsDecoupe.length)
        ? "  <defs>\n" + defsGrad.concat(defsDecoupe).join("\n") + "\n  </defs>\n" : "")
      + '  <g id="accessoire-arriere">\n' + corpsArriere + "\n  </g>\n"
      + '  <g id="repere" opacity="0.9" style="pointer-events:none">\n' + image + "\n  </g>\n"
      + '  <g id="accessoire">\n' + corpsAvant + "\n  </g>\n"
      + "</svg>\n";
  }

  /** La tête SEULE (sans accessoire), en PNG : le fond de repère du gabarit. */
  function fondTete(defs, coiffure, cote) {
    var M = moteur();
    if (typeof global.document === "undefined") return "";
    var p = function (n) { return M.encode62(n, 2); };
    var co = (coiffure == null) ? 8 : coiffure;
    var etat = p(0) + p(3) + p(0) + p(co) + p(0) + p(2) + p(7) + p(0) + p(0) + p(0) + p(0) + p(0);
    var c = global.document.createElement("canvas");
    c.width = cote || 512; c.height = cote || 512;
    try {
      new M.Bouille(c, defs, { etat: etat, anime: false, alea: function () { return 0.5; }, super: 4 });
      return c.toDataURL("image/png");
    } catch (e) { return ""; }
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

  var API = { repere: repere, exporter: exporter, exporterSVG: exporterSVG,
    dessinee: dessinee, fondTete: fondTete, injecter: injecter, versRgb: versRgb };
  if (typeof module === "object" && module.exports) module.exports = API;
  else global.FPBouilleVariante = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
