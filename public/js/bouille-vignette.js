/*
  FPBouilleVignette — les vignettes du Bouilloscope, rendues en JavaScript.

  POURQUOI. Le Bouilloscope montre une grille de visages : quarante-huit d'un
  coup, sur trois écrans différents (l'onglet de l'admin, la fenêtre du bureau
  Frutiz, la page du light). Chacun s'y prenait à sa façon, et aucune n'était
  bonne :

    · l'admin posait une IFRAME RUFFLE PAR VIGNETTE — quarante-huit lecteurs
      Flash pour quarante-huit têtes de cent pixels ;
    · le bureau et le light passaient par le cache PNG du serveur
      (/bouille-img) : léger une fois chaud, mais il faut le remplir, et le
      remplir demandait… encore Ruffle, dans une iframe cachée, une capture, un
      aller-retour serveur et une écriture en base.

  Ici, rien de tout cela. Le moteur JS (bouille-swf/avm/moteur) lit le SWF de
  famille d'époque et dessine dans un canevas. Une FAMILLE est téléchargée et
  analysée UNE fois, puis toutes les vignettes qui en relèvent la partagent —
  y compris ses tracés Path2D, rangés sur la famille elle-même. La grille ne
  coûte alors qu'un dessin par vignette, et rien du tout au serveur.

  CE QU'ON GARDE DU COMPORTEMENT D'AVANT :

    · vignette PARESSEUSE — on ne dessine que ce qui approche de l'écran, comme
      le faisait loading="lazy" ;
    · vignette IMMOBILE — `anime: false`. Une bouille au repos n'est pourtant
      pas figée sous Flash (l'éclat de l'iris tourne), mais quarante-huit têtes
      qui scintillent à quarante images par seconde ne valent pas le courant
      dépensé. La qualité, elle, est au maximum : le dessin ne se faisant
      qu'une fois, il se paie le suréchantillonnage ×4.
    · fond TRANSPARENT — le carré vert du cache PNG obligeait à détourer la
      vignette à la main pour la poser ailleurs que sur du vert. Un canevas n'a
      pas de fond : le problème disparaît.

  USAGE — deux lignes à l'endroit qui dessinait la grille :

      hote.innerHTML = liste.map((e) => '<div class="tb">'
        + FPBouilleVignette.html(e.bouille) + '</div>').join('');
      FPBouilleVignette.brancher(hote);
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
  var guettes = new WeakSet();          // canevas déjà confiés au guetteur
  var guetteur = null;

  function nettoyer(s) {
    var t = String(s == null ? '' : s).replace(/[^0-9A-Za-z]/g, '').slice(0, 24);
    while (t.length < 24) t += '0';
    return t;
  }

  /** Le HTML d'une vignette : un canevas qui remplit sa boîte. */
  function html(etat, o) {
    var s = nettoyer(etat);
    var e = (o && o.humeur) ? Number(o.humeur) : 0;
    return '<canvas class="fp-bvig" data-s="' + s + '" data-e="' + e + '"'
      + ' width="1" height="1" aria-hidden="true"'
      + ' style="width:100%;height:100%;display:block"></canvas>';
  }

  function famille(n) {
    if (!chargements[n]) {
      chargements[n] = FAMILLES.indexOf(n) < 0
        ? Promise.reject(new Error('famille ' + n + ' absente'))
        : Swf.charger(DOSSIER + 'famille' + n + '.swf');
      // Une famille introuvable ne doit pas laisser traîner un rejet non
      // rattrapé dans la console à chaque vignette.
      chargements[n].catch(function () {});
    }
    return chargements[n];
  }

  function dessiner(c) {
    if (posees.has(c)) return;
    posees.set(c, null);                // marque « en cours »
    var s = c.getAttribute('data-s') || '';
    var e = Number(c.getAttribute('data-e') || 0);
    famille(M.familleDe(s)).then(function (defs) {
      if (!c.isConnected) { posees.delete(c); return; }
      var b = new M.Bouille(c, defs, { etat: s, humeur: e, anime: false });
      posees.set(c, b);
      c.setAttribute('data-prete', '1');
    }).catch(function () {
      c.setAttribute('data-prete', 'absent');
    });
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

  /** Branche (ou rebranche) toutes les vignettes trouvées sous `racine`. */
  function brancher(racine) {
    var hote = racine || global.document;
    var liste = hote.querySelectorAll('canvas.fp-bvig');
    var g = observer();
    for (var i = 0; i < liste.length; i++) {
      if (posees.has(liste[i]) || guettes.has(liste[i])) continue;
      guettes.add(liste[i]);
      if (g) g.observe(liste[i]); else dessiner(liste[i]);
    }
    return liste.length;
  }

  /** Redessine une vignette (changement d'état ou d'humeur). */
  function rafraichir(c, etat, humeur) {
    if (etat !== undefined) c.setAttribute('data-s', nettoyer(etat));
    if (humeur !== undefined) c.setAttribute('data-e', String(Number(humeur) || 0));
    var b = posees.get(c);
    posees.delete(c);
    guettes.delete(c);
    if (b) { b.arreter(); }
    dessiner(c);
  }

  global.FPBouilleVignette = {
    html: html, brancher: brancher, rafraichir: rafraichir,
    FAMILLES: FAMILLES, familles: chargements,
  };
})(typeof window !== 'undefined' ? window : globalThis);
