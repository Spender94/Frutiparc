'use strict';
/*
 * DICTIONNAIRE ANGLAIS DU SERVEUR — LA BOUTIQUE : les refus d'achat et de
 * revente du light, les rayons, les accessoires de base, la fiche commune des
 * accessoires, et les articles livrés avec le code (nom, description,
 * commentaire), par leur NUMÉRO d'article — `boutique.<id>.nom`,
 * `.description`, `.commentaire`. Le français reste dans server.js
 * (SHOP_PACKS_DEFAULT et ses familles) ; un article saisi dans l'admin porte
 * son anglais en base (`name_en`, `description_en`, `comment_en`), qui passe
 * avant ce dictionnaire. Sans anglais nulle part, l'article reste en français
 * (voir texteArticle).
 *
 * Le nom français d'un article reste son IDENTIFIANT (inventaire, forum,
 * historique des achats) : on ne traduit que ce qu'on affiche. Les noms
 * propres (Makulo, Egerie, Utopiz, Mini-Pixiz…) restent tels quels.
 */
const path = require('path');

const d = {
  // ── Les refus du light ──
  'boutique.pasAssez': 'Not enough kikooz.',
  'boutique.dejaPossede': 'You already own this accessory.',
  'boutique.indisponible': 'Item unavailable.',
  'boutique.nonRevendable': 'This item can\'t be sold back.',
  'boutique.fermee': 'Shop unavailable.',
  'boutique.reventeImpossible': 'Sale impossible.',

  // ── Les rayons (le nom français sans accents ni espaces) ──
  'boutique.rayon.accessoires': 'Accessories',
  'boutique.rayon.accessoiresmaison': 'Player-made accessories',
  'boutique.rayon.fondsdecran': 'Wallpapers',
  'boutique.rayon.pass': 'Passes',
  'boutique.rayon.feutres': 'Pens',
  'boutique.rayon.packs': 'Packs',
  'boutique.rayon.decors': 'Themes',
  'boutique.rayon.incarnations': 'Incarnations',

  // ── Les accessoires de base (DEFAULT_ACCESSORIES, par leur identifiant) ──
  'boutique.base.beaute': 'Beauty',
  'boutique.base.chauve': 'Bald',

  // ── La fiche commune des accessoires (les deux niveaux) ──
  'boutique.accessoire.l1': 'Yesterday I looked at my bouille and found it funny; today, with my accessory, yippee-kiwi, it\'s just awesome!',
  'boutique.accessoire.l2': 'If you want a fabu-bouille too, it\'s easy: pick an accessory and put it on your bouille! An adventurer one day, a city slicker the next, you can change your look whenever you like. And so that you keep your personal touch, all accessories come in limited quantities',

  // ── Les accessoires ──
  'boutique.101.nom': 'Nightcap',
  'boutique.101.description': 'A cosy cap for Frutiz who love to daydream in the chat. Perfect for a snug vibe!',
  'boutique.101.commentaire': 'A cosy cap for Frutiz who love to daydream in the chat. Perfect for a snug vibe!',
  'boutique.102.nom': 'Sheriff hat',
  'boutique.102.description': 'To bring law and order to the lands of Legumia. A timeless classic of every lawman\'s outfit.',
  'boutique.102.commentaire': 'To bring law and order to the lands of Legumia. A timeless classic of every lawman\'s outfit.',
  'boutique.103.nom': 'Ski mask',
  'boutique.103.description': 'Ready to hit the slopes! This colourful mask will finish off your winter outfit beautifully.',
  'boutique.103.commentaire': 'Ready to hit the slopes! This colourful mask will finish off your winter outfit beautifully.',
  'boutique.88888.description': 'The tzongre head from the Trials.',
  'boutique.88888.commentaire': 'Earned by beating the HARD challenge of the Kaluga Trials.',
  'boutique.630100.nom': '100-day gift',
  'boutique.630100.description': 'A gift for Frutiz who log in 100 days in a row.',
  'boutique.630100.commentaire': 'Earned by logging in 100 days running.',

  // ── Egerie, une bouille entière ──
  'boutique.620014.commentaire': 'Egerie\'s frutibouille, just as she is.',
  'boutique.620014.description': 'Her eyes, her mouth, her make-up and her emotes. '
    + 'Put her on, take her off — your bouille waits underneath, untouched.',

  // ── Les fonds d'écran ──
  'boutique.201.nom': 'Mustard knight',
  'boutique.201.description': 'A knightly wallpaper in mustard tones.',
  'boutique.202.nom': 'Frutiparc choir',
  'boutique.202.description': 'The great Frutiparc choir!',
  'boutique.203.nom': 'Pixiz Christmas',
  'boutique.203.description': 'Christmas cheer with the Pixiz.',
  'boutique.204.nom': 'Frutisnake Christmas',
  'boutique.204.description': 'Frutisnake in holiday mode.',
  'boutique.205.description': 'The little Pixiz in action.',
  'boutique.206.description': 'The Nostromo ship from Mini-Wave.',
  'boutique.207.description': 'The planet Mini-Star from Mini-Wave.',
  'boutique.208.description': 'The colourful world of Utopiz.',

  // ── Les pass quotidiens ──
  'boutique.21.nom': 'Frutisnake daily pass',
  'boutique.21.description': 'Play a snake endlessly and eat as many fruits as you can.',
  'boutique.21.commentaire': 'Gives you one extra daily game that counts for the daily ranking. Permanent and stackable!',
  'boutique.22.nom': 'Burning Kiwi daily pass',
  'boutique.22.description': 'Become king of the track by firing up supercharged turbos.',
  'boutique.22.commentaire': 'Gives you one extra daily race to set the best time on the track of the day. Permanent and stackable!',
  'boutique.23.nom': 'Swapou 2 daily pass',
  'boutique.23.description': 'Play Dimitri or Natacha and fill your basket with fruit.',
  'boutique.23.commentaire': 'Gives you one extra daily game in Challenge mode. Permanent and stackable!',
  'boutique.20.nom': 'Motion Ball 2 daily pass',
  'boutique.20.description': 'Play the famous balls and defeat the terrible octopus!',
  'boutique.20.commentaire': 'Gives you one extra daily game to set the best Challenge score. Permanent and stackable!',
  'boutique.26.nom': 'Kaluga daily pass',
  'boutique.26.description': 'Play the famous Tzongre and his friends and collect as many apples as you can.',
  'boutique.26.commentaire': 'Gives you one extra daily game to set the best Challenge score. Permanent and stackable!',

  // ── Le feutre multicolore ──
  'boutique.30.nom': 'Rainbow pen',
  'boutique.30.description': 'Write in colour! This one-of-a-kind pen shows your text as a rainbow in the chat rooms.',
  'boutique.30.commentaire': 'A unique pen: every letter of your messages changes colour. Permanent purchase.',

  // ── Les options de jeu (rayon Packs) et le mode nuit (rayon Décors) ──
  'boutique.40.nom': 'Frutisnake pack',
  'boutique.40.description': 'The Frutisnake dashboard: your snake\'s length, the number of dynamites swallowed and the time left on your bonus, shown in game next to the board.',
  'boutique.40.commentaire': 'Three live readouts during the game: length, dynamites, time left on the current bonus. Switches on by itself as soon as you buy it. Permanent!',
  'boutique.41.nom': 'Swapou pack',
  'boutique.41.description': 'Two more dials on the Swapou panel, engraved like the game\'s own: the number of moves you\'ve played, and the number of fruits between you and the next power star.',
  'boutique.41.commentaire': 'Two live counters during a Challenge game: moves played and fruits before the next star. Switches on by itself as soon as you buy it. Permanent!',
  'boutique.42.nom': 'Its time will come',
  'boutique.42.description': 'The park goes dark: washed-out colours, wilted fruit, slate scenery, a big grey cloudy sky and a pallid moon. Your bouille keeps its colours — the world turned grey, not you.',
  'boutique.42.commentaire': 'Turn it on and off whenever you like, from Settings, on the device of your choice: night on the phone, day on the computer. The chat rooms, the desktop and the forum go dark together. Permanent purchase!',
};

