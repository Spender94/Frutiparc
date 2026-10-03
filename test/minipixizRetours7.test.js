/*
 * Le septième lot de retours MiniPixiz : la clairière et le sac.
 *
 *   · « L'animation étoile … elle est pas là quand t'accède au sac. » Le sac
 *     s'ouvre et se referme maintenant dans l'iris de Manager.fadeSlot, comme
 *     les autres lieux (le bassin l'avait déjà, à l'aller et au retour).
 *   · « Une fois qu'on t'affiche un message sur la vue de base … il faut que
 *     tu le fasses disparaître à clic/accès à un autre endroit. »
 *   · Le sac : l'infobulle du bouton des volets, « Prochain niveau : … » sur
 *     les volets des caractéristiques et des sortilèges (surprise après le
 *     niveau 15), la main qui suit la souris (inv/Hand.mt), la fée qui entre
 *     et sort de son bocal touche enfoncée au bureau (inv/Slot.click), la
 *     phrase du bocal habité (it/Flask.getDesc, Lang.FLASK_ACTION), et le
 *     retour à la clairière dans l'étoile.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const lire = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

globalThis.MinipixizFee = require(path.join(ROOT, 'public/minipixiz/faerie.js'));
globalThis.MinipixizSorts = require(path.join(ROOT, 'public/minipixiz/sorts.js'));
const I = require(path.join(ROOT, 'public/minipixiz/inventaire.js'));
const M = require(path.join(ROOT, 'public/minipixiz/menu.js'));
const PAGE = lire('public/minipixiz/index.html');

// Un inventaire sans canevas : les méthodes de texte n'en ont pas besoin.
function sac(carte, volet) {
  const inv = Object.create(I.Inventaire.prototype);
  inv.plateforme = { carte };
  inv.volet = volet || 0;
  inv.main = null;
  inv.glisse = null;
  inv.survol = null;
  return inv;
}

// ── Prochain niveau ───────────────────────────────────────────────────────

test('« Prochain niveau » : la caractéristique et le sort préparés par la fiche', () => {
  const inv = sac({});
  const r = inv.prochainNiveau({ fs: { $level: 2, $next: [3, 12] } });
  assert.equal(r.titre, 'Prochain niveau :');
  const sort = globalThis.MinipixizSorts.nouveauSort(12, null).nom();
  assert.equal(r.message, '+1 en intelligence ou ' + sort);
  // Sans sort à portée, la caractéristique seule.
  assert.equal(inv.prochainNiveau({ fs: { $level: 2, $next: [0, null] } }).message, '+1 en force');
});

test('« Prochain niveau » : une surprise passé le niveau 15', () => {
  const inv = sac({});
  assert.equal(I.NIVEAU_SURPRISE, 15);
  // $level compte à partir de zéro : $level 14 est le niveau 15 affiché.
  // Jusque-là on annonce la suite ; au-delà du 15, c'est une surprise.
  assert.notEqual(inv.prochainNiveau({ fs: { $level: 14, $next: [1, null] } }).message, 'surprise !');
  assert.deepEqual(inv.prochainNiveau({ fs: { $level: 15, $next: [1, null] } }),
    { titre: 'Prochain niveau :', message: 'surprise !' });
  assert.equal(inv.prochainNiveau({ fs: { $level: 30, $next: null } }).message, 'surprise !');
});

test('« Prochain niveau » : seulement sur les volets des caractéristiques et des sortilèges', () => {
  const fee = { fs: { $level: 2, $next: [0, null] } };
  assert.ok(sac({}, 0).prochainNiveau(fee));
  assert.ok(sac({}, 1).prochainNiveau(fee));
  assert.equal(sac({}, 2).prochainNiveau(fee), null, 'pas sur l’équipement');
  assert.equal(sac({}, 3).prochainNiveau(fee), null, 'pas sur la santé');
  assert.equal(sac({}, 0).prochainNiveau(null), null, 'ni sans fée');
});

// ── Le bouton des volets ──────────────────────────────────────────────────

test('le bouton des volets annonce le volet SUIVANT, en infobulle', () => {
  assert.deepEqual(I.SECTION_BULLE, ['Voir les caractéristiques', 'Voir les sortilèges',
    'Voir l\'équipement', 'Voir la santé']);
  const src = lire('public/minipixiz/inventaire.js');
  assert.match(src, /this\.infobulle\(SECTION_BULLE\[\(this\.volet \+ 1\) % 4\]\)/);
});

// ── Le bocal ──────────────────────────────────────────────────────────────

test('FLASK_ACTION est celle de Lang.mt, humeur par humeur', () => {
  const src = fs.readFileSync(path.join(ROOT, 'Games/miniTroll/src/Lang.mt'), 'latin1');
  const debut = src.indexOf('FLASK_ACTION');
  const bloc = src.slice(debut, src.indexOf(']\n\t]', debut) + 4).replace(/\r/g, '');
  const humeurs = bloc.split(/\n\t\t\[/).slice(1)
    .map((h) => (h.match(/"[^"]*"/g) || []).length);
  assert.equal(I.FLASK_ACTION.length, 5);
  assert.deepEqual(I.FLASK_ACTION.map((l) => l.length), humeurs);
  assert.equal(I.FLASK_ACTION[0][0], 'pleure');
});

test('le bocal habité dit ce que fait sa locataire, au hasard de son humeur', () => {
  const carte = { $faerie: [{ $name: 'Myrtille', $level: 17, $moral: 14, $pos: 0 }] };
  const inv = sac(carte);
  const h = Math.floor((14 - 0.1) / 4);
  const vues = new Set();
  for (let i = 0; i < 40; i++) {
    const t = (i + 0.5) / 40;
    const d = inv.descBocal(0, () => t);
    assert.match(d, /^Myrtille \( niv\.18 \) .+ dans ce bocal\.$/);
    vues.add(d);
  }
  assert.equal(vues.size, I.FLASK_ACTION[h].length, 'toutes les phrases de l’humeur sortent');
  for (const a of I.FLASK_ACTION[h]) assert.ok(vues.has('Myrtille ( niv.18 ) ' + a + ' dans ce bocal.'));
});

test('un moral à zéro reste dans la première humeur (le jeu disait « undefined »)', () => {
  const inv = sac({ $faerie: [{ $name: 'Noisette', $level: 0, $moral: 0, $pos: 2 }] });
  const d = inv.descBocal(2, () => 0);
  assert.equal(d, 'Noisette ( niv.1 ) ' + I.FLASK_ACTION[0][0] + ' dans ce bocal.');
  const pleine = sac({ $faerie: [{ $name: 'Noisette', $level: 0, $moral: 99, $pos: 2 }] });
  assert.doesNotMatch(pleine.descBocal(2, () => 0.99), /undefined/);
});

test('le bocal vide explique le geste : Ctrl+clic au bureau, un simple toucher au doigt', () => {
  const d = sac({ $faerie: [] }).descBocal(1);
  assert.match(d, /Ctrl/);
  assert.match(d, /au doigt, touchez-le simplement/);
});

// ── La main et le geste de la fée ─────────────────────────────────────────

test('la main suit la souris, pas le doigt', () => {
  const inv = sac({});
  inv.main = { sac: 'joueur', case: 1 };
  inv.dernierPointeur = 'mouse';
  inv.sourisDedans = true;
  assert.equal(inv.mainSuitSouris(), true);
  inv.dernierPointeur = 'touch';
  assert.equal(inv.mainSuitSouris(), false, 'au doigt, la case reste marquée');
  inv.dernierPointeur = 'mouse';
  inv.sourisDedans = false;
  assert.equal(inv.mainSuitSouris(), false, 'souris sortie : l’objet n’a rien à suivre');
  inv.main = null;
  inv.sourisDedans = true;
  assert.equal(inv.mainSuitSouris(), false);
});

test('la fée n’entre au bocal que touche enfoncée au bureau, d’un simple toucher au doigt', () => {
  const src = lire('public/minipixiz/inventaire.js');
  assert.match(src, /this\.clicSimple = this\.dernierPointeur === 'mouse'\s*&& !\(ev\.ctrlKey \|\| ev\.metaKey \|\| this\.espace\)/);
  assert.match(src, /it\.famille === 'bocal' && !this\.clicSimple\) \{\n      return this\.bocal\(index\);/);
});

// ── La clairière : les messages et l'étoile ───────────────────────────────

test('un clic dans la clairière efface le mot dit', () => {
  const menu = Object.create(M.Menu.prototype);
  menu.touche = null;
  menu.garde = 0;
  menu.zones = [];
  menu.echelle = 1;
  menu.canvas = { getBoundingClientRect: () => ({ left: 0, top: 0 }) };
  menu.dire('Impossible de plonger dans le bassin avec une fée en liberté !');
  menu.clic({ clientX: 10, clientY: 10 });
  assert.equal(menu.message, '');
});

test('revenir à la clairière (d’une partie, du sac) efface aussi le mot', () => {
  const src = lire('public/minipixiz/menu.js');
  const demarrer = /  demarrer\(alea\) \{[\s\S]*?\n  \}/.exec(src)[0];
  assert.match(demarrer, /this\.message = '';/);
  const fermer = /function fermerSac\(\) \{[\s\S]*?\n      \}/.exec(PAGE)[0];
  assert.match(fermer, /menu\.dire\(''\)/);
  const ouvrir = /function ouvrirSac\(avecIris, x, y\) \{[\s\S]*?\n      \}/.exec(PAGE)[0];
  assert.match(ouvrir, /menu\.dire\(''\)/);
});

test('le sac s’ouvre et se referme dans l’étoile', () => {
  const ouvrir = /function ouvrirSac\(avecIris, x, y\) \{[\s\S]*?\n      \}/.exec(PAGE)[0];
  assert.match(ouvrir, /inventaire\.irisDepuis\(\$\('#menu-stage'\), x, y\)/);
  const fermer = /function fermerSac\(\) \{[\s\S]*?\n      \}/.exec(PAGE)[0];
  assert.match(fermer, /menu\.iris = new window\.MinipixizClient\.Iris\(\$\('#inv-stage'\)\)/);
  // Les trois portes du sac : le bouton, l'entrée du menu, le lieu de la clairière.
  assert.match(PAGE, /\$\('#sac-but'\)\.addEventListener\('click', function \(\) \{ ouvrirSac\(true\); \}\);/);
  assert.match(PAGE, /\$\('#menu-sac'\)\.addEventListener\('click', function \(\) \{ ouvrirSac\(true\); \}\);/);
  assert.match(PAGE, /ouvrirSac\(true, pc && pc\.x, pc && pc\.y\);/);
  // Et le bassin, à l'aller (irisVersJeu) comme au retour (ouvrirMenu).
  const bassin = /if \(lieu\.va === 'fountain'\) \{[\s\S]*?return;\n          \}/.exec(PAGE)[0];
  assert.match(bassin, /irisVersJeu\(\);/);
  assert.match(PAGE, /client\.jeu \|\| client\.lieu \|\| client\.bassin/);
});
