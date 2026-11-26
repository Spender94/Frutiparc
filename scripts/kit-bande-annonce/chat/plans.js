/*
 * Kit bande-annonce, section « chat » — LES PLANS : une scène de scenes.json
 * + une caméra. (Voir l'explication des champs en tête de generer.js.)
 * Titres, descriptions et usages vont tels quels dans manifest.json.
 */
'use strict';

module.exports = {
  'aquarium-maitre': {
    scene: 'aquarium', titre: 'L’aquarium — plan maître',
    vue: [960, 540, 2], fenetre: [20, 104, 676, 432], connectes: true, cadre: 'tout', affiche: 14.2,
    description: 'Le salon Pomme plein à craquer, vu par Pomelo sur son bureau Frutiz : la colonne des bouilles est passée en « aquarium » (plus de monde que d’écrans). Chaque frutiz qui parle y entre par la gauche à une hauteur au hasard, joue son émotion (rire, bisou, jutsu, langue, clin d’œil…) et repart quand un autre prend la parole. Record de Swapou, nouvelle venue (Citronade) accueillie par Gaspard et par Pomelo qui tape sa ligne, kikooz offerts par l’animatrice, humeurs qui changent.',
    usage: 'Plan long pour couper : n’importe quelle tranche de 2 à 6 s montre des bouilles qui entrent et réagissent. Idéal sur « un vrai chat, avec de vraies têtes ».',
  },
  'aquarium-gros-plan': {
    scene: 'aquarium', titre: 'L’aquarium — gros plan',
    vue: [800, 450, 5], fenetre: [24, 104, 440, 262], connectes: false, cadre: 'fenetre', affiche: 14.2,
    description: 'La même scène, caméra serrée sur une fenêtre de salon plus petite (comme elle s’ouvre à la connexion) : la bande de l’aquarium et le fil remplissent l’image, rendus quatre fois plus fins — rien n’est agrandi après coup. Les bouilles font plus de 400 px.',
    usage: 'Inserts rapides entre deux plans larges ; se prête aux zooms et recadrages en montage.',
  },
  'aquarium-bouilles': {
    scene: 'aquarium', titre: 'L’aquarium — bouilles détourées',
    vue: [800, 450, 6], fenetre: [24, 104, 440, 262], connectes: false, cadre: 'bouilles', alpha: true, affiche: 14.2,
    description: 'Seules les bouilles de l’aquarium, sur fond transparent (WebM VP9 avec alpha) et sur fond vert #00FF00 (MP4) : elles entrent par le bord gauche de l’image, jouent leur émotion et repartent, au rythme de la scène de l’aquarium (mêmes répliques, même minutage).',
    usage: 'À incruster : la bande des bouilles est calée contre le bord GAUCHE d’un cadre 1920 × 1080 transparent — posée telle quelle, les bouilles « entrent » dans la bande-annonce par la gauche.',
  },
  'multi': {
    scene: 'multi', titre: 'Salon à quatre — un écran chacun',
    vue: [1200, 675, 1.6], fenetre: [24, 104, 640, 560], connectes: true, cadre: 'tout', affiche: 7.6,
    description: 'Un petit salon (Kiwi) à quatre : quand tout le monde tient dans la colonne, chacun a SON écran (mode MULTI, d’époque). Les humeurs changent sur les bouilles, les émotes se jouent dans l’écran de qui les lance, et Pomelo tape sa réponse.',
    usage: 'Contrepoint calme à l’aquarium ; montre les humeurs et les émotes sur des bouilles qui restent en place.',
  },
  'multi-bouilles': {
    scene: 'multi', titre: 'Salon à quatre — écrans détourés',
    vue: [1200, 675, 4], fenetre: [24, 104, 640, 560], connectes: true, cadre: 'bouilles', alpha: true, affiche: 7.6,
    description: 'Les quatre bouilles du salon Kiwi seules, empilées comme dans leur colonne, sur fond transparent et sur fond vert : humeurs qui changent, émotes (bisou, rire, jutsu, clin d’œil) jouées chacune à son tour.',
    usage: 'À incruster à côté d’un texte ou d’un plan de jeu : quatre têtes qui réagissent.',
  },
  'quiz': {
    scene: 'quiz', titre: 'Le quiz de l’animatrice',
    vue: [960, 540, 2], fenetre: [20, 104, 676, 432], connectes: true, cadre: 'tout', affiche: 9.4,
    description: 'Litchiloo, animatrice, lance un quiz dans le salon Pomme (/initpoint), les frutiz répondent, elle distribue les points (/point pseudo 3), affiche le classement en bleu (/showpoint), puis offre 50 kikooz à Pomelo — qui le voit s’afficher chez lui.',
    usage: 'Moment « animation » de la bande-annonce : la vie du parc, les quiz, les kikooz.',
  },
  'arrivee': {
    scene: 'arrivee', titre: 'Arrivée dans le salon',
    vue: [800, 450, 2.4], arrivee: true, cadre: 'tout', affiche: 10.4, curseur: [560, 330],
    gestes: [
      { t: 0.5, vers: { sel: '.sp-salon', texte: 'Salon Pomme' }, duree: 0.9 },
      { t: 1.6, clic: true, attendre: 'p' },
      { t: 2.6, vers: { sel: '.fen:has([data-salon="pomme"]) #bouille-toggle' }, duree: 0.8 },
      { t: 3.6, clic: true },
      // On étire la fenêtre par sa poignée, comme un joueur qui s'installe.
      { t: 4.3, vers: { sel: '.fen:has([data-salon="pomme"]) .fen-poignee' }, duree: 0.6 },
      { t: 5.0, saisir: true },
      { t: 5.1, vers: [610, 438], duree: 1.0 },
      { t: 6.2, lacher: true },
      { t: 6.6, vers: [700, 300], duree: 0.9 },
    ],
    description: 'Pomelo sur son bureau Frutiz : la liste des salons publics et leur affluence, un clic sur « Salon Pomme », la fenêtre de conversation qui arrive du coin, la colonne des bouilles qu’on ouvre, la fenêtre qu’on étire — et le salon qui l’accueille (« Coucou Pomelo ! »), bouilles à l’appui. Curseur mimé (une flèche dessinée), clics et glisser réels.',
    usage: 'Ouverture de la séquence « chat » : on entre dans le parc avec le spectateur.',
  },
  'telephone': {
    scene: 'aquarium', titre: 'Le chat sur téléphone (vue light)',
    vue: [360, 640, 3], mobile: true, cadre: 'tout', affiche: 6.2,
    description: 'La même scène que l’aquarium, vue sur un téléphone (client light, celui de la plupart des joueurs) : la bouille de qui parle traverse le fil en grand, avec son nom et son action (« Myrtillou éclate de rire »). Format vertical 1080 × 1920.',
    usage: 'Pour dire « et sur mobile aussi » ; formats verticaux (réseaux sociaux) ou incrusté dans un téléphone.',
  },
};
