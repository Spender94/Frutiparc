'use strict';
/*
 * LES COTES DU CHALLENGE — une cote fixe par joueur, tirée de son historique.
 *
 * Pas de base, pas d'horloge : on donne l'historique d'un jeu (qui a joué
 * quel jour, qui a pris quelle médaille), le module dit la cote de chacun.
 * server.js lit la base et paie.
 *
 * LA PROBABILITÉ. Sur les 30 derniers jours où le jeu a tourné (des jours de
 * calendrier : un jour où le joueur n'est pas venu compte comme un jour sans
 * podium — un pari sur un absent est perdu) :
 *
 *     p = (jours joués / jours du jeu) × (podiums + L × base) / (jours joués + L)
 *
 *   · le premier facteur : la chance qu'il vienne jouer ;
 *   · le second : la chance qu'il monte sur le podium quand il joue, LISSÉE —
 *     on lui prête L jours « moyens » de plus, au taux de base du jeu (les
 *     médailles du jeu divisées par ses participations). Trois podiums en
 *     trois jours ne font pas une certitude.
 *   Pour le pari « or », la même chose avec les seules médailles d'or.
 *
 * LA COTE. (1 − marge) / p, arrondie au centième INFÉRIEUR, puis bornée. L'or
 * est le pari risqué : il paie davantage, et c'est garanti.
 *
 *                       médaillé        or
 *   marge du parc        10 %          5 %
 *   bornes            ×1,1 à ×10    ×1,65 à ×15
 *   sur soi (ou un
 *   compte du même
 *   appareil), au plus     ×3          ×4,5
 *
 *   · et la cote « or » d'un joueur vaut TOUJOURS au moins 1,5 fois sa cote
 *     « médaillé » ;
 *   · moins de 7 jours joués sur le jeu dans la fenêtre : pas de cote, le
 *     joueur n'est pas proposé.
 *
 * LE RÈGLEMENT. La cote est figée à la mise : le parieur gagnant reçoit
 * `retour` = mise × cote (arrondi au kikooz inférieur), mise comprise ; le
 * perdant ne reçoit rien. Le parc paie les gains et garde les mises perdues.
 */

const REGLES = Object.freeze({
  fenetre: 30,     // jours d'historique
  joursMin: 7,     // jours joués, au moins, pour avoir une cote
  lissage: 5,      // L : jours « moyens » prêtés à chacun
  ecartOr: 1.5,    // la cote « or » vaut au moins 1,5 × la cote « médaillé »
  podium: Object.freeze({ marge: 0.10, min: 1.1, max: 10, maxSoi: 3 }),
  or: Object.freeze({ marge: 0.05, min: 1.65, max: 15, maxSoi: 4.5 }),
});

const cle = (s) => String(s == null ? '' : s).toLowerCase();
const centiemeInferieur = (x) => Math.floor(x * 100 + 1e-9) / 100;

/**
 * @param {{ joues: Array<{username, jour}>, medailles: Array<{username, jour, rang}> }} hist
 *   `joues` : une ligne par joueur et par jour où il a un score ; `medailles` :
 *   une ligne par médaille (rang 1 = or).
 * @returns {{ jours, base: {podium, or}, joueurs: { [pseudo]: Ligne } }}
 *   Ligne : { joues, podiums, ors, eligible, podium: {p, cote}, or: {p, cote} }
 *   (`cote` null quand le joueur n'est pas éligible).
 */
function cotesDuJeu(hist, regles) {
  const R = Object.assign({}, REGLES, regles || {});
  const joues = new Map();       // pseudo -> Set(jours)
  const podiums = new Map();     // pseudo -> Set(jours)
  const ors = new Map();
  const jours = new Set();
  const ajoute = (m, u, j) => { if (!m.has(u)) m.set(u, new Set()); m.get(u).add(j); };
  for (const l of (hist && hist.joues) || []) {
    if (!l.username || !l.jour) continue;
    ajoute(joues, cle(l.username), String(l.jour));
    jours.add(String(l.jour));
  }
  // Une médaille sans score archivé (archive manquée) vaut quand même un jour joué.
  for (const l of (hist && hist.medailles) || []) {
    if (!l.username || !l.jour) continue;
    const u = cle(l.username), j = String(l.jour);
    ajoute(joues, u, j);
    jours.add(j);
    ajoute(podiums, u, j);
    if (Number(l.rang) === 1) ajoute(ors, u, j);
  }
  const n = jours.size;
  let participations = 0, nbPodiums = 0, nbOrs = 0;
  for (const s of joues.values()) participations += s.size;
  for (const s of podiums.values()) nbPodiums += s.size;
  for (const s of ors.values()) nbOrs += s.size;
  const base = {
    podium: participations ? nbPodiums / participations : 0.3,
    or: participations ? nbOrs / participations : 0.1,
  };
  const joueurs = {};
  for (const [u, s] of joues) {
    const j = s.size;
    const k = (podiums.get(u) || new Set()).size;
    const o = (ors.get(u) || new Set()).size;
    const eligible = j >= R.joursMin;
    const proba = (succes, b) => (n ? (j / n) : 0) * (succes + R.lissage * b) / (j + R.lissage);
    const pP = proba(k, base.podium), pO = proba(o, base.or);
    const cP = coteDe(pP, 'podium', R);
    const cO = Math.min(R.or.max, Math.max(coteDe(pO, 'or', R), centiemeInferieur(cP * R.ecartOr)));
    joueurs[u] = {
      joues: j, podiums: k, ors: o, eligible,
      podium: { p: pP, cote: eligible ? cP : null },
      or: { p: pO, cote: eligible ? cO : null },
    };
  }
  return { jours: n, base, joueurs };
}

/** La cote d'une probabilité pour un type de pari ('podium' ou 'or'), marge prise et bornes appliquées. */
function coteDe(p, type, regles) {
  const R = Object.assign({}, REGLES, regles || {});
  const T = R[type === 'or' ? 'or' : 'podium'];
  const brute = p > 0 ? centiemeInferieur((1 - T.marge) / p) : T.max;
  return Math.min(T.max, Math.max(T.min, brute));
}

/** La cote proposée à un parieur : celle du joueur, plafonnée s'il parie sur soi. */
function coteProposee(cote, soi, type, regles) {
  const R = Object.assign({}, REGLES, regles || {});
  if (cote == null) return null;
  return soi ? Math.min(cote, R[type === 'or' ? 'or' : 'podium'].maxSoi) : cote;
}

/** Ce que rend une mise gagnante : mise × cote, au kikooz inférieur. */
function retourDe(mise, cote) {
  return Math.floor(Number(mise) * Number(cote) + 1e-9);
}

/**
 * Le règlement à cote fixe d'un pot. Si le jeu n'a eu AUCUN médaillé (le
 * Challenge n'a pas tourné), tout est remboursé.
 * @param {Array<{id, username, choix, mise, retour}>} paris
 * @param {string[]} gagnants
 */
function reglerCotes(paris, gagnants) {
  const g = new Set((gagnants || []).filter(Boolean).map(cle));
  return (paris || []).map((p) => {
    if (!g.size) return { id: p.id, username: p.username, statut: 'rembourse', gain: Number(p.mise) };
    return g.has(cle(p.choix))
      ? { id: p.id, username: p.username, statut: 'gagne', gain: Number(p.retour) }
      : { id: p.id, username: p.username, statut: 'perdu', gain: 0 };
  });
}

module.exports = { REGLES, cotesDuJeu, coteDe, coteProposee, retourDe, reglerCotes };
