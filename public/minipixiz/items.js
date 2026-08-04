/*
 * Minipixiz — les objets, et ce qu'ils font.
 *
 * La forêt en fait déjà tomber ; jusqu'ici ils dormaient dans la fiche. Ce
 * fichier porte Item.newIt et les onze classes de it/ : ce qu'est un objet, ce
 * qu'il fait, et à qui.
 *
 * ── Trois façons d'agir, et c'est tout le système ──
 *
 * flGeneral  il agit à l'instant du ramassage et ne va pas dans l'inventaire :
 *            la clé monte le trousseau, le sac remplace le précédent.
 * flEquip    il agit tant qu'une fée le PORTE. FaerieInfo.initItems relit le
 *            sac de la fée à chaque fois qu'on la charge et rejoue ses effets —
 *            il n'y a donc rien à « équiper », porter suffit.
 * flUse      il se consomme : la potion rend des cœurs, la nourriture nourrit.
 *
 * Et une quatrième, discrète mais décisive : un objet resté dans le sac DU
 * JOUEUR agit sur TOUTES les fées (groupEffect) — c'est ce qui distingue le
 * globe du gant, et le grimoire du parchemin.
 *
 * ── Les familles, par plage d'identifiant (Item.newIt) ──
 *
 *     0..29    caractéristique (+1, +2, +3 sur l'une des six)
 *     30       bocal · 31 clé de donjon
 *     40..49   pouvoir spécial
 *     50..59   globe : +1 à toutes les fées
 *     60..69   coloration de cheveux
 *     70..79   potion
 *     80..89   sac
 *     100..199 parchemin de sort (la porteuse le lance)
 *     200..299 grimoire de sort (toutes le lancent)
 *     300..399 nourriture
 */
'use strict';

