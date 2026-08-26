/*
 * LES ONGLETS du bureau light, et les retours de finition qui vont avec.
 *
 * `MainBar.addTab` (0x6afbc), `MainBarTab` (0x6f0d6) et `FPSlotList.addSlot`
 * (frutiparc/FPSlotList.as) disent trois choses que le portage ne faisait pas :
 *
 *   · l'onglet s'attache à `dp_tab + (tabMax − id × 2)` — plus le rang est
 *     grand, plus la profondeur est BASSE : le nouvel onglet passe SOUS les
 *     précédents, et « Bureau » reste devant ;
 *   · sa PASTILLE est un bouton (`bottom.but.onPress`) qui déroule le menu du
 *     slot — l'onglet descend de `tabMenuMargeUp + n × tabMenuSpace` et le
 *     menu prend la place libérée ;
 *   · `addSlot(slot, flGo)` n'active l'onglet QUE si flGo, et flGo vient de
 *     `Key.isDown(17)` : au clic ordinaire sur « replier », la fenêtre se
 *     RANGE et l'on reste sur le bureau.
 *
 * Le reste tient de la finition : les états de survol préchargés (sans quoi
 * chaque pièce cligne au premier passage du curseur), la flèche plutôt que la
 * croix de déplacement, le glisser d'icône qui ne déclenche plus la sélection
 * du navigateur, et la typo du journal.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const JS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.css'), 'utf8');
const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');

test('le nouvel onglet passe SOUS les précédents', () => {
  // `attachMovie("tab", …, dp_tab + (tabMax − r4 × 2))`, r4 = le rang.
  assert.match(JS, /o\.style\.zIndex = String\(500 - rang\)/);
  // Et l'activation ne remonte PAS l'onglet en profondeur. Ce qu'elle change,
  // c'est la hauteur de la PLAQUE, et vers le BAS : `activate` porte
  // `barre._height` à 4 au moins, puis `scrollDown` fait tendre `barre._y`
  // vers cette hauteur ; `deactivate` rappelle `scrollUp` vers `flActive × 4`,
  // c'est-à-dire zéro.
  assert.match(JS, /o\.etat\.h = Math\.max\(TAB_PLAQUE, o\.etat\.h\);\s*\n\s*o\.etat\.cible = ongletOuvert === o \? o\.etat\.h : TAB_PLAQUE;/);
  assert.match(JS, /\} else \{[\s\S]{0,220}?o\.etat\.cible = 0;\s*\n\s*\}\s*\n\s*animerOnglet\(o\);/);
  assert.doesNotMatch(CSS, /\.fb-onglet\.actif \{[^}]*z-index/);
});

test('l’onglet est fait de PIÈCES qui s’étirent, pas d’une image', () => {
  // Le clip `tab` (#206) : la plaque `barre` (#204, écrasée à 0,2222 — 4 px),
  // le pied `bottom` (#202) et, au-dessus des deux, la couture #205. La
  // silhouette `tabFond` (#187) vit à part, dans `mcTabBlack`.
  for (const p of ['ot-barre', 'ot-pied', 'ot-couture', 'ot-fondh', 'ot-fondb']) {
    assert.match(JS, new RegExp("pieceOnglet\\('" + p + "'"), p + ' manque à l’onglet');
  }
  // La plaque occupe `barre._y − barre._height` .. `barre._y` : deux variables,
  // pas une. Le pied la suit (`bottom._y = barre._y`), et la couture ne suit
  // rien du tout — elle est posée à (0, 0) dans le clip.
  assert.match(CSS, /\.ot-barre \{\s*\n\s*left: -16px; top: calc\(var\(--y\) - var\(--h\)\); width: 120px; height: var\(--h\);/);
  assert.match(CSS, /\.ot-pied \{\s*\n\s*left: -16px; top: calc\(var\(--y\) - 2\.05px\); width: 120px; height: 23px;/);
  assert.match(CSS, /\.ot-couture \{\s*\n\s*left: -17\.5px; top: -0\.5px; width: 123px; height: 2\.5px;/);
  // `updateFond` : fondH recopie la plaque, fondB suit le pied.
  assert.match(CSS, /\.ot-fondh \{\s*\n\s*left: -17\.5px; top: calc\(var\(--y\) - var\(--h\)\); width: 123px; height: var\(--h\);/);
  assert.match(CSS, /\.ot-fondb \{\s*\n\s*left: -17\.5px; top: var\(--y\); width: 122\.95px; height: 23\.5px;/);
  // Et le fond va dans SON conteneur : rangée dans l'onglet, la silhouette du
  // rang 0 déborderait par-dessus la plaque du rang 1.
  assert.match(JS, /noirOnglets\.id = 'bureau-onglets-noir'/);
  assert.match(JS, /\$\('#bureau-onglets-noir'\)\.appendChild\(fond\)/);
});

test('les deux pièces ÉTIRÉES gardent leur `preserveAspectRatio="none"`', () => {
  // Sans lui, un SVG servi en `background-image` conserve son rapport et se
  // CENTRE dans la boîte : la plaque de 120 × 18 posée dans 120 × 44 se
  // dessinait au milieu, avec treize pixels de vide au-dessus comme au-dessous
  // — le menu déroulé était troué. Seules `barre` et `fondH` s'étirent ;
  // le pied, la couture et `fondB` gardent leur taille.
  const svg = (n) => fs.readFileSync(path.join(ROOT, 'public/frutiz/sprites', n), 'utf8').split('\n')[0];
  for (const n of ['onglet_barre.svg', 'onglet_fondh.svg']) {
    assert.match(svg(n), /preserveAspectRatio="none"/, n + ' doit pouvoir s’étirer');
  }
  for (const n of ['onglet_pied.svg', 'onglet_fondb.svg', 'onglet_couture.svg']) {
    assert.doesNotMatch(svg(n), /preserveAspectRatio/, n + ' ne s’étire pas');
  }
  // Et l'extracteur doit continuer à les marquer.
  const EX = fs.readFileSync(path.join(ROOT, 'scripts/extract-frutiz-bureau.js'), 'utf8');
  assert.match(EX, /\{ cle: 'onglet_barre', id: 204, brut: true, etire: true \}/);
  assert.match(EX, /\{ cle: 'onglet_fondh', id: 186, brut: true, etire: true \}/);
  assert.match(EX, /svgCompose\(liste, corpsFormes, !!c\.etire\)/);
});

test('le liseré sombre de la barre passe SOUS les onglets', () => {
  // `drawInterface` dessine en deux clips : `mcInterfaceBlack` (profondeur 2)
  // pour le contour sombre, `mcInterface` (10) pour le liseré et le blanc.
  // Entre les deux, `mcTabBlack` (4) et `mcTab` (8). D'où la couture grise
  // relevée 1:1 au ras de la barre — et non le trait noir.
  assert.match(JS, /coinNoir\.id = 'bureau-coin-noir'/);
  assert.match(JS, /haut\.appendChild\(coinNoir\);[^\n]*\n\s*haut\.appendChild\(barreOnglets\);[^\n]*\n\s*haut\.appendChild\(coin\);/);
  assert.match(CSS, /#bureau-coin-noir \{\s*\n\s*z-index: 0; background: none; box-shadow: 0 0 0 2px #444444;/);
  // L'ombre de la bande des contacts passe elle aussi dessous.
  assert.match(CSS, /#side-list-ombre \{[\s\S]*?z-index: 0;/);
});

test('replier RANGE la fenêtre — seul Ctrl y va tout de suite', () => {
  // `WinStandard.putInTab` : Key.isDown(17) → putInTab(true) → addSlot(…, true).
  assert.match(JS, /function mettreEnOnglet\(idPanneau, flGo\)/);
  assert.match(JS, /if \(flGo\) activerSlot\(id\);/);
  assert.match(JS, /if \(e\.ctrlKey \|\| e\.metaKey\) \{ mettreEnOnglet\(panneau\.id, true\); return; \}/);
  assert.match(JS, /mettreEnOnglet\(panneau\.id, false\);/);
  // Un jeu qu'on vient de lancer, lui, s'affiche : flGo vrai.
  assert.match(JS, /mettreEnOnglet\(panneau\.id, true\);\s*\n\s*\}\s*\n\s*\};/);
  // Le bureau ne s'escamote que si un onglet A LA MAIN : rangée, la fenêtre
  // laisse le fond d'écran en place.
  assert.match(CSS, /body\.bureau-frutiz\.fb-onglet-actif #bureau,/);
  assert.match(JS, /document\.body\.classList\.toggle\('fb-onglet-actif', id !== 'bureau'\)/);
});

test('la pastille de l’onglet ouvre le menu, « Fermer » en tête', () => {
  assert.match(JS, /ico\.className = 'fb-onglet-ico'/);
  assert.match(JS, /menuOnglet\(id\);/);
  // Les constantes du clip.
  assert.match(JS, /MENU_ESPACE = 18, MENU_MARGE_HAUT = 8, MENU_MARGE_GAUCHE = 4, MENU_LARGEUR = 100/);
  // `getMenu` rend [Vers bureau, Fermer] et les pose à `_y = −(i × 18 + 16)` :
  // l'index 0 EN BAS. De haut en bas, on lit donc Fermer puis Vers bureau.
  assert.match(JS, /b\.style\.top = \(-\(i \* MENU_ESPACE \+ 16\)\) \+ 'px';/);
  // Le menu n'est PAS un panneau posé sur l'onglet : `attachMenu` étire la
  // plaque à `tabMenuMargeUp + n × tabMenuSpace`, `scrollDown` fait descendre
  // l'onglet d'autant, et les entrées vivent DANS le clip — c'est la plaque
  // étirée qui leur sert de fond.
  assert.match(JS, /onglet\.etat\.h = MENU_MARGE_HAUT \+ entrees\.length \* MENU_ESPACE;\s*\n\s*onglet\.etat\.cible = onglet\.etat\.h;/);
  assert.match(JS, /m\.className = 'ot-menu'/);
  assert.doesNotMatch(CSS, /#fb-menu-onglet/);
  assert.doesNotMatch(CSS, /--menu-h/);
  // Et c'est `scrollUp` qui le retire, à l'arrivée seulement : la plaque le
  // porte jusqu'en haut.
  assert.match(JS, /if \(e\.h > e\.cible\) e\.h = e\.cible;\s*\n\s*if \(ongletOuvert !== o\) retirerMenu\(o\);/);
  // La pastille est à la place que le dessin lui donne : `ico` ancré à
  // (17,5 ; 2,95) dans le pied — soit x 0 dans le clip — et le fruit occupe,
  // dans ce clip, le cadre (1,35 ; 1,7). Relevé 1:1 : l'orange de l'onglet
  // actif tombe en y 86..96, et son bord gauche en x 12.
  assert.match(CSS, /\.fb-onglet-ico \{\s*\n\s*position: absolute; left: 1\.35px; top: calc\(var\(--y\) \+ 4\.65px\);/);
  // Le bureau n'a pas de menu (`getMenu` vide) : sa pastille ne fait
  // qu'activer le slot, comme `bottom.but.onPress` quand la liste est vide.
  assert.match(JS, /if \(idOnglet === 'bureau'\) return \[\];/);
  assert.match(JS, /if \(!entrees\.length\) \{ activerSlot\(idOnglet\); return; \}/);
});

test('les libellés du menu : Verdana 10 MAIGRE noir, rose au survol', () => {
  // La règle de l'entrée, et elle seule.
  const debut = CSS.indexOf('.ot-menu button {');
  const regle = CSS.slice(debut, CSS.indexOf('}', debut));
  // `Standard.getTextStyle()` : { color: 0, font: "Verdana", size: 10 }.
  assert.match(regle, /font: 400 10px Verdana, Arial, sans-serif; color: #000000;/);
  // Et surtout PAS de gras : `attachMenu` passe un `textFormat: { bold: true }`
  // que personne ne relit (ni `But`, ni `but.Text`, ni `but.TextBasic` — seul
  // `textStyle` compte, et il est vide). Le relevé 1:1 le confirme.
  assert.doesNotMatch(regle, /font: 700/);
  // La gouttière de 2 px de tout TextField Flash : `pos.x` vaut
  // `margin.x.min × margin.x.ratio` = 0, et l'encre tombe deux pixels plus loin.
  assert.match(regle, /padding: 0 0 3px 2px;/);
  // `Standard.getButTextBasicBehavior()` : type "colorText",
  // over = 15168875 (#E7756B), press = 14540253 (#DDDDDD).
  assert.match(CSS, /\.ot-menu button:hover \{ color: #E7756B; \}/);
  assert.match(CSS, /\.ot-menu button:active \{ color: #DDDDDD; \}/);
});

test('l’onglet d’une conversation CLIGNOTE rose à l’arrivée d’un message', () => {
  // `MainBarTab.warning` : addColorFlash("warning", this, { color: 16755627,
  // alpha: 30, tempo: 500 }) — 0xFFB1AB à 30 %, et `colorFlash` alterne
  // `setColor`/`killColor` à chaque top : une demi-seconde sur deux.
  assert.match(CSS, /@keyframes fb-onglet-clignote \{\s*\n\s*0%, 49\.99% \{ opacity: 0; \}\s*\n\s*50%, 100%\s*\{ opacity: \.3; \}/);
  assert.match(CSS, /\.ot-teinte \{\s*\n\s*background: #FFB1AB; opacity: 0; z-index: 4;/);
  assert.match(CSS, /\.fb-onglet\.clignote \.ot-teinte \{\s*\n\s*animation: fb-onglet-clignote 1s steps\(1, end\) infinite;/);
  // Une TEINTE, pas un clignotement de luminosité : le calque rose est masqué
  // par le dessin, pour que l'onglet garde ses coins transparents.
  assert.match(CSS, /\.ot-teinte\.ot-pied \{\s*\n\s*-webkit-mask-image: url\('\/frutiz\/sprites\/onglet_pied\.svg'\);/);
  // `Slot.warning` : un slot ACTIF n'avertit jamais, et un slot déjà en alerte
  // ne relance pas l'animation.
  assert.match(JS, /function avertirSlot\(id\) \{\s*\n\s*if \(!actif \|\| !id \|\| id === slotActif\) return false;/);
  assert.match(JS, /if \(!o \|\| o\.classList\.contains\('clignote'\)\) return false;/);
  // `Slot.onActivate` : le slot qui prend la main cesse d'avertir.
  assert.match(JS, /if \(neuf\) neuf\.classList\.remove\('clignote'\);/);
  // `box.Chat.onSend` : la fenêtre des salons avertit l'onglet qui la porte —
  // ou celui du bureau si elle y est restée.
  assert.match(JS, /function avertirConversation\(\) \{[\s\S]*?return avertirSlot\(f\.onglet \|\| 'bureau'\);/);
  assert.match(JS, /avertirConversation: avertirConversation,/);
  // Côté light : salons ET discussions privées, mais ni les annonces (t="b")
  // ni les images (t="i") — le garde-fou d'`onSend`.
  assert.match(LIGHT, /function avertirOngletChat\(ty\) \{\s*\n\s*if \(ty === "b" \|\| ty === "i"\) return;/);
  const t = LIGHT.indexOf('case "t":');
  const bloc = LIGHT.slice(t, LIGHT.indexOf('var from = attr(xml, "u");', t));
  assert.match(bloc, /conv\.nonLus \+= 1;[\s\S]*?avertirOngletChat\(ty\);/);      // en privé
  assert.match(bloc, /\/\/ Le salon qu'on regarde[\s\S]*?avertirOngletChat\(ty\);/); // en salon
});

test('les états de survol sont préchargés — plus de clignotement', () => {
  // Un `background-image` d'état ne part chercher son dessin qu'au premier
  // survol : la pièce disparaît le temps du chargement. On demande donc
  // toutes les images de la feuille dès le démarrage du bureau.
  assert.match(JS, /function prechargerImages\(\)/);
  assert.match(JS, /fetch\('\/bureau-frutiz\.css'/);
  assert.match(JS, /url\\\(\\s\*\['"\]\?\(\\\/\[\^'"\)\]\+\)\['"\]\?\\s\*\\\)/);
  assert.match(JS, /actif = true;\s*\n\s*document\.body\.classList\.add\('bureau-frutiz'\);\s*\n\s*prechargerImages\(\);/);
});

test('le bandeau d’une fenêtre garde la FLÈCHE', () => {
  assert.match(CSS, /\.fen-titre \{[\s\S]*?cursor: default;/);
  assert.doesNotMatch(CSS, /\.fen-titre \{[\s\S]*?cursor: move;/);
});

test('le glisser d’une icône ne déclenche plus la sélection du navigateur', () => {
  const debut = JS.indexOf('function rendreIconesDeplacables');
  const bloc = JS.slice(debut, JS.indexOf('\n  }\n', JS.indexOf('pointercancel', debut)));
  // Sans preventDefault, tout le bureau vire au bleu pendant le geste.
  assert.match(bloc, /ev\.preventDefault\(\);/);
  // La capture suit le pointeur partout, y compris hors de la page.
  assert.match(bloc, /tuile\.setPointerCapture\(ev\.pointerId\)/);
  assert.match(bloc, /tuile\.addEventListener\('pointermove', glisser\)/);
  assert.match(bloc, /tuile\.addEventListener\('pointercancel', lacher\)/);
  // Le repère est relu à chaque pas : le bureau bouge sous la tuile.
  assert.match(bloc, /var app = bureau\.getBoundingClientRect\(\);\s*\n\s*tuile\.style\.left/);
});

test('le journal : 9 px, et la date sur sa propre ligne', () => {
  assert.match(CSS, /#evt-panel \.evt-item \.txt \{[\s\S]*?font-size: 9px;/);
  assert.match(CSS, /#evt-panel \.evt-item \.quand \{ font-weight: 700; display: block; \}/);
  assert.match(CSS, /#evt-panel \.evt-item \.quand i \{ display: none; \}/);
  assert.match(CSS, /#evt-panel \.evt-item\.neuf \.txt \{ font-weight: 700; font-size: 9px; \}/);
  // Le tiret vit dans son propre élément : le mobile le garde, le bureau le
  // masque — une seule chaîne pour les deux mises en page.
  assert.match(LIGHT, /\+ '<i> - <\/i><\/span>' \+ xmlEscape\(e\.text \|\| ""\)/);
});
