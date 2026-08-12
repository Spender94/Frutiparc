/*
 * Mini-Wave 2 — la MAP DU JOUR du mode Challenge.
 *
 * L'arcade est toujours le même enchaînement de deux cents niveaux : au bout
 * d'un moment, on le connaît par cœur. Le Challenge y répond par un parcours
 * NEUF chaque jour : quarante niveaux générés d'une graine quotidienne, la
 * même pour tous les joueurs (le serveur donne la graine, minuit Paris fait
 * tourner la map).
 *
 * Le générateur ne produit pas du bruit : il est CALIBRÉ sur les niveaux
 * dessinés à la main du jeu de 2006, mesurés dans levels.json —
 *
 *   · les vitesses n'y bougent presque pas (moveSpeed 1→2, fallSpeed 6→7,
 *     ss/sd toujours 6) : la difficulté du jeu, c'est la COMPOSITION, pas la
 *     cadence. Le générateur fait pareil ;
 *   · chaque ennemi porte un `rank` (0..49) dans la table du moteur — l'ordre
 *     de difficulté officiel du jeu, qui suit d'ailleurs l'ordre d'apparition
 *     des espèces dans l'arcade. C'est notre échelle de difficulté ;
 *   · une escadre du jeu est un PAQUET STRUCTURÉ (bloc, lignes, V, damier,
 *     colonnes), pas des positions au hasard. Le générateur pose des motifs ;
 *   · les positions restent dans la fenêtre où le jeu dessine les siennes
 *     (x ∈ [24..216], hauts d'écran), espacées du pas de la grille (24).
 *
 * La MONTÉE de difficulté est le contrat du mode : à chaque niveau, le plafond
 * de rang s'élève, le plancher suit (les fraises du début disparaissent), et le
 * budget d'ennemis grossit. Par-dessus, le PROFIL du jour — tiré de la graine —
 * fait des maps douces, ordinaires ou féroces : certaines journées se gagnent,
 * d'autres se survivent.
 *
 * Aucun niveau ne porte de nom (le panneau affiche « level N » tout court), et
 * aucun ne s'appelle « boss » : c'est le NOM qui déclenche l'étape boss dans le
 * moteur, et le boss reste l'apanage de l'arcade. La map se termine d'elle-même
 * après le dernier niveau (Game : waveInfo épuisé → finPartie('fin')).
 *
 * Tout est déterministe : même graine, même map, au bit près — c'est ce qui
 * permet au serveur de ne publier qu'un entier.
 */
'use strict';

