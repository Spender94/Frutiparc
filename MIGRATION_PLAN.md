# Plan de modernisation de Frutiparc (Flash 2003-2004)

Ce dépôt contient un code ActionScript 2 / Flash historique. Le plus sûr est une **migration progressive**, avec un objectif de compatibilité fonctionnelle avant toute refonte UX.

## Recommandation courte

- **Front-end**: TypeScript + moteur 2D web (PixiJS) pour remplacer l’affichage Flash.
- **Back-end**: Node.js (NestJS ou Fastify) pour services, sessions, API.
- **Option haxe**: utile si vous voulez conserver une logique proche d’AS2 et cibler JS avec moins de réécriture initiale.

👉 En pratique, un bon compromis est:
1. Convertir/porter la logique métier la plus sensible en **Haxe** (si le code AS2 est dense et fragile).
2. Exposer cette logique vers un client web moderne (TypeScript).
3. Migrer le serveur vers Node.js de manière incrémentale.

## Pourquoi pas “full haxe” ou “full node” ?

### Full haxe
**Avantages**
- Proximité conceptuelle avec AS2/AS3.
- Possibilité de partager du code logique entre cibles.

**Inconvénients**
- Écosystème web plus restreint que TypeScript.
- Recrutement / maintenance potentiellement plus difficiles à long terme.

### Full node.js + TypeScript
**Avantages**
- Écosystème moderne massif.
- Outils de test, CI/CD, observabilité très matures.
- Plus simple pour trouver des contributeurs.

**Inconvénients**
- Réécriture plus importante si vous faites un “big bang”.

## Stratégie recommandée (sans big bang)

### Phase 0 — Cartographie (1 à 2 semaines)
- Inventorier les modules critiques (`frutiengine`, `frutiparc`, loaders, auth, chat, mini-jeux, UI).
- Lister dépendances externes (URLs, protocoles, formats de données).
- Capturer le comportement actuel (vidéos, captures, scripts de test).

### Phase 1 — Compatibilité protocole (2 à 4 semaines)
- Définir un contrat d’API moderne (REST/WS) qui encapsule l’ancien protocole.
- Créer un **BFF Node.js** (Backend for Frontend) qui parle à l’ancien système.
- Ajouter logs structurés pour comprendre trafic réel.

### Phase 2 — Client web moderne (4 à 10 semaines)
- Construire shell app (routing, auth, state management).
- Refaire l’UI principale en web.
- Porter les composants interactifs Flash vers Canvas/WebGL (PixiJS).

### Phase 3 — Portage logique métier (continu)
- Priorité: code à forte valeur + fort risque (sessions, permissions, inventaires, salon/chat, mini-jeux populaires).
- Option A: portage direct en TypeScript.
- Option B: portage intermédiaire en Haxe -> JS pour réduire les régressions.

### Phase 4 — Retrait progressif Flash
- Feature flags entre ancien et nouveau client.
- Migration par cohortes d’utilisateurs.
- Décommission finale quand parité atteinte.

## Architecture cible minimale

- `apps/web`: client TypeScript (React/Vue/Svelte selon préférence).
- `apps/api`: Node.js (NestJS/Fastify) + WebSocket.
- `packages/core`: logique métier partagée.
- `packages/protocol`: schémas (zod/openapi/protobuf).
- `infra/`: Docker, CI/CD, monitoring.

## Risques principaux à traiter tôt

- Comportements implicites de Flash (timing frame, depth, events).
- Formats de données historiques non documentés.
- Sécurité (auth legacy, XSS/CSRF, sessions).
- Régressions gameplay sur mini-jeux.

## Prochaine action concrète

1. Choisir un **vertical slice**: login + hub + 1 mini-jeu.
2. Le porter en stack moderne complète.
3. Mesurer: temps de chargement, stabilité, retours utilisateurs.
4. Répliquer pattern module par module.

## Verdict techno (pragmatique)

Si votre priorité est la maintenabilité long terme: **Node.js + TypeScript** comme base.

Si votre priorité est de préserver rapidement la logique AS2 existante avec moins de casse: **Haxe comme étape de transition**, puis convergence vers TypeScript au fil du temps.

## Mise en route réalisée

- Un guide d’exécution pas à pas est disponible dans `docs/STEP_BY_STEP_HAXE_TO_TS.md`.
- Un inventaire automatisé AS2 est fourni via `tools/migration/inventory_as2.js` (sortie: `migration/inventory/as2-inventory.json`).
