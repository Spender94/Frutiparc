'use strict';
/*
 * LES 28 PICTOS D'ÉPOQUE DE JAMAJAMA : la liste de la planche de 2007, une
 * image par picto (redessinée depuis les tracés du jeu), au catalogue du
 * serveur — et rien ne les distribue tant que leurs conditions sont inconnues.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SERVEUR = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

test('28 noms, 28 images PNG, dans l’ordre de la planche', () => {
  const bloc = /const JAMA_PICTOS = \[([\s\S]*?)\];/.exec(SERVEUR)[1];
  const noms = bloc.match(/'[^']+'/g).map((x) => x.slice(1, -1));
  assert.equal(noms.length, 28);
  assert.equal(new Set(noms).size, 28, 'pas de doublon');
  assert.deepEqual(noms.slice(0, 5), ['Banane', 'Orange', 'Pomme', 'Poire', 'Prune']);
  assert.equal(noms[27], 'Toute la bande');
  for (let i = 1; i <= 28; i++) {
    const f = path.join(ROOT, 'Games/poulpi/titems', 'jama' + String(i).padStart(2, '0') + '.png');
    const b = fs.readFileSync(f);
    assert.equal(b.slice(1, 4).toString(), 'PNG', f);
    assert.ok(b.length > 300, 'une image, pas un vide : ' + f);
  }
});

test('au catalogue sous JamaJama, et distribués par personne pour l’instant', () => {
  assert.match(SERVEUR, /GAME_ITEM_INFO\[`\$jama_picto\$\{n\}`\] = \{ name: nom, game: 'JamaJama', gif: `Games\/poulpi\/titems\/jama\$\{n\}\.png` \}/);
  assert.ok(!/gameItems\.push\([^)]*jama_picto/.test(SERVEUR), 'aucune distribution automatique');
  assert.match(SERVEUR, /totalPictos: 28/);
});
