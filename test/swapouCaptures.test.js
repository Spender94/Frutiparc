'use strict';
/*
 * SWAPOU — LES COUPS À GROS COMBO, plateau à l'appui.
 *
 * « J'aimerais récupérer des captures de leur partie dès qu'ils réalisent un
 * cocktail swapolotof, voir le coup joué et évaluer s'il est humain. » Le
 * serveur rejoue déjà chaque partie : il reconstitue donc le plateau d'avant
 * le coup (rien ne vient du navigateur du joueur), avec la rangée jouée et le
 * temps de réflexion.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const A = require('./aideSwapou.js');
const R = require('../swapouRejeu.js');

test('le rejeu rend le plateau d’avant chaque coup à gros combo, et le coup lui-même', () => {
  const p = A.jouer(A.bac(), { id: 'capt', graine: 4242 }, 0, {});
  const sans = R.rejouer({ graine: 4242, coups: p.pf.coups, perso: 0 });
  assert.equal(sans.captures, undefined, 'rien sans le demander');
  const r = R.rejouer({ graine: 4242, coups: p.pf.coups, perso: 0 }, { captures: { seuil: 3 } });
  assert.equal(r.ok, true);
  assert.equal(r.score, sans.score, 'la partie se rejoue pareil');
  // Autant de captures que de chaînes arrivées au seuil ou au-delà.
  const attendu = r.combos.slice(3).reduce((a, n) => a + n, 0);
  assert.ok(attendu >= 1, 'la partie de banc a de gros combos');
  assert.equal(r.captures.length, attendu);
  const coups = R.lireCoups(p.pf.coups);
  for (const c of r.captures) {
    assert.ok(c.combo >= 3);
    const joue = coups[c.coup - 1];
    assert.deepEqual([joue.t, joue.x, joue.y, joue.ms], ['s', c.x, c.y, c.ms], 'le coup du journal');
    const lignes = c.grille.split('/');
    assert.deepEqual([lignes.length, lignes[0].length], [14, 12], 'quatorze rangées de douze, du haut vers le bas');
    assert.notEqual(lignes[c.y][c.x], '.', 'un fruit sous la première case échangée');
  }
  assert.deepEqual([...new Set(r.captures.map((c) => c.coup))].length, r.captures.length, 'un coup, une capture');
});

test('l’admin a son bouton, sa route et sa fenêtre', () => {
  const ROOT = path.join(__dirname, '..');
  const SRV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const ADM = fs.readFileSync(path.join(ROOT, 'public/admin.html'), 'utf8');
  assert.match(SRV, /app\.get\('\/api\/admin\/swapou\/parties\/:id\/captures', adminAuth,/);
  assert.match(SRV, /type: 'captures', graine: Number\(p\.graine\), coups: p\.coups, perso: p\.perso, seuil/);
  assert.match(ADM, /onclick="swapouCoups\('\$\{p\.id\}'\)">Coups<\/button>/);
  assert.match(ADM, /id="modal-swapou-coups"/);
});
