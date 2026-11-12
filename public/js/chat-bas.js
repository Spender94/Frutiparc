/*
 * LE FIL D'UN CHAT QUI RESTE EN BAS (Frutibandas, Grapiz).
 *
 * Le jeu vit dans une fenêtre du bureau : quand le joueur passe sur un autre
 * onglet de Frutiparc, cette fenêtre est retirée de l'affichage (display:none)
 * — et le navigateur OUBLIE alors la position de défilement de tout ce
 * qu'elle contient. Au retour, le chat de la partie était remonté tout en
 * haut de la conversation.
 *
 * garderLeBas(boite) retient donc, tant que la boîte est affichée, où le
 * joueur en était (collé en bas, ou remonté à telle hauteur), et le lui rend
 * dès qu'elle retrouve une taille. Les messages arrivés entre-temps suivent :
 * qui lisait le bas retrouve le bas.
 */
(function () {
  "use strict";
  function garderLeBas(boite, marge) {
    if (!boite || boite.__garderLeBas) return;
    boite.__garderLeBas = true;
    marge = marge || 30;
    var enBas = true, haut = 0, visible = boite.clientHeight > 0;
    function noter() {
      if (boite.clientHeight <= 0) return;          // cachée : ce qu'on lit ne vaut rien
      enBas = boite.scrollHeight - boite.scrollTop - boite.clientHeight < marge;
      haut = boite.scrollTop;
    }
    function rendre() {
      if (boite.clientHeight <= 0) { visible = false; return; }
      if (visible) return;
      visible = true;
      boite.scrollTop = enBas ? boite.scrollHeight : haut;
    }
    boite.addEventListener("scroll", function () { if (visible) noter(); });
    if (typeof ResizeObserver === "function") new ResizeObserver(rendre).observe(boite);
    // Filets : le retour de l'onglet du navigateur, de la fenêtre.
    document.addEventListener("visibilitychange", function () { if (!document.hidden) setTimeout(rendre, 0); });
    window.addEventListener("focus", function () { setTimeout(rendre, 0); });
    window.addEventListener("resize", rendre);
    noter();
  }
  window.garderLeBas = garderLeBas;
})();
