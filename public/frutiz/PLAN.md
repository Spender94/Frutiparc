# Le bureau Frutiz en light — carnet de transcription

Reproduction MÉTICULEUSE de main.swf sur /light desktop. Ce carnet consigne ce
qui a été lu dans le bytecode (scripts/disasm-as2.js sur legacy/main.swf), ce
qui a été mesuré sur le rendu Ruffle local, et ce qui reste à faire. Chaque
valeur porte son origine — un décalage dans le désassemblage, ou un pixel
échantillonné.

## La fenêtre standard (`_global.WinStandard`, DoInitAction sprite#747, 0x5310e)

### Le chrome (drawInterface, 0x54c96 ; mesures sur rendu Ruffle)

- Rectangle arrondi **rayon 10**, tracé par `FEMC.drawCustomSquare` :
  **contour 1 px** (`darkest`), **liseré 2 px** (`shade`), **fond `main`**.
- Style « global » (getOldWinStyle 0x493e3, confirmé au pixel sur la fenêtre
  « Veuillez patienter… ») : main `#FFFFFF`, inline `#DDDDDD`,
  outline `#444444`.
- **Ombre portée** (dropShadow, 0x54f82) : dégradé **radial noir, alpha 50 → 0**,
  rayon 17, sur un rectangle décalé de 10 (la lueur ne déborde qu'en bas-droite).
- Bords du cadre (initFrameSet, 0x547f9) : un arbre `Frame` —
  top/bottom **h 6**, left/right **w 6** autour du centre. Les marges de la
  fenêtre viennent de là.
- Titre : gras 11 px `#444444`, précédé de la **pastille** — le clip `rond`
  (export #2, disque plat 100×100 `#DDDDDD`) teinté à la couleur du type de
  fenêtre. Mesuré : disque ~9 px à ~10 px du bord, texte à la suite.
- Profondeurs (0x55c99) : ghost 1400, frameSet 200→800, butResize 160,
  frameBg 112, interface 100.

### Le déplacement — LE FANTÔME (initDrag 0x53b7b, endDrag 0x53d6d, applyGhost 0x53dbe)

Le geste d'époque, au mot près :

1. `initDrag` attache **winGhost** (export #162) à la taille de la fenêtre,
   note `decalx/decaly` = la souris au moment de la prise, et pose un
   `Mouse.addListener.onMouseMove` qui fait suivre le fantôme **rigidement**
   (position = fenêtre + souris − décalage). **La fenêtre ne bouge pas.**
2. `endDrag` retire le listener, `applyGhost` copie la position du fantôme
   dans `pos` et détruit le fantôme, puis `updateDeskPos` → `recal` (bornage)
   → `moveToPos`.
3. `moveToPos` (0x55b47) : si `flMoveAnim` (préférence `win_flMoveAnim`,
   endInit 0x539bf), la fenêtre **glisse** vers sa place —
   `animList.addSlide(this, 'slide', 3)` — sinon elle saute.

Le fantôme (win.Ghost, clip #162) est une **silhouette** : 4 coins `c1..c4`
(forme #157, un arc de 10×10 épais de 2, blanc) + 4 bandes `s1..s4`
(forme #159, un trait 20×2 blanc) étirées entre eux — soit exactement un
contour blanc de 2 px aux coins arrondis de 10. Reproduit en CSS
(`border: 2px solid #fff; border-radius: 10px`), rendu identique.

### Le redimensionnement (initResize 0x53a2e, endResize 0x53b2a)

- `flResizable` par défaut **vrai** (endInit) ; la poignée `butResize`
  (export `resizeIcon` #355, dessin 12×12 gris/rose — extrait tel quel) se
  place à `pos.w − 20, pos.h − 20` (updateDeskSize 0x53f85).
- Même protocole fantôme : `decalSizeX = pos.w − _xmouse` (l'écart
  poignée-coin est conservé), suivi par `setInterval(watchSize, 25 ms)` avec
  les **minima** `minimum.w/h` (= `frameSet.minInt`, onFrameSetUpdate 0x54ad2),
  application au lâcher.

### Le bornage (recal, 0x54126)

`pos.w = max(minimum.w, min(pos.w, mcw − cornerX))`, pareil en h ; x/y bornés
au bureau :

```js
pos.x = max(cornerX, min(mcw − pos.w, pos.x))
pos.y = max(cornerY, min(mch − pos.h, pos.y))
```

C'est là que se joue **la place d'ouverture**, et elle surprend : `init`
(0x53807) donne à la fenêtre `pos = {x: 0, y: 0, w: 0, h: 0}` quand elle n'en a
pas, donc `recal` la pose **DANS LE COIN** — `(cornerX, cornerY)`, sous la main
bar et contre la bande des contacts — **à son minimum**. Il n'y a pas
d'escalier d'ouverture dans main.swf : deux fenêtres neuves se recouvrent, et
c'est le comportement d'époque. Deux classes seulement dérogent, en écrivant
leur `pos` dans leur propre `init` :

| classe | `pos` | et ensuite |
|---|---|---|
| `win.Explorer` (0x92447) | `{50, 50, 400, 400}` | `moveToCenter()` — au milieu |
| `win.ViewMail` (0xc8910) | `{50, 50, 500, 400}` | rien — donc `(50, cornerY)` |

`moveToCenter` (0x55bf5), lui, **soustrait** le coin au lieu de l'ajouter :

```js
pos.x = (mcw − (main.cornerX + pos.w)) / 2
pos.y = (mch − (main.cornerY + pos.h)) / 2
```

— la fenêtre se pose donc un demi-coin plus haut et plus à gauche que le vrai
centre, puis `recal` la ramène dans le cadre.

**Et le coin ?** `main.cornerY = 106` (0x6b5e2), ramené à `10 + 96 × !flHalfHide`
quand la main bar se replie (0x6c5ca) ; `main.cornerX = sideList.wSide` = **9**,
et `wMain + wSide` = **129** quand la bande des contacts est dépliée (0xa0d63,
avec `wSide = 9` et `wMain = 120` en 0xa1708).

### La taille d'ouverture (frameSet.minInt)

`pos.w`/`pos.h` partant de zéro, c'est `minimum` qui donne la taille — et
`minimum` vaut `frameSet.minInt` (`onFrameSetUpdate`, 0x54acb), que
`Frame.updateMinInt` (0x479ba) remonte depuis le contenu :

```js
if (type === "compo") {
  minInt.w = max(min.w, path.min.w) + margin.x.min + marginInt.x.min
} else {                      // un cadre de cadres
  //  type "w" : enfants EMPILÉS   → w = le plus large,  h = la somme
  //  type "h" : enfants CÔTE À CÔTE → h = le plus haut, w = la somme
}
```

L'arbre qu'`initFrameSet` (0x547f9) bâtit autour du contenu est toujours le
même — `top` (min h 6) portant `winTopBar` (min 200 × 20), `left`/`right`
(min w 6), `bottom` (min h 6) — d'où, en deux lignes :

```
minW = max(200, contenu.w + 12)
minH = contenu.h + 26
```

Les contenus, eux, sont écrits classe par classe. Relevé :

| fenêtre | classe | contenu déclaré | minimum |
|---|---|---|---|
| Scores | `win.Score` #869 | `tree` 160×60 ∥ `showFrame` 300×200 | 472 × 226 |
| Boutique | `win.Shop` #795 | `menuFrame` 140×60 ∥ `showFrame` 300×200 | 452 × 226 |
| Préférences | `win.Pref` #831 | `menuFrame` 140×60 ∥ `showFrame` 200×200 | 352 × 226 |
| Salons publics | `win.RoomList` #894 | `roomListFrame` 200×240 | 212 × 266 |
| Événements / Historique | `win.Log` #750 | `showFrame` 300×200 | 312 × 226 |
| Explorateurs | `win.Explorer` #833 | `navigatorFrame` 80×28 / `fileIconList` 100×100 | 200 × 154 |

Ces minima ne changent rien à la taille D'OUVERTURE — chaque relevé 1:1 est
déjà au-dessus — mais ils bornent la poignée de redimensionnement, et c'est
`recal` qui fait grandir une fenêtre passée dessous.

### Les boutons du haut (genTopIconList, 0x54c24) — EXTRAITS

WinStandard n'en déclare qu'UN : `butGroup` → frame 1, `onPress → tryToClose`.
L'art vit dans des DefineButton2 que l'aplatisseur commun ne traverse pas :
scripts/extract-frutiz-bureau.js lit leurs BUTTONRECORDs à l'octet et compose
chaque état en SVG (sprites/butWinTop*.svg + bureau.json).

- `butGroupWinTop` (#180) place les boutons **#173/#176/#179** sur ses trois
  images : 1 = FERMER (la croix, plaque beige), 2 = l'ENROULEMENT/onglet
  (les traits, plaque bleue), 3 = l'AIDE (le « ? », plaque verte).
- Le détail d'époque : au REPOS seul le glyphe se dessine ; la plaque 21×21
  n'arrive qu'au survol (état over), l'appui la fonce (down). Les trois états
  sont normalisés sur le cadre commun 21×21 pour que rien ne saute.
- `winTopBar` (#442), `mainBar` (#3) et `DesktopBg` (#12) sont des clips
  CONTENEURS VIDES : leurs visuels se construisent au runtime par leurs
  classes (cp.WinTopBar, MainBar, Desktop) — rien à aplatir, tout à
  transcrire.

### Modes (updatePos/updateSize 0x53e3d/0x53ead)

`box.mode` vaut `desktop` ou `tab` : une fenêtre peut se ranger en ONGLET
(updateTabPos la colle à `main.cornerX/cornerY`, pleine zone). C'est le
second bouton du bandeau — à brancher quand les onglets du bureau (la barre
« Bureau ») seront portés.

## Le décor (mesures Ruffle, reference-2-bureau.png)

- Fond du bureau sans fond d'écran : `#ADE76B` (aplat).
- Main bar : barre blanche arrondie en haut à gauche, ~1250×90 ;
  frutimandala à droite ; pilule « N en ligne » verte sombre au coin.
- Onglet « Bureau » (pastille orange) sous la main bar ; languette CONTACTS
  sur le bord gauche.
- Étiquettes des icônes du bureau : texte vert TRÈS sombre, cœur
  anticrénelé mesuré à `#335511` sur l'aplat `#ADE76B`
  (ref-bureau-propre.png ; la police pixel d'époque, sans halo blanc).

## Le colorSet par type de fenêtre

### `Standard.getWinStyle` (0x4957f) — DÉCODÉ

La fonction ne calcule rien : elle rend une TABLE, `style[type].color` = un
TABLEAU de familles de `_global.colorSet`. (Le corps est un `DefineFunction2`
à `flags=0x12a`, donc `suppressThis` + `preloadGlobal` : le registre 1 y est
`_global`, pas `this`.)

**Attention au sens de lecture.** `InitArray` dépile depuis le sommet : la
valeur empilée en DERNIER devient `[0]`. Le désassemblage liste donc les
familles à l'ENVERS de leurs indices. Deux preuves indépendantes, plus bas —
la fenêtre standard et l'écran de la bouille. Table remise à l'endroit :

| type | `color[0]` | `color[1]` | `color[2]` |
|---|---|---|---|
| `global` | **white** | green | — |
| `frFileStandard` | yellow | yellow | — |
| `frFileTrash` | green | green | — |
| `frFileBlackList` | purple | purple | — |
| `frSystem` | white | green | white |
| `frRoomList` | pink | pink | pink |
| `frScore` | orange | orange | orange |
| `frScoreLight` | orange | orange | orange |
| `frSheet` | **green** | green | pink |
| `frKikooz` | brown | brown | — |
| `frDef` | green | green | — |
| `frInfo` | yellow | yellow | — |

`frSystem` porte en plus `bgInfo: {inline: 0}`. Seuls `global` et `frSheet`
changent de lecture une fois remis à l'endroit — les autres sont symétriques.

Quirk d'époque relevé au passage : `WinDoc.initDoc` (0xa6f7e) va chercher
`getWinStyle().frDir`, un type qui n'existe PAS dans la table — ce style-là
est donc toujours `undefined`.

### `Standard.getOldWinStyle` (0x493e3) — l'ancienne table, EN CLAIR

Celle-là n'indirecte rien : elle écrit ses couleurs en dur. C'est elle qui
sert de témoin, et elle donne aussi quatre styles de CONTENU tout faits :

| style | outline | inline | curve | main | inline | outline | extras |
|---|---|---|---|---|---|---|---|
| `global` | 1 | 2 | 10 | `#FFFFFF` | `#DDDDDD` | `#444444` | — |
| `content` | 2 | 1 | 3 | `#D6F7B5` | `#BAF082` | `#DDDDDD` | dark `#94DB39`, overdark `#66AA22`, light `#E8FFC0` |
| `content2` | 2 | 2 | 3 | `#E4F499` | `#DCEE5B` | `#DDDDDD` | — |
| `content3` | 2 | 2 | 3 | `#FFDFDF` | `#FFBBBB` | `#DDDDDD` | dark `#EE8888`, text `#772222`, textdark `#550000` |
| `content4` | 2 | 0 | 3 | `#FFFFFF` | `#DDDDDD` | `#DDDDDD` | dark `#AAAAAA`, overdark `#888888` |

Les extras de `content` sont EXACTEMENT `green.dark` et `green.darker`, ceux
de `content4` exactement `white.dark` et `white.darker` : l'ancienne table et
les rampes sont bien deux écritures de la même palette.

### Les RAMPES de `colorSet`

Chaque famille est une rampe de neuf crans :
`lightest, lighter, light, main, shade, dark, darker, darkest, overdark`.
`_global.colorSet` lui-même n'est PAS construit dans main.swf (il vient d'un
SWF chargé en amont, comme `displayParameters`), mais **deux familles y sont
écrites en clair** — le style d'arbre de 0x49e15 les recopie telles quelles :

- **green** — lightest `#FFFFFF`, lighter `#F3FFD5`, light `#DDFFBB`,
  main `#CCF599`, shade `#ADE76B`, dark `#94DB39`, darker `#66AA22`,
  darkest `#558811`, **overdark `#335511`** ;
- **white** — lightest/lighter/light/main `#FFFFFF`, shade `#DDDDDD`,
  dark `#AAAAAA`, darker `#888888`, darkest `#444444`, overdark `#222222`.

Deux recoupements confirment qu'il s'agit bien des familles globales et non
de littéraux locaux : `green.overdark` = `#335511` est exactement la couleur
de repli documentée pour les étiquettes du bureau
(`_global.colorSet.green.overdark`, cf. server.js) ET la couleur mesurée au
pixel sur le rendu ; et `green.shade` = `#ADE76B` est l'aplat du bureau.
Toute la quincaillerie du bureau se lit alors dans la rampe blanche :
`#DDDDDD` = white.shade (les liserés), `#444444` = white.darkest (le contour),
`#888888` = white.darker (l'anneau de la bouille).

Restent inconnues : **yellow, pink, purple, orange, brown** — elles ne
peuvent venir que du SWF qui pose `_global.colorSet`, ou d'un relevé au pixel
sur une fenêtre de chaque type. Trois relevés déjà faits :

- **Salons publics** (`frRoomList`, la teinte ROSE, ref-salons.png) :
  pastille fraise `#E01813` ; fond de liste `#FEC9C9`, lignes alternées
  `#FEABAB` / `#FEC9C9`, texte des salons `#DA8484` ; bouton « Créer votre
  salon » plaque `#DD8487` bord `#B35557` ; champ de saisie `#DDFFBB`.
- **Mon historique** (la teinte ORANGE, ref-historique.png) : pastille
  `#FF9900` — exactement la pastille de l'onglet « Bureau » de la barre
  d'onglets ; corps de fenêtre BLANC ; cartes d'entrées `#CCF599` bordées
  d'un trait fin `#B6E580` (halo anticrénelé `#DFF7C1`) ; texte des entrées
  gras `#335511` au cœur plein (346 px purs relevés) — LE MÊME vert très
  sombre que les étiquettes d'icônes ; pagination texte `#A4A4A4`, flèches
  roses `#FFEAEC`. Titre de fenêtre `#444444` (confirme getOldWinStyle).
  Écart de comportement relevé : le SWF affiche les entrées dans l'ordre
  serveur (la plus ancienne d'abord), le journal light la plus récente
  d'abord — à trancher à l'étape du panneau.
- **Alerte** (« Veuillez patienter », la teinte CITRON) : pastille `#E6D52F`,
  plaque `#F3E549`.
- **Onglet « Bureau »** (la barre d'onglets du bureau) : onglet BLANC,
  étiquette « Bureau » grasse `#000000`, pastille `#FF9900` ; le reste de la
  rangée est une bande vert clair arrondie, soulignée d'un trait sombre.

À noter : le CORPS d'une fenêtre reste blanc (`#FFFFFF`) — la teinte
n'habille que la pastille et le contenu du panneau (listes, cartes, boutons).
Détail d'époque confirmé sur ref-historique.png : au repos, les boutons du
bandeau montrent leur GLYPHE SEUL (les traits bleus de l'enroulement, la
croix) — la plaque 21×21 n'apparaît qu'au survol, comme extrait.

## La loi de tracé des cadres (`drawCustomSquare`, 0x4b425)

Tout le mobilier du bureau — l'écran de la bouille, l'encart, les panneaux,
les boutons — passe par UNE seule primitive. La connaître, c'est pouvoir
peindre n'importe quel cadre sans plus rien mesurer.

    drawSmoothSquare(mc, pos, couleur, rayon)   // un rectangle arrondi PLEIN
    drawCustomSquare(mc, pos, o, chrome)

`o = { outline, inline, curve, color: { outline, inline, main } }` ;
`pos = {x, y, w, h}`. Les trois épaisseurs valent 0 si absentes. La fonction
empile alors, du dessous vers le dessus :

1. si `outline > 0` — un arrondi de rayon **`curve + outline`**, couleur
   `color.outline`, débordant de `outline` sur les quatre côtés :
   `(x−outline, y−outline, w+2·outline, h+2·outline)` ;
2. si `inline > 0` — un arrondi de rayon **`curve`**, couleur `color.inline`,
   exactement sur `pos` ;
3. toujours — un arrondi de rayon **`max(curve − inline, 0)`**, couleur
   `color.main`, rentré de `inline` : `(x+inline, y+inline, w−2·inline,
   h−2·inline)`.
4. si `chrome` est vrai — **LE REFLET**, par-dessus tout : un dégradé LINÉAIRE
   blanc sur blanc, alphas `80 → 0` aux ratios `0 → 255` (donc ~31 % de blanc
   en haut, transparent en bas), matrice `box` tournée de `1.57` rad (donc
   vertical) sur une boîte de `(x, y, w, 10)` ; il est peint sur un arrondi de
   rayon `max(curve − inline, 0)` haut de **10 px seulement**, rentré de
   `inline`. C'est CE dégradé-là, et pas un autre, qui fait la brillance des
   cadres d'époque.

### Preuve n° 1 — la fenêtre standard, et le sens des tableaux

`WinStandard.drawInterface` (0x54c96) efface, pose l'ombre portée, puis :

    outline = 1 ; inline = 2 ; curve = 10
    g = this.style.global.color[0]        // this.style = Standard.getWinStyle()
    box = { outline: 1, inline: 2, curve: 10,
            color: { main: g.main, inline: g.shade, outline: g.darkest } }
    if (this.box.mode === 'desktop')
        FEMC.drawCustomSquare(mcInterface, {x:0, y:0, w:pos.w, h:pos.h}, box, true)

Deux choses en tombent. D'abord **le cadre d'une fenêtre ne dépend PAS de son
type** : `drawInterface` lit toujours `style.global`, et le type n'habille que
la pastille et le contenu — ce que le relevé au pixel disait déjà (« le corps
d'une fenêtre reste blanc »).

Ensuite, le sens des tableaux. Le rendu Ruffle donne main `#FFFFFF`, inline
`#DDDDDD`, outline `#444444` — soit `white.main`, `white.shade`,
`white.darkest`, exactement les trois littéraux de `getOldWinStyle().global`.
Il faut donc que `getWinStyle().global.color[0]` soit **white**, alors que le
désassemblage empile green puis white. `InitArray` inverse : dernier empilé =
indice 0. C'est ce qui remet la table ci-dessus à l'endroit.

Et le `true` final, c'est **le reflet**. Mais il tombe ici sur un fond
`main` = `white.main` = `#FFFFFF` : du blanc à 31 % sur du blanc pur ne se
voit pas. Sur une fenêtre du bureau, le reflet est un **no-op d'époque** —
rien à ajouter au CSS. Il ne se met à compter que là où le fond est teinté
(`WinDoc.initDoc`, 0xa6dd0 et 0xa6e85, l'appellent aussi avec `true`).

Le CSS actuel de `.fen` tombe déjà juste, et on sait maintenant pourquoi :
`border-radius: 10px` = `curve`, `border: 1px #444444` = l'outline (dont CSS
arrondit tout seul le bord extérieur à 10 + 1 = 11 = `curve + outline`), et
`inset 0 0 0 2px #DDDDDD` = l'inline (dont le bord intérieur retombe sur
10 − 2 = 8 = `max(curve − inline, 0)`).

### Preuve n° 2 — l'écran de la bouille

`cp.FrutiScreen` (DoInitAction sprite#754, 0x615a7) — l'écran carré qui
encadre la bouille — se peint ainsi (0x61ddc), avec `mainStyleName` par
défaut à `frSystem` (0x61ac4) :

    style = Standard.getWinStyle()[this.mainStyleName]   // frSystem → [white, green, white]
    c0 = style.color[0]   // white
    c1 = style.color[1]   // green
    box = { outline: 2, inline: 1, curve: 6,
            color: { main: c1.darker, inline: c0.darker, outline: c0.shade } }
    content.screen.drawCustomSquare({x:0, y:0, w:width, h:height}, box)
    content.mask.drawSmoothSquare({x:1, y:1, w:width−2, h:height−2}, 0, 6)

En dépliant avec les rampes lues plus haut, ça donne : liseré extérieur de
2 px **`#DDDDDD`** (= white.shade), anneau intérieur de 1 px **`#888888`**
(= white.darker), fond **`#66AA22`** (= green.darker), et la bouille détourée
au rayon 6 rentrée de 1.

Or `#DDDDDD` et `#888888` sont EXACTEMENT les deux teintes relevées au pixel
sur le rendu Ruffle, bien avant d'avoir trouvé `getWinStyle`. Le calcul et la
mesure tombent d'accord sans qu'on ait rien ajusté : les rampes de 0x49e15 /
0x49e62 sont bien `_global.colorSet.green` et `.white`, et la loi de tracé
ci-dessus est la bonne. Elle donne au passage le rayon exact du cadre de la
bouille — **6**, pas 7 comme mesuré à l'œil (le liseré extérieur, lui, est
arrondi à `curve + outline` = 8, ce que le `box-shadow` du CSS reproduit tout
seul en gonflant le rayon de son épaisseur).

## La connexion locale (RÉSOLU le 25/08)

Le boot s'arrêtait après `/xml/services.xml` + `/do/prefdef` : services.xml
annonce `port="${XMLSOCKET_PORT}"`, mais le socketProxy de ruffle.html ne
mappe QUE les ports 5000 (XMLSocket) et 5001 (frutiscore). Aucun changement
produit — c'est au HARNAIS de lancer server.js avec `XMLSOCKET_PORT=5000
FRUTISCORE_PORT=5001` (scratchpad/ref-connecte.js). Chaîne d'un boot sain :
`prefdef` → WS ident → `/do/onident` → `fond` → `prefsavepartial`.

Manies du harnais Ruffle : l'overlay « Click to unmute » avale les clics
(cliquer ~22 s après le chargement, au neutre 700,700, deux fois au besoin) ;
l'éditeur de bouille s'ouvre seul sur un compte neuf (« Valider » à ~(117,442)
en 1400×860) ; les icônes s'ouvrent au DOUBLE-clic ; rangée d'icônes à
y≈163 : Gaspard 286, Mes contacts 363, Corbeille 440, Forum 517, Liste
noire 594, Les salons 671, Mon historique 748, Préférences 826, Scores 903,
Boutique 980, Bouilloscope 1057, Club 1134.

Le protocole fantôme a été VALIDÉ contre le vrai rendu : ref-drag-fantome.png
montre, en pleine prise, la silhouette blanche arrondie qui suit la souris
pendant que la fenêtre « Salons publics » reste en place — exactement la
reproduction light.

## Le rendu 1:1 (la règle de mesure)

ruffle.html joue main.swf en `noScale` dans un conteneur **1380×800**, que
fitFrutiparc étire ensuite (`scale = min(vw/1380, vh/800)`). À viewport
**1380×800 exactement, l'échelle vaut 1** : chaque pixel capturé est un
pixel de scène (scratchpad/ref-1a1.js). Toutes les mesures ci-dessous sont
prises là. (L'en-tête du SWF dit 1024×768 — le noScale le rend caduc ; la
LARGEUR DE RÉFÉRENCE du bureau d'époque est la constante **1370** codée en
dur dans MainBar.update.)

## La main bar (`_global.MainBar`, DoInitAction sprite#775, 0x6afba)

Constantes du prototype (0x6c65f..0x6c6b9) : `dp_tab` 10000, `tabMax` 500,
`infoMax` 8, **`tabSpace` 110**, **`height` 76**, `minWidth` 600,
**`margin` 6**. `init` (0x6b578) pose **`main.cornerY = 106`** — le coin du
bureau sous la barre et sa rangée d'onglets : recal borne les fenêtres LÀ.

- **drawInterface** (0x6b93c) : trois `FEMC.drawSmoothSquare` empilés sur la
  boîte `{x:−10, y:−10, w:w+10, h:height+10}` — le SOMBRE (`darkest`, +2 px
  tout autour, rayon 12) sur mcInterfaceBlack, le LISERÉ (`shade`) puis le
  FOND (`main`, −2 px, rayon 8) sur mcInterface. Décalée de −10, la boîte
  sort de l'écran en haut/gauche : seul le bas-droit s'arrondit à l'écran.
  Vérifié au pixel 1:1 : blanc 0..74, `#DDDDDD` 74..76, `#444444` 76..78.
- **update** (0x6bfc2) : `pos.x = main.cornerX` ;
  **largeur = 1370 − cornerX − (frusion.width + frusion.margin)**, minimum
  `minWidth` ; `maxTab = floor(largeur / tabSpace)` ; drawInterface(w) puis
  frameSet.update().
- **initFrameSet** (0x6bb6c) : l'arbre `Frame` type `h` — `screen` (compo
  **FrutiScreen**, un CARRÉ de côté height−2·margin = 64, style frSystem :
  la bouille), `info` (min w 150 : **cpDigital** 130×45 — le NIV et la
  jauge — au-dessus de la liste des **7 butPushEmoteIcon**, struct 19 px,
  initEmoteIconList 0x6b6a4), `tile` (type w, min 100 — la zone EXTENSIBLE,
  blanche), et **cpWheelMng** (la frutimandala, au bout droit).
- **L'intérieur au gabarit** (relevé 1:1, boîtes utiles — les liserés
  `#DDDDDD` sont EN PLUS, 2 px tout autour) : la barre fait 76 de haut,
  marge 6 — il reste **64 px de contenu** et tout y tient.
  • **Bouille 64×64 à x 15..78, y 6..69.** Le carré du `#888888` mesure
    EXACTEMENT 64 : l'anneau sombre est donc tracé À L'INTÉRIEUR de la
    FrutiScreen, pas autour — c'est le clip qui borde son propre contenu. Le
    `#DDDDDD` occupe les 2 px suivants (x 13-14 / 79-80, y 4-5 / 70-71).
  • **Encart `digital` x 84..229, y 7..47** — soit **146 × 41**. Les
    « 130×45 » du bytecode comptent les DEUX liserés : 45 = 41 + 2 + 2. Entre
    la bouille et l'encart, 5 px : 2 de `#DDDDDD`, 1 de blanc, 2 de `#DDDDDD`.
    L'encart démarre UN pixel plus bas que la bouille.
  • **Rangée des 7 émotions x 84..230, y 51..71** — 7 × 21, collée 3 px sous
    l'encart (liserés y 48-49, blanc y 50). Elle déborde d'un pixel à droite,
    comme d'époque.
- **Le détail de l'encart** (positions données par rapport au bord intérieur
  x 84, y 7) :
  • ARRONDI 2 px seulement (le fond atteint son bord dès 1 à 2 px du haut) ;
  • les 9 BARRES : x 86..112 (27 de large), y 9..34 — 2 px de barre, 1 px de
    fond, et UN pixel de fond après le liseré (liseré 84, fond 85, barre 86).
    Remplissage du BAS vers le HAUT, et de gauche à droite dans une barre ;
  • « NIV n » : encre x 86..109, **y 36..44** — collée au biseau du bas ;
  • la COUPE : encre **x 116..127, y 11..26** ; le RANG juste après, à
    x 132, sur les MÊMES lignes que la coupe (y 11..26) ;
  • le TRAIT de séparation : **y 28, x 117..224** ;
  • les RACCOURCIS sont CALÉS À GAUCHE, au DÉBUT du trait (x 117) et non à
    son bout : six icônes de **15 px au pas de 15** (elles se touchent),
    centrées sur 124, 139, 154, 169, 184, 199 — soit x 117..206, y 30..43 —
    et dans CET ordre : l'aide, le forum, le courrier, l'historique, les
    événements, les jeux ;
  • l'encart porte, comme le cadre de la bouille, un LISERÉ INTERNE plus
    sombre qui fait son relief — `#97AD80` au bord gauche (x 84), `#A2AF94`
    en haut (y 7) ; en bas c'est un BISEAU de 3 px qui s'assombrit
    (`#B4DB8B`, `#A0C27B`, `#839471` en y 45-46-47) ;
  • le REFLET : ce n'était pas la forme #409 (elle appartient au cadre de la
    bouille) et ce n'est pas UNE tache. `cpDigital` (#417) empile sur son
    image 1 la plaque #411 (prof. 1), le champ du rang #413 (prof. 2), la
    coupe #415 (prof. 3) et — tout en haut, prof. 7 — **la forme #416**, une
    couche de finition d'un seul tenant qui porte CINQ pièces : le trait de
    séparation `#73B01E` sous la coupe, l'ombre du bas (noir 20 %), le liseré
    du haut (blanc 40 %), la grande brillance en L le long du haut et du bord
    droit (blanc 50 %) et **l'éclat OPAQUE du coin haut-droit** — le morceau
    qui manquait, et qui explique le blanc pur du rendu Flash. Extraite
    telle quelle en `encart-reflet.svg`, cadrée sur le clip entier donc dans
    le repère de la plaque (150×45). Relevé après pose, ref vs light, sur le
    profil vertical du coin (x 220) : 0.567/0.630/0.896/1.000/0.505 contre
    0.558/0.592/0.808/1.000/0.505 — et le trait de séparation retombe au
    pixel près sur `#73B01E` en y 28.
  • la plaque #411 elle-même : 150×45, fond `#C8F39A`, liseré `#DDDDDD` de
    2 px et, entre les deux, un filet `#666666` d'un DEMI-pixel — c'est lui
    que le rendu échantillonne à `#97AD80`, la moyenne du gris et du fond.
- **Les DEUX chiffres de l'encart ne sont PAS de la Verdana.** Le bytecode
  tranche sans discussion, il suffisait de lire les champs texte :
  `DefineEditText #430` tire sur la fonte **#428 « impact » en 11 px** (c'est
  le NIVEAU : glyphe trapu, jambage de 3 px, SANS empattement au pied — d'où
  l'écart avec la Verdana, dont le « 1 » en porte un), et `DefineEditText
  #413` sur la fonte **#412 « lcd » en 22 px** (c'est le RANG, 15 px de haut).
  Les deux fontes sont EMBARQUÉES dans main.swf ; `scripts/extract-swf-font.js`
  les sort en WOFF (`public/frutiz/fontes/impact.woff` et `lcd.woff`) comme il
  l'avait fait pour les jeux. Les DEUX champs DÉCLARENT aussi leur encre :
  **`#73B01E`** — le `#73AF1E` qu'on échantillonne sur le rendu Ruffle est son
  anticrénelage, pas la couleur. Le champ fait foi.
  (Leçon de méthode : les drapeaux d'un `DefineEditText` tiennent dans DEUX
  octets, et `HasTextColor` est le bit 0x04 du PREMIER — le lire dans le
  second fait manquer toutes les couleurs déclarées, ce qui m'a d'abord fait
  croire les libellés noirs par défaut.)
- **La table `OS/2` des fontes extraites était fausse, et ça ne se voyait pas
  ici.** Le champ `sFamilyClass` manquait — deux octets — si bien que tout ce
  qui suit se lisait deux octets trop tôt : `usWinAscent` tombait sur la valeur
  écrite pour `usWinDescent` (216 unités au lieu de 1033 pour « impact »), et
  `fsSelection` sur l'index du premier caractère. Or un navigateur ne prend pas
  ses métriques verticales au même endroit selon la plate-forme : **Linux
  (FreeType) lit `hhea`**, qui était juste, **Windows et macOS lisent `OS/2`**,
  qui ne l'était pas. D'où un encart parfait au banc d'essai et cassé chez les
  joueurs — le numéro de niveau remontait au-dessus du sigle « NIV » et le rang,
  écrit en 22 px, sortait par le haut de la plaque, que `overflow:hidden`
  rognait : il n'en restait qu'un demi-chiffre. La table est désormais bâtie par
  `scripts/lib/table-os2.js` (96 octets pile, `sTypo*` et `usWin*` accordés à
  `hhea`, bit USE_TYPO_METRICS levé pour que tous les moteurs s'en tiennent aux
  mêmes valeurs) ; `scripts/reparer-os2-fontes.js` a remis d'aplomb les vingt et
  une fontes déjà livrées, et `test/fontesSwf.test.js` monte la garde.
  (Leçon de méthode : quand un rendu est juste sur la machine qui l'audite et
  faux ailleurs, la fonte est suspecte avant la CSS — c'est le seul endroit où
  la même règle peut donner deux résultats.)
- **Les ÉMOTIONS** (`initEmoteIconList` 0x6b6a4) : le gris autour d'une
  émotion n'est ni une plaque carrée ni un flou — c'est une **PASTILLE RONDE
  de 21 px en `#DDDDDD`** derrière le disque de 17, ce qui laisse 2 px de
  gris tout autour ; au-dessus et au-dessous des disques le fond redevient
  BLANC, et les cercles voisins SE TOUCHENT (4 px de gris entre deux disques,
  2 de chaque anneau). Relevé y 51..71, disque x 86..102, anneau x 84..104.
  Le « diffus » qu'on croit voir n'est que l'anticrénelage du cercle — et il
  faut noter que Flash remplit ses formes jusqu'au dernier pixel là où le
  navigateur applique la couverture réelle du pixel tangent : sans un demi-
  pixel d'expansion, l'anneau CSS paraît deux fois trop fin.
  L'art est la bande #102, sept
  images en BITMAP 17×17 dans CET ordre : le neutre, la colère, la tristesse,
  le sourire, le rire à pleines dents, le rictus, le rire aux éclats.

  **LA BOUCLE DIT TOUT, et il fallait la lire jusqu'au bout :**

  ```
  for (i = 0; i < 7; i++)
    emoteIconList.push({ link: "butPush", param: {
      link: "butPushEmoteIcon", frame: 1 + i,          ← l'image de la bande
      outline: 2, curve: 8,
      buttonAction: [{ onPress: { obj: me.status,
                                  method: "setEmote", args: i } }] }});
  ```

  Donc **image i+1 ↔ humeur i**, et les sept boutons couvrent les humeurs
  **0 à 6** : le premier est le visage NEUTRE, et « Totoché » (7) n'a pas de
  bouton dans la barre. `butPushEmoteIcon` (#103) n'enveloppe que la bande
  #102, qui pose ch89, 91, 93, 95, 97, 99, 101 aux profondeurs 1 à 7 — une
  par image. Les SVG extraits portent ces numéros dans leur `PatternID`, ce
  qui donne l'ordre sans la moindre supposition, et le recoupement avec
  `emoteList` est net : l'humeur 5 est `[œil 1, bouche 4]`, soit les sourcils
  de la colère sur le sourire à pleines dents — c'est exactement le rictus de
  l'image 6.

  **Le piège, tombé une fois.** L'ordre d'AFFICHAGE avait été relevé juste et
  refait en CSS (`order:`), mais le DOM partagé gardait `e = 1..7` : la rangée
  paraissait d'époque et cliquer le visage neutre posait « Déterminé », le
  sourire posait « Joie », et ainsi de suite jusqu'au dernier. Le décalage se
  voyait sur la bouille, pas sur la barre. `HOME_EMOTES` porte désormais
  l'ordre ET les identifiants du SWF, et le `order:` du bureau a disparu — il
  n'avait plus rien à remettre en place.
- **Profondeurs relevées au bord gauche** : la BANDE des contacts passe
  PAR-DESSUS la barre (à y=40 son liseré `#DDDDDD` se lit encore en 6..9),
  mais son OMBRE passe DESSOUS (le `#444444` y disparaît) — l'ombre est
  attachée à `main`, la bande non.
- **initInterface** (0x6b8af) : mcInterface prof 10, mcTab prof 8,
  mcTabBlack prof 4, mcInterfaceBlack prof 2 ; `mcTab._y = height` — la
  rangée d'onglets pend sous la barre, RECOUVERTE par elle (8 < 10).
- **addTab** (0x6c120) : `attachMovie('tab', 'tab'+n, dp_tab + tabMax −
  id·2)` — un id plus PETIT donne une profondeur plus GRANDE : l'onglet de
  gauche chevauche celui de droite. Reflow (removeTab 0x6c1e9) :
  `pos.x = id · tabSpace`, glissé par `animList.addSlide(move, 2)`.

## L'onglet (`_global.MainBarTab`, DoInitAction sprite#781, 0x6e614)

- `init` (0x6ea05) : `_x = id·tabSpace`, **`_y = −30`** (l'onglet DESCEND en
  glissant : addSlide('slide', 2)) ; `name = slot.title` ; le clip `tabFond`
  (#187) s'attache sur mcTabBlack et SUIT l'onglet (followList).
- L'ART (extrait par scripts/extract-frutiz-bureau.js, cadre commun
  (−17.5, −18)–(105.5, 23.5)) : `onglet_fond.svg` = #187 (la silhouette
  `#444444` : #183 122.95×23.5 + #185 étiré 123×18 posé à y −18, qui fond
  l'onglet dans le contour de la barre) ; `onglet_corps.svg` = #206 — la
  PLAQUE est un DefineButton2 (#133, étiré ×1.2325/×0.2406 : état UP lu à
  l'octet), le contenu #202 (cadre #188, champ du label #190, la pastille),
  la jonction blanche #204 (120×4, cachée sous la barre), le trait #205.
- Le LABEL : DefineEditText #190 — **Verdana (police embarquée #189) 10 px,
  `#000000`**, lié à `_parent.name` (« Bureau »). Mesuré : glyphes à ~30 px
  du bord gauche, centrés dans la plaque (écran y 76..99.5).
- Au clic (onPress 0x6ecaa) : le MENU du slot s'attache et DÉROULE
  (scrollDown, setInterval 25 ms) ; re-clic → scrollUp. `ico` passe à la
  frame 2 au survol (menu disponible), 3 menu ouvert. À porter avec les
  onglets de fenêtres (mode tab).

## La pastille est un FRUIT (la bande #198)

La pastille d'une barre-titre n'est PAS un disque teinté : c'est le clip
#198 — une frame ÉTIQUETÉE par type de fenêtre, choisie par gotoAndStop :

| étiquette | forme | le fruit (couleurs relevées) |
|---|---|---|
| `default` (f1) | #191 | **l'orange** `#FF9900`/`#E98001`, feuille `#009900` |
| `winDebug` (f9) | #192 | la prune `#8B3CB7`/`#5B287B` |
| `winChat` (f16) | #193 | **la fraise** `#EB1A14`/`#910D0D` |
| `winExplorer` (f22) | #194 | la banane `#FEFE25`/`#C7C701` |
| `winShop` (f29) | #195 | le fruit vert `#39B315`/`#309611` |
| `winAlert` (f36) | #196 | **le citron** `#F2E337`/`#B59B0D` |
| (f86, sans étiquette) | #197 | le fruit rose `#FE7681` |

Une étiquette INCONNUE laisse la frame 1 : **l'orange est le fruit par
défaut** — c'est pourquoi « Mon historique », « Ma Frutibouille » et
l'onglet « Bureau » portent tous l'orange (`#FF9900` mesuré plus haut), les
salons la fraise, les alertes le citron. Les sept fruits sont extraits sur
un cadre commun (sprites/fruit_*.svg) ; le light applique la même loi.

## La zone droite (mesures 1:1, ref1-bureau.png)

- **Le lecteur frusion** : contrairement à `frusionSlot` (#19, vide), le clip
  **`frusion` (#324) porte TOUT le meuble sur sa première image** — le
  panneau blanc aux quatre coins arrondis (forme #300, 119×77.5, contour
  `#444444`), la cuve grise, les trois fruits (#318 à −58.1, 36.8) et les
  DEUX BOUTONS RONDS : `#317` (le casque) à −100, 60 et `#313` (l'éjection)
  à −15.85, 60 — des **DefineButton2** que l'aplatisseur commun saute, d'où
  leur absence au premier essai. Extrait en un seul SVG
  (sprites/frusion.svg) par le même chemin que l'onglet.
  Posé au relevé 1:1 : contour x 1258..1376 sur 1380 — **4 px du bord
  droit** — et y 0..77.5. Reste la mécanique (FDDrive 0x6d884 : la trappe
  `doorA`/`doorB` qui coulisse de x 36/61 à 11/…, le disque qui tourne).
- **La frutimandala** (`cpWheelMng` #640) — FAITE, voir la section dédiée.
- **La pilule « N en ligne »** : elle ne flotte pas dans le coin — elle est
  POSÉE SUR le lecteur, en haut. Mesuré : x 1271..1369 (98 de large, soit
  11 px du bord droit), y 8..32 (24 de haut) ; fond `#526B3A`, point
  `#2ECC40`, texte `#CFF599`.
- **La languette CONTACTS** : voir la section SideList ci-dessous — ce n'est
  pas une étiquette isolée mais la POIGNÉE d'un panneau pleine hauteur.
- **La rangée d'icônes** : sous la barre, un PAS de 76 px — mesuré Gaspard
  282, Mes contacts 358, Corbeille 433, Forum 509, Liste noire 585, Les
  salons 661, Mon historique 737, Préférences 814, Scores 889, Boutique
  965, Bouilloscope 1042, Club 1117 (centres) ; étiquettes dessous.
- L'éditeur de bouille d'un compte neuf est une fenêtre SANS CROIX (« Ma
  Frutibouille ») : on n'en sort qu'en validant une bouille travaillée.

## La frutimandala (`cpWheelMng` #640 + la peau `/wheel/wheel1.swf`)

Le cadran paraissait vide dans main.swf parce qu'il n'y EST PAS : `Wheel`
(#773, `loadSkin` 0x6a4a3) charge une **peau externe** —
`Path.wheel` = « /wheel/wheel$i.swf », avec `wheelId` 1 pour
`wheel.FruitMonth` (#777). Le fichier existe dans le dépôt
(public/wheel/wheel1.swf) et son sprite **#62 EST la roue** : dix quartiers
(#52) posés tous les 36°, et les dix fruits des **frutisignes** par-dessus,
à 68,8 px du centre. Extrait tel quel en sprites/frutimandala-roue.svg.

**La loi du temps** (`RunDate.getCurrentFSign`, 0xbbf73) :

```
t     = getTime() / 1000
signe = floor(((t − 345600) / 604800) % 10)      // 604800 s = UNE SEMAINE
part  =      ((t − 345600) / 604800) % 1         // 345600 = décalage 4 jours
```

et `FruitMonth.update` (0x6d38e) pose `setRot((signe + part) × 36)` —
36° par signe, dix signes pour le tour. (L'ascendant, `signb`, tourne lui
d'un cran par HEURE : `floor((t / 3600) % 10)`.)

**Correspondance signe → quartier**, déduite de la loi puis vérifiée : à
mi-semaine (part 0,5) la rotation vaut 36·s + 18, donc le quartier du signe
`s` est à l'angle écran `72 − 36s`. Avec l'ordre du serveur
(`SIGNES_FRUITS`) : pomme #53, abricot #61, poire #60, fraise #59, citron
#58, kiwi #57, raisin #56, orange #55, cerise #54, banane #2.
**Vérification** : à l'heure de la capture de référence le signe était le
KIWI ; la loi le place au centre du cadran avec le citron à sa gauche et le
raisin à sa droite — exactement ce que montre le rendu Ruffle.

**Les trois couches**, comme les profondeurs du SWF : châssis de FOND
(#609, prof. 1) → la ROUE à la place du cadran (#613, prof. 3) → les quatre
boutons et le verre PAR-DESSUS (prof. 8 à 25). Sans cette séparation la roue
mangerait le bouton vert, qui tombe pourtant DANS le disque (rayon 126,
bouton à 115 du centre). Le centre de la roue est celui du cadran d'origine,
(92.7, −36.8) dans cpWheelMng = (99, −32.45) dans le cadre du châssis.
Pose calée sur un repère commun aux deux rendus, le bouton « G » :
x 1049..1093, y 52..67 — identique au pixel dans le light.

## Le panneau des contacts (`_global.SideList`, DoInitAction sprite#847, 0xa05b7)

La « languette CONTACTS » n'est pas une étiquette posée dans un coin : c'est
la POIGNÉE d'un panneau qui court sur toute la hauteur du bord gauche, et
qui se DÉPLIE en liste de contacts.

Constantes du prototype (0xa1708) : **`wSide` 9** (la bande repliée),
**`wShade` 3** (le liseré), **`wMain` 120** (la liste dépliée),
`hSearch` 24 ; profondeurs dp_bg 5, dp_list 20, dp_butSearch 24,
dp_scrollBar 40, dp_element 100.

- **update** (0xa0b4c) : `w = wSide` (+ `wMain` si `flActive`), puis DEUX
  aplats pleine hauteur (`mch`) — `FEMC.drawSquare(0xFFFFFF)` de largeur w,
  et `drawSquare(0xDDDDDD)` de largeur `wShade` collé au bord DROIT
  (`x = w − wShade`). La poignée suit : `butContact._x = wSide +
  flActive·wMain`.
- **`ombre`** (init 0xa0a92) : le clip `carreFond` (#584 — il ne pose que la
  forme #185, le carré `#444444`) attaché à `main`, réduit à `_width = 2`,
  posé à `main.cornerX` et haut de `mch` (onStageResize 0xa0c94).
- **init** (0xa0a09) pose **`main.cornerX = wSide`** : le bureau commence à
  9 px du bord — et à 129 quand la liste est ouverte (`activate` 0xa0d50 :
  `cornerX = wMain + wSide`). Le light borne ses fenêtres à cornerX.
- **La poignée** : `sideListContact` (#436) est un **DefineButton2** —
  extrait tel quel (scripts/extract-frutiz-bureau.js, cible `butContact`) :
  plaque blanche, liseré `#DDDDDD`, et les lettres « CONTACTS » PIVOTÉES
  d'un quart de tour, `#666666` au repos, **`#E7756B` (saumon) au survol**.
  Cadre (−7.75, −84.15)–(12, 0) : l'origine est EN BAS.
  `onStageResize` la pose à `_x = wSide` (9) et **`_y = 800`** — une
  constante EN DUR (la hauteur de scène d'époque), d'où la poignée collée au
  bas de l'écran ; le light l'ancre au bas du bureau, ce qui redonne le même
  rendu à la taille d'époque. (Idem `butSearch._y = 770` quand la liste est
  ouverte.)
- Relevé au pixel 1:1, référence et light : blanc 0..6, `#DDDDDD` 6..9,
  `#444444` 9..11 ; haut de la poignée à y 725. Identiques.
- Le clic (`mcSide.onPress` et `butContact.onPress`) appelle `toggle` : le
  dépliement de la liste reste à porter (étape des contacts).

## Les icônes du bureau

- **La grille n'est pas écrite en dur, elle est CALCULÉE.**
  `FPDesktop.displayIconList` (0xba0af) ne pose rien lui-même : il attache un
  `cpDragIconList` et lui passe la boîte utile (`mcw − main.cornerX`,
  `mch − main.cornerY`), la marge de `Standard.getMargin()` corrigée en
  `x.min = 18` / `y.min = 12`, la couleur de texte
  (`wallPaper.txtColor`, à défaut `colorSet.green.overdark`), `flTrace: true`
  et `flMask: false`. C'est `cp.IconList.updateStruct` (0x4f6fc) qui en tire
  la grille, axe par axe :

  ```
  utile = côté − 2·marge
  pas   = size + space
  max   = floor(utile / pas)
  reste = utile − (max·size + (max−1)·space)
  tant que reste > pas : max++ ; reste -= pas
  coin  = marge            si align vaut « start » ou « null »
        = marge + reste/2  si « center »
        = marge + reste    si « end »
  ```

  puis `alignIcon` (0x4f946) remplit l'axe INTÉRIEUR (`isNot(struct.order)`)
  avant de faire un pas sur l'axe extérieur, chacun parcouru dans le `sens`
  inscrit dans sa structure. Sur un écran large, cela donne **une seule
  RANGÉE** — pas des colonnes comme on pouvait le croire.

- **Le relevé 1:1** (`ref1-icones.png`, bureau dégagé — l'éditeur de bouille
  n'a pas de croix, il faut lui faire défiler assez de traits pour qu'il
  accepte « valider ») : **quinze icônes**, centres à **53 + 76·k** (pas
  mesuré 75,96 sur 14 intervalles), donc `size` 64 et `space` 12. L'ordre :
  la boîte de réception, les disques, l'inventaire, Gaspard, les contacts,
  la corbeille, le forum, la liste noire, les salons, l'historique, les
  préférences, les scores, la boutique, le bouilloscope, le club.

- **La cellule** : le dessin est CENTRÉ sur la ligne y 128 — soit une case
  d'icône de 44 px partant de y 106, c'est-à-dire `main.cornerY` — et
  l'étiquette commence juste dessous, en y 152, avec 13 px d'interligne. Le
  champ de texte fait 64 et non 76 : « Boîte de réception » et « Mon
  historique » passent à deux lignes, « Mes contacts » (63) tient sur une.
  L'encre est `#335511` sur l'aplat `#ADE76B`, sans halo.

- **Le GLISSER-DÉPOSER** (`cpDragIconList`, `FPDesktop.onDrop` 0xb9ca9) ne
  ressemble PAS à celui des fenêtres. Relevé sur le rendu 1:1 — une icône
  prise, promenée, lâchée, puis un rechargement :
  • l'icône elle-même suit le curseur ; il n'y a ni fantôme ni glissade de
    retour, et sa case d'origine se VIDE pendant la prise ;
  • lâchée, elle reste où on l'a mise : `onDrop` inscrit un `pos` LIBRE sur
    l'entrée de la liste, et `DragIconList.fitInGrid` (0x74823) ne fait que
    la BORNER — il retranche `gridSpace` tant qu'on dépasse `(xMax−1)·
    gridSpace` — sans jamais arrondir. La grille de `initGrid` ne sert qu'à
    la comptabilité des cases occupées (`isFreePos`, `getNextAvailablePos`) ;
  • les voisines ne bougent pas : le trou reste ouvert dans la rangée ;
  • **rien n'est retenu** : après rechargement, la corbeille déposée au milieu
    du bureau a retrouvé sa 6e case. Le `pos` ne vit qu'en mémoire.
  • QUIRK conservé : au relâché, l'icône SAUTE de +9 en x et +6 en y par
    rapport à l'endroit où on la voyait (mesuré : pendant la prise
    x 590..632 / y 334..381, après le lâcher x 599..641 / y 340..387).
    `onDrop` convertit la position du curseur en coordonnées de la liste sans
    défalquer le décalage de celle-ci — soit `cornerX` (9) et `margin` (6).
- **Aucun effet de SURVOL** : le curseur posé sur une icône ne change rien à
  son étiquette (vérifié sur la capture du dépôt, curseur sur l'icône).
- **La TAILLE des dessins** n'est pas normalisée : c'est l'artwork tel quel,
  de 23×39 (l'historique) à 42×42 (le bouilloscope). Deux constats utiles au
  portage : les icônes tirées de fileIcon.swf en SVG tombent toutes à **0,60**
  de leur taille native (le SVG a été sorti à 5/3), tandis que les PNG portent
  des marges transparentes inégales — l'inventaire n'en remplit que 82 %, le
  forum 70 % en largeur — et doivent donc être contraints sur leur ENCRE.

## Le panneau des contacts, déplié

- **Tout tient dans UNE borne.** `SideList.toggle` (0xa0e2a) appelle
  `activate`, qui pose `main.cornerX = wMain + wSide` (**129**), ou
  `deActivate`, qui le remet à `wSide` (**9**) ; chacun finit par
  `main.onResize()` puis `update()`. Le bureau entier suit cette borne — la
  barre, l'onglet, la rangée d'icônes, le bornage des fenêtres. Relevé 1:1 :
  la première icône passe du centre 53 au centre **173**, l'onglet et la barre
  de −9/−2 à 111/118 : partout **+120**, soit `wMain`.
- **Le décor** (`update` 0xa0b45) : un `drawSquare` blanc de largeur
  `wSide (+ wMain si ouvert)` sur toute la hauteur, puis un `drawSquare`
  `#DDDDDD` de `wShade` (3) collé au bord DROIT, et la poignée posée à
  `wSide + flActive·wMain`. Relevé ouvert : blanc 0..125, `#DDDDDD` 126..128,
  `#444444` 129..130 — fermé : blanc 0..5, `#DDDDDD` 6..8, `#444444` 9..10.
- **La liste** (`buildList` 0xa1038) est masquée à `wMain × (mch − hSearch)` :
  elle s'arrête 24 px avant le bas, où se pose `butSearch` — `mcSearchButton`
  (#441), à `_y = 770`, une constante en dur comme le `_y = 800` de la
  poignée. L'art est extrait tel quel (la pastille grise et sa loupe, cadre
  (9,95 ; 0,65)–(105,85 ; 22,67)) ; seul le mot « recherche » est un champ
  texte — verdana GRAS 10, blanc, **centré** (`align = 2`). Le bouton ouvre la
  fenêtre `search` (cf. « LA RECHERCHE DE FRUTIZ », plus bas).
- **Une ligne fait 18 px** et chaque niveau de dossier décale de **5 px**
  (`buildElement` 0xa1243). Un dossier se replie au clic sur son titre
  (`fond.onPress` bascule `element.open` puis rebâtit la liste), et REPLIÉ il
  ajoute un cinquième de ligne — `currentLine += 0.2`, soit 3,6 px de
  respiration. Un contact est un `userSlot` en `statusDspMode: 'all'`.
- **Les PIÈCES, extraites du SWF** (rien n'est redessiné) :
  • l'EN-TÊTE de dossier `sideListTitle` (#215) = `fond` (forme #209, une
    barre `#999999` de 100×12 que `buildElement` ÉTIRE à
    `wMain − decal − fondD._width`) + `fondD` (#213, image 1 = forme #211,
    20,65 × 12 : le BOUT ARRONDI de la barre et son bouton clair `#CCCCCC`)
    + `tf` (champ #214 : variable `title`, font #189 Verdana **10 px**,
    couleur DÉCLARÉE **`#FFFFFF`**, aligné à gauche — du BLANC sur la barre
    grise). La fonte #189 ne porte pas le drapeau gras, mais le champ n'a pas
    `UseOutlines` : Flash tire la Verdana du SYSTÈME et le rendu d'époque est
    bien GRAS — la même graisse que l'onglet « Bureau », qui use du même
    champ #190. QUIRK : `fondD.gotoAndStop(1)` est appelé sans condition — le
    bout ne change JAMAIS d'image, replié ou non ;
  • la LIGNE de contact `userSlot` (#261) : sa forme de fond (#259) fait
    **120 × 18**, d'où la hauteur de ligne. `backgroundId = 2` tombe sur
    l'image 2 de la bande #260, qui est VIDE : la ligne n'a pas de fond ;
  • le VOYANT : `UserSlot.init` attache la bande `status` (#253) comme `icon`
    SANS lui donner de `_x`. Son fond est la forme #216 (`iconBackgroundId
    = 2`) — un carré arrondi de 17, vide, au liseré `#CCCCCC` — et l'état est
    la bande #222, dont `ico.gotoAndStop(presence + 1)` choisit l'image :
    **présence 1 → la pastille VERTE `#ADE76B`** (le serveur envoie `p="1"`
    dès qu'une socket est ouverte), **présence 0 → l'image 1, la pastille
    SAUMON `#E3756A`** à reflet blanc. La grise `#CCCCCC` est l'image 3, un
    troisième état dont le carnet ne se sert pas. Les trois font 8 × 8 et
    portent un anneau noir ;
  • le PSEUDO : `initText` (0x6353a) pose le champ à **`_x = 20`**, large de
    100 et haut de 20, au style `Standard.getTextStyle().def` (0x491a9) —
    **Verdana 10, couleur 0** — que la méthode passe en **GRAS**.
- **Le CADRAGE de l'icône** : `icon` est bien attaché sans `_x`, mais son
  dessin n'est pas centré sur l'origine pour autant — la bande `status` pose
  son contenu à +9, ce qui annule le −9 interne du fond, et l'icône occupe
  donc **x 0,5..17,5**. Elle tombe pile à gauche du pseudo, qui commence à 20.
- **Carnet vide : rien ne s'écrit.** `buildList` ne parcourt rien et la bande
  reste blanche — pas de message d'absence.
- Côté light, les données existaient déjà : le bureau Flash lit ses contacts
  en XML (`<f u="mycontact">`, dossiers compris). `/api/light/contacts` en
  sert la même lecture en JSON, sans rien réordonner — l'ordre d'insertion est
  celui que le joueur voit d'époque.

## « Salons publics » (`win.RoomList` 0xbebb6, `cp.RoomList` 0x70733)

La première fenêtre du bureau qui n'a PAS d'équivalent mobile : côté light on
choisit son salon dans un menu déroulant, côté Frutiz c'est une fenêtre à
elle seule. Le double-clic sur l'icône « Les salons » l'ouvre ; un clic sur
une rangée entre dans le salon.

### La charpente (`initFrameSet`, 0xbec4d)

    mcRoomList = main.newElement({ name: 'roomListFrame', link: 'cpRoomList',
                                   type: 'compo', flBackground: true,
                                   mainStyleName: 'frRoomList',
                                   min: { w: 200, h: 240 },
                                   args: { flMask: true, flWait: true } })
    main.bigFrame = main.roomListFrame
    mcTool = margin.bottom.newElement({ type: 'compo', name: 'frameCreate',
                                        link: 'cpDocument', mainStyleName: 'frSystem',
                                        min: { w: 260, h: 18 },
                                        margin: { x: {min: 4, ratio: 0}, y: {min: 6, ratio: .66} },
                                        args: { flDocumentFit: true, doc: <XML> } })

Le document de la barre du bas est écrit en toutes lettres dans le bytecode :

    <p><l><s w="4"/><b t="{Lang.fv('chat.create_channel')}" l="butPushStandard"
          o="win" m="createNewRoom"/><s w="10"/><i v="roomName" dy="1" b="1"></i>
          <s w="3"/></l></p>

soit : 4 px, le bouton « créer un salon », 10 px, le champ `roomName`, 3 px.
`createNewRoom` (0xbee80) passe `mcTool.card.roomName.value` à
`box.createChannel`.

### La liste (`setList`, 0x70881)

    pal.bg = style.color[0]                       // frRoomList → colorSet.pink
    hauteur = 20                                  // reg7, en dur
    pour chaque salon i :
      texte = nom + " (" + nbUser + ")"
      behavior = { type: 'colorBackground',
                   color: { base: pal.bg.darker, over: pal.bg.dark,
                            press: pal.bg.main,  bg: pal.bg.lighter } }
      buttonAction = [{ obj: win.box, method: 'join', args: [salon.id] }]
      si i % 2 == 0 : flBackground = true ; bgColor = pal.bg.shade
      butText[i]._y = i * 20

Deux choses à noter. D'abord, ce sont les rangées **PAIRES** qui reçoivent le
fond appuyé. Ensuite, la ligne `textStyle.textPropery.color = 0` (0x70a1d) —
**`textPropery`, avec la faute** : la propriété n'existe pas, l'affectation
tombe dans le vide et le noir voulu n'est jamais posé. Bug d'origine, gardé.

### Créer un salon (`box.RoomList.createChannel`, 0xa65a5)

Le clic du bouton passe par `createNewRoom` (0xbee79), qui lit
`mcTool.card.roomName.value` et le donne à `createChannel(n)` :

```js
if (n === undefined || n.length === 0) {
  openErrorAlert(Lang.fv("error.chat.topic_required"));
  return;                     // « Vous devez spécifier un sujet… »
}
channelMng.create(n);
this.close();                 // la fenêtre des salons se referme
```

Le salon porte donc **le sujet**, pas un identifiant : le portage en dérive une
clé (`sal_` + le sujet sans accents, tout le reste en tirets) qui ne peut heurter
ni les onze salons fixes ni les discussions privées `pm_`/`pm2_`.

**Ce qu'il a de privé.** Il n'apparaît que dans la liste de ceux qui y sont :
`buildChannelListXml` prend un pseudo et retire du `<q>` tout salon de joueur
dont ce pseudo n'est pas membre — chaque socket reçoit SA liste. Un salon vide
n'existe donc plus pour personne, et le serveur le purge au dernier départ,
aux deux sorties (le `leave` explicite et la fin de la grâce de reconnexion).
Les PNJ ne comptent pas comme occupants : Gaspard ne maintient pas un salon en
vie. C'est ce qui distingue un salon de joueur des onze permanents.

**Comment on y entre.** En donnant son sujet : `createChannel` sur un sujet déjà
pris REJOINT le salon au lieu d'en ouvrir un second, et renvoie le sujet
CANONIQUE (`d="…"`) pour que le second arrivant le nomme comme le premier —
sans quoi la phrase d'entrée sortirait avec la clé brute. Le second chemin
d'époque est écrit dans lang_french.as (`explorer.alert.invite_contact`) :
« Pour inviter un de vos contacts dans une discussion privée ou un salon, il
suffit de le faire glisser vers la fenêtre du chat. »

**Et le refus** passe par `win.Alert` (DoInitAction sprite#812) : deux cadres —
`frameDoc` (cpDocument frSystem, min 200 × 80) et `frameButton` (min 200 × 24) —
un bouton « Fermer » (`_global.langText.close`), et `moveToCenter()` à la fin de
son `init`.

### Le relevé 1:1 (scratchpad/ref3-salons.png, viewport 1380×800)

Attention : la capture `ref-salons.png` du premier passage avait été prise en
1400×860, donc **agrandie de 1,45 %** — c'est ce qui faisait lire un pas de
20,27 px là où le bytecode dit 20. Refaite en 1380×800, tout retombe juste.

Fenêtre x 9..273 (**265**), y 105..392 (**288**) :

| bande | de..à | quoi |
|---|---|---|
| contour | 105 | `#444444`, 1 px |
| liseré | 106-107 | `#DDDDDD`, 2 px |
| bandeau | 108..123 | blanc, **16 px** |
| contour du compo | 124-125 | `#DDDDDD`, 2 px |
| liste | 126..365 | **240 px**, le `min.h` du bytecode |
| contour du compo | 366-367 | `#DDDDDD` |
| barre du bas | 372..387 | le bouton (16 px) et le champ (14 px) |
| liseré / contour | 390-391 / 392 | `#DDDDDD` puis `#444444` |

En largeur : contenu de la liste x 15..266 (**252**), contour du compo 13-14
et 267-268, blanc 269-270, liseré 271-272, contour 273.

Le compo de la liste est peint par `drawCustomSquare` comme le reste, avec le
`curve: 3` des styles de contenu : rayon extérieur **5** (curve + outline),
rayon du contenu **3**. Et son LISERÉ est ROSE — `#FEABAB`, sur 2 px — mais
il ne se voit que sur TROIS côtés : les rangées, posées à `_y = i * 20` depuis
le haut du compo, recouvrent celui du haut. Vérifié sur une rangée IMPAIRE
(donc `#FEC9C9`) : x 15-16 et 265-266 restent roses, et y 364-365 aussi, juste
avant le `#DDDDDD`.

Le BLANC de la fenêtre, lui, est arrondi à `curve − inline` = **8** : relevé au
coin haut-gauche, il démarre en x 18 sur sa première ligne (y 108) et rejoint
x 12 trois pixels plus bas. Le reproduire demande une plaque à part — une
ombre interne ne courbe rien, et le fond de la boîte garderait les coins de
la boîte.

Le BANDEAU, au détail : pastille (encre x 17..28, y 108..121), titre gras
11 px `#444444` à partir de x 31, croix de fermeture x 257..267.

Teintes, toutes relevées :

- rangée paire `#FEABAB`, impaire `#FEC9C9`, **survol `#FFF2F2`** — les deux
  parités passent au survol, le fond appuyé des paires ne le retient pas ;
- encre des rangées `#BA4444`, Verdana 10 (la taille de `getTextStyle`) ;
- bouton : anneau `#F28687`, fond `#FFAAAD`, encre `#660000` grasse — et ce
  sont EXACTEMENT les couleurs du dessin extrait (`butPushStandard` #465),
  donc aucune teinture à l'emploi. Le dessin porte une TROISIÈME forme, son
  REFLET : un filet `#FFEAEC` qui longe l'intérieur du bord haut (y 2,85..3,4
  sur les 16 de haut, de x 5,3 à 34,2) puis s'enroule autour du bout DROIT
  jusqu'à y 12,65 ;
- champ : fond `#DDFFBB` = green.light, bord `#94DB39` = green.dark — là, en
  revanche, le dessin d'origine (`inputField` #170) est GRIS `#EEEEEE` et se
  fait bien teinter.

Le bouton et le champ sont des GÉLULES faites de bouts de gélule : les étirer
depuis le SVG déformerait leurs extrémités rondes. On les refait donc en CSS,
avec les teintes ci-dessus — la forme, elle, est un simple `border-radius`.

Sur ce que le relevé NE dit pas : les noms de crans de `pal.bg` ne collent
pas avec ce qu'on mesure (`over` devrait valoir `pink.dark`, or `#FFF2F2` est
plus clair que `pink.lighter` = `#FEC9C9`). Soit `butText` n'emploie pas les
crans comme leur nom le laisse croire, soit la famille `pink` n'est pas celle
qu'on suppose. On note donc les MESURES, pas une rampe reconstituée.

### Ce que le light en fait

La fenêtre est bâtie par `bureau-frutiz.js` (elle n'a pas de panneau mobile à
emprunter) et se remplit par un pont posé dans light.html, `window.SalonsBureau`
— liste des salons publics avec leur affluence, salon courant, et `rejoindre`.
`renderRoomOptions` la rafraîchit à chaque changement d'affluence.

Deux écarts assumés, faute de mieux côté serveur ou côté usage :

- **« créer un salon » est inerte.** Le serveur du revival n'a pas de
  `createChannel` : les onze salons sont fixes. Le bouton est dessiné parce
  qu'il fait partie de la fenêtre, mais il est désactivé et le dit.
- **La poignée de redimensionnement reste visible.** D'époque elle est à la
  profondeur 160, SOUS le frameSet (200→800) : la barre du bas la recouvre,
  et on ne la voit pas — mais en Flash le clic la traverse quand même. En
  HTML ce n'est pas le cas : la mettre dessous la rendrait insaisissable et
  la fenêtre non redimensionnable. Elle reste donc au-dessus.

Le titre de la fenêtre du SALON, lui, devient le nom du salon (au lieu de
« Salons » pour tous). Le bureau d'époque fait de même, mais la capture de
référence ne montre pas cette fenêtre-là : la formule exacte du titre (avec
ou sans « Salon de ») reste à confirmer.

## La fenêtre du SALON (`win.Chat` 0x690f4, qui étend `win.Dialog`)

Le light mettait sa barre d'outils EN HAUT, avec un menu déroulant de salons.
Le bureau d'époque met quatre boutons EN COLONNE À GAUCHE, et pas de menu :
le salon se choisit dans « Salons publics ».

### Elle s'ouvre ÉTROITE, et fermée

`win.Chat` n'écrit AUCUN `pos` — ni son `init` (0x69154), ni `win.Dialog.init`
(0x68ac3) au-dessus, ni `win.Advance` au-dessus encore. Le `pos` de
`WinStandard.init` reste donc `{0, 0, 0, 0}`, et `recal` en fait le MINIMUM du
contenu, dans le coin (cf. « OÙ UNE FENÊTRE S'OUVRE »).

Et ce minimum est celui d'un salon NU, parce que la toute première chose que
fait `init` (0x6915f) est de fermer ses trois panneaux :

    this.flPenList = false;
    this.flUserList = false;
    this.flScreenList = false;

Une conversation neuve n'a donc ni sa colonne de bouilles, ni sa liste de
connectés, ni sa barre de feutres — on les ouvre au bouton, et la fenêtre
grandit alors d'elle-même jusqu'au nouveau minimum. Le portage l'ouvrait à
780 × 580 avec les connectés déjà déployés ; elle s'ouvre maintenant en
**220 × 156 posés dans le coin**, et passe à 276 au clic sur les connectés.

### Les quatre boutons (`genLeftIconList`, 0x691da)

Chacun est un `butPush` dont le `param` vaut
`{link: 'butPushSmallPink', frame: N, outline: 2, curve: 4, tipId: …}`.
Dans l'ordre du tableau (`InitArray` dépile depuis le sommet — le
désassemblage les liste donc à l'envers) :

| # | frame | tipId | action |
|---|---|---|---|
| 0 | 3 | `chat_bouille` | `toggleScreenList` |
| 1 | 2 | `chat_userlist` | `toggleUserList` |
| 2 | 4 | `chat_penlist` | `togglePenList` |
| 3 | 5 | `chat_warning` | `box.whining` |

Le rendu 1:1 les montre exactement dans cet ordre — bouille, liste, feutres,
avertissement. **Quatrième confirmation** du sens de `InitArray`.

Le `frame` ne vise pas `butPushSmallPink` (#378), qui n'a que trois images :
il vise la BANDE D'ICÔNES #374 que #378 pose à sa profondeur 5. Ses images :
2 = la liste (#360), 3 = la bouille (#361), 4 = les feutres (#362), 5 =
l'avertissement (#363). #378 pose aussi la GÉLULE #359 (20×20, anneau
`#F28687`, fond `#FFAAAD`) et le REFLET #375 (un filet blanc de 16×3,65 en
haut). Les quatre boutons sont donc extraits en empilant trois formes —
gélule, reflet, icône — toutes posées à l'origine.

`displayLeftIconList` (0x693c9) donne le gabarit : `struct.x.size = 22`,
`struct.y.size = 22`, `space = 4` des deux côtés, compo `leftIconListFrame`
de `min: {w: 24, h: 0}` dans `margin.left`. Relevé : la gélule fait **20×20**,
son contour `#DDDDDD` de 2 px l'entoure (24 de large, la largeur du compo),
et deux boutons sont séparés de 2 px de blanc — **pas de 26**.

`genLeftIconList` calcule aussi `lefIconListHMaxThin = 4 + 24 × 4 = 100`
(la colonne) et `lefIconListHMaxLarge = 4 + 24 × ceil(4/4) = 28` (la rangée,
quand la liste des bouilles s'ouvre et pousse les icônes à se ranger en
largeur).

### Le relevé 1:1 (scratchpad/rc2-1-deplacee.png)

Fenêtre x 410..611 (**202**), y 267..422 (**156**) — la taille d'ouverture.

| bande | de..à | quoi |
|---|---|---|
| contour / liseré | 267 / 268-269 | `#444444` puis `#DDDDDD` |
| bandeau | 270..285 | blanc, 16 px — comme toutes les fenêtres |
| zone des messages | 286..397 | contour `#DDDDDD` 2, liseré `#ADE76B` 2, fond `#CCF599` |
| blanc | 398..401 | 4 px |
| ligne de saisie | 402..415 | 14 px |
| blanc | 416..419 | 4 px |
| liseré / contour | 420-421 / 422 | |

En largeur : blanc 413-414, colonne des boutons 415..438 (24), blanc 439-440,
zone des messages 441..606, blanc 607-608.

Les boutons tombent en y 290, 316, 342, 368 — pas de 26, et 2 px de blanc
entre le haut du corps et le contour du premier.

### Le REFLET de la zone des messages — la loi confirmée

La zone des messages est peinte par `drawCustomSquare` avec le drapeau
`chrome`, et c'est ici qu'on peut enfin VÉRIFIER le dégradé décrit plus haut.
Relevé sur le fond `#CCF599`, ligne par ligne à partir du liseré :
0,608 — 0,51 — 0,43 — 0,35 — 0,275 — 0,196 — 0,118 — 0,039 — 0. Une descente
LINÉAIRE qui s'éteint au dixième pixel.

Or la loi dit : dégradé blanc d'alpha 80 → 0 sur 10 px depuis le bord du
compo, peint à partir de `y + inline`. Avec `inline = 2`, la première ligne
visible vaut donc `0,8 × (1 − 2/10) = 0,64`. Mesuré 0,608. **Les `alphas` de
`beginGradientFill` sont bien des POURCENTAGES** (80 = 80 %), et non des
valeurs sur 255 — le doute était noté plus haut, il est levé.

### La typographie des messages

Bandes d'encre relevées : y 297..305, 314..322, 330..338 — hauteur d'encre
**9 px**, INTERLIGNE **17**. Neuf pixels de capitale, c'est du **12 px** en
Verdana. L'encre est `#335511` = green.overdark, la même que les étiquettes
d'icônes du bureau — pas le vert délavé du fil mobile.

### La ligne de saisie

C'est `inputField` (#170) TEL QUEL, sans teinture : 14 px de haut, corps
`#EEEEEE`, arête haute `#CCCCCC`. Elle s'aligne sur le LISERÉ de la zone des
messages (x 443..604), pas sur son contour. Et rien ne l'accompagne :
d'époque il n'y a NI bouton « Envoyer » NI aide aux accents, on valide à
Entrée.

**Le rayon n'est PAS maximal.** Le bout de la barre est la forme **#166**, un
dessin de 4×14 dont le tracé part de (0,0) et arrive en (−4, 4) par une seule
courbe : un quart de rond de **rayon 4** sur une barre de 14, là où la gélule
pleine en demanderait 7. Le relevé au pixel le confirme — le bord gauche
n'atteint x 523 qu'en y 506, quatre lignes sous le haut de la barre. Le liseré
`#CCCCCC` fait partie du même dessin et suit la courbe. (La forme #167 est la
même en vert `#E8F8D1`/`#D5F2B4` : c'est la variante des fenêtres vertes.)

### Le titre

`nom du salon + " (" + affluence + ")"` — « Salon Fraise (1) » sur le relevé.
La pastille est la FRAISE : `getIconLabel()` rend `"winChat"` (0x8068a).

### Les trois panneaux des boutons

Chaque bouton ouvre un compo, et le bytecode dit où :

| bouton | compo | `min` | où |
|---|---|---|---|
| bouille | `cpScreenList` (0x6973d) | 100×200 | `margin.LEFT` |
| connectés | `cpUserList` (0x695a7) | — | `margin.RIGHT` |
| feutres | `cpPenList` (0x69849) | 120×48 | `main`, à l'INDEX 2 — entre le fil et la saisie |

Et `toggleScreenList` (0x69646) fait une chose de plus : quand la liste des
bouilles s'ouvre, la colonne des icônes passe en RANGÉE — `min.h` devient
`lefIconListHMaxLarge` = 28. Le relevé le montre bien : les quatre gélules se
rangent côte à côte au-dessus des panneaux.

### LES MINIMA : `minimum` n'est PAS une constante

`WinStandard.minimum`, c'est **`frameSet.minInt`** — le minimum INTERNE de
l'arbre de cadres, recalculé à chaque changement (`onFrameSetUpdate`,
0x5493d). Ouvrir un panneau RELÈVE donc le minimum, et le `recal` de la
fenêtre la fait grandir si elle était en dessous. Le bornage lui-même
(0x54100) :

    pos.w = max( minimum.w, min( pos.w, mcw − main.cornerX ) )
    pos.h = max( minimum.h, min( pos.h, mch − main.cornerY ) )
    pos.x = max( main.cornerX, min( pos.x, mcw − pos.w ) )
    pos.y = max( main.cornerY, min( pos.y, mch − pos.h ) )

`Frame.updateMinInt` (0x479e9) agrège l'arbre. Un cadre de type **« w »**
empile ses enfants EN HAUTEUR (les hauteurs s'ADDITIONNENT, les largeurs se
maximisent) ; un cadre **« h »** les range en largeur. Pour une feuille
(`type: 'compo'`) :

    minInt.w = max(min.w, path.min.w) + margin.x.min + marginInt.x.min
    minInt.h = max(min.h, path.min.h) + margin.y.min + marginInt.y.min

où `margin` est un TOTAL (pas une valeur par côté) et `Standard.getMargin()`
(0x490ea) rend `{x:{min:0, ratio:0.5, align:0}, y:{…}}`.

L'arbre d'une fenêtre (`initFrameSet`, 0x54878) :

    frameSet    « w »
    ├── top     « w »  min {w:0, h:6}
    ├── center  « h »
    │   ├── left    « w »  min {w:6, h:0}
    │   ├── center  « w »   ← bigFrame, le contenu
    │   └── right   « w »  min {w:6, h:0}
    └── bottom  « w »  min {w:0, h:6}

Les mins du salon, écrits dans le bytecode :

| pièce | min | marge |
|---|---|---|
| colonne d'icônes | `{w:24}` | 8 |
| `cpScreenList` (bouilles) | `{w:100, h:200}` | 12 |
| `multiTextField` (le fil) | `{w:100, h:100}` | 8 (INTÉRIEURE) |
| `cpPenList` (feutres) | `{w:120, h:48}` | 6 |
| `cpUserList` (connectés) | `{w:122, h:100}` | 6 |
| `inputField` (saisie) | 14 de haut | 6 |

et la colonne d'icônes passe de **104** (quatre gélules au pas de 26) à **28**
quand les bouilles l'obligent à se mettre en rangée (0x69646).

**Vérifié sur Ruffle**, et c'est la mesure la plus élégante du carnet : on
rétrécit la fenêtre à fond par sa poignée, puis on ouvre les panneaux un à un
— elle GRANDIT d'elle-même jusqu'au nouveau minimum, qu'il suffit alors de
lire sur le cadre `#444444` :

    nu 202×156 · +bouilles 228×256 · +connectés 356×256 · +feutres 374×256

De ces quatre mesures tombent les 8 px de chrome en largeur, les 28 en hauteur
(12 de cadre + 16 de bandeau), et un PLANCHER de 202 en largeur — celui du
bandeau-titre, que le contenu n'atteint jamais seul. D'où :

    min.w = max(202, 8 + gauche.w + milieu.w + droite.w)
    min.h = 28  +  max(milieu.h, gauche.h, droite.h)

    gauche = bouilles ? {w:112, h:228} : {w:32,  h:104}
    milieu = feutres  ? {w:126, …}     : {w:108, …}   ;  h = 128 + (feutres ? 48 : 0)
    droite = connectés? {w:128, h:100} : {w:0,   h:0}

Le light rend les quatre mesures au pixel, et la fenêtre grandit toute seule
quand un panneau s'ouvre alors qu'elle était au minimum.

### LA CHARPENTE EN TROIS COLONNES (relevé 1:1, au pixel)

**La colonne d'icônes est DANS la marge gauche**, pas dans un bandeau qui
traverserait la fenêtre. `genLeftIconList` (0x691da) la range dans
`margin.left`, au-dessus de `cpScreenList` : les quatre gélules et la pile
des bouilles partagent la même colonne. Quand les bouilles s'ouvrent, les
icônes passent EN RANGÉE (`min.h` tombe à `lefIconListHMaxLarge`) et
s'alignent sur le bord gauche de la zone des écrans. Relevé sur une fenêtre
de 818×484 posée en (422, 272) :

    fermé     icônes  429..448 (colonne)   fil à 455
    en grand  icônes  429..526 (rangée, 4 au pas de 26)
              bouilles 429..528            fil à 535

Dans les deux cas le contour du bouton (2 px) et celui de la bouille bavent
dans les 2 px de blanc du panneau : 429 − 2 = 427 pour l'anneau, et le fil
commence 6 px après le bord droit de la colonne. Le fil part du HAUT de la
fenêtre en position fermée : rien ne le pousse vers le bas.

Les deux panneaux latéraux sont des MARGES de la fenêtre — ils descendent sur
toute la hauteur du corps. Les feutres et la ligne de saisie, eux, sont dans
`main`, la colonne du MILIEU : ils s'arrêtent donc au bord du fil. Le relevé
le prouve — la saisie va de 443 à 604 quand la boîte des connectés occupe
déjà 557..678 sur la même ligne.

Sur une fenêtre de 276×253 (le gabarit d'époque), les trois colonnes tombent
sur :

    bouilles 417..516 (100)   fil 523..550 (28)   connectés 557..678 (122)

soit `100 + 6 + 28 + 6 + 122 = 262` — la largeur utile exactement. **L'écart
entre colonnes est de 6 px** : deux pour le contour de gauche, deux pour celui
de droite, deux de blanc au milieu. (En CSS il faut le porter par les MARGES
des panneaux et non par un `column-gap` : une colonne fermée ne doit rien
coûter.)

### La zone des bouilles a DEUX VISAGES

`cp.ScreenList` (0xb6088) n'a pas de fond à elle, et surtout elle change de
nature selon la place et le monde :

    size = width                                   // un écran est CARRÉ
    max  = Math.floor(height / (size + ecart))     // ecart = 2 (prototype)
    win.box.userList.wantList(max, 'setUserList', this)

    setUserList(list, userTotal):
      si max >= userTotal  →  removeCLBScreen(), attachMultiScreen(), update…
      sinon                →  removeMultiScreen(), attachCLBScreen(), update…

- **MULTI**, quand tout le monde tient : un `cp.FrutiScreen` par personne —
  **le même objet que la bouille de la main bar** — empilé au pas de
  `size + 2` (`screen<i>._y = i × (size + ecart)`, d'où les liserés qui se
  touchent), chacun cliquable vers sa fiche (`openFrutizInfo`) et coiffé
  d'une infobulle.
- **CLB**, quand il y a plus de monde que d'écrans : un SEUL `frutiScreen`,
  monté avec `flCLB: true`, qui prend TOUTE la zone (`extWidth = width`,
  `extHeight = height`) — la grande bande verticale — et que
  `box.addUserActionListener(…, 'onCLBEvent')` branche sur les actions du
  salon.

**Et le mode CLB n'est pas « une bouille qui remplace l'autre » : c'est un
AQUARIUM.** `cp.FrutiScreen.onCLBEvent` (0x62361) :

- la bouille de qui s'exprime est attachée à l'échelle `minSide =
  min(width, height)` — elle reste donc CARRÉE, jamais déformée — et posée
  hors champ à gauche (`_x = −width`) ;
- on lui cherche une hauteur AU HASARD dans `[0, height − minSide[`, en
  refusant celles qui tombent à moins de `minSide / 2` d'une voisine — vingt
  essais, puis tant pis (`checkContentCollide`, 0x62693) ;
- elle glisse jusqu'à `x = 0` (`animList.addSlide`, 1,5) ;
- si la personne est DÉJÀ là, rien de neuf : elle re-glisse et joue son
  émotion ;
- au-delà de `maxContent` = **3**, la plus ancienne repart par la gauche
  (`launchIntoTheSpace`) et disparaît.

QUIRK d'époque, gardé : la nouvelle venue est poussée dans `contentList`
AVANT le tirage de sa hauteur, et son `_y` vaut alors 0 — le tirage se
refuse donc lui-même le haut de la zone.

### Ce qu'un écran empile (`initScreen`, 0x61c1d)

| profondeur | clip | rôle |
|---|---|---|
| 10 | `screen` | la plaque, TRACÉE par `drawCustomSquare` |
| 30 | `inside` | masqué par `mask` : le FOND, puis les bouilles |
| 40 | `mask` | un `drawSmoothSquare` au rayon `curve` |
| 50 | `light` | le REFLET, hors du masque — au-dessus de tout |

et `drawScreen` (0x61d40) finit par trois lignes qui disent tout :

    inside.bg._width  = width      // le fond est ÉTIRÉ à l'écran
    inside.bg._height = height
    light._x          = width      // le reflet est calé sur le bord DROIT

- **Le fond**, c'est `frutiScreenBackground` (**#139**, cinq images, laissé
  sur la première par `bg.stop()`) — et ce n'est PAS un cercle propre : c'est
  un dessin à la main, un pourtour `#A2E866` aux contours ondulants, une
  bande `#C5F297`, et un cœur en dégradé radial `#D6F7B5` → `#C5F297` dont le
  centre est DÉCALÉ en haut à gauche (34,45 ; 33,45). Le cercle CSS que j'en
  avais tiré au pixel en donnait les teintes, pas la forme.
  Et il s'ÉTIRE sans garder ses proportions : sur la bande verticale du mode
  CLB (100 × 200) le cœur devient une grande ellipse et le `#A2E866` sort du
  champ — relevé d'époque sur la colonne du milieu, `#D6F7B5` jusqu'à la
  ligne 141, puis la rampe vers `#C5F297` à 173, et pas un pixel de
  `#A2E866`. Un SVG conserve ses proportions PAR DÉFAUT et se contentait d'un
  carré centré, blanc au-dessus et au-dessous : d'où le
  `preserveAspectRatio="none"` que l'extracteur lui pose.
- **Le reflet**, c'est `frutiScreenLight` (**#395**) : un croissant blanc à
  50 % (plus un éclat plein) de 42,7 × 31,8, qui ne s'étire pas et se pose à
  2 px du bord droit et 2 px du haut. Il passe PAR-DESSUS la bouille —
  relevé d'époque : `#E2F9CB` au-dessus du fond, soit exactement `#C5F297`
  sous un blanc à 50 %, et la peau du Frutiz s'éclaircit dessous. Il est sur
  la bouille de la main bar aussi : c'est le même objet.

Le cadre d'un écran, on n'a pas eu à le mesurer, on le CALCULE : liseré
extérieur 2 px `white.shade` `#DDDDDD`, anneau intérieur 1 px `white.darker`
`#888888`, rayon 6.

Le fond, lui, ne vient pas du SWF du bureau mais de la BOUILLE : c'est un
**dégradé radial**, relevé au pixel — `#D6F7B5` jusqu'à 49 px du centre,
`#C5F297` de 51 à 60, `#A2E866` au-delà de 64. Rapporté au rayon du coin
(70,7 sur un carré de 100) : 69 %, 74–85 %, 91 %. Les trois teintes se lisent
aussi bien sur la colonne x 419 que sur la ligne y 318 — la seule distance au
centre les explique, c'est bien un cercle.

J'avais d'abord peint la zone comme le compo vert du fil (celui-là a son
dégradé et son liseré `#ADE76B`) : c'était le mauvais fond. La règle est
celle des écrans, pas celle des compos.

### LE SURVOL ET LE CLIC D'UNE BOUILLE

`cp.ScreenList.attachFrutiScreen` (0xb6597) accroche DEUX choses à chaque
écran, et deux seulement :

    setAction({obj: win.box, method: "openFrutizInfo", args: u})
    setTip({id: "frutiScreen" + u,
            cb: {obj: win.box, method: "getTipDocLong", args: u}})

Le CLIC ouvre donc la fiche du joueur — la même fenêtre que partout ailleurs.

Le SURVOL passe par `TipTextMng` (`frutiparc/TipTextMng.as`, DoInitAction
sprite#888) : `displayCallBack` appelle `box.getTipDocLong(u)`, qui rend

    Lang.fv("chat.u_tip_long", {u, a: age, c: pays, r: région, l: niveau})
    langText.chat.u_tip_long = "<b>$u</b> : $a ans, $r ($c), niveau $l"

**et tout sort du CACHE, pas du réseau.** `UserMng.getInfoBasic` (0x229f7)
lit `infoBasicCache`, rempli par `formatInfoBasic` (0x26786) à partir du nœud
`<u>` de la liste des connectés : `bd` → `birthdayToAge`, `x` → `xpToLevel`,
`co` → `Lang.country`, `rg` → `Lang.region`. La bulle est instantanée.

**`co` et `rg` sont des INDEX** dans la table `<ct>` de
`public/xml/lang_french.xml` — France y est le pays « 1 », Paris le
département « 75 » — et un index introuvable donne le mot `Inconnu`. Notre
serveur envoyait les colonnes libres de la base (`co="FR" rg="IDF"`) : la
bulle affichait « 22 ans, Inconnu (Inconnu), niveau 32 » pour tout le monde,
sur le Flash comme ailleurs. `buildUserAttrs` envoie désormais
`countryIndex`/`regionIndex`, les mêmes que `<userinfo>` donne déjà à la
fiche.

#### La bulle, au pixel (relevé Ruffle, fenêtre 626×486)

    coin haut-gauche = (souris.x − 1, souris.y + 19)

et elle NE SUIT PAS le curseur : elle se pose une fois, au point d'entrée, et
n'y bouge plus jusqu'au `rollOut`. Trois survols, trois bulles au même écart.

    boîte 122 × 48, arrondi extérieur 6
    de l'extérieur vers la chair :
      1 px #66AA22 · 2 px #DDFFBB · 2 px #94DB39 · 1 px #ADE76B · #CCF599
    reflet blanc en haut de la chair : .72 → 0 sur 9 px
      (les neuf valeurs mesurées, #EFFCDE … #CEF59D, tombent au centième)
    Verdana 10 px, interligne 12, encre noire
    3 px de marge à gauche, aucune en haut : 3 lignes = 36 = la chair

**La largeur ne s'adapte PAS au texte** : « zoe » comme « Gaspard » donnent
122. Et **le pseudo tient sa ligne à lui seul**, la suite commençant par son
espace : c'est ainsi que le champ HTML du SWF rend `<b>$u</b> : …` — vérifié
sur les deux pseudos.

#### Une bouille ne RESTE pas dans l'aquarium : elle y passe

`cp.FrutiScreen.onAction` (0x62245) joue l'émotion puis, en mode CLB et
seulement là, pose sur la bouille son ordre de départ :

    content.action(o.id, o.length);
    if (this.flCLB) {
      content.actionCallBack = { obj: this, method: "launchIntoTheSpace",
                                 args: content };
    }

`actionCallBack` se déclenche à la FIN de l'animation. `launchIntoTheSpace`
(0x62565) repose `pos = {x: −minSide, y: _y}` et confie le trajet à
`animList.addSlide(content, "contentSlide" + user, 1.5, {obj, method:
"removeCLBContent", args: content})` ; au bout du glissement,
`removeCLBContent` (0x625ee) la `splice` de `contentList` et la
`removeMovieClip`. **Qui a fini de parler s'en va.**

Le portage n'avait gardé que le débordement (`maxContent` = 3, la plus
ancienne chassée par la nouvelle) : les bouilles s'accumulaient, figées sur
leur vignette, jusqu'au quatrième arrivant. Et comme le light n'a qu'UN
lecteur par fenêtre là où l'époque en avait un par bouille, il faut appeler
le rappel à DEUX moments : la fin du minuteur, et l'arrivée d'une autre
émotion qui prend le lecteur — celle d'avant est alors interrompue, donc
finie elle aussi. C'est ce second cas qui laissait « parfois » une bouille en
plan.

#### Deux choses que le SWF ne fait PAS

- **En mode aquarium, aucune bulle et aucun clic.** `attachCLBScreen`
  (0x74728a) crée un unique `frutiScreen` avec `flCLB: true` et ne lui pose
  ni `setTip` ni `setAction` ; `onCLBEvent` n'en pose pas non plus sur les
  bouilles qui y entrent. Seuls les écrans du mode MULTI répondent.
- **`updateScreen` (0x747044) ne rafraîchit PAS la bulle.** Quand une case
  change de titulaire, il refait `setAction` mais laisse `tipId` et
  `tipCb.args` sur l'ANCIEN pseudo : la bulle ment jusqu'au prochain
  détachement. Bug d'époque ; le light lit le pseudo de la case au moment du
  survol, il ne peut pas se tromper. **Écart assumé.**

### UNE BOUILLE SE REFAIT SUR PLACE (`defineMc` → `onStatusObj`)

Un écran ne se contente pas d'afficher une bouille au moment où on l'accroche :
il est **INSCRIT auprès de son titulaire**, et c'est cette inscription qui le
tient à jour. `attachFrutiScreen` (0xb646f) finit par

    win.box.userList.defineMc(user, screen)

`UserListMng.defineMc(u, mc)` (0x32244) fait `list[u].setMc(mc)`, et
`UserMng.User.setMc` (0x268d0) range le clip dans un `mcList`. Ensuite,
`User.onStatusObj(obj)` (0x26a28) fusionne `obj` dans `infoBasic` **puis
parcourt `mcList` et appelle `mc.onInfoBasic(obj)` sur chacun**.

Côté écran, `frutiScreen.onInfoBasic` (0x62226) renvoie sur `onStatusObj`
(0x620fe), qui tient en huit lignes :

    onStatusObj = function (o, callback) {
      if (o === undefined) { test += "Et mes arguments ? …"; return; }
      if (this.current !== "frutibouille") {          // rien de chargé encore
        this.addContent({id: o.fbouille, loadInitCallback: callback},
                        "frutibouille", true);
        if (o.status.emote !== undefined) this.last.applyEmote(o.status.emote);
      } else {                                        // l'arbre est monté
        var mc = this.last;
        mc.apply(o.fbouille);                         // ← LA BOUILLE SE REFAIT
        if (o.status.emote !== undefined) mc.applyEmote(o.status.emote);
      }
    };

**Un accessoire posé, une humeur changée : l'écran suit, sans rien recharger.**

#### L'aquarium, lui, n'est inscrit nulle part

`attachCLBScreen` (0xb6717) ne pose qu'un
`box.addUserActionListener(content.screen, 'onCLBEvent')` — pas de `defineMc` —
et `updateCLBScreen` (0xb67f5) ne fait que retailler (`extWidth`, `extHeight`,
`updateSize`). Or `onCLBEvent` (0x62318) n'appelle `addContent` **QUE si la
personne n'est pas déjà dans la liste** : celle qui y est reste dessinée comme
elle l'était en entrant, jusqu'à ce que `maxContent` (3) la chasse par la
gauche. **Trou d'époque.** Le portage ne le garde pas : la règle des écrans
nominatifs s'applique aussi à l'aquarium, sans quoi la fenêtre étroite — celle
qui s'ouvre à la connexion, et qui bascule en CLB dès qu'on est deux — ne
montrerait jamais un accessoire mis en cours de route. **Écart assumé.**

#### ET MOI, JE NE SUIS PAS DANS MA PROPRE TRACE

Le serveur diffuse bien la trace `<z>` au salon — mais
`broadcastToChannel(ch, traceXml, socket)` en **exclut l'expéditeur**, et lui
renvoie à la place un accusé **sans pseudo** : `<ae f="…"/>` pour la bouille,
`<af s="…"/>` pour le statut. Le SWF sait quoi en faire, `MeMng` le dit en deux
lignes (`onStatus` 0x227e4, `onFbouille` 0x228d6, et `onInvisible` 0x2285d sur
le même patron) :

    if (node.attributes.u === undefined && node.attributes.s !== undefined) {
      node.attributes.u = me.name;   // l'accusé, c'est MOI
      this.onTrace(node);            // et il repart en trace ordinaire
    }

Sans ces deux `case`, ma colonne d'écrans gardait l'état du moment où j'étais
entré dans le salon. Pire : l'animation d'une émotion, elle, lit le cache et
jouait le BON accessoire — puis la vignette figée reprenait sa place à la fin.
Quatre secondes de vérité, et le mensonge revenait.

### LA LISTE DES CONTACTS : trois pièces du SWF, pas du CSS

`cp.UserList` ne dessine rien non plus. Elle attache `userListBackground`
(clip **#352**) et, par ligne, `userSlot` (clip **#261**) — la liste du
salon n'a NI titre NI onglets, deux ajouts du light qui sautent sur le
bureau (dont « Tout le site », qui n'a jamais existé d'époque).

Le clip #352 tient trois pièces qu'on sort séparément, chacune **sur son
propre cadre** (d'où l'option `cadrePropre` de l'extracteur : sans elle,
toutes les pièces sortent sur le cadre de l'ensemble et se retrouvent
noyées de vide) :

| pièce | profondeurs | taille | rôle |
|---|---|---|---|
| `user-list-boite` | tout sauf 11 et 19 | 122×119 | la boîte, posée en `border-image … 10 fill / 10px` |
| `user-list-pilule` | 11 | 122×20 | la gélule de défilement, en haut ET en bas |
| `user-slot` (#261) | — | 120×18 | la bande d'une ligne |

La boîte est faite de trois morceaux : un chapeau arrondi de 10 px, un corps
droit de 100, un pied qui est le chapeau retourné — d'où la découpe à **10**
et non 14. Le relevé 1:1 confirme : boîte x 557..678 (`#DDDDDD` en 557,
`#C0F18D` en 558, `#E8F8D1` au-dedans), **première bande 10 px sous le bord**,
gélules de 20 px à 4 px de la boîte.

Et la bande d'une personne va d'un bord à l'autre : **557..676**, soit 120 px
— elle RECOUVRE à gauche l'anneau gris et le liseré vert, à droite elle
s'arrête juste avant. Le pseudo y est CENTRÉ (« temoinchat5 » sur 71 px dans
une bande de 120, à 2 px du milieu), en Verdana gras 10, encre `#22224A`.

**UNE LIGNE SUR DEUX seulement porte la bande.** `cp.UserList` (0x66d4b) le
dit au bit près :

    backgroundId = 2 − ((i / 2) == Math.round(i / 2))

soit **1** pour les rangs pairs et **2** pour les impairs — et l'image 2 de la
bande #260 est VIDE : c'est justement celle dont le panneau des contacts se
sert, où aucune ligne n'a de fond. Une ligne sur deux laisse donc voir le
`#E8F8D1` de la boîte : voilà l'alternance. (Et `i` est le rang À L'ÉCRAN, pas
celui dans la liste : l'alternance ne bouge pas quand on fait défiler.)

Côté CSS il y a un piège : un `overflow` rogne au bord de la zone de
remplissage, c'est-à-dire À L'INTÉRIEUR de la bordure. Une boîte en
`border-image` qui défile elle-même coupe donc ses bandes de 10 px. Le
défilement est confié à une enveloppe qui déborde de la bordure par des marges
négatives et qui, elle, rogne sur les 122 px pleins.

### LES FEUTRES, au pixel

`penGFX` (#600) **n'est pas un dessin vectoriel** : c'est le BITMAP **#595**,
une planche de 9×57 en NIVEAUX DE GRIS dont `cp.PenList.display` (0x8212c)
teinte une copie par feutre. Le noir de la planche est le VIDE, pas une
couleur.

La planche tient les MORCEAUX du feutre, et chaque état les empile
autrement :

- **lignes 1..14, colonnes 1..7** : le CAPUCHON, plus large ;
- **lignes 19..29, colonnes 2..6** : la MINE et la virole — ce que le
  capuchon cache ;
- **lignes 30..51** : le FÛT ;
- **lignes 52..55** : l'anneau et la pointe.

Sept px de large, **quarante de haut** au repos. Le relevé de la colonne
nominale (x = 530 sur le feutre orange) donne `a0 d2 e1 ff×6 e1×3 c4 6f |
corps×22 | 6f ff ff e1` : exactement les lignes 1..14 puis 30..55 bout à
bout.

`display` dit la pose, et elle tombe juste :

    _x = 2 + i × 12      _y = 4

soit le **PAS DE 12** qu'on avait mesuré, et 4 px de blanc en haut. Le compo
fait 48 de haut (`displayPenList`, min 120×48) : 4 + 40 + 4. Le premier
capuchon tombe en x 528 quand la colonne du milieu commence en 523. Et le SWF
ne fait pas passer la rangée à la ligne : au-delà de la largeur, les derniers
feutres sont simplement COUPÉS — le relevé montre le quatorzième amputé de
deux colonnes et les trois derniers absents.

La teinture est la transformation ADDITIVE de Flash :

    résultat = couleur + (gris − 255),  borné à 0

Vérifié sur le rendu : le corps d'un feutre orange `#FF6600` sort en
`#C42B00#FF6600#E14800#A00700#7C0000`, et les cinq colonnes du bitmap
valent 196, 255, 225, 160, 124 — soit exactement 255−59, 255, 255−30,
255−95, 255−131. C'est ce que j'avais lu comme « cinq écarts additifs » :
ce sont les cinq colonnes de la planche.

Et la teinture ne prend QUE le clip `col` que
`FEMC.setColor(pen.gfx.col, penList[i], 2)` vise : **les lignes 19..51**,
mine et virole comprises. Le capuchon (1..14) et le pied (52..55) restent
GRIS quelle que soit la couleur du feutre — les trois premiers feutres du
rendu ont rigoureusement le même capuchon. (Les feutres qu'on ne POSSÈDE pas
sont peints d'un `#DDDDDD` PLAT : `setPColor(pen, 0xDDDDDD, 0)`, 0x821b1,
là où les autres reçoivent `setPColor(pen, 0xFFFFFF, 100)`, l'identité.)

#### Les TROIS états du feutre — relevé 1:1, hex pour hex

Un feutre est un `butCustom` : son `gfx` porte une bande d'états, et le
bouton y pioche à partir de `frameDecal`. Les trois dessins sont **alignés
par le BAS** — la pointe ne bouge jamais, c'est le haut qui monte ou
descend. Relevé sur Ruffle, feutre orange `#FF6600`, colonne du milieu :

    repos   607..646  a0 e1×11 c4 6f | E14800×22 | 6f ff ff e1      (40)
    survol  605..646  a0 e1×11 c4 6f | A00700 6F0000 | E14800×22 …  (42)
    choisi  610..646  000000×2 A00700 6F0000×2 A00700×5 6F0000 | …  (37)

- **repos** = lignes 1..14 + 30..55.
- **AU SURVOL, le capuchon MONTE de deux pixels** et découvre deux lignes du
  fût : lignes 1..14 + 28..55. Rien d'autre ne bouge, le corps ne pâlit pas
  d'un iota.
- **le feutre CHOISI est décapuchonné** : `selectPen` (0x821f4) envoie son
  `gfx` à la **frame 5** et rend le précédent à la frame 1 ; recliquer le
  feutre courant remet `current` à `undefined` — c'est comme cela qu'on se
  déchoisit, il n'y a pas de bouton « aucun feutre » d'époque. La frame 5,
  ce sont les lignes 19..55 : le feutre sans capuchon, mine dehors. Trois
  lignes de moins que le feutre coiffé, alignées par le bas : le haut du
  feutre descend de 3, le corps ne bouge pas.
- **et le feutre choisi ne réagit plus au survol** : `frameDecal` passe à 5,
  et le relevé donne exactement les mêmes pixels, souris dessus ou pas.

**Piège : `rollOverPen` est du CODE MORT.** `cp.PenList` définit bien
`rollOverPen` (0x8244c) et `rollOutPen`, qui demandent
`animList.addPaint(pen, …, FENumber.toColorObj(0xFFFFFF), 50)` puis la même
chose à 100 — de quoi faire croire que le feutre survolé pâlit à mi-chemin
du blanc. **Rien ne les appelle** : le `link` du bouton (0x8212c) ne branche
que `onPress`. Le rendu d'époque tranche — le corps du feutre survolé garde
`#E14800` au pixel près. On avait d'abord porté le blanchiment ; il est
retiré.

Les dix-sept couleurs, relevées sur la colonne 2 de chaque feutre :

    0 #FF6600   1 #6666CC   2 #5EA523   3 #962761   4 #F986E2   5 #EBB601
    6 #20D251   7 #47B9C9   8 #472899   9 #A0752E  10 #66451E  11 #729236
   12 #408877  13 #5B944B  14 #264859  15 #C8400D  16 #6E3C8D

Le light en avait des approximations « ISO » assez loin du compte —
l'orange était `#E8732A` là où le SWF met `#FF6600`. Elles sont corrigées,
et les dix-sept `feutre-N.png` sont tirés du bitmap, pas dessinés.

### Ce que le light en fait, et les écarts assumés

La barre du haut mobile devient la colonne de gauche (mêmes nœuds, mêmes
clics : le feutre, les bouilles, les connectés), le menu des salons se tait,
et un quatrième bouton est ajouté pour l'avertissement. Trois écarts :

- **L'avertissement est inerte.** `box.whining` appelle un modérateur ; le
  serveur du revival n'a pas ce fil-là. Le bouton est dessiné parce qu'il
  fait partie de la fenêtre, mais il est désactivé et le dit. (Le cri
  modérateur « !texte » du light, lui, marche toujours.)
- **Le bouton « Envoyer » et l'aide aux accents disparaissent** sur le
  bureau : ni l'un ni l'autre n'existent d'époque. Entrée envoie.
- **La poignée de redimensionnement ne se montre qu'au survol** de son coin.
  D'époque elle est à la profondeur 160, sous le frameSet : on ne la voit
  jamais, mais le clic la traverse quand même. HTML ne sait pas faire ça — un
  élément transparent, lui, reçoit les clics : elle reste donc là, invisible,
  et s'allume quand la souris arrive dessus.
- **Le titre de la liste, l'onglet « Tout le site » et la pastille « toi »
  sautent** sur le bureau : rien de tout cela n'existe d'époque —
  `cp.UserList` n'affiche que les lignes. Le mobile, lui, les garde. Seule
  reste la pastille du STAFF, qui signale les modérateurs — le revival ne le
  signale nulle part ailleurs — mise à l'échelle de la bande et dans la
  palette verte.
- **La pastille « aucun feutre » saute aussi.** Elle décalerait toute la
  rangée d'un pas, et le SWF a mieux : on se déchoisit en RECLIQUANT son
  feutre (`selectPen` remet `current` à `undefined`). C'est ce que fait le
  bureau ; le mobile garde sa croix.
- **Le bouton des bouilles devient un vrai bascule de panneau** sur le
  bureau. Le light s'en servait pour une préférence (afficher ou non la
  bouille de qui vient de parler, en surimpression du fil) ; d'époque il
  ouvre un panneau qui reste. Le clic est donc intercepté avant d'atteindre
  le bouton et ouvre le panneau — le mobile garde sa préférence.
  La zone montre bien, désormais, ses DEUX visages — la pile d'écrans quand
  tout le monde tient, l'aquarium sinon, avec le même seuil et les mêmes
  places au hasard. Deux écarts subsistent, tous deux de moyens :
  - les écrans sont des IMAGES (le cache PNG partagé du site, celui du
    Bouilloscope et du trombinoscope) et non un lecteur Flash par personne :
    un salon plein ne coûte alors que des images déjà en cache ;
  - la capture du cache est prise sur un vert PLAT (`#E8F8D3`, le fond des
    cartes du forum) : on la DÉTOURE, et le fond du SWF (#139) reparaît
    dessous, étiré comme d'époque.
  Quand quelqu'un fait une émotion, le seul lecteur du light déménage DANS
  son écran le temps de l'animation, puis s'éteint : c'est exactement là que
  le SWF la joue.
- **Le feutre multicolore n'a pas de teinte dans la planche** — c'est un
  article du revival. On lui prête la SILHOUETTE du feutre (le PNG sert de
  masque) et on la remplit d'un arc-en-ciel puisé dans les dix-sept teintes.
  C'est le seul feutre dessiné et non extrait.
- **La bulle de survol est refaite en CSS**, aux couleurs et aux mesures du
  relevé (cf. plus haut) ; son contenu vient du même cache que celui du SWF —
  les attributs de la liste des connectés — et le clic ouvre la fiche du
  light, qui est la nôtre. Deux écarts de données : la région reste
  « Inconnu » tant que le joueur n'a pas rempli sa fiche (l'index par défaut,
  `1`, n'est le code d'aucun département — les codes vont de `01` à `95`), et
  la RECHERCHE de joueurs (`searchuser`) filtre toujours sur les colonnes
  libres `country`/`region` là où le formulaire du bureau envoie des index :
  ce fil-là reste à reprendre.

## LES DEUX JOURNAUX (`win.Log`, DoInitAction sprite#750, 0x57281)

`box.UserLog` (0x582a9) et `box.SiteLog` (0xa9da2) n'ajoutent rien à
`win.Log` qu'une icône : `linkIco` vaut « icoUserLog » (#533) ou
« icoSiteLog » (#576). Ces deux clips ont une IMAGE par type d'entrée —
`inspect-swf.js sprite 533` donne les étiquettes : forum (f10), chat (f20),
levelUp (f30), levelDown (f31), inscription (f40), filleul (f50), médaille
(f60), et les images 1..4 sans étiquette pour les sanctions. Elles sont déjà
sorties dans /fb/histo_*.svg et /fb/evt_*.svg.

Ce que dit le bytecode :

- `flResizable = false` — la fenêtre ne se redimensionne pas ;
- `main.showFrame` min **300 × 200**, sans fond, et `main.bigFrame` pointe
  dessus ;
- **`blocMax = 5`** (0x57c2d) : cinq blocs par page, quoi qu'il arrive.
  `pageMax = ceil(liste.length / 5) − 1`, `prevPage`/`nextPage` bornent à
  `[0, pageMax]`, et `updatePageSelector` écrit « (index+1)/(pageMax+1) » ;
- chaque bloc est un `cpDocument` de style **`frSheet`**, min 300 × 60,
  marge `y.min = 6` et `y.ratio = 0`, avec une case de **60** pour
  l'illustration (`gfxList`, `frame = item.type`) puis le texte ;
- le texte est `<b>date - </b>contenu`, et **tout en gras** si l'entrée est
  neuve (`flNew`). La date sort de `Lang.formatDateString('short', t)` :
  « mar 25 aout 23:16 » — **sans accent circonflexe** ;
- le pied est un `cpPageSelector` min 300 × 24 dans `margin.bottom`.

**La hauteur n'est pas fixe pour autant.** `min.h = 200` sur la zone, 60 par
bloc : quand les blocs dépassent, c'est la fenêtre qui cède.

    hauteur = 3 + 16 (bandeau) + max(200, n × 60 + (n − 1) × 6) + 24 + 3

Deux blocs → zone 200 → **246** de haut. Vérifié au pixel.

### Le relevé 1:1 (fenêtre 314 × 246 posée en 375, 293)

    colonne x=600 : bandeau 296..311 · contour du bloc `#DDDDDD` 312-313 ·
      liseré `#ADE76B` 314-315 · chair `#CCF599` 316..371 · liseré 372-373 ·
      contour 374-375 · BLANC 376-377 · contour du bloc suivant 378-379 …
    ligne y=410  : blanc 378-379 · contour 380-381 · liseré 382-383 ·
      chair 384.. · le texte commence en 444 (case de 60) · … · 683 685

Six pixels d'un bloc à l'autre, dont quatre mangés par les deux contours —
la loi des écrans à bouille, encore. Le reflet de la chair : blanc **.64 → 0
sur 8 px** (huit valeurs mesurées au centième).

La TYPO : interligne **12**, capitale **8**, et « mar 25 aout 23:16 -
Connexion » tient en **172 px** avant de passer à la ligne dans une case de
236. C'est du **12 px gras** de la famille du fil du salon (174 px au banc
d'essai) — le 10 px Verdana qu'on avait d'abord n'en faisait que 132.

Le PIED : gélules de 16 ceintes de 2 px `#DDDDDD`, contour en 381..400 et
514..533, « n/N » au milieu. Elles gardent leurs couleurs même quand il n'y a
qu'une page : `cpPageSelector` ne les grise pas.

## LES SCORES (`box.Score`, 0xade18)

La seule fenêtre du bureau qui ne soit pas verte : son `winType` vaut
**« winScore »** (0xc1128), d'où la rampe MIEL. Son BANDEAU ne dit pas
« Scores » mais « Scores - Burning kiwi - mer 26 aout » : c'est le classement
choisi qui la nomme, sa liste de gauche ne surlignant rien.

### Le relevé 1:1 (fenêtre 610 × 328 posée en 375, 293)

    cadre 375 · `#DDDDDD` 376-377 · bandeau blanc 296..311
    colonne GAUCHE  contour 380-381 · liseré `#FACE68` 382-383 ·
                    chair `#FBD888` 384..539 · liseré 540-541 · contour 542-543
    blanc 544-545
    colonne DROITE  contour 546-547 · liseré 548-549 · chair 550..975 ·
                    liseré 976-977 · contour 978-979 · blanc 980-981
    en hauteur : liste 314..587 · sélecteur de jour 590..613 (gélules
                 596..611, contour 594..613) · panneau de droite 314..613

Soit **160** pour la colonne de gauche, **430** pour celle de droite, et six
pixels de l'une à l'autre — dont quatre mangés par les contours. Le reflet de
la chair est le même que celui des cartes du journal : blanc .64 → 0 sur 8.

La colonne de gauche empile des SECTIONS (« Challenge » avec le podium
d'argent, « Championnat » avec la coupe d'or, en 18 px noir) et des lignes de
classement (médaille de 13 px puis le nom, en 12 px, au pas de 16). Le
panneau de droite porte le tableau, en 12 px noir ; quand il est vide, une
seule ligne en haut à gauche : « Classement vide pour le moment ».

### Les COLONNES ANNEXES (`cp.Score`, sprite#900)

Une ligne du tableau n'a pas toujours cinq cases. `cp.Score` en compose la
liste à deux endroits — l'en-tête au `InitArray` de 0xc326e, la ligne à celui
de 0xc360a — et l'ordre est le même :

    rang | frutibouille | Frutiz | Score | <colonnes annexes> | Heure

Les colonnes annexes sont décrites par le serveur, dans le `<ds>` du `<w gs>`
de chaque jeu. Deux types :

    t="t"   du TEXTE — `FEString.formatVars(d, spec.dat)` (0xc36f2)
    t="s"   un DESSIN — un élément `url` d'adresse
            `FEString.formatVars({u: spec.dat}, Path.scoreDataMisc)`, soit
            `/sd/<bibliothèque>.swf`, avec `param.data = d` (0xc377c)

et `d` n'est pas l'attribut brut : c'est
`ext.util.MTSerialization.unserialize(node.attributes.d)`, la chaîne brute ne
servant que de repli. « Skiwix:5:1: » arrive donc au SWF sous la forme
« kiwix:5:1: ». **Trois jeux seulement** ont un `<ds>` non vide :

| `gs` | jeu | colonnes |
| --- | --- | --- |
| 0 | Burning Kiwi | Ecurie (60, `bkiwi_team`) · Rang (60, `bkiwi_rank`) |
| 3 | Swapou 2 | Perso (45, `swapou_score_chars`) |
| 4 | Kaluga | Tzongre (60, `kaluga_tz`) |

Chacune de ces petites bibliothèques (vingt pixels de côté) découpe `data` aux
deux-points à son image 1 et se place sur une image :

    kaluga_tz           data[0] → kaluga 1 · piwali 2 · nalika 3 · gomola 4
                        · makulo 5, sinon 0 ; gotoAndStop(10 + n). Pas un seul
                        sprite dans le fichier : ses cinq tzongres sont posés
                        sur la pellicule RACINE, images 11 à 15.
    bkiwi_team          data[0] → ultra orange · uwe wing · fury hun · sonic
                        brain · kiwix. `teams` ET `cars` vont sur l'image, puis
                        `teams._visible = false` : c'est la VOITURE qu'on voit,
                        et `this.onRelease` bascule sur l'écusson. Nom inconnu
                        → les deux disparaissent.
    bkiwi_rank          pos = data[2] → `rank.pos` (5 images, la 5ᵉ VIDE : la
                        couronne verte « 1 », l'argent « 2 », le bronze « 3 »,
                        le gris « 4 », puis rien) ; perf = data[1] →
                        `rank.perfects` (6 images : la croix, une, deux, trois
                        barres, l'étoile, le point d'interrogation). Un `pos`
                        illisible efface tout (`rank._visible = false`).
    swapou_score_chars  chars.gotoAndStop(parseInt(data[0]) + 2), 8 images —
                        la première étant le refus (la croix rouge).

Le portage n'a pas de lecteur Flash : `scripts/extract-scores-sd.js` rend ces
quatre SWF état par état sous Ruffle et en tire cinquante-quatre PNG
(`public/fb/sd/`), que `vignetteScoreData` (light.html) choisit par la MÊME
règle — bornage de `gotoAndStop` compris : au-delà de la dernière image on y
reste, en deçà de la première on y revient. Ces colonnes sont celles du
BUREAU ; le mobile n'en montre aucune (soixante pixels de plus par colonne y
mangeraient le pseudo).

### Ce qu'il reste à reprendre

- La section « Championnat » d'époque liste QUATRE classements — Class.
  kikooz, **Frutibandas**, Classement XP, Class. consécration — quand
  `/api/light/challenge` n'en sert que trois. Le championnat Frutibandas
  existe pourtant côté revival : c'est la liste servie au light qu'il faut
  compléter.
- Les deux derniers classements ont une AUTRE icône que la médaille (un
  fronton à colonnes) : le SWF la choisit sur le type du classement.
- Le message d'un classement vide garde la phrase du light (« Aucun score
  aujourd'hui… ») : la changer toucherait le mobile, qu'on ne bouge pas
  encore.

## L'EXPLORATEUR (`win.Explorer` 0x91d21, `box.Explorer` 0x86eb4)

La fenêtre JAUNE — « Mes disques », « Inventaire », et tout dossier qu'on y
ouvre. UNE seule classe pour les deux : c'est le dossier ouvert qui décide de
tout.

### Le gabarit, du bytecode

    win.Explorer.init :
      pos = {x: 50, y: 50, w: 400, h: 400}      // 402 × 402 contour compris
      folderType (défaut) = {styleName: "frFileStandard",
                             flNewDirectory: true, flRemoveAll: false}
      initNavigatorIconList() ; displayNavigatorIconList() ;
      displayExplorer() ; endInit() ; moveToCenter()   ← elle s'ouvre AU MILIEU

    displayNavigatorIconList :
      si la liste est VIDE → rien du tout (pas de rangée de boutons)
      struct : limit "y", x.size 24, y.size 24, x.space 2, y.space 2
      compo « navigatorFrame », link « basicIconList », min {w: 80, h: 28}

    displayExplorer :
      compo « fileIconListFrame », link « fileIconList », min {w: 100, h: 100},
      flBackground, flWait, mainStyleName = folderType.styleName

    displayAlert(arr) :
      un compo « cpDocument » par phrase, POSÉ APRÈS « navigatorFrame »,
      min {w: 100, h: 20}, flBackground, mainStyleName « frSystem »

### Les boutons de la barre d'outils (`butPushNavigator` #393)

    flUp           → image 2, tip « explorer_up »              box.getParent
    flNewDirectory → image 3, tip « explorer_new_folder »      (l'ÉTOILE)
    flRemoveAll    → image 4, tip « explorer_empty_recyclebin »
    flMail         → image 5, tip « explorer_new_mail »

tous avec `outline: 2, curve: 4` — une plaque de 20 px, 2 px de `#DDDDDD`
peints autour, soit la case de 24 de la liste.

Et `box.Explorer.onLoadList` choisit lesquels :

    flUp = le dossier a un parent (≠ "root")
    uid commence par « inv »  → ni nouveau dossier ni vidage
    uid == corbeille          → vidage
    uid ∈ {boîtes mail, inventaire, liste noire} ou tpl mail → pas de dossier
    sinon                     → nouveau dossier

### La navigation, SUR PLACE

`IconFileBox.click` (frutiparc/IconFileBox.as) :

    si box.specialClick({uid, type, desc, name})   → fini
    sinon si type == "folder"  → box.getList(uid)   ← la MÊME fenêtre
    sinon                      → _global.onFileClick(...)

et `onLoadList` retitre la fenêtre du nom du dossier (`setTitle(list.desc[0])`).
Rien ne s'empile : c'est un UN CLIC, et le bouton « remonter » revient.

`box.Explorer.specialClick` :

    uid commence par « invpicto, » → la pop-up des pictos du forum
    type == « bouille »   → mainCnx.cmd("fbouille", {f: desc[1]})
                            (+ la fenêtre « recherche » pour le Bananocle)
    type == « wallpaper » → wallPaper.loadWP(desc[1], desc[2])

### Les icônes (`but.Icon` 0x4e473, `but.icon.Standard` 0x842e0)

    but.Icon : icoRatio = 1.66 (1 pour une bouille)
      type "folder"  → ico.s1.gotoAndStop(desc[1])   ← la bande des dossiers
      type "disc"    → ico.disc.gotoAndStop(Number(desc[0]) + 1)
                       ico.disc.label.gotoAndStop(desc[1])
      type "bouille" → l'icône est REMPLACÉE par un `frutibouille`, icoRatio 1

    but.icon.Standard : bx = 3, by = 4, textRatio = 0.5
      r4 = width × (1 − textRatio)          // width = case − 2×bx = 74
      ico._xscale = ico._yscale = r4 × icoRatio        (en POUR CENT)
      ico._x = (width − r4) / 2
      titleField.pos = {x: 0, y: r4, w: width, h: height × textRatio}, centré

Case de **80 px** au relevé 1:1 — d'où `width = 74`, `r4 = 37`, une échelle de
61,4 % qui donne les 36 px du coffre, et l'étiquette à 41 px du haut de la case.
Les disques, eux, passent par `but.icon.Full` : pas d'étiquette, 63 px de côté,
7 px sous le haut de la case.

### Le relevé au pixel (fenêtre en x 485..885 / y 146..547)

    ligne  y=193 : 486 #DDDDDD  488 #FFFFFF  490 #DDDDDD
                   491 #E4E476  492 #EAEA0F  493 #F1F13B  494 #F8F866
    colonne x=686 : 146 #444444  147 #DDDDDD  149 blanc (bandeau, 16 px)
                    165 #DDDDDD  167 #EAEA0F  169 → reflet blanc sur 8 px
                    177 #F8F866

soit : contour de la fenêtre, 2 px de liseré `#DDDDDD`, 2 px de blanc, le
contour de 2 px `#DDDDDD` du champ, son liseré de 2 px `#EAEA0F`, et le fond
`#F8F866` sous le reflet (0,6 → 0 sur 8 px, comme la zone des messages).

Le bandeau d'avertissement : contour de 2 px `#DDDDDD`, fond blanc, intérieur
de 30 px pour deux lignes — **11 px** de corps (la ligne d'époque tient 373 px
pour soixante-seize signes), 13 px d'interligne, encre `#222222` dont
l'anticrénelage descend par paliers réguliers (#5A5A5A, #919191, #C8C8C8).

L'encre des étiquettes d'icônes est `#5A5A00` — le jaune très sombre, pendant
exact du `#335511` vert des étiquettes du bureau (rampe relevée : #5A5A00,
#82821A, #A9A933, #D1D14D, #F8F866).

### Les dessins

Ils ne sont PAS dans main.swf mais dans `fileIcon.swf` : la bande `iconGFX`
(#223, une image par type de fichier) et, imbriquée sous le nom `s1` dans son
image « folder », la bande des dossiers (#200 : « inventory » le coffre,
« disccollector » la boîte à disques, « recyclebin »…). Un disque empile
l'anneau du type de FD (5 teintes du même dessin) et la jaquette du jeu (17
images, une par titre). `scripts/extract-frutiz-explorer.js` sort tout cela,
plus les quatre boutons de `butPushNavigator`, dans `public/frutiz/sprites/`
avec un manifeste `explorateur.json` qui donne le cadre de chaque dessin.

### Ce que le portage lit

Les mêmes URL que le bureau Flash : `/ff/tree` une fois (l'arbre NOMME et TYPE
les dossiers — sans lui les trois dossiers de l'inventaire perdraient leur
coffre), puis `/ff/ls?uid=…` à chaque navigation.

Écarts assumés :
- le champ DÉFILE (`overflow: auto`), là où le SWF ne défilait pas — c'est le
  retour #22, corrigé pour le bureau light ;
- le bouton « nouveau dossier » de « Mes disques » est dessiné plein (comme
  d'époque) mais inerte : `/ff/mk` ne range pas de dossier ailleurs que dans
  « Mes contacts », y compris pour le bureau Flash ;
- la phrase « Vous trouverez dans votre inventaire… » sort AUSSI sur un
  dossier d'inventaire vide. D'époque elle ne visait que la racine, qui dans le
  revival porte toujours ses trois dossiers — elle ne serait jamais sortie ;
- trois disques n'ont pas de portage light (Burning Kiwi, Kaluga, Motion-Ball) :
  ils restent dessinés, comme d'époque, et le disent à l'infobulle.

## LE LECTEUR FRUSION (`_global.Frusion`, DoInitAction 0x990e0)

Le clip `frusion` (#324) n'est pas un décor : c'est une MACHINE, et son
bytecode donne toute la mécanique.

### Les couches du clip

    prof.  1  fondFrusion (#301)   le fond, immobile
           3  fondSlot    (#303)   le berceau du tiroir — IL BOUGE
           9  #304                 la plaque du milieu, immobile
          10  slot        (#308)   le TIROIR — il bouge, et porte le disque
          21  #309 (+34 #319)      la FAÇADE, une plaque opaque PERCÉE de la
                                   cuve : c'est par ce trou qu'on voit tourner
                                   le disque, et rien de plus
          24  #313                 l'ÉJECTION  (DefineButton2 → pushEject)
          29  #317                 le CASQUE   (DefineButton2 → pushReset)

Le clip fait 119 × 77,5 et son origine tombe à x 117,5 dans la boîte. Le
tiroir est posé à (−58, 71) — donc x 59,5 dans la boîte.

### La mécanique, au chiffre près

    init : width = 116, margin = 16, slot._y = 71
           slot.dropBox = this
           dragListener.addListener("disc", {startMethod: "onStartDragDisc",
                                             stopMethod:  "onEndDragDisc"})

    openSlot  → moveSlot vers 140          closeSlot → moveSlot vers 71
    moveSlot(y) :
        r = 0,8 ^ tmod
        slot._y = slot._y × r + y × (1 − r)        ← approche exponentielle
        fondSlot._y = slot._y
        arrivé : si y == 71 ET flDisc → runDisc()

    rotateDisc(sens) :
        d.speed += tmod × sens ; d._rotation −= d.speed
        sens > 0 et speed > 140 → on arrête, et la jaquette JOUE son animation
            de rotation (les anneaux flous du rendu d'époque)
        sens < 0 et speed < 0   → on arrête, flRotating = false, et
            `this[discDestiny]()` — c'est ainsi que l'éjection enchaîne

    onStartDragDisc : si !flDisc et !flOpen → openSlot()   ← LE TIROIR SORT
                      DÈS QU'ON ATTRAPE UN DISQUE, avant de savoir où il ira
    onEndDragDisc   : si !flDisc et flOpen  → closeSlot()

    onDrop(o) : si o.type == "disc" et !flDisc et flOpen :
        flDisc = true ; le disque s'attache au tiroir en `fileIconFull`, posé
        à (−31, −63) ; closeSlot() ; frusionMng.launchDisc(uid) ;
        fileMng.frusionOn(iconInfo)

    pushEject   → frusionMng.eject() ; le jeu rend la main, puis
                  stopDisc("releaseDisc")
    releaseDisc → fileMng.frusionOff() ; openSlot() ; le disque devient
                  CLIQUABLE — `slot.disc.onPress = takeDisc`
    takeDisc    → removeDisc() ; iconInfo.comeFromFrusion = true ;
                  createDragIcon(iconInfo)
    burstDisc   → le disque s'efface (fadeDisc) : un FD consommé
    pushReset   → frusionMng.reset()
    breakFrusion / hangFrusion → l'easter egg, la console qui tremble

`frusion.FrusionManager.launchDisc` charge le GameDisc puis ouvre le jeu selon
sa taille (`checkOpenMode` : interne, pop-up ou cadre) et
`FPSlotList.addSlot(slot, true)` lui donne un ONGLET dans la main bar, qu'il
active — le jeu prend l'espace de travail, il ne flotte pas en fenêtre.

### Le glisser d'un fichier (`IconFileBox`, frutiparc/IconFileBox.as)

    pressIcon  : un contrôle toutes les 25 ms
    checkDrag  : au-delà de dragDistMin = 4 → createDragIcon(), et l'icône
                 d'origine devient invisible (`path._visible = false`)
    click      : si le contrôle court encore, c'était un CLIC — et pour un
                 disque, `_global.onFileClick` ne fait RIEN (la branche
                 « disc » est commentée dans openFunctions.as)

### Le relevé 1:1 (scratchpad/fr-*.png, console en x 1257..1376)

Tiroir sorti : la hampe blanche descend jusqu'à y ≈ 145, le berceau gris est
centré sur l'axe (x 59,5 dans la boîte). Disque inséré : on n'en voit que la
MOITIÉ BASSE, dans la cuve — son centre tombe donc au ras de la corde, à 32,25
px au-dessus de l'origine du tiroir. À plein régime, la jaquette n'est plus
qu'un jeu d'anneaux flous.

Écarts assumés :
- au-delà de 140, le portage garde le disque en rotation à cette vitesse-là
  plutôt que de jouer une animation de jaquette : le même flou, sans dessin de
  plus ;
- `pushReset` n'a pas le canal du Frusion Server : le portage refait ce qu'on
  en voit — le jeu se referme et se relance sur le même disque.

Le CLIC sur un disque ne fait RIEN, comme d'époque : la branche `case "disc"`
est commentée dans `openFunctions.as`, et le bandeau de la fenêtre le dit —
« Pour jouer, faîtes glisser les disques dans la Frusion ». C'est le GLISSER,
et lui seul, qui sort le tiroir et lance le jeu.

## LES ONGLETS (`MainBar.addTab`, `MainBarTab` 0x6f0d6, `FPSlotList.addSlot`)

Trois lois que le portage avait manquées, et qui se voient toutes les trois.

### L'empilement

```
addTab(o) : mcTab.attachMovie("tab", …, dp_tab + (tabMax − id × 2), …)
```

`id` est le rang dans `tabList` : plus il est GRAND, plus la profondeur est
BASSE. **Le nouvel onglet passe SOUS les précédents**, et « Bureau » reste
devant. L'activation n'y change rien — `activate` ne fait aucun `swapDepths` :
elle remonte l'onglet de deux pixels (`scrollUp` vise `flActive × 4`), rien de
plus.

### Le menu, et la PASTILLE qui l'ouvre

`MainBarTab.init` accroche un bouton sur `bottom.but` — la pastille du fruit,
en bas à gauche de la plaque. C'est LUI qui porte le menu :

```
onRollOver : ico.gotoAndStop(flMenu ? 3 : 2)     (si le slot a un menu)
onPress    : flMenu ? scrollUp() : (attachMenu() ; scrollDown())
attachMenu : barre._height = tabMenuMargeUp + n × tabMenuSpace     (8 + n × 18)
             chaque entrée : butText, largeur 100, GRAS,
                             _x = tabMenuMargeLeft (4)
                             _y = −(i × tabMenuSpace + 16)
scrollDown : barre._y → barre._height     (l'onglet DESCEND d'autant)
```

Le menu ne flotte pas au curseur : la plaque s'étire vers le haut, l'onglet
descend, et les entrées prennent la place libérée. `FPTab.getMenu` rend
`[« Vers bureau », « Fermer »]`, mais l'index 0 est posé EN BAS : on lit donc,
de haut en bas, **« Fermer » puis « Vers bureau »** — exactement ce que montre
le rendu d'époque.

### Replier ne veut pas dire afficher

```
WinStandard.putInTab : Key.isDown(17) ? box.putInTab(true)
                                      : glissade puis box.putInTab(false)
box.putInTab(flGo)   : slot.tab(this, flGo)
FPDesktop.tab        : slotList.addSlot(new FPTab(…), flGo)
FPSlotList.addSlot   : … ; if (flGo) slot.mc.activate()
```

Au clic ORDINAIRE, `flGo` est faux : la fenêtre glisse hors de l'écran, l'onglet
se pose dans la barre — et **on reste sur le bureau**. Ctrl enfoncée, la
glissade saute ET l'onglet prend la main. Le portage activait toujours : la
fenêtre s'étalait aussitôt en plein écran, ce qui escamotait le bureau et son
fond d'écran.

### Un onglet est fait de PIÈCES, et elles s'étirent

C'est là que le portage se trompait le plus lourdement : il servait l'onglet
comme UNE image aplatie et posait le menu par-dessus, dans un panneau blanc à
lui. Le clip `tab` (#206) a en fait trois enfants, à trois profondeurs :

```
 3  bottom (#202)   à (−17,5 ; 0,05)  le PIED : la forme #188 (120 × 23 à
                                      1,5 ; −2,05), le champ #190 à
                                      (37,25 ; 4,3) et la pastille `ico`
                                      (#201) à (17,5 ; 2,95)
10  barre  (#204)   à (−16 ; 0)       la PLAQUE : la forme #203, 120 × 18,
                                      de y −18 à 0, écrasée à 0,2222 —
                                      quatre pixels au repos
13  #205            à (0 ; 0)         la COUTURE : une bande #999999 de
                                      123 × 2,5, de y −0,5 à 2
```

et, hors du clip, la silhouette sombre `tabFond` (#187 : `fondB` #184 et
`fondH` #186), que `init` attache à `bar.mcTabBlack` — un conteneur posé sous
TOUTE la rangée, pas dans l'onglet.

La plaque est bornée en BAS par `barre._y` et monte de `barre._height` : elle
occupe `_y − _height` .. `_y`, et ce qui dépasse au-dessus de 0 passe sous la
barre. Le pied la suit (`bottom._y = barre._y`). Trois positions de repos, et
une seule règle :

```
scrollUp   : barre._y → flActive × 4     ; à l'arrivée _height = _y, removeMenu()
activate   : barre._height = max(4, _height) puis scrollDown
attachMenu : barre._height = 8 + n × 18  ; scrollDown fait DESCENDRE l'onglet
updateFond : fondH._height = barre._height ; fondH._y = barre._y ;
             fondB._y = bottom._y
```

Les deux défilements sont la même interpolation, celle de tout le SWF :
`v = v × 0,8^tmod + cible × (1 − 0,8^tmod)`, battue par un `setInterval(…, 25)`.

**Les profondeurs de la barre comptent autant.** `drawInterface` ne dessine pas
la barre d'un bloc :

```
 2  mcInterfaceBlack   le CONTOUR sombre  (darkest, −12 → 78, rayon 12)
 4  mcTabBlack         les silhouettes des onglets
 8  mcTab              les onglets
10  mcInterface        le liseré #DDDDDD et le fond blanc (−10 → 76 ; −8 → 74)
```

Le liseré sombre du bas passe donc SOUS les onglets, et le fond blanc PAR-DESSUS.
Ce qu'on lit au ras de la barre au-dessus d'un onglet, ce n'est pas le trait
noir : c'est la couture grise. Relevé 1:1, la bande `#999999` court de `cornerX`
au bord droit du dernier onglet — et le trait `#444444` reprend juste après.

### Le style d'une entrée de menu

Il se compose en deux endroits, et il n'y a rien d'autre :

```
Standard.getTextStyle()             → { color: 0, font: "Verdana", size: 10 }
Standard.getButTextBasicBehavior()  → { type: "colorText",
                                        color: { press: 14540253, over: 15168875 } }
```

Du **Verdana 10 noir**, qui passe à **`#E7756B`** au survol (`15168875`) et à
`#DDDDDD` à l'appui (`14540253`). La couleur de base n'est pas fournie :
`but.TextBasic.setBehavior` la prend alors dans le champ, donc le noir du
style. La gouttière de 2 px est celle de tout `TextField` Flash — `pos.x` vaut
`margin.x.min × margin.x.ratio` = 0, et l'encre du « F » tombe en x 126 pour
un bouton posé en 123.

**Le gras n'arrive jamais.** `attachMenu` passe pourtant
`textFormat: { bold: true }` dans l'objet d'initialisation — mais aucune des
trois classes ne le relit : `But`, `but.Text` et `but.TextBasic` ne consultent
que `textStyle`, laissé vide. Le relevé 1:1 le confirme : les libellés du menu
sont maigres là où l'étiquette de l'onglet, elle, est bien grasse. Bug
d'origine, conservé.

### L'avertissement rose

```
warning     : animList.addColorFlash("warning", this,
                                     { color: 16755627, alpha: 30, tempo: 500 })
colorFlash  : i++ ; (i % 2 == 0) ? FEMC.setColor(mc, obj) : FEMC.killColor(mc)
stopWarning : animList.remove("warning") ; FEMC.killColor(this)
```

`16755627 = 0xFFB1AB` : une TEINTE à 30 %, pas un clignotement de luminosité —
et elle alterne une demi-seconde sur deux. Le garde-fou est dans `Slot.warning` :
un slot ACTIF n'avertit jamais, un slot déjà en alerte ne relance pas
l'animation, et `Slot.onActivate` coupe l'alerte du slot qui prend la main.

Qui avertit ? `box.Chat.onSend` (et `onSendUser`), à chaque trame de
conversation qui n'est ni une annonce (`t="b"`) ni une image (`t="i"`) :

```
if (cmode == "private" || cmode == "channel" && passwd != undefined) {
  if (mode == "desktop") this.activate();
  this.slot.warning();
}
```

— avec, au passage, un vrai bug d'époque : `onSend` exige `passwd != undefined`
pour un salon, `onSendUser` exige l'inverse. Les deux gardes se contredisent.
Le light avertit dans les deux cas, salons et discussions privées, puisqu'il
n'a qu'UNE fenêtre de conversation : c'est l'onglet qui la porte qui se teinte,
ou celui du bureau si elle y est restée.

## LA MESSAGERIE (`box.Explorer`, `win.ViewMail`, `win.Mail`)

Ce ne sont pas trois vues d'une fenêtre mais **trois fenêtres**.

### La boîte de réception EST un explorateur

L'icône « Boîte de réception » du bureau ouvre `box.Explorer` sur
`fileMng.inbox` — la fenêtre JAUNE, avec `list.tpl == "mail"`. `init` monte le
type de dossier :

```
flNewDirectory = false ; flRemoveAll = false ; flMail = true ; flUp
styleName      = "frFileStandard"                            (le jaune)
lister         = [ {De|À, 140}, {Sujet, 200, big}, {Date, 80} ]
currentSort    = { field: "date", sens: "DESC" }
```

`initNavigatorIconList` n'y pose donc que deux boutons — `butPushNavigator`
image 2 (dossier parent) et image 5 (écrire un courrier) —, et
`win.Explorer.displayList` passe chaque entrée en `fileIconDetail` : l'icône,
puis les trois colonnes. La première est décalée de 20 px, la place de l'icône.

Relevé 1:1 (fenêtre en x 486..896 / y 146..546, soit 411 × 401) :

```
y 229-230  #DDDDDD   le contour du bandeau des colonnes
y 231-232  #EAEA0F   son liseré
y 233-244  reflet blanc puis #F9F977  — 18 px en tout
y 247-254  le contour puis le liseré du CHAMP, deux boîtes distinctes
y 255-262  le même reflet, puis #F8F866
y 277, 299, 321…     #EAEA0F : une rangée fait 22 px
x 631-632, 811-812   #F1F13B : deux pixels entre les colonnes
```

L'encre du bandeau est `#404000`, celle des rangées `#5A5A00`. Et le bandeau
d'avertissement (`explorer.alert.inbox_empty`) ne paraît que si la boîte tient
une entrée ou moins.

### Lire (`win.ViewMail`, 500 × 400)

`attachInfo` : quatre lignes de 20 px, étiquette de 60 **alignée à droite** —
Date, De, À, Sujet, les deux adresses passées par `FPString.toDisplayMail`
(« pseudo &lt;pseudo@frutiparc.com&gt; »). Puis le corps. Puis, en bas,
« Mettre à la corbeille », un grand espace, « Répondre », huit pixels,
« Faire suivre ».

### Écrire (`win.Mail`)

`attachInfo` : trois lignes de 20 px, étiquette de 60 — De (en clair, sur
fond), À (qui accepte le DÉPÔT d'un contact), Sujet. Puis `attachEditTool`,
une barre de 28 px : gras, italique, souligné (`butFlagSmallPink`, images 2 à
4, 20 px chacun), un espace, un menu de corps de texte de 100 px. Puis le
corps (`textFormat: { size: 12 }`). Puis la barre du bas : une case « garder
une copie dans les messages envoyés », un grand espace, « Envoyer ».

**Ce que le portage ne reprend pas, et pourquoi.** La barre de style et la
case de copie n'ont rien à commander : le courrier du light est du texte
simple d'un bout à l'autre — saisie, API, relecture — et le serveur garde
toujours une copie à l'envoi. Le renvoi (« Faire suivre ») n'existe pas côté
light. À l'inverse, le portage ajoute un « Retour » que les trois fenêtres
d'époque n'avaient pas : elles se fermaient.

## LA FICHE (`win.Frutiz` sprite#753 0x583ad, `FrutizInfo` 0x94ba0)

`win.Frutiz extends WinStandard` : **une fenêtre**. Rien ne s'assombrit
derrière elle, et `initInterface` la rend glissable par son cadre —

```
mcInterface.onPress = function() {
  this._parent.box.activate(); this._parent.initDrag();
}
mcInterface.onRelease = mcInterface.onReleaseOutside = endDrag
```

### Le haut (fermée), `base = 42`

```
margin.top → up (type "h", marge x.min 12, y.min 5, y.ratio 1)
  screenFrame   `frutiScreen`, style frSystem, fix { w: base+36, h: base }
  mid (type "w", min 240)
    info    `cpFrutizBasicInfo`, min 200 × 20      le pseudo, l'âge, la ville
    icon (type "h", marge x.min 4, x.ratio 1)
      left    `basicIconList` des boutons blancs, x.align "start"
      right   `basicIconList` d'UN bouton : butPushSmallPink image 13,
              outline 2, curve 4  → toggleAdvancedMode
```

**ÉCART ASSUMÉ : la plaque du bureau est celle du MOBILE.** `fix { w: base+36,
h: base }` donne un `frutiScreen` de 76 × 42 — la bouille y tient dans 35 × 31,
l'écran du niveau se réduit à vingt-sept pixels de rayures et le « NIV n » à
huit pixels d'encre. C'est fidèle au twip près, et c'est illisible sur un écran
d'aujourd'hui : le visage du frutiz, qui est le sujet même de la fiche, n'y est
plus reconnaissable. Le portage mobile avait déjà tranché (vignette de 52 portée
à 60, neuf barres, chiffre en afficheur à segments) ; le bureau reprend ce
gabarit-là, et pour cela `bureau-frutiz.css` ne redéfinit AUCUNE règle de
plaque — ce sont celles de `light.html` qui s'appliquent, les mêmes pour les
deux écrans. Le relevé d'époque reste noté en commentaire dans la feuille, au
cas où l'arbitrage changerait. La bouille, elle, est dessinée par
`FPBouilleVignette` (un canvas), jamais par Ruffle.

`genIconList` bâtit les boutons de gauche depuis `box.iconList`, et c'est
`box.Frutiz.getIconList` qui compose cette liste — ordre et conditions
compris :

```
si c'est MA fiche  → image 10 seule                    frutiz_edit_info
sinon :
  image  2  frutiz_chat_now
  image  3  frutiz_new_mail
  image 13  frutiz_blog
  image  4  frutiz_add_to_contact       si pas déjà au carnet
  image  5  frutiz_add_to_blacklist     sinon image 12, l'en retirer
  si me.flMode :
    image 6 frutiz_kick    ← seulement quand la fiche vient d'un SALON
    image 7 frutiz_ban  ·  image 8 frutiz_mute
  si me.flAnimator et le groupe commence par « quizz » :
    image 6 (si pas modérateur) puis image 7 frutiz_banquick
```

Ce sont les images de la bande `icon` (#500) que porte `butPushSmallWhite` —
des **bitmaps** de 20 × 20, pas des tracés : l'extracteur de formes les rend
vides, et c'est `inlinerImages` qui y remet l'image.

### Le bas (ouverte)

```
initAdvancedMode :
  explorer = main.newElement({ link: "cpDocument", mainStyleName: "frSheet",
                               flBackground: true, min: { w: 250, h: 244 },
                               margin: { y.min 4, y.ratio 1 } })
  explorer.displayWait() ; loadInfo("frutiz")
exitAdvancedMode :
  main.removeElement("explorer") ; pos.h = base
```

`getPageObj(cat)` compose la page sur `{ x:0, y:0, w:250, h:240 }`, et
`getMenuLine` l'ouvre par les quatre catégories — du TEXTE, gras et centré,
en style **1** sauf la courante qui prend **1 + 10 = 11**. `categoryList`
vaut `["frutiz", "perso", "scores", "bonus"]`, en minuscules : c'est la clé
elle-même qui s'affiche, et le titre de page aussi.

`genDisplayInfo` donne les lignes :

```
frutiz : frutiJob · consécration ( %) · niveau · frutiAge ( mois) · inscription
perso  : Prénom · Nom · Date de naissance · Activité · Pays · Région · Ville
```

### Le relevé 1:1 (scratchpad/fr-2-ouverte.png)

Origine au trait sombre de la fenêtre, qui fait **324** de large.

```
y   2      #444444   le trait de la fenêtre
y   3-4    #DDDDDD   ·   y 5..53   #FFFFFF   — le HAUT est blanc
y   8..49            la plaque : 42 de haut, cerclée de #888888
y  54-55   #DDDDDD   ·   56-57 #ADE76B   ·   58..65 le reflet blanc
y  66..297 #CCF599   la chair de la feuille
y  79-80   #ADE76B   le filet sous les onglets
y 180-181, 277-278   les deux autres filets de la page — le bloc des
                     rangées s'OUVRE sur l'un et se FERME sur l'autre
x 315-316  #ADE76B   ·  317-318 #DDDDDD  ·  323 #444444
```

Les rangées d'une page tombent en 187, 208, 227, 244, 265 : **dix-neuf et
demi** de pas.

Et la plaque, en travers (y = 28) puis en hauteur (x = 52) :

```
x   4..42   #D6F7B5   le panneau de la bouille
x  43..69   #A2EB56   l'écran du niveau — sa CHAIR est le vert vif
x  70..75   #C5F297   le fond de la plaque, avec le reflet #E2F9CB en 73-74
x  76       #888888   son contour ·  77-78 #DDDDDD

y  10-11    #EAFBDA   la bande brillante du haut
y  14..37             les rayures de l'écran : un trait #D6F7B5 d'un pixel
                      tous les trois, sur la chair #A2EB56
```

Ce n'est donc pas une jauge à barres claires sur fond sombre : c'est un
écran vert rayé de lignes de balayage plus pâles. Et le REFLET est sur cet
écran-là, pas sur la bouille : la colonne x = 20 ne montre aucune brillance
de y 9 à 39.

Le bouton du dépli, enfin, est `butPushSmallPink` (#378) : sa plaque est le
dessin #359, et le triangle vient de SA bande `icon` (#374) à l'image 13 —
la forme #369, huit de côté, centrée sur les vingt de la plaque.

Les onglets tombent en quatre colonnes égales — centres relevés en 39, 119,
199, 278 pour une largeur utile de 315.

Les encres : le pseudo prend la couleur du **genre** (`UserSlot.onInfoBasic`
— `2367849` = #242169 pour un garçon, `12272708` = #BB4444 pour une fille),
l'âge #404040, l'onglet courant #842929, les autres et tout le corps
#335511. (Le relevé disait #BB4A44 : un chiffre de travers, corrigé — voir la
section « Le pseudo prend la couleur du genre ».)

### Ce que le portage en fait

Le mobile garde sa CARTE MODALE : sur un téléphone une fenêtre flottante n'a
nulle part où flotter, et le voile y a un sens. Sur le bureau, tout le bloc
est repris sous `body.bureau-frutiz` — le voile devient transparent et
`pointer-events: none` (le bureau reste vivant derrière), la fiche se pose
**dans le coin** comme toutes les fenêtres du bureau — `win.Frutiz` ne se donne
pas de `pos` et n'appelle pas `moveToCenter` —, et se glisse par son cadre.

**Ce que le portage ne reprend pas.** `FrutizInfo` d'époque charge chaque
catégorie à la demande (`weWant` / `state_int`), avec un `displayWait` le
temps que le serveur réponde ; le light sert la fiche entière en un appel.
Et la fiche d'époque s'empile dans les fenêtres du bureau (barre d'onglets
comprise) : ici elle flotte, sans onglet à elle.

## POSER SUR LE BUREAU (`FPDesktop` sprite#883 0xb8cae, `cp.DragIconList`)

Le bureau n'est pas un décor : c'est un **dossier**. `FPDesktop` s'abonne à
`fileMng` sur l'uid « root » et tient sa liste d'`IconFileBox`.

### Le geste, et ses DEUX formes

Tirer un **fichier** passe par `IconFileBox` :

```
pressIcon  : setInterval(checkDrag, 25) ; dragPoint = souris
checkDrag  : distance > dragDistMin (4) → createDragIcon(), on désarme
createDragIcon : path._visible = false  ← l'icône quitte sa fenêtre
click      : le contrôle court ENCORE ⇒ c'était un clic
onEndDrag  : path._visible = true ; IconFileBox.dragEnd = getTimer()
initMove   : path._alpha = 50   ← le fantôme pendant que le serveur répond
```

Tirer un **contact** du carnet n'a pas de seuil du tout —
`UserSlot.initButtons` le branche sur `onDragOut` :

```
mcUser.setButtonMethod("onDragOut", this, "createDragIcon")

createDragIcon() :
  _global.createDragIcon({ uid: "new", type: "contact",
                           desc: [userName + "@frutiparc.com"],
                           name: userName, fbouille: this.fbouille })
```

L'uid **« new »** est tout : c'est lui qui fait prendre à `onDrop` la branche
« créer ». Les mêmes arguments servent au clic (`onFileClick`) et au menu
contextuel (`getFileContextMenu`), et la fenêtre des scores les rebranche
telle quelle sur chaque pseudo de son tableau.

### Où ça tombe (`listener.dragIconMouse`)

```
onMouseUp :
  mc = eval(dragIcon._droptarget)  sinon  findDropTarget()
  si mc == undefined        → desktop.onDrop(dragIconOrig)   ← LE BUREAU
  sinon si mc.dropBox       → mc.dropBox.onDrop(orig, mc)
  sinon                     → mc.onDrop(orig)
  puis deleteDragIcon()
```

`findDropTargetIn` descend récursivement les clips sous le curseur, saute
l'icône glissée et les invisibles, et retient le plus profond qui porte un
`dropBox`. **Rien dessous = le bureau** : c'est pourquoi lâcher sur le fond
pose l'objet là. `Depths.dragIcon = 100`, au-dessus de tout.

### Ce que le bureau en fait (`FPDesktop.onDrop`)

```
si l'uid est DÉJÀ dans ma liste :
    pos = globalToLocal(dragIcon._x, _y)
    removeFromList / addToList        ← on REPOSITIONNE, rien de plus
sinon si ico.uid == "new"  → fileMng.make(ico, "root", { pos })
sinon si Key.isDown(17)    → fileMng.copy(ico.uid, "root", { pos })   ← Ctrl
sinon                      → fileMng.move(ico.uid, "root", { pos })
```

Et `IconFileBox.onDrop`, quand on lâche sur une ICÔNE : la cible est
`this.uid` si c'est un dossier, sinon `this.parent` — déposer à côté d'un
fichier le range dans le dossier de ce fichier.

### La grille (`cp.DragIconList`)

```
gridSpace = displayParameters.icon.size.large + 4          → 84
displayIconList : margin x.min 18, y.min 12, flMask: false
                  textColor = wallPaper.txtColor sinon colorSet.green.overdark
initGrid  : xMax = floor(width / gridSpace), idem en y
fitInGrid : sans pos      → getNextAvailablePos()
            hors cadre    → on ramène par pas ENTIERS, puis findNear()
getNextAvailablePos : balayage LIGNE PAR LIGNE (y dehors, x dedans)
addToGrid : case = round(pos / gridSpace) — et elle en tient PLUSIEURS :
            la grille sert à trouver du vide, pas à interdire les recouvrements
findNear  : parcours récursif, dix cases au plus
updateIcons : _x = pos.x, _y = pos.y — aucune animation, ça claque
newIconObj : "fileIconFull" pour un disque, "fileIconStandard" sinon
```

### Le clic sur un raccourci

```
FPDesktop.iconClick(ico) :
  type "folder" → explorerMng.open(ico.uid)
  type "link"   → eval(ico.desc[1])()
```

Un **contact** n'y est pas : il passe par `IconFileBox.click` →
`_global.onFileClick`, qui ouvre sa fiche. Un **disque** non plus, et c'est
voulu — la branche « disc » d'`openFunctions.as` est en commentaire. Le
bandeau de « Mes disques » le dit : « Pour jouer, faîtes glisser les disques
dans la Frusion ».

### Ce que le portage en fait

Le revival tenait DÉJÀ ce bureau pour le client Flash : `user.desktopItems`,
que `/ff/mv` remplit et que `desktopNodesXml` sert en XML. Le mode Frutiz du
light lit et écrit **le même** — poser un disque depuis le light le retire de
« Mes disques » côté Flash aussi. Un objet, une place.

Deux choses ont été ajoutées à ce modèle :

- la **position** (`x`, `y`), que le revival ne retenait pas alors que
  `fileMng.make/move/copy` la porte d'époque. Un objet posé avant reprend la
  première case libre, comme `getNextAvailablePos` ;
- les **dossiers** (`t: "folder"`, et un `p` de parent sur ce qu'ils
  tiennent). Le SWF n'a pas d'explorateur pour les ouvrir côté revival :
  `desktopNodesXml` les saute, ainsi que leur contenu. Ils n'existent donc
  que pour le mode Frutiz du light, qui les ouvre dans une fenêtre bâtie à la
  volée — le même procédé que « Salons publics ».

**Ce que le portage ne reprend pas.** `fileMng.copy` : Ctrl est lu et
transmis, mais un contact ou un disque ne se duplique pas — d'époque non
plus, un même uid ne tient qu'une place sur le bureau. Le raccourci de type
« link » n'a pas d'équivalent (rien ne pose d'`eval` sur ce bureau-là), et
`initMove`/`onMoveError` (le fantôme à 50 % pendant l'aller-retour serveur)
sont sautés : la réponse est locale et immédiate, l'icône paraît tout de
suite et disparaît si le serveur refuse.

## LA BOUTIQUE (`win.Shop`, DoInitAction sprite#795 0x797d3)

`win.Shop extends win.Advance` : une fenêtre à DEUX COLONNES, et
`initFrameSet` les monte de haut en bas.

### La colonne de gauche (`margin.left`, 140 de large)

Deux cadres l'un sous l'autre.

**`bar`**, un cadre horizontal de `140 × topLeftBarHeight` (**22**), marge
`x.min = 8, x.ratio = 1`. Il tient à son tour deux choses :

```
kikoozFrame  cpCounter        min 70 × 22   flBackground   frKikooz
             args = { align: "left", textStyle: Standard.getTextStyle().def
                      + size 14, bold, color colorSet.brown.overdark }
iconList     basicIconList    min 70 × 22   struct = getSmallStruct()
             + x.margin 0, y.margin 0, x.align "end", y.align "start"
             mask = { flScrollable: false }
```

Le compteur porte donc son propre fond (la pastille) et son chiffre en
Verdana 14 gras brun ; les deux boutons se rangent **au bout** de la ligne,
collés en haut. `genIconList` les décrit : deux `butPush` posés sur
`butPushSmallWhite` (#502), `outline: 2, curve: 4`, images **20** et **21** —

```
20  tipId "shop_kikooz_log"      → uniqWinMng.open("kikoozLog")
21  tipId "shop_obtain_kikooz"   → box.obtainKikooz()
```

Attention à la lecture : `butPushSmallWhite` n'a que **deux** images (la
plaque blanche #473, la plaque de survol #501). Le 20 et le 21 ne sont pas
des images du bouton mais de son clip enfant `icon` (#500) — #498 le
journal, #499 le sac de kikooz. Le bouton garde la plaque, l'enfant change
de dessin.

**`menuFrame`**, un `cpTree` de `140 × 60`, `flBackground`, style
`frSystem`, `args = { width: 140, flMask: true }`.

Sa marge cache une **coquille d'époque**, gardée telle quelle :

```
r8.x.min = 8 ; r8.x.ratio = 1 ; r8.y.min = 16 ; r8.x.ratio = 1 ;
                                                ↑ le second devait être y
```

`y.ratio` n'est donc jamais posé : la colonne de gauche ne s'étire pas
verticalement comme l'auteur le croyait.

### Les puces de l'arbre : la chaîne complète

Rien dans `win.Shop` ne dit à quoi ressemble une ligne. Il faut descendre :

```
cp.Tree.addPhysElement   attache "capsDir" si box.list existe, sinon "capsExe"
Capsule.initBullet       lien = box.bulletLink  sinon  style.bullet
Standard.getTreeStyle()  bullet = "standardBullet" pour les quatre niveaux
box.Shop.analyseTree     pose bulletLink: "shopBullet" sur <c> ET sur <p>
```

### Une entrée d'arbre ARRIVE, elle ne paraît pas

`cp.Tree.addPhysElement` (0x7b6xx) ne pose pas la capsule à sa place :

    content.attachMovie(link, "caps" + n, 80000 - n, …);
    caps.pos.x = x + marginLeft;  caps._x = caps.pos.x;
    caps._y = last._y + last.height / 2;        ← elle NAÎT au milieu de la
    if (last !== undefined) {                      précédente
      caps.moveTo(last.pos.y + last.height);    ← puis GLISSE à sa place
      caps.fadeIn();                            ← en se colorant
      caps.id = last.id + 1;
    } else {
      caps.moveTo(0, true);                     ← la première se pose net
      caps.id = 0;
    }

`Capsule.moveTo(y, flDirect)` (0x9f0aa) pose `pos.y`, puis confie le trajet à
`tree.animList.addSlide(…, 2)` — le même amortissement que les fenêtres,
`_y = _y × 0.64 + cible × 0.36` toutes les 25 ms. `Capsule.fadeIn` (0x9f147)
peint la capsule de la couleur du panneau (`FEMC.setPColor(this, c, 0)`) et
laisse `addPaint` la ramener à 100 : de la teinte du fond à ses propres
couleurs.

La liste étant bâtie d'un coup, `last._y` n'a pas encore bougé quand la
suivante naît : les décalages se cumulent de moitié en moitié, et **chaque
entrée démarre à la MOITIÉ de son décalage final**. La colonne entière se
déplie donc depuis le haut. C'est vrai des scores comme de la boutique, et à
chaque fois que l'arbre change — déplier une rubrique fait arriver ses
articles de la même façon.

Le lien est donc `shopBullet` (#567) pour tout l'arbre de la boutique, et
c'est la **classe** qui choisit l'image :

```
caps.Exe   (l'ARTICLE)    gotoAndStop(1)                 → #563, l'OCRE
caps.Dir   (la RUBRIQUE)  gotoAndStop(min(niveau,2)+2)   → #564, le ROSE
```

Ce n'est donc pas « dossier fermé / dossier ouvert » : c'est
« feuille / nœud ». Les 36 images suivantes servent à l'attente.

Les tailles viennent du même `getTreeStyle()` : quatre styles, dont seul le
corps est modifié — `+6` au niveau 1, `+4` au 2, `+2` au 3, sur une base de
10. `caps.Exe` prend `treeStyle[0]` (10), un dossier de niveau 0 prend
`treeStyle[1]` (16). Et `Capsule.height = textFormat.size + 6` donne les
rangées : **16 pour un article, 22 pour une rubrique** — vérifié au pixel,
les cinq puces roses tombent en 57, 127, 149, 171, 193.

Deux **coquilles** de plus dans cette fonction :

```
r2.def.color = 4473924 ; r2.def.bold = true ;     ← jamais lues
r3[4].ts.textFormat.size = …                      ← r3[4] n'existe pas
```

`Capsule` ne lit que `style.ts.textFormat` : la couleur et la graisse posées
un cran trop haut ne s'appliquent jamais, et le relevé le confirme — les
rubriques sont en **noir maigre**, pas en #444444 gras. Quant à `r3[4]`, la
boucle s'arrête à 3 : l'écriture part dans le vide, sans bruit.

### La colonne de droite (`main`)

`showFrame` (horizontal, min 300 × 200, `flBackground`, marge `x.min 8`)
contient `menuInfoFrame` — un `cpDocument` de style **`frSheet`**, la
feuille verte, marge `y.min 4, y.ratio 1`, `flMask`. Puis, sous elle,
`bar` (marge `y.min 6, y.ratio 1`) : un `empty` qui pousse, puis
`pushKikooz`, un `butPush` sur `butPushMoreKikooz` (#558), `outline: 2,
curve: 6`, min `100 × 60` → `box.obtainKikooz()`. La grande plaque orange
part donc à DROITE, et elle mesure en vrai 150 × 60, la taille de son
dessin (#557).

Là encore une coquille : les arguments demandent `frame: 3`, or #558 n'a
qu'une seule image. Flash borne le `gotoAndStop` — on voit l'image 1.

### Choisir un article (`displayItem`)

`attachMenu` glisse un `cpProductMenu` **en tête** de `showFrame` (index 0).
Or `showFrame` est de type `"h"` : l'index 0, c'est la **gauche**. La fiche
se coupe donc en deux colonnes, et non en deux bandes.

`cp.ProductMenu` fait `min: { w: 100, h: 300 }` et se monte ainsi :

```
genScreen    attache "shopScreen" (#405, 100 × 100) puis, dedans,
             "shopScreenLight" (#409) — le lustre ; screen._y = 4
genButList   pour chaque entrée, un butPush sur "butPushShop" (#460,
             80 × 16), curve 8, couleur style.color[0].shade
             _y = 110 + i × 22   ;   _x = (100 − _width) / 2
```

Le relevé le confirme au pixel : l'aperçu en y 33..132 (soit 29 + 4) et le
bouton en y 139..158, exactement 29 + 110. Sa marge `x.min = 12` sépare la
colonne du document, qui commence en x 273.

Puis `cpMenu.setItem(item.picto, entrées)` — le picto de l'article et ses
boutons, montés à l'envers par des `unshift` :

```
si item.screens.length   → push   « Images »       displayItemPage("screenshot")
   … et alors seulement  → unshift « Description »  displayItemPage("description")
si !item.alreadyBuy      → unshift Lang.fv("shop.buy") → box.buy(item.id)
```

« Description » ne paraît donc **que** s'il y a des images : sans elles il
n'y a qu'une page, et pas d'onglet pour y revenir.

`displayItemPage("description")` fabrique un petit XML que le `cpDocument`
avale :

```
<l><t s="4">nom</t></l>
description (les \n rendus par FEString.replaceBackSlashN)
<l><t s="3"> shop.already_have  |  shop.price {p} </t></l>
   + éventuellement <l><t s="2"> shop.price_comment {c}  shop.price_end {d} </t></l>
si quantity > -1  → <l><t s="2">shop.pack_quantity {q}</t></l>
si screens.length → <l><t s="2">N images disponibles !</t></l>
```

Cette dernière ligne est écrite **en français dans le bytecode**, sans
passer par `Lang` : la seule de la fenêtre.

Enfin `scrollText(px)` pousse `cpInfo.mask.y.path.pixelScroll(px)` — la
molette fait défiler la feuille, pas la fenêtre. `displayWait`,
`onBuyError`, `onBuySuccess` sont vides, et `testAlpha` (`_alpha = 50`) est
resté dans la version publiée.

### Le relevé 1:1 (scratchpad/sr2-2-article.png)

Une rubrique dépliée et un article choisi. L'origine est le trait sombre de
la fenêtre, qui fait 476 × 404 ; les rectangles incluent le contour
#DDDDDD, que le SWF dessine à 2 px de tout.

```
COLONNE DE GAUCHE
  compteur      6 .. 79    ×  23 .. 48     74 × 26, coins de 5
                contour #DDDDDD · liseré #F3BE8C · chair #F8D5BC
  bouton 1     98 .. 121   ×  25 .. 48     24 × 24 pour un art de 20
  bouton 2    124 .. 147   ×  25 .. 48     2 px entre les deux
  arbre         6 .. 149   ×  53 .. 392    140 dedans, bord #DDDDDD
                49 .. 52 sont blancs : le #DDDDDD de 47-48 est le
                contour BAS de la pastille, pas le haut de l arbre
                rubriques en 57, 127, 149, 171, 193      (pas de 22)
                articles  en 80, 96, 112                 (pas de 16)

COLONNE DE DROITE
  feuille     154 .. 469   ×  23 .. 330
                contour #DDDDDD · liseré #ADE76B · chair #CCF599
  aperçu      162 .. 261   ×  33 .. 132    100 × 100
  « Acheter » 170 .. 253   × 139 .. 158    l'art 80 × 16 + 2 de contour
  document       dès 273   ×  dès 29
  plaque      314 .. 467   × 335 .. 398    l'art 150 × 60 + 2 de contour
```

Les encres, relevées sur les pixels les plus sombres : le nom **#842929**,
tout le corps de la fiche **#335511**, l'arbre en noir, le compteur
#764A34. `#5A7D33` et `#80A555`, que le premier relevé avait pris pour
l'encre, ne sont que l'anticrénelage de #335511 sur #CCF599.

### Les onze pièces sorties du SWF

```
shop-kikooz          #396 (+#397)   la pièce du compteur
shop-but-blanc       #473           butPushSmallWhite, image 1
shop-but-blanc-2     #501           … image 2 (le survol)
shop-ico-journal     #498           icon (#500) image 20
shop-ico-kikooz      #499           icon (#500) image 21
shop-puce-article    #563           shopBullet image 1 → caps.Exe
shop-puce-rubrique   #564           shopBullet image 2 → caps.Dir niveau 0
shop-but-acheter     #460           butPushShop, 80 × 16
shop-cadre           #405           shopScreen, 100 × 100
shop-cadre-reflet    #409           shopScreenLight, le lustre
shop-plus-kikooz     #557           butPushMoreKikooz, 150 × 60
```

### Ce que le portage en fait

`RUBRIQUES.boutique` ouvre `#shop-sheet` en 476 × 404, centrée, pastille
`winShop`. `habillerBoutique` ajoute les deux boutons blancs de la barre du
compteur et la plaque orange du bas ; le reste (l'arbre, la fiche, le prix,
« Acheter ») est déjà celui du light, seulement rhabillé. La molette du
`cpDocument` devient le défilement naturel de `#bo-fiche`.

Le mobile empile l'aperçu, le nom, l'accroche et le descriptif : sur 240 px
la colonne de 100 étranglerait le texte. Sur le bureau on remet la grille
d'époque — `.bo-tete` passe en `display: contents` pour que ses deux enfants
deviennent des cases, `.bo-vue` tient la colonne de gauche sur toute la
hauteur, et le reste va à droite.

**Ce que le portage ne reprend pas.** Le journal des kikooz (image 20)
n'existe pas côté light — le bouton est là, mais il mène à la même page
d'obtention que son voisin. Et l'onglet « Images » n'a rien à montrer :
les articles du light ne portent pas de captures.

## LES FINITIONS DU PORTAGE

Quatre choses qui n'ont pas d'équivalent dans le SWF — elles naissent du
navigateur — mais qui se voient autant que le reste.

· **Le clignotement du premier survol.** Un état de bouton est un DESSIN à
  part (`_over`, `_down`) posé en `background-image` : le navigateur ne va le
  chercher qu'au moment où la règle s'applique, et la pièce disparaît le temps
  du chargement. Flash avait tout en mémoire dès la première image. Le bureau
  demande donc, au démarrage, toutes les images que sa feuille de style cite
  (`prechargerImages`) — une requête, déjà en cache, et le reste en parallèle.

· **Le curseur du bandeau.** `cursor: move` était une invention : Flash n'a
  que la flèche. C'est `default`.

· **Le glisser d'une icône.** Sans `preventDefault` sur le `pointerdown`, le
  navigateur démarre une sélection de texte et tout ce que le geste balaie
  vire au bleu ; sans `setPointerCapture`, un survol malencontreux vole les
  événements et la tuile reste collée au curseur. Le repère du bureau est
  relu à chaque pas — il bouge (la barre se replie, la bande des contacts
  s'ouvre).

· **La zone de dépôt de la Frusion.** `.fr-cible` disait déjà le tiroir SORTI
  (71 px de haut de page) : rangée parmi les pièces mobiles, elle recevait EN
  PLUS leur translation de 69 et tombait à 140 — sous le dessin, dans le vide.
  Le disque ne se posait jamais. Elle est sur la console, et AVANT le tiroir :
  le disque rendu, lui, doit rester cliquable au-dessus d'elle.

## TROIS RELEVÉS DE FINITION

### Le pseudo qui rougit sous le curseur (`butText`, 0x4986c / 0x9fd26)

Le pseudo d'un contact n'est pas un texte : c'est un `butText`, attaché par
`UserSlot.initText` (0x63541) avec le style de la maison, mis en gras. Et tout
`butText` qui n'apporte pas son propre comportement se voit poser celui par
défaut, `Standard.getButTextBasicBehavior()` :

```
{ type: "colorText", color: { press: 14540253, over: 15168875 } }
                                    0xDDDDDD         0xE7756B
```

`setBehavior` (0x9fd26) complète ce qui manque — `base` n'étant pas donné, il
prend la couleur PROPRE du champ (noir) — puis, pour le type « colorText »
(0x9fe44), câble six méthodes de bouton :

| événement | couleur |
|---|---|
| `onRollOver` | `over` — **#E7756B** |
| `onPress` | `press` — **#DDDDDD** |
| `onRollOut`, `onDragOut`, `onReleaseOutside` | `base` |
| `onRelease` | `over` (le curseur est encore dessus) |

Deux règles CSS suffisent : `:hover` couvre onRollOver **et** onRelease,
`:active` couvre onPress, et le reste revient à `base` de lui-même. La liste
des connectés d'un salon est le même `userSlot` : même comportement.

*(Trois autres jeux de couleurs existent dans `UserSlot` — 0x63aad, 0x63ae4,
0x63b2f — mais ils servent les `displayType` « gender » (bleu / rouge) et
« xp » (vert), que le carnet n'emploie pas : il passe `statusDspMode: "all"`
sans `displayType`.)*

### Le forum n'est pas une fenêtre du bureau (`win.Forum` 0x6e136)

C'est la seule rubrique qui sort de la page. `init` n'attache aucun contenu :

```
getURL("javascript:fp_goURLResize('/fb/?sid=" + sid + "',1)")
```

puis pose un `ForumSlot` sur le bureau — un simple témoin. L'ouverture réelle
tient à l'activation du slot :

| moment | mode `cwm == "1"` | sinon |
|---|---|---|
| `onActivate` | `fp_resizeMe(1)` — un CADRE dans la page | `fp_activatePopupForum()` — une FENÊTRE |
| `onDeactivate` | `fp_resizeMe(0)` | rien : la fenêtre reste |
| `close` | `fp_closeFrame(1)` | `fp_closePopupForum()` |

Et dans les deux cas `me.status.setInternal("forum")` (le voyant « lit le
forum ») puis `wallPaper.hide()`.

Le revival garde la seconde branche — c'est déjà ce que fait la page du
lecteur Flash (`ruffle.html`, `openForumPopup`), et le forum a besoin de sa
largeur. Les deux bureaux visent **la même fenêtre nommée**
(`frutiparc_forum`) : passer de l'un à l'autre n'en laisse pas deux ouvertes.
Le mobile, lui, garde son cadre plein écran et son lien « ‹ Salons ».

### Un onglet actif ne fait pas disparaître le fond d'écran (0xb9574)

```
FPDesktop.onDeactivate = function () {
  this.mcDesk.iconList.removeMovieClip();   // la rangée d'icônes
  this.mcDesk._visible = false;             // le fond du bureau
  this.mc.deactivate();
  super.onDeactivate();
}
```

Rien sur le fond d'écran : `wallPaper` est un manager à part
(`WallPaperMng`, 0x9a5e8), que `FPDesktop` ne touche jamais. L'image reste
peinte derrière tout, et c'est elle qu'on lit dans la bande qui sépare le haut
de la fenêtre, la barre et la frusion.

La preuve est chez ceux qui la cachent **exprès**, parce qu'elle est encore
là : le slot du forum appelle `wallPaper.hide()` (0x6e2fa) et un jeu
`wallPaper.hideImage()` (0x36cb1). Deux appels sans objet si un onglet actif
l'avait déjà effacée. Et les deux ne font pas la même chose —

| méthode | effet |
|---|---|
| `hide()` / `show()` | `mc._visible` — l'image ET la couleur |
| `hideImage()` / `showImage()` | `mc.image._visible` — l'image seule, la couleur reste |

Le portage cachait `#bureau` en entier (fond d'écran compris) : la bande
virait au blanc. Il n'escamote plus que ses ENFANTS — les icônes, la mention
de compte — et coupe la souris sur ce qui reste, un clip invisible ne recevant
rien d'époque.

### Une fenêtre VIENT DU COIN, et à quelle vitesse

**D'où elle part.** `Box.init` (0x23286) attache le clip sans lui donner de
position :

```
this.slot.slotList.mc.attachMovie(this.winType, id, this.depth, this.winOpt)
```

et `winOpt` ne porte que `box` et `title`. Un clip fraîchement attaché est donc
à **(0, 0)** de `slotList.mc` — le coin de la scène. La suite pose sa place et
l'y envoie **en glissant** :

```
endInit → onChangeMode (0x543d5) → initDesktopMode → update (0x53e06)
        → updatePos (0x53e3d) → updateDeskPos (0x53f47) → recal(); moveToPos()
```

D'où la fenêtre qui sort de sous la main bar en diagonale. Ce n'est vrai qu'à
la PREMIÈRE ouverture : rouvrir une fenêtre déjà bâtie prend la branche `else`
de `Box.init` (`swapDepths` + `onChangeMode`), et `moveToPos` part alors de la
place où elle est déjà. Et **même les fenêtres centrées** y vont en glissant :
`moveToCenter` (0x55bee) calcule le milieu puis finit par `recal(); moveToPos()`.

**À quelle vitesse.** `moveToPos` (0x55b47) ne bouge rien lui-même — il confie
la fenêtre à `AnimList.addSlide` (0x51514), qui pose un `setInterval` de
**25 ms** et appelle `AnimList.slide` (0x515d1) à chaque battement :

```js
var k = Math.pow(0.8, tmod × ratio);
mc.regular.x = mc.regular.x × k + mc.pos.x × (1 − k);
mc.regular.y = mc.regular.y × k + mc.pos.y × (1 − k);
mc._x = mc.regular.x;  mc._y = mc.regular.y;
if (Math.round(mc.regular.y) == Math.round(mc.pos.y)
 && Math.round(mc.regular.x) == Math.round(mc.pos.x)) {
  mc._x = mc.pos.x;  mc._y = mc.pos.y;  this.remove(name);
}
```

Les deux inconnues se lèvent :

* **`ratio` = 1** — `addSlide` le met à 1 quand il n'est pas donné, et
  `moveToPos` n'en passe pas (`addSlide("slide", this, callback)`, trois
  arguments) ;
* **`tmod` = 1** — et c'est la surprise : main.swf ne l'écrit **jamais**. Ses
  vingt-trois occurrences sont toutes des lectures. `_global.tmod = 1` est posé
  une fois pour toutes par le **client Frusion** (`frusion_client.swf`, offset
  5813), et `_global` est partagé entre les niveaux.

Donc **k = 0,8** : la fenêtre couvre **un cinquième du chemin restant tous les
25 ms**. Il faut ~10,3 battements — 258 ms, plus les 25 ms du premier — pour en
faire 90 %.

| | coefficient | 90 % du chemin |
|---|---|---|
| **main.swf** | 0,8 par pas de 25 ms | 283 ms |
| portage d'avant (un tiers) | 0,667 | 167 ms — deux fois trop vif |
| portage mesuré au banc | **0,7996** | **284 ms** |

L'ARRÊT n'est pas « à moins d'un demi-pixel » mais « dans le même pixel
entier », les deux coordonnées arrondies : plus tolérant sur un axe (1,6 → 2,4
s'arrête) et plus strict sur l'autre (1,4 → 1,6 continue).

Et `onStageResize` (0x54709) ne fait qu'un `update()` : une fenêtre que l'écran
rétréci repousse **glisse** dans le cadre, elle n'y saute pas.

*(Le SWF garde la position exacte dans `regular` et n'arrondit que pour
l'affichage. Arrondir la position elle-même à chaque pas ferait boiter la fin
du trajet, où l'on n'avance plus que d'une fraction de pixel.)*

*(`initComeFromNowhereMove` (0x55aa0), qui pousse `pos.y` à `100 − h`, est
défini et **jamais appelé** : du code mort. L'entrée n'en dépend pas.)*

*(L'animation est une PRÉFÉRENCE : `endInit` lit `flMoveAnim` dans
`userPref.getPref("win_flMoveAnim")`. La table des préférences vient du
serveur, pas du SWF — le portage la tient dans `FLUIDE`.)*

## LE PSEUDO PREND LA COULEUR DU GENRE (`UserSlot`, 0x63541)

Ce n'est pas une option qu'un composant demanderait : `UserSlot.init` pose le
mode d'affichage PAR DÉFAUT, et c'est le genre —

```
if (this.displayType == undefined) this.displayType = "gender";     (0x6352f)
```

— après quoi `onInfoBasic(o)` (0x63a51) câble sur le champ du pseudo un
`setBehavior` de type « colorText » à trois états, à condition que `o.gender`
soit défini :

| `displayType` | `base` | `over` | `press` | offset |
|---|---|---|---|---|
| `gender`, `M` | **#242169** | #2E42B1 | #5669B3 | 0x63aad |
| `gender`, autre | **#BB4444** | #E77575 | #FEABAB | 0x63ae4 |
| `xp` | #335511 | #558811 | #66AA22 | 0x63b2f |

Les trois du rouge sont la famille `pink` de `_global.colorSet`
(`frutiparc/global.as`) : `darker`, `dark`, `shade`. Le jeu `xp` n'est employé
nulle part ici. Et `base` #242169 est l'encre que le light donnait déjà à tous
les pseudos : le garçon ne change donc pas de couleur, c'est la fille qui en
gagne une.

Le genre voyage dans l'attribut **`sx`** du nœud `<u>` : `formatInfoBasic`
(0x2680f) en fait `o.gender`, et le serveur du revival l'envoie déjà
(`buildUserAttrs`). Trois endroits le portent donc : la liste des connectés
d'un salon, le carnet des contacts (même `userSlot`, même défaut) et le pseudo
de la fiche.

*(Le comportement générique de `butText` — rose au survol, gris à l'appui —
ne vaut que TANT QUE le genre est inconnu : `onInfoBasic` l'écrase. D'où les
`:not([data-genre])` du portage.)*

*(Correction d'un relevé antérieur : la fiche notait #BB4A44. La valeur du
bytecode est `12272708`, soit **#BB4444**.)*

## LA POIGNÉE DE REDIMENSIONNEMENT (`initButtons` 0x5449d, `startResizeAnim` 0x568c1)

Deux clips, qu'il ne faut pas confondre.

**LA ZONE SENSIBLE.** `initButtons` attache le symbole `transp` — un
DefineButton2 (#131) dont l'unique BUTTONRECORD est un `hitTest` sur la forme
#130, **100 × 100** — sous le nom d'instance `butResize`, puis le met à
`_xscale = _yscale = 30`. `updateDeskSize` (0x5400c) le pose à
`pos.w − 20, pos.h − 20`. C'est donc un carré de **30** ancré 20 px avant le
coin : il DÉBORDE de 10 px, et c'est ce débordement qu'on attrape. Le portage
la collait à 8 px À L'INTÉRIEUR — elle ne tombait jamais où l'œil la cherche.

**LE DESSIN N'EXISTE QU'AU SURVOL.** `onRollOver → startResizeAnim`,
`onRollOut → endResizeAnim` (0x56d7d). Avec `var s = 18`, la méthode crée un
clip vide et y trace trois `drawOval` concentriques autour de (−9, −9), plus
l'icône `resizeIcon` (#355, 12 × 12) au même centre :

| pièce | boîte dans le clip | Ø | teinte |
|---|---|---|---|
| `outline` | x = −(s+1), w = s+2 | 20 | `darkest` **#444444** |
| `shade` | x = −s, w = s | 18 | `shade` **#DDDDDD** |
| `main` | x = 2−s, w = s−4 | 14 | `main` **#FFFFFF** |

Les teintes viennent de `style.global.color[0]`, et `getWinStyle` (0x4957f)
donne à `global` la famille **white** : la pastille est blanche cerclée de
gris sur TOUTES les fenêtres, quel que soit leur fruit.

**LE MOUVEMENT.** Le clip naît en `(pos.w − s, pos.h − s)` à l'échelle 0, puis

```
animList.addSlide("resizeArrowMove", resizeArrow, cb, 2)   ratio 2 → k = 0,64
animList.addResize("resizeArrowSize", resizeArrow)         ratio 1 → k = 0,8
       cible = { x: pos.w + s/2, y: pos.h + s/2, xscale: 100, yscale: 100 }
```

À l'arrivée l'origine du clip est en (w+9, h+9) ; les cercles, centrés en
(−9, −9), tombent donc **exactement sur le coin** de la fenêtre. Au départ du
curseur, `endResizeAnim` vise `(pos.w − 20, pos.h − 20)` à l'échelle 0, ratio
1, puis `removeResizeArrow` : au repos, le dessin n'existe pas.

`AnimList.resize` (0x518c8) écrit la MÊME loi que `slide` —
`Math.pow(0.8, tmod × ratio)` toutes les 25 ms — appliquée à
`xscale`/`yscale`. Et `initTabMode` (0x5463f) met `butResize._visible = false`
sur une fenêtre passée en onglet.

## CE QU'ON LIT EN ENTRANT DANS UN SALON

La table d'époque est dans le dépôt : `frutiparc/lang_french.as`. Inutile de
deviner —

```
chat.onjoin      = "<i>Vous discutez maintenant sur le salon $t</i>"
chat.initprivate = "<i>Vous pouvez desormais discuter avec $u.</i>"
chat.userjoined  = "<i>$u a rejoint le salon</i>"
chat.userleaved  = "<i>$u a quitté le salon</i>"
chat.privatedcnx = "<i>$u a quitté la discussion</i>"
```

`box.Chat.onJoin` (0x2e3a9) ne pose `onjoin` QUE hors discussion privée, et
`$t` y vaut `FEString.unHTML(this.topic)` — le SUJET du salon, c'est-à-dire le
nom que la liste des salons affiche. « Vous discutez maintenant sur le salon
Salon Anim's » n'est donc pas un doublon du portage : c'est le nom que
l'animation a donné à ce salon-là.

Deux détails qui comptent : ces lignes sont TOUTES en italique (le `<i>` de la
table, que `.msg.system` porte déjà), et aucune n'a de point final sauf
`initprivate`. Le portage écrivait « — Salon Citron — », qui n'était de nulle
part, et ajoutait des points.

QUIRK CONSERVÉ : « desormais » est écrit **sans accent** dans la table
d'origine. C'est le texte qu'ont lu les joueurs de 2005 ; on le garde.

Enfin, `onJoin` écrit la phrase à CHAQUE entrée — celle d'une reconnexion
comprise. Le fil qu'on vide avant le rejeu du serveur doit donc la retrouver.

## UNE FENÊTRE PAR SALON (`box.Chat` 0x29cb9, `Slot.addBox` 0x35c98)

Le bureau n'a pas de « fenêtre des salons » où les conversations défileraient
tour à tour. Le bytecode le dit deux fois dans le même `init` :

```
cmode == "private"  →  chatMng.setBox(this.user, this)      (0x29fdc)
cmode == "channel"  →  channelMng.pushUniq(this.group)      (0x2a065)
```

Une `box.Chat` est donc indexée par SON interlocuteur ou par SON salon, et
`Slot.addBox` (0x35c98) range les boîtes d'un slot dans une **liste**, pas
dans un emplacement unique. On en ouvre autant qu'on veut ; rejoindre un salon
n'en ferme aucune.

*(Quirk d'époque conservé : les deux branches du test « privé » posent le même
`winType = "winChat"` — le rose, pour les salons comme pour les privés.)*

### En privé, chacun montre son bureau à l'autre (`t="b"`)

Le fond d'écran voyage comme un MESSAGE DE CONVERSATION, corps brut, type
« b ». `cp.ChatManager.sendWallpaper` (0x2d620) :

    sendWallpaper = function (url, alpha) {
      this.send(new XML().createTextNode(alpha + ";" + url), "b");
    };

Deux moments l'appellent — l'ouverture du salon, et chaque changement de fond :

    onChatReady       = function () {                       // 0x31843
      if (wallPaper.url !== undefined)
        this.sendWallpaper(wallPaper.url, wallPaper.pvAlpha);
    };
    onChangeWallpaper = function (url, alpha) {             // 0x317ea
      if (this.cmode === "private") this.sendWallpaper(url, alpha);
    };

En public, rien : `cmode` vaut alors « channel », et un salon partagé n'a pas
de fond — ce serait celui de qui ?

À la réception, `cp.Chat.onTrace` (0x2f178) retient le type AVANT tout
affichage :

    if (t === "b") {
      if (node.attributes.u === me.name) return false;      ← pas mon écho
      var s = node.firstChild.nodeValue.toString();
      if (s.length > 0) { var p = s.split(";");
        this.wallpaper = { url: p[1], alpha: Number(p[0]) }; }
      else this.wallpaper = { url: null, alpha: null };
      this.window.setWallpaper(this.wallpaper.url, this.wallpaper.alpha);
      return undefined;                                     ← AUCUN addText
    }

**Et l'opacité n'est pas un détail.** `win.Chat.setWallpaper` (0x698df) passe
la main à `Frame.setWallpaper` (0x487df), qui charge l'image dans `bg.wp` — le
fond du CADRE, sous tout le reste — puis la FOND dans la couleur du composant :

    mcl.loadClip(url, bg.wp.img);
    FEMC.setPColor(bg.wp, style.color[0].main, 100 - prc);

`setPColor(mc, c, p)` (0x4a9d1) garde `p %` de l'image et plaque `100 − p %` de
la couleur. Le `pvAlpha` d'époque vaut **80** par défaut
(`WallPaperMng.loadWP`, 0x9a6b9 : `dataMisc.length < 3 ? 80 : dataMisc[2]`) :
il ne reste donc que **20 %** de l'illustration. C'est un fond très estompé,
pas une image de fond. En CSS, exactement la même chose — un voile plat de la
chair du fil par-dessus l'image, `background-attachment` laissé à `scroll`
puisque `bg.wp` appartient au cadre et ne défile pas avec les lignes.

**Écart assumé** : l'URL vient d'un autre joueur, et le SWF la donnait telle
quelle à `loadClip`. Le portage n'accepte que la forme d'un fond du parc
(`wal-custom/<id>.<ext>`) — ni schéma, ni hôte, ni remontée de dossier.

### L'onglet « Bureau » a un menu — quatre entrées

`FPDesktop.getMenu` (0xb97cd) n'est pas vide, contrairement à ce que le
portage avait d'abord conclu :

    getMenu = function () {
      var m;
      if (me.name est l'un de bumdum, deepnight, yota, whitetigle, skool,
          warp, roger, test, ernest, hiko, ou (en minuscules) gaspard ou
          snowstar)
        m = [ {title: "Invisibilité",      → mainCnx.cmd("invisible")},
              {title: "Créer accessoires", → desktop.addBox(new
                                              box.NewBouille())},
              {title: "Afficher debug",    → moveDebugToDesktop()} ];
      else m = [];
      var t = main.mainBar.flHalfHide ? "Afficher barre" : "Mode rapide";
      m.push({title: "Se déconnecter", → logout()});
      m.push({title: "Mode light",     → golight()});
      m.push({title: t,                → main.mainBar.toggleHalfHide()});
      m.push({title: "Recherche",      → uniqWinMng.open("search")});
      return m;
    };

Les trois premières sont l'outillage des AUTEURS — les pseudos sont ceux de
Motion-Twin — et n'ont pas cours sur le revival. Restent les quatre de tout le
monde, et `flHalfHide` ne décide QUE du libellé : c'est la même bascule dans
les deux sens. C'est aussi le menu du clic droit sur le fond d'écran.

Comme pour `FPTab`, l'index 0 est posé EN BAS (`_y = −(i × tabMenuSpace + 16)`)
et l'on lit donc, de haut en bas, « Recherche », « Mode rapide », « Mode
light », « Se déconnecter ».

### Fermer, c'est quitter

`box.Chat.close` (0x2a11a) commence par `this.part()` — **avant** le test
`cmode == "private"`, donc pour les deux modes. Vient ensuite le rangement :

| mode | rangement |
|---|---|
| privé | `chatMng.unsetBox(this.user)` (0x2a188) puis `mainCnx.strace(this, user)` |
| salon | `channelMng.rm(this.group)` (0x2a1dc) |

Fermer la fenêtre d'une conversation quitte donc le salon, discussion privée
comprise. *(Le mobile garde sa règle à lui — « on ne quitte jamais un privé »,
faute de quoi un message reçu en arrière-plan n'arriverait jamais : il n'a pas
de fenêtre à fermer.)*

`tryToClose` (0x2a24a) est le geste de la CROIX, et il ajoute une nuance : sur
une discussion privée déjà jointe, si `chooseInviteBehavior` rend `P` ou `R`
(demander / refuser), on ferme vraiment ; sinon la boîte est simplement
**déplacée dans `trashSlot`** — rangée, pas détruite. Le portage ferme dans
les deux cas : le revival n'a pas la table des préférences d'invitation.

### Une invitation ne s'impose pas

`chatMng.onInvite` (0x8d840) trie l'arrivant :

```
si chatMng["_" + u.toLowerCase()] existe  →  chatMng.open(p, g, u, trashSlot)
sinon, selon chooseInviteBehavior(userPref.getPref("invite_chat_behavior")) :
    "A"  →  chatMng.open(p, g, u, trashSlot)      accepter
    "P"  →  une boîte de dialogue                 demander
    "R"  →  refuse                                refuser
```

Le quatrième argument d'`open` est le **slot d'attente**. La conversation
existe, elle a sa fenêtre — mais elle ne prend pas le bureau : c'est l'onglet
qui prévient, `box.Chat.onSend` finissant par `this.slot.warning()`. Le
portage fait exactement cela : la fenêtre naît en onglet, l'onglet clignote.
Sans quoi, sur le bureau, une invitation reçue n'aurait aucun moyen d'être
ouverte — le menu déroulant des salons du mobile n'y existe pas.

### Ce que le portage en a fait

Le panneau du chat du light est RECOPIÉ par salon (`creerCadreSalon`), barre
d'icônes comprise, et chaque copie est branchée sur son salon : son fil, sa
saisie, ses feutres, ses connectés, sa colonne de bouilles, son lecteur
d'émotion. Le bureau loge chaque copie dans une fenêtre, sous la clé
`salon:<id>` — le procédé des dossiers (`dossier:<uid>`).

Trois choix méritent un mot :

- **Les identifiants sont gardés dans la copie.** La feuille de style du chat
  est écrite en `#…` d'un bout à l'autre, celle du bureau par-dessus : les
  réécrire toutes coûterait bien plus que le doublon ne gêne. Et il ne gêne
  pas — `document.querySelector("#x")` rend le PREMIER nœud du document, donc
  toujours le panneau mobile d'origine, qui vient en tête du corps. Tout ce
  qui vise une fenêtre passe par `dansCadre`, qui cherche DANS la copie.
- **Le feutre reste commun.** `selectPen` (0x821f4) écrit dans
  `PenMng.current`, un seul pour la session : le choix se répercute sur toutes
  les barres et toutes les saisies ouvertes.
- **La copie n'a ni « ‹ » ni menu déroulant des salons.** Une fenêtre d'époque
  est liée À SON salon ; on en ouvre une autre par « Salons publics » ou par
  la fiche d'un joueur.

Le mobile ne crée aucune copie : `journalDe(salon)` lui rend `#messages` pour
tout le monde, et rien ne change — un fil, un sélecteur, une conversation à la
fois, ce qui reste la bonne façon de faire sur un téléphone.

## LA FRUTIMANDALA (`cp.WheelMng`, DoInitAction sprite#774 0x6a7c2)

Le cadran du coin haut-droit n'est pas un décor : c'est un tourne-disque à
deux faces, et le clip `cpWheelMng` (#640) en donne l'assemblage.

### Les couches du clip

| prof. | id | rôle |
|------:|---:|------|
| 1  | #609 `mask`   | le BOL — plat en haut, arrondi en bas. Il ne se dessine pas : il DÉCOUPE. |
| 3  | #613          | le fond du cadran, sous les roues |
| 8  | #407 `inside` | le PLATEAU, vide dans le SWF : c'est là que les roues s'attachent |
| 12 | #618          | le triangle rouge de gauche → `pressLeft` |
| 14 | #623          | celui de droite → `pressRight` |
| 17 | #629          | le « G » orange → `pressSwap` |
| 21 | #635          | la double flèche verte → `pressValidate` |
| 25 | #639 `cadran` | le VERRE, par-dessus les boutons eux-mêmes |

`inside` est posé à (1862 ; −750) twips, soit (93,1 ; −37,5) dans le clip —
et (99,4 ; −33,15) dans le dessin, qui commence à (−6,3 ; −4,35). Le centre
des deux roues tombe donc 33 px AU-DESSUS du châssis : seule leur calotte
basse se voit, ce qui donne au cadran sa forme de quartier de fruit.

Le bol de la profondeur 1 est indispensable au portage : le cadran jour/nuit
n'est pas un tracé mais un BITMAP **opaque jusque dans ses coins**, peints du
vert du bureau (`#ADE76B`). Sans découpe, une écharpe verte courait le long
du châssis. La feuille de style s'en sert en `mask-image`.

### Les deux faces, et leur échange

```
init      : fix = {w:186, h:64} ; ray = 100 ; turning = 0
            list = ["whDayNight", "whFruitMonth"] ; swapWheel()
swapWheel : currentPos = (currentPos + 1) % 2 ; loadWheel(list[currentPos])
```

`currentPos` part de 0 : le premier `swapWheel` amène donc **la roue des
frutisignes**, et c'est le bouton « G » qui fait tourner l'autre à sa place.

`loadWheel(link)` attache la roue à la profondeur **10000 − dp** : la NOUVELLE
passe DESSOUS, et c'est l'ancienne qui s'efface au-dessus d'elle. Première
roue : elle entre en glissant depuis `_x = −2·ray` (`AnimList.addSlide`,
`r = 0,8^tmod`). Les suivantes : le plateau s'emballe.

```
animDisk(mcIn, mcOut) — toutes les 25 ms
    accel -= tmod / 90
    r      = (1 + accel) ^ tmod
    turning *= r
    inside._rotation = turning * 6
    inside["wheel" + dp].onBaseTurn()
    r < 1 ? (mcOut encore visible : turning *= −1) puis mcOut.kill()
          : mcOut._alpha = (r − 1) * 400
    |turning| < 0,1 → on s'arrête
```

`turning` part de 2 et `accel` de 0,3 : le plateau accélère une trentaine de
battements, l'ancienne face s'efface, puis le sens s'inverse et tout se
dévide jusqu'à revenir droit.

`pressSwap` ne fait rien tant que l'échange court (`if (!flSwap)`).
`pressLeft` et `pressRight` sont **vides d'époque** : les deux triangles
rouges ne servent à rien, et le portage les laisse muets.

### La roue des frutisignes (`wheel.FruitMonth` #777, 0x6d1a4)

`wheelId = 1` → /wheel/wheel1.swf. `RunDate.getCurrentFSign` (0xbbf73) :

```
t     = getTime() / 1000
signe = floor(((t − 345600) / 604800) % 10)      604800 s = une semaine
part  =      ((t − 345600) / 604800) % 1         345600 = 4 jours de décalage
setRot((signe + part) × 36)                      36° par signe
```

Remise à l'heure toutes les heures.

### Le cadran jour/nuit (`wheel.DayNight` #800, 0x7d97f)

`wheelId = 0` → /wheel/wheel0.swf : un disque de 204 — le ciel qui va du plein
jour à la nuit étoilée, sa couronne de vingt-quatre graduations, un SOLEIL en
haut (−0,5 ; −66,2) et une LUNE en bas (0,1 ; 69,3).

```
wheelInit      : display.attachMovie("extGameNumb", "hour", 1,
                     { link: "police", num: "21:37", scale: 85, _y: 52 })
                 premier réveil calé sur la minute (60 − getSeconds()), puis 60 s
updateDayCoef  : dayCoef = (h + m/60) / 24
                 setRot(dayCoef * 360)
                 hour.setNum(pad(h) + ":" + pad(m))
setRot(deg)    : this._rotation = deg ; display._rotation = −deg
onBaseTurn()   : display._rotation = −(this._rotation + this._parent._rotation)
```

À minuit le disque est droit et c'est la lune qu'on voit dans la fenêtre ; à
midi il a fait un demi-tour et le soleil y trône. L'heure, elle, ne tourne
jamais : `display` contre-tourne exactement d'autant, et `onBaseTurn` fait de
même pendant que le plateau vire.

### Les chiffres (`ext.game.Numb`, rendue par la rustine)

`extGameNumb` est un sprite VIDE de wheel0.swf : tout vient d'une classe de la
bibliothèque partagée de Motion-Twin que main.swf n'embarque pas, et que
`scripts/patch-main-heure-mandala.js` a restituée (cf. tâche « l'heure ne
s'affiche pas »). Sa loi :

```
setNum(num) : un clip par caractère, pris dans la bande `police` (#47) —
              images 1..10 = « 0 » à « 9 », image 12 = « : »
              mc._x = x ; x += mc._width
              compteur._xscale = _yscale = scale        (85)
              compteur._x = (−compteur._width / 2) × align   (align = 1)
```

La dernière ligne centre la BOÎTE D'ENCRE, pas le texte : l'origine part à
−largeur/2 sans corriger le bord gauche du premier glyphe, si bien que
l'écriture penche de 3 px vers la gauche. C'est ainsi d'époque, on le garde.

Les largeurs propres comptent : tous les chiffres font ~37,5 sauf le « 1 »
(22,85), et les deux-points 19,2 — d'où le manifeste `mandalaChiffres.boites`.

### Le REPLI de la barre (`MainBar.toggleHalfHide`, 0x6afbc)

Le bouton vert n'est pas une validation : il **escamote la barre**.

```
hideHeight = 220
replié  : pos.y = −220 ; main.frusion.jumpTo(−220)
          attachMovie("testRetour", "testRetour", 1328)
          testRetour._visible = false ; testRetour._y = hideHeight
déplié  : testRetour.removeMovieClip() ; pos.y = 0 ; frusion.jumpTo(0)
puis    : animList.addSlide("barSlide", this, {…endMove}, 2)
          main.cornerY = 10 + 96 * !flHalfHide          → 106 ou 10
          main.onResize()
endMove : testRetour._visible = true
```

La barre glisse au ratio **2**, la frusion (`jumpTo` → `addSlide` sans ratio)
au ratio **1** : elle traîne derrière, et c'est voulu. `cornerY` tombant à 10,
la rangée d'icônes du bureau remonte et les fenêtres reprennent toute la
hauteur.

`testRetour` (#587) est une petite languette : un dessin de 14,05×14 et un
champ Verdana gras 10 `#4D7417` à 16,3 — « mode rapide ». Posée à
`_y = hideHeight` dans une barre remontée d'autant, elle tombe au ras du haut
de l'écran, à l'abscisse de la barre. Invisible jusqu'à `endMove` : elle
n'apparaît qu'une fois la barre partie.

### Le relevé 1:1 (scratchpad/md-*.png contre ml-*.png)

Le châssis occupe **x 1040..1240, y 2..82**, le centre des cadrans tombe donc
à (1139,4 ; −31,15). L'heure « 11:22 » du rendu Ruffle occupe une boîte
d'encre bleue de **112 × 22** en x 1080..1191 / y 20..41 ; la maquette du
portage, aux mêmes lois, donne la même boîte à la même place. Le cadran
jour/nuit commence à x 1060 sur les deux rendus à y 20, et le bouton « G »
tombe en x 1049..1093.

Écarts assumés :
- d'époque `inside._rotation` garde sa dernière valeur à la fin de l'échange
  (jusqu'à 0,6°, `turning` valant encore moins de 0,1) ; le portage le remet
  droit — invisible, mais on ne traîne pas un cadran de travers ;
- les trois `butPushVerySmallPink` de `initSideIconList` (0x6b786), qui
  offrent le même repli et le plein écran depuis le flanc de la barre, ne sont
  pas encore posés : le bouton vert de la mandala en tient lieu.

## LA RECHERCHE DE FRUTIZ (`win.Search` 0x855db, `box.Search` 0x984e7)

La deuxième fenêtre du bureau qui n'a pas de jumeau mobile — l'autre est
« Salons publics ». Deux portes y mènent, et ce sont celles de l'époque : le
bouton du bas de la bande des contacts (`SideList.buildList` 0xa115b :
`butSearch.onPress = uniqWinMng.open("search")`) et l'entrée « Recherche » du
menu de l'onglet Bureau (`FPDesktop.getMenu`). Le portage renvoyait les deux
vers le Bouilloscope, faute d'annuaire.

### Le gabarit

`win.Search.init` (0x85629) tient en trois lignes — `mWidth = 270`,
`flResizable = false`, `flAdvance = false` — et `initFrameSet` (0x8567a) empile,
de haut en bas :

    doc          cpDocument « search », style frSystem, min {w: 270, h: 20},
                 marge y.min = 6 / y.ratio = 0, args {flDocumentFit: true}
    showFrame    un cadre nu, min {w: 270, h: 0} — les blocs vont là
    pageSelector cpPageSelector, min {w: 270, h: 24}, dans margin.bottom,
                 marge x.min = 10

`flDocumentFit` : **la fenêtre prend la taille de son contenu**. Elle grandit
donc quand la recherche avancée se déplie et quand les résultats arrivent — d'où
`updateSize()` appelé (deux fois !) par `toggleAdvance`, et `frameSet.update()`
après chaque `displayBloc`. Le portage recalcule la hauteur au même moment
(`ajusterFenetreRecherche`) ; la largeur suit la loi du journal (300 de contenu
→ 314 de fenêtre), soit **284**.

`winType = "winSearchFrutiz"` — une étiquette que la bande de fruits #198 ne
connaît pas : la pastille reste l'ORANGE par défaut.

### Le formulaire (`getSearchLines` 0x862c9, `getAdvanceSearchLines` 0x8646d)

Une ligne simple, toujours :

    text   width 60   « pseudo : »
    input             variable "pseudo", maxChars 18, restrict "0-9a-zA-Z"
    spacer width 4
    button            « ok »       → launchSearch
    button dx 3       « avancée »  → toggleAdvance   [SI flAdvanceAvailable]

puis quatre lignes de plus quand `flAdvance` est vrai :

    text 48 « sexe : »   radio 76 « Masculin » M
                         radio 76 « Feminin »  F
                         radio 60 « Tous »     ""
    text 66 « age min : » input 40 (maxChars 2, restrict "0-9")
    spacer 12
    text 66 « age max : » input 40 (maxChars 2, restrict "0-9")
    text 50 « pays : »    comboBox big 100, variable "country"
    text 50 « region : »  comboBox big 100, variable "region"

**L'ordre des trois boutons de sexe est bien « Masculin, Feminin, Tous ».**
`InitArray` renverse l'ordre d'empilement, et le bytecode empile Tous, Feminin,
Masculin, puis l'étiquette. C'est contre-intuitif ; c'est ce que la fenêtre
d'origine affichait, et le « Feminin » sans accent aussi.

`win.search.Frutiz.launchSearch` (0x86a57) commence par une trappe de mise au
point : ENTRÉE enfoncée pendant l'appui sur « ok » affiche quatre « bumdum » de
Bordeaux au lieu d'interroger le serveur. **Écart assumé** : l'outillage des
auteurs n'a pas cours ici.

### La requête (`box.Search.launchSearch` 0x98ab6)

    if (flLoading) return false
    nbPerPage = window.blocMax                      // 6
    q = {} ; q.s = 0 ; q.l = nbPerPage
    if (obj.pseudo.length >= 2)   q.u  = obj.pseudo   ← MOINS DE DEUX
    if (obj.gender.length)        q.sx = obj.gender     LETTRES : IGNORÉ
    t = servTime.getCompleteObject() ; Y = Number($Y)
    if (obj.ageMin.length) { m = Number(obj.ageMin)
                             if (m > 0) q.bdm = (Y − m) + "-$N-$D" }
    if (obj.ageMax.length) { M = Number(obj.ageMax)
                             q.bd = (Y − M − 1) + "-$N-$D" }
    if (obj.city.length)          q.ct = obj.city
    if (countryKey[obj.country] !== undefined) {
      q.co = countryKey[obj.country]
      if (regionKey[obj.region] !== undefined) q.rg = regionKey[obj.region]
    }
    currentSearch = q ; flLoading = true ; mainCnx.cmd("searchuser", q)

Deux BORNES D'ANNIVERSAIRE, donc, et pas deux âges : `bdm` est la date de
naissance la plus ANCIENNE acceptée (elle plafonne l'âge), `bd` la plus RÉCENTE
(elle le plancherise). Le « −1 » de `bd` est d'origine : il fait de
« age max : 20 » un « jusqu'à 20 ans révolus ».

`q.ct` (la ville) n'a pas de champ dans cette fenêtre-là : la boîte le prévoit
pour une autre recherche, qui n'existe pas dans ce SWF.

`nextPage` (0x98cfe) et `prevPage` (0x98dce) ne refont PAS la requête : ils
bougent `currentSearch.s` et la renvoient telle quelle, avec deux bornes écrites
en clair — `s < nbResult − nbPerPage` d'un côté, `s > 0` de l'autre.

### La réponse (`onSearch` 0x98ea1)

    flLoading = false
    if (node.attributes.k !== undefined) { openErrorAlert(…) ; return false }
    page = Math.ceil(Number(s) / nbPerPage + 1)
    if (s == "0") nbResult = Number(n)        ← le total ne se lit qu'à la 1re page
    pour chaque <u> : info = UserMng.formatInfoBasic(u)
      info.fbouille = f ; info.city = ct ; info.presence = Number(p)
      info.status   = s !== undefined ? StatusMng.analyseStr(s) : {}
    window.displayBloc(list, page, nbResult)

et le pied dit `page + "/" + ceil(searchMax / blocMax) + " - " + searchMax +
" réponse" + (searchMax > 1 ? "s" : "")`.

### Une entrée (`cp.SearchSlot` 0xc79dd) — `th = 44`, `mLeft = 24`, 270 × 50

    status     (le voyant)  16 × 16 en (2, 0), `bg` figé sur son image 2
    countryBox (le drapeau) 16 × 16 en (2, th·0.5 = 22)
    frutiScreen (la bouille) fix 44 × 44 en (mLeft = 24, 0)
    doc         cpDocument 190 × 44 en (mLeft + th + 8 = 76, 1) :
                  [ pseudo 110, gras 11 | région, taille 10, à DROITE ]
                  [ « $age ans » 60     | ville,  taille 10, à DROITE ]

et derrière le document, `updateInfoBackground` (0xc8026) peint un carré arrondi
au `drawCustomSquare`, chrome (le reflet) compris :

    x = th + mLeft + 6 = 74      w = width − (x + 2) = 194      h = th
    inline 2 · outline 2 · curve 4
    color.main    = colorSet.pink | colorSet.green
    color.inline  = la même en .shade
    color.outline = win.style.global.color[0].shade = #DDDDDD

**LE GENRE DÉCIDE DE TOUT** : `info.gender == "M"` donne le VERT (`frSheet`,
encre `#335511`), et tout le reste — les filles ET le genre inconnu — le ROSE
(`frRoomList`, encre `#BA4444`). La même règle que la couleur des pseudos dans
les salons. Et `select()` (0xc830e) fait `frutizInfMng.open(info.nickname)` :
cliquer une entrée ouvre la fiche, où que l'on clique dessus.

`updateStatus` (0xc818a), dans l'ordre : pas de statut → image blanche ;
`presence == 0` → l'image « presence » et `ico` à `presence + 1` ; sinon le JEU
en cours (`status.internal`), puis l'absence (`status.external`), puis la
présence par défaut.

### La teinte du formulaire : rien n'y est gris

`cp.Document.newElement` (0x659a5) ne prend pas les couleurs d'une palette à
lui : il puise dans le STYLE DU DOCUMENT, et celui de la recherche est
`frSystem`. `Standard.getWinStyle` (0x49659) lui donne `color = [white, green,
white]`, dont `Standard.getDocStyle` (0x4989b) tire :

    inputColor      = color[1]        → colorSet.GREEN
    bgTextColor     = color[0]
    outlineColorNum = color[0].shade  → colorSet.white.shade = #DDDDDD
    ts.textFormat.color = color[0].overdark

D'où, ligne par ligne :

- un **`type: "input"`** devient un `deInput`, dont la gélule `inputField`
  (#170) est GRISE dans le SWF et se fait teindre par `inputColor` : elle est
  donc VERTE (`#DDFFBB` de chair, `#94DB39` au bord), exactement comme le champ
  « sujet » de la fenêtre des salons ;
- un **`type: "comboBox"`** reçoit `pal = {but: outColor, bg: inputColor}` —
  vert lui aussi ;
- un **`type: "button"`** prend `link = "butPush"` et, faute de `param.link`,
  l'art `butPushStandard` (#465) : **LA GÉLULE ROSE**, celle de « créer un
  salon » — chair `#FFAAAD`, anneau `#F28687`, éclat `#FFEAEC`, encre `#660000`,
  et TROIS largeurs sur trois images (40, 80, 120 ; le portage l'étire en CSS
  plutôt que d'écraser ses bouts ronds). `but.Push.init` (0x80a10) la pose sur
  un `drawSmoothSquare` de rayon `curve + outline` rempli de `color`, large de
  `gfx + 2·outline` : un LISERÉ de 2 px en `outlineColorNum` autour d'elle. Et
  `setPos` (0x80d9e) fait `gfx._y = y + outline` avec y = 0 au repos, 1 au
  survol, 2 à l'appui — la gélule DESCEND, c'est tout l'effet « push ».

Les boutons ne sont donc pas gris : ils sont **roses, cerclés de gris clair**.

### Les dessins sortis du SWF (`scripts/extract-recherche.js`)

- **`mcSearchButton` (#441)** — UN SEUL dessin, trois PROFONDEURS (et non trois
  états) : la plaque grise ch437 (95,6 × 14,45), le champ ch438 et la loupe
  ch440 tournée de 45°. `SideList` ne lui pose qu'un `onPress` : rien ne va
  jamais chercher une deuxième image. Le champ, relevé au tag : police #148
  (**verdana gras**) en 10, encre BLANCHE, **`align = 2` — centré**, `readOnly`,
  texte « recherche », posé en (26 ; 2,35) avec un rectangle de (−2 ; −2) à
  (73,4 ; 14,05). Le portage écrit donc le mot en texte par-dessus le dessin,
  centré dans la zone utile (gouttière de 2 px comprise : x 16,05..87,45).
- **`countryBox` (#113)** — six images ÉTIQUETÉES `fr, be, lu, ca, ch, ot`.
  `initScreen` fait `country.gotoAndStop(info.countryCode)` avec l'INDEX en
  chaîne : Flash ne trouve pas d'étiquette « 3 », retombe sur le numéro
  d'image — et les six images se recoupent EXACTEMENT avec la table `<ct>` de
  lang_french.xml (France 1, Belgique 2, Luxembourg 3, Canada 4, Suisse 5). Un
  code vide devient « ot » (`initScreen` le réécrit) ; Flash borne les autres.
- **`status` (#253)** — le fond `bg` (ch217, 16 × 16) et, au centre,
  `ico` : ch222 pour la PRÉSENCE (trois images seulement — rouge hors ligne,
  verte en ligne, grise invisible), ch246 pour les jeux (déjà sortis par
  `extract-voyants-jeux.js`), ch252 pour les absences. **Les absences ne sont
  pas sorties** : le revival ne les émet jamais (`getStatusCode` assemble un
  `encode62(ext, 1)` toujours nul) et l'ordre d'`externalList` (away, phone,
  zzz, work, eat) ne se recoupe pas avec les cinq dessins relevés. On ne devine
  pas une correspondance qu'aucun trafic ne viendrait confirmer.

### Le Bananocle ouvre la recherche avancée

`box.Search` (0x9868d) : `winOpt.flAdvanceAvailable = me.hasItem(833)` — l'objet
833, c'est le Bananocle (banane + monocle). Et `onAdvanceSearch(b)` (0x98a5d) :

    me.useFrutibouille(b ? "Bananocle" : "Normal")

**Déplier la recherche avancée VOUS MET LE BANANOCLE SUR LE NEZ**, et la replier
vous rend votre visage. Ce n'est pas un ornement de la fenêtre : c'est votre
bouille qui change, et les salons la voient changer.

**Écart assumé, et il ne vient pas de la fenêtre** : sur ce serveur le Bananocle
est un accessoire OFFERT (`DEFAULT_ACCESSORIES`), là où il s'achetait en 2005.
La condition est reproduite telle quelle — la possession réelle de l'objet —
mais tout le monde le possède, et le bouton « avancée » paraît pour tout le
monde. Le jour où il repassera à la caisse, la porte se refermera d'elle-même.

### Trois choses que le portage a dû réparer au passage

1. **`searchuser` renvoyait `co="FR" rg="IDF"`**, les colonnes libres de la
   base, quand tout le reste du serveur envoie déjà les INDEX
   (`countryIndex` / `regionIndex`, cf. `buildUserAttrs`). Le drapeau restait
   sur la France, la région disait « Inconnu », et les deux filtres de la
   recherche avancée — qui comparent l'index choisi dans le menu — ne
   retenaient jamais personne. `db.listAllUsers()` ne rapportait même pas les
   deux colonnes.
2. **L'ordre des départements**. La table `<ct>` était rangée dans un OBJET
   dont les clés « 01 »… « 10 » sont, pour partie, des index entiers aux yeux
   de JavaScript : il remontait « 10, 11, 12… » en tête et laissait « 01, 02 »
   à la fin. C'est un tableau maintenant, dans l'ordre du fichier de langue.
   (Le menu « Région » de la fiche mobile en souffrait aussi.)
3. **`me.hasItem` ne répondait jamais oui.** D'époque, `MeMng` tient la liste
   des objets depuis l'ident. Ici elle n'arrivait qu'à l'ouverture de la
   feuille « Ma Frutibouille », que le bureau desktop n'ouvre jamais : la
   recherche avancée était donc invisible pour tout le monde.

### Les libellés reconstruits

Les titres des deux menus déroulants viennent du fichier de langue du SERVEUR
(`search.country_combo_title`, `search.region_combo_title`,
`search.region_combo_none`), qui n'est pas dans le SWF. **Un seul est connu au
mot près** : `win.search.Frutiz.init` (0x861e9) écrit en dur « Choisissez un
pays ! » comme valeur de repli d'`infoRegion` — c'est donc la phrase d'époque
pour la liste des régions avant tout choix de pays. Les deux autres sont
reconstruits sur ce modèle.

Ce qui n'est PAS reconstruit, c'est la SUBSTITUTION du titre des régions :
`fv(clé, {n: regionName.toLowerCase()})`, où `regionName` est l'attribut `tn` de
la table `<ct>`. Il ne vaut « département » que pour la France — les quatre
autres pays y portent leur propre code (« be », « lu », « ca », « ch »). C'est
la donnée d'origine ; on ne la corrige pas.

## L'AQUARIUM QUI CLIGNOTAIT

Trois causes, toutes dans le fait que le portage n'a qu'UN lecteur par fenêtre
là où l'époque en avait un par bouille.

- **Une bouille qui reprend la parole en partant.** `onCLBEvent` (0x62318) ne
  fait `addContent` que si la personne n'est pas déjà dans `contentList` — et
  une bouille qui s'en va y EST ENCORE : `removeCLBContent` (0x625ee) ne l'en
  retire qu'au bout du glissement. Elle reprend donc son `addSlide(1.5, …,
  "contentSlide" + user)`, et comme le glissement PORTE SON NOM, le nouveau
  remplace l'ancien — callback de suppression compris. Le portage laissait au
  contraire son minuteur courir : sept dixièmes plus tard la bouille s'effaçait
  en pleine parole, **en emportant le lecteur** qu'on venait d'y loger.
- **Le canevas gardait le locuteur précédent.** `FPBouilleVignette.rafraichir`
  remonte l'arbre quand on CHANGE DE FAMILLE, et ce remontage est asynchrone —
  il faut aller chercher un autre fichier. Sans l'effacer, le canevas gardait
  les pixels de la bouille d'avant tout ce temps-là : on voyait le visage du
  locuteur précédent sous celui qui venait de parler, puis un clignotement
  quand la nouvelle famille arrivait enfin. Il s'efface maintenant, et
  `jouer()` transmet aussi l'HUMEUR — sans quoi une bouille fâchée prêtait ses
  sourcils à la suivante.
- **Reparler d'affilée.** `showBouilleOverlay` retirait `bo-anime` à TOUS les
  écrans, y compris celui qui allait jouer, pour le lui rendre trois lignes
  plus bas : sa vignette figée reparaissait le temps d'une image.

## LE GLISSER-DÉPOSER, ET CE QUI L'EMPÊCHAIT

Trois défauts distincts se donnaient la main, et le résultat ressemblait à « le
glisser-déposer marche une fois sur deux ».

### 1. Le désabonnement portait une autre clé que l'abonnement

`rendreAttrapable` — le geste de TOUTES les icônes, celles des explorateurs
comme celles du bureau — écoutait `pointerup` **en capture** et le retirait
**sans** :

    document.addEventListener('pointerup', lache, true);
    …
    document.removeEventListener('pointerup', lache);      // ← rien retiré

Pour le navigateur ce sont deux clés différentes : le retrait ne retirait rien.
Un écouteur restait donc accroché au document à CHAQUE glissé, avec son `parti`
figé à vrai, et tous les anciens se réveillaient au relâchement suivant —
chacun faisant son `stopPropagation()` et appelant `finirGlisser` à vide.
**Mesuré au banc : sept écouteurs de trop après six gestes.** De là
l'impression, au bout de quelques manipulations, qu'« on ne peut plus rien
lâcher ». Le portage retire maintenant avec le même drapeau, et écoute aussi
`pointercancel` — un glissé que le navigateur interrompt doit rendre son icône
plutôt que la laisser invisible.

### 2. Une fenêtre d'explorateur n'était pas un `dropBox`

`box.Explorer` en est un d'époque : `IconFileBox.onDrop` prend l'uid du dossier
affiché et appelle `fileMng.move`. Le portage n'avait fait de `dropBox` que la
Frusion, les dossiers du bureau et le fond d'écran — rendre à « Mes disques »
un disque qu'on venait d'éjecter tombait donc dans le vide.

« Mes disques » est la BOÎTE du serveur : un disque y est toujours. Ce qui l'en
sort, ce n'est pas un déménagement mais un RACCOURCI posé ailleurs. L'y ranger,
c'est retirer ce raccourci-là — et un disque qui sort du lecteur sans raccourci
y rentre de lui-même, le geste réussit quand même. L'inventaire, lui, ne reçoit
rien : ses accessoires, fonds et pictos ne se posent pas sur le bureau, ils
s'APPLIQUENT (`box.Explorer.specialClick`).

### 3. `fileMng.frusionOn` ne vidait qu'une seule vue

Insérer un disque le retire du GESTIONNAIRE DE FICHIERS : tous ceux qui
l'écoutent se relisent, et il disparaît d'un coup de la boîte à disques, du
bureau et de tout dossier ouvert. Il y revient à l'éjection — et c'est
`releaseDisc` qui le rend (`fileMng.frusionOff()`), **avant** même qu'on le
reprenne au curseur.

Le portage ne filtrait que la fenêtre « Mes disques ». Un disque posé sur le
bureau y restait donc pendant qu'il tournait dans le lecteur, et il manquait
l'autre moitié de la règle : `fileMng.move` est un DÉMÉNAGEMENT, pas une copie
— un disque glissé sur le bureau quitte sa boîte. Sans ce filtre-là, le même FD
figurait aux deux endroits.

Relevé au banc, sur le code d'avant : après un aller-retour boîte → bureau →
lecteur → éjection → boîte, on comptait **deux disques sur le bureau et treize
dans une boîte qui en avait quinze**. Après : un seul exemplaire, où qu'il soit.

## L'ASCENSEUR (`ScrollBar` sprite#864, `sb.Round` sprite#865)

**Il n'y a rien à extraire : d'époque l'ascenseur n'est pas un dessin mais un
tracé.** `sb.Round.init` crée deux clips VIDES — `fond` et `square` — et les
peint au `FEMC.drawSmoothSquare`, deux passes chacun :

```
fond    rayon curve,              couleur back.dark
        rayon curve − shadeSpace, couleur back.shade,  rentré de 1
square  rayon curve,              couleur fore.shade
        rayon curve − shadeSpace, couleur fore.main,   rentré de 1
```

soit, pour chacun, une gélule à liseré d'UN pixel. Les réglages viennent du
`scrollInfo` par défaut d'un composant (`cpDocument.initMask`, 0x460e2) :

```
link "sbRound", size 14, margin { top: 4, side: 2 }
color.fore = win.style.global.color[0]
color.back = composant.style.color[0]
```

et de la classe elle-même : `shadeSpace = 1`, `curve = size / 2 = 7`,
`minSquareSize = 16`, `marginInside = 0`. D'où une barre de 14 posée dans 18
(deux de marge de chaque côté) qui s'arrête 4 px avant chaque extrémité, et un
curseur jamais plus court que 16.

**LES DEUX JEUX DE COULEURS NE VIENNENT PAS DU MÊME ENDROIT**, et c'est tout
l'intérêt : `fore` est pris au style **global de la fenêtre** — toujours
`colorSet.white` — tandis que `back` est pris au **style du COMPOSANT**. Le
curseur est donc blanc partout, et la glissière change de fenêtre en fenêtre :

| composant (`mainStyleName`) | où | jeu | glissière / liseré |
|---|---|---|---|
| `frSheet`, `frDef` | chat, journaux, boutique, fiche | green | `#ADE76B` / `#94DB39` |
| `frRoomList` (`cpRoomList`, 0xbec80) | Salons publics | pink | `#FEABAB` / `#E77575` |
| `frScore` (arbre + colonnes, 0xadf23) | Scores | orange | `#FACE68` / `#F8B443` |
| `frFileStandard` (`listerFrame`, 0x9309a) | courrier, disques, inventaire, dossiers | yellow | `#EAEA0F` / `#CACA0D` |
| `frFileTrash` | la corbeille (pas encore portée) | green | `#ADE76B` / `#94DB39` |
| `frFileBlackList` | la liste noire (pas encore portée) | purple | `#BF9ED1` / `#A679C1` |
| `frKikooz` (0x7a1bb) | le compteur de la boutique | brown | `#F3BE8C` / `#E6965B` |
| `frSystem` | arbres, volets d'info | white | `#DDDDDD` / `#AAAAAA` |

La liste de l'explorateur mérite un mot : elle ne déclare pas un style en dur,
elle prend `mainStyleName = folderType.styleName` (0x930be) — c'est le DOSSIER
affiché qui décide. Un dossier ordinaire est `frFileStandard` (le jaune), la
corbeille `frFileTrash`, la liste noire `frFileBlackList`.

Le portage pose deux variables CSS (`--asc-glissiere`, `--asc-liseret`) sur la
fenêtre et les règles `::-webkit-scrollbar-*` ne font que les lire. Relevé au
banc, fenêtre par fenêtre : salon vert, Salons publics rose, Scores orange,
courrier / disques / inventaire jaunes, boutique et journaux verts.

**Piège à ne pas refaire** : `scrollbar-color` doit rester sous
`@supports not selector(::-webkit-scrollbar)`. Depuis Chrome 121, le poser
bascule l'élément sur la barre STANDARD et met tous les `::-webkit-scrollbar` au
rebut — la mise en forme d'époque disparaît sans un mot d'erreur.

## LA PAGE DE CHARGEMENT (`loadingProcess` #154, `loadingInit` 0x08641)

**La toute première chose que main.swf montrait** : un écran vert, le mot
CHARGEMENT, et une **barre rose** qui se remplit. Trois fonctions et un clip
suffisent — `loadingInit()` (0x08641) attache `loadingProcess` à la profondeur
512, `updateLoadingSize()` (0x087ba) le pose, `loadingLoop()` (0x08a52) le fait
vivre une fois par image, à 100 im/s.

### La scène n'est PAS le RECT du SWF

`updateLoadingSize` travaille sur `_global.mcw` × `_global.mch` — que la
première DoAction du fichier (0x07fd0) pose à **`baseMcw = 1265`,
`baseMch = 768`**, et que `StageResize.onResize` y remet à chaque secousse
avant de rappeler `updateLoadingSize()` tant que `flLoading`. Le RECT du SWF
(1024 × 768) ne sert à rien ici. Tout s'exprime en MARGES, donc tout se
transpose tel quel à la fenêtre du navigateur :

```
mx = 32 ; b = 9 ; x0 = mx + b = 41 ; cy = mch / 2 = 384
midMax = mcw − (mx + b) × 2 = 1183        // la gouttière : mx → mcw − mx
title._x     = mcw / 2 = 632,5   title._y     = cy − 24 = 360
fieldInfo._x = mx = 32           fieldInfo._y = cy + 16 = 400
info._x      = mcw / 2 = 632,5   info._y      = cy + 32 = 416
b1 · bgb1 · mid · bgmid → _x = x0, _y = cy      // les formes vont de −3 à 15
bgmid._width = midMax            bgb2._x = x0 + midMax = 1224
```

Neuf enfants, dans l'ordre des profondeurs : `bgb1` · `bgmid` · `bgb2` (la
gouttière), `b1` · `mid` · `b2` (le ruban), puis `fieldInfo`, `title`, `info`.

### Deux dessins pour six pièces

Il n'y a que **deux clips, à deux images chacun** — `loadingInit` fait
`b1/mid/b2.gotoAndStop(1)` et `bgb1/bgmid/bgb2.gotoAndStop(2)` :

| clip | taille | image 1 (ruban) | image 2 (gouttière) |
|---|---|---|---|
| ch142 `mid` | 10 × 18 | ch140 | ch141 |
| ch145 `bout` | 9 × 18 | ch143 | ch144 |

et **le bout DROIT est le même dessin posé avec `a = −1`** : un miroir. Le
dessin d'un bout va de −9 à 0, si bien que le bout gauche couvre `mx..x0` et
que le droit, en miroir à `x0 + largeur`, s'étend vers la droite — la barre
tient donc exactement de `mx` à `mcw − mx`.

Les couleurs, relevées sur les formes :

* **remplissage** — une bande BLANCHE de 18 de haut et, dedans, un ruban de 12
  (y 0..12) en dégradé vertical `#BB1E1E` en haut → `#EE9595` (12,9 %) →
  `#FFC1C1` en bas, coiffé d'un reflet blanc dégradé (y 1..7,5). D'où les trois
  pixels blancs au-dessus et au-dessous du rose ;
* **gouttière** — un corps `#8FCF5A` de 16 (y −2,05..13,95) cerclé d'un liseré
  clair `#DBF3BA` d'un pixel. Sous le bout dort en plus un `#8EDB24` que le
  liseré recouvre entièrement : un reliquat d'époque, gardé tel quel.

Le fond de scène est le vert `#ADE76B` du `SetBackgroundColor`, et l'encre des
quatre champs `#4D7614`.

### Les quatre champs, et où Flash pose leur base

Un `DefineEditText` a une **gouttière de 2 px** : son RECT part de (−2, −2) et
la première ligne pose sa base à `y0 + 2 + ascendante`. Verdana (police #148)
déclare 1030/1024 d'ascendante et 215/1024 de descendante, d'où la hauteur
d'une boîte d'UNE ligne : `2 + (1,0059 + 0,21) × h + 2` — ce que confirme le
RECT du titre (21,05 pour h = 14). **Poser `line-height` égal à cette hauteur
remet la base exactement où Flash la met** : la demi-interligne du navigateur
vaut alors les 2 px de la gouttière.

| champ | fonte | RECT | posé à | dans |
|---|---|---|---|---|
| #149 « CHARGEMENT » | verdana **gras** 14, centré | (−2,−2)–(145 ; 19,05) | (−71,5 ; −8,5) | `title` |
| #147 `fieldInfo` | verdana 10, à gauche | (−2,−2)–(489,1 ; 15,7) | — (c'est le champ lui-même) | `lp` |
| #152 « Information : » | verdana **gras** 10, centré | (−2,−2)–(194,75 ; 14,05) | (−96,4 ; −4,5) | `info` |
| #151 la phrase | verdana 10, centré, multiligne | (−2,−2)–(197,5 ; 121,5) | (−97,75 ; 11,45) | `info` |

L'interligne d'un PARAGRAPHE ajoute l'interligne de police (221/1024) et celle
du champ (2) : `1,4317 × h + 2`, soit 16,32 pour une fonte de 10.

La phrase d'époque, mot pour mot : « Ce chargement comprend tous les éléments
de l'interface de frutiparc ce qui vous permettra de naviguer plus rapidement
ensuite ! »

### La loi du ruban

```
iTotal/iLoaded = les octets de `icon` (fileIcon.swf, chargé pour rien d'autre
                 que le préchargement) ; si iTotal < 1024 → iLoaded = 0,
                 iTotal = 110000   (le SWF n'a pas encore répondu)
mTotal/mLoaded = les octets de main.swf lui-même
fini si mTotal == mLoaded ET iTotal == iLoaded ET coef > 0,995
     → gotoAndPlay("fin"), flLoading = false,
       icon.removeMovieClip(), lp.removeMovieClip()      // sans fondu
sinon :
     ratio = (mLoaded + iLoaded) / (mTotal + iTotal)
     coef  = coef × 0,9 + ratio × 0,1
     mid._width = coef × midMax        b2._x = b1._x + mid._width
     fieldInfo.text = « fichiers restants : » + round((1 − coef) × 100) + « % »
```

**DEUX CHOSES D'ÉPOQUE QU'ON GARDE TELLES QUELLES :**

* **la barre MONTE pendant que le nombre DESCEND.** Le libellé dit « fichiers
  restants » et affiche `(1 − coef)` : à barre pleine il marque 0 %. Le texte
  par défaut du champ dit d'ailleurs « fichiers téléchargés : 100 % », preuve
  que l'un des deux a été changé sans l'autre. C'est le bug d'origine ;
* **le plancher d'une demi-seconde.** Le lissage part de `coef = 0` : même tout
  en cache, il faut **51 images d'époque** (0,9⁵¹ ≈ 0,0046) pour franchir
  0,995, soit 510 ms. La page ne clignote donc jamais.

### Le portage

`scripts/extract-chargement.js` sort les quatre dessins et un manifeste
(`public/frutiz/sprites/chargement.json`) qui porte la géométrie, les boîtes,
les mots, la loi — **et la liste des 165 dessins d'interface**. La feuille de
style tient toute la mise en page (c'en est), le JS ne garde que la loi.

Là où le SWF pesait ses propres octets et ceux de `fileIcon.swf`, le portage
pèse **les dessins de l'interface** : un fichier réglé, un pas de plus. C'est
exactement ce que la phrase promet, et ça règle du même coup le clignotement du
premier survol (les `_up`/`_over`/`_down` sont en mémoire avant le premier
mouvement de souris). Deux inventaires : la liste du manifeste et les images
citées par `bureau-frutiz.css`. Une image absente compte comme réglée — sinon
la page ne finirait jamais.

`ratio` reste à **zéro tant que le total n'est pas connu** : `mTotal` l'était
dès la première image d'époque, et sans cette garde le ruban avancerait puis
RECULERAIT quand le second inventaire arrive.

Le lissage vaut 0,9 **par image de 10 ms**, pas par trame d'affichage : à 60 Hz
la forme fermée `coef = ratio + (coef − ratio) × 0,9^(dt/10)` rend exactement la
valeur d'époque. La constante de temps est gardée, pas le compte d'images.

Relevé au banc (Playwright, 1265 × 768) : gouttière x 32..1233 avec un milieu
de 1183 (= midMax), ruban à partir de x 41 et son bout droit qui le suit, titre
en (559 ; 349,5), champ en (30 ; 398), bloc d'information en (534,11 ; 409,5) —
au dixième les valeurs du SWF. La page reste 0,65 s à froid, 1,9 s cache chaud,
puis disparaît.

## Reste à faire (étapes suivantes)

1. ~~La barre-titre des types de fenêtres~~ : `drawInterface` lit TOUJOURS
   `style.global`, le cadre ne dépend donc pas du type — seuls la pastille et
   le CONTENU changent, et le bandeau fait 16 px (relevé, cf. « Salons
   publics »). Restent les teintes `getWinStyle` manquantes : mesurer au pixel
   les fenêtres jaune/verte/violette/marron (Préférences, Corbeille, Liste
   noire, Kikooz) sur la session connectée — le rose est entamé par la liste
   des salons, l'orange et le citron sont notés plus haut.
2. ~~L'INTÉRIEUR de la main bar au gabarit~~ FAIT (bouille 64, encart 45,
   smileys de 15 au pas de 21, barres de progression 2 px/1 px aux teintes
   `#A2EB56`/`#73B01E`) ; ~~la frutimandala~~ FAITE — les deux cadrans et leur
   échange, l'heure du jour/nuit, le repli de la barre (cf. plus haut).
   Restent les 3 `butPushVerySmallPink` (halfHide/fullScreen,
   initSideIconList 0x6b786) et le plein écran (`toggleFullScreen`).
3. ~~Les icônes du bureau, leur pose et leur glisser-déposer~~ FAIT.
4. ~~Le mode « tab » des fenêtres~~ FAIT (glissade par le haut, Ctrl qui la
   saute, onglet « Bureau » qui clignote, menu « Vers bureau / Fermer »).
   Reste la préférence `win_flMoveAnim`.
6. ~~L'EXPLORATEUR~~ FAIT (« Mes disques » et « Inventaire », cf. plus haut).
7. ~~Le LECTEUR FRUSION~~ FAIT (tiroir, insertion par glisser, rotation,
   éjection, disque repris — cf. plus haut). Restent le `burstDisc` d'un FD
   consommé, le décompte des parties, et l'easter egg `breakFrusion`.
   Restent, quand le serveur saura les tenir : la CORBEILLE (`frFileTrash` +
   `flRemoveAll`), les boîtes MAIL (`tpl: "mail"`, `fileIconDetail` et ses
   colonnes triables) et le glisser-déposer d'un fichier d'un dossier à
   l'autre (`IconFileBox.onDrop` → `fileMng.move`, Ctrl pour copier).
5. ~~Le dépliement du panneau des contacts~~ FAIT (bande 9 → 129, tout le
   bureau décalé de +120, liste à 18 px la ligne, dossiers repliables,
   `butSearch` extrait). Reste, quand le light saura les gérer : AJOUTER ou
   retirer un contact, et le glisser-déposer d'un contact d'un dossier à
   l'autre (`SideList.onDrop` 0xa15a3).

## GASPARD, l'aide du bureau (`box.Help` 0x7fc9f, `win.Help` 0xbd7db)

La PREMIÈRE des six icônes de l'encart. `initNameList` (0xb56c0) donne la
rangée — attention au retournement d'`InitArray`, la dernière valeur empilée
devient l'indice 0 :

    Push "jeux","evenements","historique","messages","forum","gaspard", 6
    InitArray   →   [gaspard, forum, messages, historique, evenements, jeux]

`initIcons` (0x6cbbc) les pose de gauche à droite (`_x = 42 + i×15`, `_y = 33`,
image `i+1` de `digitalIcon`, zone sensible `transp` à 15 % décalée de −7,5),
et câble trois gestes : `onPress` → `select(id)`, `onRollOver` → le champ du
RANG affiche `nameList[id]`, `onRollOut` → il redevient `ladderPos`.

    select(id)   0 → uniqWinMng.open("help")    3 → uniqWinMng.open("userLog")
                 1 → openForum()                4 → uniqWinMng.open("siteLog")
                 2 → openInbox()                5 → openGame()

Gaspard, c'est donc l'AIDE — et sa fenêtre est une CONVERSATION : `win.Help`
étend `win.Dialog` comme le salon, `getIconLabel()` renvoie « winChat » (d'où
la pastille du chat), et la liste des présents porte deux noms (`nbUser = 2`) :
soi et Gaspard. Ni `pos` ni `moveToCenter` : elle s'ouvre dans le coin.

    init           userList.addUser(me.name) ; addUser(Lang.fv("help.name"))
                   loadContent(openContent || { i: 1 })
    getContent(id) previousArr.push(current) ; loadContent({ i: id })
    getPrevious()  loadContent(previousArr.pop())
    analyseInput   trim ; vide → non ; getTimer() − lastSearchTimer ≤ 2500 → non
    search(s)      HTTP("fh/search", { s: s })
    loadContent(o) HTTP("fh/get", o)
    onWheel(d)     window.scrollText(−10 × d)

### La forme des deux réponses, telle que le SWF les analyse

`onGetContent` (0x80396) et `onSearch` (0x8011f) disent quels nœuds et quels
attributs ils lisent — il n'y a plus à deviner :

    <h i="12" n="Titre">                 racine `h`, SANS attribut `k`
      <c><![CDATA[le corps]]></c>        (un `k` → openErrorAlert(error.http.k))
      <l>
        <l t="cat_ls"   i="13" n="Une sous-rubrique"/>
        <l t="cat_tree" i="1"  n="Accueil"/>
      </l>
    </h>

    <r n="3" m="e"><e i="12" n="Titre"/>…</r>
        n = 0 → aucun résultat ; n = 1 → la page s'ouvre directement ;
        m comparé à la seule lettre « e » (sinon : résultats approchants)

Le groupe est un ATTRIBUT du lien (`t`), pas le nom du conteneur : il titre la
section via `Lang.fv("help.link_type." + t)`. Le portage écrivait
`<cat_tree>`/`<cat_ls>` avec des `<l id n/>`, et `n="result"` en tête de
recherche : trois attributs sur quatre tombaient à côté, et `Number("result")`
valant NaN, la fenêtre partait dans la branche des résultats multiples avec une
liste vide. Corrigé des deux côtés — la fenêtre du portage ET main.swf sous
Ruffle lisent maintenant la même chose.

**CE QUE LE SWF N'A PAS** : le TEXTE de l'aide. Il vivait sur le serveur de
2005, derrière ces deux adresses. Le portage le tient en base
(`gaspard_help_topics`) et l'administration l'y écrit
(`/api/admin/gaspard/topics`) : les rubriques restent à rédiger.

## L'interlettrage de la Verdana

main.swf porte un texte STATIQUE en Verdana 10 px — « chargement du truc en
cours » (DefineText #603 et #606, fonte #602 « verdana_10pt_st »). Un texte
statique ne stocke pas des lettres mais des couples (glyphe, avance), et ces
avances-là sont toutes des MULTIPLES DE 20 TWIPS : des pixels entiers. Le
navigateur, lui, avance au centième — 145,75 px contre 144,00 relevés dans le
SWF pour la même phrase.

    écart mesuré sur la phrase           −0,0649 px par caractère
    moyenne pondérée (fréquences du fr.) −0,0696 px par caractère

D'où `body.bureau-frutiz { letter-spacing: -0.007em }`, le milieu des deux
relevés. Les deux fontes SORTIES du SWF (`ImpactSwf`, `LcdSwf`) sont remises à
`normal` : leurs glyphes sont placés par la table de la fonte, sans arrondi à
rattraper. La table de référence n'est pas de confiance aveugle — la fonte #148
de main.swf, la seule Verdana qui déclare sa mise en page, donne 684 716 680
350 1084 703 716 509 pour a d e i m o p r, soit au centième de pixel près les
avances de Verdana Gras : la police embarquée est la vraie, l'écart ne vient
que de l'arrondi. Vérifié par `test/verdanaEspacement.test.js`, qui relit les
avances DANS le SWF.

## Les jaquettes de disque

Les dix-sept étiquettes de la bande de `fileIcon.swf` (sprite #81) et leurs
dessins ont été comparés au pixel : le portage du BUREAU est exact — les SVG
sortis sont identiques aux bitmaps du SWF, y compris les deux doublons
d'époque (`kaluga` = `kalugaPreview` = forme #22, `swapou2` = `mele` = #35).

La feuille des disques du MOBILE, elle, servait deux images inventées :
Frutisnake et JamaJama. Les commentaires disaient qu'aucune jaquette n'existait
pour ces deux jeux ; `snake` (image 1 — le serpent vert lové autour d'une
pomme) et `jama` (image 12) étaient dans le SWF depuis le début. Rétablies, et
les montages retirés. Les trois disques Flash (Burning Kiwi, Kaluga,
Motion-Ball 2) composent désormais l'ANNEAU et la jaquette comme
`but.icon.Full`, au lieu de la jaquette seule dont le trou laissait voir la
feuille — Motion-Ball 2 prend l'anneau BLANC, son `discType` au catalogue.

## Le disque qui file

`rotateDisc` (0x990e0) accélère jusqu'à 140, puis, `sens > 0 && speed > 140` :
le clip s'arrête et la JAQUETTE joue sa propre animation de rotation. Le
portage mettait bien `sens` à zéro… et n'avait rien derrière : `battre()` ne
redemande une image que si le tiroir bouge ou si `sens` n'est pas nul, la
boucle s'arrêtait net, et le disque restait FIGÉ pendant toute la partie. Il
file maintenant pour de bon, à la vitesse d'arrivée, et l'éjection le remet à
plat. `test/frusionDisqueTourne.test.js` exécute les trois méthodes livrées sur
un lecteur en carton, et rejoue l'ANCIENNE `battre` pour montrer d'où venait le
figeage.
