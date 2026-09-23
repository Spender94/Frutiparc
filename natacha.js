'use strict';
/*
 * Natacha — l'hôtesse d'accueil du parc.
 *
 * À chaque inscription, elle poste un mot de bienvenue dans le forum
 * (Frutiparc › Frutiz › « Bienvenue aux nouveaux Frutiz ! »). Un même mot pour
 * tout le monde ferait vite tapisserie : le message se compose donc de
 * morceaux tirés au sort — une ouverture, puis selon le cas un clin d'œil à
 * l'heure ou au jour, au parrain, au numéro d'arrivée quand il est rond, et
 * un conseil pour les premiers pas. Deux cents façons de dire bienvenue, sans
 * jamais mentir : tout ce qu'elle avance vient de l'inscription elle-même.
 *
 * Le tirage est SEMÉ par le pseudo et le jour : la même inscription rejouée
 * (un serveur redémarré au mauvais moment) donne le même message, et les
 * tests peuvent vérifier un texte.
 *
 * Ce module ne touche ni la base ni le forum : il rend du texte. C'est
 * server.js (natachaAccueillir) qui le poste.
 */

const PSEUDO_NPC = 'natacha';
const NOM = 'Natacha';
const BOUILLE = '0o0000010000000000000000';       // famille 24
const RUBRIQUE = 'Frutiz';
const SUJET = 'Bienvenue aux nouveaux Frutiz !';

// Le premier message du sujet — quand elle l'ouvre (ou le rouvre, plein).
const INTRO = `Coucou ! Moi c'est ${NOM}, je tiens l'accueil du parc.\n\n`
  + `Chaque fois qu'un Frutiz s'inscrit, je le salue ici — comme ça, personne n'arrive dans le silence. `
  + `Si vous passez par là, un petit mot aux nouveaux fait toujours plaisir : c'est comme ça qu'on a tous commencé.\n\n`
  + `(Et si vous venez d'arriver : bienvenue ! Le salon Pomme est juste à côté, on ne mord pas.)`;

// ── Les morceaux ───────────────────────────────────────────────────────────
// `p` est la mention (« @Pseudo ») ; chaque morceau est une phrase complète.
const OUVERTURES = [
  (p) => `Bienvenue à ${p} qui vient de rejoindre Frutiparc Revival !`,
  (p) => `Un nouveau Frutiz parmi nous : bienvenue ${p} !`,
  (p) => `${p} vient d'arriver au parc. Bienvenue !`,
  (p) => `Faites de la place, ${p} débarque à Frutiparc Revival !`,
  (p) => `Une nouvelle bouille dans le parc : ${p} nous rejoint. Bienvenue !`,
  (p) => `${p} pousse la porte du parc. Entre, entre, c'est ouvert !`,
  (p) => `Le parc s'agrandit : ${p} vient de s'inscrire. Bienvenue !`,
  (p) => `Bienvenue ${p} ! On t'attendait (si, si).`,
  (p) => `${p} est des nôtres depuis quelques secondes à peine. Bienvenue à Frutiparc Revival !`,
  (p) => `Un Frutiz de plus, ${p} ! Bienvenue au parc !`,
  (p) => `Applaudissements pour ${p}, tout juste inscrit(e) ! Bienvenue !`,
  (p) => `Tiens, du nouveau à l'accueil : ${p} rejoint Frutiparc Revival. Bienvenue !`,
  (p) => `${p} a signé le registre du parc. Bienvenue parmi les Frutiz !`,
  (p) => `Et un ballon de plus dans le ciel du parc : bienvenue ${p} !`,
];

const MOMENTS = {
  nuit: [
    () => `Un Frutiz de nuit ! Les insomniaques sont chez eux ici.`,
    () => `Inscription nocturne : le parc ne dort jamais, toi non plus visiblement.`,
    () => `À cette heure-ci, c'est calme au parc — tu vas pouvoir tout visiter tranquillement.`,
  ],
  matin: [
    () => `Café ou chocolat chaud ? L'accueil offre les deux (virtuellement).`,
    () => `Le parc vient d'ouvrir ses grilles, tu es parmi les premiers de la journée.`,
    () => `Belle façon de commencer la matinée.`,
  ],
  midi: [
    () => `Pile à l'heure du déjeuner — les jeux se jouent très bien avec un sandwich.`,
    () => `Inscription de midi : le parc est en pleine effervescence.`,
  ],
  apresmidi: [
    () => `L'après-midi, c'est le meilleur moment pour les salons : il y a du monde.`,
    () => `Le soleil est haut sur le parc, profites-en.`,
  ],
  soir: [
    () => `Le parc est ouvert toute la nuit, fais comme chez toi.`,
    () => `C'est le soir que le parc s'anime le plus — tu tombes bien.`,
    () => `Soirée au parc : les salons sont pleins, les scores tombent à minuit.`,
  ],
};
const WEEKEND = [
  (j) => `Un ${j} au parc, ça commence bien.`,
  (j) => `Inscription de ${j} : le week-end, le parc tourne à plein régime.`,
];

