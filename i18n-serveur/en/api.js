'use strict';
/*
 * DICTIONNAIRE ANGLAIS DU SERVEUR — LES MESSAGES DE L'API : ce que les routes
 * des joueurs écrivent en toutes lettres dans `message` (ou `error`, quand la
 * route n'a pas de code) — inscription, connexion, code secret oublié, forum,
 * courrier, compte. Le français est écrit dans server.js, là où la réponse
 * part (`tReq(req, 'api.…', 'le français')`) ; la langue est celle de la
 * requête (`langueDeRequete` : le compte si elle porte un sid, sinon le `lang`
 * de la page, sinon le navigateur). Les CODES d'erreur ne se traduisent pas :
 * les clients s'y fient.
 *
 * L'administration reste en français : ses routes ne passent pas par ici.
 *
 * Le glossaire : code secret → secret code ; pseudo → username ; totoché →
 * totoched (le mot maison du chat).
 */
module.exports = {
  'api.erreurServeur': 'Server error.',
  'api.sanctionFin': '{jour} at {heure}',

  // ── Inscription, connexion, code secret oublié ──
  'api.auth.tropDeTentatives': 'Too many attempts, please try again later.',
  'api.auth.tropDeTentativesTu': 'Too many attempts, try again later.',
  'api.auth.tropDeDemandes': 'Too many requests, try again later.',
  'api.auth.pseudoInvalide': 'Username: 3-20 characters [a-zA-Z0-9_], no accents.',
  'api.auth.codeSecretLongueur': 'Secret code: 6 to 80 characters.',
  'api.auth.emailInvalide': 'Invalid e-mail.',
  'api.auth.adresseInvalide': 'Invalid e-mail address.',
  'api.auth.pseudoPris': 'Username already taken.',
  'api.auth.pseudoSupprime': 'This username was deleted and can\'t be used again.',
  'api.auth.identifiantsIncorrects': 'Wrong username or secret code.',
  'api.auth.oubliEnvoye': 'If an account uses this address, a reset e-mail is on its way.',
  'api.auth.lienInvalide': 'Invalid link.',
  'api.auth.reinitIndisponible': 'Reset unavailable.',
  'api.auth.lienExpire': 'This link is invalid or has expired. Ask for a new one.',
  'api.auth.codeChange': 'Your secret code has been changed. You can log in now.',

  // ── Le compte (export, suppression) ──
  'api.compte.exportCadence': 'One export per minute: time to read the last one.',
  'api.compte.exportNote': 'All the data the server keeps about this account, table by table. '
    + 'The password isn\'t in it (it\'s hashed: nobody can read it).',
  'api.compte.codeIncorrect': 'Wrong secret code.',

  // ── Le forum ──
  'api.forum.rechercheVide': 'Type at least one word of two letters, or an author.',
  'api.forum.totochePoster': 'You\'re totoched until {quand}: you can\'t post on the forum while it lasts.',
  'api.forum.totocheImage': 'You\'re totoched until {quand}: you can\'t send images.',
  'api.forum.imageVide': 'Empty or unreadable image.',
  'api.forum.imageFormat': 'Unsupported format. Accepted: PNG, JPEG, GIF, WEBP.',
  'api.forum.imageEchec': 'The image couldn\'t be saved.',
  'api.forum.doublePost': 'You can\'t post twice in a row in the same topic. Edit your previous message, or wait for another Frutiz to reply.',
  'api.forum.sujetPlein': 'This topic has reached the 500-message limit and is now locked.',
  'api.forum.sondageClos': 'This poll is closed: you can\'t vote anymore.',
  'api.forum.sondageReponse': 'Invalid poll answer.',

  // ── Le courrier ──
  'api.mail.disparu': 'This mail doesn\'t exist anymore.',
  'api.mail.sansDestinataire': 'Enter at least one recipient.',
  'api.mail.vide': 'The message is empty.',
  'api.mail.illisible': 'Unreadable recipient.',
  'api.mail.inconnu': '“{nom}” doesn\'t exist — check the spelling of the username.',
  'api.mail.inconnus': 'None of these recipients exist.',
  'api.mail.echec': 'Sending failed, try again.',

  // ── Le blindtest ──
  'api.blindtest.salonSeulement': 'The blindtest clip can only be heard in the chat room.',
  'api.blindtest.termine': 'Clip over.',
};
