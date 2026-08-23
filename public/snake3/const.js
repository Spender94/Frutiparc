/*
 * Frutisnake (snake3) — les constantes, transcrites de Const.as.
 *
 * RÈGLE DU PORTAGE : ce fichier dit la même chose que Games/snake3/Const.as,
 * nombre pour nombre, nom pour nom. S'il faut ajuster un comportement, ce
 * n'est pas ici — ici, c'est le jeu de 2004.
 *
 * ── La cadence (Std, bibliothèque asml de Motion-Twin) ──
 *
 * L'en-tête du SWF annonce QUARANTE images par seconde : c'est la fréquence à
 * laquelle Flash redessine. La vitesse du jeu, elle, vient de Std.tmod, comme
 * pour Mini-Wave : le bloc statique de Std est compilé dans snake3.swf
 * (obfusqué — mais snake3_obfu.txt liste bien +tmod, +wantedFPS, +deltaT,
 * +maxDeltaTime, +tmod_factor, et le bytecode contient l'unique double 0,95
 * du tmod_factor). Les valeurs sont celles de la bibliothèque :
 *
 *     Std.maxDeltaTime = 0.5      (deltaT plafonné, en secondes)
 *     Std.wantedFPS    = 32       (l'unité de tmod : une image « pleine »
 *                                  dure un trente-deuxième de seconde)
 *     Std.tmod_factor  = 0.95     (lissage : tmod = tmod×0.95 + 0.05×deltaT×32)
 *
 * Les TimedSlot comptent en Std.deltaT — des secondes vraies — d'où le
 * commentaire « temps en secondes » au-dessus des TIME_*.
 */
'use strict';

