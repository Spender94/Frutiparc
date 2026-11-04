'use strict';
/*
 * ⚠ LES PRUNOSTICS DU CHALLENGE SONT REDEVENUS UN PARI MUTUEL (paris.js) : une
 * cote fixe calculée se trompe, et c'est le parc qui payait l'erreur — des
 * kikooz créés à chaque cote trop généreuse. Ce module ne fixe donc plus
 * aucun gain sur les médaillés. Il sert encore à trois choses :
 *   · `cotesDuJeu` : l'historique d'un jeu (jours joués, podiums, ors de
 *     chacun) — les habitués proposés aux parieurs, et le tirage des jeux du
 *     jour (les jeux vraiment joués) ;
 *   · `reglerCotes` : le règlement des paris posés à cote fixe pendant la
 *     semaine où elle a eu cours — payés comme promis — et ceux du défi ;
 *   · `cotesDefi` : la cote du DÉFI MÉDAILLE, un pari sur soi (plus bas) —
 *     le seul pari du Challenge encore à cote fixe, sous plafond serré.
 * Le reste (cotes, découverte) décrit cette règle d'une semaine.
 *
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
 *   · moins de 7 jours joués sur le jeu dans la fenêtre : pas assez
 *     d'historique pour une cote à soi — le joueur n'est pas dans la liste,
 *     mais on peut parier sur lui à la COTE DE DÉCOUVERTE (ci-dessous).
 *
 * LA COTE DE DÉCOUVERTE. Celle d'un joueur « moyen » du jeu, qui vient jouer :
 * p = le taux de base du jeu (ses médailles sur ses participations), marge et
 * bornes comme ci-dessus, l'or au moins 1,5 fois le médaillé. Un jeu trop peu
 * joué pour avoir un taux de base (moins de 10 participations dans la
 * fenêtre) : ×3 en médaillé, ×5 en or. Un joueur qui a déjà un peu joué (1 à
 * 6 jours) ne peut qu'y perdre : sa cote est la plus petite de la découverte
 * et de celle que lui donnent ses quelques jours (en supposant qu'il vienne) —
 * six médailles d'or en six jours ne se jouent pas à la cote d'un inconnu.
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
  baseMin: 10,     // participations, au moins, pour tirer un taux de base du jeu
  decouverteDefaut: Object.freeze({ podium: 3, or: 5 }),
  podium: Object.freeze({ marge: 0.10, min: 1.1, max: 10, maxSoi: 3 }),
  or: Object.freeze({ marge: 0.05, min: 1.65, max: 15, maxSoi: 4.5 }),
  // LE DÉFI MÉDAILLE (cotesDefi) : sur soi, une médaille de telle couleur ou mieux.
  defi: Object.freeze({
    ecart: 1.05,     // chaque couleur paie au moins 1,05 fois la précédente
    bronze: Object.freeze({ marge: 0.15, min: 1.05, max: 3 }),
    argent: Object.freeze({ marge: 0.15, min: 1.1, max: 4 }),
    or: Object.freeze({ marge: 0.15, min: 1.15, max: 5 }),
  }),
});

const cle = (s) => String(s == null ? '' : s).toLowerCase();
const centiemeInferieur = (x) => Math.floor(x * 100 + 1e-9) / 100;

/**
 * @param {{ joues: Array<{username, jour}>, medailles: Array<{username, jour, rang}> }} hist
 *   `joues` : une ligne par joueur et par jour où il a un score ; `medailles` :
 *   une ligne par médaille (rang 1 = or).
 * @returns {{ jours, base: {podium, or}, joueurs: { [pseudo]: Ligne } }}
 *   Ligne : { joues, podiums, ors, eligible, podium: {p, cote}, or: {p, cote} }
 *   (un joueur non éligible porte sa cote de découverte) ; `decouverte` :
 *   { podium, or }, la cote d'un joueur inconnu du jeu.
 */
