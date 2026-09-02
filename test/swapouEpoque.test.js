'use strict';
/*
 * SWAPOU — CE QUE LE FICHIER DIT, ET QUE LE PORTAGE INVENTAIT
 * ══════════════════════════════════════════════════════════
 *
 * Trois écrans étaient de notre main plutôt que de celle de 2005, et un
 * quatrième point manquait tout court. Tout ce qui suit est relevé sur
 * `Games/swapou2/swapou.swf` — les chiffres du fichier, pas des à-peu-près.
 *
 *   1. L'ÉCRAN DE CHARGEMENT. Le SWF a quatre images à sa racine et les deux
 *      premières SONT le préchargeur : le clip `bg` en fond (le motif à
 *      écailles, répété en largeur) et un texte statique « chargement... ».
 *      Le portage montrait un titre, une barre verte et un compteur de
 *      fichiers — rien de tout cela n'a existé.
 *
 *   2. L'ANNONCE DE COMBO. Le clip `comboName` pose TROIS choses : un encart
 *      (368 × 100, le même dessin que la boîte du versus), le nom du cocktail
 *      en « PT Banana Split » blanc, et la vignette. Le portage ne posait que
 *      la vignette — d'où « il manque quelque chose ».
 *
 *   3. LE SÉLECTEUR DE PAIRE. `fruitRollOver` est un anneau à bouts ronds,
 *      masqué par sept bandes en biais qui défilent, rouge quand l'échange
 *      est interdit. Le portage dessinait un cadre jaune, un trait au milieu
 *      et une croix rouge : trois inventions.
 *
 *   4. LE BOUTON DE L'IA. Le panneau d'analyse disait le meilleur coup ; il
 *      le joue maintenant.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const lire = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const PAGE = lire('public/swapou/index.html');
const JEU = lire('public/swapou/game.js');
const UI = lire('public/swapou/ui.js');
const ASSETS = lire('public/swapou/assets.js');

test('l’écran de chargement est celui du fichier : le motif et « chargement... »', () => {
  // Le texte : treize glyphes de la fonte 23 (« PT Banana Split »), blancs,
  // hauteur 30, ligne de base en (6,25 ; 465,9) — le caractère #24 est posé en
  // (19,1 ; 440,9), sa matrice le décale de −12,85 et son style porte dy = 25.
  assert.match(PAGE, /ctx\.font = '30px "PT Banana Split", Verdana, sans-serif';/);
  assert.match(PAGE, /ctx\.fillText\('chargement\.\.\.', 6\.25, 465\.9\);/);
  assert.match(PAGE, /ctx\.fillStyle = '#FFFFFF';/);
  // Le fond : bitmap #18 (105 × 480 = images/bg.jpg) en remplissage RÉPÉTÉ
  // sur 700 × 480, et le vert de scène du SetBackgroundColor derrière.
  assert.match(PAGE, /for \(var x = 0; x < 700; x \+= fond\.naturalWidth\)/);
  assert.match(PAGE, /fond\.src = '\/games\/swapou2\/images\/bg\.jpg';/);
  assert.match(PAGE, /ctx\.fillStyle = '#ADE76B';/);
  assert.match(PAGE, /background: #ADE76B;/, 'la page aussi, autour du canevas');
  // Et plus rien de ce qui était inventé.
  assert.ok(!/id="loadbar"/.test(PAGE), 'plus de barre de progression');
  assert.ok(!/SWAPOU 2<\/div>/.test(PAGE), 'plus de titre inventé');
  assert.ok(!/chargement… ' \+ n \+ '\//.test(PAGE), 'plus de compteur de fichiers');
  // Il se peint sur le canevas du JEU : il suit donc l'échelle et la rotation.
  assert.match(PAGE, /var k = SW\.canvasScale;\s*\n\s*ctx\.setTransform\(k, 0, 0, k, 0, 0\);/);
  assert.match(PAGE, /if \(attente\) attente\(\);/, 'et se repeint au redimensionnement');
});

test('l’annonce de combo retrouve son encart, son nom et sa chute', () => {
  // L'ENCART : la forme #83 du clip, posée en (−27,65 ; 1) sur une origine de
  // (−152 ; −51) — soit le rectangle (−179,65 ; −50) de 368 × 100. Le dessin
  // est celui de la boîte du versus, déjà chargé.
  assert.match(JEU, /const CN_ENCART = \{ x: -179\.65, y: -50, w: 368, h: 100 \};/);
  assert.match(JEU, /const boite = A\.img\('versusBox'\);/);
  // LES NOMS, en blanc et sur la ligne de base — les onze du Challenge et les
  // neuf du Classique, avec leur hauteur propre (la « recette crêmeuse » est
  // écrite en 45, le « suprême crême-orange » en 38, faute de place).
  assert.match(JEU, /\['combo3', -135\.35, -53\.4, \['recette ', -38\.3, -9\.25, 45\], \['crêmeuse', -38\.3, 21\.75, 45\]\],/);
  assert.match(JEU, /\['combo4', -154\.65, -53, \['suprême', -57\.6, -13\.35, 38\],/);
  assert.match(JEU, /\['combo10', -136\.35, -52, \['cocktail', -39\.3, -12\.65, 40\], \['swapolotof', -39\.3, 23\.35, 40\]\],/);
  assert.match(JEU, /baseline: 'alphabetic', font: 'banana'/);
  const chal = JEU.slice(JEU.indexOf('const CN_CHALLENGE'), JEU.indexOf('const CN_CLASSIC'));
  assert.strictEqual((chal.match(/\['combo\d+/g) || []).length, 11, 'onze paliers en Challenge');
  const clas = JEU.slice(JEU.indexOf('const CN_CLASSIC'), JEU.indexOf('const CN_IMAGES'));
  assert.strictEqual((clas.match(/\['comboClassic'/g) || []).length, 9, 'neuf paliers en Classique');
  // LA CHUTE : les dix-neuf images du clip, et le retrait à la vingtième —
  // après le MAINTIEN d'une seconde et demie que les scripts des images 12 et
  // 14 imposent (cf. swapouFidelite.test.js).
  assert.match(JEU, /const CN_IMAGES = \[\s*\n\s*\[-166\.75, 1\], \[-122\.5, 1\], \[-85\.05, 1\], \[-54\.45, 1\], \[-30\.65, 1\], \[-13\.6, 1\],/);
  assert.match(JEU, /if \(cn\.frame >= CN_IMAGES\.length \+ 1\) this\.comboName = null;/);
  assert.ok(!/timer: 90/.test(JEU), 'plus de minuterie inventée de 90 images');
  // L'ORDRE DES VIGNETTES, relevé sur les masques alpha du SWF : la quatrième
  // est la crème, la sixième les kiwis. Trois rangs étaient permutés.
  assert.match(ASSETS, /const COMBO_IMGS = \['confiture', 'confitureOrange', 'tarte', 'tarteCreme',\s*\n\s*'tarteCremeOrange', 'tarteKiwis', 'tarteOranges', 'eclair', 'eclairExtra',/);
});

test('le sélecteur de paire est l’anneau du fichier, avec ses bandes qui défilent', () => {
  // L'ANNEAU (forme #48) : un rectangle à bouts ronds ÉVIDÉ — deux contours,
  // règle « pair-impair » —, posé en (31,95 ; 17,25) dans le clip.
  assert.match(UI, /const ANNEAU = cheminSwf\('M35\.15 0Q35\.15 -6\.65 30\.5 -11\.3/);
  assert.match(UI, /const RO_ANNEAU = \{ x: 31\.95, y: 17\.25 \};/);
  assert.match(UI, /ctx\.fill\('evenodd'\);/);
  // Blanc si l'échange est possible, ROUGE sinon (sub.gotoAndStop(1) / (2)).
  assert.match(UI, /ctx\.fillStyle = this\.blocked \? '#ff0000' : '#ffffff';/);
  // LES BANDES (forme #46) : sept parallélogrammes à 45°, en masque de
  // découpe, qui glissent de 22 px en neuf pas et se répètent tous les 21,8.
  assert.match(UI, /const BANDES = cheminSwf\('M20\.25 -20\.2L-20\.15 20\.2/);
  assert.match(UI, /const RO_MASQUE = \{ x0: 24\.15, y: 17\.7, course: 22, periode: 21\.8, images: 9 \};/);
  assert.match(UI, /ctx\.clip\('evenodd'\);/);
  assert.match(UI, /% RO_MASQUE\.periode;/);
  // LE COMPTEUR de blocage (`v`), avec son crâne — et le crâne est chargé.
  assert.match(UI, /const RO_V = \{ x: 34\.85, y: 8\.5 \};/);
  assert.match(UI, /const cr = A\.img\('cursed'\);/);
  assert.match(ASSETS, /cursed: 'images\/cursed\.png'/);
  assert.ok(fs.existsSync(path.join(ROOT, 'Games/swapou2/images/cursed.png')));
  // Et plus rien des trois inventions : le jaune, le trait du milieu, la croix.
  assert.ok(!/#ffd23f';\s*\n\s*ctx\.shadowColor/.test(UI), 'plus de cadre jaune');
  const ro = UI.slice(UI.indexOf('Rollover.prototype.draw'), UI.indexOf('return {\n    D: D'));
  assert.ok(!/moveTo\(8, 8\)/.test(ro), 'plus de croix rouge');
});

test('le panneau de l’IA joue le coup qu’il conseille', () => {
  assert.match(JEU, /const IA_BOUTON = \{ x: 13, y: 286, w: 80, h: 22 \};/);
  // Il ne répond que dans les conditions où le joueur pourrait jouer lui-même.
  assert.match(JEU, /if \(!m \|\| this\.game\.lock \|\| this\.game\.pause\.activated\(\)\) return null;/);
  // Et il passe par le MÊME chemin que la souris : mêmes compteurs, même
  // verrou, même oubli du conseil.
  assert.match(JEU, /Challenge\.prototype\.jouerPaire = function \(fpair\) \{/);
  assert.match(JEU, /if \(this\.analyse && this\.analyse\.clic\(SW\.mouse\.x, SW\.mouse\.y\)\) return;/);
  assert.match(JEU, /this\.jouerPaire\(SW\.pickPair\(this\.player\)\);/);
  assert.match(JEU, /if \(m\.type === 'defend'\) \{ this\.game\.defend\(\); return true; \}/);
  // La paire de l'analyseur est en CASES ; le jeu la veut avec ses fruits.
  assert.match(JEU, /f1: lvl\.fruits\[p\.x\] \? lvl\.fruits\[p\.x\]\[p\.y\] : null,/);
  // Le panneau a grandi juste ce qu'il faut : il finit à 316, le visage
  // commence à 357.
  assert.match(JEU, /const IA_PANNEAU = \{ x: 6, y: 176, w: 94, h: 140 \};/);
  assert.match(JEU, /this\.dessinerBouton\(ctx\);/);
});
