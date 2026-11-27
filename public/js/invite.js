/*
 * FPInvite — LE MODE INVITÉ DES JEUX.
 *
 * Depuis l'accueil, un visiteur sans compte peut lancer un jeu : la page du jeu
 * s'ouvre avec `?invite=1` (dans un cadre de l'accueil, ou seule). Le jeu tourne
 * alors en VERSION COMPLÈTE — tous les persos, voitures, modes ouverts —, sans
 * rien lire ni écrire sur le serveur, et à la fin d'une partie ce module pose
 * le panneau « Tu veux enregistrer tes scores ? Inscris-toi ! ».
 *
 * Chargé juste après /js/sid-discret.js (quand la page l'a), il ne fait RIEN
 * hors mode invité : `FPInvite.actif` est faux et `finDePartie` ne montre rien.
 *
 * LA RÈGLE D'OR : UN INVITÉ N'A PAS DE SID. Jamais. Ni celui de l'adresse, ni
 * celui que sid-discret.js range pour l'onglet, ni la session du light restée
 * dans le navigateur (`fp_light_session`). Plusieurs routes du serveur
 * retombent, faute de sid, sur « la dernière session vue de cette adresse IP »
 * (/api/loadFrutiSlots…) : un invité qui les appellerait pourrait voir la
 * partie sauvegardée d'un membre derrière la même box. Les jeux testent donc
 * `FPInvite.actif` AVANT toute lecture de sid, et le module vide FPSid.sid.
 *
 * Les scores d'un invité ne sont PAS transférés à l'inscription : ils ont été
 * faits avec tout débloqué et sans les contrôles anti-triche du serveur. Le
 * panneau parle donc des « prochains » scores.
 *
 * API :
 *   FPInvite.actif                 vrai en mode invité
 *   FPInvite.finDePartie(opts)     le panneau ; opts = { score, libelle,
 *                                  surRejouer } — tout est facultatif
 *   FPInvite.inscrire()            vers le formulaire d'inscription de l'accueil
 */
