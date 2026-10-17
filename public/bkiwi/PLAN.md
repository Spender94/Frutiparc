# Burning Kiwi — portage natif JS

Objectif : reproduire **Burning Kiwi** (Flash AS2, scène 350×350 à 40 images
par seconde, Motion-Twin 2004, build 1422 du 12 juillet 2004) en JS natif,
**sans rien changer au jeu** — mêmes dessins, mêmes fontes, mêmes musiques et
sons, mêmes animations de clips, mêmes circuits, même physique des voitures,
même timer de secours, mêmes règles de vitesse —, pour le jouer dans `/light`
(onglet Burning Kiwi) et sur le bureau (fenêtre « Burning Kiwi », disque
`bkiwilight`). Le SWF d'origine reste au catalogue (`bkiwi1`) et se joue
toujours sous Ruffle.

Sources de fidélité :

- **tout le source AS2 du jeu** est dans `Games/burningKiwi/inc/` (code.as,
  mainGame.as, IA.as, gameMovies.as, sounds.as, preload.as, main.as, menu.as,
  mainFinal.as, gameData.as) : le portage en est une **traduction fonction
  par fonction** (`jeu/moteur.js`, `jeu/menu.js`, `jeu/final.js`), les
  variables de la timeline du clip principal devenant `M.<nom>` ;
