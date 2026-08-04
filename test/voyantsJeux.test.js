/*
 * Les VOYANTS de jeu — l'icône à côté du pseudo d'un joueur en pleine partie.
 *
 * Le bureau les tient depuis toujours : le serveur diffuse un code INTERNE
 * dans la chaîne de statut (quatre caractères base 62 : absence, JEU sur
 * deux, émote), et main.swf montre l'image correspondante de sa feuille
 * d'icônes — décalée de trois (le code 6, Frutibandas, montre l'image 9).
 *
 * Ce fichier garde trois choses :
 *   1. la table serveur — dont la fée de Minipixiz, absente à l'origine ;
 *   2. les chemins qui allument et éteignent le voyant (natifs et matchs) ;
 *   3. l'affichage mobile — les PNG extraits de la même feuille, et le code
 *      de light.html qui les pose à côté des pseudos.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const serveur = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const light = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');

test('la table du bureau connaît la fée de Minipixiz', () => {
  // La règle vérifiée sur les huit jeux d'origine : l'image affichée est le
  // code interne + 3. Le papillon-fée est à l'image 15 de la feuille → 12.
  assert.match(serveur, /minipixiz:\s*12,/, 'minipixiz → interne 12');
  // Et les codes historiques ne bougent pas : le bureau les montre déjà.
  for (const [jeu, code] of [['bandas', 6], ['grapiz', 7], ['swapou2', 4], ['miniwave', 9]]) {
    assert.match(serveur, new RegExp(jeu + ':\\s*' + code + ','), jeu + ' → ' + code);
  }
});

test('le serveur sait traduire le code interne en nom de jeu', () => {
  assert.match(serveur, /STATUS_INTERNAL_JEU/, 'la table inverse existe');
  assert.match(serveur, /statusInternalOf/, 'et la lecture du code d\'un joueur');
  // La vue « tout le site » du mobile porte le jeu de chacun.
  assert.match(serveur, /o\.jeu = jeu;/, '/api/light/online expose `jeu`');
});

test('les jeux natifs ont leur balise « je joue »', () => {
  assert.match(serveur, /app\.post\('\/api\/light\/jeu-en-cours'/, 'la route existe');
  assert.match(serveur, /JEUX_NATIFS_VOYANT/, 'et ne prend que les jeux connus');
  // Les cinq jeux jouables nativement.
  assert.match(serveur, /'bandas', 'grapiz', 'swapou2', 'miniwave', 'minipixiz'/,
    'bandas, grapiz, swapou, miniwave, minipixiz');
  // Les clients solo l'appellent au départ et à l'arrêt.
  for (const fichier of ['public/minipixiz/index.html', 'public/miniwave/index.html']) {
    const t = fs.readFileSync(path.join(ROOT, fichier), 'utf8');
    assert.match(t, /jeu-en-cours/, fichier + ' porte la balise');
    assert.match(t, /sendBeacon/, fichier + ' éteint à la fermeture de l\'onglet');
  }
  const swapou = fs.readFileSync(path.join(ROOT, 'public/swapou/game.js'), 'utf8');
  assert.match(swapou, /direEnPartie/, 'swapou aussi');
  const ecrans = fs.readFileSync(path.join(ROOT, 'public/swapou/screens.js'), 'utf8');
  assert.match(ecrans, /direEnPartie\(true\)/, 'allumée au départ d\'un mode');
  assert.match(ecrans, /direEnPartie\(false\)/, 'éteinte au retour au menu');
});

test('les matchs Grapiz et Frutibandas allument le voyant côté serveur', () => {
  // Le match qui part allume ; le résultat éteint chaque humain.
  const grapiz = serveur.indexOf('const grapizNet = new GrapizNet');
  const bandas = serveur.indexOf('const bandasNet = new BandasNet');
  for (const [nom, debut] of [['grapiz', grapiz], ['bandas', bandas]]) {
    const bloc = serveur.slice(debut, debut + 2200);
    assert.match(bloc, /setUserInternalStatus\(u, statusInternalCode\('/,
      nom + ' : allumé quand le match se forme');
    assert.match(bloc, /setUserInternalStatus\(p\.id, 0\)/,
      nom + ' : éteint au résultat');
  }
});

test('les cinq voyants sont extraits de la feuille du bureau', () => {
  for (const jeu of ['bandas', 'grapiz', 'swapou', 'miniwave', 'minipixiz']) {
    const f = path.join(ROOT, 'public/fb/voyant_' + jeu + '.png');
    assert.ok(fs.existsSync(f), 'voyant_' + jeu + '.png existe');
    assert.ok(fs.statSync(f).size > 800, 'et porte un vrai dessin');
  }
});

test('le mobile pose le voyant à côté des pseudos', () => {
  // La même table que le bureau, traduite en icônes.
  assert.match(light, /VOYANTS_JEU = \{ 6: "bandas", 7: "grapiz", 4: "swapou", 9: "miniwave", 12: "minipixiz" \}/,
    'les codes internes du bureau');
  // La chaîne de statut est lue au format du bureau : base 62, le jeu au milieu.
  assert.match(light, /decode62\(String\(s\)\.substring\(1, 3\)\)/, 'les deux caractères du jeu');
  // Mémorisée à l'arrivée de la liste ET des traces — les deux formes.
  assert.match(light, /rememberStatut\(uname, attr\(frag, "s"\)\)/, 'depuis la liste du salon');
  assert.match(light, /rememberStatut\(attr\(zf, "u"\), attr\(zf, "s"\)\)/, 'depuis les traces imbriquées');
  assert.match(light, /rememberStatut\(attr\(xml, "u"\), attr\(xml, "s"\)\)/, 'et les traces directes');
  // Et posée dans la ligne, pour le salon comme pour tout le site.
  assert.match(light, /voyant_" \+ jeu \+ "\.png/, 'l\'icône vient des PNG extraits');
  assert.match(light, /Joue à " \+ VOYANTS_NOM\[jeu\]/, 'avec le nom du jeu en infobulle');
  assert.match(light, /\.u \.voyant \{/, 'et son style');
});
