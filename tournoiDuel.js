//
// Tournoi en DUEL — poules, qualification, coupe.
//
// Le système de tournois de Frutiparc (« Maître ÈS … ») départage au SCORE :
// une fenêtre s'ouvre, chacun pousse son meilleur score, le plus haut passe.
// Ça convient aux jeux solo. Frutibandas, lui, se joue à deux : un match n'est
// pas un score mais une SÉRIE DE MANCHES entre deux personnes, et il se plie
// « à l'écart » — on continue tant qu'un joueur ne mène pas de deux victoires
// (2-0, 3-1, 4-2…), la règle que l'animation a retenue pour son tournoi.
//
// Ce module est la règle du jeu de ce format, et rien d'autre : pas de base,
// pas de réseau, pas d'horloge. On lui donne l'état (joueurs, matchs) et il
// répond quoi en faire. Le stockage et les routes vivent dans server.js.
//
// Le vocabulaire, celui de l'affiche :
//   · MANCHE  — une partie de Frutibandas.
//   · MATCH   — la série de manches entre deux joueurs, pliée à l'écart.
//   · POULE   — un petit groupe où tout le monde rencontre tout le monde.
//   · TOUR    — un tour de coupe (quarts, demies, finale), retiré au sort à
//               chaque fois : « remise en jeu et tirage au sort intégral ».
//
'use strict';

const ECART_DEFAUT = 2;      // victoires d'écart pour plier un match
const POULE_DEFAUT = 3;      // joueurs par poule
const LETTRES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// Le tour des poules porte le numéro 0 ; le repêchage (« poule de baston »)
// le numéro -1, pour qu'il ne se mélange pas aux tours de coupe.
const TOUR_POULES = 0;
const TOUR_REPECHAGE = -1;

// ── Petits outils ──────────────────────────────────────────────────────────

const clef = (u) => String(u == null ? '' : u).toLowerCase();
const memeJoueur = (a, b) => clef(a) === clef(b);
// Un joueur se donne indifféremment par son pseudo ou par sa fiche
// { username, poule } : les appelants ont l'un ou l'autre sous la main.
const nomDe = (j) => clef(j && typeof j === 'object' ? j.username : j);

// Mélange de Fisher-Yates. `alea` est injectable : un tirage doit pouvoir se
// rejouer à l'identique dans un test.
function melanger(liste, alea) {
  const r = liste.slice();
  const tirer = alea || Math.random;
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(tirer() * (i + 1));
    const t = r[i]; r[i] = r[j]; r[j] = t;
  }
  return r;
}

// ── Les poules ─────────────────────────────────────────────────────────────

/**
 * Répartit les joueurs en poules de `taille` (la dernière peut être plus
 * petite si le compte ne tombe pas juste). Le tirage est intégral : aucun
 * classement ne pèse dessus, c'est une reprise.
 *
 * @returns {Array<{ username, poule }>} dans l'ordre du tirage.
 */
function tirerPoules(joueurs, taille, alea) {
  const n = Math.max(2, Math.floor(taille) || POULE_DEFAUT);
  const melange = melanger(joueurs.map(nomDe), alea);
  const nb = Math.max(1, Math.ceil(melange.length / n));
  const out = [];
  // On distribue en ROND (A, B, C, D, A, B…) plutôt qu'en tranches : si le
  // compte ne tombe pas juste, les poules restent de tailles voisines au lieu
  // d'en laisser une à un seul joueur.
  melange.forEach((u, i) => out.push({ username: u, poule: LETTRES[i % nb] }));
  return out;
}

/** Toutes les affiches d'une poule : chacun rencontre chacun, une fois. */
function affichesPoule(joueurs) {
  const out = [];
  for (let i = 0; i < joueurs.length; i++) {
    for (let j = i + 1; j < joueurs.length; j++) out.push([joueurs[i], joueurs[j]]);
  }
  return out;
}

/**
 * Les matchs d'une phase de groupes, prêts à être enregistrés.
 * @param {Array<{username, poule}>} joueurs
 * @param {number} tour  TOUR_POULES ou TOUR_REPECHAGE
 */
function matchsDeGroupes(joueurs, tour) {
  const parPoule = new Map();
  for (const j of joueurs) {
    if (!j.poule) continue;
    if (!parPoule.has(j.poule)) parPoule.set(j.poule, []);
    parPoule.get(j.poule).push(clef(j.username));
  }
  const out = [];
  let slot = 0;
  for (const p of [...parPoule.keys()].sort()) {
    for (const [a, b] of affichesPoule(parPoule.get(p))) {
      out.push({ round: tour, slot: slot++, poule: p, player1: a, player2: b });
    }
  }
  return out;
}

// ── Le classement d'une poule ──────────────────────────────────────────────