(function (global) {
  'use strict';
  var actif = false;
  try { actif = new URLSearchParams(global.location.search).get('invite') === '1'; } catch (e) { /* vieux navigateur */ }
  if (actif && global.FPSid) global.FPSid.sid = '';

  /*
   * LA LANGUE DU PANNEAU. Les pages des jeux ne chargent pas toutes le
   * dictionnaire commun : le panneau porte donc son anglais lui-même. La langue
   * vient de FPI18n quand la page l'a, sinon des mêmes sources que lui
   * (fp_lang, puis le navigateur).
   */
  var langue = 'fr';
  try {
    if (global.FPI18n) langue = global.FPI18n.langue;
    else {
      var l = String(global.localStorage.getItem('fp_lang') || '');
      if (!l) l = String((global.navigator.languages && global.navigator.languages[0]) || global.navigator.language || 'fr').toLowerCase().indexOf('fr') === 0 ? 'fr' : 'en';
      langue = l === 'en' ? 'en' : 'fr';
    }
  } catch (e) { langue = 'fr'; }
  var EN = {
    titre: 'Game over!', score: 'Your score', appel: 'Want to save your scores?', appel2: 'Sign up!',
    texte: "It's free: your next games will count in the rankings, with your bouille, your records and your medals.",
    oui: 'Sign up', non: 'Play again',
  };
  function tr(cle, fr) { return langue === 'en' && EN[cle] ? EN[cle] : fr; }

  var dansCadre = false;
  try { dansCadre = global.parent && global.parent !== global; } catch (e) { dansCadre = true; }

  // L'accueil (login-bis.html) écoute ce message : il ferme le jeu et ouvre son
  // formulaire d'inscription. Seul, hors cadre, on y va directement.
  function inscrire() {
    if (dansCadre) {
      try { global.parent.postMessage({ type: 'fp-invite', action: 'inscription' }, global.location.origin); return; } catch (e) { /* cadre étranger */ }
    }
    global.location.href = '/?inscription=1';
  }

  var STYLE = ''
    + '#fp-invite{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;'
    + 'background:rgba(30,52,8,.55);font:14px/1.4 Verdana,Geneva,sans-serif;-webkit-tap-highlight-color:transparent}'
    + '#fp-invite .fpi-carte{box-sizing:border-box;width:min(360px,calc(100vw - 32px));background:#E8F8D3;color:#2C4A0F;'
    + 'border:3px solid #94DB39;border-radius:16px;padding:18px 18px 16px;text-align:center;box-shadow:0 8px 28px rgba(0,0,0,.35)}'
    + '#fp-invite .fpi-titre{margin:0 0 6px;font-size:17px;font-weight:bold;color:#335511}'
    + '#fp-invite .fpi-score{margin:0 0 10px;font-size:13px;color:#4f7d1e}'
    + '#fp-invite .fpi-score b{font-size:18px;color:#2C4A0F}'
    + '#fp-invite .fpi-appel{margin:0 0 4px;font-size:16px;font-weight:bold;color:#d82222}'
    + '#fp-invite .fpi-insec{white-space:nowrap}'
    + '#fp-invite .fpi-texte{margin:0 0 14px;font-size:12px;color:#4f6a2c}'
    + '#fp-invite .fpi-boutons{display:flex;gap:8px;justify-content:center;flex-wrap:wrap}'
    + '#fp-invite button{font:bold 14px Verdana,Geneva,sans-serif;border-radius:14px;padding:9px 16px;cursor:pointer;min-height:40px}'
    + '#fp-invite .fpi-oui{background:#73B01E;color:#fff;border:2px solid #4f7d1e}'
    + '#fp-invite .fpi-non{background:#fff;color:#335511;border:2px solid #ADE76B}'
    + '#fp-invite button:focus-visible{outline:3px solid #335511;outline-offset:2px}';

  var ouvert = null;

  // Tant que le panneau est là, le jeu dessous ne reçoit ni touche ni clic :
  // une Entrée qui relancerait une partie, une flèche qui bougerait le perso…
  function bloquer(e) {
    if (!ouvert) return;
    // Échap ferme le panneau — et ne va pas plus loin : le jeu dessous s'en
    // servirait pour sa pause ou son menu.
    if (e.type === 'keydown' && e.key === 'Escape') {
      e.stopPropagation();
      if (e.cancelable) e.preventDefault();
      fermer();
      return;
    }
    if (ouvert.contains(e.target)) return;
    e.stopPropagation();
    if (e.cancelable) e.preventDefault();
  }
  ['keydown', 'keyup', 'keypress'].forEach(function (t) { global.addEventListener(t, bloquer, true); });

  function fermer() {
    if (!ouvert) return;
    var o = ouvert, cb = o._surRejouer;
    ouvert = null;
    if (o.parentNode) o.parentNode.removeChild(o);
    if (typeof cb === 'function') { try { cb(); } catch (e) { /* le jeu reprend la main */ } }
  }

  function finDePartie(opts) {
    if (!actif || ouvert) return false;
    opts = opts || {};
    if (!document.getElementById('fp-invite-style')) {
      var st = document.createElement('style');
      st.id = 'fp-invite-style';
      st.textContent = STYLE;
      (document.head || document.documentElement).appendChild(st);
    }
    var o = document.createElement('div');
    o.id = 'fp-invite';
    o.setAttribute('role', 'dialog');
    o.setAttribute('aria-modal', 'true');
    o.setAttribute('aria-labelledby', 'fpi-appel');
    var score = (opts.score === 0 || opts.score) ? String(opts.score) : '';
    // Le libellé du score vient du jeu (« Ton temps »…) : en anglais, on garde
    // « Your score » tant que le jeu n'est pas traduit.
    var libelle = langue === 'en' ? (opts.libelleEn || tr('score', 'Ton score')) : (opts.libelle || 'Ton score');
    o.innerHTML = '<div class="fpi-carte">'
      + '<p class="fpi-titre">' + echapper(langue === 'en' ? (opts.titreEn || tr('titre', '')) : (opts.titre || 'Partie terminée !')) + '</p>'
      + (score ? '<p class="fpi-score">' + echapper(libelle) + (langue === 'en' ? ': ' : ' : ') + '<b>' + echapper(score) + '</b></p>' : '')
      + '<p class="fpi-appel" id="fpi-appel">' + echapper(tr('appel', 'Tu veux enregistrer tes scores ?'))
      + ' <span class="fpi-insec">' + echapper(tr('appel2', 'Inscris-toi !')) + '</span></p>'
      + '<p class="fpi-texte">' + echapper(tr('texte', 'C’est gratuit : tes prochaines parties entreront au classement, avec ta bouille, tes records et tes médailles.')) + '</p>'
      + '<div class="fpi-boutons"><button type="button" class="fpi-oui">' + echapper(tr('oui', 'M’inscrire')) + '</button>'
      + '<button type="button" class="fpi-non">' + echapper(tr('non', 'Rejouer')) + '</button></div></div>';
    o._surRejouer = opts.surRejouer;
    o.querySelector('.fpi-oui').addEventListener('click', function () { inscrire(); });
    o.querySelector('.fpi-non').addEventListener('click', fermer);
    // Rien de ce qui se passe SUR le panneau ne remonte au jeu. Un clic hors de
    // la carte ne fait rien (le panneau se ferme par ses boutons) ; et un jeu qui
    // annule les touchers au niveau de la fenêtre (preventDefault sur touchend)
    // rendait les boutons sourds au doigt. Les touches aussi s'arrêtent ici :
    // Espace ou Entrée sur « Rejouer » ne doivent pas relancer le jeu deux fois.
    ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchmove', 'touchend', 'click',
      'keydown', 'keyup', 'keypress'].forEach(function (t) {
      o.addEventListener(t, function (e) { e.stopPropagation(); }, false);
    });
    (document.body || document.documentElement).appendChild(o);
    ouvert = o;
    setTimeout(function () { try { o.querySelector('.fpi-oui').focus(); } catch (e) { /* rien */ } }, 0);
    return true;
  }

  function echapper(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  global.FPInvite = { actif: actif, finDePartie: finDePartie, inscrire: inscrire, fermer: fermer };
})(window);
