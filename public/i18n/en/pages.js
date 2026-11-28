/*
 * DICTIONNAIRE ANGLAIS — LES PETITES PAGES (reset, pictos, game-popup, ruffle…).
 * Voir /js/i18n.js : le français est écrit dans le code (argument de repli de
 * T()), ici seulement l'anglais. Glossaire du parc : voir commun.js.
 *
 * Les entrées en { one, other } sont des pluriels (T.n). Celles qui portent
 * du HTML (data-i18n-html) gardent les mêmes balises que la page française.
 */
FPI18n.ajouter('en', {
  // ── L'accueil d'origine (index.html) ────────────────────────────────────
  'pages.indexSousTitre': 'The 2000s Flash games site — emulated with Ruffle',
  'pages.indexEntrer': 'Enter Frutiparc',
  'pages.indexVersionFlash': 'Flash version',

  // ── Nouveau code secret (reset.html) ────────────────────────────────────
  'pages.resetTitrePage': 'Frutiparc — New secret code',
  'pages.resetNouveauCode': 'New secret code',
  'pages.resetTag': 'Frutiparc · reset',
  'pages.resetConfirme': 'Confirm your secret code',
  'pages.resetChanger': 'Change my secret code',
  'pages.resetAllerConnexion': '→ Go to login',
  'pages.resetRetourAccueil': 'Back to the home page',
  'pages.resetLienInvalide': 'Invalid or incomplete link. Request a new one from the home page.',
  'pages.resetLongueur': 'Your secret code must be 6 to 80 characters long.',
  'pages.resetDifferents': "The two codes don't match.",
  'pages.resetChangement': 'Changing…',
  'pages.resetEchec': 'Reset failed.',
  'pages.resetChange': 'Your secret code has been changed. You can log in now.',
  'pages.resetErreurReseau': 'Network error. Please try again.',

  // ── Le stockage local d'un jeu (reset-game-storage.html) ────────────────
  'pages.stockageTitrePage': "Frutiparc — Reset a game's local storage",
  'pages.stockageTitre': "Reset a game's local storage",
  'pages.stockageIntro1': 'This page erases the Flash <em>SharedObject</em> data that Ruffle keeps in your browser\'s <code>localStorage</code>, game by game. Use it when your local game is out of sync with the server save (typical case: an old, corrupted game that lives on in normal mode while a new session works fine in private browsing).',
  'pages.stockageIntro2': "The site's other data (session cookie, admin key, etc.) is NOT touched.",
  'pages.stockageChoisis': 'Pick a game:',
  'pages.stockageLister': 'List all localStorage keys',
  'pages.stockageToutEffacer': 'Erase ALL Ruffle SharedObjects',
  'pages.stockagePied': 'Once the purge is done, go back to <a href="/">/</a> and restart the game — it will start again from a blank map built from the server data.',
  'pages.stockageAucuneCle': 'No localStorage key matches {cles}. Nothing to erase.',
  'pages.stockageSupprimees': { one: '{n} key deleted:', other: '{n} keys deleted:' },
  'pages.stockageConfirmer': 'Erase ALL Ruffle SharedObjects (every game)?',
  'pages.stockageRuffleSupprimees': { one: '{n} Ruffle key deleted.', other: '{n} Ruffle keys deleted.' },
  'pages.stockageVide': '(localStorage is empty)',

  // ── Un picto (picto-view.html) et la galerie (pictos-gallery.html) ──────
  'pages.pictoTitrePage': 'Frutiparc picto',
  'pages.pictoChargement': 'Loading...',
  'pages.pictoIntrouvable': 'Picto not found.',
  'pages.pictoTitreNom': '{nom} - Frutiparc picto',
  'pages.pictoCodeForum': 'Forum code:',
  'pages.pictosTitrePage': 'My Pictos - Frutiparc',
  'pages.pictosChargement': 'Loading...',
  'pages.pictosAucun': 'No pictos yet.<br>Play the games to collect some!',
  'pages.pictosAutre': 'Other',
  'pages.pictosMesPictos': 'My Pictos',
  'pages.pictosNombre': { one: '{n} picto', other: '{n} pictos' },
  'pages.pictosTitreCompte': 'My Pictos ({n}) - Frutiparc',
  'pages.pictosErreur': "Couldn't load the pictos.",

  // ── La fenêtre des jeux Flash (game-popup.html) ─────────────────────────
  'pages.popupCoups': 'MOVES',
  'pages.popupAvantEtoile': 'TO STAR',
  'pages.popupLongueur': 'Length',
  'pages.popupFruitsAvales': 'Fruits eaten',
  'pages.popupDynamites': 'Dynamite',
  'pages.popupDureeBonus': 'Current bonus time',
  'pages.popupDureePartie': 'Game time',
  'pages.popupQuotaEpuise': "Holy Pamplefrousse! You've used up your Challenge games for today! Try your luck again tomorrow, or buy a pass in the shop!",
  'pages.popupPreavis': "You've used up today's Challenge games. You can keep playing as much as you like, but the scores of your next games won't be ranked in the Challenge. The Daily Pass (Shop, Pass section) adds one game a day, forever!",
  'pages.popupDezoomer': 'Zoom out (Ctrl+wheel)',
  'pages.popupZoomer': 'Zoom in (Ctrl+wheel)',
  'pages.popupTailleOrigine': 'Original size (Ctrl+0)',

  // ── Le bureau Flash (ruffle.html) : les fenêtres HTML par-dessus ────────
  'pages.ruffleVoirConnectes': "See who's online",
  'pages.ruffleEnLigne': '<span id="online-count">…</span> online<span id="online-today" style="display:none"><span style="opacity:.55;margin:0 5px">·</span><span id="online-today-n"></span> today</span>',
  'pages.ruffleConnectes': 'Online',
  'pages.ruffleCouper': 'Mute',
  'pages.ruffleEcouter': 'Listen',
  'pages.ruffleDepuisMinuitPic': {
    one: "{n} Frutiz since midnight — up to {pic} at once. Click to see who's online.",
    other: "{n} different Frutiz since midnight — up to {pic} at once. Click to see who's online.",
  },
  'pages.ruffleDepuisMinuit': {
    one: "{n} Frutiz since midnight. Click to see who's online.",
    other: "{n} different Frutiz since midnight. Click to see who's online.",
  },
  'pages.ruffleChargement': 'Loading…',
  'pages.ruffleNbConnectes': { one: '{n} online', other: '{n} online' },
  'pages.rufflePersonne': 'Nobody right now.',
  'pages.ruffleErreurChargement': "Couldn't load.",
  'pages.ruffleRechercher': 'Search for a Frutiz…',
  'pages.ruffleParBouille': 'by bouille',
  'pages.ruffleParBouilleTitre': 'Search by bouille rather than by username',
  'pages.rufflePeuImporte': '{champ}: any',
  'pages.ruffleToutEffacer': 'clear all',
  'pages.ruffleTous': 'All',
  'pages.ruffleNbFrutiz': '{n} Frutiz',
  'pages.ruffleNbRessemblantes': { one: '{n} lookalike', other: '{n} lookalikes' },
  'pages.rufflePage': 'page {p}/{total}',
  'pages.ruffleUnTrait': 'one feature off',
  'pages.ruffleTraits': '{n} features off',
  'pages.ruffleAucuneExacte': 'No bouille is an exact match.<br>Here are the closest lookalikes:',
  'pages.ruffleAucunFrutiz': 'No Frutiz matches.',
  'pages.ruffleTrombiVide': 'The yearbook is still empty.',
  'pages.ruffleEchecChargement': 'Frutiparc failed to load. Check your connection, then <a href="javascript:location.reload()" style="color:#ade76b">reload the page</a>.',
  'pages.ruffleBloque': 'Stuck at 9%? Refresh!',
  'pages.ruffleActualiser': 'Refresh',
});
