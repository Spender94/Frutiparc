// Game pictos / titems registry — maps item names (the `$foo` keys used in
// FrutiCard slot data) to their display name + game + GIF path. Mostly
// pure data, but the MiniPixiz section probes the filesystem at import
// time to skip pictos whose GIF asset is missing.
//
// Resolved relative to the project root (two levels up from this file).
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

const GAME_ITEM_INFO = {
  // ── Kaluga ──
  '$butterfly0': { name: 'Papillon vert',       game: 'Kaluga', gif: 'Games/kaluga/Titems/gif/papillonVert.gif' },
  '$butterfly1': { name: 'Papillon jaune',      game: 'Kaluga', gif: 'Games/kaluga/Titems/gif/papillonJaune.gif' },
  '$butterfly2': { name: 'Papillon rose',       game: 'Kaluga', gif: 'Games/kaluga/Titems/gif/papillonRose.gif' },
  '$butterfly3': { name: 'Papillon violet',     game: 'Kaluga', gif: 'Games/kaluga/Titems/gif/papillonViolet.gif' },
  '$smiley0':    { name: 'Drapeau blanc',       game: 'Kaluga', gif: 'Games/kaluga/Titems/gif/drapeauBlanc.gif' },
  '$smiley1':    { name: 'Drapeau rouge',       game: 'Kaluga', gif: 'Games/kaluga/Titems/gif/drapeauRouge.gif' },
  '$smiley2':    { name: 'Gong de piste',       game: 'Kaluga', gif: 'Games/kaluga/Titems/gif/gongPiste.gif' },
  '$smiley3':    { name: 'Heptathlon',          game: 'Kaluga', gif: 'Games/kaluga/Titems/gif/heptathlon.gif' },
  '$tz1':        { name: 'Piwali',              game: 'Kaluga', gif: 'Games/kaluga/Titems/gif/midPiwali.gif' },
  '$tz2':        { name: 'Nalika',              game: 'Kaluga', gif: 'Games/kaluga/Titems/gif/midNalika.gif' },
  '$tz3':        { name: 'Makulo',              game: 'Kaluga', gif: 'Games/kaluga/Titems/gif/midMakulo.gif' },
};

// Build MiniWave2 bads (bad00..bad50) and missions (mis0..mis4).
for (let i = 0; i <= 50; i++) {
  const pad = String(i).padStart(2, '0');
  GAME_ITEM_INFO[`$bads${i}`] = { name: `Monstre ${i}`, game: 'MiniWave', gif: `Games/miniWave2/titem/gif/bad${pad}.gif` };
}
for (let i = 0; i <= 4; i++) {
  GAME_ITEM_INFO[`$mis${i}`] = { name: `Mission ${i}`, game: 'MiniWave', gif: `Games/miniWave2/titem/gif/mis${i}.gif` };
}