function cotesDuJeu(hist, regles) {
  const R = Object.assign({}, REGLES, regles || {});
  const joues = new Map();       // pseudo -> Set(jours)
  const podiums = new Map();     // pseudo -> Set(jours)
  const argents = new Map();     // l'argent ou l'or (rang 1 ou 2)
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
    if (Number(l.rang) <= 2) ajoute(argents, u, j);
    if (Number(l.rang) === 1) ajoute(ors, u, j);
  }
  const n = jours.size;
  let participations = 0, nbPodiums = 0, nbArgents = 0, nbOrs = 0;
  for (const s of joues.values()) participations += s.size;
  for (const s of podiums.values()) nbPodiums += s.size;
  for (const s of argents.values()) nbArgents += s.size;
  for (const s of ors.values()) nbOrs += s.size;
  const base = {
    podium: participations ? nbPodiums / participations : 0.3,
    argent: participations ? nbArgents / participations : 0.2,
    or: participations ? nbOrs / participations : 0.1,
  };
  // La cote « or » d'une paire : au moins 1,5 fois la cote « médaillé ».
  const paire = (pP, pO) => {
    const cP = coteDe(pP, 'podium', R);
    return { podium: cP, or: Math.min(R.or.max, Math.max(coteDe(pO, 'or', R), centiemeInferieur(cP * R.ecartOr))) };
  };
  const decouverte = participations >= R.baseMin
    ? paire(base.podium, base.or)
    : { podium: R.decouverteDefaut.podium, or: R.decouverteDefaut.or };
  const joueurs = {};
  for (const [u, s] of joues) {
    const j = s.size;
    const k = (podiums.get(u) || new Set()).size;
    const o = (ors.get(u) || new Set()).size;
    const a = (argents.get(u) || new Set()).size;
    const eligible = j >= R.joursMin;
    const proba = (succes, b) => (n ? (j / n) : 0) * (succes + R.lissage * b) / (j + R.lissage);
    const pP = proba(k, base.podium), pO = proba(o, base.or);
    let c;
    if (eligible) c = paire(pP, pO);
    else {
      // Peu de jours : la découverte, sauf si ces jours-là (s'il vient) disent moins.
      const sien = paire((k + R.lissage * base.podium) / (j + R.lissage), (o + R.lissage * base.or) / (j + R.lissage));
      c = { podium: Math.min(decouverte.podium, sien.podium), or: Math.min(decouverte.or, sien.or) };
    }
    joueurs[u] = {
      joues: j, podiums: k, argents: a, ors: o, eligible,
      podium: { p: pP, cote: c.podium },
      or: { p: pO, cote: c.or },
    };
  }
  return { jours: n, participations, base, decouverte, joueurs };
}

/*
 * LE DÉFI MÉDAILLE — « je décroche une médaille à tel jeu demain ».
 *
 * Un pari SUR SOI, à cote FIXE : il n'y a personne en face (chacun ne parie
 * que sur lui-même), un pot mutuel n'aurait rien à partager. La cote est donc
 * celle d'une probabilité, comme la règle d'une semaine ci-dessus, avec trois
 * différences qui tiennent au fait que le parieur fait lui-même le résultat :
 *
 *   · pas de facteur de présence : il décide de venir jouer, on ne lui paie
 *     pas sa propre assiduité. Sa chance quand il joue, lissée :
 *         p = (réussites + L × base) / (jours joués + L)
 *     où « réussite » dépend de la couleur demandée : une médaille (bronze ou
 *     mieux), l'argent ou l'or (argent ou mieux), l'or seul ;
 *   · moins de 7 jours joués : la chance d'un joueur MOYEN du jeu (le taux
 *     de base), sauf si ses quelques jours disent mieux — la plus petite des
 *     deux cotes, comme la découverte ;
 *   · un jeu trop peu joué (moins de 7 jours de jeu ou de 10 participations
 *     dans la fenêtre) n'a PAS de défi : sur un jeu désert, on y serait seul
 *     et la médaille serait donnée.
 *
 * LA COTE : (1 − 15 %) / p, au centième inférieur, bornée par couleur, et
 * chaque couleur paie au moins 1,05 fois la précédente (plafond compris) :
 *
 *                   bronze ou mieux   argent ou mieux     or
 *   bornes           ×1,05 à ×3       ×1,1 à ×4         ×1,15 à ×5
 *
 * Les planchers (et l'écart) sont bas exprès : le champion qui prend l'or
 * tous les jours n'a pas à se faire payer une médaille qu'il a d'avance —
 * planchers et écart hauts lui donneraient un gain moyen au-dessus de sa mise. Avec le plafond du
 * défi (20 kikooz par jour d'origine), un défi rapporte au plus 80 kikooz nets.
 *
 * La mise se règle comme un pari à cote fixe (reglerCotes) : gagné, on reçoit
 * mise × cote ; perdu, rien ; le jeu sans aucun médaillé ce jour-là (il n'a
 * pas tourné), tout est remboursé.
 */
