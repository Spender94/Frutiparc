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
  function paquetCustom(id) {
    if (!id) return Promise.resolve(null);
    if (Object.prototype.hasOwnProperty.call(customPret, id)) return Promise.resolve(customPret[id]);
    if (!customCache[id]) {
      customCache[id] = global.fetch('/api/light/acc-maison/' + encodeURIComponent(id))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          var p = (j && j.ok) ? { paths: j.paths, couleurs: j.couleurs || null } : null;
          customPret[id] = p; return p;
        })
        .catch(function () { customPret[id] = null; return null; });
    }
    return customCache[id];
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

  function famille(n) {
    if (!chargements[n]) {
      chargements[n] = FAMILLES.indexOf(n) < 0
        ? Promise.reject(new Error('famille ' + n + ' absente'))
        : Swf.charger(DOSSIER + 'famille' + n + '.swf');
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
    var s = c.getAttribute('data-s') || '';
    var e = Number(c.getAttribute('data-e') || 0);
    var anime = c.getAttribute('data-anime') === '1';
    var cid = c.getAttribute('data-custom') || '';
    var tour = (tours.get(c) || 0) + 1;
    tours.set(c, tour);
    p = Promise.all([famille(M.familleDe(s)), paquetCustom(cid)]).then(function (r) {
      var defs = r[0], paq = r[1];
      if (!c.isConnected || tours.get(c) !== tour) { promesses.delete(c); return null; }
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
      var pret = Object.prototype.hasOwnProperty.call(customPret, sp.cid) ? customPret[sp.cid] : undefined;
      if (sp.cid && pret !== undefined) {
        b.moteur.accessoireCustom = pret ? pret.paths : null;
        b.moteur.accessoireCouleurs = pret ? pret.couleurs : null;
      } else if (!sp.cid) {
        b.moteur.accessoireCustom = null; b.moteur.accessoireCouleurs = null;
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
    FAMILLES: FAMILLES, familles: chargements,
  };
})(typeof window !== 'undefined' ? window : globalThis);
