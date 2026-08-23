/*
 * LA TOUCHE RESTÉE ENFONCÉE — pourquoi le chat partait lettre par lettre.
 *
 * Symptôme, signalé sur Firefox : on ouvre les chatlogs (la commande /logs, ou
 * « voir les messages précédents »), et à partir de là TOUT ce qu'on tape dans
 * le chat part comme un message d'une seule lettre. Il faut actualiser la page
 * pour retrouver un clavier normal.
 *
 * Le coupable est une touche que le lecteur croit toujours enfoncée :
 *
 *   1. On tape « /logs » et on APPUIE sur Entrée. Le `keydown` arrive au
 *      lecteur, le SWF exécute la commande et appelle window.open().
 *   2. La fenêtre qui s'ouvre prend le focus AVANT qu'on ait relâché Entrée.
 *      Le `keyup`, lui, part donc à la nouvelle fenêtre — jamais à la nôtre.
 *   3. Ruffle n'écoute `keydown`/`keyup` que sur `window` (vérifié : ce sont
 *      ses deux seuls écouteurs clavier) et ne purge rien quand la fenêtre
 *      perd le focus. Entrée reste donc « enfoncée » pour toujours.
 *   4. Le champ de saisie du chat teste Entrée à chaque frappe : la lettre
 *      suivante trouve Entrée enfoncée et le message part. Lettre par lettre.
 *
 * Un `keyup` de rattrapage ne suffit pas s'il est envoyé APRÈS l'ouverture :
 * Ruffle ignore le clavier quand le lecteur n'a plus le focus (il pose un
 * écouteur `focusout` sur <ruffle-player> pour ça), et à cet instant précis
 * c'est la nouvelle fenêtre qui l'a. C'est le piège de la première correction.
 *
 * D'où la règle d'ici : on relâche AVANT d'ouvrir, tant que le lecteur a
 * encore le focus et que Ruffle écoute encore. Plutôt que de le rappeler à
 * chaque appel — la page en compte huit, et le SWF en déclenche d'autres par
 * getURL —, on enveloppe window.open une bonne fois : toute ouverture de
 * fenêtre rend d'abord le clavier.
 *
 * Le filet de sécurité, lui, sert aux cas qu'on n'ouvre pas nous-mêmes
 * (alt-tab, une notification du système, un lien ouvert par le navigateur) :
 * on retient les touches enfoncées au moment où la fenêtre perd le focus, et
 * on les relâche à son retour — le lecteur regagnant le focus, Ruffle écoute
 * de nouveau.
 *
 *     <script src="/js/clavier-colle.js"></script>
 *
 * Le module n'a besoin d'aucun réglage ; il expose :
 *     fpClavier.relacher()   relâche tout de suite les touches enfoncées
 *     fpClavier.enfoncees()  la liste des touches qu'il croit enfoncées
 */
(function () {
  'use strict';

  // Ce qu'on croit enfoncé, par `code` physique (« Enter », « KeyA »…) : c'est
  // la seule clé stable, `key` change avec les modificateurs.
  var enfoncees = new Map();
  // Ce qui l'était quand la fenêtre a perdu le focus, en attente de son retour.
  var enAttente = [];

  function noter(ev) {
    if (!ev) return;
    var code = ev.code || ev.key || '';
    if (!code) return;
    // Ce que Ruffle lit d'un événement clavier, et rien d'autre : `key`,
    // `code`, `location` (plus `charCode`, toujours nul sur un keyup). Inutile
    // de recopier `keyCode` — le constructeur de KeyboardEvent l'ignore.
    enfoncees.set(code, {
      key: ev.key,
      code: ev.code,
      location: ev.location,
      ctrlKey: ev.ctrlKey,
      altKey: ev.altKey,
      shiftKey: ev.shiftKey,
      metaKey: ev.metaKey
    });
  }

  function oublier(ev) {
    if (!ev) return;
    var code = ev.code || ev.key || '';
    if (code) enfoncees.delete(code);
  }

  // Le lecteur, quel que soit le nom de la balise que Ruffle a fabriquée.
  function lecteur() {
    return document.querySelector('#player-container ruffle-player')
      || document.querySelector('ruffle-player')
      || document.querySelector('#player-container > *');
  }

  // Un `keyup` sur `window` : le seul endroit où Ruffle écoute le clavier.
  // Il repassera par `oublier`, qui n'a alors plus rien à effacer — sans
  // risque de boucle, puisqu'on ne synthétise jamais de `keydown`.
  function envoyerRelachement(init) {
    var ev;
    try {
      ev = new KeyboardEvent('keyup', {
        key: init.key,
        code: init.code,
        location: init.location,
        ctrlKey: init.ctrlKey,
        altKey: init.altKey,
        shiftKey: init.shiftKey,
        metaKey: init.metaKey,
        bubbles: true,
        cancelable: true,
        composed: true
      });
    } catch (e) {
      return false; // navigateur qui refuse le constructeur : tant pis
    }
    try { window.dispatchEvent(ev); } catch (e) { return false; }
    return true;
  }

  function relacher() {
    if (!enfoncees.size) return 0;
    var n = 0;
    enfoncees.forEach(function (init) { if (envoyerRelachement(init)) n++; });
    enfoncees.clear();
    return n;
  }

  // Capture : on veut voir la frappe avant tout le monde, et surtout avant que
  // quoi que ce soit ne l'annule.
  window.addEventListener('keydown', noter, true);
  window.addEventListener('keyup', oublier, true);

  window.addEventListener('blur', function () {
    // Les `keyup` de ces touches-là partiront à l'autre fenêtre : on les met
    // de côté. Inutile de les relâcher maintenant, Ruffle n'écoute plus.
    if (!enfoncees.size) return;
    enfoncees.forEach(function (init) { enAttente.push(init); });
    enfoncees.clear();
  });

  window.addEventListener('focus', function () {
    if (!enAttente.length) return;
    var aRendre = enAttente;
    enAttente = [];
    // Rendre le focus au lecteur d'abord : sans lui, Ruffle jette le clavier.
    var l = lecteur();
    try { if (l && l.focus) l.focus({ preventScroll: true }); } catch (e) {}
    // Un tour de boucle pour que le `focusin` soit arrivé jusqu'à Ruffle.
    setTimeout(function () {
      for (var i = 0; i < aRendre.length; i++) envoyerRelachement(aRendre[i]);
    }, 0);
  });

  // Toute ouverture de fenêtre rend d'abord le clavier — c'est le geste qui
  // vole le `keyup`, c'est donc lui qui doit le rembourser. Avant l'appel :
  // après, la nouvelle fenêtre a le focus et Ruffle n'écoute plus.
  var ouvrir = window.open;
  if (typeof ouvrir === 'function') {
    window.open = function () {
      relacher();
      return ouvrir.apply(window, arguments);
    };
  }

  window.fpClavier = {
    relacher: relacher,
    enfoncees: function () { return Array.from(enfoncees.keys()); }
  };
})();
