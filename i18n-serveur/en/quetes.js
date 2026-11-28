'use strict';
/*
 * DICTIONNAIRE ANGLAIS DU SERVEUR — LES QUÊTES DE GROMELIN : les titres et les
 * lignes de détail des quêtes, les unités (« 12 points », « 4 min 20 s »), les
 * nombres en toutes lettres, les niveaux et les paliers, les refus de
 * l'échange et du contrat. Le français est dans quetes.js (et les refus dans
 * server.js) ; ici, l'anglais seul.
 *
 * Les répliques de Gromelin (`PAROLES`) ne sont pas ici : elles ont leur zone.
 *
 * Le glossaire : « quête de Gromelin » → Gromelin's quest ; « bricole » →
 * odd job ; « Challenge » reste ; les noms des jeux, des circuits et des
 * épreuves propres aux jeux restent tels quels.
 */
module.exports = {
  // ── Les refus de l'échange et du contrat ──
  'quetes.dejaEchange': 'You\'ve already swapped a quest this week.',
  'quetes.bricoleNonEchangeable': 'One of Gromelin\'s odd jobs can\'t be swapped.',
  'quetes.doigtNonEchangeable': 'The finger challenge can\'t be swapped.',
  'quetes.dejaFaite': 'This quest is already done.',
  'quetes.rienAProposer': 'Gromelin has nothing else to offer you this week.',
  'quetes.dejaSigne': 'You\'ve already signed your contract this week.',
};
