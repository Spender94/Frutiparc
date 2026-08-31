'use strict';
/*
 * LE BUREAU SE RANGE, LES CONTACTS ONT LEUR VISAGE, LES ICÔNES LA MÊME TAILLE.
 *
 * Trois demandes d'un même passage, et trois défauts qui se voyaient tous du
 * premier coup d'œil sur le bureau :
 *
 *   1. Un bureau remué pendant des mois restait en désordre. On garde tout ce
 *      qui y est posé — frutiz, disques, dossiers — mais la DISPOSITION repart
 *      de la grille à chaque connexion.
 *
 *   2. Les bouilles du carnet et de la liste noire s'affichaient en « sac à
 *      patates », à demi transparentes. Deux causes : le serveur ne donnait la
 *      bouille qu'aux comptes CHARGÉS EN MÉMOIRE, et la feuille pâlissait les
 *      absents.
 *
 *   3. Trois tuiles de la rangée — contacts, liste noire, corbeille —
 *      retombaient sur la contrainte générique de 42 px et ressortaient d'un
 *      bon tiers plus grosses que leurs voisines.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.css'), 'utf8');
const JS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.js'), 'utf8');

/* ── 1. LE RANGEMENT ──────────────────────────────────────────────────────── */

// `rangerBureau` sort du fichier livré et tourne sur un bureau en carton : on
// veut son EFFET, pas sa forme.
function chargerRangerBureau(bureau) {
  const debut = SRV.indexOf('function rangerBureau(username, user) {');
  assert.ok(debut >= 0, 'rangerBureau introuvable dans server.js');
  const fin = SRV.indexOf('\n}\n', debut);
  const corps = SRV.slice(debut, fin + 2);
  const persistes = [];
  // eslint-disable-next-line no-new-func
  const faire = new Function('ensureDesktopItems', 'desktopPersist',
    corps + '\nreturn rangerBureau;')(
    () => bureau, (u) => persistes.push(u));
  return { faire, persistes };
}

test('ranger un bureau : on garde TOUT, on n’oublie que les places', () => {
  const bureau = [
    { u: 'alice', t: 'contact', x: 300, y: 40 },
    { u: 'snake3', t: 'disc', x: 12, y: 200 },
    { u: 'mesTrucs', t: 'folder' },                 // déjà sans place
    { u: 'chat', t: 'tuile', x: 500, y: 500 },      // une rubrique déplacée
  ];
  const { faire, persistes } = chargerRangerBureau(bureau);
  assert.strictEqual(faire('alice', {}), true, 'il y avait à ranger');
  // Les OBJETS restent, tous, et dans leur ordre : c'est lui qui décide de la
  // case que `getNextAvailablePos` leur donnera, donc la disposition est stable
  // d'un rechargement à l'autre.
  assert.deepStrictEqual(bureau.map((o) => o.u), ['alice', 'snake3', 'mesTrucs']);
  // Plus une seule coordonnée : `dessinerObjetsBureau` les redistribue.
  assert.ok(bureau.every((o) => o.x === undefined && o.y === undefined),
    'aucune place ne survit : ' + JSON.stringify(bureau));
  // La tuile de rubrique, elle, retourne dans sa rangée — l'absence d'entrée
  // vaut « à sa place native » (cf. `reposerTuiles`).
  assert.deepStrictEqual(persistes, ['alice'], 'le rangement est écrit une fois');
});

test('un bureau déjà rangé n’est pas réécrit', () => {
  const bureau = [{ u: 'alice', t: 'contact' }, { u: 'snake3', t: 'disc' }];
  const { faire, persistes } = chargerRangerBureau(bureau);
  assert.strictEqual(faire('alice', {}), false);
  assert.deepStrictEqual(persistes, [], 'rien à écrire, rien d’écrit');
});

