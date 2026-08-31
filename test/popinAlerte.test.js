'use strict';
/*
 * `win.Alert` (main.swf 0x82c45) — LA POPIN DE TOUT LE PARC
 * ════════════════════════════════════════════════════════
 *
 * `_global.openAlert(texte, titre)` monte une `box.Alert`, et `win.Alert
 * extends WinStandard` : ce n'est pas un cartouche à part, c'est UNE FENÊTRE
 * de plus, avec le bandeau et le liseré des autres. C'est elle qu'on voit à
 * l'achat en boutique, à l'arrivée d'une demande de discussion privée, à
 * l'appel au modérateur — partout où le parc pose une question.
 *
 *   init()      flResizable = false ; topIconList.splice(0, 3) — pas un
 *               bouton dans le bandeau : on répond, on ne referme pas.
 *               puis setAlert(info) et moveToCenter().
 *   setAlert()  deux documents empilés :
 *                 `frameDoc`    cpDocument frSystem, min {w:200, h:80} ;
 *                 `frameButton` cpDocument frSystem, min {w:200, h:24},
 *                               marge y {min:8, ratio:1}, dont la ligne est
 *                               `spacer(big 1)` puis, POUR CHAQUE bouton, un
 *                               `butPushStandard` suivi d'un autre spacer —
 *                               deux boutons se répartissent donc entre trois
 *                               espaces élastiques.
 *
 * `butPushStandard` (#465) est la gélule de 16 px : anneau `#F28687`, fond
 * `#FFAAAD`, encre `#660000`, éclat `#FFEAEC` en haut et à droite — la même
 * que « valider » de l'éditeur de bouille et « créer un salon ».
 *
 * CE QUI A CHANGÉ. Le portage avait un cartouche à lui : coins de 10, bandeau
 * vert clair, deux grosses pilules bordées, message centré en gras et vert.
 * Rien de cela n'est d'époque ; et comme la même popin sert partout, la refaire
 * une fois la remet d'aplomb partout.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
const CSS = LIGHT.slice(LIGHT.indexOf('#fp-popin-backdrop'),
  LIGHT.indexOf('/* ══ « MA FRUTIBOUILLE »'));

test('c’est une FENÊTRE, pas un cartouche : le bandeau et le liseré des autres', () => {
  // 200 de contenu + 12 de chaque côté, le fond blanc, le contour d'un pixel
  // et l'ombre portée des fenêtres.
  assert.match(CSS, /\.fp-popin \{\s*\n\s*width: 224px; box-sizing: border-box;/);
  assert.match(CSS, /background: #FFFFFF; border-radius: 6px;/);
  assert.match(CSS, /box-shadow: 0 0 0 1px #999999, 0 6px 18px rgba\(0, 0, 0, \.35\);/);
  // Le bandeau : pastille et titre en Verdana gras 11 sur `#444444`.
  assert.match(CSS, /\.fp-popin-tete \{[\s\S]*?height: 16px;[\s\S]*?font: 700 11px Verdana, Arial, sans-serif; color: #444444;/);
  // Et l'ancien cartouche a disparu.
  assert.ok(!/\.fp-popin-btn\.ghost/.test(LIGHT), 'plus de bouton « secondaire »');
  assert.ok(!/border: 1px solid #B9C6A0; border-radius: 10px;/.test(CSS));
});

test('les deux documents : 200 × 80 pour le texte, 200 × 24 pour les boutons', () => {
  assert.match(CSS, /\.fp-popin-corps \{\s*\n\s*min-height: 80px;/);
  assert.match(CSS, /\.fp-popin-corps \{[\s\S]*?font: 11px Verdana, Arial, sans-serif; color: #333333;/);
  // `frameButton` : 24 de haut, huit pixels plus bas (`margin.y.min = 8`), et
  // les espaces élastiques autour de chaque bouton.
  assert.match(CSS, /\.fp-popin-pieds \{\s*\n\s*display: flex; height: 24px; margin-top: 8px;\s*\n\s*align-items: center; justify-content: space-evenly;/);
});

test('les boutons sont des `butPushStandard`, tous pareils', () => {
  // La gélule de 16 px, aux valeurs relevées sur le dessin #465.
  assert.match(CSS, /\.fp-popin-btn \{[\s\S]*?height: 16px;[\s\S]*?background: #FFAAAD; box-shadow: inset 0 0 0 1\.5px #F28687;/);
  assert.match(CSS, /\.fp-popin-btn \{[\s\S]*?font: 700 10px Verdana, Arial, sans-serif; color: #660000;/);
  // L'éclat qui longe le bord haut puis s'enroule autour du bout droit.
  assert.match(CSS, /\.fp-popin-btn::after \{[\s\S]*?border-top: 1px solid #FFEAEC; border-right: 1px solid #FFEAEC;/);
  // `butList` fait un tour par bouton : une alerte qui n'a rien à demander
  // (`openErrorAlert`) n'en porte qu'un.
  assert.match(LIGHT, /\(opts\.sansAnnuler \? ''/);
  assert.match(LIGHT, /var annuler = bd\.querySelector\('\[data-a="cancel"\]'\);/);
});

test('l’achat en boutique dit ce que dit `shop.confirm_buy`', () => {
  /* lang_french.as 505 :
       « Êtes-vous sûr de vouloir acheter "$n" pour $p kikooz ? »
     Des guillemets droits autour du nom, et RIEN en gras — le portage mettait
     le nom en vert et le prix en gras. */
  assert.match(LIGHT, /message: 'Êtes-vous sûr de vouloir acheter "' \+ xmlEscape\(it\.name\)\s*\n\s*\+ '" pour ' \+ \(Number\(it\.price\) \|\| 0\) \+ ' kikooz \?',/);
  assert.match(LIGHT, /okLabel: "Acheter",\s*\n\s*cancelLabel: "Annuler",/);
  assert.ok(!/« <strong>" \+ xmlEscape\(it\.name\)/.test(LIGHT), 'plus de nom en gras vert');
});

