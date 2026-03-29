# Avancement Lot A (Haxe -> TypeScript)

## État actuel

- ✅ **Module FEColor** porté en Haxe: `packages/core-haxe/src/frutiparc/core/FEColor.hx`
- ✅ **Module Window** porté en Haxe: `packages/core-haxe/src/frutiparc/core/Window.hx`
- ✅ **Module FECMItem** porté en Haxe: `packages/core-haxe/src/frutiparc/core/FECMItem.hx`
- ✅ **Module Desktop** porté en Haxe: `packages/core-haxe/src/frutiparc/core/Desktop.hx`
- ✅ **Module CBeeLC** porté en Haxe: `packages/core-haxe/src/frutiparc/core/CBeeLC.hx`
- ✅ Base transitoire `Slot` introduite: `packages/core-haxe/src/frutiparc/core/SlotBase.hx`
- ✅ Miroirs runtime JS ajoutés pour intégration immédiate Node:
  - `packages/core-js/src/feColor.js`
  - `packages/core-js/src/window.js`
  - `packages/core-js/src/fecmItem.js`
  - `packages/core-js/src/slotBase.js`
  - `packages/core-js/src/desktop.js`
  - `packages/core-js/src/cbeeLc.js`
- ✅ Tests de parité ajoutés:
  - `tests/migration/feColor.spec.js`
  - `tests/migration/window.spec.js`
  - `tests/migration/fecmItem.spec.js`
  - `tests/migration/desktop.spec.js`
  - `tests/migration/cbeeLc.spec.js`

## Commandes de test

```bash
node --test tests/migration/feColor.spec.js tests/migration/window.spec.js tests/migration/fecmItem.spec.js tests/migration/desktop.spec.js tests/migration/cbeeLc.spec.js
```

## Prochain module recommandé

Parmi les candidats Lot A, le prochain petit module conseillé est `frutiengine/FEString.as`.
