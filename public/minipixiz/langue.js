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
  ]
};

if (typeof module !== 'undefined' && module.exports) module.exports = LANGUE;
else racine.MinipixizLangue = LANGUE;

})(typeof window !== 'undefined' ? window : globalThis);
