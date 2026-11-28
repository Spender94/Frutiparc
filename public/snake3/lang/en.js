/*
 * DICTIONNAIRE ANGLAIS — FRUTISNAKE (public/snake3/*.js).
 * Voir /js/i18n.js : le français est écrit dans le code (argument de repli de
 * T(), le pont est dans const.js), ici seulement l'anglais. Chargé par la page
 * du jeu, en anglais seulement, AVANT const.js qui en tire ses textes :
 * FPI18n.charger(['commun', 'widgets', '/snake3/lang/{lang}.js']).
 *
 * Ce qui reste en français, choix de l'admin (« l'interface d'abord, les jeux
 * de mots plus tard ») : les 322 noms de fruits (const.js, FRUIT_NAMES),
 * « Encyclopéfruit », « Frutibarre ».
 *
 * LES FONTES : le canevas écrit dans les fontes du SWF. Verdana12St et Alba
 * sont complètes ; Verdana14St n'a que l'ASCII ; Verdana12StB n'a que les
 * lettres, les chiffres, l'espace, le point et le Latin-1 (ni « : », ni
 * « ! », ni « ? », ni « ' », ni « - », ni parenthèses) : ses entrées anglaises
 * s'en passent (« player 1 », « · you »).
 *
 * Les dessins qui portent du français gravé ont une version nue dans
 * sprites/en/ (scripts/build-snake3-anglais.js) ; `snake3.dessins` dit à
 * dessin.js lesquels substituer, et le jeu écrit l'anglais par-dessus.
 */
