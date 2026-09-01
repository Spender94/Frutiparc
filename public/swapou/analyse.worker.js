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
importScripts('engine.js', 'bot.js', 'analyse.js');

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
