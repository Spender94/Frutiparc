/*
 * DICTIONNAIRE ANGLAIS — MINIWAVE 2 (public/miniwave/index.html, menu.js,
 * game.js).
 *
 * Chargé par FPI18n.charger('/miniwave/lang/{lang}.js') seulement quand la
 * page est en anglais ; le français reste écrit dans le code (argument de
 * repli de T() / tr()). Une clé absente retombe sur le français. Les tableaux
 * se traduisent d'un bloc (T.table), élément par élément.
 *
 * LE CHOIX DE L'ADMIN : l'interface d'abord, LES JEUX DE MOTS PLUS TARD. Ne
 * sont donc PAS ici : les ~430 noms de niveaux et de missions (levels.json),
 * les noms des ennemis (engine.js — « Batmandarine », « Orangre »…) et ceux
 * des vaisseaux, anagrammes de boissons (aliquet ← Tequila, gapatsa ←
 * Pastaga…). « level N », GAME OVER et BRAVO sont déjà de l'anglais.
 *
 * LES POLICES. Le canevas fait 240 × 240 et écrit dans les fontes du SWF :
 * la Jawbreaker (14 px) et la Verdana pixel (10 px) ont tout l'ASCII ;
 * l'Arcade Classic n'a que les chiffres, ABCDEINORSTUV et elv — rien ici ne
 * s'y écrit. Les rubriques du menu tiennent dans leurs encadrés de 100 px,
 * les textes du panneau d'accueil dans ses sept lignes de 100 px, le prix
 * « owned » dans sa case de 40 px.
 */
FPI18n.ajouter('en', {
  // ── La page (index.html) ────────────────────────────────────────────────
  'miniwave.zoneTactile': 'Touch control area',
  'miniwave.modeEmploi': 'slide your thumb — the ship follows it and fires<br>double-tap: special attack',
  'miniwave.couperSon': 'Mute',
  'miniwave.mettrePause': 'Pause',
  'miniwave.aide': '← → to move · space to fire · shift for the bomb · P to pause',
  'miniwave.rejouer': 'Play again',
  'miniwave.chargementImpossible': "can't load — reload the page",
  'miniwave.bravo': 'BRAVO!',
  'miniwave.finNiveau': '{score} points · level {n}',
  'miniwave.finPalier': '{score} points · stage {n}',
  'miniwave.nonEnregistree': 'Progress not saved.',
  'miniwave.horsCompte': 'Played without an account.',
  'miniwave.enregistree': 'Progress saved.',
  'miniwave.pictoLettres': 'picto Letters',
  'miniwave.espece': 'species {n}',
  'miniwave.debloque': 'Unlocked: {noms}!',
  'miniwave.mapInjoignable': "Today's map can't be reached — try again.",

  // ── Le menu (menu.js) ───────────────────────────────────────────────────
  // Les rubriques (encadrés de 100 px, Jawbreaker 14), le titre et le texte
  // du panneau de droite (Verdana pixel 10, sept lignes de 100 px au plus).
  'miniwave.rubrique.arcade': 'ARCADE',
  'miniwave.rubrique.bonus': 'BONUS',
  'miniwave.rubrique.special': 'SPECIAL',
  'miniwave.rubrique.challenge': 'CHALLENGE',
  'miniwave.rubrique.stand': 'SHOP',
  'miniwave.titre.arcade': 'action',
  'miniwave.titre.bonus': 'missions',
  'miniwave.titre.special': 'secret?',
  'miniwave.titre.challenge': 'challenge',
  'miniwave.titre.stand': 'shop',
  'miniwave.desc.arcade': 'Drive the mutant fruits back to the edge of the Fruniverse and earn Credits.',
  'miniwave.desc.bonus': 'Unlock and complete the 8 missions of bonus mode.',
  'miniwave.desc.special': "Discover the mini-airforce's most secret projects.",
  'miniwave.desc.challenge': 'A new map every day, harder and harder. The rankings keep your best score!',
  'miniwave.desc.stand': 'Spend your credits and upgrade your arsenal.',
  'miniwave.bienvenue': 'welcome',
  'miniwave.bonjour': 'Hello {grade}{nom}, choose your section.',
  'miniwave.bonsoir': 'Good evening {grade}{nom}, choose your section.',
  // Les treize grades (Manager.gradeName), dans l'ordre de P.GRADES.
  'miniwave.grades': ['Apprentice', 'Cadet', 'Cornet', 'Pilot', 'Patroller',
    'Squadron Leader', 'Sergeant', 'Major', 'Second Lieutenant', 'Lieutenant',
    'Captain', 'Commander', 'Colonel'],
  'miniwave.nouveauGrade': 'Congratulations, your new rank is: {grade}',
  'miniwave.meilleur': 'best: level {niveau} · {score} pts',
  'miniwave.jamaisJoue': 'never played',
  'miniwave.missionDetail': '{pourcent} % · bounty {prime} ¤',
  'miniwave.prime': 'bounty {prime} ¤',
  'miniwave.aAcheter': 'Buy it at the shop.',
  'miniwave.special.letter': 'No more shooting: type the letter each monster carries.',
  'miniwave.special.survival': 'Endless waves. Just one ship.',
  'miniwave.jamaisVuLeJour': 'This mode never saw the light of day.',
  'miniwave.mapIndisponible': "Today's map isn't available.",
  'miniwave.vaisseau': 'ship',
  'miniwave.unSeul': 'Only one {vaisseau} per squadron!',
  'miniwave.selectionEscadron': 'squadron selection',
  // Le stand : les articles qui ne se lisent pas pareil, et ce qu'ils ouvrent.
  'miniwave.article13': 'Wallpaper 1',
  'miniwave.article14': 'Wallpaper 2',
  'miniwave.ouvreVaisseau': 'ship {nom}',
  'miniwave.infoAcquis': '{nom} — {ouvre} (owned)',
  'miniwave.infoPrix': '{nom} — {ouvre} — {prix} ¤',
  'miniwave.acquis': 'owned',
  'miniwave.dejaAcquis': 'Already owned.',
  'miniwave.ilManque': "You're {manque} ¤ short",
  'miniwave.achete': '{nom} bought!',

  // ── La partie (game.js) ─────────────────────────────────────────────────
  'miniwave.alerteBoss': 'Warning! You are entering a high-risk zone: "Orangre", boss of the mutant fruits, has been detected in this sector...',
  'miniwave.felicitations': 'you have driven back the mutant fruit attack',
  'miniwave.palier': 'stage {n}',
  // Sans le ⏸ : la Verdana pixel ne l'a pas (le français l'écrit, et le
  // canevas pose un glyphe de remplacement à sa place).
  'miniwave.reprendre': 'P, Esc or the pause button to resume',
});
