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
0 normal [0,0]   1 fâché [1,2]   2 triste [2,1]   3 sourire [0,3]
4 rire   [3,4]   5 gêné  [1,4]   6 moqueur [2,3]  7 totoché [2,6]
```

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

## 9. Ce qui reste à faire

* **Brancher** : remplacer Ruffle là où une bouille s'affiche — le forum,
  le Bouilloscope, la barre de contacts, la fiche, l'éditeur « Ma Frutibouille ».
  Rien n'est branché pour l'instant : le moteur ne sert qu'au banc d'essai.
* **L'éditeur de conception** : `updateInfo()` donne déjà la liste des onze
  réglages et leurs bornes (`_totalframes - 1` du clip visé) ; le banc s'en sert.
  Reste à l'habiller aux couleurs du parc et à le poser sur `/light`.
* **Le cache PNG** (`/bouille-img`, `scripts/warm-bouilles.js`) devient inutile
  dès que le moteur JS rend directement : à retirer le moment venu.
* **Les deux `DefineMorphShape`** de la famille 0 ne sont pas atteints par le
  visage ; s'ils le devenaient, il faudrait interpoler comme
  `scripts/lib/swf-morph.js` sait le faire.
