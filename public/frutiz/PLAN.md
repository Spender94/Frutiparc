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
au bureau. `moveToCenter` (0x55bf5) centre dans
`[cornerX..mcw] × [cornerY..mch]`.

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
  images en BITMAP 17×17 (#88, #90, #92, #94, #96, #98, #100) dans CET
  ordre : le neutre, la colère, la tristesse, le sourire, le rire à pleines
  dents, le rictus, le rire aux éclats — `setEmote(0..6)`. Le tiroir mobile
  les range autrement : le bureau ne réordonne que l'AFFICHAGE (propriété
  `order`), jamais le DOM partagé.
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
  texte. Le bouton ouvre la fenêtre `search`.
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
