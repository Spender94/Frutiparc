'use strict';
/*
 * DICTIONNAIRE ANGLAIS DU SERVEUR — LES PERSONNAGES DU FORUM.
 *
 *   Natacha     son mot de bienvenue, dans la langue du NOUVEAU (natacha.js) :
 *               chaque morceau a sa traduction, au même rang que le français,
 *               pour qu'un même tirage donne le même mot dans les deux langues.
 *   Dimitri     les gros coups et le Prunostiqueur du mois (dimitri.js) ;
 *   VieuxPruneau  la map du jour de Motion Ball 2 (mb2carte.js) —
 *               ces deux-là postent pour tout le monde : la version anglaise
 *               suit la française, dans le même message (forumBilingue.js).
 *
 * Les noms de rubriques et les titres des sujets ne se traduisent pas : ils
 * servent à retrouver les sujets. Le BBCode ([b]…[/b]) passe tel quel ; pas
 * de [i] ici (le bloc anglais est déjà en italique).
 */
const EN = require('../outils-en.js');

const cote = (c) => '×' + String(c);

module.exports = {
  // ── Natacha : les ouvertures ({qui} : « @Pseudo ») ──
  'forumbots.natacha.ouverture.0': 'A warm welcome to {qui}, who just joined Frutiparc Revival!',
  'forumbots.natacha.ouverture.1': 'A new Frutiz among us: welcome {qui}!',
  'forumbots.natacha.ouverture.2': '{qui} just arrived at the park. Welcome!',
  'forumbots.natacha.ouverture.3': 'Make room, {qui} is landing at Frutiparc Revival!',
  'forumbots.natacha.ouverture.4': 'A new face in the park: {qui} joins us. Welcome!',
  'forumbots.natacha.ouverture.5': '{qui} is pushing the park gate. Come in, come in, it\'s open!',
  'forumbots.natacha.ouverture.6': 'The park is growing: {qui} just signed up. Welcome!',
  'forumbots.natacha.ouverture.7': 'Welcome {qui}! We were expecting you (yes, really).',
  'forumbots.natacha.ouverture.8': '{qui} has been one of us for barely a few seconds. Welcome to Frutiparc Revival!',
  'forumbots.natacha.ouverture.9': 'One more Frutiz, {qui}! Welcome to the park!',
  'forumbots.natacha.ouverture.10': 'A round of applause for {qui}, freshly signed up! Welcome!',
  'forumbots.natacha.ouverture.11': 'Oh, something new at the front desk: {qui} joins Frutiparc Revival. Welcome!',
  'forumbots.natacha.ouverture.12': '{qui} signed the park\'s guest book. Welcome among the Frutiz!',
  'forumbots.natacha.ouverture.13': 'And one more balloon in the park\'s sky: welcome {qui}!',

  // ── Natacha : le moment de la journée ──
  'forumbots.natacha.nuit.0': 'A night-owl Frutiz! Insomniacs are at home here.',
  'forumbots.natacha.nuit.1': 'Signing up in the middle of the night: the park never sleeps, and clearly neither do you.',
  'forumbots.natacha.nuit.2': 'It\'s quiet at the park at this hour — you\'ll be able to look around in peace.',
  'forumbots.natacha.matin.0': 'Coffee or hot chocolate? The front desk offers both (virtually).',
  'forumbots.natacha.matin.1': 'The park has just opened its gates, you\'re one of the first today.',
  'forumbots.natacha.matin.2': 'What a way to start the morning.',
  'forumbots.natacha.midi.0': 'Right on lunchtime — the games play very well with a sandwich.',
  'forumbots.natacha.midi.1': 'A lunchtime sign-up: the park is buzzing.',
  'forumbots.natacha.apresmidi.0': 'The afternoon is the best time for the chat rooms: there\'s a crowd.',
  'forumbots.natacha.apresmidi.1': 'The sun is high over the park, make the most of it.',
  'forumbots.natacha.soir.0': 'The park is open all night, make yourself at home.',
  'forumbots.natacha.soir.1': 'Evening is when the park comes alive the most — perfect timing.',
  'forumbots.natacha.soir.2': 'An evening at the park: the chat rooms are full, the scores reset at midnight.',
  // {jour} : le jour de la semaine, en anglais (« Saturday »).
  'forumbots.natacha.weekend.0': 'A {jour} at the park — off to a good start.',
  'forumbots.natacha.weekend.1': 'Signing up on a {jour}: at the weekend, the park runs at full steam.',

  // ── Natacha : un numéro rond, un parrain, un conseil ──
  'forumbots.natacha.jalon.0': (p) => `And not just any one: the park's ${EN.ordinal(p.n)} Frutiz, that calls for a celebration!`,
  'forumbots.natacha.jalon.1': (p) => `You're the ${EN.ordinal(p.n)} Frutiz to sign up — a round number, a day to remember.`,
  'forumbots.natacha.jalon.2': (p) => `${EN.nombre(p.n)} Frutiz counting you. The front-desk counter is getting dizzy.`,
  'forumbots.natacha.parrainage.0': 'Brought along by {parrain} — thanks for that!',
  'forumbots.natacha.parrainage.1': 'It\'s {parrain} who sent them our way. Good referrers make good parks.',
  'forumbots.natacha.parrainage.2': 'A referral of {parrain}, so already in good company.',
  'forumbots.natacha.conseil.0': 'Drop by the Pomme chat room to say hi, that\'s where it all starts.',
  'forumbots.natacha.conseil.1': 'Make yourself a bouille in the Bouilloscope: it\'s your face around the park.',
  'forumbots.natacha.conseil.2': 'The games are in the park, and the rankings reset every night at midnight.',
  'forumbots.natacha.conseil.3': 'If you were around back in the day, tell us about it: we love old stories.',
  'forumbots.natacha.conseil.4': 'A doubt, a question? This forum is here for that, and the old-timers answer fast.',
  'forumbots.natacha.conseil.5': 'Every day, your first games earn you XP — no need to do everything at once.',
  'forumbots.natacha.conseil.6': 'Add your friends to your contacts: the park is more fun together.',
  'forumbots.natacha.conseil.7': 'You earn kikooz by playing; the shop can wait until you\'ve had a look around.',
  'forumbots.natacha.conseil.8': 'The rules fit in one line: be nice. That covers everything.',
  'forumbots.natacha.conseil.9': 'Explore without fear: you can\'t break anything, except records.',

  // ── Dimitri : les gros coups ──
  'forumbots.dimitri.ouvertureUn.0': 'Now that\'s a big win!',
  'forumbots.dimitri.ouvertureUn.1': 'Incredible, incredible!',
  'forumbots.dimitri.ouvertureUn.2': 'A big round of applause!',
  'forumbots.dimitri.ouvertureUn.3': 'I can\'t believe it, and I\'ve seen plenty of bets go by!',
  'forumbots.dimitri.ouvertureUn.4': 'Oh, what a deal!',
  'forumbots.dimitri.ouvertureUn.5': 'Ladies and gentlemen, a big win just came in!',
  'forumbots.dimitri.ouvertureUn.6': 'What a nose for it!',
  'forumbots.dimitri.ouvertureUn.7': 'The counter is still shaking!',
  'forumbots.dimitri.ouverturePlusieurs.0': 'What a night at the counter: {n} big wins in one go!',
  'forumbots.dimitri.ouverturePlusieurs.1': 'Oh my, {n} big wins to announce! I don\'t know where to look.',
  'forumbots.dimitri.ouverturePlusieurs.2': 'Kikooz raining on the park: {n} big wins!',
  'forumbots.dimitri.ouverturePlusieurs.3': 'The punters are unstoppable: {n} big wins to celebrate!',
  'forumbots.dimitri.chute.0': 'Hats off!',
  'forumbots.dimitri.chute.1': 'Well done, and see you next time!',
  'forumbots.dimitri.chute.2': 'Who can top that?',
  'forumbots.dimitri.chute.3': 'The counter is delighted, the till a little less so.',
  'forumbots.dimitri.chute.4': 'I\'ll have to recount my kikooz…',
  'forumbots.dimitri.chute.5': 'Bets are still open: who\'s next?',
  'forumbots.dimitri.chute.6': 'Enough for a trip to the shop!',
  'forumbots.dimitri.ligne': (p) => `@${p.parieur} bet ${EN.nombre(p.mise)} kikooz on ${p.quoi}${p.cote ? `, at ${cote(p.cote)}` : ''}: `
    + `[b]${EN.nombre(p.gain)} kikooz[/b] pocketed!`,
  // Ce que le parieur avait vu (server.js, quoiPariChallenge et les tournois).
  'forumbots.dimitri.quoi.or': '{nom} taking gold in {jeu}',
  'forumbots.dimitri.quoi.podium': '{nom} on the podium in {jeu}',
  'forumbots.dimitri.quoi.defi_or': '{nom}\'s challenge: gold in {jeu}',
  'forumbots.dimitri.quoi.defi_argent': '{nom}\'s challenge: silver or gold in {jeu}',
  'forumbots.dimitri.quoi.defi_bronze': '{nom}\'s challenge: a medal in {jeu}',
  'forumbots.dimitri.quoiTournoi': '{nom} to win',
  'forumbots.dimitri.quoiTournoiAffiche': '{nom} to win ({affiche})',
  'forumbots.dimitri.miseAJour': '— Update at {heure} —',

  // ── Dimitri : le Prunostiqueur du mois ──
  'forumbots.dimitri.mois.ouverture.0': 'Drum roll… the [b]Prunosticator of the month[/b] is in!',
  'forumbots.dimitri.mois.ouverture.1': 'The counter has done its sums, and the [b]Prunosticator of the month[/b] is…',
  'forumbots.dimitri.mois.ouverture.2': 'Ladies and gentlemen, here is the [b]Prunosticator of the month[/b]!',
  'forumbots.dimitri.mois.gagnant': (p) => `@${p.nom}, with [b]+${EN.nombre(p.net)} kikooz[/b] profit in ${EN.moisLisible(p.moisCle)} `
    + `(${p.gagnes} winning bet${Number(p.gagnes) === 1 ? '' : 's'} out of ${p.paris}).`,
  'forumbots.dimitri.mois.titre': 'All month long, they proudly wear the title of [b]{titre}[/b]!',
  'forumbots.dimitri.mois.cagnotte': (p) => `And they scoop [b]the jackpot: ${EN.nombre(p.n)} kikooz[/b], the stakes from the picks nobody saw coming!`,
  'forumbots.dimitri.mois.objet': 'They go home with a gift from the park: [b]{objet}[/b]!',
  'forumbots.dimitri.mois.podium': (p) => `Also on the podium: ${(p.suivants || []).map((x, i) => `@${x.nom}, ${EN.ordinal(i + 2)} (+${EN.nombre(x.net)})`).join(', ')}.`,
  'forumbots.dimitri.mois.chute.0': 'A new month begins: get your Prunostics in!',
  'forumbots.dimitri.mois.chute.1': 'The counters are back to zero. Who\'ll do better this month?',
  'forumbots.dimitri.mois.chute.2': 'Well done! And for everyone else: the rematch starts today.',

  // ── VieuxPruneau : la map du jour ──
  'forumbots.pruneau.titre': '[b]Today\'s map[/b] — Motion Ball 2 Challenge, {jour}.',
  'forumbots.pruneau.changement': '[b]Do-over![/b] The team just changed the Challenge map mid-day. Here\'s the new one, the only one that counts now.',
  'forumbots.pruneau.donjon': '[b]The dungeon[/b]: {salles} rooms on {largeur} × {hauteur} ({vides} empty squares). Columns A to H from left to right, rows 1 to 8 from top to bottom.',
  'forumbots.pruneau.depart': '• [b]Start[/b] at {c}.',
  'forumbots.pruneau.boss': '• [b]The boss[/b] at {c}.',
  'forumbots.pruneau.billes': '• [b]Marbles[/b]: {liste}.',
  'forumbots.pruneau.billesBonus': '• [b]Bonus marbles[/b]: {liste}.',
  'forumbots.pruneau.bonus': '• [b]Bonuses[/b]: {liste} (the radar isn\'t marked on the map).',
  'forumbots.pruneau.portes': '• [b]Doors[/b] (a bell opens them): {liste}.',
  'forumbots.pruneau.invisibles': '• [b]Invisible passages[/b] (not on the map): {liste}.',
  'forumbots.pruneau.objetEn': '{nom} at {c}',
  'forumbots.pruneau.nomBille.0': 'green',
  'forumbots.pruneau.nomBille.1': 'blue',
  'forumbots.pruneau.nomBille.2': 'metal',
  'forumbots.pruneau.nomBille.3': 'purple',
  'forumbots.pruneau.nomBonus.0': 'orange marble',
  'forumbots.pruneau.nomBonus.1': 'red marble',
  'forumbots.pruneau.nomBonus.2': 'map',
  'forumbots.pruneau.nomBonus.3': 'radar',
  'forumbots.pruneau.nomBonus.4': 'bell',
  'forumbots.pruneau.nomBonus.5': '+1 min',
  'forumbots.pruneau.nomBonus.6': '+3 min',
};
