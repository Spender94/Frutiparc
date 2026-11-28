/*
 * DICTIONNAIRE ANGLAIS — BURNING KIWI (public/bkiwi/). Voir /js/i18n.js : le
 * français est écrit dans le code (argument de repli de T()), ici seulement
 * l'anglais. Chargé par index.html (FPI18n.charger) quand la langue est
 * l'anglais. Glossaire du parc : /i18n/en/commun.js.
 *
 * LES JEUX DE MOTS ET LES LIEUX RESTENT FRANÇAIS POUR L'INSTANT (choix de
 * l'admin) : la FrutiCoupe, les Terres Grises ; les noms des circuits, des
 * écuries et des voitures ne changent pas (Green Hill, UWE Wing, KiwiX…).
 *
 * Entrées :
 *   · `bkiwi.noms` : les étiquettes du menu (titres des pages, boutons,
 *     panneaux de refus), par leur français — le jeu garde ses libellés ;
 *   · `bkiwi.champ.<id>` : le texte par défaut d'un champ du SWF ;
 *   · `bkiwi.fige.<id>` : un texte FIGÉ (cuit en formes dans data/bkiwi.json),
 *     récrit par le moteur dans la même fonte — voir data/figes.json et
 *     `node scripts/textes-figes.js --liste`. Une ligne par « \n ».
 *
 * La police 911 Porscha (les boutons, les titres, « BON DEPART ») n'a pas
 * F G H J K L M S V W X Y Z en capitales : l'anglais s'y écrit en minuscules
 * (« good start », « lap »), comme le jeu écrit déjà ses boutons.
 */
