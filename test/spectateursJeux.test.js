'use strict';
/*
 * LES SPECTATEURS DE GRAPIZ ET DE FRUTIBANDAS
 * ═══════════════════════════════════════════
 *
 * Comme dans le Frutiparc d'origine, on peut regarder une partie en cours sans
 * y jouer — et désormais au Challenge aussi. Les « cervelles » des deux jeux
 * ont leurs propres tests, écrits à l'ancienne dans leur dossier (un script
 * qui compte ses réussites et sort en erreur au premier échec) : ils ne
 * tournaient qu'à la main. On les lance ici, pour qu'ils fassent partie de la
 * suite — ce sont eux qui verrouillent le spectateur :
 *
 *   · watch/unwatch, les refus (joueur de la partie, occupé, autre salle) ;
 *   · l'état reçu par l'observateur, marqué sp="1", et la liste <live> du salon ;
 *   · Frutibandas : ce qui est caché (pièges, désordre, confiscation) le reste
 *     pour l'observateur comme pour l'adversaire ;
 *   · le chat de la partie : l'observateur le lit, n'y écrit pas ;
 *   · créer, rejoindre, être défié ou se déconnecter arrête de regarder ;
 *   · la fin de partie parvient aux observateurs, puis tout est rangé.
 *
 * On vérifie aussi que les deux clients branchent bien ce protocole.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
function lancer(rel) {
  const r = spawnSync(process.execPath, [path.join(ROOT, rel)], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  assert.strictEqual(r.status, 0, rel + ' : ' + (r.stdout || '').trim().slice(-600) + (r.stderr || '').trim().slice(-400));
  return r.stdout;
}

test('Frutibandas : les tests du serveur passent (spectateurs compris)', () => {
  assert.match(lancer('public/bandas/server/server.test.js'), /0 failed/);
});
test('Grapiz : les tests du pont réseau passent (spectateurs compris)', () => {
  lancer('public/grapiz/server/net.test.js');
});
test('Grapiz : les tests des cervelles passent', () => {
  lancer('public/grapiz/server/server.test.js');
});

test('les clients branchent le spectateur : « Regarder », quitter, chat muet', () => {
  const grapiz = fs.readFileSync(path.join(ROOT, 'public/grapiz/index.html'), 'utf8');
  const bandas = fs.readFileSync(path.join(ROOT, 'public/bandas/ui.js'), 'utf8');
  const vue = fs.readFileSync(path.join(ROOT, 'public/bandas/gameview.js'), 'utf8');
  for (const [nom, src] of [['grapiz', grapiz], ['bandas', bandas]]) {
    assert.match(src, /a: "watch"/, nom + ' : demande à regarder');
    assert.match(src, /a: "unwatch"|"unwatch"/, nom + ' : cesse de regarder');
    assert.match(src, /getElementsByTagName\("live"\)/, nom + ' : lit les parties en cours');
    assert.match(src, /spectator-mute/, nom + ' : gère le chat muet');
    assert.match(src, /Parties en cours/, nom + ' : liste les parties en cours');
  }
  assert.match(grapiz, /getAttribute\("sp"\) === "1"/);
  assert.match(vue, /getAttribute\("sp"\) === "1"/);
  assert.match(vue, /Les observateurs ne peuvent parler dans cette partie/);
});
