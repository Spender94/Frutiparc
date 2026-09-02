# Swapou 2 — portage natif JS (mobile /light)

Objectif : reproduire **Swapou 2** (Flash AS2, 700×480 @40fps) en JS natif
**sans changer le gameplay/les règles**, pour le rendre jouable sur mobile
(`/light`). Le SWF d'origine reste servi sur desktop via Ruffle.

Source de fidélité : **tout le source AS2 d'origine** est dans
`Games/swapou2/swapou2/*.as` (Player, Level, IA, Duel, Challenge, Classic,
HistoMap, Menu, Animator, Data…). Le portage est une **traduction directe**
de ces classes.

## Le jeu (résumé du source)

Puzzle d'échange de fruits sur grille (y=0 en haut) :
- On échange 2 fruits adjacents (clic/tap : quadrant le plus proche du
  curseur — `Level.getPair`). Groupes connexes (4-voisinage) de même couleur
  ≥ `min_combo` explosent ; gravité ; chaînes (`combo_number`++ par phase).
- À chaque tour joué : une **nouvelle ligne monte par le bas** (`genLine`,
  couleurs sans combo immédiat). Si la ligne ne peut pas monter (colonne
  pleine) → game over.
- Fruits spéciaux (flags) : `ARMURE` (gelé : ne matche pas tant que l'armure
  n'a pas été cassée par une explosion adjacente), `NOSWAP` (métal :
  inéchangeable), `STAR` (étoile : explose → +1 pouvoir, max 6).
