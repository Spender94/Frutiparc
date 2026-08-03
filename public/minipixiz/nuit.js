/*
 * Minipixiz (miniTroll) — la nuit.
 *
 * Traduction de Cm.updateTime et Cm.upkeep.
 *
 * C'est le moteur de toute l'aventure, et il ne tourne PAS pendant qu'on joue :
 * il tourne quand on revient. Le jeu note l'heure qu'il était en partant
 * (`$time.$t`) ; au retour il compte le temps écoulé, et pour chaque journée
 * entière il fait passer une nuit. On peut donc rester un mois sans venir et
 * retrouver trente nuits d'un coup — c'est voulu, et c'est aussi pourquoi une
 * fée qu'on abandonne meurt de faim.
 *
 * Ce qui arrive pendant une nuit, dans l'ordre du fichier :
 *
 *   1. les FÉES mangent leurs réserves, perdent du moral, jouent leurs travers
 *      de caractère et se réveillent d'une humeur ou d'une autre ;
 *   2. le BASSIN s'allume ou s'éteint — c'est là qu'on trouve les fées ;
 *   3. le DONJON se construit, quand on a assez couru ;
 *   4. les fées de haut niveau font savoir qu'elles aimeraient partir ;
 *   5. l'ARC-EN-CIEL apparaît, et repart le lendemain ;
 *   6. le VENT tourne ;
 *   7. GROMELIN affiche de nouvelles missions, et solde celles qui arrivent à
 *      échéance.
 *
 * ── Le hasard ──
 *
 * L'original tire sur Math.random. Ici l'appelant peut fournir son propre
 * tirage, ce qui rend une nuit rejouable — indispensable pour la vérifier.
 */
'use strict';

