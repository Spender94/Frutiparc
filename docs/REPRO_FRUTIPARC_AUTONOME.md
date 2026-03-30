# Plan autonome pour reproduire Frutiparc

Rapport généré: 2026-03-30T13:19:49.933Z

## État de parité migration (AS2 -> Haxe/JS)

- Fichiers AS2 inventoriés: **81**
- Portés en JS + Haxe: **33**
- Portés JS uniquement: **0**
- Portés Haxe uniquement: **0**
- Non portés: **48**

## Prochaines cibles (ordre recommandé)

| Fichier AS2 | Lignes | Risque Flash | Action recommandée |
|---|---:|---:|---|
| `frutiparc/cmdList.as` | 8 | 0 | Portage immédiat vers Haxe + miroir JS |
| `frutiparc/listener/mouse.as` | 12 | 0 | Portage immédiat vers Haxe + miroir JS |
| `frutiparc/FPTrashSlot.as` | 16 | 0 | Portage immédiat vers Haxe + miroir JS |
| `frutiparc/lib/listener/init.as` | 16 | 0 | Portage immédiat vers Haxe + miroir JS |
| `frutiparc/listener/key.as` | 16 | 0 | Portage immédiat vers Haxe + miroir JS |
| `frutiparc/lib/frusion/init.as` | 18 | 0 | Portage immédiat vers Haxe + miroir JS |
| `frutiparc/FPCBeeManager.as` | 21 | 0 | Portage immédiat vers Haxe + miroir JS |
| `frutiparc/init_final.as` | 26 | 0 | Portage immédiat vers Haxe + miroir JS |
| `frutiparc/lib/root/init.as` | 28 | 0 | Portage immédiat vers Haxe + miroir JS |
| `frutiparc/test_game/init.as` | 28 | 0 | Portage immédiat vers Haxe + miroir JS |

## Boucle de travail autonome (à répéter)

1. Choisir le premier module non porté de faible risque.
2. Porter en Haxe (`packages/core-haxe`) puis miroir JS (`packages/core-js`).
3. Ajouter tests unitaires sous `tests/migration/`.
4. Exposer la capacité via l’API Node si utile.
5. Regénérer les rapports de migration et vérifier la baisse de `missing`.

```bash
node tools/migration/inventory_as2.js
node tools/migration/parity_tracker.js
node --test tests/migration/*.spec.js
```

Objectif: converger progressivement vers une reproduction fidèle de Frutiparc, sans blocage big-bang.
