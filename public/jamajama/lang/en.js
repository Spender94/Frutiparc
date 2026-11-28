/*
 * DICTIONNAIRE ANGLAIS — JAMAJAMA (public/jamajama/*.js).
 * Voir /js/i18n.js : le français est écrit dans le code (argument de repli de
 * T()), ici seulement l'anglais. Chargé par la page du jeu, en anglais
 * seulement : FPI18n.charger(['commun', 'widgets', '/jamajama/lang/{lang}.js']).
 *
 * Ce qui reste en français, choix de l'admin (« l'interface d'abord, les jeux
 * de mots plus tard ») : les noms des packs et les titres des niveaux de
 * l'Aventure (Games/poulpi/levels.xml), les niveaux des joueurs. Les noms des
 * personnages (Tiki, Louki, Kohl, Winkle…) ne changent pas.
 *
 * LES FONTES : les champs s'écrivent dans les fontes du SWF, souvent réduites
 * à l'ASCII (Arial, VerdanaPixel, Verdana12 : 95 glyphes ; Jester : l'ASCII
 * plus é et ê). L'anglais s'y tient : apostrophe droite, ni accent ni
 * guillemet typographique.
 *
 * L'AIDE (le grand texte HTML) n'est pas ici : c'est Games/poulpi/help-en.xml,
 * que le serveur sert quand la page demande l'anglais (/api/jamajama/aide?lang=en).
 * Les textes FIGÉS du SWF (le lettrage du menu, les titres des fenêtres de
 * l'éditeur) sont redessinés dans sprites/paquet-en.json
 * (scripts/build-jamajama-anglais.js).
 */
FPI18n.ajouter('en', {
  // ── La partie (jeu.js) ──────────────────────────────────────────────────
  'jamajama.fantome': 'Ghost',
  'jamajama.recommencer': 'You lost! Restart the level?',
  'jamajama.abandonner': 'Give up this game?',
  'jamajama.chargementImpossible': 'Loading failed: {erreur}',

  // ── Les dialogues et les options (ecrans.js) ────────────────────────────
  'jamajama.oui': 'yes',
  'jamajama.non': 'no',
  'jamajama.encore': 'retry',
  'jamajama.optionDebut': 'Level start animation',
  'jamajama.optionFin': 'Level end animation',
  'jamajama.sauver': 'Save',
  'jamajama.annuler': 'Cancel',

  // ── L'éditeur (edition.js) ──────────────────────────────────────────────
  'jamajama.valider': 'confirm',
  'jamajama.annulerMin': 'cancel',
  'jamajama.retour': 'back',
  'jamajama.supprimer': 'Delete the level "{titre}"?',
  'jamajama.sauverAvantQuitter': 'Save before quitting?',
  'jamajama.validerAvertissement': 'Win the level to validate it: other players will then be able to play it.',
  'jamajama.vide': '... empty ...',
  'jamajama.sansNom': 'untitled',
  'jamajama.erreurPlein': 'All your slots are taken: delete a level.',
  'jamajama.erreurValide': 'This level is validated: it can no longer be changed.',
  'jamajama.erreurContenu': 'The server rejected this level.',
  'jamajama.erreurPerdu': "The server didn't see the win: validation refused.",
  'jamajama.erreurSession': 'Session expired: reload the game.',
  'jamajama.erreurHorsLigne': 'Not on the site: nothing gets saved.',
  'jamajama.erreurReseau': 'The server is not responding.',

  // ── Les statistiques (stats.js) : les quatre onglets ────────────────────
  'jamajama.onglet.P': 'Players',
  'jamajama.onglet.C': 'Creators',
  'jamajama.onglet.L': 'Levels',
  'jamajama.onglet.O': 'My levels',

  // ── Les textes par défaut des champs du SWF (rendu.js), par numéro ──────
  // La fiche d'un niveau (jama_gui_LevelInfo, deux images).
  'jamajama.champ.743': 'Author:',
  'jamajama.champ.745': 'Created:',
  'jamajama.champ.747': 'Plays:',
  'jamajama.champ.749': 'Wins:',
  'jamajama.champ.751': 'Difficulty:',
  'jamajama.champ.754': 'Author:',
  'jamajama.champ.756': 'Created:',
  'jamajama.champ.758': 'Plays:',
  'jamajama.champ.760': 'Wins:',
  'jamajama.champ.762': 'Difficulty:',
  // L'en-tête des listes (tournoi, éditeur, statistiques).
  'jamajama.champ.786': 'difficulty',
  'jamajama.champ.788': 'level name',
  'jamajama.champ.800': 'search',
  // Les fenêtres que le portage n'ouvre pas, pour le jour où il les ouvrira.
  'jamajama.champ.404': 'Tip: if you get stuck in a level, the "Esc" key is your friend.',
  'jamajama.champ.406': 'yes',
  'jamajama.champ.434': 'A moderator has taken away your level-creation rights.',
  'jamajama.champ.533': 'My levels',
});