test('une seule popin pour les deux présentations', () => {
  // Le bureau s'en sert pour l'appel au modérateur, le light pour la boutique :
  // deux implémentations divergeraient.
  assert.match(LIGHT, /window\.frutiConfirm = frutiConfirm;/);
  const BUREAU = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.js'), 'utf8');
  assert.match(BUREAU, /var demander = window\.frutiConfirm;/);
});

/* ── L'EMOTE « LARME » ─────────────────────────────────────────────────────
 *
 * `actionList` compte treize animations, et les deux dernières ne se
 * ressemblent pas : la 11 (`pleurer`) est la grosse crise — les yeux fermés,
 * le compteur à quatre tours — et la 12 (`larme`) une seule larme, l'œil
 * triste, jouée une fois. `lang_french.as` les nomme séparément :
 * `chat.action["11"] = "pleure"`, `["12"] = "laisse couler une larme"`.
 *
 * Le portage les envoyait TOUTES DEUX sur l'animation 11 : taper « larme »
 * donnait un sanglot. Le libellé, lui, était déjà le bon — d'où un décalage
 * entre ce qu'on lisait et ce qu'on voyait.
 */

test('« larme » joue la larme, pas le sanglot', () => {
  assert.match(LIGHT, /add\("larme", "laisse couler une larme", \[":'\(", ";\(", "larme", "snif"\]\);/);
  assert.match(LIGHT, /add\("pleurer", "pleure", \[':-"\(', ";\(\(", "pleure", "ouin"\]\);/);
  // L'indice de `playAnim` : 11 pour l'un, 12 pour l'autre.
  assert.match(LIGHT, /pleurer:11, larme:12 \};/);
  assert.match(LIGHT, /pleurer:"pleure", larme:"laisse couler une larme",/);
  // Et le moteur connaît bien les deux pellicules.
  const MOTEUR = fs.readFileSync(path.join(ROOT, 'public/js/bouille-moteur.js'), 'utf8');
  assert.match(MOTEUR, /'miam', 'pleure', 'larme'\];/);
  assert.match(MOTEUR, /face\.allerImage\('larme', false\);/);
});
