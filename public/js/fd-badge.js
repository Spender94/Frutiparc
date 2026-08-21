/*
 * COMBIEN DE PARTIES CLASSÉES ME RESTE-T-IL ?
 *
 * Quatre jeux rationnent le CLASSEMENT, pas le jeu : passé le quota du jour on
 * continue de jouer, les fruits et les titems rentrent, mais le score n'entre
 * plus au Challenge. Jusqu'ici rien ne le disait tant qu'il restait des parties
 * — le joueur ne l'apprenait qu'à zéro, par une pop-in, souvent après avoir
 * fait un bon score pour rien. « C'est souvent difficile de voir où on en est
 * au niveau des parties restantes. »
 *
 * D'où ce petit bandeau, en haut à droite de la fenêtre de jeu, qui dit l'état
 * en permanence et se met à jour tout seul :
 *
 *     Challenge · 2 parties sur 3
 *     Challenge · plus de partie classée   (en corail)
 *
 *     <script src="/js/fd-badge.js" data-jeu="kaluga"></script>
 *
 * `data-jeu` est le nom de jeu que connaît le serveur (GAME_DISCS.swfName) ;
 * à défaut on prend le paramètre `game` de l'adresse, comme le fait la fenêtre
 * des jeux Flash. Sans session, ou sur un jeu SANS quota, rien ne s'affiche —
 * le bandeau ne parle que quand il a quelque chose à dire.
 *
 * Il ne prend jamais le clic (`pointer-events: none`) : le jeu passe dessous.
 */
(function () {
  'use strict';
  var script = document.currentScript;
  var params;
  try { params = new URLSearchParams(window.location.search); } catch (e) { return; }
  var sid = params.get('sid') || '';
  var jeu = ((script && script.getAttribute('data-jeu')) || params.get('game') || '').toLowerCase();
  if (!sid || !jeu) return;

  var boite = null;
  function poser(texte, epuise) {
    if (!boite) {
      boite = document.createElement('div');
      boite.id = 'fp-fd-badge';
      boite.style.cssText = [
        'position:fixed', 'top:6px', 'right:8px', 'z-index:2147483000',
        'font:bold 11px Verdana,Arial,sans-serif', 'padding:3px 9px',
        'border-radius:10px', 'pointer-events:none', 'opacity:.9',
        'box-shadow:0 1px 3px rgba(0,0,0,.35)', 'white-space:nowrap',
      ].join(';');
      (document.body || document.documentElement).appendChild(boite);
    }
    boite.style.background = epuise ? '#E3756A' : '#CCF599';
    boite.style.color = epuise ? '#ffffff' : '#2C4A0F';
    boite.textContent = texte;
  }

  function relire() {
    fetch('/api/fd/status?sid=' + encodeURIComponent(sid) + '&game=' + encodeURIComponent(jeu),
      { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        // Jeu sans quota : pas de bandeau du tout. Et s'il en avait un affiché
        // (le joueur a changé de jeu dans la même fenêtre), on l'enlève.
        if (!j || !j.ok || !j.limited) {
          if (boite && boite.parentNode) boite.parentNode.removeChild(boite);
          boite = null;
          return;
        }
        var reste = Number(j.remaining) || 0;
        if (reste <= 0) { poser('Challenge · plus de partie classée', true); return; }
        poser('Challenge · ' + reste + ' partie' + (reste > 1 ? 's' : '')
          + ' sur ' + j.allowance, false);
      })
      .catch(function () { /* le serveur répondra au prochain tour */ });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', relire);
  } else {
    relire();
  }
  // Cinq secondes : le quota ne bouge qu'en fin de partie, mais le joueur doit
  // voir le compte tomber sans avoir à recharger.
  setInterval(relire, 5000);
})();
