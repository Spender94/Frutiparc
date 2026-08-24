//
// Frutibandas — la note du CHAMPIONNAT (le mode 2 du jeu d'origine).
//
// Ce que la source impose, et qu'on ne réinvente pas :
//
//   · frutibandas/Main.as  : FREE_MODE = 0, CHALLENGE_MODE = 1, CHAMPION_MODE = 2.
//   · FruticardSlot.as     : $l  = [victoires, défaites, nulles] du championnat,
//                            $ls = [note, note MINIMALE, note MAXIMALE].
//     Un compteur qui ne fait que monter n'a aucun besoin d'un MINIMUM : $ls
//     décrit une note qui monte ET qui descend. C'est bien un classement de
//     type Elo, et non un cumul de points.
//   · Manager.as           : la note ne se calcule pas dans le client — elle
//     ARRIVE du serveur (`onCbkScoreModif`, attribut `s`), et seul le mode 2
//     la lit. Le serveur frusion de Motion-Twin est perdu : LA FORMULE EXACTE
//     N'EST PAS RÉCUPÉRABLE.
//
// On reconstruit donc l'Elo classique (Arpad Elo, celui des échecs), qui est
// ce que « gagner/perdre du classement » veut dire partout ailleurs, avec deux
// réglages explicites :
//
//   · un coefficient de PLACEMENT (48 sur les dix premières parties classées,
//     32 ensuite) : les nouveaux venus rejoignent vite leur vrai niveau, les
//     habitués ne voient plus leur note sauter à chaque partie ;
//   · un PLANCHER à 100 : une mauvaise série ne doit pas envoyer quelqu'un à
//     zéro, ni en dessous.
//
// Les deux coefficients étant indépendants, un échange n'est pas à somme nulle
// quand un joueur est en placement et l'autre non — c'est le comportement des
// systèmes modernes, et c'est voulu : la note du débutant doit bouger plus vite
// que celle de son adversaire.
//
// Module PUR (aucune dépendance, aucun état) : il se teste seul, et il est
// isomorphe — le client peut afficher le même calcul que le serveur.
//
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else (root.Bandas = root.Bandas || {}).elo = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var DEPART = 1000;      // la note d'un joueur qui n'a jamais joué de classée
  var PLANCHER = 100;     // on ne descend pas plus bas
  var PLACEMENT = 10;     // parties classées avant la fin du placement
  var K_PLACEMENT = 48;
  var K_ETABLI = 32;

  // La fiche championnat d'un joueur, aux mesures de FruticardSlot :
  //   l  = [victoires, défaites, nulles]   ($l)
  //   ls = [note, minimum atteint, maximum atteint]   ($ls)
  //   linit : la note a-t-elle déjà été touchée ? ($linit — sans lui, min et
  //           max valent 0 et le premier calcul les écraserait tous les deux)
  function fiche(source) {
    var s = source || {};
    var l = Array.isArray(s.l) && s.l.length === 3 ? s.l.map(entier) : [0, 0, 0];
    var init = !!s.linit;
    var ls = Array.isArray(s.ls) && s.ls.length === 3 ? s.ls.map(entier) : [DEPART, DEPART, DEPART];
    if (!init) ls = [DEPART, DEPART, DEPART];
    return { linit: init, l: l, ls: ls };
  }
  function entier(v) { var n = Math.round(Number(v)); return isFinite(n) ? n : 0; }

  function note(f) { return fiche(f).ls[0]; }
  function parties(f) { var l = fiche(f).l; return l[0] + l[1] + l[2]; }
  function coefficient(f) { return parties(f) < PLACEMENT ? K_PLACEMENT : K_ETABLI; }

  // L'espérance d'Elo : la probabilité que `a` batte `b`.
  function esperance(a, b) { return 1 / (1 + Math.pow(10, (b - a) / 400)); }

  // Le résultat d'une partie, du point de vue du premier : 1 gagné, 0 perdu,
  // 0,5 nul (l'égalité EXISTE à Frutibandas — les deux camps peuvent perdre
  // leur dernier fruit d'un coup, « La Vachette » gagne).
  function issue(resultat) {
    if (resultat === "v") return 1;
    if (resultat === "d") return 0;
    return 0.5;
  }

  // Applique une partie à une fiche. Renvoie la fiche SUIVANTE et l'écart, sans
  // toucher à celle qu'on lui donne.
  function apres(f, noteAdverse, resultat) {
    var av = fiche(f);
    var k = coefficient(av);
    var attendu = esperance(av.ls[0], entier(noteAdverse));
    var brut = av.ls[0] + k * (issue(resultat) - attendu);
    var apr = Math.max(PLANCHER, Math.round(brut));
    var l = av.l.slice();
    l[resultat === "v" ? 0 : resultat === "d" ? 1 : 2]++;
    return {
      fiche: {
        linit: true,
        l: l,
        // min/max suivent la règle exacte de FruticardSlot.setLeagueScore :
        // tant que $linit est faux, les deux prennent la valeur du jour.
        ls: [apr,
          av.linit ? Math.min(av.ls[1], apr) : apr,
          av.linit ? Math.max(av.ls[2], apr) : apr],
      },
      delta: apr - av.ls[0],
    };
  }

  return {
    DEPART: DEPART, PLANCHER: PLANCHER, PLACEMENT: PLACEMENT,
    K_PLACEMENT: K_PLACEMENT, K_ETABLI: K_ETABLI,
    fiche: fiche, note: note, parties: parties, coefficient: coefficient,
    esperance: esperance, apres: apres,
  };
});
