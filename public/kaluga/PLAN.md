# Kaluga — portage natif JS

Objectif : reproduire **Kaluga** (Flash AS2, scène 700×480 à 40 images par
seconde, 2005) en JS natif, **sans rien changer au jeu** — mêmes dessins,
mêmes fontes, mêmes musiques et sons, mêmes animations de clips, même
physique et même vitesse — pour le jouer dans `/light` (onglet Kaluga) et sur
le bureau (fenêtre « Kaluga », disque `kalugalight`). Le SWF d'origine reste
au catalogue (`kaluga1`) et se joue toujours sous Ruffle.

Sources de fidélité :

- **tout le source AS2** est dans `Games/kaluga/class/kaluga/` (Manager, Menu,
  Game, Map, Slot, Panel, Part, Console, Scroller, InfoBar, SoundManager,
  Numb, Bar, MC, Cs, AnimList/AnimLoader, `sp/` les sprites, `game/` les
  modes, `part/` les morceaux de panneaux, `bar/`) : le portage en est une
  **traduction classe par classe, méthode par méthode** ;
- `Games/kaluga/kaluga.swf` est le SWF **non obscurci** (noms de liaison en
  clair, 19 sons, 18 fontes) : c'est lui qu'on extrait. `full.swf` — le
  disque joué — est la version obscurcie de kaluga.swf + `lib/menu.swf` +
  `lib/game.swf` + `lib/bumdum.swf` (`swfmake.xml`, clé « coucou ») ;
- les cartes `Games/kaluga/map/*.swf` (challenge, forest, field, mordor,
  olympic_a, squirrel, dawn) : décors JPEG et scénarios de portes/feuillage ;
- les bibliothèques externes compilées dans le SWF, **désassemblées** faute de
  source : `Std` (le tmod), `ext.game.Stat`, `ext.util.MTNumber`
  (`getTimeStr`), `ext.geom.CoefSquare` (le camembert carré),
  `asml.KeyManager` (les noms français des touches), et le
  `frusion.gameclient.GameClient` (couleurs de session, slots, score).

## Le jeu (résumé du source)

Une tzongre (mouche à grands yeux) vole au-dessus d'une prairie ; on bat des
ailes (haut), on penche (gauche/droite), on pique (bas), on lance un **fil**
(espace) qui s'accroche aux pommes à portée (`nbTake`), on les porte jusqu'au
**panier**. Les pommes tombent de l'arbre, roulent, rebondissent ; les fourmis
les mangent ; les papillons donnent des bonus (multi, chaîne, puissance,
armure, super, pluie de pommes) ; corbeau, écureuil, chenilles, grenouilles
selon les cartes.

- **Physique** (`sp/Phys`, `sp/Tzongre`) : vitesse `vitx/vity`, gravité
  `nbFall`, frottement `nbFrict^tmod`, poussée `nbThrust·tmod·thrustCoef`
  dans l'axe de la tzongre (`_rotation − 90°`), rotation `nbTurn·tmod`, boost
  qui s'use (`cBoost·nbBoostFrict`), boîte de vol (`box`, marge 10), rebond
  aux parois (`cBoundSide`), écrasement au sol si
  `vity + |vitx|/2 ≥ groundResist·(nbDodge + bonusDodge)`, ciel (feuillage)
  au-dessus de la boîte. Le fil : tension `fil.tensionMax`, les pommes liées
  tirent (`updateLink`), une chaîne se casse au-delà de `nbFilMax`.
- **Score** (`sp/Panier`) : une pomme déposée vaut la grappe qu'elle ferme ;
  le témoin de grappe `gOr` (OU binaire des tailles encaissées, rustine
  `scripts/patch-kaluga-grappe.js` du disque Flash) part avec le score
  (`data = "tz:gOr"`) : le serveur en fait la part classement Kaluga /
  record Freestyle.
