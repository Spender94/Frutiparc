'use strict';
/*
 * UNE BOUILLE NE RESTE PAS DANS L'AQUARIUM : ELLE Y PASSE.
 *
 * En mode CLB — un seul écran pour tout le salon, celui de la fenêtre étroite
 * dès qu'on est deux — les bouilles de ceux qui s'expriment entrent par la
 * gauche. Elles y restaient : on ne voyait plus que des vignettes figées,
 * chassées une par une par le quatrième arrivant (`maxContent` = 3).
 *
 * `cp.FrutiScreen.onAction` (0x62245) dit ce qui manquait — l'ordre de PARTIR,
 * posé sur la bouille au moment même où on lui fait jouer son émotion :
 *
 *     content.action(o.id, o.length);
 *     if (this.flCLB) {                       ← en CLB, et SEULEMENT là
 *       content.actionCallBack = { obj: this,
 *                                  method: "launchIntoTheSpace",
 *                                  args: content };
 *     }
 *
 * `actionCallBack` se déclenche à la FIN de l'animation. `launchIntoTheSpace`
 * (0x62565) repose `pos = {x: −minSide, y: _y}` et confie le trajet à
 * `animList.addSlide(content, "contentSlide" + user, 1.5, {obj, method:
 * "removeCLBContent", args: content})` ; au bout du glissement,
 * `removeCLBContent` (0x625ee) la `splice` de `contentList` et la
 * `removeMovieClip`.
 *
 * EN MODE MULTI, RIEN DE TEL : l'écran appartient à son titulaire
 * (`attachFrutiScreen` 0xb646f), il n'a pas à s'en aller.
 *
 * DEUX MOMENTS l'appellent ici, parce que le light n'a qu'UN lecteur par
 * fenêtre là où l'époque en avait un par bouille :
 *   · la fin du minuteur — l'animation est allée à son terme ;
 *   · l'arrivée d'une AUTRE émotion, qui prend le lecteur — celle d'avant est
 *     interrompue, donc finie elle aussi. C'est ce cas-là qui laissait
 *     « parfois » une bouille en plan.
 *
 * Éprouvé au banc : une prise de parole, l'aquarium se vide 4,2 s plus tard ;
 * deux émotions coup sur coup, il se vide aussi.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const JS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.js'), 'utf8');
const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');

const BLOC = JS.slice(JS.indexOf('function finirEmote(ecran)'),
  JS.indexOf('function bouilleDe(pseudo, panneau)'));

test('le rappel de départ ne vaut qu’en CLB', () => {
  assert.match(BLOC, /if \(!ecran \|\| !ecran\.classList\.contains\('bo-clb'\)\) return;/);
  assert.match(BLOC, /if \(ecran\.parentNode\) partirDansLEspace\(ecran, ecran\.parentNode\);/);
  assert.match(JS, /finirEmote: finirEmote,/);
});

test('la bouille repart par la gauche, puis disparaît', () => {
  const p = JS.slice(JS.indexOf('function partirDansLEspace'), JS.indexOf('/*\n   * UNE BOUILLE'));
  assert.match(p, /b\.style\.left = \(-Math\.min\(ec\.clientWidth, ec\.clientHeight\)\) \+ 'px';/);
  assert.match(p, /setTimeout\(function \(\) \{ if \(b\.parentNode\) b\.remove\(\); \}, 700\);/);
  // `rendreScene` AVANT le départ : le lecteur ne part pas avec elle.
  assert.match(p, /b\.classList\.add\('part'\);\s*\n\s*rendreScene\(b\);/);
});

test('les deux moments qui terminent une action', () => {
  const bloc = LIGHT.slice(LIGHT.indexOf('var colonne = noeudChat(c, "bouille-overlay");'),
    LIGHT.indexOf('var box = noeudChat(c, "bouille-overlay");'));
  // Celle qu'on interrompt — et jamais celle qui va jouer.
  assert.match(bloc, /if \(deja\[i2\] !== ecran && BureauFrutiz\.finirEmote\) BureauFrutiz\.finirEmote\(deja\[i2\]\);/);
  // Et la fin du minuteur.
  assert.match(bloc, /overlayEteindre\(c\);[\s\S]{0,400}?if \(BureauFrutiz\.finirEmote\) BureauFrutiz\.finirEmote\(ecran\);/);
});

test('le débordement d’époque reste, il ne remplace rien', () => {
  // `maxContent` = 3 : au quatrième, la plus ancienne repart aussi.
  assert.match(JS, /var CLB_MAX = 3;/);
  assert.match(JS, /if \(tous\.length > CLB_MAX\) partirDansLEspace\(tous\[0\], ec\);/);
  // Et une bouille déjà partie ne compte plus dans le quota.
  assert.match(JS, /var tous = ec\.querySelectorAll\('\.bo-clb:not\(\.part\)'\);/);
});
