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
    // Les peaux (les vraies images du jeu, pour l'admin) : même plateau, deux
    // caractères par case, vides aux mêmes endroits.
    const peaux = c.peaux.split('/');
    assert.equal(peaux.length, lignes.length);
    peaux.forEach((l, y) => {
      assert.equal(l.length, lignes[y].length * 2);
      for (let x = 0; x < lignes[y].length; x++) {
        const pe = l.substr(x * 2, 2);
        assert.equal(pe === '..', lignes[y][x] === '.', 'case ' + x + ',' + y);
        if (pe !== '..') assert.match(pe, /^(f[0-9a]|[gme][0-2])$/);
      }
    });
    assert.deepEqual([lignes.length, lignes[0].length], [14, 12], 'quatorze rangées de douze, du haut vers le bas');
    assert.notEqual(lignes[c.y][c.x], '.', 'un fruit sous la première case échangée');
  }
  assert.deepEqual([...new Set(r.captures.map((c) => c.coup))].length, r.captures.length, 'un coup, une capture');
});

test('le film : la partie entière, une image par coup (plateau, score, étoiles) et la fin', () => {
  const p = A.jouer(A.bac(), { id: 'film', graine: 4243 }, 2, {});
  const r = R.rejouer({ graine: 4243, coups: p.pf.coups, perso: 2 }, { film: true });
  assert.equal(r.ok, true);
  const f = r.film;
  const coups = R.lireCoups(p.pf.coups);
  const n = coups.length;
  assert.equal(f.coups.length, n);
  assert.deepEqual(f.coups[0], coups[0], 'les coups du journal, réflexion comprise');
  assert.equal(f.plateaux.length, n + 1, 'le plateau d’avant chaque coup, et celui de la fin');
  assert.deepEqual([f.scores.length, f.etoiles.length, f.combos.length], [n + 1, n + 1, n]);
  assert.equal(f.scores[0], 0);
  assert.equal(f.scores[n], r.score, 'le film finit au score rejoué');
  for (let k = 0; k < n; k++) assert.ok(f.scores[k + 1] >= f.scores[k], 'le score ne recule pas');
  assert.ok(f.etoiles.every((e) => e >= 0 && e <= f.etoilesMax));
  assert.equal(f.etoilesMax, 6);
  assert.ok(f.prixDefense >= 1 && typeof f.perso === 'string' && f.perso);
  // Le plus haut combo de chaque coup : autant de coups à combo que le
  // relevé des combos en compte au plus haut de chaque chaîne.
  assert.ok(f.combos.every((c) => c >= -1 && c < R.NB_COMBOS));
  assert.ok(f.combos.some((c) => c >= 0), 'des combos dans la partie');
  // Le plateau d'avant un gros combo est celui des captures.
  const capt = R.rejouer({ graine: 4243, coups: p.pf.coups, perso: 2 }, { captures: { seuil: 0 } }).captures;
  for (const c of capt) assert.equal(f.plateaux[c.coup - 1], c.peaux, 'coup ' + c.coup);
  assert.equal(R.rejouer({ graine: 4243, coups: p.pf.coups, perso: 2 }).film, undefined, 'rien sans le demander');
});

test('l’accord garde son détail coup par coup : rang du coup joué, et coup de l’IA', () => {
  const p = A.jouer(A.bac(), { id: 'acc', graine: 4244 }, 0, {});
  const r = R.rejouer({ graine: 4244, coups: p.pf.coups, perso: 0 }, { analyse: { budgetMs: 20 } });
  const n = R.lireCoups(p.pf.coups).length;
  assert.equal(r.accord.detail.length, n);
  for (const [rang, sur, ia] of r.accord.detail) {
    assert.ok(rang >= 0 && rang <= sur, 'un rang dans le classement');
    assert.match(ia, /^(d|\d+,\d+,-?[01],-?[01])?$/, 'le coup préféré de l’IA : défense ou échange');
  }
});

test('l’admin a son bouton, sa route et sa fenêtre', () => {
  const ROOT = path.join(__dirname, '..');
  const SRV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const ADM = fs.readFileSync(path.join(ROOT, 'public/admin.html'), 'utf8');
  assert.match(SRV, /app\.get\('\/api\/admin\/swapou\/parties\/:id\/captures', adminAuth,/);
  assert.match(SRV, /type: 'captures', graine: Number\(p\.graine\), coups: p\.coups, perso: p\.perso, seuil/);
  assert.match(ADM, /onclick="swapouCoups\('\$\{p\.id\}'\)">Coups<\/button>/);
  assert.match(ADM, /id="modal-swapou-coups"/);
  // Revoir la partie entière.
  assert.match(SRV, /app\.get\('\/api\/admin\/swapou\/parties\/:id\/film', adminAuth,/);
  assert.match(SRV, /type: 'film', graine: Number\(p\.graine\), coups: p\.coups, perso: p\.perso/);
  assert.match(ADM, /onclick="swapouFilm\('\$\{p\.id\}'\)">Revoir<\/button>/);
  assert.match(ADM, /id="modal-swapou-film"/);
});