// ── Les dix-sept feutres d'époque (SHOP_FEUTRES_DEFAULT, même ordre) ──
const FEUTRES = [
  [315, 'Orange', 'orange'], [316, 'Blue', 'blue'], [317, 'Dark green', 'dark green'],
  [318, 'Burgundy', 'burgundy'], [319, 'Pink', 'pink'], [320, 'Yellow', 'yellow'],
  [321, 'Light green', 'light green'], [322, 'Cyan', 'cyan'], [323, 'Dark blue', 'dark blue'],
  [324, 'Brown', 'brown'], [325, 'Dark brown', 'dark brown'], [326, 'Khaki green', 'khaki green'],
  [327, 'Petrol blue', 'petrol blue'], [599, 'Green', 'green'], [600, 'Dark petrol blue', 'dark petrol blue'],
  [601, 'Dark orange', 'dark orange'], [602, 'Purple', 'purple'],
];
for (const [id, nom, couleur] of FEUTRES) {
  d[`boutique.${id}.nom`] = `${nom} pen`;
  d[`boutique.${id}.description`] = 'Personalise your writing with this magnificent pen that will make you stand out in the chat rooms';
  d[`boutique.${id}.commentaire`] = `ISO ${couleur} colour`;
}

/*
 * LES PRUNELLES ET LE MAQUILLAGE D'EGERIE : leurs articles s'écrivent tout
 * seuls depuis la récolte (INCARNATIONS_DEFAULT, MAQUILLAGES_DEFAULT), leur
 * anglais aussi — on lit les MÊMES paquets que le serveur, et l'on ne traduit
 * que les mots qui changent (la teinte).
 */
