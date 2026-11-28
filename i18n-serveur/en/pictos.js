'use strict';
/*
 * DICTIONNAIRE ANGLAIS DU SERVEUR — LES NOMS DES PICTOS, par leur identifiant
 * de catalogue (`pictos.<id>`, GAME_ITEM_INFO dans server.js), et les gabarits
 * des familles engendrées (`pictos.famille.*` : « Monstre 12 », « Parchemin de
 * Foudre », « Pain (petit) », « Diamant or »). `nomDePicto(id)` en fait un texte
 * traduisible ; le nom français reste celui du catalogue (bureau Flash, forum,
 * ordre d'affichage). Un identifiant absent d'ici garde son nom français.
 *
 * Restent tels quels : les noms propres (Piwali, Makulo, Kagulga, les écuries
 * de Burning Kiwi, les personnages de Swapou), et — choix de l'admin, « le
 * jeu de mots plus tard » — les fruits de Frutisnake (« Fruit 12 »), qui ne
 * sont pas dans le catalogue.
 *
 * JamaJama : le nom de chaque picto de l'album (`pictos.$jama_pictoNN`) et sa
 * condition (`pictos.jamaQuoi.<n>`, jamaPictos.js).
 */
const d = {
  // ── Les gabarits des familles ──
  'pictos.famille.monstre': 'Monster {n}',
  'pictos.famille.parchemin': 'Scroll of {sort}',
  'pictos.famille.livre': 'Book of {sort}',
  'pictos.famille.aliment': '{aliment} ({taille})',
  'pictos.famille.diamant': '{matiere} diamond',
  'pictos.taille.petit': 'small',
  'pictos.taille.moyen': 'medium',
  'pictos.taille.grand': 'large',

  // ── Kaluga ──
  'pictos.$butterfly0': 'Green butterfly',
  'pictos.$butterfly1': 'Yellow butterfly',
  'pictos.$butterfly2': 'Pink butterfly',
  'pictos.$butterfly3': 'Purple butterfly',
  'pictos.$smiley0': 'White flag',
  'pictos.$smiley1': 'Red flag',
  'pictos.$smiley2': 'Track gong',
  'pictos.$basket': 'Basket',
  'pictos.$bird': 'Crow',
  'pictos.$ring': 'Kaluga Special',
  'pictos.$ant': 'Ant',

  // ── Swapou ──
  'pictos.$sel': 'Salt',
  'pictos.$poivre': 'Pepper',
  'pictos.$epee': 'Dagger',
  'pictos.$piment': 'Chili',
  'pictos.$dent': 'Tooth',
  'pictos.$sucre': 'Sugar',
  'pictos.$photo01': 'Dimitri photo',
  'pictos.$photo02': 'Natacha photo',
  'pictos.$photo03': 'Sel photo',
  'pictos.$photo04': 'Poivre photo',
  'pictos.$photo05': 'Moutarde photo',
  'pictos.$photo06': 'Tomtom photo',
  'pictos.$photo07': 'Wasabi photo',

  // ── MotionBall ──
  'pictos.$bfacettes': 'Faceted ball',
  'pictos.$bnormal': 'Normal bumper',
  'pictos.$btime': 'Time bumper',
  'pictos.$bdeath': 'Bumper of death',
  'pictos.$bmagnet': 'Magnetic bumper',
  'pictos.$bshadow': 'Invisible bumper',
  'pictos.$oeil': 'Octopus eye',
  'pictos.$masque': 'TB\'s mask',
  'pictos.$eca0': 'Blue scale',
  'pictos.$eca1': 'Red scale',
  'pictos.$eca2': 'Green scale',
  'pictos.$eca3': 'Brown scale',
  'pictos.$symb0': 'Water logo',
  'pictos.$symb1': 'Fire logo',
  'pictos.$symb2': 'Wind logo',
  'pictos.$symb3': 'Earth logo',

  // ── Burning Kiwi ──
  'pictos.$fruticup': 'Silver Fruticup',
  'pictos.$fruticupxl': 'Gold Fruticup',
  'pictos.$elite': 'Silver Elite',
  'pictos.$elitexl': 'Gold Elite',
  'pictos.$logo01': 'UWE Wing team',
  'pictos.$logo02': 'Fury Hun team',
  'pictos.$logo03': 'Sonic Brain team',
  'pictos.$logo04': 'KiwiX team',
  'pictos.$logo05': 'Ultra team',
  'pictos.$car01': 'UWE Wing racer',
  'pictos.$car02': 'Fury Hun racer',
  'pictos.$car03': 'Sonic Brain racer',
  'pictos.$car04': 'KiwiX racer',
  'pictos.$car05': 'Ultra racer',

  // ── MiniWave ──
  'pictos.$smiley_love': 'Over the moon smiley',
  'pictos.$smiley_laugh': 'Ecstatic smiley',
  'pictos.$smiley_twirl': 'Delighted smiley',
  'pictos.$wpMinistar': 'Ministar wallpaper',
  'pictos.$wpNostromo': 'Nostromo wallpaper',

  // ── Mini-Fever : une épreuve par picto ──
  'pictos.$fvBasket': 'Basket',
  'pictos.$fvLander': 'Moon landing',
  'pictos.$fvFlower': 'Watering',
  'pictos.$fvPong': 'Return',
  'pictos.$fvAstero': 'Asteroids',
  'pictos.$fvParachute': 'Parachute',
  'pictos.$fvGobelet': 'Shell game',
  'pictos.$fvMarmite': 'Cauldron',
  'pictos.$fvGather': 'Gust',
  'pictos.$fvTubulo': 'Pistons',
  'pictos.$fvTrampoline': 'Trampoline',
  'pictos.$fvOrbital': 'Orbit',
  'pictos.$fvJumpFish': 'Photo',
  'pictos.$fvPatate': 'Vegetable',
  'pictos.$fvApple': 'Apple',
  'pictos.$fvBomb': 'Bomb',
  'pictos.$fvFrog': 'Frog',
  'pictos.$fvCliff': 'Cliff',
  'pictos.$fvChain': 'Chain',
  'pictos.$fvGhost': 'Ghost',
  'pictos.$fvBalance': 'Balance',
  'pictos.$fvPicture': 'Painting',
  'pictos.$fvPlate': 'Plate',
  'pictos.$fvPoint': 'Dotted lines',
  'pictos.$fvSpaceDodge': 'Dodge',
  'pictos.$fvHammer': 'Mallet',
  'pictos.$fvTaquin': 'Sliding puzzle',

  // ── MiniPixiz : les objets ──
  'pictos.$pixiz_item30': 'Flask',
  'pictos.$pixiz_item31': 'Key',
  'pictos.$pixiz_item40': 'Invisibility',
  'pictos.$pixiz_item41': 'Mask of fear',
  'pictos.$pixiz_item42': 'Life regeneration',
  'pictos.$pixiz_item43': 'Mana regeneration',
  'pictos.$pixiz_item44': 'More experience',
  'pictos.$pixiz_item45': 'Horned helmet',
  'pictos.$pixiz_item46': 'Totoche',
  'pictos.$pixiz_item50': 'Globe +1 - Strength',
  'pictos.$pixiz_item51': 'Globe +1 - Agility',
  'pictos.$pixiz_item52': 'Globe +1 - Life',
  'pictos.$pixiz_item53': 'Globe +1 - Charisma',
  'pictos.$pixiz_item54': 'Globe +1 - Magic',
  'pictos.$pixiz_item55': 'Globe +1 - Wisdom',
  'pictos.$pixiz_item70': 'Small potion',
  'pictos.$pixiz_item71': 'Medium potion',
  'pictos.$pixiz_item72': 'Big potion',
  // ── MiniPixiz : les sorts (parchemins et livres) ──
  'pictos.pixizSort.0': 'Swap',
  'pictos.pixizSort.1': 'Dig',
  'pictos.pixizSort.2': 'Miner',
  'pictos.pixizSort.3': 'Massive',
  'pictos.pixizSort.4': 'Star Eater',
  'pictos.pixizSort.5': 'Decompression',
  'pictos.pixizSort.6': 'Fossilization',
  'pictos.pixizSort.7': 'Ascension',
  'pictos.pixizSort.8': 'Berserk',
  'pictos.pixizSort.9': 'Slice',
  'pictos.pixizSort.10': 'Silence',
  'pictos.pixizSort.11': 'Destruction',
  'pictos.pixizSort.12': 'Shield',
  'pictos.pixizSort.13': 'Nova',
  'pictos.pixizSort.14': 'Banishment',
  'pictos.pixizSort.15': 'Lightning',
  'pictos.pixizSort.16': 'Paint',
  'pictos.pixizSort.20': 'Ball of Light',
  'pictos.pixizSort.21': 'Ray of Light',
  'pictos.pixizSort.22': 'Solero',
  'pictos.pixizSort.23': 'Will-o\'-the-wisp',
  'pictos.pixizSort.24': 'Glue',
  'pictos.pixizSort.25': 'Flame',
  'pictos.pixizSort.26': 'Holy Ball',
  'pictos.pixizSort.27': 'Ghost',
  // ── MiniPixiz : les aliments (Food.mt), et les diamants ──
  'pictos.pixizAliment.0': 'Bread',
  'pictos.pixizAliment.1': 'Grapes',
  'pictos.pixizAliment.2': 'Salad',
  'pictos.pixizAliment.3': 'Rusk',
  'pictos.pixizAliment.4': 'Pear',
  'pictos.pixizAliment.5': 'Ice cream',
  'pictos.pixizAliment.6': 'Egg',
  'pictos.pixizAliment.7': 'Gouda',
  'pictos.pixizAliment.8': 'Banana',
  'pictos.pixizAliment.9': 'Brioche',
  'pictos.pixizAliment.10': 'Cotton candy',
  'pictos.pixizAliment.11': 'Chinese noodles',
  'pictos.pixizAliment.12': 'Leek',
  'pictos.pixizAliment.13': 'Melon',
  'pictos.pixizAliment.14': 'Corn',
  'pictos.pixizAliment.15': 'Cherry',
  'pictos.pixizAliment.16': 'Sushi',
  'pictos.pixizAliment.17': 'Fruit pie',
  'pictos.pixizAliment.18': 'Yakitori',
  'pictos.pixizDiamant.1': 'Copper',
  'pictos.pixizDiamant.2': 'Silver',
  'pictos.pixizDiamant.3': 'Gold',
  'pictos.pixizDiamant.4': 'Ruby',
  'pictos.pixizDiamant.5': 'Shard',

  // ── JamaJama : les paliers d'avant l'album ──
  'pictos.$jama_first': 'First Tiki move',

  // ── JamaJama : l'album (les noms, puis les conditions) ──
  'pictos.$jama_picto01': 'First pulp',
  'pictos.$jama_picto02': 'Freshly squeezed',
  'pictos.$jama_picto03': 'Peach of hell',
  'pictos.$jama_picto04': 'Pear-fect',
  'pictos.$jama_picto05': 'Plum crazy',
  'pictos.$jama_picto06': 'Fatal attraction',
  'pictos.$jama_picto07': 'Heart of gold',
  'pictos.$jama_picto08': 'Arachnophobe',
  'pictos.$jama_picto09': 'Pyrotechnician',
  'pictos.$jama_picto10': 'Tom Thumb',
  'pictos.$jama_picto11': 'Rude awakening',
  'pictos.$jama_picto12': 'Splash!',
  'pictos.$jama_picto13': 'Fried Electrificator',
  'pictos.$jama_picto14': 'Wrong way',
  'pictos.$jama_picto15': 'Precious stone',
  'pictos.$jama_picto16': 'Teleportation',
  'pictos.$jama_picto17': 'Greedy buddy',
  'pictos.$jama_picto18': 'The Lurker cracks up',
  'pictos.$jama_picto19': 'Creator',
  'pictos.$jama_picto20': 'Little Star',
  'pictos.$jama_picto21': 'Runes of Pilat',
  'pictos.$jama_picto22': 'Typing hero',
  'pictos.$jama_picto23': 'Ghost',
  'pictos.$jama_picto24': 'Ready for the great adventure',
  'pictos.$jama_picto25': 'All fired up',
  'pictos.$jama_picto26': 'Little star',
  'pictos.$jama_picto27': 'The evil Zoeil',
  'pictos.$jama_picto28': 'The road to deliverance',
  'pictos.jamaQuoi.1': 'Merge your first 10 pairs of fruit',
  'pictos.jamaQuoi.2': 'Merge 100 pairs of fruit',
  'pictos.jamaQuoi.3': 'Burn 25 fruits with a BoBomb',
  'pictos.jamaQuoi.4': 'Finish a level where at least one fruit was burnt and another merged',
  'pictos.jamaQuoi.5': 'Merge 1,000 pairs of fruit',
  'pictos.jamaQuoi.6': 'Get a magnet to pull 50 objects',
  'pictos.jamaQuoi.7': 'Finish the Adventure levels that have a golden magnet',
  'pictos.jamaQuoi.8': 'Finish 10 spider levels without a single spider dying',
  'pictos.jamaQuoi.9': 'Blow up 100 BoBombs',
  'pictos.jamaQuoi.10': 'Let a BoBomb\'s flames pass through 10 pebbles or runes',
  'pictos.jamaQuoi.11': 'Get 20 spiders out of their cocoons',
  'pictos.jamaQuoi.12': 'Sink 50 crates in the water',
  'pictos.jamaQuoi.13': 'Finish the Adventure levels that have an Electrificator and a BoBomb',
  'pictos.jamaQuoi.14': 'Go over a one-way track 200 times',
  'pictos.jamaQuoi.15': 'Finish a level with jade in it',
  'pictos.jamaQuoi.16': 'Swap places with Kohl 50 times',
  'pictos.jamaQuoi.17': 'Get a Louki to eat 100 walls, crates or Loukis',
  'pictos.jamaQuoi.18': 'Finish the Adventure\'s Lurker levels without losing in between',
  'pictos.jamaQuoi.19': 'Publish a validated level in the Editor',
  'pictos.jamaQuoi.20': 'Finish Cave 14 “Winkle, Little Star” in under 40 moves',
  'pictos.jamaQuoi.21': 'Finish Cavern II-9 “Les runes du Pilat”',
  'pictos.jamaQuoi.22': 'Finish a star Cavern (I-*, II-*…)',
  'pictos.jamaQuoi.23': 'Make 1,000 moves as a ghost',
  'pictos.jamaQuoi.24': 'Finish the 16 “Premiers pas” levels',
  'pictos.jamaQuoi.25': 'Complete the “Tout feu tout flamme” series (its Cavern II-*)',
  'pictos.jamaQuoi.26': 'Own a Winkle and release it in the water 25 times',
  'pictos.jamaQuoi.27': 'Block a Zoeil by pushing a crate onto it',
  'pictos.jamaQuoi.28': 'Get the other 27 JamaJama pictos',
};

