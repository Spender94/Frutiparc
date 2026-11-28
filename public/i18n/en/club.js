/*
 * DICTIONNAIRE ANGLAIS — LE CLUB (public/club/).
 * Voir /js/i18n.js : le français est écrit dans le code (argument de repli de
 * T()), ici seulement l'anglais. Glossaire du parc : voir commun.js.
 *
 * Les noms des jeux et des classements, les scores mis en forme et les
 * pseudos viennent du serveur : ils ne passent pas par ici.
 */
(function () {
  // L'ordinal anglais : 1st, 2nd, 3rd, 4th… 11th, 12th, 13th… 21st, 22nd…
  // (le français écrit « 1re », « 3e » : voir chargerFiche).
  function ordinal(n) {
    var c = n % 100, u = n % 10;
    var s = (c >= 11 && c <= 13) ? 'th' : u === 1 ? 'st' : u === 2 ? 'nd' : u === 3 ? 'rd' : 'th';
    return n + '<sup>' + s + '</sup>';
  }
  var MOIS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
    'September', 'October', 'November', 'December'];

  FPI18n.ajouter('en', {
    'club.titre': 'Frutiparc Club',
    'club.piedDePage': 'Frutiparc Club &copy; <a href="https://www.motiontwin.com">Motion Twin</a>',
    'club.ongletMedailles': 'Top medalists',
    'club.ongletRecords': 'Records by game',
    'club.consecration': 'Consecration',
    'club.ongletFiche': 'Player card',
    'club.actualiser': 'Refresh',
    'club.chargement': 'Loading…',
    'club.erreurChargement': 'Loading error: {detail}',

    // ── Les barres d'outils ──
    'club.jeuDeuxPoints': 'Game:',
    'club.affichageDeuxPoints': 'Show:',
    'club.topDeuxPoints': 'Top:',
    'club.pseudoDeuxPoints': 'Username:',
    'club.tousLesJeux': 'All games',
    'club.tousLesJeuxN': 'All games ({n})',
    'club.tousLesClassements': 'All rankings',
    'club.challengeClassique': 'Challenge (Classic)',
    'club.championnat': 'Championship',
    'club.autres': 'Others',
    'club.unFrutiz': 'a Frutiz…',
    'club.voirFiche': 'See card',
    'club.ficheAide': 'Look up a Frutiz by username — or click a name in the other tabs.',

    // ── Les médaillés ──
    'club.or': 'Gold',
    'club.argent': 'Silver',
    'club.bronze': 'Bronze',
    'club.joueur': 'Player',
    'club.nbJoueurs': { one: '{n} player', other: '{n} players' },
    'club.medaillesAttribuees': { one: '{n} medal awarded', other: '{n} medals awarded' },
    'club.medaillesAttribueesSur': { one: '{n} medal awarded on {jeu}', other: '{n} medals awarded on {jeu}' },
    'club.aucuneMedaille': 'No medals awarded yet.',
    'club.aucuneMedailleSur': 'No medals awarded on {jeu} yet.',

    // ── Les records ──
    'club.aucunScore': 'No scores yet',
    'club.aucunClassement': 'No rankings to show.',

    // ── La consécration ──
    'club.joueursConsacres': { one: '{n} consecrated player', other: '{n} consecrated players' },
    'club.aucunJoueur': 'No players to rank yet.',
    'club.conseInfo': {
      one: "{n} game counted — a complete album is worth {pct}%; Mini-Fever and unreleased pictos don't count.",
      other: "{n} games counted — a complete album is worth {pct}%; Mini-Fever and unreleased pictos don't count.",
    },
    'club.pourcent': '{n}%',

    // ── La fiche d'un joueur ──
    'club.ficheIntrouvable': 'No Frutiz called “{pseudo}” has any medals or records.',
    'club.pasDeMedaille': '{nom} has no medals yet.',
    'club.aObtenu': { one: '{nom} has won <b>{n}</b> medal', other: '{nom} has won <b>{n}</b> medals' },
    'club.aObtenuRang': {
      one: '{nom} has won <b>{n}</b> medal — {rang} on the medal table',
      other: '{nom} has won <b>{n}</b> medals — {rang} on the medal table',
    },
    'club.rangOrdinal': function (p) { return ordinal(Number(p.n)); },
    // Le mois d'après son code AAAA-MM (le serveur écrit le français).
    'club.moisAnnee': function (p) {
      var c = String(p.cle || '').split('-');
      var nom = MOIS[Number(c[1]) - 1];
      return nom ? nom + ' ' + c[0] : String(p.cle || '');
    },
    'club.medaillesParDate': 'Medals by date',
    'club.medaillesParJeu': 'Medals by game',
    'club.mois': 'Month',
    'club.jeu': 'Game',
    'club.aucunRecord': 'No records yet.',
    'club.rangSur': '#{rang} / {sur}',
    'club.nbRecords': { one: '{n} record', other: '{n} records' },
  });
})();