// ── MiniPixiz (miniTroll) titems ──
// itemList from Games/miniTroll/src/Item.mt (item ID → name).
// In the assets folder the GIF file index is item_id + 1
// (e.g. item ID 0 = GANTS+1 → bmp/titems/GIF/item/item_1.gif).
const PIXIZ_ITEM_NAMES = {
  // CARAC (gloves/boots/heart/diadem/idol/pearl) +1/+2/+3
  0: 'Gants +1', 1: 'Gants +2', 2: 'Gants +3',
  5: 'Bottes +1', 6: 'Bottes +2', 7: 'Bottes +3',
  10: 'Cœur +1', 11: 'Cœur +2', 12: 'Cœur +3',
  15: 'Diadème +1', 16: 'Diadème +2', 17: 'Diadème +3',
  20: 'Idole +1', 21: 'Idole +2', 22: 'Idole +3',
  25: 'Perle +1', 26: 'Perle +2', 27: 'Perle +3',
  // Utility
  30: 'Flasque', 31: 'Clé',
  // Special powers
  40: 'Invisibilité', 41: 'Masque de peur', 42: 'Régénération de vie',
  43: 'Régénération de mana', 44: 'Plus d\'expérience', 45: 'Casque à corne',
  46: 'Totoche',
  // Carac all (50-55)
  50: 'Globe +1 - Force', 51: 'Globe +1 - Agilité', 52: 'Globe +1 - Vie',
  53: 'Globe +1 - Charisme', 54: 'Globe +1 - Magie', 55: 'Globe +1 - Sagesse',
  // Coloration (60-69)
  60: 'Coloration 1', 61: 'Coloration 2', 62: 'Coloration 3', 63: 'Coloration 4',
  64: 'Coloration 5', 65: 'Coloration 6', 66: 'Coloration 7', 67: 'Coloration 8',
  68: 'Coloration 9', 69: 'Coloration 10',
  // Potions (70-72)
  70: 'Petite potion', 71: 'Potion moyenne', 72: 'Grosse potion',
  // Bags (80-83)
  80: 'Sac +1', 81: 'Sac +2', 82: 'Sac +3', 83: 'Sac +4',
};
const PIXIZ_SPELL_NAMES = {
  1: 'Creuser', 2: 'Mineur', 3: 'Massif', 4: 'Mangeur d\'étoiles',
  5: 'Décompression', 6: 'Fossilisation', 7: 'Ascension', 8: 'Berserk',
  9: 'Tranche', 10: 'Silence', 11: 'Destruction', 12: 'Bouclier',
  13: 'Nova', 14: 'Bannissement', 15: 'Foudre', 16: 'Peinture',
  20: 'Boule de lumière', 21: 'Rayon de lumière', 22: 'Solero',
  23: 'Feu follet', 24: 'Glu', 25: 'Flamme', 26: 'Boule sacrée',
  27: 'Fantôme',
};
// Scrolls (id 100+spell.id) and Books (id 200+spell.id)
for (const [spellId, spellName] of Object.entries(PIXIZ_SPELL_NAMES)) {
  PIXIZ_ITEM_NAMES[100 + Number(spellId)] = `Parchemin de ${spellName}`;
  PIXIZ_ITEM_NAMES[200 + Number(spellId)] = `Livre de ${spellName}`;
}
// Build picto entries for each item that has a GIF on disk.
// GIF filename = item_${id+1}.gif under bmp/titems/GIF/item/.
for (const [idStr, itemName] of Object.entries(PIXIZ_ITEM_NAMES)) {
  const id = Number(idStr);
  const gifIdx = id + 1;
  const gif = `Games/miniTroll/bmp/titems/GIF/item/item_${gifIdx}.gif`;
  if (fs.existsSync(path.join(PROJECT_ROOT, gif))) {
    GAME_ITEM_INFO[`$pixiz_item${id}`] = { name: itemName, game: 'MiniPixiz', gif };
  }
}
// Foods — slot data tracks $stat.$eat[foodId] and food IDs are 300..354 (every 3).
// GIFs are indexed sequentially: food_1.gif → ID 300, food_2.gif → ID 301, ..., food_57.gif → ID 356.
const PIXIZ_FOOD_BASE_NAMES = [
  'Banane', 'Cerise', 'Champignon', 'Poire', 'Mure',
  'Carotte', 'Orange', 'Citron', 'Fraise', 'Tomate',
  'Pomme', 'Brioche', 'Œuf', 'Statue', 'Gouda',
  'Poireau', 'Pâtisserie', 'Raisin', 'Melon',
];
for (let i = 0; i < 57; i++) {
  const id = 300 + i;
  const baseName = PIXIZ_FOOD_BASE_NAMES[Math.floor(i / 3)] || `Aliment ${i}`;
  const variant = ['petit', 'moyen', 'grand'][i % 3] || '';
  const gif = `Games/miniTroll/bmp/titems/GIF/food/food_${i + 1}.gif`;
  if (fs.existsSync(path.join(PROJECT_ROOT, gif))) {
    GAME_ITEM_INFO[`$pixiz_food${id}`] = { name: `${baseName} (${variant})`.trim(), game: 'MiniPixiz', gif };
  }
}
// Diamonds (5 colors)
const PIXIZ_DIAM_NAMES = ['cuivre', 'argent', 'or', 'rubis', 'éclat'];
for (let i = 1; i <= 5; i++) {
  GAME_ITEM_INFO[`$pixiz_diam${i}`] = {
    name: `Diamant ${PIXIZ_DIAM_NAMES[i - 1]}`,
    game: 'MiniPixiz',
    gif: `Games/miniTroll/bmp/titems/GIF/diam/diam${i}.gif`,
  };
}

