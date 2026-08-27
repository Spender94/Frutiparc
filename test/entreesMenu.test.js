'use strict';
/*
 * LES ENTRÉES D'UN MENU ARRIVENT EN GLISSANT
 *
 * Une entrée d'arbre — un classement dans la fenêtre des scores, une rubrique
 * ou un article dans la boutique — ne PARAÎT pas à sa place : elle y arrive.
 * `cp.Tree.addPhysElement` (0x7b6xx) :
 *
 *     content.attachMovie(link, "caps" + n, 80000 - n, …);
 *     caps.pos.x = x + marginLeft;  caps._x = caps.pos.x;
 *     caps._y = last._y + last.height / 2;        ← elle NAÎT au milieu de la
 *     if (last !== undefined) {                      précédente
 *       caps.moveTo(last.pos.y + last.height);    ← puis GLISSE à sa place
 *       caps.fadeIn();                            ← en se colorant
 *       caps.id = last.id + 1;
 *     } else {
 *       caps.moveTo(0, true);                     ← la première se pose net
 *       caps.id = 0;
 *     }
 *
 * `Capsule.moveTo(y, flDirect)` (0x9f0aa) pose `pos.y` puis, sans `flDirect`,
 * confie le trajet à `tree.animList.addSlide(…, 2)` — le même amortissement
 * que les fenêtres, au ratio près. `Capsule.fadeIn` (0x9f147) peint la
 * capsule de la couleur du panneau (`FEMC.setPColor(this, c, 0)`) et laisse
 * `addPaint` la ramener à 100.
 *
 * LA LISTE EST BÂTIE D'UN COUP : `last._y` n'a pas encore bougé quand la
 * suivante naît, si bien que les décalages se cumulent de moitié en moitié —
 * chaque entrée démarre à LA MOITIÉ de son décalage final, et la colonne se
 * déplie depuis le haut.
 *
 * Mesuré au banc, sur la colonne des scores (dix-sept entrées, la dernière à
 * 270 px de la première) : elle naît à −135 px et à opacité 0, ses deux
 * transitions durent 260 ms en `cubic-bezier(.33, 1, .68, 1)`, la PREMIÈRE
 * entrée n'en a aucune, et tout retombe à sa place.
 *
 * LE PIÈGE, tombé une fois : sans `transition: none` sur l'état de départ,
 * poser la classe n'y fait pas SAUTER l'entrée — elle l'y emmène en 260 ms, et
 * la retirer deux battements plus tard la ramène aussitôt. On ne voyait qu'un
 * frémissement de deux images.
 *
 * LE MOBILE NE BOUGE PAS : `animerEntrees` vit dans bureau-frutiz.js, et le
 * light ne l'appelle que si le bureau est là.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const JS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.css'), 'utf8');
const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');

test('chaque entrée démarre à la MOITIÉ de son décalage final', () => {
  const bloc = JS.slice(JS.indexOf('function animerEntrees'), JS.indexOf('function posDe(fen)'));
  assert.match(bloc, /var haut = l\[0\]\.getBoundingClientRect\(\)\.top;/);
  assert.match(bloc, /var dy = l\[i\]\.getBoundingClientRect\(\)\.top - haut;/);
  assert.match(bloc, /l\[i\]\.style\.setProperty\('--cy', \(-dy \/ 2\) \+ 'px'\);/);
  // La PREMIÈRE ne bouge pas : `moveTo(0, true)`, et pas de `fadeIn`.
  assert.match(bloc, /for \(var i = 1; i < l\.length; i\+\+\)/);
  assert.match(bloc, /if \(dy <= 0\) continue;/);
});

test('deux battements : peindre le départ, puis lâcher la transition', () => {
  const bloc = JS.slice(JS.indexOf('function animerEntrees'), JS.indexOf('function posDe(fen)'));
  assert.match(bloc, /requestAnimationFrame\(function \(\) \{\s*\n\s*requestAnimationFrame\(function \(\) \{/);
  // La collection d'enfants est vivante : on en prend une copie.
  assert.match(bloc, /var l = \[\]\.slice\.call\(hote\.children\);/);
  // Et la préférence d'époque commande : `win_flMoveAnim` coupé, rien ne glisse.
  assert.match(bloc, /if \(!hote \|\| !FLUIDE\) return;/);
});

test('l’état de départ n’est pas lui-même une transition', () => {
  assert.match(CSS, /> \.caps-entre,[\s\S]{0,120}\{\s*\n\s*transition: none;\s*\n\s*transform: translateY\(var\(--cy, 0px\)\); opacity: 0;/);
});

test('la courbe est l’équivalent continu de l’amortissement d’époque', () => {
  assert.match(CSS, /transition: transform \.26s cubic-bezier\(\.33, 1, \.68, 1\),\s*\n\s*opacity \.26s cubic-bezier\(\.33, 1, \.68, 1\);/);
  // Les deux colonnes concernées, et elles seules.
  assert.match(CSS, /body\.bureau-frutiz #sc-liste > \*,\s*\n\s*body\.bureau-frutiz \.fen #shop-sheet #bo-rubriques > \* \{/);
  // Qui demande moins de mouvement n'en a pas.
  assert.match(CSS, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?#bo-rubriques > \* \{ transition: none; \}/);
});

test('le light rappelle après chaque colonne refaite, et seulement au bureau', () => {
  assert.match(LIGHT, /if \(window\.BureauFrutiz && BureauFrutiz\.animerEntrees\) BureauFrutiz\.animerEntrees\(box\);/);
  // Deux appels : la colonne des scores et celle de la boutique.
  const n = (LIGHT.match(/BureauFrutiz\.animerEntrees\(box\);/g) || []).length;
  assert.strictEqual(n, 2);
  assert.match(JS, /animerEntrees: animerEntrees,/);
});
