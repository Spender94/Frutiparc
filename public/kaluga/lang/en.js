/*
 * DICTIONNAIRE ANGLAIS — KALUGA (public/kaluga/). Voir /js/i18n.js : le
 * français est écrit dans le code (argument de repli de T()), ici seulement
 * l'anglais. Chargé par index.html (FPI18n.charger) quand la langue est
 * l'anglais. Glossaire du parc : /i18n/en/commun.js.
 *
 * LES JEUX DE MOTS RESTENT FRANÇAIS POUR L'INSTANT (choix de l'admin) :
 * Plantapomme, Dextéripomme, les « -grappe » (Mono-grappe, Mega-grappe…), la
 * kagulga. Les noms des tzongres (Kaluga, Piwali, Nalika, Gomola, Makulo) ne
 * changent pas.
 *
 * Quatre sortes d'entrées :
 *   · les textes que le code écrit (`kaluga.fin.*`, `kaluga.chrono.*`…) ;
 *   · les NOMS que le jeu compose en français et qui sont aussi des clés
 *     (statistiques, figures, cris) : `kaluga.noms`, `kaluga.figures` —
 *     traduits seulement à l'affichage (J.nomAffiche, jeu/base.js) ;
 *   · `kaluga.champ.<id>` : le texte par défaut d'un champ du SWF (les pages
 *     du tutoriel), par l'identifiant du champ dans data/kaluga.json ;
 *   · `kaluga.fige.<id>` et `kaluga.fige.<clip>.<image>` : les textes FIGÉS
 *     (cuits en formes, ou écrits lettre à lettre par un clip), que le moteur
 *     récrit dans la même fonte — leur mise en page est dans data/figes.json
 *     (`node scripts/textes-figes.js --liste` montre chaque clé et son
 *     français). Une ligne par « \n », autant que le français en avait.
 */
