'use strict';
/*
 * LES STATUTS D'ABSENCE — `/status away`, `phone`, `zzz`, `work`, `eat`
 * ════════════════════════════════════════════════════════════════════
 *
 * Une chaîne de statut tient sur QUATRE caractères en base 62 — `StatusMng
 * .send` (main.swf 0x33eb0) les empile dans cet ordre :
 *
 *     [external ×1][internal ×2][emote ×1]
 *
 * et `StatusMng.analyseStr` (0x33b53) les relit non pas en index mais en NOMS,
 * par deux tables du script :
 *
 *     externalList = [ ∅, eat, work, zzz, phone, away ]
 *     internalList = [ ∅, forum, bkiwi, mb2, swapou2, snake3, bandas,
 *                      grapiz, kaluga, miniwave ]     (+ minipixiz, minifever)
 *
 * L'AFFICHAGE, lui, est un seul clip à trois étiquettes — `status` (#253),
 * dont `UserSlot.display` (0xc8241) choisit l'image :
 *
 *     internal défini  →  icon.gotoAndStop("internal") ; icon.ico.gotoAndStop(nom)
 *     external défini  →  icon.gotoAndStop("external") ; icon.ico.gotoAndStop(nom)
 *     sinon            →  icon.gotoAndStop("presence") ; icon.ico.gotoAndStop(présence+1)
 *
 * DANS CET ORDRE : une partie l'emporte sur une absence, une absence sur la
 * pastille. Et comme `analyseStr` rend des noms, les `gotoAndStop` visent des
 * ÉTIQUETTES — celles de la bande #252, qui porte les cinq dessins :
 * away = 1, zzz = 2, phone = 3, eat = 4, work = 5. L'ordre des images ne dit
 * donc RIEN de l'index du fil, et c'est pour cela qu'on sort les dessins par
 * étiquette (scripts/extract-statuts-absence.js).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SERVEUR = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const LIGHT = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
const BUREAU = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.js'), 'utf8');
const EX = fs.readFileSync(path.join(ROOT, 'scripts/extract-statuts-absence.js'), 'utf8');

const NOMS = ['away', 'phone', 'zzz', 'work', 'eat'];

test('les cinq dessins sortent de la bande #252, PAR ÉTIQUETTE', () => {
  assert.match(EX, /const BANDE = 252;/);
  assert.match(EX, /const STATUTS = \['away', 'phone', 'zzz', 'work', 'eat'\];/);
  // Par étiquette, pas par numéro d'image : c'est `analyseStr` qui rend un nom.
  assert.match(EX, /const image = etiquettes\[nom\];/);
  assert.match(EX, /throw new Error\('étiquette absente du clip ' \+ BANDE/);
  for (const n of NOMS) {
    const p = path.join(ROOT, 'public/fb/statut_' + n + '.png');
    assert.ok(fs.existsSync(p), 'statut_' + n + '.png manque');
    assert.ok(fs.statSync(p).size > 400, 'statut_' + n + '.png est vide');
  }
});

test('le serveur traduit l’index du fil en nom, et le publie', () => {
  // La table d'index, lue dans le bytecode (InitArray à l'envers).
  assert.match(SERVEUR, /const STATUS_EXTERNAL_INDEX = \{\s*\n\s*away: 5, phone: 4, zzz: 3, work: 2, eat: 1,\s*\n\s*\};/);
  // Et son miroir : c'est un NOM que le client attend, comme le bureau.
  assert.match(SERVEUR, /const STATUS_EXTERNAL_NAME = Object\.fromEntries\(\s*\n\s*Object\.entries\(STATUS_EXTERNAL_INDEX\)\.map\(\(\[nom, i\]\) => \[i, nom\]\)\);/);
  assert.match(SERVEUR, /function statusExternalOf\(username\) \{/);
  assert.match(SERVEUR, /return STATUS_EXTERNAL_NAME\[decode62\(String\(cl\.statusStr\)\.substring\(0, 1\)\)\] \|\| '';/);
  // Les trois listes servies en HTTP le portent : la fiche, le carnet, et
  // « tout le site ».
  const publications = (SERVEUR.match(/statusExternalOf\(/g) || []).length;
  assert.ok(publications >= 4, 'la fiche, le carnet et les connectés doivent le publier');
  assert.match(SERVEUR, /const absence = enLigne \? statusExternalOf\(u\) : '';/);
  assert.match(SERVEUR, /\n\s*jeu,\n\s*absence,/, 'la fiche publie les deux');
});

test('la commande accepte les mots français comme les anglais', () => {
  assert.match(SERVEUR, /const m = text\.match\(\/\^\\\/\(\?:status\|statut\)\\s\+\(\\S\+\)\\s\*\$\/i\);/);
  // Les synonymes : `boulot` vaut `work`, `dodo` vaut `zzz`, `off` efface.
  for (const [mot, canon] of [['boulot', 'work'], ['dodo', 'zzz'], ['tel', 'phone'],
    ['manger', 'eat'], ['absent', 'away']]) {
    assert.match(SERVEUR, new RegExp(mot + ": '" + canon + "'"), mot + ' → ' + canon);
  }
  assert.match(SERVEUR, /off: '', dispo: '', online: '', none: '',/);
  // Un mot inconnu ne change rien et le dit.
  assert.match(SERVEUR, /Statut inconnu\. Valeurs : away, phone, zzz, work, eat — ou off pour effacer\./);
  // Et l'aide de Gaspard le mentionne : une commande qu'on ne peut pas
  // découvrir n'existe qu'à moitié.
  assert.match(SERVEUR, /\/status away<\/i>, <i>phone<\/i>, <i>zzz<\/i>, <i>work<\/i>, <i>eat<\/i>/);
});

test('le mobile lit le PREMIER caractère et pose l’icône à la place du point', () => {
  assert.match(LIGHT, /var STATUTS_ABSENCE = \{ 1: "eat", 2: "work", 3: "zzz", 4: "phone", 5: "away" \};/);
  assert.match(LIGHT, /function absenceUrl\(nom\) \{ return "\/fb\/statut_" \+ nom \+ "\.png"; \}/);
  // Il arrive par la même trame que le voyant de jeu : `<z>`, `<v>`, `<k>`.
  assert.match(LIGHT, /var abs = STATUTS_ABSENCE\[decode62\(String\(s\)\.substring\(0, 1\)\)\] \|\| "";/);
  assert.match(LIGHT, /state\.absenceByUser\[cle\] = abs;/);
  assert.match(LIGHT, /if \(avantAbs !== abs && drawerVue === "salon"\) renderUsers\(\);/);
  // L'ORDRE de `UserSlot.display` : le jeu d'abord, l'absence ensuite.
  assert.match(LIGHT, /\} else if \(abs && STATUTS_NOM\[abs\]\) \{\s*\n\s*var va = el\("img", "voyant"\);/);
  // La fiche suit la même règle.
  assert.match(LIGHT, /var absFiche = \(d && d\.absence\) \|\| "";/);
  assert.match(LIGHT, /\} else if \(absFiche && STATUTS_NOM\[absFiche\]\) \{/);
  assert.match(LIGHT, /st\.src = absenceUrl\(absFiche\);/);
  // La recherche reçoit la chaîne entière : elle sait la lire aussi.
  assert.match(LIGHT, /absence: st \? \(STATUTS_ABSENCE\[decode62\(String\(st\)\.substring\(0, 1\)\)\] \|\| ""\) : "",/);
});

test('le bureau le montre au carnet et dans la recherche', () => {
  assert.match(BUREAU, /function absenceUrl\(nom\) \{ return '\/fb\/statut_' \+ nom \+ '\.png'; \}/);
  assert.match(BUREAU, /var ABSENCE_NOM = \{ away: 'Absent', phone: 'Au téléphone', zzz: 'Dort',\s*\n\s*work: 'Au travail', eat: 'À table' \};/);
  // Le carnet : le jeu passe devant, l'absence vient ensuite, et hors ligne
  // rien du tout — une socket fermée n'a pas d'humeur.
  assert.match(BUREAU, /var absence = \(c\.enLigne && !c\.jeu && ABSENCE_NOM\[c\.absence\]\) \? c\.absence : '';/);
  assert.match(BUREAU, /\+ \(c\.jeu \? voyantUrl\(c\.jeu\) : absenceUrl\(absence\)\) \+ "'\), "/);
  // La recherche : la même règle, sur son propre voyant.
  assert.match(BUREAU, /\} else if \(info\.presence !== 0 && ABSENCE_NOM\[info\.absence\]\) \{/);
  assert.match(BUREAU, /ico\.src = absenceUrl\(info\.absence\);/);
});