- **Modes** (`game/`) : Challenge (`Classic`, chronométré, le seul classé),
  Chrono, Survie (le corbeau), Invasion (les fourmis), Piste (`Ring`, les
  anneaux), et les épreuves olympiques — Lancer de vers (`CaterLaunch`),
  Lancer d'écureuil (`SquirrelLaunch`), Lancer de fourmis (`AntLaunch`),
  Planter de vers (`CaterPlant`), Dextéripomme (`DexFruit`), Course de
  grenouilles (`FrogRun`) — en Triathlon et Heptathlon (tournoi contre les
  quatre autres tzongres, résultats simulés par `updateResult`). Chaque mode
  a ses quatre niveaux (facile → infernal), ses records et ses statistiques
  (`ext.game.Stat`).
- **Tzongres** : Kaluga, Piwali, Nalika, Gomola, Makulo — stats FORCE et
  EQ/AG/EN/PO/FL (barres du menu, `tzInfo`), débloquées par les niveaux.
- **Fruticard** (slot 0) : `$vs, $tz, $seq, $bonus, $mode, $stat, $classic,
  $trial, $chrono, $survival, $invasion, $ring` ; préférences (slot 1) :
  `$key` (5 touches), `$param` (musique, sons, particules). Les pictos
  (papillons, drapeaux, tzongres, panier/corbeau/anneau/fourmi, kagulga) se
  déduisent de la fruticard côté serveur (`extractGameItemsFromSlot`).

## La vitesse d'origine : 40 images par seconde, et un tmod à 0,96

Le SWF tourne à 40 i/s (en-tête). `Std.update()` (désassemblé) fait :

    deltaT = (getTimer() − oldTime) / 1000
    si deltaT < 0.5 : tmod = 0.95·tmod + 0.05·deltaT·wantedFPS   sinon deltaT = 1/wantedFPS

et `wantedFPS` **reste à 32** : le `initTimer(40)` du FLA appelle une
fonction qui n'existe pas (elle vient de l'ancien `timer-v3.as`, jamais
compilé ici). Puis `Cs.tmod = min(Std.tmod × 1.2, 3)`. À 40 i/s :
`Std.tmod → 0.8`, `Cs.tmod → 0.96`. C'est ce 0,96 par image, à 40 images par
seconde, qui fait la vitesse du jeu — le portage bat à **exactement** 40 i/s
sur une horloge virtuelle (`Scene.horloge`, lue par `K.getTimer()`), et
retrouve donc les mêmes tmod, sans dépendre du navigateur.

## Architecture du portage

Tout est **rejoué depuis le SWF** : les dessins ne sont pas redessinés, les
scénarios des clips ne sont pas réécrits.

- `scripts/extract-kaluga.js` (+ `scripts/lib/swf-formes.js`,
  `scripts/lib/swf-sprites.js`) — `node scripts/extract-kaluga.js` écrit
  `public/kaluga/data/` :
  - `kaluga.json`, `challenge.json`, `forest.json`…, `intro.json`,
    `credits.json` : pour chaque SWF, les
    **formes** (remplissages unis, dégradés, bitmaps, traits — en listes de
    tracés), les **morphs**, les **textes statiques**, les **champs**, les
    **boutons** (états et zone active), les **scénarios** de chaque clip
    (placements par image : profondeur, matrice, transformation de couleur,
    nom, masque, ratio de morph), les **fontes** (glyphes → WOFF), les
    étiquettes d'image, et les **scripts d'image** repérés
    `"<swf>:<clip>:<image>"` ;
  - `data/img/` (JPEG, PNG des bitmaps), `sons/` (MP3, ADPCM → WAV),
    `fontes/kaluga-<id>.woff`.
