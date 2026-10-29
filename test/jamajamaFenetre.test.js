'use strict';
/*
 * JAMAJAMA — QUAND LA FENÊTRE PASSE DERRIÈRE.
 *
 * Les autres jeux se mettent en pause quand leur fenêtre perd le focus ou se
 * cache. JamaJama n'a rien à suspendre : un puzzle au tour par tour, sans
 * chrono, où les animations ne font que finir le coup joué. Il doit en
 * revanche LÂCHER tout ce qui est tenu — le `keyup` partira dans l'autre
 * fenêtre, et une flèche restée « enfoncée » enchaînerait les pas au retour.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public/jamajama/jeu.js'), 'utf8');

test('lacherTout relâche flèches, espace, doigt et geste en attente', () => {
  const m = SRC.match(/function lacherTout\(\) \{([\s\S]*?)\n  \}/);
  assert.ok(m, 'la fonction lacherTout existe');
  const corps = m[1];
  assert.match(corps, /for \(const k of Object\.keys\(touches\)\) touches\[k\] = false;/);
  for (const v of ['enAttente', 'espaceAppuye', 'doigt', 'geste']) {
    assert.match(corps, new RegExp('\\b' + v + ' = (null|false);'), v + ' est remis à zéro');
  }
});

test('elle est branchée sur blur et sur la page cachée', () => {
  assert.match(SRC, /window\.addEventListener\('blur', lacherTout\);/);
  assert.match(SRC, /document\.addEventListener\('visibilitychange', \(\) => \{ if \(document\.hidden\) lacherTout\(\); \}\);/);
});

test('le jeu ne tient aucune horloge de partie à suspendre', () => {
  // Pas de minuteur : la seule boucle est l'animation (requestAnimationFrame).
  assert.doesNotMatch(SRC, /\bset(Interval|Timeout)\s*\(/);
});
