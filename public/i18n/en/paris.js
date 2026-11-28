/*
 * DICTIONNAIRE ANGLAIS — LES PRUNOSTICS (public/paris/).
 * Voir /js/i18n.js : le français est écrit dans le code (argument de repli de
 * T()), ici seulement l'anglais. Glossaire du parc : voir commun.js.
 *
 * Le vocabulaire : mise → stake, cote → odds (« ×2.5 »), pari mutuel → pool
 * bet, cagnotte → jackpot, médaillé → podium, en or → gold, défi médaille →
 * medal dare, Prunostiqueur → Prunosticator, registre → ledger. « kikooz »
 * ne se traduit pas. Les noms des jeux, des tournois et de leurs tours, les
 * descriptions de paris que le serveur écrit (`texte`, `quoi`) et le nom du
 * mois du classement restent tels qu'ils arrivent.
 */
(function () {
  // 1st, 2nd, 3rd, 4th… 11th, 12th, 13th… 21st…
  function ordinal(n) {
    var c = n % 100, u = n % 10;
    return n + ((c >= 11 && c <= 13) ? 'th' : u === 1 ? 'st' : u === 2 ? 'nd' : u === 3 ? 'rd' : 'th');
  }
  function deux(n) { return (n < 10 ? '0' : '') + n; }
  // « s » au pluriel anglais (seul 1 est au singulier).
  function s(n) { return Number(n) === 1 ? '' : 's'; }

  FPI18n.ajouter('en', {
    // ── Les nombres, les cotes, les dates ──
    'paris.virgule': '.',
    // Un jour AAAA-MM-JJ : « Saturday, November 28 ».
    'paris.jourLisible': function (p) {
      var d = new Date(String(p.jour) + 'T12:00:00Z');
      return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
    },
    // « Nov 28 »
    'paris.dateCourte': function (p) { return p.d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); },
    // « Saturday the 28th at 14:05 »
    'paris.finDesMises': function (p) {
      var d = p.d;
      return d.toLocaleDateString('en-US', { weekday: 'long' }) + ' the ' + ordinal(d.getDate())
        + ' at ' + deux(d.getHours()) + ':' + deux(d.getMinutes());
    },
    'paris.ordinal': function (p) { return ordinal(Number(p.n)); },

    // ── La page ──
    'paris.ongletTournois': 'Tournaments',
    'paris.ongletRegistre': 'Ledger',
    'paris.ongletParc': 'The park',
    'paris.chargement': 'Loading…',
    'paris.tonSolde': 'your balance',
    'paris.connexion': 'To bet, <a href="/light.html">log in to the park</a>, then come back here.',
    'paris.serveurMuet': "The server isn't answering. Try again in a moment.",
    'paris.serveurNeRepondPas': "The server isn't answering.",
    'paris.commentCaMarche': 'How does it work?',

    // ── Le ticket ──
    'paris.max': 'Max ({n})',
    'paris.mise': 'Stake',
    'paris.miseMini': 'Enter a stake of at least 1 kikooz.',
    'paris.unInstant': 'One moment…',
    'paris.parier': 'Bet {mise}',
    'paris.pariNonEnregistre': "The bet couldn't be saved.",
    'paris.maxDemain': "You've bet your maximum of {plafond} for tomorrow.",
    'paris.maxDefis': "You've bet your maximum of {plafond} on tomorrow's dares.",

    // ── Le Challenge de demain ──
    'paris.challengeFerme': 'Challenge Prunostics are closed for now. Check out the Tournaments tab!',
    'paris.challengeDe': 'Challenge for {jour}',
    'paris.jeuxDuJour': "the day's games: {jeux}",
    'paris.et': ' and ',
    'paris.pasDeJeu': 'no game open',
    'paris.misesJusquaMinuit': ' · bets until midnight',
    'paris.regleChallenge': 'Every day, <b>{n} games</b> of the Challenge are open to Prunostics (they change every day). '
      + 'Tap a player: <b>podium</b> if they finish on the podium tomorrow (gold, silver or bronze), <b>gold</b> if they win. '
      + "It's <b>pool betting</b>: all the stakes on a bet make up a pot, shared by those who called it right, in proportion to their stake. "
      + "The more you go against the crowd, the more you win! The odds shown are the pot's right now: they move until midnight. "
      + 'A lost bet is lost: your stake pays those who called it right. And if <b>nobody</b> called it right, all the stakes go into the <b>jackpot</b>. '
      + 'You can bet on yourself — and anyone can bet on anyone: look up their username. '
      + 'Maximum: {plafond} a day, all games combined. And at the start of each month, Dimitri crowns the <b>Prunosticator of the month</b>: '
      + 'they win the jackpot{cagnotte} and hold the title for the whole next month.',
    'paris.cagnotteEnCeMoment': ' ({montant} right now)',
    'paris.regleChallengeDefi': ' Further down, the <b>medal dare</b>: bet on yourself, at any game.',
    'paris.misePourDemain': 'Bet for tomorrow: <b>{montant}</b>',
    'paris.ilTeReste': '<b>{reste}</b> left out of {plafond}',
    'paris.mesParisDemain': 'My bets for tomorrow',
    'paris.retourCoteFixe': ' → <b>{retour}</b> at {cote} (fixed odds)',
    'paris.siLePotEnRestaitLa': ' → ≈ <b>{retour}</b> if the pot stayed as it is',
    'paris.monPariOr': '{nom} takes gold at {jeu} — {mise}',
    'paris.monPariMedaille': '{nom} on the podium at {jeu} — {mise}',
    'paris.ligneDefi': 'Dare: {quoi} at {jeu} — {mise}',
    'paris.pots': 'Podium pot: <b>{podium}</b> · gold pot: <b>{or}</b>',
    'paris.unAutreJoueur': '🔍 Another player…',
    'paris.voir': 'Show',
    'paris.joueurIntrouvable': 'Player not found.',
    'paris.enOr': 'gold',
    'paris.medaille': 'podium',
    // Le bouton de cote est étroit : « à prendre » y tient sur une ligne.
    'paris.aPrendre': 'grab it!',
    'paris.kzMises': '{montant} staked',
    'paris.podiumsSur': function (p) { return p.n + ' podium' + s(p.n) + ' in ' + p.joues + ' day' + s(p.joues); },
    'paris.nEnOr': '{n} gold',
    'paris.pasVenu': 'not seen in the last 30 days',
    'paris.toi': '(you)',
    'paris.personneHabitue': 'Nobody has played {jeu} regularly yet. Look up a player above — why not you?',
    'paris.autresHabitues': { one: '+ {n} other regular', other: '+ {n} other regulars' },
    'paris.toutVoir': 'see all',
    'paris.aucunJeuDemain': 'No game is open to Prunostics tomorrow.',
    'paris.ticketOr': '{nom} takes gold at {jeu}, tomorrow',
    'paris.ticketMedaille': '{nom} on the podium at {jeu}, tomorrow',
    'paris.potOrTiret': '— gold pot: {pot}',
    'paris.potMedailleTiret': '— podium pot: {pot}',
    'paris.dontSur': ', {mises} of it on {nom}',
    'paris.personneSur': ', nobody on {nom} yet',
    'paris.gainOr': 'If they win, you get ≈ <b>{gain}</b> <small>if the pot stayed as it is — it grows until midnight</small>',
    'paris.gainMedaille': 'If they make the podium, you get up to ≈ <b>{gain}</b> <small>if the pot stayed as it is — it grows until midnight, '
      + "and it's shared with those who bet on the other medalists</small>",
    'paris.pariOrFait': "You're in! {mise} on {nom} for gold — {pot} pot: ≈ {estime} for you if it stayed as it is.",
    'paris.pariMedailleFait': "You're in! {mise} on {nom} for the podium — {pot} pot: ≈ {estime} for you if it stayed as it is.",

    // ── Hier ──
    'paris.leChallengeDe': 'The Challenge for {jour}',
    'paris.hierGagne': 'won: <b>+{net}</b> ({recu} received)',
    'paris.hierPerdu': 'lost',
    'paris.hierRembourse': 'refunded',
    'paris.hierEnAttente': 'waiting for the day to change',
    'paris.ligneHier': '{texte} — {mise}{cote}, {resultat}',
    'paris.aCote': ' at {cote}',
    'paris.podiumHier': '<b>{jeu}</b>: {podium}',

    // ── Le défi médaille ──
    'paris.defiQuoiBronze': 'a medal',
    'paris.defiQuoiArgent': 'silver or gold',
    'paris.defiQuoiOr': 'gold',
    'paris.defiMedaille': 'Medal dare',
    'paris.defiSousTitre': 'on yourself, at any game · fixed odds · {plafond} a day at most',
    'paris.leDefi': "What's the dare?",
    'paris.regleDefi': 'Bet that <b>you</b> win a medal tomorrow, at the game of your choice: <b>a medal</b> (bronze or better), '
      + '<b>silver or gold</b>, or <b>gold</b>. The higher the color, the harder it is… and the more it pays. '
      + "The odds are <b>fixed</b>, based on your last 30 days at the game (an average player's if you rarely play it), and locked in when you bet: "
      + 'make it and you get your stake × the odds; miss it and your stake is lost. If the game gave out no medals that day, you get a refund. '
      + 'At most {plafond} a day on dares, within your daily limit. No dares on games that are hardly played.',
    'paris.aucunJeuDefi': 'No game has been played enough in the last 30 days for a dare.',
    'paris.defiStats': 'You at {jeu}, last 30 days: {medailles} in {jours}',
    'paris.nMedailles': { one: '{n} medal', other: '{n} medals' },
    'paris.nJoursJoues': { one: '{n} day played', other: '{n} days played' },
    'paris.nArgentOuOr': '{n} silver or gold',
    'paris.peuDeJours': "only a few days: an average player's odds, at most",
    'paris.pasVenuJeu': "You haven't played {jeu} in the last 30 days: you get the game's average-player odds.",
    'paris.ticketDefi': 'Dare: I win {quoi} at {jeu}, tomorrow',
    'paris.coteFixeTiret': '— fixed odds {cote}',
    'paris.gainDefi': 'Make it and you get <b>{gain}</b> <small>({cote}, locked in when you bet) — miss it and your stake is lost.</small>',
    'paris.defiReleve': 'Dare accepted! {mise}: {quoi} at {jeu} — {retour} for you if you make it.',

    // ── Les tournois ──
    'paris.pctChances': '{p}% chance',
    'paris.nParieurs': { one: '{n} bettor', other: '{n} bettors' },
    'paris.poule': ' — group {poule}',
    'paris.miseSurMatch': 'bet: {montant}',
    'paris.contre': 'vs',
    'paris.matchGagne': 'Won: your {mise} bet on {nom} brought you {gain}.',
    'paris.matchPerdu': 'Lost: your {mise} bet on {nom}.',
    'paris.matchRembourse': 'Refunded: {gain} (match cancelled or player replaced).',
    'paris.taMiseCote': 'Your bet: {mise} on {nom} at {cote}: {retour} for you if they win.',
    'paris.taMiseMutuel': 'Your bet: {mise} on {nom} (pool bet).',
    'paris.tonMatch': "It's your match: you can't bet on it. Good luck!",
    'paris.matchCommence': 'The match has started: betting is closed.',
    'paris.misesOuvertesJusqua': 'The match is underway: bets are open until <b>{date}</b>.',
    'paris.aucunTournoi': 'No tournament has open Prunostics right now: come back for the next one!',
    'paris.regleTournoi': 'Tap the player you think will win, then pick your stake on the ticket. Each player has their own <b>odds</b> (×), based on their recent scores: '
      + 'the favorite pays little, the underdog a lot. The odds are <b>locked in when you bet</b>: if they win, you get your stake × the odds; '
      + "if they lose, your stake is lost. Maximum stake: {plafond} per match. You can't bet on your own matches.",
    'paris.matchsOuverts': 'Matches open for betting',
    'paris.pasDeMatchOuvert': 'No open match: the next ones will open as soon as both their players are known.',
    'paris.matchsEnCours': 'Matches in progress',
    'paris.resultats': 'Results',
    'paris.plafondMatch': "You've bet the {plafond} limit on this match.",
    'paris.ticketTournoi': '{nom} wins — {j1} vs {j2}',
    'paris.dejaMise': '(you already have {mise} on it)',
    'paris.gainMutuel': 'If they win, you get about <b>{gain}</b> <small>(pool bet)</small>',
    'paris.pasDeCote': 'No odds for this player.',
    'paris.gainTournoi': 'If they win, you get <b>{gain}</b> <small>({mise} × {cote}, odds locked in when you bet)</small>',
    'paris.pariMatchCote': "You're in! {mise} in total on this match: {retour} for you if they win.",
    'paris.pariMatch': "You're in! {mise} in total on this match.",

    // ── Le registre ──
    'paris.statutGagne': 'won',
    'paris.statutPerdu': 'lost',
    'paris.statutRembourse': 'refunded',
    'paris.statutOuvert': 'in play',
    'paris.pari': 'Bet',
    'paris.cote': 'Odds',
    'paris.resultat': 'Result',
    'paris.mutuel': 'pool',
    'paris.voirSesParis': 'See their settled bets',
    'paris.prunostiqueurDuMois': 'Prunosticator of the month',
    'paris.regleDuMois': '— {mois}, net profit, at least {min} settled bets',
    'paris.moisDernier': 'Last month: <b>{nom}</b> (+{net}), crowned by Dimitri.',
    'paris.cagnotteEnJeu': 'Jackpot at stake: <b>{cagnotte}</b>{plafond} — the stakes of the predictions nobody saw coming. '
      + 'The Prunosticator of the month wins it, along with the title.',
    'paris.auPlus': ' (at most {montant})',
    'paris.gagnesSur': { one: '{n} won out of {paris}', other: '{n} won out of {paris}' },
    'paris.dixPremiers': 'Show only the top ten',
    'paris.toutLeClassement': 'See the full rankings ({n} prunosticators)',
    'paris.pasEncoreClasse': 'Not ranked yet this month: you need {n} settled bets.',
    'paris.toiRang': 'You: {rang} ({net}).',
    'paris.personneClasse': 'Nobody is ranked yet this month: {n} settled bets to join the race.',
    'paris.connexionRegistre': 'To see your bets, <a href="/light.html">log in to the park</a>.',
    'paris.bilanParis': 'bets ({gagnes} won, {perdus} lost)',
    'paris.kikoozMises': 'kikooz staked',
    'paris.kikoozRecus': 'kikooz received',
    'paris.bilan': 'balance',
    'paris.enJeu': '{montant} in play',
    'paris.mesParis': 'My bets',
    'paris.recus': '({montant} received)',
    'paris.rendus': '{montant} returned',
    'paris.rienParie': "You haven't bet anything yet. Your bets will show up here, won or lost.",
    'paris.grosCoups': "The park's big wins",
    'paris.grosCoupsSeuil': '— last 30 days, {seuil} profit or more',
    'paris.grosCoup': '{qui} bet {mise} on {quoi}{cote}: pocketed <b>{gain}</b>.',
    'paris.virguleACote': ', at {cote}',
    'paris.pasDeGrosCoup': "No big win yet: Dimitri can't wait for the first one.",

    // ── Le parc ──
    'paris.decrireOr': '{choix} takes gold at {jeu}',
    'paris.decrireMedaille': '{choix} on the podium at {jeu}',
    'paris.decrireDefi': '{choix} wins {quoi} at {jeu} (dare)',
    'paris.victoireDe': '{choix} to win',
    'paris.rendu': 'returned',
    'paris.introuvable': 'Not found.',
    'paris.parcJourParJour': '‹ The park, day by day',
    'paris.lesParisDe': "{nom}'s bets",
    'paris.sesParisRegles': 'Their settled bets from the last 30 days (open ones stay secret).',
    'paris.parisRegles': 'settled bets ({gagnes} won)',
    'paris.regleLe': 'Settled',
    'paris.aucunPariTrenteJours': 'No bets settled in the last 30 days.',
    'paris.veille': '‹ day before',
    'paris.lendemain': 'day after ›',
    'paris.parcAide': "A day's bets are revealed once settled: that day's Challenge, and the tournament matches settled that day. Tap a name to see all their bets.",
    'paris.bilanDuJour': "The day's results",
    'paris.prunostiqueur': 'Prunosticator',
    'paris.gagnes': 'Won',
    'paris.miseCourt': 'Staked',
    'paris.bilanTitre': 'Balance',
    'paris.tousLesParis': 'All bets',
    'paris.qui': 'Who',
    'paris.aucunPariCeJour': 'No bets settled that day.',
  });
})();
