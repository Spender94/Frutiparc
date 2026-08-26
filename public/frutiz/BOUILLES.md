# Les frutibouilles, en JavaScript

Relevé de rétro-ingénierie et notes de portage. La source est `public/fbouille/famille<N>.swf`
— les fichiers d'époque —, plus `public/loader_bouille.swf` pour les tables `_global`
(`generalPalette`, `colorSet`, `penList`) et la classe `FEMC`.

Le moteur vit dans trois fichiers, chargés à la demande :

| fichier | rôle | poids |
|---|---|---|
| `public/js/bouille-swf.js` | lecteur de SWF réduit (formes, pellicules, étiquettes) | 19 Ko |
| `public/js/bouille-avm.js` | interpréteur AVM1 des scripts d'image (26 opcodes) | 13 Ko |
| `public/js/bouille-moteur.js` | liste d'affichage, teintes, humeurs, animations, dessin | 36 Ko |

**19 Ko gzippés au total**, contre ~4,9 Mo pour le WebAssembly de Ruffle plus son
enveloppe JavaScript. Le SWF de famille, lui, est téléchargé dans les deux cas.

Banc d'essai : **`/bouille-js.html`** — le moteur JS à gauche, Ruffle à droite,
même état, même humeur, même animation, avec les onze curseurs de conception.
Et des **planches** de relevé, rendues par le seul moteur JS depuis un unique
chargement de famille :

| adresse | ce qu'elle contacte |
|---|---|
| `?planche=humeurs` | les huit humeurs d'`emoteList` |
| `?planche=acc&n=17` | tous les accessoires de la coiffure de l'état |
| `?planche=acc2&n=12` | les variantes d'accessoire secondaire |
| `?planche=cheveux` | toutes les coiffures de la famille |
| `?planche=anim&a=N&pas=3&n=16` | une animation, image par image |

Le mode planche est **déterministe** — le tirage au sort du moteur est calé
(`&alea=`), et l'on avance d'un nombre d'images choisi plutôt que de
photographier une boucle vivante. C'est ce qui rend les relevés reproductibles.

---

## 1. La chaîne d'état

Vingt-quatre caractères, douze paires en **base 62** (`0-9` = 0-9, `a-z` = 10-35,
`A-Z` = 36-61 — c'est `String.prototype.decode62`, définie dans le script racine
de chaque famille et recopiée dans `bouille-moteur.js`).

| position | champ | ce qu'il pilote |
|---|---|---|
| 0-1 | famille | quel `famille<N>.swf` charger |
| 2-3 | yeux | `face.oa` et `face.ob`, image `id + 1` |
| 4-5 | iris | `face.oa.o.p` et `face.ob.o.p` |
| 6-7 | cheveux | `face.ca` et `face.cb` |
| 8-9 | bouche | `face.b` |
| 10-11 | couleur1 | teinte de la peau, de la bouche et du reflet des cheveux |
| 12-13 | couleur2 | teinte des cheveux |
| 14-15 | accessoire | `face.ca.c` et `face.cb.c` |
| 16-17 | accessoire2 | `…c.acc` et `…c.acc2` |
| 18-19 | acc. couleur1 | `acc.col` |
| 20-21 | acc. couleur2 | `acc.col2` |
| 22-23 | acc. couleur3 | `acc.col3` |

Attention : une paire n'est pas un nombre décimal. `« 10 »` vaut **62**, pas dix ;
`« 0a »` vaut 10.

## 2. L'arbre du visage

Le clip `face` est posé par la racine du SWF (image 2 pour huit familles, image 1
pour les familles 10 et 11 qui n'ont qu'une image). La scène fait **100 × 100
pixels**, à **40 images par seconde**, pour toutes les familles.