/**
 * Le tableau d'une poule. Départage, dans l'ordre :
 *   1. les MATCHS gagnés ;
 *   2. la confrontation directe, quand exactement deux joueurs sont à égalité
 *      (le plus parlant, et le cas courant d'une poule de trois) ;
 *   3. la différence de MANCHES (gagnées moins perdues) ;
 *   4. les manches gagnées ;
 *   5. le pseudo, pour que l'ordre soit stable et non arbitraire.
 */
function classementPoule(joueurs, matchs) {
  const noms = joueurs.map(nomDe);
  const t = new Map(noms.map((u) => [u, {
    username: u, joues: 0, gagnes: 0, perdus: 0, pour: 0, contre: 0,
  }]));
  const finis = matchs.filter((m) => m.status === 'done' && m.winner);
  for (const m of finis) {
    const a = t.get(clef(m.player1)), b = t.get(clef(m.player2));
    if (!a || !b) continue;
    const s1 = Number(m.score1) || 0, s2 = Number(m.score2) || 0;
    a.joues++; b.joues++;
    a.pour += s1; a.contre += s2;
    b.pour += s2; b.contre += s1;
    if (memeJoueur(m.winner, m.player1)) { a.gagnes++; b.perdus++; } else { b.gagnes++; a.perdus++; }
  }
  const lignes = [...t.values()];
  // Tri sur les seuls critères TRANSITIFS. La confrontation directe ne peut
  // pas entrer ici : « a bat b, b bat c, c bat a » est un cycle, et un
  // comparateur qui n'est pas transitif rend un tri imprévisible.
  lignes.sort((x, y) => {
    if (y.gagnes !== x.gagnes) return y.gagnes - x.gagnes;
    const dx = x.pour - x.contre, dy = y.pour - y.contre;
    if (dy !== dx) return dy - dx;
    if (y.pour !== x.pour) return y.pour - x.pour;
    return x.username.localeCompare(y.username);
  });
  // Puis la confrontation directe, en passe locale : deux VOISINS que rien
  // n'a départagés s'échangent si l'un a battu l'autre. C'est le cas courant
  // d'une poule de trois, et c'est ce que les joueurs attendent — mais on ne
  // le laisse pas gouverner tout le tri.
  const egaux = (x, y) => x.gagnes === y.gagnes
    && (x.pour - x.contre) === (y.pour - y.contre) && x.pour === y.pour;
  for (let i = 0; i + 1 < lignes.length; i++) {
    if (!egaux(lignes[i], lignes[i + 1])) continue;
    if (confrontation(lignes[i].username, lignes[i + 1].username, finis) > 0) {
      const tmp = lignes[i]; lignes[i] = lignes[i + 1]; lignes[i + 1] = tmp;
    }
  }
  return lignes;
}

// Qui a gagné le match qui opposait ces deux-là ? -1 si c'est `a`, 1 si c'est
// `b`, 0 si le match n'a pas eu lieu (ou n'a pas de vainqueur).
function confrontation(a, b, finis) {
  for (const m of finis) {
    const p1 = clef(m.player1), p2 = clef(m.player2);
    if ((p1 === a && p2 === b) || (p1 === b && p2 === a)) {
      if (memeJoueur(m.winner, a)) return -1;
      if (memeJoueur(m.winner, b)) return 1;
    }
  }
  return 0;
}

/** Toutes les poules sont-elles allées au bout ? */
function poulesTerminees(matchs, tour) {
  const t = matchs.filter((m) => Number(m.round) === tour);
  return t.length > 0 && t.every((m) => m.status === 'done' && m.winner);
}

/**
 * La sortie des poules : les `parPoule` premiers de chaque groupe passent en
 * coupe, les autres tombent au repêchage. L'ordre des qualifiés alterne les
 * poules (1er de A, 1er de B, …, puis les 2es) — le tirage de coupe étant de
 * toute façon intégral, cela ne sert qu'à donner des numéros lisibles.
 */
function sortieDesPoules(joueurs, matchs, parPoule) {
  const k = Math.max(1, Math.floor(parPoule) || 2);
  const poules = [...new Set(joueurs.map((j) => j.poule).filter(Boolean))].sort();
  const tables = new Map();
  for (const p of poules) {
    const dedans = joueurs.filter((j) => j.poule === p);
    const leurs = matchs.filter((m) => m.poule === p && Number(m.round) === TOUR_POULES);
    tables.set(p, classementPoule(dedans, leurs));
  }
  const qualifies = [], repeches = [];
  for (let rang = 0; ; rang++) {
    let vu = false;
    for (const p of poules) {
      const l = tables.get(p);
      if (rang >= l.length) continue;
      vu = true;
      (rang < k ? qualifies : repeches).push({ username: l[rang].username, poule: p, rang: rang + 1 });
    }
    if (!vu) break;
  }
  return { qualifies, repeches, tables };
}

