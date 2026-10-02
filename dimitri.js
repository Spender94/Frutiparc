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
 * Plusieurs gros coups réglés ensemble (le roll de minuit) font UN message.
 *
 * Le tirage des phrases est SEMÉ par les paris eux-mêmes : le même lot rejoué
 * donne le même texte, et les tests peuvent le vérifier.
 *
 * Ce module ne touche ni la base ni le forum : il rend du texte. C'est
 * server.js (dimitriAnnoncer) qui le poste.
 */

// La clé du compte porte un tiret : aucun joueur ne peut s'inscrire sous ce
// pseudo (les pseudos sont en [a-zA-Z0-9_]) — un « Dimitri » du parc garde le sien.
const PSEUDO_NPC = 'dimitri-pnj';
const NOM = 'Dimitri';
const BOUILLE = '0o0000000000000000000000';
const HUMEUR = 4;                       // « Joie » : la bouille ravie
const RUBRIQUE = 'Jeux Frutiparc';
const SUJET = 'Les paris du parc : pronostics, débats et gros coups';

const INTRO = `Bonjour bonjour ! Moi c'est ${NOM}, je tiens le comptoir des paris du parc.\n\n`
  + `Ce sujet est le vôtre : on y parle [b]paris[/b], tout simplement. Vos pronostics pour le Challenge de demain, `
  + `les favoris des tournois, les cotes qui vous paraissent trop belles (ou pas assez), vos stratégies, vos regrets… `
  + `Débattez, commentez, chambrez-vous gentiment !\n\n`
  + `Et chaque fois que quelqu'un réussit un [b]gros coup[/b] — un pari qui rapporte gros, sur un tournoi ou sur les `
  + `médaillés du Challenge —, je viens l'annoncer ici : le parieur, sa mise, la cote et ce qu'il a empoché.\n\n`
  + `Pour parier : la tuile « Paris » du bureau. Son onglet « Registre » garde la trace de tous vos paris. `
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
const choisir = (tirage, liste) => liste[Math.floor(tirage() * liste.length) % liste.length];
const nombre = (n) => Number(n || 0).toLocaleString('fr-FR');
const cote = (c) => '×' + String(c).replace('.', ',');

/**
 * Une ligne par coup. `c` : { parieur, quoi, mise, cote, gain }
 *   `quoi` : ce qu'il avait vu (« Myrtille en or à Swapou 2 », « Papaye
 *   contre Goyave, sur Papaye »…), `cote` facultative (pari mutuel : elle est
 *   le rapport gain / mise).
 */
function ligne(c) {
  const k = c.cote != null ? Number(c.cote) : (Number(c.mise) ? Math.round((Number(c.gain) / Number(c.mise)) * 100) / 100 : null);
  return `@${c.parieur} avait misé ${nombre(c.mise)} kikooz sur ${c.quoi}${k ? `, à ${cote(k)}` : ''} : `
    + `[b]${nombre(c.gain)} kikooz[/b] empochés !`;
}

/**
 * Le message d'un lot de gros coups, du plus gros au plus petit.
 * @param {Array<{id, parieur, quoi, mise, cote, gain}>} coups
 */
function messageGrosCoups(coups) {
  const liste = (coups || []).slice().sort((a, b) => (Number(b.gain) - Number(b.mise)) - (Number(a.gain) - Number(a.mise)));
  if (!liste.length) return '';
  const tirage = tirageSeme(hacher(liste.map((c) => `${c.id}:${c.parieur}:${c.gain}`).join('|')));
  const l = [];
  if (liste.length === 1) {
    l.push(choisir(tirage, OUVERTURES_UN)());
    l.push('');
    l.push(ligne(liste[0]));
  } else {
    l.push(choisir(tirage, OUVERTURES_PLUSIEURS)(liste.length));
    l.push('');
    for (const c of liste) l.push('• ' + ligne(c));
  }
  l.push('');
  l.push(choisir(tirage, CHUTES)());
  return l.join('\n');
}

module.exports = { PSEUDO_NPC, NOM, BOUILLE, HUMEUR, RUBRIQUE, SUJET, INTRO, messageGrosCoups };
