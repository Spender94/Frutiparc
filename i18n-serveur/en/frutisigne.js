'use strict';
/*
 * DICTIONNAIRE ANGLAIS DU SERVEUR — LES NOMS DES DIX FRUTISIGNES, par leur nom
 * français (FRUTI_SIGN_NAMES, server.js) : `nomDeFrutisigne(i)` en fait un
 * texte traduisible, à passer en paramètre d'une phrase (M'dam Irma, demain
 * l'historique « ton FrutiSigne est… »). Le chiffre en base ne change pas.
 */
module.exports = {
  'frutisigne.pomme': 'apple',
  'frutisigne.abricot': 'apricot',
  'frutisigne.poire': 'pear',
  'frutisigne.fraise': 'strawberry',
  'frutisigne.citron': 'lemon',
  'frutisigne.kiwi': 'kiwi',
  'frutisigne.raisin': 'grape',
  'frutisigne.orange': 'orange',
  'frutisigne.cerise': 'cherry',
  'frutisigne.banane': 'banana',

  // ── Le mot du jour (frutisignes.js, phraseDuBonus) ──
  'frutisigne.bonus.semaine': 'It\'s your week!',
  'frutisigne.bonus.ascendant': 'It\'s your ascendant\'s day!',
  'frutisigne.bonus.semaineEtAscendant': 'It\'s your week, and your ascendant\'s day!',
  // {jeux} : « Kaluga », « Kaluga and Frutisnake », « Kaluga, Swapou and Frutisnake ».
  'frutisigne.bonus.phrase': '{debut} The Frutisign gives you an extra game of {jeux} today.',
  'frutisigne.bonus.et': ' and ',
};
