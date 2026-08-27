'use strict';
/*
 * LA FICHE EST UNE FENÊTRE COMME UNE AUTRE
 *
 * `win.Frutiz extends WinStandard` (0x583ad) : ce n'est pas une boîte de
 * dialogue, c'est une fenêtre du bureau. `initInterface` lui branche le même
 * couple que toutes les autres —
 *
 *     mcInterface.onPress = function() {
 *       this._parent.box.activate(); this._parent.initDrag();
 *     }
 *     mcInterface.onRelease = mcInterface.onReleaseOutside = endDrag
 *
 * — et `WinStandard.initDrag` (0x53b7b) n'attache PAS la fenêtre au curseur :
 * il sort le FANTÔME (`win.Ghost`, la silhouette blanche à quatre arcs) et
 * c'est lui qui suit la souris. `endDrag` (0x53d6d) reprend sa place, `recal`
 * (0x5411f) la borne à la zone du bureau, `moveToPos` y fait GLISSER la
 * fenêtre.
 *
 * LE PORTAGE FAISAIT TOUT AUTREMENT : il attachait la fiche au curseur, sans
 * silhouette, et ne la bornait qu'à zéro — elle passait sous la main bar et
 * derrière la bande des contacts, et elle sautait à sa place au lieu d'y
 * glisser. Trois comportements différents du reste du bureau, sur la seule
 * fenêtre qui n'était pas passée par `creerFenetre`.
 *
 * CE QUI REND LA CHOSE POSSIBLE : la fiche se place par `--fx`/`--fy` (sa
 * feuille tactile occupe déjà `left`/`top`). `posDe` lit désormais l'une OU
 * l'autre paire, et `glisserVers` prend un troisième argument qui dit COMMENT
 * écrire la position. Le mouvement, lui, est le même code.
 *
 * Mesuré au banc (fenêtre 1280 × 800, fiche 324 × 343) : ouverte en (9, 106) —
 * le coin —, un fantôme paraît dans `#fiche-backdrop` pendant le geste, la
 * fiche ne bouge pas d'un pixel, et un lâcher à (−351, −200) la ramène en
 * (9, 106).
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const JS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.js'), 'utf8');

test('elle se déplace au FANTÔME, comme toutes les autres', () => {
  const bloc = JS.slice(JS.indexOf('function glisserFiche'), JS.indexOf('function bornerFiche'));
  assert.match(bloc, /var fantome = creerFantome\(pos, f\.parentNode\);/);
  // La fiche ne suit PAS le curseur : c'est la silhouette qui bouge.
  assert.match(bloc, /fantome\.style\.left = Math\.round\(pos\.x \+ e2\.clientX - decalx\) \+ 'px';/);
  assert.doesNotMatch(bloc, /f\.style\.setProperty\('--fx', Math\.max\(0/);
  // Et l'ancien bornage à zéro a disparu.
  assert.doesNotMatch(JS, /Math\.max\(0, e\.clientX - dx\)/);
});

test('elle est bornée à la ZONE DU BUREAU, pas à zéro', () => {
  const bloc = JS.slice(JS.indexOf('function glisserFiche'), JS.indexOf('function bornerFiche'));
  assert.match(bloc, /var cible = recal\(\{[\s\S]*?w: pos\.w, h: pos\.h,\s*\n\s*\}, \{ w: pos\.w, h: pos\.h \}\);/);
  assert.match(bloc, /glisserVers\(f, cible, poserFicheA\);/);
});

test('le coin qui bouge la reborne, comme les fenêtres', () => {
  // `main.onResize()` suit `SideList.activate` (cornerX 9 → 129), le repli de
  // la main bar (cornerY 106 → 10) et le redimensionnement de la page. Les
  // trois appelaient déjà `bornerDansEcran` sur les fenêtres ; la fiche y est.
  const n = (JS.match(/\n\s*bornerFiche\(\);/g) || []).length;
  assert.strictEqual(n, 3, 'les trois recalages du bureau doivent inclure la fiche');
  assert.match(JS, /function bornerFiche\(\) \{[\s\S]*?glisserVers\(f, pos, poserFicheA\);/);
  // Rien à reborner tant qu'elle n'a pas été posée.
  assert.match(JS, /if \(!f \|\| !f\.dataset\.posee \|\| !f\.offsetWidth\) return;/);
});

test('`posDe` lit les deux façons de se placer', () => {
  const bloc = JS.slice(JS.indexOf('function posDe(fen)'), JS.indexOf('// recal (0x54126)'));
  assert.match(bloc, /if \(isNaN\(x\)\) x = parseFloat\(fen\.style\.getPropertyValue\('--fx'\)\);/);
  assert.match(bloc, /if \(isNaN\(y\)\) y = parseFloat\(fen\.style\.getPropertyValue\('--fy'\)\);/);
});

test('`glisserVers` sait écrire ailleurs que dans left/top', () => {
  const bloc = JS.slice(JS.indexOf('function glisserVers'), JS.indexOf('function creerFantome'));
  assert.match(bloc, /function glisserVers\(fen, cible, poser\) \{/);
  assert.match(bloc, /poser = poser \|\| function \(x, y\) \{/);
  // Le départ de la glissade se lit par `posDe` : la fiche part donc d'où elle
  // est, et non de (0, 0) comme le ferait `parseFloat(style.left)`.
  assert.match(bloc, /var depart = posDe\(fen\);/);
  assert.match(JS, /function poserFicheA\(x, y\) \{[\s\S]*?--fx[\s\S]*?--fy/);
});

test('le fantôme de la fiche vit dans SA couche', () => {
  // `#bureau-fenetres` est en z-index 10, `#fiche-backdrop` en 70 : une
  // silhouette posée chez les fenêtres passerait DERRIÈRE la fiche.
  const CSS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.css'), 'utf8');
  assert.match(CSS, /#bureau-fenetres \{\s*\n\s*position: absolute; inset: 0; z-index: 10;/);
  assert.match(CSS, /#fiche-backdrop \{\s*\n\s*position: fixed; inset: 0; z-index: 70;/);
  assert.match(JS, /function creerFantome\(pos, hote\) \{/);
  assert.match(JS, /\(hote \|\| \$\('#bureau-fenetres'\)\)\.appendChild\(fantome\);/);
});
