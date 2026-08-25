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

## Le colorSet par type de fenêtre (mesuré au pixel, session connectée)

Le générateur de teintes de `getWinStyle` n'a pas encore été localisé dans le
bytecode — en attendant, chaque teinte est RELEVÉE sur le rendu Ruffle d'une
vraie fenêtre (session locale connectée, cf. « La connexion locale » plus
bas). Trois relevés faits :

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
- **L'intérieur au gabarit** (relevé 1:1) : la barre fait 76 de haut, marge
  6 — il reste **64 px de contenu** et tout y tient. Bouille **64×64** à
  x 15..79 (= cornerX 9 + margin 6), y 6..70 ; encart `digital` x 85..228
  (cpDigital, min 130×45, étiré par le frame de type `w`), y 6..51 ; la
  rangée des 7 smileys dessous, **pas de 21 px** (mesuré 88, 109, 130, 151,
  172, 193, 214 — soit struct 19 + margin 2, exactement l'initFrameSet).
  Cadre de la bouille : `#DDDDDD` en 13..15 puis `#888888` en 15.
- **Le détail de l'encart**, relevé point par point :
  • ARRONDI 2 px seulement (le fond atteint son bord dès 1 à 2 px du haut) ;
  • les 9 barres laissent UN pixel de fond après le liseré (liseré 84, fond
    85, barre 86..113) ;
  • « NIV n » fait **8 px d'encre** (x 87..108) et son CHIFFRE n'est pas un
    afficheur à segments mais un glyphe plein — la Verdana pixel embarquée
    (`verdana_10pt_st`, police #602), déjà extraite pour les jeux ;
  • les RACCOURCIS tiennent haut (bloc y 26..47) et dans CET ordre :
    l'aide, le forum, le courrier, l'historique, les événements, les jeux ;
  • la COUPE, le rang et le trait de séparation commencent à x 110 (contre
    123 au tiroir) : la colonne de droite est plus près des barres ;
  • l'encart porte, comme le cadre de la bouille, un LISERÉ INTERNE plus
    sombre qui fait son relief — `#97AD80` au bord gauche (x 84), `#A2AF94`
    en haut (y 7), juste à l'intérieur des 2 px de `#DDDDDD` ;
  • le REFLET est une tache douce au coin haut-droit, centrée vers (222, 11)
    sur ~15×8 — l'image est bien celle du SWF (forme #409, blanc à 50 %),
    mais le rendu Flash y monte jusqu'au blanc PUR : il y a probablement
    deux couches superposées à l'origine, à revoir à l'extraction.
- **Les ÉMOTIONS** (`initEmoteIconList` 0x6b6a4) : le gris autour d'une
  émotion n'est PAS une plaque carrée — la carte de gris relevée sur le rendu
  (x 82..111, y 49..74) dessine un **halo CIRCULAIRE** qui épouse le disque
  et s'éteint vers le blanc en 3 à 4 px ; au-dessus et au-dessous des disques
  le fond reste BLANC. C'est une lueur portée par la forme ronde de l'icône
  (profil mesuré à mi-hauteur : blanc, puis deux pixels à ~221, puis le bord
  du disque à 87). L'art est la bande #102, sept
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

## Reste à faire (étapes suivantes)

1. La barre-titre des types de fenêtres (winChat #5, winPanel #7,
   winRoomList #59…) et les teintes `getWinStyle` manquantes — mesurer au
   pixel les fenêtres jaune/verte/blanche/violette (Préférences, Corbeille,
   Boutique, Mes contacts…) sur la session connectée.
2. ~~L'INTÉRIEUR de la main bar au gabarit~~ FAIT (bouille 64, encart 45,
   smileys de 15 au pas de 21, barres de progression 2 px/1 px aux teintes
   `#A2EB56`/`#73B01E`) ; ~~la frutimandala~~ FAITE (roue des frutisignes
   comprise). Restent les 3 `butPushVerySmallPink` (halfHide/fullScreen,
   initSideIconList 0x6b786) ; le MEUBLE du lecteur frusion est posé (clip
   #324 extrait) mais sa mécanique reste (FDDrive 0x6d884 : trappe, disque,
   éjection), tout comme les boutons de la mandala (rotation, plantation).
3. Les icônes du bureau (fileIconStandard #11) et leur pose en colonnes
   (FPDesktop), le glisser-déposer des icônes.
4. Le mode « tab » des fenêtres (les onglets qui suivent « Bureau »), le
   menu déroulant de l'onglet, les préférences (`win_flMoveAnim`).
5. Le DÉPLIEMENT du panneau des contacts (toggle/activate : la bande passe
   de 9 à 129, `attachList`, la barre de recherche `butSearch`, le
   défilement) — le décor est fait, la liste reste à porter.