test('le rangement se fait UNE FOIS PAR SESSION, pas à chaque lecture', () => {
  /* En cours de session, déplacer une icône la garde où on l'a mise —
     rechargement compris. C'est la prochaine CONNEXION qui remet au carré :
     sans ce garde-fou, une icône déplacée reprenait sa case au premier
     rafraîchissement, et le glisser-déposer ne servait plus à rien. */
  assert.match(SRV, /const bureauxRanges = new Set\(\);/);
  assert.match(SRV, /if \(sid && !bureauxRanges\.has\(sid\)\) \{\s*\n\s*bureauxRanges\.add\(sid\);/);
  // Le jeu de sessions ne grossit pas sans fin.
  assert.match(SRV, /if \(bureauxRanges\.size > 5000\) bureauxRanges\.clear\(\);/);
  // Et c'est bien la LECTURE du bureau qui le déclenche, pas une route à part.
  const route = SRV.slice(SRV.indexOf("app.get('/api/light/bureau/objets'"),
    SRV.indexOf("app.post('/api/light/bureau/objets'"));
  assert.match(route, /rangerBureau\(username, user\)/);
});

test('reposerTuiles : une tuile sans place retrouve sa rangée', () => {
  // Le rangement efface les entrées de tuile ; côté client, l'absence d'entrée
  // laisse la tuile où la grille la met. Rien à « remettre », donc.
  const r = JS.slice(JS.indexOf('function reposerTuiles(grille, bureau)'),
    JS.indexOf('function rendreIconesDeplacables'));
  assert.match(r, /for \(var go in tuilesPosees\)/);
  assert.match(r, /var t = grille\.querySelector\('\.home-tile\[data-go="' \+ go \+ '"\]'\)/);
  assert.match(r, /if \(!t\) continue;/);
});

/* ── 2. LES BOUILLES DU CARNET ────────────────────────────────────────────── */

test('un contact ABSENT a quand même son visage', () => {
  /* `UserSlot` tient la bouille de `onStatusObj` et la passe telle quelle à
     `createDragIcon`. On ne la donnait qu'aux comptes présents en mémoire —
     ceux connectés depuis le démarrage du serveur : un carnet de trente
     contacts n'en montrait que trois ou quatre vrais visages, les autres
     tombant sur la bouille par défaut. `bouilleOf` sait pourtant se rabattre
     sur `bouilleCache`, que le démarrage remplit depuis la base. */
  const route = SRV.slice(SRV.indexOf("app.get('/api/light/contacts'"),
    SRV.indexOf("app.get('/api/light/contacts'") + 4000);
  assert.match(route, /const compte = users\[local\] \|\| users\[getDisplayName\(local\)\] \|\| null;/);
  assert.match(route, /o\.bouille = bouilleOf\(compte, String\(local\)\.toLowerCase\(\)\);/);
  assert.doesNotMatch(route, /if \(compte\) o\.bouille =/,
    'plus de bouille conditionnée à la présence en mémoire');
});

test('le raccourci de bureau d’un contact suit la même règle', () => {
  const f = SRV.slice(SRV.indexOf('function bureauObjetEnrichi(user, it)'),
    SRV.indexOf('\n}\n', SRV.indexOf('function bureauObjetEnrichi(user, it)')));
  assert.match(f, /const compte = users\[local\] \|\| users\[getDisplayName\(local\)\] \|\| null;/);
  assert.match(f, /desc: \[adresse, bouilleOf\(compte, String\(local\)\.toLowerCase\(\)\)\]/);
});

test('une bouille ne s’éteint pas : la présence se lit sur la PASTILLE', () => {
  // `but.Icon.display` remplace l'icône d'un contact par sa frutibouille et
  // n'y touche plus. Le portage pâlissait les absents à 55 %.
  assert.doesNotMatch(CSS,
    /\.ex-slot-contact:not\(\.en-ligne\) \.ex-bouille \{ opacity: \.55; \}/);
  assert.match(CSS, /UNE BOUILLE NE S'ÉTEINT PAS/);
});

test('un dossier du bureau porte le dossier jaune, pas une image morte', () => {
  // « ico_folder » n'existe dans aucune feuille : l'image ne se chargeait pas
  // et un dossier posé sur le bureau n'avait aucun dessin.
  assert.match(JS, /if \(o\.type === 'folder'\) return dessinStandard\('ico_dossier_default'\);/);
  assert.doesNotMatch(JS, /dessinStandard\('ico_folder'\)/);
  const sprites = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'public/frutiz/sprites/explorateur.json'), 'utf8'));
  const noms = Array.isArray(sprites) ? sprites.map((s) => s.nom || s.name)
    : Object.keys(sprites.pieces || sprites);
  assert.ok(noms.includes('ico_dossier_default'),
    'le dessin demandé existe bien dans la feuille');
});

/* ── 3. LA TAILLE DES TUILES ──────────────────────────────────────────────── */

test('les trois dossiers de la rangée ont la taille de leurs voisins', () => {
  /* Leurs dessins sortent de la même feuille que le courrier et l'historique
     (`fileIcon.swf`, `ico_dossier_*`) et suivent donc la même règle : 0,60 de
     leur taille native. Sans contrainte propre ils retombaient sur le 42 × 42
     générique, et devenaient les trois plus grosses icônes de la rangée. */
  const regle = (go) => new RegExp(
    'home-tile\\[data-go="' + go + '"\\]\\s*\\.ico img \\{ max-width: (\\d+)px; max-height: (\\d+)px; \\}');
  const lire = (go) => {
    const m = regle(go).exec(CSS);
    assert.ok(m, 'pas de contrainte pour « ' + go + ' »');
    return [Number(m[1]), Number(m[2])];
  };
  assert.deepStrictEqual(lire('contacts'), [35, 26]);
  assert.deepStrictEqual(lire('noire'), [31, 35]);
  assert.deepStrictEqual(lire('corbeille'), [31, 35]);
  // Aucune ne dépasse les tuiles déjà réglées de la rangée.
  const bornes = ['courrier', 'chat', 'scores', 'shop', 'trombi']
    .map((go) => { const m = regle(go).exec(CSS); return m ? Number(m[1]) : 0; })
    .filter(Boolean);
  const max = Math.max(...bornes);
  for (const go of ['contacts', 'noire', 'corbeille']) {
    assert.ok(lire(go)[0] <= max, go + ' reste dans la rangée');
  }
});
