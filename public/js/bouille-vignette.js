/*
  FPBouilleVignette — toutes les bouilles du site, rendues en JavaScript.

  POURQUOI. Une bouille s'affichait jusqu'ici de deux façons, aucune bonne :

    · une IFRAME RUFFLE — un lecteur Flash complet par visage. Le Bouilloscope
      de l'admin en posait quarante-huit d'un coup (241 requêtes, 47 secondes) ;
      l'éditeur « Ma Frutibouille » en rechargeait un à CHAQUE clic de flèche,
      assez lentement pour qu'il ait fallu attendre 120 ms que le doigt se calme
      avant de rendre ;
    · le CACHE PNG du serveur (/bouille-img) — léger une fois chaud, mais le
      remplir demandait encore Ruffle, dans une iframe cachée, avec une capture,
      un aller-retour serveur et une écriture en base.

  Ici, un canevas et le moteur JS (bouille-swf/avm/moteur), qui lit le SWF de
  famille d'époque. Une FAMILLE est téléchargée et analysée UNE fois par page,
  puis toutes les bouilles qui en relèvent la partagent — y compris ses tracés
  Path2D, rangés sur la famille elle-même.

  TROIS USAGES, TROIS PORTES :

    html(etat) + brancher(hote)     une vignette POSÉE, dessinée quand elle
                                    approche de l'écran.
                                    Le Bouilloscope, les vignettes d'accessoires,
                                    l'avatar d'une fiche.

    rafraichir(canevas, etat)       changer d'état SANS rien recharger : tant
                                    qu'on reste dans la même famille, c'est un
                                    apply() sur un arbre déjà monté. L'éditeur
                                    et l'essayage d'accessoires.

    jouer(canevas, etat, anim)      lancer une des treize animations, puis
                                    stopper(canevas) pour revenir au repos.
                                    La réaction qui passe sur le chat.

  POSÉE NE VEUT PAS DIRE IMMOBILE. Une vignette était jusqu'ici dessinée une
  fois pour toutes (`anime: false`), et les accessoires ANIMÉS d'époque — dans
  la famille 0 : le 3 (variantes 25 et 33), le 6, le 10 — apparaissaient figés
  partout : sur la fiche, dans l'éditeur, dans l'inventaire, dans un salon.
  C'est faux : `apply()` du SWF n'arrête que `c`, `acc` et `acc2` (gotoAndStop),
  jamais leurs enfants, et c'est un enfant qui porte la pellicule — soixante-
  quinze images pour le 6, vingt-sept pour le 10.

  On laisse donc le moteur décider : il demande à l'arbre s'il a une tête de
  lecture en marche (`enMouvement`). S'il n'en a aucune, la bouille est une
  image fixe et se paie le suréchantillonnage ×4 sans compter ; s'il en a une,
  elle tourne à quarante images par seconde et passe à ×2 — cinq fois moins
  cher, et l'œil n'y voit rien en mouvement.
*/
(function (global) {
  'use strict';

  var Swf = global.FPBouilleSwf;
  var M = global.FPBouilleMoteur;

  // Les familles qui existent vraiment. Une bouille d'une famille absente ne se
  // dessine pas : on laisse la case vide plutôt que de tourner en boucle sur un
  // fichier introuvable.
  var FAMILLES = [0, 10, 11, 12, 13, 14, 15, 16, 23, 24];
  var DOSSIER = '/fbouille/';
  var chargements = {};                 // famille → Promise<defs>
  var posees = new WeakMap();           // canevas → Bouille
  var promesses = new WeakMap();        // canevas → Promise<Bouille|null>
  var guettes = new WeakSet();          // canevas déjà confiés au guetteur
  var tours = new WeakMap();            // canevas → numéro du montage en cours
  var guetteur = null;

  function nettoyer(s) {
    var t = String(s == null ? '' : s).replace(/[^0-9A-Za-z]/g, '').slice(0, 24);
    while (t.length < 24) t += '0';
    return t;
  }

  // ── ACCESSOIRES MAISON ─────────────────────────────────────────────────────
  // Une bouille peut porter un accessoire dessiné en SVG : la chaîne prend alors
  // la forme « <état 24>|<id> ». On sépare l'id, et on va chercher ses aplats
  // (une fois par id, mis en cache) pour les passer au moteur (accessoireCustom).
  var customCache = {};   // id → Promise<paths|null>
  var customPret = {};    // id → paths|null (résolu — pour un accès synchrone)
  function separer(etat) {
    var raw = String(etat == null ? '' : etat);
    var i = raw.indexOf('|');
    var cid = i >= 0 ? raw.slice(i + 1).replace(/[^0-9A-Za-z]/g, '').slice(0, 24) : '';
    return { s: nettoyer(i >= 0 ? raw.slice(0, i) : raw), cid: cid };
  }
  // Résout un id vers { paths, couleurs } (ou null). `couleurs` = les 3 niveaux
  // de couleur (hex) de l'accessoire, pour ses tracés « à niveau ».
  // Les ids dont le dessin vient de changer : on les redemande SANS le cache du
  // navigateur (cf. `contournerCache` des variantes — vider notre table ne sert
  // à rien tant que le navigateur reservit la réponse d'avant).
  var customFrais = {};
  function paquetCustom(id) {
    if (!id) return Promise.resolve(null);
    if (Object.prototype.hasOwnProperty.call(customPret, id)) return Promise.resolve(customPret[id]);
    if (!customCache[id]) {
      var neuf = !!customFrais[id];
      delete customFrais[id];
      var url = '/api/light/acc-maison/' + encodeURIComponent(id) + (neuf ? ('?t=' + Date.now()) : '');
      customCache[id] = global.fetch(url, neuf ? { cache: 'no-store' } : undefined)
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          var p = (j && j.ok) ? { paths: j.paths, couleurs: j.couleurs || null } : null;
          customPret[id] = p; return p;
        })
        .catch(function () { customPret[id] = null; return null; });
    }
    return customCache[id];
  }
  /*
   * OUBLIER LE DESSIN D'UN ACCESSOIRE MAISON.
   *
   * Le dessin est mis en cache PAR IDENTIFIANT, et un accessoire dont on
   * remplace le SVG GARDE le sien : « même identifiant, ceux qui le portent
   * voient le nouveau ». La table, elle, servait donc l'ancien dessin — l'admin
   * déposait un fichier et revoyait le précédent, à la ligne du bon accessoire.
   * C'est le pendant d'`oublierFamilles` pour les variantes.
   */
  function oublierCustom(id) {
    if (id) {
      delete customCache[id]; delete customPret[id]; customFrais[id] = true;
      return;
    }
    for (var k in customPret) customFrais[k] = true;
    for (var k2 in customCache) customFrais[k2] = true;
    customCache = {}; customPret = {};
  }

  /** Le HTML d'une bouille : un canevas qui remplit sa boîte. */
  function html(etat, o) {
    var sp = separer(etat);
    var e = (o && o.humeur) ? Number(o.humeur) : 0;
    return '<canvas class="fp-bvig" data-s="' + sp.s + '" data-e="' + e + '"'
      + (sp.cid ? ' data-custom="' + sp.cid + '"' : '')
      + ((o && o.anime) ? ' data-anime="1"' : '')
      + ' width="1" height="1" aria-hidden="true"'
      + ' style="width:100%;height:100%;display:block"></canvas>';
  }

  /*
   * LES VARIANTES PUBLIÉES — et pourquoi elles s'injectent ICI.
   *
   * Une variante d'accessoire créée à l'atelier n'existe pas dans le SWF : c'est
   * une image ajoutée au rouleau, au chargement, par bouille-variante.js. Une
   * bouille qui la porte la désigne par son INDEX dans ce rouleau — index qui
   * vient du RANG d'injection. Pour qu'un même index veuille dire la même chose
   * sur tous les écrans, il faut donc que tout le monde injecte LES MÊMES
   * variantes DANS LE MÊME ORDRE, et une seule fois par famille.
   *
   * D'où ce point de passage : `famille()` est le seul endroit du site où une
   * famille est chargée pour être affichée, et sa promesse est mise en cache —
   * l'injection s'y fait donc exactement une fois. Une variante retirée garde sa
   * place (une image vide) pour ne pas décaler celles d'après.
   *
   * Si le catalogue ne répond pas, on rend la famille telle quelle : mieux vaut
   * une bouille sans le dernier accessoire qu'une page sans bouilles.
   */
  var catalogue = null;
  // Le catalogue est servi avec un `max-age` : les pages ordinaires le prennent
  // dans le cache du navigateur, et c'est très bien — une variante qui met une
  // minute à paraître ne gêne personne. Mais l'admin qui vient de PUBLIER, si :
  // vider notre cache ne servait à rien tant que le navigateur reservait la
  // réponse d'avant. Après un oubli explicite, on redemande donc sans cache.
  var contournerCache = false;
  function variantes() {
    if (!catalogue) {
      var url = '/api/light/variantes' + (contournerCache ? ('?t=' + Date.now()) : '');
      var opts = contournerCache ? { cache: 'no-store' } : undefined;
      contournerCache = false;
      catalogue = (typeof global.fetch === 'function')
        ? global.fetch(url, opts)
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (j) { return (j && j.ok) ? j.liste : []; })
          .catch(function () { return []; })
        : Promise.resolve([]);
    }
    return catalogue;
  }
  function injecterVariantes(defs, n, liste) {
    var V = global.FPBouilleVariante;
    if (!V || !liste || !liste.length) return defs;
    for (var i = 0; i < liste.length; i++) {
      var v = liste[i];
      if ((v.famille || 0) !== n) continue;
      try {
        // Une variante retirée : on injecte quand même, sans tracé, pour que le
        // rouleau grandisse et que les rangs suivants restent à leur place.
        //  : la place DÉFINITIVE de la variante, décidée à la publication.
        // Le rouleau est comblé jusque-là — une variante tombe donc au même
        // endroit chez tout le monde, quel que soit ce qui a été chargé avant.
        // (Sans index — les variantes d'avant ce changement — on empile, comme
        // auparavant : l'ordre du catalogue suffit à les retrouver.)
        V.injecter(defs, { type: v.type, paths: v.paths || [],
          coiffureRef: v.coiffureRef, index: (v.index == null ? undefined : v.index),
          vide: !(v.paths && v.paths.length) });
      } catch (e) { /* une variante fautive n'empêche pas les autres */ }
    }
    return defs;
  }

  /*
   * OUBLIER LES FAMILLES — après qu'une variante a été publiée.
   *
   * Une famille est chargée UNE FOIS, variantes injectées, puis gardée : c'est
   * ce qui garantit qu'un index veut dire la même chose partout. Mais l'admin,
   * lui, publie une variante SANS recharger la page — et sa famille en cache
   * reste alors celle d'AVANT. L'index tout juste attribué n'y existe pas, et
   * `allerImage` le ramène à la dernière image du rouleau : souvent une image
   * vide, d'où un accessoire qui disparaît de l'aperçu sans un mot d'erreur.
   *
   * On jette donc tout : le catalogue, les familles, et les bouilles déjà
   * montées (qui tiennent l'ancienne famille par la main). Les WeakMap ne se
   * vident pas — on les remplace. Le prochain rendu repart d'un chargement neuf.
   *
   * Réservé à l'admin : sur le site, une page qui vit longtemps garde sa
   * famille, et c'est très bien ainsi.
   */
  function oublierFamilles() {
    chargements = {};
    catalogue = null;
    contournerCache = true;
    posees = new WeakMap();
    promesses = new WeakMap();
    guettes = new WeakSet();
    tours = new WeakMap();
    return true;
  }

  function famille(n) {
    if (!chargements[n]) {
      chargements[n] = FAMILLES.indexOf(n) < 0
        ? Promise.reject(new Error('famille ' + n + ' absente'))
        : Promise.all([Swf.charger(DOSSIER + 'famille' + n + '.swf'), variantes()])
          .then(function (r) { return injecterVariantes(r[0], n, r[1]); });
      // Une famille introuvable ne doit pas laisser traîner un rejet non
      // rattrapé dans la console à chaque bouille.
      chargements[n].catch(function () {});
    }
    return chargements[n];
  }

  /*
   * Monte la bouille sur ce canevas. Rend une promesse, mise en cache.
   *
   * LE NUMÉRO DE TOUR, ET POURQUOI IL N'EST PAS DÉCORATIF.
   *
   * Aller chercher une famille, c'est aller chercher un FICHIER : entre la
   * demande et la réponse, il se passe le temps du réseau. Or on ne demande
   * pas qu'une fois. Dans le chat, un seul canevas sert tout le monde, et
   * chaque personne qui parle le redemande pour SA bouille — `rafraichir`
   * oublie la précédente et relance.
   *
   * Oublier ne suffisait pas. La demande d'AVANT continuait sa route, et
   * quand elle rentrait — après la nouvelle, ou pendant — elle montait quand
   * même son arbre sur le canevas : `posees.set(c, b)`, et sa boucle de
   * rendu partait. Deux bouilles vivantes sur un seul canevas, chacune
   * peignant la sienne à quarante images par seconde. C'est le clignotement
   * que les joueurs voyaient : la bouille de celui qui parle et le sac à
   * patates l'une par-dessus l'autre.
   *
   * Chaque montage porte donc son numéro de tour. Au retour, s'il n'est plus
   * le tour courant, on rend la main sans rien poser.
   */
  function dessiner(c) {
    var p = promesses.get(c);
    if (p) return p;
    /*
     * UNE BOUILLE DÉJÀ MONTÉE NE SE RECOUVRE PAS.
     *
     * `posees` et `promesses` doivent vivre et mourir ensemble ; s'ils se
     * désaccordent — une bouille montée dont la promesse a disparu —, monter
     * par-dessus fabrique DEUX bouilles vivantes sur un canevas, chacune
     * peignant la sienne : le clignotement où le visage du locuteur alterne
     * avec celui d'un autre. C'est arrivé (cf. le tampon du garde ci-dessous) ;
     * quoi qu'il arrive encore, on RÉADOPTE la bouille en place au lieu d'en
     * remonter une seconde.
     */
    var enPlace = posees.get(c);
    if (enPlace) {
      p = Promise.resolve(enPlace);
      promesses.set(c, p);
      return p;
    }
    var s = c.getAttribute('data-s') || '';
    var e = Number(c.getAttribute('data-e') || 0);
    var anime = c.getAttribute('data-anime') === '1';
    var cid = c.getAttribute('data-custom') || '';
    var tour = (tours.get(c) || 0) + 1;
    tours.set(c, tour);
    p = Promise.all([famille(M.familleDe(s)), paquetCustom(cid)]).then(function (r) {
      var defs = r[0], paq = r[1];
      /*
       * LE TAMPON D'UN MONTAGE ÉCARTÉ NE VAUT QUE POUR LUI.
       *
       * Il faisait `promesses.delete(c)` sans regarder À QUI est la promesse
       * dans la carte. Or dans une rafale — le REJEU d'historique à la
       * connexion joue plusieurs émotions d'un coup, avant que le premier
       * montage ait fini —, chaque `oublier` + `dessiner` remplace la
       * promesse : quand les montages écartés rentraient enfin, le premier
       * d'entre eux SUPPRIMAIT LA PROMESSE DU SURVIVANT. Restait une bouille
       * montée sans promesse ; le `jouer` suivant remontait par-dessus, et
       * l'on avait deux bouilles vivantes sur la scène du chat — celle du
       * locuteur en alternance avec celle du dernier locuteur du rejeu.
       */
      if (!c.isConnected || tours.get(c) !== tour) {
        if (promesses.get(c) === p) promesses.delete(c);
        return null;
      }
      // Sans `anime`, le moteur tranche tout seul : image fixe si l'arbre n'a
      // rien à jouer, pellicule sinon. `data-anime="1"` (la scène de réaction
      // du chat) annonce qu'on va lui demander des animations : elle garde
      // alors la finesse de mouvement entre deux réactions.
      var b = new M.Bouille(c, defs, { etat: s, humeur: e,
        anime: anime ? true : undefined,
        accessoireCustom: paq && paq.paths, accessoireCouleurs: paq && paq.couleurs });
      posees.set(c, b);
      c.setAttribute('data-prete', '1');
      return b;
    }).catch(function () {
      if (tours.get(c) !== tour) return null;
      c.setAttribute('data-prete', 'absent');
      return null;
    });
    promesses.set(c, p);
    return p;
  }

  function observer() {
    if (guetteur || typeof global.IntersectionObserver !== 'function') return guetteur;
    guetteur = new global.IntersectionObserver(function (entrees) {
      for (var i = 0; i < entrees.length; i++) {
        if (!entrees[i].isIntersecting) continue;
        guetteur.unobserve(entrees[i].target);
        dessiner(entrees[i].target);
      }
    }, { rootMargin: '200px' });
    return guetteur;
  }

  /** Branche toutes les bouilles trouvées sous `racine`. Idempotent. */
  function brancher(racine) {
    var hote = racine || global.document;
    var liste = hote.querySelectorAll('canvas.fp-bvig');
    var g = observer();
    for (var i = 0; i < liste.length; i++) {
      if (promesses.has(liste[i]) || guettes.has(liste[i])) continue;
      guettes.add(liste[i]);
      if (g) g.observe(liste[i]); else dessiner(liste[i]);
    }
    return liste.length;
  }

  /*
   * Changer d'état — et c'est là que le moteur change la donne.
   *
   * L'éditeur rechargeait une iframe Ruffle à chaque clic de flèche. Ici, tant
   * qu'on reste dans la même FAMILLE, changer d'état c'est rejouer apply() sur
   * un arbre déjà monté : quelques dixièmes de milliseconde. Changer de famille,
   * en revanche, demande un autre fichier — on repart de zéro.
   */
  function rafraichir(c, etat, humeur) {
    var avant = c.getAttribute('data-s') || '';
    var avantCid = c.getAttribute('data-custom') || '';
    var sp = etat === undefined ? { s: avant, cid: avantCid } : separer(etat);
    var s = sp.s;
    var e = humeur === undefined ? Number(c.getAttribute('data-e') || 0) : (Number(humeur) || 0);
    c.setAttribute('data-s', s);
    c.setAttribute('data-e', String(e));
    if (sp.cid) c.setAttribute('data-custom', sp.cid); else c.removeAttribute('data-custom');
    var b = posees.get(c);
    if (b && M.familleDe(s) === M.familleDe(avant)) {
      // L'accessoire maison est posé AVANT le rendu (definir rerend) : on prend
      // ses aplats dans le cache résolu s'ils y sont, sinon on rerend au retour.
      // Poser (ou retirer) l'accessoire maison ne doit pas EXIGER un moteur :
      // `rafraichir` sert aussi à des bouilles réduites, et le nettoyage d'un
      // accessoire absent n'a aucune raison de faire tomber le rendu.
      var pret = Object.prototype.hasOwnProperty.call(customPret, sp.cid) ? customPret[sp.cid] : undefined;
      if (b.moteur) {
        if (sp.cid && pret !== undefined) {
          b.moteur.accessoireCustom = pret ? pret.paths : null;
          b.moteur.accessoireCouleurs = pret ? pret.couleurs : null;
        } else if (!sp.cid) {
          b.moteur.accessoireCustom = null; b.moteur.accessoireCouleurs = null;
        }
      }
      b.definir(s);
      // `humeur(0)` est le visage NEUTRE, pas « pas d'humeur » : le tester
      // interdisait tout retour au calme — une bouille fâchée le restait.
      b.humeur(e);
      if (sp.cid && pret === undefined) {
        paquetCustom(sp.cid).then(function (paq) {
          if (c.getAttribute('data-custom') !== sp.cid || posees.get(c) !== b) return; // périmé
          b.moteur.accessoireCustom = paq ? paq.paths : null;
          b.moteur.accessoireCouleurs = paq ? paq.couleurs : null;
          b.rendre();
        });
      }
      return b;
    }
    // CHANGER DE FAMILLE, C'EST REPARTIR DE ZÉRO — et le remontage est
    // ASYNCHRONE (il faut aller chercher un autre fichier). Sans effacer, le
    // canevas garde les pixels de la bouille PRÉCÉDENTE tout ce temps-là :
    // dans l'aquarium du chat, où un seul lecteur sert tout le monde, on
    // voyait le visage du locuteur d'avant sous celui qui vient de parler,
    // puis un clignotement quand la nouvelle famille arrivait enfin.
    vider(c);
    oublier(c);
    dessiner(c);
    return null;
  }

  /** Efface le canevas — rien ne doit survivre à un changement de bouille. */
  function vider(c) {
    try {
      var g = c.getContext('2d');
      if (g) g.clearRect(0, 0, c.width, c.height);
    } catch (err) { /* un canevas détaché n'a rien à effacer */ }
  }

  function oublier(c) {
    var b = posees.get(c);
    if (b) b.arreter();
    posees.delete(c);
    promesses.delete(c);
    guettes.delete(c);
    // ET ON TOURNE LA PAGE : un montage encore en route ne doit plus rien
    // poser à son retour. Sans ce coup de tampon, `arreter()` n'arrête que la
    // bouille DÉJÀ montée — celle qui arrive derrière repartirait de plus
    // belle sur le même canevas.
    tours.set(c, (tours.get(c) || 0) + 1);
  }

  /*
   * Lance une animation (indice de playAnim, 1 = parle).
   *
   * Il fallait autrefois REMONTER la bouille au premier appel, parce que la
   * finesse de rendu était fixée à la construction et changeait entre une
   * vignette figée et une bouille en mouvement. Le moteur l'ajuste maintenant
   * de lui-même : on garde l'arbre en place, l'animation part tout de suite.
   */
  function jouer(c, etat, anim, humeur) {
    c.setAttribute('data-anime', '1');
    if (etat !== undefined) rafraichir(c, etat, humeur);
    return dessiner(c).then(function (b) {
      if (b) b.animer(Number(anim) || 1);
      return b;
    });
  }

  /*
   * Ramène au repos : l'animation s'arrête, la bouille reste.
   *
   * `ajuster()` et non `arreter()` : `jouerAnim(0)` remet le visage, les yeux
   * et la bouche à l'arrêt, mais un ACCESSOIRE animé, lui, n'a jamais cessé de
   * tourner — d'époque comme ici. C'est au moteur de dire si la boucle a
   * encore une raison d'être.
   */
  function stopper(c) {
    var b = posees.get(c);
    if (!b) return null;
    b.moteur.jouerAnim(0);
    b.ajuster();
    b.rendre();
    return b;
  }

  /** La bouille posée sur ce canevas, si elle est déjà dessinée. */
  function bouilleDe(c) { return posees.get(c) || null; }

  global.FPBouilleVignette = {
    html: html, brancher: brancher, rafraichir: rafraichir,
    jouer: jouer, stopper: stopper, bouilleDe: bouilleDe, oublier: oublier,
    // À rappeler quand le catalogue des variantes a CHANGÉ (l'admin qui publie) :
    // sans cela la page garde la famille d'avant, où l'index neuf n'existe pas.
    oublierFamilles: oublierFamilles,
    // Idem pour le dessin d'un accessoire MAISON dont on vient de remplacer le
    // SVG : même identifiant, dessin neuf. Sans argument, on oublie tout.
    oublierCustom: oublierCustom,
    FAMILLES: FAMILLES,
    //  est REMPLACÉ par oublierFamilles : on l'expose par une
    // fonction, sinon on servirait pour toujours la première table.
    familles: function () { return chargements; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
