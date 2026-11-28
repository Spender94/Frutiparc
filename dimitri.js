'use strict';
/*
 * Dimitri — le bookmaker du parc, toujours ravi.
 *
 * Il tient LE sujet des paris, dans Jeux Frutiparc : « Les paris du parc :
 * pronostics, débats et gros coups ». Un sujet de discussion comme un autre —
 * chacun y donne ses pronostics, discute des cotes, commente les tournois —
 * qu'il ouvre lui-même au démarrage du serveur s'il n'existe pas. Et quand un
 * pari rapporte gros (tournoi ou Challenge), il y annonce le coup en citant
 * le parieur (@mention : il est prévenu) : la mise, la cote, le gain.
 * Plusieurs gros coups réglés ensemble (le roll de minuit) font UN message,
 * et il ne poste qu'un message par jour : la suite du jour le complète
 * (completerMessageDuJour).
 *
 * Le tirage des phrases est SEMÉ par les paris eux-mêmes : le même lot rejoué
 * donne le même texte, et les tests peuvent le vérifier.
 *
 * Ce module ne touche ni la base ni le forum : il rend du texte. C'est
 * server.js (dimitriAnnoncer) qui le poste.
 *
 * DEUX LANGUES, UN MESSAGE. Dimitri parle à tout le monde : son message porte
 * le français, puis une version anglaise en italique sous un trait
 * (forumBilingue.js). `messageGrosCoups` et `messageMois` prennent la langue
 * (« fr » par défaut) ; le tirage ne dépend que des paris, les deux versions
 * disent donc la même chose — chaque phrase a sa traduction au même rang
 * (zone « forumbots »). `completerMessageDuJour` complète chaque moitié.
 */
const EN = require('./i18n-serveur/outils-en.js');
const { traduire, postBilingue, separerBilingue } = require('./forumBilingue.js');

// La clé du compte porte un tiret : aucun joueur ne peut s'inscrire sous ce
// pseudo (les pseudos sont en [a-zA-Z0-9_]) — un « Dimitri » du parc garde le sien.
const PSEUDO_NPC = 'dimitri-pnj';
const NOM = 'Dimitri';
const BOUILLE = '0o0000000000000000000000';
const HUMEUR = 4;                       // « Joie » : la bouille ravie
const RUBRIQUE = 'Jeux Frutiparc';
const SUJET = 'Les Prunostics du parc : débats, pronos et gros coups';

const INTRO = `Bonjour bonjour ! Moi c'est ${NOM}, je tiens le comptoir des paris du parc.\n\n`
  + `Ce sujet est le vôtre : on y parle [b]paris[/b], tout simplement. Vos pronostics pour le Challenge de demain, `
  + `les favoris des tournois, les cotes qui vous paraissent trop belles (ou pas assez), vos stratégies, vos regrets… `
  + `Débattez, commentez, chambrez-vous gentiment !\n\n`
  + `Et chaque fois que quelqu'un réussit un [b]gros coup[/b] — un pari qui rapporte gros, sur un tournoi ou sur les `
  + `médaillés du Challenge —, je viens l'annoncer ici : le parieur, sa mise, la cote et ce qu'il a empoché.\n\n`
  + `Et au début de chaque mois, je sacre le [b]Prunostiqueur du mois[/b] : celui qui a gagné le plus de kikooz en pariant. `
  + `Il rafle la cagnotte et porte le titre tout le mois suivant !\n\n`
  + `Pour parier : l’icône « Prunostics » du bureau. Son onglet « Registre » garde la trace de tous vos paris. `
  + `À vos pronostics, je suis ravi d'avance !`;

const OUVERTURES_UN = [
  () => `Ah ça, c'est un gros coup !`,
  () => `Incroyable, incroyable !`,
  () => `On applaudit bien fort !`,
  () => `Je n'en reviens pas, et pourtant j'en ai vu passer des paris !`,
  () => `Oh la belle affaire !`,
  () => `Messieurs-dames, un gros coup vient de tomber !`,
  () => `Quel flair !`,
  () => `Le comptoir tremble encore !`,
];
const OUVERTURES_PLUSIEURS = [
  (n) => `Quelle soirée au comptoir : ${n} gros coups d'un seul coup !`,
  (n) => `Oh là là, ${n} gros coups à annoncer ! Je ne sais plus où donner de la tête.`,
  (n) => `Pluie de kikooz sur le parc : ${n} gros coups !`,
  (n) => `On n'arrête plus les parieurs : ${n} gros coups à fêter !`,
];
const CHUTES = [
  () => `Chapeau bas !`,
  () => `Bravo, et à la prochaine !`,
  () => `Qui dit mieux ?`,
  () => `Le comptoir est ravi, la caisse un peu moins.`,
  () => `Je vais devoir recompter mes kikooz…`,
  () => `Les paris restent ouverts : à qui le tour ?`,
  () => `De quoi faire un tour à la boutique !`,
];

