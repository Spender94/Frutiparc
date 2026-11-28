'use strict';
/*
 * DICTIONNAIRE ANGLAIS DU SERVEUR — LES PRUNOSTICS : les refus d'un pari
 * (paris.js, `refus`, et les routes /api/paris*), ce que dit chaque pari
 * (« Kiwi médaillé à Swapou », « la victoire de Kiwi »), les jours et le mois
 * du registre, les noms des tours de tournoi. Le français est dans paris.js,
 * server.js, tournoiDuel.js et tournoiCoupe.js ; ici, l'anglais seul.
 *
 * « Prunostics » reste tel quel (le glossaire) ; « kikooz » aussi.
 */
module.exports = {
  // ── Les refus (paris.js et les routes) ──
  'paris.tournoiFerme': 'Betting isn\'t open on this tournament.',
  'paris.pasEnCeMoment': 'Betting isn\'t open right now.',
  'paris.matchInconnu': 'This match doesn\'t exist.',
  'paris.joueursInconnus': 'Both players of this match aren\'t known yet.',
  'paris.dejaJoue': 'This match has already been played.',
  'paris.commence': 'Betting on this match is closed: it has started.',
  'paris.soi': 'You can\'t bet on your own matches.',
  'paris.horsMatch': 'This player isn\'t in this match.',
  'paris.autreCamp': 'You already bet on the other player of this match.',
  'paris.miseEntiere': 'A bet is a whole number of kikooz.',
  'paris.plafondMatchReste': 'The cap is {plafond} kikooz per match: you can still add {reste}.',
  'paris.plafondMatch': 'The cap is {plafond} kikooz per match.',
  'paris.solde': 'You don\'t have enough kikooz.',
  'paris.indisponibles': 'Betting isn\'t available.',
  'paris.connecteToi': 'Log in to bet.',
  'paris.compteIndisponible': 'Account unavailable, try again.',
  'paris.patience': 'A bet is already being saved.',
  'paris.misesFermees': 'Bets on this match are closed.',
  'paris.matchRegle': 'Bets on this match have been settled.',
  'paris.memeAppareil': 'Your account was used on the same device as one of this match\'s players: you can\'t bet on it.',
  'paris.nonEnregistre': 'The bet couldn\'t be saved.',
  'paris.defiFerme': 'The medal challenge is closed for now.',
  'paris.jeuFermePrunostics': 'This game isn\'t open to Prunostics.',
  'paris.defiSoi': 'The medal challenge is played on yourself. To bet on someone else, use the “medalist” or “gold” pots.',
  'paris.defiPasAssez': '{jeu} hasn\'t been played enough these past 30 days for a medal challenge.',
  'paris.defiPlafond': 'The medal challenge is capped at {plafond} kikooz per day: you can still bet {reste} on it.',
  'paris.plafondJour': 'The cap is {plafond} kikooz per day: you can still bet {reste}.',
  'paris.dejaRegle': 'This bet has already been settled.',
  'paris.depassePlafond': 'Your bet goes over today\'s cap or your balance.',
  'paris.challengeFerme': 'Challenge betting isn\'t open.',
  'paris.jeuFermeDemain': 'This game isn\'t open to betting tomorrow.',
  'paris.joueurInconnu': 'This player doesn\'t exist.',
  'paris.coteFixe': 'You already have a fixed-odds bet on this player: it stays as it is. Bet on someone else, or on the other pot.',
  'paris.pariInconnu': 'Unknown bet.',

  // ── Ce que dit chaque pari (le registre, la page du Challenge) ──
  'paris.quoi.or': '{nom} gold at {jeu}',
  'paris.quoi.podium': '{nom} medalist at {jeu}',
  'paris.quoi.defiOr': '{nom}\'s challenge: gold at {jeu}',
  'paris.quoi.defiArgent': '{nom}\'s challenge: silver or gold at {jeu}',
  'paris.quoi.defiBronze': '{nom}\'s challenge: a medal at {jeu}',
  'paris.quoi.victoire': '{nom}\'s win',
  // L'affiche d'un match (« Kiwi contre Bob »).
  'paris.affiche': '{j1} vs {j2}',
  // La virgule des cotes (« ×2,5 » → « ×2.5 »).
  'paris.virgule': '.',
};