- `Games/burningKiwi/burningkiwi.swf` est le disque joué (non obfusqué, les
  noms d'auteur sont dans le fichier) : ses scripts d'image et de bouton ont
  été **désassemblés** (`scripts/disasm-as2.js --sprites`) et transcrits à
  la main dans `jeu/scripts-images.js` ; le clip principal (sprite 637)
  tient tout le code à son image 1, `main()` à l'image 2, le retour à la 3 ;
- les bibliothèques compilées sans source : `timer.as` (`_global.gtmod`,
  la moyenne glissante 0,97 / 0,03 de `delta / 32`), `depth.as` (initDepth,
  calcDepth, unlockDepth), `sounds.as` (playSound, fadeSound, forceSoundMC),
  `keyNames` (les noms de touches en français) → `jeu/biblio.js` ;
- `gameData.as` est **évalué tel quel** par `scripts/gen-bkiwi-donnees.js`
  pour produire `jeu/donnees.js` — les cinq voitures (carStats), les
  constantes de la physique (roadFriction 0,99, stepMax 9, borderMaxSpeed 3,
  nitroMaxSpeed 18, baseNitroTimer 60…), les six circuits et le tutorial,
  leurs 218 checkpoints ; le seul écart de la source au fichier compilé
  (`demoLabel`) est celui du fichier ;
- les circuits `track00..05.swf` et `track99.swf` (le square du tutorial),
  l'intro `intro.swf` : extraits en bibliothèques à part
  (`data/track0N.json`, `data/intro.json`) qui prennent la place d'un clip
  vide comme `loadClip` le faisait (`startPreload`) ;
- les musiques `bk00..05.mp3`, `bkMenu.mp3` se lisent là où le disque Flash
  les prenait : `/swf/games/burningKiwi/`.

## Le jeu (résumé du source)

Une course vue de dessus, la caméra suit la voiture du joueur (`scrolling`).
La physique (`manageGame`) : une vitesse `speed` poussée par
`gtmod × ((currentMaxSpeed − speed) / (currentMaxSpeed + 15)) × statAccel ×
accelBoost`, freinée par `roadFriction^gtmod`, une vitesse « d'inertie »
`speedA` qui suit `speed` à 0,9^gtmod, un angle d'accélération `accelAng`
qui rattrape la rotation, et un **stepping** par pas de `stepMax` pixels où
chaque pas est testé contre `borderZone` (la terre : pas ramenés à
borderMaxSpeed / borderMaxAccelSpeed) et `outZone` (le vide : vitesse à 1,
demi-tour forcé). La rotation perd de son efficacité avec la vitesse
(rotationVitesseRapide / Lente), la nitro (les kiwis) porte currentMaxSpeed à
18 pendant baseNitroTimer, le super départ (accélérateur tenu pendant le
décompte, `fakeSpeed` proche de `optimalStartSpeed`) donne une nitro
proportionnelle. Les IA (`moveIA`) suivent les checkpoints, avec leurs
propres stats (carStatsIA × facteur du circuit) et une part de hasard
(`randomT`). Les collisions entre voitures (`testHitCar`) échangent les
vitesses. Le chrono est `getTimer() − timerLap`.

Modes : Challenge (ARCADE, la course du jour, classée), essais (TRAINING),
tutorial, évolution (FRUTICUP, SURVIVOR, GHOSTRUN), épreuves (TIMETRIAL,
DUEL, KIWIRUN). La fruticard (slot 0) garde les coupes ($ws, $wss, $wc, $wcs),
les écuries ($ac) et les records par circuit ($ts) ; le slot 1 les
préférences, le slot 2 les modes débloqués.

## Le lecteur

Le lecteur de liste d'affichage de Kaluga (`/kaluga/moteur/`) : formes
vectorielles, morphs, images, fontes embarquées, champs de texte (HTML
compris — le résumé de la FrutiCoupe), boutons, masques (`setMask` : le
décompte 3-2-1-GO découpe le circuit à la forme des chiffres), hitTest par
forme (les zones des circuits), horloge virtuelle à 40 images par seconde
(`getTimer()`), scripts d'image dans l'ordre du lecteur.

## Le mode fantôme (Ghost-Run), rendu jouable

Le mode est compilé dans le SWF — enregistrement d'une position toutes les
deux images, relecture interpolée, voiture translucide à vingt pour cent —
mais son bouton de menu est resté EN COMMENTAIRE (`inc/menu.as`, après
« elite ») et `unlockMode` n'a jamais été appelé pour lui : personne n'y a
jamais joué. Le portage repose le bouton au mot et au pixel près (identifiant
65, place −23 ; 240, « Rivalisez avec votre pire adversaire: vous ! ») et
ouvre le mode comme le contre-la-montre.

Deux choses que le fichier ne faisait pas :

- **la trace survit à la page.** Elle part au serveur, une par joueur et par
  circuit, celle du meilleur temps (`/api/bkiwi/ghost`, table `bkiwi_ghosts`).
  Le codec (`jeu/fantome.js`) écrit cinq octets par point — position au pixel,
  rotation absolue sur un octet, donc sans le saut de +179 à −179 — en base64
  d'URL sans remplissage : une course entière tient dans dix kilo-octets et
  traverse un formulaire sans qu'un caractère soit ré-encodé. Elle ne voyage
  qu'à l'entrée en Ghost-Run, jamais avec la fruticard ;
- **le fantôme tient toute la course.** D'origine, la fin de chaque tour
  comparait le temps CUMULÉ à celui d'une COURSE ENTIÈRE
  (`if ( ghost.raceTime < previousGhost.raceTime || previousGhost == undefined )`) :
  au premier tour le cumul d'un tour gagne toujours, et le fantôme affronté
  était remplacé par l'enregistrement en cours — le lecteur relisait alors le
  tableau qu'il écrivait, et la voiture fantôme collait à la nôtre. Le bouton
  n'ayant jamais été posé, ce défaut n'a jamais été vu par un joueur ; le
  remplacement se décide donc à l'arrivée, sur les temps complets.

Le fantôme court avec l'écurie qui a fait le temps, pas avec celle qu'on a
choisie aujourd'hui. Une course abandonnée ou trichée n'en laisse pas.

## Le pont Frutiparc (`plateforme.js`)

`J.Client` tient lieu de `bkiwi.KiwiClient` : les mêmes drapeaux que le jeu
sonde d'image en image (fl_success, fl_localScore, connected, error,
reseting, forcePause, gameRunning), `dailyData = '<daily trk="N"/>'` demandé
à `/api/bkiwi/daily` (le même calcul que le classement), les slots sur
`/api/loadFrutiSlots` / `/api/saveFrutiSlot` (Infinity ↔ 9999999, comme le
SWF rustiné), le claim de Fruit Défendu sur `/do/fdclaim` (mode = vs.gameMode,
seul ARCADE consomme), le score sur `/api/saveScore` avec le circuit en clair
(`track`) et le mode (`gm` : seul le Challenge alimente la cuve du jour).

