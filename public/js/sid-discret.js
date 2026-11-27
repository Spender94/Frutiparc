/*
 * LE SID NE RESTE PAS DANS LA BARRE D'ADRESSE DES FENÊTRES DU LIGHT.
 *
 * Le Light ouvre le forum, l'historique d'un salon et les jeux portés avec
 * `?sid=…` dans leur adresse. Dans une fenêtre à part, cette adresse s'affiche
 * (les navigateurs montrent la barre des pop-up) : une capture d'écran
 * partagée suffisait à prendre la session — le compte — de celui qui jouait.
 *
 * Ce script est le PREMIER de la page. Il lit le sid de l'adresse, le range
 * pour l'onglet (`sessionStorage`, une clé par page) et l'efface de l'adresse
 * sans recharger ; la page le lit ensuite dans `FPSid.sid`. Au rechargement
 * (F5), l'adresse n'a plus de sid : on reprend celui de l'onglet.
 *
 * L'adresse n'est effacée que si le sid a bien été rangé : sans stockage, elle
 * reste le seul moyen de survivre à un F5, et l'on ne change rien.
 *
 * Pas pour les jeux Flash (game-popup.html, /legacy) : leurs SWF envoient
 * leurs scores sans sid, et le serveur les reconnaît à l'adresse de la fenêtre
 * (Referer, cf. sidDuReferer dans server.js).
 */
(function () {
  'use strict';
  var cle = 'fp_sid_page:' + location.pathname;
  var sid = '';
  try {
    var p = new URLSearchParams(location.search);
    // LE MODE INVITÉ (?invite=1, lancé depuis l'accueil) n'a JAMAIS de sid : ni
    // celui de l'adresse, ni celui que l'onglet aurait gardé d'une partie
    // connectée (voir /js/invite.js).
    if (p.get('invite') === '1') { window.FPSid = { sid: '', invite: true }; return; }
    sid = p.get('sid') || '';
    if (sid) {
      var garde = '';
      try { sessionStorage.setItem(cle, sid); garde = sessionStorage.getItem(cle) || ''; } catch (e) { /* pas de stockage */ }
      if (garde === sid) {
        p.delete('sid');
        var q = p.toString();
        history.replaceState(history.state, '', location.pathname + (q ? '?' + q : '') + location.hash);
      }
    } else {
      try { sid = sessionStorage.getItem(cle) || ''; } catch (e) { /* pas de stockage */ }
    }
  } catch (e) { /* adresse laissée telle quelle */ }
  window.FPSid = { sid: sid };
})();
