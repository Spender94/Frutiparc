'use strict';
/*
 * DICTIONNAIRE ANGLAIS DU SERVEUR — LES COURRIELS : le mot de passe oublié
 * (sendResetEmail) et le préavis d'inactivité (envoyerPreavisInactivite),
 * écrits dans la langue du COMPTE. Le français est dans server.js.
 *
 * Gabarits « Html » : leurs paramètres arrivent déjà échappés ; le texte du
 * gabarit peut porter des balises simples (<b>, <br>), pas de style — il
 * reste dans server.js.
 */
module.exports = {
  'mail.reset.sujet': 'Frutiparc — reset your secret code',
  'mail.reset.texte': 'Hi {nom}!\n\n'
    + 'You asked to reset your Frutiparc secret code.\n'
    + 'Click this link (valid for 1 hour) to choose a new one:\n\n{lien}\n\n'
    + 'If you didn\'t ask for this, just ignore this e-mail: '
    + 'your secret code stays the same.\n\n— The Frutiparc team',
  'mail.reset.salutHtml': 'Hi <b>{nom}</b>!',
  'mail.reset.demandeHtml': 'You asked to reset your Frutiparc <b>secret code</b>.',
  'mail.reset.bouton': 'Choose a new secret code',
  'mail.reset.validiteHtml': 'This link is valid for 1 hour. If you didn\'t ask for this, '
    + 'ignore this e-mail — your secret code stays the same.',
  'mail.reset.copieHtml': 'Or copy this link: <br>{lien}',

  'mail.preavis.sujet': 'Frutiparc — your account is about to be deleted',
  'mail.preavis.texte': (p) => `Hi ${p.nom}!\n\n`
    + `You haven't logged in to the park for a long time. Since we don't keep inactive accounts `
    + `for more than ${p.ans} years, yours — and everything in it: scores, inventory, bouille, mail — `
    + `will be deleted in ${p.jours} days.\n\n`
    + `To keep it, just log in once${p.adresse ? ': ' + p.adresse : ''}.\n\n`
    + `If you don't want your account any more, you don't need to do anything.\n\n— The Frutiparc team`,
};