La session est **blanche** (tous les modes ouverts, la fruticard tenue) ;
c'est le quota de FD qui décide si le premier bouton dit « challenge » ou
« essais » (`checkMode`, `Client.isRanked`).

## La cadence et les touches (`jeu/cadence.js`)

Le lecteur avance la physique à pas fixes de 25 ms sur une horloge virtuelle
(`Scene.demarrer`, flash.js) : `getTimer()` — donc le chrono, `getTimer() −
timerLap`, et le gtmod du timer de secours — ne connaît que les pas, et une
image qui tarde est rattrapée par autant de pas (jusqu'à 500 ms). Mesuré au
pilote automatique jouant dans le pas : 21,850 s au tour sur Green Hill, que
les images durent 16,7 ms, 33 ms (processeur ralenti quatre fois) ou 150 ms
(fil occupé 90 ms toutes les 200 ms, six pas par image).

Mais le joueur pilote au temps, et chaque pas lisait le clavier à l'instant de
son exécution : six pas joués en rafale lisaient tous le clavier tel qu'il est
à la fin de la rafale — une flèche lâchée au milieu des 150 ms l'était pour
les six pas. Le chrono était juste, la course n'était plus la même. Chaque
frappe est donc **datée** (`ev.timeStamp`, l'heure de la touche) et appliquée
devant le pas dont c'est l'instant (`tPrecedent − accumule`, l'heure à
laquelle ce pas aurait dû tomber) : la règle du Flash Player d'époque, dont le
minuteur exécutait l'image k à 25·k ms. La physique ne dépend plus que de la
suite des frappes et de leurs dates : le même rejeu de touches donne la même
course, au millième de pixel, à 25 ms réguliers, à 16,7 / 33,3 ms et à
10 / 40 / 70 ms (`test/bkiwiCadence.test.js`), là où l'ancienne lecture ne
bouclait même plus le tour sous les rafales. Le pilote de test et les bancs
qui jouent *dans* le pas posent l'état du clavier directement
(`K.Key.$cadence.presser0`).

## Vérification contre Ruffle

Le SWF sous Ruffle (game-popup.html) et le portage, pilotés au clavier avec
les mêmes entrées et les mêmes délais (Playwright) : accélérateur tenu
pendant tout le décompte puis en course, la voiture du joueur est au même
pixel près à 0,93 s de course (y 1308 sous Ruffle contre 1315), même super
départ, même sortie de piste au même endroit, même demi-tour forcé dans le
vide, mêmes voitures IA ; un virage à gauche d'une seconde au même instant
amène les deux voitures contre la même bordure, à la même hauteur. Seule
différence : le préchargement du circuit prend 0,3 s au portage (les
bibliothèques se reconstruisent), et rien au SWF en cache — hors course.

## Le mode en ligne (MULTI) et la X Violet

Un mode qui n'existait pas dans le fichier : des courses à deux, trois ou
quatre pilotes du parc, sur n'importe lequel des six circuits, bouton
« en ligne » des modes de jeu. Rien n'y est classé : c'est pour s'amuser.

**Pourquoi ça ne lague pas.** Le Battle de Frutisnake fait jouer la partie
par le serveur, parce que deux serpents qui se touchent, c'est la fin de l'un
des deux. Une course n'a rien à trancher : chacun pilote *sa* voiture, avec
la physique du jeu, au pas, exactement comme en solo — la touche agit à
l'image même où on l'enfonce, le réseau n'est jamais entre le doigt et le
virage. Vingt fois par seconde, la voiture dit où elle est (`multi.js`,
`tickCourse` : x, y, cap, vitesse, nitro, tour, balise), et le serveur
(`server/net.js`, balise `<kw>` — « bk » était déjà un code du protocole
d'époque) le relaie aux autres pilotes du salon, sans le lire. Les voitures
des autres se dessinent entre deux positions reçues, un dixième de seconde en
arrière du présent (`avancerDistants`) : ce retard absorbe la gigue du
réseau ; quand une position tarde, la voiture est prolongée sur son cap à sa
vitesse, puis s'arrête plutôt que d'inventer. Les voitures ne se cognent pas
(elles se traversent, comme un fantôme) : une collision à cent millisecondes
de distance ne serait la même pour personne.

**Le départ et l'arrivée.** L'hôte lance quand les autres sont prêts ; chacun
charge le circuit et le dit ; le serveur donne alors l'heure du GO, la même
pour tous (traduite en heure locale par l'écart d'horloge relevé au ping,
`reseau.js`, `heureLocale`). Le décompte 3-2-1 attend ce GO, le voyant réseau
tournant en attendant. Le chrono de chacun est le sien ; à l'arrivée il part
au serveur, qui classe **au temps** (deux pilotes partis au même instant : le
meilleur chrono est devant, qu'il ait ou non le réseau le plus court). Quand
tous sont arrivés — ou ont renoncé (échap), ou quatre-vingt-dix secondes après
le premier — le résultat tombe, et le salon est prêt pour la revanche. Pas de
pause en ligne : les autres ne s'arrêtent pas avec vous.

**La X Violet.** La voiture du mode, et de lui seul (sixième bouton du choix
des voitures, pour tout le monde) : la meilleure valeur de chaque colonne de
`carStats` parmi les cinq écuries (rotation 9, accélération 1,8, frein 0,93,
maniabilité 0,992, vitesse 16,2, adhérence 0,7), sept nitros — le plafond du
jeu —, et la carrosserie de la Final KiwiX (habillage 25) teinte en violet
(`Color.setTransform`). Dans le menu, c'est la KiwiX teinte qui la figure.

Le salon (hub des courses ouvertes, pilotes au stand, circuit, voitures,
prêt, lancer) est un panneau HTML posé sur la scène (`index.html`,
`#bk-multi`) : des listes et des boutons, ce que le canevas fait mal. Le fil
est celui du Battle de Frutisnake (`/snake3/reseau.js`, options `balise` et
`salon`), qui mesure l'aller-retour et l'écart d'horloge.

Tests : `public/bkiwi/server/net.test.js` (le pont à blanc, horloge
injectée) et `test/bkiwiMulti.test.js` (deux pilotes sur la WebSocket du
parc, de bout en bout).

## Au doigt : la piste est la commande

Sur un écran tactile, pas de manette (une rangée de boutons sous la piste,
c'était six cibles minuscules à viser sans les regarder pendant que la
voiture file). On touche la piste **là où l'on veut aller** : à chaque pas
du jeu, le cap de la voiture est comparé à la direction du doigt (la caméra
suit la voiture, elle est au milieu de l'écran), et la touche gauche ou
droite est tenue jusqu'à ce qu'elle pointe dessus ; le doigt posé est
l'accélérateur, relevé la voiture roule sur son erre ; le doigt sur la
voiture (à moins de vingt pixels) freine ; un second doigt, ou un
double-tap, met la nitro ; une pastille en haut à gauche met en pause. Tout
passe par les touches du jeu (`K.Key`, datées par la cadence) : la physique
ne sait pas qu'on joue au doigt. Pendant le décompte, le doigt posé fait
monter la fausse vitesse du super départ. Une pastille de visée suit le
doigt (rouge sur la voiture : le frein), et le mode d'emploi s'affiche au
premier départ sur l'appareil (`localStorage`). À la souris, rien de tout
cela : on a le clavier. (`index.html`, « LA PISTE EST LA COMMANDE ».)
