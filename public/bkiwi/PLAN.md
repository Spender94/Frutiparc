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
tutorial, évolution (FRUTICUP, SURVIVOR), épreuves (TIMETRIAL, DUEL,
KIWIRUN). La fruticard (slot 0) garde les coupes ($ws, $wss, $wc, $wcs),
les écuries ($ac) et les records par circuit ($ts) ; le slot 1 les
préférences, le slot 2 les modes débloqués.

## Le lecteur

Le lecteur de liste d'affichage de Kaluga (`/kaluga/moteur/`) : formes
vectorielles, morphs, images, fontes embarquées, champs de texte (HTML
compris — le résumé de la FrutiCoupe), boutons, masques (`setMask` : le
décompte 3-2-1-GO découpe le circuit à la forme des chiffres), hitTest par
forme (les zones des circuits), horloge virtuelle à 40 images par seconde
(`getTimer()`), scripts d'image dans l'ordre du lecteur.

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
