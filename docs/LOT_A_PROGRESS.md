# Avancement Lot A (Haxe -> TypeScript)

## État actuel

- ✅ **Module FEColor** porté en Haxe: `packages/core-haxe/src/frutiparc/core/FEColor.hx`
- ✅ Miroir runtime JS ajouté pour intégration immédiate Node: `packages/core-js/src/feColor.js`
- ✅ Tests de parité ajoutés: `tests/migration/feColor.spec.js`

## Commande de test

```bash
node --test tests/migration/feColor.spec.js
```

## Prochain module recommandé

Parmi les candidats Lot A, le prochain petit module conseillé est `frutiengine/Window.as`.