- **4 modes** : Challenge (solo 12×14, 3 couleurs, min 3, score classé),
  Classique (12×14, min **2**, couleurs = niveau+2 ≤ 11, niveaux par paliers
  de coups — débloqué par l'item `$sucre` = fin du Pot au feu),
  Duel (vs **IA locale**, 2 plateaux 7×14, attaques/défenses à étoiles,
  pool de fruits parasites échangés, 5 difficultés),
  Pot au feu (histoire : carte de Légumia, dialogues, cinématiques, 7
  combats en duel, déblocage des personnages).
- 7 personnages, chacun **une attaque** et **une défense** (coûts
  `ATTACK_STARS`/`DEFENSE_STARS`, effets `Player.attacked`/`defend`) :
  vertige (verrou horizontal 20 s), gros noyau (2 lignes gelées),
  petit pépin (1 ligne), colonnade (4 gelés en colonne), trembleterre
  (amplifie les reliefs), double la mise, coulée de métal (sommets → métal) ;
  moïse (écarteur), glissement (égaliseur), coupure (coupeur),
  effondrement (pète la ligne du bas), colorant E21 (convertisseur),
  ramollissement (pète armures), combos classiques (explose les paires).
- IA (`IA.as`) : essaie tous les swaps (mélangés), simule les chaînes
  (`calcStart/calcNext/calcEnd`), score = `-écartType(hauteurs) + n/5`,
  vitesse/temps de réflexion par perso (`IA_TIMES`), attaque/défend selon
  comparaison des hauteurs moyennes.
- Scores : challenge `5·pièces·int(phases^0.8)` ; classique
  `niveau·(Σ1..pièces)·phases`. Envoi de parasites duel :
  `min(int((pièces-3+phase)·COMBO_FACTORS[phase]) + (2-difficulté|difficulté-2), 8)`.

## Architecture du portage

- `public/swapou/engine.js` — **logique pure** (Node + navigateur, testée) :
  grille/Level (calc, explode, gravity, genLine, getPair, push/popBottom),
  IA complète, générateurs de flags/couleurs (RNG injectable), formules de
  score, transformations d'attaque/défense. Fruits = objets
  `{t, save_t, flags, armure}` ; l'interface graphique s'accroche via un
  champ libre `spr`.
- `public/swapou/engine.test.js` — tests Node (`node public/swapou/engine.test.js`).
- `public/swapou/game.js` — client canvas 700×480 : traduction de
  Player/IAPlayer/Animator(Challenge)/Interf(2P/Challenge)/Menu/HistoMap/
  GameOver/Pause/Face/Particules/Sounds/Manager + pont plateforme HTTP.
- `public/swapou/index.html` — shell : canvas, scaling responsive
  (letterbox), tactile + souris, préchargement des assets, `?sid=`.
- Assets images : servis depuis `Games/swapou2` (routes statiques
  `/games/swapou2/...` déjà en place) — bitmaps extraits du `.fla` d'origine.
- Sons : extraits du SWF (`DefineSound` MP3) vers `public/swapou/sounds/*.mp3`.
  Noms de linkage résolus par désassemblage du bytecode (ordre des
  affectations statiques de `Sounds.as`) + durées exactes des fichiers
  sources du dossier dev (`foret.mp3`→`loop_forest`, etc.).
- Plateforme (tout est **solo** ; le seul réseau = persistance) :
  - `/api/loadFrutiSlots?game=swapou2` / `/api/saveFrutiSlot` — slot 0
    (persos débloqués `$chars`, records, `$swap`, `$items`, `$combos`),
    slot 1 (préférences son/musique/détails). Le serveur extrait déjà les
    **titems** (pictos) du slot 0 (`extractGameItemsFromSlot`).
  - `/api/saveScore` `game=swapou2&m=1` → classement `swapou2_challenge`
    (data = id du perso, colonne « Perso » du tableau des scores),
    `m=0` → `swapou2_classic`.
- `/light` : onglet « Swapou » (iframe `/swapou/?sid=…`, chargée à la 1re
  ouverture — même patron que Grapiz).

## Bot de Challenge (étude « jusqu'où peut-on aller ? »)

`bot.js` (politique pure, testée par `bot.test.js` en équivalence exacte
avec le moteur) + `bot.run.js` (harnais vm : le bot joue dans le VRAI
client, RNG seedé, stats). **Hors-ligne uniquement** : client standalone,
aucun score envoyé au classement.

Architecture : simulateur de chaînes sur grille légère → énumération des
~310 échanges + défense du perso → expectimax profondeur 2 (montée de
ligne échantillonnée avec le vrai générateur — gel `random(130)<random(ncoups)`,
métal, étoiles — puis meilleure riposte), élargissement panique quand le
plateau dépasse h=11. Poids ajustables via `--weights` (JSON).

Enseignements des expériences (graines fixes, 4-40 parties par config) :
- le mur est un problème de DÉBIT : la ligne apporte 12 fruits/tour, vers
  ncoups≈130 la moitié arrive gelée — il faut nettoyer ≥12 fruits/tour en
  moyenne, donc des cascades, pas des petits combos ;
- la gourmandise plate (récompenser les pièces nettoyées) RÉGRESSE — c'est
  le poids du score (qui encode pieces×phase^0.8, donc les chaînes) qui
  paie, mais seulement sous profondeur 2 (le 1-ply ne sait pas préparer) ;
- TomTom (RAMOLLISSEMENT 5★) meurt avec 4★ en banque : défense
  inatteignable en crise ; Dimitri (1★) et Natacha (2★) survivent le mieux.

Exemple : `node public/swapou/bot.run.js --games 24 --char 1 --seed 500
--depth2 --topk 12 --weights '{"score":1.5,"starsBoard":80}'`

Résultats (140 parties en profondeur 2, graines variées) :
- 1-ply : médiane ≈ 11-13 k, ~130 tours (4 persos) ;
- profondeur 2 + panique + poids score : **médiane ≈ 20 300**,
  moyenne ≈ 19 900, ~170 tours ;
- **record du bot : 37 315 points en 265 tours** (Natacha, graine 301922,
  config `{"score":2.5,"starsBoard":80}`, ~141 pts/tour) — soit ~70 % du
  record humain (~53 000), qui TIENT donc pour l'instant.
- morts typiques : sécheresse de combos (mobilité 1-2) au bord du plafond
  avec banque d'étoiles insuffisante, la glace recouvrant le plateau.
Pistes au-delà : profondeur 3/MCTS (préparation de chaînes à 2 tours),
optimisation automatique des poids (CMA-ES), ferme à chaînes dédiée.

## L'analyse en partie (`analyse.js`) — l'IA qui conseille le joueur

`analyse.js` (module pur, bâti sur le simulateur de `bot.js`) rend les
meilleurs coups d'une position de Challenge, chacun avec sa **nature** —
combo, coup silencieux (préparation), attente, défense — et sa **raison**
en une ligne. `analyse.worker.js` le fait tourner à côté du jeu ;
`AnalyseChallenge` (game.js) dessine le conseil par-dessus le plateau, en
Challenge seulement. L'option `swapouAnalyse` ne se vend pas : l'admin
l'accorde par la fiche joueur (route `game-feature`), et `/api/features` la
rend au client. Tests : `analyse.test.js` (décisions) et
`test/swapouAnalyse.test.js` (branchement).

**Ce que la mesure a dit** (harnais `bot.run.js --analyse`, Natacha, poids du
record, quatre graines) — et qui a renversé le plan de départ :

| réglage (profondeur 2, S = 3 sauf mention) | moyenne | meilleure |
|---|---|---|
| faisceau 12 (le bot) | 21 200 | 23 500 |
| faisceau 30 | 29 300 | 38 200 |
| faisceau 80 | 41 750 | 52 060 |
| faisceau 150 (deux graines) | 48 000 | 52 165 |
| faisceau 30 + **profondeur 3** | 32 500 | — (20× plus cher) |
| **tout le faisceau, entrelacé, budget 1,5 s** (défaut) | **44 800** | **50 960** |

La profondeur n'était pas le levier, la **largeur** l'était : le bot triait
ses ~310 échanges à un coup avant d'en approfondir douze, et un coup
silencieux, qui ne marque rien à un coup, finissait toujours hors du faisceau
— jamais regardé. Élargir le faisceau, c'est enfin juger les préparations à
deux coups, là où elles valent quelque chose. La profondeur 3 ajoute du bruit
d'échantillonnage sans rien voir de plus. Sous budget, combos et coups
silencieux sont approfondis en alternance pour qu'une coupe ne retrouve pas
le défaut. Coût : ~550 ms par coup en Node (tout le faisceau) — ce qu'un
humain ne remarque pas, puisque l'analyse tourne pendant qu'il réfléchit.

Repères donnés par le propriétaire : un bon score en Challenge c'est 35 000 ;
le record absolu, 52 400. Les quatre parties de validation : 50 960, 42 565,
44 275, 41 355.

### Les étoiles, et les sept pouvoirs (septembre 2026)

« L'IA est très forte pour maximiser les combos mais moins forte pour
utiliser les étoiles, qu'elle a tendance à dilapider dans des situations non
critiques. » Trois causes, dont une invisible :

1. **Le prix d'une étoile était fixe** (`defendBase × coût`), quelle que soit
   la hauteur du plateau. Il suit maintenant le moment (`bot.js`,
   `prixDefense`) : nul au plafond des six étoiles (la suivante serait perdue)
   et en crise (hauteur ≥ 12), triple sous la hauteur 9, et une **réserve**
   hors crise — on ne lâche pas sa dernière défense.
2. **Une étoile récoltée au plafond est perdue** (`Player.as` plafonne à six),
   mais l'analyseur la valorisait 500 quand même. On ne compte que celles qui
   ont une place.
3. **Trois pouvoirs n'étaient pas simulés** — Moïse (Sel), Glissement
   (Wasabi), Colorant E21 (Moutarde) : `simulateDefense` rendait null et l'IA
   ne les proposait jamais. Ces persos mouraient à 6★ sans avoir défendu une
   seule fois. Simulés depuis en équivalence exacte avec le moteur
   (`bot.test.js`, 120 grilles ; le Colorant sur l'espérance de ses six tirages).

**Mesure** (harnais `bot.run.js --analyse`, mêmes graines avant/après, budget
non contraignant) :

| perso | pouvoir | ancienne IA | nouvelle IA (12 parties) | appariées |
|---|---|---|---|---|
| Sel | Moïse 2★ | 38 663 (4) | **51 284** — médiane 52 k, meilleure 63 010 | +13 053 (4) |
| Wasabi | Glissement 2★ | 38 320 (12) | **46 597** — meilleure 62 055 | +12 663 (8) |
| TomTom | Ramollissement 5★ | 32 819 (4) | 45 001 | +7 398 (4) |
| Poivre | Combos 2★ | 37 218 (4) | 44 434 | +8 918 (4) |
| Dimitri | Effondrement 1★ | 42 426 (12) | 44 338 — 212 tours | +4 466 (8) |
| Moutarde | Colorant 4★ | 44 375 (4) | 43 208 — meilleure 64 180 | −1 674 (4) |
| Natacha | Coupure 2★ | 44 628 (12) | 42 982 | −1 719 (8) |

(Moyennes ; entre parenthèses, le nombre de parties. Écart-type ≈ 7 500 par
partie, donc ± 2 200 sur une moyenne de douze : l'avance de Sel est nette,
Wasabi/TomTom/Dimitri/Poivre ne se séparent pas, Natacha et Moutarde sont
dans le bruit.) Toutes IA confondues : ≈ 40 700 → ≈ 45 400.

**Ce que les fins de partie disent** : plus personne ne meurt avec une défense
en banque (0 ou 1★ partout, sauf les pouvoirs à 4 et 5★) ; et toutes les
parties passent 50 à 120 tours à hauteur ≥ 12 — la « crise » est l'état
normal de la seconde moitié, et y tirer ses étoiles n'est pas les dilapider,
c'est respirer. Le vrai dilapidage était ailleurs : le tour 80 de la partie de
référence (hauteur 8, cinq étoiles), et la course aux étoiles à banque pleine.

**Lecture des pouvoirs** :
- *Moïse* (Sel) : le seul qui RETAILLE le plateau — les deux colonnes du bord
  tombent (jusqu'à 28 fruits pour 2★) et le milieu se creuse de deux colonnes
  que les lignes suivantes remplissent par le bas. Parties les plus longues
  (220 tours). Tire surtout à banque pleine, et c'est juste.
- *Glissement* (Wasabi) : rien n'est détruit, mais un plateau nivelé ne meurt
  pas d'une colonne isolée et garde sa mobilité. Utilisé à 10-11 en prévention,
  puis en crise. Inutilisé avant : 38 k ; utilisé : 49 k.
- *Effondrement* (Dimitri) : une ligne par étoile, onze fois par partie,
  presque toujours au plafond — l'oxygène. Sûr, jamais structurel.
- *Coupure* (Natacha) : deux rangées pleines sur un plateau plat, presque rien
  sur un plateau bosselé — c'est un pouvoir de plateau plat au plafond.
- *Colorant* (Moutarde) : un pari — geler un tiers du plateau sous une autre
  couleur, pour la cascade quand tout se fend. Plus gros score isolé, plus
  grand écart.


## Correspondances sons (SWF id → linkage)

| id | nom | id | nom |
|----|-----------------|----|---------------|
| 8  | sound_menu      | 11 | loop_forest   |
| 10 | sound_game      | 1  | loop_wind     |
| 12 | sound_swap      | 4  | loop_fall     |
| 3  | sound_combo     | 5  | loop_bridge   |
| 14 | sound_pop1      | 9  | loop_swamp    |
| 13 | sound_pop2      | 6  | loop_night    |
| 16 | sound_show_score| 2  | wasabi_cry    |
| 15 | sound_menu_click| 7  | sound_menu_activate |

## Ordre des noms de combos (déduit des pictos `titems/combo_NN.gif`)

confiture, confitureOrange, tarte, tarteKiwis, tarteCreme,
tarteCremeOrange, tarteOranges, eclair, eclairExtra, coupeGlace,
coupeAncestrale (paliers `COMBOS = [3,4,5,6,7,9,11,13,15,18,21]`).

## État

- [x] Sons extraits et nommés.
- [x] Moteur de règles pur + tests (`engine.test.js`, 118 assertions).
- [x] Client canvas : menu, options, challenge, classique, duel, pot au feu
      (carte + dialogues + cinématiques + versus), game over, pause.
- [x] Persistance plateforme (slots, scores, titems, prefs).
- [x] Onglet /light.
- [x] Tests d'intégration headless : `client.test.js` (parties réelles
      jouées dans Node — menu, challenge, duel IA, attaques/défenses,
      histoire phase 0 complète, classique) et `draw.test.js` (fumée du
      rendu de tous les écrans avec un contexte 2D factice).
- [ ] Finitions éventuelles après retours en conditions réelles (positions
      pixel-perfect des écrans annexes, sons des cinématiques
      sprite-embarqués type cri de Wasabii).
