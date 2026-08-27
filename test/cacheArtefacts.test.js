'use strict';
/*
 * CE QUI NE CHANGE PAS NE SE REDEMANDE PAS.
 *
 * « On m'informe que le mode light est plus lent que le mode flash/Ruffle. »
 * Il l'était, et pour une raison qui n'a rien à voir avec le portage lui-même.
 *
 * `express.static` sans options pose `Cache-Control: max-age=0`. Le navigateur
 * garde bien le fichier, mais REDEMANDE au serveur, à chaque chargement, s'il
 * a changé : une requête, une réponse « 304 Non modifié », zéro octet utile —
 * et il faut la faire pour chacun. Le bureau light en faisait deux cent
 * quatre-vingts.
 *
 * Relevé au banc (Chromium, octets réellement passés sur le réseau, second
 * chargement avec le cache déjà chaud) :
 *
 *     avant   303 réponses, 303 vont au serveur, dont 280 revalidations
 *     après   303 réponses, 280 servies par le CACHE, 23 vont au serveur
 *
 * Les 23 qui restent sont la page, ses scripts, sa feuille de style et les
 * appels d'API : eux DOIVENT être frais. Sur la boucle locale l'écart se lit à
 * peine ; chez un joueur, chaque aller-retour vaut sa latence — à 40 ms et six
 * connexions parallèles, 280 revalidations font près de deux secondes avant que
 * le bureau paraisse, à chaque visite. Au téléphone, en 4G, le double.
 *
 * Ruffle, lui, avait déjà `maxAge: '7d', immutable` sur son moteur. On ne fait
 * qu'accorder aux dessins du portage ce qu'on accordait au lecteur Flash.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SERVEUR = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

test('les dossiers d’artefacts se gardent une semaine', () => {
  assert.match(SERVEUR, /const CACHE_ARTEFACTS = \{ maxAge: '7d', immutable: true \};/);
  for (const [route, dossier] of [
    ["'/frutiz/sprites'", "'public', 'frutiz', 'sprites'"],
    ["'/frutiz/fontes'", "'public', 'frutiz', 'fontes'"],
    ["'/snake3/fontes'", "'public', 'snake3', 'fontes'"],
    ["'/fb'", "'public', 'fb'"],
  ]) {
    const re = new RegExp('app\\.use\\(' + route.replace(/[/]/g, '\\/')
      + ',\\s*\\n?\\s*express\\.static\\(path\\.join\\(__dirname, ' + dossier
      + '\\), CACHE_ARTEFACTS\\)\\);');
    assert.match(SERVEUR, re, 'montage manquant ou sans cache : ' + route);
  }
});

test('ils sont montés AVANT le montage général', () => {
  // `express.static(public)` sert les mêmes fichiers sans cache : monté avant,
  // il gagnerait, et les en-têtes ne serviraient à rien.
  const iArtefacts = SERVEUR.indexOf('app.use(\'/frutiz/sprites\'');
  const iGeneral = SERVEUR.indexOf("app.use(express.static(path.join(__dirname, 'public')));");
  assert.ok(iArtefacts > 0 && iGeneral > 0, 'les deux montages doivent exister');
  assert.ok(iArtefacts < iGeneral,
    'les dossiers d’artefacts passent avant le montage général');
});

test('la page et ses scripts, eux, restent frais', () => {
  // Ils doivent pouvoir changer à chaque déploiement : aucun cache long ne
  // doit les couvrir. Le montage général reste donc sans options.
  assert.match(SERVEUR, /app\.use\(express\.static\(path\.join\(__dirname, 'public'\)\)\);/);
  // Et rien ne met light.html, les scripts ou la feuille sous CACHE_ARTEFACTS.
  // Les montages tiennent sur deux lignes : la route, puis le dossier.
  const montages = SERVEUR.match(/app\.use\('[^']+',\s*\n\s*express\.static\([^\n]*CACHE_ARTEFACTS\)\);/g) || [];
  for (const m of montages) {
    assert.ok(!/'public'\)\)/.test(m), 'le dossier public entier ne doit pas être figé');
    assert.ok(!/light\.html|bureau-frutiz/.test(m), 'ni la page ni ses scripts : ' + m);
  }
  assert.strictEqual(montages.length, 4, 'quatre dossiers, pas un de plus');
});

test('la compression des textes est toujours là', () => {
  // Les 421 Ko du premier chargement sont déjà du gzip : la page fait 446 Ko
  // en clair et 137 sur le réseau. C'est l'autre moitié du travail, et elle
  // était déjà faite — on vérifie qu'elle le reste.
  assert.match(SERVEUR, /app\.use\(compression\(\{/);
  assert.match(SERVEUR, /threshold: 1024,/);
});
