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
 *     Challenge · 3 parties sur 3 · Frutisigne +1   (le cadeau du jour)
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
 *
 * Ses textes passent par T() (/js/i18n.js ; l'anglais dans
 * /i18n/en/widgets.js). Les pages des jeux ne chargent pas encore i18n.js :
 * sans lui, le français.
 */
(function () {
  'use strict';
  function remplir(s, p) {
    return String(s).replace(/\{(\w+)\}/g, function (m, k) { return p && p[k] != null ? String(p[k]) : m; });
  }
  function T(cle, fr, p) {
    var I = window.FPI18n;
    return I && I.T ? I.T(cle, fr, p) : remplir(fr, p);
  }
  T.n = function (cle, n, formes, p) {
    var I = window.FPI18n;
    if (I && I.T && I.T.n) return I.T.n(cle, n, formes, p);
    var q = { n: n };
    for (var k in (p || {})) if (Object.prototype.hasOwnProperty.call(p, k)) q[k] = p[k];
    return remplir(Math.abs(n) < 2 ? formes.one : formes.other, q);
  };
  var script = document.currentScript;
  var params;
  try { params = new URLSearchParams(window.location.search); } catch (e) { return; }
  var sid = (window.FPSid && FPSid.sid) || params.get('sid') || '';
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
        if (reste <= 0) { poser(T('widgets.fdPlusDePartie', 'Challenge · plus de partie classée'), true); return; }
        // Le cadeau du Frutisigne (semaine du signe, jour de l'ascendant) est
        // déjà dans le total : on dit seulement d'où vient la partie de plus.
        poser(T.n('widgets.fdParties', reste, { one: 'Challenge · {n} partie sur {total}', other: 'Challenge · {n} parties sur {total}' }, { total: j.allowance })
          + (Number(j.frutisigne) > 0 ? ' · ' + T('widgets.fdFrutisigne', 'Frutisigne +1') : ''), false);
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
