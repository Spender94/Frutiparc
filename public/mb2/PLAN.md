# MotionBall — portage natif JS

Objectif : reproduire **MotionBall 2** (Flash AS2, scène 610×410 à 40 images
par seconde, 2005-2006) en JS natif, **sans rien changer au jeu** — mêmes
dessins, mêmes fontes, mêmes musiques et sons, mêmes animations de clips,
même physique de bille, mêmes salles, mêmes boss, même vitesse —, pour le
jouer dans `/light` (onglet MotionBall) et sur le bureau (fenêtre
« MotionBall », disque `mb2light`). Le SWF d'origine reste au catalogue
(`mb2`) et se joue toujours sous Ruffle.

Sources de fidélité :

- **tout le source AS2 du jeu** est dans `Games/motionBall2/mb2/` (Manager,
  Client, Card, Prefs, Sound, Text, Const, Collide, Game, Level, Interf,
  Tools, Ball, LevelLoader, Loader, Options, Pause, Boss, BossSerpent,
  BossTB, BossPow{Eau,Feu,Terre,Vent}, Menu, Transition, Aide, Intro,
  GameOver, GameOverCourse, TItems ; `BossBlackBall` et `Editor` ne sont pas
  compilés dans le SWF) : le portage en est une **traduction classe par
  classe, méthode par méthode** ;
- `Games/motionBall2/motionball.swf` est le disque joué (`full.swf` en est le
  lien) : **obfusqué** par Obfu (`OBFUSC.bat`), identifiants et noms de
  liaison compris — voir « Le dictionnaire » ;
- les cartes `Games/motionBall2/mb2*.dat` : `mb2data.dat` (le Challenge du
  jour, régénéré chaque nuit par `mb2gen.js`, le port serveur du générateur
  OCaml `mb2gen/`), `mb2classic.dat`, `mb2tuto.dat`, `mb2adv1..5.dat`,
  `mb2run1..7.dat` ; le portage les lit **telles quelles**, par le même
  décodeur binaire (`ext.util.MTBitcodec`) que le SWF ;
- les bibliothèques compilées dans le SWF, **désassemblées** faute de
  source : `Std` (le tmod, attachMC/createEmptyMC/duplicateMC et leurs
  compteurs, randomProbas, `Array.remove`, `Color.reset`),
  `asml.DepthManager` (les plans de mille profondeurs), `asml.UpdateList`,
  `asml.SoundManager` (canaux, boucles, fondus), `asml.PopupFX` (le ressort
  du panneau de fin), `ext.util.MTBitcodec` ; le `GameClient` de la Frusion
  vit dans `loader_motionball.swf` et n'est pas rejoué : `plateforme.js` en
  tient lieu, comme pour Kaluga.

## Le jeu (résumé du source)

Une bille dans un donjon de salles (8×8 au plus) ; on la pousse aux flèches,
elle rebondit sur les bumpers, ramasse les bonus, passe les portes, tombe
dans les trous. Un donjon a des salles normales (meublées de bumpers), des
salles à **objet** (une nouvelle bille : verte, bleue, métal, violette,
orange, rouge), des salles à **bonus** (carte, radar, grelots — les clés des
portes —, petit et grand temps) et la salle du **boss**.

- **Les billes** (`Ball`, sept types) : jaune (de départ), verte (casse les
  murs verts), rouge (attire les bonus rouges), orange (rapide et glissante :
  `speed_coef 2.1`, inertie `0.85`), bleue (saute par-dessus les trous),
  métal (lente et lourde : `maxspeed 7`, insensible aux aimants et aux
  bumpers de la mort), violette (voit les bumpers invisibles). Espace change
  de bille parmi celles qu'on possède. Chaque bille a ses **grains** (`stone`,
  `STONE_STYLE`) qui roulent dans un masque rond.
- **Physique** (`Ball.update`) : `sx,sy` amorties par `inertie^tmod`,
  poussée `speed_coef·tmod` (diagonale divisée par √2), vitesse plafonnée
  (`maxspeed 20`, au-delà du triple on divise par trois puis on freine à
  `0,8^tmod`), déplacement découpé en pas de `DELTA` (4 px) avec test de
  collision à chaque pas ; au vingtième pas bloqué, `recall()` cherche une
  case libre en spirale.
