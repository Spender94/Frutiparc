# Avancement Lot A (Haxe -> TypeScript)

## État actuel

- ✅ **Module FEColor** porté en Haxe: `packages/core-haxe/src/frutiparc/core/FEColor.hx`
- ✅ **Module Window** porté en Haxe: `packages/core-haxe/src/frutiparc/core/Window.hx`
- ✅ **Module FECMItem** porté en Haxe: `packages/core-haxe/src/frutiparc/core/FECMItem.hx`
- ✅ **Module Desktop** porté en Haxe: `packages/core-haxe/src/frutiparc/core/Desktop.hx`
- ✅ **Module CBeeLC** porté en Haxe: `packages/core-haxe/src/frutiparc/core/CBeeLC.hx`
- ✅ **Module FEString** porté en Haxe (subset pragmatique + `formatVars`): `packages/core-haxe/src/frutiparc/core/FEString.hx`
- ✅ **Module FENumber** porté en Haxe (subset utile): `packages/core-haxe/src/frutiparc/core/FENumber.hx`
- ✅ **Module FEDate** porté en Haxe (subset utile): `packages/core-haxe/src/frutiparc/core/FEDate.hx`
- ✅ **Module FEObject** porté en Haxe (subset utile): `packages/core-haxe/src/frutiparc/core/FEObject.hx`
- ✅ **Module Pref** porté en Haxe (noyau métier): `packages/core-haxe/src/frutiparc/core/Pref.hx`
- ✅ **Module RunDate** porté en Haxe (noyau métier): `packages/core-haxe/src/frutiparc/core/RunDate.hx`
- ✅ **Module Lang** porté en Haxe (noyau formatage): `packages/core-haxe/src/frutiparc/core/Lang.hx`
- ✅ **Module MD5** porté en Haxe: `packages/core-haxe/src/frutiparc/core/MD5.hx`
- ✅ **Module HTTP** porté en Haxe (queue + callback orchestration): `packages/core-haxe/src/frutiparc/core/HTTP.hx`
- ✅ **Module FileLoader** porté en Haxe (état + événements): `packages/core-haxe/src/frutiparc/core/FileLoader.hx`
- ✅ **Module FEMCLoader** porté en Haxe (déduplication de chargements): `packages/core-haxe/src/frutiparc/core/FEMCLoader.hx`
- ✅ **Module FFileMng** porté en Haxe (arbre et parsing XML): `packages/core-haxe/src/frutiparc/core/FFileMng.hx`
- ✅ **Module UserMng** porté en Haxe (helpers XP/profil + état utilisateur): `packages/core-haxe/src/frutiparc/core/UserMng.hx`
- ✅ **Module UserListMng** porté en Haxe (gestion liste utilisateurs + listeners paginés): `packages/core-haxe/src/frutiparc/core/UserListMng.hx`
- ✅ **Module StatusMng** porté en Haxe (encodage/décodage statut + émission cnx): `packages/core-haxe/src/frutiparc/core/StatusMng.hx`
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
  - `packages/core-js/src/lang.js`
  - `packages/core-js/src/md5.js`
  - `packages/core-js/src/http.js`
  - `packages/core-js/src/fileLoader.js`
  - `packages/core-js/src/femcLoader.js`
  - `packages/core-js/src/fFileMng.js`
  - `packages/core-js/src/userMng.js`
  - `packages/core-js/src/userListMng.js`
  - `packages/core-js/src/statusMng.js`
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
  - `tests/migration/lang.spec.js`
  - `tests/migration/md5.spec.js`
  - `tests/migration/http.spec.js`
  - `tests/migration/fileLoader.spec.js`
  - `tests/migration/femcLoader.spec.js`
  - `tests/migration/fFileMng.spec.js`
  - `tests/migration/userMng.spec.js`
  - `tests/migration/userListMng.spec.js`
  - `tests/migration/statusMng.spec.js`

## Commandes de test

```bash
node --test tests/migration/feColor.spec.js tests/migration/window.spec.js tests/migration/fecmItem.spec.js tests/migration/desktop.spec.js tests/migration/cbeeLc.spec.js tests/migration/feString.spec.js tests/migration/feNumber.spec.js tests/migration/feDate.spec.js tests/migration/feObject.spec.js tests/migration/pref.spec.js tests/migration/runDate.spec.js tests/migration/lang.spec.js tests/migration/md5.spec.js tests/migration/http.spec.js tests/migration/fileLoader.spec.js tests/migration/femcLoader.spec.js tests/migration/fFileMng.spec.js tests/migration/userMng.spec.js tests/migration/userListMng.spec.js tests/migration/statusMng.spec.js
```

## Prochain module recommandé

Pour poursuivre, le prochain module conseillé est `frutiengine/SlotList.as`.