// Game-state milestone pictos (zone unlocks, kill counts, missions, levels, etc.)
const PIXIZ_MILESTONES = {
  '$pixiz_first':        { name: 'Première aventure',  gif: 'Games/miniTroll/bmp/titems/GIF/banana0.gif' },
  '$pixiz_forest':       { name: 'Forêt',              gif: 'Games/miniTroll/bmp/titems/GIF/item/item_2.gif' },
  '$pixiz_pond':         { name: 'Étang',              gif: 'Games/miniTroll/bmp/titems/GIF/item/item_42.gif' },
  '$pixiz_castle':       { name: 'Château',            gif: 'Games/miniTroll/bmp/titems/GIF/item/item_22.gif' },
  '$pixiz_rainbow':      { name: 'Arc-en-ciel',        gif: 'Games/miniTroll/bmp/titems/GIF/item/item_46.gif' },
  '$pixiz_tree':         { name: 'Arbre des fées',     gif: 'Games/miniTroll/bmp/titems/GIF/item/item_47.gif' },
  '$pixiz_dungeon':      { name: 'Donjon débloqué',    gif: 'Games/miniTroll/bmp/titems/GIF/item/item_32.gif' },
  '$pixiz_dungeon10':    { name: 'Donjon niveau 10',   gif: 'Games/miniTroll/bmp/titems/GIF/item/item_45.gif' },
  '$pixiz_dungeon20':    { name: 'Donjon niveau 20',   gif: 'Games/miniTroll/bmp/titems/GIF/item/item_44.gif' },
  '$pixiz_dungeon30':    { name: 'Donjon niveau 30',   gif: 'Games/miniTroll/bmp/titems/GIF/item/item_43.gif' },
  '$pixiz_dungeon50':    { name: 'Donjon niveau 50',   gif: 'Games/miniTroll/bmp/titems/GIF/item/item_41.gif' },
  '$pixiz_pond_quest':   { name: 'Quête de l\'étang',  gif: 'Games/miniTroll/bmp/titems/GIF/item/item_31.gif' },
  '$pixiz_run10':        { name: '10 parties',         gif: 'Games/miniTroll/bmp/titems/GIF/item/item_61.gif' },
  '$pixiz_run50':        { name: '50 parties',         gif: 'Games/miniTroll/bmp/titems/GIF/item/item_62.gif' },
  '$pixiz_run100':       { name: '100 parties',        gif: 'Games/miniTroll/bmp/titems/GIF/item/item_63.gif' },
  '$pixiz_run500':       { name: '500 parties',        gif: 'Games/miniTroll/bmp/titems/GIF/item/item_64.gif' },
  '$pixiz_star10':       { name: '10 étoiles',         gif: 'Games/miniTroll/bmp/titems/GIF/item/item_65.gif' },
  '$pixiz_star100':      { name: '100 étoiles',        gif: 'Games/miniTroll/bmp/titems/GIF/item/item_66.gif' },
  '$pixiz_star1000':     { name: '1000 étoiles',       gif: 'Games/miniTroll/bmp/titems/GIF/item/item_67.gif' },
  '$pixiz_key5':         { name: '5 clés',             gif: 'Games/miniTroll/bmp/titems/GIF/item/item_68.gif' },
  '$pixiz_key25':        { name: '25 clés',            gif: 'Games/miniTroll/bmp/titems/GIF/item/item_69.gif' },
  '$pixiz_faerie3':      { name: '3 fées',             gif: 'Games/miniTroll/bmp/titems/GIF/item/item_51.gif' },
  '$pixiz_faerie5':      { name: '5 fées',             gif: 'Games/miniTroll/bmp/titems/GIF/item/item_52.gif' },
  '$pixiz_faerie10':     { name: '10 fées',            gif: 'Games/miniTroll/bmp/titems/GIF/item/item_53.gif' },
  '$pixiz_faerie_lvl10': { name: 'Fée niveau 10',      gif: 'Games/miniTroll/bmp/titems/GIF/item/item_54.gif' },
  '$pixiz_faerie_lvl30': { name: 'Fée niveau 30',      gif: 'Games/miniTroll/bmp/titems/GIF/item/item_55.gif' },
  '$pixiz_faerie_lvl50': { name: 'Fée niveau 50',      gif: 'Games/miniTroll/bmp/titems/GIF/item/item_56.gif' },
  '$pixiz_treeMax20':    { name: 'Arbre - Score 20',   gif: 'Games/miniTroll/bmp/titems/GIF/item/item_3.gif' },
  '$pixiz_treeMax50':    { name: 'Arbre - Score 50',   gif: 'Games/miniTroll/bmp/titems/GIF/item/item_8.gif' },
  '$pixiz_treeMax100':   { name: 'Arbre - Score 100',  gif: 'Games/miniTroll/bmp/titems/GIF/item/item_13.gif' },
  '$pixiz_forestMax5':   { name: 'Forêt niveau 5',     gif: 'Games/miniTroll/bmp/titems/GIF/item/item_18.gif' },
  '$pixiz_forestMax10':  { name: 'Forêt niveau 10',    gif: 'Games/miniTroll/bmp/titems/GIF/item/item_23.gif' },
  '$pixiz_forestMax20':  { name: 'Forêt niveau 20',    gif: 'Games/miniTroll/bmp/titems/GIF/item/item_28.gif' },
  '$pixiz_mis10':        { name: '10 missions',        gif: 'Games/miniTroll/bmp/titems/GIF/item/item_6.gif' },
  '$pixiz_mis25':        { name: '25 missions',        gif: 'Games/miniTroll/bmp/titems/GIF/item/item_7.gif' },
  '$pixiz_mis50':        { name: '50 missions',        gif: 'Games/miniTroll/bmp/titems/GIF/item/item_11.gif' },
  '$pixiz_mis100':       { name: '100 missions',       gif: 'Games/miniTroll/bmp/titems/GIF/item/item_12.gif' },
  '$pixiz_kill100':      { name: '100 imps vaincus',   gif: 'Games/miniTroll/bmp/titems/GIF/item/item_16.gif' },
  '$pixiz_kill500':      { name: '500 imps vaincus',   gif: 'Games/miniTroll/bmp/titems/GIF/item/item_17.gif' },
  '$pixiz_bag2':         { name: 'Sac niveau 2',       gif: 'Games/miniTroll/bmp/titems/GIF/item/item_82.gif' },
  '$pixiz_bag3':         { name: 'Sac niveau 3',       gif: 'Games/miniTroll/bmp/titems/GIF/item/item_83.gif' },
  '$pixiz_bag_max':      { name: 'Sac maximal',        gif: 'Games/miniTroll/bmp/titems/GIF/item/item_84.gif' },
  '$pixiz_frog':         { name: 'Grenouille',         gif: 'Games/miniTroll/bmp/titems/GIF/item/item_21.gif' },
};
for (const [id, info] of Object.entries(PIXIZ_MILESTONES)) {
  GAME_ITEM_INFO[id] = { name: info.name, game: 'MiniPixiz', gif: info.gif };
}

