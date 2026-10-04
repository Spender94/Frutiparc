'use strict';
/*
 * LES COTES DES TOURNOIS — une cote fixe par joueur et par match (1 contre 1).
 *
 * « Ça doit être plus safe de parier sur le favori que sur l'outsider. » En
 * pari mutuel, la cote ne disait que ce que la foule avait misé : au premier
 * pari d'un match, rien ne distinguait le n° 1 du dernier qualifié. Les matchs
 * de tournoi reprennent donc une COTE FIXE, tirée de la force des deux joueurs,
 * figée au moment de la mise : le favori rapporte peu, l'outsider beaucoup.
 *
 * Pas de base, pas d'horloge : on donne les scores récents des deux joueurs,
 * le module dit la probabilité de chacun et sa cote. server.js lit la base,
 * fige la cote et paie.
 *
 * LA PROBABILITÉ. Un match de tournoi au score se gagne au meilleur score posé
 * pendant la fenêtre du tour. On compare donc les deux joueurs score à score :
 * leurs meilleurs scores du jour au Challenge du jeu (60 derniers jours, les 30
 * plus récents) et ceux du tournoi lui-même (qualif, tours précédents). Sur
 * toutes les paires (un score de A contre un score de B), la part que A gagne
 * (une égalité compte pour moitié) :
 *
 *     brute = paires gagnées par A / paires
 *
 * puis LISSÉE vers 50 % selon le nombre de scores connus (n = le plus petit
 * des deux échantillons, L = 3) — deux scores chacun ne font pas une certitude :
 *
 *     p = 0,5 + (brute − 0,5) × n / (n + L),   bornée entre 6 % et 94 %.
 *
 * Un joueur sans aucun score connu : 50 / 50.
 *
 * LA COTE. (1 − marge) / p, arrondie au centième INFÉRIEUR, bornée entre ×1,05
 * et ×10 ; marge du parc : 8 %. Les deux cotes d'un match font donc toujours
 * un peu moins que le « juste prix » : à long terme, le parc ne s'appauvrit pas
 * — et la mise maximale par match borne ce qu'il peut perdre sur un coup.
 *
 * LE RÈGLEMENT. La cote est figée à la mise : le gagnant reçoit `retour`
 * (mise × cote, au kikooz inférieur, mise comprise), le perdant ne reçoit
 * rien. Une rallonge se prend à la cote du moment : `retour` s'additionne.
 */

const REGLES = Object.freeze({
  marge: 0.08,
  min: 1.05,
  max: 10,
  pMin: 0.06,
  pMax: 0.94,
  lissage: 3,          // L
  fenetreJours: 60,    // l'historique du Challenge lu
  echantillons: 30,    // les meilleurs scores du jour gardés, les plus récents
});

const cle = (s) => String(s == null ? '' : s).toLowerCase();
const centiemeInferieur = (x) => Math.floor(x * 100 + 1e-9) / 100;

/**
 * La probabilité que A batte B, d'après leurs scores.
 * @param {number[]} a
 * @param {number[]} b
 */
function probaVictoire(a, b, regles) {
  const R = Object.assign({}, REGLES, regles || {});
  const sa = (a || []).map(Number).filter(Number.isFinite);
  const sb = (b || []).map(Number).filter(Number.isFinite);
  if (!sa.length || !sb.length) return 0.5;
  let gagnees = 0;
  for (const x of sa) for (const y of sb) gagnees += x > y ? 1 : x === y ? 0.5 : 0;
  const brute = gagnees / (sa.length * sb.length);
  const n = Math.min(sa.length, sb.length);
  const p = 0.5 + (brute - 0.5) * n / (n + R.lissage);
  return Math.min(R.pMax, Math.max(R.pMin, p));
}

/** La cote d'une probabilité : marge prise, au centième inférieur, bornée. */
function coteDe(p, regles) {
  const R = Object.assign({}, REGLES, regles || {});
  const brute = p > 0 ? centiemeInferieur((1 - R.marge) / p) : R.max;
  return Math.min(R.max, Math.max(R.min, brute));
}

/**
 * Les cotes d'un match.
 * @param {string} j1
 * @param {string} j2
 * @param {{ [pseudo]: number[] }} scores — les scores connus de chacun
 * @returns {{ [pseudo]: { p, cote, scores } }}
 */
function cotesDuMatch(j1, j2, scores, regles) {
  const s = scores || {};
  const a = s[cle(j1)] || [], b = s[cle(j2)] || [];
  const p1 = probaVictoire(a, b, regles);
  return {
    [cle(j1)]: { p: p1, cote: coteDe(p1, regles), scores: a.length },
    [cle(j2)]: { p: 1 - p1, cote: coteDe(1 - p1, regles), scores: b.length },
  };
}

/** Ce que rend une mise gagnante : mise × cote, au kikooz inférieur. */
function retourDe(mise, cote) {
  return Math.floor(Number(mise) * Number(cote) + 1e-9);
}

/**
 * Le règlement à cote fixe des paris d'un match décidé.
 * @param {Array<{id, username, choix, mise, retour}>} paris
 * @param {string} gagnant
 */
function regler(paris, gagnant) {
  const g = cle(gagnant);
  return (paris || []).map((p) => (cle(p.choix) === g
    ? { id: p.id, username: p.username, statut: 'gagne', gain: Number(p.retour) || 0 }
    : { id: p.id, username: p.username, statut: 'perdu', gain: 0 }));
}

module.exports = { REGLES, probaVictoire, coteDe, cotesDuMatch, retourDe, regler };
