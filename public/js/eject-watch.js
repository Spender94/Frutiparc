/*
 * LE DISQUE A QUITTÉ LA FRUSION — on ferme la fenêtre.
 *
 * Sur le bureau, sortir un disque de la console doit refermer la fenêtre de
 * jeu : le jeu qu'on vient d'éjecter n'a plus rien à faire là, et surtout il
 * continuerait d'écrire ses sauvegardes par-dessus la partie suivante.
 *
 * Le signal ne peut pas traverser les fenêtres directement. Ruffle fait passer
 * son réseau par WASM, sous les enveloppes `fetch` et `XMLHttpRequest` que la
 * page du bureau pose : celle-ci ne VOIT donc pas le déplacement du disque
 * qu'elle vient pourtant de demander. Le serveur, lui, le voit (/ff/mv vers
 * `disccollector`) : il le note, et la fenêtre de jeu vient le lui DEMANDER.
 * C'est ce que fait ce guetteur, toutes les secondes et demie.
 *
 * game-popup.html — la fenêtre des jeux Flash — le faisait déjà de son côté.
 * Les clients NATIFS, eux, ne le faisaient pas : Grapiz, Frutibandas, et les
 * trois portages HTML (MiniPixiz, MiniWave, Mini-Fever) restaient ouverts
 * après l'éjection. D'où ce fichier, qu'ils incluent tous :
 *
 *     <script src="/js/eject-watch.js" data-jeu="grapiz"></script>
 *
 * `data-jeu` est le swfName du disque (server.js, GAME_DISCS) : c'est la clé
 * sous laquelle le serveur note l'éjection. Le sid se lit dans l'adresse.
 *
 * `fd=0` : la même route porte le drapeau « plus de parties », qu'elle EFFACE
 * en le rendant. Ce guetteur-là n'en a que faire — et s'il le consommait, la
 * fenêtre à qui il était destiné ne le verrait jamais.
 */
(function () {
  'use strict';
  var script = document.currentScript;
  var jeu = (script && script.getAttribute('data-jeu')) || '';
  var sid = '';
  try { sid = new URLSearchParams(window.location.search).get('sid') || ''; } catch (e) { return; }
  // Hors du bureau (jeu ouvert à la main, sans session), il n'y a pas de disque
  // à surveiller : on ne réveille pas le serveur pour rien.
  if (!jeu || !sid) return;

  var adresse = '/api/check-ejected?fd=0&sid=' + encodeURIComponent(sid)
    + '&game=' + encodeURIComponent(jeu);

  // Fermer peut échouer — le navigateur refuse parfois de fermer une fenêtre
  // qu'il ne considère pas comme ouverte par script. On ne peut pas laisser le
  // jeu tourner pour autant : il continuerait d'écrire ses sauvegardes
  // par-dessus la partie suivante. À défaut de fermer, on éteint.
  function eteindre() {
    try { window.close(); } catch (e) { /* on continue */ }
    setTimeout(function () {
      if (window.closed) return;
      try {
        document.title = 'Disque éjecté';
        var voile = document.createElement('div');
        voile.setAttribute('style', 'position:fixed;inset:0;z-index:2147483647;'
          + 'background:#1d2b12;color:#EAF3D8;display:flex;align-items:center;'
          + 'justify-content:center;text-align:center;padding:24px;'
          + 'font:16px/1.6 Verdana,Geneva,sans-serif');
        voile.textContent = 'Disque éjecté de la Frusion — cette fenêtre peut être fermée.';
        document.body.appendChild(voile);
      } catch (e) { /* rien de mieux à faire */ }
    }, 400);
  }

  var minuteur = setInterval(function () {
    fetch(adresse)
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || !j.ejected) return;
        clearInterval(minuteur);   // le serveur ne le dira qu'une fois : on arrête là
        eteindre();
      })
      .catch(function () { /* le bureau est peut-être fermé : on réessaiera */ });
  }, 1500);
})();