(function (racine) {

const sousNode = (typeof module !== 'undefined' && module.exports);
const E = sousNode ? require('./engine.js') : racine.MinipixizEngine;
const F = sousNode ? require('./faerie.js') : racine.MinipixizFee;
const O = sousNode ? require('./items.js') : racine.MinipixizObjets;
const P = sousNode ? require('./plateforme.js') : racine.MinipixizPlateforme;

const JOUR = 86400000;                // Cs.sDay
const MISSION_SEUIL_COURSE = 1000;    // Cm.upkeep : pas de mission avant d'avoir couru
const MISSION_DUREES = [3, 5, 7, 10, 15, 30];
const NB_TYPES_MISSION = 8;           // Lang.MISSION
const DONJON_MAX = 5;

// Cm.upkeep : le nom de la bâtisse selon son rang, et de quoi qualifier ce qui
// rôde autour.
const DONJONS = ['petite tour', 'grande tour', 'bastide', 'forteresse', 'citadelle'];
const ADJECTIFS = [
  'curieux', 'étranges', 'farceurs', 'baroques', 'bizarres', 'biscornus',
  'malfaisants', 'abominables', 'exotiques', 'extravagants', 'saugrenus',
  'fantastiques', 'mystérieux', 'louches', 'insolites', 'incroyables',
  'énigmatiques', 'grotesques', 'cornus', 'absurdes', 'farfelus', 'informes',
];

// Ce que dit une fée de niveau 15 ou plus qui rêve d'ailleurs. Le message
// revient un jour sur $moral : plus elle est heureuse, moins elle insiste.
const ENVIES_DE_PARTIR = [
  '$ aimerait pouvoir partir vers de nouveaux horizons...',
  'Lassée des batailles contre les démons, $ se plaît de moins en moins à vos côtés.',
  '$ rêve chaque nuit de commencer une nouvelle vie.',
  '$ semble fatiguée par vos dernières aventures.',
  '$ souhaite que vous lui rendiez sa liberté.',
  '$ a le mal du pays...',
  '$ aimerait pouvoir revoir sa ville natale.',
  'Les amies de $ semblent lui manquer de plus en plus.',
  'Après une multitude d\'aventures à vos côtés, $ aspire finalement à un peu plus de tranquillité.',
  '$ est satisfaite du chemin parcouru à vos côtés. Désormais son vœu le plus cher est de pouvoir rejoindre ses sœurs.',
];

const nombre = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const borner = (a, v, b) => Math.min(Math.max(a, v), b);

// Les outils de tirage, autour d'un générateur qui rend [0,1[.
function tirages(alea) {
  const reel = alea || Math.random;
  const entier = (n) => Math.floor(reel() * n);
  const choisir = (l) => l[entier(l.length)];
  return { reel, entier, choisir };
}

/**
 * Item.getSortedList — tous les objets et tous les aliments, du plus banal au
 * plus rare. Le score est `(niveau × 3) / (fréquence + 1)` : un objet fréquent
 * et de bas niveau vaut peu, un objet rare et tardif vaut beaucoup. C'est cette
 * liste que Gromelin pioche pour ses récompenses, d'autant plus loin que la
 * mission est dure.
 */
function listeTriee() {
  const l = [];
  for (const o of E.OBJETS) l.push({ id: o.id, score: (o.lvl * 3) / (o.freq + 1) });
  for (const o of E.NOURRITURE) l.push({ id: o.id, score: (o.lvl * 3) / (o.freq + 1) });
  l.sort((a, b) => a.score - b.score);
  return l;
}

/**
 * Cm.getRainbowItem — ce que l'arc-en-ciel dépose.
 *
 * Le troisième sac gagné, il ne donne plus que des potions de mana (83) : c'est
 * la seule source régulière du jeu, et elle n'arrive qu'une fois l'inventaire
 * au complet.
 */
function objetArcEnCiel(carte, entier) {
  if (nombre(carte.$bag) === 3) return 83;
  const rnd = entier(100);
  if (rnd < 20) return 72;
  if (rnd < 50) return 60 + Math.round((rnd - 20) / 3);
  return 71;
}

/**
 * Cm.genMissions — six missions, une par durée. Plus la mission est longue,
 * plus elle peut être difficile ; plus elle est difficile, plus la récompense
 * est piochée loin dans la liste triée.
 *
 * Chaque mission est un quintuplet [difficulté, type, jours, cadeau, graine].
 * La graine sert au texte : c'est elle qui choisit le voleur, le royaume et
 * l'objet perdu, et c'est pour ça qu'une mission raconte toujours la même
 * histoire d'une visite à l'autre.
 */
function genererMissions(carte, alea) {
  const { reel, entier } = tirages(alea);
  const cadeaux = listeTriee();
  carte.$mission = [];
  for (let i = 0; i < MISSION_DUREES.length; i++) {
    const dif = entier(Math.min(i * 2, 6));
    const coef = (dif * 2 + i + reel()) / 18;
    const cadeau = cadeaux[Math.min(cadeaux.length - 1, Math.floor(coef * cadeaux.length))];
    carte.$mission.push([dif, entier(NB_TYPES_MISSION), MISSION_DUREES[i], cadeau.id, entier(10000)]);
  }
  return carte.$mission;
}

/**
 * Cm.validateMission — l'échéance est là. Les fées reviennent, et le cadeau
 * arrive s'il y a de la place. Sinon il part « à l'AFD » : le jeu ne le garde
 * pas en attente, et c'est une vraie perte.
 */
function validerMission(carte, id, dire) {
  const mis = carte.$mis[id];
  if (!mis) return null;
  const revenues = [];
  for (const fs of (carte.$faerie || [])) {
    if (fs.$mission === id) { fs.$mission = null; revenues.push(fs); }
  }
  const groupe = revenues.map((f) => f.$name).reduce((s, v, i) => {
    if (i === 0) return v;
    return s + (i === revenues.length - 1 ? ' et ' : ', ') + v;
  }, '');
  const pluriel = revenues.length > 1;

  let texte;
  if (mis.$gift !== null && mis.$gift !== undefined) {
    const it = O.info(mis.$gift);
    texte = 'Félicitations !\n' + groupe + (pluriel ? ' ont ' : ' a ') + mis.$string
      + '\nVous avez gagné l\'objet suivant : ' + (it ? it.nom : '?') + ' !';
    if (P.ramasser(carte, mis.$gift) === 'perdu') {
      texte += '\nMalheureusement, vous n\'aviez pas assez de place dans votre inventaire '
        + 'pour cet objet. Il a donc été généreusement offert à l\'AFD '
        + '( Association des Fées Démunies ) qui vous remercie chaleureusement pour ce don.';
    }
  } else {
    texte = groupe + (pluriel ? ' n\'ont ' : ' n\'a ') + mis.$string;
  }
  if (dire) dire(texte);

  // La mission part, et les index des fées se recalent derrière elle.
  carte.$mis.splice(id, 1);
  for (const fs of (carte.$faerie || [])) {
    if (nombre(fs.$mission) > id) fs.$mission--;
  }
  return texte;
}

/**
 * Cm.upkeep — UNE nuit.
 *
 * @returns {{messages: string[], nouvellesFees: number}} ce que le joueur lira
 *          à son retour, dans l'ordre où le jeu l'aurait dit.
 */
function entretien(carte, alea) {
  const t = tirages(alea);
  const messages = [];
  const dire = (s) => { if (s) messages.push(s); };
  const jour = nombre(carte.$time && carte.$time.$d);

  // ── 1. LES FÉES ──
  // On prend une copie : une cannibale peut en effacer une autre en route, et
  // l'original ne parcourt jamais la liste vivante.
  const ctx = {
    carte,
    jour,
    entier: t.entier,
    choisir: t.choisir,
    effacer: (fs) => effacerFee(carte, fs),
    nomObjet: (id) => { const it = O.info(id); return it ? it.nom : '?'; },
  };
  for (const fs of (carte.$faerie || []).slice()) {
    // Une fée partie en mission est ailleurs : elle ne mange pas, ne déprime
    // pas, ne vole personne.
    if (fs.$mission !== null && fs.$mission !== undefined) continue;
    if (indexFee(carte, fs) === null) continue;      // déjà dévorée cette nuit
    const fi = new F.Fee(fs, t.reel, carte);
    const libre = nombre(carte.$current) !== indexFee(carte, fs);
    const r = fi.entretien(libre, ctx);
    for (const m of fi.messages) dire(m);
    if (r.partie) effacerFee(carte, fs);
  }

  // ── 2. LE BASSIN ──
  // Il faut au moins deux nuits pour qu'une lueur ait une chance d'apparaître,
  // et elle ne tient qu'une nuit. Sauf si le joueur n'a AUCUNE fée : alors elle
  // s'allume à coup sûr, sans quoi une partie perdue serait sans issue.
  const pond = carte.$pond;
  pond.$d = nombre(pond.$d) + 1;
  let nouvellesFees = 0;
  if (!pond.$fs) {
    if ((pond.$d > 2 && t.entier(2) === 0) || (carte.$faerie || []).length === 0) {
      pond.$d = 0;
      pond.$fs = F.genererGraine(t.reel);
      // La QUALITÉ monte avec l'ancienneté de la partie : `random($jour)^0,3 - 1`,
      // plafonnée à cinq. Une fée trouvée au bout d'un an vaut bien mieux qu'une
      // fée du premier jour.
      pond.$q = Math.floor(borner(0, Math.pow(t.entier(Math.max(1, jour)), 0.3) - 1, 5));
      for (let i = 0; i < pond.$q; i++) {
        // Une chance sur cent : un OBJET plutôt qu'un point. Il vaut deux points
        // de qualité — d'où le second `i++`.
        if (t.reel() > 0.99) { i++; pond.$fs.$inv.push(null); }
        else pond.$fs.$carac[t.entier(6)]++;
      }
      nouvellesFees++;
      dire('On peut apercevoir une lueur étrange au fond du bassin...');
    }
  } else if (pond.$d > 1) {
    pond.$d = 0;
    pond.$fs = null;
    pond.$q = null;
    dire('La lueur du bassin s\'est éteinte cette nuit.');
  }

  // ── 3. LE DONJON ──
  // Il se construit à la course : (rang+1)² × 5 000 niveaux parcourus, et
  // jamais moins de cinq jours après le précédent.
  const don = carte.$dungeon;
  if (nombre(don.$lvl) < DONJON_MAX && !don.$f) {
    if (Math.pow(nombre(don.$lvl) + 1, 2) * 5000 < nombre(carte.$stat.$run)
      && (jour - nombre(don.$day)) > 4) {
      don.$f = true;
      dire('Une ' + DONJONS[nombre(don.$lvl)] + ' a été construite pendant la nuit. '
        + 'Des êtres ' + t.choisir(ADJECTIFS) + ' semblent rôder autour de celle-ci...');
    }
  }

  // ── 4. LES FÉES QUI RÊVENT D'AILLEURS ──
  for (const fs of (carte.$faerie || [])) {
    const moral = nombre(fs.$moral);
    if (nombre(fs.$level) >= 15 && moral > 0 && jour % moral === 0) {
      dire(t.choisir(ENVIES_DE_PARTIR).split('$').join(fs.$name));
    }
  }

  // ── 5. L'ARC-EN-CIEL ──
  // Il ne dure qu'une journée, et il faut au moins quatre nuits pour le revoir.
  const arc = carte.$rainbow;
  if (arc.$day !== null && arc.$day !== undefined) {
    arc.$day = nombre(arc.$day) + 1;
    if (arc.$f) {
      if (arc.$day > 0) { arc.$day = 0; arc.$f = false; }
    } else if (arc.$day > 3 && t.entier(2) === 0) {
      arc.$day = 0;
      arc.$f = true;
      arc.$it = objetArcEnCiel(carte, t.entier);
      dire('Il y a un magnifique arc-en-ciel, ce matin !');
    }
  }

  // ── 6. LE VENT ──
  // Il ne sert qu'au décor du menu — mais il tourne toutes les nuits, et c'est
  // ce qui fait que le moulin ne va jamais tout à fait à la même vitesse.
  carte.$wind = Math.floor(t.reel() * 100) / 100;

  // ── 7. LES MISSIONS ──
  if (nombre(carte.$stat.$run) > MISSION_SEUIL_COURSE && (carte.$faerie || []).length > 0) {
    genererMissions(carte, t.reel);
  }
  for (let i = 0; i < carte.$mis.length; i++) {
    const m = carte.$mis[i];
    m.$d = nombre(m.$d) - 1;
    if (m.$d === 0) { validerMission(carte, i, dire); i--; }
  }

  return { messages, nouvellesFees };
}

// Cm.getFaerieIndex
function indexFee(carte, fs) {
  const i = (carte.$faerie || []).indexOf(fs);
  return i < 0 ? null : i;
}

// FaerieInfo.erase — la fée quitte la fiche, et `$current` se recale pour ne
// pas désigner sa voisine.
function effacerFee(carte, fs) {
  const index = indexFee(carte, fs);
  if (index === null) return false;
  if (nombre(carte.$current) === index) carte.$current = null;
  else if (carte.$current !== null && carte.$current !== undefined
    && nombre(carte.$current) > index) carte.$current--;
  carte.$faerie.splice(index, 1);
  return true;
}

/**
 * Cm.updateTime — le retour du joueur.
 *
 * On additionne le temps écoulé depuis la dernière visite et on fait passer
 * autant de nuits qu'il y a de journées entières. `$s` garde le reste, si bien
 * que l'heure de la nuit ne dérive pas d'une visite à l'autre.
 *
 * `limite` borne le nombre de nuits jouées d'un coup : une fiche dont l'horloge
 * serait revenue à zéro demanderait cinquante-six ans de nuits, et le
 * navigateur y resterait. Passé la limite, on saute au bon jour sans jouer les
 * nuits — ce que le jeu d'origine n'avait pas à craindre.
 */
function passerLeTemps(carte, maintenant, alea, limite) {
  const max = (limite === undefined) ? 400 : limite;
  const t = nombre(maintenant);
  const ecoule = t - nombre(carte.$time.$t);
  carte.$time.$t = t;
  carte.$time.$s = nombre(carte.$time.$s) + ecoule;

  let nuits = 0;
  const messages = [];
  let nouvellesFees = 0;
  while (carte.$time.$s > JOUR) {
    carte.$time.$s -= JOUR;
    carte.$time.$d = nombre(carte.$time.$d) + 1;
    nuits++;
    if (nuits > max) continue;              // on avance la date, on ne joue plus
    const r = entretien(carte, alea);
    for (const m of r.messages) messages.push(m);
    nouvellesFees += r.nouvellesFees;
  }
  return { nuits, jouees: Math.min(nuits, max), messages, nouvellesFees };
}

const API = {
  passerLeTemps, entretien, genererMissions, validerMission, objetArcEnCiel,
  listeTriee, effacerFee, indexFee,
  JOUR, MISSION_DUREES, NB_TYPES_MISSION, DONJON_MAX, DONJONS, ADJECTIFS,
  MISSION_SEUIL_COURSE, ENVIES_DE_PARTIR,
};

if (typeof module !== 'undefined' && module.exports) module.exports = API;
else racine.MinipixizNuit = API;

})(typeof window !== 'undefined' ? window : globalThis);