FPI18n.ajouter('en', {
  // ── Les images sans texte gravé (dessin.js) : clip → image → fichier ────
  'snake3.dessins': {
    menu: { 5: 'en/menu005.svg', 9: 'en/menu009.svg' },
    screensSans: { 15: 'en/screensSans015.svg', 24: 'en/screensSans024.svg', 32: 'en/screensSans032.svg' },
    pageSans: { 1: 'en/pageSans001.svg', 2: 'en/pageSans002.svg', 3: 'en/pageSans003.svg', 4: 'en/pageSans004.svg' },
  },

  // ── Les textes du jeu (const.js) ────────────────────────────────────────
  'snake3.couleurs': ['green', 'red', 'yellow', 'orange'],
  'snake3.egalite': "It's a draw!",
  'snake3.serpentGagne': 'The {couleur} snake wins!',
  'snake3.encyclo.aucun': 'None ',
  'snake3.encyclo.devine': 'Guess ',
  'snake3.patienter': 'Please wait a moment.',
  'snake3.demarrage': 'Starting the game...',
  'snake3.erreur': 'ERROR!',
  'snake3.sauvegarde': 'Saving...',
  'snake3.resultatsMatch': 'Match results:',
  'snake3.recordBattu': 'Well done! You beat your record!',
  'snake3.votreScore': 'Your score: {score}',
  'snake3.votreRecord': 'Your personal best: {score}',
  'snake3.votrePlace': 'Your rank today: {place}',
  'snake3.placeGagnee': 'You moved up one place in the rankings!',
  'snake3.placesGagnees': 'You moved up {n} places in the rankings!',
  'snake3.scorePerdu': 'WARNING: score NOT saved!',
  'snake3.motif.refuse': 'The server rejected this score.',
  'snake3.motif.carte': 'The tournament map changed during the game.',
  'snake3.motif.ferme': 'The tournament closed during the game.',
  'snake3.motif.session': 'Your session expired: please log in again.',
  'snake3.motif.classement': 'Ranking not found.',
  'snake3.motif.horsLigne': 'Log in to save your scores.',
  'snake3.motif.reseau': "The server didn't respond.",
  // Trois lignes, pas une de plus : le panneau de fin n'en loge que trois
  // sous celles qui précèdent (const.js).
  'snake3.sansFd': "Today's ranked games are used up.\n"
    + 'This score is still your record, unranked.\n'
    + 'A daily Pass (Shop) adds one more.',
  'snake3.fruitGagne': 'Well done! You picked up {n} "{nom}" fruits!\nYou can now use this fruit on the Forum!',
  'snake3.fruitInconnu': ' Unknown ',
  'snake3.fruitEnCours': 'Analyzing...',

  // ── Le menu (menu.js) ───────────────────────────────────────────────────
  'snake3.menu.championnat': 'CHAMPIONSHIP',
  'snake3.menu.unContreUn': '1 vs 1 online',
  'snake3.menu.retour': 'back',
  'snake3.menu.entrainement': 'training',
  // Le panneau des options (Verdana14St : l'ASCII ; Verdana12StB : sans ponctuation).
  'snake3.options.musique': 'music',
  'snake3.options.sons': 'sound effects',
  'snake3.options.controles': 'Controls:',
  'snake3.options.retour': 'Back to Menu >',
  'snake3.options.joueur': 'player {n}',
  'snake3.options.activee': 'on',
  'snake3.options.desactivee': 'off',
  'snake3.options.actives': 'on',
  'snake3.options.desactives': 'off',
  'snake3.touche.gauche': 'left',
  'snake3.touche.droite': 'right',
  'snake3.touche.haut': 'up',
  'snake3.touche.bas': 'down',
  'snake3.touche.espace': 'space',
  'snake3.touche.pav': 'pad {n}',

  // ── Les écrans (game.js) : les titres gravés, redessinés ────────────────
  'snake3.ecran.connexion': 'Connecting',
  'snake3.ecran.resultat': 'Results',
  'snake3.ecran.nouveauFruit': 'New Fruit',

  // ── L'Encyclopéfruit (encyclo.js) ───────────────────────────────────────
  'snake3.encyclo.valeur': 'Value',
  'snake3.encyclo.quantite': 'Quantity',
  'snake3.encyclo.horsSerie': 'FrutiMag special issue',
  'snake3.encyclo.edition': '2004 Edition',
  'snake3.encyclo.sommaire': 'CONTENTS',
  // Le bilan du sommaire, coupé en lignes à la main (Alba 14, une page de
  // large) ; le pluriel anglais met 0 au pluriel, 1 au singulier.
  'snake3.encyclo.bilan': (p) => {
    const s = (n) => (Number(n) === 1 ? '' : 's');
    return 'You have picked up ' + p.fruits + ' fruit' + s(p.fruits) + '.\n\n'
      + 'You have ' + p.especes + ' fruit' + s(p.especes) + ' out of a collection\n'
      + 'of ' + p.total + ' in all.\n\n'
      + 'You have discovered the names\n'
      + 'of ' + p.noms + ' fruit' + s(p.noms) + ' (' + p.pourcent + '% discovered).\n\n'
      + 'Your biggest fruit earned\n'
      + 'you ' + p.points + ' point' + s(p.points) + '.';
  },

  // ── Le championnat en ligne (enligne.js, reseau.js) ─────────────────────
  'snake3.salon.titre': 'Online championship — 1 vs 1',
  'snake3.salon.chercher': 'Find an opponent',
  'snake3.salon.annuler': 'Cancel search…',
  'snake3.salon.retour': '‹ Back to menu',
  'snake3.salon.consigne': 'Players here — tap a username to challenge them',
  'snake3.salon.connexion': 'Connecting…',
  'snake3.salon.identification': 'Logging in…',
  'snake3.salon.reconnexion': 'Reconnecting…',
  'snake3.salon.connecte': 'Connected',
  'snake3.salon.errNonConnecte': 'Log in to Frutiparc to play online.',
  'snake3.salon.errOccupe': 'This player is already in a game.',
  'snake3.salon.errDejaEnPartie': "You're already in a game.",
  'snake3.salon.errParti': 'This player has left.',
  'snake3.salon.errToiMeme': 'Challenge yourself? Nope.',
  'snake3.salon.note': { one: 'Your rating: {note} ({n} game)', other: 'Your rating: {note} ({n} games)' },
  'snake3.salon.notePlacement': 'Your rating: {note} (placement)',
  'snake3.salon.disponible': 'available',
  'snake3.salon.cherche': 'looking for an opponent',
  'snake3.salon.enPartie': 'in a game',
  'snake3.salon.entrainement': 'training',
  'snake3.salon.toi': 'you',
  'snake3.salon.personne': 'Nobody here yet…',
  'snake3.duel.gagne': 'You won!',
  'snake3.duel.abandon': '{nom} gave up.',
  'snake3.duel.adversaire': 'Your opponent',
  'snake3.duel.note': 'Your rating: {note} ({ecart})',
  'snake3.duel.entrainement': "Training: your rating doesn't change.",
  'snake3.duel.toi': '· you',
  'snake3.duel.tuEs': 'You are the {couleur} snake',
  'snake3.duel.pret': 'Ready?',

  // ── Le tableau de bord du pack (pack.js) : intitulé, et son abrégé ──────
  'snake3.pack.longueur': 'Length',
  'snake3.pack.longueurCourt': 'Length',
  'snake3.pack.fruits': 'Fruits eaten',
  'snake3.pack.fruitsCourt': 'Fruits',
  'snake3.pack.dynamites': 'Dynamite',
  'snake3.pack.dynamitesCourt': 'Dynamite',
  'snake3.pack.bonus': 'Bonus time left',
  'snake3.pack.bonusCourt': 'Bonus',
  'snake3.pack.chrono': 'Game time',
  'snake3.pack.chronoCourt': 'Time',
  'snake3.pack.vitesse': 'Speed',
  'snake3.pack.vitesseCourt': 'Speed',

  // ── La page (index.html) ────────────────────────────────────────────────
  'snake3.tourne': 'Turn your phone: Frutisnake is much bigger in landscape.',
});