(function (racine) {

const sousNode = (typeof module !== 'undefined' && module.exports);
const E = sousNode ? require('./engine.js') : racine.MiniwaveEngine;

/*
 * Le nombre de niveaux d'une map — et la raison d'être de ce chiffre.
 *
 * La map n'est PAS faite pour être finie : c'est un CLASSEMENT quotidien, et un
 * parcours que tout le monde boucle ne départage personne. Quarante niveaux en
 * trois actes — l'échauffement, la montée, puis la ZONE ROUGE : le dernier
 * quart n'aligne plus que les espèces les plus dures du jeu, en formations
 * denses, aux vitesses maximales. On ne « gagne » pas la map du jour : on va le
 * plus loin possible, et c'est le niveau atteint qui creuse les écarts.
 */
const NIVEAUX_PAR_JOUR = 40;
// Où commence la zone rouge, en fraction du parcours (les ~10 derniers niveaux).
const ZONE_ROUGE = 0.72;

/*
 * Les espèces utilisables : celles que l'ARCADE fait voler en escadre.
 *
 * Le bestiaire du moteur compte cinquante et une entrées, mais les deux cents
 * niveaux dessinés à la main n'en emploient que quarante et une. Les dix
 * autres appartiennent à d'autres modes :
 *
 *   · 33 (Pruneau passe-muraille) ne sort que dans les missions spéciales ;
 *   · 42 à 49 (Demon lemon, Pêche jongleuse, Courge céleste, Bulbe spatial,
 *     Cosmo-Cassis, Pois casseur, Brugnon cuirassé, Nitro-pruneau) idem ;
 *   · 50 (Letter-monster) est la bête du MODE LETTRE — elle porte une lettre,
 *     ne tire pas, et n'a rien à faire dans une vague.
 *
 * Les laisser entrer donnait des niveaux hors-sujet (le mode lettre au niveau
 * 33 d'une map) et des espèces jamais éprouvées en escadre. La liste ci-dessous
 * est donc l'inverse : ce que l'arcade ne fait JAMAIS voler.
 *
 * (Le filtre d'origine écartait le type 34 — l'Astro-raisin, que l'arcade
 * emploie trente-deux fois — en croyant écarter le passe-muraille : c'est
 * l'index 33. L'escorte du boss, elle, n'est ni l'un ni l'autre : Boss.as
 * appelle `newBads(1, …)`, c'est l'Orangeonaute.)
 *
 * test/miniwaveChallenge.test.js recompte la liste dans levels.json : si un
 * jour l'arcade change, le test le dira.
 */
const HORS_ESCADRE = [33, 42, 43, 44, 45, 46, 47, 48, 49, 50];

// Triés par `rank`, l'échelle de difficulté du moteur.
function typesJouables() {
  const l = [];
  for (let t = 0; t < E.ENNEMIS.length; t++) {
    const e = E.ENNEMIS[t];
    if (!e || e.rank === undefined) continue;
    if (HORS_ESCADRE.indexOf(t) >= 0) continue;
    l.push({ type: t, rank: e.rank, value: e.value });
  }
  l.sort((a, b) => a.rank - b.rank);
  return l;
}

// ── Les profils de map ────────────────────────────────────────────────────
// « Certaines maps pourraient être plus difficiles que d'autres » : le profil
// du jour multiplie le budget d'ennemis et le plafond de rang. L'ordinaire
// domine le tirage — la map féroce doit rester un événement.
const PROFILS = [
  { nom: 'douce', poids: 2, budget: 0.85, plafond: 0.85 },
  { nom: 'ordinaire', poids: 4, budget: 1.0, plafond: 1.0 },
  { nom: 'corsée', poids: 2, budget: 1.12, plafond: 1.1 },
  { nom: 'féroce', poids: 1, budget: 1.25, plafond: 1.2 },
];

// ── Les motifs d'escadre ──────────────────────────────────────────────────
// Chacun rend une liste de positions RELATIVES en unités de grille (pas de
// 24 px), à partir d'un nombre d'ennemis voulu. Ce sont les formations qu'on
// voit dans les niveaux dessinés à la main : rangées, blocs, V, damiers,
// colonnes, arcs.
const PAS = 24;
const MOTIFS = [
  function rangees(n, h) {                 // lignes horizontales empilées
    const larg = Math.min(n, 3 + h(4));
    const out = [];
    for (let i = 0; i < n; i++) out.push({ gx: i % larg, gy: Math.floor(i / larg) });
    return out;
  },
  function bloc(n, h) {                    // pavé serré, presque carré
    const larg = Math.max(2, Math.round(Math.sqrt(n) + h(2) - 0.5));
    const out = [];
    for (let i = 0; i < n; i++) out.push({ gx: i % larg, gy: Math.floor(i / larg) });
    return out;
  },
  function enV(n) {                        // le chevron pointe en bas
    const out = [];
    let i = 0;
    for (let k = 0; out.length < n; k++) {
      out.push({ gx: -k, gy: -k * 0.5 });
      if (out.length < n && k > 0) out.push({ gx: k, gy: -k * 0.5 });
      if (++i > 40) break;
    }
    return out.map((p) => ({ gx: p.gx, gy: p.gy + Math.ceil(n / 4) }));
  },
  function damier(n, h) {                  // une case sur deux
    const larg = 3 + h(3);
    const out = [];
    for (let k = 0; out.length < n && k < 60; k++) {
      const gx = k % larg, gy = Math.floor(k / larg);
      if ((gx + gy) % 2 === 0) out.push({ gx, gy });
    }
    return out;
  },
  function colonnes(n, h) {                // colonnes espacées
    const cols = 2 + h(3);
    const out = [];
    for (let i = 0; i < n; i++) out.push({ gx: (i % cols) * 2, gy: Math.floor(i / cols) });
    return out;
  },
  function arc(n) {                        // un sourire vers le bas
    const out = [];
    for (let i = 0; i < n; i++) {
      const c = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;    // -1 .. 1
      out.push({ gx: Math.round(c * (n / 2)), gy: Math.round((1 - c * c) * 1.5) });
    }
    return out;
  },
];

/**
 * Une escadre : un motif, un type dominant (parfois deux mélangés), posée
 * autour d'un centre, bornée à la fenêtre du jeu, dédoublonnée. Le moteur exige
 * deux ennemis au moins par ligne (ligne[0] et ligne[1] portent la direction
 * d'entrée) — en dessous, l'escadre est abandonnée.
 */
function escadre(rng, h, pool, nb, occupees) {
  const motif = MOTIFS[h(MOTIFS.length)](nb, h)
    .map((p) => ({ gx: p.gx, gy: Math.round(p.gy) }));
  // Le type dominant vient du HAUT du pool (les derniers = les plus durs de la
  // fenêtre du niveau) ; le type d'appoint, de n'importe où.
  const dominant = pool[Math.max(0, pool.length - 1 - h(Math.min(3, pool.length)))];
  const appoint = (pool.length > 1 && h(3) === 0) ? pool[h(pool.length)] : null;

  // Le motif est RECENTRÉ dans la fenêtre avant d'être posé : son emprise est
  // mesurée, et le centre est tiré parmi les positions où tout tient. Sans ça,
  // un motif large posé près d'un bord perdait la moitié de ses cases — les
  // niveaux sortaient plus maigres que leur budget.
  let mx0 = Infinity, mx1 = -Infinity, my0 = Infinity, my1 = -Infinity;
  for (const p of motif) {
    mx0 = Math.min(mx0, p.gx); mx1 = Math.max(mx1, p.gx);
    my0 = Math.min(my0, p.gy); my1 = Math.max(my1, p.gy);
  }
  // La fenêtre des niveaux dessinés à la main, en cases de 24 : x ∈ [1..9]
  // (ni collé aux bords — la vague balance), y ∈ [2..5] (elle descend d'un
  // cran à chaque bord, partir trop bas tue trop vite).
  const cxMin = 1 - mx0, cxMax = 9 - mx1;
  const cyMin = 2 - my0, cyMax = 5 - my1;
  const cx = cxMax >= cxMin ? cxMin + h(cxMax - cxMin + 1) : Math.round((1 + 9) / 2 - (mx0 + mx1) / 2);
  const cy = cyMax >= cyMin ? cyMin + h(cyMax - cyMin + 1) : 2 - my0;

  const cases = [];
  for (const p of motif) {
    const x = Math.round((cx + p.gx) * PAS);
    const y = Math.round((cy + p.gy) * PAS);
    if (x < 24 || x > 216 || y < 40 || y > 128) continue;
    const cle = x + ':' + y;
    if (occupees.has(cle)) continue;
    occupees.add(cle);
    const t = (appoint && h(4) === 0) ? appoint.type : dominant.type;
    cases.push({ t, x, y });
  }
  return cases.length >= 2 ? cases : null;
}

/**
 * La map du jour. `graine` est l'entier publié par le serveur ; tout le reste
 * en découle.
 *
 * @returns {{ graine:number, profil:string, niveaux:Array }} — `niveaux` au
 *   format exact de levels.json (moveSpeed/fallSpeed/ss/sd/list), sans `name`.
 */
function genererMap(graine, nombre) {
  const N = nombre || NIVEAUX_PAR_JOUR;
  const rng = E.generateur(graine);
  const h = (n) => Math.floor(rng() * n);
  const pool = typesJouables();

  // Le profil du jour, au poids.
  let somme = 0;
  for (const p of PROFILS) somme += p.poids;
  let tirage = h(somme);
  let profil = PROFILS[0];
  for (const p of PROFILS) { tirage -= p.poids; if (tirage < 0) { profil = p; break; } }

  const rankMax = pool[pool.length - 1].rank;
  const niveaux = [];
  for (let i = 0; i < N; i++) {
    const t = N === 1 ? 1 : i / (N - 1);                // 0 → 1 le long de la map
    // La profondeur DANS la zone rouge (0 avant, 0 → 1 dedans).
    const rouge = Math.max(0, (t - ZONE_ROUGE) / (1 - ZONE_ROUGE));

    /*
     * La fenêtre de rangs du niveau. Avant la zone rouge : le plafond grimpe
     * du rang ~4 vers le maximum, modulé par le profil, et le plancher suit à
     * seize rangs — les premières espèces sortent à mesure que les dures
     * entrent. DANS la zone rouge, le profil ne protège plus personne : le
     * plafond est le maximum pour tout le monde, et le plancher REMONTE — au
     * dernier niveau, il ne reste que les huit espèces les plus féroces du
     * jeu. C'est ce mur commun qui départage les joueurs du jour.
     */
    let plafond, plancher;
    if (rouge > 0) {
      plafond = rankMax;
      plancher = Math.max(0, rankMax - Math.round(16 - 8 * rouge));
    } else {
      const tm = t / ZONE_ROUGE;                        // 0 → 1 jusqu'au mur
      plafond = Math.min(rankMax, Math.round((4 + tm * (rankMax - 4)) * profil.plafond));
      plancher = Math.max(0, plafond - 16);
    }
    const fenetre = pool.filter((p) => p.rank >= plancher && p.rank <= plafond);
    if (fenetre.length === 0) fenetre.push(pool[pool.length - 1]);

    // Le budget d'ennemis : de ~12 à ~26 sur la montée (les niveaux dessinés à
    // la main vont de 2 à 26), puis la zone rouge pousse jusqu'à ~30 — des
    // formations pleines, sans respiration.
    const budget = Math.round((12 + t * 14 + h(3)) * profil.budget + rouge * 4);

    // Deux à quatre escadres se partagent le budget.
    const nbEscadres = 2 + h(2) + (t > 0.5 && h(2) === 0 ? 1 : 0);
    const list = [];
    const occupees = new Set();
    let restant = budget;
    for (let e = 0; e < nbEscadres && restant >= 2; e++) {
      const part = (e === nbEscadres - 1)
        ? restant
        : Math.max(2, Math.min(restant - 2, 3 + h(6)));
      const ligne = escadre(rng, h, fenetre, part, occupees);
      if (ligne) { list.push(ligne); restant -= ligne.length; }
    }
    // Le filet : si les motifs ont tout perdu aux bords, une rangée simple
    // garantit un niveau jouable (le moteur exige au moins une ligne de deux).
    if (list.length === 0) {
      list.push([{ t: fenetre[0].type, x: 96, y: 48 }, { t: fenetre[0].type, x: 120, y: 48 }]);
    }

    /*
     * Les vitesses. Sur la montée : quasi constantes, comme l'arcade (sa
     * difficulté est la composition, pas la cadence). La zone rouge est le
     * seul endroit qui dépasse le SWF : vague à 2, chute à 8, entrées
     * resserrées (sd 5 — chaque vaisseau de l'escadre déboule plus tôt). C'est
     * une extrapolation assumée : le mur final doit être un mur.
     */
    niveaux.push({
      moveSpeed: (rouge > 0.3 || (t > 0.55 && profil.budget > 1 && h(3) === 0)) ? 2 : 1,
      fallSpeed: rouge > 0.6 ? 8 : (t > 0.6 ? 7 : 6),
      ss: 6,
      sd: rouge > 0.5 ? 5 : 6,
      list,
    });
  }
  return { graine, profil: profil.nom, niveaux };
}

const API = { genererMap, typesJouables, NIVEAUX_PAR_JOUR, PROFILS, MOTIFS, HORS_ESCADRE };

if (sousNode) module.exports = API;
else racine.MiniwaveChallenge = API;

})(typeof window !== 'undefined' ? window : globalThis);
