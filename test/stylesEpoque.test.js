'use strict';
/*
 * QUATRE ORNEMENTS QUE L'ÉPOQUE N'AVAIT PAS.
 *
 * 1. « … VOIR LES MESSAGES PRÉCÉDENTS … » ÉTAIT UN LIEN DE NAVIGATEUR.
 *    `box.Chat.onIamMode` (0x316e1) ne fait qu'un `addText` :
 *
 *        addText("<a href=\"javascript:fp_openHisto('" + sid + "','"
 *                + group + "')\">... voir les messages précédents ...</a>")
 *
 *    et `addText` (0xb6d1c) n'ajoute QUE la couleur du composant —
 *    `"<font color=\"#" + col + "\">" + str + "</font>"` — plus un `<b>` si
 *    `flBold`, qui ne l'est pas. Pas d'italique : celui de « Vous discutez
 *    maintenant sur le salon $t » vient du `<i>` de la table de langue
 *    (`chat.onjoin`), pas du composant. Et Flash ne souligne pas les `<a>`.
 *
 * 2. LE PSEUDO DE QUI ÉCRIT ÉTAIT ROSE. `addText` peint la ligne entière
 *    d'une seule encre et `onTrace` ne distingue jamais l'auteur du lecteur.
 *
 * 3. `/blueon` ET « !message » FAISAIENT LA MÊME TAILLE. `cp.Chat.onTrace`
 *    (0x2f533 et suivants) compose les deux modes séparément :
 *
 *        t == "w"  →  penRedMode       "<b>" + msg + "</b>"
 *        t == "c"  →  penBlueAnimator  "<font size=\"14\"><b>" + msg
 *                                      + "</b></font>"
 *
 *    Le cri de modération reste au corps du fil (12), le bleu monte à 14. Le
 *    light le savait (`.msg.blue { font-size: 1.1667em }`) mais la règle du
 *    bureau, plus spécifique, ramenait TOUTE ligne à 12.
 *
 * 4. LA BOUTIQUE GRISAIT LES ARTICLES DÉJÀ ACHETÉS. L'arbre d'époque n'en
 *    sait rien : une capsule tient sa couleur du PANNEAU et de lui seul
 *    (`Capsule.fadeIn` 0x9f147 → `FEMC.setPColor(this, c, 0)`), et
 *    `box.Shop.analyseTree` ne pose sur `<c>` et `<p>` qu'un `bulletLink`.
 *
 * LES QUATRE CORRECTIFS SONT SOUS `body.bureau-frutiz` : c'est le bureau
 * qu'on remet d'aplomb, le tiroir mobile ne bouge pas.
 *
 * Mesuré au banc : lien normal/400/none et de l'encre de la ligne système,
 * bleu 14 px contre 12 pour le cri et le fil, mon pseudo `rgb(44,74,15)`
 * comme celui des autres, et les deux articles de la boutique noirs.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const CSS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.css'), 'utf8');
const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');

test('le lien des logs est une ligne comme une autre', () => {
  assert.match(CSS, /#messages \.sys-lien \{\s*\n\s*font-style: normal; font-weight: normal; text-decoration: none; color: inherit;/);
  // Le tiroir mobile garde son lien de navigateur.
  assert.match(LIGHT, /\.sys-lien \{[\s\S]{0,200}text-decoration: underline;/);
});

test('l’italique de « Vous discutez » vient de la table de langue', () => {
  // Ce n'est donc pas au composant de le poser — d'où le `normal` du lien.
  assert.match(LIGHT, /chat\.onjoin\s+= "<i>Vous discutez maintenant sur le salon \$t<\/i>"/);
});

test('mon pseudo a l’encre commune, sauf là où toute la ligne est teintée', () => {
  assert.match(CSS, /#messages \.msg:not\(\.blue\):not\(\.shout\) \.from\.me \{\s*\n\s*color: #2C4A0F;/);
  assert.match(CSS, /#messages \.msg\.emote:not\(\.blue\):not\(\.shout\) \.from\.me \{\s*\n\s*color: #4F7B1F;/);
  // `penRedMode` et `penBlueAnimator` teintent la ligne ENTIÈRE : on les laisse.
  assert.match(LIGHT, /\.msg\.blue, \.msg\.blue \.body, \.msg\.blue \.from, \.msg\.blue \.from\.me, \.msg\.blue \.time \{/);
  assert.match(LIGHT, /\.msg\.shout, \.msg\.shout \.body, \.msg\.shout \.from, \.msg\.shout \.time \{/);
});

test('la ligne de l’animateur est plus grande que celle du fil', () => {
  assert.match(CSS, /#messages \.msg\.blue \{ font-size: 14px; \}/);
  // Le corps du fil, lui, reste à 12 — et le cri avec lui.
  assert.match(CSS, /#messages \.msg \{\s*\n\s*margin: 0; font-size: 12px;/);
  assert.doesNotMatch(CSS, /#messages \.msg\.shout \{ font-size/);
});

test('la boutique ne distingue plus l’article déjà acheté', () => {
  assert.doesNotMatch(CSS, /#bo-rubriques \.bo-art\.eu \{ color:/);
  // La classe reste posée : le tiroir mobile s'en sert.
  assert.match(LIGHT, /\+ \(it\.owned \? " eu" : ""\)/);
  assert.match(LIGHT, /\.bo-art\.eu \{ color: #5E7A3A; \}/);
});