(function (racine) {

const CARAC = { FORCE: 0, RAPIDITE: 1, VIE: 2, INTELLIGENCE: 3, CONCENTRATION: 4, MANA: 5 };
const NOM_CARAC = ['force', 'rapidité', 'vie', 'intelligence', 'concentration', 'mana'];

// it.Carac.nameList — trois qualités par caractéristique, puis deux places
// vides que le jeu n'a jamais remplies (les « f4 », « r5 »… du fichier).
const NOM_OBJET_CARAC = [
  'Gant de cuir', 'Gantelet en fer', 'Brassard du dragon', null, null,
  'Chaussures grossières', 'Souliers cursifs', 'Ballerines du sirocco', null, null,
  'Racine primordiale', 'Cocarde tenace', 'Couronne gauloise', null, null,
  'Perles de discernement', 'Bracelet siméen', 'Jade de clairvoyance', null, null,
  'Tanagra d\'argile', 'Tanagra d\'émeraude', 'Tanagra de granite', null, null,
  'Améthyste', 'Aigue-marine', 'Rubis du dragon', null, null,
];

// it.SpecialPower — les sept pouvoirs, et ce qu'ils changent pour la fée.
const POUVOIRS = [
  { nom: 'Poudre d\'invisibilité', desc: 'Votre fée devient semi-transparente, elle sera donc plus difficile à toucher.' },
  { nom: 'Masque tribal', desc: 'Votre fée effraie les démons.' },
  { nom: 'Ankh sylvaine', desc: 'Votre fée reconstitue l\'énergie d\'un cœur blessé au cours du jeu.' },
  { nom: 'Azur d\'Avalon', desc: 'Votre fée reconstitue plus vite ses réserves de mana.' },
  { nom: 'Calice hatalan', desc: 'Votre fée apprend plus vite de ses expériences.' },
  { nom: 'Serre-tête à corne', desc: 'Votre fée charge plus souvent, et augmente ses dégâts.' },
  { nom: 'Totoche', desc: 'Votre fée ne peut plus parler.' },
];

// it.CaracAll — les globes, qui profitent à toute la volière.
const GLOBES = ['globe de Churele', 'globe de Remesh', 'globe de Mederet',
  'globe de Henata', 'globe de Hastophies', 'globe de Suez'];

// it.Color.COLOR — les dix teintes de cheveux.
const COULEURS_CHEVEUX = [
  0xFF6600, 0xFF9900, 0xFFCC00, 0xFFFF00, 0x99FF00,
  0x22DD00, 0x00BBFF, 0x5566FF, 0x7700EE, 0xFF22EE,
];

// it.Potion — un cœur, trois cœurs, tous.
const POTIONS = [
  { nom: 'Petite potion', desc: 'En la buvant votre fée récupère 1 cœur.', soin: 1 },
  { nom: 'Potion standard', desc: 'En la buvant votre fée récupère 3 cœurs.', soin: 3 },
  { nom: 'Super potion', desc: 'En la buvant votre fée récupère tous ses cœurs.', soin: 99 },
];

const SACS = ['Sac +1', 'Sac +2', 'Sac +3', 'Sac +4'];

// it.Food.NAME — dix-neuf aliments. Les dix premiers sont ceux que les fées
// peuvent aimer ou détester ; au-delà, ce sont des mets rares qui plaisent
// toujours (FaerieInfo.eat : `id >= 10`).
const ALIMENTS = [
  'Pain', 'Raisin', 'Salade', 'Biscotte', 'Poire',
  'Glace', 'Œuf', 'Gouda', 'Banane', 'Brioche',
  'Barbapapa', 'Nouilles chinoises', 'Poireau', 'Melon', 'Maïs',
  'Cerise', 'Sushi', 'Tarte aux fruits', 'Yakitori',
];

// it.Food.NAME.qt — la forme « quantifiée », celle dont la fée se sert pour
// dire ce qu'elle aime : « Lila aime le pain et les poires. » Les neuf derniers
// aliments n'en ont pas dans le fichier d'origine (« -- »), et c'est sans
// conséquence : les goûts d'une fée ne portent que sur les dix premiers.
const QUANTITE = [
  'le pain', 'le raisin', 'la salade', 'les biscottes', 'les poires',
  'les glaces', 'les œufs', 'le gouda', 'les bananes', 'la brioche',
];

// it.Food.NAME.qt2 — la forme « à l'unité », celle du salut de la fée quand
// l'aliment décolle (reactItem : « Chouette ! une brioche ! »). Dix-neuf
// entrées, comme la table d'origine — c'est la plage exacte des largages.
const ALIMENT_QT2 = [
  'du pain', 'du raisin', 'une salade', 'une biscotte', 'une poire',
  'une glace', 'un oeuf', 'du gouda', 'une banane', 'une brioche',
  'de la barbapapa', 'des nouilles chinoises', 'un poireau', 'un melon', 'du maïs',
  'des cerises', 'des sushis', 'une tarte aux fruits', 'des Yakitori',
];

// Chaque aliment existe en TROIS tailles : la grosse part se mange en trois
// fois. it.Food.use fait `type++` et jette l'objet quand `(type-300)%3` retombe
// à zéro — c'est ce qui fait qu'un pain trouvé nourrit trois soirs.
const TAILLES_ALIMENT = ['grande', 'moyenne', 'petite'];
const PREMIER_ALIMENT = 300;
const IT_BOCAL = 30, IT_CLE = 31, IT_SAC = 80;

const nombre = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * Ce qu'est un objet — Item.newIt, sans le dessin.
 *
 * @param {number} type l'identifiant tel qu'il vit dans la fiche
 * @returns {object|null} sa description, ou null si le type ne veut rien dire
 */
function info(type) {
  const n = nombre(type);
  if (type === null || type === undefined || !Number.isFinite(Number(type))) return null;

  if (n >= 0 && n < 30) {
    const car = Math.floor(n / 5), inc = (n % 5) + 1;
    return {
      type: n, famille: 'carac', car, inc,
      nom: NOM_OBJET_CARAC[n] || (NOM_CARAC[car] + ' +' + inc),
      desc: 'Augmente de ' + inc + ' point' + (inc > 1 ? 's' : '')
        + ' la caractéristique ' + NOM_CARAC[car] + ' de la fée.',
      flEquip: true,
    };
  }
  if (n === IT_BOCAL) {
    return { type: n, famille: 'bocal', nom: 'Bocal résidentiel',
      desc: 'Il sert à abriter les fées.' };
  }
  if (n === IT_CLE) {
    return { type: n, famille: 'cle', nom: 'Clé du donjon',
      desc: 'Elle ouvre la porte du donjon.', flGeneral: true };
  }
  if (n >= 40 && n < 50) {
    const p = POUVOIRS[n - 40];
    if (!p) return null;
    return { type: n, famille: 'pouvoir', id: n - 40, nom: p.nom, desc: p.desc, flEquip: true };
  }
  if (n >= 50 && n < 60) {
    const id = n - 50;
    if (!GLOBES[id]) return null;
    return { type: n, famille: 'globe', id, nom: GLOBES[id],
      desc: 'Augmente de 1 point la caractéristique ' + NOM_CARAC[id] + ' de toutes les fées.' };
  }
  if (n >= 60 && n < 70) {
    const id = n - 60;
    if (COULEURS_CHEVEUX[id] === undefined) return null;
    return { type: n, famille: 'coloration', id, couleur: COULEURS_CHEVEUX[id],
      nom: 'Coloration pour cheveux',
      desc: 'Modifie la couleur des cheveux d\'une fée une fois équipée.', flEquip: true };
  }
  if (n >= 70 && n < 80) {
    const p = POTIONS[n - 70];
    if (!p) return null;
    return { type: n, famille: 'potion', id: n - 70, nom: p.nom, desc: p.desc,
      soin: p.soin, flUse: true };
  }
  if (n >= IT_SAC && n < 90) {
    const id = n - IT_SAC;
    if (!SACS[id]) return null;
    return { type: n, famille: 'sac', id, nom: SACS[id],
      desc: 'Agrandit votre inventaire.', flGeneral: true };
  }
  if (n >= 100 && n < 200) {
    return { type: n, famille: 'parchemin', sort: n - 100, nom: 'Parchemin de sort',
      desc: 'Ce parchemin permet à la fée qui le porte de lancer ce sort.', flEquip: true };
  }
  if (n >= 200 && n < 300) {
    return { type: n, famille: 'grimoire', sort: n - 200, nom: 'Livre de sort',
      desc: 'Ce grimoire permet à toutes les fées de lancer ce sort.' };
  }
  if (n >= PREMIER_ALIMENT && n < 400) {
    const id = Math.floor((n - PREMIER_ALIMENT) / 3);
    const taille = (n - PREMIER_ALIMENT) % 3;
    if (!ALIMENTS[id]) return null;
    return {
      type: n, famille: 'aliment', id, taille,
      nom: ALIMENTS[id], portion: TAILLES_ALIMENT[taille],
      desc: 'La nourriture permet à vos fées de rester en forme et de regagner '
        + 'leurs points de vie plus vite pendant la nuit.',
      flUse: true,
    };
  }
  return null;
}

/**
 * faerieEffect — ce qu'un objet PORTÉ par la fée lui apporte.
 * Appelé par FaerieInfo.initItems à chaque chargement : les effets ne sont
 * jamais écrits dans la fiche, ils se rejouent. Retirer l'objet les annule.
 */
function effetPorte(it, fee) {
  if (!it || !fee) return false;
  switch (it.famille) {
    case 'carac':
      fee.carac[it.car] = nombre(fee.carac[it.car]) + it.inc;
      return true;
    case 'pouvoir':
      fee.pouvoirs[it.id] = true;
      return true;
    case 'coloration':
      fee.couleurCheveux = it.couleur;
      return true;
    case 'parchemin':
      if (fee.sorts.indexOf(it.sort) < 0) fee.sorts.push(it.sort);
      return true;
    default:
      return false;
  }
}

/**
 * groupEffect — ce qu'un objet resté dans le sac DU JOUEUR apporte à CHAQUE
 * fée. C'est toute la différence entre le gant, qu'une seule fée porte, et le
 * globe, qui profite à la volière entière.
 */
function effetGroupe(it, fee) {
  if (!it || !fee) return false;
  switch (it.famille) {
    case 'globe':
      fee.carac[it.id] = nombre(fee.carac[it.id]) + 1;
      return true;
    case 'grimoire':
      if (fee.sorts.indexOf(it.sort) < 0) fee.sorts.push(it.sort);
      return true;
    default:
      return false;
  }
}

/**
 * use(fi) — consommer un objet sur une fée.
 *
 * @returns {{reste:number|null, effet:object}} `reste` est ce que devient
 *   l'objet : une part plus petite pour un aliment, rien pour une potion.
 */
function utiliser(it, fee) {
  if (!it || !fee || !it.flUse) return null;
  if (it.famille === 'potion') {
    const avant = nombre(fee.fs.$life);
    fee.incVie(it.soin);
    return { reste: null, effet: { genre: 'soin', gagne: nombre(fee.fs.$life) - avant } };
  }
  if (it.famille === 'aliment') {
    const r = fee.manger(it.id);
    // it.Food.use : la part rétrécit, et disparaît à la troisième bouchée.
    const suivant = it.type + 1;
    const fini = (suivant - PREMIER_ALIMENT) % 3 === 0;
    return { reste: fini ? null : suivant, effet: { genre: 'repas', aliment: it.id, moral: r.moral } };
  }
  return null;
}

// ── Les sacs ──────────────────────────────────────────────────────────────

// Cs.bagLimit — sans sac, aucune place, et c'est voulu : Item.getRandomId ne
// fait alors tomber que des sacs.
const PLACES_SAC = [0, 4, 6, 8, 9];

function placesJoueur(carte) {
  return PLACES_SAC[Math.max(0, Math.min(nombre(carte && carte.$bag), PLACES_SAC.length - 1))];
}

// Le sac d'une fée : $bagMax places, deux au départ.
function placesFee(fs) {
  return Math.max(0, nombre(fs && fs.$bagMax));
}

// Le contenu d'un sac, trous compris — une place vide est un `null`, pas un
// tassement : le joueur range ses objets où il veut.
function contenu(liste, places) {
  const l = [];
  for (let i = 0; i < places; i++) {
    const v = (Array.isArray(liste) && liste[i] !== undefined) ? liste[i] : null;
    l.push((v === null || v === undefined) ? null : nombre(v));
  }
  return l;
}

/**
 * Déplacer un objet d'un sac à l'autre — ou l'échanger si la case visée est
 * prise, comme la main de l'inventaire du jeu.
 *
 * `sac` vaut 'joueur' ou l'index d'une fée.
 *
 * @returns {boolean} vrai si quelque chose a bougé
 */
function deplacer(carte, de, vers) {
  const lire = (s) => (s.sac === 'joueur'
    ? { liste: (carte.$inv = carte.$inv || []), places: placesJoueur(carte) }
    : (() => {
      const fs = (carte.$faerie || [])[s.sac];
      if (!fs) return null;
      fs.$inv = fs.$inv || [];
      return { liste: fs.$inv, places: placesFee(fs) };
    })());

  const a = lire(de), b = lire(vers);
  if (!a || !b) return false;
  if (de.case < 0 || de.case >= a.places) return false;
  if (vers.case < 0 || vers.case >= b.places) return false;

  const x = (a.liste[de.case] === undefined) ? null : a.liste[de.case];
  const y = (b.liste[vers.case] === undefined) ? null : b.liste[vers.case];
  if (x === null && y === null) return false;
  a.liste[de.case] = y;
  b.liste[vers.case] = x;
  // Les trous se gardent : une place vide au milieu doit rester une place.
  for (const s of [a, b]) {
    for (let i = 0; i < s.places; i++) if (s.liste[i] === undefined) s.liste[i] = null;
    s.liste.length = s.places;
  }
  return true;
}

/**
 * Nourrir une fée, ou lui faire boire une potion — le geste central du jeu.
 *
 * L'objet est pris dans un sac ; ce qu'il en reste y retourne, ou la place se
 * libère. Le compteur d'album ($stat.$eat) monte, et c'est de là que viennent
 * les pictos d'aliments.
 *
 * @returns {{ok:boolean, effet?:object, pictos?:string[], message?:string}}
 */
function donner(carte, source, fee) {
  const liste = source.sac === 'joueur'
    ? (carte.$inv = carte.$inv || [])
    : (((carte.$faerie || [])[source.sac] || {}).$inv);
  if (!Array.isArray(liste)) return { ok: false, message: 'sac introuvable' };
  const it = info(liste[source.case]);
  if (!it || !it.flUse) return { ok: false, message: 'cet objet ne se consomme pas' };
  if (!fee) return { ok: false, message: 'aucune fée' };

  const r = utiliser(it, fee);
  liste[source.case] = r.reste;

  const pictos = [];
  if (it.famille === 'aliment') {
    // Cm.incEatStat : le compteur d'album, et ses trois paliers.
    const s = carte.$stat || (carte.$stat = {});
    if (!Array.isArray(s.$eat)) s.$eat = [];
    s.$eat[it.id] = nombre(s.$eat[it.id]) + 1;
    const n = s.$eat[it.id];
    if (n === 1) pictos.push('$pixiz_food' + (PREMIER_ALIMENT + it.id * 3 + 2));
    if (n === 5) pictos.push('$pixiz_food' + (PREMIER_ALIMENT + it.id * 3 + 1));
    if (n === 20) pictos.push('$pixiz_food' + (PREMIER_ALIMENT + it.id * 3));
  }
  return { ok: true, effet: r.effet, pictos, reste: r.reste };
}

const API = {
  info, effetPorte, effetGroupe, utiliser, deplacer, donner,
  contenu, placesJoueur, placesFee,
  PLACES_SAC, ALIMENTS, QUANTITE, ALIMENT_QT2, TAILLES_ALIMENT, POUVOIRS, GLOBES, POTIONS, SACS,
  COULEURS_CHEVEUX, NOM_OBJET_CARAC, NOM_CARAC, CARAC,
  PREMIER_ALIMENT, IT_BOCAL, IT_CLE, IT_SAC,
};

if (typeof module !== 'undefined' && module.exports) module.exports = API;
else racine.MinipixizObjets = API;

})(typeof window !== 'undefined' ? window : globalThis);
