/*
 * Minipixiz (miniTroll) — les textes des missions.
 *
 * EXTRAIT de Games/miniTroll/src/Lang.mt par scripts/extract-minipixiz-lang.js.
 * Ne pas modifier à la main : relancer le script.
 *
 * Les missions de Gromelin sont ASSEMBLÉES, pas écrites. Huit canevas de
 * phrases, quatorze listes de mots, et une graine qui choisit dans chacune :
 * « Libérer les farfadets du terrible Sorog le rouge » et « Libérer les
 * coccinelles du terrible Pigrom le dodu » sortent du même moule. C'est ce qui
 * permet à six missions de paraître neuves chaque jour sans qu'on ait écrit six
 * cents textes.
 *
 * Chaque canevas dit aussi quelles CARACTÉRISTIQUES la mission met à l'épreuve
 * (`test`) : une mission de magie regarde la concentration et le mana, une
 * course regarde la rapidité. C'est de là que sort le pourcentage de réussite.
 *
 * Les syllabes de noms ont perdu leur caractère de tête, que
 * Mission.getSeedFaerieName retirait à chaque appel (`substring(1)`).
 */
'use strict';

(function (racine) {

const LANGUE = {
  "MISSION": [
    {
      "type": "Combat",
      "test": [
        0,
        2
      ],
      "desc": [
        "Liberer $victims du terrible $badName",
        "$badName terrorise $victims $fromLocation depuis $longTime, Volez à leur secours et terrassez cet ignoble bandit. Restez sur vos gardes durant cette mission$dif.",
        "mis une bonne raclée à $badName. Grâce à vous $victims ont enfin retrouvé la liberté !",
        "pas réussi à éliminer $badName... $victims $fromLocation attendent toujours leur sauveur..."
      ]
    },
    {
      "type": "Recherche",
      "test": [
        1,
        3,
        3,
        4
      ],
      "desc": [
        "$faerieName a perdu $lostObject $atLocation.",
        "Pauvre $faerieName !! $lostObject lui manque vraiment ! Se rendre $atLocation est$dif, vous devrez partir à l'aube pour avoir une chance de le retrouver avant les $day de cette mission. ",
        "réussi la mission ! $faerieName a vraiment l'air youpi-framboise, grâce à vous elle a retrouvé $lostObject!",
        "pas réussi leur mission... $faerieName pleure à chaudes larmes $lostObject. "
      ]
    },
    {
      "type": "Enquête",
      "test": [
        3,
        3,
        4
      ],
      "desc": [
        "Disparition mysterieuse de $faerieName.",
        "$faerieName n'est pas rentrée chez elle depuis plus d'une semaine. La dernière fois que nous l'avons vue, elle $actionPastFun autour $fromLocation. Il faut la retrouver à tout prix ! Relevez le défi de cette mission$dif !",
        "retrouvé $faerieName !! Elle s'était perdue près $2fromLocation",
        "pas retrouvé la trace de $faerieName... Cette mission est un échec"
      ]
    },
    {
      "type": "Course",
      "test": [
        1,
        1,
        1,
        2
      ],
      "desc": [
        "Grand marathon$period $fromLocation",
        "Cette course est réputée pour être $dif, si vous arrivez au bout en moins de $day, vous remporterez un prix$super !",
        "gagné le marathon $fromLocation ! Le public applaudit cet exploit !",
        "pas fini le marathon $fromLocation à temps... Adieu la récompense..."
      ]
    },
    {
      "type": "Enquête",
      "test": [
        3,
        3,
        3,
        1
      ],
      "desc": [
        "$faerieName s'est fait voler $lostObject !",
        "Elle se promenait gentiment $atLocation quand soudain, $lostObject lui fut arraché des mains par $thief... Retrouvez-le et récupérez le bien de $faerieName.",
        "résolu le problème de $faerieName en retrouvant $lostObject! Félicitations, cette mission est un succès.",
        "pas retrouvé $thief à temps. $faerieName ne reverra jamais $lostObject..."
      ]
    },
    {
      "type": "Magie",
      "test": [
        5,
        5,
        4
      ],
      "desc": [
        "$kingdom est en danger !",
        "La barrière magique qui protège $kingdom est sur le point de céder sous les assauts $fromInvader... Utilisez vos pouvoirs magiques pour renforcer le sceau des prêtres !",
        "réussi à repousser les attaques $fromInvader, $kingdom est sauvé !! Cette mission est réussie !",
        "pas pu maintenir la barrière magique des prêtres assez longtemps. $kingdom a été envahi cette nuit même, par les troupes $fromInvader. Cette mission est un échec..."
      ]
    },
    {
      "type": "Concours",
      "test": [
        3,
        4,
        4
      ],
      "desc": [
        "Grand concours $funGame.",
        "$kingdom organise son grand concours $funGame, vous allez devoir affronter de nombreux adversaires, et remporter un prix$super !",
        "gagné le grand concours $funGame, cette victoire est fêtée dans tout $kingdom!!!",
        "pas réussi à gagner le concours $funGame, il y avait de trés bons joueurs, tant pis pour la récompense..."
      ]
    },
    {
      "type": "Concours histoires",
      "test": [
        3,
        3,
        4
      ],
      "desc": [
        "Grand concours $history",
        "La grande bibliothèque située dans $kingdom, organise un grand concours $history. Beaucoup de conteurs des contrées alentours vont se déplacer pour cette occasion.",
        "gagné le concours $history. Le public était trés nombreux, et a applaudi la performance",
        "pas réussi à plaire au public du concours $history, le public a failli s'endormir"
      ]
    }
  ],
  "MISSION_DIF": [
    " très facile",
    " facile",
    " simple",
    " pénible",
    " difficile",
    " très difficile",
    " cauchemardesque"
  ],
  "MISSION_DIF_RANK": [
    "D ",
    "C ",
    "B ",
    "A ",
    "A+ ",
    "A++ ",
    "A+++ "
  ],
  "nameSyl0": [
    "Al",
    "Ami",
    "Fri",
    "Aphro",
    "Gili",
    "Ho",
    "Game",
    "Ali",
    "Sisi",
    "Nami",
    "Gi",
    "Mali",
    "Pi",
    "Aso",
    "Ni",
    "Aho",
    "Cyn",
    "Mo",
    "Dani",
    "Ju",
    "Sou",
    "Li",
    "Chomi",
    "Kolchi",
    "Chi",
    "Kumi",
    "Yari",
    "Za",
    "Pi",
    "Gami",
    "Soli",
    "Bama",
    "Lumi",
    "Api",
    "Sumi",
    "Dama",
    "Jima",
    "Magi",
    "Tosta",
    "Sandi",
    "Sulme",
    "Go",
    "Hi"
  ],
  "nameSyl1": [
    "meria",
    "ana",
    "kine",
    "ne",
    "line",
    "am",
    "yim",
    "lia",
    "milie",
    "lie",
    "gine",
    "a",
    "ka",
    "ma",
    "dine",
    "e",
    "ria",
    "lyne",
    "cie",
    "nia",
    "dea",
    "mone",
    "gone"
  ],
  "CLOUD_SHAPE": [
    "une autruche",
    "une bouteille",
    "un oiseau",
    "une aubergine",
    "un ananas",
    "un cheval",
    "un serpent",
    "une paire de ciseaux",
    "une main",
    "un visage",
    "une poule",
    "un trés gros morceau de sucre",
    "un panier",
    "une étoile",
    "un labrador",
    "un château",
    "$other",
    "un pichet",
    "une fourchette",
    "un sablier",
    "un kikooz",
    "une tzongre",
    "la bouille de Gaspard",
    "une totoche"
  ],
  "END_CHEER": [
    [
      null,
      "On a fini !",
      "Bravo !",
      "En route!",
      "Voyons voir ce qui nous attend...",
      "Fini!!",
      "Un de plus"
    ],
    [
      null,
      null,
      "Wow !!",
      "Déjà !?",
      "C'est déjà fini ?",
      "Qu'est-ce qui se passe ?",
      "On va où?",
      "Hein? C'est fini?"
    ],
    [
      null,
      null,
      null,
      null,
      "Pas mal !",
      "Enfin !",
      "Génial...",
      "Je commençais à m'impatienter...",
      "On a fini par s'en sortir... C'est pas grâce à toi !",
      "Tu veux vraiment continuer?",
      "Ah ben ca fait du bien quand c'est fini tiens",
      "Et voilà, encore un niveau, on dit merci qui?"
    ],
    [
      null,
      "Héhé, j'ai tout déchiré !",
      "Heureusement que j'étais là !",
      "Je m'en suis bien sortie !",
      "Tu m'as trouvée comment ?",
      "Avec $other tu l'aurais sûrement pas fini",
      "$name a encore tout fait",
      "Et encore une victoire pour moi, je sais je suis trop forte"
    ],
    [
      null,
      "C'est encore loin Grand-Schtroumpf ?",
      "Je suis trop youpi-framboise !",
      "Génial !",
      "Félicitations, puzzle-man !",
      "Youhouhou !!!",
      "Un de plus en moins"
    ],
    [
      null,
      null,
      null,
      null,
      "On s'en est bien sortis... non ?",
      "J'espère que je ne t'ai pas trop encombré...",
      "Si tu veux continuer sans moi je comprendrais...",
      "On continue ensemble?"
    ],
    [
      null,
      "C'est pas trop tôt",
      "T'aurais pas pu aller plus vite ?",
      "Ah ben quand même",
      "Le prochain je le fais moi-même",
      "Go go go go !!!",
      "Allez, on se dépèche",
      "J'ai failli m'endormir",
      "Allez hop hop encore un niveau!!"
    ],
    [
      null,
      "On fait vraiment une super équipe tous les deux",
      "Tu crois que ça va être dur plus loin ?",
      "J'espère qu'il n'y aura pas de démons plus loin",
      "youpiiii, on a réussi",
      "Tu veux pas me porter? Je commence à fatiguer",
      "Y a quoi aprés?"
    ],
    [
      null,
      "On rentre à la maison maintenant?",
      " Ouf, on a réussi",
      "An rentre? Ah non?",
      "T'es sûr qu'il y a pas de démons plus loin?",
      "Si tu veux continuer sans moi je comprendrais...",
      "Tu veux pas appeler $other à ma place?"
    ]
  ],
  "AMBIANCE_NORMAL": [
    [
      null,
      null,
      "Allez encore un effort !",
      "Il nous faut une super combo !",
      "Concentre toi sur le jeu, tu peux sûrement trouver une faille !",
      "Persévère !",
      "Concentre toi",
      "Essaie de repérer les groupes de billes les plus importants !",
      "Ne libère pas plusieurs démons à la fois !"
    ],
    [
      null,
      null,
      "Tiens ? je suis déjà venue ici...",
      "Tu as vu mon collier ? $other me l'a prêté !",
      "Mince j'ai fait tomber une boucle d'oreille",
      "Ho ! Je crois que j'ai vu un kikooz derrière ce buisson",
      "C'est quoi ce champignon ?!",
      "Tu as déjà entendu parler de l'arc-en-ciel ?",
      "Je suis super mal coiffée aujourd'hui...",
      "J'ai un peu soif...",
      "Il n'y a pas un autre moyen d'explorer cette contrée ?",
      "Faut que j'aille chez la manucure, à force de me battre j'ai les mains toutes abimées",
      "Et si je me colorais les ailes pour les assortir à ma tenue?"
    ],
    [
      null,
      "Ca fait combien de temps qu'on est partis ?",
      "La prochaine fois, demande plutôt à $other de t'accompagner.",
      "Il y aurait pas un autre mode de jeu... où je suis pas obligée de venir?",
      "Je crois que je préfère encore être enfermée dans un bocal",
      "J'aurais mieux fait de rester dans mon bassin moi...",
      "Si j'avais su, je serais pas venue.",
      "Engagez-vous qu'ils disaient...",
      "J'aurais dû rester couchée ce matin",
      "J'ai pas de bol.",
      "*soupir*"
    ],
    [
      "Je m'ennuie",
      "Tu as pas un truc à faire pour moi ?",
      "Que penses-tu de moi ? Je suis bien meilleure que $other n'est-ce pas ?",
      "Si je récupère assez de magie...",
      "Je prépare un super coup !",
      "Qu'ils viennent les démons !! Je les attends !",
      "J'ai un plan d'attaque infaillible pour le prochain démon",
      "$other ne m'arrive pas à la cheville !",
      "Regarde ce que j'arrive à faire avec mes ailes !!",
      "Il faudra que je parle de mes exploits aux autres en rentrant",
      "Après toutes ces aventures, je vais devenir une fée très populaire !!"
    ],
    [
      null,
      null,
      "Hier, $other et moi on a pas mal parlé de toi...",
      "C'est qui le malade qui entasse toutes ces billes ?",
      "Ils sont pas serrés, les démons, dans les capsules ?",
      "Ca manque de couleurs par ici!!",
      "Je me demande ce qu'il y a par là !",
      "On devrait monter un cirque !",
      "Tu peux pas voler ?",
      "Mais finalement, c'est quoi l'univers ?",
      "C'est pas vraiment l'endroit où j'aimerais vivre...",
      "On l'a pas déjà vu ce niveau ?",
      "Dis, t'aurais pas vu Nalika par hasard ? Je lui ai prété mes paillettes, et elle ne me les a pas rendues...",
      "Tu sais ce que ça fait, du chocolat dans un champs de blé ? hihi",
      "*chante* A l'aventure Compagnon, je suis partie vers l'horizon...",
      "Il est sympa Gaspard, hein ? Je rigole bien avec lui",
      "Tu crois qu'on pourrait invoquer Ornegon ?",
      "J'aimerais des sandales pour aller avec ma jupe"
    ],
    [
      null,
      null,
      null,
      null,
      null,
      "hum...",
      "Tu penses qu'on forme une bonne équipe...?",
      "J'espère que je ne te décevrais jamais !",
      "Je préfère ta compagnie à celle des autres fées... *rougit*",
      "Je suis mieux avec toi qu'avec $other...*rougis*"
    ],
    [
      "Une super combo et on y va !!",
      "Dépêche toi, je veux voir plus loin",
      "Bon, tu entasses des billes ou tu les fais disparaître ?",
      "Plus rapide c'est possible ?",
      "Appuie vers en baaaassssss !!!"
    ],
    [
      "J'aimerais bien rencontrer une mini-pouss, c'est un peu comme une fée sans ailes",
      "Je me demande si $other ne s'ennuie pas trop",
      "*fait une bulle de chewing-gum*",
      " Mdamirma m'a prédit Une b'nne configurati'n Frutale",
      "On est pas déjà passés par là ?",
      "Ca manque de couleurs par ici!",
      "J'ai un peu soif...",
      "Tu crois que je devrais réamménager mon bocal ?",
      "C'est quoi ta couleur préférée ?",
      "Tu me donnes ton adresse MSN ?",
      "A.S.V. pour tout le monde !!",
      "J'ai quand même l'impression qu'on tourne en rond",
      "On devrait sortir d'ici, je suis sûre qu'on est perdus",
      "C'est quand que j'apprends un nouveau sort ?",
      "T'as pas vu passer une tzongre ?",
      "Dis, tu crois que je serai modératrice, un jour ?",
      "Je me suis battue avec Gomola hier... il voulait me voler $like!",
      "Tu t'es déjà fait totocher ? Moi oui, plein de fois !",
      "Dis, tu me prêtes des kikooz ? J'ai envie de m'acheter un chapeau... Alleeeer, s'il te plaaaiiit..."
    ],
    [
      "Argh!! Ah non rien c'est mon ombre",
      "Dis je peux me cacher derrière toi?",
      "Aaaaah quelque chose m'a touchée!! ... Ah c'est juste du lierre...",
      "C'est ca que tu appelles s'amuser?",
      "Et si on rentrait à la maison",
      "Tu préfèrerais pas qu'on joue à swapou?",
      "Il a l'air sympa le coin la bas pour se cacher...",
      "C'est quand même un peu sombre ici",
      "C'est quoi ce bruit? T'as entendu?",
      "On aurait dû amener $other avec nous",
      "On devrait rentrer tant que le démon n'y est pas"
    ]
  ],
  "AMBIANCE_FINISH": [
    [
      null,
      null,
      "Persévère! Tu y es presque !",
      "Y'a plus grand chose à faire ! Tiens bon !",
      "Le prochain niveau est bientôt en vue !",
      "Il n'y a plus de danger désormais..."
    ],
    [
      null,
      null,
      "Y'a plus grand chose de ce niveau...",
      "Pourquoi on s'en va pas ?",
      "Quand est-ce qu'on s'arrache d'ici ?",
      "Ca fait un peu vide maintenant..."
    ],
    [
      null,
      null,
      null,
      "Pfff... On se traîne...",
      "Bon si tu perds maintenant, tu es irrécupérable",
      "Tu en as pour longtemps ?",
      "ah ben voilà c'est à ton niveau là"
    ],
    [
      "Bon, je pense que tu pourras finir sans moi !",
      "Je te laisse finir le niveau.",
      "C'est presque fini !"
    ],
    [
      null,
      null,
      "Aie, je me suis froissée une aile !",
      "Ce niveau était vraiment super !",
      "Oh regarde !... Ah non rien..."
    ],
    [
      null,
      null,
      null,
      null,
      null,
      null,
      "Ce niveau était sympa...",
      "Tu t'es bien débrouillé sur ce niveau"
    ],
    [
      "Bon, là tu peux finir vite",
      "C'est fini, on va au prochain !!",
      "Rien qu'un petit effort",
      "Je pars devant, tu me rejoins",
      "Tu peux pas jouer plus vite?"
    ],
    [
      "Hé! Tu t'es bien débrouillé là!",
      "Bon, ça a l'air calme là maintenant",
      "Bon, je vais m'asseoir et regarder la fin",
      "J'espère que le prochain sera aussi simple",
      "Tu veux pas que je fasse un sort ?"
    ],
    [
      "Mince j'ai plus rien pour me cacher",
      "c'est pas possible il va nous arriver une tuile",
      "c'est trop beau pour être vrai",
      "C'est presque fini !"
    ]
  ],
  "AMBIANCE_BATTLE": [
    [
      "Je retiens les démons, profites-en",
      "Il a l'air coriace, mais je peux le vaincre",
      "Concentre-toi sur le jeu, les démons c'est mon boulot !",
      "Je m'occupe du démon, essaie de finir vite !"
    ],
    [
      "Argh ! Il est affreux celui-là !",
      "Ces démons sont incroyablement résistants !",
      "Je me demande d'où viennent ces démons",
      "Je vais essayer de te débarasser de ce monstre",
      "Wah, il a failli me toucher !",
      "Oups, j'ai failli me froisser une aile",
      "Ils ont l'air bizarre les trucs qui volent là!"
    ],
    [
      "Ce démon m'a mise en colère !",
      "Je ne peux pas supporter ces démons",
      "Tu nous as mis dans de beaux draps...",
      "Ca va chauffer pour toi le démon !",
      "Arrête de libérer des démons s'il te plait!!",
      "Ca va chauffer",
      "Mais pourquoi tant de violence, si ça se trouve ils sont gentils"
    ],
    [
      "Ce démon ne tiendra pas longtemps !",
      "C'est l'affaire d'une seconde",
      " Tu vas voir je vais l'écraser cette souris ailée",
      "On t'as jamais dis de ne pas embêter les filles??",
      "Coup de tête, balayette!!",
      "Ca va chauffer!!",
      "Ils sont en baisse de forme les démons là non?",
      "Je connais un démon qui va se prendre un coup de coiffe bigoudène",
      "Va y avoir de la ratatouille de démon"
    ],
    [
      null,
      null,
      null,
      "Hé ! Je le reconnais celui-là ! C'est le chef de la bande, celui avec la mèche !",
      "Y'a un démon qui a la même façon de voler que $other!",
      " Beurk! il a une tête de chou-fleur ce démon",
      "Ils sont plutôt lents ces démons...",
      "Ca va chauffer",
      "Tremblez démons ! La superbe $name va vous écraser !!",
      "Ils sont pas trés beaux ces démons...",
      "Houla celui-là est vraiment affreux",
      "C'est pas un démon rose que j'ai vu à l'instant ?",
      "Regarde ce coup là, c'est Piwali qui m'a appris ! hé hé"
    ],
    [
      null,
      null,
      null,
      null,
      null,
      null,
      "Je vais mettre toutes mes forces dans la bataille",
      "Je vais bloquer ces démons !"
    ],
    [
      "Je m'en occupe, concentre toi",
      "Qu'est ce qu'il est moche celui-là !",
      "Je le finis, et je reviens t'aider",
      "Tu penses y arriver tout seul ?",
      "Je m'en débarasse avant même que tu finisses le niveau",
      "Il va nous faire perdre notre temps ce démon!"
    ],
    [
      "Houlaaaa, plus ils sont gros plus ils sont moches ces démons",
      "Il me faudrait une tapette à démon",
      "Y'a un démon qui a la même façon de voler que $other !",
      "Je m'en occupe, tu me regardes hein ?",
      "Super $name Attack, ça sonne bien ?",
      "Mais ils sont rapides quand même !!",
      "Attention je vais sortir ma super attaque : fourchette pow@@@",
      "Kowabungaaa"
    ],
    [
      "J'aurais pas dû venir",
      "Je me méfierai des balades avec toi la prochaine fois",
      "Pourquoi ça tombe sur moi?",
      "Ne jamais suivre quelqu'un dans une forêt ça finit toujours mal je le savais"
    ]
  ],
  "AMBIANCE_STRESS": [
    [
      "Ne te relâche pas ! Tu peux encore t'en sortir",
      "Rien n'est perdu, reste bien concentré !",
      "Tu peux encore y arriver"
    ],
    [
      null,
      null,
      null,
      null,
      "Houla, ça sent le roussi",
      "Ca va aller ?"
    ],
    [
      null,
      "Et voilà, on est foutus !",
      "Alors là, je vois pas comment tu vas t'en sortir",
      "Tu joues vraiment mal...",
      "C'est pas comme ça qu'on va avancer...",
      "Ca sent la fin...",
      "Je savais que ça finirait comme ça...",
      "bon les erreurs c'est fait, les jolis coups tu as ?"
    ],
    [
      "Tu veux un coup de main ?",
      "Avec un peu de mana, je peux nettoyer le plateau !!",
      "Tu vas t'en sortir tout seul ?",
      "Tu penses pouvoir t'en sortir sans moi ?"
    ],
    [
      null,
      null,
      "Hola, je veux pas voir ça !",
      "Houlala c'est la méga catastrophe !",
      "Bon, ben... on se retrouve dehors ?",
      "T'aurais pas des problèmes avec ton clavier?"
    ],
    [
      null,
      null,
      null,
      "Tiens bon !",
      "Je suis de tout coeur avec toi...",
      "Je ne sais pas quoi faire pour t'aider..."
    ],
    [
      "respire, respire",
      "calme toi, on va pas arrêter maintenant",
      "bon, là, tu peux prendre ton temps",
      "comment t'as pu entasser tout ça ?"
    ],
    [
      "Ah, là c'est sûr, c'est dommage le coup de tout à l'heure",
      "Je suis sûre que si tu te concentres bien, c'est faisable",
      "Je voudrais vraiment t'aider",
      "Et en fait quand on est là, il se passe quoi ?",
      "C'est pas très bon là, non ?",
      "mais comment t'as fait pour arriver si haut?"
    ],
    [
      "Bon, ben, je crois que c'est l'heure de rentrer",
      "je te l'avais bien dit qu'il fallait rester à la maison",
      "j'ai pris des coups pour rien ...",
      "tout ca pour ca?"
    ]
  ],
  "WORD_THIEF": [
    "un colibri envouté",
    "un chat très rapide",
    "une mygale farceuse",
    "une grenouille à moitié folle",
    "un lézard désespéré",
    "un singe alcoolique",
    "un écureuil avare",
    "un lutin cleptomane",
    "$2faerieName",
    "$badName",
    "un iguane très véloce",
    "une belette",
    "un lapin acrobate"
  ],
  "WORD_KINGDOM": [
    "le royaume des Euriglides",
    "le royaume de Fort Fort Lointain",
    "le royaume de Pompulinu",
    "le royaume de Timothé le chauve",
    "l'empire biramique",
    "l'empire de Chormi le sâge",
    "l'empire OrnoSimeen",
    "l'empire des fleurs sauvages",
    "Le college de magie de PocheVille",
    "Le fort misérable de Pocheville",
    "Le temple de Yurihle"
  ],
  "WORD_HISTORY": [
    "d'histoires droles",
    "de contes",
    "de poemes",
    "d'enigmes",
    "du plus gros mensonge",
    "de legendes",
    "de fables",
    "d'histoires effrayantes"
  ],
  "WORD_FUN_GAME": [
    "d'echecs",
    "de dames",
    "de fruti belote",
    "de château de cartes",
    "de Pierre Feuille Ciseau",
    "du plus grand chiffre",
    "de charades",
    "de mime",
    "de rebus",
    "de dessins"
  ],
  "WORD_LONG_TIME": [
    "plus de 7 ans",
    "des millénaires",
    "plus d'un siècle",
    "le début de la semaine",
    "plus de milles lunes",
    "des lustres"
  ],
  "WORD_VICTIMS": [
    "les nains",
    "les farfadets",
    "les coccinelles",
    "les libellules",
    "les trolls",
    "les poussins",
    "les lapinous",
    "les hommes champignons",
    "les tzongres"
  ],
  "WORD_FROM_LOCATION": [
    "du moulin",
    "de la foret enchantee",
    "du cimetierre abandonne",
    "de la source endormie",
    "des champs de mais",
    "de la plaine voisine",
    "du champ de betterave",
    "de la ferme du vieux sam",
    "de la vallée de poro gora",
    "des bois sauvages",
    "du marais tondu",
    "du lac Tsonn",
    "de la cascade",
    "de Pochevile"
  ],
  "WORD_AT_LOCATION": [
    "aux grottes d'Hammerfest",
    "a la riviere de Simedia",
    "a la vallée de poro gora ",
    "au marais tondu",
    "a la clairiere du bucheron",
    "au mont Pigremel",
    "a la colline des anges",
    "au pic du sud",
    "au bout du monde",
    "derriere la dune de Moorg",
    "dans les bois obscures",
    "au frontière du royaume",
    "sur la route de PocheVille",
    "a l'eglise",
    "en pleine foret",
    "au milieu du rond point",
    "a la fête du village",
    "au restaurant",
    "a l'antre des hippos",
    "a la taverne de PocheVille",
    "a la cascade"
  ],
  "WORD_BAD_NAME": [
    "Sorog le rouge",
    "Tourneboule le chetif",
    "Cormerone le sorcier",
    "Goyave le solitaire",
    "Tom tom le piment qui arrache",
    "Morkar le necromancien",
    "Bishamon le pourfendu",
    "Choh rizo le visqueux",
    "Pigrom le dodu",
    "Salum le berger diabolique",
    "Nedy le cavalier du tartare",
    "Goubij le calif menteur",
    "Gabaloom l'homme ours",
    "Birmain de Moquepaille",
    "Tocheto le bossu",
    "Polchoi le sinistre vampelin",
    "Cormocroute le rassi",
    "Shalala le menestrel déchu"
  ],
  "WORD_ACTION_PAST_FUN": [
    "prenait son déjeuner",
    "bronzait paisiblement au soleil",
    "dormait comme une bûche",
    "jouait au tennis avec $2faerieName",
    "détruisait un champignon à coups de masse",
    "peignait un nouveau tableau",
    "faisait du vélo",
    "s'entraînait au lancer de poids",
    "mangeait une cerise",
    "mangeait une frite",
    "faisait de la balançoire",
    "construisait une cabane",
    "déplaçait une grosse pierre",
    "portait un cafard sur son dos",
    "cultivait des carottes",
    "faisait du shopping",
    "discutait avec $2faerieName",
    "sculptait une morille",
    "jouait aux cartes avec $2faerieName",
    "faisait de la balançoire",
    "jouait à la marelle"
  ],
  "WORD_LOST_OBJECT": [
    "sa theiere",
    "sa boucle d'oreille",
    "son nounours",
    "son sac",
    "son talisman",
    "sa bague en jade",
    "sa paire de ciseaux",
    "son journal",
    "son portefeuille",
    "une petite boite en forme de coeur",
    "une panier a fruits",
    "son disque vinyl de Dave",
    "sa cassette de Claude François",
    "son DVD des plus belles choregraphies de Tourneboule",
    "sa trousse de maquillage",
    "son telephone portable",
    "sa montre",
    "son epingle a cheveux",
    "son tube de vert à levres",
    "une dent",
    "son sandwich",
    "son sac",
    "sa carte de bus",
    "sa bouee jaune",
    "son livre d'images sur les orang-outans",
    "son epluche legume",
    "son ramasse banane",
    "son tir agrafes",
    "son velo d'appartement",
    "son ticket de tranport oie sauvage",
    "un poulet en caoutchouc avec une poulie au milieu",
    "une quantite incroyable de pin's collector de kaluga",
    "sa broche piwali",
    "sa mini frusion"
  ],
  "WORD_PERIOD": [
    " trimestriel",
    " annuel",
    " journalier",
    " de la semaine",
    " du siecle",
    " mensuel"
  ],
  "WORD_SUPER": [
    " super",
    " fabuleux",
    " incroyable",
    " fantastique",
    " génial",
    " vraiment hype",
    " complètement fumé",
    " hallucinant",
    " super tendance",
    " vraiment génial"
  ],
  "WORD_FROM_INVADER": [
    "des ignobles trolls des montagnes",
    "des impitoyables hommes-mangoustes du sud",
    "des affreux hommes-lezards",
    "de Krom le géant malicieux",
    "de Sakurim le dragon des océans",
    "des cruels tournesols des enfers"
  ],
  "TRUC": [
    "un truc",
    "un machin",
    "un nouveau truc",
    "un nouveau machin",
    "un bidule"
  ],
  // Lang.SENT_GET_FOOD — la fée salue l'aliment qui décolle (reactItem).
  // Quatre rangées : aimé, détesté, rare (dix et plus), ordinaire — puis
  // l'humeur choisit la ligne. Une case nulle est un silence. Deux paires de
  // phrases de l'original se touchent sans virgule : le compilateur les
  // collait en une seule, on les colle pareil.
  "SENT_GET_FOOD": [
    [
      ["Chouette ! $food !", "$food, youpiii"],
      ["$food ? Ca sent bon !", "$food, hum ça a l'air bon"],
      ["$food ? On aura pas perdu la journée !", "$food, je vais enfin manger correctement"],
      ["Héhé, voici ma récompense : $food !!", "$food, je vais me régaler"],
      ["$food ! C'est super bon !", "$food, ca a l'air bon"],
      [null, "$food ! Quelle chance !"],
      ["Hmm, je vais me régaler!", "$food, j'espérais en trouver"],
      ["$food, Ouais, je vais me régaler j'adore ça, c'est génial", "Au diable le régime, vive la gourmandise!!"],
      ["$food ? Ca sent bon !", "Chouette ! $food !"]
    ],
    [
      ["$food...", "Dommage, $food"],
      ["Beurk c'est quoi ça ?", "Oh noooonn!! Pas $food"],
      ["$food !? Tu as interêt à le jeter!", "fais venir un goûteur, je ne touche pas à ça sans être sûre", "Pouah et tu penses que je vais manger ca?", "Je préfère encore partir si tu n'as que ça à me donner"],
      ["$food !? Compte pas sur moi pour manger ça !", "Je sens que je vais faire un regime moi!"],
      ["Mon dieu ! Ne me dis pas que tu vas garder ça !", "Je préfère mourir que de cohabiter avec $food !"],
      ["*soupir*", "Dommage"],
      ["$food! tout ça pour ça?", "$food, faut jeter ça !!"],
      ["$food! Beurkkk, comment on peut manger ça ?", "Soit on le jette, soit on le donne à $other", "J'espère que t'as faim parce que je mange pas ça moi"],
      ["Beurk, encore un truc qui va moisir", "Vu que j'en mange pas on peut peut-être le jeter non?"]
    ],
    [
      ["Oh !! $food ! On en voit pas souvent !"],
      ["Ah, Enfin ! $food ! C'est pas trop tôt !"],
      ["Oh !! $food ! On en voit pas souvent !"],
      ["Oh !! $food ! ah, enfin, pas trop tôt, un met digne de moi"],
      ["Oh !! $food ! On en voit pas souvent !"],
      ["Oh !! $food ! On en voit pas souvent !"],
      ["Oh !! $food ! On est vraiment pas venus pour rien !"],
      ["Waw!! $food!! C'est super rare, y a de quoi être super youpi-framboise"],
      ["$food!! ça c'est rare!!"]
    ],
    [
      ["$food !", "Oh, $food", "tiens? $food, on partagera avec $other"],
      ["Ho, on dirait $food.", "$food!Tiens? $food, ca faisait longtemps!", "tiens? $food, on partagera avec $other"],
      ["Encore $food...", "$food...", "$food, hé ben voila le repas de ce soir", "tiens? $food, on partagera avec $other"],
      ["$food !", "$food, c'est déjà ca", "$food, Au moins, ça cale l'estomac", "tiens? $food, on partagera avec $other"],
      ["$food !", "Au moins, ça cale l'estomac", "tiens? $food, on partagera avec $other"],
      [null, "...", "tiens? $food, on partagera avec $other"],
      ["On perd notre temps avec ça", "juste $food", "tiens? $food, on partagera avec $other"],
      ["$food !", "$food, Tu crois que c'est bon avec du chocolat ?", "$food, C'est pas mauvais pour ma ligne au moins ?", "Ca va être sympa pour décorer le bocal", "tiens je comptais en acheter chez superfée", "tiens? $food, on partagera avec $other"],
      ["$food !", "$food, hé ben voila le repas de ce soir", "tiens? $food, on partagera avec $other"]
    ]
  ],
  // Lang.SENT_GET_ITEM — même chose pour un objet, une ligne par humeur.
  "SENT_GET_ITEM": [
    ["Cool ! $item !", "$item, ça c'est cool!"],
    ["Ah c'est quoi ce truc ?", "Tiens ! Un nouveau machin !", "Houla ! C'est quoi ca ?"],
    ["Encore $item !", "$item ? Bof...", "Toujours les mêmes objets...", "Voilà de la nouvelle quincaillerie..."],
    ["Grâce à moi on a récupéré $item !", "$item !!! Rien que pour moi !", "$item ! Je l'ai bien mérité...Maintenant c'est à moi"],
    ["$item ? Trop de la balle !!", "Avec $item à la main, j'ai peur de rien !", "La vie c'est comme une boîte de chocolat..."],
    [null, "$item , J'espère que ça te plaît...", "... "],
    ["Bon, on prend ça et on y va", "$item, ça pourra toujours servir"],
    ["Waw,$item, mais qu'est ce qu'on va en faire ?", "Oh, c'est quoi ça ?", "Tu crois que c'est utile ?", "$item, je veux tester ça !!!", "Youki je sais pas ce que c'est mais Youki!!"],
    ["Ca a une drôle de forme tu crois que ça se mange?", "Ah c'est quoi ce truc ?", "Et ça va m'aider ca?", "Je pourrais me cacher avec tu crois?"]
  ]
};

// Lang.getItemFamily — comment la fée NOMME un objet qu'elle ne connaît pas :
// par sa famille, jamais par son nom exact.
LANGUE.getItemFamily = function (n, alea) {
  const hasard = alea || Math.random;
  if (n >= 0 && n < 30) return "un objet magique";
  if (n >= 40 && n < 50) return LANGUE.TRUC[Math.floor(hasard() * LANGUE.TRUC.length)];
  if (n >= 50 && n < 60) return "une orbe";
  if (n >= 60 && n < 70) return LANGUE.TRUC[Math.floor(hasard() * LANGUE.TRUC.length)] + " coloré";
  if (n >= 70 && n < 80) return "une potion";
  if (n >= 80 && n < 90) return "un nouveau sac";
  if (n >= 100 && n < 200) return "un parchemin";
  if (n >= 200 && n < 300) return "un livre";
  if (n === 30) return "un bocal";
  if (n === 31) return "une clé";
  return "un Kouglof";
};

if (typeof module !== 'undefined' && module.exports) module.exports = LANGUE;
else racine.MinipixizLangue = LANGUE;

})(typeof window !== 'undefined' ? window : globalThis);