// JamaJama (Poulpi) — milestone pictos awarded based on number of saved
// scores (= levels completed/abandoned). The game's source SWF has no
// native giveItem mechanism, so pictos are derived from server-side
// signals (saveScore, slot save) by counting plays.
const JAMA_MILESTONES = {
  '$jama_first':       { name: 'Premier coup de Tiki',    threshold: 1 },
  '$jama_play10':      { name: '10 niveaux joués',         threshold: 10 },
  '$jama_play25':      { name: '25 niveaux joués',         threshold: 25 },
  '$jama_play50':      { name: '50 niveaux joués',         threshold: 50 },
  '$jama_play100':     { name: '100 niveaux joués',        threshold: 100 },
  '$jama_play250':     { name: '250 niveaux joués',        threshold: 250 },
  '$jama_play500':     { name: '500 niveaux joués',        threshold: 500 },
  '$jama_play1000':    { name: '1000 niveaux joués',       threshold: 1000 },
};
for (const [id, info] of Object.entries(JAMA_MILESTONES)) {
  // Reuse the JamaJama disc icon as fallback gif (resolveGameItemGif also
  // tolerates missing files — the picto still appears in inventory by name).
  GAME_ITEM_INFO[id] = { name: info.name, game: 'JamaJama', gif: 'Games/poulpi/images/intro.jpg' };
}

// ── Lookup helpers (pure given GAME_ITEM_INFO) ──
function resolveGameItemGif(itemName) {
  const info = GAME_ITEM_INFO[itemName];
  if (info && info.gif) {
    const abs = path.join(PROJECT_ROOT, info.gif);
    try { if (fs.statSync(abs).isFile()) return abs; } catch {}
  }
  // Snake3: "Fruit N" → snakeFruitNNNN.gif
  const snakeMatch = /^Fruit (\d+)$/.exec(itemName);
  if (snakeMatch) {
    const pad = String(snakeMatch[1]).padStart(4, '0');
    const abs = path.join(PROJECT_ROOT, 'Games', 'snake3', 'gif', `snakeFruit${pad}.gif`);
    try { if (fs.statSync(abs).isFile()) return abs; } catch {}
  }
  return null;
}

function getGameItemDisplayName(itemName) {
  const info = GAME_ITEM_INFO[itemName];
  if (info) return info.name;
  const snakeMatch = /^Fruit (\d+)$/.exec(itemName);
  if (snakeMatch) return `Fruit ${snakeMatch[1]}`;
  return itemName.replace(/^\$/, '');
}

function getGameItemGame(itemName) {
  const info = GAME_ITEM_INFO[itemName];
  if (info) return info.game;
  if (/^Fruit \d+$/.test(itemName)) return 'Frutisnake';
  return '';
}

module.exports = {
  GAME_ITEM_INFO,
  PIXIZ_ITEM_NAMES,
  PIXIZ_SPELL_NAMES,
  PIXIZ_FOOD_BASE_NAMES,
  PIXIZ_DIAM_NAMES,
  PIXIZ_MILESTONES,
  JAMA_MILESTONES,
  resolveGameItemGif,
  getGameItemDisplayName,
  getGameItemGame,
};
