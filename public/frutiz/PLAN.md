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

### LES FEUTRES, au pixel

Un feutre, c'est un capuchon gris, un corps de couleur et une pointe blanche —
**5 px de large, 31 de haut, au pas de 12**. En coupe verticale :
`#E1E1E1` sur 3, `#C4C4C4` sur 1, `#6F6F6F` sur 1, le corps sur 22, `#6F6F6F`
sur 1, blanc sur 2, `#E1E1E1` sur 1.

Le corps est peint sur CINQ colonnes, et le SWF les tire de la couleur
nominale par une transformation ADDITIVE — vérifié sur deux feutres de teintes
très différentes, les écarts sont identiques :

    colonne 1 = base − 59    colonne 2 = base (la couleur nominale)
    colonne 3 = base − 30    colonne 4 = base − 95    colonne 5 = base − 131

chaque canal borné à 0. (`cp.PenList.display`, 0x8212c, attache un `penGFX`
par feutre et le teinte ; les feutres qu'on ne POSSÈDE pas sont grisés à
`#DDDDDD`, 0x821b1.)

Les dix-sept couleurs, relevées sur la colonne 2 de chaque feutre :

    0 #FF6600   1 #6666CC   2 #5EA523   3 #962761   4 #F986E2   5 #EBB601
    6 #20D251   7 #47B9C9   8 #472899   9 #A0752E  10 #66451E  11 #729236
   12 #408877  13 #5B944B  14 #264859  15 #C8400D  16 #6E3C8D

Le light en avait des approximations « ISO » assez loin du compte —
l'orange était `#E8732A` là où le SWF met `#FF6600`. Elles sont corrigées.

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
- **Le bouton des bouilles devient un vrai bascule de panneau** sur le
  bureau. Le light s'en servait pour une préférence (afficher ou non la
  bouille de qui vient de parler, en surimpression du fil) ; d'époque il
  ouvre un panneau qui reste. Le clic est donc intercepté avant d'atteindre
  le bouton et ouvre le panneau — le mobile garde sa préférence.
  Reste un écart : le SWF y met la bouille de CHAQUE membre du salon, le
  light celle de qui vient de parler. Il n'en sait rendre qu'une.

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
   `#A2EB56`/`#73B01E`) ; ~~la frutimandala~~ FAITE (roue des frutisignes
   comprise). Restent les 3 `butPushVerySmallPink` (halfHide/fullScreen,
   initSideIconList 0x6b786) ; le MEUBLE du lecteur frusion est posé (clip
   #324 extrait) mais sa mécanique reste (FDDrive 0x6d884 : trappe, disque,
   éjection), tout comme les boutons de la mandala (rotation, plantation).
3. ~~Les icônes du bureau, leur pose et leur glisser-déposer~~ FAIT.
4. Le mode « tab » des fenêtres (les onglets qui suivent « Bureau »), le
   menu déroulant de l'onglet, les préférences (`win_flMoveAnim`).
5. ~~Le dépliement du panneau des contacts~~ FAIT (bande 9 → 129, tout le
   bureau décalé de +120, liste à 18 px la ligne, dossiers repliables,
   `butSearch` extrait). Reste, quand le light saura les gérer : AJOUTER ou
   retirer un contact, et le glisser-déposer d'un contact d'un dossier à
   l'autre (`SideList.onDrop` 0xa15a3).
