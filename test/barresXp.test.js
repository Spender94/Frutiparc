'use strict';
/*
 * LES NEUF BARRES D'XP DE L'ENCART — MÊME ÉPAISSEUR, MÊME ESPACEMENT.
 *
 * « Les lignes d'XP doivent toutes être de même épaisseur et même
 * espacement. »
 *
 * La mise en page, elle, était juste : relevé au banc (Chromium, dpr = 1),
 * neuf boîtes de 2 px aux ordonnées 0, 3, 6 … 24, huit écarts de 1 — ce que
 * `barLevel` (#431) demande. Le défaut ne venait pas de là.
 *
 * Il venait de l'ÉCRAN. Un pixel CSS n'est pas un pixel d'écran : à 150 % de
 * mise à l'échelle, un filet de 2 en vaut 3 et un écart de 1 en vaut 1,5. Le
 * navigateur cale alors CHAQUE boîte séparément, et l'encre reçue par période
 * alterne — relevé (bench-xp3, capture à la résolution de l'écran, encre
 * projetée sur l'axe clair → foncé, ramenée en pixels CSS) :
 *
 *   NEUF BOÎTES, dpr 1,5 :  1,33  2,00  1,33  2,00  1,33  2,00  1,33  2,00
 *   DEUX SURFACES, dpr 1,5 : 2,00  2,00  2,00  2,00  2,00  2,00  2,67  2,00
 *
 * Une barre sur deux la moitié plus fine, contre huit périodes identiques et
 * une qui déborde. C'est ce qu'on voyait, et ce n'était pas une impression.
 *
 * Le remède ne peut pas être un réglage de plus sur neuf boîtes : tant
 * qu'elles sont neuf, elles se calent neuf fois. On les remplace par DEUX
 * SURFACES peintes d'un dégradé répété, que le navigateur rastérise d'un seul
 * tenant. Les mesures d'époque ne bougent pas — filet de 2, pas de 3, vide
 * `#A2EB56`, plein `#73B01E`, remplissage du bas vers le haut.
 *
 * Ce fichier EXÉCUTE `brancherBarresXp` sur un DOM en carton : c'est elle qui
 * traduit les neuf `--f` du light en deux variables pour la feuille de style.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const JS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public/bureau-frutiz.css'), 'utf8');

// Un DOM en carton : neuf `<i>` porteurs de `--f`, et la boîte qui les tient.
function scene(taux) {                       // taux : 0..1
  const styles = [];
  const barres = [];
  for (let i = 0; i < 9; i++) {
    const s = { _v: {}, setProperty(k, v) { this._v[k] = String(v); },
      getPropertyValue(k) { return this._v[k] || ''; } };
    styles.push(s);
    barres.push({ style: s });
  }
  // La règle du light (`setHomeProgress`) : remplissage du BAS vers le haut,
  // une seule barre partielle à la fois.
  const n = 9;
  for (let i = 0; i < n; i++) {
    const f = Math.max(0, Math.min(1, taux * n - (n - 1 - i)));
    styles[i].setProperty('--f', (f * 100).toFixed(1) + '%');
  }
  const boite = {
    _v: {},
    style: { setProperty(k, v) { boite._v[k] = String(v); } },
    querySelectorAll() { return barres; },
  };
  return boite;
}

// `brancherBarresXp` livrée, avec un `$` et un MutationObserver en carton.
function brancher(boite) {
  const src = /function brancherBarresXp\(\) \{[\s\S]*?\n  \}/.exec(JS);
  assert.ok(src, 'brancherBarresXp doit exister');
  // eslint-disable-next-line no-new-func
  const f = new Function('$', 'MutationObserver',
    src[0] + '; return brancherBarresXp;')(
    () => boite,
    function () { this.observe = () => {}; });
  f();
  return boite._v;
}

test('rien de gagné : aucune barre pleine, aucune partielle', () => {
  const v = brancher(scene(0));
  assert.strictEqual(v['--xp-pleines'], '0');
  assert.strictEqual(v['--xp-part'], '0%');
  assert.strictEqual(v['--xp-part-bas'], '-10px',
    'la barre en cours est renvoyée hors champ quand il n’y en a pas');
});

test('cinq barres pleines et la sixième à mi-course', () => {
  // 5,5 / 9 : cinq pleines, la sixième à 50 %.
  const v = brancher(scene(5.5 / 9));
  assert.strictEqual(v['--xp-pleines'], '5');
  assert.strictEqual(v['--xp-part'], '50%');
  // La sixième barre est la SIXIÈME depuis le bas : rang 5, donc 5 × 3 px.
  assert.strictEqual(v['--xp-part-bas'], '15px');
});

test('tout gagné : les neuf pleines, plus rien de partiel', () => {
  const v = brancher(scene(1));
  assert.strictEqual(v['--xp-pleines'], '9');
  assert.strictEqual(v['--xp-part'], '0%');
});

test('le remplissage monte du BAS, comme `barLevel`', () => {
  // Une seule barre gagnée sur neuf : c'est celle du bas.
  const v = brancher(scene(1 / 9));
  assert.strictEqual(v['--xp-pleines'], '1');
  assert.strictEqual(v['--xp-part-bas'], '-10px', 'aucune barre partielle');
  // Un neuvième et demi : une pleine, la deuxième à moitié.
  const w = brancher(scene(1.5 / 9));
  assert.strictEqual(w['--xp-pleines'], '1');
  assert.strictEqual(w['--xp-part'], '50%');
  assert.strictEqual(w['--xp-part-bas'], '3px', 'la deuxième depuis le bas');
});

test('les mesures d’époque sont intactes : filet de 2, pas de 3, deux verts', () => {
  // Le vide et le plein, dans les deux dégradés.
  assert.match(CSS, /#bureau-coin \.enc-progress \{[\s\S]*?repeating-linear-gradient\(to top, #A2EB56 0 2px, transparent 2px 3px\)/,
    'les neuf filets vides');
  assert.match(CSS, /#bureau-coin \.enc-progress::after \{[\s\S]*?repeating-linear-gradient\(to top, #73B01E 0 2px, transparent 2px 3px\)/,
    'et les pleins');
  // Vingt-six px en tout : neuf filets de 2 et huit écarts de 1.
  assert.match(CSS, /#bureau-coin \.enc-progress \{[\s\S]*?left bottom \/ 100% 26px no-repeat/);
  // Les deux dégradés partent du BAS (`to top`), comme le remplissage.
  const bloc = /#bureau-coin \.enc-progress \{[\s\S]*?\n\}/.exec(CSS)[0];
  assert.ok(!/to bottom/.test(bloc), 'aucun dégradé à l’envers');
  // La hauteur des pleines : autant de pas qu'il y a de barres, moins le
  // dernier écart.
  assert.match(CSS, /height: max\(0px, calc\(var\(--xp-pleines\) \* 3px - 1px\)\);/);
});

test('les neuf boîtes ne peignent plus rien — mais elles restent', () => {
  // Elles restent parce que le light y écrit son calcul, et parce que le
  // gabarit TACTILE les affiche toujours : la règle qui les efface est
  // portée par `body.bureau-frutiz`, elle ne vaut que sur le bureau.
  assert.match(CSS, /body\.bureau-frutiz #bureau-coin \.enc-progress i,\s*\n\s*body\.bureau-frutiz #bureau-coin \.enc-progress i::before \{ background: none; \}/);
  const mobile = fs.readFileSync(path.join(ROOT, 'public/light.html'), 'utf8');
  assert.match(mobile, /\.enc-progress i \{\s*\n\s*display: block; height: 2px; background: #A3EB57;/,
    'le gabarit tactile garde ses neuf boîtes et son rendu');
  assert.match(mobile, /<div class="enc-progress" id="home-progress">(<i><\/i>){9}<\/div>/,
    'et les neuf éléments sont toujours là');
});

test('le branchement vise le DOCUMENT, pas le coin', () => {
  // L'encart est emprunté au gabarit tactile et reparenté dans le coin PLUS
  // TARD : le chercher dans le coin le manquait, et les barres pleines ne se
  // peignaient jamais. (Vu au banc : capture toute claire.)
  const f = /function brancherBarresXp\(\) \{[\s\S]*?\n  \}/.exec(JS)[0];
  assert.match(f, /var boite = \$\('#home-progress'\);/);
  assert.ok(!/coin\.querySelector/.test(f), 'et non dans le coin');
  // On repasse derrière le light à chaque relevé de profil.
  assert.match(f, /new MutationObserver\(relire\)\.observe\(boite, \{/);
  assert.match(f, /attributeFilter: \['style'\], subtree: true,/);
});
