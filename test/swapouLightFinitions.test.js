'use strict';
/*
 * SWAPOU (light) — LE PACK, L'ACCUEIL, LE MENU ET LES COMBOS
 * ══════════════════════════════════════════════════════════
 *
 * Quatre défauts rapportés en jeu, quatre causes distinctes :
 *
 *   1. LE CADRAN DES ÉTOILES manquait. Le pack en promet deux — « le nombre
 *      de coups que tu as joués, et le nombre de fruits qui te séparent de la
 *      prochaine étoile de pouvoir » — et seul le premier était dessiné.
 *
 *   2. L'ÉCRAN D'ACCUEIL semblait figé. `Menu.as` attend un clic (`waitClick()`
 *      en phase 0) et montre le LOGO pour le dire ; le portage l'allumait puis
 *      l'éteignait à l'image suivante — le compte à rebours d'extinction et
 *      l'extinction elle-même étaient deux tests séparés, et le second ne
 *      demandait pas si une extinction était seulement en cours. On voyait donc
 *      les deux personnages et rien d'autre, sans savoir qu'il fallait cliquer.
 *
 *   3. LES BOUTONS CLIGNOTAIENT au survol. Le calcul était juste : c'est le
 *      décalage de couleur qui travaillait sur un calque de la taille du
 *      CANEVAS — trois passes sur plus d'un million de pixels, par bouton et
 *      par image. Mesuré : 28 images sur 85 au-delà de 25 ms sous la souris,
 *      zéro ailleurs. La pulsation avançait par à-coups.
 *
 *   4. L'ÉTOILE DE COMBO était incomplète. Le sprite #81 du SWF a vingt et une
 *      images (étiquette « flash » à la 7e) : un jaillissement de 0,277 à 1,2
 *      puis retour à 1, avec une interpolation vers le BLANC jusqu'à 52 %. Et
 *      sur un super combo, son sous-clip `flying` (#74) fait tourner TROIS
 *      étoiles derrière elle. Le portage posait l'image et marquait le flash
 *      d'un coup d'échelle ; la ronde, calculée, n'était jamais dessinée.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const JEU = fs.readFileSync(path.join(ROOT, 'public/swapou/game.js'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'public/swapou/ui.js'), 'utf8');
const ECRANS = fs.readFileSync(path.join(ROOT, 'public/swapou/screens.js'), 'utf8');

test('le pack montre SES DEUX cadrans : les coups et l’étoile', () => {
  // Le second parchemin (coups) et le troisième (étoile) sont recopiés du
  // panneau lui-même, à 82 puis 164 px : mêmes pixels, même veinage.
  assert.match(JEU, /const COUPS_DY = 82;/);
  assert.match(JEU, /const ETOILE_DY = 164;/);
  assert.match(JEU, /if \(this\.etoilesEnabled\(\)\)\s*\n\s*ctx\.drawImage\(lp, 0, 0, COUPS_LARGEUR, COUPS_BANDE_H,\s*\n\s*0, ETOILE_DY, COUPS_LARGEUR, COUPS_BANDE_H\);/);
  // La valeur ne se calcule pas : `Challenge.star_counter` DÉCOMPTE déjà les
  // fruits qui restent avant la prochaine étoile (cf. genFruitFlags).
  assert.match(JEU, /const e = \(this\.game && this\.game\.star_counter\) \|\| 0;/);
  assert.match(JEU, /U\.text\(ctx, 'ÉTOILE', 88, 22 \+ ETOILE_DY,/);
  assert.match(JEU, /--this\.star_counter === 0/, 'le compteur d’époque, inchangé');
  // Le mode Classique n'a ni pouvoir ni étoile : le cadran s'y efface.
  assert.match(JEU, /etoilesEnabled = function \(\) \{\s*\n\s*return this\.movesEnabled\(\) && !\(this\.classicModeOn \|\| this\.classic\);/);
  // Et les deux cadrans restent derrière la même option de boutique.
  assert.match(JEU, /features\.swapouMoves/);
});

test('l’accueil montre son logo — et le garde jusqu’au clic', () => {
  // L'extinction ne s'exécute plus QUE pendant une extinction : sans cette
  // imbrication, `logoHide` valant zéro éteignait le logo à l'image suivant
  // celle qui l'avait allumé.
  assert.match(ECRANS, /if \(this\.logoHide > 0\) \{\s*\n\s*this\.logoHide -= tmod;\s*\n\s*if \(this\.logoHide <= 0\) \{ this\.logoHide = 0; this\.logoVisible = false; \}\s*\n\s*\}/);
  // La phase 0 l'allume, le clic l'éteint : la mécanique de Menu.as tient.
  assert.match(ECRANS, /case 0:\s*\n\s*this\.logoVisible = true;\s*\n\s*this\.waitClick\(\);/);
  assert.match(ECRANS, /if \(this\.clicked\) \{\s*\n\s*this\.logoHide = 12;/);
  assert.ok(fs.existsSync(path.join(ROOT, 'Games/swapou2/images/logo.png')), 'le dessin du logo');
  assert.match(fs.readFileSync(path.join(ROOT, 'public/swapou/assets.js'), 'utf8'),
    /logo: 'images\/logo\.png'/);
});

test('le décalage de couleur ne repeint plus tout l’écran', () => {
  // La boîte du dessin, dans le repère du canevas : quatre coins passés par la
  // matrice courante, et le calque ne fait que ça.
  assert.match(UI, /function peindreSurCalque\(ctx, x, y, w, h, dessiner, finir\) \{/);
  assert.match(UI, /for \(const \[px, py\] of \[\[bx, by\], \[bx \+ bw, by\], \[bx, by \+ bh\], \[bx \+ bw, by \+ bh\]\]\) \{/);
  assert.match(UI, /calqueCtx\.setTransform\(m\.a, m\.b, m\.c, m\.d, m\.e - x0, m\.f - y0\);/);
  assert.match(UI, /ctx\.drawImage\(calque, 0, 0, lw, lh, x0, y0, lw, lh\);/);
  // Le calque est gardé d'un appel à l'autre et ne fait que GRANDIR : le
  // réallouer à chaque image coûterait ce qu'on vient d'économiser.
  assert.match(UI, /if \(calque\.width < lw \|\| calque\.height < lh\) \{/);
  // Hors écran, on ne peint rien plutôt que de composer dans le vide.
  assert.match(UI, /if \(lw <= 0 \|\| lh <= 0\) return;/);
  // La pulsation elle-même n'a pas bougé : treize images relevées sur le
  // sprite #206, une boucle tant que la souris reste — c'est le SWF.
  assert.match(UI, /const BT_ECHELLE = \[1, 1\.02, 1\.1175, 1\.15,/);
  assert.match(UI, /if \(this\.frame >= n\) this\.frame = 1;/);
});

test('l’étoile de combo jaillit, blanchit, et fait tourner sa ronde', () => {
  // Les onze premières images du sprite #81, relevées telles quelles.
  assert.match(JEU, /const CS_ECHELLE = \[0\.277, 0\.558, 0\.789, 0\.969, 1\.097, 1\.174, 1\.2, 1\.178, 1\.111, 1, 1\];/);
  assert.match(JEU, /const CS_BLANC = \[0, 0\.160, 0\.289, 0\.391, 0\.461, 0\.504, 0\.520, 0\.461, 0\.289, 0, 0\];/);
  assert.match(JEU, /const CS_FLASH = 7;/, 'l’étiquette « flash » du sprite');
  // Chaque explosion de la chaîne rejoue le sommet — c'est le coup de poing.
  const flashs = (JEU.match(/\.anim = CS_FLASH;/g) || []).length;
  assert.strictEqual(flashs, 3, 'explode, comboScore et finalComboScore rejouent le flash');
  assert.match(JEU, /if \(cs\.anim < CS_ECHELLE\.length\) cs\.anim = Math\.min\(CS_ECHELLE\.length, cs\.anim \+ tmod\);/);
  // L'éclat : une interpolation vers le blanc, pas une addition — la paire
  // (multiplicateur, terme additif) du SWF fait toujours 256.
  assert.match(UI, /function avecEclat\(ctx, t, x, y, w, h, dessiner\) \{/);
  assert.match(UI, /c\.globalCompositeOperation = 'source-atop';/);
  assert.match(JEU, /U\.avecEclat\(ctx, a\.blanc, -70, -75, 140, 150, function \(c\) \{/);
  // Les deux échelles se multiplient, comme les deux clips du SWF.
  assert.match(JEU, /const sx = \(cs\.scaleX \|\| cs\.scale\) \/ 100 \* a\.s;/);
  // LA RONDE : trois `powerStar` à 120°, cercle de 56,5, un tiers de tour en
  // quinze images. Elle passe DERRIÈRE l'étoile (profondeur 1 contre 7).
  assert.match(JEU, /const CS_ORBITE = 56\.5, CS_VITESSE = 8;/);
  assert.match(JEU, /for \(let i = 0; i < 3; i\+\+\) \{\s*\n\s*const ang = \(-CS_VITESSE \* cs\.tourne \+ 60 \+ i \* 120\) \* Math\.PI \/ 180;/);
  assert.match(JEU, /c\.drawImage\(ps, CS_ORBITE \* Math\.cos\(ang\) - 18,\s*\n\s*CS_ORBITE \* Math\.sin\(ang\) - 18\.5, 36, 37\);/);
  const bloc = JEU.slice(JEU.indexOf('if (cs.flying) {'), JEU.indexOf('U.drawCentered(c, A.img(\'comboStar\')'));
  assert.ok(bloc.indexOf('drawImage(ps') > 0, 'la ronde se peint avant la grande étoile');
  // …et seulement sur un super combo, comme `sub.flying._visible` d'époque.
  assert.match(JEU, /cs\.flying = score >= D\.MIN_SUPER_COMBO;/);
  // Le dessin de la ronde est celui des étoiles de pouvoir (36 × 37, ancre
  // −18/−18,5) : la forme #72 du SWF est ce bitmap-là.
  assert.match(fs.readFileSync(path.join(ROOT, 'public/swapou/assets.js'), 'utf8'),
    /powerStar: 'images\/powerStar\.png'/);
});
