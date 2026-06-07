# Grapiz — relance (portage natif dans Frutiparc)

Objectif : ressusciter le jeu **Grapiz** en JS natif dans Frutiparc, **fidèle à
l'original** (look & feel), **lançable depuis le frutidisc Grapiz**, en
**multijoueur en ligne complet** (zone d'appariements incluse).

On n'a pas le SWF compilé (la chaîne `flashcompcli` → IDE Flash distant est
morte, et le `.fla` binaire ne se recompile pas hors IDE Flash). Mais on a
**tout le source AS2 d'origine** (`Games/grapiz/lib/grapiz/`), qui sert de spec
de fidélité.

## Le jeu (déduit du source)

Grapiz = un **« Lines of Action » sur plateau hexagonal** :
- Plateau hexagonal de taille 3/4/5 (`GameParameters`), coords axiales (x,y),
  case valide = nombre hexagonal centré 3s²+3s+1.
- 6 directions jouables (N, NE, SE, S, SW, NW ; E/W mortes).
- Un jeton se déplace le long d'une ligne d'une distance = **nombre de jetons
  sur toute cette ligne**. Il peut sauter ses propres jetons, **pas** un
  adversaire ; capture un adversaire sur la case d'arrivée ; interdit de finir
  sur un allié.
- 2 à 4 joueurs, horloge par tour (`Game.updateTimers`), 600→180 s.
- Départ « lambda » : 9 jetons/équipe sur le bord (`Board.newLambdaBoard`).

## Architecture : LE SERVEUR EST AUTORITAIRE

`Game.as` ne calcule jamais le vainqueur : il reçoit du serveur `turn(t)`,
`move(x,y,d)`, `end(winner)` (via `Manager`/`NetworkController`). Le client
miroir affiche le plateau et envoie des **demandes** de coup. Donc la validation
des coups + la détection de fin/timeout vivaient dans le **serveur frusion**
d'origine (absent du source). On doit les **reconstruire** côté server.js.

## État d'avancement

- [x] **Phase 1 — Moteur de règles** (`engine.js`, isomorphe Node+navigateur) :
      Direction / Coordinate / Token / Board (isValid, countTokensOnLine,
      canMove, move, availableMoves), plateau lambda. Tests : `engine.test.js`
      (57 assertions, `node public/grapiz/engine.test.js`). **Vérifié.**
- [ ] **Phase 2 — Logique de partie serveur** : état autoritatif, validation des
      coups (réutilise `engine.js`), tours + horloges, **condition de victoire**.
- [ ] **Phase 3 — Appariements (zone manquante)** : protocole de
      `NetworkController.as` (listRooms/joinRoom/createGame/challengePlayer/
      getChallengerInfo/startGame/partGame/checkTimeout + erreurs 2005-2044),
      salons & défis côté serveur, intégration au bridge frusion existant.
- [ ] **Phase 4 — GUI client fidèle** : `gui/*` (Board, Token, AvailableSlot,
      MoveCursor, PlayerInfo, ChatPane, EndPane, Confirm) + `Convert` (logique↔
      pixels). Lancement depuis le frutidisc `public/ft/game/grapiz`.
- [ ] **Phase 5 — Assets** : art vectoriel (jetons/plateau) à exporter du `.fla`
      ou à recréer ; bitmaps déjà récupérés (10 JPEG).

## Questions ouvertes

1. **Condition de victoire** (la règle à confirmer). Hypothèse LOA : une équipe
   gagne quand TOUS ses jetons forment un seul groupe connexe (voisinage = 6
   dirs hex) — voir `Board.teamConnected()`. Le descriptif « piéger votre
   adversaire » pourrait aussi impliquer l'immobilisation / l'élimination. À
   trancher avant la Phase 2.
2. Règles multi (3-4 joueurs) : ordre des tours, élimination, fin.
3. Mapping exact des commandes `NetworkController` sur le bridge frusion actuel.

## Carte du source d'origine

`Games/grapiz/lib/grapiz/` : Board, Token, Coordinate, Direction, AvailableMove,
Game, GameParameters, Convert, Manager, NetworkController, GameListener,
FruticardSlot, Texts, Globals, Main ; `gui/` : Game, Board, Token,
AvailableSlot, EditSlot, MoveCursor, PlayerInfo, ChatPane, EndPane, Confirm,
KeyboardController, TokenAnim, Coordinate.
Assets : `Games/grapiz/{gfx,titems}`, bitmaps récupérés du `.fla`.