```
face                                  169 images (famille 0) — les animations
 ├ cb ....... profondeur  1 ......... cheveux ARRIÈRE, image = cheveux + 1
 │   └ c ..................... accessoire, image = accessoire + 1
 │       ├ col ..... teinte couleur2      ├ acc ... image = accessoire2 + 1
 │       └ col3 .... teinte couleur1      └ acc2 .. (voir le bogue, §5)
 ├ pb.col ... profondeur  4 ......... peau arrière, teinte couleur1
 ├ pa.col ... profondeur  6 ......... peau avant,   teinte couleur1
 ├ b ........ profondeur  8 ......... bouche, image = bouche + 1
 │   └ b .................... l'animation de bouche, image = humeurBouche + 1
 │       └ col.col ......... teinte couleur1
 ├ oa ....... profondeur 12 ......... œil gauche, image = yeux + 1
 │   └ o .................... l'animation d'œil, image = humeurŒil + 1
 │       └ p ............... iris, image = iris + 1
 ├ ob ....... profondeur 14 ......... œil droit — LE MÊME sprite que oa
 └ ca ....... profondeur 16 ......... cheveux AVANT, même structure que cb
```

Le nombre de choix dépend de la famille — et, pour les accessoires, de la
**coiffure** : chaque coiffure porte son propre rouleau `c`, dessiné pour elle.
C'est ce que dit `updateInfo()` du script racine : le maximum de l'accessoire est
`face.ca.c._totalframes - 1`. La famille 0 compte 67 coiffures, 9 paires d'yeux,
5 bouches et 17 accessoires (les seize de `bouille-palette.js` plus « Rien ») ;
les autres familles sont bien plus courtes, jusqu'à la famille 11 qui n'a
qu'un visage sans coiffure ni bouche.

Un rouleau d'accessoires a souvent une longue queue d'images vides — celui de la
coiffure 0 de la famille 0 déclare 178 images pour 17 utiles. C'est un reliquat
d'atelier, sans effet : `gotoAndStop` n'y trouve rien à poser.

## 3. La teinte : un DÉCALAGE, pas un aplat

C'est le point qu'il ne faut pas manquer. `FEMC.setColor(mc, {r,g,b})`
(`frutiengine/FEMC.as`, lu dans `loader_bouille.swf`) pose la transformation de
couleur

```
ra = ga = ba = 100 %          rb = r - 255,  gb = g - 255,  bb = b - 255
```

soit, canal par canal, **sortie = source + (couleur − 255)**, bornée à [0, 255].
Le dessin teinté est donc peint en gris clairs : le blanc pur rend exactement la
couleur de la palette, et les gris plus sombres en donnent les ombres. C'est ce
décalage — et non un remplissage uni — qui donne son modelé à une bouille.

Vérifié au pixel sur le rendu Flash de la famille 0, source grise 238 :

| couleur1 | `generalPalette[c]` | attendu `238 + c − 255` | relevé Ruffle |
|---|---|---|---|
| 7 | (160, 100, 45) | (143, 83, 28) | (143, 83, 28) |
| 15 | (150, 215, 55) | (133, 198, 38) | (133, 198, 38) |
| 2 | (251, 200, 190) | (234, 183, 173) | (234, 183, 173) |

Le moteur applique donc le décalage **à la couleur d'origine de chaque tracé**,
au moment du dessin : exact, sans filtre, et sans perdre le vectoriel.

La palette est `_global.generalPalette` du loader — 53 couleurs, exactement
celles de `public/js/bouille-palette.js`, déjà partagée par l'éditeur du light,
l'admin et la vitrine de la boutique. Un test le vérifie entrée par entrée.

## 4. Humeurs et animations

`emoteList` — huit humeurs, chacune un couple `[image d'œil, image de bouche]`,
posé par `applyEmote(id)` puis `emote()` :

```
0 Neutre [0,0]   1 Colère [1,2]      2 Triste     [2,1]   3 Sourire [0,3]
4 Joie   [3,4]   5 Déterminé [1,4]   6 Embarrassé [2,3]   7 Totoché [2,6]
```

(Les noms viennent du parc, pas du SWF : voir §9.)

