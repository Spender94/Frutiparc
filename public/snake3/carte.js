/*
 * Frutisnake — la CARTE du tournoi (mode « Entraînement »).
 *
 * Une partie ordinaire tire ses options au fil de l'eau : à chaque image,
 * Game.main lance un dé dont la taille dépend du score, du nombre d'options
 * posées et du temps écoulé depuis la dernière (partie.js). Deux joueurs ne
 * voient donc jamais la même partie — c'est le sel du Challenge, et le
 * problème d'un TOURNOI : on veut y comparer des pilotes, pas des tirages.
 *
 * Ici, la séquence d'options est tirée UNE FOIS, d'une graine, par la même
 * loi que le jeu :
 *
 *   · la cadence est celle de Game.main — un dé par image (32 unités de tmod
 *     par seconde), k = BONUS_FREQ·(posées+1) − attente/6, borné par le
 *     plafond de dix options simultanées. Seule différence, assumée : le
 *     terme score/500 (qui espace les options des grosses parties) dépend du
 *     joueur, il est donc omis — la carte est la même pour tous ;
 *   · l'option est choisie par Std.randomProbas sur les POIDS du fichier
 *     (Const.PROBABILITIES), les uniques (bague, ressort…) tombant à zéro
 *     une fois tirés, comme en partie ;
 *   · position et durée de vie suivent Level.generate_pos (marges b=BORDER+10,
 *     tailles naturelles du dessin) et Level.generate_bonus (300+hasard(150)).
 *
 * Les FRUITS, eux, restent tirés en partie : ils dépendent de la frutibarre,
 * donc du jeu de chacun — c'est voulu (« aléatoire modulo la frutibarre »).
 *
 * Le fichier est partagé : le serveur (génération + aperçu de l'admin) et les
 * tests le chargent en module node ; le navigateur n'en a pas besoin (le
 * client reçoit la carte toute faite et se contente de la dérouler).
 */
'use strict';

(function (racine) {

const sousNode = (typeof module !== 'undefined' && module.exports);
const C = sousNode ? require('./const.js') : racine.SnakeConst;

// Les uniques de Game.is_unique_bonus (partie.js) — tirés une seule fois.
const UNIQUES = [8, 12, 14, 21, 28, 31, 33];

// Les noms du fichier d'origine (les commentaires de Const.PROBABILITIES),
// pour l'aperçu de l'admin. L'index est l'identifiant.
const OPTION_NOMS = [null,
  'Petit ciseau', 'Moyen ciseau', 'Grand ciseau', 'Langue', 'Coffre',
  'Potion rouge', 'Pillule', 'Bague', 'Potion bleue', 'Potion rose',
  'Potion violette', 'Ressort', 'Rondelle psychique', 'Inverseur',
  'Potion noire', 'Baguette magique', 'Molécule', 'Double molécule',
  'Bombe', 'Potion verte', 'Plume', 'Cyclope', 'Flèche', 'Flèche rouge',
  'Potion orange', 'Potion jaune', 'Dynamite', 'Poupée', 'Auréole',
  'Croix', 'Sonnette', 'Cloche', 'Pentacle', 'Sabre', 'Coffre à options',
  'Pieu', 'Potion fuca',
];

// ── La graine ─────────────────────────────────────────────────────────────
// N'importe quel texte fait l'affaire (« finale-2026 », un nombre…) : il est
// haché (FNV-1a) puis déroulé par mulberry32. Même graine → même carte,
// sur toutes les machines.
function hacherGraine(texte) {
  let h = 0x811c9dc5;
  const s = String(texte);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function creerHasard(graine) {
  let a = hacherGraine(graine) || 1;
  const suivant = () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return (n) => Math.floor(suivant() * n);
}

// Level.generate_pos, mot pour mot — la marge est b = BORDER + 10, la hauteur
// retire la barre du haut et la frutibarre, `w`/`h` sont les tailles
// NATURELLES du dessin (manifest cadres.options).
function tirerPosition(hasard, w, h) {
  const b = C.BORDER + 10;
  const x = b + hasard(Math.trunc(C.WIDTH - b * 2 - w)) + w / 2;
  const y = b + C.BARRE_UP
    + hasard(Math.trunc(C.HEIGHT - b * 2 - h - C.BARRE_UP - C.FRUTIBARRE_SIZE)) + h / 2;
  return { x, y };
}

/**
 * La carte : [{ t, id, x, y, vie }, …] triée par t.
 *
 *   t     l'instant de chute, en unités de tmod (32 par seconde de jeu) ;
 *   id    l'option (1..37, l'aiguillage de Game.get_bonus) ;
 *   x, y  la position, tirée aux marges de Level.generate_pos ;
 *   vie   la durée à l'écran, en unités de tmod (300 + hasard(150)).
 *
 * @param {string|number} graine
 * @param {object} cadresOptions  manifest `cadres.options` : id → { w, h }
 * @param {number} dureeTicks     l'horizon couvert (défaut : 20 minutes)
 */
function genererCarte(graine, cadresOptions, dureeTicks) {
  const duree = Math.max(1, Math.trunc(dureeTicks || 20 * 60 * 32));
  const hasard = creerHasard(graine);
  const probas = C.PROBABILITIES.slice();
  const entrees = [];
  const vivantes = [];                  // les fins de vie des options non ramassées
  let attente = 0;                      // le bonus_time de Game.main

  for (let t = 0; t < duree; t++) {
    for (let i = vivantes.length - 1; i >= 0; i--) {
      if (vivantes[i] <= t) vivantes.splice(i, 1);
    }
    // Le plafond de Game.main compte aussi les cases en main (slots) — un
    // état du joueur qu'une carte partagée ne peut pas connaître : on tient
    // le plafond sur les seules options posées. En partie, les chutes
    // scriptées passent outre le plafond pour la même raison (partie.js).
    if (vivantes.length >= 10) continue;
    const k = Math.round(C.BONUS_FREQ * (vivantes.length + 1) - attente / 6);
    if (hasard(Math.max(1, k)) === 0) {
      attente = 0;
      const id = 1 + C.randomProbas(probas, hasard);
      if (UNIQUES.indexOf(id) >= 0) probas[id - 1] = 0;
      const vie = 300 + hasard(150);
      const cadre = (cadresOptions && cadresOptions[id]) || { w: 20, h: 20 };
      const p = tirerPosition(hasard, cadre.w, cadre.h);
      entrees.push({
        t,
        id,
        x: Math.round(p.x * 100) / 100,
        y: Math.round(p.y * 100) / 100,
        vie,
      });
      vivantes.push(t + vie);
    } else {
      attente += 1;
    }
  }
  return entrees;
}

const API = { genererCarte, creerHasard, hacherGraine, OPTION_NOMS, UNIQUES };
if (sousNode) module.exports = API;
else racine.SnakeCarte = API;

})(typeof window !== 'undefined' ? window : globalThis);
