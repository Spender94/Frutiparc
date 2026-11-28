'use strict';
/*
 * DICTIONNAIRE ANGLAIS DU SERVEUR — LES NOTIFICATIONS POUSSÉES (l'appli
 * mobile, Web Push) : courrier, messages privés, défis, mentions, forum,
 * parties en différé. Chaque notification est rendue appareil par appareil,
 * dans la langue de son joueur — connecté ou non (la langue est rangée avec
 * l'abonnement, push_subscriptions.lang). Le français est dans server.js.
 *
 * Les parties en différé servent aussi l'historique (historique.differe y
 * recolle le titre et le corps). Le français y dit « à Frutibandas » et « au
 * Grapiz » (le genre du jeu, auJeuDiffere) ; l'anglais dit simplement {jeu}.
 */
module.exports = {
  'notif.courrier': '📬 New mail',
  'notif.courrierCorps': '{de} — {sujet}',
  'notif.sansObjet': 'no subject',
  'notif.mp': '💬 {nom} is writing to you',
  'notif.defi': '⚔️ {nom} challenges you!',
  'notif.defiSnake': 'The {jeu} Battle is on — your snake is loose.',
  'notif.defiPartie': 'Your {jeu} game has started — your clock is ticking.',
  'notif.mention': '💬 {nom} mentioned you',
  'notif.mentionForum': '✏️ {nom} mentioned you on the forum',
  'notif.citation': '✏️ {nom} quoted you on the forum',
  'notif.suivi': '💬 {nom} replied in a topic you follow',
  'notif.unSujetDuForum': 'A forum topic',
  'notif.test': 'Notifications are working! You\'ll hear about mail, private messages and events.',

  // ── Les parties en différé ──
  'notif.differe.mode.championnat': 'championship',
  'notif.differe.mode.amical': 'friendly',
  'notif.differe.invitation.titre': '{de} invites you to a game of {jeu}',
  'notif.differe.invitation.corps': 'Turn-based ({mode}): three days per move, you play whenever you drop by.',
  'notif.differe.acceptee.titre': '{de} accepted your game of {jeu}',
  'notif.differe.acceptee.aToi': 'Your turn to open the game!',
  'notif.differe.acceptee.aLui': '{de} opens the game; you\'ll be told when it\'s your turn.',
  'notif.differe.tour.titre': '{de} has played! Your turn in {jeu}',
  'notif.differe.tour.corps': 'You have three days to reply ({mode}).',
  'notif.differe.rappel.titre': 'One day left to play your move in {jeu}',
  'notif.differe.rappel.corps': '{adv} is waiting for your move: after tomorrow, the game is lost.',
  'notif.differe.fin.nul': 'Draw in {jeu} against {adv}',
  'notif.differe.fin.victoire': 'Victory in {jeu} against {adv}!',
  'notif.differe.fin.defaite': 'Defeat in {jeu} against {adv}',
  'notif.differe.fin.abandonAdv': '{adv} resigned the game.',
  'notif.differe.fin.abandonMoi': 'You resigned the game.',
  'notif.differe.fin.corps': 'The turn-based game ({mode}) is over.',
  'notif.differe.delai.gagne': '{adv} didn\'t play: you win in {jeu}',
  'notif.differe.delai.perdu': 'Three days without playing: {jeu} game lost',
  'notif.differe.delai.gagneCorps': 'Win by forfeit ({mode}).',
  'notif.differe.delai.perduCorps': '{adv} wins by forfeit ({mode}).',
  'notif.differe.refus.titre': '{de} declined your game of {jeu}',
  'notif.differe.refus.corps': 'Your turn-based invitation wasn\'t accepted.',
  'notif.differe.expiree.titre': '{adv} didn\'t answer your {jeu} invitation',
  'notif.differe.expiree.corps': 'Three days without an answer: the invitation has been withdrawn.',
};
