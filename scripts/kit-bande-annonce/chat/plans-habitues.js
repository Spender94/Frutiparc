/*
 * Kit bande-annonce — LE SALON DES HABITUÉS : les plans (scène + caméra).
 *
 * Mêmes caméras que les plans du kit « chat » (plans.js : on leur emprunte
 * cadrages et échelles), mais sur les scènes de scenes-habitues.json, jouées par
 * de vrais joueurs du parc (casting-habitues.json). Voir habitues.sh.
 */
'use strict';

const BASE = require('./plans');

// Un plan d'ici = la caméra d'un plan du kit + une autre scène, un autre texte.
function comme(modele, propre) {
  const p = Object.assign({}, BASE[modele], propre);
  delete p.gestes; delete p.arrivee; delete p.curseur;
  return p;
}

module.exports = {
  'habitues-maitre': comme('aquarium-maitre', {
    scene: 'habitues', titre: 'Les habitués — plan maître', affiche: 9.6,
    description: 'Le salon Orange avec des habitués bien connus du parc (kasparov, Sandek, Braxer, Lama1, AnanaX, pattedecat, SNess, linkinpunk, Kobbs, titouthekiller), vu sur le bureau Frutiz de kasparov : la colonne des bouilles est en « aquarium », chaque bouille entre quand son frutiz parle, joue son émote (éclate de rire, bulle de chewing-gum, sifflote, tire la langue, miam, bisou, clin d’œil, jutsu) et repart. Arrivée de pattedecat, son record de Swapou salué par Braxer, le défi du jour annoncé par kasparov (qui tape sa ligne), humeurs qui changent.',
    usage: 'Plan long pour couper : « les vrais habitués du parc ». N’importe quelle tranche de 2 à 6 s montre des bouilles qui entrent et réagissent.',
  }),
  'habitues-gros-plan': comme('aquarium-gros-plan', {
    scene: 'habitues', titre: 'Les habitués — gros plan', affiche: 9.6,
    description: 'La même scène, caméra serrée sur la fenêtre du salon : l’aquarium et le fil remplissent l’image, rendus nets (rien d’agrandi après coup).',
    usage: 'Inserts rapides ; se prête aux zooms et recadrages au montage.',
  }),
  'habitues-bouilles': comme('aquarium-bouilles', {
    scene: 'habitues', titre: 'Les habitués — bouilles détourées', affiche: 9.6,
    description: 'Seules les bouilles de l’aquarium, sur fond transparent (WebM VP9 alpha) et sur fond vert #00FF00 (MP4), au minutage du plan maître : elles entrent par le bord gauche, jouent leur émote et repartent.',
    usage: 'À incruster contre le bord gauche de l’image : les bouilles des habitués « entrent » dans la bande-annonce.',
  }),
  'habitues-salon2': comme('multi', {
    scene: 'habitues-salon2', titre: 'Les habitués — deuxième salon (aquarium)', affiche: 8.6,
    description: 'Le salon Kiwi plein (10 frutiz) : revanche au Grapiz entre Braxer et SNess, commentée par pattedecat, AnanaX, Kobbs, linkinpunk, titouthekiller, Sandek, Lama1 et kasparov (qui tape sa ligne). Fenêtre plus grande que le plan maître : l’aquarium y est haut, les bouilles y entrent par la gauche et jouent leurs émotes (éclate de rire, sifflote, langue, bisou, bulle de chewing-gum, clin d’œil, jutsu).',
    usage: 'Deuxième plan d’aquarium, cadré plus large : à alterner avec le plan maître.',
  }),
};