`actionList` — treize actions, appelées par `action(id)` puis `playAnim(id)` :

```
0 stop   1 parle   2 rire   3 mdr   4 langue   5 rougir   6 regard
7 siffle 8 gum     9 question  10 miam  11 pleure  12 larme
```

Les noms d'`actionList` ne sont pas tout à fait ceux des étiquettes de la
pellicule : `siffle` vise `sifflote`, `pleure` vise `pleurer`.

`action(id)` est **gardée** : elle retient toujours la suite dans `next`, mais ne
lance l'animation que si `flStop` est vrai. En cours d'animation, c'est le script
de la dernière image qui enchaîne, par `_parent.playAnim(_parent.next)`. Et
`playAnim` remet `next = 0` pour toutes les animations sauf `parle` — d'où le
retour au repos qu'on observe.

Les timings ne sont écrits nulle part ailleurs que dans les scripts d'image, et
chaque famille a les siens. D'où le choix de **jouer le bytecode** plutôt que de
recopier des compteurs : un recensement sur les dix familles ne relève que
vingt-six opcodes, et les idiomes tiennent en trois lignes —

```
compt-- ; if (compt > 0) gotoAndPlay(_currentframe - 1)     tenir l'image
compt-- ; if (compt > 0) gotoAndPlay("rire")                 rejouer
          else _parent.playAnim(_parent.next)                 ou rendre la main
bubble._width += size ; if (bubble._width > random(150) + 30) le chewing-gum
```

**Une bouille au repos n'est pas immobile.** `face` est arrêté, mais les clips
imbriqués — l'éclat de l'iris, le frémissement d'un accessoire — continuent de
tourner, exactement comme sous Flash (vérifié : deux captures Ruffle espacées de
700 ms diffèrent). Le moteur tourne donc par défaut ; `anime: false` sert aux
vignettes, où quarante-huit têtes qui scintillent ne valent pas le courant.

## 4 bis. Le fard de « rougir » : une forme INTERPOLÉE

Le piège du portage, trouvé en comparant image par image. « Rougir » ne colore
pas le visage avec un dessin ordinaire : il pose, à la **profondeur 10** du
visage, un **`DefineMorphShape`** — deux dessins et la promesse que le lecteur
sait passer de l'un à l'autre, le taux de mélange arrivant avec le placement
(champ `ratio` de PlaceObject2, de 0 à 65535).

Ici c'est un dégradé radial rouge dont l'opacité au centre monte, puis redescend :

| images du visage | caractère | opacité au centre |
|---|---|---|
| 51 → 57 | morph #1818 | 10 % → 50 % (taux 0, 9362, 18725, 28087, 37449, 46811, 56174) |
| 58 → 63 | morph #1819 | 50 % → 10 % (taux 0, 10923, 21845, 32768, 43691, 54613) |

Tant que le lecteur ignorait les morphs, la bouille rougissait… sans rougir :
l'écart avec Flash restait à 8,7 % sur toute l'animation, et aucune image du
moteur ne ressemblait à celle de Flash. Une fois les morphs lus et interpolés,
l'écart tombe à **0,14 %**.

Toutes les familles sauf la 11 et la 13 en portent deux — c'est toujours le fard.
Un contrôle de couverture, dans les tests, vérifie qu'aucun caractère POSÉ
quelque part n'échappe au lecteur : c'est ce contrôle qui aurait attrapé le fard
du premier coup. Il ne reste qu'une exception connue, `#63` de la famille 0, un
`DefineText` — une inscription sur un seul accessoire, hors périmètre.

## 5. Un bogue d'époque, conservé

`apply()` cale `ca.c.acc`, `ca.c.acc2` et `cb.c.acc` sur l'accessoire secondaire —
et **oublie `cb.c.acc2`**. Le second accessoire de l'arrière-plan reste donc sur
sa première image. On ne corrige pas : c'est le rendu d'époque, et un test veille
à ce que personne ne « répare » la ligne manquante.

