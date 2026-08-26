/*
 * LES ONGLETS du bureau light, et les retours de finition qui vont avec.
 *
 * `MainBar.addTab` (0x6afbc), `MainBarTab` (0x6f0d6) et `FPSlotList.addSlot`
 * (frutiparc/FPSlotList.as) disent trois choses que le portage ne faisait pas :
 *
 *   · l'onglet s'attache à `dp_tab + (tabMax − id × 2)` — plus le rang est
 *     grand, plus la profondeur est BASSE : le nouvel onglet passe SOUS les
 *     précédents, et « Bureau » reste devant ;
 *   · sa PASTILLE est un bouton (`bottom.but.onPress`) qui déroule le menu du
 *     slot — l'onglet descend de `tabMenuMargeUp + n × tabMenuSpace` et le
 *     menu prend la place libérée ;
 *   · `addSlot(slot, flGo)` n'active l'onglet QUE si flGo, et flGo vient de
 *     `Key.isDown(17)` : au clic ordinaire sur « replier », la fenêtre se
 *     RANGE et l'on reste sur le bureau.
 *
 * Le reste tient de la finition : les états de survol préchargés (sans quoi
 * chaque pièce cligne au premier passage du curseur), la flèche plutôt que la
 * croix de déplacement, le glisser d'icône qui ne déclenche plus la sélection
 * du navigateur, et la typo du journal.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const JS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.css'), 'utf8');
const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');

test('le nouvel onglet passe SOUS les précédents', () => {
  // `attachMovie("tab", …, dp_tab + (tabMax − r4 × 2))`, r4 = le rang.
  assert.match(JS, /o\.style\.zIndex = String\(500 - rang\)/);
  // Et l'activation ne remonte PAS l'onglet en profondeur. Ce qu'elle change,
  // c'est la hauteur, et vers le BAS : `scrollUp` fait tendre `barre._y` vers
  // `flActive * 4` — l'onglet actif descend de quatre pixels.
  assert.match(CSS, /\.fb-onglet\.actif \{ top: 4px; \}/);
  assert.doesNotMatch(CSS, /\.fb-onglet\.actif \{[^}]*z-index/);
});

test('replier RANGE la fenêtre — seul Ctrl y va tout de suite', () => {
  // `WinStandard.putInTab` : Key.isDown(17) → putInTab(true) → addSlot(…, true).
  assert.match(JS, /function mettreEnOnglet\(idPanneau, flGo\)/);
  assert.match(JS, /if \(flGo\) activerSlot\(id\);/);
  assert.match(JS, /if \(e\.ctrlKey \|\| e\.metaKey\) \{ mettreEnOnglet\(panneau\.id, true\); return; \}/);
  assert.match(JS, /mettreEnOnglet\(panneau\.id, false\);/);
  // Un jeu qu'on vient de lancer, lui, s'affiche : flGo vrai.
  assert.match(JS, /mettreEnOnglet\(panneau\.id, true\);\s*\n\s*\}\s*\n\s*\};/);
  // Le bureau ne s'escamote que si un onglet A LA MAIN : rangée, la fenêtre
  // laisse le fond d'écran en place.
  assert.match(CSS, /body\.bureau-frutiz\.fb-onglet-actif #bureau,/);
  assert.match(JS, /document\.body\.classList\.toggle\('fb-onglet-actif', id !== 'bureau'\)/);
});

test('la pastille de l’onglet ouvre le menu, « Fermer » en tête', () => {
  assert.match(JS, /ico\.className = 'fb-onglet-ico'/);
  assert.match(JS, /menuOnglet\(id\);/);
  // Les constantes du clip.
  assert.match(JS, /MENU_ESPACE = 18, MENU_MARGE_HAUT = 8, MENU_MARGE_GAUCHE = 4, MENU_LARGEUR = 100/);
  // `getMenu` rend [Vers bureau, Fermer] et les pose à `_y = −(i × 18 + 16)` :
  // l'index 0 EN BAS. De haut en bas, on lit donc Fermer puis Vers bureau.
  assert.match(JS, /entrees\.slice\(\)\.reverse\(\)\.forEach/);
  // L'onglet DESCEND de la hauteur du menu, qui prend sa place.
  assert.match(JS, /onglet\.style\.setProperty\('--menu-h',/);
  assert.match(CSS, /\.fb-onglet\.menu-ouvert \{ top: var\(--menu-h\); \}/);
  // La pastille est à la place que le dessin lui donne dans la plaque.
  // Relevé 1:1 : la pastille est centrée en x 17,5 dans chaque onglet — celle
  // du rang 1 tombe donc en 127,5, soit 19,08 dans le cadre du dessin. À 1,36
  // elle passait sous la plaque du voisin.
  assert.match(CSS, /\.fb-onglet-ico \{\s*position: absolute; left: 19\.08px; top: 22\.75px;/);
  assert.match(CSS, /background-position: 19\.08px 22\.75px, left top, left top;/);
});

test('les états de survol sont préchargés — plus de clignotement', () => {
  // Un `background-image` d'état ne part chercher son dessin qu'au premier
  // survol : la pièce disparaît le temps du chargement. On demande donc
  // toutes les images de la feuille dès le démarrage du bureau.
  assert.match(JS, /function prechargerImages\(\)/);
  assert.match(JS, /fetch\('\/bureau-frutiz\.css'/);
  assert.match(JS, /url\\\(\\s\*\['"\]\?\(\\\/\[\^'"\)\]\+\)\['"\]\?\\s\*\\\)/);
  assert.match(JS, /actif = true;\s*\n\s*document\.body\.classList\.add\('bureau-frutiz'\);\s*\n\s*prechargerImages\(\);/);
});

test('le bandeau d’une fenêtre garde la FLÈCHE', () => {
  assert.match(CSS, /\.fen-titre \{[\s\S]*?cursor: default;/);
  assert.doesNotMatch(CSS, /\.fen-titre \{[\s\S]*?cursor: move;/);
});

test('le glisser d’une icône ne déclenche plus la sélection du navigateur', () => {
  const debut = JS.indexOf('function rendreIconesDeplacables');
  const bloc = JS.slice(debut, JS.indexOf('\n  }\n', JS.indexOf('pointercancel', debut)));
  // Sans preventDefault, tout le bureau vire au bleu pendant le geste.
  assert.match(bloc, /ev\.preventDefault\(\);/);
  // La capture suit le pointeur partout, y compris hors de la page.
  assert.match(bloc, /tuile\.setPointerCapture\(ev\.pointerId\)/);
  assert.match(bloc, /tuile\.addEventListener\('pointermove', glisser\)/);
  assert.match(bloc, /tuile\.addEventListener\('pointercancel', lacher\)/);
  // Le repère est relu à chaque pas : le bureau bouge sous la tuile.
  assert.match(bloc, /var app = bureau\.getBoundingClientRect\(\);\s*\n\s*tuile\.style\.left/);
});

test('le journal : 9 px, et la date sur sa propre ligne', () => {
  assert.match(CSS, /#evt-panel \.evt-item \.txt \{[\s\S]*?font-size: 9px;/);
  assert.match(CSS, /#evt-panel \.evt-item \.quand \{ font-weight: 700; display: block; \}/);
  assert.match(CSS, /#evt-panel \.evt-item \.quand i \{ display: none; \}/);
  assert.match(CSS, /#evt-panel \.evt-item\.neuf \.txt \{ font-weight: 700; font-size: 9px; \}/);
  // Le tiret vit dans son propre élément : le mobile le garde, le bureau le
  // masque — une seule chaîne pour les deux mises en page.
  assert.match(LIGHT, /\+ '<i> - <\/i><\/span>' \+ xmlEscape\(e\.text \|\| ""\)/);
});