(function (racine) {

const C = {};

C.WIDTH = 700;
C.HEIGHT = 480;

C.FRUIT_MAX = 300;
C.FRUIT_POURRIS_MAX = 22;
C.FRUIT_DEBLOK = 20;
C.FRUIT_NAME_LEARN = 10;

// divers
C.FRUITS_FREQ = 375;
C.FRUIT_BASE = 60;
C.FBARRE_MAX = 150;
C.FBARRE_PERMANENT_LOOSE = 0.004;
C.FBARRE_EAT_FRUIT = 0.7;
C.FBARRE_FRUIT_TIMEOUT = -1;
C.BONUS_FREQ = 600;

// Const.PROBABILITIES — le poids de chaque option au tirage
// (Std.randomProbas). L'ordre EST l'identifiant : PROBABILITIES[i] pèse le
// bonus id i+1. Les commentaires sont ceux du fichier d'origine.
C.PROBABILITIES = [
  340,  // petit ciseau        (1)
  150,  // moyen ciseau        (2)
  40,   // grand ciseau        (3)
  50,   // langue              (4)
  100,  // coffre              (5)
  4,    // potion rouge        (6)
  60,   // pillule             (7)  — les stéroïdes
  10,   // bague               (8)
  15,   // potion bleu         (9)
  7,    // potion rose         (10)
  5,    // potion violette     (11)
  10,   // ressort             (12)
  50,   // rondelle psychique  (13)
  7,    // inverseur           (14)
  2,    // potion noire        (15)
  7,    // baguette magique    (16) — la canne
  200,  // molecule            (17)
  70,   // double molecule     (18)
  5,    // bombe               (19)
  6,    // potion verte        (20)
  4,    // plume               (21)
  2,    // cyclope             (22) — le mauvais œil
  20,   // fleche              (23)
  10,   // fleche rouge        (24)
  40,   // potion orange       (25)
  3,    // potion jaune        (26)
  400,  // dynamite            (27)
  3,    // poupee              (28)
  30,   // aureole             (29)
  10,   // croix               (30)
  12,   // sonnette            (31)
  3,    // cloche              (32)
  9,    // pentacle            (33)
  40,   // sabre               (34)
  15,   // coffre à options    (35)
  50,   // pieu                (36)
  5,    // potion fuca         (37)
];

C.COLOR_SNAKE_DEFAULT = 0x009900;
C.COLOR_SNAKE_BORDER_DEFAULT = 0x006C00;
C.COLOR_SNAKE_INVINCIBLE = 0x89A6B5;
C.COLOR_SNAKE_BORDER_INVINCIBLE = 0x61869A;
C.COLOR_GAMEOVER = 0xADE76B;
C.COLOR_FRUIT_OMBRE = 0x82D823;
C.COLOR_CISEAUX = 0xFF0000;

C.FLECHE_ROTATION_SPEED = 10;
C.FLECHE_ROUGE_GENSPEED = 45;
C.FLECHE_BLEUE_GENSPEED = 25;
C.CROIX_GENSPEED = 45;

// temps en secondes (Std.deltaT)
C.TIME_POTIONROUGE = 30;
C.TIME_STEROIDS = 12.5;
C.TIME_POTIONBLEUE = 25;
C.TIME_POTIONROSE = 30;
C.TIME_POTIONVIOLETTE = 37.5;
C.TIME_RONDELLE = 6.3;
// Const.as : `80 + random(80)` dans l'INITIALISEUR STATIQUE — tiré UNE fois au
// chargement du SWF, pas à chaque potion. Toutes les potions vertes d'une même
// session durent donc pareil ; on rejoue ce hasard-là au chargement du module.
C.TIME_POTIONVERTE = 80 + Math.floor(Math.random() * 80);
C.TIME_POTIONORANGE = 30;
C.TIME_POTIONJAUNE = 30;
C.TIME_POTIONNOIRE = 30;
C.TIME_POTIONFUCA = 60;
C.TIME_PIEU = 30;
C.TIME_BOMBE = 5;

// Const.fruit_points — la table qui fait toute l'économie du jeu.
C.fruit_points = function (id) {
  if (id <= 40) return id * 5;
  else if (id <= 90) return 200 + (id - 40) * 10;
  else if (id <= 150) return 700 + (id - 90) * 20;
  else if (id <= 220) return 1900 + (id - 150) * 30;
  else if (id <= 260) return 4000 + (id - 220) * 50;
  else if (id <= 300) return 6000 + (id - 260) * 100;
  // fruit pourri (ids 321-342)
  return -(id - 320) * 250;
};

C.SNAKE_DEFAULT_SPEED = 3.3;
C.SNAKE_DEFAULT_TURN = 0.125;
C.SNAKE_DEFAULT_LENGTH = 3;

C.CHALLENGE_SPEED_COEF = 3;
C.CHALLENGE_FRICTION = 0.97;

// Battle
C.BATTLE_POWER_MAX = 60;
C.BATTLE_POWER_RECUP = 0.03;
C.BATTLE_FRICTION = 0.96;
C.BATTLE_ACCEL = 12;

C.BATTLE_COLORS = [0x009900, 0xDF2020, 0xE6D306, 0xFF9617];
C.BATTLE_BORDER_COLORS = [0x006C00, 0x841313, 0xA48006, 0xB45A01];

// Level.as — les marges du terrain, portées ici pour que le moteur n'ait
// qu'un fichier de nombres.
C.BARRE_UP = 60;
C.BARRE_DOWN = 10;
C.BORDER = 10;
C.FRUTIBARRE_SIZE = 15;

// Textes
C.TXT_COLOR = ['vert ', 'rouge ', 'jaune ', 'orange '];
C.TXT_BATTLE_DRAW = 'Egalité !';
C.TXT_BATTLE_WIN = (winner) => 'Le serpent ' + C.TXT_COLOR[winner] + 'a gagné !';
C.TXT_ENCYCLO_ZEROFRUITS = 'Aucun ';
C.TXT_ENCYCLO_VALUEUNK_SPECIAL = 'Devine ';
C.TXT_ENCYCLO_VALUEUNK = '? ';
C.TXT_CONNECTING_MESSAGE = 'Merci de patienter quelques instants.';
C.TXT_STARTING_GAME = 'Démarrage du jeu...';
C.TXT_ERROR = 'ERREUR !';
C.TXT_SCORE_SAVING = 'Sauvegarde en cours...';
C.TXT_SCORE_BATTLE = 'Résultats du Match :';
C.TXT_SCORE_BATTU = 'Bravo ! vous avez battu votre record !';
C.TXT_VOTRE_SCORE = (s) => 'Votre score : ' + s;
C.TXT_VOTRE_RECORD = (s) => 'Votre record personnel : ' + s;
C.TXT_VOTRE_PLACE = (p) => 'Votre classement aujourd\'hui : ' + p;
C.TXT_PLACE_GAGNEES = (p) => 'Vous avez gagné ' + ((p === 1) ? 'une place' : (p + ' places')) + ' dans le classement !';
C.TXT_FRUIT_NAME = function (id) {
  if (id >= 320) id -= 20;
  return C.FRUIT_NAMES[id - 1];
};
C.TXT_SCORE_WIN_FRUIT = function (id, n) {
  return 'Bravo ! Vous avez rammassé ' + n + ' fruits "' + C.TXT_FRUIT_NAME(id) + '" !\n'
    + 'Vous pouvez maintenant utiliser ce fruit sur le Forum !';
};
C.TXT_FRUIT_NAME_UNKNOWN = ' Inconnu ';
C.TXT_FRUIT_NAME_EN_COURS = 'Analyse en cours...';

// NOMS DE FRUITS — les 300 fruits puis les 22 pourris, dans l'ordre du
// fichier. La faute de « rammassé » est d'époque ; les espaces autour de
// certains noms aussi (le jeu les affiche tels quels).
C.FRUIT_NAMES = [
  ' pokiros ', 'pomme chauve', 'quartier de pomme', ' prunette ', ' gland ',
  ' goozblou ', 'noix de Gondomar', ' mornille ', ' grorange ', 'piwi rose',
  'carotte douce', ' mousselin ', ' harikou ', 'amande fraîche', 'baie d\'Ouen',
  'pain-pêche', 'prune marine', ' saccarolme ', ' citron ', ' dates ',
  ' fouillot ', 'oignon du Sahel', 'olivion confit', 'baie d\'Aran',
  'raisin glinglin', ' peurangue ', 'cerise burlat', 'baie du Bourg',
  'fouillot mure', ' girondine ', ' anemordorée ', ' nouaztek ',
  'paire de girondines', 'abricot velu', 'fève de Barcelos', 'outres birmanes',
  ' Frougère ', 'kiwi bob\'s leg', ' zilmeon ', ' ivreprune ', ' pastavia ',
  'figue de l\'abbe Santos', 'poire sableuse', ' poustil ', ' crocgnoles ',
  ' sarderose ', ' gramade ', ' noix ', ' grozine ', ' mangarine ',
  'fraise feroce d\'outre-sang', 'bouton de pecanette', ' dolmitos ',
  'pompine d\'Almansa', 'piastre aigre', 'jacquelin bossu', 'pêche papuleuse',
  ' florkebella ', 'coeur de Salamahari', 'coque d\'obeissance', 'ficus iberia',
  'fruit d\'Ostrac', 'fruit de Lupox', 'pelote ougandaise', 'fouillot séché',
  'prune triomphante', ' bogueraide ', ' moltereaux ', 'balauste latine',
  'baie d\'Inah', ' gornales ', 'noisette de Chaperet', ' mossetoise ',
  'merangue crispée', ' cookie ', 'pomme d\'Arnequin', 'perce-gazette',
  'navet lacté', ' malegousse ', 'grasse-langue de Salignac', ' obustang ',
  'paire de bolchevine', 'baie d\'Estipule', ' poiranque ',
  'tranche de goujaunaine', ' ondines ', ' palmeran ', ' rongemirage ',
  'niches d\'Armangaux', ' ficelode ', 'hisse-fièvre', 'festin du mendigot',
  ' pugne ', ' pruneau ', 'pastisson amère d\'Oberwart', 'cosse foraine',
  'corne d\'abondance', 'bourraine vermeille', 'bile-du-diable', ' cipoline ',
  ' rosat ', 'pivoc d\'Aleöne ', ' tourmerande ', 'poire Packham',
  'succul de Korma', ' Danoude ', 'cerise guillaume', 'noix du Sichuan',
  'courte-baies malsone', 'noeud-de-brume', ' rogneron ', ' indigoyave ',
  ' clocheboise ', ' turmelin ', 'saramise ecailleuse', 'fraise-papillon',
  ' mangueponce ', 'mi-cannebille', ' florion ', 'tomates cireuses du Mexique',
  'pêche Nelly', ' gorgamone ', ' cantebrise ', ' polyFrameole ',
  'lustre d\'Hyperion', ' chavenagre ', ' elibaba ', 'palet-sucre de Catamarca',
  'parmepugne frisée', 'citron velu d\'escampette', ' marapourpre ',
  ' cariano ', 'gousse de camerile', ' bolognos ', ' guignefauve ',
  'musette du pèlerin', ' lichelen ', ' polkine ', 'opalin des Malouines',
  ' ganesouge ', 'régal de mirmelin', 'poivre-chaud de Bilbao', ' toxecarne ',
  ' pierrot ', ' chicoutai ', ' coulemelle ', ' solivatre ',
  'parangon d\'Ispahan', ' pranterase ', 'mangue de Tulem', ' ecumides ',
  ' flasme ', ' poquecharde ', 'chaussette-du-pape', 'prune imperiale',
  ' saperin ', 'corne de boulingre', 'noix de coco', ' rostegibse ',
  ' geminicama ', ' saramiche ', 'pigne-reine', 'germe de cariano',
  ' fraiseraunes ', ' fauchelouge ', 'coloquinte ocre de Barbezieux',
  ' alnetrine ', 'larme du coquebin', 'grenat splendide de Manaus',
  'maille d\'Oursan', ' furnegrise ', 'alberge bergaline', ' mandrelouste ',
  'polne bourrelée', ' aigrette ', 'poire Bosc', 'fruit-du-guède',
  ' achegrèse ', ' morphéanulme ', ' veloutard ',
  'dazongre molle de San Fernando', ' annelet ', 'prunes totemiques d\'Abigaël',
  ' kibis ', 'nacre de Carbet', ' hypoponacre ', 'prune hyaline de Borza',
  'aumonière hirsute de Kaesong', 'rutabaga bicephale', ' goulveraide ',
  'fane amere du Rousillon', 'birmes tondues', 'paneton aubé', ' pouillemine ',
  'calebasse du wigam', 'polisson scléreux de masse-pierre', 'citron royal',
  ' pisquedine ', 'beuglante de Tachkent', 'baies rousses titanesque ',
  'cyclatrice tourmentée', ' pansedisette ', ' fristelin ',
  'pauline d\'aigue-sylvaine', 'violine d\'Istanbul', 'pescorelle gauloise',
  'corympe géante de Hapevoie', 'prune-givre', ' jaboticaba ',
  'agulme d\'Holmavik', ' bilimbi ', 'brochette de mochi', ' niguelion ',
  'piffre d\'Aude', 'charme-janthe', 'yubi constellé',
  'bulbe rosé de Gundagai', ' sorghine ', ' coquemyre ',
  'orbière méditerranéenne', ' pangrelot ', 'mangue piquée de saoul-rosse',
  'camelot de Louhans', 'triticale princière', ' pistelins ', ' moguerouge ',
  'purnerine d\'Apollon', 'arbouse géante de Gobi', ' hyspenasse ',
  'igname roux', 'courge funky', 'ecrin d\'Estoroth', 'gelée de cythere',
  ' pléthorane ', 'coiffe-matassin', ' dangarne ', ' pibom ', ' ambroisine ',
  ' argeraine ', ' noubab ', ' saccharide ', 'fuse d\'Op', ' nocemorte ',
  'poursenaille fleurie de Bangkok', ' perlerrante ',
  'cosserelle naine d\'Amandou', ' ravefane ', ' pulsenoire ', ' machepime ',
  'courge poncte de Chicoutimi', 'salamaude houppée', 'suiffe-grappe',
  'pognegrove de Selfoss', 'gorzine cassenadaise', ' folmerone ',
  'noix-bigre', 'alouate safrinée', 'gros tas de mirabelles',
  'brochette de moquenard', 'perle blanche', 'bocassin d\'espenil',
  'sangre-ploie estoupé', 'aigledrupe géant', 'coscard mièvre des graves',
  'pouc-marine', 'pêche-neige', 'tolmine supre d\'Astirmin',
  'plume-grasse colossale', ' smarterine ',
  'gossenaille cyclopéenne d\'Oblivion', ' monstropoire ', ' acolichte ',
  'cornacre lancelin ', ' pachycourge ',
  'esthioche singulière de Mont-Perron', ' oignefarge ',
  'carambolisse d\'Ouperang', 'dangarne monumentale',
  'kumquat ocre du Berhampur', 'anne-jumeleine', 'lorneline chanoine',
  'perle dorée', 'colche-ventrue d\'Eluos', 'trovinelles des marais',
  'polfregueuse de Casse-NaN', ' valseglante ', 'bideplune de Deorbalde',
  'maltre-chat de bubenys', 'herculime dyaphane de Boguebrud',
  'balzane galbée', 'pomme granite de Pitronde', 'caltesime de piong-ni',
  'potironne joustre de biche-râle', 'noix de Goliath', 'hotte-de-Brande',
  'pilme-en-pot', 'golfane d\'Iscanie', 'bille-changre des rebouteux',
  'pocsin de mascarade', 'cornette mauve de Malaisie',
  // POURRIS (ids 321-342, noms 301-322)
  'pichte-aigre', ' prunesangue ', 'olcre délétère', 'mouchtre fétide',
  'noeud-de-bile', 'flestrane de Gaubert', 'plaie de loutre', 'histre-taille',
  ' morsebrive ', ' flambergine ', ' limanide ', 'supplice du ka',
  'navechulne des mâne-folles', 'mirges toxiques de Cuzco',
  'ulsceme de Sapporo', 'grigue lépreuse ', 'poire-eventail', ' calveret ',
  'acre-gose de Galacao', 'crese nauseabonde de Sult',
  'lacherone d\'obbrefus', 'l\'infâme pamplefrousse',
];

// ── Std, la part utile ────────────────────────────────────────────────────

// Std.randomProbas(tab) : un index tiré au poids de tab.
C.randomProbas = function (probas, hasard) {
  let total = 0;
  for (let i = 0; i < probas.length; i++) total += probas[i];
  let n = hasard(total);
  for (let i = 0; i < probas.length; i++) {
    n -= probas[i];
    if (n < 0) return i;
  }
  return probas.length - 1;
};

// La cadence — mêmes valeurs que la bibliothèque asml (voir l'en-tête).
C.WANTED_FPS = 32;
C.TMOD_FACTOR = 0.95;
C.MAX_DELTA_TIME = 0.5;

const API = C;
if (typeof module !== 'undefined' && module.exports) module.exports = API;
else racine.SnakeConst = API;

})(typeof window !== 'undefined' ? window : globalThis);