// ── La coupe ───────────────────────────────────────────────────────────────

/**
 * Un tour de coupe, TIRÉ AU SORT INTÉGRALEMENT — c'est la règle affichée par
 * l'animation : « remise en jeu et tirage au sort intégral à chaque tour ».
 * Aucun seed ne protège personne, le premier de sa poule peut tomber sur le
 * deuxième d'à côté dès les quarts.
 *
 * Un nombre impair de joueurs laisse un EXEMPT (bye) : il passe au tour
 * suivant sans jouer. Son match est déjà `done`, sans adversaire.
 */
function tirerTour(joueurs, tour, alea) {
  const melange = melanger(joueurs.map(nomDe), alea);
  const out = [];
  let slot = 0;
  while (melange.length >= 2) {
    const a = melange.shift(), b = melange.shift();
    out.push({ round: tour, slot: slot++, poule: null, player1: a, player2: b, status: 'pending' });
  }
  if (melange.length === 1) {
    out.push({ round: tour, slot: slot++, poule: null, player1: melange[0], player2: null,
      winner: melange[0], score1: 0, score2: 0, status: 'done' });
  }
  return out;
}

/** Les vainqueurs d'un tour, dans l'ordre des affiches. */
function vainqueursDuTour(matchs, tour) {
  return matchs
    .filter((m) => Number(m.round) === tour && m.status === 'done' && m.winner)
    .sort((a, b) => (a.slot || 0) - (b.slot || 0))
    .map((m) => clef(m.winner));
}

/** Le tour est-il joué en entier ? */
function tourTermine(matchs, tour) {
  const t = matchs.filter((m) => Number(m.round) === tour);
  return t.length > 0 && t.every((m) => m.status === 'done' && m.winner);
}

// ── La marche d'un match ───────────────────────────────────────────────────

/**
 * Une manche vient de se jouer. Trouve le match ouvert qui oppose ces deux-là
 * dans le tour courant et lui ajoute le point.
 *
 * `gagnant` à null = manche nulle : elle se joue, elle se compte comme jouée,
 * mais elle ne rapproche personne de la victoire (c'est le cas où les deux
 * camps perdent leur dernier fruit du même coup — « La Vachette » gagne).
 *
 * @returns {null|{ match, score1, score2, fini, winner }} null si aucun match
 *          en cours n'attend cette affiche (partie amicale entre deux
 *          concurrents, manche jouée hors tournoi…).
 */
function manche(matchs, tours, a, b, gagnant, ecart) {
  const e = Math.max(1, Math.floor(ecart) || ECART_DEFAUT);
  const ouverts = matchs.filter((m) => m.status !== 'done'
    && tours.indexOf(Number(m.round)) >= 0
    && ((memeJoueur(m.player1, a) && memeJoueur(m.player2, b))
      || (memeJoueur(m.player1, b) && memeJoueur(m.player2, a))));
  if (!ouverts.length) return null;
  // Le plus ancien d'abord : deux affiches identiques ne devraient pas coexister,
  // mais si cela arrive, on remplit dans l'ordre plutôt qu'au hasard.
  const m = ouverts.sort((x, y) => (Number(x.round) - Number(y.round)) || ((x.slot || 0) - (y.slot || 0)))[0];
  let s1 = Number(m.score1) || 0, s2 = Number(m.score2) || 0;
  if (gagnant != null) {
    if (memeJoueur(m.player1, gagnant)) s1++;
    else if (memeJoueur(m.player2, gagnant)) s2++;
    else return null;
  }
  const fini = Math.abs(s1 - s2) >= e;
  return {
    match: m, score1: s1, score2: s2, fini,
    winner: fini ? (s1 > s2 ? clef(m.player1) : clef(m.player2)) : null,
  };
}

/** Le libellé d'un tour, pour l'affichage (8 joueurs → quarts, demies, finale). */
function nomDuTour(tour, nbMatchs) {
  if (Number(tour) === TOUR_POULES) return 'Poules';
  if (Number(tour) === TOUR_REPECHAGE) return 'Poule de repêchage';
  if (nbMatchs === 1) return 'Finale';
  if (nbMatchs === 2) return 'Demi-finales';
  if (nbMatchs === 4) return 'Quarts de finale';
  if (nbMatchs === 8) return 'Huitièmes de finale';
  return 'Tour ' + tour;
}

module.exports = {
  ECART_DEFAUT, POULE_DEFAUT, TOUR_POULES, TOUR_REPECHAGE, LETTRES,
  melanger, tirerPoules, affichesPoule, matchsDeGroupes,
  classementPoule, poulesTerminees, sortieDesPoules,
  tirerTour, vainqueursDuTour, tourTermine, manche, nomDuTour,
  clef, memeJoueur,
};
