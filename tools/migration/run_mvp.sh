#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

echo "[1/2] Génération inventaire AS2..."
node tools/migration/inventory_as2.js

echo "[2/2] Sélection automatique du Lot A..."
node tools/migration/select_lot_a.js

echo ""
echo "✅ MVP prêt à vérifier."
echo "- Rapport lisible: docs/MVP_LOT_A.md"
echo "- Données JSON : migration/inventory/lot-a-candidates.json"
