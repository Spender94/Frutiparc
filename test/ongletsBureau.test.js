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
  // La fenêtre se désigne par SA CLÉ, pas par l'identifiant de son panneau :
  // les fenêtres de conversation sont des copies du même panneau, elles le
  // portent toutes (cf. salonsFenetres.test.js).
  assert.match(JS, /if \(e\.ctrlKey \|\| e\.metaKey\) \{ mettreEnOnglet\(cle, true\); return; \}/);
  assert.match(JS, /mettreEnOnglet\(cle, false\);/);
  // Un jeu qu'on vient de lancer, lui, s'affiche : flGo vrai.
  assert.match(JS, /mettreEnOnglet\(panneau\.id, true\);\s*\n\s*\}\s*\n\s*\};/);
  // Le bureau ne s'escamote que si un onglet A LA MAIN — et même alors, ce
  // sont ses MEUBLES qui partent, pas le fond d'écran (cf. le test dédié).
  assert.match(CSS, /body\.bureau-frutiz\.fb-onglet-actif #bureau > \*,/);
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
  // LE BUREAU A UN MENU, LUI AUSSI. On l'avait cru vide ; `FPDesktop.getMenu`
  // (0xb97cd) rend quatre entrées à tout le monde — cf. ongletBureau.test.js.
  assert.match(JS, /if \(idOnglet === 'bureau'\) \{\s*\n\s*return \[/);
  // Le repli reste : un slot SANS menu se contente d'activer, comme
  // `bottom.but.onPress` quand la liste est vide.
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

test('l’onglet d’une conversation CLIGNOTE à l’arrivée d’un message', () => {
  // `MainBarTab.warning` (0x6f703) : addColorFlash("warning", this,
  // { color: 16755627, alpha: 30, tempo: 500 }), et `colorFlash` alterne
  // `setColor`/`killColor` à chaque top : une demi-seconde sur deux.
  //
  // 16755627 = 0xFFABAB — et `FEMC.setColor` (0x4a81c) n'est PAS un voile :
  // hors `negFlag` il pose { ra:100, ga:100, ba:100, rb:r−255, … }, soit
  // `sortie = source + (col − 255)` = `source + (0, −84, −84)`. Un calque rose
  // à 30 % éclaircissait là où l'époque assombrit ; on pose la vraie matrice.
  const light = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
  assert.match(light, /<filter id="fb-onglet-flash" color-interpolation-filters="sRGB">/,
    'le filtre est déclaré, en sRGB comme Flash');
  assert.match(light, /0 1 0 0 -0\.32941/, 'le vert tombe de 84/255…');
  assert.match(light, /0 0 1 0 -0\.32941/, '…et le bleu autant');
  assert.match(light, /values="1 0 0 0 0/, 'le rouge, lui, ne bouge pas');
  assert.match(CSS, /@keyframes fb-onglet-clignote \{\s*\n\s*0%, 49\.99% \{ filter: none; \}\s*\n\s*50%, 100%\s*\{ filter: url\('#fb-onglet-flash'\); \}/);
  // `setColor` prend le clip ENTIER — le dessin et le libellé. Mais pas le
  // menu déroulant : d'époque, c'est une popup à part du `MainBarTab`.
  assert.match(CSS, /\.fb-onglet\.clignote > \*:not\(\.ot-menu\) \{\s*\n\s*animation: fb-onglet-clignote 1s steps\(1, end\) infinite;/);
  assert.doesNotMatch(CSS, /background: #FFB1AB/, 'la fausse teinte a disparu');
  assert.doesNotMatch(JS, /pieceOnglet\('ot-teinte/, 'et les calques qui la portaient aussi');
  // `Slot.warning` : un slot ACTIF n'avertit jamais, et un slot déjà en alerte
  // ne relance pas l'animation.
  assert.match(JS, /function avertirSlot\(id\) \{\s*\n\s*if \(!actif \|\| !id \|\| id === slotActif\) return false;/);
  assert.match(JS, /if \(!o \|\| o\.classList\.contains\('clignote'\)\) return false;/);
  // `Slot.onActivate` : le slot qui prend la main cesse d'avertir.
  assert.match(JS, /if \(neuf\) neuf\.classList\.remove\('clignote'\);/);
  // `box.Chat.onSend` : la fenêtre DU SALON CONCERNÉ avertit l'onglet qui la
  // porte — ou celui du bureau si elle y est restée. Chaque conversation a sa
  // fenêtre, c'est donc le salon qui désigne laquelle.
  assert.match(JS, /function avertirConversation\(salon\) \{[\s\S]*?return avertirSlot\(f\.onglet \|\| 'bureau'\);/);
  assert.match(JS, /var f = salon \? fenetres\['salon:' \+ salon\] : null;/);
  assert.match(JS, /avertirConversation: avertirConversation,/);
  // Côté light : salons ET discussions privées, mais ni les annonces (t="b")
  // ni les images (t="i") — le garde-fou d'`onSend`.
  assert.match(LIGHT, /function avertirOngletChat\(ty, salon\) \{\s*\n\s*if \(ty === "b" \|\| ty === "i"\) return;/);
  const t = LIGHT.indexOf('case "t":');
  const bloc = LIGHT.slice(t, LIGHT.indexOf('var from = attr(xml, "u");', t));
  assert.match(bloc, /conv\.nonLus \+= 1;[\s\S]*?avertirOngletChat\(ty, salon\);/);      // en privé
  assert.match(bloc, /\/\/ Le salon qu'on regarde[\s\S]*?avertirOngletChat\(ty, salon\);/); // en salon
});

test('les états de survol sont préchargés — plus de clignotement', () => {
  // Un `background-image` d'état ne part chercher son dessin qu'au premier
  // survol : la pièce disparaît le temps du chargement. On demande donc
  // toutes les images de la feuille dès le démarrage du bureau — c'est la
  // PAGE DE CHARGEMENT qui s'en charge maintenant (cf. chargementBureau), et
  // c'est même ce que son texte d'époque promet.
  assert.match(JS, /function inventaireDuChargement\(declarer, fini\)/);
  assert.match(JS, /fetch\('\/bureau-frutiz\.css'/);
  assert.match(JS, /url\\\(\\s\*\['"\]\?\(\\\/\[\^'"\)\]\+\)\['"\]\?\\s\*\\\)/);
  assert.match(JS, /actif = true;\s*\n\s*document\.body\.classList\.add\('bureau-frutiz'\);\s*\n(?:\s*\/\/[^\n]*\n)*\s*ouvrirChargement\(\);/);
  // et l'inventaire du manifeste s'y ajoute : les 165 dessins de l'interface
  assert.match(JS, /fetch\('\/frutiz\/sprites\/chargement\.json'/);
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
  // La capture suit le pointeur partout, y compris hors de la page…
  assert.match(bloc, /try \{ tuile\.setPointerCapture\(ev\.pointerId\); \}/);
  // …mais elle est PERDUE au reparentage : passer la tuile du #home-grid au
  // #bureau la retire un instant du document, et le retrait rend la capture.
  // Sans ce second appel, la tuile ne recevait plus rien après son premier pas
  // et restait collée au curseur, `en-main`, sans jamais se déposer.
  assert.match(bloc, /bureau\.appendChild\(tuile\);\s*\n[\s\S]{0,400}?try \{ tuile\.setPointerCapture\(ev\.pointerId\); \}/);
  // Et les écouteurs vivent sur le DOCUMENT, pas sur la tuile : capture posée,
  // l'événement remonte jusque-là ; capture perdue, le document le reçoit
  // quand même. Un `pointerId` étranger (deuxième doigt) est ignoré.
  assert.match(bloc, /document\.addEventListener\('pointermove', glisser\);/);
  assert.match(bloc, /document\.addEventListener\('pointerup', lacher\);/);
  assert.match(bloc, /document\.addEventListener\('pointercancel', lacher\);/);
  assert.doesNotMatch(bloc, /tuile\.addEventListener\('pointer/);
  assert.match(bloc, /var glisser = function \(e2\) \{\s*\n\s*if \(e2\.pointerId !== ev\.pointerId\) return;/);
  assert.match(bloc, /var lacher = function \(e2\) \{\s*\n\s*if \(e2\.pointerId !== ev\.pointerId\) return;/);
  // Le repère est relu à chaque pas : le bureau bouge sous la tuile.
  assert.match(bloc, /var app = bureau\.getBoundingClientRect\(\);\s*\n\s*tuile\.style\.left/);
});

test('sur le bureau, le rangement mobile des tuiles ne s’arme pas', () => {
  // Deux gestes visaient la même tuile : celui du bureau (bureau-frutiz.js) et
  // le rangement par appui long du mobile (light.html). Ce dernier volait la
  // capture, réinsérait la tuile dans #home-grid à chaque pas et laissait la
  // classe `tuile-partie` — l'icône restait fantomatique et la grille, en se
  // rétrécissant, découvrait une bande de fond plus claire en bas du bureau.
  assert.match(LIGHT, /if \(window\.BureauFrutiz && BureauFrutiz\.actif && BureauFrutiz\.actif\(\)\) return;/);
});

// Le 9 px du premier portage se lisait mal : le lot de retours a demandé un
// pixel de plus. On est à 10 (l'écart au relevé est nommé dans la feuille).
test('le journal : 10 px, et la date sur sa propre ligne', () => {
  assert.match(CSS, /#evt-panel \.evt-item \.txt \{[\s\S]*?font-size: 10px;/);
  assert.match(CSS, /#evt-panel \.evt-item \.quand \{ font-weight: 700; display: block; \}/);
  assert.match(CSS, /#evt-panel \.evt-item \.quand i \{ display: none; \}/);
  assert.match(CSS, /#evt-panel \.evt-item\.neuf \.txt \{ font-weight: 700; font-size: 10px; \}/);
  // Le tiret vit dans son propre élément : le mobile le garde, le bureau le
  // masque — une seule chaîne pour les deux mises en page.
  assert.match(LIGHT, /\+ '<i> - <\/i><\/span>' \+ xmlEscape\(e\.text \|\| ""\)/);
});

/* ══════════════════════════════════════════════════════════════════════════
   TROIS FINITIONS DE PLUS, toutes relevées dans main.swf. */

test('le pseudo d’un contact vire au rose sous le curseur', () => {
  // Le champ n'est pas un texte mais un `butText` (`UserSlot.initText`,
  // 0x63541), et tout `butText` sans comportement déclaré se voit poser celui
  // de la maison — `Standard.getButTextBasicBehavior()` (0x4986c) :
  //
  //     { type: "colorText", color: { press: 14540253, over: 15168875 } }
  //
  // soit press = #DDDDDD et over = #E7756B. `setBehavior` (0x9fd26) laisse
  // `base` à la couleur propre du champ, puis câble onRollOver → over,
  // onPress → press, onRollOut/onDragOut/onReleaseOutside → base.
  //
  // …MAIS ce comportement par défaut ne vaut que TANT QUE LE GENRE EST INCONNU.
  // `UserSlot.onInfoBasic` (0x63a51) l'écrase dès que le serveur a dit `sx` :
  // le pseudo passe au bleu du garçon ou au rouge de la fille, survol compris
  // (cf. finitionsFenetre.test.js). D'où les `:not([data-genre])`, sans quoi
  // ces règles-ci l'emporteraient par spécificité.
  assert.match(CSS, /\.sl-contact:not\(\[data-genre\]\):hover \.nom \{ color: #E7756B; \}/);
  assert.match(CSS, /\.sl-contact:not\(\[data-genre\]\):active \.nom \{ color: #DDDDDD; \}/);
  // Au repos, la couleur du champ : noir (`Standard.getTextStyle().def`).
  assert.match(CSS, /#side-list \.sl-contact \.nom \{[\s\S]*?color: #000000;/);
  // La liste des connectés d'un salon est le MÊME `userSlot` : même règle.
  // La règle est désormais COMMUNE au salon et à la fenêtre de Gaspard :
  // `cp.UserList` monte le même `userSlot` dans les deux.
  assert.match(CSS, /#users-drawer \.u:not\(\[data-genre\]\):hover span:not\(\.badge\),\s*\n\s*body\.bureau-frutiz #gaspard-panel \.gs-ul-defile \.u:not\(\[data-genre\]\):hover span:not\(\.badge\) \{ color: #E7756B; \}/);
  assert.match(CSS, /#users-drawer \.u:not\(\[data-genre\]\):active span:not\(\.badge\),\s*\n\s*body\.bureau-frutiz #gaspard-panel \.gs-ul-defile \.u:not\(\[data-genre\]\):active span:not\(\.badge\) \{ color: #DDDDDD; \}/);
});

test('le forum sort du bureau : une fenêtre de NAVIGATEUR, pas une fenêtre du bureau', () => {
  // `win.Forum.init` (0x6e136) n'attache aucun contenu : il appelle
  // `fp_goURLResize('/fb/?sid=…',1)` et pose un simple témoin sur le bureau.
  // L'ouverture se fait à l'activation, `fp_activatePopupForum()`.
  assert.ok(!/forum:\s*\{ panneau: '#forum-panel'/.test(JS),
    'le forum n’est plus une rubrique fenêtrable');
  assert.match(JS, /function ouvrirFenetre\(tab\) \{\s*\n(?:\s*\/\/[^\n]*\n)*\s*if \(tab === 'forum'\) return ouvrirForum\(\);/,
    'quel que soit le chemin, on sort de la page');
  assert.match(JS, /window\.open\(url, 'frutiparc_forum', FORUM_FENETRE\)/);
  // Le même nom de fenêtre que le chemin Flash : un seul forum ouvert.
  const ruffle = fs.readFileSync(path.join(ROOT, 'public/ruffle.html'), 'utf8');
  assert.ok(ruffle.includes('"frutiparc_forum"'), 'le lecteur Flash vise la même fenêtre');
  // Rappelée au premier plan plutôt que rouverte — c'est ce que fait
  // `fp_activatePopupForum` quand la popup vit déjà.
  assert.match(JS, /if \(popupForum && !popupForum\.closed\)/);
  // PAS de « from=light » : ce paramètre est celui du cadre mobile (il pose un
  // lien « ‹ Salons » et fait revenir `closeForum()` sur /light). L'adresse se
  // bâtit de deux morceaux, et de deux seulement.
  assert.match(JS, /if \(sid\) q\.push\('sid=' \+ encodeURIComponent\(sid\)\);/);
  assert.match(JS, /if \(sujet\) q\.push\('sujet=' \+ encodeURIComponent\(sujet\)\);/);
  assert.match(JS, /var url = '\/fb\/' \+ \(q\.length \? '\?' \+ q\.join\('&'\) : ''\);/);

  // Côté light : la tuile du bureau y va, le mobile garde son cadre.
  assert.match(LIGHT, /if \(go === "forum" && surBureau && BureauFrutiz\.ouvrirForum\)/);
  assert.match(LIGHT, /if \(tab === "forum" && !\(window\.BureauFrutiz && BureauFrutiz\.actif\(\)\)\)/,
    'le cadre mobile ne se charge pas en double sur le bureau');
  // Une citation reçue en notification mène AU SUJET, fenêtre comprise.
  assert.match(LIGHT, /BureauFrutiz\.ouvrirForum\(sujet\)/);
  assert.match(JS, /function ouvrirForum\(sujet\)/);
});

test('une fenêtre en plein écran laisse voir le FOND D’ÉCRAN au-dessus d’elle', () => {
  // `FPDesktop.onDeactivate` (0xb9574) retire la rangée d'icônes et cache
  // `mcDesk` — mais PAS le fond d'écran, qui relève d'un manager à part
  // (`WallPaperMng`, 0x9a5e8). La preuve : le slot du forum appelle
  // `wallPaper.hide()` (0x6e2fa) et un jeu `wallPaper.hideImage()` (0x36cb1)
  // — deux appels sans objet si un onglet actif l'avait déjà effacé.
  //
  // Le portage cachait `#bureau` en entier : la bande entre le haut de la
  // fenêtre, la barre et la frusion virait au blanc.
  assert.ok(!/\.fb-onglet-actif #bureau,\s*\n[^\n]*\.fen:not\(\.fen-onglet-vue\) \{ display: none; \}/.test(CSS),
    '#bureau n’est plus escamoté en entier');
  assert.match(CSS, /\.fb-onglet-actif #bureau \{ pointer-events: none; \}/,
    'invisible d’époque veut dire aussi : ne reçoit plus la souris');
  assert.match(CSS, /\.fb-onglet-actif #bureau > \*,\s*\n[^\n]*\.fen:not\(\.fen-onglet-vue\) \{ display: none; \}/,
    'seuls les MEUBLES du bureau s’escamotent');
  // La rangée d'icônes est nommée à part : sa règle de pose porte deux
  // identifiants et l'emporterait sur le `> *`.
  assert.match(CSS, /\.fb-onglet-actif #bureau #home-grid \{ display: none; \}/);
  // Et le fond est bien peint sur `#bureau` lui-même.
  assert.match(JS, /bureau\.style\.backgroundImage = 'url\("' \+ fond\.url \+ '"\)'/);
});

test('une fenêtre VIENT DU COIN, et y met le temps du SWF', () => {
  /* LA VITESSE. `moveToPos` (0x55b47) ne bouge rien : il confie la fenêtre à
     `AnimList.addSlide` (0x51514), qui pose un setInterval de 25 ms et appelle
     `AnimList.slide` (0x515d1) —

         var k = Math.pow(0.8, tmod × ratio);
         regular.x = regular.x × k + pos.x × (1 − k);

     `ratio` vaut 1 (addSlide le met à 1 quand il manque, et moveToPos n'en
     passe pas) et `tmod` vaut 1 : `_global.tmod = 1` est posé par le CLIENT
     FRUSION (frusion_client.swf, offset 5813) et main.swf ne fait que le lire.
     Donc k = 0,8 : un CINQUIÈME du chemin restant tous les 25 ms. */
  assert.match(JS, /var GLISSE_K = 0\.8;/);
  assert.match(JS, /var GLISSE_MS = 25;/);
  assert.match(JS, /reg\.x = reg\.x \* GLISSE_K \+ cible\.x \* \(1 - GLISSE_K\);/);
  assert.match(JS, /reg\.y = reg\.y \* GLISSE_K \+ cible\.y \* \(1 - GLISSE_K\);/);
  // L'arrêt du SWF : les deux coordonnées dans le même pixel ENTIER, pas
  // « à moins d'un demi-pixel » — c'est plus tolérant sur un axe, plus strict
  // sur l'autre.
  assert.match(JS, /if \(Math\.round\(reg\.y\) === Math\.round\(cible\.y\)\s*\n\s*&& Math\.round\(reg\.x\) === Math\.round\(cible\.x\)\)/);
  assert.ok(!/\(cible\.x - x\) \/ 3/.test(JS), 'le tiers d’avant a disparu');

  /* L'ARRIVÉE. `Box.init` (0x23286) attache le clip sans position —
     `attachMovie(winType, id, depth, winOpt)` et `winOpt` ne porte que `box`
     et `title`. Il est donc à (0,0) de `slotList.mc`. La suite l'envoie à sa
     place EN GLISSANT : endInit → onChangeMode (0x543d5) → update (0x53e06)
     → updatePos (0x53e3d) → updateDeskPos (0x53f47) → recal(); moveToPos(). */
  const bloc = JS.slice(JS.indexOf('function creerFenetre'),
    JS.indexOf('function ajusterJournal'));
  assert.match(bloc, /fen\.style\.left = '0px';\s*\n\s*fen\.style\.top = '0px';/,
    'la fenêtre naît au coin');
  assert.match(bloc, /fen\._entree = recal\(/, 'et sa place est bornée d’avance');
  assert.match(bloc, /glisserVers\(fen, fen\._entree\);/, 'puis elle y glisse');
  // Même les fenêtres CENTRÉES : `moveToCenter` (0x55bee) finit par
  // `recal(); moveToPos()` — elle ne saute pas au milieu, elle y va.
  assert.match(bloc, /moveToCenter[\s\S]{0,600}?GLISSER/);

  // `onStageResize` (0x54709) ne fait qu'un `update()` : une fenêtre que
  // l'écran rétréci repousse GLISSE dans le cadre, elle n'y saute pas.
  const borne = JS.slice(JS.indexOf('function bornerDansEcran'),
    JS.indexOf('function glisserVers'));
  assert.match(borne, /glisserVers\(fen, pos\);/);
  assert.ok(!/fen\.style\.left = Math\.round\(pos\.x\)/.test(borne),
    'plus de saut dans le cadre');
});

test('un onglet de JEU gagne « Déporter », au-dessus de « Fermer »', () => {
  /* ÉCART ASSUMÉ, et c'est un choix OFFERT : le jeu s'ouvre comme d'habitude
     dans le corps de la page — l'onglet d'époque —, et « Déporter » le fait
     passer dans une fenêtre de navigateur à lui, comme les trois jeux restés
     en Flash le font depuis toujours. Rien ne part en fenêtre tout seul.

     LA PLACE : `_y = −(i × tabMenuSpace + 16)` met l'index 0 EN BAS. Poussée
     en fin de tableau, l'entrée se dessine donc TOUT EN HAUT, au-dessus de
     « Fermer » — c'est là qu'elle était demandée. */
  assert.match(JS, /if \(jeu\) m\.push\(\{ titre: 'Déporter', faire: function \(\) \{ deporterJeu\(jeu\); \} \}\);/);
  // Elle n'existe que pour un onglet qui PORTE un jeu.
  assert.match(JS, /function jeuDuSlot\(idOnglet\) \{/);
  assert.match(JS, /if \(rub && rub\.panneau === '#' \+ s\.panneau\) return tab;/);
  // Le jeu QUITTE la page : deux instances écriraient la même sauvegarde.
  const d = JS.slice(JS.indexOf('function deporterJeu(tab) {'),
    JS.indexOf('function deporterJeu(tab) {') + 800);
  assert.match(d, /if \(!P\.deporter\(tab, rub\.l, rub\.h\)\)/);
  assert.match(d, /if \(panneau && fenetres\[panneau\.id\]\) fermerFenetre\(panneau\.id\);/);
  assert.match(d, /frusion\.jeu = null; frusion\.jeuDeporte = tab;/);
  // Éjecter le disque referme sa fenêtre, comme il referme celle de Ruffle.
  assert.match(JS, /if \(this\.jeuDeporte\) \{\s*\n\s*if \(window\.JeuxPortes\) window\.JeuxPortes\.refermer\(\);/);
});

test('`JeuxPortes` : une adresse par jeu, et une seule fenêtre à la fois', () => {
  const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
  // La table des adresses sert AUX DEUX usages — le cadre de l'onglet et la
  // fenêtre déportée. Deux listes qui divergent, c'est un jeu qui s'ouvre à
  // vide d'un côté.
  assert.match(LIGHT, /var ADRESSES_JEU = \{\s*\n\s*grapiz: "\/grapiz\/", bandas: "\/bandas\/", swapou: "\/swapou\/",/);
  assert.match(LIGHT, /cadreJeu\.setAttribute\("src", adresseJeu\(tab\)\);/);
  // Les huit jeux ont bien leur adresse ET leur cadre.
  const t = /var ADRESSES_JEU = \{([\s\S]*?)\};/.exec(LIGHT)[1];
  for (const j of ['grapiz', 'bandas', 'swapou', 'miniwave', 'minipixiz', 'snake3',
    'minifever', 'jamajama']) {
    assert.ok(new RegExp(j + ':').test(t), j + ' doit avoir son adresse');
  }
  // Une seule fenêtre : le même NOM de fenêtre, que le navigateur recycle.
  assert.match(LIGHT, /window\.__jeuPopup = window\.open\(url, "frutiparc_jeu", traits\);/);
  assert.match(LIGHT, /if \(!window\.__jeuPopup\) return false;/);
});