## 6. Un défaut du chemin Flash actuel (familles 10 et 11)

`scripts/patch-famille.js` greffe dans chaque `famille<N>.swf` le nécessaire pour
que Ruffle puisse jouer une bouille tout seul (les tables `_global`, la classe
`FEMC`, et un appel à `apply(_root.s)`). La greffe se pose avant le DERNIER
`ShowFrame`, et neutralise le `stop()` de l'image 1 **seulement si le SWF a au
moins deux images**.

Or `famille10.swf` et `famille11.swf` n'ont qu'**une seule image**. Résultat,
mesuré sur `/bouille-js.html` : pour la famille 10, la peau reste au gris 238 du
dessin quelle que soit `couleur1` (7, 1 ou 15 donnent le même pixel), alors que
le moteur JS rend bien (143,83,28), (235,203,199) et (133,198,38). C'est le
chemin Ruffle qui n'applique rien là, pas le moteur : à l'époque, `apply()` et la
palette venaient de `main.swf` et fonctionnaient pour toutes les familles.

À corriger dans `patch-famille.js` (traiter le cas à une image) si l'on veut
garder les deux rendus comparables — ou à laisser tomber le jour où le moteur JS
remplace Ruffle partout.

## 7. Écart mesuré avec Flash

Banc `/bouille-js.html`, captures des deux moitiés, comparaison pixel à pixel
(seuil 40 sur la somme des trois canaux) :

| famille | écart |
|---|---|
| 0 | 0,10 % |
| 11 | 0,06 % |
| 12 | 0,56 % |
| 13 | 0,20 % |
| 14 | 0,11 % |
| 15 | 0,11 % |
| 16 | 0,03 % |
| 23 | 0,22 % |
| 24 | 0,11 % |
| 10 | (voir §6 — la référence Flash est fautive) |

Le reliquat est de l'anticrénelage de bord, plus le déphasage des clips qui
tournent : les deux lecteurs ne sont pas au même instant de l'éclat d'iris.

### Les huit humeurs

Planche `?planche=humeurs`, coiffure 6 de la famille 0, tuile par tuile :

| humeur | écart | | humeur | écart |
|---|---|---|---|---|
| 0 Neutre | 0,53 % | | 4 Joie | 1,27 % |
| 1 Colère | 1,71 % | | 5 Déterminé | 1,79 % |
| 2 Triste | 0,87 % | | 6 Embarrassé | 1,12 % |
| 3 Sourire | 1,12 % | | 7 Totoché | 0,62 % |

Les formes sont **identiques** — sourcils, paupières, dents : l'écart est
entièrement de l'anticrénelage sur les contours noirs, plus marqué là où
l'humeur ouvre l'œil ou découvre les dents.

### Les accessoires

