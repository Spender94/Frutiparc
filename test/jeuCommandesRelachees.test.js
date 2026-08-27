'use strict';
/*
 * QUITTER UN JEU, C'EST LÂCHER SES COMMANDES.
 *
 * LE BUG. Les écouteurs de relâchement d'un jeu sont posés sur SES pièces :
 * `pointerup`/`pointercancel` sur le canevas (game.js), et les quatre
 * écouteurs des boutons du pavé tactile sur les boutons eux-mêmes
 * (index.html). Or le light met le panneau du jeu en `display:none` quand on
 * le quitte pour aller discuter — la pièce cesse d'être affichée SOUS LE
 * DOIGT, et aucun de ces écouteurs ne se déclenche.
 *
 * La touche reste alors enfoncée POUR TOUJOURS. Au retour, `entree.echap` est
 * vrai à chaque image : la pause se remet aussitôt qu'on la lève, le serpent
 * fonce dans le mur, plus rien ne répond. « Le jeu a freezé, on ne peut plus
 * rien faire. »
 *
 * MESURÉ AU BANC (Playwright, mobile tactile, `banc-latch.js`) : on appuie sur
 * le bouton « pause » du pavé, on quitte l'onglet SANS relever le doigt.
 *
 *     avant : parti discuter → enfoncées ["echap"] · de retour → ["echap"]
 *     après : parti discuter → enfoncées []        · de retour → []
 *
 * TROIS FILETS, parce qu'aucun ne couvre tout seul tous les navigateurs :
 *   · le light DEMANDE le relâchement en quittant l'onglet
 *     (`__relacherCommandes`, sinon un `blur`) ;
 *   · le jeu relâche quand sa scène tombe à 0 × 0 — le signe sûr d'un panneau
 *     caché, relevé au banc ;
 *   · les relâchements sont AUSSI posés sur la fenêtre, pour le doigt relevé
 *     hors de la pièce.
 *
 * La boucle de jeu, elle, n'était pas en cause : mesurée avant/après le
 * détour, elle tourne au même régime (+10 d'horloge par seconde).
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
const JEU = fs.readFileSync(path.join(ROOT, 'public/snake3/game.js'), 'utf8');
const PAGE = fs.readFileSync(path.join(ROOT, 'public/snake3/index.html'), 'utf8');

test('le light demande le relâchement en quittant l’onglet d’un jeu', () => {
  assert.match(LIGHT, /if \(ongletCourant && ongletCourant !== tab\) lacherCommandes\(ongletCourant\);/);
  assert.match(LIGHT, /if \(typeof w\.__relacherCommandes === "function"\) w\.__relacherCommandes\(\);\s*\n\s*else w\.dispatchEvent\(new Event\("blur"\)\);/);
  // il ne s'adresse qu'aux onglets qui hébergent un jeu
  assert.match(LIGHT, /function lacherCommandes\(tab\) \{\s*\n\s*var sel = CADRES_JEU\[tab\];\s*\n\s*if \(!sel\) return;/);
});

test('le jeu sait tout lâcher, et l’expose au light', () => {
  assert.match(JEU, /this\.relacherTout = \(\) => \{\s*\n\s*this\.touches\.clear\(\);\s*\n\s*if \(this\.pad\) for \(const k of Object\.keys\(this\.pad\)\) this\.pad\[k\] = false;/);
  // le pointeur aussi, et le mode est prévenu
  assert.match(JEU, /this\.pointeur\.bas = false;\s*\n\s*if \(this\.mode && this\.mode\.relacher\) this\.mode\.relacher\(\);/);
  assert.match(JEU, /window\.__relacherCommandes = this\.relacherTout;/);
});

test('une scène à zéro relâche tout — le signe d’un panneau caché', () => {
  assert.match(JEU, /const b = this\.canvas\.getBoundingClientRect\(\);\s*\n\s*if \(!b\.width \|\| !b\.height\) this\.relacherTout\(\);/);
  // …et les deux autres filets d'époque du navigateur
  assert.match(JEU, /window\.addEventListener\('blur', \(\) => this\.relacherTout\(\)\);/);
  assert.match(JEU, /document\.addEventListener\('visibilitychange', \(\) => \{\s*\n\s*if \(document\.hidden\) this\.relacherTout\(\);/);
});

test('les relâchements sont aussi posés sur la FENÊTRE', () => {
  // le pointeur du canevas
  assert.match(JEU, /window\.addEventListener\('pointerup', fin\);\s*\n\s*window\.addEventListener\('pointercancel', fin\);/);
  // et chaque bouton du pavé tactile
  assert.match(PAGE, /window\.addEventListener\('pointerup', relacher\);\s*\n\s*window\.addEventListener\('pointercancel', relacher\);/);
  assert.match(PAGE, /var relacher = function \(\) \{\s*\n\s*if \(!pad\[touche\]\) return;\s*\n\s*pad\[touche\] = false;\s*\n\s*b\.classList\.remove\('presse'\);/);
});

test('les boutons se dé-enfoncent aussi à l’écran', () => {
  assert.match(PAGE, /jeu\.padReset = function \(\) \{/);
  assert.match(PAGE, /document\.querySelectorAll\('#commandes \.btn\.presse'\)\.forEach/);
  assert.match(JEU, /if \(this\.padReset\) this\.padReset\(\);/);
});
