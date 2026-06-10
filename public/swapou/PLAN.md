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
