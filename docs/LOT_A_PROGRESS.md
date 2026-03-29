# Avancement Lot A (Haxe -> TypeScript)

## État actuel

- ✅ **Module FEColor** porté en Haxe: `packages/core-haxe/src/frutiparc/core/FEColor.hx`
- ✅ **Module Window** porté en Haxe: `packages/core-haxe/src/frutiparc/core/Window.hx`
- ✅ **Module FECMItem** porté en Haxe: `packages/core-haxe/src/frutiparc/core/FECMItem.hx`
- ✅ **Module Desktop** porté en Haxe: `packages/core-haxe/src/frutiparc/core/Desktop.hx`
- ✅ **Module CBeeLC** porté en Haxe: `packages/core-haxe/src/frutiparc/core/CBeeLC.hx`
- ✅ **Module FEString** porté en Haxe (subset pragmatique): `packages/core-haxe/src/frutiparc/core/FEString.hx`
- ✅ **Module FENumber** porté en Haxe (subset utile): `packages/core-haxe/src/frutiparc/core/FENumber.hx`
- ✅ **Module FEDate** porté en Haxe (subset utile): `packages/core-haxe/src/frutiparc/core/FEDate.hx`
- ✅ **Module FEObject** porté en Haxe (subset utile): `packages/core-haxe/src/frutiparc/core/FEObject.hx`
- ✅ **Module Pref** porté en Haxe (noyau métier): `packages/core-haxe/src/frutiparc/core/Pref.hx`
- ✅ **Module RunDate** porté en Haxe (noyau métier): `packages/core-haxe/src/frutiparc/core/RunDate.hx`
- ✅ Base transitoire `Slot` introduite: `packages/core-haxe/src/frutiparc/core/SlotBase.hx`
- ✅ Miroirs runtime JS ajoutés pour intégration immédiate Node:
  - `packages/core-js/src/feColor.js`
  - `packages/core-js/src/window.js`
  - `packages/core-js/src/fecmItem.js`
  - `packages/core-js/src/slotBase.js`
  - `packages/core-js/src/desktop.js`
  - `packages/core-js/src/cbeeLc.js`
  - `packages/core-js/src/feString.js`
  - `packages/core-js/src/feNumber.js`
  - `packages/core-js/src/feDate.js`
  - `packages/core-js/src/feObject.js`
  - `packages/core-js/src/pref.js`
  - `packages/core-js/src/runDate.js`
- ✅ Tests de parité ajoutés:
  - `tests/migration/feColor.spec.js`
  - `tests/migration/window.spec.js`
  - `tests/migration/fecmItem.spec.js`
  - `tests/migration/desktop.spec.js`
  - `tests/migration/cbeeLc.spec.js`
  - `tests/migration/feString.spec.js`
  - `tests/migration/feNumber.spec.js`
  - `tests/migration/feDate.spec.js`
  - `tests/migration/feObject.spec.js`
  - `tests/migration/pref.spec.js`
  - `tests/migration/runDate.spec.js`

## Commandes de test

```bash
node --test tests/migration/feColor.spec.js tests/migration/window.spec.js tests/migration/fecmItem.spec.js tests/migration/desktop.spec.js tests/migration/cbeeLc.spec.js tests/migration/feString.spec.js tests/migration/feNumber.spec.js tests/migration/feDate.spec.js tests/migration/feObject.spec.js tests/migration/pref.spec.js tests/migration/runDate.spec.js
```

## Prochain module recommandé

Pour poursuivre, le prochain module conseillé est `frutiengine/Lang.as`.
