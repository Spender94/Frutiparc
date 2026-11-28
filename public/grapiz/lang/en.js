/*
 * DICTIONNAIRE ANGLAIS — GRAPIZ (public/grapiz/index.html).
 *
 * Chargé par FPI18n.charger('/grapiz/lang/{lang}.js') seulement quand la page
 * est en anglais ; le français reste écrit dans la page (argument de repli de
 * T(), ou texte du HTML marqué data-i18n). Une clé absente retombe sur le
 * français. Les entrées en { one, other } sont des pluriels (T.n).
 *
 * Le vocabulaire suit celui des widgets (/i18n/en/widgets.js) : « en différé »
 * → correspondence, championnat → championship, amical → friendly. Les noms
 * du jeu (Grapiz, Fruticonnect, Challenge) ne changent pas, ni le juron maison
 * « Pamplefrousse ».
 */
FPI18n.ajouter('en', {
  // ── L'écran des modes et le salon ───────────────────────────────────────
  'grapiz.connexion': 'Connecting…',
  'grapiz.championnat': 'CHAMPIONSHIP',
  'grapiz.amicaux': 'FRIENDLY MATCHES',
  'grapiz.aToiDeJouer': 'YOUR TURN',
  'grapiz.parties': 'GAMES',
  'grapiz.joueursMaj': 'PLAYERS',
  'grapiz.differeRegle': 'Correspondence · 3 days per move',
  'grapiz.differeNote': 'Correspondence · 3 days per move · your rating: <b>{note}</b>',
  'grapiz.creerPartie': 'Create a game',
  'grapiz.annulerPartie': 'Cancel the game',
  'grapiz.retour': 'Back',
  'grapiz.ongletJoueurs': 'Players',
  'grapiz.ongletDefis': 'Challenges',
  'grapiz.deplier': 'Expand',
  'grapiz.replier': 'Collapse',
  'grapiz.listeDefis': 'Challenge list',
  'grapiz.listeDefisDe': 'Challenges for {nom} ({n})',
  'grapiz.listeJoueurs': 'player list',
  'grapiz.ecrisMessage': 'Write a message…',
  'grapiz.cliqueJoueur': 'Click a player in the list on the right to see their status and challenge them.',
  'grapiz.disponible': 'Available',
  'grapiz.enAttente': 'Waiting',
  'grapiz.enPartie': 'Playing',
  'grapiz.quiJouent': { one: '{n} playing', other: '{n} playing' },
  'grapiz.nEnAttente': '{n} waiting',
  'grapiz.regardeUnePartie': 'Watching a game',
  'grapiz.defier': 'Challenge {nom}',
  'grapiz.rejoindre': 'Join {nom}',
  'grapiz.regarderPartie': 'Watch the game',
  'grapiz.estEnPartie': '{nom} is playing',
  'grapiz.partiesEnCours': 'Games in progress',
  'grapiz.contre': '{a} vs {b}',
  'grapiz.regarder': 'Watch',

  // ── Les parties en différé ──────────────────────────────────────────────
  'grapiz.titreDiffereChamp': 'CHAMPIONSHIP — CORRESPONDENCE',
  'grapiz.titreDiffereAmical': 'FRIENDLY MATCHES — CORRESPONDENCE',
  'grapiz.titreDiffere': 'CORRESPONDENCE',
  'grapiz.avertDiffere': "Correspondence game: you can close this window, the game will wait for you. Three days per move — you'll be notified when it's your turn.",
  'grapiz.noteDiffere': 'Correspondence game ({salle}): everyone plays whenever they drop by, three days per move.',
  'grapiz.raisonDelai': 'three-day limit exceeded',
  'grapiz.raisonAbandon': 'forfeit',
  'grapiz.raisonJetons': 'pieces connected',
  'grapiz.raisonElimination': 'elimination',
  'grapiz.victoireContre': '🏆 Victory against {qui}{pourquoi}.',
  'grapiz.defaiteDiffere': 'Defeat — {qui} wins{pourquoi}.',

  // ── La partie ───────────────────────────────────────────────────────────
  'grapiz.fermer': 'Close',
  'grapiz.fermerAttend': 'Close — the game will wait for you',
  'grapiz.abandonner': 'Forfeit the game',
  'grapiz.quitterObservateur': "Leave the game (you're watching it)",
  'grapiz.attention': "WARNING: F5, Alt-F4, Control-W and other keys close or reload Frutiparc and make you lose the game. Don't use them!",
  'grapiz.discuter': 'Chat…',
  'grapiz.chatLecture': 'Read-only chat (spectator)',
  'grapiz.muet': "Spectators can't chat in this game.",
  'grapiz.vousObservez': "You're watching {noms}'s game.",
  'grapiz.et': ' and ',
  'grapiz.spectateurs': { one: '{n} spectator', other: '{n} spectators' },
  'grapiz.spectateursListe': '👁 {qui}: {liste}',
  'grapiz.equipe': 'team {n}',
  'grapiz.remporte': '{qui} wins the game!',
  'grapiz.victoire': '🏆 Victory! +1 to your streak.',
  'grapiz.defaite': 'Defeat — {qui} wins. Streak over.',

  // ── Connexion, états, refus ─────────────────────────────────────────────
  'grapiz.sessionManquante': 'Missing session (?sid=).',
  'grapiz.sessionInvalide': 'Invalid session.',
  'grapiz.reseau': 'Network unavailable.',
  'grapiz.identification': 'Signing in…',
  'grapiz.reconnexion': 'Reconnecting…',
  'grapiz.connecte': 'Connected — {nom}',
  'grapiz.finPendantCoupure': 'The game ended while you were disconnected.',
  'grapiz.partieTerminee': 'This game has just ended.',
  'grapiz.reinscription': 'Rejoining the room…',
  'grapiz.moteur': 'Engine unavailable (engine.js).',
  'grapiz.fdAdversaire': "Your opponent has no Challenge discs left today. Suggest some practice against the bots (always free), or try again tomorrow.",
  'grapiz.fdMoi': "Great Pamplefrousse! You've lost all your Challenge discs for today! Keep practising against the bots for free, try again tomorrow or buy a pass in the shop!",
});
