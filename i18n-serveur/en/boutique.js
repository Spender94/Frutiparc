'use strict';
/*
 * DICTIONNAIRE ANGLAIS DU SERVEUR — LA BOUTIQUE : les refus d'achat et de
 * revente du light, les rayons, et les articles livrés avec le code (nom,
 * description, commentaire), par leur NUMÉRO d'article — `boutique.<id>.nom`,
 * `.description`, `.commentaire`. Le français reste dans server.js
 * (SHOP_PACKS_DEFAULT et ses familles) ; un article saisi dans l'admin porte
 * son anglais en base (`name_en`, `description_en`, `comment_en`), qui passe
 * avant ce dictionnaire. Sans anglais nulle part, l'article reste en français.
 *
 * Le nom français d'un article reste son IDENTIFIANT (inventaire, forum,
 * historique des achats) : on ne traduit que ce qu'on affiche.
 */
module.exports = {
  // ── Les refus du light ──
  'boutique.pasAssez': 'Not enough kikooz.',
  'boutique.dejaPossede': 'You already own this accessory.',
  'boutique.indisponible': 'Item unavailable.',
  'boutique.nonRevendable': 'This item can\'t be sold back.',
  'boutique.fermee': 'Shop unavailable.',
  'boutique.reventeImpossible': 'Sale impossible.',
};
