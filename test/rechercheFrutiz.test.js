'use strict';
/*
 * LA FENÊTRE DE RECHERCHE — `win.Search` (0x855db), `win.search.Frutiz`
 * (0x86170), `box.Search` (0x984e7), `cp.SearchSlot` (0xc79dd).
 *
 * Deux portes y mènent, et ce sont celles de l'époque : le bouton du bas de la
 * bande des contacts (`SideList.buildList` 0xa115b :
 * `butSearch.onPress = uniqWinMng.open("search")`) et l'entrée « Recherche » du
 * menu de l'onglet Bureau (`FPDesktop.getMenu`).
 *
 * ── LE GABARIT ───────────────────────────────────────────────────────────
 *     mWidth = 270 · flResizable = false · flAdvance = false · blocMax = 6
 * et trois cadres empilés (`initFrameSet` 0x8567a) : le formulaire
 * (`cpDocument` frSystem), le listing (`showFrame`), le sélecteur de page
 * (`cpPageSelector`, min 270 × 24). `flDocumentFit` : la fenêtre prend la
 * taille de son contenu — elle grandit quand la recherche avancée se déplie et
 * quand les résultats arrivent.
 *
 * ── LE FORMULAIRE ────────────────────────────────────────────────────────
 * `getSearchLines` (0x862c9) rend UNE ligne — « pseudo : » (60), un champ
 * (maxChars 18, restrict "0-9a-zA-Z"), un espace de 4, le bouton « ok », puis
 * « avancée » (dx 3) SI ET SEULEMENT SI `flAdvanceAvailable`.
 *
 * `getAdvanceSearchLines` (0x8646d) en rend QUATRE : sexe, âges, pays, région.
 * L'ordre des trois boutons de sexe est « Masculin, Feminin, Tous » —
 * `InitArray` renverse l'ordre d'empilement, et le bytecode empile Tous,
 * Feminin, Masculin puis l'étiquette. C'est contre-intuitif, et c'est d'époque.
 *
 * ── LA REQUÊTE ───────────────────────────────────────────────────────────
 * `box.Search.launchSearch` (0x98ab6) : `s` (le rang de départ), `l` (blocMax),
 * `u` seulement à partir de DEUX lettres, `sx` s'il y a un sexe, `bdm` et `bd`
 * — deux BORNES D'ANNIVERSAIRE, pas deux âges —, `co` et `rg` s'ils sont
 * choisis. `nextPage`/`prevPage` ne refont pas la requête : ils bougent `s`.
 *
 * ── UNE ENTRÉE ───────────────────────────────────────────────────────────
 * `cp.SearchSlot` : 270 × 50, `th = 44`, `mLeft = 24`. Le voyant en (2, 0), le
 * drapeau en (2, 22), la bouille en (24, 0) sur 44, le document en (76, 1) sur
 * 190 × 44, et derrière lui une plaque en x 74 large de 194. Le GENRE décide de
 * tout : `gender == "M"` donne le vert (`frSheet`), TOUT LE RESTE le rose
 * (`frRoomList`) — les filles comme le genre inconnu.
 *
 * ── LE BANANOCLE ─────────────────────────────────────────────────────────
 * `flAdvanceAvailable = me.hasItem(833)`, et `onAdvanceSearch(b)` fait
 * `me.useFrutibouille(b ? "Bananocle" : "Normal")` : déplier la recherche
 * avancée VOUS MET LE BANANOCLE SUR LE NEZ.
 *
 * Mesuré au banc (Playwright, banc-recherche.js) : la fenêtre s'ouvre à 284 de
 * large, « ba » part en `u` mais « a » non, un bloc fait bien 270 × 50, le
 * dépliage fait passer la fenêtre de 336 à 424, le menu des pays a ses six
 * entrées (titre compris), celui des régions dit « Choisissez un département »
 * et « 01 - Ain », la pagination va de 1/2 à 2/2 et revient, et l'entrée
 * « Recherche » du menu de l'onglet rouvre la même fenêtre.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const JS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.css'), 'utf8');
const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
const SERVEUR = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

/* ── LE GABARIT ───────────────────────────────────────────────────────────── */

