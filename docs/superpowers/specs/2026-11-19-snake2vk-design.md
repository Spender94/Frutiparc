# Frutisnake 2 VK dans Frutiparc (sans scores, Arène hors ligne)

## Intention

Intégrer à Frutiparc la réécriture de Frutisnake faite par Kobbs dans Frutiback (TypeScript + Pixi),
sous le nom **snake2vk** (« Snake 2, version Kobbs »), **à côté** de l'ancien `snake3` (Flash/Ruffle),
sans le toucher. À terme, snake2vk remplacera l'ancien ; ce n'est pas l'objet de ce travail.

## Objectifs

- Un disque `snake2vk` lançable depuis Frutiparc (fenêtre Ruffle, mode light, bureau Frutiz).
- Le jeu servi en statique sur `/snake2vk/`, lisant le compte via `?sid=` (pseudo de l'Arène = compte).
- **Aucun score enregistré, quel que soit le mode** (Challenge, Entraînement, Arène).
- **Arène hors ligne uniquement**, contre des bots.
- Validé en local avant tout envoi.

## Non-objectifs

- Remplacer l'ancien Frutisnake.
- Classements, médailles, kikooz, XP, quêtes pour snake2vk.
- Serveur d'Arène en ligne.
- Image définitive du Frutidisc : Kobbs la produit lui-même.

## Anti-objectifs (échec même si « ça marche »)

- Toute modification du comportement, des classements ou des scores de l'ancien `snake3`.
- Une requête `/api/saveScore` émise par snake2vk.
- Un disque dont le libellé ouvre l'ancien jeu (ou l'inverse).

## Contraintes

- Travail sur la branche `claude/frutiparc-ruffle-emulation-rYBHP` uniquement.
- Dans Frutiback (branche `frutiparc-integration`), ne pas toucher aux modifications non commitées
  existantes (`.gitignore`, `apps/arena-server/src/hub.test.ts`).
- Le jeu compilé est versionné dans `public/snake2vk/` (Render ne compile pas).

## Approches considérées

- **A. Reprendre la branche locale `integration-frutisnake-v2`** (clone `Frutiparc/`) et retirer les
  scores. Écartée : Kobbs veut rester sur la branche actuelle.
- **B. Repartir de la branche actuelle**, en recopiant à la main le branchement du disque de cette
  ancienne branche, sans sa partie scores. **Retenue.**

## Conception

1. **Frutiback** : un réglage de compilation `VITE_NO_SCORES=1` rend `submitScore` / `submitArena`
   inopérants et supprime les messages de classement en fin de partie. `build-frutiparc.mjs` cible
   `public/snake2vk/`, base `/snake2vk/`, avec `VITE_ARENA=1`, `VITE_ARENA_SERVER=''`, `VITE_NO_SCORES=1`.
2. **Frutiparc** : disque `snake2vk` (libellé distinct de `snake3`), branché dans `ruffle.html`,
   `light.html`, `bureau-frutiz.js` et les tables de disques de `server.js` nécessaires pour qu'il
   apparaisse dans « Mes disques ». Aucune entrée dans `RANKINGS` / `LEGACY_RANKINGS` : un envoi de
   score serait de toute façon refusé (double protection).
3. **Jaquette** : provisoire (reprise de l'ancienne branche, renommée), à remplacer par l'image de Kobbs.

## Laissé au constructeur (choix par défaut, corrigeables)

- Nom affiché : « Frutisnake 2 VK ».
- Tests : un test côté Frutiparc vérifiant le disque et l'absence de classement snake2vk ; un test
  côté Frutiback sur le réglage sans scores et le plan de build.
