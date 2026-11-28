'use strict';
/*
 * DICTIONNAIRE ANGLAIS DU SERVEUR — LA FICHE ET LE PROFIL : les pays de la
 * table d'époque (public/xml/lang_french.xml, bloc <ct>, par leur index :
 * `profil.pays.<index>`) et le nom de leur découpage (`profil.decoupage.<nom>`,
 * l'attribut `tn` quand il est un mot français). Les régions gardent leur nom :
 * ce sont des noms de lieux, déjà dans la langue de leur pays. Le bureau Flash
 * lit toujours la table française.
 */
module.exports = {
  'profil.pays.1': 'France',
  'profil.pays.2': 'Belgium',
  'profil.pays.3': 'Luxembourg',
  'profil.pays.4': 'Canada',
  'profil.pays.5': 'Switzerland',
  'profil.pays.6': 'Morocco',
  'profil.pays.7': 'Netherlands',
  'profil.pays.8': 'United Kingdom',
  'profil.decoupage.département': 'department',
  'profil.decoupage.région': 'region',
  'profil.decoupage.province': 'province',
  'profil.decoupage.nation': 'nation',
};
