#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

echo "[1/3] Génération inventaire AS2..."
node tools/migration/inventory_as2.js

echo "[2/3] Sélection automatique du Lot A..."
node tools/migration/select_lot_a.js

echo "[3/3] Génération du suivi de parité + plan autonome..."
node tools/migration/parity_tracker.js

echo ""
echo "✅ MVP prêt à vérifier."
echo "- Rapport lisible Lot A: docs/MVP_LOT_A.md"
echo "- Rapport lisible autonomie: docs/REPRO_FRUTIPARC_AUTONOME.md"
echo "- Données JSON : migration/inventory/lot-a-candidates.json"
echo "- Données JSON : migration/inventory/parity-report.json"
