'use strict';
/*
 * « BEURK » — LA QUATORZIÈME ÉMOTE, ET LA PREMIÈRE QUI NE VIENNE PAS DE 2005.
 *
 * « J'aimerais créer une émote (animation de bouille) beurk -> n'inventons
 * rien, reprenons des choses existantes. La bouille devient triste (émotion
 * tristesse) et on récupère l'animation "rougit" (juste la partie colorée) en
 * remplaçant le rouge par le vert. »
 *
 * Elle n'ajoute donc AUCUN dessin. Trois pièces déjà là, remises ensemble :
 *
 *   · la pellicule de « rougir » (`actionList` 5), dont le seul apport est le
 *     FARD des joues — deux formes interpolées posées à la profondeur 10 du
 *     visage, du rouge pur dont l'alpha fait tout le modelé ;
 *   · le visage de l'humeur 2, « Triste » (`emoteList[2] = [2, 1]`) ;
 *   · la transformation de couleur du moteur, qui éteint le rouge et pose le
 *     vert sans toucher à l'alpha.
 *
 * Ce qui se vérifie ICI, c'est le CÂBLAGE : le mot tapé dans le chat, la
 * phrase affichée, l'indice envoyé au moteur. Le rendu lui-même — le fard qui
 * verdit, la bouche qui s'attriste — est éprouvé dans bouilleMoteur.test.js,
 * qui joue vraiment la pellicule.
 *
 * ET L'INDICE 13 NE BOUGE PAS. Les treize premiers sont ceux du script racine
 * des familles : les intercaler, ce serait donner un autre sens aux relevés,
 * à la page de démonstration et aux planches d'images. « Beurk » se range au
 * bout, et nulle part ailleurs.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
const MOTEUR = fs.readFileSync(path.join(ROOT, 'public/js/bouille-moteur.js'), 'utf8');
const DEMO = fs.readFileSync(path.join(ROOT, 'public/demo.html'), 'utf8');

test('le mot tapé dans le chat mène à l’émote, et à elle seule', () => {
  // `detectEmote` compare le message ENTIER, sensible à la casse — la règle
  // d'époque (`MeMng.fbouilleActionStr`). « je dis beurk » reste du texte.
  const bloc = /var EMOTE_MAP = \{\};[\s\S]*?\n  \}\)\(\);/.exec(LIGHT);
  assert.ok(bloc, 'la table des déclencheurs');
  assert.match(bloc[0], /add\("beurk", "a la nausée", \["beurk", "berk", "bwark"\]\);/);
  // Et les treize d'époque sont toujours là, inchangés.
  for (const [anim, phrase] of [['rire', 'rigole'], ['mdr', 'éclate de rire'],
    ['langue', 'tire la langue'], ['rougir', 'rougit'], ['regard', 'regarde ailleurs'],
    ['sifflote', 'sifflote'], ['gum', 'fait une bulle de chewing-gum'],
    ['question', 'se pose des questions'], ['miam', 'se régale'],
    ['pleurer', 'pleure'], ['larme', 'laisse couler une larme']]) {
    assert.ok(bloc[0].includes('add("' + anim + '", "' + phrase + '"'),
      'l’émote « ' + anim + ' » garde sa phrase');
  }
});

test('l’indice envoyé au moteur est le 13, au bout et pas ailleurs', () => {
  const idx = /var ANIM_INDEX = \{[\s\S]*?\};/.exec(LIGHT);
  assert.ok(idx, 'la table des indices');
  assert.match(idx[0], /beurk:13/);
  // Les douze d'époque gardent le leur : un indice qui glisse, et toute la
  // conversation entre le fil et le moteur se décale.
  for (const [nom, n] of [['parle', 1], ['rire', 2], ['mdr', 3], ['langue', 4],
    ['rougir', 5], ['regard', 6], ['sifflote', 7], ['gum', 8], ['question', 9],
    ['miam', 10], ['pleurer', 11], ['larme', 12]]) {
    assert.ok(new RegExp(nom + ':' + n + '\\b').test(idx[0]), nom + ' → ' + n);
  }
  // La légende de la scène, celle qui passe sous la bouille.
  const lab = /var ANIM_LABEL = \{[\s\S]*?\};/.exec(LIGHT);
  assert.ok(lab, 'la table des légendes');
  assert.match(lab[0], /beurk:"a la nausée"/);
});

test('le moteur connaît « beurk », et le nomme', () => {
  const anims = /const ANIMATIONS = \[[\s\S]*?\];/.exec(MOTEUR);
  assert.ok(anims, 'la liste des animations');
  // Juste après `actionList`, qui s'arrête à « larme ».
  assert.match(anims[0], /'larme', 'beurk'/);
  const noms = /const NOMS_ANIMATIONS = \[[\s\S]*?\];/.exec(MOTEUR);
  assert.ok(noms, 'la liste des noms');
  assert.match(noms[0], /'Beurk'/);
});

test('la branche 13 emprunte « rougir » et l’humeur 2, sans rien coder en dur', () => {
  const br = /\} else if \(id === 13\) \{[\s\S]*?\n    \}/.exec(MOTEUR);
  assert.ok(br, 'la branche de l’animation 13');
  // La pellicule de « rougir », pas une nouvelle.
  assert.match(br[0], /face\.allerImage\('rougir', true\)/);
  // Le visage se LIT dans HUMEURS : si la table bouge, la grimace suit.
  assert.match(br[0], /const triste = HUMEURS\[2\];/);
  assert.match(br[0], /oeil\(triste\[0\] \+ 1\)/);
  assert.match(br[0], /bb\.allerImage\(triste\[1\] \+ 1, false\)/);
  assert.doesNotMatch(br[0], /oeil\(3\)|allerImage\(2, false\)/,
    'ni l’œil ni la bouche ne sont écrits en chiffres');

  // Le drapeau du fard kaki se pose au SEUL endroit qui décide de l'animation
  // — donc toute autre animation, et le repos, le rangent.
  assert.match(MOTEUR, /this\.fardKaki = \(id === 13\);/);
});

test('la page de démonstration la propose aussi', () => {
  assert.match(DEMO, /\{ id: 'beurk',\s+name: 'Beurk',\s+idx: 13 \},/);
});