- **Collisions** (`Level.col_test`) : la salle est une grille de 152×102
  cases de 4 px (`coltable`) ; les bumpers y posent leur **hitmap** (la
  silhouette du clip, échantillonnée par `hitTest` à la grille — `Collide.
  gen_hitmap`). Seize points sur le cercle de la bille (`BALL_RAYSIZE 8`)
  sondent la table ; l'angle moyen des points touchés donne la normale, le
  rebond `out = ang + π − (in − ang)` avec un bruit de `random/100`, à une
  vitesse `speed·hit_coef` bornée par `hit_min` — chaque bumper a les siens
  (normal 1,5/20, temps 1,5/15, mort 1,2/5, aimant 1,0/5, invisible 3,0/15,
  mur 1,2/0, bordure 1,1/4). Les **événements** (`is_event` : les lignes des
  zappers) ne rebondissent pas.
- **Bumpers** (`Level.gen_bumper`, types 1…14 de la carte) : normal, temps
  (−5 s ; aiguilles `aig/aig2` qui suivent le temps restant), mort (tue la
  bille, sauf métal), aimant (attire puis repousse : `way`, retour aléatoire
  `random(1000/tmod)`), invisible (`bshadow`, alpha selon la distance pour la
  violette), mur vert (`wall`, seize raccords ; la verte le casse en quatre
  éclats `wallpart`), trou (`btype 7` : `walltable`, `holes` dessinés par
  script et masquant `ground`), téléporteur (deux `bteleport`, cinq anneaux
  `c0…c4` dupliqués), interrupteur (`interupt`, bascule `interred` /
  `interblue` ; anti-rebond de 20 images), zapper (`zapper`, sept phases :
  `((x−w/2)+(y−h/2)) % 7` ; les zappers de même phase sont reliés par une
  ligne qui tue toute bille d'une autre couleur — `flashLine`) ; en Course,
  les zappers sont des **checkpoints**.
- **Bonus** (`gen_bonus`) : rouge (il faut les prendre tous pour ouvrir les
  portes ; +son), bleu (+10 s ; +2 s en Classique ; −1 s en Course), la
  sortie du Classique (`exit`).
- **Portes** (`Interf.init_doors`, quatre par salle, `door` avec
  `porteA/porteB`) : `ptype` −2 sens unique (se referme derrière la bille —
  `autoclose_door_on_update`, et valide un tour en Course), −1 ouverte, 0
  porte (un grelot l'ouvre), 1 pas de porte, 2 invisible (on passe), 3
  « NEED » (l'objet requis ; hors Challenge, c'est un sens unique). Le
  changement de salle fait **défiler** l'ancienne et la nouvelle
  (`scroll_room`, `LVL_WIDTH/20` par image, tmod figé).
- **Salles spéciales** : objet (`ballbox` au centre, quatre bumpers de temps
  et quatre normaux aux coins), bonus (`itembox` au centre), boss (six trous
  en bas, deux bumpers de la mort en haut ; le boss naît quand la bille est
  entrée : `boss_room_on_update`).
- **Boss** : le **poulpe** (`Boss`, Challenge) — dodo, sauts (`jump_size`,
  `njumps`), aspiration (`aspire`, souffle, pinces `p1/p2`), tir de l'œil
  (`boss tir`, à renvoyer sur lui), dalles cassées (`casse`), quatre coups
  puis mort en particules ; le **serpent** (`BossSerpent`, Aventure 1 à 4,
  élément eau/feu/vent/terre) — `NHITS 3` anneaux, il faut frapper sa tête
  de face (`crane`, excitation, berserk à deux anneaux), ses pouvoirs
  (`BossPowVent` volutes qui repoussent, `BossPowFeu` flammes qui tuent,
  `BossPowEau` boule d'eau qui rend la bille glissante et laisse une traînée,
  `BossPowTerre` bourgeon et liane qui retient la bille) ; la **Tourneboule**
  (`BossTB`, Aventure 5) — apparition, vol, katas (six, choisis au hasard, le
  dernier annonce le pouvoir : vent double, feu en croix, eau en quatre,
  terre, dalles découpées `FXDalleCut`, murs), bulle de force, vingt coups.
- **Modes** (`Manager.startGame`) : **Challenge** (`mb2data.dat`, 15 min,
  trois billes, le poulpe ; le seul classé, score = `int(salles visitées ×
  100 / salles) − 1`, plus `int(temps restant / 100) × 100` si le boss est
  vaincu — `Game.calcScore`), **Classique** (`mb2classic.dat`, 1 min + 5 s
  par sortie, une bille, score = le rang de la salle, record sur la
  fruticard `$classic_score`), **Course** (`mb2run1..7.dat`, trois tours,
  chronométré, records `$records` à trois temps « ordinateur » et TItems
  or/argent/bronze — `TItems.giveCourse`), **Aventure** (`mb2adv1..5.dat`,
  18 min, cinq billes, un serpent ou la Tourneboule ; donjons `$dungeons`,
  `$dungeons_done`, temps `$dtimes`), **Aide** (`mb2tuto.dat`, une salle
  d'entraînement puis un panneau).
- **Fruticard** (slot 0, `Card`) : `$challenge, $classic, $items,
  $dungeons, $dungeons_done, $courses, $classic_score, $dtimes, $records` ;
  préférences (slot 1) : `$music, $sounds`. Les pictos (billes or/argent/
  bronze, bumpers, œil du poulpe, masque de TB, écailles, logos) se
  déduisent de `$items` côté serveur (`extractGameItemsFromSlot`).
- **Sons** (`Sound`) : cinq boucles superposées (`loop$1..5`, une de plus à
  chaque nouvelle bille — `nextMix`), musique du menu et du boss sur deux
  canaux fondus (`playMusic`, `fadeMix`), effets (`wall_bump`,
  `bumper_metal`, `object_found`, `bonus_blip*`, `kata1..3`, `hide`…).

## Le dictionnaire — retrouver les noms d'auteur dans un SWF obfusqué

Obfu remplace chaque identifiant par une chaîne de signes, avec un
dictionnaire unique : `bmagnet` devient `5{3+"?#` partout — dans le code
comme dans l'ExportAssets du symbole. Les sources AS2, elles, sont en clair.
On a donc aligné les constantes **poussées par le bytecode** (l'ordre de
compilation suit le source : la cible d'une affectation, puis les arguments
d'un appel dans l'ordre, les éléments d'un `InitArray` à l'envers) sur les
littéraux des `.as`, classe par classe, puis vérifié chaque nom par la
**structure** du clip (étiquettes d'images, enfants nommés) : `bmagnet` a
bien ses étiquettes `plus/neg`, `bdeath` ses six billes `b0…b5`, `exit`
ses `close/anim_open/open`, `boss` ses `normal/aspire/eat/throw/newEye/
looseEye/death/dodo`, la `tourneboule` ses six katas. Les sons ont suivi
l'ordre des constantes statiques de `Sound.as`. Le dictionnaire est dans
`scripts/extract-mb2.js` (`NOMS_CLIPS`, `NOMS_SONS`) ; `data/mb2.json` ne
connaît plus que les noms d'auteur.

Un symbole n'est référencé par aucune classe (`$]%})@`, quatre images) : il
garde son nom obfusqué, sans conséquence.

## La vitesse d'origine : 40 images par seconde, et le tmod de Std

Le SWF tourne à 40 i/s (en-tête). Le clip principal (`main`, sprite 900)
boucle sur deux images — `Std.update(); Manager.main()` — et `Std.update()`
(désassemblé, identique à celui de Kaluga) fait :

    deltaT = (getTimer() − oldTime) / 1000
    si deltaT < 0.5 : tmod = 0.95·tmod + 0.05·deltaT·wantedFPS   sinon deltaT = 1/wantedFPS

avec `wantedFPS` à **32** : à 40 i/s, `Std.tmod → 0,8`. Le jeu ne le
corrige pas (pas de `Cs.tmod` ici) : c'est ce 0,8 par image, à 40 images
par seconde, qui fait la vitesse de la bille, des katas
(`timer += tmod^1.3`), des scrolls. Le temps de partie, lui, descend de
`tmod × 1000 / 40` ms par image — soit 20 ms par image à 40 i/s : **le
chrono du Challenge court à 80 % du temps réel**, comme sur le disque. Le
portage bat à exactement 40 i/s sur l'horloge virtuelle du moteur
(`Scene.horloge`), et retrouve donc les mêmes tmod.

Les scripts d'image de trois clips (`exit`, les billes de `bdeath`, le
`boss`) lisent une variable **`tmod` globale** que rien ne pose jamais (ni
le jeu, ni `loader_motionball.swf`) : leur compteur vaut `NaN`, la
comparaison `> 0` échoue et la boucle d'attente est sautée — la sortie du
Classique s'ouvre sans les seize images de pause écrites par l'auteur. Le
portage reproduit ce comportement (voir `jeu/scripts-images.js`).

## Architecture du portage

Tout est **rejoué depuis le SWF** : les dessins ne sont pas redessinés, les
scénarios des clips ne sont pas réécrits. Le **lecteur** est celui de Kaluga
(`public/kaluga/moteur/` : `formes.js`, `flash.js`, `texte.js`, `son.js`,
`chargeur.js`), chargé tel quel depuis `/kaluga/moteur/` — un seul moteur
pour les deux jeux ; MotionBall lui a appris `duplicateMovieClip` (le clip
des trous dupliqué en masque de la bille qui tombe), les gestionnaires
globaux `onMouseMove` / `onMouseDown` / `onMouseUp` (la rotation du menu,
le clic qui quitte l'intro), `useHandCursor = false` sur un clip, et
`Color.reset()`.

- `scripts/extract-mb2.js` (+ `scripts/lib/`) — `node scripts/extract-mb2.js`
  écrit `public/mb2/data/mb2.json` (formes, morphs cuits, textes figés,
  champs, scénarios, fontes, étiquettes, scripts d'image repérés
  `mb2:<clip>:<image>`, **symboles renommés** par le dictionnaire),
  `data/img/` (les quatre décors JPEG, les bitmaps PNG, les logos),
  `sons/<nom d'auteur>.mp3` (33 sons, tous MP3), `fontes/mb2-<id>.woff`
  (Sweet as candy, Polo, Pleasantly Plump, Kiloton, Arial…).
- `public/mb2/jeu/` — les classes AS2, dans le même découpage :
  - `base.js` : `Const`, `Tools`, `Std` (les extensions : `attachMC`,
    `createEmptyMC`, `duplicateMC`, `randomProbas`, `random`, `xmouse`),
    `remove` (l'`Array.prototype.remove` de Std), `DepthManager`,
    `UpdateList`, `SoundManager`, `PopupFX`, `MTBitcodec`, `Card`, `Prefs`,
    `Sound`, `TItems`, `Text`, `Aide`, `Transition`, `Loader` ;
  - `niveau.js` : `LevelLoader`, `Level`, `Interf`, `Collide` ;
  - `balle.js` : `Ball`, `Options` ;
  - `boss.js` : `Boss`, `BossSerpent`, `BossTB`, `BossPowEau`, `BossPowFeu`,
    `BossPowTerre`, `BossPowVent` ;
  - `ecrans.js` : `Intro`, `Menu`, `Pause`, `GameOver`, `GameOverCourse` ;
  - `game.js` : `Game` ; `manager.js` : `Manager` et `demarrerMotionBall` ;
  - `scripts-images.js` : les 110 scripts d'image du SWF, transcrits depuis
    le bytecode (`scripts/disasm-as2.js`), clé `mb2:<clip>:<image>`.
- `public/mb2/plateforme.js` — `Client` : `/api/loadFrutiSlots` et
  `/api/saveFrutiSlot` (game=mb2, slots 0 et 1), `/api/saveScore` (game=mb2,
  le score de `calcScore`), les cartes `.dat` lues sur
  `/swf/games/motionBall2/`. La partie est toujours « blanche » (tous les
  modes ouverts, progression sur la fruticard) ; la barrière Fruit Défendu
  et le classement restent au serveur.
- `public/mb2/index.html` — la page : canvas 610×410 mis à l'échelle,
  manette tactile (flèches, espace, échap), `?sid=`, contrat
  `__relacherCommandes` du light, `eject-watch.js`.
- `public/mb2/atelier.html` — l'atelier : rend n'importe quel clip du SWF à
  une image donnée, pour comparer à l'œil avec Ruffle.

## Ce que le lecteur reproduit de l'AVM1 (et qui change tout)

- la **racine** du portage est le clip 0 du SWF lui-même (cadre #899, clip
  `main` #900, cadre #901) : `Manager.init` part du script de la première
  image de `main`, la boucle du jeu de sa deuxième — comme dans le fichier ;
- `DepthManager.attach` nomme ses clips `nom@compteur` (le compteur de Std)
  et les range par **plans** de mille profondeurs (`BG 0, SHADE 1, DECOR 2,
  HOLE 3, BONUS 4, BALL 5, BUMPER 6, DUMMY 7, BOSS 8, ICON 9`) ; la pause
  et la carte s'attachent au **parent** de `main` (profondeurs 0 et 1), le
  masque de transition à 999 ;
- une propriété lue sur `undefined` ne plante pas : là où l'AS2 tombait dans
  le vide en silence (`b.title` qui n'existe pas dans les boules du menu,
  `infos.dy` sans cadre, `shade_deux._alpha` avant sa naissance,
  `mc.shadow._y`, `boss_update` absent, `walltable[x−1][y]` hors grille),
  le portage garde le **même comportement**, en le disant en commentaire ;
- `for…in` à l'envers (`UpdateList.main`), `updates.remove` pendant le
  parcours (l'élément suivant est sauté, comme en 2005), `random(n)` qui
  tronque son argument ;
- les scripts d'image des clips créés pendant un script sont **mis en
  attente** et joués en fin d'unité d'exécution ; un `gotoAndStop` sur une
  image à script (les katas avancés par `nextFrame`) exécute ce script.

## Intégration Frutiparc

- `/light` : onglet `mb2` (`#mb2-panel`, iframe `/mb2/?sid=…`), disque
  « MotionBall » de la feuille « Mes disques » (jaquette du SWF) ;
  `CADRES_JEU`/`ADRESSES_JEU`.
- Bureau (`bureau-frutiz.js`) : rubrique `mb2` (fenêtre 622×436 : la scène
  à l'échelle 1 plus le cadre). Sous Ruffle, le FD noir joue le SWF et le
  disque light le portage (`LIGHT_CLIENTS`).
- Serveur : disque `mb2light` (`gameId: 'light/mb2'`, même `swfName` donc
  même voyant, même classement et même fruticard). Classements
  `mb2_classic` / `mb2_challenge` (le score empaqueté de `calcScore`,
  `mb2Comparator`), quotas FD, `mb2data.dat` du jour : inchangés, côté
  serveur.
- **CHALLENGE ou ENTRAINEMENT.** D'époque, la boule du premier mode disait
  « challenge » sur le disque noir (classé) et « challenge entrainement »
  (l'image 7 de la boule) sur le disque blanc (`Menu.show`,
  `client.isWhite()`). Ici la session est toujours blanche — tous les modes
  ouverts — et le score part toujours : c'est le serveur qui tranche, avec
  le quota de Fruits Défendus. Le menu demande donc ce quota
  (`/api/fd/status`, `Client.isRanked`) et la boule dit la vérité avant la
  partie, comme le CHALLENGE / ESSAIS de Kaluga.

## Vérification

- Atelier (`atelier.html`) : les billes et leurs grains, les bumpers, les
  portes, le poulpe, le serpent, la Tourneboule, le menu, le panneau de fin
  — comparés aux rendus Ruffle.
- Tests (`test/mb2*.test.js`) : le décodeur `MTBitcodec` sur les cartes
  historiques (mêmes donjons que `mb2gen.js`), le dictionnaire (chaque nom
  d'auteur du source a son symbole), la génération des salles, la physique
  (rebonds, hitmaps), le score.
- **Contre Ruffle** (Playwright, le disque Flash dans `game-popup.html`) :
  la même carte (l'Aide, `mb2tuto.dat`, toujours la même salle de départ),
  les mêmes touches (droite tenue 0,6 s, relâchée 0,6 s, haut tenue 0,6 s,
  relâchée 1,2 s), la bille relevée sur les captures toutes les 200 ms (ses
  pixels jaunes, les seuls du terrain) :

  | t | portage x,y | Ruffle x,y |
  |---|---|---|
  | 0 | 318, 218 | 318, 218 |
  | 0,6 s (droite) | 419, 218 | 412, 218 |
  | 1,2 s | 536, 218 | 536, 218 |
  | 1,8 s (haut) | 566, 118 | 566, 133 |
  | 2,2 s (le mur du haut) | 566, 43 | 565, 42 |
  | 3,0 s (retombée) | 562, 112 | 561, 102 |

  Les écarts tiennent dans une image (25 ms à 10 px par image) et le jitter
  des captures : poussée, inertie, plafond de vitesse, rebond au mur et son
  bruit sont ceux du Flash. La physique de la bille est celle de 2005.