(function () {
  'use strict';

  // Un champ du tutoriel : un <p> par paragraphe, ses lignes séparées par
  // <sbr />, dans la Verdana verte du SWF. Les lignes ne se replient pas
  // toutes seules (le champ ne coupe pas) : chacune tient dans sa largeur.
  const p = (align, paras) => paras.map((lignes) => '<p align="' + align + '"><font face="verdana" size="14" color="#485b24">'
    + [].concat(lignes).join(' <sbr />') + '</font></p>').join('');
  const g = (...paras) => p('left', paras);
  const d = (...paras) => p('right', paras);
  const c = (...paras) => p('center', paras);

  const NIVEAUX = { facile: 'easy', standard: 'standard', difficile: 'hard', infernal: 'infernal' };

  FPI18n.ajouter('en', {
    // ── La page (index.html) ────────────────────────────────────────────
    'kaluga.chargement': 'Loading Kaluga…',
    'kaluga.echecDemarrage': 'Kaluga could not start: {erreur}',
    'kaluga.boutonFil': 'thread',
    'kaluga.boutonPause': 'pause',

    // ── Le menu (jeu/menu.js) : les noms des modes, par nom français ─────
    'kaluga.menu': {
      CHALLENGE: 'CHALLENGE', ESSAIS: 'PRACTICE', OLYMPIQUE: 'OLYMPICS',
      'LANCER DE VERS': 'WORM THROW', "LANCER D'ECUREUIL": 'SQUIRREL THROW',
      'LANCER DE FOURMIS': 'ANT THROW', 'PLANTER DE VERS': 'WORM PLANTING',
      'COURSE GRENOUILLES': 'FROG RACE', TRIATHLON: 'TRIATHLON', HEPTATHLON: 'HEPTATHLON',
      CHRONO: 'TIME TRIAL', SURVIE: 'SURVIVAL', INVASION: 'INVASION', PISTE: 'TRACK',
      SEQUENCE: 'CUTSCENES', INTRODUCTION: 'INTRO', CREDITS: 'CREDITS',
      EPREUVES: 'TRIALS', FACILE: 'EASY', MOYEN: 'MEDIUM', STANDARD: 'STANDARD',
      DIFFICILE: 'HARD', INFERNAL: 'INFERNAL', PREPARATION: 'TRAINING', OPTIONS: 'OPTIONS',
      'BAC A SABLE': 'SANDBOX',
    },
    'kaluga.options.k0': 'set the speed-up key.',
    'kaluga.options.k1': 'set the key to turn left.',
    'kaluga.options.k2': 'set the key to turn right.',
    'kaluga.options.k3': 'set the key to dive towards the ground.',
    'kaluga.options.k4': "set the key to cast the tzongre's thread.",
    'kaluga.options.k5': 'set the key that does nothing at all.',
    'kaluga.options.b0On': 'turn on the game music.',
    'kaluga.options.b0Off': 'turn off the game music.',
    'kaluga.options.b1On': 'turn on the sound effects.',
    'kaluga.options.b1Off': 'turn off the sound effects.',
    'kaluga.options.b2On': 'turn on the particle effects.',
    'kaluga.options.b2Off': 'turn off the particle effects.',
    // Les noms des touches (asml.KeyManager), par code.
    'kaluga.nomsTouches': {
      8: 'Backspace', 12: 'Clear', 13: 'Enter', 16: 'Shift', 17: 'Ctrl', 20: 'Caps Lock', 27: 'Escape',
      32: 'Space', 33: 'Page Up', 34: 'Page Down', 35: 'End', 36: 'Home', 37: 'Left', 38: 'Up', 39: 'Right', 40: 'Down',
      45: 'Insert', 46: 'Delete', 47: 'Help', 144: 'Num Lock',
      96: 'Num 0', 97: 'Num 1', 98: 'Num 2', 99: 'Num 3', 100: 'Num 4', 101: 'Num 5', 102: 'Num 6', 103: 'Num 7',
      104: 'Num 8', 105: 'Num 9', 106: 'Num *', 107: 'Num +', 108: 'Num Enter', 109: 'Num -', 110: 'Num Del', 111: 'Num /',
    },

    // ── Les noms composés en français (affichage seulement) ─────────────
    'kaluga.statNom': '{nom}: ',
    'kaluga.noms': {
      // Les statistiques du panneau de fin.
      'Nombre de papillon': 'Butterflies', 'Nombre de pomme': 'Apples', 'Nombre de ver': 'Worms',
      'Nombre de fourmi': 'Ants', "Nombre d'écureuil": 'Squirrels', 'Nombre de grenouille': 'Frogs',
      'Pommes perdues': 'Apples lost', 'bébé vers': 'baby worms', 'Coups-de-tête': 'Headers',
      'Quantité mangée par des vers': 'Eaten by worms', 'Quantité mangée par les fourmis': 'Eaten by ants',
      'Grappe maximum': 'Biggest grappe', "Pomme d'or": 'Golden apple',
      'Meilleur lancer de fourmi': 'Best ant throw', 'Lancer de fourmi': 'Ant throw',
      'Meilleur lancer de vers': 'Best worm throw', 'Lancer de vers': 'Worm throw',
      'Vers mangés par le corbeau': 'Worms eaten by the crow', 'Corbeaux vaincus': 'Crows beaten',
      'vers sauvés des corbeaux': 'worms saved from crows', 'Coups de pomme sur les corbeaux': 'Apple hits on crows',
      'Plumes perdues par les corbeaux': 'Feathers lost by crows',
      // Les cris des panneaux de fin, et le bandeau.
      'Miam!': 'Yum!', 'Paf!': 'Wham!', 'beurk!': 'yuck!',
    },
    // Les mots des figures (Panier.figureDe), les expressions avant les mots.
    'kaluga.figures': {
      pure: 'clean', rondade: 'roundoff', ricochet: 'rebound', tete: 'header', ecureuil: 'squirrel',
      corbeau: 'crow', lateral: 'side', 'latéral': 'side', dunk: 'dunk', direct: 'direct',
      'double-bande': 'double-bank', 'triple-impact': 'triple-impact', 'quadruple-impact': 'quadruple-impact',
      'pentacle mystique': 'mystic pentacle', shaker: 'shaker', 'double-shaker': 'double-shaker',
      'coup-de-bol': 'fluke', 'lucky dunk': 'lucky dunk', wild: 'wild', 'nature cooperation': 'nature teamwork',
      harmonie: 'harmony', 'trinitée': 'trinity', 'tete plongeante': 'diving header', 'wild side': 'wild side',
      'demi-lune': 'half-moon', 'pleine-lune': 'full moon', 'maxi-shaker': 'maxi-shaker',
      'tete déviée': 'glancing header', 'tete plongeante déviée': 'glancing diving header', 'déviée': 'glancing',
      'du mammouth': 'mammoth', alouette: 'skylark', 'alouette courbée': 'curved skylark', croc: 'fang',
      granite: 'granite', coquelicot: 'poppy', corbeaux: 'crows',
    },

    // ── Les panneaux de fin (jeu/game.js, jeu/modes.js) ─────────────────
    'kaluga.fin.rejouer': 'Play again?',
    'kaluga.fin.continuer': 'Continue?',
    'kaluga.fin.oui': 'yes',
    'kaluga.fin.non': 'no',
    'kaluga.fin.perdu': 'You lose!',
    'kaluga.fin.sauvegarde': 'saving your score...',
    'kaluga.fin.modeDebloque': (p) => 'You unlocked ' + (NIVEAUX[p.mode] || p.mode) + ' mode!!\n',
    'kaluga.fin.tzongreDebloquee': 'You unlocked a new tzongre: {nom}!!\n',
    'kaluga.fin.titem': 'A new Titem is waiting in your inventory!\n',
    'kaluga.fin.kagulga': "You won the kagulga!\nMade of genuine Tzongre leather, this balaclava keeps you frutistylish whatever happens!",
    'kaluga.fin.recordGeneral': 'Overall record broken!!',
    'kaluga.fin.recordGeneral2': 'Overall record broken!!',
    'kaluga.fin.ancienRecordDe': 'Old record: {score} ({nom})',
    'kaluga.fin.nouveauRecordDe': 'New record: {score} ({nom})',
    'kaluga.fin.general': 'Overall:',
    'kaluga.fin.combo': 'Combos:',
    'kaluga.fin.placesGagnees': 'You beat your best score!!\n You climbed {n} places\n',
    'kaluga.fin.placeGagnee': 'You beat your best score!!\n You climbed {n} place\n',
    'kaluga.fin.secondes': 'sec.',
    'kaluga.fin.recordTzongre': "Congratulations!\nYou improved {nom}'s best score!!",
    'kaluga.fin.meilleureTzongre': 'Best Tzongre',
    'kaluga.fin.resultats': ' Results ',

    'kaluga.chrono.consigne': 'Gather all the apples in less than {temps}!',
    'kaluga.chrono.tropTard': 'Too late!',
    'kaluga.chrono.echecs': [
      "{nom} couldn't gather all the apples in time.",
      "Time's up, {nom} failed.",
      '{nom} lacked precision this time.',
      "{nom}'s basket wasn't filled in time.",
    ],
    'kaluga.invasion.consigne': "Hold out for more than {temps} and you win!",
    'kaluga.survie.consigne': 'Fend off the crows for as long as you can.',
    'kaluga.survie.but': 'Hold out for more than {temps} and you win!!!',

    'kaluga.defi.consigne0': 'Pull off ten dunks before time runs out!',
    'kaluga.defi.consigne1': 'Pull off ten granites before time runs out!\n'
      + "The basket is at the edge: a rebound granite counts too.",
    'kaluga.defi.consigne2': 'Pull off ten granites before time runs out!\n'
      + 'A crow is prowling: it swoops on the tzongre and steals its apples.',
    'kaluga.defi.tempsImparti': 'Time allowed: {temps}.',
    'kaluga.defi.case': '{nom}:',
    'kaluga.defi.reussi': 'Done!',
    'kaluga.defi.releve': '{nom} took up the challenge in {temps}.',
    'kaluga.defi.debloque1': 'You unlocked the MEDIUM challenge!!',
    'kaluga.defi.debloque2': 'You unlocked the HARD challenge!!',
    'kaluga.defi.makulo': 'You won the Makulo!\nIt is waiting for you in your accessories inventory.',
    'kaluga.defi.tropTard': 'Too late!',
    'kaluga.defi.rate': "{nom} didn't take up the challenge in time.",

    'kaluga.tournoi.vainqueur': (p) => p.nom + ' wins this ' + p.mode + ' hands down!!!',
    'kaluga.tournoi.podium': '{deux} takes the silver medal and {trois} comes 3rd!',
    'kaluga.tournoi.dernier': "Let's note the dismal performance of {nom}, who comes last with {points} points!",
    'kaluga.tournoi.heptathlonOuvert': 'You unlocked 4 new events and the heptathlon mode!',
    'kaluga.tournoi.heptathlonFini': 'You completed the heptathlon mode, congratulations!!!',
    'kaluga.tournoi.record': 'Overall record broken!!\nOld record: {ancien} pts\nNew record: {score} pts',

    'kaluga.lancer.faute': 'Foul!',
    'kaluga.lancer.faute2': 'Foul!',
    'kaluga.lancer.ligneDepassee': 'You crossed the throwing line!',
    'kaluga.lancer.ligneNonFranchie': "Your worm didn't make it past the throwing line!",
    'kaluga.ecureuil.sol': 'For the throw to count, you must catch the squirrel before it hits the ground.',
    'kaluga.ecureuil.horsLimite': 'Out of bounds!',
    'kaluga.ecureuil.zone': 'For the throw to count, the squirrel must stay inside the throwing area.',
    'kaluga.fourmis.ligne': 'You must let go of the ants before any of them crosses the line!',
    'kaluga.fourmis.numero': 'ant number {n}:',
    'kaluga.plantapomme.coup1': '1st hit:',
    'kaluga.plantapomme.coup2': '2nd hit:',
    'kaluga.plantapomme.coup3': '3rd hit:',
    'kaluga.planter.horsZone': 'Out of the zone!',
    'kaluga.planter.piquets': 'The worm must be planted between the two stakes.',
    'kaluga.dexteripomme.ligne': 'You crossed the throwing line',
    'kaluga.dexteripomme.rate': " You didn't manage to reach the basket",
    'kaluga.bac.aide': 'SANDBOX — nothing in this game counts\n'
      + '1 to 8: butterflies  ·  9: an apple  ·  0: a golden apple\n'
      + 'F ant  ·  V worm  ·  E squirrel  ·  G frog  ·  C crow',

    // Les phrases de fin d'une tzongre (même nombre que le français).
    'kaluga.sol.phrases': [
      '{nom} crashed into the ground...',
      'Gravity caught up with {nom}',
      '{nom} played too close to the ground...',
    ],
    'kaluga.pomme.phrases': [
      '{nom} hit the apple a bit too hard.',
      "{nom} couldn't dodge the apple.",
      'The apple hit our poor {nom} head-on, rest in peace...',
      "Despite good reflexes, {nom} couldn't dodge the apple in time.",
      'In a murderous rush, the apple took {nom} down with it.',
      'The speeding apple squashed {nom}, who happened to be passing by.',
    ],
    'kaluga.corbeau.phrases': [
      '{nom} was swallowed by the crow.',
      "{nom} couldn't dodge the crow's attacks.",
      'The crow swallowed {nom} in a single bite',
      "The crow's relentless attacks got the better of our poor {nom}",
    ],
    'kaluga.grenouille.phrases': [
      '{nom} was gobbled up by the frog.',
      "{nom} didn't dodge the frog's tongue.",
      'The frog gulped down {nom} in a flash.',
      "The frog's perseverance got the better of our poor {nom}.",
    ],

    // ── Les champs du SWF (data/kaluga.json) : le tutoriel ──────────────
    'kaluga.champ.84': 'Connecting to the Frusion...',
    'kaluga.champ.672': 'nothing',
    'kaluga.champ.674': '<p align="left"><font face="Verdana_10pt_st" size="10" color="#637c32">not much</font></p>',
    'kaluga.champ.675': 'zilch',
    'kaluga.champ.712': 'nothing',
    'kaluga.champ.907': g(['Catch as many apples as you can and', 'drop them in the basket.']),
    'kaluga.champ.908': g(['The bigger the apple, the more', 'points it is worth.'], ['Careful! The biggest apples', 'are also the heaviest...']),
    'kaluga.champ.918': d(['When there are no apples left on the tree, a', 'golden apple appears. A golden apple is worth', 'ten times as many points as a normal apple!']),
    'kaluga.champ.923': g(['The golden apple is jealously guarded by a nasty', 'crow. Be careful not to let your tzongre get too', 'close to its beak...']),
    'kaluga.champ.926': g(['First, catch the worm with the', "tzongre's thread."]),
    'kaluga.champ.931': g(["Don't give the worm time to", 'cross the throwing line.']),
    'kaluga.champ.932': g(['Once caught, the worm must not be', 'dropped before the throw, or you lose!']),
    'kaluga.champ.933': d(['With a subtle back-and-forth'], ['motion, speed up the worm.']),
    'kaluga.champ.937': d(['Once the worm is going fast', 'enough, let go of it as close as', 'possible to the throwing line.']),
    'kaluga.champ.938': d(["If it's going fast enough, the worm", 'can fly really, really far!']),
    'kaluga.champ.939': d(['Careful, he shows no mercy!'], ['If the tzongre crosses the line, he', 'will void the throw by waving his', 'red flag!']),
    'kaluga.champ.946': d(['If the throw is valid, the squirrel', 'waves a white flag.']),
    'kaluga.champ.947': g(['First, catch the squirrel with the', "tzongre's thread"]),
    'kaluga.champ.951': g(["If the squirrel leaves the screen, don't", 'panic, it will come back.']),
    'kaluga.champ.952': g(['Once caught, the squirrel must not', 'be dropped before the throw, or', 'you lose!']),
    'kaluga.champ.953': d(['With a delicate back-and-forth'], ['motion, speed up the squirrel.']),
    'kaluga.champ.957': d(['Once the squirrel is going fast', 'enough, fling it as high as you can', 'by letting go of the thread.']),
    'kaluga.champ.958': d(["If it's going fast enough, the squirrel", 'can climb higher than the treetop!']),
    'kaluga.champ.959': d(['Careful: when the squirrel comes back', 'down to your height, catch it!']),
    'kaluga.champ.962': d(["If you can't catch it before it", 'hits the ground, the throw is void. ']),
    'kaluga.champ.963': d(["The squirrel struggles while it's", 'hooked: watch out for the jolts!']),
    'kaluga.champ.964': g(['To begin, catch the apple.']),
    'kaluga.champ.968': g(['With a skilful back-and-forth'], ["motion, build up the apple's", 'speed.']),
    'kaluga.champ.969': g(['The goal: use the apple like', 'a hammer to drive in the stake.']),
    'kaluga.champ.970': d(['For a good score, the stake must', 'go as deep into the ground as it can.']),
    'kaluga.champ.973': d(['To do that, drop the apple onto', 'the stake with all your might.']),
    'kaluga.champ.974': d(['Careful, you only get three hits!']),
    'kaluga.champ.976': g(['To catch all the ants at once,', 'hold the thread key down', 'longer.']),
    'kaluga.champ.980': g(["Don't give the ants time to", 'cross the throwing line!']),
    'kaluga.champ.981': g(['(If that happens, the Frutiparc team', "recommends a good night's sleep.)"]),
    'kaluga.champ.982': d(['With a clever back-and-forth'], ['motion, speed up the ants.']),
    'kaluga.champ.985': d(['Once the ants are going fast', 'enough, let go of them as close as', 'possible to the throwing line.']),
    'kaluga.champ.986': d(["If they're going fast enough, and the", 'weather is kind, the ants can go far!']),
    'kaluga.champ.987': d(['Careful, he shows no mercy!'], ['If the tzongre crosses the line, he voids', 'the throw by waving his red flag!']),
    'kaluga.champ.988': d(['If the throw is valid, the squirrel', 'waves a white flag.']),
    'kaluga.champ.989': g(['First, catch the worm with the', "tzongre's thread"]),
    'kaluga.champ.992': g(["If the worm leaves the screen, don't", 'panic, it will come back. (Try more', 'coffee if this happens too often.)']),
    'kaluga.champ.993': g(['Once caught, the worm must not be', 'dropped before planting, or you lose!']),
    'kaluga.champ.994': d(['With a delicate back-and-forth'], ['motion, speed up the worm.']),
    'kaluga.champ.997': d(['Once the worm is going fast', 'enough, let go so that it hits the', 'ground at full speed.']),
    'kaluga.champ.998': d(['The harder the worm is thrown, the', 'deeper it will sink into the ground.']),
    'kaluga.champ.1001': c(['The worm must land as close as possible to the center', 'between the two stakes. The closer it is to the center,', 'the bigger the precision bonus!!']),
    'kaluga.champ.1005': d(['The squirrel judge is watching.']),
    'kaluga.champ.1010': d(['If the throw is valid, the squirrel', 'waves a white flag.']),
    'kaluga.champ.1011': d(['If the worm is planted outside the limits', 'set by the stakes, the planting is', 'void, however hard it hits. ']),
    'kaluga.champ.1012': d(['Use the left and right keys to move', 'the basket to the distance you want.']),
    'kaluga.champ.1015': d(['Careful! The farther the basket, the', 'harder it is to reach when you throw!']),
    'kaluga.champ.1016': d(['The minimum distance is 100cm. ']),
    'kaluga.champ.1018': g(['Then throw the apple into the', 'basket without crossing the line.']),
    'kaluga.champ.1021': g(['If the apple goes into the basket,', 'the distance counts.']),
    'kaluga.champ.1022': g(['If the apple misses, or if it is', 'dropped too late, the squirrel judge', 'will declare the throw void.']),
    'kaluga.champ.1023': g(['Take the frog as far as you can', 'in one minute.']),
    'kaluga.champ.1027': g(['If the frog jumps just as the', 'counter reaches zero, its landing', 'spot counts.']),
    'kaluga.champ.1028': g(['To lure the frog, you have to...']),
    'kaluga.champ.1029': g(['By moving in front of it, the tzongre', 'can tempt the frog to jump.']),
    'kaluga.champ.1032': g(['As soon as the frog has noticed', 'you, it will stare at you.']),
    'kaluga.champ.1033': g(['Then stay alert, because the frog', 'can jump at any moment.']),
    'kaluga.champ.1034': d(['Once the frog is ready enough, it', 'can spring at any moment and pounce', 'on the tzongre.']),
    'kaluga.champ.1037': d(['So keep a constant eye on it, or', "you'll end up in its stomach."]),
    'kaluga.champ.1038': d(['On your marks... get set... go!']),
    'kaluga.champ.1043': c(['Your goal is to guide the apple to the gong in under ']),
    'kaluga.champ.1045': c(['If you touch one of the rings on your way, the tzongre', "will drop the apple and you'll have to start over."]),
    'kaluga.champ.1047': c(["Your goal is to protect your apples from the ants' attack."]),
    'kaluga.champ.1049': c(['You lose if either of your two apples is completely', 'swallowed up.']),
    'kaluga.champ.1051': d(['Press the left and right keys to', 'tilt your tzongre to the angle', 'you want.']),
    'kaluga.champ.1054': d(['To flap your wings faster, press', 'the up key.']),
    'kaluga.champ.1057': d(['With the down key, you can also', 'dive towards the ground.']),
    'kaluga.champ.1058': g(['To catch an apple, you have to', 'get as close to it as you can.']),
    'kaluga.champ.1061': g(['Press the space bar to create', 'a link between you and the apple.']),
    'kaluga.champ.1062': g(['As soon as you let go of the space', 'bar, the link tightens and the apple', 'is "hooked" to your tzongre.']),
    'kaluga.champ.1063': g(['If you catch orange or yellow', 'butterflies, you can lift more than', 'one apple at a time.']),
    'kaluga.champ.1068': g(['Just hold the space bar down longer', 'so that the nearby apples get', 'linked too,'], ['then let go to tighten the threads.']),
    'kaluga.champ.1069': d(['With a back-and-forth motion,', 'speed up the worm.']),
    'kaluga.champ.1072': d(['Once the worm is going fast', 'enough, let go of it as close as', 'possible to the throwing line.']),
    'kaluga.champ.1073': d(["If it's going fast enough, the worm", 'can fly really, really far!']),

    // ── Les textes figés (data/figes.json) ──────────────────────────────
    // La lettre de President (le chargement d'une séquence) n'a que quinze
    // glyphes : l'anglais s'écrit avec eux, pour garder le lettrage.
    'kaluga.fige.51': 'the sequence starts',
    'kaluga.fige.93': 'BACK',
    'kaluga.fige.95': 'BACK',
    'kaluga.fige.671': 'Statistics',
    // Les caractéristiques des tzongres (Donald en capitales).
    'kaluga.fige.830': 'BA',
    'kaluga.fige.834': 'TH',
    // La pause et le chargement de la carte : la Donald réduite à dix-sept
    // minuscules, que l'anglais respecte.
    'kaluga.fige.82.1': 'press escape to resume',
    'kaluga.fige.89.1': 'the scenery gets ready',
    // L'en-tête du panneau de fin (un texte dessiné), et son grand score.
    'kaluga.fige.638': 'Game Over',
    'kaluga.fige.668.1': 'Your score:',
    'kaluga.fige.668.2': 'Your best:',
    'kaluga.fige.668.3': 'Your time:',
    'kaluga.fige.668.6': 'Precision:',
    'kaluga.fige.668.7': 'Your rank:',
    'kaluga.fige.701.10': 'Your Score:',
    // Les titres du panneau de départ (le tutoriel de chaque mode).
    'kaluga.fige.1074.1': 'Collect the most apples!',
    'kaluga.fige.1074.2': 'The golden apple and the crow',
    'kaluga.fige.1074.7': 'Catch the worm',
    'kaluga.fige.1074.8': 'Throw the worm!!',
    'kaluga.fige.1074.9': 'The squirrel line judge',
    'kaluga.fige.1074.17': 'Catch the squirrel',
    'kaluga.fige.1074.18': 'Throw the squirrel',
    'kaluga.fige.1074.19': 'Catch it on the way down',
    'kaluga.fige.1074.28': 'The hammer apple',
    'kaluga.fige.1074.29': 'The stake',
    'kaluga.fige.1074.33': 'Catch the ants',
    'kaluga.fige.1074.34': 'Throw the ants',
    'kaluga.fige.1074.43': 'Plant with force...',
    'kaluga.fige.1074.44': '...but with precision too!',
    'kaluga.fige.1074.45': 'The squirrel stake judge',
    'kaluga.fige.1074.51': 'Place the basket...',
    'kaluga.fige.1074.52': '...and hit it!',
    'kaluga.fige.1074.58': 'Oh! A frog!',
    'kaluga.fige.1074.59': 'Catch its eye...',
    'kaluga.fige.1074.60': '...without taking risks',
    'kaluga.fige.1040': 'Time trial',
    'kaluga.fige.1074.73': 'Survive as long as you can',
    'kaluga.fige.1074.80': 'Keep your balance!',
    'kaluga.fige.1074.86': 'Save your apples!',
    'kaluga.fige.1074.93': 'Steer the Tzongre',
    'kaluga.fige.1074.94': 'Catch an apple',
    'kaluga.fige.1074.95': 'Catch several apples',
  });
})();