- `public/kaluga/moteur/` — un **petit lecteur Flash** :
  - `formes.js` : les formes en `Path2D`, dégradés (linéaire, radial, focal),
    bitmaps (matrice de remplissage, `repeat`/`clamp`, lissage), traits ;
  - `flash.js` : la **liste d'affichage** (`Clip`, `Bouton`, `Scene`) —
    scénarios rejoués image par image, `attachMovie` / `duplicateMovieClip`
    / `createEmptyMovieClip` / `removeMovieClip`, `gotoAndStop/Play`,
    `swapDepths`, `_x _y _xscale _yscale _rotation _alpha _visible`,
    `localToGlobal/globalToLocal`, `hitTest`, `setMask` et masques de
    scénario (`clipDepth`), transformations de couleur (`Color`), API de
    dessin (`lineStyle/beginFill/moveTo/lineTo/curveTo/endFill`), souris et
    boutons (états `up/over/down/hit`, `onPress/onRelease/onRollOver…`),
    clavier (`Key`, auditeurs), `setInterval`, `Std` ;
  - `texte.js` : `TextField` (texte, html — `<p> <font> <b> <i> <br>`, et le
    `\n` qui est un saut de ligne sans `condenseWhite` —, `setTextFormat`,
    `textWidth/textHeight`, `autoSize`, `wordWrap`), fontes **embarquées**
    (les WOFF du SWF, avec leurs métriques) et fontes système ;
  - `son.js` : `Sound` (MP3 et ADPCM décodés en Web Audio, `attachSound`,
    `start(offset, loops)`, `setVolume`, `stop`), déverrouillage au premier
    geste ;
  - `scripts-images.js` : les scripts d'image du SWF, **transcrits** un par
    un (`stop()`, `gotoAndPlay`, appels au parent, `removeMovieClip`…) ;
    `scripts-sequences.js` : ceux des deux films (intro, générique) ;
  - `chargeur.js` : lit les JSON, images, sons, fontes.
- `public/kaluga/jeu/` — les classes AS2, dans le même découpage :
  - `base.js` : `MC`, `Cs`, `Std`, `Stat`, `Numb`, `Bar`, `Slot`, `Panel`
    et ses `Part*` (bigScore, littleScore, title, stats, graph, msg, congrat,
    ladder, but, table, margin), `Scroller`, `InfoBar`, `SoundManager`,
    `AnimList`, `KeyManager`, `MTNumber`, `CoefSquare` ;
  - `sprites.js` : `Sprite`, `Phys`, `Tzongre`, `Fruit`, `Fil`, `Panier`,
    `Butterfly`, `Paillette`, `Bird`, `Ant`, `Caterpillar`, `Hole`,
    `Squirrel`, `Frog`, `Ring`, `Plume`, `Decor`… ;
  - `game.js` : `Game` (cartes, listes, boucle `update`, panneaux de départ
    et de fin, sauvegarde, déblocages, fondu blanc, pause) ;
  - `modes.js` : `Classic`, `Chrono`, `Survival`, `Invasion`, `Ring`, les six
    épreuves olympiques, le tournoi ;
  - `menu.js` : `Menu` (portrait, barres, entrées, options, console),
    `Console`, `AnimLoader` ;
  - `manager.js` : `Manager` (slots, fruticard — `reparerCard` complète les
    fiches anciennes —, préférences, sons, `demarrerKaluga`).
- `public/kaluga/plateforme.js` — `Client` : `/api/loadFrutiSlots` et
  `/api/saveFrutiSlot` (game=kaluga, slots 0 et 1), `/api/saveScore`
  (game=kaluga, m=0, `data = tz:gOr`), `/api/light/profile`. La partie est
  toujours « blanche » (progression sur la fruticard) ; la barrière Fruit
  Défendu et le classement restent au serveur (`fdBlocked`).
- `public/kaluga/index.html` — la page : canvas 700×480 mis à l'échelle,
  manette tactile (touches configurées du jeu), `?sid=`, contrat
  `__relacherCommandes` du light, `eject-watch.js` (éjection du disque et
  voyant « joue à Kaluga »).
- `public/kaluga/atelier.html` — l'atelier : rend n'importe quel clip du SWF
  à une image donnée, pour comparer à l'œil avec Ruffle.

## Ce que le lecteur reproduit de l'AVM1 (et qui change tout)

- l'**objet d'initialisation** de `attachMovie` est copié **avant** le
  constructeur ; les propriétés du scénario (enfants nommés) existent avant
  lui aussi ; les scripts d'image des clips créés pendant un script sont
  **mis en attente et joués à la fin de l'unité d'exécution** (tick,
  gestionnaire de touche ou de souris, `setInterval`) — sans quoi le
  `stop()` de l'image 1 de la tzongre arrivait après l'avance à l'image 2 et
  elle perdait ses enfants ;