Planche `?planche=acc`, coiffure 4 (la seule sorte qui porte un `col` sur les
deux couches de cheveux) : les **dix-sept types**, de « Rien » à « Carapace »,
tiennent entre **0,40 % et 1,36 %**, moyenne 0,71 %. Les **variantes
secondaires** (`?planche=acc2`, les motifs posés sur l'accessoire) tiennent
entre 0,57 % et 0,65 %, moyenne 0,60 % — les trois couleurs d'accessoire
comprises.

### Les animations

Ici on ne peut pas caler les deux lecteurs : Ruffle lance l'animation quand il
finit de charger. On procède donc autrement — pour **chaque image photographiée
sous Flash**, on cherche la meilleure correspondance parmi les poses que le
moteur produit en avançant image par image. Si chaque pose Flash trouve une pose
JS quasi identique ET que les images retenues montent dans l'ordre, l'animation
est reproduite, gestes **et** tempo.

| animation | écart moyen | max | images JS retenues |
|---|---|---|---|
| 1 Parler | 0,89 % | 1,38 % | boucle 0-8 |
| 2 Rire | 0,98 % | 1,22 % | boucle 0-8 |
| 3 MDR | 1,50 % | 2,19 % | boucle 2-8 |
| 4 Langue | 1,43 % | 1,91 % | boucle 5-8 |
| 5 Rougir | 0,14 % | 0,15 % | tenue |
| 6 Regard | 0,10 % | 0,10 % | tenue |
| 7 Sifflote | 0,79 % | 1,00 % | **5 → 37, strictement croissante** |
| 8 Chewing-gum | 1,01 % | 2,59 % | **17 → 110, strictement croissante** |
| 9 Question | 0,44 % | 0,55 % | 4 → 25 puis relance |
| 10 Miam | 0,44 % | 0,49 % | boucle |
| 11 Pleurer | 1,12 % | 1,27 % | boucle |

Les deux longues — sifflote et le chewing-gum — sont les plus parlantes : les
images retenues montent **une par une**, sans jamais reculer. C'est la preuve
que le tempo est le bon, et pas seulement les poses ; les courtes bouclent, donc
plusieurs images se ressemblent et l'ordre y est moins probant.

Le tirage au sort compte : « parle » choisit sa bouche par `random(4)` et le
chewing-gum sa taille par `random(150) + 30`. Le relevé balaie donc les quatre
bouches possibles pour ces deux-là.

Chargement + premier rendu, mesuré dans le navigateur : **~320 ms** pour la
famille 0 (414 Ko de SWF, 1224 formes, 633 clips), **30 à 100 ms** pour les
autres.

## 8. Le rendu

Canevas 2D, à la densité de l'écran (`devicePixelRatio`), plutôt que du SVG : une
bouille compte quelques centaines de tracés, et un avatar de salon n'a pas à
peser trois cents nœuds de DOM. Les tracés sont mis en cache en `Path2D`, les
masques (`ClipDepth`) deviennent des `ctx.clip()`, les dégradés sont posés dans
leur repère d'origine (le carré de 32768 twips), et les transformations de
couleur du fichier se composent avec la teinte.

## 9. Les noms

Le SWF ne nomme pas ses humeurs : `emoteList` n'est qu'un tableau de couples. Le
parc, lui, les affiche déjà — sous les noms du forum (`EXPRESSIONS`,
`public/fb/index.html`) et de la page de démonstration. Le moteur exporte donc
ces mêmes noms (`NOMS_HUMEURS`, `NOMS_ANIMATIONS`) plutôt que d'en inventer.

Deux pièges de nommage :

* `actionList` appelle **« siffle »** et **« pleure »** ce que la pellicule
  étiquette **« sifflote »** et **« pleurer »** ; `playAnim()` vise les
  étiquettes (`ETIQUETTES` fait le pont) ;
* `bouille-preview.html` attend l'**index** de `playAnim` dans son paramètre
  `anim`, pas une étiquette — le banc d'essai s'y est fait prendre.

## 10. Ce qui reste à faire

* **Brancher** : remplacer Ruffle là où une bouille s'affiche — le forum,
  le Bouilloscope, la barre de contacts, la fiche, l'éditeur « Ma Frutibouille ».
  Rien n'est branché pour l'instant : le moteur ne sert qu'au banc d'essai.
* **L'éditeur de conception** : `updateInfo()` donne déjà la liste des onze
  réglages et leurs bornes (`_totalframes - 1` du clip visé) ; le banc s'en sert.
  Reste à l'habiller aux couleurs du parc et à le poser sur `/light`.
* **Le cache PNG** (`/bouille-img`, `scripts/warm-bouilles.js`) devient inutile
  dès que le moteur JS rend directement : à retirer le moment venu.
* **Le `DefineText` #63** de la famille 0 — une inscription sur un seul
  accessoire. Le fichier porte la police qu'il faut (`DefineFont2` #62, avec ses
  tracés de glyphes) : c'est une centaine de lignes le jour où l'on voudra la
  dernière miette.
