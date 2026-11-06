/*
 * Swapou 2 — le Worker de l'analyse en partie.
 *
 * L'analyseur (analyse.js) juge chaque échange possible en regardant la ligne
 * qui monte et la meilleure riposte : entre 0,5 et 1,5 s de calcul pur. Sur le
 * fil principal, ce serait 1,5 s de jeu figé à chaque tour. Il tourne donc
 * ici, à côté, et le jeu continue de s'animer pendant qu'il réfléchit.
 *
 * Protocole : { id, grille, etat, options } → { id, resultat }. L'`id` est le
 * numéro de la demande : une réponse arrivée après un nouveau coup est
 * périmée, et c'est le client qui la jette (AnalyseChallenge, game.js).
 */
'use strict';
// bot.js et analyse.js ne sont servis qu'au joueur qui a l'option (et à
// l'admin) : le serveur le reconnaît au sid que game.js a mis dans l'adresse
// de ce Worker, et qu'on repasse tel quel. engine.js, lui, est public.
importScripts('engine.js', 'bot.js' + self.location.search, 'analyse.js' + self.location.search);

self.onmessage = function (ev) {
  const m = ev.data || {};
  let resultat = null;
  try {
    resultat = self.SwapouAnalyse.analyserGrille(m.grille, m.etat, m.options);
  } catch (e) {
    resultat = { coups: [], meilleur: null, erreur: String(e && e.message || e) };
  }
  // Les grilles intermédiaires ne sortent pas : seuls les coups, légers.
  self.postMessage({ id: m.id, resultat: resultat });
};
