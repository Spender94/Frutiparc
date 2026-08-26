'use strict';
/*
 * LE GLISSER-DÉPOSER VERS LE BUREAU (mode Frutiz du light)
 *
 * D'époque le bureau est un DOSSIER comme un autre. `FPDesktop` s'abonne à
 * `fileMng` sur l'uid « root » et tient sa liste d'`IconFileBox` ; y déposer
 * quelque chose passe par `onDrop` :
 *
 *     si l'uid est déjà dans ma liste  → on le REPOSITIONNE
 *     sinon si ico.uid == "new"        → fileMng.make(ico, "root", {pos})
 *     sinon si Key.isDown(17)          → fileMng.copy(…)     ← Ctrl = copier
 *     sinon                            → fileMng.move(…)
 *
 * Le geste lui-même a deux formes selon d'où l'on tire. Un FICHIER passe par
 * `IconFileBox.pressIcon`, qui arme un contrôle toutes les 25 ms et n'appelle
 * `createDragIcon` qu'au-delà de `dragDistMin = 4`. Un CONTACT du carnet, lui,
 * n'a pas de seuil : `UserSlot.initButtons` branche `createDragIcon` sur
 * `onDragOut`, et ce qu'il emporte porte l'uid « new » — d'où la création.
 *
 * La grille est celle de `cp.DragIconList` : `gridSpace = icon.size.large + 4`
 * (84), marge 18/12, `getNextAvailablePos` en balayage ligne par ligne,
 * `updateIcons` qui pose `_x = pos.x` sans animation.
 *
 * Côté serveur, le revival tenait DÉJÀ ce bureau pour le client Flash —
 * `user.desktopItems`, que `/ff/mv` remplit et que `desktopNodesXml` sert en
 * XML. Le mode Frutiz du light lit et écrit LE MÊME : un disque posé depuis le
 * light quitte « Mes disques » côté Flash aussi. Un objet, une place.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const JS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.css'), 'utf8');
const SRV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

test('le bureau reçoit ce qui n’a pas trouvé de dropBox', () => {
  // `listener.dragIconMouse.onMouseUp` : sans cible porteuse d'un `dropBox`,
  // c'est `desktop.onDrop` qui est appelé.
  assert.match(JS, /quoi === 'bureau' \|\| \(!boite && surLeBureau\(cible\)\)\) pris = deposerSurBureau/);
  assert.match(JS, /function surLeBureau\(el\) \{[\s\S]*?closest\('#bureau'\)[\s\S]*?!el\.closest\('\.fen'\)/);
  assert.match(JS, /bureau\.setAttribute\('data-depot', 'bureau'\);/);
});

test('les trois branches d’onDrop, Ctrl compris', () => {
  // Déjà du bureau → on repositionne, et rien d'autre.
  assert.match(JS, /var dedans = info\.uid && trouverObjet\(info\.uid\);\s*\n\s*if \(dedans && !ctrl\) \{/);
  assert.match(JS, /ecrireObjetBureau\(\{ action: 'move', uid: dedans\.uid, parent: 'root', pos: dedans\.pos \}\)/);
  // `Key.isDown(17)` : la touche Ctrl est relue à chaque pas et au lâcher.
  assert.match(JS, /glisseur\.ctrl = !!\(e\.ctrlKey \|\| e\.metaKey\);/);
  assert.match(JS, /var ctrl = glisseur\.ctrl;\s+\/\/ `Key\.isDown\(17\)`/);
});

test('la grille de cp.DragIconList : 84, marge 18/12, balayage ligne par ligne', () => {
  assert.match(JS, /var GRILLE_PAS = 84;\s+\/\/ icon\.size\.large \(80\) \+ 4/);
  assert.match(JS, /var GRILLE_MX = 18, GRILLE_MY = 12;/);
  // `getNextAvailablePos` : y à l'extérieur, x à l'intérieur.
  const libre = /function caseLibreBureau\(parent\) \{[\s\S]*?\n  \}/.exec(JS)[0];
  assert.match(libre, /for \(var y = 0; y < yMax; y\+\+\) \{\s*\n\s*for \(var x = 0; x < xMax; x\+\+\)/);
  // `fitInGrid` : hors cadre, on revient par pas ENTIERS de gridSpace.
  const ranger = /function rangerDansGrille\(pos, parent\) \{[\s\S]*?\n  \}/.exec(JS)[0];
  assert.match(ranger, /while \(x > \(xMax - 1\) \* GRILLE_PAS\) x -= GRILLE_PAS;/);
  assert.match(ranger, /while \(y > \(yMax - 1\) \* GRILLE_PAS\) y -= GRILLE_PAS;/);
});

test('un contact du carnet part sur onDragOut, sans seuil, avec l’uid « new »', () => {
  const attraper = /function attraperContact\(b, c\) \{[\s\S]*?\n  \}/.exec(JS)[0];
  // Pas de `dragDistMin` ici : on part dès que le curseur QUITTE le bouton.
  assert.doesNotMatch(attraper, /DIST_MIN_GLISSER/);
  assert.match(attraper, /if \(e\.clientX >= boite\.left && e\.clientX <= boite\.right/);
  assert.match(attraper, /uid: 'new', type: 'contact',/);
  assert.match(attraper, /desc: \[c\.pseudo \+ '@frutiparc\.com', c\.bouille \|\| ''\]/);
  // Le slot RESTE en place — c'est un raccourci qu'on crée, pas un déménagement.
  assert.match(attraper, /glisseur\.source = null;\s+\/\/ le slot RESTE en place/);
  // Et le serveur donne la bouille du contact, comme `onStatusObj` d'époque.
  assert.match(SRV, /if \(compte\) o\.bouille = bouilleOf\(compte, local\);/);
});

test('un fichier, lui, attend d’avoir bougé de plus de dragDistMin', () => {
  assert.match(JS, /var DIST_MIN_GLISSER = 4;\s+\/\/ IconFileBox\.dragDistMin/);
  assert.match(JS, /if \(d <= DIST_MIN_GLISSER\) return;/);
  assert.match(JS, /el\.style\.visibility = 'hidden'; *\/\/ `path\._visible = false`/);
});

test('le raccourci : bouille pour un contact, jaquette pour un disque, sans étiquette', () => {
  // `but.Icon.display` : un contact devient un `frutibouille`, `icoRatio` 1.
  assert.match(JS, /function dessinObjet\(o\) \{[\s\S]*?if \(o\.type === 'disc'\) return dessinDisque/);
  assert.match(JS, /return dessinBouille\(o\.desc\[1\] \|\| ''\);/);
  // `but.icon.Full` ne met pas d'étiquette sur un disque.
  assert.match(JS, /if \(o\.type !== 'disc'\) \{\s+\/\/ `but\.icon\.Full` ne met pas d'étiquette/);
  // La case fait 80, le dessin 37 (r4), l'étiquette la moitié basse.
  assert.match(CSS, /\.fb-raccourci \{[\s\S]*?width: 80px; height: 80px;/);
  assert.match(CSS, /\.fb-raccourci \.ex-bouille \{ width: 37px; height: 37px; \}/);
  assert.match(CSS, /\.fb-raccourci \.fb-r-lbl \{[\s\S]*?top: 41px; width: 74px;/);
  // Le disque : 63 px de côté, 7 sous le haut de la case.
  assert.match(CSS, /\.fb-raccourci \.ex-disque \{[\s\S]*?top: 7px;[\s\S]*?width: 63px; height: 63px;/);
});

test('le clic : la fiche pour un contact, RIEN pour un disque', () => {
  const racc = /function raccourciBureau\(o\) \{[\s\S]*?\n    return d;\n  \}/.exec(JS)[0];
  assert.match(racc, /if \(o\.type === 'contact'\) ouvrirFiche\(o\.name \|\| o\.desc\[0\]\);/);
  assert.match(racc, /else if \(o\.type === 'folder'\) ouvrirDossierBureau\(o\);/);
  // Aucune branche pour « disc » : d'époque `openFunctions.as` a la sienne en
  // commentaire, et le clic d'un disque ne fait rien.
  assert.doesNotMatch(racc, /o\.type === 'disc'\) *(?:ouvrir|lancer|jouer)/);
  // Et le clic de FIN DE GESTE n'ouvre rien (`IconFileBox.dragEnd`).
  assert.match(racc, /if \(Date\.now\(\) - dernierDepot < 250\) \{ ev\.stopPropagation\(\); return; \}/);
  assert.match(JS, /if \(pris\) \{\s*\n\s*dernierDepot = Date\.now\(\);/);
});

test('le serveur partage LE MÊME bureau que le client Flash', () => {
  // Pas de second magasin : on lit et on écrit `user.desktopItems`.
  assert.match(SRV, /app\.get\('\/api\/light\/bureau\/objets'/);
  assert.match(SRV, /app\.post\('\/api\/light\/bureau\/objets'/);
  assert.match(SRV, /const objets = ensureDesktopItems\(user\)\s*\n\s*\.map\(\(it\) => bureauObjetEnrichi\(user, it\)\)/);
  assert.match(SRV, /desktopAdd\(username, user, uid, type, pos, \{ parent \}\);/);
  // La POSITION, que le modèle d'origine ne retenait pas.
  assert.match(SRV, /if \(Number\.isFinite\(x\) && Number\.isFinite\(y\) && x >= 0 && y >= 0 && x < 4000 && y < 4000\)/);
  // Un disque posé quitte « Mes disques » : c'est déjà ce que fait le
  // catalogue, et il le fait sur la même liste.
  assert.match(SRV, /if \(desktopHasDisc\(user, id\)\) continue;/);
  // Le client Flash ne voit ni les dossiers du portage ni ce qu'ils tiennent.
  assert.match(SRV, /if \(it\.p \|\| it\.t === 'folder'\) continue;/);
});

test('un dossier du bureau est un dropBox, et jeter un dossier emporte son contenu', () => {
  // `IconFileBox.onDrop` : si je suis un dossier, la cible c'est MON uid.
  assert.match(JS, /if \(o\.type === 'folder'\) \{ d\.setAttribute\('data-depot', 'dossier'\); \}/);
  assert.match(JS, /else if \(quoi === 'dossier'\) pris = deposerDansDossier\(info, boite\.getAttribute\('data-uid'\)\);/);
  // Un dossier ne se range pas dans lui-même.
  assert.match(JS, /if \(dedans\.uid === uid\) return false; *\/\/ un dossier dans lui-même/);
  assert.match(SRV, /if \(uid === parent\) return res\.status\(400\)\.json\(\{ ok: false, error: 'boucle' \}\);/);
  // `fileMng.remove` descend l'arbre.
  assert.match(SRV, /function desktopRemoveTree\(username, user, uid\) \{[\s\S]*?it\.u !== u && it\.p !== u/);
});

test('rien de tout cela ne touche le mobile', () => {
  // Chaque règle ajoutée reste sous `body.bureau-frutiz`.
  const debut = CSS.indexOf('LES RACCOURCIS DU BUREAU');
  assert.ok(debut > 0, 'le bloc des raccourcis manque');
  const bloc = CSS.slice(debut);
  const mauvaises = [...bloc.matchAll(/^([.#a-zA-Z][^{\n]*)\{/gm)]
    .map((m) => m[1].trim())
    .filter((s) => !/^body\.bureau-frutiz/.test(s) && !/^@/.test(s));
  assert.deepStrictEqual(mauvaises, [], 'des règles échappent au cloisonnement mobile');
  // Et le light n'a pas été touché pour cette fonction.
  const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
  assert.doesNotMatch(LIGHT, /fb-raccourci|deposerSurBureau|GRILLE_PAS/);
});
