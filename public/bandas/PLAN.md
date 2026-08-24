# Frutibandas — portage natif dans Frutiparc

Objectif : ressusciter **Frutibandas** en JS natif, **fidèle à l'original**,
lançable depuis le frutidisc, **multijoueur en ligne complet** (zone
d'appariements incluse), raccordé aux scores **Challenge**. Modèle : Grapiz.

On n'a pas le SWF compilé, mais on a **tout le source AS2 d'origine**
(`Games/frutibandas/lib/frutibandas/`), qui sert de spec de fidélité, et des
**assets préparés à la main** dans `Games/frutibandas/anim/` (TGA convertis en
PNG par `scripts/convert-bandas-assets.js` → `assets/`).

## Le jeu (déduit du source)

Frutibandas = un **pousse-pousse de fruits** 2 joueurs (oranges, béret rouge,
équipe 0 vs bananes, béret vert, équipe 1) sur une grille pleine (8/7/6/5) :

- À son tour, on peut jouer **au plus une fruticarte**, puis on **décale TOUS
  ses fruits** d'une case (flèches). Les fruits poussent ce qui est devant
  (chaînes) ; ce qui sort du plateau ou tombe sur une case morte **meurt**.
- Les **bords vides sont retirés** (`removeEmptyBorders`) : le plateau
  rétrécit pendant la partie.
- Une équipe **sans fruit a perdu** ; les deux à zéro = égalité (« La
  Vachette » gagne). Horloge type échecs par équipe (600/480/400/240 s).
- Avant la partie : **draft alterné** des fruticartes (2×N tirées au sort,
  N = **3**/2/1 par joueur — trois cartes, comme le jeu d'origine). Le draft
  alterne, mais **la partie s'ouvre chez celui qui a choisi en second** :
  piocher le premier donne déjà le meilleur des deux paquets.

### Les 12 fruticartes (sémantique reconstruite du source + textes du .fla)

| id | carte | effet |
|---:|---|---|
| 0 | Enclume | détruit la case ciblée (et son contenu) |
| 1 | Célérité | on rejoue après son mouvement (un MOUVEMENT seul : le tour rejoué ne rouvre pas la main) |
| 2 | Confiscation | *(cachée)* la carte adverse du tour suivant est annulée et volée |
| 3 | Renfort | jusqu'à 3 fruits alliés placés au hasard (coords encodées ×10000/×100) |
| 4 | Désordre | *(cachée)* le prochain mouvement adverse est **inversé** |
| 5 | Pétrification | le fruit ciblé devient une **pierre** (bloque les chaînes) |
| 6 | Vachette | la meuhmeuh vide toute la **colonne** choisie |
| 7 | Conversion | le fruit ciblé change d'équipe |
| 8 | Charge | le prochain mouvement est appliqué **deux fois** |
| 9 | Entracte | on ne bouge pas ce tour-ci (la carte tient lieu de tour) |
| 10 | Solo | seul le fruit choisi bougera au prochain mouvement |
| 11 | Piège | *(cachée)* piège une case libre ; le fruit qui s'y pose meurt avec la case |

Cartes cachées : la pose n'est envoyée **qu'au poseur** (`h="1"`), la
révélation est diffusée aux deux (rejouée par `Game.playCard` côté SWF —
même logique ici).

## Architecture (serveur autoritaire, modèle Grapiz)

- `engine.js` — portage fidèle de `Board.as` (mouvements/poussées/morts,
  bords, pièges, rochers, sérialisation `<b>` élément+7). Isomorphe.
  Tests : `engine.test.js`.
- `game.js` — `BandasGame` : draft, 1 carte/tour, les 12 cartes, fin de
  partie. Chaque action renvoie des **événements** (avec visibilité) que le
  client REJOUE avec son propre moteur. Tests : `game.test.js`.
- `server/lobby.js` — appariements (salons, défis, statuts), paramètres
  d'origine (`CreateParameters.as`), et les **trois salles** du jeu d'origine
  (`Main.as` : FREE_MODE 0 « amical », CHALLENGE_MODE 1, CHAMPION_MODE 2
  « championnat »). Une salle est un espace d'appariement à part : on ne voit,
  ne défie et ne rejoint que les siens.
- `server/elo.js` — la note du **Championnat**. La source impose une note qui
  monte ET descend (`FruticardSlot.$ls = [note, min, max]` — un cumul n'a pas
  besoin d'un minimum) mais pas sa formule : elle arrivait du serveur frusion
  (`Manager.onCbkScoreModif`), perdu. On reconstruit l'Elo classique, avec un
  coefficient de placement (48 sur dix parties, 32 ensuite) et un plancher à
  100. Module pur, isomorphe.
- `server/session.js` — horloges par équipe, timeout, abandon, snapshot
  (reprise sur reconnexion via `hello`).
- `server/bot.js` — IA. Négamax de profondeur 2 à 4 selon le niveau, et une
  évaluation qui dit la stratégie du jeu : matériel d'abord, puis **cohésion**
  (contacts entre ses fruits) et **marge** au bord — autrement dit *rassembler
  un bloc au centre, quitte à laisser ceux des flancs*. C'est la géométrie de
  `Board.moveSprite` : une chaîne qui trouve une case libre devant elle se
  tasse sans perte, un fruit collé au bord vers lequel on avance meurt. Les
  cartes sont choisies par SIMULATION (enclume, vachette, conversion,
  pétrification, charge, célérité, renfort, solo, entracte) et jouées seulement
  si le plateau qu'elles laissent vaut mieux. Niveau commun tiré au sort par
  partie.
- `server/net.js` — pont `<bd a="…">` ↔ `<bd e="…">` : lobby, sessions,
  bots (Banano, Orangine, Kiwano), **séries challenge** avec anti-farm
  (un humain ne compte qu'une fois par série — l'erreur 1529 d'origine).
  Tests : `server/server.test.js`.
- `index.html` + `ui.js` + `gameview.js` — client : écrans mode/lobby
  (gabarit Grapiz) + page de jeu 1050×728 (assets préparés), plateau canvas
  (case 46 px, frames 256×256 ancrées en 104,102), file d'animations
  séquentielle (équivalent `AnimationController`), draft, viseur des cartes
  ciblées, bannières d'annonce, vache/enclume/pétrification/renfort/envol,
  chat, musique intro→boucle (M pour couper).

### Câblage dans server.js

- route WS `case 'bd'` (+ `onDisconnect` si `client.bandas`), tick 1 Hz ;
- séries : `users[u].bandasStreak`, fin de série →
  `persistScore(u, 'bandas_challenge', série)` — la série n'appartient qu'à la
  salle du challenge ;
- championnat : la note se range sur la FRUTICARTE (slot 0 du disque bandas,
  aux clés d'origine `$linit`/`$l`/`$ls`) **et** au classement
  `bandas_champion`, écrit par `fixerScore` (écriture ABSOLUE — `persistScore`
  ne garderait que le meilleur jour, et une note doit pouvoir descendre). Si la
  fruticarte est vide mais le classement non, la note repart du classement ;
- classements : `bandas_challenge` est exposé au rk legacy **'5' (section C
  = « Challenge »)** et `bandas_champion` au rk **'7' (section L
  « Championnat »)** — la place que le client d'époque lui réservait. Grapiz
  garde son rk '8' à vide : son championnat n'est pas ouvert ;
- frutidisc `bandas1` (GAME_DISCS) + interception du lancement dans
  `ruffle.html` → ouvre `/bandas/?sid=…`.

## Écarts assumés vs l'original

- Le serveur frusion d'origine est perdu : draft alterné, fenêtre de
  confiscation (« au prochain tour »), génération du plateau (grille pleine
  moitié/moitié mélangée) et du pool (tirage uniforme avec doublons, comme le
  `c="3:3:3:3:3:7:8:9"` du source) sont **reconstruits** d'après le client.
- Les assets préparés qui portaient du texte anglais (bannières
  « advertiser », panneaux victoire/défaite, bouton « Sound ») ne sont PLUS
  utilisés : bannières, panneau de fin et boutons sont rendus en DOM/CSS aux
  couleurs des assets d'origine, avec les textes français du jeu (noms de
  cartes, Texts.as). Les PNG restent dans `assets/` pour référence.
- Après déclenchement d'un piège, le serveur garde la case `TRAPPED`
  (comportement exact de `Board.as`) alors que le client de la victime la
  voit `DESTROYED` — les deux sont léthales et comptent comme vides pour les
  bords : équivalent.

## Mobile (/light)

Le client est responsive (≤760 px) : lobby en onglets, écran de jeu empilé —
barre joueurs, plateau pleine largeur (canvas resserré autour du plateau,
**glisser le doigt = bouger**, croix directionnelle en appoint), main de
cartes au toucher avec **fiche de confirmation** (art + description +
Jouer/Fermer), visée par bandeau « Touche une case… », chat en surcouche
(bouton flottant). Entrée du menu light : onglet « Frutibandas »
(`/bandas/?sid=` en iframe, comme Grapiz).

## Relancer les tests

```bash
node public/bandas/engine.test.js
node public/bandas/game.test.js
node public/bandas/server/server.test.js
```
