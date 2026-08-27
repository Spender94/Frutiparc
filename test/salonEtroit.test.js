'use strict';
/*
 * UNE CONVERSATION S'OUVRE ÉTROITE
 *
 * Le portage ouvrait chaque fenêtre de salon à 780 × 580 — plus large que la
 * moitié du bureau, et déjà flanquée de sa liste de connectés. Le SWF n'en
 * fait rien de tel.
 *
 * `win.Chat` n'écrit AUCUN `pos` : ni son `init` (0x69154), ni celui de
 * `win.Dialog` (0x68ac3) au-dessus, ni `win.Advance` au-dessus encore. Le
 * `pos` de `WinStandard.init` (0x53807) reste donc `{0, 0, 0, 0}`, et c'est
 * `recal` (0x5411f) qui en fait une fenêtre réelle :
 *
 *     pos.w = max(minimum.w, min(mcw - cornerX, 0))   →   minimum.w
 *     pos.h = max(minimum.h, min(mch - cornerY, 0))   →   minimum.h
 *
 * Une conversation s'ouvre donc AU MINIMUM DE SON CONTENU, dans le coin.
 *
 * Et ce minimum est celui d'un salon NU, parce que `win.Chat.init` commence
 * par fermer ses trois panneaux :
 *
 *     this.flPenList = false; this.flUserList = false; this.flScreenList = false;
 *
 * Le portage, lui, appelait `ouvrirTiroir(true)` à la construction du cadre :
 * les connectés à eux seuls ajoutaient cent-vingt-huit pixels, et la fenêtre
 * ne pouvait pas descendre sous 276. La liste est maintenant REMPLIE mais
 * REFERMÉE — un clic la montre, et la fenêtre grandit alors d'elle-même par
 * `appliquerMinimum`, exactement comme sous Ruffle.
 *
 * Reste la LARGEUR D'OUVERTURE : 220 px. Le plancher du bandeau-titre en
 * donne 202 ; 220 est la valeur demandée, et `recal` la garde puisqu'elle est
 * au-dessus du minimum. Mesuré au banc : 220 × 156 posés en (9, 106), puis
 * 276 dès qu'on ouvre les connectés.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const JS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.js'), 'utf8');
const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');

test('la fenêtre d’un salon s’ouvre à 220 px, la hauteur venant du minimum', () => {
  assert.match(JS, /l: 220, h: 0, min: function \(\) \{ return minSalon\(panneau\); \},/);
  assert.doesNotMatch(JS, /l: 780, h: 580/);
});

test('recal borne la TAILLE d’ouverture, pas seulement la place', () => {
  // Sans ces deux lignes, `h: 0` donnerait une fenêtre de zéro pixel de haut :
  // le minimum ne jouait qu'à la poignée.
  assert.match(JS, /fen\.style\.width = Math\.round\(fen\._entree\.w\) \+ 'px';/);
  assert.match(JS, /fen\.style\.height = Math\.round\(fen\._entree\.h\) \+ 'px';/);
});

test('les trois panneaux du salon sont fermés à l’ouverture', () => {
  // `win.Chat.init` (0x6915f) : flPenList, flUserList, flScreenList à faux.
  assert.match(LIGHT, /ouvrirTiroir\(false\);/);
  assert.match(LIGHT, /majConnectesCadre\(c\);\s*\n\s*\}/);
  // La copie du panneau repart déjà barres refermées pour les deux autres.
  assert.match(LIGHT, /\["#pen-btn", "#users-btn", "#accent-toggle"\]\.forEach/);
});

test('aucune autre fenêtre ne rétrécit : leur gabarit reste au-dessus de leur minimum', () => {
  // `recal` ne peut que RELEVER une taille déclarée. On vérifie qu'aucune
  // rubrique ne s'ouvrait sous son propre minimum — sinon la nouvelle règle
  // les ferait grandir, ce qui serait un changement de comportement muet.
  const min = (w, h) => ({ w: Math.max(200, w + 12), h: h + 26 });
  const attendus = [
    [610, 328, min(160 + 300, 200)],   // scores
    [476, 404, min(140 + 300, 200)],   // boutique
    [560, 620, min(140 + 200, 200)],   // réglages
    [265, 288, min(200, 240)],         // salons publics
    [314, 246, min(300, 200)],         // événements / historique
    [412, 402, min(100, 28 + 100)],    // messagerie
    [402, 402, min(100, 28 + 100)],    // explorateurs
    [260, 130, min(200, 80 + 24)],     // win.Alert
  ];
  for (const [l, h, m] of attendus) {
    assert.ok(l >= m.w, l + ' est sous le minimum ' + m.w);
    assert.ok(h >= m.h, h + ' est sous le minimum ' + m.h);
  }
});
