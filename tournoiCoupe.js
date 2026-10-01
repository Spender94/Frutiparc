'use strict';
/*
 * LA COUPE D'UN TOURNOI AU SCORE (« Maître ÈS … ») — les règles, sans base ni
 * horloge. server.js stocke, ouvre et ferme les fenêtres ; ce module dit qui
 * passe, comment s'appelle un tour, et le classement final.
 *
 *   · LE VAINQUEUR D'UN MATCH : le meilleur score de chacun pendant la fenêtre
 *     du tour. À score égal, celui qui l'a réalisé le premier (la règle de tous
 *     les classements du parc). Un seul a joué : il passe. Personne n'a joué :
 *     le mieux classé de la qualif (le plus petit seed) passe.
 *
 *   · LE CLASSEMENT FINAL : le champion, puis le finaliste ; ensuite les
 *     éliminés, du tour le plus avancé au premier, et dans un même tour au
 *     score réalisé dans ce tour (« départage au score »). Égalité, ou pas de
 *     score : le seed de la qualif départage.
 *
 *   · LE TOUR PRÉLIMINAIRE : un premier tour où certains sont exemptés (un
 *     tableau de 10 dans une grille de 16 : les 6 premiers attendent, 7e–10e
 *     et 8e–9e jouent) s'appelle ainsi, et non « 8e de finale ».
 */

const cle = (s) => String(s == null ? '' : s).toLowerCase();

/**
 * @param {{player1, player2}} m
 * @param {Map<string,{score:number,data?:string,at?:string}>} scores — par pseudo (minuscules)
 * @param {(pseudo)=>number} seedDe
 * @param {(a,b)=>boolean} meilleur — vrai si le score `a` bat strictement `b`
 * @returns {{ winner, score1, score2, motif }}
 */
function vainqueurDuMatch(m, scores, seedDe, meilleur) {
  const s1 = scores.get(cle(m.player1)) || null;
  const s2 = scores.get(cle(m.player2)) || null;
  const score1 = s1 ? Number(s1.score) : null;
  const score2 = s2 ? Number(s2.score) : null;
  const parSeed = () => ((seedDe(m.player1) || 999) <= (seedDe(m.player2) || 999) ? m.player1 : m.player2);
  if (!s1 && !s2) return { winner: parSeed(), score1, score2, motif: 'personne n’a joué : le mieux classé de la qualif passe' };
  if (!s2) return { winner: m.player1, score1, score2, motif: 'seul à avoir joué' };
  if (!s1) return { winner: m.player2, score1, score2, motif: 'seul à avoir joué' };
  if (meilleur(s1, s2)) return { winner: m.player1, score1, score2, motif: 'meilleur score' };
  if (meilleur(s2, s1)) return { winner: m.player2, score1, score2, motif: 'meilleur score' };
  const t1 = Date.parse(s1.at || '') || Infinity, t2 = Date.parse(s2.at || '') || Infinity;
  if (t1 !== t2) return { winner: t1 < t2 ? m.player1 : m.player2, score1, score2, motif: 'égalité : le premier à l’avoir réalisé' };
  return { winner: parSeed(), score1, score2, motif: 'égalité parfaite : le mieux classé de la qualif' };
}

// Un match d'exempté : un seul joueur, qualifié d'office.
const exempte = (m) => (!!m.player1) !== (!!m.player2);

/**
 * Le nom d'un tour. `matchsDuTour` (facultatif) sert à reconnaître le tour
 * préliminaire.
 */
function nomDuTour(round, totalRounds, matchsDuTour) {
  const r = Number(round), fromEnd = totalRounds - r;
  if (r === 1 && totalRounds >= 2 && Array.isArray(matchsDuTour)
    && matchsDuTour.some(exempte) && matchsDuTour.some((m) => m.player1 && m.player2)) {
    return 'Tour préliminaire';
  }
  if (fromEnd === 0) return 'Finale';
  if (fromEnd === 1) return 'Demi-finale';
  if (fromEnd === 2) return '1/4 de finale';
  if (fromEnd === 3) return '8ème de finale';
  if (fromEnd === 4) return '16ème de finale';
  return 'Tour ' + r;
}

/**
 * Le classement final (ou provisoire, tant que la coupe se joue).
 * @param {Array<{username, seed}>} joueurs
 * @param {Array} matches — ceux de la coupe
 * @param {(a,b)=>boolean} meilleur — sur des nombres : vrai si a bat b
 * @returns {Array<{ rang, username, seed, sortie, score, statut }>}
 *   `sortie` : le tour où il a perdu (null pour le champion ou s'il est encore
 *   en lice) ; `statut` : 'champion', 'finaliste', 'elimine', 'en_lice'.
 */
function classementFinal(joueurs, matches, meilleur) {
  const rounds = matches.length ? Math.max(...matches.map((m) => Number(m.round))) : 0;
  const seed = new Map(joueurs.map((j) => [cle(j.username), Number(j.seed) || 999]));
  const lignes = [];
  const vus = new Set();
  for (const m of matches) {
    if (!m.winner || !m.player1 || !m.player2) continue;
    const perdant = cle(m.winner) === cle(m.player1) ? m.player2 : m.player1;
    const score = cle(perdant) === cle(m.player1) ? m.score1 : m.score2;
    const finale = Number(m.round) === rounds;
    lignes.push({ username: perdant, seed: seed.get(cle(perdant)) || 999, sortie: Number(m.round),
      score: score == null ? null : Number(score), statut: finale ? 'finaliste' : 'elimine' });
    vus.add(cle(perdant));
    if (finale) {
      lignes.push({ username: m.winner, seed: seed.get(cle(m.winner)) || 999, sortie: null,
        score: null, statut: 'champion' });
      vus.add(cle(m.winner));
    }
  }
  for (const j of joueurs) {
    if (!vus.has(cle(j.username))) {
      lignes.push({ username: j.username, seed: seed.get(cle(j.username)) || 999, sortie: null, score: null, statut: 'en_lice' });
    }
  }
  const poids = (l) => (l.statut === 'champion' ? Infinity : l.statut === 'en_lice' ? 1000 : l.sortie);
  lignes.sort((a, b) => {
    if (poids(a) !== poids(b)) return poids(b) - poids(a);
    if (a.score != null && b.score != null) {
      if (meilleur(a.score, b.score)) return -1;
      if (meilleur(b.score, a.score)) return 1;
    } else if (a.score != null) return -1;
    else if (b.score != null) return 1;
    return a.seed - b.seed;
  });
  return lignes.map((l, i) => Object.assign({ rang: i + 1 }, l));
}

module.exports = { vainqueurDuMatch, nomDuTour, classementFinal };
