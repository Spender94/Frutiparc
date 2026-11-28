'use strict';
/*
 * DICTIONNAIRE ANGLAIS DU SERVEUR — L'HISTORIQUE : les entrées de « Mon
 * historique » (niveaux, pictos, médailles, parrainages, sanctions, quêtes,
 * parties en différé…), celles des « Évènements » que le site écrit tout seul
 * (le compte activé, l'anniversaire du jour), et les phrases de l'Historique
 * Kikooz. Le français est écrit dans server.js, là où l'entrée part ; une
 * entrée faite d'un gabarit range sa clé et ses paramètres (user_logs.msg_key,
 * msg_params) et se refait ici, dans la langue du lecteur — y compris après un
 * redémarrage. Voir docs/I18N.md, « Côté serveur ».
 *
 * Ce que les humains tapent (une annonce de l'équipe, un motif de sanction, un
 * titre de sujet, un nom de quiz) arrive en paramètre et ne se traduit pas ;
 * les noms de jeux, de pictos et d'accessoires non plus.
 */
const EN = require('../outils-en.js');

const MEDAILLES = { or: 'gold', argent: 'silver', bronze: 'bronze' };

module.exports = {
  // ── Niveaux, parrainage, connexion ──
  'historique.niveau': 'Well done! You\'ve reached level {niveau}! ({xp} XP)',
  'historique.parrainage': 'Referral ({role}): +{k} kikooz!',
  'historique.role.parrain': 'referrer',
  'historique.role.filleul': 'referral',
  'historique.connexion': 'Daily login: +{k} kikooz!',
  'historique.connexionSerie': 'Daily login ({serie}-day streak): +{k} kikooz!',
  'historique.cadeauSerie': '{serie} days of logging in in a row! To thank you for your loyalty, the {nom} accessory is waiting in your inventory.',
  'historique.bienvenue': 'Welcome to Frutiparc Revival! Got nothing better to do, then?!',
  'historique.compteActive': 'Event: your Frutiparc Revival account has just been activated.',

  // ── Les titres que le serveur pose en frutijob (rangés en code) ──
  'historique.titre.prunostiqueur': 'Prunosticator of the month',
  'historique.titre.prunostiqueuse': 'Prunosticator of the month',

  // ── Le Frutisigne, le FD ──
  'historique.frutisigne': (p) => {
    const debut = p.semaine && p.ascendant ? 'It\'s your week, and your ascendant\'s day!'
      : p.semaine ? 'It\'s your week!' : 'It\'s your ascendant\'s day!';
    return `${debut} The Frutisign gives you one extra game of ${EN.liste(p.jeux)} today.`;
  },
  'historique.irmaFrutisigne': 'mdamirma revealed your FrutiSign: {signe}, ascendant {ascendant}!',
  'historique.plusDeFd': 'No more FD for the "{jeu}" challenge today: your next scores won\'t be ranked. The daily Pass (Shop, Pass section) adds one game a day, forever!',

  // ── Le Challenge du jour ──
  'historique.places': (p) => `Well played! You finish ${(p.places || []).map((x) => `${EN.ordinal(x.rang)} in ${x.jeu}`).join(', ')} in the daily challenge and pocket ${p.xp} XP! (${p.jour})`,
  'historique.medaille': (p) => `Congratulations! You won the ${MEDAILLES[p.medaille] || p.medaille} medal in ${p.jeu}! (${p.jour})`,
  'historique.medailleGains': (p) => {
    const gains = EN.liste([p.kikooz > 0 ? `${p.kikooz} kikooz` : '', p.xp > 0 ? `${p.xp} XP` : '']);
    return `Congratulations! You won the ${MEDAILLES[p.medaille] || p.medaille} medal in ${p.jeu} and pocketed ${gains}! (${p.jour})`;
  },

  // ── Pictos, accessoires, achats ──
  'historique.picto': 'New picto unlocked in {jeu}: {nom}!',
  'historique.pictoSansJeu': 'New picto unlocked: {nom}!',
  'historique.unJeu': 'a game',
  'historique.swapouVerifiee': 'Swapou: your {score}-point game has been verified and ranked.',
  'historique.swapouNonVerifiee': 'Swapou: your {score}-point game couldn\'t be verified, so it isn\'t ranked.',
  'historique.cadeau': 'A gift for you! The {nom} accessory is waiting in your inventory.',
  'historique.kaluga': 'Kaluga trials: well done! The {nom} accessory is waiting in your inventory.',
  'historique.passAchete': '{nom} bought: you now get {n} games a day on the daily race!',
  'historique.feutreAchete': '{nom} bought! To write in colour in the chat rooms: on mobile, pick it from the pen palette; on the desktop, type /multipen.',
  'historique.optionAchetee': '{nom} bought! The {option} now shows up on its own as soon as you start a game.',
  'historique.tableauDeBord': 'dashboard',
  'historique.option.modeNuit': 'Its time will come! Night mode is switched on in Settings → "The park at night", on whichever device you like.',

  // ── Mentions ──
  'historique.mentionTous': '📣 {nom} is talking to everyone ({salon}): "{extrait}"',
  'historique.mentionForum': 'You were mentioned on the forum, in "{sujet}", by {nom}.',
  'historique.unSujet': 'a topic',

  // ── Prunostics ──
  'historique.prunosticVictoire': 'A Frutiz is backing you to win: {mise} kikooz bet on you ({quoi}). Your move!',
  'historique.prunosticOr': 'A Frutiz is backing you for gold in {jeu} in tomorrow\'s Challenge: {mise} kikooz bet on you. Don\'t let them down!',
  'historique.prunosticPodium': 'A Frutiz is backing you for a podium in {jeu} in tomorrow\'s Challenge: {mise} kikooz bet on you. Don\'t let them down!',

  // ── Les quêtes de Gromelin ──
  'historique.queteAccomplie': 'Quest complete: "{titre}".',
  'historique.queteAccompliePaye': 'Quest complete: "{titre}". Gromelin pays you {gain} kikooz.',
  'historique.contratRempli': 'Contract fulfilled: "{titre}".',
  'historique.contratRempliPaye': 'Contract fulfilled: "{titre}". Gromelin pays you {gain} kikooz.',
  'historique.quetesSemaine': (p) => `All your quests for the week are done. Gromelin pays you a bonus of ${EN.nombre(p.nb)} XP.`,
  'historique.bricole': 'Gromelin gave you an errand in the chat room: "{titre}" ({gain} kikooz, before Sunday midnight).',
  'historique.recordPropre': 'New all-time record ({record}): well done! It was already yours, and the bounty only pays out when you knock someone else off the top.',
  'historique.recordPrimePrise': 'New all-time record ({record}), ahead of {ancien}: well done! This week\'s bounty on this record was already claimed by {par}; a new one opens on Monday.',
  'historique.recordPrime': 'All-time record broken ({record}), ahead of {ancien}! Gromelin pays you the bounty: {gain} kikooz.',

  // ── Dons des personnages et de l'équipe ──
  'historique.gaspardBienvenue': 'Gaspard gives you {k} kikooz as a welcome gift!',
  'historique.quizGagne': 'You won {k} kikooz in {anim}\'s "{quiz}" quiz!',
  'historique.questionGagnee': 'You won {k} kikooz in {anim}\'s 60-kikooz Question!',
  'historique.loupgarou': 'Werewolf victory! {nom} gives you {k} kikooz.',
  'historique.donAnimateur': '{nom} gave you {k} kikooz!',

  // ── Sanctions ──
  'historique.totocheAuto': 'You got the totoche for 10 minutes for using forbidden words (auto-moderation).',
  'historique.totoche': 'You were silenced for 10 minutes by {par}.',
  'historique.banniDuSalon': 'You were banned from the {salon} chat room by {par}.',
  'historique.expulseDuSalon': 'You were kicked from the {salon} chat room by {par}.',
  'historique.banniDefinitif': 'You have been banned for good by {par}. You can no longer join public chat rooms or post on the forum.',
  // La date de fin : refaite à l'anglaise (mois/jour), à l'heure du serveur
  // comme la française.
  'historique.banni': (p) => {
    const d = new Date(p.fin);
    const deux = (n) => String(n).padStart(2, '0');
    const quand = Number.isNaN(d.getTime()) ? String(p.quand || '')
      : `${deux(d.getMonth() + 1)}/${deux(d.getDate())}/${d.getFullYear()} at ${deux(d.getHours())}:${deux(d.getMinutes())}`;
    return `You have been banned until ${quand} by ${p.par}. You can no longer join public chat rooms or post on the forum.`;
  },
  'historique.banLeve': 'Your ban was lifted by {par}.',
  'historique.banJeu': (p) => `Your ${p.jeu} scores are no longer ranked ${p.fin ? 'until ' + EN.dateLongue(p.fin) : 'for good'} (rankings, medals and tournaments). Reason: ${p.motif}. You can keep playing it.`,
  'historique.banJeuLeve': 'Your {jeu} scores are ranked again.',

  // ── Les parties en différé : le titre et le corps (zone notif) ──
  'historique.differe': '{titre} — {corps}',

  // ── Les évènements du site ──
  'historique.anniversaire': '🎂 Today is {qui}\'s birthday. Happy birthday!',
  'historique.anniversaires': (p) => {
    const noms = (p.noms || []).slice();
    if (p.reste > 0) noms.push(`${p.reste} other frutiz`);
    return `🎂 Today is ${EN.liste(noms)}'s birthday. Happy birthday to them!`;
  },

  // ── L'Historique Kikooz : les phrases (lang_french.as, § KikoozLog) ──
  // Une phrase par nœud d'époque : b (achat), c (obtenus par), g (le
  // filleul), a (offerts par l'animation ou l'équipe).
  'historique.kikooz.b': 'Bought "{n}" for {k} kikooz.',
  'historique.kikooz.c': '{k} kikooz from {c}.',
  'historique.kikooz.g': '{k} kikooz thanks to your referral {f}.',
  'historique.kikooz.a': '{k} kikooz gifted by {f}.',
  'historique.kikooz.pari': 'Bet: {n}',
  // … et les motifs (« obtenus par … »), en code depuis qu'on les range ainsi ;
  // les anciennes lignes françaises y sont ramenées à la lecture.
  'historique.kikooz.motif.connexion': 'your daily login',
  'historique.kikooz.motif.parrainage': 'the referral bonus',
  'historique.kikooz.motif.gaspard': 'Gaspard\'s welcome gift',
  'historique.kikooz.motif.medailles': 'the Challenge medals ({jour})',
  'historique.kikooz.motif.pariGagne': 'a winning bet',
  'historique.kikooz.motif.pariGagneQuoi': 'a winning bet ({quoi})',
  'historique.kikooz.motif.pariRembourse': 'a refunded bet',
  'historique.kikooz.motif.pariRembourseQuoi': 'a refunded bet ({quoi})',
  'historique.kikooz.motif.cagnotte': 'the Prunostics jackpot',
  'historique.kikooz.motif.quete': 'the quest "{titre}" (Gromelin)',
  'historique.kikooz.motif.contrat': 'the contract "{titre}" (Gromelin)',
  'historique.kikooz.motif.record': 'the bounty on the "{record}" record (Gromelin)',
  'historique.kikooz.motif.vente': 'the sale of "{nom}" to {acheteur}',
  'historique.kikooz.motif.revente': 'the resale of "{nom}"',
};
