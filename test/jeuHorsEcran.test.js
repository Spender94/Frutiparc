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
  // On n'éteint que si plus AUCUN jeu n'est à l'écran (un seul est chargé
  // désormais, mais la mesure reste celle de l'écran, pas du chargement).
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

/*
 * « ENCHAÎNER LES JEUX LES REND DE PLUS EN PLUS LENTS, comme si les sessions
 *   des jeux précédents n'étaient pas vraiment fermées. »
 *
 * Mesuré sur le bureau light (Chromium, six jeux enchaînés) : chaque jeu
 * quitté restait chargé, et son cadre caché continuait de dessiner à 61
 * images par seconde ; à cinq jeux, le fil principal était pris à 90 % et le
 * jeu visible tombait à 7 images/s. Sur le bureau, c'était même pire : le
 * panneau qui entre dans sa fenêtre RECHARGE son cadre (déplacer une iframe
 * recrée son contexte), et le panneau rendu à sa place le rechargeait encore,
 * caché, où il vivait jusqu'à la fois suivante.
 *
 * Trois règles :
 *   1. UN SEUL JEU CHARGÉ À LA FOIS — la Frusion n'a qu'une fente ;
 *   2. FERMER LA FENÊTRE D'UN JEU, C'EST L'ARRÊTER — le bureau décharge
 *      AVANT de déplacer le cadre, et le light ne l'adresse qu'APRÈS que le
 *      bureau l'a mis en fenêtre (un seul chargement par partie) ;
 *   3. UN JEU CACHÉ NE DESSINE PLUS — ses demandes d'image sont retenues,
 *      comme dans un onglet d'arrière-plan, et rendues à son retour.
 */
const BUREAU = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.js'), 'utf8');

test('un seul jeu chargé à la fois : ouvrir un jeu décharge les autres', () => {
  assert.match(LIGHT, /function dechargerLesAutresJeux\(garde\) \{[\s\S]*?if \(tab !== garde\) dechargerJeu\(tab\);/);
  assert.match(LIGHT, /ongletCourant = tab;\s*\n\s*if \(CADRES_JEU\[tab\]\) dechargerLesAutresJeux\(tab\);/);
  // Le bureau ferme la fenêtre d'un autre jeu encore ouverte : un cadre vide
  // n'a rien à montrer, et le disque est rendu.
  const apres = /function apresActivateTab\(tab\) \{[\s\S]*?\n  \}/.exec(BUREAU)[0];
  assert.match(apres, /var autre = jeuDuPanneau\(cle\);\s*\n\s*if \(autre && autre !== tab\) fermerFenetre\(cle\);/);
  assert.ok(apres.indexOf('fermerFenetre(cle)') < apres.indexOf('ouvrirFenetre(tab)'), 'on ferme avant d’ouvrir');
});

test('fermer la fenêtre d’un jeu, c’est l’arrêter — et le cadre ne se charge qu’une fois', () => {
  assert.match(BUREAU, /function jeuDuPanneau\(idPanneau\) \{/);
  const fermer = /function fermerFenetre\(idPanneau\) \{[\s\S]*?\n  \}/.exec(BUREAU)[0];
  assert.match(fermer, /var jeuFerme = jeuDuPanneau\(idPanneau\);\s*\n\s*if \(jeuFerme && window\.JeuxPortes && JeuxPortes\.decharger\) JeuxPortes\.decharger\(jeuFerme\);/);
  assert.ok(fermer.indexOf('JeuxPortes.decharger(jeuFerme)') < fermer.indexOf('rendre(f.panneau, f.origine);'),
    'on décharge AVANT de déplacer le cadre : il voyage vide');
  assert.match(LIGHT, /decharger: dechargerJeu,/);
  // Et à l'ouverture, le light adresse le cadre APRÈS que le bureau l'a mis
  // en fenêtre — déplacer un cadre adressé le rechargerait.
  const activer = /function activateTab\(tab\) \{[\s\S]*?\n  \}/.exec(LIGHT)[0];
  assert.ok(activer.indexOf('BureauFrutiz.apresActivateTab(tab);') < activer.indexOf('cadreJeu.setAttribute("src", adresseJeu(tab));'),
    'le bureau d’abord, l’adresse ensuite');
});

test('un jeu caché ne dessine plus : ses images sont retenues, puis rendues', () => {
  assert.match(LIGHT, /if \(vu\) reprendreRendu\(cadre\); else suspendreRendu\(cadre\);/);
  assert.match(LIGHT, /veiller: veillerSurLesJeux,/);
  // Le bureau fait mesurer tout de suite quand il montre ou range une fenêtre.
  for (const fn of ['activerSlot', 'mettreEnOnglet', 'versBureau']) {
    const corps = new RegExp('function ' + fn + '\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}').exec(BUREAU)[0];
    assert.match(corps, /veillerSurLesJeux\(\);/, fn + ' fait veiller');
  }
  // Et le mécanisme lui-même, sur un cadre simulé.
  const vm = require('node:vm');
  const code = /\n  function suspendreRendu\(cadre\) \{[\s\S]*?\n  \}\n  function reprendreRendu\(cadre\) \{[\s\S]*?\n  \}\n/.exec(LIGHT)[0];
  const bac = {};
  vm.createContext(bac);
  vm.runInContext(code + '\nthis.suspendreRendu = suspendreRendu; this.reprendreRendu = reprendreRendu;', bac);
  const rendues = [], annulees = [];
  const w = {
    requestAnimationFrame(cb) { rendues.push(cb); return rendues.length; },
    cancelAnimationFrame(id) { annulees.push(id); },
  };
  const cadre = { contentWindow: w };
  bac.suspendreRendu(cadre);
  const a = () => {}, b = () => {}, c = () => {};
  const ida = w.requestAnimationFrame(a), idb = w.requestAnimationFrame(b);
  w.requestAnimationFrame(c);
  assert.strictEqual(rendues.length, 0, 'en veille, rien ne passe au navigateur');
  assert.ok(ida < 0 && idb < 0 && ida !== idb, 'des identifiants négatifs, pour ne pas croiser les vrais');
  w.cancelAnimationFrame(idb);
  w.cancelAnimationFrame(12345);
  assert.deepStrictEqual(annulees, [12345], 'un identifiant inconnu passe au navigateur');
  bac.suspendreRendu(cadre);         // deux fois : sans effet
  bac.reprendreRendu(cadre);
  assert.deepStrictEqual(rendues, [a, c], 'au réveil, les demandes retenues — sauf l’annulée — sont rendues, dans l’ordre');
  assert.strictEqual(w.__fpRendu, null);
  w.requestAnimationFrame(a);
  assert.strictEqual(rendues.length, 3, 'et le cadre a retrouvé sa vraie fonction');
  bac.reprendreRendu(cadre);         // pas en veille : sans effet
  assert.strictEqual(rendues.length, 3);
});
