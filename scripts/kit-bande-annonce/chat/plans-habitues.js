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
    scene: 'habitues', titre: 'Les habitués — plan maître', affiche: 17.4,
    description: 'Le salon Orange avec des habitués bien connus du parc (kasparov, Lama1, Sandek, AnanaX, pattedecat), vu sur le bureau Frutiz de kasparov : la colonne des bouilles est en « aquarium », chaque bouille entre quand son frutiz parle, joue son émote (rire, sifflote, miam, bisou, clin d’œil, chewing-gum, jutsu) et repart. Arrivée de pattedecat, son record de Swapou, le défi du jour annoncé par kasparov (qui tape sa ligne), humeurs qui changent.',
    usage: 'Plan long pour couper : « les vrais habitués du parc ». N’importe quelle tranche de 2 à 6 s montre des bouilles qui entrent et réagissent.',
  }),
  'habitues-gros-plan': comme('aquarium-gros-plan', {
    scene: 'habitues', titre: 'Les habitués — gros plan', affiche: 17.4,
    description: 'La même scène, caméra serrée sur la fenêtre du salon : l’aquarium et le fil remplissent l’image, rendus nets (rien d’agrandi après coup).',
    usage: 'Inserts rapides ; se prête aux zooms et recadrages au montage.',
  }),
  'habitues-bouilles': comme('aquarium-bouilles', {
    scene: 'habitues', titre: 'Les habitués — bouilles détourées', affiche: 17.4,
    description: 'Seules les bouilles de l’aquarium, sur fond transparent (WebM VP9 alpha) et sur fond vert #00FF00 (MP4), au minutage du plan maître : elles entrent par le bord gauche, jouent leur émote et repartent.',
    usage: 'À incruster contre le bord gauche de l’image : les bouilles des habitués « entrent » dans la bande-annonce.',
  }),
  'habitues-multi': comme('multi', {
    scene: 'habitues-multi', titre: 'Les habitués — un écran chacun', affiche: 8.5,
    description: 'Un petit salon (Kiwi) à quatre : Lama1, Sandek et pattedecat avec kasparov. Chacun a SON écran dans la colonne des bouilles (mode MULTI) : humeurs qui changent, émotes jouées dans l’écran de qui les lance.',
    usage: 'Contrepoint calme à l’aquarium : quatre têtes connues qui réagissent.',
  }),
};
