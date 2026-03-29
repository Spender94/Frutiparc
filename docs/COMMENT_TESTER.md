# Comment tester (débutant)

Ce guide est fait pour lancer le **premier MVP** sans connaissances techniques avancées.

## 1) Prérequis

Vérifie que Node.js est installé:

```bash
node -v
```

Tu dois voir une version (ex: `v22.x.x`).

## 2) Ouvrir le projet

Dans un terminal, place-toi dans le dossier du projet:

```bash
cd /workspace/Frutiparc
```

## 3) Lancer le MVP (commande unique)

```bash
bash tools/migration/run_mvp.sh
```

Cette commande fait automatiquement:
1. l’inventaire des fichiers ActionScript,
2. la sélection des 5 premiers modules “Lot A” (les plus simples pour commencer Haxe).

## 4) Lire les résultats

- Rapport humain (facile à lire): `docs/MVP_LOT_A.md`
- Résultat machine (JSON): `migration/inventory/lot-a-candidates.json`

## 5) Vérifier que ça a marché

Tu dois voir à la fin du terminal:

- `✅ MVP prêt à vérifier.`
- le chemin vers les deux fichiers ci-dessus.

## Dépannage rapide

### Erreur: `node: command not found`
Node.js n’est pas installé (ou pas dans le PATH).

### Erreur: `Missing inventory file`
Relance simplement la commande unique:

```bash
bash tools/migration/run_mvp.sh
```

### Erreur de permissions sur le script
Lancer:

```bash
chmod +x tools/migration/run_mvp.sh
bash tools/migration/run_mvp.sh
```
