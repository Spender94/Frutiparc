# Migration Frutiparc: approche 2 (Haxe -> convergence TypeScript)

Ce document lance l’approche que vous avez validée: **porter d’abord la logique en Haxe**, puis converger progressivement vers un socle **TypeScript/Node.js**.

## Étape 1 (maintenant) — Inventaire automatique du code AS2

### Objectif
Obtenir une cartographie exploitable des sources ActionScript (fichiers, classes, dépendances et APIs Flash sensibles).

### Commande
```bash
node tools/migration/inventory_as2.js
```

### Résultat
- Génère `migration/inventory/as2-inventory.json`.
- Ce JSON servira de base pour prioriser le portage Haxe module par module.

## Étape 2 — Définir les lots de portage Haxe

À partir de l’inventaire:
1. Classer les modules par criticité (auth, session, chat, inventaire, mini-jeux).
2. Identifier ceux qui dépendent le plus du runtime Flash (`attachMovie`, `loadMovie`, `onClipEvent`) pour les traiter à part.
3. Créer 3 lots:
   - **Lot A (métier pur)**: portable rapidement en Haxe.
   - **Lot B (métier + I/O)**: nécessite adaptateurs.
   - **Lot C (UI/Flash direct)**: à réécrire côté client TypeScript/PixiJS.

## Étape 3 — Créer le noyau Haxe

Créer un module `packages/core-haxe` avec:
- modèles de domaine (User, Room, Item, etc.),
- services métier purs,
- tests unitaires de non-régression.

Cible recommandée au départ: **JavaScript** (pour intégration rapide au futur client/server TS).

## Étape 4 — Brancher le noyau Haxe dans une app Node.js

- Exposer les fonctions Haxe compilées JS dans `apps/api`.
- Ajouter une couche anti-corruption qui convertit les anciens formats Frutiparc vers des DTO modernes.
- Couvrir par des tests de contrat (entrées/sorties attendues).

## Étape 5 — Convergence TypeScript progressive

Pour chaque module Haxe stabilisé:
1. Réécrire en TypeScript avec tests équivalents.
2. Exécuter les deux implémentations en parallèle derrière un feature flag.
3. Retirer la version Haxe après validation métriques + QA.

## Définition de “Done” par module

- Parité fonctionnelle validée.
- Tests unitaires + contrat verts.
- Aucun appel direct au runtime Flash dans le module.
- Observabilité en place (logs + métriques d’erreur).

## Prochaine exécution immédiate

1. Lancer `node tools/migration/inventory_as2.js`.
2. Ouvrir `migration/inventory/as2-inventory.json`.
3. Choisir ensemble le **Lot A** (3 à 5 modules) pour commencer le portage Haxe.

## Étape 2bis (outillage prêt) — Sélection automatique du Lot A

Commande:
```bash
node tools/migration/select_lot_a.js
```

Sorties:
- `migration/inventory/lot-a-candidates.json`
- `docs/MVP_LOT_A.md`

## Pour tester facilement (débutant)

- Guide simple: `docs/COMMENT_TESTER.md`
- Commande unique: `bash tools/migration/run_mvp.sh`

## Lot A lancé (implémentation)

- Premier portage réalisé: `FEColor`.
- Voir `docs/LOT_A_PROGRESS.md` pour les commandes de test et la suite.
