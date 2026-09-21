/*
  FPBouilleRecherche — CHERCHER UN FRUTIZ PAR SA BOUILLE.

  Le Bouilloscope se parcourt par pseudo : une recherche, un alphabet. Mais
  vingt ans plus tard, beaucoup de Frutiz ne se souviennent plus du pseudo
  qu'ils portaient — ils se souviennent de leur TÊTE. La peau claire, les
  cheveux verts, le bois de cerf.

  Ce module donne de quoi fouiller l'annuaire dans ce sens-là : on décrit une
  bouille avec les mêmes réglages que l'éditeur « Ma Frutibouille », et l'on
  retient les Frutiz qui la portent.

  ── CE QU'ON PEUT DÉCRIRE ─────────────────────────────────────────────────
  Neuf champs, pris dans les douze paires base62 de l'état (cf.
  public/frutiz/BOUILLES.md, § « La chaîne d'état »). Chacun est INDÉPENDANT :
  on le règle, ou on le laisse à « peu importe ». Décrire, ce n'est pas
  remplir un formulaire entier — c'est poser les deux ou trois traits dont on
  est sûr.

  On ne propose pas les trois champs restants (accessoire secondaire et ses
  deux autres couleurs) : ce sont des détails de rendu qu'on ne garde pas en
  mémoire, et neuf lignes suffisent déjà à isoler une tête.

  Les coiffures 1, 2 et 3 — le SAC À PATATE — sont ici PROPOSÉES, alors que
  l'éditeur les écarte. C'est voulu : on ne conçoit pas un sac, mais on se
  souvient très bien de qui en portait un.

  ── ET QUAND ÇA NE DONNE RIEN ─────────────────────────────────────────────
  Une mémoire de vingt ans se trompe d'un cran. Plutôt qu'une page vide, on
  sait aussi classer TOUT l'annuaire par ressemblance :

    · d'abord le nombre de critères manqués ;
    · à égalité, la distance des COULEURS — se tromper de « Beige 2 » pour
      « Beige 3 » doit coûter moins cher que de le confondre avec « Blue 1 » ;
    · puis l'ordre alphabétique, pour que deux recherches identiques donnent
      deux fois la même liste.

  Aucun appel réseau : /api/trombinoscope livre déjà tout l'annuaire au
  navigateur (pseudo + bouille), et le tri se fait sur place.
*/
(function (global) {
  'use strict';

  var Palette = global.FPBouille
    || (typeof require === 'function' ? require('./bouille-palette.js') : null);

  // base62 : 0-9 → 0-9, a-z → 10-35, A-Z → 36-61. Le `decode62` des familles,
  // recopié par bouille-moteur.js et par l'éditeur du light.
  function dec1(c) {
    if (c >= '0' && c <= '9') return c.charCodeAt(0) - 48;
    if (c >= 'a' && c <= 'z') return c.charCodeAt(0) - 87;
    if (c >= 'A' && c <= 'Z') return c.charCodeAt(0) - 29;
    return 0;
  }
  function enc1(n) {
    n = ((n % 62) + 62) % 62;
    if (n < 10) return String.fromCharCode(48 + n);
    if (n < 36) return String.fromCharCode(87 + n);
    return String.fromCharCode(29 + n);
  }
  function bourrer(s) {
    s = String(s == null ? '' : s);
    while (s.length < 24) s += '0';
    return s.substring(0, 24);
  }
  // Une PAIRE, poids fort puis poids faible — indispensable au-delà de 61
  // (les coiffures 62 à 66 de la famille 0).
  function lire(etat, pos) {
    var s = bourrer(etat);
    return dec1(s.charAt(pos)) * 62 + dec1(s.charAt(pos + 1));
  }
  function ecrire(etat, pos, val) {
    var s = bourrer(etat);
    val = Math.max(0, val | 0);
    return s.substring(0, pos) + enc1(Math.floor(val / 62)) + enc1(val % 62) + s.substring(pos + 2);
  }

  /*
   * LES CHAMPS.
   *
   * `pos` est l'indice de la paire dans l'état ; `max` la dernière valeur
   * proposée (`_totalframes − 1` du clip visé, relevé dans les SWF de
   * famille — les mêmes chiffres que `FB_PARTS` de l'éditeur).
   *
   * `type` dit comment la ligne se montre et comment deux valeurs se
   * comparent : `couleur` pose un échantillon de `generalPalette` et sait
   * mesurer un écart, `liste` nomme ses valeurs, `valeur` n'affiche que le
   * nom du champ — exactement comme l'éditeur d'époque, qui ne numérote rien.
   */
  var CHAMPS = [
    { cle: 'famille',  libelle: 'famille',    pos: 0,  max: 24, type: 'valeur' },
    { cle: 'yeux',     libelle: 'yeux',       pos: 2,  max: 8,  type: 'valeur' },
    { cle: 'iris',     libelle: 'iris',       pos: 4,  max: 17, type: 'valeur' },
    { cle: 'cheveux',  libelle: 'cheveux',    pos: 6,  max: 66, type: 'valeur' },
    { cle: 'bouche',   libelle: 'bouche',     pos: 8,  max: 4,  type: 'valeur' },
    { cle: 'peau',     libelle: 'couleur1',   pos: 10, max: 52, type: 'couleur' },
    { cle: 'colch',    libelle: 'couleur2',   pos: 12, max: 52, type: 'couleur' },
    { cle: 'acc',      libelle: 'accessoire', pos: 14, max: 16, type: 'liste' },
    { cle: 'acccol',   libelle: 'coul. acc.', pos: 18, max: 52, type: 'couleur' },
  ];
  var PAR_CLE = {};
  CHAMPS.forEach(function (c) { PAR_CLE[c.cle] = c; });

  function champ(cle) { return PAR_CLE[cle] || null; }
  function valeur(etat, cle) { var c = champ(cle); return c ? lire(etat, c.pos) : 0; }

  /**
   * L'état 24 caractères que DÉCRIVENT des critères : le socle (sa propre
   * bouille, ou la bouille par défaut) retouché des seuls champs réglés.
   * C'est lui que l'aperçu dessine — un champ à « peu importe » garde donc le
   * trait du socle, faute de mieux à montrer.
   */
  function composer(socle, criteres) {
    var s = bourrer(socle);
    CHAMPS.forEach(function (c) {
      var v = criteres ? criteres[c.cle] : undefined;
      if (v === undefined || v === null || v < 0) return;
      s = ecrire(s, c.pos, v);
    });
    return s;
  }

  // Les critères VRAIMENT posés, dans l'ordre des champs.
  function actifs(criteres) {
    if (!criteres) return [];
    return CHAMPS.filter(function (c) {
      var v = criteres[c.cle];
      return v !== undefined && v !== null && v >= 0;
    });
  }

  function correspond(etat, criteres) {
    var l = actifs(criteres);
    for (var i = 0; i < l.length; i++) {
      if (lire(etat, l[i].pos) !== criteres[l[i].cle]) return false;
    }
    return true;
  }

  // L'écart de deux couleurs de `generalPalette`, sur [0, 1]. Une distance
  // euclidienne toute simple dans le cube RVB : on ne cherche pas la finesse
  // colorimétrique, seulement à ce que deux beiges se tiennent.
  function rvb(i) {
    var h = String((Palette && Palette.colorHex(i)) || '#000').replace('#', '');
    return [parseInt(h.slice(0, 2), 16) || 0, parseInt(h.slice(2, 4), 16) || 0, parseInt(h.slice(4, 6), 16) || 0];
  }
  var MAX_RVB = Math.sqrt(3 * 255 * 255);
  function ecartCouleur(a, b) {
    var x = rvb(a), y = rvb(b);
    var d = Math.sqrt((x[0] - y[0]) * (x[0] - y[0]) + (x[1] - y[1]) * (x[1] - y[1]) + (x[2] - y[2]) * (x[2] - y[2]));
    return d / MAX_RVB;
  }

  /**
   * Ce qui SÉPARE une bouille des critères : `{ rates, teinte }` — le nombre
   * de critères manqués, puis la somme des écarts de couleur sur ces mêmes
   * critères. Zéro et zéro, c'est la bouille décrite.
   */
  function ecart(etat, criteres) {
    var l = actifs(criteres), rates = 0, teinte = 0;
    for (var i = 0; i < l.length; i++) {
      var c = l[i], v = lire(etat, c.pos);
      if (v === criteres[c.cle]) continue;
      rates++;
      teinte += c.type === 'couleur' ? ecartCouleur(v, criteres[c.cle]) : 1;
    }
    return { rates: rates, teinte: teinte };
  }

  function compare(a, b) {
    if (a.ecart.rates !== b.ecart.rates) return a.ecart.rates - b.ecart.rates;
    if (Math.abs(a.ecart.teinte - b.ecart.teinte) > 1e-9) return a.ecart.teinte - b.ecart.teinte;
    return String(a.pseudo).localeCompare(String(b.pseudo), 'fr', { sensitivity: 'base' });
  }

  /**
   * La recherche : `{ exacts, proches, criteres }`.
   *
   * `exacts` — les Frutiz qui portent TOUS les traits décrits, dans l'ordre
   * alphabétique du Bouilloscope (l'annuaire arrive déjà trié : on ne le
   * rebouscule pas quand il n'y a rien à départager).
   *
   * `proches` — les plus ressemblants, et SEULEMENT quand il n'y a aucun
   * exact. Une liste vide n'apprend rien à qui cherche une tête vue il y a
   * vingt ans ; « voici les six têtes les plus proches » lui rend la main.
   */
  function chercher(entrees, criteres, options) {
    var o = options || {};
    var limiteProches = o.limiteProches === undefined ? 12 : o.limiteProches;
    // Repêcher sur UN seul critère n'apprendrait rien : toutes les bouilles le
    // manquent à égalité, et « les plus ressemblantes » ne serait qu'un ordre
    // alphabétique déguisé. On se tait, et l'on dit que personne ne porte ça.
    var minProches = o.minCriteresProches === undefined ? 2 : o.minCriteresProches;
    var liste = entrees || [];
    var nb = actifs(criteres).length;
    if (!nb) return { exacts: liste.slice(), proches: [], criteres: 0 };
    var exacts = [], tous = [];
    for (var i = 0; i < liste.length; i++) {
      var e = liste[i];
      var d = ecart(e.bouille, criteres);
      if (!d.rates) { exacts.push(e); continue; }
      tous.push({ pseudo: e.pseudo, bouille: e.bouille, ecart: d });
    }
    if (exacts.length || nb < minProches) return { exacts: exacts, proches: [], criteres: nb };
    tous.sort(compare);
    return { exacts: [], criteres: nb, proches: tous.slice(0, limiteProches).map(function (x) {
      return { pseudo: x.pseudo, bouille: x.bouille, rates: x.ecart.rates };
    }) };
  }

  /** Les valeurs d'un champ que l'annuaire porte VRAIMENT, triées. */
  function valeursPresentes(entrees, cle) {
    var c = champ(cle);
    if (!c) return [];
    var vus = Object.create(null);
    (entrees || []).forEach(function (e) { vus[lire(e.bouille, c.pos)] = 1; });
    return Object.keys(vus).map(Number).sort(function (a, b) { return a - b; });
  }

  /*
   * LES VALEURS QU'UNE FLÈCHE PROPOSE — ET POURQUOI PAS TOUTES.
   *
   * L'éditeur fait défiler les soixante-sept coiffures de la famille 0 : il
   * FABRIQUE un visage, et les soixante-sept existent. Une recherche, non :
   * un annuaire de quelques milliers de têtes n'en porte qu'une poignée, et
   * cycler sur le reste, c'est tomber dans le vide à chaque clic.
   *
   * On ne propose donc que les valeurs PRÉSENTES — et présentes parmi les
   * bouilles qui satisfont déjà les AUTRES critères. Chaque cran de la flèche
   * rend ainsi au moins un Frutiz, et l'on parcourt l'espace des visages qui
   * ont existé plutôt que celui des visages possibles.
   *
   * La valeur en cours y est ajoutée si elle en manque : sans quoi la flèche
   * n'aurait pas d'où partir.
   */
  function choix(entrees, criteres, cle) {
    var c = champ(cle);
    if (!c) return [];
    var autres = {};
    CHAMPS.forEach(function (x) {
      if (x.cle !== cle && criteres && criteres[x.cle] !== undefined && criteres[x.cle] !== null && criteres[x.cle] >= 0) {
        autres[x.cle] = criteres[x.cle];
      }
    });
    var restant = (entrees || []).filter(function (e) { return correspond(e.bouille, autres); });
    var vus = valeursPresentes(restant, cle);
    // Rien ne reste (les autres critères ne rendent déjà personne) : on rouvre
    // l'éventail complet du champ, sans quoi la ligne serait bloquée.
    if (!vus.length) {
      for (var i = 0; i <= c.max; i++) vus.push(i);
      return vus;
    }
    var v = criteres ? criteres[cle] : undefined;
    if (v !== undefined && v !== null && v >= 0 && vus.indexOf(v) < 0) {
      vus.push(v);
      vus.sort(function (a, b) { return a - b; });
    }
    return vus;
  }

  /** Le nom à afficher pour une valeur — vide quand le champ ne se nomme pas. */
  function nomValeur(cle, v) {
    var c = champ(cle);
    if (!c) return '';
    if (c.type === 'couleur') return (Palette && Palette.colorName(v)) || String(v);
    if (c.type === 'liste') return (Palette && Palette.accName(v)) || String(v);
    return String(v);
  }

  var API = {
    CHAMPS: CHAMPS,
    champ: champ,
    lire: lire,
    ecrire: ecrire,
    bourrer: bourrer,
    valeur: valeur,
    composer: composer,
    actifs: actifs,
    correspond: correspond,
    ecart: ecart,
    ecartCouleur: ecartCouleur,
    chercher: chercher,
    valeursPresentes: valeursPresentes,
    choix: choix,
    nomValeur: nomValeur,
  };
  global.FPBouilleRecherche = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
