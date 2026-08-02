/*
 * Miniwave 2 — le menu, les écrans de choix et la boutique.
 *
 * Le jeu d'origine les compose en MovieClips (miniwave.Menu et miniwave.page.*).
 * Ici ce sont des panneaux HTML posés sur le canvas : sur un téléphone, un menu
 * dessiné dans une aire de 240 × 240 serait illisible et intouchable.
 *
 * Ce que le module reprend fidèlement, en revanche, c'est l'ENCHAÎNEMENT du jeu,
 * qui est sa vraie structure :
 *
 *   Accueil ─┬─ ARCADE ──────────────────┐
 *            ├─ BONUS   → choix mission ─┤→ choix de l'escadron → partie
 *            ├─ SPÉCIAL → Letter/Endur. ─┘   (SelectShip : autant de vaisseaux
 *            └─ STAND   → boutique            que gameInfo.shipMax)
 *
 * Les modes spéciaux se passent de l'écran d'escadron : Letter Invader n'a pas
 * de vaisseau, Endurance n'en donne qu'un.
 *
 * Le module ne connaît ni le moteur ni le réseau : on lui passe la fiche du
 * joueur et un callback de lancement. C'est ce qui le rend testable.
 */
'use strict';

(function () {

const P = (typeof module !== 'undefined' && module.exports)
  ? require('./plateforme.js')
  : window.MiniwavePlateforme;

// L'ordre du menu d'accueil, repris de page/Main.as. « Options » n'a pas de
// contenu à porter (le réglage du son est le bouton de la page) et « Time »
// n'existe pas dans le jeu livré : ni l'un ni l'autre n'apparaît.
const RUBRIQUES = [
  { id: 'arcade', nom: 'ARCADE', desc: 'Le grand parcours : 200 vagues et le boss.' },
  { id: 'bonus', nom: 'BONUS', desc: 'Les missions, courtes et primées.' },
  { id: 'special', nom: 'SPÉCIAL', desc: 'Letter Invader et Endurance.' },
  { id: 'stand', nom: 'STAND', desc: 'Vaisseaux, missions et pictos à acheter.' },
];

// SelectSpecial.select : deux modes portés sur les trois du jeu. Le troisième
// (« Time ») n'a pas de classe dans les sources — il n'a jamais été écrit.
const SPECIAUX = [
  { id: 'letter', nom: 'Letter Invader', mode: 2, index: 0,
    desc: 'On ne tire plus : on tape la lettre portée par chaque monstre.' },
  { id: 'survival', nom: 'Endurance', mode: 2, index: 1,
    desc: 'Les vagues tombent sans fin. Un seul vaisseau.' },
];

// Ce que le menu propose, d'après la fiche : chaque entrée sait si elle est
// ouverte, et pourquoi elle ne l'est pas.
function entrees(carte, niveaux) {
  const ouverts = P.modesOuverts(carte);
  return {
    arcade: [{
      id: 'arcade', nom: 'Arcade', ouvert: true,
      detail: (carte.$arcade.$bestLevel > 0)
        ? ('meilleur : niveau ' + carte.$arcade.$bestLevel + ' · ' + carte.$arcade.$bestScore + ' pts')
        : 'jamais joué',
      lancement: {
        mode: 'arcade', niveaux: niveaux.main[0].levels,
        vies: niveaux.main[0].ship, nom: 'Arcade',
      },
    }],
    // Une mission n'est proposée que si elle a été achetée ET qu'elle existe :
    // $mode[1] compte huit cases, le jeu n'en a rempli que cinq.
    bonus: niveaux.bonus.map((p, i) => ({
      id: 'mission' + i, nom: p.name, ouvert: !!ouverts.missions[i],
      detail: (carte.$cons.$bonus[i] > 0)
        ? (carte.$cons.$bonus[i] + ' % · prime ' + p.prime + ' ¤')
        : ('prime ' + p.prime + ' ¤'),
      pourAcheter: 'À acheter au stand.',
      lancement: {
        mode: 'mission', niveaux: p.levels, vies: p.ship,
        missionNum: i, prime: p.prime, nom: p.name,
      },
    })),
    special: SPECIAUX.map((s) => ({
      id: s.id, nom: s.nom, ouvert: !!ouverts[s.id], detail: s.desc,
      pourAcheter: 'À acheter au stand.',
      lancement: (s.id === 'letter')
        ? { mode: 'letter', niveaux: niveaux.letter[0].levels, vies: 1, nom: s.nom }
        : { mode: 'survival', niveaux: [], vies: 1, nom: s.nom },
    })),
  };
}

// SelectShip : on compose un escadron de `shipMax` vaisseaux, choisis un par un
// parmi ceux qu'on possède. C'est ce qui fait que l'ordre compte — on perd les
// vaisseaux dans l'ordre où on les a rangés.
function vaisseauxDisponibles(carte) {
  const l = [];
  for (let i = 0; i < P.NB_VAISSEAUX; i++) if (carte.$ship[i]) l.push(i);
  return l;
}

// Le rayon de la boutique, tel qu'il s'affiche : prix, état, et ce que l'achat
// ouvre — dit en français, pas en indices de tableau.
function rayon(carte) {
  return P.BOUTIQUE.map((a) => {
    const d = a.debloque;
    let ouvre = '';
    if (d.ship !== undefined) ouvre = 'vaisseau ' + P.VAISSEAUX[d.ship];
    else if (d.mission !== undefined) ouvre = 'mission ' + (d.mission + 1);
    else if (d.special !== undefined) ouvre = (d.special === 0 ? 'Letter Invader' : 'Endurance');
    else if (d.picto) ouvre = 'picto Frutiparc';
    return {
      id: a.id, nom: a.nom, prix: a.prix, ouvre,
      achete: P.estAchete(carte, a.id),
      abordable: carte.$credit >= a.prix,
    };
  });
}

const API = { RUBRIQUES, SPECIAUX, entrees, vaisseauxDisponibles, rayon };

if (typeof module !== 'undefined' && module.exports) module.exports = API;
else window.MiniwaveMenu = API;

})();