test('la fenêtre reprend les constantes de `win.Search.init`', () => {
  // mWidth = 270 → 284 de fenêtre (la même loi que le journal : 300 → 314),
  // et `flResizable = false` → pas de poignée.
  assert.match(JS, /recherche:\s*\{ panneau: '#recherche-panel', titre: 'Recherche', fruit: 'winSearchFrutiz',\s*\n\s*l: 284, h: \d+, fixe: true, min: minFenetre\(270, 20 \+ 24\) \}/);
  assert.match(JS, /var RC_LARGEUR = 270;/);
  assert.match(JS, /var RC_BLOC_MAX = 6;/);
  assert.match(JS, /var RC_TH = 44, RC_MLEFT = 24;/);
  assert.match(JS, /var RC_BLOC_H = 50;/);
  assert.match(JS, /var RC_PIED = 24;/);
});

test('le panneau se bâtit à la volée : il n’a pas de jumeau mobile', () => {
  assert.match(JS, /if \(tab === 'recherche' && !\$\(rub\.panneau\)\) \$\('#app'\)\.appendChild\(panneauRecherche\(\)\);/);
});

test('`flDocumentFit` : la hauteur suit le contenu, elle n’est pas fixée', () => {
  const h = JS.slice(JS.indexOf('function hauteurRecherche()'),
    JS.indexOf('function ouvrirRechercheFenetre()'));
  // une ligne de formulaire + quatre de plus quand l'avancée est dépliée
  assert.match(h, /var lignes = 1 \+ \(rcEtat\.avance \? 4 : 0\);/);
  // et autant de blocs de 50 que de résultats — pas `blocMax` en dur
  assert.match(h, /rcEtat\.resultats\.length \* RC_BLOC_H \+ RC_PIED/);
  assert.match(h, /f\.fen\.style\.height = Math\.min\(hauteurRecherche\(\),/);
});

/* ── LES DEUX PORTES ──────────────────────────────────────────────────────── */

test('le bouton de la bande des contacts et le menu de l’onglet mènent au même endroit', () => {
  assert.match(JS, /\.sl-recherche'\)\.addEventListener\('click', ouvrirRechercheFenetre\);/);
  assert.match(JS, /function ouvrirRecherche\(\) \{ ouvrirRechercheFenetre\(\); \}/);
  assert.match(JS, /\{ titre: 'Recherche', faire: ouvrirRecherche \}/);
});

test('le mot du bouton est un CHAMP, centré et blanc (DefineEditText #438)', () => {
  const b = CSS.slice(CSS.indexOf('body.bureau-frutiz #side-list .sl-recherche {'),
    CSS.indexOf('body.bureau-frutiz.contacts-ouverts #side-list .sl-recherche'));
  assert.match(b, /text-align: center;/);
  assert.match(b, /color: #FFFFFF;/);
  assert.match(b, /font: 700 10px\/12px Verdana/);
  // La zone utile du champ, gouttière de 2 px comprise : x 16,05..87,45.
  assert.match(b, /padding: 1\.7px 8\.45px 0 16\.05px;/);
});

/* ── LE FORMULAIRE ────────────────────────────────────────────────────────── */

test('la ligne simple, dans l’ordre et aux largeurs du bytecode', () => {
  const f = JS.slice(JS.indexOf('function panneauRecherche()'), JS.indexOf('function ligneRecherche()'));
  assert.match(f, /etiquetteRecherche\('pseudo :', 60\)/);
  assert.match(f, /pseudo\.maxLength = 18;/);
  assert.match(f, /espaceRecherche\(4\)/);
  assert.match(f, /boutonRecherche\('ok', 'rc-ok'\)/);
  assert.match(f, /boutonRecherche\('avancée', 'rc-avance'\)/);
  assert.match(f, /avance\.style\.marginLeft = '3px';/);            // `dx: 3`
  // `restrict` : les touches interdites ne s'écrivent pas.
  assert.match(f, /filtrerSaisie\(pseudo, \/\[\^0-9A-Za-z\]\/g\);/);
  assert.match(f, /filtrerSaisie\(av\.querySelector\('\.rc-agemin'\), \/\[\^0-9\]\/g\);/);
});

test('les quatre lignes avancées, avec l’ordre d’origine des sexes', () => {
  const f = JS.slice(JS.indexOf('var av = document.createElement'), JS.indexOf("form.appendChild(av);"));
  // sexe : l'étiquette de 48, puis Masculin 76, Feminin 76, Tous 60.
  assert.match(f, /etiquetteRecherche\('sexe :', 48\)/);
  const radios = [...f.matchAll(/radioRecherche\('([MF]?)', '([^']+)', (\d+)/g)]
    .map((m) => m[2] + ':' + m[3]);
  assert.deepStrictEqual(radios, ['Masculin:76', 'Feminin:76', 'Tous:60']);
  // « Tous » est celui qui est coché — c'est lui qui porte la valeur vide.
  assert.match(f, /radioRecherche\('', 'Tous', 60, true\)/);
  // âges : deux étiquettes de 66, deux champs de 40 (maxChars 2), 12 entre eux.
  assert.match(f, /etiquetteRecherche\('age min :', 66\)/);
  assert.match(f, /espaceRecherche\(12\)/);
  assert.match(f, /etiquetteRecherche\('age max :', 66\)/);
  // pays et région : deux étiquettes de 50, deux menus.
  assert.match(f, /etiquetteRecherche\('pays :', 50\)/);
  assert.match(f, /etiquetteRecherche\('region :', 50\)/);
});

/*
 * LA TEINTE DU FORMULAIRE — rien n'y est gris.
 *
 * `cp.Document.newElement` (0x659a5) puise dans le style du document, et le
 * style du document est `frSystem` : `Standard.getWinStyle` (0x49659) lui donne
 * `color = [white, green, white]`, dont `Standard.getDocStyle` (0x4989b) tire
 * `inputColor = color[1]` (le VERT) et `outlineColorNum = color[0].shade`
 * (#DDDDDD). Un `type: "button"` prend l'art `butPushStandard` (#465) — la
 * GÉLULE ROSE, la même que « créer un salon » — et `but.Push.init` (0x80a10)
 * la pose sur un `drawSmoothSquare` rempli de `color`, large de
 * `gfx + 2·outline` : un liseré de 2 px autour d'elle. Les boutons ne sont donc
 * pas gris, ils sont roses cerclés de gris clair, et ils DESCENDENT de 1 px au
 * survol, de 2 à l'appui (`setPos`, 0x80d9e).
 */
test('les champs sont VERTS (inputColor) et les boutons ROSES (butPushStandard)', () => {
  const f = CSS.slice(CSS.indexOf('body.bureau-frutiz #recherche-panel .rc-in {'),
    CSS.indexOf('body.bureau-frutiz #recherche-panel .rc-liste {'));
  // les champs et les menus : la gélule `inputField` teintée en vert
  assert.match(f, /\.rc-in \{[\s\S]{0,240}?background: #DDFFBB; box-shadow: inset 0 0 0 1px #94DB39;/);
  assert.match(f, /\.rc-combo \{[\s\S]{0,240}?background: #DDFFBB; box-shadow: inset 0 0 0 1px #94DB39;/);
  // le liseré de `but.Push`, puis la gélule dedans
  assert.match(f, /\.rc-but \{[\s\S]{0,320}?background: #DDDDDD;/);
  assert.match(f, /\.rc-but::before \{[\s\S]{0,200}?background: #FFAAAD; box-shadow: inset 0 0 0 1\.5px #F28687;/);
  assert.match(f, /\.rc-but::after \{[\s\S]{0,220}?border-top: 1px solid #FFEAEC;/);
  assert.match(f, /color: #660000;/);
  // `setPos(0/1/2)` : la gélule descend
  assert.match(f, /\.rc-but:hover::before,[\s\S]{0,120}?transform: translateY\(1px\);/);
  assert.match(f, /\.rc-but:active::before,[\s\S]{0,120}?transform: translateY\(2px\);/);
});

test('le bouton « avancée » n’EXISTE pas sans le Bananocle', () => {
  // `getSearchLines` (0x863d4) ne le pousse dans la ligne que si
  // `flAdvanceAvailable` : ce n'est pas un bouton grisé, c'est un absent.
  assert.match(CSS, /#recherche-panel \.rc-avance \{ display: none; \}/);
  assert.match(CSS, /#recherche-panel\.avance-possible \.rc-avance \{ display: inline-block; \}/);
  assert.match(CSS, /#recherche-panel \.rc-avancee \{ display: none; \}/);
  assert.match(CSS, /#recherche-panel\.avancee-ouverte \.rc-avancee \{ display: block; \}/);
});

test('déplier la recherche avancée pose le Bananocle sur sa propre bouille', () => {
  // `toggleAdvance` (0x8597f) → `box.onAdvanceSearch(flAdvance)` (0x98a5d) →
  // `me.useFrutibouille(b ? "Bananocle" : "Normal")`.
  const t = JS.slice(JS.indexOf('function basculerAvancee()'), JS.indexOf('var RC_TITRE_PAYS'));
  assert.match(t, /rcEtat\.avance = !rcEtat\.avance;/);
  assert.match(t, /P\.porterBananocle\(rcEtat\.avance\)/);
  assert.match(t, /ajusterFenetreRecherche\(\)/);
  assert.match(LIGHT, /porterBananocle: function \(avance\) \{[\s\S]{0,240}?accessoireNomme\(avance \? "Bananocle" : "Normal"\)/);
  assert.match(LIGHT, /bananocle: function \(cb\) \{/);
});

test('l’inventaire est demandé même sans ouvrir la feuille mobile', () => {
  // `me.hasItem(833)` répond depuis l'ident, d'époque. Ici la liste n'arrivait
  // qu'à l'ouverture de « Ma Frutibouille », que le bureau n'ouvre jamais.
  assert.match(LIGHT, /function loadAccessories\(apres\) \{/);
  assert.match(LIGHT, /if \(!accList\.length && cb\) \{\s*\n\s*loadAccessories\(function \(\) \{ cb\(!!accessoireNomme\("Bananocle"\)\); \}\);/);
});

/* ── LA REQUÊTE ───────────────────────────────────────────────────────────── */

test('`launchSearch` : les champs de la requête, un par un', () => {
  const c = LIGHT.slice(LIGHT.indexOf('chercher: function (form, depart)'),
    LIGHT.indexOf('window.RechercheBureau = {') + 6000);
  assert.match(c, /var q = \{ s: Math\.max\(0, Number\(depart\) \|\| 0\), l: 6 \};/);
  // MOINS DE DEUX LETTRES : le pseudo ne part pas.
  assert.match(c, /if \(pseudo\.length >= 2\) q\.u = pseudo;/);
  assert.match(c, /if \(genre\.length\) q\.sx = genre;/);
  // Deux BORNES D'ANNIVERSAIRE. `bd` retranche un an de plus : c'est d'origine
  // (« age max : 20 » veut dire « jusqu'à 20 ans révolus »).
  assert.match(c, /if \(m > 0\) q\.bdm = \(j\.an - m\) \+ j\.moisJour;/);
  assert.match(c, /q\.bd = \(j\.an - Number\(aMax\) - 1\) \+ j\.moisJour;/);
  // La région ne part que si le pays est choisi — elle est imbriquée d'époque.
  assert.match(c, /if \(co\) \{\s*\n\s*q\.co = co;[\s\S]{0,140}?if \(rg\) q\.rg = rg;/);
});

test('la pagination bouge `s`, elle ne refait pas la requête', () => {
  const p = JS.slice(JS.indexOf('function pageSuivante()'), JS.indexOf('function basculerAvancee()'));
  assert.match(p, /if \(!\(rcEtat\.depart < rcEtat\.total - RC_BLOC_MAX\)\) return;/);
  assert.match(p, /rcEtat\.depart = Math\.min\(rcEtat\.total, rcEtat\.depart \+ RC_BLOC_MAX\);/);
  assert.match(p, /if \(!\(rcEtat\.depart > 0\)\) return;/);
  assert.match(p, /rcEtat\.depart = Math\.max\(rcEtat\.depart - RC_BLOC_MAX, 0\);/);
  // `flLoading` ferme la porte des deux côtés.
  assert.match(p, /function pageSuivante\(\) \{\s*\n\s*if \(rcEtat\.charge\) return;/);
  assert.match(p, /function pagePrecedente\(\) \{\s*\n\s*if \(rcEtat\.charge\) return;/);
});

test('`onSearch` : le total ne se relit qu’à la première page', () => {
  const h = LIGHT.slice(LIGHT.indexOf('case "bn": {'), LIGHT.indexOf('case "z": {'));
  assert.match(h, /Math\.ceil\(bnDeb \/ bnPar \+ 1\)/);
  assert.match(h, /attr\(xml, "s"\) === "0" \? Number\(attr\(xml, "n"\)\) \|\| 0 : null/);
  // Un `k` en attribut, c'est une erreur — et la recherche s'arrête là.
  assert.match(h, /if \(\/\\bk="\/\.test\(xml\)\)/);
});

test('le pied compte comme `displayBloc`', () => {
  const d = JS.slice(JS.indexOf('function afficherResultats('), JS.indexOf('function texteDePage('));
  assert.match(d, /var nbPages = Math\.ceil\(rcEtat\.total \/ RC_BLOC_MAX\);/);
  assert.match(d, /page \+ '\/' \+ nbPages \+ ' - ' \+ rcEtat\.total\s*\n\s*\+ ' réponse' \+ \(rcEtat\.total > 1 \? 's' : ''\)/);
});

/* ── UNE ENTRÉE DU LISTING ────────────────────────────────────────────────── */

test('les coordonnées de `cp.SearchSlot`, au pixel', () => {
  const s = CSS.slice(CSS.indexOf('#recherche-panel .rc-slot {'), CSS.indexOf('#recherche-panel .rc-pied {'));
  assert.match(s, /width: 270px; height: 50px;/);
  assert.match(s, /\.rc-voyant \{\s*\n\s*position: absolute; left: 3px; top: 1px; width: 16px; height: 16px;/);
  assert.match(s, /\.rc-drapeau \{\s*\n\s*position: absolute; left: 3px; top: 23px; width: 16px; height: 16px;/);
  assert.match(s, /\.rc-bouille \{\s*\n\s*position: absolute; left: 24px; top: 0; width: 44px; height: 44px;/);
  assert.match(s, /\.rc-doc \{\s*\n\s*position: absolute; left: 76px; top: 1px; width: 190px; height: 44px;/);
  // La plaque de `updateInfoBackground` : x 74, w = 270 − (74 + 2) = 194.
  assert.match(s, /\.rc-slot::before \{\s*\n\s*content: ""; position: absolute; left: 74px; top: 0; width: 194px; height: 44px;/);
  // `curve: 4` + `outline: 2` → 6 au bord extérieur.
  assert.match(s, /border-radius: 6px;/);
});

test('le GENRE décide de la couleur — le vert aux garçons, le rose au reste', () => {
  const s = CSS.slice(CSS.indexOf('#recherche-panel .rc-slot {'), CSS.indexOf('#recherche-panel .rc-pied {'));
  // le rose par défaut (colorSet.pink : #FEC9C9 / #FEABAB), le vert en M
  assert.match(s, /\.rc-slot::before \{[\s\S]{0,400}?#FEC9C9;\s*\n\s*border: 2px solid #FEABAB;/);
  assert.match(s, /\.rc-slot\[data-genre="M"\]::before \{[\s\S]{0,200}?#CCF599;\s*\n\s*border-color: #ADE76B;/);
  // et l'encre du document suit : #BA4444 (frRoomList) ou #335511 (frSheet)
  assert.match(s, /\.rc-doc \{[\s\S]{0,240}?color: #BA4444;/);
  assert.match(s, /\.rc-slot\[data-genre="M"\] \.rc-doc \{ color: #335511; \}/);
  // le JS pose l'attribut, et le genre INCONNU va au rose comme les filles
  assert.match(JS, /d\.setAttribute\('data-genre', info\.genre === 'M' \? 'M' : 'F'\);/);
});

test('les deux lignes du document, à leurs formats', () => {
  const s = CSS.slice(CSS.indexOf('#recherche-panel .rc-slot {'), CSS.indexOf('#recherche-panel .rc-pied {'));
  assert.match(s, /\.rc-nom \{\s*\n\s*flex: 0 0 110px; width: 110px;\s*\n\s*font: 700 11px Verdana/);
  assert.match(s, /\.rc-age \{\s*\n\s*flex: 0 0 60px; width: 60px; font: 400 10px Verdana/);
  assert.match(s, /\.rc-reg,[\s\S]{0,80}?\.rc-ville \{\s*\n\s*flex: 1 1 auto; min-width: 0; text-align: right;\s*\n\s*font: 400 10px Verdana/);
  assert.match(JS, /age\.textContent = info\.age \+ ' ans';/);
});

test('le voyant : le jeu s’il y en a un, sinon le pip de présence', () => {
  const b = JS.slice(JS.indexOf('function blocRecherche(info)'), JS.indexOf('function hauteurRecherche()'));
  assert.match(b, /if \(info\.presence !== 0 && info\.jeu\) \{\s*\n\s*ico\.src = voyantUrl\(info\.jeu\);/);
  assert.match(b, /var pr = Math\.max\(0, Math\.min\(2, Number\(info\.presence\) \|\| 0\)\);/);
  assert.match(b, /recherche-presence-' \+ pr \+ '\.svg/);
  // `select()` : la fiche s'ouvre au clic, où qu'on clique dans le bloc.
  assert.match(b, /if \(P && P\.ouvrirFiche\) P\.ouvrirFiche\(info\.pseudo\)/);
});

test('le drapeau : l’index du pays devient une image de `countryBox`', () => {
  const d = JS.slice(JS.indexOf("var RC_DRAPEAUX ="), JS.indexOf('var rcPanneau = null;'));
  assert.match(d, /\['fr', 'be', 'lu', 'ca', 'ch', 'ot'\]/);
  // un code vide → « ot » (`initScreen` le réécrit), et Flash borne les autres
  assert.match(d, /if \(s === ''\) return 'ot';/);
  assert.match(d, /if \(n < 1\) return RC_DRAPEAUX\[0\];/);
  assert.match(d, /Math\.min\(Math\.round\(n\), RC_DRAPEAUX\.length\) - 1/);
});

/* ── LES DEUX MENUS DÉROULANTS ────────────────────────────────────────────── */

test('les menus pays/région suivent `box.onCountryChange`', () => {
  const m = JS.slice(JS.indexOf('function majComboRegion()'), JS.indexOf('function optionRecherche('));
  // Un TITRE en tête, de clé vide : tant qu'on n'en sort pas, rien ne part.
  assert.match(m, /sel\.appendChild\(optionRecherche\('', RC_TITRE_AVANT_PAYS\)\);/);
  assert.match(m, /sel\.appendChild\(optionRecherche\('', RC_TITRE_SANS_REGION\)\);/);
  // `regionName` (l'attribut `tn`) titre le menu, `displayCode` préfixe.
  assert.match(m, /String\(pays\.nomRegion \|\| ''\)\.toLowerCase\(\)/);
  assert.match(m, /pays\.afficherCode \? \(r\.code \+ ' - ' \+ r\.nom\) : r\.nom/);
  // `updateRegionCombo` finit par `valSetTo(0)`.
  assert.match(m, /sel\.selectedIndex = 0;/);
  // La seule phrase connue au mot près (repli codé en dur dans `init`).
  assert.match(JS, /var RC_TITRE_AVANT_PAYS = 'Choisissez un pays !';/);
});

test('le serveur sert `tn` et `d`, et garde l’ORDRE du fichier de langue', () => {
  // Les clés « 01 »… « 10 » sont pour partie des index entiers aux yeux de
  // JavaScript : un objet les remonterait en tête (10, 11, 12… puis 01, 02).
  assert.match(SERVEUR, /const regions = \[\];[\s\S]{0,200}?regions\.push\(\{ code: r\[1\], nom: r\[2\] \}\)/);
  assert.match(SERVEUR, /nomRegion: tn \? tn\[1\] : '',/);
  assert.match(SERVEUR, /afficherCode: !!\(dc && dc\[1\] === '1'\),/);
  assert.match(SERVEUR, /regions: t\[c\]\.regions\.map\(\(r\) => \(\{ code: r\.code, nom: r\.nom \}\)\)/);
  // et la fiche perso lit toujours le bon nom dans le nouveau tableau
  assert.match(SERVEUR, /pays\.regions\.find\(\(r\) => r\.code === cible\)/);
});

/* ── LE SERVEUR ───────────────────────────────────────────────────────────── */

test('`searchuser` envoie des INDEX de pays et de région, pas du texte libre', () => {
  const s = SERVEUR.slice(SERVEUR.indexOf("case 'searchuser': {"),
    SERVEUR.indexOf("case 'listbouilles': {"));
  assert.match(s, /country: String\(ud\.countryIndex \|\| '1'\),/);
  assert.match(s, /region: String\(ud\.regionIndex \|\| '1'\),/);
  assert.match(s, /country: String\(row\.country_index \|\| '1'\),/);
  assert.match(s, /region: String\(row\.region_index \|\| '1'\),/);
  // et plus rien ne lit les colonnes libres
  assert.doesNotMatch(s, /ud\.country \|\| 'FR'/);
  assert.doesNotMatch(s, /row\.country \|\| 'FR'/);
});

test('la base rapporte bien les deux colonnes d’index', () => {
  const DB = fs.readFileSync(path.join(ROOT, 'db.js'), 'utf8');
  const l = DB.slice(DB.indexOf('async function listAllUsers()'), DB.indexOf('async function deleteUser'));
  assert.match(l, /country_index, region_index/);
});

/* ── LES DESSINS ──────────────────────────────────────────────────────────── */

test('les dessins sortis du SWF sont là', () => {
  const D = path.join(ROOT, 'public/frutiz/sprites');
  for (const f of ['recherche.svg', 'recherche-voyant-fond.svg',
    'recherche-presence-0.svg', 'recherche-presence-1.svg', 'recherche-presence-2.svg',
    'recherche-pays-fr.svg', 'recherche-pays-be.svg', 'recherche-pays-lu.svg',
    'recherche-pays-ca.svg', 'recherche-pays-ch.svg', 'recherche-pays-ot.svg']) {
    assert.ok(fs.existsSync(path.join(D, f)), f + ' manque');
  }
  const man = JSON.parse(fs.readFileSync(path.join(D, 'recherche.json'), 'utf8'));
  // mcSearchButton est UN SEUL dessin — trois profondeurs, pas trois états.
  assert.deepStrictEqual(man.bouton.images, ['recherche']);
  assert.deepStrictEqual(man.pays.codes, ['fr', 'be', 'lu', 'ca', 'ch', 'ot']);
  // ch222 n'a que TROIS images : hors ligne, en ligne, invisible.
  assert.strictEqual(man.presence.images.length, 3);
});
