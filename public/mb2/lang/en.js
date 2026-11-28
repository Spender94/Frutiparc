/*
 * DICTIONNAIRE ANGLAIS — MOTIONBALL 2 (public/mb2/). Voir /js/i18n.js : le
 * français est écrit dans le code (argument de repli de T()), ici seulement
 * l'anglais. Chargé par index.html (FPI18n.charger) quand la langue est
 * l'anglais. Glossaire du parc : /i18n/en/commun.js. Les noms (Tourneboule,
 * Motion-Ball, les TItems) ne changent pas.
 *
 * Entrées :
 *   · `mb2.champ.<id>` : le texte par défaut d'un champ du SWF ;
 *   · `mb2.fige.<id>` : un texte FIGÉ (cuit en formes dans data/mb2.json), que
 *     le moteur récrit dans la même fonte — voir data/figes.json et
 *     `node scripts/textes-figes.js --liste`. Une ligne par « \n », autant que
 *     le français en avait (les champs sont à taille fixe).
 */
FPI18n.ajouter('en', {
  // ── La page (index.html) ──────────────────────────────────────────────
  'mb2.chargement': 'Loading MotionBall…',
  'mb2.echecDemarrage': 'MotionBall could not start: {erreur}',
  'mb2.boutonBille': 'ball',
  'mb2.boutonPause': 'pause',

  // ── Les écrans (jeu/ecrans.js, jeu/manager.js) ────────────────────────
  'mb2.connexion': 'Connecting...',
  'mb2.niveau': 'level {n}',
  'mb2.fin.classique': 'Your score: level {score}\nYour record: level {record}',
  'mb2.fin.titemGagne': 'TItem won!!',
  'mb2.fin.record': 'Record broken!',
  'mb2.fin.places': 'You climbed {n} places.',
  'mb2.fin.pourcent': '{n} percent of the level completed',
  'mb2.fin.score': 'Your score: {n}',
  'mb2.fin.classement': 'Your rank: {n}',
  'mb2.fin.nouveauTitem': 'New TItem won!',
  'mb2.fin.pasClasse': "You're not ranked.",
  'mb2.fin.titems': '{n} titems won!',

  // ── Les champs du SWF (data/mb2.json) ─────────────────────────────────
  'mb2.champ.71': 'loading',
  'mb2.champ.140': 'Your score: 12789',
  'mb2.champ.141': 'Your score: 12789',
  'mb2.champ.230': 'classic',

  // ── Les textes figés (data/figes.json) ────────────────────────────────
  // Kiloton n'a que vingt-cinq lettres : une étroite du système.
  'mb2.fige.75': 'Click to\nPlay',
  'mb2.fige.237': '(esc to go back to the game)',
  // L'aide (les Arial pixellisées : l'Arial grasse du système).
  'mb2.fige.125': 'Help the poor ball find its way through a dreadful maze!',
  'mb2.fige.127': '- You lose when you run out of balls or out of time.\n'
    + '- You win if you find the exit in the shortest time\n'
    + 'possible: a big surprise awaits you there!\n'
    + '- Use the arrow keys to move.\n'
    + '- Once you have picked up new balls, press SPACE to\n'
    + 'switch between them.\n'
    + '- Press ESC to pause or to show the map (if you\n'
    + 'have picked it up).',
  'mb2.fige.128': 'In each room, pick up the red marbles to open the\n'
    + 'doors and carry on your adventure, but watch the\n'
    + 'clock! To help you on your quest, you can pick up\n'
    + 'new balls that let you perform new actions\n'
    + '(jumping over holes, smashing walls, ...).',
  'mb2.fige.130': 'ERROR',
  // Les fins de partie (Pleasantly Plump).
  'mb2.fige.134': 'You ran out\nof time!',
  'mb2.fige.135': 'You ran out\nof time!',
  'mb2.fige.137': 'You used up all\nyour balls!',
  'mb2.fige.138': 'You used up all\nyour balls!',
  'mb2.fige.142': 'You outsmarted the\ntraps of this dungeon!',
  'mb2.fige.143': 'You outsmarted the\ntraps of this dungeon!',
  // Les modes du menu (Sweet as candy).
  'mb2.fige.885': 'Who will be the fastest to clear\ntoday\'s dungeon',
  'mb2.fige.888': 'Destroy the four elementals\nand face the vile Tourneboule!',
  'mb2.fige.890': 'Master the 7 tracks and win the\nMotion-Ball trophies.',
  'mb2.fige.892': 'Discover the origin of Motion-ball\nand win its ultitem.',
  'mb2.fige.893': "Change your keys to your heart's content\nin the fabulous options section.",
});
