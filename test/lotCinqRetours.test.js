'use strict';
/*
 * QUATRE RETOURS DU MÊME LOT — et ce que le banc a dit de chacun.
 *
 * Trois d'entre eux se sont révélés autre chose que ce qu'ils annonçaient :
 * on les a donc MESURÉS avant d'y toucher (scratchpad/bench-cinq.js,
 * diag-gaspard.js), et c'est la mesure qui a désigné le coupable.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const CSS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.css'), 'utf8');
const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
const SERVEUR = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

/* ── 1. LA TYPO DES JOURNAUX ──────────────────────────────────────────────── */

test('les journaux du bureau gagnent un pixel', () => {
  // « Grossis d'un px la taille des typos dans historique et évènements. »
  // Le portage était descendu à 9 px pour tenir dans la case de 60 ; on remonte
  // à 10, et l'interligne suit (13) pour que trois lignes y tiennent encore.
  assert.match(CSS, /#evt-panel \.evt-item \.txt \{[\s\S]*?font-size: 10px; line-height: 13px;/);
  assert.match(CSS, /#evt-panel \.evt-item\.neuf \.txt \{ font-weight: 700; font-size: 10px; \}/);
  // Et l'écart au relevé est nommé, comme tout écart assumé.
  assert.match(CSS, /ÉCART ASSUMÉ : 10 px, pas les 12 d'époque ni les 9 du premier portage/);
});

test('le mobile garde sa typo', () => {
  // La consigne vise le bureau ; le gabarit tactile ne bouge pas.
  assert.match(LIGHT, /\.evt-item \.txt \{\n\s+flex: 1 1 auto; min-width: 0; font-size: 12\.5px;/);
  assert.match(LIGHT, /\.evt-item\.neuf \.txt \{ font-weight: bold; font-size: 13\.5px; \}/);
});

/* ── 2. L'HEURE HORS CHALLENGE ────────────────────────────────────────────── */

test('un classement permanent n’a pas de colonne « Heure »', () => {
  // Mesuré au banc AVANT : l'en-tête « Heure » était posé sur les classements
  // permanents, suivi de trois cases vides — le serveur y envoie déjà `time:''`.
  assert.match(LIGHT, /var avecHeure = !g\.allTime;/);
  assert.match(LIGHT, /box\.classList\.toggle\("sans-heure", !avecHeure\);/);
  // L'en-tête ET la cellule disparaissent ensemble.
  assert.match(LIGHT, /\+ \(avecHeure \? '<span class="h">Heure<\/span>' : ""\) \+ '<\/div>';/);
  assert.match(LIGHT, /\+ \(avecHeure \? '<span class="h">' \+ xmlEscape\(s\.time \|\| ""\) \+ '<\/span>' : ""\)/);
  // …et la piste de 38 px avec elles, sinon le score flotterait loin du bord.
  // (La première piste est `--sc-rang` : 25, 35 ou 45 px selon le plus grand
  // rang de la page, comme `win.Score.display` le calcule — cf. 0xc3132.)
  assert.match(LIGHT, /#sc-table\.sans-heure \.sc-entete,\n\s+#sc-table\.sans-heure \.sc-ligne \{\n\s+grid-template-columns: var\(--sc-rang, 25px\) 20px minmax\(0,1fr\) auto var\(--sc-annexes, \);/);
});

/* ── 3. LE TZONGRE DE KALUGA ──────────────────────────────────────────────── */

test('les deux classements Kaluga ont la colonne Tzongre', () => {
  // `LEGACY_RANKINGS` ne connaît que `kaluga_classic` (rk 4) : c'est le seul
  // qui existait en 2005. « Freestyle », né du partage avec/sans grappe,
  // n'était dans aucun descripteur — donc AUCUNE colonne annexe, et pas de
  // tzongre sur ce tableau-là. Il emprunte celui de `kaluga_classic`, comme
  // les circuits de Burning Kiwi empruntent celui de rk '0'.
  const f = /function scoreDataSpecFor\(rankingId\) \{[\s\S]*?\n\}/.exec(SERVEUR);
  assert.ok(f, 'scoreDataSpecFor doit exister');
  assert.match(f[0], /\/\^kaluga_\/\.test\(id\) \? 'kaluga_classic'/);
  assert.match(f[0], /\/\^bkiwi_\/\.test\(id\) \? 'bkiwi_track5_classic'/);
  // La colonne d'époque est bien celle du `gs` 4.
  assert.match(SERVEUR, /4: \[\{ n: 'Tzongre', w: 60, lib: 'kaluga_tz' \}\],/);
});

test('une donnée de tzongre illisible se DIT', () => {
  // L'image « inconnu » de `kaluga_tz` est VIDE d'époque (`error = true` →
  // image 10) : une donnée qu'on ne sait pas lire laisse donc une case
  // blanche, et l'on croit la colonne cassée. La trace nomme la donnée brute,
  // seule façon de reconnaître une forme inattendue et de l'ajouter.
  assert.match(SERVEUR, /\[KALUGA\] donnée de tzongre non reconnue/);
});

/* ── 4. L'INDEX DE GASPARD ────────────────────────────────────────────────── */

test('la page de Gaspard tient dans sa fenêtre', () => {
  /* « Rien ne se passe quand je clique sur les liens. »
     Ce n'était ni l'écouteur ni les liens : `.gs-page` ENJAMBE les rangées 1
     et 2, et une piste `auto` qu'on enjambe se laisse gonfler par le contenu
     de celui qui l'enjambe. La page poussait la grille au-delà de la fenêtre
     au lieu de défiler dedans, son `overflow-y: auto` ne mordait jamais, et
     ses liens finissaient peints sous la barre de saisie puis hors du cadre —
     relevé au banc, `elementFromPoint` sur le deuxième lien renvoyait
     `div#bureau`. La rangée 1 ne sert qu'à la colonne d'icônes COUCHÉE : on la
     fixe à 0, puis à 24 dans cet état. Après quoi le banc mesure
     `grid-template-rows: 0px 200px 20px`, `scrollHeight 284 > clientHeight
     196`, et le clic sur un lien part vraiment en `/fh/get?i=…`. */
  assert.match(CSS, /\.fen #gaspard-panel \{[\s\S]*?grid-template-rows: 0 minmax\(0, 1fr\) auto;/);
  assert.match(CSS, /\.fen #gaspard-panel\.gs-a-ecrans \{\n\s+grid-template-rows: 24px minmax\(0, 1fr\) auto;\n\}/);
  // La page reste sur les deux premières rangées : la géométrie ne bouge pas.
  assert.match(CSS, /#gaspard-panel \.gs-page\s+\{ grid-area: 1 \/ 2 \/ 3 \/ 3; \}/);
  // Et elle défile toujours par elle-même.
  assert.match(CSS, /#gaspard-panel \.gs-page \{\n\s+min-height: 0; min-width: 0; overflow-y: auto;/);
});