const JALONS = [
  (n) => `Et pas n'importe lequel : ${n}e Frutiz du parc, ça se fête !`,
  (n) => `Tu es le ${n}e Frutiz inscrit — un chiffre rond, un jour à marquer d'une pierre blanche.`,
  (n) => `${n} Frutiz avec toi. Le compteur de l'accueil en a le tournis.`,
];

const PARRAINAGES = [
  (m) => `Amené(e) par ${m}, qu'on remercie au passage.`,
  (m) => `C'est ${m} qui nous l'envoie. Les bons parrains font les bons parcs.`,
  (m) => `Filleul(e) de ${m}, donc déjà en bonne compagnie.`,
];

const CONSEILS = [
  () => `Passe faire coucou dans le salon Pomme, c'est là que tout commence.`,
  () => `Pense à te faire une bouille dans le Bouilloscope : c'est ton visage au parc.`,
  () => `Les jeux sont dans le parc, et les classements repartent chaque soir à minuit.`,
  () => `Si tu as connu l'époque, raconte-nous : on adore les vieilles histoires.`,
  () => `Un doute, une question ? Ce forum est là pour ça, et les anciens répondent vite.`,
  () => `Chaque jour, tes premières parties rapportent de l'XP — pas la peine de tout faire d'un coup.`,
  () => `Ajoute tes amis en contacts : le parc est plus drôle à plusieurs.`,
  () => `Les kikooz se gagnent en jouant ; la boutique attendra que tu aies fait le tour.`,
  () => `Le règlement tient en une ligne : on est gentil. Ça suffit à tout.`,
  () => `Explore sans peur : on ne peut rien casser, sauf des records.`,
];

// ── Le tirage ──────────────────────────────────────────────────────────────
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

// L'heure et le jour, à Paris.
function momentDe(date) {
  const parts = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: 'numeric', hourCycle: 'h23', weekday: 'long' }).formatToParts(date);
  const heure = Number((parts.find((x) => x.type === 'hour') || {}).value || 12);
  const jour = String((parts.find((x) => x.type === 'weekday') || {}).value || '');
  const moment = heure < 6 ? 'nuit' : heure < 11 ? 'matin' : heure < 14 ? 'midi' : heure < 18 ? 'apresmidi' : 'soir';
  return { heure, jour, moment, weekend: jour === 'samedi' || jour === 'dimanche' };
}
function jourIso(date) {
  return new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/**
 * Le mot de bienvenue pour `pseudo` (tel qu'affiché : la casse est la
 * sienne). `infos` : { date, numero, parrain, tirage } — tous facultatifs :
 * `numero` est le rang d'inscription (on ne le cite que rond), `parrain` le
 * pseudo affiché du parrain, `tirage` une fonction [0, 1) pour les tests.
 */
function messageBienvenue(pseudo, infos) {
  const o = infos || {};
  const date = o.date instanceof Date ? o.date : new Date();
  const tirage = typeof o.tirage === 'function' ? o.tirage : tirageSeme(hacher(String(pseudo).toLowerCase() + '|' + jourIso(date)));
  const p = '@' + String(pseudo);
  const m = momentDe(date);
  const phrases = [choisir(tirage, OUVERTURES)(p)];
  const numero = Number(o.numero) || 0;
  const rond = numero >= 100 && (numero % 100 === 0);
  if (rond) phrases.push(choisir(tirage, JALONS)(numero));
  if (o.parrain) phrases.push(choisir(tirage, PARRAINAGES)('@' + String(o.parrain)));
  // Un clin d'œil au moment (quatre fois sur dix), un conseil (six fois sur
  // dix) — et au moins l'un des deux quand l'ouverture serait seule, pour
  // que le mot fasse toujours deux phrases.
  const rienDautre = phrases.length === 1;
  const clin = tirage() < 0.4, conseil = tirage() < 0.6;
  const moment = () => (m.weekend && tirage() < 0.5 ? choisir(tirage, WEEKEND)(m.jour) : choisir(tirage, MOMENTS[m.moment])());
  if (clin) phrases.push(moment());
  if (conseil) phrases.push(choisir(tirage, CONSEILS)());
  if (rienDautre && !clin && !conseil) phrases.push(tirage() < 0.5 ? moment() : choisir(tirage, CONSEILS)());
  return phrases.join(' ');
}

module.exports = { PSEUDO_NPC, NOM, BOUILLE, RUBRIQUE, SUJET, INTRO, messageBienvenue, momentDe, OUVERTURES, CONSEILS, MOMENTS, JALONS, PARRAINAGES };
