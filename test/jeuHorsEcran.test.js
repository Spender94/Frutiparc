'use strict';
/*
 * UN JEU HORS DE L'ÉCRAN N'EST PLUS UNE PARTIE
 * ════════════════════════════════════════════
 *
 * Deux symptômes, une seule cause : dans le light, un cadre de jeu est chargé
 * UNE FOIS et n'est jamais vidé. Quitter l'onglet, fermer la fenêtre du
 * bureau, déporter le jeu — rien de tout cela n'arrêtait le jeu, qui
 * continuait de tourner derrière avec sa socket et son guetteur.
 *
 *   · LE VOYANT MENTAIT. Le voyant « en partie » ne vient pas du jeu mais de
 *     son guetteur d'éjection (public/js/eject-watch.js), qui bat toutes les
 *     secondes et demie et renouvelle au passage la place du joueur. Un cadre
 *     caché battait toujours : le voyant restait allumé sur un joueur revenu
 *     bavarder au salon depuis un quart d'heure.
 *
 *   · DÉPORTER FAISAIT DEUX PARTIES. « Déporter » ouvre le jeu dans une
 *     fenêtre de navigateur et referme la fenêtre du bureau — mais le CADRE
 *     gardait son adresse. Sur Frutibandas, un jeu à plusieurs, cela donnait
 *     deux clients pour le même compte, chacun dans sa partie.
 *
 * Le remède tient en deux gestes :
 *   1. le light MESURE si un cadre est à l'écran (`getClientRects()`, qui dit
 *      vrai sur les deux présentations) et le lui dit (`__fpSurEcran`) ; le
 *      battement porte alors `actif=0`, et le serveur ne renouvelle plus la
 *      place. L'extinction, elle, est immédiate ;
 *   2. « Déporter » DÉCHARGE le cadre — le jeu s'arrête pour de bon, et
 *      l'onglet le rechargera si on y revient.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
const GUETTEUR = fs.readFileSync(path.join(ROOT, 'public/js/eject-watch.js'), 'utf8');
const SERVEUR = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

test('le light mesure si un cadre de jeu est à l’écran', () => {
  // `getClientRects()` : une iframe cachée par `display:none` garde son
  // document mais perd son rectangle. Vrai pour le panneau du tiroir mobile
  // comme pour la fenêtre du bureau qu'on vient de fermer.
  assert.match(LIGHT, /function cadreAffiche\(cadre\) \{\s*\n\s*try \{ return !!\(cadre && cadre\.getClientRects\(\)\.length\); \}/);
  assert.match(LIGHT, /if \(w\) w\.__fpSurEcran = surEcran;/);
  // À chaque bascule d'onglet, et en filet toutes les deux secondes — le
  // bureau ouvre et ferme ses fenêtres sans passer par `activateTab`.
  assert.match(LIGHT, /setInterval\(veillerSurLesJeux, 2000\);/);
  assert.match(LIGHT, /donnerFocusAuJeu\(tab\);\s*\n(?:\s*\/\/[^\n]*\n)+\s*veillerSurLesJeux\(\);/);
  // On n'éteint que si plus AUCUN jeu n'est à l'écran : sur le bureau, deux
  // fenêtres de jeu peuvent coexister.
  assert.match(LIGHT, /if \(quitte && !unJeuALecran\(\)\) eteindreLaPlace\(\);/);
  // L'extinction est immédiate ; le rallumage, lui, revient au battement, qui
  // connaît le nom de jeu du SERVEUR (« swapou2 » et non l'onglet « swapou »).
  assert.match(LIGHT, /"\/api\/jeu\/fenetre\?sid=" \+ encodeURIComponent\(state\.sid\) \+ "&ouvert=0"/);
});

test('le battement dit s’il vient d’un jeu qu’on regarde encore', () => {
  assert.match(GUETTEUR, /function surEcran\(\) \{\s*\n\s*return window\.__fpSurEcran === undefined \? true : !!window\.__fpSurEcran;/,
    'une vraie fenêtre (pas de drapeau) reste « à l’écran » : le cas d’origine ne change pas');
  // On continue de guetter l'éjection hors écran — le disque peut partir
  // pendant qu'on bavarde — mais sans réclamer la place.
  assert.match(GUETTEUR, /fetch\(adresse \+ \(surEcran\(\) \? '' : '&actif=0'\)\)/);
  // Et le serveur l'écoute.
  assert.match(SERVEUR, /if \(joueur && String\(req\.query\.actif \|\| '1'\) !== '0'\) marquerEnPartie\(joueur, game\);/);
});

test('déporter DÉPLACE le jeu, il n’en ouvre pas un second', () => {
  assert.match(LIGHT, /function dechargerJeu\(tab\) \{/);
  // `about:blank` décharge le document ; retirer l'attribut ensuite rend le
  // cadre « vide » aux yeux du chargement paresseux d'`activateTab`.
  assert.match(LIGHT, /cadre\.setAttribute\("src", "about:blank"\);\s*\n\s*cadre\.removeAttribute\("src"\);/);
  assert.match(LIGHT, /if \(cadreJeu && !cadreJeu\.getAttribute\("src"\)\) \{\s*\n\s*cadreJeu\.setAttribute\("src", adresseJeu\(tab\)\);/,
    'reprendre l’onglet recharge le jeu');
  // Le déport décharge, et seulement après avoir obtenu sa fenêtre : une
  // fenêtre refusée par le navigateur ne doit pas arrêter le jeu pour rien.
  const bloc = LIGHT.slice(LIGHT.indexOf('deporter: function (tab, l, h)'),
    LIGHT.indexOf('refermer: function ()'));
  assert.match(bloc, /if \(!window\.__jeuPopup\) return false;/);
  assert.match(bloc, /dechargerJeu\(tab\);/);
  assert.ok(bloc.indexOf('if (!window.__jeuPopup) return false;') < bloc.indexOf('dechargerJeu(tab);'),
    'on ne décharge qu’une fois la fenêtre obtenue');
  // Et refermer la fenêtre déportée éteint la place sans attendre son
  // expiration.
  assert.match(LIGHT, /if \(etait && !unJeuALecran\(\)\) eteindreLaPlace\(\);/);
});