const TEINTES = {
  brun: 'brown', 'bleu ciel': 'sky blue', cyan: 'cyan', vert: 'green', violet: 'purple', orange: 'orange',
  lavande: 'lavender', 'cerise et azur': 'cherry and azure', 'rose et or': 'pink and gold', mauve: 'mauve',
  'grenat et turquoise': 'garnet and turquoise', 'abricot et tilleul': 'apricot and lime',
};
const teinte = (fr) => TEINTES[fr] || fr;
const DESSOUS = 'Put them on, take them off — your bouille waits underneath, untouched.';
try {
  const iris = require(path.join(__dirname, '..', '..', 'public', 'fbouille', 'prunelles.json')).iris || [];
  for (const i of iris) {
    if (!i || !i.cle || !(Number(i.index) >= 0)) continue;
    const id = 600000 + Number(i.index) - 17;
    const anime = /hiko2/.test(i.cle);
    d[`boutique.${id}.nom`] = String(i.nom || i.cle).replace(/ — (.+)$/, (m, t) => ' — ' + teinte(t));
    d[`boutique.${id}.commentaire`] = i.teinte ? `Hiko's gaze, in ${teinte(i.teinte)}.`
      : (anime ? 'Hiko\'s gaze, the one that spins.' : 'Hiko\'s gaze, red and black.');
    const base = anime
      ? `Hiko's animated eyes${i.teinte ? ', in ' + teinte(i.teinte) : ''} — they spin.`
      : `Hiko's ${i.teinte ? teinte(i.teinte) : 'red and black'} eyes.`;
    d[`boutique.${id}.description`] = (i.description ? base + ' ' : '') + DESSOUS;
  }
} catch (e) { /* pas de récolte : rien à traduire */ }
try {
  const maq = require(path.join(__dirname, '..', '..', 'public', 'fbouille', 'maquillage-egerie.json'));
  (maq.teintes || []).forEach((t, i) => {
    if (!t || !t.cle) return;
    const nom = teinte(String(t.nom || t.cle));
    d[`boutique.${610000 + i}.nom`] = `Egerie's make-up — ${nom}`;
    d[`boutique.${610000 + i}.commentaire`] = i === 0 ? 'Egerie\'s eyeshadow, lashes and lips.' : `Egerie's make-up, in ${nom}.`;
    d[`boutique.${610000 + i}.description`] = 'It follows your talking mouth and your closing eyes, and leaves your accessory in place. '
      + 'Put it on, take it off — your bouille waits underneath, untouched.';
  });
} catch (e) { /* pas de maquillage : rien à traduire */ }

module.exports = d;
