'use strict';
/*
 * L'AQUARIUM : CE QUI Y ENTRE EN RESSORT.
 *
 * `cp.FrutiScreen.onAction` (0x62245) pose l'ordre de départ SUR LE CONTENU,
 * pas sur l'écran :
 *
 *     content.action(o.id, o.length);
 *     if (this.flCLB) {
 *       content.actionCallBack = { obj: this, method: "launchIntoTheSpace",
 *                                  args: content };
 *     }
 *
 * — et il se déclenche à la fin de SON animation, quoi qu'il arrive ailleurs.
 *
 * LE PORTAGE N'AVAIT QU'UN MINUTEUR PAR FENÊTRE (`overlayMinuteur`), parce
 * qu'il n'a qu'un lecteur par fenêtre. Chaque nouvelle émotion l'écrasait, et
 * la bouille précédente ne comptait plus que sur la boucle `.bo-anime` de
 * `showBouilleOverlay` pour être renvoyée. Rater ce rendez-vous une fois — la
 * colonne des bouilles refermée puis rouverte, une émotion venue d'un salon
 * dont la fenêtre est fermée, les bouilles coupées dans les préférences — et
 * la bouille restait là indéfiniment : plus personne n'avait de raison de la
 * faire partir.
 *
 * Mesuré au banc (Playwright, trois comptes, `banc-aqua-reel.js`), sur le
 * scénario « elle entre, on referme la colonne, deux autres parlent, on
 * rouvre » :
 *
 *   sans minuteur par bouille : +6 s après → elle est TOUJOURS là, `[anime]`
 *   avec                      : +6 s après → l'aquarium est VIDE
 *
 * Le cas ordinaire est inchangé : trois qui parlent, puis silence, et sept
 * secondes plus tard l'aquarium est vide.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const JS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.js'), 'utf8');
const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');

test('chaque bouille porte son propre ordre de départ', () => {
  // `content.actionCallBack` : posé sur la bouille, armé à chaque prise de
  // parole (reparler relance l'animation, donc le compte à rebours).
  assert.match(JS, /function armerDepart\(b, ec\) \{\s*\n\s*if \(b\.bfEmote\) clearTimeout\(b\.bfEmote\);\s*\n\s*b\.bfEmote = setTimeout\(/);
  assert.match(JS, /if \(b\.parentNode\) partirDansLEspace\(b, b\.parentNode\);\s*\n\s*\}, EMOTE_MS\);/);
  // armé DANS `clbAccueille`, à chaque passage
  assert.match(JS, /b\.style\.left = '0px';\s*\n(?:\s*\/\/[^\n]*\n)*\s*armerDepart\(b, ec\);/);
});

test('le compte à rebours vaut celui de l’émotion du light', () => {
  const bureau = /var EMOTE_MS = (\d+);/.exec(JS);
  const light = /var OVERLAY_HOLD_MS = (\d+);/.exec(LIGHT);
  assert.ok(bureau && light, 'les deux constantes doivent exister');
  assert.strictEqual(bureau[1], light[1],
    'EMOTE_MS (' + bureau[1] + ') doit valoir OVERLAY_HOLD_MS (' + light[1] + ')');
});

test('une bouille qui part n’a plus de compte à rebours', () => {
  // Sinon son minuteur la ferait « repartir » une seconde fois, et
  // `partirDansLEspace` s'en protège certes, mais le timer traînerait.
  assert.match(JS, /function partirDansLEspace\(b, ec\) \{\s*\n\s*if \(b\.classList\.contains\('part'\)\) return;\s*\n\s*if \(b\.bfEmote\) \{ clearTimeout\(b\.bfEmote\); b\.bfEmote = null; \}/);
});

test('les deux autres chemins de départ restent branchés', () => {
  // Le débordement (`maxContent = 3`)…
  assert.match(JS, /var tous = ec\.querySelectorAll\('\.bo-clb:not\(\.part\)'\);\s*\n\s*if \(tous\.length > CLB_MAX\) partirDansLEspace\(tous\[0\], ec\);/);
  // …et l'interruption par une autre émotion, côté light.
  assert.match(LIGHT, /if \(deja\[i2\] !== ecran && BureauFrutiz\.finirEmote\) BureauFrutiz\.finirEmote\(deja\[i2\]\);/);
  assert.match(LIGHT, /if \(BureauFrutiz\.finirEmote\) BureauFrutiz\.finirEmote\(ecran\);/);
});