const COULEURS_DEFI = Object.freeze(['bronze', 'argent', 'or']);
/**
 * @param {object} cotes — le résultat de cotesDuJeu pour ce jeu
 * @param {string} pseudo — le parieur (qui parie sur lui-même)
 * @returns {null | { bronze, argent, or, joues, podiums, argents, ors, decouverte }}
 *   null : le jeu n'a pas assez d'historique pour un défi.
 */
function cotesDefi(cotes, pseudo, regles) {
  const R = Object.assign({}, REGLES, regles || {});
  const D = Object.assign({}, REGLES.defi, R.defi || {});
  if (!cotes || (cotes.jours || 0) < R.joursMin || (cotes.participations || 0) < R.baseMin) return null;
  const base = cotes.base || {};
  const l = (cotes.joueurs || {})[cle(pseudo)] || { joues: 0, podiums: 0, argents: 0, ors: 0 };
  const j = Number(l.joues) || 0;
  const reussites = { bronze: Number(l.podiums) || 0, argent: Number(l.argents) || 0, or: Number(l.ors) || 0 };
  const taux = { bronze: base.podium || 0, argent: base.argent || 0, or: base.or || 0 };
  const brute = (p, T) => (p > 0 ? centiemeInferieur((1 - T.marge) / p) : T.max);
  const borne = (c, T) => Math.min(T.max, Math.max(T.min, c));
  const out = { joues: j, podiums: reussites.bronze, argents: reussites.argent, ors: reussites.or, decouverte: j < R.joursMin };
  let precedente = 0;
  for (const k of COULEURS_DEFI) {
    const T = D[k];
    const sienne = (reussites[k] + R.lissage * taux[k]) / (j + R.lissage);
    let c = brute(sienne, T);
    if (j < R.joursMin) c = Math.min(c, brute(taux[k], T));
    c = borne(c, T);
    if (precedente) c = Math.min(T.max, Math.max(c, centiemeInferieur(precedente * D.ecart)));
    out[k] = c;
    precedente = c;
  }
  return out;
}

/** La cote d'un joueur pour ce jeu : la sienne, ou celle de découverte s'il est inconnu. */
function coteDuJoueur(cotes, pseudo, type) {
  const l = cotes && cotes.joueurs && cotes.joueurs[cle(pseudo)];
  if (l) return { cote: l[type === 'or' ? 'or' : 'podium'].cote, decouverte: !l.eligible };
  const d = (cotes && cotes.decouverte) || REGLES.decouverteDefaut;
  return { cote: d[type === 'or' ? 'or' : 'podium'], decouverte: true };
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

module.exports = { REGLES, COULEURS_DEFI, cotesDuJeu, cotesDefi, coteDuJoueur, coteDe, coteProposee, retourDe, reglerCotes };