- les profondeurs du **scénario** sont à `p − 16384`, sous celles des
  scripts : les titres du menu (scénario) passent sous la barre
  (`attachMovie`) comme dans Flash ;
- `gotoAndStop` **réconcilie** la liste d'affichage : les enfants du
  scénario qui subsistent gardent leur état, les autres disparaissent, ceux
  des scripts restent ;
- `removeMovieClip` ne retire que les clips créés par script (profondeur
  ≥ 0), et une transformation posée par script soustrait l'objet aux
  placements du scénario (voir « Les séquences ») ;
- une propriété lue sur `undefined` ne plante pas : là où l'AS2 tombait dans
  le vide en silence (les yeux de la tzongre écrasée, `optionTable.k5` qui
  n'existe pas, `spriteList` jamais initialisée en 2005, le `unFreeze()`
  d'une tzongre absente), le portage garde le **même comportement**, en le
  disant en commentaire ;
- les particularités d'époque sont gardées : l'ordre inverse du `for…in`
  (`Stat.getList`), le `switch` sans `break` de `DexFruit.updateResult`
  (Nalika prend la formule de Gomola), le panneau « Rejouer ? » offert à
  tous les modes (rustine du disque), le `\n` dans le `htmlText`.

## Intégration Frutiparc

- `/light` : onglet `kaluga` (`#kaluga-panel`, iframe `/kaluga/?sid=…`,
  chargée à la première ouverture ; `CADRES_JEU`/`ADRESSES_JEU`), disque
  « Kaluga » de la feuille « Mes disques » (jaquette `kaluga` du SWF) ;
  Kaluga quitte la liste des jeux joués en fenêtre Ruffle.
- Bureau (`bureau-frutiz.js`) : rubrique `kaluga` (fenêtre 712×506 : la
  scène à l'échelle 1 plus le cadre) ; glissé dans la Frusion, un disque
  Kaluga y ouvre le portage — comme les deux disques de Frutisnake, dont le
  bureau HTML joue toujours la version HTML. Sous Ruffle, le FD noir joue le
  SWF et le disque light le portage (`LIGHT_CLIENTS`).
- **Deux disques, pas trois.** Le catalogue avait le FD noir (`kaluga1`) et
  sa DÉMONSTRATION (`kalugademo`, anneau rouge, playMode « preview ») : le
  même SWF, joué sans rien classer — la « session blanche » que le menu du
  jeu appelait ESSAIS. Le portage rend cet état autrement (voir ci-dessous),
  et la démo a donc été retirée : il reste `kaluga1` (Flash) et
  `kalugalight` (portage). Un disque de démo déjà posé sur un bureau cesse
  simplement de paraître — `desktopNodesXml` saute les identifiants
  inconnus.
- **CHALLENGE ou ESSAIS.** D'époque, le premier mode s'appelait CHALLENGE,
  et ESSAIS en session blanche (`Menu.genMenuList`). Ici la progression est
  toujours enregistrée et le score part toujours : c'est le SERVEUR qui
  tranche, avec le quota de Fruits Défendus. Le menu demande donc ce quota
  (`/api/fd/status`, `Client.isRanked`) et dit la vérité avant la partie —
  **CHALLENGE** quand elle ira au classement, **ESSAIS** quand elle n'ira
  pas (plus de FD du jour, ou jeu ouvert sans session). Le quota se
  rafraîchit après chaque score, donc le menu suivant est juste. Deux
  entrées SÉPARÉES seraient impossibles sans inventer un dessin : le titre
  d'une entrée est une image du SWF (`slotTitle`, une par identifiant de
  mode), comme son ombre et son voyant.
- Serveur : disque `kalugalight` (anneau rouge, `gameId: 'light/kaluga'`,
  même `swfName` donc même voyant, même `<service>`, même classement et
  même fruticard), que `ruffle.html` (`LIGHT_CLIENTS`) ouvre en fenêtre
  740×540 ; `extractGameItemsFromSlot` déduit aussi `$kagulga`
  (`$mode[1][8]`, le triathlon gagné). Quotas FD, classement
  `kaluga_classic` et record `kaluga_freestyle` : inchangés, côté serveur.

## Vérification

- Atelier (`atelier.html`) : tzongres, pomme, panier, grenouille, écureuil,
  chenille, barres du menu, titres (fonte Donald), panneau de départ
  (panorama JPEG, texte html), panneau de fin (motif masqué), table des
  options, pause — comparés aux rendus Ruffle.
- Pilotes Playwright (scratch) : un pilote automatique joue le Challenge
  (fil, port, panier, combos, fin de partie, sauvegarde du score, pages du
  panneau de fin, « Rejouer ? »), et tous les modes déverrouillés se
  lancent sans erreur de console.
- **Contre Ruffle**, mêmes entrées clavier, même chronologie (un scénario
  qui part du sol pour que les deux moteurs aient le même état de départ),
  position de la tzongre relevée sur les captures (ses pupilles, les seuls
  pixels noirs mobiles de la zone de jeu) :

  | phase | Ruffle (full.swf) | portage |
  |---|---|---|
  | chute libre, y à 1,10 s / 1,59 s après la sortie du nid | 384 / 432 | 388 / 431 |
  | vitesse limite en descente | 96,8 px/s | 96,5 px/s |
  | montée sous poussée d'une seconde, y à 2,55 s / 2,77 s | 250 / 122 | 232 (2,63 s) / 101 (2,83 s) |
  | descente après poussée, y de 3,94 s à 7,05 s | 46,7 → 347,9 | 52,7 → 347,9 |
  | poussée + virage à droite : x à 4,50 s / 4,73 s | 241,7 / 287,1 | 241,3 / 285,7 |

  Les écarts tiennent dans une image (25 ms) et le jitter des captures
  (≈ 0,1 s) : gravité, frottement, poussée, rotation et vitesse limite sont
  celles du Flash.
- `node --test test/*.test.js` : la suite du dépôt (dont
  `jeuxDisponibles`, `kalugaFreestyle`, `fruticard`, `voyantEnPartie`).

## Les séquences (INTRODUCTION, CREDITS)

Deux films à part (`anim/intro/intro.swf`, 350×240 ; `anim/credits/
credits.swf`, 350×135), que le jeu chargeait par `loadClip` dans l'AnimLoader.
Ils sont extraits comme le reste (`data/intro.json`, `data/credits.json` —
décors JPEG, chenille et tzongres, la musique du générique) et leurs scripts
d'image sont portés dans `moteur/scripts-sequences.js` **depuis le bytecode**,
pas depuis les `code.as` des dossiers, qui ne sont pas ceux qui ont été
compilés (l'intro du FLA a deux exemplaires de chaque décor, plus de
chenille attachée par script, un voile qui s'efface par `_alpha`…). Chaque
film est un clip de quatre images : fonctions définies à l'image 1, `init()`
à la 2, `main()` à la 3, et la 4 revient à la 3.

Deux règles du lecteur Flash sont venues avec eux :

- `removeMovieClip` **ne retire pas** une instance posée par le scénario
  (profondeur négative) : les films le font sur leurs masques, sans effet ;
- une transformation posée par script (`_x`, `_y`, échelle, rotation,
  `_alpha`) **soustrait l'objet aux placements du scénario** — l'image
  suivante d'une interpolation, le retour d'un goto — comme dans Flash
  (Ruffle : `transformed_by_script`). C'est ce qui laisse le voile de
  l'intro s'effacer alors que son clip boucle sur ses images.

Le `Std` des films est celui du jeu (une seule classe par lecteur), mis à
jour deux fois par image pendant un film (`Manager.update`, puis `main()`
du générique) — le générique tourne donc à ce tmod-là (≈ 0,49), comme sur
le disque. Son `Std.cast(Std).wantedFPS = 40` touche ce Std partagé ;
l'AnimLoader rétablit 32 en quittant la séquence : on ne reproduit pas
l'accélération du jeu qui suivait le générique d'époque. (Sous Ruffle, dans
ce dépôt, ces séquences ne se chargent pas : le disque `kaluga1` ne liste
pas les films — le portage les rend.)
