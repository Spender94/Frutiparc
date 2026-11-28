/*
 * DICTIONNAIRE ANGLAIS — FRUTIBANDAS (public/bandas/index.html, ui.js,
 * gameview.js).
 *
 * Chargé par FPI18n.charger('/bandas/lang/{lang}.js') seulement quand la page
 * est en anglais ; le français reste écrit dans le code (argument de repli de
 * T(), ou texte du HTML marqué data-i18n). Une clé absente retombe sur le
 * français. Les entrées en { one, other } sont des pluriels (T.n) ; les
 * tableaux se traduisent d'un bloc (T.table), élément par élément.
 *
 * LES CARTES : leurs noms anglais sont ceux des bannières anglaises du jeu
 * d'origine, restées dans assets/advertiser/ (ANVIL, SECOND WAVE, CHARGE, COW,
 * INTERMISSION, REINFORCEMENT, DISORDER, TRAP — et CONFISCATION,
 * PETRIFICATION, CONVERSION, SOLO). La bannière les écrit en capitales.
 *
 * Le vocabulaire suit celui des widgets (/i18n/en/widgets.js) : « en différé »
 * → correspondence, championnat → championship, amical → friendly. Les noms
 * des tours d'un tournoi viennent du serveur, déjà traduits.
 */
FPI18n.ajouter('en', {
  // ── Les cartes (T.table, même ordre que CARD_KEYS) ──────────────────────
  'bandas.cartes': ['Anvil', 'Second Wave', 'Confiscation', 'Reinforcement', 'Disorder',
    'Petrification', 'Cow', 'Conversion', 'Charge', 'Intermission', 'Solo', 'Trap'],
  'bandas.cartesTexte': [
    'The anvil destroys the targeted square. If the anvil hits an obstacle, the obstacle is destroyed.',
    'You can play a second time this turn.',
    'If your opponent plays a card next turn, cancel its effect and take the card.',
    'Randomly places up to 3 extra allied fruits on the board.',
    "Your opponent's next move will be reversed.",
    'The targeted fruit turns to stone.',
    'A moo-moo appears at the top of the board and sends every fruit in the chosen column flying.',
    'The chosen fruit switches teams.',
    'Your next move will be doubled.',
    'You skip this turn.',
    'Only the chosen fruit will move on your next move.',
    'Sets a trap on an empty square: the fruit that lands on it will be destroyed along with the square.',
  ],

  // ── L'écran des modes et le salon ───────────────────────────────────────
  'bandas.connexion': 'Connecting…',
  'bandas.salle.chall': 'CHALLENGE',
  'bandas.salle.champ': 'CHAMPIONSHIP',
  'bandas.salle.amical': 'FRIENDLY MATCHES',
  'bandas.joueursMaj': 'PLAYERS',
  'bandas.parties': 'GAMES',
  'bandas.taNote': 'Your rating: <b>{note}</b>',
  'bandas.tournoi': 'Tournament',
  'bandas.enDiffere': 'Correspondence',
  'bandas.creerPartie': 'Create a game',
  'bandas.annulerPartie': 'Cancel the game',
  'bandas.retour': 'Back',
  'bandas.ongletJoueurs': 'Players',
  'bandas.ongletDefis': 'Challenges',
  'bandas.deplier': 'Expand',
  'bandas.replier': 'Collapse',
  'bandas.listeDefis': 'Challenge list',
  'bandas.listeDefisDe': 'Challenges for {nom} ({n})',
  'bandas.listeJoueurs': 'player list',
  'bandas.ecrisMessage': 'Write a message…',
  'bandas.cliqueJoueur': 'Click a player in the list on the right to see their status and challenge them.',
  'bandas.disponible': 'Available',
  'bandas.enAttente': 'Waiting',
  'bandas.enPartie': 'Playing',
  'bandas.quiJouent': { one: '{n} playing', other: '{n} playing' },
  'bandas.nEnAttente': '{n} waiting',
  'bandas.regardeUnePartie': 'Watching a game',
  'bandas.defier': 'Challenge {nom}',
  'bandas.rejoindre': 'Join {nom}',
  'bandas.regarderPartie': 'Watch the game',
  'bandas.estEnPartie': '{nom} is playing',
  'bandas.inviterDiffere': 'Invite {nom} to a correspondence game (3 days per move)',
  'bandas.partiesEnCours': 'Games in progress',
  'bandas.contre': '{a} vs {b}',
  'bandas.regarder': 'Watch',

  // ── Les parties en différé ──────────────────────────────────────────────
  'bandas.partiesDiffere': 'Correspondence games',
  'bandas.partiesDiffereSalle': 'Correspondence games — {salle}',
  'bandas.differeCompte': 'Correspondence: <b>{n}</b> to play · {m} in progress',
  'bandas.differeRegle': 'Correspondence: 3 days per move',
  'bandas.avertDiffere': "Correspondence game: everyone plays whenever they drop by, three days per move. You can close this, the game will wait for you — you'll be notified when it's your turn.",
  'bandas.pasDeChat': 'No chat in correspondence games',
  'bandas.differeGagnee': 'Correspondence game won!',
  'bandas.differePerdue': 'Correspondence game lost.',

  // ── Le tournoi ──────────────────────────────────────────────────────────
  'bandas.tournoiFini': '<b>{tournoi}</b> — 🏆 {champion} wins.',
  'bandas.tournoiMonMatch': '<b>{tournoi}</b> · {tour} — your match:',
  'bandas.aDeterminer': 'to be decided',
  'bandas.ecartPourPlier': '(a {n}-game lead clinches it)',
  'bandas.tournoiRien': '<b>{tournoi}</b> — no match waiting for you.',
  'bandas.voirTableau': 'See the bracket »',
  'bandas.exempt': '— bye',
  'bandas.enCours': 'in progress',
  'bandas.poule': 'Group {poule}',
  'bandas.colJoueur': 'Player',
  'bandas.colV': 'W',
  'bandas.colD': 'L',
  'bandas.colManches': 'Games',
  'bandas.pasDeTirage': "The draw hasn't been made yet.",

  // ── La partie ───────────────────────────────────────────────────────────
  'bandas.oranges': 'oranges',
  'bandas.bananes': 'bananas',
  'bandas.annuler': 'Cancel',
  'bandas.son': 'Sound',
  'bandas.abandon': 'Give up',
  'bandas.fermer': 'Close',
  'bandas.jouer': 'Play',
  'bandas.choisirCarte': 'Pick this card',
  'bandas.discuter': 'Chat… (Enter to send)',
  'bandas.chatLecture': 'Read-only chat (spectator)',
  'bandas.attention': "WARNING: F5, Alt-F4, Control-W and other keys close or reload Frutiparc and make you lose the game. Don't use them!",
  'bandas.muet': "Spectators can't chat in this game.",
  'bandas.vousObservez': "You're watching {noms}'s game.",
  'bandas.et': ' and ',
  'bandas.observe': '👁 {nom} is watching the game.',
  'bandas.nObservePlus': '👁 {nom} stopped watching the game.',
  'bandas.equipe': 'team {n}',
  'bandas.aChoisi': '{nom} picked a card',
  'bandas.choisissezCarte': 'Pick a card',
  'bandas.confisque': "{nom} confiscates {autre}'s card!",
  'bandas.celeriteMoi': 'Second Wave: your turn again!',
  'bandas.celeriteJoueur': 'Second Wave: {nom} moves again!',
  'bandas.celeriteAdversaire': 'Second Wave: your opponent moves again!',
  'bandas.choisissezCible': 'Choose a target for “{carte}” (Esc to cancel)',
  'bandas.toucheCase': 'Tap a square for “{carte}”',
  'bandas.carteAnnulee': 'Card cancelled.',
  'bandas.horsPlateau': 'You clicked outside the board, card cancelled!',
  'bandas.cibleLibre': 'You must target an empty square!',
  'bandas.cibleFruit': 'You must target a fruit!',
  'bandas.cibleMonFruit': 'You must target one of your own fruits!',
  'bandas.confirmerAbandon': 'Do you want to give up the game?',

  // ── La fin de partie ────────────────────────────────────────────────────
  'bandas.quitterPartie': 'Leave the game',
  'bandas.nulRepetition': "Draw! The same position for the third time: the game is going round in circles.",
  'bandas.nulBlocage': 'Draw! Twenty moves each without a single fruit falling: the game is stuck.',
  'bandas.nulVachette': 'Draw! The Cow wins…',
  'bandas.nulChallenge': '{nul}\nYou still have a chance in the challenge.',
  'bandas.aGagne': 'The game is over, {nom} won!',
  'bandas.remporte': '{nom} wins the game.',
  'bandas.plusUnSerie': '+1 to your streak!',
  'bandas.perdu': 'You lost!\nSee you soon in the Frutibandas challenge.',

  // ── Connexion, états, refus ─────────────────────────────────────────────
  'bandas.sessionManquante': 'Missing session (?sid=).',
  'bandas.sessionInvalide': 'Invalid session.',
  'bandas.reseau': 'Network unavailable.',
  'bandas.identification': 'Signing in…',
  'bandas.reconnexion': 'Reconnecting…',
  'bandas.connecte': 'Connected — {nom}',
  'bandas.partieTerminee': 'This game has just ended.',
  'bandas.moteur': 'Engine unavailable (engine.js).',
  'bandas.fdAdversaire': "Your opponent has no Challenge discs left today. Suggest some practice against the bots (always free), or try again tomorrow.",
  'bandas.fdMoi': "Great Pamplefrousse! You've lost all your Challenge discs for today! Keep practising against the bots for free, try again tomorrow or buy a pass in the shop!",
});