function hacher(texte) {
  let h = 2166136261;
  for (let i = 0; i < texte.length; i++) { h ^= texte.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function tirageSeme(graine) {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const choisirRang = (tirage, liste) => Math.floor(tirage() * liste.length) % liste.length;
const nombre = (n) => Number(n || 0).toLocaleString('fr-FR');
const cote = (c) => '×' + String(c).replace('.', ',');
// La phrase tirée dans une liste, dans la langue (forumbots.dimitri.<groupe>.<rang>).
function dire(lang, tirage, groupe, liste, arg, params) {
  const i = choisirRang(tirage, liste);
  return traduire(lang, `forumbots.dimitri.${groupe}.${i}`, liste[i](arg), params);
}

/**
 * Une ligne par coup. `c` : { parieur, quoi, mise, cote, gain }
 *   `quoi` : ce qu'il avait vu (« Myrtille en or à Swapou 2 », « Papaye
 *   contre Goyave, sur Papaye »…), `cote` facultative (pari mutuel : elle est
 *   le rapport gain / mise).
 */
function ligne(c, lang) {
  const k = c.cote != null ? Number(c.cote) : (Number(c.mise) ? Math.round((Number(c.gain) / Number(c.mise)) * 100) / 100 : null);
  const fr = `@${c.parieur} avait misé ${nombre(c.mise)} kikooz sur ${c.quoi}${k ? `, à ${cote(k)}` : ''} : `
    + `[b]${nombre(c.gain)} kikooz[/b] empochés !`;
  return traduire(lang, 'forumbots.dimitri.ligne', fr, { parieur: c.parieur, mise: c.mise, quoi: c.quoi, cote: k, gain: c.gain });
}

/**
 * Le message d'un lot de gros coups, du plus gros au plus petit.
 * @param {Array<{id, parieur, quoi, mise, cote, gain}>} coups — `quoi` dans
 *   la langue demandée
 * @param {string} [lang] — « fr » par défaut
 */
function messageGrosCoups(coups, lang) {
  const liste = (coups || []).slice().sort((a, b) => (Number(b.gain) - Number(b.mise)) - (Number(a.gain) - Number(a.mise)));
  if (!liste.length) return '';
  const tirage = tirageSeme(hacher(liste.map((c) => `${c.id}:${c.parieur}:${c.gain}`).join('|')));
  const l = [];
  if (liste.length === 1) {
    l.push(dire(lang, tirage, 'ouvertureUn', OUVERTURES_UN));
    l.push('');
    l.push(ligne(liste[0], lang));
  } else {
    l.push(dire(lang, tirage, 'ouverturePlusieurs', OUVERTURES_PLUSIEURS, liste.length, { n: liste.length }));
    l.push('');
    for (const c of liste) l.push('• ' + ligne(c, lang));
  }
  l.push('');
  l.push(dire(lang, tirage, 'chute', CHUTES));
  return l.join('\n');
}

/**
 * Le Prunostiqueur du mois, au début du mois suivant.
 * @param {{ mois: string, cle: string, gagnant: {nom, net, paris, gagnes}, suivants: Array<{nom, net}>,
 *           objet: string|null, cagnotte: number, titre: string|null }} s
 *   `mois` : « septembre 2026 » (il sème aussi le tirage : le même dans les
 *   deux langues) ; `cle` : « 2026-09 », pour le dire dans une autre langue ;
 *   `objet` : l'objet de la boutique offert, s'il y en a un ; `titre` : le
 *   frutijob qu'il porte tout le mois qui commence, dans la langue demandée.
 * @param {string} [lang] — « fr » par défaut
 */
function messageMois(s, lang) {
  const g = s.gagnant;
  const tirage = tirageSeme(hacher(`mois:${s.mois}:${g.nom}:${g.net}`));
  const ouvertures = [
    () => `Roulement de tambour… le [b]Prunostiqueur du mois[/b] est connu !`,
    () => `Le comptoir a fait ses comptes, et le [b]Prunostiqueur du mois[/b], c'est…`,
    () => `Mesdames et messieurs, voici le [b]Prunostiqueur du mois[/b] !`,
  ];
  const l = [dire(lang, tirage, 'mois.ouverture', ouvertures), ''];
  l.push(traduire(lang, 'forumbots.dimitri.mois.gagnant',
    `@${g.nom}, avec [b]+${nombre(g.net)} kikooz[/b] de bénéfice en ${s.mois} (${g.gagnes} pari${g.gagnes > 1 ? 's' : ''} gagné${g.gagnes > 1 ? 's' : ''} sur ${g.paris}).`,
    { nom: g.nom, net: g.net, moisCle: s.cle, gagnes: g.gagnes, paris: g.paris }));
  if (s.titre) l.push(traduire(lang, 'forumbots.dimitri.mois.titre', `Tout ce mois-ci, il porte fièrement le titre de [b]${s.titre}[/b] !`, { titre: s.titre }));
  if (s.cagnotte > 0) l.push(traduire(lang, 'forumbots.dimitri.mois.cagnotte', `Et il rafle [b]la cagnotte : ${nombre(s.cagnotte)} kikooz[/b], les mises des pronos que personne n'a vus venir !`, { n: s.cagnotte }));
  if (s.objet) l.push(traduire(lang, 'forumbots.dimitri.mois.objet', `Il repart avec un cadeau du parc : [b]${s.objet}[/b] !`, { objet: s.objet }));
  const suivants = (s.suivants || []).filter((x) => x && x.net > 0).slice(0, 2);
  if (suivants.length) {
    l.push('');
    l.push(traduire(lang, 'forumbots.dimitri.mois.podium',
      `Sur le podium aussi : ${suivants.map((x, i) => `@${x.nom}, ${i + 2}e (+${nombre(x.net)})`).join(', ')}.`, { suivants }));
  }
  l.push('');
  l.push(dire(lang, tirage, 'mois.chute', [
    () => `Un nouveau mois commence : à vos Prunostics !`,
    () => `Les compteurs sont remis à zéro. Qui fera mieux ce mois-ci ?`,
    () => `Bravo ! Et pour les autres : la revanche commence aujourd'hui.`,
  ]));
  return l.join('\n');
}

/**
 * LE MESSAGE DU JOUR. Dimitri ne poste qu'UN message par jour dans son sujet
 * (le réglage `dimitriCadence` des Prunostics) : ce qu'il a encore à dire le
 * même jour — un gros coup de tournoi l'après-midi, le sacre du mois — vient
 * COMPLÉTER ce message, sous une ligne qui donne l'heure, au lieu d'en poster
 * un autre. Rend le message complété.
 * @param {string} avant — le message du jour, tel qu'il est sur le forum
 * @param {string} ajout — ce que Dimitri veut y ajouter
 * @param {string} heure — « 14 h 05 », heure de Paris
 */
//
// Un message À DEUX LANGUES (forumBilingue.js) se complète moitié par moitié :
// la mise à jour française sous le français, l'anglaise sous l'anglais — le
// message garde un seul bloc anglais, à la fin.
function completerMessageDuJour(avant, ajout, heure) {
  const a = separerBilingue(avant), b = separerBilingue(ajout);
  const fr = `${String(a.fr || '').replace(/\s+$/, '')}\n\n[b]— Mise à jour de ${heure} —[/b]\n\n${b.fr}`;
  if (!a.en && !b.en) return fr;
  const heureEn = String(heure || '').replace(/\s*h\s*/, ':');
  const enAvant = String(a.en || '').replace(/\s+$/, '');
  const en = enAvant
    ? `${enAvant}\n\n[b]${traduire('en', 'forumbots.dimitri.miseAJour', `— Mise à jour de ${heure} —`, { heure: heureEn })}[/b]\n\n${b.en}`
    : b.en;
  return postBilingue(fr, en);
}

// Le message entier, le français puis l'anglais. `fabrique(lang)` rend l'une
// ou l'autre version (messageGrosCoups, messageMois).
function messageBilingue(fabrique) {
  return postBilingue(fabrique('fr'), fabrique('en'));
}

module.exports = { PSEUDO_NPC, NOM, BOUILLE, HUMEUR, RUBRIQUE, SUJET, INTRO, messageGrosCoups, messageMois, completerMessageDuJour, messageBilingue };