// Les familles numérotées, qui ne changent que de mot.
for (const n of [1, 2, 3]) {
  d['pictos.$metal0' + n] = 'Metal ' + n;
  d['pictos.$ice0' + n] = 'Ice ' + n;
  d['pictos.$star0' + n] = 'Star ' + n;
}
for (let i = 0; i <= 5; i++) d['pictos.$ship0' + i] = 'Ship ' + i;
// MotionBall : sept balles, trois métaux (« Balle jaune or » → Gold yellow ball).
const BALLES = ['yellow', 'green', 'red', 'orange', 'blue', 'metal', 'purple'];
BALLES.forEach((couleur, i) => {
  d[`pictos.$c${i + 1}or`] = `Gold ${couleur} ball`;
  d[`pictos.$c${i + 1}argent`] = `Silver ${couleur} ball`;
  d[`pictos.$c${i + 1}`] = `Bronze ${couleur} ball`;
});
// MiniPixiz : les caractéristiques +1/+2/+3, les colorations, les sacs.
const CARAC = { 0: 'Gloves', 5: 'Boots', 10: 'Heart', 15: 'Tiara', 20: 'Idol', 25: 'Pearl' };
for (const [base, nom] of Object.entries(CARAC)) {
  for (let k = 0; k < 3; k++) d['pictos.$pixiz_item' + (Number(base) + k)] = `${nom} +${k + 1}`;
}
for (let k = 1; k <= 10; k++) d['pictos.$pixiz_item' + (59 + k)] = 'Coloring ' + k;
for (let k = 1; k <= 4; k++) d['pictos.$pixiz_item' + (79 + k)] = 'Bag +' + k;
// JamaJama : les paliers « N niveaux joués ».
for (const n of [10, 25, 50, 100, 250, 500, 1000]) d['pictos.$jama_play' + n] = `${n} levels played`;

module.exports = d;