(function () {
  'use strict';

  // Les petits champs HTML du SWF (Verdana noire ou blanche).
  const p = (align, taille, couleur, lignes) => '<p align="' + align + '"><font face="Verdana" size="' + taille + '" color="' + couleur + '">'
    + [].concat(lignes).join(' <sbr />') + '</font></p>';

  FPI18n.ajouter('en', {
    // ── La page (index.html) ────────────────────────────────────────────
    'bkiwi.chargement': 'Loading Burning Kiwi…',
    'bkiwi.echecDemarrage': 'Burning Kiwi could not start: {erreur}',
    'bkiwi.doigt.aria': 'Switch finger mode',
    'bkiwi.doigt.boutonDevant': 'Finger ahead',
    'bkiwi.doigt.boutonDerriere': 'Finger behind',
    'bkiwi.doigt.devant': '<b>Touch the track</b> where you want to go: the car heads there and speeds up as long as your finger stays down.',
    'bkiwi.doigt.derriere': '<b>Put your finger behind the car</b>: it heads the other way, as if you were pushing it, and speeds up as long as your finger stays down.',
    'bkiwi.doigt.suite': '<br><b>Second finger down</b>: brake, for as long as it stays. <b>Double-tap</b>: nitro.',

    // ── Le menu (jeu/menu.js) ───────────────────────────────────────────
    'bkiwi.noms': {
      // Les titres des pages.
      'modes de jeu': 'game modes', options: 'options', courses: 'tracks', voitures: 'cars',
      evolution: 'evolution', epreuves: 'events', extras: 'extras', palmares: 'trophies',
      touches: 'keys', 'menu principal': 'main menu', 'en ligne': 'online', adversaire: 'opponent',
      // Les boutons (le jeu les écrit en minuscules).
      essais: 'practice', challenge: 'challenge', tutorial: 'tutorial', retour: 'back', jouer: 'play',
      'details: auto': 'details: auto', 'details: hauts': 'details: high', 'details: moyen': 'details: medium',
      'details: bas': 'details: low', 'interface: oui': 'interface: on', 'interface: non': 'interface: off',
      'sons: oui': 'sounds: on', 'sons: non': 'sounds: off', 'musique: oui': 'music: on', 'musique: non': 'music: off',
      valider: 'confirm', normales: 'normal', Temps: 'times', Coupes: 'cups', TimeTrial: 'time trial',
      // Les panneaux de refus.
      'PAS ENCORE DEBLOQUE': 'NOT UNLOCKED YET', 'PROTOTYPE INACCESSIBLE': 'PROTOTYPE LOCKED',
      'FRUTICOUPE NECESSAIRE': 'FRUTICOUPE NEEDED', 'INSCRIVEZ-VOUS AU PARC': 'SIGN UP TO THE PARK',
      'CONNECTEZ-VOUS AU PARC': 'LOG IN TO THE PARK',
    },
    'bkiwi.info.entrainement': 'The track is yours! Unlimited practice on the daily race!',
    'bkiwi.info.challenge': 'Set the best time on the daily race',
    'bkiwi.info.tutoriel': 'Learn how to play and practise freely',
    'bkiwi.info.evolution': 'Unlock new features',
    'bkiwi.info.epreuves': 'Take part in the events held on Frutiparc!',
    'bkiwi.info.enLigne': 'Race online against other drivers from the park, in the X Violet!',
    'bkiwi.info.duel': 'Take on a team to win their car',
    'bkiwi.info.timeTrial': 'Exclusive access to the tracks for races against the clock!',
    'bkiwi.info.fruticoupe': 'Win the FrutiCoupe to unlock new game modes',
    'bkiwi.info.elite': 'Unlock the tracks and the XL cups in this endurance tournament!',
    'bkiwi.info.ghostRun': 'Take on your worst rival: yourself!',
    'bkiwi.info.kiwiRun': 'Grab the bonuses scattered on the track as fast as you can!',
    'bkiwi.info.adversaire': 'Choose the team you will take on.',
    'bkiwi.commandes': ['Accelerate', 'Brake', 'Turn left', 'Turn right', 'Kiwi-Boost'],
    'bkiwi.tour': '{n} lap',
    'bkiwi.tours': '{n} laps',
    'bkiwi.resume.0': 'Frutiz driver, warm up those kiwis! The Green Hill road is known for its reckless speeds...',
    'bkiwi.resume.1': 'Legend has it the designer of Banana Derby ended up in a psychiatric ward... Go figure!',
    'bkiwi.resume.2': 'The forests of the Terres Grises belong to the Noisettines. But no time to stop: the podium awaits!',
    'bkiwi.resume.3': "Solstice's cold won't spare you: get your mittens on and keep those kiwis nice and warm!",
    'bkiwi.resume.4': 'Now boarding for the colony on the asteroid Jupiter IV, in the Kiwi constellation!',
    'bkiwi.resume.5': 'The final stretch before glory! Sunshine, good cheer and kiwi sorbet await at the end of the road!',
    'bkiwi.resume.99': 'Make the most of this private track to test your car!',
    'bkiwi.chargementIntro': 'Loading the intro',
    'bkiwi.chargementCourse': 'Loading the race',
    'bkiwi.chargementMusique': 'Loading the music',
    'bkiwi.code.active': 'on',
    'bkiwi.code.desactive': 'off',
    'bkiwi.memeTemps': 'Same time!',
    'bkiwi.coupe.eliteArgent': 'Silver Elite Cup',
    'bkiwi.coupe.frutiArgent': 'Silver FrutiCoupe',
    'bkiwi.coupe.eliteOr': 'Gold Elite Cup',
    'bkiwi.coupe.frutiOr': 'Gold FrutiCoupe',

    // ── Les fins de course (jeu/final.js) ───────────────────────────────
    'bkiwi.fin.bilanCourse': 'RACE REPORT',
    'bkiwi.fin.bilanTournoi': 'TOURNAMENT REPORT',
    'bkiwi.fin.progresUne': 'You climbed 1 place',
    'bkiwi.fin.progres': 'You climbed {n} places!',

    // ── Les pannes (J.fatal, plateforme.js) ─────────────────────────────
    'bkiwi.panne.arret': 'The game has stopped',
    'bkiwi.panne.relancer': 'Restart the game',
    'bkiwi.panne.taille': 'Your frusion cannot display this game properly',
    'bkiwi.panne.courseDuJour': 'The grand jury has not picked the daily race',
    'bkiwi.panne.chrono': 'Stopwatch failure',
    'bkiwi.panne.fichierFd': 'File not found on this FD',
    'bkiwi.panne.surchauffe': 'Engine overheating',
    'bkiwi.panne.musique': 'Music not found',
    'bkiwi.panne.fichier': 'File not found',
    'bkiwi.panne.telechargement': 'Download interrupted',
    'bkiwi.panne.fichierNomme': 'File {nom} not found on the FD',

    // ── La course en ligne (multi.js) ───────────────────────────────────
    'bkiwi.multi.titre': 'Burning Kiwi online',
    'bkiwi.multi.ouvertes': 'Open races',
    'bkiwi.multi.aucune': 'No race yet: open your own!',
    'bkiwi.multi.courseDe': "{hote}'s race",
    'bkiwi.multi.enCourse': 'racing',
    'bkiwi.multi.rejoindre': 'Join',
    'bkiwi.multi.auStand': 'Drivers in the pits',
    'bkiwi.multi.personne': 'nobody',
    'bkiwi.multi.ouvrir': 'Open a race',
    'bkiwi.multi.maVoiture': 'My car: {nom}',
    'bkiwi.multi.retour': 'Back',
    'bkiwi.multi.circuit': 'track {n}',
    'bkiwi.multi.libelleCircuit': 'Track:',
    'bkiwi.multi.derniere': 'Last race',
    'bkiwi.multi.abandon': 'retired',
    'bkiwi.multi.pilotes': 'Drivers ({n}/4)',
    'bkiwi.multi.vous': '(you)',
    'bkiwi.multi.hote': 'host',
    'bkiwi.multi.pret': 'ready',
    'bkiwi.multi.pasPret': 'not ready',
    'bkiwi.multi.lancer': 'Start the race',
    'bkiwi.multi.pretAnnuler': 'Ready! (cancel)',
    'bkiwi.multi.jeSuisPret': "I'm ready",
    'bkiwi.multi.enCours': 'The race is on…',
    'bkiwi.multi.quitter': 'Leave the room',
    'bkiwi.multi.conseilHote': "You're the host: pick the track, and start when everyone is ready.",
    'bkiwi.multi.note': "The other cars pass through each other: no collisions online. Nothing is ranked, it's just for fun.",
    'bkiwi.multi.classementFinal': 'FINAL RANKING',
    'bkiwi.multi.classementEnCours': 'RANKING (IN PROGRESS)',
    'bkiwi.multi.erreur': 'Error: {code}',
    'bkiwi.multi.erreur.salon-plein': 'This room is full (four drivers).',
    'bkiwi.multi.erreur.salon-inconnu': 'This room no longer exists.',
    'bkiwi.multi.erreur.course-en-cours': 'The race has already started.',
    'bkiwi.multi.erreur.pas-prets': 'Not everyone is ready.',
    'bkiwi.multi.erreur.seul': 'You need at least two drivers.',
    'bkiwi.multi.erreur.pas-l-hote': 'Only the host can do that.',
    'bkiwi.multi.erreur.not-logged': 'You need to be logged in to the park.',

    // ── Les champs du SWF (data/bkiwi.json) ─────────────────────────────
    'bkiwi.champ.215': p('left', 18, '#000000', 'Grip'),
    'bkiwi.champ.216': p('left', 17, '#000000', 'Acceleration'),
    'bkiwi.champ.217': p('left', 17, '#000000', 'Speed'),
    'bkiwi.champ.218': p('left', 18, '#000000', 'Handling'),
    'bkiwi.champ.219': p('left', 18, '#000000', 'Kiwi boost'),
    'bkiwi.champ.241': p('center', 14, '#000000', ['Using secret codes in the game', 'stops your scores from being saved', '(Arcade), voids Evolution tournaments', '(FrutiCoupe and Elite) and stops'])
      + p('center', 14, '#000000', ['your personal times from being', 'saved in TimeTrial mode.']),
    'bkiwi.champ.277': '<p align="center"><font face="Arial" size="14" color="#ffffff">click to continue</font></p>',
    'bkiwi.champ.294': p('center', 12, '#ffffff', 'Press "P"'),

    // ── Les textes figés (data/figes.json) ──────────────────────────────
    // 911 Porscha : les minuscules, faute de capitales.
    'bkiwi.fige.121': 'lap',
    'bkiwi.fige.128': 'start',
    'bkiwi.fige.232': 'info',
    'bkiwi.fige.283': 'yes',
    'bkiwi.fige.284': 'no',
    'bkiwi.fige.287': 'QUIT ?',
    'bkiwi.fige.595': 'Connecting',
    'bkiwi.fige.613': '! super start !',
    'bkiwi.fige.615': 'good start',
    // Denmark.
    'bkiwi.fige.240': 'WARNING',
    'bkiwi.fige.270': 'DAILY RACE',
    'bkiwi.fige.300': 'RANKINGS',
    'bkiwi.fige.311': 'Team',
    'bkiwi.fige.312': 'Your time:',
    'bkiwi.fige.333': 'FILE NOT FOUND',
    'bkiwi.fige.359': 'Statistics',
    'bkiwi.fige.380': 'Best lap',
    'bkiwi.fige.382': 'Time',
    'bkiwi.fige.384': 'Team',
    'bkiwi.fige.385': 'PERFECT RACE!',
    'bkiwi.fige.388': 'Track',
    'bkiwi.fige.391': 'Off-track',
    'bkiwi.fige.395': 'Perfect laps',
    'bkiwi.fige.407': 'LIVES LEFT',
    'bkiwi.fige.408': 'You must finish in first\nplace to carry on.',
    'bkiwi.fige.409': 'You must finish in first\nplace to carry on. Your\nposition costs you 1 life!',
    'bkiwi.fige.410': 'Well done! You qualify\nfor the next race!',
    'bkiwi.fige.439': 'WELL DONE!',
    'bkiwi.fige.440': 'You have won the\nSilver Elite Cup!\nTwo new secret races\nare now open to you!',
    'bkiwi.fige.445': 'You have won the\nGold Elite Cup!\nYou kept your cool\nall the way and showed your\nexceptional driving talent!',
    'bkiwi.fige.448': 'You have won the\nSilver FrutiCoupe!\nThe Duel and Elite modes\nare now open to you!',
    'bkiwi.fige.452': 'You have won the\nGold FrutiCoupe!\nYour perseverance and your\ndriving gift have made you\nthe reigning Frutiz champion!',
    'bkiwi.fige.463': 'WINS',
    'bkiwi.fige.467': 'Time',
    'bkiwi.fige.486': 'Best lap',
    'bkiwi.fige.487': 'Best race',
    'bkiwi.fige.489': 'Rankings',
    'bkiwi.fige.490': 'Congratulations! Your new\nFrutiparc ranking is:',
    'bkiwi.fige.493': 'Your time:',
    'bkiwi.fige.495': "You didn't climb any places\nin the Frutiparc rankings:",
    'bkiwi.fige.499': 'You now have access to the\nofficial racer of a new team!',
    'bkiwi.fige.559': 'Click the keys you want to change',
    'bkiwi.fige.560': 'Two actions share a key!',
    'bkiwi.fige.567': 'Press the key on the keyboard\nthat you want to use to',
    'bkiwi.fige.569': '(press ESC to cancel)',
    // Les Verdana pixellisées : la Verdana grasse du système, faute de « w ».
    'bkiwi.fige.584': 'New record!',
    'bkiwi.fige.587': 'Race record',
    // Droid (trois lettres : E, R, U) : une grasse du système.
    'bkiwi.fige.331': 'ERROR',
  });
})();
